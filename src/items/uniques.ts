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
  /**
   * 주무기 파생 유니크(빔·미사일·스프레드…)의 요구 weaponType. 지정되면 rollItem이
   * 이 유니크를 **같은 weaponType의 main 아이템에만** 롤한다(비대응 무기에 붙어 죽은
   * 옵션이 되는 것을 방지 — 리뷰 MED-1). undefined면 무기타입 무관(비-main 유니크·
   * 범용 main). 시뮬 훅도 weaponType으로 이중 게이트한다(world.ts).
   */
  readonly weaponType?: number;
}

/** id → def. Populated by Lane 3 via {@link registerUnique}. */
export const UNIQUE_REGISTRY: Map<string, UniqueDef> = new Map();

/** Register a unique (Lane 3). Idempotent by id. */
export function registerUnique(def: UniqueDef): void {
  UNIQUE_REGISTRY.set(def.id, def);
}

/**
 * All registered uniques that roll into `slot`, in stable insertion order.
 *
 * When `weaponType` is supplied (main-weapon roll), the candidate set is further
 * constrained to uniques whose own `weaponType` matches — untyped uniques
 * (`weaponType === undefined`, i.e. weapon-agnostic) always remain eligible.
 * This keeps a beam-only unique off a vulcan main, etc. (리뷰 MED-1). The filter
 * only narrows the candidate LIST; the caller's RNG draw count is unchanged, so
 * the roll stream shape stays invariant (roll.ts).
 */
export function uniquesForSlot(slot: SlotKind, weaponType?: number): UniqueDef[] {
  const out: UniqueDef[] = [];
  for (const def of UNIQUE_REGISTRY.values()) {
    if (def.slot !== slot) continue;
    if (weaponType !== undefined && def.weaponType !== undefined && def.weaponType !== weaponType)
      continue;
    out.push(def);
  }
  return out;
}
