/**
 * 카툰 UI 공용 테마 상수 (격납고 파일럿, plan §3).
 *
 * Pixi 는 색을 24bit 정수로 다루므로 DOM 인벤토리(`inventory.ts` RARITY_COLOR, hex
 * 문자열)와 같은 등급 색 문법을 정수로 미러링한다. 값은 동일(파밍 시각 언어 보존, 결정 9).
 * 폰트 스택은 한글 지원 시스템 폰트 우선(handoff 지시).
 */

import type { Rarity } from '../../items/types.js';

/** 등급 → 테두리/텍스트 색(정수). inventory.ts RARITY_COLOR 와 값 동일. */
export const RARITY_COLOR_NUM: Record<Rarity, number> = {
  normal: 0xb8c2d8,
  magic: 0x6aa0ff,
  rare: 0xffd24c,
  unique: 0xff8a3c,
};

/** 한글 지원 시스템 폰트 스택(handoff). */
export const UI_FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

/** 크림/골드/회갈 등 목업 텍스트 팔레트. */
export const COLOR = {
  cream: 0xebdcbe,
  gold: 0xffd678,
  muted: 0xaa9b87,
  panelFill: 0x1c182e,
  bg: 0x181426,
  connector: 0xffd678,
} as const;

/** 텍스트 기본 다크 섀도(2px). */
export const TEXT_SHADOW = {
  color: 0x000000,
  alpha: 0.75,
  blur: 0,
  distance: 2,
  angle: Math.PI / 2,
} as const;
