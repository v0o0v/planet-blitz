/**
 * 활성 벽 broad-phase 인덱스 — 침공 전용 (M7a · L4-facility).
 *
 * ## 왜 필요한가
 * 탄-벽 판정은 지금 `O(투사체 × 활성 벽)` 직접 스윕이다(src/sim/world.ts stepProjectiles).
 * 코드에 붙은 성능 가드 주석이 "활성 벽 ≤ ~19" 를 전제로 삼고 있는데, **L2 회랑은 상·하 긴
 * 벽 + 병목 블록으로 그 전제를 즉시 깬다**(템플릿당 4~6개지만 M7c 확장·기물까지 얹히면 더
 * 는다). 그래서 벽에도 공간 격자가 필요하다.
 *
 * ## 왜 SpatialHash 를 그대로 쓰지 않았나
 * `src/sim/collision.ts` 의 SpatialHash 는 엔티티를 **중심 셀 1칸에만** 넣는다. 길이 12000u
 * 짜리 회랑 벽은 셀 수십 칸에 걸쳐 있어 중심 셀만으로는 질의에서 통째로 누락된다. 그래서 여기서는
 * 벽의 AABB 가 **겹치는 모든 셀**에 등록한다. 셀 키 산법(Szudzik 접기 + 대소수 혼합)과 (cy, cx)
 * 고정 순회 순서는 SpatialHash 와 동일한 결정론 규율을 따른다.
 *
 * ⚠️ 2026-07-28 보충 — `fix/spatial-hash-large-radius-broadphase` 가 SpatialHash **질의 쪽**을
 * 고쳐(등록 최대 반경만큼 셀 범위를 넓히고, 초대형은 선형 목록으로 뺀다) 큰 반경 엔티티 누락을
 * 없앴다. 그래도 **이 인덱스는 계속 필요하다**: ① 등록은 여전히 중심 셀 1칸이고, ② SpatialHash
 * 의 초대형 경로는 **원-원** 판정이라 12,000×240 짜리 AABB 벽에는 성립하지 않으며(원으로 감싸면
 * 회랑 절반이 후보가 된다), ③ 벽은 애초에 `resolveCollisions` 의 격자 등록 대상이 아니다.
 *
 * ## PvE 는 건드리지 않는다
 * 이 인덱스는 **침공 경로에서만** 활성화한다(호출은 world.ts 소유 레인이 배선). PvE 는 기존
 * 직접 스윕을 그대로 쓴다 — broad-phase 도입이 판정 결과를 미세하게라도 바꾸면 PvE 해시 회귀
 * 가드가 깨지기 때문이다. 그래서 이 모듈은 "직접 스윕과 **동일 결과**"를 계약으로 둔다:
 * {@link InvasionWallIndex.firstBlocking} 은 겹치는 벽 중 **배열 인덱스가 가장 작은** 것을
 * 돌려주어 직접 스윕의 first-hit 와 비트 동일하다.
 *
 * 결정론: 정수 셀 좌표 + 기존 `circleOverlapsWall`(정확 판정)만 쓴다. RNG·wall-clock 미사용.
 */

import type { Entity } from '../entities.js';
import { circleOverlapsWall, sweptCircleOverlapsWall } from '../los.js';

/**
 * 기본 셀 크기(월드 유닛). 회랑 벽 두께(240)·소켓 간격(~1800)·탄 반지름(≤12) 사이에서
 * 셀당 벽 수와 셀 수를 함께 낮게 유지하는 값. 값이 달라도 결과는 동일하다(성능만 변한다).
 */
export const WALL_INDEX_CELL_SIZE = 512;

/** 직접 스윕(참조 구현). 배열 순서로 훑어 **첫 겹침** 벽을 돌려준다. */
export function sweepWallsDirect(
  walls: readonly Entity[],
  cx: number,
  cy: number,
  cr: number,
): Entity | null {
  for (const w of walls) {
    if (circleOverlapsWall(cx, cy, cr, w)) return w;
  }
  return null;
}

/**
 * 선분 버전 직접 스윕(참조 구현). {@link InvasionWallIndex.firstBlockingSwept} 가 이것과
 * **항상 같은 벽**을 돌려주는지가 격자 구현의 계약이고, `tests/invasionMovingWall.test.ts`
 * 계열이 그 동치를 대조한다(지점 버전 선례와 동형).
 */
export function sweepWallsDirectSwept(
  walls: readonly Entity[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
): Entity | null {
  for (const w of walls) {
    if (sweptCircleOverlapsWall(x1, y1, x2, y2, r, w)) return w;
  }
  return null;
}

/**
 * 활성 벽 broad-phase 격자.
 *
 * 사용법(호출은 world.ts 소유 레인):
 * ```ts
 * state.wallIndex.rebuild(state.activeWalls);   // 벽 목록이 바뀐 틱에만
 * if (state.wallIndex.firstBlocking(b.x, b.y, b.radius) !== null) b.dead = true;
 * ```
 */
export class InvasionWallIndex {
  private readonly cellSize: number;
  /** 셀 키 → 그 셀에 걸친 벽의 **배열 인덱스** 목록(오름차순). */
  private readonly cells = new Map<number, number[]>();
  /** rebuild 시점의 벽 배열(인덱스 → 엔티티). */
  private walls: readonly Entity[] = [];
  /** 중복 정확판정 제거용 스탬프(벽 인덱스별 마지막 질의 번호). */
  private stamps: Int32Array = new Int32Array(0);
  private queryId = 0;
  /** 정확 판정(circleOverlapsWall) 호출 누적 횟수 — 성능 계측/테스트용. */
  private probes = 0;
  /** rebuild 누적 횟수. 이동 벽 갱신 규율이 지켜지는지 테스트가 관측하는 창구다. */
  private builds = 0;

  constructor(cellSize: number = WALL_INDEX_CELL_SIZE) {
    this.cellSize = cellSize > 0 ? cellSize : WALL_INDEX_CELL_SIZE;
  }

  /** SpatialHash 와 동일한 결정론 셀 키(Szudzik 접기 + 대소수 혼합 → uint32). */
  private cellKey(cx: number, cy: number): number {
    const a = cx >= 0 ? 2 * cx : -2 * cx - 1;
    const b = cy >= 0 ? 2 * cy : -2 * cy - 1;
    return ((a * 73856093) ^ (b * 19349663)) >>> 0;
  }

  /**
   * 벽 목록으로 격자를 다시 만든다. 벽은 AABB 가 겹치는 **모든 셀**에 등록된다
   * (긴 회랑 벽이 중심 셀에만 들어가 누락되는 것을 막는다).
   */
  rebuild(walls: readonly Entity[]): void {
    this.cells.clear();
    this.builds++;
    this.walls = walls;
    if (this.stamps.length < walls.length) this.stamps = new Int32Array(walls.length * 2 + 8);
    else this.stamps.fill(0, 0, walls.length);
    this.queryId = 0;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]!;
      const hw = w.radius; // 반폭(entities.spawnWall 필드 매핑 정본)
      const hh = w.targetX; // 반높이
      const minCx = Math.floor((w.x - hw) / this.cellSize);
      const maxCx = Math.floor((w.x + hw) / this.cellSize);
      const minCy = Math.floor((w.y - hh) / this.cellSize);
      const maxCy = Math.floor((w.y + hh) / this.cellSize);
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const key = this.cellKey(cx, cy);
          let bucket = this.cells.get(key);
          if (bucket === undefined) {
            bucket = [];
            this.cells.set(key, bucket);
          }
          bucket.push(i); // i 오름차순 삽입 → 버킷은 항상 정렬 상태
        }
      }
    }
  }

  /**
   * 마지막 rebuild 에 쓴 **같은 배열**로 격자를 다시 만든다.
   *
   * ## 왜 필요한가 (이동 벽 갱신 규율 — M7c)
   * `world.ts` 는 틱 머리에서 rebuild 를 한 번만 한다. 압축 프레스(이동 벽)는 그 뒤
   * `stepFacility` 안에서 좌표가 바뀌므로, 갱신하지 않으면 같은 틱 뒷단(stepProjectiles)이
   * **옛 좌표 격자**로 탄-벽 판정을 한다 — 탄이 프레스를 뚫거나 허공에서 사라진다.
   * 벽 배열의 신원·순서는 그대로이므로 셀 재등록만 하면 되고, `firstBlocking` 의
   * "가장 작은 배열 인덱스" 계약도 그대로 유지된다.
   */
  refresh(): void {
    this.rebuild(this.walls);
  }

  /** 등록된 벽 수. */
  get size(): number {
    return this.walls.length;
  }

  /** rebuild 누적 횟수(갱신 규율 검증용). */
  get buildCount(): number {
    return this.builds;
  }

  /** 정확 판정 누적 호출 수(성능 계측). */
  get probeCount(): number {
    return this.probes;
  }

  /** 정확 판정 카운터를 0 으로 되돌린다. */
  resetProbeCount(): void {
    this.probes = 0;
  }

  /**
   * 원(cx, cy, cr) 과 겹치는 벽 중 **배열 인덱스가 가장 작은** 것을 돌려준다(없으면 null).
   * 직접 스윕(`sweepWallsDirect`)의 first-hit 와 결과가 항상 동일하다.
   */
  firstBlocking(cx: number, cy: number, cr: number): Entity | null {
    if (this.walls.length === 0) return null;
    const stamp = ++this.queryId;
    const stamps = this.stamps;
    const minCx = Math.floor((cx - cr) / this.cellSize);
    const maxCx = Math.floor((cx + cr) / this.cellSize);
    const minCy = Math.floor((cy - cr) / this.cellSize);
    const maxCy = Math.floor((cy + cr) / this.cellSize);
    let best = -1;
    for (let gy = minCy; gy <= maxCy; gy++) {
      for (let gx = minCx; gx <= maxCx; gx++) {
        const bucket = this.cells.get(this.cellKey(gx, gy));
        if (bucket === undefined) continue;
        for (const i of bucket) {
          // 이미 이번 질의에서 정확판정한 벽은 건너뛴다(다중 셀 등록분 중복 제거).
          if (stamps[i] === stamp) continue;
          stamps[i] = stamp;
          // 이미 더 작은 인덱스가 맞았으면 더 큰 인덱스는 볼 필요가 없다.
          if (best >= 0 && i > best) continue;
          this.probes++;
          if (circleOverlapsWall(cx, cy, cr, this.walls[i]!)) {
            if (best < 0 || i < best) best = i;
          }
        }
      }
    }
    return best >= 0 ? this.walls[best]! : null;
  }

  /**
   * 반경 `r` 인 원이 (x1,y1)→(x2,y2) 로 **이동하는 동안** 겹치는 벽 중 배열 인덱스가 가장
   * 작은 것(없으면 null). {@link firstBlocking} 의 선분 버전이고,
   * {@link sweepWallsDirectSwept} 의 first-hit 와 결과가 항상 동일하다.
   *
   * ## 왜 지점 질의로는 안 되는가
   * 탄 대 적 판정이 선분인데 탄 대 벽이 지점이면, 빠른 탄이 한 틱에 벽을 통째로 건너뛰어
   * **벽 뒤 적을 때린다**(근거·실측은 `los.sweptCircleOverlapsWall` 주석). 침공 회랑 벽은
   * 전폭 240 인데 상위 기체 만점 빌드의 탄 스텝은 261~168 유닛/틱이라 실제로 도달한다.
   *
   * ## broad-phase 도 함께 넓혀야 한다
   * 셀 질의 범위를 **선분 전체의 AABB**(양 끝점 + 반경)로 잡는다. 끝점 주변 셀만 보면 경로
   * 중간 셀에만 등록된 벽을 놓쳐 선분 판정이 무의미해진다 — `collision` 쪽 선분 판정 도입에서
   * 같은 실수를 경계했던 지점과 동형이다.
   */
  firstBlockingSwept(x1: number, y1: number, x2: number, y2: number, r: number): Entity | null {
    if (this.walls.length === 0) return null;
    const stamp = ++this.queryId;
    const stamps = this.stamps;
    const loX = (x1 < x2 ? x1 : x2) - r;
    const hiX = (x1 > x2 ? x1 : x2) + r;
    const loY = (y1 < y2 ? y1 : y2) - r;
    const hiY = (y1 > y2 ? y1 : y2) + r;
    const minCx = Math.floor(loX / this.cellSize);
    const maxCx = Math.floor(hiX / this.cellSize);
    const minCy = Math.floor(loY / this.cellSize);
    const maxCy = Math.floor(hiY / this.cellSize);
    let best = -1;
    for (let gy = minCy; gy <= maxCy; gy++) {
      for (let gx = minCx; gx <= maxCx; gx++) {
        const bucket = this.cells.get(this.cellKey(gx, gy));
        if (bucket === undefined) continue;
        for (const i of bucket) {
          if (stamps[i] === stamp) continue;
          stamps[i] = stamp;
          if (best >= 0 && i > best) continue;
          this.probes++;
          if (sweptCircleOverlapsWall(x1, y1, x2, y2, r, this.walls[i]!)) {
            if (best < 0 || i < best) best = i;
          }
        }
      }
    }
    return best >= 0 ? this.walls[best]! : null;
  }

  /** 겹치는 벽이 하나라도 있는가(투사체 소멸 판정용 — first-hit 와 동치). */
  blocked(cx: number, cy: number, cr: number): boolean {
    return this.firstBlocking(cx, cy, cr) !== null;
  }
}
