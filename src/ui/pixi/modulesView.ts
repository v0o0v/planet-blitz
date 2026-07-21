/**
 * 코어 모듈 화면 — 슬롯 2 · 보관함 · 일일 상점 (M7b-core-modules, ADR-0018).
 *
 * ## 무엇이 바뀌었나 (구 카드 화면 대비)
 * 구 `src/ui/pixi/cardsView.ts`(M6 방어 카드)는 **슬롯 1개**에 카드 한 장을 꽂는 화면이었다.
 * 3레이어 개편에서 방어 카드는 폐지되고 **L3 코어의 강화 슬롯 2개에 꽂는 소모성 코어 모듈**
 * 이 됐다(ADR-0018). 그래서 이 화면은:
 *   - 슬롯을 **2칸 목록**으로 그리고(슬롯 i ↔ 표시 i, 밀집화 금지 — `normalizeEquippedModules`),
 *   - 장착은 "슬롯을 고른 뒤 보관함에서 장착"이라는 2단 조작이며(빈 슬롯 자동 선택 폴백),
 *   - 남은 사용 횟수를 슬롯·보관함·상점 세 곳에서 모두 드러낸다(소모품이라는 사실이 화면에서
 *     사라지면 사용자가 "왜 모듈이 없어졌냐"고 묻게 된다).
 *
 * ## 공용 부품에 위임한다 (중복 조립 금지)
 * 스크롤 영역·목록 행·팝업은 `scrollArea.ts` / `listRow.ts` / `modal.ts` 를 쓴다. 구 카드
 * 화면은 이 셋을 파일 안에 사본으로 갖고 있었고, 그래서 선택 링 두께 같은 값이 화면마다
 * 갈렸다. 여기서 다시 복제하면 같은 일이 반복된다.
 *
 * ## 진입·복귀
 * 방어 사령부(`defenseCommand.ts`) 모듈 탭에서 진입하며, 사령부는 `suspend()` 로 자기 화면만
 * 감췄다가 이 화면이 닫힐 때 `resume()` 한다 — `show()` 로 되돌리면 **미저장 배치 편집이
 * 날아간다**(실측 규율).
 *
 * ## 서버 권위
 * 구매·합성은 `modules` Edge Function, 분해는 `salvage_core_module` RPC, 장착은 defenses
 * update(소유권 트리거)가 최종 판정한다. 이 화면은 거부 코드를 문구로 옮기고(4xx 사유 매핑
 * 보존) 성공 후 서버 크레딧을 프로필에 pull 한다. 순수 render/UI 레이어(ADR-0005) — sim 은
 * 이 파일을 모른다.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { saveProfile, type KeyValueStore, type Profile } from '../../save/profile.js';
import { refreshPendingProfile } from '../../net/profileSync.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW, hexColor } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER, type PanelContentBox } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeBanner, makeCurrencyChip, makeIconButton } from './titleBar.js';
import { stripEmoji } from './text.js';
import { makeScrollArea, rowBounds, clampToRows } from './scrollArea.js';
import { listRowBg, attachRowClick, stopRowPropagation } from './listRow.js';
import {
  getModulesUserId,
  listModuleInventory,
  fetchModuleEquip,
  equipModules,
  salvageModule as netSalvageModule,
  buyShopModule as netBuyShopModule,
  fuseModules as netFuseModules,
  listModuleShopPurchases,
  rollCurrentModuleShop,
  computeShopSeeds,
  type ModuleOwned,
  type ModuleEquipState,
} from '../../net/modules.js';
import {
  MODULE_FUSION_INPUT_COUNT,
  MODULE_EQUIP_SLOTS,
  type ModuleInstance,
} from '../../../data/coreModules.js';
import {
  moduleRarityColor,
  moduleRarityLabel,
  moduleAffixOneLine,
  isLowCharge,
  storageGauge,
  checkFusionSelection,
  fusionCheckText,
  buyErrorText,
  shopSlotPrice,
  pickEquipSlot,
} from '../modulesView.js';

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

// 슬롯.
const SLOT_ROW_GAP = 12;
const UNEQUIP_W = 120;
const UNEQUIP_H = 40;

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

// 조회 실패 안내의 [다시 시도].
const RETRY_W = 180;
const RETRY_H = 44;
const RETRY_GAP = 16;

// 하단.
const BACK_W = 320;
const BACK_H = 60;
const BACK_Y = 950;

// ---------------------------------------------------------------------------
// 로드 상태 판정 (순수) — **조회 실패를 "비어 있음"으로 말하지 않는다**
// ---------------------------------------------------------------------------
//
// 실측 결함: uid 획득만 성공하면 `online = true` 를 세운 뒤 보관함 조회가 실패해도 `inv ?? []`
// 로 빈 배열과 동일하게 취급했다. 그래서 서버 오류인데 화면은 "보관함이 비어 있습니다"·"방어
// 미배치"라고 단정했고, 사용자는 **자기 모듈이 사라진 줄 안다**. 없다고 말하는 것과 모른다고
// 말하는 것은 다르다. 판정을 순수 함수로 빼 두어 캔버스 없이 검증한다.

/** 보관함 패널이 보여야 할 상태. */
export type InventoryPanelKind = 'failed' | 'empty' | 'list';

/**
 * 보관함 패널 상태. 조회에 실패해도 **직전에 받아 둔 목록이 있으면 그것을 계속 보여 준다**
 * (있던 것을 지워 놓고 오류를 띄우면 그게 더 무섭다). 목록이 없을 때만 실패를 말한다.
 */
export function inventoryPanelKind(s: { count: number; failed: boolean }): InventoryPanelKind {
  if (s.count > 0) return 'list';
  return s.failed ? 'failed' : 'empty';
}

/** 슬롯 패널이 보여야 할 상태. */
export type SlotPanelKind = 'failed' | 'noBase' | 'slots';

/**
 * 슬롯 패널 상태. 장착 상태 조회가 실패한 것(`equip === null` + failed)과 방어를 아직 안 짠 것
 * (`defenseId === null`)은 사용자가 해야 할 일이 정반대다 — 전자는 기다리기, 후자는 배치 저장하기.
 */
export function slotPanelKind(s: { equip: ModuleEquipState | null; failed: boolean }): SlotPanelKind {
  if (s.equip === null) return s.failed ? 'failed' : 'noBase';
  return s.equip.defenseId === null ? 'noBase' : 'slots';
}

/**
 * 상태 → 안내 문구 키(목록을 그리는 상태면 null). 세 상태가 **서로 다른 키**로 갈리는 것이
 * 이 함수의 계약이다.
 *
 * 실패는 `mod.load.failed`(조회 실패 전용)를 쓴다. 서버 연결 안내(`mod.slot.offline`)를 빌려
 * 쓰면 "연결이 없다"와 "물어봤는데 답을 못 받았다"가 한 문구로 뭉개져, 온라인인데 조회만 실패한
 * 사용자가 자기 연결을 의심하게 된다. 실패 안내에는 재시도 버튼이 함께 붙는다.
 */
export function panelMessageKey(kind: InventoryPanelKind | SlotPanelKind): MessageKey | null {
  switch (kind) {
    case 'failed':
      return 'mod.load.failed';
    case 'empty':
      return 'mod.inv.empty';
    case 'noBase':
      return 'mod.slot.noBase';
    default:
      return null;
  }
}

/** 잔여 1회 경고·만석 경고에 쓰는 주황. */
const WARN_COLOR = 0xffb14c;
/** 장착 모듈 강조 테두리색. */
const EQUIPPED_COLOR = 0x8fd94c;

export class ModulesScreen {
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
  private inventory: ModuleOwned[] = [];
  private equip: ModuleEquipState | null = null;
  /** 직전 보관함/장착 조회가 실패했는가(= 비어 있음과 구분해야 하는 상태). */
  private invFailed = false;
  private equipFailed = false;
  private shop: ModuleInstance[] = [];
  private purchases: number[] = [];

  /** 장착 대상 슬롯(사용자 선택). null 이면 첫 빈 슬롯이 대상이 된다. */
  private selectedSlot: number | null = null;
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
    // 리스너는 render() 안에서만 붙이므로 이 재호출이 클릭을 두 번 돌게 하지 않는다.
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
    this.invFailed = false;
    this.equipFailed = false;
    this.shop = [];
    this.purchases = [];
    this.selectedSlot = null;
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
    // DOM HUD(HP/LV, 좌하단)는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다.
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

  // --- 로드 ------------------------------------------------------------------

  /** uid → 보관함·장착 상태·상점 재고·구매 이력. race 방지 토큰 사용. */
  private async load(): Promise<void> {
    const token = ++this.loadToken;
    this.loading = true;
    this.render();
    const uid = await getModulesUserId();
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
      listModuleInventory(),
      fetchModuleEquip(),
      listModuleShopPurchases(dateSeed),
    ]);
    if (token !== this.loadToken || !this.visible) return;
    // 실패(null)를 빈 배열로 뭉개지 않는다 — 뭉개면 "보관함이 비어 있습니다"라고 거짓말하게 된다.
    this.invFailed = inv === null;
    this.equipFailed = equip === null;
    if (inv !== null) this.inventory = inv;
    this.equip = equip;
    this.purchases = purchases ?? [];
    // 상점 재고는 (dateSeed,userSeed) 순수 함수로 클라가 재현(서버 호출 없음 — 표시=구매 대상 일치).
    this.shop = rollCurrentModuleShop(uid);
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
      listModuleInventory(),
      fetchModuleEquip(),
      listModuleShopPurchases(dateSeed),
    ]);
    if (token !== this.loadToken || !this.visible) return;
    this.invFailed = inv === null;
    this.equipFailed = equip === null;
    if (inv !== null) this.inventory = inv;
    if (equip !== null) this.equip = equip;
    if (purchases !== null) this.purchases = purchases;
    this.render();
  }

  // --- 서버 액션 (거부 코드 → 문구 매핑 보존) ---------------------------------

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

  /** 슬롯 배열의 한 칸만 바꾼 새 배열(고정 길이 유지 — 밀집화 금지). */
  private nextEquipped(slotIndex: number, moduleId: string | null): (string | null)[] {
    const cur = this.equip?.equipped ?? [];
    const out: (string | null)[] = [];
    for (let i = 0; i < MODULE_EQUIP_SLOTS; i++) {
      const v = cur[i] ?? null;
      // 같은 모듈이 다른 슬롯에 이미 있으면 그 칸을 비운다(중복 장착 금지 — 서버 트리거 동일 규칙).
      out.push(i === slotIndex ? moduleId : v === moduleId && moduleId !== null ? null : v);
    }
    return out;
  }

  private async doEquip(defenseId: string, slotIndex: number, moduleId: string | null): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const ok = await equipModules(defenseId, this.nextEquipped(slotIndex, moduleId));
    if (!this.visible) return;
    this.busy = false;
    if (ok) {
      this.msgText = moduleId === null ? t('mod.equip.unequipped') : t('mod.equip.done');
      const equip = await fetchModuleEquip();
      if (!this.visible) return;
      if (equip !== null) this.equip = equip;
    } else {
      this.msgText = t('mod.equip.failed');
    }
    this.render();
  }

  /** 보관함 행의 "장착" — 선택 슬롯(없으면 첫 빈 슬롯)에 꽂는다. 둘 다 차 있으면 안내만. */
  private equipToSlot(moduleId: string): void {
    const equip = this.equip;
    if (equip === null || equip.defenseId === null) return;
    const slot = pickEquipSlot(equip.equipped, this.selectedSlot);
    if (slot === null) {
      this.msgText = t('mod.equip.noSlot');
      this.render();
      return;
    }
    void this.doEquip(equip.defenseId, slot, moduleId);
  }

  private async doSalvage(moduleId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const result = await netSalvageModule(moduleId);
    if (!this.visible) return;
    this.busy = false;
    if (result === null) {
      this.msgText = t('mod.salvage.failed');
    } else if (!result.ok) {
      this.msgText = t('mod.salvage.notOwned');
    } else {
      if (result.credits !== undefined) this.pullServerCredits(result.credits);
      this.msgText = t('mod.salvage.done', { c: result.salvaged ?? 0 });
    }
    await this.reload();
  }

  private async doBuy(slotIndex: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const result = await netBuyShopModule(slotIndex);
    if (!this.visible) return;
    this.busy = false;
    if (result === null) {
      this.msgText = t('mod.buy.failed');
    } else if (!result.ok) {
      // 서버가 내려준 거부 코드를 그대로 사유 문구로 옮긴다(잔액 부족·만석·중복 구매 …).
      this.msgText = buyErrorText(result.code);
    } else {
      if (result.credits !== undefined) this.pullServerCredits(result.credits);
      this.msgText = t('mod.buy.done', { rarity: moduleRarityLabel(result.rarity ?? 'normal') });
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
    const ids = picks.map((m) => m.id) as unknown as readonly [string, string, string];
    const result = await netFuseModules(ids);
    if (!this.visible) return;
    this.busy = false;
    this.fuseMode = false;
    this.fusePicks.clear();
    if (result === null) {
      this.msgText = t('mod.fuse.failed');
    } else if (!result.ok) {
      this.msgText = result.code === 'not-owned' ? t('mod.fuse.notOwned') : t('mod.fuse.failed');
    } else {
      const rarityLabel = moduleRarityLabel(result.rarity ?? 'normal');
      this.msgText =
        result.promoted === true
          ? t('mod.fuse.promoted', { rarity: rarityLabel })
          : t('mod.fuse.done', { rarity: rarityLabel });
    }
    await this.reload();
  }

  // --- 상호작용 --------------------------------------------------------------

  private ownedById(id: string): ModuleOwned | undefined {
    return this.inventory.find((m) => m.id === id);
  }

  /** 현재 합성 선택된 소유 모듈 목록(존재하는 것만). */
  private pickedOwned(): ModuleOwned[] {
    const out: ModuleOwned[] = [];
    for (const id of this.fusePicks) {
      const owned = this.ownedById(id);
      if (owned !== undefined) out.push(owned);
    }
    return out;
  }

  /**
   * 합성 선택 토글. 상한(3개)은 여기서 지킨다 — 비활성 버튼은 이벤트를 받지 않아 클릭이
   * 행 선택으로 넘어오므로, 버튼 disabled 만으로는 상한이 강제되지 않는다.
   */
  private togglePick(id: string): void {
    if (this.busy) return;
    if (this.fusePicks.has(id)) this.fusePicks.delete(id);
    else if (this.fusePicks.size < MODULE_FUSION_INPUT_COUNT) this.fusePicks.add(id);
    this.render();
  }

  private close(): void {
    const cb = this.onClose;
    this.hide();
    cb?.();
  }

  // --- 공용 렌더 조각 ---------------------------------------------------------

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

  /** 패널 제목 — top = 콘텐츠 상자 top(제목이 나무 테두리에 붙던 결함 재발 방지). */
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

  /**
   * 조회 실패 안내 + [다시 시도]. 실패는 사용자가 손쓸 수 있는 상태라 문구만 띄우고 끝내면
   * 화면을 닫았다 여는 것 말고는 방법이 없다 — 재조회 버튼을 같은 자리에 붙인다.
   */
  private failedPanel(parent: Container, box: PanelContentBox, top = CONTENT_TOP + 40): void {
    // 문구는 판정 함수에서 받는다 — 여기에 키를 직접 박으면 판정과 화면이 갈라진다.
    const el = this.wrapped(t(panelMessageKey('failed') ?? 'mod.load.failed'), 19, COLOR.muted, box.w);
    el.anchor.set(0.5, 0);
    el.position.set(box.x + box.w / 2, top);
    parent.addChild(el);

    const retry = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: RETRY_W,
      height: RETRY_H,
      fontSize: 18,
      label: stripEmoji(t('mod.load.retry')),
      onClick: () => void this.reload(),
    });
    retry.container.position.set(box.x + (box.w - RETRY_W) / 2, top + el.height + RETRY_GAP);
    if (this.busy) retry.setEnabled(false);
    parent.addChild(retry.container);
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
   * 행 목록을 스크롤 영역에 깐다(공용 부품 위임). 마스크 높이는 **행 경계로 클램프**해
   * 마지막 행이 반토막 나지 않게 한다.
   */
  private layoutRows(
    panel: Container,
    box: PanelContentBox,
    top: number,
    rows: readonly { node: Container; h: number }[],
    gap: number,
    get: () => number,
    set: (v: number) => void,
  ): void {
    const bounds = rowBounds(
      rows.map((r) => r.h),
      gap,
    );
    const total = bounds.length > 0 ? bounds[bounds.length - 1]! : 0;
    const maskH = clampToRows(box.bottom - top, bounds);
    const content = makeScrollArea(panel, {
      x: box.x,
      y: top,
      w: box.w,
      h: maskH,
      totalH: total,
      get,
      set,
      // 마스크를 행 경계로 자르면 마지막 행이 온전히 보여 **잘렸다는 신호가 사라진다** —
      // 위치 표시가 유일한 "더 있다" 단서다(스크롤할 게 없으면 그려지지 않는다).
      thumb: true,
    });
    let cy = 0;
    for (const row of rows) {
      row.node.position.set(0, cy);
      content.addChild(row.node);
      cy += row.h + gap;
    }
  }

  // --- 렌더 ------------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    // 배경(불투명 — 뒤 방어 프리뷰를 가린다).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChild(bg);

    this.renderTitleBar();

    const h = BOARD_BOTTOM - BOARD_TOP;
    if (this.loading || !this.online) {
      const { panel, box } = this.addPanel(MARGIN, BOARD_TOP, BOARD_W, 320);
      this.panelTitle(panel, box, t('mod.slot.head'));
      this.msg(panel, box, this.loading ? t('mod.slot.loading') : t('mod.slot.offline'));
    } else {
      this.renderSlotPanel(MARGIN, BOARD_TOP, COL_SLOT, h);
      this.renderInventoryPanel(MARGIN + COL_SLOT + GAP, BOARD_TOP, COL_INV, h);
      this.renderShopPanel(MARGIN + COL_SLOT + GAP + COL_INV + GAP, BOARD_TOP, COL_SHOP, h);
    }

    this.renderFooter();
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('mod.title'), this.ui['ui_banner.png']);
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
      label: stripEmoji(t('mod.back')),
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

  // --- 코어 모듈 슬롯(2) ------------------------------------------------------

  /** 슬롯 2칸 목록 — 각 칸은 장착 모듈 요약 또는 빈 슬롯 안내. 클릭하면 장착 대상이 된다. */
  private renderSlotPanel(x: number, y: number, w: number, h: number): void {
    const { panel, box } = this.addPanel(x, y, w, h);
    this.panelTitle(panel, box, t('mod.slot.head'));

    const equip = this.equip;
    const kind = slotPanelKind({ equip, failed: this.equipFailed });
    if (kind !== 'slots' || equip === null || equip.defenseId === null) {
      // 조회 실패("모른다")와 방어 미배치("아직 안 짰다")를 다른 문구로 가른다.
      if (kind === 'failed') this.failedPanel(panel, box);
      else this.msg(panel, box, t(panelMessageKey(kind) ?? 'mod.slot.noBase'));
      return;
    }
    const defenseId = equip.defenseId;

    const rows: { node: Container; h: number }[] = [];
    for (let i = 0; i < MODULE_EQUIP_SLOTS; i++) {
      const moduleId = equip.equipped[i] ?? null;
      const owned = moduleId !== null ? this.ownedById(moduleId) : undefined;
      rows.push(this.makeSlotRow(i, owned, box.w, defenseId));
    }
    this.layoutRows(
      panel,
      box,
      CONTENT_TOP,
      rows,
      SLOT_ROW_GAP,
      () => 0,
      () => {
        /* 슬롯은 2칸이라 항상 다 보인다 — 스크롤 상태를 둘 필요가 없다. */
      },
    );

    const hint = this.wrapped(t('mod.slot.autoHint'), 16, COLOR.muted, box.w);
    hint.anchor.set(0.5, 1);
    hint.position.set(box.x + box.w / 2, box.bottom);
    panel.addChild(hint);
  }

  /** 슬롯 1칸. 행 전체가 "이 슬롯을 장착 대상으로" 선택 토글이다. */
  private makeSlotRow(
    index: number,
    owned: ModuleOwned | undefined,
    w: number,
    defenseId: string,
  ): { node: Container; h: number } {
    const selected = this.selectedSlot === index;
    const row = new Container();
    // 선택 클릭은 **행 Container** 가 받는다(바탕 Graphics 면 위에 얹힌 텍스트가 삼킨다).
    attachRowClick(row, () => {
      if (this.busy) return;
      this.selectedSlot = selected ? null : index;
      this.render();
    });

    const inner = new Container();
    let cy = 14;
    const put = (el: Text): void => {
      el.position.set(16, cy);
      inner.addChild(el);
      cy += el.height + 6;
    };

    const head = `${t('mod.slot.label', { n: index + 1 })}${selected ? ` · ${t('mod.slot.selected')}` : ''}`;
    put(this.label(head, 20, selected ? COLOR.gold : COLOR.cream, '800', w - 32));

    if (owned === undefined) {
      put(this.wrapped(t('mod.slot.empty'), 17, COLOR.muted, w - 32));
      put(this.wrapped(t('mod.slot.emptyHint'), 15, COLOR.muted, w - 32));
      const h = cy + 8;
      row.addChild(listRowBg(w, h, { selected }));
      row.addChild(inner);
      return { node: row, h };
    }

    const accent = hexColor(moduleRarityColor(owned.rarity));
    put(
      this.label(
        `${t('mod.slot.equipped')} · ${moduleRarityLabel(owned.rarity)}`,
        19,
        accent,
        '800',
        w - 32 - UNEQUIP_W,
      ),
    );
    put(
      this.label(
        t('mod.slot.charges', { n: owned.chargesLeft, m: owned.module.chargesMax }),
        17,
        isLowCharge(owned.chargesLeft) ? WARN_COLOR : COLOR.cream,
        '700',
      ),
    );
    if (isLowCharge(owned.chargesLeft)) {
      put(this.wrapped(t('mod.slot.lastCharge'), 15, WARN_COLOR, w - 32, '700'));
    }
    put(this.wrapped(moduleAffixOneLine(owned.module), 15, COLOR.muted, w - 32));

    const h = cy + 8;
    row.addChild(listRowBg(w, h, selected ? { selected: true } : { accent }));
    row.addChild(inner);

    const unequip = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: UNEQUIP_W,
      height: UNEQUIP_H,
      fontSize: 17,
      label: stripEmoji(t('mod.slot.unequip')),
      onClick: () => void this.doEquip(defenseId, index, null),
    });
    unequip.container.position.set(w - UNEQUIP_W - 12, 12);
    // 해제 버튼 클릭이 행 선택 토글까지 함께 발동하지 않게 끊는다.
    stopRowPropagation(unequip.container);
    row.addChild(unequip.container);
    if (this.busy) unequip.setEnabled(false);

    return { node: row, h };
  }

  // --- 보관함 ----------------------------------------------------------------

  /** 보관 게이지 + 합성 바 + 모듈 목록(장착/분해 또는 합성 선택). */
  private renderInventoryPanel(x: number, y: number, w: number, h: number): void {
    const { panel, box } = this.addPanel(x, y, w, h);
    this.panelTitle(panel, box, t('mod.inv.head'));

    const kind = inventoryPanelKind({ count: this.inventory.length, failed: this.invFailed });
    if (kind === 'failed') {
      // 조회 실패에 "보관 0/20" 게이지·합성 버튼을 함께 그리면 **모듈이 0개라고 단정**하는 화면이
      // 된다. 실패일 때는 수치를 아예 말하지 않는다.
      this.failedPanel(panel, box);
      return;
    }

    const gauge = storageGauge(this.inventory.length);
    const gaugeLabel = this.label(t('mod.inv.storage', { count: gauge.count, cap: gauge.cap }), 18, COLOR.cream, '700');
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
      const full = this.wrapped(t('mod.inv.full'), 16, WARN_COLOR, box.w, '700');
      full.position.set(box.x, top);
      panel.addChild(full);
      top += full.height + 6;
    }

    top = this.renderFuseBar(panel, box, top) + 14;

    if (kind === 'empty') {
      this.msg(panel, box, t(panelMessageKey(kind) ?? 'mod.inv.empty'), top + 20);
      return;
    }

    const equippedIds = new Set((this.equip?.equipped ?? []).filter((v): v is string => v !== null));
    const rows = this.inventory.map((owned) => this.makeInvRow(owned, box.w, equippedIds));
    this.layoutRows(
      panel,
      box,
      top,
      rows,
      INV_ROW_GAP,
      () => this.invScrollY,
      (v) => {
        this.invScrollY = v;
      },
    );
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
        label: stripEmoji(t('mod.inv.fuseStart')),
        onClick: () => {
          this.fuseMode = true;
          this.fusePicks.clear();
          this.msgText = t('mod.inv.fuseMode');
          this.render();
        },
      });
      start.container.position.set(box.x, top);
      panel.addChild(start.container);
      if (this.busy || this.inventory.length < MODULE_FUSION_INPUT_COUNT) start.setEnabled(false);
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
      label: stripEmoji(t('mod.inv.fuseConfirm', { n: this.fusePicks.size })),
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
      label: stripEmoji(t('mod.inv.fuseCancel')),
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
  private makeInvRow(
    owned: ModuleOwned,
    w: number,
    equippedIds: ReadonlySet<string>,
  ): { node: Container; h: number } {
    const isEquipped = equippedIds.has(owned.id);
    const isPicked = this.fusePicks.has(owned.id);
    const rarityColor = hexColor(moduleRarityColor(owned.rarity));

    const row = new Container();
    const btnCount = this.fuseMode ? 1 : 2;
    const btnZone = btnCount * INV_BTN_W + (btnCount - 1) * 8 + 24;
    const textW = Math.max(120, w - btnZone - 20);

    const grade = this.label(moduleRarityLabel(owned.rarity), 20, rarityColor, '800');
    grade.position.set(16, 12);

    const charges = this.label(
      t('mod.inv.charges', { n: owned.chargesLeft }),
      16,
      isLowCharge(owned.chargesLeft) ? WARN_COLOR : COLOR.muted,
      '700',
    );
    charges.position.set(16 + grade.width + 10, 16);

    const affix = this.wrapped(moduleAffixOneLine(owned.module), 15, COLOR.muted, textW);
    affix.position.set(16, 42);

    const h = Math.max(78, 42 + affix.height + 14);

    // 선택 클릭은 **행 전체**가 받는다(바탕 Graphics 면 텍스트 위 클릭이 먹지 않는다).
    if (this.fuseMode) attachRowClick(row, () => this.togglePick(owned.id));
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
        label: stripEmoji(isPicked ? t('mod.inv.picked') : t('mod.inv.pick')),
        onClick: () => this.togglePick(owned.id),
      });
      pick.container.position.set(w - INV_BTN_W - 12, btnY);
      // 버튼 클릭이 행 토글까지 겹쳐 두 번 뒤집히지 않게 끊는다.
      stopRowPropagation(pick.container);
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
      label: stripEmoji(isEquipped ? t('mod.inv.equipped') : t('mod.inv.equip')),
      onClick: () => this.equipToSlot(owned.id),
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
      label: stripEmoji(t('mod.inv.salvage')),
      onClick: () => void this.doSalvage(owned.id),
    });
    sv.container.position.set(w - INV_BTN_W - 12, btnY);
    row.addChild(sv.container);
    if (this.busy) sv.setEnabled(false);

    return { node: row, h };
  }

  // --- 일일 상점 --------------------------------------------------------------

  /** 오늘 재고(옵션 미리 공개 · 가격), 이미 산 슬롯은 비활성. */
  private renderShopPanel(x: number, y: number, w: number, h: number): void {
    const { panel, box } = this.addPanel(x, y, w, h);
    this.panelTitle(panel, box, t('mod.shop.head'));

    const note = this.wrapped(t('mod.shop.note'), 15, COLOR.muted, box.w);
    note.position.set(box.x, CONTENT_TOP);
    panel.addChild(note);
    const top = CONTENT_TOP + note.height + 12;

    if (this.shop.length === 0) {
      this.msg(panel, box, t('mod.shop.empty'), top + 20);
      return;
    }

    const storageFull = storageGauge(this.inventory.length).full;
    const rows = this.shop.map((mod, i) => this.makeShopRow(mod, i, box.w, storageFull));
    this.layoutRows(
      panel,
      box,
      top,
      rows,
      SHOP_ROW_GAP,
      () => this.shopScrollY,
      (v) => {
        this.shopScrollY = v;
      },
    );
  }

  /**
   * 상점 1행. 열이 좁아 구매 버튼은 문구 **옆이 아니라 아래**에 둔다 — 옆에 붙이면 어픽스
   * 문구 폭이 눌려 가로 축소가 걸리고 읽을 수 없다(관제탑 교훈).
   */
  private makeShopRow(
    mod: ModuleInstance,
    slotIndex: number,
    w: number,
    storageFull: boolean,
  ): { node: Container; h: number } {
    const bought = this.purchases.includes(slotIndex);
    const rarityColor = hexColor(moduleRarityColor(mod.rarity));
    const row = new Container();

    const head = this.label(
      `${moduleRarityLabel(mod.rarity)} · ${t('mod.shop.price', { c: shopSlotPrice(mod.rarity) })}`,
      19,
      rarityColor,
      '800',
      w - 32,
    );
    head.position.set(16, 12);

    // 소모품이라는 사실이 구매 전에 보여야 한다 — 잔여 횟수를 재고에서 미리 드러낸다.
    const charges = this.label(
      t('mod.slot.charges', { n: mod.chargesLeft, m: mod.chargesMax }),
      15,
      COLOR.muted,
      '700',
      w - 32,
    );
    charges.position.set(16, 38);

    const affix = this.wrapped(moduleAffixOneLine(mod), 15, COLOR.muted, w - 32);
    affix.position.set(16, 62);

    const btnY = 62 + affix.height + 10;
    const h = btnY + SHOP_BTN_H + 12;

    row.addChild(listRowBg(w, h, bought ? {} : { accent: rarityColor }));
    row.addChild(head, charges, affix);

    const canBuy = !bought && !storageFull && !this.busy;
    const buy = new PixiButton({
      texture: this.ui[canBuy ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: canBuy ? 0x9a7a2a : 0x4a3a24,
      width: SHOP_BTN_W,
      height: SHOP_BTN_H,
      fontSize: 18,
      ...(canBuy ? { labelColor: COLOR.darkLabel } : {}),
      label: stripEmoji(bought ? t('mod.shop.bought') : t('mod.shop.buy')),
      onClick: () => void this.doBuy(slotIndex),
    });
    buy.container.position.set(w - SHOP_BTN_W - 16, btnY);
    row.addChild(buy.container);
    if (!canBuy) buy.setEnabled(false);

    return { node: row, h };
  }
}
