/**
 * 일일 보상 — 연속 접속 · 공통 가치 예산 · 상한 유계의 순수 산식 (ADR-0048).
 *
 * ## 이 파일이 정본인 것과 아닌 것
 *
 * 정본: **연속일 전이**(AC-7~AC-9) · **직선 램프**(AC-15) · **진입 게이트 판정**.
 * 정본 아님: **예산 천장(상한 유계)의 최종 권위는 SQL 이다.** `claim_daily_reward_for`
 * 본문이 `profiles.lifetime_granted` 로 천장을 계산해 반환하고, Edge Function 은 그
 * 반환값을 소비만 한다(계획 §C4). 여기 있는 {@link budgetCeilingFromLifetime} 은 그
 * **SQL 산식의 TS 미러**이며, 클라 표시·테스트·후보 필터링용이다. SQL 을 고치면 여기도
 * 함께 고쳐야 하고, `tests/dailyRewardContract.test.ts` 가 두 산식의 상수 미러를 대조한다.
 * (산식을 EF 에만 두는 안은 기각됐다 — `prove-*.ps1` 이 TypeScript 를 실증할 수 없어
 * 완료 관문 ②가 죽은 관문이 된다.)
 *
 * ## 규율
 *
 * 이 파일은 **순수**하다 — `Math.random`·`Date.now`·벽시계를 쓰지 않는다. Edge Function 이
 * 그대로 import 하므로 `src/items/roll.ts` 헤더의 규율을 승계한다. 시각이 필요한 곳은
 * 호출 측이 `nowMs` 를 공급하고, 날짜 경계는 새 관념을 만들지 않고
 * {@link shopDateSeedFromMs} 를 **재사용**한다(ADR-0048 §왜 UTC 경계인가).
 *
 * ## 상수는 전부 placeholder 다
 *
 * `// BALANCE` 주석이 붙은 상수는 **출시 직전 일괄 튜닝** 대상이다(defer-balance-tuning).
 * 지금 값은 산식의 모양을 시험할 수 있는 보수적 잠정값이며, 비율·부호·단조성만 의미가 있다.
 */

import { shopDateSeedFromMs } from './coreModules.js';

// ---------------------------------------------------------------------------
// 연속 접속 (AC-6 ~ AC-9)
// ---------------------------------------------------------------------------

/**
 * 연속 접속 주기. 30일차가 직선 램프의 **최고점**이고 그 다음 수령은 1일차로 돌아간다
 * (AC-9). "잭팟"이 아니다 — 별도로 얹은 상품이 아니라 같은 직선의 끝점이다.
 */
export const DAILY_STREAK_CYCLE = 30;

/**
 * "아직 한 번도 받지 않았다"를 나타내는 `daily_last_claim_seed` 의 값. SQL 컬럼 기본값과
 * **반드시 같아야 한다**(`daily_last_claim_seed bigint not null default 0`).
 *
 * `-1` 이 아니라 `0` 인 이유는 **봉인 트리거의 모양** 때문이다. `guard_profiles_client_insert`
 * 는 `new.X := 0;` 열거식이고 계약 테스트가 그 **정규식과 총수**를 단언한다
 * (`tests/catalystShopContract.test.ts` — `new\.(\w+)\s*:=\s*0\s*;`). 컬럼 하나만 `:= -1` 로
 * 두면 그 컬럼이 계약의 시야 밖으로 빠져 **봉인이 있다고 세면서 실제로는 세지 않는** 상태가
 * 된다. 신규 3컬럼을 전부 0 으로 두면 세 개가 같은 정규식에 걸려 3 → 6 이 참이 된다.
 *
 * 0 을 센티넬로 써도 안전하다 — {@link nextStreak} 이 `prevSeed === nowSeed - 1` 만 보므로
 * `prevSeed = 0` 은 어떤 현실적 `nowSeed` 에 대해서도 "끊김"으로 판정돼 1 이 된다. 유일한
 * 겹침은 1970-01-02 수령(=`nowSeed` 가 1)인데, 그것은 서버 시계가 epoch 에 있다는 뜻이다.
 */
export const DAILY_SEED_NEVER = 0;

/**
 * 이번 수령 뒤의 연속일.
 *
 * ADR-0048 이 정한 것은 셋이다:
 *  - **직전 수령이 오늘−1 이면 이어진다**(AC-7 — 원장을 스캔하지 않는다. 필요한 정보가
 *    "직전 수령이 오늘−1 인가" 하나뿐이라 30일치 스캔이 연속일 읽기의 핫 경로가 될 이유가 없다).
 *  - **하루라도 놓치면 1 이다**(AC-8 — 0 도, 절반도, 유지도 아니다. 오늘 수령분이 이미
 *    1일차이므로 0 이 될 수 없고, 전멸 리셋이므로 절반이 없다).
 *  - **30일차 다음은 1 이다**(AC-9).
 *
 * 같은 날 재호출은 **불변**이다 — 멱등 경로(복합 PK 충돌)가 이 함수를 다시 부르더라도
 * 연속일이 자라면 안 된다.
 *
 * @param prevSeed  직전 수령 `date_seed`. 미수령이면 {@link DAILY_SEED_NEVER}.
 * @param nowSeed   오늘의 `date_seed`(서버가 계산한 값).
 * @param prevStreak 현재 연속일(0 = 미수령).
 */
export function nextStreak(prevSeed: number, nowSeed: number, prevStreak: number): number {
  // 같은 날 재호출 — 아무것도 바뀌지 않는다. 이 분기가 없으면 멱등 재시도가 연속일을 민다.
  if (prevSeed === nowSeed) return prevStreak;
  // 미래 시드(시계 되감김·손상)는 끊긴 것으로 본다. 앞으로 당겨 주면 그것이 곧 위조 창구다.
  if (prevSeed !== nowSeed - 1) return 1;
  // 이어졌다. 30일차 다음은 1 — 주기의 끝에서 되감긴다.
  return prevStreak >= DAILY_STREAK_CYCLE ? 1 : prevStreak + 1;
}

/**
 * 그날 첫 기지 진입인가 — 모달을 열지 말지의 **순수 판정**(AC-18).
 *
 * ⚠️ 진입 **경로**에 훅을 걸지 않는 것이 이 함수의 존재 이유다. 리포 교훈이 정본이다:
 * *"레이어 표시는 진입 경로가 아니라 화면 이름 단일 권위."* 경로별 처방을 쓰면 하나를
 * 놓친 경로의 유저가 그날 모달을 영영 못 본다. `openBaseMap()` 단일 지점이 이 판정을
 * 부르고, 재진입 두 경로(`rerenderCurrentScreen` 언어 전환 · `harnessRefreshScreen`)도
 * 같은 판정을 지나므로 모달이 재발하지 않는다.
 *
 * @param lastSeenSeed 이 클라이언트가 모달을 마지막으로 띄운 `date_seed`(미표시 = {@link DAILY_SEED_NEVER}).
 * @param nowSeed      오늘의 `date_seed`.
 */
export function shouldOpenDailyReward(lastSeenSeed: number, nowSeed: number): boolean {
  return lastSeenSeed !== nowSeed;
}

/** `nowMs` → 오늘의 `date_seed`. 새 날짜 관념을 만들지 않는다(ADR-0048 §왜 UTC 경계인가). */
export function dailyDateSeed(nowMs: number): number {
  return shopDateSeedFromMs(nowMs);
}

// ---------------------------------------------------------------------------
// 공통 가치 예산 — 직선 램프 (AC-15)
// ---------------------------------------------------------------------------

/**
 * 1일차 공통 가치 예산. // BALANCE — 출시 전 일괄 튜닝.
 *
 * 단위는 **크레딧 환산**이다(가치 환산표의 기준축이 재화이므로 — `data/dailyRewardSelection.ts`).
 */
export const DAILY_BUDGET_DAY_1 = 2_000;

/**
 * 30일차(최고점) 공통 가치 예산. // BALANCE — 출시 전 일괄 튜닝.
 *
 * 1일차의 몇 배인가가 램프의 유일한 손잡이다(ADR-0048 §결정표 램프 모양 — 개수·마일스톤을
 * 늘리지 않기로 한 대가로 이 축 하나만 흔든다).
 */
export const DAILY_BUDGET_DAY_30 = 20_000;

/**
 * 곁들이 크레딧 — 주 보상과 **별개로** 매일 고정 지급되는 소액. // BALANCE.
 *
 * 예산에서 빼지 않는다(ADR-0048: *"크레딧은 주 보상 풀에서 빼고 곁들이 자리로 돌린다 —
 * 그래야 '오늘 크레딧 조금이 전부'인 날이 생기지 않는다"*).
 *
 * ⚠️ **서버 per-call 상한과 함께 움직인다.** 한 번의 수령이 `grant_currency_for` 에 넘기는
 * 크레딧은 *곁들이 + (재화 축 낙찰 시) 주 보상*이므로, 그 합이
 * `CAP_DAILY_REWARD_CREDITS`(25,000 — `20260805000000_daily_reward.sql` 9절)를 넘으면
 * **조용히 절삭된다.** 초안은 `daily_reward` 를 미등록 source 로 두어 `CAP_DEFAULT`(1,000)에
 * 걸려 있었고, 그러면 30일차 예산 20,000 이 1,000 으로 잘려 **램프가 그 자리에서 죽는다** —
 * 그래서 그 캡을 등록했다(사용자 확정, 2026-08-05). 지금 여유는
 * `25,000 − (500 + 20,000) = 4,500` 이다. {@link DAILY_BUDGET_DAY_30} 을 올릴 때 이 여유를
 * 함께 보라 — 테스트가 부등식으로 잠근다.
 */
export const DAILY_SIDE_CREDITS = 500;

/**
 * 연속일 → 공통 가치 예산. **직선**이다(AC-15 — 계단도 마일스톤 해금도 없다).
 *
 * 정의역 밖은 주기로 clamp 한다: 0 이하는 1일차, 30 초과는 30일차. 손상된 연속일이
 * 예산을 음수나 무한대로 만들지 않게 하는 것이 목적이다(연속일은 서버 봉인 컬럼이지만
 * 클라 표시 경로가 같은 함수를 쓴다).
 *
 * 램프의 **직선성은 테스트가 잠근다** — n→n+1 증분이 전 구간에서 상수여야 한다.
 */
export function valueBudgetForStreak(streak: number): number {
  const s = Math.min(DAILY_STREAK_CYCLE, Math.max(1, Math.floor(streak)));
  const step = (DAILY_BUDGET_DAY_30 - DAILY_BUDGET_DAY_1) / (DAILY_STREAK_CYCLE - 1);
  return DAILY_BUDGET_DAY_1 + step * (s - 1);
}

// ---------------------------------------------------------------------------
// 상한 유계 — 예산 천장 (AC-17)
// ---------------------------------------------------------------------------

/**
 * 생애 누적 지급액 → 예산 천장의 환산 계수. // BALANCE — 출시 전 일괄 튜닝.
 *
 * 이 계수 하나가 *"얼마나 플레이해야 30일차 최고점을 실제로 받을 수 있는가"*를 정한다.
 * `천장 = lifetime_granted × 이 값` 이고, {@link DAILY_BUDGET_DAY_30} 에 닿는 누적은
 * `20000 / RATE` 다.
 *
 * ## 왜 0.02 에서 0.2 로 올렸나 (2026-08-05, 30일 시뮬레이션 결과)
 *
 * 0.02 는 30일차 개방에 누적 **1,000,000** 을 요구했다. 그 값이 실제로 무엇을 뜻하는지
 * 30일 시뮬레이션으로 재 보니 설계 의도와 반대였다:
 *
 * | 획득 속도 | 일일 앵커 증가 | FLOOR 탈출 | 30일차 개방 |
 * |---|---|---|---|
 * | 신규(런 1회/일, 800cr+300min) | +3,200 | **31일** | **312일** |
 * | 중반(런 5회/일) | +112,500 | 0.9일 | 8.9일 |
 * | 파밍 세션(런 20회) | +900,000 | 0.1일 | 1.1일 |
 *
 * 즉 **매일 성실히 플레이하는 신규도 30일 내내 FLOOR 에 눌려** 연속 접속 램프를 한 번도
 * 못 본다(시뮬레이션에서 플레이하는 신규와 접속만 하는 신규의 30일 총액이 **74,000 으로
 * 동일**했다). ADR-0048 이 적은 *"낮게 받는 것은 접속만 하고 플레이가 0인 경우뿐이며,
 * 그것이 의도된 결과다"* 가 그 계수에서는 **거짓**이었다.
 *
 * 0.2 는 같은 표에서 신규 FLOOR 탈출을 **3.1일**, 30일차 개방을 **31일**로 만든다 —
 * "한 달 성실히 하면 30일차 최고점에 닿는다"가 되어 연속 접속 주기와 눈금이 맞는다.
 * 대가는 중반 이상에서 천장이 더 빨리 사문화되는 것인데, 0.02 에서도 이미 0.9일이라
 * 실질 차이가 없다. 상한 유계가 겨누는 것은 **플레이 0 계정**이고 그쪽은
 * {@link DAILY_BUDGET_FLOOR} 가 그대로 막는다.
 *
 * ⚠️ SQL 미러(`20260805000000_daily_reward.sql` 6절 `daily_reward_preview_for`)와 **반드시
 * 같은 값**이어야 한다. 계약 테스트가 두 리터럴을 대조한다.
 */
export const DAILY_CEILING_RATE = 0.2;

/**
 * 예산 천장의 **하한(FLOOR)** — 생애 누적이 0 인 신규 계정도 받을 것이 있어야 한다.
 *
 * ## 왜 하한이 필요한가
 *
 * 앵커를 `profiles.lifetime_granted` 로 바꾸면서 생긴 구멍이다. 신규 계정은 누적이 0 이라
 * 천장도 0 이 되어 **30일을 채워도 받을 것이 없다** — ADR-0048 의 "접속만으로 성립"과
 * 정면 충돌한다. 옛 앵커(클리어 단계)에는 이 문제가 없었다(1단계만 깨도 값이 생긴다).
 *
 * ## 왜 하한이 상한 유계를 무너뜨리지 않는가 — 값을 이렇게 고른 이유
 *
 * 하한은 *"플레이 0 인 계정이 영원히 받을 수 있는 최대치"*다. 그래서 **{@link DAILY_BUDGET_DAY_1}
 * 과 같게** 둔다. 그 결과가 이것이다:
 *
 *  - 플레이 0 계정의 예산은 `min(램프, max(FLOOR, 0)) = min(램프, DAY_1) = DAY_1` 로
 *    **연속일과 무관하게 1일차에 고정**된다. 30일을 봇으로 접속해도 30일차 물건이 나오지
 *    않는다 — 램프가 그 계정에는 **보이지 않는 장치**가 된다. ADR §왜 30일차 최고점에도
 *    상한이 이기는가가 막으려던 것이 정확히 이것이고, 하한을 DAY_1 로 두면 그 문장이
 *    신규 계정에도 그대로 참이 된다.
 *  - 멀티계정 공격의 수익은 **계정당 하루 DAY_1 하나**다. 이 값은 설계상 런 1회 지급
 *    규모 언저리이므로, 계정 N개를 30일 돌려 얻는 것이 정직한 플레이 몇 십 분 분량이다.
 *    ADR 의 정당화(*"위조해도 정직한 플레이로 이미 닿는 범위 안"*)가 유지된다.
 *  - 정직한 신규 유저에게는 하한이 **사실상 보이지 않는다.** 첫 런을 끝내면
 *    `lifetime_granted` 가 즉시 오르고(정산이 `currency_grants` 에 행을 남긴다) 천장이
 *    `lifetime × RATE` 쪽으로 넘어간다. 하한이 무는 구간은 "가입하고 아직 한 판도 안 한
 *    상태"뿐이다.
 *
 * ⚠️ **이 값을 {@link DAILY_BUDGET_DAY_1} 위로 올리면 그 순간 유계가 깨진다** — 플레이 0
 * 계정이 램프 중간 이상을 무료로 받게 되고, 30일 봇 접속이 다시 이득이 된다. 밸런스
 * 튜닝에서 DAY_1 을 올리는 것은 무방하지만 **하한을 DAY_1 에서 떼어 독립 상수로 만들지
 * 마라** — 그래서 파생으로 묶어 둔다(별도 리터럴이면 한쪽만 조정돼 조용히 갈린다).
 */
export const DAILY_BUDGET_FLOOR = DAILY_BUDGET_DAY_1;

/**
 * 생애 누적 지급액 → 예산 천장.
 *
 * ⚠️ **정본은 SQL 이다**(`claim_daily_reward_for` 본문). 이 함수는 그 TS 미러이며 클라
 * 표시·후보 필터링·테스트용이다 — 계약 테스트가 두 산식의 상수를 대조한다. 산식을
 * EF 에만 두는 안은 기각됐다(`prove-*.ps1` 이 TypeScript 를 실증할 수 없다).
 *
 * 음수·NaN·Infinity 는 0 으로 접는다. `lifetime_granted` 는 서버 봉인 단조 컬럼이지만
 * 클라 표시 경로가 같은 함수를 쓰므로 손상 입력이 천장을 무한대로 만들면 안 된다.
 */
export function budgetCeilingFromLifetime(lifetimeGranted: number): number {
  const lg = Number.isFinite(lifetimeGranted) && lifetimeGranted > 0 ? lifetimeGranted : 0;
  return Math.max(DAILY_BUDGET_FLOOR, lg * DAILY_CEILING_RATE);
}

/** {@link resolveDailyBudget} 의 결과. `clamped` 는 관측 지표 ③의 데이터 소스다. */
export interface DailyBudgetResolution {
  /** 실제로 쓸 수 있는 예산 = `min(ramp, ceiling)`. */
  readonly budget: number;
  /** 연속일이 민 값(상한 적용 전). */
  readonly ramp: number;
  /** 생애 누적이 정한 천장. */
  readonly ceiling: number;
  /**
   * 상한이 실제로 물었는가. `daily_reward_claims.clamped` 컬럼에 그대로 적힌다 —
   * 이 값이 없으면 관측 지표 ③(상한 절삭 발생률)이 **담을 컬럼이 없는 죽은 계측기**가 된다.
   */
  readonly clamped: boolean;
}

/**
 * 그날의 공통 가치 예산 — 램프와 상한을 합쳐 최종값을 낸다 (AC-17).
 *
 * **30일차에도 예외가 없다** — 최고점 역시 `min` 을 통과한다. 여기에 예외를 두면 그 예외가
 * 정확히 봇·멀티계정의 표적이 된다(ADR-0048 §왜 30일차 최고점에도 상한이 이기는가).
 */
export function resolveDailyBudget(streak: number, lifetimeGranted: number): DailyBudgetResolution {
  const ramp = valueBudgetForStreak(streak);
  const ceiling = budgetCeilingFromLifetime(lifetimeGranted);
  return { budget: Math.min(ramp, ceiling), ramp, ceiling, clamped: ramp > ceiling };
}
