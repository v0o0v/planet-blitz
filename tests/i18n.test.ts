/**
 * 로컬라이즈 코어 검증 (src/i18n — M5 Phase C3, AC8).
 *
 * 카탈로그 완전성(EN↔KO 키 동수)·초기 로케일 선택(순수)·`t()` 조회/치환/폴백을 검증한다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { EN, KO } from '../src/i18n/catalog.js';
import { t, setLocale, getLocale, pickInitialLocale, isLocale } from '../src/i18n/index.js';
import { STICKERS } from '../data/stickers.js';
import { INVASION_CATALOG, DEF3_MESSAGE_KEYS, def3NameKey, def3DescKey } from '../data/invasion/catalog.js';
import {
  DEFENSE_UNIT_AFFIXES,
  defenseUnitAffixNameKey,
  defenseUnitAffixDescKey,
} from '../data/defenseUnits.js';
import {
  CORE_MODULE_UNIQUES,
  MODULE_AFFIXES,
  moduleUniqueNameKey,
  moduleUniqueDescKey,
  moduleAffixNameKey,
  moduleAffixDescKey,
} from '../data/coreModules.js';

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

  it('도발 스티커 전종(STICKERS) 키가 EN·KO 양쪽에 존재한다', () => {
    // stickerPicker.stickerTextKey 는 `sticker.<id>` 로 무검증 캐스팅하므로, 신규 id 추가 시
    // i18n 키 누락을 이 테스트가 잡도록 하드코딩 목록이 아닌 STICKERS 정본에서 파생한다(LOW#2).
    expect(STICKERS.length).toBeGreaterThan(0);
    for (const s of STICKERS) {
      expect(EN, `EN missing sticker.${s.id}`).toHaveProperty(`sticker.${s.id}`);
      expect(KO, `KO missing sticker.${s.id}`).toHaveProperty(`sticker.${s.id}`);
    }
  });

  /**
   * 침공 3레이어 콘텐츠명 규약(`def3.<식별자>.name` / `.desc` — L9-garrison-catalog).
   * 검증 목록을 하드코딩하지 않고 **카탈로그 배열에서 파생**한다(STICKERS 선례). 그래야 M7c 에서
   * 방어체를 append 할 때 문구를 채우기 전까지 이 테스트가 빨간불로 남는다.
   */
  it('침공 카탈로그 전종의 def3.* 키가 EN·KO 양쪽에 존재한다', () => {
    expect(INVASION_CATALOG.length).toBeGreaterThan(0);
    expect(DEF3_MESSAGE_KEYS.length).toBe(INVASION_CATALOG.length * 2);
    for (const e of INVASION_CATALOG) {
      for (const key of [def3NameKey(e.i18nId), def3DescKey(e.i18nId)]) {
        expect(EN, `EN missing ${key}`).toHaveProperty(key);
        expect(KO, `KO missing ${key}`).toHaveProperty(key);
      }
    }
  });

  /**
   * 방어체 어픽스(M7b · data/defenseUnits.ts)의 `def3.affix.<id>.name/.desc` 전수.
   * 어픽스 정의 배열에서 파생하므로, 어픽스를 append 하면 문구를 채우기 전까지 빨간불이다.
   */
  it('방어체 어픽스 전종의 def3.affix.* 키가 EN·KO 양쪽에 존재한다', () => {
    expect(DEFENSE_UNIT_AFFIXES.length).toBeGreaterThan(0);
    for (const a of DEFENSE_UNIT_AFFIXES) {
      for (const key of [defenseUnitAffixNameKey(a.id), defenseUnitAffixDescKey(a.id)]) {
        expect(EN, `EN missing ${key}`).toHaveProperty(key);
        expect(KO, `KO missing ${key}`).toHaveProperty(key);
      }
    }
  });

  /**
   * 모듈 어픽스(M7b · data/coreModules.ts)의 `def3.affix.<id>.name/.desc` 전수.
   * 구 카드 어픽스는 데이터에 한글 `name` 필드를 들고 있었다 — 그 리터럴을 i18n 으로 옮기면서
   * 검증도 **배열 파생**으로 세워, 어픽스를 추가하면 문구를 채우기 전까지 빨간불이게 만든다.
   */
  it('모듈 어픽스 전종의 def3.affix.* 키가 EN·KO 양쪽에 존재한다', () => {
    expect(MODULE_AFFIXES.length).toBeGreaterThan(0);
    for (const a of MODULE_AFFIXES) {
      for (const key of [moduleAffixNameKey(a.id), moduleAffixDescKey(a.id)]) {
        expect(EN, `EN missing ${key}`).toHaveProperty(key);
        expect(KO, `KO missing ${key}`).toHaveProperty(key);
      }
    }
  });

  /** 코어 모듈 유니크(M7b · data/coreModules.ts)의 `def3.module.<id>.name/.desc` 전수. */
  it('코어 모듈 유니크 전종의 def3.module.* 키가 EN·KO 양쪽에 존재한다', () => {
    expect(CORE_MODULE_UNIQUES.length).toBeGreaterThan(0);
    for (const u of CORE_MODULE_UNIQUES) {
      for (const key of [moduleUniqueNameKey(u.id), moduleUniqueDescKey(u.id)]) {
        expect(EN, `EN missing ${key}`).toHaveProperty(key);
        expect(KO, `KO missing ${key}`).toHaveProperty(key);
      }
    }
  });

  it('def3.affix.* / def3.module.* 문구도 비지 않고 컬러 이모지를 쓰지 않는다', () => {
    const table = (o: Record<string, string>, k: string): string => o[k] ?? '';
    const keys = [
      ...DEFENSE_UNIT_AFFIXES.flatMap((a) => [
        defenseUnitAffixNameKey(a.id),
        defenseUnitAffixDescKey(a.id),
      ]),
      ...CORE_MODULE_UNIQUES.flatMap((u) => [moduleUniqueNameKey(u.id), moduleUniqueDescKey(u.id)]),
      ...MODULE_AFFIXES.flatMap((a) => [moduleAffixNameKey(a.id), moduleAffixDescKey(a.id)]),
    ];
    for (const key of keys) {
      for (const [label, t] of [
        ['EN', EN as unknown as Record<string, string>],
        ['KO', KO as unknown as Record<string, string>],
      ] as const) {
        const v = table(t, key);
        expect(v.length, `${label} empty ${key}`).toBeGreaterThan(0);
        expect(v, `${label} emoji in ${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it('def3.* 문구는 비어 있지 않고 컬러 이모지를 쓰지 않는다(Pixi 두부 방지)', () => {
    const record = (o: Record<string, string>, k: string): string => o[k] ?? '';
    for (const key of DEF3_MESSAGE_KEYS) {
      for (const [label, table] of [
        ['EN', EN as unknown as Record<string, string>],
        ['KO', KO as unknown as Record<string, string>],
      ] as const) {
        const v = record(table, key);
        expect(v.length, `${label} empty ${key}`).toBeGreaterThan(0);
        expect(v, `${label} emoji in ${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
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
    expect(t('result.win.title')).toBe('Planet Conquered');
    setLocale('ko');
    expect(t('result.win.title')).toBe('행성 정복');
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
