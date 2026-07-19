/**
 * 카드형 패널 부품 (카툰나무풍 롤아웃 #4 — 행성 선택에서 일반화, 기지 맵 #1 과 공유).
 *
 * "나무 패널 한 장 + 안쪽 콘텐츠 + 선택/잠금 상태 + hover 로 살짝 뜨는 클릭 타일"은 기지 맵
 * 건물 타일과 행성 선택 카드가 공유하는 골격이다. 화면마다 재유도하면 hover 오프셋·선택 링
 * 두께 같은 값이 조용히 갈리므로 여기로 올린다(공용 부품 경계: 소비자가 둘 이상일 때 승격).
 *
 * 콘텐츠는 호출자가 반환 Container 에 직접 얹는다 — 잠금 막을 아이콘 **위**, 이름 **아래**에
 * 끼우는 식으로 z 순서를 화면이 제어해야 해서 콘텐츠를 인자로 받지 않는다.
 */

import { Container, Graphics, type Texture } from 'pixi.js';
import { COLOR } from './theme.js';
import { nineSlicePanel, PANEL_BORDER } from './nineSlicePanel.js';

export interface PanelCardOptions {
  width: number;
  height: number;
  /** 나무 프레임 텍스처(없으면 nineSlicePanel 이 Graphics 로 폴백). */
  texture?: Texture | null | undefined;
  /** 선택 상태 — 프레임 안쪽에 금색 링을 두른다. */
  selected?: boolean | undefined;
  /** 클릭 콜백(없으면 정적 카드 — 포인터 이벤트를 달지 않는다). */
  onClick?: (() => void) | undefined;
  /** hover 시 위로 띄우는 px(DOM 판 translateY(-4px)). 0 이면 끈다. */
  lift?: number | undefined;
}

/**
 * 카드 한 장을 만든다. 반환 Container 는 (0,0) 기준 width×height 를 차지하고, 위치는
 * 호출자가 `.position.set(x, y)` 로 잡는다. 콘텐츠 좌표는 `panelContent(width, height)`
 * 상자 안으로 — 프레임 침범도, 테두리에 붙는 것도 그 상자가 막는다.
 */
export function makePanelCard(opts: PanelCardOptions): Container {
  const { width: w, height: h } = opts;
  const root = new Container();
  root.addChild(nineSlicePanel(w, h, { texture: opts.texture, border: PANEL_BORDER }));

  if (opts.selected === true) {
    // 선택 링은 나무 프레임 **안쪽**에 둔다(어두운 내부 위 금색 — 프레임과 겹치지 않는다).
    const inset = PANEL_BORDER - 8;
    const ring = new Graphics();
    ring
      .roundRect(inset, inset, w - inset * 2, h - inset * 2, 12)
      .fill({ color: COLOR.gold, alpha: 0.07 })
      .stroke({ color: COLOR.gold, width: 4, alignment: 1 });
    root.addChild(ring);
  }

  const onClick = opts.onClick;
  if (onClick !== undefined) {
    const lift = opts.lift ?? 4;
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', onClick);
    // hover 기준 y 는 진입 시점에 잡는다 — 카드 위치를 호출자가 나중에 정해도 안전하다.
    let baseY: number | null = null;
    root.on('pointerover', () => {
      if (lift !== 0) {
        baseY ??= root.y;
        root.y = baseY - lift;
      }
      root.alpha = 0.92;
    });
    root.on('pointerout', () => {
      if (baseY !== null) {
        root.y = baseY;
        baseY = null;
      }
      root.alpha = 1;
    });
  }

  return root;
}

/**
 * 카드 안쪽 전체를 덮는 잠금 딤. 콘텐츠가 아니라 오버레이라 콘텐츠 상자(border+pad)가 아닌
 * **프레임 기준(PANEL_BORDER)** 으로 깐다 — 세트 정본 SKILL.md §4 가 허용한 유일한 예외다.
 * z 순서를 호출자가 잡을 수 있도록 Graphics 만 돌려준다.
 */
export function panelDim(width: number, height: number, alpha = 0.62): Graphics {
  const g = new Graphics();
  g.roundRect(
    PANEL_BORDER,
    PANEL_BORDER,
    width - PANEL_BORDER * 2,
    height - PANEL_BORDER * 2,
    8,
  ).fill({ color: 0x0b0814, alpha });
  return g;
}
