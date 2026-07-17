/**
 * 오디오 설정 직렬화 검증 (src/render/audio — M5 Phase C1, AC8).
 *
 * 볼륨 클램프·설정 파싱/직렬화의 순수 로직만 검증한다(WebAudio 합성은 브라우저 전용이라 제외).
 */

import { describe, it, expect } from 'vitest';
import {
  clampVolume,
  parseAudioSettings,
  serializeAudioSettings,
  DEFAULT_AUDIO_SETTINGS,
} from '../src/render/audio.js';

describe('clampVolume', () => {
  it('0..1 범위로 클램프', () => {
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(1);
  });

  it('NaN/무한대(유한하지 않음)는 기본값으로', () => {
    expect(clampVolume(NaN)).toBe(DEFAULT_AUDIO_SETTINGS.volume);
    expect(clampVolume(Infinity)).toBe(DEFAULT_AUDIO_SETTINGS.volume);
  });
});

describe('parseAudioSettings(방어적)', () => {
  it('null/손상 문자열은 기본값', () => {
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('{ not json')).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('유효 JSON 을 읽고 볼륨을 클램프', () => {
    expect(parseAudioSettings('{"muted":true,"volume":0.3}')).toEqual({ muted: true, volume: 0.3 });
    expect(parseAudioSettings('{"muted":false,"volume":5}')).toEqual({ muted: false, volume: 1 });
  });

  it('타입이 틀린 필드는 기본값으로 대체', () => {
    expect(parseAudioSettings('{"muted":"yes","volume":"loud"}')).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});

describe('serializeAudioSettings', () => {
  it('round-trip 이 보존된다', () => {
    const s = { muted: true, volume: 0.42 };
    expect(parseAudioSettings(serializeAudioSettings(s))).toEqual(s);
  });

  it('직렬화 시 볼륨을 클램프', () => {
    expect(serializeAudioSettings({ muted: false, volume: 9 })).toBe('{"muted":false,"volume":1}');
  });
});
