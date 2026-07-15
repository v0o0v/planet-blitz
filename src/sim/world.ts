/**
 * Deterministic fixed-timestep world (ADR-0005).
 *
 * The simulation advances in fixed 60 Hz ticks. `stepWorld` is a deterministic
 * transition: given a world state and the input frame for a tick, it mutates the
 * state in place using only the seeded RNG and the deterministic math module —
 * no wall-clock time, no `Math.random`, no platform trig. Running the same
 * [seed + input frames] therefore reproduces the exact same tick-by-tick state.
 *
 * M1 Phase 1 scope: a controllable player plus a handful of wandering "dummy"
 * entities. This is intentionally minimal but exercises RNG draws, deterministic
 * trig, velocity integration and wall collisions — enough to make the
 * determinism hash test meaningful. Real combat entities (enemies, bullets,
 * gems, ...) are layered on this loop in Phase 2+.
 */

import { SeededRng } from './rng.js';
import { cos, sin, atan2, length, clamp, PI } from './math.js';

/** Fixed simulation timestep: 60 ticks per second. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Default arena bounds (world units, matches the 1920x1080 design space). */
export const ARENA_WIDTH = 1920;
export const ARENA_HEIGHT = 1080;

/** Special-event bit flags packed into `InputFrame.special`. */
export const SPECIAL_NONE = 0;
export const SPECIAL_POWERUP_PICK = 1 << 0; // reserved for Phase 3 powerup selection

/**
 * Per-tick input. This is the ONLY external influence on the simulation, and it
 * is what gets recorded into the replay log.
 */
export interface InputFrame {
  /** Movement axis X in [-1, 1]. */
  moveX: number;
  /** Movement axis Y in [-1, 1]. */
  moveY: number;
  /** Aim angle in radians (world space, atan2 convention). */
  aim: number;
  /** Dash requested this tick. */
  dash: boolean;
  /** Bit flags for discrete events (powerup pick, etc.). 0 = none. */
  special: number;
}

export function emptyInput(): InputFrame {
  return { moveX: 0, moveY: 0, aim: 0, dash: false, special: SPECIAL_NONE };
}

export type EntityKind = 'player' | 'dummy';

export interface Entity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Facing / aim angle (radians). */
  angle: number;
  radius: number;
  hp: number;
  /** Ticks remaining until an internal decision (e.g. dummy re-heading). */
  timer: number;
  /** Dash cooldown in ticks (player only). */
  dashCooldown: number;
  /** Invulnerability frames remaining (player dash i-frames). */
  iframes: number;
}

export interface WorldConfig {
  arenaWidth: number;
  arenaHeight: number;
  playerSpeed: number; // units/second
  dashSpeed: number; // impulse units/second
  dashCooldownTicks: number;
  dashIframes: number;
  dummyCount: number;
  dummySpeed: number;
}

export const DEFAULT_CONFIG: WorldConfig = {
  arenaWidth: ARENA_WIDTH,
  arenaHeight: ARENA_HEIGHT,
  playerSpeed: 360,
  dashSpeed: 1400,
  dashCooldownTicks: 42,
  dashIframes: 10,
  dummyCount: 6,
  dummySpeed: 140,
};

export interface WorldState {
  tick: number;
  config: WorldConfig;
  /** Master RNG (reserved for future subsystems that fork from it). */
  rng: SeededRng;
  /** Persistent stream advanced across ticks for dummy wandering. */
  wanderRng: SeededRng;
  entities: Entity[];
  nextEntityId: number;
  /** Id of the player entity (always the entity at index 0). */
  playerId: number;
}

/**
 * Create the initial world for a run. Dummy positions/headings are drawn from
 * the seeded RNG, so the starting layout is a pure function of the seed.
 */
export function createWorld(seed: number, config: WorldConfig = DEFAULT_CONFIG): WorldState {
  const rng = new SeededRng(seed);
  const entities: Entity[] = [];
  let nextEntityId = 1;

  const player: Entity = {
    id: nextEntityId++,
    kind: 'player',
    x: config.arenaWidth / 2,
    y: config.arenaHeight / 2,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 16,
    hp: 100,
    timer: 0,
    dashCooldown: 0,
    iframes: 0,
  };
  entities.push(player);

  // Dedicated stream so dummy spawning does not disturb other future streams.
  const spawnRng = rng.fork('dummy-spawn');
  for (let i = 0; i < config.dummyCount; i++) {
    const heading = spawnRng.range(-PI, PI);
    entities.push({
      id: nextEntityId++,
      kind: 'dummy',
      x: spawnRng.range(80, config.arenaWidth - 80),
      y: spawnRng.range(80, config.arenaHeight - 80),
      vx: cos(heading) * config.dummySpeed,
      vy: sin(heading) * config.dummySpeed,
      angle: heading,
      radius: 14,
      hp: 20,
      timer: spawnRng.int(30, 120),
      dashCooldown: 0,
      iframes: 0,
    });
  }

  return {
    tick: 0,
    config,
    rng,
    wanderRng: rng.fork('dummy-wander'),
    entities,
    nextEntityId,
    playerId: player.id,
  };
}

function getPlayer(state: WorldState): Entity {
  // Player is always the first entity (id === playerId).
  const p = state.entities[0];
  if (p === undefined || p.kind !== 'player') {
    throw new Error('world invariant violated: player entity missing at index 0');
  }
  return p;
}

/** Reflect a position/velocity pair off the arena walls (deterministic). */
function bounceWalls(e: Entity, config: WorldConfig): void {
  if (e.x < e.radius) {
    e.x = e.radius;
    e.vx = Math.abs(e.vx);
  } else if (e.x > config.arenaWidth - e.radius) {
    e.x = config.arenaWidth - e.radius;
    e.vx = -Math.abs(e.vx);
  }
  if (e.y < e.radius) {
    e.y = e.radius;
    e.vy = Math.abs(e.vy);
  } else if (e.y > config.arenaHeight - e.radius) {
    e.y = config.arenaHeight - e.radius;
    e.vy = -Math.abs(e.vy);
  }
}

/**
 * Advance the world by exactly one tick. Deterministic in (state, input).
 */
export function stepWorld(state: WorldState, input: InputFrame): void {
  const config = state.config;
  const player = getPlayer(state);

  // --- Player movement ---
  let mx = input.moveX;
  let my = input.moveY;
  const mlen = length(mx, my);
  if (mlen > 1) {
    mx /= mlen;
    my /= mlen;
  }
  player.vx = mx * config.playerSpeed;
  player.vy = my * config.playerSpeed;
  player.angle = input.aim;

  if (player.dashCooldown > 0) {
    player.dashCooldown--;
  }
  if (player.iframes > 0) {
    player.iframes--;
  }
  if (input.dash && player.dashCooldown === 0) {
    // Dash in the current movement direction, or aim if standing still.
    let dx = mx;
    let dy = my;
    if (length(dx, dy) < 0.001) {
      dx = cos(player.angle);
      dy = sin(player.angle);
    }
    player.vx += dx * config.dashSpeed;
    player.vy += dy * config.dashSpeed;
    player.dashCooldown = config.dashCooldownTicks;
    player.iframes = config.dashIframes;
  }

  player.x += player.vx * DT;
  player.y += player.vy * DT;
  player.x = clamp(player.x, player.radius, config.arenaWidth - player.radius);
  player.y = clamp(player.y, player.radius, config.arenaHeight - player.radius);

  // --- Dummy entities: wander + wall bounce ---
  // Uses the persistent wander stream so randomness genuinely evolves across
  // ticks while staying a pure function of the seed.
  const wanderRng = state.wanderRng;
  for (let i = 1; i < state.entities.length; i++) {
    const e = state.entities[i];
    if (e === undefined) continue;
    e.timer--;
    if (e.timer <= 0) {
      // Pick a new heading deterministically.
      const heading = wanderRng.range(-PI, PI);
      e.vx = cos(heading) * config.dummySpeed;
      e.vy = sin(heading) * config.dummySpeed;
      e.timer = wanderRng.int(30, 120);
    }
    e.x += e.vx * DT;
    e.y += e.vy * DT;
    bounceWalls(e, config);
    // Face travel direction.
    e.angle = atan2(e.vy, e.vx);
  }

  state.tick++;
}
