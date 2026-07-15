/**
 * M2 유니크 5점 정의 + 레지스트리 등록 (plan F1, §8 OQ-M2-6 확정 표).
 *
 * 배분 원칙: 주무기 3타입 대표 각 1(발칸·스프레드·레일건) + 보조무기 1 + 범용·장갑 1.
 * 각 UniqueDef는 슬롯과 uniqueMask 비트(src/sim/uniques.ts와 일치)를 지정한다.
 * rollItem이 rarity=unique + 해당 슬롯일 때 이 목록에서 하나를 뽑고, 장착 시
 * computeLoadoutStats가 bit을 uniqueMask에 OR → 시뮬이 mask로 고유 거동을 게이트.
 *
 * 이 모듈은 import 즉시(side-effect) 5점을 registerUnique한다. 아이템 레이어
 * (loadout.ts·roll.ts)가 이 모듈을 import해 레지스트리를 채운다 — 시뮬 코어는
 * 레지스트리를 만지지 않는다(precomputed uniqueMask만 읽음).
 */

import { registerUnique } from '../src/items/uniques.js';
import type { UniqueDef } from '../src/items/uniques.js';
import {
  UQ_OVERHEAT_DRUM,
  UQ_SPLIT_CORE,
  UQ_PIERCE_GYRO,
  UQ_DRONE_BAY,
  UQ_PHASE_ARMOR,
} from '../src/sim/uniques.js';

/** M2 유니크 5점(이름은 조정 가능, 효과 골자·슬롯·비트는 고정). */
export const M2_UNIQUES: readonly UniqueDef[] = [
  { id: 'overheat-drum', name: '과열 드럼', slot: 'main', bit: UQ_OVERHEAT_DRUM },
  { id: 'split-core', name: '분열 코어', slot: 'main', bit: UQ_SPLIT_CORE },
  { id: 'pierce-gyro', name: '관통 자이로', slot: 'main', bit: UQ_PIERCE_GYRO },
  { id: 'drone-bay', name: '자율 드론 베이', slot: 'sub', bit: UQ_DRONE_BAY },
  { id: 'phase-armor', name: '위상 장갑', slot: 'armor', bit: UQ_PHASE_ARMOR },
];

/** 5점을 레지스트리에 등록(idempotent by id). */
export function registerM2Uniques(): void {
  for (const def of M2_UNIQUES) registerUnique(def);
}

// side-effect: import 즉시 등록.
registerM2Uniques();
