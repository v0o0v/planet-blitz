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

/** Number of sub-weapon variants a `sub` item can roll (0..N-1). GDD §5 "보조무기
 *  5종" (사이드킥/스캐터/기뢰장/센트리/호밍 플레어). `int` consumes one nextU32
 *  regardless of span, so widening 0..1 → 0..4 preserves the RNG stream shape —
 *  only the resolved sub weapon value for a given drop seed changes. */
const SUB_WEAPON_VARIANTS = 5;

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

/** 정련 공정(ADR-0040)의 재단조 옵션. */
export interface ReforgeOpts {
  /** 재추첨에서 제외할 어픽스 인덱스(누적 고착). 중복·범위 밖은 무시. */
  readonly fastened?: readonly number[];
  /** 값 품질 밴드 하한 비율 [0,1]. 0 = 현행 균등 분포. */
  readonly band?: number;
}

/** `band` 를 [0,1] 로 클램프(NaN 은 0 취급). */
function clampBand(band: number | undefined): number {
  if (band === undefined || !Number.isFinite(band)) return 0;
  if (band <= 0) return 0;
  if (band >= 1) return 1;
  return band;
}

/**
 * `fastened` 정규화 — 정수·범위 안·실재하는 어픽스만 남기고 중복 제거 후 오름차순 정렬.
 */
function normalizeFastened(item: Item, fastened: readonly number[] | undefined): number[] {
  const count = item.affixes.length;
  const out: number[] = [];
  for (const raw of fastened ?? []) {
    if (!Number.isInteger(raw)) continue;
    if (raw < 0 || raw >= count) continue;
    if (item.affixes[raw] === undefined) continue;
    if (out.indexOf(raw) >= 0) continue;
    out.push(raw);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * 정련 공정의 재단조(ADR-0040). 순수 함수 — (`item` 의 어픽스 형태, `rerollSeed`, `opts`)
 * 에만 의존한다. `rerollSeed` 로 시드한 로컬 RNG 가 **고착되지 않은** 어픽스를 전부 다시
 * 뽑는다. 고착된 어픽스는 값·인덱스가 그대로 유지되고, 그 `def.id` 가 재추첨 풀에서 빠져
 * 중복이 생기지 않는다. 어픽스 **개수**는 언제나 보존된다(재단조는 슬롯을 늘리거나 줄이지
 * 않는다 — `requiredLevel` 이 개수 파생이라 구조적 불변이 여기 걸려 있다).
 *
 * ## RNG 스트림 형태 불변 (최우선 제약)
 * 값 밴드가 걸려도 값 추첨은 `rng.int()` **정확히 1회**다:
 * ```ts
 * const lo = def.min + Math.round((def.max - def.min) * band);
 * const value = rng.int(lo, def.max);
 * ```
 * `band = 0` 이면 `lo === def.min` 이라 밴드 도입 이전과 **바이트 동일**한 결과가 나온다.
 * 퇴화 범위(`min === max`: `multibarrel`·`piercing`·`freezing`)는 `lo === def.max` 라
 * 밴드와 무관하게 항상 같은 값을 낸다 — 별도 분기 없이 산식에서 자연히 성립한다.
 *
 * 나머지(id, slot, rarity, weaponType, uniqueId, source)는 그대로 실려 나간다 — 같은
 * 아이템을 다시 벼린 것이다. 결정론: 같은 입력 → 클라와 검증 런타임에서 같은 결과(ADR-0005).
 */
export function reforgeAffixes(item: Item, rerollSeed: number, opts?: ReforgeOpts): Item {
  const count = item.affixes.length;
  const band = clampBand(opts?.band);
  const fastened = normalizeFastened(item, opts?.fastened);

  // 다시 뽑을 것이 없다(어픽스 0개, 또는 전부 고착): 순수·부작용 없는 재단조가 되도록
  // 동일한 복사본을 돌려준다.
  if (count === 0 || fastened.length >= count) {
    return { ...item, affixes: item.affixes.slice() };
  }

  const rng = new SeededRng(rerollSeed >>> 0);

  // 재추첨 풀에서 고착 어픽스의 def 를 뺀다 → 다른 슬롯에 다시 뽑히지 않는다(아이템 전체
  // 어픽스 중복 없음이 보존된다).
  const keptIds = new Set<string>(fastened.map((i) => (item.affixes[i] as AffixRoll).id));
  const pool: AffixDef[] = AFFIXES.filter((d) => !keptIds.has(d.id));
  const needed = count - fastened.length;
  const fresh: AffixRoll[] = [];
  const n = needed < pool.length ? needed : pool.length;
  for (let k = 0; k < n; k++) {
    const j = rng.int(0, pool.length - 1);
    const def = pool[j];
    pool.splice(j, 1);
    if (def === undefined) continue;
    // 값 추첨은 밴드 유무와 무관하게 int() 1회 — 스트림 형태 불변.
    const lo = def.min + Math.round((def.max - def.min) * band);
    const value = rng.int(lo, def.max);
    fresh.push({ id: def.id, stat: def.stat, value });
  }

  // 재조립: 고착 어픽스는 제자리에 두고, 나머지를 순서대로 채운다.
  const isFastened = new Set<number>(fastened);
  const out: AffixRoll[] = new Array<AffixRoll>(count);
  let f = 0;
  for (let i = 0; i < count; i++) {
    if (isFastened.has(i)) {
      out[i] = item.affixes[i] as AffixRoll;
    } else {
      const r = fresh[f++];
      // 풀이 필요한 수보다 작은 경우(어픽스 테이블이 고갈된 경우에만): 구멍을 남기지 말고
      // 이 슬롯의 원래 어픽스로 되돌린다.
      out[i] = r ?? (item.affixes[i] as AffixRoll);
    }
  }
  return { ...item, affixes: out };
}

/**
 * Reforge an item's affixes at the refinery (M3 Phase A4 — plan §4, AC3). PURE in
 * (`item`'s affix shape, `rerollSeed`, `lockedIndex`): a local RNG seeded from
 * `rerollSeed` redraws every affix EXCEPT the one at `lockedIndex`. The locked affix
 * is preserved in place and excluded from the redraw pool so it is never duplicated.
 * The affix COUNT is preserved (a reroll reforges, it does not add/remove slots).
 *
 * ADR-0040 이후 이 함수는 {@link reforgeAffixes} 의 **얇은 위임**이다(단일 고착 · 밴드 0).
 * 시그니처·동작은 그대로 유지된다 — deno-verify 시나리오와 `tests/reroll.test.ts` 의 기존
 * 케이스가 회귀 기준선이다.
 */
export function rerollAffixes(item: Item, rerollSeed: number, lockedIndex?: number): Item {
  return reforgeAffixes(
    item,
    rerollSeed,
    lockedIndex === undefined ? undefined : { fastened: [lockedIndex] },
  );
}
