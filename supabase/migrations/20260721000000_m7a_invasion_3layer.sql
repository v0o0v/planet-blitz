-- =============================================================================
-- Planet Blitz M7a — 침공 3레이어 DB 전환 (L7-db-net)
-- =============================================================================
-- 근거: .omc/plans/invasion-3layer-redesign.md · .omc/plans/invasion-3layer-impl-lanes.md
--   "L7-db-net" 절 · ADR-0017(3레이어 원정) · ADR-0018(방어체 챔피언화) · ADR-0005(결정론).
--
-- 담는 것:
--   1. defenses.layout 을 **3레이어 정규형**(src/sim/invasion/types.ts InvasionLayers)으로
--      재정의 + 기존 행 전량 재시드(미출시라 보존 불요 — 빈 배치는 기본 수비대가 충원).
--   2. **배치 포인트 예산 게이트 폐지**(결정 #14 "슬롯이 곧 예산"): defense_layout_cost 함수와
--      guard_defenses_client_write 의 상한 20 raise 를 폐기하고 **슬롯 수·형식 검증**으로 대체.
--      budget_spent 컬럼은 남기되 클라 경로에서 항상 0 으로 고정한다(컬럼 drop 은 구 클라가
--      살아 있는 M7a 기간에 위험 — L11 이후 별도 정리 대상).
--   3. inject_guardian_authority 경로를 `layout->'l3'->'guardians'` 로 이설 +
--      **고정 길이 2 배열의 i 번째 제자리 치환**(빈 슬롯 null 유지, 밀집화 금지).
--   4. begin_invasion v4 — 20260718160000:185 **최신본 전문을 베이스로** 재작성(자기침공 3차
--      가드·대상 자격 검증·카드 권위·유니크 인덱스·search_path·grant 전수 보존), authority
--      jsonb 를 {layers, maintenance, modules(+card)} 로 확장.
--   5. apply_invasion_result — 20260718160000:305 최신본을 **전수 보존**해 재선언(락 순서·멱등·
--      쿨다운 거부·복수 판정·격차 30 스왑 예외·복제 약탈·카드 차감 전부 원문 그대로).
--   6. get_invasion_targets / get_placement_targets / get_revenge_targets 의 layout 반환을
--      3레이어로 + **정찰 부분 공개**(결정 #15).
--
-- ★봉인 가드 무수정 계약(PR#29/#35 교훈): 위 4·5 는 최신본 전문을 확보한 뒤 그 위에서만
--   고쳤다. 시그니처·RETURNS TABLE shape·SECURITY DEFINER·search_path·revoke/grant 는 전부
--   원본과 동일하다(RETURNS TABLE 컬럼명이 바뀌면 create or replace 가 실패하므로 `layout`
--   컬럼명을 그대로 유지한다 — 내용만 3레이어로 바뀐다).
--
-- ▮ 정찰 부분 공개(결정 #15)의 적용 범위 — **중요**
--   `invasion_recon_layers()` 는 방어체 참조에서 `level`·`affixSeed` 를 지운 실루엣 뷰다
--   (catalogId=실루엣 / rarity=등급 / ascension=승급만). 이 뷰는 **표시 전용**이며 침공 런의
--   입력이 아니다 — 침공은 반드시 `begin_invasion()` 이 돌려주는 **정확한 layers**(T0 스냅샷)로
--   돌려야 EF 재실행과 비트 일치한다.
--   따라서 마스킹은 `get_invasion_targets` / `get_revenge_targets` **두 곳에만** 건다.
--   `get_placement_targets`(배치전 NPC)는 공격자가 아직 래더에 없어 begin_invasion 이 자격
--   미달로 raise → 라이브 경로가 정본이므로 **정확 layers 를 그대로 서빙**한다. 여기에 마스킹을
--   걸면 배치전 5회가 전량 defense-mismatch 로 오거부된다.
--
-- 재실행 안전: create or replace function · drop function if exists · update 재시드는 멱등.
-- **원격 적용 금지** — 이 파일은 리포 커밋만(리드/사용자 승인 후 브랜치 DB 선검증).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. 3레이어 스키마 상수 · 빈 정규형
-- -----------------------------------------------------------------------------
-- 값은 src/sim/invasion/constants.ts 의 정본과 **같아야 한다**(재번호 금지 계약):
--   INVASION_WAVE_SLOTS=6 / INVASION_SOCKET_COUNTS=[12,10,8] / INVASION_PROP_SLOTS=6 /
--   INVASION_GUARDIAN_SLOTS=2 / INVASION_CORE_MODULE_SLOTS=2 / INVASION_CORE_HP=8000.
-- 상수가 바뀌면 이 함수들과 클라·EF 를 **같은 커밋에서** 함께 갱신해야 한다.

/**
 * jsonb 객체에서 정수 필드를 **안전하게** 뽑는다(키 부재·타입 불일치·범위 초과 전부 기본값).
 * 매치메이킹 RPC 안에서 캐스트가 raise 하면 목록 전체가 죽으므로, 신뢰 불가 jsonb 를 읽는
 * 모든 지점이 이 헬퍼를 쓴다(정수 도메인 = int4 범위로 클램프).
 */
create or replace function public.invasion_num(p_obj jsonb, p_key text, p_default integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_obj is null or jsonb_typeof(p_obj) <> 'object' then p_default
    when jsonb_typeof(p_obj->p_key) <> 'number' then p_default
    else greatest(-2147483648::numeric,
                  least(2147483647::numeric, trunc((p_obj->>p_key)::numeric)))::integer
  end;
$$;

/** 템플릿 코드(0=직선 12 / 1=굴곡 10 / 2=병목 8) → 소켓 수. 범위 밖은 -1(무효). */
create or replace function public.invasion_socket_count(p_template integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_template when 0 then 12 when 1 then 10 when 2 then 8 else -1 end;
$$;

/**
 * 정규화된 빈 3레이어 배치(normalizeInvasionLayers(undefined) 와 **비트 동일**).
 * 전 슬롯 null = 기본 수비대가 스폰 단계에서 충원한다(layers 직렬화·해시 불변 — 결정 #22).
 */
create or replace function public.empty_invasion_layers()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'l1', jsonb_build_object('waveSlots', '[null,null,null,null,null,null]'::jsonb),
    'l2', jsonb_build_object(
            'templateId', 0,
            'sockets', '[null,null,null,null,null,null,null,null,null,null,null,null]'::jsonb),
    'l3', jsonb_build_object(
            'boss', 'null'::jsonb,
            'guardians', '[null,null]'::jsonb,
            'props', '[null,null,null,null,null,null]'::jsonb,
            'core', jsonb_build_object('hp', 8000, 'x', 0, 'y', 0),
            'modules', '[null,null]'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- 1. 유효성 검증 — 예산 게이트를 대체하는 슬롯 수·형식 게이트
-- -----------------------------------------------------------------------------
-- 무결성 근거가 "포인트 합계 ≤ 20" 에서 "슬롯 수 상한"으로 바뀌었다(결정 #14). 값 자체의
-- 클램프(level 1..99 등)는 공유 정규화(src/sim/invasion/normalize.ts)가 클라·EF 양쪽에서
-- 동일하게 수행하므로 서버는 **구조적 상한**만 강제한다 — 슬롯을 늘려 신고하는 것이 유일한
-- 실질 위조 표면이기 때문이다(값 위조는 EF 재실행 대조가 잡는다).

/** 슬롯 배열 1개 검증: null 또는 (길이 ≤ 상한 && 원소가 null|object 인 배열). */
create or replace function public.invasion_slot_array_ok(p_val jsonb, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_val is null then true
    when jsonb_typeof(p_val) = 'null' then true
    when jsonb_typeof(p_val) <> 'array' then false
    when jsonb_array_length(p_val) > p_max then false
    else not exists (
      select 1 from jsonb_array_elements(p_val) e
      where jsonb_typeof(e.value) not in ('null', 'object')
    )
  end;
$$;

/** 3레이어 배치 구조 검증(슬롯 수 상한 + 형식). 값 클램프는 공유 정규화 소관. */
create or replace function public.invasion_layers_valid(p_layout jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tpl     integer;
  v_sockets integer;
  v_l2      jsonb;
  v_l3      jsonb;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    return false;
  end if;
  if jsonb_typeof(p_layout->'l1') <> 'object'
     or jsonb_typeof(p_layout->'l2') <> 'object'
     or jsonb_typeof(p_layout->'l3') <> 'object' then
    return false;
  end if;

  -- L1 — 웨이브 슬롯 6.
  if not public.invasion_slot_array_ok(p_layout->'l1'->'waveSlots', 6) then
    return false;
  end if;

  -- L2 — 템플릿 코드 0..2, 소켓 수는 템플릿이 정한다.
  v_l2 := p_layout->'l2';
  if jsonb_typeof(v_l2->'templateId') <> 'number' then
    return false;
  end if;
  v_tpl := public.invasion_num(v_l2, 'templateId', -1);
  v_sockets := public.invasion_socket_count(v_tpl);
  if v_sockets < 0 then
    return false;
  end if;
  if not public.invasion_slot_array_ok(v_l2->'sockets', v_sockets) then
    return false;
  end if;

  -- L3 — 보스 1 · 수호 2 · 기물 6 · 모듈 2 · 코어.
  v_l3 := p_layout->'l3';
  if v_l3 ? 'boss' and jsonb_typeof(v_l3->'boss') not in ('null', 'object') then
    return false;
  end if;
  if not public.invasion_slot_array_ok(v_l3->'guardians', 2) then
    return false;
  end if;
  if not public.invasion_slot_array_ok(v_l3->'props', 6) then
    return false;
  end if;
  if not public.invasion_slot_array_ok(v_l3->'modules', 2) then
    return false;
  end if;
  if v_l3 ? 'core' and jsonb_typeof(v_l3->'core') <> 'object' then
    return false;
  end if;

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. 클라이언트 쓰기 가드 교체 — 예산 상한 20 폐기, 슬롯 검증으로 대체
-- -----------------------------------------------------------------------------
-- 20260717010000:92 의 원본에서 **예산 산출·상한 raise 만** 걷어내고, 정비도 봉인
-- (ADR-0006 자가회복 차단 / INSERT 100 고정)은 **한 줄도 바꾸지 않는다**.
create or replace function public.guard_defenses_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- service_role(서버 로직)은 게이트 우회 — 정비 회복·시드는 서버 트랜잭션이 직접 쓴다.
  if public.is_service_role() then
    return new;
  end if;

  -- 클라이언트(authenticated) 경로: 3레이어 구조·슬롯 수 강제(예산제 폐지 — 결정 #14).
  if not public.invasion_layers_valid(new.layout) then
    raise exception 'defense layout invalid: 3레이어 스키마·슬롯 수 위반'
      using errcode = 'check_violation';
  end if;
  -- 예산 개념이 사라졌으므로 클라 신고값을 무시하고 0 으로 고정한다(컬럼은 하위호환 유지).
  new.budget_spent := 0;

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

-- 트리거(trg_defenses_guard, before insert or update)는 20260717010000 에서 이미 정의됨.

-- 예산 산출 함수 폐기(참조가 남아 있으면 drop 이 실패하므로 가드 교체 뒤에 실행한다).
drop function if exists public.defense_layout_cost(jsonb);

-- -----------------------------------------------------------------------------
-- 3. 기존 방어 행 재시드 — 구 layout(core/turrets/obstacles) → 3레이어 빈 정규형
-- -----------------------------------------------------------------------------
-- 미출시라 보존 불요(레인 문서). 빈 배치는 기본 수비대가 전 슬롯을 충원하므로 방어 공백이
-- 생기지 않는다. NPC 시드 20기지는 다음 마이그레이션(20260721010000)이 난이도 밴드에 맞춰
-- 덮어쓴다. maintenance 는 **건드리지 않는다**(풍화 이력 보존 — ADR-0006).
update public.defenses
  set layout = public.empty_invasion_layers(),
      budget_spent = 0
  where not public.invasion_layers_valid(layout);

-- -----------------------------------------------------------------------------
-- 4. inject_guardian_authority — 경로 이설 + 고정 길이 2 제자리 치환
-- -----------------------------------------------------------------------------
-- 20260718110000:46 의 규칙을 3레이어로 옮긴다. **바뀐 것 2가지**:
--   ⓐ 경로: `layout->'guardians'` → `layout->'l3'->'guardians'`.
--   ⓑ 매핑: 밀집 배열 append 가 아니라 **고정 길이 2 의 i 번째 제자리 치환**이다.
--      slot i 가 null 이면 null 그대로, 활성 수호 i 가 없으면 null 로 비운다.
--      (밀집화하면 슬롯 i ↔ 수호 i 매핑이 어긋나 SQL·EF·클라 3자 정합이 깨진다.)
-- EF `injectGuardianAuthority`(TS)·클라 buildGuardianPlacements 와 **비트 동일 계약**:
--   performanceCP = round(guardians.performance * 100)
--   lineageBonusBp = floor(5000 * L / (L + 20)) (L=0→0, 상한 5000)
--   milestones = data/lineage.ts guardianMilestones(L): L>=10 |1, L>=25 |2, L>=50 |4
--   x, y = 방어자 배치 좌표(정수 절삭) — 값 원천은 layout, 권위는 라이브 DB.
-- 활성 수호 정렬은 created_at asc, id asc(EF·클라 조회와 동일).
create or replace function public.inject_guardian_authority(p_layout jsonb, p_profile_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_slots     jsonb;
  v_slot      jsonb;
  v_level     integer;
  v_bonus_bp  integer;
  v_milestone integer;
  v_new       jsonb := '[]'::jsonb;
  v_live      jsonb[] := array[]::jsonb[];
  v_row       record;
  v_i         integer;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    return p_layout;
  end if;
  v_slots := p_layout->'l3'->'guardians';
  -- 수호 슬롯이 없는(구 스키마·손상) layout 은 손대지 않는다 — 정규화가 별도로 처리한다.
  if v_slots is null or jsonb_typeof(v_slots) <> 'array' then
    return p_layout;
  end if;

  select coalesce(lineage_guardian_level, 0) into v_level
    from public.profiles where id = p_profile_id;
  if v_level is null or v_level <= 0 then
    v_level := 0;
    v_bonus_bp := 0;
  else
    v_bonus_bp := floor(5000.0 * v_level / (v_level + 20))::integer;
    if v_bonus_bp > 5000 then v_bonus_bp := 5000; end if;
  end if;
  v_milestone := 0;
  if v_level >= 10 then v_milestone := v_milestone + 1; end if;
  if v_level >= 25 then v_milestone := v_milestone + 2; end if;
  if v_level >= 50 then v_milestone := v_milestone + 4; end if;

  -- 활성 수호 최대 2기(INVASION_GUARDIAN_SLOTS)를 정렬 순서대로 모은다.
  for v_row in
    select data, performance
    from public.guardians
    where profile_id = p_profile_id and retired = false
    order by created_at asc, id asc
    limit 2
  loop
    v_live := v_live || jsonb_build_object('data', v_row.data, 'perf', coalesce(v_row.performance, 100));
  end loop;

  -- 슬롯 0..1 제자리 치환(고정 길이 2 — 밀집화 금지).
  for v_i in 0..1 loop
    v_slot := v_slots->v_i;
    if v_slot is null or jsonb_typeof(v_slot) <> 'object' or array_length(v_live, 1) is null
       or v_i + 1 > array_length(v_live, 1) then
      v_new := v_new || jsonb_build_array('null'::jsonb);
    else
      v_new := v_new || jsonb_build_array(jsonb_build_object(
        'x', public.invasion_num(v_slot, 'x', 0),
        'y', public.invasion_num(v_slot, 'y', 0),
        'snapshot', v_live[v_i + 1]->'data',
        'performanceCP', round((v_live[v_i + 1]->>'perf')::numeric * 100)::integer,
        'lineageBonusBp', v_bonus_bp,
        'milestones', v_milestone
      ));
    end if;
  end loop;

  return jsonb_set(p_layout, '{l3,guardians}', v_new);
end;
$$;

revoke all on function public.inject_guardian_authority(jsonb, uuid) from public;
revoke all on function public.inject_guardian_authority(jsonb, uuid) from anon;
grant execute on function public.inject_guardian_authority(jsonb, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. invasion_recon_layers — 정찰 부분 공개(결정 #15)
-- -----------------------------------------------------------------------------
-- 실루엣(catalogId)·등급(rarity)·승급(ascension)만 남기고 **정확 스펙(level·affixSeed)은
-- 제거**한다. 수호 슬롯은 존재 여부만(빈 객체) 노출해 라이브 스냅샷·계보 수치가 새지 않게 한다.
-- 표시 전용 뷰다 — 침공 런 입력은 언제나 begin_invasion 의 정확 layers 다(헤더 참조).
create or replace function public.invasion_recon_ref(p_ref jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ref is null or jsonb_typeof(p_ref) <> 'object' then 'null'::jsonb
    else jsonb_build_object(
      'catalogId', public.invasion_num(p_ref, 'catalogId', 0),
      'ascension', public.invasion_num(p_ref, 'ascension', 0),
      'rarity',    public.invasion_num(p_ref, 'rarity', 0))
  end;
$$;

create or replace function public.invasion_recon_slots(p_val jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select jsonb_agg(public.invasion_recon_ref(e.value) order by e.ordinality)
       from jsonb_array_elements(
              case when jsonb_typeof(p_val) = 'array' then p_val else '[]'::jsonb end
            ) with ordinality e),
    '[]'::jsonb);
$$;

create or replace function public.invasion_recon_layers(p_layout jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_guards jsonb := '[]'::jsonb;
  v_slot   jsonb;
  v_i      integer;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    return public.empty_invasion_layers();
  end if;
  -- 수호는 존재 여부만(스냅샷·성능%·계보 미노출).
  for v_i in 0..1 loop
    v_slot := p_layout->'l3'->'guardians'->v_i;
    if v_slot is null or jsonb_typeof(v_slot) <> 'object' then
      v_guards := v_guards || jsonb_build_array('null'::jsonb);
    else
      v_guards := v_guards || jsonb_build_array(jsonb_build_object('present', true));
    end if;
  end loop;

  return jsonb_build_object(
    'l1', jsonb_build_object('waveSlots', public.invasion_recon_slots(p_layout->'l1'->'waveSlots')),
    'l2', jsonb_build_object(
            'templateId', public.invasion_num(p_layout->'l2', 'templateId', 0),
            'sockets', public.invasion_recon_slots(p_layout->'l2'->'sockets')),
    'l3', jsonb_build_object(
            'boss', public.invasion_recon_ref(p_layout->'l3'->'boss'),
            'guardians', v_guards,
            'props', public.invasion_recon_slots(p_layout->'l3'->'props'),
            'modules', public.invasion_recon_slots(p_layout->'l3'->'modules')),
    'recon', true
  );
end;
$$;

revoke all on function public.invasion_recon_layers(jsonb) from public;
revoke all on function public.invasion_recon_layers(jsonb) from anon;
grant execute on function public.invasion_recon_layers(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. begin_invasion v4 — authority = {layers, maintenance, modules(+card)}
-- -----------------------------------------------------------------------------
-- ★ 20260718160000:185 본문(auth.uid() 게이트·self-invasion raise·대상 자격 검증(active·
--   my_rank·def placed·rank 격차)·카드 권위 고정·insert 컬럼·search_path=''·revoke/grant)을
--   **전부 그대로 보존**하고 아래 2가지만 바꾼다:
--     ⓐ v_layout(구 layout) → v_layers(3레이어, 수호 권위 주입 완료).
--     ⓑ authority jsonb 키 layout → layers, modules(코어 모듈 참조 + 공격자 매치업) 추가.
--   card 블록은 M6 경로(defense_cards charges 차감)가 M7b 개명 전까지 살아 있어야 하므로
--   **원문 그대로 유지**한다(미장착이면 키 자체가 없어 거동·해시 불변 — 조건부 접기).
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
  v_card_json   jsonb;
  v_card_id     uuid;
  v_card_config jsonb;
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

  -- T0 권위 고정: L3 수호 슬롯의 성능%·계보 보너스·마일스톤·스냅샷을 라이브 값으로 접는다.
  v_layers := public.inject_guardian_authority(v_def.layout, v_def.profile_id);

  -- ▮ 방어 카드 권위 고정(ADR-0012, M6 — M7b 코어 모듈 개명 전까지 원문 유지).
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

  -- ▮ 코어 모듈 권위(M7a): 모듈 효과값 자체는 직렬화하지 않는다 — 카탈로그 참조(slots)와
  --   매치업만 고정하고, 실제 효력은 클라·EF 가 공유 카탈로그로 결정론 파생한다(위조 표면 축소).
  v_modules := jsonb_build_object(
    'slots', coalesce(v_layers->'l3'->'modules', '[null,null]'::jsonb),
    'matchup', public.build_attacker_matchup(v_me, v_def.profile_id)
  );

  v_authority := jsonb_build_object(
    'layers', v_layers,
    'maintenance', v_def.maintenance,
    'modules', v_modules
  );
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
    'layers',      v_layers,
    'maintenance', v_def.maintenance,
    'modules',     v_modules,
    'card',        v_card_config
  );
end;
$$;

revoke all on function public.begin_invasion(uuid) from public;
revoke all on function public.begin_invasion(uuid) from anon;
grant execute on function public.begin_invasion(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. apply_invasion_result — 20260718160000:305 최신본 **전수 보존** 재선언
-- -----------------------------------------------------------------------------
-- 결정 #4(레인 문서): 침공 쿨다운·복수전·래더 스왑 규칙은 3레이어 대개편에서도 **그대로**다.
-- 따라서 본문은 최신본과 한 줄도 다르지 않다(자기침공 3차 가드·profile_id 오름차순 락·
-- pending 멱등·쿨다운 거부·격차 30 스왑 예외·복수 보너스·복제 약탈·카드 차감 전수 보존).
-- 여기서 다시 선언하는 이유는 "이 마이그레이션 이후의 정본이 무엇인지"를 한 파일에서 읽을 수
-- 있게 하기 위함이며, 카드 차감 블록의 코어 모듈 개명은 M7b-core-modules 레인 소관이다
-- (M7a 에는 모듈 소모 개념이 없다 — l3.modules 는 charges 없는 카탈로그 참조다).
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
-- 8. 매치메이킹 3종 — layout 반환을 3레이어(+정찰 마스킹)로
-- -----------------------------------------------------------------------------
-- 20260718110000 의 본문에서 **layout selector 한 줄만** 치환한다(가드·쿨다운·격차 로직·
-- NPC 필터·복수 데드라인·RETURNS TABLE shape·definer·search_path·grant 전수 보존).
--   get_invasion_targets / get_revenge_targets → invasion_recon_layers(정찰 마스킹)
--   get_placement_targets                     → inject_guardian_authority(정확 layers)
--     ↑ 배치전은 begin_invasion 자격 미달(래더 미진입)이라 라이브 경로가 정본이다.

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
    public.invasion_recon_layers(d.layout),
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
    d.id, public.invasion_recon_layers(d.layout), d.maintenance,
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
-- 잔여 계약 메모(다음 레인·세션 인수인계)
-- =============================================================================
-- ① 수호 슬롯 3자 정합: SQL(이 파일 §4) ↔ EF injectGuardianAuthority(L6) ↔ 클라
--    buildGuardianPlacements(M7b UI). **고정 길이 2, 밀집화 금지, slot i ↔ 활성 수호 i,
--    milestones 포함**이 세 곳에서 비트 동일해야 한다. 하나만 어긋나면 정직한 런이 전량
--    defense-mismatch 로 오거부된다.
-- ② begin_invasion 반환 키가 `layout` → `layers` 로 바뀌었다(+`modules`). 클라 게이트웨이는
--    같은 레인에서 함께 고쳤다(src/net/invasionGateway.ts). EF 는 authority->'layers' 를 읽는다.
-- ③ budget_spent 컬럼은 남아 있으나 의미가 없다(항상 0). 컬럼 제거는 구 클라 소멸(L11) 이후.
-- =============================================================================
