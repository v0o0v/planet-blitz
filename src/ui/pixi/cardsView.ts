/**
 * 방어 카드 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #7).
 *
 * 방어 사령부(`src/ui/defenseCommand.ts`) 우측 패널에 접이식으로 들어 있던 카드 관리
 * (슬롯·보관함·합성·일일 상점)를 독립 캔버스 화면으로 옮긴다. 방어 사령부에서 "카드 관리"
 * 버튼으로 진입하고, 닫으면 편집 상태를 유지한 채 그 화면으로 돌아간다(defenseCommand 는
 * DOM 오버레이만 잠시 감춘다 — suspend/resume).
 *
 * 표시 로직(등급 색·등급 라벨·어픽스 요약·잔여 경고·보관 게이지·합성 사전 검증·구매 실패
 * 문구)은 DOM 판이 소유한 순수 함수(`src/ui/cardsView.ts`)를 **그대로 import 해 재사용**한다
 * — 값이 조용히 갈리는 것을 막는다.
 *
 * 서버 권위: 구매·합성·분해·장착은 cards Edge Function / salvage_card RPC / defenses update 가
 * 최종 판정한다. 이 화면은 결과 코드를 문구로 옮기고(4xx 거부 사유 매핑 보존) 성공 후 서버
 * 크레딧을 프로필에 pull 한다. 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Rectangle, Text, type FederatedPointerEvent } from 'pixi.js';
import { saveProfile, type KeyValueStore, type Profile } from '../../save/profile.js';
import { refreshPendingProfile } from '../../net/profileSync.js';
import { t } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW, hexColor } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER, type PanelContentBox } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeBanner, makeCurrencyChip, makeIconButton } from './titleBar.js';
import { stripEmoji } from './text.js';
import {
  getCardsUserId,
  listCardInventory,
  fetchCardEquip,
  equipCard,
  salvageCard as netSalvageCard,
  buyShopCard as netBuyShopCard,
  fuseCards as netFuseCards,
  listCardShopPurchases,
  rollCurrentShop,
  computeShopSeeds,
  type CardOwned,
  type CardEquipState,
} from '../../net/cards.js';
import { FUSION_INPUT_COUNT, type CardInstance } from '../../../data/defenseCards.js';
import {
  cardRarityColor,
  cardRarityLabel,
  cardAffixOneLine,
  isLowCharge,
  storageGauge,
  checkFusionSelection,
  fusionCheckText,
  buyErrorText,
  shopSlotPrice,
} from '../cardsView.js';

// --- 레이아웃 상수(디자인 스페이스) ---
const BANNER_W = 440;
const BANNER_H = 72;
const BANNER_Y = 12;
const CHIP_W = 190;
const CHIP_H = 52;

const MARGIN = 36;
const GAP = 24;
const BOARD_TOP = 118;
/** 보드(열 패널)가 쓸 수 있는 아래 한계 — 그 밑은 하단 버튼 행. */
const BOARD_BOTTOM = 928;
const BOARD_W = DESIGN_WIDTH - MARGIN * 2;

/** 열 폭 — 슬롯(좁게) · 보관함(가장 넓게, 행에 버튼 둘) · 상점(좁아 버튼은 문구 아래). */
const COL_SLOT = 460;
const COL_INV = 840;
const COL_SHOP = 500;

/** 패널 제목(26px) 아래에서 본문이 시작한다 — 상자 top(60) + 58. */
const CONTENT_TOP = 118;

// 보관함.
const GAUGE_Y = CONTENT_TOP;
const GAUGE_H = 14;
/** 보관 게이지 미터 최대 폭(상자 끝까지 늘리면 실처럼 길어져 읽히지 않는다). */
const GAUGE_W = 280;
const FUSE_BTN_H = 44;
const INV_ROW_GAP = 10;
const INV_BTN_W = 108;
const INV_BTN_H = 40;

// 상점.
const SHOP_ROW_GAP = 10;
const SHOP_BTN_W = 130;
const SHOP_BTN_H = 42;

// 카드 슬롯.
const UNEQUIP_W = 200;
const UNEQUIP_H = 52;

// 하단.
const BACK_W = 320;
const BACK_H = 60;
const BACK_Y = 950;

/** 잔여 1회 경고·만석 경고에 쓰는 주황(DOM 판 `cs-warn` 과 같은 값). */
const WARN_COLOR = 0xffb14c;
/** 장착 카드 강조(DOM 판 `pb-cardrow.equipped` 테두리색). */
const EQUIPPED_COLOR = 0x8fd94c;

/** 목록 행 바탕(선택 시 금색 링). 카드 화면 전용 조립이라 공용으로 올리지 않는다(ADR-0014). */
function listRowBg(w: number, h: number, opts: { selected?: boolean; accent?: number } = {}): Graphics {
  const g = new Graphics();
  g.roundRect(0, 0, w, h, 10).fill({ color: 0x241d33, alpha: 0.92 });
  const stroke = opts.selected === true ? COLOR.gold : (opts.accent ?? 0x5a4630);
  g.roundRect(0, 0, w, h, 10).stroke({
    color: stroke,
    width: opts.selected === true ? 3 : 2,
    alignment: 1,
  });
  return g;
}

export class CardsScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private onClose: (() => void) | null = null;

  // 서버 권위 상태. null/false = 미로딩·미설정(안내 상태).
  private uid: string | null = null;
  private online = false;
  private loading = true;
  private loadToken = 0;
  private inventory: CardOwned[] = [];
  private equip: CardEquipState | null = null;
  private shop: CardInstance[] = [];
  private purchases: number[] = [];

  /** 합성 선택 모드 여부 + 선택된 보관함 행 id 집합. */
  private fuseMode = false;
  private readonly fusePicks = new Set<string>();
  /** 하단 안내(성공/오류 토스트). */
  private msgText = '';
  /** 네트워크 요청 진행 중(중복 클릭 방지). */
  private busy = false;

  // 목록 스크롤 위치(재렌더 사이 유지).
  private invScrollY = 0;
  private shopScrollY = 0;

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // UI 킷 텍스처 비동기 로드 — 완료 후 열려 있으면 실 아트로 다시 그린다(그 전엔 폴백).
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
    this.uid = null;
    this.online = false;
    this.loading = true;
    this.inventory = [];
    this.equip = null;
    this.shop = [];
    this.purchases = [];
    this.fuseMode = false;
    this.fusePicks.clear();
    this.msgText = '';
    this.busy = false;
    this.invScrollY = 0;
    this.shopScrollY = 0;
    this.render();
    this.root.visible = true;
    // 방어 프리뷰(정지 월드)는 방어 사령부 진입 때 stage 에 붙으므로 이 화면보다 뒤에 생성돼도
    // **위에** 그려진다 — 열 때마다 맨 앞으로 올려 아레나가 패널을 뚫고 보이지 않게 한다.
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
    // DOM HUD(HP/LV, 좌하단)는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다(스킬 §7).
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
    void this.load();
  }

  hide(): void {
    this.root.visible = false;
    this.onClose = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  // --- 로드 (DOM 판 loadCards 와 동일 규칙) ---------------------------------

  /** uid → 보관함·장착 상태·상점 재고·구매 이력. race 방지 토큰 사용. */
  private async load(): Promise<void> {
    const token = ++this.loadToken;
    this.loading = true;
    this.render();
    const uid = await getCardsUserId();
    if (token !== this.loadToken || !this.visible) return;
    if (uid === null) {
      this.online = false;
      this.loading = false;
      this.render();
      return;
    }
    this.uid = uid;
    this.online = true;
    const dateSeed = computeShopSeeds(uid).dateSeed;
    const [inv, equip, purchases] = await Promise.all([
      listCardInventory(),
      fetchCardEquip(),
      listCardShopPurchases(dateSeed),
    ]);
    if (token !== this.loadToken || !this.visible) return;
    this.inventory = inv ?? [];
    this.equip = equip;
    this.purchases = purchases ?? [];
    // 상점 재고는 (dateSeed,userSeed) 순수 함수로 클라가 재현(서버 호출 없음 — 표시=구매 대상 일치).
    this.shop = rollCurrentShop(uid);
    this.loading = false;
    this.render();
  }

  /** 보관함·장착·구매이력 재조회(상점 재고는 순수 재현이라 불변). */
  private async reload(): Promise<void> {
    const token = ++this.loadToken;
    const uid = this.uid;
    if (uid === null) {
      this.render();
      return;
    }
    const dateSeed = computeShopSeeds(uid).dateSeed;
    const [inv, equip, purchases] = await Promise.all([
      listCardInventory(),
      fetchCardEquip(),
      listCardShopPurchases(dateSeed),
    ]);
    if (token !== this.loadToken || !this.visible) return;
    if (inv !== null) this.inventory = inv;
    if (equip !== null) this.equip = equip;
    if (purchases !== null) this.purchases = purchases;
    this.render();
  }

  // --- 서버 액션 (DOM 판과 동일 — 거부 코드 → 문구 매핑 보존) ----------------

  /** 서버가 반환한 크레딧을 로컬 프로필에 반영·영속(정비 크레딧 pull 패턴과 동일). */
  private pullServerCredits(credits: number): void {
    this.profile.credits = credits;
    saveProfile(this.profile, this.store ?? undefined);
    const pendingStore = this.pendingStore();
    if (pendingStore !== null) refreshPendingProfile(pendingStore, this.profile);
  }

  /** net 대기 슬롯이 사는 스토어(주입 store 우선, 없으면 ambient localStorage). */
  private pendingStore(): KeyValueStore | null {
    if (this.store !== null) return this.store;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
      // 사생활 모드 등 — 접근 자체가 throw 할 수 있음.
    }
    return null;
  }

  private async doEquip(defenseId: string, cardId: string | null): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const ok = await equipCard(defenseId, cardId);
    if (!this.visible) return;
    this.busy = false;
    if (ok) {
      this.msgText = cardId === null ? t('card.equip.unequipped') : t('card.equip.done');
      const equip = await fetchCardEquip();
      if (!this.visible) return;
      if (equip !== null) this.equip = equip;
    } else {
      this.msgText = t('card.equip.failed');
    }
    this.render();
  }

  private async doSalvage(cardId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const result = await netSalvageCard(cardId);
    if (!this.visible) return;
    this.busy = false;
    if (result === null) {
      this.msgText = t('card.salvage.failed');
    } else if (!result.ok) {
      this.msgText = t('card.salvage.notOwned');
    } else {
      if (result.credits !== undefined) this.pullServerCredits(result.credits);
      this.msgText = t('card.salvage.done', { c: result.salvaged ?? 0 });
    }
    await this.reload();
  }

  private async doBuy(slotIndex: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const result = await netBuyShopCard(slotIndex);
    if (!this.visible) return;
    this.busy = false;
    if (result === null) {
      this.msgText = t('card.buy.failed');
    } else if (!result.ok) {
      // 서버가 내려준 거부 코드를 그대로 사유 문구로 옮긴다(잔액 부족·만석·중복 구매 …).
      this.msgText = buyErrorText(result.code);
    } else {
      if (result.credits !== undefined) this.pullServerCredits(result.credits);
      this.msgText = t('card.buy.done', { rarity: cardRarityLabel(result.rarity ?? 'normal') });
    }
    await this.reload();
  }

  private async doFuse(): Promise<void> {
    if (this.busy) return;
    const picks = this.pickedOwned();
    const check = checkFusionSelection(picks);
    if (!check.ok) {
      this.msgText = fusionCheckText(check.code);
      this.render();
      return;
    }
    this.busy = true;
    this.render();
    const ids = picks.map((c) => c.id) as unknown as readonly [string, string, string];
    const result = await netFuseCards(ids);
    if (!this.visible) return;
    this.busy = false;
    this.fuseMode = false;
    this.fusePicks.clear();
    if (result === null) {
      this.msgText = t('card.fuse.failed');
    } else if (!result.ok) {
      this.msgText = result.code === 'not-owned' ? t('card.fuse.notOwned') : t('card.fuse.failed');
    } else {
      const rarityLabel = cardRarityLabel(result.rarity ?? 'normal');
      this.msgText =
        result.promoted === true
          ? t('card.fuse.promoted', { rarity: rarityLabel })
          : t('card.fuse.done', { rarity: rarityLabel });
    }
    await this.reload();
  }

  // --- 상호작용 ------------------------------------------------------------

  private ownedById(id: string): CardOwned | undefined {
    return this.inventory.find((c) => c.id === id);
  }

  /** 현재 합성 선택된 소유 카드 목록(존재하는 것만). */
  private pickedOwned(): CardOwned[] {
    const out: CardOwned[] = [];
    for (const id of this.fusePicks) {
      const owned = this.ownedById(id);
      if (owned !== undefined) out.push(owned);
    }
    return out;
  }

  /**
   * 합성 선택 토글. 상한(3장)은 여기서 지킨다 — 비활성 버튼은 이벤트를 받지 않아 클릭이
   * 행 선택으로 넘어오므로, 버튼 disabled 만으로는 상한이 강제되지 않는다.
   */
  private togglePick(id: string): void {
    if (this.busy) return;
    if (this.fusePicks.has(id)) this.fusePicks.delete(id);
    else if (this.fusePicks.size < FUSION_INPUT_COUNT) this.fusePicks.add(id);
    this.render();
  }

  private close(): void {
    const cb = this.onClose;
    this.hide();
    cb?.();
  }

  // --- 공용 렌더 조각 -------------------------------------------------------

  private label(
    text: string,
    size: number,
    color: number,
    weight: '400' | '700' | '800' = '400',
    maxW?: number,
  ): Text {
    const el = new Text({
      resolution: 2,
      text: stripEmoji(text),
      style: { fontFamily: UI_FONT, fontSize: size, fontWeight: weight, fill: color, dropShadow: TEXT_SHADOW },
    });
    if (maxW !== undefined && el.width > maxW) el.scale.x = maxW / el.width;
    return el;
  }

  /** 줄바꿈 문구(폭 고정, 높이는 내용이 정한다). */
  private wrapped(text: string, size: number, color: number, w: number, weight: '400' | '700' = '400'): Text {
    return new Text({
      resolution: 2,
      text: stripEmoji(text),
      style: {
        fontFamily: UI_FONT,
        fontSize: size,
        fontWeight: weight,
        fill: color,
        wordWrap: true,
        wordWrapWidth: w,
        dropShadow: TEXT_SHADOW,
      },
    });
  }

  /** 패널 제목 — top = 콘텐츠 상자 top(스킬 §4, 제목이 나무 테두리에 붙던 결함 재발 방지). */
  private panelTitle(parent: Container, box: PanelContentBox, text: string, color: number = COLOR.cream): void {
    const title = this.label(text, 26, color, '800');
    title.position.set(box.x, box.y);
    if (title.width > box.w) title.scale.x = box.w / title.width;
    parent.addChild(title);
  }

  /** 안내/빈 상태 문구(콘텐츠 상자 안 가운데 정렬). */
  private msg(parent: Container, box: PanelContentBox, text: string, top = CONTENT_TOP + 40): void {
    const el = this.wrapped(text, 19, COLOR.muted, box.w);
    el.anchor.set(0.5, 0);
    el.position.set(box.x + box.w / 2, top);
    parent.addChild(el);
  }

  /** 패널 한 장(프레임 + 위치)을 만들어 부모에 붙이고 콘텐츠 상자를 돌려준다. */
  private addPanel(x: number, y: number, w: number, h: number): { panel: Container; box: PanelContentBox } {
    const panel = new Container();
    panel.position.set(x, y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(w, h, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));
    return { panel, box: panelContent(w, h) };
  }

  /**
   * 마스크 스크롤 영역을 만들고 콘텐츠 Container 를 돌려준다. 마스크 높이는 호출자가
   * **행 경계로 클램프한 값**으로 넘긴다(반토막 행 금지 — 스킬 §4).
   */
  private scrollArea(
    panel: Container,
    x: number,
    y: number,
    w: number,
    h: number,
    totalH: number,
    get: () => number,
    set: (v: number) => void,
  ): Container {
    const clip = new Container();
    clip.position.set(x, y);
    panel.addChild(clip);
    const mask = new Graphics();
    mask.rect(x, y, w, h).fill({ color: 0xffffff });
    panel.addChild(mask);
    clip.mask = mask;
    const content = new Container();
    clip.addChild(content);

    const maxScroll = Math.max(0, totalH - h);
    const v = Math.max(0, Math.min(get(), maxScroll));
    set(v);
    content.y = -v;
    if (maxScroll > 0) {
      // 휠은 **클립 Container** 가 받는다. 마스크로 쓰이는 Graphics 는 히트 테스트에서 제외돼
      // (`isMask`) 리스너가 영영 안 불린다(실측). hitArea 를 주면 행 사이 빈 자리에서도 잡히고,
      // 행 위에서는 행 → 클립으로 버블링되어 함께 성립한다.
      clip.eventMode = 'static';
      clip.hitArea = new Rectangle(0, 0, w, h);
      clip.on('wheel', (e) => {
        const next = Math.max(0, Math.min(maxScroll, get() + e.deltaY));
        set(next);
        content.y = -next;
      });
    }
    return content;
  }

  /** 행 경계로 클램프한 마스크 높이(반토막 행 금지). 한 행도 안 들어가면 가용 높이 그대로. */
  private clampToRows(avail: number, bounds: readonly number[]): number {
    let best = 0;
    for (const b of bounds) {
      if (b <= avail && b > best) best = b;
    }
    return best > 0 ? best : Math.max(0, avail);
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    // 배경(불투명 — 뒤 방어 프리뷰를 가린다). 별 장식 금지(세트 팔레트 확정).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChild(bg);

    this.renderTitleBar();

    const h = BOARD_BOTTOM - BOARD_TOP;
    if (this.loading || !this.online) {
      const { panel, box } = this.addPanel(MARGIN, BOARD_TOP, BOARD_W, 320);
      this.panelTitle(panel, box, t('card.slot.head'));
      this.msg(panel, box, this.loading ? t('card.slot.loading') : t('card.slot.offline'));
    } else {
      this.renderSlotPanel(MARGIN, BOARD_TOP, COL_SLOT, h);
      this.renderInventoryPanel(MARGIN + COL_SLOT + GAP, BOARD_TOP, COL_INV, h);
      this.renderShopPanel(MARGIN + COL_SLOT + GAP + COL_INV + GAP, BOARD_TOP, COL_SHOP, h);
    }

    this.renderFooter();
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('card.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const chipY = BANNER_Y + (BANNER_H - CHIP_H) / 2;
    const credits = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.credits),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_coin.png'],
    );
    credits.position.set((DESIGN_WIDTH - BANNER_W) / 2 - CHIP_W - 20, chipY);
    this.root.addChild(credits);

    const close = makeIconButton(56, () => this.close(), this.ui['ui_icon_close.png']);
    close.position.set(DESIGN_WIDTH - 24 - 56, 12);
    this.root.addChild(close);
  }

  private renderFooter(): void {
    const back = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: BACK_W,
      height: BACK_H,
      fontSize: 22,
      label: stripEmoji(t('card.back')),
      onClick: () => this.close(),
    });
    back.container.position.set((DESIGN_WIDTH - BACK_W) / 2, BACK_Y);
    this.root.addChild(back.container);

    if (this.msgText === '') return;
    const hint = this.label(this.msgText, 20, COLOR.gold, '700', BOARD_W);
    hint.anchor.set(0.5, 1);
    hint.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 12);
    this.root.addChild(hint);
  }

  // --- 카드 슬롯 -----------------------------------------------------------

  /** 장착 카드 표시(등급·어픽스·잔여·경고) 또는 빈 슬롯 안내 + 해제 버튼. */
  private renderSlotPanel(x: number, y: number, w: number, h: number): void {
    const { panel, box } = this.addPanel(x, y, w, h);
    this.panelTitle(panel, box, t('card.slot.head'));

    const equip = this.equip;
    if (equip === null || equip.defenseId === null) {
      this.msg(panel, box, t('card.slot.noBase'));
      return;
    }

    const owned = equip.equippedCardId !== null ? this.ownedById(equip.equippedCardId) : undefined;
    if (owned === undefined) {
      this.msg(panel, box, t('card.slot.empty'));
      this.msg(panel, box, t('card.slot.emptyHint'), CONTENT_TOP + 84);
      return;
    }

    const accent = hexColor(cardRarityColor(owned.rarity));
    const card = new Container();
    card.position.set(box.x, CONTENT_TOP);
    panel.addChild(card);

    const inner = new Container();
    let cy = 16;
    const put = (el: Text, px: number): void => {
      el.position.set(px, cy);
      inner.addChild(el);
      cy += el.height + 6;
    };

    put(this.label(`${t('card.slot.equipped')} · ${cardRarityLabel(owned.rarity)}`, 22, accent, '800', box.w - 32), 16);
    put(
      this.label(t('card.slot.charges', { n: owned.chargesLeft, m: owned.card.chargesMax }), 18, COLOR.cream, '700'),
      16,
    );
    if (isLowCharge(owned.chargesLeft)) {
      put(this.wrapped(t('card.slot.lastCharge'), 16, WARN_COLOR, box.w - 32, '700'), 16);
    }
    cy += 4;
    put(this.wrapped(cardAffixOneLine(owned.card), 17, COLOR.muted, box.w - 32), 16);

    const cardH = cy + 10;
    card.addChild(listRowBg(box.w, cardH, { accent }));
    card.addChild(inner);

    const unequip = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: UNEQUIP_W,
      height: UNEQUIP_H,
      fontSize: 20,
      label: stripEmoji(t('card.slot.unequip')),
      onClick: () => void this.doEquip(equip.defenseId!, null),
    });
    // 해제 버튼은 카드 **바로 아래**에 둔다(상자 바닥에 붙이면 카드와 멀어 한 덩어리로 안 읽힌다).
    const btnY = Math.min(CONTENT_TOP + cardH + 18, box.bottom - UNEQUIP_H);
    unequip.container.position.set(box.x + (box.w - UNEQUIP_W) / 2, btnY);
    panel.addChild(unequip.container);
    if (this.busy) unequip.setEnabled(false);

    const hint = this.wrapped(t('card.slot.autoHint'), 16, COLOR.muted, box.w);
    hint.anchor.set(0.5, 0);
    hint.position.set(box.x + box.w / 2, btnY + UNEQUIP_H + 18);
    panel.addChild(hint);
  }

  // --- 보관함 --------------------------------------------------------------

  /** 보관 게이지 + 합성 바 + 카드 목록(장착/분해 또는 합성 선택). */
  private renderInventoryPanel(x: number, y: number, w: number, h: number): void {
    const { panel, box } = this.addPanel(x, y, w, h);
    this.panelTitle(panel, box, t('card.inv.head'));

    const gauge = storageGauge(this.inventory.length);
    const gaugeLabel = this.label(t('card.inv.storage', { count: gauge.count, cap: gauge.cap }), 18, COLOR.cream, '700');
    gaugeLabel.position.set(box.x, GAUGE_Y);
    panel.addChild(gaugeLabel);

    const meterX = box.x + gaugeLabel.width + 16;
    // 미터를 상자 끝까지 늘리면 실같이 길어져 눈금이 안 읽힌다 — 폭을 묶는다.
    const meterW = Math.max(80, Math.min(GAUGE_W, box.right - meterX));
    const meterY = GAUGE_Y + Math.round((gaugeLabel.height - GAUGE_H) / 2);
    const meter = new Graphics();
    meter
      .roundRect(meterX, meterY, meterW, GAUGE_H, 6)
      .fill({ color: 0x0f0b1c })
      .roundRect(meterX, meterY, Math.max(2, (meterW * gauge.pct) / 100), GAUGE_H, 6)
      .fill({ color: gauge.full ? 0xff6a6a : EQUIPPED_COLOR });
    panel.addChild(meter);

    let top = GAUGE_Y + gaugeLabel.height + 10;
    if (gauge.full) {
      const full = this.wrapped(t('card.inv.full'), 16, WARN_COLOR, box.w, '700');
      full.position.set(box.x, top);
      panel.addChild(full);
      top += full.height + 6;
    }

    top = this.renderFuseBar(panel, box, top) + 14;

    if (this.inventory.length === 0) {
      this.msg(panel, box, t('card.inv.empty'), top + 20);
      return;
    }

    // 행 높이가 제각각(어픽스 줄 수)이라 행마다 재고, 마스크는 그 경계로 클램프한다.
    const equippedId = this.equip?.equippedCardId ?? null;
    const rows = this.inventory.map((owned) => this.makeInvRow(owned, box.w, equippedId));
    const bounds: number[] = [];
    let total = 0;
    rows.forEach((row, i) => {
      total += row.h + (i > 0 ? INV_ROW_GAP : 0);
      bounds.push(total);
    });
    const maskH = this.clampToRows(box.bottom - top, bounds);
    const content = this.scrollArea(
      panel,
      box.x,
      top,
      box.w,
      maskH,
      total,
      () => this.invScrollY,
      (v) => {
        this.invScrollY = v;
      },
    );
    let cy = 0;
    for (const row of rows) {
      row.node.position.set(0, cy);
      content.addChild(row.node);
      cy += row.h + INV_ROW_GAP;
    }
  }

  /** 합성 바(선택 모드 토글 + 확정 + 취소). 다음 y 를 돌려준다. */
  private renderFuseBar(panel: Container, box: PanelContentBox, top: number): number {
    if (!this.fuseMode) {
      const start = new PixiButton({
        texture: this.ui['ui_btn_wood.png'],
        fallbackColor: 0x4a3a24,
        width: 220,
        height: FUSE_BTN_H,
        fontSize: 19,
        label: stripEmoji(t('card.inv.fuseStart')),
        onClick: () => {
          this.fuseMode = true;
          this.fusePicks.clear();
          this.msgText = t('card.inv.fuseMode');
          this.render();
        },
      });
      start.container.position.set(box.x, top);
      panel.addChild(start.container);
      if (this.busy || this.inventory.length < FUSION_INPUT_COUNT) start.setEnabled(false);
      return top + FUSE_BTN_H;
    }

    const check = checkFusionSelection(this.pickedOwned());
    const confirm = new PixiButton({
      texture: this.ui[check.ok ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: check.ok ? 0x9a7a2a : 0x4a3a24,
      width: 240,
      height: FUSE_BTN_H,
      fontSize: 19,
      // 노란 버튼은 바탕이 밝아 흰 라벨이 묻힌다(세트 규칙).
      ...(check.ok ? { labelColor: COLOR.darkLabel } : {}),
      label: stripEmoji(t('card.inv.fuseConfirm', { n: this.fusePicks.size })),
      onClick: () => void this.doFuse(),
    });
    confirm.container.position.set(box.x, top);
    panel.addChild(confirm.container);
    if (this.busy || !check.ok) confirm.setEnabled(false);

    const cancel = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: 140,
      height: FUSE_BTN_H,
      fontSize: 19,
      label: stripEmoji(t('card.inv.fuseCancel')),
      onClick: () => {
        this.fuseMode = false;
        this.fusePicks.clear();
        this.msgText = '';
        this.render();
      },
    });
    cancel.container.position.set(box.x + 240 + 12, top);
    panel.addChild(cancel.container);

    if (!check.ok && this.fusePicks.size > 0) {
      const hint = this.label(fusionCheckText(check.code), 16, WARN_COLOR, '700', box.right - (box.x + 404));
      hint.anchor.set(0, 0.5);
      hint.position.set(box.x + 404, top + FUSE_BTN_H / 2);
      panel.addChild(hint);
    }
    return top + FUSE_BTN_H;
  }

  /** 보관함 1행. 합성 모드에서는 **행 전체**가 선택 토글이 된다. */
  private makeInvRow(owned: CardOwned, w: number, equippedId: string | null): { node: Container; h: number } {
    const isEquipped = owned.id === equippedId;
    const isPicked = this.fusePicks.has(owned.id);
    const rarityColor = hexColor(cardRarityColor(owned.rarity));

    const row = new Container();
    const btnCount = this.fuseMode ? 1 : 2;
    const btnZone = btnCount * INV_BTN_W + (btnCount - 1) * 8 + 24;
    const textW = Math.max(120, w - btnZone - 20);

    const grade = this.label(cardRarityLabel(owned.rarity), 20, rarityColor, '800');
    grade.position.set(16, 12);

    const charges = this.label(
      t('card.inv.charges', { n: owned.chargesLeft }),
      16,
      isLowCharge(owned.chargesLeft) ? WARN_COLOR : COLOR.muted,
      '700',
    );
    charges.position.set(16 + grade.width + 10, 16);

    const affix = this.wrapped(cardAffixOneLine(owned.card), 15, COLOR.muted, textW);
    affix.position.set(16, 42);

    const h = Math.max(78, 42 + affix.height + 14);

    // 선택 클릭은 **행 전체**가 받는다. 바탕(Graphics)에만 걸면 등급·어픽스 텍스트 위를
    // 눌렀을 때 먹지 않는다(Pixi 히트 테스트는 형제로 내려가지 않는다 — 관제탑 #6 실측 결함).
    if (this.fuseMode) {
      row.eventMode = 'static';
      row.cursor = 'pointer';
      row.on('pointertap', () => this.togglePick(owned.id));
    }
    row.addChild(
      listRowBg(w, h, {
        selected: isPicked,
        ...(isEquipped ? { accent: EQUIPPED_COLOR } : {}),
      }),
    );
    row.addChild(grade, charges, affix);

    const btnY = Math.round((h - INV_BTN_H) / 2);
    if (this.fuseMode) {
      const pick = new PixiButton({
        texture: this.ui[isPicked ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
        fallbackColor: isPicked ? 0x9a7a2a : 0x4a3a24,
        width: INV_BTN_W,
        height: INV_BTN_H,
        fontSize: 17,
        ...(isPicked ? { labelColor: COLOR.darkLabel } : {}),
        label: stripEmoji(isPicked ? t('card.inv.picked') : t('card.inv.pick')),
        onClick: () => this.togglePick(owned.id),
      });
      pick.container.position.set(w - INV_BTN_W - 12, btnY);
      // 버튼 클릭이 행 토글까지 겹쳐 두 번 뒤집히지 않게 끊는다.
      pick.container.on('pointertap', (e: FederatedPointerEvent) => e.stopPropagation());
      row.addChild(pick.container);
      if (this.busy) pick.setEnabled(false);
      return { node: row, h };
    }

    const canEquip = !isEquipped && this.equip?.defenseId != null && !this.busy;
    const eq = new PixiButton({
      texture: this.ui[canEquip ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: canEquip ? 0x9a7a2a : 0x4a3a24,
      width: INV_BTN_W,
      height: INV_BTN_H,
      fontSize: 17,
      ...(canEquip ? { labelColor: COLOR.darkLabel } : {}),
      label: stripEmoji(isEquipped ? t('card.inv.equipped') : t('card.inv.equip')),
      onClick: () => {
        const defId = this.equip?.defenseId;
        if (defId != null) void this.doEquip(defId, owned.id);
      },
    });
    eq.container.position.set(w - INV_BTN_W * 2 - 8 - 12, btnY);
    row.addChild(eq.container);
    if (!canEquip) eq.setEnabled(false);

    const sv = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: INV_BTN_W,
      height: INV_BTN_H,
      fontSize: 17,
      label: stripEmoji(t('card.inv.salvage')),
      onClick: () => void this.doSalvage(owned.id),
    });
    sv.container.position.set(w - INV_BTN_W - 12, btnY);
    row.addChild(sv.container);
    if (this.busy) sv.setEnabled(false);

    return { node: row, h };
  }

  // --- 일일 상점 -----------------------------------------------------------

  /** 오늘 재고(옵션 미리 공개 · 가격), 이미 산 슬롯은 비활성. */
  private renderShopPanel(x: number, y: number, w: number, h: number): void {
    const { panel, box } = this.addPanel(x, y, w, h);
    this.panelTitle(panel, box, t('card.shop.head'));

    const note = this.wrapped(t('card.shop.note'), 15, COLOR.muted, box.w);
    note.position.set(box.x, CONTENT_TOP);
    panel.addChild(note);
    const top = CONTENT_TOP + note.height + 12;

    if (this.shop.length === 0) {
      this.msg(panel, box, t('card.shop.empty'), top + 20);
      return;
    }

    const storageFull = storageGauge(this.inventory.length).full;
    const rows = this.shop.map((card, i) => this.makeShopRow(card, i, box.w, storageFull));
    const bounds: number[] = [];
    let total = 0;
    rows.forEach((row, i) => {
      total += row.h + (i > 0 ? SHOP_ROW_GAP : 0);
      bounds.push(total);
    });
    const maskH = this.clampToRows(box.bottom - top, bounds);
    const content = this.scrollArea(
      panel,
      box.x,
      top,
      box.w,
      maskH,
      total,
      () => this.shopScrollY,
      (v) => {
        this.shopScrollY = v;
      },
    );
    let cy = 0;
    for (const row of rows) {
      row.node.position.set(0, cy);
      content.addChild(row.node);
      cy += row.h + SHOP_ROW_GAP;
    }
  }

  /**
   * 상점 1행. 열이 좁아 구매 버튼은 문구 **옆이 아니라 아래**에 둔다 — 옆에 붙이면 어픽스
   * 문구 폭이 눌려 가로 축소가 걸리고 읽을 수 없다(관제탑 #6 교훈).
   */
  private makeShopRow(
    card: CardInstance,
    slotIndex: number,
    w: number,
    storageFull: boolean,
  ): { node: Container; h: number } {
    const bought = this.purchases.includes(slotIndex);
    const rarityColor = hexColor(cardRarityColor(card.rarity));
    const row = new Container();

    const head = this.label(
      `${cardRarityLabel(card.rarity)} · ${t('card.shop.price', { c: shopSlotPrice(card.rarity) })}`,
      19,
      rarityColor,
      '800',
      w - 32,
    );
    head.position.set(16, 12);

    const affix = this.wrapped(cardAffixOneLine(card), 15, COLOR.muted, w - 32);
    affix.position.set(16, 40);

    const btnY = 40 + affix.height + 10;
    const h = btnY + SHOP_BTN_H + 12;

    row.addChild(listRowBg(w, h, bought ? {} : { accent: rarityColor }));
    row.addChild(head, affix);

    const canBuy = !bought && !storageFull && !this.busy;
    const buy = new PixiButton({
      texture: this.ui[canBuy ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: canBuy ? 0x9a7a2a : 0x4a3a24,
      width: SHOP_BTN_W,
      height: SHOP_BTN_H,
      fontSize: 18,
      ...(canBuy ? { labelColor: COLOR.darkLabel } : {}),
      label: stripEmoji(bought ? t('card.shop.bought') : t('card.shop.buy')),
      onClick: () => void this.doBuy(slotIndex),
    });
    buy.container.position.set(w - SHOP_BTN_W - 16, btnY);
    row.addChild(buy.container);
    if (!canBuy) buy.setEnabled(false);

    return { node: row, h };
  }
}
