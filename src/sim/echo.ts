/**
 * 에코 신호(story) — Phase D (ADR-0023). 런 중 아주 드물게(시드 파생 ~3%) 한 번 출현하는
 * 서사 이벤트다. 플레이어가 신호 오브젝트 반경 안에서 일정 시간 **버티면**(반경 내 체류 누적)
 * 안정화에 성공하고, 크레딧(런 경제)과 기록 파편(메타 수집)을 얻는다. 전투력에는 불개입한다 —
 * 적 피해·버프가 없고 신호 오브젝트는 완전 inert(충돌·이동 차단·격자 등록 없음, boostPad/shelter
 * 선례). 전 계수는 플레이스홀더 — TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정.
 *
 * ## 왜 sim 안·해시 안인가 (ADR-0023)
 * 안정화 보상이 런 경제(크레딧)에 영향을 주므로 서버(EF)가 시드+입력로그 재실행으로 재검증한다
 * (ADR-0005). 출현은 **런 시드에서만** 파생돼(클라가 위조할 입력이 없다) 서버는 시드만으로
 * 재현한다. 그래서 에코 상태는 sim 안에 살고 hashWorld 에 접힌다.
 *
 * ## 결정론 규율 (Phase D — 절대 위반 금지)
 *  - 롤은 `worldRng.fork('echoEvent')` 로만 한다. `fork` 는 부모(worldRng) 를 전진시키지
 *    않으므로 worldRng 의 해시 상태가 불변이다 → 에코 미발생 런은 물론 발생 런도 기존 RNG
 *    스트림 소비가 0 이다. 새 상시 RNG 스트림을 WorldState/createWorld 에 추가하지 않는다.
 *  - {@link EchoRuntime} 의 모든 해시 필드는 정수(hashU32/`>>> 0`). 반경·드웰·틱은 정수.
 *    거리 판정만 f64 좌표(x/y)로 하되 그 좌표는 엔티티 필드라 이미 해시된다 — echoRuntime 은
 *    정수만 접는다.
 *  - `WorldState.echoRuntime` 은 **positive 런에서만** 존재한다(그 외 undefined) → hashWorld 는
 *    존재 시에만 조건부로 append-only 꼬리에 접어, 에코 미발생 런의 per-tick 해시가 바이트
 *    불변이다(shrinkRuntime/scrollRuntime 선례).
 *
 * ## 순환 의존 주의
 * world.ts 가 이 모듈을 런타임 import 하므로, 이 모듈은 world 에서 **타입만** 가져온다
 * (`import type`). 런타임 의존은 leaf 모듈(entities)로만(contamination/chase/shrink 선례).
 */
import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
import { spawnEcho } from './entities.js';
import type { SeededRng } from './rng.js';

// --- 플레이스홀더 계수 (TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정) ---
/** 이 런에 에코가 출현할 확률. 사용자 의도적 희소(≈3%). TODO(밸런스). */
export const ECHO_SPAWN_PROB = 0.03;
/** 스폰 가능 최소 틱(런 초반 배제, 60fps 기준 30초). TODO(밸런스). */
export const ECHO_MIN_SPAWN_TICK = 1800;
/** 스폰 가능 최대 틱(int 롤 상한, 60fps 기준 2.5분). TODO(밸런스). */
export const ECHO_MAX_SPAWN_TICK = 9000;
/** 에코 오브젝트의 물리/렌더 반경(월드 유닛). inert — 충돌 판정엔 쓰지 않는다. TODO(밸런스). */
export const ECHO_TRIGGER_RADIUS = 120;
/** 안정화 판정 반경(플레이어–에코 중심 거리). 이 안이면 드웰 누적. TODO(밸런스). */
export const ECHO_STABILIZE_RADIUS = 320;
/** 반경 내 누적 체류 목표 틱(안정화 성공 조건, 60fps 기준 5초). TODO(밸런스). */
export const ECHO_DWELL_TICKS = 300;
/** 안정화 성공 시 지급되는 크레딧 묶음(해시된 경제 — 서버가 리플레이로 재검증). TODO(밸런스). */
export const ECHO_REWARD_CREDITS = 5;
/** 스폰 시 플레이어로부터의 고정 오프셋(난수·삼각함수 없음 — 결정론 자명). TODO(밸런스). */
export const ECHO_SPAWN_OFFSET = 540;

/**
 * 에코 신호 런타임(정수 필드만). positive 런에만 존재한다(그 외 WorldState.echoRuntime = undefined).
 * state 진행: 0(대기 — 스폰 틱 전) → 1(출현 — 안정화 진행 중) → 2(안정화 완료 — 보상 지급됨).
 */
export interface EchoRuntime {
  /** 0 대기(미스폰)·1 출현(안정화 진행)·2 안정화 완료. 해시됨. */
  state: number;
  /** 에코 오브젝트 스폰 예정 틱(롤로 확정). "언제 나왔나"까지 봉인하려 해시한다. */
  spawnTick: number;
  /** 반경 내 누적 체류 틱(상한 ECHO_DWELL_TICKS). 밖이면 감소("버티기"). 해시됨. */
  dwell: number;
  /** 스폰된 에코 엔티티 id(0 = 아직 미스폰). 해시됨. */
  entityId: number;
}

/**
 * 이 런의 에코 출현 여부·스폰 틱을 롤한다. **positive 일 때만** EchoRuntime 을 돌려주고
 * (그 외 undefined) 호출부는 조건부 스프레드로 세운다. 반드시 `worldRng.fork('echoEvent')`
 * 로 롤해 worldRng 자체는 전진시키지 않는다(부모 해시 불변 — 이 함수가 worldRng 를 소비하지
 * 않는 핵심). 스트림 라벨 `'echoEvent'` 는 리플레이/해시 계약이므로 절대 변경 금지.
 */
export function rollEcho(worldRng: SeededRng): EchoRuntime | undefined {
  const r = worldRng.fork('echoEvent');
  if (!r.chance(ECHO_SPAWN_PROB)) return undefined;
  const spawnTick = r.int(ECHO_MIN_SPAWN_TICK, ECHO_MAX_SPAWN_TICK);
  return { state: 0, spawnTick, dwell: 0, entityId: 0 };
}

/**
 * 스폰 틱 도달 시 에코 오브젝트 1개를 플레이어 곁 고정 오프셋에 스폰한다(런당 1회, state 게이트).
 * maybeSpawnSupply 선례 — RNG 미소비·고정 좌표라 웨이브·드랍 시퀀스를 밀지 않는다. echoRuntime
 * 미존재/이미 출현·완료면 no-op.
 */
export function maybeSpawnEcho(state: WorldState, player: Entity): void {
  const rt = state.echoRuntime;
  if (rt === undefined || rt.state !== 0) return;
  if (state.tick < rt.spawnTick) return;
  const echo = spawnEcho(state, player.x + ECHO_SPAWN_OFFSET, player.y, ECHO_TRIGGER_RADIUS);
  rt.entityId = echo.id;
  rt.state = 1;
}

/**
 * 안정화 한 틱(반경 내 체류 누적). 플레이어가 ECHO_STABILIZE_RADIUS 안이면 드웰++(상한
 * ECHO_DWELL_TICKS), 밖이면 드웰--("버티기" — 자리를 뜨면 누적이 준다). 드웰이 목표에 도달하면
 * 안정화 성공: 크레딧(해시된 경제)을 지급하고 state=2, 에코 오브젝트를 dead 처리한다. 전투력
 * 불개입(적 피해·버프 없음). echoRuntime 미존재/미출현/완료면 no-op.
 *
 * 접촉 "즉발"이 아니라 반경 내 **체류 누적**이라 resolveCollisions 격자가 아니라 여기서 플레이어
 * 거리로 직접 판정한다(shelter/boostPad 의 overlap 판정 선례 — 에코 오브젝트는 inert).
 */
export function stepEchoStabilize(state: WorldState, player: Entity): void {
  const rt = state.echoRuntime;
  if (rt === undefined || rt.state !== 1) return;
  let echo: Entity | undefined;
  for (const e of state.entities) {
    if (e.id === rt.entityId && e.kind === 'echo' && !e.dead) {
      echo = e;
      break;
    }
  }
  if (echo === undefined) return; // 정상 경로에선 완료 전까지 살아 있다(방어).
  const dx = player.x - echo.x;
  const dy = player.y - echo.y;
  const r = ECHO_STABILIZE_RADIUS;
  if (dx * dx + dy * dy <= r * r) {
    if (rt.dwell < ECHO_DWELL_TICKS) rt.dwell++;
  } else if (rt.dwell > 0) {
    rt.dwell--;
  }
  if (rt.dwell >= ECHO_DWELL_TICKS) {
    // 안정화 성공 — 해시된 경제(크레딧) 지급. resources 는 hashWorld 에 접히므로(replay.ts)
    // 서버가 리플레이로 재검증한다(ADR-0023 핵심).
    state.resources += ECHO_REWARD_CREDITS;
    rt.state = 2;
    echo.dead = true; // compact 가 다음에 수거한다.
  }
}

/**
 * 에코 신호 한 틱 — 스폰(도달 시) + 안정화(체류 누적). world.ts step 루프의 단일 호출 지점.
 * echoRuntime 미존재(에코 미발생 런·침공)면 두 함수 모두 즉시 no-op(거동·해시 불변).
 */
export function stepEcho(state: WorldState, player: Entity): void {
  maybeSpawnEcho(state, player);
  stepEchoStabilize(state, player);
}

// ---------------------------------------------------------------------------
// RunResult 리더 헬퍼 (settlement 은 W3 이 소비 — 이 파일은 순수 리더만 제공).
// ---------------------------------------------------------------------------

/** 이번 런에 에코 안정화로 파편을 획득했는가(echoRuntime.state===2 파생, 순수 판정). */
export function echoStabilizedOf(state: WorldState): boolean {
  return state.echoRuntime?.state === 2;
}

/**
 * 이번 런의 사연 마일스톤 관측치(metric id → 값). data/lore 의 metric id 계약(불변)과 정확히
 * 같은 키를 쓴다: hitsTaken·overchargeKills·cloakBreaks·broodLaunches·cushionHealed·filmPops.
 * (`runsWon` 은 정산 메타라 여기 없다.) W3 정산이 이 값을 RunResult 델타로 실어 프로필에 누적한다.
 * 비-해시 관측 카운터라 결정론 무영향(순수 리더).
 */
export function runStoryMetrics(state: WorldState): Record<string, number> {
  return {
    hitsTaken: state.hitsTaken,
    overchargeKills: state.overchargeKills,
    cloakBreaks: state.cloakBreaks,
    broodLaunches: state.broodLaunches,
    cushionHealed: state.cushionHealed,
    filmPops: state.filmPops,
  };
}
