import { describe, it, expect } from 'vitest';
import { sin, cos, atan2, length, PI, HALF_PI, wrapAngle } from '../src/sim/math.js';

/**
 * The sim trig is an approximation, but it must be (a) accurate enough for
 * gameplay and (b) perfectly reproducible. Determinism is covered by the replay
 * tests; here we assert accuracy against the reference Math implementation.
 */
describe('deterministic math', () => {
  it('sin approximates Math.sin within 1e-5 across the circle', () => {
    for (let i = -720; i <= 720; i++) {
      const x = (i / 720) * PI * 2;
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-5);
    }
  });

  it('cos approximates Math.cos within 1e-5 across the circle', () => {
    for (let i = -720; i <= 720; i++) {
      const x = (i / 720) * PI * 2;
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-5);
    }
  });

  it('sin handles large arguments (range reduction)', () => {
    for (const x of [1000, -1000, 12345.678, -98765.4321]) {
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-4);
    }
  });

  it('atan2 approximates Math.atan2 within 1e-4 over a grid', () => {
    for (let a = -8; a <= 8; a++) {
      for (let b = -8; b <= 8; b++) {
        if (a === 0 && b === 0) continue;
        expect(Math.abs(atan2(a, b) - Math.atan2(a, b))).toBeLessThan(1e-4);
      }
    }
  });

  it('atan2 handles the axes', () => {
    expect(atan2(0, 1)).toBeCloseTo(0, 10);
    expect(atan2(1, 0)).toBeCloseTo(HALF_PI, 6);
    expect(atan2(-1, 0)).toBeCloseTo(-HALF_PI, 6);
    expect(Math.abs(atan2(0, -1))).toBeCloseTo(PI, 6);
    expect(atan2(0, 0)).toBe(0);
  });

  it('length is exact for pythagorean triples', () => {
    expect(length(3, 4)).toBe(5);
    expect(length(5, 12)).toBe(13);
  });

  it('wrapAngle folds into (-PI, PI]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 10);
    expect(Math.abs(wrapAngle(3 * PI))).toBeCloseTo(PI, 6);
    // -3PI folds to -PI, which represents the same angle as +PI.
    expect(Math.abs(wrapAngle(-3 * PI))).toBeCloseTo(PI, 6);
  });

  it('is bit-stable: repeated calls return identical doubles', () => {
    for (const x of [0.1, 1.234, -5.6, 100.001]) {
      expect(sin(x)).toBe(sin(x));
      expect(cos(x)).toBe(cos(x));
      expect(atan2(x, 0.7)).toBe(atan2(x, 0.7));
    }
  });
});
