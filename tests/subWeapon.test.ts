import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState, WorldConfig } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { hashWorld, idleInputs, runReplay } from '../src/sim/replay.js';
import { neutralLoadout } from '../src/items/loadout.js';
import {
  SUB_SIDEKICK,
  SUB_SCATTER,
  SUB_MINE,
  SUB_SENTRY,
  SUB_FLARE,
  SUB_WEAPON_NONE,
} from '../src/items/loadout.js';
import { DRONE_MARK } from '../src/sim/uniques.js';

/**
 * 보조무기 5종(GDD §5) 검증: 각 타입 발사 거동 · 미장착 하위 호환 · 결정론.
 */

const IDLE = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

/** subWeaponType만 지정한 loadout 구성(나머지는 중립 = 주무기 거동 불변). */
function subConfig(subType: number): WorldConfig {
  return { ...DEFAULT_CONFIG, loadout: { ...neutralLoadout(), subWeaponType: subType } };
}

/** 플레이어 근처에 정지 적을 하나 심는다(사거리 내 조준 대상). */
function injectEnemy(state: WorldState, dx: number, dy: number): Entity {
  const p = state.entities[0]!;
  const e = blankEntity('enemy');
  e.x = p.x + dx;
  e.y = p.y + dy;
  e.radius = 24;
  e.hp = 100000;
  e.maxHp = 100000;
  e.enemyType = 0;
  return addEntity(state, e);
}

/** 특정 sub-type 코드(enemyType 태그)를 실은 friendly bullet 수. */
function countSubBullets(state: WorldState, subType: number): number {
  return state.entities.filter((e) => e.kind === 'bullet' && e.enemyType === subType).length;
}

describe('보조무기 5종 발사 거동', () => {
  it('0 사이드킥 — 조준 대상에게 단발 볼트를 쏜다', () => {
    const state = createWorld(1, subConfig(SUB_SIDEKICK));
    injectEnemy(state, 200, 0);
    stepWorld(state, IDLE);
    expect(countSubBullets(state, SUB_SIDEKICK)).toBe(1);
  });

  it('1 스캐터 — 한 사이클에 3발 산탄을 쏜다', () => {
    const state = createWorld(1, subConfig(SUB_SCATTER));
    injectEnemy(state, 200, 0);
    stepWorld(state, IDLE);
    expect(countSubBullets(state, SUB_SCATTER)).toBe(3);
  });

  it('2 기뢰장 — 조준 대상 없이도 정지 장판(속도 0)을 설치한다', () => {
    const state = createWorld(1, subConfig(SUB_MINE));
    stepWorld(state, IDLE); // 적 없음 — 그래도 설치
    const mines = state.entities.filter((e) => e.kind === 'bullet' && e.enemyType === SUB_MINE);
    expect(mines.length).toBe(1);
    expect(mines[0]!.vx).toBe(0);
    expect(mines[0]!.vy).toBe(0);
  });

  it('2 기뢰장 — 위에 있는 적에게 피해를 준다', () => {
    const state = createWorld(1, subConfig(SUB_MINE));
    const enemy = injectEnemy(state, 0, 0); // 플레이어(=기뢰 설치 위치) 바로 위
    const hp0 = enemy.hp;
    for (let i = 0; i < 5; i++) stepWorld(state, IDLE);
    expect(enemy.hp).toBeLessThan(hp0);
  });

  it('3 센트리 — 조준 대상 없이도 자율 포탑(DRONE_MARK)을 배치한다', () => {
    const state = createWorld(1, subConfig(SUB_SENTRY));
    stepWorld(state, IDLE);
    const sentries = state.entities.filter(
      (e) => e.kind === 'turretPickup' && e.ownerId === DRONE_MARK,
    );
    expect(sentries.length).toBe(1);
  });

  it('4 호밍 플레어 — 유도 미사일을 쏘고 대상 방위 변화에 선회한다', () => {
    const state = createWorld(1, subConfig(SUB_FLARE));
    const enemy = injectEnemy(state, 0, 400); // 정면 위 → 발사각 = 대상 방위
    stepWorld(state, IDLE);
    const flares = state.entities.filter((e) => e.kind === 'bullet' && e.enemyType === SUB_FLARE);
    expect(flares.length).toBe(1);
    const a0 = flares[0]!.angle;
    // 대상을 옆으로 크게 이동 → 방위가 바뀌면 homeMissile이 제한 선회로 각도를 튼다.
    enemy.x += 800;
    stepWorld(state, IDLE);
    const flare = state.entities.find((e) => e.kind === 'bullet' && e.enemyType === SUB_FLARE);
    expect(flare).toBeDefined();
    expect(flare!.angle).not.toBe(a0); // 유도(MISSILE_MARK) 작동 증거
  });
});

describe('보조무기 미장착 하위 호환', () => {
  it('SUB_WEAPON_NONE(-1)은 보조 발사체를 하나도 만들지 않는다', () => {
    // 주무기(autoAttack)는 발화하므로 enemyType -1 탄은 생기지만, sub 태그(≥0)는 없어야 한다.
    const state = createWorld(1, subConfig(SUB_WEAPON_NONE));
    injectEnemy(state, 200, 0);
    for (let i = 0; i < 120; i++) stepWorld(state, IDLE);
    for (let t = 0; t <= 4; t++) expect(countSubBullets(state, t)).toBe(0);
  });

  it('SUB_WEAPON_NONE(-1) 런은 그 자체로 결정론적이다(동일 시드 2회 동일 해시)', () => {
    const inputs = idleInputs(600);
    const a = runReplay({ seed: 0x51ab, config: subConfig(SUB_WEAPON_NONE), inputs });
    const b = runReplay({ seed: 0x51ab, config: subConfig(SUB_WEAPON_NONE), inputs });
    expect(a.hashes).toEqual(b.hashes);
  });
});

describe('보조무기 결정론', () => {
  /** 동일 시드 + 동일 적 주입 + 동일 입력을 두 번 돌려 매 틱 해시가 같은지. */
  function runWithEnemies(subType: number): number[] {
    const state = createWorld(0xbeef, subConfig(subType));
    injectEnemy(state, 180, 60);
    injectEnemy(state, -220, 140);
    const hashes: number[] = [];
    for (let i = 0; i < 200; i++) {
      stepWorld(state, IDLE);
      hashes.push(hashWorld(state));
    }
    return hashes;
  }

  for (const [name, subType] of [
    ['사이드킥', SUB_SIDEKICK],
    ['스캐터', SUB_SCATTER],
    ['기뢰장', SUB_MINE],
    ['센트리', SUB_SENTRY],
    ['호밍 플레어', SUB_FLARE],
  ] as const) {
    it(`${name}(${subType}) — 동일 시드 2회 실행이 매 틱 동일 해시`, () => {
      expect(runWithEnemies(subType)).toEqual(runWithEnemies(subType));
    });
  }

  it('각 타입은 서로 다른 해시 궤적을 낸다(거동 차별 확인)', () => {
    const trails = [SUB_SIDEKICK, SUB_SCATTER, SUB_MINE, SUB_SENTRY, SUB_FLARE].map((t) =>
      runWithEnemies(t).join(','),
    );
    expect(new Set(trails).size).toBe(trails.length);
  });
});
