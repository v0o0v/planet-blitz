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
 * 의존성 0(`scripts/lib/png.mjs` 공유 코덱만 쓴다). 자산 픽셀에서 색을 뽑는 부분(적 몸통색
 * 추출·PNG 로딩·색 유틸)은 {@link file://./assetColor.mjs} 로 빠졌다 — **테스트도 같은 질문을
 * 물으므로**(테마 선언 배경색 ↔ 실제 타일셋, 테마 팔레트 ↔ 적 몸통색) 추출기가 두 벌이 되면
 * 하한값이 갈라진다. 여기서는 그 모듈을 부르기만 한다.
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

import { readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  ENEMY_SPRITE_FILES,
  enemyBodyColors,
  hue,
  loadRgba,
  luma,
  rgbDeltaSum,
} from './assetColor.mjs';

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

/**
 * 배경 픽셀 중 **각 적의** 몸통색과 ΔRGB(합) 미만으로 가까운 비율. 낮을수록 잘 읽힌다.
 * 판정은 최악 적 기준이며, 어느 적인지 함께 낸다(고칠 대상이 그 적의 색 대비이므로).
 *
 * 몸통색 추출은 {@link file://./assetColor.mjs} 가 정본이다(테스트와 공유).
 */
function camo(img, planet, threshold = 70) {
  if (ENEMY_SPRITE_FILES[planet] === undefined) {
    throw new Error(`unknown planet: ${planet} (${Object.keys(ENEMY_SPRITE_FILES).join('|')})`);
  }
  const bodies = enemyBodyColors(planet);
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
        if (rgbDeltaSum({ r, g, b }, bodies[k]) < threshold) near[k]++;
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
    // `--match` 로 비교 대상을 좁힌다(부분 문자열). 두 가지 이유로 필요하다:
    //  1. 기준선 디렉터리에는 solo·noise 진단 컷도 함께 있는데, 그것까지 "없으면 실패"로 세면
    //     게이트가 무관한 이유로 빨개진다.
    //  2. **게이트는 `-bg` 컷으로 잡아야 한다.** `full` 컷은 엔티티를 포함하는데, sim 해시가
    //     같아도 엔티티 렌더 보간 계수가 벽시계 누산기 기반이라 프레임마다 달라진다
    //     (실측: bg 는 mean 0.00 인데 같은 런의 full 은 mean 1.5~3.3 · 국소 32~84).
    //     full 은 육안 검토용이고 판정용이 아니다.
    const match = opt('--match', '');
    const names = readdirSync(baseDir).filter((f) => f.endsWith('.png') && f.includes(match));
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
