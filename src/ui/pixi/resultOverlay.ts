/**
 * 정산 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #5).
 *
 * `src/ui/resultOverlay.ts` 의 DOM `ResultOverlay` 와 기능 1:1 동등하게 런 종료 정산을 Pixi
 * 캔버스(1920×1080 디자인 스페이스)로 재구현한다: 승/패 배너, 런 기록 7행, 전리품 정산
 * (획득 장비 수·레벨업·스킬 포인트·크레딧·전투력·보관 실패), 획득 장비 목록, 다시 출격 /
 * 장비 정비. 공개 인터페이스(`show`/`hide`/`visible`)와 타입(`ResultState` 등)은 DOM 판
 * 그대로라 main.ts 는 생성자 한 줄만 바뀐다(롤아웃 공통 규칙 2). DOM 클래스는 회귀 대비로 남긴다.
 *
 * DOM 판의 등급색 **텍스트 칩**은 슬롯 그리드 + 등급 테두리 + hover 툴팁으로 바꿨다(정제소 #3
 * 패턴). 파밍 시각 언어(등급색)는 그대로 두고, 칩보다 많은 드랍을 한눈에 담는다.
 *
 * 다른 메타 화면과 달리 **런 직후**라 배경을 불투명하게 덮지 않는다 — DOM 판의 반투명 암막
 * (rgba(3,5,12,.82))처럼 얼어붙은 아레나가 뒤에 비친다.
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { dropName, type ResultDrop, type ResultState, type SettlementSummary } from '../resultOverlay.js';
import { COLOR, RARITY_COLOR_NUM, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeSlotCell, gridPositions } from './slotGrid.js';
import { PixiTooltip } from './tooltip.js';
import { makeBanner } from './titleBar.js';
import { stripEmoji } from './text.js';

export type { ResultDrop, SettlementSummary, ResultState };

/** 승리/패배 배너 제목색. 세트 팔레트 안에서 고른다(DOM 판 네온 시안/핑크는 나무와 겉돈다). */
const WIN_COLOR = COLOR.gold;
const LOSE_COLOR = 0xffb0a0;

// --- 레이아웃 상수(디자인 스페이스) ---
/** 배너 폭은 가장 긴 제목("Planet Conquered!")이 들어가는 값. */
const BANNER_W = 520;
const BANNER_H = 72;
const BANNER_Y = 12;
const SUB_Y = 100;

const PANEL_Y = 150;
/** 기록 7행이 상자를 채우고, 전리품 쪽 장비 그리드가 2행(16칸)까지 들어가는 높이. */
const PANEL_H = 640;
const PANEL_GAP = 24;
const STATS_W = 700;
const LOOT_W = 1000;
/** 정산 블록이 없는 런(오염 런)에서는 기록 패널만 남으므로 조금 넓게 혼자 선다. */
const STATS_W_ALONE = 900;

/** 패널 제목(콘텐츠 상자 top = 60, 26px) 아래에서 첫 행이 시작한다. */
const ROW_TOP = 132;
const STAT_STEP = 62;
const LOOT_STEP = 56;
/** 전리품 항목은 2열로 접어 아래 장비 그리드에 자리를 내준다. */
const LOOT_COLS = 2;
/** key(우측 정렬) ↔ value(좌측 정렬) 사이 간격의 절반 — 열 중심에서 각각 이만큼 벌린다. */
const ROW_HALF_GAP = 14;

// 획득 장비 그리드.
const CELL = 88;
const CELL_GAP = 10;
const GRID_COLS = 8;

// 하단 액션.
const BTN_Y = 860;
const RESTART_W = 420;
const RESTART_H = 80;
const SIDE_W = 300;
const SIDE_H = 68;
const SIDE_GAP = 24;
const SIDE_Y = BTN_Y + (RESTART_H - SIDE_H) / 2;

/** 전리품 정산 한 항목(라벨 · 값 · 강조 여부). */
interface LootEntry {
  key: string;
  value: string;
  accent?: boolean;
}

/**
 * 캔버스 화면이 가려야 하는 DOM 조각.
 *
 * `pb-hud` 는 다른 캔버스 화면과 같은 이유(런 전용 HUD). `hud` 는 DEV 텔레메트리 줄
 * (seed/tick/hash/FPS)인데, **정산만** 이걸 가려야 한다 — 다른 메타 화면은 `world` 가
 * null 이라 줄이 비어 있지만, 정산은 런 직후라 월드가 살아 있어 매 프레임 갱신되고
 * 캔버스 위로 그려진다(DOM 판에서는 z-index 30 오버레이가 덮어 줬다).
 */
const HIDDEN_DOM_IDS = ['pb-hud', 'hud'] as const;

function setDomHidden(hidden: boolean): void {
  for (const id of HIDDEN_DOM_IDS) {
    const el = document.getElementById(id);
    if (el !== null) el.style.visibility = hidden ? 'hidden' : '';
  }
}

export class ResultOverlayScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  private ui: UiTextures = {};
  private state: ResultState | null = null;
  private onRestart: (() => void) | null = null;
  private onInventory: (() => void) | null = null;

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    this.root.addChild(this.tooltip.container);
    // UI 킷 텍스처 비동기 로드 — 완료 후 열려 있으면 실 아트로 다시 그린다(그 전엔 폴백).
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * 정산 화면을 연다(DOM 판과 동일 시그니처). 이미 떠 있으면 무시한다 — DOM 판의
   * `if (this.shown) return` 과 같은 멱등 가드다.
   */
  show(s: ResultState, onRestart: () => void, onInventory?: () => void): void {
    if (this.root.visible) return;
    this.state = s;
    this.onRestart = onRestart;
    this.onInventory = onInventory ?? null;
    this.render();
    this.root.visible = true;
    setDomHidden(true);
  }

  hide(): void {
    this.root.visible = false;
    this.tooltip.hide();
    this.state = null;
    this.onRestart = null;
    this.onInventory = null;
    setDomHidden(false);
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      if (child !== this.tooltip.container) {
        this.root.removeChild(child);
        child.destroy({ children: true });
      }
    }
    this.tooltip.hide();

    const s = this.state;
    if (s === null) return;

    // 반투명 암막(DOM 판과 동일 — 얼어붙은 아레나가 뒤에 비친다). eventMode 로 뒤 화면에
    // 포인터가 새지 않게 막는다.
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: 0.9 });
    scrim.eventMode = 'static';
    this.root.addChildAt(scrim, 0);

    this.renderTitleBar(s);
    const settlement = s.settlement;
    if (settlement === undefined) {
      // 오염 런: 정산 블록이 없다(DOM 판과 동일). 기록 패널만 가운데 세운다.
      this.renderStatsPanel(s, (DESIGN_WIDTH - STATS_W_ALONE) / 2, STATS_W_ALONE);
    } else {
      const rowW = STATS_W + PANEL_GAP + LOOT_W;
      const x0 = (DESIGN_WIDTH - rowW) / 2;
      this.renderStatsPanel(s, x0, STATS_W);
      this.renderLootPanel(settlement, x0 + STATS_W + PANEL_GAP);
    }
    this.renderActions();

    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private renderTitleBar(s: ResultState): void {
    const banner = makeBanner(
      BANNER_W,
      BANNER_H,
      s.victory ? t('result.win.title') : t('result.lose.title'),
      this.ui['ui_banner.png'],
      s.victory ? WIN_COLOR : LOSE_COLOR,
    );
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const sub = new Text({
      resolution: 2,
      text: s.victory ? t('result.win.sub') : t('result.lose.sub'),
      style: { fontFamily: UI_FONT, fontSize: 20, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(DESIGN_WIDTH / 2, SUB_Y);
    this.root.addChild(sub);
  }

  /** 패널 제목 — top = 콘텐츠 상자 top(스킬 §4, 제목이 나무 테두리에 붙던 결함 재발 방지). */
  private panelTitle(parent: Container, w: number, text: string): void {
    const box = panelContent(w, PANEL_H);
    const title = new Text({
      resolution: 2,
      text,
      style: {
        fontFamily: UI_FONT,
        fontSize: 26,
        fontWeight: '800',
        fill: COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    title.position.set(box.x, box.y);
    parent.addChild(title);
  }

  /**
   * 라벨:값 한 행. 열 중심(centerX)을 기준으로 라벨은 왼쪽(우측 정렬), 값은 오른쪽
   * (좌측 정렬)에 붙여 콜론 위치가 행마다 흔들리지 않게 한다.
   */
  private valueRow(
    parent: Container,
    centerX: number,
    y: number,
    label: string,
    value: string,
    accent = false,
  ): void {
    const k = new Text({
      resolution: 2,
      text: label,
      style: { fontFamily: UI_FONT, fontSize: 19, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    k.anchor.set(1, 0);
    k.position.set(centerX - ROW_HALF_GAP, y + 3);
    parent.addChild(k);

    const v = new Text({
      resolution: 2,
      text: value,
      style: {
        fontFamily: UI_FONT,
        fontSize: 23,
        fontWeight: '700',
        fill: accent ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    v.anchor.set(0, 0);
    v.position.set(centerX + ROW_HALF_GAP, y);
    parent.addChild(v);
  }

  private renderStatsPanel(s: ResultState, x: number, w: number): void {
    const panel = new Container();
    panel.position.set(x, PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(w, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));
    this.panelTitle(panel, w, t('result.stat.title'));

    const box = panelContent(w, PANEL_H);
    const centerX = box.x + box.w / 2;
    const min = Math.floor(s.timeSec / 60);
    const sec = Math.floor(s.timeSec % 60);
    const rows: [string, string][] = [
      [t('result.stat.time'), `${min}:${sec.toString().padStart(2, '0')}`],
      [t('result.stat.level'), t('result.levelShort', { n: s.level })],
      [t('result.stat.xp'), `${s.xpTotal}`],
      [t('result.stat.kills'), `${s.kills}`],
      [t('result.stat.combo'), `${s.maxCombo}`],
      [t('result.stat.resources'), `${s.resources}`],
      [t('result.stat.seed'), `${s.seed}`],
    ];
    rows.forEach(([k, v], i) => {
      this.valueRow(panel, centerX, ROW_TOP + i * STAT_STEP, k, v);
    });
  }

  private renderLootPanel(st: SettlementSummary, x: number): void {
    const panel = new Container();
    panel.position.set(x, PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(LOOT_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));
    this.panelTitle(panel, LOOT_W, t('result.loot.title'));

    const box = panelContent(LOOT_W, PANEL_H);
    const entries: LootEntry[] = [
      { key: t('result.loot.items'), value: t('result.loot.count', { n: st.itemsGained }) },
      { key: t('result.loot.levels'), value: `+${st.levelsGained}` },
      { key: t('result.loot.skillPoints'), value: `+${st.skillPointsGained}` },
      { key: t('result.loot.credits'), value: `+${st.creditsGained}` },
      { key: t('result.loot.power'), value: `+${st.combatPower}`, accent: true },
    ];
    if (st.overflow > 0) {
      entries.push({ key: t('result.loot.overflow'), value: t('result.loot.overflowVal', { n: st.overflow }) });
    }

    // 열 우선 배치(위→아래로 읽고 다음 열). 열 폭은 콘텐츠 상자를 정확히 반으로 나눈다.
    const rows = Math.ceil(entries.length / LOOT_COLS);
    const colW = box.w / LOOT_COLS;
    entries.forEach((e, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      this.valueRow(
        panel,
        box.x + colW * col + colW / 2,
        ROW_TOP + row * LOOT_STEP,
        e.key,
        e.value,
        e.accent === true,
      );
    });

    this.renderDrops(panel, st, box.bottom, ROW_TOP + rows * LOOT_STEP);
  }

  /** 획득 장비 소제목 + 슬롯 그리드(등급색 + hover 툴팁). 없으면 안내 문구. */
  private renderDrops(
    panel: Container,
    st: SettlementSummary,
    boxBottom: number,
    rowsEnd: number,
  ): void {
    const box = panelContent(LOOT_W, PANEL_H);
    const titleY = rowsEnd + 10;
    const gridTop = titleY + 44;
    // 마스크 하한 = 콘텐츠 상자 바닥, 높이는 셀 행 배수로 클램프(반토막 셀 금지).
    const gridRows = Math.max(0, Math.floor((boxBottom - gridTop + CELL_GAP) / (CELL + CELL_GAP)));
    const capacity = gridRows * GRID_COLS;
    const shown = Math.min(st.drops.length, capacity);
    const hidden = st.drops.length - shown;

    const title = new Text({
      resolution: 2,
      text: t('result.drops.title'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 20,
        fontWeight: '700',
        fill: COLOR.muted,
        dropShadow: TEXT_SHADOW,
      },
    });
    title.position.set(box.x, titleY);
    panel.addChild(title);

    if (hidden > 0) {
      // 그리드에 다 못 담은 나머지는 소제목 오른쪽에 개수로만 알린다(DOM 판 "외 N개").
      const more = new Text({
        resolution: 2,
        text: t('result.drops.more', { n: hidden }),
        style: { fontFamily: UI_FONT, fontSize: 18, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      more.anchor.set(1, 0);
      more.position.set(box.right, titleY + 3);
      panel.addChild(more);
    }

    if (st.drops.length === 0) {
      const none = new Text({
        resolution: 2,
        text: t('result.drops.none'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 20,
          fill: COLOR.muted,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: box.w,
          dropShadow: TEXT_SHADOW,
        },
      });
      none.anchor.set(0.5, 0);
      none.position.set(LOOT_W / 2, gridTop + 24);
      panel.addChild(none);
      return;
    }

    // 그리드는 '획득 장비' 소제목과 같은 왼쪽 축에 건다 — 가운데 정렬하면 드랍이 두어 개일 때
    // 셀이 소제목과 떨어져 허공에 뜬 것처럼 보인다(소제목 + 그리드가 한 덩어리로 읽혀야 한다).
    const gridX = box.x;
    const positions = gridPositions(shown, GRID_COLS, CELL, CELL_GAP);
    for (let i = 0; i < shown; i++) {
      const d = st.drops[i];
      const pos = positions[i];
      if (d === undefined || pos === undefined) continue;
      const cell = makeSlotCell({
        size: CELL,
        item: d,
        slotTex: this.ui['ui_slot.png'],
        onHover: (gx, gy) => this.showTip(d, gx, gy),
        onMove: (gx, gy) => this.moveTip(gx, gy),
        onOut: () => this.tooltip.hide(),
      });
      cell.position.set(gridX + pos.x, gridTop + pos.y);
      panel.addChild(cell);
    }
  }

  // --- 툴팁 ----------------------------------------------------------------

  private showTip(d: ResultDrop, globalX: number, globalY: number): void {
    const p = this.root.toLocal({ x: globalX, y: globalY });
    const title = dropName(d);
    const slot = t(`item.slot.${d.slot}` as MessageKey);
    const rarity = t(`item.rarity.${d.rarity}` as MessageKey);
    this.tooltip.show(
      {
        title,
        titleColor: RARITY_COLOR_NUM[d.rarity],
        // 비무기 슬롯은 제목이 곧 슬롯명이라 부제에 또 적으면 "코어 / 코어 · 매직"이 된다.
        // 주무기만 제목이 무기 종류("발칸")라 슬롯을 함께 알려 줄 값이 있다.
        subtitle: title === slot ? rarity : `${slot} · ${rarity}`,
        lines: [],
      },
      p.x,
      p.y,
      RARITY_COLOR_NUM[d.rarity],
    );
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private moveTip(globalX: number, globalY: number): void {
    if (!this.tooltip.container.visible) return;
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.container.position.set(
      Math.min(p.x + 14, DESIGN_WIDTH - this.tooltip.container.width),
      Math.min(p.y + 14, DESIGN_HEIGHT - this.tooltip.container.height),
    );
  }

  // --- 액션 ----------------------------------------------------------------

  private renderActions(): void {
    const restartX = (DESIGN_WIDTH - RESTART_W) / 2;

    if (this.onInventory !== null) {
      const inv = new PixiButton({
        texture: this.ui['ui_btn_wood.png'],
        fallbackColor: 0x4a3a24,
        width: SIDE_W,
        height: SIDE_H,
        fontSize: 22,
        // '🛠 장비 정비' 의 컬러 이모지는 캔버스에서 두부가 된다.
        label: stripEmoji(t('result.btn.inventory')),
        onClick: () => this.onInventory?.(),
      });
      inv.container.position.set(restartX - SIDE_GAP - SIDE_W, SIDE_Y);
      this.root.addChild(inv.container);
    }

    const restart = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      width: RESTART_W,
      height: RESTART_H,
      fontSize: 30,
      // 노란 버튼은 바탕이 밝아 흰 라벨이 묻힌다(롤아웃 #1~#4 와 동일 처리).
      labelColor: COLOR.darkLabel,
      label: t('result.btn.restart'),
      onClick: () => this.onRestart?.(),
    });
    restart.container.position.set(restartX, BTN_Y);
    this.root.addChild(restart.container);
  }
}
