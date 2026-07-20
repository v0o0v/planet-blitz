/**
 * scripts/asset-prep.mjs 의 테스트 지원용 타입 선언 (companion declaration file).
 *
 * asset-prep.mjs는 "의존성 0" 규약을 지키는 plain JS(.mjs)라 tsconfig에서
 * allowJs를 켜지 않는다. tests/*.test.ts 가 이 모듈을 import할 때 `tsc --noEmit`이
 * 통과하도록, 실제로 export하는 공개 함수만 여기서 선언한다(tests/node-shims.d.ts와
 * 같은 최소-표면 원칙).
 */

export type PngImage = {
  width: number;
  height: number;
  colorType: number;
  channels: number;
  pixels: Uint8Array;
};

export function decodePng(buf: Uint8Array): PngImage;
export function encodePng(img: PngImage): Uint8Array;
export function rotateCW(img: PngImage): PngImage;
export function isDirectional(basename: string): boolean;

export type AlphaBBox = { x: number; y: number; width: number; height: number };

export function computeAlphaBBox(img: PngImage): AlphaBBox | null;
export function cropRegion(img: PngImage, x: number, y: number, w: number, h: number): PngImage;
export function toRGBA(img: PngImage): PngImage;
export function containSize(srcW: number, srcH: number, maxSize: number): { width: number; height: number };
export function nearestScale(img: PngImage, dstW: number, dstH: number): PngImage;

export type SliceOptions = { size?: number; pad?: number };
export type SlicedIcon = { image: PngImage; empty: boolean };

export function sliceCellToIcon(cellImg: PngImage, options?: SliceOptions): SlicedIcon;
export function splitSheetCells(sheetImg: PngImage, cols: number): PngImage[];
export function sliceSheet(
  sheetImg: PngImage,
  options?: { cols?: number; size?: number; pad?: number },
): SlicedIcon[];

export type ParsedSliceSheetArgs = {
  sheetPath: string;
  outDir: string;
  names: string[];
  cols: number;
  size: number;
  pad: number;
};

export function parseSliceSheetArgs(args: string[]): ParsedSliceSheetArgs;
