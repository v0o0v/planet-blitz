/**
 * 버블 스킬의 **레벨 스케일 정본** — 순수 함수만 (ADR-0049).
 *
 * 존재 이유·계약·bp 규약은 `strikerScaling.ts` 머리와 같다: sim 의 인라인 산술을 여기로 뽑아
 * **sim 과 연구소 화면이 같은 함수를 부른다.**
 *
 * ⚠️ 산술은 `bubble.ts` 원본에서 **그대로** 옮겼다. 결정론 게이트와
 * `tests/skillBubble.test.ts` 가 거동 불변을 증명한다.
 *
 * ## 이 기체를 읽는 데 필요한 두 가지
 * **막** — 피해를 대신 먹는 이 기체의 보호막이고, 내구가 다하면 **파열**하며 주변을 밀어낸다.
 * 막이 없는 동안에는 재생 타이머가 돌아 다시 선다. 스킬 다수가 "막이 서 있는가 / 없는가 /
 * 파열하는 순간인가"를 조건으로 쓴다.
 */

// --- 파열(pop) 축 -----------------------------------------------------------

/** PO1 파열 즉발 폭발 피해. */
export function burstWarheadDamage(level: number): number {
  return 18 + 4 * level;
}

/** PO2 기준 탄속 초과분이 피해로 전환되는 비율(**배율** bp — 초과 bp 에 곱한다). */
export function pressureTransferBp(level: number): number {
  return 2000 + 200 * level;
}

/** PO3 파열 시 사출되는 거품탄 수. */
export function burstScatterCount(level: number): number {
  return 6 + Math.floor(level / 3);
}

/** PO3 거품탄 1발 피해. */
export function burstScatterDamage(level: number): number {
  return 8 + 2 * level;
}

/** PO4 벽에 막힌 적이 받는 충돌 피해(**배율** bp — 막힌 변위량에 곱한다). */
export function crushImpactBp(level: number): number {
  return 1500 + 200 * level;
}

/** PO5 막이 만재일 때 볼리 피해 **배율** bp(10600 = ×1.06). */
export function fullFilmDamageMultBp(level: number): number {
  return 10600 + 150 * level;
}

/** PO6 막이 없는 동안 주무기 명중 1회가 재생 타이머를 밀어 주는 양(틱). */
export function fireRecondenseStep(level: number): number {
  return 1 + Math.floor(level / 5);
}

/** PO7 파열 시 거는 전격 연쇄 피해(최대 3기). */
export function staticBurstChainDamage(level: number): number {
  return 12 + 3 * level;
}

/** PO8 파열 지점에 남는 정지 기뢰 수. */
export function residueMineCount(level: number): number {
  return 4 + Math.floor(level / 4);
}

/** PO8 기뢰 1개 피해. */
export function residueMineDamage(level: number): number {
  return 10 + 2 * level;
}

/** PO9 내구→탄약 환산으로 **추가로** 나가는 탄 비율(**배율** bp — 기준 탄수에 곱한다). */
export function popTuningExtraBp(level: number): number {
  return 400 + 100 * level;
}

/** PO10 파열 후 창 안의 처치 1기당 다음 막에 보강되는 내구. */
export function chainPressurePerKill(level: number): number {
  return 2 + Math.floor(level / 2);
}

/** PO10 그 보강의 상한. */
export function chainPressureCap(level: number): number {
  return 20 + 3 * level;
}

// --- 표류(drift) 축 ---------------------------------------------------------

/** DR1 파열 시 젬을 즉시 수거하는 범위 **배율** bp(파열 반경에 곱한다). */
export function reverseCurrentRadiusMultBp(level: number): number {
  return 10000 + 800 * level;
}

/** DR2 젬 수거로 열리는 흡수 효율 상승 창(틱). */
export function tensionWindowTicks(level: number): number {
  return 60 + 3 * level;
}

/** DR2 그 창 동안의 막 흡수 효율 **배율** bp(12000 = ×1.20). */
export function tensionBonusBp(level: number): number {
  return 10000 + 2000 + 200 * level;
}

/** DR3 도약 착지 시 자석 확장 버프의 지속(틱). */
export function blinkMagnetTicks(level: number): number {
  return 90 + 6 * level;
}

/** DR3 그 버프의 자석 범위 **배율** bp(13000 = ×1.30). */
export function blinkMagnetMultBp(level: number): number {
  return 13000 + 300 * level;
}

/** DR4 막이 없는 동안 이동 속도 **배율** bp(10400 = ×1.04). */
export function bareHullSpeedMultBp(level: number): number {
  return 10400 + 80 * level;
}

/** DR5 콤보 1스택이 자석 범위에 얹는 **증분** bp(총 증분 = 이 값 × 스택). */
export function prismPerStackBp(level: number): number {
  return 150 + 15 * level;
}

/** DR6 파열 시 환급되는 대시 쿨다운(틱). */
export function burstPropulsionRefund(level: number): number {
  return 30 + 5 * level;
}

/** DR8 기믹 픽업 접촉 범위 **증분** bp(자석 범위에 곱해 더한다). */
export function remoteForagerBp(level: number): number {
  return 1000 + 100 * level;
}

/** DR9 도약 출발 지점에 남는 잔파동의 기본 범위(막이 서 있으면 더 커진다). */
export function departureRippleRadius(level: number): number {
  return 100 + 8 * level;
}

/** DR10 막이 없는 동안 젬 흡인 속도 **증분** bp. */
export function bareHullCurrentBp(level: number): number {
  return 2000 + 300 * level;
}

/** DR10 재생 완료 시 걸리는 광역 견인 펄스의 1회 견인 거리. */
export function bareHullPullStep(level: number): number {
  return 60 + 6 * level;
}

// --- 응막(film) 축 ----------------------------------------------------------

/** FI1 파열 직후 재생 타이머가 시작하는 **선급 틱**. 클수록 막이 빨리 돌아온다. */
export function earlyCondenseTicks(level: number): number {
  return Math.round((300 * level) / (level + 18));
}

/** FI2 막이 서 있는 동안 내구 1 회복 **주기**(틱). 낮을수록 빠르다. */
export function recondensePeriodTicks(level: number): number {
  return 6 + Math.floor(72 / (level + 2));
}

/** FI3 막이 흡수한 틱에 주변 적탄을 지우는 범위. */
export function reflectiveFilmRadius(level: number): number {
  return 80 + 8 * level;
}

/** FI4 흡수량 1당 밀어내는 변위 **배율** bp(12000 = ×1.20). */
export function pressureVentPushBp(level: number): number {
  return 12000 + 1500 * level;
}

/** FI5 파열 틱의 무적 창에 **더해지는** 틱(기본 피격 무적 위에 얹는다). */
export function burstPhaseExtraIframes(level: number): number {
  return 6 + 2 * level;
}

/** FI6 불멸 막이 흡수한 총량 중 만료 폭발 피해로 가산되는 비율(**배율** bp). */
export function filmOfferingBp(level: number): number {
  return 4000 + 400 * level;
}

/** FI7 벽에 붙어 일어난 파열의 반경·변위 **배율** bp(11500 = ×1.15). */
export function wallEchoMultBp(level: number): number {
  return 11500 + 150 * level;
}

/** FI8 해저드 피해에 대한 막의 흡수 효율(**배율** bp — 20000 = 2배 효율). */
export function hydrophobicEffBp(level: number): number {
  return 20000 + 1000 * level;
}

/** FI9 치명 피격 시 재생 진행분을 비상막으로 바꾸는 비율(**배율** bp). */
export function lastBubbleShieldBp(level: number): number {
  return 6000 + 300 * level;
}
