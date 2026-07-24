/**
 * 발광체 글로우 단위 테스트 (Phase 3 — plan §AC-3.1; ADR-0031).
 *
 * `buildGlowHalo`·`createGlowBloomFilter`·`isGlowEmitter`([src/render/effects/glow.ts])는 Phase 1
 * 갤러리에서 사용자가 고른 `glow-bloom-tight` 룩을 프로덕션으로 승격한 발광체 글로우다. entityRenderer
 * (Phase 2/3 wire)가 발광체 밑 glowLayer 에 헤일로를 깔고 High 티어에서 블룸을 건다. 여기서는 그
 * 소비 계약을 헤드리스로 못박는다:
 *
 *  1. **헤일로 동기 배선**: `buildGlowHalo` 생성 즉시 Container 자식 > 0(절차적 Graphics 라 GL 없이 성립).
 *  2. **헤일로 크기 파라미터 반영**: radius 가 크면 헤일로 bounds 도 커진다(색은 add Container 규율 보존).
 *  3. **블룸 graceful 폴백**: `createGlowBloomFilter` → Filter|null(node 에선 null 폴백 가능). throw 없음.
 *  4. **발광체 allowlist**: `isGlowEmitter` — 탄 false, 보스/젬/전리품/플레이어 true.
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — PixiJS 는 렌더러 없이 import
 * 만 하므로 node 에서 그대로 돈다(tests/explosionEffect.test.ts 선례). 표시 객체 추가·필터 생성
 * 시도만 검증하고 실제 픽셀 래스터화는 다루지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import {
  buildGlowHalo,
  createGlowBloomFilter,
  isGlowEmitter,
  DEFAULT_HALO_COLOR,
} from '../src/render/effects/glow.js';

// ---------------------------------------------------------------------------
// 1. 헤일로 동기 배선 (AC-3.1 / AC-1.4 정신) — 목업이 아니라 실 표시 객체를 즉시 붙인다.
// ---------------------------------------------------------------------------

describe('buildGlowHalo 동기 배선', () => {
  it('가산(add) blend Container 를 만들고 자식을 동기 추가한다(children>0)', () => {
    const halo = buildGlowHalo(30);
    expect(halo).toBeInstanceOf(Container);
    expect(halo.blendMode).toBe('add');
    expect(halo.children.length).toBeGreaterThan(0);
    halo.destroy({ children: true });
  });

  it('원점(0,0) 기준이라 호출측이 position 만 옮기면 된다(생성 시 position=0)', () => {
    const halo = buildGlowHalo(30);
    expect(halo.position.x).toBe(0);
    expect(halo.position.y).toBe(0);
    halo.destroy({ children: true });
  });

  it('색 인자를 생략하면 기본 시안(DEFAULT_HALO_COLOR)으로도 자식이 붙는다', () => {
    const halo = buildGlowHalo(20);
    // 색 자체는 Graphics geometry 내부라 직접 못 읽지만, 인자 유무와 무관하게 배선은 성립해야 한다.
    expect(halo.children.length).toBeGreaterThan(0);
    expect(DEFAULT_HALO_COLOR).toBe(0x39c8ff); // 갤러리 glow-halo-soft haloColor 승격값 회귀 가드.
    halo.destroy({ children: true });
  });
});

// ---------------------------------------------------------------------------
// 2. 크기 파라미터 반영 — radius 가 커지면 헤일로 외곽 반경(=bounds)이 커진다.
// ---------------------------------------------------------------------------

describe('buildGlowHalo 크기 파라미터', () => {
  it('radius 가 크면 헤일로 bounds 도 커진다', () => {
    const small = buildGlowHalo(10);
    const large = buildGlowHalo(40);
    // 절차적 동심원 geometry 의 로컬 bounds 는 GL 없이 CPU 로 산출된다(외곽 링 반경 ∝ radius).
    const smallW = small.getLocalBounds().width;
    const largeW = large.getLocalBounds().width;
    expect(largeW).toBeGreaterThan(smallW);
    small.destroy({ children: true });
    large.destroy({ children: true });
  });

  it('외곽 반경이 대략 radius 를 따른다(bounds 폭 ≈ 2×radius)', () => {
    const r = 25;
    const halo = buildGlowHalo(r);
    const w = halo.getLocalBounds().width;
    // 가장 바깥 링의 지름 ≈ 2r. 절차적 원이라 근사값 — 넉넉한 허용오차로 크기 연동만 확인.
    expect(w).toBeGreaterThan(r); // 최소 반경보다는 확실히 크다.
    expect(w).toBeLessThanOrEqual(2 * r + 2); // 외곽 링 지름을 넘지 않는다.
    halo.destroy({ children: true });
  });

  it('radius 0/음수도 throw 없이 Container 를 돌려준다(방어)', () => {
    expect(() => {
      const a = buildGlowHalo(0);
      const b = buildGlowHalo(-5);
      a.destroy({ children: true });
      b.destroy({ children: true });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. 블룸 graceful 폴백 — createGlowBloomFilter 는 Filter|null(node 안전), throw 없음.
// ---------------------------------------------------------------------------

describe('createGlowBloomFilter graceful 폴백', () => {
  it('Filter 또는 null 을 돌려준다(node 에선 null 폴백 가능) — throw 없음', () => {
    let result: ReturnType<typeof createGlowBloomFilter> | undefined;
    expect(() => {
      result = createGlowBloomFilter();
    }).not.toThrow();
    // node-env(GL 없음)에선 null 폴백이 정상. GL 있으면 Filter 인스턴스. 둘 다 계약 준수.
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('반복 호출해도 매번 안전하게 Filter|null 을 돌려준다(누수/throw 없음)', () => {
    expect(() => {
      for (let i = 0; i < 3; i++) {
        const f = createGlowBloomFilter();
        // 생성됐으면 정리(node 에선 대개 null 이라 guard).
        if (f) f.destroy();
      }
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. 발광체 allowlist — 탄 제외, 고임팩트체만 발광(CONTEXT "발광체" 정합).
// ---------------------------------------------------------------------------

describe('isGlowEmitter 발광체 판정', () => {
  it('보스·젬·전리품·플레이어는 발광체(true)', () => {
    expect(isGlowEmitter('player')).toBe(true);
    expect(isGlowEmitter('gem')).toBe(true);
    expect(isGlowEmitter('loot')).toBe(true);
    expect(isGlowEmitter('boss')).toBe(true);
    expect(isGlowEmitter('defenseBoss')).toBe(true);
  });

  it('탄(bullet·enemyBullet)은 발광체가 아니다(false) — 번짐/성능 규율', () => {
    expect(isGlowEmitter('bullet')).toBe(false);
    expect(isGlowEmitter('enemyBullet')).toBe(false);
  });

  it('적 실루엣·기물 등 가독 레이어도 발광체가 아니다(false)', () => {
    expect(isGlowEmitter('enemy')).toBe(false);
    expect(isGlowEmitter('wall')).toBe(false);
    expect(isGlowEmitter('hazard')).toBe(false);
  });

  it('미지의 kind 는 안전하게 false(allowlist 밖)', () => {
    expect(isGlowEmitter('')).toBe(false);
    expect(isGlowEmitter('nonexistentKind')).toBe(false);
  });
});
