/**
 * 블록격파 모드(ADR-0021 §2.2, Lane4). 하→상 강제 종스크롤(−Y) 위에 파괴가능 벽 코스를
 * 얹는다. 서바이벌 코어(웨이브 디렉터·파워업·드랍)는 불변, 진행 게이트만 스크롤 거리로.
 * 승리는 공통 보스 처치(compact 재사용). 전 계수는 플레이스홀더 — TODO(밸런스): 출시 전 일괄 튜닝.
 *
 * ## 결정론(ADR-0005)
 * RNG·Date.now·전역을 쓰지 않는다. 벽은 엔티티(hashEntity 가 hp·좌표를 접는다)이고,
 * 진행도·구간은 `scrollRuntime.scrollY` 파생이라 **신규 WorldState 필드가 없다**. 뱀서류
 * (planetMode 0)·침공(invasion3) 경로는 이 모듈을 한 줄도 실행하지 않는다 — 호출부가
 * `planetMode === blockBreak` / `scrollRuntime !== undefined` 로 게이트한다.
 *
 * ## 순환 의존 주의
 * world.ts 가 이 모듈을 런타임 import 하므로, 이 모듈은 world 에서 **타입만** 가져온다
 * (`import type`). 런타임 의존은 leaf 모듈(entities·los·invasion/scroll)로만.
 */
import type { Entity, EntitySink } from '../entities.js';
import { spawnBreakableWall } from '../entities.js';
import { circleOverlapsWall } from '../los.js';
import { SEGMENTS } from '../../../data/waves.js';
import { INVASION_WINDOW_HALF_W, INVASION_WINDOW_HALF_H } from '../invasion/scroll.js';
import type { ScrollWindow } from '../invasion/scroll.js';
import type { WorldState } from '../world.js';

// --- 플레이스홀더 계수 (TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정) ---
/** 구간 1개의 −Y 스크롤 거리(월드 유닛). TODO(밸런스). */
export const BLOCKBREAK_SECTION_LENGTH = 2000;
/**
 * 보스 전 구간 수 — **일반 세그먼트 수에서 파생한다**(밸런스 상수가 아니라 구조 정합).
 * 근거는 `RACING_SECTION_COUNT` 와 동일: 전진 게이트가 `blockBreakProgress(sw) >=
 * (segmentIndex + 1) × BLOCKBREAK_SECTION_LENGTH` 라 일반 세그먼트가 늘면 코스도 늘어야 한다.
 * 중반 격전 삽입 때 5 고정이 빈 구간을 만든 실증이 있어 파생으로 고정했다.
 */
export const BLOCKBREAK_SECTION_COUNT = SEGMENTS.length - 1;
/** 파괴가능 벽 세그먼트 HP. TODO(밸런스). */
export const BLOCKBREAK_WALL_HP = 60;
/** 압사 틱당 피해(iframes 간격 적용, 즉사 아님). TODO(밸런스). */
export const BLOCKBREAK_CRUSH_DAMAGE = 8;
/** 벽 행 반높이. TODO(밸런스). */
export const BLOCKBREAK_WALL_HALF_H = 60;
/** 플레이어 통과 틈새 반폭. TODO(밸런스). */
export const BLOCKBREAK_GAP_HALF_W = 220;
/** 벽 행 사이 −Y 간격. TODO(밸런스). */
export const BLOCKBREAK_ROW_SPACING = 800;
/** 적 스폰 기준을 창 중심에서 전방(−Y)으로 당기는 거리(위에서 내려오는 정체성). TODO(밸런스). */
export const BLOCKBREAK_SPAWN_AHEAD = 700;
/**
 * 창 중심에서 이 반경 밖으로 흘러간 적을 컬(뒤로 밀려난 적 정리).
 * ⚠️ **구조적 불변식(밸런스 아님)**: 이 값은 반드시 **최대 스폰 거리**보다 커야 한다 — 그렇지
 * 않으면 창 전방(−Y, `BLOCKBREAK_SPAWN_AHEAD`)에 뜬 적이 플레이어에 닿기도 전에 즉시 컬링돼
 * 모드가 성립하지 않는다. 최악은 **cluster 포메이션 코너**다(ring 이 아니다): cull 중심
 * (scrollX,scrollY) 대비 cluster base=(scrollX, scrollY−700), 오프셋
 * `cx=base+range(-1,1)*1000+520(±180)`·`cy=base+range(-1,1)*800-400(±180)` 라 최악 상대좌표
 * ≈(+1700,−2080) → 유클리드 거리 ≈2686. 그래서 3000(여유 ~314)으로 덮는다. 실제 수치 튜닝은
 * TODO(밸런스)지만 이 부등식은 튜닝과 무관하게 유지돼야 한다(Lane5 리뷰 MED — ring 만 보고
 * 2600 으로 잡으면 cluster 코너가 샜다).
 */
export const BLOCKBREAK_ENEMY_CULL_RADIUS = 3000;

/** 벽 행이 덮는 절반 폭 = 창 반폭(±창). 코스 x 는 창(scrollX=0)과 항상 정렬된다. */
const COURSE_HALF_W = INVASION_WINDOW_HALF_W;

/** 블록격파 진행도(월드 유닛, 0 이상) = 창이 −Y 로 올라간 거리. */
export function blockBreakProgress(rt: ScrollWindow): number {
  return -rt.scrollY;
}

/** 진행도 → 구간 인덱스(0..). */
export function blockBreakSection(progress: number): number {
  return Math.floor(progress / BLOCKBREAK_SECTION_LENGTH);
}

/** 코스 총 길이(마지막 구간 끝 = 보스 트리거 거리). */
export function blockBreakCourseLength(): number {
  return BLOCKBREAK_SECTION_LENGTH * BLOCKBREAK_SECTION_COUNT;
}

/** 파괴가능 벽인가(wall kind + hp>0). 침공/뱀서류 벽(hp=0)은 항상 false. */
export function isBreakableWall(e: Entity): boolean {
  return e.kind === 'wall' && e.hp > 0;
}

/**
 * 코스 전체 파괴가능 벽 행을 월드 절대 좌표에 −Y 방향으로 미리 배치한다(창이 지나가며
 * 흘려보냄 → 별도 스폰 상태 불필요, 결정론 단순). 각 행은 창 폭(±창) 안에 통과 틈새
 * (±GAP_HALF_W)를 남긴 좌·우 AABB 벽 세그먼트로 이뤄진다. 틈새 중심은 고정 지그재그
 * (RNG 미사용)라 같은 코스가 항상 동일 배치다 — 시드·해시 스트림에 영향이 없다.
 */
export function placeBlockBreakWalls(sink: EntitySink): void {
  const rows = Math.floor(blockBreakCourseLength() / BLOCKBREAK_ROW_SPACING);
  for (let i = 0; i < rows; i++) {
    const y = -(i + 1) * BLOCKBREAK_ROW_SPACING;
    // 지그재그 틈새 중심(고정 패턴): 행마다 좌·우로 번갈아 벌린다. TODO(밸런스).
    const gapCenterX = (i % 2 === 0 ? 1 : -1) * (COURSE_HALF_W * 0.35);
    placeWallRow(sink, y, gapCenterX);
  }
}

/** 한 행에 틈새(gapCenterX ± GAP_HALF_W)를 남긴 좌·우 벽 세그먼트를 배치한다. */
function placeWallRow(sink: EntitySink, y: number, gapCenterX: number): void {
  const gapLeft = gapCenterX - BLOCKBREAK_GAP_HALF_W;
  const gapRight = gapCenterX + BLOCKBREAK_GAP_HALF_W;
  // 좌측 세그먼트: [-COURSE_HALF_W, gapLeft] (틈새가 좌벽에 닿으면 생략).
  if (gapLeft > -COURSE_HALF_W) {
    const halfW = (gapLeft + COURSE_HALF_W) / 2;
    spawnBreakableWall(sink, -COURSE_HALF_W + halfW, y, halfW, BLOCKBREAK_WALL_HALF_H, BLOCKBREAK_WALL_HP);
  }
  // 우측 세그먼트: [gapRight, COURSE_HALF_W] (틈새가 우벽에 닿으면 생략).
  if (gapRight < COURSE_HALF_W) {
    const halfW = (COURSE_HALF_W - gapRight) / 2;
    spawnBreakableWall(sink, gapRight + halfW, y, halfW, BLOCKBREAK_WALL_HALF_H, BLOCKBREAK_WALL_HP);
  }
}

/**
 * 창 안(창 중심 ±반폭/반높이)에 살아있는 적·보스가 하나도 없으면 true(전멸 가속 신호).
 * 순수 판정 — 상태를 바꾸지 않는다. scrollRuntime 미존재면 항상 false.
 */
export function blockBreakCleared(state: WorldState): boolean {
  const rt = state.scrollRuntime;
  if (rt === undefined) return false;
  const cx = rt.scrollX;
  const cy = rt.scrollY;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
    if (Math.abs(e.x - cx) <= INVASION_WINDOW_HALF_W && Math.abs(e.y - cy) <= INVASION_WINDOW_HALF_H) {
      return false;
    }
  }
  return true;
}

/**
 * 경계·벽 사이 끼임 시 누적 피해(invasion/movingWall.crushPlayer 이식). 무적 프레임을
 * 존중하고(피격과 같은 규율) 피해 후 피격 무적을 부여해 매 틱 갈리는 것을 막는다. 즉사
 * 아님(누적) — 정수 산술로 f64 누적이 없다.
 */
export function crushBlockBreak(state: WorldState, player: Entity): void {
  if (player.iframes > 0) return;
  player.hp -= BLOCKBREAK_CRUSH_DAMAGE;
  if (player.hp < 0) player.hp = 0;
  player.iframes = state.config.hitIframes;
}

/**
 * 벽 슬라이드·창 클램프 이후에도 활성 파괴가능 벽과 겹쳐 있으면 끼임(압사 대상). 불파괴
 * 벽(hp=0)은 대상이 아니다 — 압사는 부술 수 있는 벽에 몰렸을 때만 성립한다.
 */
export function isPinnedByWall(player: Entity, walls: readonly Entity[]): boolean {
  for (const w of walls) {
    if (!isBreakableWall(w)) continue;
    if (circleOverlapsWall(player.x, player.y, player.radius, w)) return true;
  }
  return false;
}

/**
 * 창 중심에서 컬 반경 밖(뒤로 흘러간) 적을 dead 표시한다(강제 스크롤 모드 전용). 보스는
 * 제외 — 코스 끝 보스는 창을 벗어나도 유지된다. compact 가 dead 를 수거한다. scrollRuntime
 * 미존재면 no-op(뱀서류·침공 무영향). `cullRadius` 는 모드별 컬 반경(Lane5) — 호출부가 각
 * 모드의 상수를 넘긴다. 미지정 시 블록격파 기본값(단위 테스트 호환).
 */
export function cullScrollEnemies(
  state: WorldState,
  cullRadius: number = BLOCKBREAK_ENEMY_CULL_RADIUS,
): void {
  const rt = state.scrollRuntime;
  if (rt === undefined) return;
  const cx = rt.scrollX;
  const cy = rt.scrollY;
  const r2 = cullRadius * cullRadius;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy') continue;
    const dx = e.x - cx;
    const dy = e.y - cy;
    if (dx * dx + dy * dy > r2) e.dead = true;
  }
}
