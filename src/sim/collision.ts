/**
 * Uniform spatial-hash grid for broad-phase collision queries (M1 Phase 2).
 *
 * Bullet-hell combat pairs up to ~2,000 bullets against dozens of enemies every
 * tick. A naive O(bullets * enemies) sweep is quadratic; this grid buckets
 * entities into fixed-size cells so each query only visits the handful of cells
 * overlapping a probe circle.
 *
 * Determinism (ADR-0005): the grid never iterates the backing `Map`. Cell keys
 * are computed arithmetically and cells are visited in a fixed (cy, cx) nested
 * order; within a cell, entities keep their insertion order. Because callers
 * insert in entity-array order, every query yields candidates in a stable,
 * seed-independent order — safe to drive damage resolution from.
 */

/** Minimal shape the grid needs from an entity. */
export interface Spatial {
  x: number;
  y: number;
  radius: number;
}

export class SpatialHash<T extends Spatial> {
  private readonly cellSize: number;
  /**
   * Sparse bucket map keyed by an integer cell key. Unbounded (infinite map):
   * only occupied cells are allocated, so the grid tracks entities at any
   * coordinate without a fixed extent. The map is NEVER iterated directly —
   * cell keys are computed arithmetically and cells are visited in a fixed
   * (cy, cx) order (see `query`), preserving the determinism contract above.
   */
  private readonly cells = new Map<number, T[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.cells.clear();
  }

  /**
   * Deterministic non-negative integer key for a signed cell (cx, cy). Each
   * axis is first folded into the naturals with Szudzik's pairing
   * (`z >= 0 ? 2z : -2z - 1`) so negative coordinates cannot collide with their
   * positive mirror, then the two folds are mixed with the classic large-prime
   * multiply/XOR and masked to a uint32. Pure integer arithmetic — identical on
   * every platform.
   */
  private cellKey(cx: number, cy: number): number {
    const a = cx >= 0 ? 2 * cx : -2 * cx - 1;
    const b = cy >= 0 ? 2 * cy : -2 * cy - 1;
    return ((a * 73856093) ^ (b * 19349663)) >>> 0;
  }

  /** Insert an entity into the cell containing its current position. */
  insert(entity: T): void {
    const cx = Math.floor(entity.x / this.cellSize);
    const cy = Math.floor(entity.y / this.cellSize);
    const key = this.cellKey(cx, cy);
    let bucket = this.cells.get(key);
    if (bucket === undefined) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push(entity);
  }

  /**
   * Visit every inserted entity whose cell overlaps the circle (x, y, radius).
   * The callback may be invoked for entities slightly outside the circle (the
   * grid is broad-phase only) — callers do the exact distance test. Iteration
   * order is deterministic: cells in a fixed (cy, cx) nested order, entities
   * within a cell in insertion order.
   */
  query(x: number, y: number, radius: number, cb: (entity: T) => void): void {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells.get(this.cellKey(cx, cy));
        if (bucket === undefined) continue;
        for (const entity of bucket) {
          cb(entity);
        }
      }
    }
  }
}

/**
 * True when the **swept capsule** of a moving circle overlaps a static circle —
 * i.e. the circle of radius `mr` travelling from (ax, ay) to (bx, by) touches the
 * circle (cx, cy, cr) at any point along the way.
 *
 * ## 왜 지점 판정만으로는 안 되는가 (실측 결함)
 * 플레이어 탄은 속도 3732/s = **틱당 62 유닛**을 나아가고, 히트 창은 탄 반경 5 + 잡몹 반경
 * 32 = **37 유닛**이다. 판정을 이동 **후** 좌표 한 점에서만 하면, 플레이어 위치에서 태어난 탄은
 * 첫 틱에 62 유닛을 건너뛰어 그 창을 **완전히 지나친다** — 플레이어에 37 유닛 이내로 붙은
 * 적은 자기 탄에 구조적으로 맞지 않았다(하네스 실측: 300틱 동안 플레이어 40 유닛 안에 존재한
 * 탄 0발 · 최소 거리 62 = 정확히 한 틱 이동량 · 추가 처치 0). 기존 밀도에서는 적이 붙기 전에
 * 죽어 드러나지 않았고, 밀도를 올리자 무리가 플레이어에 도달해 132마리가 불사로 쌓인 채 런이
 * 교착됐다.
 *
 * 벽에 대해서는 이 리포가 이미 터널링을 알고 막아 뒀다(`WALL_HALF_MIN` 이 최대 대시 스텝보다
 * 크게 잡혀 있다 — `chunks.ts`). 탄 대 적에는 그 방어가 없었다.
 *
 * ## ⚠️ 그 벽 방어는 **탄에는 성립하지 않는다** (후속 실측)
 * `WALL_HALF_MIN` 주석은 "전폭 120 > 최대 대시 스텝 59" 만 근거로 삼는데, 이 함수가 도입된
 * 뒤로는 같은 부등식이 **탄 스텝에도** 걸린다 — 탄이 한 틱에 벽을 건너뛰면 벽 판정을 지나치고
 * 이 선분 판정이 **벽 뒤 적**을 때리기 때문이다(선분 판정에는 가림 개념이 없다).
 *
 * 그리고 탄 쪽 부등식은 **이미 깨져 있다.** 만점 빌드 한 틱 탄 이동량 실측:
 * bubble 261.6 · arccaster 219.0 · phantom 179.0 · striker 168.2 · hatchling 164.9 ·
 * mallow 141.4 · bruiser 132.1 (유닛/틱) — **전 기체가** 120 을 넘고 상위 5기체는 침공 회랑
 * 240 도 넘는다. 그래서 탄 대 벽 판정도 선분으로 올렸다
 * ({@link import('./los.js').sweptCircleOverlapsWall}). 두 판정이 같은 차원이어야 가림이 성립한다.
 *
 * 상한 계산과 이 부등식은 `tests/bulletTunnelInvariant.test.ts` 가 카탈로그에서 파생해 지킨다 —
 * 스킬 노드나 어픽스가 추가되면 그 테스트가 먼저 움직인다.
 *
 * ## 산술
 * 선분 위 최근접점을 매개변수 `t = clamp(((c−a)·(b−a)) / |b−a|², 0, 1)` 로 구해 그 점과 원
 * 중심의 거리를 반지름 합과 비교한다. 제곱 비교만 쓰므로 `sqrt` 가 없고, 길이가 0 인 선분
 * (정지한 탄·생성 직후)은 분모 0 가드가 지점 판정으로 되돌린다 — 즉 이 함수는
 * {@link circlesOverlap} 의 상위 호환이다(선분이 한 점이면 결과가 동일).
 *
 * 전부 f64 기본 연산이라 플랫폼 무관하게 비트 동일하다(결정론 규약).
 */
export function sweptCircleOverlap(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  mr: number,
  cx: number,
  cy: number,
  cr: number,
): boolean {
  return sweptCircleHitT(ax, ay, bx, by, mr, cx, cy, cr) !== undefined;
}

/**
 * {@link sweptCircleOverlap} 과 **같은 판정**을 하되, 겹칠 때 그 경로 위 **진입 매개변수 t**
 * (0 = 시작점, 1 = 끝점)를 함께 돌려준다. 겹치지 않으면 `undefined`.
 *
 * ## 왜 t 가 필요한가 (해소 순서)
 * 선분 판정을 쓰면 탄 하나가 한 틱에 경로 위 **여러** 표적을 후보로 갖는다. 그런데
 * {@link SpatialHash.query} 의 콜백 순서는 격자 `(cy, cx)` 순이라 **경로 순서와 무관**하다.
 * `pierce === 0` 인 기본 탄은 첫 명중에서 소멸하므로, 정렬 없이 해소하면 가까운 적을 지나쳐
 * 먼 적을 때린다(결정론은 유지되지만 시각적으로 탄이 앞 적을 통과한다). 호출자는 이 t 로
 * 후보를 오름차순 정렬한 뒤 해소한다.
 *
 * ## 산술
 * 판정 자체는 **클램프된 최근접점**으로 한다(위 함수와 비트 동일한 술어). t 는 무한 직선에서의
 * 정확한 진입해 `t = t_raw − √((r² − d⊥²) / |s|²)` 를 쓰고 `[0, 1]` 로 클램프한다. 최근접점의
 * t 를 그대로 쓰지 않는 이유는 표적 반지름이 서로 다를 때 순서가 뒤집히기 때문이다 — 반지름이
 * 큰 보스는 중심이 뒤에 있어도 표면에 먼저 닿는다.
 *
 * `Math.sqrt` 는 IEEE-754 로 정확히 반올림되도록 규정돼 있어 플랫폼 무관하다(결정론 규약).
 * `sin`/`cos` 같은 초월함수와 달리 구현 재량이 없다.
 */
export function sweptCircleHitT(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  mr: number,
  cx: number,
  cy: number,
  cr: number,
): number | undefined {
  const sx = bx - ax;
  const sy = by - ay;
  const len2 = sx * sx + sy * sy;
  const acx = cx - ax;
  const acy = cy - ay;
  const rr = mr + cr;
  const rr2 = rr * rr;
  // 길이 0 인 선분(정지한 탄·생성 직후)은 지점 판정으로 되돌아간다.
  if (len2 <= 0) {
    return acx * acx + acy * acy <= rr2 ? 0 : undefined;
  }
  const tRaw = (acx * sx + acy * sy) / len2;
  let tc = tRaw;
  if (tc < 0) tc = 0;
  else if (tc > 1) tc = 1;
  const dx = ax + sx * tc - cx;
  const dy = ay + sy * tc - cy;
  if (dx * dx + dy * dy > rr2) return undefined;
  // 직선까지의 수직거리². 술어가 참이면 수학적으로 rr2 이하다(최근접점 거리 ≤ 어떤 점 거리).
  // 부동소수 오차로 음수가 나올 수 있어 아래 `rem <= 0` 가드가 그 경우를 t_raw 로 흡수한다.
  const perp2 = acx * acx + acy * acy - tRaw * tRaw * len2;
  const rem = rr2 - perp2;
  let t = rem > 0 ? tRaw - Math.sqrt(rem / len2) : tRaw;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t;
}

/** True when two circles overlap. Basic ops only (deterministic). */
export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}
