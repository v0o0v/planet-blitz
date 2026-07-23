/**
 * 서사(스토리) 데이터·i18n 완전성 검증 (스토리 시스템, ADR-0023).
 *
 * 검증 목록은 전부 `data/lore` 정본 배열 파생이다(STICKERS·SHIP_TYPES 선례). 하드코딩 목록을
 * 쓰면 사연/슬라이드/파편을 append 할 때 스위트가 새 키를 모르고 그린이 된다 — 배열 파생이라
 * 항목을 늘리면 문구를 채우기 전까지 빨간불로 남는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EN, KO } from '../src/i18n/catalog.js';
import { SHIP_STORIES, INTRO_SLIDES, RECORD_SHARDS, shipStory } from '../data/lore/index.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { PLANETS } from '../data/planets/index.js';
import { SHIP_PORTRAIT_NAMES, shipPortraitName, UI_ASSET_NAMES } from '../src/ui/pixi/uiTextures.js';
import {
  storyMessageKeys,
  introMessageKeys,
  recordShardMessageKeys,
  storyChapterTitleKey,
  storyChapterBodyKey,
  storyQuestKey,
  storyTaglineKey,
  introTitleKey,
  introBodyKey,
  recordShardTitleKey,
  recordShardBodyKey,
} from '../src/ui/pixi/loreLabels.js';

const enT = EN as unknown as Record<string, string>;
const koT = KO as unknown as Record<string, string>;

/** 기록 보관소·챔피언 사연 화면 크롬(배열 파생 불가 — 고정 목록). */
const LORE_CHROME_KEYS = [
  'archive.title',
  'archive.subtitle',
  'archive.tab.stories',
  'archive.tab.shards',
  'archive.tab.intro',
  'archive.shards.progress',
  'archive.shards.locked',
  'archive.story.locked',
  'archive.story.chapter',
  'archive.intro.replay',
  'archive.empty',
  'champion.story.open',
  'champion.story.title',
];

function allDerivedStoryKeys(): string[] {
  return SHIP_STORIES.flatMap((s) => storyMessageKeys(s));
}
function allDerivedIntroKeys(): string[] {
  return INTRO_SLIDES.flatMap((s) => introMessageKeys(s));
}
function allDerivedShardKeys(): string[] {
  return RECORD_SHARDS.flatMap((s) => recordShardMessageKeys(s));
}

describe('서사 데이터 정합성 (data/lore)', () => {
  it('사연 slug 집합이 기체 레지스트리(SHIP_TYPES)와 정확히 일치한다', () => {
    const storySlugs = SHIP_STORIES.map((s) => s.slug).sort();
    const shipSlugs = SHIP_TYPES.map((s) => s.slug).sort();
    expect(storySlugs).toEqual(shipSlugs);
  });

  it('shipStory 조회가 전 기체에서 성공하고 없는 slug 는 undefined', () => {
    for (const d of SHIP_TYPES) expect(shipStory(d.slug)?.slug).toBe(d.slug);
    expect(shipStory('nonexistent')).toBeUndefined();
  });

  it('모든 사연이 정확히 3챕터(index 0·1·2)이고 해금 규칙이 챕터별로 고정이다', () => {
    for (const s of SHIP_STORIES) {
      expect(s.chapters.length, `${s.slug} chapters`).toBe(3);
      expect(s.chapters.map((c) => c.index)).toEqual([0, 1, 2]);
      // 챕터 1 = 기본 공개, 챕터 2 = 인연 행성 클리어, 챕터 3 = 시그니처 마일스톤.
      expect(s.chapters[0].unlock.kind, `${s.slug} ch1`).toBe('default');
      expect(s.chapters[1].unlock.kind, `${s.slug} ch2`).toBe('bondPlanetClear');
      expect(s.chapters[2].unlock.kind, `${s.slug} ch3`).toBe('milestone');
      // 챕터 1은 기본 공개라 보상 이벤트가 없다. 2·3은 크레딧 보상을 선언한다.
      expect(s.chapters[0].reward, `${s.slug} ch1 reward`).toBeUndefined();
      expect((s.chapters[1].reward?.credits ?? 0) > 0, `${s.slug} ch2 reward`).toBe(true);
      expect((s.chapters[2].reward?.credits ?? 0) > 0, `${s.slug} ch3 reward`).toBe(true);
    }
  });

  it('챕터 3 마일스톤 metric 은 기체마다 고유하고 threshold 는 양수다', () => {
    const metrics = new Set<string>();
    for (const s of SHIP_STORIES) {
      const ch3 = s.chapters[2].unlock;
      if (ch3.kind !== 'milestone') throw new Error(`${s.slug} ch3 not milestone`);
      expect(ch3.metric.length, `${s.slug} metric`).toBeGreaterThan(0);
      expect(ch3.threshold, `${s.slug} threshold`).toBeGreaterThan(0);
      expect(metrics.has(ch3.metric), `${s.slug} duplicate metric ${ch3.metric}`).toBe(false);
      metrics.add(ch3.metric);
    }
  });

  it('인연 행성(bondPlanet)이 유효한 행성 인덱스다', () => {
    const validIndices = new Set(PLANETS.map((p) => p.index));
    for (const s of SHIP_STORIES) {
      expect(validIndices.has(s.bondPlanet), `${s.slug} bondPlanet ${s.bondPlanet}`).toBe(true);
    }
  });

  it('초상 basename 이 slug 파생이고 중복이 없다', () => {
    const names = SHIP_STORIES.map((s) => s.portrait);
    expect(new Set(names).size).toBe(names.length);
    for (const s of SHIP_STORIES) expect(s.portrait).toBe(`ship_portrait_${s.slug}.png`);
  });

  it('인트로 슬라이드·기록 파편 id 가 비지 않고 중복이 없다', () => {
    expect(INTRO_SLIDES.length).toBeGreaterThan(0);
    expect(RECORD_SHARDS.length).toBeGreaterThan(0);
    const introIds = INTRO_SLIDES.map((s) => s.id);
    const shardIds = RECORD_SHARDS.map((s) => s.id);
    expect(new Set(introIds).size).toBe(introIds.length);
    expect(new Set(shardIds).size).toBe(shardIds.length);
    for (const id of [...introIds, ...shardIds]) expect(id.length).toBeGreaterThan(0);
  });
});

describe('서사 i18n 완전성 (배열 파생)', () => {
  it('전 사연 키(태그라인·3챕터 title/body·챕터2·3 과제)가 EN·KO 양쪽에 존재한다', () => {
    for (const key of allDerivedStoryKeys()) {
      expect(EN, `EN missing ${key}`).toHaveProperty(key);
      expect(KO, `KO missing ${key}`).toHaveProperty(key);
    }
  });

  it('전 인트로 슬라이드·기록 파편 키가 EN·KO 양쪽에 존재한다', () => {
    for (const key of [...allDerivedIntroKeys(), ...allDerivedShardKeys()]) {
      expect(EN, `EN missing ${key}`).toHaveProperty(key);
      expect(KO, `KO missing ${key}`).toHaveProperty(key);
    }
  });

  it('기록 보관소·사연 화면 크롬 키가 EN·KO 양쪽에 존재한다', () => {
    for (const key of LORE_CHROME_KEYS) {
      expect(EN, `EN missing ${key}`).toHaveProperty(key);
      expect(KO, `KO missing ${key}`).toHaveProperty(key);
    }
  });

  it('서사 문구가 비어 있지 않고 컬러 이모지를 쓰지 않는다(Pixi 두부 방지)', () => {
    const keys = [
      ...allDerivedStoryKeys(),
      ...allDerivedIntroKeys(),
      ...allDerivedShardKeys(),
      ...LORE_CHROME_KEYS,
    ];
    for (const key of keys) {
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
   * 고아 키 가드 — 정본 배열에서 **파생되지 않는** `story.*` / `intro.*` / `shard.*` 키가
   * 남아 있으면 잡는다(존재 검증은 방향이 반대라 못 잡는다). slug·id 를 개명하면 옛 문구가
   * 조용히 썩는다. 화면 크롬(`archive.*`·`champion.story.*`)은 고정 목록이라 별도 존재 검증만.
   */
  it('레지스트리에서 파생되지 않는 고아 story.* / intro.* / shard.* 키가 없다', () => {
    const allowed = new Set([
      ...allDerivedStoryKeys(),
      ...allDerivedIntroKeys(),
      ...allDerivedShardKeys(),
    ]);
    for (const [label, table] of [
      ['EN', enT],
      ['KO', koT],
    ] as const) {
      const orphans = Object.keys(table).filter(
        (k) =>
          (k.startsWith('story.') || k.startsWith('intro.') || k.startsWith('shard.')) &&
          !allowed.has(k),
      );
      expect(orphans, `${label} orphan lore keys`).toEqual([]);
    }
  });

  /**
   * 키 빌더 자체의 형태 회귀 가드. 챕터 index(0·1·2) → 키 번호(1·2·3) 매핑이 어긋나면
   * 화면과 카탈로그가 서로 다른 키를 보게 된다.
   */
  it('키 빌더가 예상한 문자열을 만든다', () => {
    expect(storyTaglineKey('striker')).toBe('story.striker.tagline');
    expect(storyChapterTitleKey('bruiser', 0)).toBe('story.bruiser.ch1.title');
    expect(storyChapterBodyKey('bruiser', 2)).toBe('story.bruiser.ch3.body');
    expect(storyQuestKey('phantom', 1)).toBe('story.phantom.quest.ch2');
    expect(introTitleKey('collapse')).toBe('intro.collapse.title');
    expect(introBodyKey('launch')).toBe('intro.launch.body');
    expect(recordShardTitleKey('echoes')).toBe('shard.echoes.title');
    expect(recordShardBodyKey('overflow')).toBe('shard.overflow.body');
  });
});

describe('기체 초상 자산 (ship_portrait_*)', () => {
  it('초상 basename 이 레지스트리 파생이고 lore 정본(ShipStory.portrait)과 일치한다', () => {
    expect(SHIP_PORTRAIT_NAMES.length).toBe(SHIP_TYPES.length);
    expect(new Set(SHIP_PORTRAIT_NAMES).size).toBe(SHIP_TYPES.length);
    for (const d of SHIP_TYPES) {
      const expected = `ship_portrait_${d.slug}.png`;
      expect(shipPortraitName(d.id), `${d.slug} name`).toBe(expected);
      // lore 데이터가 선언한 초상 파일명과 로더 파생이 어긋나면 화면이 다른 파일을 찾는다.
      expect(shipStory(d.slug)?.portrait, `${d.slug} lore portrait`).toBe(expected);
    }
  });

  it('쇼케이스와 달리 초상은 레거시 예외가 없다(스트라이커도 slug 파일)', () => {
    expect(shipPortraitName(0)).toBe('ship_portrait_striker.png');
  });

  it('손상된 typeId 도 존재하지 않는 초상 파일명을 만들지 않는다(0 으로 복귀)', () => {
    for (const bad of [999, -1, Number.NaN, SHIP_TYPES.length]) {
      expect(shipPortraitName(bad)).toBe('ship_portrait_striker.png');
    }
  });

  it('초상 전종이 UI 로더 목록(UI_ASSET_NAMES)에 등재돼 있다(등재 누락 = 조용한 null)', () => {
    for (const name of SHIP_PORTRAIT_NAMES) expect(UI_ASSET_NAMES).toContain(name);
  });

  /**
   * **디스크 실재 초상의 규격 가드.** 존재를 강제하지 않는다(아트는 코드보다 늦게 올 수 있고
   * 폴백이 흡수) — 단 **있는 파일은** 유효 PNG + 128×128 이어야 한다. 잘못된 크기를 인게임에
   * 떨어뜨리면 화면에서만 티가 난다(쇼케이스 스프라이트 규격 가드 선례).
   */
  it('assets/ 에 있는 초상은 유효 PNG + 128x128 이다', () => {
    const be32 = (b: Uint8Array, off: number): number =>
      new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(off, false);
    for (const name of SHIP_PORTRAIT_NAMES) {
      let buf: Uint8Array | null;
      try {
        buf = readFileSync(fileURLToPath(new URL(`../assets/${name}`, import.meta.url)));
      } catch {
        buf = null; // 아직 안 온 아트 — 폴백이 흡수한다.
      }
      if (buf === null) continue;
      expect([...buf.slice(1, 4)].map((c) => String.fromCharCode(c)).join(''), `${name} PNG`).toBe(
        'PNG',
      );
      expect(be32(buf, 16), `${name} width`).toBe(128);
      expect(be32(buf, 20), `${name} height`).toBe(128);
    }
  });
});
