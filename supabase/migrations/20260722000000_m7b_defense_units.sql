-- =============================================================================
-- Planet Blitz M7b — 방어체 인벤토리 + 설계도 + 강화 3축(레벨·승급·방어체 어픽스 리롤)
-- =============================================================================
-- 근거: .omc/plans/invasion-3layer-redesign.md §4(방어체 경제) ·
--   .omc/plans/invasion-3layer-impl-lanes.md "M7b-inventory" · ADR-0005(결정론) ·
--   ADR-0012(효력은 스냅샷 고정, 차감은 서버 확정).
--
-- 담는 것:
--   1. defense_units — 유저 소유 방어체 보관함. **어픽스를 저장하지 않는다**: 정수 5필드
--      (kind·catalog_id·level·ascension·affix_seed·rarity)만 갖고, 방어체 어픽스는 클라·EF 가
--      src/items/rollDefenseUnit.ts 로 시드에서 재구성한다. 위조할 스탯 필드가 애초에 없다.
--   2. defense_blueprints — 중복 설계도 보유(승급·등급 승급·제작 재료). (profile_id,kind,catalog_id) 유일.
--   3. 강화 RPC 4종 — level_up_defense_unit / ascend_defense_unit /
--      reroll_defense_unit_affixes / promote_defense_unit_rarity + craft_defense_unit.
--      재화 차감은 전부 서버 권위(profiles.save->>'credits' / ->>'minerals').
--
-- ★RLS 규율(defense_cards 패턴 복제): **본인 select 만**. insert/update/delete 정책 **부재** =
--   클라 직접 쓰기 원천 차단. 생성·강화·차감은 전부 security definer RPC(또는 service_role).
--
-- ★비용 산식은 data/defenseUnits.ts 미러다(계약 결속 — 한쪽만 고치면 표기와 차감이 갈린다):
--     레벨업 크레딧 = round((60 + 24×(from-1)) × (10000 + 3000×등급랭크) / 10000)
--     레벨업 광물   = from < 20 ? 0 : floor((from-20)/10) + 1
--     승급 설계도   = {1,2,3,5,8}[from],  승급 크레딧 = 400×(from+1)
--     리롤 광물     = 10 + 8×등급랭크 + 3×등급어픽스상한{0,2,4,5}
--     등급승급 설계도 = {4,8,16}[등급랭크]   (unique 는 상위 없음 — nextRarityUp 사다리)
--   등급랭크 = RARITY_CODE(src/items/types.ts): normal 0 / magic 1 / rare 2 / unique 3.
--   JS Math.round 와 Postgres round(numeric) 는 양수 구간에서 동일(half-up)하다.
--
-- ★affix_seed 는 **서버가 부여**한다(리롤 결과를 클라가 미리 고를 수 없게). 시드는 게임플레이
--   결정론의 입력일 뿐 재현 대상이 아니므로 서버 난수로 뽑아도 ADR-0005 를 위반하지 않는다 —
--   일단 확정되면 그 시드로 클라·EF 가 바이트 동일 어픽스를 재구성한다.
--
-- 재실행 안전: create table/index/policy if [not] exists · drop policy if exists → create ·
--   create or replace function · search_path='' 고정 · 권한 재적용.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. 공용 — 등급 랭크(RARITY_CODE 미러)
-- -----------------------------------------------------------------------------
create or replace function public.defense_unit_rarity_rank(p_rarity text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_rarity
           when 'normal' then 0
           when 'magic'  then 1
           when 'rare'   then 2
           when 'unique' then 3
           else 0
         end;
$$;

-- 등급별 방어체 어픽스 상한(DEFENSE_UNIT_AFFIX_RANGE 의 max — 리롤 비용 입력).
create or replace function public.defense_unit_affix_cap(p_rarity text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_rarity
           when 'normal' then 0
           when 'magic'  then 2
           when 'rare'   then 4
           when 'unique' then 5
           else 0
         end;
$$;

-- uint32 난수 시드(어픽스 시드 부여용). random() 은 게임플레이 재현 대상이 아니다(위 주석).
create or replace function public.defense_unit_new_seed()
returns bigint
language sql
volatile
set search_path = ''
as $$
  select floor(random() * 4294967296)::bigint;
$$;

-- -----------------------------------------------------------------------------
-- 1. defense_units — 방어체 보관함(서버 전용 쓰기)
-- -----------------------------------------------------------------------------
-- kind = data/invasion/catalog.ts CATALOG_* (0 편대 / 1 설비 / 2 기물 / 3 보스).
--   맵 템플릿(4)은 소유·강화 대상이 아니라 제외한다.
-- level/ascension/rarity 도메인은 src/sim/invasion/constants.ts 와 동일(1..99 / 0..5 / 4등급).
-- affix_seed 는 uint32 — bigint 로 담아 부호 문제를 없앤다(정수 그대로 클라에 전달).
create table if not exists public.defense_units (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  kind        smallint    not null check (kind between 0 and 3),
  catalog_id  integer     not null check (catalog_id >= 0),
  level       integer     not null default 1 check (level between 1 and 99),
  ascension   integer     not null default 0 check (ascension between 0 and 5),
  affix_seed  bigint      not null check (affix_seed between 0 and 4294967295),
  rarity      text        not null check (rarity in ('normal', 'magic', 'rare', 'unique')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists defense_units_profile_idx
  on public.defense_units (profile_id, created_at desc);
create index if not exists defense_units_profile_kind_idx
  on public.defense_units (profile_id, kind, catalog_id);

alter table public.defense_units enable row level security;

-- 읽기: 본인 방어체만(보관함·배치 편집기). 쓰기 정책 **부재** → 클라 직접 insert/update/delete
-- 불가(레벨·승급·등급·시드 위조 차단). security definer RPC / service_role 만 기록한다.
drop policy if exists defense_units_select_own on public.defense_units;
create policy defense_units_select_own
  on public.defense_units for select
  to authenticated
  using (auth.uid() = profile_id);

create or replace trigger trg_defense_units_updated_at
  before update on public.defense_units
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. defense_blueprints — 중복 설계도 보유
-- -----------------------------------------------------------------------------
-- 승급(축 ②)·등급 승급·제작의 재료. 종류+카탈로그 조합당 1행에 장수를 센다.
create table if not exists public.defense_blueprints (
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  kind        smallint    not null check (kind between 0 and 3),
  catalog_id  integer     not null check (catalog_id >= 0),
  count       integer     not null default 0 check (count >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, kind, catalog_id)
);

alter table public.defense_blueprints enable row level security;

drop policy if exists defense_blueprints_select_own on public.defense_blueprints;
create policy defense_blueprints_select_own
  on public.defense_blueprints for select
  to authenticated
  using (auth.uid() = profile_id);

create or replace trigger trg_defense_blueprints_updated_at
  before update on public.defense_blueprints
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. 재화 차감 헬퍼 — profiles.save 의 credits/minerals(repair_defense 와 동일 정본)
-- -----------------------------------------------------------------------------
-- 프로필 행을 잠그고(lost-update 차단) 잔액을 확인한 뒤 차감한다. 부족하면 false 를 돌려주고
-- 아무것도 쓰지 않는다(호출 RPC 가 code 로 사유를 만든다).
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
  select coalesce((save->>'credits')::numeric, 0),
         coalesce((save->>'minerals')::numeric, 0)
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
    set save = jsonb_set(
                 jsonb_set(save, '{credits}',  to_jsonb(credits_left),  true),
                 '{minerals}', to_jsonb(minerals_left), true)
    where id = p_profile;
  ok := true;
end;
$$;

revoke all on function public.spend_profile_currency(uuid, integer, integer) from public;
revoke all on function public.spend_profile_currency(uuid, integer, integer) from anon;
revoke all on function public.spend_profile_currency(uuid, integer, integer) from authenticated;
grant execute on function public.spend_profile_currency(uuid, integer, integer) to service_role;

-- 설계도 차감(부족하면 false, 아무것도 쓰지 않음).
create or replace function public.spend_blueprints(
  p_profile uuid, p_kind smallint, p_catalog integer, p_count integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_have integer;
begin
  select count into v_have from public.defense_blueprints
    where profile_id = p_profile and kind = p_kind and catalog_id = p_catalog
    for update;
  if not found or v_have < p_count then
    return false;
  end if;
  update public.defense_blueprints set count = v_have - p_count
    where profile_id = p_profile and kind = p_kind and catalog_id = p_catalog;
  return true;
end;
$$;

revoke all on function public.spend_blueprints(uuid, smallint, integer, integer) from public;
revoke all on function public.spend_blueprints(uuid, smallint, integer, integer) from anon;
revoke all on function public.spend_blueprints(uuid, smallint, integer, integer) from authenticated;
grant execute on function public.spend_blueprints(uuid, smallint, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 4. 축 ① 레벨업 — 크레딧 + 광물
-- -----------------------------------------------------------------------------
-- data/defenseUnits.ts defenseUnitLevelUpCost 미러.
create or replace function public.defense_unit_level_cost(p_rarity text, p_from integer)
returns table (credits integer, minerals integer)
language sql
immutable
set search_path = ''
as $$
  select
    round(
      ((60 + 24 * (p_from - 1))::numeric
       * (10000 + 3000 * public.defense_unit_rarity_rank(p_rarity))::numeric) / 10000
    )::integer,
    case when p_from < 20 then 0 else floor((p_from - 20) / 10)::integer + 1 end;
$$;

create or replace function public.level_up_defense_unit(p_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_unit  public.defense_units%rowtype;
  v_cost  record;
  v_spend record;
begin
  if v_me is null then
    raise exception 'level_up_defense_unit: 로그인 필요';
  end if;

  select * into v_unit from public.defense_units
    where id = p_unit_id and profile_id = v_me for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-owned');
  end if;
  if v_unit.level >= 99 then
    return jsonb_build_object('ok', false, 'code', 'max-level');
  end if;

  select * into v_cost from public.defense_unit_level_cost(v_unit.rarity, v_unit.level);
  select * into v_spend from public.spend_profile_currency(v_me, v_cost.credits, v_cost.minerals);
  if not v_spend.ok then
    return jsonb_build_object(
      'ok', false,
      'code', case when v_spend.credits_left < v_cost.credits
                   then 'insufficient-credits' else 'insufficient-minerals' end
    );
  end if;

  update public.defense_units set level = v_unit.level + 1 where id = p_unit_id;

  return jsonb_build_object(
    'ok', true, 'level', v_unit.level + 1,
    'credits', v_spend.credits_left, 'minerals', v_spend.minerals_left
  );
end;
$$;

revoke all on function public.level_up_defense_unit(uuid) from public;
revoke all on function public.level_up_defense_unit(uuid) from anon;
grant execute on function public.level_up_defense_unit(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. 축 ② 승급 — 중복 설계도 + 크레딧 (외형 변화 신호)
-- -----------------------------------------------------------------------------
-- data/defenseUnits.ts ASCEND_BLUEPRINT_COST / ASCEND_CREDIT_PER_STEP 미러.
create or replace function public.defense_unit_ascend_cost(p_from integer)
returns table (credits integer, blueprints integer)
language sql
immutable
set search_path = ''
as $$
  select 400 * (p_from + 1),
         (array[1, 2, 3, 5, 8])[p_from + 1];
$$;

create or replace function public.ascend_defense_unit(p_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_unit  public.defense_units%rowtype;
  v_cost  record;
  v_spend record;
begin
  if v_me is null then
    raise exception 'ascend_defense_unit: 로그인 필요';
  end if;

  select * into v_unit from public.defense_units
    where id = p_unit_id and profile_id = v_me for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-owned');
  end if;
  if v_unit.ascension >= 5 then
    return jsonb_build_object('ok', false, 'code', 'max-ascension');
  end if;

  select * into v_cost from public.defense_unit_ascend_cost(v_unit.ascension);

  -- 설계도를 먼저 차감한다. 크레딧이 모자라면 아래에서 exception 을 던져 트랜잭션째 되돌린다
  -- (부분 차감 방지 — 함수 전체가 하나의 트랜잭션이다).
  if not public.spend_blueprints(v_me, v_unit.kind, v_unit.catalog_id, v_cost.blueprints) then
    return jsonb_build_object('ok', false, 'code', 'insufficient-blueprints');
  end if;

  select * into v_spend from public.spend_profile_currency(v_me, v_cost.credits, 0);
  if not v_spend.ok then
    -- 설계도 차감을 되돌리기 위해 트랜잭션을 중단한다(호출 측은 sqlstate 로 사유를 받는다).
    raise exception 'insufficient-credits' using errcode = 'check_violation';
  end if;

  update public.defense_units set ascension = v_unit.ascension + 1 where id = p_unit_id;

  return jsonb_build_object(
    'ok', true, 'ascension', v_unit.ascension + 1,
    'credits', v_spend.credits_left, 'minerals', v_spend.minerals_left
  );
end;
$$;

revoke all on function public.ascend_defense_unit(uuid) from public;
revoke all on function public.ascend_defense_unit(uuid) from anon;
grant execute on function public.ascend_defense_unit(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. 축 ③ 방어체 어픽스 리롤 — 광물 (서버가 새 시드 부여)
-- -----------------------------------------------------------------------------
-- data/defenseUnits.ts defenseUnitRerollCost 미러(등급만의 함수 — DB 는 어픽스를 저장하지 않는다).
create or replace function public.defense_unit_reroll_cost(p_rarity text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select 10 + 8 * public.defense_unit_rarity_rank(p_rarity)
          + 3 * public.defense_unit_affix_cap(p_rarity);
$$;

create or replace function public.reroll_defense_unit_affixes(p_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_unit  public.defense_units%rowtype;
  v_cost  integer;
  v_spend record;
  v_seed  bigint;
begin
  if v_me is null then
    raise exception 'reroll_defense_unit_affixes: 로그인 필요';
  end if;

  select * into v_unit from public.defense_units
    where id = p_unit_id and profile_id = v_me for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-owned');
  end if;
  if public.defense_unit_affix_cap(v_unit.rarity) = 0 then
    -- 노말은 어픽스 슬롯이 없다 — 광물만 태우는 조작을 막는다.
    return jsonb_build_object('ok', false, 'code', 'no-affix-slots');
  end if;

  v_cost := public.defense_unit_reroll_cost(v_unit.rarity);
  select * into v_spend from public.spend_profile_currency(v_me, 0, v_cost);
  if not v_spend.ok then
    return jsonb_build_object('ok', false, 'code', 'insufficient-minerals');
  end if;

  v_seed := public.defense_unit_new_seed();
  update public.defense_units set affix_seed = v_seed where id = p_unit_id;

  return jsonb_build_object(
    'ok', true, 'affixSeed', v_seed,
    'credits', v_spend.credits_left, 'minerals', v_spend.minerals_left
  );
end;
$$;

revoke all on function public.reroll_defense_unit_affixes(uuid) from public;
revoke all on function public.reroll_defense_unit_affixes(uuid) from anon;
grant execute on function public.reroll_defense_unit_affixes(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. 등급 승급 — 중복 설계도(Rarity 사다리 normal→magic→rare→unique)
-- -----------------------------------------------------------------------------
-- data/defenseUnits.ts RARITY_UP_BLUEPRINT_COST / nextRarityUp 미러. unique 는 상위가 없다.
create or replace function public.defense_unit_next_rarity(p_rarity text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_rarity
           when 'normal' then 'magic'
           when 'magic'  then 'rare'
           when 'rare'   then 'unique'
           else null
         end;
$$;

create or replace function public.promote_defense_unit_rarity(p_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_unit  public.defense_units%rowtype;
  v_next  text;
  v_cost  integer;
  v_seed  bigint;
begin
  if v_me is null then
    raise exception 'promote_defense_unit_rarity: 로그인 필요';
  end if;

  select * into v_unit from public.defense_units
    where id = p_unit_id and profile_id = v_me for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-owned');
  end if;

  v_next := public.defense_unit_next_rarity(v_unit.rarity);
  if v_next is null then
    return jsonb_build_object('ok', false, 'code', 'max-rarity');
  end if;

  v_cost := (array[4, 8, 16])[public.defense_unit_rarity_rank(v_unit.rarity) + 1];
  if not public.spend_blueprints(v_me, v_unit.kind, v_unit.catalog_id, v_cost) then
    return jsonb_build_object('ok', false, 'code', 'insufficient-blueprints');
  end if;

  -- 등급이 오르면 어픽스 수 범위가 넓어지므로 새 시드로 재롤한다(promoteDefenseUnitRarity 미러).
  v_seed := public.defense_unit_new_seed();
  update public.defense_units set rarity = v_next, affix_seed = v_seed where id = p_unit_id;

  return jsonb_build_object('ok', true, 'rarity', v_next, 'affixSeed', v_seed);
end;
$$;

revoke all on function public.promote_defense_unit_rarity(uuid) from public;
revoke all on function public.promote_defense_unit_rarity(uuid) from anon;
grant execute on function public.promote_defense_unit_rarity(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. 제작 — 설계도 1장 → 방어체 1기(노말 lv1 승급0)
-- -----------------------------------------------------------------------------
-- 보관함 상한(DEFENSE_UNIT_STORAGE_CAP = 60)은 서버가 강제한다.
create or replace function public.craft_defense_unit(p_kind smallint, p_catalog integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_have integer;
  v_seed bigint;
  v_id   uuid;
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

  if not public.spend_blueprints(v_me, p_kind, p_catalog, 1) then
    return jsonb_build_object('ok', false, 'code', 'insufficient-blueprints');
  end if;

  v_seed := public.defense_unit_new_seed();
  insert into public.defense_units (profile_id, kind, catalog_id, level, ascension, affix_seed, rarity)
    values (v_me, p_kind, p_catalog, 1, 0, v_seed, 'normal')
    returning id into v_id;

  return jsonb_build_object('ok', true, 'unitId', v_id, 'affixSeed', v_seed);
end;
$$;

revoke all on function public.craft_defense_unit(smallint, integer) from public;
revoke all on function public.craft_defense_unit(smallint, integer) from anon;
grant execute on function public.craft_defense_unit(smallint, integer) to authenticated, service_role;

-- 읽기 전용 비용 조회 함수는 클라 표기 대조용으로 열어 둔다(쓰기 없음).
grant execute on function public.defense_unit_rarity_rank(text) to authenticated, service_role;
grant execute on function public.defense_unit_affix_cap(text) to authenticated, service_role;
grant execute on function public.defense_unit_level_cost(text, integer) to authenticated, service_role;
grant execute on function public.defense_unit_ascend_cost(integer) to authenticated, service_role;
grant execute on function public.defense_unit_reroll_cost(text) to authenticated, service_role;
grant execute on function public.defense_unit_next_rarity(text) to authenticated, service_role;
