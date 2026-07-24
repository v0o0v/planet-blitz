/**
 * 촉매 주입 픽커 팝업 — Pixi (ADR-0029, Lane 4).
 *
 * 성계 지도(`planetSelect.ts`)의 [주입 편집] 이 여는 모달이다. 48종 촉매를 그리드로 펼쳐
 * 보유 수량·주입 수(스택)·페널티+보상 방향을 보여 주고, 슬롯 상한(SLOT_CAP)·특산-행성 정합을
 * 강제한다. [확정] 이 주입 배열을 성계 지도에 돌려준다(X/암막은 취소 — 편집 폐기).
 *
 * ## 서버 권위 (ADR-0027/0029)
 * 보유 수량 정본은 서버 `catalyst_inventory` 다 — 픽커는 성계 지도가 넘긴 스냅샷(catalyst_id→qty)
 * 만 읽고, **실제 차감은 출격 직전 `consume_catalysts`** 가 한다(여기선 원장을 만지지 않는다).
 * 보유 0 이거나 오프라인(스냅샷 없음)이면 주입이 불가능하게 게이트한다.
 *
 * ## 실측 규칙(다른 캔버스 화면과 동일)
 * - **휠은 클립 Container + hitArea 에**(`makeScrollArea`). 마스크 Graphics 는 히트 제외.
 * - **밝은 화면 위 팝업은 `fillAlpha: 1`** — `makeModal` 이 고정한다.
 * - **여백은 `panelContent` 상자 안에만**.
 * - 리스너는 wipe-then-rebuild(`render()` 가 매번 자식 파괴·재생성). hover 상세만 in-place 갱신.
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import {
  CATALYSTS,
  catalystById,
  catalystIconKey,
  SLOT_CAP,
  type CatalystDef,
} from '../../data/catalysts.js';
import {
  canInjectCatalyst,
  catalystLocked,
  injectedCount,
  ownedCount,
} from '../../data/catalystInject.js';
import { planetById } from '../../../data/planets.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { listRowBg } from './listRow.js';
import { makeScrollArea } from './scrollArea.js';
import { makeModal } from './modal.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';

/** 보유 원장 스냅샷(catalyst_id → qty). 성계 지도가 서버에서 받아 넘긴다. */
export type CatalystInventorySnapshot = ReadonlyMap<number, number>;

export interface CatalystPickerOptions {
  /** 현재 선택 행성(특산 정합 판정). */
  planet: number;
  /** 현재 주입된 촉매 id(중복=스택). 픽커는 이 복사본을 편집한다. */
  injected: readonly number[];
  /** 보유 수량 스냅샷(서버 권위). 없으면 빈 맵(주입 불가). */
  inventory: CatalystInventorySnapshot;
  /** [확정] 시 편집한 주입 배열(정규화 전, 중복 보존)을 돌려준다. */
  onConfirm: (ids: number[]) => void;
}

// --- 레이아웃(디자인 스페이스 1920×1080) ---
const MODAL_W = 1560;
const MODAL_H = 940;
const HEADER_H = 64;
const DETAIL_H = 104;
const COLS = 6;
const CELL_H = 150;
const CELL_GAP = 12;
const BADGE = 0x8affc0;

/** 보상축 → 셀 토큰 글리프(아이콘 PNG 부재 시 텍스트 폴백). ASCII 유지(캔버스 두부 방지). */
const AXIS_GLYPH: Record<string, string> = {
  drop: 'D',
  rarity: 'R',
  xp: 'X',
  resource: '$',
  catalystDrop: 'C',
  power: 'P',
};

export class CatalystPicker {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private opts: CatalystPickerOptions | null = null;
  /** 편집 중인 주입 배열(중복=스택). 확정 시 onConfirm 으로 돌려준다. */
  private working: number[] = [];
  private scrollY = 0;
  /** hover 상세로 보여 줄 촉매 id(null = 없음). in-place 로 갱신. */
  private focused: number | null = null;
  /** 상세 스트립 텍스트(render 때 만들고 hover 가 in-place 로 text 만 바꾼다). */
  private detailText: Text | null = null;

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

  show(opts: CatalystPickerOptions): void {
    this.opts = opts;
    this.working = [...opts.injected];
    this.scrollY = 0;
    this.focused = null;
    this.render();
    this.root.visible = true;
    this.raise();
  }

  hide(): void {
    this.root.visible = false;
    this.opts = null;
    this.detailText = null;
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  // --- 편집 동작 -----------------------------------------------------------

  private ownedOf(id: number): number {
    return this.opts === null ? 0 : ownedCount(this.opts.inventory, id);
  }

  private injectedCountOf(id: number): number {
    return injectedCount(this.working, id);
  }

  /** 특산 촉매가 현재 행성에서 잠겼는지(순수 게이트 위임). */
  private locked(def: CatalystDef): boolean {
    return this.opts === null ? true : catalystLocked(def, this.opts.planet);
  }

  /** 한 개 더 주입 가능한지(순수 게이트 위임: 슬롯 여유 + 보유 여유 + 미잠금). */
  private canInject(def: CatalystDef): boolean {
    if (this.opts === null) return false;
    return canInjectCatalyst(def, this.working, this.opts.inventory, this.opts.planet);
  }

  private inject(id: number): void {
    const def = catalystById(id);
    if (def === undefined || !this.canInject(def)) return;
    this.working.push(id);
    this.render();
  }

  private remove(id: number): void {
    const i = this.working.lastIndexOf(id);
    if (i < 0) return;
    this.working.splice(i, 1);
    this.render();
  }

  private clearAll(): void {
    if (this.working.length === 0) return;
    this.working = [];
    this.render();
  }

  private confirm(): void {
    const cb = this.opts?.onConfirm;
    const ids = [...this.working];
    this.hide();
    cb?.(ids);
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    const opts = this.opts;
    if (opts === null) return;

    const parts = makeModal({
      width: MODAL_W,
      height: MODAL_H,
      title: t('catalyst.picker.title'),
      onClose: () => this.hide(), // 취소 — 편집 폐기(확정만 반영).
      panelTexture: this.ui['ui_panel.png'],
      closeTexture: this.ui['ui_icon_close.png'],
    });
    this.root.addChild(parts.root);
    const box = parts.box;

    // 헤더: 슬롯 카운터(좌) + [전체 해제]/[확정](우).
    const slots = new Text({
      resolution: 2,
      text: t('catalyst.picker.slots', { n: this.working.length, cap: SLOT_CAP }),
      style: {
        fontFamily: UI_FONT,
        fontSize: 22,
        fontWeight: '800',
        fill: this.working.length >= SLOT_CAP ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    slots.position.set(box.x, box.y + 40);
    parts.panel.addChild(slots);

    const confirm = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      width: 200,
      height: 52,
      fontSize: 22,
      labelColor: COLOR.darkLabel,
      label: t('catalyst.picker.confirm'),
      onClick: () => this.confirm(),
    });
    confirm.container.position.set(box.right - 200, box.y + 34);
    parts.panel.addChild(confirm.container);

    const clear = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: 180,
      height: 52,
      fontSize: 20,
      label: t('catalyst.picker.clear'),
      onClick: () => this.clearAll(),
    });
    clear.container.position.set(box.right - 200 - 16 - 180, box.y + 34);
    parts.panel.addChild(clear.container);

    // 그리드 스크롤 영역.
    const gridTop = box.y + HEADER_H + 8;
    const gridAvail = box.bottom - gridTop - DETAIL_H;
    const cellW = Math.floor((box.w - CELL_GAP * (COLS - 1)) / COLS);
    const rows = Math.ceil(CATALYSTS.length / COLS);
    const totalH = rows * (CELL_H + CELL_GAP) - CELL_GAP;
    const content = makeScrollArea(parts.panel, {
      x: box.x,
      y: gridTop,
      w: box.w,
      h: gridAvail,
      totalH,
      get: () => this.scrollY,
      set: (v) => {
        this.scrollY = v;
      },
      thumb: true,
    });

    CATALYSTS.forEach((def, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cell = this.makeCell(def, cellW);
      cell.position.set(col * (cellW + CELL_GAP), row * (CELL_H + CELL_GAP));
      content.addChild(cell);
    });

    // 상세 스트립(hover 로 in-place 갱신). 초기엔 안내 문구.
    this.detailText = new Text({
      resolution: 2,
      text: t('catalyst.panel.sub'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: box.w,
        lineHeight: 24,
        dropShadow: TEXT_SHADOW,
      },
    });
    this.detailText.position.set(box.x, box.bottom - DETAIL_H + 8);
    parts.panel.addChild(this.detailText);
    if (this.focused !== null) this.updateDetail(this.focused);
  }

  private makeCell(def: CatalystDef, w: number): Container {
    const cell = new Container();
    const injected = this.injectedCountOf(def.id);
    const owned = this.ownedOf(def.id);
    const locked = this.locked(def);
    const accent = injected > 0 ? COLOR.gold : def.kind === 'signature' ? 0x6a5a30 : undefined;
    cell.addChild(
      listRowBg(w, CELL_H, {
        fillAlpha: 1,
        ...(injected > 0 ? { selected: true } : accent !== undefined ? { accent } : {}),
      }),
    );

    // 아이콘(텍스처 있으면 스프라이트, 없으면 축 토큰 폴백).
    const iconTex = this.ui[`${catalystIconKey(def)}.png`];
    const iconSize = 44;
    const iconX = 14;
    const iconY = 12;
    if (iconTex) {
      const sp = new Sprite(iconTex);
      sp.width = iconSize;
      sp.height = iconSize;
      sp.position.set(iconX, iconY);
      cell.addChild(sp);
    } else {
      const token = new Graphics();
      token
        .roundRect(iconX, iconY, iconSize, iconSize, 8)
        .fill({ color: def.kind === 'signature' ? 0x3a2f18 : 0x2a2440 })
        .stroke({ color: accent ?? COLOR.muted, width: 2, alignment: 1 });
      cell.addChild(token);
      const glyph = new Text({
        resolution: 2,
        text: AXIS_GLYPH[def.reward.axis] ?? '?',
        style: { fontFamily: UI_FONT, fontSize: 24, fontWeight: '800', fill: COLOR.cream },
      });
      glyph.anchor.set(0.5);
      glyph.position.set(iconX + iconSize / 2, iconY + iconSize / 2);
      cell.addChild(glyph);
    }

    // 이름.
    const name = new Text({
      resolution: 2,
      text: t(`catalyst.${def.slug}.name` as MessageKey),
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: '800',
        fill: injected > 0 ? COLOR.gold : COLOR.cream,
        wordWrap: true,
        wordWrapWidth: w - iconX * 2 - iconSize - 8,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.position.set(iconX + iconSize + 8, iconY);
    cell.addChild(name);

    // 종류 라벨.
    const kind = new Text({
      resolution: 2,
      text: t(def.kind === 'signature' ? 'catalyst.kind.signature' : 'catalyst.kind.common'),
      style: { fontFamily: UI_FONT, fontSize: 13, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    kind.position.set(iconX + iconSize + 8, iconY + 26);
    cell.addChild(kind);

    // 보유/주입 카운터(하단).
    const counter = new Text({
      resolution: 2,
      text: `${t('catalyst.picker.owned', { n: owned })}${injected > 0 ? `   ·   ×${injected}` : ''}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fontWeight: injected > 0 ? '800' : '400',
        fill: injected > 0 ? BADGE : COLOR.muted,
        dropShadow: TEXT_SHADOW,
      },
    });
    counter.position.set(14, CELL_H - 60);
    cell.addChild(counter);

    if (locked) {
      // 특산 잠금: 딤 + 사유(출신 행성 전용).
      const dim = new Graphics();
      dim.roundRect(0, 0, w, CELL_H, 10).fill({ color: 0x0b0814, alpha: 0.62 });
      cell.addChild(dim);
      const reason = new Text({
        resolution: 2,
        text: t('catalyst.picker.signatureLocked', {
          planet: def.planet !== undefined ? planetById(def.planet).name : '',
        }),
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fontWeight: '700',
          fill: 0xffb0a0,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: w - 20,
          dropShadow: TEXT_SHADOW,
        },
      });
      reason.anchor.set(0.5);
      reason.position.set(w / 2, CELL_H - 24);
      cell.addChild(reason);
    } else {
      // 주입/해제 버튼 행(하단).
      const btnW = Math.floor((w - 14 * 2 - 10) / 2);
      const btnY = CELL_H - 44;
      const plus = new PixiButton({
        texture: this.ui['ui_btn_wood.png'],
        fallbackColor: 0x3a5a3a,
        width: btnW,
        height: 34,
        fontSize: 16,
        label: t('catalyst.picker.inject'),
        onClick: () => this.inject(def.id),
      });
      plus.container.position.set(14, btnY);
      if (!this.canInject(def)) plus.setEnabled(false);
      cell.addChild(plus.container);

      const minus = new PixiButton({
        texture: this.ui['ui_btn_wood.png'],
        fallbackColor: 0x5a3a3a,
        width: btnW,
        height: 34,
        fontSize: 16,
        label: t('catalyst.picker.remove'),
        onClick: () => this.remove(def.id),
      });
      minus.container.position.set(14 + btnW + 10, btnY);
      if (injected <= 0) minus.setEnabled(false);
      cell.addChild(minus.container);
    }

    // hover → 상세 스트립 갱신(전체 재렌더 없이 text 만).
    cell.eventMode = 'static';
    cell.on('pointerover', () => {
      this.focused = def.id;
      this.updateDetail(def.id);
    });
    return cell;
  }

  /** 상세 스트립 text 를 focused 촉매의 이름 + desc(페널티/보상 방향)로 갱신. */
  private updateDetail(id: number): void {
    const def = catalystById(id);
    if (def === undefined || this.detailText === null) return;
    const name = t(`catalyst.${def.slug}.name` as MessageKey);
    const desc = stripEmoji(t(`catalyst.${def.slug}.desc` as MessageKey));
    this.detailText.text = `${name}\n${desc}`;
  }
}
