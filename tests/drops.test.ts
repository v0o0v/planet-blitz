import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import { blankEntity, addEntity, spawnLoot } from '../src/sim/entities.js';
import {
  computeLoadoutStats,
  neutralLoadout,
  WEAPON_VULCAN,
  WEAPON_RAILGUN,
  WEAPON_SPREAD,
} from '../src/items/loadout.js';
import { rollEliteDrop, rollBossDrop, RARITY_RARE, RARITY_UNIQUE } from '../src/sim/drops.js';
import { SeededRng } from '../src/sim/rng.js';
import { isElite } from '../src/sim/elite.js';

function countKind(state: { entities: { kind: string }[] }, kind: string): number {
  return state.entities.filter((e) => e.kind === kind).length;
}

describe('drop rolls (AC3)', () => {
  it('rollEliteDrop is deterministic and yields a valid rarity', () => {
    const a = rollEliteDrop(new SeededRng(5), 0, { kind: -1, active: false });
    const b = rollEliteDrop(new SeededRng(5), 0, { kind: -1, active: false });
    expect(a).toEqual(b);
    expect(a.rarityCode).toBeGreaterThanOrEqual(1);
    expect(a.rarityCode).toBeLessThanOrEqual(3);
  });

  it('rollBossDrop always yields rare or unique (guaranteed high-tier)', () => {
    for (let s = 1; s <= 300; s++) {
      const roll = rollBossDrop(new SeededRng(s), 0, { kind: -1, active: false });
      expect([RARITY_RARE, RARITY_UNIQUE]).toContain(roll.rarityCode);
    }
  });
});

describe('loot pickup accumulation (AC3, OQ-M2-1 contact auto-collect)', () => {
  it('collects a loot drop on contact and records seed/rarity/source', () => {
    const cfg: WorldConfig = { ...DEFAULT_CONFIG, planet: 1, tier: 1 };
    const state = createWorld(123, cfg);
    const player = state.entities[0]!;
    spawnLoot(state, player.x, player.y, 0xabcdef, RARITY_RARE);
    stepWorld(state, emptyInput());
    expect(state.loot.length).toBe(1);
    expect(state.loot[0]).toEqual({ seed: 0xabcdef, rarity: RARITY_RARE, planet: 1, tier: 1 });
    expect(countKind(state, 'loot')).toBe(0); // consumed
  });
});

describe('elite spawning by tier (AC9)', () => {
  it('engagement tier spawns elites; recon tier does not', () => {
    // Elites are combatants that get killed, so count the max seen alive across
    // the run rather than the final tick.
    const maxElitesSeen = (tier: number): number => {
      const state = createWorld(0x1234, { ...DEFAULT_CONFIG, tier });
      const input = emptyInput();
      let max = 0;
      for (let t = 0; t < 400; t++) {
        stepWorld(state, input);
        const n = state.entities.filter(isElite).length;
        if (n > max) max = n;
      }
      return max;
    };
    expect(maxElitesSeen(1)).toBeGreaterThan(0);
    expect(maxElitesSeen(0)).toBe(0);
  });
});

/** Spawn a stationary target enemy right next to the player so autoAttack fires. */
function addTargetEnemy(state: ReturnType<typeof createWorld>): void {
  const player = state.entities[0]!;
  const e = blankEntity('enemy');
  e.x = player.x + 200;
  e.y = player.y;
  e.radius = 30;
  e.hp = 100000; // survive the shot so we can count bullets cleanly
  e.maxHp = 100000;
  e.enemyType = 0;
  addEntity(state, e);
}

describe('weapon-type firing archetypes (AC4)', () => {
  function loadoutCfg(weaponType: number, bulletCountAdd: number): WorldConfig {
    return { ...DEFAULT_CONFIG, loadout: { ...neutralLoadout(), weaponType, bulletCountAdd } };
  }

  it('railgun fires a single shot regardless of bullet count; vulcan fans', () => {
    // Railgun with a large bulletCount add still fires ONE bullet per volley.
    const rail = createWorld(1, loadoutCfg(WEAPON_RAILGUN, 4));
    addTargetEnemy(rail);
    stepWorld(rail, emptyInput());
    expect(countKind(rail, 'bullet')).toBe(1);

    // Vulcan with the same bulletCount add fans that many pellets.
    const vulcan = createWorld(1, loadoutCfg(WEAPON_VULCAN, 4));
    addTargetEnemy(vulcan);
    stepWorld(vulcan, emptyInput());
    expect(countKind(vulcan, 'bullet')).toBe(5);
  });

  it('spread type fans multiple pellets from its computed baseline', () => {
    // A real spread loadout (via computeLoadoutStats) carries the +2 pellet
    // baseline, so it fans 3 pellets (base 1 + 2).
    const { loadout } = computeLoadoutStats([
      { id: 'm', slot: 'main', rarity: 'rare', affixes: [], source: { planet: 0, tier: 0 }, weaponType: WEAPON_SPREAD },
    ]);
    const spread = createWorld(1, { ...DEFAULT_CONFIG, loadout });
    addTargetEnemy(spread);
    stepWorld(spread, emptyInput());
    expect(countKind(spread, 'bullet')).toBe(3);
  });
});
