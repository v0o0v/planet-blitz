/**
 * 품질 티어 선택 + 이펙트 게이팅 검증 (src/render/qualityTier — AC-0.5).
 *
 * selectTier: 오버라이드 잠금 · FPS 경계 · 이력현상(진동 안 함) · 단조 1단계 강등/승격 ·
 * NaN 방어. effectGates: reducedMotion/reducedGlow 직교 덮어쓰기 · 티어 게이팅.
 */

import { describe, it, expect } from 'vitest';
import {
  selectTier,
  effectGates,
  TIER_DOWNGRADE_FPS,
  TIER_UPGRADE_FPS,
  type QualityTier,
  type EffectGates,
} from '../src/render/qualityTier.js';
import type { GraphicsSettings } from '../src/render/graphicsSettings.js';

/** 감소 토글 없는 기본 그래픽 설정(effectGates 티어 게이팅 검증용). */
const NO_REDUCE: GraphicsSettings = {
  quality: 'auto',
  reducedMotion: false,
  reducedGlow: false,
  damageNumbers: true,
};

/** 강등 임계보다 확실히 낮은 FPS(강등 유발). */
const LOW_FPS = TIER_DOWNGRADE_FPS - 5;
/** 승격 임계보다 확실히 높은 FPS(승격 유발). */
const HIGH_FPS = TIER_UPGRADE_FPS + 5;
/** 이력 대역 한가운데 FPS(무변화). */
const MID_FPS = (TIER_DOWNGRADE_FPS + TIER_UPGRADE_FPS) / 2;

describe('selectTier — 수동 오버라이드 잠금', () => {
  it('구체 티어 오버라이드는 FPS 무시하고 그대로', () => {
    expect(selectTier('high', LOW_FPS, 'low')).toBe('low');
    expect(selectTier('low', HIGH_FPS, 'high')).toBe('high');
    expect(selectTier('med', 0, 'med')).toBe('med');
    expect(selectTier('low', Number.NaN, 'high')).toBe('high');
  });
});

describe('selectTier — 자동 강등(단조 1단계)', () => {
  it('임계 미만이면 한 단계만 강등', () => {
    expect(selectTier('high', LOW_FPS, 'auto')).toBe('med');
    expect(selectTier('med', LOW_FPS, 'auto')).toBe('low');
  });

  it('아무리 낮아도 1단계씩만(high → med, low 로 건너뛰지 않음)', () => {
    expect(selectTier('high', 1, 'auto')).toBe('med');
  });

  it('이미 low 면 더 못 내려감', () => {
    expect(selectTier('low', LOW_FPS, 'auto')).toBe('low');
    expect(selectTier('low', 0, 'auto')).toBe('low');
  });
});

describe('selectTier — 자동 승격(단조 1단계)', () => {
  it('복귀 임계 초과면 한 단계만 승격', () => {
    expect(selectTier('low', HIGH_FPS, 'auto')).toBe('med');
    expect(selectTier('med', HIGH_FPS, 'auto')).toBe('high');
  });

  it('아무리 높아도 1단계씩만(low → med, high 로 건너뛰지 않음)', () => {
    expect(selectTier('low', 1000, 'auto')).toBe('med');
  });

  it('이미 high 면 더 못 올라감', () => {
    expect(selectTier('high', HIGH_FPS, 'auto')).toBe('high');
  });
});

describe('selectTier — 이력현상(진동 방지)', () => {
  it('이력 대역 안에서는 무변화', () => {
    expect(selectTier('low', MID_FPS, 'auto')).toBe('low');
    expect(selectTier('med', MID_FPS, 'auto')).toBe('med');
    expect(selectTier('high', MID_FPS, 'auto')).toBe('high');
  });

  it('강등 직후 이력 대역 FPS 로는 즉시 재승격하지 않는다(왕복 금지)', () => {
    // high 에서 저FPS 로 med 강등 → 프레임이 이력 대역으로 회복해도 med 유지(진동 안 함).
    const downgraded = selectTier('high', LOW_FPS, 'auto');
    expect(downgraded).toBe('med');
    expect(selectTier(downgraded, MID_FPS, 'auto')).toBe('med');
  });

  it('승격 임계는 강등 임계보다 높다(이력 대역 존재)', () => {
    expect(TIER_UPGRADE_FPS).toBeGreaterThan(TIER_DOWNGRADE_FPS);
  });
});

describe('selectTier — 경계값', () => {
  it('강등 임계 정확히 일치하면 강등 안 함(엄격 미만)', () => {
    expect(selectTier('high', TIER_DOWNGRADE_FPS, 'auto')).toBe('high');
  });

  it('승격 임계 정확히 일치하면 승격 안 함(엄격 초과)', () => {
    expect(selectTier('low', TIER_UPGRADE_FPS, 'auto')).toBe('low');
  });
});

describe('selectTier — NaN/비유한 방어', () => {
  it('NaN/∞ FPS 면 현재 티어 유지', () => {
    expect(selectTier('med', Number.NaN, 'auto')).toBe('med');
    expect(selectTier('high', Number.POSITIVE_INFINITY, 'auto')).toBe('high');
    expect(selectTier('low', Number.NEGATIVE_INFINITY, 'auto')).toBe('low');
  });
});

describe('effectGates — 티어 게이팅', () => {
  it('Low: 발광·흔들림·블룸 없음, 파티클 min', () => {
    const g = effectGates('low', NO_REDUCE);
    expect(g.halo).toBe(false);
    expect(g.shake).toBe(false);
    expect(g.bloom).toBe(false);
    expect(g.eventShaders).toBe(false);
    expect(g.particles).toBe('min');
  });

  it('Med: halo + shake + 파티클 normal, 블룸/이벤트셰이더는 아직 off', () => {
    const g = effectGates('med', NO_REDUCE);
    expect(g.halo).toBe(true);
    expect(g.shake).toBe(true);
    expect(g.particles).toBe('normal');
    expect(g.bloom).toBe(false);
    expect(g.eventShaders).toBe(false);
  });

  it('High: bloom + eventShaders 추가', () => {
    const g = effectGates('high', NO_REDUCE);
    expect(g.halo).toBe(true);
    expect(g.shake).toBe(true);
    expect(g.bloom).toBe(true);
    expect(g.eventShaders).toBe(true);
    expect(g.particles).toBe('normal');
  });

  it('상위 티어가 하위의 상위집합(단조): 켜진 불리언 게이트가 줄지 않는다', () => {
    const boolKeys: (keyof EffectGates)[] = ['shake', 'hitFlash', 'halo', 'bloom', 'eventShaders', 'trails'];
    const low = effectGates('low', NO_REDUCE);
    const med = effectGates('med', NO_REDUCE);
    const high = effectGates('high', NO_REDUCE);
    for (const k of boolKeys) {
      // low → med → high 로 가며 true 였던 게이트가 false 로 뒤집히지 않는다.
      if (low[k] === true) expect(med[k]).toBe(true);
      if (med[k] === true) expect(high[k]).toBe(true);
    }
  });
});

describe('effectGates — 감소 토글 직교', () => {
  it('reducedMotion 은 어느 티어든 shake·hitFlash 를 끈다', () => {
    for (const tier of ['low', 'med', 'high'] as QualityTier[]) {
      const g = effectGates(tier, { quality: 'auto', reducedMotion: true, reducedGlow: false, damageNumbers: true });
      expect(g.shake).toBe(false);
      expect(g.hitFlash).toBe(false);
    }
  });

  it('reducedGlow 는 어느 티어든 halo·bloom 을 끈다', () => {
    for (const tier of ['low', 'med', 'high'] as QualityTier[]) {
      const g = effectGates(tier, { quality: 'auto', reducedMotion: false, reducedGlow: true, damageNumbers: true });
      expect(g.halo).toBe(false);
      expect(g.bloom).toBe(false);
    }
  });

  it('reducedMotion 은 발광(halo/bloom)에 영향 없음(직교)', () => {
    const g = effectGates('high', { quality: 'auto', reducedMotion: true, reducedGlow: false, damageNumbers: true });
    expect(g.halo).toBe(true);
    expect(g.bloom).toBe(true);
  });

  it('reducedGlow 는 모션(shake/hitFlash)에 영향 없음(직교)', () => {
    const g = effectGates('high', { quality: 'auto', reducedMotion: false, reducedGlow: true, damageNumbers: true });
    expect(g.shake).toBe(true);
    expect(g.hitFlash).toBe(true);
  });

  it('두 토글 동시: 네 이펙트 모두 꺼지고 나머지는 티어대로', () => {
    const g = effectGates('high', { quality: 'auto', reducedMotion: true, reducedGlow: true, damageNumbers: true });
    expect(g.shake).toBe(false);
    expect(g.hitFlash).toBe(false);
    expect(g.halo).toBe(false);
    expect(g.bloom).toBe(false);
    // 감소 토글 무관 게이트는 티어(high) 그대로.
    expect(g.eventShaders).toBe(true);
    expect(g.trails).toBe(true);
    expect(g.particles).toBe('normal');
  });
});
