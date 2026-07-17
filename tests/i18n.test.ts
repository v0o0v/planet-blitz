/**
 * 로컬라이즈 코어 검증 (src/i18n — M5 Phase C3, AC8).
 *
 * 카탈로그 완전성(EN↔KO 키 동수)·초기 로케일 선택(순수)·`t()` 조회/치환/폴백을 검증한다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { EN, KO } from '../src/i18n/catalog.js';
import { t, setLocale, getLocale, pickInitialLocale, isLocale } from '../src/i18n/index.js';

afterEach(() => {
  setLocale('en'); // 다른 테스트에 로케일 누수 방지.
});

describe('카탈로그 완전성', () => {
  it('EN 과 KO 가 정확히 같은 키 집합을 가진다(누락/잉여 0)', () => {
    const enKeys = Object.keys(EN).sort();
    const koKeys = Object.keys(KO).sort();
    expect(koKeys).toEqual(enKeys);
  });

  it('모든 문구가 비어 있지 않다', () => {
    for (const v of Object.values(EN)) expect(v.length).toBeGreaterThan(0);
    for (const v of Object.values(KO)) expect(v.length).toBeGreaterThan(0);
  });

  it('도발 스티커 12종 키가 EN·KO 양쪽에 존재한다', () => {
    const ids = [
      'good-game', 'nice-try', 'galaxy-small', 'lock-door', 'five-stars', 'maintenance',
      'sightseeing', 'turret-regards', 'take-a-seat', 'rematch-anytime', 'core-walk', 'safe-travels',
    ];
    for (const id of ids) {
      expect(EN).toHaveProperty(`sticker.${id}`);
      expect(KO).toHaveProperty(`sticker.${id}`);
    }
  });
});

describe('초기 로케일 선택(순수)', () => {
  it('저장된 수동 선택이 최우선', () => {
    expect(pickInitialLocale('ko', 'en-US')).toBe('ko');
    expect(pickInitialLocale('en', 'ko-KR')).toBe('en');
  });

  it('저장값 없으면 브라우저 언어의 ko 접두사를 감지', () => {
    expect(pickInitialLocale(null, 'ko-KR')).toBe('ko');
    expect(pickInitialLocale(null, 'ko')).toBe('ko');
  });

  it('그 외에는 영어 기본(글로벌 우선)', () => {
    expect(pickInitialLocale(null, 'en-US')).toBe('en');
    expect(pickInitialLocale(null, undefined)).toBe('en');
    expect(pickInitialLocale('garbage', 'fr-FR')).toBe('en');
  });

  it('isLocale 가드', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ko')).toBe(true);
    expect(isLocale('jp')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('t() 조회·치환·폴백', () => {
  it('현재 로케일 문자열을 돌려준다', () => {
    setLocale('en');
    expect(t('result.win.title')).toBe('Planet Conquered!');
    setLocale('ko');
    expect(t('result.win.title')).toBe('행성 정복!');
    expect(getLocale()).toBe('ko');
  });

  it('{name} 플레이스홀더를 params 로 치환한다', () => {
    setLocale('en');
    expect(t('result.levelShort', { n: 42 })).toBe('Lv 42');
    expect(t('planet.launch', { name: 'Kargon' })).toBe('▶ Launch Kargon');
  });

  it('params 없으면 플레이스홀더를 그대로 둔다(치환 실패 방어)', () => {
    setLocale('en');
    expect(t('result.levelShort')).toBe('Lv {n}');
  });
});
