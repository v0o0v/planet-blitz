/**
 * 기본 장비(스타터 킷) 계약 — `src/items/starterKit.ts`.
 *
 * 여기서 못 박는 것은 셋이다:
 *  1. **Lv1 이 실제로 입을 수 있는가.** 요구 레벨이 하나라도 1 을 넘으면 킷은 화면에만 있고
 *     `canEquip` 게이트에 걸려 아무 효과가 없다 — 가장 조용히 실패하는 형태다.
 *  2. **8칸이 서로 다른 실물인가.** id 가 겹치면 살베지·인벤토리 매칭이 엉킨다.
 *  3. **기존 유저 마이그레이션이 덮어쓰지 않는가.** 빈 칸만 채워야 파밍 장비가 안 날아간다.
 */

import { describe, it, expect } from 'vitest';

import { starterEquipped, fillStarterEquipment } from '../src/items/starterKit.js';
import { canEquip, requiredLevel } from '../src/items/requiredLevel.js';
import { EQUIP_SLOTS, SAVE_VERSION } from '../src/items/types.js';
import type { EquipSlotId, Item } from '../src/items/types.js';
import { migrate, defaultProfile, newPlayerProfile, activeShip } from '../src/save/profile.js';

describe('스타터 킷 — 8칸 전부, Lv1 착용 가능', () => {
  it('EQUIP_SLOTS 8칸을 빠짐없이 채운다', () => {
    const eq = starterEquipped();
    for (const slot of EQUIP_SLOTS) {
      expect(eq[slot], `${slot} 칸`).toBeDefined();
    }
    expect(Object.keys(eq)).toHaveLength(EQUIP_SLOTS.length);
  });

  it('각 칸의 아이템 종류가 그 칸에 맞는다(모듈 2칸은 module 종류)', () => {
    const eq = starterEquipped();
    for (const slot of EQUIP_SLOTS) {
      const expected = slot === 'module0' || slot === 'module1' ? 'module' : slot;
      expect(eq[slot]!.slot, `${slot} 칸의 종류`).toBe(expected);
    }
  });

  it('전 칸 요구 레벨이 1 이다 — Lv1 기체가 그 자리에서 입는다', () => {
    const eq = starterEquipped();
    for (const slot of EQUIP_SLOTS) {
      const it = eq[slot] as Item;
      expect(requiredLevel(it), `${slot} 요구 레벨`).toBe(1);
      expect(canEquip(1, it), `${slot} Lv1 착용`).toBe(true);
    }
  });

  it('스탯이 실제로 붙는다 — 어픽스 0개인 껍데기가 아니다', () => {
    const eq = starterEquipped();
    for (const slot of EQUIP_SLOTS) {
      expect(eq[slot]!.affixes.length, `${slot} 어픽스 수`).toBeGreaterThan(0);
    }
  });

  it('8칸의 id 가 전부 다르다(살베지·인벤토리 매칭이 id 로 돈다)', () => {
    const ids = Object.values(starterEquipped()).map((it) => it!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('결정론 — 두 번 부르면 같은 킷이고, 객체는 공유되지 않는다', () => {
    const a = starterEquipped();
    const b = starterEquipped();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.main).not.toBe(b.main); // 공유하면 한 기체의 장비가 다른 기체로 샌다
  });

  it('주무기는 기본형(발칸 = weaponType 0)이다', () => {
    expect(starterEquipped().main?.weaponType).toBe(0);
  });
});

describe('fillStarterEquipment — 빈 칸만 채운다', () => {
  it('이미 입고 있는 칸은 절대 덮지 않는다', () => {
    const mine = { ...(starterEquipped().armor as Item), id: 'it-my-farmed-armor' };
    const eq: Partial<Record<EquipSlotId, Item>> = { armor: mine };
    const filled = fillStarterEquipment(eq);
    expect(eq.armor).toBe(mine); // 같은 실물 그대로
    expect(filled).toBe(EQUIP_SLOTS.length - 1);
  });

  it('가득 찬 장비함에서는 아무것도 안 바꾼다(무변형)', () => {
    const eq = starterEquipped();
    const before = JSON.stringify(eq);
    expect(fillStarterEquipment(eq)).toBe(0);
    expect(JSON.stringify(eq)).toBe(before);
  });
});

describe('신규 프로필 · v9 → v10 마이그레이션', () => {
  it('newPlayerProfile 의 첫 기체가 기본 장비를 입고 있다', () => {
    const ship = activeShip(newPlayerProfile());
    expect(Object.keys(ship.equipped)).toHaveLength(EQUIP_SLOTS.length);
    expect(ship.equipped.main?.id).toBe('it-starter-main');
  });

  /**
   * ⚠️ 이 두 개념을 합치지 마라. `defaultProfile()` 은 sim·밸런스 스위트 24개 파일이 쓰는
   * **맨몸 기준선 픽스처**다(전진 속도·명중 피해·시그니처 대조군의 눈금이 여기 맞춰져 있다).
   * 거기에 장비를 실으면 그 기준선이 통째로 밀려 무엇을 재고 있었는지가 사라진다.
   */
  it('defaultProfile 은 여전히 맨몸이다 — 스키마 기본값과 신규 플레이어는 다른 개념이다', () => {
    expect(Object.keys(activeShip(defaultProfile()).equipped)).toHaveLength(0);
  });

  it('맨몸 v9 세이브가 v10 에서 전 기체 기본 장비를 받는다', () => {
    const base = defaultProfile();
    const v9 = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    v9.saveVersion = 9;
    // 두 기체 모두 맨몸으로 되돌려 "구 유저" 를 만든다.
    const ships = v9.ships as Record<string, unknown>[];
    ships[0]!.equipped = {};
    ships.push({ ...JSON.parse(JSON.stringify(ships[0])), id: 'ship-1' });

    const p = migrate(v9);
    expect(p.saveVersion).toBe(SAVE_VERSION);
    expect(p.ships).toHaveLength(2);
    for (const s of p.ships) {
      expect(Object.keys(s.equipped)).toHaveLength(EQUIP_SLOTS.length);
      expect(canEquip(s.level, s.equipped.main as Item)).toBe(true);
    }
  });

  it('이미 장비가 있는 구 유저의 장비는 보존된다(빈 칸만 메운다)', () => {
    const base = defaultProfile();
    const kept = { ...(starterEquipped().main as Item), id: 'it-farmed-main' };
    const v9 = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    v9.saveVersion = 9;
    (v9.ships as Record<string, unknown>[])[0]!.equipped = { main: kept };

    const ship = activeShip(migrate(v9));
    expect(ship.equipped.main?.id).toBe('it-farmed-main');
    expect(Object.keys(ship.equipped)).toHaveLength(EQUIP_SLOTS.length);
  });

  it('손상된 equipped(배열·null)도 죽지 않고 기본 장비로 복구된다', () => {
    const base = defaultProfile();
    const v9 = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    v9.saveVersion = 9;
    (v9.ships as Record<string, unknown>[])[0]!.equipped = null;
    const ship = activeShip(migrate(v9));
    expect(Object.keys(ship.equipped)).toHaveLength(EQUIP_SLOTS.length);
  });
});
