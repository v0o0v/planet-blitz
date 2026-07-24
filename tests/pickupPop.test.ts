/**
 * 젬/전리품 수집 팝 + 레벨업 링 단위 테스트 (Phase 4 — plan §AC-4.6; ADR-0031).
 *
 * `PickupPop`·`LevelUpRing`([src/render/effects/pickupPop.ts])은 수집·성장 순간의 짧은 가산 축하 FX
 * 다(폭발 ShardBurst 의 자매 모듈). entityRenderer(Wave-wire)가 젬/전리품 수집·레벨업 시 effectLayer
 * 에 하나 붙이고 update 가 false 를 돌려줄 때 떼어낸다. 여기서는 그 소비 계약을 헤드리스로 못박는다:
 *
 *  1. **동기 배선**: 생성 즉시 `container.children.length > 0`(절차적 Graphics 라 GL 없이도 성립).
 *  2. **원샷 수명**: `update(dt)` 반복 → 결국 false(수명 만료) + 그 시점 원소 정리. destroy() 무-throw.
 *  3. **확장**: 중간 프레임 로컬 bounds 가 초기보다 커진다(코어/링/반경이 실제로 부푼다).
 *  4. **결정론**: 같은 인자 두 인스턴스 → 같은 children 수(무작위 자체가 없어 자명).
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — PixiJS 는 렌더러 없이 import
 * 만 하므로 node 에서 그대로 돈다(tests/explosionEffect.test.ts·glowEffect.test.ts 선례). 절차적
 * Graphics geometry 의 `getLocalBounds()` 는 GL 없이 CPU 로 산출된다(glowEffect 선례). 표시 객체
 * 추가·파괴·bounds 산출만 검증하고 실제 픽셀 래스터화는 다루지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { PickupPop, LevelUpRing } from '../src/render/effects/pickupPop.js';

// ===========================================================================
// PickupPop
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. 동기 배선 (AC-4.6 / AC-1.4 정신) — 목업이 아니라 실 표시 객체를 즉시 붙인다.
// ---------------------------------------------------------------------------

describe('PickupPop 동기 배선', () => {
  it('생성 즉시 container 에 원소를 동기 추가한다(children>0)', () => {
    const pop = new PickupPop(0, 0);
    expect(pop.container.children.length).toBeGreaterThan(0);
    pop.destroy();
  });

  it('container 를 수집 지점 (x,y) 에 놓고 scale 로 확대한다', () => {
    const pop = new PickupPop(90, 40, { scale: 2 });
    expect(pop.container.position.x).toBe(90);
    expect(pop.container.position.y).toBe(40);
    expect(pop.container.scale.x).toBe(2);
    expect(pop.container.scale.y).toBe(2);
    pop.destroy();
  });

  it('color 를 주입해도 안전하게 생성된다(children>0)', () => {
    const pop = new PickupPop(0, 0, { color: 0x00ff88 });
    expect(pop.container.children.length).toBeGreaterThan(0);
    pop.destroy();
  });
});

// ---------------------------------------------------------------------------
// 2. 원샷 수명 — update 가 결국 false 를 돌려주고, 그 시점 원소가 전부 정리된다.
// ---------------------------------------------------------------------------

describe('PickupPop 원샷 수명', () => {
  it('update 를 반복하면 결국 false(수명 만료)를 돌려주고 원소를 정리한다', () => {
    const pop = new PickupPop(0, 0);
    expect(pop.container.children.length).toBeGreaterThan(0);

    // 첫 프레임은 살아있어야 한다(true).
    expect(pop.update(0.05)).toBe(true);

    let alive = true;
    let frames = 0;
    const MAX_FRAMES = 100; // 무한 방어. 수명 ~0.35s 라 실제로는 <10프레임에 만료.
    while (alive && frames < MAX_FRAMES) {
      alive = pop.update(0.05);
      frames += 1;
    }

    expect(alive, 'update 가 결국 false 를 돌려줘야 한다(원샷 만료)').toBe(false);
    expect(frames, '재발화 없이 유한 프레임 안에 만료해야 한다').toBeLessThan(MAX_FRAMES);
    expect(pop.container.children.length, '만료 시점 원소 잔여').toBe(0);

    // 만료 후 update 는 계속 false(재발화 없음).
    expect(pop.update(0.05)).toBe(false);
  });

  it('중간/만료 어느 지점에서 destroy() 해도 throw 없이 정리한다', () => {
    const a = new PickupPop(0, 0);
    a.update(0.05); // 중간까지 진행
    expect(() => a.destroy()).not.toThrow();
    expect(a.update(0.05)).toBe(false); // destroy 이후 안전하게 false
    expect(() => a.destroy()).not.toThrow(); // 이중 destroy 무해
  });

  it('큰 dt(탭 복귀 등)에도 순간이동/throw 없이 정리된다', () => {
    const pop = new PickupPop(20, 20, { scale: 1.5 });
    expect(() => {
      pop.update(2); // MAX_DT 로 클램프돼야 함
      pop.update(0.016);
    }).not.toThrow();
    pop.destroy();
  });
});

// ---------------------------------------------------------------------------
// 3. 확장 — 중간 프레임 로컬 bounds 가 초기보다 크다(원소가 실제로 부푼다).
// ---------------------------------------------------------------------------

describe('PickupPop 확장', () => {
  it('update 중간 프레임의 로컬 bounds 가 초기보다 커진다', () => {
    const pop = new PickupPop(0, 0);
    // 초기(첫 프레임 직후) bounds.
    pop.update(0.03);
    const early = pop.container.getLocalBounds().width;
    // 조금 더 진행(아직 만료 전)한 뒤 bounds.
    pop.update(0.06);
    const mid = pop.container.getLocalBounds().width;
    expect(mid, '중간 프레임에 팝이 더 넓게 확장돼야 한다').toBeGreaterThan(early);
    pop.destroy();
  });
});

// ===========================================================================
// LevelUpRing
// ===========================================================================

// ---------------------------------------------------------------------------
// 4. 동기 배선
// ---------------------------------------------------------------------------

describe('LevelUpRing 동기 배선', () => {
  it('생성 즉시 container 에 링을 동기 추가한다(children>0)', () => {
    const ring = new LevelUpRing(0, 0);
    expect(ring.container.children.length).toBeGreaterThan(0);
    ring.destroy();
  });

  it('container 를 플레이어 지점 (x,y) 에 놓는다', () => {
    const ring = new LevelUpRing(150, 75);
    expect(ring.container.position.x).toBe(150);
    expect(ring.container.position.y).toBe(75);
    ring.destroy();
  });

  it('color·radius 를 주입해도 안전하게 생성된다(children>0)', () => {
    const ring = new LevelUpRing(0, 0, { color: 0xff44aa, radius: 80 });
    expect(ring.container.children.length).toBeGreaterThan(0);
    ring.destroy();
  });
});

// ---------------------------------------------------------------------------
// 5. 반경 성장 + 원샷 수명 — update 로 반경이 자라고, 결국 false.
// ---------------------------------------------------------------------------

describe('LevelUpRing 반경 성장·수명', () => {
  it('update 로 링 반경(=로컬 bounds)이 자란다(초기 < 후기)', () => {
    const ring = new LevelUpRing(0, 0);
    ring.update(0.03);
    const early = ring.container.getLocalBounds().width;
    ring.update(0.15);
    const later = ring.container.getLocalBounds().width;
    expect(later, '팽창으로 링 반경이 커져야 한다').toBeGreaterThan(early);
    ring.destroy();
  });

  it('update 를 반복하면 결국 false(수명 만료)를 돌려주고 원소를 정리한다', () => {
    const ring = new LevelUpRing(0, 0);
    expect(ring.update(0.05)).toBe(true);

    let alive = true;
    let frames = 0;
    const MAX_FRAMES = 100; // 무한 방어. 수명 ~0.6s 라 실제로는 <15프레임에 만료.
    while (alive && frames < MAX_FRAMES) {
      alive = ring.update(0.05);
      frames += 1;
    }
    expect(alive, 'update 가 결국 false 를 돌려줘야 한다(원샷 만료)').toBe(false);
    expect(frames).toBeLessThan(MAX_FRAMES);
    expect(ring.container.children.length, '만료 시점 원소 잔여').toBe(0);
    expect(ring.update(0.05)).toBe(false);
  });

  it('중간/만료 어느 지점에서 destroy() 해도 throw 없이 정리한다', () => {
    const r = new LevelUpRing(0, 0);
    r.update(0.05);
    expect(() => r.destroy()).not.toThrow();
    expect(r.update(0.05)).toBe(false);
    expect(() => r.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. 결정론 — 같은 인자 두 인스턴스 → 같은 children 수(무작위 부재라 자명).
// ---------------------------------------------------------------------------

describe('수집/레벨업 FX 결정론', () => {
  it('PickupPop — 같은 인자 두 인스턴스가 같은 children 수', () => {
    const a = new PickupPop(0, 0, { color: 0x00ff88, scale: 1.3 });
    const b = new PickupPop(0, 0, { color: 0x00ff88, scale: 1.3 });
    expect(a.container.children.length).toBe(b.container.children.length);
    a.destroy();
    b.destroy();
  });

  it('LevelUpRing — 같은 인자 두 인스턴스가 같은 children 수', () => {
    const a = new LevelUpRing(0, 0, { color: 0x9be8ff, radius: 60 });
    const b = new LevelUpRing(0, 0, { color: 0x9be8ff, radius: 60 });
    expect(a.container.children.length).toBe(b.container.children.length);
    a.destroy();
    b.destroy();
  });

  it('PickupPop — color/scale 이 달라도 children 수는 동일(대칭 고정 구조)', () => {
    const a = new PickupPop(0, 0);
    const b = new PickupPop(0, 0, { color: 0xff0000, scale: 3 });
    expect(a.container.children.length).toBe(b.container.children.length);
    a.destroy();
    b.destroy();
  });
});
