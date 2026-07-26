/**
 * Wall geometry primitives — line-of-sight and circle-vs-AABB collision (plan
 * Phase F1). Leaf module: pure functions over the wall entity's half-extent
 * fields, no world state. Deterministic by construction — only basic IEEE-754
 * arithmetic and comparisons (no platform trig), so results are bit-identical
 * across engines (ADR-0005).
 *
 * WALL FIELD MAPPING (single source — plan E1, see entities.spawnWall):
 *   half-width  = wall.radius
 *   half-height = wall.targetX
 * Every function here reads exactly those two fields; nothing redefines them.
 */

import type { Entity } from './entities.js';

/** Wall half-width (single source). */
export function wallHalfW(w: Entity): number {
  return w.radius;
}

/** Wall half-height (single source). */
export function wallHalfH(w: Entity): number {
  return w.targetX;
}

/** True when circle (cx, cy, cr) overlaps the wall's AABB (exact nearest-point test). */
export function circleOverlapsWall(cx: number, cy: number, cr: number, w: Entity): boolean {
  const hw = w.radius;
  const hh = w.targetX;
  // Nearest point on the AABB to the circle centre (clamp).
  let nx = cx;
  if (nx < w.x - hw) nx = w.x - hw;
  else if (nx > w.x + hw) nx = w.x + hw;
  let ny = cy;
  if (ny < w.y - hh) ny = w.y - hh;
  else if (ny > w.y + hh) ny = w.y + hh;
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= cr * cr;
}

/** Result of sliding a circle out of overlapping walls. */
export interface SlideResult {
  x: number;
  y: number;
  /** True if the circle overlapped (and was pushed out of) at least one wall. */
  hit: boolean;
}

/**
 * Resolve a moving circle (radius `r`) against a set of walls by axis-separated
 * minimum-penetration push (the circle is approximated by its bounding box for
 * the push, which is exact on faces and conservative at corners — adequate for
 * M1 cover). Walls are visited in array order (deterministic); overlapping walls
 * resolve sequentially. Returns the corrected position and whether anything was
 * hit (used to trigger the charger's wall-impact fragments burst).
 *
 * 다중 벽 코너 보강: 한 벽 밖으로 밀면 인접 벽 안으로 들어갈 수 있어 단일 패스로는
 * 1틱 잔여 겹침이 남을 수 있다. 고정 순회 순서(배열 순서 × 고정 패스 수)로
 * SLIDE_PASSES회 반복해 대부분의 코너를 즉시 해소한다. 반복은 결정론을 유지하며,
 * SLIDE_PASSES 패스 후에도 남는 극단적 잔여 겹침은 다음 틱에 해소된다.
 */
const SLIDE_PASSES = 2;

/**
 * 강제 스크롤 창에 **끌려 들어간** 원을 되밀 때 쓰는 축·방향(창이 전진하는 쪽).
 * `axis` 는 {@link SCROLL_AXIS_VERTICAL}(0) / {@link SCROLL_AXIS_HORIZONTAL}(1),
 * `dir` 는 창 전진 부호(+1/−1). 자세한 용도는 {@link slideCircleWalls} 의 "끼임" 절.
 */
export interface SlidePin {
  readonly axis: number;
  readonly dir: number;
}

/** {@link SlidePin.axis} 값 — `invasion/constants.ts` 의 동명 상수와 같은 도메인이다. */
const PIN_AXIS_VERTICAL = 0;

/**
 * 벽 슬라이드 (선택적 **끼임 규칙** 포함).
 *
 * `prevX`/`prevY`·`pin` 을 주지 않으면 위 최소 침투 규칙 그대로다 — 기존 호출자(적 패턴·침공
 * 이동벽 보조 슬라이드)는 **바이트 단위로 거동이 같다**.
 *
 * ## 왜 최소 침투만으로는 안 되는가 — 관통 (실측 결함)
 * 최소 침투는 "원이 스스로 움직여 얕게 파고든 상태" 를 전제한다. 강제 스크롤 모드에서는 그
 * 전제가 깨진다: 창이 플레이어를 벽 안으로 **계속 밀어 넣고**(앵커) 창 클램프가 슬라이드
 * 결과를 매 틱 되돌리므로, 침투가 두께의 절반을 넘는 순간 최소 침투가 **먼 쪽 면**을 골라
 * 플레이어를 벽 반대편으로 뱉는다.
 *
 * 실측(seed 1234 · blockBreak · 무입력): 창 뒤 경계(rel 508)에 몰린 플레이어가 t=102 에
 * **한 틱에 79유닛** 전방으로 순간이동했다. 직접 호출로 귀속하면 `slideCircleWalls(0, −797)`
 * → −708(+89, 트레일링 면), 다음 틱 `(0, −809)` → **−892**(−83, 리딩 면) — 중심선을 넘자
 * 부호가 뒤집혔다.
 *
 * 이건 설계 위반이다. 블록격파의 압사(`crushBlockBreak`)는 "창 경계와 **부술 수 있는 벽** 사이에
 * 몰렸다" 는 뜻이고, 탈출 수단은 벽을 부수는 것이다(`world.ts` 압사 블록 주석). 관통은 그
 * 압박을 **공짜로 무효화**한다.
 *
 * 대시 터널링은 `chunks.ts` 의 `WALL_HALF_MIN`(전폭 120 > 최대 대시 스텝 59)으로 막혀 있지만,
 * 이 경로는 원인이 "한 틱 이동량" 이 아니라 **면 선택**이라 그 방어가 닿지 않는다.
 *
 * ## 규칙 — 진입면, 그리고 끼임이면 트레일링 면
 * 1. **직전 위치가 벽 밖**이면 그 위치에서 가장 가까운 면(= 실제로 통과한 진입면)으로 되민다.
 *    스스로 움직여 파고든 정상적인 경우이고, 얕으면 최소 침투와 같은 답이다.
 * 2. **직전 위치도 벽 안**이면(= 끼임) 진입면을 기하로 알 수 없다. 이때는 `pin` 이 주어졌을 때
 *    **창 전진 방향의 반대쪽 면**(트레일링 면)으로 되민다 — 끼임을 유지하는 유일한 선택이고,
 *    그것이 압사 설계 그대로다. 여기서 최소 침투를 쓰면 위 실측처럼 관통이 되고, "창 진행
 *    방향" 으로 밀면 플레이어를 벽 반대편으로 끌고 간다.
 *
 * 2번은 **이 리포가 이미 같은 결론에 도달한 규칙**이다 — 침공 이동벽(`invasion/movingWall.ts`
 * 의 `pressSideSign`)이 "판이 플레이어를 지나칠 때 최소 침투는 먼 쪽 면을 골라 반대편으로
 * 뱉는다 … 한 번 정해진 쪽을 끝까지 유지하는 것이 유일하게 안전한 규칙" 이라고 적어 두고
 * 되밀 쪽을 벽 엔티티에 기록한다. 여기서 기록 대신 창 방향을 쓰는 이유는 일반 벽 하나를
 * **여러 원**(플레이어 + 적 다수)이 공유하므로 벽에 슬롯 하나를 둘 수 없고, 플레이어의
 * `aux0`/`aux1` 은 기체 시그니처가 이미 점유했기 때문이다. 창 방향은 상태가 아니라 모드에서
 * 파생되는 값이라 신규 해시 필드가 **0** 이다.
 *
 * 교차 축 해소는 손대지 않는다 — 벽 옆을 스쳐 지나갈 때 옆으로 밀려나는 정상 슬라이드가
 * 살아 있어야 한다. 축 조건까지 붙은 이유는 위 `pinAxisIsLeast` 주석 참조.
 *
 * ## ⚠️ 침공 해시 — 골든이 불변인데도 EF 재배포가 필요하다
 * 이 변경 후에도 `tests/encounterHashInvariance.test.ts` 의 invasion 골든 3시드가 **바이트
 * 동일**하다. 그러나 그건 "침공 sim 이 안 바뀌었다" 는 증명이 **아니다** — 그 골든은 무입력
 * 런이고 실측하면 그 900틱 동안 **활성 벽이 0개**다(`INVPROBE maxActiveWalls=0`,
 * `playerWallOverlapTicks=0`). 벽이 없으니 이 규칙에 닿을 일이 없었을 뿐이다.
 *
 * 실제 침공은 L2 회랑에서 `invasion/facility.ts` 가 맵 템플릿 벽을 스폰하고, 스크롤 페이즈는
 * 항상 축·방향을 갖는다(실측 `pinCapableTicks=900`). 즉 **실제 플레이에서는 이 규칙에 닿고**,
 * 서버(`verify-invasion` EF)가 옛 번들이면 끼임을 지난 리플레이가 클라와 갈려 거부된다.
 *
 * 이 리포는 같은 함정을 이미 문서화해 뒀다(`.omc/skills/planet-blitz-supabase-deploy-workflow.md`:
 * "`fixtures.json` 이 그린이어도 재배포는 필요하다 … **픽스처 그린을 '재배포 불필요'로 읽지
 * 마라**"). 골든 불변은 **재녹화가 불필요하다**는 뜻일 뿐이고 재배포 판단과는 별개다.
 */
export function slideCircleWalls(
  x: number,
  y: number,
  r: number,
  walls: readonly Entity[],
  prevX?: number,
  prevY?: number,
  pin?: SlidePin,
): SlideResult {
  let hit = false;
  const hasPrev = prevX !== undefined && prevY !== undefined;
  for (let pass = 0; pass < SLIDE_PASSES; pass++) {
    let pushed = false;
    for (const w of walls) {
      const hw = w.radius + r; // Minkowski-expanded half-extents
      const hh = w.targetX + r;
      const dx = x - w.x;
      const dy = y - w.y;
      if (dx > -hw && dx < hw && dy > -hh && dy < hh) {
        // Overlapping: push out along the axis of least penetration.
        const penX = hw - (dx < 0 ? -dx : dx);
        const penY = hh - (dy < 0 ? -dy : dy);
        // 되밀 쪽 판정의 기준 좌표. 기본은 현재 좌표(= 최소 침투, 기존 거동). 직전 좌표가
        // 있고 그것이 **벽 밖**이면 진입면을 알 수 있으므로 그쪽을 기준으로 삼는다.
        let refX = dx;
        let refY = dy;
        let pinned = false;
        if (hasPrev) {
          const pdx = (prevX as number) - w.x;
          const pdy = (prevY as number) - w.y;
          const prevInside = pdx > -hw && pdx < hw && pdy > -hh && pdy < hh;
          if (prevInside) pinned = true;
          else {
            refX = pdx;
            refY = pdy;
          }
        }
        // 끼임 + 창 정보 + **최소 침투 축이 창 축과 같을 때만** 쪽을 창 전진의 반대로 고정한다.
        //
        // 축 조건이 왜 필요한가: 축을 무조건 창 축으로 강제하면 벽 **모서리를 살짝 스친** 경우까지
        // 창 축으로 해소해, 옆으로 90유닛 비켜서면 될 것을 뒤로 500유닛 넘게 되민다(레이싱 트랙
        // 벽은 폭 1000 · 반높이 90 이다 — 실측). 관통은 "창 축으로 벽을 통째로 건너뛰는 것" 이니
        // 창 축 해소만 교정하면 충분하고, 교차 축 해소는 애초에 관통을 만들 수 없다.
        const pinAxisIsLeast =
          pin !== undefined && (pin.axis === PIN_AXIS_VERTICAL ? penY <= penX : penX < penY);
        if (pinned && pin !== undefined && pinAxisIsLeast) {
          if (pin.axis === PIN_AXIS_VERTICAL) y = w.y - (pin.dir >= 0 ? hh : -hh);
          else x = w.x - (pin.dir >= 0 ? hw : -hw);
        } else if (penX < penY) {
          x = w.x + (refX >= 0 ? hw : -hw);
        } else {
          y = w.y + (refY >= 0 ? hh : -hh);
        }
        hit = true;
        pushed = true;
      }
    }
    // 이번 패스에서 아무 벽과도 겹치지 않았으면 조기 종료(추가 패스 불필요).
    if (!pushed) break;
  }
  return { x, y, hit };
}

/**
 * True when the segment (x1,y1)-(x2,y2) intersects the wall's AABB. Liang-Barsky
 * parametric clip using only basic arithmetic (deterministic). Used by the LOS
 * targeting filter: a candidate is "blocked" when the player→candidate segment
 * crosses any active wall.
 */
export function segmentIntersectsWall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: Entity,
): boolean {
  const minX = w.x - w.radius;
  const maxX = w.x + w.radius;
  const minY = w.y - w.targetX;
  const maxY = w.y + w.targetX;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];
  for (let i = 0; i < 4; i++) {
    const pi = p[i] as number;
    const qi = q[i] as number;
    if (pi === 0) {
      // Parallel to this slab: outside it means no intersection.
      if (qi < 0) return false;
    } else {
      const t = qi / pi;
      if (pi < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

/** True when any wall blocks the segment (from)->(to). */
export function segmentBlocked(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  walls: readonly Entity[],
): boolean {
  for (const w of walls) {
    if (segmentIntersectsWall(fromX, fromY, toX, toY, w)) return true;
  }
  return false;
}
