/**
 * 테마 선언값 ↔ **실제 자산 픽셀** 합치 잠금.
 *
 * ## 왜 이 파일이 생겼나 — 서로 모르는 세 레인이 같은 구멍을 짚었다
 * 행성 6종을 병렬 레인으로 만들면서 각 레인이 뮤테이션 검증(값을 일부러 깨고 테스트가
 * 빨개지는지 확인)을 했는데, **세 레인이 독립적으로 같은 두 종류의 구멍을 보고했다.**
 * 둘 다 "테마가 선언한 숫자가 그 행성의 실제 그림과 맞는지 아무도 안 본다"는 하나의 병이다.
 *
 * 1. **`atmosphere.referenceBackdrop` 이 실제 지형과 맞는지 아무도 안 본다.**
 *    `validateAtmosphereTheme` 은 "입자 틴트가 *선언된* 배경과 `fieldDeltaRgbSum > 100` 만큼
 *    다른가"만 본다. 선언된 배경이 그 행성의 실제 화면인지는 검사 대상이 아니다. 니플헤임
 *    레인이 `referenceBackdrop` 을 카르곤 암반 `0x2a2422` 로 되돌리고도 **전 테스트 그린**을
 *    확인했고, 크라스 레인이 같은 뮤테이션으로 같은 결과를 독립 확인했다. 이게 위험한 이유는
 *    카르곤 1차 실패가 정확히 "화산재 틴트가 배경과 채널차 6 이라 22개를 그리는데 화면에
 *    아무것도 안 보이던" 것이었기 때문이다 — 눈 행성에서 색만 뒤집혀 재현될 수 있다.
 *
 * 2. **안전 색상 창이 적 스프라이트 몸통색을 안 본다.**
 *    `computeSafeHueWindows(FOREGROUND_SIGNAL_COLORS, 10)` 의 위험색은 적탄 아웃라인 + 아군
 *    신호색뿐이다. 그런데 실제 위장을 만드는 것은 **적 몸통색**이고 그건 행성마다 다르다.
 *    톡사르 적 몸통(281.6°·283.1°)이 톡사르에 배정된 안전 골짜기(280.2~305.0°) 안에 있는데
 *    검증기는 통과시킨다. 톡사르·베르단 레인이 **사람이 눈치채서** 팔레트를 밀어 피했고,
 *    구조는 이걸 전혀 막지 않는다.
 *
 * ## 판정 척도를 고른 근거 (둘 다 실측으로 골랐다)
 *
 * ### ① 배경 기준색 — 밝기와 색을 **나눠서** 잰다
 * 그냥 ΔRGB 로 재면 니플헤임이 114 로 혼자 튄다. 결함이 아니라 **저작 판단**이다 —
 * 눈 행성의 입자는 희고, 흰 입자에게 가장 가혹한 배경은 어두운 현무암이 아니라 밝은 설면이라
 * 그쪽을 기준색으로 잡았다. 밝기는 그렇게 "어느 쪽을 기준으로 삼을 것인가"가 섞이지만,
 * **색 방향**은 저작 판단이 아니라 자산의 사실이다. 그래서
 *  - 색: 두 색을 같은 평균 밝기로 맞춘 뒤 ΔRGB (실측 2.1~10.8 → 상한 16)
 *  - 밝기: 지형 평균보다 어두우면 안 되고(가혹한 쪽 기준), 가장 밝은 지형 타일보다 밝을 수 없다
 * 두 축이 각각 다른 종류의 거짓말을 잡는다. 카르곤 암반 뮤테이션은 니플헤임에서 두 축 다
 * 걸리지만, 다른 행성에서는 밝기만 살아 있는 경우가 있어 둘을 합치면 안 된다.
 *
 * ### ② 적 몸통 분리 — **색상각이 아니라 ΔRGB** 다
 * 색상각으로 재면 **카르곤이 0.4° 로 즉시 탈락한다**(용암 `#e83a17` ↔ 돌격병 몸통 `#584541`).
 * 두 색은 색상환에서 겹치지만 명도·채도가 완전히 달라 화면에서 헷갈릴 수가 없다. 게다가
 * 아르케 지형은 채도 0.04~0.08 이라 색상각 자체가 의미가 없다(`hueOf` 는 무채색에 0 을 준다).
 * 실제 위장은 "같은 색조"가 아니라 "같은 픽셀값"이므로 ΔRGB 로 잰다.
 *
 * ## 이 테스트가 판정하지 않는 것
 * 화면 최종 색이 아니다. 팔레트 색은 알파·합성·티어 배율을 거쳐 화면에 도달하므로 여기서
 * 재는 것은 **저작 입력값끼리의 거리**다. 화면 실측은 `scripts/env-verify/analyze.mjs` 의
 * `camo`(ΔRGB<70 근접 비율)가 정본이고, 그쪽이 하네스 스크린샷을 받는다. 두 판정이 같은
 * 추출기(`scripts/env-verify/assetColor.mjs`)를 쓰는 것이 이 배치의 핵심이다 — 몸통색 하한이
 * 두 곳에 적히면 갈라진다(이 리포가 `UPPER_THRESHOLD` 0.5 vs 0.57 로 겪은 실패).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { ENV_THEMES } from '../src/render/env/themes/index.js';
import { terrainLightPalette } from '../src/render/env/contracts/terrainLight.js';
import { INVASION_TILESET, upperAt } from '../src/render/autotile.js';
import type { EnvTheme } from '../src/render/env/theme.js';
import {
  ENEMY_SPRITE_FILES,
  enemyBodyColors,
  relLuma,
  rgbDeltaSum,
  scaleToMean,
  unpackRgb,
  wangTileMeans,
  type Rgb,
} from '../scripts/env-verify/assetColor.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────────── 문턱값 (전부 실측에서 나왔다) ─────────────────────────────

/**
 * 선언 배경색과 실측 지형색의 **색 방향** 최대 차이(같은 평균 밝기로 맞춘 뒤의 ΔRGB).
 *
 * 실측(9테마): toxar 2.1 · invasion_l2 2.5 · kras 2.7 · invasion_l1 2.8 · arke 5.4 ·
 * invasion_l3 5.8 · berdan 7.8 · niflheim 10.5 · kargon 10.8.
 * 16 은 가장 나쁜 현재값(10.8)에 약 1.5배 여유다. 카르곤 암반 뮤테이션은 니플헤임 37.4 ·
 * invasion_l1 24.8 · 베르단 18.1 로 걸린다. 어두운 암석 행성 넷(kargon/arke/toxar/kras)끼리는
 * **실제로** 서로 3~8 밖에 안 떨어져 있어 이 축으로는 구분되지 않는다 — 구분할 수 없는 것을
 * 구분한다고 주장하는 문턱은 항진이므로 그렇게 잡지 않았다.
 */
const BACKDROP_CHROMA_MAX_DELTA = 16;

/**
 * 선언 배경색은 실측 지형 평균보다 **어두우면 안 된다**(약간의 여유 포함).
 *
 * 배경 기준색은 입자 대비를 재는 기준이고, 어두운 쪽으로 잡으면 실제보다 대비가 커 보여
 * "보이는데 안 보인다고 계산되는" 상태가 된다. 실측 비율: invasion_l2 1.059 · berdan 1.061 ·
 * invasion_l3 1.064 · invasion_l1 1.095 · kargon 1.132 · toxar 1.152 · kras 1.221 ·
 * arke 1.314 · niflheim 1.711 — 전부 1 이상이다.
 * 카르곤 암반을 니플헤임에 넣으면 0.698 로 떨어진다(그 뮤테이션이 **밝기 축에서만** 걸리는
 * 행성도 있으므로 색 축과 합치면 안 된다).
 */
const BACKDROP_MIN_LUMA_RATIO = 0.95;

/**
 * 선언 배경색은 **가장 밝은 Wang 타일보다 밝을 수 없다**(약간의 여유 포함).
 *
 * 상한이 없으면 "흰색을 배경으로 선언"이 무채색 행성(아르케)에서 색 검사도 밝기 하한도
 * 통과한다. 실측 비율(선언/최대 타일): arke 0.952 · kras 0.868 · niflheim 0.860 ·
 * toxar 0.831 · kargon 0.821 · invasion_l3 0.770 · invasion_l2 0.739 · berdan 0.717 ·
 * invasion_l1 0.704. 아르케가 가장 빡빡하다(무채색 행성이라 밝기 말고는 정체성이 없다).
 */
const BACKDROP_MAX_LUMA_RATIO = 1.05;

/**
 * 테마 팔레트 색과 그 행성 적 몸통색 사이 최소 ΔRGB.
 *
 * 실측 최솟값은 **35** — 니플헤임 서리 입자 틴트 `#c4d2ec` ↔ 얼음 거너 몸통 `#a8d1e6`
 * (같은 지점에 데칼 틴트 `#c8d4e6` 도 35). 그 다음이 카르곤 40(재 틴트 ↔ 돌격병),
 * 톡사르 64, 베르단 66, 아르케 73, 크라스 88 이다.
 *
 * 30 을 고른 근거는 두 가지다. ①화면 실측 판정기(`analyze.mjs camo`)가 "구분 불가"로 세는
 * 거리가 ΔRGB<70 인데, 팔레트 색은 알파를 거쳐 화면에 도달하므로 저작 입력값에 그대로 70 을
 * 요구하면 과하다. 그 절반이 35 이고, 그건 현재 최솟값과 정확히 같아 여유가 0 이다.
 * ②그래서 그 아래 첫 자리인 30 으로 둔다 — 지금 화면은 통과하고, 어떤 행성이든 팔레트를
 * **적 몸통 쪽으로 움직이면** 즉시 걸린다.
 *
 * ⚠️ 니플헤임 35 는 이 게임에서 가장 얇은 여유다. 그 행성의 팔레트를 손볼 때는 이 값을 먼저 봐라.
 */
const ENEMY_BODY_MIN_RGB_GAP = 30;

// ───────────────────────────── 실측 지형색 모델 ─────────────────────────────

/**
 * 행성 인덱스 → 타일셋 basename. **`autotile.ts` 소스에서 읽는다.**
 *
 * `PLANET_TILESET` 은 export 되지 않았고 이 레인은 그 파일을 소유하지 않는다. 그렇다고
 * 여기에 손으로 배열을 다시 적으면 그게 바로 이 파일이 잡으려는 병(복제된 진실)이다.
 * 소스 텍스트에서 뽑으면 이름이 바뀌는 순간 파싱이 실패해 테스트가 빨개진다.
 */
function planetTilesetNames(): string[] {
  const src = readFileSync(join(ROOT, 'src', 'render', 'autotile.ts'), 'utf8');
  const m = /const PLANET_TILESET = \[([^\]]*)\]/.exec(src);
  if (m === null) throw new Error('autotile.ts 에서 PLANET_TILESET 을 못 찾았다 — 이름이 바뀌었나?');
  return [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] ?? '');
}

const PLANET_TILESETS = planetTilesetNames();

/** 테마가 실제로 깔리는 타일셋 basename. 침공 테마는 페이즈 인덱스로 간다. */
function tilesetFor(t: EnvTheme): string | null {
  const planet = t.planets[0];
  if (planet === undefined) return null;
  if (planet < PLANET_TILESETS.length) return PLANET_TILESETS[planet] ?? null;
  const phase = planet - PLANET_TILESETS.length;
  return INVASION_TILESET[phase] ?? null;
}

/**
 * 재현 가능한 표본. 시드를 하나만 쓰면 그 시드의 지형 편중을 재게 되고, 늘려도 값이 거의
 * 움직이지 않으므로(4시드 × 3600셀 = 14,400표본) 이 정도면 충분하다.
 */
const SAMPLE_SEEDS = [1, 777, 12345, 90210];
const SAMPLE_SPAN = 60;

/**
 * **실측 지형색** — 프로덕션 지형 필드가 실제로 깔 타일들의 면적 가중 평균.
 *
 * 자산 쪽 사실(key 별 타일 평균색)은 `wangTileMeans` 가 내고, 그 key 가 화면에 얼마나
 * 깔리는지는 프로덕션 `upperAt` 이 정한다. 둘을 여기서 곱한다 — 어느 쪽도 이 파일이
 * 다시 구현하지 않는다는 것이 요점이다. 상수 하나(`UPPER_THRESHOLD`)만 바뀌어도 여기 값이
 * 따라 움직이므로, 지형 배분이 바뀌면 배경 기준색 판정이 자동으로 재평가된다.
 */
function measuredTerrainColor(tileset: string): { mean: Rgb; brightest: Rgb } {
  const byKey = wangTileMeans(tileset);
  if (byKey === null) throw new Error(`타일셋 자산을 못 읽었다: ${tileset}`);
  let r = 0, g = 0, b = 0, n = 0;
  let brightest: Rgb | null = null;
  for (const c of byKey) {
    if (c === null) continue;
    if (brightest === null || relLuma(c) > relLuma(brightest)) brightest = c;
  }
  if (brightest === null) throw new Error(`타일셋에 유효한 타일이 없다: ${tileset}`);
  for (const seed of SAMPLE_SEEDS) {
    for (let ty = 0; ty < SAMPLE_SPAN; ty++) {
      for (let tx = 0; tx < SAMPLE_SPAN; tx++) {
        const nw = upperAt(seed, tx, ty) ? 1 : 0;
        const ne = upperAt(seed, tx + 1, ty) ? 1 : 0;
        const sw = upperAt(seed, tx, ty + 1) ? 1 : 0;
        const se = upperAt(seed, tx + 1, ty + 1) ? 1 : 0;
        const c = byKey[(nw << 3) | (ne << 2) | (se << 1) | sw];
        if (c === undefined || c === null) throw new Error(`${tileset}: Wang key 구멍`);
        r += c.r; g += c.g; b += c.b; n++;
      }
    }
  }
  return { mean: { r: r / n, g: g / n, b: b / n }, brightest };
}

/** 테마가 화면에 얹는 색 전부(배경 팔레트). 하나라도 빠지면 그 색은 영영 검사받지 않는다. */
function backgroundPalette(t: EnvTheme): { tag: string; color: Rgb }[] {
  const out: { tag: string; color: Rgb }[] = [];
  for (const c of terrainLightPalette(t.terrainLight)) out.push({ tag: 'terrainLight', color: unpackRgb(c) });
  for (const f of t.atmosphere.fields) out.push({ tag: `atmosphere.${f.name}`, color: unpackRgb(f.tint) });
  for (const c of t.decals.tints) out.push({ tag: 'decals.tints', color: unpackRgb(c) });
  return out;
}

const hex = (c: Rgb): string =>
  `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** 타일셋 자산이 실제로 있는 테마만. (자산 없는 테마가 생기면 조용히 빠지지 않도록 개수를 잠근다.) */
const THEMES_WITH_TILESET = ENV_THEMES.filter((t) => {
  const name = tilesetFor(t);
  return name !== null && wangTileMeans(name) !== null;
});

// ─────────────────────────────────────────────────────────────────────────────
// ① referenceBackdrop ↔ 실제 타일셋
// ─────────────────────────────────────────────────────────────────────────────

describe('① 선언한 배경 기준색이 그 행성의 실제 지형과 맞는다', () => {
  it('검사 대상이 비어 있지 않다(항진 방지)', () => {
    // 타일셋 파싱이 조용히 실패하면 아래 it.each 가 0건이 되어 전부 "통과"한다.
    expect(PLANET_TILESETS.length).toBe(6);
    expect(THEMES_WITH_TILESET.length).toBe(ENV_THEMES.length);
    expect(THEMES_WITH_TILESET.length).toBeGreaterThanOrEqual(9);
  });

  it.each(THEMES_WITH_TILESET.map((t) => [t.id, t] as const))(
    '%s: 선언 배경색의 **색 방향**이 실측 지형색과 일치한다',
    (_id, t) => {
      const terrain = measuredTerrainColor(tilesetFor(t)!).mean;
      const declared = t.atmosphere.referenceBackdrop;
      const mean = (terrain.r + terrain.g + terrain.b) / 3;
      const delta = rgbDeltaSum(scaleToMean(declared, mean), terrain);
      expect(
        delta,
        `${t.id}: 선언 ${hex(declared)} 의 색 방향이 실측 지형 ${hex(terrain)} 과 ${delta.toFixed(
          1,
        )} 만큼 다르다(상한 ${BACKDROP_CHROMA_MAX_DELTA}). 다른 행성 값을 복사해 왔는지 확인해라.`,
      ).toBeLessThanOrEqual(BACKDROP_CHROMA_MAX_DELTA);
    },
  );

  it.each(THEMES_WITH_TILESET.map((t) => [t.id, t] as const))(
    '%s: 선언 배경색이 실측 지형 평균보다 어둡지 않다',
    (_id, t) => {
      const terrain = measuredTerrainColor(tilesetFor(t)!).mean;
      const declared = t.atmosphere.referenceBackdrop;
      const ratio = relLuma(declared) / relLuma(terrain);
      expect(
        ratio,
        `${t.id}: 선언 ${hex(declared)} 의 휘도가 실측 지형 ${hex(terrain)} 의 ${ratio.toFixed(
          3,
        )} 배다(하한 ${BACKDROP_MIN_LUMA_RATIO}). 기준색이 실제보다 어두우면 입자 대비가 과대평가된다.`,
      ).toBeGreaterThanOrEqual(BACKDROP_MIN_LUMA_RATIO);
    },
  );

  it.each(THEMES_WITH_TILESET.map((t) => [t.id, t] as const))(
    '%s: 선언 배경색이 가장 밝은 지형 타일보다 밝지 않다',
    (_id, t) => {
      const { brightest } = measuredTerrainColor(tilesetFor(t)!);
      const declared = t.atmosphere.referenceBackdrop;
      const ratio = relLuma(declared) / relLuma(brightest);
      expect(
        ratio,
        `${t.id}: 선언 ${hex(declared)} 이 가장 밝은 타일 ${hex(brightest)} 의 ${ratio.toFixed(
          3,
        )} 배다(상한 ${BACKDROP_MAX_LUMA_RATIO}). 화면에 존재하지 않는 밝기를 기준으로 삼고 있다.`,
      ).toBeLessThanOrEqual(BACKDROP_MAX_LUMA_RATIO);
    },
  );

  it('척도가 항진이 아니다 — 카르곤 암반을 눈 행성에 넣으면 걸린다', () => {
    // 세 레인이 보고한 뮤테이션 그 자체를 여기서 한 번 더 실행한다. 위 it.each 들이
    // "어떤 값이든 통과"하는 상태가 되면 이 검사가 먼저 빨개진다.
    const nifl = ENV_THEMES.find((t) => t.id === 'niflheim');
    expect(nifl).toBeDefined();
    const { mean } = measuredTerrainColor(tilesetFor(nifl!)!);
    const rock = { r: 0x2a, g: 0x24, b: 0x22 };
    const avg = (mean.r + mean.g + mean.b) / 3;
    expect(rgbDeltaSum(scaleToMean(rock, avg), mean)).toBeGreaterThan(BACKDROP_CHROMA_MAX_DELTA);
    expect(relLuma(rock) / relLuma(mean)).toBeLessThan(BACKDROP_MIN_LUMA_RATIO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 테마 팔레트 ↔ 그 행성 적 몸통색
// ─────────────────────────────────────────────────────────────────────────────

const THEMES_WITH_ENEMIES = ENV_THEMES.filter((t) => ENEMY_SPRITE_FILES[t.id] !== undefined);

describe('② 테마 팔레트가 그 행성 적 몸통색과 떨어져 있다', () => {
  it('검사 대상이 비어 있지 않다(항진 방지)', () => {
    expect(THEMES_WITH_ENEMIES.map((t) => t.id)).toEqual([
      'kargon', 'berdan', 'niflheim', 'arke', 'toxar', 'kras',
    ]);
    for (const t of THEMES_WITH_ENEMIES) {
      // 몸통색 추출 하한이 너무 높아 색이 0개면 아래 검사가 조용히 통과한다.
      expect(enemyBodyColors(t.id).length, `${t.id}: 적 몸통색을 못 뽑았다`).toBe(4);
      expect(backgroundPalette(t).length, `${t.id}: 팔레트가 비었다`).toBeGreaterThanOrEqual(13);
    }
  });

  it.each(THEMES_WITH_ENEMIES.map((t) => [t.id, t] as const))(
    '%s: 모든 팔레트 색이 모든 적 몸통색에서 ΔRGB 로 떨어져 있다',
    (_id, t) => {
      const bodies = enemyBodyColors(t.id);
      let worst = { d: Number.POSITIVE_INFINITY, pal: '', body: '' };
      for (const p of backgroundPalette(t)) {
        for (const b of bodies) {
          const d = rgbDeltaSum(p.color, b);
          if (d < worst.d) worst = { d, pal: `${p.tag} ${hex(p.color)}`, body: `${b.file} ${hex(b)}` };
        }
      }
      expect(
        worst.d,
        `${t.id}: 배경색 [${worst.pal}] 이 적 [${worst.body}] 에서 ΔRGB ${worst.d.toFixed(
          0,
        )} 밖에 안 떨어졌다(하한 ${ENEMY_BODY_MIN_RGB_GAP}). 적이 배경에 묻힌다.`,
      ).toBeGreaterThan(ENEMY_BODY_MIN_RGB_GAP);
    },
  );

  it('척도가 항진이 아니다 — 적 몸통색을 팔레트에 그대로 넣으면 걸린다', () => {
    const toxar = ENV_THEMES.find((t) => t.id === 'toxar');
    expect(toxar).toBeDefined();
    const bodies = enemyBodyColors('toxar');
    expect(bodies.length).toBeGreaterThan(0);
    const body = bodies[0]!;
    // "몸통색 근처"(각 채널 ±8)를 팔레트에 넣으면 반드시 하한 아래여야 한다.
    const near = { r: body.r + 8, g: body.g - 8, b: body.b + 8 };
    expect(rgbDeltaSum(near, body)).toBeLessThanOrEqual(ENEMY_BODY_MIN_RGB_GAP);
  });
});
