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
 * 단계 1 은 구 정찰(tier 0)의 **연속 축**(hpMult 1·subBullets 0·densityMult 1)을 그대로 보존한다.
 *
 * ⚠️ **`eliteCount` 만은 예외다** — 구 계약은 "단계1 = eliteCount 0 → 기존 스폰/패턴/해시 불변"
 * (ADR-0022 결정론 규율 1)이었으나 **ADR-0035 가 이를 의도적으로 깼다**. 근거: 엘리트가 잡몹
 * 전리품의 유일한 드랍원인데 밴드0(단계1~10)이 0 이라 그 구간에 **드랍원이 아예 없었다**
 * (보스 확정 1개뿐 — `.omc/research/economy-baseline-2026-07-27.md` §3). ADR-0035 Consequences
 * 가 "저단계(1~10)도 `eliteCount ≥ 1` 로 올려야 드랍원이 생긴다"고 명시적으로 요구한다.
 * 대가는 단계1 PvE 골든 해시 재생성이고, 침공(PvP)은 `updateWaves` 를 아예 돌리지 않아 무영향이다.
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
 *
 * `eliteCount` 는 ADR-0035 이후 **순수 난이도 노브**다 — 드랍 수량은 여기서 나오지 않고
 * `eliteDropChance`(`src/sim/drops.ts`)가 이 값에 **반비례**해 런당 기대 수량을 고정한다.
 * 그래서 적 곡선 레인은 이 값을 자유롭게 움직여도 인벤 유입을 흔들지 않는다.
 *
 * ## ⚠️ 세 노브 전부 난이도 레버로는 쓸 수 없다 (2026-07-27 Lane D 실측)
 * 표준 빌드 96시드 스윕에서 **셋 다 클리어율을 못 움직이거나 오히려 거꾸로 갔다**:
 *  - `densityMult` 1 → 3: 결과가 **바이트 동일**. 이 값은 온스크린 **상한**만 올리는데 상한이
 *    애초에 binding 이 아니다(짝인 유입 축은 `src/sim/waves.ts` 의 `PVE_DENSITY_MULT` 로 따로 있다).
 *  - `eliteCount` 1 → 4 / `subBullets` 0 → 6: 각각 |Δ| ≤ 3pp(SE ±4.7pp 안 — 유의하지 않다).
 *  - 셋을 **동시에** 올리면(단계11 에서 elite 4·sub 4·density 2) 클리어율이 71.9% → 88.5% 로
 *    **16.6pp 올라간다**. 적을 더 많이·더 세게 내보낼수록 처치·젬이 늘어 런 내 파워업이 앞당겨지는
 *    쪽이 더 크다 — 즉 **역방향 레버**다.
 * 그래서 이 표는 2026-07-27 밸런스 패스에서 **손대지 않고 그대로 뒀다**. 난이도는 `killGoal`(절대
 * 수준)과 `HP_ANCHOR_*`(단계 기울기)가 진다. 상세는 `.omc/research/enemy-curve-tuned-2026-07-27.md`.
 */
export const STAGE_MILESTONES: readonly StageMilestone[] = [
  // 밴드0(구 정찰): eliteCount 는 ADR-0035 로 0 → 1(저단계 드랍원 확보). 위 StageParams 주석 참조.
  { minStage: 1, eliteCount: 1, subBullets: 0, densityMult: 1 }, // 밴드0 (구 정찰)
  { minStage: 11, eliteCount: 1, subBullets: 0, densityMult: 1 }, // 밴드1 (구 교전)
  { minStage: 21, eliteCount: 2, subBullets: 3, densityMult: 1.5 }, // 밴드2 (구 섬멸)
];

// hpMult 앵커: 밴드 대표값(구 정찰/교전/섬멸의 HP 배율). 곡선은 이 앵커들을 지나는 구간선형.
//
// 2026-07-27 밸런스 패스(ADR-0037 · Lane D)에서 플레이스홀더 `1 / 2.2 / 4.5` 를 실측으로 확정했다.
// 근거·스윕 이력은 `.omc/research/enemy-curve-tuned-2026-07-27.md`.
//
// ⚠️ **HP 는 약한 레버다** — 표준 빌드 96시드 실측에서 hpMult 를 ×1.9 해도 클리어율이 약 3pp 밖에
// 안 내려간다(런 진행이 TTK 가 아니라 **스폰 카덴스**에 묶여 있어, 적 HP 를 올려도 처치 속도가
// 거의 그대로다). 그래서 절대 난이도는 `SEGMENTS.killGoal` 이 지고, 이 앵커들은 **단계 축 기울기**
// (레벨이 오를수록 함께 오르는 부분)만 담당한다. 그 역할에 필요한 크기가 구 플레이스홀더보다
// 훨씬 커서 21 앵커가 4.5 → 22 로 올라갔다.
//
// ⚠️ 21 앵커는 **런 풀 커브(`xpToNext`)와 함께 수렴시킨 값이다.** 런 내 레벨업이 줄면 파워업
// 픽이 줄어 고단계가 먼저 무너지므로, 두 축은 따로 튜닝할 수 없다(적 축만 보면 30 이 맞고,
// `xpToNext` 재보정을 반영하면 22 가 맞다). 최종 확정값·수렴 이력·곡선표는
// `.omc/research/economy-recalibrated-2026-07-27.md` 가 정본이다.
const HP_ANCHOR_STAGE_1 = 1; // 밴드0 대표(구 정찰)
const HP_ANCHOR_STAGE_11 = 4; // 밴드1 대표(구 교전)
const HP_ANCHOR_STAGE_21 = 22; // 밴드2 대표(구 섬멸)

/**
 * hpMult: 단계마다 연속 상향. 앵커 `1 / 4 / 22` 를 지나는 구간선형이고 21+ 는 마지막 기울기
 * (1.8/단계)를 연장한다 — 침략 단계가 무한히 깊어지는 구조라 상한을 두지 않는다.
 *
 * **단계 1 은 `HP_ANCHOR_STAGE_1` 을 그대로 돌려준다**(early-return). 구간선형 식으로 계산하면
 * `(x - 1) * 0 / 10` 경로에서 부동소수 오차가 샐 수 있는데, 단계1 은 골든 해시가 걸린 기준
 * 무대라 **정확한 값**이어야 한다(ADR-0022 결정론 규율 1).
 */
export function stageHpMult(stage: number): number {
  if (stage <= 1) return HP_ANCHOR_STAGE_1; // 단계1 은 앵커 상수를 그대로(구간선형 오차 없음).
  if (stage <= 11) return HP_ANCHOR_STAGE_1 + ((HP_ANCHOR_STAGE_11 - HP_ANCHOR_STAGE_1) * (stage - 1)) / 10;
  if (stage <= 21) return HP_ANCHOR_STAGE_11 + ((HP_ANCHOR_STAGE_21 - HP_ANCHOR_STAGE_11) * (stage - 11)) / 10;
  return HP_ANCHOR_STAGE_21 + ((HP_ANCHOR_STAGE_21 - HP_ANCHOR_STAGE_11) * (stage - 21)) / 10;
}

/**
 * 목표 오브젝트(추격 반격 장치 · 오염 노드) 총 HP 의 **저단계 완화 계수**(1 이하).
 * 단계 1 에서 {@link OBJECTIVE_LOW_STAGE_RELIEF}, {@link OBJECTIVE_RELIEF_ENDS_AT} 이상에서
 * 정확히 1 로 선형 복귀한다.
 *
 * ## 왜 필요한가 (2026-08-03)
 * Lv5 클리어율 53.6%(밴드 60~80% 아래)는 **전 무대 공통이 아니었다** — 카르곤 74% ·
 * 아르케 87% 는 정상이고 **톡사르 31% · 니플헤임 43%** 가 끌어내린다. 둘 다 목표 게이트형이고,
 * 그 무대의 목표 HP 는 단계 1 에서 기울기 항이 0 이라 **정확히 `_HP_BASE`** 다. 그런데 그
 * base 는 중·고레벨 화력을 기준으로 정해진 값이라 화력이 가장 낮은 Lv5 에서 가장 무겁다.
 *
 * base 를 낮추면 전 레벨이 함께 쉬워져 §R12 의 세 손잡이 균형(목표 HP · 피격 배율 · 단계
 * 기울기)이 통째로 무너진다. 그래서 **저단계 구간만** 따로 덜어낸다.
 *
 * ## 왜 `data/waves.ts` 에 있는가
 * `sim/modes/objective.ts` 가 자연스러운 자리지만 그 모듈은 `chase`·`contamination` 을
 * import 하므로, 두 모드가 되받아 import 하면 **순환 의존**이 된다. 이 파일은 두 모드가 이미
 * `stageHpMult` 로 의존하는 leaf 라 방향이 한쪽으로만 흐른다.
 */
export function objectiveLowStageRelief(stage: number): number {
  if (stage >= OBJECTIVE_RELIEF_ENDS_AT) return 1;
  if (stage <= 1) return OBJECTIVE_LOW_STAGE_RELIEF;
  const t = (stage - 1) / (OBJECTIVE_RELIEF_ENDS_AT - 1);
  return OBJECTIVE_LOW_STAGE_RELIEF + (1 - OBJECTIVE_LOW_STAGE_RELIEF) * t;
}

/**
 * 단계 1 의 목표 총 HP 완화 폭. 근거는 {@link objectiveLowStageRelief}. TODO(밸런스).
 *
 * | 완화 | 니플헤임 Lv5 | 톡사르 Lv5 | 니플 전체 | 톡사르 전체 |
 * |---|---|---|---|---|
 * | 없음(1.0) | 43% | 31% | 69.5% | 64.2% |
 * | 0.7 | 50% | 41% | 66.6% | 60.9% |
 * | **0.45** | **60%** | **56%** | **68.8%** | **63.7%** |
 */
export const OBJECTIVE_LOW_STAGE_RELIEF = 0.45;
/** 이 단계부터 완화가 사라진다(계수 1). 단계 = `ceil(Lv/5)` 이므로 4 는 Lv16~20 이다. */
export const OBJECTIVE_RELIEF_ENDS_AT = 4;

/**
 * 단계 파라미터 조회. hpMult 는 연속 함수, 나머지(정예·서브탄·밀도)는 `stage` 이하 최대
 * `minStage` 밴드에서 온다. 범위 밖(<1)은 단계 1로 클램프.
 *
 * `stageParams(1)` = `{hpMult:1, densityMult:1, eliteCount:1, subBullets:0}` — 연속 축은 구 정찰과
 * 동일하고 `eliteCount` 만 ADR-0035 로 1 이 됐다(저단계 드랍원 확보 — 위 StageParams 주석).
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
 * killGoal 튜닝(ADR-0011): 후반일수록 적 상한↑(밀도↑)으로 처치가 빨라지므로 목표를 완만히만
 * 올린다. 강한 빌드는 이보다 빨리 채워 런이 짧아지고(창발), 약하면 급행 소환으로 몹이 쌓여 길어진다.
 *
 * ## 2026-07-27 밸런스 패스 — 합계 80 → 240 처치 (ADR-0037 · Lane D)
 * 구값 `[10,14,16,18,22]`(합계 80)는 **무장비 기본 로드아웃** 기준으로 잡힌 것이었다. 표준 진행
 * 경로(ADR-0035)가 정의한 **표준 레벨·표준 장비·표준 투자** 빌드로 재보니 런이 **33초**만에
 * 끝났다(par 150초 대비 22%) — 클리어율도 전 밴드 92~100% 로 합격선(60~80%)을 통째로 넘겼다.
 *
 * `killGoal` 합계를 **80 → 240(×3)** 으로 올린 것이 이 레인의 **주 레버**다. 다른 후보 레버
 * (HP·밀도·정예·서브탄·급행 램프)는 전부 효과가 3pp 이하이거나 역방향이었다
 * (`STAGE_MILESTONES` 주석 참조). 근본 원인은 런 진행이 **처치 속도가 아니라 스폰 카덴스**에
 * 묶여 있다는 것이다 — 그래서 "얼마나 오래 버티나"를 정하는 것은 처치 **할당량**뿐이다.
 *
 * ⚠️ **합계 240 만이 레버다.** 세그먼트 간 재배분은 카드 수·드랍 수량을 바이트 동일하게
 * 재현한다(실증). 반대로 **합계를 바꾸면** `src/sim/drops.ts` 의 `EXPECTED_CARDS_PER_RUN` 과
 * `src/sim/world.ts` 의 `xpToNext` 계수를 **둘 다 다시 재야 한다** — 런 길이가 카드 수와
 * 런 풀 XP 를 동시에 끌기 때문이다.
 *
 * ⚠️ par 150초에는 아직 못 닿았다(실측 약 90~102초). 닿으려면 추가로 약 ×1.5 가 필요한데
 * 그러면 저밴드가 60% 아래로 떨어져 합격선을 깬다.
 *
 * 최종 확정 곡선표(밴드 1~20 클리어율·레벨업·런 길이)와 수렴 이력의 정본은
 * `.omc/research/economy-recalibrated-2026-07-27.md` 다.
 *
 * ## ⚠️ 침공 해시 — `SEGMENTS[0].killGoal` 은 10 그대로 둔다
 * 증가분 160 을 index 1·2·4·5 에만 분배했다(`[10,46,53,59,72]`). **index 0 만은 못 건드린다** —
 * `initWaveRuntime`(`src/sim/waves.ts:76`)이 `segmentKillGoal` 을 `SEGMENTS[0].killGoal` 로
 * 초기화하고 `hashWorld` 가 그 필드를 접기 때문에(`src/sim/replay.ts:398`), 이 값을 바꾸면
 * **침공(PvP) per-tick 해시가 통째로 달라진다**. 침공은 `updateWaves` 를 아예 안 돌려 이 값이
 * **거동상 죽은 값**인데도 그렇다. 실측 확인: index 0 을 30 으로 올렸을 때
 * `tests/encounterHashInvariance.test.ts` 의 AC2 침공 해시 가드 3건(`invasion/4242`·`48879`·`4951`)과
 * `tests/midClash.test.ts` 의 `SEGMENTS[0]` 불변 계약이 깨졌고, 10 으로 되돌리자 전부 복구됐다.
 * 원래 비율(14:16:18:22)을 유지해 230 을 분배했으므로 뒤 4개 세그먼트의 상대 램프는 그대로다.
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
  // ⚠️ index 0 의 killGoal 10 은 **의도적으로 불변**이다 — 아래 "침공 해시" 절 참조.
  { index: 0, killGoal: 10, maxEnemies: 12, bulletCap: 300, cardInterval: 220, boss: false },
  { index: 1, killGoal: 40, maxEnemies: 20, bulletCap: 600, cardInterval: 200, boss: false },
  { index: 2, killGoal: 46, maxEnemies: 28, bulletCap: 900, cardInterval: 180, boss: false },
  // 중반 격전 세그먼트(ADR-0032). killGoal 0 = 처치 할당 게이트 미사용(리더 처치가 게이트).
  // 예산은 index 2 ↔ index 4 사이 값 — TODO(밸런스): 출시 전 일괄 튜닝.
  { index: 3, killGoal: 0, maxEnemies: 32, bulletCap: 1000, cardInterval: 170, boss: false, clash: true },
  { index: 4, killGoal: 52, maxEnemies: 36, bulletCap: 1200, cardInterval: 160, boss: false },
  { index: 5, killGoal: 63, maxEnemies: 44, bulletCap: 1600, cardInterval: 150, boss: false },
  // 보스 세그먼트: killGoal 0(보스 처치로만 종료). cardInterval을 실제 값으로 낮춰
  // 보스전에도 일반몹이 계속 등장한다(급행 소환 램프가 여기서도 돌아 긴 꼬리를 캡).
  { index: 6, killGoal: 0, maxEnemies: 14, bulletCap: 2000, cardInterval: 200, boss: true },
];

/**
 * 카르곤 웨이브 카드 풀(10장 — M1 의 8장 + 2026-08-04 정예 2장).
 *
 * ⚠️ **정예 카드 2장을 뒤에 붙이면서 풀 길이가 8 → 10 이 됐다.** 카드 추첨은 `waveRng` 로
 * 인덱스를 뽑으므로 길이가 바뀌면 **같은 시드라도 카르곤 런의 웨이브 구성이 통째로 갈린다** —
 * 카르곤 골든 해시·fixture 는 이 커밋에서 재생성해야 한다. 다른 행성은 자기 풀을 쓰므로
 * 영향이 없다. 정예 카드는 다른 행성(`BERDAN_CARD_POOL` 의 `brd-sentinel-guard` ·
 * `brd-brood-charge`)과 **같은 모양**이다 — 카르곤만 정예가 안 나오던 공백을 메우는 것이 목적이라
 * 새 형태를 발명하지 않았다.
 */
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
  // --- 정예 2장(2026-08-04) — 인덱스 0 = 용암 포대, 1 = 마그마 파쇄기(`KARGON_ELITES` 순서). ---
  {
    id: 'lava-battery-guard',
    formation: 'edges',
    spawns: [
      { elite: 0, count: 1 },
      { role: 'gunner', count: 3 },
    ],
  },
  /**
   * ⚠️ 호위는 **1기**다(베르단의 같은 카드는 3기).
   *
   * 3기로 두면 `tests/enemyVisual.test.ts` 의 **돌진 예고 듀티**가 최악 셀에서 35.6% → 52.5% 로
   * 뛴다 — 즉 그 창에서 화면 절반 이상 동안 돌진 예고가 떠 있어 "예고가 배경이 되는" 상태다.
   * 정예 자신이 이미 돌격형이라 호위까지 돌격형으로 채우면 같은 신호가 겹쳐 쌓인다.
   * 카르곤 차저(파쇄차)의 예고가 다른 행성보다 길어 이 행성에서만 드러나는 축이다.
   */
  {
    id: 'magma-colossus-field',
    formation: 'line',
    spawns: [
      { elite: 1, count: 1 },
      { role: 'gunner', count: 2 },
      { role: 'support', count: 1 },
    ],
  },
];
