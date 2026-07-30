#!/usr/bin/env node
/**
 * glb-prep — Meshy 산출 GLB 를 **웹 게임에 실을 수 있는 크기로** 줄이는 파이프라인.
 *
 * ── 왜 필요한가 ──
 * Meshy 의 텍스처 refine 출력은 데스크톱 DCC 기준이라 그대로는 웹에 못 싣는다. 카르곤 보스
 * 실측:
 *   - 원본(refine)          : 32.7MB — 삼각형 1,016,472개
 *   - 리메시(8k tri) 후     : 13.5MB — 지오메트리는 0.4MB 로 줄었고 **나머지 13.1MB 가 텍스처**
 *                             (베이스컬러 PNG 6.0MB + 노멀맵 PNG 7.1MB, 각 2K~4K)
 *
 * ⚠️ `meshy_text_to_3d` 의 `target_polycount` 는 **meshy-6 에서 무시된다**(그 모델은
 * `should_remesh` 기본값이 false 라서). 폴리곤 감축은 `meshy_remesh` 를 따로 태워야 한다.
 * 텍스처 해상도는 API 에 옵션이 아예 없으므로 **여기서 로컬로 줄인다**.
 *
 * ── 무엇을 하는가 ──
 * GLB(바이너리 glTF)의 JSON/BIN 청크를 풀어 **내장 이미지 bufferView 만** 교체한다:
 * 디코드 → 면적평균 축소 → 재인코드 → BIN 재조립(모든 bufferView 오프셋 재계산). 지오메트리
 * accessor 는 bufferView 안의 상대 오프셋을 쓰므로 내용을 그대로 옮기면 유효하다.
 *
 * 축소 목표가 자산 종류마다 다른 이유: 이 모델은 **160×160 아틀라스 슬롯**에 렌더된다
 * (`src/render/three3d/stage3d.ts` SLOT_SIZE). 베이스컬러 256²면 표시 해상도의 1.6배라
 * 충분하고, 노멀맵은 그 크기에서 기여가 사실상 0 이라 128² 로 더 줄인다.
 *
 * 의존성 0 — Node 내장 + `scripts/lib/png.mjs`(asset-prep 과 공유하는 PNG 코덱). PNG 만
 * 지원한다(JPEG 내장 GLB 는 명확히 에러 — 디코더가 없다. Meshy 리메시 출력은 PNG 다).
 *
 * 사용법:
 *   node scripts/glb-prep.mjs <in.glb> --out <out.glb> [--color 256] [--normal 128]
 *   node scripts/glb-prep.mjs <in.glb> --out <out.glb> --dry-run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from './lib/png.mjs';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/** 4바이트 경계로 올림(glTF 청크·bufferView 정렬 규약). */
function align4(n) {
  return (n + 3) & ~3;
}

/** GLB 를 { json, bin } 으로 푼다. */
function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB file (bad magic)');
  if (buf.readUInt32LE(4) !== 2) throw new Error('only glTF 2.0 binary is supported');
  let off = 12;
  let json = null;
  let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString('utf8'));
    else if (type === CHUNK_BIN) bin = data;
    off += 8 + len;
  }
  if (json === null || bin === null) throw new Error('GLB missing JSON or BIN chunk');
  return { json, bin };
}

/**
 * 면적평균(box) 축소. nearest 로 줄이면 텍셀이 튀어 축소본에 에일리어싱이 남는다 —
 * 원본 텍셀 사각형의 평균을 내야 균열·발광의 밝기 분포가 보존된다.
 */
function downscale(img, target) {
  const { width: sw, height: sh, channels: ch, pixels: sp } = img;
  const scale = Math.max(sw, sh) <= target ? 1 : target / Math.max(sw, sh);
  if (scale === 1) return img; // 이미 충분히 작다 — 재인코딩만 한다.
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const out = new Uint8Array(dw * dh * ch);
  for (let dy = 0; dy < dh; dy++) {
    const y0 = Math.floor((dy * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * sh) / dh));
    for (let dx = 0; dx < dw; dx++) {
      const x0 = Math.floor((dx * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * sw) / dw));
      const n = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < ch; c++) {
        let sum = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) sum += sp[(y * sw + x) * ch + c];
        }
        out[(dy * dw + dx) * ch + c] = Math.round(sum / n);
      }
    }
  }
  return { width: dw, height: dh, colorType: img.colorType, channels: ch, pixels: out };
}

/**
 * 이미지 인덱스 → 용도. 머티리얼이 그 이미지를 어느 슬롯에 쓰는지로 판정한다(노멀맵은 더
 * 작게 줄여도 되기 때문에 구분이 필요하다). 판정 불가면 보수적으로 컬러 취급.
 */
function imageRoles(json) {
  const roles = new Map();
  const imageOfTexture = (ti) => json.textures?.[ti]?.source;
  for (const mat of json.materials ?? []) {
    const normal = mat.normalTexture?.index;
    if (normal !== undefined) {
      const img = imageOfTexture(normal);
      if (img !== undefined) roles.set(img, 'normal');
    }
  }
  return roles;
}

function main(argv) {
  const inPath = argv[0];
  if (inPath === undefined || inPath.startsWith('--')) {
    console.error('usage: glb-prep.mjs <in.glb> --out <out.glb> [--color 256] [--normal 128] [--dry-run]');
    process.exit(2);
  }
  const flag = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    return i < 0 ? dflt : argv[i + 1];
  };
  const outPath = flag('out', undefined);
  const colorMax = Number(flag('color', 256));
  const normalMax = Number(flag('normal', 128));
  const dryRun = argv.includes('--dry-run');
  if (outPath === undefined && !dryRun) throw new Error('--out is required (or use --dry-run)');

  const src = readFileSync(inPath);
  const { json, bin } = parseGlb(src);
  const roles = imageRoles(json);

  // 이미지 bufferView → 새 PNG 바이트. 나머지 bufferView 는 그대로 옮긴다.
  const replaced = new Map();
  for (const [i, image] of (json.images ?? []).entries()) {
    if (image.bufferView === undefined) continue; // 외부 URI 이미지는 대상 아님.
    if (image.mimeType !== 'image/png') {
      throw new Error(`image ${i}: unsupported mime ${image.mimeType} (only image/png; no JPEG decoder)`);
    }
    const bv = json.bufferViews[image.bufferView];
    const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const decoded = decodePng(Buffer.from(bytes));
    const role = roles.get(i) ?? 'color';
    const target = role === 'normal' ? normalMax : colorMax;
    const small = downscale(decoded, target);
    const encoded = encodePng(small);
    console.log(
      `image ${i} (${role}): ${decoded.width}x${decoded.height} ${(bv.byteLength / 1048576).toFixed(2)}MB` +
        ` → ${small.width}x${small.height} ${(encoded.length / 1024).toFixed(0)}KB`,
    );
    replaced.set(image.bufferView, encoded);
  }

  // BIN 재조립 — bufferView 를 순서대로 다시 깔고 오프셋을 재계산한다.
  const parts = [];
  let cursor = 0;
  for (const [bvi, bv] of json.bufferViews.entries()) {
    const body = replaced.get(bvi) ?? null;
    const bytes =
      body ?? Buffer.from(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    const pad = align4(cursor) - cursor;
    if (pad > 0) parts.push(Buffer.alloc(pad));
    cursor += pad;
    bv.byteOffset = cursor;
    bv.byteLength = bytes.length;
    parts.push(bytes);
    cursor += bytes.length;
  }
  const newBin = Buffer.concat(parts);
  json.buffers[0].byteLength = newBin.length;

  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.alloc(align4(jsonBuf.length) - jsonBuf.length, 0x20); // 공백 패딩(규약).
  const binPad = Buffer.alloc(align4(newBin.length) - newBin.length, 0);
  const jsonChunk = Buffer.concat([jsonBuf, jsonPad]);
  const binChunk = Buffer.concat([newBin, binPad]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonChunk.length, 0);
  jsonHead.writeUInt32LE(CHUNK_JSON, 4);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binChunk.length, 0);
  binHead.writeUInt32LE(CHUNK_BIN, 4);
  const out = Buffer.concat([header, jsonHead, jsonChunk, binHead, binChunk]);

  console.log(
    `total: ${(src.length / 1048576).toFixed(2)}MB → ${(out.length / 1048576).toFixed(2)}MB` +
      ` (${((1 - out.length / src.length) * 100).toFixed(1)}% 감소)`,
  );
  if (dryRun) return;
  writeFileSync(outPath, out);
  console.log(`wrote ${outPath}`);
}

main(process.argv.slice(2));
