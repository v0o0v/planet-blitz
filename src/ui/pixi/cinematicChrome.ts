/**
 * 기지 화면 시네마틱 크롬 — 각인 제목 · 유리 재화 칩 · 출격 CTA (레인 계약 §3 Lane C).
 *
 * ## 왜 나무 배너를 대체하는가
 * 기지 화면의 제목은 `ui_banner.png`(나무 판) 안에 빨간 알약 + 흰 글씨였다. 타이틀·인트로가
 * 시네마틱 키아트로 올라간 뒤 이 크롬만 카툰 나무로 남아 **같은 화면 안에서 붓이 두 개**가
 * 됐다(사용자 판정). 그래서 판때기를 걷어내고 제목을 화면에 직접 **각인**한다 — AAA 메타
 * 화면의 표준형이고, 뒤의 키아트를 가리지 않는다는 실리도 있다.
 *
 * ## 왜 전부 절차적인가
 * 새 이미지 자산을 요구하지 않는다(계약 §3). 자산이 하나 늘면 로더·번들 예산·결손 가드가
 * 함께 늘고, 크롬은 폭·높이가 호출자마다 달라 nine-slice 로도 깔끔하지 않다. 대신 그라디언트가
 * 필요한 곳은 **캔버스에 픽셀로 굽는다**(`scrim.ts` 와 같은 방식).
 *
 * ⚠️ **띠를 겹쳐 그라디언트를 근사하지 않는다**(계약 §0-4). 1px 겹침이 알파를 두 배로 만들어
 * 가로줄이 생긴 실제 신고가 있다. 여기의 램프는 전부 `bakeCanvas` → `linear` 보간이다.
 *
 * ⚠️ **밝은 바탕 위 흰 글씨는 묻힌다.** 금색 CTA 라벨은 `COLOR.darkLabel`(진한 갈색)이다
 * (사용자 지적으로 이미 한 번 고친 자리 — `button.ts` `labelColor` 주석과 같은 근거).
 *
 * ## 시간축
 * 모든 연출의 `dt` 는 **벽시계 초**다. sim 을 읽지도 쓰지도 않는다(ADR-0005, 순수 render/UI).
 * `Ticker` 를 직접 구독하지 않고 호출자가 `update(dt)` 를 돌린다 — 기지 화면이 이미 자기
 * 렌더 루프를 갖고 있어 구독이 둘이면 화면이 숨겨져도 연출이 계속 돈다.
 *
 * ## 캔버스 없는 환경(vitest/SSR)
 * `document` 가 없으면 구운 텍스처는 전부 `null` 이고, `Text.width` 는 던진다. 두 경우 모두
 * 조용히 폴백해 **컨테이너는 반드시 돌아온다** — 크롬 생성이 실패하면 화면이 통째로 죽는다.
 */

import { CanvasSource, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { COLOR, UI_FONT } from './theme.js';
import { stripEmoji } from './text.js';

// ── 팔레트 ─────────────────────────────────────────────────────────────────
/** 각인 금박(제목·테두리 상단광). */
const GOLD_LIT = 0xffe9ae;
/** 금박 본색. */
const GOLD = 0xffd678;
/** 금박 그늘 — 각인의 "파인 자국". */
const GOLD_DEEP = 0x8a5a12;
/** 유리판 바탕(짙은 잉크). 반투명이라 뒤 키아트가 은은히 비친다. */
const GLASS_INK = 0x0b0a16;
/** 안쪽 홈 — 어떤 바탕 위에서도 테두리 대비를 만드는 유일한 수단(theme.ts ICON_RING_GROOVE 근거와 동형). */
const GROOVE = 0x120b07;
/** 광물 칩의 청록 강조. 금색 크레딧과 **색상으로** 갈라 숫자를 읽기 전에 구분되게 한다. */
const TEAL = 0x6fe3d4;
const TEAL_DEEP = 0x1f6f68;

// ── 구운 텍스처 (모듈 캐시 — 화면을 다시 그려도 재사용) ──────────────────────

interface Baked {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** 캔버스 + 2D 컨텍스트. 없는 환경(테스트/SSR)이면 `null`. */
function bakeCanvas(w: number, h: number): Baked | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement): Texture {
  const tex = new Texture({ source: new CanvasSource({ resource: canvas }) });
  tex.source.scaleMode = 'linear';
  return tex;
}

let ruleTex: Texture | null | undefined;
/**
 * 가로 장식선 — 중앙이 가장 진하고 양 끝에서 0 으로 사라진다(1px 높이, 가로로 늘린다).
 *
 * 끝을 칼같이 자르면 "선"이 아니라 "막대"로 읽힌다. 끝을 죽이는 것만으로 화면을 가로지르는
 * 선이 제목의 일부가 된다.
 */
function edgeFadeRule(): Texture | null {
  if (ruleTex !== undefined) return ruleTex;
  const b = bakeCanvas(256, 1);
  if (b === null) {
    ruleTex = null;
    return null;
  }
  for (let i = 0; i < 256; i++) {
    const t = (i + 0.5) / 256;
    const a = Math.sin(Math.PI * t) ** 1.6;
    b.ctx.fillStyle = `rgba(255, 214, 120, ${a})`;
    b.ctx.fillRect(i, 0, 1, 1);
  }
  ruleTex = toTexture(b.canvas);
  return ruleTex;
}

let hazeTex: Texture | null | undefined;
/**
 * 부드러운 원형 헤이즈(흰색). 글로우·제목 뒤 안개에 쓴다 — 색은 `tint` 로 입힌다(흰 바탕에
 * 곱연산이면 곧 그 색이다). 필터 블러보다 싸고 저티어에서도 안전하다.
 */
function softHaze(): Texture | null {
  if (hazeTex !== undefined) return hazeTex;
  const size = 128;
  const b = bakeCanvas(size, size);
  if (b === null) {
    hazeTex = null;
    return null;
  }
  const g = b.ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  b.ctx.fillStyle = g;
  b.ctx.fillRect(0, 0, size, size);
  hazeTex = toTexture(b.canvas);
  return hazeTex;
}

let sheenTex: Texture | null | undefined;
/** 광택 스윕 한 줄기(가로 램프, 흰색). CTA 위를 아주 가끔 지나간다. */
function sheenBand(): Texture | null {
  if (sheenTex !== undefined) return sheenTex;
  const b = bakeCanvas(64, 1);
  if (b === null) {
    sheenTex = null;
    return null;
  }
  for (let i = 0; i < 64; i++) {
    const t = (i + 0.5) / 64;
    const a = Math.sin(Math.PI * t) ** 2.2;
    b.ctx.fillStyle = `rgba(255, 246, 214, ${a})`;
    b.ctx.fillRect(i, 0, 1, 1);
  }
  sheenTex = toTexture(b.canvas);
  return sheenTex;
}

/** 캔버스 둥근 사각 경로. `roundRect` 미지원 환경이면 각진 사각으로 폴백한다. */
function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/**
 * CTA 판때기 — 세로 금 그라디언트 + 상단 하이라이트 + 하단 그늘 + 이중 테두리를 **한 장에
 * 굽는다**. 굽는 이유는 두 가지다: ①Pixi Graphics 에 그라디언트가 없다 ②띠 근사 금지(§0-4).
 * 2× 로 구워 스케일 다운하므로 가장자리가 뭉개지지 않는다.
 */
function heroPlate(w: number, h: number): Texture | null {
  const s = 2;
  const b = bakeCanvas(w * s, h * s);
  if (b === null) return null;
  const { ctx } = b;
  ctx.scale(s, s);
  const r = Math.min(h / 2, 16);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#ffeeba');
  grad.addColorStop(0.34, '#ffd166');
  grad.addColorStop(0.62, '#f0ae3c');
  grad.addColorStop(1, '#b87c1e');
  pathRoundRect(ctx, 1.5, 1.5, w - 3, h - 3, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // 상단 안쪽 하이라이트 — 금속이 위에서 빛을 받는다는 단 하나의 신호.
  pathRoundRect(ctx, 5, 4, w - 10, h * 0.42, r * 0.7);
  const hi = ctx.createLinearGradient(0, 4, 0, 4 + h * 0.42);
  hi.addColorStop(0, 'rgba(255,255,255,0.42)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hi;
  ctx.fill();

  // 하단 안쪽 그늘 — 위 하이라이트와 짝이 맞아야 판이 두꺼워 보인다.
  pathRoundRect(ctx, 4, h * 0.55, w - 8, h * 0.45 - 4, r * 0.7);
  const lo = ctx.createLinearGradient(0, h * 0.55, 0, h - 4);
  lo.addColorStop(0, 'rgba(80,42,4,0)');
  lo.addColorStop(1, 'rgba(80,42,4,0.30)');
  ctx.fillStyle = lo;
  ctx.fill();

  // 바깥 어두운 홈 → 안쪽 밝은 금테. 홈이 있어야 밝은 배경에서도 실루엣이 선다.
  pathRoundRect(ctx, 1.5, 1.5, w - 3, h - 3, r);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(38, 21, 4, 0.72)';
  ctx.stroke();
  pathRoundRect(ctx, 4, 4, w - 8, h - 8, r - 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 240, 196, 0.65)';
  ctx.stroke();

  return toTexture(b.canvas);
}

// ── 공용 유틸 ───────────────────────────────────────────────────────────────

/**
 * 텍스트가 `max` 를 넘으면 그 자리에서 축소한다(로케일·자릿수로 라벨 길이가 런타임에 변한다 —
 * `button.ts` `fitLabel` 과 같은 근거). ⚠️ `Text.width` 는 캔버스 측정을 강제해 캔버스 없는
 * 환경에서 던지므로, 측정이 안 되면 장식을 조용히 포기한다.
 */
function fitWidth(text: Text, max: number, min = 0.6): void {
  text.scale.set(1);
  if (max <= 0) return;
  let measured = 0;
  try {
    measured = text.width;
  } catch {
    return;
  }
  if (measured <= 0 || measured <= max) return;
  text.scale.set(Math.max(min, max / measured));
}

// ── 1. 각인 제목 ────────────────────────────────────────────────────────────

/** 제목 글자 크기. 부제·장식선 간격이 전부 여기서 파생한다. */
const TITLE_SIZE = 46;
/** 제목 자간. 각인은 **글자가 벌어져야** 돌에 새긴 것으로 읽힌다(붙으면 로고가 된다). */
const TITLE_TRACKING = 12;
const SUB_SIZE = 19;
const SUB_TRACKING = 5;
/** 제목 윗변 → 부제 윗변 · 부제 윗변 → 장식선. */
const SUB_Y = TITLE_SIZE + 14;
const RULE_Y = SUB_Y + SUB_SIZE + 18;
/** 장식선 전체 폭(양 끝은 알파 0 이라 실제 인상 폭은 이보다 좁다). */
const RULE_W = 1180;

/**
 * 화면 제목 — 각인된 금박 타이포 + 부제 + 화면을 가로지르는 얇은 금색 장식선.
 *
 * 앵커는 **(0.5, 0)** 이다: 호출자가 컨테이너 위치를 (화면 중앙 x, 제목 윗변 y) 로 잡는다.
 *
 * 각인은 세 겹으로 만든다 — 아래 어두운 그림자(파인 자국) · 위 크림 하이라이트(빛 받는 모서리)
 * · 가운데 금박 본체. `dropShadow` 한 겹으로는 "떠 있는 글자"가 되고 새겨진 느낌이 안 난다.
 */
export function makeScreenTitle(text: string, sub: string): Container {
  const root = new Container();
  const title = stripEmoji(text);
  const subtitle = stripEmoji(sub);

  // 제목 뒤 안개 — 밝은 키아트 위에서도 글자가 뜨도록 아주 옅게 깐다(가리지 않는 최소량).
  const haze = softHaze();
  if (haze !== null) {
    const glow = new Sprite(haze);
    glow.anchor.set(0.5);
    glow.width = 900;
    glow.height = 210;
    glow.position.set(0, TITLE_SIZE * 0.5);
    glow.tint = 0x120c1e;
    glow.alpha = 0.5;
    root.addChild(glow);
  }

  const style = {
    fontFamily: UI_FONT,
    fontSize: TITLE_SIZE,
    fontWeight: '900' as const,
    letterSpacing: TITLE_TRACKING,
    align: 'center' as const,
  };
  const layer = (fill: number, alpha: number, dy: number): Text => {
    const t = new Text({ resolution: 2, text: title, style: { ...style, fill } });
    t.anchor.set(0.5, 0);
    t.position.set(0, dy);
    t.alpha = alpha;
    root.addChild(t);
    return t;
  };
  layer(0x1a0f04, 0.85, 3); // 파인 자국
  layer(GOLD_LIT, 0.45, -1.5); // 모서리 하이라이트
  const face = layer(GOLD, 1, 0);
  fitWidth(face, RULE_W * 0.8, 0.7);

  if (subtitle.length > 0) {
    const st = new Text({
      resolution: 2,
      text: subtitle,
      style: {
        fontFamily: UI_FONT,
        fontSize: SUB_SIZE,
        fontWeight: '600',
        letterSpacing: SUB_TRACKING,
        fill: COLOR.cream,
        align: 'center',
      },
    });
    st.anchor.set(0.5, 0);
    st.position.set(0, SUB_Y);
    st.alpha = 0.72;
    fitWidth(st, RULE_W * 0.72, 0.7);
    root.addChild(st);
  }

  // 장식선 — 두 겹(짙은 홈 위에 금선)이라 밝은 바탕에서도 선이 사라지지 않는다.
  const rule = edgeFadeRule();
  if (rule !== null) {
    const groove = new Sprite(rule);
    groove.anchor.set(0.5, 0);
    groove.width = RULE_W;
    groove.height = 3;
    groove.position.set(0, RULE_Y + 1);
    groove.tint = GROOVE;
    groove.alpha = 0.55;
    root.addChild(groove);

    const line = new Sprite(rule);
    line.anchor.set(0.5, 0);
    line.width = RULE_W;
    line.height = 1.5;
    line.position.set(0, RULE_Y);
    root.addChild(line);
  }

  // 선 가운데 마름모 — 선을 "끝난 곳"이 아니라 "중심이 있는 장식"으로 만든다.
  const gem = new Graphics();
  const r = 5;
  gem
    .poly([0, -r, r, 0, 0, r, -r, 0])
    .fill({ color: GOLD })
    .stroke({ color: GOLD_DEEP, width: 1, alpha: 0.8 });
  gem.position.set(0, RULE_Y + 0.75);
  root.addChild(gem);

  return root;
}

// ── 2. 유리 재화 칩 ─────────────────────────────────────────────────────────

/** 아이콘 좌측 여백 · 값 우측 여백. */
const CHIP_PAD = 12;

/** 아이콘 텍스처가 없을 때 그리는 절차적 폴백(금화 / 청록 결정). */
function fallbackIcon(size: number, tone: 'gold' | 'teal'): Graphics {
  const g = new Graphics();
  const r = size / 2;
  if (tone === 'gold') {
    g.circle(r, r, r * 0.92).fill({ color: GOLD }).stroke({ color: GOLD_DEEP, width: 2 });
    g.circle(r, r, r * 0.55).stroke({ color: GOLD_DEEP, width: 1.5, alpha: 0.7 });
    g.circle(r * 0.72, r * 0.66, r * 0.22).fill({ color: GOLD_LIT, alpha: 0.85 });
  } else {
    g.poly([r, 0, size, r, r, size, 0, r])
      .fill({ color: TEAL })
      .stroke({ color: TEAL_DEEP, width: 2 });
    g.poly([r, r * 0.22, r * 1.5, r, r, r * 0.9]).fill({ color: 0xd8fff8, alpha: 0.7 });
  }
  return g;
}

/**
 * 재화 칩 — 유리판 + 얇은 금(청록)테 + 안쪽 어두운 홈.
 *
 * 나무 nine-slice(`ui_chip.png`)를 대체한다. 반투명 잉크라 뒤 키아트가 비쳐 화면과 한 몸이
 * 되고, 홈 덕분에 밝은 곳 위에서도 테두리가 살아 있다. `tone` 은 **색상으로** 크레딧(금)과
 * 광물(청록)을 가른다 — 아이콘이 없어도(폴백) 두 칩이 구분된다.
 */
export function makeCinematicChip(
  w: number,
  h: number,
  value: string,
  icon: Texture | undefined,
  tone: 'gold' | 'teal',
): Container {
  const root = new Container();
  const accent = tone === 'gold' ? GOLD : TEAL;
  const radius = Math.min(h / 2, 14);

  const plate = new Graphics();
  plate
    .roundRect(0, 0, w, h, radius)
    .fill({ color: GLASS_INK, alpha: 0.62 })
    .stroke({ color: GROOVE, width: 3, alpha: 0.85 });
  plate.roundRect(1.5, 1.5, w - 3, h - 3, radius - 1).stroke({ color: accent, width: 1.4, alpha: 0.8 });
  root.addChild(plate);

  // 위쪽 절반의 유리 반사. 판을 평평한 사각형이 아니라 **유리**로 읽히게 하는 유일한 요소다.
  const gloss = new Graphics();
  gloss
    .roundRect(3, 3, w - 6, h * 0.44, radius - 2)
    .fill({ color: 0xffffff, alpha: 0.07 });
  root.addChild(gloss);

  const iconSize = Math.max(8, h - 18);
  const iconX = CHIP_PAD;
  if (icon !== undefined) {
    const sp = new Sprite(icon);
    sp.width = iconSize;
    sp.height = iconSize;
    sp.position.set(iconX, (h - iconSize) / 2);
    root.addChild(sp);
  } else {
    const g = fallbackIcon(iconSize, tone);
    g.position.set(iconX, (h - iconSize) / 2);
    root.addChild(g);
  }

  const t = new Text({
    resolution: 2,
    text: stripEmoji(value),
    style: {
      fontFamily: UI_FONT,
      fontSize: Math.round(h * 0.46),
      fontWeight: '700',
      letterSpacing: 1,
      // 값은 강조색이 아니라 크림 — 강조색으로 쓰면 테두리와 같은 색이 되어 숫자가 테두리에
      // 흡수된다(theme.ts SLOT_RARITY_COLOR_NUM 이 기록한 것과 같은 함정).
      fill: COLOR.cream,
    },
  });
  t.anchor.set(0.5);
  const restLeft = iconX + iconSize + 8;
  const restRight = w - CHIP_PAD;
  fitWidth(t, Math.max(0, restRight - restLeft));
  t.position.set((restLeft + restRight) / 2, h / 2);
  root.addChild(t);

  return root;
}

// ── 3. 출격 CTA ────────────────────────────────────────────────────────────

/** 맥동 1주기(초). 3초 이상 — 짧으면 "번쩍임"이 되어 싸구려로 읽힌다. */
const PULSE_PERIOD = 4.2;
/** 글로우 알파: 기준 ± 진폭. 진폭을 절제하는 것이 AAA 와 데모의 차이다. */
const GLOW_BASE = 0.17;
const GLOW_AMPL = 0.075;
/** 호버 시 글로우 가산분. */
const GLOW_HOVER = 0.16;
/** 광택 스윕 주기와 통과 시간(초) — 대부분의 시간 동안 화면에 없다. */
const SHEEN_PERIOD = 6.5;
const SHEEN_SWEEP = 0.85;
/** 호버 확대 · 눌림 축소. */
const HOVER_SCALE = 1.035;
const PRESS_SCALE = 0.972;
/** 상태 추종 시상수(지수 감쇠) — 프레임률이 달라도 같은 체감이 되도록 dt 지수로 민다. */
const EASE = 14;
/** 라벨 좌우 안전 여백(안쪽 금테를 침범하지 않는 값). */
const LABEL_PAD_X = 26;

export interface HeroButton {
  readonly container: Container;
  update(dt: number): void;
}

/**
 * 출격 CTA — 이 화면의 주인공.
 *
 * 구성(뒤 → 앞): 맥동 글로우(가산) · 접지 그림자 · 금 판때기(구운 그라디언트) · 광택 스윕
 * (마스크 안) · 호버 광택 · 라벨 · 우측 셰브런.
 *
 * 맥동은 **느리고 얕다**(주기 {@link PULSE_PERIOD} 초, 알파 진폭 {@link GLOW_AMPL}). 빠르거나
 * 큰 맥동은 시선을 끄는 대신 싸구려로 읽힌다 — 여기서 필요한 것은 "살아 있다"는 신호지
 * "깜빡인다"는 신호가 아니다.
 *
 * 스케일은 **`inner` 에만** 먹인다(`button.ts` 와 같은 구조): 외부 컨테이너는 좌상단 원점
 * 계약(호출자 position·고정 hitArea)을 유지해야 눌림 중에도 클릭 판정이 흔들리지 않는다.
 */
export function makeHeroButton(w: number, h: number, label: string, onClick: () => void): HeroButton {
  const container = new Container();
  const glowHost = new Container();
  const inner = new Container();
  // pivot·position 을 둘 다 중앙에 두면 서로 상쇄돼 자식 좌표는 그대로, 스케일만 중앙에서 먹는다.
  inner.pivot.set(w / 2, h / 2);
  inner.position.set(w / 2, h / 2);
  glowHost.position.set(w / 2, h / 2);
  container.addChild(glowHost);
  container.addChild(inner);

  const haze = softHaze();
  let glow: Sprite | null = null;
  if (haze !== null) {
    glow = new Sprite(haze);
    glow.anchor.set(0.5);
    glow.width = w * 1.65;
    glow.height = h * 3.1;
    glow.tint = GOLD;
    glow.blendMode = 'add';
    glow.alpha = GLOW_BASE;
    glowHost.addChild(glow);
  }

  // 접지 그림자 — 판이 배경 위에 **놓여 있다**는 신호. 없으면 스티커처럼 붙어 보인다.
  if (haze !== null) {
    const shade = new Sprite(haze);
    shade.anchor.set(0.5);
    shade.width = w * 0.92;
    shade.height = h * 0.9;
    shade.position.set(0, h * 0.52);
    shade.tint = 0x000000;
    shade.alpha = 0.45;
    glowHost.addChildAt(shade, 0);
  }

  const plateTex = heroPlate(w, h);
  if (plateTex !== null) {
    const plate = new Sprite(plateTex);
    plate.width = w;
    plate.height = h;
    inner.addChild(plate);
  } else {
    // 캔버스 없는 환경 폴백 — 그라디언트는 포기하되 화면은 선다.
    const g = new Graphics();
    g.roundRect(0, 0, w, h, Math.min(h / 2, 16))
      .fill({ color: GOLD })
      .stroke({ color: GROOVE, width: 3, alpha: 0.8 });
    inner.addChild(g);
  }

  // 광택 스윕. 판 밖으로 새지 않게 둥근 사각 마스크로 자른다(마스크는 히트 테스트에서 빠지지만
  // 클릭 판정은 외부 container 의 고정 hitArea 가 책임지므로 영향이 없다).
  const sheenHost = new Container();
  let sheen: Sprite | null = null;
  const sheenSrc = sheenBand();
  if (sheenSrc !== null) {
    const clip = new Graphics();
    clip.roundRect(0, 0, w, h, Math.min(h / 2, 16)).fill({ color: 0xffffff });
    sheenHost.addChild(clip);
    sheenHost.mask = clip;
    sheen = new Sprite(sheenSrc);
    sheen.anchor.set(0.5, 0.5);
    sheen.width = w * 0.42;
    sheen.height = h * 2.4;
    sheen.rotation = 0.34;
    sheen.blendMode = 'add';
    sheen.alpha = 0;
    sheen.position.set(-w, h / 2);
    sheenHost.addChild(sheen);
    inner.addChild(sheenHost);
  }

  // 호버 광택 — tint 는 곱연산이라 밝힐 수 없다. 반투명 크림을 얹어 밝힌다.
  const gloss = new Graphics();
  gloss.roundRect(2, 2, w - 4, h - 4, Math.min(h / 2, 15)).fill({ color: 0xfff3d0 });
  gloss.alpha = 0;
  inner.addChild(gloss);

  // 우측 셰브런. `▶` 는 `stripEmoji` 보존 목록이라 캔버스에서 두부가 되지 않는다.
  const chevron = new Text({
    resolution: 2,
    text: '▶',
    style: { fontFamily: UI_FONT, fontSize: Math.round(h * 0.30), fontWeight: '700', fill: COLOR.darkLabel },
  });
  chevron.anchor.set(1, 0.5);
  chevron.alpha = 0.55;
  chevron.position.set(w - 20, h / 2);
  inner.addChild(chevron);

  const text = new Text({
    resolution: 2,
    text: stripEmoji(label),
    style: {
      fontFamily: UI_FONT,
      fontSize: Math.round(h * 0.37),
      fontWeight: '800',
      letterSpacing: 3,
      // ⚠️ 밝은 금 바탕에 흰 글씨는 묻힌다(사용자 지적). 진한 갈색이 계약이다.
      // 어두운 라벨에는 다크 섀도를 걸지 않는다 — 획이 촘촘한 한글이 그림자와 뭉친다.
      fill: COLOR.darkLabel,
      align: 'center',
    },
  });
  text.anchor.set(0.5);
  // 셰브런이 차지하는 우측 폭까지 빼고 맞춘다 — 로케일이 길어져도 화살표를 밀지 않는다.
  fitWidth(text, w - LABEL_PAD_X * 2 - h * 0.34);
  text.position.set(w / 2 - h * 0.17, h / 2);
  inner.addChild(text);

  container.eventMode = 'static';
  container.cursor = 'pointer';
  container.hitArea = new Rectangle(0, 0, w, h);

  let hovered = false;
  let pressed = false;
  let scale = 1;
  let glossA = 0;
  let hoverA = 0;
  let time = 0;

  container.on('pointertap', onClick);
  container.on('pointerdown', () => (pressed = true));
  container.on('pointerup', () => (pressed = false));
  container.on('pointerupoutside', () => (pressed = false));
  container.on('pointerover', () => (hovered = true));
  container.on('pointerout', () => {
    hovered = false;
    pressed = false;
  });

  return {
    container,
    update(dt: number): void {
      time += dt;
      const k = 1 - Math.exp(-EASE * dt);

      const targetScale = pressed ? PRESS_SCALE : hovered ? HOVER_SCALE : 1;
      scale += (targetScale - scale) * k;
      inner.scale.set(scale);

      glossA += ((hovered && !pressed ? 0.16 : 0) - glossA) * k;
      gloss.alpha = glossA;

      hoverA += ((hovered ? GLOW_HOVER : 0) - hoverA) * k;
      if (glow !== null) {
        const pulse = 0.5 + 0.5 * Math.sin((time / PULSE_PERIOD) * Math.PI * 2);
        glow.alpha = GLOW_BASE + GLOW_AMPL * pulse + hoverA;
        // 숨쉬기는 글로우에만 — 판때기까지 늘리면 버튼이 "떨린다".
        const breath = 1 + 0.035 * pulse;
        glow.scale.set((w * 1.65 * breath) / glow.texture.width, (h * 3.1 * breath) / glow.texture.height);
      }

      if (sheen !== null) {
        const phase = time % SHEEN_PERIOD;
        if (phase < SHEEN_SWEEP) {
          const p = phase / SHEEN_SWEEP;
          sheen.visible = true;
          sheen.x = -w * 0.35 + p * (w * 1.7);
          sheen.alpha = Math.sin(p * Math.PI) * 0.5;
        } else {
          sheen.visible = false;
        }
      }
    },
  };
}
