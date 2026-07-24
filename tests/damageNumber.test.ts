/**
 * 데미지 숫자 팝업 단위 테스트 (Phase 4 — plan §AC-4.1; ADR-0031).
 *
 * `DamageNumber`([src/render/effects/damageNumber.ts])는 적 피격 시 HP 델타를 위치에 띄우는 원샷
 * 팝업이다. entityRenderer(배선 레인)가 피격 이벤트에서 이걸 생성한다. 여기서는 그 소비 계약을
 * 헤드리스로 못박는다:
 *
 *  1. **동기 배선**: 생성 즉시 `container.children.length > 0`(7-세그 절차적 Graphics 라 GL 없이 성립).
 *  2. **원샷 수명**: `update(dt)` 반복 → 결국 false(수명 종료). destroy() 무-throw + 이중 호출 안전.
 *  3. **자릿수 렌더**: 여러 자릿수는 글리프 수·폭이 자릿수에 비례. 0 이하도 최소 한 글자(children>0).
 *  4. **결정론**: 같은 (x,y,amount) → 같은 글리프 수 + 같은 배치(무작위 미사용).
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — PixiJS 는 렌더러 없이 import
 * 만 하므로 node 에서 그대로 돈다(tests/explosionEffect.test.ts 선례). 표시 객체 추가·파괴만
 * 검증하고 실제 픽셀 래스터화는 다루지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { DamageNumber } from '../src/render/effects/damageNumber.js';

/** 글리프들의 로컬 X 스팬(가장 오른쪽 - 가장 왼쪽). 자릿수가 늘수록 커진다(폭 프록시, GL 불필요). */
function glyphSpan(dn: DamageNumber): number {
  const xs = dn.container.children.map((c) => c.position.x);
  if (xs.length === 0) return 0;
  return Math.max(...xs) - Math.min(...xs);
}

// ---------------------------------------------------------------------------
// 1. 동기 배선 — 목업이 아니라 실 글리프 Graphics 를 즉시 붙인다.
// ---------------------------------------------------------------------------

describe('DamageNumber 동기 배선', () => {
  it('생성 즉시 container 에 글리프를 동기 추가한다(children>0)', () => {
    const dn = new DamageNumber(0, 0, 42);
    expect(dn.container.children.length).toBeGreaterThan(0);
    dn.destroy();
  });

  it('container 를 팝업 지점 (x,y) 에 놓는다', () => {
    const dn = new DamageNumber(120, 80, 7);
    expect(dn.container.position.x).toBe(120);
    expect(dn.container.position.y).toBe(80);
    dn.destroy();
  });

  it('치명타는 일반보다 초기 스케일이 크다(강조)', () => {
    const normal = new DamageNumber(0, 0, 50);
    const crit = new DamageNumber(0, 0, 50, { crit: true });
    expect(crit.container.scale.x).toBeGreaterThan(normal.container.scale.x);
    normal.destroy();
    crit.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. 원샷 수명 — update 가 결국 false 를 돌려주고, destroy 는 언제 불러도 안전.
// ---------------------------------------------------------------------------

describe('DamageNumber 원샷 수명', () => {
  it('update 를 반복하면 결국 false(수명 종료)를 돌려준다', () => {
    const dn = new DamageNumber(0, 0, 999);

    // 첫 프레임은 살아있어야 한다(true).
    expect(dn.update(0.05)).toBe(true);

    let alive = true;
    let frames = 0;
    const MAX_FRAMES = 200; // ≈10초 상한(무한 방어). 실제로는 수명 0.8초라 <20프레임에 종료.
    while (alive && frames < MAX_FRAMES) {
      alive = dn.update(0.05);
      frames += 1;
    }

    expect(alive, 'update 가 결국 false 를 돌려줘야 한다(원샷 종료)').toBe(false);
    expect(frames, '재발화 없이 유한 프레임 안에 종료해야 한다').toBeLessThan(MAX_FRAMES);

    // 종료 후 update 는 계속 false(재발화 없음).
    expect(dn.update(0.05)).toBe(false);
    dn.destroy();
  });

  it('상승하면서(Y 감소) 페이드한다', () => {
    const dn = new DamageNumber(0, 100, 25);
    const y0 = dn.container.position.y;
    const a0 = dn.container.alpha;
    // 수명 후반까지 진행(HOLD_FRAC 이후 페이드 구간에 확실히 들어가게).
    for (let i = 0; i < 12; i++) dn.update(0.05);
    expect(dn.container.position.y, '위로 상승 → Y 가 줄어야 한다').toBeLessThan(y0);
    expect(dn.container.alpha, '후반부엔 알파가 초기보다 낮아야 한다').toBeLessThan(a0);
    dn.destroy();
  });

  it('큰 dt(탭 복귀 등)에도 throw 없이 종료된다', () => {
    const dn = new DamageNumber(50, 50, 1234);
    expect(() => {
      dn.update(2); // MAX_DT 로 클램프돼야 함
      dn.update(2);
      dn.update(0.016);
    }).not.toThrow();
    dn.destroy();
  });

  it('중간 어느 지점에서 destroy() 해도 throw 없이 정리하고, 이중 destroy 도 무해', () => {
    const dn = new DamageNumber(0, 0, 88);
    for (let i = 0; i < 3; i++) dn.update(0.05); // 중간까지 진행
    expect(() => dn.destroy()).not.toThrow();
    // destroy 이후 update 는 안전하게 false.
    expect(dn.update(0.05)).toBe(false);
    // 이중 destroy 도 무해.
    expect(() => dn.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. 자릿수 렌더 — 글리프 수·폭이 자릿수에 비례. 0 이하는 최소 한 글자.
// ---------------------------------------------------------------------------

describe('DamageNumber 자릿수 렌더', () => {
  it('여러 자릿수(1234)는 글리프 수가 자릿수만큼(4)이고 children>0', () => {
    const dn = new DamageNumber(0, 0, 1234);
    expect(dn.container.children.length).toBe(4);
    dn.destroy();
  });

  it('한 자릿수 vs 네 자릿수 — 글리프 수·폭이 대략 자릿수에 비례', () => {
    const one = new DamageNumber(0, 0, 5); // "5" → 1 글리프
    const four = new DamageNumber(0, 0, 1234); // "1234" → 4 글리프

    // 글리프 수: 4 vs 1.
    expect(one.container.children.length).toBe(1);
    expect(four.container.children.length).toBe(4);
    expect(four.container.children.length).toBeGreaterThan(one.container.children.length);

    // 폭 프록시(글리프 스팬): 한 자릿수는 0(중앙 1개), 네 자릿수는 확연히 넓다.
    expect(glyphSpan(one)).toBe(0);
    expect(glyphSpan(four)).toBeGreaterThan(glyphSpan(one));

    one.destroy();
    four.destroy();
  });

  it('amount 를 정수로 반올림해 그린다(7.6 → "8", 1 글리프)', () => {
    const dn = new DamageNumber(0, 0, 7.6);
    expect(dn.container.children.length).toBe(1);
    dn.destroy();
  });

  it('0 이하(0·음수)도 최소 한 글자를 그려 children>0 을 유지한다', () => {
    const zero = new DamageNumber(0, 0, 0);
    const neg = new DamageNumber(0, 0, -5);
    expect(zero.container.children.length).toBeGreaterThan(0);
    expect(neg.container.children.length).toBeGreaterThan(0);
    zero.destroy();
    neg.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. 결정론 — 같은 (x,y,amount) → 같은 글리프 수 + 같은 배치(무작위 미사용).
// ---------------------------------------------------------------------------

describe('DamageNumber 결정론', () => {
  it('같은 (x,y,amount) 두 인스턴스는 같은 글리프 수를 갖는다', () => {
    const a = new DamageNumber(10, 20, 777);
    const b = new DamageNumber(10, 20, 777);
    expect(a.container.children.length).toBe(b.container.children.length);
    a.destroy();
    b.destroy();
  });

  it('같은 입력 → 글리프 배치(로컬 X)도 완전히 동일하다', () => {
    const a = new DamageNumber(0, 0, 1234);
    const b = new DamageNumber(0, 0, 1234);
    const xsA = a.container.children.map((c) => c.position.x);
    const xsB = b.container.children.map((c) => c.position.x);
    expect(xsA).toEqual(xsB);
    a.destroy();
    b.destroy();
  });
});
