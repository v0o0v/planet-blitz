/**
 * 시네마틱 건물 타일 — 기지 화면 AAA 전환 Lane B (`.omc/plans/base-screen-aaa-2026-08-02.md` §3).
 *
 * ## 왜 나무 nine-slice 를 버리는가
 * 이전 타일은 불투명 나무 프레임 + 144px 아이콘 + 텍스트 두 줄이었다. 프레임이 두껍고
 * 아이콘이 작아 **카드 면적의 대부분이 빈 나무**였고, 깊이(그림자)도 조명(림·글로우)도 없어
 * 타이틀·인트로의 풀블리드 키아트 옆에 놓으면 낙차가 그대로 보였다. 여기서는 AAA 허브의
 * 표준형 — **상단 일러스트 밴드 → 아래로 녹아드는 암막 → 각인된 라벨** — 으로 바꾼다.
 * 프레임은 금박 헤어라인 한 줄로만 남기고 나머지 면적은 전부 일러스트에 준다.
 *
 * ## 레이어 구조 (뒤 → 앞)
 * ```
 *   shadow   접지 그림자(리프트와 함께 넓어지고 옅어진다) — inner 밖이라 같이 뜨지 않는다
 *   inner    ← 리프트·부유가 걸리는 컨테이너 (root 위치는 리드 소유라 건드리지 않는다)
 *     glow   호버 시 accent 후광(가산, 카드 뒤)
 *     base   카드 바탕(짙은 남흑 — 밴드 페이드의 종착색과 같아야 이음매가 안 보인다)
 *     art    일러스트 밴드(프레임 크롭 + 마스크). 없으면 accent 절차 폴백
 *     fade   밴드 하단 암막(scrim.ts 로 픽셀에 구운 램프 — 띠 근사 금지 §0-4)
 *     warm   호버 시 가산 온기(tint 는 곱연산이라 밝히려면 가산이어야 한다)
 *     lock   탈채도 딤 + 절차적 자물쇠
 *     edge   안쪽 어두운 홈 + 금박 헤어라인 + 호버 림라이트
 *     text   제목 · 금박 룰 · 설명(또는 잠금 사유)
 * ```
 *
 * ## 마스크를 쓰면서도 클릭이 죽지 않는 이유
 * 마스크 Graphics 는 히트 테스트에서 빠지므로 "바탕에만 이벤트"를 걸면 클릭이 새거나 삼켜진다
 * (이 리포가 실제로 밟은 함정). 그래서 **이벤트는 root 컨테이너에 걸고 `hitArea` 를 명시**한다 —
 * 히트 판정이 자식 트리와 완전히 무관해져 마스크·텍스트·필터가 무엇을 하든 영향이 없다.
 * 크롭 자체는 프레임 크롭(텍스처 UV)으로 하고, 마스크는 ①둥근 상단 모서리 ②호버 줌(Ken
 * Burns)이 밴드 밖으로 새지 않게 하는 두 가지만 담당한다.
 *
 * ## 테두리는 왜 "밝은 링"이 아니라 "어두운 홈"인가
 * `theme.ts` `iconContrastRingBands` 가 실측으로 남긴 결론이다: 일러스트의 휘도 폭이 넓어
 * 어떤 단일 밝은 링도 중간 톤을 묻는다. 반대로 가장자리에 접하는 어두운 홈은 무엇이 오든
 * 경계 대비를 올린다. 그래서 금박은 **바깥 헤어라인 1.5px 뿐**이고 그 안쪽은 홈이다.
 *
 * ## 품질 티어를 읽지 않는다
 * 기지는 부팅 직후 화면일 수 있어 `graphicsTierController` 값이 아직 수렴 전이다(§0-3).
 * 여기서 쓰는 것은 스프라이트 몇 장과 구운 텍스처 두 장뿐이라 저사양에서 끌 것이 없다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 을 읽지도 쓰지도 않고 시간축은 벽시계다.
 * `width`/`height` 는 리드가 정한다(§3) — 내부에 하드코딩된 치수는 없고 전부 파생이다.
 */

import {
  ColorMatrixFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  CanvasSource,
} from 'pixi.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { verticalScrimTexture } from './scrim.js';

// --- 비율 상수(전부 width/height 파생 — 절대 치수 없음) -------------------------

/** 일러스트 밴드가 차지하는 높이 비율(계약 §3 "상단 ~60%"). */
const BAND_RATIO = 0.6;
/** 밴드 하단 암막이 시작하는 지점(밴드 높이 기준). 위 절반은 일러스트를 그대로 둔다. */
const FADE_START = 0.44;
/** 카드 모서리 반경(짧은 변 기준). 너무 둥글면 장난감이 된다 — 석재·금속의 절제된 반경. */
const RADIUS_RATIO = 0.045;
/** 콘텐츠 좌우 여백(폭 기준). */
const PAD_RATIO = 0.062;

/**
 * 정사각 일러스트를 밴드 비율로 중앙 크롭할 때의 세로 초점(0=위, 1=아래).
 * 건물 일러스트는 구조물이 가운데보다 조금 위에 앉아 있어 정중앙을 잡으면 지붕이 잘린다.
 */
const FOCUS_Y = 0.42;

/** 호버 시 카드가 뜨는 높이(카드 높이 기준). */
const LIFT_RATIO = 0.026;
/** 호버 시 일러스트가 밀려 들어오는 배율(Ken Burns). 마스크가 넘침을 막는다. */
const ART_ZOOM = 1.055;
/** 호버 보간 시상수(1/초). dt 지수 감쇠라 프레임률이 달라도 같은 체감이다. */
const HOVER_LERP = 9;
/** 미세 부유 진폭(카드 높이 기준)과 주기(초). 격자 전체가 출렁이면 안 되므로 아주 작게. */
const FLOAT_RATIO = 0.004;
const FLOAT_PERIOD = 6.2;
/** dt 상한 — 탭 복귀·백그라운드로 프레임이 크게 튀어도 연출이 순간이동하지 않게. */
const MAX_DT = 1 / 15;

/** 카드 바탕색. 밴드 페이드가 수렴하는 색(scrim.ts 의 rgba(10,8,18))과 같아야 이음매가 없다. */
const BASE_FILL = 0x0a0812;
/** 안쪽 어두운 홈(theme.ts ICON_RING_GROOVE 와 같은 계열, 카드 스케일에 맞춰 조금 더 짙게). */
const GROOVE = 0x0d0805;
/** 잠금 사유 문구색 — 경고이되 붉게 타오르지 않는 따뜻한 살구색. */
const LOCK_TEXT = 0xffab84;

export interface CinematicTileOpts {
  width: number;
  height: number;
  /** 건물 일러스트(1024², 없으면 accent 폴백). */
  art: Texture | undefined;
  /** 잠금/폴백 강조색. */
  accent: number;
  title: string;
  desc: string;
  locked: boolean;
  lockReason: string | null;
  onClick?: () => void;
}

export interface CinematicTile {
  readonly container: Container;
  /** 호버 글로우·미세 부유 등 연출. dt 는 벽시계 초. */
  update(dt: number): void;
}

// --- 구운 텍스처(모듈 1회, 모든 타일이 공유) -----------------------------------

let glowCache: Texture | null | undefined;

/**
 * 중심이 흰색이고 가장자리로 사라지는 방사 텍스처(그림자·후광·폴백 조명 공용).
 *
 * 띠를 겹쳐 근사하지 않는다(§0-4) — 캔버스 픽셀에 구워 `linear` 로 늘린다. 흰색으로 굽고
 * 쓰는 쪽에서 `tint` 로 색을 준다: 검게 쓰면 접지 그림자, 가산 블렌드로 쓰면 후광이 된다.
 * 캔버스가 없는 환경(vitest)에서는 `null` — 호출부는 이 텍스처 없이도 화면을 세운다.
 */
function radialGlowTexture(): Texture | null {
  if (glowCache !== undefined) return glowCache;
  if (typeof document === 'undefined') {
    glowCache = null;
    return null;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    glowCache = null;
    return null;
  }
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  // 지수 2.4 폴오프 — 선형이면 가장자리에 또렷한 원이 보인다. 16 스톱이면 밴딩이 안 보인다.
  const stops = 16;
  for (let i = 0; i <= stops; i++) {
    const p = i / stops;
    grad.addColorStop(p, `rgba(255, 255, 255, ${(1 - p) ** 2.4})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new Texture({ source: new CanvasSource({ resource: canvas }) });
  tex.source.scaleMode = 'linear';
  glowCache = tex;
  return tex;
}

// --- 순수 헬퍼 ------------------------------------------------------------------

/**
 * 텍스트 높이(캔버스가 없는 환경 방어). Pixi 의 `Text.height` 는 측정을 위해 캔버스 컨텍스트를
 * 요구해서 vitest 에서 던진다 — 이 리포가 UI 테스트에서 실제로 밟은 지점이라 폴백을 둔다.
 */
function safeHeight(text: Text, fallback: number): number {
  try {
    const h = text.height;
    return Number.isFinite(h) && h > 0 ? h : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 정사각(혹은 임의 비율) 일러스트를 `w:h` 비율로 **중앙 크롭**한 텍스처.
 *
 * 스프라이트를 늘리지 않는다 — 늘리면 건물이 납작해져 즉시 아마추어로 읽힌다. 마스크가 아니라
 * 프레임(UV) 크롭이라 드로우콜도 스텐실도 늘지 않는다. 원본 텍스처는 건드리지 않고 같은
 * `source` 위에 새 `frame` 을 얹은 별도 Texture 를 만든다(공유 자산 오염 금지).
 */
function cropToAspect(art: Texture, w: number, h: number): Texture {
  const src = art.frame;
  if (!(src.width > 0) || !(src.height > 0) || !(w > 0) || !(h > 0)) return art;
  const target = w / h;
  let cw = src.width;
  let ch = src.height;
  if (src.width / src.height > target) cw = src.height * target;
  else ch = src.width / target;
  const cx = src.x + (src.width - cw) / 2;
  const cy = src.y + (src.height - ch) * FOCUS_Y;
  try {
    return new Texture({ source: art.source, frame: new Rectangle(cx, cy, cw, ch) });
  } catch {
    return art;
  }
}

/**
 * 잠금 일러스트 탈채도.
 *
 * `tint` 는 곱연산이라 채도를 **못 낮춘다**(어둡게만 만든다) — 원리적으로 채도 행렬이 정답이다.
 * ⚠️ 다만 `new ColorMatrixFilter()` 는 생성 시점에 GL 프로그램을 준비하려 들어 **캔버스가 없는
 * 환경(vitest)에서 던진다**(실측: `getMaxFragmentPrecision` 에서 터진다). 자산이 없어도 화면이
 * 서야 한다는 규칙(§0-6)과 같은 이유로, 필터가 불가능하면 회청 곱색 폴백으로 내려간다 —
 * 완전한 흑백은 아니지만 잠금 딤과 합쳐지면 "죽어 있는 타일"로 충분히 읽힌다.
 */
function desaturate(sprite: Sprite): void {
  try {
    const cm = new ColorMatrixFilter();
    cm.desaturate();
    cm.brightness(0.5, true);
    sprite.filters = [cm];
  } catch {
    sprite.tint = 0x5f5c68;
  }
}

/** 문자열에서 뽑은 결정적 위상(0..2π) — 타일마다 부유가 어긋나게. 매 프레임 같은 값이다. */
function phaseOf(seed: string): number {
  let acc = 0;
  for (let i = 0; i < seed.length; i++) acc = (acc * 31 + seed.charCodeAt(i)) % 9973;
  return (acc / 9973) * Math.PI * 2;
}

/** 절차적 자물쇠(텍스처 의존 0 — 자산이 없어도 잠금이 잠금으로 읽혀야 한다). */
function lockBadge(size: number, color: number): Container {
  const c = new Container();
  const body = size * 0.62;
  const bodyY = size * 0.34;

  // 어두운 원반 — 밝은 일러스트 위에서도 자물쇠가 뜨게(홈과 같은 원리).
  const disc = new Graphics();
  disc.circle(0, size * 0.5, size * 0.82).fill({ color: 0x000000, alpha: 0.5 });
  c.addChild(disc);

  const g = new Graphics();
  // 고리 — 반원 + 양 다리. `arc` 로 그려야 두께가 균일하다.
  const shackleR = size * 0.26;
  g.moveTo(-shackleR, bodyY)
    .lineTo(-shackleR, bodyY - size * 0.06)
    .arc(0, bodyY - size * 0.06, shackleR, Math.PI, 0)
    .lineTo(shackleR, bodyY)
    .stroke({ color, width: Math.max(2, size * 0.1), alpha: 0.95, cap: 'round' });
  // 몸통.
  g.roundRect(-body / 2, bodyY, body, size * 0.52, size * 0.1).fill({ color, alpha: 0.95 });
  // 열쇠구멍 — 몸통과 대비되게 파낸다.
  g.circle(0, bodyY + size * 0.22, size * 0.075).fill({ color: 0x140c04, alpha: 0.9 });
  c.addChild(g);
  return c;
}

// --- 본체 ----------------------------------------------------------------------

/**
 * 타일 한 장. 반환 `container` 는 (0,0) 기준 width×height 를 차지하고(접지 그림자만 아래로
 * 조금 번진다), 위치는 리드가 `.position.set()` 으로 잡는다.
 */
export function makeCinematicTile(o: CinematicTileOpts): CinematicTile {
  const { width: w, height: h, accent, locked } = o;
  const radius = Math.max(6, Math.round(Math.min(w, h) * RADIUS_RATIO));
  const pad = Math.round(w * PAD_RATIO);
  const bandH = Math.round(h * BAND_RATIO);
  const lift = h * LIFT_RATIO;
  const floatAmp = h * FLOAT_RATIO;
  const glowTex = radialGlowTexture();

  const root = new Container();
  const inner = new Container();

  // --- 접지 그림자 -------------------------------------------------------------
  // inner **밖**에 둔다 — 카드가 뜰 때 그림자까지 같이 뜨면 부유가 아니라 통째로 미끄러진
  // 것으로 읽힌다. 바닥에 붙어 넓어지고 옅어져야 "떴다"가 성립한다.
  let shadow: Sprite | null = null;
  if (glowTex !== null) {
    shadow = new Sprite(glowTex);
    shadow.anchor.set(0.5);
    shadow.tint = 0x05030a;
    shadow.alpha = 0.55;
    shadow.position.set(w / 2, h - h * 0.01);
    shadow.width = w * 1.02;
    shadow.height = h * 0.26;
    root.addChild(shadow);
  }
  root.addChild(inner);

  // --- 호버 후광(카드 뒤, 가산) -------------------------------------------------
  let glow: Sprite | null = null;
  if (glowTex !== null) {
    glow = new Sprite(glowTex);
    glow.anchor.set(0.5);
    glow.tint = locked ? 0x6b6470 : accent;
    glow.blendMode = 'add';
    glow.alpha = 0;
    glow.position.set(w / 2, h * 0.44);
    glow.width = w * 1.55;
    glow.height = h * 1.55;
    inner.addChild(glow);
  }

  // --- 카드 바탕 ----------------------------------------------------------------
  const base = new Graphics();
  // 불투명이어야 한다. 밴드 페이드가 알파 1 로 수렴하므로 바탕이 반투명이면 밴드 바닥과
  // 라벨 영역의 실제 색이 갈려 **가로 이음매**로 보인다(딱 잘린 경계선 = 실패 조건).
  base.roundRect(0, 0, w, h, radius).fill({ color: BASE_FILL, alpha: 1 });
  inner.addChild(base);

  // --- 일러스트 밴드 ------------------------------------------------------------
  // 마스크는 상단 둥근 모서리와 호버 줌 넘침만 담당한다(헤더 "마스크를 쓰면서도" 절).
  // 아래로 `radius` 만큼 더 그려 두면 밴드 바닥은 직선으로 끊긴다 — 어차피 페이드가 덮는다.
  const bandMask = new Graphics();
  bandMask.roundRect(0, 0, w, bandH + radius, radius).fill({ color: 0xffffff });
  inner.addChild(bandMask);

  // 호버 줌은 `scale` 이 아니라 **픽셀 크기**로 건다. 크롭 스프라이트의 기준 배율은
  // `width`/`height` 대입으로 이미 정해져 있어 `scale.set()` 이 그것을 통째로 덮어쓰기 때문이다.
  // 그래서 기준 크기를 여기 붙잡아 두고 매 프레임 `기준 × 줌` 으로 다시 대입한다.
  let artSprite: Sprite | null = null;
  let artBaseW = w;
  let artBaseH = bandH;
  if (o.art !== undefined) {
    artSprite = new Sprite(cropToAspect(o.art, w, bandH));
    artSprite.anchor.set(0.5);
    artSprite.position.set(w / 2, bandH / 2);
    artSprite.width = w;
    artSprite.height = bandH;
    artSprite.mask = bandMask;
    if (locked) desaturate(artSprite);
    inner.addChild(artSprite);
  } else {
    // accent 절차 폴백 — 자산은 덧붙임이지 전제가 아니다(§0-6). 단색 사각이 아니라 "빛이
    // 고여 있는 밴드"로 만들어야 결손이 사고가 아니라 스타일로 보인다.
    const fill = new Graphics();
    fill.roundRect(0, 0, w, bandH + radius, radius).fill({ color: accent, alpha: 0.16 });
    fill.mask = bandMask;
    inner.addChild(fill);
    if (glowTex !== null) {
      const orb = new Sprite(glowTex);
      orb.anchor.set(0.5);
      orb.tint = accent;
      orb.blendMode = 'add';
      orb.alpha = locked ? 0.16 : 0.4;
      orb.position.set(w / 2, bandH * 0.52);
      orb.width = w * 0.86;
      orb.height = bandH * 1.05;
      orb.mask = bandMask;
      inner.addChild(orb);
      // 호버 줌은 폴백에서도 동작한다 — 기준 크기만 다르게 붙잡는다.
      artSprite = orb;
      artBaseW = w * 0.86;
      artBaseH = bandH * 1.05;
    }
  }

  // --- 밴드 하단 암막 -----------------------------------------------------------
  // 딱 잘린 경계선이 보이면 실패다. 픽셀에 구운 램프(scrim.ts)로 라벨 영역과 이어 붙인다.
  const fadeTex = verticalScrimTexture(0, 1);
  if (fadeTex !== null) {
    const fadeTop = Math.round(bandH * FADE_START);
    const fade = new Sprite(fadeTex);
    fade.position.set(0, fadeTop);
    fade.width = w;
    fade.height = bandH - fadeTop;
    inner.addChild(fade);
    // 페이드가 끝나는 지점부터 카드 바닥까지는 바탕색과 동일 — 이음매가 원리적으로 없다.
  }

  // --- 호버 온기(가산) ----------------------------------------------------------
  // tint 는 곱연산이라 밝힐 수 없다(§0-5). 밴드 위에 얇은 가산 판을 얹어 조명이 든 것처럼.
  const warm = new Graphics();
  warm.roundRect(0, 0, w, bandH + radius, radius).fill({ color: 0xffe0a8 });
  warm.mask = bandMask;
  warm.blendMode = 'add';
  warm.alpha = 0;
  inner.addChild(warm);

  // --- 잠금 ---------------------------------------------------------------------
  if (locked) {
    const dim = new Graphics();
    dim.roundRect(0, 0, w, h, radius).fill({ color: 0x07050e, alpha: 0.5 });
    inner.addChild(dim);
    const badge = lockBadge(Math.round(Math.min(w, bandH) * 0.24), 0xd8c79a);
    badge.position.set(w / 2, bandH * 0.5 - Math.min(w, bandH) * 0.12);
    inner.addChild(badge);
  }

  // --- 테두리: 안쪽 어두운 홈 + 금박 헤어라인 + 호버 림 --------------------------
  const grooveW = Math.max(2, Math.round(Math.min(w, h) * 0.009));
  const edge = new Graphics();
  edge
    .roundRect(grooveW / 2, grooveW / 2, w - grooveW, h - grooveW, radius - grooveW / 2)
    .stroke({ color: GROOVE, width: grooveW, alpha: 0.9 });
  edge
    .roundRect(0, 0, w, h, radius)
    .stroke({ color: COLOR.gold, width: 1.5, alignment: 1, alpha: locked ? 0.22 : 0.5 });
  inner.addChild(edge);

  // 림라이트는 별도 Graphics 라 알파만 흔들면 된다(매 프레임 재작도 없음).
  const rim = new Graphics();
  rim
    .roundRect(0, 0, w, h, radius)
    .stroke({ color: 0xfff0c8, width: 2, alignment: 1, alpha: 1 });
  rim.alpha = 0;
  inner.addChild(rim);

  // --- 타이포 --------------------------------------------------------------------
  // 위계를 숫자로 벌린다: 제목은 굵고 자간이 있는 대문자급, 설명은 얇고 작고 muted.
  // 크기는 카드 높이에서 파생하고 상·하한만 잡는다(리드가 치수를 바꿔도 무너지지 않게).
  const titleSize = Math.min(40, Math.max(24, Math.round(h * 0.1)));
  const descSize = Math.min(20, Math.max(14, Math.round(h * 0.052)));
  const wrapW = w - pad * 2;

  const title = new Text({
    resolution: 2,
    text: o.title,
    style: {
      fontFamily: UI_FONT,
      fontSize: titleSize,
      fontWeight: '900',
      letterSpacing: 1.5,
      fill: locked ? 0x9a9186 : COLOR.cream,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: wrapW,
      lineHeight: Math.round(titleSize * 1.12),
      dropShadow: { color: 0x000000, alpha: 0.85, blur: 6, distance: 2, angle: Math.PI / 2 },
    },
  });
  title.anchor.set(0.5, 0);
  const titleY = bandH + Math.round(h * 0.022);
  title.position.set(w / 2, titleY);
  inner.addChild(title);

  const titleH = safeHeight(title, titleSize * 1.12);

  // 금박 룰 — 제목과 설명 사이를 가르는 각인선. 짧고 얇아야 장식이 아니라 구두점으로 읽힌다.
  const ruleY = Math.round(titleY + titleH + h * 0.024);
  const ruleW = Math.round(w * 0.13);
  const rule = new Graphics();
  rule
    .rect(w / 2 - ruleW / 2, ruleY, ruleW, 2)
    .fill({ color: COLOR.gold, alpha: locked ? 0.2 : 0.45 });
  inner.addChild(rule);

  const bottom = new Text({
    resolution: 2,
    text: locked ? (o.lockReason ?? o.desc) : o.desc,
    style: {
      fontFamily: UI_FONT,
      fontSize: locked ? descSize + 1 : descSize,
      fontWeight: locked ? '700' : '400',
      fill: locked ? LOCK_TEXT : COLOR.muted,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: wrapW,
      lineHeight: Math.round(descSize * 1.42),
      dropShadow: TEXT_SHADOW,
    },
  });
  bottom.anchor.set(0.5, 0);
  bottom.position.set(w / 2, ruleY + Math.round(h * 0.028));
  inner.addChild(bottom);

  // --- 상호작용 -------------------------------------------------------------------
  // ⚠️ 이벤트는 **root 에** 걸고 hitArea 를 명시한다. 바탕 Graphics 에만 걸면 위에 얹힌
  // 텍스트가 클릭을 삼키고, 마스크 Graphics 는 히트 테스트에서 빠져 구멍이 난다.
  // 잠금 타일은 핸들러를 아예 달지 않아 호버 연출도 함께 죽는다(계약 §3) — 다만 `static` 은
  // 유지해 뒤 배경으로 이벤트가 새지 않게 막는다.
  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, w, h);
  root.cursor = locked ? 'default' : 'pointer';

  let hoverTarget = 0;
  let hover = 0;
  let time = phaseOf(o.title) * FLOAT_PERIOD;

  const onClick = o.onClick;
  if (!locked) {
    if (onClick !== undefined) root.on('pointertap', onClick);
    root.on('pointerover', () => {
      hoverTarget = 1;
    });
    root.on('pointerout', () => {
      hoverTarget = 0;
    });
  }

  const update = (dt: number): void => {
    const step = Math.min(Math.max(dt, 0), MAX_DT);
    time += step;

    const k = 1 - Math.exp(-HOVER_LERP * step);
    hover += (hoverTarget - hover) * k;
    // 임계값 밑은 0 으로 스냅 — 미세 잔량이 남아 알파가 영영 0 이 안 되는 것을 막는다.
    if (hover < 0.001 && hoverTarget === 0) hover = 0;

    const bob = Math.sin((time / FLOAT_PERIOD) * Math.PI * 2) * floatAmp;
    inner.y = bob - lift * hover;

    if (glow !== null) glow.alpha = 0.34 * hover;
    warm.alpha = 0.085 * hover;
    rim.alpha = 0.7 * hover;
    if (artSprite !== null) {
      const z = 1 + (ART_ZOOM - 1) * hover;
      artSprite.width = artBaseW * z;
      artSprite.height = artBaseH * z;
    }
    if (shadow !== null) {
      shadow.width = w * (1.02 + 0.1 * hover);
      shadow.height = h * (0.26 + 0.035 * hover);
      shadow.alpha = 0.55 - 0.16 * hover;
      shadow.y = h - h * 0.01 + h * 0.012 * hover;
    }
  };

  // 첫 프레임 전에도 정지 상태가 정확하도록 한 번 정착시킨다(update 가 안 불려도 안전).
  update(0);

  return { container: root, update };
}
