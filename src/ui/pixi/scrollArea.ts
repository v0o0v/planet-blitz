/**
 * 마스크 스크롤 영역 공용 부품 (M7b-command-ui — 공용 승격 #1).
 *
 * 카드 화면(`src/ui/pixi/cardsView.ts:460`)이 private 로 갖고 있던 조립을 공용으로 올렸다.
 *
 * ## 여기 박아 둔 실측 교훈 두 가지
 * ① **휠은 마스크가 아니라 클립 Container 가 받는다.** 마스크로 쓰이는 Graphics 는 Pixi 히트
 *    테스트에서 제외(`isMask`)돼 리스너가 영영 안 불린다. 클립 Container 에 `hitArea` 를 주면
 *    행 사이 빈 자리에서도 잡히고, 행 위에서는 행 → 클립으로 버블링돼 함께 성립한다.
 * ② **마스크 높이는 행 경계로 클램프한다.** 안 그러면 마지막 행이 반토막 나 잘린 글자가 보인다
 *    ({@link clampToRows}).
 * ③ **스크롤 가능하다는 단서가 없으면 목록이 거기서 끝난 줄 안다.** 마스크가 행 경계로 잘리면
 *    마지막 행이 온전히 보이기 때문에 "잘렸다"는 시각 신호가 아예 사라진다(실측: 코어 모듈
 *    보관함). 그래서 {@link thumbGeometry} 로 얇은 위치 표시를 그린다 — 다만 **opt-in**
 *    (`thumb: true`)이다. 기존 호출부(사령부·연구소·챔피언)는 옵션을 안 주므로 겉모습이 한 픽셀도
 *    바뀌지 않는다.
 *
 * 기하 계산({@link clampScroll}·{@link rowBounds}·{@link clampToRows}·{@link thumbGeometry})은
 * Pixi 없이 도는 순수 함수로 분리했다 — 테스트가 캔버스 없이 이 규칙을 직접 검증한다.
 */

import { Container, Graphics, Rectangle } from 'pixi.js';
import { COLOR } from './theme.js';

/** 스크롤 위치를 [0, max] 로 접는다(내용이 창보다 작으면 항상 0). */
export function clampScroll(value: number, totalH: number, viewH: number): number {
  const max = Math.max(0, totalH - viewH);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, max);
}

/**
 * 행 높이 목록 → 누적 경계 목록(행 i 까지 쌓았을 때의 전체 높이). 마지막 원소가 전체 높이다.
 * 행 사이 간격은 행과 행 **사이에만** 들어간다(첫 행 위에는 없다).
 */
export function rowBounds(heights: readonly number[], gap: number): number[] {
  const out: number[] = [];
  let total = 0;
  heights.forEach((h, i) => {
    total += h + (i > 0 ? gap : 0);
    out.push(total);
  });
  return out;
}

/**
 * 가용 높이 안에 **온전히** 들어가는 가장 큰 행 경계를 고른다(반토막 행 금지).
 * 한 행도 안 들어가면 가용 높이를 그대로 쓴다 — 아무것도 안 보이는 것보다는 낫다.
 */
export function clampToRows(avail: number, bounds: readonly number[]): number {
  let best = 0;
  for (const b of bounds) {
    if (b <= avail && b > best) best = b;
  }
  return best > 0 ? best : Math.max(0, avail);
}

/** 스크롤 위치 표시(thumb) 폭. */
export const SCROLL_THUMB_W = 6;
/** thumb 최소 높이 — 내용이 아주 길어도 점처럼 사라지지 않게 한다. */
export const SCROLL_THUMB_MIN_H = 24;
/** thumb 이 창 오른쪽 끝에서 떨어지는 거리. */
export const SCROLL_THUMB_PAD = 2;

/** 창 안에서 thumb 이 차지하는 세로 구간(창 상단 기준 y·높이). */
export interface ScrollThumb {
  y: number;
  h: number;
}

/**
 * thumb 기하(순수). 스크롤할 게 없으면 `null` — **표시할 수 없을 때는 그리지 않는다**가 계약이다
 * (항상 떠 있는 막대는 "여기서 끝"인지 "더 있다"인지를 구분해 주지 못한다).
 *
 * 높이는 보이는 비율(viewH/totalH)에 비례하되 {@link SCROLL_THUMB_MIN_H} 아래로는 안 내려가고,
 * y 는 스크롤 진행률(0…1)을 남은 이동 폭에 비례 배분한 값이다(끝까지 내리면 창 바닥에 딱 붙는다).
 */
export function thumbGeometry(viewH: number, totalH: number, scroll: number): ScrollThumb | null {
  if (!(totalH > viewH) || viewH <= 0) return null;
  const raw = (viewH * viewH) / totalH;
  const h = Math.min(viewH, Math.max(SCROLL_THUMB_MIN_H, raw));
  const travel = viewH - h;
  const maxScroll = totalH - viewH;
  const pos = clampScroll(scroll, totalH, viewH);
  const y = maxScroll > 0 ? (travel * pos) / maxScroll : 0;
  return { y, h };
}

export interface ScrollAreaOptions {
  /** 클립 창의 부모 로컬 좌표·크기. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 내용 전체 높이(행 경계 마지막 값). */
  totalH: number;
  /** 현재 스크롤 위치를 읽는다(재렌더 사이 유지되는 외부 상태). */
  get(): number;
  /** 클램프된 스크롤 위치를 되돌려 준다. */
  set(v: number): void;
  /**
   * 스크롤 위치 표시(thumb)를 그린다. **기본 false** — 기존 호출부의 겉모습을 바꾸지 않기 위한
   * opt-in 이다(모듈 주석 ③).
   */
  thumb?: boolean;
}

/**
 * 마스크 스크롤 영역을 만들어 부모에 붙이고, 내용을 담을 Container 를 돌려준다.
 * 반환 Container 의 좌표계는 창 좌상단 기준이며 스크롤은 `y` 이동으로 표현된다.
 */
export function makeScrollArea(parent: Container, opts: ScrollAreaOptions): Container {
  const { x, y, w, h, totalH } = opts;

  const clip = new Container();
  clip.position.set(x, y);
  parent.addChild(clip);

  const mask = new Graphics();
  mask.rect(x, y, w, h).fill({ color: 0xffffff });
  parent.addChild(mask);
  clip.mask = mask;

  const content = new Container();
  clip.addChild(content);

  const v = clampScroll(opts.get(), totalH, h);
  opts.set(v);
  content.y = -v;

  if (totalH > h) {
    // 위치 표시는 마스크보다 **뒤에** 붙여 창 위에 그려지게 한다(클립 안에 넣으면 내용과 함께
    // 스크롤돼 버린다 — 위치를 알려 주는 물건이 같이 움직이면 의미가 없다).
    const thumbG = opts.thumb === true ? new Graphics() : null;
    if (thumbG !== null) parent.addChild(thumbG);

    const drawThumb = (): void => {
      if (thumbG === null) return;
      thumbG.clear();
      const g = thumbGeometry(h, totalH, opts.get());
      if (g === null) return;
      const tx = x + w - SCROLL_THUMB_W - SCROLL_THUMB_PAD;
      const r = SCROLL_THUMB_W / 2;
      // 트랙(창 전체) → 손잡이. 트랙이 있어야 "이만큼 중 여기"라는 비율이 읽힌다.
      thumbG
        .roundRect(tx, y, SCROLL_THUMB_W, h, r)
        .fill({ color: 0x000000, alpha: 0.28 })
        .roundRect(tx, y + g.y, SCROLL_THUMB_W, g.h, r)
        .fill({ color: COLOR.gold, alpha: 0.85 });
    };
    drawThumb();

    // 휠은 **클립 Container** 가 받는다(모듈 주석 ① 참고 — 마스크는 히트 테스트 제외).
    clip.eventMode = 'static';
    clip.hitArea = new Rectangle(0, 0, w, h);
    clip.on('wheel', (e) => {
      const next = clampScroll(opts.get() + e.deltaY, totalH, h);
      opts.set(next);
      content.y = -next;
      drawThumb();
    });
  }
  return content;
}
