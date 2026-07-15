/**
 * Local profile store (M2 Phase C1 — plan §4, AC5).
 *
 * A `Profile` is the player's persistent meta state: their ships (level/xp/
 * equipped gear), inventory + stash of items, per-planet progress, and the three
 * meta currencies (credits / minerals / skill points). It lives entirely OUTSIDE
 * the simulation — `saveVersion` stamps the schema so a future migration can key
 * off it (the M4 Supabase move, ADR-0002).
 *
 * Determinism note: this layer is render/meta only, so it is free to touch the
 * clock or storage. It still avoids any RNG — item ids come from `rollItem`
 * (drop-seed derived), never from `Math.random`.
 *
 * Storage is pluggable (`KeyValueStore`): production uses `localStorage`; tests
 * pass an in-memory mock so they can run under the `node` vitest environment
 * without a DOM. Corrupt or partial storage always recovers to a default profile
 * rather than throwing.
 */

import { SAVE_VERSION, SLOT_KINDS, RARITY_BY_CODE } from '../items/types.js';
import type { Item, EquipSlotId } from '../items/types.js';

/** Inventory capacity — 48 slots (6×8 grid, plan D1). */
export const INVENTORY_CAP = 48;
/** Base stash capacity before any expansion. */
export const STASH_BASE = 32;
/** Extra stash slots granted per credit-bought expansion. */
export const STASH_PER_EXPANSION = 32;
/** Max stash expansions (2 → 32 + 64 = 96 total, plan D1 / AC6). */
export const MAX_STASH_EXPANSIONS = 2;

/** localStorage key the profile is serialized under. */
const STORAGE_KEY = 'planet-blitz:profile';

/** Current stash capacity for a given expansion count (clamped 0..MAX). */
export function stashCapacity(expansions: number): number {
  const e = clampInt(expansions, 0, MAX_STASH_EXPANSIONS, 0);
  return STASH_BASE + STASH_PER_EXPANSION * e;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/** One playable ship: its level/xp progression and the eight equip positions. */
export interface Ship {
  readonly id: string;
  name: string;
  /** Current level (starts at 1). */
  level: number;
  /** XP banked toward the next level (resets each level-up, plan AC11). */
  xp: number;
  /** Items in the eight equip positions (absent = empty slot). */
  equipped: Partial<Record<EquipSlotId, Item>>;
}

/** Per-planet clear progress (drives star-map gating, plan D3). */
export interface PlanetProgress {
  /** Highest tier cleared (-1 none, 0 정찰, 1 교전). */
  bestTierCleared: number;
}

/** The player's whole persistent meta state. */
export interface Profile {
  saveVersion: number;
  ships: Ship[];
  /** Index into `ships` of the active loadout. */
  activeShipIndex: number;
  inventory: Item[];
  stash: Item[];
  /** Purchased stash expansions (0..MAX_STASH_EXPANSIONS). */
  stashExpansions: number;
  /** planet id → progress. */
  planetProgress: Record<number, PlanetProgress>;
  credits: number;
  minerals: number;
  /** Banked skill points (M3 spends them; M2 only accrues, OQ-M2-7). */
  skillPoints: number;
}

/** A minimal synchronous key/value store (localStorage-compatible subset). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultShip(): Ship {
  return { id: 'ship-0', name: '초기 전투기', level: 1, xp: 0, equipped: {} };
}

/** A fresh profile — one starter ship, empty everything. */
export function defaultProfile(): Profile {
  return {
    saveVersion: SAVE_VERSION,
    ships: [defaultShip()],
    activeShipIndex: 0,
    inventory: [],
    stash: [],
    stashExpansions: 0,
    planetProgress: {},
    credits: 0,
    minerals: 0,
    skillPoints: 0,
  };
}

/** The active ship (falls back to the first, then a fresh default). */
export function activeShip(profile: Profile): Ship {
  return profile.ships[profile.activeShipIndex] ?? profile.ships[0] ?? defaultShip();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Resolve the ambient `localStorage`, or null when unavailable/blocked. */
function defaultStore(): KeyValueStore | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Access can throw in sandboxed / privacy-mode contexts.
  }
  return null;
}

/**
 * Load + migrate the stored profile. Any failure (no store, missing key, invalid
 * JSON, shape corruption) recovers to a fresh default profile (AC5).
 */
export function loadProfile(store: KeyValueStore | null = defaultStore()): Profile {
  if (store === null) return defaultProfile();
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return defaultProfile();
  }
  if (raw === null) return defaultProfile();
  try {
    return migrate(JSON.parse(raw) as unknown);
  } catch {
    return defaultProfile();
  }
}

/** Persist the profile. Storage errors (quota, denied) are swallowed. */
export function saveProfile(profile: Profile, store: KeyValueStore | null = defaultStore()): void {
  if (store === null) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Quota exceeded or access denied — meta state is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Migration + normalization
// ---------------------------------------------------------------------------

/**
 * Bring any stored blob up to the current schema. Reads `saveVersion` (absent =
 * legacy v0), runs the stepwise migrations, then normalizes every field so a
 * partially-corrupt profile still yields a valid one.
 */
export function migrate(raw: unknown): Profile {
  if (typeof raw !== 'object' || raw === null) return defaultProfile();
  let data = raw as Record<string, unknown>;
  const version = typeof data.saveVersion === 'number' ? data.saveVersion : 0;
  if (version < 1) data = migrateV0toV1(data);
  return normalizeProfile(data);
}

/**
 * v0 → v1: the pre-M2 shape had a single `ship` object and `gold` currency;
 * v1 uses a `ships` array and `credits`. Fields are renamed here; anything else
 * is left for {@link normalizeProfile} to fill/validate.
 */
function migrateV0toV1(v0: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...v0, saveVersion: 1 };
  if (out.ships === undefined && v0.ship !== undefined) {
    out.ships = [v0.ship];
    delete out.ship;
  }
  if (out.credits === undefined && typeof v0.gold === 'number') {
    out.credits = v0.gold;
    delete out.gold;
  }
  return out;
}

function normalizeProfile(d: Record<string, unknown>): Profile {
  const base = defaultProfile();
  const ships = Array.isArray(d.ships)
    ? d.ships.map(normalizeShip).filter((s): s is Ship => s !== null)
    : [];
  const finalShips = ships.length > 0 ? ships : base.ships;
  return {
    saveVersion: SAVE_VERSION,
    ships: finalShips,
    activeShipIndex: clampInt(d.activeShipIndex, 0, finalShips.length - 1, 0),
    inventory: normalizeItems(d.inventory),
    stash: normalizeItems(d.stash),
    stashExpansions: clampInt(d.stashExpansions, 0, MAX_STASH_EXPANSIONS, 0),
    planetProgress: normalizeProgress(d.planetProgress),
    credits: numOr(d.credits, 0),
    minerals: numOr(d.minerals, 0),
    skillPoints: numOr(d.skillPoints, 0),
  };
}

function normalizeShip(v: unknown): Ship | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  const equipped: Partial<Record<EquipSlotId, Item>> = {};
  if (typeof s.equipped === 'object' && s.equipped !== null) {
    for (const [slot, item] of Object.entries(s.equipped as Record<string, unknown>)) {
      if (isValidItem(item)) equipped[slot as EquipSlotId] = item;
    }
  }
  return {
    id: typeof s.id === 'string' ? s.id : 'ship-0',
    name: typeof s.name === 'string' ? s.name : '초기 전투기',
    level: Math.max(1, numOr(s.level, 1)),
    xp: Math.max(0, numOr(s.xp, 0)),
    equipped,
  };
}

function normalizeItems(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isValidItem);
}

function normalizeProgress(v: unknown): Record<number, PlanetProgress> {
  const out: Record<number, PlanetProgress> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isFinite(id)) continue;
    if (typeof val === 'object' && val !== null) {
      const p = val as Record<string, unknown>;
      out[id] = { bestTierCleared: clampInt(p.bestTierCleared, -1, 99, -1) };
    }
  }
  return out;
}

/**
 * Shape guard for a serialized item. Valid items pass through untouched, so a
 * save→load round-trip is lossless; anything malformed is dropped.
 */
export function isValidItem(v: unknown): v is Item {
  if (typeof v !== 'object' || v === null) return false;
  const it = v as Record<string, unknown>;
  return (
    typeof it.id === 'string' &&
    typeof it.slot === 'string' &&
    (SLOT_KINDS as readonly string[]).includes(it.slot) &&
    typeof it.rarity === 'string' &&
    (RARITY_BY_CODE as readonly string[]).includes(it.rarity) &&
    Array.isArray(it.affixes) &&
    typeof it.source === 'object' &&
    it.source !== null
  );
}

// ---------------------------------------------------------------------------
// Small coercion helpers
// ---------------------------------------------------------------------------

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
  if (max < min) return min;
  return n < min ? min : n > max ? max : n;
}
