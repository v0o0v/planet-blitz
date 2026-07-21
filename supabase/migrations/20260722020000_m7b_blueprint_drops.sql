-- =============================================================================
-- M7b-acquisition — 설계도 획득 경로 (드랍 지급 · 제작 비용 · 침공 약탈 복제)
-- =============================================================================
-- 선행: 20260722000000_m7b_defense_units.sql(defense_blueprints · spend_* 헬퍼 · craft),
--       20260722010000_m7b_core_modules.sql(apply_invasion_result 최신본).
--
-- 이 마이그레이션이 더하는 것:
--   1. grant_blueprints(jsonb) — 행성 파밍으로 얻은 설계도 지급(정산 경로).
--   2. craft_defense_unit(smallint, integer) 재정의 — **설계도 + 희귀 광물**(기획 §4의
--      "반복 파밍의 천장값"). 20260722000000 판은 설계도만 받았다.
--   3. loot_defense_blueprint(uuid) — 침공 성공 시 낮은 확률로 상대 배치 방어체 1종의
--      **설계도를 복제**. ADR-0003 방어자 무손실: 방어자 데이터는 한 행도 바뀌지 않는다.
--   4. blueprint_raid_log — 약탈 복제 멱등 키(침공 1건당 최대 1회).
--
-- ★비용 미러(data/planets/blueprints.ts — 한쪽만 고치면 표기와 차감이 갈린다):
--     제작 설계도 = CRAFT_BLUEPRINT_COST      = 1
--     제작 광물   = CRAFT_MINERAL_COST        = 12   (보스 종류만 40)
--     약탈 확률   = RAID_BLUEPRINT_CP         = 1200 (12%)
--
-- ★트러스트 경계(정직한 서술): grant_blueprints 는 **클라가 부르는** 지급 RPC다. 현행 장비
--   드랍이 items_rw_own 으로 클라 직접 쓰기이고 서버는 pve_runs 샘플링으로 사후 검증하는
--   것과 같은 모델이라, 설계도만 더 엄격하게 만들 근거가 없다. 대신 호출 1회 상한(항목 8종·
--   장수 4)을 걸어 폭주를 막는다. 침공 약탈(3)은 반대로 **service_role 전용**이다 —
--   침공 결과는 서버 판정이므로 클라가 부를 이유가 없다.
--
-- ★결정론(ADR-0005) 무관: 어느 함수도 sim 재실행 입력에 닿지 않는다. 약탈 복제의 random()
--   은 게임플레이 재현 대상이 아닌 1회성 지급 판정이라(affix_seed 선례) 위반이 아니다.
--
-- 재실행 안전: create table/policy if [not] exists · create or replace function ·
--   search_path='' 고정 · 권한 재적용.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 드랍 지급 — grant_blueprints(jsonb)
-- -----------------------------------------------------------------------------
-- 입력: [{"kind":0,"catalogId":2,"count":1}, ...]
--   kind      = data/invasion/catalog.ts CATALOG_* (0 편대 / 1 설비 / 2 기물 / 3 보스)
--   catalogId = 종류 안의 배열 인덱스(append-only 계약)
-- 반환: {ok, granted}(지급 장수 합) 또는 {ok:false, code}.
create or replace function public.grant_blueprints(p_grants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_row     jsonb;
  v_kind    smallint;
  v_catalog integer;
  v_count   integer;
  v_total   integer := 0;
  v_rows    integer := 0;
begin
  if v_me is null then
    raise exception 'grant_blueprints: 로그인 필요';
  end if;
  if p_grants is null or jsonb_typeof(p_grants) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'bad-input');
  end if;
  -- 호출 1회 상한: 한 런이 낼 수 있는 종류 수를 넉넉히 덮으면서 폭주는 막는 값.
  if jsonb_array_length(p_grants) > 8 then
    return jsonb_build_object('ok', false, 'code', 'too-many');
  end if;

  for v_row in select * from jsonb_array_elements(p_grants)
  loop
    v_kind    := coalesce((v_row->>'kind')::smallint, -1);
    v_catalog := coalesce((v_row->>'catalogId')::integer, -1);
    v_count   := coalesce((v_row->>'count')::integer, 0);
    if v_kind < 0 or v_kind > 3 or v_catalog < 0 then
      return jsonb_build_object('ok', false, 'code', 'bad-catalog');
    end if;
    -- 장수 상한 4: 한 런에서 같은 설계도가 이보다 많이 나오는 경로가 없다.
    if v_count < 1 or v_count > 4 then
      return jsonb_build_object('ok', false, 'code', 'bad-count');
    end if;
    v_rows  := v_rows + 1;
    v_total := v_total + v_count;

    insert into public.defense_blueprints (profile_id, kind, catalog_id, count)
      values (v_me, v_kind, v_catalog, v_count)
      on conflict (profile_id, kind, catalog_id)
      do update set count = public.defense_blueprints.count + excluded.count;
  end loop;

  return jsonb_build_object('ok', true, 'granted', v_total, 'rows', v_rows);
end;
$$;

revoke all on function public.grant_blueprints(jsonb) from public;
revoke all on function public.grant_blueprints(jsonb) from anon;
grant execute on function public.grant_blueprints(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. 제작 재정의 — 설계도 + 희귀 광물
-- -----------------------------------------------------------------------------
-- 20260722000000 의 craft_defense_unit 은 설계도 1장만 받았다. 기획 §4 는 제작을 "반복
-- 파밍의 천장값"으로 두므로 희귀 광물을 함께 받는다 — 설계도만 쌓아도, 광물만 쌓아도
-- 못 만든다. 광물 부족이면 **설계도는 차감하지 않는다**(차감 순서: 광물 → 설계도).
create or replace function public.craft_defense_unit(p_kind smallint, p_catalog integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_have     integer;
  v_seed     bigint;
  v_id       uuid;
  v_minerals integer;
  v_spend    record;
begin
  if v_me is null then
    raise exception 'craft_defense_unit: 로그인 필요';
  end if;
  if p_kind < 0 or p_kind > 3 or p_catalog < 0 then
    return jsonb_build_object('ok', false, 'code', 'bad-catalog');
  end if;

  select count(*) into v_have from public.defense_units where profile_id = v_me;
  if v_have >= 60 then
    return jsonb_build_object('ok', false, 'code', 'storage-full');
  end if;

  -- data/planets/blueprints.ts craftMineralCost 미러(보스만 40).
  v_minerals := case when p_kind = 3 then 40 else 12 end;

  select * into v_spend from public.spend_profile_currency(v_me, 0, v_minerals);
  if not v_spend.ok then
    return jsonb_build_object('ok', false, 'code', 'insufficient-funds');
  end if;

  if not public.spend_blueprints(v_me, p_kind, p_catalog, 1) then
    -- 광물을 이미 깎았으므로 트랜잭션째 되돌린다(부분 차감 금지).
    raise exception 'craft_defense_unit: insufficient-blueprints'
      using errcode = 'check_violation';
  end if;

  v_seed := public.defense_unit_new_seed();
  insert into public.defense_units (profile_id, kind, catalog_id, level, ascension, affix_seed, rarity)
    values (v_me, p_kind, p_catalog, 1, 0, v_seed, 'normal')
    returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'unitId', v_id, 'affixSeed', v_seed,
    'minerals', v_spend.minerals_left, 'mineralCost', v_minerals
  );
end;
$$;

revoke all on function public.craft_defense_unit(smallint, integer) from public;
revoke all on function public.craft_defense_unit(smallint, integer) from anon;
grant execute on function public.craft_defense_unit(smallint, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. 약탈 복제 멱등 로그
-- -----------------------------------------------------------------------------
-- 침공 1건당 최대 1회. 재호출(EF 재시도)이 설계도를 두 번 주지 못하게 하는 유일한 근거다.
create table if not exists public.blueprint_raid_log (
  invasion_id uuid        primary key references public.invasions(id) on delete cascade,
  attacker_id uuid        not null references public.profiles(id) on delete cascade,
  kind        smallint,
  catalog_id  integer,
  granted     boolean     not null default false,
  created_at  timestamptz not null default now()
);

alter table public.blueprint_raid_log enable row level security;

-- 본인(공격자) 조회만. 쓰기 정책 부재 = 클라 직접 쓰기 원천 차단.
drop policy if exists blueprint_raid_log_select_own on public.blueprint_raid_log;
create policy blueprint_raid_log_select_own
  on public.blueprint_raid_log for select
  to authenticated
  using (auth.uid() = attacker_id);

-- -----------------------------------------------------------------------------
-- 4. 침공 약탈 복제 — loot_defense_blueprint(uuid)
-- -----------------------------------------------------------------------------
-- ADR-0003 방어자 무손실: 방어자의 defense_units·defense_blueprints·defenses 는 **읽기만**
-- 한다. 공격자에게 사본 1장이 생길 뿐이다.
--
-- 후보는 방어자가 실제로 **배치한** 방어체다(보유만 한 것은 대상 아님) — 배치 layout 의
-- l1.waveSlots / l2.sockets / l3.props / l3.boss 에서 (kind, catalogId) 를 모은다.
-- 코어 모듈은 카탈로그 참조가 아니라 소모성 인스턴스라 대상이 아니고, 수호 기체는 퇴역
-- 기체 복사본이라 설계도 개념이 없다.
create or replace function public.loot_defense_blueprint(p_invasion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv     record;
  v_layout  jsonb;
  v_pick    record;
  v_roll    integer;
begin
  -- 확정 상태 컬럼명은 `verified_status` 다(`status` 컬럼은 invasions 에 없다 —
  -- 20260717000000_m4_initial_schema.sql:334). 이름을 틀리면 plpgsql 이 실행 시점에
  -- "column does not exist" 로 터져 약탈 경로 전체가 죽는다.
  select id, attacker_id, defender_id, defense_id, verified_status, attacker_won
    into v_inv
    from public.invasions where id = p_invasion_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-invasion');
  end if;
  if v_inv.verified_status <> 'verified' or not coalesce(v_inv.attacker_won, false) then
    return jsonb_build_object('ok', false, 'code', 'not-a-win');
  end if;

  -- 멱등: 이미 판정된 침공이면 그때 결과를 그대로 되돌려 준다(재시도 안전).
  insert into public.blueprint_raid_log (invasion_id, attacker_id)
    values (p_invasion_id, v_inv.attacker_id)
    on conflict (invasion_id) do nothing;
  if not found then
    select kind, catalog_id, granted into v_pick
      from public.blueprint_raid_log where invasion_id = p_invasion_id;
    return jsonb_build_object(
      'ok', true, 'granted', coalesce(v_pick.granted, false),
      'kind', v_pick.kind, 'catalogId', v_pick.catalog_id, 'idempotent', true
    );
  end if;

  -- 확률 판정(RAID_BLUEPRINT_CP = 1200 → 12%). 재현 대상이 아닌 1회성 지급 판정이라
  -- random() 사용은 ADR-0005 와 무관하다.
  v_roll := floor(random() * 10000)::integer;
  if v_roll >= 1200 then
    return jsonb_build_object('ok', true, 'granted', false);
  end if;

  -- 후보 배치는 **침공이 실제로 상대한 방어 행**(invasions.defense_id 스냅샷)에서 읽는다.
  -- 방어자가 그 사이 배치를 바꿨어도 약탈 대상이 흔들리지 않는다. defense_id 가 null 로
  -- 끊긴 옛 행(on delete set null)만 방어자의 현재 활성 방어로 폴백한다. 프로필당 활성
  -- 방어는 유일하므로(defenses_one_active_idx) 다중 행 모호성이 없다.
  if v_inv.defense_id is not null then
    select layout into v_layout from public.defenses where id = v_inv.defense_id;
  else
    select layout into v_layout from public.defenses
      where profile_id = v_inv.defender_id and active;
  end if;
  if v_layout is null then
    return jsonb_build_object('ok', true, 'granted', false, 'code', 'no-layout');
  end if;

  -- 배치된 방어체 (kind, catalogId) 후보를 한 집합으로 모으고 하나만 뽑는다.
  select kind, catalog_id into v_pick
  from (
    select 0::smallint as kind, (s->>'catalogId')::integer as catalog_id
      from jsonb_array_elements(coalesce(v_layout->'l1'->'waveSlots', '[]'::jsonb)) s
      where jsonb_typeof(s) = 'object'
    union all
    select 1::smallint, (s->>'catalogId')::integer
      from jsonb_array_elements(coalesce(v_layout->'l2'->'sockets', '[]'::jsonb)) s
      where jsonb_typeof(s) = 'object'
    union all
    select 2::smallint, (s->>'catalogId')::integer
      from jsonb_array_elements(coalesce(v_layout->'l3'->'props', '[]'::jsonb)) s
      where jsonb_typeof(s) = 'object'
    union all
    select 3::smallint, (v_layout->'l3'->'boss'->>'catalogId')::integer
      where jsonb_typeof(v_layout->'l3'->'boss') = 'object'
  ) cand
  where catalog_id is not null and catalog_id >= 0
  order by random()
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'granted', false, 'code', 'empty-layout');
  end if;

  insert into public.defense_blueprints (profile_id, kind, catalog_id, count)
    values (v_inv.attacker_id, v_pick.kind, v_pick.catalog_id, 1)
    on conflict (profile_id, kind, catalog_id)
    do update set count = public.defense_blueprints.count + 1;

  update public.blueprint_raid_log
    set kind = v_pick.kind, catalog_id = v_pick.catalog_id, granted = true
    where invasion_id = p_invasion_id;

  return jsonb_build_object(
    'ok', true, 'granted', true, 'kind', v_pick.kind, 'catalogId', v_pick.catalog_id
  );
end;
$$;

-- 침공 결과는 서버 판정이므로 클라가 부를 이유가 없다 — service_role 전용.
revoke all on function public.loot_defense_blueprint(uuid) from public;
revoke all on function public.loot_defense_blueprint(uuid) from anon;
revoke all on function public.loot_defense_blueprint(uuid) from authenticated;
grant execute on function public.loot_defense_blueprint(uuid) to service_role;
