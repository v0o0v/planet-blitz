#!/usr/bin/env node
/**
 * asset-prep — PixelLab 원본(north 지향)을 인게임 규율(east/+x 지향)로 회전 배치.
 *
 * 배경(맥락): 렌더러는 `rotation = angle`(+x=east) 규율을 쓰는데 PixelLab 탑다운
 * 출력은 north(위) 지향이다. 그래서 방향성 스프라이트는 에셋 준비 단계에서 90° CW
 * 회전해 east 지향으로 맞춘다(M1 관례 = PIL ROTATE_270, `.omc/handoffs/m1-phase4.md`).
 *
 * 이 스크립트는 `assets/_raw/`의 원본 PNG를 스캔해 **방향성 스프라이트만**(파일명이
 * `enemy_*` 또는 `player`) 90° CW 회전해 `assets/`에 쓴다. boss/배경(bg_*)/기믹
 * (loot·supply·wall·… fixedFacing)·이펙트(fx_*)·gem은 회전이 불필요하므로 그대로
 * 복사한다.
 *
 * 의존성 0(Node 내장 zlib/fs만). PixelLab 출력 규격(8-bit, non-interlaced,
 * colortype 2 RGB / 6 RGBA)만 지원 — 그 외 규격은 명확히 에러를 던진다.
 *
 * 사용법:
 *   node scripts/asset-prep.mjs            # assets/_raw/*.png → assets/*.png
 *   node scripts/asset-prep.mjs --dry-run  # 회전/복사 계획만 출력(쓰기 없음)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_DIR = join(ROOT, 'assets', '_raw');
const OUT_DIR = join(ROOT, 'assets');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --- CRC32 (PNG chunk checksums) ------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Channel count for a supported (bitdepth-8) PNG colour type. */
function channelsFor(colorType) {
  switch (colorType) {
    case 0: return 1; // grayscale
    case 2: return 3; // RGB
    case 4: return 2; // grayscale + alpha
    case 6: return 4; // RGBA
    default: throw new Error(`unsupported PNG colour type ${colorType} (palette/interlace not supported)`);
  }
}

/** Parse a PNG into { width, height, colorType, channels, pixels(Uint8Array) }. */
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG (bad signature)');
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (ihdr === null) throw new Error('PNG has no IHDR');
  if (ihdr.bitDepth !== 8) throw new Error(`unsupported bit depth ${ihdr.bitDepth} (only 8 supported)`);
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = channelsFor(ihdr.colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const stride = width * channels;
  // Un-filter each scanline into a flat pixel array (row-major, top-down).
  const pixels = new Uint8Array(width * height * channels);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[rp++];
      const a = x >= channels ? pixels[rowStart + x - channels] : 0; // left
      const b = y > 0 ? pixels[rowStart - stride + x] : 0; // up
      const c = x >= channels && y > 0 ? pixels[rowStart - stride + x - channels] : 0; // up-left
      let val;
      switch (filter) {
        case 0: val = cur; break;
        case 1: val = cur + a; break;
        case 2: val = cur + b; break;
        case 3: val = cur + ((a + b) >> 1); break;
        case 4: val = cur + paeth(a, b, c); break;
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      pixels[rowStart + x] = val & 0xff;
    }
  }
  return { width, height, colorType: ihdr.colorType, channels, pixels };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Encode a pixel array back to a PNG buffer (filter 0 rows). */
function encodePng({ width, height, colorType, channels, pixels }) {
  const stride = width * channels;
  const rawLen = (stride + 1) * height;
  const raw = Buffer.allocUnsafe(rawLen);
  let wp = 0;
  for (let y = 0; y < height; y++) {
    raw[wp++] = 0; // filter: none
    for (let x = 0; x < stride; x++) raw[wp++] = pixels[y * stride + x];
  }
  const idatData = deflateSync(raw, { level: 9 });

  const chunks = [];
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(makeChunk('IHDR', ihdr));
  chunks.push(makeChunk('IDAT', idatData));
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([PNG_SIG, ...chunks]);
}

function makeChunk(type, data) {
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

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

function main() {
  const dryRun = process.argv.includes('--dry-run');
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

export { decodePng, encodePng, rotateCW, isDirectional };
