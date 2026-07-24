/**
 * 촉각 피드백 스프링 곡선 (그래픽 이펙트 Phase 5 — AC-5.3 · ADR-0031).
 *
 * {@link PixiButton} 의 눌림 스쿼시·집기 lift 를 카툰 느낌의 **탄성 스프링**으로 구동한다.
 * 핵심 물리는 여기 순수함수로 분리해 node 환경에서 경계·정착·overshoot 를 검증한다
 * (render-only — sim·해시 무관, ADR-0005).
 *
 * ── 왜 감쇠 진동자인가 ── scale 을 목표로 선형 보간(lerp)하면 "부드럽게 붙기"만 하고 카툰
 * 특유의 **살짝 지나쳤다 되돌아오는 바운스**가 안 나온다. 과감쇠 미만(under-damped) 스프링은
 * 목표를 조금 넘어섰다가(overshoot) 정착하므로, 눌렀다 떼는 버튼에 탱글탱글한 손맛을 준다.
 *
 * ── 밸런스 유예(defer-balance-tuning) ── 스쿼시 깊이·스프링 강성/감쇠·광택 세기는 전부
 * placeholder 다. 출시 직전 촉감 튜닝 패스에서 일괄 조정한다. 지금은 "명확히 눌리고 명확히
 * 튕겨 돌아온다"만 만족하면 된다.
 */

/** 스프링 1차 상태(현재 값·속도). value 는 inner 컨테이너에 적용할 scale 배율. */
export interface SpringState {
  /** 현재 스칼라 값(버튼에선 scale 배율, 정착 목표는 보통 1.0). */
  value: number;
  /** 현재 속도(1/초). 정착 판정에 함께 쓴다. */
  velocity: number;
}

/** 스프링 계수(강성·감쇠). 감쇠비 ζ = damping / (2·√stiffness) 가 1 미만이면 overshoot. */
export interface SpringConfig {
  /** 강성 — 클수록 빠르고 팽팽하게 목표로 당긴다. */
  stiffness: number;
  /** 감쇠 — 클수록 진동을 빨리 죽인다. √(4·stiffness) 미만이면 under-damped(바운스). */
  damping: number;
}

/**
 * 카툰 촉각 스프링 계수(placeholder). ζ = 20 / (2·√420) ≈ 0.49 < 1 → under-damped.
 * 눌림 복귀 시 목표(1.0)를 약 1.3% 지나쳤다 정착 = 탱글한 바운스.
 */
export const TACTILE_SPRING: SpringConfig = { stiffness: 420, damping: 20 };

/** 눌림 스쿼시 목표 배율(placeholder) — 살짝 눌린 느낌. */
export const SQUASH_SCALE = 0.92;

/** 집기 lift 목표 배율(placeholder, 옵션 on일 때만) — 살짝 떠오름. */
export const LIFT_SCALE = 1.04;

/** 호버 광택 오버레이 최대 알파(placeholder) — 은은한 밝힘. */
export const GLOSS_ALPHA = 0.16;

/** 스프링 dt 클램프(초). 탭 전환·백그라운드 복귀로 프레임이 크게 튀어도 폭주하지 않게 상한. */
export const MAX_TACTILE_DT = 1 / 30;

/** 정착 판정 — 값이 목표에 이만큼 붙고(배율 오차) 속도가 이만큼 느리면 정착으로 본다. */
export const SETTLE_VALUE_EPS = 0.0015;
export const SETTLE_VELOCITY_EPS = 0.02;

/**
 * 감쇠 스프링 1스텝(준-암시적 오일러, 순수). 현재 상태를 목표 `target` 쪽으로 한 프레임 나아가게
 * 한다. under-damped 계수면 target 을 지나 overshoot 한 뒤 되돌아온다. dt 는 {@link MAX_TACTILE_DT}
 * 로 클램프해 큰 프레임 점프에도 발산하지 않는다.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  cfg: SpringConfig,
  dt: number,
): SpringState {
  const clampedDt = Math.min(Math.max(dt, 0), MAX_TACTILE_DT);
  // 준-암시적 오일러: 가속도로 속도를 먼저 갱신하고, 그 속도로 값을 옮긴다(명시적 오일러보다 안정).
  const accel = -cfg.stiffness * (state.value - target) - cfg.damping * state.velocity;
  const velocity = state.velocity + accel * clampedDt;
  const value = state.value + velocity * clampedDt;
  return { value, velocity };
}

/**
 * 정착 여부(순수). 값이 목표에 충분히 붙고 속도가 충분히 느리면 true — 이때 구독을 끊어
 * idle 비용을 0 으로 만든다(호출부에서 스냅 후 unsubscribe).
 */
export function isSpringSettled(state: SpringState, target: number): boolean {
  return (
    Math.abs(state.value - target) <= SETTLE_VALUE_EPS &&
    Math.abs(state.velocity) <= SETTLE_VELOCITY_EPS
  );
}
