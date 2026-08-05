/**
 * 기지 헤더 **연속 접속** 칩(AC-20) 레이아웃 잠금.
 *
 * ## 이 테스트가 막는 것
 *
 * ① **헤더 겹침.** 칩이 셋이 되면 `CHIP_MARGIN` 과 중앙 정렬 제목이 가로를 다툰다. 이 리포는
 *    헤더 겹침이 **테스트 초록으로 통과한 전례가 여러 건**이라(격납고 헤더 = 겹치면 안 되는
 *    세로 띠 4줄) 눈대중을 금지하고 쌍마다 부등식으로 잠근다. KO·EN 양쪽 실측으로 돈다 —
 *    한글이 더 길 수도, 라틴이 더 길 수도 있다.
 *
 * ② **"칩 넣을 자리 만들려고" 카드를 줄이는 것.** ADR-0048 이 새 건물을 기각한 근거가
 *    `TILE_W`·행 배치·세로 예산이라, 그 셋이 움직이면 기각의 전제가 무너진다. 값을 그대로
 *    박아 두고 대조한다.
 *
 * ## ⚠️ 캔버스 스텁이 폭을 제대로 재는가 — 이 테스트의 급소
 *
 * 이 리포의 기존 캔버스 스텁(`pixiScreenPersistence.test.ts` 등)은 `measureText` 가
 * **`text.length * 8`** 을 돌려준다. 글자 크기를 보지 않으므로 84px 제목 `기지`가 16px 로
 * 측정되고, 그 값으로 겹침을 재면 **아무것도 안 보는 초록**이 된다. 그래서 여기서는
 * `ctx.font` 의 px 를 파싱해 글자 크기에 비례하는 폭을 돌려주는 스텁을 쓰고, 스텁 자체가
 * 살아 있는지를 {@link describe} `스텁 자기검사` 로 먼저 확인한다 — 그 블록이 빨개지면
 * 아래 겹침 단언은 전부 무의미하다.
 *
 * 모델은 **상한 근사**다(전각 1.0em · 그 외 0.62em). 겹침·넘침 판정은 폭의 상한으로만
 * 안전하다 — 하한을 쓰면 테스트는 통과하고 화면은 겹친다(기지 화면 지표 운용 정본:
 * *"대리 지표는 하한으로만 안전"* 의 부호를 뒤집은 경우다. 여기서 지키려는 것은 "겹치지
 * 않는다"이므로 폭은 크게 잡아야 보수적이다).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DOMAdapter, Text } from 'pixi.js';
import {
  CHIP_GAP,
  CHIP_H,
  CHIP_MARGIN,
  CHIP_W,
  CHIP_Y,
  HEADER_CLEARANCE,
  META_Y,
  STREAK_CHIP_W,
  STREAK_CHIP_X,
  TILE_W,
  estimateChipTextWidth,
  headerSpans,
  maxTitleWidth,
  rowSplit,
  streakChipValue,
  tilePosition,
  veilRects,
  type HeaderSpan,
} from '../src/ui/pixi/baseMap.js';
import { screenTitleBaseStyle } from '../src/ui/pixi/cinematicChrome.js';
import { DESIGN_WIDTH } from '../src/render/app.js';
import { DAILY_STREAK_CYCLE } from '../data/dailyReward.js';
import { setLocale, getLocale, t, type Locale } from '../src/i18n/index.js';

// ---------------------------------------------------------------------------
// 글자 크기를 보는 캔버스 스텁
// ---------------------------------------------------------------------------

/** 전각 폭 1em 으로 나아가는 글자(한글·한자·가나·전각 기호). */
const FULL_WIDTH_RE =
  /[ᄀ-ᇿ⺀-꓏ꥠ-꥿가-퟿豈-﫿︰-﹏＀-｠￠-￦]/u;

/** 상한 근사 — 전각 1.0em, 그 외 0.62em. 과소평가하지 않는 것이 유일한 요구다. */
function modelWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += FULL_WIDTH_RE.test(ch) ? size : size * 0.62;
  return w;
}

interface GlobalStubs {
  document?: unknown;
}
const g = globalThis as unknown as GlobalStubs;
let hadDocument = false;
let prevDocument: unknown;

function installCanvasStub(): void {
  const makeContext = (): unknown => {
    // `font` 는 Pixi 가 `"700 84px Malgun Gothic, ..."` 형태로 써 넣는다. 거기서 px 를 캐낸다.
    let font = '10px sans-serif';
    return {
      get font(): string {
        return font;
      },
      set font(v: string) {
        font = v;
      },
      fillStyle: '',
      strokeStyle: '',
      textBaseline: 'alphabetic',
      letterSpacing: '0px',
      measureText: (text: string) => {
        const m = /(\d+(?:\.\d+)?)px/.exec(font);
        const size = m === null ? 10 : Number(m[1]);
        const width = modelWidth(text, size);
        return {
          width,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: width,
          actualBoundingBoxAscent: size * 0.8,
          actualBoundingBoxDescent: size * 0.2,
          fontBoundingBoxAscent: size * 0.8,
          fontBoundingBoxDescent: size * 0.2,
        };
      },
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      fillRect: () => {},
      clearRect: () => {},
      fillText: () => {},
      strokeText: () => {},
      save: () => {},
      restore: () => {},
      scale: () => {},
      translate: () => {},
      setTransform: () => {},
      drawImage: () => {},
    };
  };
  const makeCanvas = (width = 1, height = 1): unknown => {
    const ctx = makeContext();
    return { width, height, style: {}, getContext: () => ctx };
  };
  const base = DOMAdapter.get() as unknown as Record<string, unknown>;
  DOMAdapter.set({
    ...base,
    createCanvas: (w?: number, h?: number) => makeCanvas(w, h),
    // Pixi 는 letterSpacing 지원 여부를 이 클래스의 prototype 으로 판별한다 — node 에는 없다.
    getCanvasRenderingContext2D: () => class {},
    getWebGLRenderingContext: () => class {},
  } as never);
  hadDocument = 'document' in g;
  prevDocument = g.document;
  g.document = { createElement: () => makeCanvas(), fonts: { check: () => true } };
}

let origLocale: Locale;

beforeAll(() => {
  installCanvasStub();
  origLocale = getLocale();
});

afterAll(() => {
  setLocale(origLocale);
  if (hadDocument) g.document = prevDocument;
  else delete g.document;
});

/** 제목 텍스트의 실측 폭. 화면과 **같은 스타일**로 세워 잰다(상수 베끼기 금지). */
function measuredTitleWidth(text: string): number {
  const node = new Text({ resolution: 2, text, style: screenTitleBaseStyle() });
  return node.width;
}

// ---------------------------------------------------------------------------
// 0. 스텁 자기검사 — 여기가 빨가면 아래는 전부 무의미하다
// ---------------------------------------------------------------------------

describe('스텁 자기검사 — 폭을 실제로 재는가', () => {
  it('폭이 0 이 아니다', () => {
    expect(measuredTitleWidth('기지')).toBeGreaterThan(0);
  });

  it('글자 크기에 비례한다(길이만 세는 스텁이면 여기서 걸린다)', () => {
    const style = screenTitleBaseStyle();
    const big = new Text({ text: '기지', style: { ...style, fontSize: 84 } }).width;
    const small = new Text({ text: '기지', style: { ...style, fontSize: 20 } }).width;
    // 자간이 크기와 무관하게 더해질 수 있어 정확한 비례는 요구하지 않는다 — "크기를 본다"만 본다.
    expect(big / small).toBeGreaterThan(3);
  });

  it('글자 수에 비례한다', () => {
    const style = screenTitleBaseStyle();
    const one = new Text({ text: '기', style }).width;
    const four = new Text({ text: '기기기기', style }).width;
    expect(four).toBeGreaterThan(one * 3);
  });

  it('한글 두 글자 제목이 84px 급으로 측정된다(실화면 근사)', () => {
    // `기지` = 2 전각 × 84px + 자간 ⇒ 168~200 언저리. 16px(길이×8 스텁)이면 여기서 걸린다.
    expect(measuredTitleWidth('기지')).toBeGreaterThan(150);
  });
});

// ---------------------------------------------------------------------------
// 1. 겹침 — 칩 3개 + 제목의 가로 구간
// ---------------------------------------------------------------------------

/** 두 구간이 겹치는가(반개구간 [x0, x1)). */
function overlaps(a: HeaderSpan, b: HeaderSpan): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1;
}

/** 두 구간 사이의 빈 폭(겹치면 음수). */
function gapBetween(a: HeaderSpan, b: HeaderSpan): number {
  return a.x0 <= b.x0 ? b.x0 - a.x1 : a.x0 - b.x1;
}

const LOCALES: readonly Locale[] = ['ko', 'en'];

describe('헤더 가로 구간 — 칩 3개 + 제목이 서로 겹치지 않는다', () => {
  for (const locale of LOCALES) {
    describe(`로케일 ${locale}`, () => {
      it('쌍마다 전부 겹치지 않는다(칩 셋을 세운 상태)', () => {
        setLocale(locale);
        const spans = headerSpans(measuredTitleWidth(t('base.title')), true);
        expect(spans).toHaveLength(4);
        // 쌍을 하나도 빠뜨리지 않도록 전수 나열한다 — 6쌍이 전부 여기서 검사된다.
        const pairs: string[] = [];
        for (let a = 0; a < spans.length; a++) {
          for (let b = a + 1; b < spans.length; b++) {
            const sa = spans[a]!;
            const sb = spans[b]!;
            pairs.push(`${sa.key}↔${sb.key}`);
            expect(overlaps(sa, sb), `${sa.key}↔${sb.key} 겹침`).toBe(false);
          }
        }
        expect(pairs).toEqual([
          'credits↔title',
          'credits↔minerals',
          'credits↔streak',
          'title↔minerals',
          'title↔streak',
          'minerals↔streak',
        ]);
      });

      it('제목과 이웃 칩 사이에 최소 여백이 남는다(붙어 있는 것도 결함이다)', () => {
        setLocale(locale);
        const spans = headerSpans(measuredTitleWidth(t('base.title')), true);
        const title = spans.find((s) => s.key === 'title')!;
        for (const chip of spans.filter((s) => s.key !== 'title')) {
          expect(gapBetween(title, chip), `title↔${chip.key} 여백`).toBeGreaterThanOrEqual(
            HEADER_CLEARANCE,
          );
        }
      });

      it('칩끼리도 최소 간격을 지킨다', () => {
        setLocale(locale);
        const spans = headerSpans(measuredTitleWidth(t('base.title')), true);
        const chips = spans.filter((s) => s.key !== 'title');
        for (let a = 0; a < chips.length; a++) {
          for (let b = a + 1; b < chips.length; b++) {
            expect(gapBetween(chips[a]!, chips[b]!)).toBeGreaterThanOrEqual(CHIP_GAP);
          }
        }
      });

      it('제목 실측 폭이 헤더가 감당할 수 있는 상한 안이다', () => {
        setLocale(locale);
        expect(measuredTitleWidth(t('base.title'))).toBeLessThanOrEqual(maxTitleWidth(true));
      });

      it('칩을 숨겨도(콜백 미배선) 나머지가 안 겹친다', () => {
        setLocale(locale);
        const spans = headerSpans(measuredTitleWidth(t('base.title')), false);
        expect(spans.map((s) => s.key)).toEqual(['credits', 'title', 'minerals']);
        for (let a = 0; a < spans.length; a++) {
          for (let b = a + 1; b < spans.length; b++) {
            expect(overlaps(spans[a]!, spans[b]!)).toBe(false);
          }
        }
      });
    });
  }

  it('제목이 길어지면 계약이 깨진다 — 이 테스트가 살아 있다는 증거', () => {
    // 상한을 넘는 제목을 억지로 넣으면 제목↔칩이 실제로 겹쳐야 한다. 안 겹친다면 위 단언들이
    // 아무것도 안 보고 있다는 뜻이다(항진 테스트 방어).
    const spans = headerSpans(maxTitleWidth(true) + HEADER_CLEARANCE * 2 + 10, true);
    const title = spans.find((s) => s.key === 'title')!;
    const streak = spans.find((s) => s.key === 'streak')!;
    expect(overlaps(title, streak)).toBe(true);
  });
});

/** 칩 줄이 화면 위쪽 밴드를 벗어나지 않는지 보는 상한(제목 블록 아래 상인방이 y≈149 에 있다). */
const CHIP_BAND_BOTTOM = 149;

describe('헤더 구간이 화면 밖으로 나가지 않는다', () => {
  it('칩 3개가 [0, DESIGN_WIDTH] 안에 완전히 들어간다', () => {
    for (const streakShown of [true, false]) {
      for (const span of headerSpans(200, streakShown)) {
        if (span.key === 'title') continue;
        expect(span.x0).toBeGreaterThanOrEqual(0);
        expect(span.x1).toBeLessThanOrEqual(DESIGN_WIDTH);
      }
    }
  });

  it('세로도 화면 안이다(칩 줄은 한 줄이므로 y 는 상수)', () => {
    expect(CHIP_Y).toBeGreaterThanOrEqual(0);
    expect(CHIP_Y + CHIP_H).toBeLessThanOrEqual(CHIP_BAND_BOTTOM);
  });
});

describe('좌표가 정수다 — 반픽셀 부유가 테두리 번쩍임을 만든 전례가 있다', () => {
  it('칩 상수와 파생 좌표가 전부 정수', () => {
    for (const v of [CHIP_MARGIN, CHIP_W, CHIP_H, CHIP_Y, CHIP_GAP, STREAK_CHIP_W, STREAK_CHIP_X]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('칩 구간의 양 끝이 정수(제목은 실측 폭이라 제외)', () => {
    for (const span of headerSpans(200, true)) {
      if (span.key === 'title') continue;
      expect(Number.isInteger(span.x0), `${span.key}.x0`).toBe(true);
      expect(Number.isInteger(span.x1), `${span.key}.x1`).toBe(true);
    }
  });

  it('연속 접속 칩이 크레딧 칩 바로 오른쪽이다', () => {
    expect(STREAK_CHIP_X).toBe(CHIP_MARGIN + CHIP_W + CHIP_GAP);
  });
});

// ---------------------------------------------------------------------------
// 2. 격자 불변 — "칩 넣을 자리 만들려고" 카드를 줄이는 것을 잡는다
// ---------------------------------------------------------------------------

describe('타일 격자·세로 예산은 칩 추가로 한 픽셀도 움직이지 않는다', () => {
  it('TILE_W 가 424 그대로다(356 으로 줄이면 일러스트 밴드 잘림이 재발한다)', () => {
    expect(TILE_W).toBe(424);
  });

  it('칸 8개가 4+4 로 갈린다(9칸이면 [5,4] 가 되어 1행이 2256px — 화면을 336 넘긴다)', () => {
    expect(rowSplit(8)).toEqual([4, 4]);
    expect(rowSplit(9)).toEqual([5, 4]);
    // 9칸 1행 폭 — 기각 근거를 산식으로 남긴다.
    expect(5 * TILE_W + 4 * 34).toBe(2256);
    expect(4 * TILE_W + 3 * 34).toBe(1798);
  });

  it('8칸 좌상단 좌표가 그대로다', () => {
    expect(Array.from({ length: 8 }, (_, i) => tilePosition(i))).toEqual([
      { x: 61, y: 226 },
      { x: 519, y: 226 },
      { x: 977, y: 226 },
      { x: 1435, y: 226 },
      { x: 61, y: 622 },
      { x: 519, y: 622 },
      { x: 977, y: 622 },
      { x: 1435, y: 622 },
    ]);
  });

  it('세로 예산이 그대로다 — 2행 바닥 974, 메타 줄 1036', () => {
    const rects = veilRects();
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x0: 61, y0: 226, x1: 1859, y1: 578 });
    expect(rects[1]).toEqual({ x0: 61, y0: 622, x1: 1859, y1: 974 });
    // 2행 바닥(974) + 접지 그림자 48 ≈ 1022 < META_Y. 여기가 무너지면 메타 줄이 얼룩 위에 앉는다.
    expect(META_Y).toBe(1036);
    expect(rects[1]!.y1 + 48).toBeLessThan(META_Y);
  });
});

// ---------------------------------------------------------------------------
// 3. 문구 — 길어져도 칩 폭을 넘지 않는다
// ---------------------------------------------------------------------------

/** `streakChipValue` 가 지키는 예산 — 칩 내부 텍스트 가용폭 192px 을 `fitWidth` 하한 0.6 으로 나눈 값. */
const TEXT_BUDGET = Math.floor(((STREAK_CHIP_W - 12 - (CHIP_H - 18) - 8 - 12) / 0.6) * 0.94);

describe('streakChipValue — 문구가 길어지면 축약한다', () => {
  it('문구 미주입이면 숫자형 `n/주기`', () => {
    expect(streakChipValue(undefined, 7, DAILY_STREAK_CYCLE)).toBe('7/30');
    expect(streakChipValue('', 30, DAILY_STREAK_CYCLE)).toBe('30/30');
  });

  it('연속일 0(오프라인·미확정)은 `-` 다 — `0/30` 은 "끊겼다"는 틀린 사실을 단언한다', () => {
    expect(streakChipValue(undefined, 0, DAILY_STREAK_CYCLE)).toBe('-/30');
    expect(streakChipValue('연속 접속 0/30', 0, DAILY_STREAK_CYCLE)).toBe('연속 접속 0/30');
  });

  it('예산 안의 KO·EN 문구는 그대로 통과한다', () => {
    expect(streakChipValue('연속 접속 7/30', 7, 30)).toBe('연속 접속 7/30');
    expect(streakChipValue('Daily 7/30', 7, 30)).toBe('Daily 7/30');
  });

  it('긴 KO 문구는 숫자형으로 축약된다', () => {
    const long = '연속 접속 이십칠일째 기록 중 27/30';
    expect(estimateChipTextWidth(long)).toBeGreaterThan(TEXT_BUDGET);
    expect(streakChipValue(long, 27, 30)).toBe('27/30');
  });

  it('무엇을 넣어도 결과 문구는 예산 안이다(전수 표본)', () => {
    const samples = [
      undefined,
      '',
      '연속 접속 7/30',
      'Daily 7/30',
      'Consecutive daily login streak day 7 of 30',
      '연속 접속 일수가 아주 많이 길어진 경우의 문구 30/30',
      '연',
      '30/30',
    ];
    for (const s of samples) {
      const out = streakChipValue(s, 30, 30);
      expect(estimateChipTextWidth(out), `문구=${String(s)}`).toBeLessThanOrEqual(TEXT_BUDGET);
    }
  });

  it('상한 근사는 전각을 라틴보다 넓게 센다(부호가 뒤집히면 축약이 늦게 걸린다)', () => {
    expect(estimateChipTextWidth('가나다')).toBeGreaterThan(estimateChipTextWidth('abc'));
    expect(estimateChipTextWidth('')).toBe(0);
  });
});
