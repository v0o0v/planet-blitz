/**
 * 그래픽 설정 직렬화 검증 (src/render/graphicsSettings — 품질 티어 + 감소 토글, AC-0.3).
 *
 * clamp·parse·serialize 의 순수 로직과 localStorage 부재 폴백만 검증한다(스토어 구독·WebGL 은
 * 별도). tests/audioSettings.test.ts 와 동형: round-trip · clamp · 기본값 · 손상값 폴백 ·
 * localStorage 부재.
 */

import { describe, it, expect } from 'vitest';
import {
  clamp,
  parse,
  serialize,
  readStored,
  writeStored,
  DEFAULT_GRAPHICS_SETTINGS,
  STORAGE_KEY,
  type GraphicsSettings,
} from '../src/render/graphicsSettings.js';

describe('DEFAULT_GRAPHICS_SETTINGS', () => {
  it('기본값(품질 auto, 감소 토글 해제)', () => {
    expect(DEFAULT_GRAPHICS_SETTINGS).toEqual({
      quality: 'auto',
      reducedMotion: false,
      reducedGlow: false,
    });
  });

  it('STORAGE_KEY 는 pb.graphics', () => {
    expect(STORAGE_KEY).toBe('pb.graphics');
  });
});

describe('clamp(손상값 방어)', () => {
  it('유효 설정은 그대로 통과', () => {
    const s: GraphicsSettings = { quality: 'high', reducedMotion: true, reducedGlow: false };
    expect(clamp(s)).toEqual(s);
  });

  it('4가지 품질 값 모두 유효', () => {
    for (const q of ['auto', 'low', 'med', 'high'] as const) {
      expect(clamp({ quality: q, reducedMotion: false, reducedGlow: false }).quality).toBe(q);
    }
  });

  it('잘못된 quality 는 auto 로', () => {
    expect(clamp({ quality: 'ultra', reducedMotion: false, reducedGlow: false }).quality).toBe('auto');
    expect(clamp({ quality: 42, reducedMotion: false, reducedGlow: false }).quality).toBe('auto');
    expect(clamp({ quality: null, reducedMotion: false, reducedGlow: false }).quality).toBe('auto');
  });

  it('bool 이 아닌 감소 토글은 각 기본값(false)으로 강제', () => {
    expect(clamp({ quality: 'low', reducedMotion: 'yes', reducedGlow: 1 })).toEqual({
      quality: 'low',
      reducedMotion: false,
      reducedGlow: false,
    });
  });

  it('누락 필드는 각 기본값으로 대체', () => {
    expect(clamp({ quality: 'med' })).toEqual({
      quality: 'med',
      reducedMotion: false,
      reducedGlow: false,
    });
    expect(clamp({})).toEqual(DEFAULT_GRAPHICS_SETTINGS);
  });
});

describe('parse(방어적)', () => {
  it('null/손상 문자열은 기본값', () => {
    expect(parse(null)).toEqual(DEFAULT_GRAPHICS_SETTINGS);
    expect(parse('{ not json')).toEqual(DEFAULT_GRAPHICS_SETTINGS);
    expect(parse(undefined)).toEqual(DEFAULT_GRAPHICS_SETTINGS);
  });

  it('객체가 아닌 JSON(숫자/불리언/null)은 기본값', () => {
    expect(parse('5')).toEqual(DEFAULT_GRAPHICS_SETTINGS);
    expect(parse('true')).toEqual(DEFAULT_GRAPHICS_SETTINGS);
    expect(parse('null')).toEqual(DEFAULT_GRAPHICS_SETTINGS);
  });

  it('유효 JSON 문자열을 읽고 클램프', () => {
    expect(parse('{"quality":"high","reducedMotion":true,"reducedGlow":true}')).toEqual({
      quality: 'high',
      reducedMotion: true,
      reducedGlow: true,
    });
  });

  it('손상 필드(품질 미지값·토글 타입오류)는 개별 기본값으로', () => {
    expect(parse('{"quality":"cinematic","reducedMotion":"on","reducedGlow":true}')).toEqual({
      quality: 'auto',
      reducedMotion: false,
      reducedGlow: true,
    });
  });

  it('이미 파싱된 객체도 관대하게 수용', () => {
    expect(parse({ quality: 'med', reducedMotion: true, reducedGlow: false })).toEqual({
      quality: 'med',
      reducedMotion: true,
      reducedGlow: false,
    });
  });
});

describe('serialize', () => {
  it('round-trip 이 보존된다(parse∘serialize)', () => {
    const s: GraphicsSettings = { quality: 'low', reducedMotion: true, reducedGlow: false };
    expect(parse(serialize(s))).toEqual(s);
  });

  it('모든 품질 값이 round-trip 보존', () => {
    for (const q of ['auto', 'low', 'med', 'high'] as const) {
      const s: GraphicsSettings = { quality: q, reducedMotion: false, reducedGlow: true };
      expect(parse(serialize(s))).toEqual(s);
    }
  });

  it('직렬화는 3필드 JSON', () => {
    expect(serialize({ quality: 'high', reducedMotion: false, reducedGlow: true })).toBe(
      '{"quality":"high","reducedMotion":false,"reducedGlow":true}',
    );
  });
});

describe('readStored/writeStored (localStorage 부재 방어)', () => {
  it('localStorage 없는 환경(node)에서 readStored 는 기본값 폴백', () => {
    // 이 저장소는 node 테스트 환경(localStorage undefined)에서 안전 폴백해야 한다.
    // localStorage 가 있는 환경에서도 최소한 예외 없이 유효 설정을 돌려줘야 한다.
    if (typeof localStorage === 'undefined') {
      expect(readStored()).toEqual(DEFAULT_GRAPHICS_SETTINGS);
    } else {
      expect(clamp(readStored())).toEqual(readStored());
    }
  });

  it('writeStored 는 localStorage 부재/예외에도 던지지 않는다', () => {
    expect(() => writeStored(DEFAULT_GRAPHICS_SETTINGS)).not.toThrow();
  });
});
