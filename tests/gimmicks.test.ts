import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { blankEntity, addEntity, spawnDestructible, spawnEventObject } from '../src/sim/entities.js';
import { MAGNET_BUFF_TICKS, TURRET_LIFE_TICKS, BOMB_DAMAGE } from '../src/sim/events.js';

/** Phase F3/F4 — destructible drops and the three proximity event objects. */

const idle = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

function quietWaves(state: WorldState): void {
  state.wave.done = true;
}
function countKind(state: WorldState, kind: string): number {
  return state.entities.filter((e) => e.kind === kind).length;
}

describe('destructible objects (plan F3)', () => {
  it('drops a gem when broken by a friendly bullet', () => {
    const state = createWorld(1);
    quietWaves(state);
    // Note: chunks may generate ambient gimmicks off-origin, so assert on the
    // specific entity/drop rather than global kind counts.
    const d = spawnDestructible(state, 150, 0, 48, 5, 5);
    // A friendly bullet overlapping it, damage well above its HP.
    const b = blankEntity('bullet');
    b.x = 150;
    b.y = 0;
    b.radius = 5;
    b.damage = 50;
    b.life = 60;
    addEntity(state, b);

    stepWorld(state, idle);
    expect(state.entities.includes(d)).toBe(false); // destroyed & compacted away
    // A gem dropped at the destructible's position.
    expect(
      state.entities.some((e) => e.kind === 'gem' && Math.abs(e.x - 150) < 80 && Math.abs(e.y) < 80),
    ).toBe(true);
  });

  it('does not block movement (player passes through)', () => {
    const state = createWorld(1);
    quietWaves(state);
    const player = state.entities[0]!;
    spawnDestructible(state, 150, 0, 48, 999, 5); // high HP so it survives
    for (let i = 0; i < 40; i++) stepWorld(state, { ...idle, moveX: 1 });
    // The player walked past the destructible's centre (it is not a wall).
    expect(player.x).toBeGreaterThan(150);
  });
});

describe('event objects (plan F4)', () => {
  it('magnet emitter buffs the magnet radius on contact and is consumed', () => {
    const state = createWorld(1);
    quietWaves(state);
    const player = state.entities[0]!;
    const em = spawnEventObject(state, 'magnetEmitter', player.x, player.y, 70);
    stepWorld(state, idle);
    expect(state.magnetBuffTicks).toBe(MAGNET_BUFF_TICKS);
    expect(state.entities.includes(em)).toBe(false); // consumed on contact
  });

  it('bomb device damages nearby enemies and clears nearby enemy bullets', () => {
    const state = createWorld(1);
    quietWaves(state);
    const player = state.entities[0]!;
    const bomb = spawnEventObject(state, 'bombDevice', player.x, player.y, 70);
    const enemy = blankEntity('enemy');
    enemy.x = 200;
    enemy.y = 0;
    enemy.radius = 32;
    enemy.hp = 100;
    enemy.maxHp = 100;
    enemy.enemyType = 1;
    enemy.cooldown = 999; // do not let it emit anything this tick
    addEntity(state, enemy);
    const eb = blankEntity('enemyBullet');
    eb.x = 100;
    eb.y = 0;
    eb.radius = 5;
    eb.life = 60;
    addEntity(state, eb);

    stepWorld(state, idle);
    expect(enemy.hp).toBe(100 - BOMB_DAMAGE);
    expect(state.entities.includes(eb)).toBe(false); // nearby enemy bullet cleared
    expect(state.entities.includes(bomb)).toBe(false); // device consumed
  });

  it('turret pickup activates on contact, then auto-fires and expires', () => {
    const state = createWorld(1);
    quietWaves(state);
    const player = state.entities[0]!;
    const turret = spawnEventObject(state, 'turretPickup', player.x, player.y, 70);

    // Contact activates it in place.
    stepWorld(state, idle);
    expect(turret.phase).toBe(1);
    expect(turret.life).toBe(TURRET_LIFE_TICKS);

    // With the player's own weapon silenced, any friendly bullet is the turret's.
    player.cooldown = 99999;
    const enemy = blankEntity('enemy');
    enemy.x = 400;
    enemy.y = 0;
    enemy.radius = 32;
    enemy.hp = 1000;
    enemy.maxHp = 1000;
    enemy.enemyType = 1;
    addEntity(state, enemy);
    stepWorld(state, idle);
    expect(countKind(state, 'bullet')).toBeGreaterThan(0);
    expect(turret.life).toBeLessThan(TURRET_LIFE_TICKS);
  });
});
