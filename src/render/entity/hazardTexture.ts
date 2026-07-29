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

import { valueNoise } from '../env/noise.js';

/** 로브 텍스처 한 변(px). 로브는 화면에서 작아(0.12~0.30r) 64 면 충분하다. */
export const BLOB_TEX_SIZE = 64;
/** 입자 텍스처 한 변(px). */
export const MOTE_TEX_SIZE = 24;

/** [0,1] 로 자른다. */
function sat(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
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

/** 캐시를 비운다. **테스트 격리 전용**. */
export function resetHazardTextures(): void {
  blobTex = undefined;
  moteTex = undefined;
  glowTex = undefined;
}
