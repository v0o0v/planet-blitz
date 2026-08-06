/**
 * 마크다운 리포트 렌더. 순수 함수라 같은 런 기록에서 언제든 다시 만들 수 있다.
 *
 * 표의 **열은 `metrics.ts` 의 카탈로그에서 파생**된다 — 지표를 한 줄 추가하면 모든 표에
 * 자동으로 열이 생긴다.
 */

import { planetAxis, powerupAxis, shipAxis, type ResolvedAxes } from './axes.js';
import {
  cellStats,
  evaluateGates,
  foldBy,
  spreadOf,
  statsOf,
  type Dist,
  type GateResult,
  type RunRecord,
} from './aggregate.js';
import { METRIC_KEYS, RUN_METRICS } from './metrics.js';

/** 리포트 머리말에 싣는 실행 메타. 러너가 채운다. */
export interface ReportMeta {
  /** ISO 8601 시각(러너가 스탬프 — 코어는 시계를 읽지 않는다). */
  readonly at: string;
  readonly gitHead: string;
  /** 예산(초). */
  readonly budgetSec: number;
  readonly elapsedSec: number;
  readonly workers: number;
  readonly cells: number;
  readonly rounds: number;
  /** 셀당 시드 수 최소~최대(마지막 라운드가 잘리면 갈린다). */
  readonly seedsPerCell: { readonly min: number; readonly max: number };
  readonly axes: ResolvedAxes;
  /** 예산 소진으로 라운드가 중단됐는가. */
  readonly budgetExhausted: boolean;
}

function fmt(v: number, key: string): string {
  const def = RUN_METRICS[key];
  if (def === undefined) return v.toFixed(1);
  if (def.kind === 'rate') return `${(v * 100).toFixed(1)}%`;
  return v.toFixed(def.digits ?? 1) + (def.unit ?? '');
}

function cellOf(d: Dist | undefined, key: string): string {
  if (d === undefined || d.n === 0) return '—';
  const def = RUN_METRICS[key];
  if (def?.kind === 'rate') return fmt(d.mean, key);
  return `${fmt(d.mean, key)}±${(d.sd).toFixed(def?.digits ?? 1)}`;
}

function metricHeader(): string[] {
  return [
    `| 구분 | n |${METRIC_KEYS.map((k) => ` ${RUN_METRICS[k]?.label ?? k} |`).join('')}`,
    `|---|---|${METRIC_KEYS.map(() => '---|').join('')}`,
  ];
}

function metricRow(label: string, runs: readonly RunRecord[]): string {
  const s = statsOf(runs);
  return (
    `| ${label} | ${s.runs} |` +
    METRIC_KEYS.map((k) => ` ${cellOf(s.metrics[k], k)} |`).join('')
  );
}

function gateLine(g: GateResult): string {
  const band =
    RUN_METRICS[g.metric]?.kind === 'rate'
      ? `${(g.min * 100).toFixed(0)}~${(g.max * 100).toFixed(0)}%`
      : `${g.min}~${g.max}`;
  const mark = g.pass ? '✅ PASS' : '❌ FAIL';
  const detail =
    g.violations.length === 0
      ? g.unjudged > 0
        ? `미판정 ${g.unjudged}점`
        : '—'
      : g.violations
          .slice(0, 8)
          .map((v) => `${v.at}=${fmt(v.observed, g.metric)}`)
          .join(', ') + (g.violations.length > 8 ? ` 외 ${g.violations.length - 8}점` : '');
  const scopeLabel =
    g.scope === 'overall'
      ? '전체'
      : g.scope === 'level'
        ? '레벨별'
        : g.scope === 'planet'
          ? '행성별'
          : '기체별';
  return `| ${mark} | ${g.label} | ${band} | ${scopeLabel} | ${detail} | ${g.source} |`;
}

/** 전체 리포트. */
export function renderReport(runs: readonly RunRecord[], meta: ReportMeta): string {
  const L: string[] = [];
  const gates = evaluateGates(runs);
  const failed = gates.filter((g) => !g.pass);

  L.push('# 밸런스 체크 리포트');
  L.push('');
  L.push(`- 시각: \`${meta.at}\` · HEAD \`${meta.gitHead}\``);
  L.push(
    `- 예산 ${meta.budgetSec}s · 실제 **${meta.elapsedSec.toFixed(1)}s** · 워커 ${meta.workers}개` +
      (meta.budgetExhausted ? ' (예산 소진으로 라운드 중단)' : ''),
  );
  L.push(
    `- 격자 **${meta.cells}셀** = 행성 ${meta.axes.planets.length} × 기체 ${meta.axes.ships.length} × 레벨 ${meta.axes.levels.length}`,
  );
  L.push(
    `- 총 **${runs.length}런** · ${meta.rounds}라운드 · 셀당 시드 ${meta.seedsPerCell.min}~${meta.seedsPerCell.max}개`,
  );
  L.push('');
  L.push(`## 판정 — ${failed.length === 0 ? '✅ 전 게이트 통과' : `❌ ${failed.length}건 실패`}`);
  L.push('');
  L.push('| 판정 | 지표 | 목표 밴드 | 범위 | 위반 지점 | 근거 |');
  L.push('|---|---|---|---|---|---|');
  for (const g of gates) L.push(gateLine(g));
  L.push('');

  L.push('## 전체');
  L.push('');
  L.push(...metricHeader());
  L.push(metricRow('전체', runs));
  L.push('');

  L.push('## 난이도 곡선 (레벨 축)');
  L.push('');
  L.push('표준 레벨 = 표준 장비 · 표준 투자 · 대응 단계(`ceil(Lv/5)`). 합격선은 클리어율 60~80%(ADR-0037).');
  L.push('');
  L.push(...metricHeader());
  for (const p of foldBy(runs, 'level')) {
    L.push(metricRow(`Lv${p.value}`, runs.filter((r) => r.level === p.value)));
  }
  L.push('');

  const planetLabels = new Map(planetAxis().map((a) => [a.value, a.label]));
  L.push('## 행성 편차');
  L.push('');
  const ps = spreadOf(runs, 'planet');
  L.push(
    `- 클리어율 폭 **${(ps.spread * 100).toFixed(1)}pp** (sd ${(ps.sd * 100).toFixed(1)}pp) · ` +
      `최저 ${planetLabels.get(ps.lowest.value) ?? ps.lowest.value}=${(ps.lowest.observed * 100).toFixed(1)}% · ` +
      `최고 ${planetLabels.get(ps.highest.value) ?? ps.highest.value}=${(ps.highest.observed * 100).toFixed(1)}%`,
  );
  L.push('');
  L.push(...metricHeader());
  for (const p of foldBy(runs, 'planet')) {
    L.push(
      metricRow(planetLabels.get(p.value) ?? `행성${p.value}`, runs.filter((r) => r.planet === p.value)),
    );
  }
  L.push('');

  const shipLabels = new Map(shipAxis().map((a) => [a.value, a.label]));
  L.push('## 로스터 편차 (기체 축)');
  L.push('');
  const ss = spreadOf(runs, 'ship');
  L.push(
    `- 클리어율 폭 **${(ss.spread * 100).toFixed(1)}pp** (sd ${(ss.sd * 100).toFixed(1)}pp) · ` +
      `최저 ${shipLabels.get(ss.lowest.value) ?? ss.lowest.value}=${(ss.lowest.observed * 100).toFixed(1)}% · ` +
      `최고 ${shipLabels.get(ss.highest.value) ?? ss.highest.value}=${(ss.highest.observed * 100).toFixed(1)}%`,
  );
  L.push('');
  L.push(...metricHeader());
  for (const p of foldBy(runs, 'ship')) {
    L.push(metricRow(shipLabels.get(p.value) ?? `기체${p.value}`, runs.filter((r) => r.ship === p.value)));
  }
  L.push('');

  // 파워업 정책 축 — **명시했을 때만** 존재한다(`--powerups=`). 표준 격자 리포트는 이 절이
  // 통째로 없으므로 기존 산출물과 바이트 동일하다.
  if (runs.some((r) => r.powerup !== undefined)) {
    const pwLabels = new Map(powerupAxis().map((a) => [a.value, a.label]));
    L.push('## 파워업 정책 축');
    L.push('');
    const pws = spreadOf(runs, 'powerup');
    L.push(
      `- 클리어율 폭 **${(pws.spread * 100).toFixed(1)}pp** (sd ${(pws.sd * 100).toFixed(1)}pp) · ` +
        `최저 ${pwLabels.get(pws.lowest.value) ?? pws.lowest.value}=${(pws.lowest.observed * 100).toFixed(1)}% · ` +
        `최고 ${pwLabels.get(pws.highest.value) ?? pws.highest.value}=${(pws.highest.observed * 100).toFixed(1)}%`,
    );
    L.push('');
    L.push('오퍼 추첨은 런 시작 config 만 읽으므로 정책이 달라도 **같은 시드는 같은 오퍼 스트림**을 본다(짝지어진 대조).');
    L.push('');
    L.push(...metricHeader());
    for (const p of foldBy(runs, 'powerup')) {
      L.push(
        metricRow(pwLabels.get(p.value) ?? `정책${p.value}`, runs.filter((r) => r.powerup === p.value)),
      );
    }
    L.push('');
  }

  // 극단 셀 — 곡선·편차 표가 평균으로 가려버리는 지점을 드러낸다.
  const cells = cellStats(runs).filter((c) => (c.metrics['clearRate']?.n ?? 0) > 0);
  const byClear = [...cells].sort(
    (a, b) => (a.metrics['clearRate']?.mean ?? 0) - (b.metrics['clearRate']?.mean ?? 0),
  );
  L.push('## 극단 셀');
  L.push('');
  L.push('| 구분 | 셀 | 행성 | 기체 | Lv | 클리어율 | n |');
  L.push('|---|---|---|---|---|---|---|');
  const edge = (label: string, list: readonly (typeof cells)[number][]): void => {
    for (const c of list) {
      const d = c.metrics['clearRate'];
      L.push(
        `| ${label} | \`${c.key}\` | ${planetLabels.get(c.cell.planet) ?? c.cell.planet} | ` +
          `${shipLabels.get(c.cell.ship) ?? c.cell.ship} | ${c.cell.level} | ` +
          `${((d?.mean ?? 0) * 100).toFixed(1)}% | ${d?.n ?? 0} |`,
      );
    }
  };
  edge('최저', byClear.slice(0, 10));
  edge('최고', byClear.slice(-10).reverse());
  L.push('');

  L.push('## 측정이 덮지 못한 것 (자인)');
  L.push('');
  L.push(
    '- **액티브 스킬은 발동되지 않는다.** `autopilotInput` 이 `special` 로 파워업 선택만 내므로 ' +
      '(`src/sim/autopilot.ts`) 액티브 축(ADR-0041)은 이 측정에 들어오지 않는다. ' +
      '발동하는 파일럿은 이미 있다(`src/sim/measurePilot.ts`) — 이 하네스가 아직 안 쓸 뿐이고, ' +
      '갈아 끼우는 절차와 대가는 `src/bench/balance/cell.ts` 헤더에 적혀 있다.',
  );
  L.push(
    '- **봇은 최적 플레이가 아니다.** 카이팅 + 탄 회피 휴리스틱이라(ADR-0008) 절대 클리어율은 ' +
      '사람보다 낮게 나온다. 이 리포트가 판정하는 것은 절대값이 아니라 **축 간 상대 난이도와 밴드 이탈**이다.',
  );
  L.push(
    '- **침공(PvP)·의뢰 런은 이 격자에 없다.** 각각 `tests/invasionBalance.test.ts` 와 의뢰 계측이 별도 축이다.',
  );
  L.push(
    '- **모드마다 "보스에 이르는 경로"가 다르다.** `보스교전` 은 교전 가능한 보스 엔티티를 본 ' +
      '적이 있는가이며, 추격 모드(니플헤임)에서는 **포식자 취약화**(반격 장치 전부 파괴)가 그 ' +
      '시점이다 — 세그먼트 진행이 아니다. 이 열을 무대 간에 나란히 읽을 때 같은 사건을 세고 ' +
      '있다고 가정하지 마라.',
  );
  L.push(
    '- **파워업 선택은 항상 0번**이다(봇 휴리스틱). 파워업 조합의 강약은 이 측정으로 갈리지 않는다.',
  );
  return L.join('\n');
}
