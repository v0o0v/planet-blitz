/**
 * Wave content — 6-segment budget table + an 8-card spawn pool (spec R3, §수치).
 *
 * A run is 6 segments. Each segment periodically draws a spawn *card* from the
 * pool via the seeded wave RNG, so the enemy composition varies per seed while
 * the per-segment budget (onscreen enemy cap + simultaneous enemy-bullet cap)
 * bounds difficulty and performance. The 6th segment is the boss slot — M1
 * Phase 2 marks the transition; the boss fight itself is Phase 3 (plan task 15).
 *
 * Budget values (enemy cap 12→20→28→36→44, bullet cap 300→600→900→1,200→1,600
 * →2,000) are taken directly from the spec's 구간 예산표.
 *
 * 런 길이 창발(ADR-0011): 세그먼트 진행은 고정 타이머가 아니라 **처치 할당**(killGoal)
 * 게이트로 넘어간다. 채우지 못한 동안 **급행 소환**(RUSH_* 램프)이 유효 적 상한을 올리고
 * 카드 간격을 좁혀 압박을 누적한다 — 강하면 빨리 채워 짧게, 약하면 몹이 쌓여 길게(또는
 * 사망)로 런 길이가 창발한다. 기준 시간(par) ≈ 2분(웨이브 약 1분 + 보스 약 1분).
 */

import type { EnemyRole } from '../src/sim/patterns/types.js';

export type Formation = 'ring' | 'line' | 'edges' | 'cluster';

// ---------------------------------------------------------------------------
// 침략 단계 (ADR-0022: 난이도 3티어 폐지 → 행성별 독립 1..∞ 정수 축)
// ---------------------------------------------------------------------------

/** 레벨 캡(plan §3 — 기체 레벨은 침략 단계를 잠그지 않는 순수 난이도 앵커). */
export const LEVEL_CAP = 100;

/**
 * 단계 파라미터 — 패턴 엔진·웨이브 디렉터에 데이터로 주입. 구 `TierParams` 와 동형(이름만).
 * "수치만 다른 단계" 금지(원칙4): 질적 요소(정예·서브탄·밀도)는 구간 마일스톤에서만 오르고,
 * 그 사이는 HP만 연속 상향한다.
 *
 * 단계 1 은 구 정찰(tier 0) 거동을 그대로 보존한다(hpMult 1·subBullets 0·densityMult 1·
 * eliteCount 0 → 기존 스폰/패턴/해시 불변, ADR-0022 결정론 규율 1).
 */
export interface StageParams {
  /** 적 스폰 HP 배율(연속 상향). */
  readonly hpMult: number;
  /** 온스크린 적 상한 배율(밀도↑). */
  readonly densityMult: number;
  /** 카드당 정예 승격 수. */
  readonly eliteCount: number;
  /** 패턴 변형: 적 공격당 추가 서브탄 수(fragments 밀도↑ / mortar 방사 추가). */
  readonly subBullets: number;
}

/** 한 구간 마일스톤: `minStage` 이상에서 이 질적 요소들이 해금된다. */
export interface StageMilestone {
  readonly minStage: number;
  readonly eliteCount: number;
  readonly subBullets: number;
  readonly densityMult: number;
}

/**
 * 구간 마일스톤: 정한 경계에서 질적 요소 해금(구 정찰/교전/섬멸을 밴드로 재배치).
 * 경계값(11,21)·계수는 TODO(밸런스): 출시 전 일괄 튜닝.
 */
export const STAGE_MILESTONES: readonly StageMilestone[] = [
  { minStage: 1, eliteCount: 0, subBullets: 0, densityMult: 1 }, // 밴드0 (구 정찰)
  { minStage: 11, eliteCount: 1, subBullets: 0, densityMult: 1 }, // 밴드1 (구 교전)
  { minStage: 21, eliteCount: 2, subBullets: 3, densityMult: 1.5 }, // 밴드2 (구 섬멸)
];

// hpMult 앵커: 밴드 대표값(구 정찰/교전/섬멸의 HP 배율). 곡선은 이 앵커들을 지나는 구간선형.
// TODO(밸런스): 출시 전 일괄 튜닝(앵커값·경계·21+ 기울기 전부 플레이스홀더).
const HP_ANCHOR_STAGE_1 = 1; // 밴드0 대표(구 정찰)
const HP_ANCHOR_STAGE_11 = 2.2; // 밴드1 대표(구 교전)
const HP_ANCHOR_STAGE_21 = 4.5; // 밴드2 대표(구 섬멸)

/**
 * hpMult: 단계마다 연속 상향. **단계 1 = 정확히 1.0**(구 정찰, 결정론 불변 — 부동소수 오차
 * 금지라 `stage <= 1` 은 early-return 1). 곡선 계수 TODO(밸런스): 출시 전 일괄 튜닝.
 * 플레이스홀더: 밴드 대표값(1 / 2.2 / 4.5)을 지나는 구간선형(21+ 는 마지막 기울기 연장).
 */
export function stageHpMult(stage: number): number {
  if (stage <= 1) return 1; // 단계1 ≡ 구 정찰: 정확히 1.0(오차 없음).
  if (stage <= 11) return HP_ANCHOR_STAGE_1 + ((HP_ANCHOR_STAGE_11 - HP_ANCHOR_STAGE_1) * (stage - 1)) / 10;
  if (stage <= 21) return HP_ANCHOR_STAGE_11 + ((HP_ANCHOR_STAGE_21 - HP_ANCHOR_STAGE_11) * (stage - 11)) / 10;
  return HP_ANCHOR_STAGE_21 + ((HP_ANCHOR_STAGE_21 - HP_ANCHOR_STAGE_11) * (stage - 21)) / 10;
}

/**
 * 단계 파라미터 조회. hpMult 는 연속 함수, 나머지(정예·서브탄·밀도)는 `stage` 이하 최대
 * `minStage` 밴드에서 온다. 범위 밖(<1)은 단계 1로 클램프.
 *
 * `stageParams(1)` = `{hpMult:1, densityMult:1, eliteCount:0, subBullets:0}` (구 정찰과 동일).
 */
export function stageParams(stage: number): StageParams {
  const s = stage < 1 ? 1 : stage;
  let band = STAGE_MILESTONES[0] as StageMilestone;
  for (const m of STAGE_MILESTONES) {
    if (s >= m.minStage) band = m;
    else break;
  }
  return {
    hpMult: stageHpMult(s),
    densityMult: band.densityMult,
    eliteCount: band.eliteCount,
    subBullets: band.subBullets,
  };
}

// 개방 규칙(ADR-0022): 도전 가능 상한 = max(10, 그 행성 최고 클리어 단계 + 5). 초기 1~10 개방.
/** 개방 하한(초기 개방 단계 수). */
export const STAGE_OPEN_FLOOR = 10;
/** 최고 클리어 단계 위로 추가 개방되는 단계 수. */
export const STAGE_OPEN_LOOKAHEAD = 5;

/** 그 행성에서 도전 가능한 최고 단계(개방 상한). */
export function stageOpenCap(bestStageCleared: number): number {
  return Math.max(STAGE_OPEN_FLOOR, (bestStageCleared | 0) + STAGE_OPEN_LOOKAHEAD);
}

/** 단계가 개방됐는가(1 ≤ stage ≤ 개방 상한). */
export function isStageOpen(stage: number, bestStageCleared: number): boolean {
  return stage >= 1 && stage <= stageOpenCap(bestStageCleared);
}

/**
 * One spawn group in a wave card. Either a ROLE spawn (resolved against the
 * planet's role roster) or an ELITE spawn (resolved against the planet's elite
 * list by index). The elite variant is optional/additive so existing role-only
 * cards (카르곤) are unchanged; 베르단 cards use it to seed its 엘리트 2종.
 */
export type WaveSpawn =
  | { readonly role: EnemyRole; readonly count: number }
  | { readonly elite: number; readonly count: number };

export interface WaveCard {
  readonly id: string;
  readonly formation: Formation;
  readonly spawns: readonly WaveSpawn[];
}

export interface WaveSegment {
  readonly index: number;
  /**
   * 처치 할당(ADR-0011): 이 세그먼트를 넘어가기 위해 필요한 처치 수. 고정 타이머
   * (구 durationTicks)를 폐지하고 이 목표를 채워야 다음 세그먼트로 진행한다 — 강하면
   * 빨리 채워 짧게, 약하면 오래 걸린다(창발). 보스 세그먼트는 보스 처치(victory)로만
   * 끝나므로 이 값을 게이트에 쓰지 않는다(0).
   */
  readonly killGoal: number;
  /** Max enemies allowed onscreen (spawns pause when reached). */
  readonly maxEnemies: number;
  /** Simultaneous enemy-bullet cap (perf + fairness bound). */
  readonly bulletCap: number;
  /** Ticks between card draws within the segment. */
  readonly cardInterval: number;
  readonly boss: boolean;
  /**
   * 중반 격전 세그먼트인가(ADR-0032). true 면 이 세그먼트는 처치 할당·모드 게이트(스크롤
   * 거리·정화율·대피소·링 전멸)가 아니라 **격전 리더 처치**로 전진한다
   * (`src/sim/modes/midClash.ts`). 선택 필드라 기존 세그먼트 리터럴은 한 글자도 바뀌지 않고,
   * **데이터 전용**이라 `hashWorld` 에 접히지 않는다(해시 폴드는 `WaveRuntime` 7필드뿐).
   */
  readonly clash?: boolean;
}

/**
 * 급행 소환 램프(ADR-0011). 세그먼트에 오래 머물수록(=처치 할당을 못 채울수록) 유효 적
 * 상한을 올리고 카드 간격을 좁혀 압박을 누적한다 — "진행이 늦을수록 화면이 빽빽해지는"
 * 자연 난이도 곡선. 정수 연산·RNG 미소비라 결정론(ADR-0005) 불변. 보스 세그먼트에도
 * 동일하게 돌아, 화력이 부족하면 몹이 쌓여 자연 사망으로 긴 꼬리가 캡된다.
 */
/** 램프 1스텝 간격(틱). ~4s마다 압박이 한 단계 오른다. */
export const RUSH_RAMP_TICKS = 240;
/** 스텝당 유효 적 상한 증가분. */
export const RUSH_ENEMY_STEP = 3;
/** 유효 적 상한 증가분 누적 상한(밀도 폭주·perf 방지). */
export const RUSH_ENEMY_MAX = 30;
/** 스텝당 카드 간격 단축분(틱). */
export const RUSH_INTERVAL_STEP = 8;
/** 카드 간격 하한(틱) — 급행이 최고조여도 이보다 자주 뽑지 않는다. */
export const RUSH_MIN_INTERVAL = 45;

/**
 * 7 segments; index 3 은 중반 격전(ADR-0032), 마지막은 보스 슬롯.
 *
 * killGoal 튜닝(ADR-0011): 적정 레벨·적정 티어(정찰·기본 로드아웃) 오토파일럿 실측으로
 * 5개 일반 세그먼트 합계 ≈ 60초(웨이브 par)에 맞춘 값. 합계 80처치 = [10,14,16,18,22].
 * 후반일수록 적 상한↑(밀도↑)으로 처치가 빨라지므로 목표를 완만히만 올린다. 강한 빌드는
 * 이보다 빨리 채워 런이 짧아지고(창발), 약하면 급행 소환으로 몹이 쌓여 길어진다.
 *
 * ## 중반 격전 삽입(ADR-0032) — 왜 index 3 인가
 * "보스전까지 플레이 타임 +30초" 요구는 처치 할당 패딩(같은 잡몹을 더 죽이기)이 아니라
 * **중반 클라이맥스 비트**로 채운다. 전용 세그먼트를 **정확히 중반**(일반 세그먼트 5개의
 * 한가운데)에 끼워 앞뒤 난이도 곡선이 대칭으로 남게 했다 — 앞 3개(10/14/16 처치)로 빌드를
 * 세우고, 격전에서 정점을 찍고, 뒤 2개(18/22)로 보스까지 밀어붙인다. 예산(maxEnemies·
 * bulletCap·cardInterval)은 인접 세그먼트(index 2 ↔ index 4) 사이 값의 플레이스홀더다.
 *
 * `killGoal: 0` 인 이유: 격전 세그먼트는 **처치 할당 게이트를 타지 않는다**. 전진 조건은
 * 격전 리더 처치이고(`src/sim/modes/midClash.ts` — 마커 엔티티 생존 스캔 파생), 그 판정이
 * `updateWaves` 의 cleared 체인 맨 앞에서 다른 모든 게이트보다 먼저 결정된다.
 *
 * ## 해시 영향
 * - **침공(invasion3)은 바이트 불변**이다 — `world.ts` 가 `if (!designedRun) updateWaves(...)`
 *   로 웨이브 디렉터를 아예 돌리지 않으므로 SEGMENTS 를 읽지도 않는다. 그래서 `SEGMENTS[0]`
 *   값과 보스 슬롯(`boss: true`)만 건드리지 않으면 침공 baseline 이 그대로다(계획 AC2).
 * - **PvE baseline 해시는 바뀐다** — 격전은 매 런 확정 등장이라 모든 PvE 런의 스폰·진행이
 *   달라진다. 이는 설계상 의도된 변경이고 **골든 재생성으로 흡수**한다(계획 AC3:
 *   골든 재생성 + CHANGELOG + verify-pve-sample 재배포).
 *
 * `index` 는 정보용 필드라(런타임은 배열 위치로만 조회한다) 삽입 후 0..6 으로 재번호했다.
 */
export const SEGMENTS: readonly WaveSegment[] = [
  { index: 0, killGoal: 10, maxEnemies: 12, bulletCap: 300, cardInterval: 220, boss: false },
  { index: 1, killGoal: 14, maxEnemies: 20, bulletCap: 600, cardInterval: 200, boss: false },
  { index: 2, killGoal: 16, maxEnemies: 28, bulletCap: 900, cardInterval: 180, boss: false },
  // 중반 격전 세그먼트(ADR-0032). killGoal 0 = 처치 할당 게이트 미사용(리더 처치가 게이트).
  // 예산은 index 2 ↔ index 4 사이 값 — TODO(밸런스): 출시 전 일괄 튜닝.
  { index: 3, killGoal: 0, maxEnemies: 32, bulletCap: 1000, cardInterval: 170, boss: false, clash: true },
  { index: 4, killGoal: 18, maxEnemies: 36, bulletCap: 1200, cardInterval: 160, boss: false },
  { index: 5, killGoal: 22, maxEnemies: 44, bulletCap: 1600, cardInterval: 150, boss: false },
  // 보스 세그먼트: killGoal 0(보스 처치로만 종료). cardInterval을 실제 값으로 낮춰
  // 보스전에도 일반몹이 계속 등장한다(급행 소환 램프가 여기서도 돌아 긴 꼬리를 캡).
  { index: 6, killGoal: 0, maxEnemies: 14, bulletCap: 2000, cardInterval: 200, boss: true },
];

/** 8-card spawn pool drawn from throughout a run (spec 웨이브 카드 풀 초안). */
export const CARD_POOL: readonly WaveCard[] = [
  { id: 'charger-rush', formation: 'line', spawns: [{ role: 'charger', count: 4 }] },
  { id: 'gunner-line', formation: 'edges', spawns: [{ role: 'gunner', count: 3 }] },
  {
    id: 'mixed-assault',
    formation: 'ring',
    spawns: [
      { role: 'charger', count: 2 },
      { role: 'gunner', count: 2 },
    ],
  },
  { id: 'special-field', formation: 'cluster', spawns: [{ role: 'special', count: 2 }] },
  {
    id: 'support-escort',
    formation: 'ring',
    spawns: [
      { role: 'support', count: 1 },
      { role: 'charger', count: 3 },
    ],
  },
  { id: 'encircle', formation: 'ring', spawns: [{ role: 'charger', count: 6 }] },
  { id: 'bombard', formation: 'edges', spawns: [{ role: 'gunner', count: 4 }] },
  {
    id: 'heavy-column',
    formation: 'edges',
    spawns: [
      { role: 'special', count: 1 },
      { role: 'gunner', count: 2 },
      { role: 'support', count: 1 },
    ],
  },
];
