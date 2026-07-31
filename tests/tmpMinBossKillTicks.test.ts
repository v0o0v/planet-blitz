/**
 * TEMP measurement script — MIN_BOSS_KILL_TICKS 실측. 측정 후 반드시 삭제(vite-node 부재
 * 우회 관용구, .omc/plans/balance-impl-handoff-2026-07-27.md 4.1 선례).
 *
 * 프로덕션 코드는 건드리지 않는다. 순수 관찰자.
 */
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  createWorld,
  stepWorld,
  emptyInput,
  packPowerupPick,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { computeLoadoutStats } from '../src/items/loadout.js';
import { standardGearSet, standardSkillInvest } from '../src/bench/standardBuild.js';
import { PLANETS } from '../data/planets/index.js';
import { SeededRng } from '../src/sim/rng.js';
import { atan2, length } from '../src/sim/math.js';

const DURABLE = 100_000_000;
const HOSTILE_KINDS: readonly string[] = ['enemy', 'boss'];
const MAX_TICKS = 20000; // 333s @60fps

function nearestHostile(state: WorldState, px: number, py: number): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const e of state.entities) {
    if (!HOSTILE_KINDS.includes(e.kind)) continue;
    const d = length(e.x - px, e.y - py);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function pilotStep(state: WorldState, gen: SeededRng): InputFrame {
  if (state.pendingLevelUp) {
    return { ...emptyInput(), special: packPowerupPick(0) };
  }
  const p = state.entities[0];
  const px = p?.x ?? 0;
  const py = p?.y ?? 0;
  const target = nearestHostile(state, px, py);
  const nx = gen.range(-0.35, 0.35);
  const ny = gen.range(-0.35, 0.35);
  const dash = gen.chance(0.04);
  if (target === undefined) {
    return { moveX: 0.55 + nx, moveY: -0.45 + ny, aim: gen.range(-Math.PI, Math.PI), dash, special: 0 };
  }
  const dx = target.x - px;
  const dy = target.y - py;
  const len = length(dx, dy) || 1;
  return { moveX: dx / len + nx, moveY: dy / len + ny, aim: atan2(dy, dx), dash, special: 0 };
}

interface RunResult {
  key: string;
  planet: number;
  planetId: string;
  shipType: number;
  stage: number;
  seed: number;
  victory: boolean;
  bossKilled: boolean;
  finalTick: number;
}

function buildConfig(planet: number, stage: number, shipType: number, gearSeed: number): WorldConfig {
  const skillInvest = standardSkillInvest(shipType, 100);
  const items = standardGearSet(100, gearSeed, planet);
  const { loadout } = computeLoadoutStats(items, skillInvest, 0, shipType);
  return {
    ...DEFAULT_CONFIG,
    planet,
    stage,
    shipType,
    playerHp: DURABLE,
    loadout,
    skillInvest,
    planetMode: PLANETS[planet]?.mode ?? DEFAULT_CONFIG.planetMode,
  };
}

function runOne(planet: number, stage: number, shipType: number, seed: number): RunResult {
  const config = buildConfig(planet, stage, shipType, seed);
  const state = createWorld(seed, config);
  const gen = new SeededRng((seed ^ 0x5bd1c0de) >>> 0);
  let finalTick = MAX_TICKS;
  let victory = false;
  for (let t = 0; t < MAX_TICKS; t++) {
    const frame = pilotStep(state, gen);
    stepWorld(state, frame);
    if (state.victory || state.gameOver) {
      finalTick = t + 1;
      victory = state.victory;
      break;
    }
  }
  return {
    key: `${PLANETS[planet]?.id}/ship${shipType}/stage${stage}/seed${seed}`,
    planet,
    planetId: PLANETS[planet]?.id ?? `p${planet}`,
    shipType,
    stage,
    seed,
    victory,
    bossKilled: victory,
    finalTick,
  };
}

it('measure min boss-kill finalTick across planets x ships x seeds (stage 1)', () => {
  const results: RunResult[] = [];
  const SEEDS = Array.from({ length: 25 }, (_, i) => 0x1001 + i * 0x1000);
  const TOXAR = 4;
  for (let shipType = 0; shipType < 7; shipType++) {
    for (const stage of [1, 11, 21]) {
      for (const seed of SEEDS) {
        results.push(runOne(TOXAR, stage, shipType, seed));
      }
    }
  }
  const stageCheck: RunResult[] = [];
  for (const stage of [1, 11, 21]) {
    for (const seed of [0x1001, 0x2002, 0x3003]) {
      stageCheck.push(runOne(0, stage, 0, seed));
    }
  }

  const victories = results.filter((r) => r.victory);
  const finalTicks = victories.map((r) => r.finalTick).sort((a, b) => a - b);
  const quantile = (p: number): number => {
    if (finalTicks.length === 0) return NaN;
    const idx = Math.min(finalTicks.length - 1, Math.floor(p * finalTicks.length));
    return finalTicks[idx] as number;
  };

  const out = {
    meta: {
      totalRuns: results.length,
      victories: victories.length,
      maxTicksCap: MAX_TICKS,
      seeds: SEEDS,
      shipsCovered: 7,
      planetsCovered: PLANETS.length,
    },
    min: finalTicks[0] ?? NaN,
    p1: quantile(0.01),
    p5: quantile(0.05),
    p10: quantile(0.1),
    p50: quantile(0.5),
    fastestRuns: results
      .slice()
      .sort((a, b) => a.finalTick - b.finalTick)
      .slice(0, 15),
    nonVictoryOrCapped: results.filter((r) => !r.victory || r.finalTick >= MAX_TICKS),
    stageCheck,
    allResults: results,
  };
  writeFileSync(
    'C:/Users/v0o0v/AppData/Local/Temp/claude/D--ClaudeCowork-worktrees-shooting-awesome-nash-a9c456/e29c42eb-1d10-4f01-8439-b03a3d5ee8ad/scratchpad/minBossKillTicks.json',
    JSON.stringify(out, null, 2),
    'utf8',
  );
  console.log(
    `[minBossKillTicks] runs=${results.length} victories=${victories.length} min=${out.min} p1=${out.p1} p5=${out.p5} p10=${out.p10} p50=${out.p50}`,
  );
});
