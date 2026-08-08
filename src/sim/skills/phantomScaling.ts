/**
 * 팬텀 스킬의 **레벨 스케일 정본** — 순수 함수만 (ADR-0049).
 *
 * 존재 이유·계약·bp 규약은 `strikerScaling.ts` 머리와 같다: sim 의 인라인 산술을 여기로 뽑아
 * **sim 과 연구소 화면이 같은 함수를 부른다.**
 *
 * ⚠️ 산술은 `phantom.ts`·`phantomEntry.ts` 원본에서 **그대로** 옮겼다(괄호·나눗셈 순서·반올림
 * 위치까지). 결정론 게이트와 `tests/skillPhantom.test.ts` 가 거동 불변을 증명한다.
 *
 * ## 이 기체를 읽는 데 필요한 세 가지
 * **무피격 스트릭** — 맞지 않고 버틴 틱이다. {@link CLOAK_UNHIT_TICKS} 에 닿으면 **은신 창**이
 * 열리고 {@link CLOAK_HOLD_TICKS} 만큼 유지된다. **해제 첫 타** — 은신 중 처음 쏘는 볼리이고
 * {@link CLOAK_BREAK_BP} 배율을 받는다. 피격은 스트릭을 0 으로 되돌린다.
 *
 * ⚠️ 이 파일은 **상태를 안 읽는다.** 스트릭·스택처럼 런 중에 변하는 값이 필요한 축은 그것을
 * 인자로 받는다({@link attenuationBp} · {@link tallyBpPerStack}).
 */

import { CLOAK_BREAK_BP, CLOAK_HOLD_TICKS } from '../shipSignature.js';

// --- 암살(assassin) 축 ------------------------------------------------------

/**
 * AS1 후속 배율 bp = `해제 첫 타 배율 × (0.3 + 0.6×Lv/(Lv+15))` — **총 배율**이다(가산이 아니다).
 *
 * ⚠️ **Lv1·Lv2 에서는 원배율보다도, 평타보다도 작다**(Lv1 = 0.84배 · Lv3 = 정확히 1.00배).
 * 설계 문면대로 적은 값이고 여기서 하한을 발명하지 않는다 — 없는 계단이 하나 는다.
 *
 * 나눗셈을 정수로 두 번 나눠 적는 것은 결정론 때문이다(f64 상수 `0.3`·`0.6` 을 곱하면 Lv 에
 * 따라 `floor` 가 갈릴 수 있다 — {@link frozenClockBudget} 과 같은 사유).
 */
export function twinMarkBp(level: number): number {
  const f = 3000 + Math.floor((6000 * level) / (level + 15));
  return Math.floor((CLOAK_BREAK_BP * f) / 10000);
}

/** AS2 은신 창 중 발사탄의 탄속 **배율** bp(10600 = ×1.06). */
export function cloakPierceSpeedBp(level: number): number {
  return 10600 + 150 * level;
}

/** AS2 가 은신 창 중 발사탄에 얹는 관통. 레벨과 무관한 고정값이다. */
export const CLOAK_PIERCE_ADD = 1;

/** AS3 강화탄에 실리는 관통 = ⌊Lv/5⌋ (Lv20 = +4, 5레벨 폭 정수 계단). */
export function executionReloadPierce(level: number): number {
  return Math.floor(level / 5);
}

/** AS4 만피 적 선타에 얹는 추가 피해 **비율** bp(이번 명중 실피해에 곱한다). */
export function vitalDissectionBp(level: number): number {
  return 1200 + 180 * level;
}

/** AS5 후방 반구 명중에 얹는 추가 피해 **비율** bp. */
export function backstabBp(level: number): number {
  return 1000 + 150 * level;
}

/**
 * AS7 원한 표적에 대한 추가 피해 **비율** bp = 2000 + 6000×Lv/(Lv+12)
 * (Lv1 ≈ 2462 · Lv20 ≈ 4727 · 점근 8000 — 연속 체감).
 */
export function grudgeAmplifyBp(level: number): number {
  return 2000 + Math.floor((6000 * level) / (level + 12));
}

/**
 * AS8 스택 상한 · 스택당 가산 bp.
 *
 * ⚠️ **둘 다 밸런스 각주다** — 설계 문면은 기구만 정하고 수치를 비웠다. Lv20·만스택에서
 * `20 × (100 + 25×20) = 12000`bp = +1.2배라, 원배율과 합쳐 유계다(무한 성장이 아니다).
 */
export const TALLY_STACK_CAP = 20;
export function tallyBpPerStack(level: number): number {
  return 100 + 25 * level;
}

/** AS9 명중 지점 폭발 피해 **비율** bp(그 첫 타 실피해에 곱한다). */
export function annihilationBlastBp(level: number): number {
  return 2500 + 150 * level;
}

/** AS9 명중 지점 폭발 반경. */
export function annihilationRadius(level: number): number {
  return 100 + 10 * level;
}

// --- 위상(phase) 축 ---------------------------------------------------------

/** PH1 대시 1회가 무피격 스트릭을 앞당기는 틱. */
export function afterimageExitAdvance(level: number): number {
  return 20 + 4 * level;
}

/** PH2 착지 지점 적탄 소거·냉기 반경. */
export function phaseLandingRadius(level: number): number {
  return 140 + 10 * level;
}

/** PH3 은신 창 중 젬 1개가 콤보 창에 더해 주는 틱. */
export function shadowLedgerComboAdd(level: number): number {
  return 2 + level;
}

/** PH4 은신 창 중 이동 속도 **배율** bp(10800 = ×1.08). */
export function tracelessStrideSpeedBp(level: number): number {
  return 10800 + 100 * level;
}

/**
 * PH5 창당 연장 예산 = `floor(은신 유지 틱 × Lv / 20)` 틱 (Lv1 = 6 · Lv20 = 120).
 *
 * ⚠️ **밸런스 각주다** — 설계 문면은 "유지 시간이 길어진다" 까지만 말하고 계단을 비웠다.
 * 기준을 유지 틱 파생으로 적은 것은 유계 때문이다: Lv20 에서 정확히 창 1개분(+100%)이다.
 */
export function extendedHoldBudget(level: number): number {
  return Math.floor((CLOAK_HOLD_TICKS * level) / 20);
}

/**
 * PH6 창당 정지 예산 = `min(12 + floor(2.4×Lv), 은신 유지 틱/2)` 틱.
 *
 * `2.4 × Lv` 를 f64 로 곱하지 않고 `floor(24×Lv/10)` 으로 적는 것은 **결정론** 때문이다 —
 * `2.4` 는 이진 부동소수로 정확히 표현되지 않아 Lv 에 따라 `floor` 가 갈릴 수 있다.
 *
 * 상한이 유지 틱의 절반인 것이 유계의 전부다: 창 하나가 스스로를 1.5배 이상 늘릴 수 없다.
 */
export function frozenClockBudget(level: number): number {
  const raw = 12 + Math.floor((24 * level) / 10);
  const cap = Math.floor(CLOAK_HOLD_TICKS / 2);
  return raw < cap ? raw : cap;
}

/** PH7 진입 폭발·적탄 소거 반경(둘이 같은 반경이다). */
export function entryFlashRadius(level: number): number {
  return 150 + 12 * level;
}

/** PH7 진입 폭발 피해. */
export function entryFlashDamage(level: number): number {
  return 15 + 3 * level;
}

/** PH8 젬 1개가 무피격 스트릭을 앞당기는 틱 = 1 + ⌈Lv/5⌉ (Lv20 = +5). */
export function traceSiphonAdvance(level: number): number {
  return 1 + Math.ceil(level / 5);
}

/** PH9 목표 활성 중 틱당 **추가로** 깎이는 대시 쿨다운 = 1 + ⌊Lv/10⌋ (Lv20 = 3). */
export function echoStalkCooldownCut(level: number): number {
  return 1 + Math.floor(level / 10);
}

/** PH10 은신이 깨질 때 **더해지는** 무적 틱 = 1 + ⌊Lv/4⌋ (Lv20 = 6). */
export function blownCoverIframeAdd(level: number): number {
  return 1 + Math.floor(level / 4);
}

// --- 교란(disrupt) 축 -------------------------------------------------------

/** DI1 적탄 소거의 **기본** 반경. 잃은 스트릭의 절반이 여기에 더해진다. */
export function phaseLiquidationRadius(level: number): number {
  return 40 + 4 * level;
}

/** DI1 반경에 더해지는 스트릭 비율. 레벨과 무관하게 절반(내림)이다. */
export const PHASE_LIQUIDATION_STREAK_DIV = 2;

/**
 * DI2 회복 주기(틱). 설계 고정값 — 진입 틱 공짜 회복을 없애려고 스트릭이 은신 임계를 **넘은**
 * 뒤부터 센다. 기본 창에서는 창당 정확히 1회다.
 */
export const MENDING_PERIOD = 60;

/** DI2 회복 1회당 HP. */
export function cloakedMendingHeal(level: number): number {
  return 2 + level;
}

/**
 * DI3 받는 피해 감소 bp = 6000×s/(s+2000), s = 무피격 스트릭 × (4+Lv).
 *
 * 스트릭이 인자인 것은 이 축이 "지금 얼마나 버텼는가" 에 걸려 있기 때문이다 — 레벨만으로는
 * 값이 정해지지 않는다.
 */
export function attenuationBp(streak: number, level: number): number {
  const s = streak * (4 + level);
  if (s <= 0) return 0;
  return Math.floor((6000 * s) / (s + 2000));
}

/** DI4 피격 시 주변 적을 밀어내는 거리. 보스·엘리트는 절반만 밀린다. */
export function repulsePush(level: number): number {
  return 60 + 8 * level;
}

/**
 * DI4 밀어내기 반경. **밸런스 각주다** — 설계 문면이 변위량만 정하고 반경을 비워 뒀다.
 * 여기 상수 하나로 모아 둔 것은 그때 고칠 자리를 하나로 만들기 위해서다.
 */
export const REPULSE_RADIUS = 220;

/** DI5 내부 쿨다운 = 3600 − 3600×Lv/(Lv+30) 틱 (Lv1 ≈ 3484 · Lv20 = 2160 · 점근 0·도달 없음). */
export function lastPhaseCooldownTicks(level: number): number {
  return 3600 - Math.floor((3600 * level) / (level + 30));
}

/** DI5 가 발동하는 체력 임계 비율(%). 레벨과 무관하다. */
export const LAST_PHASE_HP_PCT = 30;

/** DI6 벽 접촉 1틱이 무피격 스트릭을 앞당기는 틱 = 1 + ⌊Lv/10⌋ (Lv20 = 3). */
export function coverStalkAdvance(level: number): number {
  return 1 + Math.floor(level / 10);
}

/** DI7 진입 순간 냉기를 거는 반경. */
export function vanishingChillRadius(level: number): number {
  return 200 + 15 * level;
}

/** DI8 진입 1회당 최대 HP 영구 증가 = round(2 + 16×Lv/(Lv+24)). Lv1 = 3 · Lv20 = 9 · 점근 18. */
export function phaseSedimentHp(level: number): number {
  return Math.round(2 + (16 * level) / (level + 24));
}

/**
 * DI10 해제 첫 타 배율 **영구 가산** bp = 500 + 250×Lv (Lv1 = 750 · Lv20 = 5500).
 * 선형 — 20 초과 자연 연장.
 */
export function voidCovenantAddBp(level: number): number {
  return 500 + 250 * level;
}

/** DI10 대가 — 최대 HP 고정 −8%(레벨 무관). */
export const VOID_COVENANT_HP_CUT_BP = 800;
