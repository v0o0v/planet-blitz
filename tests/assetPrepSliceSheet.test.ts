/**
 * scripts/asset-prep.mjs 의 `slice-sheet` 서브커맨드(ADR-0016) 단위 테스트.
 *
 * PixelLab `create_ui_asset` 시트(가로 N칸)를 64×64 낱장 아이콘으로 자르는
 * 알고리즘을 검증한다: 알파 바운딩박스 crop → 비율 유지 nearest-neighbor 축소 →
 * 안쪽 여백을 지키며 중앙 배치. 테스트용 PNG는 바이너리 픽스처를 커밋하는 대신
 * encodePng로 코드에서 직접 합성한다.
 *
 * asset-prep.mjs는 "의존성 0" plain JS(.mjs)로 남기고(allowJs는 켜지 않음),
 * scripts/asset-prep.d.mts 컴패니언 선언 파일로만 타입을 제공한다. 마찬가지로
 * @types/node 없이 tests/node-shims.d.ts 최소 선언으로 필요한 node 빌트인만 쓴다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodePng,
  encodePng,
  computeAlphaBBox,
  sliceCellToIcon,
  splitSheetCells,
  sliceSheet,
  parseSliceSheetArgs,
  type PngImage,
} from '../scripts/asset-prep.mjs';

type OpaqueRect = { x: number; y: number; w: number; h: number; r?: number; g?: number; b?: number };

/** Build an RGBA test image: fully transparent except an opaque rect [x, x+w) × [y, y+h). */
function makeRGBA(width: number, height: number, rect: OpaqueRect | null): PngImage {
  const pixels = new Uint8Array(width * height * 4);
  if (rect) {
    const { x, y, w, h, r = 200, g = 100, b = 50 } = rect;
    for (let ry = y; ry < y + h; ry++) {
      for (let rx = x; rx < x + w; rx++) {
        const i = (ry * width + rx) * 4;
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = 255;
      }
    }
  }
  return { width, height, colorType: 6, channels: 4, pixels };
}

describe('computeAlphaBBox', () => {
  it('사방 투명 여백이 있는 이미지에서 불투명 사각형의 정확한 bbox를 구한다', () => {
    // 20×20 캔버스, (5,7)에서 8×6 크기 불투명 사각형 (사방에 여백).
    const img = makeRGBA(20, 20, { x: 5, y: 7, w: 8, h: 6 });
    const bbox = computeAlphaBBox(img);
    expect(bbox).toEqual({ x: 5, y: 7, width: 8, height: 6 });
  });

  it('완전 불투명 이미지는 전체 크기를 bbox로 반환한다', () => {
    const img = makeRGBA(10, 10, { x: 0, y: 0, w: 10, h: 10 });
    expect(computeAlphaBBox(img)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});

describe('sliceCellToIcon — 비율 유지 축소 + 중앙 배치', () => {
  it('가로로 긴 그림은 가로가 꽉 차고 세로는 비율대로만 줄어 세로 중앙에 배치된다', () => {
    // 셀 안에 40×10(가로로 긴) 불투명 사각형. size=64, pad=2 → 안쪽 최대 60×60.
    // contain 배율 = min(60/40, 60/10) = 1.5 → 60×15로 스케일(세로가 60으로
    // 늘어나지 않고 비율대로 15에 그침).
    const cell = makeRGBA(50, 20, { x: 5, y: 5, w: 40, h: 10 });
    const { image, empty } = sliceCellToIcon(cell, { size: 64, pad: 2 });
    expect(empty).toBe(false);
    expect(image.width).toBe(64);
    expect(image.height).toBe(64);

    const bbox = computeAlphaBBox(image);
    expect(bbox).not.toBeNull();
    expect(bbox!.width).toBe(60);
    expect(bbox!.height).toBe(15); // NOT stretched to 60 — aspect ratio preserved.
    // 가로: 정확히 안쪽 여백 2px에 닿는다 (2..61).
    expect(bbox!.x).toBe(2);
    expect(bbox!.x + bbox!.width - 1).toBe(61);
    // 세로: 캔버스 중앙에 대칭 배치 ((64-15)/2 = 24.5 → floor 24, 여백 24/25).
    expect(bbox!.y).toBe(24);
  });

  it('완전 투명 칸은 크래시 없이 처리되고 empty=true, 빈 64×64 캔버스를 반환한다', () => {
    const emptyCell = makeRGBA(30, 30, null);
    expect(() => sliceCellToIcon(emptyCell, { size: 64, pad: 2 })).not.toThrow();
    const { image, empty } = sliceCellToIcon(emptyCell, { size: 64, pad: 2 });
    expect(empty).toBe(true);
    expect(image.width).toBe(64);
    expect(image.height).toBe(64);
    expect(computeAlphaBBox(image)).toBeNull();
    // 전 픽셀이 알파 0(완전 투명).
    expect(image.pixels.every((v: number) => v === 0)).toBe(true);
  });
});

describe('sliceCellToIcon — 안쪽 여백 준수', () => {
  it('정사각형에 딱 맞는 그림은 size-2*pad 로 스케일되어 사방에 정확히 pad px 여백을 남긴다', () => {
    // 30×30 정사각 불투명 영역 → size=64,pad=2 → 60×60로 스케일, 사방 여백 정확히 2px.
    const cell = makeRGBA(40, 40, { x: 5, y: 5, w: 30, h: 30 });
    const { image } = sliceCellToIcon(cell, { size: 64, pad: 2 });
    const bbox = computeAlphaBBox(image);
    expect(bbox).toEqual({ x: 2, y: 2, width: 60, height: 60 });
  });

  it('--pad 값을 바꾸면 여백도 그만큼 바뀐다', () => {
    const cell = makeRGBA(40, 40, { x: 5, y: 5, w: 30, h: 30 });
    const { image } = sliceCellToIcon(cell, { size: 64, pad: 5 });
    const bbox = computeAlphaBBox(image);
    expect(bbox).not.toBeNull();
    expect(bbox!.x).toBe(5);
    expect(bbox!.y).toBe(5);
    expect(bbox!.width).toBe(54);
    expect(bbox!.height).toBe(54);
  });
});

describe('splitSheetCells + sliceSheet — 시트 균등 분할 통합', () => {
  it('512×192 3칸 시트를 균등 분할하고 각 칸을 독립적으로 아이콘화한다', () => {
    const width = 512;
    const height = 192;
    const pixels = new Uint8Array(width * height * 4);
    // 3칸 각각에 서로 다른 위치의 마커 사각형을 심는다(칸 폭은 대략 170~171px).
    const markers: OpaqueRect[] = [
      { x: 20, y: 20, w: 20, h: 20 }, // cell 0
      { x: 190, y: 60, w: 30, h: 10 }, // cell 1 (경계 근처 170 넘어서 시작)
      { x: 400, y: 100, w: 15, h: 15 }, // cell 2
    ];
    for (const { x, y, w, h } of markers) {
      for (let ry = y; ry < y + h; ry++) {
        for (let rx = x; rx < x + w; rx++) {
          const i = (ry * width + rx) * 4;
          pixels[i] = 255;
          pixels[i + 3] = 255;
        }
      }
    }
    const sheet: PngImage = { width, height, colorType: 6, channels: 4, pixels };

    const cells = splitSheetCells(sheet, 3);
    expect(cells).toHaveLength(3);
    // 균등 분할: 폭 합이 원본과 같고, 각 칸 폭이 거의 동일(반올림 오차 이내).
    const widths = cells.map((c) => c.width);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(width);
    for (const w of widths) expect(Math.abs(w - width / 3)).toBeLessThanOrEqual(1);

    const icons = sliceSheet(sheet, { cols: 3, size: 64, pad: 2 });
    expect(icons).toHaveLength(3);
    for (const { image, empty } of icons) {
      expect(empty).toBe(false);
      expect(image.width).toBe(64);
      expect(image.height).toBe(64);
      expect(computeAlphaBBox(image)).not.toBeNull();
    }
  });
});

describe('parseSliceSheetArgs', () => {
  it('필수 옵션이 모두 있으면 기본값과 함께 파싱된다', () => {
    const parsed = parseSliceSheetArgs(['sheet.png', '--out', 'out/icons', '--names', 'a,b,c']);
    expect(parsed).toEqual({
      sheetPath: 'sheet.png',
      outDir: 'out/icons',
      names: ['a', 'b', 'c'],
      cols: 3,
      size: 64,
      pad: 2,
    });
  });

  it('--cols/--size/--pad 를 오버라이드할 수 있다', () => {
    const parsed = parseSliceSheetArgs([
      'sheet.png', '--out', 'out', '--names', 'x,y', '--cols', '2', '--size', '32', '--pad', '1',
    ]);
    expect(parsed).toMatchObject({ cols: 2, size: 32, pad: 1, names: ['x', 'y'] });
  });

  it('--names 개수가 --cols 와 다르면 명확한 에러를 던진다', () => {
    expect(() =>
      parseSliceSheetArgs(['sheet.png', '--out', 'out', '--names', 'a,b', '--cols', '3']),
    ).toThrow(/--names must list exactly 3/);
  });

  it('시트 경로/--out/--names 가 없으면 각각 명확한 에러를 던진다', () => {
    expect(() => parseSliceSheetArgs([])).toThrow(/missing <sheet\.png>/);
    expect(() => parseSliceSheetArgs(['sheet.png'])).toThrow(/--out/);
    expect(() => parseSliceSheetArgs(['sheet.png', '--out', 'out'])).toThrow(/--names/);
  });
});

describe('slice-sheet CLI 통합 — 실제 PNG 파일 읽기/쓰기 왕복', () => {
  it('합성한 시트 PNG를 디스크에 썼다가 다시 디코드해도 픽셀이 동일하다(코덱 회귀 가드)', () => {
    const sheet = makeRGBA(30, 10, { x: 2, y: 2, w: 6, h: 6 });
    const dir = mkdtempSync(join(tmpdir(), 'asset-prep-slice-'));
    const sheetPath = join(dir, 'sheet.png');
    writeFileSync(sheetPath, encodePng(sheet));

    const roundTripped = decodePng(readFileSync(sheetPath));
    expect(roundTripped.width).toBe(sheet.width);
    expect(roundTripped.height).toBe(sheet.height);
    expect(Array.from(roundTripped.pixels)).toEqual(Array.from(sheet.pixels));

    const icons = sliceSheet(roundTripped, { cols: 3, size: 64, pad: 2 });
    icons.forEach(({ image }, i) => {
      writeFileSync(join(dir, `icon-${i}.png`), encodePng(image));
    });
    const written = readdirSync(dir).filter((f) => f.startsWith('icon-'));
    expect(written).toHaveLength(3);
  });
});
