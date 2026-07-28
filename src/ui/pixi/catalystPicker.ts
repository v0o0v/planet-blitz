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
 * - 리스너는 wipe-then-rebuild(`render()` 가 매번 자식 파괴·재생성). 주입/해제가 곧 재렌더고,
 *   하단 요약도 그때 다시 접힌다(별도 in-place 경로 없음 — 요약이 조합에서 파생되기 때문).
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import {
  CATALYSTS,
  catalystById,
  catalystIconFallbackKey,
  catalystIconKey,
  SLOT_CAP,
  type CatalystDef,
} from '../../data/catalysts.js';
import { catalystSummary } from '../../data/catalystSummary.js';
import { penaltyRow, rewardRow, type CatalystEffectRow } from '../catalystLabels.js';
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
import { makeModal, modalBodyTop, MODAL_TITLE_BAND } from './modal.js';
import type { PanelContentBox } from './nineSlicePanel.js';
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
/**
 * 헤더 밴드 = 제목 줄(makeModal 이 `box.y` 에 그린다) + 그 **아래** 슬롯 카운터/버튼 줄.
 *
 * 예전에는 [확정]/[전체 해제] 를 `box.y + 34` 에 두고 오른쪽 끝(`box.right`)에 붙였는데,
 * `makeModal` 의 닫기 아이콘도 같은 자리(`box.right - 44`, `box.y - 4`, 한 변 44)에 있어
 * **버튼이 X 를 덮었다**(사용자 신고 2026-07-28 스크린샷). 이제 버튼 줄을 닫기 아이콘 아래
 * ({@link modalBodyTop} = `box.y + MODAL_TITLE_BAND`)로 내려 세로로 분리한다 — 가로로만
 * 피하면 창 폭이 줄었을 때 다시 겹친다.
 */
const BTN_ROW_H = 52;
/**
 * 버튼 줄이 제목 밴드 아래로 더 내려앉는 여유(px). 닫기 아이콘은 `box.y - 4` 에서 시작해
 * `box.y + 40` 에 끝나고 `MODAL_TITLE_BAND` 는 44 라 맞닿기 직전(4px)이다 — 폰트 폴백으로
 * 아이콘이 조금만 커져도 다시 붙으므로 눈에 보이는 간격을 명시적으로 준다.
 */
const BTN_ROW_GAP = 10;
const HEADER_H = MODAL_TITLE_BAND + BTN_ROW_GAP + BTN_ROW_H + 12;
/**
 * 하단 **전체 효과 요약** 밴드. 예전 `DETAIL_H`(hover 한 촉매 한 장의 설명)를 대체한다 —
 * 8장을 주입해도 그 조합의 실제 배율은 화면 어디에도 없었다(사용자 요청 2026-07-28).
 */
const SUMMARY_H = 168;
const COLS = 6;
/** 셀 높이 = 아이콘/이름/종류 + **설명 3줄** + 보유 카운터 + 버튼 줄. */
const CELL_H = 196;
const CELL_GAP = 12;
const BADGE = 0x8affc0;
/** 페널티 열 색(적색 계열) · 보상 열 색(청록 계열). 요약 2열의 의미를 색으로도 가른다. */
const PENALTY_COLOR = 0xff9a8a;
const REWARD_COLOR = 0x8affc0;

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
    this.render();
    this.root.visible = true;
    this.raise();
  }

  hide(): void {
    this.root.visible = false;
    this.opts = null;
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

    // 헤더 둘째 줄: 슬롯 카운터(좌) + [전체 해제]/[확정](우). **제목 밴드 아래**라 닫기 X 와
    // 세로로 겹치지 않는다(위 HEADER_H 주석 — 사용자 신고 2026-07-28).
    const btnY = modalBodyTop(box) + BTN_ROW_GAP;
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
    slots.position.set(box.x, btnY + (BTN_ROW_H - 26) / 2);
    parts.panel.addChild(slots);

    const confirm = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      width: 200,
      height: BTN_ROW_H,
      fontSize: 22,
      labelColor: COLOR.darkLabel,
      label: t('catalyst.picker.confirm'),
      onClick: () => this.confirm(),
    });
    confirm.container.position.set(box.right - 200, btnY);
    parts.panel.addChild(confirm.container);

    const clear = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: 180,
      height: BTN_ROW_H,
      fontSize: 20,
      label: t('catalyst.picker.clear'),
      onClick: () => this.clearAll(),
    });
    clear.container.position.set(box.right - 200 - 16 - 180, btnY);
    parts.panel.addChild(clear.container);

    // 그리드 스크롤 영역.
    const gridTop = box.y + HEADER_H + 8;
    const gridAvail = box.bottom - gridTop - SUMMARY_H;
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

    this.renderSummary(parts.panel, box);
  }

  /**
   * 하단 **전체 효과 요약** — 지금 주입된 조합이 실제로 만드는 배율을 페널티/보상 2열로 접는다.
   *
   * 예전 이 자리에는 hover 한 촉매 **한 장**의 설명만 떴다(스크린샷의 "탐욕 / 페널티: … 보상: …").
   * 그 문구는 이제 각 셀 안으로 옮겼고(`makeCell`), 여기서는 조합 전체만 말한다 — 8장을 넣어도
   * 총합을 알 수 없던 것이 이 화면의 실제 결함이었다.
   *
   * 수치는 전부 `catalystSummary` → `catalystPenaltyMult`/`RewardMult`/`PowerMult` 를 거치므로
   * **sim 에 곱해지는 값과 1:1** 이다(표시용 별도 산식 없음).
   */
  private renderSummary(panel: Container, box: PanelContentBox): void {
    const top = box.bottom - SUMMARY_H + 8;
    const sum = catalystSummary(this.working);

    // 구분선 — 그리드는 이 자리에서 마스크로 잘리므로, 선이 없으면 마지막 행이 요약을 뚫고
    // 나온 것처럼 보인다(스크롤 클립이 의도라는 신호).
    const rule = new Graphics();
    rule.rect(box.x, top - 10, box.w, 2).fill({ color: 0x4a3a24, alpha: 0.9 });
    panel.addChild(rule);

    const title = new Text({
      resolution: 2,
      text: t('catalyst.summary.title'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 20,
        fontWeight: '800',
        fill: COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    title.position.set(box.x, top);
    panel.addChild(title);

    const meta = new Text({
      resolution: 2,
      text:
        sum.count > 0
          ? t('catalyst.summary.injected', { n: sum.count, kinds: sum.kinds })
          : t('catalyst.summary.none'),
      style: { fontFamily: UI_FONT, fontSize: 17, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    meta.anchor.set(0, 0);
    meta.position.set(box.x + title.width + 18, top + 3);
    panel.addChild(meta);

    // 2열: 왼쪽 페널티 · 오른쪽 보상. 열 폭은 콘텐츠 상자를 정확히 반으로 나눈다.
    const colW = Math.floor((box.w - 24) / 2);
    this.renderEffectColumn(
      panel,
      box.x,
      top + 34,
      colW,
      t('catalyst.summary.penalty'),
      PENALTY_COLOR,
      sum.penalties.map(penaltyRow),
    );
    this.renderEffectColumn(
      panel,
      box.x + colW + 24,
      top + 34,
      colW,
      t('catalyst.summary.reward'),
      REWARD_COLOR,
      sum.rewards.map(rewardRow),
    );
  }

  /**
   * 요약 한 열(제목 + `라벨 …… +NN%` 줄들). 줄이 없으면 `—` 한 줄로 "이 축은 비어 있다"를
   * 명시한다 — 열이 통째로 사라지면 좌우 폭이 흔들려 읽는 자리가 매번 바뀐다.
   *
   * 세로 공간이 모자라면(축을 6종까지 몰아 넣은 조합) 넘치는 줄은 그리지 않고 개수만 알린다 —
   * 조용히 잘리면 "적은 것"과 "안 보이는 것"이 구별되지 않는다.
   */
  private renderEffectColumn(
    panel: Container,
    x: number,
    y: number,
    w: number,
    heading: string,
    color: number,
    rows: readonly CatalystEffectRow[],
  ): void {
    const head = new Text({
      resolution: 2,
      text: heading,
      style: { fontFamily: UI_FONT, fontSize: 17, fontWeight: '800', fill: color, dropShadow: TEXT_SHADOW },
    });
    head.position.set(x, y);
    panel.addChild(head);

    const step = 24;
    const capacity = Math.max(1, Math.floor((SUMMARY_H - 8 - 34 - 26 - 4) / step));
    const shown = Math.min(rows.length, capacity);
    const hidden = rows.length - shown;

    if (rows.length === 0) {
      const none = new Text({
        resolution: 2,
        text: t('catalyst.summary.emptyCol'),
        style: { fontFamily: UI_FONT, fontSize: 17, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      none.position.set(x, y + 26);
      panel.addChild(none);
      return;
    }

    for (let i = 0; i < shown; i++) {
      const row = rows[i];
      if (row === undefined) continue;
      const label = new Text({
        resolution: 2,
        text: row.label,
        style: { fontFamily: UI_FONT, fontSize: 17, fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      label.position.set(x, y + 26 + i * step);
      panel.addChild(label);

      const value = new Text({
        resolution: 2,
        text: row.value,
        style: { fontFamily: UI_FONT, fontSize: 17, fontWeight: '800', fill: color, dropShadow: TEXT_SHADOW },
      });
      value.anchor.set(1, 0);
      value.position.set(x + w, y + 26 + i * step);
      panel.addChild(value);
    }

    if (hidden > 0) {
      const more = new Text({
        resolution: 2,
        text: t('result.drops.more', { n: hidden }),
        style: { fontFamily: UI_FONT, fontSize: 15, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      more.position.set(x, y + 26 + shown * step);
      panel.addChild(more);
    }
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

    // 아이콘: 개별 아트 → 보상축 폴백 → 축 토큰 글리프 순(아트가 코드보다 늦게 와도 안 죽는다).
    const iconTex = this.ui[`${catalystIconKey(def)}.png`] ?? this.ui[`${catalystIconFallbackKey(def)}.png`];
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

    // 설명(페널티/보상 방향). 예전에는 hover 해야 하단 스트립에 한 장씩 떴는데, 48종을 훑으려면
    // 48번 hover 해야 했다 — 셀 안으로 옮겨 한눈에 비교되게 한다(사용자 요청 2026-07-28).
    const desc = new Text({
      resolution: 2,
      text: stripEmoji(t(`catalyst.${def.slug}.desc` as MessageKey)),
      style: {
        fontFamily: UI_FONT,
        fontSize: 14,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: w - 28,
        lineHeight: 18,
        dropShadow: TEXT_SHADOW,
      },
    });
    desc.position.set(14, iconY + iconSize + 12);
    cell.addChild(desc);

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
    counter.position.set(14, CELL_H - 68);
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

    return cell;
  }
}
