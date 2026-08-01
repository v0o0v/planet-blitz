/**
 * 런 1회에서 뽑는 **지표 카탈로그**.
 *
 * ## 확장 지점
 * 새 지표를 재고 싶으면 {@link RUN_METRICS} 에 **한 줄** 추가한다. 집계 · 리포트 렌더 ·
 * 게이트 판정이 전부 이 객체를 순회하므로 다른 파일을 고칠 필요가 없다. `target` 을 함께
 * 적으면 그 지표의 **게이트가 자동으로 생긴다**.
 *
 * 런 도중에만 관측 가능한 값(보스 도달 여부 등)은 {@link RunTrace} 에 담는다 — 종료 상태
 * (`WorldState`)만으로는 복원되지 않기 때문이다. trace 확장도 필드 추가 + 런 루프 한 줄이다.
 */

import type { WorldState } from '../../sim/world.js';
import { chaseAliveCounterDevices } from '../../sim/modes/chase.js';
import { PLANET_MODE } from '../../sim/planetMode.js';

/**
 * 집계 방식.
 *
 * - `rate`: 0/1 값의 전 런 평균(= 비율). 클리어율처럼 "몇 %"로 읽는 축.
 * - `mean`: 전 런 평균. 생존 시간처럼 승패 무관하게 의미가 있는 축.
 * - `winMean`: **승리 런만**의 평균. 클리어 소요처럼 패배 런을 섞으면 뜻이 무너지는 축.
 * - `winPosMean`: 승리 런 중 **값이 0 보다 큰** 표본만. 0 이 "측정값 0"이 아니라 **"측정 불가"**를
 *   뜻하는 축에만 쓴다(현재 `bossDps` 하나). 보스가 스폰된 틱에 처치되면 관측 창이 0틱이라 DPS 를
 *   계산할 수 없는데, 그 0 을 평균에 섞으면 무대 전체의 DPS 가 실제보다 낮게 보인다.
 */
export type MetricKind = 'rate' | 'mean' | 'winMean' | 'winPosMean';

/** 접을 수 있는 축(집계·게이트 공통). 정본을 여기 두는 이유는 `aggregate.ts` 가 이 모듈을 읽기 때문이다. */
export type FoldAxis = 'planet' | 'ship' | 'level';

/** 목표 밴드 — 적으면 그 지표의 게이트가 자동 생성된다(양 끝 포함). */
export interface MetricTarget {
  readonly min: number;
  readonly max: number;
  /** 이 밴드의 근거(ADR·계획 문서). 리포트에 그대로 실린다. */
  readonly source: string;
  /**
   * 게이트를 어느 층에서 볼 것인가. 기본 `'overall'`(격자 전체 평균 1개).
   *
   * 축 이름을 주면 **그 축으로 접은 점마다** 판정한다. 난이도 곡선처럼 "구간마다 성립해야
   * 하는" 축은 반드시 축 단위로 봐야 한다.
   *
   * ⚠️ **전체 평균은 국소 이상을 가린다.** `timeoutRate` 가 실제로 그랬다 — 전체 0.8% 로
   * 게이트를 통과하는데 **Lv100 만 10.6%**(그중 니플헤임 44.8%)였다. 새 지표에 `target` 을
   * 달 때 "이 성질이 전체 평균으로 성립하면 충분한가, 구간마다 성립해야 하는가"를 먼저 답해라.
   */
  readonly scope?: 'overall' | FoldAxis;
}

export interface MetricDef {
  /** 리포트 표 머리글(한글). */
  readonly label: string;
  readonly kind: MetricKind;
  /** 단위 표기(선택). `%` 는 `rate` 에서 자동이라 적지 않는다. */
  readonly unit?: string;
  /** 소수 자릿수(기본 1). */
  readonly digits?: number;
  /** 목표 밴드(선택). 적으면 게이트가 생긴다. */
  readonly target?: MetricTarget;
  /** 런 결과 → 스칼라. 순수 함수여야 한다. */
  readonly of: (s: WorldState, t: RunTrace) => number;
}

/** 런 도중 누적하는 관측치. 확장 = 필드 추가 + `cell.ts` 런 루프에 갱신 한 줄. */
export interface RunTrace {
  /**
   * **교전 가능한** 보스 엔티티를 본 적이 있는가(`cell.ts` `bossEngageable`).
   *
   * ⚠️ "보스 세그먼트에 진입했는가"가 아니다. 모드마다 보스에 이르는 경로가 다르다 — 추격
   * (니플헤임)은 포식자가 런 시작부터 존재하되 **취약화 전에는 교전이 불가능**하고, 승리는
   * 세그먼트 진행과 무관하게 성립한다. 세그먼트 기준으로 재면 승리 런조차 0 이 나온다(실측).
   */
  sawBoss: boolean;
  /** 도달한 최대 세그먼트 인덱스. */
  maxSegment: number;
  /** 보스 관측 틱 수(보스 DPS 프록시의 분모). */
  bossTicks: number;
  /** 처음 본 보스 hp(-1 = 미관측). */
  bossHp0: number;
  /** 마지막으로 본 보스 hp(-1 = 미관측). */
  bossHpLast: number;
}

/** 새 trace 를 만든다. */
export function newTrace(): RunTrace {
  return { sawBoss: false, maxSegment: 0, bossTicks: 0, bossHp0: -1, bossHpLast: -1 };
}

/**
 * 지표 카탈로그.
 *
 * ⚠️ **키를 바꾸면 기준선 파일과의 짝이 깨진다.** 이름을 고치려면 `label` 만 고쳐라.
 */
export const RUN_METRICS: Readonly<Record<string, MetricDef>> = {
  clearRate: {
    label: '클리어율',
    kind: 'rate',
    of: (s) => (s.victory ? 1 : 0),
    target: {
      min: 0.6,
      max: 0.8,
      source: 'ADR-0037 — 표준 빌드 합격선',
      scope: 'level',
    },
  },
  clearSec: {
    label: '클리어초',
    kind: 'winMean',
    unit: 's',
    of: (s) => s.tick / 60,
    target: {
      min: 60,
      max: 190,
      // par 95초의 ±2배 안. 벗어나면 "런 길이" 전제(10시간 산술의 분모)가 무너진다.
      source: 'ADR-0035 · progressionPath RUN_SECONDS_PAR=95 의 0.63~2.0배',
      scope: 'overall',
    },
  },
  survivalSec: { label: '생존초', kind: 'mean', unit: 's', of: (s) => s.tick / 60 },
  /**
   * 보스와 **교전 가능한 상태까지 갔는가**. 추격 모드에서는 포식자 취약화가 그 시점이다
   * (자세한 근거는 `cell.ts` `bossEngageable`).
   */
  bossReachRate: { label: '보스교전', kind: 'rate', of: (_s, t) => (t.sawBoss ? 1 : 0) },
  timeoutRate: {
    label: '타임아웃',
    kind: 'rate',
    of: (s) => (!s.victory && !s.gameOver ? 1 : 0),
    target: {
      min: 0,
      max: 0.02,
      // 타임아웃은 "이길 수도 질 수도 없는 런" 이다 — 밸런스가 아니라 구조 결함 신호다.
      source: '구조 건전성 — 18000틱 상한에 걸리는 런은 사실상 없어야 한다',
      // ⚠️ `'overall'` 이면 안 된다. 전체 0.8% 로 통과하던 시절 **Lv100 만 10.6%**(니플헤임
      // 44.8%)였다 — 만렙 추격 런의 절반 가까이가 5분을 넘겨도 끝나지 않는데 게이트는 초록이었다.
      scope: 'level',
    },
  },
  runLevelUps: {
    label: '런내 레벨업',
    kind: 'mean',
    of: (s) => Math.max(0, s.level - 1),
    target: {
      min: 5,
      max: 8,
      source: 'ADR-0036 개정 2 · balance-impl §2.3 런 리듬',
      scope: 'overall',
    },
  },
  lootPerRun: {
    label: '장비유입',
    kind: 'mean',
    digits: 2,
    of: (s) => s.loot.length,
    target: {
      min: 2,
      max: 3,
      source: 'ADR-0035 §3.1 — 런당 장비 2~3개',
      scope: 'overall',
    },
  },
  /**
   * 런 종료 시점에 **살아남은 반격 장치 수**(추격 모드 전용, 그 외 모드는 항상 0).
   *
   * B7(만렙 추격 런이 끝나지 않는다)의 처방을 가르는 진단 지표다. 타임아웃 런에서 이 값이
   * 0 이면 "취약화까지 갔는데 포식자를 못 잡는 것"이고, 1 이상이면 "장치를 못 깨는 것"이라
   * 손댈 축이 완전히 갈린다(장치 HP·수 ↔ 취약화 후 보스 HP·DPS).
   *
   * 전 런 평균이라 **승리 런(항상 0)이 섞여 희석된다** — 판정은 `runs.json` 을 결과별로
   * 교차집계해서 한다. 표의 이 열은 "추격 모드에 잔존 장치가 존재하는가"의 존재 신호일 뿐이다.
   */
  chaseDevicesLeft: {
    label: '장치잔존',
    kind: 'mean',
    digits: 2,
    of: (s) => (s.config.planetMode === PLANET_MODE.chase ? chaseAliveCounterDevices(s) : 0),
  },
  metaXp: { label: '메타XP', kind: 'mean', digits: 0, of: (s) => s.xpTotal },
  kills: { label: '처치', kind: 'mean', digits: 0, of: (s) => s.kills },
  killsPerSec: { label: '처치/초', kind: 'mean', digits: 2, of: (s) => (s.tick > 0 ? (s.kills * 60) / s.tick : 0) },
  gems: { label: '젬', kind: 'mean', digits: 0, of: (s) => s.gems },
  resources: { label: '자원', kind: 'mean', digits: 0, of: (s) => s.resources },
  bossDps: {
    label: '보스DPS',
    // 0 = "관측 창 없음"(스폰 틱 즉사)이지 "피해 0"이 아니다 — 승리는 정의상 보스 처치라
    // 피해 0 인 승리 런은 존재할 수 없다. 그래서 0 을 표본에서 뺀다(`cell.ts` 승리 보정 주석).
    kind: 'winPosMean',
    digits: 0,
    of: (_s, t) =>
      t.bossHp0 >= 0 && t.bossTicks > 0 ? ((t.bossHp0 - t.bossHpLast) * 60) / t.bossTicks : 0,
  },
};

/** 지표 키 목록(열거 순서 = 리포트 열 순서). */
export const METRIC_KEYS: readonly string[] = Object.keys(RUN_METRICS);

/** 목표 밴드가 붙은 지표만. 게이트 생성기가 쓴다. */
export function gatedMetricKeys(): string[] {
  return METRIC_KEYS.filter((k) => RUN_METRICS[k]?.target !== undefined);
}

/** 종료 상태 + trace → 전 지표 값. */
export function extractMetrics(s: WorldState, t: RunTrace): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of METRIC_KEYS) {
    const def = RUN_METRICS[key];
    if (def === undefined) continue;
    out[key] = def.of(s, t);
  }
  return out;
}
