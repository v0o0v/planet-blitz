/**
 * Wall geometry primitives — line-of-sight and circle-vs-AABB collision (plan
 * Phase F1). Leaf module: pure functions over the wall entity's half-extent
 * fields, no world state. Deterministic by construction — only basic IEEE-754
 * arithmetic and comparisons (no platform trig), so results are bit-identical
 * across engines (ADR-0005).
 *
 * WALL FIELD MAPPING (single source — plan E1, see entities.spawnWall):
 *   half-width  = wall.radius
 *   half-height = wall.targetX
 * Every function here reads exactly those two fields; nothing redefines them.
 */

import type { Entity } from './entities.js';

/** Wall half-width (single source). */
export function wallHalfW(w: Entity): number {
  return w.radius;
}

/** Wall half-height (single source). */
export function wallHalfH(w: Entity): number {
  return w.targetX;
}

/** True when circle (cx, cy, cr) overlaps the wall's AABB (exact nearest-point test). */
export function circleOverlapsWall(cx: number, cy: number, cr: number, w: Entity): boolean {
  const hw = w.radius;
  const hh = w.targetX;
  // Nearest point on the AABB to the circle centre (clamp).
  let nx = cx;
  if (nx < w.x - hw) nx = w.x - hw;
  else if (nx > w.x + hw) nx = w.x + hw;
  let ny = cy;
  if (ny < w.y - hh) ny = w.y - hh;
  else if (ny > w.y + hh) ny = w.y + hh;
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= cr * cr;
}

/** Result of sliding a circle out of overlapping walls. */
export interface SlideResult {
  x: number;
  y: number;
  /** True if the circle overlapped (and was pushed out of) at least one wall. */
  hit: boolean;
}

/**
 * Resolve a moving circle (radius `r`) against a set of walls by axis-separated
 * minimum-penetration push (the circle is approximated by its bounding box for
 * the push, which is exact on faces and conservative at corners — adequate for
 * M1 cover). Walls are visited in array order (deterministic); overlapping walls
 * resolve sequentially. Returns the corrected position and whether anything was
 * hit (used to trigger the charger's wall-impact fragments burst).
 */
export function slideCircleWalls(x: number, y: number, r: number, walls: readonly Entity[]): SlideResult {
  let hit = false;
  for (const w of walls) {
    const hw = w.radius + r; // Minkowski-expanded half-extents
    const hh = w.targetX + r;
    const dx = x - w.x;
    const dy = y - w.y;
    if (dx > -hw && dx < hw && dy > -hh && dy < hh) {
      // Overlapping: push out along the axis of least penetration.
      const penX = hw - (dx < 0 ? -dx : dx);
      const penY = hh - (dy < 0 ? -dy : dy);
      if (penX < penY) {
        x = w.x + (dx >= 0 ? hw : -hw);
      } else {
        y = w.y + (dy >= 0 ? hh : -hh);
      }
      hit = true;
    }
  }
  return { x, y, hit };
}

/**
 * True when the segment (x1,y1)-(x2,y2) intersects the wall's AABB. Liang-Barsky
 * parametric clip using only basic arithmetic (deterministic). Used by the LOS
 * targeting filter: a candidate is "blocked" when the player→candidate segment
 * crosses any active wall.
 */
export function segmentIntersectsWall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: Entity,
): boolean {
  const minX = w.x - w.radius;
  const maxX = w.x + w.radius;
  const minY = w.y - w.targetX;
  const maxY = w.y + w.targetX;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];
  for (let i = 0; i < 4; i++) {
    const pi = p[i] as number;
    const qi = q[i] as number;
    if (pi === 0) {
      // Parallel to this slab: outside it means no intersection.
      if (qi < 0) return false;
    } else {
      const t = qi / pi;
      if (pi < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

/** True when any wall blocks the segment (from)->(to). */
export function segmentBlocked(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  walls: readonly Entity[],
): boolean {
  for (const w of walls) {
    if (segmentIntersectsWall(fromX, fromY, toX, toY, w)) return true;
  }
  return false;
}
