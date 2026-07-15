/**
 * Drop determination (M2 plan B3, GDD §3).
 *
 * Elites and the boss are the only sources of floor loot (rank-and-file enemies
 * drop gems only). The sim emits a DROP SEED (u32) + rarity code; `rollItem`
 * confirms the item later (ADR-0005, plan §2 ①A). All rarity/seed choices are
 * drawn from `state.dropRng` (`rng.fork('drops')`) so the drop stream is a pure
 * function of the seed and independent of other subsystems.
 *
 * Rarity codes match src/items/types.ts RARITY_CODE (0 normal .. 3 unique). They
 * are duplicated here as plain numbers to keep the sim core free of any runtime
 * dependency on the item layer.
 */

import type { SeededRng } from './rng.js';
import type { AnomalyState } from './anomaly.js';
import { dropRateMult, uniqueChanceMult } from './anomaly.js';

export const RARITY_MAGIC = 1;
export const RARITY_RARE = 2;
export const RARITY_UNIQUE = 3;

/** A confirmed drop: the seed the item is rolled from + its rarity code. */
export interface DropRoll {
  seed: number;
  rarityCode: number;
}

/**
 * Planet×tier rarity 기준 확률(data/planets/index.ts PlanetDropTable와 동형). sim
 * 코어가 item 레이어에 런타임 의존하지 않도록 여기서 최소 형태만 정의한다.
 */
export interface DropOdds {
  readonly eliteRareBase: number;
  readonly eliteUniqueBase: number;
  readonly bossUniqueBase: number;
}

/** 기본 드랍 확률(카르곤 = M1 기존 상수). 테이블 미지정 시 폴백. */
export const DEFAULT_DROP_ODDS: DropOdds = {
  eliteRareBase: 0.25,
  eliteUniqueBase: 0.03,
  bossUniqueBase: 0.15,
};

// Engagement tier (1) upgrade multipliers on rare/unique odds.
const ENGAGE_RARE_MULT = 1.6;
const ENGAGE_UNIQUE_MULT = 1.5;

/**
 * Roll an elite's drop (always drops — elites yield equipment, GDD §3). Draws the
 * rarity tier first, then the seed, so the sequence is fixed per RNG position.
 * `odds`(행성 드랍 테이블) 미지정 시 카르곤 기본값을 쓴다(하위 호환).
 */
export function rollEliteDrop(
  dropRng: SeededRng,
  tier: number,
  anomaly: AnomalyState,
  odds: DropOdds = DEFAULT_DROP_ODDS,
): DropRoll {
  const boost = dropRateMult(anomaly); // 중력 폭풍: better rarity odds
  const tierRareMult = tier >= 1 ? ENGAGE_RARE_MULT : 1;
  const tierUniqueMult = tier >= 1 ? ENGAGE_UNIQUE_MULT : 1;
  const uniqueChance = odds.eliteUniqueBase * tierUniqueMult * boost * uniqueChanceMult(anomaly);
  const rareChance = odds.eliteRareBase * tierRareMult * boost;
  const r = dropRng.nextFloat();
  const seed = dropRng.nextU32();
  let rarityCode = RARITY_MAGIC;
  if (r < uniqueChance) rarityCode = RARITY_UNIQUE;
  else if (r < uniqueChance + rareChance) rarityCode = RARITY_RARE;
  return { seed, rarityCode };
}

/**
 * Roll the boss's guaranteed drop: always rare, occasionally unique. Elevated
 * unique odds vs elites; engagement tier and 암흑 성운 push them higher still.
 */
export function rollBossDrop(
  dropRng: SeededRng,
  tier: number,
  anomaly: AnomalyState,
  odds: DropOdds = DEFAULT_DROP_ODDS,
): DropRoll {
  const tierUniqueMult = tier >= 1 ? ENGAGE_UNIQUE_MULT : 1;
  const uniqueChance = odds.bossUniqueBase * tierUniqueMult * uniqueChanceMult(anomaly);
  const r = dropRng.nextFloat();
  const seed = dropRng.nextU32();
  const rarityCode = r < uniqueChance ? RARITY_UNIQUE : RARITY_RARE;
  return { seed, rarityCode };
}
