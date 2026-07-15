import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/sim/rng.js';
import { createWorld, stepWorld, TICK_RATE } from '../src/sim/world.js';
import type { InputFrame } from '../src/sim/world.js';
import { runReplay, hashWorld, idleInputs } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';

/**
 * Build a deterministic, non-trivial input log that exercises movement, aiming
 * and dashing. Inputs are generated from a *separate* seeded RNG so the log
 * itself is reproducible but independent of the sim's internal RNG.
 */
function makeInputLog(seed: number, ticks: number): InputFrame[] {
  const gen = new SeededRng(seed);
  const inputs: InputFrame[] = [];
  for (let t = 0; t < ticks; t++) {
    inputs.push({
      moveX: gen.range(-1, 1),
      moveY: gen.range(-1, 1),
      aim: gen.range(-Math.PI, Math.PI),
      dash: gen.chance(0.05),
      special: 0,
    });
  }
  return inputs;
}

describe('deterministic replay (ADR-0005)', () => {
  it('produces identical per-tick hashes across two runs (idle input)', () => {
    const replay: Replay = { seed: 12345, inputs: idleInputs(600) };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.hashes.length).toBe(600);
  });

  it('produces identical per-tick hashes across a long roaming run (gimmicks/walls/LOS/chunks)', () => {
    // G2 determinism gate: idle/near-origin logs never leave the safe zone, so
    // they don't exercise chunk generation, wall slides, bullet-vs-wall or LOS.
    // This log drifts far off the origin (dashing) so walls, hazards, events and
    // chunk cull/regen all fire — the whole scroll-map surface under one hash.
    const gen = new SeededRng(0x1357);
    const ticks = 60 * 40; // 40 seconds
    const inputs: InputFrame[] = [];
    for (let t = 0; t < ticks; t++) {
      // Outward drift (diagonal) plus noise so the player genuinely roams into
      // gimmick territory instead of random-walking in place.
      inputs.push({
        moveX: 0.7 + gen.range(-0.5, 0.5),
        moveY: -0.7 + gen.range(-0.5, 0.5),
        aim: gen.range(-Math.PI, Math.PI),
        dash: gen.chance(0.06),
        special: 0,
      });
    }
    const replay: Replay = { seed: 0xbeef, inputs };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.hashes.length).toBe(ticks);
    // Sanity: the run really left the safe zone and materialised gimmicks.
    const player = a.finalState.entities[0]!;
    expect(Math.hypot(player.x, player.y)).toBeGreaterThan(2000);
    const gimmicks = a.finalState.entities.filter((e) =>
      ['wall', 'destructible', 'magnetEmitter', 'bombDevice', 'turretPickup'].includes(e.kind) ||
      (e.kind === 'hazard' && e.life < 0),
    );
    expect(gimmicks.length).toBeGreaterThan(0);
  });

  it('produces identical per-tick hashes across two runs (active input)', () => {
    const replay: Replay = { seed: 0xdecaf, inputs: makeInputLog(777, 60 * 8) };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
    // 8 seconds at 60 Hz.
    expect(a.hashes.length).toBe(60 * 8);
  });

  it('matches a freshly stepped world tick-for-tick', () => {
    const seed = 42;
    const inputs = makeInputLog(99, 300);
    const replay: Replay = { seed, inputs };
    const { hashes } = runReplay(replay);

    // Independently re-run with the low-level stepWorld loop.
    const state = createWorld(seed);
    const manual: number[] = [];
    for (const input of inputs) {
      stepWorld(state, input);
      manual.push(hashWorld(state));
    }
    expect(manual).toEqual(hashes);
  });

  it('diverges for different seeds', () => {
    const inputs = idleInputs(120);
    const a = runReplay({ seed: 1, inputs });
    const b = runReplay({ seed: 2, inputs });
    expect(a.finalHash).not.toBe(b.finalHash);
  });

  it('diverges for different input logs on the same seed', () => {
    const a = runReplay({ seed: 5, inputs: makeInputLog(1, 120) });
    const b = runReplay({ seed: 5, inputs: makeInputLog(2, 120) });
    expect(a.finalHash).not.toBe(b.finalHash);
  });

  it('actually evolves state over time (entities move)', () => {
    const inputs = idleInputs(120);
    const { hashes } = runReplay({ seed: 7, inputs });
    // Consecutive ticks should generally differ (dummies wander even when idle).
    const distinct = new Set(hashes);
    expect(distinct.size).toBeGreaterThan(100);
  });

  it('player dash moves the player further than a plain step', () => {
    const dashLog: InputFrame[] = [
      { moveX: 1, moveY: 0, aim: 0, dash: true, special: 0 },
    ];
    const walkLog: InputFrame[] = [
      { moveX: 1, moveY: 0, aim: 0, dash: false, special: 0 },
    ];
    const dashed = runReplay({ seed: 3, inputs: dashLog }).finalState.entities[0];
    const walked = runReplay({ seed: 3, inputs: walkLog }).finalState.entities[0];
    expect(dashed).toBeDefined();
    expect(walked).toBeDefined();
    expect(dashed!.x).toBeGreaterThan(walked!.x);
  });

  it('exposes the expected tick rate', () => {
    expect(TICK_RATE).toBe(60);
  });
});
