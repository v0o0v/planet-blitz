/**
 * 의뢰 다구간 난이도 계측 — **영구 실행 파일** (계획 §Phase G · 밸런스 큐 §D).
 *
 * `src/bench/commissionBench.ts` 의 export 를 직접 호출해 계급별(1~4) 96시드 밴드 + 정예
 * 소집령 별도 기준선을 잰다. 이 워크트리에는 `vite-node` 가 없어(로스터 벤치·침공 밸런스와
 * 같은 사정) CLI 스크립트 대신 **영구 vitest 파일**로 계측을 실행한다 — 일회성 `tmp*` 스캐폴드가
 * 아니라 이 파일 자체가 재현 가능한 산출물이다(`corepack pnpm vitest run tests/commissionBandMeasure.test.ts`).
 *
 * ## 이 파일이 재는 것과 안 재는 것
 * - **잰다**: 계급별 대표 구간 조합(SQL 분포 근사 `typical` + 틱 스트레스 대표 `max`)의 클리어율·
 *   틱 소요, 그리고 무엇보다 **`COMMISSION_SEGMENT_TICK_CAP` 초과 여부**(1순위 확인 항목 —
 *   넘으면 클라는 무증상으로 돌다가 제출 시점에 서버 게이트에서 런 전체가 거부된다).
 * - **안 잰다**: 주문 4종 전체 교차(장비 제약·현상금 도주 등) — 이 레인은 대표 주문(`chain`)과
 *   정예 소집령(ADR-0043 별도 기준선)만 다룬다. 나머지 교차는 후속 레인 과제로 밸런스 큐에 남긴다.
 *
 * ## 정예 소집령 튜닝 (2026-08-01) — 이 파일이 그 회귀 게이트다
 * 최초 실측에서 정예 소집령이 96시드 중 34시드에서 `COMMISSION_SEGMENT_TICK_CAP` 을 넘겼다
 * (최대 5.9배, 니플헤임 봇 한계 제외해도 27시드). 근인은 `COMMISSION_WAVE_SEGMENTS_PER_SEGMENT`
 * (카드 잡몹 밀도 전제 killGoal 109)를 잡몹 유입이 0 인 정예 소집령에도 그대로 물린 배선이었다 —
 * `COMMISSION_ELITE_WAVE_SEGMENTS`(신설, `src/run/commissionConstants.ts`)로 그 주문만 낮은
 * 상한을 쓰게 갈랐다(`buildRunConfig`·`verifyCommissionCore.ts` 양쪽 `order === 'elite'` 분기 —
 * 서버 재실행이 다른 `maxSegments` 를 쓰면 정직한 런까지 outcome-mismatch 로 거부되므로 반드시
 * 쌍으로 고쳤다). 튜닝 후 96시드 재측정(니플헤임 26런 제외): p95 2636 · p99 3139 · max 3215
 * (상한의 35.7%) · 클리어율 61.4%. 아래 단언이 그 결과를 계약으로 굳힌다.
 *
 * ## 대조군
 * 96시드 좌표계는 침공 밸런스·로스터 벤치와 **공유**한다(`src/bench/rosterBench.ts` {@link SEEDS}).
 * 대조가 없는 측정은 아무것도 증명하지 못한다 — 여기서는 ①니플헤임 포함/제외 클리어율·틱 차이
 * ②`chain`(대표 주문, 83.3~95.7%) vs `elite`(61.4%) 클리어율 대조를 서로 대조로 쓴다.
 */

import { describe, it, expect } from 'vitest';
import {
  measureCommissionBand,
  measureEliteBand,
  renderCommissionBandMarkdown,
} from '../src/bench/commissionBench.js';
import type { CommissionBandStat } from '../src/bench/commissionBench.js';
import { COMMISSION_SEGMENT_TICK_CAP } from '../src/run/commissionConstants.js';

const GRADES = [1, 2, 3, 4] as const;

/**
 * 계측은 비싸다(계급당 96시드 × 구간 2~5개, typical+max 두 모드). 스위트 전체가 이 값을
 * 공유해 여러 단언이 같은 실행 결과를 본다(침공 밸런스 `measured` 선례와 같은 패턴).
 */
const TYPICAL: Record<(typeof GRADES)[number], CommissionBandStat> = {
  1: measureCommissionBand(1, 'typical'),
  2: measureCommissionBand(2, 'typical'),
  3: measureCommissionBand(3, 'typical'),
  4: measureCommissionBand(4, 'typical'),
};

const MAX_MODE: Record<(typeof GRADES)[number], CommissionBandStat> = {
  1: measureCommissionBand(1, 'max'),
  2: measureCommissionBand(2, 'max'),
  3: measureCommissionBand(3, 'max'),
  4: measureCommissionBand(4, 'max'),
};

const ELITE = measureEliteBand();

// 계측 직후 콘솔에 표를 남긴다 — `corepack pnpm vitest run tests/commissionBandMeasure.test.ts`
// 실행 로그가 그대로 연구 문서에 붙일 수 있는 형태가 되도록.
console.error(
  renderCommissionBandMarkdown([...GRADES.map((g) => TYPICAL[g]), ...GRADES.map((g) => MAX_MODE[g]), ELITE]),
);

describe('의뢰 다구간 난이도 계측 — 1순위: 틱 예산', () => {
  // ⚠️ 니플헤임(행성 인덱스 2)은 봇 한계로 클리어율·틱 모두 왜곡된다(추격 모드 무적 포식자에
  // 참조봇이 접촉사한다 — `.omc/plans/balance-queue.md` C-bis). 그래서 하드 게이트는
  // `tickCapViolationsExNiflheim` 만 본다. 니플헤임 포함 원 목록은 콘솔 표에 남긴다(정보용).
  it.each(GRADES)('계급 %d · typical 모드 — 니플헤임 제외 구간틱이 상한을 넘지 않는다', (grade) => {
    const band = TYPICAL[grade];
    expect(
      band.tickCapViolationsExNiflheim,
      `계급${grade} typical 상한(${COMMISSION_SEGMENT_TICK_CAP}) 초과(니플헤임 제외) ` +
        `${band.tickCapViolationsExNiflheim.length}건: ${JSON.stringify(band.tickCapViolationsExNiflheim)}`,
    ).toEqual([]);
  });

  it.each(GRADES)('계급 %d · max(스트레스) 모드 — 니플헤임 제외 구간틱이 상한을 넘지 않는다', (grade) => {
    const band = MAX_MODE[grade];
    expect(
      band.tickCapViolationsExNiflheim,
      `계급${grade} max 상한(${COMMISSION_SEGMENT_TICK_CAP}) 초과(니플헤임 제외) ` +
        `${band.tickCapViolationsExNiflheim.length}건: ${JSON.stringify(band.tickCapViolationsExNiflheim)}`,
    ).toEqual([]);
  });

  // 정예 소집령 — 2026-08-01 튜닝(`COMMISSION_ELITE_WAVE_SEGMENTS`) 이후의 회귀 게이트.
  // p99 가 상한 아래 **여유를 두고** 들어와야 한다(판정 기준 ① — 평균이 아니라 꼬리). 여유
  // 기준은 "p99 가 상한의 80% 미만"으로 못박는다 — 96시드보다 큰 실서버 트래픽에서 분포 꼬리가
  // 조금 더 늘어나도 흡수할 여지를 남긴다.
  // ⚠️ **표본 하한이 먼저다(리뷰 MAJOR-2).** `dist([])` 는 `p99: 0` 을 돌려주므로, 니플헤임
  // 제외 표본이 0 이면 아래 두 게이트가 **"측정할 게 없다"와 "전부 상한 아래다"를 같은 초록으로**
  // 낸다. 제외 규칙이 넓어지거나(봇 한계 행성 추가) 구간 생성기가 바뀌어 표본이 잠식되면 그
  // 순간 1순위 방어가 증거 0 으로 통과한다 — 그래서 표본 수 자체를 계약으로 굳힌다.
  it('정예 소집령 — 니플헤임 제외 표본이 판정 가능한 크기다(위 두 게이트의 전제)', () => {
    expect(
      ELITE.segmentTicksExNiflheim.n,
      `니플헤임 제외 구간 표본 ${ELITE.segmentTicksExNiflheim.n}개 — 너무 적어 p99 가 무의미하다`,
    ).toBeGreaterThanOrEqual(100);
    expect(
      ELITE.niflheimRunCount,
      `니플헤임 런 ${ELITE.niflheimRunCount}/${ELITE.runCount} — 제외가 표본 대부분을 삼켰다`,
    ).toBeLessThanOrEqual(40);
  });

  it('정예 소집령 — 니플헤임 제외 구간틱이 상한을 넘지 않는다(1순위)', () => {
    expect(
      ELITE.tickCapViolationsExNiflheim,
      `정예 소집령 상한(${COMMISSION_SEGMENT_TICK_CAP}) 초과(니플헤임 제외) ` +
        `${ELITE.tickCapViolationsExNiflheim.length}건: ${JSON.stringify(ELITE.tickCapViolationsExNiflheim)}`,
    ).toEqual([]);
  });

  it('정예 소집령 — p99 구간틱(니플헤임 제외)이 상한의 80% 아래(여유 있는 마진)', () => {
    const p99 = ELITE.segmentTicksExNiflheim.p99;
    expect(p99, `p99=${p99}, 상한=${COMMISSION_SEGMENT_TICK_CAP}`).toBeLessThan(
      COMMISSION_SEGMENT_TICK_CAP * 0.8,
    );
  });
});

/**
 * 니플헤임 포함/제외 클리어율의 허용 격차(pp) — **회귀 가드이지 목표치가 아니다.**
 *
 * 실측 최대 **18.2pp**(계급3/chain: 전체 72.9% vs 제외 91.1%, 니플헤임 51/96). 결함이 있던
 * 시절의 격차는 약 48pp 였다(그 무대 승률이 0 에 가까웠다). 25 는 그 사이를 가르는 값이다.
 *
 * ⚠️ **18.2pp 자체는 해소된 것이 아니라 등재된 것이다** — 의뢰 다구간 런은 성장 없는 고정
 * 화력 파일럿이 도는데(`commissionBench`), 반격 장치 HP 는 **레벨 대응 표준 빌드**를 전제로
 * 단계 앵커를 탄다(`chaseCounterDeviceHp`). 두 전제가 어긋나 고계급 의뢰의 니플헤임 구간만
 * 무겁다. 착수 조건과 다음 수는 `.omc/plans/balance-queue.md` §B8 에 있다.
 */
const NIFLHEIM_GAP_MAX_PP = 25;

describe('의뢰 다구간 난이도 계측 — 밴드 관측', () => {
  // ⚠️ **대조 없는 단언은 아무것도 증명하지 못한다.** `chain`(대표 주문, 계급1~4, typical 모드)은
  // 96시드 실측 니플헤임 제외 83.3~95.7% 로 사실상 항상 클리어되는 밴드다(계급4 가 최저 —
  // 구간 5개·상한 단계 5 라 계급 축의 순수 난이도가 가장 크다) — 이는 목표가 아니라 관측이다
  // (ADR 이 계급별 목표 클리어율을 명시하지 않았다). 여기서는 그 관측을 회귀 게이트로 굳힌다:
  // 니플헤임 제외 클리어율이 최소 80% 는 넘어야 한다(관측 최저 83.3% 에 여유를 둔 하한 — 이
  // 아래로 떨어지면 대표 구간 조합 생성기나 sim 에 실제 회귀가 난 것).
  it.each(GRADES)('계급 %d · chain(typical) 니플헤임 제외 클리어율이 80%% 이상이다', (grade) => {
    const rate = TYPICAL[grade].winRateExNiflheim;
    expect(rate, `계급${grade} 클리어율(니플헤임 제외) ${rate.toFixed(1)}%`).toBeGreaterThanOrEqual(80);
  });

  // ⚠️ **이게 통과하면서도 참일 수 있는 나쁜 상태**: 니플헤임 표본이 극단적으로 적으면(예:
  // 96시드 중 1~2개만 그 행성을 포함) 아래 비교가 노이즈에 가깝다. 표본 수를 함께 기록해
  // 사후 판정 가능하게 한다(콘솔 표의 "니플헤임런" 열).
  // ## 2026-08-01 — 이 검사의 **전제가 사라져서** 방향을 바꿨다
  //
  // 원래 이 자리는 "니플헤임 포함 런은 제외 런보다 클리어율이 낮거나 같다"였고, 근거는
  // **봇이 그 무대를 플레이하지 못한다**였다. 그 봇 한계의 실체는 추격 모드의 승리 조건인
  // 반격 장치가 `isPlayerTargetable` 에서 빠져 있어 **조준 자체가 불가능**했던 sim 결함이다
  // (`tests/chaseMode.test.ts` (c-2)). 결함을 고치자 니플헤임 클리어율이 18.6% → 74.7% 로
  // 올라 방향이 뒤집혔다(계급1/chain: 전체 94.8% vs 제외 92.1%).
  //
  // 그래서 **방향 단언을 폐기하는 대신 더 강한 단언으로 바꾼다**: 니플헤임이 더 이상
  // 제외해야 할 만큼의 이상치가 아니다(포함/제외 격차가 작다). 이 형태는 결함이 있던
  // 시절에는 통과할 수 없다 — 표본의 약 1/3 이 승률 0 에 가까우면 격차가 30pp 를 넘는다.
  // `winRateExNiflheim` 을 쓰는 나머지 단언들은 그대로 둔다(제외 계열이 계측의 기준선이라
  // 값의 연속성이 유지된다).
  it('니플헤임 포함/제외 클리어율 격차가 작다 — 더 이상 제외해야 할 이상치가 아니다', () => {
    // ⚠️ **독립 전사본(리뷰 MAJOR-3).** `GRADES.map` 으로만 돌면 측정한 9개 밴드 중 MAX_MODE
    //    4개가 조용히 빠진다 — 지금은 그쪽 니플헤임이 0 이라 무해하지만, `maxSegments()` 의
    //    행성 목록에 2 가 들어가는 순간 검사 없이 통과한다. 9개를 여기 적는다.
    const bands: readonly CommissionBandStat[] = [
      TYPICAL[1], TYPICAL[2], TYPICAL[3], TYPICAL[4],
      MAX_MODE[1], MAX_MODE[2], MAX_MODE[3], MAX_MODE[4],
      ELITE,
    ];
    // ⚠️ 전 밴드가 `continue` 로 빠지면 루프 본문이 한 번도 안 돌아 **단언 0건으로 통과**한다.
    //    "비교할 표본이 있었다"를 먼저 못 박는다.
    expect(
      bands.filter((b) => b.niflheimRunCount > 0).length,
      '니플헤임 표본이 있는 밴드가 하나도 없다 — 이 방향성 검사가 공허하다',
    ).toBeGreaterThan(0);
    for (const b of bands) {
      if (b.niflheimRunCount === 0) continue; // 그 밴드에 니플헤임 표본이 없으면 비교 불가 — 정상.
      expect(
        Math.abs(b.winRate - b.winRateExNiflheim),
        `${b.grade}/${b.order}: 전체 ${b.winRate.toFixed(1)}% vs 니플헤임 제외 ${b.winRateExNiflheim.toFixed(1)}% ` +
          `(니플헤임 런 ${b.niflheimRunCount}/${b.runCount})`,
      ).toBeLessThanOrEqual(NIFLHEIM_GAP_MAX_PP);
    }
  });

  it('정예 소집령 클리어율(니플헤임 제외)이 chain 보다 낮다 — 별도 기준선이되 아무 값이나는 아니다', () => {
    // ADR-0043 은 "다른 값을 가져도 된다"이지 "아무 값이나 된다"가 아니다(판정 기준 ②). 파워업
    // 0 전제라 chain 보다 어려운 것은 설계 의도이므로 **낮은 방향**만 계약으로 굳히고, "얼마나
    // 낮은가"는 아래 밴드 단언으로 별도로 못박는다.
    expect(ELITE.winRateExNiflheim).toBeLessThan(TYPICAL[ELITE.grade].winRateExNiflheim);
  });

  it('정예 소집령 클리어율(니플헤임 제외)이 40~85% 밴드 안에 있다(목표 밴드 — 2026-08-01 확정)', () => {
    // 튜닝 후 실측 61.4%. 상한 85 는 "정예" 라는 이름값을 지키기 위한 천장(그 이상이면 chain 과
    // 체감 차이가 사라진다), 하한 40 은 파워업 0 전제에서도 절반 가까이는 이겨야 "완주 가능성이
    // 살아 있다"(판정 기준 §1 의 정신)는 하한이다.
    expect(ELITE.winRateExNiflheim).toBeGreaterThanOrEqual(40);
    expect(ELITE.winRateExNiflheim).toBeLessThanOrEqual(85);
  });

  it('typical·max 모드 구간틱 평균이 둘 다 유한하고 계측이 크래시하지 않는다', () => {
    // ⚠️ 초기 가설("max 모드가 typical 보다 항상 오래 걸린다")은 실측으로 **기각됐다** —
    // 어려운 조합일수록 참조봇이 더 빨리 죽어(패배로 조기 종료) 오히려 구간틱 평균이 낮아지는
    // 계급도 있었다(계급3 실측: max 1151.3 < typical 1513.5). 그래서 여기서는 방향을 계약으로
    // 굳히지 않고 유한성만 확인한다 — 수치 비교는 연구 문서의 실측 표로 읽는다.
    for (const grade of GRADES) {
      expect(Number.isFinite(MAX_MODE[grade].segmentTicks.mean)).toBe(true);
      expect(Number.isFinite(TYPICAL[grade].segmentTicks.mean)).toBe(true);
    }
  });

  it('정예 소집령 기준선이 유한하고(완주 가능성이 살아 있고) 계측이 크래시하지 않는다', () => {
    // ⚠️ `runCount` 는 `SEEDS.length` 상수 복사라 96런이 전부 0틱 쓰레기를 내도 통과한다
    //    (리뷰 MINOR-1). 계측이 **실제로 돌았다**를 재려면 구간 표본 수를 봐야 한다 —
    //    런당 최소 1구간이므로 96 을 넘어야 한다.
    expect(ELITE.segmentTicks.n, '구간 표본이 런 수보다 적다 — 계측이 돌지 않았다').toBeGreaterThan(96);
    expect(Number.isFinite(ELITE.winRate)).toBe(true);
    expect(ELITE.segmentTicks.mean, '평균 구간틱이 0 — 빈 분포다').toBeGreaterThan(0);
  });
});
