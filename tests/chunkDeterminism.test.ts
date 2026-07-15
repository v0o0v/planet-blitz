import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { chunkPlacements, CHUNK_SIZE } from '../src/sim/chunks.js';
import type { GimmickPlacement } from '../src/sim/chunks.js';
import type { Entity } from '../src/sim/entities.js';
import { runReplay } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import type { InputFrame } from '../src/sim/world.js';
import { SeededRng } from '../src/sim/rng.js';

/**
 * Phase E — chunk placement is a pure function of (seed, chunk coordinate): the
 * layout of a chunk never depends on how (or in what order) it was reached
 * (AC3, path independence). Full-scale digest comparison is the G worker's job;
 * these are smokes.
 */

function digest(gs: GimmickPlacement[]): string {
  return gs
    .map((g) => `${g.kind}:${g.x}:${g.y}:${g.radius}:${g.halfH}`)
    .sort()
    .join('|');
}

describe('chunk placement determinism (plan E, AC3)', () => {
  it('is a pure function of chunk coordinate (same seed → same layout)', () => {
    const a = createWorld(0xabc);
    const b = createWorld(0xabc);
    for (const [cx, cy] of [
      [2, 0],
      [-3, 5],
      [7, -4],
    ] as const) {
      expect(digest(chunkPlacements(a.worldRng, cx, cy))).toBe(
        digest(chunkPlacements(b.worldRng, cx, cy)),
      );
    }
  });

  it('does not depend on the order chunks are queried', () => {
    const w = createWorld(0xabc);
    const forward = [
      digest(chunkPlacements(w.worldRng, 2, 3)),
      digest(chunkPlacements(w.worldRng, 5, -1)),
      digest(chunkPlacements(w.worldRng, -6, 2)),
    ];
    const reverse = [
      digest(chunkPlacements(w.worldRng, -6, 2)),
      digest(chunkPlacements(w.worldRng, 5, -1)),
      digest(chunkPlacements(w.worldRng, 2, 3)),
    ];
    expect(forward).toEqual([reverse[2], reverse[1], reverse[0]]);
  });

  it('diverges between seeds for at least one chunk', () => {
    const a = createWorld(1);
    const b = createWorld(2);
    let anyDiff = false;
    for (let cx = 2; cx < 8; cx++) {
      if (digest(chunkPlacements(a.worldRng, cx, 0)) !== digest(chunkPlacements(b.worldRng, cx, 0))) {
        anyDiff = true;
        break;
      }
    }
    expect(anyDiff).toBe(true);
  });

  it('a run that roams into gimmick territory replays to identical hashes', () => {
    // Move far off the origin safe zone so walls/hazards/events generate, cull,
    // and re-generate — all under the deterministic hash.
    const gen = new SeededRng(555);
    const inputs: InputFrame[] = [];
    for (let t = 0; t < 60 * 12; t++) {
      inputs.push({
        moveX: gen.range(-1, 1),
        moveY: gen.range(-1, 1),
        aim: gen.range(-Math.PI, Math.PI),
        dash: gen.chance(0.04),
        special: 0,
      });
    }
    const replay: Replay = { seed: 0x1234, inputs };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
  });

  it('reaching the same chunk by different paths yields the identical placement digest', () => {
    // AC3 formal check: drive two worlds (same seed) along DIFFERENT movement
    // paths, then compare the sorted (kind, x, y) placement digest per chunk for
    // every chunk both worlds have active. Digest excludes entityId/insertion
    // order — path independence must hold on coordinates + kind alone.
    const GIMMICK_KINDS = ['wall', 'destructible', 'magnetEmitter', 'bombDevice', 'turretPickup'];
    const isGimmick = (e: Entity): boolean =>
      GIMMICK_KINDS.includes(e.kind) || (e.kind === 'hazard' && e.life < 0);

    /** Map<chunkKey, sorted (kind,x,y) digest of that chunk's live gimmicks>. */
    function digestByChunk(legs: readonly { mx: number; my: number; ticks: number }[]): Map<string, string> {
      const state: WorldState = createWorld(0x2468);
      state.wave.done = true; // silence waves; only chunk gimmicks matter
      for (const leg of legs) {
        for (let t = 0; t < leg.ticks; t++) {
          stepWorld(state, { moveX: leg.mx, moveY: leg.my, aim: 0, dash: false, special: 0 });
        }
      }
      const byChunk = new Map<string, string[]>();
      for (const e of state.entities) {
        if (e.dead || !isGimmick(e)) continue;
        const cx = Math.floor(e.x / CHUNK_SIZE);
        const cy = Math.floor(e.y / CHUNK_SIZE);
        const ckey = `${cx},${cy}`;
        const arr = byChunk.get(ckey) ?? [];
        arr.push(`${e.kind}:${e.x}:${e.y}:${e.radius}:${e.targetX}`);
        byChunk.set(ckey, arr);
      }
      const out = new Map<string, string>();
      for (const [ckey, arr] of byChunk) out.set(ckey, arr.sort().join('|'));
      return out;
    }

    // Path A: right, then up. Path B: up, then right. Both cover an overlapping
    // region so many chunks are active in both worlds.
    const a = digestByChunk([
      { mx: 1, my: 0, ticks: 260 },
      { mx: 0, my: -1, ticks: 260 },
    ]);
    const b = digestByChunk([
      { mx: 0, my: -1, ticks: 260 },
      { mx: 1, my: 0, ticks: 260 },
    ]);

    let shared = 0;
    for (const [ckey, digestA] of a) {
      const digestB = b.get(ckey);
      if (digestB === undefined) continue;
      shared++;
      expect(digestB).toBe(digestA);
    }
    // The two paths must genuinely overlap (otherwise the assertion is vacuous).
    expect(shared).toBeGreaterThan(3);
  });

  it('actually generates gimmick entities once the player leaves the safe zone', () => {
    const state: WorldState = createWorld(0x777);
    // Walk straight right for a few seconds to reach chunk territory.
    for (let t = 0; t < 60 * 6; t++) stepWorld(state, { moveX: 1, moveY: 0, aim: 0, dash: false, special: 0 });
    const gimmicks = state.entities.filter((e) =>
      ['wall', 'destructible', 'magnetEmitter', 'bombDevice', 'turretPickup'].includes(e.kind) ||
      (e.kind === 'hazard' && e.life < 0),
    );
    expect(gimmicks.length).toBeGreaterThan(0);
  });
});
