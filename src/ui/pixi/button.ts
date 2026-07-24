/**
 * 카툰 hstretch 버튼 (격납고 파일럿, plan §3 · 결정 4).
 *
 * `ui_btn_*.png`(무지 버튼) 을 좌우 캡 30px 로 가로만 늘리고, 텍스트는 코드로 렌더한다.
 * 텍스처가 없으면 둥근 사각 Graphics 로 폴백. hover/press/disabled 시각 상태를 준다.
 * 좌표계는 디자인 스페이스. 위치는 호출자가 `.container.position.set()` 로 잡는다.
 */

import { Container, Graphics, NineSliceSprite, Text, type Texture } from 'pixi.js';
import { UI_FONT, TEXT_SHADOW } from './theme.js';
import { playUi, type UiSoundCategory } from '../../render/uiSound.js';

export interface ButtonOptions {
  texture?: Texture | null | undefined;
  width: number;
  height: number;
  label: string;
  onClick: () => void;
  /** 폴백 Graphics 색(텍스처 없을 때). */
  fallbackColor?: number;
  fontSize?: number;
  /** 캡(좌우 9-slice 폭). 기본 30. */
  cap?: number;
  /**
   * 탭 시 낼 UI 음 의미 범주(AC16 — UI 버스). 기본 `uiNavigate`(탭·이동). 확정/긍정/부정
   * 버튼은 `uiConfirm`/`uiPositive`/`uiNegative` 를 넘겨 팔레트를 재사용한다.
   */
  sound?: UiSoundCategory;
  /**
   * 라벨 색. 기본은 흰색 — 빨강/파랑처럼 어두운 버튼 기준이다. 노란 버튼(ui_btn_yellow)
   * 처럼 밝은 바탕에는 흰 글씨가 묻히므로 진한 갈색 등을 넘겨 대비를 확보한다.
   */
  labelColor?: number;
}

export class PixiButton {
  readonly container = new Container();
  private readonly labelText: Text;
  private readonly onClick: () => void;
  /** 탭 시 낼 UI 음 범주(AC16). 기본 navigate. */
  private readonly sound: UiSoundCategory;
  private enabled = true;

  constructor(opts: ButtonOptions) {
    const { width: w, height: h, cap = 30 } = opts;
    this.onClick = opts.onClick;
    this.sound = opts.sound ?? 'uiNavigate';

    if (opts.texture) {
      const bg = new NineSliceSprite({
        texture: opts.texture,
        leftWidth: cap,
        topHeight: 0,
        rightWidth: cap,
        bottomHeight: 0,
      });
      bg.width = w;
      bg.height = h;
      this.container.addChild(bg);
    } else {
      const g = new Graphics();
      g.roundRect(0, 0, w, h, 10)
        .fill({ color: opts.fallbackColor ?? 0x3a4a6a })
        .stroke({ color: 0x000000, width: 2, alpha: 0.5 });
      this.container.addChild(g);
    }

    this.labelText = new Text({ resolution: 2,
      text: opts.label,
      style: {
        fontFamily: UI_FONT,
        fontSize: opts.fontSize ?? 22,
        fontWeight: '700',
        fill: opts.labelColor ?? 0xffffff,
        align: 'center',
        // 어두운 라벨(밝은 버튼)에는 다크 섀도를 끈다 — 획이 촘촘한 한글(예: "출")이
        // 그림자와 뭉쳐 덩어리로 보인다. 흰 라벨(어두운 버튼)에서만 섀도가 필요하다.
        dropShadow: opts.labelColor === undefined ? TEXT_SHADOW : false,
      },
    });
    this.labelText.anchor.set(0.5);
    this.labelText.position.set(w / 2, h / 2);
    this.container.addChild(this.labelText);

    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.on('pointertap', () => {
      if (!this.enabled) return;
      playUi(this.sound); // AC16: UI 버스 피드백음(음소거·미주입이면 no-op).
      this.onClick();
    });
    this.container.on('pointerover', () => {
      if (this.enabled) this.container.alpha = 0.85;
    });
    this.container.on('pointerout', () => {
      if (this.enabled) this.container.alpha = 1;
    });
  }

  setLabel(text: string): void {
    this.labelText.text = text;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.container.alpha = enabled ? 1 : 0.4;
    this.container.cursor = enabled ? 'pointer' : 'default';
    this.container.eventMode = enabled ? 'static' : 'none';
  }
}
