/**
 * 그레이징 스파크 단위 테스트 (Phase 4 — plan §AC-4.5; ADR-0031).
 *
 * `src/render/effects/grazeSpark.ts` 의 세 계약을 헤드리스로 못박는다:
 *
 *  1. {@link isGraze} — 순수 근접 회피 판정. 판정점 안(실충돌)=false, 근접 대역 안=true,
 *     대역 밖=false. 경계값·NaN·음수 방어 전수.
 *  2. {@link GrazeTracker} — 탄 id 별 rising-edge 1회 발화. 첫 진입=true, 연속 그레이징=false,
 *     벗어났다 재진입=true, forget/reset 후 초기화.
 *  3. {@link GrazeSpark} — 원샷 스파크 버스트. 생성 즉시 children>0, update 수명 후 false,
 *     destroy 안전, 같은 seed→같은 children 수(결정론).
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — PixiJS 는 렌더러 없이
 * import 만 하므로 node 에서 그대로 돈다(explosionEffect.test.ts 선례). 표시 객체 추가·파괴만
 * 검증하고 실제 픽셀 래스터화는 다루지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { isGraze, GrazeTracker, GrazeSpark } from '../src/render/effects/grazeSpark.js';

// ---------------------------------------------------------------------------
// 1. isGraze — 순수 근접 회피 판정.
// ---------------------------------------------------------------------------

describe('isGraze 근접 회피 판정', () => {
  // 아군 (0,0) r=10, 탄 r=2 → contact = 12. band=6 → outer = 18.
  const px = 0;
  const py = 0;
  const pr = 10;
  const br = 2;
  const band = 6;

  it('판정점 안(dist < pr+br)은 스침이 아니라 맞음 → false', () => {
    // dist = 5 < 12(contact).
    expect(isGraze(px, py, pr, 5, 0, br, band)).toBe(false);
  });

  it('근접 대역 안(contact < dist ≤ outer)은 스침 → true', () => {
    // dist = 15 (12 < 15 ≤ 18).
    expect(isGraze(px, py, pr, 15, 0, br, band)).toBe(true);
  });

  it('근접 대역 밖(dist > outer)은 멀어서 → false', () => {
    // dist = 25 > 18(outer).
    expect(isGraze(px, py, pr, 25, 0, br, band)).toBe(false);
  });

  it('경계: dist == pr+br(contact 정확히)는 판정점 안으로 처리 → false', () => {
    // dist = 12 == contact. (pr+br < dist 가 거짓)
    expect(isGraze(px, py, pr, 12, 0, br, band)).toBe(false);
  });

  it('경계: dist == pr+br+band(outer 정확히)는 대역 안(포함) → true', () => {
    // dist = 18 == outer. (dist <= outer 가 참)
    expect(isGraze(px, py, pr, 18, 0, br, band)).toBe(true);
  });

  it('경계 바로 안쪽(contact + 아주 조금)은 → true', () => {
    expect(isGraze(px, py, pr, 12.0001, 0, br, band)).toBe(true);
  });

  it('경계 바로 바깥쪽(outer + 아주 조금)은 → false', () => {
    expect(isGraze(px, py, pr, 18.0001, 0, br, band)).toBe(false);
  });

  it('대각 거리도 hypot 으로 정확히 판정한다', () => {
    // (9,12) → dist = 15 (3-4-5 배수). 12 < 15 ≤ 18 → true.
    expect(isGraze(px, py, pr, 9, 12, br, band)).toBe(true);
  });

  it('band=0 이면 스침 대역이 없어 항상 false(대역폭 0)', () => {
    // outer == contact 라 contact < dist ≤ contact 는 성립 불가.
    expect(isGraze(px, py, pr, 15, 0, br, 0)).toBe(false);
    expect(isGraze(px, py, pr, 12, 0, br, 0)).toBe(false);
  });

  it('NaN 인자는 방어적으로 false(항상 boolean)', () => {
    expect(isGraze(NaN, 0, pr, 15, 0, br, band)).toBe(false);
    expect(isGraze(px, py, NaN, 15, 0, br, band)).toBe(false);
    expect(isGraze(px, py, pr, 15, 0, br, NaN)).toBe(false);
    expect(isGraze(px, py, pr, Infinity, 0, br, band)).toBe(false);
  });

  it('음수 반경/대역은 방어적으로 false', () => {
    expect(isGraze(px, py, -1, 15, 0, br, band)).toBe(false);
    expect(isGraze(px, py, pr, 15, 0, -1, band)).toBe(false);
    expect(isGraze(px, py, pr, 15, 0, br, -1)).toBe(false);
  });

  it('반환은 항상 boolean 타입', () => {
    expect(typeof isGraze(px, py, pr, 15, 0, br, band)).toBe('boolean');
    expect(typeof isGraze(NaN, py, pr, 15, 0, br, band)).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// 2. GrazeTracker — 탄 id 별 rising-edge 1회 발화.
// ---------------------------------------------------------------------------

describe('GrazeTracker rising-edge 1회 발화', () => {
  it('첫 그레이징 진입은 발화(true)', () => {
    const t = new GrazeTracker();
    expect(t.shouldSpark(1, true)).toBe(true);
  });

  it('여러 프레임 연속 그레이징 → 첫 프레임만 true', () => {
    const t = new GrazeTracker();
    expect(t.shouldSpark(1, true)).toBe(true);
    expect(t.shouldSpark(1, true)).toBe(false);
    expect(t.shouldSpark(1, true)).toBe(false);
  });

  it('비-그레이징으로 벗어났다 재진입하면 다시 true', () => {
    const t = new GrazeTracker();
    expect(t.shouldSpark(1, true)).toBe(true); // 진입
    expect(t.shouldSpark(1, true)).toBe(false); // 연속
    expect(t.shouldSpark(1, false)).toBe(false); // 이탈
    expect(t.shouldSpark(1, true)).toBe(true); // 재진입 → 다시 rising-edge
  });

  it('비-그레이징 상태에서 호출은 계속 false', () => {
    const t = new GrazeTracker();
    expect(t.shouldSpark(1, false)).toBe(false);
    expect(t.shouldSpark(1, false)).toBe(false);
  });

  it('탄 id 별로 독립 추적한다', () => {
    const t = new GrazeTracker();
    expect(t.shouldSpark(1, true)).toBe(true);
    expect(t.shouldSpark(2, true)).toBe(true); // 다른 탄은 별개
    expect(t.shouldSpark(1, true)).toBe(false); // 1 은 연속
    expect(t.shouldSpark(2, true)).toBe(false); // 2 도 연속
  });

  it('forget 후 재진입하면 다시 true(상태 제거)', () => {
    const t = new GrazeTracker();
    expect(t.shouldSpark(1, true)).toBe(true);
    expect(t.shouldSpark(1, true)).toBe(false); // 연속
    t.forget(1);
    expect(t.shouldSpark(1, true)).toBe(true); // forget 으로 리셋됨 → rising-edge
  });

  it('reset 후 전체 초기화된다', () => {
    const t = new GrazeTracker();
    t.shouldSpark(1, true);
    t.shouldSpark(2, true);
    t.reset();
    expect(t.shouldSpark(1, true)).toBe(true); // 초기화 → 다시 rising-edge
    expect(t.shouldSpark(2, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. GrazeSpark — 원샷 스파크 버스트.
// ---------------------------------------------------------------------------

describe('GrazeSpark 동기 배선', () => {
  it('생성 즉시 container 에 스파크를 동기 추가한다(children>0)', () => {
    const s = new GrazeSpark(0, 0);
    expect(s.container.children.length).toBeGreaterThan(0);
    s.destroy();
  });

  it('container 를 스침 지점 (x,y) 에 놓는다', () => {
    const s = new GrazeSpark(120, 80);
    expect(s.container.position.x).toBe(120);
    expect(s.container.position.y).toBe(80);
    s.destroy();
  });

  it('어느 티어든 최소 1개 이상 스파크가 있다(children>0 보장)', () => {
    for (const tier of ['low', 'med', 'high'] as const) {
      const s = new GrazeSpark(0, 0, { tier });
      expect(s.container.children.length).toBeGreaterThan(0);
      s.destroy();
    }
  });
});

describe('GrazeSpark 원샷 수명', () => {
  it('update 를 반복하면 결국 false(전멸)를 돌려주고 스파크를 정리한다', () => {
    const s = new GrazeSpark(0, 0);
    expect(s.container.children.length).toBeGreaterThan(0);
    expect(s.update(0.05)).toBe(true); // 첫 프레임은 살아있음

    let alive = true;
    let frames = 0;
    const MAX_FRAMES = 200; // 무한 방어. 실제로는 <10프레임에 전멸(~0.3s 수명).
    while (alive && frames < MAX_FRAMES) {
      alive = s.update(0.05);
      frames += 1;
    }

    expect(alive, 'update 가 결국 false 를 돌려줘야 한다(원샷 전멸)').toBe(false);
    expect(frames, '재발화 없이 유한 프레임 안에 전멸해야 한다').toBeLessThan(MAX_FRAMES);
    expect(s.container.children.length, '전멸 시점 스파크 잔여').toBe(0);
    expect(s.update(0.05), '전멸 후 update 는 계속 false').toBe(false);
  });

  it('중간·전멸 후 어느 지점에서 destroy() 해도 throw 없이 정리한다', () => {
    const s = new GrazeSpark(0, 0);
    for (let i = 0; i < 3; i++) s.update(0.05);
    expect(() => s.destroy()).not.toThrow();
    expect(s.update(0.05)).toBe(false); // destroy 후 안전하게 false
    expect(() => s.destroy()).not.toThrow(); // 이중 destroy 무해
  });

  it('큰 dt(탭 복귀 등)에도 throw 없이 정리된다', () => {
    const s = new GrazeSpark(50, 50);
    expect(() => {
      s.update(2); // MAX_DT 로 클램프돼야 함
      s.update(0.016);
    }).not.toThrow();
    s.destroy();
  });
});

describe('GrazeSpark 결정론', () => {
  it('같은 seed·tier → 같은 스파크 수', () => {
    const a = new GrazeSpark(0, 0, { tier: 'high', seed: 12345 });
    const b = new GrazeSpark(0, 0, { tier: 'high', seed: 12345 });
    expect(a.container.children.length).toBe(b.container.children.length);
    a.destroy();
    b.destroy();
  });

  it('같은 seed → 적분 후 배치가 완전히 동일하다', () => {
    const snap = (seed: number): Array<[number, number]> => {
      const s = new GrazeSpark(0, 0, { tier: 'high', seed });
      for (let i = 0; i < 3; i++) s.update(0.03);
      const pts = s.container.children.map(
        (c) => [c.position.x, c.position.y] as [number, number],
      );
      s.destroy();
      return pts;
    };
    const a = snap(777);
    const b = snap(777);
    expect(a).toEqual(b);
    // 적분이 실제로 돌아 origin 을 벗어났는지 확인(전부 (0,0) 이면 무의미한 비교).
    const moved = a.some(([x, y]) => Math.abs(x) > 0.001 || Math.abs(y) > 0.001);
    expect(moved, '적분 후 스파크가 origin 을 벗어나야 유의미한 결정론 비교').toBe(true);
  });

  it('Low 스파크 수 ≤ High 스파크 수(단조 상한)', () => {
    const low = new GrazeSpark(0, 0, { tier: 'low', seed: 7 });
    const high = new GrazeSpark(0, 0, { tier: 'high', seed: 7 });
    expect(low.container.children.length).toBeLessThanOrEqual(high.container.children.length);
    low.destroy();
    high.destroy();
  });
});
