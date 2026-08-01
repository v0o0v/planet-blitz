/**
 * title-art-prep — 타이틀 키아트 레이어 준비 (의존성 0, `scripts/lib/png.mjs` 만 사용).
 *
 * ## 왜 이 스크립트가 필요한가
 * 타이틀 배경은 마스터 키아트 1장을 패럴랙스 레이어로 분해해 쓴다. 그런데 생성 모델
 * (`meshy_image_to_image`)은 **알파 채널을 못 내고 결과가 항상 1024×1024 정사각**이다.
 *
 * ⚠️ **AI 가 만든 실루엣 마스크로 마스터를 오리는 방식은 폐기했다.** 모델이 프레임을 미묘하게
 * 다시 그려서(마스크 콘텐츠 종횡비 1.662 vs 마스터 1.792) 마스터에 그대로 맞추면 아치
 * 가장자리가 수십 px 어긋난다. 대신 **마스터 이미지 자체에서** 아치 개구부를 추출한다 —
 * 정의상 완벽하게 정합하고, AI 왕복도 사라진다.
 *
 * ## 개구부를 찾는 판별식
 * 개구부 안은 성운(청록·자홍)이고 아치 석재는 금빛이다. 즉 **b 가 r 보다 우세**하면 하늘,
 * 아니면 석재다. 휘도로 자르지 않는 이유는 바닥의 밝은 금색이 하늘보다 밝기 때문이다.
 * 판별 후 **화면 중앙 영역의 하늘 픽셀 전부를 시드로** flood fill 하고(중앙 한 점을 찍으면
 * 거기가 행성이라 0 픽셀이 나온다), 행성이 만든 구멍은 **행별 좌우 span 채우기**로 닫는다.
 *
 * 채워진 영역이 이미지 테두리에 닿으면 판별식이 새어 나간 것이므로 명시적으로 던진다 —
 * 조용히 통과하면 화면 전체가 창으로 뚫린 채 배포된다.
 *
 * ## 명령
 *   window   <master.png> <out.png> [--inset 2] [--feather 3]
 *       마스터에 **아치 개구부만 투명한 창**을 뚫은 전경 판을 만든다. 이 한 장이 패럴랙스의
 *       맨 앞 레이어이고, 그 뒤에서 하늘·행성·3D 함선이 창을 통해 움직인다.
 *   keyblack <src.png> <out.png> [--threshold 24] [--feather 2]
 *       순검정 배경 위 요소(행성·로고·함선 컨셉)를 **테두리에서 시작하는 flood fill** 로
 *       뽑는다. 휘도 임계로 자르지 않는 이유는 요소 **내부의 어두운 부분**(행성 야간면,
 *       금속 그림자)이 함께 뚫려 버리기 때문이다. 배경 검정은 테두리와 연결돼 있고 내부
 *       어두운 픽셀은 그렇지 않다 — 연결성이 휘도보다 정확한 판별식이다.
 *   probe    <master.png> <out_debug.png>
 *       개구부 판정 결과를 자홍으로 칠한 확인용 이미지를 낸다(눈으로 검증할 때만).
 *
 * ## WebP
 * 최종 배포본은 WebP 다(`assets/title/*.webp`). 이 스크립트는 의존성 0 규약을 지키느라
 * PNG 까지만 만들고, WebP 인코딩은 별도 한 줄로 처리한다:
 *   python -c "from PIL import Image; Image.open('in.png').save('out.webp', quality=88, method=6)"
 * 리포의 진실은 커밋된 `.webp` 이고 이 스크립트는 재생성 편의를 위한 것이다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from './lib/png.mjs';

/** 디코드 결과를 항상 RGBA 8bit 로 정규화한다(이후 코드가 채널 수를 신경 쓰지 않도록). */
function toRgba(png) {
  const { width, height, channels, pixels } = png;
  if (channels === 4) return { width, height, pixels: Uint8Array.from(pixels) };
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    const [r, g, b, a] =
      channels === 1 ? [pixels[p], pixels[p], pixels[p], 255]
      : channels === 2 ? [pixels[p], pixels[p], pixels[p], pixels[p + 1]]
      : [pixels[p], pixels[p + 1], pixels[p + 2], 255];
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  }
  return { width, height, pixels: out };
}

const lum = (px, i) => (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;

/** 3×3 박스 블러 `passes` 회 — 알파 가장자리의 계단을 눕힌다. */
function feather(src, width, height, passes) {
  let cur = src;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            sum += cur[ny * width + nx];
            cnt++;
          }
        }
        next[y * width + x] = sum / cnt;
      }
    }
    cur = next;
  }
  return cur;
}

// --- window ------------------------------------------------------------------

/** 아치 개구부(=하늘이 보이는 구멍)를 1 로 표시한 마스크를 마스터에서 뽑는다. */
function findOpening(width, height, pixels) {
  // 성운(청록·자홍)은 b 가 r 보다 우세하다. 금빛 석재·바닥은 r 이 우세해 배제된다.
  const isSky = (i) => {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    return lum(pixels, i) > 45 && b > r * 1.04 && (g > r * 1.02 || b > g * 1.02);
  };

  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (seen[i] === 1 || !isSky(i * 4)) return;
    seen[i] = 1;
    stack.push(x, y);
  };

  // 중앙 한 점을 시드로 쓰면 거기가 행성이라 0 픽셀이 나온다 — 중앙 영역의 하늘 픽셀 전부를
  // 시드로 넣는다. 행성이 만든 구멍은 아래 span 채우기가 닫는다.
  const x0 = Math.floor(width * 0.25), x1 = Math.ceil(width * 0.75);
  const y0 = Math.floor(height * 0.3), y1 = Math.ceil(height * 0.6);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) push(x, y);
  while (stack.length > 0) {
    const y = stack.pop(), x = stack.pop();
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // 행별 좌우 span 을 메워 행성 구멍을 닫는다.
  const mask = new Uint8Array(width * height);
  let count = 0, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < width; x++) if (seen[y * width + x] === 1) { if (lo < 0) lo = x; hi = x; }
    if (lo < 0) continue;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    for (let x = lo; x <= hi; x++) { mask[y * width + x] = 1; count++; }
  }
  if (count === 0) throw new Error('개구부를 하나도 못 찾았다 — 하늘 판별식이 이 마스터에 안 맞는다');

  // 테두리에 닿으면 판별식이 새어 나간 것이다. 조용히 통과시키면 화면 전체가 뚫린다.
  for (let x = 0; x < width; x++) {
    if (mask[x] === 1 || mask[(height - 1) * width + x] === 1) throw new Error('개구부가 상/하단 테두리에 닿았다 — 판별식이 샜다');
  }
  for (let y = 0; y < height; y++) {
    if (mask[y * width] === 1 || mask[y * width + width - 1] === 1) throw new Error('개구부가 좌/우 테두리에 닿았다 — 판별식이 샜다');
  }
  return { mask, count, minY, maxY };
}

function cmdWindow(masterPath, outPath, opts) {
  const { width, height, pixels } = toRgba(decodePng(readFileSync(masterPath)));
  const { mask, count } = findOpening(width, height, pixels);

  // inset: 개구부를 조금 **넓혀** 석재 쪽으로 파고든다. 창 가장자리에 마스터 자신의 하늘이
  // 한 줄 남으면 뒤에서 흐르는 하늘과 어긋난 정지 띠로 보이기 때문이다.
  let grown = mask;
  for (let step = 0; step < opts.inset; step++) {
    const next = Uint8Array.from(grown);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (grown[y * width + x] === 1) continue;
        if (
          grown[(y - 1) * width + x] === 1 || grown[(y + 1) * width + x] === 1 ||
          grown[y * width + x - 1] === 1 || grown[y * width + x + 1] === 1
        ) next[y * width + x] = 1;
      }
    }
    grown = next;
  }

  const alpha = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = grown[i] === 1 ? 0 : 255;
  const soft = feather(alpha, width, height, opts.feather);

  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = pixels[i * 4];
    out[i * 4 + 1] = pixels[i * 4 + 1];
    out[i * 4 + 2] = pixels[i * 4 + 2];
    out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(soft[i])));
  }
  writeFileSync(outPath, encodePng({ width, height, colorType: 6, channels: 4, pixels: out }));
  console.log(`[window] ${outPath} ${width}x${height} opening=${((count / (width * height)) * 100).toFixed(1)}% inset=${opts.inset} feather=${opts.feather}`);
}

function cmdProbe(masterPath, outPath) {
  const { width, height, pixels } = toRgba(decodePng(readFileSync(masterPath)));
  const { mask, count, minY, maxY } = findOpening(width, height, pixels);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const on = mask[i] === 1;
    out[i * 4] = on ? 255 : pixels[i * 4];
    out[i * 4 + 1] = on ? 0 : pixels[i * 4 + 1];
    out[i * 4 + 2] = on ? 255 : pixels[i * 4 + 2];
    out[i * 4 + 3] = 255;
  }
  writeFileSync(outPath, encodePng({ width, height, colorType: 6, channels: 4, pixels: out }));
  console.log(`[probe] ${outPath} opening=${count}px rows ${minY}..${maxY}`);
}

// --- keyblack ----------------------------------------------------------------

function cmdKeyBlack(srcPath, outPath, opts) {
  const { width, height, pixels } = toRgba(decodePng(readFileSync(srcPath)));
  const n = width * height;
  const bg = new Uint8Array(n);

  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (bg[i] === 1 || lum(pixels, i * 4) > opts.threshold) return;
    bg[i] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (stack.length > 0) {
    const y = stack.pop(), x = stack.pop();
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (bg[i] === 1) { alpha[i] = 0; continue; }
    const l = lum(pixels, i * 4);
    alpha[i] = l >= opts.threshold ? 255 : (l / opts.threshold) * 255;
  }
  const soft = feather(alpha, width, height, opts.feather);

  const out = new Uint8Array(n * 4);
  let opaque = 0;
  for (let i = 0; i < n; i++) {
    out[i * 4] = pixels[i * 4];
    out[i * 4 + 1] = pixels[i * 4 + 1];
    out[i * 4 + 2] = pixels[i * 4 + 2];
    const a = Math.max(0, Math.min(255, Math.round(soft[i])));
    out[i * 4 + 3] = a;
    if (a > 200) opaque++;
  }
  writeFileSync(outPath, encodePng({ width, height, colorType: 6, channels: 4, pixels: out }));
  console.log(`[keyblack] ${outPath} ${width}x${height} opaque=${((opaque / n) * 100).toFixed(1)}%`);
}

// --- entry -------------------------------------------------------------------

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : dflt;
};
const positional = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { i++; continue; }
  positional.push(argv[i]);
}

if (cmd === 'window') {
  if (positional.length < 2) throw new Error('usage: window <master.png> <out.png> [--inset N] [--feather N]');
  cmdWindow(positional[0], positional[1], { inset: flag('inset', 2), feather: flag('feather', 3) });
} else if (cmd === 'probe') {
  if (positional.length < 2) throw new Error('usage: probe <master.png> <out_debug.png>');
  cmdProbe(positional[0], positional[1]);
} else if (cmd === 'keyblack') {
  if (positional.length < 2) throw new Error('usage: keyblack <src.png> <out.png> [--threshold N] [--feather N]');
  cmdKeyBlack(positional[0], positional[1], { threshold: flag('threshold', 24), feather: flag('feather', 2) });
} else {
  throw new Error(`unknown command ${String(cmd)} — window | probe | keyblack`);
}
