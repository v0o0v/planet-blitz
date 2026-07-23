/**
 * 도감 코스메틱 — 사연 챕터 해금으로 얻는 배지·칭호 (스토리 시스템 Phase E, ADR-0023).
 *
 * ## 왜 클라 전용인가 (도발 스티커와 완전 분리)
 * 도발 스티커(`data/stickers.ts`)는 12슬롯 **고정 서버 계약**이다 — 침공 상대에게 노출되고 서버가
 * 저장·검증한다. 이 코스메틱은 정반대다: 기록 보관소·도감에서 **자기 진행을 보여주는 순수 표시물**
 * 로, 서버 저장·계약이 전혀 없다. 보유는 별도 저장 필드 없이 **사연 해금 상태에서 순수 파생**한다
 * (`storyMetrics`/`planetProgress` 로 이미 해금 판정이 되므로 중복 저장하지 않는다 — 파생 진입점은
 * src 의 `storyUnlock.ownedCosmeticsForProfile`). 스티커 12슬롯 축과는 어떤 필드도 공유하지 않는다.
 *
 * ## 결정론 경계 (ADR-0005)
 * `data/**` 규율: 무작위·시계 금지(eslint 강제). 이 모듈은 순수 상수 + 순수 조회만 둔다. 산문은
 * i18n(`cosmetic.<id>.name`)에 두고 이 모듈은 **구조와 키 유도 규칙**만 갖는다(`data/lore` 선례).
 *
 * ## 키·목록은 정본 배열 파생이다
 * 하드코딩 목록을 만들면 사연을 늘렸을 때 코스메틱·문구가 조용히 비는 자리가 생긴다. `COSMETICS`
 * 는 `SHIP_STORIES` 의 **해금 이벤트가 있는 챕터(2·3)** 에서 유도하고, i18n 완전성은
 * `tests/cosmetics.test.ts` 가 배열 파생으로 검사한다 — 사연을 append 하면 문구를 채우기 전까지
 * 빨간불로 남는다.
 */

import { SHIP_STORIES } from './lore/index.js';

/** 코스메틱 종류 — 챕터 2 해금 = 배지(인연 행성 클리어), 챕터 3 해금 = 칭호(시그니처 마일스톤). */
export type CosmeticKind = 'badge' | 'title';

/** 도감 코스메틱 1종. `id` = i18n 키(`cosmetic.<id>.name`)의 축. */
export interface Cosmetic {
  /** 안정적 식별자(`<slug>-ch<n>`, n = 챕터 번호 2·3). 재번호 금지 — 표시 자리·키의 계약. */
  readonly id: string;
  /** 부여 기체 slug(사연 주인 — `data/ships`·`data/lore` 의 slug 와 정합). */
  readonly slug: string;
  /** 부여 챕터 index(1·2 — 챕터 1은 기본 공개라 해금 이벤트가 없어 코스메틱도 없다). */
  readonly chapterIndex: 1 | 2;
  /** 종류(챕터 2 = 배지, 챕터 3 = 칭호). */
  readonly kind: CosmeticKind;
}

/** 코스메틱 id 유도 — `<slug>-ch<n>`(n = chapterIndex + 1, 즉 챕터 번호). 순수. */
export function cosmeticId(slug: string, chapterIndex: number): string {
  return `${slug}-ch${chapterIndex + 1}`;
}

/** i18n 이름 키 유도(`cosmetic.<id>.name`). 순수. */
export function cosmeticNameKey(id: string): string {
  return `cosmetic.${id}.name`;
}

/**
 * 코스메틱 정본 — 사연 챕터(해금 이벤트가 있는 챕터 2·3)에서 파생한다. `SHIP_STORIES` 를 늘리면
 * 코스메틱도 따라 늘고, i18n 완전성 테스트가 문구를 채우기 전까지 빨간불로 남는다(배열 파생 규율).
 * 챕터 2(index 1) → 배지, 챕터 3(index 2) → 칭호.
 */
export const COSMETICS: readonly Cosmetic[] = SHIP_STORIES.flatMap((story) =>
  story.chapters
    .filter((ch) => ch.index === 1 || ch.index === 2)
    .map((ch): Cosmetic => {
      const chapterIndex: 1 | 2 = ch.index === 1 ? 1 : 2;
      return {
        id: cosmeticId(story.slug, chapterIndex),
        slug: story.slug,
        chapterIndex,
        kind: chapterIndex === 1 ? 'badge' : 'title',
      };
    }),
);

/** id → 코스메틱(없으면 undefined — 호출부 방어). 순수. */
export function cosmeticById(id: string): Cosmetic | undefined {
  return COSMETICS.find((c) => c.id === id);
}

/** 한 기체 slug 의 코스메틱 전부(챕터 순). 순수. */
export function cosmeticsForSlug(slug: string): Cosmetic[] {
  return COSMETICS.filter((c) => c.slug === slug);
}

/** slug·챕터 index 로 부여 코스메틱 조회(해당 없으면 undefined). 순수. */
export function cosmeticForChapter(slug: string, chapterIndex: number): Cosmetic | undefined {
  return COSMETICS.find((c) => c.slug === slug && c.chapterIndex === chapterIndex);
}

/**
 * 보유 코스메틱 파생의 순수 진입점 — "이 (slug, 챕터 index)가 해금됐는가" 술어를 주입받아 해금된
 * 챕터의 코스메틱 id 를 낸다. `data/**` 는 프로필·해금 판정을 몰라야 하므로(레이어 분리), src 의
 * `storyUnlock` 이 프로필 기반 술어를 주입한다. 반환 순서는 `COSMETICS` 정본 순서. 순수.
 */
export function ownedCosmeticIds(
  isChapterUnlocked: (slug: string, chapterIndex: number) => boolean,
): string[] {
  return COSMETICS.filter((c) => isChapterUnlocked(c.slug, c.chapterIndex)).map((c) => c.id);
}
