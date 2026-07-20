/**
 * 공용 UI 픽셀아트 아이콘 (PixelLab 생성 — M3 잔여 아트 패스).
 *
 * 이모지 폴백(🔒/🔓)을 대체하는 32px 자물쇠 아이콘 URL과, DOM 오버레이에서 픽셀이
 * 뭉개지지 않게 하는 <img> 팩토리를 제공한다. 렌더 전용 — sim 불변.
 */

import lockPng from '../../assets/ui_lock.png';
import unlockPng from '../../assets/ui_unlock.png';

export const UI_LOCK_URL = lockPng;
export const UI_UNLOCK_URL = unlockPng;

// 아직 생성되지 않았을 수 있는 아이콘(장비/스킬/파워업 합성)은 정적 import 를 쓸 수 없다
// (없으면 빌드가 깨진다). `uiTextures.ts` 의 glob + null 폴백 규약을 DOM 쪽에도 그대로 적용해
// 존재하는 PNG 만 URL 로 잡고, 없으면 undefined → 소비 측이 텍스트로 폴백한다.
// assets 는 평면 구조다(glob 비재귀).
const ASSET_URLS = import.meta.glob('../../assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 아이콘 키(확장자 없는 basename) → URL. 자산이 없으면 undefined. */
export function iconUrl(key: string): string | undefined {
  const suffix = `/${key}.png`;
  for (const path in ASSET_URLS) {
    if (path.endsWith(suffix)) return ASSET_URLS[path];
  }
  return undefined;
}

/** 픽셀아트용 <img> 생성(nearest-neighbor 확대, 드래그 방지). */
export function pixelIcon(url: string, size: number, alt = ''): HTMLImageElement {
  const img = document.createElement('img');
  img.src = url;
  img.alt = alt;
  img.width = size;
  img.height = size;
  img.draggable = false;
  img.style.imageRendering = 'pixelated';
  return img;
}
