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
import { POWERUP_POLICIES } from './powerupPolicy.js';

/** 격자 한 칸 — 이 조합을 시드 여러 개로 반복해 통계를 낸다. */
export interface BalanceCell {
  /** 행성 인덱스(= `PLANETS` 배열 인덱스 = `WorldConfig.planet`). */
  readonly planet: number;
  /** 기체 타입 id(= `SHIP_TYPES` 배열 인덱스). */
  readonly ship: number;
  /** 표준 기체 레벨(= `BAND_LEVELS` 의 한 점). 침략 단계는 `ceil(Lv/5)` 로 파생된다. */
  readonly level: number;
  /**
   * **침략 단계 override**(선택). 미지정이면 `standardStage(level)` — 즉 표준 격자는 이 필드를
   * 절대 갖지 않고 거동이 바이트 동일하다.
   *
   * 레벨과 단계를 **떼어 놓아야만** 답할 수 있는 질문이 있어서 열었다: 보스 HP 는 침략 단계로
   * 스케일되지 않는데 장비·스킬은 Lv100 까지 스케일된다 — 만렙이 낮은 단계를 도는 "트윙크
   * 스톰프"가 얼마나 심한가(밸런스 큐 §R23 — 만렙의 단계 민감도 −10.2pp vs 다른 레벨
   * −26.9~−41.7pp, 단계 1 에서 Lv100 91.7% ↔ 표준 거주자 Lv5 44.4%). 표준 격자에서는
   * 둘이 `ceil(Lv/5)` 로 묶여 있어
   * 구조적으로 관측 불가능하다.
   */
  readonly stage?: number;
  /**
   * **파워업 선택 정책 id**(선택, `powerupPolicy.ts`). 미지정이면 현행 오토파일럿 거동
   * (오퍼 0번)이고 정책 0(`기준선`)과도 결과가 동일하다.
   *
   * ⚠️ 이 축은 **기본 격자에 들어가지 않는다.** 축을 5배로 늘리면 예산이 같은 만큼 셀당 시드가
   * 1/5 로 줄어 곡선·편차 게이트의 정밀도가 통째로 희생된다 — 그런데 이 질문은 상시 판정이
   * 아니라 회차 질문이다. `--powerups=0,1,2,3,4` 로 **명시할 때만** 축이 열린다
   * (`axes.ts` 헤더의 "그 축을 변인으로 쪼갤 때만" 계약).
   */
  readonly powerup?: number;
}

/**
 * 셀의 안정 키(리포트 · 기준선 대조용). 축 순서를 바꾸지 마라 — 기준선 파일이 이 키로 짝을 짓는다.
 *
 * 선택 축(`stage`·`powerup`)은 **값이 있을 때만** 접미로 붙는다. 그래서 표준 격자의 키는
 * 축 신설 전과 **바이트 동일**하고 기존 `runs.json`·기준선 파일이 그대로 짝지어진다.
 */
export function cellKey(c: BalanceCell): string {
  const base = `p${c.planet}/s${c.ship}/lv${c.level}`;
  const st = c.stage === undefined ? '' : `/st${c.stage}`;
  const pw = c.powerup === undefined ? '' : `/pw${c.powerup}`;
  return `${base}${st}${pw}`;
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

/** 파워업 정책 축 — `POWERUP_POLICIES`(`powerupPolicy.ts`)가 정본이다. **명시할 때만 열린다.** */
export function powerupAxis(): AxisValue[] {
  return POWERUP_POLICIES.map((p) => ({ value: p.id, label: p.label }));
}

/**
 * 축 부분 선택(빠른 확인 · 특정 축 집중 측정용). 미지정 축은 전량이다.
 *
 * ⚠️ `powerups` 만 규칙이 다르다 — 미지정이면 **전량이 아니라 축 자체가 없다**(셀에 `powerup`
 * 필드가 붙지 않는다). 기본 격자의 수치를 한 바이트도 움직이지 않기 위해서다.
 */
export interface AxisSelection {
  readonly planets?: readonly number[];
  readonly ships?: readonly number[];
  readonly levels?: readonly number[];
  readonly powerups?: readonly number[];
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
  // 파워업 축은 **명시했을 때만** 열린다. 미지정이면 `powerup` 필드 자체가 없는 셀이 나오고,
  // 그 셀의 런은 축 신설 전과 바이트 동일하다(`cell.ts` 픽 오버라이드가 무연산이 된다).
  const pwSel = sel.powerups;
  const powerups: (number | undefined)[] =
    pwSel === undefined || pwSel.length === 0 ? [undefined] : [...pwSel];
  const out: BalanceCell[] = [];
  for (const p of ax.planets) {
    for (const s of ax.ships) {
      for (const l of ax.levels) {
        for (const pw of powerups) {
          out.push(
            pw === undefined
              ? { planet: p.value, ship: s.value, level: l.value }
              : { planet: p.value, ship: s.value, level: l.value, powerup: pw },
          );
        }
      }
    }
  }
  return out;
}

/** 전량 격자의 셀 수(축 선택 없이). 예산 계획의 입력이다. */
export function fullCellCount(): number {
  return PLANETS.length * SHIP_TYPES.length * BAND_LEVELS.length;
}
