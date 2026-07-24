/**
 * 프로토타입 갤러리 레지스트리 (Phase 1 — plan §AC-1.2/1.5; ADR-0031).
 *
 * 6종 변형군(폭발·글로우·디졸브·충격파·전환·세리머니)을 한 배열로 모아 갤러리 씬과 배선 스모크
 * 테스트가 공유한다. 표시 순서 = 이 배열 순서. 각 그룹은 자기 파일이 소유하며(변경은 그 파일에서),
 * 여기서는 취합만 한다.
 */

import type { GalleryGroup } from './types.js';
import { explosionGroup } from './explosionVariants.js';
import { glowGroup } from './glowVariants.js';
import { dissolveGroup } from './dissolveVariants.js';
import { shockwaveGroup } from './shockwaveVariants.js';
import { transitionGroup } from './transitionVariants.js';
import { ceremonyGroup } from './ceremonyVariants.js';

/** 갤러리에 표시되는 6개 변형군(표시 순서 = 배열 순서). */
export const GALLERY_GROUPS: readonly GalleryGroup[] = [
  explosionGroup,
  glowGroup,
  dissolveGroup,
  shockwaveGroup,
  transitionGroup,
  ceremonyGroup,
];

export type {
  GalleryGroup,
  GalleryGroupId,
  GalleryVariant,
  GalleryVariantHandle,
  GalleryVariantContext,
} from './types.js';
