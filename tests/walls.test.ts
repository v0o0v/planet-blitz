import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { blankEntity, addEntity, spawnWall } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { slideCircleWalls, circleOverlapsWall } from '../src/sim/los.js';
import { avoidWalls } from '../src/sim/waves.js';

/** Build a bare wall entity (radius = half-width, targetX = half-height). */
function wall(x: number, y: number, halfW: number, halfH: number): Entity {
  const w = blankEntity('wall');
  w.x = x;
  w.y = y;
  w.radius = halfW;
  w.targetX = halfH;
  return w;
}

/**
 * Phase F1 — cover walls: movement slide (dash included, no tunnelling), two-way
 * bullet blocking, and line-of-sight targeting (a wall-hidden enemy is skipped).
 */

const idle = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

/** Silence the wave director so only manually placed entities exist. */
function quietWaves(state: WorldState): void {
  state.wave.done = true;
}

function countKind(state: WorldState, kind: string): number {
  return state.entities.filter((e) => e.kind === kind).length;
}

describe('cover walls (plan F1)', () => {
  it('blocks player movement — slides instead of penetrating', () => {
    const state = createWorld(1);
    quietWaves(state);
    const player = state.entities[0]!;
    const wall = spawnWall(state, 150, 0, 60, 60);
    // Drive straight into the wall for a while.
    for (let i = 0; i < 40; i++) stepWorld(state, { ...idle, moveX: 1 });
    // The player's circle never crosses into the wall body (rest at tangency).
    expect(player.x + player.radius).toBeLessThanOrEqual(wall.x - wall.radius + 0.01);
  });

  it('a dash cannot tunnel through a wall', () => {
    const state = createWorld(1);
    quietWaves(state);
    const player = state.entities[0]!;
    const wall = spawnWall(state, 150, 0, 60, 60);
    // Dash on the first tick, then keep pushing right.
    stepWorld(state, { ...idle, moveX: 1, dash: true });
    for (let i = 0; i < 40; i++) {
      stepWorld(state, { ...idle, moveX: 1 });
      // Never ends up on the far side of the wall.
      expect(player.x).toBeLessThan(wall.x);
    }
    expect(player.x + player.radius).toBeLessThanOrEqual(wall.x - wall.radius + 0.01);
  });

  it('stops both friendly and enemy bullets', () => {
    const state = createWorld(1);
    quietWaves(state);
    spawnWall(state, 300, 0, 60, 60);
    // A bullet of each faction sitting inside the wall AABB.
    for (const kind of ['bullet', 'enemyBullet'] as const) {
      const b = blankEntity(kind);
      b.x = 300;
      b.y = 0;
      b.radius = 5;
      b.life = 100;
      addEntity(state, b);
    }
    stepWorld(state, idle);
    expect(countKind(state, 'bullet')).toBe(0);
    expect(countKind(state, 'enemyBullet')).toBe(0);
  });

  it('LOS: does not fire at an enemy fully hidden behind a wall', () => {
    const state = createWorld(2);
    quietWaves(state);
    const player = state.entities[0]!;
    player.cooldown = 0;
    // Tall wall spanning the sightline directly between player and enemy.
    spawnWall(state, 220, 0, 40, 400);
    const enemy = blankEntity('enemy');
    enemy.x = 500;
    enemy.y = 0;
    enemy.radius = 32;
    enemy.hp = 1000;
    enemy.maxHp = 1000;
    enemy.enemyType = 1; // gunner: stands off, emits hazards not bullets
    addEntity(state, enemy);

    stepWorld(state, idle);
    // Target is occluded → no friendly bullet fired this tick.
    expect(countKind(state, 'bullet')).toBe(0);
  });

  it('LOS: skips the occluded nearest and fires at the next-nearest visible enemy', () => {
    // Semantics (plan F1c): "filter blocked candidates, then nearest" — NOT
    // "nearest, else none". The closest enemy is hidden behind a wall; a farther
    // enemy in the open must still be targeted.
    const state = createWorld(4);
    quietWaves(state);
    const player = state.entities[0]!;
    player.cooldown = 0;
    // Tall wall directly to the right, occluding the near enemy at (400,0).
    spawnWall(state, 150, 0, 40, 400);
    const near = blankEntity('enemy'); // closer (d=400) but hidden
    near.x = 400;
    near.y = 0;
    near.radius = 32;
    near.hp = 1000;
    near.maxHp = 1000;
    near.enemyType = 1;
    addEntity(state, near);
    const far = blankEntity('enemy'); // farther (d=600) but in the open, straight down
    far.x = 0;
    far.y = 600;
    far.radius = 32;
    far.hp = 1000;
    far.maxHp = 1000;
    far.enemyType = 1;
    addEntity(state, far);

    stepWorld(state, idle);
    const shots = state.entities.filter((e) => e.kind === 'bullet');
    // It fired (did not give up), and every shot aims at the visible far enemy
    // (downward, +y) rather than the blocked near enemy (rightward, +x).
    expect(shots.length).toBeGreaterThan(0);
    for (const b of shots) {
      expect(b.vy).toBeGreaterThan(0);
      expect(Math.abs(b.vy)).toBeGreaterThan(Math.abs(b.vx));
    }
  });

  it('LOS: fires at the same enemy when no wall occludes it', () => {
    const state = createWorld(2);
    quietWaves(state);
    const player = state.entities[0]!;
    player.cooldown = 0;
    const enemy = blankEntity('enemy');
    enemy.x = 500;
    enemy.y = 0;
    enemy.radius = 32;
    enemy.hp = 1000;
    enemy.maxHp = 1000;
    enemy.enemyType = 1;
    addEntity(state, enemy);

    stepWorld(state, idle);
    expect(countKind(state, 'bullet')).toBeGreaterThan(0);
  });

  it('spawn-wall avoidance: a spawn point inside a wall is pushed clear (deterministic)', () => {
    // C1 리뷰 LOW: 스폰 좌표가 활성 벽 AABB(적 반경 마진)와 겹치면 벽 밖으로 밀린다.
    const w = wall(0, 0, 60, 60); // x,y ∈ [-60,60]
    const walls = [w];
    const r = 20;
    const before = avoidWalls(walls, 10, 5, r); // 벽 내부
    // 결과는 더 이상 벽과 겹치지 않는다(반경 마진 포함).
    expect(circleOverlapsWall(before.x, before.y, r, w)).toBe(false);
    // 순수 함수: 동일 입력 → 동일 출력(RNG 미사용, 시드 무관).
    const again = avoidWalls(walls, 10, 5, r);
    expect(again).toEqual(before);
    // 이미 벽 밖인 점은 그대로 둔다.
    const clear = avoidWalls(walls, 500, 500, r);
    expect(clear).toEqual({ x: 500, y: 500 });
  });

  it('slideCircleWalls resolves a multi-wall corner that a single pass leaves overlapping', () => {
    // los LOW: 단일 패스로는 1틱 잔여 겹침(관통)이 남는 코너를 2패스로 즉시 해소.
    // (탐색으로 확정한 기하 — pass1은 (23,1)에서 여전히 관통, pass2가 (41,1)로 해소.
    //  slide는 Minkowski 면까지 밀어 접점 tangency에서 멈추므로 "관통 없음"으로 판정.)
    const a = wall(3, -9, 28, 21);
    const b = wall(47, 38, 44, 27);
    const walls = [a, b];
    const r = 10;
    // slideCircleWalls와 동일한 박스(관통) 판정 — 접점은 관통 아님(strict <).
    const penetrates = (x: number, y: number, w: Entity): boolean => {
      const hw = w.radius + r;
      const hh = w.targetX + r;
      const dx = x - w.x;
      const dy = y - w.y;
      return dx > -hw && dx < hw && dy > -hh && dy < hh;
    };
    const res = slideCircleWalls(23, 23, r, walls);
    expect(res.hit).toBe(true);
    // 2패스 후 두 벽 어느 쪽과도 관통하지 않는다.
    expect(penetrates(res.x, res.y, a)).toBe(false);
    expect(penetrates(res.x, res.y, b)).toBe(false);
    // 결정론: 동일 입력 → 동일 출력.
    const res2 = slideCircleWalls(23, 23, r, walls);
    expect(res2.x).toBe(res.x);
    expect(res2.y).toBe(res.y);
  });

  it('charger sprays fragments the moment it slides against a wall', () => {
    const state = createWorld(3);
    quietWaves(state);
    // A charger already touching a wall, cadence ready, aimed into it.
    const wall = spawnWall(state, 300, 0, 60, 60);
    const charger = blankEntity('enemy');
    charger.x = wall.x - 80;
    charger.y = 0;
    charger.vx = 300; // heading into the wall
    charger.radius = 36;
    charger.hp = 100;
    charger.maxHp = 100;
    charger.enemyType = 0; // charger -> fragments
    charger.cooldown = 0;
    addEntity(state, charger);

    stepWorld(state, idle);
    // charger-rush def sprays 4 fragments on the wall-impact trigger.
    expect(countKind(state, 'enemyBullet')).toBeGreaterThanOrEqual(4);
  });
});
