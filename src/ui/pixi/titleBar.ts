/**
 * 타이틀바 · 재화 칩 · 아이콘 버튼 (격납고 파일럿, plan §3 · 결정 6).
 *
 * - 배너: `ui_banner.png`(좌우 캡 40px hstretch) + 중앙 제목 텍스트.
 * - 재화 칩: `ui_chip.png`(좌우 캡 24px) + 아이콘 **왼쪽 고정(x+14)** + 값은 남은 자리
 *   가로·세로 중앙 정렬(handoff 사양).
 * - 아이콘 버튼: 통짜 아이콘 스프라이트 + 포인터 이벤트(닫기 X 등).
 * 좌표는 디자인 스페이스. 위치는 호출자가 잡는다.
 */

import { Container, Graphics, NineSliceSprite, Sprite, Text, type Texture } from 'pixi.js';
import { UI_FONT, TEXT_SHADOW, COLOR } from './theme.js';

/**
 * 배너 + 중앙 제목.
 *
 * @param titleColor 제목 색. 기본 크림(0xffe9c0) — 화면 제목은 전부 이 색이다. 정산처럼
 *   **배너 자체가 결과를 말해야 하는** 화면만 승리 골드/패배 살구색을 넘겨 대비를 준다.
 */
export function makeBanner(
  w: number,
  h: number,
  title: string,
  texture?: Texture | null,
  titleColor = 0xffe9c0,
): Container {
  const root = new Container();
  if (texture) {
    const bg = new NineSliceSprite({
      texture,
      leftWidth: 40,
      topHeight: 0,
      rightWidth: 40,
      bottomHeight: 0,
    });
    bg.width = w;
    bg.height = h;
    root.addChild(bg);
  } else {
    const g = new Graphics();
    g.roundRect(0, 0, w, h, 10).fill({ color: 0x8a2e2e }).stroke({ color: 0x000000, width: 2, alpha: 0.5 });
    root.addChild(g);
  }
  const t = new Text({ resolution: 2,
    text: title,
    style: {
      fontFamily: UI_FONT,
      fontSize: 32,
      fontWeight: '800',
      fill: titleColor,
      dropShadow: TEXT_SHADOW,
    },
  });
  t.anchor.set(0.5);
  t.position.set(w / 2, h / 2);
  root.addChild(t);
  return root;
}

/**
 * 재화 칩. 아이콘은 왼쪽 x+14 고정, 값 텍스트는 아이콘 오른쪽~칩 끝 사이 남은 폭의
 * 가로·세로 중앙에 정렬한다.
 */
export function makeCurrencyChip(
  w: number,
  h: number,
  value: string,
  chipTex?: Texture | null,
  iconTex?: Texture | null,
): Container {
  const root = new Container();
  if (chipTex) {
    const bg = new NineSliceSprite({
      texture: chipTex,
      leftWidth: 24,
      topHeight: 0,
      rightWidth: 24,
      bottomHeight: 0,
    });
    bg.width = w;
    bg.height = h;
    root.addChild(bg);
  } else {
    const g = new Graphics();
    g.roundRect(0, 0, w, h, h / 2).fill({ color: 0x2a2440 }).stroke({ color: 0x000000, width: 2, alpha: 0.5 });
    root.addChild(g);
  }

  const iconSize = h - 16;
  const iconX = 14;
  if (iconTex) {
    const icon = new Sprite(iconTex);
    icon.width = iconSize;
    icon.height = iconSize;
    icon.position.set(iconX, (h - iconSize) / 2);
    root.addChild(icon);
  }

  const t = new Text({ resolution: 2,
    text: value,
    style: {
      fontFamily: UI_FONT,
      fontSize: 24,
      fontWeight: '700',
      fill: COLOR.gold,
      dropShadow: TEXT_SHADOW,
    },
  });
  t.anchor.set(0.5);
  // 남은 자리: [아이콘 오른쪽, 칩 오른쪽 안쪽 여백]
  const restLeft = iconX + iconSize + 8;
  const restRight = w - 14;
  t.position.set((restLeft + restRight) / 2, h / 2);
  root.addChild(t);
  return root;
}

/** 통짜 아이콘 버튼(닫기 X 등). size×size, 포인터 이벤트. */
export function makeIconButton(
  size: number,
  onClick: () => void,
  iconTex?: Texture | null,
  fallbackGlyph = '✕',
): Container {
  const root = new Container();
  if (iconTex) {
    const sp = new Sprite(iconTex);
    sp.width = size;
    sp.height = size;
    root.addChild(sp);
  } else {
    const g = new Graphics();
    g.roundRect(0, 0, size, size, 8).fill({ color: 0x3a2a2a }).stroke({ color: 0x000000, width: 2, alpha: 0.5 });
    root.addChild(g);
    const t = new Text({ resolution: 2,
      text: fallbackGlyph,
      style: { fontFamily: UI_FONT, fontSize: Math.round(size * 0.5), fontWeight: '800', fill: 0xffffff },
    });
    t.anchor.set(0.5);
    t.position.set(size / 2, size / 2);
    root.addChild(t);
  }
  root.eventMode = 'static';
  root.cursor = 'pointer';
  root.on('pointertap', onClick);
  root.on('pointerover', () => (root.alpha = 0.8));
  root.on('pointerout', () => (root.alpha = 1));
  return root;
}
