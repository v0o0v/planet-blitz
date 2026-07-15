/**
 * Deterministic item roller (M2 Phase A3 — plan §4, AC1).
 *
 * `rollItem(dropSeed, rarity, source)` is a PURE function: it seeds a local
 * `SeededRng` from the drop seed and draws every choice (slot, weapon type,
 * affix count, which affixes, each value) from it. Same input → byte-identical
 * item, on the client and on the verification Edge Function alike (ADR-0005).
 *
 * Discipline (mirrors the sim core even though this file is outside src/sim, so
 * ESLint's sim-core rules do not police it): NO `Math.random`, NO `Date.now`,
 * NO wall-clock. All randomness flows through the seeded RNG; only integer /
 * IEEE-basic arithmetic is used.
 */

import { SeededRng } from '../sim/rng.js';
import type { AffixDef, AffixRoll, Item, ItemSource, Rarity, SlotKind } from './types.js';
import { SLOT_KINDS } from './types.js';
import { AFFIXES } from '../../data/affixes.js';
import { uniquesForSlot } from './uniques.js';
// side-effect: M2 유니크 5점을 레지스트리에 등록(rarity=unique 롤이 슬롯별로 선택).
import '../../data/uniques.js';

/** Number of sub-weapon variants a `sub` item can roll (0..N-1). */
const SUB_WEAPON_VARIANTS = 2;

/**
 * Affix count for a rarity, drawn from `rng` (plan A1/A3):
 *   - normal: 0
 *   - magic : 1..2
 *   - rare  : 3..6
 *   - unique: 3..6 fixed-rolled affixes plus the unique's own effect.
 */
function affixCountFor(rarity: Rarity, rng: SeededRng): number {
  switch (rarity) {
    case 'normal':
      return 0;
    case 'magic':
      return rng.int(1, 2);
    case 'rare':
      return rng.int(3, 6);
    case 'unique':
      return rng.int(3, 6);
  }
}

/**
 * Draw `count` DISTINCT affixes from the pool and roll each value. Selection is
 * without replacement over a working copy of the pool, so the same seed always
 * yields the same affix set in the same order.
 */
function rollAffixes(rng: SeededRng, count: number): AffixRoll[] {
  const pool: AffixDef[] = AFFIXES.slice();
  const rolls: AffixRoll[] = [];
  const n = count < pool.length ? count : pool.length;
  for (let k = 0; k < n; k++) {
    const j = rng.int(0, pool.length - 1);
    const def = pool[j];
    pool.splice(j, 1);
    if (def === undefined) continue;
    const value = rng.int(def.min, def.max);
    rolls.push({ id: def.id, stat: def.stat, value });
  }
  return rolls;
}

/**
 * Confirm the item a drop stands for. Deterministic in (`dropSeed`, `rarity`,
 * `source`).
 */
export function rollItem(dropSeed: number, rarity: Rarity, source: ItemSource): Item {
  const seed = dropSeed >>> 0;
  const rng = new SeededRng(seed);

  const slot = SLOT_KINDS[rng.int(0, SLOT_KINDS.length - 1)] as SlotKind;

  // Weapon variant: main → 0..4 (발칸/스프레드/레일건/미사일/빔), sub → 0..1 sub
  // variant. `int` consumes one nextU32 regardless of span, so widening the main
  // range from 0..2 to 0..4 does NOT shift any later draw (RNG stream shape is
  // preserved) — only the resolved main weapon value changes (M3 C1: 5 types).
  let weaponType: number | undefined;
  if (slot === 'main') weaponType = rng.int(0, 4);
  else if (slot === 'sub') weaponType = rng.int(0, SUB_WEAPON_VARIANTS - 1);

  const affixes = rollAffixes(rng, affixCountFor(rarity, rng));

  // Unique id (Lane 3 registry). Draw the RNG unconditionally-shaped: only when
  // the rarity is unique AND a unique exists for this slot. Empty registry →
  // undefined (item behaves as a high rare until Lane 3 wires the effect).
  let uniqueId: string | undefined;
  if (rarity === 'unique') {
    // main 슬롯은 아이템 weaponType과 일치하는(또는 무기타입 무관인) 유니크만 후보로
    // 삼는다(리뷰 MED-1: 페어링 보장). 후보 LIST만 좁힐 뿐 아래 draw는 항상 1회이므로
    // RNG 스트림 형태는 불변이다.
    const candidates = uniquesForSlot(slot, slot === 'main' ? weaponType : undefined);
    // RNG 스트림 형태를 레지스트리 population과 무관하게 유지: unique면 무조건 draw 1회
    // (int은 span과 상관없이 nextU32 1회 소비 — rng.ts), 빈 레지스트리면 결과만 버린다.
    // 이렇게 해야 Lane 3가 유니크를 채워도 이후 아이템의 롤이 밀리지 않는다(결정론).
    const idx = rng.int(0, Math.max(0, candidates.length - 1));
    if (candidates.length > 0) {
      uniqueId = candidates[idx]?.id;
    }
  }

  // Build without assigning `undefined` to optional fields (exactOptionalPropertyTypes).
  return {
    id: `it-${seed}`,
    slot,
    rarity,
    affixes,
    source,
    ...(weaponType !== undefined ? { weaponType } : {}),
    ...(uniqueId !== undefined ? { uniqueId } : {}),
  };
}

/**
 * Reforge an item's affixes at the refinery (M3 Phase A4 — plan §4, AC3). PURE in
 * (`item`'s affix shape, `rerollSeed`, `lockedIndex`): a local RNG seeded from
 * `rerollSeed` redraws every affix EXCEPT the one at `lockedIndex` (locked-reroll,
 * the 광물 3배 option — cost is meta, handled by the caller). The locked affix is
 * preserved in place and excluded from the redraw pool so it is never duplicated.
 * The affix COUNT is preserved (a reroll reforges, it does not add/remove slots).
 *
 * Everything else (id, slot, rarity, weaponType, uniqueId, source) is carried
 * unchanged — it is the same item, reforged. Deterministic: same inputs → same
 * result on the client and the verification Edge Function alike (ADR-0005).
 */
export function rerollAffixes(item: Item, rerollSeed: number, lockedIndex?: number): Item {
  const count = item.affixes.length;
  const hasLock =
    lockedIndex !== undefined &&
    lockedIndex >= 0 &&
    lockedIndex < count &&
    item.affixes[lockedIndex] !== undefined;
  // Nothing to reroll (0 affixes, or a single locked affix): return an identical
  // copy so the call is still a pure, side-effect-free reforge.
  if (count === 0 || (hasLock && count === 1)) {
    return { ...item, affixes: item.affixes.slice() };
  }

  const rng = new SeededRng(rerollSeed >>> 0);
  const locked = hasLock ? item.affixes[lockedIndex as number] : undefined;

  // Redraw pool excludes the locked affix's def so it is never re-rolled onto
  // another slot (distinctness across the whole item is preserved).
  const pool: AffixDef[] = AFFIXES.filter((d) => d.id !== locked?.id);
  const needed = count - (hasLock ? 1 : 0);
  const fresh: AffixRoll[] = [];
  const n = needed < pool.length ? needed : pool.length;
  for (let k = 0; k < n; k++) {
    const j = rng.int(0, pool.length - 1);
    const def = pool[j];
    pool.splice(j, 1);
    if (def === undefined) continue;
    const value = rng.int(def.min, def.max);
    fresh.push({ id: def.id, stat: def.stat, value });
  }

  // Reassemble: keep the locked affix at its index, fill the rest in order.
  const out: AffixRoll[] = new Array<AffixRoll>(count);
  let f = 0;
  for (let i = 0; i < count; i++) {
    if (hasLock && i === lockedIndex && locked !== undefined) {
      out[i] = locked;
    } else {
      const r = fresh[f++];
      // Pool smaller than needed (only with an exhausted affix table): fall back
      // to the original affix at this slot rather than leaving a hole.
      out[i] = r ?? (item.affixes[i] as AffixRoll);
    }
  }
  return { ...item, affixes: out };
}
