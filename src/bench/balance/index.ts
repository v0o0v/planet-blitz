/**
 * 밸런스 하네스 **공개 표면**.
 *
 * `scripts/balance/{run,worker}.mjs` 가 이 모듈 하나만 import 한다(vite 로 단일 `.mjs` 번들로
 * 묶인다 — `vite.balance.config.ts`). 그래서 러너 쪽은 리포의 내부 경로를 전혀 모른다.
 *
 * 실행: `pnpm balance` (기본 10분 예산). 자세한 인자는 `scripts/balance/run.mjs` 머리말.
 */

export type { BalanceCell, AxisSelection, AxisValue, ResolvedAxes } from './axes.js';
export {
  cellKey,
  enumerateCells,
  fullCellCount,
  levelAxis,
  planetAxis,
  resolveAxes,
  shipAxis,
} from './axes.js';

export type { MetricDef, MetricKind, MetricTarget, RunTrace } from './metrics.js';
export { METRIC_KEYS, RUN_METRICS, gatedMetricKeys } from './metrics.js';

export type { CellRunResult } from './cell.js';
export { MAX_TICKS, runCellSeed } from './cell.js';

export type {
  CellStat,
  Dist,
  FoldAxis,
  FoldPoint,
  GateResult,
  GateViolation,
  MetricStats,
  RunRecord,
  SpreadSummary,
} from './aggregate.js';
export { cellStats, dist, evaluateGates, foldBy, spreadOf, statsOf } from './aggregate.js';

export type { RoundDecision, RoundDecisionInput } from './plan.js';
export { MIN_AXIS_POINTS, ROUND_SAFETY, affordableCells, decideNextRound, shrinkAxes } from './plan.js';

export type { ReportMeta } from './report.js';
export { renderReport } from './report.js';

export { CI_SEEDS, FIXED_SEEDS, seedAt, seedsUpTo } from './seeds.js';
