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

import {
  CanvasSource,
  Container,
  FillGradient,
  Graphics,
  NineSliceSprite,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { stripEmoji } from './text.js';

// ── 팔레트 ─────────────────────────────────────────────────────────────────
/** 각인 금박 상단 스톱 · 테두리 밝은 금. 타이틀 로고 `PLANET BLITZ` 와 같은 스톱이다. */
const GOLD_LIT = 0xf6d98a;
/** 금박 하단 스톱 — 위/아래 두 스톱이 세로 그라디언트를 만든다. */
const GOLD_DARK = 0xb8862f;
/** 금박 본색(장식·아이콘). */
const GOLD = 0xffd678;
/** 금박 그늘. */
const GOLD_DEEP = 0x8a5a12;
/** 제목 아웃라인 — 시스템 폰트를 디스플레이 타입으로 읽히게 만드는 결정적 한 겹. */
const TITLE_OUTLINE = 0x2a1a08;
/** 제목 하단 드롭 — 홈 아래 입술과 같은 따뜻한 금갈색(처방5: 검은 그림자는 폰트 티를 낸다). */
const TITLE_DROP = 0x7a5520;
/** 유리판 바탕(짙은 잉크). 반투명이라 뒤 키아트가 은은히 비친다. */
const GLASS_INK = 0x0b0a16;
/** 안쪽 홈 — 어떤 바탕 위에서도 테두리 대비를 만드는 유일한 수단(theme.ts ICON_RING_GROOVE 근거와 동형). */
const GROOVE = 0x120b07;
/**
 * 광물 칩의 청록 — **채도를 낮춘** 값이다. 원래 쓰던 `#6FE3D4` 는 금색 일색인 이 화면에서
 * 혼자 고립돼 우상단으로 시선을 끌어갔다(비평 실측: 화면에서 가장 채도 높은 요소가 재화 칩
 * 둘). 청록이라는 구분은 유지하되 주조색과 화해하는 톤으로 민다.
 */
const TEAL = 0x8fc4b8;
const TEAL_DEEP = 0x2f5f58;
/**
 * 칩 값 텍스트. 크림(`#EBDCBE`)도 `#D8CDB4` 도 너무 밝았다 — 실측에서 칩 숫자의 p99 휘도가
 * 205 로 **페이지 제목(204)과 동률**이었다. 위계는 제목만 올려서는 안 서고 크롬을 같이
 * 눌러야 선다. 이 값은 p99 ≈ 168 로 제목보다 확실히 뒤에 앉는다.
 */
const CHIP_TEXT = 0xa89e88;

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

/**
 * 캔버스 둥근 사각 경로. `roundRect` 미지원 환경이면 각진 사각으로 폴백한다.
 *
 * ⚠️ 반지름은 **항상 변 절반으로 클램프한다.** 클램프를 빼면 알약(r = h/2)을 조금이라도 인셋한
 * 사각에 같은 r 을 그대로 넘겼을 때 모서리 호가 사각 **밖으로 부푼다** — 실제로 그 실수가
 * CTA 어깨에 초승달 아티팩트를 만들었다(CRIT-1). 클램프는 그 계열의 결함을 원천 봉쇄한다.
 */
function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, rr);
  else ctx.rect(x, y, w, h);
}

/** 알약(또는 둥근 사각) 한 장을 단색으로 굽는다. 판때기와 **같은 경로**를 쓰는 것이 요점이다. */
function pillTexture(w: number, h: number, css: string, inset: number, blur = 0): Texture | null {
  const pad = blur * 2;
  const s = blur > 0 ? 1 : 2; // 블러 판은 어차피 흐리므로 슈퍼샘플이 필요 없다.
  const b = bakeCanvas((w + pad * 2) * s, (h + pad * 2) * s);
  if (b === null) return null;
  const { ctx } = b;
  ctx.scale(s, s);
  if (blur > 0) ctx.filter = `blur(${blur}px)`;
  pathRoundRect(ctx, pad + inset, pad + inset, w - inset * 2, h - inset * 2, h / 2);
  ctx.fillStyle = css;
  ctx.fill();
  return toTexture(b.canvas);
}

/**
 * CTA 판때기 — 세로 금 그라디언트 + 상단 하이라이트 + 하단 그늘 + 이중 테두리를 **한 장에
 * 굽는다**. 굽는 이유는 두 가지다: ①Pixi Graphics 에 그라디언트가 없다 ②띠 근사 금지(§0-4).
 * 2× 로 구워 스케일 다운하므로 가장자리가 뭉개지지 않는다.
 */
function heroPlate(w: number, h: number, radius = h / 2): Texture | null {
  const s = 2;
  const b = bakeCanvas(w * s, h * s);
  if (b === null) return null;
  const { ctx } = b;
  ctx.scale(s, s);
  // 기본값은 **알약(pill)** — 타이틀 화면 시작 버튼과 같은 버튼 언어다. 게임 안에 버튼 문법이
  // 셋(알약 / 목재 / 그 외)이면 화면마다 다른 제품처럼 읽힌다(비평 지적). 격자 안에 들어가는
  // 출격 카드는 건물 타일과 같은 반경을 넘겨받아 **같은 격자의 일원**으로 보이게 한다.
  const r = radius;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#ffeeba');
  grad.addColorStop(0.34, '#ffd166');
  grad.addColorStop(0.62, '#f0ae3c');
  grad.addColorStop(1, '#b87c1e');
  pathRoundRect(ctx, 1.5, 1.5, w - 3, h - 3, r);
  ctx.fillStyle = grad;
  ctx.fill();

  // 상단 안쪽 하이라이트 — 금속이 위에서 빛을 받는다는 단 하나의 신호(높이 ≈ h 의 1/3).
  const hiH = Math.round(h * 0.35);
  pathRoundRect(ctx, 6, 5, w - 12, hiH, r * 0.8);
  const hi = ctx.createLinearGradient(0, 5, 0, 5 + hiH);
  hi.addColorStop(0, 'rgba(255,255,255,0.35)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hi;
  ctx.fill();

  // 하단 안쪽 그늘 — 위 하이라이트와 짝이 맞아야 판이 두꺼워 보인다.
  pathRoundRect(ctx, 5, h * 0.55, w - 10, h * 0.45 - 5, r * 0.8);
  const lo = ctx.createLinearGradient(0, h * 0.55, 0, h - 5);
  lo.addColorStop(0, 'rgba(80,42,4,0)');
  lo.addColorStop(1, 'rgba(80,42,4,0.30)');
  ctx.fillStyle = lo;
  ctx.fill();

  // 바깥 어두운 홈 → 안쪽 3px 밝은 금테. 홈이 있어야 밝은 배경에서도 실루엣이 선다.
  pathRoundRect(ctx, 1.25, 1.25, w - 2.5, h - 2.5, r);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(38, 21, 4, 0.7)';
  ctx.stroke();
  pathRoundRect(ctx, 4.5, 4.5, w - 9, h - 9, r - 3);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(246, 217, 138, 0.95)';
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

/**
 * 제목 글자 크기. 부제·장식선 간격이 전부 여기서 파생한다.
 *
 * 카드 제목이 33px 이라 46px(1.4배)도 61px(1.85배)도 부족했다 — 61px 판의 실측에서 제목
 * `기지`의 p99 휘도가 **재화 칩 숫자와 동률(204 vs 205)** 이었다. 위계는 크기와 밝기가 **같이**
 * 벌어져야 선다. 84px 은 카드 제목의 2.5배이고, 여기에 아웃라인·스페큘러가 얹혀야 타이틀
 * 워드마크와 같은 무게가 된다.
 */
const TITLE_SIZE = 84;
/**
 * 제목 아웃라인 두께. 얇으면 그냥 굵은 본문이고, 이 두께부터 새김으로 읽힌다.
 *
 * 4px 은 회화적 프레임 옆에서 스티커처럼 두꺼웠다(4차 판정 처방5: "폰트 티"). 2.5px 은 새김을
 * 유지하면서 두께를 줄인 값이다 — **완전히 빼지는 않았다.** 웹폰트가 없는 상태에서 시스템
 * 스택(Malgun Gothic)을 디스플레이 타입으로 읽히게 하는 것이 이 아웃라인이라, 없애면 84px 짜리
 * 굵은 본문으로 되돌아간다(MED-6 이 고쳤던 지점). 리드가 웹폰트를 넣으면 그때 0 으로 뺄 값이다.
 */
const TITLE_STROKE = 2.5;
/** 제목 자간 0.02em. 한글이라 트래킹은 금물이지만, 이 정도는 획이 뭉치는 것만 막는다. */
const TITLE_TRACKING = TITLE_SIZE * 0.02;
const SUB_SIZE = 19;
/** 제목 윗변 → 부제 윗변 · 부제 윗변 → 장식선. */
const SUB_Y = TITLE_SIZE + 8;
const RULE_Y = SUB_Y + SUB_SIZE + 16;
/** 장식선 전체 폭(양 끝은 알파 0 이라 실제 인상 폭은 이보다 좁다). */
const RULE_W = 1180;

/**
 * 화면 제목 — 각인된 금박 타이포 + 부제 + 화면을 가로지르는 얇은 금색 장식선.
 *
 * 앵커는 **(0.5, 0)** 이다: 호출자가 컨테이너 위치를 (화면 중앙 x, 제목 윗변 y) 로 잡는다.
 *
 * ## 왜 아웃라인 + 세로 그라디언트인가
 * 웹폰트를 들이지 않고 시스템 폰트(Malgun Gothic)를 **디스플레이 타입으로 읽히게** 하는 조합이다.
 * 굵기만 올리면 그냥 굵은 본문이고, 그림자만 얹으면 "떠 있는 글자"가 된다. 두꺼운 어두운
 * 아웃라인이 글자를 판에서 떼어 내고, 세로 금 그라디언트(타이틀 로고와 **같은 스톱**)가 금속
 * 면을 만든다 — 두 개가 같이 있어야 각인으로 읽힌다.
 *
 * ⚠️ **자간을 주지 않는다.** 한때 12px 트래킹을 넣었는데, 한국어 2~4음절에서는 디자인이
 * 아니라 **띄어쓰기 버그**로 읽혔다(실화면: `기 지`). 라틴 대문자 로고타입에서만 통하는 기법이다.
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

  // 새김 3중 스택(뒤 → 앞): ①offsetY 3 다크 드롭 ②금 그라디언트 + 4px 다크 아웃라인
  // ③윗부분 1/3 screen 스페큘러. 셋 중 하나라도 빠지면 "굵은 글씨"로 돌아간다.
  const base = {
    fontFamily: UI_FONT,
    fontSize: TITLE_SIZE,
    // 800 → 700: 시스템 스택의 최대 굵기는 획이 뭉쳐 "굵게 누른 본문" 티가 난다(처방5).
    fontWeight: '700' as const,
    letterSpacing: TITLE_TRACKING,
    align: 'center' as const,
  };

  const drop = new Text({
    resolution: 2,
    text: title,
    style: {
      ...base,
      fill: TITLE_DROP,
      stroke: { color: TITLE_OUTLINE, width: TITLE_STROKE, join: 'round' },
    },
  });
  drop.anchor.set(0.5, 0);
  // 오프셋 3 → 1: 각인 규약(홈 아래 입술)과 같은 두께다. 3px 은 글자가 판에서 떠 보였다(처방5).
  drop.position.set(0, 1);
  root.addChild(drop);

  const face = new Text({
    resolution: 2,
    text: title,
    style: {
      ...base,
      fill: new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        colorStops: [
          { offset: 0, color: GOLD_LIT },
          { offset: 1, color: GOLD_DARK },
        ],
      }),
      stroke: { color: TITLE_OUTLINE, width: TITLE_STROKE, join: 'round' },
    },
  });
  face.anchor.set(0.5, 0);
  face.position.set(0, 0);
  fitWidth(face, RULE_W * 0.8, 0.7);
  drop.scale.copyFrom(face.scale); // 축소가 걸리면 드롭도 같이 줄어야 어긋나지 않는다.
  root.addChild(face);

  // 스페큘러 — 글자 윗부분만 밝힌다. 아웃라인 위로는 번지지 않게 띠 마스크로 자른다.
  const spec = new Text({
    resolution: 2,
    text: title,
    style: { ...base, fill: 0xfff6dc },
  });
  spec.anchor.set(0.5, 0);
  spec.position.set(0, 0);
  spec.scale.copyFrom(face.scale);
  spec.blendMode = 'screen';
  spec.alpha = 0.5;
  const band = new Graphics();
  band
    .rect(-RULE_W / 2, TITLE_SIZE * 0.12, RULE_W, TITLE_SIZE * 0.3)
    .fill({ color: 0xffffff });
  root.addChild(band);
  spec.mask = band;
  root.addChild(spec);

  if (subtitle.length > 0) {
    const st = new Text({
      resolution: 2,
      text: subtitle,
      style: {
        fontFamily: UI_FONT,
        fontSize: SUB_SIZE,
        fontWeight: '600',
        // 자간 0 — 부제도 한국어라 트래킹이 곧 띄어쓰기로 읽힌다(제목과 같은 근거).
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

  root.addChild(carvedDivider());
  return root;
}

/**
 * 제목 아래 장식 — **석재에 판 홈**이지 웹 헤어라인이 아니다.
 *
 * 1px 선 + 중앙 점은 웹 앱 헤더 문법이라, 회화적인 배경 위에 UI 레이어가 그냥 떠 있는 인상을
 * 준다(비평 지적). 두께가 있는 채널(어두운 홈)에 위쪽 금 하이라이트와 아래쪽 그림자를 짝지어
 * **깎여 들어간 면**을 만들고, 중앙에 키스톤, 양 끝에 계단형 마감을 둔다 — 빛이 위에서 오는
 * 이 화면의 조명과 부호가 맞아야 홈으로 읽힌다(하이라이트가 위, 그림자가 아래).
 */
function carvedDivider(): Container {
  const c = new Container();
  const rule = edgeFadeRule();
  if (rule !== null) {
    const band = (h: number, dy: number, tint: number, alpha: number): void => {
      const s = new Sprite(rule);
      s.anchor.set(0.5, 0);
      s.width = RULE_W;
      s.height = h;
      s.position.set(0, RULE_Y + dy);
      s.tint = tint;
      s.alpha = alpha;
      c.addChild(s);
    };
    // ⚠️ **명암 순서가 뒤집혀 있었다**(실측: 위가 L113 으로 밝고 아래가 L28 로 어두웠다).
    // 광원이 위에 있을 때 **음각 홈**은 위쪽 벽이 그늘이고 아래 입술이 빛을 받는다. 반대로 하면
    // 아래에서 조명한 **양각 리브**로 읽힌다 — 같은 세 겹인데 부호 하나가 부조를 뒤집는다.
    band(1, 0, 0x0d0805, 0.75); // 홈 상단 — 파고든 그늘의 시작
    band(5, 1, GROOVE, 0.55); // 채널 안쪽 어둠(아래로 감쇠)
    band(1, 6.5, 0xc9a367, 0.45); // 홈 하단 입술 — 빛을 받는 유일한 면
  }

  // 중앙 룬 셋 — 구분선과 **같은 문법**(위 그늘 / 아래 수광 립)으로 판 짧은 세로 홈이다.
  //
  // ⚠️ 여기 있던 "키스톤" 사다리꼴은 실화면에서 **이 화면 유일의 벡터 클립아트**였다(4차 판정
  // MED). 불투명 `#120b07` 채움이 L13 이라 바로 옆 금색 L217 과 **204 luma 를 점프하는 순흑
  // 키라인**을 만들었는데, 이 화면 어디에도 검은 외곽선을 쓰는 요소가 없다. 형태도 방패인지
  // 컵인지 읽히지 않았고("아이콘 폰트 조각"), 양옆 눈금은 아무것에도 정렬돼 있지 않아 지웠다.
  //
  // 그래서 **채움도 외곽선도 쓰지 않는다.** 모든 획이 배경 위 반투명이라 최소 휘도가 배경에서
  // 크게 떨어지지 않는다(가장 어두운 획 = 상단 그늘 α0.6 → 배경 L36 기준 합성 ≈ L25).
  const rune = new Graphics();
  for (const [dx, half] of [
    [-15, 7],
    [0, 11],
    [15, 7],
  ] as const) {
    const top = RULE_Y + 4 - half;
    const hgt = half * 2;
    rune.rect(dx - 2, top, 4, hgt).fill({ color: 0x241608, alpha: 0.35 }); // 파인 면
    rune.rect(dx - 2, top, 4, 1).fill({ color: 0x1a1008, alpha: 0.6 }); // 위쪽 벽 그늘
    rune.rect(dx - 2, top + hgt - 1, 4, 1).fill({ color: 0xc9a367, alpha: 0.55 }); // 아래 입술
  }
  c.addChild(rune);

  return c;
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

  // fill 을 0.35 까지 낮춘다 — 칩은 **테두리로만** 존재해야 한다. 진한 판이면 화면에서 가장
  // 대비 높은 덩어리가 상단 두 모서리가 되어 시선이 제목·CTA 가 아니라 화면 밖으로 끌려간다
  // (비평 실측).
  const plate = new Graphics();
  plate
    .roundRect(0, 0, w, h, radius)
    .fill({ color: GLASS_INK, alpha: 0.35 })
    .stroke({ color: GROOVE, width: 3, alpha: 0.6 });
  plate.roundRect(1.5, 1.5, w - 3, h - 3, radius - 1).stroke({ color: accent, width: 1.4, alpha: 0.7 });
  root.addChild(plate);

  // 위쪽 절반의 유리 반사. 판을 평평한 사각형이 아니라 **유리**로 읽히게 하는 유일한 요소다.
  const gloss = new Graphics();
  gloss
    .roundRect(3, 3, w - 6, h * 0.44, radius - 2)
    .fill({ color: 0xffffff, alpha: 0.05 });
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
      // 자간 0(숫자도 예외 없이 — 값이 길어지면 그것대로 벌어져 보인다). 색은 강조색이 아니라
      // 한 단 낮춘 크림: 강조색으로 쓰면 테두리와 같은 색이라 숫자가 테두리에 흡수되고
      // (theme.ts SLOT_RARITY_COLOR_NUM 과 같은 함정), 순수 크림이면 칩이 제목보다 앞선다.
      fill: CHIP_TEXT,
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
const GLOW_BASE = 0.3;
const GLOW_AMPL = 0.07;
/** 외곽 글로우 색(따뜻한 호박) — 판때기의 금보다 한 단 붉어야 빛으로 읽힌다. */
const GLOW_TINT = 0xffbe50;
/** 접지 그림자 블러 반경과 아래 오프셋. 난색 다크(`#2a1a08`)로 굽는다 — 중성 검정은 "때"로 보인다. */
const SHADOW_BLUR = 18;
const SHADOW_DY = 6;
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
const LABEL_PAD_X = 32;
/** 셰브런 ↔ 라벨 간격. 붙어 있어야 한 덩어리로 읽힌다(떨어지면 마커가 고아가 된다). */
const MARKER_GAP = 16;

/**
 * 셰브런 + 라벨을 한 덩어리로 묶어 버튼 중앙에 세운다.
 *
 * 마커를 버튼 가장자리에 고정하지 않는 이유: 라벨 길이는 로케일마다 다르고, 가장자리에 박아
 * 두면 짧은 라벨에서 마커만 멀리 떨어져 **아무것도 가리키지 않는 화살표**가 된다(실화면 220px).
 * 캔버스가 없어 측정이 안 되면 마커를 숨기고 라벨만 중앙에 둔다 — 어긋난 배치보다 낫다.
 */
function layoutHeroLabel(marker: Text, text: Text, w: number, h: number): void {
  const avail = w - LABEL_PAD_X * 2;
  let markerW = 0;
  try {
    markerW = marker.width;
  } catch {
    markerW = 0;
  }
  fitWidth(text, Math.max(0, avail - markerW - MARKER_GAP));
  let textW = 0;
  try {
    textW = text.width;
  } catch {
    textW = 0;
  }
  if (markerW <= 0 || textW <= 0) {
    marker.visible = false;
    text.anchor.set(0.5);
    text.position.set(w / 2, h / 2);
    return;
  }
  const x = (w - (markerW + MARKER_GAP + textW)) / 2;
  // 셰브런은 시각 중심이 글자보다 살짝 위라 1px 내려야 라벨과 눈높이가 맞는다.
  marker.position.set(x, h / 2 + 1);
  text.position.set(x + markerW + MARKER_GAP, h / 2);
}

export interface HeroButton {
  readonly container: Container;
  update(dt: number): void;
}

/**
 * i18n 라벨에서 앞뒤 방향 마커를 걷어낸다.
 *
 * ⚠️ `base.launch` 는 카탈로그에 **이미 `▶` 를 달고 있다**. 호출부가 마커를 하나 더 붙였더니
 * 실화면에 화살표가 둘이 됐고 오른쪽 것이 텍스트에서 220px 떨어져 고아로 떠 있었다(비평 지적).
 * 카탈로그는 다른 화면도 쓰므로 건드리지 않고 **표시 직전에** 정규화한다.
 */
function bareLabel(label: string): string {
  return stripEmoji(label)
    .replace(/^[▶◀\s]+/u, '')
    .replace(/[▶◀\s]+$/u, '');
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
    glow.tint = GLOW_TINT;
    glow.blendMode = 'add';
    glow.alpha = GLOW_BASE;
    glowHost.addChild(glow);
  }

  // 접지 그림자 — 판이 배경 위에 **놓여 있다**는 신호. 없으면 스티커처럼 붙어 보인다.
  //
  // 알약과 **같은 경로·같은 반지름**으로 굽는다. 예전엔 원형 헤이즈를 눌러 썼는데, 알약 모서리와
  // 형상이 달라 어깨에서 어긋나고 색도 중성 검정이라 전면 난색 팔레트에서 "때"로 보였다.
  const shadowTex = pillTexture(w, h, 'rgba(42, 26, 8, 0.6)', 0, SHADOW_BLUR);
  if (shadowTex !== null) {
    const shade = new Sprite(shadowTex);
    shade.anchor.set(0.5);
    shade.width = w + SHADOW_BLUR * 4;
    shade.height = h + SHADOW_BLUR * 4;
    shade.position.set(0, SHADOW_DY);
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
    g.roundRect(0, 0, w, h, h / 2)
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
    // 마스크는 판때기가 실제로 칠해진 범위(1.5px 인셋) 안쪽으로 잡는다. 반지름도 **인셋된
    // 높이의 절반**이어야 한다 — 여기에 h/2 를 그대로 넣는 것이 CRIT-1 의 원인이었다.
    const clip = new Graphics();
    clip.roundRect(2, 2, w - 4, h - 4, (h - 4) / 2).fill({ color: 0xffffff });
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
  //
  // ⚠️ **CRIT-1 의 진짜 원인이 여기였다.** 예전엔 `Graphics.roundRect(2, 2, w-4, h-4, h/2)` 였는데,
  // 반지름 h/2 가 그 사각형 높이의 절반((h-4)/2)보다 커서 모서리 호가 판때기 **밖으로 부풀었다**.
  // 크림이 금 위에서는 안 보이고 삐져나온 부분만 어두운 배경에 찍혀, 호버 중 캡처된 실화면에서
  // 알약 양 어깨에 초승달로 남았다. 이제 판때기와 **같은 경로로 구운 텍스처**를 쓰므로 형상이
  // 어긋나는 것이 원리적으로 불가능하다(폴백도 클램프된 반지름).
  let gloss: Sprite | Graphics;
  const glossTex = pillTexture(w, h, '#fff3d0', 2.5);
  if (glossTex !== null) {
    const sp = new Sprite(glossTex);
    sp.width = w;
    sp.height = h;
    gloss = sp;
  } else {
    const g = new Graphics();
    g.roundRect(2.5, 2.5, w - 5, h - 5, (h - 5) / 2).fill({ color: 0xfff3d0 });
    gloss = g;
  }
  gloss.alpha = 0;
  inner.addChild(gloss);

  // 라벨 + 셰브런. 마커는 {@link bareLabel} 로 정규화한 뒤 **왼쪽 하나만** 다시 세운다.
  const bare = bareLabel(label);
  const markerSize = Math.round(h * 0.26);
  const marker = new Text({
    resolution: 2,
    text: '▶',
    style: { fontFamily: UI_FONT, fontSize: markerSize, fontWeight: '700', fill: COLOR.darkLabel },
  });
  marker.anchor.set(0, 0.5);
  marker.alpha = 0.7;
  inner.addChild(marker);

  const text = new Text({
    resolution: 2,
    text: bare,
    style: {
      fontFamily: UI_FONT,
      fontSize: Math.round(h * 0.37),
      fontWeight: '800',
      // 자간 0 — 한국어 라벨에 트래킹을 주면 `성 계 지 도`가 된다(실화면).
      // ⚠️ 밝은 금 바탕에 흰 글씨는 묻힌다(사용자 지적). 진한 갈색이 계약이다.
      // 어두운 라벨에는 다크 섀도를 걸지 않는다 — 획이 촘촘한 한글이 그림자와 뭉친다.
      fill: COLOR.darkLabel,
      align: 'center',
    },
  });
  text.anchor.set(0, 0.5);
  layoutHeroLabel(marker, text, w, h);
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

// ── 4. 출격 카드(격자 8번째 칸) ─────────────────────────────────────────────

/**
 * 건물 타일과 **같은 격자 문법**을 쓰기 위한 비율 상수.
 *
 * 값은 Lane B `cinematicTile.ts` 와 의도적으로 동일하다(import 는 계약상 금지 — 세 레인은
 * 서로의 파일을 참조하지 않는다). 여기서 하나라도 어긋나면 8번째 칸만 다른 제품처럼 보인다:
 * 같은 모서리 반경 · 같은 라벨 밴드 시작선 · 같은 접지 그림자 2단 · 같은 호버 리프트/부유.
 */
const TILE_BAND_RATIO = 0.71;
const TILE_RADIUS_RATIO = 0.045;
const TILE_PAD_RATIO = 0.062;
const TILE_LIFT_RATIO = 0.026;
const TILE_FLOAT_RATIO = 0.004;
const TILE_FLOAT_PERIOD = 6.2;
const TILE_HOVER_LERP = 9;
/** dt 상한 — 탭 복귀로 프레임이 크게 튀어도 연출이 순간이동하지 않게. */
const MAX_DT = 1 / 15;

/** 출격 카드 맥동 주기(초). 격자 안에서 혼자 살아 있되 번쩍이면 안 된다. */
const TILE_PULSE_PERIOD = 5;
/**
 * 출격 카드 후광 — CTA 알약(0.30±0.075)보다 **훨씬 얕다**.
 *
 * 카드는 알약보다 면적이 10배 넘게 크다. 같은 알파를 주면 그 자체로 화면의 밝기 예산을
 * 독점한다(3차 판정 CRIT·N1: 카드 평균 L 207 · 화면 L>170 화소의 62.7%). 주인공 지위는
 * 밝기 총량이 아니라 **재질·대비·맥동**이 만든다.
 */
const TILE_GLOW_BASE = 0.1;
const TILE_GLOW_AMPL = 0.05;
const TILE_GLOW_HOVER = 0.12;
/** 방사 광휘 각속도(rad/초). 눈으로 좇을 수 없을 만큼 느려야 "빛"이지 "바람개비"가 아니다. */
const RAY_SPIN = 0.055;
/** 궤도 위 점이 한 바퀴 도는 시간(초). */
const ORBIT_PERIOD = 14;
/** 금판을 파낸 각인 색(궤도 링·함선 실루엣). */
const BRONZE = 0x7a4f14;

/** 접지 그림자 한 층의 굽기·배치 명세(건물 타일과 같은 2단 문법). */
interface TileShadowBake {
  readonly spread: number;
  readonly blur: number;
  readonly border: number;
  readonly offset: number;
  readonly alpha: number;
  readonly hoverOffset: number;
  readonly hoverAlpha: number;
  readonly hoverGrow: number;
}

/** 접촉층 — 카드가 바닥에 닿은 자리. 카드가 뜨면 접촉이 끊기므로 알파가 죽는다. */
const TILE_CONTACT: TileShadowBake = {
  spread: 12,
  blur: 4,
  border: 30,
  offset: 2,
  alpha: 0.85,
  hoverOffset: 3,
  hoverAlpha: 0.4,
  hoverGrow: 2,
};

/** 확산층 — 부피감. 카드가 뜰수록 더 내려가고 옅고 넓어진다. */
const TILE_DIFFUSE: TileShadowBake = {
  spread: 48,
  blur: 22,
  border: 68,
  offset: 11,
  alpha: 0.45,
  hoverOffset: 18,
  hoverAlpha: 0.34,
  hoverGrow: 10,
};

/** 구운 그림자 텍스처 안쪽 사각의 한 변과 모서리 반경(나인슬라이스라 카드 크기와 무관). */
const TILE_SHADOW_CORE = 96;
const TILE_SHADOW_RADIUS = 18;

const tileShadowCache = new Map<string, Texture | null>();

/**
 * 카드 모양 드롭 섀도(나인슬라이스용).
 *
 * 스프라이트를 그냥 늘리면 카드 비율에 따라 **모서리 곡률과 흐림 반경이 함께 늘어나** 카드마다
 * 다른 그림자가 된다. 나인슬라이스는 모서리를 고정하고 변만 늘리므로 어떤 치수에서도 같은
 * 흐림이다. `ctx.filter`·`roundRect` 가 없으면 `null` — 호출부가 그림자 없이 진행한다.
 */
function tileShadow(bake: TileShadowBake): Texture | null {
  const key = `${bake.spread}:${bake.blur}`;
  const hit = tileShadowCache.get(key);
  if (hit !== undefined) return hit;
  const size = TILE_SHADOW_CORE + bake.spread * 2;
  const b = bakeCanvas(size, size);
  if (b === null || typeof b.ctx.filter !== 'string' || typeof b.ctx.roundRect !== 'function') {
    tileShadowCache.set(key, null);
    return null;
  }
  b.ctx.filter = `blur(${bake.blur}px)`;
  b.ctx.fillStyle = '#000000';
  pathRoundRect(
    b.ctx,
    bake.spread,
    bake.spread,
    TILE_SHADOW_CORE,
    TILE_SHADOW_CORE,
    TILE_SHADOW_RADIUS,
  );
  b.ctx.fill();
  const tex = toTexture(b.canvas);
  tileShadowCache.set(key, tex);
  return tex;
}

/**
 * 카드 바탕 석재 램프(위→아래). Lane B `cinematicTile.ts` 와 **같은 값**이다 — 출격 카드가
 * 이웃과 같은 판 색을 써야 "같은 격자의 일원"이 된다(3차 판정 CRIT·N2: 판 색·재질·글자 극성이
 * 셋 다 달라 혼자 다른 컴포넌트로 읽혔다).
 */
const TILE_BODY_TOP = { r: 0x52, g: 0x3c, b: 0x28 } as const;
const TILE_BODY_BOTTOM = { r: 0x33, g: 0x25, b: 0x1a } as const;
/** 아트→라벨 페더 높이 비율 · 정사각 아트를 밴드로 크롭할 때의 세로 초점. */
const TILE_FEATHER_RATIO = 0.145;
const TILE_FOCUS_Y = 0.42;
/** 아트/라벨 경계 금박 실선(이웃 타일과 같은 값). */
const SEAM_GOLD = 0xc9a04a;

function tileBodyChannel(k: 'r' | 'g' | 'b', t: number): number {
  return Math.round(TILE_BODY_TOP[k] + (TILE_BODY_BOTTOM[k] - TILE_BODY_TOP[k]) * t);
}

let bodyRampTex: Texture | null | undefined;
/** 카드 바탕 석재 램프(1×256, 불투명). 세로로만 변하므로 폭 1px 이면 충분하다. */
function bodyRamp(): Texture | null {
  if (bodyRampTex !== undefined) return bodyRampTex;
  const h = 256;
  const b = bakeCanvas(1, h);
  if (b === null) {
    bodyRampTex = null;
    return null;
  }
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1);
    b.ctx.fillStyle = `rgb(${tileBodyChannel('r', t)}, ${tileBodyChannel('g', t)}, ${tileBodyChannel('b', t)})`;
    b.ctx.fillRect(0, i, 1, 1);
  }
  bodyRampTex = toTexture(b.canvas);
  return bodyRampTex;
}

let bandFadeTex: Texture | null | undefined;
/**
 * 아트/라벨 페더(1×256). 종착색이 **밴드 바닥에서의 바탕색과 정확히 같아** 알파가 1 에 닿는
 * 지점에서 색 계단이 원리적으로 없다. 알파 지수 1.5 — 선형이면 위쪽이 너무 빨리 덮인다.
 */
function bandFade(): Texture | null {
  if (bandFadeTex !== undefined) return bandFadeTex;
  const h = 256;
  const b = bakeCanvas(1, h);
  if (b === null) {
    bandFadeTex = null;
    return null;
  }
  const r = tileBodyChannel('r', TILE_BAND_RATIO);
  const g = tileBodyChannel('g', TILE_BAND_RATIO);
  const bl = tileBodyChannel('b', TILE_BAND_RATIO);
  for (let i = 0; i < h; i++) {
    const t = (i + 1) / h;
    b.ctx.fillStyle = `rgba(${r}, ${g}, ${bl}, ${t ** 1.5})`;
    b.ctx.fillRect(0, i, 1, 1);
  }
  bandFadeTex = toTexture(b.canvas);
  return bandFadeTex;
}

/**
 * 정사각 일러스트를 `w:h` 비율로 **중앙 크롭**한 텍스처(프레임 UV 크롭 — 늘리지 않는다).
 * 원본은 건드리지 않고 같은 `source` 위에 새 `frame` 을 얹는다(공유 자산 오염 금지).
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
  const cy = src.y + (src.height - ch) * TILE_FOCUS_Y;
  try {
    return new Texture({ source: art.source, frame: new Rectangle(cx, cy, cw, ch) });
  } catch {
    return art;
  }
}

let warmRampTex: Texture | null | undefined;
/**
 * 라벨 밴드를 앉히는 따뜻한 세로 램프(1×256, 투명 → 짙은 호박).
 *
 * 금판 위에서는 **색온도를 유지한 채 밝기만** 눌러야 한다 — 차가운 잉크 스크림을 쓰면 금이
 * 회색으로 죽어 카드가 통째로 탁해진다.
 */
function warmRamp(): Texture | null {
  if (warmRampTex !== undefined) return warmRampTex;
  const h = 256;
  const b = bakeCanvas(1, h);
  if (b === null) {
    warmRampTex = null;
    return null;
  }
  for (let i = 0; i < h; i++) {
    const t = (i + 1) / h;
    b.ctx.fillStyle = `rgba(92, 54, 10, ${0.3 * t ** 1.4})`;
    b.ctx.fillRect(0, i, 1, 1);
  }
  warmRampTex = toTexture(b.canvas);
  return warmRampTex;
}

/**
 * 텍스트 높이(캔버스 없는 환경 방어). `Text.height` 는 측정을 위해 캔버스를 요구해 vitest 에서
 * 던진다 — 이 리포가 UI 테스트에서 실제로 밟은 지점이라 폴백을 둔다.
 */
function safeTextHeight(text: Text, fallback: number): number {
  try {
    const h = text.height;
    return Number.isFinite(h) && h > 0 ? h : fallback;
  } catch {
    return fallback;
  }
}

interface Motif {
  readonly view: Container;
  update(time: number): void;
}

/**
 * 출격 모티프 — 방사 광휘 · 궤도 링 · 함선 실루엣.
 *
 * 건물 타일의 상단은 **그려진 일러스트**지만 여기엔 자산이 없다(§3 새 자산 금지). 그래서 같은
 * 자리를 **각인된 엠블럼**으로 채운다: 금판을 파낸 청동 선(궤도·함선)과 그 뒤에서 새어 나오는
 * 흰 금색 빛. 사진적 일러스트와 경쟁하지 않으면서 "이 칸은 다른 종류"라고 말한다.
 */
function launchMotif(size: number): Motif {
  const view = new Container();
  const haze = softHaze();

  // ① 뒤에서 새어 나오는 흰 금색 코어. 화면에서 가장 밝은 화소가 여기에 있어야 한다.
  if (haze !== null) {
    const core = new Sprite(haze);
    core.anchor.set(0.5);
    core.width = size * 1.15;
    core.height = size * 1.15;
    core.tint = 0xfff6dc;
    core.blendMode = 'screen';
    core.alpha = 0.85;
    view.addChild(core);
  }

  // ② 방사 광휘 — 길고 짧은 쐐기가 번갈아. 아주 느리게 돈다.
  const rays = new Graphics();
  const spokes = 16;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const len = size * (i % 2 === 0 ? 0.62 : 0.42);
    const half = 0.028;
    rays
      .poly([
        Math.cos(a) * len,
        Math.sin(a) * len,
        Math.cos(a - half) * size * 0.1,
        Math.sin(a - half) * size * 0.1,
        Math.cos(a + half) * size * 0.1,
        Math.sin(a + half) * size * 0.1,
      ])
      .fill({ color: 0xfff3cf, alpha: i % 2 === 0 ? 0.34 : 0.2 });
  }
  rays.blendMode = 'add';
  view.addChild(rays);

  // ③ 궤도 링 둘(기울기가 서로 달라야 구가 아니라 궤도로 읽힌다) + 그 위를 도는 점.
  const ringA = new Graphics();
  ringA.ellipse(0, 0, size * 0.56, size * 0.2).stroke({ color: BRONZE, width: 2.5, alpha: 0.65 });
  ringA.rotation = -0.34;
  const ringB = new Graphics();
  ringB.ellipse(0, 0, size * 0.44, size * 0.16).stroke({ color: BRONZE, width: 2, alpha: 0.45 });
  ringB.rotation = 0.52;
  view.addChild(ringA);
  view.addChild(ringB);
  const bead = new Graphics();
  bead
    .circle(0, 0, size * 0.028)
    .fill({ color: 0xfff6dc })
    .stroke({ color: BRONZE, width: 1.5 });
  view.addChild(bead);

  // ④ 함선 — 위로 향한 델타 실루엣. 청동으로 파고 기수에만 밝은 금 립을 준다.
  const ship = new Graphics();
  const s = size * 0.3;
  ship.poly([0, -s, s * 0.66, s * 0.62, 0, s * 0.3, -s * 0.66, s * 0.62]).fill({
    color: 0x3d2408,
    alpha: 0.9,
  });
  ship
    .poly([0, -s * 0.86, s * 0.5, s * 0.42, 0, s * 0.16, -s * 0.5, s * 0.42])
    .fill({ color: BRONZE });
  ship
    .poly([0, -s * 0.86, s * 0.16, -s * 0.2, -s * 0.16, -s * 0.2])
    .fill({ color: GOLD_LIT, alpha: 0.9 });
  view.addChild(ship);

  return {
    view,
    update(time: number): void {
      rays.rotation = time * RAY_SPIN;
      // 링 A 의 기울기를 그대로 적용한 타원 궤적 — 점이 링을 벗어나면 즉시 가짜로 보인다.
      const a = (time / ORBIT_PERIOD) * Math.PI * 2;
      const ex = Math.cos(a) * size * 0.56;
      const ey = Math.sin(a) * size * 0.2;
      const t = ringA.rotation;
      bead.position.set(ex * Math.cos(t) - ey * Math.sin(t), ex * Math.sin(t) + ey * Math.cos(t));
    },
  };
}

/**
 * 출격 카드 — 건물 격자의 8번째 칸이자 **이 화면의 주인공**.
 *
 * ## 왜 하단 CTA 막대가 아니라 격자 한 칸인가
 * 4+3 배치는 2행 좌우에 227px 짜리 죽은 기둥을 남겼고, 하단 CTA 막대는 타일 7장 합계 면적의
 * 3.8% 라 "주인공"이 될 수 없었다. 8번째 칸으로 올리면 ①죽은 기둥이 사라지고 ②CTA 가 격자
 * 안에서 카드 한 장의 무게를 갖고 ③하단이 비어 카드 높이를 키울 수 있다(사용자 확정).
 *
 * ## 두 가지를 동시에 만족한다
 * 1. **같은 격자의 일원** — 반경 · 라벨 밴드 시작선(h×{@link TILE_BAND_RATIO}) · 접지 그림자
 *    2단 · 호버 리프트/부유가 건물 타일과 같은 값이다.
 * 2. **명백한 주인공** — 다만 그 지위는 **밝기 총량이 아니다**.
 *
 * ## ⚠️ 한때 "금색으로 빛나는 판"이었다 — 그게 실패였다(3차 판정 CRIT)
 * 카드 전체를 금판으로 칠했더니 실측 평균 **L 207.2**, 이웃 타일 7장(75.5~94.4)의 **2.5배**,
 * 화면에서 `L>170` 인 화소의 **62.7%** 가 이 카드 하나였다(제목 글리프는 1.9%). 화면을 처음
 * 봤을 때 눈이 가는 곳이 제목도 건물도 아닌 노란 판이 됐다. 게다가 벡터로 그린 판이라 로컬
 * std 0.90 · 죽은 평면 79.3% 로, 유화 7장 옆에서 **혼자 CSS 컴포넌트**로 보였다(가장 평평한
 * 페인터리 타일보다 2배 평평·3배 매끈 — 그레이드나 필터로 메울 수 있는 격차가 아니다).
 *
 * 그래서 판 색·판 재질·글자 극성 셋 다 **이웃과 같게** 되돌렸다: 같은 석재 램프, 같은 붓으로
 * 그린 전용 아트(`base_launch.webp` — 리드가 인자로 넘긴다), 어두운 라벨 밴드 + **밝은 금색**
 * 글자. 주인공 표시는 ①한 단계 진한 금박 테두리 ②느린 얕은 맥동 ③아트 자체의 서사(열린
 * 발사 게이트)뿐이다.
 *
 * 아트가 없으면 절차적 엠블럼으로 폴백한다 — 자산은 덧붙임이지 전제가 아니다(§0-6).
 *
 * 반환 타입은 {@link HeroButton} 그대로다 — 리드가 타일과 같은 방식으로 `update(dt)` 를 돌린다.
 */
export function makeHeroTile(
  w: number,
  h: number,
  label: string,
  sub: string,
  onClick: () => void,
  art?: Texture,
): HeroButton {
  const radius = Math.max(6, Math.round(Math.min(w, h) * TILE_RADIUS_RATIO));
  const pad = Math.round(w * TILE_PAD_RATIO);
  const bandY = Math.round(h * TILE_BAND_RATIO);
  const lift = h * TILE_LIFT_RATIO;
  const floatAmp = h * TILE_FLOAT_RATIO;

  const root = new Container();
  const inner = new Container();

  // --- 접지 그림자(2단, inner 밖) ------------------------------------------------
  // inner 밖에 두는 이유: 카드가 뜰 때 그림자까지 같이 뜨면 부유가 아니라 통째로 미끄러진
  // 것으로 읽힌다. 바닥에 남아 내려가고 옅어지고 넓어져야 "떴다"가 성립한다.
  const shadows: { sprite: NineSliceSprite; bake: TileShadowBake }[] = [];
  for (const bake of [TILE_DIFFUSE, TILE_CONTACT]) {
    const tex = tileShadow(bake);
    if (tex === null) continue;
    const ns = new NineSliceSprite({
      texture: tex,
      leftWidth: bake.border,
      topHeight: bake.border,
      rightWidth: bake.border,
      bottomHeight: bake.border,
    });
    ns.alpha = bake.alpha;
    root.addChild(ns);
    shadows.push({ sprite: ns, bake });
  }
  root.addChild(inner);

  // --- 맥동 후광(카드 뒤, 가산) --------------------------------------------------
  const haze = softHaze();
  let glow: Sprite | null = null;
  if (haze !== null) {
    glow = new Sprite(haze);
    glow.anchor.set(0.5);
    glow.width = w * 1.5;
    glow.height = h * 1.5;
    glow.position.set(w / 2, h * 0.46);
    glow.tint = GLOW_TINT;
    glow.blendMode = 'add';
    glow.alpha = TILE_GLOW_BASE;
    inner.addChild(glow);
  }

  // --- 카드 내용물(둥근 모서리 클리핑) ---------------------------------------------
  const clip = new Container();
  const clipMask = new Graphics();
  clipMask.roundRect(0, 0, w, h, radius).fill({ color: 0xffffff });
  inner.addChild(clip);
  inner.addChild(clipMask);
  clip.mask = clipMask;

  // 바탕 — 이웃 타일과 **같은** 따뜻한 석재 램프.
  const body = bodyRamp();
  if (body !== null) {
    const bg = new Sprite(body);
    bg.width = w;
    bg.height = h;
    clip.addChild(bg);
  } else {
    const bg = new Graphics();
    bg.rect(0, 0, w, h).fill({ color: 0x3f2e1e });
    clip.addChild(bg);
  }

  // --- 아트 밴드(또는 절차적 엠블럼 폴백) -------------------------------------------
  let motif: Motif | null = null;
  if (art !== undefined) {
    const sprite = new Sprite(cropToAspect(art, w, bandY));
    sprite.anchor.set(0.5);
    sprite.position.set(w / 2, bandY / 2);
    sprite.width = w;
    sprite.height = bandY;
    clip.addChild(sprite);
  } else {
    // 폴백: 짙은 호박 바닥 + 각인 엠블럼. 전용 아트가 없어도 "발사"가 읽혀야 한다.
    const ramp = warmRamp();
    if (ramp !== null) {
      const ground = new Sprite(ramp);
      ground.position.set(0, 0);
      ground.width = w;
      ground.height = bandY;
      ground.scale.y = -Math.abs(ground.scale.y); // 위가 짙고 아래로 열리게 뒤집는다.
      ground.position.set(0, bandY);
      clip.addChild(ground);
    }
    motif = launchMotif(Math.min(w, bandY) * 0.72);
    motif.view.position.set(w / 2, bandY * 0.5);
    clip.addChild(motif.view);
  }

  // 아트 → 라벨 페더. 종착색이 그 지점의 바탕색과 정확히 같아 색 계단이 원리적으로 없다.
  const fade = bandFade();
  const feather = Math.max(12, Math.round(h * TILE_FEATHER_RATIO));
  if (fade !== null) {
    const f = new Sprite(fade);
    f.position.set(0, bandY - feather);
    f.width = w;
    f.height = feather;
    clip.addChild(f);
  }

  // --- 라벨 밴드 금빛 차등 --------------------------------------------------------
  // 3차에서 판 전체를 금으로 칠했다가 등급이 깨졌고(CRIT·N1/N2), 그것을 되돌리자 이번엔
  // **어디를 눌러야 하는지 0.2초 안에 안 보인다**는 판정이 나왔다(4차 HIGH). 두 실패의 교집합이
  // 아니라 차집합을 취한다: 아트 밴드(등급 지표가 걸린 곳)는 이웃과 **완전히 동일**하게 두고,
  // **라벨 밴드에만** 금빛을 얹는다. 여기는 원래 단색 램프라 등급 지표(코너/중심비·채도)가
  // 측정되지 않는 영역이다 — 즉 눈에 띄게 만들면서 통합을 깨지 않는 유일한 자리다.
  const bandWash = new Graphics();
  bandWash.rect(0, bandY, w, h - bandY).fill({ color: 0xc8963c, alpha: 0.14 });
  clip.addChild(bandWash);

  // 라벨 밴드 좌우 화살촉 한 쌍(카드 폭 8%). 글리프가 아니라 **베벨과 같은 립 재질**로 긋는다 —
  // 금선 아래 1.5px 다크 드롭이라 판에 박힌 금속 상감으로 읽힌다(`▸` 글리프는 폰트 티가 난다).
  const arrowL = w * 0.08;
  const arrowY = bandY + (h - bandY) * 0.4;
  const arrowH = arrowL * 0.42;
  for (const dir of [-1, 1]) {
    const xs = dir < 0 ? pad * 0.55 : w - pad * 0.55;
    const tip = xs + dir * arrowL * 0.55;
    const chevron = new Graphics();
    for (const [color, dy, alpha] of [
      [0x2a1a08, 1.6, 0.5],
      [GOLD_LIT, 0, 0.9],
    ] as const) {
      chevron
        .moveTo(xs, arrowY - arrowH + dy)
        .lineTo(tip, arrowY + dy)
        .lineTo(xs, arrowY + arrowH + dy)
        .stroke({ color, width: 3, alpha, cap: 'round', join: 'round' });
    }
    clip.addChild(chevron);
  }

  // 호버 온기(가산) — tint 는 곱연산이라 밝힐 수 없다.
  const warm = new Graphics();
  warm.rect(0, 0, w, bandY).fill({ color: 0xffe0a8 });
  warm.blendMode = 'add';
  warm.alpha = 0;
  clip.addChild(warm);

  // --- 아트/라벨 경계 각인선(이웃과 같은 문법) --------------------------------------
  const seam = new Graphics();
  seam.rect(0, bandY, w, 1).fill({ color: SEAM_GOLD, alpha: 0.4 });
  inner.addChild(seam);

  // --- 타이포 ---------------------------------------------------------------------
  // ⚠️ **글자 극성을 이웃과 맞춘다.** 금판 시절에는 밝은 판 + 어두운 글자였는데, 어두운 판 +
  // 밝은 글자인 이웃 7장 사이에서 그 반전 하나가 "혼자 다른 컴포넌트" 신호의 절반이었다
  // (3차 판정 CRIT·N2). 주인공 표시는 색상(금)과 굵기로만 준다.
  const labelSize = Math.min(44, Math.max(24, Math.round(h * 0.105)));
  const subSize = Math.min(20, Math.max(12, Math.round(h * 0.048)));
  const wrapW = w - pad * 2;

  const title = new Text({
    resolution: 2,
    text: bareLabel(label),
    style: {
      fontFamily: UI_FONT,
      fontSize: labelSize,
      fontWeight: '800',
      // ⚠️ `GOLD`(#ffd678)는 Rec.601 로 **215.5** 이고, 실측에서 이웃 타일 제목(231)보다
      // **어두웠다**(216 < 231). 주인공 칸의 제목이 이웃보다 어두운 것은 의도일 수 없다.
      // #ffecb8 = 235.7 로 이웃을 확실히 넘기되 금 계열은 유지한다.
      fill: 0xffecb8,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: wrapW,
      lineHeight: Math.round(labelSize * 1.14),
      dropShadow: { color: 0x000000, alpha: 0.8, blur: 5, distance: 2, angle: Math.PI / 2 },
    },
  });
  title.anchor.set(0.5, 0);

  const subText = new Text({
    resolution: 2,
    text: stripEmoji(sub),
    style: {
      fontFamily: UI_FONT,
      fontSize: subSize,
      fontWeight: '600',
      // 이웃 설명문(회갈)보다 한 단 따뜻한 모래색 — 같은 위계에 있되 이 칸이 금 계열임을 잇는다.
      fill: 0xc7b291,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: wrapW,
      lineHeight: Math.round(subSize * 1.4),
      dropShadow: TEXT_SHADOW,
    },
  });
  subText.anchor.set(0.5, 0);

  // 라벨 블록을 밴드 안에서 세로 중앙 정렬한다(건물 타일과 같은 규칙 — 고정 y 로 찍으면
  // 줄 수가 다른 카드끼리 밑이 어긋나고 남는 높이가 죽은 여백으로 남는다).
  const titleH = safeTextHeight(title, labelSize * 1.14);
  const subH = safeTextHeight(subText, subSize * 1.4);
  const gap = Math.max(4, Math.round(h * 0.018));
  const bandH = h - bandY;
  const blockTop = bandY + Math.max(Math.round(h * 0.012), (bandH - (titleH + gap + subH)) / 2);
  title.position.set(w / 2, blockTop);
  subText.position.set(w / 2, blockTop + titleH + gap);
  inner.addChild(title);
  inner.addChild(subText);

  // --- 테두리: 안쪽 어두운 홈 + 금박 헤어라인 ----------------------------------------
  // 이웃 타일과 같은 구조이되 금박만 **한 단계 진하다**(폭 1.5→2.4 · 알파 0.5→0.85).
  // 밝기 총량을 늘리지 않고 "이 칸이 주인공"이라고 말하는 가장 싼 방법이다.
  const grooveW = Math.max(2, Math.round(Math.min(w, h) * 0.009));
  const edge = new Graphics();
  edge
    .roundRect(grooveW / 2, grooveW / 2, w - grooveW, h - grooveW, radius - grooveW / 2)
    .stroke({ color: GROOVE, width: grooveW, alpha: 0.9 });
  edge
    .roundRect(0, 0, w, h, radius)
    .stroke({ color: GOLD_LIT, width: 2.4, alignment: 1, alpha: 0.85 });
  inner.addChild(edge);

  // --- 호버 림 --------------------------------------------------------------------
  const rim = new Graphics();
  rim.roundRect(0, 0, w, h, radius).stroke({ color: 0xfffbe8, width: 2.5, alignment: 1, alpha: 1 });
  rim.alpha = 0;
  inner.addChild(rim);

  // --- 상호작용 -------------------------------------------------------------------
  // 이벤트는 root 에 걸고 hitArea 를 명시한다 — 위에 얹힌 텍스트가 클릭을 삼키지 않는다.
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.hitArea = new Rectangle(0, 0, w, h);
  root.on('pointertap', onClick);
  let hoverTarget = 0;
  root.on('pointerover', () => {
    hoverTarget = 1;
  });
  root.on('pointerout', () => {
    hoverTarget = 0;
  });

  let hover = 0;
  let time = 0;

  const update = (dt: number): void => {
    const step = Math.min(Math.max(dt, 0), MAX_DT);
    time += step;

    const k = 1 - Math.exp(-TILE_HOVER_LERP * step);
    hover += (hoverTarget - hover) * k;
    if (hover < 0.001 && hoverTarget === 0) hover = 0;

    const bob = Math.sin((time / TILE_FLOAT_PERIOD) * Math.PI * 2) * floatAmp;
    inner.y = bob - lift * hover;
    rim.alpha = 0.75 * hover;
    warm.alpha = 0.085 * hover;
    motif?.update(time);

    if (glow !== null) {
      const pulse = 0.5 + 0.5 * Math.sin((time / TILE_PULSE_PERIOD) * Math.PI * 2);
      glow.alpha = TILE_GLOW_BASE + TILE_GLOW_AMPL * pulse + TILE_GLOW_HOVER * hover;
    }

    for (const { sprite, bake } of shadows) {
      const grow = bake.spread + bake.hoverGrow * hover;
      const drop = bake.offset + (bake.hoverOffset - bake.offset) * hover;
      sprite.width = w + grow * 2;
      sprite.height = h + grow * 2;
      sprite.position.set(-grow, -grow + drop + bob);
      sprite.alpha = bake.alpha + (bake.hoverAlpha - bake.alpha) * hover;
    }
  };

  // 첫 프레임 전에도 정지 상태가 정확하도록 한 번 정착시킨다.
  update(0);

  return { container: root, update };
}
