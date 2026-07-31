/**
 * 액티브 스킬 레지스트리 — **단일 정본**(ADR-0041 · 계획 0a-2).
 *
 * 기체별 파일 7개를 여기서 하나로 합친다. 순서는 `SHIP_TYPES` 와 같고 **append-only** 다 —
 * `activeWireId(shipTypeId, indexInShip)` 가 해시·`WorldConfig` 에 실리는 정수를 이 순서에서
 * 파생하므로, 기체 안에서 6종의 순서를 바꾸면 **저장된 장착 슬롯이 다른 스킬을 가리킨다**.
 *
 * ## 레지스트리와 핸들러는 물리적으로 분리된 두 테이블이다
 * 효과 함수는 `src/sim/actives.ts` 가 소유한다. 한 파일 한 키로 합치면 배선 전수 테스트가
 * **구조적 항진**이 되기 때문이다(계획 개정 3, PM-1). 한쪽만 채운 상태가 실제로 존재
 * 가능해야 `tests/activeSkillWiring.test.ts` 의 존재 대조가 의미를 갖는다.
 */

import { SHIP_TYPES, shipTreeRange } from '../index.js';
import type { ShipTypeDef } from '../types.js';
import { ACTIVE_LO_GATE, ACTIVES_PER_SHIP, activeWireId } from './types.js';
import type { ActiveSkillDef } from './types.js';
import { STRIKER_ACTIVES } from './striker.js';
import { BRUISER_ACTIVES } from './bruiser.js';
import { ARCCASTER_ACTIVES } from './arccaster.js';
import { PHANTOM_ACTIVES } from './phantom.js';
import { HATCHLING_ACTIVES } from './hatchling.js';
import { MALLOW_ACTIVES } from './mallow.js';
import { BUBBLE_ACTIVES } from './bubble.js';

/**
 * 42종 id 의 **리터럴 유니온**. 핸들러 테이블이 `satisfies Record<ActiveSkillId, ActiveHandler>`
 * 로 이것을 소비해 **누락을 컴파일 타임에** 잡는다(뮤테이션 M-① 의 두 축 중 하나).
 * 아직 저작 전인 기체는 빈 배열이라 `never` 를 기여한다 — 유니온이 자연히 자란다.
 */
export type ActiveSkillId =
  | (typeof STRIKER_ACTIVES)[number]['id']
  | (typeof BRUISER_ACTIVES)[number]['id']
  | (typeof ARCCASTER_ACTIVES)[number]['id']
  | (typeof PHANTOM_ACTIVES)[number]['id']
  | (typeof HATCHLING_ACTIVES)[number]['id']
  | (typeof MALLOW_ACTIVES)[number]['id']
  | (typeof BUBBLE_ACTIVES)[number]['id'];

/** 기체 타입 인덱스 = `SHIP_TYPES` 인덱스. **재정렬 금지**. */
export const ACTIVES_BY_SHIP: readonly (readonly ActiveSkillDef[])[] = [
  STRIKER_ACTIVES,
  BRUISER_ACTIVES,
  ARCCASTER_ACTIVES,
  PHANTOM_ACTIVES,
  HATCHLING_ACTIVES,
  MALLOW_ACTIVES,
  BUBBLE_ACTIVES,
];

/** 42종 전부(기체 순서 → 기체 안 순서). */
export const ALL_ACTIVES: readonly ActiveSkillDef[] = ACTIVES_BY_SHIP.flat();

/** id 로 조회. 미지 id 는 `undefined`(손상 세이브 방어 — 호출부가 빈 슬롯으로 떨어뜨린다). */
export function activeById(id: string): ActiveSkillDef | undefined {
  return ALL_ACTIVES.find((d) => d.id === id);
}

/** wire 정수로 조회. 범위 밖·미장착(-1)은 `undefined`. */
export function activeByWireId(wire: number): ActiveSkillDef | undefined {
  if (!Number.isInteger(wire) || wire < 0) return undefined;
  const shipTypeId = Math.floor(wire / ACTIVES_PER_SHIP);
  const idx = wire % ACTIVES_PER_SHIP;
  return ACTIVES_BY_SHIP[shipTypeId]?.[idx];
}

/** 그 스킬의 wire 정수. 레지스트리에 없으면 `ACTIVE_WIRE_EMPTY` 와 같은 -1. */
export function wireIdOf(id: string): number {
  for (let s = 0; s < ACTIVES_BY_SHIP.length; s++) {
    const list = ACTIVES_BY_SHIP[s];
    if (list === undefined) continue;
    const i = list.findIndex((d) => d.id === id);
    if (i >= 0) return activeWireId(s, i);
  }
  return -1;
}

/**
 * 해금 임계 = 그 계열 base 노드 누적 투자 하한.
 * 저티어 8 고정 · 고티어는 **`capstoneGate` 추종**(ADR-0041 "캡스톤과 같은 문턱" —
 * 해츨링만 44 인 것이 자동으로 따라온다).
 */
export function activeGateThreshold(def: ActiveSkillDef): number {
  if (def.tier === 'lo') return ACTIVE_LO_GATE;
  const ship: ShipTypeDef | undefined = SHIP_TYPES[def.shipTypeId];
  return ship?.capstoneGate ?? 40;
}

/** 그 계열에 실제로 투자된 base 누적 포인트(캡스톤 제외). */
export function investedInTree(skillInvest: readonly number[], def: ActiveSkillDef): number {
  const ship = SHIP_TYPES[def.shipTypeId];
  if (ship === undefined) return 0;
  const { start, end } = shipTreeRange(ship, def.treeIndex);
  let sum = 0;
  for (let i = start; i < end; i++) sum += skillInvest[i] ?? 0;
  return sum;
}

/** 해금 판정(AC-12). 경계는 **이상**(`>=`)이다. */
export function isActiveUnlocked(skillInvest: readonly number[], def: ActiveSkillDef): boolean {
  return investedInTree(skillInvest, def) >= activeGateThreshold(def);
}

/**
 * 실효 쿨다운(틱) — 계열 누적 투자가 늘수록 **단조 감소**(AC-13). 하한 `ACTIVE_CD_FLOOR`.
 * **정수 전용**이다(부동소수는 결정론 위험 — sim 이 이 값을 그대로 `WorldState` 정수에 쓴다).
 */
export function activeCooldownTicks(def: ActiveSkillDef, invested: number): number {
  const inv = Math.max(0, Math.floor(invested));
  return Math.max(ACTIVE_CD_FLOOR, def.baseCooldown - Math.floor(inv / 4) * 2);
}

/** 쿨다운 하한(틱) — 투자를 아무리 부어도 이 아래로 내려가지 않는다. */
export const ACTIVE_CD_FLOOR = 18;

/**
 * 실효 위력 배율(**centi 정수** — 100 = ×1.00). 계열 누적 투자가 늘수록 **단조 증가**(AC-13).
 * 파생값이므로 별도 저장이 없다(`skillInvest` 에서만 파생 — AC-13 후단).
 *
 * ⚠️ **이 값이 도달하는 곳은 42종이 아니라 17종이다**(ADR-0041 §"위력의 적용 범위",
 * 2026-07-31 개정). `powerCentiOf`(`src/sim/activeTypes.ts:59`)를 호출하는 것은
 * `kind='strike'` 14종의 `coeff.damage` 와 buff 3종의 만료 훅(`coeff.heal`/`coeff.blastDamage`)
 * 뿐이고, **이동 거리·버프 지속·무적·충전·흡수량은 투자에 불변**이다. 이 함수만 보는 단조성
 * 단언은 그 사실을 못 본다 — 도달 범위의 잠금은 `tests/activeSkillPowerScope.test.ts` 다.
 */
export function activePowerCenti(_def: ActiveSkillDef, invested: number): number {
  const inv = Math.max(0, Math.floor(invested));
  return 100 + inv * 2;
}

export type { ActiveSkillDef } from './types.js';
