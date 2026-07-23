/**
 * 세계관 인트로 슬라이드 — 오스카 문명 배경 3~4컷 (스토리 시스템 Phase C).
 *
 * 첫 실행 1회(Phase C3 가 트리거) + 기록 보관소 "프롤로그" 탭 다시보기가 **같은 컴포넌트**를
 * 쓴다. 언제든 스킵 가능. 슬라이드 문구는 `data/lore` 의 `INTRO_SLIDES` 순서를 그대로 따르고
 * (`loreLabels.introTitle/introBody`), 컷 삽화는 별도 아트 없이 기존 자산(행성 오브·초상·아이콘)을
 * 엠블럼으로 재사용한다 — 없으면 절차적 폴백.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다. 컬러 이모지 금지(text.ts stripEmoji).
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { t } from '../../i18n/index.js';
import { INTRO_SLIDES } from '../../../data/lore/index.js';
import { introTitle, introBody } from './loreLabels.js';

const PANEL_W = 1160;
const PANEL_H = 660;
const EMBLEM = 176;

/** 슬라이드 id → 엠블럼 텍스처 basename(기존 자산 재사용, 없으면 폴백). 아트가 없어도 안전. */
const SLIDE_EMBLEM: Readonly<Record<string, string>> = {
  collapse: 'ui_planet_2.png', // 얼어붙은/죽은 세계 느낌
  records: 'ui_icon_crystal.png', // 기록 = 가치
  archives: 'ui_planet_0.png', // 봉인된 세계
  launch: 'ship_portrait_striker.png', // 당신(무명 신출내기)도 떠난다
};

export interface IntroShowOptions {
  onDone: () => void;
}

export class IntroSlidesScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private onDone: (() => void) | null = null;
  private index = 0;

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

  show(opts: IntroShowOptions): void {
    this.onDone = opts.onDone;
    this.index = 0;
    this.render();
    this.root.visible = true;
    this.raise();
  }

  hide(): void {
    this.root.visible = false;
    this.onDone = null;
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  private next(): void {
    if (this.index >= INTRO_SLIDES.length - 1) {
      this.finish();
      return;
    }
    this.index += 1;
    this.render();
  }

  private finish(): void {
    const cb = this.onDone;
    this.hide();
    cb?.();
  }

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    // 암막 — 뒤 화면으로 이벤트가 새지 않게 막는다.
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x000000, alpha: 0.82 });
    scrim.eventMode = 'static';
    this.root.addChild(scrim);

    const slide = INTRO_SLIDES[this.index];
    if (slide === undefined) {
      this.finish();
      return;
    }

    const panel = new Container();
    const px = (DESIGN_WIDTH - PANEL_W) / 2;
    const py = (DESIGN_HEIGHT - PANEL_H) / 2;
    panel.position.set(px, py);
    this.root.addChild(panel);
    panel.addChild(
      nineSlicePanel(PANEL_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER, fillAlpha: 1 }),
    );
    const box = panelContent(PANEL_W, PANEL_H);

    // 엠블럼(기존 자산 재사용, 없으면 절차적 원).
    const emblemTex = this.ui[SLIDE_EMBLEM[slide.id] ?? ''];
    const ex = box.x + (box.w - EMBLEM) / 2;
    const ey = box.y + 8;
    if (emblemTex) {
      const sp = new Sprite(emblemTex);
      sp.width = EMBLEM;
      sp.height = EMBLEM;
      sp.position.set(ex, ey);
      panel.addChild(sp);
    } else {
      const g = new Graphics();
      g.circle(ex + EMBLEM / 2, ey + EMBLEM / 2, EMBLEM / 2)
        .fill({ color: 0x2a2233 })
        .stroke({ color: COLOR.gold, width: 3 });
      panel.addChild(g);
    }

    const title = new Text({
      resolution: 2,
      text: introTitle(slide),
      style: {
        fontFamily: UI_FONT,
        fontSize: 40,
        fontWeight: '800',
        fill: COLOR.gold,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: box.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    title.anchor.set(0.5, 0);
    title.position.set(box.x + box.w / 2, ey + EMBLEM + 28);
    panel.addChild(title);

    const body = new Text({
      resolution: 2,
      text: introBody(slide),
      style: {
        fontFamily: UI_FONT,
        fontSize: 21,
        fill: COLOR.cream,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: box.w - 80,
        lineHeight: 32,
        dropShadow: TEXT_SHADOW,
      },
    });
    body.anchor.set(0.5, 0);
    body.position.set(box.x + box.w / 2, title.y + title.getLocalBounds().height + 26);
    panel.addChild(body);

    // 진행 점(현재 컷 강조).
    const dotR = 7;
    const dotGap = 26;
    const dotsW = (INTRO_SLIDES.length - 1) * dotGap;
    const dotsY = box.bottom - 96;
    const dots = new Graphics();
    INTRO_SLIDES.forEach((_, i) => {
      const cx = box.x + box.w / 2 - dotsW / 2 + i * dotGap;
      dots.circle(cx, dotsY, dotR).fill({ color: i === this.index ? COLOR.gold : 0x5a4f66 });
    });
    panel.addChild(dots);

    // Skip(좌) + Next/Begin(우). 마지막 컷이면 Begin 이 인트로를 닫는다.
    const last = this.index >= INTRO_SLIDES.length - 1;
    const skip = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: 200,
      height: 60,
      fontSize: 19,
      label: t('intro.skip'),
      onClick: () => this.finish(),
    });
    skip.container.position.set(box.x, box.bottom - 64);
    panel.addChild(skip.container);

    const nextBtn = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0xc9a227, // 밝은 골드 버튼(폴백)
      width: 240,
      height: 60,
      fontSize: 19,
      labelColor: COLOR.darkLabel,
      label: last ? t('intro.begin') : t('intro.next'),
      onClick: () => this.next(),
    });
    nextBtn.container.position.set(box.right - 240, box.bottom - 64);
    panel.addChild(nextBtn.container);
  }
}
