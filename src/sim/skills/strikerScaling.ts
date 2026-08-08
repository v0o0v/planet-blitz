/**
 * 스트라이커 스킬의 **레벨 스케일 정본** — 순수 함수만 (ADR-0049).
 *
 * ## 이 파일이 존재하는 이유
 * 연구소 화면이 스킬 수치를 보여 주려면(사용자 요청 2026-08-09 *"수치까지 포함해 선택할 수
 * 있게"*) 그 수치가 **어딘가에서 계산돼야** 한다. 후보가 셋이었다:
 *
 *  1. **설계서 문안을 옮겨 적는다**(`.omc/plans/skill-rebuild-2026-08-05/striker.md`).
 *     → ⛔ **설계서와 구현이 이미 갈려 있다.** F6 이 그 증거다 — 설계서는 「틱당 피해 +5%p/Lv」
 *     라고 적었는데 기준량이 없어 구현은 정수 계단(`1 + floor(Lv/4)`)으로 배선했고, sim 주석이
 *     *"설계서와 어긋나는 자리다"* 라고 명시해 두었다. 문안을 베끼면 **틀린 수치를 출고한다**.
 *  2. **화면이 자기 공식을 따로 적는다.** → ⛔ 이 리포가 반복해 대가를 치른 「같은 술어를 두
 *     곳에 적어 화면과 규칙이 갈리는」 형태 그 자체다. 밸런스 한 줄이 바뀌면 조용히 갈린다.
 *  3. **sim 의 인라인 산술을 이름 있는 순수 함수로 뽑아 sim 과 화면이 같은 것을 부른다.** ← 이것.
 *
 * 그래서 여기 있는 함수가 **유일한 정본**이다. `striker.ts` 가 이것을 부르고, 연구소 화면도
 * 이것을 부른다. 수치를 고치려면 여기 한 곳만 고치면 되고, 고치는 순간 화면이 따라온다.
 *
 * ## 계약
 * - **순수하다.** `WorldState` 를 안 읽고 RNG 를 안 쓴다 — 인자는 레벨(+ 필요 시 그 레벨과
 *   무관한 기준량)뿐이다. 그래서 UI 가 안전하게 부를 수 있다(sim 은 UI 를 모른다, ADR-0005).
 * - **산술이 sim 원본과 바이트 동일하다.** 이 파일은 뽑아낸 것이지 다시 쓴 것이 아니다 —
 *   괄호·나눗셈 순서·반올림 위치를 그대로 옮겼다. 결정론 게이트가 그것을 지킨다.
 * - **레벨 0 을 특별 취급하지 않는다.** 호출부(sim)가 `if (lv < 1) return` 게이트를 이미 갖고
 *   있고, 화면은 "Lv1 이면 얼마"를 물으므로 여기서 0 을 막으면 두 계약이 생긴다.
 *
 * ## bp 규약
 * 이름이 `...Bp` 인 것은 **basis-point**(10000 = ×1.00)다. 어떤 것은 *증분*(`+bp/10000` 을
 * 더한다)이고 어떤 것은 *배율*(`×bp/10000`)이라, 각 함수 doc 이 어느 쪽인지 명시한다 —
 * 이 구분을 틀리면 화면이 "+110%" 를 "+10%" 로 적는다.
 */

import { PI } from '../math.js';

/** 투자 상한. `data/ships/types.ts` 의 `SKILL_MAX_LEVEL` 과 같은 값이지만 sim 은 그것을 모른다. */
export const STRIKER_MAX_LEVEL = 20;

// ---------------------------------------------------------------------------
// 화력 (firepower)
// ---------------------------------------------------------------------------

/** F1 처치당 정조준 사이클 충전량. 4레벨 폭 정수 계단(Lv1 = 2 · Lv20 = 6). */
export function killMomentumCharge(level: number): number {
  return 1 + Math.ceil(level / 4);
}

/**
 * F2 집속 창 길이(틱). **대시 쿨다운의 비율**이라 기준 쿨다운을 인자로 받는다.
 *
 * 비율식인 근거가 설계서 F2 의 ⚠️ 다: 초판 `min(12+2×Lv, floor(쿨다운/2))` 는 대시를 강화할수록
 * 창이 줄어드는 역결합이었다. 비율이면 쿨다운이 줄 때 창도 함께 줄어 그 결합이 소멸한다.
 * 기본 쿨다운 42 기준 Lv1 ≈ 14 · Lv20 ≈ 20 · 점근 23.
 */
export function recoilWindowTicks(level: number, fullCooldownTicks: number): number {
  return Math.round((fullCooldownTicks * (3000 + (2500 * level) / (level + 10))) / 10000);
}

/** F2 창 내 볼리 피해 **증분** bp(+10% + 1%p/Lv). */
export function recoilDamageBp(level: number): number {
  return 1000 + 100 * level;
}

/** F2 창 내 탄속 **배율** bp(10000 = 등배 → Lv1 = ×1.11). 피해와 같은 계수를 쓴다. */
export function recoilSpeedMultBp(level: number): number {
  return 11000 + 100 * level;
}

/** F3 fanStrike 탄 피해 **증분** bp(+10% + 2%p/Lv). */
export function ventBurstBp(level: number): number {
  return 1000 + 200 * level;
}

/** F4 파편 폭발 반경. */
export function shatterRadius(level: number): number {
  return 60 + 6 * level;
}

/** F4 폭발 피해 = 탄 피해 × 이 bp(**배율**, 3000 = 30%). */
export function shatterDamageBp(level: number): number {
  return 3000 + 200 * level;
}

/** F5 콘 내 볼리 피해 **증분** bp(+6% + 1.5%p/Lv). */
export function sightlineDamageBp(level: number): number {
  return 600 + 150 * level;
}

/**
 * F5 조준선 콘의 **반각 20°**(설계서 고정값 — 레벨로 안 변한다).
 *
 * `PI / 9` 로 적는 것은 도수 리터럴을 라디안으로 바꾸는 사본을 만들지 않으려는 것이다.
 * `PI` 는 sim 결정론 leaf(`math.ts`)의 것이다 — `Math.PI` 로 바꾸지 마라(값은 같지만 leaf
 * 규율이 상수의 출처를 한 곳으로 묶는다).
 */
export const SIGHTLINE_CONE_HALF_RAD = PI / 9;

/** F6 부여 화상의 틱당 피해. 정수 계단(Lv1 = 1 · Lv20 = 6) — 설계서와 어긋나는 자리다(파일 머리). */
export function incendiaryBurnPerTick(level: number): number {
  return 1 + Math.floor(level / 4);
}

/** F6 잔여 화상 일괄 정산 **배율** bp(10000 = 100% + 5%p/Lv). */
export function incendiaryBurstMultBp(level: number): number {
  return 10000 + 500 * level;
}

/** F7 락온 스택 1개당 피해 **증분** bp(+3% + 0.5%p/Lv). 총 증분은 이 값 × 스택 수다. */
export function targetLockPerStackBp(level: number): number {
  return 300 + 50 * level;
}

/** F7 스택 상한. 문면에 상한이 없어 구현이 정했다 — 없으면 한 표적에 무한 증폭이 된다. */
export const TARGET_LOCK_STACK_CAP = 10;

/** F8 명중당 과열 창 연장 틱. 8레벨 폭 정수 계단(Lv1 = 1 · Lv20 = 3). */
export function overheatExtendTicks(level: number): number {
  return 1 + Math.floor(level / 8);
}

/** F8 이 늘릴 수 있는 과열 창 잔여의 천장. 없으면 창이 영영 안 닫힌다. */
export const OVERHEAT_EXTEND_CAP = 300;

/** F9 정조준탄 넉백 거리(좌표 직접 변위). 보스·엘리트는 이 값의 절반이다. */
export function suppressPush(level: number): number {
  return 24 + 4 * level;
}

/**
 * F10 후속 볼리 피해 **배율** bp(10000 = 등배).
 *
 * Lv1 = 4000(40%) · Lv20 = 6923(69%) · 점근 10000. 쌍곡선이라 저레벨 구간이 가파르다.
 */
export function extendedMagBp(level: number): number {
  return 10000 - Math.round(120000 / (level + 19));
}

// ---------------------------------------------------------------------------
// 생존 (survival)
// ---------------------------------------------------------------------------

/** S2 피격 시 적탄 소거 반경. */
export function reactivePlatingRadius(level: number): number {
  return 90 + 8 * level;
}

/** S3 엘리트 처치 시 회복 HP. */
export function fieldTriageHeal(level: number): number {
  return 4 + level;
}

/** S4 벽 접촉 중 피격 피해 **감소** bp(−10% − 1%p/Lv). */
export function coverDoctrineCutBp(level: number): number {
  return 1000 + 100 * level;
}

/** S5 해저드 피해 **감소** bp(−15% − 1.5%p/Lv). */
export function hazardCutBp(level: number): number {
  return 1500 + 150 * level;
}

/** S5 감속 장판 역전 후 이동 **배율** bp(11500 = ×1.15 → 감속이 가속이 된다). */
export function hazardSpeedMultBp(level: number): number {
  return 11500 + 150 * level;
}

/** S7 즉시 처치 임계 = 대상 최대 HP × 이 bp(**배율**, 500 = 5%). 자기 HP 30% 이하일 때만. */
export function lastRitesThresholdBp(level: number): number {
  return 500 + 50 * level;
}

/** S8 콤보 스택 1개가 흡수하는 피해. Lv20 = 23, 점근 43. */
export function comboAbsorbPerStack(level: number): number {
  return Math.round(3 + (40 * level) / (level + 20));
}

/** S9 생존 액티브 종료 시 적 이동 정지 틱. */
export function expiryStasisTicks(level: number): number {
  return 45 + 5 * level;
}

/** S9 정지 반경. */
export function expiryStasisRadius(level: number): number {
  return 160 + 12 * level;
}

/** S10 임계 1회당 최대 HP 증가량. Lv20 = 12, 점근 26. */
export function hullGrantHp(level: number): number {
  return Math.round(2 + (24 * level) / (level + 28));
}

/** S10 지급 임계(런 누적 획득 XP). 레벨 손잡이가 아니다. */
export const HULL_XP_THRESHOLD = 400;

// ---------------------------------------------------------------------------
// 기동 (mobility)
// ---------------------------------------------------------------------------

/** M1 출발 지점 폭발 반경. */
export function inertiaBurstRadius(level: number): number {
  return 120 + 10 * level;
}

/** M1 폭발 피해. */
export function inertiaBurstDamage(level: number): number {
  return 20 + 4 * level;
}

/** M2 대시 방향으로 까는 정지 탄 개수. 4레벨 폭 정수 계단(Lv1 = 2 · Lv20 = 7). */
export function thrustWakeCount(level: number): number {
  return 2 + Math.floor(level / 4);
}

/** M2 정지 탄 1발 피해. */
export function thrustWakeDamage(level: number): number {
  return 10 + 3 * level;
}

/** M2 정지 탄 수명(틱). */
export function thrustWakeLife(level: number): number {
  return 60 + 4 * level;
}

/** M2 정지 탄 배치 간격. 레벨 손잡이가 아니다. */
export const THRUST_WAKE_SPACING = 56;

/** M3 젬 1개 수거당 대시 쿨다운 감소 틱. 2레벨 폭 정수 계단(Lv1 = 2 · Lv20 = 12). */
export function gemRouteCut(level: number): number {
  return 2 + Math.floor(level / 2);
}

/** M4 진행 방향 전방 자석 반경 **배율** bp(13000 = ×1.30). */
export function slipstreamExtMultBp(level: number): number {
  return 13000 + 200 * level;
}

/**
 * M5 벽차기 추가 무적프레임(틱). 4레벨 폭 정수 계단(Lv1 = 2 · Lv20 = 7).
 *
 * ⚠️ 설계서는 "거리와 무적프레임이 강화된다"고 적었지만 **구현은 무적프레임만 만진다.**
 * 화면은 구현을 말한다 — 없는 거리 증가를 적으면 그것이 곧 거짓 표시다.
 */
export function wallKickIframes(level: number): number {
  return 2 + Math.floor(level / 4);
}

/** M6 대시 잔상 소거 반경(그 안의 적에게 냉기). */
export function dashPurgeRadius(level: number): number {
  return 150 + 10 * level;
}

/** M8 2단 도약 사이 자동 볼리의 피해 **배율** bp(Lv1 = 63% · Lv20 = 120%). */
export function vaultShotBp(level: number): number {
  return 6000 + 300 * level;
}

/** M9 무적프레임 중 몸통 충돌 피해. */
export function ramManeuverDamage(level: number): number {
  return 10 + 3 * level;
}

/** M10 2번째 대시 충전의 재충전 틱. Lv1 = 906 · Lv20 = 400 · 점근 240. */
export function twinRechargeTicks(level: number): number {
  return 240 + Math.floor(4000 / (level + 5));
}
