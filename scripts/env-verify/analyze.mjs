#!/usr/bin/env node
/**
 * env-verify 분석기 — 배경 레이어 판정을 9회 이상 반복하므로 눈이 아니라 수치로 잠근다.
 *
 * ## 이 파일이 존재하는 이유는 "지표가 틀릴 수 있어서"다
 * 카르곤 레인에서 지표 셋 중 둘이 틀린 채로 판정을 내렸다. 그 실패를 여기 구현으로 봉인한다.
 *
 *  - **위장(camouflage)**: 적 대표색을 "불투명 픽셀 최빈색"으로 뽑으면 **어두운 외곽선**
 *    (rgb 45,33,33 같은)이 뽑혀 어두운 배경 거의 전부와 매칭된다(실측 97.6%). 그건 "적이
 *    묻힌다"가 아니라 "배경이 어둡다"를 재는 것이다. 플레이어가 적을 발견하는 단서는 밝고
 *    채도 높은 **몸통색**이므로 휘도·채도 하한을 걸어 외곽선을 배제한다.
 *  - **격자(grid)**: 자기상관 같은 **정규화 지표를 쓰지 않는다**. 분모가 화면 대비라 지형을
 *    어둡게 하면 격자 에너지가 그대로여도 값이 올라 "격자 재발"로 오인한다(실제로 2회 오진).
 *    절대 단위(위상별 평균 휘도의 peak-to-peak)로 재되, **화면을 그냥 훑으면 안 된다** —
 *    화면 크기가 주기의 정수배가 아니면 위상마다 표본 수가 달라 상·하단 HUD 띠와 비네트를
 *    재게 된다(실측: y축 값이 x축의 3배였는데 대조 주기에서도 똑같이 3배였다). 그래서
 *    `floor(N/period)*period` 로 자르고 HUD 영역을 crop 으로 뺀다. 그리고 항상 **대조 주기**
 *    (타일과 서로소)를 함께 재서 "구조 없는 바닥값"을 같이 보고한다 — 대조와 비슷하면 격자가
 *    아니라 그냥 화면 얼룩이다.
 *  - **명도(tone)**: 16구간 히스토그램은 한 구간이 67% 를 삼켜 봉우리가 1개로 나온다. 구간
 *    개수로 봉우리를 세는 대신 **분위수와 면적 비율**을 보고한다(해석이 일의적이다).
 *  - **레이어 기여(delta)**: 평균 픽셀 델타는 **큰 랜드마크를 못 잰다**. 화면당 2~3개짜리
 *    부조는 평균이 아니라 국소 대비다. 그래서 평균과 함께 **국소 최대**(타일 격자 블록별
 *    평균 델타의 상위값)를 같이 낸다. 지표 하나로 모든 레이어를 재면 오판한다.
 *
 * 의존성 0(`scripts/lib/png.mjs` 공유 코덱만 쓴다).
 *
 * ## 사용법
 *   node scripts/env-verify/analyze.mjs tone   <shot.png>
 *   node scripts/env-verify/analyze.mjs grid   <shot.png> [--period 64] [--control 53]
 *   node scripts/env-verify/analyze.mjs camo   <shot.png> --planet kargon|berdan|niflheim|arke|toxar|kras
 *   node scripts/env-verify/analyze.mjs delta  <a.png> <b.png>
 *   node scripts/env-verify/analyze.mjs regress <baseDir> <newDir> [--max 0.12]
 *   node scripts/env-verify/analyze.mjs report <shot.png> --planet <name>   # tone+grid+camo 한 번에
 *
 * 공통 옵션: `--crop-top 0.08 --crop-bottom 0.12` (HUD 띠 배제 비율), `--json`.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { decodePng } from '../lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// 인자 파싱
// ─────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const CMD = argv[0];
const POSITIONAL = argv.slice(1).filter((a) => !a.startsWith('--'));

function opt(flag, fallback) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}
function flag(name) {
  return argv.includes(name);
}
function num(flagName, fallback) {
  const v = opt(flagName, undefined);
  return v === undefined ? fallback : Number(v);
}

const CROP_TOP = num('--crop-top', 0.08);
const CROP_BOTTOM = num('--crop-bottom', 0.12);
const JSON_OUT = flag('--json');

// ─────────────────────────────────────────────────────────────────────────────
// 이미지 로딩 · 색 유틸
// ─────────────────────────────────────────────────────────────────────────────

/** PNG → `{ w, h, rgba: Uint8Array }` (항상 RGBA 4채널로 정규화). */
function loadRgba(path) {
  const png = decodePng(readFileSync(path));
  const { width: w, height: h, channels, pixels: data } = png;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    let r, g, b, a;
    if (channels === 1) { r = g = b = data[i]; a = 255; }
    else if (channels === 2) { r = g = b = data[i * 2]; a = data[i * 2 + 1]; }
    else if (channels === 3) { r = data[i * 3]; g = data[i * 3 + 1]; b = data[i * 3 + 2]; a = 255; }
    else { r = data[i * 4]; g = data[i * 4 + 1]; b = data[i * 4 + 2]; a = data[i * 4 + 3]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w, h, rgba };
}

/** Rec.709 상대휘도(0~255 스케일). */
function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** HSV 채도(0~1). max=0 이면 0. */
function sat(r, g, b) {
  const mx = Math.max(r, g, b);
  if (mx === 0) return 0;
  return (mx - Math.min(r, g, b)) / mx;
}

/** HSV 색상각(도, 0~360). 무채색이면 NaN. */
function hue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return Number.NaN;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/**
 * HUD 띠를 제외한 세로 구간. 배경 판정은 화면 상·하단의 UI 오버레이를 재면 안 된다
 * (그 띠 때문에 y축 위상 프로파일이 x축의 3배로 나왔던 오진이 이것이다).
 */
function cropRows(h) {
  const y0 = Math.floor(h * CROP_TOP);
  const y1 = Math.ceil(h * (1 - CROP_BOTTOM));
  return [y0, Math.max(y0 + 1, y1)];
}

function pct(x) {
  return `${(x * 100).toFixed(2)}%`;
}
function f2(x) {
  return Number.isFinite(x) ? x.toFixed(2) : String(x);
}

// ─────────────────────────────────────────────────────────────────────────────
// tone — 명도 분포
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 명도 분포. 봉우리를 "세지" 않는다 — 구간 폭에 따라 답이 달라지기 때문이다.
 * 대신 분위수와 면적 비율을 낸다. "화면 55%가 재질 없는 검정"류 진단은
 * `darkFrac`(L<24) 과 `p50` 으로 직접 읽힌다.
 */
function tone(img) {
  const [y0, y1] = cropRows(img.h);
  const vals = [];
  let dark = 0, mid = 0, bright = 0, sum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      const L = luma(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]);
      vals.push(L);
      sum += L;
      if (L < 24) dark++;
      else if (L < 96) mid++;
      else bright++;
    }
  }
  vals.sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  const n = vals.length;
  return {
    pixels: n,
    mean: sum / n,
    p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95),
    spread: q(0.95) - q(0.05),
    darkFrac: dark / n,   // L<24  — "재질 없는 검정"
    midFrac: mid / n,     // 24≤L<96
    brightFrac: bright / n, // L≥96
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// grid — 타일 반복 가시성 (절대 단위)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 축 하나의 위상 프로파일 peak-to-peak(절대 휘도 단위).
 *
 * 표본 수를 위상마다 **같게** 만드는 것이 이 함수의 핵심이다. `floor(N/period)*period`
 * 로 잘라야 각 위상이 정확히 같은 열/행 수를 갖는다. 자르지 않으면 남는 나머지가 특정
 * 위상에만 더해져 화면 가장자리(비네트·HUD)를 격자로 오인한다.
 */
function phaseP2P(img, period, axis, y0, y1) {
  const usableW = Math.floor(img.w / period) * period;
  const usableH = Math.floor((y1 - y0) / period) * period;
  if (usableW < period || usableH < period) return Number.NaN;
  const sums = new Float64Array(period);
  const counts = new Float64Array(period);
  for (let y = y0; y < y0 + usableH; y++) {
    for (let x = 0; x < usableW; x++) {
      const i = (y * img.w + x) * 4;
      const L = luma(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]);
      const p = axis === 'x' ? x % period : (y - y0) % period;
      sums[p] += L;
      counts[p]++;
    }
  }
  let mn = Infinity, mx = -Infinity;
  for (let p = 0; p < period; p++) {
    const m = sums[p] / counts[p];
    if (m < mn) mn = m;
    if (m > mx) mx = m;
  }
  return mx - mn;
}

/**
 * 격자 검사. **대조 주기를 반드시 함께 본다** — 타일 주기의 값만 보면 "이 정도면 큰가?"에
 * 답할 수 없다. 타일과 서로소인 주기에서 나온 값이 구조 없는 바닥값이고, 타일 주기가
 * 그보다 유의하게 크지 않으면 격자가 보이는 게 아니다.
 */
function grid(img, period, control) {
  const [y0, y1] = cropRows(img.h);
  const tx = phaseP2P(img, period, 'x', y0, y1);
  const ty = phaseP2P(img, period, 'y', y0, y1);
  const cx = phaseP2P(img, control, 'x', y0, y1);
  const cy = phaseP2P(img, control, 'y', y0, y1);
  return {
    period, control,
    tileX: tx, tileY: ty,
    controlX: cx, controlY: cy,
    excessX: tx - cx, excessY: ty - cy,
    verdict: Math.max(tx - cx, ty - cy) < 1.5 ? 'ok' : Math.max(tx - cx, ty - cy) < 3.0 ? 'warn' : 'grid-visible',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// camo — 전경 가독성 (적이 배경에 묻히는가)
// ─────────────────────────────────────────────────────────────────────────────

/** 행성 → 적 스프라이트 파일 목록. 카르곤만 접두 없이 저장돼 있다. */
const ENEMY_FILES = {
  kargon: ['enemy_charger.png', 'enemy_mortar.png', 'enemy_lavaspring.png', 'enemy_support.png'],
  berdan: ['enemy_berdan_charger.png', 'enemy_berdan_gunner.png', 'enemy_berdan_special.png', 'enemy_berdan_support.png'],
  niflheim: ['enemy_niflheim_charger.png', 'enemy_niflheim_gunner.png', 'enemy_niflheim_special.png', 'enemy_niflheim_support.png'],
  arke: ['enemy_arke_charger.png', 'enemy_arke_gunner.png', 'enemy_arke_special.png', 'enemy_arke_support.png'],
  toxar: ['enemy_toxar_charger.png', 'enemy_toxar_gunner.png', 'enemy_toxar_special.png', 'enemy_toxar_support.png'],
  kras: ['enemy_kras_charger.png', 'enemy_kras_gunner.png', 'enemy_kras_special.png', 'enemy_kras_support.png'],
};

/** 외곽선을 배제하는 하한. 이 두 줄이 위장 지표의 전부다(없으면 97.6% 같은 허수가 나온다). */
const BODY_MIN_LUMA = 60;
const BODY_MIN_SAT = 0.25;

/**
 * 적 스프라이트 **한 장**의 몸통 대표색 1개.
 *
 * 불투명 픽셀을 전부 후보로 삼으면 어두운 외곽선이 최다 색으로 뽑혀 어두운 배경 거의
 * 전부와 매칭된다. 플레이어가 적을 발견하는 단서는 밝고 채도 높은 면이므로 휘도·채도
 * 하한을 통과한 픽셀만 세고, 32단계 양자화 격자의 최빈 1색을 쓴다.
 *
 * **적별 색을 하나로 합치지 않는다.** 4종 × 상위 3색을 OR 로 묶으면 12색 중 아무거나
 * 걸리기만 해도 세어져 값이 구조적으로 부풀고(실측 24% → 적별로는 대부분 한 자리),
 * 무엇보다 "어느 적이 안 보이는가"라는 실제로 고쳐야 할 정보가 사라진다.
 */
function enemyBodyColor(file) {
  const path = join(ROOT, 'assets', file);
  if (!existsSync(path)) return null;
  const img = loadRgba(path);
  const bins = new Map();
  for (let i = 0; i < img.w * img.h; i++) {
    if (img.rgba[i * 4 + 3] < 200) continue;
    const r = img.rgba[i * 4], g = img.rgba[i * 4 + 1], b = img.rgba[i * 4 + 2];
    if (luma(r, g, b) < BODY_MIN_LUMA) continue;
    if (sat(r, g, b) < BODY_MIN_SAT) continue;
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    bins.set(key, e);
  }
  let best = null;
  for (const e of bins.values()) if (best === null || e.n > best.n) best = e;
  if (best === null) return null;
  return { file, r: best.r / best.n, g: best.g / best.n, b: best.b / best.n, n: best.n };
}

/**
 * 배경 픽셀 중 **각 적의** 몸통색과 ΔRGB(합) 미만으로 가까운 비율. 낮을수록 잘 읽힌다.
 * 판정은 최악 적 기준이며, 어느 적인지 함께 낸다(고칠 대상이 그 적의 색 대비이므로).
 */
function camo(img, planet, threshold = 70) {
  const files = ENEMY_FILES[planet];
  if (!files) throw new Error(`unknown planet: ${planet} (${Object.keys(ENEMY_FILES).join('|')})`);
  const bodies = files.map(enemyBodyColor).filter(Boolean);
  if (bodies.length === 0) throw new Error(`몸통색을 못 뽑았다 (${planet}) — 하한이 너무 높거나 자산이 없다`);
  const [y0, y1] = cropRows(img.h);
  const near = new Array(bodies.length).fill(0);
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      const r = img.rgba[i], g = img.rgba[i + 1], b = img.rgba[i + 2];
      total++;
      for (let k = 0; k < bodies.length; k++) {
        const c = bodies[k];
        if (Math.abs(r - c.r) + Math.abs(g - c.g) + Math.abs(b - c.b) < threshold) near[k]++;
      }
    }
  }
  const per = bodies.map((c, k) => ({
    file: c.file,
    rgb: `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}`,
    hue: f2(hue(c.r, c.g, c.b)),
    px: c.n,
    nearFrac: near[k] / total,
  })).sort((a, b) => b.nearFrac - a.nearFrac);
  const worst = per[0];
  return {
    planet,
    threshold,
    per,
    worstFile: worst.file,
    nearFrac: worst.nearFrac,
    verdict: worst.nearFrac < 0.02 ? 'ok' : worst.nearFrac < 0.05 ? 'warn' : 'camouflaged',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// delta — 두 프레임 차이 (회귀 · 레이어 기여도)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 평균 |ΔRGB| 와 **국소 최대**를 함께 낸다.
 *
 * 평균만 보면 화면당 2~3개짜리 큰 부조의 기여를 0 으로 읽는다(카르곤 레인의 실제 오판).
 * 64px 블록별 평균을 구해 상위 1% 블록 평균을 같이 보고하면 "넓고 옅은 기여"와
 * "좁고 강한 기여"가 구분된다.
 */
function delta(a, b, block = 64) {
  if (a.w !== b.w || a.h !== b.h) throw new Error(`크기 불일치: ${a.w}×${a.h} vs ${b.w}×${b.h}`);
  const [y0, y1] = cropRows(a.h);
  const bx = Math.ceil(a.w / block), by = Math.ceil((y1 - y0) / block);
  const bs = new Float64Array(bx * by), bn = new Float64Array(bx * by);
  let sum = 0, n = 0, max = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4;
      const d = Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]);
      sum += d; n++;
      if (d > max) max = d;
      const k = Math.floor((y - y0) / block) * bx + Math.floor(x / block);
      bs[k] += d; bn[k]++;
    }
  }
  const blocks = [];
  for (let k = 0; k < bs.length; k++) if (bn[k] > 0) blocks.push(bs[k] / bn[k]);
  blocks.sort((p, q) => q - p);
  const top1 = blocks.slice(0, Math.max(1, Math.floor(blocks.length * 0.01)));
  return {
    meanDelta: sum / n,
    maxPixelDelta: max,
    localTop1PctBlockMean: top1.reduce((s, v) => s + v, 0) / top1.length,
    changedFrac: blocks.filter((v) => v > 1).length / blocks.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 커맨드
// ─────────────────────────────────────────────────────────────────────────────

function out(obj, human) {
  if (JSON_OUT) process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
  else process.stdout.write(`${human}\n`);
}

function main() {
  if (CMD === 'tone') {
    const img = loadRgba(POSITIONAL[0]);
    const t = tone(img);
    out(t, [
      `[tone] ${basename(POSITIONAL[0])}  ${img.w}x${img.h} (crop ${pct(CROP_TOP)}/${pct(CROP_BOTTOM)})`,
      `  mean ${f2(t.mean)}  p05 ${f2(t.p05)}  p25 ${f2(t.p25)}  p50 ${f2(t.p50)}  p75 ${f2(t.p75)}  p95 ${f2(t.p95)}  spread ${f2(t.spread)}`,
      `  dark(L<24) ${pct(t.darkFrac)}   mid ${pct(t.midFrac)}   bright(L>=96) ${pct(t.brightFrac)}`,
    ].join('\n'));
    return;
  }
  if (CMD === 'grid') {
    const img = loadRgba(POSITIONAL[0]);
    const g = grid(img, num('--period', 64), num('--control', 53));
    out(g, [
      `[grid] ${basename(POSITIONAL[0])}  period ${g.period} / control ${g.control}`,
      `  tile   x ${f2(g.tileX)}  y ${f2(g.tileY)}`,
      `  ctrl   x ${f2(g.controlX)}  y ${f2(g.controlY)}   (구조 없는 바닥값)`,
      `  excess x ${f2(g.excessX)}  y ${f2(g.excessY)}  → ${g.verdict}`,
    ].join('\n'));
    return;
  }
  if (CMD === 'camo') {
    const img = loadRgba(POSITIONAL[0]);
    const c = camo(img, opt('--planet', 'kargon'), num('--threshold', 70));
    out(c, [
      `[camo] ${basename(POSITIONAL[0])}  planet ${c.planet}  ΔRGB<${c.threshold}`,
      ...c.per.map((b) => `  ${b.file.padEnd(30)} rgb(${b.rgb}) hue ${String(b.hue).padStart(6)}  배경 근접 ${pct(b.nearFrac)}`),
      `  최악 ${c.worstFile}: ${pct(c.nearFrac)} → ${c.verdict}`,
    ].join('\n'));
    return;
  }
  if (CMD === 'delta') {
    const d = delta(loadRgba(POSITIONAL[0]), loadRgba(POSITIONAL[1]));
    out(d, [
      `[delta] ${basename(POSITIONAL[0])} vs ${basename(POSITIONAL[1])}`,
      `  mean |ΔRGB| ${f2(d.meanDelta)}   max px ${d.maxPixelDelta}`,
      `  국소(상위1% 64px블록 평균) ${f2(d.localTop1PctBlockMean)}   변화 블록 비율 ${pct(d.changedFrac)}`,
    ].join('\n'));
    return;
  }
  if (CMD === 'regress') {
    const [baseDir, newDir] = POSITIONAL;
    const max = num('--max', 0.12);
    const names = readdirSync(baseDir).filter((f) => f.endsWith('.png'));
    const rows = [];
    let worst = 0, missing = 0;
    for (const n of names) {
      const nb = join(newDir, n);
      if (!existsSync(nb)) { rows.push({ name: n, error: 'missing' }); missing++; continue; }
      const d = delta(loadRgba(join(baseDir, n)), loadRgba(nb));
      rows.push({ name: n, meanDelta: d.meanDelta, local: d.localTop1PctBlockMean });
      worst = Math.max(worst, d.meanDelta);
    }
    const pass = missing === 0 && worst <= max && names.length > 0;
    out({ pass, worst, max, missing, count: names.length, rows }, [
      `[regress] ${names.length}장  기준 ${baseDir} → ${newDir}  임계 ${max}`,
      ...rows.map((r) => r.error
        ? `  ${r.name.padEnd(34)} ✗ ${r.error}`
        : `  ${r.name.padEnd(34)} mean ${f2(r.meanDelta)}  local ${f2(r.local)}  ${r.meanDelta <= max ? 'ok' : 'OVER'}`),
      names.length === 0 ? '  ⚠ 기준선이 비어 있다 — 항진 통과 방지를 위해 실패 처리' : '',
      `  → ${pass ? 'PASS' : 'FAIL'} (worst ${f2(worst)})`,
    ].filter(Boolean).join('\n'));
    if (!pass) process.exitCode = 1;
    return;
  }
  if (CMD === 'report') {
    const path = POSITIONAL[0];
    const img = loadRgba(path);
    const planet = opt('--planet', 'kargon');
    const t = tone(img), g = grid(img, num('--period', 64), num('--control', 53)), c = camo(img, planet);
    out({ file: basename(path), tone: t, grid: g, camo: c }, [
      `═══ ${basename(path)}  (${img.w}x${img.h}, planet ${planet}) ═══`,
      `명도  mean ${f2(t.mean)}  p05/p50/p95 ${f2(t.p05)}/${f2(t.p50)}/${f2(t.p95)}  spread ${f2(t.spread)}`,
      `      dark ${pct(t.darkFrac)}  mid ${pct(t.midFrac)}  bright ${pct(t.brightFrac)}`,
      `격자  excess x ${f2(g.excessX)} y ${f2(g.excessY)}  (tile ${f2(g.tileX)}/${f2(g.tileY)} vs ctrl ${f2(g.controlX)}/${f2(g.controlY)}) → ${g.verdict}`,
      `위장  ${pct(c.nearFrac)} → ${c.verdict}`,
    ].join('\n'));
    return;
  }
  process.stderr.write('사용법은 파일 상단 주석 참조 (tone|grid|camo|delta|regress|report)\n');
  process.exitCode = 2;
}

main();
