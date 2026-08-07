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
  /**
   * 원소가 순수 문자열이면 기본색(`0xc9d3ea`), `{ text, color }` 면 그 색을 쓴다(사용자 요청
   * 2026-08-07 — 격납고 스킬 축 어픽스가 투자 0인 축을 회색으로 보여줘야 한다,
   * `src/ui/affixText.ts` 의 `affixLinesForHangar`). 기존 호출부는 전부 `string[]` 을 넘기므로
   * 이 확장은 그쪽에 영향이 없다(배열 공변으로 그대로 대입된다).
   */
  lines: readonly (string | { text: string; color?: number })[];
  /** 요구 레벨 줄(부제 다음). 미달이면 빨강, 충족이면 무채색(ADR-0030 AC9). 없으면 생략. */
  reqLine?: { text: string; color: number } | undefined;
  /** 장착 장비 비교 줄(없으면 생략). */
  compare?: string | undefined;
  /**
   * 장착 장비 스탯 증감 블록(사용자 요청 2026-07-27). 줄마다 색이 다르므로(증가 초록·감소 빨강)
   * `lines`(단색)와 달리 색을 함께 받는다. 빈 배열/미지정이면 구분선까지 통째로 생략한다.
   */
  compareLines?: readonly { text: string; color: number }[] | undefined;
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
      const t = new Text({ resolution: 2,
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
    if (content.reqLine !== undefined) {
      maxW = Math.max(maxW, makeLine(content.reqLine.text, 14, content.reqLine.color, '700'));
    }
    for (const line of content.lines) {
      const text = typeof line === 'string' ? line : line.text;
      const color = typeof line === 'string' ? 0xc9d3ea : (line.color ?? 0xc9d3ea);
      maxW = Math.max(maxW, makeLine(text, 15, color, '400'));
    }
    if (content.compare !== undefined) {
      y += 4;
      maxW = Math.max(maxW, makeLine(content.compare, 14, 0x8896b8, '400'));
    }
    // 장착 비교 블록 — 어픽스 목록과 시각적으로 떼기 위해 위에 여백을 준다.
    if (content.compareLines !== undefined && content.compareLines.length > 0) {
      y += 6;
      for (const line of content.compareLines) {
        maxW = Math.max(maxW, makeLine(line.text, 14, line.color, '700'));
      }
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
