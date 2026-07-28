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
 *   node scripts/asset-prep.mjs backdrop <spritesheet.png> --meta <tileset.json> \
 *     --layer 0|1|2 --out assets/bg_invasion_lN.png [--gain 0.25]
 *
 * `backdrop` 서브커맨드: `create_topdown_tileset` 산출물에서 **전-모서리-upper 타일**
 * (Wang 내부 채움 = 자기 자신과 이어지는 유일한 타일)을 잘라 명암 편차만 팔레트 색에 싣고,
 * 그 위에 절차 배경과 같은 구조선을 그려 256² 배경을 만든다. 침공 배경은 `TilingSprite`
 * 라 **seamless 가 아니면 화면 전체에 격자가 뜨므로**, 쓰기 직전 이음매를 재서(그림 자체의
 * 최대 불연속 p99 와 비교) 통과하지 못하면 에러로 막는다. 근거·실측은 각 함수 주석에 있다.
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

// --- backdrop (침공 3레이어 배경: seamless 타일 + 절차 구조선) ----------------

/**
 * 현재 `assets/bg_invasion_l*.png` 를 만든 PixelLab 타일셋 ID(2026-07-28).
 *
 * 시트·메타는 `assets/_raw/` 규율(gitignore — PixelLab 원본은 커밋하지 않는다)에 따라
 * 리포에 없다. 재생성하려면 아래 ID 로 다시 받아라:
 *   시트: https://backblaze.pixellab.ai/file/pixellab-tiles/<userId>/<id>/spritesheet.png
 *   메타: https://api.pixellab.ai/mcp/tilesets/<id>/metadata
 *
 * 셋 다 `create_topdown_tileset` standard 모드 · 32px · transition_size 0.25 ·
 * view "high top-down" 이다. ⚠️ pro 모드 + 64px 조합은 두 번 다 "unknown error" 로 실패했고,
 * 32px standard 는 리포의 행성 타일셋(`assets/tilesets/`)이 이미 쓰던 검증된 규격이다.
 * 256 = 32 × 8 이라 바탕이 경계에서 잘리지 않는 것도 이 크기를 쓰는 이유다.
 */
const BACKDROP_TILESET_IDS = {
  l1: '0535798d-261c-42ef-bbf7-6fc9838c8b7c', // 성층권 구름·얼음 결정
  l2: '28a32c3d-7ffa-4fff-b588-e62bcea47a69', // 마모된 강판·리벳·용접선
  l3: '2aea5da9-0627-48d2-bb54-dc4feeb269ba', // 회로 트레이스·전력 셀
};

/** 배경 타일 한 변(px). `src/render/textures.ts` 의 절차 배경과 같은 규격이다. */
const BACKDROP_SIZE = 256;

/**
 * 레이어 팔레트. `src/render/textures.ts` 의 `INVASION_BACKDROP_PALETTES` 사본이다 —
 * 두 곳이 어긋나면 PNG 가 있는 레이어와 없는 레이어의 색이 갈리므로 값을 함께 고쳐야 한다.
 */
const BACKDROP_PALETTES = [
  { base: 0x060a18, line: 0x1b3358, accent: 0x9fd0ff }, // 0 L1 대기권
  { base: 0x14100a, line: 0x4a3a22, accent: 0xffb020 }, // 1 L2 회랑 격벽
  { base: 0x120616, line: 0x3d1a52, accent: 0xff5ad0 }, // 2 L3 코어방
];

/**
 * 결의 기본 세기. 타일의 명암 편차에 곱하는 값이다.
 *
 * 0.25 는 눈으로 고른 값이다 — 1.6 은 32px 타일의 8×8 반복이 **벽지 잔무늬**로 읽혀
 * 구조선과 싸우고 배경이 시끄러워졌다(배경이 조용해야 엔티티가 읽힌다). 0.25 에서는
 * 격벽이 "리벳 박힌 강판", 코어방이 "회로 깔린 바닥"으로만 읽히고 구조선을 이기지 않는다.
 */
const BACKDROP_GRAIN = 0.25;

const rgbOf = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** RGBA 캔버스 1픽셀 src-over. 좌표는 모듈로로 감싸 이음매를 만들지 않는다. */
function blendPx(px, size, x, y, [r, g, b], a) {
  if (a <= 0) return;
  const cx = ((x % size) + size) % size;
  const cy = ((y % size) + size) % size;
  const i = (cy * size + cx) << 2;
  px[i] = Math.round(px[i] * (1 - a) + r * a);
  px[i + 1] = Math.round(px[i + 1] * (1 - a) + g * a);
  px[i + 2] = Math.round(px[i + 2] * (1 - a) + b * a);
  px[i + 3] = 255;
}

/**
 * Wang 타일셋에서 **전 모서리가 upper 인 타일**(내부 채움)을 잘라낸다.
 *
 * 배경으로 쓸 수 있는 후보는 이것뿐이다 — Wang 세트에서 자기 자신과 이어지도록 만들어진
 * 유일한 타일이라서다. 전이 타일은 두 지형의 경계를 담고 있어 TilingSprite 로 깔면
 * 화면 전체에 격자가 뜬다. 실측으로도 이 타일만 좌우·상하 이음매가 0 이었다.
 */
function extractFillTile(sheet, meta) {
  const t = meta.tileset_data.tiles.find(
    (x) =>
      x.corners.NW === 'upper' &&
      x.corners.NE === 'upper' &&
      x.corners.SE === 'upper' &&
      x.corners.SW === 'upper',
  );
  if (t === undefined) throw new Error('backdrop: 전-모서리-upper 타일이 타일셋에 없다');
  const { x: bx, y: by, width: w, height: h } = t.bounding_box;
  return { ...cropRegion(toRGBA(sheet), bx, by, w, h), name: t.name };
}

/**
 * 바탕 = 팔레트 base 색 + 타일의 **명암 편차**를 `gain` 배로 실은 것.
 *
 * ⚠️ 타일을 그대로 깔고 base 색을 alpha 로 섞는 방식(tint)은 틀렸다. Wang 내부 채움 타일은
 * **설계상 평평하고**(지형이 읽히도록 균일해야 한다) 밝기도 팔레트와 무관하다. 실측에서
 * tint 45% 는 결을 13.6 → 14.7 (+8%) 밖에 못 올리면서 평균 밝기를 51,39,20 → 83,73,61 로
 * **띄웠다** — 배경이 밝아지면 엔티티 가독성이 깎인다.
 *
 * 편차만 실으면 편차의 평균이 0 이라 **밝기가 안 변하고**(실측 51,39,20 → 51,39,21) 색은
 * 팔레트가 100% 결정하며, 결의 세기를 `gain` 으로 직접 정할 수 있다. 타일이 seamless 이므로
 * 편차장도 seamless 다.
 */
function grainBase(tile, size, baseColor, gain) {
  const base = rgbOf(baseColor);
  const { width: tw, height: th, pixels: tp } = tile;
  let mean = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const i = (y * tw + x) << 2;
      mean += (tp[i] + tp[i + 1] + tp[i + 2]) / 3;
    }
  }
  mean /= tw * th;
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const si = ((y % th) * tw + (x % tw)) << 2;
      const dev = ((tp[si] + tp[si + 1] + tp[si + 2]) / 3 - mean) * gain;
      const di = (y * size + x) << 2;
      for (let c = 0; c < 3; c++) px[di + c] = Math.max(0, Math.min(255, Math.round(base[c] + dev)));
      px[di + 3] = 255;
    }
  }
  return px;
}

/**
 * 레이어 구조선. `src/render/textures.ts` 의 `invasionBackdropTextureFor` 와 같은 기하다 —
 * PNG 가 없을 때의 절차 폴백과 구조가 어긋나면 자산 유무로 화면이 달라 보인다.
 */
function drawBackdropStructure(px, size, layer) {
  const pal = BACKDROP_PALETTES[layer];
  const rect = (x0, y0, w, h, color, alpha) => {
    const c = rgbOf(color);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) blendPx(px, size, x, y, c, alpha);
  };
  const disc = (cx, cy, r, color, alpha, fill = true, width = 1) => {
    const c = rgbOf(color);
    const r0 = fill ? 0 : r - width / 2;
    const r1 = fill ? r : r + width / 2;
    for (let y = Math.floor(cy - r1 - 1); y <= Math.ceil(cy + r1 + 1); y++) {
      for (let x = Math.floor(cx - r1 - 1); x <= Math.ceil(cx + r1 + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d >= r0 && d <= r1) blendPx(px, size, x, y, c, alpha);
      }
    }
  };
  const seg = (x0, y0, x1, y1, color, alpha, width) => {
    const c = rgbOf(color);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.ceil(Math.hypot(dx, dy) * 2);
    const half = width / 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const bx = Math.round(x0 + dx * t);
      const by = Math.round(y0 + dy * t);
      for (let oy = -Math.ceil(half); oy <= Math.ceil(half); oy++) {
        for (let ox = -Math.ceil(half); ox <= Math.ceil(half); ox++) {
          if (Math.hypot(ox, oy) <= half) blendPx(px, size, bx + ox, by + oy, c, alpha);
        }
      }
    }
  };

  if (layer === 0) {
    for (const y of [36, 104, 178, 236]) rect(0, y, size, 10, pal.line, 0.35);
    const stars = [
      [22, 18, 1.6], [88, 62, 1.1], [150, 28, 2.0], [212, 74, 1.3], [40, 132, 1.2],
      [118, 168, 1.8], [196, 140, 1.1], [236, 208, 1.5], [70, 224, 1.3], [166, 244, 1.0],
    ];
    for (const [x, y, r] of stars) disc(x, y, r, pal.accent, 0.85);
  } else if (layer === 1) {
    for (const p of [0, 128]) {
      for (const q of [0, 128]) {
        rect(p + 6, q + 6, 116, 116, pal.line, 0.5);
        for (const [rx, ry] of [[18, 18], [110, 18], [18, 110], [110, 110]]) {
          disc(p + rx, q + ry, 3, pal.accent, 0.7);
        }
      }
    }
    for (let i = -size; i < size; i += 64) seg(i, 0, i + size, size, pal.accent, 0.16, 2);
  } else {
    for (let i = 32; i < size; i += 32) {
      seg(i, 0, i, size, pal.line, 0.7, 1.5);
      seg(0, i, size, i, pal.line, 0.7, 1.5);
    }
    for (const [x, y] of [[64, 64], [192, 64], [64, 192], [192, 192]]) disc(x, y, 3.5, pal.accent, 0.8);
    disc(128, 128, 52, pal.accent, 0.45, false, 3);
    disc(128, 128, 30, pal.accent, 0.3, false, 2);
  }
}

/** 타일셋 시트+메타 → 배경 PNG 버퍼 1장. */
function composeBackdrop(sheetBuf, meta, layer, gain = BACKDROP_GRAIN) {
  if (!Number.isInteger(layer) || layer < 0 || layer >= BACKDROP_PALETTES.length) {
    throw new Error(`backdrop: layer must be 0..${BACKDROP_PALETTES.length - 1}, got "${layer}"`);
  }
  const tile = extractFillTile(decodePng(sheetBuf), meta);
  const px = grainBase(tile, BACKDROP_SIZE, BACKDROP_PALETTES[layer].base, gain);
  drawBackdropStructure(px, BACKDROP_SIZE, layer);
  return {
    buf: encodePng({ width: BACKDROP_SIZE, height: BACKDROP_SIZE, colorType: 6, channels: 4, pixels: px }),
    tileName: tile.name,
  };
}

/** 이음매 허용 배수·여유. wrap 이 내부 p99 를 이만큼 넘어서야 "보인다"로 친다. */
const SEAM_TOLERANCE_MULT = 1.2;
const SEAM_TOLERANCE_ABS = 2;

/**
 * 이음매 판정 — wrap 경계의 불연속이 **텍스처 안에 이미 있는 가장 큰 불연속(p99)** 을
 * 넘는지로 본다.
 *
 * 두 번 틀린 뒤 여기 왔다. 판정 대상은 "인접 열(행) 쌍의 평균 색차"이고, wrap 쌍은
 * 마지막 열 ↔ 첫 열이다.
 *
 * ⚠️ ①평균 비교("wrap <= 내부 평균")는 **거짓 음성**을 낸다. 내부 대비가 큰 그림
 *    (L3 에너지 그리드는 내부 평균 80)은 평균이 커서 이음매가 있어도 통과한다.
 * ⚠️ ②z-score 비교("wrap 이 분포의 이상치인가")는 **거짓 양성**을 낸다. 드문 고대비
 *    경계만 있는 그림(주기적 줄무늬)에서는 정상 경계조차 z=4 로 튀어, 완벽히 이어지는
 *    이미지를 이음매로 오판한다.
 *
 * p99 비교는 둘 다 피한다: 넘어야 할 기준이 그림 자체의 최대 불연속이라, 대비가 크든
 * 작든 "이 경계만 유별나게 끊겼는가"를 곧장 묻는다. TilingSprite 는 이 경계를 화면 전체에
 * 반복하므로, 그림 안에 이미 있는 정도의 불연속이면 눈에 띌 수 없다.
 */
function seamReport(img) {
  const { width: w, height: h, pixels } = toRGBA(img);
  const at = (x, y) => { const i = (y * w + x) << 2; return [pixels[i], pixels[i + 1], pixels[i + 2]]; };
  const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const colPair = (x) => { let s = 0; for (let y = 0; y < h; y++) s += diff(at(x, y), at((x + 1) % w, y)); return s / h; };
  const rowPair = (y) => { let s = 0; for (let x = 0; x < w; x++) s += diff(at(x, y), at(x, (y + 1) % h)); return s / w; };
  const p99 = (vals) => {
    const s = [...vals].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.99))] ?? 0;
  };
  const cols = []; for (let x = 0; x < w - 1; x++) cols.push(colPair(x));
  const rows = []; for (let y = 0; y < h - 1; y++) rows.push(rowPair(y));
  const wrapX = colPair(w - 1);
  const wrapY = rowPair(h - 1);
  const limitX = p99(cols) * SEAM_TOLERANCE_MULT + SEAM_TOLERANCE_ABS;
  const limitY = p99(rows) * SEAM_TOLERANCE_MULT + SEAM_TOLERANCE_ABS;
  return { wrapX, wrapY, limitX, limitY, seamless: wrapX <= limitX && wrapY <= limitY };
}

/** Parse `backdrop` CLI args into `{ sheetPath, metaPath, layer, out, gain }`. */
function parseBackdropArgs(argv) {
  const opts = { layer: NaN, gain: BACKDROP_GRAIN };
  let sheetPath;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--meta') opts.meta = argv[++i];
    else if (a === '--layer') opts.layer = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--gain') opts.gain = Number(argv[++i]);
    else if (!a.startsWith('--') && sheetPath === undefined) sheetPath = a;
  }
  if (!sheetPath) throw new Error('backdrop: missing <spritesheet.png> argument');
  if (!opts.meta) throw new Error('backdrop: --meta <tileset.json> is required');
  if (!opts.out) throw new Error('backdrop: --out <bg_invasion_lN.png> is required');
  if (!Number.isFinite(opts.gain) || opts.gain < 0) throw new Error(`backdrop: --gain must be >= 0, got "${opts.gain}"`);
  return { sheetPath, metaPath: opts.meta, layer: opts.layer, out: opts.out, gain: opts.gain };
}

/** CLI entry point for `backdrop`. */
function runBackdrop(argv) {
  const { sheetPath, metaPath, layer, out, gain } = parseBackdropArgs(argv);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const { buf, tileName } = composeBackdrop(readFileSync(sheetPath), meta, layer, gain);
  writeFileSync(out, buf);
  const { wrapX, wrapY, limitX, limitY, seamless } = seamReport(decodePng(buf));
  console.log(`[asset-prep] backdrop wrote ${out} (layer ${layer}, tile ${tileName}, gain ${gain})`);
  console.log(
    `[asset-prep] backdrop seam: x=${wrapX.toFixed(1)}/${limitX.toFixed(1)} ` +
      `y=${wrapY.toFixed(1)}/${limitY.toFixed(1)} → ${seamless ? 'SEAMLESS' : 'SEAM VISIBLE'}`,
  );
  if (!seamless) {
    throw new Error('backdrop: 이음매가 보인다 — 다른 타일셋으로 다시 뽑아라(TilingSprite 라 화면 전체에 격자가 뜬다)');
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'slice-sheet') {
    runSliceSheet(args.slice(1));
    return;
  }
  if (args[0] === 'backdrop') {
    runBackdrop(args.slice(1));
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
  extractFillTile,
  grainBase,
  drawBackdropStructure,
  composeBackdrop,
  seamReport,
  parseBackdropArgs,
  BACKDROP_SIZE,
  BACKDROP_PALETTES,
  BACKDROP_GRAIN,
  BACKDROP_TILESET_IDS,
};
