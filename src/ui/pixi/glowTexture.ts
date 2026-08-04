/**
 * 방사형 발광 텍스처 — 가산 합성으로 얹는 광채(코로나)의 단면.
 *
 * ## 가장자리가 정확히 0 이어야 한다
 * 가산 합성에서는 **검정이 곧 투명**이다. 그래서 사각 텍스처의 가장자리가 조금이라도 밝으면
 * 화면에 네모난 얼룩으로 드러난다. 램프의 마지막 정지점은 반드시 완전한 투명이어야 하고,
 * 감쇠는 알파가 아니라 **밝기**로 준다(`titleShip.ts` 의 엔진 빌보드와 같은 규율 — 그쪽은
 * three 쪽 텍스처라 코드가 따로 있지만 이유는 하나다).
 *
 * ## 왜 Pixi 쪽에도 필요한가
 * 3D 함선은 768×512 오프스크린 캔버스에 그려진다. 넓게 번지는 광채를 그 안에서 키우면
 * 프러스텀을 넘어 **잘린 단면**이 보인다. 넓은 몫만 캔버스 밖 이 텍스처가 맡는다.
 *
 * 캔버스가 없는 환경(테스트 스텁 포함)에서는 `null` — 호출부는 광채 없이도 화면을 세워야 한다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { CanvasSource, Texture } from 'pixi.js';

/**
 * 중심 1 → 가장자리 0 인 방사형 램프(size²).
 *
 * @param stops `[정지점(0..1), 'r,g,b', 밝기(0..1)]` 목록. 마지막은 밝기 0 이어야 한다.
 */
export function radialGlowTexture(
  size: number,
  stops: readonly (readonly [number, string, number])[],
): Texture | null {
  // 존재가 아니라 **호출 가능성**을 묻는다 — 이 리포의 UI 테스트는 document 를 스텁으로 채우므로
  // `document` 는 있는데 `createElement` 가 없는 상태가 실제로 존재한다(`scrim.ts` 헤더 참조).
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (ctx === null) return null;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [at, rgb, level] of stops) grad.addColorStop(at, `rgba(${rgb}, ${level})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new Texture({ source: new CanvasSource({ resource: canvas }) });
  tex.source.scaleMode = 'linear';
  return tex;
}
