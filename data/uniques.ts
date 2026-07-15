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
  UQ_HIVE_SWARM,
  UQ_CONVERGE_PRISM,
  UQ_TWIN_STAR,
  UQ_SINGULARITY,
  UQ_REACTIVE_ARMOR,
  UQ_PHASE_MEMBRANE,
  UQ_AFTERIMAGE,
  UQ_GREED_HEART,
  UQ_GAMBLER_CHIP,
  UQ_RELIC_AMP,
} from '../src/sim/uniques.js';

/**
 * M2 유니크 5점(이름은 조정 가능, 효과 골자·슬롯·비트는 고정).
 * 주무기 파생은 weaponType으로 페어링(리뷰 MED-1): 과열 드럼=발칸(0)·분열 코어=스프레드(1)·
 * 관통 자이로=레일건(2). 무기타입 코드는 src/items/loadout.ts(WEAPON_*)와 일치.
 */
export const M2_UNIQUES: readonly UniqueDef[] = [
  { id: 'overheat-drum', name: '과열 드럼', slot: 'main', bit: UQ_OVERHEAT_DRUM, weaponType: 0 },
  { id: 'split-core', name: '분열 코어', slot: 'main', bit: UQ_SPLIT_CORE, weaponType: 1 },
  { id: 'pierce-gyro', name: '관통 자이로', slot: 'main', bit: UQ_PIERCE_GYRO, weaponType: 2 },
  { id: 'drone-bay', name: '자율 드론 베이', slot: 'sub', bit: UQ_DRONE_BAY },
  { id: 'phase-armor', name: '위상 장갑', slot: 'armor', bit: UQ_PHASE_ARMOR },
];

/**
 * M3 유니크 10점(plan B4 표 6~15번, OQ-M3-5 확정). 슬롯·비트는 고정. 무기 타입 의존
 * (군집 벌통=미사일 3·수렴 프리즘=빔 4·쌍둥이 항성=스프레드 발사 로직)과 파워업 레이어
 * 의존(도박사의 칩)은 Lane1/Lane4가 발사·파워업 경로에서 통합하며, 여기서는 슬롯·비트
 * 만 확정해 롤·장착 시 uniqueMask에 실린다.
 */
export const M3_UNIQUES: readonly UniqueDef[] = [
  { id: 'hive-swarm', name: '군집 벌통', slot: 'main', bit: UQ_HIVE_SWARM, weaponType: 3 },
  { id: 'converge-prism', name: '수렴 프리즘', slot: 'main', bit: UQ_CONVERGE_PRISM, weaponType: 4 },
  { id: 'twin-star', name: '쌍둥이 항성', slot: 'main', bit: UQ_TWIN_STAR, weaponType: 1 },
  { id: 'singularity', name: '특이점 발생기', slot: 'sub', bit: UQ_SINGULARITY },
  { id: 'reactive-armor', name: '반응 장갑', slot: 'armor', bit: UQ_REACTIVE_ARMOR },
  { id: 'phase-membrane', name: '위상 전환막', slot: 'shield', bit: UQ_PHASE_MEMBRANE },
  { id: 'afterimage-thruster', name: '잔상 추진기', slot: 'engine', bit: UQ_AFTERIMAGE },
  { id: 'greed-heart', name: '탐욕의 심장', slot: 'core', bit: UQ_GREED_HEART },
  { id: 'gambler-chip', name: '도박사의 칩', slot: 'module', bit: UQ_GAMBLER_CHIP },
  { id: 'relic-amplifier', name: '유물 증폭기', slot: 'module', bit: UQ_RELIC_AMP },
];

/** 전체 15점(M2 5 + M3 10)을 레지스트리에 등록(idempotent by id). */
export function registerM2Uniques(): void {
  for (const def of M2_UNIQUES) registerUnique(def);
  for (const def of M3_UNIQUES) registerUnique(def);
}

// side-effect: import 즉시 등록.
registerM2Uniques();
