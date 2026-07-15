import { describe, it, expect } from 'vitest';
import {
  loadProfile,
  saveProfile,
  migrate,
  defaultProfile,
  stashCapacity,
  activeShip,
  INVENTORY_CAP,
  MAX_STASH_EXPANSIONS,
  type KeyValueStore,
  type Profile,
} from '../src/save/profile.js';
import {
  settleRun,
  grantXp,
  salvageValue,
  salvageItems,
} from '../src/save/settlement.js';
import { rollItem } from '../src/items/roll.js';
import { xpToNext } from '../src/sim/world.js';
import type { LootRecord } from '../src/sim/world.js';
import { SAVE_VERSION } from '../src/items/types.js';
import { SKILL_NODE_COUNT } from '../data/skills.js';

/** In-memory KeyValueStore so tests run under the `node` vitest environment. */
function memStore(seed?: Record<string, string>): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const KEY = 'planet-blitz:profile';

function loot(seed: number, rarity: number, planet = 0, tier = 0): LootRecord {
  return { seed, rarity, planet, tier };
}

describe('profile — save/load round-trip (AC5)', () => {
  it('a fresh default profile survives save→load losslessly', () => {
    const store = memStore();
    const p = defaultProfile();
    saveProfile(p, store);
    expect(loadProfile(store)).toEqual(p);
  });

  it('a populated profile survives save→load losslessly', () => {
    const store = memStore();
    const p = defaultProfile();
    p.inventory.push(rollItem(111, 'rare', { planet: 0, tier: 1 }));
    p.stash.push(rollItem(222, 'magic', { planet: 1, tier: 0 }));
    const ship = activeShip(p);
    ship.equipped.main = rollItem(333, 'unique', { planet: 0, tier: 0 });
    ship.level = 7;
    ship.xp = 12;
    p.credits = 340;
    p.minerals = 15;
    p.skillPoints = 6;
    p.stashExpansions = 2;
    p.planetProgress[1] = { bestTierCleared: 1 };
    saveProfile(p, store);
    expect(loadProfile(store)).toEqual(p);
  });

  it('missing storage falls back to a default profile', () => {
    expect(loadProfile(null)).toEqual(defaultProfile());
  });
});

describe('profile — corruption recovery (AC5)', () => {
  it('invalid JSON recovers to default', () => {
    expect(loadProfile(memStore({ [KEY]: '{not json' }))).toEqual(defaultProfile());
  });

  it('a non-object blob recovers to default', () => {
    expect(loadProfile(memStore({ [KEY]: '42' }))).toEqual(defaultProfile());
  });

  it('drops malformed items but keeps valid ones', () => {
    const good = rollItem(9, 'rare', { planet: 0, tier: 0 });
    const blob = JSON.stringify({
      saveVersion: 1,
      ships: [{ id: 'ship-0', name: 'x', level: 3, xp: 1, equipped: {} }],
      activeShipIndex: 0,
      inventory: [good, { junk: true }, null, 5],
      stash: [],
      stashExpansions: 9, // out of range → clamped
      planetProgress: {},
      credits: 10,
      minerals: 0,
      skillPoints: 0,
    });
    const p = loadProfile(memStore({ [KEY]: blob }));
    expect(p.inventory).toEqual([good]);
    expect(p.stashExpansions).toBe(MAX_STASH_EXPANSIONS);
  });
});

describe('profile — migration v0 → v1 (AC5)', () => {
  it('renames legacy `ship`/`gold` into `ships`/`credits`', () => {
    const v0 = {
      // no saveVersion → treated as v0
      ship: { id: 'ship-0', name: '초기 전투기', level: 5, xp: 3, equipped: {} },
      inventory: [],
      gold: 250,
    };
    const p = migrate(v0);
    // The migration chain (v0→v1→v2) normalizes to the current schema version.
    expect(p.saveVersion).toBe(SAVE_VERSION);
    expect(p.ships).toHaveLength(1);
    expect(p.ships[0]?.level).toBe(5);
    expect(p.credits).toBe(250);
    expect(activeShip(p).name).toBe('초기 전투기');
    // v2 fills a zeroed skill vector for a pre-M3 blob.
    expect(p.skillInvest).toHaveLength(SKILL_NODE_COUNT);
    expect(p.skillInvest.every((v) => v === 0)).toBe(true);
  });
});

describe('stashCapacity (AC6)', () => {
  it('grows 32 → 64 → 96 across two expansions and clamps', () => {
    expect(stashCapacity(0)).toBe(32);
    expect(stashCapacity(1)).toBe(64);
    expect(stashCapacity(2)).toBe(96);
    expect(stashCapacity(5)).toBe(96); // clamped to MAX
  });
});

describe('settleRun — loot → items + leveling (AC3/AC11)', () => {
  it('confirms each loot record deterministically via rollItem', () => {
    const p = defaultProfile();
    const records: LootRecord[] = [loot(101, 2, 0, 1), loot(202, 3, 1, 0)];
    const out = settleRun(p, { victory: true, loot: records, xpTotal: 0, resources: 0 });
    expect(out.itemsGained).toHaveLength(2);
    expect(p.inventory).toHaveLength(2);
    // Same seeds re-roll to byte-identical items.
    expect(out.itemsGained[0]).toEqual(rollItem(101, 'rare', { planet: 0, tier: 1 }));
    expect(out.itemsGained[1]).toEqual(rollItem(202, 'unique', { planet: 1, tier: 0 }));
  });

  it('banks XP onto the active ship and grants one skill point per level', () => {
    const p = defaultProfile();
    // Enough XP for exactly two levels from level 1.
    const need = xpToNext(1) + xpToNext(2);
    const out = settleRun(p, { victory: false, loot: [], xpTotal: need, resources: 0 });
    expect(activeShip(p).level).toBe(3);
    expect(out.levelsGained).toBe(2);
    expect(p.skillPoints).toBe(2);
  });

  it('overflows into stash then reports leftovers when both are full', () => {
    const p = defaultProfile();
    p.stashExpansions = 0; // stash cap 32
    // Fill inventory (48) and stash (32) so the next drop overflows.
    for (let i = 0; i < INVENTORY_CAP; i++) p.inventory.push(rollItem(i + 1, 'normal', { planet: 0, tier: 0 }));
    for (let i = 0; i < 32; i++) p.stash.push(rollItem(1000 + i, 'normal', { planet: 0, tier: 0 }));
    const out = settleRun(p, { victory: true, loot: [loot(5000, 2)], xpTotal: 0, resources: 0 });
    expect(out.overflow).toBe(1);
    expect(p.inventory).toHaveLength(INVENTORY_CAP);
  });

  it('converts raid resources to credits', () => {
    const p = defaultProfile();
    const out = settleRun(p, { victory: true, loot: [], xpTotal: 0, resources: 4 });
    expect(out.creditsGained).toBe(4);
    expect(p.credits).toBe(4);
  });
});

describe('grantXp — level curve', () => {
  it('does not level when XP is insufficient', () => {
    const ship = activeShip(defaultProfile());
    expect(grantXp(ship, xpToNext(1) - 1)).toBe(0);
    expect(ship.level).toBe(1);
  });
});

describe('salvage — bulk disenchant (AC6)', () => {
  it('normal/magic yield credits, rare+ yield minerals', () => {
    expect(salvageValue(rollItem(1, 'normal', { planet: 0, tier: 0 }))).toEqual({ credits: 2, minerals: 0 });
    expect(salvageValue(rollItem(1, 'magic', { planet: 0, tier: 0 }))).toEqual({ credits: 5, minerals: 0 });
    expect(salvageValue(rollItem(1, 'rare', { planet: 0, tier: 0 })).minerals).toBe(3);
    expect(salvageValue(rollItem(1, 'unique', { planet: 0, tier: 0 })).minerals).toBe(8);
  });

  it('scales mineral yield by the loadout mineral-find mult', () => {
    const rare = rollItem(1, 'rare', { planet: 0, tier: 0 });
    expect(salvageValue(rare, 2).minerals).toBe(6);
  });

  it('removes salvaged items and credits/minerals the profile', () => {
    const p: Profile = defaultProfile();
    const normal = rollItem(1, 'normal', { planet: 0, tier: 0 });
    const rare = rollItem(2, 'rare', { planet: 0, tier: 0 });
    p.inventory.push(normal, rare);
    const y = salvageItems(p, [normal, rare]);
    expect(y.credits).toBe(2);
    expect(y.minerals).toBe(3);
    expect(p.inventory).toHaveLength(0);
    expect(p.credits).toBe(2);
    expect(p.minerals).toBe(3);
  });

  it('matches salvage targets by item.id, not reference identity (리뷰 LOW-3)', () => {
    // 인벤토리에 보관된 인스턴스와, 정산에서 다시 롤한(직렬화·복원 등) 동일 아이템이
    // 서로 다른 객체여도 같은 id면 제거돼야 한다.
    const p: Profile = defaultProfile();
    const stored = rollItem(2, 'rare', { planet: 0, tier: 0 });
    p.inventory.push(stored);
    // 동일 seed/rarity/source로 다시 롤 → 값은 같지만 참조는 다른 새 인스턴스.
    const reRolled = rollItem(2, 'rare', { planet: 0, tier: 0 });
    expect(reRolled).not.toBe(stored);
    expect(reRolled.id).toBe(stored.id);
    const y = salvageItems(p, [reRolled]);
    expect(y.minerals).toBe(3);
    expect(p.inventory).toHaveLength(0); // 참조가 달라도 id로 매칭돼 제거됨
  });
});
