/**
 * 아크캐스터 스킬의 **레벨 스케일 정본** — 순수 함수만 (ADR-0049).
 *
 * 존재 이유·계약·bp 규약은 `strikerScaling.ts` 머리와 같다. 요약하면: 연구소 화면이 수치를
 * 보여 주려면 그 수치가 어딘가에서 계산돼야 하는데, 설계서를 베끼면 **이미 구현과 갈려 있고**
 * 화면이 자기 공식을 적으면 밸런스 한 줄에 조용히 갈린다. 그래서 sim 의 인라인 산술을 여기로
 * 뽑아 **sim 과 화면이 같은 함수를 부른다.**
 *
 * ⚠️ 산술은 `arccaster.ts` 원본에서 **그대로** 옮겼다(괄호·나눗셈 순서·반올림 위치 포함).
 * 결정론 게이트와 `tests/skillArccaster.test.ts` 가 거동 불변을 증명한다.
 */

/** BA3 환급 단위. `constants.ts` 의 `FIRE_CD_Q` 와 같은 값이지만 여기서는 배수만 쓴다. */
export const CAPACITOR_KILLS = 6;

// --- 연쇄(chain) 축 ---------------------------------------------------------

/** CH1 과충전 탄 명중 시 터지는 전격 연쇄 피해 = 그 탄 피해 × 이 bp(**배율**). */
export function guidedArcChainBp(level: number): number {
  return 2000 + 200 * level;
}

/** CH2 모든 전격 연쇄의 **도약 반경 증가분**(더하는 값이다). */
export function relayRadiusAdd(level: number): number {
  return 20 + 6 * level;
}

/** CH2 전격 연쇄의 **도약 대상 수 증가분**. */
export function relayTargetsAdd(level: number): number {
  return 1 + Math.floor(level / 7);
}

/** CH3 사거리 소멸 방전 폭발 피해 = 기준 피해 × 이 bp(**배율**). */
export function endpointBurstBp(level: number): number {
  return 2500 + 200 * level;
}

/** CH3 방전 폭발 범위. */
export function endpointBurstRadius(level: number): number {
  return 50 + 5 * level;
}

/** CH4 과충전 진입 시 자동 사출되는 방전탄 피해. */
export function entryLanceDamage(level: number): number {
  return 30 + 6 * level;
}

/** CH4 그 방전탄의 관통. */
export function entryLancePierce(level: number): number {
  return 3 + Math.floor(level / 5);
}

/** CH5 멀리 날아간 탄의 피해 **증분** bp. */
export function potentialSnipeBp(level: number): number {
  return 2500 + 250 * level;
}

/** CH5 그 탄이 얻는 추가 관통. */
export function potentialSnipePierce(level: number): number {
  return 1 + Math.floor(level / 8);
}

/** CH6 처치 후 남은 초과 피해 중 다음 대상에게 실리는 몫(**배율** bp). */
export function overkillCarryBp(level: number): number {
  return 4000 + 300 * level;
}

/** CH7 여진탄 1발당 소모하는 정지 시간(틱). 낮을수록 같은 정지에서 더 많이 나간다. */
export function residualBoltCostTicks(level: number): number {
  return Math.max(10, 60 - 2 * level);
}

/** CH8 관통 1회 소모마다 얹히는 피해 **증분** bp. */
export function groundedPierceBp(level: number): number {
  return 600 + 60 * level;
}

/** CH9 과충전 중 처치한 엘리트의 전리품 희귀도 **배율** bp(10500 = ×1.05). */
export function boltSalvageMultBp(level: number): number {
  return 10500 + 250 * level;
}

/** CH10 방전 액티브 투사체가 부여하는 전격 연쇄 피해(**배율** bp). */
export function primedStrikeBp(level: number): number {
  return 2500 + 200 * level;
}

// --- 일제사(barrage) 축 -----------------------------------------------------

/** BA1 점멸 착지 시 자동 발사되는 원형 볼리의 탄 수. */
export function redeploySalvoCount(level: number): number {
  return 6 + Math.floor(level / 2);
}

/** BA1 그 볼리 1발의 피해. */
export function redeploySalvoDamage(level: number): number {
  return 18 + 3 * level;
}

/**
 * BA2 정지 시간이 도달치에 닿았을 때의 자석 반경 **증분** bp(2000 = +20%).
 *
 * 실제 증분은 `정지 시간 / 도달치` 에 비례해 이 값까지 자란다.
 */
export function stillMagnetMaxBp(level: number): number {
  return 2000 + 200 * level;
}

/** BA3 정지 중 수거한 젬 1개가 환급하는 발사 쿨다운(발사 간격 단위). */
export function stillSpotterRefundShots(level: number): number {
  return 2 + Math.floor(level / 2);
}

/** BA4 점멸 경로에서 젬·전리품을 쓸어 담는 폭의 절반. */
export function sweepLaneHalfWidth(level: number): number {
  return 60 + 4 * level;
}

/** BA5 과충전 중 콤보 시계가 줄어드는 **주기**(N틱마다 1). 클수록 느리게 준다. */
export function staticComboPeriod(level: number): number {
  return 2 + Math.floor(level / 4);
}

/** BA7 축전기가 터질 때 늘어나는 볼리 탄 수. */
export function killCapacitorBonusCount(level: number): number {
  return 2 + Math.floor(level / 5);
}

/** BA8 감속 장판 위 정지 시 용암 피해 **감소** bp. */
export function insulatedMountCutBp(level: number): number {
  return 1500 + 150 * level;
}

/** BA9 이동 중 과충전 게이지가 1 줄어드는 **주기**(N틱마다 1). 클수록 느리게 샌다. */
export function marchFireDecayPeriod(level: number): number {
  return 2 + Math.floor(level / 2);
}

/**
 * BA10 발사 간격·탄수 **배율** bp(20000 = ×2.00에서 시작해 줄어든다).
 *
 * Lv1 = 19455 · Lv20 = 16000 — 레벨을 올릴수록 "굵고 느린" 정도가 완화돼 실사격이 촘촘해진다.
 */
export function salvoDoctrineMultBp(level: number): number {
  return 20000 - Math.round((6000 * level) / (level + 10));
}

// --- 방벽(barrier) 축 -------------------------------------------------------

/** BR1 과충전 중 주기적으로 터지는 척력 펄스의 범위. */
export function staticRepulsorRadius(level: number): number {
  return 140 + 8 * level;
}

/** BR1 그 펄스가 적을 밀어내는 거리. */
export function staticRepulsorPush(level: number): number {
  return 20 + 3 * level;
}

/** BR2 피격 반격으로 터지는 전격 연쇄 피해. */
export function lightningRodChainDamage(level: number): number {
  return 15 + 4 * level;
}

/** BR3 방벽 액티브 지속 중 받는 피해 **감소** bp. */
export function phaseCouplingCutBp(level: number): number {
  return 1500 + 100 * level;
}

/** BR4 과충전 상한 초과분이 쌓이는 피해 흡수량의 상한. */
export function surplusShieldCap(level: number): number {
  return 20 + 4 * level;
}

/** BR5 벽에 붙어 정지 중 받는 피해 **감소** bp. */
export function groundTetherCutBp(level: number): number {
  return 1200 + 120 * level;
}

/** BR6 빈사 피격 시 과충전 전량을 태워 회복하는 비율(**배율** bp). */
export function chargeBackflowHealBp(level: number): number {
  return 500 + 50 * level;
}

/** BR7 피격 피해가 과충전 게이지로 전환되는 비율(**배율** bp). */
export function bufferCondenserBp(level: number): number {
  return 5000 + 500 * level;
}

/** BR8 과충전 유지 중 체력 1 회복 **주기**(틱). 낮을수록 빠르다. */
export function repairPeriodTicks(level: number): number {
  return 20 + Math.floor(1200 / (level + 14));
}

/** BR9 무적 중 몸 주변 적탄 소거 범위. */
export function repulseHullRadius(level: number): number {
  return 32 + 4 * level;
}

/** BR10 치명 무효화 발동 시 추가되는 무적 틱. */
export function terminalGroundIframes(level: number): number {
  return 2 + Math.floor(level / 2);
}
