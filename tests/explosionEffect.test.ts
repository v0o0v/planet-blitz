/**
 * 파편 버스트 사망 폭발 단위 테스트 (Phase 2 — plan §AC-2.4; ADR-0031).
 *
 * `ShardBurst`([src/render/effects/explosion.ts])는 Phase 1 갤러리에서 사용자가 고른
 * `explosion-shard` 변형을 프로덕션으로 승격한 원샷 파티클 폭발이다. entityRenderer(Wave B)가
 * `spawnExplosion` 을 이걸로 교체한다. 여기서는 그 소비 계약을 헤드리스로 못박는다:
 *
 *  1. **동기 배선**: 생성 즉시 `container.children.length > 0`(절차적 Graphics 라 GL 없이도 성립).
 *  2. **원샷 수명**: `update(dt)` 반복 → 결국 false(전멸) + 그 시점 파티클 정리. destroy() 무-throw.
 *  3. **티어 상한**: Low 파티클 수 < High(같은 scale). scale 이 파티클 수를 늘린다.
 *  4. **결정론**: 같은 seed·scale·tier → 같은 초기 파티클 수 + 같은 적분 배치.
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — PixiJS 는 렌더러 없이
 * import 만 하므로 node 에서 그대로 돈다(tests/galleryWiring.test.ts 선례). 표시 객체 추가·파괴만
 * 검증하고 실제 픽셀 래스터화는 다루지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { ShardBurst } from '../src/render/effects/explosion.js';

// ---------------------------------------------------------------------------
// 1. 동기 배선 (AC-2.4 / AC-1.4 정신) — 목업이 아니라 실 표시 객체를 즉시 붙인다.
// ---------------------------------------------------------------------------

describe('ShardBurst 동기 배선', () => {
  it('생성 즉시 container 에 파티클을 동기 추가한다(children>0)', () => {
    const burst = new ShardBurst(0, 0, 1);
    expect(burst.container.children.length).toBeGreaterThan(0);
    burst.destroy();
  });

  it('container 를 폭발 지점 (x,y) 에 놓고 scale 로 확대한다', () => {
    const burst = new ShardBurst(120, 80, 2);
    expect(burst.container.position.x).toBe(120);
    expect(burst.container.position.y).toBe(80);
    expect(burst.container.scale.x).toBe(2);
    expect(burst.container.scale.y).toBe(2);
    burst.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. 원샷 수명 — update 가 결국 false 를 돌려주고, 그 시점 파티클이 전부 정리된다.
// ---------------------------------------------------------------------------

describe('ShardBurst 원샷 수명', () => {
  it('update 를 반복하면 결국 false(전멸)를 돌려주고 파티클을 정리한다', () => {
    const burst = new ShardBurst(0, 0, 1);
    expect(burst.container.children.length).toBeGreaterThan(0);

    // 첫 프레임은 살아있어야 한다(true).
    expect(burst.update(0.05)).toBe(true);

    // 수명(최장 파편 ~0.72초)을 충분히 넘기도록 반복. 만료 시 false 로 전환되는 시점을 잡는다.
    let alive = true;
    let frames = 0;
    const MAX_FRAMES = 200; // ≈10초 상한(무한 방어). 실제로는 <20프레임에 전멸.
    while (alive && frames < MAX_FRAMES) {
      alive = burst.update(0.05);
      frames += 1;
    }

    expect(alive, 'update 가 결국 false 를 돌려줘야 한다(원샷 전멸)').toBe(false);
    expect(frames, '재발화 없이 유한 프레임 안에 전멸해야 한다').toBeLessThan(MAX_FRAMES);
    // 전멸 시점 = 살아있는 파티클 0. (만료 파티클은 node.destroy() 로 container 에서 분리된다.)
    expect(burst.container.children.length, '전멸 시점 파티클 잔여').toBe(0);

    // 전멸 후 update 는 계속 false(재발화 없음).
    expect(burst.update(0.05)).toBe(false);
  });

  it('전멸 후·중간 어느 지점에서 destroy() 해도 throw 없이 정리한다', () => {
    const a = new ShardBurst(0, 0, 1);
    for (let i = 0; i < 5; i++) a.update(0.05); // 중간까지 진행
    expect(() => a.destroy()).not.toThrow();

    // destroy 이후 update 는 안전하게 false.
    expect(a.update(0.05)).toBe(false);
    // 이중 destroy 도 무해.
    expect(() => a.destroy()).not.toThrow();
  });

  it('큰 dt(탭 복귀 등)에도 순간이동/throw 없이 정리된다', () => {
    const burst = new ShardBurst(50, 50, 3);
    expect(() => {
      burst.update(2); // MAX_DT 로 클램프돼야 함
      burst.update(2);
      burst.update(0.016);
    }).not.toThrow();
    burst.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. 티어 상한 — Low < High(같은 scale), scale 이 파티클 수를 늘린다.
// ---------------------------------------------------------------------------

describe('ShardBurst 티어 상한', () => {
  it('Low 파티클 수 < High 파티클 수(같은 scale·seed)', () => {
    const low = new ShardBurst(0, 0, 1, { tier: 'low', seed: 7 });
    const high = new ShardBurst(0, 0, 1, { tier: 'high', seed: 7 });
    expect(low.container.children.length).toBeLessThan(high.container.children.length);
    low.destroy();
    high.destroy();
  });

  it('Med 는 Low 와 High 사이(단조 상한)', () => {
    const low = new ShardBurst(0, 0, 1, { tier: 'low', seed: 7 });
    const med = new ShardBurst(0, 0, 1, { tier: 'med', seed: 7 });
    const high = new ShardBurst(0, 0, 1, { tier: 'high', seed: 7 });
    expect(med.container.children.length).toBeGreaterThan(low.container.children.length);
    expect(med.container.children.length).toBeLessThan(high.container.children.length);
    low.destroy();
    med.destroy();
    high.destroy();
  });

  it('tier 미지정 시 High 기본(정상 밀도)', () => {
    const def = new ShardBurst(0, 0, 1, { seed: 7 });
    const high = new ShardBurst(0, 0, 1, { tier: 'high', seed: 7 });
    expect(def.container.children.length).toBe(high.container.children.length);
    def.destroy();
    high.destroy();
  });

  it('scale 이 커지면 파티클 수가 늘어난다(보스 폭발이 더 풍성)', () => {
    const small = new ShardBurst(0, 0, 1, { tier: 'high', seed: 7 });
    const boss = new ShardBurst(0, 0, 3, { tier: 'high', seed: 7 });
    expect(boss.container.children.length).toBeGreaterThan(small.container.children.length);
    small.destroy();
    boss.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. 결정론 — 같은 seed → 같은 초기 수 + 같은 적분 배치. 다른 seed → 배치 발산.
// ---------------------------------------------------------------------------

/** 몇 프레임 적분 후 파티클 위치 스냅샷(초기엔 전부 origin 이라 적분 후에야 배치가 갈린다). */
function positionsAfter(seed: number, frames: number): Array<[number, number]> {
  const burst = new ShardBurst(0, 0, 1, { tier: 'high', seed });
  for (let i = 0; i < frames; i++) burst.update(0.03);
  const pts = burst.container.children.map(
    (c) => [c.position.x, c.position.y] as [number, number],
  );
  burst.destroy();
  return pts;
}

describe('ShardBurst 결정론', () => {
  it('같은 seed·scale·tier → 같은 초기 파티클 수', () => {
    const a = new ShardBurst(0, 0, 1, { tier: 'high', seed: 12345 });
    const b = new ShardBurst(0, 0, 1, { tier: 'high', seed: 12345 });
    expect(a.container.children.length).toBe(b.container.children.length);
    a.destroy();
    b.destroy();
  });

  it('같은 seed → 적분 후 배치가 완전히 동일하다', () => {
    const a = positionsAfter(999, 4);
    const b = positionsAfter(999, 4);
    expect(a).toEqual(b);
    // 파티클이 origin 을 실제로 벗어났는지(적분이 돌았는지) 확인 — 전부 (0,0) 이면 무의미한 비교.
    const moved = a.some(([x, y]) => Math.abs(x) > 0.001 || Math.abs(y) > 0.001);
    expect(moved, '적분 후 파티클이 origin 을 벗어나야 유의미한 결정론 비교').toBe(true);
  });

  it('다른 seed → 적분 후 배치가 발산한다(시드가 실제로 무작위를 가른다)', () => {
    const a = positionsAfter(1, 4);
    const b = positionsAfter(2, 4);
    // 파티클 수는 같아도(시드 무관) 배치는 달라야 한다.
    expect(a.length).toBe(b.length);
    expect(a).not.toEqual(b);
  });
});
