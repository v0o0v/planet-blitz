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
  /** 밝은 바탕(노란 버튼 등) 위 라벨용 진한 갈색 — 흰 글씨가 묻히는 것을 막는다. */
  darkLabel: 0x4a2a08,
} as const;

/**
 * '#rrggbb' CSS 색 → Pixi 정수색. 형식이 어긋나면 중립 회청색으로 폴백한다.
 *
 * DOM 판이 소유한 팔레트(행성 `accent`, 방어 카드 등급색 …)를 캔버스에서 그대로 쓰기 위한
 * 변환이다. 성계 지도(#4)와 관제탑(#6) 두 화면이 쓰므로 여기로 올렸다(ADR-0014 공용 경계).
 */
export function hexColor(css: string): number {
  const n = Number.parseInt(css.replace('#', ''), 16);
  return Number.isNaN(n) ? 0x8896b8 : n;
}

/** 텍스트 기본 다크 섀도(2px). */
export const TEXT_SHADOW = {
  color: 0x000000,
  alpha: 0.75,
  blur: 0,
  distance: 2,
  angle: Math.PI / 2,
} as const;
