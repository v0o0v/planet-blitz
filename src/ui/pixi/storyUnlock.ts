/**
 * 사연 챕터 해금 판정의 **UI 진입점** + 도감 코스메틱 파생 (스토리 시스템 Phase C·E).
 *
 * ## 순수 판정은 save 층으로 내려갔다 (레이어링, ADR-0023)
 * `StoryProgress`·`chapterUnlocked`·`unlockedChapterCount`·`storyProgressFromProfile` 은 이제
 * `src/save/storyProgress.ts` 에 산다 — 정산 경로(`src/save/settlement.ts`)가 챕터 보상 지급에
 * 이 판정을 소비하는데, save 가 ui/pixi 를 import 하는 역방향 의존을 피하려 판정을 save 로 내렸다.
 * 이 모듈은 그것을 **재수출**하므로 championSelect·recordsArchive·storyModal·테스트 등 기존
 * 소비처는 import 경로를 바꾸지 않아도 그대로 동작한다.
 *
 * ## 도감 코스메틱 (Phase E)
 * 해금된 챕터는 배지·칭호(`data/cosmetics.ts`)를 부여한다 — **별도 저장 없이** 해금 상태에서
 * 순수 파생한다({@link ownedCosmeticsForProfile}). 도발 스티커(서버 12슬롯 계약)와 완전 분리된
 * 클라 전용 표시물이다. 코스메틱 파생만 이 UI 층에 남는다.
 */

import type { StoryProgress } from '../../save/storyProgress.js';
import { chapterUnlocked, storyProgressFromProfile } from '../../save/storyProgress.js';
import { shipStory } from '../../../data/lore/index.js';
import { COSMETICS, ownedCosmeticIds } from '../../../data/cosmetics.js';
import type { Profile } from '../../save/profile.js';

export type { StoryProgress } from '../../save/storyProgress.js';
export {
  chapterUnlocked,
  unlockedChapterCount,
  storyProgressFromProfile,
} from '../../save/storyProgress.js';

/**
 * 프로필이 보유한 도감 코스메틱 id 집합(순수 파생, Phase E). 별도 저장 필드 없이 사연 해금
 * 상태에서 유도한다 — 코스메틱이 걸린 (기체 slug, 챕터 index)가 해금됐으면 보유. `data/cosmetics`
 * 는 순수 데이터라 프로필을 모르므로(레이어 분리), 여기서 해금 술어를 주입한다.
 * ⚠️ 보유는 파생값이라 저장하지 않는다 — 해금 판정 규칙이 바뀌면 보유도 자동으로 따라온다.
 */
export function ownedCosmeticsForProfile(profile: Profile): string[] {
  const cache = new Map<string, StoryProgress>();
  return ownedCosmeticIds((slug, chapterIndex) => {
    const story = shipStory(slug);
    if (story === undefined) return false;
    let progress = cache.get(slug);
    if (progress === undefined) {
      progress = storyProgressFromProfile(profile, story);
      cache.set(slug, progress);
    }
    const chapter = story.chapters.find((c) => c.index === chapterIndex);
    return chapter !== undefined && chapterUnlocked(chapter, progress);
  });
}

/** 보유 코스메틱 개수 / 전체 코스메틱 개수(도감 진행 표시용, 순수). */
export function ownedCosmeticCount(profile: Profile): { owned: number; total: number } {
  return { owned: ownedCosmeticsForProfile(profile).length, total: COSMETICS.length };
}
