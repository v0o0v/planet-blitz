/**
 * Run settlement (M2 Phase C2 — plan §4, AC3/AC5/AC11).
 *
 * When a run ends the sim hands back a plain result: the collected loot records
 * (drop seed + rarity + provenance), the total XP earned, the raid resources, and
 * the loadout's meta mods. `settleRun` turns that into durable profile changes:
 *
 *   - each `LootRecord` is confirmed into an `Item` via the pure `rollItem`
 *     (same seed → same item, so a server re-run reproduces the reward);
 *   - items fill the inventory, then the stash, then overflow (surfaced so the UI
 *     can nudge the player to make room — plan D2);
 *   - run XP is banked onto the active ship, leveling it along the `xpToNext`
 *     curve; each level grants one skill point (accrued only, spent in M3);
 *   - raid resources convert to credits.
 *
 * ADR-0003 / plan: collected loot is always preserved. On death the boss's
 * guaranteed drop was never collected (the boss is still alive, so the sim never
 * emitted it), so no stripping is needed here — the death path simply settles
 * whatever the pilot actually picked up.
 *
 * `salvageItems` implements bulk disenchant (plan D2): normal/magic → credits,
 * rare+ → minerals (scaled by the loadout's mineral-find mod).
 */

import { rollItem } from '../items/roll.js';
import { blueprintDropsFromLoot } from '../../data/planets/index.js';
import type { BlueprintGrant } from '../../data/planets/blueprints.js';
import { RARITY_BY_CODE } from '../items/types.js';
import type { Item } from '../items/types.js';
import type { LootRecord } from '../sim/world.js';
import { xpToNext } from '../sim/world.js';
import type { Profile, Ship } from './profile.js';
import { INVENTORY_CAP, activeShip, stashCapacity, recordPlanetClear } from './profile.js';

/** What the sim reports at run end (all plain numbers/records — no sim types). */
export interface RunResult {
  victory: boolean;
  /** Collected loot (finalState.loot). */
  loot: readonly LootRecord[];
  /** Total XP earned this run (finalState.xpTotal). */
  xpTotal: number;
  /** Raid resources earned (finalState.resources) → credits. */
  resources: number;
  /** Planet index the run took place on (records a clear on victory, plan E2). */
  planet?: number;
  /** 침략 단계 the run took place on (records a clear on victory, ADR-0022). */
  stage?: number;
}

/** Summary of what a run added to the profile (for the result overlay). */
export interface SettlementOutcome {
  itemsGained: Item[];
  levelsGained: number;
  skillPointsGained: number;
  creditsGained: number;
  /** Items that fit neither inventory nor stash (prompt the player to clear space). */
  overflow: number;
  /**
   * 이 런이 낸 방어체 설계도(M7b). **프로필에는 담지 않는다** — 설계도 보유량은 서버
   * (`defense_blueprints`)가 진실이라, 호출부가 이 목록을 `grantBlueprintDrops` 로 넘긴다.
   * 파생은 순수하고 RNG 를 소비하지 않는다(장비 확정과 **같은 드랍 시드**에서 되풀어 쓴다)
   * — 그래서 해시·fixture 가 그대로다(data/planets/blueprints.ts `rollBlueprintDrop` 계약).
   */
  blueprintsGained: BlueprintGrant[];
}

/**
 * Apply a finished run to the profile in place, returning a summary. Pure w.r.t.
 * RNG — item confirmation is fully determined by the drop seeds.
 */
export function settleRun(profile: Profile, result: RunResult): SettlementOutcome {
  // 1. Confirm every collected drop into a concrete item.
  const itemsGained: Item[] = [];
  for (const rec of result.loot) {
    const rarity = RARITY_BY_CODE[rec.rarity] ?? 'normal';
    itemsGained.push(rollItem(rec.seed, rarity, { planet: rec.planet, stage: rec.stage }));
  }

  // 2. Place items: inventory first, then stash, then overflow.
  const stashCap = stashCapacity(profile.stashExpansions);
  let overflow = 0;
  for (const it of itemsGained) {
    if (profile.inventory.length < INVENTORY_CAP) profile.inventory.push(it);
    else if (profile.stash.length < stashCap) profile.stash.push(it);
    else overflow++;
  }

  // 3. Bank XP onto the active ship, leveling along the xpToNext curve.
  const ship = activeShip(profile);
  const levelsGained = grantXp(ship, Math.max(0, Math.floor(result.xpTotal)));
  const skillPointsGained = levelsGained;
  profile.skillPoints += skillPointsGained;

  // 4. Resources → credits.
  const creditsGained = Math.max(0, Math.floor(result.resources));
  profile.credits += creditsGained;

  // 5. On victory, record the planet clear (drives 정제소 unlock + 단계 개방 상한, ADR-0022).
  //    승리한 단계가 실제로 기록돼야 개방이 진행된다(핵심 배선 — 누락 시 개방 영영 안 됨).
  if (result.victory && result.planet !== undefined && result.stage !== undefined) {
    recordPlanetClear(profile, result.planet, result.stage);
  }

  // 6. 설계도 파생(M7b) — 장비 확정과 같은 드랍 시드에서 되풀어 쓰는 순수 함수라 RNG 커서를
  //    건드리지 않는다. 지급(서버 RPC)은 호출부 몫이다(위 SettlementOutcome 주석 참조).
  const blueprintsGained = blueprintDropsFromLoot(result.loot);

  return {
    itemsGained,
    levelsGained,
    skillPointsGained,
    creditsGained,
    overflow,
    blueprintsGained,
  };
}

/** Add XP to a ship and resolve level-ups. Returns the number of levels gained. */
export function grantXp(ship: Ship, xp: number): number {
  ship.xp += xp;
  let levels = 0;
  // Consume banked XP up the curve. Terminates: xpToNext grows with level and xp
  // is finite, so the loop bound is xp / xpToNext(1).
  for (;;) {
    const need = xpToNext(ship.level);
    if (need <= 0 || ship.xp < need) break;
    ship.xp -= need;
    ship.level++;
    levels++;
  }
  return levels;
}

// ---------------------------------------------------------------------------
// Salvage / bulk disenchant (plan D2)
// ---------------------------------------------------------------------------

/** Credits/minerals yielded by salvaging item(s). */
export interface SalvageYield {
  credits: number;
  minerals: number;
}

/** Base salvage value per rarity (M2 first-pass tuning, spec §5). */
const SALVAGE_CREDITS: Record<string, number> = { normal: 2, magic: 5 };
const SALVAGE_MINERALS: Record<string, number> = { rare: 3, unique: 8 };

/**
 * Salvage value of a single item (pure). Normal/magic convert to credits; rare+
 * convert to minerals scaled by the loadout mineral-find mod (worldMods).
 */
export function salvageValue(item: Item, mineralFindMult = 1): SalvageYield {
  if (item.rarity === 'normal' || item.rarity === 'magic') {
    return { credits: SALVAGE_CREDITS[item.rarity] ?? 0, minerals: 0 };
  }
  const base = SALVAGE_MINERALS[item.rarity] ?? 0;
  return { credits: 0, minerals: Math.round(base * mineralFindMult) };
}

/**
 * Bulk-disenchant the given items: sum their yield, credit the profile, and
 * remove them from inventory + stash. Items not present in either list are still
 * counted toward the yield (caller is trusted to pass owned items).
 */
export function salvageItems(
  profile: Profile,
  items: readonly Item[],
  mineralFindMult = 1,
): SalvageYield {
  let credits = 0;
  let minerals = 0;
  // 참조 동일성이 아니라 item.id로 매칭한다: 정산에서 롤한 Item과 인벤토리에 보관된
  // Item이 서로 다른 객체 인스턴스여도(직렬화·복원 등) 동일 아이템으로 제거되도록.
  const removeIds = new Set(items.map((it) => it.id));
  for (const it of items) {
    const y = salvageValue(it, mineralFindMult);
    credits += y.credits;
    minerals += y.minerals;
  }
  profile.inventory = profile.inventory.filter((it) => !removeIds.has(it.id));
  profile.stash = profile.stash.filter((it) => !removeIds.has(it.id));
  profile.credits += credits;
  profile.minerals += minerals;
  return { credits, minerals };
}
