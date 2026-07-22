/**
 * PvE 행성 모드 강제 스크롤 런타임(ADR-0021, Lane3). 침공 3레이어(InvasionRuntime)와
 * **분리된** 경량 런타임 — phase(L1/L2/L3) 의미를 빌리지 않는다. scroll.ts 순수 코어
 * (scrollStep·nextAccelCp·windowCenterX/Y·clampToWindow)는 공유한다.
 * 블록격파=−Y 종스크롤, 레이싱=+X 횡스크롤. 콘텐츠·전멸가속 신호는 Lane4/5.
 */
import { INVASION_ACCEL_BASE_CP, SCROLL_AXIS_VERTICAL, SCROLL_AXIS_HORIZONTAL } from './invasion/constants.js';
import { scrollStep, nextAccelCp } from './invasion/scroll.js';
import { PLANET_MODE, type PlanetMode } from './planetMode.js';

/** PvE 강제 스크롤 런타임(전 필드 정수). 시작 좌표(0,0)가 창 중심. */
export interface ScrollRuntime {
  scrollX: number;
  scrollY: number;
  accelCp: number;
}

/** 모드 → {축, 방향}. 강제 스크롤 모드가 아니면 undefined. */
export function scrollModeAxisDir(mode: PlanetMode | undefined): { axis: number; dir: number } | undefined {
  if (mode === PLANET_MODE.blockBreak) return { axis: SCROLL_AXIS_VERTICAL, dir: -1 }; // 하→상
  if (mode === PLANET_MODE.racing) return { axis: SCROLL_AXIS_HORIZONTAL, dir: 1 };     // 좌→우
  return undefined;
}

/** 이 모드가 강제 스크롤 모드인가(블록격파·레이싱). 그 외(뱀서류·추격·수축·오염)는 false. */
export function isScrollMode(mode: PlanetMode | undefined): boolean {
  return scrollModeAxisDir(mode) !== undefined;
}

/** PvE 강제 스크롤 런 시작 런타임. 플레이어 시작 좌표(0,0)가 창 중심이다. */
export function createScrollRuntime(): ScrollRuntime {
  return { scrollX: 0, scrollY: 0, accelCp: INVASION_ACCEL_BASE_CP };
}

/**
 * 스크롤 오프셋을 한 틱 전진(정수 누적). 축·방향은 명시 주입(phase 미참조).
 * `cleared`(전멸 가속)는 Lane3 인프라에선 항상 false — TODO(Lane4/5): 구간 전멸 신호 배선.
 */
export function advanceScrollRuntime(rt: ScrollRuntime, axisDir: { axis: number; dir: number }, cleared: boolean): void {
  const delta = scrollStep(rt.accelCp) * axisDir.dir;
  if (axisDir.axis === SCROLL_AXIS_VERTICAL) rt.scrollY += delta;
  else if (axisDir.axis === SCROLL_AXIS_HORIZONTAL) rt.scrollX += delta;
  rt.accelCp = nextAccelCp(rt.accelCp, cleared);
}
