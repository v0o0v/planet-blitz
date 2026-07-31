# 계획: 촉매 상점 & 촉매 잔재

- 상태: **pending approval** (합의 완료 — Critic **APPROVED**, CRITICAL 0 · MAJOR 0. 실행 승인은 별도)
- 입력: `.omc/specs/deep-interview-catalyst-shop.md` (앰비규어티 12%) · `docs/adr/0042-catalyst-shop-closed-residue-economy.md` · `CONTEXT.md`
- 모드: consensus (RALPLAN-DR short) · direct · non-interactive
- 작성: 2026-07-31 · **개정 4** — 합의 루프 2회전 완료(Architect 1차 CRIT 2·HIGH 3 → Critic 1차 CRIT 1·MAJOR 8 → Architect 2차 HIGH 2·MED 3 → Critic 2차 MAJOR 1·MED 2·MIN 5, 전부 반영)

## RALPLAN-DR 요약

### Principles

1. **촉매 경제는 자기 안에 닫힌다** — 잔재는 촉매 밖에서 가치가 0이고, 촉매 총량이 늘어나는 경로를 만들지 않는다.
2. **SQL 은 구매가를 파생하지 않는다** — 환급 비율 하나만 미러하며, **그 미러와 결합 순서를 테스트가 지킨다**. (초안의 "SQL 에 산식이 존재하지 않는다"는 과했고, 개정 2의 "자체 가격 지식을 갖지 않는다"도 부정확했다 — SQL 은 `SALVAGE_RATIO_PCT` 를 안다. 아래 §P2 참조.)
3. **미러는 테스트가 지킨다** — 사람이 지켜야 하는 동기화 의무는 반드시 깨진다. 깨지면 CI 가 먼저 안다.
4. **sim 을 건드리지 않는다** — 이미 커밋된 기준선과의 대조가 통과하고 `src/sim`·`tests/fixtures` 가 무변경임을 보인다. **기준선을 다시 녹화하지 않는다.**
5. **화면에서 본 것만 완료다** — 배선 존재는 표시 증명이 아니다.
6. **재화 컬럼은 봉인이 기본값이다** — `profiles` 에 재화를 더하는 것은 컬럼 추가가 아니라 **가드 트리거 개정**이다.
7. **방어를 떼면 그 방어가 막던 것을 다시 막아야 한다** — `grant_currency` 를 우회하면 그 안에 있던 게이트(`no-profile`)도 함께 사라진다.

#### §P2 재논증 — `salvage_value` 컬럼을 만들지 않는다

개정 1은 P2 를 위해 `catalyst_defs.salvage_value` 컬럼을 추가하고 SQL 에서 산식을 완전히 제거하려 했다. **철회한다.** 근거:

- 반올림 발산 위험이 실재하지 않는다 — `floor` 는 **양수에서 JS 와 PostgreSQL 이 동일**하다. P2 가 방어하려던 것이 이 경우에는 없는 위험이었다.
- 컬럼을 추가하면 TS↔SQL 미러 축이 1개 → 2개가 되어 **드리프트 표면이 두 배**가 된다. 이는 Decision Driver 2(조용한 드리프트 차단)와 정면으로 자기 충돌한다.
- 따라서 SQL 은 `floor(buy_price * SALVAGE_RATIO_PCT / 100)` 를 유지하고, 미러는 `buy_price` **하나**로 둔다. 대신 계약 테스트가 **TS `SALVAGE_RATIO_PCT` ↔ SQL 본문 리터럴**을 대조한다(새 단언).

### Decision Drivers (상위 3)

1. **치팅 표면을 늘리지 않는다**
2. **조용한 드리프트 차단**
3. **구현량 최소**

### Viable Options

옵션 공간은 2축이다 — ⓐ `grant_currency` 캡 파이프 경유 여부, ⓑ 잔재 변동 원장 보유 여부.

| # | 캡 경유 | 변동 원장 | 판정 |
|---|---|---|---|
| A | 아니오 | 없음 | **채택** |
| B | 예 | `currency_grants` | 기각 |
| C | 아니오 | 신규 전용 테이블 | 기각(개정 1 채택 → 개정 2 철회) |
| D | 아니오 | `currency_grants` 재사용 | 기각 |

**A — 컬럼만, 원장 없음 (채택)**
- 장점: 캡 쿼리 무변경 · 테이블 0개 · driver 3 정합 · ADR-0042 의 결정을 그대로 이행(문서 개정 불요)
- 단점: 잔재 변동 이력이 남지 않는다. `catalyst_inventory` 는 스냅샷이라(`20260727000000_catalyst_ledger.sql:66-71`) 역산도 불가

**B — `grant_currency` 편입**
- 단점: 외부 유입이 0이라 **영영 발동하지 않을 캡 3종**을 캡 테이블에 넣는 모순 · `settle_pve_run` 등 무관 호출부 시그니처 영향

**C — 신규 전용 원장 테이블**
- 개정 1에서 채택했다가 철회. 기각 사유: **읽는 주체가 없다.** 조사 쿼리·플래깅·GC 가 계획 어디에도 없었고, 이 리포의 원장 계열은 전부 TTL/GC 를 갖는데(`20260726000100_invasion_replay_ttl.sql`, `planet-blitz-gc-orphan-pending-pve-runs`) 이것만 없었다. 읽는 사람도 지우는 사람도 없는 원장은 관측이 아니라 저장이다. 더 결정적으로, 이 원장이 겨냥한 결함(`grant_catalyst` 누적 캡 부재)은 계획 스스로 **레인 밖으로 명시**했다 — 고치지 않기로 한 결함을 위해 테이블을 추가하는 것은 driver 3 과 화해되지 않는다.

**D — `currency_grants` 재사용**
- 검토: 테이블·인덱스·RLS 관례가 이미 있고(`20260726000200_pve_settlement.sql:56-76`), 잔재 행은 `credits`/`minerals` 가 0이라 캡 합산(`:450-457`)을 오염시키지 않는다. 테이블 0개로 원장을 얻는다.
- 기각 사유: 잔재 `delta`·`ref_catalyst_id` 를 실을 컬럼이 없다. `credits` 에 잔재를 넣는 것은 **스키마 오용**이고(그 컬럼의 의미가 "지급된 크레딧"이다), 컬럼을 추가하면 C 와 같은 비용이 든다. 캡 합산 쿼리가 잔재 행까지 스캔하게 되는 부수도 있다.

**Invalidation rationale**: 관측 필요성의 진짜 출처는 잔재가 아니라 **`grant_catalyst` 가 클라 호출 가능한데 누적 캡이 없다**는 별개 결함이다(`20260727000000_catalyst_ledger.sql:172` — `CAP_GRANT_PER_CALL = 100` 1회 상한뿐). 그 결함은 이 레인 밖이고, **그 자리에서 고치는 것이 원장을 우회로로 쓰는 것보다 옳다.** 이 레인은 A 로 가고, 누적 캡 부재는 별도 항목으로 남긴다(§Follow-ups).

**A 채택이 감수하는 것**: 분해에서 `grant_currency` 를 떼면 하류 캡·플래깅이 촉매 축을 관측하지 못한다. 미출시 상태이고, 관측이 필요해지는 시점은 `grant_catalyst` 누적 캡을 다룰 때이므로 그때 함께 설계한다.

## 요구사항 요약

촉매 보관함 안에 **통합 단일 목록**을 만들어 한 행에서 분해(→ 촉매 잔재)와 구매(← 촉매 잔재)를 모두 처리한다. 공용 30종만 구매 가능, 특산 18종은 분해만 가능.

## 수용 기준

스펙의 **16개** 기준(`.omc/specs/deep-interview-catalyst-shop.md:63-78`)을 승계하되 **AC #1 을 개정**한다(CRIT-2). 추가 기준:

- [ ] `salvage_catalyst`·`buy_catalyst` 유효 본문에 `no-profile` 게이트가 있고, 분해에서는 **`select qty ... for update` 직후·`update ... set qty` 이전**에 위치한다(`for update` 앞이면 ABBA)
- [ ] `guard_profiles_client_write` 유효 본문의 `new.<컬럼> := old.<컬럼>` 대입이 **정확히 9개**이고 그 집합이 `{flagged, is_npc, lineage_points, lineage_ship_level, lineage_guardian_level, lineage_last_retired_at, credits, minerals, catalyst_residue}` 와 같다
- [ ] `guard_profiles_client_insert` 유효 본문의 `new.<컬럼> := 0` 대입이 정확히 3개(`credits`·`minerals`·`catalyst_residue`)다
- [ ] `catalyst_defs` 가격 시드 파싱 결과가 **정확히 `CATALYSTS.length` 행**이고, 각 행이 `CATALYST_PRICE_MIRROR` 와 일치한다
- [ ] SQL 본문의 환급 비율 리터럴이 TS `SALVAGE_RATIO_PCT` 와 일치한다
- [ ] `salvage_catalyst` 유효 본문에 `grant_currency` 호출이 없고, `catalyst_defs` 조회는 **있다**(부재 단언만으로는 빈 구현을 못 막는다)
- [ ] **구매 가능성 세 술어가 일치한다** — SQL 시드의 `planet is null` 집합 == TS `kind === 'common'` 집합 == `id < 30` 집합
- [ ] **`salvage_catalyst`·`buy_catalyst` 양쪽 모두** `catalyst_inventory` → `profiles` 순으로 잠근다
- [ ] `buy_price <= 0` 인 촉매는 구매가 거부된다(`price-unset`)
- [ ] `pnpm test` 의 `encounterHashInvariance`·`invasionHash`·`shipHashBaseline` 3종이 통과하고, **`git diff --stat main...HEAD -- tests/fixtures/ src/sim/`** 와 `git status --porcelain tests/fixtures/` 가 **모두 빈 출력**이다 (NEW-2 — 두 축을 같은 방식으로. fixtures 에 `git status` 만 걸면 고쳐서 **커밋한** 경우가 통과한다)
- [ ] 목록이 **48종 전부**를 표시하고, 미보유 행은 분해 비활성·사유 표시된다

## 구현 단계

### 1단계 — TS 가격 정본 (`src/data/catalysts.ts`)

```
CATALYST_BASE_PRICE = 10          // BALANCE
SALVAGE_RATIO_PCT   = 50          // BALANCE
catalystBuyPrice(id)     = Math.floor(CATALYST_BASE_PRICE * W_COMMON / def.dropWeight)
catalystSalvageValue(id) = Math.floor(catalystBuyPrice(id) * SALVAGE_RATIO_PCT / 100)
catalystIsPurchasable(id) = def.kind === 'common'
CATALYST_PRICE_MIRROR: { catalystId, buyPrice, purchasable }[]   // CATALYSTS.length 행
```

**CRIT-2 해소** — `W_SIGNATURE = 8`(`src/data/catalysts.ts:90`) 이라 `10×10/8 = 12.5` 로 특산 12종이 비정수다. **`Math.floor` 로 확정**하고 스펙 AC #1 을 *"48종 전부에 대해 **정수로 절하한** 값을 반환한다"* 로 개정한다.

기대값(전수): 흔한(w=10) **10/5** · 파워축(w=2) **50/25** · ascendant(w=1) **100/50** · 특산 일반(w=8) **12/6** · 특산 보스(w=4) **25/12**

`purchasable` 을 미러에 싣는 이유는 MAJ-4 — 구매 가능성이 TS·SQL·스펙 세 곳에 서로 다른 술어로 적히면 조용히 갈린다(`tests/coreModuleSlotContract.test.ts:11` 이 이 리포에서 실제로 갈렸던 사례를 기록한다).

### 2단계 — 마이그레이션 (`supabase/migrations/2026073100000?_catalyst_shop.sql`)

배너에 **의미 정본 · 캡 상수 placeholder 목록 · 재실행 안전성 · TS↔SQL 동기화 의무 · 잠금 순서 규약 · 이전 배너 무효화 선언**을 쓴다(기존 파일의 "배너=정본·DECLARE 미러" 규율, `20260727000000_catalyst_ledger.sql:41`).

1. `alter table public.profiles add column if not exists catalyst_residue numeric not null default 0 check (catalyst_residue >= 0)`
   - `numeric` 인 이유: `credits`/`minerals` 와 같은 표현(`20260726000000_currency_server_authority.sql:36-39`). 스펙 Ontology 의 "정수" 계약은 **TS 산식이 항상 정수를 만든다**는 사실로 충족되며, 컬럼 타입으로 강제하지 않는다
2. **`create or replace function public.guard_profiles_client_write()`** — 기존 **8개** 대입(`20260726000000_currency_server_authority.sql:75-82`)을 전수 보존 + `new.catalyst_residue := old.catalyst_residue;`
3. **`create or replace function public.guard_profiles_client_insert()`** — 기존 2개(`:100-101`) 보존 + `new.catalyst_residue := 0;`
4. `alter table public.catalyst_defs add column if not exists buy_price int not null default 0`
5. 가격 시드 — **파서가 앵커로 쓸 리터럴 형상을 여기서 확정한다**(MAJ-2):
   ```sql
   -- CATALYST_PRICE_SEED_BEGIN
   insert into public.catalyst_defs (catalyst_id, buy_price) values
     (0, 10),
     (1, 10),
     ...
   on conflict (catalyst_id) do update set buy_price = excluded.buy_price;
   -- CATALYST_PRICE_SEED_END
   ```
   주석 센티넬 쌍으로 감싼다 — `catalyst_defs` 에는 **이미 다른 컬럼 구성의 insert 가 존재**하므로(`20260727000000_catalyst_ledger.sql:105-122`) 소박한 정규식은 엉뚱한 블록을 파싱하고도 통과한다. 한 줄 한 행 형식을 강제한다
6. `create or replace function public.salvage_catalyst` — 본문 교체:
   - **`no-profile` 게이트**(CRIT-A) — 위치를 정확히 못 박는다(NEW-1): inventory 행을 **`select qty ... for update` 로 잠근 직후**, `update ... set qty = qty - v_qty` **이전**에 둔다.
     `perform 1 from public.profiles where id = v_me for update; if not found then return jsonb_build_object('ok', false, 'note', 'no-profile'); end if;`
     ⚠️ **`for update` 앞에 두면 profiles → inventory 순서가 되어 `buy_catalyst`(inventory → profiles)와 정면 ABBA 데드락**이다 — CRIT-A 수정이 HIGH-1 을 되살린다. "차감 이전"만으로는 이 두 배치가 모두 성립하므로 지점을 지정한다.
     ⚠️ 이 게이트는 원래 `grant_currency` 안에 있었다 — 유효 정의는 **`20260727000000_catalyst_ledger.sql:439-447`**(이 파일이 `20260726000200_pve_settlement.sql` 의 `grant_currency` 를 개정한다, 배너 `:22`). `grant_currency` 를 떼면 함께 사라지고, **재고는 이미 차감된 뒤 잔재 UPDATE 가 0행을 갱신해 촉매가 조용히 소멸**한다
   - `grant_currency` 호출 제거. `catalyst_defs.buy_price` 조회 → `v_gain := floor(v_price * SALVAGE_RATIO_PCT / 100) * v_qty`
     - `SALVAGE_RATIO_PCT` 는 DECLARE 에 `constant numeric := 50` 으로 둔다(MIN-2). **`int` 로 두면 안 된다** — 이 결합 순서에서는 무해하나, 누군가 `PCT / 100 * v_price` 로 고쳐 쓰면 정수 나눗셈이 `0` 이 되어 **전액 손실**이다. 단언 5의 정규식은 DECLARE 의 리터럴을 추출한다(기존 `SALVAGE_CREDITS_PER_UNIT` 선례 `:633` 과 같은 자리)
   - 잠금 순서 **inventory → profiles** 유지(`:647-650` → `grant_currency` 의 profiles 잠금 `:439` 와 동일 방향)
   - `profiles.catalyst_residue` 가산. 반환 jsonb 에 `residue`·`gained` 추가. 시그니처 불변
7. `create or replace function public.buy_catalyst(p_catalyst_id int, p_qty int)` 신설:
   - `auth.uid()` null → raise · `qty <= 0` → `nothing-to-buy`
   - **`CAP_BUY_PER_CALL` 을 두지 않는다** — 잔재 잔고 자체가 상한이고 외부 유입이 0이다. 캡을 두면 대량 구매가 조용히 절삭되는 UX 함정만 생긴다
   - `catalyst_defs` 조회: 미존재 → `unknown-catalyst` · `planet is not null` → `signature-not-sold` · **`buy_price <= 0` → `price-unset`**(미래 신규 촉매의 default 0 무료 구매 차단)
   - **잠금 순서 `catalyst_inventory` → `profiles`**(HIGH-1 — 역순이면 `salvage_catalyst` 와 ABBA 데드락). 단 **행을 미리 만들지 않는다**(HIGH-4): 기존 행이 있으면 `for update`, 없으면 잠금을 생략한다. `salvage_catalyst` 는 보유 행이 존재해야만 진행하므로(`20260727000000_catalyst_ledger.sql:647-651`) "행 없음" 케이스에서는 애초에 경합 상대가 없어 ABBA 가 성립하지 않는다. 가산은 **모든 게이트를 통과한 뒤 마지막에** `insert ... on conflict do update` 로 한다
     ⚠️ 개정 2의 `insert ... on conflict do nothing` 선행 생성은 **폐기**한다 — 이후 거부가 `raise` 가 아니라 `return jsonb_build_object('ok', false, ...)` 라서 롤백되지 않고, **`qty = 0` 유령 행이 커밋된다**. 잔재 부족으로 실패할 때마다 원장이 조용히 오염되고, 게이트 순서를 바꾸면 한 번도 얻은 적 없는 특산이 원장에 나타난다
   - `profiles` 잠금과 **`no-profile` 게이트는 같은 문장이다**(MIN-4 — 별개 항목으로 나열하면 두 번 쓰거나 순서를 뒤집을 여지가 생긴다): `select catalyst_residue into v_residue from public.profiles where id = v_me for update; if not found then return ... 'no-profile'; end if;`
     ⚠️ 이 게이트가 없으면 `v_residue` 가 null 이 되고 `if v_residue < v_cost` 가 null(≠true)이라 **부족 게이트를 통과해 잔재 0으로 무한 구매**가 된다(CRIT-A)
   - 잔재 부족 → `insufficient-residue` (미차감)
   - 차감 + inventory 가산(`set qty = public.catalyst_inventory.qty + v_qty` — 스키마 한정 관용구 `:187`)
   - 반환 `{ok:true, catalyst_id, bought, spent, residue}` · `security definer` · `set search_path = ''` · revoke/grant
8. **잔여물 정리**: `comment on function public.salvage_catalyst(int,int)` 재선언(`create or replace` 는 코멘트를 덮지 않아 기존 `:707-708` 이 거짓이 된다) · 새 배너에 `SALVAGE_CREDITS_PER_UNIT` 무효화 명시 · 기존 파일 §11 검증 시나리오 **S4 는 `salvage_core_module`(장비 계열) 기준으로 새로 쓴다** — 촉매 예시를 단순 치환할 수 없다(다른 RPC다)
   - ⚠️ `CAP_SALVAGE_CREDITS`/`CAP_SALVAGE_MINERALS` 는 **사문화되지 않는다** — 장비 분해가 `'salvage'` source 를 계속 쓴다(`src/ui/pixi/hangar.ts:445`, `src/save/settlement.ts:334`). ADR-0042 §부수의 해당 문구를 정정한다

⚠️ `search_path=''` 함수에서 임시 테이블 금지(실측 규율).

### 3단계 — 계약 테스트 (`tests/catalystShopContract.test.ts`)

`tests/coreModuleSlotContract.test.ts:35-58` 의 `migrationsInOrder()`/`effectiveFunctionBody()` 를 재사용하되, **함수 본문 전용 헬퍼로는 닿지 않는 항목**이 있으므로 두 헬퍼를 신규로 명시한다(MAJ-2):

- `rawMigrationText()` — 적용 순 전체 SQL 원문 연결(DDL 스캔용)
- `catalystPriceSeedRows()` — `CATALYST_PRICE_SEED_BEGIN`/`_END` 센티넬 사이만 잘라 `(id, price)` 튜플 파싱
- `catalystDefsSeedRows()` — 단언 9(세 술어 일치)가 필요로 하는 `planet` 값은 **이번 마이그레이션이 아니라 기존 3열 시드**(`20260727000000_catalyst_ledger.sql:105-122`)에 있다. 그 블록은 센티넬이 없고 이미 원격 적용돼 소급 편집이 금기이므로, **완전한 컬럼 리스트 문자열**을 앵커로 잡는다 — `insert into public.catalyst_defs (catalyst_id, resource_mult, planet) values`. 새 2열 블록(`(catalyst_id, buy_price)`)과 충돌하지 않고 유일하게 특정된다. 이 헬퍼가 없으면 실행자가 느슨한 정규식을 쓰거나 단언 9를 조용히 생략한다

단언 목록(**파싱 행 수 선행 단언을 먼저** — 0행 파싱 시 `toEqual` 이 공허하게 통과한다):

1. `catalystPriceSeedRows().length === CATALYSTS.length` → 그 다음 값 대조
2. `guard_profiles_client_write` 본문의 `new.X := old.X` 대입 **총수 9** + 집합 일치
3. `guard_profiles_client_insert` 본문의 `new.X := 0` 대입 **총수 3** + 집합 일치
4. `salvage_catalyst` 본문: `grant_currency` **부재** + `catalyst_defs` 조회 **존재** + `no-profile` 존재
5. `salvage_catalyst` 본문의 환급 비율 리터럴이 TS `SALVAGE_RATIO_PCT` 와 일치(정규식으로 추출해 값 비교 — 문자열 부재 단언이 아니다) **+ `floor(...)` 닫는 괄호가 `* v_qty` 앞에 온다**(= `v_qty` 가 `floor(` 안에 없다). 실재하는 발산은 비율이 아니라 **결합 순서**에 있다 — `floor(price*pct/100)*qty` 와 `floor(price*pct*qty/100)` 은 `buy_price=25·qty=3` 에서 **36 vs 37** 로 갈리고, TS(`catalystSalvageValue(id) * qty`)는 36이다. 비율만 보는 단언은 순서가 뒤집혀도 통과한다
6. **`salvage_catalyst`·`buy_catalyst` 양쪽 모두** 본문의 `for update` 등장 순서가 inventory → profiles (NEW-1 — 한 함수만 보면 계약이 반쪽이고, CRIT-A 수정이 분해 쪽에서 순서를 뒤집어도 통과한다. `tests/coreModuleSlotContract.test.ts:129-147` 이 "장착 해제 경로 3종 전부"에 같은 단언을 거는 관례를 따른다). 데드락은 단위 테스트·실세션 1바퀴·육안 중 **무엇으로도 안 잡히므로** 계약 단언이 유일한 방어다
7. `buy_catalyst` 본문: `price-unset`·`signature-not-sold`·`insufficient-residue`·`no-profile` 존재
8. `rawMigrationText()`: `profiles.catalyst_residue` 컬럼 선언 + `>= 0` 체크 존재
9. **세 술어 일치**(MAJ-4): 시드 `planet is null` 집합 == `CATALYST_PRICE_MIRROR` 의 `purchasable` 집합 == `id < 30` 집합
   - `id < 30` 은 **하드코딩 경계로 유지한다**(`kind === 'signature'` 파생으로 바꾸지 않는다). 파생시키면 세 번째 술어가 두 번째와 같은 소스가 되어 **독립 증인이 3 → 2 로 줄고 단언이 자기 자신과 대조하게 된다** — 이 리포가 반복해 밟은 검증 항진의 형태다. 경계가 낡아 깨지는 것은 결함이 아니라 **알림**이다(id 48짜리 공용 촉매에서 깨지고, 그때 사람이 "이걸 팔 것인가"를 판단해야 한다)
   - 실패 메시지에 그 의도를 적는다: `'촉매를 추가했다면 세 술어(planet is null / kind === common / id < 30) 중 무엇을 갱신할지 판단하라 — 자동 파생으로 바꾸면 독립 증인이 사라진다'`. 없으면 다음 사람이 "낡은 하드코딩"으로 읽고 파생으로 바꿔 단언을 무력화한다

### 4단계 — net 게이트웨이 (`src/net/gateway.ts` · `src/net/index.ts`)

- `NetGateway.buyCatalyst?(catalystId, qty)` 추가(선택 메서드 — `salvageCatalyst`(`gateway.ts:159`) 관례)
- `CatalystSalvageResult` 에 `residue`·`gained` 추가하고 **`creditsLeft`·`mineralsLeft` 를 제거**(HIGH-5). 현행 `salvage_catalyst` 는 `return v_grant || ...`(`20260727000000_catalyst_ledger.sql:663-665`)로 두 필드를 실어 보내는데, `grant_currency` 를 떼면 **사라진다**. 타입에서 지워야 소비 지점이 컴파일 에러로 드러난다 — 지우지 않으면 `undefined` 가 조용히 흘러간다
- 잔재 잔고는 별도 메서드 없이 **`profiles` select 로 읽는다**(`profiles_select_own` 정책 기존재, `20260717000000_m4_initial_schema.sql:77`). 구체 지점: `src/net/profileSync.ts` 의 프로필 pull 경로에 컬럼을 얹는다
- `buyCatalystOnServer(...)` 공개 래퍼 — no-op 규율(미설정 → `{status:'unconfigured'}`), `salvageCatalystOnServer`(`index.ts:390`) 형태

### 5단계 — 화면 (`src/ui/pixi/catalystArchive.ts`)

**표시 범위 — 48종 전부**(MAJ-8). 현행 `ownedList()` 는 `if (qty <= 0) continue`(`:206-207`) 로 **보유분만** 그린다. 이는 CONTEXT.md 의 *"상시 전 카탈로그가 진열"*(촉매 상점 항목)과 어긋나고, 신규 플레이어에게 `signature` 필터 탭(`:325-328`)이 빈 목록이 된다. 전 카탈로그를 그리고 상태로 구분한다:

| 상태 | 분해 | 구매 |
|---|---|---|
| 공용 · 보유 > 0 | 활성(수량 지정) | 잔재 충분하면 활성 |
| 공용 · 보유 0 | 비활성 | 잔재 충분하면 활성 |
| 특산 · 보유 > 0 | 활성 | 비활성(`signature-not-sold` 사유) |
| 특산 · 보유 0 | 비활성 | 비활성 |

**행 예산 확정**(MED-1 — 개정 1은 실행자에게 위임했다. 수치로 못 박는다):
- `ROW_H` 108 → **136**
- `ROW_CTRL_W = 220` 신설 — 우측 컨트롤 영역 폭의 단일 정본. **배치는 세로 2단**(MIN-3): 위 줄에 스테퍼(`− n +`), 아래 줄에 [분해][구매] 가로 병치. 세로 3단은 `SALVAGE_H=52`×2 + 스테퍼로 136 을 넘고, 전부 가로 1줄은 220px 에 셋을 넣어야 해 라벨이 축소된다(캔버스 없는 테스트가 `Text.width` 를 실제보다 작게 재는 함정과 겹친다). 버튼 폭은 `(ROW_CTRL_W - 간격) / 2` 파생
- 설명 `wordWrapWidth` 를 `BOX.w - textX - ROW_CTRL_W - 32` 로 파생(현행은 `SALVAGE_W` 만 빼고 있어(`:403`) 구매 버튼을 얹으면 글자가 버튼 밑으로 들어간다)
- 48행 × (136+12) − 12 = **7,092px** 스크롤 콘텐츠. `makeScrollArea` 가 처리하나 아래 재렌더 규율이 전제다

**재렌더 규율**(HIGH-3): 현행 `render()` 는 루트 자식을 전부 destroy 후 재생성하고(`:217-221`) 행을 전량 addChild 한다(`:317-321`, 가상화 없음). `Text` 는 `resolution: 2`(`:387`·`:395`) 라 인스턴스마다 텍스처 업로드가 난다. **수량 스테퍼는 해당 행의 `Text.text` 만 치환**하고 `render()` 를 호출하지 않는다. `render()` 는 서버 왕복·필터 변경에만.

**분해 성공 경로 수정**(HIGH-5): `salvageOne()`(`catalystArchive.ts:175-199`)이 지금은 `this.profile.credits = res.creditsLeft; this.profile.minerals = res.mineralsLeft;`(`:180-183`)로 재화 미러를 갱신하고, 힌트 문구도 `credits` 파라미터를 쓴다(`:184-187`). 이 3+1줄을 **잔재 갱신으로 교체**한다 — 크레딧·광물은 이 경로에서 더 이상 변하지 않는다.

**오프라인**(스펙 AC #13): 미설정·오프라인 세션은 목록을 그리되 분해·구매 버튼 전량 비활성 + 안내 문구(현행 관례 계승).

순수 표시 헬퍼(가격 포맷·거부 사유 문구·버튼 활성 판정)는 별도 모듈로 분리해 vitest 대상(캔버스 없는 테스트에서 `Text.width` 가 던지는 함정 회피).

### 6단계 — 자산·문구

- PixelLab 잔재 아이콘 1장(**장비 아이콘체**). 생성 → 캐시 `add` → **`D:\ClaudeCowork\pixellab-forge` `library/` 동기화 PR 까지 같은 세션에서 마감**(전역 규율)
- i18n 신규 키 10종(전 로케일 — `tests/i18n.test.ts` 가 패리티 강제): `catalyst.residue.name` · `catalyst.shop.buy` · `catalyst.shop.price` · `catalyst.shop.signatureNotSold` · `catalyst.shop.priceUnset` · `catalyst.shop.insufficientResidue` · **`catalyst.shop.noProfile`**(MED-3 — 계약 단언 7은 서버 본문 문자열만 보므로 클라 미대응을 못 잡는다. 신규 가입 직후 창에서 원인 불명 실패로 떨어진다) · `catalyst.shop.offline` · `catalyst.salvage.qty` · `catalyst.salvage.gained`
- **기존 키 개정 1종**: `catalyst.manage.salvageDone` 이 `credits` 파라미터를 쓴다(`catalystArchive.ts:184-187`) → 잔재 파라미터로 교체(HIGH-5)
- `tests/catalystIconAssets.test.ts` 에 잔재 아이콘 존재 단언 추가
- **Follow-up 2건을 커밋되는 파일에 등록한다**(NEW-3 — "밸런스 큐"·"출시 게이트"라는 문서는 리포에 **없다**. `.omc/plans/balance-impl-*.md` 는 완료된 레인의 기록이지 미래 항목 큐가 아니다. 등록처 없는 선언은 이 계획이 머지되는 순간 `.omc/plans/` 에 묻힌다): **`docs/adr/0042-catalyst-shop-closed-residue-economy.md` §Follow-ups 에 두 항목을 추기**한다 — ⓐ `grant_catalyst` 누적 캡 부재(출시 전 필수) ⓑ 크레딧 유입 재검토(밸런스 레인). ADR 은 커밋되고 검색되며, 이 결정의 맥락과 같은 자리에 있다.
  ⓐ 에는 **"`src/net/` 에 `grantCatalyst` 클라 래퍼가 보이지 않아 위험 창이 아직 안 열렸을 가능성이 있으나 — 미확인. 착수 시 전수 확인 필요"** 를 함께 적는다. 이 한 줄이 없으면 다음 사람이 "안 급하다"로 읽거나 "이미 확인됐다"로 읽는다

### 7단계 — 검증

1. `pnpm test` 그린 (⚠️ `| tail` 금지 — exit code 가 `tail` 것이 되어 거짓 통과)
2. `pnpm build` / tsc 통과 (테스트 추가 후 tsc 재실행 필수 — node-shims 함정)
3. **sim 무개입 물증**(MAJ-5 — 개정 1의 "detached 워크트리에 기준선 녹화" 절차를 폐기한다. 기준선은 **이미 커밋돼 있고**(`tests/fixtures/encounter-baseline.json`·`striker-prem8.json`), 녹화기는 `npx vite-node`(`scripts/recordEncounterBaseline.ts:25`)를 쓰는데 **`vite-node` 가 설치돼 있지 않다**. 게다가 재녹화는 커밋된 기준선을 덮어 "변경 후 코드로 찍은 기준선을 자기 자신과 대조"하는 항진을 만든다):
   - `pnpm test` 안에서 `encounterHashInvariance`·`invasionHash`·`shipHashBaseline` **3종 통과**
   - `git diff --stat main...HEAD -- tests/fixtures/ src/sim/` **빈 출력** (MED-5 — 개정 2는 fixtures 에만 `git status --porcelain` 을 걸었는데 그건 **워킹 트리만** 본다. 실행자가 fixture 를 고치고 커밋하면 빈 출력으로 통과한다. 두 축을 같은 방식으로 맞춘다)
   - `git status --porcelain tests/fixtures/` 도 빈 출력(미커밋분까지 이중 확인)
   - **기준선 재녹화 금지**
4. 원격 마이그레이션 적용 (상시 승인 범위). 실패 시 복구: 이 마이그레이션은 전부 additive(`add column if not exists`·`create or replace`)라 역적용 스크립트 없이 이전 함수 정의를 재적용하는 것으로 되돌린다 — 되돌릴 함수 원문은 `20260727000000_catalyst_ledger.sql` 에 그대로 남아 있다
5. **실세션 관통 1바퀴**: 분해 → 잔재 증가 → 구매 → `catalyst_inventory` 반영 → 화면 갱신
6. **가드 실증**(CRIT-1): 실세션에서 `PATCH /profiles` 로 `catalyst_residue` 직접 쓰기를 시도해 값이 **변하지 않음**을 확인
7. **스크롤 성능 실측**: 하네스에서 촉매 보관함을 열고 48행 목록을 끝까지 스크롤하며 `chrome-devtools` performance trace 1회. **판정: 스크롤 중 장기 프레임(>50ms)이 0건**. 초과 시 행 풀링을 추가 과제로 올린다
   - 측정 조건(LOW-3 — 이 리포 실측 규율): **탭이 포그라운드**일 것(백그라운드면 rAF 1Hz 로 떨어져 오진), **품질 티어를 high 로 고정**할 것(FPS 계측이 티어를 낮추면 다른 화면을 재게 된다)
8. **하네스 육안**: 4개 상태(공용 보유/미보유 · 특산 보유/미보유)의 버튼 활성 조합이 위 표대로인지 스크린샷

## 리스크와 완화

| 리스크 | 완화 |
|---|---|
| **`grant_currency` 제거가 `no-profile` 방어를 함께 없앤다** (CRIT-A) | 분해·구매 양쪽에 게이트 명시(2단계 6·7항). 분해는 **`for update` 직후·`update set qty` 이전**(앞이면 ABBA). 계약 단언 4·6·7 |
| **클라가 `catalyst_residue` 를 직접 UPDATE** (CRIT-1) | 가드 두 함수 개정 + 대입 총수 단언 + 7단계 6항 실증 |
| 특산 가격 12.5 비정수 (CRIT-2) | `Math.floor` 확정 + 스펙 AC #1 개정 |
| ABBA 데드락 (HIGH-1) | 잠금 순서 inventory → profiles 통일, 배너 명문화, 순서 단언 |
| **거부 경로가 `qty=0` 유령 행을 커밋한다** (HIGH-4) | inventory 행을 미리 만들지 않는다. 거부는 `return` 이라 롤백되지 않으므로, 가산은 모든 게이트 통과 후 마지막에 |
| **`creditsLeft`/`mineralsLeft` 가 반환에서 사라져 `undefined` 가 저장된다** (HIGH-5) | 타입에서 두 필드를 제거해 소비 지점(`catalystArchive.ts:180-187`)이 컴파일 에러로 드러나게 한다 |
| 신규 촉매가 `buy_price` 0으로 무료 (HIGH-2) | `price-unset` 게이트. 더해 계약 단언 1이 `CATALYSTS.length` 파생이라 **49번째 촉매 추가 시 테스트가 먼저 깨져** 시드 누락을 알린다 |
| 48행 재렌더 비용 (HIGH-3) | 스테퍼 행 로컬 갱신 + 7단계 7항 실측(임계 50ms) |
| 시드 파서가 엉뚱한 블록을 읽는다 (MAJ-2) | 센티넬 주석 + 행 수 선행 단언 |
| 구매 가능성 술어가 갈린다 (MAJ-4) | 세 술어 일치 단언 |
| 배너·코멘트가 거짓이 된다 | 무효화 선언 + `comment on` 재선언 + S4 재작성 |
| 크레딧 유입 감소 | **밸런스 큐 항목으로 등록**: 출시 전 밸런스 패스에서 촉매 분해 크레딧(런당 기대 50×n)을 뺀 크레딧 수급 재계산. 주체 = 밸런스 레인, 시점 = 출시 전 |

## 검증 단계

- 단위: 가격 파생 48종 전수 · 순수 표시 헬퍼
- 계약: 마이그레이션 파싱 9종 단언
- 뮤테이션: TS 가격 변경 시 단언 1 실패 확인 · 가드 대입 1개 제거 시 단언 2 실패 확인
- 통합: 실세션 분해→구매 관통 + 가드 직타 차단 실증
- 회귀: 커밋된 기준선 3종 통과 + fixtures/src·sim 무변경
- 성능: 스크롤 trace 1회, 장기 프레임 0건
- 육안: 4개 상태 조합 스크린샷

## ADR

**Decision**: 촉매 잔재를 `profiles.catalyst_residue` 컬럼으로 두고 `grant_currency` 캡 파이프는 경유하지 않는다. 변동 원장은 두지 않는다. 컬럼 추가와 동시에 클라 쓰기 봉인 트리거를 개정하고, `grant_currency` 안에 있던 `no-profile` 게이트를 두 RPC 에 이식한다. 가격 정본은 TS 이고 SQL 은 시드된 정수를 조회한다.

**Drivers**: 치팅 표면 불증가 · 조용한 드리프트 차단 · 구현량 최소

**Alternatives considered**: 캡 파이프 편입(발동하지 않을 캡을 캡 테이블에 넣는 모순) · 신규 전용 원장 테이블(읽는 주체·GC 부재, 겨냥한 결함은 레인 밖) · `currency_grants` 재사용(스키마 오용) · `salvage_value` 컬럼 신설(미러 축 2배화, driver 2 자기 충돌) · 잔재 없이 직접 교환(부분 누적 상실 — ADR-0042 기각)

**Why chosen**: 잔재는 외부 유입이 없어 상한이 불필요하다. 관측 필요성의 진짜 출처는 `grant_catalyst` 누적 캡 부재라는 **별개 결함**이고, 그것을 원장으로 우회하는 대신 그 자리에서 다루는 편이 옳다.

**Consequences**: 잔재 변동 이력이 남지 않는다 — 관측이 필요해지는 시점(`grant_catalyst` 캡 작업)에 함께 설계한다. 재화 접근 경로가 두 종류가 되며 근거를 마이그레이션 배너에 남긴다. **더 정확히는, 사라지는 것이 신규 축이 아니라 기존 관측이다** — 지금 촉매 축은 하류 `grant_currency` 를 타면서 `currency_grants` 원장과 `flagged` 플래깅에 잡히는데, 이 레인 이후 그 관측에서 빠진다. 즉 이 레인은 **순 방어 감소**다.

**Follow-ups**:
- **`grant_catalyst` 누적 캡 부재** — 클라 호출 가능한데 per-call 100 상한뿐이다(`20260727000000_catalyst_ledger.sql:172`). 이 레인이 촉매 축의 하류 관측을 제거하므로 이후 상태는 **"무캡 + 무원장"** 이 된다. **주체 = 보안 레인, 시점 = 출시 전 필수, 미해결 시 출시 게이트 차단.** 관측을 스스로 지운 레인이 복구 시점을 안 정하면 영영 안 돌아온다
- 크레딧 유입 밸런스 재검토(밸런스 레인, 출시 전)
- ADR-0042 문구 정정 2건: ⓐ `CAP_SALVAGE_*` 는 장비 분해가 계속 써 사문화되지 않는다 ⓑ "어떤 촉매를 녹여도 손해도 이득도 없다"가 `floor` 절하로 특산에서만 4% 어긋난다(공용·파워·ascendant 는 드랍당 기대 잔재 50, 특산은 48). 실해는 없으나 문구를 정확히 한다

## 개정 이력

**개정 1 (Architect)** — CRIT-1 가드 트리거 개정 신설 · CRIT-2 `Math.floor` · HIGH-1 잠금 순서 정정 · HIGH-2 `price-unset` · HIGH-3 스테퍼 재렌더 · MED-1 행 예산 · MED-2 배너/코멘트 잔여물 · Option C 채택 · P2·P4 정합 · LOW-1 잔재 조회 확정

**개정 2 (Critic)**
- **CRIT-A**: `no-profile` 게이트 이식. `grant_currency` 를 떼면 촉매가 조용히 소멸하고(분해) 잔재 0으로 무한 구매가 된다(구매 — null 비교가 부족 게이트를 통과)
- MAJ-1: 봉인 컬럼 6종 → **8종(+1=9)**, 대입 총수 단언
- MAJ-2: 시드 센티넬 형상 확정 + 헬퍼 2종 명시 + 행 수 선행 단언
- MAJ-3 / §P2 재논증: `salvage_value` 컬럼 **철회**. `floor` 는 언어 간 발산이 없어 P2 가 방어하려던 위험이 실재하지 않았고, 컬럼 추가는 미러 축을 2배로 늘려 driver 2 와 자기 충돌한다. 부재 단언 대신 **비율 값 대조 + 양성 단언**
- MAJ-4: 구매 가능성 세 술어 일치 단언 + `purchasable` 을 미러에 탑재
- MAJ-5: 골든 절차 **전면 교체**. 기준선은 커밋돼 있고 `vite-node` 가 없으며 재녹화는 항진을 만든다 → 기존 테스트 통과 + fixtures/src·sim 무변경 대조, 재녹화 금지
- MAJ-6/7: 옵션 공간을 2×2로 열거하고 D(`currency_grants` 재사용)를 신설·판정. **Option C 철회 → A 채택** — 원장이 겨냥한 결함이 레인 밖이고 읽는 주체·GC 가 없었다. ADR-0042 무개정으로 복귀
- MAJ-8: 목록을 **48종 전부**로. 현행이 보유분만 그리는 것이 CONTEXT.md "상시 전 카탈로그"와 어긋난다(Critic 은 현행을 전량 표시로 읽었으나 `:206-207` 에 수량 필터가 있다 — 결론은 같다)
- MED-1 잔여: `ROW_H = 136` · `ROW_CTRL_W = 220` **수치 확정**(개정 1은 실행자에게 위임했다)
**개정 5 (Critic 최종 — APPROVED 후 잔여 MINOR)**
- NEW-1 수정이 2단계·단언에만 반영되고 **수용 기준 2곳·리스크 표 1곳에 옛 문구가 남아** 있었다(NEW-2 와 같은 유형의 비대칭 — 정본은 고치고 판정 기준은 안 고침). 세 곳을 2단계 6항 문구로 통일
- ADR 추기 ⓐ 에 `grant_catalyst` 클라 배선 **미확인** 사실을 명시(붙이지 않으면 "안 급하다" 또는 "이미 확인됐다"로 오독된다)
- 단언 9의 `id < 30` 을 **하드코딩 유지**로 확정 + 실패 메시지에 의도 기입. 파생으로 바꾸면 독립 증인이 3→2 로 줄어 자기 대조가 된다

**개정 4 (Critic 2차 — APPROVED 조건 3건 + MINOR)**
- **NEW-1**(MAJOR): 분해의 `no-profile` 게이트 위치를 **`for update` 직후·`update set qty` 이전**으로 확정. `for update` 앞에 두면 profiles → inventory 가 되어 `buy_catalyst` 와 ABBA — **CRIT-A 수정이 HIGH-1 을 되살리는** 구조였고, 개정 3의 "차감 이전"은 두 배치를 모두 허용했다. 더해 **단언 6을 두 함수 모두에 적용**(개정 3은 `buy_catalyst` 만 봐서 이 회귀를 못 잡았다)
- **NEW-2**(MED): 수용 기준의 골든 문구를 7단계와 동일하게 교체. 완료 판정은 수용 기준으로 하는데 개정 3은 7단계만 대칭화해 둘이 갈려 있었다
- **NEW-3**(MED): Follow-up 2건의 **등록 대상을 `docs/adr/0042` §Follow-ups 로 지정**. "밸런스 큐"·"출시 게이트"는 리포에 존재하지 않는 문서였다
- MIN-1: `no-profile` 원본 인용을 **`20260727000000_catalyst_ledger.sql:439-447`** 로 정정(그 파일이 `grant_currency` 를 개정한다 — 배너 `:22`). 개정 3의 `:174-182` 는 파일명이 없었고 같은 파일의 그 줄은 `grant_catalyst` DECLARE 다
- MIN-2: `SALVAGE_RATIO_PCT` 를 `constant numeric` 으로 못 박음(`int` 면 결합 순서를 바꿔 쓸 때 0이 되어 전액 손실)
- MIN-3: 우측 컨트롤 **세로 2단** 배치 확정(스테퍼 / 버튼 2개)
- MIN-4: `buy_catalyst` 의 profiles 잠금과 `no-profile` 을 한 문장으로 병합

**개정 3 (Architect 2차 — 조건부 승인의 조건)**
- **HIGH-4**: `insert ... on conflict do nothing` 선행 생성 **폐기**. 거부가 `return` 이라 롤백되지 않아 `qty=0` 유령 행이 커밋된다. 행 없음 케이스는 `salvage_catalyst` 가 보유 행을 전제하므로 애초에 ABBA 가 성립하지 않는다
- **HIGH-5**: `CatalystSalvageResult` 에서 `creditsLeft`·`mineralsLeft` **제거** + `salvageOne()`(`catalystArchive.ts:175-199`)의 재화 미러 갱신 3줄과 `salvageDone` 문구 교체. 타입에서 지워야 컴파일 에러로 드러난다
- **Q2 구멍**: 단언 5에 **`floor` ↔ `× qty` 결합 순서** 단언 추가. 실재 발산은 비율이 아니라 순서에 있다(25×3 에서 36 vs 37)
- Q1 조건: `grant_catalyst` 캡 Follow-up 에 **출시 게이트 구속** 부여. 이 레인이 촉매 축의 하류 관측을 지우므로 순 방어 감소임을 ADR §Consequences 에 명시
- MED-3: `catalyst.shop.noProfile` i18n 키 추가(서버 문자열 단언은 클라 미대응을 못 잡는다)
- MED-4: `catalystDefsSeedRows()` 헬퍼 신설 — 단언 9가 필요로 하는 `planet` 은 센티넬 없는 **기존 3열 시드**에 있다. 완전한 컬럼 리스트를 앵커로
- MED-5: fixtures 검증을 `git status`(워킹 트리) → `git diff main...HEAD`(커밋분)로 대칭화
- LOW-3: 성능 측정 조건(탭 포그라운드·품질 티어 high 고정) 기입
- P2 문구 재정정: SQL 은 `SALVAGE_RATIO_PCT` 를 안다 — "자체 가격 지식 없음"이 아니라 "구매가를 파생하지 않는다"

**개정 2 세부 (Critic 1차)**
- MIN: 승계 기준 16개로 정정 · `CAP_BUY_PER_CALL` **제거**(잔재 잔고가 상한, 절삭 UX 함정) · `consume_catalysts` 잠금 방향 과대 주장 삭제 · `numeric` 근거 명시 · 롤백 절차 기입 · i18n 로케일 패리티 명시 · 성능 검증에 도구·임계값 기입 · S4 를 `salvage_core_module` 기준으로 재작성 지시

---

## 잔여 ② 실서버 UI 검증 결과 (2026-07-31, `fix/catalyst-shop-ui-viewport`)

PR#215 의 화면 검증은 하네스 인메모리 모의 게이트웨이로만 했고, 남긴 잔여는 둘이었다.
**둘 다 처리했고, 그 과정에서 실제 결함 1건이 나왔다.**

### ⓐ 서버 거부 note → 화면 문구 매핑 — **결함 1건 발견·수정**

`buyRejectKey()`(`src/ui/pixi/catalystShopView.ts`)의 **기본 분기가
`catalyst.manage.salvageFail`("분해 실패" / "Salvage failed")** 이었다. 즉 **구매**를 누른
플레이어에게 **분해** 실패 문구가 뜬다.

사각이 아니라 상시 경로다 — 서버 `buy_catalyst` 가 실제로 내는 `unknown-catalyst`(TS↔SQL
카탈로그 드리프트 시)·`nothing-to-buy` 와 **앞으로 늘어날 모든 사유**가 이 분기로 떨어진다.
하네스 모의 게이트웨이는 이 note 들을 내지 않아 PR#215 의 화면 검증을 그대로 통과했고,
`tests/catalystShopView.test.ts` 는 이 동작을 **기대값으로 못 박고 있었다**(테스트가 결함을
승인한 형태).

- 수정: `catalyst.shop.buyFail` 신설(ko "구매 실패" / en "Purchase failed")을 기본 분기로.
- 회귀 방어: 키 비교가 아니라 **렌더될 문자열**을 분해 문구 집합과 대조한다(키만 보면 다시
  샌다). 뮤테이션(기본 분기를 되돌림) → 2건 RED 확인.
- 나머지 4종(`no-profile`·`price-unset`·`signature-not-sold`·`insufficient-residue`)은
  ko/en 양쪽 모두 사람이 읽는 문장으로 정상 매핑됨을 실화면에서 확인.
- `no-profile` 은 실제 화면 상태(`residue === null`)로 재현해 **구매 가능 30행 전부**에
  안내 문장이 뜨는 것과, 그 상태가 가장 긴 문구인데도 2줄·2px 여유를 지키는 것을 확인.

### ⓑ 다른 뷰포트 폭 — **전제가 틀렸다(폭 의존이 없다)**

잔여 항목은 "`wordWrapWidth` 가 `BOX.w` 파생이라 폭 의존이 있다"였으나, `BOX.w` 는
`PANEL_W = 1000` **상수**에서 나온다. 이 UI 는 1920×1080 **고정 디자인 스페이스**이고 stage 가
균일 스케일될 뿐이라 뷰포트 폭은 줄바꿈에 영향을 주지 않는다. 단정이 아니라 실측으로 확인했다:

| 뷰포트 | stage scale | wordWrapWidth | 최대 설명/문구 줄 수 | 설명↔문구 간격 | 행 넘침 |
|---|---|---|---|---|---|
| 1750×1020 | — | 538 | 2 / 2 | +2px | −1px |
| 820×1180 | 0.6667 | **538(동일)** | 2 / 2 | +2px | −1px |

실제로 줄 수를 바꾸는 축은 폭이 아니라 **로케일**이다. 그래서 ko·en 양쪽으로 48행 전수를
쟀고 둘 다 설명 ≤2줄·문구 ≤2줄·간격 +2px·넘침 없음(축소 배율 1.0 = 축소 미발동)이었다.

측정법: 하네스에서 `catalystArchive` 를 띄우고 행 컨테이너의 `Text` 객체에서 `y`·`height`·
`scale`·`style.lineHeight` 를 직접 읽어 수치로 판정(스크린샷 눈대중 아님).
서빙 워크트리는 임시 마커 파일 fetch 로 확증했다(`preview_start` 가 세션 cwd 의 launch.json 을
쓰므로 워크트리가 여럿이면 엉뚱한 트리를 서빙할 수 있다).

**결론**: 2줄 전제는 살아 있다. 폭 관련 후속 작업 없음.
