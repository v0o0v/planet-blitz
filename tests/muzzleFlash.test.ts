/**
 * 머즐 플래시 단위 테스트 (Phase 4 — plan §AC-4.7; ADR-0031).
 *
 * `MuzzleFlash`([src/render/effects/muzzleFlash.ts])는 발사 순간 총구에서 아주 짧게 번쩍이는 가산(add)
 * 섬광이다. entityRenderer(발사 훅)가 총구 위치에 이걸 얹고 update(dt) 로 굴린다. 여기서는 그 소비
 * 계약을 헤드리스로 못박는다:
 *
 *  1. **동기 배선**: 생성 즉시 `container.children.length > 0`(절차적 Graphics 라 GL 없이도 성립).
 *  2. **방향 유무 불문 배선 성립**: angle 지정/미지정 둘 다 children>0(원뿔 vs 원형 스타버스트).
 *  3. **원샷 초단명**: `update(dt)` 반복 → 짧은 수명 뒤 false(급페이드). destroy() 무-throw·이중 안전.
 *  4. **결정론**: 같은 인자 두 인스턴스 → 같은 자식 수(Date/Math.random 무사용, 시드 LCG 고정).
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — PixiJS 는 렌더러 없이 import
 * 만 하므로 node 에서 그대로 돈다(tests/explosionEffect.test.ts 선례). 표시 객체 추가·파괴만 검증하고
 * 실제 픽셀 래스터화는 다루지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { MuzzleFlash } from '../src/render/effects/muzzleFlash.js';

// ---------------------------------------------------------------------------
// 1. 동기 배선 (AC-4.7 / AC-1.4 정신) — 목업이 아니라 실 표시 객체를 즉시 붙인다.
// ---------------------------------------------------------------------------

describe('MuzzleFlash 동기 배선', () => {
  it('생성 즉시 container 에 섬광 조각을 동기 추가한다(children>0)', () => {
    const flash = new MuzzleFlash(0, 0);
    expect(flash.container.children.length).toBeGreaterThan(0);
    flash.destroy();
  });

  it('container 를 총구 위치 (x,y) 에 놓는다(섬광 조각은 로컬 origin 기준)', () => {
    const flash = new MuzzleFlash(140, 96);
    expect(flash.container.position.x).toBe(140);
    expect(flash.container.position.y).toBe(96);
    flash.destroy();
  });

  it('scale 옵션이 baseScale 로 반영된다(첫 프레임 START_SCALE 미만으로 시작)', () => {
    // 시작 스케일 = baseScale * START_SCALE(0.55). scale=2 면 첫 페인트 스케일 ≈ 1.1.
    const flash = new MuzzleFlash(0, 0, undefined, { scale: 2 });
    expect(flash.container.scale.x).toBeGreaterThan(0);
    expect(flash.container.scale.x).toBeCloseTo(2 * 0.55, 5);
    flash.destroy();
  });

  it('scale 0/음수도 throw 없이 배선된다(방어 최소값)', () => {
    expect(() => {
      const a = new MuzzleFlash(0, 0, undefined, { scale: 0 });
      const b = new MuzzleFlash(0, 0, undefined, { scale: -3 });
      a.destroy();
      b.destroy();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. 방향 유무 — angle 지정(원뿔) / 미지정(원형 스타버스트) 둘 다 배선 성립.
// ---------------------------------------------------------------------------

describe('MuzzleFlash 방향 유무', () => {
  it('angle 지정 시 children>0 이고 container 가 그 각도로 회전한다', () => {
    const angle = Math.PI / 3;
    const flash = new MuzzleFlash(0, 0, angle);
    expect(flash.container.children.length).toBeGreaterThan(0);
    expect(flash.container.rotation).toBe(angle);
    flash.destroy();
  });

  it('angle 미지정 시 children>0 이고 무회전(무방향 원형 섬광)', () => {
    const flash = new MuzzleFlash(0, 0);
    expect(flash.container.children.length).toBeGreaterThan(0);
    expect(flash.container.rotation).toBe(0);
    flash.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. 원샷 초단명 — update 가 짧은 수명 뒤 false(급페이드), 그 후로도 계속 false.
// ---------------------------------------------------------------------------

describe('MuzzleFlash 원샷 초단명', () => {
  it('첫 프레임은 살아있고(true), 짧은 수명(~0.12s) 뒤 false 로 전환된다', () => {
    const flash = new MuzzleFlash(0, 0, 0);
    // 첫 프레임은 살아있어야 한다(true).
    expect(flash.update(0.05)).toBe(true);

    // 총 수명 ~0.12s. dt=0.05 로 몇 프레임 안에 만료(false)돼야 한다.
    let alive = true;
    let frames = 0;
    const MAX_FRAMES = 50; // 상한(무한 방어). 실제로는 <5프레임에 종료.
    while (alive && frames < MAX_FRAMES) {
      alive = flash.update(0.05);
      frames += 1;
    }
    expect(alive, 'update 가 결국 false 를 돌려줘야 한다(원샷 초단명)').toBe(false);
    expect(frames, '초단명이라 극소수 프레임 안에 종료해야 한다').toBeLessThan(MAX_FRAMES);

    // 종료 후 update 는 계속 false(재발화 없음).
    expect(flash.update(0.05)).toBe(false);
  });

  it('진행하면서 알파가 급페이드한다(초반 대비 후반이 더 투명)', () => {
    const flash = new MuzzleFlash(0, 0, 0);
    flash.update(0.02);
    const early = flash.container.alpha;
    flash.update(0.05);
    const late = flash.container.alpha;
    expect(late).toBeLessThan(early); // 급페이드 — 뒤로 갈수록 투명.
    flash.destroy();
  });

  it('큰 dt(탭 복귀 등)에도 순간 종료/throw 없이 정리된다', () => {
    const flash = new MuzzleFlash(50, 50, Math.PI, { scale: 1.5 });
    expect(() => {
      // MAX_DT(0.05) 로 클램프되므로 첫 dt=2 가 그대로 수명을 삼키지 않는다.
      expect(flash.update(2)).toBe(true);
      flash.update(2);
      flash.update(0.016);
    }).not.toThrow();
    flash.destroy();
  });
});

// ---------------------------------------------------------------------------
// 4. destroy 안전 — 중간/종료 후 destroy 무-throw, 이중 destroy 무해, 이후 update false.
// ---------------------------------------------------------------------------

describe('MuzzleFlash destroy 안전', () => {
  it('중간 진행 후 destroy() 해도 throw 없이 정리하고 이후 update 는 false', () => {
    const flash = new MuzzleFlash(0, 0, 0);
    flash.update(0.03); // 중간까지 진행
    expect(() => flash.destroy()).not.toThrow();
    expect(flash.update(0.05)).toBe(false);
  });

  it('이중 destroy() 도 무해하다', () => {
    const flash = new MuzzleFlash(0, 0);
    expect(() => {
      flash.destroy();
      flash.destroy();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. 결정론 — 같은 인자 두 인스턴스 → 같은 자식 수(Date/Math.random 무사용, 시드 LCG 고정).
// ---------------------------------------------------------------------------

describe('MuzzleFlash 결정론', () => {
  it('같은 인자(방향 섬광) → 같은 자식 수', () => {
    const a = new MuzzleFlash(0, 0, Math.PI / 4, { color: 0xff8800, scale: 1.5 });
    const b = new MuzzleFlash(0, 0, Math.PI / 4, { color: 0xff8800, scale: 1.5 });
    expect(a.container.children.length).toBe(b.container.children.length);
    a.destroy();
    b.destroy();
  });

  it('같은 인자(무방향 섬광) → 같은 자식 수', () => {
    const a = new MuzzleFlash(0, 0);
    const b = new MuzzleFlash(0, 0);
    expect(a.container.children.length).toBe(b.container.children.length);
    a.destroy();
    b.destroy();
  });
});
