-- =============================================================================
-- Planet Blitz M5 — 매치메이킹 라이브 수호 서빙 (PR#37 리뷰 HIGH, PR#35 carry-forward)
-- =============================================================================
-- 근거: PR#37 리드 리뷰 REQUEST_CHANGES. verify-invasion EF(injectGuardianAuthority,
--   20260718100000 이후 배선)는 침공 검증 시 방어자 수호를 **라이브 DB 값**(guardians.
--   performance·profiles.lineage_guardian_level)으로 권위 주입해 대조한다. 그런데
--   매치메이킹 RPC(get_invasion_targets 등)는 여전히 `defenses.layout`(업로드 시점에
--   프리즈된 수호 성능%·계보 보너스)을 그대로 서빙했다 — 정비도가 별도 컬럼으로 라이브
--   서빙되는 것과 달리, 수호는 layout jsonb 안에 박제된 값이 그대로 나갔다.
--
--   결과: 주간 풍화(weather_guardians, ADR-0006/0007) 이후 공격자가 매치메이킹이 준
--   stale layout(예: perf 100%)으로 정직하게 런·제출하면, verify-invasion EF 는 라이브
--   값(예: perf 95%)으로 권위 주입해 대조 → guardiansEqual 불일치 → defense-mismatch 로
--   **정직한 침공이 광범위 오거부**된다. 공격자는 방어자의 `guardians` 행을 RLS 로 직접
--   읽을 방법이 없어(get_invasion_targets 가 유일한 창) 라이브 값을 스스로 재현할 수 없다.
--
-- 해법: `public.inject_guardian_authority(layout, profile_id)` 헬퍼를 신설해 EF
--   injectGuardianAuthority 와 **동일 규칙**(슬롯 위치는 layout 존중, 성능%·계보 보너스·
--   스냅샷은 라이브 DB 로 덮어쓰기, 슬롯 i ↔ 활성 수호 i(created_at→id 정렬) 매핑,
--   MAX_GUARDIAN_SLOTS=2 상한, 슬롯 없거나 활성 수호 0 이면 guardians 필드 제거)로
--   layout.guardians 를 라이브 값으로 치환한다. 이 헬퍼를 매치메이킹 3종 RPC
--   (get_invasion_targets/get_placement_targets/get_revenge_targets — 모두 layout 을
--   서빙해 침공 런 구성에 쓰인다)의 layout 반환 컬럼에 적용한다.
--
-- ⚠️ PR#29 교훈(원본 재정의 시 기존 로직 유실 사고) 재발 방지: 아래 3개 함수는 원격
--   pg_get_functiondef 로 확인한 **현재 배포 정의**(마이그레이션 파일과 100% 일치 확인
--   완료, drift 없음)를 기준으로, **layout 컬럼 selector 한 줄만** 치환했다. 가드
--   (auth.uid() null 체크)·쿨다운(1시간 재도전 회피)·매치메이킹 격차 로직(위 3명 + 30위
--   랜덤 1명, gap<=30)·배치전 NPC 필터(is_npc)·복수전 데드라인·시그니처·RETURNS TABLE
--   shape·SECURITY DEFINER·search_path·GRANT/REVOKE 는 전부 원본과 완전히 동일하게
--   보존한다(재정의는 grant 를 유지한다 — 시그니처 불변이므로 별도 재-grant 불필요).
--
-- 원격 적용은 리드 몫(리드 지시 — 이 마이그레이션 파일은 커밋만, apply_migration 미실행).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. inject_guardian_authority — 방어 배치 수호 슬롯을 라이브 DB 값으로 주입(순수 조회 헬퍼)
-- -----------------------------------------------------------------------------
-- EF `verifyInvasionCore.injectGuardianAuthority`(TS)와 단일 계약(비트 동일 — 어긋나면
-- 정직 런이 오거부): performanceCP = round(guardians.performance * 100), lineageBonusBp
-- = branchBonusBp(profiles.lineage_guardian_level) = floor(5000 * L / (L + 20))(L=0→0,
-- 상한 5000). 슬롯 순서는 layout.guardians 원본 순서(방어자 배치 위치), 값 원천은 활성
-- 수호를 created_at→id 로 정렬한 순서(EF index.ts·클라 guardianGateway.fetchGuardians 와
-- 동일 정렬 — 슬롯 i ↔ 수호 i 매핑이 3자(클라 조회·EF 조회·이 함수) 모두 비트 동일해야
-- 함) 앞에서부터. STABLE(같은 트랜잭션 내 반복 호출 결과 동일, 쓰기 없음).
create or replace function public.inject_guardian_authority(p_layout jsonb, p_profile_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_slots      jsonb;
  v_slot_count integer;
  v_level      integer;
  v_bonus_bp   integer;
  v_new        jsonb := '[]'::jsonb;
  v_idx        integer := 0;
  v_row        record;
begin
  if p_layout is null then
    return p_layout;
  end if;
  v_slots := p_layout->'guardians';
  if v_slots is null or jsonb_typeof(v_slots) <> 'array' then
    v_slot_count := 0;
  else
    v_slot_count := jsonb_array_length(v_slots);
  end if;
  -- 저장 layout 에 수호 슬롯이 없으면 조회 자체를 건너뛴다 → 수호 미포함 방어는 완전 불변.
  if v_slot_count = 0 then
    return p_layout - 'guardians';
  end if;

  select coalesce(lineage_guardian_level, 0) into v_level
    from public.profiles where id = p_profile_id;
  if v_level is null or v_level <= 0 then
    v_bonus_bp := 0;
  else
    v_bonus_bp := floor(5000.0 * v_level / (v_level + 20))::integer;
    if v_bonus_bp > 5000 then v_bonus_bp := 5000; end if;
  end if;

  -- MAX_GUARDIAN_SLOTS(data/guardian.ts) = 2 하드코딩(GDD §4 동시 방어 수호 상한 — 재번호
  -- 금지 계약과 동일 축, 값이 바뀌면 이 함수도 함께 갱신해야 함을 EF injectGuardianAuthority
  -- 와 나란히 문서화).
  for v_row in
    select data, performance
    from public.guardians
    where profile_id = p_profile_id and retired = false
    order by created_at asc, id asc
    limit least(v_slot_count, 2)
  loop
    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'x', coalesce((v_slots->v_idx->>'x')::numeric, 0),
      'y', coalesce((v_slots->v_idx->>'y')::numeric, 0),
      'snapshot', v_row.data,
      'performanceCP', round(coalesce(v_row.performance, 100) * 100)::integer,
      'lineageBonusBp', v_bonus_bp
    ));
    v_idx := v_idx + 1;
  end loop;

  if jsonb_array_length(v_new) = 0 then
    return p_layout - 'guardians';
  end if;
  return jsonb_set(p_layout, '{guardians}', v_new);
end;
$$;

revoke all on function public.inject_guardian_authority(jsonb, uuid) from public;
revoke all on function public.inject_guardian_authority(jsonb, uuid) from anon;
grant execute on function public.inject_guardian_authority(jsonb, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. get_invasion_targets — layout 컬럼만 라이브 주입(원본 20260717010000, 나머지 동일)
-- -----------------------------------------------------------------------------
create or replace function public.get_invasion_targets()
returns table(profile_id uuid, rank integer, display_name text, ship_summary jsonb, defense_id uuid, layout jsonb, maintenance numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_my_rank integer;
begin
  if v_me is null then
    return;
  end if;
  select l.rank into v_my_rank from public.ladder l where l.profile_id = v_me;
  if v_my_rank is null then
    return;
  end if;

  return query
  with candidates as (
    (select l.profile_id as pid, l.rank as rnk
       from public.ladder l
       where l.rank < v_my_rank and l.placed
       order by l.rank desc
       limit 3)
    union
    (select l.profile_id as pid, l.rank as rnk
       from public.ladder l
       where l.rank < v_my_rank and l.rank >= v_my_rank - 30 and l.placed
       order by md5(l.profile_id::text || v_me::text || to_char(now(), 'YYYYMMDDHH24'))
       limit 1)
  ),
  fresh as (
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
    public.inject_guardian_authority(d.layout, f.pid),
    d.maintenance
  from fresh f
  join public.profiles p on p.id = f.pid
  join public.defenses d on d.profile_id = f.pid and d.active
  order by f.rnk desc;
end;
$$;

revoke all on function public.get_invasion_targets() from public;
revoke all on function public.get_invasion_targets() from anon;
grant execute on function public.get_invasion_targets() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. get_placement_targets — layout 컬럼만 라이브 주입(원본 20260717090000, 나머지 동일)
-- -----------------------------------------------------------------------------
create or replace function public.get_placement_targets()
returns table(profile_id uuid, rank integer, display_name text, ship_summary jsonb, defense_id uuid, layout jsonb, maintenance numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;
  if exists (select 1 from public.ladder l where l.profile_id = v_me) then return; end if;
  return query
  select p.id, l.rank, p.display_name,
    coalesce((select jsonb_build_object('name', s.name, 'level', s.level, 'xp', s.xp)
       from public.ships s where s.profile_id = p.id order by s.slot limit 1), '{}'::jsonb) as ship_summary,
    d.id, public.inject_guardian_authority(d.layout, p.id), d.maintenance
  from public.profiles p
  join public.defenses d on d.profile_id = p.id and d.active
  left join public.ladder l on l.profile_id = p.id
  where p.is_npc
  order by l.rank desc;
end; $$;

revoke all on function public.get_placement_targets() from public;
revoke all on function public.get_placement_targets() from anon;
grant execute on function public.get_placement_targets() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. get_revenge_targets — layout 컬럼만 라이브 주입(원본 20260717140000, 나머지 동일)
-- -----------------------------------------------------------------------------
create or replace function public.get_revenge_targets()
returns table(profile_id uuid, rank integer, display_name text, ship_summary jsonb, defense_id uuid, layout jsonb, maintenance numeric, revenge_invasion_id uuid, expires_at timestamptz, seconds_remaining integer, can_ignore_cooldown boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;
  return query
  select p.id, l.rank, p.display_name,
    coalesce((select jsonb_build_object('name', s.name, 'level', s.level, 'xp', s.xp)
       from public.ships s where s.profile_id = p.id order by s.slot limit 1), '{}'::jsonb),
    d.id, public.inject_guardian_authority(d.layout, p.id), d.maintenance,
    rt.revenge_invasion_id, rt.deadline,
    greatest(0, ceil(extract(epoch from (rt.deadline - now()))))::integer, true
  from public.revenge_targets_for(v_me) rt
  join public.profiles p on p.id = rt.target_id
  left join public.ladder l on l.profile_id = p.id
  left join public.defenses d on d.profile_id = p.id and d.active
  order by rt.deadline asc;
end;
$$;

revoke all on function public.get_revenge_targets() from public;
revoke all on function public.get_revenge_targets() from anon;
grant execute on function public.get_revenge_targets() to authenticated, service_role;

-- =============================================================================
-- 잔여 신뢰 경계(MED — README 이월): 스냅샷~검증 사이 dismiss 레이스
-- =============================================================================
-- 위 라이브 서빙 채택으로 "stale layout vs 라이브 DB 불일치" 오거부의 **대다수**(주간
-- 풍화 간격 — 실질 상시 발생)는 해소된다. 그러나 완전한 원자성은 아니다: 공격자가
-- get_invasion_targets 호출(라이브 스냅샷 T0) → 로컬 런 진행(수 분) → 제출·verify-invasion
-- 재실행(T1, T1 > T0) 사이에 방어자가 dismiss_guardian(소멸) 또는 신규 retire_ship(퇴역)을
-- 실행하면, T0 스냅샷(예: 활성 수호 2기)과 T1 EF 재조회(예: 활성 수호 1기, 소멸분 제외)가
-- 달라져 개수(n) 불일치 → guardiansEqual 이 false → defense-mismatch 로 거부된다.
--
-- 보안 영향: 없음(항상 reject 방향). EF 는 항상 검증 시점(T1) 라이브 값을 진실로 재대조하므로,
-- 이 레이스가 위조를 accept 시키는 경로는 존재하지 않는다 — 최악의 결과는 "정직한 침공이
-- 드물게 오거부"뿐이다(원칙2 서버 권위 위반 없음).
--
-- 정직 손해 빈도 평가: 낮음. dismiss_guardian/retire_ship 은 유저가 **자기 방어 사령부**에서
-- 명시 클릭하는 행동이라(자동 소멸 없음 — ADR-0007) 발생 빈도가 낮고, 공격자 런 시간(초~수분)
-- 창에 정확히 겹쳐야 한다. 또한 방어자 본인이 방금 자기 기지를 개편했다면 그 순간의 침공이
-- 재시도로 정정되는 것은 게임 경제상 자연스럽다(방어자가 막 바꾼 기지 구성이 재현되는 것이
-- 오히려 맞는 거동에 가깝다). retire_ship 은 신규 수호를 **추가**만 하고 기존 슬롯 순서를
-- 밀지 않으므로(created_at asc 정렬 — 새 수호는 항상 뒤), 슬롯 0/1 이 이미 채워진 상태에서
-- 신규 퇴역은 슬롯 매핑에 영향 없다(영향은 오직 슬롯이 비어 있다가 신규 퇴역으로 채워지는
-- 좁은 창뿐). 완전한 원자성(get_invasion_targets 스냅샷을 침공 행에 고정해 EF 가 그 고정본을
-- 대조)은 침공 제출 스키마 변경(스냅샷 열 추가)이 필요한 별도 작업으로 남긴다(README
-- carry-forward, 이 마이그레이션 범위 밖).
-- =============================================================================
