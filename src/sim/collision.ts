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

/**
 * 셀 등록 대상과 **초대형 목록** 을 가르는 반경 임계의 기본값(셀 크기 대비 비율이 아니라
 * 절대값이다 — 아래 근거가 카탈로그 실측이라서).
 *
 * 임계 위 엔티티는 셀에 넣지 않고 {@link SpatialHash} 의 선형 목록으로 보낸다. 값을 160 으로
 * 잡은 근거는 카탈로그 실측이다 — 적 최대 반경 140 · 보스 최대 130 · 설비 38 이라 **전투
 * 엔티티는 전부 임계 아래**로 들어가고, 임계를 넘는 것은 사실상 해저드 장판뿐이다(침공 4기지
 * × 6,000틱 실측: 반경 > 256 인 엔티티는 **틱당 최대 1개** · 평균 0.04개). 즉 선형 목록은
 * 거의 비어 있어 비용이 없고, 셀 질의 확장폭({@link SpatialHash.maxHashedRadius})은 침공에서
 * 54 · PvE 에서 140 수준이라 셀 한 칸(256)을 넘지 않는다.
 */
export const OVERSIZED_RADIUS_THRESHOLD = 160;

export class SpatialHash<T extends Spatial> {
  private readonly cellSize: number;
  private readonly oversizedThreshold: number;
  /**
   * Sparse bucket map keyed by an integer cell key. Unbounded (infinite map):
   * only occupied cells are allocated, so the grid tracks entities at any
   * coordinate without a fixed extent. The map is NEVER iterated directly —
   * cell keys are computed arithmetically and cells are visited in a fixed
   * (cy, cx) order (see `query`), preserving the determinism contract above.
   */
  private readonly cells = new Map<number, T[]>();
  /**
   * 셀에 등록된 엔티티 반경의 최댓값. {@link query} 가 셀 범위를 이만큼 **넓혀서** 훑는다.
   *
   * ## 왜 필요한가 — 이게 없어서 큰 엔티티가 판정에서 통째로 빠져 있었다
   * `insert` 는 엔티티를 **중심 좌표의 셀 한 칸**에만 넣는다. 그런데 `query` 가 **탐침 반경**
   * 으로만 셀을 훑으면, 접촉 조건은 `|중심거리| <= 탐침반경 + 엔티티반경` 인데 탐침이 훑는
   * 범위는 `탐침반경` 뿐이라 **엔티티 반경만큼의 띠가 통째로 사라진다**. 엔티티 중심이
   * 탐침 셀 밖이면 반경이 아무리 커도 후보로 들어오지 않는다.
   *
   * 실측 증상: 침공 해저드 `hazardRadius` 를 760 으로 두나 1,520 으로 두나 96시드 9행이
   * **바이트 동일**이었다(반경 약 650 위로는 기여가 정확히 0). 다만 결함은 해저드 전용이
   * **아니다** — 반경 54 짜리 잡몹도 셀 경계를 사이에 두면 접촉 거리 안에서 후보에서 빠졌다.
   * 즉 모든 큰 엔티티가 셀 경계에서 확률적으로 판정을 흘리고 있었다.
   *
   * 확장폭을 상수가 아니라 **실제 등록된 최댓값**으로 두는 이유는 비용이다. 상수 256 으로
   * 두면 점 질의가 항상 3×3 셀을 훑지만, 실측 최댓값은 침공 54 · PvE 140 이라 대개 셀
   * 경계 근처에서만 한 칸이 늘어난다.
   */
  private maxHashedRadius = 0;
  /**
   * {@link oversizedThreshold} 를 넘는 엔티티의 선형 목록. 셀 확장폭은 이 임계 아래로
   * 묶여 있어야 질의가 폭발하지 않으므로(반경 1,520 짜리 장판 하나 때문에 모든 질의가
   * 13×13 셀을 훑게 된다), 임계 위는 셀을 쓰지 않고 질의마다 원-원 판정으로 걸러 낸다.
   * 목록이 항상 한 자릿수라 선형 주사가 셀 순회보다 싸다({@link OVERSIZED_RADIUS_THRESHOLD}).
   */
  private readonly oversized: T[] = [];

  constructor(cellSize: number, oversizedThreshold = OVERSIZED_RADIUS_THRESHOLD) {
    this.cellSize = cellSize;
    this.oversizedThreshold = oversizedThreshold;
  }

  clear(): void {
    this.cells.clear();
    this.oversized.length = 0;
    this.maxHashedRadius = 0;
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

  /**
   * Insert an entity into the cell containing its current position — 단, 반경이
   * {@link oversizedThreshold} 를 넘으면 셀 대신 {@link oversized} 목록으로 보낸다.
   */
  insert(entity: T): void {
    if (entity.radius > this.oversizedThreshold) {
      this.oversized.push(entity);
      return;
    }
    if (entity.radius > this.maxHashedRadius) this.maxHashedRadius = entity.radius;
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
   * Visit every inserted entity that can possibly overlap the circle (x, y, radius).
   * The callback may be invoked for entities slightly outside the circle (the
   * grid is broad-phase only) — callers do the exact distance test.
   *
   * 셀 범위는 탐침 반경이 아니라 **탐침 반경 + {@link maxHashedRadius}** 로 넓힌다. 엔티티가
   * 중심 셀 한 칸에만 등록되므로, 그만큼 넓히지 않으면 자기 반경 안에 탐침이 들어와 있는데도
   * 후보에서 빠진다(그 주석에 실측 근거가 있다). {@link oversized} 는 셀을 쓰지 않으므로
   * 목록 전체를 원-원 판정으로 훑는다 — `|중심거리| <= 탐침반경 + 엔티티반경` 은 어떤 형태의
   * 겹침에도 필요한 조건이라 이 걸러 내기는 **후보를 놓치지 않는다**(broad-phase 계약 유지).
   *
   * Iteration order is deterministic: cells in a fixed (cy, cx) nested order, entities
   * within a cell in insertion order, **그다음** oversized 목록이 삽입 순서로 뒤따른다.
   */
  query(x: number, y: number, radius: number, cb: (entity: T) => void): void {
    const reach = radius + this.maxHashedRadius;
    const minCx = Math.floor((x - reach) / this.cellSize);
    const maxCx = Math.floor((x + reach) / this.cellSize);
    const minCy = Math.floor((y - reach) / this.cellSize);
    const maxCy = Math.floor((y + reach) / this.cellSize);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.cells.get(this.cellKey(cx, cy));
        if (bucket === undefined) continue;
        for (const entity of bucket) {
          cb(entity);
        }
      }
    }
    for (const entity of this.oversized) {
      const dx = entity.x - x;
      const dy = entity.y - y;
      const rr = radius + entity.radius;
      if (dx * dx + dy * dy <= rr * rr) cb(entity);
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
