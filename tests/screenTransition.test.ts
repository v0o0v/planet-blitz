/**
 * 균일 화면 전환(슬라이드 커튼) 단위 테스트 (Phase 5 — plan §AC-5.1; ADR-0031).
 *
 * `ScreenTransition`([src/render/screenTransition.ts])은 전 메타 화면 swap 을 하나의 슬라이드
 * 커튼으로 균일하게 덮는 render-only 프리미티브다. main.ts clearToMenu()(동기 swap)가 play() 를
 * 부르면 카툰나무 색판이 cover→hold→reveal 로 화면을 덮었다 드러낸다. 여기서 그 계약을 헤드리스로
 * 못박는다:
 *
 *  1. **순수 이징**: inline `easeInOutCubic` 경계(0→0·1→1)·단조·[0,1]·NaN 내성.
 *  2. **동기 배선**: play() → active true · container child>0 · visible true.
 *  3. **원샷 수명**: update 로 cover→reveal 진행 후 active false(1회 종료) · 종료 후 no-op.
 *  4. **재진입 안전**: 비재생 update no-op · play() 중복 호출이 child 를 늘리지 않음.
 *  5. **완전 덮힘**: cover 정점에서 coverage≈1 · onCovered 정확히 1회.
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — PixiJS 는 렌더러 없이 import
 * 만 하므로 node 에서 그대로 돈다(tests/damageNumber.test.ts 선례). 절차적 Graphics 라 표시 객체
 * 추가·이동만 검증하고 실제 래스터화는 다루지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { ScreenTransition, easeInOutCubic } from '../src/render/screenTransition.js';

/** cover→reveal 을 확실히 통과하도록 작은 dt 를 반복하며, 조건 충족 또는 상한까지 update. */
function advanceUntil(st: ScreenTransition, predicate: () => boolean, maxFrames = 400): number {
  let frames = 0;
  while (!predicate() && frames < maxFrames) {
    st.update(0.02);
    frames += 1;
  }
  return frames;
}

// ---------------------------------------------------------------------------
// 1. 순수 이징 — inline easeInOutCubic 계약.
// ---------------------------------------------------------------------------

describe('easeInOutCubic (inline 순수 진행 함수)', () => {
  it('경계를 고정한다: f(0)=0, f(1)=1', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it('[0,1] 구간에서 단조 증가한다', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = easeInOutCubic(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('출력이 항상 [0,1] 안이다(범위 밖 입력도 clamp)', () => {
    for (const t of [-1, -0.2, 0, 0.3, 0.5, 0.8, 1, 1.5, 3]) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('NaN 내성: NaN 입력은 유한값(0)으로 폴백한다', () => {
    expect(Number.isFinite(easeInOutCubic(NaN))).toBe(true);
    expect(easeInOutCubic(NaN)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. 동기 배선 — play() 가 커튼을 즉시 켠다.
// ---------------------------------------------------------------------------

describe('ScreenTransition 동기 배선', () => {
  it('생성자에서 색판을 동기 생성한다(children>0), 미재생 시엔 invisible', () => {
    const st = new ScreenTransition();
    expect(st.container.children.length).toBeGreaterThan(0);
    expect(st.active).toBe(false);
    expect(st.container.visible).toBe(false);
    st.destroy();
  });

  it('play() → active true · child>0 · visible true', () => {
    const st = new ScreenTransition();
    st.play();
    expect(st.active).toBe(true);
    expect(st.container.children.length).toBeGreaterThan(0);
    expect(st.container.visible).toBe(true);
    st.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. 원샷 수명 — cover→reveal 진행 후 active false, 종료 후 no-op.
// ---------------------------------------------------------------------------

describe('ScreenTransition 원샷 수명', () => {
  it('update 로 cover→reveal 을 진행하면 결국 active false(1회 종료)', () => {
    const st = new ScreenTransition();
    st.play();
    expect(st.active).toBe(true);

    const frames = advanceUntil(st, () => !st.active);
    expect(st.active, 'update 반복 후 전환이 종료돼야 한다').toBe(false);
    expect(frames, '유한 프레임 안에 종료(재발화 없음)').toBeLessThan(400);
    // 종료 후 커튼은 화면 밖 + invisible.
    expect(st.container.visible).toBe(false);
    st.destroy();
  });

  it('종료 후 update 는 계속 no-op(재발화 없음)', () => {
    const st = new ScreenTransition();
    st.play();
    advanceUntil(st, () => !st.active);
    expect(st.active).toBe(false);
    // 종료 후 추가 update 는 상태를 바꾸지 않는다.
    st.update(0.02);
    st.update(0.02);
    expect(st.active).toBe(false);
    st.destroy();
  });

  it('큰 dt(탭 복귀 등)에도 throw 없이 진행·종료한다', () => {
    const st = new ScreenTransition();
    st.play();
    expect(() => {
      st.update(2); // MAX_DT 로 클램프
      st.update(2);
      st.update(0.016);
    }).not.toThrow();
    // 큰 dt 를 여러 번 주면 결국 종료.
    advanceUntil(st, () => !st.active);
    expect(st.active).toBe(false);
    st.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. 재진입 안전 — 비재생 no-op · play() 멱등.
// ---------------------------------------------------------------------------

describe('ScreenTransition 재진입 안전', () => {
  it('비재생 상태의 update 는 no-op(active·visible 불변)', () => {
    const st = new ScreenTransition();
    expect(st.active).toBe(false);
    const x0 = st.container.x;
    st.update(0.5);
    st.update(0.5);
    expect(st.active).toBe(false);
    expect(st.container.visible).toBe(false);
    expect(st.container.x).toBe(x0); // 위치도 그대로
    st.destroy();
  });

  it('play() 중복 호출이 색판을 중복 생성하지 않는다(child 수 불변, 처음부터 재시작)', () => {
    const st = new ScreenTransition();
    st.play();
    const n = st.container.children.length;
    // 조금 진행시켜 elapsed 를 쌓은 뒤 다시 play → 처음부터 재시작하되 child 는 안 늘어야 한다.
    st.update(0.1);
    st.play();
    expect(st.container.children.length).toBe(n);
    expect(st.active).toBe(true);
    // 재시작 직후엔 cover 초반(아직 완전 덮힘 전).
    expect(st.coverage).toBeLessThan(1);
    st.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. 완전 덮힘 — cover 정점에서 커튼이 실제로 화면을 덮고, onCovered 는 1회.
// ---------------------------------------------------------------------------

describe('ScreenTransition 완전 덮힘 · onCovered', () => {
  it('cover 정점에서 coverage 가 ≈1(화면 전폭을 덮는다)', () => {
    const st = new ScreenTransition();
    st.play();
    // coverage 가 완전 덮힘에 도달할 때까지 진행.
    advanceUntil(st, () => st.coverage >= 0.999);
    expect(st.coverage).toBeGreaterThanOrEqual(0.999);
    expect(st.active, '완전 덮힘 시점엔 아직 재생 중이어야 한다').toBe(true);
    st.destroy();
  });

  it('시작 직후(cover 초반)엔 아직 덜 덮혀 있다(coverage<1)', () => {
    const st = new ScreenTransition();
    st.play();
    expect(st.coverage).toBeLessThan(1);
    st.destroy();
  });

  it('onCovered 콜백은 완전 덮힘에 정확히 1회만 호출된다', () => {
    const st = new ScreenTransition();
    let calls = 0;
    let coverageAtCall = -1;
    st.play(() => {
      calls += 1;
      coverageAtCall = st.coverage;
    });
    // 아직 cover 전이라 호출 안 됐어야 한다.
    expect(calls).toBe(0);
    advanceUntil(st, () => !st.active);
    expect(calls, 'onCovered 는 전환당 정확히 1회').toBe(1);
    expect(coverageAtCall, 'onCovered 발화 시점엔 완전히 덮여 있어야(swap 은닉)').toBeGreaterThanOrEqual(
      0.999,
    );
    st.destroy();
  });
});

// ---------------------------------------------------------------------------
// 6. 파괴 — throw 없이 정리, 이중 destroy·이후 update 안전.
// ---------------------------------------------------------------------------

describe('ScreenTransition 파괴 안전', () => {
  it('destroy() 는 throw 없이 정리하고 이중 호출·이후 update 가 안전하다', () => {
    const st = new ScreenTransition();
    st.play();
    st.update(0.1);
    expect(() => st.destroy()).not.toThrow();
    // 파괴 후 update 는 no-op, coverage 는 0, active false.
    expect(() => st.update(0.02)).not.toThrow();
    expect(st.active).toBe(false);
    expect(st.coverage).toBe(0);
    // 이중 destroy 무해.
    expect(() => st.destroy()).not.toThrow();
  });
});
