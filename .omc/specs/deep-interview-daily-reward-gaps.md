# Deep Interview Spec: 일일 보상 — 구현 구조 확정

## Metadata
- Interview ID: di-daily-reward-gaps-2026-08-05
- Rounds: 9 (+ Round 0 토폴로지 게이트)
- Final Ambiguity Score: 20%
- Type: brownfield
- Generated: 2026-08-05
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: yes (동일 세션의 grill-with-docs 결과를 요약해 승계)
- Status: PASSED
- 선행 산출물: `docs/adr/0048-daily-reward-outside-settlement-bounded-by-cap.md` · `CONTEXT.md`(일일 보상 · 보상 예고 · 연속 접속 · 진행 견인 · 공통 가치 예산)

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|---|---|---|---|
| Goal Clarity | 0.86 | 0.35 | 0.300 |
| Constraint Clarity | 0.77 | 0.25 | 0.192 |
| Success Criteria | 0.78 | 0.25 | 0.196 |
| Context Clarity | 0.78 | 0.15 | 0.116 |
| **Total Clarity** | | | **0.804** |
| **Ambiguity** | | | **0.196** |

## Topology

| Component | Status | Description | Coverage |
|---|---|---|---|
| delivery | active | 서버가 굴린 물건이 플레이어 소유가 되는 경로 | AC-1~AC-5 |
| streak-state | active | 연속일 저장·판정·리셋 + 상한 앵커 컬럼 봉인 | AC-6·AC-6b·AC-7~AC-9 |
| selection | active | 진행 견인 후보 생산기와 낙찰 | AC-10~AC-14 |
| ramp-shape | active | 연속일이 미는 것(공통 가치 예산)의 구조 | AC-15~AC-17 |
| ui-copy | active | 모달·칩·i18n·도움말·연출·사운드 | AC-18~AC-23 |
| verification | active | 3단 완료 관문 | AC-24~AC-26 |

유예된 컴포넌트 없음.

## Goal

**일일 보상을 구현 가능한 구조로 확정한다** — ADR-0048 이 정한 정책 13축 위에, 물건이
도착하는 경로·연속일이 사는 자리·무엇을 고르고 얼마나 주는지의 산식·화면과 문구·완료 판정
관문을 못박는다. 수치(램프 계수·가치 환산표·거리 임계)는 밸런스 = 출시 직전 일괄 튜닝
대상이므로 **구조만** 확정하고 상수는 placeholder 로 둔다.

## Constraints

- **정산 요약 밖의 지급 경로**라는 예외를 넓히지 않는다. 유계 근거는 상한 유계 하나뿐이다.
- 재화·촉매 지급은 기존 `currency_grants`·`catalyst_grants` 누적 캡을 **통과**한다. **시간당·일일
  누적 캡 상수는 손대지 않는다.** ⚠️ 다만 **per-call 캡은 예외다** — `grant_currency_for` 의
  `case p_source` 에 `daily_reward` 가 없으면 `CAP_DEFAULT`(1000/1000)로 **조용히 절삭**돼
  30일차 예산(20,000)이 못 나간다. 그래서 `CAP_DAILY_REWARD_CREDITS`·`_MINERALS`(각 25,000)를
  **신설한다**. "캡 상수를 손대지 않는다"가 겨눈 것은 **누적 캡의 총량 예산**이고, per-call 캡은
  그 예산을 바꾸지 않는다(누적 캡이 여전히 위에서 자른다).
- **새 재화를 만들지 않는다.** 지급 풀은 이미 다른 획득 경로가 있는 6축뿐이다.
- 지급 상한은 **서버 권위 상태에서만** 파생한다 — **`profiles.lifetime_granted`(생애 누적 지급액,
  신설)**. ⚠️ 초판은 여기에 *"`pve_runs` 의 검증된 최고 클리어 단계"* 라 적었고 **그것은 사실
  오류였다**(ADR-0048 §상한의 축이 비어 있었다 — stage 는 `summary jsonb` 안의 **클라 주장**이고
  `verified_status` 는 무조건 리터럴이다). **Constraint 는 AC 보다 상위 계약**이므로 이 줄이
  낡은 채로 남아 있는 것이 AC 하나가 낡은 것보다 무겁다.
- 클라 쓰기 미러(`profiles.save`·`ships`·`items`)는 *무엇을 제안할지* 고르는 데만 쓴다.
- 수령 원장은 **TTL 대상이 아니다** — 지우면 미반영 배송함 행이 사라져 물건이 영구 유실된다.
- 연속일 컬럼은 `credits`/`minerals` 와 같이 **클라 UPDATE 를 트리거로 봉인**한다.
- 지급 규모의 손잡이는 **공통 가치 예산 한 축**이다. 개수·마일스톤·보호 장치를 늘리지 않는다.
- 일일 경계는 `shopDateSeedFromMs` 를 **재사용**한다(새 날짜 관념을 만들지 않는다).
- 기지 격자에 칸이 없다 — 새 건물을 만들지 않고 헤더 칩으로 간다. `TILE_W`·행 배치·세로 예산을 건드리지 않는다.
- 하네스는 **모의 게이트웨이**로 돌고 실서버 원장을 건드리지 않는다.
- 온라인 전용. 오프라인 분기를 만들지 않는다.
- `pnpm verify` 를 파이프에 물리지 않는다(exit code 가 `tail` 것이 되어 거짓 그린).

## Non-Goals

- **의뢰 확정 지급물의 기존 배송 공백 수리** — 별개 작업(task_839d4581). 이 레인은 같은 함정을 반복하지 않는 것까지만 책임진다.
- `items`·`ships` 를 서버 원장으로 승급하는 것 — 장비 생애주기 전수 이관으로 범위가 폭발한다.
- 밸런스 수치 확정 — 램프 계수·가치 환산 계수·거리 임계·곁들이 크레딧 액수는 출시 직전 일괄.
- 끊김 완화 장치(보호권·복구 런).
- 연속 접속을 다른 기능(래더·풍화·의뢰)과 연동하는 것.

## Acceptance Criteria

### delivery
- [ ] AC-1 재화·촉매·설계도·코어 모듈·의뢰서는 각자의 서버 RPC 로 **직접** 지급되고, 클라 반영 단계가 없다.
- [ ] AC-2 장비는 수령 원장 행에 `item_payload` 와 `applied_at`(nullable)로 적히고, 클라가 세이브에 넣은 뒤 `mark_applied` 를 호출한다.
- [ ] AC-3 `applied_at IS NULL` 인 행이 남아 있으면 다음 부팅에 재시도되어 **유실 0** 이다.
- [ ] AC-4 `applied_at` 이 있는 행은 건너뛰어 **중복 0** 이다. 반영 직전에 프로세스를 죽여도 물건은 정확히 한 번 도달한다.
- [ ] AC-5 수령 RPC 는 `(profile_id, date_seed)` 복합 PK 로 멱등이며, **굴린 결과를 그 행에 함께 적어** 재시도가 다시 굴리지 않는다.

### streak-state
- [ ] AC-6 `profiles` 에 직전 수령 `date_seed` 와 현재 연속일 두 컬럼이 정본으로 있고, 클라 UPDATE 가 트리거로 봉인된다.
- [ ] AC-6b `profiles.lifetime_granted`(상한 앵커)가 신설되고, 클라 UPDATE 와 **INSERT 가 둘 다**
  트리거로 봉인된다. ⚠️ AC-6 을 "컬럼 3개"로 넓히지 않고 별도 AC 로 세운 이유 — 앵커는 *연속일
  저장*이 아니라 *상한*의 개체다(§Ontology). 섞으면 AC-6 의 주제가 흐려진다. INSERT 봉인을
  명시한 것도 이 컬럼 때문이다: 클라가 자기 프로필을 `lifetime_granted` 가 부풀려진 채로
  최초 INSERT 하면 UPDATE 봉인만으로는 못 막는다(RLS 는 소유권만 검사한다).
- [ ] AC-7 연속 판정은 "직전 수령 `date_seed` 가 오늘−1 인가" 하나이며, 수령 원장을 스캔하지 않는다.
- [ ] AC-8 하루를 놓치면 연속일이 **1** 이 된다(0 도, 절반도, 유지도 아니다).
- [ ] AC-9 30일차 수령 다음 수령은 연속일 1 로 돌아간다.

### selection
- [ ] AC-10 축마다 목표 후보 생산기가 있고, 각 후보에 거리 점수가 붙는다.
- [ ] AC-11 낙찰은 **공통 가치 예산 안에서 거리 최소값**이다.
- [ ] AC-12 후보가 0개면 재화로 폴백한다.
- [ ] AC-13 동점은 `(date_seed, userSeed)` 시드로 결정론적으로 갈린다 — 같은 입력이면 항상 같은 낙찰.
- [ ] AC-14 같은 목표가 연속으로 낙찰되는 것이 허용되고, 화면이 몇 번째 걸음인지 표시한다.

### ramp-shape
- [ ] AC-15 연속일 → 공통 가치 예산이 **직선**이다(계단·마일스톤 해금이 없다).
- [ ] AC-16 6축이 하나의 가치 단위로 환산돼 서로 견줄 수 있다.
- [ ] AC-17 상한 유계가 **예산 천장**으로 표현되며, 30일차에도 예외가 없다.

### ui-copy
- [ ] AC-18 그날 첫 기지 진입 시 모달이 뜨고, 그날 두 번째 진입부터는 뜨지 않는다.
- [ ] AC-19 모달에 "받기" 버튼이 없다 — 열린 시점에 이미 지급됐고 화면은 통지다.
- [ ] AC-20 헤더에 연속일 칩이 있고, 눌러 같은 모달을 재열람한다. 크레딧·광물 칩과 제목이 **겹치지 않는다**(실화면 실측).
- [ ] AC-21 예고는 종류·등급·지시 계급까지만 보여주고, 랜덤 값(어픽스·사용 횟수 등)은 감춘다.
- [ ] AC-22 도움말 모달이 있고 **"하루 놓치면 1일차로 리셋"** 과 **"받을 수 있는 것의 상한이 지금까지 서버가 지급한 총량에 묶인다"** 를 말한다. ⚠️ 초판의 *"상한이 자기 최고 클리어 단계에 묶인다"* 는 앵커 교체 뒤 **플레이어에게 거짓을 말하는 문구**가 됐다.
- [ ] AC-23 KO/EN 카탈로그 키가 짝으로 있고, KO 문구가 `catalog.ts` 의 `KO` 선언부 주석에 있는 용어 정본표를 따른다.

### verification
- [ ] AC-24 `dailyRewardContract.test.ts` 가 마이그레이션 SQL 본문을 읽어 상한 산식·RLS 정책·복합 PK·트리거 봉인을 잠근다.
- [ ] AC-25 **`authenticated` 가 수령 RPC 에 도달하지 못하고**(`prove-daily-reward-seal.ps1` 의
  `[OK] RPC_DENIED_AUTHENTICATED`), **`service_role` 수령에서 상한이 문다**
  (`prove-daily-reward-cap.ps1` 의 `[OK] CAP_CLAMPED`). 둘 다 `BEGIN…ROLLBACK` 안이다.
  - ⚠️ 초판의 *"미러를 위조한 상태로 `authenticated` 역할 수령을 실행해"* 는 **두 번 틀렸다.**
    ①앵커가 미러에서 `lifetime_granted` 로 바뀐 순간 **미러 위조는 상한과 무관**해져 항진
    테스트가 됐다(무엇을 구현하든 통과한다). ②수령 RPC 는 `revoke all ... from authenticated`
    이므로 그 절차대로 짜면 **permission denied 로 즉시 실패**한다 — 그리고 그 거부야말로
    이 AC 가 실제로 재야 할 것이었다.
- [ ] AC-26 하네스에서 30일차까지 치트로 밀어 모달·칩·연속일 표시를 실화면으로 확인한다.

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|---|---|---|
| 서버가 굴린 물건을 클라에 넘기는 규약이 리포에 있다 | 의뢰 기능의 실제 경로를 추적 | **없다.** `commission_grants` 는 EF 게이트용 감사 기록이고 `fetchCommissionGrantsOnline` 은 아무도 호출하지 않는다 → 배송함 + `applied_at` 을 이 레인이 만든다 |
| 배송이 6축 모두의 문제다 | 각 테이블의 RLS 정책 확인 | **다섯은 이미 서버 정본**(`select_own` 만 있어 RLS 기본 거부) → 장비 하나만 배송 문제다 |
| 기지에 9번째 건물을 넣을 수 있다 | `CELLS`·`TILE_W`·`DESIGN_WIDTH` 실측 | **못 넣는다.** 건물은 7종이고 8칸 = `[4,4]`, 1행 폭 1798 이 1920 의 여유 끝. 9칸이면 2256 으로 336px 넘침 → 헤더 칩 |
| 전멸 리셋이 리포 철학과 맞는다 | 래더 "시즌 리셋 없음" · 풍화 "바닥 50%" 제시 | **어긋나지만 유지.** 연속 접속은 벌어들인 자산이 아니라 참·거짓이 있는 사실 서술이므로 감쇠 개념이 성립하지 않는다 |
| 30일차는 잭팟(불연속 점프)이다 | 램프가 직선으로 결정된 뒤 용어 재검 | **잭팟이 아니다.** 직선의 최고점이므로 용어집·ADR 에서 "최고점"으로 교정 |
| 등급 확률표를 밀면 램프가 된다 | 크레딧·광물·촉매에 등급이 있는지 확인 | **없다.** 등급 없는 축을 표현하지 못해 손잡이가 6개로 늘어난다 → 공통 가치 예산으로 환산 |
| 재사용할 가치표가 `data/economy.ts` 에 있다 | export 목록 확인 | **없다.** 용도별 비용 함수뿐 → 환산표 신규 저작 |
| 수령 시점은 자명하다 | 예고 확정이 "수령 순간"에 묶인 것과 대조 | **정의돼 있지 않았다.** 버튼을 두면 제3의 상태가 생겨 연속일·예고가 미확정 → 진입 = 지급, 화면은 통지 |
| 반복 낙찰을 막아야 한다 | 진행 견인의 정의와 대조 | **막지 않는다.** 막으면 어느 목표도 완성되지 않는다. 대신 진행 표시로 카운트다운이 된다 |
| 서버 가드는 마이그레이션 적용으로 검증된다 | `prove-*.ps1` 헤더 확인 | **못 한다.** 적용 스크립트는 모든 문을 `postgres` 로 돌려 클라 거부를 확인할 수 없다 → 별도 실증 스크립트 필수 |

## Technical Context

**날짜 경계** — `shopDateSeedFromMs(nowMs) = floor(nowMs / 86_400_000)`(`data/coreModules.ts:476`). EF 가 서버 시각으로 계산하고 클라 입력을 신뢰하지 않는다(`supabase/functions/modules/index.ts:107`).

**아이템 롤러** — `rollItem(dropSeed, rarity, source)`(`src/items/roll.ts`)는 순수 함수이고 `Math.random`·`Date.now` 를 쓰지 않는다. EF 가 `src/**` 를 import 하는 선례가 있다(`verify-commission` 이 `src/sim/replay.js`).

**신뢰 경계** — 서버 권위: `profiles.credits/minerals`(트리거 봉인) · `catalyst_inventory` · `core_modules` · `defense_blueprints` · `commission_inventory`(전부 `select_own` 만) · `pve_runs` · `ladder`. 클라 쓰기 미러: `profiles.save` · `ships`(`for all`) · `items`(`items_rw_own for all`).

**멱등 선례** — `module_shop_purchases`·`card_shop_purchases` 의 `(profile_id, date_seed, slot_index)` 복합 PK. `commission_grants` 의 `(commission_run_id, kind, slot_index)` + TTL 금지 주석.

**검증 관행** — `*Contract.test.ts`(SQL 본문 파싱) · `prove-*.ps1`(JWT 클레임 위조 + `BEGIN…ROLLBACK`) · `*AaaLayout.test.ts`(레이아웃 잠금) · `apply-*-migration.ps1`. 테스트 파일 299개.

**기지 레이아웃** — `BUILDINGS` 7종, `CELLS = BUILDINGS.length + 1`(+1 = 출격 카드), `rowSplit(n) = [ceil(n/2), n-ceil(n/2)]`, `TILE_W = 424`, `TILE_GAP = 34`, `DESIGN_WIDTH = 1920`. 칩: `CHIP_W = 200`, `CHIP_MARGIN = 150`, `CHIP_Y = 52`.

**도움말** — 13개 화면이 `helpModal` 사용, `.help'` 키 26개.

**검증 3단**(리포 CLAUDE.md) — 편집 중 `npx vitest run tests/<짝>.test.ts`(약 7초) → 커밋 전 `pnpm test:changed`(약 34초) → PR 전 `pnpm verify`(약 2분 30초, 파이프 금지).

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|---|---|---|---|
| 일일 보상 | core domain | date_seed, 주 보상, 곁들이 크레딧 | 보상 예고를 확정한다 · 연속 접속을 증가시킨다 · 배송함 항목을 낳는다 |
| 보상 예고 | core domain | 종류, 등급, 지시 계급, 확정 시각 | 일일 보상 수령이 확정한다 · 다음날 일일 보상이 소비한다 |
| 연속 접속 | core domain | 직전 수령 date_seed, 연속일(1~30) | 공통 가치 예산을 정한다 |
| 배송함 항목 | core domain | item_payload, applied_at, date_seed | 일일 보상이 낳고 클라가 반영한다 (장비 축 전용) |
| 목표 후보 | core domain | 축, 거리 점수, 걸음 순번 | 진행 견인이 생산한다 · 공통 가치 예산이 거른다 |
| 공통 가치 예산 | supporting | 연속일 파생 점수, 상한 천장 | 연속 접속이 정한다 · 목표 후보를 거른다 |
| 진행 견인 | supporting | 축별 생산기 | 목표 후보를 만든다 |
| 상한 | supporting | `profiles.lifetime_granted`(생애 누적 지급액) 파생 + 신규 계정 하한 `FLOOR` | 공통 가치 예산의 천장이 된다 · `currency_grants` AFTER INSERT 트리거가 앵커를 가산한다 |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability |
|---|---|---|---|---|---|
| 1 | 6 | 6 | - | - | N/A |
| 2 | 6 | 0 | 0 | 6 | 100% |
| 3 | 7 | 1 (목표 후보) | 0 | 6 | 86% |
| 4 | 7 | 0 | 0 | 7 | 100% |
| 5 | 7 | 0 | 0 | 7 | 100% |
| 6 | 7 | 0 | 0 | 7 | 100% |
| 7 | 8 | 1 (공통 가치 예산) | 0 | 7 | 88% |
| 8 | 8 | 0 | 0 | 8 | 100% |
| 9 | 8 | 0 | 0 | 8 | 100% |

개체는 선행 grill 세션에서 이미 수렴해 있었고, 이 인터뷰가 줄인 것은 **개체가 아니라 기구**의
모호함이다 — 그래서 안정도가 처음부터 높고 라운드가 산식·계약을 겨눴다.

## Interview Transcript

<details>
<summary>Full Q&A (Round 0 + 9 rounds)</summary>

### Round 0 — 토폴로지
**Q:** 5개 컴포넌트가 맞는가?
**A:** 6번을 추가 — 밸런스 계산의 모양
**Ambiguity:** 미측정

### Round 1 — delivery / Goal
**Q:** 장비를 어떻게 배송하나?
**A:** 배송함 + 반영 확인 RPC
**Ambiguity:** 58%

### Round 2 — ramp-shape / Goal
**Q:** 30일 램프가 구조적으로 어떤 모양인가?
**A:** 매일 조금씩 오르는 직선형
**Ambiguity:** 54% — "잭팟" 용어 충돌 발견·교정

### Round 3 — selection / Goal
**Q:** 진행 견인은 거리를 무엇으로 재나?
**A:** 축별 목표 후보 생산기
**Ambiguity:** 48%

### Round 4 — streak-state / Goal (Contrarian)
**Q:** 이 게임에 0 으로 가는 장치가 하나도 없는데 전멸 리셋을 그대로 두나?
**A:** 그대로 둔다 — 이건 다른 축이다
**Ambiguity:** 46%

### Round 5 — verification / Goal
**Q:** 완료 판정에 무엇을 요구하나?
**A:** 3단 관문
**Ambiguity:** 38%

### Round 6 — ui-copy / Goal (Simplifier)
**Q:** 화면·문구 1차 범위?
**A:** 전용 개봉 연출 + 신규 사운드까지
**Ambiguity:** 33%

### Round 7 — ramp-shape / Goal
**Q:** 연속일이 직선으로 무엇을 밀어 올리나?
**A:** 공통 가치 예산
**Ambiguity:** 25%

### Round 8 — selection / Constraints
**Q:** 같은 목표가 여러 날 연속 제안되는 것을 허용하나?
**A:** 허용 + 진행 표시
**Ambiguity:** 23%

### Round 9 — delivery↔ui-copy / Constraints
**Q:** 수령은 언제 일어나며 모달을 닫으면?
**A:** 모달이 열리면 이미 지급됨 — 모달은 통지
**Ambiguity:** 20% (임계값 달성)

</details>
