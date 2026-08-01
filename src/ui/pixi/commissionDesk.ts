/**
 * 지시 수신소 화면 — Pixi (의뢰서 시스템 Phase E, `.omc/plans/commission-system-consensus.md`
 * §Phase E · CONTEXT.md "지시 수신소" 절).
 *
 * 기지에서 진입하는 **두 번째 PvE 출격구**다(성계 지도와 별개 — CONTEXT.md 정본). 보유한
 * 의뢰서(발령 시점에 이미 굳은 종이) 목록을 보여주고, [출격] 누르면 그 자리에서
 * `consume_commission` → `buildRunConfig` → 런 시작으로 이어진다. 촉매 픽커는 **표시하지
 * 않는다**(UX 다 — 실제 방어는 서버 `verify-commission` EF 의 촉매 필드 선검사가 진다).
 *
 * ## 서버 권위
 * 보유 목록·보상 내용의 정본은 서버 원장이다(`commission_inventory`). 이 화면은 스냅샷만
 * 읽고, 출격은 `consume_commission` RPC 가 확정한다. 미설정/오프라인이면 **온라인 전용**
 * 안내만 내고 출격을 막는다(촉매와 달리 무의뢰 폴백이 없다 — 의뢰서 자체가 서버 원장이다).
 *
 * ## 봉인 로드아웃
 * [출격] 은 `commissionSealedLoadout`(runConfig.ts)으로 **`buildRunConfig` 가 실제 런에 구울
 * 것과 같은 함수·같은 인자**로 로드아웃을 뽑아 `consume_commission` 에 싣는다. 서버는 이 값을
 * `loadout_sealed` 로 저장해 두었다가 제출 리플레이의 `config.loadout` 과 대조한다 — 여기서
 * 다른 방식으로 계산하면 정직한 런도 `commission-loadout-mismatch` 로 거부될 수 있다.
 *
 * ## 런 시작 신호
 * 출격 성공(`consume_commission` ok) 직후 이 화면은 **자기 자신을 닫고** 콜백(`onLaunch`)만
 * 부른다 — 실제 `buildRunConfig`→`createWorld`→`mark_commission_active` 호출은 `main.ts` 의
 * 단일 정본(`startCommissionRun`)이 진다(성계 지도 `planetSelect` 의 self-hide→`cb.onLaunch`
 * 규약과 동일). **`mark_commission_active` 실패 시 이 화면은 아무것도 하지 않는다** — 복구는
 * 클라가 지시하지 못하고 cron 회수만 유효하다(계획 pre-mortem ④·D8).
 *
 * ## 실측 규율(이 저장소 반복 결함)
 * - 목록 행 클릭이 아니라 **행 안 [출격] 버튼**을 쓴다(카탈로그 확장에도 안전 — 좌표 폭이
 *   달라도 버튼은 자기 hitArea 만 문다). `listRowBg` 는 시각 전용, 클릭 판정은 안 건다.
 * - 여백은 `panelContent()` 상자 안에만(제목이 테두리에 붙는 결함 재발 방지).
 * - 표시 판정(라벨·보상 요약·제약 문구)은 Pixi 없는 순수 계층(`commissionDeskView.ts`)에
 *   뽑아 뒀다 — 캔버스 스텁은 글자 크기를 실제보다 작게 재서 겹침을 놓친다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Profile } from '../../save/profile.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeBanner, makeIconButton, makeCurrencyChip } from './titleBar.js';
import { listRowBg } from './listRow.js';
import { makeScrollArea } from './scrollArea.js';
import { t } from '../../i18n/index.js';
import { fetchCommissionInventoryOnline, consumeCommissionOnServer } from '../../net/index.js';
import type { CommissionInventoryRow } from '../../net/commissionGateway.js';
import type { CommissionPayload } from '../../run/commission.js';
import { commissionSealedLoadout } from '../../run/runConfig.js';
import { COMMISSION_STOCK_CAP } from '../../run/commissionServerConstants.js';
import {
  commissionGradeLabel,
  commissionOrderLabel,
  commissionRewardSummary,
  commissionConstraintLines,
  commissionEliteNoteFor,
  commissionStockText,
} from './commissionDeskView.js';

// --- 레이아웃(디자인 스페이스 1920×1080, catalystArchive.ts 와 같은 좌표계) ---
const BANNER_W = 560;
const BANNER_H = 72;
const BANNER_Y = 10;
const PANEL_X = 360;
const PANEL_Y = 130;
const PANEL_W = 1200;
const PANEL_H = 830;
const BOX = panelContent(PANEL_W, PANEL_H);
const LIST_TOP = BOX.y + 56;
const LIST_AVAIL = BOX.bottom - LIST_TOP;
const ROW_H = 168;
const ROW_GAP = 14;
const ROW_BTN_W = 170;
const ROW_BTN_H = 56;
const ROW_PAD_X = 22;
const HINT_Y = DESIGN_HEIGHT - 10;

export interface CommissionDeskCallbacks {
  /** 화면을 닫을 때(기지로 복귀). */
  onClose: () => void;
  /**
   * 출격 확정 — `consume_commission` 이 이미 성공한 뒤 호출된다. 이 화면은 호출 **직전**
   * 자기 자신을 닫는다(성계 지도 self-hide 규약과 동일). 실제 런 조립(`buildRunConfig`)·
   * `mark_commission_active` 호출은 호출부(main.ts)의 책임이다.
   */
  onLaunch: (runId: string, payload: CommissionPayload) => void;
}

export class CommissionDeskScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private profile: Profile;
  private cb: CommissionDeskCallbacks | null = null;
  private ui: UiTextures = {};
  private inventory: CommissionInventoryRow[] = [];
  private scrollY = 0;
  private hint = '';
  /** 서버 왕복이 가능한 세션인가(미설정/오프라인이면 true — 의뢰서는 무의뢰 폴백이 없다). */
  private online = false;
  /** 출격 서버 왕복 중 재진입(동시 클릭) 가드. */
  private busy = false;
  private hudPrevVisibility: string | null = null;

  constructor(profile: Profile, stage: Container) {
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

  show(profile: Profile, cb: CommissionDeskCallbacks): void {
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
    const rows = await fetchCommissionInventoryOnline();
    this.online = rows !== null;
    this.inventory = rows ?? [];
    if (this.root.visible) this.render();
  }

  /**
   * 출격(계약 §5-2) — 봉인 로드아웃을 계산해 `consume_commission` 을 부른다. 성공하면 **이
   * 화면을 먼저 닫고** `onLaunch` 를 호출한다(성계 지도 self-hide 규약). 실패는 서버 예외
   * 메시지를 그대로 안내한다(§거부 경로는 실서버 응답으로 — 고정 매핑표를 만들지 않는다).
   */
  private async launch(row: CommissionInventoryRow): Promise<void> {
    if (this.busy) return;
    const cb = this.cb;
    if (cb === null) return;
    this.busy = true;
    this.hint = '';
    this.render();
    try {
      const loadout = commissionSealedLoadout(this.profile, row.payload.constraints?.equipRules);
      const res = await consumeCommissionOnServer(row.commissionId, loadout);
      if (res.status === 'ok') {
        this.hide();
        cb.onLaunch(res.runId, res.payload);
        return;
      }
      this.hint = res.status === 'unconfigured' ? t('commission.offline') : res.reason;
    } finally {
      this.busy = false;
      if (this.root.visible) this.render();
    }
  }

  // --- 렌더 ----------------------------------------------------------------

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
    const banner = makeBanner(BANNER_W, BANNER_H, t('commission.title'), this.ui['ui_banner.png']);
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
      text: t('commission.title'),
      style: { fontFamily: UI_FONT, fontSize: 28, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    title.position.set(BOX.x, BOX.y);
    panel.addChild(title);

    // 보관 상한(CONTEXT.md "지시 수신소" 절 — "꽉 차면 새 의뢰서가 들어오지 않는다"의 유일한
    // 화면 표시). 실값은 서버 상수 미러(`commissionServerConstants.ts`)에서 읽는다 — 하드코딩 금지.
    const stock = new Text({
      resolution: 2,
      text: commissionStockText(this.inventory.length, COMMISSION_STOCK_CAP),
      style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    stock.anchor.set(1, 0);
    stock.position.set(BOX.right, BOX.y + 6);
    panel.addChild(stock);

    if (!this.online) {
      const offline = new Text({
        resolution: 2,
        text: t('commission.offline'),
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
      offline.anchor.set(0.5);
      offline.position.set(PANEL_W / 2, LIST_TOP + LIST_AVAIL / 2);
      panel.addChild(offline);
      return;
    }

    if (this.inventory.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('commission.empty'),
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

    const totalH = this.inventory.length * (ROW_H + ROW_GAP) - ROW_GAP;
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

    this.inventory.forEach((row, i) => {
      const r = this.makeRow(row);
      r.position.set(0, i * (ROW_H + ROW_GAP));
      content.addChild(r);
    });
  }

  private makeRow(row: CommissionInventoryRow): Container {
    const { payload } = row;
    const c = new Container();
    c.addChild(listRowBg(BOX.w, ROW_H));

    const title = new Text({
      resolution: 2,
      text: `${commissionGradeLabel(payload.grade)}  ·  ${commissionOrderLabel(payload.order)}`,
      style: { fontFamily: UI_FONT, fontSize: 22, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    title.position.set(ROW_PAD_X, 14);
    c.addChild(title);

    const reward = commissionRewardSummary(payload);
    const subParts = [
      t('commission.segments', { n: payload.segments.length }),
      reward.creditsText,
      ...(reward.mineralsText !== null ? [reward.mineralsText] : []),
      ...(reward.itemsText !== null ? [reward.itemsText] : []),
      ...(reward.hasUnique ? [t('commission.rewards.unique')] : []),
    ];
    const sub = new Text({
      resolution: 2,
      text: subParts.join('  ·  '),
      style: { fontFamily: UI_FONT, fontSize: 17, fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    sub.position.set(ROW_PAD_X, 48);
    c.addChild(sub);

    // 정예 소집령 "런 내 성장 없음" 안내(ADR-0043) + 제약 계약 봉인 장비/성장 표시(주문마다
    // 최대 1축만 값을 낸다 — commissionDeskView 가 순수 판정한다).
    const noteLines: string[] = [];
    const eliteNote = commissionEliteNoteFor(payload.order);
    if (eliteNote !== null) noteLines.push(eliteNote);
    noteLines.push(...commissionConstraintLines(payload));
    if (noteLines.length > 0) {
      const note = new Text({
        resolution: 2,
        text: noteLines.join('\n'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fill: 0xff9a7a,
          wordWrap: true,
          wordWrapWidth: BOX.w - ROW_PAD_X - ROW_BTN_W - 40,
          lineHeight: 20,
          dropShadow: TEXT_SHADOW,
        },
      });
      note.position.set(ROW_PAD_X, 80);
      c.addChild(note);
    }

    const launch = new PixiButton({
      texture: this.ui['ui_btn_yellow.png'],
      fallbackColor: 0x9a7a2a,
      labelColor: COLOR.darkLabel,
      width: ROW_BTN_W,
      height: ROW_BTN_H,
      fontSize: 20,
      label: this.busy ? t('commission.launching') : t('commission.launch'),
      onClick: () => void this.launch(row),
    });
    launch.container.position.set(BOX.w - ROW_BTN_W - ROW_PAD_X, (ROW_H - ROW_BTN_H) / 2);
    launch.setEnabled(!this.busy);
    c.addChild(launch.container);

    return c;
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const h = new Text({
      resolution: 2,
      text: this.hint,
      style: {
        fontFamily: UI_FONT,
        fontSize: 20,
        fontWeight: '700',
        fill: 0xff9a7a,
        wordWrap: true,
        wordWrapWidth: DESIGN_WIDTH - 200,
        align: 'center',
        dropShadow: TEXT_SHADOW,
      },
    });
    h.anchor.set(0.5, 1);
    h.position.set(DESIGN_WIDTH / 2, HINT_Y);
    this.root.addChild(h);
  }
}
