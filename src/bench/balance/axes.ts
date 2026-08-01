/**
 * 밸런스 격자의 **축 열거** — 이 파일이 "새 콘텐츠가 들어오면 자동으로 측정된다"의 실체다.
 *
 * ## 왜 격자 하나인가
 * 이 리포가 따로 재던 세 지표는 전부 같은 격자의 **다른 접기(fold)** 다:
 *
 * | 리포트 | 접는 축 |
 * |---|---|
 * | 난이도 곡선(ADR-0037 합격선 60~80%) | 레벨 |
 * | 로스터 편차(M8) | 기체 |
 * | 행성 난이도 편차 | 행성 |
 *
 * 그래서 `(행성 × 기체 × 레벨)` 격자를 **한 번** 돌면 세 리포트가 동시에 나온다. 예전처럼
 * 축마다 별도 스윕을 짜면 같은 런을 세 번 돌리는 셈이고, 축이 하나 늘 때마다 스윕이 하나씩
 * 늘어난다.
 *
 * ## 확장 계약 — 새 콘텐츠에 필요한 수정량
 *
 * | 새로 들어오는 것 | 이 하네스에 필요한 수정 |
 * |---|---|
 * | 행성 | **0** — `PLANETS` 에 행이 늘면 격자가 자동으로 커진다 |
 * | 기체 | **0** — `SHIP_TYPES` 동상 |
 * | 레벨 밴드 / 만렙 상향 | **0** — `BAND_LEVELS` 가 `LEVEL_CAP` 에서 파생된다 |
 * | 장비 · 어픽스 · 유니크 | **0** — 표준 세트가 정본 `rollItem` 을 그대로 굴린다 |
 * | 스킬 노드 | **0** — 표준 투자가 `flattenShipNodes` 에서 파생된다 |
 * | 런 입력(촉매·의뢰 등) | **0~1** — `buildRunConfig` 단일 정본을 거치므로 기본값이 자동 적용. 그 축을 **변인으로 쪼개고 싶을 때만** 여기에 축을 하나 추가한다 |
 * | 새 지표 | **1** — `metrics.ts` 의 `RUN_METRICS` 에 한 줄 |
 *
 * 격자가 커져도 **소요 시간은 그대로다** — 러너가 예산 안에서 셀당 시드 수를 줄인다
 * (`scripts/balance/run.mjs`). 즉 축 추가의 대가는 시간이 아니라 **표본 정밀도**다.
 *
 * ## 결정론
 * 열거 순서는 `planet → ship → level` 중첩 루프 고정이다. 축 배열이 카탈로그 순서를 그대로
 * 따르므로 같은 리비전이면 언제나 같은 순서의 같은 격자가 나온다.
 */

import { PLANETS } from '../../../data/planets/index.js';
import { SHIP_TYPES } from '../../../data/ships/index.js';
import { BAND_LEVELS } from '../standardBuild.js';

/** 격자 한 칸 — 이 조합을 시드 여러 개로 반복해 통계를 낸다. */
export interface BalanceCell {
  /** 행성 인덱스(= `PLANETS` 배열 인덱스 = `WorldConfig.planet`). */
  readonly planet: number;
  /** 기체 타입 id(= `SHIP_TYPES` 배열 인덱스). */
  readonly ship: number;
  /** 표준 기체 레벨(= `BAND_LEVELS` 의 한 점). 침략 단계는 `ceil(Lv/5)` 로 파생된다. */
  readonly level: number;
}

/** 셀의 안정 키(리포트 · 기준선 대조용). 축 순서를 바꾸지 마라 — 기준선 파일이 이 키로 짝을 짓는다. */
export function cellKey(c: BalanceCell): string {
  return `p${c.planet}/s${c.ship}/lv${c.level}`;
}

/** 축 하나의 메타(리포트 라벨용). */
export interface AxisValue {
  readonly value: number;
  readonly label: string;
}

/**
 * 행성 축 — `data/planets/index.ts` 의 레지스트리가 정본이다.
 *
 * 라벨에 인덱스를 함께 박는다: 축 부분 선택(`--planets=0,3`)을 쓰면 표의 행 순서가 인덱스와
 * 어긋나 보여서, 이름만 적으면 "아르케가 2번인가?" 하는 오독이 난다.
 */
export function planetAxis(): AxisValue[] {
  return PLANETS.map((p) => ({ value: p.index, label: `${p.name}#${p.index}` }));
}

/** 기체 축 — `data/ships/index.ts` 의 `SHIP_TYPES` 가 정본이다. */
export function shipAxis(): AxisValue[] {
  return SHIP_TYPES.map((s, i) => ({ value: i, label: s.slug }));
}

/** 레벨 축 — `BAND_LEVELS`(= `LEVEL_CAP / LEVEL_PER_STAGE` 에서 파생)가 정본이다. */
export function levelAxis(): AxisValue[] {
  return BAND_LEVELS.map((lv) => ({ value: lv, label: `Lv${lv}` }));
}

/** 축 부분 선택(빠른 확인 · 특정 축 집중 측정용). 미지정 축은 전량이다. */
export interface AxisSelection {
  readonly planets?: readonly number[];
  readonly ships?: readonly number[];
  readonly levels?: readonly number[];
}

function pick(all: readonly AxisValue[], sel: readonly number[] | undefined): AxisValue[] {
  if (sel === undefined || sel.length === 0) return [...all];
  const want = new Set(sel);
  return all.filter((v) => want.has(v.value));
}

/** 이 실행이 실제로 도는 축들. */
export interface ResolvedAxes {
  readonly planets: readonly AxisValue[];
  readonly ships: readonly AxisValue[];
  readonly levels: readonly AxisValue[];
}

/** 선택을 적용한 축 집합. 선택이 카탈로그에 없는 값을 가리키면 그 값은 **조용히 빠진다**. */
export function resolveAxes(sel: AxisSelection = {}): ResolvedAxes {
  return {
    planets: pick(planetAxis(), sel.planets),
    ships: pick(shipAxis(), sel.ships),
    levels: pick(levelAxis(), sel.levels),
  };
}

/**
 * 격자 전개. 순서는 `planet → ship → level` 고정이다.
 *
 * 셀 수는 `|행성| × |기체| × |레벨|` 이다(2026-08-01 현재 6 × 7 × 20 = 840).
 */
export function enumerateCells(sel: AxisSelection = {}): BalanceCell[] {
  const ax = resolveAxes(sel);
  const out: BalanceCell[] = [];
  for (const p of ax.planets) {
    for (const s of ax.ships) {
      for (const l of ax.levels) {
        out.push({ planet: p.value, ship: s.value, level: l.value });
      }
    }
  }
  return out;
}

/** 전량 격자의 셀 수(축 선택 없이). 예산 계획의 입력이다. */
export function fullCellCount(): number {
  return PLANETS.length * SHIP_TYPES.length * BAND_LEVELS.length;
}
