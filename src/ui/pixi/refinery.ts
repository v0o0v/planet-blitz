/**
 * 정제소 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #3).
 *
 * `src/ui/refinery.ts` 의 DOM `Refinery` 와 기능 1:1 동등하게 어픽스 리롤을 Pixi
 * 캔버스(1920×1080 디자인 스페이스)로 재구현한다: 리롤 가능한 장비 그리드 선택,
 * 어픽스 1칸 잠금(광물 3배), 비용 계산(`rerollCost`/`canAfford`), 순수 리롤
 * (`rerollAffixes`) + 슬롯머신 스핀 연출, Profile in-place 변이 + saveProfile, i18n.
 *
 * DOM 판의 `title` 속성 툴팁 대신 공용 `PixiTooltip` 으로 장비 어픽스를 미리 보여준다.
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Rectangle, NineSliceSprite, Text } from 'pixi.js';
import type { Item } from '../../items/types.js';
import { AFFIX_BY_ID, AFFIXES } from '../../../data/affixes.js';
import { rerollAffixes } from '../../items/roll.js';
import { saveProfile, type KeyValueStore, type Profile } from '../../save/profile.js';
import { spendCurrencyOnServer } from '../../net/index.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { rerollCost, canAfford, LOCKED_REROLL_MULT } from '../../../data/economy.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, RARITY_COLOR_NUM, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeSlotCell, gridPositions, equipIconTexture } from './slotGrid.js';
import { PixiTooltip } from './tooltip.js';
import { makeBanner, makeCurrencyChip, makeIconButton } from './titleBar.js';
import { stripEmoji } from './text.js';

/** 슬롯 id → i18n 키(공용 item.slot.* 카탈로그 재사용, DOM 판과 동일). */
const SLOT_LABEL_KEY: Record<string, MessageKey> = {
  main: 'item.slot.main',
  sub: 'item.slot.sub',
  armor: 'item.slot.armor',
  shield: 'item.slot.shield',
  engine: 'item.slot.engine',
  core: 'item.slot.core',
  module: 'item.slot.module',
};

function slotLabel(slot: string): string {
  const key = SLOT_LABEL_KEY[slot];
  return key !== undefined ? t(key) : slot;
}

/** 무기 타입 i18n 키(0 발칸 … 4 빔 — M3 무기 5타입). */
const WEAPON_KEY: readonly MessageKey[] = [
  'item.weapon.0',
  'item.weapon.1',
  'item.weapon.2',
  'item.weapon.3',
  'item.weapon.4',
];

function weaponLabel(type: number): string {
  const key = WEAPON_KEY[type];
  return key !== undefined ? t(key) : '?';
}

// --- 레이아웃 상수(디자인 스페이스) ---
/** 배너 폭은 제목("정제소") 길이에 맞춘다 — 짧은 제목에 넓은 배너는 허전하다. */
const BANNER_W = 440;
const BANNER_H = 72;
const BANNER_Y = 12;
const CHIP_W = 190;
const CHIP_H = 52;
const PANEL_Y = 118;
const PANEL_H = 776;
const LIST_W = 700;
const DETAIL_W = 940;
const PANEL_GAP = 24;
const PANEL_X0 = Math.round((DESIGN_WIDTH - (LIST_W + DETAIL_W + PANEL_GAP)) / 2);
const DETAIL_X = PANEL_X0 + LIST_W + PANEL_GAP;

/**
 * 두 패널의 콘텐츠 상자. 제목·그리드·어픽스 행·비용·버튼을 전부 이 상자 기준으로 잡는다 —
 * 프레임 침범도, 테두리에 붙는 것도 좌표 재유도 없이 구조적으로 막힌다(nineSlicePanel).
 */
const BOX_L = panelContent(LIST_W, PANEL_H);
const BOX_D = panelContent(DETAIL_W, PANEL_H);
/** 제목 top = 콘텐츠 상자 top(스킬 §4 — 제목이 나무 테두리에 붙던 결함 재발 방지). */
const TITLE_Y = BOX_L.y;
/** 제목(60..~94) 아래에서 본문이 시작한다. */
const CONTENT_TOP = 118;

// 장비 그리드.
const CELL = 88;
const CELL_GAP = 10;
const GRID_COLS = 6;
const GRID_W = GRID_COLS * (CELL + CELL_GAP) - CELL_GAP;
/** 마스크 하한 = 콘텐츠 상자 바닥, 셀 행 배수로 클램프(반토막 셀 금지). */
const GRID_H =
  Math.floor((BOX_L.bottom - CONTENT_TOP + CELL_GAP) / (CELL + CELL_GAP)) * (CELL + CELL_GAP) - CELL_GAP;

// 상세 패널.
const NAME_Y = CONTENT_TOP;
const SUB_Y = 160;
const AFFIX_TOP = 200;
const AFFIX_H = 52;
const AFFIX_STEP = 60;
const ROLL_W = 380;
const ROLL_H = 64;

// 하단 액션.
const BACK_W = 300;
const BACK_H = 60;
const BACK_Y = 908;

export class RefineryScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private selectedId: string | null = null;
  private lockedIndex: number | null = null;
  private spinning = false;
  private hint = '';
  private spinTimer: ReturnType<typeof setInterval> | null = null;
  /** 스핀 프레임이 글자만 갈아끼울 어픽스 행 텍스트(잠긴 행은 null). */
  private spinTexts: (Text | null)[] = [];
  private listScrollY = 0;
  private ui: UiTextures = {};

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    this.root.addChild(this.tooltip.container);
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.selectedId = null;
    this.lockedIndex = null;
    this.stopSpin();
    this.hint = '';
    this.render();
    this.root.visible = true;
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    // DOM HUD 는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다(스킬 §7).
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.stopSpin();
    this.root.visible = false;
    this.tooltip.hide();
    this.onClose = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  private stopSpin(): void {
    if (this.spinTimer !== null) {
      clearInterval(this.spinTimer);
      this.spinTimer = null;
    }
    this.spinning = false;
  }

  private persist(): void {
    // ⚠️ 명시적 null 은 `saveProfile` 의 기본 인자를 밀어내고 즉시 return 된다 — main.ts 가
    // store 없이 이 화면을 만들기 때문에 그대로 넘기면 정제 결과가 저장되지 않는다.
    saveProfile(this.profile, this.store ?? undefined);
  }

  // --- 선택 / 잠금 / 리롤 (DOM 판과 동일 규칙) -----------------------------

  /** 어픽스가 하나라도 있는 인벤토리 장비(리롤할 가치가 있는 것만). */
  private rerollable(): Item[] {
    return this.profile.inventory.filter((it) => it.affixes.length > 0);
  }

  private selected(): Item | undefined {
    if (this.selectedId === null) return undefined;
    return this.profile.inventory.find((it) => it.id === this.selectedId);
  }

  private currentCost(): number {
    const item = this.selected();
    if (item === undefined) return 0;
    const lockCount = this.lockedIndex !== null ? 1 : 0;
    return rerollCost(item.rarity, item.affixes.length, lockCount);
  }

  private select(item: Item): void {
    if (this.spinning) return;
    this.selectedId = item.id;
    this.lockedIndex = null;
    this.hint = '';
    this.render();
  }

  private toggleLock(index: number): void {
    if (this.spinning) return;
    this.lockedIndex = this.lockedIndex === index ? null : index;
    this.render();
  }

  private async reroll(): Promise<void> {
    const item = this.selected();
    if (item === undefined || this.spinning) return;
    const cost = this.currentCost();
    if (!canAfford(this.profile.minerals, cost)) {
      this.hint = t('refine.err.noMinerals', { n: cost });
      this.render();
      return;
    }
    // 재화 서버 권위(ADR-0027): 온라인이면 spend_currency 로 광물 차감을 확정(ok 일 때만 리롤),
    // 미설정이면 기존 로컬 차감. 잔액 부족·오프라인(rejected)이면 리롤하지 않는다(위조 차단).
    const res = await spendCurrencyOnServer(0, cost, 'reroll');
    if (res.status === 'ok') {
      this.profile.credits = res.creditsLeft;
      this.profile.minerals = res.mineralsLeft;
    } else if (res.status === 'unconfigured') {
      this.profile.minerals -= cost;
    } else {
      this.hint = t('refine.err.noMinerals', { n: cost });
      this.render();
      return;
    }
    // 리롤 시드는 UI 레이어에서 만든다(sim 밖이라 Math.random 자유).
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const lockIdx = this.lockedIndex ?? undefined;
    const reforged = rerollAffixes(item, seed, lockIdx);

    // 재련 결과를 id 로 인벤토리에 교체 투입(차감은 위에서 확정됨).
    const idx = this.profile.inventory.findIndex((it) => it.id === item.id);
    if (idx >= 0) this.profile.inventory[idx] = reforged;
    this.persist();

    // 슬롯머신 스핀(렌더 전용): 무작위 어픽스 이름을 굴리다 결과로 안착.
    this.hint = '';
    this.spinning = true;
    this.render();
    let ticks = 0;
    const TOTAL = 12;
    this.spinTimer = setInterval(() => {
      ticks++;
      if (ticks >= TOTAL) {
        this.stopSpin();
        this.render();
      } else {
        this.renderSpinFrame();
      }
    }, 70);
  }

  private itemName(item: Item): string {
    if (item.slot === 'main' && item.weaponType !== undefined) {
      return `${t('item.slot.main')} · ${weaponLabel(item.weaponType)}`;
    }
    return slotLabel(item.slot);
  }

  private affixText(item: Item, i: number): string {
    const a = item.affixes[i];
    if (a === undefined) return '';
    const def = AFFIX_BY_ID.get(a.id);
    return def !== undefined ? `${def.name} (${a.stat} +${a.value})` : `${a.stat} +${a.value}`;
  }

  // --- 툴팁 ----------------------------------------------------------------

  private showTip(item: Item, globalX: number, globalY: number): void {
    const lines = item.affixes.map((_, i) => this.affixText(item, i));
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.show(
      {
        title: this.itemName(item),
        titleColor: RARITY_COLOR_NUM[item.rarity],
        subtitle: `${slotLabel(item.slot)} · ${t(`item.rarity.${item.rarity}` as MessageKey)}`,
        lines,
      },
      p.x,
      p.y,
      RARITY_COLOR_NUM[item.rarity],
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

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      if (child !== this.tooltip.container) {
        this.root.removeChild(child);
        child.destroy({ children: true });
      }
    }
    this.tooltip.hide();
    this.spinTexts = [];

    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChildAt(bg, 0);

    this.renderTitleBar();
    this.renderListPanel();
    this.renderDetailPanel();
    this.renderActions();
    this.renderHint();

    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('refine.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const chipY = BANNER_Y + (BANNER_H - CHIP_H) / 2;
    const minerals = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.minerals),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_crystal.png'],
    );
    minerals.position.set((DESIGN_WIDTH - BANNER_W) / 2 - CHIP_W - 20, chipY);
    this.root.addChild(minerals);

    const credits = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.credits),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_coin.png'],
    );
    credits.position.set((DESIGN_WIDTH + BANNER_W) / 2 + 20, chipY);
    this.root.addChild(credits);

    const close = makeIconButton(
      56,
      () => this.close(),
      this.ui['ui_icon_close.png'],
    );
    close.position.set(DESIGN_WIDTH - 24 - 56, 12);
    this.root.addChild(close);
  }

  private close(): void {
    if (this.spinning) return; // 스핀 중 이탈 금지(DOM 판 뒤로가기와 동일).
    const cb = this.onClose;
    this.hide();
    cb?.();
  }

  private panelTitle(parent: Container, text: string): void {
    const title = new Text({
      resolution: 2,
      text,
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    title.position.set(BOX_L.x, TITLE_Y);
    parent.addChild(title);
  }

  private renderListPanel(): void {
    const panel = new Container();
    panel.position.set(PANEL_X0, PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(LIST_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    const items = this.rerollable();
    this.panelTitle(panel, t('refine.listHeader', { n: items.length }));

    if (items.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('refine.noItems'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 20,
          fill: COLOR.muted,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: BOX_L.w,
          dropShadow: TEXT_SHADOW,
        },
      });
      empty.anchor.set(0.5, 0);
      empty.position.set(LIST_W / 2, CONTENT_TOP + 60);
      panel.addChild(empty);
      return;
    }

    // 그리드는 콘텐츠 상자 안에서 가로 중앙 정렬(6열 × 셀 88).
    const contentX = BOX_L.x + Math.floor((BOX_L.w - GRID_W) / 2);
    const clip = new Container();
    clip.position.set(contentX, CONTENT_TOP);
    panel.addChild(clip);
    const mask = new Graphics();
    mask.rect(contentX, CONTENT_TOP, GRID_W, GRID_H).fill({ color: 0xffffff });
    panel.addChild(mask);
    clip.mask = mask;

    const content = new Container();
    clip.addChild(content);

    const positions = gridPositions(items.length, GRID_COLS, CELL, CELL_GAP);
    items.forEach((item, i) => {
      const isSel = item.id === this.selectedId;
      const cell = makeSlotCell({
        size: CELL,
        item,
        slotTex: this.ui[isSel ? 'ui_slot_hl.png' : 'ui_slot.png'],
        iconTex: equipIconTexture(this.ui, item),
        highlight: isSel,
        highlightTex: this.ui['ui_slot_hl.png'],
        onClick: () => this.select(item),
        onHover: (gx, gy) => this.showTip(item, gx, gy),
        onMove: (gx, gy) => this.moveTip(gx, gy),
        onOut: () => this.tooltip.hide(),
      });
      if (isSel) {
        // 선택 표시: 금색 링(등급색 테두리 바깥). 등급 시각 언어를 가리지 않는다.
        const ring = new Graphics();
        ring.roundRect(2, 2, CELL - 4, CELL - 4, 9).stroke({ color: COLOR.gold, width: 3, alignment: 1 });
        cell.addChild(ring);
      }
      const pos = positions[i];
      if (pos !== undefined) cell.position.set(pos.x, pos.y);
      content.addChild(cell);
    });

    const rows = Math.ceil(items.length / GRID_COLS);
    const total = rows * (CELL + CELL_GAP) - CELL_GAP;
    const maxScroll = Math.max(0, total - GRID_H);
    this.listScrollY = Math.min(this.listScrollY, maxScroll);
    content.y = -this.listScrollY;
    if (maxScroll > 0) {
      // 휠은 **클립 Container** 가 받는다 — 마스크로 쓰이는 Graphics 는 히트 테스트에서 제외돼
      // (`isMask`) 리스너가 영영 불리지 않는다(카드 화면 #7 에서 실측).
      clip.eventMode = 'static';
      clip.hitArea = new Rectangle(0, 0, GRID_W, GRID_H);
      clip.on('wheel', (e) => {
        this.listScrollY = Math.max(0, Math.min(maxScroll, this.listScrollY + e.deltaY));
        content.y = -this.listScrollY;
      });
    }
  }

  private renderDetailPanel(): void {
    const panel = new Container();
    panel.position.set(DETAIL_X, PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(DETAIL_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    this.panelTitle(panel, t('refine.reroll'));

    const item = this.selected();
    if (item === undefined) {
      const prompt = new Text({
        resolution: 2,
        text: t('refine.selectPrompt'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 20,
          fill: COLOR.muted,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: BOX_D.w,
          dropShadow: TEXT_SHADOW,
        },
      });
      prompt.anchor.set(0.5, 0);
      prompt.position.set(DETAIL_W / 2, CONTENT_TOP + 60);
      panel.addChild(prompt);
      return;
    }

    const name = new Text({
      resolution: 2,
      text: this.itemName(item),
      style: {
        fontFamily: UI_FONT,
        fontSize: 30,
        fontWeight: '800',
        fill: RARITY_COLOR_NUM[item.rarity],
        dropShadow: TEXT_SHADOW,
      },
    });
    name.position.set(BOX_D.x, NAME_Y);
    panel.addChild(name);

    const sub = new Text({
      resolution: 2,
      text: `${slotLabel(item.slot)} · ${t(`item.rarity.${item.rarity}` as MessageKey)} · ${t('refine.lockNote', { mult: LOCKED_REROLL_MULT })}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: BOX_D.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    sub.position.set(BOX_D.x, SUB_Y);
    panel.addChild(sub);

    for (let i = 0; i < item.affixes.length; i++) {
      const row = this.makeAffixRow(item, i);
      row.position.set(BOX_D.x, AFFIX_TOP + i * AFFIX_STEP);
      panel.addChild(row);
    }

    // 비용 + 리롤 버튼은 어픽스 행 아래로 흐르되, 콘텐츠 상자 바닥을 넘지 않게 클램프한다.
    const rowsEnd = AFFIX_TOP + item.affixes.length * AFFIX_STEP;
    const rollY = Math.min(rowsEnd + 52, BOX_D.bottom - ROLL_H);
    const costY = rollY - 34;

    const cost = new Text({
      resolution: 2,
      text:
        this.lockedIndex !== null
          ? t('refine.cost.locked', { n: this.currentCost() })
          : t('refine.cost.normal', { n: this.currentCost() }),
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    cost.position.set(BOX_D.x, costY);
    panel.addChild(cost);

    const roll = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      width: ROLL_W,
      height: ROLL_H,
      fontSize: 24,
      // 노란 버튼은 바탕이 밝아 흰 라벨이 묻힌다(기지 맵·연구소와 동일 처리).
      labelColor: COLOR.darkLabel,
      label: stripEmoji(this.spinning ? t('refine.spinning') : t('refine.rollBtn')),
      onClick: () => void this.reroll(),
    });
    roll.container.position.set((DETAIL_W - ROLL_W) / 2, rollY);
    panel.addChild(roll.container);
    if (this.spinning || !canAfford(this.profile.minerals, this.currentCost())) roll.setEnabled(false);
  }

  /** 어픽스 한 행: 칩 9-slice + 어픽스 문구 + 잠금 토글 아이콘. */
  private makeAffixRow(item: Item, index: number): Container {
    const isLocked = this.lockedIndex === index;
    const row = new Container();
    const w = BOX_D.w;

    const chipTex = this.ui['ui_chip.png'];
    if (chipTex) {
      const bg = new NineSliceSprite({ texture: chipTex, leftWidth: 24, topHeight: 0, rightWidth: 24, bottomHeight: 0 });
      bg.width = w;
      bg.height = AFFIX_H;
      row.addChild(bg);
    } else {
      const g = new Graphics();
      g.roundRect(0, 0, w, AFFIX_H, 10).fill({ color: 0x2a2440 }).stroke({ color: 0x000000, width: 2, alpha: 0.5 });
      row.addChild(g);
    }

    if (isLocked) {
      const ring = new Graphics();
      ring.roundRect(2, 2, w - 4, AFFIX_H - 4, 9).stroke({ color: COLOR.gold, width: 3, alignment: 1 });
      row.addChild(ring);
    } else if (this.lockedIndex !== null) {
      // 잠긴 행 하나가 눈에 띄도록 나머지는 한 톤 낮춘다(나무 칩끼리는 금색 링만으로 약하다).
      row.alpha = 0.82;
    }

    const iconSize = 32;
    const iconX = w - 18 - iconSize;
    const label = new Text({
      resolution: 2,
      text: this.affixText(item, index),
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: '700',
        fill: this.spinning && !isLocked ? COLOR.muted : isLocked ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    label.anchor.set(0, 0.5);
    label.position.set(18, AFFIX_H / 2);
    // 긴 어픽스 문구가 잠금 아이콘과 겹치지 않게 가로만 축소한다(잘라내면 무슨 어픽스인지 모른다).
    const maxLabelW = iconX - 12 - 18;
    if (label.width > maxLabelW) label.scale.x = maxLabelW / label.width;
    row.addChild(label);
    this.spinTexts[index] = isLocked ? null : label;

    const lockBtn = makeIconButton(
      iconSize,
      () => this.toggleLock(index),
      this.ui[isLocked ? 'ui_lock.png' : 'ui_unlock.png'],
      isLocked ? '🔒' : '🔓',
    );
    lockBtn.position.set(iconX, (AFFIX_H - iconSize) / 2);
    if (!isLocked) lockBtn.alpha = 0.6; // 열린 자물쇠는 한 톤 낮춰 잠긴 행이 눈에 띄게.
    row.addChild(lockBtn);

    return row;
  }

  /** 슬롯머신 프레임: 잠기지 않은 어픽스 행 문구를 무작위 어픽스 이름으로 덮어쓴다. */
  private renderSpinFrame(): void {
    for (const label of this.spinTexts) {
      if (label === null || label === undefined || label.destroyed) continue;
      const def = AFFIXES[(Math.random() * AFFIXES.length) | 0];
      if (def === undefined) continue;
      label.scale.x = 1;
      label.text = `${def.name} (${def.stat} +?)`;
    }
  }

  private renderActions(): void {
    const back = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: BACK_W,
      height: BACK_H,
      fontSize: 22,
      label: t('common.backToBase'),
      onClick: () => this.close(),
    });
    back.container.position.set((DESIGN_WIDTH - BACK_W) / 2, BACK_Y);
    this.root.addChild(back.container);
    if (this.spinning) back.setEnabled(false);
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const h = new Text({
      resolution: 2,
      text: this.hint,
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: 0xff9a7a, dropShadow: TEXT_SHADOW },
    });
    h.anchor.set(0.5, 1);
    h.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 12);
    this.root.addChild(h);
  }
}
