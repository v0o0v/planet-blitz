/**
 * 유니크 5점 시뮬 훅 검증 (M2 Lane 3 Phase F1 — AC7).
 *
 * 각 유니크의 고유 효과가 시뮬 거동을 실제로 바꾸는지, 그리고 유니크 로드아웃 런이
 * 결정론적으로 재현되는지 확인한다. 로드아웃은 neutralLoadout에 uniqueMask 비트만
 * 세워 효과를 격리한다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import { blankEntity, addEntity, spawnEnemyBullet } from '../src/sim/entities.js';
import {
  neutralLoadout,
  computeLoadoutStats,
  WEAPON_RAILGUN,
} from '../src/items/loadout.js';
import { rollItem } from '../src/items/roll.js';
import { runReplay } from '../src/sim/replay.js';
import { M2_UNIQUES } from '../data/uniques.js';
import {
  UQ_OVERHEAT_DRUM,
  UQ_SPLIT_CORE,
  UQ_PIERCE_GYRO,
  UQ_DRONE_BAY,
  UQ_PHASE_ARMOR,
  OVERHEAT_MAX_STACK,
  overheatCooldown,
  SPLIT_FRAGMENT_MARK,
  PHASE_ARMOR_BONUS_IFRAMES,
  PHASE_ARMOR_DASH_CD_MULT,
} from '../src/sim/uniques.js';

/** uniqueMask 비트만 세운 로드아웃 config. */
function uniqueCfg(bit: number, weaponType = 0): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    loadout: { ...neutralLoadout(), weaponType, uniqueMask: 1 << bit },
  };
}

/** 플레이어 근처에 정지 표적 적을 둔다(오토어택이 물게). */
function addTarget(state: WorldState, dx: number, hp = 1_000_000): void {
  const player = state.entities[0]!;
  const e = blankEntity('enemy');
  e.x = player.x + dx;
  e.y = player.y;
  e.radius = 30;
  e.hp = hp;
  e.maxHp = hp;
  e.enemyType = 0;
  addEntity(state, e);
}

describe('① 과열 드럼 (AC7)', () => {
  it('overheatCooldown은 스택이 오를수록 짧아지고 최소 2틱을 보장한다', () => {
    expect(overheatCooldown(10, 0)).toBe(10);
    expect(overheatCooldown(10, 3)).toBeLessThan(10);
    expect(overheatCooldown(2, 8)).toBeGreaterThanOrEqual(2);
  });

  it('연속 명중으로 스택이 쌓이고 피격 시 리셋된다', () => {
    const state = createWorld(1, uniqueCfg(UQ_OVERHEAT_DRUM));
    addTarget(state, 200);
    for (let t = 0; t < 120; t++) stepWorld(state, emptyInput());
    const player = state.entities[0]!;
    expect(player.phase).toBe(OVERHEAT_MAX_STACK); // 스택 상한 도달
    // 무적 프레임을 비우고 적탄을 플레이어에 겹쳐 피격 유도 → 스택 리셋.
    player.iframes = 0;
    spawnEnemyBullet(state, player.x, player.y, 0, 0, 0, 5, 6, 30);
    stepWorld(state, emptyInput());
    expect(player.phase).toBe(0);
    expect(player.hp).toBeLessThan(player.maxHp);
  });
});

describe('② 분열 코어 (AC7)', () => {
  it('아군탄이 명중하면 파편(마커 부착)이 분열해 생성된다', () => {
    const state = createWorld(1, uniqueCfg(UQ_SPLIT_CORE));
    addTarget(state, 150);
    for (let t = 0; t < 20; t++) stepWorld(state, emptyInput());
    const frags = state.entities.filter((e) => e.kind === 'bullet' && e.ownerId === SPLIT_FRAGMENT_MARK);
    expect(frags.length).toBeGreaterThan(0);
  });

  it('유니크 미장착이면 파편이 생기지 않는다', () => {
    const state = createWorld(1, { ...DEFAULT_CONFIG, loadout: neutralLoadout() });
    addTarget(state, 150);
    for (let t = 0; t < 20; t++) stepWorld(state, emptyInput());
    const frags = state.entities.filter((e) => e.kind === 'bullet' && e.ownerId === SPLIT_FRAGMENT_MARK);
    expect(frags.length).toBe(0);
  });
});

describe('③ 관통 자이로 (AC7)', () => {
  it('관통당 피해가 증폭되어 두 번째 적이 더 많이 맞고 탄은 살아남는다', () => {
    const state = createWorld(1, uniqueCfg(UQ_PIERCE_GYRO, WEAPON_RAILGUN));
    addTarget(state, 150); // enemy A (가까움 → 먼저 명중)
    addTarget(state, 300); // enemy B (뒤 → phase 증가 후 명중)
    const [, a, b] = state.entities;
    const hpA0 = a!.hp;
    const hpB0 = b!.hp;
    for (let t = 0; t < 30; t++) stepWorld(state, emptyInput());
    const lostA = hpA0 - a!.hp;
    const lostB = hpB0 - b!.hp;
    expect(lostA).toBeGreaterThan(0);
    expect(lostB).toBeGreaterThan(lostA); // 관통 증폭
    // 무한 관통: 레일건 단발이 두 적을 뚫고도 탄이 살아 있다(수명 내).
    expect(state.entities.some((e) => e.kind === 'bullet')).toBe(true);
  });
});

describe('④ 자율 드론 베이 (AC7)', () => {
  it('장착 시 활성 포탑(드론)이 소환된다', () => {
    const state = createWorld(1, uniqueCfg(UQ_DRONE_BAY));
    stepWorld(state, emptyInput());
    const active = state.entities.filter((e) => e.kind === 'turretPickup' && e.phase === 1);
    expect(active.length).toBeGreaterThan(0);
  });

  it('미장착이면 드론이 소환되지 않는다', () => {
    const state = createWorld(1, { ...DEFAULT_CONFIG, loadout: neutralLoadout() });
    for (let t = 0; t < 10; t++) stepWorld(state, emptyInput());
    const active = state.entities.filter((e) => e.kind === 'turretPickup' && e.phase === 1);
    expect(active.length).toBe(0);
  });
});

describe('⑤ 위상 장갑 (AC7)', () => {
  it('대시 시 무적 프레임 연장 + 대시 쿨다운 감소', () => {
    const state = createWorld(1, uniqueCfg(UQ_PHASE_ARMOR));
    stepWorld(state, { ...emptyInput(), moveX: 1, dash: true });
    const player = state.entities[0]!;
    expect(player.iframes).toBe(DEFAULT_CONFIG.dashIframes + PHASE_ARMOR_BONUS_IFRAMES);
    expect(player.dashCooldown).toBe(Math.round(DEFAULT_CONFIG.dashCooldownTicks * PHASE_ARMOR_DASH_CD_MULT));
  });

  it('미장착 대시는 기본 무적/쿨다운을 쓴다', () => {
    const state = createWorld(1, { ...DEFAULT_CONFIG, loadout: neutralLoadout() });
    stepWorld(state, { ...emptyInput(), moveX: 1, dash: true });
    const player = state.entities[0]!;
    expect(player.iframes).toBe(DEFAULT_CONFIG.dashIframes);
    expect(player.dashCooldown).toBe(DEFAULT_CONFIG.dashCooldownTicks);
  });
});

describe('유니크 레지스트리 + 로드아웃 배선 (AC7)', () => {
  it('data/uniques 5점이 등록되어 있고 슬롯/비트가 유일하다', () => {
    expect(M2_UNIQUES.length).toBe(5);
    const bits = new Set(M2_UNIQUES.map((u) => u.bit));
    expect(bits.size).toBe(5);
  });

  it('유니크 아이템 장착 시 uniqueMask에 해당 비트가 켜진다', () => {
    const armor = M2_UNIQUES.find((u) => u.id === 'phase-armor')!;
    const { loadout } = computeLoadoutStats([
      { id: 'u1', slot: 'armor', rarity: 'unique', affixes: [], source: { planet: 0, tier: 0 }, uniqueId: armor.id },
    ]);
    expect((loadout.uniqueMask & (1 << UQ_PHASE_ARMOR)) !== 0).toBe(true);
  });

  it('rollItem이 main 슬롯 유니크에 등록된 uniqueId를 부여한다', () => {
    const ids = new Set(M2_UNIQUES.map((u) => u.id));
    let found = false;
    for (let s = 1; s < 500 && !found; s++) {
      const item = rollItem(s, 'unique', { planet: 1, tier: 1 });
      if (item.slot === 'main' && item.uniqueId !== undefined) {
        expect(ids.has(item.uniqueId)).toBe(true);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});

describe('유니크 로드아웃 결정론 (AC2/AC7)', () => {
  it('유니크 런은 리플레이가 동일 해시로 재현된다', () => {
    const cfg = uniqueCfg(UQ_OVERHEAT_DRUM);
    const inputs = Array.from({ length: 300 }, () => emptyInput());
    const a = runReplay({ seed: 7, config: cfg, inputs });
    const b = runReplay({ seed: 7, config: cfg, inputs });
    expect(a.hashes).toEqual(b.hashes);
  });
});
