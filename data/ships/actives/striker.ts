/**
 * striker 액티브 스킬 6종 (ADR-0041).
 *
 * PLACEHOLDER_BALANCE — 계수·쿨다운은 **하네스 육안 확인이 가능한 과장값**이다.
 * 실제 수치는 출시 전 일괄 밸런스 패스에서 확정한다(ADR-0041 보류 항목).
 * 이 문구가 grep 으로 0건이 되어야 밸런스 패스 완료로 인정한다.
 *
 * 순서 = 그 기체 안의 indexInShip(0..5) = wire 정수의 축. **재정렬 금지**.
 *
 * ## 시그니처 조작 축 — **없다**
 * 스트라이커는 `signatureBit: -1`(`data/ships/striker.ts`)이라 건드릴 런타임 상태가 없다.
 * 6종 전부 `aux0`/`aux1` 을 **읽지도 쓰지도 않는다** — 이것이 설계이며, 시그니처 델타
 * 테스트(배선 전수 ③)의 **제외 목록이 정확히 이 6종**이다(제외가 조용히 늘면 그 테스트가
 * 별도 단언으로 잡는다).
 *
 * ## 저작 축: "무색함이 정체성"
 * 정직한 광선 · 대시 강화 · 짧은 무적. 신규 플레이어의 학습 기준선이고, 나머지 36종이
 * 무엇을 비틀고 있는지 재는 대조군이다. 계열은 레거시 3트리 — `SKILL_TREES`
 * (`data/skills.ts:24`) 순서 그대로 firepower(0) · survival(1) · mobility(2) 다.
 */

import type { ActiveSkillDef } from './types.js';

const SHIP = 0;

/** 기체 타입 0(striker)의 액티브 6종. */
export const STRIKER_ACTIVES = [
  {
    id: 'as_striker_firepower_lo',
    shipTypeId: SHIP,
    treeIndex: 0, // firepower / offense
    tier: 'lo',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 발동 방향으로 곧은 광선탄을 좁은 부채꼴로 뿜는다.
    coeff: { count: 12, damage: 16, spreadDeg: 30 },
  },
  {
    id: 'as_striker_firepower_hi',
    shipTypeId: SHIP,
    treeIndex: 0, // firepower / offense
    tier: 'hi',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 기체를 축으로 전 방향 일제 사격(확산 360°).
    coeff: { count: 24, damage: 20, spreadDeg: 360 },
  },
  {
    id: 'as_striker_survival_lo',
    shipTypeId: SHIP,
    treeIndex: 1, // survival / defense
    tier: 'lo',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 동안 매 틱 무적 프레임을 다시 세워 모든 피해를 무시한다.
    coeff: { ticks: 180, iframes: 2 },
  },
  {
    id: 'as_striker_survival_hi',
    shipTypeId: SHIP,
    treeIndex: 1, // survival / defense
    tier: 'hi',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 긴 무적 + **종료 틱에** 선체를 일부 회복한다(만료 훅).
    coeff: { ticks: 300, iframes: 2, heal: 40 },
  },
  {
    id: 'as_striker_mobility_lo',
    shipTypeId: SHIP,
    treeIndex: 2, // mobility / utility
    tier: 'lo',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 강습 추진 — 발동 방향으로 한 번에 돌파.
    coeff: { distance: 600, vaults: 1 },
  },
  {
    id: 'as_striker_mobility_hi',
    shipTypeId: SHIP,
    treeIndex: 2, // mobility / utility
    tier: 'hi',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 2단 도약 — 450 × 2단 = 총 900. 단을 나누는 이유는 벽 슬라이드가 단마다 걸려
    // 관통이 구조적으로 막히기 때문이다(`blink` 가 매 호출 슬라이드를 태운다).
    coeff: { distance: 450, vaults: 2 },
  },
] as const satisfies readonly ActiveSkillDef[];
