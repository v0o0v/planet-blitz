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
  /**
   * 행성 특산 설계도 테이블의 항목 수(M7b). 0/미지정이면 그 행성은 설계도를 떨구지 않는다.
   * **sim 은 테이블 내용을 모른다** — 개수만 받아 인덱스를 뽑고, 어떤 방어체인지는 메타
   * 레이어(data/planets/blueprints.ts)가 확정한다(현행 rarityCode 와 동일 철학).
   */
  readonly blueprintTableSize?: number;
  /**
   * 등급 코드별 설계도 동반 확률(centi-percent, 인덱스 = rarityCode 0..3).
   * 미지정이면 {@link DEFAULT_BLUEPRINT_CHANCE_CP}.
   */
  readonly blueprintChanceCp?: readonly number[];
}

/** 기본 드랍 확률(카르곤 = M1 기존 상수). 테이블 미지정 시 폴백. */
export const DEFAULT_DROP_ODDS: DropOdds = {
  eliteRareBase: 0.25,
  eliteUniqueBase: 0.03,
  bossUniqueBase: 0.15,
};

// ---------------------------------------------------------------------------
// 설계도 드랍 (M7b-acquisition) — RNG 미소비 순수 파생
// ---------------------------------------------------------------------------

/**
 * 등급 코드별 설계도 동반 확률(centi-percent). 인덱스 = rarityCode.
 *
 * normal·magic 은 0 이다 — 설계도는 **엘리트·보스 드랍 중심**(기획 §4)이고, 잡몹은 애초에
 * 젬만 떨군다. 엘리트/보스가 rare 이상을 뽑았을 때만 설계도가 따라붙는다.
 */
export const DEFAULT_BLUEPRINT_CHANCE_CP: readonly number[] = [0, 0, 600, 2500];

/**
 * 설계도 드랍 1건의 **불투명 코드**. sim 은 방어체 카탈로그를 몰라야 하므로 여기까지가
 * sim 의 책임이다 — 실제 종류·catalogId 확정은 메타 레이어가 행성 특산 테이블로 한다.
 */
export interface BlueprintDropCode {
  /** 행성 특산 테이블의 인덱스 [0, blueprintTableSize). */
  tableIndex: number;
  /** 파생 시드(uint32). 메타 레이어가 필요하면 추가 롤 입력으로 쓴다. */
  seed: number;
}

/** 정수 해시(murmur3 finalizer). 순수·결정론 — 부동소수 누적 없음. */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 판정 축별 salt — 세 축이 같은 시드에서 서로 독립적으로 갈리게 한다. */
const SALT_GATE = 0x9e3779b9;
const SALT_INDEX = 0x7f4a7c15;
const SALT_SEED = 0x2545f491;

/**
 * 이미 확정된 장비 드랍 1건에 설계도가 동반되는지 판정한다(순수).
 *
 * ## 왜 RNG 를 소비하지 않는가
 * `dropRng` 에서 한 번이라도 더 뽑으면 드랍 스트림 전체가 밀려 **모든 기존 fixture 와
 * 해시가 갈린다**. 그래서 이미 뽑아 둔 드랍 시드를 정수 해시로 되풀어 쓴다 — 새 결정론
 * 입력이 0 이므로 `hashWorld` 도 `LootRecord` 스키마도 한 바이트 변하지 않는다. 시드가
 * 이미 해시에 접혀 있으니 파생값을 따로 접을 필요도 없다(순수 함수 = 재확정 가능).
 *
 * 설계도가 없으면 null.
 */
export function rollBlueprintDrop(drop: DropRoll, odds: DropOdds = DEFAULT_DROP_ODDS): BlueprintDropCode | null {
  const size = odds.blueprintTableSize ?? 0;
  if (!Number.isInteger(size) || size <= 0) return null;
  const table = odds.blueprintChanceCp ?? DEFAULT_BLUEPRINT_CHANCE_CP;
  const chanceCp = table[drop.rarityCode] ?? 0;
  if (chanceCp <= 0) return null;
  const seed = drop.seed >>> 0;
  if (mix32(seed, SALT_GATE) % 10000 >= chanceCp) return null;
  return { tableIndex: mix32(seed, SALT_INDEX) % size, seed: mix32(seed, SALT_SEED) };
}

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
