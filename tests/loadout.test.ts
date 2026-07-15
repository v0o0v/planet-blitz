import { describe, it, expect } from 'vitest';
import {
  computeLoadoutStats,
  neutralLoadout,
  WEAPON_VULCAN,
  WEAPON_SPREAD,
  WEAPON_RAILGUN,
  SUB_WEAPON_NONE,
} from '../src/items/loadout.js';
import type { Item, ItemSource, SlotKind, StatKey } from '../src/items/types.js';

const SRC: ItemSource = { planet: 0, tier: 0 };

function item(slot: SlotKind, affixes: { stat: StatKey; value: number }[], weaponType?: number): Item {
  return {
    id: `t-${slot}`,
    slot,
    rarity: 'rare',
    affixes: affixes.map((a, i) => ({ id: `a${i}`, stat: a.stat, value: a.value })),
    source: SRC,
    ...(weaponType !== undefined ? { weaponType } : {}),
  };
}

describe('computeLoadoutStats — derived stats pipeline (AC4)', () => {
  it('empty loadout is neutral', () => {
    const { loadout } = computeLoadoutStats([]);
    expect(loadout).toEqual(neutralLoadout());
    expect(loadout.weaponType).toBe(WEAPON_VULCAN);
    expect(loadout.subWeaponType).toBe(SUB_WEAPON_NONE);
  });

  it('reads weapon type from the equipped main item', () => {
    expect(computeLoadoutStats([item('main', [], WEAPON_RAILGUN)]).loadout.weaponType).toBe(
      WEAPON_RAILGUN,
    );
    expect(computeLoadoutStats([item('sub', [], 1)]).loadout.subWeaponType).toBe(1);
  });

  it('applies distinct weapon-type baselines (spread vs railgun)', () => {
    const spread = computeLoadoutStats([item('main', [], WEAPON_SPREAD)]).loadout;
    expect(spread.bulletCountAdd).toBe(2);
    expect(spread.spreadAdd).toBeCloseTo(0.5);
    expect(spread.damageMult).toBeLessThan(1);

    const rail = computeLoadoutStats([item('main', [], WEAPON_RAILGUN)]).loadout;
    expect(rail.pierceAdd).toBe(3);
    expect(rail.damageMult).toBeGreaterThan(2);
    expect(rail.fireRateMult).toBeGreaterThan(1); // slower cadence
  });

  it('sums affixes across all equipped items', () => {
    const equipped = [
      item('armor', [{ stat: 'damagePct', value: 10 }]),
      item('core', [{ stat: 'damagePct', value: 15 }]),
      item('module', [
        { stat: 'pierce', value: 1 },
        { stat: 'bulletCount', value: 1 },
      ]),
      item('engine', [{ stat: 'moveSpeedPct', value: 20 }]),
    ];
    const { loadout, worldMods } = computeLoadoutStats(equipped);
    expect(loadout.damageMult).toBeCloseTo(1.25); // +25%
    expect(loadout.pierceAdd).toBe(1);
    expect(loadout.bulletCountAdd).toBe(1);
    expect(loadout.moveSpeedMult).toBeCloseTo(1.2);
    expect(worldMods.mineralFindMult).toBe(1);
  });

  it('routes mineral find to worldMods (meta only), xp to the sim block', () => {
    const equipped = [
      item('shield', [{ stat: 'mineralFindPct', value: 30 }]),
      item('core', [{ stat: 'xpPct', value: 25 }]),
    ];
    const { loadout, worldMods } = computeLoadoutStats(equipped);
    expect(worldMods.mineralFindMult).toBeCloseTo(1.3);
    expect(loadout.xpMult).toBeCloseTo(1.25);
  });

  it('is deterministic and order-independent', () => {
    const a = item('armor', [{ stat: 'damagePct', value: 10 }]);
    const b = item('core', [{ stat: 'maxHpFlat', value: 20 }]);
    expect(computeLoadoutStats([a, b])).toEqual(computeLoadoutStats([b, a]));
  });
});
