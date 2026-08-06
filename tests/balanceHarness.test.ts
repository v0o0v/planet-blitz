/**
 * 예산제 밸런스 하네스의 **계약 테스트**.
 *
 * 이 스위트가 지키는 약속은 둘이다:
 *
 * 1. **새 콘텐츠는 코드 수정 없이 측정된다** — 축이 카탈로그(`PLANETS`·`SHIP_TYPES`·
 *    `BAND_LEVELS`)에서 파생되는지 대조한다. 누군가 축을 하드코딩 목록으로 되돌리면 여기서
 *    깨진다. 이 리포가 반복해서 겪은 결함(“카탈로그는 늘었는데 목록이 안 늘어 조용히 빠짐”)의
 *    방어선이다.
 * 2. **예산은 지켜진다** — 라운드 판정과 격자 축소가 예산 안에서 끝나는 형태인지 검사한다.
 * 3. **파워업 정책이 런에 실제로 흘러간다** — `cell.powerup` → `pickOverride` → `stepWorld`
 *    배선의 교환 대조(ADR-0051 갈래 ③, 이 파일에서 가장 값진 축).
 *
 * ## 실런은 **최소 틱**으로만 돈다 (2026-08-06, ADR-0051)
 * 종전에는 배선을 증명하려고 런을 **완주**시켰고, 그 결과 45건 중 두 건이 벽시계 91.6초 중
 * 86.1초를 썼다(나머지 43건은 합쳐 3초). 배선은 완주를 요구하지 않는다 — 값이 적용점
 * (레벨업 프리즈)에 도달했는지만 보면 되므로 1,200틱이면 족하다. 근거 실측은 `WIRE_TICKS`
 * 주석에 있다.
 *
 * 같은 결정으로 **"승리 런은 보스를 관측한다" 3건은 삭제됐다**(갈래 ② — 단언의 전제가
 * "봇이 이길 수 있는가"였다). 사유는 `런 실행` describe 머리말.
 */

import { describe, it, expect } from 'vitest';
import { PLANETS } from '../data/planets/index.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { BAND_LEVELS } from '../src/bench/standardBuild.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { POWERUPS } from '../src/sim/powerups.js';
import {
  FIXED_SEEDS,
  POWERUP_LINES,
  POWERUP_POLICIES,
  POWERUP_POLICY_BASELINE,
  POWERUP_POLICY_MINIMAL,
  bossEngageable,
  choosePowerupOffer,
  MAX_TICKS,
  METRIC_KEYS,
  MIN_AXIS_POINTS,
  RUN_METRICS,
  cellKey,
  decideNextRound,
  enumerateCells,
  evaluateGates,
  foldBy,
  fullCellCount,
  gatedMetricKeys,
  levelAxis,
  planetAxis,
  resolveAxes,
  runCellSeed,
  seedAt,
  seedsUpTo,
  shipAxis,
  shrinkAxes,
  spreadOf,
  statsOf,
  type RunRecord,
} from '../src/bench/balance/index.js';

// ---------------------------------------------------------------------------
// 1. 축이 카탈로그에서 파생되는가 — "새 콘텐츠 자동 반영"의 실체
// ---------------------------------------------------------------------------

describe('축 자동 열거', () => {
  it('행성 축은 PLANETS 레지스트리 전량이다', () => {
    const axis = planetAxis();
    expect(axis).toHaveLength(PLANETS.length);
    // 값은 레지스트리의 index 그대로여야 한다 — 배열 순서가 아니라 index 가 WorldConfig.planet 이다.
    expect(axis.map((a) => a.value)).toEqual(PLANETS.map((p) => p.index));
  });

  it('기체 축은 SHIP_TYPES 전량이다', () => {
    const axis = shipAxis();
    expect(axis).toHaveLength(SHIP_TYPES.length);
    expect(axis.map((a) => a.value)).toEqual(SHIP_TYPES.map((_, i) => i));
  });

  it('레벨 축은 BAND_LEVELS 전량이다(= LEVEL_CAP 에서 파생)', () => {
    const axis = levelAxis();
    expect(axis).toHaveLength(BAND_LEVELS.length);
    expect(axis.map((a) => a.value)).toEqual([...BAND_LEVELS]);
  });

  it('격자 크기 = 세 축의 곱이고, 행성/기체/레벨이 하나라도 늘면 함께 는다', () => {
    expect(fullCellCount()).toBe(PLANETS.length * SHIP_TYPES.length * BAND_LEVELS.length);
    expect(enumerateCells()).toHaveLength(fullCellCount());
  });

  it('열거 순서는 결정론이다(planet → ship → level)', () => {
    const a = enumerateCells().map(cellKey);
    const b = enumerateCells().map(cellKey);
    expect(a).toEqual(b);
    const first = enumerateCells({ planets: [0], ships: [0], levels: [5, 10] });
    expect(first.map(cellKey)).toEqual(['p0/s0/lv5', 'p0/s0/lv10']);
  });

  it('축 부분 선택은 카탈로그에 있는 값만 남긴다', () => {
    const ax = resolveAxes({ planets: [0, 999] });
    expect(ax.planets.map((p) => p.value)).toEqual([0]);
    // 미지정 축은 전량이다.
    expect(ax.ships).toHaveLength(SHIP_TYPES.length);
  });
});

// ---------------------------------------------------------------------------
// 2. 시드 — 재현성 계약
// ---------------------------------------------------------------------------

describe('시드', () => {
  it('앞 24개는 M8 원본 그대로다(절대 불변)', () => {
    expect(FIXED_SEEDS.slice(0, 24)).toEqual([
      1, 5, 11, 17, 23, 31, 41, 43, 53, 61, 71, 79, 83, 97, 101, 113, 127, 131, 149, 151, 163, 173,
      181, 191,
    ]);
  });

  it('고정 목록 구간은 그대로 나온다', () => {
    for (let i = 0; i < FIXED_SEEDS.length; i++) expect(seedAt(i)).toBe(FIXED_SEEDS[i]);
  });

  it('고정 목록을 넘어가도 시드가 겹치지 않는다', () => {
    const many = seedsUpTo(FIXED_SEEDS.length * 3);
    expect(new Set(many).size).toBe(many.length);
  });

  it('같은 인덱스는 항상 같은 시드다', () => {
    expect(seedAt(200)).toBe(seedAt(200));
  });
});

// ---------------------------------------------------------------------------
// 3. 예산 계획
// ---------------------------------------------------------------------------

describe('라운드 판정', () => {
  const base = { budgetMs: 600_000, lastRoundMs: 10_000, maxRounds: 96 };

  it('첫 라운드는 예산과 무관하게 돈다(산출물이 비면 리포트가 아무 말도 못 한다)', () => {
    expect(decideNextRound({ ...base, elapsedMs: 599_000, completedRounds: 0 }).proceed).toBe(true);
  });

  it('남은 시간이 다음 라운드 추정보다 적으면 멈춘다', () => {
    // 잔여 11s < 10s × 1.25 = 12.5s
    expect(decideNextRound({ ...base, elapsedMs: 589_000, completedRounds: 5 }).proceed).toBe(false);
  });

  it('여유가 있으면 계속 돈다', () => {
    expect(decideNextRound({ ...base, elapsedMs: 100_000, completedRounds: 5 }).proceed).toBe(true);
  });

  it('라운드 상한에서 멈춘다', () => {
    expect(
      decideNextRound({ ...base, elapsedMs: 0, completedRounds: 96, maxRounds: 96 }).proceed,
    ).toBe(false);
  });

  it('판정 사유는 ASCII 다(사용자 콘솔 mojibake 방지)', () => {
    const reasons = [
      decideNextRound({ ...base, elapsedMs: 0, completedRounds: 0 }).reason,
      decideNextRound({ ...base, elapsedMs: 589_000, completedRounds: 5 }).reason,
      decideNextRound({ ...base, elapsedMs: 0, completedRounds: 96 }).reason,
      decideNextRound({ ...base, elapsedMs: 100_000, completedRounds: 5 }).reason,
    ];
    for (const r of reasons) expect(r).toMatch(/^[\x20-\x7e]*$/);
  });
});

describe('격자 축소', () => {
  it('목표 셀 수 이하로 줄인다', () => {
    const full = resolveAxes();
    const small = shrinkAxes(full, 40);
    const n = small.planets.length * small.ships.length * small.levels.length;
    expect(n).toBeLessThanOrEqual(40);
  });

  it('각 축의 양 끝을 보존한다(곡선·편차가 읽히려면 끝이 있어야 한다)', () => {
    const full = resolveAxes();
    const small = shrinkAxes(full, 24);
    for (const key of ['planets', 'ships', 'levels'] as const) {
      const a = full[key];
      const b = small[key];
      expect(b[0]?.value).toBe(a[0]?.value);
      expect(b[b.length - 1]?.value).toBe(a[a.length - 1]?.value);
    }
  });

  it('축을 1점으로 무너뜨리지 않는다', () => {
    const small = shrinkAxes(resolveAxes(), 1);
    expect(small.planets.length).toBeGreaterThanOrEqual(MIN_AXIS_POINTS);
    expect(small.ships.length).toBeGreaterThanOrEqual(MIN_AXIS_POINTS);
    expect(small.levels.length).toBeGreaterThanOrEqual(MIN_AXIS_POINTS);
  });

  it('목표가 격자보다 크면 원본 그대로다', () => {
    const full = resolveAxes();
    const same = shrinkAxes(full, fullCellCount() + 1);
    expect(same.planets).toHaveLength(full.planets.length);
    expect(same.levels).toHaveLength(full.levels.length);
  });
});

// ---------------------------------------------------------------------------
// 4. 지표 카탈로그 · 게이트
// ---------------------------------------------------------------------------

describe('지표 카탈로그', () => {
  it('목표 밴드는 min ≤ max 이고 근거가 적혀 있다', () => {
    for (const key of gatedMetricKeys()) {
      const t = RUN_METRICS[key]?.target;
      expect(t, key).toBeDefined();
      expect(t!.min, key).toBeLessThanOrEqual(t!.max);
      expect(t!.source.length, key).toBeGreaterThan(0);
    }
  });

  it('게이트 목록은 target 이 붙은 지표와 정확히 같다', () => {
    const withTarget = METRIC_KEYS.filter((k) => RUN_METRICS[k]?.target !== undefined);
    expect(gatedMetricKeys()).toEqual(withTarget);
  });
});

function rec(over: Partial<RunRecord> & { values: Record<string, number> }): RunRecord {
  return { planet: 0, ship: 0, level: 5, seed: 1, won: true, ticks: 100, ...over };
}

describe('게이트 판정', () => {
  it('밴드 안이면 통과, 밖이면 위반 지점을 짚는다', () => {
    const runs: RunRecord[] = [
      rec({ level: 5, won: true, values: { clearRate: 1 } }),
      rec({ level: 5, won: false, values: { clearRate: 0 } }),
      rec({ level: 5, won: true, values: { clearRate: 1 } }),
      // Lv10 은 전패 → 0% 로 밴드 미달
      rec({ level: 10, won: false, values: { clearRate: 0 } }),
      rec({ level: 10, won: false, values: { clearRate: 0 } }),
    ];
    const g = evaluateGates(runs).find((x) => x.metric === 'clearRate');
    expect(g?.pass).toBe(false);
    expect(g?.violations.map((v) => v.at)).toContain('Lv10');
    // Lv5 는 66.7% 라 밴드 안 → 위반 목록에 없다
    expect(g?.violations.map((v) => v.at)).not.toContain('Lv5');
  });

  it('scope 가 축이면 그 축의 점마다 판정하고, 위반 지점을 이름으로 짚는다', () => {
    // `timeoutRate` 는 scope='level' 이다. 전체 평균으로 보면 통과하지만 한 레벨만 나쁜 경우를
    // 잡아야 한다 — 실제로 Lv100 타임아웃 10.6% 가 전체 평균 0.8% 뒤에 숨어 있었다.
    const runs: RunRecord[] = [];
    for (let i = 0; i < 99; i++) runs.push(rec({ level: 5, values: { timeoutRate: 0 } }));
    for (let i = 0; i < 10; i++) runs.push(rec({ level: 100, values: { timeoutRate: 1 } }));
    const g = evaluateGates(runs).find((x) => x.metric === 'timeoutRate');
    expect(g?.scope).toBe('level');
    expect(g?.pass).toBe(false);
    expect(g?.violations.map((v) => v.at)).toEqual(['Lv100']);
    // 같은 표본을 전체 평균으로 보면 10/109 = 9.2% … 가 아니라, 레벨별이라 Lv5 는 0% 로 통과한다.
    expect(g?.violations).toHaveLength(1);
  });

  it('표본이 없는 지점은 위반이 아니라 미판정이다', () => {
    // 전패 런만 주면 winMean 지표(clearSec)의 표본이 0 이 된다.
    const runs = [rec({ won: false, values: { clearSec: 0 } })];
    const g = evaluateGates(runs).find((x) => x.metric === 'clearSec');
    expect(g?.violations).toHaveLength(0);
    expect(g?.unjudged).toBe(1);
  });
});

describe('집계', () => {
  it('winMean 지표는 승리 런만 본다', () => {
    const runs = [
      rec({ won: true, values: { clearSec: 100 } }),
      rec({ won: false, values: { clearSec: 5 } }),
    ];
    expect(statsOf(runs).metrics['clearSec']?.mean).toBe(100);
    expect(statsOf(runs).metrics['clearSec']?.n).toBe(1);
  });

  it('winPosMean 지표는 0(측정 불가)을 표본에서 뺀다', () => {
    // bossDps 의 0 은 "피해 0"이 아니라 "관측 창 없음"이다 — 평균에 섞으면 무대 DPS 가 내려앉는다.
    const runs = [
      rec({ won: true, values: { bossDps: 1000 } }),
      rec({ won: true, values: { bossDps: 0 } }),
      rec({ won: false, values: { bossDps: 0 } }),
    ];
    const d = statsOf(runs).metrics['bossDps'];
    expect(d?.n).toBe(1);
    expect(d?.mean).toBe(1000);
  });

  it('축 접기는 원본 런에서 재집계한다(표본 수가 다른 셀이 과대 대표되지 않는다)', () => {
    // 같은 레벨에 셀 A(9런 전승) 와 셀 B(1런 전패) → 접은 클리어율은 90% 여야 한다.
    const runs: RunRecord[] = [];
    for (let i = 0; i < 9; i++) runs.push(rec({ ship: 0, won: true, values: { clearRate: 1 } }));
    runs.push(rec({ ship: 1, won: false, values: { clearRate: 0 } }));
    const point = foldBy(runs, 'level')[0];
    expect(point?.metrics['clearRate']?.mean).toBeCloseTo(0.9, 10);
  });

  it('편차 요약이 최저·최고 축 값을 짚는다', () => {
    const runs: RunRecord[] = [
      rec({ planet: 0, values: { clearRate: 0 } }),
      rec({ planet: 1, values: { clearRate: 1 } }),
    ];
    const s = spreadOf(runs, 'planet');
    expect(s.lowest.value).toBe(0);
    expect(s.highest.value).toBe(1);
    expect(s.spread).toBeCloseTo(1, 10);
  });
});

// ---------------------------------------------------------------------------
// 5. 런 실행 — 결정론
// ---------------------------------------------------------------------------

describe('보스 교전 판정', () => {
  // `bossEngageable` 이 보는 것은 `state.config.planetMode` 와 엔티티의 kind/dead/aux0 뿐이라
  // 최소 객체로 충분하다(sim 전체를 세우지 않는다).
  const world = (mode: number | undefined): WorldState =>
    ({ config: { planetMode: mode } }) as unknown as WorldState;
  const boss = (over: Partial<Entity> = {}): Entity =>
    ({ kind: 'boss', dead: false, aux0: 0, hp: 100, ...over }) as unknown as Entity;

  it('일반 모드는 보스 엔티티가 있으면 교전 가능이다', () => {
    expect(bossEngageable(world(PLANET_MODE.vampire), boss())).toBe(true);
  });

  it('추격 모드의 무적 포식자(aux0=0)는 교전 불가다', () => {
    // 런 시작부터 존재하므로 이걸 세면 보스교전률이 항상 100% 가 된다.
    expect(bossEngageable(world(PLANET_MODE.chase), boss({ aux0: 0 }))).toBe(false);
  });

  it('추격 모드의 취약화된 포식자(aux0=1)는 교전 가능이다', () => {
    expect(bossEngageable(world(PLANET_MODE.chase), boss({ aux0: 1 }))).toBe(true);
  });

  it('죽은 보스와 보스 아닌 엔티티는 교전 대상이 아니다', () => {
    expect(bossEngageable(world(PLANET_MODE.vampire), boss({ dead: true }))).toBe(false);
    expect(bossEngageable(world(PLANET_MODE.vampire), boss({ kind: 'enemy' }))).toBe(false);
  });
});

describe('런 실행', () => {
  /**
   * 실런 단언의 틱 상한. **완주를 요구하지 않는다**(ADR-0051 갈래 ③).
   *
   * ⚠️ 여기 있던 "승리 런은 보스를 관측한다" 3건은 **삭제했다**(2026-08-06, ADR-0051 갈래 ②).
   * 셋 다 `firstWin()` 이 16시드 안에서 승리 런을 찾아내는 데 의존했다 — 즉 단언의 전제가
   * **"봇이 이길 수 있는가"** 였고, ADR-0051 §1 판정 규칙이 정확히 그것을 게이트에서 내린다.
   * (셋 합쳐 1.6초라 비용 때문은 아니다. 밸런스를 만질 때마다 불변식과 무관한 이유로 빨개지는
   * 것이 이유다.) 지키던 불변식 — "PvE 승리 = 보스 처치이므로 `bossReachRate` 는 1" — 은
   * 완주 없이 잴 방법이 없다. 재도입하려면 계측 CLI 쪽에 얹어야 한다.
   */
  const RUN_TICKS = 900;

  it('같은 (셀, 시드) 는 항상 같은 결과다', () => {
    // 가장 짧은 무대를 고른다(아르케 = racing, 런 길이 약 20초분).
    const cell = { planet: 3, ship: 0, level: 5 };
    const a = runCellSeed(cell, 1, RUN_TICKS);
    const b = runCellSeed(cell, 1, RUN_TICKS);
    expect(a.ticks).toBe(b.ticks);
    expect(a.won).toBe(b.won);
    expect(a.values).toEqual(b.values);
  });

  /**
   * **틱 상한 인자를 안 주면 `MAX_TICKS` 여야 한다.**
   *
   * 이 스위트의 실런은 전부 상한을 명시하지만 **계측 CLI 는 안 준다**
   * (`scripts/balance/worker.mjs` 의 `runCellSeed(msg.cell, msg.seed)`). 즉 기본값이 조용히
   * 바뀌거나 `undefined` 로 새면 — 루프가 `i < undefined` 로 **0틱** 이 된다 — 스위트는 전부
   * 초록인 채로 `pnpm balance` 가 빈 런을 재게 된다. 정확히 이 리포가 반복해서 겪은
   * "단위 테스트는 초록인데 배선이 없다"의 형태라 여기에 못을 박는다.
   *
   * 비용을 위해 **스스로 일찍 끝나는 셀**을 쓴다(실측: 시드 1 에서 1,144틱에 사망). 상한이
   * 살아 있으면 이 런은 `RUN_TICKS` 를 넘고, 죽어 있으면 0틱이라 즉시 갈린다.
   */
  it('틱 상한 미지정이면 MAX_TICKS 다(계측 CLI 가 쓰는 경로)', () => {
    const r = runCellSeed({ planet: 0, ship: 1, level: 25 }, 1);
    expect(
      r.ticks,
      '기본 상한이 MAX_TICKS 에 안 묶였다 — scripts/balance 가 조용히 짧은 런을 잰다',
    ).toBeGreaterThan(RUN_TICKS);
    expect(r.ticks).toBeLessThanOrEqual(MAX_TICKS);
  });

  it('전 지표가 유한한 수로 채워진다', () => {
    const r = runCellSeed({ planet: 3, ship: 0, level: 5 }, 1, RUN_TICKS);
    for (const key of METRIC_KEYS) {
      expect(Number.isFinite(r.values[key]), key).toBe(true);
    }
    // **공허 방어** — 상한을 줄인 탓에 관측기가 통째로 안 밟히면 전 지표가 0 이어도 위 단언은
    // 통과한다("정확히 0"은 구조적 무발사 신호다). 실런이 실제로 굴렀다는 물증을 하나 건다.
    expect(r.ticks, '런이 한 틱도 안 돌았다').toBe(RUN_TICKS);
    expect(r.values['metaXp'], '메타XP 가 0 — 격추가 한 건도 없다면 관측기가 아무것도 안 본다').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 8. 파워업 정책 축 (2026-08-03 신설)
// ---------------------------------------------------------------------------

describe('파워업 정책 축', () => {
  /** 여러 무대 · 여러 레벨에서 교차 검증한다 — 한 셀만 보면 우연히 같을 수 있다. */
  const PROBE_CELLS = [
    { planet: 3, ship: 0, level: 5 },
    { planet: 5, ship: 3, level: 60 },
  ] as const;

  /**
   * **배선 증명은 완주를 요구하지 않는다** (ADR-0051 갈래 ③).
   *
   * 이 축이 증명해야 하는 것은 "`cell.powerup` 이 `runCellSeed` → `pickOverride` →
   * `stepWorld` 로 흘러가는가" 이지 "봇이 그 정책으로 이기는가"가 아니다. 적용점은 **레벨업
   * 프리즈**이므로 프리즈가 몇 번 지나가는 만큼만 돌리면 된다.
   *
   * ## 왜 1,200인가 — 실측 (2026-08-06)
   * 프리즈 발생 틱을 직접 재 보면 `p3/s0/lv5` 는 226·320·830·1410, `p5/s3/lv60` 은
   * 265·543·1021·1682 이다. 즉 1,200틱이면 **두 셀 모두 프리즈 3회**를 지난다. 그보다 짧으면
   * (300~600틱 스캔) 프리즈가 1~2회뿐이라 정책이 우연히 기준선과 **같은 오퍼**를 골라
   * 갈림이 관측되지 않는 구간이 넓었다 — 그 상태로 굳혔으면 "틱이 모자란 것"을 "배선이
   * 없는 것"으로 오독하게 된다.
   *
   * 대가는 **`won` 이 항상 false 라는 것**이다(1,200틱에 끝나는 런이 없다). 그래서 아래
   * 대조는 승패가 아니라 **전 지표 + 틱**으로 본다. 완주 여부는 이 축이 답할 질문이 아니다.
   *
   * 실측 비용: 종전 97초 중 86초를 쓰던 두 단언이 합쳐 2초 미만이 된다.
   */
  const WIRE_TICKS = 1200;
  const WIRE_SEED = 1;

  /**
   * **적용점 자체가 정책을 가르는가** — 공허 방어의 1층(sim 없이, 즉시).
   *
   * 아래 두 실런 단언이 빨개졌을 때 "배선이 끊겼다"와 "정책이 애초에 같은 오퍼를 고른다"를
   * 갈라 주는 진단선이다. 오퍼 배열을 합성해 직접 물어본다 — `POWERUP_LINES` 는 실제
   * 카탈로그에서 파생되므로 계열이 사라지면 여기서 먼저 깨진다.
   */
  it('정책은 같은 오퍼에서 서로 다른 인덱스를 고른다(공허 방어)', () => {
    const firstOf = (line: string) => POWERUP_LINES.findIndex((l) => l === line);
    const offense = firstOf('offense');
    const survival = firstOf('survival');
    expect(offense, 'offense 계열 파워업이 하나도 없다').toBeGreaterThanOrEqual(0);
    expect(survival, 'survival 계열 파워업이 하나도 없다').toBeGreaterThanOrEqual(0);
    // 오퍼 0번 = 생존, 1번 = 화력. 기준선은 0번을, 화력우선(1)은 1번을 골라야 한다.
    const state = { powerupChoices: [survival, offense] } as unknown as WorldState;
    expect(choosePowerupOffer(state, POWERUP_POLICY_BASELINE)).toBe(0);
    expect(choosePowerupOffer(state, 1)).toBe(1);
  });

  /**
   * **이 축의 존재 조건** — 기본값이 현행 거동과 바이트 동일해야 한다.
   *
   * 정책을 안 준 셀(= 표준 격자)과 정책 0(`기준선`)을 준 셀이 같은 시드에서 **틱 · 승패 · 전
   * 지표까지 완전히 같아야** 한다. 이게 깨지면 이 축을 추가한 것만으로 기존 격자의 모든 수치가
   * 움직인 것이고, 축 이전의 어떤 실측과도 대조가 성립하지 않는다.
   */
  it('정책 미지정 = 정책 0(기준선) = 현행 거동 — 런이 바이트 동일하다', () => {
    for (const cell of PROBE_CELLS) {
      const base = runCellSeed(cell, WIRE_SEED, WIRE_TICKS);
      const explicit = runCellSeed(
        { ...cell, powerup: POWERUP_POLICY_BASELINE },
        WIRE_SEED,
        WIRE_TICKS,
      );
      const label = `${cellKey(cell)} seed=${WIRE_SEED}`;
      expect(explicit.ticks, label).toBe(base.ticks);
      expect(explicit.won, label).toBe(base.won);
      expect(explicit.values, label).toEqual(base.values);
    }
  });

  /**
   * **항진 방어** — 위 단언은 정책 오버라이드가 *아무 일도 안 해도* 통과한다. 그래서 다른
   * 정책은 실제로 다른 런을 만들어야 한다. 하나라도 갈리면 배선이 살아 있는 것이다.
   *
   * 특정 정책이 특정 셀에서 우연히 기준선과 같은 픽을 낼 수는 있으므로(오퍼 0번이 이미 그
   * 계열이면 같다) 셀 · 정책 전체에서 **적어도 하나**가 갈리는지를 본다.
   *
   * ⚠️ 승패로 대조하지 않는다 — 1,200틱에서는 양쪽 다 미완주라 `won` 이 항상 false 다.
   * 갈림은 **전 지표 + 틱**에서 읽는다(실측: `p3/s0/lv5` 정책1, `p5/s3/lv60` 정책1 이 갈린다).
   */
  it('다른 정책은 실제로 다른 런을 만든다 — 배선 항진 방어', () => {
    const split: string[] = [];
    for (const cell of PROBE_CELLS) {
      const base = runCellSeed(cell, WIRE_SEED, WIRE_TICKS);
      for (const p of POWERUP_POLICIES) {
        if (p.id === POWERUP_POLICY_BASELINE) continue;
        const r = runCellSeed({ ...cell, powerup: p.id }, WIRE_SEED, WIRE_TICKS);
        const same =
          r.ticks === base.ticks && JSON.stringify(r.values) === JSON.stringify(base.values);
        if (!same) split.push(`${cellKey(cell)}/pw${p.id}`);
      }
    }
    expect(
      split.length,
      '어떤 정책도 런을 바꾸지 못했다 — 픽 오버라이드가 배선되지 않았거나(위 공허 방어가 초록이면 이쪽) WIRE_TICKS 가 프리즈에 못 미친다',
    ).toBeGreaterThan(0);
  });

  it('같은 (셀, 정책, 시드) 는 항상 같은 결과다', () => {
    const cell = { planet: 3, ship: 0, level: 5, powerup: POWERUP_POLICY_MINIMAL };
    const a = runCellSeed(cell, 1, WIRE_TICKS);
    const b = runCellSeed(cell, 1, WIRE_TICKS);
    expect(a.ticks).toBe(b.ticks);
    expect(a.values).toEqual(b.values);
  });

  /**
   * 계열 분류는 `apply` 의 **실제 변이 관찰**로 정해진다. `'unknown'` 은 "효과 없음"이 아니라
   * **스텁이 못 본 축이 생겼다**는 신호이므로 조용히 넘어가면 안 된다 — 그 파워업은 어떤
   * 정책의 우선순위에도 안 걸려 영원히 안 뽑힌다.
   */
  it('모든 파워업이 계열로 분류된다(미분류는 LOUD-FAIL)', () => {
    expect(POWERUP_LINES.length).toBe(POWERUPS.length);
    const unclassified = POWERUPS.map((d, i) => ({ id: d.id, line: POWERUP_LINES[i] }))
      .filter((x) => x.line === 'unknown')
      .map((x) => x.id);
    expect(unclassified, `분류 실패: ${unclassified.join(', ')} — powerupPolicy.ts 스텁을 확장하라`).toEqual([]);
  });

  it('정책 축은 명시할 때만 열린다(기본 격자는 셀에 powerup 이 없다)', () => {
    const plain = enumerateCells({ planets: [0], ships: [0], levels: [5] });
    expect(plain).toHaveLength(1);
    expect(plain[0]).not.toHaveProperty('powerup');

    const opened = enumerateCells({ planets: [0], ships: [0], levels: [5], powerups: [0, 1, 4] });
    expect(opened).toHaveLength(3);
    expect(opened.map((c) => c.powerup)).toEqual([0, 1, 4]);
  });

  it('셀 키는 선택 축이 있을 때만 접미가 붙는다(기존 기준선 파일과 짝이 유지된다)', () => {
    expect(cellKey({ planet: 1, ship: 2, level: 30 })).toBe('p1/s2/lv30');
    expect(cellKey({ planet: 1, ship: 2, level: 30, powerup: 4 })).toBe('p1/s2/lv30/pw4');
    expect(cellKey({ planet: 1, ship: 2, level: 30, stage: 1 })).toBe('p1/s2/lv30/st1');
  });

  /** 선택 축은 값이 없는 런이 섞일 수 있다 — 그런 런은 축 밖이라 접기에서 빠진다. */
  it('축 접기는 값이 없는 런을 버린다(미지정이 한 점으로 실리면 안 된다)', () => {
    const mk = (powerup: number | undefined): RunRecord => ({
      planet: 0,
      ship: 0,
      level: 5,
      ...(powerup === undefined ? {} : { powerup }),
      seed: 1,
      won: true,
      ticks: 100,
      values: { clearRate: 1 },
    });
    const points = foldBy([mk(undefined), mk(0), mk(0), mk(1)], 'powerup');
    expect(points.map((p) => p.value)).toEqual([0, 1]);
    expect(points[0]?.runs).toBe(2);
  });

  /**
   * 침략 단계 override — 레벨과 단계를 떼어 놓는 축(밸런스 큐 §R28).
   * 미지정이면 `standardStage(level)` 이므로 그 값을 명시해도 결과가 같아야 한다.
   */
  it('단계 override 미지정 = standardStage(level) 와 바이트 동일하다', () => {
    const cell = { planet: 3, ship: 0, level: 25 };
    const a = runCellSeed(cell, 1, WIRE_TICKS);
    const b = runCellSeed({ ...cell, stage: 5 }, 1, WIRE_TICKS); // ceil(25/5) = 5
    expect(b.ticks).toBe(a.ticks);
    expect(b.values).toEqual(a.values);
  });
});
