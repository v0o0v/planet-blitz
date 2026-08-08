/**
 * 마슈멜로우 스킬의 **레벨 스케일 정본** — 순수 함수만 (ADR-0049).
 *
 * 존재 이유·계약·bp 규약은 `strikerScaling.ts` 머리와 같다: sim 의 인라인 산술을 여기로 뽑아
 * **sim 과 연구소 화면이 같은 함수를 부른다.**
 *
 * ⚠️ 산술은 `mallow.ts`·`mallowStatus.ts` 원본에서 **그대로** 옮겼다(괄호·나눗셈 순서·반올림
 * 위치까지). 결정론 게이트와 `tests/skillMallow.test.ts` 가 거동 불변을 증명한다.
 *
 * ## 이 기체를 읽는 데 필요한 세 가지
 * **부채** — 받은 피해 중 당장 선체로 안 들어가고 미뤄 둔 몫이다. **정산** — 미뤄 둔 부채가
 * 한꺼번에 선체로 들어오는 순간이고, 무피격을 일정 틱 유지하면 온다. **탕감** — 정산 순간
 * 부채 일부가 선체에 닿지 않고 그냥 사라지는 것이다.
 *
 * ⚠️ 이 파일은 **상태를 안 읽는다.** 부채량·콤보 스택처럼 런 중에 변하는 값이 필요한 축은
 * "부채 1당 몇 bp" 같은 **단가**만 여기 두고, 곱셈은 sim 이 한다.
 */

// --- 짓뭉개기(squish) 축 ----------------------------------------------------

/** SQ1 부채 **1당** 볼리 피해 증폭 bp. 곱할 부채량은 sim 이 안다. */
export function debtFuryPerDebtBp(level: number): number {
  return 4 + level;
}

/** SQ1 의 증폭 상한 bp = 1000 + 3000×Lv/(Lv+10). Lv20 = 3000 · 점근 4000. */
export function debtFuryCapBp(level: number): number {
  return 1000 + (3000 * level) / (level + 10);
}

/** SQ2 청산 폭발 피해 비율(%) — 이번 정산으로 선체에 **실제 들어간** 양에 곱한다. */
export function settlementBlastPct(level: number): number {
  return 80 + 6 * level;
}

/** SQ2 청산 폭발 반경. */
export function settlementBlastRadius(level: number): number {
  return 180 + 10 * level;
}

/** SQ3 반격 피해 비율(%) — 이번 피격의 **즉시분**(실제로 hp 가 깎인 양)에 곱한다. */
export function bodyRecoilPct(level: number): number {
  return 60 + 8 * level;
}

/** SQ3 이 반격 대상을 찾는 반경. 레벨과 무관하다. */
export const BODY_RECOIL_RANGE = 260;

/** SQ4 명중한 적을 밀어내는 거리. 엘리트는 이 값의 절반만 밀린다. */
export function debtStampPush(level: number): number {
  return 12 + 3 * level;
}

/** SQ5 탕감된 양이 장전으로 들어가는 비율(%). */
export function forgivenessLoadPct(level: number): number {
  return 50 + 5 * level;
}

/** SQ5 볼리 1회가 장전 잔량에서 소모하는 비율(%). 레벨과 무관하다(하한 1). */
export const FORGIVENESS_USE_PCT = 25;

/** SQ6 개선된 환산율 — 부채 몇 당 청산 탄 1발인가. 낮을수록 탄이 많다. */
export function instantExchangePer(level: number): number {
  return Math.round(10 - (6 * level) / (level + 8));
}

/** SQ6 청산 탄에 실리는 탄당 피해 증폭 bp. */
export function instantExchangeDamageBp(level: number): number {
  return 1000 + 200 * level;
}

/** SQ6 이 청산 탄에 싣는 관통. 레벨과 무관한 고정값이다. */
export const INSTANT_EXCHANGE_PIERCE = 1;

/** SQ7 **완전 일치**(달리는 방향으로 정확히 쏠 때)의 탄속 증폭 bp. 일치도에 비례해 준다. */
export function momentumSpeedBp(level: number): number {
  return 1000 + 100 * level;
}

/** SQ7 **완전 일치**의 피해 증폭 bp. 일치도에 비례해 준다. */
export function momentumDamageBp(level: number): number {
  return 400 + 100 * level;
}

/** SQ8 누적 선체행 **1당** 볼리 피해 증폭 bp. */
export function scarCannonPerDamageBp(level: number): number {
  return 6 + 2 * level;
}

/** SQ8 의 증폭 상한 bp = 800 + 2400×Lv/(Lv+12). Lv20 = 2300 · 점근 3200. */
export function scarCannonCapBp(level: number): number {
  return 800 + (2400 * level) / (level + 12);
}

/**
 * SQ9 화상의 기준 피해. 원소 프리픽스 `flaming` 의 굴림 하한(`data/affixes.ts` `fireDmg` min)
 * 을 기준으로 잡은 보수적 선택이다 — 근거는 {@link interestBurnDamage} 원본 주석에 있다.
 */
export const SQ9_BURN_BASE = 2;

/** SQ9 가 부여하는 화상의 **틱당 피해** = round(기준 × (100 + 4×Lv) / 100). */
export function interestBurnDamage(level: number): number {
  return Math.round((SQ9_BURN_BASE * (100 + 4 * level)) / 100);
}

/** SQ9 의 만료·사망 1회당 부채 탕감량 = 3 + floor(Lv/2) (2레벨 폭 정수 계단). */
export function interestBurnForgive(level: number): number {
  return 3 + Math.floor(level / 2);
}

/** SQ10 만기 탄막의 **기본** 탄수. 정산액 파생분이 여기에 더해진다. */
export const MATURITY_VOLLEY_BASE = 6;

/**
 * SQ10 의 **정산액당 탄수 제수** = 30 − 20×Lv/(Lv+15). Lv1 = 28.75 · Lv20 ≈ 18.6 ·
 * 점근 10 — 레벨이 오를수록 같은 정산액에서 탄이 조밀해진다.
 */
export function maturityDivisor(level: number): number {
  return 30 - (20 * level) / (level + 15);
}

/** SQ10 만기 탄막의 1발 피해. */
export function maturityVolleyDamage(level: number): number {
  return 12 + 2 * level;
}

/** SQ10 만기 탄막의 관통·부채꼴 각도. 둘 다 레벨과 무관하다. */
export const MATURITY_VOLLEY_PIERCE = 2;
export const MATURITY_VOLLEY_ARC = 45;

// --- 봉합(mend) 축 ----------------------------------------------------------

/** ME1 젬 1개가 무피격 카운터를 추가로 밀어 주는 틱. */
export function earlyRepaymentTicks(level: number): number {
  return 2 + Math.floor(level / 2);
}

/** ME2 부채 **1당** 젬 자석 반경 확장 bp. */
export function debtMagnetPerDebtBp(level: number): number {
  return 6 + 2 * level;
}

/** ME2 확장 상한 bp = 3000 + 4000×Lv/(Lv+12). Lv20 = 5500 · 점근 7000. */
export function debtMagnetCapBp(level: number): number {
  return 3000 + (4000 * level) / (level + 12);
}

/** ME3 과금 주기 N = `1 + floor(Lv/6)` 틱 (Lv1~5 = 매 틱 · Lv20 = 4틱당 1 — 6레벨 폭 정수 계단). */
export function painlessDrivePeriod(level: number): number {
  return 1 + Math.floor(level / 6);
}

/** ME4 의 탕감→회복 전환율(%) = 20 + 60×Lv/(Lv+15). Lv20 = 54 · 점근 80. */
export function rebateTherapyPct(level: number): number {
  return 20 + (60 * level) / (level + 15);
}

/**
 * ME5 의 **이월분 탕감률** bp = 6000×Lv/(Lv+20). Lv1 ≈ 286 · Lv20 = 3000 · **점근 6000**
 * (= 여백의 최대 60% 만 잠식). 설계 정본 「레벨 스케일」의 여백 비례 점근형 그대로다.
 *
 * ⚠️ 이것은 **여백에 곱하는 율**이다. 실효 탕감률은 호출부가
 * `b + floor((10000 − b) × 이 값 / 10000)` 으로 합성한다 — `b` 는 그 정산에 실제로 쓰인
 * 탕감률(ME8 이 올려 둔 값)이라 여기서 알 수 없다.
 */
export function installmentForgiveBp(level: number): number {
  return (6000 * level) / (level + 20);
}

/** ME5 가 미루는 정산액의 비율. 레벨과 무관하게 절반(내림)이다. */
export const INSTALLMENT_DEFER_PCT = 50;

/** ME6 도착 지점 적탄 소거·냉기 반경. */
export function afterimageRinseRadius(level: number): number {
  return 140 + 10 * level;
}

/**
 * ME7 의 **소각액→자석 버프 틱** 전환율(%) = 60 + 40×Lv/(Lv+10).
 * Lv1 ≈ 63.6 · Lv20 ≈ 86.7 · 점근 100 — floor 로 접어 잔여를 버린다(신규 캐리 0).
 */
export function echoBondPct(level: number): number {
  return 60 + (40 * level) / (level + 10);
}

/** ME7 이 한 번에 열 수 있는 자석 버프 창의 상한(틱). 레벨과 무관하다. */
export const ECHO_BOND_TICK_CAP = 600;

/**
 * ME8 의 **실효 탕감률** bp = base + 3500 × (스택×Lv) / (스택×Lv + 120).
 * 10스택 Lv20 = 6000 + 3500×200/320 ≈ 8188 · **점근 base + 3500 = 9500 < 10000** —
 * 어떤 스택·레벨·어픽스 연장에서도 전액 탕감(부호 반전)에 닿지 않는다.
 *
 * ⚠️ `base` 는 호출부가 넘겨 주는 기본 탕감률이다 — 상수를 복제하지 않는다.
 */
export function rhythmForgivenessBp(base: number, stacks: number, level: number): number {
  const sl = stacks * level;
  return base + (3500 * sl) / (sl + 120);
}

/**
 * ME9 가 요구하는 **연속** 벽 접촉 틱(K = 60 고정).
 *
 * ⚠️ "정산 틱에 접촉" 이 아니라 **직전 60틱 연속 접촉**이다 — 사유는 원본 주석 참조.
 */
export const ME9_WALL_TICKS = 60;

/** ME9 의 임계 **인하폭**(틱) = round(20 + 50×Lv/(Lv+12)). Lv1 ≈ 24 · Lv20 ≈ 51 · 점근 70. */
export function fluffConvalescenceCut(level: number): number {
  return Math.round(20 + (50 * level) / (level + 12));
}

/** ME10 의 부채→XP 전환율(%) = 20 + 50×Lv/(Lv+10). Lv20 ≈ 53 · 점근 70. */
export function growthConversionPct(level: number): number {
  return 20 + (50 * level) / (level + 10);
}

/** ME10 이 한 번에 소각하는 부채의 비율. 레벨과 무관하게 절반(올림)이다. */
export const GROWTH_BURN_PCT = 50;

// --- 완충(cushion) 축 -------------------------------------------------------

/**
 * CU1 의 **대형 피해 임계**(절대 피해량) = round(40 − 25×Lv/(Lv+10)).
 * Lv1 ≈ 38 · Lv20 ≈ 23 · 점근 15 — 레벨이 오르면 더 작은 피해도 "대형" 으로 취급된다.
 *
 * ⚠️ **maxHp 비율이 아니라 절대값이다** — 사유는 원본 주석 참조.
 */
export function overloadThreshold(level: number): number {
  return Math.round(40 - (25 * level) / (level + 10));
}

/** CU2 의 부채 한도 비율(%) = round(25 + 30×Lv/(Lv+12)). Lv1 ≈ 27 · Lv20 ≈ 44 · 점근 55. */
export function debtCeilingPct(level: number): number {
  return Math.round(25 + (30 * level) / (level + 12));
}

/** CU3 의 회당 상한 비율(%) = round(30 − 18×Lv/(Lv+10)). Lv20 = 18 · 점근 12. */
export function painlessSettlementPct(level: number): number {
  return Math.round(30 - (18 * level) / (level + 10));
}

/** CU4 의 **기본** 적탄 소거 반경. 부채 비례 확장이 여기에 더해진다. */
export function recoilRinseRadius(level: number): number {
  return 70 + 6 * level;
}

/** CU4 부채 **1당** 반경 확장량. 확장분은 기본 반경의 2배까지만 붙는다. 레벨과 무관하다. */
export const RECOIL_RINSE_PER_DEBT = 2;

/**
 * CU5 의 **지속 중 지연율** bp = 6000 + 3500×Lv/(Lv+12). Lv1 ≈ 6269 · Lv20 ≈ 8188 ·
 * **점근 9500 < 10000** — 즉시분이 0 이 되는 특이점이 없다.
 */
export function fullDeferralBp(level: number): number {
  return 6000 + (3500 * level) / (level + 12);
}

/**
 * CU6 발동 시 세울 무적 틱 = 30 + 3×Lv.
 *
 * ⚠️ 실제 적용은 `max(통상 피격 무적, 이 값)` 이다 — 하한을 안 걸면 Lv1~3 의 무적이 통상
 * 피격 무적보다 짧아 효과가 통째로 무효가 된다(원본 주석이 근거).
 */
export function bankruptcyIframeTicks(level: number): number {
  return 30 + 3 * level;
}

/**
 * CU7 의 만충 감소량 K = 1500 + 3500×Lv/(Lv+12) bp.
 * Lv1 ≈ 1769 · Lv20 ≈ 3687 · **점근 5000**(= 최대 50%) — 어픽스로 레벨이 20 을 넘어도
 * 10000bp 에 닿지 못하므로 피해가 음수가 되는 특이점이 없다.
 */
export function healedHideMaxBp(level: number): number {
  return 1500 + (3500 * level) / (level + 12);
}

/** CU8 이 부채와 무관하게 얹는 **기본** 이속 bp. 레벨과 무관하다. */
export const PAIN_ANESTHESIA_BASE_BP = 400;

/** CU8 부채 **1당** 이속 증가 bp. */
export function painAnesthesiaPerDebtBp(level: number): number {
  return 2 + level;
}

/** CU8 의 이속 상한 bp = 1500 + 1500×Lv/(Lv+10). Lv20 = 2500 · 점근 3000. */
export function painAnesthesiaCapBp(level: number): number {
  return 1500 + (1500 * level) / (level + 10);
}

/** CU9 정산 순간에 서는 무적 틱. */
export function graceOfSettlementTicks(level: number): number {
  return 20 + 4 * level;
}

/** CU10 의 탕감→maxHp 전환율(%) = round(4 + 16×Lv/(Lv+16)). Lv20 ≈ 13 · 점근 20. */
export function capitalizationPct(level: number): number {
  return Math.round(4 + (16 * level) / (level + 16));
}

/** CU10 이 정산 1회에 올릴 수 있는 maxHp 의 상한. */
export function capitalizationPerSettle(level: number): number {
  return 3 + level;
}
