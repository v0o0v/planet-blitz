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
// 컬링 예외 마커 2종. ⚠️ 여기서 생기는 모듈 순환(blockBreak → light → waves → blockBreak,
// blockBreak → midClash → waves → blockBreak)은 waves↔midClash 의 기존 순환과 같은 안전한
// 형태다 — 세 모듈 모두 **최상위 평가 시점에 상대 모듈의 값을 읽지 않고** 호출 시점에만
// 참조한다(midClash.ts 헤더 "순환 의존 주의" 참조). 이 파일의 최상위 `SEGMENTS.length` 는
// 순환 밖의 순수 데이터 모듈이라 무관하다.
import { SEALED_GUARDIAN_MARK } from '../encounters/light.js';
import { MID_CLASH_LEADER_MARK } from './midClash.js';

// --- 플레이스홀더 계수 (TODO(밸런스): 출시 전 일괄 튜닝, 구조만 고정) ---
/**
 * 구간 1개의 −Y 스크롤 거리(월드 유닛).
 *
 * ⚠️ **이 값은 무대 런타임을 직접 정한다**(창 전진 속도 고정 → 보스 도달 시간 ∝ 코스 길이).
 * 2026-08-01 페이싱 목표(보스 도달 90초)에 맞춰 2,000 → 13,500(실측 13.3초 → 목표 90초).
 *
 * 벽 행 수는 `blockBreakCourseLength() / BLOCKBREAK_ROW_SPACING` **파생**이라 길이를 늘리면
 * 행이 비례해 늘어난다 — 레이싱과 달리 밀도 보존이 이미 구조에 들어 있다. TODO(밸런스). */
export const BLOCKBREAK_SECTION_LENGTH = 14650;
/**
 * 보스 전 구간 수 — **일반 세그먼트 수에서 파생한다**(밸런스 상수가 아니라 구조 정합).
 * 근거는 `RACING_SECTION_COUNT` 와 동일: 전진 게이트가 `blockBreakProgress(sw) >=
 * (segmentIndex + 1) × BLOCKBREAK_SECTION_LENGTH` 라 일반 세그먼트가 늘면 코스도 늘어야 한다.
 * 중반 격전 삽입 때 5 고정이 빈 구간을 만든 실증이 있어 파생으로 고정했다.
 */
export const BLOCKBREAK_SECTION_COUNT = SEGMENTS.length - 1;
/** 파괴가능 벽 세그먼트 HP. TODO(밸런스). */
export const BLOCKBREAK_WALL_HP = 60;
/**
 * 압사 틱당 피해(iframes 간격 적용, 즉사 아님).
 *
 * ## 8 → 6 의 근거 (2026-08-02 난이도 복구 2차)
 * **압사가 이 무대의 주 사인이었다.** 피해 귀속 지표로는 안 보인다 — 압사는 엔티티 겹침이
 * 아니라 직접 차감이라 `지형피해분`(0.03)·`접촉피해분`(0.02)에 잡히지 않고 잔차로만 남는다.
 * 그래서 4 로 내려 레버 연결을 먼저 확인했고(49.0% → **90.5%**), 과교정이 확인돼 6 으로 되돌렸다.
 *
 * | 값 | 클리어율 | 보스도달 | 런내 레벨업 |
 * |---|---|---|---|
 * | 8 | 51.4% | 90.4s | 6.4 |
 * | 4 | 90.5% | 88.4s | 7.4 |
 * | **6** | **70.8%** | **89.1s** | 7.0 |
 *
 * 페이싱(90초)을 지키면서 밴드(60~80%) 안에 들어온 **유일한 무대**다 — 압사는 진행 게이트가
 * 아니라 순수 피해원이라 난이도와 페이싱이 분리돼 있기 때문이다. TODO(밸런스).
 */
export const BLOCKBREAK_CRUSH_DAMAGE = 6;
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
 * 이 적은 **컬링 대상이 아닌가**(= 처치로만 사라져야 하는 연출 실체인가).
 *
 * ⚠️ **왜 예외가 필요한가(리뷰 HIGH-1/HIGH-2 — 이 파일이 결함의 발원지였다)**
 * `cullScrollEnemies` 는 창 뒤로 흘러간 적을 **`hp > 0` 인 채로 `dead = true`** 로 만든다.
 * `compact`(world.ts)는 그 사실을 알고 `if (e.kind === 'enemy' && e.hp <= 0)` 게이트로 공짜
 * kills·젬·엘리트 루팅을 배제하지만, **"마커 엔티티가 사라졌다"를 성공으로 읽는 상위 게이트**
 * 들은 그 게이트를 우회한다:
 *  - `SEALED_GUARDIAN_MARK`(조우 봉인 수호자) → 한 발도 안 맞히고 확정 rarity 3 전리품 +
 *    크레딧이 정산 경제로 직행한다.
 *  - `MID_CLASH_LEADER_MARK`(중반 격전 리더, ADR-0032) → 격전 세그먼트가 **공짜 통과**한다.
 *    격전 세그먼트는 `killGoal = 0` 이라 처치 게이트도 없어서, "매 런 확정 par 연장 비트"가
 *    racing/blockBreak 2 모드에서만 조용히 무효화된다.
 *
 * 둘 다 **절차 스폰된 잡몹이 아니라 연출된 실체**다(하나는 플레이어가 명시적으로 개방한 조우,
 * 하나는 세그먼트 전진 게이트 그 자체). "뒤로 밀려난 적 정리"라는 이 함수의 목적에 애초에
 * 해당하지 않으므로 스캔에서 뺀다 — `isGimmick`(world.ts)이 `RACING_WALL_MARK`·
 * `CONTAMINATION_NODE_MARK`·`COUNTER_DEVICE_MARK` 를 청크 컬링에서 빼는 것과 동형의 선례다.
 * 마커 없는 일반 적은 `aux1 === 0` 이라 조건이 그대로 성립 → **거동·해시 완전 불변**이다.
 *
 * 이 예외만으로 끝내지 않는다 — 각 소비자 쪽에도 "처치로 사라진 것만 인정"하는 2차 방어가
 * 있다(`stepGuardian` 의 처치 영수증 지문 · `midClashCleared` 의 세그먼트 처치 진행 요구).
 * 미래에 다른 제거 경로가 추가되면 이 예외 목록은 그 경로에도 적용돼야 한다.
 */
function isCullExemptEnemy(e: Entity): boolean {
  return e.aux1 === SEALED_GUARDIAN_MARK || e.aux1 === MID_CLASH_LEADER_MARK;
}

/**
 * 예외 대상을 창에 묶어 둘 때 창 경계 바깥으로 허용하는 여유(월드 유닛). 창 **가장자리 바로
 * 밖**까지만 벌어지게 두어 화면 안으로 걸어 들어오게 한다 — 창 안으로 끌어당기면 플레이어
 * 코앞에 순간이동해 억울한 접촉 피해가 된다. TODO(밸런스).
 */
const CULL_EXEMPT_WINDOW_MARGIN = 200;

/**
 * 컬링 예외 대상을 **삭제하는 대신 스크롤 창에 묶어 둔다**(창 ± 여유 밖으로 못 벌어진다).
 *
 * ⚠️ **왜 "그냥 안 죽이기"로 끝나면 안 되는가(실측으로 확인한 2차 결함)**
 * 강제 스크롤 모드의 창은 고정 속도로 전진하는데 격전 리더의 이동 속도는 그보다 **느리다**.
 * 실측상 blockBreak 격전 세그먼트 진입 후 **250틱**이면 리더가 컬 반경(3000) 밖으로 영구히
 * 밀린다(봉인 수호자는 230틱). 컬링만 막고 두면 리더는 **살아 있지만 영원히 닿을 수 없는
 * 곳**에 남고, 격전 세그먼트의 전진 조건은 리더 처치뿐이므로 런이 그 자리에서 **데드락**한다
 * (blockBreak·racing 의 "코스 끝 보스" 통합 테스트가 정확히 이 형태로 멈춘다). 공짜 통과를
 * 막으려다 통과 자체를 막으면 더 나쁘다.
 *
 * ⚠️ 그리고 **"컬 반경 밖으로 밀렸을 때만 되돌리기"로도 부족하다.** 컬 반경(3000)은 창
 * (±960/±540)보다 훨씬 크므로, 되돌린 리더는 곧바로 다시 뒤처져 화면 밖 구간을 왕복할 뿐
 * 사거리에 거의 들어오지 않는다 — 실측으로 20,000틱을 돌려도 리더 HP 가 16% 밖에 깎이지
 * 않아 사실상 데드락이 남았다. 그래서 **매 틱 창에 묶는다**(밀렸을 때만이 아니라 상시).
 *
 * 결과적인 규칙은 한 줄이다: **연출 실체는 강제 스크롤 창을 벗어나지 않는다.** 이는 "리더가
 * 정점에 수렴한다"는 격전의 연출 의도(ADR-0032)와 정확히 같은 말이고, 강제 스크롤 모드가
 * 애초에 적을 창 가장자리에 스폰시키는 것과도 같은 성격의 조작이다. 창 안에서는 자유롭게
 * 움직이므로 추적 AI 는 그대로다. 축별 clamp 뿐이라 나눗셈·제곱근·RNG 가 없다(결정론 불변).
 */
function keepExemptEnemyInWindow(e: Entity, cx: number, cy: number): void {
  const limitX = INVASION_WINDOW_HALF_W + CULL_EXEMPT_WINDOW_MARGIN;
  const limitY = INVASION_WINDOW_HALF_H + CULL_EXEMPT_WINDOW_MARGIN;
  const dx = e.x - cx;
  const dy = e.y - cy;
  if (dx > limitX) e.x = cx + limitX;
  else if (dx < -limitX) e.x = cx - limitX;
  if (dy > limitY) e.y = cy + limitY;
  else if (dy < -limitY) e.y = cy - limitY;
}

/**
 * 창 중심에서 컬 반경 밖(뒤로 흘러간) 적을 dead 표시한다(강제 스크롤 모드 전용). 보스는
 * 제외 — 코스 끝 보스는 창을 벗어나도 유지된다. compact 가 dead 를 수거한다. scrollRuntime
 * 미존재면 no-op(뱀서류·침공 무영향). `cullRadius` 는 모드별 컬 반경(Lane5) — 호출부가 각
 * 모드의 상수를 넘긴다. 미지정 시 블록격파 기본값(단위 테스트 호환).
 *
 * 연출 실체(조우 수호자·격전 리더)는 {@link isCullExemptEnemy} 로 제외한다 — 근거는 그쪽
 * doc 이 정본이다.
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
    // 예외 대상은 삭제하지 않고 창에 묶는다(삭제 = 공짜 통과 / 방치 = 데드락, 둘 다 불가).
    if (isCullExemptEnemy(e)) {
      keepExemptEnemyInWindow(e, cx, cy);
      continue;
    }
    const dx = e.x - cx;
    const dy = e.y - cy;
    if (dx * dx + dy * dy > r2) e.dead = true;
  }
}
