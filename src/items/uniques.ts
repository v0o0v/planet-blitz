/**
 * Unique-effect registry (M2 hook point — plan A4 / F1).
 *
 * Lane 1 owns the *shape* of this registry and its integration points (the roll
 * path picks a unique id from it; the loadout pipeline ORs each equipped
 * unique's bit into `LoadoutConfig.uniqueMask`, and the sim reads that mask).
 * Lane 3 (F1) POPULATES it with the five M2 uniques and their sim behaviour.
 *
 * Until Lane 3 registers them the registry is empty: `rollItem('unique', …)`
 * simply yields a high-tier item with `uniqueId === undefined` (it behaves like
 * a rare), and `uniqueMask` stays 0 — no sim behaviour changes. This keeps Lane
 * 1 self-contained and testable while leaving the wiring in place.
 */

import type { SlotKind } from './types.js';

export interface UniqueDef {
  readonly id: string;
  /** Korean display name. */
  readonly name: string;
  /** Slot this unique rolls into. */
  readonly slot: SlotKind;
  /**
   * Bit (0..30) OR-ed into `LoadoutConfig.uniqueMask` when equipped. The sim
   * reads the mask to gate the unique's deterministic behaviour (Lane 3).
   */
  readonly bit: number;
}

/** id → def. Populated by Lane 3 via {@link registerUnique}. */
export const UNIQUE_REGISTRY: Map<string, UniqueDef> = new Map();

/** Register a unique (Lane 3). Idempotent by id. */
export function registerUnique(def: UniqueDef): void {
  UNIQUE_REGISTRY.set(def.id, def);
}

/** All registered uniques that roll into `slot`, in stable insertion order. */
export function uniquesForSlot(slot: SlotKind): UniqueDef[] {
  const out: UniqueDef[] = [];
  for (const def of UNIQUE_REGISTRY.values()) if (def.slot === slot) out.push(def);
  return out;
}
