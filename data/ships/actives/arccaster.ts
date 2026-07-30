/**
 * arccaster 액티브 스킬 6종 (ADR-0041).
 *
 * PLACEHOLDER_BALANCE — 계수·쿨다운은 **하네스 육안 확인이 가능한 과장값**이다.
 * 실제 수치는 출시 전 일괄 밸런스 패스에서 확정한다(ADR-0041 보류 항목).
 * 이 문구가 grep 으로 0건이 되어야 밸런스 패스 완료로 인정한다.
 *
 * 순서 = 그 기체 안의 indexInShip(0..5) = wire 정수의 축. **재정렬 금지**.
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1811-1816` 인코딩 표)
 * `aux0` = 연속 정지 틱(상한 `OVERCHARGE_TICK_CAP`=600) · `aux1` = 미사용(0).
 * `OVERCHARGE_STILL_TICKS`=90 에서 과충전 진입, `OVERCHARGE_MAX_BP`=4000 은 190틱에서 도달.
 *
 * ## 저작 축: "정지해야 강해진다"는 제약을 능동적으로 사고판다
 * 정지 틱을 주입해 즉시 과충전에 올리거나, 반대로 쌓인 정지 틱을 한 번에 방전한다.
 * **이동 중에도 과충전을 유지하는 것**이 이 기체 액티브의 핵심 판타지다. 6종 전부 `aux0` 를
 * 읽거나 쓴다 — `aux1` 은 이 기체에서 미사용이므로 건드리지 않는다(인코딩 표 준수).
 */

import type { ActiveSkillDef } from './types.js';

const SHIP = 2;

/** 기체 타입 2(arccaster)의 액티브 6종. */
export const ARCCASTER_ACTIVES = [
  {
    id: 'as_arccaster_chain_lo',
    shipTypeId: SHIP,
    treeIndex: 0, // chain / offense
    tier: 'lo',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 정지 없이 과충전 임계까지 aux0 를 주입한 뒤 연쇄 전격을 흘린다.
    coeff: { count: 12, damage: 16, spreadDeg: 60 },
  },
  {
    id: 'as_arccaster_chain_hi',
    shipTypeId: SHIP,
    treeIndex: 0, // chain / offense
    tier: 'hi',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 탄수 = base + ⌊aux0 / perTicks⌋. 발동 후 aux0 = 0 으로 **방전**(자원 소모형).
    coeff: { base: 8, perTicks: 40, damage: 22, spreadDeg: 45 },
  },
  {
    id: 'as_arccaster_barrage_lo',
    shipTypeId: SHIP,
    treeIndex: 1, // barrage / utility
    tier: 'lo',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 점멸 후 aux0 의 **하한을 과충전 임계로 고정**한다 = "과충전을 잃지 않은 채 이동".
    coeff: { distance: 600 },
  },
  {
    id: 'as_arccaster_barrage_hi',
    shipTypeId: SHIP,
    treeIndex: 1, // barrage / utility
    tier: 'hi',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 착지 틱에 증폭 상한 도달치(90 + 100 = 190틱)로 aux0 를 세운다.
    coeff: { distance: 900 },
  },
  {
    id: 'as_arccaster_barrier_lo',
    shipTypeId: SHIP,
    treeIndex: 2, // barrier / defense
    tier: 'lo',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 매 틱 aux0 를 perTick 만큼 올린다 — 움직여도 충전이 쌓인다.
    coeff: { ticks: 180, perTick: 2 },
  },
  {
    id: 'as_arccaster_barrier_hi',
    shipTypeId: SHIP,
    treeIndex: 2, // barrier / defense
    tier: 'hi',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 매 틱 aux0 를 상한 도달치로 **고정**한다(무엇을 해도 과충전이 풀리지 않는다).
    coeff: { ticks: 300 },
  },
] as const satisfies readonly ActiveSkillDef[];
