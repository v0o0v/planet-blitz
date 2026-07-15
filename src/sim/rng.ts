/**
 * Seeded deterministic RNG for the simulation core (ADR-0005).
 *
 * `Math.random` is banned in the sim core — all randomness flows through a
 * seeded generator so a run is fully reproducible from [seed + input log].
 *
 * Algorithm: mulberry32. A single-word (uint32) state PRNG that is fast, has a
 * 2^32 period, and passes gjrand/small-crush well enough for game use. It uses
 * only integer operations (`Math.imul`, shifts, `>>> 0`), which are exact and
 * therefore deterministic on every platform.
 *
 * Stream separation: {@link SeededRng.fork} derives an independent generator
 * from a base generator plus a string/number stream id, so subsystems (waves,
 * enemy patterns, drops, ...) can each draw from an isolated stream without one
 * consuming another's sequence. This keeps runs stable when unrelated systems
 * change how many numbers they pull.
 */

/** SplitMix32 finalizer — used to hash seeds and mix stream ids. */
function mix32(x: number): number {
  x = x >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x = x ^ (x >>> 15);
  return x >>> 0;
}

/** Deterministically fold a string into a uint32 (FNV-1a). */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class SeededRng {
  /** Current internal state (uint32). Exposed for hashing/serialization. */
  private state: number;

  constructor(seed: number) {
    this.state = mix32(seed >>> 0);
  }

  /** Restore a generator from a previously captured raw state. */
  static fromState(state: number): SeededRng {
    const rng = new SeededRng(0);
    rng.state = state >>> 0;
    return rng;
  }

  /** Raw uint32 state — for world hashing and snapshot/restore. */
  getState(): number {
    return this.state >>> 0;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }

  /** Next raw uint32 in [0, 2^32). */
  nextU32(): number {
    // mulberry32 step.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Next float in [0, 1). 32-bit resolution. */
  nextFloat(): number {
    return this.nextU32() / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.nextFloat();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    const span = max - min + 1;
    return min + (this.nextU32() % span);
  }

  /** True with the given probability p in [0, 1]. */
  chance(p: number): boolean {
    return this.nextFloat() < p;
  }

  /**
   * Derive an independent generator for a named stream. The child seed is a
   * deterministic mix of this generator's current state and the stream id, so
   * the same (base seed, stream id) always yields the same child sequence.
   */
  fork(streamId: string | number): SeededRng {
    const idHash =
      typeof streamId === 'number' ? mix32(streamId >>> 0) : hashString(streamId);
    return new SeededRng(mix32(this.state ^ idHash));
  }
}
