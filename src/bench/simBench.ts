/**
 * Headless SIM throughput bench (plan Phase G3). Unlike `bench.ts` (a PIXI render
 * harness), this measures the deterministic simulation itself — `stepWorld` cost
 * under the 2,000-projectile stress load with the infinite scroll map active
 * (chunk generation, active walls + LOS, wall bullet sweeps). No rendering, no
 * `Math.random` in the sim path.
 *
 * Run:  npx vite-node src/bench/simBench.ts
 *
 * It reports:
 *   1. Average `stepWorld` ms/tick vs the 16.6 ms (60 fps) frame budget (AC4).
 *   2. A/B of the broad-phase grid cell size (128 vs 256) so the winner can be
 *      baked into GRID_CELL_SIZE (world.ts).
 */

import { createWorld, stepWorld, emptyInput, GRID_CELL_SIZE } from '../sim/world.js';
import type { WorldState } from '../sim/world.js';
import { blankEntity, addEntity } from '../sim/entities.js';
import { SpatialHash } from '../sim/collision.js';
import type { Entity } from '../sim/entities.js';

// Inject a little over 2,000 so that after warmup drain (some drift beyond the
// cull radius / are swept by walls) the SUSTAINED live count stays >= 2,000 (AC4).
const PROJECTILES = 2300;
const ENEMIES = 200;
const WARMUP_TICKS = 60;
const MEASURE_TICKS = 3000;

/** Build a heavy world: player roamed far (chunks/walls active) + 2,000 enemy
 *  bullets + 200 enemies packed around the player. `enemyBullet`s are used for the
 *  projectile stress because friendly `bullet`s get consumed on enemy contact,
 *  which would bleed the population away mid-measurement. */
function buildStressWorld(seed: number, cellSize: number): WorldState {
  const state = createWorld(seed);
  state.grid = new SpatialHash<Entity>(cellSize); // scratch, not hashed — safe to swap
  // Silence the wave director: otherwise a durable roaming pilot can clear all
  // six segments and win, after which stepWorld early-returns and the measure is
  // meaningless. Chunk gimmicks/walls still generate from movement, and the
  // injected projectiles/enemies below carry the stress load.
  state.wave.done = true;
  const player = state.entities[0]!;
  player.hp = 1e9; // never die during the measure
  player.maxHp = 1e9;

  // Roam far off the origin so the safe zone is behind us and chunks/walls exist.
  for (let t = 0; t < 60 * 20; t++) stepWorld(state, { moveX: 1, moveY: -1, aim: 0, dash: false, special: 0 });

  const px = player.x;
  const py = player.y;
  // Deterministic scatter (no Math.random — bench must be reproducible).
  let s = 0x9e3779b9 ^ seed;
  const next = (): number => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
  const spread = 1600;
  for (let i = 0; i < PROJECTILES; i++) {
    const b = blankEntity('enemyBullet');
    b.x = px + (next() - 0.5) * spread;
    b.y = py + (next() - 0.5) * spread;
    const ang = next() * Math.PI * 2;
    const sp = 60 + next() * 180;
    b.vx = Math.cos(ang) * sp;
    b.vy = Math.sin(ang) * sp;
    b.radius = 5;
    b.damage = 0; // harmless — keep the player alive and the count stable
    b.life = 100000;
    addEntity(state, b);
  }
  for (let i = 0; i < ENEMIES; i++) {
    const e = blankEntity('enemy');
    e.x = px + (next() - 0.5) * spread;
    e.y = py + (next() - 0.5) * spread;
    e.radius = 32;
    e.hp = 1e9;
    e.maxHp = 1e9;
    e.enemyType = 1;
    e.cooldown = 100000; // do not let them emit and inflate the count
    addEntity(state, e);
  }
  return state;
}

function countProjectiles(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'enemyBullet' && !e.dead) n++;
  return n;
}
function countWalls(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'wall' && !e.dead) n++;
  return n;
}

function measure(cellSize: number): { avgMs: number; projectiles: number; walls: number } {
  const state = buildStressWorld(0x5121, cellSize);
  const idle = emptyInput();
  for (let t = 0; t < WARMUP_TICKS; t++) stepWorld(state, idle);
  const projectiles = countProjectiles(state);
  const walls = countWalls(state);
  if (state.gameOver || state.victory) throw new Error('bench world ended before measuring — check load setup');
  const start = performance.now();
  for (let t = 0; t < MEASURE_TICKS; t++) stepWorld(state, idle);
  const elapsedMs = performance.now() - start;
  return { avgMs: elapsedMs / MEASURE_TICKS, projectiles, walls };
}

function main(): void {
  const budget = 1000 / 60;
  console.log(`[simBench] load: ${PROJECTILES} enemy bullets + ${ENEMIES} enemies, scroll map active`);
  console.log(`[simBench] frame budget @60fps = ${budget.toFixed(2)} ms/tick\n`);

  const results: { size: number; avgMs: number; projectiles: number; walls: number }[] = [];
  for (const size of [128, 256]) {
    // Best of 3 runs to damp noise.
    let best = Infinity;
    let last = { avgMs: 0, projectiles: 0, walls: 0 };
    for (let r = 0; r < 3; r++) {
      last = measure(size);
      if (last.avgMs < best) best = last.avgMs;
    }
    results.push({ size, avgMs: best, projectiles: last.projectiles, walls: last.walls });
    console.log(
      `[simBench] cellSize=${size}: ${best.toFixed(3)} ms/tick  ` +
        `(${(budget / best).toFixed(1)}x budget headroom, ` +
        `sustained ${last.projectiles} projectiles, ${last.walls} active walls)`,
    );
  }

  const winner = results.reduce((a, b) => (a.avgMs <= b.avgMs ? a : b));
  console.log(
    `\n[simBench] WINNER cellSize=${winner.size} @ ${winner.avgMs.toFixed(3)} ms/tick. ` +
      `GRID_CELL_SIZE is currently ${GRID_CELL_SIZE}.`,
  );
  console.log(
    winner.avgMs <= budget
      ? `[simBench] PASS: ${winner.avgMs.toFixed(3)} ms <= ${budget.toFixed(2)} ms budget (AC4 60fps).`
      : `[simBench] FAIL: ${winner.avgMs.toFixed(3)} ms > ${budget.toFixed(2)} ms budget.`,
  );
}

main();
