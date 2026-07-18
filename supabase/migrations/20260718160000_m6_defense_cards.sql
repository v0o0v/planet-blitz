-- =============================================================================
-- Planet Blitz M6 — 방어 카드 시스템 스키마 + 스냅샷 카드 권위 + 확정 시 차감
-- =============================================================================
-- 근거: grill-defense-card 스펙 · ADR-0012(효력은 begin_invasion 스냅샷 고정, 차감은
--   apply_invasion_result 확정 시) · team-plan.md(불변 제약: 서버 권위, SQL create or
--   replace 시 기존 봉인/가드 블록 전수 대조 — PR#29/#35 회귀 교훈).
--
-- 담는 것:
--   1. defense_cards — 유저 소유 카드 보관함(jsonb CardInstance + rarity/charges_left 정규
--      컬럼). RLS 는 본인 select 만 — insert/update/delete 정책 부재 = 클라 직접 쓰기 원천
--      차단(카드 생성·차감·분해·합성은 전부 서버 RPC/EF, service_role 만 RLS 우회).
--   2. defenses.equipped_card_id — 장착 카드 참조(nullable FK). 장착 변경은 클라 허용(자기
--      카드 한정, guard_defenses_equipped_card 트리거가 소유권 검증). 카드 내용·횟수는 클라
--      불가(defense_cards RLS 봉인). "장착만 클라, 차감은 서버"(ADR-0012).
--   3. invasion_snapshots.card_id — 스냅샷이 고정한 방어자 장착 카드 참조(차감 대상). authority
--      jsonb 에는 카드 효과+매치업(card:{card,matchup})을 함께 접어 넣는다(효력 스냅샷 고정).
--   4. begin_invasion 확장 — 방어자 장착 카드 + 공격자 매치업을 서버가 재구성해 스냅샷에
--      고정(기존 자격 검증·자기 침공 raise·수호 권위 주입·유니크 인덱스·search_path·grant 전수
--      보존, 카드 조립 블록만 추가).
--   5. apply_invasion_result 확장 — 확정(verified) 시 스냅샷 카드 charges_left 1 차감(바닥 0),
--      0 도달 시 카드 삭제 + 장착 해제(기존 스왑·복제 약탈·복수전·쿨다운·가드 전수 보존, 차감
--      블록만 추가).
--   6. salvage_card(RPC) — 분해 환급(등급 base + 어픽스×4 크레딧, data/defenseCards.ts
--      cardSalvageValue 미러). 장착 해제 + 카드 삭제 + save.credits 환급.
--
-- ★봉인 가드 무수정 계약(PR#29/#35 교훈): begin_invasion·apply_invasion_result 를 create or
--   replace 할 때 원본 본문(자격 검증·self-invasion raise·락 순서·쿨다운·스왑·복제 약탈·복수전
--   보너스·유니크 인덱스·revoke/grant)을 **전부 그대로 보존**하고 신규 블록만 삽입한다.
--   guard_invasions_*·guard_defenses_client_write 등 기존 봉인 트리거 함수는 재정의하지 않는다.
--
-- ▮ 잔여 설계(이 마이그레이션 범위 밖 — 핸드오프 lane-c-server.md §Remaining 에 훅 지점 명시):
--   - 카드 획득/합성(buy_shop_card·fuse_cards·방어 성공/보스 드랍)은 결정론 롤러
--     (src/items/rollCard.ts: rollCard·attemptFusion·rollShopRotation, SeededRng 기반)를
--     써야 카드가 생성된다. SeededRng+rollCard 를 plpgsql 로 bit-identical 재구현하는 것은
--     surface 가 과대·고위험(상점 로테이션 결정론이 클라와 어긋나면 재현 불가)이라, 공유 TS
--     롤러를 그대로 실행하는 **전용 Edge Function(cards)** 이 정본 설계다. 이 마이그레이션은
--     생성 경로에 필요한 **저장 스키마(defense_cards)** 만 확정하고, 생성 RPC 자체는 EF 로 남긴다.
--   - salvage_card 는 롤러 무관(카드 삭제+환급)이라 여기서 SQL RPC 로 구현한다.
--
-- ▮ 매치업 재구성 신뢰 경계(문서화된 보수 재구성): build_attacker_matchup 은 서버가 신뢰 가능한
--   축(revenge=revenge_targets_for, reinvasion=기존 확정 침공 존재)만 재구성하고, 공격자 로드아웃
--   원소(fire/cold/lightning/beam)·전투력(attackerCp/defenderCp)·보조무기 강도는 보수적 기본값
--   (false/0)으로 둔다. 이 값은 begin_invasion 이 스냅샷에 고정하고 **동일 값을 클라에 반환**하므로
--   (공/수 재현 일관성 보장), 무결성은 항상 성립한다 — 정직 런은 accept, 위조 매치업은 EF 재실행
--   발산으로 거부. 원소/무기/CP 축의 완전 재구성(공격자 서버 미러 ships.equipped·CP 파싱)은 밸런스
--   개선 후속으로 남긴다(정적 카운터 cc-quench/frostward/insulate/refract/armorbreak/disruptor 는
--   그 전까지 미발동 — 무결성 무영향, 밸런스만 보수적).
--
-- 재실행 안전: create table/index/policy if [not] exists·drop policy if exists → create·
--   add column if not exists·create or replace function·search_path='' 고정·권한 재적용.
-- 원격 적용은 하지 말 것(리포 마이그레이션만; 원격은 리드 승인 후).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. defense_cards — 유저 카드 보관함(서버 전용 쓰기)
-- -----------------------------------------------------------------------------
-- card 는 CardInstance 직렬화 계약(data/defenseCards.ts — id·rarity·prefixes·suffixes·
-- uniqueId?·chargesMax·chargesLeft·seed) 을 jsonb 로 그대로 담는다. rarity·charges_left 는
-- 조회·차감·상한 판정을 위한 최소 정규 컬럼(값은 card jsonb 와 일치해야 하며, 서버 RPC/EF 가
-- 함께 기록한다). 클라이언트는 select 만 — 생성·차감·분해·합성은 전부 서버 경로.
create table if not exists public.defense_cards (
  id            uuid        primary key default gen_random_uuid(),
  profile_id    uuid        not null references public.profiles(id) on delete cascade,
  card          jsonb       not null,
  rarity        text        not null check (rarity in ('normal', 'magic', 'rare', 'unique')),
  charges_left  integer     not null check (charges_left >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists defense_cards_profile_idx on public.defense_cards (profile_id, created_at desc);

alter table public.defense_cards enable row level security;

-- 읽기: 본인 카드만(보관함·상점·합성 UI). 쓰기 정책 **부재** → 클라 직접 insert/update/delete
-- 불가(카드 생성·차감·분해·합성 위조 차단). 서버 RPC/EF(service_role)만 RLS 우회로 기록한다.
drop policy if exists defense_cards_select_own on public.defense_cards;
create policy defense_cards_select_own
  on public.defense_cards for select
  to authenticated
  using (auth.uid() = profile_id);

create or replace trigger trg_defense_cards_updated_at
  before update on public.defense_cards
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. defenses.equipped_card_id — 장착 카드 참조(장착만 클라, 소유권 트리거 검증)
-- -----------------------------------------------------------------------------
-- 카드 삭제(분해·차감 소진) 시 자동 해제(on delete set null). 장착 자체는 방어자 배치 결정이라
-- 클라가 defenses_rw_own update 로 바꿀 수 있으나(guard_defenses_client_write 가 봉인하는
-- maintenance/budget_spent 와 달리 이 컬럼은 봉인 대상 아님 — 장착은 클라 몫), 아래 트리거가
-- **자기 소유 카드만** 장착되게 강제한다.
alter table public.defenses
  add column if not exists equipped_card_id uuid references public.defense_cards(id) on delete set null;

-- 장착 검증 트리거: equipped_card_id 가 설정될 때 그 카드가 이 방어의 소유자(profile_id) 것인지
-- 확인한다(남의 카드 장착·위조 참조 차단). 별도 트리거로 두어 기존 guard_defenses_client_write
-- (maintenance/budget_spent 봉인)를 **건드리지 않는다**(봉인 회귀 위험 0). service_role 경로도
-- 통과(begin_invasion 등은 유효 카드만 설정)하므로 역할 무관 검증이 안전하다.
create or replace function public.guard_defenses_equipped_card()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.equipped_card_id is not null then
    if not exists (
      select 1 from public.defense_cards c
      where c.id = new.equipped_card_id and c.profile_id = new.profile_id
    ) then
      raise exception 'defenses: 소유하지 않은 카드는 장착 불가 (%)', new.equipped_card_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger trg_defenses_equipped_card
  before insert or update on public.defenses
  for each row execute function public.guard_defenses_equipped_card();

-- -----------------------------------------------------------------------------
-- 3. invasion_snapshots.card_id — 스냅샷이 고정한 차감 대상 카드 참조
-- -----------------------------------------------------------------------------
-- 효력(효과+매치업+남은 횟수)은 authority->'card' jsonb 에 접혀 T0 에 불변 고정된다(ADR-0012).
-- card_id 는 apply_invasion_result 확정 시 **어느 카드 행을 차감할지**의 참조다(효력 고정과
-- 차감 대상 참조를 분리 — 카드가 소진 삭제돼도 on delete set null 로 스냅샷은 유효).
alter table public.invasion_snapshots
  add column if not exists card_id uuid references public.defense_cards(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 4. build_attacker_matchup — 공격자 매치업 재구성(서버 권위, 보수 재구성)
-- -----------------------------------------------------------------------------
-- 정적 카운터(접두) 조건 판정 입력(AttackerMatchup, src/sim/cardEffects.ts). 서버가 신뢰
-- 가능한 축만 재구성하고 나머지는 보수적 기본값(헤더 신뢰 경계 참조). begin_invasion 이 이 값을
-- 스냅샷에 고정하고 동일 값을 클라에 반환하므로 공/수 재현이 일관된다(무결성 성립).
create or replace function public.build_attacker_matchup(p_attacker uuid, p_defender uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_revenge    boolean;
  v_reinvasion boolean;
begin
  -- revenge: 방어자가 공격자의 유효 복수 대상인가(직전 스왑 상대 한정 — revenge_targets_for).
  v_revenge := exists (
    select 1 from public.revenge_targets_for(p_attacker) rt where rt.target_id = p_defender
  );
  -- reinvasion: 공격자가 이 방어자를 과거에 확정 침공한 적 있는가(동일 공격자 재침공).
  v_reinvasion := exists (
    select 1 from public.invasions iv
    where iv.attacker_id = p_attacker
      and iv.defender_id = p_defender
      and iv.verified_status = 'verified'
  );
  return jsonb_build_object(
    'fire', false,
    'cold', false,
    'lightning', false,
    'beam', false,
    'attackerCp', 0,
    'defenderCp', 0,
    'revenge', v_revenge,
    'reinvasion', v_reinvasion,
    'subweaponHeavy', false
  );
end;
$$;

revoke all on function public.build_attacker_matchup(uuid, uuid) from public;
revoke all on function public.build_attacker_matchup(uuid, uuid) from anon, authenticated;
grant execute on function public.build_attacker_matchup(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 5. begin_invasion — 스냅샷에 방어자 카드 + 공격자 매치업 고정(원본 전수 보존 + 카드 블록)
-- -----------------------------------------------------------------------------
-- ★ 20260718140000 의 본문(auth.uid() 게이트·self-invasion raise·대상 자격 검증(active·
--   my_rank·def placed·rank 격차)·inject_guardian_authority T0 고정·유니크 인덱스는 별도·
--   search_path=''·revoke/grant)을 **전부 그대로 보존**하고, 카드 조립 블록만 추가한다.
create or replace function public.begin_invasion(p_defense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me          uuid := auth.uid();
  v_def         public.defenses%rowtype;
  v_layout      jsonb;
  v_snap_id     uuid;
  v_my_rank     integer;
  v_def_rank    integer;
  v_def_placed  boolean;
  v_card_json   jsonb;
  v_card_id     uuid;
  v_card_config jsonb;
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
  -- (비활성·미배치·상위 랭커) defense 의 라이브 수호 구성 스카우팅을 차단한다. 자격 미달은
  -- 클라이언트가 폴백(라이브 경로)하도록 raise 로 알린다. 배치전/복수전 등 이 규칙 밖 대상은
  -- 스냅샷을 발급하지 않고 현행 라이브 경로로 침공한다(하위호환 — 회귀 0).
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

  -- T0 권위 고정: 수호 슬롯의 성능%·계보 보너스·스냅샷을 라이브 값으로 접는다(수호 미포함
  -- 방어는 inject_guardian_authority 가 guardians 키를 그대로 두거나 제거 → layout 불변).
  v_layout := public.inject_guardian_authority(v_def.layout, v_def.profile_id);

  -- ▮ 방어 카드 권위 고정(ADR-0012, M6): 방어자 장착 카드(자기 소유 검증은 장착 트리거가 이미
  --   보증)와 공격자 매치업을 스냅샷에 함께 접는다. 효력은 이 스냅샷 시점 기준으로 불변 고정되고,
  --   차감은 apply_invasion_result 확정 시 card_id 로 이뤄진다. 미장착이면 card 필드 미포함 →
  --   기존 침공(카드 없음)과 거동·해시 완전 불변(조건부 접기).
  v_card_config := null;
  v_card_id := null;
  if v_def.equipped_card_id is not null then
    select c.card into v_card_json from public.defense_cards c
      where c.id = v_def.equipped_card_id and c.profile_id = v_def.profile_id;
    if found then
      v_card_id := v_def.equipped_card_id;
      v_card_config := jsonb_build_object(
        'card', v_card_json,
        'matchup', public.build_attacker_matchup(v_me, v_def.profile_id)
      );
    end if;
  end if;

  v_authority := jsonb_build_object('layout', v_layout, 'maintenance', v_def.maintenance);
  if v_card_config is not null then
    v_authority := v_authority || jsonb_build_object('card', v_card_config);
  end if;

  insert into public.invasion_snapshots (attacker_id, defender_id, defense_id, authority, maintenance, card_id)
  values (
    v_me,
    v_def.profile_id,
    v_def.id,
    v_authority,
    v_def.maintenance,
    v_card_id
  )
  returning id into v_snap_id;

  return jsonb_build_object(
    'snapshot_id', v_snap_id,
    'defender_id', v_def.profile_id,
    'defense_id',  v_def.id,
    'layout',      v_layout,
    'maintenance', v_def.maintenance,
    'card',        v_card_config
  );
end;
$$;

revoke all on function public.begin_invasion(uuid) from public;
revoke all on function public.begin_invasion(uuid) from anon;
grant execute on function public.begin_invasion(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. apply_invasion_result — 확정 시 카드 차감(원본 v3 전수 보존 + 차감 블록)
-- -----------------------------------------------------------------------------
-- ★ 20260717140000 의 v3 본문(caller_is_service_role 게이트·pending 멱등·self-invasion 3차
--   가드·profile_id 오름차순 락 순서·복수 판정·쿨다운·verified 확정·승패 스왑(복수 격차30
--   예외)·복수 보너스 광물·복제 약탈·패배 처리)을 **전부 그대로 보존**하고, verified 확정
--   직후에 카드 차감 블록만 추가한다(ADR-0012 — "확정된 침공 1건 = 차감 1", 승패 무관).
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
  v_card_id    uuid;            -- M6: 스냅샷이 고정한 차감 대상 카드.
  v_card_left  integer;         -- M6: 차감 후 남은 횟수(0 도달 시 삭제+해제).
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
      'bonus_minerals', 0, 'note', 'already-finalized'
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

  -- 복수 판정(직전 스왑 상대 한정 서버 강제): 현재 방어자가 공격자의 유효 복수 대상인가.
  -- 현재 침공은 아직 pending 이라 revenge_targets_for 결과에 영향 없음(자기 간섭 없음).
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
      'note', 'cooldown-violation'
    );
  end if;

  -- verified_* 확정 + 복수 플래그 기록.
  update public.invasions
    set verified_status = 'verified', verified_result = p_verified_result,
        attacker_won = p_attacker_won, verified_at = now(), is_revenge = v_is_revenge
    where id = p_invasion_id;

  -- ▮ 방어 카드 사용 횟수 차감(ADR-0012, M6): 확정된 침공 1건 = 차감 1(승패 무관, 쿨다운
  --   거부 경로는 위에서 이미 return 하므로 여기 도달 = 실제 확정). 스냅샷이 고정한 카드
  --   (invasion_snapshots.card_id)의 charges_left 를 1 감소(바닥 0). 0 도달 시 카드 삭제 +
  --   장착 해제(on delete set null 이 스냅샷 card_id·defenses.equipped_card_id 를 자동 해제).
  --   스냅샷 효력(authority.card)은 유지 — 동시 침공 다건이 같은 카드를 참조해도 이미 고정된
  --   효력은 불변, 차감만 바닥 0 에서 멈춘다. snapshot_id 없으면(라이브 경로) 카드 없음.
  if v_inv.snapshot_id is not null then
    select s.card_id into v_card_id from public.invasion_snapshots s where s.id = v_inv.snapshot_id;
    if v_card_id is not null then
      update public.defense_cards
        set charges_left = greatest(0, charges_left - 1), updated_at = now()
        where id = v_card_id
        returning charges_left into v_card_left;
      if found and v_card_left <= 0 then
        update public.defenses set equipped_card_id = null where equipped_card_id = v_card_id;
        delete from public.defense_cards where id = v_card_id;
      end if;
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
    -- 미배치 공격자는 v_att_placed=false 라 자동 제외(배치전 스왑 금지).
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

    -- 복수 성공(자리 탈환) 보너스 광물 지급: save.minerals 에 서버 가산(repair_defense
    -- 크레딧 차감 패턴 재사용, 프로필 행 잠금으로 lost-update 차단).
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
  end if;

  return jsonb_build_object(
    'swapped', v_swapped,
    'attacker_rank', v_att_rank,
    'defender_rank', v_def_rank,
    'loot', v_loot,
    'is_revenge', v_is_revenge,
    'bonus_minerals', v_bonus_out
  );
end;
$$;

revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from public;
revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from anon, authenticated;
grant execute on function public.apply_invasion_result(uuid, jsonb, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 7. salvage_card — 카드 분해 환급(롤러 무관 — 카드 삭제 + 크레딧 환급)
-- -----------------------------------------------------------------------------
-- 환급식(data/defenseCards.ts cardSalvageValue 미러): SALVAGE_BASE[rarity] + affixCount×4.
--   SALVAGE_BASE = normal 5 / magic 15 / rare 40 / unique 100, SALVAGE_PER_AFFIX = 4.
--   남은 횟수 무관(롤 가치 회수). 이 상수가 바뀌면 데이터 함수와 함께 갱신해야 한다(계약 결속).
-- 크레딧 위치: profiles.save->>'credits'(repair_defense 와 동일 정본). 서버 권위 가산.
create or replace function public.salvage_card(p_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_card    public.defense_cards%rowtype;
  v_affix   integer;
  v_value   integer;
  v_credits numeric;
begin
  if v_me is null then
    raise exception 'salvage_card: 로그인 필요';
  end if;

  select * into v_card from public.defense_cards
    where id = p_card_id and profile_id = v_me for update;
  if not found then
    return jsonb_build_object('ok', false, 'note', 'not-owned');
  end if;

  v_affix := coalesce(jsonb_array_length(v_card.card->'prefixes'), 0)
           + coalesce(jsonb_array_length(v_card.card->'suffixes'), 0);
  v_value := (case v_card.rarity
                when 'normal' then 5
                when 'magic'  then 15
                when 'rare'   then 40
                when 'unique' then 100
                else 0
              end) + v_affix * 4;

  -- 장착 해제 후 삭제(on delete set null 이 스냅샷 참조도 자동 해제).
  update public.defenses set equipped_card_id = null where equipped_card_id = p_card_id;
  delete from public.defense_cards where id = p_card_id;

  -- 크레딧 환급(프로필 행 잠금 — lost-update 차단, repair_defense 패턴).
  select coalesce((save->>'credits')::numeric, 0) into v_credits
    from public.profiles where id = v_me for update;
  update public.profiles
    set save = jsonb_set(save, '{credits}', to_jsonb(v_credits + v_value), true)
    where id = v_me;

  return jsonb_build_object(
    'ok', true, 'salvaged', v_value, 'credits', v_credits + v_value, 'rarity', v_card.rarity
  );
end;
$$;

revoke all on function public.salvage_card(uuid) from public;
revoke all on function public.salvage_card(uuid) from anon;
grant execute on function public.salvage_card(uuid) to authenticated, service_role;
