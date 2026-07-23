/**
 * 사연 챕터 해금 **순수 판정** (스토리 시스템 Phase C·E).
 *
 * ## 왜 save 층인가 (레이어링, ADR-0023)
 * 해금 판정은 `Profile`(save)과 `data/lore`만 읽는 순수 로직이라 Pixi·UI 에 의존하지 않는다.
 * 정산 경로(`src/save/settlement.ts`)가 챕터 보상 지급을 위해 이 판정을 소비하는데, save 가
 * ui/pixi 를 import 하는 **역방향 의존**을 피하려고 판정을 여기(save)로 내렸다. 기존 UI 진입점
 * (`src/ui/pixi/storyUnlock.ts`)은 이 모듈을 그대로 **재수출**하므로 championSelect·recordsArchive·
 * storyModal·테스트 등 모든 소비처가 불변으로 동작한다.
 *
 * ## 지금 실제로 열리는 것
 * - 챕터 1(`default`) — 항상.
 * - 챕터 2(`bondPlanetClear`) — 인연 행성을 1회 이상 클리어(`planetProgress[bondPlanet]`).
 * - 챕터 3(`milestone`) — 챕터 3 unlock 의 `metric` 누적값(`storyMetrics`, 정산 경로가 채운다)이
 *   `threshold` 이상. 마일스톤 챕터가 없는 미래 구조는 방어적으로 미달성(false).
 */

import type { ShipStory, StoryChapter } from '../../data/lore/index.js';
import type { Profile } from './profile.js';

/** 한 사연의 해금 진행 상태. Phase E 가 값을 채우고, 판정은 이 구조만 본다. */
export interface StoryProgress {
  /** 이 기체의 인연 행성을 1회 이상 클리어했는가(챕터 2). */
  readonly bondPlanetCleared: boolean;
  /** 챕터 3 시그니처 마일스톤을 달성했는가(Phase E 추적 — 그 전엔 false). */
  readonly milestoneReached: boolean;
}

/** 한 챕터가 해금됐는가(순수). 해금 종류별 판정을 한곳에 모은다. */
export function chapterUnlocked(chapter: StoryChapter, progress: StoryProgress): boolean {
  switch (chapter.unlock.kind) {
    case 'default':
      return true;
    case 'bondPlanetClear':
      return progress.bondPlanetCleared;
    case 'milestone':
      return progress.milestoneReached;
  }
}

/** 해금된 챕터 수(도감 진행 표시용, 순수). */
export function unlockedChapterCount(story: ShipStory, progress: StoryProgress): number {
  return story.chapters.reduce((n, ch) => n + (chapterUnlocked(ch, progress) ? 1 : 0), 0);
}

/**
 * 프로필에서 한 사연의 진행 상태를 뽑는다. 인연 행성 클리어는 기존 `planetProgress` 로, 마일스톤은
 * `storyMetrics` 누적값으로 판정한다(Phase E). 둘 다 순수 조회 — 프로필을 읽기만 한다.
 */
export function storyProgressFromProfile(profile: Profile, story: ShipStory): StoryProgress {
  const cleared = (profile.planetProgress[story.bondPlanet]?.bestStageCleared ?? 0) >= 1;
  return { bondPlanetCleared: cleared, milestoneReached: milestoneReachedFor(profile, story) };
}

/**
 * 그 사연의 마일스톤 챕터(현재 챕터 3)가 달성됐는가 — 프로필 `storyMetrics[metric]` 누적값이 그
 * 챕터 unlock 의 `threshold` 이상인지로 판정한다. 마일스톤 챕터가 없는 미래 구조는 방어적으로
 * 미달성(false): 추적 축(metric)이 없으면 달성으로 볼 근거가 없다. 순수.
 */
function milestoneReachedFor(profile: Profile, story: ShipStory): boolean {
  for (const chapter of story.chapters) {
    if (chapter.unlock.kind === 'milestone') {
      return (profile.storyMetrics[chapter.unlock.metric] ?? 0) >= chapter.unlock.threshold;
    }
  }
  return false;
}
