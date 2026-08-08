/**
 * 브루저 스킬의 **레벨 스케일 정본** — 순수 함수만 (ADR-0049).
 *
 * 존재 이유·계약·bp 규약은 `strikerScaling.ts` 머리와 같다: sim 의 인라인 산술을 여기로 뽑아
 * **sim 과 연구소 화면이 같은 함수를 부른다.** 설계서를 베끼거나 화면이 자기 공식을 적으면
 * 조용히 갈린다.
 *
 * ⚠️ 산술은 `bruiser.ts` 원본에서 **그대로** 옮겼다(괄호·나눗셈 순서·반올림 위치 포함).
 * 결정론 게이트와 `tests/skillBruiser.test.ts` 가 거동 불변을 증명한다.
 *
 * ## 이 기체를 읽는 데 필요한 두 가지
 * **장갑 스택** — 피격·대시로 쌓이고 시간이 지나면 한 개씩 빠지는 이 기체의 고유 자원이다.
 * 여러 스킬이 "스택이 몇 개인가"를 조건이나 배수로 쓴다. **근접 임계** — 자동 조준 표적까지의
 * 거리가 이 값 이내면 "붙어 있다"로 판정한다.
 */

/** 장갑 스택 기본 상한. FO1 이 이 위에 얹는다. */
export const ARMOR_MAX_STACKS_BASE = 6;
/** 「붙어 있다」의 기준 거리. MO2·BL2 가 공유한다. */
export const POINT_BLANK_RANGE = 350;
/** MO6 압쇄장이 도는 주기(틱, 고정). */
export const CRUSH_FIELD_PERIOD = 30;
/** MO6 이 적을 밀어내는 1회 변위(고정). */
export const CRUSH_FIELD_PUSH = 6;
/** FO2 정산 회복 비율(고정 60% — 잔여 40%는 소멸한다). */
export const CLOT_SETTLE_BP = 6000;
/** FO7 런당 누적 가산 상한 = 런 시작 최대 체력의 이 비율(bp). */
export const TROPHY_RUN_CAP_BP = 5000;
/** FO6 경감의 대가 — 발동한 피격당 늘어나는 대시 쿨다운(틱, 고정). */
export const LOAD_TRANSFER_DASH_TICKS = 20;
/** MO3 이동 가속이 최대에 닿는 데 걸리는 시간(틱). */
export const MOMENTUM_FULL_TICKS = 120;

// --- 중장(blade) 축 ---------------------------------------------------------

/** BL1 반격 볼리 피해 **배율** bp(Lv1 = 52% · Lv20 = 90%). */
export function retortVolleyDamageBp(level: number): number {
  return 5000 + 200 * level;
}

/** BL2 근접 사격 피해 **증분** bp. */
export function pointBlankDamageBp(level: number): number {
  return 800 + 150 * level;
}

/** BL3 만재 상태에서 쏜 탄의 명중 폭발 피해 = 그 탄 피해 × 이 bp(**배율**). */
export function fullPlateBlastBp(level: number): number {
  return 2500 + 150 * level;
}

/** BL3 그 폭발의 범위. */
export function fullPlateBlastRadius(level: number): number {
  return 50 + 5 * level;
}

/** BL4 만재 피격 시 배출되는 파편 수. */
export function overflowVentCount(level: number): number {
  return 4 + Math.ceil(level / 3);
}

/** BL4 파편 1발의 피해. */
export function overflowVentDamage(level: number): number {
  return 8 + 2 * level;
}

/** BL5 돌진 절단 폭(중심에서 좌우). */
export function ramCleaveWidth(level: number): number {
  return 60 + 4 * level;
}

/** BL5 돌진 절단 피해. */
export function ramCleaveDamage(level: number): number {
  return 20 + 6 * level;
}

/** BL6 무거운 탄이 적을 밀어내는 거리. */
export function massSlugPush(level: number): number {
  return 16 + 2 * level;
}

/** BL6 무거운 탄의 피해 **증분** bp(대가로 탄속이 느려진다). */
export function massSlugDamageBp(level: number): number {
  return 2000 + 200 * level;
}

/** BL7 벽을 부술 때 나오는 충격파 파편 수. */
export function wallBreakerCount(level: number): number {
  return 3 + Math.ceil(level / 4);
}

/** BL7 그 파편 1발의 피해. */
export function wallBreakerDamage(level: number): number {
  return 12 + 4 * level;
}

/** BL8 담금질 탄 적립 상한. */
export function temperCap(level: number): number {
  return Math.round(1 + (5 * level) / (level + 10));
}

/** BL8 담금질 탄을 소모한 볼리의 선두 탄 추가 피해 **배율** bp. */
export function temperLeadBonusBp(level: number): number {
  return 6000 + 300 * level;
}

/**
 * BL9 확정 강타가 터지는 **명중 주기**. 장갑 스택이 많을수록 짧아진다.
 *
 * ⚠️ 레벨이 아니라 **스택**을 받는다 — BL9 의 손잡이는 레벨이 아니라 장갑이다.
 */
export function cadencePeriod(stacks: number): number {
  const n = Math.round(48 / (4 + stacks));
  return n >= 1 ? n : 1;
}

/** BL10 소각한 장갑 1스택당 환급되는 주무기 쿨다운(Q 고정소수점 — 1틱 = `FIRE_CD_Q`). */
export function burnOffRefundQ(level: number, fireCdQ: number): number {
  return 2 * fireCdQ + Math.round((fireCdQ * 2 * level) / 10);
}

// --- 기동(momentum) 축 ------------------------------------------------------

/** MO2 처치 젬을 즉시 견인하는 거리(근접 임계 위에 얹는다). */
export function wreckHarvestRange(level: number): number {
  return POINT_BLANK_RANGE + 10 * level;
}

/** MO3 같은 방향 이동이 최대로 쌓였을 때의 이동 속도 **증분** bp. */
export function heavyMomentumMaxBp(level: number): number {
  return 1000 + 300 * level;
}

/** MO4 감속 무효화의 전용 내부 쿨(틱). 낮을수록 자주 막는다. */
export function skidCooldownTicks(level: number): number {
  return Math.round(60 + 2400 / (level + 19));
}

/** MO5 돌진이 젬·픽업을 끌고 오는 폭(중심에서 좌우). */
export function haulBlinkWidth(level: number): number {
  return 80 + 6 * level;
}

/** MO6 압쇄장 범위. */
export function crushFieldRadius(level: number): number {
  return 120 + 8 * level;
}

/** MO6 압쇄 1회 피해. */
export function crushFieldDamage(level: number): number {
  return 4 + level;
}

/** MO7 벽·파괴물이 부서질 때 환급되는 대시 쿨다운(틱). */
export function debrisReclaimRefund(level: number): number {
  return 10 + 2 * level;
}

/** MO8 벽 되튐 대시가 즉시 환급하는 쿨다운 비율 bp(Lv20 ≈ 43% · 점근 50%). */
export function reboundRefundBp(level: number): number {
  return 3000 + Math.round((2000 * level) / (level + 10));
}

/** MO9 젬 수거 1회가 장갑 감쇠 타이머를 되감는 양(틱). */
export function harvestClampRewind(level: number): number {
  return 6 + 2 * level;
}

/** MO10 도착 충격파 범위. */
export function arrivalShockRadius(level: number): number {
  return 140 + 10 * level;
}

/** MO10 도착 충격파가 적을 밀어내는 거리. */
export function arrivalShockPush(level: number): number {
  return 20 + 2 * level;
}

// --- 요새(fortify) 축 -------------------------------------------------------

/** FO1 장갑 스택 상한 **증가분**(기본 상한 위에 얹는다). */
export function overPlatingBonus(level: number): number {
  return Math.round(1 + (3 * level) / (level + 12));
}

/** FO2 피격으로 잃은 체력 중 응혈 풀에 적립되는 비율(**배율** bp). */
export function clotPlatingBp(level: number): number {
  return 2000 + 100 * level;
}

/** FO3 몸통 접촉 피격 시 그 적에게 되돌리는 피해(**배율** bp). */
export function recoilReflectBp(level: number): number {
  return 2000 + 200 * level;
}

/** FO5 치명 무효화 발동 시 적탄을 소거하는 범위. */
export function unbreakableChainRadius(level: number): number {
  return 150 + 10 * level;
}

/** FO6 받는 피해 중 대시 쿨다운으로 전이해 깎는 비율(**감소** bp). */
export function loadTransferCutBp(level: number): number {
  return 800 + 80 * level;
}

/** FO7 엘리트·보스 격파 시 장갑 1스택당 늘어나는 최대 체력. */
export function trophyHpPerStack(level: number): number {
  return Math.round(1 + (6 * level) / (level + 14));
}

/** FO8 장갑 1스택이 감쇠로 사라질 때 전환되는 회복량. */
export function moltRegenHeal(level: number): number {
  return 3 + level;
}

/** FO9 빈사 상태에서 장갑 1스택이 깎아 주는 피해 **감소** bp(총 감소 = 이 값 × 스택). */
export function lastStandPerStackBp(level: number): number {
  return 20 + 5 * level;
}

/** FO10 만료 폭발이 거는 화상의 틱당 피해. */
export function cremationBurnPerTick(level: number): number {
  return 2 + level;
}
