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
import type { WorldState, WorldConfig } from '../sim/world.js';
import { blankEntity, addEntity } from '../sim/entities.js';
import { SpatialHash } from '../sim/collision.js';
import type { Entity } from '../sim/entities.js';
import {
  DEFAULT_TIME_LIMIT_TICKS,
  TURRET_VULCAN,
  TURRET_MISSILE,
  TURRET_TESLA,
} from '../sim/defense.js';
import type { DefenseLayout, InvasionConfig } from '../sim/defense.js';
import {
  GUARDIAN_TITAN,
  GUARDIAN_INTERCEPTOR,
  PERFORMANCE_FULL,
  makeGuardianSnapshot,
} from '../../data/guardian.js';

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

/**
 * 수호 포함 방어전(침공 런) 최악 부하 시나리오 (M5 Phase D1, AC9).
 *
 * `buildStressWorld`(무한 맵 PvE)와 달리, 이쪽은 **침공 방어전 config**를 구성한다: 수호 2기
 * (타이탄+인터셉터, 완전 성능) + 포탑 6기(발사체 방출) + 코어. 여기에 2,000발 스트레스 로드를
 * 얹어, 수호 AI(추적·조준·발사)와 포탑 발사가 함께 도는 tick 비용을 측정한다. 이것이 M5에서
 * 새로 추가된 sim 부하 경로다(M4 침공 런 + 수호 엔티티). 발사체 damage=0 으로 코어·플레이어를
 * 살려 인구를 안정 유지하고, 제한 시간(3분=10800틱) 안에서 측정해 조기 종료를 피한다. */
function buildGuardianStressWorld(seed: number): WorldState {
  const cx = 900;
  const layout: DefenseLayout = {
    core: { x: cx, y: 0 },
    turrets: [
      { type: TURRET_VULCAN, x: cx - 200, y: -150 },
      { type: TURRET_VULCAN, x: cx - 200, y: 150 },
      { type: TURRET_MISSILE, x: cx + 150, y: -180 },
      { type: TURRET_MISSILE, x: cx + 150, y: 180 },
      { type: TURRET_TESLA, x: cx, y: -260 },
      { type: TURRET_TESLA, x: cx, y: 260 },
    ],
    obstacles: [
      { x: cx - 60, y: 0, halfW: 40, halfH: 220 },
      { x: cx + 320, y: -300, halfW: 30, halfH: 30 },
    ],
    guardians: [
      { x: 350, y: -120, snapshot: makeGuardianSnapshot(GUARDIAN_TITAN, 400), performanceCP: PERFORMANCE_FULL, lineageBonusBp: 5000 },
      { x: 350, y: 120, snapshot: makeGuardianSnapshot(GUARDIAN_INTERCEPTOR, 400), performanceCP: PERFORMANCE_FULL, lineageBonusBp: 5000 },
    ],
  };
  const inv: InvasionConfig = { layout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS };
  const cfg: WorldConfig = {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 1e9,
    invasion: inv,
  };
  const state = createWorld(seed, cfg);
  const player = state.entities[0]!;
  player.hp = 1e9;
  player.maxHp = 1e9;
  // 수호·포탑이 붙도록 몇 틱 굴려 엔티티를 활성화한 뒤 스트레스 발사체를 얹는다.
  for (let t = 0; t < 30; t++) stepWorld(state, { moveX: 1, moveY: 0, aim: 0, dash: false, special: 0 });

  const px = player.x;
  const py = player.y;
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
    b.damage = 0;
    b.life = 100000;
    addEntity(state, b);
  }
  return state;
}

function countGuardians(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'guardian' && !e.dead) n++;
  return n;
}
function countTurrets(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'defenseTurret' && !e.dead) n++;
  return n;
}

function measureGuardian(): {
  avgMs: number;
  projectiles: number;
  guardians: number;
  turrets: number;
} {
  const state = buildGuardianStressWorld(0x5121);
  const idle = emptyInput();
  for (let t = 0; t < WARMUP_TICKS; t++) stepWorld(state, idle);
  const projectiles = countProjectiles(state);
  const guardians = countGuardians(state);
  const turrets = countTurrets(state);
  if (state.gameOver || state.victory) throw new Error('guardian bench world ended before measuring — check load setup');
  const start = performance.now();
  for (let t = 0; t < MEASURE_TICKS; t++) stepWorld(state, idle);
  const elapsedMs = performance.now() - start;
  return { avgMs: elapsedMs / MEASURE_TICKS, projectiles, guardians, turrets };
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

  // --- M5 Phase D1: 수호 포함 방어전 시나리오 ---
  console.log('\n[simBench] --- 수호 포함 방어전(침공 런) 시나리오 ---');
  let gBest = Infinity;
  let gLast = { avgMs: 0, projectiles: 0, guardians: 0, turrets: 0 };
  for (let r = 0; r < 3; r++) {
    gLast = measureGuardian();
    if (gLast.avgMs < gBest) gBest = gLast.avgMs;
  }
  console.log(
    `[simBench] guardian scenario: ${gBest.toFixed(3)} ms/tick  ` +
      `(${(budget / gBest).toFixed(1)}x budget headroom, ` +
      `${gLast.projectiles} projectiles + ${gLast.guardians} guardians + ${gLast.turrets} turrets)`,
  );
  console.log(
    gBest <= budget
      ? `[simBench] PASS: ${gBest.toFixed(3)} ms <= ${budget.toFixed(2)} ms budget (AC9 수호 포함 60fps).`
      : `[simBench] FAIL: ${gBest.toFixed(3)} ms > ${budget.toFixed(2)} ms budget.`,
  );
}

main();
