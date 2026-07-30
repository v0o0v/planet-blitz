/**
 * 렌더러 해상도가 **현재** devicePixelRatio 를 따라가는지 검증
 * (사용자 신고 2026-07-30 "글씨가 전체적으로 뿌옇게 보인다").
 *
 * ## 결함의 실체
 *
 * `app.init({ resolution })` 은 초기화 순간의 dpr 을 **한 번 읽고 굳는다**. 그런데 dpr 은 페이지가
 * 떠 있는 동안 바뀐다 — 브라우저 확대/축소(Ctrl +/−), 창을 배율이 다른 모니터로 옮기기, OS
 * 디스플레이 배율 변경. `resizeTo: window` 는 캔버스 **크기**만 따라가고 해상도는 손대지 않으므로,
 * 캔버스는 옛 해상도로 그린 뒤 브라우저가 늘려서 표시한다.
 *
 * 실측(신고 재현): dpr 1.25 인데 `renderer.resolution` 1 → 백버퍼 1712×963 을 물리 2140×1204 로
 * 확대. 글자뿐 아니라 픽셀아트·패널까지 **화면 전체**가 보간되어 흐려졌다. 텍스트 렌더링과는
 * 무관한 결함이라 "폰트가 뿌옇다"로 오진하기 쉽다.
 *
 * 여기서는 순수 판정 로직만 잠근다. 실제 재동기화(리사이즈 경로·matchMedia 재무장)는 WebGL 이
 * 필요해 하네스에서 확인했다: dpr 1.25 → 2 로 바꾸자 resolution 이 2 로 따라가고 백버퍼가
 * 3424×1926 으로 재생성, 되돌리자 1.25/2140×1204 로 복귀.
 */

import { describe, it, expect } from 'vitest';

import {
  rendererResolutionFor,
  shouldResyncResolution,
  MAX_RENDERER_RESOLUTION,
} from '../src/render/app.js';

describe('rendererResolutionFor', () => {
  it('dpr 을 그대로 쓰되 상한에서 자른다', () => {
    expect(rendererResolutionFor(1)).toBe(1);
    expect(rendererResolutionFor(1.25)).toBe(1.25);
    expect(rendererResolutionFor(2)).toBe(2);
    expect(rendererResolutionFor(3)).toBe(MAX_RENDERER_RESOLUTION);
  });

  it('비정상 dpr 은 1 로 본다 (0·음수·NaN·Infinity)', () => {
    expect(rendererResolutionFor(0)).toBe(1);
    expect(rendererResolutionFor(-2)).toBe(1);
    expect(rendererResolutionFor(Number.NaN)).toBe(1);
    expect(rendererResolutionFor(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('shouldResyncResolution', () => {
  it('dpr 이 바뀌면 재동기화가 필요하다고 판정한다 — 이게 빠져서 화면이 흐려졌다', () => {
    expect(shouldResyncResolution(1, 1.25)).toBe(true); // 신고 상황
    expect(shouldResyncResolution(1.25, 1)).toBe(true); // 되돌아가는 방향도
    expect(shouldResyncResolution(1.25, 2)).toBe(true);
  });

  it('같은 값이면 재동기화하지 않는다 — 매 리사이즈마다 백버퍼를 재생성하지 않기 위해', () => {
    expect(shouldResyncResolution(1, 1)).toBe(false);
    expect(shouldResyncResolution(1.25, 1.25)).toBe(false);
    expect(shouldResyncResolution(1.25, 1.2501)).toBe(false); // 부동소수 오차
  });

  it('둘 다 상한을 넘으면 같은 값으로 본다', () => {
    expect(shouldResyncResolution(2, 3)).toBe(false);
    expect(shouldResyncResolution(2, 4)).toBe(false);
  });
});
