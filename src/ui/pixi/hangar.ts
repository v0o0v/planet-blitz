/**
 * 격납고 화면 (Pixi 카툰 리스킨 — plan §4, 격납고 파일럿).
 *
 * `src/ui/inventory.ts` InventoryOverlay(DOM) 와 기능 1:1 동등하게 장비 정비를 Pixi
 * 캔버스(1920×1080 디자인 스페이스, src/render/app.ts)로 재구현한다: 장착/해제(모듈 2슬롯
 * 규칙), 일괄 분해 2종, 창고 확장, 스탯 미리보기(computeLoadoutStats), 툴팁+장착 비교,
 * 재화 표시, i18n, Profile in-place 변이 + saveProfile. 신규(결정 7): 기체 쇼케이스 8슬롯
 * 연결선, 스탯 1줄 설명, 원소 강도/계보/유니크 조건부 행.
 *
 * Profile 을 in-place 로 바꾸고 매 변경마다 저장하므로(InventoryOverlay 와 동일), 다음
 * 런의 로드아웃은 여기서 장착한 결과를 반영한다. 순수 render/UI 레이어(ADR-0005) — sim 은
 * 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { Item, EquipSlotId, SlotKind, Rarity } from '../../items/types.js';
import { EQUIP_SLOTS } from '../../items/types.js';
import { AFFIX_BY_ID } from '../../../data/affixes.js';
import { computeLoadoutStats } from '../../items/loadout.js';
import { UNIQUE_REGISTRY } from '../../items/uniques.js';
import { shipBonusBp } from '../../../data/lineage.js';
import {
  saveProfile,
  activeShip,
  stashCapacity,
  INVENTORY_CAP,
  MAX_STASH_EXPANSIONS,
  type KeyValueStore,
  type Profile,
} from '../../save/profile.js';
import { salvageItems } from '../../save/settlement.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { stashExpansionCost, canAfford } from '../../../data/economy.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, RARITY_COLOR_NUM, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeSlotCell, gridPositions } from './slotGrid.js';
import { PixiTooltip } from './tooltip.js';
import { makeBanner, makeCurrencyChip, makeIconButton } from './titleBar.js';

const SLOT_LABEL_KEY: Record<SlotKind, MessageKey> = {
  main: 'item.slot.main',
  sub: 'item.slot.sub',
  armor: 'item.slot.armor',
  shield: 'item.slot.shield',
  engine: 'item.slot.engine',
  core: 'item.slot.core',
  module: 'item.slot.module',
};

function slotLabel(kind: SlotKind): string {
  return t(SLOT_LABEL_KEY[kind]);
}

const WEAPON_KEY: readonly MessageKey[] = ['item.weapon.0', 'item.weapon.1', 'item.weapon.2'];

function weaponLabel(type: number): string {
  const key = WEAPON_KEY[type];
  return key !== undefined ? t(key) : '?';
}

function slotKindOf(id: EquipSlotId): SlotKind {
  return (id === 'module0' || id === 'module1' ? 'module' : id) as SlotKind;
}

/** 스탯 행 정의: 라벨 · 값 · 1줄 설명(결정 7). */
interface StatRow {
  label: string;
  value: string;
  desc: string;
  color: number;
}

export class HangarScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private hint = '';
  private ui: UiTextures = {};
  private stashScrollY = 0;
  private statsScrollY = 0;
  private inventoryScrollY = 0;

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    this.root.addChild(this.tooltip.container);
    // UI 킷 텍스처를 비동기 로드; 완료 후 열려 있으면 실 아트로 다시 그린다(그 전엔 폴백).
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** 격납고를 연다. `profile` 재바인딩으로 항상 라이브 상태를 반영한다. */
  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.hint = '';
    this.render();
    this.root.visible = true;
    // 툴팁은 최상위로.
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    // DOM HUD(HP/LV, 좌하단)는 런 전용이라 캔버스 격납고 위에 떠 보인다 — 표시 중 숨긴다.
    // (기존 메뉴 화면들은 전면 DOM 오버레이라 자연히 가려졌던 것을 캔버스 화면에서 명시 처리.)
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    this.tooltip.hide();
    this.onClose = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  private persist(): void {
    saveProfile(this.profile, this.store);
  }

  // --- 장착 / 해제 (InventoryOverlay 와 동일 규칙) -------------------------

  private equip(item: Item): void {
    const ship = activeShip(this.profile);
    const kind = item.slot;
    let target: EquipSlotId;
    if (kind === 'module') {
      target =
        ship.equipped.module0 === undefined
          ? 'module0'
          : ship.equipped.module1 === undefined
            ? 'module1'
            : 'module0';
    } else {
      target = kind as EquipSlotId;
    }
    const idx = this.profile.inventory.indexOf(item);
    if (idx >= 0) this.profile.inventory.splice(idx, 1);
    const displaced = ship.equipped[target];
    if (displaced !== undefined) this.profile.inventory.push(displaced);
    ship.equipped[target] = item;
    this.persist();
    this.render();
  }

  private unequip(id: EquipSlotId): void {
    const ship = activeShip(this.profile);
    const item = ship.equipped[id];
    if (item === undefined) return;
    if (this.profile.inventory.length >= INVENTORY_CAP) {
      this.hint = t('inv.err.full');
      this.render();
      return;
    }
    delete ship.equipped[id];
    this.profile.inventory.push(item);
    this.persist();
    this.render();
  }

  // --- 분해 / 창고 ---------------------------------------------------------

  private salvageByRarities(rarities: readonly Rarity[]): void {
    const set = new Set(rarities);
    const targets = this.profile.inventory.filter((it) => set.has(it.rarity));
    if (targets.length === 0) {
      this.hint = t('inv.err.noSalvage');
      this.render();
      return;
    }
    const mineralFindMult = computeLoadoutStats(this.equippedItems()).worldMods.mineralFindMult;
    const y = salvageItems(this.profile, targets, mineralFindMult);
    this.hint = t('inv.salvageDone', { n: targets.length, credits: y.credits, minerals: y.minerals });
    this.persist();
    this.render();
  }

  private expandStash(): void {
    if (this.profile.stashExpansions >= MAX_STASH_EXPANSIONS) {
      this.hint = t('inv.stashMax');
      this.render();
      return;
    }
    const cost = stashExpansionCost(this.profile.stashExpansions);
    if (!canAfford(this.profile.credits, cost)) {
      this.hint = t('inv.err.noCredits', { n: cost });
      this.render();
      return;
    }
    this.profile.credits -= cost;
    this.profile.stashExpansions++;
    this.hint = t('inv.stashExpanded');
    this.persist();
    this.render();
  }

  private equippedItems(): Item[] {
    const ship = activeShip(this.profile);
    const out: Item[] = [];
    for (const id of EQUIP_SLOTS) {
      const it = ship.equipped[id];
      if (it !== undefined) out.push(it);
    }
    return out;
  }

  private equippedFor(kind: SlotKind): Item | undefined {
    const ship = activeShip(this.profile);
    if (kind === 'module') return ship.equipped.module0 ?? ship.equipped.module1;
    return ship.equipped[kind as EquipSlotId];
  }

  private itemName(item: Item): string {
    if (item.slot === 'main' && item.weaponType !== undefined) {
      return `${t('item.slot.main')} · ${weaponLabel(item.weaponType)}`;
    }
    return slotLabel(item.slot);
  }

  // --- 툴팁 ----------------------------------------------------------------

  private showTip(item: Item, globalX: number, globalY: number, compareTo?: Item): void {
    const lines: string[] = [];
    for (const a of item.affixes) {
      const def = AFFIX_BY_ID.get(a.id);
      lines.push(def !== undefined ? `${def.name} (${a.stat} +${a.value})` : `${a.stat} +${a.value}`);
    }
    const compare =
      compareTo !== undefined && compareTo !== item
        ? t('inv.tip.compare', { name: this.itemName(compareTo), n: compareTo.affixes.length })
        : undefined;
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.show(
      {
        title: this.itemName(item),
        titleColor: RARITY_COLOR_NUM[item.rarity],
        subtitle: `${slotLabel(item.slot)} · ${t(`item.rarity.${item.rarity}` as MessageKey)}`,
        lines,
        compare,
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
    // 툴팁 컨테이너는 유지하고 나머지를 지운다.
    for (const child of [...this.root.children]) {
      if (child !== this.tooltip.container) {
        this.root.removeChild(child);
        child.destroy({ children: true });
      }
    }
    this.tooltip.hide();

    // 배경(불투명 — 뒤 아레나를 가린다).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChildAt(bg, 0);

    this.renderTitleBar();
    this.renderStatsPanel();
    this.renderShowcasePanel();
    this.renderStashPanel();
    this.renderInventoryPanel();
    this.renderHint();

    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private renderTitleBar(): void {
    const bannerW = 760;
    const bannerH = 72;
    const banner = makeBanner(bannerW, bannerH, t('hangar.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - bannerW) / 2, 8);
    this.root.addChild(banner);

    const chipW = 190;
    const chipH = 52;
    const credits = makeCurrencyChip(
      chipW,
      chipH,
      String(this.profile.credits),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_coin.png'],
    );
    credits.position.set((DESIGN_WIDTH - bannerW) / 2 - chipW - 20, 18);
    this.root.addChild(credits);

    const minerals = makeCurrencyChip(
      chipW,
      chipH,
      String(this.profile.minerals),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_crystal.png'],
    );
    minerals.position.set((DESIGN_WIDTH + bannerW) / 2 + 20, 18);
    this.root.addChild(minerals);

    const close = makeIconButton(
      56,
      () => {
        const cb = this.onClose;
        this.hide();
        cb?.();
      },
      this.ui['ui_icon_close.png'],
    );
    close.position.set(DESIGN_WIDTH - 24 - 56, 12);
    this.root.addChild(close);
  }

  private statRows(): StatRow[] {
    const { loadout, worldMods } = computeLoadoutStats(this.equippedItems());
    const rows: StatRow[] = [
      { label: t('inv.stat.weapon'), value: t(WEAPON_KEY[loadout.weaponType] ?? 'item.weapon.0'), desc: t('hangar.desc.weapon'), color: COLOR.gold },
      { label: t('inv.stat.damage'), value: `×${loadout.damageMult.toFixed(2)}`, desc: t('hangar.desc.damage'), color: COLOR.gold },
      { label: t('inv.stat.fireRate'), value: `×${(1 / loadout.fireRateMult).toFixed(2)}`, desc: t('hangar.desc.fireRate'), color: COLOR.gold },
      { label: t('inv.stat.bullets'), value: `+${loadout.bulletCountAdd}`, desc: t('hangar.desc.bullets'), color: COLOR.gold },
      { label: t('inv.stat.pierce'), value: `+${loadout.pierceAdd}`, desc: t('hangar.desc.pierce'), color: COLOR.gold },
      { label: t('inv.stat.moveSpeed'), value: `×${loadout.moveSpeedMult.toFixed(2)}`, desc: t('hangar.desc.moveSpeed'), color: COLOR.gold },
      { label: t('inv.stat.hp'), value: `+${loadout.maxHpAdd}`, desc: t('hangar.desc.hp'), color: COLOR.gold },
      { label: t('inv.stat.magnet'), value: `×${loadout.magnetMult.toFixed(2)}`, desc: t('hangar.desc.magnet'), color: COLOR.gold },
      { label: t('inv.stat.xp'), value: `×${loadout.xpMult.toFixed(2)}`, desc: t('hangar.desc.xp'), color: COLOR.gold },
      { label: t('inv.stat.mineralFind'), value: `×${worldMods.mineralFindMult.toFixed(2)}`, desc: t('hangar.desc.mineralFind'), color: COLOR.gold },
    ];
    // 원소 강도(0 이면 숨김) — 원소색.
    if (loadout.fireDmg > 0)
      rows.push({ label: t('hangar.stat.element.fire'), value: `+${loadout.fireDmg}`, desc: t('hangar.desc.element.fire'), color: 0xff783c });
    if (loadout.coldSlow > 0)
      rows.push({ label: t('hangar.stat.element.cold'), value: `+${loadout.coldSlow}`, desc: t('hangar.desc.element.cold'), color: 0x6ebeff });
    if (loadout.lightning > 0)
      rows.push({ label: t('hangar.stat.element.lightning'), value: `+${loadout.lightning}`, desc: t('hangar.desc.element.lightning'), color: 0xffe033 });
    // 계보 기체 보너스(0 이면 숨김).
    const bp = shipBonusBp(this.profile.lineage);
    if (bp > 0)
      rows.push({ label: t('hangar.stat.lineage'), value: `+${(bp / 100).toFixed(1)}%`, desc: t('hangar.desc.lineage'), color: 0x8affc0 });
    // 유니크 효과(장착 유니크별 1행).
    for (const it of this.equippedItems()) {
      if (it.uniqueId === undefined) continue;
      const def = UNIQUE_REGISTRY.get(it.uniqueId);
      if (def !== undefined)
        rows.push({ label: t('hangar.stat.unique'), value: def.name, desc: '', color: RARITY_COLOR_NUM.unique });
    }
    return rows;
  }

  private renderStatsPanel(): void {
    const px = 24;
    const py = 96;
    const pw = 900;
    const ph = 512;
    const box = panelContent(pw, ph);
    const panel = nineSlicePanel(pw, ph, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER });
    panel.position.set(px, py);
    this.root.addChild(panel);

    const title = new Text({ resolution: 2,
      text: t('hangar.panel.stats'),
      style: { fontFamily: UI_FONT, fontSize: 32, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    title.position.set(px + box.x, py + box.y);
    this.root.addChild(title);

    // 스크롤 가능한 스탯 콘텐츠(마스크 클립 + 휠). 스크롤바 시각 요소 없음. 결함 #3 수정:
    // 콘텐츠 top 을 제목 바로 아래로 당기고 행 간격/폰트를 줄여 기본 10행+설명이 스크롤 없이
    // 최대한 보이도록 한다(넘치는 원소/계보/유니크 조건부 행만 스크롤로).
    const contentX = px + box.x;
    const contentTop = py + 104; // 제목(60..92) 아래
    const contentW = box.w;
    // 마스크 하한 = 콘텐츠 상자 바닥(프레임 + 여백) — 프레임 침범도 붙는 것도 막는다.
    const STAT_STEP = 48;
    const contentH = Math.floor((box.bottom - 104) / STAT_STEP) * STAT_STEP; // 행 단위 클램프

    const clip = new Container();
    clip.position.set(contentX, contentTop);
    this.root.addChild(clip);
    const mask = new Graphics();
    mask.rect(contentX, contentTop, contentW, contentH).fill({ color: 0xffffff });
    this.root.addChild(mask);
    clip.mask = mask;

    const content = new Container();
    clip.addChild(content);

    const rows = this.statRows();
    const step = STAT_STEP;
    let y = 0;
    for (const r of rows) {
      const name = new Text({ resolution: 2,
        text: r.label,
        style: { fontFamily: UI_FONT, fontSize: 24, fontWeight: '700', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      name.position.set(0, y);
      content.addChild(name);
      const val = new Text({ resolution: 2,
        text: r.value,
        style: { fontFamily: UI_FONT, fontSize: 24, fontWeight: '800', fill: r.color, dropShadow: TEXT_SHADOW },
      });
      val.position.set(440, y);
      content.addChild(val);
      if (r.desc !== '') {
        const desc = new Text({ resolution: 2,
          text: r.desc,
          style: { fontFamily: UI_FONT, fontSize: 15, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
        });
        desc.position.set(0, y + 27);
        content.addChild(desc);
      }
      y += step;
    }

    const total = y;
    const maxScroll = Math.max(0, total - contentH);
    this.statsScrollY = Math.min(this.statsScrollY, maxScroll);
    content.y = -this.statsScrollY;

    if (maxScroll > 0) {
      mask.eventMode = 'static';
      mask.on('wheel', (e) => {
        this.statsScrollY = Math.max(0, Math.min(maxScroll, this.statsScrollY + e.deltaY));
        content.y = -this.statsScrollY;
      });
    }
  }

  private renderShowcasePanel(): void {
    const px = 944;
    const py = 96;
    const pw = 952;
    const ph = 512;
    const box = panelContent(pw, ph);
    const panel = nineSlicePanel(pw, ph, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER });
    panel.position.set(px, py);
    this.root.addChild(panel);

    const ship = activeShip(this.profile);
    const title = new Text({ resolution: 2,
      text: `${ship.name} · Lv ${ship.level}`,
      style: { fontFamily: UI_FONT, fontSize: 30, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    title.anchor.set(0.5, 0);
    title.position.set(px + pw / 2, py + box.y);
    this.root.addChild(title);

    // 기체 일러스트(×2 nearest). 중앙.
    const shipCx = px + pw / 2;
    const shipCy = py + ph / 2 + 20;
    const shipTex = this.ui['ship_showcase_fighter.png'];
    if (shipTex) {
      const sp = new Sprite(shipTex);
      sp.anchor.set(0.5);
      sp.width = 256;
      sp.height = 256;
      sp.position.set(shipCx, shipCy);
      this.root.addChild(sp);
    } else {
      const g = new Graphics();
      g.moveTo(shipCx, shipCy - 90)
        .lineTo(shipCx + 70, shipCy + 80)
        .lineTo(shipCx - 70, shipCy + 80)
        .closePath()
        .fill({ color: 0x39d0ff })
        .stroke({ color: 0xffffff, width: 3 });
      this.root.addChild(g);
    }

    // 장착 8슬롯: 좌 4 / 우 4 컬럼, y 간격 100. 라벨은 슬롯 바깥쪽.
    const slotSize = 72;
    // 바깥쪽 라벨(최대 ~90px)이 콘텐츠 상자(box.x=60) 안에 들어오도록 컬럼을 안쪽으로.
    const labelGutter = 90 + 12;
    const leftX = px + box.x + labelGutter;
    const rightX = px + box.right - labelGutter - slotSize;
    const colTop = py + 140;
    // 4행째(실드/모듈2) 하단이 콘텐츠 상자 바닥(py+box.bottom) 안에 들어오는 간격을 역산한다.
    const colStep = Math.floor((box.bottom - 140 - slotSize) / 3);

    // 연결선 레이어(슬롯보다 아래).
    const lines = new Graphics();
    this.root.addChild(lines);

    EQUIP_SLOTS.forEach((id, i) => {
      const left = i < 4;
      const col = left ? 0 : 1;
      const row = i % 4;
      const sx = left ? leftX : rightX;
      const sy = colTop + row * colStep;
      const item = ship.equipped[id];

      // 연결선(슬롯 중심 → 기체 중심 부근).
      const partY = shipCy - 60 + row * 40;
      const partX = shipCx + (left ? -40 : 40);
      lines
        .moveTo(sx + slotSize / 2, sy + slotSize / 2)
        .lineTo(partX, partY)
        .stroke({ color: COLOR.connector, width: 3, alpha: 0.59 });

      const cell = makeSlotCell({
        size: slotSize,
        item,
        slotTex: this.ui[item !== undefined ? 'ui_slot_hl.png' : 'ui_slot.png'],
        highlight: item !== undefined,
        highlightTex: this.ui['ui_slot_hl.png'],
        onClick: item !== undefined ? () => this.unequip(id) : undefined,
        onHover: item !== undefined ? (gx, gy) => this.showTip(item, gx, gy) : undefined,
        onMove: (gx, gy) => this.moveTip(gx, gy),
        onOut: () => this.tooltip.hide(),
      });
      cell.position.set(sx, sy);
      this.root.addChild(cell);

      // 라벨: 좌 컬럼은 슬롯 왼쪽(anchor 오른쪽), 우 컬럼은 슬롯 오른쪽(anchor 왼쪽).
      const labelText =
        id === 'module0' ? t('inv.module1') : id === 'module1' ? t('inv.module2') : slotLabel(slotKindOf(id));
      const label = new Text({ resolution: 2,
        text: labelText,
        style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      label.anchor.set(col === 0 ? 1 : 0, 0.5);
      label.position.set(col === 0 ? sx - 12 : sx + slotSize + 12, sy + slotSize / 2);
      this.root.addChild(label);
    });
  }

  private renderStashPanel(): void {
    const px = 24;
    const py = 652;
    const pw = 900;
    const ph = 404;
    const box = panelContent(pw, ph);
    const panel = nineSlicePanel(pw, ph, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER });
    panel.position.set(px, py);
    this.root.addChild(panel);

    const cap = stashCapacity(this.profile.stashExpansions);
    const title = new Text({ resolution: 2,
      text: t('inv.stashHeader', { n: this.profile.stash.length, cap }),
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    title.position.set(px + box.x, py + box.y);
    this.root.addChild(title);

    // 창고 확장 버튼(파랑) — 패널 우상단.
    const nextCost = stashExpansionCost(this.profile.stashExpansions);
    const maxed = this.profile.stashExpansions >= MAX_STASH_EXPANSIONS;
    const expandBtn = new PixiButton({
      texture: this.ui['ui_btn_blue.png'],
      fallbackColor: 0x2a5a9a,
      width: 260,
      height: 48,
      fontSize: 18,
      label: maxed ? t('inv.act.expandMax') : t('inv.act.expand', { n: nextCost }),
      onClick: () => this.expandStash(),
    });
    expandBtn.container.position.set(px + box.right - 260, py + box.y);
    this.root.addChild(expandBtn.container);
    if (maxed || !canAfford(this.profile.credits, nextCost)) expandBtn.setEnabled(false);

    // 스크롤 그리드(마스크 클립 + 휠, 스크롤바 없음).
    const contentX = px + box.x;
    const contentTop = py + 118; // 제목/확장 버튼(60..108) 아래
    const contentW = box.w;
    const cell = 66;
    const gap = 8;
    // 마스크 하한 = 콘텐츠 상자 바닥, 셀 행 배수로 클램프(반토막 셀 금지).
    const contentH = Math.floor((box.bottom - 118 + gap) / (cell + gap)) * (cell + gap) - gap;
    const cols = Math.max(1, Math.floor((contentW + gap) / (cell + gap)));

    const clip = new Container();
    clip.position.set(contentX, contentTop);
    this.root.addChild(clip);
    const mask = new Graphics();
    mask.rect(contentX, contentTop, contentW, contentH).fill({ color: 0xffffff });
    this.root.addChild(mask);
    clip.mask = mask;

    const content = new Container();
    clip.addChild(content);

    const positions = gridPositions(cap, cols, cell, gap);
    for (let i = 0; i < cap; i++) {
      const item = this.profile.stash[i];
      const c = makeSlotCell({
        size: cell,
        item,
        slotTex: this.ui['ui_slot.png'],
        onHover: item !== undefined ? (gx, gy) => this.showTip(item, gx, gy) : undefined,
        onMove: (gx, gy) => this.moveTip(gx, gy),
        onOut: () => this.tooltip.hide(),
      });
      const pos = positions[i];
      if (pos !== undefined) c.position.set(pos.x, pos.y);
      content.addChild(c);
    }

    const rows = Math.ceil(cap / cols);
    const total = rows * (cell + gap);
    const maxScroll = Math.max(0, total - contentH);
    this.stashScrollY = Math.min(this.stashScrollY, maxScroll);
    content.y = -this.stashScrollY;
    if (maxScroll > 0) {
      mask.eventMode = 'static';
      mask.on('wheel', (e) => {
        this.stashScrollY = Math.max(0, Math.min(maxScroll, this.stashScrollY + e.deltaY));
        content.y = -this.stashScrollY;
      });
    }
  }

  private renderInventoryPanel(): void {
    const px = 944;
    const py = 652;
    const pw = 952;
    const ph = 404;
    const box = panelContent(pw, ph);
    const panel = nineSlicePanel(pw, ph, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER });
    panel.position.set(px, py);
    this.root.addChild(panel);

    const title = new Text({ resolution: 2,
      text: t('inv.invHeader', { n: this.profile.inventory.length, cap: INVENTORY_CAP }),
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    title.position.set(px + box.x, py + box.y);
    this.root.addChild(title);

    // 일괄 분해 버튼 2종(빨강) — 패널 우상단 나란히.
    const bw = 210;
    const bh = 48;
    const salvageHigh = new PixiButton({
      texture: this.ui['ui_btn_red.png'],
      fallbackColor: 0x9a2a2a,
      width: bw,
      height: bh,
      fontSize: 16,
      label: t('inv.act.salvageHigh'),
      onClick: () => this.salvageByRarities(['rare', 'unique']),
    });
    salvageHigh.container.position.set(px + box.right - bw, py + box.y);
    this.root.addChild(salvageHigh.container);

    const salvageLow = new PixiButton({
      texture: this.ui['ui_btn_red.png'],
      fallbackColor: 0x9a2a2a,
      width: bw,
      height: bh,
      fontSize: 16,
      label: t('inv.act.salvageLow'),
      onClick: () => this.salvageByRarities(['normal', 'magic']),
    });
    salvageLow.container.position.set(px + box.right - bw * 2 - 12, py + box.y);
    this.root.addChild(salvageLow.container);

    // 8열 그리드(48칸) — 창고와 동일하게 마스크 클립 + 휠 스크롤(패널 프레임 침범 0,
    // 스크롤바 시각 요소 없음). 48칸(6행)이 패널 안쪽 높이를 넘치므로 필수(결함 #2 수정).
    const contentX = px + box.x;
    const contentTop = py + 118; // 제목/일괄 분해 버튼(60..108) 아래
    const contentW = box.w;
    const cols = 8;
    const cell = 66;
    const gap = 8;
    // 마스크 하한 = 콘텐츠 상자 바닥, 셀 행 배수로 클램프(반토막 셀 금지).
    const contentH = Math.floor((box.bottom - 118 + gap) / (cell + gap)) * (cell + gap) - gap;

    const clip = new Container();
    clip.position.set(contentX, contentTop);
    this.root.addChild(clip);
    const mask = new Graphics();
    mask.rect(contentX, contentTop, contentW, contentH).fill({ color: 0xffffff });
    this.root.addChild(mask);
    clip.mask = mask;

    const content = new Container();
    clip.addChild(content);

    const positions = gridPositions(INVENTORY_CAP, cols, cell, gap);
    for (let i = 0; i < INVENTORY_CAP; i++) {
      const item = this.profile.inventory[i];
      const compareTo = item !== undefined ? this.equippedFor(item.slot) : undefined;
      const c = makeSlotCell({
        size: cell,
        item,
        slotTex: this.ui['ui_slot.png'],
        onClick: item !== undefined ? () => this.equip(item) : undefined,
        onHover: item !== undefined ? (gx, gy) => this.showTip(item, gx, gy, compareTo) : undefined,
        onMove: (gx, gy) => this.moveTip(gx, gy),
        onOut: () => this.tooltip.hide(),
      });
      const pos = positions[i];
      if (pos !== undefined) c.position.set(pos.x, pos.y);
      content.addChild(c);
    }

    const rows = Math.ceil(INVENTORY_CAP / cols);
    const total = rows * (cell + gap);
    const maxScroll = Math.max(0, total - contentH);
    this.inventoryScrollY = Math.min(this.inventoryScrollY, maxScroll);
    content.y = -this.inventoryScrollY;
    if (maxScroll > 0) {
      mask.eventMode = 'static';
      mask.on('wheel', (e) => {
        this.inventoryScrollY = Math.max(0, Math.min(maxScroll, this.inventoryScrollY + e.deltaY));
        content.y = -this.inventoryScrollY;
      });
    }
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const t2 = new Text({ resolution: 2,
      text: this.hint,
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: 0xff9a7a, dropShadow: TEXT_SHADOW },
    });
    t2.anchor.set(0.5, 1);
    t2.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 8);
    this.root.addChild(t2);
  }
}
