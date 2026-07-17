-- =============================================================================
-- Planet Blitz M4 — Phase D 마이그레이션 (침공 검증·래더 스왑·매치메이킹, 계획 §4)
-- =============================================================================
-- 근거: ADR-0003(복제 약탈·방어자 무손실) · ADR-0004(영구 래더) · ADR-0005(결정론
-- 리플레이 검증) · 핸드오프 team-plan.md §D-1/§D-2 · supabase/README.md "Phase D
-- 착수 조건" 2개 섹션.
--
-- 담는 것:
--   1. apply_invasion_result(...)  — 검증 통과 시 래더 스왑 + 복제 약탈을 단일
--      트랜잭션으로 원자 처리하는 security definer 함수(원칙2 서버 권위). verify-invasion
--      Edge Function이 재실행 검증 통과 후 호출한다.
--   2. get_invasion_targets()      — 매치메이킹 RPC(security definer). 정찰 전면 공개
--      3정책을 폐기하고 이 RPC 경유로만 타인 방어를 조회하도록 좁힌다(착수 조건 ①).
--      재도전 쿨다운 1시간을 서버에서 강제한다.
--   3. defenses INSERT/UPDATE budget_spent 서버 산출·검증 게이트(착수 조건 ②).
--   4. ladder.rank UNIQUE 를 DEFERRABLE 로 전환(단일 트랜잭션 내 순위 교차 갱신 허용).
--
-- 재실행 안전성: 모든 함수는 create or replace, 정책은 drop if exists 선행, 제약은
-- drop constraint if exists 후 재생성 → 부분 실패 후 재적용이 에러 없이 수렴한다.
--
-- ⚠️ SECURITY DEFINER 와 current_user: definer 함수 내부에서는 current_user 가 함수
-- 소유자(postgres)로 바뀐다. 따라서 스키마 가드 트리거(security invoker)가 쓰는
-- public.is_service_role()(= current_user 검사)를 definer 함수 안에서 호출 권위 판정에
-- 쓰면 항상 true 가 되어 게이트가 무력화된다. definer 함수의 호출자 권위는 (a) EXECUTE
-- 권한(anon/authenticated 회수, service_role 만 부여)과 (b) 요청 JWT 의 role 클레임을
-- 읽는 public.caller_is_service_role() 로 판정한다(definer 무관하게 실제 호출자 반영).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. 호출자 권위 판정 헬퍼 — 요청 JWT role 클레임 기반(SECURITY DEFINER 안전)
-- -----------------------------------------------------------------------------
-- is_service_role()(current_user 기반)은 SECURITY DEFINER 함수 안에서 소유자 role 로
-- 오판한다. 이 헬퍼는 PostgREST 가 세팅한 request.jwt.claims 의 role 을 읽으므로,
-- definer 함수 안에서도 실제 호출자(service_role 키 vs authenticated)를 정확히 가른다.
create or replace function public.caller_is_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role',
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- 1. defenses 예산(budget_spent) 서버 산출·검증 게이트 (착수 조건 ②)
-- -----------------------------------------------------------------------------
-- 방어 배치 layout(jsonb)의 실제 비용을 서버가 산출한다. 비용표는 src/sim/defense.ts
-- 의 TURRET_SPECS[].cost / OBSTACLE_COST 와 일치해야 한다(재번호 금지 계약):
--   포탑 유형 0 발칸=1, 1 저격=3, 2 산탄=2, 3 감속=2, 4 미사일=3, 5 전격=2 / 장애물=1.
-- 범위 밖 유형은 spawnDefenseTurret 폴백과 동일하게 발칸(1)로 계산한다.
create or replace function public.defense_layout_cost(p_layout jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select
    coalesce((
      select sum(
        case (t->>'type')::int
          when 0 then 1  -- 발칸
          when 1 then 3  -- 저격
          when 2 then 2  -- 산탄
          when 3 then 2  -- 감속
          when 4 then 3  -- 미사일
          when 5 then 2  -- 전격
          else 1         -- 범위 밖 → 발칸 폴백
        end
      )
      from jsonb_array_elements(
        case when jsonb_typeof(p_layout->'turrets') = 'array' then p_layout->'turrets' else '[]'::jsonb end
      ) as t
    ), 0)
    +
    coalesce((
      select count(*)::int  -- 장애물 1개당 OBSTACLE_COST=1
      from jsonb_array_elements(
        case when jsonb_typeof(p_layout->'obstacles') = 'array' then p_layout->'obstacles' else '[]'::jsonb end
      )
    ), 0);
$$;

-- 배치 포인트 기본 예산(GDD §8 "전원 동일 예산"). 초기값 20(튜닝 대상 — 시설 업그레이드
-- 소폭 증가는 Phase E 에서 프로필별 상한으로 확장). 서버 산출 비용이 이를 초과하면 거부.
-- 핵심 무결성 속성은 "budget_spent = 실제 layout 비용"(클라이언트가 낮춰 신고 불가)이다.

-- defenses 가드 함수 교체: INSERT/UPDATE 모두에서 budget_spent 를 서버가 산출하고
-- 예산 상한을 강제한다. UPDATE 에서는 maintenance 자가회복도 계속 차단(HIGH-2 승계).
create or replace function public.guard_defenses_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cost integer;
begin
  -- service_role(서버 로직)은 게이트 우회 — 정비 회복·예산은 서버 트랜잭션이 직접 쓴다.
  if public.is_service_role() then
    return new;
  end if;

  -- 클라이언트(authenticated) 경로: 예산은 layout 에서 서버가 산출(자가 신고 금지).
  v_cost := public.defense_layout_cost(new.layout);
  if v_cost > 20 then
    raise exception 'defense budget exceeded: cost=% > 20', v_cost
      using errcode = 'check_violation';
  end if;
  new.budget_spent := v_cost;

  if tg_op = 'UPDATE' then
    -- 정비도 자가회복 차단(ADR-0006): 클라이언트 UPDATE 는 이전 값 유지.
    new.maintenance := old.maintenance;
  else
    -- INSERT: 신규 방어는 정비도 100 로 강제(클라이언트가 임의 값 신고 불가).
    new.maintenance := 100.00;
  end if;

  return new;
end;
$$;

-- 트리거를 INSERT 도 포함하도록 재생성(기존은 BEFORE UPDATE 만이었다).
drop trigger if exists trg_defenses_guard on public.defenses;
create trigger trg_defenses_guard
  before insert or update on public.defenses
  for each row execute function public.guard_defenses_client_write();

-- -----------------------------------------------------------------------------
-- 2. 정찰 전면 공개 3정책 폐기 (착수 조건 ①)
-- -----------------------------------------------------------------------------
-- ships/defenses/guardians 의 select_others(using true) 를 제거한다. 이제 타인 방어·
-- 기체 정찰은 get_invasion_targets() RPC(security definer)로만 가능하다 — "현재 나에게
-- 제안된 상대"만 조회하도록 서버가 강제한다. 본인 행 조회(rw_own)와 침공 참여자 조회
-- (invasions_select_participant, 리플레이 관전 F3)는 그대로 유지된다.
drop policy if exists ships_select_others on public.ships;
drop policy if exists defenses_select_others on public.defenses;
drop policy if exists guardians_select_others on public.guardians;

-- -----------------------------------------------------------------------------
-- 3. ladder.rank UNIQUE → DEFERRABLE (순위 교차 갱신 허용)
-- -----------------------------------------------------------------------------
-- 순위 스왑은 두 행의 rank 를 맞바꾼다. 기본(즉시) UNIQUE 제약은 단일 UPDATE 도중
-- 행별로 즉시 검사해 일시적 중복으로 실패할 수 있다. DEFERRABLE INITIALLY DEFERRED 로
-- 전환해 제약 검사를 트랜잭션 커밋 시점으로 미루면, 단일 문장 교차 갱신이 안전해진다.
alter table public.ladder drop constraint if exists ladder_rank_key;
alter table public.ladder
  add constraint ladder_rank_key unique (rank) deferrable initially deferred;

-- -----------------------------------------------------------------------------
-- 4. apply_invasion_result — 검증 통과 후 래더 스왑 + 복제 약탈 (원자 트랜잭션)
-- -----------------------------------------------------------------------------
-- verify-invasion Edge Function 이 재실행 검증 통과 후 호출한다. verified_* 확정 +
-- (공격자 승 & 순위 조건) 스왑 + 복제 약탈을 하나의 트랜잭션(함수 = 암묵 트랜잭션)으로
-- 처리한다. 멱등: 이미 확정된(pending 아님) 침공은 재적용하지 않는다(재실행 안전).
--
-- 엣지 케이스(명시적 정의):
--   - 공격자/방어자 래더 행 없음(배치전 미완료) → 스왑 없음. 존재하는 쪽만 승패 카운터.
--   - placed=false(둘 중 하나라도) → 순위 스왑 없음(배치전 삽입 전이므로). 카운터는 갱신.
--   - 공격자 순위가 이미 방어자보다 높음(수가 작음) → 스왑 없음(자기 강등 안 함).
--     정상 매치메이킹은 항상 방어자.rank < 공격자.rank 이므로 승리 시 스왑이 표준.
--   - 복제 약탈은 방어자 inventory 를 읽어 공격자에게 복제 지급(원본 무손실, ADR-0003).
--     기본안(OQ-M4-5): item_id 오름차순 최대 3개(소량, 튜닝 대상).
create or replace function public.apply_invasion_result(
  p_invasion_id uuid,
  p_verified_result jsonb,
  p_attacker_won boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv       public.invasions%rowtype;
  v_att       public.ladder%rowtype;
  v_def       public.ladder%rowtype;
  v_has_att   boolean := false;
  v_has_def   boolean := false;
  v_swapped   boolean := false;
  v_att_rank  integer := null;
  v_def_rank  integer := null;
  v_loot      jsonb := '[]'::jsonb;
  v_item      record;
begin
  -- 호출자 권위: service_role 만(EXECUTE 권한 + JWT role 클레임 이중 게이트).
  if not public.caller_is_service_role() then
    raise exception 'apply_invasion_result: service_role 전용 호출';
  end if;

  -- 침공 행 잠금 + pending 확인(멱등).
  select * into v_inv from public.invasions where id = p_invasion_id for update;
  if not found then
    raise exception 'apply_invasion_result: 침공 % 없음', p_invasion_id;
  end if;
  if v_inv.verified_status <> 'pending' then
    return jsonb_build_object(
      'swapped', false, 'attacker_rank', null, 'defender_rank', null,
      'loot', '[]'::jsonb, 'note', 'already-finalized'
    );
  end if;

  -- verified_* 확정.
  update public.invasions
    set verified_status = 'verified',
        verified_result = p_verified_result,
        attacker_won = p_attacker_won,
        verified_at = now()
    where id = p_invasion_id;

  -- 래더 행 잠금(교착 방지: profile_id 오름차순 고정 순서).
  if v_inv.attacker_id <= v_inv.defender_id then
    select * into v_att from public.ladder where profile_id = v_inv.attacker_id for update;
    v_has_att := found;
    select * into v_def from public.ladder where profile_id = v_inv.defender_id for update;
    v_has_def := found;
  else
    select * into v_def from public.ladder where profile_id = v_inv.defender_id for update;
    v_has_def := found;
    select * into v_att from public.ladder where profile_id = v_inv.attacker_id for update;
    v_has_att := found;
  end if;

  if p_attacker_won then
    -- 승패 카운터.
    if v_has_att then
      update public.ladder set wins = wins + 1, last_active = now()
        where profile_id = v_inv.attacker_id;
    end if;
    if v_has_def then
      update public.ladder set losses = losses + 1 where profile_id = v_inv.defender_id;
    end if;

    -- 순위 스왑 조건: 양측 placed 이고 공격자 순위가 방어자보다 낮을 때(수가 큼).
    if v_has_att and v_has_def and v_att.placed and v_def.placed and v_att.rank > v_def.rank then
      update public.ladder
        set rank = case
                     when profile_id = v_inv.attacker_id then v_def.rank
                     when profile_id = v_inv.defender_id then v_att.rank
                   end
        where profile_id in (v_inv.attacker_id, v_inv.defender_id);
      v_swapped := true;
      v_att_rank := v_def.rank;  -- 공격자 새 순위 = 방어자 옛 순위
      v_def_rank := v_att.rank;  -- 방어자 새 순위 = 공격자 옛 순위
    end if;

    -- 복제 약탈(ADR-0003): 방어자 inventory 일부 복제 지급(원본 무손실).
    for v_item in
      select item_id, data from public.items
        where profile_id = v_inv.defender_id and location = 'inventory'
        order by item_id
        limit 3
    loop
      insert into public.items (profile_id, item_id, location, data)
        values (
          v_inv.attacker_id,
          v_item.item_id || '-loot-' || left(p_invasion_id::text, 8),
          'inventory',
          v_item.data || jsonb_build_object(
            'looted_from', v_inv.defender_id,
            'looted_at', now(),
            'source_invasion', p_invasion_id
          )
        )
        on conflict (profile_id, item_id) do nothing;
      v_loot := v_loot || jsonb_build_array(v_item.data);
    end loop;
  else
    -- 공격 실패: 방어자 승 기록. 래더 순위 무변동.
    if v_has_att then
      update public.ladder set losses = losses + 1, last_active = now()
        where profile_id = v_inv.attacker_id;
    end if;
    if v_has_def then
      update public.ladder set wins = wins + 1 where profile_id = v_inv.defender_id;
    end if;
  end if;

  return jsonb_build_object(
    'swapped', v_swapped,
    'attacker_rank', v_att_rank,
    'defender_rank', v_def_rank,
    'loot', v_loot
  );
end;
$$;

-- EXECUTE 게이트: service_role 만. definer 함수라 소유자 권한으로 돌지만, 호출 자체를
-- service_role 로 제한(PostgREST 는 요청 role 의 EXECUTE 권한을 검사한다).
revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from public;
revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from anon, authenticated;
grant execute on function public.apply_invasion_result(uuid, jsonb, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 5. get_invasion_targets — 매치메이킹 RPC (정찰 조회를 이 경유로만 강제)
-- -----------------------------------------------------------------------------
-- 계약 shape(핸드오프 §D-2 고정): 각 행 = { profile_id, rank, display_name,
-- ship_summary jsonb, defense_id, layout jsonb, maintenance }.
-- 제안: 내 바로 위 3명 + (내 순위-30)~(내 순위-1) 구간 랜덤 1명(GDD §8). 재도전 쿨다운
-- 1시간을 서버에서 강제(최근 1시간 내 공격한 대상 제외). 활성 방어가 있는 대상만 제안.
-- auth.uid() 는 SECURITY DEFINER 안에서도 요청 JWT 의 sub 를 읽으므로 호출자 본인 기준.
create or replace function public.get_invasion_targets()
returns table (
  profile_id   uuid,
  rank         integer,
  display_name text,
  ship_summary jsonb,
  defense_id   uuid,
  layout       jsonb,
  maintenance  numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_my_rank integer;
begin
  if v_me is null then
    return;  -- 비로그인: 빈 결과.
  end if;
  select l.rank into v_my_rank from public.ladder l where l.profile_id = v_me;
  if v_my_rank is null then
    return;  -- 아직 순위 없음(배치전 미완료): 침공 대상 없음.
  end if;

  return query
  with candidates as (
    -- 내 바로 위 3명(순위 < 내 순위, 가장 가까운 순).
    (select l.profile_id as pid, l.rank as rnk
       from public.ladder l
       where l.rank < v_my_rank and l.placed
       order by l.rank desc
       limit 3)
    union
    -- (내 순위-30)~(내 순위-1) 구간 랜덤 1명(시간(시)별 안정 의사난수 = 세션당 갱신 근사).
    (select l.profile_id as pid, l.rank as rnk
       from public.ladder l
       where l.rank < v_my_rank and l.rank >= v_my_rank - 30 and l.placed
       order by md5(l.profile_id::text || v_me::text || to_char(now(), 'YYYYMMDDHH24'))
       limit 1)
  ),
  fresh as (
    -- 재도전 쿨다운 1시간: 최근 1시간 내 공격한 대상 제외.
    select c.pid, c.rnk from candidates c
    where not exists (
      select 1 from public.invasions iv
      where iv.attacker_id = v_me
        and iv.defender_id = c.pid
        and iv.created_at > now() - interval '1 hour'
    )
  )
  select
    f.pid,
    f.rnk,
    p.display_name,
    coalesce(
      (select jsonb_build_object('name', s.name, 'level', s.level, 'xp', s.xp)
         from public.ships s where s.profile_id = f.pid order by s.slot limit 1),
      '{}'::jsonb
    ) as ship_summary,
    d.id,
    d.layout,
    d.maintenance
  from fresh f
  join public.profiles p on p.id = f.pid
  join public.defenses d on d.profile_id = f.pid and d.active  -- 활성 방어 있는 대상만
  order by f.rnk desc;
end;
$$;

-- 매치메이킹은 로그인 유저(authenticated)가 자기 기준으로 호출. anon 은 제외.
revoke all on function public.get_invasion_targets() from public;
revoke all on function public.get_invasion_targets() from anon;
grant execute on function public.get_invasion_targets() to authenticated, service_role;
