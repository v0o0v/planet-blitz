/**
 * 표준 진행 경로 — 경제 밸런싱의 **설계 테이블** (ADR-0035 · ADR-0036).
 *
 * "만렙까지 침략 10시간"이라는 목표를 측정이 아니라 **설계값**으로 못박는다. 여기 있는 것은
 * 기체 레벨 ↔ 침략 단계 대응, 각 레벨 밴드에서 도는 단계, 그 단계의 런당 기대 메타 XP,
 * 그리고 그것들이 파생하는 필요 런 수·시간이다. `tests/progressionPath.test.ts` 가 이 테이블에서
 * **산술로 파생한** 총 시간이 목표(36,000초) ±5% 안인지, 곡선이 절벽 없이 완만한 우상향인지를
 * 게이트한다(하드코딩 기대값이 아니라 테이블 파생 — ADR-0035 "검증되는 것은 산술뿐").
 *
 * ## 왜 순수 모듈인가
 * sim 을 import 하지 않는다(타입도). `xpToNextMeta` 는 **메타 풀 전용** 커브이고 sim 런타임
 * (`checkLevelUp`)은 절대 호출하지 않는다 — 런 풀 커브는 `src/sim/world.ts` 의 `xpToNext` 다.
 * 두 커브가 한 파일에 있으면 다시 섞여 들어간다(ADR-0036 이 갈라놓은 바로 그 결함).
 *
 * ## 결정론
 * 전부 정수 사칙연산이다. 저단계 감쇠도 **정수 퍼센트**로 표현해(0.1 곱 대신 `×pct/100`)
 * 부동소수 누적 오차를 원천 차단한다. 이 계층은 해시에 접히지 않지만, 정산 결과가 세이브에
 * 남고 서버 미러로 나가므로 재현성을 같은 규율로 지킨다.
 */

import { LEVEL_CAP } from '../../data/waves.js';

// ---------------------------------------------------------------------------
// 대응 축 (ADR-0035)
// ---------------------------------------------------------------------------

/**
 * 침략 단계 1당 기대 기체 레벨. **이 상수의 정본은 여기다** — `src/items/requiredLevel.ts`
 * 의 드랍처 상한(`stageLevelCap`)이 이 값을 import 해서 쓴다(ADR-0030 ↔ ADR-0035 정합).
 * 만렙 100 ↔ 표준 단계 20 이라는 대응 전체가 이 한 수에서 나온다.
 */
export const LEVEL_PER_STAGE = 5;

/** 표준 경로의 마지막 단계(= 만렙에 대응하는 단계). 만렙 100 / 5 = 20. */
export const MAX_STANDARD_STAGE = Math.ceil(LEVEL_CAP / LEVEL_PER_STAGE);

/** 이 기체 레벨의 조종사가 도는 **표준 침략 단계**(ADR-0035). `ceil(Lv / 5)`, [1, 20] 클램프. */
export function standardStage(shipLevel: number): number {
  if (!Number.isFinite(shipLevel)) return 1;
  const s = Math.ceil(shipLevel / LEVEL_PER_STAGE);
  return s < 1 ? 1 : s > MAX_STANDARD_STAGE ? MAX_STANDARD_STAGE : s;
}

// ---------------------------------------------------------------------------
// 메타 풀 커브 (ADR-0036)
// ---------------------------------------------------------------------------

/**
 * 메타 커브 계수 — `xpToNextMeta(L) = META_XP_BASE + META_XP_SLOPE × L`.
 *
 * 도출: 밴드 s 의 런당 기대 메타 XP 가 {@link metaXpPerRun}(≈ `E1 × s`)이므로, 밴드마다 필요
 * 런 수를 거의 일정하게 두려면 밴드 s 필요 XP 도 s 에 비례해야 한다. 밴드는 레벨 5개를 덮고
 * s ≈ L/5 이므로 레벨당 필요 XP 는 레벨에 **선형**이 된다 — 그래서 1차식이다. 그 결과가
 * 절벽 없는 완만한 우상향(ADR-0035 가 GDD 의 "Lv70+ 급증"을 폐기한 형태)이고, 실제로 밴드별
 * 필요 런 수는 **14.1~20.7런**(인접 밴드 비 최대 1.29 ≤ 1.5)에 들어온다.
 *
 * 기울기 1790 은 §1.2 산술이 {@link TARGET_TOTAL_SECONDS} ±5% 를 내도록 조정한 값이다
 * (총 **35,937초 = 목표의 99.83%**, 총 378.3런). 절편 40 은 Lv1 구간이 지나치게 짧아지지 않게
 * 두는 바닥이며 총 시간에 거의 영향이 없다(1회분 미만).
 *
 * ⚠️ **구값 225 는 낡은 입력에서 나온 값이었다.** 225 는 `RUN_META_XP_STAGE1 = 433` ·
 * `RUN_SECONDS_PAR = 150` · `E(s) = E1 × s` 선형 가정을 전제로 풀렸는데, 세 전제가 전부
 * 실측과 어긋나 있었다(§{@link RUN_META_XP_STAGE1} · §{@link RUN_SECONDS_PAR} ·
 * §{@link RUN_XP_GROWTH_GAIN_PERMILLE}). 그런데도 `tests/progressionPath.test.ts` 는 **순수
 * 산술이라 전량 통과**했다 — 이 리포의 반복 결함("단위 테스트 그린인데 배선이 통째로 어긋나
 * 있다")의 경제 축 판본이다. 그래서 같은 테스트 파일에 **정규 경로 실런 가드**를 함께 넣었다.
 */
export const META_XP_BASE = 40;
export const META_XP_SLOPE = 1790;

/**
 * 기체 레벨 `level` 에서 **다음 레벨**까지 필요한 메타 XP. 만렙에서는 0 —
 * 다음 레벨이 없다는 사실을 커브 자체로 표현한다(`grantXp` 가 이 0 을 캡 강제의 1차 방어로 쓴다).
 *
 * ⚠️ 런 풀 커브(`xpToNext`, `src/sim/world.ts`)와 **완전히 별개 함수**다. sim 런타임은 이것을
 * 호출하지 않고, 정산(`settleRun`/`grantXp`)만 호출한다.
 */
export function xpToNextMeta(level: number): number {
  if (!Number.isFinite(level) || level >= LEVEL_CAP) return 0;
  const l = level < 1 ? 1 : Math.floor(level);
  return META_XP_BASE + META_XP_SLOPE * l;
}

// ---------------------------------------------------------------------------
// 저단계 감쇠 (ADR-0036 §계층 배치 — 정산 계층 전용)
// ---------------------------------------------------------------------------

/** 감쇠가 시작되지 않는 단계 부족분(표준 단계보다 이만큼 아래까지는 무감쇠). */
export const DECAY_FREE_GAP = 3;
/** 부족 1단계당 깎는 퍼센트 포인트. */
export const DECAY_STEP_PCT = 10;
/** 감쇠 하한 퍼센트. 진행이 **멈추지는 않는다**(최악 33시간, ADR-0035 §Consequences). */
export const DECAY_FLOOR_PCT = 30;

/**
 * 저단계 파밍 감쇠 배율을 **정수 퍼센트**(30..100)로 돌려준다.
 *
 * `부족 = 표준단계(기체레벨) - 런단계`, `pct = clamp(100 - 10×(부족-3), 30, 100)`.
 * 표준보다 3단계 아래까지는 무감쇠라, 벽에 막혀 한 단계 내려가는 정상적인 플레이는 벌하지 않는다.
 *
 * `runStage` 가 없으면(침공 런·구 세이브) **무감쇠(100)** 로 폴백한다 — 알 수 없는 출처를
 * 과도하게 벌하지 않는다. 침공은 애초에 `settleRun` 에 도달하지 않는다(`src/main.ts`).
 */
export function lowStageXpDecayPercent(shipLevel: number, runStage: number | undefined): number {
  if (runStage === undefined || !Number.isFinite(runStage)) return 100;
  const gap = standardStage(shipLevel) - Math.max(1, Math.floor(runStage));
  const pct = 100 - DECAY_STEP_PCT * (gap - DECAY_FREE_GAP);
  return pct < DECAY_FLOOR_PCT ? DECAY_FLOOR_PCT : pct > 100 ? 100 : pct;
}

// ---------------------------------------------------------------------------
// 설계 테이블
// ---------------------------------------------------------------------------

/**
 * 단계 1 런 1회의 기대 메타 XP(**승·패 전 런 평균**).
 *
 * ## 측정 출처 (2026-07-27 경제 재보정 · Lane F)
 * - 경로: `runCurveSweep` 과 동일한 정규 경로(`standardEquipped` → `buildRunConfig` →
 *   `createWorld` → `stepWorld(state, autopilotInput(state))`)
 * - 조건: 기체 `striker`(typeId 0) · `planet 0` · 표준 레벨 5 / 표준 장비 / 표준 투자 ·
 *   **시드 96개** · 상한 18,000틱 · **`gearSeed` 미고정**(런 시드를 장비 시드로 — 고정하면
 *   장비 세트 하나의 운을 재게 된다. 실측 폭 48~100%)
 * - 트리: `git HEAD bc73201` + 2026-07-27 밸런싱 레인 작업트리
 *   (`data/waves.ts` = `dd810712…`, `src/sim/world.ts` = `6bad25a4…`)
 * - 실측: **1,804.2** (승 2,062.0 / 패 1,334.3 · 승률 64.6%)
 *
 * ## ⚠️ 구값 433 이 낡았던 경위
 * 433 은 **무장비 · `killGoal` 합계 80** 시절의 값이었다. 표준 장비 세트가 도입되고 적 곡선
 * 레인이 `killGoal` 합계를 240 으로 올리자 실제 값이 **약 4배**가 됐는데, 이 상수는 그대로였다.
 * 단위 테스트는 이 상수만 가지고 산술을 검사하므로 **전량 초록이었다.**
 *
 * ## 왜 전 런 평균인가
 * 파밍 시간에는 **패배 런도 포함**된다. 승리 런만 세면(2,062.0) 진행 속도를 약 14% 과대
 * 평가한다. {@link RUN_SECONDS_PAR} 도 같은 이유로 전 런 기준이라 두 상수의 분모·분자가 정합한다.
 *
 * 단계 s 의 런당 기대 메타 XP 는 `E1 × s` **가 아니다** — {@link runXpGrowthPermille} 참조.
 */
export const RUN_META_XP_STAGE1 = 1804;

/**
 * 런 1회 기준 시간(초) — **전 런(승·패) 평균 생존 시간의 실측값**.
 *
 * ## 측정 출처
 * {@link RUN_META_XP_STAGE1} 과 **같은 스윕**(96시드 × 밴드 대표 20점). 밴드별 전 런 평균은
 * **90.0초(단계1) ~ 100.5초(단계17)**, 평균 **94.7초** → 정수 **95**.
 * (참고: 승리 런만 보면 98.0~105.1초로 약 8% 길다.)
 *
 * ⚠️ 단계 20 은 **제외**하고 평균했다 — 그 점은 표준 빌드 유니크 칸이 4칸이 되며 96런 중
 * **11런이 18,000틱(300초) 상한**에 걸려 평균 생존이 131.3초로 튄다. "런이 길다"가 아니라
 * "안 죽지만 못 끝낸다"라서 par 의 의미와 다르다. 상세는
 * `.omc/research/economy-recalibrated-2026-07-27.md` §6.
 *
 * ## ⚠️ 구값 150 은 문서값이었지 실측이 아니었다
 * 150 = "웨이브 약 90초 + 보스 약 60초"(CONTEXT.md §기준시간)라는 **설계 의도**였는데, 실제
 * 런은 그 63% 에서 끝난다. 적 곡선 레인이 `killGoal` 합계를 80 → 240 으로 올려 런 길이를
 * 33초 → 약 95초로 옮겼지만 par 150 에는 여전히 못 닿았다(닿으려면 추가 ×1.5 가 필요한데
 * 그러면 저밴드 클리어율이 60% 아래로 무너진다).
 *
 * ⚠️ **par 는 여전히 설계 목표(150)와 실측(95)이 갈린 지점이다.** 이 상수는 "10시간 산술의
 * 분모"로 쓰이므로 **실측**이어야 총 시간이 거짓말을 하지 않는다. 설계 목표 150 을 되찾고
 * 싶다면 그것은 적 축 과제이지 이 상수를 되돌릴 일이 아니다.
 */
export const RUN_SECONDS_PAR = 95;

/**
 * 런 풀 XP 의 **단계 성장 배율**(천분율). `E(s) = E1 × s × growth(s) / 1000`.
 *
 * ## 왜 필요한가 — `E(s) = E1 × s` 는 성립하지 않는다
 * `stageMetaXpMult(stage) = stage`(`src/sim/world.ts`)가 sim 에 들어가 있으니 메타 XP 가 단계에
 * 정확히 비례할 것 같지만, 실측은 더 가파르다: `E(11)/E(1) = 13.53`(선형 예상 11 대비 **+23%**),
 * `E(19)/E(1) = 27.20`(예상 19 대비 **+43%**).
 *
 * ## 초과분의 출처 — 특정됐다 (추정이 아니다)
 * 정산이 받는 값은 `xpTotal = Σ (gained × stageMult)` 이고 `stageMult` 는 런 내내 상수이므로
 * **`E(s) = runXp(s) × s` 가 항등식**이다(실측으로도 바이트 일치: 단계2 `1,922.9 × 2 = 3,845.8`).
 * 즉 초과분은 전부 **런 풀 XP 자체가 단계에 따라 커지는 것**이고, 그것은 다시 두 인자의 곱이다:
 *
 * | 인자 | 단계1 | 단계19 | 배수 |
 * |---|---|---|---|
 * | 런당 젬 수 | 212.1 | 264.7 | **×1.248** |
 * | 젬 1개당 XP | 8.506 | 9.758 | **×1.147** |
 * | 곱 = 런 풀 XP | 1,804.2 | 2,582.6 | **×1.431** |
 *
 * 젬 수 증가는 런이 길어져서고(처치 231.8 → 251.3), 젬당 XP 증가는 **적 종류 구성이 바뀌기
 * 때문**이다 — 젬의 XP 값은 `def?.xpValue`(적 타입별 저작값, `src/sim/world.ts`)에서 오고
 * 고단계일수록 `xpValue` 가 큰 타입·정예 비중이 는다. 즉 **설계 의도(단계 비례)에 적 구성
 * 효과가 곱해져 있던 것**이고, 그 사실을 여기서 명시적으로 모델링한다.
 *
 * ## 형태
 * 사칙연산 유리함수다(`Math.exp`/`pow`/`log` 금지 — ADR-0036 결정론 규율, `src/sim/drops.ts`
 * 의 품질 곡선과 같은 계열):
 * ```
 * growth(s) = 1000 + GAIN × (s-1) / ((s-1) + K)
 * ```
 * `s = 1` 에서 정확히 1000(= ×1.0)이고 단조 증가하며 `1000 + GAIN` 에 점근한다.
 *
 * ## 계수의 성격 — **실측 피팅**이고, 형태는 데이터로 식별되지 않는다
 * `GAIN = 1200` · `K = 42`(점근 ×2.2)는 밴드 대표 19점(96시드, 단계 20 은 타임아웃 오염이라
 * 제외)에 최소제곱으로 맞춘 값이다. 잔차 RMSE **0.059**.
 *
 * ⚠️ 대안 형태와 비교하면 **유리함수 0.059 · 선형 0.051 · 보정 없음 0.207** 이다. 즉
 * **보정이 필요하다는 것은 확실하지만(0.207 → 0.06, 70% 감소) 어떤 곡선인지는 이 데이터로
 * 못 가른다** — `K` 를 키울수록 RMSE 가 단조 감소해 선형에 수렴한다. 그런데도 유리함수를 고른
 * 이유는 적합도가 아니라 **유계성**이다: 침략 단계 축이 1..∞ 라 선형은 무한히 오른다.
 *
 * 잔차가 0 이 아닌 이유는 실측 `E(s)` 가 그 단계의 **클리어율**에 끌리기 때문이다(승리 런이
 * 패배 런의 약 1.5배를 적립하므로 클리어율 ±4.7pp = 이항 SE 가 곧 배율 노이즈 ±0.015~0.02 로
 * 전파된다). 즉 이 곡선은 물리 법칙이 아니라 **관측 요약**이며, 적 곡선을 다시 만지면 함께
 * 다시 재야 한다.
 */
export const RUN_XP_GROWTH_GAIN_PERMILLE = 1200;
/** 성장 곡선의 중간점 — `s = 1 + K` 에서 이득의 절반에 닿는다. */
export const RUN_XP_GROWTH_K = 42;

/**
 * 단계 `stage` 의 런 풀 XP 성장 배율(천분율, 1000 = ×1.0). {@link RUN_XP_GROWTH_GAIN_PERMILLE} 참조.
 * 정수 천분율로 돌려 부동소수 누적을 피한다(이 계층의 결정론 규율).
 */
export function runXpGrowthPermille(stage: number): number {
  if (!Number.isFinite(stage) || stage <= 1) return 1000;
  const d = Math.floor(stage) - 1;
  return 1000 + Math.round((RUN_XP_GROWTH_GAIN_PERMILLE * d) / (d + RUN_XP_GROWTH_K));
}

/** 단계 `stage` 런 1회의 기대 메타 XP(설계값) = `E1 × stage × growth(stage)`. */
export function metaXpPerRun(stage: number): number {
  const s = Math.max(1, Math.floor(stage));
  return Math.round((RUN_META_XP_STAGE1 * s * runXpGrowthPermille(s)) / 1000);
}

/** Lv1 → 만렙 목표 순수 런 시간(초) = 10시간. */
export const TARGET_TOTAL_SECONDS = 36_000;

/** 표준 진행 경로의 한 밴드(레벨 5개 = 표준 단계 1개). */
export interface ProgressionBand {
  /** 이 밴드에서 도는 표준 침략 단계(1..20). */
  readonly stage: number;
  /** 밴드 첫 레벨. */
  readonly levelFrom: number;
  /** 밴드 마지막 레벨. */
  readonly levelTo: number;
  /** 이 밴드를 통과하는 데 필요한 메타 XP 총합. */
  readonly metaXpNeeded: number;
  /** 이 단계 런 1회의 기대 메타 XP(= {@link metaXpPerRun} — 단계 비례 × 성장 보정). */
  readonly metaXpPerRun: number;
  /** 필요 런 수(정수로 자르지 않는다 — 밴드 경계는 XP 로 이어진다). */
  readonly runs: number;
  /** 필요 시간(초). */
  readonly seconds: number;
}

function buildPath(): readonly ProgressionBand[] {
  const bands: ProgressionBand[] = [];
  for (let stage = 1; stage <= MAX_STANDARD_STAGE; stage++) {
    const levelFrom = LEVEL_PER_STAGE * (stage - 1) + 1;
    const levelTo = LEVEL_PER_STAGE * stage;
    let metaXpNeeded = 0;
    // 만렙 레벨은 xpToNextMeta 가 0 을 내므로 마지막 밴드가 자동으로 4개 레벨분만 센다.
    for (let level = levelFrom; level <= levelTo; level++) metaXpNeeded += xpToNextMeta(level);
    const perRun = metaXpPerRun(stage);
    const runs = metaXpNeeded / perRun;
    bands.push({
      stage,
      levelFrom,
      levelTo,
      metaXpNeeded,
      metaXpPerRun: perRun,
      runs,
      seconds: runs * RUN_SECONDS_PAR,
    });
  }
  return bands;
}

/** 표준 진행 경로 테이블 — Lv1 → 만렙을 레벨 5개씩 20밴드로 나눈 설계값. */
export const STANDARD_PROGRESSION_PATH: readonly ProgressionBand[] = buildPath();

/** 표준 경로 총 런 수(설계 파생). */
export const TOTAL_PROGRESSION_RUNS = STANDARD_PROGRESSION_PATH.reduce((a, b) => a + b.runs, 0);

/** 표준 경로 총 순수 런 시간(초, 설계 파생). {@link TARGET_TOTAL_SECONDS} ±5% 를 만족해야 한다. */
export const TOTAL_PROGRESSION_SECONDS = STANDARD_PROGRESSION_PATH.reduce(
  (a, b) => a + b.seconds,
  0,
);
