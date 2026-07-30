/**
 * 브루저 액티브 스킬 6종 (ADR-0041) — **0b 수직 관통 파일럿**.
 *
 * PLACEHOLDER_BALANCE — 계수·쿨다운은 **하네스 육안 확인이 가능한 과장값**이다.
 * 실제 수치는 출시 전 일괄 밸런스 패스에서 확정한다(ADR-0041 보류 항목).
 * 이 문구가 grep 으로 0건이 되어야 밸런스 패스 완료로 인정한다.
 *
 * 순서 = 그 기체 안의 indexInShip(0..5) = wire 정수의 축. **재정렬 금지**.
 *
 * ## 시그니처 조작 축 (`world.ts:1721-1731` 인코딩 표)
 * `aux0` = 장갑 스택(0..`ARMOR_MAX_STACKS`=8) · `aux1` = 마지막 피격 이후 경과 틱
 * (`ARMOR_DECAY_TICKS`=180 마다 1스택 소멸). 6종 전부 **스택을 능동적으로 충전하거나
 * 통째로 태워 쓴다** — 평소에는 맞아야만 쌓이는 자원을 만들고, 반대로 방어 자원을 화력으로
 * 환산하는 선택을 준다.
 *
 * ## 왜 브루저가 파일럿인가
 * 스트라이커는 `signatureBit: -1` 이라 **가장 위험한 seam(시그니처 쓰기)을 하나도 밟지 않는다**.
 * 브루저의 `aux0` 는 읽기·쓰기가 다 있는 정수 상태라, 관통 한 번으로 시그니처 쓰기 seam ·
 * 해시 영향 · UI 표시가 전부 밟힌다.
 */

import type { ActiveSkillDef } from './types.js';

const SHIP = 1;

/** 기체 타입 1(bruiser)의 액티브 6종. */
export const BRUISER_ACTIVES = [
  {
    id: 'as_bruiser_blade_lo',
    shipTypeId: SHIP,
    treeIndex: 0, // blade / offense
    tier: 'lo',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 탄수 = base + perStack × aux0(장갑 스택). 발동 후 aux0 = 0 으로 소모.
    coeff: { base: 8, perStack: 2, damage: 14, spreadDeg: 70 },
  },
  {
    id: 'as_bruiser_blade_hi',
    shipTypeId: SHIP,
    treeIndex: 0, // blade / offense
    tier: 'hi',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 먼저 aux0 를 최대치로 채우고 같은 틱에 전량을 소모한다(충전 → 전환).
    coeff: { base: 24, perStack: 0, damage: 22, spreadDeg: 50 },
  },
  {
    id: 'as_bruiser_morph_lo',
    shipTypeId: SHIP,
    treeIndex: 1, // morph / utility
    tier: 'lo',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 밀고 나가며 장갑 스택 +3, 감쇠 타이머(aux1) 리셋.
    coeff: { distance: 600, stacks: 3 },
  },
  {
    id: 'as_bruiser_morph_hi',
    shipTypeId: SHIP,
    treeIndex: 1, // morph / utility
    tier: 'hi',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 장거리 관통 돌진. 도착 시 장갑 만재.
    coeff: { distance: 900, stacks: 8 },
  },
  {
    id: 'as_bruiser_fortify_lo',
    shipTypeId: SHIP,
    treeIndex: 2, // fortify / defense
    tier: 'lo',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 동안 aux0 를 최대치로 고정하고 aux1 을 0 으로 눌러 감쇠를 차단한다.
    coeff: { ticks: 180 },
  },
  {
    id: 'as_bruiser_fortify_hi',
    shipTypeId: SHIP,
    treeIndex: 2, // fortify / defense
    tier: 'hi',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 고정 후 **종료 틱에** 전량을 폭발로 전환한다(만료 훅).
    coeff: { ticks: 300, blastRadius: 220, blastDamage: 120 },
  },
] as const satisfies readonly ActiveSkillDef[];
