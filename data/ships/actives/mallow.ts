/**
 * 마시멜로 액티브 스킬 6종 (ADR-0041).
 *
 * PLACEHOLDER_BALANCE — 계수·쿨다운은 **하네스 육안 확인이 가능한 과장값**이다.
 * 실제 수치는 출시 전 일괄 밸런스 패스에서 확정한다(ADR-0041 보류 항목).
 * 이 문구가 grep 으로 0건이 되어야 밸런스 패스 완료로 인정한다.
 *
 * 순서 = 그 기체 안의 indexInShip(0..5) = wire 정수의 축. **재정렬 금지**.
 *
 * ## 시그니처 조작 축 (`src/sim/world.ts:1815` 인코딩 표)
 * `aux0` = 적립된 지연 피해(비음 정수) · `aux1` = 연속 무피격 틱
 * (`CUSHION_DEFER_BP` 로 적립 · `CUSHION_RECOVER_TICKS`=180 을 채운 틱에 풀을 통째로 정산).
 * 6종은 **미룬 아픔을 언제 갚을지** 고른다 — 적립분을 탄약으로 환산해 지금 쏘거나, 무피격
 * 카운터를 주입해 정산·회복을 앞당기거나, 반대로 부채를 키워 화력을 당겨쓴다.
 */

import type { ActiveSkillDef } from './types.js';

const SHIP = 5;

/** 기체 타입 5(mallow)의 액티브 6종. */
export const MALLOW_ACTIVES = [
  {
    id: 'as_mallow_squish_lo',
    shipTypeId: SHIP,
    treeIndex: 0, // squish / offense
    tier: 'lo',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 탄수 = base + ⌊aux0 / perDeferred⌋. 발동 후 aux0 = 0 으로 부채를 청산한다.
    coeff: { base: 8, perDeferred: 10, damage: 14, spreadDeg: 70 },
  },
  {
    id: 'as_mallow_squish_hi',
    shipTypeId: SHIP,
    treeIndex: 0, // squish / offense
    tier: 'hi',
    kind: 'strike',
    observable: 'projectileCount',
    baseCooldown: 120,
    // 반대 거래 — 부채를 `carryMul` 배로 키우고 `carryAdd` 를 더해 지금의 대형 탄막을 산다.
    coeff: { base: 24, damage: 22, spreadDeg: 50, carryMul: 2, carryAdd: 60 },
  },
  {
    id: 'as_mallow_mend_lo',
    shipTypeId: SHIP,
    treeIndex: 1, // mend / utility
    tier: 'lo',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 튕겨 이동한 뒤 aux1 에 정산 임계를 주입해 착지 즉시 정산·회복이 일어나게 한다.
    coeff: { distance: 600 },
  },
  {
    id: 'as_mallow_mend_hi',
    shipTypeId: SHIP,
    treeIndex: 1, // mend / utility
    tier: 'hi',
    kind: 'dash',
    observable: 'displacement',
    baseCooldown: 120,
    // 장거리 반동. 정산 **전에** 부채를 절반으로 깎는다(들어올 피해 자체가 줄어든다).
    coeff: { distance: 900, debtDiv: 2 },
  },
  {
    id: 'as_mallow_cushion_lo',
    shipTypeId: SHIP,
    treeIndex: 2, // cushion / defense
    tier: 'lo',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 매 틱 aux1 을 `perTick` 만큼 더 흘린다 — 피격 리셋을 상쇄해 회복 임계가 빨리 찬다.
    coeff: { ticks: 180, perTick: 3 },
  },
  {
    id: 'as_mallow_cushion_hi',
    shipTypeId: SHIP,
    treeIndex: 2, // cushion / defense
    tier: 'hi',
    kind: 'buff',
    observable: 'buffTicks',
    baseCooldown: 120,
    // 지속 중에는 aux1 을 0 으로 눌러 정산을 **막고**(전량 유예), 종료 틱에 임계를 주입해
    // 미뤄둔 분을 한 번에 정산한다(만료 훅).
    coeff: { ticks: 300 },
  },
] as const satisfies readonly ActiveSkillDef[];
