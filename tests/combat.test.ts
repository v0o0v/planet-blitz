import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/sim/rng.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldState } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import { runReplay, hashWorld } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';

/** Reproducible active input log (movement + aim + occasional dash). */
function makeInputLog(seed: number, ticks: number): InputFrame[] {
  const gen = new SeededRng(seed);
  const inputs: InputFrame[] = [];
  for (let t = 0; t < ticks; t++) {
    inputs.push({
      moveX: gen.range(-1, 1),
      moveY: gen.range(-1, 1),
      aim: gen.range(-Math.PI, Math.PI),
      dash: gen.chance(0.03),
      special: 0,
    });
  }
  return inputs;
}

function countKind(state: WorldState, kind: string): number {
  return state.entities.filter((e) => e.kind === kind).length;
}

describe('combat determinism (ADR-0005, enemies + bullets + waves)', () => {
  it('produces identical per-tick hashes across two runs with active combat', () => {
    // 25s: enough for several wave cards, thousands of bullets, hazards, kills.
    const replay: Replay = { seed: 0xc0ffee, inputs: makeInputLog(2024, 60 * 25) };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
  });

  it('actually spawns enemies, bullets and gems during a run', () => {
    const { finalState } = runReplay({ seed: 7, inputs: makeInputLog(1, 60 * 20) });
    // The player must have fired (friendly bullets exist or enemies were killed).
    expect(finalState.kills).toBeGreaterThan(0);
    expect(finalState.entities.length).toBeGreaterThan(1);
  });

  it('wave composition diverges by seed but the player is always index 0', () => {
    const a = runReplay({ seed: 11, inputs: makeInputLog(1, 60 * 8) });
    const b = runReplay({ seed: 99, inputs: makeInputLog(1, 60 * 8) });
    expect(a.finalHash).not.toBe(b.finalHash);
    expect(a.finalState.entities[0]?.kind).toBe('player');
    expect(b.finalState.entities[0]?.kind).toBe('player');
  });

  it('never exceeds the segment enemy-bullet cap', () => {
    const state = createWorld(0xbeef);
    const inputs = makeInputLog(5, 60 * 30);
    for (const input of inputs) {
      stepWorld(state, input);
      expect(countKind(state, 'enemyBullet')).toBeLessThanOrEqual(state.bulletCap);
    }
  });

  it('deals contact damage to the player and grants i-frames', () => {
    const state = createWorld(1);
    const player = state.entities[0]!;
    const hp0 = player.hp;
    // Drop a charger directly on the player.
    const enemy = blankEntity('enemy');
    enemy.x = player.x;
    enemy.y = player.y;
    enemy.radius = 18;
    enemy.hp = 999;
    enemy.maxHp = 999;
    enemy.damage = 12;
    enemy.enemyType = 0; // charger
    addEntity(state, enemy);

    stepWorld(state, { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 });
    expect(player.hp).toBeLessThan(hp0);
    expect(player.iframes).toBeGreaterThan(0);
  });

  it('auto-attack destroys a weak nearby enemy and drops a gem', () => {
    const state = createWorld(2);
    const player = state.entities[0]!;
    const enemy = blankEntity('enemy');
    enemy.x = player.x + 120;
    enemy.y = player.y;
    enemy.radius = 14;
    enemy.hp = 6; // one vulcan hit
    enemy.maxHp = 6;
    enemy.damage = 0;
    enemy.enemyType = 1; // gunner (keeps its distance, stays targetable)
    addEntity(state, enemy);

    const kills0 = state.kills;
    for (let i = 0; i < 30; i++) {
      stepWorld(state, { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 });
    }
    expect(state.kills).toBeGreaterThan(kills0);
    // A gem dropped: still on the field, or already magnet-collected (gems > 0).
    expect(state.entities.some((e) => e.kind === 'gem') || state.gems > 0).toBe(true);
  });

  it('charger sprays fragment bullets in open space when its cadence is ready', () => {
    // Infinite map: there are no arena walls to bounce off, so the charger's
    // fragments fire from the secondary periodic trigger (fireCooldown ready).
    const state = createWorld(3);
    const player = state.entities[0]!;
    // A charger charging in open space, well clear of the player, cadence ready.
    const charger = blankEntity('enemy');
    charger.x = player.x + 600;
    charger.y = player.y + 200;
    charger.vx = -300;
    charger.radius = 36;
    charger.hp = 100;
    charger.maxHp = 100;
    charger.enemyType = 0; // charger -> fragments
    charger.cooldown = 0; // fire this tick
    addEntity(state, charger);

    stepWorld(state, { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 });
    // charger-rush def sprays 4 fragments.
    const frags = state.entities.filter((e) => e.kind === 'enemyBullet');
    expect(frags.length).toBeGreaterThanOrEqual(4);
  });

  it('re-running from a fresh world matches runReplay tick-for-tick', () => {
    const seed = 4242;
    const inputs = makeInputLog(9, 500);
    const { hashes } = runReplay({ seed, inputs });
    const state = createWorld(seed);
    const manual: number[] = [];
    for (const input of inputs) {
      stepWorld(state, input);
      manual.push(hashWorld(state));
    }
    expect(manual).toEqual(hashes);
  });
});
