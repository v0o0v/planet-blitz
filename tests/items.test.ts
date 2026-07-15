import { describe, it, expect, afterEach } from 'vitest';
import { rollItem } from '../src/items/roll.js';
import type { ItemSource } from '../src/items/types.js';
import { SLOT_KINDS } from '../src/items/types.js';
import { AFFIX_BY_ID } from '../data/affixes.js';
import { UNIQUE_REGISTRY, registerUnique } from '../src/items/uniques.js';

const SRC: ItemSource = { planet: 0, tier: 0 };

describe('rollItem — pure item roller (AC1)', () => {
  it('is deterministic: same seed + rarity + source → identical item', () => {
    for (const seed of [1, 42, 0xdeadbeef, 123456789]) {
      const a = rollItem(seed, 'rare', SRC);
      const b = rollItem(seed, 'rare', SRC);
      expect(a).toEqual(b);
    }
  });

  it('rolls the spec affix counts per rarity (magic 1..2, rare 3..6, normal 0)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      expect(rollItem(seed, 'normal', SRC).affixes.length).toBe(0);
      const magic = rollItem(seed, 'magic', SRC).affixes.length;
      expect(magic).toBeGreaterThanOrEqual(1);
      expect(magic).toBeLessThanOrEqual(2);
      const rare = rollItem(seed, 'rare', SRC).affixes.length;
      expect(rare).toBeGreaterThanOrEqual(3);
      expect(rare).toBeLessThanOrEqual(6);
    }
  });

  it('rolls distinct affixes within each declared [min,max] range', () => {
    const item = rollItem(777, 'rare', SRC);
    const ids = new Set<string>();
    for (const a of item.affixes) {
      expect(ids.has(a.id)).toBe(false); // distinct
      ids.add(a.id);
      const def = AFFIX_BY_ID.get(a.id);
      expect(def).toBeDefined();
      expect(a.value).toBeGreaterThanOrEqual(def!.min);
      expect(a.value).toBeLessThanOrEqual(def!.max);
      expect(a.stat).toBe(def!.stat);
    }
  });

  it('always yields a valid slot; main/sub carry a weapon type', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const item = rollItem(seed, 'magic', SRC);
      expect(SLOT_KINDS).toContain(item.slot);
      if (item.slot === 'main') {
        expect(item.weaponType).toBeGreaterThanOrEqual(0);
        expect(item.weaponType).toBeLessThanOrEqual(4); // M3 C1: 5 main-weapon types
      } else if (item.slot === 'sub') {
        expect(item.weaponType).toBeGreaterThanOrEqual(0);
        expect(item.weaponType).toBeLessThanOrEqual(1);
      } else {
        expect(item.weaponType).toBeUndefined();
      }
    }
  });

  it('stamps the source and a seed-derived id', () => {
    const src: ItemSource = { planet: 1, tier: 1 };
    const item = rollItem(555, 'magic', src);
    expect(item.source).toEqual(src);
    expect(item.id).toBe('it-555');
  });

  it('unique rarity produces a valid item with a registered uniqueId (M3: 전 슬롯 커버)', () => {
    // M3에서 유니크 15점이 7개 슬롯 종류를 모두 커버하므로, 어떤 슬롯을 롤하든 유니크
    // rarity면 등록된 uniqueId가 반드시 부여된다.
    const item = rollItem(999, 'unique', SRC);
    expect(item.rarity).toBe('unique');
    expect(item.affixes.length).toBeGreaterThanOrEqual(3);
    expect(item.uniqueId).toBeDefined();
  });
});

describe('rollItem — unique draw stream-shape invariance (리뷰 LOW-2)', () => {
  afterEach(() => {
    // 전역 레지스트리를 비워 다른 케이스로 오염되지 않게 한다.
    UNIQUE_REGISTRY.clear();
  });

  it('populates uniqueId once a unique is registered for the rolled slot', () => {
    // 모든 슬롯에 유니크를 하나씩 등록 → 어떤 슬롯이 굴려져도 uniqueId가 채워진다.
    for (const slot of SLOT_KINDS) {
      registerUnique({ id: `u-${slot}`, name: slot, slot, bit: 0 });
    }
    for (const seed of [1, 999, 0xdeadbeef, 424242]) {
      const item = rollItem(seed, 'unique', SRC);
      expect(item.uniqueId).toBeDefined();
    }
  });

  it('registry population does NOT shift the RNG stream (slot/weaponType/affixes unchanged)', () => {
    // 빈 레지스트리 상태의 롤을 먼저 캡처.
    const before = [1, 999, 0xdeadbeef, 424242].map((s) => rollItem(s, 'unique', SRC));
    // 레지스트리를 채운 뒤 같은 시드를 다시 롤: 유니크 추첨은 무조건 draw 1회이므로
    // 앞선 슬롯·무기타입·어픽스 롤이 밀리지 않고 동일해야 한다. uniqueId만 새로 붙는다.
    for (const slot of SLOT_KINDS) {
      registerUnique({ id: `u-${slot}`, name: slot, slot, bit: 0 });
    }
    const after = [1, 999, 0xdeadbeef, 424242].map((s) => rollItem(s, 'unique', SRC));
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!.slot).toBe(before[i]!.slot);
      expect(after[i]!.weaponType).toBe(before[i]!.weaponType);
      expect(after[i]!.affixes).toEqual(before[i]!.affixes);
      expect(before[i]!.uniqueId).toBeUndefined();
      expect(after[i]!.uniqueId).toBeDefined();
    }
  });
});
