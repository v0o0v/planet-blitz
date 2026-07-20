/**
 * png — 의존성 0 PNG 코덱 (Node 내장 zlib만 사용).
 *
 * scripts/asset-prep.mjs 의 "의존성 0" 규약(외부 이미지 라이브러리 금지)을 지키기
 * 위해 PNG 디코드/인코드를 직접 구현한다. PixelLab 출력 규격(8-bit, non-interlaced,
 * colortype 0/2/4/6)만 지원 — 그 외 규격은 명확히 에러를 던진다.
 *
 * asset-prep.mjs의 회전 파이프라인과 시트 슬라이싱 파이프라인이 이 모듈을 공유한다.
 */

import { inflateSync, deflateSync } from 'node:zlib';

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

export { decodePng, encodePng, channelsFor };
