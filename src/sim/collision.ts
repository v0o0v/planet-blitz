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
  private readonly cols: number;
  private readonly rows: number;
  private readonly cells: (T[] | undefined)[];

  constructor(width: number, height: number, cellSize: number) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize) + 1);
    this.rows = Math.max(1, Math.ceil(height / cellSize) + 1);
    this.cells = new Array<T[] | undefined>(this.cols * this.rows);
  }

  clear(): void {
    this.cells.fill(undefined);
  }

  private cellIndex(cx: number, cy: number): number {
    const col = cx < 0 ? 0 : cx >= this.cols ? this.cols - 1 : cx;
    const row = cy < 0 ? 0 : cy >= this.rows ? this.rows - 1 : cy;
    return row * this.cols + col;
  }

  /** Insert an entity at its current position (clamped into the grid). */
  insert(entity: T): void {
    const cx = Math.floor(entity.x / this.cellSize);
    const cy = Math.floor(entity.y / this.cellSize);
    const idx = this.cellIndex(cx, cy);
    let bucket = this.cells[idx];
    if (bucket === undefined) {
      bucket = [];
      this.cells[idx] = bucket;
    }
    bucket.push(entity);
  }

  /**
   * Visit every inserted entity whose cell overlaps the circle (x, y, radius).
   * The callback may be invoked for entities slightly outside the circle (the
   * grid is broad-phase only) — callers do the exact distance test. Iteration
   * order is deterministic.
   */
  query(x: number, y: number, radius: number, cb: (entity: T) => void): void {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells[this.cellIndex(cx, cy)];
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
