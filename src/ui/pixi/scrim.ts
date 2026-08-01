/**
 * 세로 알파 그라디언트 텍스처 — 밝은 키아트 위에 글자를 얹기 위한 하단 암막.
 *
 * ## 왜 띠 근사가 아니라 픽셀로 굽는가
 * ⚠️ **얇은 사각형을 겹쳐 쌓는 근사를 쓰면 안 된다.** 타이틀 화면은 처음에 18개 띠를
 * `bandH + 1` 높이로 그렸는데, 그 `+1` 때문에 인접 띠가 1px 겹치고 **겹친 줄만 알파가 두
 * 배**가 되어 25px 간격의 검은 가로줄이 화면 하단을 가로질렀다(사용자 신고, 2026-08-02).
 * 겹침을 없애면 이번엔 반올림 때문에 흰 틈이 생긴다 — 띠 근사로는 둘 중 하나를 반드시 밟는다.
 *
 * 그래서 알파 램프를 **픽셀로 직접 굽는다**. 세로로만 변하므로 폭 1px 이면 충분하고, 늘릴 때
 * `linear` 로 보간돼 이음매가 원리적으로 생기지 않는다. 드로우콜도 18 → 1 로 준다.
 *
 * 타이틀(`titleScreen.ts`)과 인트로(`introSlides.ts`)가 같은 함정을 공유하므로 한 곳에 둔다 —
 * 복사본을 만들면 한쪽만 고쳐진 채로 남는다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { CanvasSource, Texture } from 'pixi.js';

/**
 * 위에서 아래로 짙어지는 세로 그라디언트 텍스처(1×256). 캔버스가 없는 환경(테스트)에서는
 * `null` — 호출부는 스크림 없이도 화면을 세울 수 있어야 한다.
 */
export function verticalScrimTexture(topAlpha: number, bottomAlpha: number): Texture | null {
  if (typeof document === 'undefined') return null;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  for (let i = 0; i < h; i++) {
    // 감마 1.6 — 선형이면 위쪽이 너무 빨리 어두워져 키아트를 먹는다.
    const t = (i + 1) / h;
    const a = topAlpha + (bottomAlpha - topAlpha) * t ** 1.6;
    ctx.fillStyle = `rgba(10, 8, 18, ${a})`;
    ctx.fillRect(0, i, 1, 1);
  }
  const tex = new Texture({ source: new CanvasSource({ resource: canvas }) });
  tex.source.scaleMode = 'linear';
  return tex;
}
