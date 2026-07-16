/**
 * 하네스 프로필 프리셋 (개발 도구, DEV 전용).
 *
 * A preset is a ready-made {@link Profile} the harness can inject into the
 * isolated 하네스 프로필 slot so a tester can jump straight into a given account
 * state. Presets are built with the SAME deterministic item generator the real
 * game uses (`rollItem`), so the gear they equip is valid, reproducible and
 * indistinguishable from farmed loot — no hand-forged `Item` structs.
 *
 * Pure: `buildPreset` takes no ambient state and returns a fresh profile every
 * call, so it is unit-testable under the `node` vitest environment.
 */

import { rollItem } from '../items/roll.js';
import type { Item, Rarity, SlotKind } from '../items/types.js';
import { EQUIP_SLOTS } from '../items/types.js';
import type { EquipSlotId } from '../items/types.js';
import { defaultProfile } from '../save/profile.js';
import type { Profile } from '../save/profile.js';

/** The built-in preset kinds. `fresh` = brand-new pilot; `maxed` = endgame. */
export type PresetKind = 'fresh' | 'maxed';

/** The equip position → slot kind the item at that position must be. */
const SLOT_KIND_FOR: Record<EquipSlotId, SlotKind> = {
  main: 'main',
  sub: 'sub',
  armor: 'armor',
  shield: 'shield',
  engine: 'engine',
  core: 'core',
  module0: 'module',
  module1: 'module',
};

/**
 * Roll an item of a specific slot kind + rarity by scanning drop seeds until the
 * generator yields the wanted slot. `rollItem` picks the slot from the seed, so
 * we brute-force forward from `startSeed` (bounded) — deterministic in
 * (startSeed, slotKind, rarity). Falls back to the last roll if no match is found
 * within the cap (never happens for the seven slot kinds in practice).
 */
function rollItemForSlot(
  startSeed: number,
  slotKind: SlotKind,
  rarity: Rarity,
): Item {
  const source = { planet: 0, tier: 1 };
  let last = rollItem(startSeed >>> 0, rarity, source);
  for (let i = 0; i < 4096; i++) {
    const item = rollItem((startSeed + i) >>> 0, rarity, source);
    if (item.slot === slotKind) return item;
    last = item;
  }
  return last;
}

/** Equip a decent item into every one of the eight positions (deterministic). */
function buildMaxedEquip(): Partial<Record<EquipSlotId, Item>> {
  const equipped: Partial<Record<EquipSlotId, Item>> = {};
  let seed = 0x5eed_0001;
  for (const pos of EQUIP_SLOTS) {
    // Main slot rolls a unique (showcases the unique-effect path); the rest roll
    // rare (three-to-six affixes — "decent" endgame gear).
    const rarity: Rarity = pos === 'main' ? 'unique' : 'rare';
    equipped[pos] = rollItemForSlot(seed, SLOT_KIND_FOR[pos], rarity);
    // Advance the seed well past the scanned window so positions don't collide.
    seed = (seed + 0x1_0000) >>> 0;
  }
  return equipped;
}

/**
 * Build a fresh profile for `kind`. `fresh` is the game's default profile (new
 * pilot, tutorial pending). `maxed` is an endgame account: a level-100 ship in
 * full rare/unique gear, a big currency + skill-point float, and the tutorial
 * already cleared so the base map is the hub.
 */
export function buildPreset(kind: PresetKind): Profile {
  const profile = defaultProfile();
  if (kind === 'fresh') return profile;

  // maxed
  const ship = profile.ships[0];
  if (ship !== undefined) {
    ship.level = 100;
    ship.xp = 0;
    ship.equipped = buildMaxedEquip();
  }
  profile.credits = 999_999;
  profile.minerals = 999_999;
  profile.skillPoints = 100;
  profile.tutorialDone = true;
  // Record a clear on the two starter planets so 정제소 unlocks + tiers are open.
  profile.planetProgress = {
    0: { bestTierCleared: 1 },
    1: { bestTierCleared: 1 },
  };
  return profile;
}
