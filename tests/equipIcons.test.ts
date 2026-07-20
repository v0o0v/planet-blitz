/**
 * 장비 아이콘 매핑 검증 (src/ui/equipIcons.ts).
 *
 * 아이콘 축(ADR-0015)의 계약을 고정한다:
 *  1) 슬롯 축 15종 = 주무기 5 + 보조무기 5 + 무기 없는 슬롯 5, 키 충돌 0.
 *  2) 유니크 15점이 전부 개별 키로 해석되고 슬롯 축과 겹치지 않는다(합쳐 30 유일 키).
 *  3) 유도된 이름이 전부 로더 목록(`UI_ASSET_NAMES`)에 등재돼 있다 — 등재를 빠뜨리면 파일을
 *     만들어도 안 뜬다.
 *  4) 해석 불가 입력은 null → 셀이 텍스트 글리프로 폴백한다.
 *
 * 순수 매핑 검증이라 DOM 없이 돈다. 자산 PNG 가 아직 없어도 통과해야 한다(파일 존재를 보지 않는다).
 */

import { describe, it, expect } from 'vitest';
import { M2_UNIQUES, M3_UNIQUES } from '../data/uniques.js';
import { SLOT_KINDS } from '../src/items/types.js';
import { EQUIP_SLOT_ICON_KEYS, equipIconKey, equipIconName } from '../src/ui/equipIcons.js';
import { UI_ASSET_NAMES } from '../src/ui/pixi/uiTextures.js';

const ALL_UNIQUES = [...M2_UNIQUES, ...M3_UNIQUES];
/** 무기타입을 갖는 슬롯 = 주무기·보조무기. 나머지는 슬롯당 1종. */
const WEAPON_SLOTS = ['main', 'sub'] as const;

describe('equipIcons — 슬롯 축 15종', () => {
  it('주무기·보조무기는 weaponType 0..4 로 갈리고 나머지 슬롯은 1종이다', () => {
    expect(EQUIP_SLOT_ICON_KEYS.length).toBe(15);
    expect(new Set(EQUIP_SLOT_ICON_KEYS).size).toBe(15);

    for (const slot of WEAPON_SLOTS) {
      for (let code = 0; code < 5; code++) {
        const key = equipIconKey({ slot, weaponType: code });
        expect(key, `${slot} #${code} 매핑 누락`).not.toBeNull();
        expect(EQUIP_SLOT_ICON_KEYS).toContain(key as string);
      }
    }

    for (const slot of SLOT_KINDS) {
      if (slot === 'main' || slot === 'sub') continue;
      expect(equipIconKey({ slot })).toBe(`equip_slot_${slot}`);
    }
  });

  it('모든 슬롯 × weaponType 조합이 유효 키로 해석되고 충돌이 없다', () => {
    const keys = new Set<string>();
    for (const slot of SLOT_KINDS) {
      const codes = slot === 'main' || slot === 'sub' ? [0, 1, 2, 3, 4] : [undefined];
      for (const weaponType of codes) {
        const key = equipIconKey({ slot, weaponType });
        expect(key).not.toBeNull();
        keys.add(key as string);
      }
    }
    expect(keys.size).toBe(15);
  });

  it('무기 슬롯인데 코드가 비면 loadout 기본값(0)으로 읽는다', () => {
    expect(equipIconKey({ slot: 'main' })).toBe('equip_main_vulcan');
    expect(equipIconKey({ slot: 'sub' })).toBe('equip_sub_sidekick');
  });
});

describe('equipIcons — 유니크 15점', () => {
  it('유니크 id 15개가 전부 개별 키로 해석된다', () => {
    expect(ALL_UNIQUES.length).toBe(15);
    const keys = new Set<string>();
    for (const u of ALL_UNIQUES) {
      const key = equipIconKey({ slot: u.slot, weaponType: u.weaponType, uniqueId: u.id });
      expect(key).toBe(`equip_unique_${u.id.replace(/-/g, '_')}`);
      keys.add(key as string);
    }
    expect(keys.size).toBe(15);
  });

  it('유니크는 슬롯 아이콘보다 우선하고 슬롯 축과 키가 겹치지 않는다', () => {
    // 과열 드럼은 main·발칸이지만 슬롯 아이콘이 아니라 전용 아트를 쓴다.
    expect(equipIconKey({ slot: 'main', weaponType: 0, uniqueId: 'overheat-drum' })).toBe(
      'equip_unique_overheat_drum',
    );
    const uniqueKeys = ALL_UNIQUES.map((u) => `equip_unique_${u.id.replace(/-/g, '_')}`);
    const all = new Set([...EQUIP_SLOT_ICON_KEYS, ...uniqueKeys]);
    expect(all.size).toBe(30);
  });
});

describe('equipIcons — 로더 등재와 폴백', () => {
  it('30종 전부가 UI 텍스처 로더 목록에 등재돼 있다', () => {
    const registered = new Set<string>(UI_ASSET_NAMES);
    for (const key of EQUIP_SLOT_ICON_KEYS) {
      expect(registered.has(`${key}.png`), `${key}.png 미등재`).toBe(true);
    }
    for (const u of ALL_UNIQUES) {
      const name = equipIconName({ slot: u.slot, uniqueId: u.id });
      expect(name).not.toBeNull();
      expect(registered.has(name as string), `${name as string} 미등재`).toBe(true);
    }
  });

  it('해석 불가 무기 코드는 null → 글리프 폴백', () => {
    expect(equipIconKey({ slot: 'main', weaponType: 5 })).toBeNull();
    expect(equipIconKey({ slot: 'main', weaponType: -1 })).toBeNull();
    expect(equipIconKey({ slot: 'sub', weaponType: 1.5 })).toBeNull();
    expect(equipIconName({ slot: 'main', weaponType: 99 })).toBeNull();
  });

  it('basename 은 assets/ 평면 구조 규약을 따른다(하위 폴더 없음)', () => {
    const name = equipIconName({ slot: 'core' });
    expect(name).toBe('equip_slot_core.png');
    expect(name as string).not.toContain('/');
  });
});
