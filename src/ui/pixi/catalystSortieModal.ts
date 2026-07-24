/**
 * 촉매 소모 실패 폴백 모달 — Pixi (ADR-0029, Lane 4).
 *
 * 출격 직전 `consume_catalysts` 가 실패(오프라인/서버 거부)했을 때 뜬다. 서버 트랜잭션이
 * 롤백돼 **아이템은 차감되지 않았음**을 알리고 두 갈래를 준다:
 *   · [재시도] — consume 를 다시 시도한다(네트워크 회복 후).
 *   · [촉매 빼고 출격] — 무촉매(`catalysts:[]`·runId 없음)로 런을 시작한다(오프라인 폴백 보존).
 *   · X/암막(취소) — 성계 지도로 되돌아간다(주입은 그대로 남는다).
 *
 * main.ts 가 게임 stage 위에 직접 얹어 출격 흐름을 가른다. 순수 render/UI 레이어(ADR-0005).
 */

import { Container, Text } from 'pixi.js';
import { t } from '../../i18n/index.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { makeModal } from './modal.js';
import { PixiButton } from './button.js';

const MODAL_W = 780;
const MODAL_H = 400;

export interface CatalystSortieCallbacks {
  /** [재시도] — consume 재시도. */
  onRetry: () => void;
  /** [촉매 빼고 출격] — 무촉매로 런 시작. */
  onSkip: () => void;
  /** X/암막(취소) — 성계 지도로 복귀(출격 안 함). */
  onCancel: () => void;
}

export class CatalystSortieModal {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private cb: CatalystSortieCallbacks | null = null;

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(cb: CatalystSortieCallbacks): void {
    this.cb = cb;
    this.render();
    this.root.visible = true;
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
  }

  private choose(pick: 'retry' | 'skip' | 'cancel'): void {
    const cb = this.cb;
    this.hide();
    if (cb === null) return;
    if (pick === 'retry') cb.onRetry();
    else if (pick === 'skip') cb.onSkip();
    else cb.onCancel();
  }

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    if (this.cb === null) return;

    const parts = makeModal({
      width: MODAL_W,
      height: MODAL_H,
      title: t('catalyst.sortie.failTitle'),
      titleColor: 0xffb0a0,
      onClose: () => this.choose('cancel'),
      panelTexture: this.ui['ui_panel.png'],
      closeTexture: this.ui['ui_icon_close.png'],
    });
    this.root.addChild(parts.root);

    const body = new Text({
      resolution: 2,
      text: t('catalyst.sortie.failBody'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 19,
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: parts.box.w,
        lineHeight: 28,
        dropShadow: TEXT_SHADOW,
      },
    });
    body.position.set(parts.box.x, parts.box.y + 56);
    parts.panel.addChild(body);

    const btnY = parts.box.bottom - 60;
    const retry = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      width: 220,
      height: 56,
      fontSize: 22,
      labelColor: COLOR.darkLabel,
      label: t('catalyst.sortie.retry'),
      onClick: () => this.choose('retry'),
    });
    retry.container.position.set(parts.box.x, btnY);
    parts.panel.addChild(retry.container);

    const skip = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: parts.box.w - 220 - 16,
      height: 56,
      fontSize: 20,
      label: t('catalyst.sortie.skip'),
      onClick: () => this.choose('skip'),
    });
    skip.container.position.set(parts.box.x + 220 + 16, btnY);
    parts.panel.addChild(skip.container);
  }
}
