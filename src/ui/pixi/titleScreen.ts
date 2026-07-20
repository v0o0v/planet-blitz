/**
 * 타이틀 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #8 과 같은 PR).
 *
 * `src/ui/tutorial.ts` 의 DOM `TitleScreen` 과 기능 1:1 동등하게 로고 · 부제 · 시작 버튼
 * (첫 실행이면 튜토리얼 안내 한 줄)을 Pixi 캔버스로 재구현한다. 공개 인터페이스
 * (`show`/`hide`/`visible`)와 콜백 타입은 DOM 판과 같아 `main.ts` 호출부는 그대로다.
 *
 * **이 화면이 롤아웃 표에 없는데도 함께 이관된 이유**: 설정(#8)이 캔버스로 들어가면서
 * DOM 오버레이는 전부 설정 위에 그려지게 됐다. 타이틀은 불투명 배경으로 화면 전체를
 * 덮으므로 좌상단 톱니가 통째로 사라졌고 — 첫 실행 사용자가 언어를 바꿀 길이 없어졌다.
 * 캔버스로 옮기면 톱니가 다시 보인다(사용자 판정, 2026-07-20).
 *
 * 순수 render/UI 레이어(ADR-0005·ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { t } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';

export interface TitleShowOpts {
  /** true = 시작 버튼이 강제 튜토리얼 런을 띄운다(첫 실행). */
  firstRun: boolean;
  onStart: () => void;
}

// --- 레이아웃 상수(디자인 스페이스) ---
const PANEL_W = 980;
const BOX = panelContent(PANEL_W, 0);
const CW = BOX.w;
const START_W = 460;
const START_H = 86;

function centeredText(text: string, size: number, fill: number, weight: '700' | '900' = '700'): Text {
  const el = new Text({
    resolution: 2,
    text,
    style: {
      fontFamily: UI_FONT,
      fontSize: size,
      fontWeight: weight,
      fill,
      align: 'center',
      dropShadow: TEXT_SHADOW,
      letterSpacing: weight === '900' ? 6 : 0,
    },
  });
  el.anchor.set(0.5, 0);
  el.position.set(CW / 2, 0);
  return el;
}

export class TitleScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private opts: TitleShowOpts | null = null;

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

  show(opts: TitleShowOpts): void {
    this.opts = opts;
    this.render();
    this.root.visible = true;
    // 다른 캔버스 화면(카드 등)이 자기를 맨 앞으로 올려 둔 뒤일 수 있다 — 타이틀도 올린다.
    // 설정은 렌더 루프의 raise() 로 다음 프레임에 다시 그 위로 돌아온다(크롬 UI).
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
    // DOM HUD(HP/LV, 좌하단)는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다.
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    const opts = this.opts;
    if (opts === null) return;

    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChild(bg);

    // 콘텐츠를 먼저 조립해 실제 바닥을 재고, 그 높이로 패널을 만든다(위아래 여백 대칭).
    const content = new Container();
    let y = 0;

    const logo = centeredText('PLANET BLITZ', 96, COLOR.gold, '900');
    logo.y = y;
    content.addChild(logo);
    y += 142; // 로고 글자 높이(≈120)보다 넉넉히 — 부제가 로고에 붙지 않게.

    const tag = centeredText(t('title.tag'), 26, COLOR.cream);
    tag.y = y;
    content.addChild(tag);
    y += 70;

    const start = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      width: START_W,
      height: START_H,
      label: stripEmoji(opts.firstRun ? t('title.startTutorial') : t('title.enterBase')),
      fontSize: 32,
      labelColor: COLOR.darkLabel,
      onClick: () => {
        this.hide();
        opts.onStart();
      },
    });
    start.container.position.set((CW - START_W) / 2, y);
    content.addChild(start.container);
    y += START_H;

    if (opts.firstRun) {
      const note = centeredText(t('title.note'), 22, COLOR.muted);
      note.y = y + 22;
      content.addChild(note);
    }

    const panelH = Math.round(content.getLocalBounds().bottom + BOX.y * 2);
    const panel = nineSlicePanel(PANEL_W, panelH, { texture: this.ui['ui_panel.png'], fillAlpha: 1 });
    panel.position.set((DESIGN_WIDTH - PANEL_W) / 2, Math.round((DESIGN_HEIGHT - panelH) / 2));
    content.position.set(BOX.x, BOX.y);
    panel.addChild(content);
    this.root.addChild(panel);
  }
}
