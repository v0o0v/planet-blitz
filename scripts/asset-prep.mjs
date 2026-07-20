#!/usr/bin/env node
/**
 * asset-prep — PixelLab 산출물을 인게임 규율에 맞춰 정리하는 파이프라인.
 *
 * 서브커맨드 없이 실행하면 기존 회전 파이프라인:
 *   `assets/_raw/`의 원본 PNG를 스캔해 **방향성 스프라이트만**(파일명이 `enemy_*`
 *   또는 `player`) 90° CW 회전해 `assets/`에 쓴다(렌더러는 `rotation = angle`
 *   [+x=east] 규율인데 PixelLab 탑다운 출력은 north(위) 지향이라서 — M1 관례 =
 *   PIL ROTATE_270, `.omc/handoffs/m1-phase4.md`). boss/배경(bg_*)/기믹
 *   (loot·supply·wall·… fixedFacing)·이펙트(fx_*)·gem은 회전이 불필요하므로 그대로
 *   복사한다.
 *
 * `slice-sheet` 서브커맨드: `create_ui_asset`으로 뽑은 가로 N칸 아이콘 시트를
 * 64×64 PNG 낱장으로 자른다(ADR-0016). 칸을 균등 분할 → 칸별 알파 바운딩박스로
 * crop(투명 여백 제거) → 비율 유지 nearest-neighbor 축소 → 64×64 캔버스 중앙
 * 배치(안쪽 여백 기본 2px)로 개별 PNG를 만든다.
 *
 * 의존성 0(Node 내장 zlib/fs만, PNG 코덱은 scripts/lib/png.mjs 공유). PixelLab
 * 출력 규격(8-bit, non-interlaced, colortype 0/2/4/6)만 지원 — 그 외 규격은
 * 명확히 에러를 던진다.
 *
 * 사용법:
 *   node scripts/asset-prep.mjs                       # assets/_raw/*.png → assets/*.png
 *   node scripts/asset-prep.mjs --dry-run              # 회전/복사 계획만 출력(쓰기 없음)
 *   node scripts/asset-prep.mjs slice-sheet <sheet.png> --out <dir> --names a,b,c \
 *     [--cols 3] [--size 64] [--pad 2]
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng, encodePng } from './lib/png.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_DIR = join(ROOT, 'assets', '_raw');
const OUT_DIR = join(ROOT, 'assets');

/** Rotate a decoded image 90° clockwise (north-facing → east-facing). */
function rotateCW(img) {
  const { width: w, height: h, channels: ch, pixels } = img;
  const nw = h;
  const nh = w;
  const out = new Uint8Array(nw * nh * ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 90° CW: source (x,y) → dest (nx,ny), nx = h-1-y, ny = x.
      const nx = h - 1 - y;
      const ny = x;
      const si = (y * w + x) * ch;
      const di = (ny * nw + nx) * ch;
      for (let c = 0; c < ch; c++) out[di + c] = pixels[si + c];
    }
  }
  return { width: nw, height: nh, colorType: img.colorType, channels: ch, pixels: out };
}

/** Directional sprites need the north→east rotation; everything else is copied. */
function isDirectional(basename) {
  const name = basename.replace(/\.png$/i, '');
  return name === 'player' || name.startsWith('enemy_');
}

// --- slice-sheet (ADR-0016: icon sheet → 64×64 PNG icons) -----------------

/** Alpha value at pixel index `idx`; images without an alpha channel are fully opaque. */
function alphaAt(img, idx) {
  if (img.channels === 4) return img.pixels[idx * 4 + 3];
  if (img.channels === 2) return img.pixels[idx * 2 + 1];
  return 255;
}

/**
 * Tight bounding box around non-fully-transparent pixels, or `null` when the
 * whole image is transparent (empty sheet cell).
 */
function computeAlphaBBox(img) {
  const { width, height } = img;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      if (alphaAt(img, rowBase + x) > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Crop an axis-aligned rect out of an image, preserving colour type/channels. */
function cropRegion(img, x, y, w, h) {
  const { width: sw, channels, colorType, pixels } = img;
  const out = new Uint8Array(w * h * channels);
  for (let ry = 0; ry < h; ry++) {
    const srcRow = ((y + ry) * sw + x) * channels;
    const dstRow = ry * w * channels;
    out.set(pixels.subarray(srcRow, srcRow + w * channels), dstRow);
  }
  return { width: w, height: h, colorType, channels, pixels: out };
}

/** Normalize any supported colour type to 4-channel RGBA (colorType 6). */
function toRGBA(img) {
  if (img.channels === 4) return img;
  const { width, height, channels, pixels } = img;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const si = i * channels;
    const di = i * 4;
    if (channels === 3) {
      out[di] = pixels[si];
      out[di + 1] = pixels[si + 1];
      out[di + 2] = pixels[si + 2];
      out[di + 3] = 255;
    } else if (channels === 2) {
      out[di] = out[di + 1] = out[di + 2] = pixels[si];
      out[di + 3] = pixels[si + 1];
    } else {
      out[di] = out[di + 1] = out[di + 2] = pixels[si];
      out[di + 3] = 255;
    }
  }
  return { width, height, colorType: 6, channels: 4, pixels: out };
}

/** Largest (w,h) that fits within `maxSize`×`maxSize` while keeping the aspect ratio. */
function containSize(srcW, srcH, maxSize) {
  const scale = Math.min(maxSize / srcW, maxSize / srcH);
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
  };
}

/** Nearest-neighbor resize (no interpolation — keeps pixel-art edges crisp). */
function nearestScale(img, dstW, dstH) {
  const { width: sw, height: sh, channels, colorType, pixels } = img;
  const out = new Uint8Array(dstW * dstH * channels);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dstH));
    const srcRow = sy * sw;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dstW));
      const si = (srcRow + sx) * channels;
      const di = (dstRow + x) * channels;
      for (let c = 0; c < channels; c++) out[di + c] = pixels[si + c];
    }
  }
  return { width: dstW, height: dstH, colorType, channels, pixels: out };
}

/** A fully-transparent RGBA canvas of `size`×`size`. */
function blankCanvas(size) {
  return { width: size, height: size, colorType: 6, channels: 4, pixels: new Uint8Array(size * size * 4) };
}

/** Copy `src` into `canvas` (RGBA) at (offsetX, offsetY); `src` must fit inside `canvas`. */
function blitInto(canvas, src, offsetX, offsetY) {
  for (let y = 0; y < src.height; y++) {
    const srcRow = y * src.width * 4;
    const dstRow = ((y + offsetY) * canvas.width + offsetX) * 4;
    canvas.pixels.set(src.pixels.subarray(srcRow, srcRow + src.width * 4), dstRow);
  }
  return canvas;
}

/**
 * Turn one sheet cell into a `size`×`size` icon: crop to the alpha bbox, scale
 * (aspect-preserving, nearest neighbor) to fit inside `size - 2*pad`, and
 * center it on a transparent canvas. Fully-transparent cells never throw —
 * they yield a blank icon with `empty: true` so the caller can warn cleanly.
 */
function sliceCellToIcon(cellImg, { size = 64, pad = 2 } = {}) {
  const canvas = blankCanvas(size);
  const bbox = computeAlphaBBox(cellImg);
  if (bbox === null) return { image: canvas, empty: true };

  const cropped = toRGBA(cropRegion(cellImg, bbox.x, bbox.y, bbox.width, bbox.height));
  const maxSize = size - 2 * pad;
  const { width: dstW, height: dstH } = containSize(cropped.width, cropped.height, maxSize);
  const scaled = nearestScale(cropped, dstW, dstH);
  const offsetX = Math.floor((size - dstW) / 2);
  const offsetY = Math.floor((size - dstH) / 2);
  blitInto(canvas, scaled, offsetX, offsetY);
  return { image: canvas, empty: false };
}

/** Split a sheet into `cols` roughly-equal-width full-height cells (rounded boundaries). */
function splitSheetCells(sheetImg, cols) {
  const { width, height } = sheetImg;
  const cells = [];
  for (let i = 0; i < cols; i++) {
    const startX = Math.round((i * width) / cols);
    const endX = Math.round(((i + 1) * width) / cols);
    cells.push(cropRegion(sheetImg, startX, 0, endX - startX, height));
  }
  return cells;
}

/** Slice a sheet into `cols` icons per the ADR-0016 algorithm. See `sliceCellToIcon`. */
function sliceSheet(sheetImg, { cols = 3, size = 64, pad = 2 } = {}) {
  return splitSheetCells(sheetImg, cols).map((cell) => sliceCellToIcon(cell, { size, pad }));
}

/** Parse `slice-sheet` CLI args into `{ sheetPath, outDir, names, cols, size, pad }`. */
function parseSliceSheetArgs(args) {
  const positional = [];
  const opts = { out: undefined, names: undefined, cols: 3, size: 64, pad: 2 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') opts.out = args[++i];
    else if (a === '--names') opts.names = args[++i];
    else if (a === '--cols') opts.cols = Number(args[++i]);
    else if (a === '--size') opts.size = Number(args[++i]);
    else if (a === '--pad') opts.pad = Number(args[++i]);
    else positional.push(a);
  }
  const sheetPath = positional[0];
  if (!sheetPath) throw new Error('slice-sheet: missing <sheet.png> argument');
  if (!opts.out) throw new Error('slice-sheet: --out <dir> is required');
  if (!opts.names) throw new Error('slice-sheet: --names a,b,c is required');
  if (!Number.isInteger(opts.cols) || opts.cols < 1) throw new Error(`slice-sheet: --cols must be a positive integer, got "${opts.cols}"`);
  if (!Number.isInteger(opts.size) || opts.size < 1) throw new Error(`slice-sheet: --size must be a positive integer, got "${opts.size}"`);
  if (!Number.isInteger(opts.pad) || opts.pad < 0) throw new Error(`slice-sheet: --pad must be a non-negative integer, got "${opts.pad}"`);

  const names = opts.names.split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length !== opts.cols) {
    throw new Error(`slice-sheet: --names must list exactly ${opts.cols} name(s) (cols=${opts.cols}), got ${names.length}`);
  }
  return { sheetPath, outDir: opts.out, names, cols: opts.cols, size: opts.size, pad: opts.pad };
}

/** CLI entry point for `slice-sheet`: read, slice, and write the icon PNGs. */
function runSliceSheet(args) {
  const { sheetPath, outDir, names, cols, size, pad } = parseSliceSheetArgs(args);
  const sheetImg = decodePng(readFileSync(sheetPath));
  const icons = sliceSheet(sheetImg, { cols, size, pad });
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  icons.forEach(({ image, empty }, i) => {
    const outPath = join(outDir, `${names[i]}.png`);
    writeFileSync(outPath, encodePng(image));
    if (empty) console.warn(`[asset-prep] slice-sheet: cell ${i} (${names[i]}) is fully transparent — wrote a blank icon`);
    console.log(`[asset-prep] slice-sheet wrote ${outPath}`);
  });
  console.log(`[asset-prep] slice-sheet done — ${icons.length} icon(s) → ${outDir}`);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'slice-sheet') {
    runSliceSheet(args.slice(1));
    return;
  }

  const dryRun = args.includes('--dry-run');
  if (!existsSync(RAW_DIR)) {
    console.log(`[asset-prep] no raw dir (${RAW_DIR}); nothing to do.`);
    console.log('[asset-prep] place PixelLab north-facing PNGs in assets/_raw/ then re-run.');
    return;
  }
  if (!dryRun && !existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(RAW_DIR).filter((f) => /\.png$/i.test(f));
  if (files.length === 0) {
    console.log('[asset-prep] assets/_raw/ has no PNGs; nothing to do.');
    return;
  }

  let rotated = 0;
  let copied = 0;
  for (const file of files) {
    const src = join(RAW_DIR, file);
    const dst = join(OUT_DIR, file);
    const buf = readFileSync(src);
    const directional = isDirectional(file);
    const action = directional ? 'rotate-CW' : 'copy';
    if (dryRun) {
      console.log(`[asset-prep] ${action.padEnd(9)} ${file}`);
      if (directional) rotated++;
      else copied++;
      continue;
    }
    if (directional) {
      const img = decodePng(buf);
      writeFileSync(dst, encodePng(rotateCW(img)));
      rotated++;
    } else {
      writeFileSync(dst, buf);
      copied++;
    }
    console.log(`[asset-prep] ${action.padEnd(9)} ${file}`);
  }
  console.log(`[asset-prep] done — ${rotated} rotated, ${copied} copied${dryRun ? ' (dry run)' : ''}.`);
}

// Run only when invoked directly (so tests can import the codec helpers).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  decodePng,
  encodePng,
  rotateCW,
  isDirectional,
  computeAlphaBBox,
  cropRegion,
  toRGBA,
  containSize,
  nearestScale,
  sliceCellToIcon,
  splitSheetCells,
  sliceSheet,
  parseSliceSheetArgs,
};
