/**
 * Uniform spatial-hash grid for broad-phase collision queries (M1 Phase 2).
 *
 * Bullet-hell combat pairs up to ~2,000 bullets against dozens of enemies every
 * tick. A naive O(bullets * enemies) sweep is quadratic; this grid buckets
 * entities into fixed-size cells so each query only visits the handful of cells
 * overlapping a probe circle.
 *
 * Determinism (ADR-0005): the grid never iterates the backing `Map`. Cell keys
 * are computed arithmetically and cells are visited in a fixed (cy, cx) nested
 * order; within a cell, entities keep their insertion order. Because callers
 * insert in entity-array order, every query yields candidates in a stable,
 * seed-independent order — safe to drive damage resolution from.
 */

/** Minimal shape the grid needs from an entity. */
export interface Spatial {
  x: number;
  y: number;
  radius: number;
}

export class SpatialHash<T extends Spatial> {
  private readonly cellSize: number;
  /**
   * Sparse bucket map keyed by an integer cell key. Unbounded (infinite map):
   * only occupied cells are allocated, so the grid tracks entities at any
   * coordinate without a fixed extent. The map is NEVER iterated directly —
   * cell keys are computed arithmetically and cells are visited in a fixed
   * (cy, cx) order (see `query`), preserving the determinism contract above.
   */
  private readonly cells = new Map<number, T[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.cells.clear();
  }

  /**
   * Deterministic non-negative integer key for a signed cell (cx, cy). Each
   * axis is first folded into the naturals with Szudzik's pairing
   * (`z >= 0 ? 2z : -2z - 1`) so negative coordinates cannot collide with their
   * positive mirror, then the two folds are mixed with the classic large-prime
   * multiply/XOR and masked to a uint32. Pure integer arithmetic — identical on
   * every platform.
   */
  private cellKey(cx: number, cy: number): number {
    const a = cx >= 0 ? 2 * cx : -2 * cx - 1;
    const b = cy >= 0 ? 2 * cy : -2 * cy - 1;
    return ((a * 73856093) ^ (b * 19349663)) >>> 0;
  }

  /** Insert an entity into the cell containing its current position. */
  insert(entity: T): void {
    const cx = Math.floor(entity.x / this.cellSize);
    const cy = Math.floor(entity.y / this.cellSize);
    const key = this.cellKey(cx, cy);
    let bucket = this.cells.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(entity);
  }

  /**
   * Visit every inserted entity whose cell overlaps the circle (x, y, radius).
   * The callback may be invoked for entities slightly outside the circle (the
   * grid is broad-phase only) — callers do the exact distance test. Iteration
   * order is deterministic: cells in a fixed (cy, cx) nested order, entities
   * within a cell in insertion order.
   */
  query(x: number, y: number, radius: number, cb: (entity: T) => void): void {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells.get(this.cellKey(cx, cy));
        if (bucket === undefined) continue;
        for (const entity of bucket) {
          cb(entity);
        }
      }
    }
  }
}

/** True when two circles overlap. Basic ops only (deterministic). */
export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}
