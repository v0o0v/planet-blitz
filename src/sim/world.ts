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
import { cos, sin, atan2, length, TWO_PI, wrapAngle } from './math.js';
import { DT, VIEW_WIDTH, VIEW_HEIGHT, OFFSCREEN_X } from './constants.js';
import type { Entity } from './entities.js';
import {
  blankEntity,
  spawnBullet,
  spawnEnemyBullet,
  spawnGem,
  spawnSupply,
  spawnBoss,
  spawnWall,
  spawnDestructible,
  spawnEventObject,
  spawnLoot,
} from './entities.js';
import type { AnomalyState } from './anomaly.js';
import { rollAnomaly, enemyBulletSpeedMult } from './anomaly.js';
import {
  isElite,
  eliteAffix,
  eliteSpeedMult,
  eliteDamageTakenMult,
  applyEliteRegen,
  spawnEliteDeathFx,
  ELITE_SPLIT,
  ELITE_VOLATILE,
} from './elite.js';
import { rollEliteDrop, rollBossDrop } from './drops.js';
import {
  hasUnique,
  overheatCooldown,
  UQ_OVERHEAT_DRUM,
  UQ_SPLIT_CORE,
  UQ_PIERCE_GYRO,
  UQ_DRONE_BAY,
  UQ_PHASE_ARMOR,
  OVERHEAT_MAX_STACK,
  GYRO_DAMAGE_AMP,
  SPLIT_FRAGMENTS,
  SPLIT_SPREAD,
  SPLIT_FRAGMENT_SPEED,
  SPLIT_FRAGMENT_LIFE,
  SPLIT_FRAGMENT_RADIUS,
  SPLIT_FRAGMENT_MARK,
  DRONE_INTERVAL,
  DRONE_SPAWN_OFFSET,
  DRONE_MARK,
  PHASE_ARMOR_BONUS_IFRAMES,
  PHASE_ARMOR_DASH_CD_MULT,
  UQ_SINGULARITY,
  UQ_REACTIVE_ARMOR,
  UQ_PHASE_MEMBRANE,
  UQ_AFTERIMAGE,
  UQ_GREED_HEART,
  UQ_RELIC_AMP,
  UQ_HIVE_SWARM,
  UQ_CONVERGE_PRISM,
  UQ_TWIN_STAR,
  UQ_GAMBLER_CHIP,
  HIVE_MICRO_COUNT,
  HIVE_MICRO_SPEED,
  HIVE_MICRO_LIFE,
  HIVE_MICRO_RADIUS,
  HIVE_MICRO_DAMAGE_FRAC,
  HIVE_MICRO_MARK,
  PRISM_DAMAGE_AMP,
  TWIN_STAR_DAMAGE_MULT,
  GAMBLER_EXTRA_CHOICES,
  SINGULARITY_RADIUS,
  SINGULARITY_PULL_SPEED,
  REACTIVE_PULSE_COUNT,
  REACTIVE_PULSE_SPEED,
  REACTIVE_PULSE_DAMAGE,
  REACTIVE_PULSE_RADIUS,
  REACTIVE_PULSE_LIFE,
  PHASE_MEMBRANE_HP_FRAC,
  PHASE_MEMBRANE_COOLDOWN,
  PHASE_MEMBRANE_HEAL_FRAC,
  GREED_COMBO_BONUS_TICKS,
  GREED_MAGNET_STEP,
  GREED_MAGNET_CAP,
  RELIC_XP_MULT,
  AFTERIMAGE_RADIUS,
} from './uniques.js';
import { SpatialHash, circlesOverlap } from './collision.js';
import { updateEnemy } from './patterns/index.js';
import { updateBoss } from './boss.js';
import { drawPowerupChoices, applyPowerup } from './powerups.js';
import type { WaveRuntime } from './waves.js';
import { createWaveRuntime, updateWaves, enemyDefFor } from './waves.js';
import { planetContent } from '../../data/planets/index.js';
import {
  CHUNK_SIZE,
  CHUNK_GEN_RADIUS,
  CHUNK_CULL_RADIUS,
  MAX_ACTIVE_GIMMICKS,
  chunkPlacements,
} from './chunks.js';
import { circleOverlapsWall, slideCircleWalls, segmentBlocked } from './los.js';
import { HAZARD_SLOW } from './patterns/types.js';
import { stepEnemyBulletBehavior, BK_NONE, type BulletSplit } from './bullets.js';
import {
  applyBurn,
  applySlow,
  tickEnemyStatus,
  applyChain,
  enemyStatusSlowMult,
  PLAYER_SLOW_MULT,
  PLAYER_SLOW_DURATION,
  FIRE_DURATION,
  COLD_DURATION,
} from './status.js';
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
import type { InvasionConfig } from './defense.js';
import { spawnInvasionLayout, stepDefenseTurrets, stepGuardians } from './defense.js';

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

/**
 * 판정점 반지름(ADR-0010): 플레이어 피격 판정에 쓰는, 기체 반지름(32)보다 훨씬 작은
 * 중심 원. 적탄·적 접촉·해저드 피해와 감속 장판 판정에만 쓴다. 젬·전리품·기믹 픽업 등
 * 이로운 접촉은 여전히 관대한 기체 반지름(player.radius)으로 판정한다. 화면에 표시하지
 * 않는다 — 관대한 회피를 명시적 UI 없이 체감으로 전달(억울한 피격 대신 "아슬아슬").
 * 이 값이 작아야 고밀도 탄막(보스·엘리트)이 공정해지므로 탄 수를 공격적으로 올릴 수 있다.
 */
export const PLAYER_HIT_RADIUS = 8;

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
  /**
   * Primary weapon firing archetype (M2 plan B2): 0 = 발칸 (fanned volley), 1 =
   * 스프레드 (wide multi-pellet), 2 = 레일건 (single fast piercing shot). Seeded
   * from the equipped main weapon's loadout; drives the autoAttack branch.
   */
  weaponType: number;
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
  weaponType: 0,
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

/**
 * Loadout-derived stat block (M2 plan A4/B1). Produced OUTSIDE the sim by
 * `computeLoadoutStats` (src/items/loadout.ts) and injected via WorldConfig so
 * the sim never imports the item layer. Applied once at createWorld; carried in
 * `Replay.config` and folded into the state hash so the verification server
 * reproduces the exact run. All fields are plain deterministic numbers.
 */
export interface LoadoutConfig {
  /** Main weapon archetype (mirrors WeaponStats.weaponType). */
  weaponType: number;
  /** Sub weapon variant: -1 none, else 0.. (drives the independent subWeapon fire). */
  subWeaponType: number;
  damageMult: number;
  /** Fire-cooldown multiplier (< 1 faster, > 1 slower). */
  fireRateMult: number;
  bulletCountAdd: number;
  pierceAdd: number;
  bulletSpeedMult: number;
  /** Extra fan angle (radians) added to the base spread. */
  spreadAdd: number;
  rangeAdd: number;
  moveSpeedMult: number;
  maxHpAdd: number;
  /** Dash-cooldown multiplier (< 1 = recharges faster). */
  dashCdMult: number;
  magnetMult: number;
  /** XP-gain multiplier (affix 경험치+%). */
  xpMult: number;
  /** Bitmask of active unique effects (Lane 3 hooks). */
  uniqueMask: number;
  // --- M3 원소 어픽스(상태이상) 파생 (plan B4, AC6; APPEND-ONLY) ---
  /** 화염 어픽스 총합 → 명중 시 적에게 거는 지속피해 틱당 피해(정수, 0 = 없음). */
  fireDmg: number;
  /** 냉기 어픽스 총합 → 명중 시 적 감속 부여 강도(> 0 = 감속 활성). */
  coldSlow: number;
  /** 전격 어픽스 총합 → 명중 시 인접 적 연쇄 피해(정수, 0 = 없음). */
  lightning: number;
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
  // --- M2 farming loop (all optional; absent = M1 behaviour) ---
  /** Source planet index (0 = 카르곤, 1 = 베르단). Stamped onto drops. */
  planet?: number;
  /** Difficulty tier (0 = 정찰, 1 = 교전). Gates elite affixes + drop odds. */
  tier?: number;
  /** Player accepted the offered anomaly (OQ-M2-3 pre-run flag). */
  anomalyAccepted?: boolean;
  /** Loadout-derived stats; absent = neutral (no equipment). */
  loadout?: LoadoutConfig;
  /**
   * Skill investment snapshot (M3 plan A2). The 60-length vector is already
   * folded into `loadout` at config-build time, so it does not re-apply to the
   * sim; it is carried for the verification server (Replay.config) and read by
   * the powerup-pool soft weighting (C2, drawPowerupChoices). Absent = no skills.
   */
  skillInvest?: number[];
  /**
   * 튜토리얼 단축판(M3 후속): 보스 이전 일반 세그먼트 수 상한. 이 수만큼 일반
   * 세그먼트를 소화하면 곧장 보스 세그먼트로 점프한다. absent = 풀 런(거동 불변).
   * append-only 규율: WorldConfig 신규 필드는 항상 이 아래에만 추가.
   */
  maxSegments?: number;
  /**
   * 침공 런 설정(M4 plan Phase C2, 갈림길③A). 존재하면 침공 런: createWorld가 방어 배치
   * (코어·포탑 6종·장애물)를 정적 스폰하고, 웨이브·청크 기믹·보급 등 절차 생성 시스템을
   * 끈다. 승리 = 코어 파괴, 실패 = 제한 시간 초과/격추. absent = 기존 PvE 런(거동·해시
   * 100% 불변). append-only 규율: 신규 필드는 항상 이 아래에만 추가.
   */
  invasion?: InvasionConfig;
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

/** A single collected loot drop (drop seed + rarity code + provenance). */
export interface LootRecord {
  /** Drop seed the item is rolled from (rollItem). */
  seed: number;
  /** Rarity code (0 normal .. 3 unique). */
  rarity: number;
  /** Source planet index (from config). */
  planet: number;
  /** Source tier index (from config). */
  tier: number;
}

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
  /** Drop-determination stream (rng.fork('drops')) — elite/boss loot rarity+seed. */
  dropRng: SeededRng;
  /** Elite-affix stream (rng.fork('elite'), OQ-M2-4) — independent of wave draws. */
  eliteRng: SeededRng;
  /**
   * Anomaly stream (rng.fork('anomaly')). Advanced ONCE at creation to roll the
   * offer; its resting state is folded into the hash for symmetry.
   */
  anomalyRng: SeededRng;
  /** Resolved run anomaly (offer + acceptance). */
  anomaly: AnomalyState;
  /**
   * Loot picked up this run (drop seed + rarity + source). Consumed at settlement
   * (Lane 2) where `rollItem` confirms each item. Folded into the hash so replay
   * verification sees the same collected sequence.
   */
  loot: LootRecord[];
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
  /**
   * 플레이어 감속 잔여 틱(니플헤임 유령 기함 '감속 지대', plan B1). > 0인 동안 이동
   * 속도에 PLAYER_SLOW_MULT를 곱한다. 결정론 스칼라 — hashWorld에 append-only로 접힌다.
   */
  playerSlowTicks: number;
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
  generatedChunks: Map<string, true>;
  /**
   * Active cover walls, rebuilt every tick in entity-array order (same
   * determinism discipline as the grid). Walls are NOT inserted into the spatial
   * hash — they can exceed a cell, so movement/bullet/LOS checks iterate this
   * array directly. Scratch — not hashed (the wall entities themselves are).
   */
  activeWalls: Entity[];
  /**
   * 오염 런 표시(ADR-0008). 치트·하네스 개입이 한 번이라도 일어난 런에 `markTainted`로
   * 세운다. 순수 DEV 메타데이터 — 시뮬레이션 거동과 `hashWorld` 출력 모두에 영향이 없다
   * (hashWorld는 이 필드를 접지 않는다). 정산·리플레이 제출에서 오염 런을 제외하는 데만
   * 쓰인다.
   */
  tainted: boolean;
}

/**
 * 현재 런을 오염 런으로 표시한다(ADR-0008). 치트나 하네스 개입이 감지되면 호출한다.
 * 시뮬레이션 상태·해시에는 영향이 없고, 정산/리플레이 제출 경로에서만 이 플래그를 읽는다.
 */
export function markTainted(world: WorldState): void {
  world.tainted = true;
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

  // Loadout-derived stats (plan B1): apply once here so the run starts strengthened
  // and the effect is captured in the initial weapon/config/player/magnet — all of
  // which are already hashed. The loadout block itself is folded into the hash too.
  const weapon: WeaponStats = { ...DEFAULT_WEAPON };
  let magnetRadius = BASE_MAGNET_RADIUS;
  const lo = cfg.loadout;
  if (lo !== undefined) {
    weapon.weaponType = lo.weaponType;
    weapon.damage = Math.round(weapon.damage * lo.damageMult * 100) / 100;
    weapon.fireCooldown = Math.max(2, Math.round(weapon.fireCooldown * lo.fireRateMult));
    weapon.bulletCount += lo.bulletCountAdd;
    weapon.pierce += lo.pierceAdd;
    weapon.bulletSpeed = Math.round(weapon.bulletSpeed * lo.bulletSpeedMult * 100) / 100;
    weapon.spread += lo.spreadAdd;
    weapon.range += lo.rangeAdd;
    cfg.playerSpeed = Math.round(cfg.playerSpeed * lo.moveSpeedMult);
    cfg.dashCooldownTicks = Math.max(12, Math.round(cfg.dashCooldownTicks * lo.dashCdMult));
    cfg.playerHp += lo.maxHpAdd;
    magnetRadius = Math.round(magnetRadius * lo.magnetMult);
  }

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

  // 침공 런(M4 plan C2, 갈림길③A): 방어 배치를 정적 스폰(코어 → 포탑 → 장애물). 순수 데이터
  // 구동이라 재현이 자명하다. player가 index 0에 자리한 뒤 스폰해 hashWorld 불변식을 지킨다.
  // sink로 지역 entities/nextEntityId를 넘겨 id 할당을 위임하고, 소비된 nextEntityId를 회수한다.
  if (cfg.invasion !== undefined) {
    const sink = { entities, nextEntityId };
    spawnInvasionLayout(sink, cfg.invasion.layout, cfg.invasion.maintenance);
    nextEntityId = sink.nextEntityId;
  }

  // Anomaly: roll the seed-only offer, gate it on the config acceptance flag.
  const anomalyRng = rng.fork('anomaly');
  const anomaly = rollAnomaly(anomalyRng, cfg.anomalyAccepted ?? false);

  return {
    tick: 0,
    config: cfg,
    rng,
    waveRng: rng.fork('waves'),
    powerupRng: rng.fork('powerups'),
    supplyRng: rng.fork('supply'),
    worldRng: rng.fork('world'),
    dropRng: rng.fork('drops'),
    eliteRng: rng.fork('elite'),
    anomalyRng,
    anomaly,
    loot: [],
    weapon,
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
    magnetRadius,
    magnetBuffTicks: 0,
    playerSlowTicks: 0,
    resources: 0,
    pendingLevelUp: false,
    powerupChoices: [],
    supplyNextIndex: 0,
    bossSpawned: false,
    gameOver: false,
    victory: false,
    grid: new SpatialHash<Entity>(GRID_CELL_SIZE),
    generatedChunks: new Map<string, true>(),
    activeWalls: [],
    tainted: false,
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

  // 침공 런(M4 plan C2)은 설계된 방어 기지만 상대한다 — 절차 생성 시스템(청크 기믹·웨이브
  // 적·보급 습격)을 끈다. 정적 배치 장애물(wall)이 청크 컬링에 잘려나가지 않게 하는 것도
  // 겸한다(activateChunks 미실행). rebuildActiveWalls는 방어 장애물이 wall kind라 유지한다.
  const invasion = state.config.invasion;

  // Materialise/cull scroll-map gimmicks around the player, then rebuild the
  // active-wall list (both before movement so walls obstruct this tick).
  if (invasion === undefined) activateChunks(state, player);
  rebuildActiveWalls(state);

  stepPlayer(state, player, input);
  if (invasion === undefined) updateWaves(state, player);
  stepEnemies(state, player);
  stepBoss(state, player);
  autoAttack(state, player);
  subWeapon(state, player);
  droneBay(state, player);
  stepTurrets(state, player);
  if (invasion !== undefined) stepDefenseTurrets(state, player);
  // 수호 기체(M5 plan A1): 방어전에서만 추적·사격. 수호 없으면 조기 반환(거동·해시 불변).
  if (invasion !== undefined) stepGuardians(state, player);
  stepProjectiles(state, player);
  stepGems(state, player);
  if (invasion === undefined) stepSupply(state, player);
  stepHazards(state);
  resolveCollisions(state, player);
  compact(state);
  updateCombo(state);
  checkLevelUp(state);
  checkGameOver(state, player);
  // 침공 제한 시간(3분): 코어 미파괴로 시간 초과 시 격추와 동일하게 패배(gameOver).
  if (invasion !== undefined) checkInvasionTimeout(state, invasion);

  state.tick++;
}

/**
 * 침공 제한 시간 판정(M4 plan C2). 코어 파괴(victory)가 이미 확정됐으면 무시한다. 현재 틱
 * 처리를 끝내며 누적 틱 수가 제한(timeLimitTicks)에 도달하면 gameOver로 확정한다. 결정론:
 * state.tick(해시 포함)과 config의 제한 틱(해시 포함)만으로 판정 — wall-clock 미사용.
 */
function checkInvasionTimeout(state: WorldState, invasion: InvasionConfig): void {
  if (state.victory || state.gameOver) return;
  // 이 시점 state.tick은 아직 증가 전(현재 틱 인덱스). 이 틱을 끝내면 tick+1개를 소화한 것.
  if (state.tick + 1 >= invasion.timeLimitTicks) state.gameOver = true;
}

// ---------------------------------------------------------------------------
// Scroll-map chunks (deterministic procedural gimmicks)
// ---------------------------------------------------------------------------

/** True for any chunk-placed gimmick entity (terrain hazards are gimmicks only
 *  when permanent — life < 0 — so enemy mortar/lava hazards are never culled).
 *  드론 베이가 소환한 유니크 포탑(ownerId === DRONE_MARK)은 청크 기믹이 아니라
 *  플레이어 소환물이므로 제외한다 — MAX_ACTIVE_GIMMICKS 카운트·청크 컬링을 받지 않고
 *  TURRET_LIFE_TICKS 수명만 따른다. */
function isGimmick(e: Entity): boolean {
  return (
    e.kind === 'wall' ||
    e.kind === 'destructible' ||
    e.kind === 'magnetEmitter' ||
    e.kind === 'bombDevice' ||
    (e.kind === 'turretPickup' && e.ownerId !== DRONE_MARK) ||
    (e.kind === 'hazard' && e.life < 0)
  );
}

/** Loss-free chunk identity key. SpatialHash-style uint32 mixing is fine for
 *  broad-phase (collisions get re-checked) but here the key IS the chunk's
 *  identity — a collision would silently mark a distinct chunk as generated
 *  and drop its gimmicks, so use the exact coordinate pair. */
function chunkKey(cx: number, cy: number): string {
  return cx + ',' + cy;
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
      // Chunks are atomic: spawn a chunk's placements all-or-nothing so the
      // live gimmick set of a generated chunk is always the full pure-function
      // layout (AC3 path independence). If the cap can't fit the whole chunk,
      // defer it — marker stays unset and generation retries next tick.
      const placements = chunkPlacements(state.worldRng, cx, cy);
      if (activeGimmicks + placements.length > MAX_ACTIVE_GIMMICKS) continue;
      for (const g of placements) {
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
  //
  // 불변식(암묵 가정): 이 스캔 박스는 "1틱 이동량 ≪ CHUNK_SIZE"를 전제로 현재
  // 플레이어 청크 주변만 훑는다. 한 틱에 스캔 박스 폭보다 멀리 이동하면 컬 반경 밖
  // marker가 스캔에서 누락돼 잔존할 수 있다. 최대 1틱 이동(dashSpeed 임펄스 + 기본
  // 속도, DT=1/60)은 CHUNK_SIZE(1024)의 수십 분의 1 수준이라 안전하며, 여기에
  // 여유 +1 청크(총 +2)를 더해 경계 청크까지 확실히 커버한다. dashSpeed·CHUNK_SIZE
  // 변경 시 이 여유가 여전히 1틱 이동을 덮는지 재확인할 것. 여유 확대는 스캔 순서
  // (cy 외곽·cx 내곽 고정)와 marker 삭제(위치만의 함수)를 바꾸지 않아 결정론 불변.
  const cullChunkR = Math.ceil(CHUNK_CULL_RADIUS / CHUNK_SIZE) + 2;
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
  // 감속 지대(plan B1): 잔여 틱 동안 이동 속도를 배율로 낮춘다(대시 임펄스에는
  // 미적용 — 아래 dash는 별도 가산). 매 틱 1 감소.
  const slowMult = state.playerSlowTicks > 0 ? PLAYER_SLOW_MULT : 1;
  if (state.playerSlowTicks > 0) state.playerSlowTicks--;
  player.vx = mx * config.playerSpeed * slowMult;
  player.vy = my * config.playerSpeed * slowMult;
  player.angle = input.aim;

  if (player.dashCooldown > 0) player.dashCooldown--;
  if (player.iframes > 0) player.iframes--;
  // ⑩ 위상 전환막 내부 쿨다운(plan B4): player.targetY에 카운트다운으로 실어 매 틱 감소
  // (신규 필드 없이 관리; 미장착 시 항상 0이라 거동 불변).
  if (player.targetY > 0) player.targetY--;

  if (input.dash && player.dashCooldown === 0) {
    let dx = mx;
    let dy = my;
    if (length(dx, dy) < 0.001) {
      dx = cos(player.angle);
      dy = sin(player.angle);
    }
    player.vx += dx * config.dashSpeed;
    player.vy += dy * config.dashSpeed;
    // ⑤ 위상 장갑: 대시 직후 무적 프레임 연장 + 대시 쿨다운 감소(장착 시).
    const mask = config.loadout?.uniqueMask ?? 0;
    if (hasUnique(mask, UQ_PHASE_ARMOR)) {
      player.dashCooldown = Math.round(config.dashCooldownTicks * PHASE_ARMOR_DASH_CD_MULT);
      player.iframes = config.dashIframes + PHASE_ARMOR_BONUS_IFRAMES;
    } else {
      player.dashCooldown = config.dashCooldownTicks;
      player.iframes = config.dashIframes;
    }
    // ⑪ 잔상 추진기: 대시 순간 주변 적탄 소거(장착 시).
    if (hasUnique(mask, UQ_AFTERIMAGE)) {
      for (const t of state.entities) {
        if (t.kind !== 'enemyBullet' || t.dead) continue;
        const ex = t.x - player.x;
        const ey = t.y - player.y;
        if (ex * ex + ey * ey <= AFTERIMAGE_RADIUS * AFTERIMAGE_RADIUS) t.dead = true;
      }
    }
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
  // ⑧ 특이점 발생기(plan B4): 장착 시 반경 안 적을 매 틱 플레이어 쪽으로 흡인. 미장착
  // 이면 no-op.
  const singularityOn = hasUnique(state.config.loadout?.uniqueMask ?? 0, UQ_SINGULARITY);
  const enemies: Entity[] = [];
  for (const e of state.entities) if (e.kind === 'enemy') enemies.push(e);
  for (const e of enemies) {
    // 원소 상태이상 진행(화염 지속피해·냉기/전격 타이머). 상태이상 없는 적은 세 재활용
    // 필드가 모두 0이라 no-op(거동 불변). 화염으로 처치되면 dead 표시 후 스킵.
    tickEnemyStatus(e);
    if (e.dead) continue;
    // 재생하는 엘리트: 매 틱 HP 회복(그 외 no-op).
    applyEliteRegen(e);
    let def = enemyDefFor(e);
    if (def === undefined) continue;
    // 가속하는 elite(×1.6) × 냉기 감속(<1)을 곱해 이동 속도를 조정한다(공유 데이터
    // 행은 절대 변형하지 않고 def를 복제). 둘 다 없으면 mult 1(거동 불변).
    const sm = eliteSpeedMult(e) * enemyStatusSlowMult(e);
    if (sm !== 1) def = { ...def, speed: def.speed * sm };
    updateEnemy(state, e, def, player);
    if (singularityOn) applySingularityPull(e, player);
  }
}

/** ⑧ 특이점 발생기: 반경 안 적을 플레이어 쪽으로 결정론적으로 당긴다(RNG 미소비). */
function applySingularityPull(e: Entity, player: Entity): void {
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const d = length(dx, dy);
  if (d <= 1 || d >= SINGULARITY_RADIUS) return;
  const step = Math.min(SINGULARITY_PULL_SPEED * DT, d);
  e.x += (dx / d) * step;
  e.y += (dy / d) * step;
}

// ---------------------------------------------------------------------------
// Boss (spawned once the wave director reaches the boss segment).
// ---------------------------------------------------------------------------

function stepBoss(state: WorldState, player: Entity): void {
  if (state.wave.boss && !state.bossSpawned) {
    // Infinite map: spawn the boss just off-screen above the player rather than
    // at an absolute arena position. moveBoss then hovers it relative to the player.
    // 행성별 보스 선택(카르곤 용암 요새 / 베르단 여왕). enemyType에 행성 인덱스를
    // 태깅해 렌더가 보스 스프라이트를 분화할 수 있게 한다(카르곤=0 유지 → 해시 불변).
    const bossDef = planetContent(state.config.planet).boss;
    const boss = spawnBoss(
      state,
      player.x,
      player.y - VIEW_HEIGHT * 0.55,
      bossDef.hp,
      bossDef.radius,
    );
    boss.damage = bossDef.contactDamage;
    boss.enemyType = state.config.planet ?? 0;
    state.bossSpawned = true;
  }
  for (const e of state.entities) {
    if (e.kind === 'boss') updateBoss(state, e, player);
  }
}

// ---------------------------------------------------------------------------
// Player auto-attack (vulcan): target nearest enemy/boss, fire a fanned volley.
// ---------------------------------------------------------------------------

/** Weapon archetype codes (shared with src/items/loadout.ts). */
const WEAPON_TYPE_SPREAD = 1;
const WEAPON_TYPE_RAILGUN = 2;
const WEAPON_TYPE_MISSILE = 3;
const WEAPON_TYPE_BEAM = 4;

/**
 * Homing-missile marker on a friendly bullet's `ownerId` (already hashed). A
 * bullet carrying it re-steers toward the nearest target each tick in
 * stepProjectiles, clamped to MISSILE_TURN_RATE (limited turn — OQ-M3-4). Chosen
 * distinct from SPLIT_FRAGMENT_MARK / DRONE_MARK so the marks never alias. */
const MISSILE_MARK = 0x3155110;
/** Max radians a missile turns toward its target per tick (evadable, GDD §10). */
const MISSILE_TURN_RATE = 0.09;
/** Beam segment count cap and spacing (매틱 짧은 수명 세그먼트 판정 — OQ-M3-3). */
const BEAM_MAX_SEGMENTS = 16;
const BEAM_SEGMENT_SPACING = 90;
/** Beam segment radius (tiles the line with slight overlap for a continuous hit). */
const BEAM_SEGMENT_RADIUS = 52;
/** Beam segment lifetime (ticks): a brief static hit line, re-laid each fire. */
const BEAM_SEGMENT_LIFE = 2;
/** Beam range used when the weapon's range is unbounded (0). */
const BEAM_DEFAULT_RANGE = 1200;

function autoAttack(state: WorldState, player: Entity): void {
  const w = state.weapon;
  if (player.cooldown > 0) player.cooldown--;
  if (player.cooldown > 0) return;

  const target = nearestTarget(state, player, w.range);
  if (target === undefined) return;

  // ① 과열 드럼: 연속 명중 스택(player.phase)만큼 발사 쿨다운 단축. 미장착 시
  //    스택은 항상 0이라 base 그대로(거동 불변).
  const mask = state.config.loadout?.uniqueMask ?? 0;
  const fireCd = hasUnique(mask, UQ_OVERHEAT_DRUM)
    ? overheatCooldown(w.fireCooldown, player.phase)
    : w.fireCooldown;

  const baseAngle = atan2(target.y - player.y, target.x - player.x);
  // Firing archetypes off `weaponType` (M2 B2 + M3 C1):
  //   2 = 레일건: one shot straight at the target (pierce/speed do the work).
  //   3 = 미사일: `bulletCount` homing missiles — slow, hard, limited turn.
  //   4 = 빔: a line of short-life static segments covering the aim (매틱 판정).
  //   0/1 = 발칸 / 스프레드: fanned volley (differ only by loadout baseline).
  if (w.weaponType === WEAPON_TYPE_RAILGUN) {
    spawnBullet(
      state,
      player.x,
      player.y,
      baseAngle,
      w.bulletSpeed,
      w.damage,
      w.pierce,
      w.bulletRadius,
      w.bulletLife,
      cos(baseAngle),
      sin(baseAngle),
    );
    player.cooldown = fireCd;
    return;
  }

  if (w.weaponType === WEAPON_TYPE_MISSILE) {
    const n = w.bulletCount < 1 ? 1 : w.bulletCount;
    const start = n > 1 ? baseAngle - w.spread / 2 : baseAngle;
    const stepA = n > 1 ? w.spread / (n - 1) : 0;
    for (let i = 0; i < n; i++) {
      const ang = start + stepA * i;
      const m = spawnBullet(
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
      m.ownerId = MISSILE_MARK; // 유도 마커: stepProjectiles가 매 틱 제한 선회.
    }
    player.cooldown = fireCd;
    return;
  }

  if (w.weaponType === WEAPON_TYPE_BEAM) {
    const range = w.range > 0 ? w.range : BEAM_DEFAULT_RANGE;
    let segs = Math.floor(range / BEAM_SEGMENT_SPACING);
    if (segs < 1) segs = 1;
    if (segs > BEAM_MAX_SEGMENTS) segs = BEAM_MAX_SEGMENTS;
    const ca = cos(baseAngle);
    const sa = sin(baseAngle);
    for (let i = 1; i <= segs; i++) {
      const dist = i * BEAM_SEGMENT_SPACING;
      // Static segment (speed 0): a brief hit point along the beam line. High
      // pierce so it damages every enemy overlapping it; short life re-laid each
      // fire so a fast cadence reads as a continuous line.
      spawnBullet(
        state,
        player.x + ca * dist,
        player.y + sa * dist,
        baseAngle,
        0,
        w.damage,
        9999,
        BEAM_SEGMENT_RADIUS,
        BEAM_SEGMENT_LIFE,
        ca,
        sa,
      );
    }
    player.cooldown = fireCd;
    return;
  }

  // ⑦ 쌍둥이 항성: 부채꼴 발사체 2배 + 발당 피해 ×TWIN_STAR_DAMAGE_MULT. 미장착 시
  //    n·dmg 그대로(거동 불변). 스프레드(weaponType 1) 파생 유니크이므로 스프레드
  //    무기에서만 발화(리뷰 MED-1 이중 게이트 — roll.ts 페어링과 정합). 발칸 등 타
  //    무기에 롤될 수 없고, 설령 실려도 no-op.
  const twinOn = hasUnique(mask, UQ_TWIN_STAR) && w.weaponType === WEAPON_TYPE_SPREAD;
  const n = twinOn ? w.bulletCount * 2 : w.bulletCount;
  const dmg = twinOn ? w.damage * TWIN_STAR_DAMAGE_MULT : w.damage;
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
      dmg,
      w.pierce,
      w.bulletRadius,
      w.bulletLife,
      cos(ang),
      sin(ang),
    );
  }
  player.cooldown = fireCd;
}

// --- Sub-weapon 5종 (M2 plan B2, OQ-M2-2: 독립 발사 슬롯; GDD §5 "보조무기 5종") ------
//
// 보조무기는 주무기(autoAttack)와 완전히 분리된 자기 사이클로 동작한다. 사이클 카운트다운은
// 플레이어의 미사용 `timer` 필드(이미 해시됨)에 실어 신규 WorldState 필드·해시 스키마 변경
// 없이 결정론을 유지한다. 미장착(subWeaponType === SUB_WEAPON_NONE = -1)이면 즉시 반환 →
// 기존 PvE 런과 비트 동일(거동·해시 불변). 5종은 확실히 다른 플레이 감각을 목표로 한다:
//   0 사이드킥  — 빠른 연사 단발 볼트(근접 자동 조준). 꾸준한 보조 DPS.
//   1 스캐터    — 3발 광각 산탄(짧은 사거리). 근거리 다수 제압.
//   2 기뢰장    — 플레이어 위치에 설치형 지속 피해 장판(정지 발사체·긴 수명·넓은 반경).
//   3 센트리    — 주기적으로 임시 자동 포탑 배치(독립 자동 사격). 자율 드론 베이 로직 재사용.
//   4 호밍 플레어 — 유도 미사일(제한 선회). 느린 연사·강한 단발.
//
// 렌더 구분(요구 #4): 보조무기가 직접 쏘는 발사체는 blankEntity의 기본 enemyType(-1) 대신
// 자기 타입 코드(0..4)를 실어 스폰한다. sim은 friendly bullet의 enemyType을 읽지 않으므로
// (오직 ownerId만 유도 마커로 사용) 순수 렌더 태그다 — entityRenderer가 이 코드로 색을
// 구분한다. 센트리(3)의 포탑탄은 stepTurrets가 표준 포탑탄으로 쏘므로 기본 렌더.
//
// 어픽스 상호작용(요구 #5): 데미지·연사 어픽스는 주무기와 동일한 배율(loadout.damageMult /
// fireRateMult)을 보조무기의 직접 발사체(사이드킥·스캐터·기뢰·플레어)에 그대로 공유한다.
// 센트리(3)가 배치하는 포탑은 자율 드론 베이와 동일하게 고정 스탯 포탑이다(포탑탄은 별도
// 시스템 stepTurrets가 관리) — 문서화된 예외.

/** 보조무기 타입 코드(loadout.ts SUB_* 상수와 동일 — friendly bullet 렌더 태그로도 사용). */
const SUB_TYPE_SIDEKICK = 0;
const SUB_TYPE_SCATTER = 1;
const SUB_TYPE_MINE = 2;
const SUB_TYPE_SENTRY = 3;
const SUB_TYPE_FLARE = 4;

// 사이드킥(0): 빠른 단발.
const SUB_SIDEKICK_COOLDOWN = 18;
const SUB_SIDEKICK_DAMAGE = 6;
const SUB_SIDEKICK_SPEED = 1600;
const SUB_SIDEKICK_RADIUS = 5;
const SUB_SIDEKICK_LIFE = 60;
const SUB_SIDEKICK_RANGE = 900;

// 스캐터(1): 3발 광각 산탄, 짧은 사거리, 중간 쿨다운.
const SUB_SCATTER_COOLDOWN = 33;
const SUB_SCATTER_DAMAGE = 4;
const SUB_SCATTER_SPEED = 1400;
const SUB_SCATTER_RADIUS = 5;
const SUB_SCATTER_LIFE = 38;
const SUB_SCATTER_RANGE = 620;
const SUB_SCATTER_PELLETS = 3;
/** 총 부채꼴 각(라디안). */
const SUB_SCATTER_SPREAD = 0.52;

// 기뢰장(2): 플레이어 위치에 정지 발사체(속도 0)를 설치. 긴 수명·넓은 반경 동안 위로
// 지나가는 적에게 매 틱 피해를 주되, 관통 예산이 소진되면 소멸(장판 총 피해 상한). 조준
// 대상 없이도 설치(선제 지역 거부). 빔 세그먼트(정지 발사체) 판정 경로를 그대로 재사용.
const SUB_MINE_COOLDOWN = 66;
const SUB_MINE_DAMAGE = 3;
const SUB_MINE_RADIUS = 64;
const SUB_MINE_LIFE = 150;
/** 장판이 흡수하는 총 명중 횟수(적×틱). 소진 시 즉시 소멸 → 총 피해 상한. */
const SUB_MINE_PIERCE = 40;

// 센트리(3): 임시 자동 포탑 주기 배치(자율 드론 베이 재사용). 조준 대상 없이도 배치.
const SUB_SENTRY_COOLDOWN = 300;
/** 배치 오프셋(플레이어 옆). 드론 베이와 동일 상수 재사용(DRONE_SPAWN_OFFSET). */

// 호밍 플레어(4): 유도 미사일. 느린 연사·강한 단발. MISSILE_MARK로 stepProjectiles가 매 틱
// 제한 선회. 탄속을 낮춰 곡선 추적이 눈에 보이게 한다.
const SUB_FLARE_COOLDOWN = 45;
const SUB_FLARE_DAMAGE = 14;
const SUB_FLARE_SPEED = 1000;
const SUB_FLARE_RADIUS = 6;
const SUB_FLARE_LIFE = 95;
const SUB_FLARE_RANGE = 950;

/** 보조무기 직접 발사체에 주무기와 공유하는 데미지 배율 적용(요구 #5). 주무기와 동일한
 *  반올림(소수 2자리)으로 결정론·플랫폼 불변 유지. */
function subDamage(state: WorldState, base: number): number {
  const mult = state.config.loadout?.damageMult ?? 1;
  return Math.round(base * mult * 100) / 100;
}

/** 보조무기 사이클 쿨다운에 주무기와 공유하는 연사 배율 적용(요구 #5). 최소 2틱 하한
 *  (주무기 fireCooldown 하한과 정합). */
function subCooldown(state: WorldState, base: number): number {
  const mult = state.config.loadout?.fireRateMult ?? 1;
  const cd = Math.round(base * mult);
  return cd < 2 ? 2 : cd;
}

/**
 * 독립 보조무기 발사(plan B2 / OQ-M2-2). 자기 사이클(player.timer)로 주무기 쿨다운과
 * 경쟁하지 않는다. subWeaponType 0..4로 분기, -1(미장착)은 no-op(거동·해시 불변).
 */
function subWeapon(state: WorldState, player: Entity): void {
  const subType = state.config.loadout?.subWeaponType ?? -1;
  if (subType < 0) return;
  if (player.timer > 0) {
    player.timer--;
    return;
  }

  // 기뢰장·센트리는 조준 대상 없이 선제 설치(지역 거부·자율 사격). 나머지는 최근접 적을
  // 조준하며, 대상이 없으면 사이클을 소비하지 않고 대기(timer 유지 = 즉시 발사 준비).
  if (subType === SUB_TYPE_MINE) {
    const mine = spawnBullet(
      state,
      player.x,
      player.y,
      0,
      0,
      subDamage(state, SUB_MINE_DAMAGE),
      SUB_MINE_PIERCE,
      SUB_MINE_RADIUS,
      SUB_MINE_LIFE,
      1,
      0,
    );
    mine.enemyType = SUB_TYPE_MINE; // 렌더 태그
    player.timer = subCooldown(state, SUB_MINE_COOLDOWN);
    return;
  }

  if (subType === SUB_TYPE_SENTRY) {
    // 자율 드론 베이와 동일: turretPickup을 배치 후 즉시 활성 포탑화. DRONE_MARK로 청크
    // 기믹 컬링·상한 대상에서 제외(플레이어 소환물). stepTurrets가 자동 사격·수명 처리.
    const sentry = spawnEventObject(state, 'turretPickup', player.x + DRONE_SPAWN_OFFSET, player.y, 44);
    sentry.ownerId = DRONE_MARK;
    activateTurret(sentry);
    player.timer = subCooldown(state, SUB_SENTRY_COOLDOWN);
    return;
  }

  const range =
    subType === SUB_TYPE_SCATTER
      ? SUB_SCATTER_RANGE
      : subType === SUB_TYPE_FLARE
        ? SUB_FLARE_RANGE
        : SUB_SIDEKICK_RANGE;
  const target = nearestTarget(state, player, range);
  if (target === undefined) return;
  const baseAngle = atan2(target.y - player.y, target.x - player.x);

  if (subType === SUB_TYPE_SCATTER) {
    const n = SUB_SCATTER_PELLETS;
    const start = baseAngle - SUB_SCATTER_SPREAD / 2;
    const stepA = n > 1 ? SUB_SCATTER_SPREAD / (n - 1) : 0;
    const dmg = subDamage(state, SUB_SCATTER_DAMAGE);
    for (let i = 0; i < n; i++) {
      const ang = start + stepA * i;
      const b = spawnBullet(
        state,
        player.x,
        player.y,
        ang,
        SUB_SCATTER_SPEED,
        dmg,
        0,
        SUB_SCATTER_RADIUS,
        SUB_SCATTER_LIFE,
        cos(ang),
        sin(ang),
      );
      b.enemyType = SUB_TYPE_SCATTER;
    }
    player.timer = subCooldown(state, SUB_SCATTER_COOLDOWN);
    return;
  }

  if (subType === SUB_TYPE_FLARE) {
    const flare = spawnBullet(
      state,
      player.x,
      player.y,
      baseAngle,
      SUB_FLARE_SPEED,
      subDamage(state, SUB_FLARE_DAMAGE),
      0,
      SUB_FLARE_RADIUS,
      SUB_FLARE_LIFE,
      cos(baseAngle),
      sin(baseAngle),
    );
    flare.ownerId = MISSILE_MARK; // 유도 마커: stepProjectiles가 매 틱 제한 선회
    flare.enemyType = SUB_TYPE_FLARE; // 렌더 태그
    player.timer = subCooldown(state, SUB_FLARE_COOLDOWN);
    return;
  }

  // 0 사이드킥(기본): 단발.
  const b = spawnBullet(
    state,
    player.x,
    player.y,
    baseAngle,
    SUB_SIDEKICK_SPEED,
    subDamage(state, SUB_SIDEKICK_DAMAGE),
    0,
    SUB_SIDEKICK_RADIUS,
    SUB_SIDEKICK_LIFE,
    cos(baseAngle),
    sin(baseAngle),
  );
  b.enemyType = SUB_TYPE_SIDEKICK;
  player.timer = subCooldown(state, SUB_SIDEKICK_COOLDOWN);
}

/**
 * ④ 자율 드론 베이(plan F1, OQ-M2-6 #4): 장착 시 주기적으로 임시 포탑(드론)을
 * 플레이어 곁에 소환한다. scroll-map turretPickup 로직 재사용(spawnEventObject +
 * activateTurret) — 소환된 포탑은 stepTurrets가 자동 사격/수명 처리한다. 소환 주기는
 * player.ownerId(플레이어 미사용 필드, 이미 해시됨)에 카운트다운으로 실어 신규
 * WorldState 필드·해시 변경 없이 결정론 유지. 미장착 시 ownerId는 항상 0(거동 불변).
 */
function droneBay(state: WorldState, player: Entity): void {
  const mask = state.config.loadout?.uniqueMask ?? 0;
  if (!hasUnique(mask, UQ_DRONE_BAY)) return;
  if (player.ownerId > 0) {
    player.ownerId--;
    return;
  }
  const drone = spawnEventObject(state, 'turretPickup', player.x + DRONE_SPAWN_OFFSET, player.y, 44);
  drone.ownerId = DRONE_MARK; // 청크 기믹과 구분(isGimmick 제외 → 컬링·상한 비대상)
  activateTurret(drone); // 즉시 활성 포탑(TURRET_LIFE_TICKS 동안 자동 사격)
  player.ownerId = DRONE_INTERVAL;
}

/** Max candidates LOS-tested per aim (nearest few); bounds the wall raycast cost. */
const LOS_MAX_CANDIDATES = 6;

/**
 * nearestTarget slow-path 후보 스크래치(모듈 레벨 재사용). 매 조준마다 배열을 새로
 * 할당하지 않아 GC 압력을 줄인다. 매 호출 시작에 length=0으로 리셋하고 처음부터 다시
 * 채우므로 이전 호출의 잔존 데이터를 참조하지 않는다(내용은 매번 재계산 — 결정론 유지).
 * WorldState가 아니라 모듈 스크래치이므로 hashWorld 대상에 포함되지 않는다.
 */
const losCands: { e: Entity; d: number }[] = [];

/**
 * Nearest hostile the vulcan can target: any enemy, boss, or supply raider.
 *
 * LOS (plan F1c): a candidate hidden behind a wall is skipped and the NEXT
 * nearest visible candidate is chosen ("filter blocked, then nearest" — not
 * "nearest, else none"). When there are no active walls this collapses to the
 * plain nearest scan (no allocation, identical to the pre-gimmick behaviour).
 */
/**
 * 플레이어(및 아군 포탑·유도탄)가 조준·타격할 수 있는 적성 대상인가. 기존 PvE 적성
 * (enemy·boss·supply)에 M4 침공 방어 엔티티(defenseTurret·core)를 더한다. PvE 런에는 방어
 * 엔티티가 존재하지 않으므로 이 확장은 기존 거동·해시에 영향이 없다(순수 추가 대상).
 */
function isPlayerTargetable(e: Entity): boolean {
  return (
    e.kind === 'enemy' ||
    e.kind === 'boss' ||
    e.kind === 'supply' ||
    e.kind === 'defenseTurret' ||
    e.kind === 'core' ||
    e.kind === 'guardian'
  );
}

function nearestTarget(state: WorldState, from: Entity, range: number): Entity | undefined {
  const maxD2 = range > 0 ? range * range : Infinity;

  // Fast path: no walls → nearest candidate, nothing to occlude.
  if (state.activeWalls.length === 0) {
    let best: Entity | undefined;
    let bestD = maxD2;
    for (const e of state.entities) {
      if (e.dead) continue;
      if (!isPlayerTargetable(e)) continue;
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
  const cands = losCands;
  cands.length = 0; // 재사용 스크래치 리셋(할당 회피).
  for (const e of state.entities) {
    if (e.dead) continue;
    if (!isPlayerTargetable(e)) continue;
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

/**
 * Steer a homing missile (weaponType 3) toward the nearest hostile with a capped
 * per-tick turn (MISSILE_TURN_RATE), preserving its speed. Nearest scan ignores
 * walls (missiles curve around), uses only deterministic trig. No target → the
 * missile flies straight (its current heading is unchanged).
 *
 * 성능(리뷰 MED-2 재검토): 이 함수는 미사일마다 전 엔티티를 한 번 훑는다(O(미사일×N)).
 * 브로드페이즈 그리드로 대체하는 방안을 벤치로 검증했으나, ①유도 미사일 수가 대개 한 자리
 * 라 스캔 총량이 작고 ②미사일 단계엔 갓 만든 그리드가 없어 매 틱 전용 그리드를 새로
 * 채워야 하며(O(N) 삽입) ③Map 조회·클로저 호출 상수가 촘촘한 배열 순회보다 커서, 실측상
 * 오히려 40%가량 느려졌다(107→151ms/1500t·200적). 따라서 결정론·단순성을 지키는 이 직접
 * 스캔을 유지한다(전역 최근접·배열 순서 tie-break도 함께 보존).
 */
function homeMissile(state: WorldState, e: Entity): void {
  const speed = length(e.vx, e.vy);
  if (speed === 0) return;
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const t of state.entities) {
    if (t.dead) continue;
    if (!isPlayerTargetable(t)) continue;
    const dx = t.x - e.x;
    const dy = t.y - e.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (best === undefined) return;
  const desired = atan2(best.y - e.y, best.x - e.x);
  let delta = wrapAngle(desired - e.angle);
  if (delta > MISSILE_TURN_RATE) delta = MISSILE_TURN_RATE;
  else if (delta < -MISSILE_TURN_RATE) delta = -MISSILE_TURN_RATE;
  e.angle += delta;
  e.vx = cos(e.angle) * speed;
  e.vy = sin(e.angle) * speed;
}

function stepProjectiles(state: WorldState, player: Entity): void {
  // Infinite map: there is no arena edge to despawn against. A projectile dies
  // when its lifetime elapses OR it drifts beyond the player-relative cull
  // radius. Both conditions are checked so a bullet can never accumulate
  // forever off-screen (see tests/projectiles.test.ts).
  const cullR2 = PROJECTILE_CULL_RADIUS * PROJECTILE_CULL_RADIUS;
  const walls = state.activeWalls;
  // 중력 폭풍 변칙: enemy bullets travel slower (single application point so no
  // emitter needs touching). Friendly bullets are unaffected (mult = 1).
  const enemyBulletMult = enemyBulletSpeedMult(state.anomaly);
  // 적탄 거동(탄막 다양성 Lane 1): BK_SPLIT 만료 시 방사할 자탄을 모아 루프 뒤 스폰
  // (엔티티 배열 순회 중 push 회피). 거동 없는 적탄(enemyType === BK_NONE)은 no-op.
  const bulletSplits: BulletSplit[] = [];
  for (const e of state.entities) {
    if (e.kind !== 'bullet' && e.kind !== 'enemyBullet') continue;
    // 유도 미사일(제한 선회, OQ-M3-4): 위치 적분 전에 최근접 적으로 각도를 소폭 튼다.
    if (e.kind === 'bullet' && e.ownerId === MISSILE_MARK) homeMissile(state, e);
    // 적탄 거동 갱신(위치 적분 전 vx/vy/angle 재구성). 분열로 소멸하면 이번 틱 스킵.
    if (e.kind === 'enemyBullet' && e.enemyType !== BK_NONE) {
      if (stepEnemyBulletBehavior(e, player, bulletSplits)) continue;
    }
    const m = e.kind === 'enemyBullet' ? enemyBulletMult : 1;
    e.x += e.vx * DT * m;
    e.y += e.vy * DT * m;
    if (e.life > 0) e.life--;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (e.life === 0 || dx * dx + dy * dy > cullR2) {
      e.dead = true;
      continue;
    }
    // Both factions' bullets are stopped by walls (activeWalls direct sweep —
    // walls are never in the spatial hash). First overlap kills the bullet.
    // 성능 가드: 이 스윕은 O(투사체 × 활성 벽). 활성 벽은 청크 활성 영역 상한
    // (MAX_ACTIVE_GIMMICKS, 실측 ≤~19벽)에 묶여 있고 탄은 bulletCap(≤~2000)이라
    // 현 스케일에선 안전하다. 활성 벽 수가 이 전제를 크게 넘어서면(예: 벽 밀집
    // 청크·상한 상향) 벽에도 broad-phase(공간 격자/스윕-프룬)가 필요하다.
    for (const w of walls) {
      if (circleOverlapsWall(e.x, e.y, e.radius, w)) {
        e.dead = true;
        break;
      }
    }
  }
  // BK_SPLIT 자탄 방사(퓨즈 만료 위치에서 균등 각도로). 자탄은 거동 없는 순수 직진탄
  // (enemyType 기본 -1)이라 재분열하지 않는다. 세그먼트 탄 상한(bulletCap)을 존중해
  // 폭주를 막는다 — 상한 도달 시 남은 자탄은 버린다(결정론: 배열 순서 고정 소비).
  // 상한 계수는 발사 경로의 enemyBulletCount(틱 시작 재계산)와 달리 countKind(라이브 스캔)를
  // 쓴다 — 이번 틱 dead 표시분까지 세어 과대계상될 수 있으나, 자탄 스폰이 상한보다 보수적으로
  // 나올 뿐이며 결정론에는 무해하다. 부모 탄 소멸분을 즉시 반영하려는 의도적 선택.
  if (bulletSplits.length > 0) {
    let live = countKind(state, 'enemyBullet');
    for (const s of bulletSplits) {
      for (let i = 0; i < s.count; i++) {
        if (live >= state.bulletCap) break;
        const ang = s.baseAngle + (i * TWO_PI) / s.count;
        spawnEnemyBullet(
          state,
          s.x,
          s.y,
          cos(ang) * s.speed,
          sin(ang) * s.speed,
          ang,
          s.damage,
          s.radius,
          70,
        );
        live++;
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
      e.kind === 'turretPickup' ||
      e.kind === 'loot' ||
      e.kind === 'defenseTurret' ||
      e.kind === 'core' ||
      e.kind === 'guardian'
    ) {
      grid.insert(e);
    }
  }

  // Friendly bullets vs enemies / boss / supply raiders / destructibles.
  // 유니크 게이트(장착 시에만 분기): ① 과열 드럼(명중 스택), ② 분열 코어(명중 파편),
  // ③ 관통 자이로(무한 관통 + 관통당 피해 증폭). 미장착 시 아래 분기는 전부 no-op.
  const uMask = state.config.loadout?.uniqueMask ?? 0;
  const overheatOn = hasUnique(uMask, UQ_OVERHEAT_DRUM);
  const splitOn = hasUnique(uMask, UQ_SPLIT_CORE);
  const gyroOn = hasUnique(uMask, UQ_PIERCE_GYRO);
  // M3 통합 신규 훅: ⑤ 군집 벌통(미사일 격추 시 마이크로탄 방사), ⑥ 수렴 프리즘(빔이
  // 관통한 적 수만큼 피해 증폭). 미장착 시 no-op. ⑤⑥⑦은 모두 주무기 슬롯이라 상호 배타.
  // weaponType 이중 게이트(리뷰 MED-1): 군집 벌통=미사일(3)·수렴 프리즘=빔(4) 전용.
  // roll.ts 페어링이 1차 방어, 여기가 2차 방어 — 비대응 무기엔 no-op(프리즘이 전 무기
  // 관통탄에 새던 결함 차단). 벌통은 트리거가 이미 MISSILE_MARK지만 명시적으로 게이트.
  const weaponType = state.weapon.weaponType;
  const hiveOn = hasUnique(uMask, UQ_HIVE_SWARM) && weaponType === WEAPON_TYPE_MISSILE;
  const prismOn = hasUnique(uMask, UQ_CONVERGE_PRISM) && weaponType === WEAPON_TYPE_BEAM;
  // M3 원소 어픽스(상태이상, plan B4): 명중 시 적에게 화염(지속피해)·냉기(감속)·전격
  // (연쇄)을 건다. 미장착(값 0)이면 아래 분기는 no-op. enemy에만 적용(보스 재활용 필드
  // 충돌 방지).
  const lo = state.config.loadout;
  const fireDmg = lo?.fireDmg ?? 0;
  const coldSlow = lo?.coldSlow ?? 0;
  const lightning = lo?.lightning ?? 0;
  const elementalOn = fireDmg > 0 || coldSlow > 0 || lightning > 0;
  // 분열 파편은 그리드 순회 중 엔티티 배열을 건드리지 않도록 좌표만 모아 루프 뒤 스폰.
  const splitSpawns: { x: number; y: number; angle: number }[] = [];
  // ⑤ 군집 벌통: 미사일 격추 위치를 모아 루프 뒤 방사 스폰(엔티티 배열 순회 중 안전).
  const hiveSpawns: { x: number; y: number }[] = [];
  for (const b of state.entities) {
    if (b.kind !== 'bullet' || b.dead) continue;
    grid.query(b.x, b.y, b.radius, (t) => {
      if (b.dead || t.dead) return;
      if (
        t.kind !== 'enemy' &&
        t.kind !== 'boss' &&
        t.kind !== 'supply' &&
        t.kind !== 'destructible' &&
        t.kind !== 'defenseTurret' &&
        t.kind !== 'core' &&
        t.kind !== 'guardian'
      )
        return;
      if (!circlesOverlap(b.x, b.y, b.radius, t.x, t.y, t.radius)) return;
      // Boss takes double damage while overheated (iframes > 0), spec.
      const mult = t.kind === 'boss' && t.iframes > 0 ? 2 : 1;
      // ③ 관통 자이로: bullet.phase = 지금까지 관통한 횟수 → 관통당 피해 증폭.
      const gyroAmp = gyroOn ? 1 + b.phase * GYRO_DAMAGE_AMP : 1;
      // ⑥ 수렴 프리즘: 빔 세그먼트가 관통한 적 수(phase)만큼 피해 증폭(자이로와 배타).
      const prismAmp = prismOn ? 1 + b.phase * PRISM_DAMAGE_AMP : 1;
      // 보호막의 엘리트: 받는 피해 절반(그 외 1).
      t.hp -= b.damage * mult * gyroAmp * prismAmp * eliteDamageTakenMult(t);
      if (t.hp <= 0) {
        t.dead = true;
        // ⑤ 군집 벌통: 미사일 원본(MISSILE_MARK)이 적/보스를 격추하면 마이크로탄 방사 예약.
        if (hiveOn && b.ownerId === MISSILE_MARK && (t.kind === 'enemy' || t.kind === 'boss')) {
          hiveSpawns.push({ x: t.x, y: t.y });
        }
      }
      // M3 원소 상태이상(plan B4): 적 명중 시 화염/냉기/전격 부여(장착 시에만).
      if (elementalOn && t.kind === 'enemy') {
        if (fireDmg > 0) applyBurn(t, fireDmg, FIRE_DURATION);
        if (coldSlow > 0) applySlow(t, COLD_DURATION);
        if (lightning > 0) applyChain(state, t, lightning);
      }
      // ① 과열 드럼: 적/보스 명중마다 스택 +1(상한). 피격 시 아래에서 리셋.
      if (overheatOn && (t.kind === 'enemy' || t.kind === 'boss')) {
        if (player.phase < OVERHEAT_MAX_STACK) player.phase++;
      }
      // ② 분열 코어: 원본 아군탄(마커 없는)이 명중하면 파편 2발 예약(무한 연쇄 방지).
      if (splitOn && b.ownerId !== SPLIT_FRAGMENT_MARK) {
        splitSpawns.push({ x: b.x, y: b.y, angle: b.angle });
      }
      // 관통 처리: 자이로는 무한 관통(수명으로만 소멸). 프리즘은 관통 카운트를 위해
      // phase를 올리되 세그먼트의 기존 pierce 예산(9999)을 소비 → 짧은 수명으로 소멸.
      // 그 외는 기존 규칙.
      if (gyroOn) {
        b.phase++;
      } else if (prismOn) {
        b.phase++;
        if (b.pierce > 0) b.pierce--;
        else b.dead = true;
      } else if (b.pierce > 0) {
        b.pierce--;
      } else {
        b.dead = true;
      }
    });
  }
  // ② 분열 파편 스폰(진행 방향 ± SPLIT_SPREAD). 파편은 마커를 달아 재분열하지 않는다.
  for (const s of splitSpawns) {
    for (let i = 0; i < SPLIT_FRAGMENTS; i++) {
      const off = SPLIT_FRAGMENTS > 1 ? -SPLIT_SPREAD + (2 * SPLIT_SPREAD * i) / (SPLIT_FRAGMENTS - 1) : 0;
      const ang = s.angle + off;
      const frag = spawnBullet(
        state,
        s.x,
        s.y,
        ang,
        SPLIT_FRAGMENT_SPEED,
        state.weapon.damage,
        0,
        SPLIT_FRAGMENT_RADIUS,
        SPLIT_FRAGMENT_LIFE,
        cos(ang),
        sin(ang),
      );
      frag.ownerId = SPLIT_FRAGMENT_MARK; // 재분열 방지 마커
    }
  }
  // ⑤ 군집 벌통 마이크로 미사일 방사: 격추 위치에서 HIVE_MICRO_COUNT발을 균등 방사.
  //    HIVE_MICRO_MARK를 달아 유도(MISSILE_MARK) 제외 + 재분열 트리거 제외 → 무한 연쇄 방지.
  if (hiveSpawns.length > 0) {
    const microDmg = state.weapon.damage * HIVE_MICRO_DAMAGE_FRAC;
    for (const h of hiveSpawns) {
      for (let i = 0; i < HIVE_MICRO_COUNT; i++) {
        const ang = (TWO_PI * i) / HIVE_MICRO_COUNT;
        const micro = spawnBullet(
          state,
          h.x,
          h.y,
          ang,
          HIVE_MICRO_SPEED,
          microDmg,
          0,
          HIVE_MICRO_RADIUS,
          HIVE_MICRO_LIFE,
          cos(ang),
          sin(ang),
        );
        micro.ownerId = HIVE_MICRO_MARK;
      }
    }
  }

  // Player vs enemies / enemy bullets / hazards / gems / boss.
  //
  // 판정점(ADR-0010): 이로운 픽업(젬·전리품·기믹)은 관대한 기체 반지름으로, 해로운
  // 접촉(적탄·적·해저드·감속 장판)은 훨씬 작은 판정점(PLAYER_HIT_RADIUS)으로 판정한다.
  // 브로드페이즈 검색은 기존대로 기체 반지름(player.radius)으로 훑고(픽업 후보 누락 방지),
  // 좁은 판정은 콜백 안에서 종류별로 나눠 정확 거리 테스트한다.
  let dmg = 0;
  const invulnerable = player.iframes > 0;
  const px = player.x;
  const py = player.y;
  const pickR = player.radius; // 관대한 픽업 반경
  const hitR = PLAYER_HIT_RADIUS; // 좁은 피격 판정점
  grid.query(px, py, pickR, (t) => {
    if (t.dead) return;
    if (t.kind === 'gem') {
      if (circlesOverlap(px, py, pickR, t.x, t.y, t.radius)) collectGem(state, t);
      return;
    }
    // Floor loot: auto-collect on contact (OQ-M2-1 default). Record the drop seed
    // + rarity + provenance for settlement (Lane 2 confirms the item via rollItem).
    if (t.kind === 'loot') {
      if (circlesOverlap(px, py, pickR, t.x, t.y, t.radius)) collectLoot(state, t);
      return;
    }
    // Proximity event objects fire on contact (deterministic, no input). Consumed
    // objects are marked dead; a picked-up turret converts in place (stays alive).
    if (t.kind === 'magnetEmitter') {
      if (circlesOverlap(px, py, pickR, t.x, t.y, t.radius)) {
        triggerMagnetEmitter(state);
        t.dead = true;
      }
      return;
    }
    if (t.kind === 'bombDevice') {
      if (circlesOverlap(px, py, pickR, t.x, t.y, t.radius)) {
        triggerBombDevice(state, t.x, t.y);
        t.dead = true;
      }
      return;
    }
    if (t.kind === 'turretPickup') {
      if (t.phase === 0 && circlesOverlap(px, py, pickR, t.x, t.y, t.radius)) activateTurret(t);
      return;
    }
    // 이하 해로운 접촉: 판정점(hitR)으로만 판정 — 기체를 스쳐도 판정점에 안 닿으면 무해.
    if (!circlesOverlap(px, py, hitR, t.x, t.y, t.radius)) return;
    // 감속 지대(plan B1): 활성 HAZARD_SLOW 장판에 닿으면 감속 부여(무적 여부와 무관 —
    // 이동 디버프이지 피해가 아니다). 소량 피해는 아래 일반 hazard 분기가 처리한다.
    if (t.kind === 'hazard' && t.enemyType === HAZARD_SLOW && hazardActive(t)) {
      state.playerSlowTicks = PLAYER_SLOW_DURATION;
    }
    if (invulnerable) return;
    if (t.kind === 'enemyBullet') {
      if (t.damage > dmg) dmg = t.damage;
      t.dead = true;
    } else if (t.kind === 'enemy' || t.kind === 'boss' || t.kind === 'guardian') {
      // 수호 기체(M5)는 추적형 요격 유닛 — 접촉(램) 피해를 준다(방어전에만 존재).
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
    // ① 과열 드럼: 피격 시 연속 명중 스택 리셋(장착 시에만 phase가 비0).
    if (overheatOn) player.phase = 0;
    // ⑨ 반응 장갑(plan B4): 피격 시 방사형 반격 펄스(아군탄) 방출.
    if (hasUnique(uMask, UQ_REACTIVE_ARMOR)) {
      for (let i = 0; i < REACTIVE_PULSE_COUNT; i++) {
        const ang = (i * TWO_PI) / REACTIVE_PULSE_COUNT;
        spawnBullet(
          state,
          player.x,
          player.y,
          ang,
          REACTIVE_PULSE_SPEED,
          REACTIVE_PULSE_DAMAGE,
          0,
          REACTIVE_PULSE_RADIUS,
          REACTIVE_PULSE_LIFE,
          cos(ang),
          sin(ang),
        );
      }
    }
    // ⑩ 위상 전환막(plan B4): 저체력 진입 + 내부 쿨다운 준비 시 광역 폭발(적탄 소거) +
    // 최대 체력 절반 회복. targetY에 쿨다운을 실어 재발동을 막는다.
    if (
      hasUnique(uMask, UQ_PHASE_MEMBRANE) &&
      player.targetY === 0 &&
      player.hp > 0 &&
      player.hp <= player.maxHp * PHASE_MEMBRANE_HP_FRAC
    ) {
      for (const t of state.entities) if (t.kind === 'enemyBullet') t.dead = true;
      player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * PHASE_MEMBRANE_HEAL_FRAC));
      player.targetY = PHASE_MEMBRANE_COOLDOWN;
    }
  }
}

/** Collect a gem: bump the combo, award XP scaled by combo × loadout XP mult. */
function collectGem(state: WorldState, gem: Entity): void {
  gem.dead = true;
  state.gems++;
  state.combo++;
  state.comboTimer = COMBO_WINDOW_TICKS;
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;
  const mask = state.config.loadout?.uniqueMask ?? 0;
  // ⑫ 탐욕의 심장(plan B4): 젬 획득마다 콤보 지속을 연장하고 자석 반경을 상한까지 스택.
  if (hasUnique(mask, UQ_GREED_HEART)) {
    state.comboTimer += GREED_COMBO_BONUS_TICKS;
    state.magnetRadius = Math.min(GREED_MAGNET_CAP, state.magnetRadius + GREED_MAGNET_STEP);
  }
  const baseXp = gem.damage; // gem carries its XP value in `damage`
  const xpMult = state.config.loadout?.xpMult ?? 1; // affix 경험치+%
  let gained = Math.floor(baseXp * comboMultiplier(state.combo) * xpMult);
  // ⑭ 유물 증폭기(plan B4): 경험치 소폭↑(광물·유니크 드랍률은 정산 메타에서 처리).
  if (hasUnique(mask, UQ_RELIC_AMP)) gained = Math.floor(gained * RELIC_XP_MULT);
  state.xp += gained;
  state.xpTotal += gained;
}

/** Collect a loot drop: record its seed + rarity + provenance for settlement. */
function collectLoot(state: WorldState, loot: Entity): void {
  loot.dead = true;
  state.loot.push({
    seed: loot.damage >>> 0, // drop seed stored in `damage`
    rarity: loot.enemyType, // rarity code stored in `enemyType`
    planet: state.config.planet ?? 0,
    tier: state.config.tier ?? 0,
  });
}

// ---------------------------------------------------------------------------
// Dead-entity compaction (order-preserving; player stays at index 0).
// ---------------------------------------------------------------------------

function compact(state: WorldState): void {
  const survivors: Entity[] = [];
  const drops: { x: number; y: number; xp: number }[] = [];
  const supplyDrops: { x: number; y: number }[] = [];
  // Loot drops (elite/boss) + split-elite death fragments, spawned AFTER the
  // survivor array is rebuilt so we never mutate `state.entities` mid-iteration.
  const lootDrops: { x: number; y: number; seed: number; rarity: number }[] = [];
  const splitElites: Entity[] = [];
  const tier = state.config.tier ?? 0;
  const planet = state.config.planet ?? 0;
  // 이 compact에서 보스가 죽어 승리가 확정됐는지. 승리 tick에는 다음 stepWorld가
  // 즉시 return(gameOver/victory 가드)하므로 collectLoot(resolveCollisions 내부)가
  // 다시 실행되지 않는다 → 이 tick에 바닥 스폰된 loot는 영영 수거되지 않아 유실된다.
  let bossKilled = false;
  // 행성별 드랍 테이블(rarity 기준 확률)을 엘리트/보스 드랍 판정에 넘긴다(E3).
  const dropOdds = planetContent(state.config.planet).dropTable;
  for (const e of state.entities) {
    if (!e.dead) {
      survivors.push(e);
      continue;
    }
    if (e.kind === 'enemy') {
      state.kills++;
      const def = enemyDefFor(e);
      drops.push({ x: e.x, y: e.y, xp: def?.xpValue ?? 1 });
      // Elites are the only rank-and-file loot source (GDD §3). They always drop
      // one item; a 분열하는 elite additionally bursts fragments on death (B4).
      if (isElite(e)) {
        const roll = rollEliteDrop(state.dropRng, tier, state.anomaly, dropOdds);
        lootDrops.push({ x: e.x, y: e.y, seed: roll.seed, rarity: roll.rarityCode });
        // 분열하는·폭발성의 엘리트는 사망 시 방사 폭발을 남긴다(spawnEliteDeathFx).
        const ea = eliteAffix(e);
        if (ea === ELITE_SPLIT || ea === ELITE_VOLATILE) splitElites.push(e);
      }
    } else if (e.kind === 'supply' && e.hp <= 0) {
      // Shot down (vs. escaped with hp > 0): grant the raid reward.
      state.resources++;
      supplyDrops.push({ x: e.x, y: e.y });
    } else if (e.kind === 'destructible' && e.hp <= 0) {
      // Broken (vs. culled with hp > 0): drop a gem worth its stored XP value.
      drops.push({ x: e.x, y: e.y, xp: e.damage });
    } else if (e.kind === 'core') {
      // 침공 승리(M4 plan C2): 코어 파괴 = 침공 성공. 보스와 달리 드랍은 없다(침공 보상은
      // 래더 스왑·복제 약탈로 서버가 처리 — Phase D). 승리 확정만 세운다.
      state.victory = true;
    } else if (e.kind === 'boss') {
      state.victory = true;
      bossKilled = true;
      // Boss guaranteed rare+ drop (GDD §3, plan B3). 승리 tick이라 바닥 스폰→접촉 수거가
      // 불가능하므로 state.loot에 직접 기록해 정산에 포함시킨다(해시 포함, replay.ts).
      const roll = rollBossDrop(state.dropRng, tier, state.anomaly, dropOdds);
      state.loot.push({ seed: roll.seed >>> 0, rarity: roll.rarityCode, planet, tier });
    }
  }
  state.entities = survivors;
  for (const d of drops) spawnGem(state, d.x, d.y, d.xp);
  if (bossKilled) {
    // 보스와 같은 tick에 죽은 엘리트 loot도 승리 tick이라 바닥에서 수거될 수 없다.
    // 보스 드랍과 동일하게 state.loot에 직접 기록해 유실을 막는다(결정론: 배열 순서 고정).
    for (const d of lootDrops) {
      state.loot.push({ seed: d.seed >>> 0, rarity: d.rarity, planet, tier });
    }
  } else {
    for (const d of lootDrops) spawnLoot(state, d.x, d.y, d.seed, d.rarity);
  }
  for (const e of splitElites) spawnEliteDeathFx(state, e);
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
  // ⑬ 도박사의 칩: 파워업 선택지 +GAMBLER_EXTRA_CHOICES(로드아웃 고정 → 결정론적).
  //    선택 입력 프레임은 2비트(0~3)라 4번째 선택지까지 와이어 호환(stepWorld).
  const gambleOn = hasUnique(state.config.loadout?.uniqueMask ?? 0, UQ_GAMBLER_CHIP);
  const choiceCount = gambleOn ? 3 + GAMBLER_EXTRA_CHOICES : 3;
  state.powerupChoices = drawPowerupChoices(state, choiceCount);
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
