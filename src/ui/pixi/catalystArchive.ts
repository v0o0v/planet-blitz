/**
 * 촉매 보관함 화면 — Pixi (ADR-0029, Lane 4).
 *
 * 격납고에서 진입하는 **하위 화면**이다(예비역 로스터와 동일 suspend/resume 규약). 보유 촉매를
 * 한 줄씩 나열해 종류·보상/페널티 방향·보유 수량을 보여 주고, 각 행의 [분해] 로 그 촉매를 서버
 * `salvage_catalyst` 로 분해한다(보유 차감 + 재화 지급, 서버 권위 ADR-0027).
 *
 * ## 서버 권위
 * 보유 정본은 `catalyst_inventory`(서버) 다 — 화면은 `fetchCatalystInventoryOnline` 스냅샷만 읽고,
 * 차감·지급은 `salvage_catalyst` 가 한다. 미설정/오프라인이면 빈 보유 + 안내 문구(촉매는 온라인 전용).
 *
 * ## 실측 규칙(예비역 로스터와 동일)
 * - **휠은 클립 Container + hitArea 에**(`makeScrollArea`). - **여백은 `panelContent` 상자 안에만**.
 * - **격납고와는 `show()`/`onClose`** — 격납고가 `suspend()`/`resume()` 로 자리를 주고받는다.
 * - 리스너는 wipe-then-rebuild(`render()` 가 매번 자식 파괴·재생성).
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { saveProfile, type KeyValueStore, type Profile } from '../../save/profile.js';
import {
  CATALYSTS,
  catalystIconFallbackKey,
  catalystIconKey,
  type CatalystDef,
} from '../../data/catalysts.js';
import {
  fetchCatalystInventoryOnline,
  salvageCatalystOnServer,
  type CatalystInventory,
} from '../../net/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeBanner, makeIconButton, makeCurrencyChip } from './titleBar.js';
import { listRowBg } from './listRow.js';
import { makeScrollArea } from './scrollArea.js';

// --- 레이아웃(디자인 스페이스 1920×1080) ---
const BANNER_W = 560;
const BANNER_H = 72;
const BANNER_Y = 10;
const PANEL_X = 460;
const PANEL_Y = 140;
const PANEL_W = 1000;
const PANEL_H = 820;
const BOX = panelContent(PANEL_W, PANEL_H);
const LIST_TOP = BOX.y + 116;
const LIST_AVAIL = BOX.bottom - LIST_TOP;
const ROW_H = 108;
const ROW_GAP = 12;
const SALVAGE_W = 180;
const SALVAGE_H = 52;
const HINT_Y = DESIGN_HEIGHT - 10;

const AXIS_GLYPH: Record<string, string> = {
  drop: 'D',
  rarity: 'R',
  xp: 'X',
  resource: '$',
  catalystDrop: 'C',
  power: 'P',
};

type Filter = 'all' | 'common' | 'signature';

export interface CatalystArchiveCallbacks {
  /** 화면을 닫을 때. 격납고가 `resume()` 하는 자리. */
  onClose: () => void;
}

export class CatalystArchiveScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private cb: CatalystArchiveCallbacks | null = null;
  private ui: UiTextures = {};
  private inventory: CatalystInventory = new Map<number, number>();
  private filter: Filter = 'all';
  private scrollY = 0;
  private hint = '';
  /** 분해 서버 왕복 중 재진입(동시 클릭) 가드. */
  private busy = false;
  private hudPrevVisibility: string | null = null;

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
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

  show(profile: Profile, cb: CatalystArchiveCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.hint = '';
    this.scrollY = 0;
    this.render();
    this.root.visible = true;
    this.raise();
    this.hideRunHud();
    void this.refreshInventory();
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    this.restoreRunHud();
  }

  /** 하네스/테스트가 보유 스냅샷을 직접 주입한다(서버 조회 우회). */
  setCatalystInventory(inv: CatalystInventory): void {
    this.inventory = inv;
    if (this.root.visible) this.render();
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  private close(): void {
    const cb = this.cb;
    this.hide();
    cb?.onClose();
  }

  private hudEl(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return document.getElementById('pb-hud');
  }

  private hideRunHud(): void {
    const hud = this.hudEl();
    if (hud === null) return;
    this.hudPrevVisibility = hud.style.visibility;
    hud.style.visibility = 'hidden';
  }

  private restoreRunHud(): void {
    const hud = this.hudEl();
    if (hud === null || this.hudPrevVisibility === null) return;
    hud.style.visibility = this.hudPrevVisibility;
    this.hudPrevVisibility = null;
  }

  private async refreshInventory(): Promise<void> {
    const inv = await fetchCatalystInventoryOnline();
    if (inv !== null) this.inventory = inv;
    else this.inventory = new Map<number, number>();
    if (this.root.visible) this.render();
  }

  // --- 분해 ----------------------------------------------------------------

  /**
   * 촉매 1개 분해 — 서버 `salvage_catalyst`(보유 차감 + grant_currency). 재화 서버 권위(ADR-0027):
   * 온라인 성공이면 서버 잔액으로 미러를 갱신하고 보유를 재조회한다. rejected/unconfigured 면
   * 안내만(미차감). 동시 클릭 가드(busy)로 과분해를 막는다.
   */
  private async salvageOne(def: CatalystDef): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await salvageCatalystOnServer(def.id, 1);
      if (res.status === 'ok') {
        this.profile.credits = res.creditsLeft;
        this.profile.minerals = res.mineralsLeft;
        saveProfile(this.profile, this.store ?? undefined);
        this.hint = t('catalyst.manage.salvageDone', {
          name: t(`catalyst.${def.slug}.name` as MessageKey),
          credits: res.creditsLeft,
        });
        await this.refreshInventory();
      } else if (res.status === 'unconfigured') {
        this.hint = t('catalyst.manage.offline');
        this.render();
      } else {
        this.hint = t('catalyst.manage.salvageFail');
        this.render();
      }
    } finally {
      this.busy = false;
    }
  }

  // --- 렌더 ----------------------------------------------------------------

  /** 필터를 통과하는 보유 촉매 목록(id 오름차순, owned>0). */
  private ownedList(): { def: CatalystDef; qty: number }[] {
    const out: { def: CatalystDef; qty: number }[] = [];
    for (const def of CATALYSTS) {
      const qty = this.inventory.get(def.id) ?? 0;
      if (qty <= 0) continue;
      if (this.filter === 'common' && def.kind !== 'common') continue;
      if (this.filter === 'signature' && def.kind !== 'signature') continue;
      out.push({ def, qty });
    }
    return out;
  }

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    this.renderTitleBar();
    this.renderPanel();
    this.renderHint();
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('catalyst.manage.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
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
    credits.position.set((DESIGN_WIDTH - BANNER_W) / 2 - chipW - 20, 18);
    this.root.addChild(credits);

    const minerals = makeCurrencyChip(
      chipW,
      chipH,
      String(this.profile.minerals),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_crystal.png'],
    );
    minerals.position.set((DESIGN_WIDTH + BANNER_W) / 2 + 20, 18);
    this.root.addChild(minerals);

    const close = makeIconButton(56, () => this.close(), this.ui['ui_icon_close.png']);
    close.position.set(DESIGN_WIDTH - 24 - 56, 12);
    this.root.addChild(close);
  }

  private renderPanel(): void {
    const panel = new Container();
    panel.position.set(PANEL_X, PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(
      nineSlicePanel(PANEL_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }),
    );

    const title = new Text({
      resolution: 2,
      text: t('catalyst.manage.title'),
      style: { fontFamily: UI_FONT, fontSize: 28, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    title.position.set(BOX.x, BOX.y);
    panel.addChild(title);

    this.renderFilters(panel);

    const list = this.ownedList();
    if (list.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('catalyst.manage.empty'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 20,
          fill: COLOR.muted,
          wordWrap: true,
          wordWrapWidth: BOX.w - 40,
          align: 'center',
          dropShadow: TEXT_SHADOW,
        },
      });
      empty.anchor.set(0.5);
      empty.position.set(PANEL_W / 2, LIST_TOP + LIST_AVAIL / 2);
      panel.addChild(empty);
      return;
    }

    const totalH = list.length * (ROW_H + ROW_GAP) - ROW_GAP;
    const content = makeScrollArea(panel, {
      x: BOX.x,
      y: LIST_TOP,
      w: BOX.w,
      h: LIST_AVAIL,
      totalH,
      get: () => this.scrollY,
      set: (v) => {
        this.scrollY = v;
      },
      thumb: true,
    });

    list.forEach((entry, i) => {
      const row = this.makeRow(entry.def, entry.qty);
      row.position.set(0, i * (ROW_H + ROW_GAP));
      content.addChild(row);
    });
  }

  private renderFilters(panel: Container): void {
    const filters: { id: Filter; label: string }[] = [
      { id: 'all', label: t('catalyst.manage.filterAll') },
      { id: 'common', label: t('catalyst.manage.filterCommon') },
      { id: 'signature', label: t('catalyst.manage.filterSignature') },
    ];
    const w = 150;
    const h = 44;
    const gap = 12;
    filters.forEach((f, i) => {
      const active = this.filter === f.id;
      const btn = new PixiButton({
        texture: this.ui[active ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
        fallbackColor: active ? 0x9a7a2a : 0x4a3a24,
        width: w,
        height: h,
        fontSize: 18,
        ...(active ? { labelColor: COLOR.darkLabel } : {}),
        label: f.label,
        onClick: () => {
          this.filter = f.id;
          this.scrollY = 0;
          this.render();
        },
      });
      btn.container.position.set(BOX.x + i * (w + gap), BOX.y + 52);
      panel.addChild(btn.container);
    });
  }

  private makeRow(def: CatalystDef, qty: number): Container {
    const row = new Container();
    row.addChild(
      listRowBg(BOX.w, ROW_H, def.kind === 'signature' ? { accent: 0x6a5a30 } : {}),
    );

    // 아이콘: 개별 아트 → 보상축 폴백 → 축 토큰 글리프 순(픽커와 같은 사다리).
    const iconTex = this.ui[`${catalystIconKey(def)}.png`] ?? this.ui[`${catalystIconFallbackKey(def)}.png`];
    const iconSize = 56;
    if (iconTex) {
      const sp = new Sprite(iconTex);
      sp.width = iconSize;
      sp.height = iconSize;
      sp.position.set(18, (ROW_H - iconSize) / 2);
      row.addChild(sp);
    } else {
      const token = new Graphics();
      token
        .roundRect(18, (ROW_H - iconSize) / 2, iconSize, iconSize, 8)
        .fill({ color: def.kind === 'signature' ? 0x3a2f18 : 0x2a2440 })
        .stroke({ color: COLOR.muted, width: 2, alignment: 1 });
      row.addChild(token);
      const glyph = new Text({
        resolution: 2,
        text: AXIS_GLYPH[def.reward.axis] ?? '?',
        style: { fontFamily: UI_FONT, fontSize: 28, fontWeight: '800', fill: COLOR.cream },
      });
      glyph.anchor.set(0.5);
      glyph.position.set(18 + iconSize / 2, ROW_H / 2);
      row.addChild(glyph);
    }

    const textX = 18 + iconSize + 16;
    const name = new Text({
      resolution: 2,
      text: `${t(`catalyst.${def.slug}.name` as MessageKey)}  ${t('catalyst.manage.owned', { n: qty })}`,
      style: { fontFamily: UI_FONT, fontSize: 22, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    name.position.set(textX, 16);
    row.addChild(name);

    const info = new Text({
      resolution: 2,
      text: `${t(def.kind === 'signature' ? 'catalyst.kind.signature' : 'catalyst.kind.common')}  ·  ${t(`catalyst.${def.slug}.desc` as MessageKey)}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 16,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: BOX.w - textX - SALVAGE_W - 32,
        lineHeight: 21,
        dropShadow: TEXT_SHADOW,
      },
    });
    info.position.set(textX, 52);
    row.addChild(info);

    const salvage = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x5a3a3a,
      width: SALVAGE_W,
      height: SALVAGE_H,
      fontSize: 18,
      label: t('catalyst.manage.salvage'),
      onClick: () => void this.salvageOne(def),
    });
    salvage.container.position.set(BOX.w - SALVAGE_W - 16, Math.round((ROW_H - SALVAGE_H) / 2));
    row.addChild(salvage.container);

    return row;
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const h = new Text({
      resolution: 2,
      text: this.hint,
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: 0x8affc0, dropShadow: TEXT_SHADOW },
    });
    h.anchor.set(0.5, 1);
    h.position.set(DESIGN_WIDTH / 2, HINT_Y);
    this.root.addChild(h);
  }
}
