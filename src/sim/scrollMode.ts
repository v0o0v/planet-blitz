/**
 * PvE 행성 모드 강제 스크롤 런타임(ADR-0021, Lane3). 침공 3레이어(InvasionRuntime)와
 * **분리된** 경량 런타임 — phase(L1/L2/L3) 의미를 빌리지 않는다. scroll.ts 순수 코어
 * (scrollStep·nextAccelCp·windowCenterX/Y·clampToWindow)는 공유한다.
 * 블록격파=−Y 종스크롤, 레이싱=+X 횡스크롤. 콘텐츠·전멸가속 신호는 Lane4/5.
 */
import type { Entity } from './entities.js';
import { INVASION_ACCEL_BASE_CP, SCROLL_AXIS_VERTICAL, SCROLL_AXIS_HORIZONTAL } from './invasion/constants.js';
import {
  scrollStep,
  nextAccelCp,
  INVASION_WINDOW_HALF_W,
  INVASION_WINDOW_HALF_H,
  type ScrollWindow,
} from './invasion/scroll.js';
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

// ---------------------------------------------------------------------------
// 강제 스크롤 정책 축: ANCHOR / WORLD (ADR-0034)
// ---------------------------------------------------------------------------
//
// ## 고치는 결함
// 플레이어 기본 속도 720 u/s = 12 u/tick 이 INVASION_SCROLL_SPEED(12)와 **정확히 같아서**
// 강제 스크롤 모드에서 전방 상대속도 최댓값이 0 이다. clampToWindow 가 창 뒤 경계에 한 번
// 붙이면 전력 전진해도 영원히 뒤 경계에 붙어 있고, 회피로 잃은 전방 거리를 되돌릴 방법이
// 없다. 가속(accelCp 100→200)이면 창이 24 u/tick 으로 아예 2배 빠르다.
//
// ## 해법
// 창 이동량을 **일부 엔티티 좌표에 가산(ANCHOR)** 해 그 엔티티가 창과 함께 흘러가게 만든다.
// 플레이어는 70%만 가산해 "정지하면 조금씩 밀리고 전진하면 확실히 만회"가 성립한다.
// 나머지(WORLD)는 월드 고정이라 창이 지나가면 뒤로 흘러간다 — 압박이 "속도 열세"에서
// "장애물·시간"으로 이동하는 것이 이 설계의 의도다.

/** 플레이어 앵커 비율(%). 100 이면 절대 밀리지 않고, 낮추면 정지 시 뒤로 밀린다. TODO(밸런스). */
export const PLAYER_ANCHOR_PERCENT = 70;
/** 플레이어 외 앵커 대상의 비율(%) — 완전 고정. */
export const FULL_ANCHOR_PERCENT = 100;

/**
 * 이 엔티티가 ANCHOR 축인가(창과 함께 흘러간다). false 면 WORLD 축(월드 고정).
 *
 * ## 정책(2026-07-27 개정): **월드에 깔린 지형·구조물만 WORLD, 살아 움직이는 것은 전부 ANCHOR**
 * 사용자 지시는 "강제 스크롤 되는 곳에서는 **벽 빼고는 다** 강제 스크롤 안되게" 였다. 취지는
 * 적·탄처럼 **교전 상대가 플레이어 의지와 무관하게 창 뒤로 쓸려 사라지는 것**을 없애는 것이고,
 * 그 취지대로 적·보스·탄 2종·적 공격 해저드·편대·드론이 이제 창과 함께 간다.
 *
 * 다만 "벽만" 을 **문자 그대로** 적용하면 월드가 고장난다(실측):
 *  - 청크 기믹(파괴체·영구 지형 해저드·자석·폭탄·미활성 포탑 픽업)의 **컬링은 엔티티 위치에서
 *    청크를 역산**한다(`world.ts` activateChunks). 이것들이 창을 따라오면 영영 컬 반경 밖으로
 *    나가지 않아 `MAX_ACTIVE_GIMMICKS`(48) 가 포화되고, 그러면 **새 청크 생성이 지연돼 지형이
 *    더 이상 나오지 않는다**. 블록격파 실측에서 벽 도착이 120틱 → 175틱 이후로 밀렸다.
 *  - 침공 설비·코어(기지 구조물)와 레이싱 부스트 패드·추격 대피소는 **통과해야 하는 코스**다.
 *    창을 따라오면 기지가 플레이어를 쫓아다니고 부스트 패드가 영구 가속이 된다.
 * 그래서 WORLD 는 "벽" 이 아니라 **"월드에 깔린 지형·구조물"** 로 읽는다 — 화면에서 벽과 똑같이
 * 지나가는 것들이고, 사용자가 겪던 증상(교전 상대가 쓸려 나감)은 그대로 해소된다.
 *
 * 예전 정책은 그 반대에 가까웠다 — 플레이어·회수물·활성 포탑만 ANCHOR 였고 **적·보스·탄이
 * 전부 WORLD** 라 교전 중이던 무리가 창 뒤로 흘러가 `cullScrollEnemies` 에 정리됐다.
 *
 * 적용 범위는 PvE 강제 스크롤(블록격파·레이싱)과 **침공 3레이어 모두**다(사용자 확인). 침공
 * 해시가 바뀌므로 골든 재녹화 + `verify-invasion` EF 재배포를 동반해야 한다.
 */
export function scrollAnchored(e: Entity): boolean {
  switch (e.kind) {
    // ── WORLD: 월드에 깔린 지형·구조물(창이 지나가며 흘려보낸다) ──────────────
    case 'wall':
    case 'destructible':
    case 'magnetEmitter':
    case 'bombDevice':
    case 'boostPad':
    case 'shelter':
    case 'core':
    case 'decoyCore':
    case 'facilityGun':
    case 'facilityHazard':
    case 'facilitySpawner':
    case 'prop':
      return false;
    // 해저드는 **월드 좌표에 깔리는 장판**이다(지형 해저드든 적이 깐 박격포 자국이든). 앵커하면
    // 장판이 플레이어를 따라다녀 회피가 성립하지 않는다 — 탄처럼 스스로 움직이는 실체가 아니다.
    case 'hazard':
      return false;
    case 'turretPickup':
      // 활성 포탑은 플레이어가 세운 아군 실체라 함께 간다. 미활성 픽업은 맵에 깔린 지형이다.
      return e.phase === 1;
    // ── ANCHOR: 그 외 전부(플레이어·회수물·적·보스·탄·편대·드론·수호기 등) ────
    default:
      return true;
  }
}

/** 이 엔티티에 적용할 앵커 비율(%). 플레이어만 부분 앵커, 나머지는 완전 고정. */
export function anchorPercentFor(e: Entity): number {
  return e.kind === 'player' ? PLAYER_ANCHOR_PERCENT : FULL_ANCHOR_PERCENT;
}

/**
 * 좌표가 스크롤 창(=화면) 안인가. 경계 포함.
 *
 * ## 왜 창 안 판정이 필요한가
 * 적은 전방 700u(SPAWN_AHEAD)에 스폰되고 cluster 포메이션은 최대 ~2400u 밖까지 나간다.
 * 창 **밖**에서 떨어진 젬을 무조건 앵커하면 창과의 상대 위치가 얼어붙어 **영영 도달 불가**가
 * 된다(플레이어와 젬이 같은 속도로 함께 도망친다). 창 안일 때만 앵커해야, 창 밖 드랍은
 * 월드 고정으로 남아 창이 따라잡고 플레이어가 회수할 수 있다.
 */
export function insideScrollWindow(x: number, y: number, win: ScrollWindow): boolean {
  return (
    Math.abs(x - win.scrollX) <= INVASION_WINDOW_HALF_W &&
    Math.abs(y - win.scrollY) <= INVASION_WINDOW_HALF_H
  );
}

/**
 * 이번 틱 창 이동량(deltaX, deltaY)을 ANCHOR 엔티티 좌표에 가산한다.
 *
 * ## 정수 규율
 * deltaX/deltaY 는 호출부가 창 오프셋 전/후 차이(둘 다 정수 누적)로 넘기므로 정수다.
 * `Math.trunc(정수 × 정수 / 100)` 은 IEEE-754 **단일 나눗셈 + trunc** 뿐이라 Node(클라)·
 * Deno(서버)에서 비트 동일하다(이 파일 헤더·invasion/scroll.ts 헤더의 기존 규율과 동형).
 * 대가는 해상도다 — 70% 에서 12→8, 24→16 으로 잘린다. 즉 실제 밀림은 틱당 4(가속 시 8)유닛.
 *
 * 델타가 0 이면 즉시 return 이라, 침공 L3(축 NONE → 오프셋 불변)은 자연 no-op 이다.
 */
export function applyScrollAnchor(
  entities: readonly Entity[],
  win: ScrollWindow,
  deltaX: number,
  deltaY: number,
): void {
  if (deltaX === 0 && deltaY === 0) return;
  for (const e of entities) {
    if (e.dead) continue;
    if (!scrollAnchored(e)) continue;
    if (!insideScrollWindow(e.x, e.y, win)) continue;
    const pct = anchorPercentFor(e);
    e.x += Math.trunc((deltaX * pct) / 100);
    e.y += Math.trunc((deltaY * pct) / 100);
  }
}
