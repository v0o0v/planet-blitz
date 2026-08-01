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
 *
 * 실제 sim 을 도는 것은 결정론 확인 한 건뿐이다(가장 짧은 셀 1개 × 2회).
 */

import { describe, it, expect } from 'vitest';
import { PLANETS } from '../data/planets/index.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { BAND_LEVELS } from '../src/bench/standardBuild.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import {
  FIXED_SEEDS,
  bossEngageable,
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
   * **항진 방어** — PvE 승리는 곧 보스 처치(`compact()` 의 보스 분기)다. 따라서 승리한 런은
   * 반드시 보스를 관측했어야 한다.
   *
   * 이 단언이 없을 때 실제로 니플헤임(추격) 승리 422건이 전부 `bossReachRate=0` 인 채로
   * 리포트에 실렸다 — 게이트는 통과하는데 지표가 아무것도 보지 않는 상태였다. 시드는 그
   * 스윕에서 뽑은 **가장 짧은 승리 런**이다(158틱).
   */
  it('추격 모드(니플헤임) 승리 런은 보스를 관측한다 — 회귀 방어', () => {
    const r = runCellSeed({ planet: 2, ship: 2, level: 95 }, 11);
    expect(r.won).toBe(true);
    expect(r.values['bossReachRate']).toBe(1);
    expect(r.values['bossDps']).toBeGreaterThan(0);
  });

  it('일반 모드 승리 런도 보스를 관측한다(같은 불변식)', () => {
    // 아르케(racing) = 보스 도달률 100% 로 관측된 무대 중 가장 짧다.
    const r = runCellSeed({ planet: 3, ship: 0, level: 5 }, 1);
    if (r.won) {
      expect(r.values['bossReachRate']).toBe(1);
      expect(r.values['bossDps']).toBeGreaterThan(0);
    }
  });

  /**
   * 보스가 **스폰된 바로 그 틱에 처치**되는 런. `stepWorld` 안에서 스폰→피격→`compact` 제거가
   * 모두 끝나므로 반환 후 스캔하는 관측기는 보스를 한 번도 보지 못한다. 승리 사실이 교전을
   * 증명하므로 `bossReachRate` 는 1 이어야 한다(`cell.ts` 승리 보정 ②).
   *
   * 시드는 12,600런 스윕에서 이 경우로 잡힌 10건 중 가장 짧은 것이다(604틱).
   */
  it('보스 스폰 틱에 처치된 승리 런도 교전으로 센다 — 회귀 방어', () => {
    const r = runCellSeed({ planet: 4, ship: 0, level: 20 }, 43);
    expect(r.won).toBe(true);
    expect(r.values['bossReachRate']).toBe(1);
  });

  it('같은 (셀, 시드) 는 항상 같은 결과다', () => {
    // 가장 짧은 무대를 고른다(아르케 = racing, 런 길이 약 20초분).
    const cell = { planet: 3, ship: 0, level: 5 };
    const a = runCellSeed(cell, 1);
    const b = runCellSeed(cell, 1);
    expect(a.ticks).toBe(b.ticks);
    expect(a.won).toBe(b.won);
    expect(a.values).toEqual(b.values);
  });

  it('전 지표가 유한한 수로 채워진다', () => {
    const r = runCellSeed({ planet: 3, ship: 0, level: 5 }, 1);
    for (const key of METRIC_KEYS) {
      expect(Number.isFinite(r.values[key]), key).toBe(true);
    }
  });
});
