/**
 * Deterministic fixed-timestep world (ADR-0005).
 *
 * The simulation advances in fixed 60 Hz ticks. `stepWorld` is a deterministic
 * transition: given a world state and the input frame for a tick, it mutates the
 * state in place using only seeded RNG streams and the deterministic math module
 * — no wall-clock time, no `Math.random`, no platform trig. Running the same
 * [seed + input frames] therefore reproduces the exact same tick-by-tick state.
 *
 * M1 Phase 2 scope: full core combat. Per tick the loop resolves, in a FIXED
 * order (order changes the state hash): player movement/dash → wave spawns →
 * enemy behaviour (pattern engine) → player auto-attack → projectile & hazard
 * integration → spatial-hash collision resolution → dead-entity compaction.
 */

import { SeededRng } from './rng.js';
import { cos, sin, atan2, length, clamp } from './math.js';
import { DT, ARENA_WIDTH, ARENA_HEIGHT } from './constants.js';
import type { Entity } from './entities.js';
import { blankEntity, spawnBullet, spawnGem } from './entities.js';
import { SpatialHash, circlesOverlap } from './collision.js';
import { updateEnemy } from './patterns/index.js';
import type { WaveRuntime } from './waves.js';
import { createWaveRuntime, updateWaves, enemyDefFor } from './waves.js';

export { TICK_RATE, DT, ARENA_WIDTH, ARENA_HEIGHT } from './constants.js';
export type { Entity, EntityKind } from './entities.js';

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

/**
 * Player primary weapon (vulcan) stats. Phase 3 powerups mutate this object in
 * place — every field is a documented amplification hook. Auto-attack reads it
 * each fire; nothing else caches these values.
 */
export interface WeaponStats {
  /** Ticks between shots (lower = faster fire). */
  fireCooldown: number;
  bulletSpeed: number;
  damage: number;
  /** Projectiles per volley (fanned across `spread`). */
  bulletCount: number;
  /** Total fan angle in radians when bulletCount > 1. */
  spread: number;
  /** Extra enemies a bullet passes through (0 = despawn on first hit). */
  pierce: number;
  bulletRadius: number;
  /** Targeting range; 0 = unlimited. */
  range: number;
  /** Bullet lifetime in ticks. */
  bulletLife: number;
}

export const DEFAULT_WEAPON: WeaponStats = {
  fireCooldown: 6,
  bulletSpeed: 900,
  damage: 8,
  bulletCount: 1,
  spread: 0.18,
  pierce: 0,
  bulletRadius: 5,
  range: 0,
  bulletLife: 55,
};

export interface WorldConfig {
  arenaWidth: number;
  arenaHeight: number;
  playerSpeed: number; // units/second
  dashSpeed: number; // impulse units/second
  dashCooldownTicks: number;
  dashIframes: number;
  /** Invulnerability granted after taking damage (ticks). */
  hitIframes: number;
  playerHp: number;
}

export const DEFAULT_CONFIG: WorldConfig = {
  arenaWidth: ARENA_WIDTH,
  arenaHeight: ARENA_HEIGHT,
  playerSpeed: 360,
  dashSpeed: 1400,
  dashCooldownTicks: 42,
  dashIframes: 10,
  hitIframes: 40,
  playerHp: 100,
};

export interface WorldState {
  tick: number;
  config: WorldConfig;
  /** Master RNG (other streams fork from it at creation). */
  rng: SeededRng;
  /** Wave director stream (spec: rng.fork('waves')). */
  waveRng: SeededRng;
  weapon: WeaponStats;
  wave: WaveRuntime;
  entities: Entity[];
  nextEntityId: number;
  /** Id of the player entity (always the entity at index 0). */
  playerId: number;
  /** Current segment's simultaneous enemy-bullet cap. */
  bulletCap: number;
  /** Live enemy-bullet count this tick (maintained during the enemy phase). */
  enemyBulletCount: number;
  kills: number;
  gems: number;
}

/**
 * Create the initial world for a run. The wave director drives all enemy
 * spawning, so the starting layout past the player is empty until the first
 * card is drawn (tick 0). Everything is a pure function of the seed.
 */
export function createWorld(seed: number, config: WorldConfig = DEFAULT_CONFIG): WorldState {
  const rng = new SeededRng(seed);
  const entities: Entity[] = [];
  let nextEntityId = 1;

  const player = blankEntity('player');
  player.id = nextEntityId++;
  player.x = config.arenaWidth / 2;
  player.y = config.arenaHeight / 2;
  player.radius = 16;
  player.hp = config.playerHp;
  player.maxHp = config.playerHp;
  entities.push(player);

  return {
    tick: 0,
    config,
    rng,
    waveRng: rng.fork('waves'),
    weapon: { ...DEFAULT_WEAPON },
    wave: createWaveRuntime(),
    entities,
    nextEntityId,
    playerId: player.id,
    bulletCap: 300,
    enemyBulletCount: 0,
    kills: 0,
    gems: 0,
  };
}

function getPlayer(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined || p.kind !== 'player') {
    throw new Error('world invariant violated: player entity missing at index 0');
  }
  return p;
}

/**
 * Advance the world by exactly one tick. Deterministic in (state, input).
 */
export function stepWorld(state: WorldState, input: InputFrame): void {
  const player = getPlayer(state);

  stepPlayer(state, player, input);
  updateWaves(state, player);
  stepEnemies(state, player);
  autoAttack(state, player);
  stepProjectiles(state);
  stepHazards(state);
  resolveCollisions(state, player);
  compact(state);

  state.tick++;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function stepPlayer(state: WorldState, player: Entity, input: InputFrame): void {
  const config = state.config;
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

  if (player.dashCooldown > 0) player.dashCooldown--;
  if (player.iframes > 0) player.iframes--;

  if (input.dash && player.dashCooldown === 0) {
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
}

// ---------------------------------------------------------------------------
// Enemies (pattern engine)
// ---------------------------------------------------------------------------

function stepEnemies(state: WorldState, player: Entity): void {
  // Snapshot the enemy set so bullets/hazards emitted this tick are not treated
  // as enemies, and count live enemy bullets for the per-segment cap.
  state.enemyBulletCount = countKind(state, 'enemyBullet');
  const enemies: Entity[] = [];
  for (const e of state.entities) if (e.kind === 'enemy') enemies.push(e);
  for (const e of enemies) {
    const def = enemyDefFor(e);
    if (def !== undefined) updateEnemy(state, e, def, player);
  }
}

// ---------------------------------------------------------------------------
// Player auto-attack (vulcan): target nearest enemy, fire a fanned volley.
// ---------------------------------------------------------------------------

function autoAttack(state: WorldState, player: Entity): void {
  const w = state.weapon;
  if (player.cooldown > 0) player.cooldown--;
  if (player.cooldown > 0) return;

  const target = nearestEnemy(state, player, w.range);
  if (target === undefined) return;

  const baseAngle = atan2(target.y - player.y, target.x - player.x);
  const n = w.bulletCount;
  const start = n > 1 ? baseAngle - w.spread / 2 : baseAngle;
  const stepA = n > 1 ? w.spread / (n - 1) : 0;
  for (let i = 0; i < n; i++) {
    const ang = start + stepA * i;
    spawnBullet(
      state,
      player.x,
      player.y,
      ang,
      w.bulletSpeed,
      w.damage,
      w.pierce,
      w.bulletRadius,
      w.bulletLife,
      cos(ang),
      sin(ang),
    );
  }
  player.cooldown = w.fireCooldown;
}

function nearestEnemy(state: WorldState, from: Entity, range: number): Entity | undefined {
  const maxD2 = range > 0 ? range * range : Infinity;
  let best: Entity | undefined;
  let bestD = maxD2;
  for (const e of state.entities) {
    if (e.kind !== 'enemy' || e.dead) continue;
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Projectiles & hazards
// ---------------------------------------------------------------------------

function stepProjectiles(state: WorldState): void {
  const w = state.config.arenaWidth;
  const h = state.config.arenaHeight;
  const margin = 40;
  for (const e of state.entities) {
    if (e.kind !== 'bullet' && e.kind !== 'enemyBullet') continue;
    e.x += e.vx * DT;
    e.y += e.vy * DT;
    if (e.life > 0) e.life--;
    if (
      e.life === 0 ||
      e.x < -margin ||
      e.x > w + margin ||
      e.y < -margin ||
      e.y > h + margin
    ) {
      e.dead = true;
    }
  }
}

function stepHazards(state: WorldState): void {
  for (const e of state.entities) {
    if (e.kind !== 'hazard') continue;
    if (e.timer > 0) {
      e.timer--; // still telegraphing
    } else if (e.life > 0) {
      e.life--; // active window ticking down
      if (e.life === 0) e.dead = true;
    } else {
      e.dead = true;
    }
  }
}

function hazardActive(h: Entity): boolean {
  return h.timer <= 0 && h.life > 0;
}

// ---------------------------------------------------------------------------
// Collision resolution (spatial hash)
// ---------------------------------------------------------------------------

function resolveCollisions(state: WorldState, player: Entity): void {
  const grid = new SpatialHash<Entity>(state.config.arenaWidth, state.config.arenaHeight, 128);
  // Insert everything the player or friendly bullets can interact with.
  for (const e of state.entities) {
    if (e.kind === 'enemy' || e.kind === 'enemyBullet' || e.kind === 'hazard' || e.kind === 'gem') {
      grid.insert(e);
    }
  }

  // Friendly bullets vs enemies.
  for (const b of state.entities) {
    if (b.kind !== 'bullet' || b.dead) continue;
    grid.query(b.x, b.y, b.radius, (t) => {
      if (b.dead || t.kind !== 'enemy' || t.dead) return;
      if (!circlesOverlap(b.x, b.y, b.radius, t.x, t.y, t.radius)) return;
      t.hp -= b.damage;
      if (t.hp <= 0) t.dead = true;
      if (b.pierce > 0) b.pierce--;
      else b.dead = true;
    });
  }

  // Player vs enemies / enemy bullets / hazards / gems.
  let dmg = 0;
  const invulnerable = player.iframes > 0;
  grid.query(player.x, player.y, player.radius, (t) => {
    if (t.dead) return;
    if (!circlesOverlap(player.x, player.y, player.radius, t.x, t.y, t.radius)) return;
    if (t.kind === 'gem') {
      t.dead = true;
      state.gems++;
      return;
    }
    if (invulnerable) return;
    if (t.kind === 'enemyBullet') {
      if (t.damage > dmg) dmg = t.damage;
      t.dead = true;
    } else if (t.kind === 'enemy') {
      if (t.damage > dmg) dmg = t.damage;
    } else if (t.kind === 'hazard' && hazardActive(t)) {
      if (t.damage > dmg) dmg = t.damage;
    }
  });
  if (dmg > 0 && !invulnerable) {
    player.hp -= dmg;
    if (player.hp < 0) player.hp = 0;
    player.iframes = state.config.hitIframes;
  }
}

// ---------------------------------------------------------------------------
// Dead-entity compaction (order-preserving; player stays at index 0).
// ---------------------------------------------------------------------------

function compact(state: WorldState): void {
  const survivors: Entity[] = [];
  const drops: { x: number; y: number }[] = [];
  for (const e of state.entities) {
    if (!e.dead) {
      survivors.push(e);
      continue;
    }
    if (e.kind === 'enemy') {
      state.kills++;
      drops.push({ x: e.x, y: e.y });
    }
  }
  state.entities = survivors;
  // Slain enemies drop an XP gem (Phase 3 adds magnet + combo value).
  for (const d of drops) spawnGem(state, d.x, d.y);
}

function countKind(state: WorldState, kind: Entity['kind']): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === kind) n++;
  return n;
}
