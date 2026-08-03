/**
 * 의뢰 런 **다구간 난이도 계측** 하네스 (계획 §Phase G · 밸런스 큐 §D).
 *
 * 계급별(1~4) 대표 구간 조합의 96시드 클리어율·소요 틱을 재고, 침공 밸런스 계측
 * (`tests/invasionBalance.test.ts`)과 같은 방법론으로 밴드에 앉힌다. 정예 소집령은
 * 파워업 0 전제라 다른 주문 계측에서 파생되지 않으므로 별도 기준선을 잰다(ADR-0043).
 *
 * ## 방법론은 **재사용**이다 — 새로 발명하지 않는다
 * - 96시드 좌표계는 `src/bench/balance/seeds.ts` 의 `FIXED_SEEDS` 를 그대로 쓴다(2026-08-01
 *   PR#232 가 시드 정본을 그 모듈로 옮겼다 — 여기서 새 배열을 만들면 정본이 둘이 된다). 침공
 *   밸런스·로스터 벤치와 같은 시드 좌표계를 공유해 "24시드 축 역전이 96시드에서 사라진다"는
 *   이 저장소의 반복 관측(로스터 커브·시드 램프 레인)을 이 계측도 그대로 적용받는다.
 * - 참조 입력은 `autopilotInput`(ADR-0008 순수 결정론 봇)이다. **니플헤임(행성 인덱스 2)은
 *   봇 한계로 클리어율이 인위적으로 나쁘게 나온다** — 일반 봇이 추격 모드의 무적 포식자에
 *   접촉해 죽는다(`.omc/plans/balance-queue.md` C-bis). 그래서 니플헤임을 포함한 구간을 가진
 *   런은 별도로 분리 집계한다(진짜 난이도가 아니라 측정 한계이기 때문).
 *
 * ## ⚠️ `buildRunConfig` 를 반드시 거친다 — 리터럴 config 금지
 * 의뢰 런에 `maxSegments: COMMISSION_WAVE_SEGMENTS_PER_SEGMENT` 를 찍는 곳은 그 함수뿐이다.
 * 리터럴 config 를 쓰면 이 필드가 빠져 **구간마다 PvE 웨이브 표를 보스 전까지 통째로 소화**해야
 * 하고, 그 결과 이 계측이 가장 신경 쓰는 틱 상한(`COMMISSION_SEGMENT_TICK_CAP`)이 구조적으로
 * 터진다(그리고 그 초과를 "진짜 난이도"로 오독하게 된다). `tests/commissionSegment.test.ts` 의
 * 좁은 헬퍼(`commissionCfg`)는 전환 코어 단위 테스트 전용이고 여기서는 쓰지 않는다.
 *
 * ## 실제 구간 생성 규칙은 SQL 이 정본이다
 * `supabase/migrations/20260803030000_commission_segment_rebalance.sql` 의
 * `issue_commission_for_run`(원본은 `20260803000000_commission_ledger.sql`):
 * `planet = random(0..5)` · `stage = 1 + random(0..grade-1)`(즉 **`[1, grade]`** — 2026-08-03
 * 밴드 복구 레인에서 `[1, grade+1]` 에서 좁혔다). {@link typicalSegments} 는 이 분포를 시드마다
 * 결정론적으로 재현한다(`Math.random` 아님 — 고정 PRNG).
 *
 * ## 실행 — 이 워크트리에는 `vite-node` 가 없다
 * `tests/commissionBandMeasure.test.ts` 가 이 모듈의 export 를 직접 호출해 계측을 수행하는
 * **영구** vitest 파일이다(로스터 벤치·침공 밸런스 선례와 동일 패턴). `main()` 은 참고용 CLI
 * 진입점이고 `isCliEntry()` 가 없으면 돌지 않는다(import 만으로 무거운 스윕이 실행되는 것을 막는다).
 */

import { createWorld } from '../sim/world.js';
import type { WorldState } from '../sim/world.js';
import { stepRun } from '../sim/commissionSegment.js';
import { autopilotInput } from '../sim/autopilot.js';
import { buildRunConfig } from '../run/runConfig.js';
import { defaultProfile, activeShip } from '../save/profile.js';
import type {
  CommissionGrade,
  CommissionOrder,
  CommissionRunConfig,
  SegmentSpec,
} from '../run/commission.js';
import {
  COMMISSION_SEGMENT_COUNT,
  COMMISSION_SEGMENT_TICK_CAP,
  commissionReplayBudgetTicks,
} from '../run/commissionConstants.js';
import { standardEquipped, standardSkillInvest } from './standardBuild.js';
import { FIXED_SEEDS as SEEDS } from './balance/seeds.js';

// ---------------------------------------------------------------------------
// 구간 생성 — SQL 규칙의 결정론 미러
// ---------------------------------------------------------------------------

/** SQL `PLANET_COUNT` 미러(카르곤·베르단·니플헤임·아르케·톡사르·크라스). */
const PLANET_COUNT = 6;

/** 봇 한계로 클리어율이 왜곡되는 행성(니플헤임 = 추격 모드 무적 포식자). */
const BOT_LIMITED_PLANET = 2;

/**
 * 결정론 PRNG(mulberry32 계열). `Math.random` 을 쓰지 않고도 SQL 의 균등분포 굴리기를
 * 시드마다 재현 가능하게 흉내 낸다 — sim 의 RNG 스트림과는 무관한 **계측 전용** 발생기다.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `typical` 모드 — 그 시드의 의뢰가 서버에서 실제로 굴렸을 법한 구간 조합을 근사한다.
 * SQL 과 같은 분포(`planet` 균등 0..5 · `stage` 균등 `[1, grade+1]`)를 시드로 결정론화했다.
 */
function typicalSegments(grade: CommissionGrade, seed: number): SegmentSpec[] {
  const n = COMMISSION_SEGMENT_COUNT[grade];
  const rand = mulberry32((seed ^ Math.imul(grade, 0x1000193)) >>> 0);
  const segs: SegmentSpec[] = [];
  for (let i = 0; i < n; i++) {
    segs.push({
      planet: Math.floor(rand() * PLANET_COUNT),
      // 단계 분포 `[1, grade]` — 2026-08-03 밴드 복구 레인에서 `[1, grade+1]` 에서 좁혔다.
      // SQL 미러: `20260803030000_commission_segment_rebalance.sql`. RNG 소비 횟수는 그대로라
      // 행성 추첨 수열은 바뀌지 않는다(구간 조합 대조가 유지된다).
      stage: 1 + Math.floor(rand() * grade),
    });
  }
  return segs;
}

/**
 * `max` 모드 — 틱 예산 스트레스 전용 대표 조합. 구간마다 그 계급이 낼 수 있는 **최고 단계**
 * (`grade + 1`, SQL 분포의 상단)를 고정해 "가장 오래 걸릴 조합"을 결정론으로 만든다.
 * 시드가 아니라 계급만으로 정해지므로 96시드 전체가 **같은 구간 조합**을 서로 다른 sim 시드로
 * 돈다 — 이 모드의 목적은 난이도 분산이 아니라 틱 상한 초과 여부이기 때문이다.
 *
 * 니플헤임(봇 한계)은 여기서 **제외**한다 — 이 모드는 "정상적으로 플레이 가능한 최악 조합"의
 * 틱 소요를 재는 것이 목적이고, 봇이 원리적으로 완주 못 하는 행성을 섞으면 틱 측정 자체가
 * 무의미해진다(사망 후 남은 구간은 아예 돌지 않는다).
 */
function maxSegments(grade: CommissionGrade): SegmentSpec[] {
  const n = COMMISSION_SEGMENT_COUNT[grade];
  // SQL 분포의 **상단** — 분포가 `[1, grade]` 로 좁아졌으므로 상단도 `grade` 다(2026-08-03).
  const stage = grade;
  const planets = [0, 1, 3, 4, 5];
  const segs: SegmentSpec[] = [];
  for (let i = 0; i < n; i++) {
    segs.push({ planet: planets[i % planets.length] as number, stage });
  }
  return segs;
}

/** 계측 모드 — `'typical'` 은 SQL 분포 근사, `'max'` 는 틱 예산 스트레스 대표 조합. */
export type CommissionBenchMode = 'typical' | 'max';

/** {@link typicalSegments}/{@link maxSegments} 진입점. */
export function commissionSegments(
  grade: CommissionGrade,
  mode: CommissionBenchMode,
  seed: number,
): SegmentSpec[] {
  return mode === 'max' ? maxSegments(grade) : typicalSegments(grade, seed);
}

// ---------------------------------------------------------------------------
// 대표 파일럿
// ---------------------------------------------------------------------------

/**
 * 계측용 대표 파일럿 레벨(밴드 10 = 커리어 중반, `standardBuild.ts` BAND_LEVELS[9]).
 *
 * ⚠️ **가정이다 — 보고 대상.** 의뢰서는 계급이 플레이어 레벨과 결부되지 않고 순수 RNG 로
 * 발령된다(SQL `v_roll`). 즉 "그 계급을 만났을 때 플레이어가 몇 레벨인가"는 설계상 정해져
 * 있지 않다. 이 계측은 침공 밸런스(`GEAR_REFERENCE` 고정)와 같은 철학으로 **파일럿을 고정하고
 * 계급/구간 축만 바꿔** 그 축 단독의 효과를 분리한다. 커리어 중반을 고른 것은 임의 선택이며,
 * 실제로는 낮은 계급(1)일수록 이른 레벨에 자주 만날 가능성이 높고 높은 계급일수록 후반 레벨에
 * 만날 가능성이 높다 — 그 상관을 이 계측은 반영하지 않는다.
 */
const PILOT_LEVEL = 50;

/** 대표 파일럿의 `Ship.equipped`/`skillInvest` 를 채운 프로필을 만든다. */
function commissionProfile(gearSeed: number, gearPlanet: number) {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = 0; // 스트라이커 — baseBp 전 축 0 인 중립 섀시(로스터 벤치 곡선 모드와 같은 선택).
  ship.skillInvest = standardSkillInvest(0, PILOT_LEVEL);
  ship.equipped = standardEquipped(PILOT_LEVEL, gearSeed, gearPlanet);
  return profile;
}

// ---------------------------------------------------------------------------
// 단일 런
// ---------------------------------------------------------------------------

/**
 * 안전판(설계 상한이 아니다) — **구간 수에 비례한 런 누적 허용 틱의 계수**다.
 * `src/bench/rosterBench.ts` 의 `MAX_TICKS`(저장소 표준 상한 18,000틱)와 같은 값이며,
 * `COMMISSION_SEGMENT_TICK_CAP`(9,000) 초과 여부를 **재려면** 그보다 오래 돌 수 있어야 하므로
 * 게이트 상수의 2배로 둔다.
 *
 * ⚠️ **이름이 시사하는 "구간당 상한"이 아니다.** 실제로는
 * `hardCap = segments.length * 이 값` 을 **런 누적 총량**(`while (totalTicks < hardCap)`)으로
 * 쓴다 — 한 구간이 폭주하면 나머지 구간은 틱을 0 받는다. 그래서 **폭주 런의 관측 최댓값은
 * 실제값이 아니라 절단된 하한**이다(2026-08-01 조정 **전** 계급2 elite 의 hardCap 은
 * 3×18,000 = 54,000 이고 보고된 최대 구간틱이 53,441 이었다 — 자연 관측이 아니라 안전판에
 * 부딪힌 값이며, 그 시드의 2·3구간은 아예 돌지 않아 초과 **건수도 과소계상**이다).
 * 조정 후에는 max 11,485 ≪ 54,000 이라 바인딩되지 않는다.
 */
const RUN_SAFETY_TICKS_PER_SEGMENT = 18000;

export interface CommissionRunOutcome {
  readonly win: boolean;
  /** 전 구간 누적 틱. */
  readonly totalTicks: number;
  /** 구간별 소요 틱(완주하지 못한 마지막 구간도 포함). */
  readonly segmentTicks: readonly number[];
  /**
   * 어느 구간이든 `COMMISSION_SEGMENT_TICK_CAP` 을 넘겼는가 — **1순위 확인 항목**.
   *
   * ⚠️ **밴드 집계는 이 필드를 읽지 않는다** — `measureCommissionBand` 이 `segmentTicks` 에서
   * 독립 재계산한다(같은 것을 두 경로가 계산하면 언젠가 갈린다). 여기 남긴 이유는 **단일 런
   * 디버깅**용이고, 판정 정본은 집계 쪽이다. 판정에 쓰려거든 둘 중 하나를 지워라.
   */
  readonly tickCapExceeded: boolean;
  /** 완전히 클리어(보스 처치 후 전환)된 구간 수. 승리 런은 전 구간. */
  readonly segmentsCleared: number;
  /** 이 런의 구간 중 니플헤임(봇 한계 행성)이 있었는가. */
  readonly touchesNiflheim: boolean;
}

/**
 * 의뢰 런 1회를 끝까지 돈다. **`buildRunConfig` 전량 경로**(파일 머리말 ⚠️ 참조).
 */
export function playCommissionRun(
  seed: number,
  grade: CommissionGrade,
  order: CommissionOrder,
  segments: readonly SegmentSpec[],
): CommissionRunOutcome {
  const first = segments[0];
  if (first === undefined) {
    throw new Error('playCommissionRun: 빈 구간 목록 — 의뢰는 무대 없이 성립하지 않는다');
  }
  const profile = commissionProfile(seed, first.planet);
  const commission: CommissionRunConfig = {
    commissionId: '00000000-0000-4000-8000-0000000cb3c4',
    order,
    grade,
    segments,
    replayBudgetTicks: commissionReplayBudgetTicks(grade),
    segmentIndex: 0,
  };
  let state: WorldState = createWorld(
    seed,
    buildRunConfig(profile, { planet: first.planet, stage: first.stage, commission }),
  );

  const touchesNiflheim = segments.some((s) => s.planet === BOT_LIMITED_PLANET);
  const hardCap = segments.length * RUN_SAFETY_TICKS_PER_SEGMENT;

  let totalTicks = 0;
  let segTicks = 0;
  let segmentsCleared = 0;
  let tickCapExceeded = false;
  const segmentTicks: number[] = [];

  while (totalTicks < hardCap) {
    const input = autopilotInput(state);
    const next = stepRun(state, input);
    totalTicks++;
    segTicks++;
    if (next !== state) {
      segmentsCleared++;
      segmentTicks.push(segTicks);
      if (segTicks > COMMISSION_SEGMENT_TICK_CAP) tickCapExceeded = true;
      segTicks = 0;
    }
    state = next;
    if (state.gameOver || state.victory) break;
  }
  if (segTicks > 0) {
    segmentTicks.push(segTicks);
    if (segTicks > COMMISSION_SEGMENT_TICK_CAP) tickCapExceeded = true;
  }

  return {
    win: state.victory,
    totalTicks,
    segmentTicks,
    tickCapExceeded,
    segmentsCleared: state.victory ? segments.length : segmentsCleared,
    touchesNiflheim,
  };
}

// ---------------------------------------------------------------------------
// 통계
// ---------------------------------------------------------------------------

interface Dist {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

const EMPTY_DIST: Dist = { n: 0, mean: 0, sd: 0, p95: 0, p99: 0, max: 0 };

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx] as number;
}

function dist(values: readonly number[]): Dist {
  const n = values.length;
  if (n === 0) return EMPTY_DIST;
  let sum = 0;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  const sd = n > 1 ? Math.sqrt(acc / (n - 1)) : 0;
  const sorted = [...values].sort((a, b) => a - b);
  return { n, mean, sd, p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max };
}

/** 틱 상한 초과 1건 — 어느 시드·구간이 초과했고 니플헤임(봇 한계) 접촉 여부. */
export interface TickCapViolation {
  readonly seed: number;
  readonly segmentTicks: number;
  /** 봇 한계 행성(니플헤임)이 포함된 런인가 — 참이면 진짜 난이도 신호가 아니다(파일 머리말). */
  readonly touchesNiflheim: boolean;
}

/** 계급 하나(그리고 니플헤임 포함 여부)의 96시드 집계. */
export interface CommissionBandStat {
  readonly grade: CommissionGrade;
  readonly mode: CommissionBenchMode;
  readonly order: CommissionOrder;
  /** 96시드 전체 클리어율(%). */
  readonly winRate: number;
  /** 니플헤임을 포함하지 않은 시드만의 클리어율(%) — **진짜 난이도 신호**(파일 머리말 참조). */
  readonly winRateExNiflheim: number;
  readonly niflheimRunCount: number;
  /** 구간당 소요 틱 분포(전 구간·전 시드 합산, 니플헤임 포함). */
  readonly segmentTicks: Dist;
  /** 구간당 소요 틱 분포 — **니플헤임 접촉 구간 제외**. p99 판정은 이쪽을 본다. */
  readonly segmentTicksExNiflheim: Dist;
  /** 런 전체 누적 틱 분포. */
  readonly totalTicks: Dist;
  /** `COMMISSION_SEGMENT_TICK_CAP` 을 넘긴 (시드, 구간) 전체 목록(니플헤임 포함). */
  readonly tickCapViolations: readonly TickCapViolation[];
  /** 위 목록 중 니플헤임과 무관한 것만 — **하드 게이트가 보는 목록**(비어 있어야 한다). */
  readonly tickCapViolationsExNiflheim: readonly TickCapViolation[];
  readonly runCount: number;
}

/** 그 계급·모드·주문의 96시드 밴드를 잰다. */
export function measureCommissionBand(
  grade: CommissionGrade,
  mode: CommissionBenchMode,
  order: CommissionOrder = 'chain',
): CommissionBandStat {
  let wins = 0;
  let winsExNiflheim = 0;
  let niflheimRunCount = 0;
  const allSegTicks: number[] = [];
  const segTicksExNiflheim: number[] = [];
  const totalTicksArr: number[] = [];
  const violations: TickCapViolation[] = [];

  for (const seed of SEEDS) {
    const segments = commissionSegments(grade, mode, seed);
    const outcome = playCommissionRun(seed, grade, order, segments);
    if (outcome.win) {
      wins++;
      if (!outcome.touchesNiflheim) winsExNiflheim++;
    }
    if (outcome.touchesNiflheim) niflheimRunCount++;
    totalTicksArr.push(outcome.totalTicks);
    for (const t of outcome.segmentTicks) {
      allSegTicks.push(t);
      if (!outcome.touchesNiflheim) segTicksExNiflheim.push(t);
      if (t > COMMISSION_SEGMENT_TICK_CAP) {
        violations.push({ seed, segmentTicks: t, touchesNiflheim: outcome.touchesNiflheim });
      }
    }
  }

  const nonNiflheimCount = SEEDS.length - niflheimRunCount;
  return {
    grade,
    mode,
    order,
    winRate: (wins / SEEDS.length) * 100,
    winRateExNiflheim: nonNiflheimCount > 0 ? (winsExNiflheim / nonNiflheimCount) * 100 : 0,
    niflheimRunCount,
    segmentTicks: dist(allSegTicks),
    segmentTicksExNiflheim: dist(segTicksExNiflheim),
    tickCapViolationsExNiflheim: violations.filter((v) => !v.touchesNiflheim),
    totalTicks: dist(totalTicksArr),
    tickCapViolations: violations,
    runCount: SEEDS.length,
  };
}

/**
 * 정예 소집령(ADR-0043) 별도 기준선 — 파워업 0 전제라 다른 주문 계측에서 파생되지 않는다.
 * `grade` 미지정 = 2(우선, 계급 분포의 중앙값 근처). 대표 계급 하나만 잰다 — 이 주문의
 * 정체성은 계급별 구간 난이도가 아니라 "성장 없이 완주 가능한가" 자체이기 때문이다.
 */
export function measureEliteBand(
  grade: CommissionGrade = 2,
  mode: CommissionBenchMode = 'typical',
): CommissionBandStat {
  return measureCommissionBand(grade, mode, 'elite');
}

// ---------------------------------------------------------------------------
// 마크다운
// ---------------------------------------------------------------------------

function f1(v: number): string {
  return v.toFixed(1);
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

/** {@link measureCommissionBand} 결과 배열을 연구 문서에 붙일 수 있는 표로 렌더한다. */
export function renderCommissionBandMarkdown(bands: readonly CommissionBandStat[]): string {
  const L: string[] = [];
  L.push(
    '| 계급 | 모드 | 주문 | 클리어율(96) | 클리어율(니플헤임제외) | 니플헤임런 | 구간틱 평균±sd (max) | ' +
      '구간틱 p95/p99(니플헤임제외) | 런틱 평균±sd | 상한초과(총) | 상한초과(니플헤임제외) |',
  );
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of bands) {
    L.push(
      `| ${b.grade} | ${b.mode} | ${b.order} | ${pct(b.winRate)} | ${pct(b.winRateExNiflheim)} | ` +
        `${b.niflheimRunCount}/${b.runCount} | ${f1(b.segmentTicks.mean)}±${f1(b.segmentTicks.sd)} (${b.segmentTicks.max}) | ` +
        `${f1(b.segmentTicksExNiflheim.p95)}/${f1(b.segmentTicksExNiflheim.p99)} | ` +
        `${f1(b.totalTicks.mean)}±${f1(b.totalTicks.sd)} | ${b.tickCapViolations.length}건 | ` +
        `${b.tickCapViolationsExNiflheim.length}건 |`,
    );
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// main — 참고용. 이 워크트리는 vite-node 가 없어 실제 실행은 vitest 파일에서 한다.
// ---------------------------------------------------------------------------

function main(): void {
  const bands: CommissionBandStat[] = [];
  for (const grade of [1, 2, 3, 4] as const) {
    bands.push(measureCommissionBand(grade, 'typical'));
    bands.push(measureCommissionBand(grade, 'max'));
    console.error(`[commissionBench] grade ${grade} 완료`);
  }
  bands.push(measureEliteBand());
  console.log(renderCommissionBandMarkdown(bands));
}

function isCliEntry(): boolean {
  const argv = (globalThis as { process?: { argv?: readonly string[] } }).process?.argv ?? [];
  const entry = argv[1] ?? '';
  return entry.endsWith('commissionBench.ts') || entry.endsWith('commissionBench.js');
}

if (isCliEntry()) main();
