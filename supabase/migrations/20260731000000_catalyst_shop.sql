-- =============================================================================
-- Planet Blitz — 촉매 상점 & 촉매 잔재 (ADR-0042 · 자기 완결 촉매 경제)
-- =============================================================================
-- 근거: docs/adr/0042-catalyst-shop-closed-residue-economy.md ·
--   .omc/plans/catalyst-shop-residue-2026-07-31.md §2단계 · ADR-0027(재화 서버 원장 권위).
--
--   이 파일은 20260726000000_currency_server_authority.sql(가드 트리거 2종)과
--   20260727000000_catalyst_ledger.sql(catalyst_inventory·catalyst_defs·salvage_catalyst)을
--   전제로 그 위에 촉매 잔재 축과 상점 RPC 를 얹는다.
--
-- 담는 것:
--   1. profiles.catalyst_residue 컬럼 신설 — 촉매 잔재 정본(numeric not null default 0, >= 0).
--   2. guard_profiles_client_write 개정 — 기존 8개 봉인 전수 보존 + catalyst_residue(총 9개).
--   3. guard_profiles_client_insert 개정 — 기존 2개 보존 + catalyst_residue := 0(총 3개).
--   4. catalyst_defs.buy_price 컬럼 + 48행 가격 시드(TS 정본 미러, 센티넬 주석 쌍으로 감쌈).
--   5. salvage_catalyst 개정 — grant_currency 경유 폐지, 촉매 잔재 환급으로 전환.
--   6. buy_catalyst 신설 — 촉매 잔재로 공용 촉매 구매.
--
-- ▮ 의미 정본 · 상수 placeholder(전부 // BALANCE — 출시 전 일괄 튜닝, defer-balance-tuning):
--     · CATALYST_BASE_PRICE = 10 — 흔한 촉매(dropWeight=W_COMMON=10) 1장의 구매가.
--         **이 SQL 에는 존재하지 않는다.** 구매가는 TS 가 파생해 catalyst_defs.buy_price 로 시드된다.
--     · SALVAGE_RATIO_PCT = 50 — 분해 환급 비율(%). salvage_catalyst DECLARE 에 constant numeric
--         으로 미러돼 있다(배너=정본·DECLARE 미러 규율). TS src/data/catalysts.ts 의 동명 상수와
--         **수동 미러**이며 tests/catalystShopContract.test.ts 가 본문 리터럴을 추출해 대조한다.
--         ⚠️ int 가 아니라 numeric 이다 — 누군가 결합 순서를 `PCT / 100 * v_price` 로 고쳐 쓸 때
--         int 였다면 정수 나눗셈이 0 이 되어 환급 전액이 조용히 사라진다.
--
-- ▮ 이전 배너 무효화 선언(20260727000000_catalyst_ledger.sql §배너):
--     · **SALVAGE_CREDITS_PER_UNIT(=50) 은 무효다.** 촉매 분해는 더 이상 크레딧을 지급하지 않고
--       grant_currency 를 경유하지 않는다. 그 상수는 이 파일의 salvage_catalyst 본문에서 사라진다.
--     · **CAP_SALVAGE_CREDITS / CAP_SALVAGE_MINERALS 는 사문화되지 않는다.** 장비(코어 모듈) 분해가
--       'salvage' source 로 grant_currency 를 계속 호출한다(src/ui/pixi/hangar.ts:445 ·
--       src/save/settlement.ts:334). 두 캡은 그 경로의 상한으로 계속 유효하다.
--     · 20260727000000 §10 의 salvage_catalyst 코멘트는 이 파일이 재선언한다 —
--       create or replace 는 코멘트를 덮지 않아 재선언하지 않으면 기존 코멘트가 거짓이 된다.
--
-- ▮ 잠금 순서 규약(ABBA 데드락 방지 — 위반 시 단위 테스트·1바퀴 플레이·육안 무엇으로도 안 잡힌다):
--     **catalyst_inventory → profiles 순으로만 잠근다.** salvage_catalyst·buy_catalyst 두 함수
--     모두 이 방향이며, 계약 테스트가 본문의 `for update` 등장 순서를 양쪽 다 단언한다.
--     역순(profiles → inventory)으로 한 문장이라도 옮기면 두 RPC 가 정면 교착한다.
--     ⚠️ 계약 단언은 `for update` 문자열만 본다 — `insert ... on conflict do update` 로 잠기는
--     행은 그 시야 밖이다. 그래서 buy_catalyst 는 가산 대상 inventory 행을 **profiles 를 잠그기
--     전에 확보·잠근다**(② 주석, 보안 리뷰 M-1). 정적 단언이 잠금 전부를 보지는 못한다는 것을
--     계약의 한계로 기록해 둔다.
--
-- ▮ 관측 회귀 경고(보안 리뷰 H-1 — 출시 게이트 항목):
--     이 개정은 촉매 축을 currency_grants 원장과 flagged 자동 플래깅에서 **제거한다**
--     (그 관측은 grant_currency 안에 있었다). grant_catalyst 는 클라 호출 가능한데 누적 캡이
--     없으므로(20260727000000:172 — per-call 100 뿐), 이 파일이 적용된 뒤 촉매 축은
--     **무캡 + 무원장 + 무플래깅**이다. 자원축 촉매는 settle_pve_run 의 캡을 실제로 상향하므로
--     "촉매 밖에서 가치 0"은 잔재에만 참이고 촉매에는 거짓이다.
--     복구 항목: docs/adr/0042 §Follow-ups ⓐ (주체=보안 레인, 출시 전 필수, 미해결 시 출시 차단).
--
-- ▮ no-profile 게이트 이식(방어를 떼면 그 방어가 막던 것을 다시 막는다):
--     이 게이트는 원래 grant_currency 안에 있었다(20260727000000_catalyst_ledger.sql:439-447).
--     salvage_catalyst 가 grant_currency 를 떼면서 함께 사라지므로 두 RPC 에 각각 이식한다.
--       · 분해: 게이트가 없으면 재고는 이미 차감된 뒤 잔재 UPDATE 가 0행을 갱신해 **촉매가 조용히
--         소멸**한다. 위치는 inventory 를 `for update` 로 잠근 뒤 · `update ... set qty` 이전이다
--         (`for update` 앞에 두면 profiles → inventory 가 되어 위 잠금 순서 규약 위반).
--       · 구매: 게이트가 없으면 v_residue 가 null 이라 `v_residue < v_cost` 가 null(≠true)이 되어
--         **부족 게이트를 통과해 잔재 0 으로 무한 구매**가 된다. profiles 잠금과 한 문장이다.
--
-- ▮ TS↔SQL 미러 동기화 의무(필독): catalyst_defs.buy_price 시드는 src/data/catalysts.ts 의
--   CATALYST_PRICE_MIRROR(= catalystBuyPrice 파생)의 SQL 미러다. TS 정본이 바뀌면(CATALYST_BASE_PRICE
--   튜닝, dropWeight 변경, 촉매 추가) 아래 CATALYST_PRICE_SEED_BEGIN/_END 블록도 **함께** 갱신해야
--   한다. 시드는 센티넬 주석 쌍으로 감싸고 한 줄 한 행 형식을 강제한다 — catalyst_defs 에는 이미
--   다른 컬럼 구성의 insert 가 존재하므로(20260727000000:105-122) 센티넬 없이는 계약 테스트의
--   파서가 엉뚱한 블록을 읽고도 통과한다.
--   현재 가격 분포: dropWeight 10 → 10(25종, id 0~24) · 2 → 50(4종, id 25~28) ·
--   1 → 100(1종, id 29) · 8 → 12(12종) · 4 → 25(6종). 합 48행.
--
-- ▮ catalyst_residue 가 numeric 인 이유: credits/minerals 와 같은 표현을 쓴다
--   (20260726000000_currency_server_authority.sql:36-39). 스펙 Ontology 의 "정수" 계약은 TS 산식이
--   항상 정수를 만든다는 사실로 충족되며 컬럼 타입으로 강제하지 않는다(가격 시드가 정수이고
--   환급은 floor 이므로 서버가 만들어내는 값도 항상 정수다).
--
-- 재실행 안전: add column if not exists · create or replace function ·
--   insert ... on conflict do update(멱등 upsert) · comment on(덮어쓰기) ·
--   security definer + set search_path='' + public. 한정 + 끝에 revoke/grant. 부분 실패 후 수렴.
--   ⚠️ search_path='' 함수에서 임시 테이블 금지(pg_temp 가 검색 경로에 없다 — 이 리포 실측 규율).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles.catalyst_residue — 촉매 잔재 정본 컬럼
-- -----------------------------------------------------------------------------
-- 촉매 밖에서 가치가 0인 닫힌 재화(ADR-0042). 외부 유입 경로가 없어(분해만이 유일한 발생원)
-- 누적 캡·원장이 불필요하다. 음수 금지 체크 — 소비 경로(buy_catalyst)가 잔액 부족 시 아무것도
-- 쓰지 않고 가산 경로(salvage_catalyst)만 더한다.
alter table public.profiles
  add column if not exists catalyst_residue numeric not null default 0 check (catalyst_residue >= 0);

-- -----------------------------------------------------------------------------
-- 2. guard_profiles_client_write 개정 — 클라 UPDATE 봉인에 촉매 잔재 추가(8 → 9)
-- -----------------------------------------------------------------------------
-- ⚠️ 기존 봉인 8개(flagged·is_npc·lineage 4종·credits·minerals — 현행 정의:
--   20260726000000_currency_server_authority.sql:75-82)를 **전수 보존**하고 catalyst_residue 만
--   더한다. 재화 봉인은 RLS 가 아니라 이 컬럼 열거식 트리거이므로, 컬럼을 추가하면서 여기를 안
--   고치면 클라가 PostgREST 직타로 잔재를 임의 값으로 써 무한 구매가 된다.
--   계약 테스트가 대입 **총수 9** 와 그 집합을 단언한다.
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
    new.catalyst_residue := old.catalyst_residue;  -- ADR-0042: 촉매 잔재도 서버 권위(RPC 만 write).
  end if;
  return new;
end;
$$;
-- 트리거(trg_profiles_guard, before update)는 초기 스키마에서 이미 정의됨 — 함수 교체로 반영.

-- -----------------------------------------------------------------------------
-- 3. guard_profiles_client_insert 개정 — 클라 INSERT 재화 0 강제에 촉매 잔재 추가(2 → 3)
-- -----------------------------------------------------------------------------
-- 기존 2개(credits·minerals — 20260726000000:100-101) 보존 + catalyst_residue. 신규 프로필은
-- 반드시 0 에서 시작한다(클라가 최초 삽입 시 잔재를 심는 경로 차단 — RLS 는 소유권만 검사).
-- 계약 테스트가 대입 **총수 3** 과 그 집합을 단언한다.
create or replace function public.guard_profiles_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.credits := 0;
    new.minerals := 0;
    new.catalyst_residue := 0;   -- ADR-0042: 신규 프로필의 촉매 잔재는 0.
  end if;
  return new;
end;
$$;
-- 트리거(trg_profiles_guard_insert, before insert)는 20260726000000 에서 이미 정의됨 — 함수 교체로 반영.

-- -----------------------------------------------------------------------------
-- 4. catalyst_defs.buy_price — 구매가 SQL 미러 컬럼 + 48행 시드
-- -----------------------------------------------------------------------------
-- 가격 정본은 TS(src/data/catalysts.ts catalystBuyPrice)이고 SQL 은 **시드된 정수를 조회만** 한다
-- (SQL 은 구매가를 파생하지 않는다 — 미러 축을 하나로 유지해 드리프트 표면을 최소화한다).
-- default 0 은 "가격 미설정" 을 뜻하며 buy_catalyst 가 price-unset 으로 거부한다(신규 촉매가
-- 시드 누락으로 무료 구매되는 것을 차단).
alter table public.catalyst_defs
  add column if not exists buy_price int not null default 0;

-- ⚠️ 아래 블록은 계약 테스트의 파서 앵커다. 형식을 바꾸지 마라 — 센티넬 주석 쌍 사이에서만 잘라
--   읽고, 한 줄에 한 행 `  (id, price),` 형식을 기대한다. TS CATALYST_PRICE_MIRROR 와 전수 대조한다.
-- CATALYST_PRICE_SEED_BEGIN
insert into public.catalyst_defs (catalyst_id, buy_price) values
  (0, 10),
  (1, 10),
  (2, 10),
  (3, 10),
  (4, 10),
  (5, 10),
  (6, 10),
  (7, 10),
  (8, 10),
  (9, 10),
  (10, 10),
  (11, 10),
  (12, 10),
  (13, 10),
  (14, 10),
  (15, 10),
  (16, 10),
  (17, 10),
  (18, 10),
  (19, 10),
  (20, 10),
  (21, 10),
  (22, 10),
  (23, 10),
  (24, 10),
  (25, 50),
  (26, 50),
  (27, 50),
  (28, 50),
  (29, 100),
  (30, 12),
  (31, 12),
  (32, 25),
  (33, 12),
  (34, 12),
  (35, 25),
  (36, 12),
  (37, 12),
  (38, 25),
  (39, 12),
  (40, 12),
  (41, 25),
  (42, 12),
  (43, 12),
  (44, 25),
  (45, 12),
  (46, 12),
  (47, 25)
on conflict (catalyst_id) do update set buy_price = excluded.buy_price;
-- CATALYST_PRICE_SEED_END

-- -----------------------------------------------------------------------------
-- 5. salvage_catalyst 개정 — 크레딧 환급 폐지, 촉매 잔재 환급 (시그니처 불변)
-- -----------------------------------------------------------------------------
-- 20260727000000:626 본문을 기준으로 개정한다:
--   · grant_currency 호출 **제거**(촉매 경제는 자기 안에 닫힌다 — 잔재는 촉매 밖에서 가치 0).
--   · catalyst_defs.buy_price 조회 → floor(price × SALVAGE_RATIO_PCT / 100) × qty 를 잔재로 가산.
--     ⚠️ **결합 순서가 계약이다** — floor 의 닫는 괄호가 `* v_qty` 앞에 온다. 순서를 뒤집어
--     floor(price × pct × qty / 100) 로 쓰면 buy_price=25·qty=3 에서 37 이 되어 TS(36)와 갈린다.
--   · grant_currency 안에 있던 no-profile 게이트를 이식(inventory 잠금 뒤 · 차감 이전).
--   · 잠금 순서 catalyst_inventory → profiles 유지.
-- 반환: 기존 grant_currency 산 필드(granted_*·credits_left·minerals_left·clamped)는 **사라지고**
--   residue·gained 가 실린다. 클라 타입(CatalystSalvageResult)에서 두 잔액 필드를 지워야 소비
--   지점이 컴파일 에러로 드러난다.
create or replace function public.salvage_catalyst(p_catalyst_id int, p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 분해 환급 비율(%). TS src/data/catalysts.ts SALVAGE_RATIO_PCT 미러(배너=정본). // BALANCE
  -- ⚠️ numeric 필수 — int 면 결합 순서를 바꿔 쓸 때 정수 나눗셈이 0 이 되어 전액 손실.
  SALVAGE_RATIO_PCT constant numeric := 50;
  v_me      uuid    := auth.uid();
  v_qty     int     := greatest(0, coalesce(p_qty, 0));
  v_have    int;
  v_price   int;
  v_gain    numeric;
  v_residue numeric;
begin
  if v_me is null then
    raise exception 'salvage_catalyst: 로그인 필요';
  end if;
  if v_qty <= 0 then
    return jsonb_build_object('ok', false, 'note', 'nothing-to-salvage');
  end if;

  -- ① 보유 확인·잠금(read-modify-write 직렬화). 잠금 순서 첫 번째 = catalyst_inventory.
  select qty into v_have
    from public.catalyst_inventory
    where profile_id = v_me and catalyst_id = p_catalyst_id
    for update;
  if not found or v_have < v_qty then
    return jsonb_build_object('ok', false, 'note', 'insufficient', 'have', coalesce(v_have, 0));
  end if;

  -- ② 프로필 행 잠금 + no-profile 게이트(구 재화 지급 경로에서 이식 — 배너 참조). 잠금 순서 두 번째 = profiles.
  --    ⚠️ 이 자리는 ① 의 for update 뒤 · 아래 차감 앞이어야 한다. ① 앞으로 옮기면 buy_catalyst
  --    (inventory → profiles)와 정면 ABBA 데드락이고, 아래 차감 뒤로 옮기면 재고만 사라진다.
  perform 1 from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object('ok', false, 'note', 'no-profile');
  end if;

  -- ③ 가격 게이트 — **차감 이전**이어야 한다(보안 리뷰 M-2).
  --    buy_catalyst 의 price-unset 과 대칭이다. 순서를 뒤집어 차감 뒤에 조회하면, 시드 갱신을
  --    잊은 신규 촉매(buy_price 는 default 0)를 분해할 때 v_gain 이 0 이 되고 거부가 raise 가
  --    아니라 이미 지나간 상태라 롤백도 없어 **재고만 사라진 채 ok:true 가 돌아간다**.
  --    catalyst_defs 조회는 잠금을 잡지 않으므로 이 위치는 잠금 순서 규약에 영향이 없다.
  select buy_price into v_price
    from public.catalyst_defs
    where catalyst_id = p_catalyst_id;
  if not found or coalesce(v_price, 0) <= 0 then
    return jsonb_build_object('ok', false, 'note', 'price-unset');
  end if;

  -- ④ 차감(미차감 방어는 위 게이트들이 담당). qty>=0 check 가 이중 안전.
  update public.catalyst_inventory
    set qty = qty - v_qty
    where profile_id = v_me and catalyst_id = p_catalyst_id;

  -- ⑤ 환급액 산정 — 장당 절하, 그 다음 수량 곱(결합 순서 계약).
  v_gain := floor(v_price * SALVAGE_RATIO_PCT / 100) * v_qty;

  -- ⑥ 잔재 가산(definer 라 guard 통과). RETURNING 으로 갱신 잔액 확보.
  update public.profiles
    set catalyst_residue = catalyst_residue + v_gain
    where id = v_me
    returning catalyst_residue into v_residue;

  return jsonb_build_object(
    'ok', true,
    'catalyst_id', p_catalyst_id,
    'salvaged', v_qty,
    'gained', v_gain,
    'residue', v_residue
  );
end;
$$;

revoke all on function public.salvage_catalyst(int, int) from public;
revoke all on function public.salvage_catalyst(int, int) from anon;
grant execute on function public.salvage_catalyst(int, int) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. buy_catalyst — 촉매 잔재로 공용 촉매 구매 (user JWT, SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- 공용 30종(catalyst_defs.planet is null)만 판다 — 특산은 분해만 되고 되살 수 없다(ADR-0042 §결정 4).
-- 특산을 팔면 그 행성에 한 번도 가지 않고 그 행성 특산을 쥐게 되어 종류 축 차별화가 무너진다.
--
-- ⚠️ CAP_BUY_PER_CALL 을 두지 않는다 — 잔재 잔고 자체가 상한이고 잔재의 외부 유입이 0이다.
--   캡을 두면 대량 구매가 조용히 절삭되는 UX 함정만 생긴다.
-- ⚠️ 카탈로그 게이트(unknown/signature/price-unset)를 **잠금 이전에** 끝낸다 — 그래야 그 뒤의
--   inventory 행 확보에 공용 촉매만 도달한다. 잔재 가산·차감은 모든 게이트 통과 후 마지막이다.
--   inventory 행 확보를 그 자리에 두는 이유(잠금 순서 강제)와 유령 행 논증은 ② 주석 참조.
--   ⚠️ 계획(HIGH-4)은 "행을 미리 만들지 않는다"였고 근거는 "행이 없으면 경합 상대가 없다"였다.
--   보안 리뷰 M-1 이 그 논증의 구멍을 찾았다 — grant_catalyst 가 그 사이 행을 만들 수 있다.
--   그래서 결론을 뒤집었다. 유령 행 위험은 게이트 뒤 배치로 상쇄된다(② 주석).
--
-- 거부 사유: unknown-catalyst · signature-not-sold · price-unset · no-profile ·
--   insufficient-residue · nothing-to-buy. 반환 { ok, catalyst_id, bought, spent, residue }.
create or replace function public.buy_catalyst(p_catalyst_id int, p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_qty     int  := greatest(0, coalesce(p_qty, 0));
  v_price   int;
  v_planet  int;
  v_cost    numeric;
  v_residue numeric;
begin
  if v_me is null then
    raise exception 'buy_catalyst: 로그인 필요';
  end if;
  if v_qty <= 0 then
    return jsonb_build_object('ok', false, 'note', 'nothing-to-buy');
  end if;

  -- ① 카탈로그 게이트 3종(미지 id · 특산 · 가격 미설정). 잠금 이전에 끝낸다.
  select buy_price, planet into v_price, v_planet
    from public.catalyst_defs
    where catalyst_id = p_catalyst_id;
  if not found then
    return jsonb_build_object('ok', false, 'note', 'unknown-catalyst');
  end if;
  if v_planet is not null then
    return jsonb_build_object('ok', false, 'note', 'signature-not-sold');
  end if;
  if coalesce(v_price, 0) <= 0 then
    return jsonb_build_object('ok', false, 'note', 'price-unset');
  end if;

  -- ② 보유 원장 행을 **확보한 뒤** 잠근다. 잠금 순서 첫 번째 = catalyst_inventory.
  --    ⚠️ 보안 리뷰 M-1 — 조건부 잠금("있을 때만")은 ABBA 창을 남긴다. 행이 없으면 여기서 락을
  --    0개 잡고 ③ 에서 profiles 를 잠근 뒤 ⑥ 의 on conflict 가 같은 inventory 행을 건드리므로,
  --    그 행에 한해 실제 획득 순서가 **profiles → inventory** 로 역전된다. 계획은 "행이 없으면
  --    salvage_catalyst 가 보유 행을 전제하므로 경합 상대가 없다"고 논증했으나 이는 행의 부재가
  --    상대 트랜잭션 전 구간에 유지된다는 가정을 숨긴다 — grant_catalyst(클라 호출 가능·런 종료
  --    드랍 적립)가 그 사이에 행을 만들면 가정이 깨지고 교착이 성립한다. 더해 ⑦ 은 `for update`
  --    문자열이 아니라서 계약 단언 6의 시야 밖이다(정적 단언만으로는 못 잡는 창).
  --    ⚠️ 유령 행(계획 HIGH-4) 우려는 여기서 성립하지 않는다: 이 지점은 signature-not-sold ·
  --    price-unset 게이트 뒤라 **공용 촉매만 도달**하고, catalyst_inventory 는 스냅샷이라
  --    qty=0 행은 미보유와 동치다. HIGH-4 가 막으려던 것은 "한 번도 얻은 적 없는 특산이 원장에
  --    나타나는 것"이었고 그것은 여전히 불가능하다.
  insert into public.catalyst_inventory (profile_id, catalyst_id, qty)
    values (v_me, p_catalyst_id, 0)
  on conflict (profile_id, catalyst_id) do nothing;

  perform 1
    from public.catalyst_inventory
    where profile_id = v_me and catalyst_id = p_catalyst_id
    for update;

  -- ③ 프로필 행 잠금 + no-profile 게이트(한 문장 — 나누면 순서가 뒤집힐 여지가 생긴다).
  --    ⚠️ 게이트가 없으면 v_residue 가 null 이라 아래 `v_residue < v_cost` 가 null(≠true)이 되어
  --    부족 게이트를 통과하고 잔재 0 으로 무한 구매가 된다. 잠금 순서 두 번째 = profiles.
  select catalyst_residue into v_residue
    from public.profiles
    where id = v_me
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'note', 'no-profile');
  end if;

  -- ④ 잔재 충분성(부족이면 미차감 반환). int 곱 오버플로 방어로 numeric 승격.
  v_cost := v_price::numeric * v_qty;
  if v_residue < v_cost then
    return jsonb_build_object(
      'ok', false, 'note', 'insufficient-residue',
      'required', v_cost, 'residue', v_residue
    );
  end if;

  -- ⑤ 차감(definer 라 guard 통과). check (catalyst_residue >= 0) 가 이중 안전.
  update public.profiles
    set catalyst_residue = catalyst_residue - v_cost
    where id = v_me
    returning catalyst_residue into v_residue;

  -- ⑥ 원장 가산 — 모든 게이트를 통과한 **마지막**에만 행을 만든다(유령 행 방지).
  insert into public.catalyst_inventory (profile_id, catalyst_id, qty)
    values (v_me, p_catalyst_id, v_qty)
  on conflict (profile_id, catalyst_id) do update
    set qty = public.catalyst_inventory.qty + v_qty;

  return jsonb_build_object(
    'ok', true,
    'catalyst_id', p_catalyst_id,
    'bought', v_qty,
    'spent', v_cost,
    'residue', v_residue
  );
end;
$$;

revoke all on function public.buy_catalyst(int, int) from public;
revoke all on function public.buy_catalyst(int, int) from anon;
grant execute on function public.buy_catalyst(int, int) to authenticated, service_role;

-- =============================================================================
-- 7. 오브젝트 코멘트 — create or replace 는 코멘트를 덮지 않으므로 재선언한다
-- =============================================================================
comment on column public.profiles.catalyst_residue is
  '촉매 잔재(ADR-0042). 촉매 분해로만 발생하고 촉매 구매로만 소비되는 닫힌 재화. 서버 권위(가드 트리거 봉인).';
comment on column public.catalyst_defs.buy_price is
  '촉매 구매가 SQL 미러(TS src/data/catalysts.ts catalystBuyPrice 정본). 0 = 미설정 → buy_catalyst 가 price-unset 거부.';
comment on function public.salvage_catalyst(int, int) is
  '촉매 분해: 보유 차감 + 촉매 잔재 환급 floor(buy_price×50/100)×qty. grant_currency 미경유(크레딧 지급 없음). 거부 nothing-to-salvage/insufficient/no-profile/price-unset(전부 미차감). 반환 { ok, catalyst_id, salvaged, gained, residue }. user JWT.';
comment on function public.buy_catalyst(int, int) is
  '촉매 구매: 촉매 잔재 차감 + 원장 가산. 공용(planet is null)만. 거부 unknown-catalyst/signature-not-sold/price-unset/no-profile/insufficient-residue/nothing-to-buy. user JWT.';

-- =============================================================================
-- 8. 검증 시나리오(리드용) — 실 Supabase 관통 테스트 논증
-- =============================================================================
-- ▮ S1. 분해 → 잔재 발생(공용):
--   grant_catalyst(0, 3) 후 salvage_catalyst(0, 3)
--     → buy_price(0)=10, floor(10×50/100)=5, ×3 = **15**. profiles.catalyst_residue += 15.
--     반환 { ok:true, salvaged:3, gained:15, residue:15 }. credits/minerals **불변**(grant_currency 미경유).
--
-- ▮ S2. 결합 순서(floor 위치) 고정 검증 — 특산 보스 촉매(buy_price=25):
--   salvage_catalyst(32, 3) → floor(25×50/100)=12, ×3 = **36**. 37 이 나오면 결합 순서가 뒤집힌 것
--   (floor(25×50×3/100)=37). TS catalystSalvageValue(32)×3 = 36 이 정본이다.
--
-- ▮ S3. 구매 게이트 3종:
--   buy_catalyst(999, 1) → 'unknown-catalyst'(catalyst_defs 미존재).
--   buy_catalyst(30, 1)  → 'signature-not-sold'(planet=0 → 특산).
--   buy_price 를 0 으로 되돌린 신규 id → 'price-unset'.
--   buy_catalyst(0, 0)   → 'nothing-to-buy'. 잔재 0 인 계정의 buy_catalyst(0,1) → 'insufficient-residue'
--   (잔재·원장 **모두 불변** — 유령 행이 생기지 않았는지 catalyst_inventory 로 확인).
--
-- ▮ S4. 가드레일 #2 재확인(장비 분해는 여전히 grant_currency 경유):
--   salvage_core_module(<module_id>) → grant_currency(v_value, 0, 'salvage', null) 경로가 그대로다.
--   CAP_SALVAGE_CREDITS(20000)/CAP_SALVAGE_MINERALS(20000) 는 이 경로의 상한으로 **계속 유효**하다.
--   설령 클라가 metrics 에 resourceMult 를 심어도 grant_currency 는 p_source='pve_run' 에서만
--   읽으므로 salvage 캡은 불변(v_res_mult=1). 촉매 분해는 이 경로를 더 이상 타지 않는다.
--
-- ▮ S5. 클라 직타 봉인 실증(CRIT-1):
--   authenticated JWT 로 PATCH /rest/v1/profiles?id=eq.<me> { "catalyst_residue": 999999 }
--     → guard_profiles_client_write 가 old 값으로 되돌려 **값 불변**.
--   authenticated JWT 로 POST /rest/v1/profiles { "id":..., "catalyst_residue": 999999 }
--     → guard_profiles_client_insert 가 0 강제.
--
-- ▮ S6. 잠금 순서(ABBA) — 데드락은 실행 중 재현이 어려워 정적 검증에 의존한다:
--   두 함수 본문의 `for update` 등장 순서가 **catalyst_inventory → profiles** 로 동일함을
--   tests/catalystShopContract.test.ts 가 단언한다.
--   ⚠️ 다만 그 단언은 `for update` 문자열만 보므로 **잠금 전부를 보지는 못한다** — 암묵 잠금
--   (`insert ... on conflict do update`, 외래키 검사 등)은 시야 밖이다. buy_catalyst 의 ② 가
--   inventory 행을 선확보·선잠금하는 것은 그 사각을 코드 배치로 닫은 것이다(보안 리뷰 M-1).
--   새 write 문장을 추가할 때는 단언 통과에 기대지 말고 실제 획득 순서를 손으로 따져라.
--
-- ▮ S7. 가격 시드 확장 시 주의(보안 리뷰 L-1):
--   §4 의 2열 insert 는 resource_mult(default 0)·planet(NULL)을 지정하지 않는다. 이 블록에만
--   id 를 추가하고 20260727000000 의 3열 시드를 빠뜨리면 **planet IS NULL 행이 생겨 신규 촉매가
--   공용으로 팔린다**(특산이어야 하는데). 계약 단언 9(세 술어 일치 — planet is null 집합 ==
--   TS purchasable 집합 == id < 30)가 이 어긋남을 CI 에서 먼저 잡는다. 그 단언을 약화하지 마라.
-- =============================================================================
