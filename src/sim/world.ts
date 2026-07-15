/**
 * Deterministic fixed-timestep world (ADR-0005).
 *
 * The simulation advances in fixed 60 Hz ticks. `stepWorld` is a deterministic
 * transition: given a world state and the input frame for a tick, it mutates the
 * state in place using only seeded RNG streams and the deterministic math module
 * — no wall-clock time, no `Math.random`, no platform trig. Running the same
 * [seed + input frames] therefore reproduces the exact same tick-by-tick state.
 *
 * M1 Phase 3 scope: full run loop. Per tick, in a FIXED order (order changes the
 * state hash): player movement/dash → wave spawns → enemy behaviour → boss →
 * player auto-attack → projectile/gem/supply integration → hazards → collisions
 * → dead-entity compaction → combo decay → level-up check → game-over check.
 *
 * The level-up powerup pick freezes the world (spec: sim ticks stall, not a
 * pause) and is resolved by a `SPECIAL_POWERUP_PICK` input frame carrying the
 * chosen index in its high bits — so a recorded run reproduces the same build.
 */

import { SeededRng } from './rng.js';
import { cos, sin, atan2, length } from './math.js';
import { DT, VIEW_WIDTH, VIEW_HEIGHT, OFFSCREEN_X } from './constants.js';
import type { Entity } from './entities.js';
import {
  blankEntity,
  spawnBullet,
  spawnGem,
  spawnSupply,
  spawnBoss,
  spawnWall,
  spawnDestructible,
  spawnEventObject,
} from './entities.js';
import { SpatialHash, circlesOverlap } from './collision.js';
import { updateEnemy } from './patterns/index.js';
import { updateBoss } from './boss.js';
import { drawPowerupChoices, applyPowerup } from './powerups.js';
import type { WaveRuntime } from './waves.js';
import { createWaveRuntime, updateWaves, enemyDefFor } from './waves.js';
import { LAVA_FORTRESS } from '../../data/boss.js';
import {
  CHUNK_SIZE,
  CHUNK_GEN_RADIUS,
  CHUNK_CULL_RADIUS,
  MAX_ACTIVE_GIMMICKS,
  chunkPlacements,
} from './chunks.js';
import { circleOverlapsWall, slideCircleWalls, segmentBlocked } from './los.js';
import {
  triggerMagnetEmitter,
  triggerBombDevice,
  activateTurret,
  isActiveTurret,
  MAGNET_BUFF_MULT,
  TURRET_FIRE_COOLDOWN,
  TURRET_RANGE,
  TURRET_BULLET_SPEED,
  TURRET_BULLET_DAMAGE,
  TURRET_BULLET_RADIUS,
  TURRET_BULLET_LIFE,
} from './events.js';

export { TICK_RATE, DT, VIEW_WIDTH, VIEW_HEIGHT } from './constants.js';

/**
 * Projectile cull radius (world units): bullets/enemy bullets farther than this
 * from the player despawn regardless of remaining lifetime. Sized at the
 * viewport diagonal x1.5 so a projectile is culled only well beyond the visible
 * frame — comfortably larger than any spawn ring, so no bullet is removed
 * before it can enter the screen. `Math.sqrt` is IEEE-754 correctly rounded and
 * evaluated once at load, so this constant is bit-identical on every platform.
 */
const PROJECTILE_CULL_RADIUS = Math.sqrt(VIEW_WIDTH * VIEW_WIDTH + VIEW_HEIGHT * VIEW_HEIGHT) * 1.5;

/**
 * Broad-phase grid cell size (world units). Larger cells mean fewer buckets to
 * visit per query but more candidates per bucket; smaller cells the reverse. For
 * the 2x-scale world (entity radii ~20..128), 256 measured faster than 128 in
 * the headless sim bench (G3, src/bench/simBench.ts) at the 2,000-projectile
 * stress load, so 256 is adopted. Grid is broad-phase only (exact distance is
 * re-checked) and rebuilt every tick, so this value never affects the sim hash.
 */
export const GRID_CELL_SIZE = 256;
export type { Entity, EntityKind } from './entities.js';

/** Special-event bit flags packed into `InputFrame.special`. */
export const SPECIAL_NONE = 0;
export const SPECIAL_POWERUP_PICK = 1 << 0;

/** Pack a powerup pick (index 0..2) into an input `special` value. */
export function packPowerupPick(index: number): number {
  return SPECIAL_POWERUP_PICK | ((index & 0x3) << 1);
}

// --- Progression / feel tuning (M1 prototype values; spec fixes only the
//     structure — combo cap x1.5, 20s supply window, boss 3-phase/overheat). ---
/** Ticks a combo survives without a pickup before it resets. */
const COMBO_WINDOW_TICKS = 120;
/** Multiplier gained per stacked pickup. */
const COMBO_STEP = 0.05;
/** Stacks at which the multiplier reaches its x1.5 cap (spec). */
const COMBO_MAX_STACK = 10;
/** Gem magnet speed once inside the radius (units/second). Raised for the 2x
 *  scale so gems close the larger distances at a comparable feel. */
const MAGNET_SPEED = 1520;
/** Base gem magnet radius (units); grown by the gem-magnet powerup. Doubled for
 *  the 2x scale so collection convenience keeps pace with the bigger map. */
const BASE_MAGNET_RADIUS = 420;
/** Supply raider hit points. */
const SUPPLY_HP = 420;
/** Supply raider on-screen window: 20 seconds (spec). */
const SUPPLY_LIFE_TICKS = 1200;
/** Supply raider crossing speed (units/second). Doubled for the 2x scale. */
const SUPPLY_SPEED = 380;
/** Gems dropped when a supply raider is shot down. */
const SUPPLY_REWARD_GEMS = 14;
/** XP value of each supply-drop gem. */
const SUPPLY_GEM_XP = 6;
/** Ticks at which a supply raider enters the run (once each). */
const SUPPLY_SPAWN_TICKS: readonly number[] = [1800, 6000];

/** XP required to reach the next level from the current one. */
export function xpToNext(level: number): number {
  return 10 + level * 6;
}

/** Combo multiplier for the current stack, capped at x1.5 (spec). */
export function comboMultiplier(combo: number): number {
  const stacks = combo < COMBO_MAX_STACK ? combo : COMBO_MAX_STACK;
  return 1 + stacks * COMBO_STEP;
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
  // Bullet speed doubled for the 2x-scale world so shots feel as fast relative to
  // the larger entities and distances.
  bulletSpeed: 1800,
  damage: 8,
  bulletCount: 1,
  spread: 0.18,
  pierce: 0,
  bulletRadius: 5,
  range: 0,
  bulletLife: 55,
};

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
  arenaWidth: VIEW_WIDTH,
  arenaHeight: VIEW_HEIGHT,
  // Movement speeds doubled for the 2x-scale world (units feel slow relative to
  // the enlarged entities/distances otherwise).
  playerSpeed: 720,
  dashSpeed: 2800,
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
  /** Powerup-offer stream (spec: rng.fork('powerups')). */
  powerupRng: SeededRng;
  /** Supply-raider placement stream. */
  supplyRng: SeededRng;
  /**
   * Chunk-placement stream (rng.fork('world')). NEVER advanced — chunk RNGs are
   * forked from it by coordinate, so its state is constant across a run. Folded
   * into the hash for symmetry with the other streams.
   */
  worldRng: SeededRng;
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
  // --- Progression (Phase 3) ---
  /** XP toward the next level (resets on level-up). */
  xp: number;
  /** Total XP earned this run (settlement screen). */
  xpTotal: number;
  level: number;
  /** Current gem combo stack. */
  combo: number;
  /** Ticks left before the combo resets. */
  comboTimer: number;
  /** Highest combo reached this run (settlement screen). */
  maxCombo: number;
  /** Gem magnet radius (grown by the gem-magnet powerup). */
  magnetRadius: number;
  /**
   * Ticks remaining on a magnet-emitter buff (multiplies the effective magnet
   * radius while > 0). Folded into the hash (deterministic gimmick state).
   */
  magnetBuffTicks: number;
  /** Supply-raid reward currency (M1 placeholder). */
  resources: number;
  /** World frozen awaiting a powerup pick (sim tick stall, not a pause). */
  pendingLevelUp: boolean;
  /** Powerup pool indices offered for the pending level-up. */
  powerupChoices: number[];
  /** Index into SUPPLY_SPAWN_TICKS of the next raider to spawn. */
  supplyNextIndex: number;
  /** Boss has been spawned for the boss segment. */
  bossSpawned: boolean;
  /** Player died (HP 0). */
  gameOver: boolean;
  /** Boss defeated — run cleared. */
  victory: boolean;
  /**
   * Reused broad-phase collision grid (cleared and refilled each tick instead of
   * reallocated). NOT part of the state hash — it is scratch space rebuilt from
   * scratch every tick, so it never influences determinism.
   */
  grid: SpatialHash<Entity>;
  /**
   * Which chunk coordinates have already had their gimmicks generated, keyed by
   * a folded integer chunk key. SCRATCH (like `grid`) — excluded from the hash
   * (its Map iteration order is not a determinism input). The generated gimmick
   * ENTITIES are hashed instead, which is sufficient. A culled chunk is removed
   * so re-entry regenerates it identically (pure placement, OQ1 default (a)).
   */
  generatedChunks: Map<number, true>;
  /**
   * Active cover walls, rebuilt every tick in entity-array order (same
   * determinism discipline as the grid). Walls are NOT inserted into the spatial
   * hash — they can exceed a cell, so movement/bullet/LOS checks iterate this
   * array directly. Scratch — not hashed (the wall entities themselves are).
   */
  activeWalls: Entity[];
}

/**
 * Create the initial world for a run. The wave director drives all enemy
 * spawning, so the starting layout past the player is empty until the first
 * card is drawn (tick 0). Everything is a pure function of the seed.
 */
export function createWorld(seed: number, config: WorldConfig = DEFAULT_CONFIG): WorldState {
  const cfg = { ...config };
  const rng = new SeededRng(seed);
  const entities: Entity[] = [];
  let nextEntityId = 1;

  const player = blankEntity('player');
  player.id = nextEntityId++;
  // Infinite map: the player begins at the natural world origin (0,0). The
  // camera follows the player, so the starting frame looks the same regardless.
  player.x = 0;
  player.y = 0;
  // 2x hitbox scale (plan D1): 16 -> 32. Render doubles again via ART_SCALE.
  player.radius = 32;
  player.hp = cfg.playerHp;
  player.maxHp = cfg.playerHp;
  entities.push(player);

  return {
    tick: 0,
    config: cfg,
    rng,
    waveRng: rng.fork('waves'),
    powerupRng: rng.fork('powerups'),
    supplyRng: rng.fork('supply'),
    worldRng: rng.fork('world'),
    weapon: { ...DEFAULT_WEAPON },
    wave: createWaveRuntime(),
    entities,
    nextEntityId,
    playerId: player.id,
    bulletCap: 300,
    enemyBulletCount: 0,
    kills: 0,
    gems: 0,
    xp: 0,
    xpTotal: 0,
    level: 1,
    combo: 0,
    comboTimer: 0,
    maxCombo: 0,
    magnetRadius: BASE_MAGNET_RADIUS,
    magnetBuffTicks: 0,
    resources: 0,
    pendingLevelUp: false,
    powerupChoices: [],
    supplyNextIndex: 0,
    bossSpawned: false,
    gameOver: false,
    victory: false,
    grid: new SpatialHash<Entity>(GRID_CELL_SIZE),
    generatedChunks: new Map<number, true>(),
    activeWalls: [],
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
  // Run is over — the world is inert (settlement screen is showing).
  if (state.gameOver || state.victory) return;

  // Level-up freeze: the world stalls until a pick arrives. The pick is applied
  // on the exact tick its input frame carries SPECIAL_POWERUP_PICK, keeping the
  // choice reproducible from the replay log.
  if (state.pendingLevelUp) {
    if ((input.special & SPECIAL_POWERUP_PICK) !== 0) {
      const idxOffered = (input.special >> 1) & 0x3;
      // Ignore an out-of-range offer index (fewer than 4 choices were offered):
      // keep the level-up pending rather than silently consuming it with no
      // powerup applied, so a malformed frame cannot skip a build choice.
      if (idxOffered < state.powerupChoices.length) {
        const poolIndex = state.powerupChoices[idxOffered];
        if (poolIndex !== undefined) applyPowerup(state, poolIndex);
        state.pendingLevelUp = false;
        state.powerupChoices = [];
      }
    }
    state.tick++;
    return;
  }

  const player = getPlayer(state);

  // Materialise/cull scroll-map gimmicks around the player, then rebuild the
  // active-wall list (both before movement so walls obstruct this tick).
  activateChunks(state, player);
  rebuildActiveWalls(state);

  stepPlayer(state, player, input);
  updateWaves(state, player);
  stepEnemies(state, player);
  stepBoss(state, player);
  autoAttack(state, player);
  stepTurrets(state, player);
  stepProjectiles(state, player);
  stepGems(state, player);
  stepSupply(state, player);
  stepHazards(state);
  resolveCollisions(state, player);
  compact(state);
  updateCombo(state);
  checkLevelUp(state);
  checkGameOver(state, player);

  state.tick++;
}

// ---------------------------------------------------------------------------
// Scroll-map chunks (deterministic procedural gimmicks)
// ---------------------------------------------------------------------------

/** True for any chunk-placed gimmick entity (terrain hazards are gimmicks only
 *  when permanent — life < 0 — so enemy mortar/lava hazards are never culled). */
function isGimmick(e: Entity): boolean {
  return (
    e.kind === 'wall' ||
    e.kind === 'destructible' ||
    e.kind === 'magnetEmitter' ||
    e.kind === 'bombDevice' ||
    e.kind === 'turretPickup' ||
    (e.kind === 'hazard' && e.life < 0)
  );
}

/** Fold a signed chunk coordinate pair into a unique non-negative integer key
 *  (Szudzik fold per axis, then large-prime mix — matches collision.ts style). */
function chunkKey(cx: number, cy: number): number {
  const a = cx >= 0 ? 2 * cx : -2 * cx - 1;
  const b = cy >= 0 ? 2 * cy : -2 * cy - 1;
  return ((a * 73856093) ^ (b * 19349663)) >>> 0;
}

/**
 * Generate not-yet-visited chunks within the generation radius and cull gimmicks
 * (and their chunk markers) beyond the cull radius. Deterministic:
 *  - generation scans a fixed (cy outer, cx inner) box and draws from the pure
 *    per-coordinate chunk RNG, so arrival order never changes a chunk's layout;
 *  - the active-gimmick cap defers far chunks in scan order when reached;
 *  - culling marks entities dead (order-independent) and prunes markers so a
 *    revisited chunk regenerates identically.
 */
function activateChunks(state: WorldState, player: Entity): void {
  const pcx = Math.floor(player.x / CHUNK_SIZE);
  const pcy = Math.floor(player.y / CHUNK_SIZE);

  // Count currently-live gimmicks to honour the active-region cap.
  let activeGimmicks = 0;
  for (const e of state.entities) if (isGimmick(e)) activeGimmicks++;

  const genR2 = CHUNK_GEN_RADIUS * CHUNK_GEN_RADIUS;
  const genChunkR = Math.ceil(CHUNK_GEN_RADIUS / CHUNK_SIZE) + 1;
  for (let cy = pcy - genChunkR; cy <= pcy + genChunkR; cy++) {
    for (let cx = pcx - genChunkR; cx <= pcx + genChunkR; cx++) {
      const key = chunkKey(cx, cy);
      if (state.generatedChunks.has(key)) continue;
      // Generate once the chunk centre is within the generation radius.
      const ccx = (cx + 0.5) * CHUNK_SIZE;
      const ccy = (cy + 0.5) * CHUNK_SIZE;
      const dx = ccx - player.x;
      const dy = ccy - player.y;
      if (dx * dx + dy * dy > genR2) continue;
      if (activeGimmicks >= MAX_ACTIVE_GIMMICKS) continue; // defer (retry next tick)
      const placements = chunkPlacements(state.worldRng, cx, cy);
      for (const g of placements) {
        if (activeGimmicks >= MAX_ACTIVE_GIMMICKS) break;
        spawnPlacement(state, g);
        activeGimmicks++;
      }
      state.generatedChunks.set(key, true);
    }
  }

  // Cull gimmicks whose chunk centre has drifted beyond the cull radius. Using
  // the chunk CENTRE (not the gimmick position) means every gimmick in a chunk
  // culls together on the same tick — no partial-chunk regeneration.
  const cullR2 = CHUNK_CULL_RADIUS * CHUNK_CULL_RADIUS;
  for (const e of state.entities) {
    if (!isGimmick(e)) continue;
    const cx = Math.floor(e.x / CHUNK_SIZE);
    const cy = Math.floor(e.y / CHUNK_SIZE);
    const ccx = (cx + 0.5) * CHUNK_SIZE;
    const ccy = (cy + 0.5) * CHUNK_SIZE;
    const dx = ccx - player.x;
    const dy = ccy - player.y;
    if (dx * dx + dy * dy > cullR2) e.dead = true;
  }
  // Prune chunk markers (including empty chunks) beyond the cull radius so the
  // map stays bounded and revisits regenerate. Fixed box scan (no Map iteration).
  const cullChunkR = Math.ceil(CHUNK_CULL_RADIUS / CHUNK_SIZE) + 1;
  for (let cy = pcy - cullChunkR; cy <= pcy + cullChunkR; cy++) {
    for (let cx = pcx - cullChunkR; cx <= pcx + cullChunkR; cx++) {
      const ccx = (cx + 0.5) * CHUNK_SIZE;
      const ccy = (cy + 0.5) * CHUNK_SIZE;
      const dx = ccx - player.x;
      const dy = ccy - player.y;
      if (dx * dx + dy * dy > cullR2) state.generatedChunks.delete(chunkKey(cx, cy));
    }
  }
}

/** Turn one placement descriptor into its entity. */
function spawnPlacement(state: WorldState, g: ReturnType<typeof chunkPlacements>[number]): void {
  switch (g.kind) {
    case 'wall':
      spawnWall(state, g.x, g.y, g.radius, g.halfH);
      break;
    case 'destructible':
      spawnDestructible(state, g.x, g.y, g.radius, g.hp, g.value);
      break;
    case 'hazard': {
      // Permanent terrain hazard: no telegraph (timer 0), never expires
      // (life = -1). stepHazards keeps life < 0 alive; hazardActive treats it as
      // continuously damaging.
      const h = blankEntity('hazard');
      h.enemyType = g.sub;
      h.x = g.x;
      h.y = g.y;
      h.radius = g.radius;
      h.timer = 0;
      h.life = -1;
      h.damage = g.value;
      h.phase = 1; // continuous damage
      addEntityTo(state, h);
      break;
    }
    case 'magnetEmitter':
    case 'bombDevice':
    case 'turretPickup':
      spawnEventObject(state, g.kind, g.x, g.y, g.radius);
      break;
  }
}

/** Append an entity, assigning the next id (mirrors entities.addEntity). */
function addEntityTo(state: WorldState, e: Entity): void {
  e.id = state.nextEntityId++;
  state.entities.push(e);
}

/** Rebuild the active-wall list in entity-array order (deterministic). */
function rebuildActiveWalls(state: WorldState): void {
  const walls = state.activeWalls;
  walls.length = 0;
  for (const e of state.entities) {
    if (e.kind === 'wall' && !e.dead) walls.push(e);
  }
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
  // Infinite map: no arena clamp. Movement obstruction is the job of gimmick
  // walls — slide out of any overlapped wall (dash included; the max dash step
  // ~59u/tick is far below a wall's minimum full width 120u, so no tunnelling).
  if (state.activeWalls.length > 0) {
    const slid = slideCircleWalls(player.x, player.y, player.radius, state.activeWalls);
    player.x = slid.x;
    player.y = slid.y;
  }
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
// Boss (spawned once the wave director reaches the boss segment).
// ---------------------------------------------------------------------------

function stepBoss(state: WorldState, player: Entity): void {
  if (state.wave.boss && !state.bossSpawned) {
    // Infinite map: spawn the boss just off-screen above the player rather than
    // at an absolute arena position. moveBoss then hovers it relative to the player.
    const boss = spawnBoss(
      state,
      player.x,
      player.y - VIEW_HEIGHT * 0.55,
      LAVA_FORTRESS.hp,
      LAVA_FORTRESS.radius,
    );
    boss.damage = LAVA_FORTRESS.contactDamage;
    state.bossSpawned = true;
  }
  for (const e of state.entities) {
    if (e.kind === 'boss') updateBoss(state, e, player);
  }
}

// ---------------------------------------------------------------------------
// Player auto-attack (vulcan): target nearest enemy/boss, fire a fanned volley.
// ---------------------------------------------------------------------------

function autoAttack(state: WorldState, player: Entity): void {
  const w = state.weapon;
  if (player.cooldown > 0) player.cooldown--;
  if (player.cooldown > 0) return;

  const target = nearestTarget(state, player, w.range);
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

/** Max candidates LOS-tested per aim (nearest few); bounds the wall raycast cost. */
const LOS_MAX_CANDIDATES = 6;

/**
 * Nearest hostile the vulcan can target: any enemy, boss, or supply raider.
 *
 * LOS (plan F1c): a candidate hidden behind a wall is skipped and the NEXT
 * nearest visible candidate is chosen ("filter blocked, then nearest" — not
 * "nearest, else none"). When there are no active walls this collapses to the
 * plain nearest scan (no allocation, identical to the pre-gimmick behaviour).
 */
function nearestTarget(state: WorldState, from: Entity, range: number): Entity | undefined {
  const maxD2 = range > 0 ? range * range : Infinity;

  // Fast path: no walls → nearest candidate, nothing to occlude.
  if (state.activeWalls.length === 0) {
    let best: Entity | undefined;
    let bestD = maxD2;
    for (const e of state.entities) {
      if (e.dead) continue;
      if (e.kind !== 'enemy' && e.kind !== 'boss' && e.kind !== 'supply') continue;
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

  // Collect in-range candidates, sort by distance (tie-break: entityId ascending
  // so the order never depends on the platform's sort stability), then return
  // the first whose sightline to the player is unobstructed. Only the nearest
  // LOS_MAX_CANDIDATES are ray-tested to bound cost.
  const cands: { e: Entity; d: number }[] = [];
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind !== 'enemy' && e.kind !== 'boss' && e.kind !== 'supply') continue;
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    const d = dx * dx + dy * dy;
    if (d < maxD2) cands.push({ e, d });
  }
  cands.sort((a, b) => (a.d !== b.d ? a.d - b.d : a.e.id - b.e.id));
  const k = cands.length < LOS_MAX_CANDIDATES ? cands.length : LOS_MAX_CANDIDATES;
  for (let i = 0; i < k; i++) {
    const c = cands[i];
    if (c === undefined) continue;
    if (!segmentBlocked(from.x, from.y, c.e.x, c.e.y, state.activeWalls)) return c.e;
  }
  return undefined;
}

/**
 * Advance any active turret pickups (plan F4c): each fires a friendly bullet at
 * its nearest LOS target on its cadence, reusing the vulcan targeting/bullet
 * path, until its lifetime elapses. Deterministic (position/timer only).
 */
function stepTurrets(state: WorldState, _player: Entity): void {
  for (const t of state.entities) {
    if (!isActiveTurret(t) || t.dead) continue;
    if (t.life > 0) t.life--;
    if (t.life === 0) {
      t.dead = true;
      continue;
    }
    if (t.cooldown > 0) {
      t.cooldown--;
      continue;
    }
    const target = nearestTarget(state, t, TURRET_RANGE);
    if (target === undefined) continue;
    const ang = atan2(target.y - t.y, target.x - t.x);
    spawnBullet(
      state,
      t.x,
      t.y,
      ang,
      TURRET_BULLET_SPEED,
      TURRET_BULLET_DAMAGE,
      0,
      TURRET_BULLET_RADIUS,
      TURRET_BULLET_LIFE,
      cos(ang),
      sin(ang),
    );
    t.cooldown = TURRET_FIRE_COOLDOWN;
  }
}

// ---------------------------------------------------------------------------
// Projectiles, gems & supply raiders
// ---------------------------------------------------------------------------

function stepProjectiles(state: WorldState, player: Entity): void {
  // Infinite map: there is no arena edge to despawn against. A projectile dies
  // when its lifetime elapses OR it drifts beyond the player-relative cull
  // radius. Both conditions are checked so a bullet can never accumulate
  // forever off-screen (see tests/projectiles.test.ts).
  const cullR2 = PROJECTILE_CULL_RADIUS * PROJECTILE_CULL_RADIUS;
  const walls = state.activeWalls;
  for (const e of state.entities) {
    if (e.kind !== 'bullet' && e.kind !== 'enemyBullet') continue;
    e.x += e.vx * DT;
    e.y += e.vy * DT;
    if (e.life > 0) e.life--;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (e.life === 0 || dx * dx + dy * dy > cullR2) {
      e.dead = true;
      continue;
    }
    // Both factions' bullets are stopped by walls (activeWalls direct sweep —
    // walls are never in the spatial hash). First overlap kills the bullet.
    for (const w of walls) {
      if (circleOverlapsWall(e.x, e.y, e.radius, w)) {
        e.dead = true;
        break;
      }
    }
  }
}

/** Gems drift toward the player once inside the magnet radius (deterministic). */
function stepGems(state: WorldState, player: Entity): void {
  if (state.magnetBuffTicks > 0) state.magnetBuffTicks--;
  // Magnet-emitter buff multiplies the (powerup-grown) base radius transiently.
  const r = state.magnetBuffTicks > 0 ? state.magnetRadius * MAGNET_BUFF_MULT : state.magnetRadius;
  const r2 = r * r;
  for (const e of state.entities) {
    if (e.kind !== 'gem') continue;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2 && d2 > 0.0001) {
      const d = length(dx, dy);
      e.vx = (dx / d) * MAGNET_SPEED;
      e.vy = (dy / d) * MAGNET_SPEED;
    } else {
      e.vx = 0;
      e.vy = 0;
    }
    e.x += e.vx * DT;
    e.y += e.vy * DT;
  }
}

/** Supply raiders cross the player's view; despawn when their window elapses. */
function stepSupply(state: WorldState, player: Entity): void {
  maybeSpawnSupply(state, player);
  // Despawn once the raider has passed a full off-screen span beyond the player
  // (fully crossed the view) or its time window elapses. hp stays > 0, so
  // compaction treats it as an escape (no reward).
  const despawnDist = OFFSCREEN_X + 120;
  for (const e of state.entities) {
    if (e.kind !== 'supply') continue;
    e.x += e.vx * DT;
    if (e.life > 0) e.life--;
    if (e.life === 0 || Math.abs(e.x - player.x) > despawnDist) e.dead = true;
  }
}

function maybeSpawnSupply(state: WorldState, player: Entity): void {
  const nextTick = SUPPLY_SPAWN_TICKS[state.supplyNextIndex];
  if (nextTick === undefined || state.tick < nextTick) return;
  // Infinite map: enter from an off-screen side relative to the player and cross
  // horizontally through the view.
  const fromLeft = state.supplyRng.chance(0.5);
  const y = player.y + state.supplyRng.range(-VIEW_HEIGHT * 0.3, VIEW_HEIGHT * 0.3);
  const x = player.x + (fromLeft ? -OFFSCREEN_X : OFFSCREEN_X);
  const vx = (fromLeft ? 1 : -1) * SUPPLY_SPEED;
  spawnSupply(state, x, y, vx, SUPPLY_HP, SUPPLY_LIFE_TICKS);
  state.supplyNextIndex++;
}

function stepHazards(state: WorldState): void {
  for (const e of state.entities) {
    if (e.kind !== 'hazard') continue;
    if (e.timer > 0) {
      e.timer--; // still telegraphing
    } else if (e.life > 0) {
      e.life--; // active window ticking down
      if (e.life === 0) e.dead = true;
    } else if (e.life < 0) {
      // Permanent terrain hazard (chunk-placed, plan F2): never expires. Its
      // lifetime is bounded only by chunk culling, not by this timer.
    } else {
      e.dead = true; // life === 0: expired
    }
  }
}

function hazardActive(h: Entity): boolean {
  // Damaging once its telegraph (if any) is done and it has not expired. life<0
  // marks a permanent terrain hazard (always active); life>0 a timed window.
  return h.timer <= 0 && h.life !== 0;
}

// ---------------------------------------------------------------------------
// Collision resolution (spatial hash)
// ---------------------------------------------------------------------------

function resolveCollisions(state: WorldState, player: Entity): void {
  // Reuse the per-world grid (cleared, not reallocated) — pure perf, no effect on
  // determinism since the grid is rebuilt from the entity array every tick.
  const grid = state.grid;
  grid.clear();
  // Insert everything the player or friendly bullets can interact with. Walls
  // are intentionally excluded (they can exceed a cell — handled via activeWalls).
  for (const e of state.entities) {
    if (
      e.kind === 'enemy' ||
      e.kind === 'enemyBullet' ||
      e.kind === 'hazard' ||
      e.kind === 'gem' ||
      e.kind === 'supply' ||
      e.kind === 'boss' ||
      e.kind === 'destructible' ||
      e.kind === 'magnetEmitter' ||
      e.kind === 'bombDevice' ||
      e.kind === 'turretPickup'
    ) {
      grid.insert(e);
    }
  }

  // Friendly bullets vs enemies / boss / supply raiders / destructibles.
  for (const b of state.entities) {
    if (b.kind !== 'bullet' || b.dead) continue;
    grid.query(b.x, b.y, b.radius, (t) => {
      if (b.dead || t.dead) return;
      if (t.kind !== 'enemy' && t.kind !== 'boss' && t.kind !== 'supply' && t.kind !== 'destructible')
        return;
      if (!circlesOverlap(b.x, b.y, b.radius, t.x, t.y, t.radius)) return;
      // Boss takes double damage while overheated (iframes > 0), spec.
      const mult = t.kind === 'boss' && t.iframes > 0 ? 2 : 1;
      t.hp -= b.damage * mult;
      if (t.hp <= 0) t.dead = true;
      if (b.pierce > 0) b.pierce--;
      else b.dead = true;
    });
  }

  // Player vs enemies / enemy bullets / hazards / gems / boss.
  let dmg = 0;
  const invulnerable = player.iframes > 0;
  grid.query(player.x, player.y, player.radius, (t) => {
    if (t.dead) return;
    if (!circlesOverlap(player.x, player.y, player.radius, t.x, t.y, t.radius)) return;
    if (t.kind === 'gem') {
      collectGem(state, t);
      return;
    }
    // Proximity event objects fire on contact (deterministic, no input). Consumed
    // objects are marked dead; a picked-up turret converts in place (stays alive).
    if (t.kind === 'magnetEmitter') {
      triggerMagnetEmitter(state);
      t.dead = true;
      return;
    }
    if (t.kind === 'bombDevice') {
      triggerBombDevice(state, t.x, t.y);
      t.dead = true;
      return;
    }
    if (t.kind === 'turretPickup') {
      if (t.phase === 0) activateTurret(t); // dormant → active turret in place
      return;
    }
    if (invulnerable) return;
    if (t.kind === 'enemyBullet') {
      if (t.damage > dmg) dmg = t.damage;
      t.dead = true;
    } else if (t.kind === 'enemy' || t.kind === 'boss') {
      if (t.damage > dmg) dmg = t.damage;
    } else if (t.kind === 'hazard' && hazardActive(t)) {
      if (t.damage > dmg) dmg = t.damage;
    }
    // Supply raiders never harm the player (they do not attack).
  });
  if (dmg > 0 && !invulnerable) {
    player.hp -= dmg;
    if (player.hp < 0) player.hp = 0;
    player.iframes = state.config.hitIframes;
  }
}

/** Collect a gem: bump the combo, award XP scaled by the combo multiplier. */
function collectGem(state: WorldState, gem: Entity): void {
  gem.dead = true;
  state.gems++;
  state.combo++;
  state.comboTimer = COMBO_WINDOW_TICKS;
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;
  const baseXp = gem.damage; // gem carries its XP value in `damage`
  const gained = Math.floor(baseXp * comboMultiplier(state.combo));
  state.xp += gained;
  state.xpTotal += gained;
}

// ---------------------------------------------------------------------------
// Dead-entity compaction (order-preserving; player stays at index 0).
// ---------------------------------------------------------------------------

function compact(state: WorldState): void {
  const survivors: Entity[] = [];
  const drops: { x: number; y: number; xp: number }[] = [];
  const supplyDrops: { x: number; y: number }[] = [];
  for (const e of state.entities) {
    if (!e.dead) {
      survivors.push(e);
      continue;
    }
    if (e.kind === 'enemy') {
      state.kills++;
      const def = enemyDefFor(e);
      drops.push({ x: e.x, y: e.y, xp: def?.xpValue ?? 1 });
    } else if (e.kind === 'supply' && e.hp <= 0) {
      // Shot down (vs. escaped with hp > 0): grant the raid reward.
      state.resources++;
      supplyDrops.push({ x: e.x, y: e.y });
    } else if (e.kind === 'destructible' && e.hp <= 0) {
      // Broken (vs. culled with hp > 0): drop a gem worth its stored XP value.
      drops.push({ x: e.x, y: e.y, xp: e.damage });
    } else if (e.kind === 'boss') {
      state.victory = true;
    }
  }
  state.entities = survivors;
  for (const d of drops) spawnGem(state, d.x, d.y, d.xp);
  for (const d of supplyDrops) {
    for (let i = 0; i < SUPPLY_REWARD_GEMS; i++) {
      const ang = (i * 6.283185307179586) / SUPPLY_REWARD_GEMS;
      spawnGem(state, d.x + cos(ang) * 40, d.y + sin(ang) * 40, SUPPLY_GEM_XP);
    }
  }
}

// ---------------------------------------------------------------------------
// Progression bookkeeping
// ---------------------------------------------------------------------------

function updateCombo(state: WorldState): void {
  if (state.comboTimer > 0) {
    state.comboTimer--;
    if (state.comboTimer === 0) state.combo = 0;
  }
}

/** Level up when XP crosses the threshold; opens the powerup pick (one level). */
function checkLevelUp(state: WorldState): void {
  if (state.pendingLevelUp) return;
  const need = xpToNext(state.level);
  if (state.xp < need) return;
  state.xp -= need;
  state.level++;
  state.powerupChoices = drawPowerupChoices(state, 3);
  state.pendingLevelUp = true;
}

function checkGameOver(state: WorldState, player: Entity): void {
  if (player.hp <= 0) state.gameOver = true;
}

function countKind(state: WorldState, kind: Entity['kind']): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === kind) n++;
  return n;
}
