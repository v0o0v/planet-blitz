/**
 * cards Edge Function 검증·계획 코어 (M6 방어 카드 경제 — 구매·합성·방어 성공 드랍).
 *
 * verifyInvasionCore 와 동일 규율: **플랫폼 전역 무참조 순수 모듈**이라 Node(vitest)·Deno(EF)
 * 어디서나 동일하게 돈다. 여기엔 결정론 카드 롤러(src/items/rollCard)를 그대로 실행하는 순수
 * "계획" 함수만 둔다 — 상점 슬롯 재현·가격 책정·합성 입력 검증·드랍 등급 판정. HTTP·Auth·DB
 * I/O(크레딧 차감·소유 검증·상한 강제·원자 적용 RPC 호출)는 index.ts 가 맡는다.
 *
 * 설계 근거(핸드오프 lane-c-server.md §Remaining, lane-a-cards-data.md):
 *   - 카드 생성은 반드시 공유 TS 롤러(rollCard·attemptFusion·rollShopRotation)를 써야 클라·서버가
 *     바이트 동일 재현된다(plpgsql 재구현 금지 — surface 과대·고위험). 이 코어가 롤 결과를 확정하고,
 *     index.ts 가 그 결과를 service_role 원자 RPC(apply_card_purchase·apply_card_fusion·
 *     apply_card_drop)로 적용한다(크레딧·상한·소유 검증은 전부 SQL 트랜잭션).
 *   - dateSeed(UTC 날짜)·userSeed(프로필 기반 안정값)는 클라·서버 동일 → 상점 로테이션 재현.
 */

import type { Rarity } from '../../../src/items/types.js';
import { rollCard, attemptFusion, rollShopRotation } from '../../../src/items/rollCard.js';
import {
  cardBuyPrice,
  defenseSuccessDropChance,
  rollDropRarity,
  FUSION_INPUT_COUNT,
} from '../../../data/defenseCards.js';
import type { CardInstance } from '../../../data/defenseCards.js';

// ---------------------------------------------------------------------------
// 상점 구매 계획
// ---------------------------------------------------------------------------

/** 구매 계획: 확정 카드 + 등급 + 크레딧 가격(롤러·가격 함수가 순수 확정). */
export interface ShopPurchasePlan {
  readonly rarity: Rarity;
  readonly card: CardInstance;
  readonly price: number;
}

export type ShopPurchaseResult =
  | { readonly ok: true; readonly plan: ShopPurchasePlan }
  | { readonly ok: false; readonly code: 'bad-slot' };

/**
 * (dateSeed, userSeed, slotIndex) → 상점 슬롯 카드 재현 + 가격. slotIndex 는 rollShopRotation 재고
 * 길이 내 정수여야 한다(범위 밖·비정수 = bad-slot). 서버가 클라 입력 dateSeed 를 신뢰하지 않고 자체
 * UTC 날짜로 계산한 값을 넘긴다(index.ts).
 */
export function planShopPurchase(
  dateSeed: number,
  userSeed: number,
  slotIndex: number,
): ShopPurchaseResult {
  const rotation = rollShopRotation(dateSeed, userSeed);
  if (
    !Number.isInteger(slotIndex) ||
    slotIndex < 0 ||
    slotIndex >= rotation.length
  ) {
    return { ok: false, code: 'bad-slot' };
  }
  const card = rotation[slotIndex];
  if (card === undefined) return { ok: false, code: 'bad-slot' };
  return { ok: true, plan: { rarity: card.rarity, card, price: cardBuyPrice(card.rarity) } };
}

// ---------------------------------------------------------------------------
// 합성 입력 검증 + 결과 계획
// ---------------------------------------------------------------------------

export type FusionValidation =
  | { readonly ok: true; readonly rarity: Rarity }
  | { readonly ok: false; readonly code: 'need-three' | 'dup-ids' | 'rarity-mismatch' };

/**
 * 합성 입력(정확히 3장, 동급, 중복 id 없음) 검증. 소유·잔존 검증은 원자 RPC(apply_card_fusion)가
 * 행 잠금으로 재확인하므로, 이 순수 검증은 롤러 입력(공통 등급) 확정과 형식 게이트를 담당한다.
 */
export function validateFusion(
  cards: ReadonlyArray<{ readonly id: string; readonly rarity: Rarity }>,
): FusionValidation {
  if (cards.length !== FUSION_INPUT_COUNT) return { ok: false, code: 'need-three' };
  const ids = new Set(cards.map((c) => c.id));
  if (ids.size !== FUSION_INPUT_COUNT) return { ok: false, code: 'dup-ids' };
  const rarity = cards[0]?.rarity;
  if (rarity === undefined) return { ok: false, code: 'need-three' };
  if (!cards.every((c) => c.rarity === rarity)) return { ok: false, code: 'rarity-mismatch' };
  return { ok: true, rarity };
}

/** 합성 결과 계획(승급 여부 + 결과 카드). attemptFusion 을 그대로 실행. seed 는 EF 가 발급(비결정론 OK). */
export interface FusionPlan {
  readonly promoted: boolean;
  readonly rarity: Rarity;
  readonly card: CardInstance;
}

export function planFusion(inputRarity: Rarity, seed: number): FusionPlan {
  const res = attemptFusion(seed, inputRarity);
  return { promoted: res.promoted, rarity: res.card.rarity, card: res.card };
}

// ---------------------------------------------------------------------------
// 방어 성공 드랍 계획
// ---------------------------------------------------------------------------

/** 드랍 계획 입력(모든 무작위는 EF 가 crypto 로 공급 — 드랍은 리플레이 대상 아님, 결정론 불요). */
export interface DropRollInput {
  /** 기본 드랍 확률(DEFENSE_DROP_BASE_CHANCE). */
  readonly base: number;
  /** 공격자 전투력 점수(매치업, 미상 0). */
  readonly attackerCp: number;
  /** 방어자 전투력 점수(매치업, 미상 0). */
  readonly defenderCp: number;
  /** 드랍 성공 판정용 [0,1) roll. */
  readonly dropRoll: number;
  /** 등급 판정용 [0,1) roll. */
  readonly rarityRoll: number;
  /** 결과 카드 롤 시드(u32). */
  readonly seed: number;
}

export type DropPlan =
  | { readonly dropped: true; readonly rarity: Rarity; readonly card: CardInstance }
  | { readonly dropped: false };

/**
 * 방어 성공 드랍을 계획한다: defenseSuccessDropChance(전투력 우위로 상승)로 드랍 여부 판정 → 성공 시
 * rollDropRarity(rare 중심 + unique 극저)로 등급 → rollCard 로 카드 확정. 순수 함수(무작위 입력은 인자).
 */
export function planDefenseDrop(input: DropRollInput): DropPlan {
  const chance = defenseSuccessDropChance(input.base, input.attackerCp, input.defenderCp);
  if (input.dropRoll >= chance) return { dropped: false };
  const rarity = rollDropRarity(input.rarityRoll);
  return { dropped: true, rarity, card: rollCard(input.seed, rarity) };
}
