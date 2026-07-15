/**
 * Deterministic procedural chunk placement for the infinite scroll map (plan
 * Phase E). The world is diced into fixed-size square chunks; the gimmicks in a
 * chunk are a PURE FUNCTION of (seed, chunk coordinate) — never of the path the
 * player took to reach it. Two players who arrive at the same chunk by different
 * routes therefore see the exact same layout (AC3, path independence).
 *
 * Purity is achieved with `SeededRng.fork`: `worldRng.fork('chunk:cx:cy')`
 * derives an independent generator from the (constant) world stream and the
 * chunk id, and `fork` does NOT advance the parent — so the draw depends only on
 * the coordinate, not on visitation order. This module is a leaf: it produces
 * plain placement descriptors and never touches world state, so world.ts owns
 * spawning/culling.
 */

import type { SeededRng } from './rng.js';

/** Chunk edge length in world units. */
export const CHUNK_SIZE = 1024;

/**
 * Chunks within this Chebyshev radius of the origin chunk stay EMPTY — a safe
 * spawn zone so the player never materialises inside a wall/hazard at (0,0).
 * Radius 1 clears a 3x3 block of chunks around the origin.
 */
export const SAFE_CHUNK_RADIUS = 1;

/**
 * Generation vs. cull radii (world units), with hysteresis: CULL > GEN.
 *
 * A chunk is generated once its centre is within `CHUNK_GEN_RADIUS` of the
 * player and culled once its centre passes `CHUNK_CULL_RADIUS`. Keeping the cull
 * radius strictly LARGER than the generation radius gives a dead-band: a freshly
 * generated chunk is not immediately eligible for culling, so a player loitering
 * near the boundary cannot thrash a chunk generate→cull→generate every tick.
 * Both stay below PROJECTILE_CULL_RADIUS (~3304) so nothing surprising overlaps.
 */
export const CHUNK_GEN_RADIUS = 2200;
export const CHUNK_CULL_RADIUS = 3000;

/**
 * Hard cap on simultaneously active gimmick entities across the whole active
 * region. When generation would exceed it, remaining chunks in the fixed scan
 * order are deferred (not generated this tick) — bounding the per-tick cost of
 * wall slides, LOS checks and culling regardless of placement density.
 */
export const MAX_ACTIVE_GIMMICKS = 48;

/** Keep a placement this far inside the chunk so its centre's chunk is unambiguous. */
const PLACE_MARGIN = 170;

/** Wall half-extent bounds. Min ≥ 60 so a full width (120) exceeds the max dash
 *  step (~59u/tick at dashSpeed 2800) and the player cannot tunnel a wall. */
const WALL_HALF_MIN = 60;
const WALL_HALF_MAX = 150;

/** Gimmick tuning constants (world units / hit points). */
export const DESTRUCTIBLE_RADIUS = 48;
export const DESTRUCTIBLE_HP = 30;
export const DESTRUCTIBLE_GEM_XP = 5;
export const TERRAIN_HAZARD_RADIUS = 120;
export const TERRAIN_HAZARD_DAMAGE = 10;
/** Hazard subtype tag for chunk-placed terrain hazards (distinct from mortar/lava). */
export const HAZARD_TERRAIN = 2;
export const EVENT_TRIGGER_RADIUS = 70;

/** One placed gimmick, in absolute world coordinates. `world.ts` turns these into
 *  entities. Fields not relevant to a kind stay at their zero defaults. */
export interface GimmickPlacement {
  kind: 'wall' | 'destructible' | 'hazard' | 'magnetEmitter' | 'bombDevice' | 'turretPickup';
  x: number;
  y: number;
  /** Wall half-width (radius) / event or hazard trigger radius / destructible radius. */
  radius: number;
  /** Wall half-height (targetX); 0 for non-walls. */
  halfH: number;
  /** Destructible hit points / 0. */
  hp: number;
  /** Destructible gem XP / hazard damage / 0. */
  value: number;
  /** Hazard subtype tag / 0. */
  sub: number;
}

/**
 * Derive the independent, order-independent RNG for one chunk. Pure in
 * (worldRng state, cx, cy) — `fork` never advances `worldRng`.
 */
export function chunkRngFor(worldRng: SeededRng, cx: number, cy: number): SeededRng {
  return worldRng.fork(`chunk:${cx}:${cy}`);
}

/**
 * Deterministic gimmick layout for chunk (cx, cy). Origin-safe chunks return an
 * empty list. Otherwise 0..3 gimmicks are drawn, each with a type and a position
 * kept a margin inside the chunk (so `floor(pos / CHUNK_SIZE)` recovers this
 * chunk — used by the culling code to map a gimmick back to its chunk).
 */
export function chunkPlacements(worldRng: SeededRng, cx: number, cy: number): GimmickPlacement[] {
  const out: GimmickPlacement[] = [];
  if (Math.max(Math.abs(cx), Math.abs(cy)) <= SAFE_CHUNK_RADIUS) return out;

  const rng = chunkRngFor(worldRng, cx, cy);
  const baseX = cx * CHUNK_SIZE;
  const baseY = cy * CHUNK_SIZE;
  const count = rng.int(0, 3);
  for (let i = 0; i < count; i++) {
    const x = baseX + rng.range(PLACE_MARGIN, CHUNK_SIZE - PLACE_MARGIN);
    const y = baseY + rng.range(PLACE_MARGIN, CHUNK_SIZE - PLACE_MARGIN);
    const roll = rng.int(0, 9);
    const g: GimmickPlacement = { kind: 'wall', x, y, radius: 0, halfH: 0, hp: 0, value: 0, sub: 0 };
    if (roll < 4) {
      // Wall (most common): rectangular cover.
      g.kind = 'wall';
      g.radius = rng.range(WALL_HALF_MIN, WALL_HALF_MAX);
      g.halfH = rng.range(WALL_HALF_MIN, WALL_HALF_MAX);
    } else if (roll < 6) {
      // Destructible object.
      g.kind = 'destructible';
      g.radius = DESTRUCTIBLE_RADIUS;
      g.hp = DESTRUCTIBLE_HP;
      g.value = DESTRUCTIBLE_GEM_XP;
    } else if (roll < 7) {
      // Terrain hazard (permanent — no telegraph, never expires).
      g.kind = 'hazard';
      g.radius = TERRAIN_HAZARD_RADIUS;
      g.value = TERRAIN_HAZARD_DAMAGE;
      g.sub = HAZARD_TERRAIN;
    } else if (roll < 8) {
      g.kind = 'magnetEmitter';
      g.radius = EVENT_TRIGGER_RADIUS;
    } else if (roll < 9) {
      g.kind = 'bombDevice';
      g.radius = EVENT_TRIGGER_RADIUS;
    } else {
      g.kind = 'turretPickup';
      g.radius = EVENT_TRIGGER_RADIUS;
    }
    out.push(g);
  }
  return out;
}
