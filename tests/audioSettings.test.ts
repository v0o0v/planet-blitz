/**
 * 오디오 설정 직렬화 검증 (src/render/audio — 3버스 믹싱, AC9·AC10·R5).
 *
 * 볼륨 클램프·설정 파싱/직렬화의 순수 로직만 검증한다(WebAudio 합성은 브라우저 전용이라 제외).
 * 특히 구형 단일 `{muted, volume}` 저장본을 3버스로 무손실 승격하는 마이그레이션(R5)을 단언한다.
 */

import { describe, it, expect } from 'vitest';
import {
  clampVolume,
  parseAudioSettings,
  serializeAudioSettings,
  DEFAULT_AUDIO_SETTINGS,
  type AudioSettings,
} from '../src/render/audio.js';

/** clampVolume 이 유한하지 않은 입력에 돌려주는 안전 폴백(audio.ts 의 FALLBACK_VOLUME). */
const FALLBACK_VOLUME = 0.5;

describe('clampVolume', () => {
  it('0..1 범위로 클램프', () => {
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(1);
  });

  it('NaN/무한대(유한하지 않음)는 안전 폴백값으로', () => {
    expect(clampVolume(NaN)).toBe(FALLBACK_VOLUME);
    expect(clampVolume(Infinity)).toBe(FALLBACK_VOLUME);
  });
});

describe('DEFAULT_AUDIO_SETTINGS', () => {
  it('3버스 잠정 기본값(BGM 0.5·SFX 0.6·UI 0.5, 음소거 해제)', () => {
    expect(DEFAULT_AUDIO_SETTINGS).toEqual({
      muted: false,
      bgmVolume: 0.5,
      sfxVolume: 0.6,
      uiVolume: 0.5,
    });
  });
});

describe('parseAudioSettings(방어적)', () => {
  it('null/손상 문자열은 기본값', () => {
    expect(parseAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('{ not json')).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('객체가 아닌 JSON(숫자/불리언/null)은 기본값', () => {
    expect(parseAudioSettings('5')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('true')).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(parseAudioSettings('null')).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('레거시 {muted, volume} 를 3버스에 무손실 복사(R5·AC10)', () => {
    expect(parseAudioSettings('{"muted":true,"volume":0.3}')).toEqual({
      muted: true,
      bgmVolume: 0.3,
      sfxVolume: 0.3,
      uiVolume: 0.3,
    });
  });

  it('레거시 volume 도 3버스 복사 시 클램프', () => {
    expect(parseAudioSettings('{"muted":false,"volume":5}')).toEqual({
      muted: false,
      bgmVolume: 1,
      sfxVolume: 1,
      uiVolume: 1,
    });
  });

  it('신형 4필드를 읽고 각 버스를 클램프', () => {
    expect(parseAudioSettings('{"muted":true,"bgmVolume":0.2,"sfxVolume":0.4,"uiVolume":0.6}')).toEqual({
      muted: true,
      bgmVolume: 0.2,
      sfxVolume: 0.4,
      uiVolume: 0.6,
    });
    expect(parseAudioSettings('{"muted":false,"bgmVolume":9,"sfxVolume":-3,"uiVolume":0.5}')).toEqual({
      muted: false,
      bgmVolume: 1,
      sfxVolume: 0,
      uiVolume: 0.5,
    });
  });

  it('신형에서 없는/타입 틀린 버스 필드는 개별 기본값으로 대체', () => {
    // bgmVolume 존재(신형 판정) + sfxVolume 누락 + uiVolume 타입 오류 → 각각 버스 기본값.
    expect(parseAudioSettings('{"muted":true,"bgmVolume":0.8,"uiVolume":"loud"}')).toEqual({
      muted: true,
      bgmVolume: 0.8,
      sfxVolume: DEFAULT_AUDIO_SETTINGS.sfxVolume,
      uiVolume: DEFAULT_AUDIO_SETTINGS.uiVolume,
    });
  });

  it('모든 필드 타입이 틀리면 전부 기본값', () => {
    expect(parseAudioSettings('{"muted":"yes","volume":"loud"}')).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});

describe('serializeAudioSettings', () => {
  it('round-trip 이 보존된다(신형 4필드)', () => {
    const s: AudioSettings = { muted: true, bgmVolume: 0.42, sfxVolume: 0.71, uiVolume: 0.13 };
    expect(parseAudioSettings(serializeAudioSettings(s))).toEqual(s);
  });

  it('직렬화 시 각 버스 볼륨을 클램프', () => {
    expect(serializeAudioSettings({ muted: false, bgmVolume: 9, sfxVolume: -1, uiVolume: 0.5 })).toBe(
      '{"muted":false,"bgmVolume":1,"sfxVolume":0,"uiVolume":0.5}',
    );
  });
});
