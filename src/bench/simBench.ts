/**
 * Headless SIM throughput bench (plan Phase G3). Unlike `bench.ts` (a PIXI render
 * harness), this measures the deterministic simulation itself — `stepWorld` cost
 * under the 2,000-projectile stress load with the infinite scroll map active
 * (chunk generation, active walls + LOS, wall bullet sweeps). No rendering, no
 * `Math.random` in the sim path.
 *
 * Run:  npx vite-node src/bench/simBench.ts
 *       npx vite-node src/bench/simBench.ts --invasion3   (M7a 재실행 예산 실측만)
 *
 * It reports:
 *   1. Average `stepWorld` ms/tick vs the 16.6 ms (60 fps) frame budget (AC4).
 *   2. A/B of the broad-phase grid cell size (128 vs 256) so the winner can be
 *      baked into GRID_CELL_SIZE (world.ts).
 *   3. (M7a · L6) 침공 3레이어 18000틱 **서버 재실행 벽시계** 실측 — Edge Function
 *      `verify-invasion` 의 재실행 예산(SOFT_RERUN_BUDGET_MS)이 현실적인지 판정한다.
 */

import { createWorld, stepWorld, emptyInput, GRID_CELL_SIZE } from '../sim/world.js';
import type { WorldState, WorldConfig } from '../sim/world.js';
import { blankEntity, addEntity } from '../sim/entities.js';
import { SpatialHash } from '../sim/collision.js';
import type { Entity } from '../sim/entities.js';
import {
  GUARDIAN_TITAN,
  GUARDIAN_INTERCEPTOR,
  PERFORMANCE_FULL,
  makeGuardianSnapshot,
} from '../../data/guardian.js';
import { hashWorld } from '../sim/replay.js';
import { SPECIAL_POWERUP_PICK } from '../sim/world.js';
import type { InputFrame } from '../sim/world.js';
import {
  INVASION_CORE_HP,
  INVASION_CORE_MODULE_SLOTS,
  INVASION_GUARDIAN_SLOTS,
  INVASION_PROP_SLOTS,
  INVASION_SOCKET_COUNTS,
  INVASION_TOTAL_TICKS,
  INVASION_WAVE_SLOTS,
  MAP_TEMPLATE_STRAIGHT,
} from '../sim/invasion/constants.js';
import { normalizeInvasionLayers } from '../sim/invasion/normalize.js';
import type { InvasionLayers, InvasionRef } from '../sim/invasion/types.js';
import { FORMATION_COUNT } from '../../data/invasion/formations.js';
import { FACILITY_CATALOG_COUNT } from '../../data/invasion/facilities.js';
import { L3_PROP_COUNT } from '../../data/invasion/props.js';
import { DEFAULT_DEFENSE_BOSS_ID } from '../../data/invasion/defenseBosses.js';

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

// ---------------------------------------------------------------------------
// M7a · L6 — 침공 3레이어 18000틱 서버 재실행 벽시계 실측
//
// (구 "수호 포함 방어전" 시나리오 — 포탑 6기 + 코어 단일 아레나 — 는 M7a L11 에서 삭제됐다.
//  같은 부하를 3레이어 만렙 배치가 상위 호환으로 덮는다: 편대 6 + 설비 12 + 기물 6 + 수호 2 +
//  보스 1. 실측 이력은 docs/qa/m5-phase-d-results.md 참조.)
// ---------------------------------------------------------------------------

/**
 * Edge Function 재실행 예산 게이트(`SOFT_RERUN_BUDGET_MS`, verify-invasion/index.ts)와
 * 같은 값. 벽시계가 이 값을 넘으면 Supabase Edge Runtime CPU/wall 한도에 걸려 **검증 자체가
 * 실패**할 위험이 커진다(재실행은 동기 루프라 중단 불가).
 */
export const INVASION3_RERUN_BUDGET_MS = 20_000;

/** 표본 Ref 1건(정수 5필드). 카탈로그 크기를 넘지 않도록 catalogId 를 접는다. */
function benchRef(catalogId: number, level: number, ascension: number, rarity: number): InvasionRef {
  return { catalogId, level, ascension, affixSeed: (catalogId * 2654435761) >>> 0, rarity };
}

/**
 * **최악 부하 배치** — 전 슬롯을 채운 만렙 3레이어 배치. 재실행 예산은 평균이 아니라 상한을
 * 봐야 의미가 있으므로, 빈 슬롯(기본 수비대 lv1)이 아니라 lv99·승급 최대·유니크로 채운다.
 */
export function maxedInvasionLayers(): InvasionLayers {
  const waveSlots: InvasionRef[] = [];
  for (let i = 0; i < INVASION_WAVE_SLOTS; i++) {
    waveSlots.push(benchRef(i % FORMATION_COUNT, 99, 5, 3));
  }
  const socketCount = INVASION_SOCKET_COUNTS[MAP_TEMPLATE_STRAIGHT] ?? 0;
  const sockets: InvasionRef[] = [];
  for (let i = 0; i < socketCount; i++) {
    sockets.push(benchRef(i % FACILITY_CATALOG_COUNT, 99, 5, 3));
  }
  const props: InvasionRef[] = [];
  for (let i = 0; i < INVASION_PROP_SLOTS; i++) {
    props.push(benchRef(i % L3_PROP_COUNT, 99, 5, 3));
  }
  const guardians: unknown[] = [];
  for (let i = 0; i < INVASION_GUARDIAN_SLOTS; i++) {
    guardians.push({
      x: 240 * (i === 0 ? -1 : 1),
      y: -160,
      snapshot: makeGuardianSnapshot(i === 0 ? GUARDIAN_TITAN : GUARDIAN_INTERCEPTOR, 400),
      performanceCP: PERFORMANCE_FULL,
      lineageBonusBp: 5000,
      milestones: 7,
    });
  }
  const modules: InvasionRef[] = [];
  for (let i = 0; i < INVASION_CORE_MODULE_SLOTS; i++) modules.push(benchRef(i, 99, 5, 3));
  return normalizeInvasionLayers({
    l1: { waveSlots },
    l2: { templateId: MAP_TEMPLATE_STRAIGHT, sockets },
    l3: {
      boss: benchRef(DEFAULT_DEFENSE_BOSS_ID, 99, 5, 3),
      guardians,
      props,
      core: { hp: INVASION_CORE_HP, x: 0, y: 0 },
      modules,
    },
  });
}

/** 3레이어 침공 런 config(플레이어는 죽지 않게 — 18000틱 전부를 실제로 돌려야 한다). */
export function invasion3BenchConfig(layers: InvasionLayers): WorldConfig {
  return {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 1e9,
    invasion3: { layers, timeLimitTicks: INVASION_TOTAL_TICKS },
  };
}

/**
 * 조종 입력 1프레임(결정론 — Math.random 미사용). `pendingLevelUp` 이면 레벨업 선택을 실어
 * 프리즈를 푼다.
 *
 * ⚠️ 이 처리를 빼면 벤치가 **조용히 무의미해진다.** stepWorld 는 `pendingLevelUp` 동안
 * 월드를 통째로 정지시키고 tick 만 올린다(world.ts). 침공 런은 편대를 잡아 금방 레벨업하므로,
 * 선택을 안 실으면 런이 L2 에서 얼어붙은 채 남은 1만여 틱을 빈 루프로 흘려보내고 벽시계가
 * 실제의 몇 분의 일로 나온다(초기 측정에서 실제로 발생 — 0.4초/L2 정지).
 */
function pilotFrame(state: WorldState, i: number): InputFrame {
  return {
    moveX: Math.sin(i / 37),
    moveY: Math.cos(i / 53),
    aim: (i / 29) % 6.28,
    dash: i % 90 === 0,
    special: state.pendingLevelUp ? SPECIAL_POWERUP_PICK : 0,
  };
}

/**
 * 18000틱 3레이어 런을 **서버가 하는 그대로**(createWorld → stepWorld → hashWorld 전 틱)
 * 재실행하고 벽시계를 잰다. EF `verifyRun` 의 지배적 비용이 정확히 이 경로다.
 *
 * 2패스인 이유: 클라이언트는 라이브로 조종하며 입력을 **기록**하고, 서버는 그 기록을
 * **재생**한다. 벤치도 같은 구조여야 한다 — 1패스에서 적응형 파일럿으로 입력 로그를 만들고,
 * 2패스에서 그 로그만으로 재실행해 잰다(측정 구간에 조종 판단 비용이 섞이지 않는다).
 */
export function measureInvasion3Rerun(seed = 0x7a11): {
  elapsedMs: number;
  ticks: number;
  peakEntities: number;
  maxPhase: number;
  ended: 'victory' | 'gameOver' | 'timeLimit';
} {
  const layers = maxedInvasionLayers();
  const config = invasion3BenchConfig(layers);

  // --- 1패스: 라이브 조종 + 입력 기록(클라이언트 몫). 측정 대상 아님. ---
  const recorded: InputFrame[] = [];
  {
    const live = createWorld(seed, config);
    for (let i = 0; i < INVASION_TOTAL_TICKS; i++) {
      const frame = pilotFrame(live, i);
      recorded.push(frame);
      stepWorld(live, frame);
      if (live.gameOver || live.victory) break;
    }
  }

  // --- 2패스: 서버 재실행(측정 구간). 틱마다 hashWorld 까지 — verifyRun 과 동일. ---
  const start = performance.now();
  const state = createWorld(seed, config);
  let peakEntities = state.entities.length;
  let maxPhase = state.invasion3?.phase ?? 0;
  for (const input of recorded) {
    stepWorld(state, input);
    void hashWorld(state);
    const n = state.entities.length;
    if (n > peakEntities) peakEntities = n;
    const p = state.invasion3?.phase ?? 0;
    if (p > maxPhase) maxPhase = p;
  }
  const elapsedMs = performance.now() - start;
  return {
    elapsedMs,
    ticks: state.tick,
    peakEntities,
    maxPhase,
    ended: state.victory ? 'victory' : state.gameOver ? 'gameOver' : 'timeLimit',
  };
}

function reportInvasion3(): void {
  console.log('\n[simBench] --- M7a 침공 3레이어 서버 재실행 예산(18000틱) ---');
  const m = measureInvasion3Rerun();
  const s = (m.elapsedMs / 1000).toFixed(2);
  console.log(
    `[simBench] invasion3 rerun: ${s}s (${m.elapsedMs.toFixed(0)}ms) ` +
      `ticks=${m.ticks} peakEntities=${m.peakEntities} maxPhase=L${m.maxPhase + 1} ended=${m.ended}`,
  );
  console.log(
    m.elapsedMs <= INVASION3_RERUN_BUDGET_MS
      ? `[simBench] PASS: ${s}s <= ${INVASION3_RERUN_BUDGET_MS / 1000}s (EF SOFT_RERUN_BUDGET_MS).`
      : `[simBench] FAIL: ${s}s > ${INVASION3_RERUN_BUDGET_MS / 1000}s — L3 엔티티 상한·컬링 반경을 조여야 한다.`,
  );
}

function main(): void {
  // `--invasion3` 만 주면 M7a 재실행 예산 실측만 돌린다(구 시나리오는 수 분이 걸린다).
  // `process` 를 전역 타입으로 가정하지 않는다(sim 과 같은 플랫폼 무참조 규율 — memProbe.ts 선례).
  const argv = (globalThis as { process?: { argv?: readonly string[] } }).process?.argv ?? [];
  if (argv.includes('--invasion3')) {
    reportInvasion3();
    return;
  }
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

  // --- M7a L6: 침공 3레이어 서버 재실행 예산 (구 M5 수호 방어전 시나리오를 대체) ---
  reportInvasion3();
}

main();
