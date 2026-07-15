import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';

/**
 * Phase A3: on the infinite map there is no arena edge to despawn projectiles
 * against, so a stray bullet must instead be culled by the player-relative cull
 * radius. These tests guard the "no unbounded accumulation" invariant.
 */

function addBullet(state: WorldState, kind: 'bullet' | 'enemyBullet', x: number, y: number): Entity {
  const b = blankEntity(kind);
  b.x = x;
  b.y = y;
  b.vx = 0;
  b.vy = 0;
  b.life = 100_000; // effectively never expires by lifetime — only culling can remove it
  b.damage = 1;
  b.radius = 5;
  return addEntity(state, b);
}

function countProjectiles(state: WorldState): number {
  return state.entities.filter((e) => e.kind === 'bullet' || e.kind === 'enemyBullet').length;
}

describe('projectile culling (Phase A3, infinite map)', () => {
  it('culls long-lived bullets that sit beyond the cull radius', () => {
    const state = createWorld(1);
    const player = state.entities[0]!;
    // Well outside the cull radius (viewport diagonal x1.5 ≈ 3304 units).
    addBullet(state, 'bullet', player.x + 100_000, player.y);
    addBullet(state, 'enemyBullet', player.x, player.y - 100_000);
    stepWorld(state, { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 });
    // compaction drops dead entities the same tick. Any surviving projectile is
    // an incidental combat bullet spawned near the player, never our far ones —
    // assert nothing survives out past the far distance we planted them at.
    const p = state.entities[0]!;
    for (const e of state.entities) {
      if (e.kind !== 'bullet' && e.kind !== 'enemyBullet') continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      expect(dx * dx + dy * dy).toBeLessThan(10_000 * 10_000);
    }
  });

  it('keeps a long-lived bullet that stays within the cull radius', () => {
    const state = createWorld(1);
    const player = state.entities[0]!;
    addBullet(state, 'enemyBullet', player.x + 200, player.y);
    stepWorld(state, { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 });
    expect(countProjectiles(state)).toBeGreaterThanOrEqual(1);
  });

  it('never lets a projectile survive beyond the cull radius', () => {
    const state = createWorld(1);
    // Cull radius is viewport-diagonal x1.5 ≈ 3304; assert nothing lives past a
    // generous 10k-unit bound from the player after each tick, even while real
    // combat bullets come and go.
    const BOUND2 = 10_000 * 10_000;
    for (let t = 0; t < 200; t++) {
      const player = state.entities[0]!;
      // Every tick, inject a fresh stray bullet far from the player.
      addBullet(state, 'enemyBullet', player.x + 50_000, player.y + 50_000);
      stepWorld(state, { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 });
      const p = state.entities[0]!;
      for (const e of state.entities) {
        if (e.kind !== 'bullet' && e.kind !== 'enemyBullet') continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        expect(dx * dx + dy * dy).toBeLessThan(BOUND2);
      }
    }
  });
});
