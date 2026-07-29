/**
 * 카르곤 지형 데칼 — 결정론·월드 고정·밀도·격자 비공명·화면 세기 + **3차 품질 불변식**.
 *
 * 이 레이어의 결함은 "틀려도 안 터지는" 종류다(배경은 해시에 안 들어간다). 그래서 눈으로
 * 보이는 것보다 먼저 **성질**을 테스트로 못 박는다.
 *
 * ## 세대별로 무엇이 새 불변식이 됐는가
 * - **1차**는 배치 성질(①~⑤)을 전부 통과하고도 화면에 안 보였다 → 2차가 `estimateScreenInk`
 *   하한을 잠갔다("보이는가"는 "올바른가"와 별개의 질문이다).
 * - **2차**는 세기를 8배로 올리고도 **품질로 기각**됐다. 기각 사유 셋과, 각각을 잡는 새 불변식:
 *
 *   | 기각 사유 | 근인 | 새 불변식 |
 *   |---|---|---|
 *   | 어두운 지형 위에서 데칼이 **밝게 뜬다** | 알파 블렌드 + 바닥보다 밝은 fill | `합성 모드` 절 — 배경 스윕으로 "절대 안 밝아짐" 증명 |
 *   | 데칼 픽셀 해상도가 지형과 **다르다** | design 좌표 직접 렌더 + 임의 배율·임의 각도 | `픽셀 격자` 절 — 스냅·정수 배율·런타임 회전 0 |
 *   | 형태가 **사실상 1종** | 큰 데칼 넷이 전부 부드러운 타원 | `실루엣 다양성` 절 — 실루엣 축 3종 이상 실사용 |
 *
 * ## 항진 방지 규율
 * "밝아지지 않는다" 같은 단언은 **아무것도 안 재도 통과할 수 있다**(예: 모든 알파가 0이면
 * 자명하게 참). 그래서 각 불변식마다 **같은 함수로 위반 사례를 하나 만들어** 테스트가 실제로
 * 판별력을 갖는지 보인다(`normal` 블렌드는 밝아진다 / 알파를 0으로 죽이면 잉크가 0이 된다).
 */

import { describe, it, expect } from 'vitest';
import { Graphics, Sprite, Texture } from 'pixi.js';
import { DISPLAY_TILE, UPPER_THRESHOLD, terrainFieldAt, upperAt } from '../src/render/autotile.js';
import {
  MACRO_GRID,
  MICRO_GRID,
  STAIN_GRID,
  RELIEF_GRID,
  RELIEF_VARIANT_SPEC,
  RELIEF_SILHOUETTES,
  RELIEF_MIN_SPAN,
  RELIEF_MAX_SPAN,
  RELIEF_FIELD_MARGIN,
  GLOW,
  LIGHT_ANGLE,
  LIGHT_X,
  LIGHT_Y,
  HIGHLIGHT_BLEND,
  MAX_HIGHLIGHT_ALPHA,
  MAX_ADDITIVE_LUMA_GAIN,
  ADDITIVE_INK_BUDGET,
  BAKE_FRAME_COLOR,
  DARK_FLOOR_LUMA_SUM,
  isRelief,
  variantSpecFor,
  ScatterGrid,
  type DecalTextures,
  reliefSiteIsDark,
  reliefFootprintRadius,
  reliefCount,
  estimateHighlightInk,
  estimateReliefShadowInk,
  drawHighlightInto,
  applyHighlight,
  compositeChannel,
  VARIANTS,
  VARIANT_SPEC,
  ORIENTATIONS,
  ALL_KINDS,
  FILL,
  KIND_SHAPE,
  MAX_DECAL_ALPHA,
  MIN_MULTIPLIER_CHANNEL,
  MAX_MULTIPLIER_CHANNEL,
  FLOOR_LUMA_SUM,
  TERRAIN_PIXEL,
  SOURCE_TILE_PX,
  BAKE_RESOLUTION,
  SCALABLE_SILHOUETTE,
  DECAL_BLEND,
  snapPx,
  decalAt,
  emptyPlacement,
  orientationClass,
  applyPlacement,
  drawDecalInto,
  densityForTier,
  estimateScreenInk,
  compositeLumaSum,
  darkening,
  lumaSum,
  KargonDecalLayer,
  type DecalKind,
  type DecalPlacement,
  type GridSpec,
  type Silhouette,
} from '../src/render/env/kargonDecals.js';

/**
 * **잔·중·대 산포 격자 셋.** 통계적 단언(방향 12계급 균등 · 모양 조합 수 · 알파 대역 훑기)은
 * 여기만 쓴다 — 4차의 부조 격자는 표본이 화면당 몇 개뿐이고 지형 게이트가 걸려 있어서
 * 같은 잣대를 대면 **거짓 실패**가 난다(그리고 그 잣대를 통과시키려면 밀도를 올려야 하는데,
 * 그게 정확히 비평가가 기각한 "균질한 시각 밀도"다).
 */
const GRIDS: readonly [string, GridSpec][] = [
  ['macro', MACRO_GRID],
  ['micro', MICRO_GRID],
  ['stain', STAIN_GRID],
];

/**
 * **레이어가 실제로 돌리는 격자 전부.** 커버리지성 단언(모든 종류가 쓰이는가 · 셀 크기가
 * 서로소인가 · 소금이 다른가)은 반드시 이쪽을 써야 한다. 부조 격자를 빼면 "선언만 하고
 * 배치하지 않는 종류"가 조용히 생긴다 — 이 리포가 여덟 번 겪은 결함 유형이다.
 */
const ALL_GRIDS: readonly [string, GridSpec][] = [...GRIDS, ['relief', RELIEF_GRID]];

/** 배치를 비교 가능한 문자열로 (부동소수 그대로 비교하면 의미가 흐려진다). */
function sig(p: DecalPlacement): string {
  return [
    p.present ? 1 : 0,
    p.kind,
    p.variant,
    p.worldX.toFixed(4),
    p.worldY.toFixed(4),
    p.rotation.toFixed(6),
    p.scale.toFixed(6),
    p.alpha.toFixed(6),
    p.tint,
    p.flip ? 1 : 0,
  ].join('|');
}

/** 모양 속성만(위치 제외) — 다양성 측정용. */
function look(p: DecalPlacement): string {
  return [p.kind, p.variant, p.scale, p.tint, p.flip ? 1 : 0].join('|');
}

/** 격자가 실제로 뽑을 수 있는 종류 집합(후보 배열은 가중치 때문에 중복을 담는다). */
function kindSet(spec: GridSpec): Set<DecalKind> {
  return new Set(spec.kinds);
}

describe('데칼 결정론', () => {
  it.each(GRIDS)('%s: 같은 (시드, 셀) 은 항상 같은 데칼', (_name, spec) => {
    for (let i = 0; i < 200; i++) {
      const cx = ((i * 37) % 91) - 45;
      const cy = ((i * 53) % 77) - 38;
      const a = decalAt(spec, 12345, cx, cy);
      const b = decalAt(spec, 12345, cx, cy);
      expect(sig(b)).toBe(sig(a));
    }
  });

  it.each(GRIDS)('%s: 시드가 다르면 배치도 달라진다', (_name, spec) => {
    // 두 시드 모두에서 "빈 셀"인 칸은 서명이 같을 수밖에 없다(빈 셀은 모양 속성이 없다).
    let candidates = 0;
    let differing = 0;
    for (let cx = 0; cx < 25; cx++) {
      for (let cy = 0; cy < 25; cy++) {
        const a = decalAt(spec, 1, cx, cy);
        const b = decalAt(spec, 2, cx, cy);
        if (!a.present && !b.present) continue;
        candidates++;
        if (sig(a) !== sig(b)) differing++;
      }
    }
    expect(candidates).toBeGreaterThan(200);
    expect(differing).toBe(candidates);
  });

  it.each(GRIDS)('%s: 모양 속성이 실제로 흩어진다 (항진 방지)', (_name, spec) => {
    // 3차에서 배율·회전이 **이산화**됐다(정수 배율 · 변형에 구운 각도). 그래서 2차처럼
    // "거의 모든 셀이 유일한 조합"을 요구하면 거짓 실패가 난다 — 조합 공간이 유한하기 때문이다.
    // 대신 ①조합이 충분히 많고 ②각 축이 상수가 아님을 본다. 어느 한 축을 상수로 바꾸면 죽는다.
    const seen = new Set<string>();
    const kinds = new Set<DecalKind>();
    const variants = new Set<number>();
    const tints = new Set<number>();
    const flips = new Set<boolean>();
    let present = 0;
    for (let cx = 0; cx < 40; cx++) {
      for (let cy = 0; cy < 40; cy++) {
        const p = decalAt(spec, 777, cx, cy);
        if (!p.present) continue;
        present++;
        seen.add(look(p));
        kinds.add(p.kind);
        variants.add(p.variant);
        tints.add(p.tint);
        flips.add(p.flip);
      }
    }
    expect(present).toBeGreaterThan(500);
    expect(seen.size).toBeGreaterThanOrEqual(kindSet(spec).size * VARIANTS * 2);
    expect(kinds.size).toBe(kindSet(spec).size);
    expect(variants.size).toBe(VARIANTS);
    expect(tints.size).toBeGreaterThan(1);
    expect(flips.size).toBe(2);
  });

  it.each(GRIDS)('%s: 종류·변형·대역이 사양 안이고 모든 종류가 실제로 등장한다', (_name, spec) => {
    const kinds = new Set<string>();
    for (let cx = 0; cx < 60; cx++) {
      for (let cy = 0; cy < 60; cy++) {
        const p = decalAt(spec, 4242, cx, cy);
        if (!p.present) continue;
        expect(spec.kinds).toContain(p.kind);
        expect(p.variant).toBeGreaterThanOrEqual(0);
        expect(p.variant).toBeLessThan(VARIANTS);
        expect(p.scale).toBeGreaterThanOrEqual(spec.minScale);
        expect(p.scale).toBeLessThanOrEqual(spec.maxScale);
        expect(p.alpha).toBeGreaterThanOrEqual(spec.minAlpha);
        expect(p.alpha).toBeLessThanOrEqual(spec.maxAlpha);
        kinds.add(p.kind);
      }
    }
    expect(kinds.size).toBe(kindSet(spec).size);
  });

  it.each(GRIDS)('%s: 데칼이 자기 셀 안에 머문다(격자 간 자리 침범 없음)', (_name, spec) => {
    for (let cx = -5; cx < 5; cx++) {
      for (let cy = -5; cy < 5; cy++) {
        const p = decalAt(spec, 99, cx, cy);
        if (!p.present) continue;
        // 스냅 때문에 최대 반 픽셀 밀릴 수 있다 → 셀 경계에 TERRAIN_PIXEL 여유를 준다.
        expect(p.worldX).toBeGreaterThanOrEqual(cx * spec.cell - TERRAIN_PIXEL);
        expect(p.worldX).toBeLessThanOrEqual((cx + 1) * spec.cell + TERRAIN_PIXEL);
        expect(p.worldY).toBeGreaterThanOrEqual(cy * spec.cell - TERRAIN_PIXEL);
        expect(p.worldY).toBeLessThanOrEqual((cy + 1) * spec.cell + TERRAIN_PIXEL);
      }
    }
  });

  it('데칼 알파 상한 불변식(물체로 읽힐 만큼 진해지지 않는다)', () => {
    for (const [, spec] of GRIDS) {
      expect(spec.maxAlpha).toBeLessThanOrEqual(MAX_DECAL_ALPHA);
      expect(spec.minAlpha).toBeLessThan(spec.maxAlpha); // 대역이 실제로 열려 있다
      expect(spec.minAlpha).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3차 기각 사유 ① — "어두운 지형 위에서 밝게 뜬다"
// ─────────────────────────────────────────────────────────────────────────────

describe('합성 모드 — 데칼은 바닥보다 밝아질 수 없다', () => {
  /**
   * 카르곤 화면에 실제로 존재하는 배경들. **어두운 현무암이 핵심 반례 자리**다 —
   * 2차의 `ash`(합 224)·`stainWarm`(합 208)은 여기서 바닥보다 두 배 밝아 갈색 얼룩으로 떴다.
   */
  const BACKDROPS: readonly (readonly [string, [number, number, number]])[] = [
    ['현무암 암부', [24, 26, 38]],
    ['현무암 중간', [46, 44, 52]],
    ['그늘진 지형', [58, 50, 42]],
    ['용암 주황', [214, 110, 40]],
    ['용암 밝은 심', [252, 186, 92]],
    ['순흑', [0, 0, 0]],
    ['순백', [255, 255, 255]],
  ];

  const TINT_SWEEP = [0xffffff, 0xf0e4d8, 0xdcd0c4, 0xd8dce4, 0xf4d8c0, 0xcfc8c2];

  it('어떤 배경·종류·알파·틴트 조합에서도 합성 결과가 배경보다 밝지 않다', () => {
    let checked = 0;
    for (const [bname, bg] of BACKDROPS) {
      const base = bg[0] + bg[1] + bg[2];
      for (const kind of ALL_KINDS) {
        const fill = KIND_SHAPE[kind].fill;
        for (let a = 0; a <= MAX_DECAL_ALPHA + 1e-9; a += 0.05) {
          for (const tint of TINT_SWEEP) {
            const out = compositeLumaSum(bg, fill, a, tint);
            expect(out, `${bname} × ${kind} × α=${a.toFixed(2)}`).toBeLessThanOrEqual(base + 1e-9);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(4000); // 스윕이 실제로 돌았다
  });

  it('접지 테두리 색을 포함한 팔레트 전체가 같은 성질을 만족한다', () => {
    for (const [, bg] of BACKDROPS) {
      const base = bg[0] + bg[1] + bg[2];
      for (const [name, fill] of Object.entries(FILL)) {
        for (let a = 0; a <= 1; a += 0.1) {
          expect(compositeLumaSum(bg, fill, a, 0xffffff), name).toBeLessThanOrEqual(base + 1e-9);
        }
      }
    }
  });

  it('**항진이 아니다** — 알파 블렌드로 되돌리면 어두운 지형에서 실제로 밝아진다', () => {
    // 위 스윕이 "무엇을 재든 통과"하는 항진이 아님을 같은 함수로 보인다. 2차의 결함 경로를
    // 그대로 재현: 어두운 현무암 위 `ash` 를 normal 블렌드로 합성하면 배경보다 밝아진다.
    const dark: [number, number, number] = [24, 26, 38];
    const base = dark[0] + dark[1] + dark[2];
    const asNormal = compositeLumaSum(dark, FILL.ash, 0.4, 0xffffff, 'normal');
    expect(asNormal).toBeGreaterThan(base * 1.5);
    const asMultiply = compositeLumaSum(dark, FILL.ash, 0.4, 0xffffff, 'multiply');
    expect(asMultiply).toBeLessThan(base);
  });

  it('레이어가 실제로 곱연산으로 스프라이트를 합성한다(문서가 아니라 코드에서)', () => {
    expect(DECAL_BLEND).toBe('multiply');
    const sprite = new Sprite();
    const p = decalAt(MACRO_GRID, 7, 3, 5);
    p.present = true;
    applyPlacement(sprite, p, Texture.EMPTY);
    expect(sprite.blendMode).toBe('multiply');
  });

  it('배수 팔레트가 상·하한 안이다 (검은 구멍 금지 · 안 보이는 데칼 금지)', () => {
    for (const [name, color] of Object.entries(FILL)) {
      const ch = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
      const hex = `${name}=#${color.toString(16).padStart(6, '0')}`;
      expect(Math.min(...ch), `${hex} 가 너무 진하다(검은 구멍)`).toBeGreaterThanOrEqual(
        MIN_MULTIPLIER_CHANNEL,
      );
      expect(Math.max(...ch), `${hex} 가 너무 옅다(보이지 않는다)`).toBeLessThanOrEqual(
        MAX_MULTIPLIER_CHANNEL,
      );
    }
  });

  it('배수 팔레트가 저채도다(색 필터가 아니라 명도 변조로 읽힌다)', () => {
    for (const [name, color] of Object.entries(FILL)) {
      const r = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const b = color & 0xff;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      expect(chroma, `${name} 크로마 ${chroma}`).toBeLessThanOrEqual(60);
    }
  });

  it('접지 테두리가 팔레트에서 가장 진하다(가장자리가 안쪽보다 어두워야 패여 보인다)', () => {
    const rim = darkening(FILL.ground);
    for (const [name, color] of Object.entries(FILL)) {
      if (name === 'ground' || name === 'crack') continue;
      expect(darkening(color), `${name} 이 접지 테두리보다 진하다`).toBeLessThan(rim);
    }
    // 균열 코어만 예외 — 균열은 테두리가 아니라 그 자체가 가장 깊은 홈이다.
    expect(darkening(FILL.crack)).toBeGreaterThan(rim);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3차 기각 사유 ② — "데칼 픽셀 해상도가 지형과 다르다"
// ─────────────────────────────────────────────────────────────────────────────

describe('픽셀 격자 통일', () => {
  it('지형 픽셀이 autotile 에서 **파생**된다(하드코딩 아님)', () => {
    // 타일셋 레인이 DISPLAY_TILE 을 바꿔도 자동으로 따라와야 한다.
    expect(TERRAIN_PIXEL).toBe(DISPLAY_TILE / SOURCE_TILE_PX);
    expect(TERRAIN_PIXEL).toBeGreaterThan(0);
    expect(BAKE_RESOLUTION).toBe(1 / TERRAIN_PIXEL);
  });

  it('스냅 함수가 지형 픽셀 격자의 정수배만 낸다', () => {
    for (let i = -500; i <= 500; i++) {
      const v = i * 0.37;
      const q = snapPx(v);
      expect(Math.abs(q / TERRAIN_PIXEL - Math.round(q / TERRAIN_PIXEL))).toBeLessThan(1e-9);
      expect(Math.abs(q - v)).toBeLessThanOrEqual(TERRAIN_PIXEL / 2 + 1e-9);
    }
  });

  it.each(GRIDS)('%s: 데칼 위치가 지형 픽셀 격자에 스냅돼 있다', (_name, spec) => {
    let n = 0;
    for (let cx = -20; cx < 20; cx++) {
      for (let cy = -20; cy < 20; cy++) {
        const p = decalAt(spec, 2468, cx, cy);
        if (!p.present) continue;
        n++;
        // `Math.abs` — 음수 좌표의 나머지는 -0 이 되어 `toBe(0)` 이 Object.is 로 걸린다.
        expect(Math.abs(p.worldX % TERRAIN_PIXEL)).toBe(0);
        expect(Math.abs(p.worldY % TERRAIN_PIXEL)).toBe(0);
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it.each(GRIDS)('%s: 배율 대역이 정수다 (텍셀이 지형 픽셀의 정수배로 유지된다)', (_name, spec) => {
    expect(Number.isInteger(spec.minScale)).toBe(true);
    expect(Number.isInteger(spec.maxScale)).toBe(true);
    expect(spec.minScale).toBeGreaterThanOrEqual(1);
    expect(spec.maxScale).toBeGreaterThanOrEqual(spec.minScale);
    for (let cx = 0; cx < 30; cx++) {
      for (let cy = 0; cy < 30; cy++) {
        const p = decalAt(spec, 13, cx, cy);
        if (!p.present) continue;
        expect(Number.isInteger(p.scale)).toBe(true);
      }
    }
  });

  it('경계가 또렷한 실루엣은 배율 1만 쓴다 (지형과 정확히 같은 블록 크기)', () => {
    // haze 만 예외다 — 감쇠 얼룩은 경계가 없어 텍셀 크기 차이가 드러나지 않는다.
    // 이 규율이 없으면 균열·자갈이 지형보다 두 배 굵은 계단으로 그려진다.
    let hard = 0;
    for (const [name, spec] of GRIDS) {
      for (const kind of kindSet(spec)) {
        if (KIND_SHAPE[kind].silhouette === SCALABLE_SILHOUETTE) continue;
        hard++;
        expect(spec.maxScale, `${name}/${kind} 이 배율 ${spec.maxScale} 로 그려진다`).toBe(1);
      }
    }
    expect(hard).toBeGreaterThan(3); // 규율이 실제로 적용되는 종류가 있다
  });

  it('스프라이트를 런타임에 회전시키지 않는다 (임의 각도 회전은 픽셀 격자를 무너뜨린다)', () => {
    const sprite = new Sprite();
    sprite.rotation = 1.234; // 오염시켜 두고 적용이 실제로 0으로 되돌리는지 본다
    const p = decalAt(MICRO_GRID, 55, 2, 2);
    p.present = true;
    expect(p.rotation).toBeGreaterThanOrEqual(0); // 각도는 파생 정보로 남아 있다
    applyPlacement(sprite, p, Texture.EMPTY);
    expect(sprite.rotation).toBe(0);
    expect(Number.isInteger(Math.abs(sprite.scale.x))).toBe(true);
    expect(Number.isInteger(sprite.scale.y)).toBe(true);
    expect(Math.abs(sprite.position.x % TERRAIN_PIXEL)).toBe(0);
    expect(Math.abs(sprite.position.y % TERRAIN_PIXEL)).toBe(0);
  });

  it('데칼 셀 크기가 타일 크기의 배수가 아니고 서로소다', () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    for (const [, spec] of ALL_GRIDS) {
      expect(spec.cell % DISPLAY_TILE).not.toBe(0);
      expect(gcd(spec.cell, DISPLAY_TILE)).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3차 기각 사유 ③ — "형태가 사실상 1종" / "전부 같은 방향으로 기울어져 있다"
// ─────────────────────────────────────────────────────────────────────────────

describe('실루엣 다양성', () => {
  it('실제로 화면에 나오는 실루엣이 3종 이상이다', () => {
    const used = new Set<Silhouette>();
    for (const [, spec] of GRIDS) {
      for (const kind of kindSet(spec)) used.add(KIND_SHAPE[kind].silhouette);
    }
    expect(used.size).toBeGreaterThanOrEqual(3);
  });

  it('선언된 실루엣이 전부 실제로 배치된다(사문화된 분기를 굽지 않는다)', () => {
    const declared = new Set<Silhouette>(ALL_KINDS.map((k) => KIND_SHAPE[k].silhouette));
    const placed = new Set<Silhouette>();
    for (const [, spec] of ALL_GRIDS) {
      for (let cx = 0; cx < 40; cx++) {
        for (let cy = 0; cy < 40; cy++) {
          const p = decalAt(spec, 31, cx, cy);
          if (p.present) placed.add(KIND_SHAPE[p.kind].silhouette);
        }
      }
    }
    expect([...placed].sort()).toEqual([...declared].sort());
  });

  it('큰 데칼 격자 안에서만도 실루엣이 3종 이상이다 (2차는 넷 다 타원이었다)', () => {
    const macro = new Set<Silhouette>([...kindSet(MACRO_GRID)].map((k) => KIND_SHAPE[k].silhouette));
    expect(macro.size).toBeGreaterThanOrEqual(3);
  });

  it('모든 종류가 어느 격자에선가 실제로 쓰인다(사문화된 텍스처를 굽지 않는다)', () => {
    const used = new Set<DecalKind>();
    for (const [, spec] of ALL_GRIDS) for (const k of spec.kinds) used.add(k);
    expect([...used].sort()).toEqual([...ALL_KINDS].sort());
  });

  it('모양 표가 모든 종류를 덮는다', () => {
    expect(Object.keys(KIND_SHAPE).sort()).toEqual([...ALL_KINDS].sort());
    for (const kind of ALL_KINDS) {
      const s = KIND_SHAPE[kind];
      expect(s.r).toBeGreaterThan(0);
      expect(s.elong).toBeGreaterThan(0);
      expect(s.coverage).toBeGreaterThan(0);
      expect(s.coverage).toBeLessThanOrEqual(1);
      expect(s.opacity).toBeGreaterThan(0);
      expect(s.opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('방향 분포 — "전부 같은 방향으로 기울어져 있다"의 회귀 방지선', () => {
  it('변형 각도가 서로 다르고 크기 배수가 2배 이상 벌어져 있다', () => {
    const angles = new Set(VARIANT_SPEC.map((v) => v.angle));
    expect(angles.size).toBe(VARIANTS);
    const sizes = VARIANT_SPEC.map((v) => v.sizeMul);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThanOrEqual(2);
    // 각도가 균등 간격이 아니다 — 균등하면 여러 데칼이 같은 계열로 정렬돼 보인다.
    const sorted = [...VARIANT_SPEC].map((v) => v.angle).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push((sorted[i] ?? 0) - (sorted[i - 1] ?? 0));
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.05);
  });

  it.each(GRIDS)('%s: 겉보기 방향 12계급이 고르게 나온다 (편중 금지)', (_name, spec) => {
    const counts = new Array<number>(ORIENTATIONS).fill(0);
    let total = 0;
    for (let cx = 0; cx < 60; cx++) {
      for (let cy = 0; cy < 60; cy++) {
        const p = decalAt(spec, 909, cx, cy);
        if (!p.present) continue;
        const cls = orientationClass(p);
        counts[cls] = (counts[cls] ?? 0) + 1;
        total++;
      }
    }
    expect(total).toBeGreaterThan(1000);
    expect(counts.filter((c) => c > 0).length).toBe(ORIENTATIONS);
    const fair = total / ORIENTATIONS;
    for (let i = 0; i < ORIENTATIONS; i++) {
      // 균등의 60%~160% 안. 어느 한 계급으로 몰리면(2차의 지각 결함) 죽는다.
      expect(counts[i] ?? 0, `계급 ${i}`).toBeGreaterThan(fair * 0.6);
      expect(counts[i] ?? 0, `계급 ${i}`).toBeLessThan(fair * 1.6);
    }
  });

  it('**항진이 아니다** — 방향을 상수로 고정한 표본은 같은 판정에서 죽는다', () => {
    const counts = new Array<number>(ORIENTATIONS).fill(0);
    const total = 1200;
    counts[0] = total; // 전부 같은 방향인 가상의 배치
    const fair = total / ORIENTATIONS;
    expect(counts.filter((c) => c > 0).length).not.toBe(ORIENTATIONS);
    expect(counts[1] ?? 0).toBeLessThan(fair * 0.6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 구운 기하 직접 검증 — 스크린샷 없이 "실제로 그려지는 것"을 읽는다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `Graphics.context.instructions` 는 캔버스·렌더러 없이도 채워진다. 이 절은 그 사실을 이용해
 * **텍스처에 실제로 구워지는 폴리곤·선**을 직접 읽는다. 배치 속성만 검사하면 놓치는 것들
 * (스냅이 그리기 코드에서 진짜로 일어나는가 · 접지 테두리가 본체 바깥에 있는가 · 회전이
 * 정말 기하에 들어갔는가)이 여기서만 잡힌다.
 */
interface Prim {
  readonly action: string;
  readonly color: number;
  readonly width: number | undefined;
  readonly points: readonly number[];
}

function primitives(kind: DecalKind, variant: number): Prim[] {
  const g = new Graphics();
  drawDecalInto(g, kind, variant);
  const out: Prim[] = [];
  for (const ins of g.context.instructions as unknown as {
    action: string;
    data?: {
      style?: { color?: number; width?: number };
      path?: { shapePath?: { shapePrimitives?: { shape?: { points?: number[] } }[] } };
    };
  }[]) {
    const style = ins.data?.style;
    for (const sp of ins.data?.path?.shapePath?.shapePrimitives ?? []) {
      out.push({
        action: ins.action,
        color: style?.color ?? 0,
        width: style?.width,
        points: sp.shape?.points ?? [],
      });
    }
  }
  return out;
}

function maxRadius(prims: readonly Prim[]): number {
  let m = 0;
  for (const p of prims) {
    for (let i = 0; i + 1 < p.points.length; i += 2) {
      m = Math.max(m, Math.hypot(p.points[i] ?? 0, p.points[i + 1] ?? 0));
    }
  }
  return m;
}

/** 꼭짓점 구름의 주축 각도(0~π). 회전이 기하에 실제로 들어갔는지 재는 지표. */
function principalAngle(prims: readonly Prim[]): number {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let n = 0;
  for (const p of prims) {
    for (let i = 0; i + 1 < p.points.length; i += 2) {
      const x = p.points[i] ?? 0;
      const y = p.points[i + 1] ?? 0;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      n++;
    }
  }
  if (n === 0) return 0;
  const a = 0.5 * Math.atan2((2 * sxy) / n, (sxx - syy) / n);
  return (a + Math.PI) % Math.PI;
}

describe('구운 기하 — 그리기 코드가 실제로 무엇을 만드는가', () => {
  it('모든 꼭짓점이 지형 픽셀 격자 위에 있다 (그리기 단계 스냅)', () => {
    // 배치 위치만 스냅하고 도형 내부를 스냅하지 않으면, 텍셀 경계를 가로지르는 모서리가
    // 반투명 프린지를 만들어 "다른 해상도의 부드러운 선"으로 읽힌다(3차 기각 사유 ②).
    let verts = 0;
    for (const kind of ALL_KINDS) {
      for (let v = 0; v < VARIANTS; v++) {
        for (const prim of primitives(kind, v)) {
          for (let i = 0; i < prim.points.length; i++) {
            const c = prim.points[i] ?? 0;
            expect(Math.abs(c % TERRAIN_PIXEL), `${kind}/v${v} 꼭짓점 ${c}`).toBe(0);
            verts++;
          }
        }
      }
    }
    expect(verts).toBeGreaterThan(5000);
  });

  it('선 굵기가 지형 픽셀의 정수배다 (1~2px 부드러운 선 금지)', () => {
    let strokes = 0;
    for (const kind of ALL_KINDS) {
      for (let v = 0; v < VARIANTS; v++) {
        for (const prim of primitives(kind, v)) {
          if (prim.action !== 'stroke') continue;
          strokes++;
          const w = prim.width ?? 0;
          expect(w, `${kind}/v${v} 굵기 ${w}`).toBeGreaterThanOrEqual(TERRAIN_PIXEL);
          expect(Math.abs((w % TERRAIN_PIXEL) - 0)).toBe(0);
        }
      }
    }
    expect(strokes).toBeGreaterThan(20); // 균열이 실제로 선으로 그려진다
  });

  it('경계가 또렷한 실루엣에 접지 테두리가 본체보다 **바깥**까지 그려진다', () => {
    // `GROUND_RIM` 을 0으로 되돌리면(테두리 제거) 여기서 죽는다 — 테두리 폴리곤이 본체와
    // 정확히 겹쳐 **모든** 표본에서 바깥 반경이 같아지기 때문이다.
    //
    // 왜 "전부 strictly greater"가 아니라 다수결인가: 꼭짓점도 격자에 스냅되므로, 가장 작은
    // 변형에서는 1텍셀 확장이 최외곽 꼭짓점 하나에서 반올림으로 흡수될 수 있다. 그건 정상이고
    // (그래서 `>=` 는 예외 없이 요구한다), 결함은 "어디서도 안 커지는" 쪽이다.
    let checked = 0;
    let strictlyOutside = 0;
    for (const kind of ALL_KINDS) {
      if (KIND_SHAPE[kind].silhouette === SCALABLE_SILHOUETTE) continue;
      // 부조는 **동심 테두리가 아니라 방향성 드롭 섀도**로 접지한다(광원 상수가 있으므로
      // 사방으로 두르는 것이 오히려 틀렸다). 그림자 반대편에서는 본체가 더 멀리 나가는 것이
      // 정상이라 이 판정이 적용되지 않는다 — 대신 '부조 ⑤' 절의 방향 단언이 더 강하게 잡는다.
      if (isRelief(kind)) continue;
      for (let v = 0; v < VARIANTS; v++) {
        const prims = primitives(kind, v);
        const rim = prims.filter((p) => p.color === FILL.ground);
        // 굽기 프레임(알파 0)은 바운드 정렬용 장치라 본체가 아니다 — 안 걸러내면 본체 반경이
        // 프레임 반경으로 부풀어 접지 테두리가 항상 안쪽으로 보인다(거짓 실패).
        const body = prims.filter(
          (p) => p.action === 'fill' && p.color !== FILL.ground && p.color !== BAKE_FRAME_COLOR,
        );
        if (rim.length === 0) {
          // 균열은 테두리가 아니라 겉선/코어 이중선으로 깊이를 만든다.
          expect(KIND_SHAPE[kind].silhouette).toBe('crack');
          continue;
        }
        expect(maxRadius(rim), `${kind}/v${v}`).toBeGreaterThanOrEqual(maxRadius(body));
        if (maxRadius(rim) > maxRadius(body)) strictlyOutside++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(strictlyOutside).toBeGreaterThan(checked * 0.8);
  });

  it('haze 실루엣에는 접지 테두리를 두르지 않는다 (테두리가 보이면 haze 가 아니다)', () => {
    for (const kind of ALL_KINDS) {
      if (KIND_SHAPE[kind].silhouette !== SCALABLE_SILHOUETTE) continue;
      for (let v = 0; v < VARIANTS; v++) {
        expect(primitives(kind, v).some((p) => p.color === FILL.ground)).toBe(false);
      }
    }
  });

  it('변형마다 주축 각도가 실제로 다르다 — **회전이 기하에 구워졌다**', () => {
    // 2차의 "회전이 실제로 적용되는지 확인해라"에 대한 직답. 런타임 회전을 버렸으므로
    // 각도가 텍스처에 안 들어갔다면 모든 변형의 주축이 같아진다.
    // 부조 중 `ridge`·`mound` 도 포함한다. `boulder` 는 **일부러 뺐다** — 덩어리+파편 구름이라
    // 주축이 등방에 가까워 회전을 돌려도 주축 각도가 노이즈에 지배된다(실측 6변형 중 2쌍이
    // 0.01rad 안에서 겹쳤다). 회전이 안 구워졌다는 뜻이 아니라 **이 지표로는 못 재는** 형태다.
    // boulder 의 회전 증명은 아래 '부조 — 광원' 절의 림 방향 불변식이 대신한다.
    for (const kind of ['flow', 'splatter', 'crack', 'stainDark', 'ridge', 'mound'] as DecalKind[]) {
      const angles = Array.from({ length: VARIANTS }, (_, v) => principalAngle(primitives(kind, v)));
      const uniq = new Set(angles.map((a) => a.toFixed(2)));
      expect(uniq.size, `${kind} 주축 ${angles.map((a) => a.toFixed(2)).join(',')}`).toBe(VARIANTS);
      // 방향이 한 쪽 반원에 몰려 있지 않다(2차 기각 사유: 전부 같은 방향으로 기울어져 있다).
      const spread = Math.max(...angles) - Math.min(...angles);
      expect(spread).toBeGreaterThan(1.2);
    }
  });

  it('변형마다 크기가 다르다(같은 도형이 반복되지 않는다)', () => {
    for (const kind of ALL_KINDS) {
      const radii = Array.from({ length: VARIANTS }, (_, v) => maxRadius(primitives(kind, v)));
      // 부조는 발자국이 [RELIEF_MIN_SPAN, RELIEF_MAX_SPAN] 에 갇혀 있어 크기비 상한이 산술적으로
      // 정해진다: (400/200)×(1−wob)/(1+wob) ≈ 1.70. 굽기 프레임과 드롭 섀도가 상수항으로 더해져
      // 실측은 더 눌린다. 그래서 여기만 문턱이 다르다 — **약화가 아니라 다른 제약의 귀결**이고,
      // 대역 자체는 아래 '부조 — 크기 대역' 절이 양쪽에서 잠근다.
      const floor = isRelief(kind) ? 1.35 : 1.6;
      expect(Math.max(...radii) / Math.min(...radii), kind).toBeGreaterThan(floor);
    }
  });

  it('실루엣마다 그리기 분기가 실제로 다른 기하를 만든다', () => {
    // "형태가 사실상 1종"의 회귀 방지선. 분기를 하나로 합치면(예: 전부 blob) 서명이 겹친다.
    // 서명 = 그 분기가 실제로 칠하는 **색 집합** — 분기마다 고유한 팔레트 조합을 쓴다.
    const signature = new Map<Silhouette, string>();
    for (const kind of ALL_KINDS) {
      const sil = KIND_SHAPE[kind].silhouette;
      if (signature.has(sil)) continue;
      const colors = [...new Set(primitives(kind, 0).map((p) => p.color))].sort((a, b) => a - b);
      expect(colors.length, `${kind} 이 아무것도 안 그린다`).toBeGreaterThan(0);
      signature.set(sil, colors.join(','));
    }
    expect(signature.size).toBeGreaterThanOrEqual(3);
    expect(new Set(signature.values()).size).toBe(signature.size);

    // 게다가 "몇 개를 그리는가"도 갈린다: 균열은 선 위주, 비산·파편은 조각이 많다.
    const fillsOf = (k: DecalKind): number =>
      primitives(k, 0).filter((p) => p.action === 'fill').length;
    expect(primitives('crack', 0).some((p) => p.action === 'stroke')).toBe(true);
    expect(primitives('stainDark', 0).some((p) => p.action === 'stroke')).toBe(false);
    expect(fillsOf('splatter')).toBeGreaterThan(fillsOf('crater') * 3);
    expect(fillsOf('gravel')).toBeGreaterThan(fillsOf('crater') * 3);
  });

  it('flow 는 머리에서 꼬리로 가늘어진다(대칭 타원이 아니다)', () => {
    // 실루엣 자체에 방향성이 있어야 "흐른 자국"으로 읽힌다.
    const prims = primitives('flow', 0).filter((p) => p.color === FILL.flowBody);
    expect(prims.length).toBeGreaterThan(4);
    const size = (p: Prim): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 1; i < p.points.length; i += 2) {
        lo = Math.min(lo, p.points[i] ?? 0);
        hi = Math.max(hi, p.points[i] ?? 0);
      }
      return hi - lo;
    };
    const head = size(prims[0] as Prim);
    const tail = size(prims[prims.length - 1] as Prim);
    expect(head).toBeGreaterThan(tail * 2);
  });
});

describe('월드 고정', () => {
  it.each(GRIDS)('%s: 카메라를 멀리 보냈다 돌아와도 같은 셀은 같은 데칼', (_name, spec) => {
    const before = new Map<string, string>();
    for (let cx = -3; cx <= 3; cx++) {
      for (let cy = -3; cy <= 3; cy++) {
        before.set(`${cx},${cy}`, sig(decalAt(spec, 31337, cx, cy)));
      }
    }
    const scratch = emptyPlacement();
    for (let k = 0; k < 5000; k++) {
      decalAt(spec, 31337, 100000 + k, -95000 - k, 1, scratch);
    }
    for (const [key, want] of before) {
      const parts = key.split(',');
      const cx = Number(parts[0]);
      const cy = Number(parts[1]);
      expect(sig(decalAt(spec, 31337, cx, cy))).toBe(want);
    }
  });

  it.each(GRIDS)('%s: 월드 좌표가 셀 좌표에 정확히 비례한다(화면 좌표 의존 없음)', (_name, spec) => {
    const p = decalAt(spec, 5, 7, -9);
    const q = decalAt(spec, 5, 7 + 1000, -9 - 1000);
    expect(Number.isFinite(p.worldX)).toBe(true);
    if (p.present && q.present) {
      expect(q.worldX - p.worldX).toBeGreaterThan(999 * spec.cell);
      expect(p.worldY - q.worldY).toBeGreaterThan(999 * spec.cell);
    }
  });
});

describe('밀도', () => {
  /** 1920×1080 화면 한 장에 놓이는 데칼 수. */
  function screenCount(spec: GridSpec, seed: number, densityScale = 1): number {
    const cols = Math.ceil(1920 / spec.cell);
    const rows = Math.ceil(1080 / spec.cell);
    const scratch = emptyPlacement();
    let n = 0;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (decalAt(spec, seed, c, r, densityScale, scratch).present) n++;
      }
    }
    return n;
  }

  it('화면당 총 데칼 수가 "드문드문" 대역(20~72장) 안이다', () => {
    for (let seed = 1; seed <= 32; seed++) {
      const total =
        screenCount(MACRO_GRID, seed) + screenCount(MICRO_GRID, seed) + screenCount(STAIN_GRID, seed);
      expect(total).toBeGreaterThanOrEqual(20);
      expect(total).toBeLessThanOrEqual(72);
    }
  });

  it('대역 변색은 화면당 한 자릿수인데 알파는 보이는 대역이다', () => {
    for (let seed = 1; seed <= 16; seed++) {
      expect(screenCount(STAIN_GRID, seed)).toBeLessThanOrEqual(9);
      expect(screenCount(STAIN_GRID, seed)).toBeGreaterThanOrEqual(2);
    }
    // 1차는 0.05~0.11 이었고 화면에 도달하지 못했다. 하한을 그 위로 못 박는다.
    expect(STAIN_GRID.minAlpha).toBeGreaterThanOrEqual(0.11);
    expect(STAIN_GRID.maxAlpha).toBeGreaterThanOrEqual(0.24);
    // 발자국이 화면 절반급이어야 격자 지각을 무너뜨린다: 반경 × 배율 ≥ 화면 높이의 1/5.
    const stainR = KIND_SHAPE[STAIN_GRID.kinds[0] as DecalKind].r;
    expect(stainR * STAIN_GRID.minScale).toBeGreaterThanOrEqual(1080 / 5);
  });

  it('균열이 잔 데칼의 3분의 1 이상을 차지한다 (3차 지적: 균열 밀도가 낮다)', () => {
    // 밀도 상한(0.36)을 건드리지 않고 **후보 가중치**로 올렸다는 것을 못 박는다.
    let crack = 0;
    let total = 0;
    for (let cx = 0; cx < 60; cx++) {
      for (let cy = 0; cy < 60; cy++) {
        const p = decalAt(MICRO_GRID, 4321, cx, cy);
        if (!p.present) continue;
        total++;
        if (p.kind === 'crack') crack++;
      }
    }
    expect(total).toBeGreaterThan(1000);
    expect(crack / total).toBeGreaterThan(1 / 3);
  });

  it('티어 밀도 배율이 단조 감소하고 low 에서 실제로 데칼이 줄어든다', () => {
    expect(densityForTier('low')).toBeLessThan(densityForTier('med'));
    expect(densityForTier('med')).toBeLessThan(densityForTier('high'));
    let low = 0;
    let high = 0;
    for (let seed = 1; seed <= 12; seed++) {
      low += screenCount(MICRO_GRID, seed, densityForTier('low'));
      high += screenCount(MICRO_GRID, seed, densityForTier('high'));
    }
    expect(low).toBeLessThan(high * 0.7);
  });

  it('밀도 배율은 존재 판정만 바꾸고 남은 데칼의 모습은 유지한다', () => {
    for (let cx = 0; cx < 30; cx++) {
      for (let cy = 0; cy < 30; cy++) {
        const lowP = decalAt(MACRO_GRID, 8, cx, cy, densityForTier('low'));
        if (!lowP.present) continue;
        const highP = decalAt(MACRO_GRID, 8, cx, cy, 1);
        expect(highP.present).toBe(true);
        expect(sig(highP)).toBe(sig(lowP));
      }
    }
  });
});

describe('격자 비공명', () => {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

  it('데칼 격자끼리도 서로소다(여러 얼룩 층이 같이 반복되지 않는다)', () => {
    for (const [, a] of ALL_GRIDS) {
      for (const [, b] of ALL_GRIDS) {
        if (a === b) continue;
        expect(gcd(a.cell, b.cell)).toBe(1);
      }
    }
  });

  it('전 주기의 최소공배수가 화면 폭보다 훨씬 크다', () => {
    const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;
    let period = DISPLAY_TILE;
    for (const [, spec] of ALL_GRIDS) period = lcm(period, spec.cell);
    expect(period).toBeGreaterThan(1920 * 1000);
  });

  it('격자마다 해시 소금이 달라 같은 셀에서 같은 난수를 뽑지 않는다', () => {
    const salts = new Set(ALL_GRIDS.map(([, s]) => s.salt));
    expect(salts.size).toBe(ALL_GRIDS.length);
  });
});

describe('화면 세기 (1차 기각 사유의 회귀 방지선)', () => {
  /**
   * 1차 측정 기준점: 시차 21.6 · 그레이딩 13.1 · **데칼 1.54** · 용암 발광 0.94 · 전경 0.45,
   * 애니메이션 노이즈 바닥 0.12. 모델값으로는 1차 설정이 평균 1.21 이었다.
   *
   * ⚠️ 3차는 곱연산으로 갈아탔으므로 **실측이 2차(12.7)보다 낮게 나오는 것이 정상**이다 —
   * 어두운 현무암 위에서는 곱연산이 거의 아무 일도 하지 않기 때문이고, 그게 이번 라운드가
   * 의도한 것이다("떠 있는 얼룩" 제거). 이 절이 잠그는 것은 "1차 수준으로 다시 무너지지 않음"이다.
   */
  const OLD_CONFIG_MODEL_AVG = 1.21;

  it('모든 시드에서 화면 잉크 모델값이 목표 하한을 넘는다', () => {
    // ⚠️ 하한을 3차 설정 실측(min 3.92 · avg 5.26)에서 **재기준화**했다. 2차 하한 5를 그대로
    // 쓰면 안 되는 이유: 모델의 단위가 바뀌었다. 2차는 `|바닥 − fill|`(최대 ~140)이었고
    // 3차는 `바닥 × darkening`(최대 ~150×0.45 = 68)이라 **같은 시각 세기가 대략 절반 값**으로
    // 나온다. 숫자를 맞추려고 알파를 올리면 그게 바로 2차가 기각된 방식이다.
    for (let seed = 1; seed <= 48; seed++) {
      expect(estimateScreenInk(seed)).toBeGreaterThanOrEqual(3.5);
    }
  });

  it('평균 세기가 1차 설정 모델값의 3배를 넘는다(기각 사유가 실제로 해소됐다)', () => {
    let sum = 0;
    for (let seed = 1; seed <= 48; seed++) sum += estimateScreenInk(seed);
    expect(sum / 48).toBeGreaterThan(OLD_CONFIG_MODEL_AVG * 3);
    expect(sum / 48).toBeGreaterThan(4.8);
  });

  it('세기의 절반 이상이 대역 변색층에서 나온다(격자 반복을 깨는 주체)', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const stain = estimateScreenInk(seed, 1, 1920, 1080, [STAIN_GRID]);
      expect(stain).toBeGreaterThan(estimateScreenInk(seed) * 0.5);
    }
  });

  it('알파가 상수가 아니다 — 대역을 실제로 훑는다 (뮤테이션 방지)', () => {
    for (const [, spec] of GRIDS) {
      let lo = Infinity;
      let hi = -Infinity;
      const scratch = emptyPlacement();
      for (let cx = 0; cx < 40; cx++) {
        for (let cy = 0; cy < 40; cy++) {
          const p = decalAt(spec, 606, cx, cy, 1, scratch);
          if (!p.present) continue;
          lo = Math.min(lo, p.alpha);
          hi = Math.max(hi, p.alpha);
        }
      }
      const band = spec.maxAlpha - spec.minAlpha;
      expect(hi - lo).toBeGreaterThan(band * 0.9);
      expect(lo).toBeGreaterThanOrEqual(spec.minAlpha);
      expect(hi).toBeLessThanOrEqual(spec.maxAlpha);
    }
  });

  it('알파를 0 으로 죽이면 잉크 모델이 무너진다 (하한이 항진이 아님을 증명)', () => {
    const dead = GRIDS.map(([, s]) => ({ ...s, minAlpha: 0, maxAlpha: 0 }));
    for (let seed = 1; seed <= 8; seed++) {
      expect(estimateScreenInk(seed, 1, 1920, 1080, dead)).toBe(0);
      expect(estimateScreenInk(seed)).toBeGreaterThan(0);
    }
  });

  it('배수를 1(흰색)로 만들면 잉크가 0이 된다 (곱연산 모델이 실제로 배수를 본다)', () => {
    // `darkening` 을 상수로 바꾸거나 fill 을 무시하도록 뮤테이션하면 여기서 죽는다.
    expect(darkening(0xffffff)).toBe(0);
    expect(darkening(0x000000)).toBe(1);
    expect(lumaSum(FILL.crack)).toBeLessThan(lumaSum(FILL.ash)); // 균열이 더 진하다
  });

  it('밀도가 아니라 대비로 벌었다 — 화면당 데칼 수가 1차와 사실상 같다', () => {
    expect(MACRO_GRID.density).toBeLessThanOrEqual(0.45);
    expect(MICRO_GRID.density).toBeLessThanOrEqual(0.36);
    expect(STAIN_GRID.density).toBeLessThanOrEqual(0.9);
  });

  it('대역 변색이 시차 레이어와 대역을 다투지 않는다(알파를 2차보다 올리지 않았다)', () => {
    // 시차 3차가 암부 저주파를 맡는다. 둘 다 큰 스케일 명암이라 겹치면 화면이 탁해진다.
    expect(STAIN_GRID.maxAlpha).toBeLessThanOrEqual(0.28);
  });

  it('바닥 밝기 기준점이 살아 있다(타일셋 교체 시 갱신 대상)', () => {
    expect(FLOOR_LUMA_SUM).toBeGreaterThan(0);
    expect(FLOOR_LUMA_SUM).toBeLessThan(765);
  });
});

describe('레이어 계약', () => {
  it('렌더러가 없으면(캔버스 없는 환경) 던지지 않고 비활성으로 떨어진다', () => {
    const layer = new KargonDecalLayer();
    expect(layer.configure({ planet: 0, seed: 1 })).toBe(false);
    expect(() =>
      layer.update({
        camX: 0,
        camY: 0,
        viewMinX: 0,
        viewMinY: 0,
        viewMaxX: 1920,
        viewMaxY: 1080,
        tick: 0,
        dt: 1 / 60,
      }),
    ).not.toThrow();
    expect(() => layer.resize(1920, 1080)).not.toThrow();
  });

  it('카르곤이 아닌 행성에서는 비활성이다', () => {
    const layer = new KargonDecalLayer();
    for (let planet = 1; planet <= 5; planet++) {
      expect(layer.configure({ planet, seed: 1 })).toBe(false);
    }
  });

  it('슬롯은 floor(지형 위·엔티티 아래)다', () => {
    const layer = new KargonDecalLayer();
    expect(layer.slot).toBe('floor');
    expect(layer.name).toBe('kargon-decals');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 4차 — 부조(암부 랜드마크). 비평가 지적 ③ "암부가 형태 없는 고주파 부스러기"에 대한 답.
//
// 이 절이 잠그는 다섯 가지는 전부 **눈으로만 확인하면 조용히 무너지는** 것들이다:
//  ① 실루엣이 암부에만 놓인다        — 밝은 지각 위에 놓이면 균열망과 경쟁한다
//  ② 크기가 200~400px 대역           — 작으면 재질이 되고 크면 배경이 된다
//  ③ 화면당 개수가 낮은 대역          — 많으면 다시 벽지다
//  ④ 가산 총량이 상한 이하            — 밝히는 총량은 곧 가독성 예산이다
//  ⑤ 빛이 광원 상수를 따른다          — 회전이 광원까지 돌려 버리는 것이 이 설계의 오작동 1순위
// ─────────────────────────────────────────────────────────────────────────────

const RELIEF_KINDS: readonly DecalKind[] = ['boulder', 'ridge', 'mound'];

/** 배치가 실제로 뽑는 틴트 전부(가산 광량 상한을 이 전체에 대해 훑는다). */
const ALL_TINTS = [0xffffff, 0xf0e4d8, 0xdcd0c4, 0xd8dce4, 0xf4d8c0, 0xcfc8c2];

/** 굽기 프레임과 접지 그림자를 뺀 **본체** 기하만. 대역·방향 측정의 기준. */
function bodyPrims(kind: DecalKind, v: number): Prim[] {
  return primitives(kind, v).filter(
    (p) => p.action === 'fill' && p.color !== FILL.ground && p.color !== BAKE_FRAME_COLOR,
  );
}

/**
 * 실루엣의 **바깥 윤곽**만(본체 색 채움). 방향 측정의 기준점은 반드시 이것이어야 한다 —
 * 안쪽 그늘면은 일부러 광원 반대쪽으로 밀려 있어서, 그걸 포함한 무게중심을 기준으로 삼으면
 * 기준 자체가 빛 반대로 끌려가 드롭 섀도 방향 판정이 뒤집힌다(실제로 한 번 뒤집혔다).
 */
function outlinePrims(kind: DecalKind, v: number): Prim[] {
  return primitives(kind, v).filter(
    (p) => p.action === 'fill' && p.color === KIND_SHAPE[kind].fill,
  );
}

/** 꼭짓점 구름의 무게중심. */
function centroid(prims: readonly Prim[]): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of prims) {
    for (let i = 0; i + 1 < p.points.length; i += 2) {
      sx += p.points[i] ?? 0;
      sy += p.points[i + 1] ?? 0;
      n++;
    }
  }
  return n === 0 ? [0, 0] : [sx / n, sy / n];
}

/** 두 무게중심 차이 벡터가 광원 쪽을 향하는 정도(−1 ~ +1). */
function lightAlignment(from: readonly [number, number], to: readonly [number, number]): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const m = Math.hypot(dx, dy);
  return m < 1e-9 ? 0 : (dx * LIGHT_X + dy * LIGHT_Y) / m;
}

/** 하이라이트 텍스처의 기하(그림자 텍스처와 **다른 함수**가 굽는다). */
function glowPrimitives(kind: DecalKind, variant: number): Prim[] {
  const g = new Graphics();
  drawHighlightInto(g, kind, variant);
  const out: Prim[] = [];
  for (const ins of g.context.instructions as unknown as {
    action: string;
    data?: {
      style?: { color?: number; width?: number };
      path?: { shapePath?: { shapePrimitives?: { shape?: { points?: number[] } }[] } };
    };
  }[]) {
    const style = ins.data?.style;
    for (const sp of ins.data?.path?.shapePath?.shapePrimitives ?? []) {
      out.push({
        action: ins.action,
        color: style?.color ?? 0,
        width: style?.width,
        points: sp.shape?.points ?? [],
      });
    }
  }
  return out;
}

describe('부조 ① — 암부에만 놓인다 (지형 필드를 읽어 배치한다)', () => {
  /** 부조 격자를 넓게 훑어 배치를 모은다. */
  function sweep(seed: number, n = 34): DecalPlacement[] {
    const out: DecalPlacement[] = [];
    for (let cx = -n; cx < n; cx++) {
      for (let cy = -n; cy < n; cy++) {
        const p = decalAt(RELIEF_GRID, seed, cx, cy);
        if (p.present) out.push({ ...p });
      }
    }
    return out;
  }

  it('배치된 모든 실루엣이 발자국 전체에서 하부 지형(암부) 위에 있다', () => {
    const OFFSETS: readonly (readonly [number, number])[] = [
      [0, 0],
      [-0.62, 0],
      [0.62, 0],
      [0, -0.62],
      [0, 0.62],
    ];
    let checked = 0;
    for (const seed of [1, 7, 12345, 99991]) {
      for (const p of sweep(seed)) {
        const rad = reliefFootprintRadius(p.kind, p.variant) * p.scale;
        // 중심만이 아니라 발자국 상하좌우까지 — 큰 실루엣은 3~6타일을 덮는다.
        for (const off of OFFSETS) {
          const vx = (p.worldX + off[0] * rad) / DISPLAY_TILE;
          const vy = (p.worldY + off[1] * rad) / DISPLAY_TILE;
          expect(upperAt(seed, vx, vy), `${p.kind} @${p.worldX},${p.worldY}`).toBe(false);
          // 경계에 딱 붙지도 않는다(여유분만큼 안으로 들어가 있다).
          expect(terrainFieldAt(seed, vx, vy)).toBeLessThan(UPPER_THRESHOLD - RELIEF_FIELD_MARGIN);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000); // 스윕이 실제로 돌았다
  });

  it('**항진이 아니다** — 게이트가 없었다면 상당수가 밝은 지각 위에 놓였을 자리다', () => {
    // 게이트를 뺀 세계를 같은 함수로 재현한다: 지형 친화도를 지운 사양.
    const { terrain: _drop, ...rest } = RELIEF_GRID;
    const ungated: GridSpec = rest;
    let gated = 0;
    let raw = 0;
    let onUpper = 0;
    for (let cx = -34; cx < 34; cx++) {
      for (let cy = -34; cy < 34; cy++) {
        const u = decalAt(ungated, 12345, cx, cy);
        if (!u.present) continue;
        raw++;
        if (upperAt(12345, u.worldX / DISPLAY_TILE, u.worldY / DISPLAY_TILE)) onUpper++;
        if (decalAt(RELIEF_GRID, 12345, cx, cy).present) gated++;
      }
    }
    expect(raw).toBeGreaterThan(1500);
    // 게이트가 실제로 걸러낸다(자명하게 전부 통과하는 것이 아니다).
    expect(gated).toBeLessThan(raw * 0.6);
    expect(gated).toBeGreaterThan(raw * 0.15); // 다 죽여 버리지도 않는다
    // 게이트 없는 세계에는 밝은 지각 위 배치가 실제로 존재한다 = 위 단언이 잴 것이 있었다.
    expect(onUpper).toBeGreaterThan(raw * 0.15);
  });

  it('암부 판정이 autotile 의 임계값에서 **파생**된다(복제 아님)', () => {
    // 임계를 옮기면 판정도 따라 움직여야 한다. `kargonLavaLight` 가 0.5 를 복제한 채 임계가
    // 0.57 로 올라가 지형이 그리지 않는 등고선에 발광을 붙였던 전례에 대한 방지선.
    const limit = UPPER_THRESHOLD - RELIEF_FIELD_MARGIN;
    let agree = 0;
    for (let i = 0; i < 4000; i++) {
      const wx = ((i * 613) % 20000) - 10000;
      const wy = ((i * 977) % 17000) - 8500;
      const want = terrainFieldAt(7, wx / DISPLAY_TILE, wy / DISPLAY_TILE) < limit;
      // 반경 0 이면 중심 한 점만 보므로 필드 값과 정확히 같은 판정이어야 한다.
      expect(reliefSiteIsDark(7, wx, wy, 0)).toBe(want);
      if (want) agree++;
    }
    expect(agree).toBeGreaterThan(400); // 양쪽 답이 다 나온다(상수 함수가 아니다)
    expect(agree).toBeLessThan(3600);
  });

  it('부조 격자만 지형 게이트를 쓴다(잔 데칼은 지형과 무관하게 깔린다)', () => {
    expect(RELIEF_GRID.terrain).toBe('lower');
    for (const [name, spec] of GRIDS) expect(spec.terrain, name).toBeUndefined();
  });
});

describe('부조 ② — 크기 대역 200~400px', () => {
  it('모든 종류 × 모든 변형의 발자국 지름이 대역 안이다', () => {
    let n = 0;
    for (const kind of RELIEF_KINDS) {
      for (let v = 0; v < VARIANTS; v++) {
        const span = 2 * maxRadius(bodyPrims(kind, v));
        expect(span, `${kind}/v${v} 지름 ${span.toFixed(0)}`).toBeGreaterThanOrEqual(
          RELIEF_MIN_SPAN,
        );
        expect(span, `${kind}/v${v} 지름 ${span.toFixed(0)}`).toBeLessThanOrEqual(RELIEF_MAX_SPAN);
        n++;
      }
    }
    expect(n).toBe(RELIEF_KINDS.length * VARIANTS);
  });

  it('대역 위아래가 **둘 다** 실제로 쓰인다(전부 한가운데 몰려 있지 않다)', () => {
    const spans: number[] = [];
    for (const kind of RELIEF_KINDS) {
      for (let v = 0; v < VARIANTS; v++) spans.push(2 * maxRadius(bodyPrims(kind, v)));
    }
    const mid = (RELIEF_MIN_SPAN + RELIEF_MAX_SPAN) / 2;
    expect(Math.min(...spans)).toBeLessThan(mid * 0.85);
    expect(Math.max(...spans)).toBeGreaterThan(mid * 1.1);
  });

  it('**항진이 아니다** — 일반 변형 표를 쓰면 대역을 벗어난다', () => {
    // 부조가 전용 변형 표를 갖는 이유가 실제 산술이라는 것. RELIEF_VARIANT_SPEC 을 지우고
    // VARIANT_SPEC 으로 되돌리면 작은 변형이 하한 아래로 샌다.
    const relief = RELIEF_VARIANT_SPEC.map((v) => v.sizeMul);
    const generic = VARIANT_SPEC.map((v) => v.sizeMul);
    expect(Math.min(...generic)).toBeLessThan(Math.min(...relief));
    for (const kind of RELIEF_KINDS) {
      const base = 2 * maxRadius(bodyPrims(kind, 0));
      const unit = base / (RELIEF_VARIANT_SPEC[0]?.sizeMul ?? 1);
      expect(unit * Math.min(...generic), kind).toBeLessThan(RELIEF_MIN_SPAN);
    }
    expect(variantSpecFor('boulder')).toBe(RELIEF_VARIANT_SPEC);
    expect(variantSpecFor('crack')).toBe(VARIANT_SPEC);
    expect(RELIEF_VARIANT_SPEC.length).toBe(VARIANT_SPEC.length); // 변형 인덱스는 공용 축
  });

  it('부조가 잔 데칼보다 압도적으로 크다(층의 역할이 실제로 다르다)', () => {
    const smallest = Math.min(...RELIEF_KINDS.map((k) => 2 * maxRadius(bodyPrims(k, 1))));
    for (const kind of ['crack', 'gravel', 'soot'] as DecalKind[]) {
      const s = 2 * maxRadius(bodyPrims(kind, 2));
      expect(smallest, `${kind} 보다 커야 한다`).toBeGreaterThan(s * 1.8);
    }
  });
});

describe('부조 ③ — 랜드마크 밀도(재질이 아니다)', () => {
  it('화면당 개수가 낮은 대역이고 평균이 한 자릿수 앞자리다', () => {
    const counts: number[] = [];
    for (let seed = 1; seed <= 64; seed++) counts.push(reliefCount(seed));
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(Math.max(...counts), `최대 ${Math.max(...counts)}`).toBeLessThanOrEqual(7);
    expect(avg).toBeGreaterThan(1.4);
    expect(avg).toBeLessThan(4);
    // 하나도 없는 화면이 있는 것은 **의도**다(매 화면 보장되면 랜드마크가 아니다).
    // 다만 대부분의 화면에는 있어야 한다.
    expect(counts.filter((c) => c === 0).length).toBeLessThan(counts.length * 0.35);
  });

  it('잔 데칼보다 한 자릿수 적다(밀도로 벌지 않는다)', () => {
    let relief = 0;
    let micro = 0;
    const scratch = emptyPlacement();
    for (let seed = 1; seed <= 16; seed++) {
      relief += reliefCount(seed);
      for (let c = 0; c < Math.ceil(1920 / MICRO_GRID.cell); c++) {
        for (let r = 0; r < Math.ceil(1080 / MICRO_GRID.cell); r++) {
          if (decalAt(MICRO_GRID, seed, c, r, 1, scratch).present) micro++;
        }
      }
    }
    expect(relief).toBeGreaterThan(0);
    expect(relief * 6).toBeLessThan(micro);
  });

  it('저티어에서도 구도가 남는다(랜드마크는 통째로 솎이면 안 된다)', () => {
    expect(RELIEF_GRID.minDensityScale ?? 0).toBeGreaterThanOrEqual(0.7);
    expect(RELIEF_GRID.minDensityScale ?? 0).toBeGreaterThan(densityForTier('low'));
    let low = 0;
    let high = 0;
    for (let seed = 1; seed <= 24; seed++) {
      low += reliefCount(seed, RELIEF_GRID.minDensityScale ?? 1);
      high += reliefCount(seed, 1);
    }
    expect(low).toBeGreaterThan(high * 0.5);
    expect(low).toBeLessThanOrEqual(high);
  });
});

describe('부조 ④ — 가산 하이라이트 예산(밝히는 총량 = 가독성 예산)', () => {
  it('하이라이트 알파 대역이 곱연산의 절반 이하이고 절대 상한 안이다', () => {
    const h = RELIEF_GRID.highlight;
    expect(h).toBeDefined();
    expect(h?.maxAlpha ?? 1).toBeLessThanOrEqual(MAX_HIGHLIGHT_ALPHA);
    expect(h?.maxAlpha ?? 1).toBeLessThanOrEqual(RELIEF_GRID.maxAlpha / 2);
    expect(h?.minAlpha ?? 0).toBeGreaterThan(0);
    expect(h?.minAlpha ?? 0).toBeLessThan(h?.maxAlpha ?? 0);
  });

  it('한 텍셀이 더할 수 있는 최대 광량이 상한 이하다 (모든 틴트 · 대역 전체)', () => {
    const h = RELIEF_GRID.highlight;
    const dark: [number, number, number] = [24, 26, 38];
    const base = dark[0] + dark[1] + dark[2];
    let checked = 0;
    for (const glow of Object.values(GLOW)) {
      for (let a = 0; a <= (h?.maxAlpha ?? 0) + 1e-9; a += 0.01) {
        for (const tint of ALL_TINTS) {
          const gain = compositeLumaSum(dark, glow, a, tint, 'add') - base;
          expect(gain).toBeGreaterThanOrEqual(-1e-9);
          expect(gain).toBeLessThanOrEqual(MAX_ADDITIVE_LUMA_GAIN);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('**가산은 실제로 밝힌다** — 그래서 상한이 필요하다(경로가 존재함을 증명)', () => {
    // 곱연산 절의 "절대 안 밝아진다"가 이 레이어 전체에 대한 진술이라고 오독하지 않게 못 박는다.
    expect(compositeChannel(20, 200, 0.18, 'add')).toBeGreaterThan(20);
    expect(compositeChannel(20, 200, 0.18, 'multiply')).toBeLessThan(20);
    expect(compositeChannel(250, 200, 1, 'add')).toBeLessThanOrEqual(255); // 포화
  });

  it('화면 가산 잉크 총량이 예산 안이고, 곱연산 3층 기여의 일부에 그친다', () => {
    let glow = 0;
    let multiply = 0;
    for (let seed = 1; seed <= 48; seed++) {
      const g = estimateHighlightInk(seed);
      expect(g, `시드 ${seed}`).toBeLessThanOrEqual(ADDITIVE_INK_BUDGET);
      glow += g;
      multiply += estimateScreenInk(seed);
    }
    // 절제: 화면을 밝히는 레이어가 되면 안 된다.
    expect(glow / 48).toBeLessThan((multiply / 48) * 0.2);
  });

  it('**항진이 아니다** — 하이라이트가 실제로 0이 아니고, 죽이면 0이 된다', () => {
    let sum = 0;
    for (let seed = 1; seed <= 24; seed++) sum += estimateHighlightInk(seed);
    expect(sum).toBeGreaterThan(0.5); // 실제로 무언가를 밝히고 있다
    const dead: GridSpec = { ...RELIEF_GRID, highlight: { minAlpha: 0, maxAlpha: 0 } };
    const scratch = emptyPlacement();
    for (let cx = 0; cx < 8; cx++) {
      for (let cy = 0; cy < 4; cy++) {
        expect(decalAt(dead, 5, cx, cy, 1, scratch).glowAlpha).toBe(0);
      }
    }
    // 하이라이트가 없는 격자는 glowAlpha 를 아예 안 만든다.
    expect(decalAt(MACRO_GRID, 5, 1, 1).glowAlpha).toBe(0);
  });

  it('부조의 곱연산 기여는 **암부 밝기**로 잰다(화면 평균으로 재면 부풀려진다)', () => {
    // 이 레인의 출발점 자체를 숨기지 않기 위한 장치. 암부에서 곱연산은 거의 일하지 않는다.
    expect(DARK_FLOOR_LUMA_SUM).toBeLessThan(FLOOR_LUMA_SUM);
    let shadow = 0;
    let glow = 0;
    for (let seed = 1; seed <= 24; seed++) {
      shadow += estimateReliefShadowInk(seed);
      glow += estimateHighlightInk(seed);
    }
    expect(shadow).toBeGreaterThan(0);
    // 암부에서 형태를 세우는 것은 그림자가 아니라 빛이다 — 그림자가 압도하면 3차의 재현이다.
    expect(glow).toBeGreaterThan(shadow * 0.2);
  });
});

describe('부조 ⑤ — 광원(회전이 빛까지 돌리면 안 된다)', () => {
  it('광원 벡터가 각도 상수에서 **파생**된다', () => {
    expect(LIGHT_X).toBeCloseTo(Math.cos(LIGHT_ANGLE), 12);
    expect(LIGHT_Y).toBeCloseTo(Math.sin(LIGHT_ANGLE), 12);
    expect(Math.hypot(LIGHT_X, LIGHT_Y)).toBeCloseTo(1, 12);
    // 아래(용암) 쪽에서 온다 — 병렬 레인(kargonLavaLight 4차)과 같은 가정.
    expect(LIGHT_Y).toBeGreaterThan(0.8);
    // 축에 정확히 정렬돼 있지 않다(도장 찍은 하이라이트 방지). 이 값이 0이 아니라는 사실이
    // 아래 "좌우반전 금지" 규율의 근거다.
    expect(Math.abs(LIGHT_X)).toBeGreaterThan(0.15);
  });

  it('림 하이라이트가 광원 쪽 모서리에만 붙는다', () => {
    for (const kind of RELIEF_KINDS) {
      for (let v = 0; v < VARIANTS; v++) {
        const rim = glowPrimitives(kind, v).filter(
          (p) => p.action === 'stroke' && p.color === GLOW.rim,
        );
        expect(rim.length, `${kind}/v${v} 에 림이 없다`).toBeGreaterThan(0);
        const align = lightAlignment(centroid(outlinePrims(kind, v)), centroid(rim));
        expect(align, `${kind}/v${v} 정렬 ${align.toFixed(2)}`).toBeGreaterThan(0.4);
      }
    }
  });

  it('드롭 섀도는 정반대로 떨어진다', () => {
    for (const kind of RELIEF_KINDS) {
      for (let v = 0; v < VARIANTS; v++) {
        const shadow = primitives(kind, v).filter((p) => p.color === FILL.ground);
        expect(shadow.length).toBeGreaterThan(0);
        const align = lightAlignment(centroid(outlinePrims(kind, v)), centroid(shadow));
        expect(align, `${kind}/v${v}`).toBeLessThan(-0.8);
      }
    }
  });

  it('**회전이 빛을 같이 돌리지 않는다** — 모양은 흩어지는데 빛의 방향은 하나다', () => {
    // 이 설계의 오작동 1순위: 림 오프셋을 `emit` 의 회전 경로에 태우면 변형마다 빛이 따라 돌아
    // 화면에 광원이 여섯 개가 된다. 각 변형에서 ①모양 주축은 크게 흩어지고 ②빛 방향은
    // 거의 안 움직인다는 **대비**로 잰다 — 한쪽만 재면 어느 쪽도 증명하지 못한다.
    for (const kind of ['ridge', 'mound', 'boulder'] as DecalKind[]) {
      const shapeAngles: number[] = [];
      const aligns: number[] = [];
      for (let v = 0; v < VARIANTS; v++) {
        shapeAngles.push(principalAngle(bodyPrims(kind, v)));
        const rim = glowPrimitives(kind, v).filter(
          (p) => p.action === 'stroke' && p.color === GLOW.rim,
        );
        aligns.push(lightAlignment(centroid(outlinePrims(kind, v)), centroid(rim)));
      }
      // ① 모양은 실제로 크게 돌아간다.
      const shapeSpread = Math.max(...shapeAngles) - Math.min(...shapeAngles);
      expect(shapeSpread, `${kind} 모양이 안 흩어졌다`).toBeGreaterThan(1.2);
      // ② 그런데 빛은 전 변형에서 **같은 월드 방향**을 가리킨다.
      for (let v = 0; v < VARIANTS; v++) {
        expect(aligns[v] ?? -1, `${kind}/v${v} 정렬 ${(aligns[v] ?? 0).toFixed(2)}`).toBeGreaterThan(
          0.4,
        );
      }
    }
    // ③ **판별력의 증명**: 만약 림 오프셋이 회전 경로를 탔다면, 각 변형의 정렬은
    //    `cos(변형 각도)` 가 됐을 것이고 표에는 음수가 되는 각도가 실제로 들어 있다.
    //    즉 위 ② 는 "무엇을 재도 통과하는" 단언이 아니다.
    const rotated = RELIEF_VARIANT_SPEC.map((v) => Math.cos(v.angle));
    expect(Math.min(...rotated)).toBeLessThan(-0.5);
  });

  it('부조는 좌우반전을 쓰지 않는다(반전은 광원의 x 성분을 거울로 뒤집는다)', () => {
    expect(RELIEF_GRID.noFlip).toBe(true);
    let n = 0;
    for (let cx = -20; cx < 20; cx++) {
      for (let cy = -20; cy < 20; cy++) {
        const p = decalAt(RELIEF_GRID, 2024, cx, cy);
        if (!p.present) continue;
        expect(p.flip).toBe(false);
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
    // 반전을 쓰는 격자는 하이라이트를 가질 수 없다(규율이 실제로 코드에 있다).
    for (const [name, spec] of ALL_GRIDS) {
      if (spec.highlight !== undefined) expect(spec.noFlip, name).toBe(true);
    }
  });
});

describe('부조 ⑥ — 두 텍스처의 정렬·배선', () => {
  it('하이라이트 텍스처는 부조에만 구워진다(빈 텍스처를 굽지 않는다)', () => {
    for (const kind of ALL_KINDS) {
      const prims = glowPrimitives(kind, 0);
      if (isRelief(kind)) {
        expect(prims.length, kind).toBeGreaterThan(2);
        expect(prims.some((p) => p.color === GLOW.rim)).toBe(true);
        expect(prims.some((p) => p.color === GLOW.face)).toBe(true);
      } else {
        expect(prims.length, `${kind} 이 쓸데없이 하이라이트를 굽는다`).toBe(0);
      }
    }
    expect(RELIEF_KINDS.every(isRelief)).toBe(true);
    expect(RELIEF_KINDS.every((k) => RELIEF_SILHOUETTES.has(KIND_SHAPE[k].silhouette))).toBe(true);
    expect(isRelief('crack')).toBe(false);
  });

  it('굽기 프레임이 두 텍스처의 바운드를 같게 만든다(하이라이트가 미끄러지지 않는다)', () => {
    // 하이라이트 기하는 본체의 **부분집합**이라, 프레임이 없으면 generateTexture 바운드가
    // 달라지고 앵커 0.5 정렬이 어긋나 빛이 실루엣에서 몇 픽셀씩 밀린다.
    for (const kind of RELIEF_KINDS) {
      for (let v = 0; v < VARIANTS; v++) {
        const a = primitives(kind, v).filter((p) => p.color === BAKE_FRAME_COLOR);
        const b = glowPrimitives(kind, v).filter((p) => p.color === BAKE_FRAME_COLOR);
        expect(a.length, `${kind}/v${v} 그림자 프레임 없음`).toBe(1);
        expect(b.length, `${kind}/v${v} 하이라이트 프레임 없음`).toBe(1);
        expect(maxRadius(b)).toBe(maxRadius(a));
        // 프레임은 본체(+드롭 섀도)를 전부 감싼다 — 안 그러면 실루엣이 잘린다.
        const inked = primitives(kind, v).filter((p) => p.color !== BAKE_FRAME_COLOR);
        expect(maxRadius(a)).toBeGreaterThan(maxRadius(inked));
      }
    }
  });

  it('하이라이트 기하도 지형 픽셀 격자 위에 있다(굵기 포함)', () => {
    let verts = 0;
    let strokes = 0;
    for (const kind of RELIEF_KINDS) {
      for (let v = 0; v < VARIANTS; v++) {
        for (const prim of glowPrimitives(kind, v)) {
          for (const c of prim.points) expect(Math.abs(c % TERRAIN_PIXEL)).toBe(0);
          verts += prim.points.length;
          if (prim.action !== 'stroke') continue;
          strokes++;
          const w = prim.width ?? 0;
          expect(w).toBeGreaterThanOrEqual(TERRAIN_PIXEL);
          expect(w % TERRAIN_PIXEL).toBe(0);
        }
      }
    }
    expect(verts).toBeGreaterThan(1000);
    expect(strokes).toBeGreaterThan(10);
  });

  it('하이라이트 스프라이트가 가산으로·반전 없이·본체와 같은 자리에 놓인다', () => {
    const p = decalAt(RELIEF_GRID, 4242, 3, 2);
    p.present = true;
    p.flip = true; // 오염시켜 두고 적용이 무시하는지 본다
    const shadow = new Sprite();
    const glow = new Sprite();
    glow.rotation = 1.234;
    applyPlacement(shadow, p, Texture.EMPTY);
    applyHighlight(glow, p, Texture.EMPTY);
    expect(glow.blendMode).toBe(HIGHLIGHT_BLEND);
    expect(glow.blendMode).not.toBe(shadow.blendMode);
    expect(glow.alpha).toBe(p.glowAlpha);
    expect(glow.alpha).toBeLessThan(shadow.alpha);
    expect(glow.rotation).toBe(0);
    expect(glow.scale.x).toBeGreaterThan(0); // 반전 없음
    expect(glow.scale.x).toBe(Math.abs(shadow.scale.x));
    expect(glow.position.x).toBe(shadow.position.x);
    expect(glow.position.y).toBe(shadow.position.y);
  });

  it('부조 실루엣마다 그리기 분기가 실제로 다른 색 조합을 만든다', () => {
    const sigs = new Set<string>();
    for (const kind of RELIEF_KINDS) {
      const colors = [...new Set(primitives(kind, 0).map((p) => p.color))].sort((a, b) => a - b);
      expect(colors.length, `${kind} 이 아무것도 안 그린다`).toBeGreaterThanOrEqual(4);
      sigs.add(colors.join(','));
    }
    expect(sigs.size).toBe(RELIEF_KINDS.length);
    // 그리고 조각 수도 갈린다(능선은 구슬 사슬, 재 무더기는 층 셋).
    const fills = (k: DecalKind): number =>
      primitives(k, 0).filter((p) => p.action === 'fill' && p.color !== BAKE_FRAME_COLOR).length;
    expect(fills('ridge')).toBeGreaterThan(fills('mound'));
  });
});

describe('부조 ⑦ — 배선(이 리포의 반복 결함: 테스트는 그린인데 화면에 없다)', () => {
  /** 렌더러 없이 스프라이트 경로를 돌리기 위한 텍스처 스텁. */
  function stubTextures(): DecalTextures {
    const base = new Map<DecalKind, Texture[]>();
    const glow = new Map<DecalKind, Texture[]>();
    for (const kind of ALL_KINDS) {
      base.set(kind, Array.from({ length: VARIANTS }, () => Texture.EMPTY));
      if (isRelief(kind)) glow.set(kind, Array.from({ length: VARIANTS }, () => Texture.EMPTY));
    }
    return { base, glow };
  }

  it('레이어가 부조 격자를 실제로 돌린다(목록에서 지우면 화면에서만 사라진다)', () => {
    const specs = new KargonDecalLayer().gridSpecs;
    expect(specs).toContain(RELIEF_GRID);
    for (const [name, spec] of ALL_GRIDS) expect(specs, name).toContain(spec);
    // 잔 데칼(균열·자갈)은 암괴 **아래**를 지나야 한다 → 부조가 맨 앞.
    expect(specs[specs.length - 1]).toBe(RELIEF_GRID);
    expect(specs.indexOf(MICRO_GRID)).toBeLessThan(specs.indexOf(RELIEF_GRID));
  });

  it('배치된 부조마다 하이라이트 스프라이트가 **실제로** 나간다', () => {
    // `applyHighlight` 호출을 지우면 배치·기하·상한 테스트가 전부 통과한 채 빛만 사라진다
    // (뮤테이션으로 확인한 실제 구멍). 스프라이트 풀을 직접 세어 그 경로를 잠근다.
    const grid = new ScatterGrid(RELIEF_GRID);
    grid.configure(stubTextures(), 12345);
    grid.layout(0, 0, 1920, 1080);
    const counts = grid.visibleCounts();
    expect(counts.base).toBeGreaterThan(0);
    expect(counts.glow).toBe(counts.base);
  });

  it('하이라이트가 없는 격자는 하이라이트 스프라이트를 만들지도 않는다', () => {
    const grid = new ScatterGrid(MICRO_GRID);
    grid.configure(stubTextures(), 12345);
    grid.layout(0, 0, 1920, 1080);
    const counts = grid.visibleCounts();
    expect(counts.base).toBeGreaterThan(0);
    expect(counts.glow).toBe(0); // 풀 자체가 비어 있다(드로콜 예산 낭비 없음)
  });

  it('숨김(파티클 off 게이트)은 두 층을 함께 내린다', () => {
    const grid = new ScatterGrid(RELIEF_GRID);
    grid.configure(stubTextures(), 777);
    grid.layout(0, 0, 1920, 1080);
    expect(grid.visibleCounts().base).toBeGreaterThan(0);
    grid.hideAll();
    expect(grid.visibleCounts()).toEqual({ base: 0, glow: 0 });
  });

  it('카메라가 셀 경계를 넘어도 두 층의 수가 어긋나지 않는다', () => {
    // 하이라이트 풀만 재배치에서 빠지면 빛이 예전 자리에 남는다 — 프레임 예산 최적화를
    // 건드릴 때 나오기 쉬운 결함이라 여러 위치에서 확인한다.
    const grid = new ScatterGrid(RELIEF_GRID);
    grid.configure(stubTextures(), 31337);
    let sawSome = false;
    for (let k = 0; k < 6; k++) {
      const ox = k * RELIEF_GRID.cell * 1.5;
      grid.layout(ox, ox, ox + 1920, ox + 1080);
      const c = grid.visibleCounts();
      expect(c.glow).toBe(c.base);
      if (c.base > 0) sawSome = true;
    }
    expect(sawSome).toBe(true);
  });
});

