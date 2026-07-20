/**
 * 침공 3레이어 — 페이즈 머신 L1→L2→L3 (M7a · L2-scroll-phase).
 *
 * ## 왜 페이즈가 victory 가 아닌가
 * 구 침공은 `compact()` 가 `kind === 'core'` 사망을 보면 무조건 `state.victory = true` 를 세우고
 * (src/sim/world.ts), `stepWorld` 첫 줄이 victory/gameOver 면 즉시 return 한다 — 즉 승리가
 * 서면 그 틱 이후 월드가 완전히 죽는다. 3레이어에서 L1/L2 클리어가 victory 로 새면 런이
 * 그 자리에서 끝난다. 그래서 레이어 클리어는 **페이즈 전이**이고, victory 는 L3 코어 파괴
 * 하나로 좁힌다(기만 홀로그램 대비 — 코어 kind 를 쓰는 가짜 목표가 L3 밖에서 죽어도 승리가
 * 되면 안 된다).
 *
 * ## 종료 조건 이중화
 * - **soft**: 레이어별 예산(INVASION_LAYER_TICKS) 소진 → gameOver 가 아니라 **강제 전이**.
 *   진행이 영영 막히는 상태(못 뚫는 벽·과잉 방어)를 만들지 않기 위한 안전판.
 * - **hard**: 총 {@link Invasion3Config.timeLimitTicks}(기본 18000) 도달 → gameOver.
 *
 * 전이 판정은 전부 `state.tick` 과 정수 스크롤 오프셋만 본다 — wall-clock·RNG 미사용(ADR-0005).
 */

import type { Entity } from '../entities.js';
import type { WorldState } from '../world.js';
import {
  INVASION_ACCEL_BASE_CP,
  INVASION_LAYER_TICKS,
  LAYER_CLEAR_BOMB_BONUS,
  LAYER_CLEAR_HEAL_PERCENT,
  PHASE_L2,
  PHASE_L3,
} from './constants.js';
import { advanceScrollOffset, layerLength, layerProgress, nextAccelCp } from './scroll.js';
import { enterInvasionLayer, makeInvasionContext } from './step.js';
import type { Invasion3Config, InvasionPhase, InvasionRuntime } from './types.js';

/**
 * 레이어 클리어 폭탄 보유 상한. 소비 경로(입력 프레임 비트)는 아직 없으므로 M7a 에서는
 * 적립만 한다 — 상한을 둬 무한 적립이 해시 도메인을 넓히지 않게 한다.
 */
export const INVASION_BOMB_CAP = 3;

/**
 * 전이 시 살아남는 엔티티 종류. 플레이어 본체와 플레이어가 이미 쏜 탄·소환물만 승계하고,
 * 그 외(적·적탄·해저드·벽·방어 배치)는 레이어와 함께 사라진다.
 *
 * `dead` 표시 후 compact 에 맡기지 않고 여기서 직접 걸러내는 이유: compact 는 죽은 적을
 * 처치 수·젬·드랍으로 환산한다. 전이 정리는 "처치"가 아니므로 그 경로를 타면 안 된다.
 */
const TRANSITION_KEEP: readonly Entity['kind'][] = ['player', 'bullet', 'turretPickup'];

/**
 * 전멸 가속의 "구간 전멸" 판정 대상인가. 파괴 불가 영구 해저드(life < 0)는 아무리 잘 밀어도
 * 사라지지 않으므로 제외한다 — 넣으면 가속이 영영 안 붙는다.
 */
export function isClearTarget(e: Entity): boolean {
  if (e.dead) return false;
  switch (e.kind) {
    case 'enemy':
    case 'boss':
    case 'core':
    case 'decoyCore':
    case 'guardian':
    case 'destructible':
      return true;
    case 'hazard':
      return e.life >= 0;
    default:
      return false;
  }
}

/** 현재 구간이 전멸 상태인가(라이브 O(n) 스캔 — RNG·시계 미사용). */
export function isSegmentCleared(state: WorldState): boolean {
  for (const e of state.entities) {
    if (isClearTarget(e)) return false;
  }
  return true;
}

/**
 * 가속 갱신 + 스크롤 전진. 플레이어 이동 **이전**에 불러 이번 틱 창 클램프가 갱신된 창을
 * 쓰게 한다(창이 먼저 밀고, 플레이어가 그 안에서 움직인다).
 */
export function advanceInvasionScroll(state: WorldState, runtime: InvasionRuntime): void {
  runtime.accelCp = nextAccelCp(runtime.accelCp, isSegmentCleared(state));
  advanceScrollOffset(runtime);
}

/**
 * 다음 페이즈로 넘어갈 조건인가. `state.tick` 은 아직 증가 전이므로 이번 틱까지 소화한
 * 경과 틱은 `tick + 1 - phaseEnterTick` 이다.
 */
export function shouldAdvancePhase(state: WorldState, runtime: InvasionRuntime): boolean {
  if (runtime.phase >= PHASE_L3) return false;
  const budget = INVASION_LAYER_TICKS[runtime.phase] ?? 0;
  const elapsed = state.tick + 1 - runtime.phaseEnterTick;
  if (elapsed >= budget) return true; // soft 예산 소진 → 강제 전이
  return layerProgress(runtime) >= layerLength(runtime.phase);
}

/** 레이어 잔여 엔티티 정리(전이 규칙: 적·해저드·방어 배치 제거, 플레이어 투사체 승계). */
export function clearLayerEntities(state: WorldState): void {
  const survivors: Entity[] = [];
  for (const e of state.entities) {
    if (e.dead) continue;
    if (TRANSITION_KEEP.includes(e.kind)) survivors.push(e);
  }
  // 플레이어는 항상 index 0 (hashWorld 불변식). 위 순회가 배열 순서를 보존하므로 유지된다.
  state.entities = survivors;
}

/**
 * 레이어 클리어 보너스: 최대 HP {@link LAYER_CLEAR_HEAL_PERCENT}% 회복 + 폭탄 +1(상한 내).
 * 회복량은 정수 산술(`Math.round(maxHp * 20 / 100)`)이라 f64 누적이 없다.
 */
export function applyLayerClearBonus(state: WorldState): void {
  const player = state.entities[0];
  if (player !== undefined && player.kind === 'player') {
    const heal = Math.round((player.maxHp * LAYER_CLEAR_HEAL_PERCENT) / 100);
    const hp = player.hp + heal;
    player.hp = hp > player.maxHp ? player.maxHp : hp;
  }
  const bombs = state.invasion3Bombs + LAYER_CLEAR_BOMB_BONUS;
  state.invasion3Bombs = bombs > INVASION_BOMB_CAP ? INVASION_BOMB_CAP : bombs;
}

/**
 * 런 시작 시 L1 진입 처리(createWorld 에서 1회). 스크롤·가속은 초기값 그대로 두고 진입 훅만
 * 태운다 — 전이 정리·보너스는 "클리어"의 대가라 시작에는 적용하지 않는다.
 */
export function initInvasionPhase(
  state: WorldState,
  config: Invasion3Config,
  runtime: InvasionRuntime,
): void {
  enterInvasionLayer(state, makeInvasionContext(config, runtime));
}

/** L2 진입 시 플레이어 x — 회랑 입구(x=0) 바로 앞. 창 중심(0) 왼쪽 절반 안이다. */
export const L2_PLAYER_ENTRY_X = -480;
/** L3 진입 시 플레이어 y 오프셋 — 코어 아래쪽(창 반높이 540 안). */
export const L3_PLAYER_ENTRY_OFFSET_Y = 400;

/**
 * 새 레이어의 좌표 원점으로 스크롤 창과 플레이어를 옮긴다.
 *
 * **통합 게이트 신설.** 레이어마다 콘텐츠가 자기 좌표계로 작성돼 있다 —
 *   L1 = 스크롤 상대(편대가 `scrollX/scrollY` 기준으로 스폰),
 *   L2 = 절대(회랑이 x=0..lengthUnits, y=±halfHeight 에 고정),
 *   L3 = 절대(코어 `l3.core.{x,y}` 기준).
 * 그런데 전이는 스크롤 오프셋을 그대로 물려받아 L1 종스크롤이 누적한 `scrollY≈-71298` 이 L2 로
 * 넘어갔다. 그 결과 회랑·설비는 y≈0 에, 플레이어와 카메라는 y≈-70790 에 있어 **레이어 콘텐츠가
 * 7만 유닛 밖에 스폰되고 화면에는 빈 공간만 흘렀다**(예외가 안 나서 단위 테스트로는 안 보였다).
 *
 * 스크롤 축이 페이즈마다 달라 두 축을 모두 원점으로 되돌려야 한다 — L2 는 X 만 전진시키므로
 * Y 를 안 되돌리면 회랑을 영영 못 만난다.
 */
export function enterLayerFrame(
  state: WorldState,
  config: Invasion3Config,
  runtime: InvasionRuntime,
): void {
  const player = state.entities[0];
  const hasPlayer = player !== undefined && player.kind === 'player';
  if (runtime.phase === PHASE_L2) {
    runtime.scrollX = 0;
    runtime.scrollY = 0;
    if (hasPlayer) {
      player.x = L2_PLAYER_ENTRY_X;
      player.y = 0;
    }
  } else if (runtime.phase === PHASE_L3) {
    const core = config.layers.l3.core;
    runtime.scrollX = core.x;
    runtime.scrollY = core.y;
    if (hasPlayer) {
      player.x = core.x;
      player.y = core.y + L3_PLAYER_ENTRY_OFFSET_Y;
    }
  }
}

/**
 * 페이즈 전이를 판정하고, 성립하면 다음 레이어로 넘어간다. `compact()` 이후에 호출해
 * 이번 틱에 죽은 적까지 반영된 상태에서 판정하게 한다.
 *
 * 전이 시:
 *   ① 잔여 엔티티 정리(플레이어 투사체는 승계)
 *   ② 자원 승계 + 클리어 보너스(HP 20% · 폭탄 +1)
 *   ③ 가속 배율 리셋(새 레이어는 항상 기준 속도에서 출발)
 *   ④ phaseEnterTick = 다음 틱(= state.tick + 1)
 *   ⑤ **새 레이어 좌표 원점으로 창·플레이어 이동**({@link enterLayerFrame})
 *   ⑥ 새 레이어 진입 훅(정적 배치 스폰) — 창이 옮겨진 뒤라야 스폰 좌표가 화면 안에 든다
 */
export function advanceInvasionPhase(
  state: WorldState,
  config: Invasion3Config,
  runtime: InvasionRuntime,
): boolean {
  if (state.gameOver || state.victory) return false;
  if (!shouldAdvancePhase(state, runtime)) return false;

  clearLayerEntities(state);
  applyLayerClearBonus(state);
  runtime.phase = (runtime.phase + 1) as InvasionPhase;
  runtime.phaseEnterTick = state.tick + 1;
  runtime.accelCp = INVASION_ACCEL_BASE_CP;
  enterLayerFrame(state, config, runtime);
  enterInvasionLayer(state, makeInvasionContext(config, runtime));
  return true;
}

/**
 * 침공 총 제한 시간(hard) 판정. 코어 파괴(victory)가 이미 섰으면 무시한다.
 * `state.tick` 은 증가 전이므로 이번 틱을 끝내면 `tick + 1` 개를 소화한 것이다.
 */
export function checkInvasion3Timeout(state: WorldState, config: Invasion3Config): void {
  if (state.victory || state.gameOver) return;
  if (state.tick + 1 >= config.timeLimitTicks) state.gameOver = true;
}
