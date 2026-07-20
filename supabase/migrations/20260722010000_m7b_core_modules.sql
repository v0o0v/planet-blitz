-- =============================================================================
-- Planet Blitz M7b — 방어 카드 → 코어 모듈 개명·재배선 (ADR-0018)
-- =============================================================================
-- 근거: ADR-0018(방어 카드 시스템 폐지, 코어 모듈로 흡수) · ADR-0012(효력은 begin_invasion
--   스냅샷 고정, 차감은 apply_invasion_result 확정 시) · 침공 3레이어 기획 §4(방어체 경제)
--   · 레인 문서 M7b-core-modules.
--
-- ▮ 개명 원칙 — 표시 문자열과 wire 필드명을 분리한다(ADR-0005)
--   개명 대상: 테이블·컬럼·RPC·EF 이름, TypeScript 심볼, 표시 문자열.
--   개명 금지(wire 고정): 모듈 인스턴스 jsonb 의 **내부 키**
--     (id·rarity·prefixes·suffixes·uniqueId·chargesMax·chargesLeft·seed, 롤의 id·stat·value)와
--     build_attacker_matchup 이 만드는 매치업 키(fire·cold·lightning·beam·attackerCp·
--     defenderCp·revenge·reinvasion·subweaponHeavy).
--   → 이 마이그레이션은 **컨테이너(테이블/컬럼/함수)만 개명**하고 jsonb 내부 키는 한 글자도
--     건드리지 않는다. sim 해시 스트림에 접히는 값(layers)도 무수정이다.
--
-- ▮ rename 이 아니라 신규 테이블 + 구 경로 폐기
--   Edge Function 은 이름(`cards`)에 결속돼 있어 alter table rename 으로는 갈아끼울 수 없다.
--   그래서 신규 테이블(core_modules·module_shop_purchases) + 신규 EF(`modules`) 를 세우고,
--   구 경로(defense_cards·card_shop_purchases·apply_card_*·salvage_card·defenses.
--   equipped_card_id·invasion_snapshots.card_id)는 이 파일 말미에서 **폐기**한다. 미출시
--   전제라 데이터 이관은 하지 않는다(카드 보유분은 소멸).
--
-- 담는 것:
--   1. core_modules — 유저 소유 코어 모듈 보관함(jsonb ModuleInstance + rarity/charges_left).
--      RLS 는 본인 select 만 — 쓰기 정책 부재 = 클라 직접 쓰기 원천 차단.
--   2. module_shop_purchases — (profile, dateSeed, slotIndex) 유니크로 중복 구매 차단.
--   3. defenses.equipped_module_ids uuid[] — 코어 강화 슬롯 2. **고정 길이 + null 허용,
--      밀집화 금지**(슬롯 i ↔ 표시 i). guard_defenses_equipped_modules 가 소유·슬롯 수·중복 검증.
--   4. invasion_snapshots.module_ids uuid[] — 스냅샷이 고정한 차감 대상 모듈 참조.
--   5. begin_invasion v5 — authority.modules = {instances, matchup}(구 authority.card 폐지).
--      **20260721000000:425 본문 전수 보존** + 카드 블록만 모듈 블록으로 치환.
--   6. apply_invasion_result — **20260721000000:556 본문 전수 보존** + 카드 차감 블록을 모듈
--      차감으로 치환 + 방어 성공 크레딧 정액 지급 추가.
--   7. apply_module_purchase / apply_module_fusion / salvage_core_module — 구 카드 RPC 3종 계승
--      (apply_card_drop 은 **계승하지 않는다** — 코어 모듈 드랍 폐지).
--   8. 구 경로 폐기(drop).
--
-- ▮ 방어 성공 보조 보상 = 크레딧 정액(기획 §4, ADR-0018)
--   구 경로는 "방어 성공 → 확률 카드 드랍"(defenseSuccessDropChance·DEFENSE_DROP_BASE_CHANCE·
--   apply_card_drop)이었다. 방어 실적이 방어체 획득 경로가 되면 상위권 부익부가 커지므로
--   폐지하고, apply_invasion_result 가 방어자에게 40 크레딧을 정액 지급한다(무작위 없음 →
--   멱등, 재현 검증 불요).
--
-- ★봉인 가드 무수정 계약(PR#29/#35 교훈): begin_invasion·apply_invasion_result 를 create or
--   replace 할 때 원본 본문(자격 검증·self-invasion 3중 가드·락 순서·쿨다운·격차 30 스왑 예외·
--   복수 보너스·복제 약탈·revoke/grant)을 **전부 그대로 보존**하고 지정 블록만 치환한다.
--
-- 재실행 안전: create table if not exists · drop policy if exists → create · add column if not
--   exists · create or replace function · drop ... if exists · search_path='' 고정 · 권한 재적용.
-- 원격 적용은 하지 말 것(리포 마이그레이션만).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. core_modules — 유저 코어 모듈 보관함(서버 전용 쓰기)
-- -----------------------------------------------------------------------------
-- module 은 ModuleInstance 직렬화 계약(data/coreModules.ts — id·rarity·prefixes·suffixes·
-- uniqueId?·chargesMax·chargesLeft·seed)을 jsonb 로 그대로 담는다. rarity·charges_left 는
-- 조회·차감·상한 판정을 위한 최소 정규 컬럼(값은 module jsonb 와 일치해야 하며 서버가 함께
-- 기록한다). 클라이언트는 select 만 — 생성·차감·분해·합성은 전부 서버 경로.
create table if not exists public.core_modules (
  id            uuid        primary key default gen_random_uuid(),
  profile_id    uuid        not null references public.profiles(id) on delete cascade,
  module        jsonb       not null,
  rarity        text        not null check (rarity in ('normal', 'magic', 'rare', 'unique')),
  charges_left  integer     not null check (charges_left >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists core_modules_profile_idx on public.core_modules (profile_id, created_at desc);

alter table public.core_modules enable row level security;

-- 읽기: 본인 모듈만(보관함·상점·합성 UI). 쓰기 정책 **부재** → 클라 직접 insert/update/delete
-- 불가(생성·차감·분해·합성 위조 차단). 서버 RPC/EF(service_role)만 RLS 우회로 기록한다.
drop policy if exists core_modules_select_own on public.core_modules;
create policy core_modules_select_own
  on public.core_modules for select
  to authenticated
  using (auth.uid() = profile_id);

create or replace trigger trg_core_modules_updated_at
  before update on public.core_modules
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. module_shop_purchases — 같은 날 같은 슬롯 중복 구매 차단 기록
-- -----------------------------------------------------------------------------
-- date_seed = shopDateSeedFromMs(UTC 일 인덱스), slot_index = 로테이션 슬롯. 복합 PK 가 중복
-- 구매를 원자 차단한다(apply_module_purchase 가 unique_violation 을 already-bought 로 흡수).
create table if not exists public.module_shop_purchases (
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  date_seed   bigint      not null,
  slot_index  integer     not null,
  created_at  timestamptz not null default now(),
  primary key (profile_id, date_seed, slot_index)
);

alter table public.module_shop_purchases enable row level security;

drop policy if exists module_shop_purchases_select_own on public.module_shop_purchases;
create policy module_shop_purchases_select_own
  on public.module_shop_purchases for select
  to authenticated
  using (auth.uid() = profile_id);

-- -----------------------------------------------------------------------------
-- 3. defenses.equipped_module_ids — 코어 강화 슬롯 2(장착만 클라, 트리거 검증)
-- -----------------------------------------------------------------------------
-- 슬롯 배열은 **고정 길이 2 + null 허용**이 규약이지만, postgres uuid[] 는 길이가 가변이므로
-- 상한(2)만 강제하고 짧은 배열은 뒤가 빈 것으로 본다(클라 net 계층이 고정 길이로 정규화).
-- 장착 자체는 방어자 배치 결정이라 클라가 defenses_rw_own update 로 바꿀 수 있고, 아래 트리거가
-- **자기 소유 모듈만·2개 이내·중복 없음**을 강제한다. 사용 횟수는 서버만 만진다(ADR-0012).
alter table public.defenses
  add column if not exists equipped_module_ids uuid[] not null default '{}'::uuid[];

create or replace function public.guard_defenses_equipped_modules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_len   integer;
  v_uniq  integer;
  v_owned integer;
begin
  if new.equipped_module_ids is null then
    new.equipped_module_ids := '{}'::uuid[];
    return new;
  end if;

  -- null 요소(빈 슬롯)는 제거해 소유 검증 대상에서 뺀다 — 배열 길이는 상한만 본다.
  new.equipped_module_ids := array(
    select x from unnest(new.equipped_module_ids) x where x is not null
  );

  v_len := coalesce(array_length(new.equipped_module_ids, 1), 0);
  -- 슬롯 수 상한 2(src/sim/invasion/constants.ts INVASION_CORE_MODULE_SLOTS ·
  -- data/coreModules.ts MODULE_EQUIP_SLOTS 미러 — 세 곳이 함께 움직여야 한다).
  if v_len > 2 then
    raise exception 'defenses: 코어 모듈 슬롯은 최대 2개 (요청 %)', v_len
      using errcode = 'check_violation';
  end if;

  if v_len > 0 then
    select count(distinct x) into v_uniq from unnest(new.equipped_module_ids) x;
    if v_uniq <> v_len then
      raise exception 'defenses: 같은 코어 모듈을 두 슬롯에 장착할 수 없음'
        using errcode = 'check_violation';
    end if;

    select count(*) into v_owned
      from public.core_modules c
      where c.id = any(new.equipped_module_ids) and c.profile_id = new.profile_id;
    if v_owned <> v_len then
      raise exception 'defenses: 소유하지 않은 코어 모듈은 장착 불가'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger trg_defenses_equipped_modules
  before insert or update on public.defenses
  for each row execute function public.guard_defenses_equipped_modules();

-- -----------------------------------------------------------------------------
-- 4. invasion_snapshots.module_ids — 스냅샷이 고정한 차감 대상 모듈 참조
-- -----------------------------------------------------------------------------
-- 효력(모듈 롤 + 매치업)은 authority->'modules' jsonb 에 T0 불변 고정된다(ADR-0012).
-- module_ids 는 apply_invasion_result 확정 시 **어느 행을 차감할지**의 참조다(효력 고정과 차감
-- 대상 참조를 분리 — 모듈이 소진 삭제돼도 스냅샷 효력은 유효). FK 를 걸지 않는 이유는 배열
-- 컬럼이라 on delete set null 이 불가능하기 때문이며, 차감 시 존재 여부를 다시 확인한다.
alter table public.invasion_snapshots
  add column if not exists module_ids uuid[] not null default '{}'::uuid[];

-- -----------------------------------------------------------------------------
-- 5. begin_invasion v5 — authority = {layers, maintenance, modules{instances,matchup}}
-- -----------------------------------------------------------------------------
-- ★ 20260721000000:425 본문(auth.uid() 게이트·self-invasion raise·대상 자격 검증(active·
--   my_rank·def placed·rank 격차)·수호 권위 주입·insert 컬럼·search_path=''·revoke/grant)을
--   **전부 그대로 보존**하고 아래만 바꾼다:
--     ⓐ 구 카드 권위 블록(v_card_json/v_card_id/v_card_config, authority.card) **삭제**.
--     ⓑ authority.modules 를 `{'slots': layers.l3.modules, ...}`(M7a 잔재)에서
--        `{'instances': [ModuleInstance...], 'matchup': ...}` 로 교체. 장착 모듈은 배치 layers
--        가 아니라 defenses.equipped_module_ids 가 정본이다 — 모듈은 소모성 인스턴스라
--        카탈로그 참조(catalogId/level/ascension)로 표현되지 않기 때문이다.
--        (layers.l3.modules 슬롯은 스키마에 남아 있으나 M7b 에서 사용하지 않는다.)
create or replace function public.begin_invasion(p_defense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me          uuid := auth.uid();
  v_def         public.defenses%rowtype;
  v_layers      jsonb;
  v_snap_id     uuid;
  v_my_rank     integer;
  v_def_rank    integer;
  v_def_placed  boolean;
  v_module_ids  uuid[] := '{}'::uuid[];
  v_instances   jsonb  := '[]'::jsonb;
  v_modules     jsonb;
  v_authority   jsonb;
begin
  -- 호출자 게이트는 auth.uid() 로 직접(definer 라 is_service_role() 은 항상 true — 사용 금지).
  if v_me is null then
    raise exception 'begin_invasion: 로그인 필요';
  end if;

  select * into v_def from public.defenses where id = p_defense_id;
  if not found then
    raise exception 'begin_invasion: 방어 기지를 찾을 수 없음 (%)', p_defense_id;
  end if;

  -- 자기 침공 금지(definer 컨텍스트에서 가드 트리거의 self-invasion raise 가 스킵되므로 자체
  -- 차단 필수 — 자기 빈 방어 스냅샷 파밍 경로 봉쇄).
  if v_def.profile_id = v_me then
    raise exception 'self-invasion is not allowed (attacker = defender)'
      using errcode = 'check_violation';
  end if;

  -- (리뷰 MED) 대상 자격 검증 — get_invasion_targets 후보 규칙과 정합. 매치메이킹 범위 밖
  -- (비활성·미배치·상위 랭커) defense 의 라이브 수호 구성 스카우팅을 차단한다.
  if not v_def.active then
    raise exception 'begin_invasion: 비활성 방어는 침공 대상이 아님 (%)', p_defense_id
      using errcode = 'check_violation';
  end if;
  select l.rank into v_my_rank from public.ladder l where l.profile_id = v_me;
  if v_my_rank is null then
    raise exception 'begin_invasion: 공격자가 순위에 없음(배치전 미완료)'
      using errcode = 'check_violation';
  end if;
  select l.rank, l.placed into v_def_rank, v_def_placed
    from public.ladder l where l.profile_id = v_def.profile_id;
  if v_def_rank is null or v_def_placed is not true then
    raise exception 'begin_invasion: 대상이 순위에 배치되지 않음'
      using errcode = 'check_violation';
  end if;
  if v_def_rank >= v_my_rank then
    raise exception 'begin_invasion: 매치메이킹 범위 밖(상위/동급 랭크) 대상은 침공 불가'
      using errcode = 'check_violation';
  end if;

  -- T0 권위 고정: L3 수호 슬롯의 성능%·계보 보너스·마일스톤·스냅샷을 라이브 값으로 접는다.
  v_layers := public.inject_guardian_authority(v_def.layout, v_def.profile_id);

  -- ▮ 코어 모듈 권위 고정(ADR-0012·ADR-0018): 장착 슬롯의 모듈 인스턴스(롤 jsonb)를 T0 에
  --   불변 고정한다. 잔여 횟수(charges_left)가 0 인 행은 애초에 삭제되므로 별도 필터가 없고,
  --   장착 검증은 guard_defenses_equipped_modules 가 이미 통과시킨 상태다. 슬롯 순서는
  --   equipped_module_ids 배열 순서를 그대로 따른다(효과는 합산이라 순서가 결과를 바꾸지
  --   않지만, 표시·감사 일관성을 위해 보존한다).
  v_module_ids := coalesce(v_def.equipped_module_ids, '{}'::uuid[]);
  if array_length(v_module_ids, 1) is not null then
    select coalesce(jsonb_agg(c.module order by t.ord), '[]'::jsonb)
      into v_instances
      from unnest(v_module_ids) with ordinality as t(mid, ord)
      join public.core_modules c on c.id = t.mid and c.profile_id = v_def.profile_id;
    -- 조회에서 빠진 id(경합 삭제 등)는 차감 대상에서도 빼 둔다(고아 참조 방지).
    select coalesce(array_agg(t.mid order by t.ord), '{}'::uuid[])
      into v_module_ids
      from unnest(v_module_ids) with ordinality as t(mid, ord)
      join public.core_modules c on c.id = t.mid and c.profile_id = v_def.profile_id;
  end if;

  v_modules := jsonb_build_object(
    'instances', coalesce(v_instances, '[]'::jsonb),
    'matchup', public.build_attacker_matchup(v_me, v_def.profile_id)
  );

  v_authority := jsonb_build_object(
    'layers', v_layers,
    'maintenance', v_def.maintenance,
    'modules', v_modules
  );

  insert into public.invasion_snapshots (attacker_id, defender_id, defense_id, authority, maintenance, module_ids)
  values (
    v_me,
    v_def.profile_id,
    v_def.id,
    v_authority,
    v_def.maintenance,
    v_module_ids
  )
  returning id into v_snap_id;

  return jsonb_build_object(
    'snapshot_id', v_snap_id,
    'defender_id', v_def.profile_id,
    'defense_id',  v_def.id,
    'layers',      v_layers,
    'maintenance', v_def.maintenance,
    'modules',     v_modules
  );
end;
$$;

revoke all on function public.begin_invasion(uuid) from public;
revoke all on function public.begin_invasion(uuid) from anon;
grant execute on function public.begin_invasion(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. apply_invasion_result — 20260721000000:556 본문 전수 보존 + 모듈 차감·방어 보상
-- -----------------------------------------------------------------------------
-- 치환 2곳만:
--   ⓐ 카드 차감 블록 → 코어 모듈 차감 블록(스냅샷 module_ids 전량, 0 도달 시 삭제 + 장착 해제).
--   ⓑ 공격 실패 분기에 방어 성공 크레딧 정액 지급 추가(코어 모듈 드랍 폐지의 대체 보상).
-- 나머지(자기침공 3차 가드·profile_id 오름차순 락·pending 멱등·쿨다운 거부·격차 30 스왑 예외·
-- 복수 보너스·복제 약탈)는 한 줄도 다르지 않다.
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
      select coalesce((save->>'minerals')::numeric, 0) into v_minerals
        from public.profiles where id = v_inv.attacker_id for update;
      update public.profiles
        set save = jsonb_set(save, '{minerals}', to_jsonb(v_minerals + v_bonus), true)
        where id = v_inv.attacker_id;
      v_bonus_out := v_bonus;
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
    select coalesce((save->>'credits')::numeric, 0) into v_credits
      from public.profiles where id = v_inv.defender_id for update;
    if found then
      update public.profiles
        set save = jsonb_set(save, '{credits}', to_jsonb(v_credits + v_def_credit), true)
        where id = v_inv.defender_id;
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
    'defense_credits', v_def_credit
  );
end;
$$;

revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from public;
revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from anon, authenticated;
grant execute on function public.apply_invasion_result(uuid, jsonb, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 7. 코어 모듈 경제 RPC — 구매·합성·분해 (구 apply_card_* / salvage_card 계승)
-- -----------------------------------------------------------------------------
-- 순서(원자성·경합 안전): 프로필 행 잠금(동일 유저 동시 구매 직렬화) → 상한(20) → 크레딧 →
--   중복 구매(유니크 insert, 서브트랜잭션) → 크레딧 차감 + 모듈 insert.
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

  select coalesce((save->>'credits')::numeric, 0) into v_credits
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
    return jsonb_build_object('ok', false, 'code', 'insufficient-credits', 'credits', v_credits);
  end if;

  -- 중복 구매 차단(유니크 PK). 서브트랜잭션이라 dup 시 이 insert 만 롤백된다.
  begin
    insert into public.module_shop_purchases (profile_id, date_seed, slot_index)
      values (p_profile_id, p_date_seed, p_slot_index);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'already-bought');
  end;

  update public.profiles
    set save = jsonb_set(save, '{credits}', to_jsonb(v_credits - p_price), true)
    where id = p_profile_id;
  insert into public.core_modules (profile_id, module, rarity, charges_left)
    values (p_profile_id, p_module, p_rarity, p_charges_left)
    returning id into v_new_id;

  return jsonb_build_object(
    'ok', true, 'module_id', v_new_id, 'rarity', p_rarity, 'credits', v_credits - p_price
  );
end;
$$;

revoke all on function public.apply_module_purchase(uuid, bigint, integer, jsonb, text, integer, integer) from public;
revoke all on function public.apply_module_purchase(uuid, bigint, integer, jsonb, text, integer, integer) from anon, authenticated;
grant execute on function public.apply_module_purchase(uuid, bigint, integer, jsonb, text, integer, integer) to service_role;

-- 합성: EF 가 소유·등급을 미리 읽어 롤러를 돌렸더라도 여기서 행 잠금으로 재검증한다(TOCTOU
-- 안전 — 그 사이 모듈이 분해되면 v_count<>3 로 not-owned 거부, 아무것도 소모/생성 안 함).
create or replace function public.apply_module_fusion(
  p_profile_id     uuid,
  p_module_ids     uuid[],
  p_result_module  jsonb,
  p_result_rarity  text,
  p_result_charges integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count    integer;
  v_distinct integer;
  v_uniq_ids integer;
  v_new_id   uuid;
begin
  if not public.caller_is_service_role() then
    raise exception 'apply_module_fusion: service_role 전용 호출';
  end if;

  if array_length(p_module_ids, 1) is distinct from 3 then
    return jsonb_build_object('ok', false, 'code', 'need-three');
  end if;
  -- 중복 id 방어(같은 모듈을 3번 넣어 1개로 3개 효과 얻는 위조 차단).
  select count(distinct x) into v_uniq_ids from unnest(p_module_ids) x;
  if v_uniq_ids <> 3 then
    return jsonb_build_object('ok', false, 'code', 'dup-ids');
  end if;

  select count(*), count(distinct rarity)
    into v_count, v_distinct
    from public.core_modules
    where id = any(p_module_ids) and profile_id = p_profile_id
    for update;
  if v_count <> 3 then
    return jsonb_build_object('ok', false, 'code', 'not-owned');
  end if;
  if v_distinct <> 1 then
    return jsonb_build_object('ok', false, 'code', 'rarity-mismatch');
  end if;

  -- 재료가 장착 중이면 슬롯에서 빼고 삭제 → 결과 모듈 insert(원자).
  update public.defenses d
    set equipped_module_ids = array(
      select x from unnest(d.equipped_module_ids) with ordinality as t(x, ord)
      where x <> all(p_module_ids)
      order by t.ord
    )
    where d.equipped_module_ids && p_module_ids;
  delete from public.core_modules where id = any(p_module_ids) and profile_id = p_profile_id;
  insert into public.core_modules (profile_id, module, rarity, charges_left)
    values (p_profile_id, p_result_module, p_result_rarity, p_result_charges)
    returning id into v_new_id;

  return jsonb_build_object('ok', true, 'module_id', v_new_id, 'rarity', p_result_rarity);
end;
$$;

revoke all on function public.apply_module_fusion(uuid, uuid[], jsonb, text, integer) from public;
revoke all on function public.apply_module_fusion(uuid, uuid[], jsonb, text, integer) from anon, authenticated;
grant execute on function public.apply_module_fusion(uuid, uuid[], jsonb, text, integer) to service_role;

-- 분해 환급(롤러 무관 — 모듈 삭제 + 크레딧 환급).
-- 환급식(data/coreModules.ts moduleSalvageValue 미러): MODULE_SALVAGE_BASE[rarity] + affix×4.
--   BASE = normal 5 / magic 15 / rare 40 / unique 100, PER_AFFIX = 4. 남은 횟수 무관.
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

  -- 장착 해제(배열에서 제거) 후 삭제.
  update public.defenses d
    set equipped_module_ids = array(
      select x from unnest(d.equipped_module_ids) with ordinality as t(x, ord)
      where x <> p_module_id
      order by t.ord
    )
    where d.profile_id = v_me and d.equipped_module_ids @> array[p_module_id];
  delete from public.core_modules where id = p_module_id;

  -- 크레딧 환급(프로필 행 잠금 — lost-update 차단, repair_defense 패턴).
  select coalesce((save->>'credits')::numeric, 0) into v_credits
    from public.profiles where id = v_me for update;
  update public.profiles
    set save = jsonb_set(save, '{credits}', to_jsonb(v_credits + v_value), true)
    where id = v_me;

  return jsonb_build_object(
    'ok', true, 'salvaged', v_value, 'credits', v_credits + v_value, 'rarity', v_mod.rarity
  );
end;
$$;

revoke all on function public.salvage_core_module(uuid) from public;
revoke all on function public.salvage_core_module(uuid) from anon;
grant execute on function public.salvage_core_module(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. 구 방어 카드 경로 폐기 (rename 아님 — 신규 테이블로 대체 완료 후 제거)
-- -----------------------------------------------------------------------------
-- 순서 주의: begin_invasion·apply_invasion_result 를 위에서 이미 카드 무참조로 재정의했으므로
-- 여기서 안전하게 지울 수 있다. 미출시 전제라 데이터 이관은 하지 않는다.
-- 배포 시 함께 할 것: `supabase functions delete cards`(EF 는 마이그레이션이 못 지운다).
drop function if exists public.apply_card_drop(uuid, jsonb, text, integer);
drop function if exists public.apply_card_fusion(uuid, uuid[], jsonb, text, integer);
drop function if exists public.apply_card_purchase(uuid, bigint, integer, jsonb, text, integer, integer);
drop function if exists public.salvage_card(uuid);

drop trigger if exists trg_defenses_equipped_card on public.defenses;
drop function if exists public.guard_defenses_equipped_card();

alter table public.invasion_snapshots drop column if exists card_id;
alter table public.defenses drop column if exists equipped_card_id;

drop table if exists public.card_shop_purchases;
drop table if exists public.defense_cards;

comment on table public.core_modules is
  '코어 모듈 보관함(M7b, ADR-0018 — 구 defense_cards 계승). module jsonb = ModuleInstance 직렬화 계약(내부 키 개명 금지).';
comment on column public.defenses.equipped_module_ids is
  'L3 코어 강화 슬롯에 장착한 코어 모듈(core_modules.id). 최대 2, 중복 불가, 순서 = 슬롯 순서.';
comment on column public.invasion_snapshots.module_ids is
  'T0 에 고정한 차감 대상 코어 모듈. apply_invasion_result 확정 시 각 1 차감(멱등 — pending 게이트).';
