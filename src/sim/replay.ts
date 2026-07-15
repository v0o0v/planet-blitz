/**
 * Replay recording, playback and deterministic state hashing (ADR-0005).
 *
 * A replay is fully described by a seed plus the per-tick input log. Re-running
 * `[seed + inputs]` through the world must reproduce the exact same state on any
 * platform. To verify that cheaply we hash the world state after every tick and
 * compare hash streams — the client records hashes live, the server recomputes
 * them from the submitted replay, and any divergence flags a mismatch.
 *
 * The hash is FNV-1a (32-bit). Floating-point fields are hashed by their raw
 * IEEE-754 bit pattern (via a DataView), so two states hash equal only if every
 * double is bit-identical — the strongest possible determinism check.
 */

import type { InputFrame, WorldState, WorldConfig, Entity } from './world.js';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from './world.js';

/** A recorded run: everything needed to deterministically reproduce it. */
export interface Replay {
  seed: number;
  /** Optional config override; defaults are assumed when absent. */
  config?: WorldConfig;
  /** Input frame for each tick, in order. */
  inputs: InputFrame[];
}

// ---------------------------------------------------------------------------
// FNV-1a hashing with exact float64 bit patterns.
// ---------------------------------------------------------------------------

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const scratch = new ArrayBuffer(8);
const scratchF64 = new Float64Array(scratch);
const scratchBytes = new Uint8Array(scratch);

function fnvByte(hash: number, byte: number): number {
  return Math.imul(hash ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

/** Fold a float64's 8 raw bytes into the running hash. */
function hashFloat(hash: number, value: number): number {
  scratchF64[0] = value;
  let h = hash;
  for (let i = 0; i < 8; i++) {
    h = fnvByte(h, scratchBytes[i] as number);
  }
  return h;
}

/** Fold a uint32 into the running hash. */
function hashU32(hash: number, value: number): number {
  let h = hash;
  h = fnvByte(h, value & 0xff);
  h = fnvByte(h, (value >>> 8) & 0xff);
  h = fnvByte(h, (value >>> 16) & 0xff);
  h = fnvByte(h, (value >>> 24) & 0xff);
  return h;
}

function hashEntity(hash: number, e: Entity): number {
  let h = hash;
  h = hashU32(h, e.id);
  // Kind as a small stable code.
  h = hashU32(h, e.kind === 'player' ? 1 : 2);
  h = hashFloat(h, e.x);
  h = hashFloat(h, e.y);
  h = hashFloat(h, e.vx);
  h = hashFloat(h, e.vy);
  h = hashFloat(h, e.angle);
  h = hashFloat(h, e.radius);
  h = hashFloat(h, e.hp);
  h = hashU32(h, e.timer >>> 0);
  h = hashU32(h, e.dashCooldown >>> 0);
  h = hashU32(h, e.iframes >>> 0);
  return h;
}

/**
 * Deterministic 32-bit hash of a world state. Captures tick, RNG stream states
 * and every entity field (floats by exact bit pattern).
 */
export function hashWorld(state: WorldState): number {
  let h = FNV_OFFSET;
  h = hashU32(h, state.tick >>> 0);
  h = hashU32(h, state.rng.getState());
  h = hashU32(h, state.wanderRng.getState());
  h = hashU32(h, state.entities.length >>> 0);
  for (const e of state.entities) {
    h = hashEntity(h, e);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Recording & playback.
// ---------------------------------------------------------------------------

/**
 * Records the input log of a live run so it can be replayed/verified later.
 * The host loop calls {@link record} once per tick with the resolved input.
 */
export class ReplayRecorder {
  readonly seed: number;
  readonly config: WorldConfig;
  private readonly inputs: InputFrame[] = [];

  constructor(seed: number, config: WorldConfig = DEFAULT_CONFIG) {
    this.seed = seed;
    this.config = config;
  }

  record(input: InputFrame): void {
    // Store a copy so later mutation of a shared input object cannot corrupt it.
    this.inputs.push({ ...input });
  }

  get length(): number {
    return this.inputs.length;
  }

  toReplay(): Replay {
    return { seed: this.seed, config: this.config, inputs: this.inputs.map((i) => ({ ...i })) };
  }
}

/** Result of replaying a run to completion. */
export interface ReplayResult {
  finalState: WorldState;
  /** Hash of the world after each tick, in order. Length === inputs.length. */
  hashes: number[];
  /** Hash of the final state (also equal to the last element of `hashes`). */
  finalHash: number;
}

/**
 * Run a replay from scratch, capturing the per-tick state hash. Deterministic:
 * calling this twice with the same replay yields identical hash arrays.
 */
export function runReplay(replay: Replay): ReplayResult {
  const state = createWorld(replay.seed, replay.config ?? DEFAULT_CONFIG);
  const hashes: number[] = [];
  for (const input of replay.inputs) {
    stepWorld(state, input);
    hashes.push(hashWorld(state));
  }
  const finalHash = hashes.length > 0 ? (hashes[hashes.length - 1] as number) : hashWorld(state);
  return { finalState: state, hashes, finalHash };
}

/**
 * Advance an existing world by a full input log, returning per-tick hashes.
 * Useful for driving a live world while also collecting a hash stream.
 */
export function stepThrough(state: WorldState, inputs: InputFrame[]): number[] {
  const hashes: number[] = [];
  for (const input of inputs) {
    stepWorld(state, input);
    hashes.push(hashWorld(state));
  }
  return hashes;
}

/** Convenience: an input log of `n` idle ticks. */
export function idleInputs(n: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    out.push(emptyInput());
  }
  return out;
}
