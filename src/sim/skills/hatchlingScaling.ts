/**
 * 해츨링 스킬의 **레벨 스케일 정본** — 순수 함수만 (ADR-0049).
 *
 * 존재 이유·계약·bp 규약은 `strikerScaling.ts` 머리와 같다. ⚠️ 산술은 `hatchling.ts` 원본에서
 * **그대로** 옮겼다. 결정론 게이트와 `tests/skillHatchling.test.ts` 가 거동 불변을 증명한다.
 *
 * ## 이 기체를 읽는 데 필요한 세 가지
 * **병아리** — 적을 일정 수 처치하면 출격하는 소환물이고, 스스로 쏘다가 수명이 다하면
 * 사라진다. **부화 요구치** — 다음 병아리가 나오기까지 필요한 처치 수. **동시 출격 상한** —
 * 동시에 살아 있을 수 있는 병아리 수(기본 {@link BROOD_MAX_DRONES}).
 */

/** 동시 출격 기본 상한. BD10 이 −1, SH10 이 +1 한다(둘 다 레벨이 아니라 **투자 유무**다). */
export const BROOD_MAX_DRONES = 4;
/** BD7 이 세는 발사 횟수의 상한. 이 이상 쏴도 더 강해지지 않는다. */
export const VETERAN_SHOT_CAP = 40;
/** NU9 표식의 기본 자석 범위. */
export const BEACON_BASE_RADIUS = 70;
/** BD1 이 낮출 수 있는 부화 요구치의 바닥. */
export const HATCH_THRESHOLD_FLOOR = 6;

// --- 산란(brood) 축 ---------------------------------------------------------

/** BD1 부화 요구치 **감소량**(바닥 {@link HATCH_THRESHOLD_FLOOR} 까지). */
export function earlyHatchCut(level: number): number {
  return 1 + Math.floor(level / 5);
}

/** BD2 쌍둥이가 나오는 **주기**(N번째 출격마다 2기). 낮을수록 자주 나온다. */
export function twinHatchPeriod(level: number): number {
  return 2 + Math.round(18 / (level + 2));
}

/** BD3 병아리 소멸 시 남기는 작별 사격의 탄 수. */
export function farewellVolleyCount(level: number): number {
  return 3 + Math.floor(level / 4);
}

/** BD3 그 탄 1발의 피해. */
export function farewellVolleyDamage(level: number): number {
  return 6 + 2 * level;
}

/** BD4 공유 표적에 대한 병아리 탄 피해 **증분 비율**(0.15 = +15%). */
export function targetShareBonus(level: number): number {
  return 0.15 + 0.02 * level;
}

/** BD5 플레이어가 한 번 쏠 때 병아리 발사 쿨다운이 깎이는 양(틱). */
export function volleyResonanceCut(level: number): number {
  return 1 + Math.floor(level / 5);
}

/** BD6 출격 지점 충격파 범위. */
export function hatchShockwaveRadius(level: number): number {
  return 110 + 9 * level;
}

/** BD6 충격파 피해. */
export function hatchShockwaveDamage(level: number): number {
  return 12 + 3 * level;
}

/** BD7 그 병아리가 쏜 **1발당** 누적되는 피해 **증분 비율**(0.02 = +2%). */
export function veteranPerShot(level: number): number {
  return 0.02 + 0.002 * level;
}

/** BD9 출격 보류 중 병아리 발사 간격이 짧아지는 양(틱). */
export function overcrowdCut(level: number): number {
  return 2 + Math.floor(level / 4);
}

/** BD10 상한 결손 1당 병아리 탄 피해 **증분 비율**(0.3 = +30%). */
export function matriarchDamagePerDeficit(level: number): number {
  return 0.3 + 0.03 * level;
}

/** BD10 상한 결손 1당 병아리 수명 가산(틱). */
export function matriarchLifePerDeficit(level: number): number {
  return 60 + 10 * level;
}

// --- 양육(nurture) 축 -------------------------------------------------------

/** NU1 병아리 주변에 서는 자석장의 범위. */
export function gemFetchRadius(level: number): number {
  return 100 + 10 * level;
}

/** NU2 출격 시 흩어지는 알껍질 젬 수. */
export function eggshellGemCount(level: number): number {
  return 2 + Math.floor(level / 5);
}

/** NU3 대시가 병아리를 업어 나르는 폭(중심에서 좌우). */
export function piggybackHalfWidth(level: number): number {
  return 90 + 8 * level;
}

/** NU4 재배치 직후 연사 창에서 병아리 발사 간격이 짧아지는 양(틱). */
export function nestRecallCut(level: number): number {
  return 3 + Math.floor(level / 5);
}

/** NU7 젬 위치에서 부화할 때 인정하는 최대 거리. */
export function expeditionRange(level: number): number {
  return 400 + 40 * level;
}

/** NU9 소멸 자리에 남는 표식의 자석 범위. */
export function nestBeaconRadius(level: number): number {
  return BEACON_BASE_RADIUS + 4 * level;
}

/** NU10 만석 보류 중 저금되는 처치의 상한. */
export function eggBankCap(level: number): number {
  return Math.round(8 + (40 * level) / (level + 16));
}

// --- 보호(shelter) 축 -------------------------------------------------------

/** SH1 병아리 1기가 대신 소멸하며 흡수하는 피해. */
export function sacrificeAbsorb(level: number): number {
  return Math.round(8 + (60 * level) / (level + 18));
}

/** SH2 산개 돌진 거리. */
export function crisisScatterDash(level: number): number {
  return 90 + 6 * level;
}

/** SH2 산개 경로에서 적탄을 지우는 범위. */
export function crisisScatterClear(level: number): number {
  return 70 + 4 * level;
}

/** SH3 만석 유지 중 체력 회복 **주기**(틱). 낮을수록 빠르다. */
export function warmthPeriodTicks(level: number): number {
  return 60 + Math.floor(4800 / (level + 20));
}

/** SH4 품기 진형에서 병아리가 밀착하는 반경. */
export function broodingRadius(level: number): number {
  return 60 + 5 * level;
}

/** SH5 병아리 탄이 거는 냉기 감속의 **추가 지속**(기본 냉기 지속 위에 얹는다). */
export function alarmChirpExtraTicks(level: number): number {
  return 6 * level;
}

/** SH6 출격 순간 모선이 얻는 무적 시간(틱). */
export function eggMembraneIframes(level: number): number {
  return 20 + 3 * level;
}

/** SH7 회생 시 병아리 1기당 남는 체력. */
export function rebirthHpPerChick(level: number): number {
  return 4 + Math.round((16 * level) / (level + 12));
}

/** SH7 회생으로 남을 수 있는 체력의 상한(**배율** bp — 최대 체력에 곱한다). */
export function rebirthCapBp(level: number): number {
  return 3000 + 100 * level;
}

/** SH8 적탄이 병아리에 닿을 때 깎이는 수명(틱). 낮을수록 병아리가 오래 버틴다. */
export function featherBulwarkCost(level: number): number {
  return Math.max(1, 12 - Math.floor(level / 2));
}

/** SH9 수명이 다한 병아리가 남기는 둥지벽의 체력. */
export function fledgeNestHp(level: number): number {
  return 8 + 2 * level;
}

/** SH10 상한을 늘린 대가로 붙는 부화 요구치 **증가분**. 레벨을 올릴수록 줄어든다. */
export function expandedNestPenalty(level: number): number {
  return 6 - Math.floor(level / 4);
}
