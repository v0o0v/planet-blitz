/**
 * 표준 진행 경로 — 설계 테이블의 **산술 게이트** (ADR-0035 · ADR-0036).
 *
 * ADR-0035 가 못박은 대로, 여기서 검증되는 것은 "봇이 실제로 10시간에 만렙을 찍는다"가 아니라
 * **설계 테이블이 10시간을 낸다는 산술**이다. 그래서 기대값은 전부 테이블에서 파생한다 —
 * 하드코딩한 숫자를 적으면 커브 상수를 바꿔도 테스트가 조용히 통과해 게이트가 사라진다.
 */

import { describe, it, expect } from 'vitest';
import {
  LEVEL_PER_STAGE,
  MAX_STANDARD_STAGE,
  META_XP_BASE,
  META_XP_SLOPE,
  RUN_META_XP_STAGE1,
  RUN_SECONDS_PAR,
  RUN_XP_GROWTH_GAIN_PERMILLE,
  STANDARD_PROGRESSION_PATH,
  TARGET_TOTAL_SECONDS,
  TOTAL_PROGRESSION_RUNS,
  TOTAL_PROGRESSION_SECONDS,
  DECAY_FLOOR_PCT,
  DECAY_FREE_GAP,
  DECAY_STEP_PCT,
  lowStageXpDecayPercent,
  metaXpPerRun,
  runXpGrowthPermille,
  standardStage,
  xpToNextMeta,
} from '../src/save/progressionPath.js';
import { xpToNext } from '../src/sim/world.js';
import { stageLevelCap } from '../src/items/requiredLevel.js';
import { LEVEL_CAP } from '../data/waves.js';

describe('대응 축 — 기체 레벨 ↔ 침략 단계 (ADR-0035)', () => {
  it('표준 단계는 ceil(Lv / LEVEL_PER_STAGE) 이고 만렙이 마지막 단계에 닿는다', () => {
    for (let lv = 1; lv <= LEVEL_CAP; lv++) {
      expect(standardStage(lv), `Lv${lv}`).toBe(Math.ceil(lv / LEVEL_PER_STAGE));
    }
    expect(standardStage(LEVEL_CAP)).toBe(MAX_STANDARD_STAGE);
    expect(MAX_STANDARD_STAGE * LEVEL_PER_STAGE).toBe(LEVEL_CAP);
  });

  it('레벨 범위 밖은 [1, MAX_STANDARD_STAGE] 로 클램프한다', () => {
    expect(standardStage(0)).toBe(1);
    expect(standardStage(-40)).toBe(1);
    expect(standardStage(LEVEL_CAP + 500)).toBe(MAX_STANDARD_STAGE);
    expect(standardStage(Number.NaN)).toBe(1);
  });

  it('드랍처 상한(ADR-0030)이 같은 상수를 쓴다 — 상수 이중화 금지', () => {
    // requiredLevel.ts 가 progressionPath 의 LEVEL_PER_STAGE 를 재사용하므로, 두 축은
    // 한쪽만 바뀔 수 없다. 상한 기준은 **밴드 시작** 레벨이다(ADR-0030 개정 2, 2026-07-27).
    for (let stage = 1; stage <= MAX_STANDARD_STAGE; stage++) {
      expect(stageLevelCap({ planet: 0, stage }), `stage ${stage}`).toBe(
        Math.min(LEVEL_PER_STAGE * (stage - 1) + 1, LEVEL_CAP),
      );
      const standardLevel = LEVEL_PER_STAGE * stage;
      expect(standardStage(standardLevel)).toBe(stage);
      // 불변식: 표준 단계의 조종사는 그 단계 전리품을 **밴드 내내** 입을 수 있다.
      expect(stageLevelCap({ planet: 0, stage })).toBeLessThanOrEqual(standardLevel);
    }
  });
});

describe('메타 커브 — 런 풀과 별개 축이다 (ADR-0036)', () => {
  it('1차식이고 레벨에 대해 단조 증가한다', () => {
    for (let lv = 1; lv < LEVEL_CAP; lv++) {
      expect(xpToNextMeta(lv)).toBe(META_XP_BASE + META_XP_SLOPE * lv);
      if (lv + 1 < LEVEL_CAP) expect(xpToNextMeta(lv + 1)).toBeGreaterThan(xpToNextMeta(lv));
    }
  });

  it('만렙에서 0 — 다음 레벨이 없다는 사실을 커브가 직접 말한다', () => {
    expect(xpToNextMeta(LEVEL_CAP)).toBe(0);
    expect(xpToNextMeta(LEVEL_CAP + 10)).toBe(0);
  });

  it('런 풀 커브(xpToNext)와 완전히 다른 함수다 — 다시 섞이면 실패한다', () => {
    // 두 커브가 같은 값을 내기 시작하면 ADR-0036 이 갈라놓은 축이 되돌아온 것이다.
    for (const lv of [1, 5, 20, 50, 99]) {
      expect(xpToNextMeta(lv), `Lv${lv}`).not.toBe(xpToNext(lv));
    }
  });
});

describe('설계 테이블 — 10시간 산술 게이트 (ADR-0035 §1.2)', () => {
  it('밴드가 레벨 5개씩 만렙까지 빈틈없이 덮는다', () => {
    expect(STANDARD_PROGRESSION_PATH).toHaveLength(MAX_STANDARD_STAGE);
    let expectedFrom = 1;
    for (const band of STANDARD_PROGRESSION_PATH) {
      expect(band.levelFrom).toBe(expectedFrom);
      expect(band.levelTo - band.levelFrom + 1).toBe(LEVEL_PER_STAGE);
      expect(band.stage).toBe(standardStage(band.levelTo));
      expectedFrom = band.levelTo + 1;
    }
    expect(expectedFrom - 1).toBe(LEVEL_CAP);
  });

  it('밴드 필요 XP·런 수는 커브와 단계 비례 기대 XP 에서 파생한다', () => {
    for (const band of STANDARD_PROGRESSION_PATH) {
      let need = 0;
      for (let lv = band.levelFrom; lv <= band.levelTo; lv++) need += xpToNextMeta(lv);
      expect(band.metaXpNeeded, `stage ${band.stage}`).toBe(need);
      expect(band.metaXpPerRun).toBe(metaXpPerRun(band.stage));
      expect(band.runs).toBeCloseTo(need / band.metaXpPerRun, 9);
      expect(band.seconds).toBeCloseTo(band.runs * RUN_SECONDS_PAR, 6);
    }
  });

  it('Lv1 → 만렙 총 순수 런 시간이 목표 36,000초 ±5% 안이다', () => {
    const sum = STANDARD_PROGRESSION_PATH.reduce((a, b) => a + b.seconds, 0);
    expect(TOTAL_PROGRESSION_SECONDS).toBeCloseTo(sum, 6);
    expect(TOTAL_PROGRESSION_SECONDS).toBeGreaterThanOrEqual(TARGET_TOTAL_SECONDS * 0.95);
    expect(TOTAL_PROGRESSION_SECONDS).toBeLessThanOrEqual(TARGET_TOTAL_SECONDS * 1.05);
    // 런 수도 같은 산술에서 나온다(총 시간 = 총 런 × par).
    expect(TOTAL_PROGRESSION_SECONDS).toBeCloseTo(TOTAL_PROGRESSION_RUNS * RUN_SECONDS_PAR, 6);
  });

  it('절벽이 없다 — 인접 밴드 간 필요 런 수 비율이 1.5배를 넘지 않는다', () => {
    // GDD 의 "Lv70+ 경험치 급증"을 폐기하고 완만한 우상향으로 바꾼 것이 ADR-0035 다.
    // 비율은 양방향으로 본다(급증도 급락도 절벽이다).
    for (let i = 1; i < STANDARD_PROGRESSION_PATH.length; i++) {
      const prev = STANDARD_PROGRESSION_PATH[i - 1]!;
      const cur = STANDARD_PROGRESSION_PATH[i]!;
      const ratio = Math.max(cur.runs / prev.runs, prev.runs / cur.runs);
      expect(ratio, `stage ${prev.stage} → ${cur.stage}`).toBeLessThanOrEqual(1.5);
    }
  });

  it('밴드마다 실제로 여러 런이 필요하다(한 런에 한 밴드를 통과하지 않는다)', () => {
    for (const band of STANDARD_PROGRESSION_PATH) {
      expect(band.runs, `stage ${band.stage}`).toBeGreaterThan(1);
    }
  });
});

/**
 * ## 삭제된 가드 — 경제 축 "정규 경로 실런" (2026-08-06, ADR-0051)
 *
 * 여기에 표준 빌드 12시드 × 단계 {1, 11} 을 **완주까지** 돌려 메타 XP 평균과 런당 레벨업이
 * 설계값 대비 밴드 안인지 보는 가드가 있었다. 두 이유로 게이트에서 내린다.
 *
 * ① **공허 가드가 승리 건수였다** — `expect(승리 건수).toBeGreaterThan(0)`. 단언의 성립
 *    자체가 "봇이 이길 수 있는가"에 얹혀 있었다(ADR-0051 §1).
 * ② **재는 것이 곧 폐기될 중간 밸런스였다.** 하한은 이미 두 번 완화됐다 — 벽 프리팹 레인에서
 *    XP 하한 0.7 → 0.55(단계 11), 레벨업 하한 5 → 4.5. 그러고도 2026-08-05 피격 피해 2배
 *    이후 단계 1 레벨업 실측이 4.83 으로 내려가 main 상시 실패였다. 밸런스를 만질 때마다
 *    깨지고 갱신이 일이 되는, ADR-0051 이 지목한 그 병리다.
 *
 * **최소 틱으로 다시 쓰지 못했다.** 이 가드가 재는 `RUN_META_XP_STAGE1` · `RUN_SECONDS_PAR`
 * 는 런 전체의 창발 결과이고, 수백 틱의 부분 런에서 파생시킬 방법이 없다.
 *
 * ## 그래서 지금 못 잡는 것
 * 위의 산술 게이트는 **상수만 가지고 하는 순수 산술**이라, `RUN_META_XP_STAGE1` 이 현실과
 * 4배 어긋나 있어도 전량 통과한다(실제로 433 → 1,676 으로 어긋나는 동안 한 번도 안 빨개졌다).
 * 그 감시자가 없어졌다 — 재측정은 출시 직전 밸런스 패스의 1회성 봇 계측(ADR-0051 §3)과
 * `src/bench` 의 `runCurveSweep` 로 한다.
 */

describe('런 풀 XP 단계 성장 보정 (ADR-0036 — E(s) = E1 × s 선형 가정 폐기)', () => {
  it('단계1 은 정확히 ×1.0 이다 — 단계1 기준선 불변', () => {
    expect(runXpGrowthPermille(1)).toBe(1000);
    expect(runXpGrowthPermille(0)).toBe(1000);
    expect(runXpGrowthPermille(Number.NaN)).toBe(1000);
    expect(metaXpPerRun(1)).toBe(RUN_META_XP_STAGE1);
  });

  it('단조 증가하고 상한에 점근한다(무한 상승 금지)', () => {
    for (let s = 1; s < 200; s++) {
      expect(runXpGrowthPermille(s + 1), `stage ${s}`).toBeGreaterThanOrEqual(
        runXpGrowthPermille(s),
      );
    }
    // 점근값을 절대 넘지 않는다.
    for (const s of [20, 100, 1000, 100000]) {
      expect(runXpGrowthPermille(s)).toBeLessThanOrEqual(1000 + RUN_XP_GROWTH_GAIN_PERMILLE);
    }
  });

  it('보정이 실제로 켜져 있다 — 고단계가 선형 예상보다 크다', () => {
    // 이 단언이 깨지면 보정이 사문화된 것이다(= 다시 E(s) = E1 × s 로 되돌아갔다).
    expect(metaXpPerRun(20)).toBeGreaterThan(RUN_META_XP_STAGE1 * 20);
    expect(metaXpPerRun(11)).toBeGreaterThan(RUN_META_XP_STAGE1 * 11);
  });
});

describe('저단계 감쇠 — 정산 계층 전용 (ADR-0036 §2.4)', () => {
  it(`표준보다 ${DECAY_FREE_GAP}단계 아래까지는 무감쇠다`, () => {
    const shipLevel = LEVEL_CAP; // 표준 단계 20
    for (let gap = 0; gap <= DECAY_FREE_GAP; gap++) {
      expect(lowStageXpDecayPercent(shipLevel, MAX_STANDARD_STAGE - gap), `gap ${gap}`).toBe(100);
    }
  });

  it('부족 1단계당 정확히 10%p 씩 깎고 하한 30% 에서 멈춘다', () => {
    const shipLevel = LEVEL_CAP;
    for (let gap = DECAY_FREE_GAP; gap <= MAX_STANDARD_STAGE - 1; gap++) {
      const expected = Math.max(
        DECAY_FLOOR_PCT,
        100 - DECAY_STEP_PCT * (gap - DECAY_FREE_GAP),
      );
      expect(lowStageXpDecayPercent(shipLevel, MAX_STANDARD_STAGE - gap), `gap ${gap}`).toBe(
        expected,
      );
    }
    expect(lowStageXpDecayPercent(LEVEL_CAP, 1)).toBe(DECAY_FLOOR_PCT);
  });

  it('표준보다 위 단계를 돌아도 보너스는 없다(상한 100%)', () => {
    expect(lowStageXpDecayPercent(1, 20)).toBe(100);
  });

  it('단계 미지정(침공·구 세이브)은 무감쇠로 폴백한다', () => {
    expect(lowStageXpDecayPercent(LEVEL_CAP, undefined)).toBe(100);
    expect(lowStageXpDecayPercent(LEVEL_CAP, Number.NaN)).toBe(100);
  });

  it('하한 30% ⇒ 최악 진행 시간이 약 33시간이다(ADR-0035 §Consequences 정합)', () => {
    const worstSeconds = (TOTAL_PROGRESSION_SECONDS * 100) / DECAY_FLOOR_PCT;
    const worstHours = worstSeconds / 3600;
    expect(worstHours).toBeGreaterThan(32);
    expect(worstHours).toBeLessThan(34);
  });
});
