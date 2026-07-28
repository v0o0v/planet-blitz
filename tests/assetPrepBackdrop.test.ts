/**
 * scripts/asset-prep.mjs 의 `backdrop` 서브커맨드 단위 테스트.
 *
 * 침공 배경은 `TilingSprite`(src/render/invasionBackdrop.ts) 라 자산이 **seamless 가
 * 아니면 화면 전체에 격자가 뜬다.** 그래서 이 파이프라인의 핵심은 예쁜 그림이 아니라
 * ① Wang 세트에서 **자기 자신과 이어지는 유일한 타일**(전-모서리-upper)을 고르는 것과
 * ② 결과물의 이음매를 **쓰기 전에 재서 막는 것**이다. 둘 다 여기서 잠근다.
 *
 * 특히 이음매 판정은 두 번 틀린 끝에 지금 형태가 됐고, 그 두 실패를 여기 케이스로 남긴다:
 *   ① "wrap <= 내부 평균" → 내부 대비가 큰 그림에서 이음매를 **통과시켰다**(거짓 음성).
 *   ② "wrap 이 분포의 이상치인가(z>=3)" → 주기적 줄무늬처럼 드문 고대비 경계만 있는 그림에서
 *      **완벽히 이어지는데도 z=4.0** 으로 잡았다(거짓 양성).
 * 그래서 양방향으로 건다 — 이어지는 그림은 통과해야 하고, 일부러 끊은 그림은 잡혀야 한다.
 *
 * 테스트용 PNG 는 바이너리 픽스처를 커밋하지 않고 encodePng 로 코드에서 합성한다
 * (assetPrepSliceSheet.test.ts 와 같은 규율).
 */

import { describe, it, expect } from 'vitest';
import {
  decodePng,
  encodePng,
  extractFillTile,
  grainBase,
  composeBackdrop,
  seamReport,
  parseBackdropArgs,
  BACKDROP_SIZE,
  BACKDROP_PALETTES,
  type PngImage,
  type TilesetMeta,
  type WangCorner,
} from '../scripts/asset-prep.mjs';

/** 4×4 Wang 시트(32px 타일)를 만든다. 타일마다 값이 달라 어느 칸을 집었는지 식별된다. */
function makeSheet(fillValue: number): PngImage {
  const T = 32;
  const W = T * 4;
  const pixels = new Uint8Array(W * W * 4);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const cell = Math.floor(y / T) * 4 + Math.floor(x / T);
      const i = (y * W + x) * 4;
      // 채움 타일(3행 0열 = bounding_box 0,96)만 균일한 fillValue, 나머지는 칸마다 다른 값.
      const v = cell === 12 ? fillValue : 10 + cell * 7;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  return { width: W, height: W, colorType: 6, channels: 4, pixels };
}

/** 실제 PixelLab 메타와 같은 배치(전-모서리-upper 는 bounding_box 0,96). */
function makeMeta(): TilesetMeta {
  const corners: [WangCorner, WangCorner, WangCorner, WangCorner][] = [
    ['upper', 'upper', 'upper', 'lower'], ['upper', 'lower', 'lower', 'upper'],
    ['lower', 'upper', 'lower', 'lower'], ['upper', 'upper', 'lower', 'lower'],
    ['lower', 'upper', 'lower', 'upper'], ['upper', 'lower', 'lower', 'lower'],
    ['lower', 'lower', 'lower', 'lower'], ['lower', 'lower', 'upper', 'lower'],
    ['upper', 'lower', 'upper', 'upper'], ['lower', 'lower', 'upper', 'upper'],
    ['lower', 'lower', 'lower', 'upper'], ['lower', 'upper', 'upper', 'lower'],
    ['upper', 'upper', 'upper', 'upper'], ['upper', 'upper', 'lower', 'upper'],
    ['upper', 'lower', 'upper', 'lower'], ['lower', 'upper', 'upper', 'upper'],
  ];
  return {
    tileset_data: {
      tiles: corners.map(([NW, NE, SE, SW], i) => ({
        name: `wang_${i}`,
        corners: { NW, NE, SE, SW },
        bounding_box: { x: (i % 4) * 32, y: Math.floor(i / 4) * 32, width: 32, height: 32 },
      })),
    },
  };
}

describe('asset-prep backdrop — Wang 채움 타일 추출', () => {
  it('전-모서리-upper 타일만 고른다(전이 타일을 집으면 이음매가 생긴다)', () => {
    const tile = extractFillTile(makeSheet(200), makeMeta());
    expect(tile.width).toBe(32);
    expect(tile.height).toBe(32);
    // 그 칸만 균일한 200 이므로, 다른 칸을 집었다면 값이 다르다.
    expect(tile.pixels[0]).toBe(200);
    expect(tile.pixels[(31 * 32 + 31) * 4]).toBe(200);
  });

  it('전-모서리-upper 타일이 없으면 조용히 넘어가지 않고 던진다', () => {
    const meta = makeMeta();
    meta.tileset_data.tiles[12]!.corners.NW = 'lower';
    expect(() => extractFillTile(makeSheet(200), meta)).toThrow(/전-모서리-upper/);
  });
});

describe('asset-prep backdrop — 편차 합성', () => {
  it('타일의 평균 밝기를 배경에 끌고 오지 않는다(팔레트 밝기 보존)', () => {
    // 밝은 타일(230)을 어두운 팔레트에 실어도 평균이 팔레트 base 여야 한다.
    // tint 방식이었다면 배경이 통째로 밝아진다 — 그러면 엔티티 가독성이 깎인다.
    const tile = extractFillTile(makeSheet(230), makeMeta());
    const base = BACKDROP_PALETTES[1]!.base;
    const px = grainBase(tile, BACKDROP_SIZE, base, 1);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i]!;
    const mean = sum / (px.length / 4);
    expect(mean).toBeCloseTo((base >> 16) & 255, 0);
  });

  it('gain 이 0 이면 팔레트 단색이다(결이 전혀 안 실린다)', () => {
    const tile = extractFillTile(makeSheet(230), makeMeta());
    const base = BACKDROP_PALETTES[0]!.base;
    const px = grainBase(tile, BACKDROP_SIZE, base, 0);
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i]).toBe((base >> 16) & 255);
      expect(px[i + 3]).toBe(255);
    }
  });
});

describe('asset-prep backdrop — 이음매 판정', () => {
  /** 좌우가 이어지는 세로 줄무늬(주기 32 → 256 을 정확히 나눈다). */
  function seamlessStripes(): PngImage {
    const S = BACKDROP_SIZE;
    const pixels = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = x % 32 < 16 ? 40 : 90;
        const i = (y * S + x) * 4;
        pixels[i] = v; pixels[i + 1] = v; pixels[i + 2] = v; pixels[i + 3] = 255;
      }
    }
    return { width: S, height: S, colorType: 6, channels: 4, pixels };
  }

  /** 같은 줄무늬인데 마지막 열만 뚝 끊긴다 — wrap 경계에서만 튀는 전형적 이음매. */
  function seamedStripes(): PngImage {
    const img = seamlessStripes();
    const S = BACKDROP_SIZE;
    for (let y = 0; y < S; y++) {
      const i = (y * S + (S - 1)) * 4;
      img.pixels[i] = 255; img.pixels[i + 1] = 255; img.pixels[i + 2] = 255;
    }
    return img;
  }

  it('이어지는 그림은 통과한다 — 정상 경계를 이음매로 오판하지 않는다', () => {
    // ⚠️ 이 케이스가 z-score 판정을 기각시켰다. 주기적 줄무늬는 내부 인접 쌍 대부분이 0 이고
    // 경계 16곳만 튀어서, **완벽히 이어지는데도** wrap 이 z=4.0 으로 이상치로 잡혔다.
    expect(seamReport(seamlessStripes()).seamless).toBe(true);
  });

  it('실제로 끊긴 그림을 잡아낸다(항진 테스트가 아니다)', () => {
    expect(seamReport(seamedStripes()).seamless).toBe(false);
  });

  it('내부 대비가 큰 그림에서도 이음매를 놓치지 않는다', () => {
    // ⚠️ 이 케이스가 "wrap <= 내부 평균" 판정을 기각시켰다. 내부 평균이 크면 이음매가 묻힌다.
    expect(seamReport(seamedStripes()).wrapX).toBeGreaterThan(seamReport(seamedStripes()).limitX);
  });
});

describe('asset-prep backdrop — 합성 산출물', () => {
  it('256² RGBA 를 내고 이음매가 없다', () => {
    const sheetBuf = encodePng(makeSheet(200));
    const { buf, tileName } = composeBackdrop(sheetBuf, makeMeta(), 1);
    expect(tileName).toBe('wang_12');
    const img = decodePng(buf);
    expect(img.width).toBe(BACKDROP_SIZE);
    expect(img.height).toBe(BACKDROP_SIZE);
    expect(seamReport(img).seamless).toBe(true);
  });

  it('범위 밖 레이어는 던진다', () => {
    const sheetBuf = encodePng(makeSheet(200));
    expect(() => composeBackdrop(sheetBuf, makeMeta(), 3)).toThrow(/layer/);
  });
});

describe('asset-prep backdrop — CLI 인자', () => {
  it('필수 인자를 파싱한다', () => {
    const a = parseBackdropArgs(['sheet.png', '--meta', 'm.json', '--layer', '2', '--out', 'bg.png']);
    expect(a).toEqual({ sheetPath: 'sheet.png', metaPath: 'm.json', layer: 2, out: 'bg.png', gain: 0.25 });
  });

  it('--meta / --out 누락을 던진다', () => {
    expect(() => parseBackdropArgs(['s.png', '--layer', '0', '--out', 'o.png'])).toThrow(/--meta/);
    expect(() => parseBackdropArgs(['s.png', '--meta', 'm.json', '--layer', '0'])).toThrow(/--out/);
  });
});
