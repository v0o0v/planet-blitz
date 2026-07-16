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
