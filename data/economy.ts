/**
 * 경제 비용 공식 — 정련 공정(정제소)·연구소 리스펙·창고 확장의 메타 재화 소비(GDD §9).
 *
 * data/lineage.ts(nextLevelCost)와 같은 결에서, 이 모듈은 **순수 결정론 정수/실수 함수**의
 * 모음이다(무작위·시계·pixi 없음). 굴림의 성패 판정에 쓰는 난수는 이 모듈이 만들지 않고
 * 호출부가 주입한다 — `meltRisk` 는 "확률"만 돌려주고 주사위는 굴리지 않는다.
 * 메타 계층(기지 화면)에서만 소비되며 sim/리플레이에는 관여하지 않는다 — 서버·클라이언트가
 * 동일 곡선을 재현해 UI 표기·검증을 일치시킨다.
 *
 * 밸런스 앵커(체감 변화 최소화): 각 공식의 기준점은 공식화 이전 하드코딩 값이다.
 *   - 리롤 기본 = 광물 12(구 REFINERY_REROLL_COST) → 매직·어픽스 1개일 때.
 *   - 노 출력 `mid` = 현행 단발 리롤과 동일 비용(×1) — 정련 공정 전환의 체감 앵커.
 *   - 리스펙 = 기체 레벨 × 100 크레딧(구 RESPEC_COST_PER_LEVEL).
 *   - 창고 확장 = 1회차 1000 · 2회차 4000 · 3회차 9000 · 4회차 16000 크레딧(제곱 곡선).
 *     상한은 `MAX_STASH_EXPANSIONS`(4회) — 전부 사면 누적 30000 크레딧이 빠진다.
 *
 * 재화 싱크 설계(GDD §9): 굴림은 무한 싱크(등급·어픽스 수↑ → 비용↑), 리스펙은 주기 싱크
 * (레벨↑ → 비용↑ — 만렙에서 교정이 신중해지도록), 창고는 유한 싱크(회차 한정 · 제곱 곡선).
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
// 어픽스 리롤 비용(광물)
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

/**
 * 굴림 기본 비용(광물). 등급·어픽스 수에 단조 증가.
 * 등급↑(동일 어픽스 수) → 비용↑, 어픽스↑(동일 등급) → 비용↑.
 * 노 출력 배수를 곱하기 전의 기준값이다(→ `rollCost`).
 */
export function rerollBaseCost(rarity: Rarity, affixCount: number): number {
  const rank = RARITY_CODE[rarity];
  const affixes = nonNegInt(affixCount);
  return REROLL_BASE + REROLL_PER_RARITY * rank + REROLL_PER_AFFIX * affixes;
}

// ---------------------------------------------------------------------------
// 정련 공정 — 노 출력(heat)과 용해 위험(ADR-0040)
// ---------------------------------------------------------------------------

/**
 * 노 출력 3단계 — 약불·중불·강불.
 *
 * 구 "잠금 리롤 ×3"(LOCKED_REROLL_MULT)을 대체한다. 잠금은 비용만 올리는 단일 축이었지만,
 * 정련 공정은 **밀어붙이기(push-your-luck)** 이므로 축이 셋이다: 비용 · 위험 · 값 품질 밴드.
 */
export type Heat = 'low' | 'mid' | 'high';
export const HEATS: readonly Heat[] = ['low', 'mid', 'high'];

export interface HeatSpec {
  /** 광물 비용 배수. */
  readonly costMult: number;
  /** 실패(용해) 위험 배수. */
  readonly riskMult: number;
  /** 어픽스 값 품질 밴드 하한 [0,1]. */
  readonly band: number;
}

/**
 * 노 출력 계수 테이블.
 *
 * **세 축이 한 상수 테이블에 모여 있는 것이 설계 계약이다.** 비용·위험·밴드는 따로 튜닝할 수
 * 있는 독립 손잡이가 아니라 "한 몸으로 움직이는" 하나의 선택지다 — 플레이어가 고르는 것은
 * `low|mid|high` 라는 **한 개의 값**이고, 그 값이 지불(비용)·각오(위험)·보상(밴드)을 동시에
 * 정한다. 세 축을 파일 여러 곳에 흩으면 "비싼데 밴드는 그대로"처럼 선택지가 지배당하는
 * (dominated) 조합이 조용히 생겨 공정 전체가 무의미해진다. 한 행을 보면 그 등급의 거래 조건이
 * 전부 보이도록 유지한다.
 *
 * 단조 규약: costMult · riskMult · band 는 low < mid < high 로 **셋 다 단조 증가**해야 한다
 * (tests/economy.test.ts 가 잠근다). 이 단조성이 깨지면 지배당하는 선택지가 생긴다.
 *
 * TODO(밸런스): 출시 전 일괄 튜닝. 앵커 = mid 가 현행 단발 리롤과 동일 비용(×1).
 */
export const HEAT: Record<Heat, HeatSpec> = {
  low: { costMult: 0.6, riskMult: 0.6, band: 0 },
  mid: { costMult: 1, riskMult: 1, band: 0.25 },
  high: { costMult: 2, riskMult: 1.8, band: 0.55 },
};

/** baseRisk 상한 — 고착을 전부 채우기 직전에도 남는 성공 여지. TODO(밸런스): 출시 전 일괄 튜닝. */
export const RISK_CAP = 0.85;
/** 진행 비율(고착/어픽스) 지수. >1 이면 초반이 완만하고 막바지에 가파르다. TODO(밸런스): 출시 전 일괄 튜닝. */
export const RISK_EXP = 1.5;
/** 노 출력 배수까지 적용한 뒤의 최종 상한 — 강불에서도 확정 실패는 없다. TODO(밸런스): 출시 전 일괄 튜닝. */
export const RISK_MAX = 0.95;

/**
 * 고착 누적이 정하는 기본 용해 위험 [0,1].
 *
 * 고착 0 → **정확히 0**. 하위 호환이 이 한 줄에 걸려 있다 — 아무것도 고착하지 않은 굴림은
 * 구 단발 리롤과 동일하게 절대 실패하지 않는다.
 */
export function baseRisk(fastenedCount: number, affixCount: number): number {
  const n = nonNegInt(fastenedCount);
  const count = nonNegInt(affixCount);
  if (n <= 0 || count <= 0) return 0;
  const ratio = n >= count ? 1 : n / count;
  return RISK_CAP * Math.pow(ratio, RISK_EXP);
}

/**
 * 실제 용해 위험 [0,1] = `baseRisk` × `HEAT[heat].riskMult`, `RISK_MAX` 로 클램프.
 * 고착 0 이면 배수와 무관하게 **정확히 0**(0 × 무엇이든 0).
 */
export function meltRisk(fastenedCount: number, affixCount: number, heat: Heat): number {
  const risk = baseRisk(fastenedCount, affixCount) * HEAT[heat].riskMult;
  return risk > RISK_MAX ? RISK_MAX : risk;
}

/**
 * 굴림 1회 비용(광물, 정수) = `rerollBaseCost` × `HEAT[heat].costMult`, 올림.
 * 올림이라 배수가 소수여도 결정론 정수가 유지된다.
 */
export function rollCost(rarity: Rarity, affixCount: number, heat: Heat): number {
  return Math.ceil(rerollBaseCost(rarity, affixCount) * HEAT[heat].costMult);
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

/** 창고 확장 1회차 기준 비용(크레딧). 구 값 200 → 1000 상향(후반 크레딧 싱크 강화). */
export const STASH_EXPANSION_BASE = 1000;

/**
 * 다음 창고 확장 비용(크레딧) = BASE × (회차)². 1회차 1000 · 2회차 4000 · 3회차 9000 ·
 * 4회차 16000.
 *
 * 선형(BASE×회차)에서 **제곱**으로 바꾼 이유: 창고는 상한(`MAX_STASH_EXPANSIONS`)이 있는 유한
 * 싱크라, 선형이면 마지막 회차도 초반 크레딧으로 바로 살 수 있어 "확장은 그냥 사면 되는 것"이
 * 된다. 제곱은 회차마다 증가폭 자체가 커져(+3000 → +5000 → +7000) 마지막 확장이 후반 목표가
 * 된다. 정수 제곱이라 결정론이 그대로 유지된다(무작위·시계 없음).
 *
 * currentExpansions = 이미 구매한 확장 수(다음 구매는 그 다음 회차).
 */
export function stashExpansionCost(currentExpansions: number): number {
  const n = nonNegInt(currentExpansions) + 1;
  return STASH_EXPANSION_BASE * n * n;
}
