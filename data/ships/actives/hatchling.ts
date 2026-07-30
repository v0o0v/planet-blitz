/**
 * hatchling 액티브 스킬 6종 (ADR-0041).
 *
 * PLACEHOLDER_BALANCE — 계수·쿨다운은 **하네스 육안 확인이 가능한 과장값**이다.
 * 실제 수치는 출시 전 일괄 밸런스 패스에서 확정한다(ADR-0041 보류 항목).
 * 이 문구가 grep 으로 0건이 되어야 밸런스 패스 완료로 인정한다.
 *
 * 순서 = 그 기체 안의 indexInShip(0..5) = wire 정수의 축. **재정렬 금지**.
 */

import type { ActiveSkillDef } from './types.js';

/** 기체 타입 4(hatchling)의 액티브 6종. */
export const HATCHLING_ACTIVES = [] as const satisfies readonly ActiveSkillDef[];
