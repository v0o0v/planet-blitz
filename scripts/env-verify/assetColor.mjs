/**
 * assetColor — **자산 픽셀에서 색을 뽑는 유일한 자리**.
 *
 * ## 왜 별도 모듈인가
 * 이 로직은 원래 `analyze.mjs`(하네스 스크린샷 판정기) 안에만 있었다. 그런데 같은 질문을
 * 테스트도 물어야 한다 — "테마가 선언한 배경색이 그 행성의 실제 타일셋과 맞는가", "테마
 * 팔레트가 그 행성 적 스프라이트 몸통색과 충분히 떨어져 있는가". 그 판정을 테스트 쪽에서
 * 다시 구현하면 **하한값이 두 곳에 적히고 그 순간 갈라진다** — 이 리포가 `UPPER_THRESHOLD`
 * 0.5 vs 0.57 로 이미 겪은 실패의 정확한 재현이다. 그래서 추출기를 여기 하나로 두고
 * `analyze.mjs`(사람이 화면을 잴 때)와 `tests/`(CI 가 계약을 잠글 때)가 **같은 함수**를 부른다.
 *
 * ## 외곽선 배제는 규율이 아니라 실측이다
 * 적 대표색을 "불투명 픽셀 최빈색"으로 뽑으면 어두운 외곽선(rgb 45,33,33 같은)이 뽑혀 어두운
 * 배경 거의 전부와 매칭된다(실측 97.6%). 그건 "적이 묻힌다"가 아니라 "배경이 어둡다"를 재는
 * 것이다. 플레이어가 적을 발견하는 단서는 밝고 채도 높은 **몸통색**이므로
 * {@link BODY_MIN_LUMA}·{@link BODY_MIN_SAT} 하한을 통과한 픽셀만 센다. 이 두 값이 위장 지표의
 * 전부다.
 *
 * 의존성 0(`scripts/lib/png.mjs` 공유 코덱만 쓴다).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../lib/png.mjs';

/** 리포 루트(이 파일은 `scripts/env-verify/` 에 있다). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// 색 유틸
// ─────────────────────────────────────────────────────────────────────────────

/** Rec.709 상대휘도(0~255 스케일). */
export function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** HSV 채도(0~1). max=0 이면 0. */
export function sat(r, g, b) {
  const mx = Math.max(r, g, b);
  if (mx === 0) return 0;
  return (mx - Math.min(r, g, b)) / mx;
}

/** HSV 색상각(도, 0~360). 무채색이면 NaN. */
export function hue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return Number.NaN;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** 두 색의 채널차 합(ΔRGB). 위장 판정의 정본 거리다(`camo` 가 쓰는 것과 같은 척도). */
export function rgbDeltaSum(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/** Rec.709 상대휘도(0~255 스케일)를 `{r,g,b}` 에서. */
export function relLuma(c) {
  return luma(c.r, c.g, c.b);
}

/**
 * 색을 **평균 채널값이 `mean` 이 되도록** 비례 확대/축소한다.
 *
 * 밝기를 지우고 **색 정체성만** 비교하기 위한 것이다. 배경 기준색의 밝기는 "어느 쪽을 기준으로
 * 잡을 것인가"라는 저작 판단(니플헤임은 설면=밝은 쪽을 골랐다)이 섞여 있어 그대로 비교하면
 * 정당한 선택이 위반으로 잡힌다. 반면 색 **방향**은 저작 판단이 아니라 자산의 사실이다.
 */
export function scaleToMean(c, mean) {
  const m = (c.r + c.g + c.b) / 3;
  if (m === 0) return { r: 0, g: 0, b: 0 };
  const k = mean / m;
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

/** 0xRRGGBB → `{r,g,b}`. */
export function unpackRgb(n) {
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG 로딩
// ─────────────────────────────────────────────────────────────────────────────

/** PNG → `{ w, h, rgba: Uint8Array }` (항상 RGBA 4채널로 정규화). */
export function loadRgba(path) {
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

// ─────────────────────────────────────────────────────────────────────────────
// 적 스프라이트 몸통색
// ─────────────────────────────────────────────────────────────────────────────

/** 행성 → 적 스프라이트 파일 목록. 카르곤만 접두 없이 저장돼 있다. */
export const ENEMY_SPRITE_FILES = {
  kargon: ['enemy_charger.png', 'enemy_mortar.png', 'enemy_lavaspring.png', 'enemy_support.png'],
  berdan: ['enemy_berdan_charger.png', 'enemy_berdan_gunner.png', 'enemy_berdan_special.png', 'enemy_berdan_support.png'],
  niflheim: ['enemy_niflheim_charger.png', 'enemy_niflheim_gunner.png', 'enemy_niflheim_special.png', 'enemy_niflheim_support.png'],
  arke: ['enemy_arke_charger.png', 'enemy_arke_gunner.png', 'enemy_arke_special.png', 'enemy_arke_support.png'],
  toxar: ['enemy_toxar_charger.png', 'enemy_toxar_gunner.png', 'enemy_toxar_special.png', 'enemy_toxar_support.png'],
  kras: ['enemy_kras_charger.png', 'enemy_kras_gunner.png', 'enemy_kras_special.png', 'enemy_kras_support.png'],
};

/** 외곽선을 배제하는 하한. 이 두 줄이 위장 지표의 전부다(없으면 97.6% 같은 허수가 나온다). */
export const BODY_MIN_LUMA = 60;
export const BODY_MIN_SAT = 0.25;

/**
 * 적 스프라이트 **한 장**의 몸통 대표색 1개. 자산이 없으면 `null`.
 *
 * 휘도·채도 하한을 통과한 픽셀만 32단계 양자화 격자에 넣고 최빈 1색의 평균을 쓴다.
 * 하한의 근거는 파일 머리 주석 참조.
 */
export function enemyBodyColor(file) {
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
 * 행성 하나의 적 대표색 전부. **적별 색을 하나로 합치지 않는다** — 4종 × 상위 색을 OR 로 묶으면
 * 값이 구조적으로 부풀고(실측 24%), 무엇보다 "어느 적이 안 보이는가"라는 실제로 고쳐야 할
 * 정보가 사라진다.
 */
export function enemyBodyColors(planet) {
  const files = ENEMY_SPRITE_FILES[planet];
  if (files === undefined) {
    throw new Error(`unknown planet: ${planet} (${Object.keys(ENEMY_SPRITE_FILES).join('|')})`);
  }
  return files.map(enemyBodyColor).filter((c) => c !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Wang 타일셋 대표색
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 타일셋 하나의 **Wang key 별 평균색 16개**.
 *
 * key 는 `src/render/autotile.ts` 의 `cornerKey` 와 같은 비트 배치다(upper=1, NW≪3·NE≪2·SE≪1·SW).
 * 여기서 화면 색을 바로 내지 않고 key 별로 내는 이유는, "화면이 무슨 색인가"가 **어느 key 가
 * 얼마나 깔리는가**에 달려 있고 그 배분은 자산이 아니라 프로덕션 지형 필드(`upperAt`)가
 * 정하기 때문이다. 자산 쪽 사실만 여기서 내고 배분은 호출부(테스트)가 프로덕션 함수로 구한다.
 *
 * 같은 key 를 여러 타일이 선언하면(변형) 먼저 나온 것을 쓴다 — 로더도 그렇다.
 */
export function wangTileMeans(tileset) {
  const pngPath = join(ROOT, 'assets', 'tilesets', `${tileset}.png`);
  const jsonPath = join(ROOT, 'assets', 'tilesets', `${tileset}.json`);
  if (!existsSync(pngPath) || !existsSync(jsonPath)) return null;
  const meta = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const tiles = meta?.tileset_data?.tiles;
  if (!Array.isArray(tiles)) return null;
  const img = loadRgba(pngPath);
  const byKey = new Array(16).fill(null);
  const enc = (c) => (c === 'upper' ? 1 : 0);
  for (const t of tiles) {
    const c = t?.corners, bb = t?.bounding_box;
    if (c === undefined || bb === undefined) continue;
    const key = (enc(c.NW) << 3) | (enc(c.NE) << 2) | (enc(c.SE) << 1) | enc(c.SW);
    if (byKey[key] !== null) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = bb.y; y < bb.y + bb.height; y++) {
      for (let x = bb.x; x < bb.x + bb.width; x++) {
        const i = (y * img.w + x) * 4;
        if (img.rgba[i + 3] < 200) continue;
        r += img.rgba[i]; g += img.rgba[i + 1]; b += img.rgba[i + 2]; n++;
      }
    }
    if (n === 0) continue;
    byKey[key] = { r: r / n, g: g / n, b: b / n };
  }
  return byKey;
}
