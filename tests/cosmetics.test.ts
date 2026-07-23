/**
 * 도감 코스메틱 데이터·조회·보유 파생·i18n 완전성 검증 (스토리 시스템 Phase E, ADR-0023).
 *
 * 검증 목록은 전부 `data/cosmetics` 정본 배열 파생이다(STICKERS·SHIP_STORIES 선례). 하드코딩
 * 목록을 쓰면 사연을 append 할 때 스위트가 새 코스메틱 키를 모르고 그린이 된다 — 배열 파생이라
 * 항목을 늘리면 문구를 채우기 전까지 빨간불로 남는다. 보유는 별도 저장 없이 사연 해금에서
 * 순수 파생하므로, 프로필 상태를 바꿔 보유 집합이 실제로 따라오는지까지 대조한다.
 */

import { describe, it, expect } from 'vitest';
import { EN, KO } from '../src/i18n/catalog.js';
import { SHIP_STORIES } from '../data/lore/index.js';
import {
  COSMETICS,
  cosmeticId,
  cosmeticNameKey,
  cosmeticById,
  cosmeticsForSlug,
  cosmeticForChapter,
  ownedCosmeticIds,
} from '../data/cosmetics.js';
import { defaultProfile } from '../src/save/profile.js';
import { ownedCosmeticsForProfile, ownedCosmeticCount } from '../src/ui/pixi/storyUnlock.js';

const enT = EN as unknown as Record<string, string>;
const koT = KO as unknown as Record<string, string>;

describe('코스메틱 정본 구조 (data/cosmetics)', () => {
  it('사연 챕터 2·3에서 파생된다 — 기체당 2개(배지·칭호), id 중복 없음', () => {
    // 챕터 1(기본 공개)은 해금 이벤트가 없어 코스메틱도 없다 → 기체당 정확히 2개.
    expect(COSMETICS.length).toBe(SHIP_STORIES.length * 2);
    const ids = COSMETICS.map((c) => c.id);
    expect(new Set(ids).size, '코스메틱 id 중복').toBe(ids.length);
  });

  it('slug 집합이 사연 정본과 일치하고 chapterIndex↔kind 매핑이 고정이다', () => {
    const cosmeticSlugs = new Set(COSMETICS.map((c) => c.slug));
    const storySlugs = new Set(SHIP_STORIES.map((s) => s.slug));
    expect(cosmeticSlugs).toEqual(storySlugs);
    for (const c of COSMETICS) {
      expect(c.chapterIndex === 1 || c.chapterIndex === 2, `${c.id} chapterIndex`).toBe(true);
      // 챕터 2(index 1) = 배지, 챕터 3(index 2) = 칭호.
      expect(c.kind, `${c.id} kind`).toBe(c.chapterIndex === 1 ? 'badge' : 'title');
      // id 는 slug·챕터 파생이어야 한다(재번호·손댐 방지).
      expect(c.id, `${c.id} 파생`).toBe(cosmeticId(c.slug, c.chapterIndex));
    }
  });

  it('id·키 빌더가 예상 문자열을 만든다', () => {
    expect(cosmeticId('striker', 1)).toBe('striker-ch2');
    expect(cosmeticId('bruiser', 2)).toBe('bruiser-ch3');
    expect(cosmeticNameKey('striker-ch2')).toBe('cosmetic.striker-ch2.name');
  });
});

describe('코스메틱 순수 조회', () => {
  it('cosmeticById 는 실재 id 를 찾고 없는 id 는 undefined', () => {
    for (const c of COSMETICS) expect(cosmeticById(c.id)?.id).toBe(c.id);
    expect(cosmeticById('nonexistent')).toBeUndefined();
  });

  it('cosmeticsForSlug 는 그 기체의 코스메틱만(챕터 2·3) 준다', () => {
    for (const s of SHIP_STORIES) {
      const list = cosmeticsForSlug(s.slug);
      expect(list.map((c) => c.chapterIndex)).toEqual([1, 2]);
      expect(list.every((c) => c.slug === s.slug)).toBe(true);
    }
    expect(cosmeticsForSlug('nonexistent')).toEqual([]);
  });

  it('cosmeticForChapter 는 slug·챕터로 조회하고 해금 이벤트 없는 챕터1은 undefined', () => {
    expect(cosmeticForChapter('striker', 1)?.id).toBe('striker-ch2');
    expect(cosmeticForChapter('striker', 2)?.id).toBe('striker-ch3');
    expect(cosmeticForChapter('striker', 0)).toBeUndefined(); // 챕터1 = 코스메틱 없음
    expect(cosmeticForChapter('nonexistent', 1)).toBeUndefined();
  });
});

describe('보유 파생 — 별도 저장 없이 해금 상태에서 유도', () => {
  it('ownedCosmeticIds(순수 술어)는 해금된 (slug,챕터)의 코스메틱만 낸다', () => {
    // 전부 해금 → 전량. 전부 미해금 → 빈 배열.
    expect(ownedCosmeticIds(() => true)).toEqual(COSMETICS.map((c) => c.id));
    expect(ownedCosmeticIds(() => false)).toEqual([]);
    // 특정 기체·챕터만.
    const only = ownedCosmeticIds((slug, ch) => slug === 'phantom' && ch === 2);
    expect(only).toEqual(['phantom-ch3']);
  });

  it('기본 프로필은 보유 코스메틱이 없다(챕터2·3 미해금)', () => {
    expect(ownedCosmeticsForProfile(defaultProfile())).toEqual([]);
    expect(ownedCosmeticCount(defaultProfile())).toEqual({ owned: 0, total: COSMETICS.length });
  });

  it('인연 행성 클리어가 그 기체 배지(챕터2)를, 마일스톤이 칭호(챕터3)를 연다', () => {
    const bruiser = SHIP_STORIES.find((s) => s.slug === 'bruiser')!; // 인연 = 크라스(5)
    const ch3 = bruiser.chapters[2].unlock;
    if (ch3.kind !== 'milestone') throw new Error('expected milestone');

    const p = defaultProfile();
    // 인연 행성(크라스, 5)만 클리어 → 브루저 배지만 열린다(다른 행성 인연 기체는 미해금).
    p.planetProgress[bruiser.bondPlanet] = { bestStageCleared: 1 };
    expect(ownedCosmeticsForProfile(p)).toEqual(['bruiser-ch2']);

    // 시그니처 마일스톤 도달 → 브루저 칭호도 열린다.
    p.storyMetrics[ch3.metric] = ch3.threshold;
    expect(ownedCosmeticsForProfile(p)).toEqual(['bruiser-ch2', 'bruiser-ch3']);
    expect(ownedCosmeticCount(p).owned).toBe(2);
  });
});

describe('코스메틱 i18n 완전성 (배열 파생)', () => {
  it('전 코스메틱의 cosmetic.<id>.name 이 EN·KO 양쪽에 존재한다', () => {
    expect(COSMETICS.length).toBeGreaterThan(0);
    for (const c of COSMETICS) {
      const key = cosmeticNameKey(c.id);
      expect(EN, `EN missing ${key}`).toHaveProperty(key);
      expect(KO, `KO missing ${key}`).toHaveProperty(key);
    }
  });

  it('코스메틱 문구가 비어 있지 않고 컬러 이모지를 쓰지 않는다(Pixi 두부 방지)', () => {
    for (const c of COSMETICS) {
      const key = cosmeticNameKey(c.id);
      for (const [label, table] of [
        ['EN', enT],
        ['KO', koT],
      ] as const) {
        const v = table[key] ?? '';
        expect(v.length, `${label} empty ${key}`).toBeGreaterThan(0);
        expect(v, `${label} emoji in ${key}`).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  /**
   * 고아 키 가드 — 정본 배열에서 파생되지 않는 `cosmetic.*` 키가 남아 있으면 잡는다(존재 검증은
   * 방향이 반대라 못 잡는다). slug 를 개명하면 옛 문구가 조용히 썩는다(story.* 고아 가드와 같은 논리).
   */
  it('레지스트리에서 파생되지 않는 고아 cosmetic.* 키가 없다', () => {
    const allowed = new Set(COSMETICS.map((c) => cosmeticNameKey(c.id)));
    for (const [label, table] of [
      ['EN', enT],
      ['KO', koT],
    ] as const) {
      const orphans = Object.keys(table).filter((k) => k.startsWith('cosmetic.') && !allowed.has(k));
      expect(orphans, `${label} orphan cosmetic keys`).toEqual([]);
    }
  });
});
