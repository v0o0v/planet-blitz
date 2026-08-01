/**
 * 예산 계획 — "10분 안에 끝난다"를 성립시키는 순수 로직.
 *
 * ## 전략: 라운드 단위 시드 확장
 * 한 라운드 = **모든 셀을 시드 1개씩** 도는 것. 라운드가 끝날 때마다 남은 예산과 직전 라운드
 * 소요를 비교해 다음 라운드를 돌릴지 정한다. 그래서:
 *
 * - 셀이 늘어도(새 행성·새 기체) **시간은 그대로**다 — 라운드 수가 줄 뿐이다.
 * - 어느 시점에 멈춰도 표본이 **모든 셀에 고르게** 깔려 있다(라운드 경계에서 멈추므로).
 * - 예산 초과가 구조적으로 불가능하다(다음 라운드를 시작하기 **전에** 판단한다).
 *
 * 대안이었던 "셀별 비용을 미리 재서 표본을 배분"은 파일럿 패스가 따로 필요하고, 셀 비용이
 * 레벨·시드에 따라 3배씩 흔들려서 예측이 빗나가면 예산을 넘긴다. 라운드 방식은 예측이
 * 빗나가도 **다음 라운드를 안 돌면 그만**이라 실패 모드가 없다.
 */

import type { ResolvedAxes } from './axes.js';

/** 한 라운드도 못 돌릴 만큼 격자가 크면 축을 솎는다 — 그때 각 축이 유지하는 최소 점 수. */
export const MIN_AXIS_POINTS = 2;

/**
 * 다음 라운드 소요 추정에 곱하는 안전계수.
 *
 * 라운드마다 소요가 흔들리는 이유는 시드가 바뀌면 런 길이가 바뀌기 때문이다(같은 셀에서
 * 400틱~18,000틱). 1.25 는 관측된 라운드 간 변동(±15% 내외)에 여유를 얹은 값이다.
 */
export const ROUND_SAFETY = 1.25;

export interface RoundDecisionInput {
  /** 시작 이후 경과(ms). */
  readonly elapsedMs: number;
  /** 총 예산(ms). */
  readonly budgetMs: number;
  /** 직전 라운드 소요(ms). 첫 라운드 판단에는 쓰지 않는다. */
  readonly lastRoundMs: number;
  /** 지금까지 완료한 라운드 수. */
  readonly completedRounds: number;
  /** 최대 라운드 수(= 셀당 시드 상한). 0 이면 무제한. */
  readonly maxRounds: number;
}

/**
 * 라운드 진행 판정.
 *
 * `reason` 은 **ASCII 로 유지한다** — 사용자 콘솔(`pnpm balance`)에 그대로 찍히는데, Windows
 * 콘솔 코드페이지가 UTF-8 이 아니면 한글이 mojibake 로 깨진다(전역 규율). 한글 설명이 필요한
 * 자리는 리포트 파일(.md)이다.
 */
export interface RoundDecision {
  readonly proceed: boolean;
  readonly reason: string;
}

/**
 * 다음 라운드를 돌릴 것인가.
 *
 * 첫 라운드는 **항상 돈다** — 한 라운드도 안 돌면 산출물이 비어 리포트가 아무 말도 못 한다.
 * 예산을 넘길 것 같아도 첫 라운드만은 완주하고, 그 사실을 리포트가 `budgetExhausted` 로 알린다.
 */
export function decideNextRound(i: RoundDecisionInput): RoundDecision {
  if (i.completedRounds === 0) return { proceed: true, reason: 'first round' };
  if (i.maxRounds > 0 && i.completedRounds >= i.maxRounds) {
    return { proceed: false, reason: `round cap ${i.maxRounds} reached` };
  }
  const remaining = i.budgetMs - i.elapsedMs;
  const need = i.lastRoundMs * ROUND_SAFETY;
  if (remaining < need) {
    return {
      proceed: false,
      reason: `budget spent (${(remaining / 1000).toFixed(1)}s left < ${(need / 1000).toFixed(1)}s projected)`,
    };
  }
  return { proceed: true, reason: `${(remaining / 1000).toFixed(1)}s left` };
}

/** 배열에서 `keep` 개를 균등 간격으로 뽑는다(양 끝 보존). 결정론적이다. */
function evenPick<T>(items: readonly T[], keep: number): T[] {
  const n = items.length;
  if (keep >= n) return [...items];
  if (keep <= 1) {
    const first = items[0];
    return first === undefined ? [] : [first];
  }
  const out: T[] = [];
  for (let i = 0; i < keep; i++) {
    const idx = Math.round((i * (n - 1)) / (keep - 1));
    const v = items[idx];
    if (v !== undefined) out.push(v);
  }
  // 반올림 충돌로 중복이 생길 수 있다 — 순서를 지키며 유일화한다.
  return [...new Set(out)];
}

/**
 * 셀 수가 `targetCells` 를 넘으면 **가장 긴 축부터 반씩 솎아** 격자를 줄인다.
 *
 * 축 하나를 통째로 버리지 않고 균등 간격으로 솎는 이유는, 어느 축이든 **양 끝(저레벨·만렙,
 * 첫 행성·마지막 행성)이 보존돼야** 곡선과 편차가 읽히기 때문이다. 축은 최소
 * {@link MIN_AXIS_POINTS} 점을 유지한다 — 1점이 되면 그 축의 편차를 아예 못 잰다.
 *
 * `targetCells <= 0` 이면 원본을 그대로 돌려준다(축소 안 함).
 */
export function shrinkAxes(axes: ResolvedAxes, targetCells: number): ResolvedAxes {
  let planets = [...axes.planets];
  let ships = [...axes.ships];
  let levels = [...axes.levels];
  if (targetCells <= 0) return { planets, ships, levels };

  const count = (): number => planets.length * ships.length * levels.length;
  // 축이 전부 하한이면 더 줄일 수 없다 — 무한 루프 방지로 진행 여부를 검사한다.
  for (let guard = 0; guard < 64 && count() > targetCells; guard++) {
    const lens: [number, 'p' | 's' | 'l'][] = [
      [planets.length, 'p'],
      [ships.length, 's'],
      [levels.length, 'l'],
    ];
    // 가장 긴 축(동률이면 레벨 → 기체 → 행성 순으로 먼저 솎는다: 레벨은 점이 많고 곡선이
    // 성기어져도 형태가 남는다).
    lens.sort((a, b) => b[0] - a[0] || (a[1] === 'l' ? -1 : b[1] === 'l' ? 1 : 0));
    const target = lens[0];
    if (target === undefined || target[0] <= MIN_AXIS_POINTS) break;
    const keep = Math.max(MIN_AXIS_POINTS, Math.floor(target[0] / 2));
    if (target[1] === 'p') planets = evenPick(planets, keep);
    else if (target[1] === 's') ships = evenPick(ships, keep);
    else levels = evenPick(levels, keep);
  }
  return { planets, ships, levels };
}

/**
 * 예산으로 감당 가능한 셀 수의 **보수적 상한**.
 *
 * `tickCostUs` 는 이 머신의 틱당 마이크로초, `avgTicks` 는 런당 평균 틱이다. 러너가 워밍업
 * 런 몇 개로 실측해 넘긴다 — 머신이 바뀌어도 상수를 고칠 필요가 없다.
 *
 * 여기서 나오는 값은 "최소 `minRounds` 라운드는 돌 수 있는 셀 수"다. 격자가 이보다 크면
 * {@link shrinkAxes} 가 축을 솎는다.
 */
export function affordableCells(opts: {
  readonly budgetMs: number;
  readonly workers: number;
  readonly tickCostUs: number;
  readonly avgTicks: number;
  readonly minRounds: number;
}): number {
  const cpuMs = opts.budgetMs * Math.max(1, opts.workers);
  const runMs = (opts.avgTicks * opts.tickCostUs) / 1000;
  if (runMs <= 0) return Number.MAX_SAFE_INTEGER;
  const totalRuns = cpuMs / runMs;
  return Math.max(1, Math.floor(totalRuns / Math.max(1, opts.minRounds)));
}
