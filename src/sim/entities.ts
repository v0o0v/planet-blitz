/**
 * Entity model and factories for the simulation core (M1 Phase 2).
 *
 * The world keeps a single flat `entities` array so the deterministic state hash
 * can walk it in a fixed order. Every entity — player, enemy, bullet, hazard,
 * gem — shares one struct; kind-specific fields simply default to 0 for kinds
 * that do not use them. This keeps hashing branch-free and makes it trivial to
 * add new kinds without touching the hash layout ordering.
 *
 * This module is a leaf: it imports nothing from `world`/`patterns`/`waves`, so
 * both the world loop and the pattern engine can depend on it without cycles.
 */

export type EntityKind =
  | 'player'
  | 'enemy'
  | 'bullet'
  | 'enemyBullet'
  | 'hazard'
  | 'gem'
  | 'supply'
  | 'boss'
  // --- Scroll-map gimmicks (plan Phase E/F) ---
  | 'wall' // 이동 차단 + 양측 탄 차단 + LOS 가림 직사각(AABB) 엄폐물
  | 'destructible' // 부수면 젬 드랍하는 파괴 가능 오브젝트(이동은 통과)
  | 'magnetEmitter' // 접촉 시 젬 자석 반경 배율 버프
  | 'bombDevice' // 접촉 시 반경 내 적 피해 + 적탄 소거
  | 'turretPickup'; // 접촉 시 일정 시간 자동 사격하는 아군 포탑으로 활성화

/**
 * Stable integer per kind, folded into the state hash. Never renumber existing
 * codes — a run recorded under old codes must re-verify identically. New kinds
 * are APPENDED (codes 9+) so existing recordings hash unchanged.
 */
export const KIND_CODE: Record<EntityKind, number> = {
  player: 1,
  enemy: 2,
  bullet: 3,
  enemyBullet: 4,
  hazard: 5,
  gem: 6,
  supply: 7,
  boss: 8,
  // Appended for the scroll-map gimmicks (never renumber 1..8).
  wall: 9,
  destructible: 10,
  magnetEmitter: 11,
  bombDevice: 12,
  turretPickup: 13,
};

export interface Entity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Facing / travel angle (radians). */
  angle: number;
  radius: number;
  hp: number;
  maxHp: number;
  /** Generic countdown: hazard windup, enemy re-decision timer. */
  timer: number;
  /** Dash cooldown in ticks (player). */
  dashCooldown: number;
  /** Invulnerability frames remaining (player). */
  iframes: number;
  /** Enemy role index (see patterns/types) / hazard subtype; -1 when unused. */
  enemyType: number;
  /** Attack / weapon fire cooldown in ticks. */
  cooldown: number;
  /** Pattern or hazard sub-state (0 = telegraph, 1 = active, ...). */
  phase: number;
  /** Remaining lifetime in ticks (bullets, hazards). -1 = never expires. */
  life: number;
  /** Contact / bullet / hazard damage. */
  damage: number;
  /** Bullet remaining pierces (0 = despawn on first hit). */
  pierce: number;
  /** Steering / impact target (mortar zone, charger goal, heal-beam target). */
  targetX: number;
  targetY: number;
  /** Owning entity id (hazard/beam source); 0 = none. */
  ownerId: number;
  /** Transient removal flag — set during a tick, compacted before hashing. */
  dead: boolean;
}

/** A world-like sink that can allocate ids and hold entities. */
export interface EntitySink {
  entities: Entity[];
  nextEntityId: number;
}

/** All-zero entity of the given kind; callers override the fields they need. */
export function blankEntity(kind: EntityKind): Entity {
  return {
    id: 0,
    kind,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 0,
    hp: 0,
    maxHp: 0,
    timer: 0,
    dashCooldown: 0,
    iframes: 0,
    enemyType: -1,
    cooldown: 0,
    phase: 0,
    life: -1,
    damage: 0,
    pierce: 0,
    targetX: 0,
    targetY: 0,
    ownerId: 0,
    dead: false,
  };
}

/** Allocate an id, append to the sink, and return the entity. */
export function addEntity(sink: EntitySink, e: Entity): Entity {
  e.id = sink.nextEntityId++;
  sink.entities.push(e);
  return e;
}

/** Spawn a friendly (player) bullet travelling along `angle`. */
export function spawnBullet(
  sink: EntitySink,
  x: number,
  y: number,
  angle: number,
  speed: number,
  damage: number,
  pierce: number,
  radius: number,
  life: number,
  vcos: number,
  vsin: number,
): Entity {
  const b = blankEntity('bullet');
  b.x = x;
  b.y = y;
  b.vx = vcos * speed;
  b.vy = vsin * speed;
  b.angle = angle;
  b.radius = radius;
  b.damage = damage;
  b.pierce = pierce;
  b.life = life;
  return addEntity(sink, b);
}

/** Spawn a hostile bullet with an explicit velocity. */
export function spawnEnemyBullet(
  sink: EntitySink,
  x: number,
  y: number,
  vx: number,
  vy: number,
  angle: number,
  damage: number,
  radius: number,
  life: number,
): Entity {
  const b = blankEntity('enemyBullet');
  b.x = x;
  b.y = y;
  b.vx = vx;
  b.vy = vy;
  b.angle = angle;
  b.radius = radius;
  b.damage = damage;
  b.life = life;
  return addEntity(sink, b);
}

/** Spawn a telegraphed hazard zone (mortar impact, lava pillar). */
export function spawnHazard(
  sink: EntitySink,
  subtype: number,
  x: number,
  y: number,
  radius: number,
  windup: number,
  activeTicks: number,
  damage: number,
  continuous: boolean,
  ownerId: number,
): Entity {
  const h = blankEntity('hazard');
  h.enemyType = subtype;
  h.x = x;
  h.y = y;
  h.radius = radius;
  h.timer = windup; // telegraph countdown
  h.life = activeTicks; // active duration once telegraph ends
  h.damage = damage;
  h.phase = continuous ? 1 : 0; // 1 = continuous damage, 0 = single burst
  h.ownerId = ownerId;
  return addEntity(sink, h);
}

/**
 * Spawn an experience gem dropped by a slain enemy. `xpValue` (enemy-dependent)
 * is stored in the `damage` field — gems never deal damage, so the slot is free
 * and is already folded into the state hash.
 */
export function spawnGem(sink: EntitySink, x: number, y: number, xpValue: number): Entity {
  const g = blankEntity('gem');
  g.x = x;
  g.y = y;
  g.radius = 20; // 2x scale (plan D1): 10 -> 20
  g.hp = 1;
  g.damage = xpValue;
  return addEntity(sink, g);
}

/**
 * Spawn a supply raider — a high-HP transport that crosses the arena without
 * firing. `life` counts down its time window (despawns on expiry); shooting it
 * down before then yields the reward. `vx` carries it across; `enemyType` tags
 * the render.
 */
export function spawnSupply(
  sink: EntitySink,
  x: number,
  y: number,
  vx: number,
  hp: number,
  lifeTicks: number,
): Entity {
  const s = blankEntity('supply');
  s.x = x;
  s.y = y;
  s.vx = vx;
  s.radius = 92; // 2x scale (plan D1): 46 -> 92
  s.hp = hp;
  s.maxHp = hp;
  s.life = lifeTicks;
  s.enemyType = 0;
  return addEntity(sink, s);
}

// ---------------------------------------------------------------------------
// Scroll-map gimmicks (plan Phase E/F). All reuse the flat Entity struct — no
// new hash fields. The wall AABB is the single field-mapping source of truth
// (plan E1): both the movement-slide resolver and the LOS segment test read it.
// ---------------------------------------------------------------------------

/**
 * Spawn a rectangular cover wall (AABB).
 *
 * FIELD MAPPING — SINGLE SOURCE OF TRUTH (plan E1, do not redefine elsewhere):
 *   - `radius`  = half-WIDTH  (halfW) of the axis-aligned box
 *   - `targetX` = half-HEIGHT (halfH) of the axis-aligned box
 * A square wall is `targetX === radius`. Both the circle-vs-AABB movement slide
 * (src/sim/los.ts) and the segment-vs-AABB LOS test read exactly these two
 * fields — never introduce a parallel half-extent field.
 */
export function spawnWall(sink: EntitySink, x: number, y: number, halfW: number, halfH: number): Entity {
  const w = blankEntity('wall');
  w.x = x;
  w.y = y;
  w.radius = halfW; // half-width  (single source — see mapping above)
  w.targetX = halfH; // half-height (single source — see mapping above)
  return addEntity(sink, w);
}

/** Spawn a destructible object: `hp` > 0, drops a gem worth `xpValue` when broken. */
export function spawnDestructible(
  sink: EntitySink,
  x: number,
  y: number,
  radius: number,
  hp: number,
  xpValue: number,
): Entity {
  const d = blankEntity('destructible');
  d.x = x;
  d.y = y;
  d.radius = radius;
  d.hp = hp;
  d.maxHp = hp;
  d.damage = xpValue; // gem XP granted on destruction (mirrors spawnGem's slot use)
  return addEntity(sink, d);
}

/**
 * Spawn a proximity event object (magnet emitter / bomb device / turret pickup).
 * `radius` is the proximity trigger radius. Turret pickups use `phase` (0 =
 * dormant pickup, 1 = active turret) and `life` (active turret lifetime).
 */
export function spawnEventObject(
  sink: EntitySink,
  kind: 'magnetEmitter' | 'bombDevice' | 'turretPickup',
  x: number,
  y: number,
  radius: number,
): Entity {
  const e = blankEntity(kind);
  e.x = x;
  e.y = y;
  e.radius = radius;
  return addEntity(sink, e);
}

/**
 * Spawn the boss. Fields carry its fight state: `phase` (0/1/2), `timer` (phase
 * transition/animation countdown, 0 = fighting), `cooldown` (next pattern),
 * `iframes` (overheat window — takes double damage while > 0), `dashCooldown`
 * (overheat re-arm timer — the boss never dashes, so the field gates how often
 * the overheat window may re-open; see src/sim/boss.ts). `enemyType` tags render
 * variant.
 */
export function spawnBoss(sink: EntitySink, x: number, y: number, hp: number, radius: number): Entity {
  const b = blankEntity('boss');
  b.x = x;
  b.y = y;
  b.radius = radius;
  b.hp = hp;
  b.maxHp = hp;
  b.phase = 0;
  b.enemyType = 0;
  return addEntity(sink, b);
}
