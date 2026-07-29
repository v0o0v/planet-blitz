/**
 * 해저드 재질의 **공유 텍스처** 계약.
 *
 * ## 왜 이 파일이 있는가
 * 이 텍스처들은 화면에서 "부드러운 얼룩"으로만 보이므로, 잘못 구워도 육안으로는 "좀 이상한데"
 * 이상의 판정이 안 나온다. 그런데 굽는 계산은 **순수 함수**라 픽셀값을 직접 잴 수 있다 —
 * 그것이 canvas 가 아니라 `BufferImageSource` 를 고른 이유이기도 하다(node 와 브라우저가 같은
 * 코드를 탄다).
 *
 * 잡는 것 셋:
 * 1. **가장자리가 완전한 원이 아니다** — 원이면 §2-5 UI 어휘고, 로브 14개가 전부 같은 동전이 된다.
 * 2. **falloff 가 실제로 죽는다** — 가장자리에서 0 이 아니면 사각 타일 경계가 드러난다.
 * 3. **알파 채널을 쓰지 않는다** — 가산 전용이라 휘도로 굽는다는 결정이 코드에 남아 있는지.
 */

import { describe, it, expect } from 'vitest';

import {
  BLOB_TEX_SIZE,
  MOTE_TEX_SIZE,
  bakeLuminanceTexture,
  blobLuminance,
  moteLuminance,
  resetHazardTextures,
} from '../src/render/entity/hazardTexture.js';

describe('블롭 텍스처 — 로브의 실루엣', () => {
  it('중심이 가장 밝고 가장자리에서 정확히 0 이다', () => {
    expect(blobLuminance(0, 0)).toBeGreaterThan(0.9);
    for (const a of [0, 1, 2, 3, 4, 5]) {
      const ang = (a / 6) * Math.PI * 2;
      // 정확히 반경 1 지점과 그 바깥은 0 — 사각 타일 경계가 드러나면 안 된다.
      expect(blobLuminance(Math.cos(ang), Math.sin(ang)), `a=${a}`).toBe(0);
      expect(blobLuminance(Math.cos(ang) * 1.2, Math.sin(ang) * 1.2), `a=${a}`).toBe(0);
    }
  });

  it('가장자리가 완전한 원이 아니다(§2-5 — 로브 14개가 같은 동전이면 안 된다)', () => {
    // 각도마다 휘도가 0 이 되는 반경을 이분법으로 찾아 편차를 본다.
    const edgeAt = (ang: number): number => {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (blobLuminance(Math.cos(ang) * mid, Math.sin(ang) * mid) > 0) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const edges = Array.from({ length: 12 }, (_, i) => edgeAt((i / 12) * Math.PI * 2));
    const spread = Math.max(...edges) - Math.min(...edges);
    expect(spread).toBeGreaterThan(0.05);
  });

  it('휘도가 중심에서 바깥으로 단조 감소한다(고리 무늬가 생기지 않는다)', () => {
    let prev = Infinity;
    for (let d = 0; d <= 1; d += 0.02) {
      const v = blobLuminance(d, 0);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it('순수 함수다(같은 좌표면 항상 같은 값)', () => {
    expect(blobLuminance(0.3, -0.4)).toBe(blobLuminance(0.3, -0.4));
  });
});

describe('입자 텍스처', () => {
  it('중심이 밝고 가장자리에서 0 이며 블롭보다 급하게 죽는다', () => {
    expect(moteLuminance(0, 0)).toBe(1);
    expect(moteLuminance(1, 0)).toBe(0);
    // 같은 거리에서 입자가 더 어둡다 = falloff 가 더 급하다("작고 밝은 알갱이").
    expect(moteLuminance(0.5, 0)).toBeLessThan(blobLuminance(0.5, 0));
  });
});

describe('굽기 — 알파가 아니라 휘도로 굽는다', () => {
  it('모든 픽셀의 알파가 255 이고 RGB 가 서로 같다', () => {
    // 가산 합성 전용이라 알파를 쓰지 않는다 — 프리멀티플라이 규약을 아예 회피하는 결정이고,
    // 그 결정이 코드에 남아 있는지 여기서 잠근다.
    resetHazardTextures();
    const size = 8;
    const seen: number[] = [];
    const tex = bakeLuminanceTexture(size, (nx, ny) => {
      const v = Math.max(0, 1 - Math.hypot(nx, ny));
      seen.push(v);
      return v;
    });
    expect(tex).not.toBeNull();
    const px = tex?.source.resource as Uint8Array;
    expect(px.length).toBe(size * size * 4);
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i]).toBe(px[i + 1]);
      expect(px[i + 1]).toBe(px[i + 2]);
      expect(px[i + 3]).toBe(255);
    }
    expect(seen.length).toBe(size * size);
  });

  it('샘플 좌표가 [-1,1] 을 덮는다(가장자리 픽셀이 실제로 가장자리다)', () => {
    const xs: number[] = [];
    bakeLuminanceTexture(16, (nx) => {
      xs.push(nx);
      return 0;
    });
    expect(Math.min(...xs)).toBeLessThan(-0.9);
    expect(Math.max(...xs)).toBeGreaterThan(0.9);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1);
  });

  it('텍스처 크기가 실제로 반영된다', () => {
    resetHazardTextures();
    const tex = bakeLuminanceTexture(BLOB_TEX_SIZE, blobLuminance);
    expect(tex?.source.width).toBe(BLOB_TEX_SIZE);
    const mote = bakeLuminanceTexture(MOTE_TEX_SIZE, moteLuminance);
    expect(mote?.source.width).toBe(MOTE_TEX_SIZE);
  });
});
