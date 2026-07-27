import { describe, it, expect } from 'vitest';
import {
  SpatialHash,
  circlesOverlap,
  sweptCircleOverlap,
  sweptCircleHitT,
} from '../src/sim/collision.js';

interface P {
  x: number;
  y: number;
  radius: number;
  id: number;
}

describe('SpatialHash', () => {
  it('returns candidates near a probe and skips far cells', () => {
    const grid = new SpatialHash<P>(128);
    const near: P = { x: 100, y: 100, radius: 8, id: 1 };
    const far: P = { x: 1800, y: 1000, radius: 8, id: 2 };
    grid.insert(near);
    grid.insert(far);

    const hits: number[] = [];
    grid.query(100, 100, 20, (e) => hits.push(e.id));
    expect(hits).toContain(1);
    expect(hits).not.toContain(2);
  });

  // ── 큰 반경 엔티티가 broad-phase 에서 사라지던 결함 (fix/spatial-hash-large-radius-broadphase)
  //
  // `insert` 는 엔티티를 중심 셀 **한 칸**에만 넣는다. 예전 `query` 는 셀 범위를 **탐침 반경**
  // 으로만 넓혀서, 접촉 조건(`중심거리 <= 탐침반경 + 엔티티반경`) 중 엔티티 반경만큼의 띠가
  // 통째로 판정에서 빠졌다. 아래 세 케이스는 전부 수정 전 코드에서 실패한다.

  it('엔티티 반경이 셀보다 커도 후보로 들어온다 (해저드 장판)', () => {
    // 셀 256 · 장판 반경 900 · 탐침은 장판 중심에서 700 떨어진 점. 접촉 거리 안(700 < 900)인데
    // 중심 셀이 두 칸 밖이라 예전에는 후보에 들어오지도 않았다 — 실효 반경 상한 약 650 의 정체.
    const grid = new SpatialHash<P>(256);
    const hazard: P = { x: 0, y: 0, radius: 900, id: 7 };
    grid.insert(hazard);
    const hits: number[] = [];
    grid.query(700, 0, 8, (e) => hits.push(e.id));
    expect(hits).toContain(7);
  });

  it('반경을 더 키우면 그만큼 더 멀리서 잡힌다 (상한이 없다)', () => {
    // "반경 760 과 1,520 이 바이트 동일" 이던 증상의 직접 반증.
    const near = new SpatialHash<P>(256);
    near.insert({ x: 0, y: 0, radius: 760, id: 1 });
    const far = new SpatialHash<P>(256);
    far.insert({ x: 0, y: 0, radius: 1520, id: 1 });
    const probe = (g: SpatialHash<P>): boolean => {
      let found = false;
      g.query(1200, 0, 8, () => (found = true));
      return found;
    };
    expect(probe(near)).toBe(false); // 1200 > 760 → 정말로 밖이다
    expect(probe(far)).toBe(true); // 1200 < 1520 → 잡혀야 한다
  });

  it('셀 경계 너머의 보통 잡몹도 접촉 거리 안이면 잡힌다', () => {
    // 결함은 초대형 전용이 아니었다. 잡몹 반경 54 · 플레이어 판정점 8 이면 접촉 거리는 62 인데,
    // 셀 경계(256)를 사이에 두면 예전 질의는 탐침 반경 28 만큼만 넓혀서 이 잡몹을 놓쳤다.
    const grid = new SpatialHash<P>(256);
    const grunt: P = { x: 258, y: 0, radius: 54, id: 3 };
    grid.insert(grunt);
    const hits: number[] = [];
    grid.query(200, 0, 28, (e) => hits.push(e.id)); // 중심거리 58 <= 28+54
    expect(hits).toContain(3);
  });

  it('iterates candidates in deterministic insertion order', () => {
    const grid = new SpatialHash<P>(64);
    // Same cell, inserted in a known order.
    for (let i = 0; i < 5; i++) grid.insert({ x: 40, y: 40, radius: 4, id: i });
    const seen: number[] = [];
    grid.query(40, 40, 10, (e) => seen.push(e.id));
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  it('clear empties the grid', () => {
    const grid = new SpatialHash<P>(64);
    grid.insert({ x: 10, y: 10, radius: 4, id: 7 });
    grid.clear();
    const seen: number[] = [];
    grid.query(10, 10, 20, (e) => seen.push(e.id));
    expect(seen).toEqual([]);
  });

  it('buckets negative coordinates without colliding with their mirror', () => {
    // Infinite map: cells at (-cx,-cy) must not fold onto (+cx,+cy).
    const grid = new SpatialHash<P>(128);
    const neg: P = { x: -500, y: -500, radius: 8, id: 1 };
    const pos: P = { x: 500, y: 500, radius: 8, id: 2 };
    grid.insert(neg);
    grid.insert(pos);
    const negHits: number[] = [];
    grid.query(-500, -500, 20, (e) => negHits.push(e.id));
    expect(negHits).toContain(1);
    expect(negHits).not.toContain(2);
    const posHits: number[] = [];
    grid.query(500, 500, 20, (e) => posHits.push(e.id));
    expect(posHits).toContain(2);
    expect(posHits).not.toContain(1);
  });

  it('handles entities far from the origin (unbounded grid)', () => {
    const grid = new SpatialHash<P>(128);
    const far: P = { x: 250_000, y: -180_000, radius: 8, id: 42 };
    grid.insert(far);
    const hits: number[] = [];
    grid.query(250_000, -180_000, 20, (e) => hits.push(e.id));
    expect(hits).toEqual([42]);
  });

  it('finds entities across adjacent cell boundaries', () => {
    const grid = new SpatialHash<P>(64);
    // Straddle the 64px cell boundary at x=64.
    const a: P = { x: 60, y: 60, radius: 8, id: 1 };
    const b: P = { x: 68, y: 60, radius: 8, id: 2 };
    grid.insert(a);
    grid.insert(b);
    const seen = new Set<number>();
    grid.query(64, 60, 10, (e) => seen.add(e.id));
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
  });
});

describe('circlesOverlap', () => {
  it('detects overlap and separation', () => {
    expect(circlesOverlap(0, 0, 10, 5, 0, 10)).toBe(true);
    expect(circlesOverlap(0, 0, 10, 100, 0, 10)).toBe(false);
    // Exactly touching counts as overlap.
    expect(circlesOverlap(0, 0, 10, 20, 0, 10)).toBe(true);
  });
});

/**
 * 선분(swept) 판정 — 플레이어탄 **점사거리 면제**를 닫은 프리미티브.
 *
 * 실측 결함: 탄속 3732/s = 틱당 62유닛인데 히트 창은 탄 반경 5 + 잡몹 반경 32 = 37유닛이라,
 * 플레이어 위치에서 태어난 탄이 첫 틱에 창을 통째로 건너뛰었다 → 플레이어에 붙은 적이 자기 탄에
 * 구조적으로 안 맞았다. 아래 첫 케이스가 정확히 그 기하다.
 */
describe('sweptCircleOverlap', () => {
  it('한 틱 이동이 히트 창보다 커도 경로 위 표적을 놓치지 않는다 (회귀의 핵심)', () => {
    // 실제 수치 그대로: (0,0) 에서 태어난 탄(r=5)이 한 틱에 x=62 로 간다. 표적은 원점의 적(r=32).
    // 지점 판정(이동 후 좌표만)은 62 > 37 이라 **놓친다** — 그것이 결함이었다.
    expect(circlesOverlap(62, 0, 5, 0, 0, 32)).toBe(false);
    // 선분 판정은 출발점이 표적 안이므로 잡는다.
    expect(sweptCircleOverlap(0, 0, 62, 0, 5, 0, 0, 32)).toBe(true);
  });

  it('경로 중간에 있는 표적을 잡는다 (양 끝점 모두 창 밖이어도)', () => {
    // 표적은 x=300. 탄은 x=250 → x=350 으로 지나간다. 두 끝점 모두 37유닛 밖이다.
    expect(circlesOverlap(250, 0, 5, 300, 0, 32)).toBe(false);
    expect(circlesOverlap(350, 0, 5, 300, 0, 32)).toBe(false);
    expect(sweptCircleOverlap(250, 0, 350, 0, 5, 300, 0, 32)).toBe(true);
  });

  it('경로에서 옆으로 벗어난 표적은 잡지 않는다 (과탐지 없음)', () => {
    // 같은 x 구간을 지나지만 y 로 100 떨어진 표적 — 반지름 합 37 밖이다.
    expect(sweptCircleOverlap(250, 0, 350, 0, 5, 300, 100, 32)).toBe(false);
    // 경계 바로 안/밖: 거리 37 은 접촉(포함), 38 은 미접촉.
    expect(sweptCircleOverlap(0, 0, 100, 0, 5, 50, 37, 32)).toBe(true);
    expect(sweptCircleOverlap(0, 0, 100, 0, 5, 50, 38, 32)).toBe(false);
  });

  it('선분 끝 밖의 표적은 잡지 않는다 (무한 직선이 아니라 선분이다)', () => {
    // 탄은 x=0 → x=50. 표적 x=200 은 같은 직선 위지만 선분 밖이다.
    expect(sweptCircleOverlap(0, 0, 50, 0, 5, 200, 0, 32)).toBe(false);
    // 뒤쪽(음의 방향)도 같다.
    expect(sweptCircleOverlap(0, 0, 50, 0, 5, -200, 0, 32)).toBe(false);
  });

  it('길이 0 인 선분은 지점 판정과 완전히 같다 (circlesOverlap 의 상위 호환)', () => {
    const cases: readonly [number, number, number, number, number, number][] = [
      [0, 0, 10, 5, 0, 10],
      [0, 0, 10, 100, 0, 10],
      [0, 0, 10, 20, 0, 10],
    ];
    for (const [ax, ay, ar, cx, cy, cr] of cases) {
      expect(sweptCircleOverlap(ax, ay, ax, ay, ar, cx, cy, cr)).toBe(
        circlesOverlap(ax, ay, ar, cx, cy, cr),
      );
    }
  });

  it('방향에 대해 대칭이다 (역주행 탄도 같은 판정)', () => {
    expect(sweptCircleOverlap(250, 0, 350, 0, 5, 300, 0, 32)).toBe(
      sweptCircleOverlap(350, 0, 250, 0, 5, 300, 0, 32),
    );
  });
});

/**
 * 진입 매개변수 t — 한 틱 다중 명중을 **경로 순서**로 해소하기 위한 정렬 키.
 *
 * 격자 순회 순서는 `(cy, cx)` 고정이라 경로 순서가 아니다. 정렬하지 않으면 관통 없는 탄이
 * 가까운 적을 지나쳐 먼 적을 때린다.
 */
describe('sweptCircleHitT', () => {
  it('겹침 판정이 sweptCircleOverlap 과 완전히 일치한다 (술어는 하나다)', () => {
    const cases: readonly [number, number, number, number, number, number, number, number][] = [
      [0, 0, 62, 0, 5, 0, 0, 32], // 출발점이 표적 안
      [250, 0, 350, 0, 5, 300, 0, 32], // 경로 중간
      [250, 0, 350, 0, 5, 300, 100, 32], // 옆으로 벗어남
      [0, 0, 100, 0, 5, 50, 37, 32], // 경계 안(접촉)
      [0, 0, 100, 0, 5, 50, 38, 32], // 경계 밖
      [0, 0, 50, 0, 5, 200, 0, 32], // 선분 앞 밖
      [0, 0, 50, 0, 5, -200, 0, 32], // 선분 뒤 밖
      [10, 10, 10, 10, 5, 12, 12, 32], // 길이 0 · 겹침
      [10, 10, 10, 10, 5, 200, 200, 32], // 길이 0 · 미겹침
    ];
    for (const c of cases) {
      expect(sweptCircleHitT(...c) !== undefined, JSON.stringify(c)).toBe(sweptCircleOverlap(...c));
    }
  });

  it('경로 순서대로 t 가 커진다 (가까운 표적이 작은 t)', () => {
    // 탄이 x=0 → x=250 으로 간다. 표적 세 개가 경로 위에 x 순으로 놓여 있다.
    const near = sweptCircleHitT(0, 0, 250, 0, 5, 60, 0, 32) as number;
    const mid = sweptCircleHitT(0, 0, 250, 0, 5, 140, 0, 32) as number;
    const far = sweptCircleHitT(0, 0, 250, 0, 5, 220, 0, 32) as number;
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
  });

  it('진입 시점이다 — 최근접점이 아니라 표면에 닿는 순간을 돌려준다', () => {
    // 표적 중심 x=125(경로 한가운데), 반지름 합 37 → 진입은 x=88 = t 0.352.
    const t = sweptCircleHitT(0, 0, 250, 0, 5, 125, 0, 32) as number;
    expect(t).toBeCloseTo((125 - 37) / 250, 10);
  });

  it('큰 표적이 뒤에 있어도 표면에 먼저 닿으면 t 가 더 작다 (반지름 역전)', () => {
    // 중심은 잡몹(x=100)이 보스(x=160)보다 앞이지만, 보스 반지름 120 이라 표면은 x=35 에서
    // 닿는다. 최근접점 t 로 정렬했다면 순서가 뒤집혔을 케이스다.
    const grunt = sweptCircleHitT(0, 0, 250, 0, 5, 100, 0, 32) as number;
    const boss = sweptCircleHitT(0, 0, 250, 0, 5, 160, 0, 120) as number;
    expect(boss).toBeLessThan(grunt);
  });

  it('t 는 항상 [0, 1] 이다 (출발점에서 이미 겹쳐 있으면 0)', () => {
    expect(sweptCircleHitT(0, 0, 62, 0, 5, 0, 0, 32)).toBe(0);
    expect(sweptCircleHitT(0, 0, 62, 0, 5, -10, 0, 32)).toBe(0);
    // 끝점에서 겨우 닿는 표적: t 가 1 을 넘지 않는다.
    const t = sweptCircleHitT(0, 0, 100, 0, 5, 137, 0, 32) as number;
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(1);
  });
});
