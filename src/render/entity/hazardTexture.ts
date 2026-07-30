/**
 * 해저드 재질의 **공유 텍스처** — 절차적으로 굽고 전 장판이 나눠 쓴다.
 *
 * ## 왜 `Graphics` 가 아니라 텍스처인가 (2차 반려의 성능 근거)
 * 2차 구현의 로브는 장판마다 `Graphics` 였다. `Graphics` 하나는 **드로우콜 하나**라, 상세 겹이
 * 살아 있는 24장에서 draw 만으로 프레임 예산(+1.5ms)의 65% 를 썼다. 그런데 실제 판정 장면인
 * 톡사르는 **41장**이다 — 겹을 되살리면서 그 비용을 그대로 두면 예산이 무조건 터진다.
 *
 * 스프라이트는 **같은 텍스처·같은 블렌드면 배치(batch)된다**: 272개를 그려도 드로우콜은 사실상
 * 하나다. 그래서 개수가 많고 작은 것(로브·입자)은 전부 여기서 구운 텍스처를 쓰는 스프라이트다.
 *
 * ## 왜 canvas 가 아니라 `BufferImageSource` 인가
 * `document.createElement('canvas')` 는 node(vitest)에 없어 폴백 경로가 갈린다 — 그러면 **테스트가
 * 도는 경로와 화면에 나오는 경로가 달라진다**(이 리포가 반복해서 밟은 종류의 함정이다).
 * `BufferImageSource` 는 `Uint8Array` 하나만 있으면 되므로 DOM 도 GL 도 필요 없고, node 와 브라우저가
 * **같은 코드**를 탄다. 굽는 계산 자체가 순수 함수라 픽셀값을 단위 테스트로 직접 검사할 수 있다.
 *
 * ## 알파를 쓰지 않는다 — 휘도로 굽는다
 * 전부 **가산 합성** 전용이다. 가산에서는 검정(0,0,0)이 아무것도 더하지 않으므로, 알파 대신
 * **휘도 falloff** 를 굽고 알파는 255 로 둔다. 그러면 프리멀티플라이 규약(그리고 그것을 틀렸을 때
 * 생기는, 눈으로만 잡히는 테두리 결함)이 아예 문제가 되지 않는다. 색은 스프라이트 `tint` 가 준다.
 *
 * ── 결정론(ADR-0005) ── render-only. `Math.random` 없이 {@link valueNoise} 로만 굽는다.
 */

import { BufferImageSource, Texture } from 'pixi.js';

import { hash3, valueNoise } from '../env/noise.js';
import type { AdditiveTextureId } from './hazardShape.js';

/** 로브 텍스처 한 변(px). 로브는 화면에서 작아(0.12~0.30r) 64 면 충분하다. */
export const BLOB_TEX_SIZE = 64;
/** 입자 텍스처 한 변(px). */
export const MOTE_TEX_SIZE = 24;
/**
 * 접지(그늘·림) 텍스처 한 변(px). **`Graphics` 를 대체한 것이 이 상수의 존재 이유다** —
 * 3차는 접촉 그늘·림을 장판마다 `Graphics` 두 개로 그렸고, 그래서 비용을 감당하려 `full` LOD
 * 에만 붙였다(41장 중 6장). 그 결과가 "나란한 같은 셀 중 일부만 다르다"는 자기 논리 위반이었다.
 * 스프라이트로 바꾸면 41장 전부에 붙여도 드로우콜이 늘지 않는다.
 */
export const GROUND_TEX_SIZE = 96;
/**
 * 면적 재질(껍질·균열·거품·렌즈) 텍스처 한 변(px). 장판 전체를 덮으므로 로브보다 크다.
 * 160 이면 반경 200 장판에서 픽셀당 2.5 월드유닛 — 균열 선이 뭉개지지 않는 하한이다.
 */
export const CRUST_TEX_SIZE = 160;
/** 굴절 변위맵 한 변(px). 변위는 저주파라 작아도 된다(필터가 이중선형 보간한다). */
export const LENS_DISP_SIZE = 64;

/** [0,1] 로 자른다. */
function sat(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 부드러운 계단(Hermite). 하드 엣지를 없애는 유일한 도구다. */
function smoothstep(a: number, b: number, x: number): number {
  if (b === a) return x < a ? 0 : 1;
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** 3옥타브 fbm ∈ [0,1]. 한 옥타브는 격자가 보이고, 넷은 값을 못 벌린다. */
function fbm(seed: number, x: number, y: number): number {
  return (
    0.56 * valueNoise(seed, x, y) +
    0.3 * valueNoise(seed ^ 0x9e3779b9, x * 2.07 + 5, y * 2.07 + 5) +
    0.14 * valueNoise(seed ^ 0x85ebca6b, x * 4.13 + 11, y * 4.13 + 11)
  );
}

/**
 * 능선(ridged) 노이즈 ∈ [0,1]. fbm 이 0.5 를 지나는 **선**에서 1 이 된다 — 즉 값이 아니라
 * **등고선**이 무늬가 된다. 균열망이 절차적 도형이 아니라 재질로 읽히는 근거다(카르곤 배경의
 * 용암 균열망이 이미 같은 원리로 AAA 통과했다).
 */
function ridged(seed: number, x: number, y: number): number {
  return 1 - Math.abs(2 * fbm(seed, x, y) - 1);
}

/**
 * 장판 안쪽으로 부드럽게 죽는 마스크. **면적 재질이 판정 반경 밖으로 새지 않게 하는 장치**이며,
 * 동시에 "각진 폴리곤이 아니라 소프트 페이드"(§3-C-2)를 텍스처 차원에서 보장한다.
 */
export function discMask(d: number): number {
  if (d >= 1) return 0;
  return 1 - smoothstep(0.66, 1, d);
}

/**
 * 휘도 falloff 텍스처를 굽는다(알파는 전부 255 — 위 헤더의 "휘도로 굽는다" 참조).
 *
 * `sample(nx, ny)` 는 중심을 원점으로 한 정규화 좌표 [-1,1] 를 받아 [0,1] 휘도를 낸다.
 * 실패하면 `null` — 호출측이 그 겹만 생략하고 게임은 계속 돈다(`tryCreateFilter` 정신).
 */
export function bakeLuminanceTexture(
  size: number,
  sample: (nx: number, ny: number) => number,
): Texture | null {
  try {
    const px = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // 픽셀 중심 기준 정규화 좌표 — 가장자리가 정확히 ±1 이 되도록 반 픽셀을 민다.
        const nx = ((x + 0.5) / size) * 2 - 1;
        const ny = ((y + 0.5) / size) * 2 - 1;
        const v = Math.round(sat(sample(nx, ny)) * 255);
        const i = (y * size + x) * 4;
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
        px[i + 3] = 255;
      }
    }
    return new Texture({
      source: new BufferImageSource({ resource: px, width: size, height: size }),
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 로브 — 불규칙 소프트 블롭
// ---------------------------------------------------------------------------

/** 블롭 가장자리의 불규칙 진폭(반경 대비). 완전한 원이면 §2-5 의 UI 어휘가 된다. */
const BLOB_EDGE_WOBBLE = 0.22;
/** 가장자리 노이즈 주파수. */
const BLOB_NOISE_FREQ = 2.4;
/**
 * falloff 지수. 1 이면 원뿔이라 가장자리가 또렷해 "원판"으로 읽히고, 너무 크면 중심만 남아
 * 점이 된다. 1.6 은 중심이 차 있으면서 가장자리가 부드럽게 죽는 값이다.
 */
const BLOB_FALLOFF = 1.6;

/**
 * 로브 블롭의 휘도(순수 함수 — 테스트가 픽셀값을 직접 검사한다).
 *
 * 각도별로 가장자리 반경을 노이즈로 흔들어 **완전한 원이 아니게** 만든다. 로브는 14개가 겹쳐
 * 통계로 읽히므로 개별 실루엣이 정교할 필요는 없고, "원이 아니다"만 성립하면 된다.
 */
export function blobLuminance(nx: number, ny: number): number {
  const d = Math.hypot(nx, ny);
  if (d >= 1) return 0;
  const a = Math.atan2(ny, nx);
  // 원 위에서 샘플링해 a=0 과 a=2π 가 같은 값을 내게 한다(이음매 없음).
  const n = valueNoise(0x51ed270b, Math.cos(a) * BLOB_NOISE_FREQ + 8, Math.sin(a) * BLOB_NOISE_FREQ + 8);
  const edge = 1 - BLOB_EDGE_WOBBLE * n;
  const t = d / edge;
  if (t >= 1) return 0;
  return Math.pow(1 - t * t, BLOB_FALLOFF);
}

let blobTex: Texture | null | undefined;

/** 전 장판이 공유하는 로브 블롭 텍스처(1회 굽기). */
export function blobTexture(): Texture | null {
  if (blobTex === undefined) blobTex = bakeLuminanceTexture(BLOB_TEX_SIZE, blobLuminance);
  return blobTex;
}

// ---------------------------------------------------------------------------
// 입자 — 소프트 점
// ---------------------------------------------------------------------------

/** 입자 falloff 지수. 로브보다 급해야 "작고 밝은 알갱이"로 읽힌다. */
const MOTE_FALLOFF = 2.4;

/** 입자 점의 휘도(순수 함수). */
export function moteLuminance(nx: number, ny: number): number {
  const d = Math.hypot(nx, ny);
  if (d >= 1) return 0;
  return Math.pow(1 - d, MOTE_FALLOFF);
}

let moteTex: Texture | null | undefined;

/** 전 장판이 공유하는 입자 텍스처(1회 굽기). */
export function moteTexture(): Texture | null {
  if (moteTex === undefined) moteTex = bakeLuminanceTexture(MOTE_TEX_SIZE, moteLuminance);
  return moteTex;
}

// ---------------------------------------------------------------------------
// 환경 기여 — 넓은 방사 그라디언트 (canvas 경로를 **일부러** 유지한다)
// ---------------------------------------------------------------------------

/** 환경 기여 텍스처 한 변(px). 넓게 늘려 쓰므로 해상도가 낮아도 계단이 안 보인다. */
export const GLOW_TEX_SIZE = 128;

let glowTex: Texture | null | undefined;

/**
 * 환경 기여용 방사 그라디언트. **여기만 canvas 를 쓴다.**
 *
 * 로브·입자와 달리 이 겹은 `spore`·`refract` 에서 **비가산(normal) 합성**이라 실제 알파 falloff 가
 * 필요하고, 알파가 있으면 프리멀티플라이 규약이 개입한다. canvas 경로는 Pixi 가 그 변환을
 * 책임지고, 무엇보다 **이 표현은 비평가가 화면에서 통과 판정한 유일한 항목**이다(2차 판정:
 * 톡사르 bright 6.35%→6.72%, 디스크 밖 번짐 확인). 검증된 경로를 버퍼 경로로 바꿔 얻을 것이
 * 없으므로 그대로 둔다.
 *
 * node(vitest)에는 `document` 가 없어 `null` 이 되고, 호출측이 절차적 동심원으로 물러난다.
 */
export function glowTexture(): Texture | null {
  if (glowTex !== undefined) return glowTex;
  glowTex = null;
  try {
    const cv = document.createElement('canvas');
    cv.width = GLOW_TEX_SIZE;
    cv.height = GLOW_TEX_SIZE;
    const c2 = cv.getContext('2d');
    if (c2 === null) return glowTex;
    const h = GLOW_TEX_SIZE / 2;
    const grd = c2.createRadialGradient(h, h, 0, h, h, h);
    // 중앙이 완전 불투명이면 넓게 늘렸을 때 가운데가 하얗게 뜬다 — 코어부터 반투명이고 바깥으로
    // 부드럽게 죽는 곡선이라야 "번짐"으로 읽힌다.
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    c2.fillStyle = grd;
    c2.fillRect(0, 0, GLOW_TEX_SIZE, GLOW_TEX_SIZE);
    glowTex = Texture.from(cv);
  } catch {
    glowTex = null;
  }
  return glowTex;
}

// ---------------------------------------------------------------------------
// 접지 — 그늘(곱연산)과 림(가산). 방향은 스프라이트 `rotation` 이 준다
// ---------------------------------------------------------------------------

/** 그늘 띠 두께(반경 대비). 림보다 **넓어야** 바닥이 파인 것으로 읽힌다. */
const CONTACT_TEX_BAND = 0.42;
/** 그늘 최대 감광. 곱연산이라 어두운 행성에서는 스스로 약해진다. */
const CONTACT_TEX_MAX = 0.8;
/** 림 띠 두께(반경 대비). 그늘보다 좁아야 가장자리가 선다. */
const RIM_TEX_BAND = 0.16;
/**
 * **내벽** 띠 두께(반경 대비). 방향성 그늘과 별개로 원주 **전체**를 두르는 어두운 띠다.
 *
 * ## 왜 방향성 그늘만으로는 높이감이 안 나오는가 (6차 반려 MAJOR-2)
 * 5차의 접지는 광원 반대쪽 절반만 어둡다. 그래서 광원 쪽 절반은 **바닥과 같은 높이**로 읽히고,
 * 장판이 "파인 웅덩이"가 아니라 "한쪽에 그늘이 드리운 평면 원"이 된다. AAA 대조(Hades 용암
 * 웅덩이 · Returnal 산성 지대)는 웅덩이 **전 둘레**에 두꺼운 어두운 내벽을 두고, 그 내벽이
 * 깊이의 주 신호다. 방향 신호(어느 쪽이 더 어두운가)는 그 위에 얹히는 2차 정보다.
 *
 * 곱연산이므로 이 겹을 두껍게 해도 밝기 총량(§2-4)에는 **순감**으로만 기여한다 — 즉 예산을
 * 쓰지 않고 높이감을 얻는 유일한 축이다.
 */
const WALL_TEX_BAND = 0.26;
/** 내벽 최대 감광. 방향성 그늘(0.8)보다 얕아 방향 정보가 그 위에 남는다. */
const WALL_TEX_MAX = 0.52;

/**
 * 접촉 그늘의 **곱연산 밝기** ∈ [0,1](1 = 그대로, 0 = 완전 검정).
 *
 * 텍스처는 광원이 **+x** 를 향한다고 가정하고 굽는다 — 방향은 스프라이트 `rotation` 이 실는다.
 * 그래서 이 파일에 방향 상수가 없고, 화면에 태양이 둘이 될 여지도 없다.
 *
 * 3차의 그늘은 `arc` 3겹 stroke 였고 실측 mean 기여가 톡사르에서 **정확히 바닥**이었다.
 * 원인은 알파가 아니라 **면적**이다: 호 하나는 원주의 33% 만 덮었다. 여기서는 광원 반대쪽
 * 절반 전체에 걸쳐 가장자리 띠를 채운다.
 */
export function contactLuminance(nx: number, ny: number): number {
  const d = Math.hypot(nx, ny);
  if (d >= 1) return 1;
  // 광원 반대쪽(−x)일수록 강하다. 지수 1.2 면 절반을 넉넉히 덮으면서 중앙이 안 어두워진다.
  const away = -nx / (d > 1e-6 ? d : 1e-6);
  const angular = Math.pow(sat(away), 1.2);
  // 가장자리 안쪽 띠 — 양 끝에서 0 이라 하드 라인이 없다.
  const t = sat((d - (1 - CONTACT_TEX_BAND)) / CONTACT_TEX_BAND);
  const radial = Math.sin(Math.PI * t);
  const directional = CONTACT_TEX_MAX * angular * radial;
  // 전 둘레를 두르는 내벽(방향 무관). 같은 sin 램프라 양 끝에서 정확히 0 이고, 그래서 텍스처
  // 경계(d=1)에 하드 라인이 생기지 않는다 — 여기서 램프를 단조 증가로 두면 d=1 에서 밝기가
  // 0.48 → 1 로 튀어 **정원 윤곽 한 줄**이 생긴다(§2-5 로 되돌아간다).
  const wt = sat((d - (1 - WALL_TEX_BAND)) / WALL_TEX_BAND);
  const wall = WALL_TEX_MAX * Math.sin(Math.PI * wt);
  // 두 감광을 곱으로 합친다(각각 "남은 밝기의 비율"이므로 더하면 1 을 넘어 음수 밝기가 된다).
  return sat((1 - directional) * (1 - wall));
}

/** 림 하이라이트의 **가산 휘도**. 광원 쪽(+x) 안쪽 가장자리만 밝다. */
export function rimLuminance(nx: number, ny: number): number {
  const d = Math.hypot(nx, ny);
  if (d >= 1 || d <= 1 - RIM_TEX_BAND) return 0;
  const toward = nx / (d > 1e-6 ? d : 1e-6);
  const angular = Math.pow(sat(toward), 1.8);
  const t = (d - (1 - RIM_TEX_BAND)) / RIM_TEX_BAND;
  return sat(Math.sin(Math.PI * t) * angular);
}

let contactTex: Texture | null | undefined;
let rimTex: Texture | null | undefined;

/** 전 장판이 공유하는 접촉 그늘 텍스처(곱연산). */
export function contactTexture(): Texture | null {
  if (contactTex === undefined) contactTex = bakeLuminanceTexture(GROUND_TEX_SIZE, contactLuminance);
  return contactTex;
}

/** 전 장판이 공유하는 림 하이라이트 텍스처(가산). */
export function rimTexture(): Texture | null {
  if (rimTex === undefined) rimTex = bakeLuminanceTexture(GROUND_TEX_SIZE, rimLuminance);
  return rimTex;
}

// ---------------------------------------------------------------------------
// 면적 재질 — 종류가 색만 다르던 결함(3차 반려 MAJOR-5)의 처방
// ---------------------------------------------------------------------------

/**
 * 균열망의 **가산 휘도**(용암·박격의 발광 균열).
 *
 * 3차의 `molten` 은 "흐르는 용융이 아니라 주황 원판"이었다 — 껍질·균열·식은 자리·발광 코어가
 * 전부 없었다. 같은 화면의 카르곤 배경 용암 균열망이 이미 AAA 통과했으므로 대비가 잔인했다.
 * 여기서 쓰는 원리는 그 배경과 같다: fbm 등고선(={@link ridged})의 **높은 거듭제곱**이 얇은
 * 균열선이 되고, 낮은 거듭제곱이 그 주변의 넓은 잔열이 된다.
 */
export function crackLuminance(nx: number, ny: number): number {
  const m = discMask(Math.hypot(nx, ny));
  if (m <= 0) return 0;
  const r = ridged(0x3f1a77c5, nx * 2.6 + 4, ny * 2.6 + 4);
  // 지수가 곧 균열의 **두께**다. 11 이면 밝은(≥0.5) 픽셀이 원판의 13% 대라 "선"으로 읽힌다 —
  // 7 은 21% 였고 그건 얇은 선이 아니라 넓은 얼룩, 즉 다시 "평면 채움"이다.
  const vein = Math.pow(r, 11);
  const halo = Math.pow(r, 2) * 0.24;
  return sat((vein + halo) * m);
}

/** 균열망의 **곱연산 밝기**(그을음의 갈라진 검은 금). 같은 무늬를 반대 부호로 쓴다. */
export function crackShadeLuminance(nx: number, ny: number): number {
  const m = discMask(Math.hypot(nx, ny));
  if (m <= 0) return 1;
  const r = ridged(0x3f1a77c5, nx * 2.6 + 4, ny * 2.6 + 4);
  return 1 - 0.82 * Math.pow(r, 5) * m;
}

/**
 * 식은 껍질 판의 **곱연산 밝기**. 용암 위에 얹어 "굳은 판이 떠 있고 그 사이가 갈라져 빛난다"를
 * 만든다 — 균열(가산)과 껍질(곱연산)이 **같은 노이즈 시드가 아니어야** 판과 금이 겹치지 않는다.
 */
export function plateShadeLuminance(nx: number, ny: number): number {
  const m = discMask(Math.hypot(nx, ny));
  if (m <= 0) return 1;
  const p = fbm(0x77c1e2b3, nx * 1.9 + 21, ny * 1.9 + 21);
  return 1 - 0.5 * sat((0.52 - p) * 2.4) * m;
}

/** 거품 개수(오염 포자). 그리드가 아니라 해시 배치라 규칙성이 안 읽힌다. */
const BUBBLE_COUNT = 22;

/** 거품 얼룩의 falloff 지수. 1 보다 크면 가장자리가 부드럽게 죽어 "링"이 안 생긴다. */
const BUBBLE_FALLOFF = 1.4;
/** 거품 하나의 최대 휘도. */
const BUBBLE_PEAK = 0.62;

/**
 * 부글거리는 거품의 **가산 휘도**.
 *
 * ## 4차는 막(membrane)이었고 그게 §2-5 위반이었다
 * 4차는 `dd≈0.82` 에 좁은 가우시안 봉우리를 둬서 "테두리가 밝은 원"을 만들었다. 의도는
 * "채워진 원은 다시 도형이다" 였는데, **테두리가 밝은 작은 원은 정확히 링**이다. 5차 계측의
 * 육안 판정이 그것을 "기포가 여럿이라 동심 윤곽 인상에 더한다"로 잡았고, 같은 셀의 흰 립·가산
 * 림과 겹쳐 "한 자리에 정원 윤곽 여러 줄"(§2-5)을 만들고 있었다.
 *
 * 처방은 **채워진 얼룩**이다. 윤곽선이 없으므로 링이 될 수 없고, 크기가 다른 얼룩들이 겹쳐
 * 거품 무리로 읽힌다. 부수 효과로 원판 평균 휘도가 내려가 §2-4 순감에도 기여한다
 * (막 경로는 봉우리가 좁고 높아 평균이 오히려 높았다).
 */
export function bubbleLuminance(nx: number, ny: number): number {
  const m = discMask(Math.hypot(nx, ny));
  if (m <= 0) return 0;
  let v = 0;
  for (let k = 0; k < BUBBLE_COUNT; k++) {
    const cx = (hash3(0x5b8f2d11, k, 0, 1) * 2 - 1) * 0.74;
    const cy = (hash3(0x5b8f2d11, k, 0, 2) * 2 - 1) * 0.74;
    const rr = 0.09 + 0.13 * hash3(0x5b8f2d11, k, 0, 3);
    const dd = Math.hypot(nx - cx, ny - cy) / rr;
    if (dd >= 1) continue;
    const bright = 0.5 + 0.5 * hash3(0x5b8f2d11, k, 0, 4);
    v += Math.pow(1 - dd * dd, BUBBLE_FALLOFF) * BUBBLE_PEAK * bright;
  }
  return sat(v) * m;
}

/** 오염 감산 겹의 우묶음(가라앉은 웅덩이) 개수. 거품(22)보다 적고 커야 판이 읽힌다. */
const SPORE_POOL_COUNT = 13;
/** 웅덩이 하나의 최대 감광. */
const SPORE_POOL_MAX = 0.66;
/** 판 사이 얼룩의 최대 감광. 넓고 옅어 웅덩이 사이를 잇는다. */
const SPORE_MOTTLE_MAX = 0.3;

/**
 * 오염의 **곱연산 밝기**(가라앉은 포자 웅덩이). 6차 반려 CRITICAL-1 의 처방.
 *
 * ## 왜 오염에만 감산 겹이 없었는가, 그리고 왜 그것이 근인인가
 * 5차의 `CRUST_SPEC.spore.shade` 는 `null` 이었다. 즉 `molten` 이 {@link plateShadeLuminance} 로
 * 구조를 얻는 통로가 오염에는 **통째로 없었다**. 남은 채널이 전부 가산인데, 판정 장면(톡사르)의
 * 오염 셀은 `fillAlpha` 채움이 깔린 **밝은 원판**이라 알파 0.15 대의 가산은 대비를 만들지 못한다.
 * 실측이 그것을 정확히 말했다: 셀 내부 on/off 채널 델타가 mean maxCh **6.32**(카르곤 molten
 * full 셀은 15.20) — 겹의 **형태는 옳고 진폭만 없었다**.
 *
 * 감산으로 구조를 만들면 대비는 오르고 밝기 총량(§2-4)은 **내려간다**. 5차의 밝기 성과를
 * 되돌리지 않고 6차의 가시성 요구를 만족시키는 유일한 축이다(가산 기본 배율
 * `ADDITIVE_ALPHA_BASE` 를 되올리는 것은 명시적으로 처방이 아니다).
 *
 * 무늬는 {@link bubbleLuminance} 와 **다른 시드**여야 한다 — 같은 시드면 밝은 거품과 어두운
 * 웅덩이가 같은 자리에 겹쳐 서로를 지운다(`plateShade` ↔ `crackAdd` 가 시드를 가른 것과 같은 규율).
 * 웅덩이는 거품보다 크고 적어서, 겹치면 "거품이 뜬 늪"으로 읽힌다.
 */
export function sporeShadeLuminance(nx: number, ny: number): number {
  const m = discMask(Math.hypot(nx, ny));
  if (m <= 0) return 1;
  let pool = 0;
  for (let k = 0; k < SPORE_POOL_COUNT; k++) {
    const cx = (hash3(0x2ea77d13, k, 0, 1) * 2 - 1) * 0.7;
    const cy = (hash3(0x2ea77d13, k, 0, 2) * 2 - 1) * 0.7;
    const rr = 0.16 + 0.2 * hash3(0x2ea77d13, k, 0, 3);
    const dd = Math.hypot(nx - cx, ny - cy) / rr;
    if (dd >= 1) continue;
    // **최댓값**으로 합친다(합이 아니다). 겹친 웅덩이가 서로를 더 어둡게 만들면 몇 자리만
    // 검게 뭉치고 나머지는 비는데, 웅덩이는 같은 깊이의 판이라야 "가라앉은 면"으로 읽힌다.
    const v = Math.pow(1 - dd * dd, 1.1) * SPORE_POOL_MAX * (0.62 + 0.38 * hash3(0x2ea77d13, k, 0, 4));
    if (v > pool) pool = v;
  }
  const mottle = SPORE_MOTTLE_MAX * sat((0.55 - fbm(0x6cd9a17f, nx * 2.2 + 13, ny * 2.2 + 13)) * 1.9);
  return sat(1 - (pool + mottle) * m);
}

/**
 * 굴절 렌즈의 **가산 휘도**. 코스틱(집광 무늬)과 유리 테두리.
 *
 * 3차의 `refract` 는 이방성 스케일을 로브에만 걸어서 "렌즈"로 안 읽혔다. 렌즈를 읽히게 하는
 * 것은 블롭의 종횡비가 아니라 ⓐ **집광 무늬**(반경 방향 간섭 띠가 노이즈로 휘어 있는 것)와
 * ⓑ **유리 테두리**(안쪽 가장자리에 좁고 밝은 선)다. 원형 격자가 되지 않도록 반경 자체를
 * fbm 으로 흔든다.
 */
export function lensLuminance(nx: number, ny: number): number {
  const d = Math.hypot(nx, ny);
  if (d >= 1) return 0;
  const warp = (fbm(0x2c4b91d7, nx * 1.7 + 33, ny * 1.7 + 33) - 0.5) * 0.42;
  const rings = 0.5 + 0.5 * Math.cos((d + warp) * Math.PI * 5.4);
  const caustic = Math.pow(rings, 3.2) * discMask(d);
  const edge = Math.exp(-Math.pow((d - 0.93) / 0.055, 2));
  return sat(caustic * 0.62 + edge * 0.85);
}

/**
 * 굴절 **변위 벡터**(실제 왜곡의 입력). 반경 방향 밀어냄 + 노이즈 소용돌이.
 * 가장자리에서 0 으로 죽어(`1 - d²`) 장판 경계에서 잘린 자국이 남지 않는다.
 */
export function lensDisplacement(nx: number, ny: number): { x: number; y: number } {
  const d = Math.hypot(nx, ny);
  if (d >= 1) return { x: 0, y: 0 };
  const fall = 1 - d * d;
  const sw = (fbm(0x91d3a5f1, nx * 2.2 + 7, ny * 2.2 + 7) - 0.5) * 2;
  return { x: (nx * 0.62 - ny * sw * 0.78) * fall, y: (ny * 0.62 + nx * sw * 0.78) * fall };
}

/**
 * 변위맵을 굽는다. **휘도 텍스처와 별개 함수여야 한다** — 변위는 R·G 가 서로 달라야 하고
 * (x·y 성분), 0 변위가 128 이라는 규약이 있다.
 */
export function bakeVectorTexture(
  size: number,
  sample: (nx: number, ny: number) => { x: number; y: number },
): Texture | null {
  try {
    const px = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = ((x + 0.5) / size) * 2 - 1;
        const ny = ((y + 0.5) / size) * 2 - 1;
        const v = sample(nx, ny);
        const i = (y * size + x) * 4;
        px[i] = Math.round(sat(v.x * 0.5 + 0.5) * 255);
        px[i + 1] = Math.round(sat(v.y * 0.5 + 0.5) * 255);
        px[i + 2] = 128;
        px[i + 3] = 255;
      }
    }
    return new Texture({
      source: new BufferImageSource({ resource: px, width: size, height: size }),
    });
  } catch {
    return null;
  }
}

/** 면적 재질 텍스처의 종류. `add` 는 가산 겹, `shade` 는 곱연산 겹이 쓴다. */
export type CrustTextureId =
  | 'crackAdd'
  | 'crackShade'
  | 'plateShade'
  | 'bubbleAdd'
  | 'sporeShade'
  | 'lensAdd';

const CRUST_SAMPLERS: Readonly<Record<CrustTextureId, (nx: number, ny: number) => number>> = {
  crackAdd: crackLuminance,
  crackShade: crackShadeLuminance,
  plateShade: plateShadeLuminance,
  bubbleAdd: bubbleLuminance,
  sporeShade: sporeShadeLuminance,
  lensAdd: lensLuminance,
};

const crustCache = new Map<CrustTextureId, Texture | null>();

/** 면적 재질 텍스처(종류별 1회 굽기, 전 장판 공유). */
export function crustTexture(id: CrustTextureId): Texture | null {
  const hit = crustCache.get(id);
  if (hit !== undefined) return hit;
  const tex = bakeLuminanceTexture(CRUST_TEX_SIZE, CRUST_SAMPLERS[id]);
  crustCache.set(id, tex);
  return tex;
}

let lensDispTex: Texture | null | undefined;

/** 굴절 변위맵(1회 굽기). */
export function lensDisplacementTexture(): Texture | null {
  if (lensDispTex === undefined) lensDispTex = bakeVectorTexture(LENS_DISP_SIZE, lensDisplacement);
  return lensDispTex;
}

// ---------------------------------------------------------------------------
// 예산 회계용 평균 휘도 — §2-4 를 실측 파생으로 잠그는 입력
// ---------------------------------------------------------------------------

/** 환경 기여 그라디언트의 정지점(offset, alpha) — {@link glowTexture} 의 canvas 코드와 같은 값. */
const GLOW_STOPS: readonly (readonly [number, number])[] = [
  [0, 0.95],
  [0.35, 0.42],
  [0.7, 0.12],
  [1, 0],
];

/**
 * 환경 기여 그라디언트의 **순수 쌍둥이**.
 *
 * 화면 경로는 canvas 다(위 {@link glowTexture} 주석 — 비평가가 화면에서 통과 판정한 유일한
 * 항목이라 경로를 바꾸지 않는다). 그런데 §2-4 회계는 이 겹의 평균 휘도를 알아야 하고, canvas 는
 * node 에 없다. 그래서 같은 정지점을 선형 보간하는 순수 함수를 나란히 둔다 — 테스트가 두
 * 표현이 같은 정지점을 쓰는지 직접 대조한다.
 */
export function glowLuminance(nx: number, ny: number): number {
  const d = Math.hypot(nx, ny);
  if (d >= 1) return 0;
  for (let i = 1; i < GLOW_STOPS.length; i++) {
    const a = GLOW_STOPS[i - 1];
    const b = GLOW_STOPS[i];
    if (a === undefined || b === undefined) break;
    if (d <= b[0]) {
      const t = b[0] === a[0] ? 0 : (d - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return 0;
}

/** 원판 위 평균 휘도(순수 — 샘플러를 격자로 적분한다). */
export function meanDiscLuminance(
  sample: (nx: number, ny: number) => number,
  n = 96,
): number {
  let sum = 0;
  let count = 0;
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const nx = ((ix + 0.5) / n) * 2 - 1;
      const ny = ((iy + 0.5) / n) * 2 - 1;
      if (nx * nx + ny * ny >= 1) continue;
      sum += sample(nx, ny);
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * 겹별 텍스처의 **원판 평균 휘도**. `hazardShape.additiveLoad` 의 입력이다.
 *
 * 여기가 회계와 실제 그림을 잇는 유일한 지점이다 — 텍스처를 밝게 다시 구우면 알파를 하나도
 * 안 만졌는데도 예산 테스트가 빨개진다(§2-4 가 요구한 "상수가 아니라 실측 파생").
 *
 * ⚠️ 곱연산 텍스처(`crackShade`·`plateShade`·접촉 그늘)는 여기 없다. 어둡게 하는 겹은 밝기
 * 총량에 **순감**으로 기여하므로 가산 회계의 항이 아니다.
 */
export function additiveTextureMean(texture: AdditiveTextureId): number {
  const hit = meanCache.get(texture);
  if (hit !== undefined) return hit;
  const v = meanDiscLuminance(ADDITIVE_SAMPLERS[texture]);
  meanCache.set(texture, v);
  return v;
}

const meanCache = new Map<AdditiveTextureId, number>();

const ADDITIVE_SAMPLERS: Readonly<
  Record<AdditiveTextureId, (nx: number, ny: number) => number>
> = {
  glow: glowLuminance,
  rim: rimLuminance,
  blob: blobLuminance,
  mote: moteLuminance,
  crackAdd: crackLuminance,
  crackShade: crackShadeLuminance,
  plateShade: plateShadeLuminance,
  bubbleAdd: bubbleLuminance,
  sporeShade: sporeShadeLuminance,
  lensAdd: lensLuminance,
};

/** 캐시를 비운다. **테스트 격리 전용**. */
export function resetHazardTextures(): void {
  blobTex = undefined;
  moteTex = undefined;
  glowTex = undefined;
  contactTex = undefined;
  rimTex = undefined;
  lensDispTex = undefined;
  crustCache.clear();
  meanCache.clear();
}
