/**
 * 탄 트레일 단위 테스트 (Phase 4 — plan §AC-4.4; ADR-0031).
 *
 * `bulletTrail.ts`([src/render/effects/bulletTrail.ts])는 탄 뒤에 짧은 가산 스트릭 꼬리를 남기는
 * render-only 이펙트다. 두 계약을 헤드리스로 못박는다:
 *
 *  1. **{@link isTrailBullet} 대상 판정(순수)**: 플레이어 탄=항상, 특수 거동 적탄=허용, 순수 직진
 *     잡몹탄(behavior=-1)=제외, 탄이 아니면 제외. 경계 전수.
 *  2. **{@link BulletTrail} 수명·배선**: 생성 즉시 children>0, 위치를 먹이면 살아있음(true), 좌표
 *     없이 계속 update 하면 잔상 페이드 후 false, destroy 이중 안전, 결정론(같은 시퀀스→같은 상태).
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — PixiJS 는 렌더러 없이
 * import 만 하므로 node 에서 그대로 돈다(tests/explosionEffect.test.ts 선례). 표시 객체 추가·파괴와
 * 히스토리 상태만 검증하고 실제 픽셀 래스터화는 다루지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { BulletTrail, isTrailBullet } from '../src/render/effects/bulletTrail.js';

// ---------------------------------------------------------------------------
// 1. isTrailBullet — 트레일 대상 판정(순수·render-only). 경계 전수.
// ---------------------------------------------------------------------------

describe('isTrailBullet', () => {
  it('플레이어 탄(kind=bullet)은 behavior 무관 항상 true', () => {
    expect(isTrailBullet('bullet', -1)).toBe(true);
    expect(isTrailBullet('bullet', 0)).toBe(true);
    expect(isTrailBullet('bullet', 3)).toBe(true);
  });

  it('적탄 순수 직진(behavior=-1, BK_NONE)은 false — 조밀 잡몹 직진탄 제외', () => {
    expect(isTrailBullet('enemyBullet', -1)).toBe(false);
  });

  it('적탄 특수 거동(behavior 0/1/2/3 = ACCEL/HOMING/CURVE/SPLIT)은 전부 true', () => {
    expect(isTrailBullet('enemyBullet', 0)).toBe(true); // BK_ACCEL
    expect(isTrailBullet('enemyBullet', 1)).toBe(true); // BK_HOMING
    expect(isTrailBullet('enemyBullet', 2)).toBe(true); // BK_CURVE
    expect(isTrailBullet('enemyBullet', 3)).toBe(true); // BK_SPLIT
  });

  it('탄이 아닌 kind(gem·enemy·loot·player)는 전부 false', () => {
    expect(isTrailBullet('gem', 0)).toBe(false);
    expect(isTrailBullet('enemy', -1)).toBe(false);
    expect(isTrailBullet('loot', 3)).toBe(false);
    expect(isTrailBullet('player', 0)).toBe(false);
    expect(isTrailBullet('', 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. BulletTrail 동기 배선 — 생성 즉시 실 표시 객체를 붙인다(children>0).
// ---------------------------------------------------------------------------

describe('BulletTrail 동기 배선', () => {
  it('생성 즉시 container 에 스트릭을 동기 추가한다(children>0)', () => {
    const trail = new BulletTrail();
    expect(trail.container.children.length).toBeGreaterThan(0);
    trail.destroy();
  });

  it('container 는 origin(0,0) 고정(점은 월드 절대 좌표라 위치 이동 없음)', () => {
    const trail = new BulletTrail();
    expect(trail.container.position.x).toBe(0);
    expect(trail.container.position.y).toBe(0);
    trail.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. 수명 — 위치를 먹이면 살아있음(true), 좌표 없이 계속 update 하면 잔상 페이드 후 false.
// ---------------------------------------------------------------------------

describe('BulletTrail 수명', () => {
  it('update(dt, x, y) 를 여러 위치로 먹이면 살아있음(true)이고 히스토리가 쌓인다', () => {
    const trail = new BulletTrail();
    // 탄이 오른쪽으로 이동하는 궤적.
    expect(trail.update(0.016, 0, 0)).toBe(true);
    expect(trail.update(0.016, 10, 0)).toBe(true);
    expect(trail.update(0.016, 20, 0)).toBe(true);
    expect(trail.update(0.016, 30, 0)).toBe(true);
    // 위치를 계속 먹이면 살아 있고 히스토리 점이 여럿 쌓인다.
    expect(trail.pointCount).toBeGreaterThan(1);
    trail.destroy();
  });

  it('좌표 없이 계속 update 하면 잔상이 페이드하다 결국 false(소멸)로 전환된다', () => {
    const trail = new BulletTrail();
    // 먼저 궤적을 몇 프레임 먹여 꼬리를 만든다.
    for (let i = 0; i < 5; i++) trail.update(0.016, i * 10, 0);
    expect(trail.pointCount).toBeGreaterThan(0);

    // 이제 탄이 죽어 좌표를 안 준다 — 잔상만 페이드. 유한 프레임 안에 false 로 소멸해야 한다.
    let alive = true;
    let frames = 0;
    const MAX_FRAMES = 200; // ≈3초 상한(무한 방어). 실제로는 <20프레임에 소멸.
    while (alive && frames < MAX_FRAMES) {
      alive = trail.update(0.016);
      frames += 1;
    }

    expect(alive, '좌표 없이 update 하면 결국 false 로 소멸해야 한다').toBe(false);
    expect(frames, '재발화 없이 유한 프레임 안에 소멸해야 한다').toBeLessThan(MAX_FRAMES);
    expect(trail.pointCount, '소멸 시점 히스토리 점 잔여').toBe(0);

    // 소멸 후 update 는 계속 false(재발화 없음).
    expect(trail.update(0.016)).toBe(false);
    trail.destroy();
  });

  it('처음부터 좌표 없이 update 하면(트레일 대상 아님) 즉시 false — 그릴 게 없다', () => {
    const trail = new BulletTrail();
    expect(trail.update(0.016)).toBe(false);
    expect(trail.pointCount).toBe(0);
    trail.destroy();
  });

  it('큰 dt(탭 복귀 등)에도 순간 소멸/throw 없이 클램프되어 진행된다', () => {
    const trail = new BulletTrail();
    expect(() => {
      trail.update(2, 0, 0); // MAX_DT 로 클램프돼야 함
      trail.update(2, 10, 0);
      trail.update(0.016, 20, 0);
    }).not.toThrow();
    // 큰 dt 를 클램프하므로 한 프레임에 전부 만료되지 않고 살아 있다.
    expect(trail.pointCount).toBeGreaterThan(0);
    trail.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. 티어 상한 — Low 꼬리(점 수 상한)가 High 보다 짧다.
// ---------------------------------------------------------------------------

describe('BulletTrail 티어 상한', () => {
  it('Low 는 High 보다 히스토리 점 상한이 작다(꼬리가 짧다)', () => {
    const low = new BulletTrail({ tier: 'low' });
    const high = new BulletTrail({ tier: 'high' });
    // 긴 궤적을 먹여 각자의 상한까지 채운다(수명 내에 상한 도달하도록 dt 작게).
    for (let i = 0; i < 30; i++) {
      low.update(0.001, i, 0);
      high.update(0.001, i, 0);
    }
    expect(low.pointCount).toBeLessThan(high.pointCount);
    low.destroy();
    high.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. destroy 이중 안전 — 중간/이중 destroy 무-throw, 이후 update 안전.
// ---------------------------------------------------------------------------

describe('BulletTrail destroy 안전', () => {
  it('중간에 destroy() 해도 throw 없이 정리하고 이후 update 는 false', () => {
    const trail = new BulletTrail();
    for (let i = 0; i < 3; i++) trail.update(0.016, i * 10, 0);
    expect(() => trail.destroy()).not.toThrow();

    // destroy 이후 update 는 안전하게 false.
    expect(trail.update(0.016, 100, 0)).toBe(false);
    // 이중 destroy 도 무해.
    expect(() => trail.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. 결정론 — 같은 위치 시퀀스 → 같은 상태(점 수 추이 + 소멸 프레임). 무작위 없음.
// ---------------------------------------------------------------------------

/** 같은 궤적을 먹인 뒤 좌표 없이 소멸까지 돌려, 각 프레임의 점 수 추이를 기록한다. */
function pointCountTrace(): number[] {
  const trail = new BulletTrail({ tier: 'high' });
  const trace: number[] = [];
  // 결정적 궤적(위치 히스토리라 무작위 불필요).
  const path: Array<[number, number]> = [
    [0, 0],
    [12, 3],
    [25, 9],
    [40, 18],
    [58, 30],
    [79, 45],
  ];
  for (const [x, y] of path) {
    trail.update(0.016, x, y);
    trace.push(trail.pointCount);
  }
  // 탄 사망 후 소멸까지 잔상 페이드 추이.
  let alive = true;
  let guard = 0;
  while (alive && guard < 200) {
    alive = trail.update(0.016);
    trace.push(trail.pointCount);
    guard += 1;
  }
  trail.destroy();
  return trace;
}

describe('BulletTrail 결정론', () => {
  it('같은 위치 시퀀스 → 같은 점 수 추이 + 같은 소멸 프레임(무작위 없음)', () => {
    const a = pointCountTrace();
    const b = pointCountTrace();
    expect(a).toEqual(b);
    // 궤적이 실제로 점을 쌓았고 결국 0 으로 소멸했는지(유의미한 비교) 확인.
    expect(Math.max(...a), '궤적이 점을 쌓아야 함').toBeGreaterThan(1);
    expect(a[a.length - 1], '결국 0 으로 소멸해야 함').toBe(0);
  });
});
