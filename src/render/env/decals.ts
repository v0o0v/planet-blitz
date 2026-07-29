/**
 * 지형 데칼 산포 레이어 (슬롯 `floor` — 지형 바닥 위·엔티티 아래).
 *
 * ## 무엇을 푸는가
 * 바닥은 16장 Wang 타일셋을 {@link DISPLAY_TILE} 격자로 반복 배치한다
 * ({@link file://../autotile.ts}). 화면 하나에 같은 타일이 수십 장 깔리니 격자 주기가 눈에
 * 그대로 보인다. 이 레이어는 그 위에 **격자와 공명하지 않는 주기**로 데칼을 흩뿌려 반복감을
 * 깨고 지형에 서사를 준다.
 *
 * ## 메커니즘 / 테마 분리
 * 이 파일에는 **메커니즘만** 있다: 9개 실루엣의 기하, 합성 순서, 픽셀 격자 스냅, 결정론 해시,
 * 스프라이트 풀링. 색·밀도·셀 크기·kind 이름 같은 행성별 데이터는 전부
 * {@link file://./contracts/decals.ts} 의 `DecalTheme` 로 주입된다. 그래서 그리기 분기는
 * 팔레트 이름을 모르고 **색 슬롯 인덱스만** 읽는다 — `FILL.rockShade` 같은 직접 참조가
 * 남아 있으면 그 분기는 영원히 그 행성 것이 된다.
 *
 * ## 곱연산 — 이 레이어의 가독성 불변식
 * 데칼은 "덧칠한 도형"이 아니라 **지면의 국소 명도 변조**다. 알파 블렌드는
 * `바닥 × (1−α) + 소스 × α` 라 소스가 바닥보다 밝으면 **밝아진다** — 실제로 그 경로로
 * 어두운 지형 위에 갈색 얼룩이 떠올랐다. {@link DECAL_BLEND} 는 그 경로를 수식 수준에서
 * 없앤다: `바닥 × (1 − α + α×소스/255)` 는 괄호 안이 항상 ≤ 1 이다.
 *
 * ⚠️ 그래서 **팔레트의 의미가 "칠할 색"이 아니라 "곱할 배수"** 다(0xffffff = 변화 없음).
 * 상한/하한이 둘 다 필요하다: {@link MIN_MULTIPLIER_CHANNEL}(검은 구멍 금지) ·
 * {@link MAX_MULTIPLIER_CHANNEL}(안 보이는 데칼 금지).
 *
 * ## 픽셀 격자를 지형과 통일하는 세 규율
 * 지형은 원본 픽셀을 nearest 확대하므로 화면의 최소 단위는 **계단 블록**이다. design 좌표에
 * 안티에일리어싱으로 그린 텍스처를 임의 배율·임의 각도로 얹으면 한 화면에 두 개의 픽셀
 * 해상도가 공존한다("엔진이 그린 오버레이"로 읽히는 결정적 단서).
 *  1. **저해상도 베이크.** `resolution = 1/지형픽셀` 로 구워 1 텍셀 = 지형 원본 1픽셀.
 *  2. **정수 배율.** 경계가 또렷한 실루엣은 배율 1만 허용한다(`haze` 만 예외).
 *  3. **런타임 회전 금지.** 각도는 텍스처를 구울 때 기하에 넣는다({@link VARIANT_SPEC}).
 * 또 꼭짓점·선 굵기·반경을 전부 {@link snapPx} 로 지형 격자에 스냅해 굽는다.
 *
 * ## 층이 넷인 이유
 * 잔 데칼만 뿌리면 넓게 보면 바닥 톤이 균일해서 타일 되풀이가 그대로 읽힌다. 그래서 크기 층을
 * 셋(잔·큰·화면 절반급 얼룩) 두고, 거기에 **성격이 다른 네 번째 층**을 얹는다.
 *
 * ### 네 번째 층 — 암부의 큰 실루엣(부조)
 * 곱연산의 화면 차이는 `바닥밝기 × α × (1−배수)` 라 **어두운 곳에서는 거의 아무 일도 하지
 * 않는다**. 즉 곱연산 3층은 밝은 바닥 위에서만 일하고 암부에는 도달할 수 없는 구조다.
 * 세기를 올리는 대신 **일의 종류를 하나 더** 만든다: 200~400px 급 실루엣을 암부에만 놓고,
 * 하나를 스프라이트 **두 장**으로 그린다.
 *  - 그림자(`multiply`) : 드롭 섀도 + 그늘진 면. 바닥이 밝은 쪽에서만 일한다.
 *  - 하이라이트(`add`)  : 광원을 향한 **얇은 모서리** + 아주 옅은 면 워시.
 *
 * 가산은 밝히는 총량을 늘려 가독성 예산을 직접 갉아먹으므로 ㉠알파 상한을 곱연산의 1/3 로 두고
 * ({@link MAX_HIGHLIGHT_ALPHA}) ㉡화면 가산 잉크 총량에 상한을 두고({@link ADDITIVE_INK_BUDGET})
 * ㉢밝은 부분은 모서리에만 둔다.
 *
 * ⚠️ **하이라이트의 유무 자체가 테마 결정**이다. 가산이 필요한 것은 명암 이원성이 극단적인
 * 행성뿐이고, 밝은 설원이면 곱연산만으로 충분하며 가산은 화면을 뭉갠다.
 *
 * ### 광원은 **공유 필드**다
 * 광원 방향은 이 파일이 아니라 {@link EnvLightSpec}(`theme.light`)에서 온다. 지형광 레이어가
 * 같은 물리를 구현하고 있어서, 한쪽만 자기 값을 들고 있으면 화면에 태양이 둘이 된다.
 * 림/드롭섀도/면워시가 전부 이 하나에서 파생된다.
 *
 * **회전은 기하에 굽지만 광원은 굽지 않는다** — 변형 각도는 실루엣 모양에만 적용하고, 림·그림자
 * 오프셋은 회전 **뒤** 월드 좌표에서 더한다. 같은 이유로 하이라이트를 쓰는 격자는
 * **좌우반전을 금지**한다(반전은 광원의 x 성분을 거울로 뒤집는다).
 *
 * ## 결정론(ADR-0005)
 * `Math.random` 을 쓰지 않는다. 데칼의 존재·종류·변형·위치·배율·알파·틴트·좌우반전은 전부
 * `(ctx.seed, 정수 셀 좌표)` 의 순수 해시({@link file://./noise.ts})다. 텍스처 모양도 고정
 * 상수 시드로 굽는다.
 *
 * ## 월드 고정 · 성능
 * 스프라이트 위치는 셀의 월드 좌표 + 해시 지터로만 정해지고, 카메라는 컨테이너를 통째로
 * 평행이동할 뿐이다. 격자별 고정 스프라이트 풀을 쓰고 **카메라가 셀 경계를 넘을 때만** 재배치한다.
 * 텍스처는 `(렌더러, 테마)` 당 한 번만 굽고 캐시한다.
 */

import { Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../app.js';
import { DISPLAY_TILE, UPPER_THRESHOLD, terrainFieldAt } from '../autotile.js';
import { graphicsTierController } from '../graphicsRuntime.js';
import { effectGates, type QualityTier } from '../qualityTier.js';
import { graphicsSettings, type GraphicsSettings } from '../graphicsSettings.js';
import { hash3 } from './noise.js';
import { lightX, lightY, type EnvLightSpec } from './theme.js';
import { themeFor } from './themes/index.js';
import {
  RELIEF_VARIANT_SPEC,
  RELIEF_WOBBLE,
  SILHOUETTE_SPEC,
  VARIANTS,
  VARIANT_SPEC,
  allKinds,
  kindSpec,
  type DecalKindSpec,
  type DecalTheme,
  type GridSpec,
  type SiteGate,
} from './contracts/decals.js';
import type { EnvContext, EnvFrame, EnvLayer } from './types.js';

export type {
  DecalGlowPalette,
  DecalKindSpec,
  DecalTheme,
  GridSpec,
  Silhouette,
  SilhouetteSpec,
  SiteGate,
  SoftBlobSpec,
  VariantSpec,
} from './contracts/decals.js';
export {
  MAX_ADDITIVE_LUMA_GAIN,
  MAX_DECAL_ALPHA,
  MAX_HIGHLIGHT_ALPHA,
  MAX_MULTIPLIER_CHANNEL,
  MAX_MULTIPLIER_CHROMA,
  MIN_MULTIPLIER_CHANNEL,
  ORIENTATIONS,
  RELIEF_MAX_SPAN,
  RELIEF_MIN_SPAN,
  RELIEF_SILHOUETTES,
  RELIEF_VARIANT_SPEC,
  RELIEF_WOBBLE,
  SCALABLE_SILHOUETTES,
  SILHOUETTE_SPEC,
  VARIANTS,
  VARIANT_SPEC,
  allKinds,
  darkening,
  inkFill,
  kindSpec,
  lumaSum,
  validateDecalTheme,
} from './contracts/decals.js';

import { darkening, inkFill, lumaSum } from './contracts/decals.js';

const TAU = Math.PI * 2;

/** 데칼 종류 이름. 유니온이 아니라 문자열인 이유: 종류 목록은 **테마 데이터**다. */
export type DecalKind = string;

// ─────────────────────────────────────────────────────────────────────────────
// 해석된 테마 — 파생 지표를 한 번만 계산해 들고 다닌다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 레이어가 실제로 읽는 것. 테마 데이터 + **공유 광원** + 매번 다시 계산할 필요가 없는 파생값.
 *
 * 광원이 테마 안이 아니라 여기 나란히 있는 이유는, 그것이 데칼만의 값이 아니라
 * `EnvTheme.light` 라는 **레이어 간 공유 필드**이기 때문이다(복제하면 태양이 둘이 된다).
 */
export interface DecalEnv {
  readonly theme: DecalTheme;
  readonly light: EnvLightSpec;
  /** 지형 원본 픽셀 하나가 화면에서 차지하는 design px. **파생값**(하드코딩 금지). */
  readonly px: number;
  /** 텍스처를 구울 해상도. `1/px` 이면 텍셀 1개 = 지형 원본 픽셀 1개. */
  readonly bakeResolution: number;
  /** 광원 단위벡터(표면 → 광원). 화면 좌표라 y 양수 = 아래쪽. */
  readonly lx: number;
  readonly ly: number;
}

/** 테마와 공유 광원에서 실행 시 맥락을 만든다. */
export function decalEnv(theme: DecalTheme, light: EnvLightSpec): DecalEnv {
  const px = DISPLAY_TILE / theme.sourceTilePx;
  return { theme, light, px, bakeResolution: 1 / px, lx: lightX(light), ly: lightY(light) };
}

/** 종류 사양 조회. 없는 이름이면 던지지 않고 첫 종류로 떨어진다(배치 경로가 죽지 않게). */
export function kindShape(env: DecalEnv, kind: DecalKind): DecalKindSpec {
  return kindSpec(env.theme, kind) ?? (env.theme.kinds[0] as DecalKindSpec);
}

/** 이 종류가 부조(암부 랜드마크)인가. 실루엣 사양에서 **파생**된다. */
export function isRelief(env: DecalEnv, kind: DecalKind): boolean {
  return SILHOUETTE_SPEC[kindShape(env, kind).silhouette].relief;
}

/** 이 종류가 쓰는 변형 표. 그리기·배치·테스트가 전부 이 함수를 통해 본다. */
export function variantSpecFor(env: DecalEnv, kind: DecalKind): readonly { sizeMul: number; angle: number }[] {
  return isRelief(env, kind) ? RELIEF_VARIANT_SPEC : VARIANT_SPEC;
}

/** design 좌표를 지형 픽셀 격자에 스냅한다. 굽기 전 모든 꼭짓점·반경·굵기가 이걸 통과한다. */
export function snapPx(env: DecalEnv, v: number): number {
  return Math.round(v / env.px) * env.px;
}

/** 최소 1텍셀은 남기는 스냅(가는 선이 0으로 사라지는 것을 막는다). */
function snapMin(env: DecalEnv, v: number): number {
  return Math.max(env.px, snapPx(env, v));
}

// ─────────────────────────────────────────────────────────────────────────────
// 합성 모드 — 이 레이어의 가독성 불변식은 여기서 나온다
// ─────────────────────────────────────────────────────────────────────────────

/** 합성 모드 이름(테스트가 참조하는 축). */
export type DecalBlend = 'multiply' | 'normal' | 'add';

/**
 * **데칼의 합성 모드.** `multiply` 는 결과가 바닥보다 밝아질 수 없음을 수식으로 보장한다
 * ({@link compositeChannel} 참조). `normal` 로 되돌리면 "밝게 뜨는 갈색 얼룩"이 재발하며,
 * 테스트가 그 회귀를 배경 스윕으로 잡는다.
 */
export const DECAL_BLEND: DecalBlend = 'multiply';

/**
 * **부조 하이라이트의 합성 모드.** 곱연산은 암부에서 구조적으로 아무 일도 못 하므로
 * 어두운 곳에 형태를 세우려면 **더하는 수밖에 없다**. 대신 이 경로는 가독성 예산을 직접 쓰므로
 * 알파·색·총량 세 상한으로 묶여 있다.
 */
export const HIGHLIGHT_BLEND: DecalBlend = 'add';

/**
 * 한 채널의 합성 결과(0~255). Pixi 의 프리멀티플라이드 블렌드를 그대로 옮긴 것이다.
 *
 *  - `multiply` : dst·(1 − α + α·src) . 괄호 안 ≤ 1 이므로 **항상 ≤ dst**.
 *  - `normal`   : src·α + dst·(1−α) . src > dst 면 **밝아진다** ← 결함 경로.
 *  - `add`      : dst + src·α . **항상 ≥ dst** — 하이라이트가 타는 경로이며 상한 셋으로 묶는다.
 */
export function compositeChannel(
  dst: number,
  src: number,
  alpha: number,
  blend: DecalBlend,
): number {
  if (blend === 'multiply') return dst * (1 - alpha + (alpha * src) / 255);
  if (blend === 'add') return Math.min(255, dst + src * alpha);
  return dst * (1 - alpha) + src * alpha;
}

/**
 * 배경 RGB 위에 (fill × tint) 를 alpha 로 합성했을 때의 R+G+B 합(0~765).
 * 테스트가 "어떤 배경·어떤 종류·어떤 알파·어떤 틴트에서도 밝아지지 않는다"를 이 함수로 증명한다.
 */
export function compositeLumaSum(
  backdrop: readonly [number, number, number],
  fill: number,
  alpha: number,
  tint: number,
  blend: DecalBlend = DECAL_BLEND,
): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const shift = 16 - i * 8;
    const src = (((fill >> shift) & 0xff) * ((tint >> shift) & 0xff)) / 255;
    sum += compositeChannel(backdrop[i] ?? 0, src, alpha, blend);
  }
  return sum;
}

/**
 * 화면 한 장이 가산으로 더할 수 있는 잉크 총량(0~765 단위, {@link estimateHighlightInk} 와 같은
 * 척도). 곱연산 3층의 실측 기여가 4.0 언저리이므로, 가산이 그 20% 를 넘으면 "절제된
 * 하이라이트"가 아니라 "화면을 밝히는 레이어"가 된다.
 */
export const ADDITIVE_INK_BUDGET = 0.8;

/** 모양 생성용 **고정** 해시 시드. 런 시드와 무관해야 텍스처를 런 사이에 재사용할 수 있다. */
const SHAPE_SEED = 0x5eed1ce;

/** 뷰포트 밖으로 유지하는 셀 마진 링(팝인 방지). */
export const DECAL_MARGIN = 1;

// ─────────────────────────────────────────────────────────────────────────────
// 지형 게이트
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 지형 필드 임계에서 얼마나 더 들어가야 게이트를 통과하는가. 0이면 경계선에 딱 붙은 자리도
 * 통과해 실루엣의 절반이 반대쪽 지형에 걸친다.
 */
export const RELIEF_FIELD_MARGIN = 0.05;

/** 발자국 검사점 오프셋(반경 비율). 중심 + 상하좌우 — 큰 실루엣은 3~6타일을 덮는다. */
const RELIEF_PROBES: readonly number[] = [0, 0, -0.62, 0, 0.62, 0, 0, -0.62, 0, 0.62];

/**
 * **지형 게이트 판정.** `autotile` 의 {@link terrainFieldAt}/{@link UPPER_THRESHOLD} 를 **import**
 * 해서 쓴다 — 값을 복제하면 타일셋 레인이 임계를 옮겼을 때 실루엣만 다른 경계를 본다.
 *
 * 테마가 `'lower'` 같은 **타일 대역 리터럴** 대신 원하는 성질({@link SiteGate})을 선언하는 이유:
 * "하부 지형 = 어둡다"는 카르곤 타일셋의 성질이지 보편 사실이 아니다. 밝은 눈밭이 하부인
 * 행성에서는 같은 리터럴이 정반대를 뜻하게 된다.
 *
 * @param radius 실루엣 발자국 **반경**(design px). 검사점 간격이 여기서 나온다.
 */
export function siteMatches(
  gate: SiteGate,
  seed: number,
  worldX: number,
  worldY: number,
  radius: number,
): boolean {
  const dark = gate === 'darkTerrain';
  const limit = dark ? UPPER_THRESHOLD - RELIEF_FIELD_MARGIN : UPPER_THRESHOLD + RELIEF_FIELD_MARGIN;
  for (let i = 0; i + 1 < RELIEF_PROBES.length; i += 2) {
    const px = worldX + (RELIEF_PROBES[i] ?? 0) * radius;
    const py = worldY + (RELIEF_PROBES[i + 1] ?? 0) * radius;
    const f = terrainFieldAt(seed, px / DISPLAY_TILE, py / DISPLAY_TILE);
    if (dark ? f >= limit : f <= limit) return false;
  }
  return true;
}

/** 실루엣 발자국 반경(design px) — 지형 게이트의 검사 간격이자 대역 검증의 기준. */
export function reliefFootprintRadius(env: DecalEnv, kind: DecalKind, variant: number): number {
  const shape = kindShape(env, kind);
  const table = variantSpecFor(env, kind);
  const spec = table[variant] ?? table[0];
  return shape.r * (spec?.sizeMul ?? 1) * Math.max(shape.elong, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 배치 — 결정론의 정본
// ─────────────────────────────────────────────────────────────────────────────

/** 해시 축(k) 상수. 같은 셀에서 뽑는 독립 속성들이 서로 상관되지 않게 분리한다. */
const K_PRESENT = 0;
const K_JITTER_X = 1;
const K_JITTER_Y = 2;
const K_KIND = 3;
const K_SCALE = 5;
const K_ALPHA = 6;
const K_TINT = 7;
const K_FLIP = 8;
const K_VARIANT = 9;
const K_GLOW = 10;

/** 한 셀의 데칼 배치 결과(가변 out 객체로 재사용 — 재배치 시 할당을 만들지 않는다). */
export interface DecalPlacement {
  present: boolean;
  kind: DecalKind;
  variant: number;
  worldX: number;
  worldY: number;
  /**
   * 이 데칼의 겉보기 각도(rad). **런타임에 스프라이트를 돌리지 않는다** — 변형 텍스처에 이미
   * 구워져 있는 각도를 알려 주는 파생 필드다(방향 분포 검증용).
   */
  rotation: number;
  /** 정수 배율. 텍셀 한 변 = `지형 픽셀 × scale`. */
  scale: number;
  alpha: number;
  tint: number;
  /** 좌우 반전(스케일 x 부호). 각도 표를 π~2π 로 확장한다. */
  flip: boolean;
  /**
   * 가산 하이라이트 스프라이트의 알파. 격자에 {@link GridSpec.highlight} 가 없으면 **0** 이고
   * 그때는 하이라이트 스프라이트가 아예 나가지 않는다.
   */
  glowAlpha: number;
}

/** 재사용 가능한 빈 배치 객체. */
export function emptyPlacement(): DecalPlacement {
  return {
    present: false,
    kind: '',
    variant: 0,
    worldX: 0,
    worldY: 0,
    rotation: 0,
    scale: 1,
    alpha: 1,
    tint: 0xffffff,
    flip: false,
    glowAlpha: 0,
  };
}

/**
 * 배치의 겉보기 방향 계급(0 ~ {@link ORIENTATIONS}−1). 좌우반전은 각도를 거울로 뒤집으므로
 * 변형 각도와 독립된 방향을 만든다.
 */
export function orientationClass(p: DecalPlacement): number {
  return p.variant + (p.flip ? VARIANTS : 0);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 배열에서 해시로 하나 고르기(경계 방어 포함). */
function pick<T>(arr: readonly T[], t: number): T {
  const i = Math.min(arr.length - 1, Math.max(0, Math.floor(t * arr.length)));
  return arr[i] ?? (arr[0] as T);
}

/**
 * **결정론의 정본.** 셀 `(cx, cy)` 의 데칼을 `(seed, cx, cy)` 의 순수 함수로 계산한다.
 * 카메라·프레임·시간이 입력에 없으므로 월드 고정과 리플레이 재현이 구조적으로 보장된다.
 *
 * @param densityScale 티어 밀도 배율. 존재 판정에만 관여한다 — 그래야 티어가 바뀔 때
 *   "다른 데칼"이 아니라 "솎아진 같은 데칼"이 돼 화면이 튀지 않는다.
 * @param out 결과를 담을 객체(재사용). 생략하면 새로 만든다.
 */
export function decalAt(
  env: DecalEnv,
  spec: GridSpec,
  seed: number,
  cx: number,
  cy: number,
  densityScale = 1,
  out: DecalPlacement = emptyPlacement(),
): DecalPlacement {
  const s = seed ^ spec.salt;
  out.present = hash3(s, cx, cy, K_PRESENT) < spec.density * densityScale;
  if (!out.present) return out;
  // 지터는 셀 안 10%~90% 구간 — 셀 경계에 몰려 격자선이 드러나는 것을 막는다.
  // 그 뒤 **지형 픽셀 격자로 스냅**한다: 데칼 텍셀 경계가 지형 픽셀 경계와 어긋나면
  // nearest 샘플링이 블록을 반 픽셀씩 잘라 "다른 해상도"로 읽힌다.
  const jx = lerp(0.1, 0.9, hash3(s, cx, cy, K_JITTER_X));
  const jy = lerp(0.1, 0.9, hash3(s, cx, cy, K_JITTER_Y));
  out.worldX = snapPx(env, (cx + jx) * spec.cell);
  out.worldY = snapPx(env, (cy + jy) * spec.cell);
  out.kind = pick(spec.kinds, hash3(s, cx, cy, K_KIND));
  out.variant = Math.min(VARIANTS - 1, Math.floor(hash3(s, cx, cy, K_VARIANT) * VARIANTS));
  out.rotation = variantSpecFor(env, out.kind)[out.variant]?.angle ?? 0;
  // 정수 배율만 뽑는다(텍셀 크기가 지형 픽셀의 정수배로 유지된다).
  const steps = spec.maxScale - spec.minScale + 1;
  out.scale = spec.minScale + Math.min(steps - 1, Math.floor(hash3(s, cx, cy, K_SCALE) * steps));
  out.alpha = lerp(spec.minAlpha, spec.maxAlpha, hash3(s, cx, cy, K_ALPHA));
  out.tint = pick(env.theme.tints, hash3(s, cx, cy, K_TINT));
  // 하이라이트를 쓰는 격자는 좌우반전을 **못 쓴다** — 반전은 광원 x 성분을 거울로 뒤집는다.
  out.flip = spec.noFlip === true ? false : hash3(s, cx, cy, K_FLIP) < 0.5;
  out.glowAlpha =
    spec.highlight === undefined
      ? 0
      : lerp(spec.highlight.minAlpha, spec.highlight.maxAlpha, hash3(s, cx, cy, K_GLOW));
  // 지형 게이트는 **마지막**이다: 종류·변형이 정해져야 발자국 반경을 알고, 반경을 알아야
  // 검사점 간격이 정해진다. 게이트에 걸려도 다른 속성은 그대로 남으므로(존재만 취소)
  // 티어 밀도 배율처럼 "솎아진 같은 데칼" 성질이 유지된다.
  if (spec.siteGate !== undefined) {
    const rad = reliefFootprintRadius(env, out.kind, out.variant) * out.scale;
    if (!siteMatches(spec.siteGate, seed, out.worldX, out.worldY, rad)) out.present = false;
  }
  return out;
}

/** 티어별 데칼 밀도 배율. 저티어일수록 솎아낸다(스프라이트 수 = 드로콜 예산). */
export function densityForTier(tier: QualityTier): number {
  return tier === 'low' ? 0.45 : tier === 'med' ? 0.8 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 기하 프리미티브
// ─────────────────────────────────────────────────────────────────────────────

/** 굽는 시점의 회전(코사인·사인 캐시). 런타임 회전 대신 여기서 기하에 적용한다. */
interface Rot {
  readonly c: number;
  readonly s: number;
}

/** 로컬 좌표를 회전 → 지형 격자 스냅 순서로 꼭짓점 배열에 밀어 넣는다. */
function emit(env: DecalEnv, pts: number[], x: number, y: number, R: Rot): void {
  pts.push(snapPx(env, x * R.c - y * R.s), snapPx(env, x * R.s + y * R.c));
}

/** 각진 n각형의 **스냅된 꼭짓점**(회전 적용 후). 부조는 이 배열을 재가공해 림/그림자를 만든다. */
function ngonPoints(
  env: DecalEnv,
  s: number,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  wob: number,
  elong: number,
  R: Rot,
): number[] {
  const pts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU;
    const rr = r * (1 - wob + wob * 2 * hash3(SHAPE_SEED, s, i, 11));
    emit(env, pts, cx + Math.cos(a) * rr * elong, cy + Math.sin(a) * rr, R);
  }
  return pts;
}

/** 각진 n각형(스냅된 꼭짓점). `wob` 으로 반경을 흔들어 유기적으로 만든다. */
function ngon(
  env: DecalEnv,
  g: Graphics,
  s: number,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  wob: number,
  elong: number,
  R: Rot,
  color: number,
  alpha = 1,
): void {
  g.poly(ngonPoints(env, s, cx, cy, r, sides, wob, elong, R)).fill({ color, alpha });
}

/**
 * 꼭짓점 구름을 **월드 좌표에서** 평행이동한다(스냅 유지).
 *
 * ⚠️ 회전 **뒤**에 적용한다는 것이 핵심이다. 광원은 실루엣과 함께 돌면 안 되므로, 림·드롭섀도
 * 오프셋은 {@link emit} 의 회전 경로를 타지 않고 여기서 더해진다.
 */
function shiftPoints(env: DecalEnv, pts: readonly number[], dx: number, dy: number): number[] {
  const sx = snapPx(env, dx);
  const sy = snapPx(env, dy);
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push((pts[i] ?? 0) + sx, (pts[i + 1] ?? 0) + sy);
  return out;
}

/** 꼭짓점 구름을 `(ccx, ccy)` 기준으로 축소(스냅 유지). 그늘진 안쪽 면을 만드는 데 쓴다. */
function scalePoints(env: DecalEnv, pts: readonly number[], ccx: number, ccy: number, k: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    out.push(
      snapPx(env, ccx + ((pts[i] ?? 0) - ccx) * k),
      snapPx(env, ccy + ((pts[i + 1] ?? 0) - ccy) * k),
    );
  }
  return out;
}

/** 회전 후 조각 중심(부조는 조각마다 광원 판정을 따로 해야 한다). */
function rotX(env: DecalEnv, x: number, y: number, R: Rot): number {
  return snapPx(env, x * R.c - y * R.s);
}
function rotY(env: DecalEnv, x: number, y: number, R: Rot): number {
  return snapPx(env, x * R.s + y * R.c);
}

/** 반경 감쇠 얼룩의 기본 겹 수와 겹당 알파. 중심 누적 = `1 − (1−k)^N`. 테마가 덮어쓸 수 있다. */
const SOFT_RINGS = 16;
const SOFT_RING_ALPHA = 0.17;
const SOFT_WOBBLE = 0.22;

/**
 * **경계가 안 보이는 큰 얼룩.** 같은 각도 흔들림 프로파일을 공유하는 동심 폴리곤 여러 겹을
 * 바깥→안 순으로 낮은 알파로 겹쳐 칠한다.
 *
 * 왜 겹마다 흔들림을 새로 뽑지 않는가: 겹마다 독립으로 흔들면 안쪽 겹이 바깥 겹을 삐져나와
 * 가장자리에 톱니가 생긴다. 프로파일을 공유하면 **실루엣은 불규칙한데 겹은 정확히 중첩**된다.
 */
function softBlob(
  env: DecalEnv,
  g: Graphics,
  s: number,
  r: number,
  elongX: number,
  R: Rot,
  color: number,
  rings = SOFT_RINGS,
  ringAlpha = SOFT_RING_ALPHA,
  wobble = SOFT_WOBBLE,
): void {
  const points = 26;
  const profile: number[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * TAU;
    const w1 = hash3(SHAPE_SEED, s, 0, 51) * TAU;
    const w2 = hash3(SHAPE_SEED, s, 1, 51) * TAU;
    const d = Math.sin(a * 2 + w1) * 0.6 + Math.sin(a * 3 + w2) * 0.4;
    profile.push(1 + wobble * d);
  }
  for (let ring = rings; ring >= 1; ring--) {
    const t = ring / rings;
    const pts: number[] = [];
    for (let i = 0; i < points; i++) {
      const a = (i / points) * TAU;
      const rr = r * t * (profile[i] ?? 1);
      emit(env, pts, Math.cos(a) * rr * elongX, Math.sin(a) * rr, R);
    }
    g.poly(pts).fill({ color, alpha: ringAlpha });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 부조 기하 — 그림자 텍스처와 하이라이트 텍스처가 **같은 조각 목록**에서 나온다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 굽기 프레임 반경 배수. 그림자·하이라이트 두 텍스처가 **정확히 같은 크기·같은 중심**으로
 * 구워지게 하는 장치다: 하이라이트 기하는 본체의 부분집합이라, 프레임이 없으면 두 텍스처의
 * `generateTexture` 바운드가 달라지고 앵커 0.5 정렬이 어긋나 하이라이트가 실루엣에서 미끄러진다.
 */
const RELIEF_FRAME_MUL = 1.25;

/**
 * 굽기 프레임의 색. 알파 0으로 칠하므로 화면에는 영향이 없지만 **기하 바운드에는 들어간다**.
 * 테스트가 본체/테두리 반경을 잴 때 이 색을 걸러야 하므로 상수로 export 한다.
 */
export const BAKE_FRAME_COLOR = 0x000001;

/**
 * **면 워시 겹.** 광원 쪽으로 밀린 축소 폴리곤 두 장으로 "빛을 받는 면"을 만든다.
 *
 * 예산의 대부분을 여기가 먹는다 — 림은 둘레 × 2텍셀이라 면적이 미미하고, 워시는 발자국 면적에
 * 비례한다. 그래서 **알파를 한 자릿수 퍼센트대로 누르고 발자국도 안쪽으로 당겼다**. 세기를
 * 올리고 싶으면 여기가 아니라 림을 건드려라(면적당 비용이 10배 이상 싸다).
 *
 * ⚠️ {@link estimateHighlightInk} 가 이 표를 **직접 읽는다**.
 */
export const RELIEF_WASH: readonly { scale: number; alpha: number; push: number }[] = [
  { scale: 0.8, alpha: 0.22, push: 0.2 },
  { scale: 0.5, alpha: 0.26, push: 0.36 },
];

/** 부조 조각 하나(회전이 이미 적용된 꼭짓점 + 회전 후 중심 + 반경). */
interface ReliefPiece {
  readonly pts: readonly number[];
  readonly ccx: number;
  readonly ccy: number;
  readonly r: number;
}

/**
 * 부조 실루엣의 조각 목록. **그림자 베이크와 하이라이트 베이크가 이 함수 하나를 공유한다** —
 * 두 곳에서 따로 만들면 언젠가 갈라지고, 갈라지면 빛이 실루엣에서 미끄러진다(눈으로는
 * "떠 있다"로 읽히는 증상).
 */
function reliefPieces(env: DecalEnv, kind: DecalKind, v: number): ReliefPiece[] {
  const table = variantSpecFor(env, kind);
  const spec = table[v] ?? table[0];
  const angle = spec?.angle ?? 0;
  const R: Rot = { c: Math.cos(angle), s: Math.sin(angle) };
  const s = v * 977 + 13;
  const shape = kindShape(env, kind);
  const r = snapMin(env, shape.r * (spec?.sizeMul ?? 1));
  const el = shape.elong;
  const out: ReliefPiece[] = [];
  const push = (cx: number, cy: number, rr: number, sides: number, e: number, k: number): void => {
    out.push({
      pts: ngonPoints(env, s + k, cx, cy, rr, sides, RELIEF_WOBBLE, e, R),
      ccx: rotX(env, cx, cy, R),
      ccy: rotY(env, cx, cy, R),
      r: rr,
    });
  };

  if (shape.silhouette === 'boulder') {
    // 큰 덩어리 하나 + 발치에 흩어진 파편 넷. "무너진 덩어리"의 읽히는 형태.
    push(0, 0, r, 9, el, 0);
    for (let i = 0; i < 4; i++) {
      const a = hash3(SHAPE_SEED, s, i, 81) * TAU;
      const d = r * el * (0.5 + 0.22 * hash3(SHAPE_SEED, s, i, 82));
      const rr = snapMin(env, r * (0.13 + 0.07 * hash3(SHAPE_SEED, s, i, 83)));
      push(Math.cos(a) * d, Math.sin(a) * d * 0.8, rr, 6, 1, 10 + i);
    }
  } else if (shape.silhouette === 'ridge') {
    // 등줄기. 가운데가 두껍고 양끝으로 가늘어지는 구슬 사슬 → 방향이 읽힌다.
    const n = 7;
    const A = snapPx(env, r * el * 0.86);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const taper = 0.5 - 0.34 * Math.abs(2 * t - 1) ** 1.4;
      const rr = snapMin(env, r * taper * (0.86 + 0.28 * hash3(SHAPE_SEED, s, i, 84)));
      const wy = (hash3(SHAPE_SEED, s, i, 85) - 0.5) * r * 0.34;
      push(-A + 2 * A * t, wy, rr, 7, 1, 20 + i);
    }
  } else {
    // 적층: 낮게 퍼진 바닥 층 위에 좁은 층이 얹힌 더미.
    const layers = 3;
    for (let i = 0; i < layers; i++) {
      const k = 1 - i * 0.29;
      const rr = snapMin(env, r * k);
      const lift = snapPx(env, -r * 0.16 * i);
      push(snapPx(env, (hash3(SHAPE_SEED, s, i, 86) - 0.5) * r * 0.18), lift, rr, 8, el, 30 + i);
    }
  }
  return out;
}

/** 이 변형의 굽기 프레임 반경(그림자·하이라이트 공통). */
function reliefFrameHalf(env: DecalEnv, kind: DecalKind, v: number): number {
  return snapPx(env, reliefFootprintRadius(env, kind, v) * RELIEF_FRAME_MUL);
}

/**
 * 두 텍스처의 바운드를 같게 만드는 투명 프레임.
 *
 * `rect` 이 아니라 `poly` 인 이유: Pixi 의 `Rectangle` shape 에는 `points` 배열이 없어서
 * 구운 기하를 읽는 테스트가 프레임의 크기를 **잴 수 없다**. 이 프레임의 존재 목적이 바로
 * "두 텍스처의 바운드가 같다"를 성립시키는 것이므로, 그걸 검증할 수 없는 형태로 그리면
 * 장치와 검증이 따로 논다.
 */
function drawFrame(g: Graphics, half: number): void {
  g.poly([-half, -half, half, -half, half, half, -half, half]).fill({
    color: BAKE_FRAME_COLOR,
    alpha: 0,
  });
}

/**
 * 광원을 향한 모서리만 골라 굵기 2텍셀로 긋는다. **얇아야 한다** — 넓히면 총 광량이 는다.
 *
 * 판정은 **모서리 중점의 조각 중심 대비 방향**과 광원 벡터의 내적이다(폴리곤 감김 방향에
 * 의존하지 않는다 — 감김이 뒤집히면 법선 부호가 통째로 뒤집혀 빛이 반대편에 붙는다).
 *
 * @returns 실제로 그린 모서리가 있었는가(빈 패스에 `stroke` 를 걸지 않기 위한 신호).
 */
function strokeLitEdges(
  env: DecalEnv,
  g: Graphics,
  piece: ReliefPiece,
  color: number,
  alpha: number,
): boolean {
  const pts = piece.pts;
  const n = pts.length / 2;
  let drew = false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = pts[2 * i] ?? 0;
    const y0 = pts[2 * i + 1] ?? 0;
    const x1 = pts[2 * j] ?? 0;
    const y1 = pts[2 * j + 1] ?? 0;
    const mx = (x0 + x1) * 0.5 - piece.ccx;
    const my = (y0 + y1) * 0.5 - piece.ccy;
    if (mx * env.lx + my * env.ly <= 0) continue;
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    drew = true;
  }
  if (drew) g.stroke({ color, width: env.px * 2, alpha, cap: 'butt', join: 'miter' });
  return drew;
}

/**
 * **부조의 곱연산 층.** 드롭 섀도(광원 반대쪽) → 본체 → 그늘진 면(광원 반대쪽으로 치우친 안쪽).
 * 암부에서는 이 층이 거의 아무 일도 하지 않는다(그래서 하이라이트가 있다) — 여기서 버는 것은
 * 실루엣이 **덜 어두운 지면에 걸쳤을 때의 접지감**이다.
 *
 * 색은 슬롯으로만 읽는다: `slots[0]` = 본체, `slots[1]` = 그늘. 실루엣 이름으로 팔레트를
 * 고르던 분기가 여기서 사라졌다.
 */
function drawReliefBase(env: DecalEnv, g: Graphics, kind: DecalKind, v: number): void {
  drawFrame(g, reliefFrameHalf(env, kind, v));
  const shape = kindShape(env, kind);
  const body = shape.slots[0] ?? 0xffffff;
  const shade = shape.slots[1] ?? body;
  /** 드롭 섀도가 광원 반대쪽으로 밀리는 거리(텍셀 3개). */
  const drop = env.px * 3;
  const pieces = reliefPieces(env, kind, v);
  for (const p of pieces) {
    g.poly(shiftPoints(env, p.pts, -env.lx * drop, -env.ly * drop)).fill({
      color: env.theme.ground,
      alpha: 1,
    });
  }
  for (const p of pieces) g.poly([...p.pts]).fill({ color: body, alpha: 1 });
  for (const p of pieces) {
    const inner = scalePoints(env, p.pts, p.ccx, p.ccy, 0.72);
    g.poly(shiftPoints(env, inner, -env.lx * p.r * 0.24, -env.ly * p.r * 0.24)).fill({
      color: shade,
      alpha: 1,
    });
  }
}

/**
 * **부조의 가산 층.** 광원을 향한 면의 아주 옅은 워시(넓게·거의 안 보이게) → 광원을 향한
 * 모서리(얇게·또렷하게). 암부에서 형태를 세우는 것은 사실상 이 모서리 하나다.
 *
 * 순서가 중요하다: 워시를 먼저 깔고 모서리를 나중에 그어야 모서리가 워시에 먹히지 않는다.
 */
function drawReliefGlow(env: DecalEnv, g: Graphics, kind: DecalKind, v: number): void {
  const glow = env.theme.glow;
  if (glow === undefined) return;
  drawFrame(g, reliefFrameHalf(env, kind, v));
  const pieces = reliefPieces(env, kind, v);
  for (const p of pieces) {
    for (const w of RELIEF_WASH) {
      const poly = scalePoints(env, p.pts, p.ccx, p.ccy, w.scale);
      g.poly(shiftPoints(env, poly, env.lx * p.r * w.push, env.ly * p.r * w.push)).fill({
        color: glow.face,
        alpha: w.alpha,
      });
    }
  }
  for (const p of pieces) strokeLitEdges(env, g, p, glow.rim, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 실루엣 그리기 — 색은 전부 슬롯 인덱스로만 읽는다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 종류별 모양. **텍스처는 거의 불투명하게 굽는다** — 세기 손잡이는 스프라이트 alpha 하나뿐이어야
 * 한다(fill alpha 와 스프라이트 alpha 가 곱해지면 실효가 한 자릿수 퍼센트로 사라진다).
 *
 * **export 하는 이유**: 테스트가 캔버스 없이 `Graphics.context.instructions` 로 구운 기하를
 * 직접 읽어 ①모든 꼭짓점이 지형 픽셀 격자 위에 있고 ②접지 테두리가 본체보다 바깥에 있으며
 * ③변형마다 주축 각도가 실제로 다르고 ④실루엣마다 그리기 분기가 다름을 검증한다. 렌더러가
 * 필요한 스크린샷 없이는 달리 확인할 방법이 없다.
 *
 * @param v 변형 인덱스. 변형 표의 크기 배수와 **회전각**을 여기서 기하에 넣는다.
 */
export function drawDecalInto(env: DecalEnv, g: Graphics, kind: DecalKind, v: number): void {
  const table = variantSpecFor(env, kind);
  const spec = table[v] ?? table[0];
  const angle = spec?.angle ?? 0;
  const R: Rot = { c: Math.cos(angle), s: Math.sin(angle) };
  const s = v * 977 + 13;
  const shape = kindShape(env, kind);
  const r = snapMin(env, shape.r * (spec?.sizeMul ?? 1));
  const el = shape.elong;
  const slot = (i: number): number => shape.slots[i] ?? shape.slots[0] ?? 0xffffff;
  const ground = env.theme.ground;
  /** 접지 음영 테두리 두께(텍셀 1개). 가장자리가 안쪽보다 어두우면 "패인 자국"으로 읽힌다. */
  const rim = env.px;

  switch (shape.silhouette) {
    case 'flow': {
      // 머리에서 꼬리로 가늘어지는 자국. 대칭 타원이 아니라 **방향이 읽히는 실루엣**이 목표다.
      const n = 8;
      const spineX = (t: number): number => -r * el + 2 * r * el * t;
      const spineY = (t: number): number =>
        Math.sin(t * 3.1 + hash3(SHAPE_SEED, s, 0, 61) * TAU) * r * 0.3;
      // 접지 테두리 두께는 **스냅 뒤에** 더한다. 스냅 안에서 더하면 반올림이 테두리를 삼켜
      // 테두리와 본체가 정확히 같은 반경으로 구워질 수 있다(구운 기하 테스트가 잡는다).
      const bead = (t: number): number =>
        snapMin(env, r * (0.92 - 0.74 * t) * (0.8 + 0.4 * hash3(SHAPE_SEED, s, Math.round(t * 100), 62)));
      // 1) 접지 테두리(1텍셀 크게, 가장 진하게) → 2) 본체 → 3) 심 → 4) 코어
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        ngon(env, g, s + i, spineX(t), spineY(t), bead(t) + rim, 8, 0.18, 1, R, ground);
      }
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        ngon(env, g, s + i, spineX(t), spineY(t), bead(t), 8, 0.18, 1, R, slot(0));
      }
      for (let i = 0; i < 5; i++) {
        const t = (i / 4) * 0.62;
        ngon(env, g, s + 40 + i, spineX(t), spineY(t), snapMin(env, bead(t) * 0.55), 7, 0.22, 1, R, slot(1));
      }
      for (let i = 0; i < 3; i++) {
        const t = (i / 2) * 0.34;
        ngon(env, g, s + 80 + i, spineX(t), spineY(t), snapMin(env, bead(t) * 0.26), 6, 0.25, 1, R, slot(2));
      }
      break;
    }
    case 'ring': {
      // 함몰: 바깥 접지 테두리 → 림(가장 옅음) → 바닥 → 심연. 안쪽이 어두워야 링으로 읽힌다.
      ngon(env, g, s, 0, 0, snapMin(env, r + rim), 12, 0.1, 1, R, ground);
      ngon(env, g, s, 0, 0, r, 12, 0.1, 1, R, slot(0));
      ngon(env, g, s + 1, 0, 0, snapMin(env, r * 0.74), 12, 0.14, 1, R, slot(1));
      const ox = (hash3(SHAPE_SEED, s, 2, 63) - 0.5) * r * 0.2;
      const oy = (hash3(SHAPE_SEED, s, 3, 63) - 0.5) * r * 0.2;
      ngon(env, g, s + 2, ox, oy, snapMin(env, r * 0.34), 10, 0.2, 1, R, slot(2));
      break;
    }
    case 'splatter': {
      // 중심 덩어리 + 한쪽으로 튄 위성 방울. 방울이 이 실루엣의 정체성이다.
      const bias = hash3(SHAPE_SEED, s, 0, 71) * TAU;
      const core = snapMin(env, r * 0.46);
      ngon(env, g, s, 0, 0, snapMin(env, core + rim), 9, 0.34, el, R, ground);
      ngon(env, g, s, 0, 0, core, 9, 0.34, el, R, slot(0));
      for (let i = 0; i < 10; i++) {
        const a = bias + (hash3(SHAPE_SEED, s, i, 72) - 0.5) * 2.3;
        const d = r * (0.6 + 0.8 * hash3(SHAPE_SEED, s, i, 73));
        const rr = snapMin(env, r * (0.05 + 0.15 * hash3(SHAPE_SEED, s, i, 74)) * (1 - d / (1.6 * r)));
        const dx = Math.cos(a) * d * el;
        const dy = Math.sin(a) * d;
        ngon(env, g, s + i, dx, dy, snapMin(env, rr + rim), 6, 0.3, 1, R, ground);
        ngon(env, g, s + i, dx, dy, rr, 6, 0.3, 1, R, slot(1));
      }
      break;
    }
    case 'crack': {
      // 각진 선망. 겉선(2텍셀)+코어(1텍셀) 이중선이라 홈처럼 읽힌다. 전부 격자 스냅.
      const len = r * 2;
      const seg = 7;
      const xs: number[] = [];
      const ys: number[] = [];
      let x = -len / 2;
      let y = 0;
      xs.push(x);
      ys.push(y);
      for (let i = 1; i <= seg; i++) {
        x += len / seg;
        y += (hash3(SHAPE_SEED, s, i, 21) - 0.5) * len * 0.22;
        xs.push(x);
        ys.push(y);
      }
      const stroke = (w: number, color: number, alpha: number): void => {
        g.moveTo(
          snapPx(env, (xs[0] ?? 0) * R.c - (ys[0] ?? 0) * R.s),
          snapPx(env, (xs[0] ?? 0) * R.s + (ys[0] ?? 0) * R.c),
        );
        for (let i = 1; i < xs.length; i++) {
          const px = xs[i] ?? 0;
          const py = ys[i] ?? 0;
          g.lineTo(snapPx(env, px * R.c - py * R.s), snapPx(env, px * R.s + py * R.c));
        }
        g.stroke({ color, width: w, alpha, cap: 'butt', join: 'miter' });
      };
      stroke(env.px * 2, slot(0), 1);
      stroke(env.px, slot(1), 1);
      // 가지 5갈래 + 떨어진 조각 3개 → 균열 밀도를 개수 상한 없이 올린다.
      for (let b = 0; b < 8; b++) {
        const detached = b >= 5;
        const t = detached ? 0.15 + 0.3 * hash3(SHAPE_SEED, s, b, 25) : 0.14 + 0.19 * b;
        const bx = -len / 2 + len * (detached ? 0.1 + 0.8 * hash3(SHAPE_SEED, s, b, 26) : t);
        const by = (hash3(SHAPE_SEED, s, b, 22) - 0.5) * len * (detached ? 0.5 : 0.14);
        const ang = (hash3(SHAPE_SEED, s, b, 23) - 0.5) * 2.8;
        const bl = len * (0.12 + 0.16 * hash3(SHAPE_SEED, s, b, 24));
        const ex = bx + Math.cos(ang) * bl;
        const ey = by + Math.sin(ang) * bl;
        g.moveTo(snapPx(env, bx * R.c - by * R.s), snapPx(env, bx * R.s + by * R.c));
        g.lineTo(snapPx(env, ex * R.c - ey * R.s), snapPx(env, ex * R.s + ey * R.c));
        g.stroke({ color: slot(1), width: env.px, alpha: 1, cap: 'butt' });
      }
      break;
    }
    case 'cluster': {
      // 각진 파편 무더기. 조각마다 1텍셀 접지 그림자를 아래로 깔아 지면에 놓인 것으로 읽힌다.
      for (let i = 0; i < 12; i++) {
        const a = hash3(SHAPE_SEED, s, i, 31) * TAU;
        const d = Math.sqrt(hash3(SHAPE_SEED, s, i, 32)) * r;
        const gx = Math.cos(a) * d;
        const gy = Math.sin(a) * d * 0.75;
        const rr = snapMin(env, env.px + hash3(SHAPE_SEED, s, i, 33) * r * 0.2);
        ngon(env, g, s * 8 + i, gx, gy + rim, snapMin(env, rr + rim), 5, 0.35, 1, R, ground);
        const dark = hash3(SHAPE_SEED, s, i, 36) < 0.5;
        ngon(env, g, s * 8 + i, gx, gy, rr, 5, 0.35, 1, R, dark ? slot(1) : slot(0));
      }
      break;
    }
    case 'haze': {
      // 경계가 안 보이는 감쇠 얼룩. 접지 테두리를 두르지 않는다(테두리가 보이면 haze 가 아니다).
      // 부드러움은 테마가 종류별로 정한다 — 예전에는 kind 이름 문자열 분기였다.
      const soft = shape.soft;
      softBlob(env, g, s, r, el, R, slot(0), soft?.rings, soft?.ringAlpha, soft?.wobble);
      break;
    }
    case 'boulder':
    case 'ridge':
    case 'mound':
      drawReliefBase(env, g, kind, v);
      break;
  }
}

/**
 * **부조의 가산 하이라이트 텍스처.** 부조가 아닌 종류에는 아무것도 그리지 않는다(그래서
 * 텍스처도 굽지 않는다 — 사문화된 빈 텍스처를 만들지 않는다).
 *
 * 여기서만 확인할 수 있는 것: ①빛이 실제로 `theme.light` 쪽 모서리에만 붙는가 ②변형 각도를
 * 돌려도 그 방향이 유지되는가(회전이 광원까지 돌려 버리는 것이 이 설계의 가장 그럴듯한 오작동이다).
 */
export function drawHighlightInto(env: DecalEnv, g: Graphics, kind: DecalKind, v: number): void {
  if (!isRelief(env, kind)) return;
  drawReliefGlow(env, g, kind, v);
}

// ─────────────────────────────────────────────────────────────────────────────
// 절차적 텍스처(렌더러 × 테마당 1회 굽고 캐시)
// ─────────────────────────────────────────────────────────────────────────────

/** 곱연산 본체 텍스처와 가산 하이라이트 텍스처 한 벌. */
export interface DecalTextures {
  readonly base: ReadonlyMap<DecalKind, Texture[]>;
  /** 부조 종류만 들어 있다(나머지는 하이라이트가 없다). */
  readonly glow: ReadonlyMap<DecalKind, Texture[]>;
}

/**
 * 렌더러당 텍스처 캐시. **테마 id 로 한 겹 더 나눈다** — 키가 렌더러뿐이면 행성을 바꿨을 때
 * 먼저 구운 텍스처가 조용히 재사용되어 이전 행성의 색이 남는다.
 */
const TEXTURE_CACHE = new WeakMap<Renderer, Map<string, DecalTextures>>();

/**
 * 종류 × 변형 텍스처를 한 번만 굽는다. 실패하면 `null` → 레이어가 비활성으로 떨어진다.
 *
 * **`resolution`·`antialias`·`scaleMode` 셋이 한 묶음이다.** 하나라도 빠지면 데칼이 지형과
 * 다른 픽셀 해상도로 보인다.
 */
function bakeTextures(env: DecalEnv, renderer: Renderer): DecalTextures | null {
  let perTheme = TEXTURE_CACHE.get(renderer);
  if (perTheme === undefined) {
    perTheme = new Map<string, DecalTextures>();
    TEXTURE_CACHE.set(renderer, perTheme);
  }
  const cached = perTheme.get(env.theme.themeId);
  if (cached !== undefined) return cached;
  const base = new Map<DecalKind, Texture[]>();
  const glow = new Map<DecalKind, Texture[]>();
  const bake = (draw: (g: Graphics) => void): Texture => {
    const g = new Graphics();
    draw(g);
    const tex = renderer.generateTexture({
      target: g,
      resolution: env.bakeResolution,
      antialias: false,
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    tex.source.scaleMode = 'nearest';
    g.destroy();
    return tex;
  };
  try {
    for (const kind of allKinds(env.theme)) {
      const list: Texture[] = [];
      const glowList: Texture[] = [];
      for (let v = 0; v < VARIANTS; v++) {
        list.push(bake((g) => drawDecalInto(env, g, kind, v)));
        if (isRelief(env, kind)) glowList.push(bake((g) => drawHighlightInto(env, g, kind, v)));
      }
      base.set(kind, list);
      if (glowList.length > 0) glow.set(kind, glowList);
    }
  } catch {
    return null;
  }
  const out: DecalTextures = { base, glow };
  perTheme.set(env.theme.themeId, out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 화면 기여도 예측 모델
// ─────────────────────────────────────────────────────────────────────────────

/** 지형 게이트가 없는 격자(재질 층). 세기 모델의 기본 대상이다. */
export function materialGrids(t: DecalTheme): readonly GridSpec[] {
  return t.grids.filter((g) => g.siteGate === undefined);
}

/** 지형 게이트가 있는 격자(랜드마크 층). */
export function landmarkGrids(t: DecalTheme): readonly GridSpec[] {
  return t.grids.filter((g) => g.siteGate !== undefined);
}

/**
 * **한 화면의 잉크 총량 예측.** 오케스트레이터가 재는 "레이어 on/off 의 RGB 합산 절대차 평균"
 * 과 같은 단위(0~765)로 이 레이어가 만들어낼 화면 차이를 계산한다.
 *
 *   기여 = Σ (발자국 면적 × coverage) × opacity × alpha × darkening(fill) × 바닥밝기 / 화면 면적
 *
 * 곱연산이라 **바닥 밝기에 비례**한다.
 *
 * **한계를 정확히 알고 써라.** 이건 측정이 아니라 모델이고 두 방향으로 틀린다:
 *  - 겹침을 선형으로 더하므로 **과대평가**한다(실제 합성은 포화한다).
 *  - 바닥을 균일한 `floorLumaSum` 으로 가정한다. 명암 이원성이 큰 행성에서는 곱연산이 어두운
 *    쪽에서 거의 아무 일도 하지 않으므로 어두운 화면에서 과대평가된다.
 */
export function estimateScreenInk(
  env: DecalEnv,
  seed: number,
  densityScale = 1,
  viewW = DESIGN_WIDTH,
  viewH = DESIGN_HEIGHT,
  grids: readonly GridSpec[] = materialGrids(env.theme),
): number {
  const screenArea = viewW * viewH;
  const scratch = emptyPlacement();
  let ink = 0;
  for (const spec of grids) {
    const cols = Math.ceil(viewW / spec.cell);
    const rows = Math.ceil(viewH / spec.cell);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const p = decalAt(env, spec, seed, c, r, densityScale, scratch);
        if (!p.present) continue;
        const shape = kindShape(env, p.kind);
        const size = shape.r * p.scale;
        const area = Math.PI * size * shape.elong * size * shape.coverage;
        ink +=
          (area * shape.opacity * p.alpha * darkening(inkFill(shape)) * env.theme.floorLumaSum) /
          screenArea;
      }
    }
  }
  return ink;
}

/** 한 화면의 랜드마크 개수(지형 게이트 통과 후). */
export function reliefCount(
  env: DecalEnv,
  spec: GridSpec,
  seed: number,
  densityScale = 1,
  viewW = DESIGN_WIDTH,
  viewH = DESIGN_HEIGHT,
): number {
  const scratch = emptyPlacement();
  let n = 0;
  for (let c = 0; c < Math.ceil(viewW / spec.cell); c++) {
    for (let r = 0; r < Math.ceil(viewH / spec.cell); r++) {
      if (decalAt(env, spec, seed, c, r, densityScale, scratch).present) n++;
    }
  }
  return n;
}

/**
 * **가산 하이라이트가 화면에 더하는 잉크.** {@link estimateScreenInk} 와 같은 단위(0~765)이며
 * 예산 {@link ADDITIVE_INK_BUDGET} 과 직접 비교된다.
 *
 * 두 항으로 나눈다 — 둘의 성격이 정반대라서다:
 *  - **림**: 둘레 × 굵기 만큼의 아주 좁은 면적인데 국소 대비는 크다. 총량 기여는 작다.
 *  - **면 워시**: 넓은 면적인데 색·알파가 낮다. **여기가 예산을 먹는 쪽**이다.
 */
export function estimateHighlightInk(
  env: DecalEnv,
  spec: GridSpec,
  seed: number,
  densityScale = 1,
  viewW = DESIGN_WIDTH,
  viewH = DESIGN_HEIGHT,
): number {
  const glow = env.theme.glow;
  if (glow === undefined) return 0;
  const screenArea = viewW * viewH;
  const scratch = emptyPlacement();
  let ink = 0;
  for (let c = 0; c < Math.ceil(viewW / spec.cell); c++) {
    for (let r = 0; r < Math.ceil(viewH / spec.cell); r++) {
      const p = decalAt(env, spec, seed, c, r, densityScale, scratch);
      if (!p.present) continue;
      const rad = reliefFootprintRadius(env, p.kind, p.variant) * p.scale;
      // 림: 발자국 둘레의 광원 쪽 절반 × 굵기(2텍셀).
      const rim = Math.PI * rad * (env.px * 2) * lumaSum(glow.rim);
      // 면 워시: **표를 직접 읽는다**(겹마다 면적 = (rad×scale)², 알파는 누적).
      let wash = 0;
      let acc = 0;
      for (const w of RELIEF_WASH) {
        const a = w.alpha * (1 - acc);
        acc += a;
        wash += Math.PI * (rad * w.scale) ** 2 * kindShape(env, p.kind).coverage * a;
      }
      ink += ((rim + wash * lumaSum(glow.face)) * p.glowAlpha) / screenArea;
    }
  }
  return ink;
}

/**
 * **랜드마크의 곱연산 기여.** 암부 밝기(`darkFloorLumaSum`)로 잰다 — 화면 평균으로 재면
 * "암부에서 곱연산이 거의 일하지 않는다"는 이 층의 존재 이유 자체를 숨기게 된다.
 */
export function estimateReliefShadowInk(
  env: DecalEnv,
  spec: GridSpec,
  seed: number,
  densityScale = 1,
  viewW = DESIGN_WIDTH,
  viewH = DESIGN_HEIGHT,
): number {
  const screenArea = viewW * viewH;
  const scratch = emptyPlacement();
  let ink = 0;
  for (let c = 0; c < Math.ceil(viewW / spec.cell); c++) {
    for (let r = 0; r < Math.ceil(viewH / spec.cell); r++) {
      const p = decalAt(env, spec, seed, c, r, densityScale, scratch);
      if (!p.present) continue;
      const shape = kindShape(env, p.kind);
      const rad = reliefFootprintRadius(env, p.kind, p.variant) * p.scale;
      const area = Math.PI * rad * rad * shape.coverage;
      ink +=
        (area * shape.opacity * p.alpha * darkening(inkFill(shape)) * env.theme.darkFloorLumaSum) /
        screenArea;
    }
  }
  return ink;
}

// ─────────────────────────────────────────────────────────────────────────────
// 스프라이트 적용 — 불변식이 실제 스프라이트에 닿는 유일한 지점
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 배치를 스프라이트에 적용한다. **레이어와 테스트가 같은 함수를 본다** — "곱연산으로 합성한다",
 * "런타임 회전을 하지 않는다", "정수 배율만 쓴다" 같은 불변식이 문서가 아니라 코드 한 곳에서
 * 강제되고, 테스트는 그 한 곳을 직접 두드린다.
 */
export function applyPlacement(sprite: Sprite, p: DecalPlacement, texture: Texture): void {
  sprite.texture = texture;
  // 텍스처 지정 **뒤**에 스케일을 건다(v8 은 텍스처 교체로 스케일을 재계산하지 않는다).
  sprite.scale.set(p.flip ? -p.scale : p.scale, p.scale);
  // 런타임 회전 금지 — 각도는 텍스처에 구워져 있다(픽셀 격자 보존).
  sprite.rotation = 0;
  sprite.alpha = p.alpha;
  sprite.tint = p.tint;
  sprite.blendMode = DECAL_BLEND;
  sprite.position.set(p.worldX, p.worldY);
  sprite.visible = true;
}

/**
 * 가산 하이라이트 스프라이트에 배치를 적용한다. {@link applyPlacement} 와 **다른 점만**:
 * 블렌드가 `add`, 알파가 {@link DecalPlacement.glowAlpha}, 그리고 **좌우반전을 하지 않는다**
 * (반전은 광원을 거울로 뒤집는다 — 배치 단계에서 이미 막았지만 여기서도 안 쓴다).
 *
 * 위치·배율은 본체와 동일해야 두 텍스처가 겹친다.
 */
export function applyHighlight(sprite: Sprite, p: DecalPlacement, texture: Texture): void {
  sprite.texture = texture;
  sprite.scale.set(p.scale, p.scale);
  sprite.rotation = 0;
  sprite.alpha = p.glowAlpha;
  sprite.tint = p.tint;
  sprite.blendMode = HIGHLIGHT_BLEND;
  sprite.position.set(p.worldX, p.worldY);
  sprite.visible = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 산포 격자(풀링·컬링)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 한 산포 격자의 스프라이트 풀. autotile 의 `ensureCoverage`/`baseTx` 규율을 그대로 따른다 —
 * 매 프레임 할당 0, 카메라가 셀 경계를 넘을 때만 재배치.
 */
export class ScatterGrid {
  readonly view = new Container();
  /** 곱연산 그림자 층. */
  private readonly baseView = new Container();
  /**
   * 가산 하이라이트 층. **별도 컨테이너인 이유**: 자식 순서가 곧 z 순서라, 그림자/하이라이트를
   * 셀마다 번갈아 넣으면 이웃 실루엣의 그림자가 내 하이라이트를 덮는다(겹칠 때만 보이는,
   * 재현이 어려운 종류의 결함). 층을 통째로 나누면 그 경로가 사라진다.
   */
  private readonly glowView = new Container();
  private readonly pool: Sprite[] = [];
  private readonly glowPool: Sprite[] = [];
  private cols = 0;
  private rows = 0;
  private lastBaseCx = Number.NaN;
  private lastBaseCy = Number.NaN;
  private dirty = true;
  private seed = 0;
  private densityScale = 1;
  private env: DecalEnv | null = null;
  private textures: DecalTextures | null = null;
  /** 재배치 루프가 재사용하는 단일 out 객체(할당 0). */
  private readonly scratch = emptyPlacement();

  constructor(private readonly spec: GridSpec) {
    this.view.addChild(this.baseView);
    this.view.addChild(this.glowView);
    this.ensureCoverage(DESIGN_WIDTH, DESIGN_HEIGHT);
  }

  configure(env: DecalEnv, textures: DecalTextures, seed: number): void {
    this.env = env;
    this.textures = textures;
    this.seed = seed >>> 0;
    this.dirty = true;
  }

  /** 티어 밀도 배율. 바뀌면 다음 프레임에 전체 재배치(솎임/복원). */
  setDensityScale(scale: number): void {
    if (scale === this.densityScale) return;
    this.densityScale = scale;
    this.dirty = true;
  }

  /** 가시 영역 + 마진 링을 덮도록 풀을 키운다(줄이지 않는다 — autotile 과 동형). */
  ensureCoverage(viewW: number, viewH: number): void {
    const cols = Math.ceil(viewW / this.spec.cell) + DECAL_MARGIN * 2 + 1;
    const rows = Math.ceil(viewH / this.spec.cell) + DECAL_MARGIN * 2 + 1;
    if (cols <= this.cols && rows <= this.rows) return;
    this.cols = Math.max(cols, this.cols);
    this.rows = Math.max(rows, this.rows);
    const need = this.cols * this.rows;
    for (let i = this.pool.length; i < need; i++) {
      const s = new Sprite();
      s.anchor.set(0.5);
      s.blendMode = DECAL_BLEND;
      s.visible = false;
      this.pool.push(s);
      this.baseView.addChild(s);
    }
    if (this.spec.highlight !== undefined) {
      for (let i = this.glowPool.length; i < need; i++) {
        const s = new Sprite();
        s.anchor.set(0.5);
        s.blendMode = HIGHLIGHT_BLEND;
        s.visible = false;
        this.glowPool.push(s);
        this.glowView.addChild(s);
      }
    }
    this.dirty = true;
  }

  /** 풀 크기(진단·테스트용). */
  get poolSize(): number {
    return this.pool.length;
  }

  /** 이 격자의 티어 밀도 하한(랜드마크는 저티어에서도 구도가 유지돼야 한다). */
  get minDensityScale(): number {
    return this.spec.minDensityScale ?? 0;
  }

  /** 이 격자의 사양(레이어가 어떤 격자를 실제로 돌리는지 밖에서 확인하는 창). */
  get gridSpec(): GridSpec {
    return this.spec;
  }

  /**
   * 현재 보이는 스프라이트 수(그림자 / 하이라이트).
   *
   * **테스트를 위해 존재한다.** 이 리포에서 여러 번 반복된 결함이 "단위 테스트는 그린인데
   * 배선이 통째로 없다"이고, 이 레인에도 정확히 그 구멍이 있었다 — 배치 계산·기하·상한을
   * 아무리 잠가도 `applyHighlight` 호출을 지우면 **테스트가 전부 통과했다**(뮤테이션으로 확인).
   * 스프라이트 풀을 밖에서 셀 수 있어야 그 경로가 잠긴다.
   */
  visibleCounts(): { base: number; glow: number } {
    let base = 0;
    let glow = 0;
    for (const s of this.pool) if (s.visible) base++;
    for (const s of this.glowPool) if (s.visible) glow++;
    return { base, glow };
  }

  /**
   * 월드 사각형을 덮도록 데칼을 놓는다. 입력이 **월드 좌표**뿐이라(카메라 없음) 같은 셀은
   * 카메라가 어디에 있든 같은 자리·같은 모습으로 다시 놓인다 = 월드 고정.
   */
  layout(worldMinX: number, worldMinY: number, worldMaxX: number, worldMaxY: number): void {
    const tex = this.textures;
    const env = this.env;
    if (tex === null || env === null) return;
    this.ensureCoverage(worldMaxX - worldMinX, worldMaxY - worldMinY);
    const baseCx = Math.floor(worldMinX / this.spec.cell) - DECAL_MARGIN;
    const baseCy = Math.floor(worldMinY / this.spec.cell) - DECAL_MARGIN;
    if (!this.dirty && baseCx === this.lastBaseCx && baseCy === this.lastBaseCy) return;
    this.lastBaseCx = baseCx;
    this.lastBaseCy = baseCy;
    this.dirty = false;

    const p = this.scratch;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        const sprite = this.pool[i];
        const glow = this.glowPool[i];
        if (sprite === undefined) continue;
        decalAt(env, this.spec, this.seed, baseCx + c, baseCy + r, this.densityScale, p);
        const variants = p.present ? tex.base.get(p.kind) : undefined;
        const t = variants?.[p.variant];
        if (t === undefined) {
          sprite.visible = false;
          if (glow !== undefined) glow.visible = false;
          continue;
        }
        applyPlacement(sprite, p, t);
        if (glow === undefined) continue;
        const gt = tex.glow.get(p.kind)?.[p.variant];
        if (gt === undefined) glow.visible = false;
        else applyHighlight(glow, p, gt);
      }
    }
  }

  hideAll(): void {
    for (const s of this.pool) s.visible = false;
    for (const s of this.glowPool) s.visible = false;
    this.dirty = true;
  }

  destroy(): void {
    // 텍스처는 렌더러 캐시 공유물이라 파괴하지 않는다(다음 런이 재사용한다).
    this.view.destroy({ children: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 레이어
// ─────────────────────────────────────────────────────────────────────────────

export class DecalLayer implements EnvLayer {
  readonly name = 'decals';
  readonly slot = 'floor' as const;
  readonly view = new Container();
  /** 테마 격자 순서 그대로(뒤 → 앞). 테마를 받기 전에는 비어 있다. */
  private grids: ScatterGrid[] = [];
  private enabled = false;
  /** 설정 스냅샷 캐시 — 매 프레임 `getSettings()` 를 부르면 프레임마다 객체가 새로 생긴다. */
  private settings: GraphicsSettings = graphicsSettings.getSettings();
  private readonly unsubscribe: () => void;

  constructor() {
    this.unsubscribe = graphicsSettings.onChange((s) => {
      this.settings = s;
    });
  }

  /**
   * 담당 테마가 없는 행성이면 스스로 꺼진다. 렌더러가 없으면(테스트 환경 — 캔버스 없음)
   * 던지지 않고 그냥 비활성으로 떨어진다.
   */
  configure(ctx: EnvContext): boolean {
    this.enabled = false;
    const theme = themeFor(ctx.planet);
    if (theme === undefined) return false;
    if (ctx.renderer === undefined) return false;
    const env = decalEnv(theme.decals, theme.light);
    const tex = bakeTextures(env, ctx.renderer);
    if (tex === null) return false;
    // 테마가 바뀌면 격자 구성 자체가 바뀐다 — 이전 풀을 남기면 첫 테마의 스프라이트가 그대로 남는다.
    this.teardownGrids();
    for (const spec of theme.decals.grids) {
      const g = new ScatterGrid(spec);
      g.configure(env, tex, ctx.seed);
      this.grids.push(g);
      this.view.addChild(g.view);
    }
    this.enabled = true;
    return true;
  }

  private teardownGrids(): void {
    for (const g of this.grids) {
      this.view.removeChild(g.view);
      g.destroy();
    }
    this.grids = [];
  }

  update(f: EnvFrame): void {
    if (!this.enabled) return;
    const tier = graphicsTierController.getActiveTier();
    const gates = effectGates(tier, this.settings);
    // 파티클을 완전히 끈 예산에서는 장식 데칼도 함께 내린다(게이트 일관).
    if (gates.particles === 'off') {
      for (const g of this.grids) g.hideAll();
      return;
    }
    // 카메라 팬은 컨테이너 평행이동으로만 한다(EntityRenderer·autotile 과 동일 매핑).
    const offX = DESIGN_WIDTH / 2 - f.camX;
    const offY = DESIGN_HEIGHT / 2 - f.camY;
    this.view.position.set(offX, offY);
    const scale = densityForTier(tier);
    for (const g of this.grids) {
      g.setDensityScale(Math.max(scale, g.minDensityScale));
      g.layout(f.viewMinX - offX, f.viewMinY - offY, f.viewMaxX - offX, f.viewMaxY - offY);
    }
  }

  /**
   * 이 레이어가 실제로 돌리는 격자 사양(뒤 → 앞 순서 그대로).
   *
   * 테스트가 "랜드마크 격자가 배선돼 있는가"를 여기서 본다 — 격자를 목록에서 지우면 배치·기하
   * 테스트는 전부 통과한 채로 화면에서만 사라진다(이 리포의 반복 결함 유형).
   */
  get gridSpecs(): readonly GridSpec[] {
    return this.grids.map((g) => g.gridSpec);
  }

  resize(width: number, height: number): void {
    for (const g of this.grids) g.ensureCoverage(width, height);
  }

  destroy(): void {
    this.unsubscribe();
    this.teardownGrids();
    this.view.destroy({ children: true });
  }
}
