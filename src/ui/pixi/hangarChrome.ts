/**
 * 격납고 화면 시네마틱 크롬 — 각인 제목 · 유리 재화 칩 · 버튼/슬롯 바탕 텍스처
 * (격납고 레인 계약 §3 Lane C, `.omc/plans/hangar-aaa-2026-08-02.md`).
 *
 * ## 왜 새 파일인가 (그리고 왜 복제인가)
 * 기지 화면의 `cinematicChrome.ts` 가 각인 제목·유리 칩의 **검증된 관용구**를 이미 갖고 있다.
 * 그러나 계약 §2 가 그 파일의 수정을 금지한다(기지 화면이 쓰고 있고, 치수·톤이 기지 기준으로
 * 튜닝돼 있다). 그래서 `bakeCanvas` / `toTexture` / `pathRoundRect` / `fitWidth` / 금·청록
 * 팔레트는 **출처를 밝히고 복제**했다. 그 값들이 왜 그런지의 근거는 원본 헤더에 있다:
 *   - 아웃라인 + 세로 금 그라디언트 3중 스택이 없으면 "굵은 본문"으로 되돌아간다.
 *   - 칩 값 텍스트는 크림이 아니라 한 단 낮춘 `CHIP_TEXT` — 강조색이면 테두리에 흡수된다.
 *   - `pathRoundRect` 의 반지름 클램프는 초승달 아티팩트(CRIT-1)를 원천 봉쇄한다.
 *
 * ## 왜 버튼·슬롯을 다시 만들지 않고 "텍스처만 주입"하는가
 * `PixiButton` 은 스프링 촉각 · UI 사운드 · disabled · 라벨 자동 축소를, `makeSlotCell` 은
 * 등급 테두리 · 요구 레벨 배지 · 잠김 딤 · hover/우클릭 배선을 이미 갖고 있다. 다시 만들면
 * 그 기능들이 **조용히 퇴행한다**(이 리포에서 반복된 결함 유형). 그래서 로직은 그대로 두고
 * 바탕 텍스처만 나무 nine-slice → 석재로 갈아끼운다.
 *
 * ## 9-slice 제약이 그림을 결정한다
 * `PixiButton` 은 `leftWidth/rightWidth = cap`, `topHeight/bottomHeight = 0` 으로 감싼다.
 * 즉 **가운데 세로 띠가 가로로 늘어난다** → 그 구간에 가로 방향 무늬를 넣으면 늘어나면서
 * 줄무늬로 번진다. 그래서 버튼 그레인은 **행 단위(세로 방향 변화)** 로만 넣었다. 늘려도
 * 번지지 않고, 결과적으로 결이 층리(strata)처럼 읽혀 석재와도 맞는다.
 * 텍스처는 **1:1(128×64)** 로 굽는다 — 2× 로 구우면 텍스처 픽셀 폭이 2배가 되어 계약이
 * 정한 `cap = 32` 가 캡이 아니라 1/8 조각을 가리키게 된다.
 *
 * ## 슬롯은 반대로 2× 이상으로 굽는다
 * `makeSlotCell` 은 `Sprite.width/height = size` 로 **정사각을 통짜로 늘린다**(현재 62·72px).
 * 확대되면 흐려지므로 160² 로 굽고 `linear` 로 축소되게 한다.
 * ⚠️ **밝은 링을 두르지 않는다.** `theme.ts` `iconContrastRingBands` 의 실측 결론이다 —
 * 아이콘 35종의 휘도 폭이 넓어 어떤 밝은 링도 중간 톤 아이콘을 새로 묻히게 만든다. 대비는
 * **어두운 홈**이 만든다. 그리고 등급 테두리는 `pad = size × 0.1` 자리에 앉으므로, 그 띠에
 * 겹치는 프레임 장식은 전부 어둡게 둔다(금색 프레임 ↔ 레어 금색 흡수가 과거 결함이었다).
 *
 * ## 등급 색은 건드리지 않는다
 * `RARITY_COLOR_NUM` / `SLOT_RARITY_COLOR_NUM` / `SLOT_RARE_GROOVE` 는 파밍 시각 언어이고
 * ΔE 실측 위에 서 있다(계약 §0-bis-1). 이 파일은 그 값들을 읽지도 쓰지도 않는다.
 *
 * ## 캔버스 없는 환경(vitest/SSR)
 * `document` 가 없으면 굽기는 전부 `undefined` 를 돌려주고, 호출부는 `fallbackColor` /
 * `makeSlotCell` 폴백 Graphics 로 내려간다. `Text.width` 는 던지므로 측정은 전부 try/catch.
 * **컨테이너는 어떤 경우에도 돌아온다** — 크롬 생성 실패가 화면을 통째로 죽이면 안 된다.
 *
 * ## 결정성
 * 구운 텍스처는 모듈 1회 캐시이고 난수는 전부 `sin` 해시다(`Math.random()` 금지). 실행마다
 * 결이 바뀌면 스크린샷 회귀 비교가 불가능해진다.
 */

import { CanvasSource, Container, FillGradient, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { COLOR, UI_FONT } from './theme.js';
import { stripEmoji } from './text.js';

// ── 팔레트 (출처: cinematicChrome.ts — 같은 붓을 쓰기 위해 값을 그대로 가져왔다) ──────────
/** 각인 금박 상단 스톱. 타이틀 로고 `PLANET BLITZ` 와 같은 스톱이다. */
const GOLD_LIT = 0xf6d98a;
/** 금박 하단 스톱 — 위/아래 두 스톱이 세로 그라디언트를 만든다. */
const GOLD_DARK = 0xb8862f;
/** 금박 본색(장식·폴백 아이콘). */
const GOLD = 0xffd678;
/** 금박 그늘. */
const GOLD_DEEP = 0x8a5a12;
/** 제목 아웃라인 — 시스템 폰트를 디스플레이 타입으로 읽히게 만드는 결정적 한 겹. */
const TITLE_OUTLINE = 0x2a1a08;
/** 제목 하단 드롭 — 따뜻한 금갈색(검은 그림자는 폰트 티를 낸다). */
const TITLE_DROP = 0x7a5520;
/**
 * 유리판 바탕 — **청회색 슬레이트**. 기지의 `GLASS_INK`(#0B0A16, L≈9)를 그대로 쓰면 눌린
 * 헤더(실측 L 4.7~19) 위에서 배경과 구분되지 않아 "유리가 아니라 검은 구멍"이 된다
 * (1차 판정 M9ⓒ). 자기 색이 있어야 판이 배경에서 분리된다.
 */
const GLASS_PLATE = 0x232a3a;
/**
 * 유리 채움 알파. 배경 투과율 = `1 − α` = **0.22**(계약 갱신이 요구한 15~25% 대역 안).
 * 이보다 낮추면(=더 투명하게) 헤더 배경이 거의 검정이라 유리가 다시 구멍이 된다.
 */
const CHIP_GLASS_ALPHA = 0.78;
/**
 * 칩 유리의 배경 투과율(0..1). 알파에서 **파생**한다 — 투과율을 주석에만 적어 두면 알파를
 * 고칠 때 조용히 거짓말이 된다. 게이트 검산용으로 export 한다.
 */
export const CHIP_TRANSMIT = 1 - CHIP_GLASS_ALPHA;
/** 안쪽 홈 — 어떤 바탕 위에서도 테두리 대비를 만드는 유일한 수단. */
const GROOVE = 0x120b07;
/** 광물 칩의 청록(채도를 낮춘 값 — 금색 화면에서 혼자 고립되지 않게). */
const TEAL = 0x8fc4b8;
const TEAL_DEEP = 0x2f5f58;
/** 칩 값 텍스트 — 제목보다 확실히 뒤에 앉는 톤(크림은 제목과 동률이 된다). */
const CHIP_TEXT = 0xa89e88;

// ── 굽기 유틸 (출처: cinematicChrome.ts) ─────────────────────────────────────

interface Baked {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** 캔버스 + 2D 컨텍스트. 없는 환경(테스트/SSR)이면 `null`. */
function bakeCanvas(w: number, h: number): Baked | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
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

/**
 * 캔버스 둥근 사각 경로. `roundRect` 미지원 환경이면 각진 사각으로 폴백한다.
 * ⚠️ 반지름은 **항상 변 절반으로 클램프한다**(원본 헤더 CRIT-1 근거).
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

/**
 * 결정적 의사난수 [0,1). `Math.random()` 을 쓰면 실행마다 결이 바뀌어 스크린샷 회귀 비교가
 * 불가능해진다(원본 `stoneGrain` 과 같은 해시).
 */
function hash01(i: number): number {
  return (((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1;
}

/**
 * 텍스트가 `max` 를 넘으면 그 자리에서 축소한다(로케일·자릿수로 라벨 길이가 런타임에 변한다).
 * ⚠️ `Text.width` 는 캔버스 측정을 강제해 캔버스 없는 환경에서 던지므로, 측정이 안 되면
 * 장식을 조용히 포기한다.
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

let hazeTex: Texture | null | undefined;
/**
 * 부드러운 원형 헤이즈(흰색). 제목 뒤 안개에 쓴다 — 색은 `tint` 로 입힌다. 필터 블러보다
 * 싸고 저티어에서도 안전하다.
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

// ── 1. 각인 제목 ────────────────────────────────────────────────────────────

/**
 * 제목 글자 크기.
 *
 * 기지는 84px 이지만 **여기서는 그 값을 쓰면 안 된다.** 기지는 헤더가 화면 상단 1/4 을 통째로
 * 쓰는 로비 화면이고, 격납고 헤더 밴드는 **104px 뿐**이다(계약 §1 좌표표). 84px 새김은
 * 아웃라인·드롭까지 합치면 밴드를 꽉 채워 재화 칩과 세로로 부딪힌다. 격납고는 로비가 아니라
 * **정비 도구**이므로 제목이 화면의 주인공일 이유도 없다 — 주인공은 슬롯과 수치다.
 * 52px 은 카드 제목(33px)의 1.6배로 위계는 확실히 서면서 밴드 안에 여유(위아래 26px)가 남는다.
 */
const TITLE_SIZE = 52;
/**
 * 제목 아웃라인 두께. 없애면 52px 짜리 굵은 본문으로 되돌아간다(웹폰트가 없어 시스템 스택을
 * 디스플레이 타입으로 읽히게 하는 것이 이 한 겹이다). 기지의 2.5px 을 글자 크기 비율로
 * 줄인 값 — 두꺼우면 회화적 배경 옆에서 스티커가 된다.
 */
const TITLE_STROKE = 1.8;
/** 제목 최대 폭(넘치면 축소). 헤더 밴드 중앙을 쓰되 좌우 재화 칩 자리를 침범하지 않는 폭. */
const TITLE_MAX_W = 760;

/**
 * 격납고 헤더 각인 제목 — 앵커 **(0.5, 0)**. 호출자가 (화면 중앙 x, 제목 윗변 y) 를 잡는다.
 * **부제는 없다**(계약 §3) — 기능 화면에 설명문을 얹으면 밴드가 두 줄이 되고 정보 밀도가 준다.
 *
 * 구성(뒤 → 앞): 옅은 안개 · 다크 드롭 · 금 그라디언트 + 다크 아웃라인 · 윗부분 스페큘러.
 * 셋 중 하나라도 빠지면 "굵은 글씨"로 돌아간다(기지에서 검증된 스택).
 *
 * ⚠️ **자간을 주지 않는다.** 한국어 2~4음절에 트래킹을 넣으면 디자인이 아니라 **띄어쓰기
 * 버그**로 읽힌다(`방 어 사 령 부`, 기지 1차 판정 HIGH-5). 위계는 크기·굵기·색으로만 만든다.
 */
/**
 * 세로 금 그라디언트로 칠한 Text. 그라디언트를 쓸 수 없으면 **단색 금**으로 다시 만든다.
 *
 * ⚠️ **`FillGradient` 는 캔버스 없는 환경에서 던진다** — 그런데 던지는 시점이 `new FillGradient`
 * 가 아니라 **`new Text`** 다. Pixi 는 그라디언트를 지연 생성하고 `TextStyle` 이 fill 을 세울
 * 때 비로소 캔버스에 굽는다(`TextStyle.set fill` → `handleFillGradient` → `getCanvas`).
 * 그래서 생성자만 감싸는 try/catch 로는 **막히지 않는다** — 이 파일의 vitest 스모크가 실제로
 * 그렇게 한 번 실패했고, 그래서 `Text` 생성 전체를 감싼다.
 *
 * 계약 §0-7 이 열거한 "던지는 것"(`document`·`Text.width`·`ColorMatrixFilter`) 목록에 없던
 * 네 번째 항목이다. 기지 `cinematicChrome.ts` `makeScreenTitle` 에도 같은 구멍이 남아 있다
 * (그 화면은 아직 캔버스 없이 호출되는 경로가 없어 드러나지 않았을 뿐이다).
 */
function goldText(text: string, base: Record<string, unknown>): Text {
  const stroke = { color: TITLE_OUTLINE, width: TITLE_STROKE, join: 'round' as const };
  try {
    return new Text({
      resolution: 2,
      text,
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
        stroke,
      },
    });
  } catch {
    return new Text({ resolution: 2, text, style: { ...base, fill: GOLD, stroke } });
  }
}

export function makeHangarTitle(text: string): Container {
  const root = new Container();
  const title = stripEmoji(text);

  // 제목 뒤 안개 — 헤더 밴드는 배경이 그대로 보이는 자리라(계약 §1), 밝은 구름 위에서도
  // 글자가 뜨도록 아주 옅게 깐다. 가리지 않는 최소량.
  const haze = softHaze();
  if (haze !== null) {
    const glow = new Sprite(haze);
    glow.anchor.set(0.5);
    glow.width = 640;
    glow.height = 140;
    glow.position.set(0, TITLE_SIZE * 0.5);
    glow.tint = 0x120c1e;
    glow.alpha = 0.46;
    root.addChild(glow);
  }

  const base = {
    fontFamily: UI_FONT,
    fontSize: TITLE_SIZE,
    // 800 이 아니라 700 — 시스템 스택의 최대 굵기는 획이 뭉쳐 "굵게 누른 본문" 티가 난다.
    fontWeight: '700' as const,
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
  // 오프셋 1 — 각인 규약(홈 아래 입술)과 같은 두께다. 더 크면 글자가 판에서 떠 보인다.
  drop.position.set(0, 1);
  root.addChild(drop);

  const face = goldText(title, base);
  face.anchor.set(0.5, 0);
  fitWidth(face, TITLE_MAX_W, 0.7);
  drop.scale.copyFrom(face.scale); // 축소가 걸리면 드롭도 같이 줄어야 어긋나지 않는다.
  root.addChild(face);

  // 스페큘러 — 글자 윗부분만 밝힌다. 아웃라인 위로 번지지 않게 띠 마스크로 자른다.
  const spec = new Text({
    resolution: 2,
    text: title,
    style: { ...base, fill: 0xfff6dc },
  });
  spec.anchor.set(0.5, 0);
  spec.scale.copyFrom(face.scale);
  spec.blendMode = 'screen';
  spec.alpha = 0.46;
  const band = new Graphics();
  band
    .rect(-TITLE_MAX_W / 2, TITLE_SIZE * 0.12, TITLE_MAX_W, TITLE_SIZE * 0.3)
    .fill({ color: 0xffffff });
  root.addChild(band);
  spec.mask = band;
  root.addChild(spec);

  return root;
}

// ── 1-bis. 헤더 각인 석재 인방 ──────────────────────────────────────────────

/**
 * 제목·칩·버튼이 앉는 띠(디자인 y). 인방의 디테일은 **이 띠 바깥**으로 몰아야 한다 —
 * 그 위에 얹히는 글자의 대비를 깎으면 M7 을 고치다 통과했던 항목을 깨는 것이 된다.
 */
const LINTEL_CLEAR_TOP = 20;
const LINTEL_CLEAR_BOTTOM = 82;
/** 치형(dentil) 기준 피치·이빨 폭. 폭이 2px 미만이면 축소에서 뭉개져 HF 가 사라진다. */
const DENTIL_PITCH = 22;
const DENTIL_TOOTH = 13;

/**
 * 치형 이빨 면의 마모 4종(2차 판정 N1). **밝기 차이지 색 차이가 아니다** — 색이 갈리면 인방이
 * 한 채석장 돌로 안 읽힌다. 범위는 L 150~185 로 좁게 잡아 HF 달성치를 깎지 않는다.
 */
const DENTIL_FACES = ['#c9ab77', '#b89b6b', '#d3b684', '#ab9063'] as const;

/**
 * 치형 유닛 하나의 결정적 변주 — 폭·깊이·그늘 두께·결손·모서리 파손.
 *
 * ## 왜 필요한가 (2차 판정 N1)
 * 앞판은 폭 13 / 피치 22 를 화면 폭에 그대로 반복했다. 실측 자기상관이 **지연 20px 에서
 * r = 0.93**, 800px 에서도 0.28 — 1750px 전 구간에 위상이 살아 있었다. 완전 주기는
 * "타일 텍스처를 늘렸다"의 정의이고, 화면 최상단·제목 바로 위라 **필름 스프로킷**으로 읽혔다.
 * 1차에 슬롯 셀에서 지적받은 결함(동일 스탬프 80칸)이 더 잘 보이는 자리로 옮겨온 형태다.
 *
 * ## 처방의 핵심은 밝기가 아니라 **피치**다
 * 마모 4종만 섞으면 자기상관은 잘 안 떨어진다 — 격자가 그대로면 **위상**이 유지되기 때문이다.
 * 고정 지연 r 을 실제로 무너뜨리는 것은 **피치 자체를 흔드는 것**이다. 그래서 이빨 폭
 * (10~16)과 간격(6~13)을 따로 흔들어 유효 피치가 16~29 로 퍼지게 했다.
 *
 * 난수는 전부 결정적 해시다 — 실행마다 배치가 바뀌면 스크린샷 회귀 비교가 불가능해진다.
 */
interface DentilUnit {
  readonly tooth: number;
  readonly advance: number;
  readonly face: string;
  readonly top: number;
  readonly shadow: number;
  readonly missing: boolean;
  readonly chipped: boolean;
}

function dentilUnit(i: number): DentilUnit {
  const r0 = hash01(i * 1.618 + 0.31);
  const r1 = hash01(i * 2.713 + 5.77);
  const r2 = hash01(i * 4.221 + 11.3);
  const r3 = hash01(i * 7.777 + 2.21);
  const tooth = DENTIL_TOOTH + Math.round((r0 - 0.5) * 6); // 10..16
  return {
    tooth,
    advance: tooth + 6 + Math.round(r3 * 7), // 유효 피치 16..29
    face: DENTIL_FACES[Math.floor(r1 * DENTIL_FACES.length)] ?? DENTIL_FACES[0],
    top: r2 > 0.78 ? 8 : 7, // 이빨마다 파인 깊이가 조금씩 다르다
    shadow: 2 + Math.round(r2 * 3),
    // 결손은 드물어야 한다 — 흔하면 폐허가 되고, 없으면 다시 기계 가공 스트립이다.
    missing: r1 < 0.055,
    chipped: r0 > 0.78,
  };
}

const lintelCache = new Map<string, Texture | null>();

/**
 * 헤더 인방을 픽셀로 굽는다(1:1). 전 구성이 한 패스에서 최종 색으로 합쳐지므로 알파 이중가산
 * 가로줄이 원리적으로 생기지 않는다(계약 §0-4).
 */
/** 인방 프리즈에 파는 얕은 감실 하나(인방 로컬 좌표). 재화 칩이 그 안에 앉는다. */
export interface LintelNiche {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 감실 바닥 밝기. 프리즈 본체가 L\* ≈ 11.8 이라 그 위에 얹힌 유리 칩은 알파를 아무리 내려도
 * 밝아지지 않는다(2차 판정 MINOR-c 의 진단 그대로 — 투과율로는 못 푼다). 뒤를 밝혀야 한다.
 *
 * 값은 **칩 글자 대비의 하한에서 역산**했다. 칩 채움 합성 = `0.78·판(L 41.7) + 0.22·감실`
 * 이고 칩 숫자(L 158.4)와의 대비가 4.5:1 이려면 채움이 8-bit L ≤ 57 이어야 한다 →
 * 감실 ≤ 112. 여유를 두고 **72** 로 잡으면 채움 ≈ 48.4(L\* ≈ 26.5), 대비 **4.96:1** 이다.
 * 감실을 더 밝히면 칩이 화면에서 가장 밝은 덩어리가 되어 1차에 고쳤던 결함이 되돌아온다.
 */
const NICHE_FLOOR = '#4c463c';

function bakeLintel(w: number, h: number, niches: readonly LintelNiche[]): Texture | null {
  const b = bakeCanvas(w, h);
  if (b === null) return null;
  const { ctx } = b;
  const top = LINTEL_CLEAR_TOP;
  const bot = LINTEL_CLEAR_BOTTOM;

  /** 한 밴드. 전 구간 등폭·등알파라 어느 구간에서 재도 같은 대비가 나온다. */
  const band = (y: number, hh: number, css: string): void => {
    ctx.fillStyle = css;
    ctx.fillRect(0, y, w, hh);
  };

  // ── 프리즈(본체) — 어둡게 유지한다. 글자가 여기 얹힌다.
  const body = ctx.createLinearGradient(0, top, 0, bot);
  body.addColorStop(0, '#2b2419');
  body.addColorStop(0.5, '#221c14');
  body.addColorStop(1, '#191410');
  ctx.fillStyle = body;
  ctx.fillRect(0, top, w, bot - top);

  // 프리즈의 조적 이음선 — **어두운 홈**이라 그 위 글자의 대비를 오히려 올린다. 밝은 선을
  // 넣으면 정확히 반대가 된다(계약 §0-bis-2 와 같은 결론).
  const bays = Math.max(1, Math.round(w / 240));
  const pitch = w / bays;
  for (let i = 1; i < bays; i++) {
    const x = Math.round(i * pitch);
    ctx.fillStyle = 'rgba(8, 5, 3, 0.55)';
    ctx.fillRect(x - 1, top, 2, bot - top);
    ctx.fillStyle = 'rgba(190, 158, 104, 0.1)';
    ctx.fillRect(x + 1, top, 1, bot - top);
  }

  // ── 감실(MINOR-c) — 재화 칩이 앉는 자리를 **얕게 파고 그 안을 밝힌다.**
  // 조명 부호는 파인 면의 것이다(볼록한 버튼과 반대): **위가 그늘, 아래가 수광.** 이 부호가
  // 뒤집히면 칩이 감실 안에 든 것이 아니라 인방 위에 붙은 판때기가 된다.
  for (const n of niches) {
    const nx = Math.round(n.x);
    const ny = Math.round(n.y);
    const nw = Math.round(n.w);
    const nh = Math.round(n.h);
    if (nw <= 6 || nh <= 6) continue;
    // 바깥 홈 — 파낸 자리의 경계. 조적 이음선을 여기서 끊는 것도 겸한다.
    ctx.fillStyle = 'rgba(8, 5, 3, 0.85)';
    ctx.fillRect(nx - 3, ny - 3, nw + 6, nh + 6);
    // 바닥 — 위에서 아래로 밝아진다(파인 면).
    const nf = ctx.createLinearGradient(0, ny, 0, ny + nh);
    nf.addColorStop(0, '#332f29');
    nf.addColorStop(0.45, NICHE_FLOOR);
    nf.addColorStop(1, '#565046');
    ctx.fillStyle = nf;
    ctx.fillRect(nx, ny, nw, nh);
    // 아래 입술만 수광 — 파인 면의 조명 부호를 완성한다.
    ctx.fillStyle = 'rgba(214, 176, 116, 0.3)';
    ctx.fillRect(nx, ny + nh - 1, nw, 1);
  }

  // ── 상부 코니스(y 0..20) — 파시아 2단 + 치형 + 소핏 그늘.
  band(0, 3, '#e0c48f'); // 최상단 수광 파시아
  band(3, 2, '#8a6f45');
  band(5, 2, '#3b2f1f');
  // 치형 — 이 화면에서 HF 를 만드는 1차 장치다. 이빨은 위 수광 / 아래 그늘 / 사이는 빈 그늘.
  // 유닛마다 폭·간격·마모·깊이가 다르다({@link dentilUnit}) — 등피치 반복이 N1 의 원인이었다.
  {
    let x = Math.round(pitch / 2) % DENTIL_PITCH;
    for (let i = 0; x < w; i++) {
      const u = dentilUnit(i);
      if (!u.missing) {
        ctx.fillStyle = u.face;
        ctx.fillRect(x, u.top, u.tooth, 13 - u.top);
        ctx.fillStyle = '#5c4930';
        ctx.fillRect(x, 13, u.tooth, u.shadow);
        // 모서리 파손 — 오른쪽 위 귀퉁이가 떨어져 나간 이빨. 결정적으로 일부에만.
        if (u.chipped) {
          ctx.fillStyle = 'rgba(20, 14, 7, 0.55)';
          ctx.fillRect(x + u.tooth - 3, u.top, 3, 3);
        }
      }
      x += u.advance;
    }
  }
  band(16, 2, '#0f0b07'); // 치형 아래 소핏 그늘
  band(18, 2, '#4a3c27'); // 프리즈 상단 수광 모서리

  // ── 하부(y 82..104) — 아스트라갈 홈 + 하단 파시아 + 낙수 그림자.
  band(bot, 2, '#4a3c27');
  band(bot + 2, 3, '#0e0a06');
  band(bot + 5, 4, '#c2a471');
  band(bot + 9, 3, '#6b563a');
  // 하부 치형(상부보다 성기게 — 같은 피치를 두 번 쓰면 인방이 사다리로 읽힌다). 2차 실측에서
  // 이 띠는 이미 r ≈ 0.50 이었지만, 상부만 흔들면 두 띠의 리듬이 갈려 보이므로 같이 흔든다.
  {
    let x = 0;
    for (let i = 0; x < w; i++) {
      const u = dentilUnit(i + 977); // 상부와 다른 시드 구간 — 두 띠가 같은 무늬가 되면 안 된다.
      ctx.fillStyle = '#241c12';
      ctx.fillRect(x + 4, bot + 12, u.tooth + 7, 4 + (u.top === 8 ? 2 : 1));
      x += u.advance * 2;
    }
  }
  band(bot + 17, 3, '#100b07');
  const drip = ctx.createLinearGradient(0, bot + 20, 0, h);
  drip.addColorStop(0, 'rgba(6, 4, 2, 0.75)');
  drip.addColorStop(1, 'rgba(6, 4, 2, 0)');
  ctx.fillStyle = drip;
  ctx.fillRect(0, bot + 20, w, h - bot - 20);

  // ── 양 끝 코벨(브래킷) — 인방이 무엇에 하중을 싣는지 눈이 즉시 알게 한다. 상·하부에만
  // 두어 제목·칩 띠를 침범하지 않는다(전체 높이로 세우면 정확히 그 띠를 가로지른다).
  for (const cx of [34, w - 34]) {
    for (const [y0, hh] of [
      [0, top],
      [bot, h - bot],
    ] as const) {
      ctx.fillStyle = '#3a2e1e';
      ctx.fillRect(cx - 26, y0, 52, hh);
      ctx.fillStyle = '#d8bc86';
      ctx.fillRect(cx - 26, y0, 52, 2);
      ctx.fillStyle = 'rgba(8, 5, 3, 0.7)';
      ctx.fillRect(cx - 26, y0 + hh - 3, 52, 3);
      ctx.fillRect(cx - 27, y0, 2, hh);
      ctx.fillRect(cx + 25, y0, 2, hh);
    }
  }

  // ── 석재 그레인 — 전 면에 ±7. 완전히 균질한 면은 유화 옆에서 CSS `div` 로 읽힌다.
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    const d = Math.round((hash01(i * 31 + 7) - 0.5) * 14);
    img.data[i * 4] = Math.max(0, Math.min(255, (img.data[i * 4] ?? 0) + d));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, (img.data[i * 4 + 1] ?? 0) + d));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, (img.data[i * 4 + 2] ?? 0) + d));
  }
  ctx.putImageData(img, 0, 0);

  return toTexture(b.canvas);
}

/**
 * 헤더 밴드를 채우는 **각인 석재 인방**. 좌표는 (0,0) 기준 — 리드가 배치한다.
 *
 * ## 왜 배경 노출이 아니라 건축 요소인가 (1차 판정 M7)
 * 레이아웃 계약은 헤더 밴드(화면의 9.6%)를 창과 함께 "실제 키아트 32%"로 계산했다. 그런데
 * 실측하면 거기엔 **그림이 없다**: 크롬 없는 세로 스트립의 |HF| 가 1.30~1.56, 양 끝은 0.36
 * (L\* 4.71 = 사실상 순흑)인데 창 키아트는 **17.15** 다. 헤더는 눌린 게 아니라 비어 있었다.
 *
 * ⚠️ **배경 억제를 푸는 방향은 답이 아니다.** 글자 대비는 이미 통과했다(제목 8.08:1 ·
 * 칩 숫자 5.25:1, 요구 4.5:1). 밝히면 그 둘이 같이 무너진다. 빈 자리에는 **그릴 것을 넣는
 * 것**이 정직하다 — `gutterRibs.ts` 가 거터에서 한 것과 같은 처방이다(원화의 주기와 격자의
 * 주기가 안 맞을 때 증폭으로는 못 풀고, 격자를 담는 크롬을 그려야 한다).
 *
 * ## 구성과 그 근거
 * 상부 코니스(파시아 2단 + **치형** + 소핏 그늘) · 프리즈(조적 이음선) · 하부 아스트라갈 +
 * 낙수 그림자 · 양 끝 코벨. 어휘는 `cinematicChrome.ts` `carvedDivider`(파시아/본체/처마 3밴드,
 * 주두가 하중을 받는 자리) 와 `gutterRibs.ts`(주두·기초·접지) 에서 가져왔다 — 두 파일 다
 * 기지 화면이 쓰고 있어 **수정 금지**라 복제했다.
 *
 * HF 의 대부분은 **치형**이 만든다: 폭 {@link DENTIL_TOOTH} 의 이빨이 {@link DENTIL_PITCH}
 * 간격으로 L≈170 ↔ L≈35 를 오간다. 등알파 헤어라인을 쓰지 않은 이유는 `carvedDivider` 헤더에
 * 있다 — 배경 휘도가 변하는 필드 위에서 저알파 선은 밝은 구간에 그냥 묻힌다(6차 판정 최상위
 * 결함). 여기 밴드는 전부 **자기 색을 가진 불투명 채움**이라 배경과 무관하게 대비가 일정하다.
 *
 * ## 무엇을 침범하지 않는가
 * 제목(중앙)·재화 칩·버튼 6종이 앉는 **y {@link LINTEL_CLEAR_TOP}..{@link LINTEL_CLEAR_BOTTOM}**
 * 띠에는 어두운 조적 이음선과 그레인만 둔다. 둘 다 국소 휘도를 **낮추는** 획이라 그 위 글자의
 * 대비는 깎이지 않고 오히려 올라간다. 코벨도 그 띠를 피해 상·하부에만 세운다.
 *
 * ## `niches` — 재화 칩이 앉는 얕은 감실(2차 판정 MINOR-c)
 * 비워 두면 예전과 동일하게 동작한다. 칩 자리를 넘기면 그 구간 프리즈를 파고 바닥을
 * {@link NICHE_FLOOR} 로 밝힌다. 유리 칩이 유리로 안 읽히던 근본 원인이 **뒤가 L\* 11.8 인
 * 어두운 띠**여서였다 — 알파를 낮추는 방향으로는 원리적으로 못 푼다(투과를 늘려도 어두운
 * 것이 비칠 뿐이다). 건축적으로도 재화 표시를 감실에 앉히는 것이 맞다.
 */
export function makeHangarLintel(
  w: number,
  h: number,
  niches: readonly LintelNiche[] = [],
): Container {
  const root = new Container();
  root.eventMode = 'none'; // 크롬은 클릭 대상이 아니다 — 헤더 버튼 히트 테스트를 가로채면 안 된다.
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  // 감실은 캐시 키의 일부다 — 빼면 칩 자리가 바뀌어도 예전 굽기가 그대로 돌아온다.
  const key = `${width}x${height}|${niches
    .map((n) => `${Math.round(n.x)},${Math.round(n.y)},${Math.round(n.w)},${Math.round(n.h)}`)
    .join(';')}`;
  let tex = lintelCache.get(key);
  if (tex === undefined) {
    tex = bakeLintel(width, height, niches);
    lintelCache.set(key, tex);
  }
  if (tex !== null) {
    const sp = new Sprite(tex);
    sp.width = w;
    sp.height = h;
    root.addChild(sp);
    return root;
  }
  // 캔버스 없는 환경 폴백 — **겹치지 않는** 불투명 단색 띠로 계단 근사한다(알파 이중가산 0).
  const g = new Graphics();
  g.rect(0, 0, w, h).fill({ color: 0x221c14 });
  g.rect(0, 0, w, 3).fill({ color: 0xe0c48f });
  g.rect(0, LINTEL_CLEAR_BOTTOM, w, 3).fill({ color: 0xc2a471 });
  root.addChild(g);
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
 * 유리판 세로 램프(1×64). 위가 밝고 아래로 어두워진다 — 판에 **두께**를 주는 성분이다.
 *
 * ⚠️ 띠를 겹쳐 근사하지 않는다(계약 §0-4: 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴
 * 실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 */
let chipRampTex: Texture | null | undefined;
function chipRamp(): Texture | null {
  if (chipRampTex !== undefined) return chipRampTex;
  const b = bakeCanvas(1, 64);
  if (b === null) {
    chipRampTex = null;
    return null;
  }
  for (let y = 0; y < 64; y++) {
    const t = (y + 0.5) / 64;
    // 위쪽 6%: 반사 하이라이트. 그 아래는 유리 몸통(위 밝고 아래 어두움).
    const a = t < 0.06 ? 0.1 : 0.055 * (1 - t) ** 1.4;
    b.ctx.fillStyle = `rgba(226, 236, 255, ${a})`;
    b.ctx.fillRect(0, y, 1, 1);
  }
  chipRampTex = toTexture(b.canvas);
  return chipRampTex;
}

/**
 * 재화 칩 — **유리판** + 얇은 금(청록)테 + 안쪽 어두운 홈. 나무 `ui_chip.png` 를 대체한다.
 *
 * ## 1차 판정 M9ⓒ — "유리가 없다"
 * 실측: 채움이 거의 불투명 검정. 원인은 알파가 아니라 **잉크 색**이었다 — `#0B0A16`(L≈9)을
 * 눌린 헤더(실측 L 4.7~19) 위에 얹으면 알파가 얼마든 합성 결과가 배경과 구분되지 않는다.
 * 유리로 읽히려면 ①자기 색을 가진 판이 있고 ②그 뒤가 **비쳐야** 한다. 그래서
 *  - 잉크를 {@link GLASS_PLATE}(청회색 슬레이트, L≈40)로 올려 판이 배경에서 분리되게 하고,
 *  - 알파를 {@link CHIP_GLASS_ALPHA} 로 잡아 배경이 **{@link CHIP_TRANSMIT} 만큼 비치게** 했다.
 *  - 위쪽에 **1px 반사선** + 세로 램프를 얹었다(굽는다 — 띠 겹침 금지).
 *
 * 알파를 더 낮추는 방향(투과를 늘리는 방향)으로 가지 않은 이유: 헤더 배경이 거의 검정이라
 * 투과를 늘려도 "유리"가 아니라 "구멍"이 된다. 유리는 **투과와 자기 반사가 같이** 있어야 한다.
 *
 * `tone` 은 **색상으로** 크레딧(금)과 광물(청록)을 가른다 — 아이콘이 없어도 두 칩이 구분된다.
 */
export function makeHangarChip(
  w: number,
  h: number,
  value: string,
  icon: Texture | undefined,
  tone: 'gold' | 'teal',
): Container {
  const root = new Container();
  const accent = tone === 'gold' ? GOLD : TEAL;
  const radius = Math.min(h / 2, 12);

  const plate = new Graphics();
  plate
    .roundRect(0, 0, w, h, radius)
    .fill({ color: GLASS_PLATE, alpha: CHIP_GLASS_ALPHA })
    .stroke({ color: GROOVE, width: 3, alpha: 0.6 });
  plate
    .roundRect(1.5, 1.5, w - 3, h - 3, Math.max(0, radius - 1))
    .stroke({ color: accent, width: 1.4, alpha: 0.7 });
  root.addChild(plate);

  // 유리 몸통의 세로 램프 + 상단 반사. 판 밖으로 새지 않게 둥근 사각 마스크로 자른다.
  const ramp = chipRamp();
  if (ramp !== null) {
    const host = new Container();
    const clip = new Graphics();
    clip.roundRect(2, 2, w - 4, h - 4, Math.max(0, radius - 1)).fill({ color: 0xffffff });
    host.addChild(clip);
    host.mask = clip;
    const sp = new Sprite(ramp);
    sp.position.set(2, 2);
    sp.width = w - 4;
    sp.height = h - 4;
    host.addChild(sp);
    root.addChild(host);
  }

  // 상단 1px 반사선 — 유리 모서리가 빛을 물고 있다는 신호. 램프와 달리 **선**이라 또렷하다.
  // (램프가 없는 환경에서도 이것만은 서야 하므로 별도 Graphics 다.)
  const glint = new Graphics();
  glint
    .moveTo(radius + 2, 2.5)
    .lineTo(w - radius - 2, 2.5)
    .stroke({ color: 0xe8f0ff, width: 1, alpha: 0.5 });
  // 좌우 안쪽 모서리의 **광 파이핑** — 판 두께에 빛이 갇혀 옆면이 빛나는 현상. 유리의 신호
  // 중 유일하게 **밝기 예산을 거의 안 쓰는** 것이다(길이 h·폭 1px). 칩 채움의 휘도 상한이
  // 칩 숫자 대비(4.5:1)에 묶여 있어 면을 더 밝힐 수 없으므로, 남은 유리감은 여기서 번다.
  glint
    .moveTo(2.5, radius)
    .lineTo(2.5, h - radius)
    .moveTo(w - 2.5, radius)
    .lineTo(w - 2.5, h - radius)
    .stroke({ color: 0xdce8ff, width: 1, alpha: 0.32 });
  root.addChild(glint);

  const iconSize = Math.max(8, h - 16);
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
      fontSize: Math.round(h * 0.44),
      fontWeight: '700',
      // 자간 0(숫자도 예외 없이). 색은 강조색이 아니라 한 단 낮춘 톤 — 강조색이면 테두리와
      // 같은 색이라 숫자가 테두리에 흡수되고, 순수 크림이면 칩이 제목보다 앞선다.
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

// ── 3. 버튼 바탕 텍스처(9-slice 주입) ───────────────────────────────────────

export type ChromeTone = 'stone' | 'gold' | 'red' | 'blue';

/**
 * 버튼 텍스처 굽기 치수. **1:1 로 굽는다** — 2× 로 구우면 텍스처 픽셀 폭이 256 이 되어
 * 계약이 정한 `cap = 32` 가 캡이 아니라 1/8 조각을 가리킨다(모서리가 늘어나며 뭉개진다).
 * 폭 128 = 캡 32 + 가운데 64 + 캡 32. 가운데 64px 이 가로로 늘어나는 구간이다.
 */
const BTN_W = 128;
const BTN_H = 64;
/** 모서리 반경. 캡(32) 안에 완전히 들어가야 늘어날 때 호가 일그러지지 않는다. */
const BTN_R = 11;

/**
 * 톤 한 종의 재질 명세.
 *
 * 4종은 기존 나무 버튼을 **의미 1:1 로** 대체한다: `stone`←`ui_btn_wood`(중립) ·
 * `gold`←`ui_btn_yellow`(선택/확정) · `red`←`ui_btn_red`(파괴) · `blue`←`ui_btn_blue`(구매).
 * 의미는 유지하고 붓만 바꾼다 — 색이 옮겨가면 사용자가 이미 학습한 행동이 깨진다.
 */
interface ToneSpec {
  /** 세로 그라디언트 스톱(위 → 아래). 위가 밝고 아래가 어둡다 = 광원이 위(화면 규약). */
  readonly stops: readonly (readonly [number, string])[];
  /** 안쪽 밝은 립(수광 테두리). 바깥 홈과 짝이 맞아야 판이 두꺼워 보인다. */
  readonly rim: string;
  /** 상단 안쪽 하이라이트 세기. */
  readonly hi: number;
  /** 폴백색(텍스처가 없을 때 `PixiButton.fallbackColor`). */
  readonly fallback: number;
  /** 라벨색 — 밝은 바탕 위 흰 글씨 방지. */
  readonly label: number;
}

const TONES: Record<ChromeTone, ToneSpec> = {
  /**
   * 중립 석재 — 따뜻한 회갈. 채도를 거의 뺐다: 격납고 화면에는 등급색 슬롯이 수십 개 떠
   * 있으므로 중립 버튼까지 채도를 가지면 등급 스캔이 느려진다(계약 §0-bis-3).
   * 라벨은 크림 — 이 톤만 충분히 어두워서 흰 계열이 묻히지 않는다.
   */
  stone: {
    stops: [
      [0, '#6a6153'],
      [0.4, '#544c40'],
      [0.72, '#413a30'],
      [1, '#2c2721'],
    ],
    rim: 'rgba(214, 190, 148, 0.5)',
    hi: 0.2,
    fallback: 0x4a4239,
    label: COLOR.cream,
  },
  /** 선택/확정 — `ui_btn_yellow` 자리. 밝은 금이라 **반드시 진한 갈색 라벨**이다. */
  gold: {
    stops: [
      [0, '#ffeeba'],
      [0.34, '#ffd166'],
      [0.62, '#f0ae3c'],
      [1, '#b87c1e'],
    ],
    rim: 'rgba(246, 217, 138, 0.95)',
    hi: 0.32,
    fallback: 0xe6b444,
    label: COLOR.darkLabel,
  },
  /** 파괴(분해·해제) — 붉은 사문석. 순색 적이 아니라 석재로 민 값이라 화면과 화해한다. */
  red: {
    stops: [
      [0, '#a35a48'],
      [0.4, '#83402f'],
      [0.72, '#652d20'],
      [1, '#431c14'],
    ],
    rim: 'rgba(240, 170, 140, 0.5)',
    hi: 0.22,
    fallback: 0x74362a,
    label: 0xf3ddcc,
  },
  /** 구매/확장 — 청록 사문석. 재화 칩의 `TEAL` 계열이라 "자원을 쓴다"가 색으로 이어진다. */
  blue: {
    stops: [
      [0, '#5c8a86'],
      [0.4, '#436966'],
      [0.72, '#31504f'],
      [1, '#1f3535'],
    ],
    rim: 'rgba(180, 226, 218, 0.5)',
    hi: 0.22,
    fallback: 0x3a605d,
    label: 0xdff0ec,
  },
};

/**
 * 버튼 면의 층리(strata) 결.
 *
 * 완전히 평평한 면은 유화 배경 옆에서 CSS `div` 로 읽힌다(기지 실측 std 1.42 사례). 그런데
 * 9-slice 가운데 구간은 **가로로 늘어나므로** 가로 방향 노이즈를 넣으면 늘어나며 줄무늬로
 * 번진다. 그래서 변화를 **행 단위로만** 준다 — 늘려도 번지지 않고, 결과적으로 퇴적암 층리로
 * 읽혀 석재 컨셉과도 맞는다. 진폭은 ±2 luma 수준(저주파 사인 + 미세 해시).
 */
function strataAlpha(y: number): number {
  const low = Math.sin(y * 0.21) * 0.5 + Math.sin(y * 0.061 + 1.7) * 0.5;
  return (low * 0.6 + (hash01(y) - 0.5) * 0.8) * 0.062;
}

/**
 * 방향성 베벨 3단(출처: `cinematicTile.ts` `BEVEL_LIGHT`, `cinematicPanel.ts` 가 패널에서
 * 쓰는 것과 같은 어휘를 버튼 크기로 축소했다 — 두 파일 다 소유권이 달라 import 하지 않는다).
 *
 * ## 왜 1px 테두리가 아니라 3단인가 (1차 판정 M9ⓑ)
 * 실측: 크롬은 전부 하드 에지(|HF|>6 픽셀 비율 49~52%), 슬래브 면은 **0.0%** — 중간 단계가
 * 없어 버튼이 "CSS 알약"으로 읽혔다. 등알파 1px 스트로크는 재질이 아니라 **선**이다.
 * 3단(수광 립 → **립 안쪽 어두운 홈** → 면)은 그 사이에 전이를 만든다. 홈이 핵심이다:
 * 홈이 없으면 밝은 립이 배경과 직접 붙어 다시 2px 짜리 밝은 띠가 된다(계약 §0-bis-2 가
 * 금지한 형태이고, `theme.ts` `iconContrastRingBands` 의 "밝은 링이 아니라 어두운 홈"과
 * 같은 결론이다).
 *
 * 광원 규약: **위·왼쪽이 수광, 아래·오른쪽이 그늘.** 사방 균일 밝은 스트로크는 금지 —
 * 편차 4L 짜리 균일 스트로크가 "오려 붙인 웹 카드"로 읽힌 실측이 있다.
 */
const BEVEL_LIGHT_A = 0.5;
const BEVEL_RECESS_A = 0.45;
const BEVEL_DARK_A = 0.62;

const btnCache = new Map<ChromeTone, Texture | null>();

/**
 * 시네마틱 버튼 바탕 텍스처(9-slice 용, `cap = 32`). `PixiButton` 의 `texture` 로 **주입**한다 —
 * 버튼 로직(스프링 촉각 · UI 사운드 · disabled · 라벨 자동 축소)을 다시 쓰지 않기 위해서다.
 *
 * ## 1차 판정 M9ⓑ 이후 — 알약이 아니라 **미니 슬래브**다
 * 예전 판은 1px 밝은 테두리 + 세로 그라디언트뿐이었고, 실측에서 슬래브 면의 `|HF| > 6` 비율이
 * **0.0%** 였다(크롬은 49~52%). 하드 에지와 무에지 사이에 중간 단계가 없으면 버튼이 "CSS
 * 알약"으로 읽힌다. 그래서 `cinematicPanel.ts` 가 패널에서 쓰는 어휘를 버튼 크기로 축소했다.
 *
 * 구성(뒤 → 앞): 바깥 어두운 홈 → 세로 그라디언트 면 → 상단 하이라이트 → 하단 그늘 →
 * 층리 결 → **방향성 베벨 3단**(수광 립 → 립 안쪽 어두운 홈 → 면) → 아래·오른쪽 코어 그늘.
 * 립과 코어 그늘이 **짝을 이뤄야** 판이 두꺼워 보인다(한쪽만 있으면 접시가 된다).
 *
 * ⚠️ 사방 균일한 밝은 스트로크는 쓰지 않는다 — `cinematicTile.ts` `BEVEL_LIGHT` 실측 근거.
 * 립은 좌상 → 우하 대각 램프로 지워져 **위·왼쪽만** 밝다(광원이 좌상단이라는 화면 규약).
 */
export function cinematicButtonTexture(tone: ChromeTone): Texture | undefined {
  const cached = btnCache.get(tone);
  if (cached !== undefined) return cached ?? undefined;

  const spec = TONES[tone];
  const b = bakeCanvas(BTN_W, BTN_H);
  if (b === null) {
    btnCache.set(tone, null);
    return undefined;
  }
  const { ctx } = b;

  // 바깥 어두운 홈 — 밝은 배경 위에서도 실루엣이 서게 하는 유일한 요소.
  pathRoundRect(ctx, 1.25, 1.25, BTN_W - 2.5, BTN_H - 2.5, BTN_R);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(26, 18, 10, 0.72)';
  ctx.stroke();

  // 본체 — 세로 그라디언트. Pixi Graphics 에 그라디언트가 없어서, 그리고 띠 근사가 금지라서
  // (계약 §0-4: 1px 겹침이 가로줄을 만든다) 캔버스에 픽셀로 굽는다.
  const grad = ctx.createLinearGradient(0, 0, 0, BTN_H);
  for (const [at, css] of spec.stops) grad.addColorStop(at, css);
  pathRoundRect(ctx, 2.5, 2.5, BTN_W - 5, BTN_H - 5, BTN_R - 1);
  ctx.fillStyle = grad;
  ctx.fill();

  // 이후 장식은 전부 본체 경로 안으로 자른다(밖으로 새면 모서리에 초승달이 남는다).
  ctx.save();
  pathRoundRect(ctx, 2.5, 2.5, BTN_W - 5, BTN_H - 5, BTN_R - 1);
  ctx.clip();

  // 상단 안쪽 하이라이트 — 면이 위에서 빛을 받는다는 신호.
  const hiH = BTN_H * 0.4;
  const hi = ctx.createLinearGradient(0, 2.5, 0, 2.5 + hiH);
  hi.addColorStop(0, `rgba(255, 250, 236, ${spec.hi})`);
  hi.addColorStop(1, 'rgba(255, 250, 236, 0)');
  ctx.fillStyle = hi;
  ctx.fillRect(0, 2.5, BTN_W, hiH);

  // 하단 안쪽 그늘 — 위 하이라이트의 짝.
  const lo = ctx.createLinearGradient(0, BTN_H * 0.55, 0, BTN_H);
  lo.addColorStop(0, 'rgba(24, 14, 6, 0)');
  lo.addColorStop(1, 'rgba(24, 14, 6, 0.42)');
  ctx.fillStyle = lo;
  ctx.fillRect(0, BTN_H * 0.55, BTN_W, BTN_H * 0.45);

  // 층리 결 — 행마다 아주 얕게 밝히거나 누른다(가로로 늘어나도 번지지 않는 유일한 방향).
  for (let y = 0; y < BTN_H; y++) {
    const a = strataAlpha(y);
    if (a === 0) continue;
    ctx.fillStyle = a > 0 ? `rgba(255,246,226,${a})` : `rgba(20,12,6,${-a})`;
    ctx.fillRect(0, y, BTN_W, 1);
  }
  ctx.restore();

  // ── 방향성 베벨 3단(M9ⓑ) ────────────────────────────────────────────────
  // 전부 본체 경로 안으로 자른다. 3단은 **바깥에서 안으로** 그린다:
  //   ① 수광 립(위·왼쪽만 밝다)  ② 립 안쪽 어두운 홈  ③ 면(이미 칠해져 있다)
  // 그리고 짝으로 ④ 아래·오른쪽 코어 그늘. ①만 있으면 웹 카드, ②가 있어야 재질이 된다.
  ctx.save();
  pathRoundRect(ctx, 2.5, 2.5, BTN_W - 5, BTN_H - 5, BTN_R - 1);
  ctx.clip();

  // ① 수광 립 — 링을 두른 뒤 아래쪽을 그늘 램프로 덮어 "위·왼쪽만 밝은" 상태를 만든다.
  //    (호마다 각도를 계산해 그리는 대신 이렇게 하면 모서리 전이가 자연스럽다.)
  pathRoundRect(ctx, 4, 4, BTN_W - 8, BTN_H - 8, BTN_R - 2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = spec.rim;
  ctx.globalAlpha = BEVEL_LIGHT_A;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // 립의 아래·오른쪽을 지우는 대각 램프(좌상 → 우하). 광원이 좌상단이라는 한 가지 사실에서
  // 립의 소멸 방향과 아래 ④의 위치가 **같이** 나온다.
  const kill = ctx.createLinearGradient(0, BTN_H * 0.22, BTN_W * 0.55, BTN_H);
  kill.addColorStop(0, 'rgba(20, 12, 5, 0)');
  kill.addColorStop(1, 'rgba(20, 12, 5, 0.62)');
  ctx.fillStyle = kill;
  ctx.fillRect(0, 0, BTN_W, BTN_H);

  // ② 립 **안쪽** 어두운 홈 — 이 한 겹이 밝은 립과 면을 갈라 3단을 완성한다.
  pathRoundRect(ctx, 6.5, 6.5, BTN_W - 13, BTN_H - 13, BTN_R - 4);
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(13, 8, 5, ${BEVEL_RECESS_A})`;
  ctx.stroke();

  // ④ 아래·오른쪽 코어 그늘 — 립의 짝. 없으면 판이 위로만 부풀어 접시처럼 보인다.
  pathRoundRect(ctx, 3.5, 3.5, BTN_W - 7, BTN_H - 7, BTN_R - 2);
  ctx.save();
  ctx.clip();
  const core = ctx.createLinearGradient(BTN_W * 0.35, BTN_H * 0.45, BTN_W, BTN_H);
  core.addColorStop(0, 'rgba(18, 11, 5, 0)');
  core.addColorStop(1, `rgba(18, 11, 5, ${BEVEL_DARK_A})`);
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, BTN_W, BTN_H);
  ctx.restore();
  ctx.restore();

  const tex = toTexture(b.canvas);
  btnCache.set(tone, tex);
  return tex;
}

/** 버튼 톤별 폴백색(텍스처가 없을 때 `PixiButton.fallbackColor`). */
export function chromeFallbackColor(tone: ChromeTone): number {
  return TONES[tone].fallback;
}

/**
 * 톤별 라벨색. 밝은 바탕 위 흰 글씨가 묻히는 것을 막는다 — 금 톤은 `COLOR.darkLabel`(진한
 * 갈색)이다(`button.ts` `labelColor` 주석과 같은 근거, 사용자 지적으로 이미 한 번 고친 자리).
 *
 * ⚠️ `PixiButton` 은 `labelColor` 가 **`undefined` 일 때만** 다크 섀도를 켠다. 이 함수는 항상
 * 값을 돌려주므로 섀도가 꺼진다 — 그게 의도다. 획이 촘촘한 한글은 섀도와 뭉쳐 덩어리가 된다.
 */
export function chromeLabelColor(tone: ChromeTone): number {
  return TONES[tone].label;
}

// ── 4. 슬롯 셀 바탕 텍스처 ──────────────────────────────────────────────────

/**
 * 슬롯 텍스처 굽기 한 변. `makeSlotCell` 은 62px·72px 정사각으로 **통짜로 늘린다** — 확대되면
 * 흐려지므로 그 두 배 이상으로 굽고 `linear` 로 축소되게 한다(계약 §3 경고).
 */
const SLOT_PX = 160;
/** 모서리 반경(축소 후 62px 기준 ≈ 7px — `makeSlotCell` 폴백 Graphics 의 8px 과 같은 문법). */
const SLOT_R = 18;

/**
 * 슬롯 텍스처 종 수(1차 판정 MINOR-a: 빈 셀 80칸이 전부 동일 스탬프였다).
 *
 * ⚠️ 종 사이의 차이는 **마모·이음선 위치·그레인 위상뿐**이다. 밝기도 색도 종별로 바꾸지
 * 않는다 — 그러면 파밍 시각 언어(등급색 스캔)가 셀 위치에 따라 흔들린다(계약 §0-bis-1).
 * 4종이면 8열 격자에서 같은 도장이 가로로 이웃할 확률이 낮고, 굽는 비용도 8장(하이라이트
 * 포함)으로 끝난다.
 */
export const CINEMATIC_SLOT_VARIANTS = 4;

/** 캐시 키 — `highlight` 와 `variant` 를 한 문자열로 묶는다. */
const slotCache = new Map<string, Texture | null>();

/**
 * 슬롯 셀 바탕 — **파인 소켓**. `makeSlotCell` 의 `slotTex`/`highlightTex` 로 주입한다.
 *
 * ## 왜 밝은 링이 아니라 어두운 홈인가
 * `theme.ts` `iconContrastRingBands` 의 실측 결론을 그대로 지킨다: 장비 아이콘의 불투명 평균
 * 휘도가 넓게 퍼져 있어 **어떤 단일 밝은 링도** 중간 톤 아이콘을 새로 묻히게 만든다. 반대로
 * 모든 아이콘이 어두운 바탕보다 밝다는 성질 덕에, 가장자리에 접하는 어두운 홈 하나가 전부의
 * 경계 대비를 올린다. 그래서 이 텍스처의 프레임은 **전부 어둡다**.
 *
 * ## 왜 그것이 등급색과도 안전한가
 * 등급 테두리는 `pad = size × 0.1` 자리에 앉는다(160px 기준 16px). 예전 `ui_slot_hl.png` 는
 * 그 띠가 **금색**이라 레어(#FFEE7A)가 프레임에 흡수됐고, `SLOT_RARE_GROOVE` 홈이 그 뒤처리로
 * 들어간 것이다. 여기 프레임에는 금색이 없으므로 그 충돌이 원리적으로 재발하지 않는다.
 *
 * ## 조명 부호
 * **파인 면은 위가 그늘, 아래가 수광이다**(볼록한 버튼과 반대). 그래서 소켓 안쪽 위에 AO 를
 * 깔고 아래 입술만 아주 옅게 밝힌다. 이 부호가 뒤집히면 슬롯이 '구멍'이 아니라 '단추'가 된다.
 *
 * `highlight = true`(장착 슬롯)는 **면적이 아니라 온도로** 갈린다: 바닥에 아주 옅은 금빛
 * 램프광이 고여 소켓이 "불이 들어온 자리"로 읽힌다. 테두리를 밝히지 않으므로 위 규율과
 * 충돌하지 않고, 등급 테두리와도 경쟁하지 않는다.
 */
export function cinematicSlotTexture(highlight: boolean, variant = 0): Texture | undefined {
  // 종 인덱스는 **감싼다**(리드가 셀 인덱스를 그대로 넘겨도 되게). 음수도 안전하게 접는다.
  const v = ((Math.trunc(variant) % CINEMATIC_SLOT_VARIANTS) + CINEMATIC_SLOT_VARIANTS) %
    CINEMATIC_SLOT_VARIANTS;
  const key = `${highlight ? 'h' : 'n'}${v}`;
  const cached = slotCache.get(key);
  if (cached !== undefined) return cached ?? undefined;

  const b = bakeCanvas(SLOT_PX, SLOT_PX);
  if (b === null) {
    slotCache.set(key, null);
    return undefined;
  }
  const { ctx } = b;
  const S = SLOT_PX;
  /** 종별 그레인 위상 시드. 밝기가 아니라 **위상**만 바꾼다. */
  const seed = 1 + v * 7919;

  // 바깥 프레임 홈(어두움) — 밝은 석재 패널 위에서도 소켓 경계가 선다.
  pathRoundRect(ctx, 2, 2, S - 4, S - 4, SLOT_R);
  ctx.fillStyle = '#1b1610';
  ctx.fill();

  // 소켓 바닥. 파인 면이라 **위가 어둡고 아래가 밝다**.
  const floor = ctx.createLinearGradient(0, 10, 0, S - 10);
  if (highlight) {
    floor.addColorStop(0, '#241c12');
    floor.addColorStop(0.55, '#332616');
    floor.addColorStop(1, '#453320');
  } else {
    floor.addColorStop(0, '#1d1a15');
    floor.addColorStop(0.55, '#272219');
    floor.addColorStop(1, '#332c21');
  }
  pathRoundRect(ctx, 9, 9, S - 18, S - 18, SLOT_R - 5);
  ctx.fillStyle = floor;
  ctx.fill();

  ctx.save();
  pathRoundRect(ctx, 9, 9, S - 18, S - 18, SLOT_R - 5);
  ctx.clip();

  // 안쪽 AO — 위 벽에서 드리우는 그늘. 파인 느낌의 대부분이 여기서 나온다.
  const ao = ctx.createLinearGradient(0, 9, 0, 9 + S * 0.34);
  ao.addColorStop(0, 'rgba(8, 5, 2, 0.62)');
  ao.addColorStop(1, 'rgba(8, 5, 2, 0)');
  ctx.fillStyle = ao;
  ctx.fillRect(0, 9, S, S * 0.34);

  // 장착 슬롯의 램프광 — 바닥에 고인 따뜻한 빛. 테두리가 아니라 **바닥**을 밝히는 것이 요점.
  if (highlight) {
    const lamp = ctx.createRadialGradient(S / 2, S * 0.74, 0, S / 2, S * 0.74, S * 0.52);
    lamp.addColorStop(0, 'rgba(255, 196, 96, 0.2)');
    lamp.addColorStop(1, 'rgba(255, 196, 96, 0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, S, S);
  }

  // 석재 그레인(±3L). 슬롯은 9-slice 가 아니라 통짜 스케일이라 2D 노이즈를 그대로 써도
  // 방향으로 번지지 않는다. 값은 결정적 해시.
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const d = Math.round((hash01(i * seed) - 0.5) * 7);
    img.data[i * 4] = Math.max(0, Math.min(255, (img.data[i * 4] ?? 0) + d));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, (img.data[i * 4 + 1] ?? 0) + d));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, (img.data[i * 4 + 2] ?? 0) + d));
  }
  ctx.putImageData(img, 0, 0);

  // 종별 마모 — 석재 이음선 한 줄 + 모서리 결손 하나. **위치만** 종마다 다르고 밝기 예산은
  // 같다(전부 어두운 획이라 평균 휘도가 종별로 갈리지 않는다).
  const t0 = hash01(seed * 3);
  const t1 = hash01(seed * 11);
  ctx.strokeStyle = 'rgba(12, 8, 4, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (v % 2 === 0) {
    const y = 26 + t0 * (S - 60);
    ctx.moveTo(14, y);
    ctx.lineTo(S - 14, y + (t1 - 0.5) * 6);
  } else {
    const x = 26 + t0 * (S - 60);
    ctx.moveTo(x, 14);
    ctx.lineTo(x + (t1 - 0.5) * 6, S - 14);
  }
  ctx.stroke();
  const cx = v < 2 ? 18 : S - 18;
  const cy = v % 3 === 0 ? 18 : S - 18;
  ctx.fillStyle = 'rgba(10, 6, 3, 0.3)';
  ctx.beginPath();
  ctx.arc(cx, cy, 5 + t1 * 3, 0, Math.PI * 2);
  ctx.fill();

  // 아래 입술만 수광 — 파인 면의 조명 부호를 완성한다(위 그늘 ↔ 아래 빛).
  const lip = ctx.createLinearGradient(0, S - 9 - S * 0.12, 0, S - 9);
  lip.addColorStop(0, 'rgba(214, 176, 116, 0)');
  lip.addColorStop(1, `rgba(214, 176, 116, ${highlight ? 0.22 : 0.13})`);
  ctx.fillStyle = lip;
  ctx.fillRect(0, S - 9 - S * 0.12, S, S * 0.12);
  ctx.restore();

  // 소켓 입구의 접촉 홈 — 바닥과 프레임 사이를 끊는 한 줄. 밝은 링이 아니라 **어두운 홈**이다.
  pathRoundRect(ctx, 9, 9, S - 18, S - 18, SLOT_R - 5);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(10, 6, 3, 0.8)';
  ctx.stroke();

  const tex = toTexture(b.canvas);
  slotCache.set(key, tex);
  return tex;
}

// ── 5. 슬롯 접지 그림자 ─────────────────────────────────────────────────────

let contactTex: Texture | null | undefined;
/**
 * 셀 아래 접지 그림자 텍스처(2단: 좁고 짙은 접촉 + 넓고 옅은 확산). 128² 로 굽고 늘려 쓴다.
 */
function slotContactBake(): Texture | null {
  if (contactTex !== undefined) return contactTex;
  const size = 128;
  const b = bakeCanvas(size, size);
  if (b === null) {
    contactTex = null;
    return null;
  }
  const { ctx } = b;
  // 확산층 — 넓고 옅다. 물체가 공간 안에 있다는 신호.
  const wide = ctx.createRadialGradient(size / 2, size * 0.56, 0, size / 2, size * 0.56, size / 2);
  wide.addColorStop(0, 'rgba(10, 6, 3, 0.42)');
  wide.addColorStop(0.55, 'rgba(10, 6, 3, 0.18)');
  wide.addColorStop(1, 'rgba(10, 6, 3, 0)');
  ctx.fillStyle = wide;
  ctx.fillRect(0, 0, size, size);
  // 접촉층 — 좁고 짙다. 이게 없으면 테두리 바로 밑 0~3px 에 near-black 이 없어 눈이 그것을
  // 접지가 아니라 앰비언트 얼룩으로 읽는다(`cinematicPanel.ts` CONTACT/DIFFUSE 와 같은 근거).
  const tight = ctx.createRadialGradient(size / 2, size * 0.5, 0, size / 2, size * 0.5, size * 0.3);
  tight.addColorStop(0, 'rgba(6, 4, 2, 0.6)');
  tight.addColorStop(1, 'rgba(6, 4, 2, 0)');
  ctx.fillStyle = tight;
  ctx.fillRect(0, 0, size, size);
  contactTex = toTexture(b.canvas);
  return contactTex;
}

/**
 * 슬롯 셀 **아래에 까는** 접지 그림자(1차 판정 MINOR-b: 쇼케이스 창의 장착 셀이 유리 위에
 * 붙은 스티커로 읽혔다). 리드가 셀과 **같은 좌표**에 놓으면 된다 — 컨테이너 원점이 셀 좌상단
 * (0,0)에 맞춰져 있고 그림자는 스스로 셀 밖으로 번진다.
 *
 * ## 왜 텍스처 안에 굽지 않았는가
 * `makeSlotCell` 은 슬롯 텍스처를 `size` **정사각으로** 늘려 쓴다 — 셀 사각 밖으로 못 나간다.
 * 접지 그림자는 물체 **바깥**에 생기는 것이라 사각 안에 가두면 그림자가 아니라 테두리가 된다.
 * 게다가 텍스처 하단을 어둡게 하면 비평이 "물리적으로 맞다"고 유지를 지시한 셀 내부 세로
 * 프로파일(20 → 55 단조 상승 = 움푹한 우물)이 깨진다. 그래서 **별도 레이어**다.
 *
 * 등급색은 건드리지 않는다 — 이 그림자는 무채색 웜 다크 하나뿐이다(계약 §0-bis-1).
 */
export function makeSlotContactShadow(size: number): Container {
  const root = new Container();
  root.eventMode = 'none'; // 셀의 hover/클릭 판정을 가로채면 안 된다.
  const tex = slotContactBake();
  if (tex === null) return root;
  const sp = new Sprite(tex);
  // 좌우로 22%, 아래로 30% 번진다. 위쪽은 거의 번지지 않는다 — 광원이 위라 그림자는 아래로.
  const spread = size * 0.22;
  sp.width = size + spread * 2;
  sp.height = size + spread * 2;
  sp.position.set(-spread, -spread * 0.35 + size * 0.06);
  root.addChild(sp);
  return root;
}
