/**
 * 챔피언(기체) 선택 화면 — Pixi (M8-L8, 설계서 §6·§8).
 *
 * 격납고에서 진입한다. 좌측에 로스터 목록(`SHIP_TYPES` 전량 — ADR-0019 **해금 게이트 없음**),
 * 우측에 선택한 타입의 쇼케이스 · 시그니처 패시브 · 섀시 보정(basis-point) · 3계열 미리보기를
 * 보여 주고, 확정하면 **현역 기체를 퇴역시키고 그 타입의 새 기체로 세대 교체**한다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거, 설계서 §8)
 * - **DOM 혼용 금지.** 캔버스는 남은 DOM 오버레이 아래로 깔리고 z-index 로 못 뒤집는다(ADR-0014).
 * - **목록 행 클릭은 행 Container 에.** 바탕 Graphics 에 걸면 위에 얹힌 텍스트가 클릭을 삼킨다
 *   ({@link attachRowClick} 이 그 규칙을 대신 지킨다).
 * - **휠은 클립 Container + hitArea 에.** 마스크 Graphics 는 히트 테스트에서 제외된다
 *   ({@link makeScrollArea}).
 * - **여백은 `panelContent` 상자 안에만.** 제목이 나무 테두리에 붙는 결함이 2회 재발했다.
 * - **밝은 화면 위 팝업은 `fillAlpha: 1`** — `makeModal` 이 이미 1 로 고정한다.
 * - **격납고와는 `suspend()`/`resume()`** — `show()` 로 되돌리면 미저장 장비 편집이 사라진다.
 * - **리스너는 재빌드 밖이 아니라 wipe-then-rebuild 규약으로** 다룬다: `render()` 가 매번 자식을
 *   전부 파괴하고 새로 만들므로 리스너가 두 번 등록될 수 없다(격납고 `render()` 와 같은 규약).
 * - 이름에 **컬러 이모지 금지**(`text.ts` stripEmoji 가 두부로 떨군다). ★ 는 보존 목록이다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import {
  SHIP_TYPES,
  selectableShipTypes,
  shipTypeDef,
  flattenShipNodes,
  shipCapstoneIndex,
  type ShipTypeDef,
} from '../../../data/ships/index.js';
import {
  activeShip,
  saveProfile,
  type KeyValueStore,
  type Profile,
} from '../../save/profile.js';
import { retireActiveShip } from '../../save/guardianLifecycle.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, shipShowcaseName, LEGACY_SHOWCASE, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeBanner, makeIconButton } from './titleBar.js';
import { listRowBg, attachRowClick } from './listRow.js';
import { makeScrollArea } from './scrollArea.js';
import { makeModal } from './modal.js';

import {
  shipTypeName,
  shipTypeRole,
  shipSignatureDesc,
  shipTreeName,
  tShipKey,
  AFFINITY_ACCENT,
} from './shipLabels.js';

// --- 레이아웃(디자인 스페이스 1920×1080) ---
const BANNER_W = 640;
const BANNER_H = 72;
const BANNER_Y = 10;

const ROSTER_X = 40;
const ROSTER_Y = 112;
const ROSTER_W = 560;
const ROSTER_H = 860;
const ROSTER_BOX = panelContent(ROSTER_W, ROSTER_H);
/** 로스터 행 한 칸(아이콘 + 이름 + 역할 한 줄). */
export const ROSTER_ROW_H = 96;
export const ROSTER_ROW_GAP = 10;
const ROSTER_LIST_TOP = 96;
const ROSTER_ICON = 64;

const DETAIL_X = 632;
const DETAIL_Y = 112;
const DETAIL_W = 1248;
const DETAIL_H = 860;
const DETAIL_BOX = panelContent(DETAIL_W, DETAIL_H);
/** 쇼케이스 그림 한 변(원본 128×128 을 정수배로 키운다 — nearest 라 흐려지지 않는다). */
const SHOWCASE = 256;

const CONFIRM_W = 380;
const CONFIRM_H = 64;

const MODAL_W = 760;
const MODAL_H = 420;

const HINT_Y = DESIGN_HEIGHT - 10;

/**
 * 섀시 보정 4축의 표시 순서·라벨 키. bp(basis-point) 를 퍼센트로 보여 준다.
 * `fireRateBp` 는 **양수가 연사 상향**이라는 축 방향을 그대로 쓴다(데이터와 화면을 뒤집지 않는다).
 */
const BP_ROWS: readonly [keyof ShipTypeDef['baseBp'], string, string][] = [
  ['damageBp', 'champion.bp.damage', 'Damage'],
  ['fireRateBp', 'champion.bp.fireRate', 'Fire rate'],
  ['maxHpBp', 'champion.bp.maxHp', 'Hull'],
  ['moveSpeedBp', 'champion.bp.moveSpeed', 'Speed'],
];

/** bp → 부호 있는 퍼센트 문자열(정수 bp 단일 나눗셈 — 표시 전용이라 결정론 대상은 아니다). */
export function formatBp(bp: number): string {
  if (bp === 0) return '—';
  const pct = bp / 100;
  const shown = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return bp > 0 ? `+${shown}%` : `${shown}%`;
}

/** 로스터 목록 전체 세로(마지막 행 뒤 간격 제외). 순수 — 스크롤 필요 여부의 산술 전제. */
export function rosterStackHeight(count: number): number {
  if (count <= 0) return 0;
  return count * (ROSTER_ROW_H + ROSTER_ROW_GAP) - ROSTER_ROW_GAP;
}

/** 로스터 목록에 쓸 수 있는 세로(콘텐츠 상자 안, 확정 버튼 위까지). */
export const ROSTER_LIST_AVAIL = ROSTER_BOX.bottom - CONFIRM_H - 16 - ROSTER_LIST_TOP;

/**
 * 챔피언 확정의 **전부**: 현역 기체를 퇴역시키고 `typeId` 의 새 기체로 세대 교체한 뒤 저장한다.
 *
 * 클래스 밖 순수(=Pixi 미의존) 함수로 뽑아 둔 이유는 설계서 §10-5 다 — "챔피언 선택이 그려지나
 * 선택이 저장 안 됨" 은 렌더 테스트가 절대 못 잡는 결함이라, **화면이 실제로 호출하는 바로 그
 * 함수**를 캔버스 없이 검증할 수 있어야 한다. 화면은 이 함수 하나만 부른다.
 *
 * `retireActiveShip` 이 수호 스냅샷 · 계보 지급 · 장비 창고 회수 · 신규 기체 push ·
 * `activeShipIndex` 이동 · 폐기 예정 별칭(`profile.skillInvest`) 재바인딩까지 처리한다.
 * 여기서 `saveProfile` 을 빠뜨리면 화면상으로는 정상이고 **다음 실행에서만** 드러난다.
 *
 * @returns 실제로 활성이 된 타입 id(손상 입력은 레지스트리가 0 으로 되돌린다).
 */
export function applyChampionChoice(
  profile: Profile,
  typeId: number,
  store: KeyValueStore | null,
): number {
  const result = retireActiveShip(profile, undefined, typeId);
  saveProfile(profile, store);
  return result.ship.typeId;
}

export interface ChampionSelectCallbacks {
  /** 화면을 닫을 때(확정·취소 공통). 격납고가 `resume()` 하는 자리. */
  onClose: () => void;
  /** 확정 직후(세대 교체 완료). 격납고가 자기 화면을 다시 그리는 자리. */
  onConfirmed?: (typeId: number) => void;
}

export class ChampionSelectScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private cb: ChampionSelectCallbacks | null = null;
  private ui: UiTextures = {};
  private selected = 0;
  private scrollY = 0;
  private confirming = false;
  private hint = '';

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // 텍스처는 나중에 도착한다 — 도착하면 열려 있을 때만 다시 그린다(리스너는 render 가
    // 매번 새로 만들므로 이중 등록이 생기지 않는다).
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** 현재 선택된 타입 id(테스트·호출자 확인용). */
  get selectedTypeId(): number {
    return this.selected;
  }

  show(profile: Profile, cb: ChampionSelectCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.hint = '';
    this.confirming = false;
    this.scrollY = 0;
    // 기본 선택은 **현역 기체 타입** — "지금 무엇을 타고 있는지" 에서 출발해야 비교가 된다.
    this.selected = shipTypeDef(activeShip(profile).typeId).id;
    this.render();
    this.root.visible = true;
    this.raise();
    this.hideRunHud(true);
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    this.hideRunHud(false);
  }

  /** 다른 캔버스 화면에 자리를 내주고 잠시 감춘다(상태 보존). */
  suspend(): void {
    this.root.visible = false;
  }

  resume(): void {
    this.root.visible = true;
    this.raise();
    this.render();
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  /** 런 전용 DOM HUD 는 캔버스 메타 화면 위에 떠 보이므로 감춘다(node 환경 가드 포함). */
  private hideRunHud(hidden: boolean): void {
    if (typeof document === 'undefined') return;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = hidden ? 'hidden' : '';
  }

  // --- 동작 ----------------------------------------------------------------

  private select(typeId: number): void {
    this.selected = shipTypeDef(typeId).id;
    this.hint = '';
    this.render();
  }

  /**
   * 확정 = **퇴역 + 세대 교체**. `retireActiveShip` 이 수호 스냅샷·계보 지급·장비 회수·신규 기체
   * push·`activeShipIndex` 이동·폐기 예정 별칭 재바인딩까지 한 번에 처리한다.
   *
   * ⚠️ 여기서 저장을 빠뜨리면 설계서 §10-5 가 예측한 결함("그려지는데 선택이 저장 안 됨")이
   * 그대로 재현된다 — 화면은 정상으로 보이고 다음 실행에서만 드러난다. 그래서 store 에 대한
   * 실제 write 를 테스트가 확인한다.
   */
  private confirm(): void {
    const typeId = applyChampionChoice(this.profile, this.selected, this.store);
    this.confirming = false;
    const cb = this.cb;
    this.hide();
    cb?.onConfirmed?.(typeId);
    cb?.onClose();
  }

  private close(): void {
    const cb = this.cb;
    this.hide();
    cb?.onClose();
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤 화면으로 이벤트가 새지 않게 막는다.
    this.root.addChild(bg);

    this.renderTitleBar();
    this.renderRoster();
    this.renderDetail();
    this.renderHint();
    if (this.confirming) this.renderConfirmModal();
  }

  private renderTitleBar(): void {
    const banner = makeBanner(
      BANNER_W,
      BANNER_H,
      tShipKey('champion.title', 'Choose Your Ship'),
      this.ui['ui_banner.png'],
    );
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const close = makeIconButton(56, () => this.close(), this.ui['ui_icon_close.png']);
    close.position.set(DESIGN_WIDTH - 24 - 56, 12);
    this.root.addChild(close);
  }

  private renderRoster(): void {
    const panel = new Container();
    panel.position.set(ROSTER_X, ROSTER_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(ROSTER_W, ROSTER_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    const title = new Text({
      resolution: 2,
      text: tShipKey('champion.roster', 'Roster'),
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    title.position.set(ROSTER_BOX.x, ROSTER_BOX.y);
    panel.addChild(title);

    const sub = new Text({
      resolution: 2,
      // ADR-0019: 전체 개방이 **명시적 결정**이다. 이 안내가 그 결정을 화면에서도 못박는다.
      text: tShipKey('champion.rosterSub', 'All ships are available — no unlock requirements.'),
      style: { fontFamily: UI_FONT, fontSize: 14, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.position.set(ROSTER_BOX.x, ROSTER_BOX.y + 38);
    panel.addChild(sub);

    const roster = selectableShipTypes();
    const totalH = rosterStackHeight(roster.length);
    const content = makeScrollArea(panel, {
      x: ROSTER_BOX.x,
      y: ROSTER_LIST_TOP,
      w: ROSTER_BOX.w,
      h: ROSTER_LIST_AVAIL,
      totalH,
      get: () => this.scrollY,
      set: (v) => {
        this.scrollY = v;
      },
    });

    roster.forEach((def, i) => {
      const row = this.makeRosterRow(def);
      row.position.set(0, i * (ROSTER_ROW_H + ROSTER_ROW_GAP));
      content.addChild(row);
    });

    // 확정 버튼 — 콘텐츠 상자 바닥에 붙인다(목록과의 간격이 자동으로 남는다).
    const current = shipTypeDef(activeShip(this.profile).typeId);
    const def = shipTypeDef(this.selected);
    const btn = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      width: Math.min(CONFIRM_W, ROSTER_BOX.w),
      height: CONFIRM_H,
      fontSize: 20,
      labelColor: COLOR.darkLabel,
      label: tShipKey('champion.confirm', 'Retire & Switch', { name: shipTypeName(def) }),
      onClick: () => {
        this.confirming = true;
        this.render();
      },
    });
    btn.container.position.set(
      ROSTER_BOX.x + Math.round((ROSTER_BOX.w - Math.min(CONFIRM_W, ROSTER_BOX.w)) / 2),
      ROSTER_BOX.bottom - CONFIRM_H,
    );
    panel.addChild(btn.container);

    const note = new Text({
      resolution: 2,
      text: tShipKey('champion.current', 'Current: {name}', { name: shipTypeName(current) }),
      style: { fontFamily: UI_FONT, fontSize: 14, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    note.anchor.set(0.5, 1);
    note.position.set(ROSTER_W / 2, ROSTER_BOX.bottom - CONFIRM_H - 8);
    panel.addChild(note);
  }

  private makeRosterRow(def: ShipTypeDef): Container {
    const selected = def.id === this.selected;
    const row = new Container();
    row.addChild(listRowBg(ROSTER_BOX.w, ROSTER_ROW_H, { selected }));

    const tex = this.ui[shipShowcaseName(def.id)] ?? this.ui[LEGACY_SHOWCASE];
    const iconX = 14;
    const iconY = Math.round((ROSTER_ROW_H - ROSTER_ICON) / 2);
    if (tex) {
      const sp = new Sprite(tex);
      sp.width = ROSTER_ICON;
      sp.height = ROSTER_ICON;
      sp.position.set(iconX, iconY);
      row.addChild(sp);
    } else {
      const g = new Graphics();
      g.roundRect(iconX, iconY, ROSTER_ICON, ROSTER_ICON, 10)
        .fill({ color: 0x000000, alpha: 0.28 })
        .stroke({ color: COLOR.gold, width: 2, alpha: selected ? 0.9 : 0.45 });
      row.addChild(g);
    }

    const textX = iconX + ROSTER_ICON + 14;
    const name = new Text({
      resolution: 2,
      text: shipTypeName(def),
      style: {
        fontFamily: UI_FONT,
        fontSize: 21,
        fontWeight: '800',
        fill: selected ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.position.set(textX, 18);
    row.addChild(name);

    const role = new Text({
      resolution: 2,
      text: shipTypeRole(def),
      style: {
        fontFamily: UI_FONT,
        fontSize: 14,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: ROSTER_BOX.w - textX - 16,
        lineHeight: 18,
        dropShadow: TEXT_SHADOW,
      },
    });
    role.position.set(textX, 48);
    row.addChild(role);

    // 클릭은 **행 Container** 에(바탕 Graphics 면 위 텍스트가 삼킨다).
    attachRowClick(row, () => this.select(def.id));
    return row;
  }

  private renderDetail(): void {
    const def = shipTypeDef(this.selected);
    const panel = new Container();
    panel.position.set(DETAIL_X, DETAIL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(DETAIL_W, DETAIL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    const title = new Text({
      resolution: 2,
      text: shipTypeName(def),
      style: { fontFamily: UI_FONT, fontSize: 32, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    title.position.set(DETAIL_BOX.x, DETAIL_BOX.y);
    panel.addChild(title);

    const role = new Text({
      resolution: 2,
      text: shipTypeRole(def),
      style: {
        fontFamily: UI_FONT,
        fontSize: 16,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: DETAIL_BOX.w - SHOWCASE - 40,
        lineHeight: 22,
        dropShadow: TEXT_SHADOW,
      },
    });
    role.position.set(DETAIL_BOX.x, DETAIL_BOX.y + 44);
    panel.addChild(role);

    // 쇼케이스 — 없으면 레거시 텍스처, 그것도 없으면 Graphics(아트가 코드보다 늦게 온다).
    const showX = DETAIL_BOX.right - SHOWCASE;
    const showY = DETAIL_BOX.y + 20;
    const tex = this.ui[shipShowcaseName(def.id)] ?? this.ui[LEGACY_SHOWCASE];
    if (tex) {
      const sp = new Sprite(tex);
      sp.width = SHOWCASE;
      sp.height = SHOWCASE;
      sp.position.set(showX, showY);
      panel.addChild(sp);
    } else {
      const g = new Graphics();
      g.moveTo(showX + SHOWCASE / 2, showY + 20)
        .lineTo(showX + SHOWCASE - 30, showY + SHOWCASE - 20)
        .lineTo(showX + 30, showY + SHOWCASE - 20)
        .closePath()
        .fill({ color: 0x39d0ff })
        .stroke({ color: 0xffffff, width: 3 });
      panel.addChild(g);
    }

    this.renderSignature(panel, def, DETAIL_BOX.y + 150);
    this.renderBpTable(panel, def, DETAIL_BOX.y + 300);
    this.renderTreePreview(panel, def, DETAIL_BOX.y + 470);
  }

  /** 시그니처 패시브 카드. 스트라이커는 "없음" 을 명시한다(설계서 §11 — 의도된 부재다). */
  private renderSignature(panel: Container, def: ShipTypeDef, y: number): void {
    const head = new Text({
      resolution: 2,
      text: tShipKey('champion.signature', 'Signature'),
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    head.position.set(DETAIL_BOX.x, y);
    panel.addChild(head);

    const desc = shipSignatureDesc(def);
    const body = new Text({
      resolution: 2,
      text:
        def.signatureBit < 0
          ? tShipKey('champion.signature.none', 'No signature passive — a clean baseline chassis.')
          : desc,
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fill: def.signatureBit < 0 ? COLOR.muted : COLOR.cream,
        wordWrap: true,
        wordWrapWidth: DETAIL_BOX.w - 20,
        lineHeight: 21,
        dropShadow: TEXT_SHADOW,
      },
    });
    body.position.set(DETAIL_BOX.x, y + 30);
    panel.addChild(body);
  }

  /** 섀시 보정 4축 — 값이 0 인 축도 보여 준다(스트라이커가 "전 축 0" 임을 화면이 말한다). */
  private renderBpTable(panel: Container, def: ShipTypeDef, y: number): void {
    const head = new Text({
      resolution: 2,
      text: tShipKey('champion.chassis', 'Chassis'),
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    head.position.set(DETAIL_BOX.x, y);
    panel.addChild(head);

    const colW = Math.floor(DETAIL_BOX.w / BP_ROWS.length);
    BP_ROWS.forEach(([key, msgKey, fallback], i) => {
      const bp = def.baseBp[key];
      const x = DETAIL_BOX.x + i * colW;
      const k = new Text({
        resolution: 2,
        text: tShipKey(msgKey, fallback),
        style: { fontFamily: UI_FONT, fontSize: 15, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      k.position.set(x, y + 34);
      panel.addChild(k);
      const v = new Text({
        resolution: 2,
        text: formatBp(bp),
        style: {
          fontFamily: UI_FONT,
          fontSize: 22,
          fontWeight: '800',
          fill: bp > 0 ? 0x8affc0 : bp < 0 ? 0xff9a7a : COLOR.muted,
          dropShadow: TEXT_SHADOW,
        },
      });
      v.position.set(x, y + 58);
      panel.addChild(v);
    });
  }

  /** 3계열 미리보기 — 계열명(affinity 색) + 노드 수 + 캡스톤 이름. */
  private renderTreePreview(panel: Container, def: ShipTypeDef, y: number): void {
    const head = new Text({
      resolution: 2,
      text: tShipKey('champion.trees', 'Skill trees'),
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    head.position.set(DETAIL_BOX.x, y);
    panel.addChild(head);

    const nodes = flattenShipNodes(def);
    const gap = 16;
    const colW = Math.floor((DETAIL_BOX.w - gap * (def.trees.length - 1)) / def.trees.length);
    def.trees.forEach((tree, i) => {
      const accent = AFFINITY_ACCENT[tree.affinity];
      const x = DETAIL_BOX.x + i * (colW + gap);
      const card = new Container();
      card.position.set(x, y + 34);
      panel.addChild(card);
      card.addChild(listRowBg(colW, 150, { accent }));

      const name = new Text({
        resolution: 2,
        text: shipTreeName(tree),
        style: { fontFamily: UI_FONT, fontSize: 19, fontWeight: '800', fill: accent, dropShadow: TEXT_SHADOW },
      });
      name.position.set(12, 12);
      if (name.width > colW - 24) name.scale.x = (colW - 24) / name.width;
      card.addChild(name);

      const meta = new Text({
        resolution: 2,
        text: tShipKey('champion.tree.meta', '{n} nodes · gate {g}', {
          n: def.nodesPerTree,
          g: def.capstoneGate,
        }),
        style: { fontFamily: UI_FONT, fontSize: 13, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      meta.position.set(12, 40);
      card.addChild(meta);

      const capstone = nodes[shipCapstoneIndex(def, i)];
      const cap = new Text({
        resolution: 2,
        text: capstone === undefined ? '' : `★ ${capstone.name}`,
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fontWeight: '700',
          fill: COLOR.gold,
          wordWrap: true,
          wordWrapWidth: colW - 24,
          lineHeight: 19,
          dropShadow: TEXT_SHADOW,
        },
      });
      cap.position.set(12, 66);
      card.addChild(cap);

      const capDesc = new Text({
        resolution: 2,
        text: capstone?.desc ?? '',
        style: {
          fontFamily: UI_FONT,
          fontSize: 12,
          fill: COLOR.muted,
          wordWrap: true,
          wordWrapWidth: colW - 24,
          lineHeight: 16,
          dropShadow: TEXT_SHADOW,
        },
      });
      capDesc.position.set(12, 100);
      card.addChild(capDesc);
    });
  }

  /**
   * 퇴역 확인 팝업. 되돌릴 수 없는 세대 리셋이므로 **무엇을 잃는지 먼저 말한다** —
   * 레벨·투자·장착이 사라지고 장비는 창고로 돌아온다(계보는 남는다).
   */
  private renderConfirmModal(): void {
    const def = shipTypeDef(this.selected);
    const ship = activeShip(this.profile);
    const parts = makeModal({
      width: MODAL_W,
      height: MODAL_H,
      title: tShipKey('champion.retire.title', 'Retire your ship?'),
      onClose: () => {
        this.confirming = false;
        this.render();
      },
      panelTexture: this.ui['ui_panel.png'],
      closeTexture: this.ui['ui_icon_close.png'],
    });
    this.root.addChild(parts.root);

    const body = new Text({
      resolution: 2,
      text: tShipKey(
        'champion.retire.body',
        'Your current ship (Lv {level}) becomes a Guardian. Level, skill points and gear slots reset; equipment returns to the stash. You will pilot a fresh {name}.',
        { level: ship.level, name: shipTypeName(def) },
      ),
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: parts.box.w,
        lineHeight: 25,
        dropShadow: TEXT_SHADOW,
      },
    });
    body.position.set(parts.box.x, parts.box.y + 60);
    parts.panel.addChild(body);

    // 자라는 본문 아래에 버튼을 놓는다 — 바닥을 실측(`getLocalBounds`)해 위아래 여백을 맞춘다.
    const bodyBottom = body.y + body.getLocalBounds().height;
    const btnY = Math.max(bodyBottom + 28, parts.box.bottom - 60);

    const yes = new PixiButton({
      texture: this.ui['ui_btn_red.png'],
      fallbackColor: 0x9a2a2a,
      width: 260,
      height: 56,
      fontSize: 18,
      label: tShipKey('champion.retire.yes', 'Retire and switch'),
      onClick: () => this.confirm(),
    });
    yes.container.position.set(parts.box.x, btnY);
    parts.panel.addChild(yes.container);

    const no = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: 200,
      height: 56,
      fontSize: 18,
      label: tShipKey('champion.retire.no', 'Cancel'),
      onClick: () => {
        this.confirming = false;
        this.render();
      },
    });
    no.container.position.set(parts.box.x + 280, btnY);
    parts.panel.addChild(no.container);
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const h = new Text({
      resolution: 2,
      text: this.hint,
      style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: 0xff9a7a, dropShadow: TEXT_SHADOW },
    });
    h.anchor.set(0.5, 1);
    h.position.set(DESIGN_WIDTH / 2, HINT_Y);
    this.root.addChild(h);
  }
}

/** 로스터에 실제로 나오는 타입 수 = 레지스트리 전량(해금 게이트 없음, ADR-0019). */
export function rosterSize(): number {
  return SHIP_TYPES.length;
}
