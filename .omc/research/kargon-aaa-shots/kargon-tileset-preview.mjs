#!/usr/bin/env node
/**
 * 오프라인 프리뷰 — `AutotileBackground.update` 의 배치 규칙을 그대로 재현해
 * 1920×1080 화면 한 장을 PNG 로 굽는다(브라우저·개발서버 없이 판정하기 위함).
 * 재현 대상: upperAt/keyAt, rot180 변형, 채움 타일 변형 선택, macroTint 곱연산.
 *
 * 사용법: node kargon-tileset-preview.mjs <out.png> [seed] [DISPLAY_TILE] [NOISE_SCALE]
 *                                        [UPPER_THRESHOLD] [tilesetDir] [planet]
 *
 * ⚠️ 경로는 **스크립트 자기 위치 기준**으로 잡는다. 예전엔 메인 체크아웃 절대경로가 박혀 있어
 * 워크트리에서 돌려도 다른 체크아웃의 자산을 읽었다(같은 결함이 생성기 쪽에도 있었다).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { decodePng, encodePng } from '../../../scripts/lib/png.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [, , outPath, seedArg, dtArg, nsArg, thArg, dirArg, planetArg] = process.argv;
const PLANET = planetArg ?? 'kargon';
const SEED = Number(seedArg ?? 12345) >>> 0;
const DISPLAY_TILE = Number(dtArg ?? 64);
const NOISE_SCALE = Number(nsArg ?? 8);
const NOISE_SCALE_FINE = 3.2;
const UPPER_THRESHOLD = Number(thArg ?? 0.57);
const MACRO_SCALE = 13;
const MACRO_SCALE_FINE = 3.7;
const W = 1920;
const H = 1080;

const DIR = dirArg ? resolve(dirArg) : join(REPO, 'assets', 'tilesets');
const sheet = decodePng(readFileSync(join(DIR, `${PLANET}.png`)));
const meta = JSON.parse(readFileSync(join(DIR, `${PLANET}.json`), 'utf8'));

const cornerKey = (nw, ne, se, sw) => (nw << 3) | (ne << 2) | (se << 1) | sw;
const rot180Key = (k) =>
  cornerKey((k >> 1) & 1, k & 1, (k >> 3) & 1, (k >> 2) & 1);

/** key → bounding_box, 그리고 key → 변형 bbox 목록. */
const base = new Array(16);
for (const t of meta.tileset_data.tiles) {
  const e = (c) => (c === 'upper' ? 1 : 0);
  base[cornerKey(e(t.corners.NW), e(t.corners.NE), e(t.corners.SE), e(t.corners.SW))] =
    t.bounding_box;
}
// `AutotileBackground` 와 같은 밴드 구조(base 포함).
const BANDS = 3;
const BAND_SCALE = 5;
const baseBand = meta.base_band ?? 1;
const byBand = Array.from({ length: 16 }, () => Array.from({ length: BANDS }, () => []));
for (let k = 0; k < 16; k++) byBand[k][baseBand].push(base[k]);
for (const v of meta.fill_variants ?? []) byBand[v.key][v.band ?? 1].push(v.bounding_box);
// 밴드를 선언하지 않은 타일셋(3차 기준선 등)은 밴드 이전과 똑같이 — 전 밴드에 같은 풀.
const declaresBands =
  meta.base_band !== undefined || (meta.fill_variants ?? []).some((v) => v.band !== undefined);
if (!declaresBands)
  for (let k = 0; k < 16; k++)
    for (let b = 0; b < BANDS; b++) if (b !== 1) byBand[k][b].push(...byBand[k][1]);

function hash2(seed, x, y) {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}
const fade = (t) => t * t * (3 - 2 * t);
function valueNoise(seed, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const u = fade(fx - x0);
  const v = fade(fy - y0);
  const a = hash2(seed, x0, y0);
  const b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1);
  const d = hash2(seed, x0 + 1, y0 + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
const terrainFieldAt = (s, vx, vy) =>
  valueNoise(s, vx / NOISE_SCALE, vy / NOISE_SCALE) * 0.68 +
  valueNoise(s ^ 0x9e3779b9, vx / NOISE_SCALE_FINE, vy / NOISE_SCALE_FINE) * 0.32;
const upperAt = (s, vx, vy) => terrainFieldAt(s, vx, vy) > UPPER_THRESHOLD;

function macroTint(seed, tx, ty) {
  const m =
    valueNoise(seed ^ 0x1b873593, tx / MACRO_SCALE, ty / MACRO_SCALE) * 0.72 +
    valueNoise(seed ^ 0x7feb352d, tx / MACRO_SCALE_FINE, ty / MACRO_SCALE_FINE) * 0.28;
  const jitter = (hash2(seed ^ 0x2545f491, tx, ty) - 0.5) * 0.05;
  const shade = 0.58 + 0.42 * m + jitter;
  const heat = Math.max(0, m - 0.48) * 0.85;
  return [shade * (1 + heat * 0.36), shade * (1 - heat * 0.16), shade * (1 - heat * 0.55)];
}

const out = new Uint8Array(W * H * 4);
const cols = Math.ceil(W / DISPLAY_TILE) + 1;
const rows = Math.ceil(H / DISPLAY_TILE) + 1;
let bright = 0;
let lumSum = 0;
let regU = 0, regL = 0, nU = 0, nL = 0;
const bandHist = [0, 0, 0];
const upMask = new Uint8Array(W * H);
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const tx = c;
    const ty = r;
    const key = cornerKey(
      upperAt(SEED, tx, ty) ? 1 : 0,
      upperAt(SEED, tx + 1, ty) ? 1 : 0,
      upperAt(SEED, tx + 1, ty + 1) ? 1 : 0,
      upperAt(SEED, tx, ty + 1) ? 1 : 0,
    );
    const flip = hash2(SEED ^ 0x5bf03635, tx, ty) < 0.5;
    const drawKey = flip ? rot180Key(key) : key;
    const bandF =
      valueNoise(SEED ^ 0x3c6ef372, tx / BAND_SCALE, ty / BAND_SCALE) +
      (hash2(SEED ^ 0x27d4eb2d, tx, ty) - 0.5) * 0.14;
    const band = bandF < 0.406 ? 0 : bandF < 0.6 ? 1 : 2;
    bandHist[band]++;
    const pool = byBand[drawKey][band];
    let bb = base[drawKey];
    if (pool.length > 0) {
      const vi = Math.floor(hash2(SEED ^ 0x68bc21eb, tx, ty) * pool.length);
      bb = pool[Math.min(vi, pool.length - 1)];
    }
    const tint = macroTint(SEED, tx, ty);
    const scale = DISPLAY_TILE / bb.width;
    for (let py = 0; py < DISPLAY_TILE; py++) {
      const dy = ty * DISPLAY_TILE + py;
      if (dy < 0 || dy >= H) continue;
      for (let px = 0; px < DISPLAY_TILE; px++) {
        const dx = tx * DISPLAY_TILE + px;
        if (dx < 0 || dx >= W) continue;
        let sx = Math.floor(px / scale);
        let sy = Math.floor(py / scale);
        if (flip) {
          sx = bb.width - 1 - sx;
          sy = bb.height - 1 - sy;
        }
        const si = ((bb.y + sy) * sheet.width + bb.x + sx) * sheet.channels;
        const di = (dy * W + dx) * 4;
        const rr = Math.min(255, Math.round(sheet.pixels[si] * tint[0]));
        const gg = Math.min(255, Math.round(sheet.pixels[si + 1] * tint[1]));
        const bbv = Math.min(255, Math.round(sheet.pixels[si + 2] * tint[2]));
        out[di] = rr;
        out[di + 1] = gg;
        out[di + 2] = bbv;
        out[di + 3] = 255;
        const L = 0.2126 * rr + 0.7152 * gg + 0.0722 * bbv;
        lumSum += L;
        if (L > 150) bright++;
        // 화면 수준 명도비: 상/하부 각각의 평균(하네스 비평이 재는 값과 같은 층위).
        const isUp = key === 15 || (key !== 0 && sheet.pixels[si] > sheet.pixels[si + 2] * 1.35);
        if (isUp) upMask[dy * W + dx] = 1;
        if (isUp) {
          regU += L;
          nU++;
        } else {
          regL += L;
          nL++;
        }
      }
    }
  }
}
writeFileSync(outPath, encodePng({ width: W, height: H, colorType: 6, channels: 4, pixels: out }));

/* ---------- 4차 계측 ----------
 * ① 정적(靜) 비율: 16×16 블록의 휘도 표준편차가 문턱 미만인 블록 비율.
 *    "무늬 없는 슬래브가 화면에서 차지하는 비율" 의 조작적 정의.
 * ② lag 자기상관: 열 평균 휘도의 lag 63/64/65 상관. 64 가 양옆보다 **높으면** 격자 재발.
 * ③ 주황 위장 여유: 카르곤 적 탱크의 대표색(≈#E2761F) 대비 배경의 색차 분포.
 */
const lumAt = (x, y) => {
  const i = (y * W + x) * 4;
  return 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
};
const B = 16;
let quiet = 0;
let blocks = 0;
let upQuiet = 0;
let upBlocks = 0;
for (let by = 0; by + B <= H; by += B) {
  for (let bx = 0; bx + B <= W; bx += B) {
    let s = 0;
    let s2 = 0;
    for (let y = 0; y < B; y++)
      for (let x = 0; x < B; x++) {
        const L = lumAt(bx + x, by + y);
        s += L;
        s2 += L * L;
      }
    let up = 0;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) up += upMask[(by + y) * W + bx + x];
    const n = B * B;
    const sd = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
    blocks++;
    if (sd < 9) quiet++;
    // 지각(upper) 안에서만 본 정적 비율 — 암부는 원래 조용하므로 섞으면 의미가 흐려진다.
    if (up > n * 0.8) {
      upBlocks++;
      if (sd < 12) upQuiet++;
    }
  }
}
// 열 평균 휘도 자기상관
const colMean = new Float64Array(W);
for (let x = 0; x < W; x++) {
  let s = 0;
  for (let y = 0; y < H; y++) s += lumAt(x, y);
  colMean[x] = s / H;
}
function autocorr(lag) {
  let n = 0,
    sa = 0,
    sb = 0,
    saa = 0,
    sbb = 0,
    sab = 0;
  for (let x = 0; x + lag < W; x++) {
    const a = colMean[x];
    const b = colMean[x + lag];
    sa += a;
    sb += b;
    saa += a * a;
    sbb += b * b;
    sab += a * b;
    n++;
  }
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2;
  const vb = sbb / n - (sb / n) ** 2;
  return cov / Math.sqrt(va * vb);
}
/**
 * ④ **위상 프로파일**(4차 추가). lag 자기상관은 분모가 화면 전체 분산이라, 지각을 어둡게 해
 * 지형 대비가 줄면 격자 에너지가 그대로여도 값이 커진다 — 4차에서 실제로 그런 착시가 났다.
 * 절대 단위로 재는 게 옳다: 픽셀을 `x mod P` 로 묶어 평균 휘도 프로파일을 만들고 그 진폭
 * (peak-to-peak)을 본다. P=64(타일 피치)의 진폭이 P=61/67(격자와 무관한 대조 주기)보다
 * 뚜렷이 크면 격자가 있는 것이고, 비슷하면 노이즈 바닥이다.
 */
function phaseAmp(P, vertical) {
  const sum = new Float64Array(P);
  const cnt = new Float64Array(P);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = (vertical ? y : x) % P;
      sum[k] += lumAt(x, y);
      cnt[k]++;
    }
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < P; k++) {
    const m = sum[k] / cnt[k];
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }
  return hi - lo;
}
// 적 탱크 주황 대비 색차(ΔRGB 유클리드). 낮을수록 위장.
const ER = 226,
  EG = 118,
  EB = 31;
let near = 0;
for (let y = 0; y < H; y += 2)
  for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4;
    const d = Math.hypot(out[i] - ER, out[i + 1] - EG, out[i + 2] - EB);
    if (d < 70) near++;
  }
const sampled = Math.ceil(H / 2) * Math.ceil(W / 2);

console.log(
  `${outPath}  seed=${SEED} tile=${DISPLAY_TILE} ns=${NOISE_SCALE} th=${UPPER_THRESHOLD}` +
    `  meanL=${(lumSum / (W * H)).toFixed(1)}  bright>150=${((bright / (W * H)) * 100).toFixed(1)}%` +
    `  upperL=${(regU / nU).toFixed(1)} lowerL=${(regL / nL).toFixed(1)} ratio=${(regU / nU / (regL / nL)).toFixed(2)} upperArea=${((nU / (nU + nL)) * 100).toFixed(1)}%` +
    `\n    bands=${bandHist.map((n) => ((n / (bandHist[0] + bandHist[1] + bandHist[2])) * 100).toFixed(0)).join('/')}%` +
    `  quiet16(sd<9)=${((quiet / blocks) * 100).toFixed(1)}%` +
    `  quietInUpper(sd<12)=${((upQuiet / upBlocks) * 100).toFixed(1)}%` +
    `  lag63=${autocorr(63).toFixed(4)} lag64=${autocorr(64).toFixed(4)} lag65=${autocorr(65).toFixed(4)}` +
    `  enemyOrangeConfusable(<70)=${((near / sampled) * 100).toFixed(2)}%` +
    `\n    phaseAmpL x:P64=${phaseAmp(64, false).toFixed(2)} (ctrl P61=${phaseAmp(61, false).toFixed(2)} P67=${phaseAmp(67, false).toFixed(2)})` +
    `  y:P64=${phaseAmp(64, true).toFixed(2)} (ctrl P61=${phaseAmp(61, true).toFixed(2)} P67=${phaseAmp(67, true).toFixed(2)})`,
);
