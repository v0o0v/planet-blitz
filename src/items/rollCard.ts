/**
 * 결정론 방어 카드 롤러 (grill-defense-card 스펙 §롤링, team-plan Lane A).
 *
 * `rollCard(seed, rarity)` 는 PURE 함수다: 시드로 로컬 SeededRng 를 시딩하고 모든 선택(어픽스 수,
 * 어느 어픽스, 각 값, 사용 횟수, 유니크 id)을 그 스트림에서 뽑는다. 같은 입력 → 바이트 동일 카드,
 * 클라이언트와 검증 EF(Deno) 에서 동일(ADR-0005). rollItem(src/items/roll.ts)과 같은 규율:
 * Math.random·Date.now·벽시계 금지, 무작위는 전부 시드 RNG 를 통한다.
 *
 * 카드 어픽스 수(스펙 §카드 해부): normal 0(기저만) / magic 1~2 / rare 3~6 / unique 고정
 * (CARD_UNIQUE_AFFIX_COUNT). 어픽스는 접두(정적 카운터)/접미(동적 트리거) 풀 합집합에서 중복 없이
 * 뽑아 kind 로 분류한다 — rollItem 의 distinct 추첨과 동일.
 */

import { SeededRng } from '../sim/rng.js';
import type { Rarity } from './types.js';
import {
  CARD_PREFIXES,
  CARD_SUFFIXES,
  DEFENSE_CARD_UNIQUES,
  CARD_CHARGE_RANGE,
  CARD_UNIQUE_AFFIX_COUNT,
  FUSION_CHANCE,
  nextRarityUp,
  dailyShopRotation,
} from '../../data/defenseCards.js';
import type { CardAffixDef, CardAffixRoll, CardInstance } from '../../data/defenseCards.js';

/**
 * 등급별 카드 어픽스 수. magic/rare 는 rng 에서 뽑고, normal 은 0(무추첨), unique 는 고정 상수
 * (무추첨). rollItem 의 affixCountFor 준용.
 */
function cardAffixCountFor(rarity: Rarity, rng: SeededRng): number {
  switch (rarity) {
    case 'normal':
      return 0;
    case 'magic':
      return rng.int(1, 2);
    case 'rare':
      return rng.int(3, 6);
    case 'unique':
      return CARD_UNIQUE_AFFIX_COUNT;
  }
}

/**
 * 접두+접미 합집합 풀에서 `count` 개를 중복 없이 뽑아 값을 롤하고, kind 로 접두/접미에 분류한다.
 * 무교체 추첨(작업 복사본에서 splice)이라 같은 시드는 항상 같은 어픽스 집합·순서를 낸다.
 */
function rollCardAffixes(
  rng: SeededRng,
  count: number,
): { prefixes: CardAffixRoll[]; suffixes: CardAffixRoll[] } {
  const pool: CardAffixDef[] = [...CARD_PREFIXES, ...CARD_SUFFIXES];
  const prefixes: CardAffixRoll[] = [];
  const suffixes: CardAffixRoll[] = [];
  const n = count < pool.length ? count : pool.length;
  for (let k = 0; k < n; k++) {
    const j = rng.int(0, pool.length - 1);
    const def = pool[j];
    pool.splice(j, 1);
    if (def === undefined) continue;
    const value = rng.int(def.min, def.max);
    const roll: CardAffixRoll = { id: def.id, stat: def.stat, value };
    if (def.kind === 'prefix') prefixes.push(roll);
    else suffixes.push(roll);
  }
  return { prefixes, suffixes };
}

/**
 * 카드 하나를 확정한다. (`seed`, `rarity`) 에 결정론적. 드로우 순서(정본): 어픽스 수 → 어픽스 →
 * 사용 횟수 → (unique 면) 유니크 id. 순서를 바꾸면 스트림이 밀리므로 유지한다.
 */
export function rollCard(seed: number, rarity: Rarity): CardInstance {
  const s = seed >>> 0;
  const rng = new SeededRng(s);

  const { prefixes, suffixes } = rollCardAffixes(rng, cardAffixCountFor(rarity, rng));

  const [lo, hi] = CARD_CHARGE_RANGE[rarity];
  const chargesMax = rng.int(lo, hi);

  let uniqueId: string | undefined;
  if (rarity === 'unique') {
    const idx = rng.int(0, Math.max(0, DEFENSE_CARD_UNIQUES.length - 1));
    uniqueId = DEFENSE_CARD_UNIQUES[idx]?.id;
  }

  // exactOptionalPropertyTypes: undefined 를 optional 필드에 대입하지 않도록 조건부 스프레드.
  return {
    id: `card-${s}`,
    rarity,
    prefixes,
    suffixes,
    chargesMax,
    chargesLeft: chargesMax,
    seed: s,
    ...(uniqueId !== undefined ? { uniqueId } : {}),
  };
}

/** 합성 판정 결과: 승급 여부 + 결과 카드(성공=상위 등급, 실패=동급 새 카드). */
export interface FusionResult {
  /** 상위 등급으로 승급했는가. */
  readonly promoted: boolean;
  /** 결과 카드(3장 소모 후 반환되는 1장). */
  readonly card: CardInstance;
}

/**
 * 합성 판정(스펙 R8): 같은 등급 3장 소모 → 상위 등급 승급 확률 판정. 실패해도 동급 새 카드 1장
 * 반환(순소실 없음 — 새 옵션·새 횟수 롤이 사실상 리롤). unique 는 상위가 없어 항상 "실패"(동급 유니크
 * 재롤). 결정론: (`seed`, `rarity`) 고정 → 동일 결과.
 *
 * 드로우 순서: 승급 판정(nextFloat) → 결과 카드 시드(nextU32). 결과 카드는 그 파생 시드로 rollCard.
 */
export function attemptFusion(seed: number, rarity: Rarity): FusionResult {
  const rng = new SeededRng(seed >>> 0);
  const up = nextRarityUp(rarity);
  const chance = up !== undefined ? (FUSION_CHANCE[rarity] ?? 0) : 0;
  const promoted = rng.nextFloat() < chance;
  const resultRarity = promoted && up !== undefined ? up : rarity;
  const cardSeed = rng.nextU32();
  return { promoted, card: rollCard(cardSeed, resultRarity) };
}

/**
 * 일일 상점 로테이션을 실제 카드로 롤한다. dailyShopRotation(데이터 계층, 순수 계획) 이 낸 등급+시드
 * 슬롯을 rollCard 로 확정한다. 같은 (dateSeed,userSeed) → 동일 재고 카드(결정론). normal·magic 만.
 */
export function rollShopRotation(dateSeed: number, userSeed: number): CardInstance[] {
  return dailyShopRotation(dateSeed, userSeed).map((slot) => rollCard(slot.seed, slot.rarity));
}
