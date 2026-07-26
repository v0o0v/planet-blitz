import { describe, it, expect } from 'vitest';
import { SpatialHash, circlesOverlap, sweptCircleOverlap } from '../src/sim/collision.js';

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
