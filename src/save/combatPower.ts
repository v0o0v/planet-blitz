/**
 * 전투력 점수 산식 (M5 — plan §5 "전투력 점수 산식", C2 정산 표시).
 *
 * 장비의 등급 가치와 어픽스 개수를 종합한 정수 점수. 정산 화면(C2)이 이번 런의 획득
 * 전투력을 보여주는 데 쓰이고, M5 Phase A 에서 수호 기체 스냅샷 전투력·소멸 포인트
 * 산정의 공통 기반으로 재사용된다(그래서 단일 사용 헬퍼가 아니라 별도 모듈).
 *
 * 순수 함수 — RNG/시간 무관, 같은 아이템 집합에 항상 같은 점수(결정론 재현 가능).
 * OQ-M5-2 기본안: 등급 가중 + 어픽스 깊이 합산(플레이테스트 튜닝 대상).
 */

import type { Item, Rarity } from '../items/types.js';

/** 등급별 기본 가치(노말→유니크). 상위 등급일수록 급증(디아블로2식 체감). */
const RARITY_WEIGHT: Record<Rarity, number> = {
  normal: 5,
  magic: 15,
  rare: 40,
  unique: 90,
};

/** 어픽스 1개당 가산 점수(레어의 다중 옵션 가치를 반영). */
const AFFIX_WEIGHT = 8;

/** 아이템 1개의 전투력 점수(등급 기본 + 어픽스 깊이). */
export function itemCombatPower(item: Item): number {
  return RARITY_WEIGHT[item.rarity] + item.affixes.length * AFFIX_WEIGHT;
}

/** 아이템 집합의 전투력 합계(정산 "획득 전투력"). 빈 배열이면 0. */
export function totalCombatPower(items: readonly Item[]): number {
  let sum = 0;
  for (const it of items) sum += itemCombatPower(it);
  return sum;
}
