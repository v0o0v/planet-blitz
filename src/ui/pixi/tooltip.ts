/**
 * 카툰 툴팁 패널 (격납고 파일럿, plan §3 · 결정 8).
 *
 * 어두운 바탕(#181428 80%+) + 등급색 3px 프레임 + 바깥 다크 아웃라인(나무 텍스처 금지 —
 * 사용자 피드백). 내용은 구조화된 데이터로 주입받아(제목·부제·줄 목록·비교) 어느 화면에서도
 * 재사용 가능하다. 좌표는 디자인 스페이스(부모가 hangar root). 화면 경계 클램프 포함.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { UI_FONT, TEXT_SHADOW } from './theme.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';

export interface TooltipContent {
  title: string;
  titleColor: number;
  subtitle: string;
  lines: string[];
  /** 장착 장비 비교 줄(없으면 생략). */
  compare?: string | undefined;
}

const PAD = 14;
const MAX_W = 320;

export class PixiTooltip {
  readonly container = new Container();

  constructor() {
    this.container.visible = false;
    this.container.eventMode = 'none';
  }

  /** designX/Y = 디자인 스페이스 좌표(포인터 위치). frameColor = 등급색. */
  show(content: TooltipContent, designX: number, designY: number, frameColor: number): void {
    this.container.removeChildren();

    const bg = new Graphics();
    this.container.addChild(bg);

    let y = PAD;
    const makeLine = (text: string, size: number, color: number, weight: '400' | '700' | '800'): number => {
      const t = new Text({
        text,
        style: {
          fontFamily: UI_FONT,
          fontSize: size,
          fontWeight: weight,
          fill: color,
          wordWrap: true,
          wordWrapWidth: MAX_W - PAD * 2,
          dropShadow: TEXT_SHADOW,
        },
      });
      t.position.set(PAD, y);
      this.container.addChild(t);
      y += t.height + 4;
      return t.width;
    };

    let maxW = 0;
    maxW = Math.max(maxW, makeLine(content.title, 20, content.titleColor, '800'));
    maxW = Math.max(maxW, makeLine(content.subtitle, 14, 0x8896b8, '400'));
    for (const line of content.lines) {
      maxW = Math.max(maxW, makeLine(line, 15, 0xc9d3ea, '400'));
    }
    if (content.compare !== undefined) {
      y += 4;
      maxW = Math.max(maxW, makeLine(content.compare, 14, 0x8896b8, '400'));
    }

    const w = Math.min(MAX_W, maxW + PAD * 2);
    const h = y + PAD;

    // 바깥 다크 아웃라인 → 어두운 바탕 → 등급색 프레임.
    bg.roundRect(-2, -2, w + 4, h + 4, 12).fill({ color: 0x000000, alpha: 0.6 });
    bg.roundRect(0, 0, w, h, 10).fill({ color: 0x181428, alpha: 0.92 });
    bg.roundRect(0, 0, w, h, 10).stroke({ color: frameColor, width: 3, alignment: 0 });

    // 포인터 오른쪽·아래에 두되 화면 밖으로 나가면 반대편으로.
    let px = designX + PAD;
    let py = designY + PAD;
    if (px + w > DESIGN_WIDTH) px = designX - w - PAD;
    if (py + h > DESIGN_HEIGHT) py = designY - h - PAD;
    this.container.position.set(Math.max(0, px), Math.max(0, py));
    this.container.visible = true;
  }

  hide(): void {
    this.container.visible = false;
  }
}
