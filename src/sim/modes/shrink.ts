/**
 * 수축지대(shrink) 모드 — Lane7 (ADR-0021 §2.5). 비-스크롤 **자유추적** 모드.
 * 아레나 중심(고정 원점 0,0) 기준 **동적으로 줄어드는 안전 반경** 밖에 있으면 지속 피해를
 * 준다(배틀로얄식 압박존, 하드 클램프 없음 — 밖으로 나갈 수는 있고 피해만 받는다). 안전
 * 반경 안의 적을 전멸시키면 세그먼트가 전진하고(그때 유예 후 반경이 한 단계 더 조여진다),
 * 마지막에 아레나 중심에 보스가 소환되면 처치로 완주한다. 서바이벌 코어(웨이브 디렉터·파워업·
 * 드랍)는 불변, 진행/실패 게이트만 반경 규칙으로 바꾼다. 전 계수는 플레이스홀더 —
 * TODO(밸런스): 출시 전 일괄 튜닝.
 *
 * ## 신규 WorldState 필드 1 (이 재설계의 첫 "신규 해시 필드" 모드)
 * contamination(Lane8)·chase(Lane6)는 상태를 전부 엔티티/aux 에 실어 신규 필드가 0 이었지만,
 * 수축 반경은 게임플레이 이력(유예 종료 후 경과 틱 + 세그먼트 전진 시점의 리셋)에 의존해
 * 누적되는 동적 정수라 tick 의 닫힌 함수로 파생할 수 없다 → `WorldState.shrinkRuntime?`
 * 신규 필드가 필요하다(scrollRuntime.scrollX/accelCp 와 정확히 같은 사유). 배선(필드 선언·
 * createWorld 조건부 세움·조건부 스프레드·hashWorld 조건부 폴드)은 scrollRuntime 4단을,
 * 모듈 순수 헬퍼 구조는 contamination/chase 를 미러한다.
 *   - 안전 반경 = `shrinkRuntime.safeRadius`(정수). 밖 피해·링 전멸·스폰 판정의 정본.
 *   - 유예 = `shrinkRuntime.graceTicks`(정수). >0 이면 이번 틱 수축 보류(세그먼트 전진 직후 숨돌릴 틈).
 * → hashWorld 는 `shrinkRuntime !== undefined` 게이트로 shrink 런에만 정수 2필드를 append-only
 *   꼬리에 접는다 → 뱀서류·침공·블록격파·레이싱·추격·오염 바이트 불변.
 *
 * ## 결정론(ADR-0005)
 * RNG·Date.now·전역을 쓰지 않는다. 반경·유예·감소량 전부 **정수 필수**(hashU32 로 접힘 —
 * 소수부 유실). 감소는 정수 뺄셈뿐(부동소수 금지). 배치 RNG 없음 — 적은 웨이브 디렉터 기존
 * 경로로 스폰되고, shrink 는 스폰 위치만 원점 기준으로 재배치한다. 밖 피해·링 판정은 순수
 * 위치 함수(원점 기준 원 거리)라 사전 배치 gimmick 엔티티가 없다(청크 컬링 무관).
 *
 * ## 순환 의존 주의
 * world.ts / waves.ts / snapshot.ts 가 이 모듈을 런타임 import 하므로, 이 모듈은 world 에서
 * **타입만** 가져온다(`import type`). 런타임 의존은 leaf 모듈(entities)로만(contamination/chase 선례).
 */
import type { Entity } from '../entities.js';
import type { WorldState } from '../world.js';

// --- 플레이스홀더 계수 (TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정) ---
/** 안전 반경 시작값(월드 유닛, 정수). 원점 0,0 기준. TODO(밸런스). */
export const SHRINK_INITIAL_RADIUS = 2000;
/** 안전 반경 하한(정수). 수축이 이 값에서 멈춘다(0 으로 조이면 코어가 붕괴). TODO(밸런스). */
export const SHRINK_MIN_RADIUS = 600;
/** 유예 소진 후 매 틱 반경 감소량(정수). 정수 뺄셈뿐 — 부동소수 금지. TODO(밸런스). */
export const SHRINK_RATE_PER_TICK = 1;
/** 세그먼트 전진 직후 부여되는 유예 틱(정수). 이 동안 반경이 홀드된다(숨돌릴 틈). TODO(밸런스). */
export const SHRINK_GRACE_TICKS = 120;
/** 안전 반경 밖 지속 피해(iframes 간격 적용, 즉사 아님). TODO(밸런스). */
export const SHRINK_OUT_OF_BOUNDS_DAMAGE = 8;
/**
 * 적 스폰 링 반경(아레나 중심 0,0 기준). shrinkSpawnRadius 가 현재 safeRadius 이하로 조여
 * 스폰이 항상 안전 반경 안에 들도록 보장한다 — 그래야 링 전멸 게이트가 성립한다(밖에 스폰되면
 * shrinkRingCleared 가 즉시 true 가 되어 세그먼트가 헛돈다). 시작값 < SHRINK_INITIAL_RADIUS.
 * TODO(밸런스).
 */
export const SHRINK_SPAWN_RING_RADIUS = 1400;
/**
 * 스폰 링 인셋(safeRadius 경계에서 안쪽으로 당기는 정수 여유). ⚠️ 결정론용 Taylor sin/cos
 * (`math.ts`)는 **모든 각도에서 cos²+sin²>1**(20M 각도 전수 실측 최대 1.0000071)이라, 경계
 * (=safeRadius)에 스폰하면 `x²+y² = r²·(cos²+sin²) > safeRadius²` 가 되어 `shrinkRingCleared` 가
 * 그 적을 **"밖"으로 오분류**한다 → 스폰 틱에 링이 "전멸"로 보여 세그먼트가 조기 전진(코어
 * 진행 규칙 무력화, 리뷰 MED). 스폰을 이 인셋만큼 **엄격히 안쪽**에 둬 링 전멸 게이트 불변식
 * ("스폰은 항상 안전 반경 안")을 실제로 성립시킨다. 상대오차 ~7e-6 라 1 유닛이면 충분하나
 * 여유를 준다(정수). TODO(밸런스).
 */
export const SHRINK_SPAWN_INSET = 16;

/** 수축지대 런타임(정수 2필드). 원점 0,0 이 안전 반경의 중심이다. */
export interface ShrinkRuntime {
  /** 현재 안전 반경(월드 유닛, 정수). 원점 0,0 기준. 유예 후 매 틱 SHRINK_RATE_PER_TICK 만큼 최소 반경까지 조여진다. */
  safeRadius: number;
  /** 남은 유예 틱(정수). >0 이면 이번 틱 수축 보류(세그먼트 전진 직후 숨돌릴 틈). */
  graceTicks: number;
}

/** 수축 런 시작 런타임(전 필드 정수). 초기 반경 + 시작 유예. */
export function createShrinkRuntime(): ShrinkRuntime {
  return { safeRadius: SHRINK_INITIAL_RADIUS, graceTicks: SHRINK_GRACE_TICKS };
}

/**
 * 반경 전진 한 틱(순수, stepWorld 배선). 유예가 남아 있으면 이번 틱은 유예만 1 소진하고 반경을
 * 홀드한다. 유예가 0 이면 최소 반경까지 정수 감소한다(하한 클램프). 세그먼트 전진 시 graceTicks
 * 리셋은 waves.ts 가 별도로 한다(이 함수는 감소·유예 소진만). 정수 뺄셈뿐 — 부동소수 없음.
 */
export function advanceShrinkRuntime(rt: ShrinkRuntime): void {
  if (rt.graceTicks > 0) {
    rt.graceTicks--;
    return;
  }
  if (rt.safeRadius > SHRINK_MIN_RADIUS) {
    rt.safeRadius -= SHRINK_RATE_PER_TICK;
    if (rt.safeRadius < SHRINK_MIN_RADIUS) rt.safeRadius = SHRINK_MIN_RADIUS;
  }
}

/**
 * 현재 안전 반경(스폰·판정·snapshot 공용). shrinkRuntime 미존재면 0(수축 아님 — 밖 판정·스폰
 * 제약을 걸지 않는다). 순수 판정 — 상태를 바꾸지 않는다.
 */
export function shrinkSafeRadius(state: WorldState): number {
  return state.shrinkRuntime?.safeRadius ?? 0;
}

/**
 * 적 스폰 링 반경(아레나 중심 0,0 기준, waves.ts formationPositions 배선). 항상 현재 safeRadius
 * **이하**로 조여(min) 스폰이 안전 반경 안에 들도록 보장한다 — 이게 링 전멸 게이트의 구조적
 * 전제(밖에 스폰하면 gate 가 헛돈다)다. shrinkRuntime 미존재면 0(shrink 아님).
 */
export function shrinkSpawnRadius(state: WorldState): number {
  const r = shrinkSafeRadius(state);
  if (r <= 0) return 0;
  // 스폰은 항상 안전 반경 **미만**이어야 링 전멸 게이트가 성립한다(SHRINK_SPAWN_INSET 근거 참조).
  // safeRadius 를 스폰 링 반경 상한으로 min 한 뒤, 인셋으로 경계에서 엄격히 떼어 낸다 — safeRadius
  // 가 SHRINK_SPAWN_RING_RADIUS 와 같은 경계값(예: 정확히 1400)일 때도 안쪽이 보장된다.
  const capped = r < SHRINK_SPAWN_RING_RADIUS ? r : SHRINK_SPAWN_RING_RADIUS;
  const inset = capped - SHRINK_SPAWN_INSET;
  return inset < 0 ? 0 : inset;
}

/**
 * 안전 반경 밖(원점 0,0 기준 거리 > safeRadius)에 있는 플레이어에게 지속 피해(racingRearPressure
 * 이식 — 직사각 뒤 경계 판정을 원형 거리 판정으로 바꿈). 무적 프레임을 존중하고(피격과 같은
 * 규율) 피해 후 피격 무적을 부여해 매 틱 갈리는 것을 막는다. 즉사 아님(누적) — 정수 산술로 f64
 * 누적이 없다. shrinkRuntime 미존재면 즉시 return(수축 아님 → 무피해). 하드 클램프는 걸지
 * 않는다(밖으로 나갈 수는 있고 피해만 받는 배틀로얄식 압박).
 */
export function shrinkOutOfBounds(state: WorldState, player: Entity): void {
  const rt = state.shrinkRuntime;
  if (rt === undefined) return;
  const safeR = rt.safeRadius;
  if (player.x * player.x + player.y * player.y <= safeR * safeR) return; // 안 = 무피해
  if (player.iframes > 0) return;
  player.hp -= SHRINK_OUT_OF_BOUNDS_DAMAGE;
  if (player.hp < 0) player.hp = 0;
  player.iframes = state.config.hitIframes;
}

/**
 * 링 전멸 여부(세그먼트 전진 게이트, waves.ts 배선 · blockBreakCleared 원형 이식). 살아있는
 * **enemy** 가 안전 반경(원점 0,0 기준 원) 안에 하나도 없으면 true. 순수 판정 — 상태를 바꾸지
 * 않는다. shrinkRuntime 미존재면 false.
 *
 * ⚠️ **보스는 세지 않는다**(`e.kind === 'enemy'` 만). 보스는 항상 아레나 중심(0,0)에 소환되어
 * 늘 안전 반경 안이라, 보스를 포함하면 ring-cleared 가 영원히 false 가 된다. blockBreakCleared 는
 * enemy/boss 를 함께 세지만 shrink 는 enemy 만 — 보스 세그먼트 도달·처치는 stepBoss/compact
 * 공통 경로가 관리한다(세그먼트 전진 게이트는 `!seg.boss` 라 보스 세그먼트에는 애초 안 걸린다).
 */
export function shrinkRingCleared(state: WorldState): boolean {
  const rt = state.shrinkRuntime;
  if (rt === undefined) return false;
  const safeR = rt.safeRadius;
  const r2 = safeR * safeR;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy') continue;
    if (e.x * e.x + e.y * e.y <= r2) return false;
  }
  return true;
}
