-- =============================================================================
-- Planet Blitz — 재화(credits·minerals) 서버 권위 이관 (ADR-0027 · 서버 원장)
-- =============================================================================
-- 근거: ADR-0005 원칙2(서버 권위) · ADR-0027(서버 원장). 지금까지 credits/minerals 는
--   profiles.save(jsonb) 안에 있었고, 클라이언트 upsertProfile 이 save 전체를 last-write-wins
--   로 덮어써서 서버 RPC 의 차감을 무효화할 수 있었다(재화 위조 가능 — MEMORY 의 "profiles.save
--   통짜 write" 취약점). 재화를 profiles 의 **서버 권위 컬럼**으로 분리하고, 클라 write 를
--   봉인하며, 모든 소비/가산 RPC 를 컬럼 기준으로 재작성해 위조 경로를 원천 차단한다.
--
-- 담는 것:
--   1. profiles.credits / profiles.minerals 컬럼 신설(재화 정본, numeric not null default 0).
--   2. 기존 profiles 행의 save->>'credits' / save->>'minerals' 를 컬럼으로 1회 이관(백필).
--   3. guard_profiles_client_write() 재정의 — 기존 봉인(flagged·is_npc·lineage 4컬럼) 유지 +
--      credits·minerals 를 클라 UPDATE 에서 이전 값으로 고정. 신규 guard_profiles_client_insert()
--      트리거로 클라 INSERT 의 재화를 0 으로 강제(신규 프로필은 0 에서 시작).
--   4. 재화 RPC 6종을 컬럼 직접 읽기/쓰기로 재작성(본문 전수 보존, 재화 라인만 치환):
--      repair_defense · spend_profile_currency(+이를 호출하는 5 RPC 자동 정합) ·
--      apply_invasion_result · apply_module_purchase · salvage_core_module · flag_pve_anomalies.
--      각 함수는 갱신된 잔액을 반환 jsonb 에 포함(클라 표시 미러 동기화용 — 파일 하단 계약 참조).
--
-- 서버 권위 경계: guard_profiles_client_write/insert 는 security definer 가 아니라 트리거
--   함수라 호출 문장의 current_user 로 판정한다. 클라(authenticated) 직접 UPDATE/INSERT →
--   is_service_role()=false → 재화 컬럼 고정. security definer RPC(소유자=postgres)가 갱신할
--   때는 current_user=postgres → is_service_role()=true → 가드 통과(정당 차감/가산). 이관 백필도
--   마이그레이션이 postgres 로 도므로 가드에 막히지 않는다.
--
-- 재실행 안전성: alter table ... add column if not exists, create or replace function,
--   create or replace trigger. 백필 UPDATE 는 정본 컬럼이 아직 기본값(0)인 행만 대상으로 해
--   재적용 시 이미 채워진(획득한) 잔액을 덮어쓰지 않는다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles 재화 정본 컬럼
-- -----------------------------------------------------------------------------
-- 음수 금지 체크(서버 권위 재화는 결코 음수가 될 수 없다 — 모든 소비 경로가 잔액 부족 시
-- 아무것도 쓰지 않고, 가산 경로만 더한다). numeric — save 의 JS number 표현과 정합.
alter table public.profiles
  add column if not exists credits numeric not null default 0 check (credits >= 0);
alter table public.profiles
  add column if not exists minerals numeric not null default 0 check (minerals >= 0);

-- -----------------------------------------------------------------------------
-- 2. 기존 값 1회 이관(백필) — save->>'credits' / save->>'minerals' → 컬럼
-- -----------------------------------------------------------------------------
-- null/비숫자는 0(정수·소수만 통과시키는 정규식 게이트). 음수는 greatest(0, ..)로 클램프해
--   체크 위반을 원천 방지. 정본 컬럼이 아직 기본값(0)인 행만 대상 → 재적용 안전.
update public.profiles p
  set credits = greatest(0, case
        when p.save->>'credits' ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.save->>'credits')::numeric
        else 0 end)
  where p.credits = 0
    and p.save->>'credits' is not null;

update public.profiles p
  set minerals = greatest(0, case
        when p.save->>'minerals' ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.save->>'minerals')::numeric
        else 0 end)
  where p.minerals = 0
    and p.save->>'minerals' is not null;

-- -----------------------------------------------------------------------------
-- 3. 클라 write 봉인 — 기존 UPDATE 가드에 재화 추가 + 신규 INSERT 가드
-- -----------------------------------------------------------------------------
-- ⚠️ 기존 봉인 블록(flagged·is_npc·lineage 4컬럼 + 쿨다운)을 반드시 유지한다(현행 정의:
--   20260718100000_m5_guardian_lineage.sql:95-111). 거기에 credits·minerals 고정만 추가한다.
--   재화는 서버 원장이 되어야 하므로 클라 UPDATE 가 이 두 컬럼을 못 바꾼다(save jsonb 를
--   통짜로 덮어써도 컬럼은 불변 → 위조 차단).
create or replace function public.guard_profiles_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.flagged := old.flagged;
    new.is_npc := old.is_npc;  -- Phase E: NPC 마커 위장 차단(20260717080000). M5 재정의에서도 유지.
    new.lineage_points := old.lineage_points;
    new.lineage_ship_level := old.lineage_ship_level;
    new.lineage_guardian_level := old.lineage_guardian_level;
    new.lineage_last_retired_at := old.lineage_last_retired_at;
    new.credits := old.credits;      -- ADR-0027: 재화 서버 권위(클라 UPDATE 봉인).
    new.minerals := old.minerals;    -- 소비/가산은 security definer RPC 만.
  end if;
  return new;
end;
$$;
-- 트리거(trg_profiles_guard, before update)는 초기 스키마에서 이미 정의됨 — 함수 교체로 반영.

-- 신규: 클라 INSERT 재화 위조 차단. 기존 가드는 BEFORE UPDATE 전용이라, 클라가 프로필을
--   최초 삽입할 때 credits/minerals 를 큰 값으로 심는 경로가 열려 있었다(RLS 는 id 소유권만
--   검사). 신규 프로필은 반드시 0 에서 시작하므로 non-service-role INSERT 는 두 컬럼을 0 으로
--   강제한다. 서버(security definer/service_role)는 통과(백필·시드·RPC).
create or replace function public.guard_profiles_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.credits := 0;
    new.minerals := 0;
  end if;
  return new;
end;
$$;

create or replace trigger trg_profiles_guard_insert
  before insert on public.profiles
  for each row execute function public.guard_profiles_client_insert();

-- -----------------------------------------------------------------------------
-- 4-a. repair_defense — 컬럼 기준 크레딧 차감 (현행: 20260717130000:75)
-- -----------------------------------------------------------------------------
-- 본문 전수 보존(프로필 행 잠금 for update·만점 no-op·부족 거부·정비 100 복구). 치환:
--   ⓐ 크레딧 읽기 save->>'credits' → 컬럼 credits.
--   ⓑ 크레딧 쓰기 jsonb_set(save,'{credits}',..) → set credits = ..
--   ⓒ 반환에 credits_left 추가(클라 미러 동기화).
create or replace function public.repair_defense(p_defense_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_def      public.defenses%rowtype;
  v_missing  numeric;
  v_cost     integer;
  v_credits  numeric;
begin
  if v_me is null then
    raise exception 'repair_defense: 로그인 필요';
  end if;

  -- [MED-2] 프로필 행을 먼저 잠근다(크레딧 읽기-차감 사이 동시 정비의 lost-update 차단).
  -- 이후 defenses 조회·갱신은 같은 트랜잭션이라 이 잠금이 정비 전체를 직렬화한다.
  select coalesce(credits, 0) into v_credits
    from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object('repaired', false, 'note', 'no-profile');
  end if;

  -- 대상 방어: 인자 있으면 그 id(본인 소유 검증), 없으면 본인 활성 방어.
  if p_defense_id is not null then
    select * into v_def from public.defenses
      where id = p_defense_id and profile_id = v_me;
  else
    select * into v_def from public.defenses
      where profile_id = v_me and active limit 1;
  end if;
  if not found then
    return jsonb_build_object('repaired', false, 'note', 'no-defense');
  end if;

  -- 이미 만점이면 no-op(과금 없음).
  if v_def.maintenance >= 100 then
    return jsonb_build_object(
      'repaired', false, 'cost', 0,
      'credits', v_credits, 'credits_left', v_credits,
      'maintenance', v_def.maintenance, 'note', 'already-full'
    );
  end if;

  v_missing := 100 - v_def.maintenance;
  v_cost := ceil(v_missing * 5)::integer;  -- REPAIR_CREDITS_PER_POINT = 5

  if v_credits < v_cost then
    return jsonb_build_object(
      'repaired', false, 'cost', v_cost, 'required', v_cost,
      'credits', v_credits, 'credits_left', v_credits,
      'maintenance', v_def.maintenance,
      'note', 'insufficient-credits'
    );
  end if;

  -- 원자 처리: 크레딧 차감(컬럼) + 정비도 100 복구(프로필 행 잠금 하).
  update public.profiles
    set credits = v_credits - v_cost
    where id = v_me;

  update public.defenses set maintenance = 100.00 where id = v_def.id;

  return jsonb_build_object(
    'repaired', true, 'cost', v_cost,
    'credits', v_credits - v_cost, 'credits_left', v_credits - v_cost,
    'maintenance', 100.00, 'note', 'repaired'
  );
end;
$$;

revoke all on function public.repair_defense(uuid) from public;
revoke all on function public.repair_defense(uuid) from anon;
grant execute on function public.repair_defense(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4-b. spend_profile_currency — 재화 차감 공용 헬퍼 (현행: 20260722000000:151)
-- -----------------------------------------------------------------------------
-- 컬럼 기준으로 고치면 이를 호출하는 5 RPC(level_up_defense_unit·ascend_defense_unit·
--   reroll_defense_unit_affixes·promote_defense_unit_rarity·craft_defense_unit)가 자동 정합된다
--   (그들은 이미 v_spend.credits_left/minerals_left 를 읽어 반환하므로 시그니처·OUT 명 불변).
-- 본문 전수 보존(프로필 행 잠금·부족 시 미기록). 치환: 재화 읽기/쓰기만 컬럼으로.
create or replace function public.spend_profile_currency(
  p_profile  uuid,
  p_credits  integer,
  p_minerals integer,
  out ok            boolean,
  out credits_left  numeric,
  out minerals_left numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credits  numeric;
  v_minerals numeric;
begin
  select coalesce(credits, 0),
         coalesce(minerals, 0)
    into v_credits, v_minerals
    from public.profiles where id = p_profile for update;

  if not found then
    ok := false; credits_left := 0; minerals_left := 0;
    return;
  end if;
  if v_credits < p_credits or v_minerals < p_minerals then
    ok := false; credits_left := v_credits; minerals_left := v_minerals;
    return;
  end if;

  credits_left  := v_credits - p_credits;
  minerals_left := v_minerals - p_minerals;
  update public.profiles
    set credits = credits_left,
        minerals = minerals_left
    where id = p_profile;
  ok := true;
end;
$$;

revoke all on function public.spend_profile_currency(uuid, integer, integer) from public;
revoke all on function public.spend_profile_currency(uuid, integer, integer) from anon;
revoke all on function public.spend_profile_currency(uuid, integer, integer) from authenticated;
grant execute on function public.spend_profile_currency(uuid, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 4-c. apply_invasion_result — 컬럼 기준 minerals 보너스·credits 방어보상 (현행: 20260722010000:315)
-- -----------------------------------------------------------------------------
-- ⚠️ 본문이 매우 길다(자기침공 3차 가드·profile_id 오름차순 락·pending 멱등·쿨다운 거부·
--   격차 30 스왑 예외·복수 보너스·복제 약탈·코어 모듈 차감). 전수 보존하고 재화 접근만 치환:
--   ⓐ 복수 보너스 minerals 읽기/쓰기 → 컬럼.  ⓑ 방어 성공 credits 읽기/쓰기 → 컬럼.
--   ⓒ 반환에 attacker_minerals_left(복수 보너스 후 공격자 광물)·defender_credits_left(방어
--      보상 후 방어자 크레딧) 추가. 해당 경로가 안 돌면 null(미변동 — 클라 미러 갱신 불요).
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
  v_inv        public.invasions%rowtype;
  v_att        public.ladder%rowtype;
  v_def        public.ladder%rowtype;
  v_has_att    boolean := false;
  v_has_def    boolean := false;
  v_att_placed boolean := false;
  v_is_revenge boolean := false;
  v_swapped    boolean := false;
  v_att_rank   integer := null;
  v_def_rank   integer := null;
  v_loot       jsonb := '[]'::jsonb;
  v_item       record;
  v_inv_count  integer;
  v_minerals   numeric;
  v_bonus      integer := 50;   -- 복수 탈환 보너스 광물(밸런스 튜닝 대상, 계획 §5).
  v_bonus_out  integer := 0;
  v_module_ids uuid[];          -- M7b: 스냅샷이 고정한 차감 대상 코어 모듈들.
  v_def_credit integer := 0;    -- M7b: 방어 성공 크레딧 정액(지급액, 미지급 시 0).
  v_credits    numeric;
  v_att_min_left numeric := null;  -- ADR-0027: 복수 보너스 후 공격자 광물 잔액(클라 미러).
  v_def_cred_left numeric := null; -- ADR-0027: 방어 보상 후 방어자 크레딧 잔액(클라 미러).
begin
  -- 호출자 권위: service_role 만.
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
      'loot', '[]'::jsonb, 'is_revenge', v_inv.is_revenge,
      'bonus_minerals', 0, 'defense_credits', 0, 'note', 'already-finalized'
    );
  end if;

  -- 자기 침공 3차 가드.
  if v_inv.attacker_id = v_inv.defender_id then
    raise exception 'apply_invasion_result: self-invasion 확정 불가 (%)', p_invasion_id;
  end if;

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
  v_att_placed := v_has_att and v_att.placed;

  -- 복수 판정(직전 스왑 상대 한정 서버 강제).
  v_is_revenge := exists (
    select 1 from public.revenge_targets_for(v_inv.attacker_id) rt
    where rt.target_id = v_inv.defender_id
  );

  -- 재도전 쿨다운 1시간 — 배치된 공격자에게만, 단 복수 침공은 쿨다운 무시(GDD §8).
  if v_att_placed and not v_is_revenge and exists (
    select 1 from public.invasions iv
    where iv.attacker_id = v_inv.attacker_id
      and iv.defender_id = v_inv.defender_id
      and iv.id <> v_inv.id
      and iv.created_at < v_inv.created_at
      and iv.created_at > v_inv.created_at - interval '1 hour'
  ) then
    update public.invasions
      set verified_status = 'rejected', verified_result = p_verified_result,
          attacker_won = false, verified_at = now()
      where id = p_invasion_id;
    return jsonb_build_object(
      'swapped', false, 'attacker_rank', null, 'defender_rank', null,
      'loot', '[]'::jsonb, 'is_revenge', false, 'bonus_minerals', 0,
      'defense_credits', 0, 'note', 'cooldown-violation'
    );
  end if;

  -- verified_* 확정 + 복수 플래그 기록.
  update public.invasions
    set verified_status = 'verified', verified_result = p_verified_result,
        attacker_won = p_attacker_won, verified_at = now(), is_revenge = v_is_revenge
    where id = p_invasion_id;

  -- ▮ 코어 모듈 사용 횟수 차감(ADR-0012·ADR-0018): **확정된 침공 1건 = 장착 모듈 각 1 차감**
  --   (승패 무관). 위 쿨다운 거부 경로는 이미 return 했고, pending 이 아니면 맨 위에서 조기
  --   반환하므로 여기 도달 = 실제 확정 1회다 → 재호출해도 두 번 차감되지 않는다(멱등).
  --   공격자가 런을 버려 확정이 오지 않으면 차감도 없다.
  --   스냅샷이 고정한 module_ids 의 charges_left 를 1 감소(바닥 0). 0 도달 행은 삭제하고
  --   장착 배열에서도 제거한다(FK 가 아닌 배열 컬럼이라 수동 정리).
  --   스냅샷 효력(authority.modules)은 유지 — 동시 침공 다건이 같은 모듈을 참조해도 이미
  --   고정된 효력은 불변, 차감만 바닥 0 에서 멈춘다. snapshot_id 없으면(라이브 경로) 모듈 없음.
  if v_inv.snapshot_id is not null then
    select s.module_ids into v_module_ids from public.invasion_snapshots s where s.id = v_inv.snapshot_id;
    if v_module_ids is not null and array_length(v_module_ids, 1) is not null then
      update public.core_modules
        set charges_left = greatest(0, charges_left - 1), updated_at = now()
        where id = any(v_module_ids);

      -- 소진(0) 모듈은 장착 해제 후 삭제. 배열에서 뺄 때 순서를 보존하고, **빈 슬롯(null)은
      -- null 그대로 남긴다** — 장착 배열은 고정 길이 + null 허용이고 밀집화가 금지다
      -- (src/net/modules.ts normalizeEquippedModules '슬롯 i 의미 보존'). `x not in (...)` 은
      -- x 가 null 이면 결과가 null(=false 취급)이라 빈 슬롯을 조용히 지워 배열을 앞으로
      -- 당긴다 → null 을 명시적으로 통과시켜 그 압축을 막는다.
      update public.defenses d
        set equipped_module_ids = array(
          select case
                   when x is null then null
                   when exists (
                     select 1 from public.core_modules c
                     where c.id = x and c.charges_left <= 0
                   ) then null
                   else x
                 end
          from unnest(d.equipped_module_ids) with ordinality as t(x, ord)
          order by t.ord
        )
        where d.equipped_module_ids && v_module_ids;

      delete from public.core_modules
        where id = any(v_module_ids) and charges_left <= 0;
    end if;
  end if;

  if p_attacker_won then
    -- 승패 카운터(래더 row 있는 쪽만).
    if v_has_att then
      update public.ladder set wins = wins + 1, last_active = now()
        where profile_id = v_inv.attacker_id;
    end if;
    if v_has_def then
      update public.ladder set losses = losses + 1 where profile_id = v_inv.defender_id;
    end if;

    -- 순위 스왑: 양측 placed·공격자 순위>방어자. 격차 상한(≤30)은 **복수 침공만** 예외.
    if v_att_placed and v_has_def and v_def.placed
       and v_att.rank > v_def.rank
       and (v_is_revenge or (v_att.rank - v_def.rank) <= 30) then
      update public.ladder
        set rank = case
                     when profile_id = v_inv.attacker_id then v_def.rank
                     when profile_id = v_inv.defender_id then v_att.rank
                   end
        where profile_id in (v_inv.attacker_id, v_inv.defender_id);
      v_swapped := true;
      v_att_rank := v_def.rank;
      v_def_rank := v_att.rank;
      -- 스왑 발생 사실 기록(복수 대상 판정의 권위 근거).
      update public.invasions set caused_swap = true where id = p_invasion_id;
    end if;

    -- 복수 성공(자리 탈환) 보너스 광물 지급.
    if v_is_revenge and v_swapped then
      select coalesce(minerals, 0) into v_minerals
        from public.profiles where id = v_inv.attacker_id for update;
      update public.profiles
        set minerals = v_minerals + v_bonus
        where id = v_inv.attacker_id;
      v_bonus_out := v_bonus;
      v_att_min_left := v_minerals + v_bonus;
    end if;

    -- 복제 약탈: 배치된 공격자에게만(배치전 약탈 금지) + 인벤 상한 200.
    if v_att_placed then
      select count(*) into v_inv_count
        from public.items
        where profile_id = v_inv.attacker_id and location = 'inventory';
      if v_inv_count < 200 then
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
      end if;
    end if;
  else
    -- 공격 실패: 방어자 승 기록. 래더 순위 무변동.
    if v_has_att then
      update public.ladder set losses = losses + 1, last_active = now()
        where profile_id = v_inv.attacker_id;
    end if;
    if v_has_def then
      update public.ladder set wins = wins + 1 where profile_id = v_inv.defender_id;
    end if;

    -- ▮ 방어 성공 보조 보상(기획 §4, ADR-0018): 코어 모듈 드랍 폐지 → **크레딧 정액**.
    --   data/coreModules.ts DEFENSE_SUCCESS_CREDITS = 40 미러(상수 결속 — 함께 갱신할 것).
    --   무작위가 없어 재현 검증이 불요하고, 위 pending 게이트 덕에 중복 지급이 없다.
    v_def_credit := 40;
    select coalesce(credits, 0) into v_credits
      from public.profiles where id = v_inv.defender_id for update;
    if found then
      update public.profiles
        set credits = v_credits + v_def_credit
        where id = v_inv.defender_id;
      v_def_cred_left := v_credits + v_def_credit;
    else
      v_def_credit := 0;
    end if;
  end if;

  return jsonb_build_object(
    'swapped', v_swapped,
    'attacker_rank', v_att_rank,
    'defender_rank', v_def_rank,
    'loot', v_loot,
    'is_revenge', v_is_revenge,
    'bonus_minerals', v_bonus_out,
    'defense_credits', v_def_credit,
    'attacker_minerals_left', v_att_min_left,
    'defender_credits_left', v_def_cred_left
  );
end;
$$;

revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from public;
revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from anon, authenticated;
grant execute on function public.apply_invasion_result(uuid, jsonb, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 4-d. apply_module_purchase — 컬럼 기준 크레딧 차감 (현행: 20260722010000:566)
-- -----------------------------------------------------------------------------
-- 본문 전수 보존(프로필 행 잠금·상한 20·중복 구매 서브트랜잭션). 치환:
--   재화 읽기/쓰기만 컬럼으로 + 반환에 credits_left 추가.
create or replace function public.apply_module_purchase(
  p_profile_id   uuid,
  p_date_seed    bigint,
  p_slot_index   integer,
  p_module       jsonb,
  p_rarity       text,
  p_charges_left integer,
  p_price        integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credits numeric;
  v_count   integer;
  v_new_id  uuid;
begin
  if not public.caller_is_service_role() then
    raise exception 'apply_module_purchase: service_role 전용 호출';
  end if;

  select coalesce(credits, 0) into v_credits
    from public.profiles where id = p_profile_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-profile');
  end if;

  -- 보관함 상한(만석 시 획득 차단). data/coreModules.ts MODULE_STORAGE_CAP=20 미러.
  select count(*) into v_count from public.core_modules where profile_id = p_profile_id;
  if v_count >= 20 then
    return jsonb_build_object('ok', false, 'code', 'storage-full');
  end if;

  if v_credits < p_price then
    return jsonb_build_object('ok', false, 'code', 'insufficient-credits', 'credits', v_credits, 'credits_left', v_credits);
  end if;

  -- 중복 구매 차단(유니크 PK). 서브트랜잭션이라 dup 시 이 insert 만 롤백된다.
  begin
    insert into public.module_shop_purchases (profile_id, date_seed, slot_index)
      values (p_profile_id, p_date_seed, p_slot_index);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'already-bought');
  end;

  update public.profiles
    set credits = v_credits - p_price
    where id = p_profile_id;
  insert into public.core_modules (profile_id, module, rarity, charges_left)
    values (p_profile_id, p_module, p_rarity, p_charges_left)
    returning id into v_new_id;

  return jsonb_build_object(
    'ok', true, 'module_id', v_new_id, 'rarity', p_rarity,
    'credits', v_credits - p_price, 'credits_left', v_credits - p_price
  );
end;
$$;

revoke all on function public.apply_module_purchase(uuid, bigint, integer, jsonb, text, integer, integer) from public;
revoke all on function public.apply_module_purchase(uuid, bigint, integer, jsonb, text, integer, integer) from anon, authenticated;
grant execute on function public.apply_module_purchase(uuid, bigint, integer, jsonb, text, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 4-e. salvage_core_module — 컬럼 기준 크레딧 환급 (현행: 20260724000000:184)
-- -----------------------------------------------------------------------------
-- 본문 전수 보존(모듈 소유 검증·장착 해제 빈 슬롯 보존·삭제·프로필 행 잠금 환급). 치환:
--   재화 읽기/쓰기만 컬럼으로 + 반환에 credits_left 추가.
create or replace function public.salvage_core_module(p_module_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_mod     public.core_modules%rowtype;
  v_affix   integer;
  v_value   integer;
  v_credits numeric;
begin
  if v_me is null then
    raise exception 'salvage_core_module: 로그인 필요';
  end if;

  select * into v_mod from public.core_modules
    where id = p_module_id and profile_id = v_me for update;
  if not found then
    return jsonb_build_object('ok', false, 'note', 'not-owned');
  end if;

  v_affix := coalesce(jsonb_array_length(v_mod.module->'prefixes'), 0)
           + coalesce(jsonb_array_length(v_mod.module->'suffixes'), 0);
  v_value := (case v_mod.rarity
                when 'normal' then 5
                when 'magic'  then 15
                when 'rare'   then 40
                when 'unique' then 100
                else 0
              end) + v_affix * 4;

  -- 장착 해제(뺀 자리는 null 로 보존 — 밀집화 금지) 후 삭제.
  update public.defenses d
    set equipped_module_ids = array(
      select case
               when x is null then null
               when x = p_module_id then null
               else x
             end
      from unnest(d.equipped_module_ids) with ordinality as t(x, ord)
      order by t.ord
    )
    where d.profile_id = v_me and d.equipped_module_ids @> array[p_module_id];
  delete from public.core_modules where id = p_module_id;

  -- 크레딧 환급(프로필 행 잠금 — lost-update 차단, repair_defense 패턴).
  select coalesce(credits, 0) into v_credits
    from public.profiles where id = v_me for update;
  update public.profiles
    set credits = v_credits + v_value
    where id = v_me;

  return jsonb_build_object(
    'ok', true, 'salvaged', v_value,
    'credits', v_credits + v_value, 'credits_left', v_credits + v_value,
    'rarity', v_mod.rarity
  );
end;
$$;

revoke all on function public.salvage_core_module(uuid) from public;
revoke all on function public.salvage_core_module(uuid) from anon;
grant execute on function public.salvage_core_module(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4-f. flag_pve_anomalies — 컬럼 기준 총자원 이상치 판정 (현행: 20260717150000:36)
-- -----------------------------------------------------------------------------
-- credits+minerals 를 **읽기만** 함(이상치 판정, 플래그만 세팅). 치환: 총자원 읽기를 컬럼으로.
-- (참고: Lane 3 에서 이 함수가 폐기될 수 있으나, 지금은 컬럼 기준으로 정합만 맞춘다.)
create or replace function public.flag_pve_anomalies(
  p_hourly_cap    numeric default 100000,   -- 시간당 (credits+minerals) 획득 상한(잠정).
  p_min_age_hours numeric default 1,        -- 이 나이 미만 계정은 율 계산 제외(신규 오탐 방어).
  p_min_total     numeric default 50000     -- 이 총자원 미만은 대상 제외(소액 오탐 방어).
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with candidate as (
    select
      p.id,
      coalesce(p.credits, 0) + coalesce(p.minerals, 0)                       as total,
      extract(epoch from (now() - p.created_at)) / 3600.0                    as age_h
    from public.profiles p
    where not p.is_npc
      and not p.flagged
  ),
  outliers as (
    select id
    from candidate
    where age_h >= p_min_age_hours
      and total >= p_min_total
      and (total / age_h) > p_hourly_cap
  ),
  upd as (
    update public.profiles
      set flagged = true
      where id in (select id from outliers)
      returning 1
  )
  select count(*)::integer into v_count from upd;
  return v_count;
end;
$$;

revoke all on function public.flag_pve_anomalies(numeric, numeric, numeric) from public;
revoke all on function public.flag_pve_anomalies(numeric, numeric, numeric) from anon, authenticated;
grant execute on function public.flag_pve_anomalies(numeric, numeric, numeric) to service_role;

-- =============================================================================
-- 5. 반환 잔액 계약(후속 클라 워커용) — RPC 응답의 재화 잔액 필드
-- =============================================================================
-- 모든 재화 RPC 는 이제 갱신된 잔액을 반환 jsonb 에 담는다. 클라는 save.credits/minerals 를
-- **표시 미러로 강등**하고, upsertProfile 에서 재화를 제외하며(컬럼은 서버 권위라 클라 write
-- 봉인됨 — 보내도 무시), 아래 필드로 로컬 미러를 동기화한다.
--
--   repair_defense(uuid)          → credits_left       : 정비 후 크레딧(기존 'credits' 도 병기).
--   spend_profile_currency(...)   → credits_left, minerals_left : OUT 파라미터(차감 후 잔액).
--       ↳ 이를 호출하는 5 RPC 는 그 값을 각자 'credits'/'minerals' 키로 반환(기존 계약 불변):
--         level_up_defense_unit · ascend_defense_unit · reroll_defense_unit_affixes ·
--         promote_defense_unit_rarity · craft_defense_unit.
--   apply_invasion_result(...)    → attacker_minerals_left : 복수 보너스 후 공격자 광물(없으면 null).
--                                    defender_credits_left  : 방어 보상 후 방어자 크레딧(없으면 null).
--                                    (기존 bonus_minerals·defense_credits 델타도 병기.)
--   apply_module_purchase(...)    → credits_left       : 구매 후 크레딧(기존 'credits' 도 병기).
--   salvage_core_module(uuid)     → credits_left       : 분해 환급 후 크레딧(기존 'credits' 도 병기).
--   flag_pve_anomalies(...)       → (재화 잔액 없음 — 이상치 계정 수 integer 반환, 읽기 전용).
--
-- 정본: public.profiles.credits / public.profiles.minerals (numeric, 서버 권위). save 안의
--   credits/minerals 는 이관 후 **표시 미러**일 뿐이며, 서버는 컬럼만 읽고 쓴다.
-- =============================================================================
