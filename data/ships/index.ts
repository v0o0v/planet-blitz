/**
 * 기체 타입 레지스트리 (M8 설계서 §2·§3, ADR-0019).
 *
 * **`SHIP_TYPES` 배열 인덱스 === `ShipTypeDef.id` === 세이브·리플레이의 wire 값이다.**
 * 재번호·재정렬 금지, append-only. 순서를 바꾸면 기존 세이브의 `Ship.typeId` 가 다른 기체를
 * 가리키고, 리플레이 검증(EF)이 다른 트리로 재실행된다.
 *
 * 타입 0(스트라이커)만 특별하다 — 시그니처 없음(`signatureBit = -1`), baseBp 전 축 0,
 * 노드 63개 고정. 설계서 §11 채택안 A: 5종 리팩터가 도는 동안 스트라이커를 **회귀 탐지기**로
 * 남긴다. 전 신규 경로가 타입 0 에서 조기 탈출하므로 기존 런의 해시가 바이트 불변이다.
 *
 * 1~6 은 실데이터다. 타입 4 는 구 slug `bion`(곤충 컨셉)에서 `hatchling` 으로 **개명**됐고
 * (2026-07-21 사용자 지시), 5·6(`mallow`·`bubble`)은 같은 지시로 **append** 된 신규 기체다 —
 * 개명은 slug·표시 문구만 바꾸며 `id`·`signatureBit` 은 wire 계약이라 그대로다.
 */

import { STRIKER } from './striker.js';
import { BRUISER } from './bruiser.js';
import { ARCCASTER } from './arccaster.js';
import { PHANTOM } from './phantom.js';
import { HATCHLING } from './hatchling.js';
import { MALLOW } from './mallow.js';
import { BUBBLE } from './bubble.js';
import { shipNodeCount } from './types.js';
import type { ShipTypeDef } from './types.js';

export type {
  ShipTypeDef,
  ShipTreeDef,
  ShipSkillDef,
  ShipBaseBp,
  TreeAffinity,
  SkillSpec,
} from './types.js';
export {
  TREE_AFFINITIES,
  LEGACY_TREE_AFFINITY,
  AFFINITY_LEGACY_TREE,
  TREES_PER_SHIP,
  SKILLS_PER_AXIS,
  SKILL_MAX_LEVEL,
  ACTIVE_HI_GATE_DEFAULT,
  SIGNATURE_BIT_MIN,
  SIGNATURE_BIT_MAX,
  NO_SIGNATURE_BIT,
  shipNodeCount,
  shipTreeRange,
  shipAxisIndexOf,
  flattenShipNodes,
  buildShipAxis,
} from './types.js';
export { STRIKER } from './striker.js';
export { BRUISER } from './bruiser.js';
export { ARCCASTER } from './arccaster.js';
export { PHANTOM } from './phantom.js';
export { HATCHLING } from './hatchling.js';
export { MALLOW } from './mallow.js';
export { BUBBLE } from './bubble.js';

/** 인덱스 = typeId. **append-only** — 삽입·삭제·재정렬 금지. */
export const SHIP_TYPES: readonly ShipTypeDef[] = [
  STRIKER,
  BRUISER,
  ARCCASTER,
  PHANTOM,
  HATCHLING,
  MALLOW,
  BUBBLE,
];

/** 기본(첫 지급) 기체 타입 = 스트라이커. `WorldConfig.shipType` 미지정 시의 값이기도 하다. */
export const DEFAULT_SHIP_TYPE = 0;

/**
 * 세이브에서 읽은 값을 유효 범위로 clamp 한다. 범위 밖 값이 그대로 흐르면 조회가 `undefined` 가
 * 되어 트리·loadout 이 **조용히 중립**이 된다(설계서 §6) — 손상 세이브를 무해하게 만드는 자리.
 */
export function normalizeShipTypeId(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_SHIP_TYPE;
  const i = Math.floor(v);
  if (i < 0) return DEFAULT_SHIP_TYPE;
  if (i >= SHIP_TYPES.length) return DEFAULT_SHIP_TYPE;
  return i;
}

/** 타입 정의 조회. 범위 밖이면 기본 타입으로 되돌린다(절대 undefined 를 흘리지 않는다). */
export function shipTypeDef(typeId: number): ShipTypeDef {
  const def = SHIP_TYPES[normalizeShipTypeId(typeId)];
  // normalizeShipTypeId 가 항상 유효 인덱스를 주므로 도달 불가. 타입 좁히기용.
  if (def === undefined) throw new Error(`기체 타입 조회 실패: ${typeId}`);
  return def;
}

/** 이 타입의 `skillInvest` 벡터 길이. 스트라이커 = 63(동결). */
export function shipSkillNodeCount(typeId: number): number {
  return shipNodeCount(shipTypeDef(typeId));
}

/**
 * 이 타입의 **무투자 `skillInvest` 벡터**. 신규 기체 생성·손상 세이브 복구가 쓴다(M8-L3).
 * 항상 새 배열을 준다(공유 배열을 반환하면 한 기체의 투자가 다른 기체로 샌다).
 */
export function zeroSkillInvest(typeId: number): number[] {
  return new Array<number>(shipSkillNodeCount(typeId)).fill(0);
}

/** 선택 가능한 타입 전량. ADR-0019: **해금 게이트 없음**(전체 개방은 명시적 사용자 선택). */
export function selectableShipTypes(): readonly ShipTypeDef[] {
  return SHIP_TYPES;
}
