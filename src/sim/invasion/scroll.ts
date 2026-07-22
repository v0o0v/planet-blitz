/**
 * 침공 3레이어 — 강제 스크롤 카메라 수학 (M7a · L2-scroll-phase).
 *
 * ## 왜 sim 이 카메라를 갖는가
 * PvE 는 무한 맵이고 카메라가 스냅샷에서 플레이어 좌표로 **파생**된다(src/sim/snapshot.ts,
 * ADR-0005 "sim 은 카메라 상태를 갖지 않는다"). 침공 3레이어는 그 전제를 뒤집는다 —
 * 화면이 플레이어와 무관하게 앞으로 밀려나가고, 플레이어는 그 창 안에 갇힌다. 창의 위치가
 * 곧 스폰·컬링·이동 경계의 정본이므로 **스크롤 오프셋은 sim 권위 상태**여야 한다.
 * PvE 경로는 이 모듈을 한 줄도 타지 않는다(거동·해시 완전 불변).
 *
 * ## 정수 규율
 * 스크롤 오프셋은 f64 누적이 아니라 **정수 월드 유닛 누적**이다. 가속은 centi-percent 정수
 * (100cp = ×1.00)이고, 한 틱 이동량은
 *     step = trunc(INVASION_SCROLL_SPEED × accelCp / 100)
 * 로 잘라 쓴다. 나눗셈이 IEEE-754 단일 연산 + `Math.trunc` 뿐이라 Node(클라)·Deno(서버)에서
 * 비트 동일하고, 누적이 정수라 18000틱을 돌려도 드리프트가 0 이다.
 * 대가는 배율 해상도다 — 속도 12 에서 1유닛이 바뀌려면 cp 가 약 8.33 움직여야 한다.
 * 가속이 100→200 을 25틱 만에 훑는 값이라 체감 단차는 없다.
 */

import { VIEW_WIDTH, VIEW_HEIGHT } from '../constants.js';
import {
  INVASION_ACCEL_BASE_CP,
  INVASION_ACCEL_MAX_CP,
  INVASION_ACCEL_GAIN_CP,
  INVASION_ACCEL_DECAY_CP,
  INVASION_LAYER_TICKS,
  INVASION_PHASE_SCROLL_AXIS,
  SCROLL_AXIS_VERTICAL,
  SCROLL_AXIS_HORIZONTAL,
  SCROLL_AXIS_NONE,
  PHASE_L1,
  PHASE_L2,
} from './constants.js';
import type { InvasionPhase, InvasionRuntime } from './types.js';

/**
 * 스크롤 창 중심을 아는 최소 구조(InvasionRuntime·ScrollRuntime 공통). 순수 창 수학의 입력.
 * `windowCenterX/Y`·`clampToWindow` 는 `scrollX/scrollY` 만 읽으므로 이 구조 타입으로 넓혀
 * 침공(InvasionRuntime)과 PvE 강제 스크롤(ScrollRuntime, Lane3)을 함께 받는다 — 런타임
 * 거동·해시는 불변(타입만 확장, 본문·반환 그대로).
 */
export interface ScrollWindow {
  readonly scrollX: number;
  readonly scrollY: number;
}

/**
 * 기준 스크롤 속도(월드 유닛/틱, 가속 100cp 기준) = 720 u/s.
 * 플레이어 기본 이동 속도(720 u/s)와 같은 값이라 "전진하지 않으면 창 뒤편에 밀린다"가
 * 그대로 성립한다.
 */
export const INVASION_SCROLL_SPEED = 12;

/**
 * 페이즈별 스크롤 진행 방향. 인덱스 = 페이즈 코드.
 * L1 은 +Y→-Y(위로 올라간다), L2 는 +X(오른쪽으로 밀고 나간다), L3 은 고정.
 */
export const INVASION_SCROLL_DIR: readonly number[] = [-1, 1, 0];

/**
 * 레이어 클리어 여유율(%). 레이어 길이 = 기준속도 × 레이어 예산틱 × 이 비율 / 100.
 * 110 이면 **기준 속도로는 예산 안에 끝까지 못 간다** — 즉 가속(구간 전멸)을 벌지 못한
 * 플레이어는 soft 예산 소진으로 강제 전이되고, 잘 미는 플레이어는 길이 도달로 조기 전이한다.
 * 두 종료 조건이 같은 틱에 겹치지 않게 하는 것이 이 값의 목적이다(테스트 분리 가능).
 */
export const INVASION_LAYER_LENGTH_PERCENT = 110;

/** 페이즈별 레이어 주파 길이(정수 월드 유닛). L3(고정 카메라)는 0. */
export const INVASION_LAYER_LENGTH: readonly number[] = INVASION_LAYER_TICKS.map((ticks, phase) =>
  (INVASION_PHASE_SCROLL_AXIS[phase] ?? SCROLL_AXIS_NONE) === SCROLL_AXIS_NONE
    ? 0
    : Math.trunc((INVASION_SCROLL_SPEED * ticks * INVASION_LAYER_LENGTH_PERCENT) / 100),
);

/** 스크롤 창 가로 절반(월드 유닛). 뷰포트와 동일 — 창 = 화면. */
export const INVASION_WINDOW_HALF_W = VIEW_WIDTH / 2;
/** 스크롤 창 세로 절반(월드 유닛). */
export const INVASION_WINDOW_HALF_H = VIEW_HEIGHT / 2;

/** 침공 런 시작 런타임(전 필드 정수). 플레이어 시작 좌표(0,0)가 창 중심이다. */
export function createInvasionRuntime(): InvasionRuntime {
  return {
    phase: PHASE_L1 as InvasionPhase,
    phaseEnterTick: 0,
    scrollX: 0,
    scrollY: 0,
    accelCp: INVASION_ACCEL_BASE_CP,
  };
}

/** 페이즈의 스크롤 축(SCROLL_AXIS_*). */
export function scrollAxisFor(phase: number): number {
  return INVASION_PHASE_SCROLL_AXIS[phase] ?? SCROLL_AXIS_NONE;
}

/** 페이즈의 주파 길이(월드 유닛). */
export function layerLength(phase: number): number {
  return INVASION_LAYER_LENGTH[phase] ?? 0;
}

/**
 * 이번 틱의 스크롤 이동량(정수 유닛). 가속 배율만의 순수 함수 — 상태·시간에 의존하지 않는다.
 */
export function scrollStep(accelCp: number): number {
  return Math.trunc((INVASION_SCROLL_SPEED * accelCp) / 100);
}

/**
 * 다음 틱의 가속 배율(cp). 구간 전멸 중이면 +GAIN, 아니면 -DECAY, 항상 [BASE, MAX] 클램프.
 * 감쇠(4)가 가산(2)보다 빨라 적이 하나라도 살아나면 즉시 감속으로 돌아선다.
 */
export function nextAccelCp(accelCp: number, cleared: boolean): number {
  const next = cleared
    ? accelCp + INVASION_ACCEL_GAIN_CP
    : accelCp - INVASION_ACCEL_DECAY_CP;
  if (next < INVASION_ACCEL_BASE_CP) return INVASION_ACCEL_BASE_CP;
  if (next > INVASION_ACCEL_MAX_CP) return INVASION_ACCEL_MAX_CP;
  return next;
}

/** 현재 페이즈의 축·방향으로 스크롤 오프셋을 한 틱 전진시킨다(정수 누적). */
export function advanceScrollOffset(runtime: InvasionRuntime): void {
  const axis = scrollAxisFor(runtime.phase);
  if (axis === SCROLL_AXIS_NONE) return;
  const delta = scrollStep(runtime.accelCp) * (INVASION_SCROLL_DIR[runtime.phase] ?? 0);
  if (axis === SCROLL_AXIS_VERTICAL) runtime.scrollY += delta;
  else if (axis === SCROLL_AXIS_HORIZONTAL) runtime.scrollX += delta;
}

/**
 * 현재 페이즈에서 지금까지 주파한 거리(월드 유닛, 0 이상).
 * 축이 페이즈마다 갈리므로(L1=Y, L2=X) 오프셋 자체가 페이즈별 진척도가 된다 — 별도 기준점
 * 상태를 두지 않아도 되고, 그만큼 해시에 접을 필드가 줄어든다.
 */
export function layerProgress(runtime: InvasionRuntime): number {
  if (runtime.phase === PHASE_L1) return -runtime.scrollY;
  if (runtime.phase === PHASE_L2) return runtime.scrollX;
  return 0;
}

/** 스크롤 창 중심 x(= 카메라 x). */
export function windowCenterX(runtime: ScrollWindow): number {
  return runtime.scrollX;
}

/** 스크롤 창 중심 y(= 카메라 y). */
export function windowCenterY(runtime: ScrollWindow): number {
  return runtime.scrollY;
}

/**
 * 좌표를 스크롤 창 안으로 클램프한다(반지름만큼 안쪽). 반환은 새 객체 — 호출부가 대입한다.
 * PvE 의 "무한 맵, 아레나 클램프 없음" 규율은 그대로고, 이 함수는 침공 경로에서만 불린다.
 */
export function clampToWindow(
  x: number,
  y: number,
  radius: number,
  runtime: ScrollWindow,
): { x: number; y: number } {
  const cx = windowCenterX(runtime);
  const cy = windowCenterY(runtime);
  // 창보다 큰 히트박스는 클램프 구간이 뒤집히므로 중심으로 접는다(방어적 — 현 반지름 32 에선
  // 발생하지 않는다).
  const spanX = INVASION_WINDOW_HALF_W - radius;
  const spanY = INVASION_WINDOW_HALF_H - radius;
  if (spanX <= 0 || spanY <= 0) return { x: cx, y: cy };
  let nx = x;
  let ny = y;
  if (nx < cx - spanX) nx = cx - spanX;
  else if (nx > cx + spanX) nx = cx + spanX;
  if (ny < cy - spanY) ny = cy - spanY;
  else if (ny > cy + spanY) ny = cy + spanY;
  return { x: nx, y: ny };
}
