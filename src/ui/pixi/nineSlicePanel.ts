/**
 * 9-slice 나무 패널 (격납고 파일럿, plan §3 · 결정 4).
 *
 * `ui_panel.png`(중앙 투명) 을 Pixi `NineSliceSprite` 로 임의 크기까지 늘려 프레임을
 * 만들고, 그 안쪽에 어두운 내부(#1c182e 계열)를 코드로 깐다 — 목업 사양대로. 텍스처가
 * 없으면(로드 실패) 둥근 사각 Graphics 프레임으로 폴백한다. 좌표계는 1920×1080 디자인
 * 스페이스(부모 stage 가 레터박스 스케일).
 */

import { Container, Graphics, NineSliceSprite, type Texture } from 'pixi.js';
import { COLOR } from './theme.js';

export interface PanelOptions {
  /** 프레임 텍스처(없으면 Graphics 폴백). */
  texture?: Texture | null | undefined;
  /** 9-slice 사방 테두리(px). ui_panel 기준 46. */
  border?: number;
  /** 내부 어두운 채움 색. */
  fillColor?: number;
  /** 내부 채움 알파(0~1). 목업 alpha 245 ≈ 0.96. */
  fillAlpha?: number;
  /**
   * 프레임 안쪽으로 내부 채움을 얼마나 들일지(px). 기본은 `border - 2` — ui_panel.png 의
   * 투명 중앙 구멍이 border(46px) 지점에서 시작하므로, 채움을 그보다 살짝(2px) 안쪽부터
   * 시작해 프레임 안쪽 전체를 여유 있게 덮는다(리뷰 결함 #1: 프레임 침범 없이 중앙을
   * 완전히 채우는지 확인). 채움은 프레임보다 먼저 그려져 프레임(불투명 나무 테두리)이 그
   * 위를 덮으므로, inset 이 border 보다 작아 채움이 테두리 밑까지 번져도 시각적으로는
   * 프레임에 가려져 보이지 않는다(안전 마진).
   */
  fillInset?: number;
}

/**
 * 어두운 내부 + 나무 프레임 패널을 만든다. 반환 Container 는 (0,0) 기준 w×h 를 차지한다.
 * 위치는 호출자가 `.position.set(x,y)` 로 잡는다.
 */
export function nineSlicePanel(w: number, h: number, opts: PanelOptions = {}): Container {
  const border = opts.border ?? 46;
  const fillColor = opts.fillColor ?? COLOR.panelFill;
  const fillAlpha = opts.fillAlpha ?? 0.96;
  const inset = opts.fillInset ?? Math.max(0, border - 2);

  const root = new Container();

  // 내부 어두운 채움(프레임 아래 깔린다 — 프레임의 투명 중앙 전체를 덮도록 inset ≤ border).
  const fill = new Graphics();
  fill
    .roundRect(inset, inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2), 10)
    .fill({ color: fillColor, alpha: fillAlpha });
  root.addChild(fill);

  // 나무 프레임.
  if (opts.texture) {
    const frame = new NineSliceSprite({
      texture: opts.texture,
      leftWidth: border,
      topHeight: border,
      rightWidth: border,
      bottomHeight: border,
    });
    frame.width = w;
    frame.height = h;
    root.addChild(frame);
  } else {
    const g = new Graphics();
    g.roundRect(0, 0, w, h, 14)
      .stroke({ color: 0x6b4a2a, width: 6, alignment: 1 })
      .roundRect(3, 3, w - 6, h - 6, 12)
      .stroke({ color: 0x3a2a1a, width: 2, alignment: 1 });
    root.addChild(g);
  }

  return root;
}
