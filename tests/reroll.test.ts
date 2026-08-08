import { describe, it, expect } from 'vitest';
import { rollItem, rerollAffixes } from '../src/items/roll.js';
import type { Item, ItemSource } from '../src/items/types.js';
import { AFFIX_BY_ID } from '../data/affixes.js';

const SRC: ItemSource = { planet: 0, stage: 1 };

/** A rare item with a healthy affix count for reroll coverage. */
function rareWithAffixes(seed: number): Item {
  for (let s = seed; s < seed + 500; s++) {
    const it = rollItem(s, 'rare', SRC);
    if (it.affixes.length >= 3) return it;
  }
  throw new Error('no rare with ≥3 affixes found');
}

describe('rerollAffixes — refinery reforge (AC3, plan A4)', () => {
  it('is deterministic: same item + seed + lock → identical affixes', () => {
    const item = rareWithAffixes(1000);
    const a = rerollAffixes(item, 42, 1);
    const b = rerollAffixes(item, 42, 1);
    expect(a.affixes).toEqual(b.affixes);
  });

  it('preserves the affix count and all non-affix fields', () => {
    const item = rareWithAffixes(2000);
    const out = rerollAffixes(item, 77);
    expect(out.affixes).toHaveLength(item.affixes.length);
    expect(out.id).toBe(item.id);
    expect(out.slot).toBe(item.slot);
    expect(out.rarity).toBe(item.rarity);
    expect(out.source).toEqual(item.source);
    expect(out.weaponType).toBe(item.weaponType);
  });

  it('locked affix is preserved in place; the rest are redrawn', () => {
    const item = rareWithAffixes(3000);
    const lockIdx = 1;
    const locked = item.affixes[lockIdx]!;
    const out = rerollAffixes(item, 12345, lockIdx);
    expect(out.affixes[lockIdx]).toEqual(locked);
    // The locked affix id never appears elsewhere (distinctness preserved).
    for (let i = 0; i < out.affixes.length; i++) {
      if (i === lockIdx) continue;
      expect(out.affixes[i]!.id).not.toBe(locked.id);
    }
  });

  it('is pure — the input item is not mutated', () => {
    const item = rareWithAffixes(4000);
    const snapshot = JSON.parse(JSON.stringify(item)) as Item;
    rerollAffixes(item, 999, 0);
    expect(item).toEqual(snapshot);
  });

  it('rerolled affixes are distinct and within their declared ranges', () => {
    const item = rareWithAffixes(5000);
    const out = rerollAffixes(item, 555);
    const ids = new Set<string>();
    for (const a of out.affixes) {
      expect(ids.has(a.id)).toBe(false);
      ids.add(a.id);
      const def = AFFIX_BY_ID.get(a.id);
      expect(def).toBeDefined();
      expect(a.value).toBeGreaterThanOrEqual(def!.min);
      expect(a.value).toBeLessThanOrEqual(def!.max);
      expect(a.stat).toBe(def!.stat);
    }
  });

  it('a different seed generally yields a different affix set', () => {
    const item = rareWithAffixes(6000);
    const a = rerollAffixes(item, 1);
    const b = rerollAffixes(item, 2);
    // Not guaranteed for every pair, but overwhelmingly likely for a full reroll.
    expect(a.affixes).not.toEqual(b.affixes);
  });

  it('a zero-affix item rerolls to an identical copy', () => {
    // Build the zero-affix fixture explicitly. It used to come from
    // `rollItem(_, 'normal')`, but normal now rolls 1 affix (2026-08-08) — see
    // `roll.ts` affixCountFor. The invariant still holds; only the source moves.
    const normal = { ...rollItem(10, 'normal', SRC), affixes: [] };
    expect(normal.affixes).toHaveLength(0);
    const out = rerollAffixes(normal, 5);
    expect(out.affixes).toEqual([]);
    expect(out).not.toBe(normal); // a copy, not the same reference
  });

  it('an out-of-range lock index is treated as no lock (all redrawn)', () => {
    const item = rareWithAffixes(7000);
    const out = rerollAffixes(item, 88, 999);
    expect(out.affixes).toHaveLength(item.affixes.length);
  });
});
