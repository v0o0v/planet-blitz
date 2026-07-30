/**
 * 해츨링 액티브 스킬 6종 (ADR-0041).
 *
 * PLACEHOLDER_BALANCE — 계수·쿨다운은 **하네스 육안 확인이 가능한 과장값**이다.
 * 실제 수치는 출시 전 일괄 밸런스 패스에서 확정한다(ADR-0041 보류 항목).
 * 이 문구가 grep 으로 0건이 되어야 밸런스 패스 완료로 인정한다.
 *
 * 순서 = 그 기체 안의 indexInShip(0..5) = wire 정수의 축. **재정렬 금지**.
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1814` 인코딩 표)
 * `aux0` = **마지막 출격 시점의 `state.kills` 스냅샷** · `aux1` = 미사용(0).
 * 출격 판정이 `state.kills − aux0 >= hatchThreshold(state.kills)` 이므로, `aux0` 을 과거로
 * 밀면 다음 부화가 앞당겨지고 `state.kills` 로 당기면 부화 진행도가 소각된다.
 *
 * ⚠️ **액티브 자신은 아무것도 소환하지 않는다**(Non-Goal ① 설치물·소환물 금지). 병아리 출격은
 * 시그니처 패시브가 원래 하던 일이고, 이 6종은 그 **타이밍만 옮긴다**. 관측량은 어디까지나
 * 자기 `observable`(탄수·변위·버프 틱)이다.
 */

import type { ActiveSkillDef } from './types.js';

const SHIP = 4;

/** 기체 타입 4(hatchling)의 액티브 6종. */
export const HATCHLING_ACTIVES = [
  {
    id: 'as_hatchling_brood_lo',
    shipTypeId: SHIP,
    treeIndex: 0, // brood / offense
    tier: 'lo',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 알탄을 흩뿌리고 스냅샷을 HATCH_MAX_KILLS 만큼 과거로 민다(다음 부화가 크게 앞당겨진다).
    coeff: { base: 12, damage: 14, spreadDeg: 70 },
  },
  {
    id: 'as_hatchling_brood_hi',
    shipTypeId: SHIP,
    treeIndex: 0, // brood / offense
    tier: 'hi',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 반대 방향 거래 — 스냅샷을 `state.kills` 로 당겨 부화 진행도를 **소각**하고 지금 탄막을 산다.
    coeff: { base: 24, damage: 22, spreadDeg: 50 },
  },
  {
    id: 'as_hatchling_nurture_lo',
    shipTypeId: SHIP,
    treeIndex: 1, // nurture / utility
    tier: 'lo',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 굴러 이동하며 스냅샷을 HATCH_STEP_KILLS(4) 만큼 과거로.
    coeff: { distance: 600 },
  },
  {
    id: 'as_hatchling_nurture_hi',
    shipTypeId: SHIP,
    treeIndex: 1, // nurture / utility
    tier: 'hi',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 장거리 도약. 스냅샷을 HATCH_BASE_KILLS(12) 만큼 과거로 — 첫 부화 요구치 한 벌 분량.
    coeff: { distance: 900 },
  },
  {
    id: 'as_hatchling_shelter_lo',
    shipTypeId: SHIP,
    treeIndex: 2, // shelter / defense
    tier: 'lo',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 동안 `period` 틱마다 스냅샷이 1씩 과거로 흐른다(꾸준한 앞당김).
    coeff: { ticks: 180, period: 30 },
  },
  {
    id: 'as_hatchling_shelter_hi',
    shipTypeId: SHIP,
    treeIndex: 2, // shelter / defense
    tier: 'hi',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 매 틱 스냅샷을 0 으로 고정 — 부화 임계가 상시 충족된 상태로 유지된다.
    coeff: { ticks: 300 },
  },
] as const satisfies readonly ActiveSkillDef[];
