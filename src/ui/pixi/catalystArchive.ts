/**
 * 촉매 보관함 화면 — Pixi (ADR-0029, Lane 4).
 *
 * 격납고에서 진입하는 **하위 화면**이다(예비역 로스터와 동일 suspend/resume 규약). ADR-0042 로
 * 이 화면이 **촉매 상점을 겸한다** — 48종 전 카탈로그를 한 줄씩 나열하고, 한 행에서 [분해]
 * (→ 촉매 잔재)와 [구매](← 촉매 잔재)를 모두 처리한다. 공용 30종만 판매되고 특산 18종은
 * 분해만 된다.
 *
 * ## 서버 권위
 * 보유 정본은 `catalyst_inventory`(서버), 잔재 정본은 `profiles.catalyst_residue`(서버) 다 —
 * 화면은 스냅샷만 읽고 차감·가산은 `salvage_catalyst`·`buy_catalyst` 가 한다. **크레딧·광물은
 * 이 화면에서 더 이상 변하지 않는다**(잔재는 `grant_currency` 캡 파이프를 타지 않는다).
 * 미설정/오프라인이면 목록은 그리되 분해·구매·스테퍼를 전량 잠그고 안내 문구를 낸다.
 *
 * ## 재렌더 규율
 * `render()` 는 루트 자식을 전부 파괴·재생성하고 48행을 전량 addChild 한다(가상화 없음).
 * `Text` 가 `resolution: 2` 라 인스턴스마다 텍스처 업로드가 나므로, **수량 스테퍼는 해당 행의
 * `Text.text` 와 버튼 활성만 갈아끼우고 `render()` 를 부르지 않는다**(`rowRefs`).
 * `render()` 는 서버 왕복·필터 변경에만.
 *
 * ## 실측 규칙(예비역 로스터와 동일)
 * - **휠은 클립 Container + hitArea 에**(`makeScrollArea`). - **여백은 `panelContent` 상자 안에만**.
 * - **격납고와는 `show()`/`onClose`** — 격납고가 `suspend()`/`resume()` 로 자리를 주고받는다.
 * - 리스너는 wipe-then-rebuild(`render()` 가 매번 자식 파괴·재생성).
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { KeyValueStore, Profile } from '../../save/profile.js';
import {
  CATALYSTS,
  catalystIconFallbackKey,
  catalystIconKey,
  type CatalystDef,
} from '../../data/catalysts.js';
import {
  fetchCatalystInventoryOnline,
  fetchCatalystResidueOnline,
  salvageCatalystOnServer,
  buyCatalystOnServer,
  type CatalystInventory,
} from '../../net/index.js';
import {
  clampQty,
  salvageQty,
  salvageLabel,
  salvageEnabled,
  buyEnabled,
  buyRejectKey,
  salvageRejectKey,
  rowNoteText,
  noteLayout,
  QTY_MIN,
  ROW_H,
  ROW_CTRL_W,
  INFO_Y,
  INFO_LINE_H,
  NOTE_LINE_H,
  type CatalystRowShopState,
} from './catalystShopView.js';
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
// ⚠️ `ROW_H`(136)·`ROW_CTRL_W`(220)은 계획 §5 확정 수치이고, **하단 문구 배치 산술이 그 값을
// 써야 하므로** 순수 모듈(`catalystShopView`)에 정본을 두고 여기서 가져온다.
const ROW_GAP = 12;
/** 컨트롤 우측 여백. */
const ROW_CTRL_PAD = 16;
/** [분해][구매] 사이 간격. */
const ROW_BTN_GAP = 10;
/** 버튼 폭 — 하드코딩 금지, ROW_CTRL_W 파생. */
const ROW_BTN_W = (ROW_CTRL_W - ROW_BTN_GAP) / 2;
const ROW_BTN_H = 52;
/** 스테퍼(− n +) 한 단의 높이 = ± 버튼 한 변. */
const STEP_H = 44;
/** 하단 문구 높이를 못 잰 경우(캔버스 없는 환경)의 안전 y — 1줄 기준 상단. */
const NOTE_FALLBACK_Y = ROW_H - 24;
/** 스테퍼 상단 여백 / 스테퍼와 버튼 줄 사이 간격. */
const STEP_Y = 14;
const ROW_BTN_Y = STEP_Y + STEP_H + 12;
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
  private cb: CatalystArchiveCallbacks | null = null;
  private ui: UiTextures = {};
  private inventory: CatalystInventory = new Map<number, number>();
  private filter: Filter = 'all';
  private scrollY = 0;
  private hint = '';
  /** 분해 서버 왕복 중 재진입(동시 클릭) 가드. */
  private busy = false;
  private hudPrevVisibility: string | null = null;
  /**
   * 촉매 잔재 잔고(ADR-0042). `null` = 아직 못 읽음 — 0 과 구분해야 `catalyst.shop.noProfile`
   * 안내가 성립한다(신규 가입 직후 창에서 서버가 실제로 `no-profile` 을 낸다).
   */
  private residue: number | null = null;
  /** 서버 왕복이 가능한 세션인가(미설정/오프라인이면 false — 버튼 전량 비활성). */
  private online = false;
  /** 행별 스테퍼 수량(분해·구매 공용). 미지정은 QTY_MIN. */
  private readonly qtyById = new Map<number, number>();
  /**
   * 행 로컬 갱신 핸들(재렌더 규율, 계획 §5 HIGH-3). 48행 전량 addChild + `resolution: 2` Text 라
   * 스테퍼 한 번에 `render()` 를 부르면 텍스처 업로드가 통째로 다시 난다. 스테퍼는 이 핸들로
   * **해당 행의 Text.text 와 버튼 활성만** 갈아끼운다. `render()` 는 서버 왕복·필터 변경에만.
   */
  private readonly rowRefs = new Map<number, () => void>();

  /**
   * `store` 는 더 이상 쓰이지 않는다(ADR-0042: 분해가 재화 미러를 갱신하지 않으므로 로컬 세이브
   * 기록이 없다). 호출부 배선을 깨지 않기 위해 인자는 남긴다.
   */
  constructor(profile: Profile, stage: Container, _store: KeyValueStore | null = null) {
    this.profile = profile;
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
    // 조회가 null = 미설정/구버전/오류 → 오프라인 세션. 목록은 그리되 버튼을 전량 잠근다.
    this.online = inv !== null;
    this.inventory = inv ?? new Map<number, number>();
    this.residue = this.online ? await fetchCatalystResidueOnline() : null;
    if (this.root.visible) this.render();
  }

  /** 이 행의 스테퍼 수량(미지정은 QTY_MIN). */
  private qtyOf(id: number): number {
    return clampQty(this.qtyById.get(id) ?? QTY_MIN);
  }

  /** 이 행의 순수 판정 입력. 표시·활성 판정은 전부 `catalystShopView` 가 한다. */
  private rowState(def: CatalystDef): CatalystRowShopState {
    return {
      id: def.id,
      owned: this.inventory.get(def.id) ?? 0,
      qty: this.qtyOf(def.id),
      residue: this.residue,
      online: this.online,
    };
  }

  // --- 분해 · 구매 ----------------------------------------------------------

  /**
   * 촉매 분해(ADR-0042) — 서버 `salvage_catalyst` 가 보유를 차감하고 **촉매 잔재**를 지급한다.
   * 크레딧·광물은 이 경로에서 더 이상 변하지 않으므로 재화 미러를 만지지 않는다(옛 코드가
   * `res.creditsLeft` 를 저장하던 자리 — 반환에서 사라진 필드라 `undefined` 가 흘렀을 것이다).
   * rejected/unconfigured 면 안내만(미차감). 동시 클릭 가드(busy)로 과분해를 막는다.
   */
  private async salvageOne(def: CatalystDef): Promise<void> {
    if (this.busy) return;
    const n = salvageQty(this.rowState(def));
    if (n <= 0) return;
    this.busy = true;
    try {
      const res = await salvageCatalystOnServer(def.id, n);
      if (res.status === 'ok') {
        this.residue = res.residue;
        this.hint = t('catalyst.manage.salvageDone', {
          name: t(`catalyst.${def.slug}.name` as MessageKey),
          residue: res.gained,
        });
        await this.refreshInventory();
      } else if (res.status === 'unconfigured') {
        this.hint = t('catalyst.shop.offline');
        this.render();
      } else {
        this.hint = t(salvageRejectKey(res.note));
        this.render();
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * 촉매 구매(ADR-0042) — 서버 `buy_catalyst` 가 잔재를 차감하고 보유 원장에 얹는다. 가격은
   * 클라가 보내지 않는다(서버가 시드된 `catalyst_defs.buy_price` 를 조회). 거부는 서버 `note` 를
   * 그대로 문구로 옮긴다 — 특히 `no-profile` 을 흘리면 원인 불명 무반응이 된다.
   */
  private async buyOne(def: CatalystDef): Promise<void> {
    if (this.busy) return;
    const n = this.qtyOf(def.id);
    this.busy = true;
    try {
      const res = await buyCatalystOnServer(def.id, n);
      if (res.status === 'ok') {
        this.residue = res.residue;
        this.hint = `${t(`catalyst.${def.slug}.name` as MessageKey)}  ·  −${t('catalyst.shop.price', { n: res.spent })}`;
        await this.refreshInventory();
      } else if (res.status === 'unconfigured') {
        this.hint = t('catalyst.shop.offline');
        this.render();
      } else {
        this.hint = t(buyRejectKey(res.note));
        this.render();
      }
    } finally {
      this.busy = false;
    }
  }

  // --- 렌더 ----------------------------------------------------------------

  /**
   * 필터를 통과하는 **전 카탈로그**(id 오름차순). ADR-0042 이후 촉매 보관함은 상점을 겸하므로
   * 미보유 행도 그린다 — 보유분만 그리면 CONTEXT.md 의 "상시 전 카탈로그가 진열"과 어긋나고,
   * 신규 플레이어에게 `signature` 필터 탭이 통째로 빈 목록이 된다.
   */
  private visibleList(): { def: CatalystDef; qty: number }[] {
    const out: { def: CatalystDef; qty: number }[] = [];
    for (const def of CATALYSTS) {
      if (this.filter === 'common' && def.kind !== 'common') continue;
      if (this.filter === 'signature' && def.kind !== 'signature') continue;
      out.push({ def, qty: this.inventory.get(def.id) ?? 0 });
    }
    return out;
  }

  private render(): void {
    this.rowRefs.clear();
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

    // 촉매 잔재 칩(ADR-0042) — **이 화면에만** 둔다. 잔재는 촉매 밖에서 가치가 0이므로 전 화면
    // 상단 재화 칩(크레딧·광물)에 3번째로 올리지 않는다. 아이콘은 있으면 쓰고 없으면 생략한다
    // (아이콘 자산이 아직 없어도 칩은 값만으로 성립한다).
    // 키는 `UI_ASSET_NAMES` 의 등재명과 **정확히** 같아야 한다 — 어긋나면 폴백이 null 이라
    // 에러 없이 조용히 아이콘만 사라진다.
    const residueIcon = this.ui['catalyst_residue.png'] ?? null;
    const residue = makeCurrencyChip(
      chipW,
      chipH,
      this.residue === null ? '—' : String(this.residue),
      this.ui['ui_chip.png'],
      residueIcon,
    );
    residue.position.set((DESIGN_WIDTH + BANNER_W) / 2 + 20 + chipW + 20, 18);
    this.root.addChild(residue);

    const residueLabel = new Text({
      resolution: 2,
      text: t('catalyst.residue.name'),
      style: { fontFamily: UI_FONT, fontSize: 14, fontWeight: '700', fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    residueLabel.position.set(residue.position.x + 4, 18 + chipH + 2);
    this.root.addChild(residueLabel);

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

    const list = this.visibleList();
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
        // 우측 컨트롤 폭 파생 — SALVAGE_W 만 빼던 옛 식으로는 구매 버튼을 얹는 순간 글자가
        // 버튼 밑으로 들어간다.
        wordWrapWidth: BOX.w - textX - ROW_CTRL_W - 32,
        // ⚠️ y·lineHeight 를 여기서 직접 정하지 않는다 — 하단 문구의 세로 예산이 이 값들에서
        // 파생되므로, 둘이 서로를 모르는 채 각자 고정되면 줄 수가 늘 때 조용히 겹친다.
        lineHeight: INFO_LINE_H,
        dropShadow: TEXT_SHADOW,
      },
    });
    info.position.set(textX, INFO_Y);
    row.addChild(info);

    // 행 하단 한 줄: 분해 획득량 · 구매가 · 거부 사유. 스테퍼로 수량이 바뀌면 이 Text 만 갈린다.
    const note = new Text({
      resolution: 2,
      text: rowNoteText(this.rowState(def)),
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: BOX.w - textX - ROW_CTRL_W - 32,
        lineHeight: NOTE_LINE_H,
        dropShadow: TEXT_SHADOW,
      },
    });
    row.addChild(note);
    /**
     * 문구는 줄 수가 런타임에 변한다(사유가 붙으면 2줄). 고정 y 로 두면 둘째 줄이 행 테두리
     * 밖으로 잘리므로 **실측 높이로 하단 정렬**한다. 배치 산술은 순수 헬퍼가 하고, 캔버스 없는
     * 환경에서 `Text.height` 접근이 던지면 상단 기준으로 안전 폴백한다.
     */
    const placeNote = (): void => {
      let h = 0;
      try {
        h = note.height;
      } catch {
        h = 0;
      }
      const box = noteLayout(h);
      note.scale.set(box.scale);
      note.position.set(textX, h > 0 ? box.y : NOTE_FALLBACK_Y);
    };
    placeNote();

    // --- 우측 컨트롤(세로 2단: 스테퍼 / [분해][구매]) ---
    const ctrlX = BOX.w - ROW_CTRL_W - ROW_CTRL_PAD;

    const qtyText = new Text({
      resolution: 2,
      text: String(this.qtyOf(def.id)),
      style: { fontFamily: UI_FONT, fontSize: 22, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    qtyText.anchor.set(0.5);
    qtyText.position.set(ctrlX + ROW_CTRL_W / 2, STEP_Y + STEP_H / 2);
    row.addChild(qtyText);

    const salvage = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x5a3a3a,
      width: ROW_BTN_W,
      height: ROW_BTN_H,
      fontSize: 16,
      label: salvageLabel(this.rowState(def)),
      onClick: () => void this.salvageOne(def),
    });
    salvage.container.position.set(ctrlX, ROW_BTN_Y);
    row.addChild(salvage.container);

    const buy = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      labelColor: COLOR.darkLabel,
      width: ROW_BTN_W,
      height: ROW_BTN_H,
      fontSize: 17,
      label: t('catalyst.shop.buy'),
      onClick: () => void this.buyOne(def),
    });
    buy.container.position.set(ctrlX + ROW_BTN_W + ROW_BTN_GAP, ROW_BTN_Y);
    row.addChild(buy.container);

    /** 행 로컬 갱신 — `render()` 를 부르지 않고 텍스트·활성만 갈아끼운다(재렌더 규율). */
    const sync = (): void => {
      const s = this.rowState(def);
      qtyText.text = String(s.qty);
      note.text = rowNoteText(s);
      // 문구가 갈리면 줄 수도 갈린다 — 갈아끼운 **뒤에** 다시 배치해야 넘침이 안 생긴다.
      placeNote();
      // 라벨도 수량을 반영한다(고정 "1개 분해" 는 실제 3개 분해와 모순돼 오조작을 부른다).
      salvage.setLabel(salvageLabel(s));
      salvage.setEnabled(salvageEnabled(s));
      buy.setEnabled(buyEnabled(s));
    };
    this.rowRefs.set(def.id, sync);

    const step = (d: number): void => {
      this.qtyById.set(def.id, clampQty(this.qtyOf(def.id) + d));
      sync();
    };
    const minus = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: STEP_H,
      height: STEP_H,
      fontSize: 22,
      label: '−',
      onClick: () => step(-1),
    });
    minus.container.position.set(ctrlX, STEP_Y);
    row.addChild(minus.container);

    const plus = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: STEP_H,
      height: STEP_H,
      fontSize: 22,
      label: '+',
      onClick: () => step(1),
    });
    plus.container.position.set(ctrlX + ROW_CTRL_W - STEP_H, STEP_Y);
    row.addChild(plus.container);

    if (!this.online) {
      minus.setEnabled(false);
      plus.setEnabled(false);
    }
    sync();

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
