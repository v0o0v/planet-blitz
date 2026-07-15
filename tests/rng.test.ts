import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/sim/rng.js';

describe('SeededRng', () => {
  it('is reproducible for the same seed', () => {
    const a = new SeededRng(1234);
    const b = new SeededRng(1234);
    const seqA = Array.from({ length: 50 }, () => a.nextU32());
    const seqB = Array.from({ length: 50 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    expect(a.nextU32()).not.toBe(b.nextU32());
  });

  it('nextFloat stays in [0, 1)', () => {
    const rng = new SeededRng(9);
    for (let i = 0; i < 10000; i++) {
      const f = rng.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('int stays within inclusive bounds', () => {
    const rng = new SeededRng(55);
    for (let i = 0; i < 10000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });

  it('forked streams are reproducible and independent', () => {
    const base1 = new SeededRng(100);
    const base2 = new SeededRng(100);
    const wavesA = base1.fork('waves');
    const wavesB = base2.fork('waves');
    // Same base seed + same stream id => identical streams.
    expect(wavesA.nextU32()).toBe(wavesB.nextU32());

    const base3 = new SeededRng(100);
    const drops = base3.fork('drops');
    const waves = base3.fork('waves');
    // Different stream ids from the same base diverge.
    expect(drops.nextU32()).not.toBe(waves.nextU32());
  });

  it('state save/restore reproduces the sequence', () => {
    const rng = new SeededRng(321);
    rng.nextU32();
    rng.nextU32();
    const saved = rng.getState();
    const next = rng.nextU32();

    const restored = SeededRng.fromState(saved);
    expect(restored.nextU32()).toBe(next);
  });

  it('has reasonable uniformity across buckets', () => {
    const rng = new SeededRng(2024);
    const buckets = new Array(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) {
      buckets[Math.floor(rng.nextFloat() * 10)]++;
    }
    // Each bucket within 15% of the expected 10%.
    for (const b of buckets) {
      expect(b).toBeGreaterThan(n * 0.085);
      expect(b).toBeLessThan(n * 0.115);
    }
  });
});
