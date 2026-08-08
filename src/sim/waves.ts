/**
 * Wave director — segment progression + seeded card draws (spec R3).
 *
 * Runs on a dedicated RNG stream (`world.waveRng`, forked once at creation) so
 * enemy composition is a pure function of the seed and independent of how many
 * numbers other subsystems draw. Per tick it advances the segment clock, draws a
 * spawn card when due, and materialises its enemies at formation positions —
 * always respecting the segment's onscreen enemy cap. The 6th segment is the
 * boss slot: it stops normal spawns and raises `boss` for Phase 3 to hook.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
// 촉매 그림자 제외(ADR-0052). `catalyst/shared.ts` 는 리프라 순환이 생기지 않는다.
import { isCatalystShadow } from './catalyst/shared.js';
// `id 33 berdan-collapse` — 안전 원의 중심과 즉사 창 게이트 잠금. 미소지 런은 각각 `0`·`false`
// 라 아래 두 자리가 **종전과 비트 동일**이다. 간선 방향(모드→촉매 읽기)의 사유는 그쪽 §주석.
import {
  berdanSafeCenterX,
  berdanSafeCenterY,
  berdanCollapseLocked,
} from './catalyst/shared.js';
// `id 13 enlightenment` 의 급행 램프 배율. **이 방향만 성립한다** — `catalyst/growth.ts` 가
// `waves.js` 를 값으로 끌면 순환이라, 그쪽은 적 수를 직접 센다(그 파일 §주석에 근거).
import { enlightenmentRushStepMult } from './catalyst/growth.js';
import { blankEntity, addEntity } from './entities.js';
// 밀도 패스 계수(2026-08-08 사용자 결정) — 사유·짝 관계는 그 모듈 헤더가 정본이다.
import {
  ENEMY_BULLET_CAP_MULT,
  ENEMY_COUNT_MULT,
  enemyDamageScale,
  ENEMY_HP_MULT,
  scaledFireCooldown,
} from './enemyScale.js';
import type { EnemyDef } from './patterns/types.js';
import { ENEMY_BY_TYPE } from '../../data/enemies.js';
import {
  SEGMENTS,
  stageParams,
  RUSH_RAMP_TICKS,
  RUSH_ENEMY_STEP,
  RUSH_ENEMY_MAX,
  RUSH_INTERVAL_STEP,
  RUSH_MIN_INTERVAL,
} from '../../data/waves.js';
import type { WaveCard, Formation } from '../../data/waves.js';
import { planetContent } from '../../data/planets/index.js';
import { cos, sin, PI, TWO_PI } from './math.js';
import { OFFSCREEN_X, OFFSCREEN_Y, SPAWN_RING_RADIUS, VIEW_HEIGHT } from './constants.js';
import { makeElite, isElite, ELITE_AFFIX_COUNT } from './elite.js';
import { COMMISSION_ELITE_OVERLAP_MIN } from '../run/commissionConstants.js';
import { PLANET_MODE } from './planetMode.js';
import { windowCenterX, windowCenterY } from './invasion/scroll.js';
import {
  commissionSuppressesCardSpawns,
  decideEliteDeploy,
  isEliteSummons,
} from './commissionOrders.js';
import {
  blockBreakProgress,
  BLOCKBREAK_SECTION_LENGTH,
  BLOCKBREAK_SPAWN_AHEAD,
} from './modes/blockBreak.js';
import { racingProgress, RACING_SECTION_LENGTH, RACING_SPAWN_AHEAD } from './modes/racing.js';
import { contaminationPurifyRate, CONTAMINATION_PURIFY_THRESHOLD } from './modes/contamination.js';
import { chaseSegmentCleared } from './modes/chase.js';
import { shrinkRingCleared, shrinkSpawnRadius, SHRINK_GRACE_TICKS } from './modes/shrink.js';
// 중반 격전(ADR-0032). ⚠️ midClash 는 이 모듈의 `summonEnemy` 를 되가져오므로 모듈 순환이
// 하나 생긴다 — 양쪽 다 호이스팅되는 함수 선언이고 모듈 평가 시점이 아니라 **호출 시점**에만
// 서로를 참조하므로 안전하다(midClash.ts 헤더 "순환 의존 주의" 참조).
import { spawnMidClash, midClashCleared } from './modes/midClash.js';

export interface WaveRuntime {
  segmentIndex: number;
  /**
   * 현재 세그먼트에 머문 틱 수(구 segmentTimer 대체, ADR-0011). 카운트다운이 아니라
   * 진입 시 0에서 매 틱 증가하며 급행 소환 램프의 입력이 된다 — 오래 머물수록 압박↑.
   */
  segmentElapsed: number;
  cardTimer: number;
  /** Boss segment reached — Phase 3 spawns the fight; Phase 2 just flags it. */
  boss: boolean;
  /** Run fully complete (all segments elapsed). */
  done: boolean;
  /**
   * 처치 할당 게이트(ADR-0011): 세그먼트 진입 시점의 state.kills 스냅샷. 진행도 =
   * state.kills - segmentBaseKills 로, 이 값이 segmentKillGoal에 도달하면 다음으로 넘어간다.
   */
  segmentBaseKills: number;
  /** 현재 세그먼트를 넘어가기 위한 처치 수(현재 세그먼트 데이터의 killGoal). */
  segmentKillGoal: number;
  /**
   * 정예 소집령(ADR-0043) 겹침 시계 — **직전 틱의 살아 있는 정예 수**. 전멸 에지
   * (`>0` → `0`)를 잡는 데만 쓴다. 의뢰 이외의 런에서는 끝까지 0 이라 무연산이다.
   *
   * ## ⚠️ 왜 `CommissionRuntime` 이 아니라 여기인가 (계약 초안과의 의도적 차이)
   * 계약은 이 둘을 `CommissionRuntime` 에 두고 "구간마다 새 월드라 자동 리셋"이라고 적었다.
   * **그 전제가 틀렸다** — `commissionCarry.ts` 의 `WORLD_CARRY` 가 `commissionRuntime` 을
   * **객체 참조째** 승계하므로(`totalTicks` 누적이 그 이유다) 거기 얹은 필드는 구간을 넘어
   * 그대로 살아남는다. `eliteNextTick` 은 `state.tick` 과 비교되는데 `tick` 은 구간마다 0 으로
   * 돌아가므로, 1구간 말의 큰 값이 넘어오면 **2구간 내내 정예가 한 기도 안 나온다**.
   * 결정론적이라 해시가 안 갈리고 "2구간이 텅 비었다"로만 보인다(`tick` 승계 결함과 같은 은폐 형태).
   * `WaveRuntime` 은 `WORLD_FRESH` 라 `createWaveRuntime()` 이 구간마다 진짜로 0 을 준다.
   *
   * ⚠️ **`hashWorld` 는 이 둘을 접지 않는다**(wave 폴드는 필드를 이름으로 열거한다). 자인
   * 사항이다 — 대신 이 시계가 만들어 내는 **엔티티(정예)는 접히므로** 두 값이 갈리면 발산이
   * 늦어도 다음 투입 틱에 스트림에 드러난다.
   */
  eliteAlivePrev: number;
  /** 정예 소집령 겹침 시계 — **다음 투입이 가능해지는 틱**. 위 필드의 주석이 계약 전부다. */
  eliteNextTick: number;
  /**
   * 정예 소집령 겹침 시계 — **현재 허용 겹침 상한**(`decideEliteDeploy` 의 `cap`).
   * 위 두 필드와 같은 규율(WaveRuntime 소속·미폴드)이다.
   *
   * 이 축이 없으면 겹침이 `COMMISSION_ELITE_OVERLAP_MIN` 에 영구 고정되어 ADR-0043 의 압박
   * 누적이 성립하지 않는다 — 자세한 근거는 `commissionOrders.ts` 의 `EliteDeployState.cap`.
   */
  eliteCap: number;
}

export function createWaveRuntime(): WaveRuntime {
  const first = SEGMENTS[0];
  return {
    segmentIndex: 0,
    segmentElapsed: 0,
    cardTimer: 0, // draw the opening card immediately
    boss: false,
    done: false,
    segmentBaseKills: 0,
    segmentKillGoal: first ? first.killGoal : 0,
    // 정예 소집령 시계. 둘 다 0 = "아직 아무것도 안 나왔고 지금 당장 투입 가능" 이라
    // 첫 정예가 tick 0 에 내려온다(무의뢰 런은 스포너가 아예 안 불린다).
    eliteAlivePrev: 0,
    eliteNextTick: 0,
    // 상한은 하한에서 출발한다 — 압박은 "못 치우는 시간"이 쌓여야 붙는다.
    eliteCap: COMMISSION_ELITE_OVERLAP_MIN,
  };
}

/**
 * PvE 적 밀도 배율 (사용자 요청 2026-07-26 — "몹 개수가 현재보다 두배 정도").
 *
 * ## 왜 배율이 두 곳에 걸려야 하는가
 * 화면 위 적 수는 **상한**(`seg.maxEnemies`)과 **유입**(카드 스폰 수) 두 축의 곱으로 결정된다.
 * 상한만 올리면 카드가 그 상한을 못 채워 체감이 거의 안 바뀌고, 유입만 올리면 상한에서 잘려
 * 나가 그것도 안 바뀐다. 그래서 같은 배율을 둘에 똑같이 걸어 **채움 동역학은 그대로 두고
 * 규모만** 키운다(상한 도달 시간·상한 대비 점유율이 배율 전과 동일하다).
 *
 * ## 왜 2 가 아니라 1.5 인가 (실측 근거 — 사용자 확인 2026-07-26)
 * 요청은 "두배 정도"였지만 2 는 난이도를 요청 취지 밖으로 밀어낸다. 무장갑 오토파일럿(적정
 * 티어 기준 빌드)으로 카르곤 단계1 을 18시드 돌린 클리어율:
 *
 * | 배율 | 클리어 | 비고 |
 * |---|---|---|
 * | 1.0 | 5/18 (28%) | 기준선(문서 기록 밴드 33~63%) |
 * | 1.5 | 5/18 (28%) | **기준선과 동일 — 사실상 무비용** |
 * | 2.0 | 2/18 (11%) | 기준 빌드가 평균 26초에 사망 |
 *
 * 비선형인 이유: 1.5 까지는 무리가 플레이어에 도달하기 전에 죽지만, 2 에서는 무리가 플레이어를
 * **포위**해 화력이 분산되고 그대로 무너진다. 그래서 "체감 물량은 오르지만 난이도 곡선은
 * 건드리지 않는" 지점인 1.5 를 택했다. 물량을 더 올리려면 밸런스 보정(적 HP·killGoal·생존성)이
 * 같이 와야 한다 — 그건 출시 직전 일괄 밸런스 패스의 몫이다.
 *
 * ⚠️ 유입 축은 `s.count * MULT` 를 **루프 상한**으로 쓰므로(`i < count * 1.5`) 소수 배율에서
 * **올림**이 된다 — 내림이 아니다. 실측 표:
 *
 * | 카드 count | 실제 스폰 | 실효 배율 |
 * |---|---|---|
 * | 1 | 2 | **2.00×** |
 * | 2 | 3 | 1.50× |
 * | 3 | 5 | **1.67×** |
 * | 4 | 6 | 1.50× |
 * | 6 | 9 | 1.50× |
 *
 * 즉 `count: 1` 인 단일 스폰 역할(`data/waves.ts` 의 support·special 등)은 실효 2배가 된다.
 * 위 클리어율 표는 **이 거동 그대로** 측정한 값이므로 선택의 근거는 그대로 유효하다. 배율을
 * 다시 만질 사람이 "1.5 면 전부 1.5 배" 라고 계산하지 않도록 여기 못 박아 둔다 — 이 주석은
 * 한때 정반대("내림, 3 → 4")로 적혀 있었고 리뷰에서 잡혔다. 균일한 1.5 배를 원하면
 * `Math.floor(s.count * PVE_DENSITY_MULT)` 로 바꿔야 하는데, 그러면 밀도가 실제로 내려가므로
 * 클리어율 재측정과 전 PvE 골든 재녹화가 함께 와야 한다.
 *
 * ## 침공(invasion3)은 왜 영향이 없는가
 * `updateWaves` 자체가 `stepWorld` 의 `!designedRun` 게이트 안에서만 불린다 — 침공은 절차
 * 생성 웨이브를 아예 돌리지 않고 설계된 방어 기지만 상대한다. 따라서 `data/waves.ts`
 * SEGMENTS 원본 값을 건드리지 않는 이 방식은 **침공 해시에 한 바이트도 닿지 않는다**(그쪽
 * baseline 이 SEGMENTS 값에 걸려 있다는 경고는 원본 상수를 고칠 때의 이야기다).
 * 이 브랜치가 침공 해시를 바꾼 것은 이 상수가 아니라 **선분 판정**(`sweptCircleOverlap`)
 * 때문이다 — `resolveCollisions` 는 침공도 타기 때문이고, 그래서 EF 재배포가 필요하다.
 *
 * PvE 해시 기준선은 당연히 바뀐다 — 이 값을 고치면 PvE 골든을 재녹화해야 한다.
 */
export const PVE_DENSITY_MULT = 1.5;

/**
 * **수축(베르단) 전용 카드 추첨 간격 배율** — 1 초과 = 유입 감소.
 *
 * ## 왜 이 무대에만 거는가 (구조적 근거 — 실측만으로 고른 값이 아니다)
 * 수축은 여섯 무대 중 유일하게 **적 자체가 진행 게이트**다(`shrinkRingCleared` — 안전 반경 안
 * 적 전멸). 다른 무대에서 웨이브는 피해원이면서 동시에 젬·전리품을 내는 **성장 자원**이라
 * 유입을 줄이면 플레이어가 굶는다. 수축에서만 유입 감소가 "피해 감소 + 진행 가속"으로
 * 이중으로 작용한다.
 *
 * ## 실측 (2026-08-02 · 6행성 6,720런, 대조군 포함)
 * 같은 배율 1.6 을 **목표 게이트형 무대 전부**에 걸어 본 결과가 이 좁힘의 근거다:
 *
 * | 행성(모드) | 계수 전 | 계수 1.6 | 런내 레벨업 |
 * |---|---|---|---|
 * | 카르곤(뱀서류·대조군) | 78.9% | 79.1% | 계수 미적용 |
 * | **베르단(수축)** | 21.1% | **37.8%** | 6.4 → 5.3 |
 * | 니플헤임(추격) | 30.6% | 31.7% | — |
 * | 톡사르(오염) | 14.3% | 13.9% | — |
 * | **크라스(블록격파)** | 49.0% | **22.0%** | 6.4 → **4.0** |
 * | 아르케(레이싱) | 92.2% | 97.1% | **보스도달 87.4 → 77.0s** |
 *
 * 크라스는 처치 73·레벨업 4.0 으로 **굶어서** 반토막 났고, 레이싱은 적이 줄자
 * `racingCleared` 가속이 더 자주 걸려 **페이싱이 깨졌다**(90초 목표 → 77초). 즉 이 레버는
 * 무대 성질에 따라 부호가 갈린다 — 공용으로 쓰면 안 된다.
 *
 * 베르단의 보스 도달은 91.3 → 89.0s 로 페이싱을 지켰다.
 *
 * ## 1.6 → 2.4 (2026-08-03)
 * 봇·조준 축이 바뀐 뒤 재측정하니 베르단이 여전히 **47.3%** 로 전 무대 최저였다. 특징은
 * 클리어율이 **레벨과 거의 무관하게 평평**하다는 것(40~54%)이고 — 성장으로 극복되지 않는다 —
 * 처치 160·런내 레벨업 5.5 로 둘 다 전 무대 최저였다. 즉 이 무대의 사인은 압박이 아니라
 * **굶는 것**이고, 그렇다면 이 상수가 계속 레버다.
 *
 * ⚠️ **수축 반경 쪽을 먼저 시험했고 방향이 반대였다.** 세그먼트 유예를 240 → 420 으로 늘리자
 * 47.3% → **44.8%** 로 나빠졌고 클리어초는 89.4 → 94.1s 로 늘었다. 이 무대는 적 전멸이 진행
 * 게이트라 **반경을 넉넉히 주면 죽여야 할 적이 늘어난다** — 다른 무대의 직관이 여기서 뒤집힌다.
 *
 * | 배율 | 클리어율 | 런내 레벨업 | 보스 도달 |
 * |---|---|---|---|
 * | 1.6(전) | 47.3% | 5.5 | 88.5s |
 * | 2.2 | 56.8% | 5.14 | 88.5s |
 * | **2.4** | **59.5%** | **4.98** | **85.8s** |
 * | 2.7 | 63.6% | 4.60 | 79.3s ← 기각 |
 *
 * 2.7 은 밴드 안에 들지만 **런내 레벨업 4.6 · 보스 도달 79.3s** 로 둘 다 무너진다. 크라스가
 * 레벨업 4.0 에서 반토막 났던 "굶는" 신호(위 표)와 같은 자리다. 2.4 는 레벨업 하한(5)과
 * 페이싱(90초) 둘 다 아슬아슬하게 지키는 최대값이다 — **더 올리지 마라.**
 *
 * TODO(밸런스): 나머지 무대(니플헤임 30.6% · 톡사르 · 크라스 49.0% · 아르케 92.2%)는 각자
 * 다른 축이 필요하다. 경위는 `.omc/plans/balance-queue.md`.
 */
export const SHRINK_INTERVAL_SCALE = 2.4;

/**
 * 이 런의 카드 추첨 간격 배율. 수축 외 전 모드는 1 — 기존 거동·해시가 바이트 불변이다.
 */
export function waveIntervalScale(state: WorldState): number {
  return state.config.planetMode === PLANET_MODE.shrink ? SHRINK_INTERVAL_SCALE : 1;
}

/**
 * Count live enemies (excludes bullets/hazards/gems).
 *
 * ⚠️ 촉매 `id 36` 그림자는 **세지 않는다** — 죽일 수 없는 개체를 세면 "적을 다 잡았는가" 게이트가
 * 영영 안 열린다. 조준 술어(`world.ts isPlayerTargetable`)·아군탄 화이트리스트 제외와 **한 쌍**이다.
 * 무촉매 런은 shadow 비트가 전부 0 이라 항상 종전과 같은 수를 낸다(바이트 불변).
 */
export function countEnemies(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'enemy' && !isCatalystShadow(e)) n++;
  return n;
}

/**
 * 지금 세그먼트의 전진 게이트가 **중반 격전(리더 처치)** 인가 — 순수 술어, 단일 정본.
 *
 * ## 왜 함수로 뽑았는가 (사용자 신고 2026-08-04)
 * "니플헤임에서 간혹 대피소에 가도 도착 체크가 안 된다." 원인은 이 조건이 **세 곳에 각자
 * 적혀 있었던 것**이다:
 *  - `updateWaves`(아래) — `seg.clash && !scroll && !commission` 전부
 *  - `bossProgress.ts` — `seg.clash && !scroll` (**`commission` 빠짐**)
 *  - `snapshot.ts` 의 대피소 `active` — **격전을 아예 안 봄**
 *
 * 세 번째가 신고의 정체다. 격전 세그먼트(index 3)에서는 전진 게이트가 리더 처치로 바뀌어
 * 대피소가 게이트가 아닌데, 스냅샷은 그 대피소를 여전히 "이번 목표"로 표시했다 →
 * 초록 강조 + 맥동 링 + 화면밖 방향 화살표 + 레이더 블립이 전부 그리로 가리키는데
 * 도착해도 아무 일이 없다. 6구간 중 정확히 1구간에서만 나므로 "간혹"으로 보인다.
 *
 * 두 번째(의뢰 런에서 HUD 만 격전 문구)도 같은 뿌리다. 술어를 한 곳에 두면 둘 다 사라진다.
 *
 * ⚠️ 소환 게이트와 전진 게이트는 **반드시 함께 움직인다**(아래 사용처 주석). 이 함수를
 * 우회해 조건을 다시 적지 마라 — 그 순간 다시 갈라진다.
 */
export function midClashGateActive(state: WorldState): boolean {
  const seg = SEGMENTS[state.wave.segmentIndex];
  if (seg === undefined) return false;
  return (
    seg.clash === true && state.scrollRuntime === undefined && state.config.commission === undefined
  );
}

/** Advance the wave director by one tick, spawning enemies as due. */
export function updateWaves(state: WorldState, player: Entity): void {
  const w = state.wave;
  if (w.done) return;

  const seg = SEGMENTS[w.segmentIndex];
  if (seg === undefined) {
    w.done = true;
    return;
  }
  // 밀도 패스(2026-08-08): 탄 유입이 `적 수 × 발사 빈도` 로 늘므로 상한도 같은 배수로 올린다.
  // 이 줄이 없으면 늘어난 탄이 상한에서 **조용히 잘린다**(`ENEMY_BULLET_CAP_MULT` 주석 참조).
  state.bulletCap = Math.round(seg.bulletCap * ENEMY_BULLET_CAP_MULT);

  // 정예 소집령(ADR-0043): 잡몹 대신 정예를 겹쳐 내려보내는 **스포너**다. 세그먼트 게이트가
  // 아니라 여기(스폰 층)에 붙는 이유는, 이 주문이 바꾸는 것이 "구간을 언제 넘는가"가 아니라
  // "무엇이 내려오는가"이기 때문이다. 무의뢰 런은 술어가 거짓이라 무연산(바이트 불변).
  if (isEliteSummons(state)) stepEliteSummons(state, player);

  if (seg.boss) {
    w.boss = true; // Phase 3 hook: boss encounter begins here.
  }

  // 중반 격전(ADR-0032): 전용 세그먼트 **진입 틱**에 리더 + 정예 서지를 1회 소환한다. 진입 틱
  // 판정을 `segmentElapsed === 0` 으로 두는 이유는 아래 전진 게이트와 짝을 이루기 때문이다 —
  // 여기서 소환하고 나서야 `segmentElapsed++` 를 지나 게이트를 평가하므로, "아직 리더가 없는데
  // cleared" 오판이 구조적으로 불가능하다(midClashCleared 주석). 소환은 RNG 미소비(summonEnemy)
  // 라 waveRng/eliteRng/dropRng 스트림이 밀리지 않는다 — 기존 카드 추첨 시퀀스가 그대로다.
  // 중반 격전 소환은 **강제 스크롤 모드를 제외**한다(아래 cleared 분기의 게이트 제외와 같은
  // 조건 — 둘은 반드시 함께 움직인다). 근거는 그쪽 주석 참조.
  //
  // **의뢰 런도 제외한다**(계약 §9). 중반 격전은 "한 무대를 오래 도는" 뱀서류 페이싱의 중간
  // 산인데, 의뢰는 구간마다 새 무대를 여는 구조라 구간 수만큼 격전이 반복된다(페이싱류는 무대
  // 단위 — 승계 원칙의 역방향 귀결). 술어 정본은 `config.commission` 이다.
  //
  // ⚠️ 소환 게이트와 전진 게이트(아래 `clashActive` 사용처)는 **반드시 함께 움직인다.** 하나만
  // 끄면 "리더가 없는데 리더 처치를 기다리는" 영구 정체 구간이 생긴다. 그래서 조건을 **여기
  // 한 곳에서 계산해 둘이 같은 값을 읽게** 한다 — 조건을 두 번 적는 순간 갈라진다.
  const clashActive = midClashGateActive(state);
  if (clashActive && w.segmentElapsed === 0) {
    spawnMidClash(state, player);
  }

  // 급행 소환 램프(ADR-0011): 세그먼트에 오래 머물수록(=처치 할당 미달) 유효 적 상한↑·
  // 카드 간격↓ 으로 압박을 누적한다. 정수 연산·RNG 미소비라 결정론 불변. 단 보스 세그먼트
  // 에는 램프를 적용하지 않는다(rushSteps=0) — 보스전에도 일반몹은 계속 등장하되(아래 카드
  // 추첨은 보스 포함 매 세그먼트 실행), 완만한 고정 간격이라 화력이 충분하면 보스에 집중
  // 가능하고 부족하면 몹이 서서히 쌓여 자연 사망으로 긴 꼬리가 캡된다(별도 enrage 없음).
  //
  // 중반 격전 세그먼트(ADR-0032)에는 램프를 **그대로 적용한다**(보스처럼 끄지 않는다). 격전의
  // 전진 게이트는 리더 처치인데, 리더를 못 잡는 동안 압박이 누적돼야 "약하면 길어지다 사망"
  // 이라는 창발적 캡(ADR-0011)이 격전에도 성립한다. 램프를 끄면 화력이 부족한 빌드가 리더를
  // 못 잡은 채 무한히 머무는 정체 구간이 생긴다.
  // 촉매 `id 13 enlightenment` 의 **대가** — 급행 소환이 두 배다. 미소지 런은 배율이 정확히
  // 1 이라 곱셈이 무연산(바이트 불변)이고, `carries` 순회 비용은 최대 3 이다.
  const rushSteps = seg.boss
    ? 0
    : Math.floor(w.segmentElapsed / RUSH_RAMP_TICKS) * enlightenmentRushStepMult(state);
  const rushEnemyBonus = Math.min(rushSteps * RUSH_ENEMY_STEP, RUSH_ENEMY_MAX);
  // 촉매 적 수 페널티 × 침략 단계 밀도↑: raise the onscreen enemy cap. 단계 밀도는
  // 데이터 주도(STAGE_MILESTONES.densityMult) — 밴드0/1(단계1..20)은 1(거동 불변), 밴드2(21+)는 ×1.5.
  // catalystMods.enemyCount 는 촉매 무주입 시 1(무연산 → 바이트 불변).
  const tp = stageParams(state.config.stage ?? 1);
  // PVE_DENSITY_MULT: 상한 축. 짝인 유입 축은 spawnCard 안에 있다(둘은 함께 움직인다).
  // ENEMY_COUNT_MULT: 밀도 패스(2026-08-08) — `PVE_DENSITY_MULT` 위에 곱한다(출처가 다르다).
  const maxEnemies = Math.round(
    (seg.maxEnemies + rushEnemyBonus) *
      state.catalystMods.enemyCount *
      tp.densityMult *
      PVE_DENSITY_MULT *
      ENEMY_COUNT_MULT,
  );
  // 수축은 유입 케이던스를 늘린다(위 `waveIntervalScale` 주석 — 그 무대에서만 적이 진행
  // 게이트다). 하한(`RUSH_MIN_INTERVAL`)에도 같은 배율을 걸어야 급행 램프가 최고조일 때 계수가
  // 무력화되지 않는다 — 걸지 않으면 램프가 붙는 후반에 정확히 효과가 사라진다.
  // 그 외 모드는 배율 1 이라 두 값 모두 바이트 불변.
  const scale = waveIntervalScale(state);
  const cardInterval = Math.max(
    Math.round(RUSH_MIN_INTERVAL * scale),
    Math.round((seg.cardInterval - rushSteps * RUSH_INTERVAL_STEP) * scale),
  );

  if (w.cardTimer > 0) w.cardTimer--;
  // 정예 소집령은 **잡몹이 전혀 나오지 않는다**(ADR-0043 — "잡몹을 극소로"는 명시 기각안이다).
  // 카드 추첨 자체를 건너뛰므로 `waveRng` 도 소비되지 않는다. 젬 0 은 이 게이트의 자연 귀결이고
  // (잡몹이 없으면 젬을 남길 개체가 없다), 남은 경로 하나(엘리트·기물 젬)를 `compact()` 가 막는다.
  if (
    !commissionSuppressesCardSpawns(state) &&
    w.cardTimer <= 0 &&
    countEnemies(state) < maxEnemies
  ) {
    // 행성별 카드 풀에서 추첨(카르곤/베르단). 풀 길이가 달라도 waveRng 소비는 카드
    // 인덱스 1회로 동일하므로 스트림 분리 규율 유지.
    const cardPool = planetContent(state.config.planet).cardPool;
    const cardIndex = state.waveRng.int(0, cardPool.length - 1);
    const card = cardPool[cardIndex];
    if (card !== undefined) spawnCard(state, card, maxEnemies, player);
    w.cardTimer = cardInterval;
  }

  w.segmentElapsed++;

  // 처치 할당 게이트(ADR-0011): 고정 타이머 대신 목표 처치 수를 채우면 다음 세그먼트로.
  // 적을 다 쓸어도 기다리지 않으므로 강한 빌드는 런이 짧아진다(창발). 보스 세그먼트는
  // 보스 처치(victory)로만 끝나므로 이 게이트를 타지 않는다.
  if (!seg.boss && w.segmentIndex < SEGMENTS.length - 1) {
    // 세그먼트 전진 게이트: 블록격파(Lane4)·레이싱(Lane5)은 처치 할당 대신 스크롤 주파 거리로
    // 구간을 넘는다(구간 i 돌파 = 진행도 ≥ (i+1)×구간길이). 그 외 모드는 기존 killGoal 게이트
    // 그대로라 뱀서류·침공 거동이 불변이다. 블록격파=−scrollY 진행도, 레이싱=+scrollX 진행도.
    const sw = state.scrollRuntime;
    let cleared: boolean;
    // 중반 격전(ADR-0032)은 **모드 게이트보다 먼저** 판정한다. 격전 세그먼트에서는 스크롤
    // 주파 거리·정화율·대피소 도달·링 전멸이 아니라 **리더 처치**가 유일한 전진 조건이다 —
    // 매 런 확정 등장하는 구조 비트라 모드와 무관하게 같은 규칙으로 서야 한다(모드별 리더의
    // 정체·연출 변형은 다운스트림, ADR-0032 §Consequences). 판정은 마커 엔티티 생존 스캔
    // 파생이라 WaveRuntime 신규 필드가 0 이다(계획 AC9/MAJ-3).
    //
    // ⚠️ **강제 스크롤 모드(블록격파·레이싱)는 예외**다. 그 두 모드는 세그먼트 전진이 창 주파
    // **거리**에 묶여 있는데, 격전만 **처치**로 게이트하면 두 축이 어긋난다 — 창은 모드 정체성상
    // 계속 전진하지만 세그먼트는 리더를 잡을 때까지 멈춰서, 창이 미리 깔아둔 코스 끝을 지나
    // 벽도 부스트 패드도 없는 빈 공간으로 무한히 나아간다(하네스 실측: 격전 진입 후 5,700틱 동안
    // 전진 0, 진행도는 코스 길이 12,000 을 넘어 30,000+). 게다가 컬링 예외로 창에 결속된 리더가
    // 그 내내 따라붙어 사실상 런이 그 자리에서 끝난다.
    // 그래서 두 모드에서는 격전 세그먼트도 **기존 거리 게이트를 그대로 쓰고**, 리더·서지를 아예
    // 소환하지 않는다(위 spawnMidClash 게이트와 한 쌍). 세그먼트가 하나 늘어난 만큼 코스도
    // `SEGMENTS.length - 1` 파생으로 한 구간 길어져 있어 거리 축은 이미 정합이다.
    // 모드별 격전 변형(스크롤 창 정지 등)은 다운스트림이다(ADR-0032 §Consequences).
    if (clashActive) cleared = midClashCleared(state, w);
    else if (sw !== undefined && state.config.planetMode === PLANET_MODE.blockBreak)
      cleared = blockBreakProgress(sw) >= (w.segmentIndex + 1) * BLOCKBREAK_SECTION_LENGTH;
    else if (sw !== undefined && state.config.planetMode === PLANET_MODE.racing)
      cleared = racingProgress(sw) >= (w.segmentIndex + 1) * RACING_SECTION_LENGTH;
    else if (state.config.planetMode === PLANET_MODE.contamination) {
      // 오염(Lane8): 스크롤 거리 대신 **정화율**(파괴된 오염 노드 비율)로 구간을 넘는다. 구간 i
      // 통과 = 정화율 ≥ 임계 × (i+1)/일반세그먼트수. 일반 세그먼트 수 = SEGMENTS.length − 1
      // (마지막은 보스). 마지막 일반 세그먼트 통과 = 정화 임계 도달 → 보스 세그먼트 → 오염원
      // 코어 보스(stepBoss 공통 경로). 곡선·임계는 TODO(밸런스), 구조는 "정화 진행 → 보스".
      // ⚠️ 중반 격전(ADR-0032) 삽입 후 `SEGMENTS.length − 1` 은 6 이다(격전 세그먼트 포함).
      // 격전 세그먼트는 위 clash 분기가 먼저 잡아 이 마일스톤을 소비하지 않으므로, 실제로
      // 정화율이 통과해야 하는 지점은 5곳(index 0·1·2·4·5)이고 마지막 통과가 정확히 임계
      // (6/6)에 걸린다 — "정화 임계 도달 → 보스" 구조는 그대로다. 중간 간격만 살짝 불균등해지는데
      // 이는 밸런스 사안이다(TODO(밸런스)).
      const normalSegments = SEGMENTS.length - 1;
      const milestone = (CONTAMINATION_PURIFY_THRESHOLD * (w.segmentIndex + 1)) / normalSegments;
      cleared = contaminationPurifyRate(state) >= milestone;
    } else if (state.config.planetMode === PLANET_MODE.chase) {
      // 추격(Lane6): 처치 할당 대신 **누적 대피소 확보 수**로 구간을 넘는다("탈출 단계").
      // 세그먼트 i 통과 = 확보 수 ≥ `chaseShelterMilestone(i)`. 마지막 일반 세그먼트의 마일스톤은
      // 정확히 전량이라, **다 찾는 순간** 보스 세그먼트로 넘어가고 같은 틱에 포식자가 취약해진다
      // (`updateChasePredator`). 포식자는 이미 존재(bossSpawned)라 두 번째 보스는 뜨지 않는다.
      // 승리는 취약해진 포식자 처치다. planetMode 게이트라 뱀서류·침공 거동 불변.
      cleared = chaseSegmentCleared(state, w.segmentIndex);
    } else if (state.config.planetMode === PLANET_MODE.shrink) {
      // 수축(Lane7): 처치 할당 대신 **안전 반경 안 적 전멸**(shrinkRingCleared)로 구간을 넘는다.
      // 마지막 일반 세그먼트 통과 → 보스 세그먼트 → 아레나 중심 보스(stepBoss 공통 경로). 전진
      // 시 유예 리셋(아래 if(cleared) 블록)이 반경을 잠시 홀드해 수축 사이클을 이력 의존으로
      // 만든다(shrinkRuntime 신규 필드 정당성). planetMode 게이트라 뱀서류·침공 거동 불변.
      // ⚠️ `id 33` 은 즉사 창마다 원을 **비운다** — 잠금이 없으면 15초마다 세그먼트가 자동
      // 전진한다(중심을 인자화해도 남는 결함이다. 사유 전문은 `catalyst/berdan.ts` §id 33).
      cleared =
        !berdanCollapseLocked(state) &&
        shrinkRingCleared(state, berdanSafeCenterX(state), berdanSafeCenterY(state));
    } else cleared = state.kills - w.segmentBaseKills >= w.segmentKillGoal;
    if (cleared) {
      w.segmentIndex++;
      // 튜토리얼 단축판(config.maxSegments): 일반 세그먼트를 상한만큼 소화했으면 곧장
      // 보스 세그먼트로 점프한다. RNG 미소비·순수 인덱스 연산이라 결정론 불변이고,
      // 필드 부재 시 아래 분기가 죽어 기존 풀 런 거동이 보존된다.
      const cap = state.config.maxSegments;
      if (cap !== undefined && w.segmentIndex >= cap) {
        w.segmentIndex = SEGMENTS.length - 1;
      }
      const next = SEGMENTS[w.segmentIndex];
      w.segmentElapsed = 0;
      w.cardTimer = 0;
      w.segmentBaseKills = state.kills;
      w.segmentKillGoal = next ? next.killGoal : 0;
      // 수축(Lane7): 세그먼트 전진 직후 유예를 리셋해 반경을 잠시 홀드한다(숨돌릴 틈). 정수 대입뿐.
      // 이 이력 의존이 safeRadius 를 tick 의 닫힌 함수가 아니게 만들어 shrinkRuntime 신규 필드를
      // 정당화한다(scrollX/accelCp 와 동일 사유). shrinkRuntime 미존재(타 모드)면 no-op(불변).
      if (state.shrinkRuntime !== undefined) state.shrinkRuntime.graceTicks = SHRINK_GRACE_TICKS;
    }
  }
}

/**
 * 정예 소집령(`order: 'elite'`)의 **겹침 소환** 한 틱 (ADR-0043).
 *
 * 판정은 전부 {@link decideEliteDeploy} 안에 있다(순수 함수) — 여기는 실측(`alive` 세기)과
 * 부수효과(스폰)만 진다. **고정 주기 타이머가 아니라는 것**이 이 주문의 핵심이니, 왜 그런지는
 * 그 함수의 주석을 읽어라.
 *
 * ## RNG 소비 순서 계약 (`eliteRng`, 투입 1기당 정확히 3회)
 * `① 정예 정의 인덱스 → ② 배치 각도 → ③ 어픽스`. 순서를 바꾸면 이미 제출된 의뢰
 * 리플레이가 전부 다른 런이 된다. 이 스트림은 무의뢰 런에서 한 번도 소비되지 않으므로
 * (스포너 자체가 안 불린다) 기존 PvE·침공 해시에는 닿지 않는다.
 *
 * ## 정예 정의 풀
 * 행성 레지스트리의 `elites` 가 정본이다. **카르곤(0)은 `elites: []`** 라 비어 있으므로
 * 로스터로 폴백한다 — 폴백이 없으면 카르곤을 지정한 정예 소집령이 아무것도 못 내려보내
 * "적이 하나도 안 나오는 런"이 된다(그리고 그것은 조용히 통과한다).
 */
function stepEliteSummons(state: WorldState, player: Entity): void {
  const w = state.wave;
  let alive = 0;
  for (const e of state.entities) if (e.kind === 'enemy' && !e.dead && isElite(e)) alive++;
  const d = decideEliteDeploy(state.tick, alive, {
    alivePrev: w.eliteAlivePrev,
    nextTick: w.eliteNextTick,
    cap: w.eliteCap,
  });
  w.eliteAlivePrev = d.alivePrev;
  w.eliteNextTick = d.nextTick;
  w.eliteCap = d.cap;
  if (!d.deploy) return;

  const planet = planetContent(state.config.planet);
  const pool: readonly EnemyDef[] =
    planet.elites.length > 0
      ? planet.elites
      : [planet.roster.special, planet.roster.charger, planet.roster.gunner, planet.roster.support];
  // ① 정의 인덱스.
  const def = pool[state.eliteRng.int(0, pool.length - 1)];
  if (def === undefined) return; // 방어적: 위 폴백이 비는 경우는 없다.
  // ② 배치 각도 — 플레이어 기준 스폰 링. 강제 스크롤·침공은 카메라가 플레이어가 아니라 창이므로
  //    창 중심을 기준으로 잡는다(`stepBoss` 의 `state.invasion3 ?? state.scrollRuntime` 선례).
  const win = state.invasion3 ?? state.scrollRuntime;
  const baseX = win !== undefined ? windowCenterX(win) : player.x;
  const baseY = win !== undefined ? windowCenterY(win) : player.y;
  const ang = state.eliteRng.range(-PI, PI);
  const pos = avoidWalls(
    state.activeWalls,
    baseX + cos(ang) * SPAWN_RING_RADIUS,
    baseY + sin(ang) * SPAWN_RING_RADIUS,
    def.radius,
  );
  // `summonEnemy`(RNG 미소비)를 쓴다 — `spawnEnemy` 는 첫 발사 쿨다운을 `waveRng` 에서 뽑아
  // 카드 추첨 스트림을 밀어 버린다. 여기서 밀면 같은 시드의 웨이브 구성이 통째로 갈린다.
  const e = summonEnemy(state, def, pos.x, pos.y);
  // ③ 어픽스. 정예 승격은 `summonEnemy` **뒤**라 단계·촉매 HP 배율이 반영된 값에 곱해진다
  //    (`spawnCard` 의 승격 순서와 같은 규율).
  makeElite(e, state.eliteRng.int(0, ELITE_AFFIX_COUNT - 1));
}

function spawnCard(state: WorldState, card: WaveCard, maxEnemies: number, player: Entity): void {
  // Flatten the card into an ordered list of defs, then place by formation.
  // 스폰 그룹은 role(역할 로스터) 또는 elite(정예 인덱스)로 대상을 지정한다(WaveSpawn
  // 판별 유니온). 행성 콘텐츠에서 해당 행성의 로스터·엘리트를 조회한다.
  const planet = planetContent(state.config.planet);
  const defs: EnemyDef[] = [];
  for (const s of card.spawns) {
    const def = 'elite' in s ? planet.elites[s.elite] : planet.roster[s.role];
    if (def === undefined) continue; // 정의되지 않은 정예 인덱스는 무시(안전).
    // PVE_DENSITY_MULT: 유입 축. 짝인 상한 축은 updateWaves 의 maxEnemies 에 있다.
    // ENEMY_COUNT_MULT: 밀도 패스 — 짝인 상한 축(위 maxEnemies)과 **같은 배수**여야 한다.
    for (let i = 0; i < s.count * PVE_DENSITY_MULT * ENEMY_COUNT_MULT; i++) defs.push(def);
  }
  const positions = formationPositions(state, card.formation, defs.length, player);
  const room = maxEnemies - countEnemies(state);
  const spawnN = Math.min(defs.length, room);
  const spawned: Entity[] = [];
  for (let i = 0; i < spawnN; i++) {
    const def = defs[i];
    const pos = positions[i];
    if (def === undefined || pos === undefined) continue;
    // 활성 벽에 끼인 채 스폰되지 않도록 결정론적으로 벽 밖으로 밀어낸다(C1).
    const adj = avoidWalls(state.activeWalls, pos.x, pos.y, def.radius);
    const e = spawnEnemy(state, def, adj.x, adj.y);
    spawned.push(e);
  }
  // 단계별 정예 승격(밴드0=1 / 밴드1=1 / 밴드2=2, STAGE_MILESTONES.eliteCount). 카드에서 먼저
  // 스폰된 eliteCount마리를 전용 스트림(OQ-M2-4)에서 뽑은 어픽스로 엘리트화한다. spawnEnemy
  // 뒤라 변칙/단계 HP 배율이 이미 반영된 상태에서 승격된다.
  // ⚠️ 밴드0(단계1~10)도 ADR-0035 로 승격이 생겼다 — 구 "단계1 승격 없음(불변)" 계약은 저단계에
  // 드랍원을 만들기 위해 의도적으로 폐기됐다(data/waves.ts STAGE_MILESTONES 주석 참조).
  // eliteCount 는 이제 **난이도 노브 전용**이고 드랍 수량은 eliteDropChance 가 고정한다.
  const eliteCount = stageParams(state.config.stage ?? 1).eliteCount;
  const promote = eliteCount < spawned.length ? eliteCount : spawned.length;
  for (let i = 0; i < promote; i++) {
    const affix = state.eliteRng.int(0, ELITE_AFFIX_COUNT - 1);
    makeElite(spawned[i] as Entity, affix);
  }
}

/** 벽 면에서 스폰 좌표를 살짝 떨어뜨릴 여유(px). */
const SPAWN_WALL_MARGIN = 4;
/** 벽 밖으로 밀어내는 최대 반복 횟수(다중 벽 코너 대비). 초과분은 슬라이드에 위임. */
const MAX_SPAWN_WALL_TRIES = 4;

/**
 * 스폰 좌표(반경 r)가 활성 벽 AABB(적 반경 마진 포함)와 겹치면 결정론적으로 벽
 * 밖으로 밀어낸다. 매 시도마다 겹친 벽을 배열 순서로 훑어 최소 관통 축을 따라
 * Minkowski 확장 면 바깥(+SPAWN_WALL_MARGIN)으로 옮긴다. 다중 벽 코너는 최대
 * MAX_SPAWN_WALL_TRIES회 반복으로 완화하고, 그래도 남는 겹침은 그대로 두어 이동
 * 슬라이드(slideCircleWalls)에 맡긴다. RNG를 쓰지 않고 입력이 위치+벽 기하만의
 * 함수이므로 결정론(시드·해시 스트림 불변).
 */
export function avoidWalls(
  walls: readonly Entity[],
  x: number,
  y: number,
  r: number,
): { x: number; y: number } {
  if (walls.length === 0) return { x, y };
  for (let attempt = 0; attempt < MAX_SPAWN_WALL_TRIES; attempt++) {
    let pushed = false;
    for (const w of walls) {
      const hw = w.radius + r; // Minkowski 확장 half-extents
      const hh = w.targetX + r;
      const dx = x - w.x;
      const dy = y - w.y;
      if (dx > -hw && dx < hw && dy > -hh && dy < hh) {
        // 최소 관통 축으로 벽 밖(+마진)에 재배치.
        const penX = hw - (dx < 0 ? -dx : dx);
        const penY = hh - (dy < 0 ? -dy : dy);
        if (penX < penY) {
          x = w.x + (dx >= 0 ? hw + SPAWN_WALL_MARGIN : -(hw + SPAWN_WALL_MARGIN));
        } else {
          y = w.y + (dy >= 0 ? hh + SPAWN_WALL_MARGIN : -(hh + SPAWN_WALL_MARGIN));
        }
        pushed = true;
      }
    }
    if (!pushed) break;
  }
  return { x, y };
}

function spawnEnemy(state: WorldState, def: EnemyDef, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = def.radius;
  // 촉매 적 HP 페널티 × 침략 단계 HP 배율. 단계1·촉매 무주입 ×1(불변), 연속 상향(밴드 대표 1/2.2/4.5).
  // ENEMY_HP_MULT: 밀도 패스의 짝 축 — 적 수 ×1.3 의 정확한 역수라 **총 적 HP 풀이 보존**된다.
  const hp = Math.round(
    def.hp * state.catalystMods.enemyHp * stageParams(state.config.stage ?? 1).hpMult * ENEMY_HP_MULT,
  );
  e.hp = hp;
  e.maxHp = hp;
  // 촉매 적 피해 페널티 — 접촉 피해에 곱한다(무주입 ×1 → 불변). 적탄 피해는 def.attack 파생이라
  // 여기서 건드리지 않는다(patterns 소관).
  // ENEMY_DAMAGE_MULT: 밀도 패스의 짝 축(실측값 — 그 상수 주석이 정본).
  e.damage = def.contactDamage * state.catalystMods.enemyDamage * enemyDamageScale(state.config);
  e.enemyType = def.typeIndex;
  // Stagger first fire so a freshly spawned pack does not volley in lockstep.
  e.cooldown = scaledFireCooldown(def.fireCooldown, def.attack.kind) + state.waveRng.int(0, 30);
  return addEntity(state, e);
}

/** Look up the behaviour definition backing a live enemy entity. */
export function enemyDefFor(e: Entity): EnemyDef | undefined {
  return ENEMY_BY_TYPE[e.enemyType];
}

/**
 * 보스 소환(plan E2)용 결정론 잡몹 스폰. spawnEnemy와 달리 RNG(waveRng)를 소비하지
 * 않고 첫 발사 쿨다운을 정의값으로 고정해, 보스 공격 컴포넌트가 스트림 분리 규율을
 * 깨지 않고 무리개체를 부를 수 있게 한다. 촉매 HP·접촉 피해 배율은 동일하게 적용한다.
 */
export function summonEnemy(state: WorldState, def: EnemyDef, x: number, y: number): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = def.radius;
  // ⚠️ **여기에는 `ENEMY_HP_MULT` 를 걸지 않는다 — 짝이 없기 때문이다.**
  // 밀도 패스(`enemyScale.ts`)의 계약은 «적 수 ×1.3 ↔ 적 HP ×1/1.3» **한 쌍**이고, 그 수 배수는
  // 웨이브 경로에만 있다(`ENEMY_COUNT_MULT` 소비 지점 둘 — 온스크린 상한과 청크 유입, 둘 다
  // `spawnEnemy` 쪽이다). 이 함수의 호출자는 **개수를 자기가 정한다**: 침공 드론 스포너·침공
  // 편대·보스 무리·중반 격전·촉매 소환·조우 수호. 그쪽에 HP 짝만 걸면 늘어난 적 없이 HP 만
  // 깎이는 **보상 없는 순수 23% 약화**가 된다.
  //
  // 밀도 패스 초판이 실제로 그 상태였고 `tests/invasionFacility.test.ts` 가 잡았다 — 드론
  // 내구도가 로스터 기본값 75 가 아니라 57 = `round(75 / 1.3)` 로 나왔다. 그 누수는
  // `enemyScale.ts` 헤더의 자기 선언(*"침공은 절차 생성 웨이브를 안 돌리므로 무관"*)과도
  // 정면으로 갈려 있었다. 짝을 깨는 곳은 계수를 거는 자리가 아니라 **거는 것을 멈추는 자리**다.
  //
  // 발사 쿨다운은 반대로 그대로 건다 — 탄 축은 애초에 짝을 안 걸었으므로(`ENEMY_FIRE_RATE_MULT`
  // 주석의 실측 결론) 소환 적에 걸어도 깨질 짝이 없고, *"화면 탄이 30% 더"* 라는 요청 축과도 맞는다.
  const hp = Math.round(
    def.hp * state.catalystMods.enemyHp * stageParams(state.config.stage ?? 1).hpMult,
  );
  e.hp = hp;
  e.maxHp = hp;
  // ENEMY_DAMAGE_MULT: 밀도 패스의 짝 축(실측값 — 그 상수 주석이 정본). 지금 1.0 이라 무영향이지만
  // 피해 축은 짝이 아니라 **모든 적에 균일**이 계약이라 소환 경로에도 그대로 건다.
  e.damage = def.contactDamage * state.catalystMods.enemyDamage * enemyDamageScale(state.config);
  e.enemyType = def.typeIndex;
  e.cooldown = scaledFireCooldown(def.fireCooldown, def.attack.kind); // 고정 쿨다운(결정론, RNG 미소비)
  return addEntity(state, e);
}

// ---------------------------------------------------------------------------
// Formations — deterministic spawn placement (seeded, avoids the player).
// ---------------------------------------------------------------------------

function formationPositions(
  state: WorldState,
  formation: Formation,
  count: number,
  player: Entity,
): { x: number; y: number }[] {
  // Infinite map: every formation is placed RELATIVE to the player, just outside
  // the on-screen viewport (off-screen ring / edges). No arena clamps — the world
  // is unbounded, so enemies stream in from beyond the visible frame in any
  // direction. Placement stays a pure function of the wave RNG + player position.
  const rng = state.waveRng;
  const out: { x: number; y: number }[] = [];
  // 강제 스크롤(Lane4/5): 스폰 기준점을 플레이어가 아니라 창 중심 전방으로 옮긴다(적이 코스
  // 앞쪽에서 다가오는 정체성). 블록격파는 전방=−Y, 레이싱은 전방=+X. 창 미존재(뱀서류·침공)·
  // 그 외 모드면 baseX/baseY 가 그대로 플레이어 좌표라 RNG 소비·산술이 바이트 동일하다(회귀 0).
  const mode = state.config.planetMode;
  // 수축지대(Lane7): 스폰을 아레나 중심(원점 0,0) 안전 반경 안 링에 몰아 "중앙 집결" 압박을
  // 만든다(플레이어 기준이 아니다 — 스크롤 모드가 창 중심을 쓰듯 shrink 는 원점을 쓴다). 스폰
  // 반경은 현재 safeRadius 이하(shrinkSpawnRadius)라 항상 안전 반경 안 → 링 전멸 게이트가
  // 성립한다(밖에 스폰하면 gate 가 헛돈다). planetMode 게이트라 타 모드 스폰은 바이트 불변.
  if (mode === PLANET_MODE.shrink) {
    const start = rng.range(-PI, PI);
    const r = shrinkSpawnRadius(state);
    // 중심은 `id 33` 이 실렸을 때만 원점에서 벗어난다(미소지면 `0` → 종전 산술과 비트 동일).
    // 스폰이 **새 원 안**이어야 링 전멸 게이트가 성립한다 — 반경만 옮기고 중심을 안 옮기면
    // 적이 원 밖에 서서 게이트가 항상 참이 된다.
    const cx = berdanSafeCenterX(state);
    const cy = berdanSafeCenterY(state);
    for (let i = 0; i < count; i++) {
      const ang = start + (i * TWO_PI) / count;
      out.push({ x: cx + cos(ang) * r, y: cy + sin(ang) * r });
    }
    return out;
  }
  const scrollWin =
    mode === PLANET_MODE.blockBreak || mode === PLANET_MODE.racing ? state.scrollRuntime : undefined;
  let baseX: number;
  let baseY: number;
  if (scrollWin !== undefined && mode === PLANET_MODE.racing) {
    baseX = scrollWin.scrollX + RACING_SPAWN_AHEAD; // 전방 = +X(오른쪽에서 다가온다)
    baseY = scrollWin.scrollY;
  } else if (scrollWin !== undefined) {
    baseX = scrollWin.scrollX; // 블록격파: 전방 = −Y(위에서 내려온다)
    baseY = scrollWin.scrollY - BLOCKBREAK_SPAWN_AHEAD;
  } else {
    baseX = player.x; // 뱀서류·침공·그 외: 플레이어 기준(바이트 동일)
    baseY = player.y;
  }

  switch (formation) {
    case 'ring': {
      // A ring centred on the player, sized so it sits fully off-screen.
      const start = rng.range(-PI, PI);
      for (let i = 0; i < count; i++) {
        const ang = start + (i * TWO_PI) / count;
        out.push({
          x: baseX + cos(ang) * SPAWN_RING_RADIUS,
          y: baseY + sin(ang) * SPAWN_RING_RADIUS,
        });
      }
      break;
    }
    case 'line': {
      // A column entering from a random off-screen side of the viewport.
      const fromLeft = rng.chance(0.5);
      const x0 = baseX + (fromLeft ? -OFFSCREEN_X : OFFSCREEN_X);
      const y0 = baseY + rng.range(-VIEW_HEIGHT * 0.3, VIEW_HEIGHT * 0.3);
      for (let i = 0; i < count; i++) {
        // Formation spacing doubled for the 2x-scale entities (line 46 -> 92).
        out.push({ x: x0 + (fromLeft ? -1 : 1) * i * 92, y: y0 + i * 40 });
      }
      break;
    }
    case 'edges': {
      // Each enemy spawns along one of the four off-screen viewport edges.
      for (let i = 0; i < count; i++) {
        const side = rng.int(0, 3);
        let x = baseX;
        let y = baseY;
        if (side === 0) {
          x = baseX + rng.range(-OFFSCREEN_X, OFFSCREEN_X);
          y = baseY - OFFSCREEN_Y;
        } else if (side === 1) {
          x = baseX + rng.range(-OFFSCREEN_X, OFFSCREEN_X);
          y = baseY + OFFSCREEN_Y;
        } else if (side === 2) {
          x = baseX - OFFSCREEN_X;
          y = baseY + rng.range(-OFFSCREEN_Y, OFFSCREEN_Y);
        } else {
          x = baseX + OFFSCREEN_X;
          y = baseY + rng.range(-OFFSCREEN_Y, OFFSCREEN_Y);
        }
        out.push({ x, y });
      }
      break;
    }
    case 'cluster': {
      // A blob offset from the player so it is not on top of them. Offsets and
      // spread doubled for the 2x-scale entities (spread +/-90 -> +/-180).
      const cx = baseX + rng.range(-1, 1) * 1000 + 520;
      const cy = baseY + rng.range(-1, 1) * 800 - 400;
      for (let i = 0; i < count; i++) {
        out.push({ x: cx + rng.range(-180, 180), y: cy + rng.range(-180, 180) });
      }
      break;
    }
  }
  return out;
}
