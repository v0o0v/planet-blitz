/**
 * 사연 챕터 해금 판정 (스토리 시스템 Phase C·E).
 *
 * 순수 판정({@link chapterUnlocked})과 프로필 어댑터({@link storyProgressFromProfile})를 분리한다 —
 * 판정 로직은 Pixi·save 미의존이라 단위 테스트로 고정하고, 어댑터만 `Profile` 을 읽는다.
 *
 * ## 지금 실제로 열리는 것 (Phase C)
 * - 챕터 1(`default`) — 항상.
 * - 챕터 2(`bondPlanetClear`) — **인연 행성을 1회 이상 클리어**했으면. 이 신호는 이미 프로필에
 *   있다(`planetProgress[bondPlanet].bestStageCleared >= 1`) — 새 저장 필드가 필요 없다.
 * - 챕터 3(`milestone`) — 시그니처 관련 누적 카운터가 필요하다. 그 카운터는 **Phase E** 가
 *   추적한다(sim 집계 → 프로필 영속화). 그 전까지 `milestoneReached` 는 항상 false 라 챕터 3은
 *   잠긴 채 과제 힌트만 보인다. 잠금 표시 UI 는 지금 완성되고, Phase E 가 값만 채우면 열린다.
 */

import type { ShipStory, StoryChapter } from '../../../data/lore/index.js';
import type { Profile } from '../../save/profile.js';

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
 * 프로필에서 한 사연의 진행 상태를 뽑는다. 인연 행성 클리어는 기존 `planetProgress` 로 즉시
 * 판정하고, 마일스톤은 Phase E 가 추적하기 전까지 미달성으로 둔다.
 */
export function storyProgressFromProfile(profile: Profile, story: ShipStory): StoryProgress {
  const cleared = (profile.planetProgress[story.bondPlanet]?.bestStageCleared ?? 0) >= 1;
  return { bondPlanetCleared: cleared, milestoneReached: false };
}
