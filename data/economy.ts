/**
 * 경제 비용 공식 — 정제소 리롤·연구소 리스펙·창고 확장의 메타 재화 소비(GDD §9).
 *
 * data/lineage.ts(nextLevelCost)와 같은 결에서, 이 모듈은 **순수 결정론 정수 함수**의
 * 모음이다(무작위·시계·pixi 없음). 메타 계층(기지 화면)에서만 소비되며 sim/리플레이에는
 * 관여하지 않는다 — 서버·클라이언트가 동일 곡선을 재현해 UI 표기·검증을 일치시킨다.
 *
 * 밸런스 앵커(체감 변화 최소화): 각 공식의 기준점은 공식화 이전 하드코딩 값이다.
 *   - 리롤 기본 = 광물 12(구 REFINERY_REROLL_COST) → 매직·어픽스 1개일 때.
 *   - 잠금 리롤 = 기본 ×3(GDD §9 "잠금 시 비용 3배").
 *   - 리스펙 = 기체 레벨 × 100 크레딧(구 RESPEC_COST_PER_LEVEL).
 *   - 창고 확장 1회차 = 200 크레딧(구 STASH_EXPANSION_COST). 2회차부터 회차 비례 증가.
 *
 * 재화 싱크 설계(GDD §9): 리롤은 무한 싱크(등급·어픽스 수↑ → 비용↑), 리스펙은 주기 싱크
 * (레벨↑ → 비용↑ — 만렙에서 교정이 신중해지도록), 창고는 유한 싱크(2회 한정·회차 비례).
 */

import type { Rarity } from '../src/items/types.js';
import { RARITY_CODE } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// 공통 유틸
// ---------------------------------------------------------------------------

/** 음수·소수 방어: 0 이상 정수로 정규화. */
function nonNegInt(n: number): number {
  return n < 0 ? 0 : Math.trunc(n);
}

/** 잔고가 비용을 감당하는가(정수 비교). 재화 부족 시 소비처가 실행을 거부하는 게이트. */
export function canAfford(balance: number, cost: number): boolean {
  return Math.trunc(balance) >= Math.trunc(cost);
}

// ---------------------------------------------------------------------------
// 어픽스 리롤 비용(희귀 광물)
// ---------------------------------------------------------------------------

/**
 * 리롤 기본 비용 상수. 비용 = BASE + PER_RARITY×등급랭크 + PER_AFFIX×어픽스수.
 * 등급랭크는 RARITY_CODE(normal 0 · magic 1 · rare 2 · unique 3)를 그대로 쓴다.
 * 앵커: magic(랭크1)·어픽스 1개 → 6 + 4 + 2 = 12(구 하드코딩 값과 동일).
 */
export const REROLL_BASE = 6;
/** 등급 1단계당 추가 광물(레어가 매직보다 비싸지도록 — 좋은 베이스일수록 리롤 부담↑). */
export const REROLL_PER_RARITY = 4;
/** 어픽스 1개당 추가 광물(굴릴 슬롯이 많을수록 비용↑). */
export const REROLL_PER_AFFIX = 2;
/** 잠금 리롤 배수(GDD §9): 잠금 1개 = 기본 ×3. 잠금 수에 비례해 가중. */
export const LOCKED_REROLL_MULT = 3;

/**
 * 잠금 없는 리롤 기본 비용(광물). 등급·어픽스 수에 단조 증가.
 * 등급↑(동일 어픽스 수) → 비용↑, 어픽스↑(동일 등급) → 비용↑.
 */
export function rerollBaseCost(rarity: Rarity, affixCount: number): number {
  const rank = RARITY_CODE[rarity];
  const affixes = nonNegInt(affixCount);
  return REROLL_BASE + REROLL_PER_RARITY * rank + REROLL_PER_AFFIX * affixes;
}

/**
 * 잠금 수 → 비용 배수. 잠금 0 → ×1(일반 리롤), 잠금 n(≥1) → ×(3n)
 * (GDD §9: 잠금 1개 = ×3, 잠금 수에 비례). 현 정제소 UI는 1개 잠금이지만
 * 다중 잠금 확장에 대비해 일반화한다.
 */
export function lockMultiplier(lockCount: number): number {
  const locks = nonNegInt(lockCount);
  return locks === 0 ? 1 : LOCKED_REROLL_MULT * locks;
}

/**
 * 실제 리롤 비용(광물) = 기본 비용 × 잠금 배수. 결정론 정수.
 * lockCount 미지정(0) → 일반 리롤, ≥1 → 잠금 리롤.
 */
export function rerollCost(rarity: Rarity, affixCount: number, lockCount = 0): number {
  return rerollBaseCost(rarity, affixCount) * lockMultiplier(lockCount);
}

// ---------------------------------------------------------------------------
// 리스펙 비용(크레딧)
// ---------------------------------------------------------------------------

/** 리스펙 크레딧 계수: 기체 레벨 1당 크레딧. 앵커: 구 RESPEC_COST_PER_LEVEL = 100. */
export const RESPEC_CREDITS_PER_LEVEL = 100;

/**
 * 스킬 트리 리스펙 비용(크레딧) = 기체 레벨 × 계수. 레벨에 단조 증가
 * (GDD §9 "레벨 비례" — 만렙일수록 교정이 신중해지도록). 레벨 0 → 0(경계).
 */
export function respecCostCredits(shipLevel: number): number {
  return nonNegInt(shipLevel) * RESPEC_CREDITS_PER_LEVEL;
}

// ---------------------------------------------------------------------------
// 창고 확장 비용(크레딧)
// ---------------------------------------------------------------------------

/** 창고 확장 1회차 기준 비용(크레딧). 앵커: 구 STASH_EXPANSION_COST = 200. */
export const STASH_EXPANSION_BASE = 200;

/**
 * 다음 창고 확장 비용(크레딧). 회차 비례 증가(1회차 200, 2회차 400, …)로
 * 유한 싱크를 회차마다 무겁게 한다(GDD §9 "크레딧으로 2회 확장").
 * currentExpansions = 이미 구매한 확장 수(다음 구매는 그 다음 회차).
 */
export function stashExpansionCost(currentExpansions: number): number {
  return STASH_EXPANSION_BASE * (nonNegInt(currentExpansions) + 1);
}
