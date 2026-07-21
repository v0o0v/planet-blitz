/**
 * 압축 프레스 — 이동 벽 (M7c · C2-facility-wall).
 *
 * M7a 에서 M7c 로 **이월된 항목**이다. 이월 사유가 그대로 이 모듈의 설계 제약이다:
 * 기존 터널링 방지는 코드 주석(src/sim/world.ts stepPlayer)이 밝히듯 **정적 전제** 위에 서
 * 있다 — "최대 대시 스텝 ~59u < 벽 최소 전폭 120u 이므로 한 틱에 벽을 통과할 수 없다".
 * 벽이 움직이면 이 전제가 무너진다. 벽이 플레이어 쪽으로 오는 프레임의 **유효 스텝은
 * (플레이어 스텝 + 벽 스텝)** 이고, 정적 겹침 판정(slideCircleWalls)은 그 사이 프레임을
 * 아예 보지 못한다.
 *
 * ## 그래서 무엇을 신설했나
 * ① **상대 프레임 스윕 판정.** 벽을 정지시킨 좌표계에서 플레이어의 (직전 위치 → 현재 위치)
 *    선분을 벽 AABB(플레이어 반지름만큼 민코프스키 확장)에 대해 슬랩 클립한다. 벽의 이동은
 *    시작점을 `이전 벽 좌표`, 끝점을 `현재 벽 좌표` 기준으로 잡는 것으로 상쇄된다 —
 *    즉 스윕 입력이 곧 **상대 변위**다. 두께와 무관하게 관통이 0 이다(정적 폭 비교 불요).
 * ② **끼임(crush) 규칙.** 밀어낸 자리가 다른 벽·스크롤 창에 막히면 플레이어를 무한히
 *    밀지 않는다. 정적 벽/창으로 되밀린 좌표를 **그대로 확정**하고 고정 피해만 준다.
 *    되밀기 루프가 없으므로 좌표 폭주·NaN 이 구조적으로 불가능하다.
 * ③ **wallIndex 갱신 규율.** 프레스가 움직인 틱에는 broad-phase 격자가 즉시 stale 이 된다
 *    (world.ts 는 틱 머리에서 한 번만 rebuild 한다). 이 모듈이 이동 직후
 *    {@link InvasionWallIndex.refresh} 를 호출해 같은 틱 뒷단(stepProjectiles)이 stale 좌표를
 *    쓰지 못하게 한다. **침공 경로에서만** 존재하는 인덱스라(PvE 는 `state.wallIndex === null`)
 *    PvE 판정·해시는 한 바이트도 바뀌지 않는다.
 *
 * ## 결정론(ADR-0005)
 * 프레스 좌표는 **틱의 순수 함수**다: `base + 삼각파(tick, 주기, 위상, 이동거리)`. 주기·위상·
 * 이동거리는 전부 정수이고 삼각파는 단일 나눗셈 + `Math.round` 라 f64 누적이 없다. 같은 틱은
 * 항상 같은 좌표를 낸다 — 상태를 재생할 필요도, 드리프트도 없다. RNG·wall-clock 미사용.
 *
 * ## 엔티티 필드 매핑 — 단일 정본(다른 곳에서 재정의 금지)
 * 프레스는 **새 kind 를 만들지 않고 기존 `wall` kind 를 그대로 쓴다**. 벽 하나가 이동할 뿐이라
 * 이동 차단·탄 차단·LOS 가림이 전부 기존 경로로 공짜로 붙고, `KIND_CODE`(해시 계약, 다른
 * 레인 소유)를 건드리지 않아도 된다.
 *
 * | 필드 | 의미 |
 * |---|---|
 * | `radius` / `targetX` | 벽 AABB 반폭/반높이(entities.spawnWall 정본 매핑) |
 * | `enemyType` | {@link MOVING_WALL_TAG} — 일반 벽(-1)과 구분하는 표식 |
 * | `aux0` | 설비 catalogId |
 * | `aux1` | 소켓 인덱스 |
 * | `phase` | 이동 축({@link PRESS_AXIS_Y}=0 / {@link PRESS_AXIS_X}=1) |
 * | `pierce` | 이동 방향(1 = 축 +방향, 0 = -방향) |
 * | `targetY` | 축 위 기준 좌표(base, 정수) |
 * | `cooldown` | 편도 이동 거리(정수) |
 * | `timer` | 왕복 주기(틱, 정수) |
 * | `iframes` | 위상 오프셋(틱, 정수) |
 * | `damage` | 끼임 틱당 피해(정수) |
 * | `dashCooldown` | 플레이어 관측 초기화 플래그(0 = 미관측, 1 = 관측됨) |
 * | `vx` / `vy` | **직전 틱 관측 플레이어 좌표**(스윕 시작점). 속도가 아니다 — 벽은 속도 적분 대상이 아니라서 이 두 칸이 비어 있고, 해시는 f64 로 접으므로 좌표를 실어도 계약이 성립한다 |
 * | `hp` / `maxHp` | 0 — 프레스는 **파괴 불가**(회랑 정적 벽과 같은 취급) |
 */

import type { Entity } from '../entities.js';
import { spawnWall } from '../entities.js';
import type { WorldState } from '../world.js';
import { circleOverlapsWall, slideCircleWalls } from '../los.js';
import { clampToWindow } from './scroll.js';
import type { FacilitySpec } from '../../../data/invasion/facilities.js';
import { FACILITY_BEHAVIOR_PRESS } from '../../../data/invasion/facilities.js';
import type { InvasionSocketDef } from '../../../data/invasion/mapTemplates.js';
import type { FacilityRef, InvasionStepContext } from './types.js';

/** `wall` 엔티티가 압축 프레스임을 나타내는 `enemyType` 표식(일반 벽은 -1). */
export const MOVING_WALL_TAG = 1;

/** 플레이어가 판의 어느 쪽에 있는지 아직 모름(`ownerId` 인코딩). */
export const PRESS_SIDE_NONE = 0;
/** 플레이어가 이동 축 **+방향** 쪽에 있다. */
export const PRESS_SIDE_POS = 1;
/** 플레이어가 이동 축 **-방향** 쪽에 있다. */
export const PRESS_SIDE_NEG = 2;

/** 이동 축 — Y(회랑 상하). */
export const PRESS_AXIS_Y = 0;
/** 이동 축 — X(회랑 전후). */
export const PRESS_AXIS_X = 1;

/**
 * 플레이어 한 틱 최대 변위(월드 유닛). 대시 임펄스(2800) + 기본 속도(720)를 60Hz 로 나눈
 * 값(≈58.67)의 올림이다. 스윕 판정 자체는 이 값을 쓰지 않는다 — **데이터 불변식 검증**
 * ({@link pressMaxStep} 과의 합이 프레스 전두께 미만인지)에만 쓰는 심층 방어 상수다.
 */
export const MAX_PLAYER_STEP_UNITS = 59;

/**
 * 밀어낸 뒤 표면에서 띄우는 여유(월드 유닛). 0 이면 다음 틱 스윕의 시작점이 정확히 표면에
 * 놓여 부동소수 경계에서 진동할 수 있다. 1u 는 반지름 32 대비 무시할 만하다.
 */
export const PRESS_SURFACE_SKIN = 1;

// ---------------------------------------------------------------------------
// 축·좌표 — 전부 틱의 순수 함수
// ---------------------------------------------------------------------------

/** 이동 축과 방향. */
export interface PressAxisDir {
  /** {@link PRESS_AXIS_Y} 또는 {@link PRESS_AXIS_X}. */
  readonly axis: number;
  /** +1 또는 -1. */
  readonly sign: number;
}

/**
 * 소켓 facing(정수 도) → 이동 축·방향. 삼각함수를 쓰지 않는다 — 사분면 경계를 정수 도
 * 비교로 가른다(0/90/180/270 은 정확히 축에 떨어지고, 그 사이 각도는 지배 축으로 접힌다).
 */
export function pressAxisDir(facingDeg: number): PressAxisDir {
  const d = ((Math.trunc(facingDeg) % 360) + 360) % 360;
  if (d < 45 || d >= 315) return { axis: PRESS_AXIS_X, sign: 1 };
  if (d < 135) return { axis: PRESS_AXIS_Y, sign: 1 };
  if (d < 225) return { axis: PRESS_AXIS_X, sign: -1 };
  return { axis: PRESS_AXIS_Y, sign: -1 };
}

/**
 * 왕복 삼각파 변위(정수, 0 .. travel). 주기의 전반은 0 → travel, 후반은 travel → 0.
 *
 * 나눗셈은 단계마다 **한 번**이고 즉시 `Math.round` 로 정수화한다(f64 누적 금지). 홀수 주기는
 * 전반 길이를 내림해도 결과가 [0, travel] 을 벗어나지 않는다.
 */
export function pressTriangleOffset(
  tick: number,
  travel: number,
  periodTicks: number,
  phaseOffset: number,
): number {
  if (periodTicks <= 0 || travel === 0) return 0;
  const raw = (tick - phaseOffset) % periodTicks;
  // `raw === 0` 은 -0 도 참이라 여기서 +0 으로 접는다. -0 을 그대로 흘리면 아래 곱셈이
  // -0 을 낳고 `Object.is` 대조(골든 스냅샷·바이트 동일 검증)가 갈린다.
  const pos = raw < 0 ? raw + periodTicks : raw === 0 ? 0 : raw;
  const half = Math.floor(periodTicks / 2);
  if (half <= 0) return 0;
  const rising = pos < half;
  const num = rising ? pos : periodTicks - pos;
  const den = rising ? half : periodTicks - half;
  if (den <= 0) return 0;
  const v = Math.round((travel * num) / den);
  if (v < 0) return 0;
  return v > travel ? travel : v;
}

/**
 * 프레스 판의 축 좌표(틱의 순수 함수). 상태를 읽지 않으므로 어떤 틱이든 임의 순서로 물어볼 수
 * 있다 — 스윕이 필요로 하는 "직전 틱 좌표"도 저장 없이 여기서 다시 구한다.
 */
export function pressCoordAt(
  tick: number,
  base: number,
  travel: number,
  periodTicks: number,
  phaseOffset: number,
  sign: number,
): number {
  return base + pressTriangleOffset(tick, travel, periodTicks, phaseOffset) * (sign >= 0 ? 1 : -1);
}

/** 프레스 한 틱 최대 이동량(정수). 데이터 불변식 검증용. */
export function pressMaxStep(travel: number, periodTicks: number): number {
  if (periodTicks <= 0 || travel <= 0) return 0;
  let max = 0;
  for (let t = 1; t <= periodTicks; t++) {
    const a = pressTriangleOffset(t - 1, travel, periodTicks, 0);
    const b = pressTriangleOffset(t, travel, periodTicks, 0);
    const d = b > a ? b - a : a - b;
    if (d > max) max = d;
  }
  return max;
}

// ---------------------------------------------------------------------------
// 엔티티 판별 · 스폰
// ---------------------------------------------------------------------------

/** 압축 프레스(이동 벽) 엔티티인가. */
export function isMovingWall(e: Entity): boolean {
  return e.kind === 'wall' && e.enemyType === MOVING_WALL_TAG;
}

/** 프레스 엔티티에서 이번 틱의 축 좌표를 되읽는다(순수 — 엔티티 좌표를 신뢰하지 않는다). */
export function movingWallCoordAt(e: Entity, tick: number): number {
  return pressCoordAt(tick, e.targetY, e.cooldown, e.timer, e.iframes, e.pierce === 1 ? 1 : -1);
}

/**
 * 소켓 1기에 압축 프레스를 스폰한다. 판은 소켓 자리에서 시작해 소켓 facing 방향으로
 * `pressTravel` 만큼 왕복한다. 위상은 **소켓 인덱스에서 결정론 파생**(RNG 미소비)해 같은
 * 회랑의 프레스가 일제히 뻗지 않게 엇갈린다.
 *
 * 스펙이 프레스 거동이 아니거나 이동 거리·주기가 0 이면 스폰하지 않는다(undefined).
 */
export function spawnMovingWall(
  state: WorldState,
  socket: InvasionSocketDef,
  socketIndex: number,
  ref: FacilityRef,
  spec: FacilitySpec,
): Entity | undefined {
  if (spec.behavior !== FACILITY_BEHAVIOR_PRESS) return undefined;
  if (spec.pressTravel <= 0 || spec.pressPeriodTicks <= 0) return undefined;
  const { axis, sign } = pressAxisDir(socket.facingDeg);
  const halfAlong = spec.pressHalfAlong;
  const halfAcross = spec.pressHalfAcross;
  const halfW = axis === PRESS_AXIS_X ? halfAlong : halfAcross;
  const halfH = axis === PRESS_AXIS_X ? halfAcross : halfAlong;
  const base = axis === PRESS_AXIS_X ? socket.x : socket.y;
  // 위상 오프셋: 소켓 인덱스로 주기를 균등 분할(정수 나눗셈 1회).
  const phaseOffset = Math.floor((socketIndex * spec.pressPeriodTicks) / 4) % spec.pressPeriodTicks;
  const coord = pressCoordAt(state.tick, base, spec.pressTravel, spec.pressPeriodTicks, phaseOffset, sign);
  const x = axis === PRESS_AXIS_X ? coord : socket.x;
  const y = axis === PRESS_AXIS_X ? socket.y : coord;
  const e = spawnWall(state, x, y, halfW, halfH);
  e.enemyType = MOVING_WALL_TAG;
  e.aux0 = ref.catalogId;
  e.aux1 = socketIndex;
  e.phase = axis;
  e.pierce = sign >= 0 ? 1 : 0;
  e.targetY = base;
  e.cooldown = spec.pressTravel;
  e.timer = spec.pressPeriodTicks;
  e.iframes = phaseOffset;
  e.damage = spec.pressCrushDamage;
  e.dashCooldown = 0; // 플레이어 미관측
  e.life = -1; // 시간으로 소멸하지 않는다
  return e;
}

// ---------------------------------------------------------------------------
// 스윕 판정
// ---------------------------------------------------------------------------

/** 스윕 결과. `inside` 면 시작 시점에 이미 겹쳐 있었다는 뜻이다(끼임 진입). */
export interface PressSweepHit {
  /** 진입 파라미터(0..1). `inside` 면 0. */
  readonly t: number;
  /** 진입면 법선 x(-1/0/1). */
  readonly nx: number;
  /** 진입면 법선 y(-1/0/1). */
  readonly ny: number;
  /** 시작 시점에 이미 겹쳐 있었는가. */
  readonly inside: boolean;
}

/**
 * 원점 중심 AABB(반폭 hw, 반높이 hh)에 대한 선분 (sx,sy)→(ex,ey) 의 **진입 판정**(슬랩 클립).
 *
 * 이 함수 하나가 터널링 방지의 전부다 — 호출부가 **상대 프레임**(플레이어 좌표에서 벽 좌표를
 * 뺀 값, 시작은 이전 벽 좌표 기준·끝은 현재 벽 좌표 기준)으로 넘기므로 입력 선분이 곧
 * (플레이어 변위 − 벽 변위) 다. 두께가 아무리 얇아도, 상대 속도가 아무리 커도 선분이 상자를
 * 스치면 반드시 걸린다.
 *
 * 겹침이 없으면 null.
 */
export function sweepAabbEntry(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  hw: number,
  hh: number,
): PressSweepHit | null {
  if (!(hw > 0) || !(hh > 0)) return null;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
  if (!Number.isFinite(ex) || !Number.isFinite(ey)) return null;
  if (sx > -hw && sx < hw && sy > -hh && sy < hh) {
    return { t: 0, nx: 0, ny: 0, inside: true };
  }
  const dx = ex - sx;
  const dy = ey - sy;
  let tmin = 0;
  let tmax = 1;
  let nx = 0;
  let ny = 0;
  if (dx === 0) {
    if (sx < -hw || sx > hw) return null;
  } else {
    let t1 = (-hw - sx) / dx;
    let t2 = (hw - sx) / dx;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = s;
      ny = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (dy === 0) {
    if (sy < -hh || sy > hh) return null;
  } else {
    let t1 = (-hh - sy) / dy;
    let t2 = (hh - sy) / dy;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin > 1) return null;
  if (nx === 0 && ny === 0) {
    // tmin === 0 이면서 진입면이 없다 = 시작점이 상자 표면에 정확히 얹혀 있고 안쪽으로
    // 들어간다는 뜻이다(엄격 부등호 내부 판정에 걸리지 않는 경계 케이스). 겹침 자체는
    // 확정이므로 **놓치지 않고** 끼임 경로로 넘긴다 — 여기서 null 을 돌려주면 표면에
    // 붙어 있는 프레임이 통째로 판정에서 빠져 관통이 생긴다.
    return { t: 0, nx: 0, ny: 0, inside: true };
  }
  return { t: tmin, nx, ny, inside: false };
}

// ---------------------------------------------------------------------------
// 스텝
// ---------------------------------------------------------------------------

/** 플레이어 엔티티(index 0 불변식 + 방어적 스캔). */
function findPlayer(state: WorldState): Entity | undefined {
  const first = state.entities[0];
  if (first !== undefined && first.kind === 'player') return first;
  for (const e of state.entities) {
    if (e.kind === 'player') return e;
  }
  return undefined;
}

/**
 * 압축 프레스 전량을 1틱 진행한다. 호출 지점은 `stepFacility` 머리(설비 조준·해저드보다
 * **먼저**) — 이번 틱 조준·LOS 가 이동 후 좌표를 보게 하려면 순서가 이래야 한다.
 *
 * 프레스가 하나라도 움직였으면 broad-phase 격자를 즉시 갱신한다(stale 좌표 금지).
 */
export function stepMovingWalls(state: WorldState, ctx: InvasionStepContext): void {
  const player = findPlayer(state);
  let moved = false;
  for (const e of state.entities) {
    if (e.dead || !isMovingWall(e)) continue;
    const prevCoord = movingWallCoordAt(e, state.tick - 1);
    const nextCoord = movingWallCoordAt(e, state.tick);
    const axisX = e.phase === PRESS_AXIS_X;
    // 이동 전 벽 좌표(스윕 시작 프레임의 원점).
    const prevX = axisX ? prevCoord : e.x;
    const prevY = axisX ? e.y : prevCoord;
    if (axisX) e.x = nextCoord;
    else e.y = nextCoord;
    moved = true;
    if (player !== undefined) resolvePressAgainstPlayer(state, ctx, e, player, prevX, prevY);
  }
  // 프레스가 움직인 뒤에도 world.ts 가 틱 머리에서 만든 격자는 옛 좌표를 들고 있다.
  // 같은 틱 뒷단(stepProjectiles)이 stale 좌표로 탄을 지우지 않도록 여기서 갱신한다.
  if (moved) state.wallIndex?.refresh();
}

/**
 * 프레스 1기 vs 플레이어 해결. 순서가 규칙이다:
 *   ① 상대 프레임 스윕 → 진입면 바깥으로 이동(터널링 0)
 *   ② 스크롤 창 클램프 → ③ 다른 벽 슬라이드 → ④ 창 재클램프
 *   ⑤ 그래도 프레스와 겹치면 **끼임** — 좌표를 확정하고 고정 피해만 준다(되밀기 없음)
 *
 * ②~④ 는 각각 유한 연산 1회뿐이라 반복이 없다. 좌표 폭주·NaN 이 나올 경로가 없고, 마지막에
 * 유한성 가드까지 둔다.
 */
function resolvePressAgainstPlayer(
  state: WorldState,
  ctx: InvasionStepContext,
  press: Entity,
  player: Entity,
  prevPressX: number,
  prevPressY: number,
): void {
  // 최초 1회: 관측이 없으면 스윕 시작점을 현재 위치로 잡는다(정지 상태와 동치).
  if (press.dashCooldown === 0) {
    press.vx = player.x;
    press.vy = player.y;
    press.dashCooldown = 1;
  }
  const hw = press.radius + player.radius;
  const hh = press.targetX + player.radius;
  const sx = press.vx - prevPressX;
  const sy = press.vy - prevPressY;
  const ex = player.x - press.x;
  const ey = player.y - press.y;
  const hit = sweepAabbEntry(sx, sy, ex, ey, hw, hh);
  if (hit === null) {
    press.vx = player.x;
    press.vy = player.y;
    return;
  }
  let rx: number;
  let ry: number;
  if (hit.inside) {
    // 시작부터 겹침(끼임 진입): **마지막으로 확인된 쪽**으로 되민다.
    //
    // 여기서 "벽 진행 방향" 이나 "최소 침투" 로 밀면 안 된다. 판이 물러날 때는 진행 방향
    // 규칙이 플레이어를 판 **반대편으로 끌고 가고**, 최소 침투 규칙은 판이 플레이어를
    // 지나칠 때 먼 쪽 면을 골라 역시 반대편으로 뱉는다. 둘 다 관통과 구분되지 않는다.
    // 판은 밀 뿐 통과시키지 않으므로, 한 번 정해진 쪽을 끝까지 유지하는 것이 유일하게
    // 안전한 규칙이다.
    const axisX = press.phase === PRESS_AXIS_X;
    const sideSign = pressSideSign(press, axisX ? ex : ey);
    if (axisX) {
      rx = sideSign * (hw + PRESS_SURFACE_SKIN);
      ry = ey;
    } else {
      rx = ex;
      ry = sideSign * (hh + PRESS_SURFACE_SKIN);
    }
  } else {
    rx = sx + (ex - sx) * hit.t;
    ry = sy + (ey - sy) * hit.t;
    if (hit.nx !== 0) rx = hit.nx > 0 ? hw + PRESS_SURFACE_SKIN : -(hw + PRESS_SURFACE_SKIN);
    else ry = hit.ny > 0 ? hh + PRESS_SURFACE_SKIN : -(hh + PRESS_SURFACE_SKIN);
  }
  let px = press.x + rx;
  let py = press.y + ry;
  // 창 클램프 → 다른 벽 슬라이드 → 창 재클램프. 각 1회, 되돌이 없음.
  const c1 = clampToWindow(px, py, player.radius, ctx.runtime);
  const others = state.activeWalls.filter((w) => w !== press);
  const slid = others.length > 0 ? slideCircleWalls(c1.x, c1.y, player.radius, others) : c1;
  const c2 = clampToWindow(slid.x, slid.y, player.radius, ctx.runtime);
  px = c2.x;
  py = c2.y;
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    // 도달 불가 경로(입력이 전부 유한). 남더라도 좌표 폭주 대신 벽 중심으로 접는다.
    px = press.x;
    py = press.y;
  }
  player.x = px;
  player.y = py;
  press.vx = px;
  press.vy = py;
  const crushed = circleOverlapsWall(px, py, player.radius, press);
  // 판 밖으로 확실히 나와 있을 때만 "어느 쪽" 기록을 갱신한다. 끼임 중에 갱신하면 판이
  // 플레이어를 지나칠 때 기록이 뒤집혀 다음 틱에 반대편으로 뱉는다.
  const axisX = press.phase === PRESS_AXIS_X;
  const along = axisX ? px - press.x : py - press.y;
  const halfAlong = axisX ? hw : hh;
  if (!crushed && (along > halfAlong || along < -halfAlong)) {
    press.ownerId = along >= 0 ? PRESS_SIDE_POS : PRESS_SIDE_NEG;
  }
  if (crushed) crushPlayer(state, player, press);
}

/**
 * 끼임 상태에서 되밀 방향(+1/-1). 기록이 없으면 현재 상대 좌표 부호로 정한다(정확히 0 이면
 * +방향 — 결정론적 임의 선택).
 */
function pressSideSign(press: Entity, relAlong: number): number {
  if (press.ownerId === PRESS_SIDE_POS) return 1;
  if (press.ownerId === PRESS_SIDE_NEG) return -1;
  return relAlong >= 0 ? 1 : -1;
}

/**
 * 끼임 피해. 무적 프레임을 존중하고(피격과 같은 규율) 피해 후 기존 피격 무적을 부여해
 * 매 틱 갈리는 것을 막는다. 정수 피해 — f64 누적이 없다.
 */
function crushPlayer(state: WorldState, player: Entity, press: Entity): void {
  if (player.iframes > 0) return;
  const dmg = press.damage;
  if (!(dmg > 0)) return;
  player.hp -= dmg;
  if (player.hp < 0) player.hp = 0;
  player.iframes = state.config.hitIframes;
}
