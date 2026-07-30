/**
 * 버블 액티브 스킬 6종 (ADR-0041).
 *
 * PLACEHOLDER_BALANCE — 계수·쿨다운은 **하네스 육안 확인이 가능한 과장값**이다.
 * 실제 수치는 출시 전 일괄 밸런스 패스에서 확정한다(ADR-0041 보류 항목).
 * 이 문구가 grep 으로 0건이 되어야 밸런스 패스 완료로 인정한다.
 *
 * 순서 = 그 기체 안의 indexInShip(0..5) = wire 정수의 축. **재정렬 금지**.
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1816` 인코딩 표)
 * `aux0` = 남은 막 내구(0..`FILM_ABSORB_FLAT`=60) · `aux1` = 마지막 파열 이후 경과 틱
 * (`FILM_PERIOD_TICKS`=420 마다 재생. 재생 타이머는 `aux0 === 0` 일 때만 돈다).
 * 6종은 **막을 원할 때 터뜨리고 원할 때 다시 세운다** — 파열은 밀어내기라 공격 겸 위기탈출이고,
 * `aux1` 주입은 7초 주기를 건너뛰는 재충전이다.
 */

import type { ActiveSkillDef } from './types.js';

const SHIP = 6;

/** 기체 타입 6(bubble)의 액티브 6종. */
export const BUBBLE_ACTIVES = [
  {
    id: 'as_bubble_pop_lo',
    shipTypeId: SHIP,
    treeIndex: 0, // pop / offense
    tier: 'lo',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 막을 강제로 터뜨린다(aux0 = 0 · aux1 = 0) — 거품탄 + 반경 안 적 밀어내기.
    coeff: { base: 12, damage: 14, spreadDeg: 70 },
  },
  {
    id: 'as_bubble_pop_hi',
    shipTypeId: SHIP,
    treeIndex: 0, // pop / offense
    tier: 'hi',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 탄수 = base + ⌊aux0 / perFilm⌋. 남은 내구를 통째로 탄약으로 환산한다(밀어내기 없음).
    coeff: { base: 8, perFilm: 4, damage: 22, spreadDeg: 50 },
  },
  {
    id: 'as_bubble_drift_lo',
    shipTypeId: SHIP,
    treeIndex: 1, // drift / utility
    tier: 'lo',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 부양 이동. 재생 타이머를 주기의 절반(210틱)만큼 앞당긴다.
    coeff: { distance: 600, rechargeTicks: 210 },
  },
  {
    id: 'as_bubble_drift_hi',
    shipTypeId: SHIP,
    treeIndex: 1, // drift / utility
    tier: 'hi',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 장거리 부양. 재생 타이머를 주기 전량으로 채워 `filmReady` 가 즉시 참이 된다.
    coeff: { distance: 900 },
  },
  {
    id: 'as_bubble_film_lo',
    shipTypeId: SHIP,
    treeIndex: 2, // film / defense
    tier: 'lo',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 막을 즉시 만재하고, 지속 매 틱 재생 타이머를 `perTick` 만큼 더 흘린다.
    coeff: { ticks: 180, perTick: 2 },
  },
  {
    id: 'as_bubble_film_hi',
    shipTypeId: SHIP,
    treeIndex: 2, // film / defense
    tier: 'hi',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 매 틱 막을 만재로 되돌리고, **종료 틱에** 전량을 파열로 전환한다(만료 훅).
    coeff: { ticks: 300, blastDamage: 120 },
  },
] as const satisfies readonly ActiveSkillDef[];
