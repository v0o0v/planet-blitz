/**
 * 집계 · 축 접기 · 게이트 판정 — 전부 **순수 함수**다.
 *
 * 러너(`scripts/balance/run.mjs`)는 런 결과를 모으기만 하고 해석은 여기서 한다. 그래서 같은
 * 런 기록(JSON)을 나중에 다시 집계할 수 있고, 집계 규칙 변경이 재측정을 요구하지 않는다.
 */

import type { BalanceCell } from './axes.js';
import { cellKey, planetAxis, shipAxis } from './axes.js';
import { METRIC_KEYS, RUN_METRICS, gatedMetricKeys, type FoldAxis } from './metrics.js';

export type { FoldAxis };

/** 런 1회의 원본 기록. 러너가 워커에서 받아 그대로 쌓는다. */
export interface RunRecord {
  readonly planet: number;
  readonly ship: number;
  readonly level: number;
  readonly seed: number;
  readonly won: boolean;
  readonly ticks: number;
  readonly values: Readonly<Record<string, number>>;
}

export interface Dist {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly min: number;
  readonly max: number;
}

export const EMPTY_DIST: Dist = { n: 0, mean: 0, sd: 0, p25: 0, p50: 0, p75: 0, min: 0, max: 0 };

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (idx - lo);
}

export function dist(values: readonly number[]): Dist {
  const n = values.length;
  if (n === 0) return EMPTY_DIST;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  const sd = n > 1 ? Math.sqrt(acc / (n - 1)) : 0;
  const sorted = [...values].sort((x, y) => x - y);
  return {
    n,
    mean,
    sd,
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
  };
}

/**
 * 지표 하나의 표본을 고른다 — `kind` 가 표본 집합을 정한다.
 *
 * `winMean`·`winPosMean` 은 승리 런만 본다. 승리가 0건이면 표본이 비고, 그 사실이 `n=0` 으로
 * 드러난다(0 으로 채우면 "클리어 0초"라는 거짓 수치가 된다).
 *
 * `winPosMean` 은 거기서 **0 을 더 뺀다** — 그 축에서 0 은 값이 아니라 "측정 불가"다
 * (`metrics.ts` `MetricKind` 주석).
 */
function samplesFor(runs: readonly RunRecord[], key: string): number[] {
  const def = RUN_METRICS[key];
  if (def === undefined) return [];
  const winOnly = def.kind === 'winMean' || def.kind === 'winPosMean';
  const src = winOnly ? runs.filter((r) => r.won) : runs;
  const vals = src.map((r) => r.values[key] ?? 0);
  return def.kind === 'winPosMean' ? vals.filter((v) => v > 0) : vals;
}

/** 런 묶음 하나의 전 지표 통계. */
export interface MetricStats {
  readonly runs: number;
  readonly wins: number;
  readonly metrics: Readonly<Record<string, Dist>>;
}

export function statsOf(runs: readonly RunRecord[]): MetricStats {
  const metrics: Record<string, Dist> = {};
  for (const key of METRIC_KEYS) metrics[key] = dist(samplesFor(runs, key));
  return { runs: runs.length, wins: runs.filter((r) => r.won).length, metrics };
}

/** 격자 한 칸의 통계. */
export interface CellStat extends MetricStats {
  readonly cell: BalanceCell;
  readonly key: string;
}

export function cellStats(runs: readonly RunRecord[]): CellStat[] {
  const by = new Map<string, RunRecord[]>();
  for (const r of runs) {
    const k = cellKey(r);
    const bucket = by.get(k);
    if (bucket === undefined) by.set(k, [r]);
    else bucket.push(r);
  }
  const out: CellStat[] = [];
  for (const [key, rs] of by) {
    const first = rs[0];
    if (first === undefined) continue;
    out.push({
      key,
      cell: { planet: first.planet, ship: first.ship, level: first.level },
      ...statsOf(rs),
    });
  }
  return out;
}

/** 한 축의 값 하나에 대한 통계(= 나머지 축을 전부 평균낸 것). */
export interface FoldPoint extends MetricStats {
  readonly axis: FoldAxis;
  readonly value: number;
}

/**
 * 축 하나로 접는다. **원본 런에서 다시 집계하므로** 셀별 표본 수가 달라도 편향이 없다
 * (셀 평균의 평균을 내면 표본이 적은 셀이 과대 대표된다).
 */
export function foldBy(runs: readonly RunRecord[], axis: FoldAxis): FoldPoint[] {
  const by = new Map<number, RunRecord[]>();
  for (const r of runs) {
    const v = r[axis];
    const bucket = by.get(v);
    if (bucket === undefined) by.set(v, [r]);
    else bucket.push(r);
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, rs]) => ({ axis, value, ...statsOf(rs) }));
}

// ---------------------------------------------------------------------------
// 게이트
// ---------------------------------------------------------------------------

/** 밴드를 벗어난 한 점. */
export interface GateViolation {
  /** 위반 지점 라벨(`전체` 또는 `Lv50`). */
  readonly at: string;
  readonly observed: number;
  readonly n: number;
}

export interface GateResult {
  readonly metric: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly source: string;
  readonly scope: 'overall' | FoldAxis;
  readonly pass: boolean;
  readonly violations: readonly GateViolation[];
  /** 표본이 없어 판정 자체가 불가능했던 지점 수. `pass` 와 별개로 리포트에 드러낸다. */
  readonly unjudged: number;
}

/** 게이트 위반 지점의 사람이 읽는 이름. 축 값(숫자)만으로는 어느 행성·기체인지 알 수 없다. */
function axisPointLabel(axis: FoldAxis, value: number): string {
  if (axis === 'level') return `Lv${value}`;
  const src = axis === 'planet' ? planetAxis() : shipAxis();
  return src.find((a) => a.value === value)?.label ?? `${axis}${value}`;
}

/**
 * 목표 밴드가 붙은 지표마다 게이트를 만든다 — `metrics.ts` 에 `target` 을 적으면 **여기 코드를
 * 고치지 않아도** 게이트가 생긴다.
 *
 * 표본이 0 인 지점은 위반이 아니라 **미판정**이다. 승리 0건인 셀의 `clearSec` 을 위반으로
 * 세면 "너무 빠르다"는 거짓 신호가 되기 때문이다.
 */
export function evaluateGates(runs: readonly RunRecord[]): GateResult[] {
  const overall = statsOf(runs);
  const out: GateResult[] = [];

  for (const key of gatedMetricKeys()) {
    const def = RUN_METRICS[key];
    if (def?.target === undefined) continue;
    const { min, max, source } = def.target;
    const scope = def.target.scope ?? 'overall';

    const points: { at: string; d: Dist }[] =
      scope === 'overall'
        ? [{ at: '전체', d: overall.metrics[key] ?? EMPTY_DIST }]
        : foldBy(runs, scope).map((p) => ({
            at: axisPointLabel(scope, p.value),
            d: p.metrics[key] ?? EMPTY_DIST,
          }));

    const violations: GateViolation[] = [];
    let unjudged = 0;
    for (const p of points) {
      if (p.d.n === 0) {
        unjudged++;
        continue;
      }
      if (p.d.mean < min || p.d.mean > max) {
        violations.push({ at: p.at, observed: p.d.mean, n: p.d.n });
      }
    }

    out.push({
      metric: key,
      label: def.label,
      min,
      max,
      source,
      scope,
      pass: violations.length === 0,
      violations,
      unjudged,
    });
  }
  return out;
}

/**
 * 축 간 **편차** 요약 — 로스터 편차 · 행성 편차가 이 한 함수에서 나온다.
 *
 * `spread` 는 축 값들의 클리어율 최대−최소(pp), `sd` 는 그 표본표준편차(pp)다.
 */
export interface SpreadSummary {
  readonly axis: FoldAxis;
  readonly metric: string;
  readonly spread: number;
  readonly sd: number;
  readonly lowest: { readonly value: number; readonly observed: number };
  readonly highest: { readonly value: number; readonly observed: number };
}

export function spreadOf(
  runs: readonly RunRecord[],
  axis: FoldAxis,
  metric = 'clearRate',
): SpreadSummary {
  const points = foldBy(runs, axis).filter((p) => (p.metrics[metric]?.n ?? 0) > 0);
  const vals = points.map((p) => ({ value: p.value, observed: p.metrics[metric]?.mean ?? 0 }));
  if (vals.length === 0) {
    return {
      axis,
      metric,
      spread: 0,
      sd: 0,
      lowest: { value: 0, observed: 0 },
      highest: { value: 0, observed: 0 },
    };
  }
  const sorted = [...vals].sort((a, b) => a.observed - b.observed);
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];
  const d = dist(vals.map((v) => v.observed));
  return {
    axis,
    metric,
    spread: (highest?.observed ?? 0) - (lowest?.observed ?? 0),
    sd: d.sd,
    lowest: lowest ?? { value: 0, observed: 0 },
    highest: highest ?? { value: 0, observed: 0 },
  };
}
