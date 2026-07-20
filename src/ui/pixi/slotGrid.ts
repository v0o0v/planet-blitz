/**
 * 아이템 슬롯 셀 + 그리드 레이아웃 (격납고 파일럿, plan §3 · 결정 4/9).
 *
 * 슬롯 셀 = `ui_slot.png`(통짜 스케일) 바탕 + 아이템 글리프 + 등급색 rounded 테두리 3px.
 * 그리드 위치 계산은 순수 함수(`gridPositions`)로 분리해 UI 없이 검증 가능(handoff:
 * 신규 단위 테스트는 UI-독립 레이아웃 헬퍼에만).
 */

import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { Rarity, SlotKind } from '../../items/types.js';
import { RARITY_COLOR_NUM, UI_FONT, TEXT_SHADOW } from './theme.js';

/**
 * 셀이 실제로 읽는 최소 아이템 모양(등급 + 슬롯). 인벤토리/정제소가 넘기는 `Item` 은 물론,
 * 정산 화면의 **표시 전용 드랍 요약**(`ResultDrop` — 어픽스도 id 도 없다)도 그대로 얹힌다.
 * 셀이 필요로 하지 않는 필드까지 요구하면 소비 측이 가짜 `Item` 을 지어내게 된다.
 */
export interface SlotCellItem {
  readonly rarity: Rarity;
  readonly slot: SlotKind;
}

/** slot 종류 → 인벤토리와 동일한 글리프(파밍 시각 언어 보존). */
export function itemGlyph(slot: SlotKind): string {
  return slot === 'main' ? '✷' : slot === 'sub' ? '❋' : '◈';
}

/**
 * n 칸을 cols 열 그리드로 배치했을 때 각 칸의 좌상단 좌표(순수 — 테스트 대상).
 * 셀이 정사각이 아니고 가로·세로 간격이 다를 수 있는 일반형이다(연구소 노드 119×95 등).
 */
export function rectGridPositions(
  n: number,
  cols: number,
  cellW: number,
  cellH: number,
  gapX: number,
  gapY: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({ x: col * (cellW + gapX), y: row * (cellH + gapY) });
  }
  return out;
}

/**
 * n 칸을 cols 열 정사각 그리드로 배치했을 때 각 칸의 좌상단 좌표(순수 — 테스트 대상).
 * cell = 셀 한 변, gap = 칸 간격. {@link rectGridPositions} 의 정사각 특수형.
 */
export function gridPositions(
  n: number,
  cols: number,
  cell: number,
  gap: number,
): { x: number; y: number }[] {
  return rectGridPositions(n, cols, cell, cell, gap, gap);
}

export interface SlotCellOptions {
  size: number;
  item?: SlotCellItem | undefined;
  slotTex?: Texture | null | undefined;
  highlight?: boolean | undefined;
  highlightTex?: Texture | null | undefined;
  onClick?: (() => void) | undefined;
  onHover?: ((globalX: number, globalY: number) => void) | undefined;
  onMove?: ((globalX: number, globalY: number) => void) | undefined;
  onOut?: (() => void) | undefined;
}

/**
 * 한 슬롯 셀 Container 를 만든다. (0,0) 기준 size×size. 아이템이 있으면 등급색 테두리 +
 * 글리프를 얹고 포인터 이벤트를 배선한다(hover 툴팁·클릭 장착/해제).
 */
export function makeSlotCell(opts: SlotCellOptions): Container {
  const { size } = opts;
  const root = new Container();

  const baseTex = opts.highlight ? (opts.highlightTex ?? opts.slotTex) : opts.slotTex;
  if (baseTex) {
    const sp = new Sprite(baseTex);
    sp.width = size;
    sp.height = size;
    root.addChild(sp);
  } else {
    const g = new Graphics();
    g.roundRect(0, 0, size, size, 8)
      .fill({ color: 0x141a2c, alpha: 0.85 })
      .stroke({ color: opts.highlight ? 0x33405f : 0x2a3552, width: 2 });
    root.addChild(g);
  }

  if (opts.item !== undefined) {
    const color = RARITY_COLOR_NUM[opts.item.rarity];
    const border = new Graphics();
    const pad = Math.round(size * 0.1);
    border
      .roundRect(pad, pad, size - pad * 2, size - pad * 2, 7)
      .stroke({ color, width: 3, alignment: 1 });
    root.addChild(border);

    const glyph = new Text({ resolution: 2,
      text: itemGlyph(opts.item.slot),
      style: {
        fontFamily: UI_FONT,
        fontSize: Math.round(size * 0.42),
        fill: color,
        dropShadow: TEXT_SHADOW,
      },
    });
    glyph.anchor.set(0.5);
    glyph.position.set(size / 2, size / 2);
    root.addChild(glyph);

    root.eventMode = 'static';
    root.cursor = opts.onClick !== undefined ? 'pointer' : 'default';
    if (opts.onClick !== undefined) root.on('pointertap', opts.onClick);
    root.on('pointerover', (e) => opts.onHover?.(e.global.x, e.global.y));
    root.on('pointermove', (e) => opts.onMove?.(e.global.x, e.global.y));
    root.on('pointerout', () => opts.onOut?.());
  }

  return root;
}
