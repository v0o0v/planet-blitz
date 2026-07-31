/**
 * 의뢰서 시스템 **상수 단일 정본** (계획 §Phase 0 · PA 레인 계약 §1).
 *
 * ## ⚠️ 여기 있는 수치는 **전부 플레이스홀더**다
 * 계급별 구간 수(2/3/4/5)와 구간당 틱 상한(9,000)은 Phase 0 의 **외삽**이다. 이 시점에
 * 배포된 EF 는 `verify-invasion` 뿐이고 침공은 `designedRun` 이라 청크 절차 생성·웨이브 유입을
 * 건너뛴다 — 즉 여기서 얻을 수 있는 것은 침공 워크로드 계수의 외삽이지 실측이 아니다.
 * **진짜 값은 Phase C 직후의 PC 실측 게이트가 정한다.** 값을 고칠 때 이 주석도 함께 갱신하라.
 *
 * ## 하드코딩 금지
 * Phase D~F 는 이 모듈을 읽는다. 같은 수치를 소비처에 다시 적으면 "여기만 고쳐서 안 먹는"
 * 결함이 열린다 — 이 저장소가 8번 겪은 실패 모드다. 그래서 각 상수에 **누가 읽는가**를
 * 주석으로 달아 둔다. 소비처가 늘면 그 목록도 늘려라.
 */

import type { CommissionGrade } from './commission.js';

/**
 * 계급별 구간 수 — **플레이스홀더**(정기 2 · 우선 3 · 특급 4 · 최종 5).
 *
 * 읽는 곳: Phase D(주문 4종의 `segments` 생성) · Phase B(`grant_commission` 이 payload 를
 * 굽는 서버 쪽 대응 상수) · Phase G(다구간 난이도 계측의 축).
 */
export const COMMISSION_SEGMENT_COUNT: Readonly<Record<CommissionGrade, number>> = {
  1: 2,
  2: 3,
  3: 4,
  4: 5,
};

/**
 * 구간당 리플레이 틱 상한 — **플레이스홀더 9,000틱**(60fps 기준 150초).
 *
 * 읽는 곳: {@link commissionReplayBudgetTicks} · Phase C(EF 의 CPU 예산 판정) ·
 * Phase G(구간 길이 계측).
 */
export const COMMISSION_SEGMENT_TICK_CAP = 9000;

/**
 * 정예 소집령(`order: 'elite'`)의 **겹침 임계** — 동시에 이 수 이상의 엘리트가 겹쳐야 주문
 * 조건을 만족한 것으로 본다. **플레이스홀더 2.**
 *
 * 읽는 곳: Phase D(정예 소집령 판정).
 */
export const COMMISSION_ELITE_OVERLAP_MIN = 2;

/**
 * 현상금 표적의 **HP 도주 임계**(centi-percent, 2000 = 20%). 표적 HP 가 이 아래로 떨어지면
 * 도주를 시작한다. **플레이스홀더.**
 *
 * 읽는 곳: Phase D(`escapeRule: 'hpThreshold'` 판정) · Phase F(의뢰 보스 거동).
 */
export const COMMISSION_BOUNTY_ESCAPE_HP_CENTI = 2000;

/**
 * 현상금 표적의 **생존 틱 도주 임계** — 표적이 이 틱수를 버티면 도주한다. **플레이스홀더
 * 1,800틱**(30초).
 *
 * 읽는 곳: Phase D(`escapeRule: 'surviveTicks'` 판정) · Phase F(의뢰 보스 거동).
 */
export const COMMISSION_BOUNTY_ESCAPE_SURVIVE_TICKS = 1800;

/**
 * 그 계급 의뢰의 리플레이 틱 예산 = 구간 수 × 구간당 상한.
 *
 * **파생을 함수로 둔 이유**: 예산을 계급별 표로 따로 적으면 구간 수를 고칠 때 예산 표가
 * 조용히 뒤처진다(같은 수치의 두 정본 = 이 저장소의 지배적 실패 모드). 여기서 한 번 곱한다.
 *
 * 읽는 곳: Phase D(payload 조립) · Phase B(서버 대조) · Phase C(EF 예산 게이트).
 */
export function commissionReplayBudgetTicks(grade: CommissionGrade): number {
  return COMMISSION_SEGMENT_COUNT[grade] * COMMISSION_SEGMENT_TICK_CAP;
}

// ---------------------------------------------------------------------------
// Phase D 추가분 — **파일 끝 append 전용.**
// 위 선언을 재배치하지 마라. 이 모듈은 병렬 레인과의 유일한 공유 편집 지점이라,
// 재배치는 다른 레인의 삽입 지점을 조용히 무너뜨린다.
// ---------------------------------------------------------------------------

/**
 * 정예 소집령의 **재집결 지연** — 필드에 정예가 **한 기도 남지 않은** 뒤 이 틱수가 지나야
 * 다음 정예를 투입한다. **플레이스홀더 240틱**(4초).
 *
 * ⚠️ 이것은 "고정 웨이브 타이머"가 아니다. ADR-0043 이 폐기한 것은 *생존 여부와 무관하게*
 * 주기적으로 적을 뱉는 타이머다. 여기서 시계가 도는 조건은 **직전 정예가 죽었다**는
 * 사건이며, 정예가 살아 있는 동안 이 값은 아무것도 하지 않는다.
 *
 * 읽는 곳: Phase D(정예 소집령 스포너).
 */
export const COMMISSION_ELITE_REGROUP_TICKS = 240;

/**
 * 정예 소집령의 **겹침 투입 간격** — 직전 정예가 살아 있어 겹침 게이트가 열려 있는 동안,
 * 연속 투입 사이의 최소 간격. **플레이스홀더 150틱**(2.5초).
 *
 * ⚠️ 이 값은 투입을 **구동하지 않는다.** 게이트(= 직전 정예 생존)가 닫혀 있으면 이 시계가
 * 아무리 흘러도 아무것도 나오지 않는다. 간격만 벌리는 값이라 A안(고정 간격 타이머)이 아니다.
 *
 * 읽는 곳: Phase D(정예 소집령 스포너).
 */
export const COMMISSION_ELITE_OVERLAP_DELAY_TICKS = 150;

/**
 * 의뢰 **구간 하나당 보스 전 일반 웨이브 세그먼트 수** — `WorldConfig.maxSegments` 로 실린다.
 * **플레이스홀더 3.**
 *
 * 왜 필요한가: 의뢰 구간의 종료 조건은 보스 격파다(`endCommissionSegment('cleared')`).
 * 상한을 안 걸면 구간마다 PvE 웨이브 표를 끝까지 소화해야 보스가 나와,
 * {@link COMMISSION_SEGMENT_TICK_CAP} 을 구조적으로 넘긴다.
 *
 * 읽는 곳: Phase D(`buildRunConfig` 의뢰 경로) · Phase G(구간 길이 계측).
 */
export const COMMISSION_WAVE_SEGMENTS_PER_SEGMENT = 3;
