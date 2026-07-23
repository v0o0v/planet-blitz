/**
 * 서사 표시 문자열 — 사연·인트로·기록 파편의 i18n 키 유도 + 조회 (스토리 시스템).
 *
 * ## 왜 별도 모듈인가 (`shipLabels.ts` 선례)
 * 챔피언 선택(사연 팝업)·기록 보관소(도감·인트로 다시보기)가 **같은 규칙**으로 서사 문자열을
 * 만들어야 한다. 키 유도 규칙을 여기 하나에 두고, 순수 키 빌더는 Pixi 미의존이라 캔버스 없이
 * 테스트한다(`tests/lore.test.ts` 가 이 빌더로 완전성을 검사).
 *
 * ## 키는 `data/lore` 정본 파생이다
 * | 대상 | 키 |
 * |---|---|
 * | 사연 태그라인 | `story.<slug>.tagline` |
 * | 사연 챕터 제목/본문 | `story.<slug>.ch<n>.title` / `.body` (n = index+1) |
 * | 사연 과제 힌트(잠금 표시) | `story.<slug>.quest.ch<n>` (n = 2·3) |
 * | 인트로 슬라이드 | `intro.<id>.title` / `.body` |
 * | 기록 파편 도감 | `shard.<id>.title` / `.body` |
 *
 * 컬러 이모지는 쓰지 않는다(`src/ui/pixi/text.ts` stripEmoji 가 두부로 떨군다).
 */

import { t, type TParams } from '../../i18n/index.js';
import type { MessageKey } from '../../i18n/catalog.js';
import { hasMessageKey, humanizeSlug } from './shipLabels.js';
import type { ShipStory, StoryChapter, IntroSlide, RecordShard } from '../../../data/lore/index.js';

/** 챕터 index(0·1·2) → 키의 챕터 번호(1·2·3). */
export function chapterNo(index: number): number {
  return index + 1;
}

// --- 순수 키 빌더 (테스트가 직접 소비 — Pixi/i18n 미의존) --------------------

export function storyTaglineKey(slug: string): string {
  return `story.${slug}.tagline`;
}
export function storyChapterTitleKey(slug: string, index: number): string {
  return `story.${slug}.ch${chapterNo(index)}.title`;
}
export function storyChapterBodyKey(slug: string, index: number): string {
  return `story.${slug}.ch${chapterNo(index)}.body`;
}
/** 사연 과제 힌트(잠긴 챕터의 해금 조건 문구). 챕터 1은 기본 공개라 힌트가 없다. */
export function storyQuestKey(slug: string, index: number): string {
  return `story.${slug}.quest.ch${chapterNo(index)}`;
}
export function introTitleKey(id: string): string {
  return `intro.${id}.title`;
}
export function introBodyKey(id: string): string {
  return `intro.${id}.body`;
}
export function recordShardTitleKey(id: string): string {
  return `shard.${id}.title`;
}
export function recordShardBodyKey(id: string): string {
  return `shard.${id}.body`;
}

/**
 * 한 사연이 요구하는 모든 i18n 키(태그라인 + 3챕터 title/body + 챕터 2·3 과제 힌트).
 * 정본 배열 파생이라 챕터 구조가 바뀌면 검증이 자동으로 따라온다.
 */
export function storyMessageKeys(story: ShipStory): string[] {
  const keys = [storyTaglineKey(story.slug)];
  for (const ch of story.chapters) {
    keys.push(storyChapterTitleKey(story.slug, ch.index), storyChapterBodyKey(story.slug, ch.index));
    // 챕터 1(index 0, 기본 공개)은 해금 힌트가 없다.
    if (ch.index > 0) keys.push(storyQuestKey(story.slug, ch.index));
  }
  return keys;
}

export function introMessageKeys(slide: IntroSlide): string[] {
  return [introTitleKey(slide.id), introBodyKey(slide.id)];
}

export function recordShardMessageKeys(shard: RecordShard): string[] {
  return [recordShardTitleKey(shard.id), recordShardBodyKey(shard.id)];
}

// --- 조회 (등재됐으면 카탈로그 문자열, 아니면 자리표시자 — 키를 화면에 노출하지 않음) ------

function tLore(key: string, fallback: string, params?: TParams): string {
  return hasMessageKey(key) ? t(key as MessageKey, params) : fallback;
}

export function storyTagline(story: ShipStory): string {
  return tLore(storyTaglineKey(story.slug), '');
}
export function storyChapterTitle(story: ShipStory, chapter: StoryChapter): string {
  return tLore(storyChapterTitleKey(story.slug, chapter.index), humanizeSlug(story.slug));
}
export function storyChapterBody(story: ShipStory, chapter: StoryChapter): string {
  return tLore(storyChapterBodyKey(story.slug, chapter.index), '');
}
export function storyQuestHint(story: ShipStory, chapter: StoryChapter): string {
  if (chapter.index === 0) return '';
  return tLore(storyQuestKey(story.slug, chapter.index), '');
}
export function introTitle(slide: IntroSlide): string {
  return tLore(introTitleKey(slide.id), humanizeSlug(slide.id));
}
export function introBody(slide: IntroSlide): string {
  return tLore(introBodyKey(slide.id), '');
}
export function recordShardTitle(shard: RecordShard): string {
  return tLore(recordShardTitleKey(shard.id), humanizeSlug(shard.id));
}
export function recordShardBody(shard: RecordShard): string {
  return tLore(recordShardBodyKey(shard.id), '');
}
