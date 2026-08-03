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
import { metaXpPerRun } from '../save/progressionPath.js';

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
 * 의뢰서 **발령 자격의 개연성 하한** — 보스를 잡은 승리 런이 물리적으로 가질 수 없는 길이를
 * 자격에서 배제한다. `finalTick`(= `replay.inputs.length`, `src/net/pveRun.ts`)이 이 값보다
 * 작으면 승리 주장을 위조로 보고 발령하지 않는다.
 *
 * ## ⚠️ 이 축에서 **유일하게 정직한 사용자를 벌할 수 있는 상수**다
 * 너무 크면 정직한 속공 런이 의뢰서를 **아예 못 받는다**(발령 자체가 안 된다). 그래서 실측
 * 최소값보다 **충분히 낮게(보수적으로 작게)** 잡는다. 반대로 0 에 가까우면 방어가 사라진다.
 *
 * ## 실값 60 의 근거 — sim 실측 (2026-08-01)
 * 6행성 × 7기체 × 5시드 · stage 1 · Lv100 만렙 표준 최대화력 빌드 210런 중 승리 156건:
 * **최소 195틱(3.25초)** · p1 215 · p5 272 · p10 440 · p50 782.
 * 60 은 관측 최소의 **약 31%** 다.
 *
 * **왜 이렇게 낮게 잡아도 방어가 안 죽는가**: 위조 처리량을 실제로 묶는 것은 이 상수가 아니라
 * `CAP_ISSUE_ATTEMPTS_PER_HOUR`(20/h) 다. 상한은 "20/h" 와 "실시간 ÷ 이 상수" 중 **작은 쪽**인데,
 * 60틱(1초)이면 후자가 시간당 3,600 이라 **전자가 항상 먼저 문다.** 즉 이 상수를 낮추는 비용은
 * 사실상 0 이고, 이 상수가 실제로 하는 일은 `finalTick: 1` 같은 퇴화 입력이 쿨다운을 **문자
 * 그대로 0** 으로 만드는 것을 막는 것뿐이다. 그 역할에는 60 으로 충분하다.
 *
 * ⚠️ **자인**: 195 는 "관측된" 최소이지 이론적 하한이 아니다(시드 5개·표준 빌드 1종). 그리고
 * niflheim(추격 모드)은 **측정하지 못했다** — 측정용 파일럿이 무적 포식자를 표적으로 삼아 전멸해
 * 승리 표본이 0 이다. 두 사실 모두 "실제 하한은 더 낮을 수 있다"를 가리키므로 여유를 크게 잡았다.
 *
 * ## 왜 필요한가 — 쿨다운과 한 방어의 두 조각이다
 * 발령 쿨다운은 `claimed_final_tick` 에 비례하는 **누적 예약 지평**인데, 그 비례 계수는 클라가
 * 보내는 값이다. 하한이 없으면 공격자가 `finalTick: 1` 을 반복해 **쿨다운을 0 으로 고를 수
 * 있다.** 하한과 누적기는 독립 방어가 아니라 함께여야 성립한다 — 하한이 처리량 상한을
 * 공격자가 고르지 못하게 고정하고, 누적기가 그 상한을 실시간에 묶는다.
 *
 * 읽는 곳: 서버 `issue_commission_for_run` 2단계(SQL 미러 — **함께 갱신하라**) ·
 * `.omc/plans/balance-queue.md`(실측 근거).
 *
 * TICK_RATE = 60 이므로 값 ÷ 60 = 초.
 */
export const MIN_BOSS_KILL_TICKS = 60;

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

/**
 * 정예 겹침의 **절대 상한** — 압박이 누적돼도 동시 정예가 이 수를 넘지 않는다.
 * **플레이스홀더 6.**
 *
 * ⚠️ {@link COMMISSION_ELITE_OVERLAP_MIN} 은 **하한**(목표 겹침)이고 이것이 상한이다. 둘을 한
 * 상수로 겸하면 겹침이 하한에 영구 고정되어 ADR-0043 의 압박 누적이 성립하지 않는다 — 처음
 * 구현이 실제로 그랬고, `MIN` 이라는 이름을 상한으로 읽은 것이 원인이었다(이 레인이 `player.timer`
 * 로 한 번 당한 "이름으로 분류하기"의 재발).
 *
 * 읽는 곳: Phase D(`decideEliteDeploy`) · Phase G(정예 소집령 별도 기준선 계측).
 */
export const COMMISSION_ELITE_OVERLAP_MAX = 6;

/**
 * **정예 소집령 전용** 보스 전 웨이브 세그먼트 수 — {@link COMMISSION_WAVE_SEGMENTS_PER_SEGMENT}
 * 의 정예 소집령 오버라이드. **값 1 — 플레이스홀더가 아니라 96시드 실측으로 확정**했다
 * (2026-08-01 Phase G). 두 판정 기준을 동시에 만족한 값이다: 니플헤임 제외 p99 구간틱
 * 3,139(상한의 34.9%) · 클리어율 61.4%(목표 밴드 40~85%). 밸런스 큐 C10 은 이 실측으로 닫혔다.
 *
 * ⚠️ **미계측으로 남은 축**(큐 C-ter3): 이 값이 보스 전 처치 요구를 109 → 10 으로 **10.9배**
 * 낮췄다. 수치 기준은 통과했지만 "정예 6기 겹침 압박"이 구간당 실제로 몇 번 발현되는지는
 * 재지 않았다 — 겹침이 1~2회밖에 안 뜨면 ADR-0043 의 주문 정체성이 수치상 통과하면서
 * **체감상 사라진다.** 겹침 발생 횟수 카운터를 계측에 추가해야 확증된다.
 *
 * ## 왜 이 주문만 따로 낮췄는가
 * `COMMISSION_WAVE_SEGMENTS_PER_SEGMENT = 3` 은 `SEGMENTS[0..2]`(`data/waves.ts`)의
 * `killGoal` 합계(10+46+53=109)를 처치해야 보스가 나온다는 뜻이다. 그 표는 **카드 잡몹 밀도**를
 * 전제로 설계됐다 — `cardInterval` 마다 여러 마리가 한꺼번에 유입된다. 그런데 정예 소집령은
 * 잡몹 유입을 0 으로 막고(`commissionSuppressesCardSpawns`) 오직 겹침 소환(최대
 * `COMMISSION_ELITE_OVERLAP_MAX` 기 동시 · `COMMISSION_ELITE_OVERLAP_DELAY_TICKS` 간격)으로만
 * 킬을 공급한다. 즉 **카드 밀도용 처치 할당을 정예 트리클로 채우게 한 것**이 2026-08-01 Phase G
 * 실측이 잡은 근인이다 — 96시드 중 34시드가 `COMMISSION_SEGMENT_TICK_CAP` 을 넘겼고(최대
 * 53,441틱 = 상한의 5.9배) 전 구간의 대부분이 보스 이전 처치 할당 단계에서 지연됐다.
 *
 * ⚠️ **`COMMISSION_WAVE_SEGMENTS_PER_SEGMENT` 자체는 건드리지 않는다** — 그 상수는 `chain`·
 * `constraint`·`bounty` 3주문과 공유되고 그 셋은 96시드 실측에서 상한을 지켰다(니플헤임 봇
 * 한계 예외 제외). 문제는 상수가 아니라 **정예 소집령에 그 상수를 그대로 물린 배선**이었다.
 *
 * 읽는 곳: `src/run/runConfig.ts`(`buildRunConfig` 의뢰 경로 — `order === 'elite'` 분기) ·
 * Phase G(정예 소집령 별도 기준선 계측).
 */
export const COMMISSION_ELITE_WAVE_SEGMENTS = 1;

/**
 * 의뢰 **확정 경험치**의 계급 배율(천분율, 1000 = ×1.0).
 *
 * ## 왜 payload 에 새 필드를 두지 않는가 (2026-08-03)
 * 확정 보상의 계약은 "발령 시점에 굳는다"이지 "jsonb 에 적혀 있다"가 아니다. 이 값은 이미
 * 굳어 있는 `segments`(행성·단계)와 `grade` 만의 **순수 함수**라 발령 시점에 함께 굳고, 클라와
 * 서버가 같은 소스를 읽으므로 갈릴 수 없다. 반대로 필드를 새로 두면 ①마이그레이션과 원격
 * 배포가 필요하고 ②구 payload(version 1)에 값이 없어 분기가 생기며 ③같은 수치의 정본이 SQL 과
 * TS 두 곳이 된다 — 이 저장소의 지배적 실패 모드다.
 *
 * ## 왜 경험치를 아예 얹는가
 * 의뢰 런도 `settleRun` 을 타므로 **런 안에서 번 XP** 는 이미 들어온다. 그런데
 * **정예 소집령(ADR-0043)은 런 내 성장을 통째로 끈다** — 경험치 젬이 없어 그 주문의 메타 XP 가
 * 구조적으로 0 이다. 계급이 가장 높은 주문이 진행에 가장 적게 기여하는 역전이 생긴다.
 * 확정 경험치는 그 역전을 닫는다: 종이에 적힌 값이므로 런 안에서 무엇이 꺼져 있든 지급된다.
 *
 * 읽는 곳: {@link commissionXpReward}.
 */
export const COMMISSION_XP_GRADE_PERMILLE: Readonly<Record<CommissionGrade, number>> = {
  1: 1000,
  2: 1150,
  3: 1350,
  4: 1600,
};

/**
 * 이 의뢰의 **확정 경험치**(메타 XP) — 봉인된 payload 만의 순수 함수다.
 *
 * 기준선은 "그 무대를 한 번 정직하게 돈 값"이다: 구간마다
 * {@link metaXpPerRun}(그 구간의 침략 단계)을 더하고 계급 배율을 곱한다. 구간이 늘면 자연히
 * 늘고, 단계가 높으면 자연히 커진다 — 별도 표를 두지 않는 이유이자, 이 값이 정규 진행
 * (ADR-0035 표준 경로)과 같은 축 위에 있다는 뜻이기도 하다.
 *
 * ⚠️ **저단계 감쇠(`lowStageXpDecayPercent`)를 여기 곱하지 않는다.** 그 감쇠는 "만렙 근처
 * 파일럿이 1단계를 반복해서 파밍하는" 경로를 깎는 장치인데, 의뢰서는 반복 획득이 서버
 * 쿨다운(`MIN_BOSS_KILL_TICKS` · `CAP_ISSUE_ATTEMPTS_PER_HOUR`)에 이미 묶여 있어 그 경로가
 * 성립하지 않는다. 감쇠를 이중으로 걸면 "종이에 적힌 값과 실제로 들어온 값이 다르다"가 되고,
 * 확정 보상의 계약은 정확히 그것을 금지한다.
 *
 * 읽는 곳: `src/ui/pixi/commissionDeskView.ts`(표시) · `src/main.ts`(검증 확정 후 지급).
 */
export function commissionXpReward(payload: {
  grade: CommissionGrade;
  segments: readonly { stage: number }[];
}): number {
  let base = 0;
  for (const s of payload.segments) base += metaXpPerRun(s.stage);
  return Math.round((base * COMMISSION_XP_GRADE_PERMILLE[payload.grade]) / 1000);
}
