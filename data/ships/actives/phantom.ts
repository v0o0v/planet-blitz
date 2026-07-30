/**
 * phantom 액티브 스킬 6종 (ADR-0041).
 *
 * PLACEHOLDER_BALANCE — 계수·쿨다운은 **하네스 육안 확인이 가능한 과장값**이다.
 * 실제 수치는 출시 전 일괄 밸런스 패스에서 확정한다(ADR-0041 보류 항목).
 * 이 문구가 grep 으로 0건이 되어야 밸런스 패스 완료로 인정한다.
 *
 * 순서 = 그 기체 안의 indexInShip(0..5) = wire 정수의 축. **재정렬 금지**.
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1811-1816` 인코딩 표)
 * `aux0` = 연속 무피격 틱(구조적 상한 `CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS - 1` = 359) ·
 * `aux1` = 은신 해제 첫 타 대기 플래그(0/1).
 * `CLOAK_UNHIT_TICKS`=240 진입 · `CLOAK_HOLD_TICKS`=120 유지 · `CLOAK_BREAK_BP`=25000.
 *
 * ## 저작 축: 은신 사이클을 손으로 돌린다
 * 240틱을 기다리는 대신 주입하고, 해제 첫 타 배율을 원하는 순간에 터뜨린다. 은신 창(120틱)이
 * 구조적으로 유계라는 시그니처 설계를 깨지 않는 선에서 **진입 시점만** 옮긴다. 6종 전부
 * `aux0` 또는 `aux1` 을 쓴다.
 */

import type { ActiveSkillDef } from './types.js';

const SHIP = 3;

/** 기체 타입 3(phantom)의 액티브 6종. */
export const PHANTOM_ACTIVES = [
  {
    id: 'as_phantom_assassin_lo',
    shipTypeId: SHIP,
    treeIndex: 0, // assassin / offense
    tier: 'lo',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // aux1 = 1(해제 첫 타 대기)을 세운 뒤 aux0 = 0(사이클 리셋) — "은신을 지금 끊어 쓴다".
    coeff: { count: 12, damage: 18, spreadDeg: 40 },
  },
  {
    id: 'as_phantom_assassin_hi',
    shipTypeId: SHIP,
    treeIndex: 0, // assassin / offense
    tier: 'hi',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 같은 틱에 은신 진입 → 즉시 이탈. 진입을 거쳐야 해제 배율이 정당해진다.
    coeff: { count: 24, damage: 24, spreadDeg: 60 },
  },
  {
    id: 'as_phantom_phase_lo',
    shipTypeId: SHIP,
    treeIndex: 1, // phase / utility
    tier: 'lo',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 무피격 누적(aux0)을 advance 만큼 앞당긴다 — 은신 진입 조건을 앞으로 당긴다.
    coeff: { distance: 600, advance: 120 },
  },
  {
    id: 'as_phantom_phase_hi',
    shipTypeId: SHIP,
    treeIndex: 1, // phase / utility
    tier: 'hi',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 착지와 동시에 은신 창으로 직행(aux0 = 진입 임계, aux1 = 배율 토큰).
    coeff: { distance: 900 },
  },
  {
    id: 'as_phantom_disrupt_lo',
    shipTypeId: SHIP,
    treeIndex: 2, // disrupt / defense
    tier: 'lo',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 매 틱 aux0 의 **하한을 진입 임계로** 고정 — 피격이 사이클을 끊지 못한다.
    coeff: { ticks: 180 },
  },
  {
    id: 'as_phantom_disrupt_hi',
    shipTypeId: SHIP,
    treeIndex: 2, // disrupt / defense
    tier: 'hi',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 매 틱 aux1 = 1 을 재세운다 — 해제 첫 타 배율이 소모되지 않는다.
    coeff: { ticks: 300 },
  },
] as const satisfies readonly ActiveSkillDef[];
