/**
 * 기지 화면 배경 — 풀블리드 시네마틱 키아트 + 절제된 패럴랙스 + 공기(티끌·광선) + 대비 베일.
 *
 * ## 왜 배경이 "한 장 붙이기"가 아닌가
 * 기지는 **오래 머무는 화면**이다. 정지 이미지 한 장은 몇 초만 지나면 배경이 아니라 벽지로
 * 읽히고, 그 위에 놓인 타일이 종이처럼 떠 보인다. 그래서 이 클래스는 ①시선에 따라 아주 조금
 * 움직이고 ②입력이 없어도 스스로 표류하며 ③공기(먼지·가끔 지나는 광선)를 가진다. 장소가
 * 살아 있어야 타일이 그 안에 **놓인 것**으로 읽힌다.
 *
 * ## 왜 타이틀보다 진폭이 작은가
 * 타이틀은 몇 초 보고 지나가는 화면이라 `MOUSE_RANGE 26`·`DRIFT_AMPL 14` 가 인상적으로 읽힌다.
 * 기지는 클릭 대상(타일·CTA)이 화면에 깔린 채 오래 머무는 화면이라, 같은 진폭이면 ①커서를
 * 움직일 때마다 클릭 목표가 흔들리고 ②멀미가 난다. 그래서 절반 아래로 줄였다. 배경만 움직이고
 * **전경(타일·크롬)은 리드가 고정으로 붙인다** — 움직이는 것과 눌러야 하는 것을 분리한다.
 *
 * ## 딤은 상수가 아니라 **측정값에서 파생한다** — 두 번의 실패가 그렇게 시켰다
 * 1차: 화면 전체를 균일하게 눌렀다 → 자기 게임의 다른 화면보다 한 스톱 어두웠다(중앙값 휘도
 * 24 vs 타이틀 32·인트로 49, 채도 18.7 vs 28.4). 배경이 "무특징 어둠"이 됐다.
 *
 * 2차: 딤을 걷고 격자 행 안쪽만 눌렀다 → 이번엔 **도-지가 반전됐다.** 배경 원화는 아래쪽
 * 좌우가 밝은데(램프·성운) 그 자리엔 격자가 없어서 딤도 없었다. 결과: 2행 카드 L 57.7 <
 * 그 바깥 배경 L 79.0. 1행은 카드가 배경보다 +36.1 밝고 2행은 −21.3 어두운, **한 화면 안에서
 * 위아래 그림-바탕 관계가 반대**인 상태가 됐다. 상용 허브는 예외 없이 가장 밝은 화소가
 * 눌러야 할 것 위에 있다.
 *
 * 두 실패의 공통 원인은 같다: **딤을 상수로 적었다.** 상수는 원화가 어디서 밝은지 모른다.
 * 그래서 이제는 배경 원화의 휘도를 **직접 재서** 딤을 역산한다 — {@link BaseBackdrop.rowDim}
 * 이 **행 인덱스 하나만 받아** 그 행의 안쪽·주변 목표 휘도를 맞추는 알파를 돌려준다. 행이
 * 둘이든 셋이든 같은 함수가 같은 규칙을 적용하므로 행마다 다른 상수를 두는 일이 원리적으로
 * 불가능하다(그게 2차 실패의 형태였다).
 *
 * 불변식: **모든 행에서 (카드 휘도 − 인접 배경 휘도) ≥ +25.** 배경 쪽을
 * {@link TARGET_INNER_L}/{@link TARGET_SURROUND_L} 로 고정해 좌변의 감수를 행과 무관하게 만든다.
 *
 * ## 베일 — 왜 사각형 알파가 아니고, 왜 스프라이트 여러 장도 아닌가
 * 반투명 사각형을 그냥 깔면 **경계선이 그대로 보인다**(직선 알파 단차는 인간 시각이 가장 잘
 * 잡는 신호다). 그렇다고 행마다 부드러운 스프라이트를 한 장씩 겹치면 **행 사이에서 알파가
 * 두 번 곱해져 오히려 더 어두운 띠**가 생긴다 — 이 리포가 이미 밟은 함정의 같은 얼굴이다
 * (`scrim.ts` 헤더: 1px 겹침이 알파를 두 배로 만들어 가로줄을 만들었다).
 *
 * 그래서 모든 행의 기여를 **한 장의 알파장으로 굽는다**: 각 텍셀의 알파 = 행별 감쇠의
 * **최댓값**(합이 아니다). 겹쳐도 최댓값이라 이중가산이 원리적으로 불가능하고, 경계에서
 * 정확히 0 이라 테두리도 생기지 않는다. 드로우콜도 1 이다. (2차 검증 실측: 좌우 여백 세로
 * 프로파일에서 |Δ|>2 인 구간이 카드 경계뿐 — 심(seam)이 없음이 확인됐다.)
 *
 * ## 피사계 심도 — 왜 필터가 아니라 구운 텍스처인가
 * 배경·타일·크롬이 전부 같은 초점면에 있으면 깊이가 안 생긴다. 배경을 약하게 흐리면 타일이
 * 앞으로 떨어져 나온다. Pixi `BlurFilter` 는 **매 프레임 2패스**라 오래 머무는 화면에서 계속
 * 비용을 내는데, 배경은 절대 변하지 않으므로 캔버스에서 **1회 구워** 그 텍스처를 쓴다(런타임
 * 비용 0). 그 캔버스가 **휘도 측정의 표본**이기도 하다 — 흐린 판을 재야 실제로 화면에 나가는
 * 것을 재는 것이다. 구울 수 없는 환경이면 원본을 쓰고 딤은 기본값으로 물러난다.
 *
 * ## 자산 없이도 서야 한다
 * `tex` 가 `undefined` 면 절차적 폴백으로 넘어간다 — 짙은 바탕 + 청록·자홍 성운 얼룩(같은
 * 방식으로 구운 부드러운 블롭) + 비네트 + 티끌. 자산은 덧붙임이지 전제가 아니다.
 *
 * ## 품질 티어
 * ⚠️ `graphicsTierController.getActiveTier()` 만 읽으면 안 된다. 그 컨트롤러는 `'high'` 로 시작해
 * 렌더 루프가 돌아야 갱신되는데, 기지는 **부팅 직후 진입할 수 있는 화면**이라 그때는 아직
 * 'high' 다 — 사용자가 품질을 'low' 로 못 박아 두었어도 저사양 폴백이 통째로 무력화된다(실측,
 * 타이틀에서 같은 함정을 밟았다). 설정의 명시적 오버라이드를 **직접** 읽는다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 을 읽지도 쓰지도 않고 시간축은 벽시계다.
 */

import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { effectGates } from '../../render/qualityTier.js';
import { graphicsTierController } from '../../render/graphicsRuntime.js';
import { graphicsSettings } from '../../render/graphicsSettings.js';
import { verticalScrimTexture } from './scrim.js';

// --- 움직임(디자인 스페이스 1920×1080) ---
/** 마우스 추종 최대 변위(px). 타이틀 26 의 절반 이하 — 오래 머무는 화면이라 절제한다. */
const MOUSE_RANGE = 11;
/** 마우스 목표값 추종 시상수. 커서가 튀어도 배경은 부드럽게 따라간다. */
const MOUSE_LERP = 2.6;
/** 자동 드리프트 — 입력이 없어도(터치 기기) 화면이 정지하지 않게. */
const DRIFT_AMPL = 7;
/** 서로소에 가까운 주기 — 왕복이 눈에 띄지 않는다. */
const DRIFT_PERIOD_X = 41;
const DRIFT_PERIOD_Y = 59;
/**
 * 레이어별 패럴랙스 계수. 배경판이 가장 크게, 공기(티끌)는 앞이라 더 크게 움직인다 —
 * 근경이 원경보다 더 움직이는 것이 깊이의 정의다. 딤·비네트는 **전경 UI 에 붙는 것**이라
 * 아예 움직이지 않는다(움직이면 눌러 주는 자리가 타일에서 벗어난다).
 */
const PARALLAX = { art: 1, air: 1.45 } as const;

/**
 * 배경판 오버스캔 배수. 드리프트(≈±18px)로 밀려도 가장자리가 드러나지 않을 만큼 크게 그린다.
 * 여유가 없으면 화면 끝에 빈 줄이 스치는데, 그 한 줄이 "합성물"이라는 인상을 만든다.
 */
const OVERSCAN = 1.1;

/**
 * 배경 흐림 반경(원화 픽셀). 디자인 스페이스 ~6px 에 해당한다(원화 1376 폭이 2112 로 늘어나
 * 확대율 ≈1.53 → 6/1.53 ≈ 4). 이보다 세게 걸면 타이틀에서 주인공이던 석재 부조가 뭉개져
 * 배경이 다시 "무특징 어둠"이 된다 — 깊이를 얻으려고 랜드마크를 잃으면 손해다.
 */
const BLUR_RADIUS = 4;

// --- 딤 목표(측정값에서 알파를 역산한다) ---
/**
 * 격자 행 **안쪽**(카드 사이 거터)의 목표 휘도. 카드 본체가 L 55~72 로 들어오므로 30 이면
 * 모든 행에서 (카드 − 배경) ≥ +25 가 성립한다.
 */
const TARGET_INNER_L = 30;
/**
 * 격자 행 **바깥**(행 좌우·위아래 여백)의 목표 휘도. 안쪽보다 조금 밝게 둔다 — 여기가 배경
 * 랜드마크(램프·석재 부조)를 보여 주는 유일한 창이라 완전히 눌러 버리면 1차 실패로 되돌아간다.
 */
const TARGET_SURROUND_L = 38;
/** 주변 딤이 닿는 거리(px). 행에서 이만큼 떨어지면 딤이 0 이 된다. */
const SURROUND_REACH = 460;
/** 딤 알파 상한 — 원화가 아무리 밝아도 이 이상은 누르지 않는다(검게 뭉개지는 것 방지). */
const MAX_DIM = 0.74;
/**
 * 행 안쪽 딤의 하한. 원화가 이미 충분히 어두워 계산상 0 이 나와도 최소한 이만큼은 눌러야
 * 카드 테두리가 배경에서 떨어져 읽힌다.
 */
const MIN_INNER_DIM = 0.22;

// --- 딤 형상 ---
/** 딤이 누를 사각형(디자인 스페이스). */
export interface BaseVeilRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 기본 사각형 — **격자 행마다 하나**다. 리드가 `baseMap.ts` 에서 실제 격자 사각형을 넘기므로
 * (생성자 옵션) 이건 그 값이 없을 때의 폴백일 뿐이다. **행 개수는 어디에도 하드코딩되어 있지
 * 않다** — 아래 로직은 전부 이 배열을 순회한다.
 */
const DEFAULT_VEIL_RECTS: readonly BaseVeilRect[] = [
  { x0: 60, y0: 179, x1: 1860, y1: 507 },
  { x0: 290, y0: 567, x1: 1632, y1: 893 },
];

/** 사각형 안쪽 딤이 바깥으로 사라지는 거리(px). 넉넉해야 경계가 안 보인다. */
const VEIL_FEATHER = 160;
/** 원화를 못 재는 경우(폴백)의 행 안쪽 딤. */
const VEIL_FALLBACK_ALPHA = 0.36;
/** 딤 알파장 텍스처 해상도. 저주파 장이라 6px/텍셀이면 linear 확대로 이음매가 없다. */
const VEIL_TEX_W = 320;
const VEIL_TEX_H = 180;
/** 휘도 표본 격자 간격(디자인 px). */
const SAMPLE_STEP = 10;

/** 하단 비네트가 시작하는 y — CTA·메타 줄이 앉는 자리를 눌러 준다. */
const BOTTOM_SCRIM_TOP = 790;
const BOTTOM_SCRIM_ALPHA = 0.44;
/**
 * 화면 네 변을 두르는 가장자리 비네트. 중앙 ~1/3 은 손대지 않고(plateau) 가장자리에서만
 * 최대 알파에 닿는다.
 */
const EDGE_VIGNETTE_ALPHA = 0.34;
const EDGE_VIGNETTE_PLATEAU_X = 0.34;
const EDGE_VIGNETTE_PLATEAU_Y = 0.3;

// --- 공기 ---
/** 먼지 티끌 수(고티어). 저티어는 절반. 타이틀보다 적다 — 오래 보는 화면이라 산만하면 안 된다. */
const MOTE_COUNT = 34;
/** 광선 스윕 1회 주기(초)와 통과 시간. 대부분의 시간 동안 화면에 없어야 "가끔"으로 읽힌다. */
const SHAFT_PERIOD = 21;
const SHAFT_SWEEP = 3.4;

/** 절차적 폴백 팔레트 — 타이틀·인트로와 같은 붓(청록·자홍 성운, 금빛 램프광). */
const FALLBACK_BASE = 0x120e1e;
const FALLBACK_NEBULA_TEAL = 0x2f8ca0;
const FALLBACK_NEBULA_MAGENTA = 0x8a3a72;
const FALLBACK_LAMP = 0xffca78;

interface Mote {
  gfx: Graphics;
  baseX: number;
  baseY: number;
  speed: number;
  phase: number;
  amp: number;
}

/** 아주 느리게 알파가 오가는 발광체(절차적 폴백의 성운 얼룩). */
interface Breather {
  sprite: Sprite;
  base: number;
  period: number;
  phase: number;
}

/** 한 행의 딤 알파(안쪽 / 주변). {@link BaseBackdrop.rowDim} 의 반환형. */
interface RowDim {
  inner: number;
  surround: number;
}

/** 생성자 옵션. 전부 선택적이다 — 리드가 아무것도 넘기지 않아도 기본값으로 선다. */
export interface BaseBackdropOpts {
  /**
   * 타일 격자 행 사각형(디자인 스페이스). 행 개수 제한 없음 — 각 사각형이 독립적으로
   * 측정·보정된다. 넘기지 않으면 {@link DEFAULT_VEIL_RECTS}.
   */
  veilRects?: readonly BaseVeilRect[];
}

/**
 * 지금 유효한 이펙트 게이트. 오버라이드가 있으면 컨트롤러 대신 그 값을 쓴다 — 부팅 직후
 * 컨트롤러가 'high' 로 거짓말하는 창을 건너뛰기 위해서다(헤더 "품질 티어" 참조).
 */
function currentGates(): ReturnType<typeof effectGates> {
  const settings = graphicsSettings.getSettings();
  const tier =
    settings.quality === 'auto' ? graphicsTierController.getActiveTier() : settings.quality;
  return effectGates(tier, settings);
}

/** 0..1 을 부드럽게 잇는 표준 smoothstep(양 끝 기울기 0 — 단차가 눈에 남지 않는다). */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * 중심에서 `plateau` 까지 1, 거기서 경계까지 0 으로 떨어지는 축별 페이드. 가로·세로를 곱해
 * 쓰므로 모서리가 자연히 둥글고, 경계에서 정확히 0 이라 테두리가 생기지 않는다.
 */
function axisFade(u: number, plateau: number): number {
  const a = Math.abs(u);
  if (a <= plateau) return 1;
  if (plateau >= 1) return 1;
  return 1 - smoothstep((a - plateau) / (1 - plateau));
}

/** 점에서 사각형까지의 거리(안이면 0). 유클리드라 모서리가 자연히 둥글다. */
function distToRect(rect: BaseVeilRect, x: number, y: number): number {
  const dx = Math.max(rect.x0 - x, x - rect.x1, 0);
  const dy = Math.max(rect.y0 - y, y - rect.y1, 0);
  return Math.hypot(dx, dy);
}

/**
 * 가장자리 비네트의 알파(해석식). 굽는 텍스처와 **같은 식**이어야 측정이 실제 화면과 맞는다 —
 * 그래서 상수를 공유하고 식을 한 군데만 둔다.
 */
function edgeVignetteAlpha(x: number, y: number): number {
  const nx = (x / DESIGN_WIDTH) * 2 - 1;
  const ny = (y / DESIGN_HEIGHT) * 2 - 1;
  const inner = axisFade(nx, EDGE_VIGNETTE_PLATEAU_X) * axisFade(ny, EDGE_VIGNETTE_PLATEAU_Y);
  return EDGE_VIGNETTE_ALPHA * (1 - inner) ** 1.6;
}

/** 하단 스크림의 알파(해석식). `scrim.ts` 의 감마 1.6 램프와 같은 곡선이다. */
function bottomScrimAlpha(y: number): number {
  if (y <= BOTTOM_SCRIM_TOP) return 0;
  const t = (y - BOTTOM_SCRIM_TOP) / (DESIGN_HEIGHT - BOTTOM_SCRIM_TOP);
  return BOTTOM_SCRIM_ALPHA * Math.min(1, t) ** 1.6;
}

/** 캔버스 2D 컨텍스트를 만든다. 없는 환경(vitest)에서는 null — 호출부가 그 없이도 서야 한다. */
function makeCtx(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d', { willReadFrequently: true });
}

/** 캔버스를 Pixi 텍스처로(항상 `linear` — 저주파 알파장을 늘려 쓰기 때문). */
function canvasTexture(ctx: CanvasRenderingContext2D): Texture {
  const tex = new Texture({ source: new CanvasSource({ resource: ctx.canvas }) });
  tex.source.scaleMode = 'linear';
  return tex;
}

/**
 * 부드러운 사각형(또는 `plateau` 0 이면 블롭) 알파장을 픽셀로 굽는다.
 * @param invert true 면 중앙이 0, 가장자리가 최대(비네트).
 */
function bakeSoftRect(
  color: number,
  maxAlpha: number,
  plateauX: number,
  plateauY: number,
  invert = false,
): Texture | null {
  const w = 128;
  const h = 80;
  const ctx = makeCtx(w, h);
  if (ctx === null) return null;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ny = ((y + 0.5) / h) * 2 - 1;
    const fy = axisFade(ny, plateauY);
    for (let x = 0; x < w; x++) {
      const nx = ((x + 0.5) / w) * 2 - 1;
      const inner = axisFade(nx, plateauX) * fy;
      const a = maxAlpha * (invert ? (1 - inner) ** 1.6 : inner);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

/** 캔버스에 그릴 수 있는 이미지 자원인가(구울 수 없는 자원이면 흐림·측정을 포기한다). */
function drawableSource(res: unknown): CanvasImageSource | null {
  if (typeof HTMLImageElement !== 'undefined' && res instanceof HTMLImageElement) return res;
  if (typeof HTMLCanvasElement !== 'undefined' && res instanceof HTMLCanvasElement) return res;
  if (typeof ImageBitmap !== 'undefined' && res instanceof ImageBitmap) return res;
  return null;
}

/**
 * 화면 좌표 → 배경 원화 휘도(0..255)를 돌려주는 표본기. 흐림을 구운 캔버스를 그대로 읽으므로
 * **실제로 화면에 나가는 것**을 잰다.
 */
interface ArtSampler {
  /** 디자인 스페이스 좌표의 원화 휘도(화면 밖으로 매핑되면 가장자리 화소). */
  lumAt(x: number, y: number): number;
}

/** 구운 캔버스에서 표본기를 만든다. CORS 로 오염된 캔버스면 `null`(측정 포기 → 기본 딤). */
function makeArtSampler(ctx: CanvasRenderingContext2D): ArtSampler | null {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  // `coverSprite` 와 **같은 매핑**이어야 한다 — 다르면 엉뚱한 자리를 재게 된다.
  const k = Math.max(DESIGN_WIDTH / w, DESIGN_HEIGHT / h) * OVERSCAN;
  return {
    lumAt(x: number, y: number): number {
      const sx = Math.min(w - 1, Math.max(0, Math.round(w / 2 + (x - DESIGN_WIDTH / 2) / k)));
      const sy = Math.min(h - 1, Math.max(0, Math.round(h / 2 + (y - DESIGN_HEIGHT / 2) / k)));
      const i = (sy * w + sx) * 4;
      // Rec.601 루마. 인덱스는 항상 범위 안이지만 noUncheckedIndexedAccess 방어를 둔다.
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      return 0.299 * r + 0.587 * g + 0.114 * b;
    },
  };
}

/**
 * 배경을 **1회** 흐려 굽는다. 실패하면 `null` — 호출부는 원본을 그대로 쓴다(흐림은 덧붙임이라
 * 없어도 화면이 선다).
 *
 * 캔버스 `filter: blur()` 는 경계 바깥을 투명검정으로 샘플링해 테두리에 어두운 띠를 남긴다.
 * 그래서 원본을 반경의 몇 배만큼 **확대해 그려** 그 띠가 캔버스 밖으로 나가게 한다. 어차피
 * 이 텍스처는 오버스캔으로 더 확대돼 쓰이므로 잘려 나가는 몇 픽셀은 화면에 없다.
 */
function bakeBlurred(
  tex: Texture,
  radius: number,
): { texture: Texture; ctx: CanvasRenderingContext2D } | null {
  const w = Math.round(tex.source.width);
  const h = Math.round(tex.source.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const src = drawableSource(tex.source.resource);
  if (src === null) return null;
  const ctx = makeCtx(w, h);
  if (ctx === null) return null;
  try {
    ctx.filter = `blur(${radius}px)`;
    const grow = 1 + (radius * 3) / Math.min(w, h);
    const dw = w * grow;
    const dh = h * grow;
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.filter = 'none';
  } catch {
    return null; // `filter` 미지원 등 — 원본으로 간다.
  }
  return { texture: canvasTexture(ctx), ctx };
}

/** 텍스처를 화면 중앙에 `scale` 배 오버스캔으로 놓은 스프라이트(타이틀과 같은 규약). */
function coverSprite(tex: Texture, scale: number): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  const k = Math.max(DESIGN_WIDTH / tex.width, DESIGN_HEIGHT / tex.height) * scale;
  s.scale.set(k);
  s.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
  return s;
}

/** 결정적 의사난수 — 매 생성마다 배치가 튀지 않게 인덱스에서 파생한다(타이틀과 같은 식). */
function hash01(seed: number): number {
  return (((Math.sin(seed) * 43758.5453) % 1) + 1) % 1;
}

export class BaseBackdrop {
  /** 리드가 root 맨 뒤에 붙인다. */
  readonly view = new Container();

  /** 패럴랙스가 붙는 레이어. 딤·비네트는 여기 들어가지 않는다(고정). */
  private readonly artLayer = new Container();
  private readonly airLayer = new Container();

  private readonly motes: Mote[] = [];
  private shaft: Graphics | null = null;
  /** 절차적 폴백의 성운 얼룩 — 아주 느리게 숨 쉬듯 알파가 오간다. */
  private readonly breathers: Breather[] = [];
  /** 흐림을 굽느라 만든 텍스처. `view.destroy` 가 모르는 자원이라 직접 반납한다. */
  private bakedBlur: Texture | null = null;

  /** 격자 행 사각형(리드가 넘긴 실제 배치 또는 폴백). */
  private readonly rects: readonly BaseVeilRect[];
  /** 배경 원화 휘도 표본기. 없으면(폴백·CORS) 딤은 상수로 물러난다. */
  private sampler: ArtSampler | null = null;

  private time = 0;
  private aimX = 0;
  private aimY = 0;
  private curX = 0;
  private curY = 0;
  private readonly onPointerMove: (e: PointerEvent) => void;

  constructor(tex: Texture | undefined, opts?: BaseBackdropOpts) {
    this.rects = opts?.veilRects ?? DEFAULT_VEIL_RECTS;

    // 캔버스가 아니라 window 에 건다 — 커서가 캔버스 밖으로 나가도 마지막 값이 굳지 않고,
    // Pixi 이벤트 계층(위에 깔린 타일이 포인터를 삼키는 문제)과도 무관해진다.
    this.onPointerMove = (e: PointerEvent) => {
      if (!this.view.visible) return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      this.aimX = ((e.clientX / w) * 2 - 1) * MOUSE_RANGE;
      this.aimY = ((e.clientY / h) * 2 - 1) * MOUSE_RANGE;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    }

    const gates = currentGates();

    // --- 바닥 ---
    // 자산이 없거나 로드 전이어도 화면이 비지 않게. 오버스캔 배경 뒤에도 늘 깔아 둔다.
    const floor = new Graphics();
    floor.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: FALLBACK_BASE });
    this.view.addChild(floor);

    this.view.addChild(this.artLayer);
    this.view.addChild(this.airLayer);

    if (tex !== undefined) {
      // 피사계 심도 + 휘도 표본 — 같은 캔버스에서 둘 다 나온다(헤더 참조).
      const baked = bakeBlurred(tex, BLUR_RADIUS);
      if (baked !== null) {
        this.bakedBlur = baked.texture;
        this.sampler = makeArtSampler(baked.ctx);
      }
      this.artLayer.addChild(coverSprite(this.bakedBlur ?? tex, OVERSCAN));
    } else {
      this.buildProceduralArt();
    }

    // --- 공기: 먼지 티끌 ---
    if (gates.particles !== 'off') {
      const count = gates.particles === 'min' ? Math.round(MOTE_COUNT / 2) : MOTE_COUNT;
      for (let i = 0; i < count; i++) {
        const r1 = hash01((i + 1) * 12.9898);
        const r2 = hash01((i + 1) * 78.233);
        const r3 = hash01((i + 1) * 39.425);
        const g = new Graphics();
        g.circle(0, 0, 1.1 + r3 * 2.1).fill({ color: 0xffe6bb, alpha: 0.16 + r3 * 0.22 });
        // 가산 — 어두운 배경 위에서 램프광 속 먼지처럼 읽힌다(tint 는 곱연산이라 밝힐 수 없다).
        g.blendMode = 'add';
        const mote: Mote = {
          gfx: g,
          baseX: r1 * DESIGN_WIDTH,
          baseY: DESIGN_HEIGHT * 0.45 + r2 * DESIGN_HEIGHT * 0.62,
          // 타이틀(6~22)보다 느리다 — 오래 보는 화면에서는 빠른 입자가 시선을 뺏는다.
          speed: 3.5 + r3 * 9,
          phase: r1 * Math.PI * 2,
          amp: 5 + r2 * 11,
        };
        g.position.set(mote.baseX, mote.baseY);
        this.airLayer.addChild(g);
        this.motes.push(mote);
      }
    }

    // --- 공기: 가끔 지나는 광선(가산) ---
    if (gates.halo) {
      // 단일 사각형이면 좌우 경계가 칼같이 서서 **광선이 아니라 띠**로 읽힌다(타이틀 실측).
      // Pixi Graphics 에는 그라디언트가 없으므로 폭이 다른 사각형을 중심에서 겹쳐 쌓아 단면을
      // 만든다 — 같은 색을 가산으로 쌓는 것이라 알파 이중가산 가로줄(scrim 함정)과는 무관하다.
      const shaft = new Graphics();
      const slabs = 7;
      for (let i = slabs; i >= 1; i--) {
        const halfW = 30 * i;
        const a = 0.075 * (1 - (i - 1) / slabs) ** 1.5;
        shaft
          .rect(-halfW, -DESIGN_HEIGHT, halfW * 2, DESIGN_HEIGHT * 3)
          .fill({ color: FALLBACK_LAMP, alpha: a });
      }
      shaft.rotation = 0.22;
      shaft.y = DESIGN_HEIGHT / 2;
      shaft.blendMode = 'add';
      shaft.visible = false;
      this.airLayer.addChild(shaft);
      this.shaft = shaft;
    }

    // --- 대비 장치(고정 — 패럴랙스 밖) ---
    this.buildDimField();
    this.buildVignettes();
  }

  /** 자산이 없을 때의 절차적 배경 — 짙은 바탕 위 성운 얼룩 + 좌우 램프광. */
  private buildProceduralArt(): void {
    const put = (
      color: number,
      x: number,
      y: number,
      w: number,
      h: number,
      alpha: number,
      period: number,
    ): void => {
      const tex = bakeSoftRect(color, 1, 0, 0);
      if (tex === null) return;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.width = w;
      s.height = h;
      s.position.set(x, y);
      s.alpha = alpha;
      s.blendMode = 'add';
      this.artLayer.addChild(s);
      this.breathers.push({ sprite: s, base: alpha, period, phase: this.breathers.length });
    };

    // 성운 두 덩이 — 중앙 위쪽(아치 너머)에서 청록·자홍이 겹친다.
    put(FALLBACK_NEBULA_TEAL, 900, 380, 1500, 900, 0.52, 23);
    put(FALLBACK_NEBULA_MAGENTA, 1180, 300, 1150, 720, 0.36, 31);
    // 좌우 벽의 금색 램프광 — 화면 양옆을 따뜻하게 붙잡아 "실내"로 읽히게 한다.
    put(FALLBACK_LAMP, 120, 620, 900, 1300, 0.22, 37);
    put(FALLBACK_LAMP, DESIGN_WIDTH - 120, 620, 900, 1300, 0.22, 43);
  }

  /**
   * **행 인덱스 하나만 받아** 그 행의 딤 알파를 계산한다 — 이 클래스에서 딤 세기를 정하는
   * 유일한 자리다. 행마다 다른 상수를 두는 것이 원리적으로 불가능하므로, 행이 둘이든 셋이든
   * 같은 규칙이 적용된다(2차 실패 = 위아래 행이 서로 다른 규칙을 따른 것).
   *
   * 방식: 그 행의 **안쪽**(사각형 내부)과 **주변**(사각형 밖 {@link SURROUND_REACH} 이내이면서
   * 다른 행보다 이 행에 더 가까운 곳)에서 실제 화면 휘도 — 원화 × (1−가장자리비네트) ×
   * (1−하단스크림) — 의 평균을 재고, 목표 휘도에 닿는 알파를 역산한다(`a = 1 − 목표/현재`).
   * 원화가 이미 목표보다 어두우면 하한값이다 — **딤은 필요한 곳에만 생긴다.**
   */
  private rowDim(rowIndex: number): RowDim {
    const rect = this.rects[rowIndex];
    const sampler = this.sampler;
    if (rect === undefined || sampler === null) {
      return { inner: VEIL_FALLBACK_ALPHA, surround: 0 };
    }

    let innerSum = 0;
    let innerN = 0;
    let surroundSum = 0;
    let surroundN = 0;

    for (let y = SAMPLE_STEP / 2; y < DESIGN_HEIGHT; y += SAMPLE_STEP) {
      for (let x = SAMPLE_STEP / 2; x < DESIGN_WIDTH; x += SAMPLE_STEP) {
        const d = distToRect(rect, x, y);
        if (d > SURROUND_REACH) continue;
        // 주변 표본은 **가장 가까운 행에만** 귀속시킨다. 안 그러면 행 사이 여백이 두 행에
        // 이중 계상되어 서로 다른 목표를 향해 당겨진다.
        if (d > 0 && !this.isNearestRow(rowIndex, x, y, d)) continue;
        const lum = sampler.lumAt(x, y) * (1 - edgeVignetteAlpha(x, y)) * (1 - bottomScrimAlpha(y));
        if (d === 0) {
          innerSum += lum;
          innerN++;
        } else {
          surroundSum += lum;
          surroundN++;
        }
      }
    }

    const solve = (sum: number, n: number, target: number, floor: number): number => {
      if (n === 0) return floor;
      const mean = sum / n;
      if (mean <= target) return floor;
      return Math.min(MAX_DIM, Math.max(floor, 1 - target / mean));
    };

    return {
      inner: solve(innerSum, innerN, TARGET_INNER_L, MIN_INNER_DIM),
      surround: solve(surroundSum, surroundN, TARGET_SURROUND_L, 0),
    };
  }

  /** 점 (x,y) 가 `rowIndex` 행에 가장 가까운가(거리 `d` 는 이미 잰 값). */
  private isNearestRow(rowIndex: number, x: number, y: number, d: number): boolean {
    for (let j = 0; j < this.rects.length; j++) {
      const other = this.rects[j];
      if (j === rowIndex || other === undefined) continue;
      if (distToRect(other, x, y) < d) return false;
    }
    return true;
  }

  /**
   * 딤 알파장 한 장. 텍셀 알파 = 행별 기여의 **최댓값**이라 행이 가까워도 알파가 이중으로
   * 쌓이지 않는다(헤더 "베일" 참조).
   *
   * 행별 기여는 거리 `d` 의 연속함수 두 개의 최댓값이다:
   *  - 안쪽 딤: `inner` 에서 시작해 {@link VEIL_FEATHER} 에서 0.
   *  - 주변 딤: `surround` 에서 시작해 {@link SURROUND_REACH} 에서 0(더 멀리, 더 완만하게).
   * 둘 다 d=0 에서 최대이고 연속이므로 최댓값도 연속이다 → 어디에도 단차가 없다.
   */
  private buildDimField(): void {
    if (this.rects.length === 0) return;
    const ctx = makeCtx(VEIL_TEX_W, VEIL_TEX_H);
    if (ctx === null) return;
    const dims = this.rects.map((_, i) => this.rowDim(i));
    const img = ctx.createImageData(VEIL_TEX_W, VEIL_TEX_H);
    for (let ty = 0; ty < VEIL_TEX_H; ty++) {
      const py = ((ty + 0.5) / VEIL_TEX_H) * DESIGN_HEIGHT;
      for (let tx = 0; tx < VEIL_TEX_W; tx++) {
        const px = ((tx + 0.5) / VEIL_TEX_W) * DESIGN_WIDTH;
        let best = 0;
        for (let i = 0; i < this.rects.length; i++) {
          const rect = this.rects[i];
          const dim = dims[i];
          if (rect === undefined || dim === undefined) continue;
          const d = distToRect(rect, px, py);
          if (d < VEIL_FEATHER) {
            const a = dim.inner * (1 - smoothstep(d / VEIL_FEATHER));
            if (a > best) best = a;
          }
          if (d < SURROUND_REACH) {
            const a = dim.surround * (1 - smoothstep(d / SURROUND_REACH));
            if (a > best) best = a;
          }
        }
        const i = (ty * VEIL_TEX_W + tx) * 4;
        img.data[i] = 0x0a;
        img.data[i + 1] = 0x08;
        img.data[i + 2] = 0x12;
        img.data[i + 3] = Math.round(best * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const s = new Sprite(canvasTexture(ctx));
    s.position.set(0, 0);
    s.width = DESIGN_WIDTH;
    s.height = DESIGN_HEIGHT;
    this.view.addChild(s);
  }

  /** 하단 스크림(CTA·메타 줄 자리) + 네 변 비네트(시선을 화면 안쪽으로 모은다). */
  private buildVignettes(): void {
    const edge = bakeSoftRect(
      0x07050e,
      EDGE_VIGNETTE_ALPHA,
      EDGE_VIGNETTE_PLATEAU_X,
      EDGE_VIGNETTE_PLATEAU_Y,
      true,
    );
    if (edge !== null) {
      const s = new Sprite(edge);
      s.position.set(0, 0);
      s.width = DESIGN_WIDTH;
      s.height = DESIGN_HEIGHT;
      this.view.addChild(s);
    }
    // 세로 램프는 공용 `scrim.ts` 를 쓴다 — 띠 근사가 만들던 가로줄을 없앤 자리다.
    const scrimTex = verticalScrimTexture(0, BOTTOM_SCRIM_ALPHA);
    if (scrimTex !== null) {
      const scrim = new Sprite(scrimTex);
      scrim.position.set(0, BOTTOM_SCRIM_TOP);
      scrim.width = DESIGN_WIDTH;
      scrim.height = DESIGN_HEIGHT - BOTTOM_SCRIM_TOP;
      this.view.addChild(scrim);
    }
  }

  /** 매 프레임 진행. `dt` 는 **벽시계 초**다. 숨겨져 있으면 아무것도 하지 않는다. */
  update(dt: number): void {
    if (!this.view.visible) return;
    this.time += dt;

    // 지수 추종 — 프레임률이 달라도 같은 시상수가 되도록 dt 지수 감쇠를 쓴다.
    const k = 1 - Math.exp(-MOUSE_LERP * dt);
    this.curX += (this.aimX - this.curX) * k;
    this.curY += (this.aimY - this.curY) * k;

    const driftX = Math.sin((this.time / DRIFT_PERIOD_X) * Math.PI * 2) * DRIFT_AMPL;
    const driftY = Math.cos((this.time / DRIFT_PERIOD_Y) * Math.PI * 2) * DRIFT_AMPL * 0.6;
    const ox = this.curX + driftX;
    const oy = this.curY + driftY;

    this.artLayer.position.set(ox * PARALLAX.art, oy * PARALLAX.art);
    this.airLayer.position.set(ox * PARALLAX.air, oy * PARALLAX.air);

    // 먼지 — 아주 느리게 떠오른다. 위로 벗어나면 아래로 되감는다.
    for (const m of this.motes) {
      m.gfx.y = m.baseY - ((this.time * m.speed) % (DESIGN_HEIGHT * 0.75));
      m.gfx.x = m.baseX + Math.sin(this.time * 0.4 + m.phase) * m.amp;
    }

    // 발광체의 미세한 호흡 — 폴백에서도 화면이 완전히 정지하지 않게(기준값 ±10%).
    for (const b of this.breathers) {
      b.sprite.alpha = b.base * (1 + 0.1 * Math.sin((this.time / b.period) * Math.PI * 2 + b.phase));
    }

    // 광선 — 주기의 앞부분(SHAFT_SWEEP 초) 동안만 화면을 가로지른다.
    const shaft = this.shaft;
    if (shaft !== null) {
      const phase = this.time % SHAFT_PERIOD;
      if (phase < SHAFT_SWEEP) {
        const p = phase / SHAFT_SWEEP;
        shaft.visible = true;
        shaft.x = DESIGN_WIDTH * (-0.3 + p * 1.6);
        // 양 끝에서 0 이 되는 사인 페이드 — 갑자기 나타났다 사라지지 않게.
        shaft.alpha = Math.sin(p * Math.PI);
      } else {
        shaft.visible = false;
      }
    }
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMove);
    }
    this.motes.length = 0;
    this.breathers.length = 0;
    this.shaft = null;
    this.sampler = null;
    this.view.destroy({ children: true });
    // 구운 흐림 텍스처는 스프라이트가 아니라 우리가 만든 자원이다 — 직접 반납한다.
    this.bakedBlur?.destroy(true);
    this.bakedBlur = null;
  }
}
