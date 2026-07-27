/**
 * 표준 진행 경로 — 설계 테이블의 **산술 게이트** (ADR-0035 · ADR-0036).
 *
 * ADR-0035 가 못박은 대로, 여기서 검증되는 것은 "봇이 실제로 10시간에 만렙을 찍는다"가 아니라
 * **설계 테이블이 10시간을 낸다는 산술**이다. 그래서 기대값은 전부 테이블에서 파생한다 —
 * 하드코딩한 숫자를 적으면 커브 상수를 바꿔도 테스트가 조용히 통과해 게이트가 사라진다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { standardEquipped, standardSkillInvest } from '../src/bench/standardBuild.js';
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
 * 경제 축 **정규 경로 실런 가드** — 설계 상수가 코드 현실에서 떨어져 나가면 큰 소리로 실패한다.
 *
 * ## 왜 필요한가 (이 가드가 존재하는 이유)
 * 위의 산술 게이트는 **상수만 가지고 하는 순수 산술**이다. 그래서 `RUN_META_XP_STAGE1` 이나
 * `RUN_SECONDS_PAR` 가 현실과 4배 어긋나 있어도 **전량 통과한다.** 실제로 그랬다: 두 상수는
 * `killGoal` 합계 80 · 무장비 시절 값(433 / 150)이었는데, 적 곡선 레인이 합계를 240 으로
 * 올리고 표준 장비 세트가 도입되면서 실제 값이 1,676 / 95 가 됐다. **그 사이 이 파일의
 * 테스트는 한 번도 빨개지지 않았다.** 이 리포의 반복 결함("단위 테스트 그린인데 배선이 통째로
 * 어긋나 있다")과 정확히 같은 형태이고, `tests/drops.test.ts` 가 드랍 축에 넣은 것과 같은 처방이다.
 *
 * ## 무엇을 세는가
 * `runCurveSweep`(`src/bench/rosterBench.ts`)과 **동일한 정규 경로**로 표준 빌드 런을 끝까지
 * 돌려 ①정산이 받는 `state.xpTotal` ②런 풀 종료 레벨을 실측한다. `gearSeed` 는 **고정하지
 * 않는다**(런 시드를 장비 시드로) — 고정하면 장비 세트 하나의 운을 재게 되고 실측 폭이
 * 48~100% 로 벌어진다.
 *
 * ## 대역이 넓은 이유
 * 시드 12개는 이항 SE 가 크고(승패가 XP 를 약 1.4배 가른다) 상수는 96시드 평균이라, ±30% 는
 * "상수가 낡았다"만 잡고 통상 표본 변동은 통과시키는 폭이다. 좁히려면 시드를 늘려야 하는데
 * 그만큼 느려진다(현 구성 12시드 × 2단계 ≈ 5초).
 */
describe('경제 축 정규 경로 실런 가드 (ADR-0035 · ADR-0036)', () => {
  /** 곡선 스윕과 동일한 조립 — 표준 레벨·표준 장비·표준 투자로 대응 단계를 끝까지 돈다. */
  function standardRun(stage: number, seed: number, planet = 0) {
    const p = defaultProfile();
    const s = activeShip(p);
    s.level = stage * LEVEL_PER_STAGE;
    s.skillInvest = standardSkillInvest(s.typeId, s.level);
    // gearSeed = 런 시드(runCurveSweep 규약). 고정하지 않는다.
    s.equipped = standardEquipped(s.level, seed, planet);
    const state = createWorld(seed, buildRunConfig(p, { planet, stage }));
    for (let i = 0; i < 60 * 300; i++) {
      stepWorld(state, autopilotInput(state));
      if (state.gameOver || state.victory) break;
    }
    return { xpTotal: state.xpTotal, level: state.level, victory: state.victory };
  }

  const SEEDS = [1, 5, 11, 17, 23, 31, 41, 43, 53, 61, 71, 79];
  const mean = (a: readonly number[]) => a.reduce((x, y) => x + y, 0) / a.length;

  for (const stage of [1, 11]) {
    // 두 단언을 한 `it` 에 묶는다 — 같은 96런을 두 번 돌리면 가드 비용이 두 배가 된다.
    it(`단계 ${stage}: 메타 XP 적립과 런 풀 레벨업이 설계값 근처다`, () => {
      const rows = SEEDS.map((sd) => standardRun(stage, sd));
      // 표준 빌드가 대응 단계를 아예 못 돌면 이 가드는 아무것도 증명하지 못한다(공허 런 방어).
      expect(rows.filter((r) => r.victory).length, '표준 빌드 승리 0건 — 적 곡선을 먼저 봐라').toBeGreaterThan(0);

      const actual = mean(rows.map((r) => r.xpTotal));
      const design = metaXpPerRun(stage);
      const ratio = actual / design;
      expect(
        ratio,
        `단계 ${stage} 메타 XP 실측 ${actual.toFixed(0)} vs 설계 ${design} (비 ${ratio.toFixed(2)}). ` +
          'data/waves.ts 의 SEGMENTS.killGoal 합계나 src/sim/world.ts 의 xpToNext 를 바꿨다면 ' +
          'RUN_META_XP_STAGE1 · RUN_XP_GROWTH_* 를 96시드로 재측정해서 갱신해라 ' +
          '(절차: .omc/research/economy-recalibrated-2026-07-27.md §재현).',
      ).toBeGreaterThan(0.7);
      expect(ratio).toBeLessThan(1.3);

      // 런 내 리듬(ADR-0036 §2.3) — 파워업 3택 횟수 그 자체다.
      const levelUps = mean(rows.map((r) => r.level - 1));
      expect(
        levelUps,
        `단계 ${stage} 런당 레벨업 ${levelUps.toFixed(2)}회. ` +
          'SEGMENTS.killGoal 합계를 바꿨다면 src/sim/world.ts 의 xpToNext 계수를 다시 재라 — ' +
          '런이 길어지면 처치·젬이 늘어 같은 커브에서 레벨업이 함께 오른다.',
      ).toBeGreaterThanOrEqual(5);
      expect(levelUps).toBeLessThanOrEqual(8);
    });
  }
});

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
