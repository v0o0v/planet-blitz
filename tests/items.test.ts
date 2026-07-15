import { describe, it, expect } from 'vitest';
import { rollItem } from '../src/items/roll.js';
import type { ItemSource } from '../src/items/types.js';
import { SLOT_KINDS } from '../src/items/types.js';
import { AFFIX_BY_ID } from '../data/affixes.js';

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
        expect(item.weaponType).toBeLessThanOrEqual(2);
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

  it('unique rarity produces a valid item (uniqueId undefined until Lane 3)', () => {
    const item = rollItem(999, 'unique', SRC);
    expect(item.rarity).toBe('unique');
    expect(item.affixes.length).toBeGreaterThanOrEqual(3);
    expect(item.uniqueId).toBeUndefined();
  });
});
