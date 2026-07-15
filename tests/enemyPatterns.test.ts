import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import { HAZARD_MORTAR, HAZARD_LAVA } from '../src/sim/patterns/types.js';
import { GUNNER, LAVA_SPRING } from '../data/enemies.js';

/** Spawn a live enemy of the given typeIndex at (x, y), ready to fire this tick. */
function spawnReadyEnemy(state: ReturnType<typeof createWorld>, typeIndex: number, x: number, y: number) {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = 16;
  e.hp = 1000; // survive the player's auto-attack during the probe
  e.maxHp = 1000;
  e.enemyType = typeIndex;
  e.cooldown = 0; // fire on the next tick
  return addEntity(state, e);
}

function hazardsOfSubtype(state: ReturnType<typeof createWorld>, subtype: number): number {
  return state.entities.filter((e) => e.kind === 'hazard' && e.enemyType === subtype).length;
}

describe('enemy pattern components (task 10 / spec R6)', () => {
  it('gunner (사수형) telegraphs a mortar impact hazard at the player', () => {
    const state = createWorld(101);
    const player = state.entities[0]!;
    // Standoff range is ~380; park the gunner within firing range but not on top.
    const gunner = spawnReadyEnemy(state, GUNNER.typeIndex, player.x + 360, player.y);
    expect(hazardsOfSubtype(state, HAZARD_MORTAR)).toBe(0);

    stepWorld(state, emptyInput());

    // A single mortar hazard (telegraphed impact circle) spawned at the player.
    expect(hazardsOfSubtype(state, HAZARD_MORTAR)).toBe(1);
    const mortar = state.entities.find((e) => e.kind === 'hazard' && e.enemyType === HAZARD_MORTAR)!;
    expect(mortar.timer).toBeGreaterThan(0); // still telegraphing (windup not elapsed)
    expect(mortar.ownerId).toBe(gunner.id);
  });

  it('lava spring (특수형) raises a line of `pillars` lava hazards', () => {
    const state = createWorld(202);
    const player = state.entities[0]!;
    spawnReadyEnemy(state, LAVA_SPRING.typeIndex, player.x + 200, player.y + 200);
    const pillars = LAVA_SPRING.attack.kind === 'lava' ? LAVA_SPRING.attack.pillars : 0;
    expect(pillars).toBeGreaterThan(0);

    stepWorld(state, emptyInput());

    // Exactly `pillars` lava hazards, all sharing the player's y (a horizontal line).
    expect(hazardsOfSubtype(state, HAZARD_LAVA)).toBe(pillars);
    const lava = state.entities.filter((e) => e.kind === 'hazard' && e.enemyType === HAZARD_LAVA);
    for (const p of lava) expect(p.y).toBe(player.y);
  });

  it('repair drone (지원형) heals a wounded ally within range', () => {
    const state = createWorld(303);
    // A wounded charger ally sitting still, and a repair drone right beside it.
    const ally = blankEntity('enemy');
    ally.x = 500;
    ally.y = 500;
    ally.radius = 18;
    ally.hp = 10;
    ally.maxHp = 34;
    ally.enemyType = 0; // charger
    ally.vx = 0;
    ally.vy = 0;
    addEntity(state, ally);

    const drone = spawnReadyEnemy(state, 3, 600, 500); // support, ~100u away (in range 220)
    void drone;

    const hp0 = ally.hp;
    stepWorld(state, emptyInput());
    expect(ally.hp).toBeGreaterThan(hp0);
    expect(ally.hp).toBeLessThanOrEqual(ally.maxHp); // never over-heals
  });
});
