/**
 * 의뢰 다구간 난이도 계측 CLI — **측정값을 찍기만 한다. 단언이 없다**(ADR-0051 갈래 ①).
 *
 * ## 실행
 *   node node_modules/.pnpm/vite-node@<버전>/node_modules/vite-node/vite-node.mjs bench/commissionBands.ts
 * (`<버전>` 은 `ls node_modules/.pnpm | grep '^vite-node'` 로 확인한다. `vite-node` 는 PATH 에 없다.)
 *
 * 축소 실행(배선 확인용, 시드 수를 줄인다):
 *   SEEDS=4 node .../vite-node.mjs bench/commissionBands.ts
 * 기본값은 96시드다. 전량은 십수 분 걸린다 — 계급 4개 x (typical + max) + 정예 = 9밴드를
 * 각각 96시드 돌린다.
 *
 * 출력은 **ASCII 전용**이다(PowerShell 콘솔 코드페이지가 UTF-8 이 아니면 한글이 깨진다).
 * 한글은 이 주석에만 쓴다.
 *
 * ## 왜 단언이 없는가
 * 예전 `tests/commissionBandMeasure.test.ts` 는 이 수치를 계약으로 굳혔다. 그런데 재는 대상이
 * **참조봇의 실력**이라 사람에게 무엇을 뜻하는지 아무도 모른다 — 그 파일 스스로 "니플헤임은
 * 봇 한계로 클리어율·틱 모두 왜곡된다"며 96시드 중 26런을 제외하고 있었다. ADR-0051 이
 * 단언을 내리고 도구만 남겼다.
 *
 * ## 무엇을 재는가
 * - **잰다**: 계급별 대표 구간 조합(SQL 분포 근사 `typical` + 틱 스트레스 대표 `max`)의
 *   클리어율·틱, 그리고 **`COMMISSION_SEGMENT_TICK_CAP` 초과 여부**. 초과가 1순위 확인
 *   항목이다 — 넘으면 클라는 무증상으로 돌다가 제출 시점에 서버 게이트에서 런 전체가 거부된다.
 * - **안 잰다**: 주문 4종 전체 교차(장비 제약·현상금 도주 등). 대표 주문(`chain`)과 정예
 *   소집령(ADR-0043 별도 기준선)만 다룬다.
 *
 * ## 읽는 법
 * - **니플헤임(행성 인덱스 2)은 봇 한계로 왜곡된다** — 추격 모드 승리 조건인 반격 장치에
 *   참조봇이 접촉사한다. 그래서 `exNif` 계열이 기준선이고 전체값은 정보용이다.
 * - 포함/제외 격차 실측 최대 18.2pp(계급3/chain: 전체 72.9% vs 제외 91.1%). 결함이 있던
 *   시절의 격차는 약 48pp 였다. **18.2pp 는 해소된 것이 아니라 등재된 것이다** — 의뢰
 *   다구간 런은 성장 없는 고정 화력 파일럿이 도는데(`commissionBench`), 반격 장치 HP 는
 *   레벨 대응 표준 빌드를 전제로 단계 앵커를 탄다(`chaseCounterDeviceHp`). 두 전제가
 *   어긋나 고계급 의뢰의 니플헤임 구간만 무겁다.
 * - **표본 하한을 먼저 봐라.** `dist([])` 는 `p99: 0` 을 돌려주므로, 니플헤임 제외 표본이 0 이면
 *   "측정할 게 없다"와 "전부 상한 아래다"가 같은 출력이 된다. 그래서 아래 표는 표본 수(n)를
 *   항상 같이 찍는다.
 * - **max 모드가 typical 보다 항상 오래 걸린다는 가설은 실측으로 기각됐다** — 어려운 조합일수록
 *   참조봇이 더 빨리 죽어(패배로 조기 종료) 오히려 구간틱 평균이 낮아지는 계급이 있다
 *   (계급3 실측: max 1151.3 < typical 1513.5).
 *
 * ## 정예 소집령 튜닝 (2026-08-01) — 이 계측이 그것을 잡았다
 * 최초 실측에서 정예 소집령이 96시드 중 34시드에서 구간틱 상한을 넘겼다(최대 5.9배, 니플헤임
 * 제외해도 27시드). 근인은 `COMMISSION_WAVE_SEGMENTS_PER_SEGMENT`(카드 잡몹 밀도 전제
 * killGoal 109)를 잡몹 유입이 0 인 정예 소집령에도 그대로 물린 배선이었다.
 * `COMMISSION_ELITE_WAVE_SEGMENTS`(`src/run/commissionConstants.ts`)로 그 주문만 낮은 상한을
 * 쓰게 갈랐다 — `buildRunConfig` 와 `verifyCommissionCore.ts` 양쪽 `order === 'elite'` 분기를
 * **반드시 쌍으로** 고쳐야 한다(서버 재실행이 다른 `maxSegments` 를 쓰면 정직한 런까지
 * outcome-mismatch 로 거부된다).
 * 튜닝 후 96시드 재측정(니플헤임 26런 제외): p95 2636 · p99 3139 · max 3215(상한의 35.7%) ·
 * 클리어율 61.4%. 대조로 `chain` 은 계급1~4 에서 83.3~95.7% 였다.
 */

import {
  COMMISSION_BENCH_SEEDS,
  measureCommissionBand,
  measureEliteBand,
  renderCommissionBandMarkdown,
} from '../src/bench/commissionBench.js';
import type { CommissionBandStat } from '../src/bench/commissionBench.js';
import { COMMISSION_SEGMENT_TICK_CAP } from '../src/run/commissionConstants.js';

const GRADES = [1, 2, 3, 4] as const;

/** `SEEDS=n` 으로 시드 수를 줄인다(배선 확인용). 미지정이면 96시드 전량. */
function resolveSeeds(): readonly number[] {
  const raw = process.env.SEEDS;
  if (raw === undefined || raw === '') return COMMISSION_BENCH_SEEDS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return COMMISSION_BENCH_SEEDS;
  return COMMISSION_BENCH_SEEDS.slice(0, Math.min(n, COMMISSION_BENCH_SEEDS.length));
}

function summarize(b: CommissionBandStat): string {
  const cap = COMMISSION_SEGMENT_TICK_CAP;
  const p99 = b.segmentTicksExNiflheim.p99;
  const capPct = cap > 0 ? ((p99 / cap) * 100).toFixed(1) : 'n/a';
  return (
    `grade ${b.grade} ${b.order.padEnd(5)} ${b.mode.padEnd(7)}` +
    ` | win ${b.winRate.toFixed(1).padStart(5)}%` +
    ` exNif ${b.winRateExNiflheim.toFixed(1).padStart(5)}%` +
    ` | nifRuns ${String(b.niflheimRunCount).padStart(3)}/${b.runCount}` +
    ` | segTicks exNif n=${String(b.segmentTicksExNiflheim.n).padStart(4)}` +
    ` mean ${b.segmentTicksExNiflheim.mean.toFixed(0).padStart(5)}` +
    ` p99 ${String(p99).padStart(5)} (${capPct}% of cap ${cap})` +
    ` | capViolations exNif ${b.tickCapViolationsExNiflheim.length}` +
    ` (all ${b.tickCapViolations.length})`
  );
}

function main(): void {
  const seeds = resolveSeeds();
  console.log('=== commission band measurement (ADR-0051 tool, no assertions) ===');
  console.log(`seeds: ${seeds.length} (of ${COMMISSION_BENCH_SEEDS.length})`);
  console.log(`segment tick cap: ${COMMISSION_SEGMENT_TICK_CAP}`);
  console.log('');

  const typical = GRADES.map((g) => measureCommissionBand(g, 'typical', 'chain', seeds));
  const maxMode = GRADES.map((g) => measureCommissionBand(g, 'max', 'chain', seeds));
  const elite = measureEliteBand(2, 'typical', seeds);
  const bands: readonly CommissionBandStat[] = [...typical, ...maxMode, elite];

  console.log('--- per-band summary ---');
  for (const b of bands) console.log(summarize(b));
  console.log('');

  console.log('--- niflheim include/exclude gap (pp) ---');
  console.log('gap was ~48pp when the chase-counter targeting defect was live; ~18pp is current');
  for (const b of bands) {
    if (b.niflheimRunCount === 0) {
      console.log(`grade ${b.grade} ${b.order} ${b.mode}: no niflheim sample (gap undefined)`);
      continue;
    }
    const gap = Math.abs(b.winRate - b.winRateExNiflheim);
    console.log(
      `grade ${b.grade} ${b.order.padEnd(5)} ${b.mode.padEnd(7)}` +
        ` | all ${b.winRate.toFixed(1).padStart(5)}%` +
        ` exNif ${b.winRateExNiflheim.toFixed(1).padStart(5)}%` +
        ` | gap ${gap.toFixed(1).padStart(5)}pp` +
        ` (nifRuns ${b.niflheimRunCount}/${b.runCount})`,
    );
  }
  console.log('');

  // 마크다운 표는 연구 문서에 그대로 붙일 수 있는 형태다(한글 헤더를 포함하므로 stdout 이
  // UTF-8 이 아닌 콘솔에서는 깨져 보인다 — 판정에는 위 ASCII 표를 쓴다).
  console.log('--- markdown table (for research docs; non-ASCII) ---');
  console.log(renderCommissionBandMarkdown(bands));
  console.log('done.');
}

main();
