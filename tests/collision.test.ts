import { describe, it, expect } from 'vitest';
import { SpatialHash, circlesOverlap } from '../src/sim/collision.js';

interface P {
  x: number;
  y: number;
  radius: number;
  id: number;
}

describe('SpatialHash', () => {
  it('returns candidates near a probe and skips far cells', () => {
    const grid = new SpatialHash<P>(1920, 1080, 128);
    const near: P = { x: 100, y: 100, radius: 8, id: 1 };
    const far: P = { x: 1800, y: 1000, radius: 8, id: 2 };
    grid.insert(near);
    grid.insert(far);

    const hits: number[] = [];
    grid.query(100, 100, 20, (e) => hits.push(e.id));
    expect(hits).toContain(1);
    expect(hits).not.toContain(2);
  });

  it('iterates candidates in deterministic insertion order', () => {
    const grid = new SpatialHash<P>(512, 512, 64);
    // Same cell, inserted in a known order.
    for (let i = 0; i < 5; i++) grid.insert({ x: 40, y: 40, radius: 4, id: i });
    const seen: number[] = [];
    grid.query(40, 40, 10, (e) => seen.push(e.id));
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  it('clear empties the grid', () => {
    const grid = new SpatialHash<P>(256, 256, 64);
    grid.insert({ x: 10, y: 10, radius: 4, id: 7 });
    grid.clear();
    const seen: number[] = [];
    grid.query(10, 10, 20, (e) => seen.push(e.id));
    expect(seen).toEqual([]);
  });

  it('finds entities across adjacent cell boundaries', () => {
    const grid = new SpatialHash<P>(512, 512, 64);
    // Straddle the 64px cell boundary at x=64.
    const a: P = { x: 60, y: 60, radius: 8, id: 1 };
    const b: P = { x: 68, y: 60, radius: 8, id: 2 };
    grid.insert(a);
    grid.insert(b);
    const seen = new Set<number>();
    grid.query(64, 60, 10, (e) => seen.add(e.id));
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
  });
});

describe('circlesOverlap', () => {
  it('detects overlap and separation', () => {
    expect(circlesOverlap(0, 0, 10, 5, 0, 10)).toBe(true);
    expect(circlesOverlap(0, 0, 10, 100, 0, 10)).toBe(false);
    // Exactly touching counts as overlap.
    expect(circlesOverlap(0, 0, 10, 20, 0, 10)).toBe(true);
  });
});
