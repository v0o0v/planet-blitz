/**
 * 아이템 슬롯 셀 + 그리드 레이아웃 (격납고 파일럿, plan §3 · 결정 4/9).
 *
 * 슬롯 셀 = `ui_slot.png`(통짜 스케일) 바탕 + 등급색 내부 글로우 + 등급색 rounded 테두리 4px
 * + 장비 아이콘(`assets/equip_*.png`). 아이콘 텍스처가 없으면 기존 텍스트 글리프로 폴백하며,
 * 이때도 글리프를 등급색으로 칠해 등급 신호를 잃지 않는다.
 *
 * 등급 신호가 **테두리 + 글로우** 두 겹인 이유: 컬러 아이콘이 들어오면 예전에 등급을 말하던
 * 글리프 색이 사라진다. 신호를 한 겹으로 줄이면 인벤토리 등급 스캔이 느려진다(결정 9 시각 언어).
 *
 * 그리드 위치 계산은 순수 함수(`gridPositions`)로 분리해 UI 없이 검증 가능(handoff:
 * 신규 단위 테스트는 UI-독립 레이아웃 헬퍼에만).
 */

import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { Rarity, SlotKind } from '../../items/types.js';
import { equipIconName } from '../equipIcons.js';
import { SLOT_RARITY_COLOR_NUM, SLOT_RARE_GROOVE, UI_FONT, TEXT_SHADOW } from './theme.js';
import type { UiTextures } from './uiTextures.js';

/**
 * 셀이 실제로 읽는 최소 아이템 모양(등급 + 슬롯 + 아이콘 축 속성). 인벤토리/정제소가 넘기는
 * `Item` 은 물론, 정산 화면의 **표시 전용 드랍 요약**(`ResultDrop` — 어픽스도 id 도 없다)도
 * 그대로 얹힌다. 셀이 필요로 하지 않는 필드까지 요구하면 소비 측이 가짜 `Item` 을 지어내게 된다.
 */
export interface SlotCellItem {
  readonly rarity: Rarity;
  readonly slot: SlotKind;
  /** 주/보조무기 종류 코드 — 아이콘을 무기별로 가른다(없으면 0 취급). */
  readonly weaponType?: number | undefined;
  /** 유니크 전용 아트 키. 있으면 슬롯 아이콘 대신 쓴다. */
  readonly uniqueId?: string | undefined;
}

/** slot 종류 → 인벤토리와 동일한 글리프(아이콘 텍스처가 없을 때의 폴백). */
export function itemGlyph(slot: SlotKind): string {
  return slot === 'main' ? '✷' : slot === 'sub' ? '❋' : '◈';
}

/**
 * 로더 맵에서 이 아이템의 장비 아이콘을 꺼낸다. 미등록/미로드면 null → 셀이 글리프로 폴백.
 * 소비 화면(격납고·정제소·정산)이 매 셀마다 이 한 줄만 부르면 되도록 여기 둔다.
 */
export function equipIconTexture(
  ui: UiTextures,
  item: SlotCellItem | undefined,
): Texture | null {
  if (item === undefined) return null;
  const name = equipIconName(item);
  return name === null ? null : (ui[name] ?? null);
}

/**
 * 등급 → 내부 글로우 최대 알파. 색(hue)만으로는 노말 회색이 약해 등급이 덜 갈리므로 세기도
 * 같이 올린다. 유니크는 0 — 전용 아트 자체가 신호라 글로우를 겹치지 않는다(테두리는 유지).
 */
const RARITY_GLOW_ALPHA: Record<Rarity, number> = {
  normal: 0.3,
  magic: 0.52,
  rare: 0.72,
  unique: 0,
};

/** 글로우 띠 개수(안쪽으로 갈수록 옅어진다). */
const GLOW_BANDS = 4;

/** 글로우 띠 한 겹의 두께. 시작 위치를 역산해야 하는 호출부와 값을 공유한다. */
function glowBand(size: number): number {
  return Math.max(2, Math.round(size * 0.055));
}

/**
 * 레어 전용 홈 두께(px). 0 이면 홈 없음 = 다른 등급은 기존 그대로.
 *
 * 레어만 특별 취급하는 이유는 레어만 실제로 충돌하기 때문이다: 장착 슬롯이 쓰는
 * `ui_slot_hl.png` 의 프레임이 금색이고(0~11% 폭), 등급 테두리도 `pad = size*0.1` 자리라
 * 둘이 같은 띠를 점유한다. 게다가 글로우의 첫(가장 진한) 띠는 `alignment: 0`(= Pixi v8 에서
 * **바깥**)이라 `pad` 바깥, 즉 프레임 위로 번진다. 금색 프레임 + 금색 글로우 + 금색 테두리가
 * 연속된 한 덩어리가 되는 구조였다. 홈만큼 안으로 들여 앉히면 셋이 갈린다.
 */
function rareGroove(size: number, rarity: Rarity): number {
  return rarity === 'rare' ? Math.max(2, Math.round(size * 0.04)) : 0;
}

/** 등급색 내부 글로우(테두리 안쪽에서 안으로 번지는 띠). 유니크/무등급이면 null. */
function makeRarityGlow(size: number, pad: number, rarity: Rarity): Graphics | null {
  const peak = RARITY_GLOW_ALPHA[rarity];
  if (peak <= 0) return null;
  const color = SLOT_RARITY_COLOR_NUM[rarity];
  const band = glowBand(size);
  const g = new Graphics();
  for (let i = 0; i < GLOW_BANDS; i++) {
    const inset = pad + i * band;
    const side = size - inset * 2;
    if (side <= band * 2) break;
    g.roundRect(inset, inset, side, side, 7).stroke({
      color,
      width: band,
      alpha: peak * (1 - i / GLOW_BANDS) ** 1.3,
      alignment: 0,
    });
  }
  return g;
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
  /** 장비 아이콘 텍스처({@link equipIconTexture}). null 이면 텍스트 글리프로 폴백한다. */
  iconTex?: Texture | null | undefined;
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
    const color = SLOT_RARITY_COLOR_NUM[opts.item.rarity];
    const pad = Math.round(size * 0.1);
    // 레어는 홈 두께만큼 안으로 들어간다(0 = 나머지 등급은 좌표가 예전 그대로).
    const groove = rareGroove(size, opts.item.rarity);
    const bPad = pad + groove;

    // 등급 신호 ①: 안쪽 글로우(아이콘이 글리프 색을 대체해도 등급이 남는다).
    // 레어는 테두리 안쪽 끝(bPad+4)에서 첫 띠가 시작하도록 역산한다 — 그래야 프레임을 안 덮는다.
    const glowPad = groove > 0 ? bPad + 4 + glowBand(size) : pad;
    const glow = makeRarityGlow(size, glowPad, opts.item.rarity);
    if (glow !== null) root.addChild(glow);

    // 등급 신호 ②: 테두리(컬러 아이콘 옆에서도 읽히도록 3px → 4px).
    const border = new Graphics();
    if (groove > 0) {
      // 프레임 ↔ 테두리 사이의 얇은 어두운 홈. 금색끼리 맞붙는 것을 구조적으로 끊는다.
      border
        .roundRect(pad, pad, size - pad * 2, size - pad * 2, 7)
        .stroke({ color: SLOT_RARE_GROOVE, width: groove, alpha: 0.85, alignment: 1 });
      border
        .roundRect(bPad, bPad, size - bPad * 2, size - bPad * 2, 6)
        .stroke({ color, width: 4, alignment: 1 });
    } else {
      border
        .roundRect(pad, pad, size - pad * 2, size - pad * 2, 7)
        .stroke({ color, width: 4, alignment: 1 });
    }
    root.addChild(border);

    if (opts.iconTex) {
      const icon = new Sprite(opts.iconTex);
      const iconSize = Math.round(size * 0.64);
      icon.width = iconSize;
      icon.height = iconSize;
      icon.anchor.set(0.5);
      icon.position.set(size / 2, size / 2);
      root.addChild(icon);
    } else {
      // 폴백: 아이콘 PNG 가 아직 없거나 로드 실패. 글리프도 등급색으로 칠해 신호를 유지한다.
      const glyph = new Text({
        resolution: 2,
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
    }

    root.eventMode = 'static';
    root.cursor = opts.onClick !== undefined ? 'pointer' : 'default';
    if (opts.onClick !== undefined) root.on('pointertap', opts.onClick);
    root.on('pointerover', (e) => opts.onHover?.(e.global.x, e.global.y));
    root.on('pointermove', (e) => opts.onMove?.(e.global.x, e.global.y));
    root.on('pointerout', () => opts.onOut?.());
  }

  return root;
}
