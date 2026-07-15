/**
 * Item data model (M2 Phase A1 — plan §4).
 *
 * ADR-0005 boundary (plan §2 ①A): the simulation never carries item structs.
 * A drop emits only a *drop seed* (u32); the item it stands for is confirmed
 * afterwards by the pure function `rollItem` (src/items/roll.ts) from that seed +
 * rarity + source. This module defines the resulting `Item` shape and the stat
 * vocabulary the loadout pipeline (src/items/loadout.ts) consumes. It is pure
 * data/types — no RNG, no sim imports at runtime — so both the client and the
 * Edge Function reproduce the same item from the same seed.
 */

/** Save-schema version stamped onto serialized profiles (plan A1 / C1). Bump on
 *  any breaking layout change so the migration path can key off it. */
export const SAVE_VERSION = 1;

// ---------------------------------------------------------------------------
// Rarity
// ---------------------------------------------------------------------------

export type Rarity = 'normal' | 'magic' | 'rare' | 'unique';

/**
 * Stable numeric code per rarity. Stored on the `loot` drop entity (enemyType
 * field) and folded into the state hash, so NEVER renumber — a recorded run
 * must re-verify identically. New rarities would append.
 */
export const RARITY_CODE: Record<Rarity, number> = {
  normal: 0,
  magic: 1,
  rare: 2,
  unique: 3,
};

/** Inverse of {@link RARITY_CODE} (index = code). */
export const RARITY_BY_CODE: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];

// ---------------------------------------------------------------------------
// Slots — 7 kinds across 8 equip positions (GDD §5; module has two).
// ---------------------------------------------------------------------------

export type SlotKind = 'main' | 'sub' | 'armor' | 'shield' | 'engine' | 'core' | 'module';

/** The seven slot kinds, in a stable order (index used by the seeded roller). */
export const SLOT_KINDS: readonly SlotKind[] = [
  'main',
  'sub',
  'armor',
  'shield',
  'engine',
  'core',
  'module',
];

/**
 * The eight equip positions. `module` occupies two (module0/module1); every
 * other kind occupies one. The loadout pipeline sums whatever items sit in these
 * eight positions — order is irrelevant to the sum, but the ids are stable for
 * the save schema and inventory UI (Lane 2).
 */
export const EQUIP_SLOTS = [
  'main',
  'sub',
  'armor',
  'shield',
  'engine',
  'core',
  'module0',
  'module1',
] as const;
export type EquipSlotId = (typeof EQUIP_SLOTS)[number];

// ---------------------------------------------------------------------------
// Affixes — the stat vocabulary the loadout pipeline understands.
// ---------------------------------------------------------------------------

/**
 * Every stat an affix can grant. The loadout pipeline (A4) maps each key onto a
 * derived weapon/config/world modifier. Percent keys are stored as integers
 * (e.g. `10` = +10%); flat keys are absolute additions.
 *
 * M2 shipped the 21-affix pool (9 prefix + 12 suffix). M3 adds the three elemental
 * prefixes (fire/cold/lightning) with the status-effect system (OQ-M3-5), completing
 * the 24-affix pool. Each elemental key feeds a status effect via the loadout →
 * LoadoutConfig elemental block (fireDmg / coldSlow / lightning).
 */
export type StatKey =
  // --- Prefix (offence) ---
  | 'damagePct'
  | 'fireRatePct'
  | 'bulletCount'
  | 'pierce'
  | 'bulletSpeedPct'
  | 'rangeFlat'
  // --- Prefix (M3 원소 — 상태이상) ---
  | 'fireDmg' // 화염: 명중 시 지속피해(틱당 피해)
  | 'coldSlow' // 냉기: 명중 시 적 감속
  | 'lightning' // 전격: 명중 시 인접 적 연쇄 피해
  // --- Suffix (utility / survival) ---
  | 'moveSpeedPct'
  | 'maxHpFlat'
  | 'maxHpPct'
  | 'dashCdPct'
  | 'magnetPct'
  | 'xpPct'
  | 'mineralFindPct';

export type AffixKind = 'prefix' | 'suffix';

/** A designer-authored affix template (data/affixes.ts). Value rolls uniformly
 *  in the inclusive integer range [min, max] via the drop-seed RNG. */
export interface AffixDef {
  readonly id: string;
  /** Korean display name (nameplate/tooltip). */
  readonly name: string;
  readonly kind: AffixKind;
  readonly stat: StatKey;
  readonly min: number;
  readonly max: number;
}

/** A concrete rolled affix on an item instance. */
export interface AffixRoll {
  /** {@link AffixDef.id} this roll came from. */
  readonly id: string;
  readonly stat: StatKey;
  /** Rolled integer value within the def's [min, max]. */
  readonly value: number;
}

// ---------------------------------------------------------------------------
// Item instance
// ---------------------------------------------------------------------------

/** Where a drop came from — feeds drop tables and is stamped onto the item so
 *  the settlement/inventory can show provenance (planet index, tier index). */
export interface ItemSource {
  /** Planet index (0 = 카르곤, 1 = 베르단, …). */
  readonly planet: number;
  /** Tier index (0 = 정찰, 1 = 교전). */
  readonly tier: number;
}

/**
 * A confirmed item. Fully determined by `rollItem(dropSeed, rarity, source)`, so
 * two runs that emit the same drop seed reconstruct byte-identical items.
 */
export interface Item {
  /** Instance id, derived from the drop seed (stable, reproducible). */
  readonly id: string;
  readonly slot: SlotKind;
  readonly rarity: Rarity;
  readonly affixes: readonly AffixRoll[];
  /**
   * Main-weapon type (0 = 발칸, 1 = 스프레드, 2 = 레일건) for `main` items, or
   * sub-weapon variant for `sub` items. `undefined` for non-weapon slots.
   */
  readonly weaponType?: number;
  /** Set only for `unique` items — keys the unique-effect registry (Lane 3). */
  readonly uniqueId?: string;
  readonly source: ItemSource;
}
