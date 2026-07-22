/**
 * 레이싱(racing) 콘텐츠 — Lane5 (ADR-0021 §2.3). 좌→우 강제 횡스크롤(+X) 페이스메이커.
 * Lane3 스크롤 위에 정적 분기 코스(불파괴 채널 벽 + 부스트 패드)를 얹고, 진행 게이트를
 * 스크롤 주파 거리로, 실패를 뒤 경계 압박존 누적 피해로 바꾼다. 서바이벌 코어(웨이브
 * 디렉터·파워업·드랍)는 불변, 승리는 공통 보스 처치(compact 재사용). 전 계수는
 * 플레이스홀더 — TODO(밸런스): 출시 전 일괄 튜닝.
 *
 * ## 결정론(ADR-0005)
 * RNG·Date.now·전역을 쓰지 않는다. 분기 트랙은 정적 코스(엔티티: 채널 벽·부스트 패드)이고,
 * 진행도·구간은 `scrollRuntime.scrollX` 파생이라 **신규 WorldState 필드가 없다**. 분기 선택은
 * 플레이어 좌표(레인 위치)로 이미 봉인되므로 선택 기록 필드도 두지 않는다. 뱀서류
 * (planetMode 0)·침공(invasion3)·블록격파(planetMode 1) 경로는 이 모듈을 한 줄도 실행하지
 * 않는다 — 호출부가 `planetMode === racing` / `scrollRuntime !== undefined` 로 게이트한다.
 *
 * ## 순환 의존 주의
 * world.ts 가 이 모듈을 런타임 import 하므로, 이 모듈은 world 에서 **타입만** 가져온다
 * (`import type`). 런타임 의존은 leaf 모듈(entities·invasion/scroll)로만(blockBreak.ts 선례).
 */
import { INVASION_WINDOW_HALF_W, INVASION_WINDOW_HALF_H } from '../invasion/scroll.js';
import type { ScrollWindow } from '../invasion/scroll.js';
import type { Entity, EntitySink } from '../entities.js';
import { spawnWall, spawnBoostPad } from '../entities.js';
import type { WorldState } from '../world.js';

// --- 플레이스홀더 계수 (TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정) ---
/** 체크포인트(구간) 1개의 +X 스크롤 거리(월드 유닛). TODO(밸런스). */
export const RACING_SECTION_LENGTH = 2000;
/** 보스 전 구간 수(= 일반 세그먼트 5개와 정렬). TODO(밸런스). */
export const RACING_SECTION_COUNT = 5;
/** 적 스폰 기준을 창 중심에서 전방(+X)으로 미는 거리(앞에서 다가오는 정체성). TODO(밸런스). */
export const RACING_SPAWN_AHEAD = 700;
/**
 * 창 중심에서 이 반경 밖으로 흘러간 적을 컬(뒤로 밀려난 적 정리).
 * ⚠️ **구조적 불변식(밸런스 아님)**: 이 값은 반드시 **최대 스폰 거리**보다 커야 한다 — 그렇지
 * 않으면 창 전방(+X, `RACING_SPAWN_AHEAD`)에 뜬 적이 플레이어에 닿기도 전에 즉시 컬링돼
 * 모드가 성립하지 않는다. 최악은 **cluster 포메이션 코너**다(ring 이 아니다): racing 은 cull
 * 중심(scrollX,scrollY) 대비 cluster base=(scrollX+700, scrollY), cluster 오프셋
 * `cx=base+range(-1,1)*1000+520(±180)`·`cy=base+range(-1,1)*800-400(±180)` 라 최악 상대좌표
 * ≈(+2400,−1380) → 유클리드 거리 ≈2768. 그래서 3000(여유 ~230)으로 덮는다. blockBreak 도
 * 동형(최악 ≈2686). 실제 수치 튜닝은 TODO(밸런스)지만 이 부등식은 튜닝과 무관하게 유지돼야
 * 한다(Lane4 MED·Lane5 리뷰 MED 교훈 — ring 만 보고 2600 으로 잡으면 cluster 코너가 샌다).
 */
export const RACING_ENEMY_CULL_RADIUS = 3000;
/** 창 뒤(−X) 경계에서 이 거리 안쪽에 몰리면 압박 피해. TODO(밸런스). */
export const RACING_REAR_PRESSURE_MARGIN = 120;
/** 뒤 경계 압박 틱당 피해(iframes 간격 적용, 즉사 아님). TODO(밸런스). */
export const RACING_PRESSURE_DAMAGE = 8;
/** 분기 중앙 분리 벽(불파괴)의 반폭(구간의 일부만 덮어 앞뒤로 레인 전환 여유를 남긴다). TODO(밸런스). */
export const RACING_DIVIDER_HALF_W = 500;
/** 분기 분리 벽의 반높이(얇은 가로벽 — 상·하 채널을 가른다). TODO(밸런스). */
export const RACING_DIVIDER_HALF_H = 90;
/** 채널 중심의 세로 오프셋(상단 지름길 = −offset, 하단 우회 = +offset). TODO(밸런스). */
export const RACING_CHANNEL_OFFSET_Y = 300;
/** 부스트 패드 반경(밟으면 가속). TODO(밸런스). */
export const RACING_BOOST_RADIUS = 90;
/** 지름길(상단) 채널의 구간당 부스트 패드 수. TODO(밸런스). */
export const RACING_BOOST_PER_SECTION = 2;

/**
 * 레이싱 코스 벽 마커(ownerId 센티넬, DRONE_MARK/BROOD_MARK 선례). 채널 벽은 hp=0
 * 불파괴라 `isGimmick(wall && hp<=0)` 이 청크 컬링 대상으로 오인해 창이 지나가기 전에
 * 코스를 지워버린다. 이 마커로 코스 벽을 청크 기믹 분류에서 제외해 코스를 보존한다
 * (world.ts isGimmick). 뱀서류·침공·블록격파 벽은 ownerId=0 이라 조건이 그대로라
 * 거동·해시 불변이고, 이 값은 레이싱 런에만 등장한다.
 */
export const RACING_WALL_MARK = 0x4ac1a6;

/** 레이싱 진행도(월드 유닛, 0 이상) = 창이 +X 로 나아간 거리. */
export function racingProgress(rt: ScrollWindow): number {
  return rt.scrollX;
}

/** 진행도 → 구간 인덱스(0..). */
export function racingSection(progress: number): number {
  return Math.floor(progress / RACING_SECTION_LENGTH);
}

/** 코스 총 길이(마지막 구간 끝 = 보스 트리거 거리). */
export function racingCourseLength(): number {
  return RACING_SECTION_LENGTH * RACING_SECTION_COUNT;
}

/** 부스트 패드인가. */
export function isBoostPad(e: Entity): boolean {
  return e.kind === 'boostPad';
}

/**
 * 코스 전체 분기 트랙(불파괴 채널 벽 + 부스트 패드)을 월드 절대 좌표에 +X 방향으로 미리
 * 배치한다(창이 지나가며 흘려보냄 → 별도 스폰 상태 불필요, 결정론 단순). 각 구간마다 갈림길
 * 하나를 둔다 — 창 중심(y=0)에 가로 분리 벽을 놓아 상단(지름길)·하단(우회) 두 채널을 **둘 다
 * 물리적으로** 깐다. 플레이어는 레인 위치(y<0/y>0)로 채널을 선택하고, 지름길에는 부스트 패드를
 * 밀집시킨다. 배치는 구간 인덱스만의 함수(RNG 미사용)라 같은 코스가 항상 동일 배치다 —
 * 시드·해시 스트림에 영향이 없다. 채널 벽은 hp=0 이라 `isBreakableWall`=false → 파괴되지
 * 않는다(레이싱 벽은 가이드지 격파 대상이 아니다).
 */
export function placeRacingCourse(sink: EntitySink): void {
  for (let i = 0; i < RACING_SECTION_COUNT; i++) {
    const sectionStart = i * RACING_SECTION_LENGTH;
    // 구간 중앙에 상·하 채널을 가르는 분리 벽(불파괴, hp=0). 청크 컬링에서 살아남게 마커를 단다.
    const branchX = sectionStart + RACING_SECTION_LENGTH / 2;
    const divider = spawnWall(sink, branchX, 0, RACING_DIVIDER_HALF_W, RACING_DIVIDER_HALF_H);
    divider.ownerId = RACING_WALL_MARK;
    // 지름길(상단, −Y) 채널에 부스트 패드를 구간 폭에 걸쳐 고정 배치(RNG 미사용).
    for (let k = 0; k < RACING_BOOST_PER_SECTION; k++) {
      const bx = sectionStart + ((k + 1) / (RACING_BOOST_PER_SECTION + 1)) * RACING_SECTION_LENGTH;
      spawnBoostPad(sink, bx, -RACING_CHANNEL_OFFSET_Y, RACING_BOOST_RADIUS);
    }
  }
}

/**
 * 창 뒤(−X) 경계에 몰린 플레이어에게 누적 피해(crushBlockBreak 이식). +X 스크롤이라 뒤는 −X
 * 방향이고, 뒤 경계(`scrollX - INVASION_WINDOW_HALF_W`)에서 `RACING_REAR_PRESSURE_MARGIN`
 * 이내면 압박한다. 무적 프레임을 존중하고(피격과 같은 규율) 피해 후 피격 무적을 부여해 매 틱
 * 갈리는 것을 막는다. 즉사 아님(누적) — 정수 산술로 f64 누적이 없다. 벽 불필요(위치만).
 */
export function racingRearPressure(state: WorldState, player: Entity): void {
  const rt = state.scrollRuntime;
  if (rt === undefined) return;
  // windowCenterX(rt) === rt.scrollX. 뒤 경계에서 이 거리 안쪽이면 압박.
  const rearX = rt.scrollX - INVASION_WINDOW_HALF_W;
  if (player.x - rearX > RACING_REAR_PRESSURE_MARGIN) return;
  if (player.iframes > 0) return;
  player.hp -= RACING_PRESSURE_DAMAGE;
  if (player.hp < 0) player.hp = 0;
  player.iframes = state.config.hitIframes;
}

/**
 * 가속(전진 보너스) 신호. **플레이어가 부스트 패드 위**(순간가속)이거나 **창 안 살아있는 적·
 * 보스가 전멸**(앞서 나가면 보너스)이면 true. 두 신호를 통합한다. 순수 판정 — 상태를 바꾸지
 * 않는다. scrollRuntime 미존재면 항상 false.
 */
export function racingCleared(state: WorldState): boolean {
  const rt = state.scrollRuntime;
  if (rt === undefined) return false;
  // 부스트 패드 위면 즉시 가속. 플레이어(index 0)와 원-원 겹침을 본다.
  const player = state.entities[0];
  if (player !== undefined) {
    for (const e of state.entities) {
      if (e.dead || !isBoostPad(e)) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const rr = e.radius + player.radius;
      if (dx * dx + dy * dy <= rr * rr) return true;
    }
  }
  // 창 안 살아있는 적·보스가 하나라도 있으면 아직 미전멸(기준 속도).
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
