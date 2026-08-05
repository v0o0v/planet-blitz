# 일일 보상 구현 계획

- 상태: **pending approval**
- 입력 스펙: `.omc/specs/deep-interview-daily-reward-gaps.md` (모호도 20%, AC 26개)
- 선행 결정: `docs/adr/0048-daily-reward-outside-settlement-bounded-by-cap.md` (결정표 20갈래) · `CONTEXT.md`(신규 5항목)
- 합의 모드: RALPLAN-DR **deliberate** (마이그레이션 + 위조 방어를 포함하므로)

> 이 계획은 정책을 **재결정하지 않는다.** ADR-0048 이 정한 20갈래는 입력이며, 계획의 일은
> 그것을 커밋 가능한 단위와 의존 순서로 바꾸는 것이다.

---

## RALPLAN-DR

### Principles

1. **순수 함수부터, 서버 다음, 화면 마지막** — 산식은 서버·클라·EF 가 공유하므로 정본이 하나여야 하고, 순수 함수는 서버 없이 잠글 수 있어 가장 싸다.
2. **스키마는 한 번에, 지급 분기는 점진적으로** — 원장·컬럼 형태는 6축이 동일하므로 마이그레이션을 쪼갤 이유가 없다. 쪼개면 두 번 만진다.
3. **최대 위험은 배송 원자성이지만, 그것은 슬라이스 순서로 증명되지 않는다** — 실패 모드 셋(다기기 통짜 폐기·mark 실패 후 분해·용량 만석)이 하네스 e2e 로 재현되지 않으므로, 순서를 바꿔 앞으로 당기는 것은 위험을 노출하는 것이 아니라 노출했다고 믿게 만든다. **순수 함수 3케이스로 잠근다.**
4. **모의는 실서버를 가리지 않는다** — 하네스 모의가 config 보다 먼저 적용돼 실서버를 조용히 가린 전례가 있다. 모의는 실경로가 동작한 **뒤에** 붙인다.
5. **전역 잠금 전순서는 성립하지 않는다** — 실측 결과 리포에 통일된 방향이 없다(`catalyst_inventory→profiles` vs `profiles→core_modules`). 그래서 **축별 기존 관례를 따르고, 한 트랜잭션에 인벤토리가 1개만 등장하도록 구조적으로 강제**한다. 계약 테스트가 그 구조를 단언한다.
6. **실 DB 를 요구하는 단언은 vitest 에 쓸 수 없다** — 이 리포에 `createClient` 를 쓰는 테스트가 **0건**이고 계약 테스트 5종은 전부 SQL 텍스트 파싱이다. 멱등·캡 산입·절삭처럼 왕복이 필요한 것은 **`prove-*.ps1`(원격 psql + `BEGIN…ROLLBACK`)이 유일한 수단**이다.

### Decision Drivers (top 3)

1. **배송 경로가 리포에 없다** — 의뢰 기능이 정확히 이 자리에서 멈췄다(`fetchCommissionGrantsOnline` 미호출). 같은 함정을 반복하면 "매일 주는데 안 오는" 결함이 매일 재생산된다.
2. **상한 유계가 유일한 안전장치다** — 정산 요약 밖 지급이므로 다른 방어선이 없다. 그것이 실제로 무는지 실증하지 못하면 기능을 켤 수 없다.
3. **잠금 순서 위반은 조용하다** — 리포 배너가 "무엇으로도 안 잡힌다"고 명시한 유일한 결함 종류이고, 이 RPC 가 잠글 테이블이 5개라 가장 노출된다.

### Viable Options — 구현 순서의 모양

#### Option A: 6축 동시 관통
계층 순서는 Option B 와 **같다**(마이그레이션 → 산식 → EF → net → 화면). 다른 것은 **첫 관통에 몇 축을 넣는가** 뿐이다 — A 는 각 계층에서 6축을 다 만든다.
- **Pros** 슬라이스 경계를 관리할 필요가 없고 중간에 꺼 둘 것이 없다.
- **Cons** 화면을 보기까지 6~7 커밋이다(축 개수가 각 계층을 부풀린다). 이 리포는 *"실화면이 잡은 3건이 전부 테스트 초록"* 이었던 전례가 반복되므로 늦은 화면 피드백이 산식까지 되돌린다. 그리고 진짜 미지 다섯이 마지막에 몰려 드러난다.
- *(초안은 이 대안을 "계층 우선 vs 수직 슬라이스"로 세워 계층 미학만 따른다고 기각했으나, 두 옵션의 계층 순서는 동일하다 — 축 범위가 실제 차이였다. 허수아비였으므로 다시 썼다.)*

#### Option B: 수직 슬라이스 (권장)
스키마는 6축 전부를 한 번에 만들고, **지급 분기는 재화 1축만** 끝까지 관통시킨다(마이그레이션 → 산식 → EF → net → 모달 → 실화면 확인). 그 슬라이스가 초록이 된 뒤 남은 5축을 분기에 채운다.
- **Pros** 배송·수령 원자성·모달 진입이 **3~4 커밋 안에** 실화면으로 증명된다. 마이그레이션은 한 번만 만진다(스키마가 축과 무관하다). 재화는 서버 정본이 이미 있어(`grant_currency_for`) 배송함 없이 되므로 가장 짧은 관통이다.
- **Cons** "장비 배송함"이 첫 슬라이스에 없으므로 배송함 멱등은 두 번째 슬라이스에서 처음 시험된다 — 가장 위험한 조각이 첫 관통에 안 들어간다.

#### Option C: 화면 우선 (모의 기반)
하네스 모의로 화면부터 만들고 서버를 나중에.
- **Pros** 화면 피드백이 가장 빠르고, "구려 보인다" 류 재작업이 가장 싸다.
- **Cons** 모의가 실서버를 가린 전례가 있어(§Principle 4) 모의 초록이 실경로 초록의 증거가 되지 못한다. 상한 유계·잠금 순서·멱등이 전부 마지막으로 밀린다 — Driver 2·3 을 정면으로 어긴다.

### 선택: Option B — 첫 슬라이스는 **재화 축**, 배송함 스키마는 슬라이스 1 에 동반

초안은 "가장 위험한 조각을 앞으로"라는 이유로 첫 슬라이스를 **장비 축**으로 바꿨다. Architect
검토가 그것을 기각했고 근거가 맞다:

**배송함의 실제 실패 모드 셋이 슬라이스 1 완료 판정으로 재현되지 않는다** — ①다기기 통짜 선택
폐기(`src/net/profileSync.ts:121-134`) ②`mark` 실패 후 분해 ③인벤·창고 만석. 1인·1기기·빈
인벤토리 하네스에서 30일을 치트로 밀어도 셋 다 잠들어 있다. 즉 "가장 위험한 조각을 첫 관통에
넣었다"는 것은 **위험을 노출한 것이 아니라 노출했다고 믿게 만든 것**이다 — 이 계획이
§Expanded Test Plan 에서 경계한 "죽은 계측기"의 설계 판이다.

게다가 장비 축 슬라이스는 **배포 불가**다(§E). 그래서:

- **첫 슬라이스 = 재화 축.** 곁들이 크레딧이 곧 주 보상이 되므로 슬라이스 1 이 그 자체로 일관된
  제품이고, 경로가 라이브 검증된 `grant_currency_for` 다. 진짜 미지(권한 경계·예고 왕복·캡
  산입·모달·연속일 봉인)가 3~4 커밋 안에 전부 드러난다.
- **배송함 스키마는 슬라이스 1 마이그레이션에 그대로 둔다** — Principle 2("스키마는 한 번에")를
  어기지 않는다. 지급 분기만 슬라이스 2 다.
- **배송함 위험은 순수 함수 + vitest 3케이스로 잠근다**(§C5·§위험표) — 하네스 30일 밀기보다 싸고,
  세 실패 모드를 실제로 건드리는 유일한 방법이다.

기각 근거: Option A 는 Driver 없이 계층 미학만 따르고, Option C 는 Driver 2·3 을 어긴다.

### Pre-mortem — 이 계획이 실패하는 3가지 방식

#### 1. ABBA 교착으로 프로덕션 RPC 두 개가 정면으로 멈춘다

**초안의 완화책이 불충분했다. 실측으로 기각하고 교체한다.**

초안은 `claim_daily_reward` 가 인벤토리 4종 + `profiles` 를 잠근다고 보고 **전순서 선언**을
완화책으로 삼았다. 기존 `for update` 순서를 전수 수집한 결과 그 완화책은 성립하지 않는다 —
**리포에 통일된 방향이 없다:**

| 함수 | 순서 | 근거 |
|---|---|---|
| `grant_catalyst`·`buy_catalyst`·`salvage_catalyst` | `catalyst_inventory → profiles` | `20260731000000_catalyst_shop.sql:37-40` (선언된 규약) |
| `salvage_module` | `core_modules → profiles` | `20260726000000_currency_server_authority.sql:599` → `:631` |
| `buy_shop_module` 계열 | `profiles` 먼저 | 같은 파일 `:536` |
| `salvage_card`(폐지 계열) | `defense_cards → profiles` | `20260718160000_m6_defense_cards.sql:542` → `:564` |
| `apply_card_purchase`(폐지 계열) | `profiles → defense_cards` | `20260718170000_m6_card_economy_rpc.sql:80` → 이후 insert |

어떤 전순서를 택해도 기존 함수 중 일부와는 반대가 된다. 배너가 적었듯 위반은
*"단위 테스트·1바퀴 플레이·육안 무엇으로도 안 잡힌다."*

**교체된 차단책 — 여러 테이블을 잠그지 않는다.** 이 위험은 잘못된 전제에서 나왔다. 하루치는
**주 보상 1개 + 곁들이 크레딧**이므로 한 번의 수령이 만지는 인벤토리는 **최대 1개**다.
5개를 동시에 잠글 이유가 애초에 없다.

- `claim_daily_reward` 는 `daily_reward_claims` → **낙찰된 축의 인벤토리 1개** → `profiles`
  만 잠근다. 축이 6개라도 **한 호출에 등장하는 인벤토리는 하나**다.
- 그 하나의 순서는 **그 축의 기존 규약을 그대로 따른다** — 촉매면 `catalyst_inventory → profiles`,
  코어 모듈이면 `core_modules → profiles`. 새 순서를 발명하지 않으므로 **새 교착 쌍이 생기지 않는다.**
- 축별 지급을 별개 RPC(또는 같은 RPC 안의 배타 분기)로 두고, **두 인벤토리가 한 트랜잭션에
  등장하는 경로를 구조적으로 금지**한다. 계약 테스트가 그것을 단언한다(본문에 인벤토리 테이블
  이름이 2개 이상 `for update` 로 등장하면 실패).
- `buy_shop_module` 이 `profiles` 를 먼저 잠그는 것과는 여전히 반대가 되므로, **코어 모듈 축은
  `profiles` 를 먼저 잠근다**(그 축만 예외이며 근거를 배너에 적는다). 축마다 그 축의 관례를
  따르는 것이 전역 단일 순서보다 안전하다.
- 배너가 경고한 한계도 승계한다: `insert ... on conflict do update` 로 잠기는 행은 `for update`
  정적 단언의 시야 밖이므로, 가산 대상 행은 `profiles` 를 잠그기 **전에** 확보한다
  (`20260731000000_catalyst_shop.sql:41-44`).

#### 2. 장비가 복제되거나 영영 오지 않는다
배송함은 두 실패를 동시에 막아야 한다. 클라가 세이브에 반영한 **뒤** `mark_applied` 를 부르므로,
그 사이에 죽으면 다음 부팅이 같은 행을 다시 반영한다 → **복제**. 반대로 반영 전에 mark 하면
→ **유실**. 순서를 어느 쪽으로 놓아도 한쪽이 열린다.

**차단** — 순서로 풀지 않고 **반영 자체를 멱등으로** 만든다. `item_id` 를 배송함 행에서
결정론적으로 파생(`daily:{date_seed}` 같은 안정 키)하고, 세이브 반영은 그 `item_id` 가 이미
있으면 no-op 이다. `items` 의 `unique (profile_id, item_id)` 제약이 서버측에서도 같은 것을
보장한다. 그러면 반영→mark 순서가 안전해지고(중복 반영이 무해), mark 실패는 다음 부팅의
무해한 재시도가 된다. **테스트로 잠근다**: 반영 직후 mark 전에 중단시키고 재부팅해 아이템이
정확히 1개인지 단언.

#### 3. 어떤 경로로 들어온 유저는 그날 못 받는다
수령이 "그날 첫 기지 진입"에 묶여 있는데 기지 진입 경로가 여럿이다 — 부팅 직행 · 런 종료 후
복귀 · 타이틀에서 진입 · 다른 화면에서 뒤로. 하나를 놓치면 그 경로 유저는 지급도 예고도 못
받고, **다음날 압력까지 사라진다.**

**차단** — 진입 경로에 붙이지 않는다. 리포 교훈이 이미 정본이다: *"레이어 표시는 진입 경로가
아니라 화면 이름 단일 권위."* 기지 화면이 **표시 상태로 들어가는 단일 지점**에 훅을 걸고, 그
지점을 순수 함수(`shouldOpenDailyReward(lastSeenSeed, nowSeed)`)로 뽑아 테스트가 경로와
무관하게 잠근다. 경로별 처방을 쓰면 실패해 재신고를 받은 전례가 있다.

### Expanded Test Plan

| 층 | 무엇을 잠그나 |
|---|---|
| **unit** | 램프 직선성(연속일 n→n+1 증분이 상수) · 예산 천장 = 상한 유계 · 후보 거리 정렬 · 후보 0개 → 재화 폴백 · 동점 tie-break 결정론(같은 `(date_seed,userSeed)` → 항상 같은 낙찰) · 연속일 전이(1→30→1, 끊김→1, 같은 날 재호출→불변) · `date_seed` 경계 · `shouldOpenDailyReward` 순수 판정 · 가치 환산표 전 축 유한·양수 |
| **integration** | ⚠️ **vitest 로는 불가능하다** — 이 리포에 `createClient` 를 쓰는 테스트가 **0건**이고 계약 테스트 5종은 전부 SQL 텍스트 파싱이다. DB 왕복이 필요한 단언(RPC 멱등 · 캡 산입 · 절삭 · source 필터 · 신규 계정 하한)은 **전부 `prove-daily-reward-cap.ps1`(§C12ⓑ)로 이관**했고 각각 ASCII 통과 토큰을 갖는다. 이 칸을 vitest 항목으로 채우면 **실행되지 않는 빈 층**이 된다. 배송함 반영 멱등만은 순수 함수라 unit 에 남는다 |
| **e2e (하네스)** | 30일차까지 치트로 밀어 모달·칩·연속일·예고 육안 확인 · 기지 진입 경로 4종 전부에서 모달이 그날 1회만 · 모달 닫고 칩으로 재열람 · 칩·크레딧 칩·광물 칩·제목 겹침 없음(실화면) |
| **observability** | 4지표 **전부 데이터 소스와 조회 SQL 을 갖는다**(초안은 2개가 태생적 죽은 계측기였다): ①`daily_reward_claims` 일별 행 수 ②**`applied_at IS NULL` 이 24시간 넘게 남은 행 수**(배송 실패의 유일한 신호. ⚠️ **용량 만석은 별도 컬럼으로 구분**한다 — 클라 로컬 상태로 두면 만석 유저가 이 지표를 상시 경보로 만든다) ③**상한 절삭 발생률** — `daily_reward_claims` 에 `clamped boolean not null default false` 를 **추가한다**(초안 스키마에 담을 컬럼이 없었다) ④`profiles.flagged` 는 전역 카운터라 이 기능의 이상을 분리해 읽을 수 없으므로 **`source='daily_reward'` 인 `currency_grants` 행 수**로 대체 |

`applied_at IS NULL` 잔존 행 수가 **죽은 계측기가 되지 않도록** 하네스에서 의도적으로 1건을
만들어 그 지표가 실제로 1을 읽는 것을 확인한다 — 항상 0을 읽는 계측기를 방치한 전례가 있다.

---

## 상한 앵커 재선정 (2026-08-05, ADR-0048 정정)

ADR 초판의 *"`pve_runs` 의 **검증된** 최고 클리어 단계"* 는 **틀린 서술이었다.** `pve_runs` 에
stage 컬럼이 없고(`20260718000000_m4_pve_runs.sql:31-42`), stage 는 클라가 채운
`summary jsonb` 안에 있으며(`20260726000200_pve_settlement.sql:254`·`:265`),
`verified_status` 는 `'verified'` 를 **무조건 리터럴로 찍고**(`:302`), PvE 재검증 자체가
철거됐다(`20260726000300`, ADR-0026).

**확정된 대체 앵커: `profiles` 의 생애 누적 지급액(신설).**
- `currency_grants` 를 직접 합산할 수 없다 — **7일 GC** 다(`20260726000200_pve_settlement.sql:11`).
- 그래서 `profiles` 에 단조 누적 컬럼을 신설하고 **`currency_grants` AFTER INSERT 트리거**가 가산한다.
- **`grant_currency_for` 본문을 고치지 않는다** — 발령이 같은 상황을 AFTER 트리거로 해결한 선례를
  따른다(`20260803000000_commission_ledger.sql:14-16`).
- **트리거 본문을 서브트랜잭션으로 감싼다** — 감싸지 않으면 예외가 정산 트랜잭션을 롤백해
  *"전 플레이어가 자원을 못 받고 화면은 조용하다"*(같은 파일 `:18-20`).
- 상한 산식의 **정본은 SQL 한 곳**이고 EF 는 RPC 반환값을 소비만 한다(§C4).

**⚠️ 자기참조 되먹임을 반드시 차단한다.** 트리거에 source 필터가 없으면 **일일 보상이 지급한
크레딧이 자기 상한을 밀어 올린다** — 곁들이 크레딧은 매일 나가고 재화 축이 낙찰되면 주 보상까지
크레딧이라 되먹임 계수가 1 에 근접한다. 그러면 플레이 0 인 계정도 접속만으로 상한이 단조
상승해, ADR 의 유일한 정당화(*"위조해도 정직한 플레이로 이미 닿는 범위 안"*)가 무너지고 30일 봇
접속이 **상한 자체를 키우는** 경로가 열린다 — §왜 30일차 최고점에도 상한이 이기는가가 막으려던
공격면이 다른 문으로 돌아온다.

- 트리거는 `when (new.source <> 'daily_reward')` 로 제한한다.
- **C3 계약 테스트가 그 필터의 존재를 단언한다** — 필터가 조용히 빠지는 것이 이 결함의 재발 경로다.

**⚠️ 신규 계정 하한(floor)이 필요하다.** `lifetime_granted = 0` 인 신규 유저는 예산 천장이 0
근처라 30일을 채워도 받을 것이 없다 — ADR 의 "접속만으로 성립"과 정면 충돌한다. 옛 앵커(stage)
에는 이 문제가 없었다(1단계만 깨도 값이 생긴다). **앵커 전환이 만든 부작용이므로 이 레인이
닫는다** — 예산 산식에 `max(FLOOR, f(lifetime_granted))` 형태의 하한을 두고, `FLOOR` 는
`// BALANCE` placeholder 로 둔다. unit 테스트가 `lifetime_granted = 0` 에서 예산 > 0 을 단언한다.

## Requirements Summary

ADR-0048 이 정한 정책(접속만으로 성립 · 주 보상 1개 + 곁들이 크레딧 · 6축 풀 · 진행 견인 ·
상한 유계 · 캡 산입 · 1일치 예고 확정 · 미수령 소멸 · 30일 직선 램프 · 전멸 리셋 · UTC 경계 ·
모달 + 헤더 칩 · 수령 = 진입 시점)을 구현한다. 수치는 placeholder + `// BALANCE`.

## Implementation Steps

### 슬라이스 1 — 재화 축 관통 (그 자체로 배포 가능한 최소 제품)

**C1. 순수 산식 — 램프·예산·상한** · `data/dailyReward.ts`
- 연속일 → **공통 가치 예산**(직선), 가치 환산표(6축), **`lifetime_granted` → 예산 천장**(신규 계정 하한 `FLOOR` 포함). ⚠️ `pve_runs` 최고 클리어 단계를 쓰지 않는다 — 클라 주장이다.
- `Math.random`·`Date.now` 금지(EF 공유 순수 함수 — `src/items/roll.ts` 헤더 규율 승계).
- 상수는 `// BALANCE — 출시 전 일괄 튜닝` 주석과 함께 배너에 정본 선언.
- 테스트: `tests/dailyRewardRamp.test.ts`
- 검증: `npx vitest run tests/dailyRewardRamp.test.ts`

**C2. 순수 산식 — 진행 견인 후보 생산기** · `data/dailyRewardSelection.ts`
- 축별 후보 생산기(**재화 축부터** — 슬라이스 1 이 재화 관통이다. 나머지 5축은 슬라이스 2), 거리 점수, 예산 내 최소 거리 낙찰, 0개 폴백, `(date_seed, userSeed)` tie-break, 반복 걸음 순번.
- 테스트에 **AC-16 잠금** 포함 — 축간 가치 환산이 **순서 일관·단조**임을 단언한다("전 축 유한·양수"는 하한일 뿐이다).
- 테스트: `tests/dailyRewardSelection.test.ts`

**C3. 마이그레이션 — 원장·컬럼·트리거·RPC** · `supabase/migrations/20260805000000_daily_reward.sql`
- `daily_reward_claims`: `(profile_id, date_seed)` PK, `payload jsonb`(예고 = 종류·등급·계급), `item_payload jsonb null`, `applied_at timestamptz null`, `created_at`. RLS `select_own` 만(insert/update/delete 정책 없음). **TTL·GC 대상 아님**(주석에 근거 명시 — 지우면 미반영 행이 사라져 물건이 영구 유실).
- `profiles` 컬럼 3개: `daily_last_claim_seed bigint not null default -1`, `daily_streak int not null default 0`, `lifetime_granted numeric not null default 0`(상한 앵커).
- ⚠️ **봉인 트리거는 최신 정의에서 복사한다** — `20260731000000_catalyst_shop.sql:109-128` 이 현행이고 봉인이 **9개**다(flagged·is_npc·lineage 4종·credits·minerals·catalyst_residue). 초안이 적었던 "3~4개"는 **가장 오래된 정의**를 본 것이고, 낡은 본문 복제가 프로덕션을 100% 깨뜨린 전례와 동형이다(`20260802000000:4-15`). `20260726000000`(8개)을 베끼면 `catalyst_residue` 봉인이 사라져 **잔재 무한 구매**가 열린다.
  - `guard_profiles_client_write()` — 9 → **12** (신규 3컬럼 추가)
  - `guard_profiles_client_insert()` — `20260731000000:137-150` 이 현행, 3 → **6**. **이것이 빠지면 클라가 자기 프로필을 `daily_streak: 30` 으로 INSERT 할 수 있다**(RLS 는 소유권만 검사: `20260717000000:95`).
- **`currency_grants` AFTER INSERT 트리거** → `profiles.lifetime_granted` 가산. **서브트랜잭션으로 감싼다**(`20260803000000_commission_ledger.sql:18-20`). `grant_currency_for` 본문은 **고치지 않는다**.
- RPC **`claim_daily_reward_for(p_recipient uuid, ...)` — service_role 전용 하나만 만든다.**
  `revoke all ... from public, anon, authenticated`. **revoke 가 빠지면 authenticated 가 PUBLIC 을
  통해 도달해 위임 구조 전체가 무효**(`commission_ledger.sql:374-378`).
  - ⚠️ **authenticated 래퍼를 만들지 않는다.** 초안은 `grant_currency` 2단 구조를 베꼈으나, 그쪽은
    클라가 직접 부르는 경로가 실재해서 래퍼가 필요했다. 여기는 **수령이 EF 전용**이다 — EF 가
    미러를 읽어 후보를 만들고 `rollItem` 을 돌려야 하므로 클라가 부를 수 있는 형태가 아니다.
    래퍼를 만들면 쓰지도 않는 **순공격면**이 된다.
  - 이 결정이 세 모순을 동시에 닫는다: ①배포 게이트의 근거가 *"EF 미배포"* 가 아니라
    **"authenticated 진입점 부재"** 가 되어 참이 된다 ②AC-25 는 "상한이 문다"가 아니라
    **"authenticated 가 도달하지 못한다"** 를 겨눈다(§C12ⓐ 가 실증) ③슬라이스 1 완료 판정이
    EF 배포를 요구해도 유저 노출은 **클라 진입 훅(C6)이 슬라이스 2 까지 상수로 꺼져 있는 것**이
    막는다.
- ⚠️ **`date_seed` 를 파라미터로 받지 않는다.** 본문이 `floor(extract(epoch from now())/86400)` 로
  서버가 계산한다. 받으면 복합 PK 가 서로 다른 seed 를 안 막아 **하루에 여러 번 수령**이 열린다.
  계약 테스트가 *"본문에 `p_date_seed` 파라미터가 없다"* 를 단언한다.
- `mark_daily_reward_applied(p_date_seed bigint)` — authenticated, `auth.uid()` 고정. 이쪽은 클라가
  부르는 것이 맞다(반영 완료를 알리는 것이므로). seed 를 받아도 **이미 존재하는 행만** 갱신하므로
  위조 이득이 없다.
- **상한 산식의 정본은 이 파일이다** — `lifetime_granted` → 등급·요구 레벨·지시 계급 천장. EF 는 반환값만 소비한다.
- 잠금 순서: 한 호출에 인벤토리는 **최대 1개**. **곁들이 크레딧 grant 의 호출 위치가 축별 계약이다** — 촉매 축은 인벤토리 잠금 **뒤**(`catalyst_inventory → profiles` 보존), 코어 모듈 축은 **앞**(`profiles → core_modules` 보존). grant 를 촉매 축에서 먼저 부르면 `buy_catalyst` 와 정확히 반대가 되어 진짜 ABBA 가 열린다.
- 재실행 안전: `create table if not exists` · `drop policy if exists` → `create` · `create or replace function`.
- **`settle_pve_run` 본문을 건드리지 않는다.**
- 적용 스크립트: `scripts/apply-daily-reward-migration.ps1`
- 테스트: `tests/dailyRewardContract.test.ts` — `tests/catalystShopContract.test.ts:169` 의 `effectiveFunctionBody()` 헬퍼를 **재사용**(마지막 정의를 해석한다). 단언: 상한 산식 · RLS 정책 부재 · 복합 PK · 봉인 12/6 · service_role revoke 3종 · `for update` 등장 순서 · **호출되는 함수 본문까지 훑어** 인벤토리 2개가 한 트랜잭션에 안 나오는지(초안은 `on conflict` 사각지대만 승계하고 **함수 호출 사각지대를 놓쳤다** — `grant_currency_for` 의 `for update` 는 다른 함수 본문에 있다: `commission_ledger.sql:308`).
- **같은 커밋에서** `tests/catalystShopContract.test.ts:176`(9) · `:198`(3) 의 숫자를 12 · 6 으로 갱신.

**C4. Edge Function** · `supabase/functions/daily-reward/`
- 서버 시각으로 `shopDateSeedFromMs(Date.now())` 계산(클라 입력 불신 — `modules/index.ts:107` 선례).
- **상한은 RPC 반환값을 받아 쓴다. 산식을 복제하지 않는다**(정본은 C3 의 SQL). 복제하면 `prove-*.ps1` 이 EF 의 TypeScript 로직을 영영 실증할 수 없어 완료 관문 ②가 죽은 관문이 된다.
- 미러(`profiles.save`·`ships`)를 service_role 로 읽어 후보 생산. 선례: `verify-invasion/index.ts:307-308` 이 `profiles` 컬럼을 RLS 우회로 읽는다. ⚠️ **`items` 테이블은 읽지 않는다** — 클라가 그 테이블에 한 줄도 쓰지 않으므로(`src/**` 에 `.from('items')` 0건) 비어 있다. 아이템은 `profiles.save` 안에 있다.
- **예고를 소비한다** — 어제 행의 `payload` 를 읽어 종류·등급·계급을 **고정**하고 값만 서버 시드로 굴린다. 이 단계가 없으면 예고가 약속이 아니게 되어 ADR 의 압력 설계 전체가 무용지물이다(ADR: *"적힌 것은 바뀌지 않는다"*). **"직전 예고 없음 → 지금 파생"** 분기 필수(하루 놓치면 그 행이 소멸한다).
- `rollItem(서버 시드, ...)` 으로 값 굴림 → `claim_daily_reward_for` 로 원장 기록 + **다음날** 예고 확정, 연속일 갱신.
- 배포: **신규 EF 이므로 `deno.json` 신설**(`unstable: ["sloppy-imports"]` + `bundle` 태스크) + `deno task bundle` → `dist.index.js` 를 `index.ts` 로 치환. `verify-commission/deno.json` 의 `//deploy` 주석이 *"sloppy-imports 를 CLI 배포 번들러가 못 따라가고 `--entrypoint` 플래그도 없다"* 고 명시한다. 절차 정본은 `.omc/skills/` 의 supabase 배포 워크플로 문서.

**C5. net 계층** · `src/net/dailyReward.ts` + `src/net/index.ts` 래퍼
- 기존 규약 승계: 미설정·오프라인·오류면 `null`, **절대 throw 안 함**.
- 배송함 반영: `item_id` 를 `daily:{date_seed}` 로 결정론적 파생(`rollItem` 의 `it-${seed}`·약탈품의 `-loot-` 와 충돌 없음: `src/items/roll.ts:109`).
- ⚠️ **`items` 테이블의 `unique (profile_id, item_id)` 를 안전망으로 계상하지 않는다** — 클라가 그 테이블에 쓰지 않으므로 그 제약은 이 경로에 걸리지 않는다. 멱등은 **순수 함수가 단독으로** 보장해야 한다.
- **순수 함수 `hasDailyItem(profile, itemId)` 를 뽑아 4곳 전수를 본다** — `inventory`(`src/save/profile.ts:140`) · `stash`(`:141`) · `ships[].equipped`(`:105`) · `guardians[].build.equipped`(`:227`). `inventory` 만 보면 **플레이어가 장착하거나 창고로 옮긴 순간 다음 부팅이 같은 아이템을 또 심는다**.
- **용량 만석 분기** — `INVENTORY_CAP = 48`(`profile.ts:57`) · `stashCapacity()`(`:78-81`). 둘 다 꽉 차면 반영을 보류하고 `applied_at` 을 찍지 않는다. 이 경우 관측 지표가 상시 경보가 되므로 **만석은 별도 상태로 구분**한다(경보와 구별).
- **순서: 반영 → 서버 프로필 push 성공 확인 → `mark_daily_reward_applied`.** push 전에 mark 하면 `chooseProfile` 의 통짜 선택이 그 아이템을 버릴 수 있고(`profileSync.ts:121-134` — `progressScore` 는 기체 레벨 1 = 1000 점이라 아이템 48개 차이도 진다) 행은 이미 mark 돼 재시도되지 않아 **영구 유실**이다.
- 부팅 경로에서 `applied_at IS NULL` 행 재시도.
- 테스트: `tests/dailyRewardNet.test.ts` — ①장착 후 재부팅 ②창고 이동 후 재부팅 ③인벤·창고 만석 ④mark 실패 후 재시도 ⑤push 실패 시 mark 안 함 ⑥오프라인 no-op

**C6. 모달 + 진입 훅** · `src/ui/pixi/dailyRewardModal.ts`
- **단일 지점이 실제로 존재한다** — `src/main.ts:837` 의 `openBaseMap()` 하나로 호출부 20곳이 전부 모인다(모달 닫기 `:463` · 언어 전환 `:690` · 타이틀 시작 `:803` · 건물 복귀 `:843/847/851` · 하네스 `:2439~:2501` 등). 초안 Pre-mortem 3 의 "경로가 여럿"은 **과대평가**였고 처방은 옳았다.
- 부팅 순서도 안전하다 — `bootWithAuth()` 가 `await pullServerProfileInto(profile)`(`:2001`) **뒤에** `openIntroOrTitle()`(`:2006`) 을 부른다.
- **순수 판정** `shouldOpenDailyReward(lastSeenSeed, nowSeed)` 를 뽑는다. 재진입 두 경로를 반드시 케이스로 잡는다: `rerenderCurrentScreen()`(`:690`, 언어 전환) · `harnessRefreshScreen()`(`:2501`, `default:` 분기라 run/result 화면에서도 base 로 튄다). 순수 판정이 없으면 **모달이 재발한다**.
- ⚠️ **비동기 창** — `openBaseMap` 은 동기이고 수령은 서버 왕복이다. 그 사이 플레이어가 격납고를 누르면 `baseMap.hide()`(`:843`) 뒤에 응답이 도착해 **기지 없는 배경 위에 모달이 앉는다.** 응답 도착 시점에 `currentScreenName === 'base'` 를 재확인한다.
- "받기" 버튼 없음 — 통지. 예고는 종류·등급·계급까지만. 반복 걸음 순번 표시("3장 중 2장째").
- 테스트: `tests/dailyRewardModal.test.ts` + `tests/dailyRewardGate.test.ts`(재진입 2종 + 비동기 창)

**슬라이스 1 완료 판정** — 셋을 나눈다(모의 하네스가 서버 단언을 "실증"하는 것처럼 보이는 경로를 막기 위해):
1. **순수 함수** — vitest 초록(램프·후보·연속일 전이·`shouldOpenDailyReward`·`hasDailyItem`).
2. **서버** — `prove-daily-reward-seal.ps1` + `prove-daily-reward-cap.ps1` 의 **ASCII 토큰 8개 전부** `[OK]`. 여기서만 멱등·캡 산입·절삭·source 필터·하한이 실증된다.
3. **실화면** — 원격 실서버 **실계정 1개로 수동 1회** 수령(EF 직접 호출). 모달·예고 표시 육안 확인. ⚠️ **하네스 모의로는 이 판정을 대신할 수 없다** — 모의는 `currency_grants` 에 행을 남기지 않는다.

**슬라이스 1 배포 게이트** — 슬라이스 1 은 그 자체로 일관되지만(곁들이 크레딧 = 주 보상) 헤더 칩·도움말·나머지 5축이 없다. 차단은 **두 겹**이다: ①`claim_daily_reward_for` 가 service_role 전용이고 **authenticated 진입점이 아예 없다**(래퍼를 안 만들었다) ②**클라 진입 훅(C6)이 슬라이스 2 까지 상수로 꺼져 있다.** EF 는 배포한다 — 그래야 완료 판정 3을 할 수 있고, 배포해도 ①②가 유저 노출을 막는다.

### 슬라이스 2 — 남은 5축 + 화면 완성

**C7. 지급 분기 나머지 5축** — **장비**(배송함 경로 — C5 의 순수 함수가 이미 잠갔다) · 촉매(`grant_catalyst`) · 설계도 · 코어 모듈 · 의뢰서. 뒤의 넷은 **자기 서버 테이블로 직행**(배송함 불요). 후보 생산기 5종 추가. **축별 grant 호출 위치 계약**(C3)을 각 분기가 지키는지 계약 테스트로 단언. 의뢰서 축은 **지시 수신소 보관 상한**을 후보 생산기가 먼저 거른다.

**C8. 헤더 연속일 칩** · `src/ui/pixi/baseMap.ts` — 칩 3개 + 제목 겹침 **실화면 실측**. `TILE_W`·행 배치·세로 예산 불변. 테스트: `tests/baseMapDailyRewardChip.test.ts`

**C9. i18n + 도움말** · `src/i18n/catalog.ts` — KO/EN 짝. KO 문구는 `KO` 선언부 주석의 용어 정본표를 먼저 읽고 쓴다. 도움말이 **"하루 놓치면 1일차 리셋"** 과 **"받을 수 있는 것의 상한이 지금까지 받은 총량에 묶인다"** 를 말한다. ⚠️ 초안은 *"자기 최고 클리어 단계에 묶인다"* 라고 적었는데 앵커가 바뀌었으므로 **플레이어에게 거짓을 말하는 문구**였다(스펙 AC-22 도 같은 문구라 함께 교정 필요).

**C10. 자산** — 사운드 **CC0 실음원**(절차 합성 금지). 개봉 연출 아트: 원본 해상도와 표시 배율을 실측(과확대가 "구려 보인다"의 절반이었던 전례).

**C11. 하네스** · `src/harness/dailyRewardMock.ts` + 치트 패널 — 연속일 임의 세팅 · 하루 넘기기 · 미반영 배송함 행 1건 생성(관측 지표 실증용). **모의가 config 보다 먼저 적용돼 실서버를 가리지 않도록** 우선순위 확인.

**C12. 실증 스크립트 — 2개로 쪼갠다**

⚠️ **초안의 "미러를 위조해 상한이 무는지 실증"은 앵커를 바꾼 순간 항진 테스트가 됐다.** 미러
(`profiles.save`·`ships`·`items`)는 이제 **후보 선정에만** 쓰이고 상한은 `lifetime_granted` 에서
나오므로, 미러를 위조해도 상한이 안 움직이는 것이 **설계상 당연**하다 — 무엇을 구현하든 통과한다.
Driver 2 가 "실증하지 못하면 켤 수 없다"고 선언한 그 실증이 소멸했으므로 다시 정의한다.

**ⓐ `scripts/prove-daily-reward-seal.ps1`** — 앵커가 봉인돼 있는가
- `prove-catalyst-residue-seal.ps1` 형식. `authenticated` 로 `update profiles set lifetime_granted = 10^9` · `daily_streak = 30` 을 시도해 **봉인 트리거가 되돌리는지** 실증.
- `guard_profiles_client_insert` 도 함께 — 새 행을 `daily_streak: 30` 으로 INSERT 시도.
- 통과 토큰: `[OK] SEAL_LIFETIME_HELD` · `[OK] SEAL_STREAK_HELD` · `[OK] SEAL_INSERT_ZEROED`

**ⓑ `scripts/prove-daily-reward-cap.ps1`** — 상한이 실제로 무는가 + integration 층
- `postgres` 로 `lifetime_granted` 를 낮게 세팅한 상태에서 `authenticated` 수령을 실행해 **예산 천장이 그 값에서 파생된 상한으로 절삭되는지**를 반환값의 절삭 플래그로 단언.
- **§Expanded Test Plan 의 integration 5항목을 여기로 이관한다**(vitest 로는 불가능 — Principle 6). 각각 ASCII 통과 토큰을 갖는다:
  - `[OK] IDEMPOTENT_1ROW` — 같은 `date_seed` 2회 호출 → 원장 1행·지급 1회·굴린 결과 동일
  - `[OK] CAP_LEDGER_ROW` — 재화 지급이 `currency_grants` 에 행을 남긴다(캡 산입)
  - `[OK] CAP_CLAMPED` — 상한 초과 요청이 상한까지만 지급
  - `[OK] ANCHOR_NO_SELF_FEED` — 일일 보상이 만든 `currency_grants` 행이 `lifetime_granted` 를 **올리지 않는다**(source 필터 실증)
  - `[OK] FLOOR_NONZERO` — `lifetime_granted = 0` 계정의 예산이 0 이 아니다
- 전부 `BEGIN…ROLLBACK` 안. 콘솔 출력은 **ASCII 만**(PowerShell 5.1 mojibake 가 성공을 실패로 보이게 한다).

## Risks and Mitigations

각 행은 **누가 언제 무엇을 보고 통과를 판정하는지**까지 적는다. "확인한다"로 끝나는 완화책은 완화책이 아니다.

| 위험 | 완화 — 판정 주체·시점·통과 조건 |
|---|---|
| ABBA 교착(Pre-mortem 1) | **전순서 선언은 기각됐다**(§Pre-mortem 1). 완화는 *한 트랜잭션에 인벤토리 1개* 구조 강제 + 축별 기존 관례 준수. **판정**: C3 계약 테스트가 호출 함수 본문까지 훑어 인벤토리 테이블이 2개 이상 `for update` 로 안 나오는지 + `grant_currency_for(` 등장 위치가 축별 기대값(촉매=인벤토리 뒤 / 코어 모듈=앞)과 일치하는지를 **문자 위치 비교**로 단언 |
| 장비 복제·유실(Pre-mortem 2) | **`unique(profile_id,item_id)` 는 안전망이 아니다**(클라가 `items` 에 안 쓴다 — §C5). 완화는 순수 함수 `hasDailyItem` 이 4곳 전수를 보는 것 단독. **판정**: `tests/dailyRewardNet.test.ts` 케이스 ①~⑦ 전부 초록 |
| 다기기 통짜 폐기로 영구 유실 | 반영 → push → **재-pull 하여 아이템 존재 확인** → mark. **판정**: 테스트 ⑦(서버에 `progressScore` 더 높은 프로필을 심고 왕복) 초록 |
| 경로별 누락(Pre-mortem 3) | 순수 판정 `shouldOpenDailyReward` + `openBaseMap` 단일 훅. **판정**: `tests/dailyRewardGate.test.ts` 가 재진입 2경로 + 비동기 창 케이스 초록 |
| 상한이 안 무는데 초록 | **초안의 "미러 위조 실증"은 항진이 됐다**(§C12). **판정**: `prove-daily-reward-cap.ps1` 의 `[OK] CAP_CLAMPED` |
| 앵커 자기참조 되먹임 | 트리거 `when (new.source <> 'daily_reward')`. **판정**: 계약 테스트가 필터 존재를 단언 + `[OK] ANCHOR_NO_SELF_FEED` |
| 신규 계정 상한 0 | 예산 산식에 `FLOOR` 하한. **판정**: unit(`lifetime_granted=0` → 예산>0) + `[OK] FLOOR_NONZERO` |
| 봉인 트리거 수정이 기존 봉인을 깨뜨림 | **최신 정의(`20260731000000:109-128`)에서 복사**하고 추가만. ⚠️ 계약 테스트는 숫자만이 아니라 **필드 집합 전체**를 단언한다(`tests/catalystShopContract.test.ts:177-189`) — 신규 3컬럼을 집합에도 넣어야 한다. **판정**: `catalystShopContract` + `dailyRewardContract` 둘 다 초록 + `[OK] SEAL_*` 3종 |
| 전 재화 경로에 트리거 추가로 정산 지연 | AFTER 트리거가 **모든** 재화 지급에서 발동해 `profiles` UPDATE + before-update 트리거를 매번 깨운다. **판정**: 슬라이스 1 에서 `settle_pve_run` 왕복 시간을 트리거 전/후로 **각 20회 측정해 p95 증가가 20ms 미만** |
| 죽은 계측기 | 관측 4지표 **전부** 실증한다 — 하네스로 미반영 행 1건·절삭 1건·source 필터 1건·만석 1건을 만들어 각 지표가 1을 읽는 것 확인. **판정**: 4지표 조회 SQL 이 계획에 적혀 있고 각각 0이 아닌 값을 반환 |
| PowerShell mojibake | 실증 스크립트 콘솔 출력 ASCII 전용. **판정**: 통과 토큰이 전부 `[A-Z_]` 형식 |

## Verification Steps

1. **편집 중** — 고친 것의 짝만: `npx vitest run tests/dailyRewardRamp.test.ts` (약 7초)
2. **커밋 전** — `pnpm test:changed` (약 34초, 기준점 `origin/main`)
3. **자산·데이터를 건드린 커밋** — `--changed` 는 임포트 그래프만 보므로 자산 존재 검사(`*AssetPresence.test.ts`)를 **직접 지정**해서 함께 돌린다
4. **PR 전** — `pnpm verify` (약 2분 30초). **파이프에 물리지 않는다** — exit code 가 `tail` 것이 되어 거짓 그린
5. **sim 레인** — `src/sim/**`·밸런스 수치·`src/bench/**` 를 건드리지 않으므로 `pnpm test:sim` **불요**. C1/C2 가 `data/` 에만 사는지 확인하고, `src/sim/**` 로 새면 그때 판단
6. **원격** — `apply-daily-reward-migration.ps1` → `prove-daily-reward-cap.ps1` → EF 배포
7. **실화면** — 하네스로 30일차까지, 진입 경로 4종, 칩 겹침

## 커밋·브랜치

`feat/daily-reward` 브랜치 → 슬라이스별 커밋 → `gh pr create` → 머지. commit 전 매번 secret 검사(`.env`·`local.properties`·`*.keystore`·`*.apk`·`*.jks`·`*.pem`).

---

## ADR — 구현 구조 결정

**Decision.** 일일 보상을 **재화 축 수직 관통(슬라이스 1) → 나머지 5축(슬라이스 2)** 으로 구현한다.
배송함 스키마는 슬라이스 1 마이그레이션에 동반하되 장비 지급 분기는 슬라이스 2 로 미룬다. 상한
앵커는 **`profiles.lifetime_granted`(신설) + `currency_grants` AFTER INSERT 트리거**이고, 상한
산식의 정본은 **SQL 한 곳**이며 EF 는 반환값만 소비한다. 수령 RPC 는 **service_role 본문 +
authenticated 래퍼 2단**이다.

**Drivers.** ①배송 경로가 리포에 없다(의뢰 기능이 같은 자리에서 멈췄다) ②상한 유계가 유일한
안전장치다 ③잠금 순서 위반은 어떤 검증으로도 안 잡힌다.

**Alternatives considered.**
- *계층 우선(bottom-up)* — 기각. 드라이버 없이 계층 미학만 따르고 화면 피드백이 6~7 커밋 뒤다.
- *화면 우선(모의 기반)* — 기각. 모의가 실서버를 가린 전례가 있어 모의 초록이 실경로 초록의 증거가 못 되고, 드라이버 2·3 을 마지막으로 밀어낸다.
- *장비 축 첫 슬라이스* — **초안이 골랐다가 기각.** 배송함의 실제 실패 모드 셋이 그 슬라이스의 완료 판정으로 재현되지 않아 "위험을 노출했다"가 착각이었고, 그 슬라이스는 배포 불가였다.
- *상한 산식을 EF 에만* — 기각. `prove-*.ps1` 이 TypeScript 로직을 실증할 수 없어 완료 관문 ②가 죽은 관문이 된다.
- *`pve_runs` stage 를 앵커로* — **사실 오류로 기각.** 클라 주장이며 `verified_status` 는 리터럴이다.
- *`currency_grants` 직접 합산* — 기각. 7일 GC 라 "휴가 다녀오면 상한이 떨어진다"가 되어 30일 램프와 충돌한다.
- *`grant_currency_for` 본문에 누적 가산* — 기각. 복제가 프로덕션을 100% 깨뜨린 계열이라 AFTER 트리거로 붙인다(발령 선례).
- *`items` 유니크 제약을 멱등 안전망으로* — 기각. 클라가 그 테이블에 쓰지 않아 제약이 이 경로에 걸리지 않는다.

**Why chosen.** 슬라이스 1 이 그 자체로 일관된 제품이면서(곁들이 크레딧 = 주 보상) 진짜 미지
다섯(권한 경계·예고 왕복·캡 산입·연속일 봉인·모달 진입)을 3~4 커밋에 드러낸다. 경로가 라이브
검증된 `grant_currency_for` 라 관통의 불확실성이 가장 낮다. 배송함 위험은 슬라이스 순서가 아니라
**순수 함수 3케이스**로 옮겨 실제로 재현 가능한 형태로 잠근다.

**Consequences.**
- `guard_profiles_client_write` 봉인이 9 → 12, `guard_profiles_client_insert` 가 3 → 6 이 되고 `tests/catalystShopContract.test.ts:176`·`:198` 의 숫자를 같은 커밋에서 갱신해야 한다.
- 상한이 **진행도의 대리 지표**(누적 지급액)라 정밀하지 않다. 환산 산식을 새로 짜고 밸런스로 넘긴다.
- 계약 테스트가 **호출되는 함수 본문까지** 훑어야 한다 — 정적 단언의 범위가 한 겹 넓어진다.
- 슬라이스 1 은 EF 미배포로 차단되므로, 머지와 활성화가 분리된다.
- ADR-0048 이 "위조해도 정직한 범위 안"이라는 자기 근거를 **처음으로 실제로** 만족한다(초판은 만족하지 못한 채 서 있었다).

**Follow-ups.**
- `pve_runs.summary->>'stage'` 가 클라 주장이라는 사실은 **이 레인 밖의 별개 판단**이다 — 침략 단계 개방 상한·요구 레벨 게이트 등 stage 를 신뢰하는 다른 축이 같은 문제를 갖는지 큐에 남긴다. 이 레인이 견인할 이유가 없다.
- 의뢰 확정 지급물 배송 공백(task_839d4581).

---

## 합의 이력

| 패스 | 결과 |
|---|---|
| Planner 초안 | 6컴포넌트 · 12커밋 · Pre-mortem 3 · 확장 테스트 4층 |
| Planner 자체 실측 | **Pre-mortem 1 완화책 기각·교체** — 리포에 통일된 잠금 방향이 없음을 확인, "전순서 선언"을 "축별 관례 준수 + 인벤토리 1개"로 |
| Architect | **REVISE** — 심각 5·중 3·경 1. 전부 반영 |
| ADR 정정 | 상한 앵커가 **틀린 서술**이었음을 발견 → `pve_runs` stage 기각, `lifetime_granted` 신설. CONTEXT.md·ADR 함께 교정 |
| Critic | ⚠️ **미완** — API 529 로 2회 실패. 아래 참조 |
| Planner 인용 검증 | 표본 8개 중 7개 정확, 1개 교정(`profile.ts` 아이템 컨테이너 줄번호) |

### Critic 반영 (2026-08-05, 반복 2회차)

Critic 판정 **REVISE** — Critical 4 · Major 9 · Minor 6. 뿌리 진단이 정확했다: **상한 앵커 정정의
파급을 문서 5곳에서 멈췄다.** Critical 4건이 전부 그 한 뿌리에서 나왔고, 전파하니 함께 닫혔다.

| # | 지적 | 반영 |
|---|---|---|
| C1 | 완료 관문 ②가 **항진 테스트**가 됐다 — 앵커를 바꾼 순간 "미러 위조"는 상한과 무관 | prove 스크립트를 ⓐ봉인 실증 / ⓑ상한·멱등 실증 **2개로 분할**, ASCII 토큰 8개 명시 |
| C2 | 앵커가 **자기 자신을 밀어 올린다** — 일일 보상의 크레딧이 `currency_grants` 에 들어가 상한 가산 | 트리거에 `source <> 'daily_reward'` 필터 + 계약 단언 + `[OK] ANCHOR_NO_SELF_FEED` |
| C3 | 완료 판정·배포 게이트·authenticated 래퍼가 **삼각 모순** | **래퍼를 만들지 않는다**(수령은 EF 전용) → 셋이 동시에 닫힘. 완료 판정을 순수/서버/실화면 3층으로 분리 |
| C4 | **integration 층에 실행 수단이 없다** — `createClient` 테스트 0건(실측 확인) | integration 5항목을 `prove-*.ps1` 로 이관, Principle 6 신설 |
| M5 | Principle 3·5 가 본문이 기각한 내용을 선언 | 둘 다 재작성 |
| M6 | 위험표 8행 중 5행 결함(기각된 완화책 2·사실 오류 1·판정식 없음 2) | 표 전면 교체 — 각 행에 **판정 주체·시점·통과 조건** |
| M7 | 앵커 정정이 C1·C2·C9/AC-22·ADR 본문에 미전파 | 넷 다 전파. **도움말 문구가 플레이어에게 거짓을 말하고 있었다** |
| M8 | 다기기 `chooseProfile` 폐기를 어느 층도 안 덮는다 | 테스트 ⑦ 추가 + mark 조건을 **재-pull 확인**으로 강화 |
| M10 | `date_seed` 를 누가 정하는지 미명시 | 파라미터로 받지 않고 서버 계산 + 계약 단언 |
| M11 | 전역 AFTER 트리거의 성능 영향 미평가(Non-Goals 잠식) | ADR §결과에 명시 + p95 실측 20회 |
| M12 | Option A 허수아비 | "6축 동시 관통"으로 개명, 계층 순서가 같음을 명시 |
| M13 | observability 4지표 중 2개가 태생적 죽은 계측기 | `clamped` 컬럼 신설 + `flagged` → source 필터 카운트로 교체 + 4지표 전부 실증 |
| 누락 | **신규 계정 상한 0** — 앵커 교체가 만든 구멍 | 예산 산식에 `FLOOR` 하한 + `[OK] FLOOR_NONZERO` |

**미반영(착수와 병행 가능)**: Minor 6건(줄번호 3·함수명 1·계약 테스트 집합 지시 1·`harnessRefreshScreen` 가드 1) 중 사실 오류는 다음 편집에서 정리. Open Questions 3건(`daily_reward_claims` 영구 보존 범위 · `lifetime_granted` 를 numeric 단일 스칼라로 둘 때의 환율 · 롤백 절차)은 **미해결로 남는다.**

### Critic 1차 때 기계적 대조로 찾은 3건 (여전히 미반영)

Critic 항목 중 **AC 26개 전수 대조**만 기계적으로 수행했다(판단이 아니라 사실 확인이므로).
26/26 이 어딘가에 걸려 있으나 3건이 어긋난다. **아직 고치지 않았다** — 다음 Critic 패스가
나머지 축과 함께 처리하는 것이 낫다:

1. **AC-7**(연속 판정은 직전 `date_seed` 하나만 보고 수령 원장을 스캔하지 않는다) — ADR
   §왜 연속일을 원장에서 파생하지 않는가에는 있는데 **C3 구현 항목에 없다.**
2. **AC-8**(하루 놓치면 연속일이 **1**) — §Expanded Test Plan 의 unit 목록에만 있고
   **구현 단계에 없다.**
3. **스펙 AC-6 의 표현이 낡았다** — *"`profiles` 에 컬럼 **2개**"* 라고 하지만 상한 앵커 신설로
   실제는 3개다(`daily_last_claim_seed`·`daily_streak`·`lifetime_granted`).

### 상태: Critic REVISE 반영 완료, 재검토 미실시

Architect 1회 + Critic 1회를 받고 지적을 전부 반영했다. **그러나 반영본은 아직 아무도 보지
않았다** — 합의 루프는 원래 반영 후 Architect·Critic 을 다시 돌려 수렴을 확인한다.

이번 반영은 규모가 작지 않다: 앵커 전파 5곳 · 검증 관문 재정의 · RPC 구조 변경(래퍼 제거) ·
위험표 전면 교체 · Principle 2개 재작성. **구조를 바꾼 반영이므로 새 모순이 생겼을 수 있다** —
특히 래퍼 제거가 AC-25 의 의미를 바꿨고, `FLOOR` 하한이 "상한 유계"의 강도를 얼마나 낮추는지는
아무도 평가하지 않았다.

Planner 가 자기 반영본을 승인하는 것은 이 리포의 자기 승인 금지에 걸리므로, **착수 전에 최소
Critic 1회를 더 돌리는 것을 권한다.**
