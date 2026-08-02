/**
 * 격납고 화면 배경 — 풀블리드 시네마틱 키아트 + **창 보존 / 창 밖 억제** 톤 처리 + 공기.
 *
 * `baseBackdrop.ts`(기지)에서 검증된 관용구를 복제했다: 캔버스 1회 굽기 · 픽셀로 굽는 램프 ·
 * 가산 환경광 · 다중 옥타브 그레인 · 오버스캔 커버 · 포인터 추종. **그 파일은 기지 화면이 쓰고
 * 있어 수정 금지**라(레인 계약 §2) 복제이고, 아래 값들은 격납고 기준으로 다시 잡은 것이다.
 *
 * ## 왜 기지의 `veilRects` 와 **논리가 반대**인가
 * 기지는 배경 위에 카드가 띄엄띄엄 놓인 화면이라 "격자 **안쪽**을 눌러" 카드를 띄웠다. 격납고는
 * 패널 4장이 화면의 약 97%를 덮는 **조작 화면**이다. 배경이 실제로 보이는 자리는 둘뿐이다:
 *  - **헤더 밴드** y 0..`headerH`(전폭) — 제목 각인과 재화 칩이 얹힌다.
 *  - **쇼케이스 창** `windows`(디자인 952,112,936,496) — 이 화면의 유일한 볼거리다.
 *
 * 그래서 여기서는 **창 안쪽을 보존하고 바깥을 강하게 누른다.** 이유가 둘이다.
 *  1. 패널이 덮는 자리의 밝기는 화면에 나오지 않으므로 그냥 낭비다.
 *  2. 패널 **가장자리로 새어 보이는** 배경이 패널 면보다 밝으면 도-지가 반전된다 — 기지 2라운드
 *     에서 실제로 겪은 결함이다("가장 밝은 화소가 아무것도 없는 배경"). Lane B 의 석재 슬래브는
 *     "배경(눌린 상태)보다 밝아야 물체로 선다"는 전제로 만들어지므로, 그 전제를 **여기가**
 *     보장해야 한다.
 *
 * ## 왜 알파 딤이 아니라 굽는 곱연산인가 — 그리고 왜 여기서는 곱이 **옳은가**
 * 기지 헤더는 "알파 곱이 평균과 대비를 같은 비율로 함께 죽인다"는 이유로 곱을 버리고 국소
 * 톤매핑으로 갔다. 그 화면은 눌린 자리가 **화면에 계속 보이는 네거티브 스페이스**였기 때문이다.
 * 격납고에서 눌리는 자리는 **패널이 덮어 보이지 않는 자리**라 대비를 함께 잃어도 손해가 없고,
 * 오히려 "패널보다 어둡다"가 곱연산으로 **구조적으로 보장**되는 편이 안전하다(§6-3 "대비는
 * 곱연산으로 관리하라 — 배경 절대값을 가정하지 마라"). 창 안쪽은 계수가 정확히 1 이라
 * **원화 그대로**이므로, 보존해야 할 것에는 아무 상한도 걸리지 않는다(§6-1).
 *
 * 곱 하나로는 두 가지가 부족해서 각각 전용 장치를 둔다.
 *  - **크러시**: 곱은 어두운 화소를 0 쪽으로만 민다 → 눌린 영역에 **가산 환경광**을 더한다
 *    (곱이나 하한으로는 못 고친다 — `0 × 무엇 = 0`).
 *  - **폭주 하이라이트**: 원화의 밝은 도크 램프가 헤더 밴드에 걸리면 계수를 곱해도 글자 대비를
 *    깬다 → 눌린 영역에만 **천장 무릎**을 둔다. 이건 균일도 상한이 아니라 상한 **하나**이고,
 *    창에는 걸리지 않는다.
 *
 * ## 대비 보장을 왜 "곱연산"으로 말하는가
 * 헤더 출력은 `out ≤ A·k + ambient` 이고 그 위에 천장 무릎이 걸린다. 즉 **원화가 얼마나 밝든**
 * 헤더 배경의 상한이 정해지므로, 그 위에 얹히는 금박 각인(Lane C)과의 대비가 원화 밝기와
 * 무관하게 성립한다. 절대 델타로 잡으면 원화가 바뀔 때마다 다시 틀린다(§6-4).
 *
 * ## 왜 헤더는 **중간** 세기인가
 * 완전히 눌러 검게 만들면 헤더가 다시 평면이 되어 "제목 얹은 검은 띠"가 된다(그러면 시네마틱
 * 전환의 이유가 사라진다). 반대로 안 누르면 각인과 재화 칩 글자가 안 읽힌다. {@link HEADER_K}
 * 와 {@link HEADER_CEIL_L} 이 그 사이를 잡는다.
 *
 * ## 왜 패럴랙스가 기지의 절반 이하인가
 * 기지 `MOUSE_RANGE` 는 11 이다. 격납고는 **클릭하는 화면**이라 같은 진폭이면 커서를 움직일
 * 때마다 배경이 흔들려 조작이 불안정한 느낌을 준다. 게다가 배경이 보이는 자리가 창 하나라
 * 큰 진폭은 창 안에서 원화가 미끄러지는 것으로만 보인다 — 이득이 없다.
 *
 * ## 공기를 왜 창 안에만 두는가
 * 티끌·램프 맥동은 **보이는 자리에서만** 값을 낸다. 창 밖은 패널이 덮으므로 거기 티끌을 두면
 * 드로우콜만 쓰고 화면에는 안 나온다. 그래서 공기 레이어는 창 사각형으로 마스크한다. 마스크는
 * **패럴랙스 레이어의 자식이 아니라 `view` 의 자식**이다 — 창은 화면에 고정된 구멍이고 그 안의
 * 내용물만 움직여야 하기 때문이다.
 *
 * ## 자산 없이도 서야 한다
 * `tex` 가 `undefined` 면 절차적 폴백으로 넘어간다(짙은 바탕 + 청록·자홍 성운 + 우측 도크 램프광).
 * 그 경로에는 구울 원화가 없으므로 같은 계수장을 **알파 오버레이 한 장**으로 얹는다 — 검은 알파
 * 오버레이는 `dst·(1−a)` 라 곱과 정확히 같은 연산이고, `a = 1 − k` 로 두면 굽는 경로와 결과가
 * 일치한다.
 *
 * ## 품질 티어
 * ⚠️ `graphicsTierController.getActiveTier()` 만 읽으면 안 된다(레인 계약 §0-3). 그 컨트롤러는
 * `'high'` 로 시작해 렌더 루프가 돌아야 갱신되므로, 부팅 직후 진입하면 사용자가 'low' 로 못박아
 * 둔 설정이 통째로 무력화된다(타이틀에서 실제로 밟은 함정). 설정의 명시적 오버라이드를 직접 읽는다.
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
/**
 * 마우스 추종 최대 변위(px). 기지 11 의 **절반 이하**(계약 §3 Lane A). 조작 화면이라 배경이
 * 크게 움직이면 클릭 목표가 흔들리는 느낌을 준다 — 전경(패널·슬롯)은 리드가 고정으로 붙인다.
 */
const MOUSE_RANGE = 5;
/** 마우스 목표값 추종 시상수. 커서가 튀어도 배경은 부드럽게 따라간다. */
const MOUSE_LERP = 2.6;
/** 자동 드리프트 — 입력이 없어도(터치 기기) 창 안이 정지하지 않게. 진폭도 절반 이하다. */
const DRIFT_AMPL = 3;
/** 서로소에 가까운 주기 — 왕복이 눈에 띄지 않는다. */
const DRIFT_PERIOD_X = 43;
const DRIFT_PERIOD_Y = 61;
/** 레이어별 패럴랙스 계수. 근경(공기)이 원경(배경판)보다 더 움직이는 것이 깊이의 정의다. */
const PARALLAX = { art: 1, air: 1.4 } as const;

/**
 * 배경판 오버스캔 배수. 드리프트(≈±8px)로 밀려도 가장자리가 드러나지 않을 만큼만 크게 그린다.
 * 기지(1.1)보다 작은 것은 진폭이 절반 이하라서다 — 필요 이상 확대하면 원화 해상도를 버린다.
 */
const OVERSCAN = 1.06;

/**
 * 피사계 심도용 흐림 반경(원화 픽셀). 창 안에는 Lane B 의 유리 반사와 리드의 기체가 얹히므로
 * 배경이 같은 초점면에 있으면 깊이가 안 생긴다. 다만 **원화 구조(도크 프레임·램프 코어)를
 * 뭉개면 창이 볼거리이기를 그만두므로** 기지(4)보다 약하게 건다.
 *
 * Pixi `BlurFilter` 가 아니라 캔버스에서 1회 굽는 이유: 배경은 절대 변하지 않는데 필터는 매
 * 프레임 2패스라, 오래 머무는 화면에서 계속 비용을 낸다(기지와 같은 판단).
 */
const BLUR_RADIUS = 3;

// --- 영역별 계수 (전부 곱연산. 창은 1 = 항등식) ---
/**
 * 창 밖(패널이 덮는 자리) 휘도 계수. 강하게 누른다.
 *
 * Lane B 의 석재 슬래브는 "배경보다 밝아야 물체로 선다"를 전제로 만들어진다. 그 전제를 **배경이**
 * 보장해야 하고, 곱연산이라 원화가 어떤 밝기여도 같은 비율만큼 내려간다 — 절대값을 가정하지
 * 않는다는 것이 이 값의 요점이다(§6-3).
 */
const OUTSIDE_K = 0.3;
/**
 * 창 밖 휘도 천장(무릎 시작점). 원화 우측 도크의 밝은 램프가 패널 가장자리 틈으로 새어 나오는
 * 것을 막는다 — 도-지 반전은 평균이 아니라 **가장 밝은 화소**가 만든다(§6-2 "평균은 결함을
 * 가린다"). 창에는 걸리지 않으므로 볼거리는 손상되지 않는다.
 */
const OUTSIDE_CEIL_L = 44;
/**
 * 헤더 밴드 휘도 계수. **중간 세기**다 — 위 헤더 "왜 헤더는 중간 세기인가" 참조.
 */
const HEADER_K = 0.46;
/**
 * 헤더 밴드 휘도 천장. 각인 제목(밝은 금박 ≈ L 200 대)과의 대비가 원화 밝기와 무관하게
 * 성립하도록 배경 상한을 못 박는 값이다. `200 / (62 × 0.9)` 급이면 4.5:1 여유가 있다.
 * ⚠️ 이건 **상한 하나**이지 균일도 상한이 아니다 — 밴드 안의 명암 구성은 그대로 남는다(§6-1).
 */
const HEADER_CEIL_L = 62;
/** 창 안 계수·천장. 계수 1 = 항등식, 천장은 사실상 없음(보존해야 할 것에 상한을 걸지 않는다). */
const WINDOW_K = 1;
const WINDOW_CEIL_L = 1e4;

/**
 * 창 경계 페더(px). 창 가장자리는 Lane B 의 유리 프레임이 덮으므로 이 폭이 프레임 안에서
 * 끝난다 — 계수 계단이 화면에 노출되지 않는다. 0 으로 두면 사각형 경계선이 그대로 보인다.
 */
const WINDOW_FEATHER = 30;
/** 헤더 밴드 아래 경계 페더(px). 패널 상단(y 112)까지 8px 여유가 있어 그 안에서 끝난다. */
const HEADER_FEATHER = 26;

/**
 * 눌린 영역에 **더하는** 따뜻한 환경광(휘도). 곱이 아니라 합이어야 한다 — 순흑 화소는 어떤
 * 배율로도 검정이라 곱만으로는 크러시를 절대 못 푼다(기지에서 실측으로 확인된 형태다).
 * 창(계수 1)에서는 세기가 0 이라 **원화가 그대로 남는다**.
 */
const AMBIENT_LUM = 9;
/** 환경광 색(금빛 램프 반사)을 휘도 1 로 정규화한 계수. */
const AMBIENT_R = 1.1445;
const AMBIENT_G = 0.9829;
const AMBIENT_B = 0.7091;

/**
 * 눌린 영역의 그레인 진폭(휘도 std).
 *
 * ⚠️ 큰 값은 이 리포 최악의 회귀였다(기지에서 30 으로 올렸다가 페인터리 홀이 얼룩진 콘크리트가
 * 됐고, 덤으로 큰 진폭이 어두운 화소를 0 으로 잘라 순흑을 되살렸다). 여기서 그레인의 유일한
 * 목적은 **강하게 눌린 어두운 면의 밴딩을 디더링**하는 것이라 그만큼만 준다. 창에서는 세기가
 * 0 이라 원화에 아무것도 얹히지 않는다.
 */
const GRAIN_LUM = 4;
/** 그레인이 완전 진폭에 닿는 휘도. 이 아래에서는 0 클리핑 편향을 피해 진폭을 줄인다. */
const GRAIN_FADE_L = 60;
/** 그레인 색(거의 중성, 아주 살짝 따뜻)의 휘도 1 정규화 계수. */
const GRAIN_R = 1.06;
const GRAIN_G = 1;
const GRAIN_B = 0.9;

// --- 대비 장치(전경에 붙는 고정 레이어) ---
/**
 * 화면 네 변의 **띠형** 곱 비네트. 전면 감쇠가 아니라 띠인 이유는 기지와 같다 — 전면으로 걸면
 * 창 안쪽까지 서로 다른 양으로 눌려 보존이 깨진다. 띠는 창(x 952.. / y 112..)에 닿지 않는다.
 */
const EDGE_VIGNETTE_ALPHA = 0.24;
const EDGE_VIGNETTE_BAND = 72;
/** 하단 비네트. 힌트 줄(y 1058)이 앉는 자리를 눌러 글자를 세운다. */
const BOTTOM_SCRIM_TOP = 940;
const BOTTOM_SCRIM_ALPHA = 0.26;

// --- 공기(창 안에서만) ---
/** 창 안 먼지 티끌 수(고티어). 저티어는 절반. 창 하나뿐이라 기지(34)보다 적다. */
const MOTE_COUNT = 16;
/** 램프 맥동 정점 알파와 주기(초). **꺼지지 않고** 세기만 아주 느리게 오간다. */
const LAMP_ALPHA = 0.13;
const LAMP_PERIOD = 23;
/** 맥동 진폭(정점 대비 비율). 눈에 띄면 깜빡임이고, 없으면 정지 이미지다. */
const LAMP_BREATH = 0.18;

/** 절차적 폴백 팔레트 — 타이틀·인트로·기지와 같은 붓(청록·자홍 성운, 금빛 램프광). */
const FALLBACK_BASE = 0x120e1e;
const FALLBACK_NEBULA_TEAL = 0x2f8ca0;
const FALLBACK_NEBULA_MAGENTA = 0x8a3a72;
const FALLBACK_LAMP = 0xffca78;

/** 계수장 텍스처 해상도(폴백 오버레이용). 계수가 저주파라 이중선형으로 충분히 매끄럽다. */
const PRESS_TEX_W = 240;
const PRESS_TEX_H = 135;

/** 배경이 **그대로 보여야 하는** 창(디자인 스페이스). */
export interface HangarWindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HangarBackdropOpts {
  /** 배경이 그대로 보여야 하는 창(쇼케이스 패널 자리). 여기만 밝기를 보존한다. */
  windows: readonly HangarWindowRect[];
  /** 헤더 밴드 높이 — 그 위쪽은 중간 세기로 누른다(제목·칩이 얹힌다). */
  headerH: number;
}

interface Mote {
  gfx: Graphics;
  baseX: number;
  baseY: number;
  span: number;
  speed: number;
  phase: number;
  amp: number;
}

/** 아주 느리게 알파가 오가는 발광체(램프 맥동·폴백 성운 얼룩이 같은 장치를 쓴다). */
interface Breather {
  sprite: Sprite;
  base: number;
  period: number;
  phase: number;
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

/** Rec.601 루마(기지와 같은 식 — 두 화면의 휘도 판정이 갈리지 않게). */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
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

/** 점에서 창 사각형까지의 거리(안이면 0). 유클리드라 모서리가 자연히 둥글다. */
function distToWindow(rect: HangarWindowRect, x: number, y: number): number {
  const dx = Math.max(rect.x - x, x - (rect.x + rect.w), 0);
  const dy = Math.max(rect.y - y, y - (rect.y + rect.h), 0);
  return Math.hypot(dx, dy);
}

/**
 * 가장자리 비네트의 알파(해석식). 굽는 텍스처와 같은 식을 한 군데만 둔다.
 */
function edgeVignetteAlpha(x: number, y: number): number {
  const d = Math.min(x, DESIGN_WIDTH - x, y, DESIGN_HEIGHT - y);
  if (d >= EDGE_VIGNETTE_BAND) return 0;
  return EDGE_VIGNETTE_ALPHA * (1 - smoothstep(d / EDGE_VIGNETTE_BAND));
}

/** 캔버스 2D 컨텍스트. 없는 환경(vitest)에서는 null — 호출부가 그 없이도 서야 한다. */
function makeCtx(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    return null;
  }
}

/** 캔버스를 Pixi 텍스처로(항상 `linear` — 저주파 장을 늘려 쓰기 때문). */
function canvasTexture(ctx: CanvasRenderingContext2D): Texture {
  const tex = new Texture({ source: new CanvasSource({ resource: ctx.canvas }) });
  tex.source.scaleMode = 'linear';
  return tex;
}

/** 결정적 2D 해시(0..1). 시드가 같으면 언제나 같은 결 — 재생성마다 자글거리지 않는다. */
function hash2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 결정적 의사난수 — 매 생성마다 배치가 튀지 않게 인덱스에서 파생한다. */
function hash01(seed: number): number {
  return (((Math.sin(seed) * 43758.5453) % 1) + 1) % 1;
}

/**
 * 셀 크기 `cx`×`cy` 의 값 노이즈 한 옥타브(이중선형). `cx ≠ cy` 면 방향성이 생긴다 —
 * 석재 결이 그 형태다. (`baseBackdrop.ts` 에서 복제.)
 */
function noiseOctave(
  out: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  amp: number,
  seed: number,
): void {
  const gw = Math.ceil(w / cx) + 2;
  const gh = Math.ceil(h / cy) + 2;
  const lat = new Float32Array(gw * gh);
  for (let i = 0; i < lat.length; i++) {
    lat[i] = hash2(i % gw, Math.floor(i / gw), seed) - 0.5;
  }
  for (let y = 0; y < h; y++) {
    const fy = y / cy;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x / cx;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const v00 = lat[y0 * gw + x0] ?? 0;
      const v10 = lat[y0 * gw + x0 + 1] ?? 0;
      const v01 = lat[(y0 + 1) * gw + x0] ?? 0;
      const v11 = lat[(y0 + 1) * gw + x0 + 1] ?? 0;
      const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
      out[y * w + x] = (out[y * w + x] ?? 0) + v * amp;
    }
  }
}

/**
 * 눌린 면의 디더 그레인. **단일 스케일 노이즈는 즉시 CG 로 읽히므로** 입자 크기를 섞는다
 * (기지에서 얻은 결론). 마지막에 평균 0·표준편차 1 로 정규화한다 — 그레인이 밝기를 움직이면
 * 계수장이 보장하는 밝기 위계가 흔들리므로, 진폭이 아니라 **분포**를 고정하는 것이 안전하다.
 */
function bakeGrainField(w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  noiseOctave(g, w, h, 2, 2, 1, 23);
  noiseOctave(g, w, h, 4, 4, 0.9, 37);
  noiseOctave(g, w, h, 9, 9, 0.6, 51);
  noiseOctave(g, w, h, 24, 24, 0.4, 71);
  noiseOctave(g, w, h, 3, 28, 0.5, 67); // 세로 석재 결
  noiseOctave(g, w, h, 44, 4, 0.35, 83); // 가로 퇴적층
  let sum = 0;
  for (let i = 0; i < g.length; i++) sum += g[i] ?? 0;
  const mean = sum / g.length;
  let sq = 0;
  for (let i = 0; i < g.length; i++) sq += ((g[i] ?? 0) - mean) ** 2;
  const std = Math.sqrt(sq / g.length) || 1;
  for (let i = 0; i < g.length; i++) g[i] = ((g[i] ?? 0) - mean) / std;
  return g;
}

/** 캔버스에 그릴 수 있는 이미지 자원인가(구울 수 없으면 원본을 그대로 쓴다). */
function drawableSource(res: unknown): CanvasImageSource | null {
  if (typeof HTMLImageElement !== 'undefined' && res instanceof HTMLImageElement) return res;
  if (typeof HTMLCanvasElement !== 'undefined' && res instanceof HTMLCanvasElement) return res;
  if (typeof ImageBitmap !== 'undefined' && res instanceof ImageBitmap) return res;
  return null;
}

/**
 * 원화를 지정 반경으로 흐려 굽고 화소를 돌려준다.
 *
 * 캔버스 `filter: blur()` 는 경계 바깥을 투명검정으로 샘플링해 테두리에 어두운 띠를 남긴다.
 * 그래서 원본을 반경의 몇 배만큼 **확대해 그려** 그 띠가 캔버스 밖으로 나가게 한다(기지와 동일).
 */
function blurPixels(
  src: CanvasImageSource,
  w: number,
  h: number,
  radius: number,
): Uint8ClampedArray | null {
  const ctx = makeCtx(w, h);
  if (ctx === null) return null;
  try {
    ctx.filter = `blur(${radius}px)`;
    const grow = 1 + (radius * 3) / Math.min(w, h);
    const dw = w * grow;
    const dh = h * grow;
    ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.filter = 'none';
    return ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null; // `filter` 미지원 · CORS 오염 — 굽기를 포기하고 원본을 쓴다.
  }
}

/** 텍스처를 화면 중앙에 `scale` 배 오버스캔으로 놓은 스프라이트(타이틀·기지와 같은 규약). */
function coverSprite(tex: Texture, scale: number): Sprite {
  const s = new Sprite(tex);
  s.anchor.set(0.5);
  const k = Math.max(DESIGN_WIDTH / tex.width, DESIGN_HEIGHT / tex.height) * scale;
  s.scale.set(k);
  s.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
  return s;
}

/**
 * 부드러운 블롭 알파장(램프 맥동·폴백 성운용). 픽셀로 굽는다 — 띠를 겹쳐 그라디언트를
 * 근사하면 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다(레인 계약 §0-4).
 */
function bakeSoftBlob(color: number, plateauX: number, plateauY: number): Texture | null {
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
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(axisFade(nx, plateauX) * fy * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

/** 가장자리 띠형 곱 비네트를 픽셀로 굽는다(띠 적층 금지 — §0-4). */
function bakeEdgeVignette(): Texture | null {
  const w = 256;
  const h = 144;
  const ctx = makeCtx(w, h);
  if (ctx === null) return null;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const py = ((y + 0.5) / h) * DESIGN_HEIGHT;
    for (let x = 0; x < w; x++) {
      const px = ((x + 0.5) / w) * DESIGN_WIDTH;
      const i = (y * w + x) * 4;
      img.data[i] = 0x07;
      img.data[i + 1] = 0x05;
      img.data[i + 2] = 0x0e;
      img.data[i + 3] = Math.round(edgeVignetteAlpha(px, py) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

/**
 * 천장 무릎 — `ceil` 위를 자르지 않고 지수적으로 수렴시킨다. 하드 클립은 밝은 자리를 평면으로
 * 만들어 "포토샵 레벨 자른 티"가 나고, 그 평면이 다시 도-지 반전을 부른다.
 */
function kneeCeil(v: number, ceil: number): number {
  if (v <= ceil) return v;
  const head = Math.max(1, ceil * 0.5);
  return ceil + head * (1 - Math.exp(-(v - ceil) / head));
}

/**
 * 영역 계수장 — 디자인 좌표에서 `{k, ceil, press}` 를 준다.
 *
 * 세 영역을 **선형 혼합**으로 잇는다(사각형으로 자르면 경계선이 보인다). 창이 가장 우선이라
 * 마지막에 창 쪽으로 당긴다 — 창과 헤더가 겹칠 일은 지금 좌표에서 없지만, 겹치더라도 창의
 * 보존이 이기는 것이 옳다(보존은 하한이고 억제는 편의다, §6-1).
 *
 * `press` 는 "얼마나 눌렸는가" 0..1 이다. 환경광·그레인이 이 값에 비례하므로, 창(press 0)에는
 * 아무것도 얹히지 않아 **원화가 문자 그대로 그대로 남는다**.
 */
function pressAt(
  windows: readonly HangarWindowRect[],
  headerH: number,
  x: number,
  y: number,
): { k: number; ceil: number; press: number } {
  let win = 0;
  for (const rect of windows) {
    const d = distToWindow(rect, x, y);
    const a = d <= 0 ? 1 : d >= WINDOW_FEATHER ? 0 : 1 - smoothstep(d / WINDOW_FEATHER);
    if (a > win) win = a;
  }
  let hdr = 0;
  if (headerH > 0) {
    if (y <= headerH) hdr = 1;
    else if (y < headerH + HEADER_FEATHER) hdr = 1 - smoothstep((y - headerH) / HEADER_FEATHER);
  }
  // 헤더는 창 밖에서만 의미가 있다 — 창이 이미 보존 중인 자리를 헤더가 다시 누르면 안 된다.
  const hw = hdr * (1 - win);
  const baseK = OUTSIDE_K + (HEADER_K - OUTSIDE_K) * hw;
  const baseCeil = OUTSIDE_CEIL_L + (HEADER_CEIL_L - OUTSIDE_CEIL_L) * hw;
  return {
    k: baseK + (WINDOW_K - baseK) * win,
    ceil: baseCeil + (WINDOW_CEIL_L - baseCeil) * win,
    // 창에서 정확히 0, 창 밖 완전 억제 구간에서 1.
    press: 1 - win,
  };
}

/**
 * 원화를 굽는다: 피사계 심도 흐림 → 영역 곱연산 → 천장 무릎 → 가산 환경광·그레인.
 *
 * RGB 는 **휘도 비로만** 스케일한다(색상·채도 보존). 채널별로 곱하면 어두워질수록 채도가
 * 빠져 배경이 회색으로 죽는다.
 *
 * 실패하면 `null` — 호출부는 원본을 그대로 쓰고 알파 오버레이 경로로 물러난다.
 */
function bakePressed(
  tex: Texture,
  windows: readonly HangarWindowRect[],
  headerH: number,
): Texture | null {
  const w = Math.round(tex.source.width);
  const h = Math.round(tex.source.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const src = drawableSource(tex.source.resource);
  if (src === null) return null;
  const px = blurPixels(src, w, h, BLUR_RADIUS);
  if (px === null) return null;
  const ctx = makeCtx(w, h);
  if (ctx === null) return null;

  // 원화 화소 → 디자인 좌표. `coverSprite` 와 **같은 매핑**이어야 창이 엉뚱한 자리에 뚫린다.
  const cover = Math.max(DESIGN_WIDTH / w, DESIGN_HEIGHT / h) * OVERSCAN;
  const grain = bakeGrainField(w, h);

  const img = ctx.createImageData(w, h);
  for (let sy = 0; sy < h; sy++) {
    const dy = DESIGN_HEIGHT / 2 + (sy - h / 2) * cover;
    for (let sx = 0; sx < w; sx++) {
      const dx = DESIGN_WIDTH / 2 + (sx - w / 2) * cover;
      const i = (sy * w + sx) * 4;
      const r = px[i] ?? 0;
      const g = px[i + 1] ?? 0;
      const b = px[i + 2] ?? 0;
      const f = pressAt(windows, headerH, dx, dy);
      const lumA = luma(r, g, b);
      const outLum = kneeCeil(lumA * f.k, f.ceil);
      const scale = outLum / Math.max(1, lumA);
      // 가산 항은 **눌린 만큼만**. 창(press 0)에서는 정확히 0 이라 원화가 보존된다.
      const amb = AMBIENT_LUM * f.press;
      const fade = Math.min(1, (outLum + amb) / GRAIN_FADE_L);
      const gr = (grain[sy * w + sx] ?? 0) * GRAIN_LUM * f.press * fade;
      img.data[i] = Math.min(255, Math.max(0, r * scale + amb * AMBIENT_R + gr * GRAIN_R));
      img.data[i + 1] = Math.min(255, Math.max(0, g * scale + amb * AMBIENT_G + gr * GRAIN_G));
      img.data[i + 2] = Math.min(255, Math.max(0, b * scale + amb * AMBIENT_B + gr * GRAIN_B));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

/**
 * 계수장을 **알파 오버레이**로 굽는다(굽기 실패·절차적 폴백 전용).
 *
 * 검은 알파 오버레이는 `dst·(1−a)` 라 곱과 정확히 같은 연산이므로 `a = 1 − k` 로 두면 굽는
 * 경로와 같은 밝기 위계가 나온다. 천장 무릎·환경광은 여기 없다 — 폴백 배경은 우리가 그린
 * 것이라 폭주 하이라이트도 순흑도 애초에 없기 때문이다.
 */
function bakePressOverlay(windows: readonly HangarWindowRect[], headerH: number): Texture | null {
  const ctx = makeCtx(PRESS_TEX_W, PRESS_TEX_H);
  if (ctx === null) return null;
  const img = ctx.createImageData(PRESS_TEX_W, PRESS_TEX_H);
  for (let ty = 0; ty < PRESS_TEX_H; ty++) {
    const dy = ((ty + 0.5) / PRESS_TEX_H) * DESIGN_HEIGHT;
    for (let tx = 0; tx < PRESS_TEX_W; tx++) {
      const dx = ((tx + 0.5) / PRESS_TEX_W) * DESIGN_WIDTH;
      const i = (ty * PRESS_TEX_W + tx) * 4;
      img.data[i] = 0x0a;
      img.data[i + 1] = 0x08;
      img.data[i + 2] = 0x12;
      img.data[i + 3] = Math.round((1 - pressAt(windows, headerH, dx, dy).k) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(ctx);
}

export class HangarBackdrop {
  /** 리드가 root 맨 뒤에 붙인다. */
  readonly view = new Container();

  /** 패럴랙스가 붙는 레이어. 비네트·마스크는 여기 들어가지 않는다(화면 고정). */
  private readonly artLayer = new Container();
  private readonly airLayer = new Container();

  private readonly motes: Mote[] = [];
  private readonly breathers: Breather[] = [];

  /**
   * 우리가 구운 자원 — 스프라이트를 destroy 해도 함께 반납되지 않으므로 직접 들고 있다가
   * {@link destroy} 에서 반납한다(기지와 같은 규율).
   */
  private bakedArt: Texture | null = null;
  private lampTex: Texture | null = null;
  private blobTex: Texture | null = null;
  private ownedOverlay: Texture | null = null;
  private ownedEdge: Texture | null = null;
  private ownedScrim: Texture | null = null;
  private time = 0;
  private aimX = 0;
  private aimY = 0;
  private curX = 0;
  private curY = 0;
  private readonly onPointerMove: (e: PointerEvent) => void;

  constructor(tex: Texture | undefined, opts: HangarBackdropOpts) {
    const windows = opts.windows;
    const headerH = Math.max(0, opts.headerH);

    // 캔버스가 아니라 window 에 건다 — 커서가 캔버스 밖으로 나가도 마지막 값이 굳지 않고,
    // Pixi 이벤트 계층(위에 깔린 패널이 포인터를 삼키는 문제)과도 무관해진다.
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

    // 자산이 없거나 로드 전이어도 화면이 비지 않게. 오버스캔 배경 뒤에도 늘 깔아 둔다.
    const floor = new Graphics();
    floor.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: FALLBACK_BASE });
    this.view.addChild(floor);

    this.view.addChild(this.artLayer);
    this.view.addChild(this.airLayer);

    if (tex !== undefined) {
      this.bakedArt = bakePressed(tex, windows, headerH);
      this.artLayer.addChild(coverSprite(this.bakedArt ?? tex, OVERSCAN));
    } else {
      this.buildProceduralArt();
    }
    // 굽기에 실패했거나 절차적 폴백이면 같은 계수장을 알파 한 장으로 얹는다(위 함수 헤더 참조).
    if (this.bakedArt === null) this.buildPressOverlay(windows, headerH);

    this.buildAir(windows, gates);
    this.buildVignettes();
  }

  /**
   * 자산이 없을 때의 절차적 배경 — 짙은 바탕 위 성운 얼룩 + **우측** 도크 램프광.
   * 원화의 구도(우측 절반 도크 / 좌측·하단 어두운 석재)를 그대로 흉내 내 창 자리에 볼거리가
   * 오게 한다 — 폴백이 구도까지 다르면 창이 "빈 구멍"이 된다.
   */
  private buildProceduralArt(): void {
    this.blobTex = bakeSoftBlob(0xffffff, 0, 0);
    const blob = this.blobTex;
    if (blob === null) return;
    const put = (
      color: number,
      x: number,
      y: number,
      w: number,
      h: number,
      alpha: number,
      period: number,
    ): void => {
      const s = new Sprite(blob);
      s.anchor.set(0.5);
      s.width = w;
      s.height = h;
      s.position.set(x, y);
      s.alpha = alpha;
      s.tint = color;
      s.blendMode = 'add';
      this.artLayer.addChild(s);
      this.breathers.push({ sprite: s, base: alpha, period, phase: this.breathers.length });
    };
    put(FALLBACK_NEBULA_TEAL, 1380, 300, 1300, 800, 0.5, 23);
    put(FALLBACK_NEBULA_MAGENTA, 1620, 220, 900, 620, 0.34, 31);
    // 도크 램프 — 창(x 952..1888, y 112..608) 안에 빛이 고이도록 그 중심 근처에 둔다.
    put(FALLBACK_LAMP, 1420, 360, 1000, 700, 0.24, 37);
    put(FALLBACK_LAMP, 1120, 520, 520, 420, 0.16, 43);
  }

  /** 계수장 알파 오버레이(폴백 경로). 패럴랙스 밖 — 창은 화면에 고정된 구멍이다. */
  private buildPressOverlay(windows: readonly HangarWindowRect[], headerH: number): void {
    const tex = bakePressOverlay(windows, headerH);
    if (tex === null) return;
    const s = new Sprite(tex);
    s.position.set(0, 0);
    s.width = DESIGN_WIDTH;
    s.height = DESIGN_HEIGHT;
    this.view.addChild(s);
    this.ownedOverlay = tex;
  }

  /**
   * 공기 — **창 안에서만**. 창이 없으면 아무것도 만들지 않는다(패널이 전부 덮는 화면에서
   * 안 보이는 입자를 도는 것은 순수 낭비다).
   */
  private buildAir(
    windows: readonly HangarWindowRect[],
    gates: ReturnType<typeof effectGates>,
  ): void {
    if (windows.length === 0) return;

    // 마스크는 **`view` 의 자식**이다 — 창은 화면에 고정된 구멍이고 내용물(티끌·램프)만
    // 패럴랙스를 탄다. `airLayer` 의 자식으로 두면 구멍이 배경과 함께 미끄러진다.
    // `view.destroy({children:true})` 가 회수하므로 따로 들고 있지 않는다.
    const mask = new Graphics();
    for (const r of windows) mask.rect(r.x, r.y, r.w, r.h);
    mask.fill({ color: 0xffffff });
    this.view.addChild(mask);
    this.airLayer.mask = mask;

    if (gates.particles !== 'off') {
      const count = gates.particles === 'min' ? Math.round(MOTE_COUNT / 2) : MOTE_COUNT;
      for (let i = 0; i < count; i++) {
        const rect = windows[i % windows.length];
        if (rect === undefined) continue;
        const r1 = hash01((i + 1) * 12.9898);
        const r2 = hash01((i + 1) * 78.233);
        const r3 = hash01((i + 1) * 39.425);
        const g = new Graphics();
        g.circle(0, 0, 1 + r3 * 1.9).fill({ color: 0xffe6bb, alpha: 0.15 + r3 * 0.2 });
        // 가산 — 어두운 배경 위 램프광 속 먼지로 읽힌다(tint 는 곱연산이라 밝힐 수 없다).
        g.blendMode = 'add';
        const mote: Mote = {
          gfx: g,
          baseX: rect.x + r1 * rect.w,
          baseY: rect.y + rect.h,
          span: rect.h,
          // 기지(3.5~12.5)보다도 느리다 — 창이 작아 같은 속도면 훨씬 빠르게 읽힌다.
          speed: 2.5 + r3 * 6,
          phase: r1 * Math.PI * 2,
          amp: 4 + r2 * 9,
        };
        g.position.set(mote.baseX, mote.baseY);
        this.airLayer.addChild(g);
        this.motes.push(mote);
      }
    }

    // 램프 맥동 — 창 안 도크 조명이 아주 느리게 숨 쉰다. 마스크가 창 밖 누출을 막는다.
    if (gates.halo) {
      this.lampTex = bakeSoftBlob(FALLBACK_LAMP, 0, 0);
      if (this.lampTex !== null) {
        for (const [i, rect] of windows.entries()) {
          const s = new Sprite(this.lampTex);
          s.anchor.set(0.5);
          s.width = rect.w * 1.1;
          s.height = rect.h * 1.3;
          // 위쪽에 광원을 둔다 — 실내는 위에서 빛이 내려오는 것이 자연의 위계다.
          s.position.set(rect.x + rect.w * 0.5, rect.y + rect.h * 0.3);
          s.alpha = LAMP_ALPHA;
          s.blendMode = 'add';
          this.airLayer.addChild(s);
          this.breathers.push({ sprite: s, base: LAMP_ALPHA, period: LAMP_PERIOD, phase: i * 1.7 });
        }
      }
    }
  }

  /** 네 변 띠형 비네트 + 하단 스크림(힌트 줄 자리). 둘 다 패럴랙스 밖 고정이다. */
  private buildVignettes(): void {
    const edge = bakeEdgeVignette();
    if (edge !== null) {
      const s = new Sprite(edge);
      s.position.set(0, 0);
      s.width = DESIGN_WIDTH;
      s.height = DESIGN_HEIGHT;
      this.view.addChild(s);
      this.ownedEdge = edge;
    }
    // 세로 램프는 공용 `scrim.ts` 를 쓴다 — 띠 근사가 만들던 가로줄이 없는 유일한 방법이다.
    const scrimTex = verticalScrimTexture(0, BOTTOM_SCRIM_ALPHA);
    if (scrimTex !== null) {
      const scrim = new Sprite(scrimTex);
      scrim.position.set(0, BOTTOM_SCRIM_TOP);
      scrim.width = DESIGN_WIDTH;
      scrim.height = DESIGN_HEIGHT - BOTTOM_SCRIM_TOP;
      this.view.addChild(scrim);
      this.ownedScrim = scrimTex;
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

    // 먼지 — 창 안에서 아주 느리게 떠오르고, 창 높이만큼 올라가면 아래로 되감는다.
    for (const m of this.motes) {
      m.gfx.y = m.baseY - ((this.time * m.speed) % m.span);
      m.gfx.x = m.baseX + Math.sin(this.time * 0.35 + m.phase) * m.amp;
    }

    // 램프·발광체의 미세한 호흡. **꺼지지 않고** 세기만 오간다 — 껐다 켜면 화면이 깜빡인다.
    for (const b of this.breathers) {
      b.sprite.alpha =
        b.base * (1 + LAMP_BREATH * Math.sin((this.time / b.period) * Math.PI * 2 + b.phase));
    }
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onPointerMove);
    }
    this.motes.length = 0;
    this.breathers.length = 0;
    this.airLayer.mask = null;
    this.view.destroy({ children: true });
    // 구운 텍스처는 스프라이트가 아니라 우리가 만든 자원이다 — 직접 반납한다.
    this.bakedArt?.destroy(true);
    this.bakedArt = null;
    this.lampTex?.destroy(true);
    this.lampTex = null;
    this.blobTex?.destroy(true);
    this.blobTex = null;
    this.ownedOverlay?.destroy(true);
    this.ownedOverlay = null;
    this.ownedEdge?.destroy(true);
    this.ownedEdge = null;
    this.ownedScrim?.destroy(true);
    this.ownedScrim = null;
  }
}
