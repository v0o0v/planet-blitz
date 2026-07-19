/**
 * 관제탑 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #6).
 *
 * `src/ui/controlTower.ts` 의 DOM `ControlTower` 와 기능 1:1 동등하게 침공 사령 화면을 Pixi
 * 캔버스(1920×1080 디자인 스페이스)로 재구현한다: 침공 대상 제안 목록(일반/배치전), 기지
 * 정찰 미니 격자, 순위표, 복수전 카드, 침공 알림(관전·도발), 배치전 진행·순위 진입, 서버
 * 판정 결과 배너, 상대 방어 카드 정찰 공개. 공개 인터페이스(`show`/`hide`/`visible`)와
 * 콜백·옵션 타입은 DOM 판 그대로라 main.ts 는 생성자 한 줄만 바뀐다(롤아웃 공통 규칙 2).
 * DOM 클래스는 회귀 대비로 남긴다(ADR-0014).
 *
 * 앞선 다섯 화면과 달리 **표·목록이 넷**이라 세로 스택 대신 **열(column) 보드**로 짰다.
 * 조건부 블록(결과 배너·복수·알림)은 있을 때만 자리를 차지하고, 없으면 나머지 열이 넓어진다
 * (성계 지도 #4 의 변칙 패널과 같은 규칙). 목록은 전부 마스크 스크롤이고 마스크 하한은
 * 콘텐츠 상자 바닥(`box.bottom`)에서 **행 경계로 클램프**한다(반토막 행 금지).
 *
 * 서버 왕복이 있는 유일한 메타 화면이다 — 로딩·미설정·빈 목록 문구 경로를 DOM 판 그대로
 * 유지한다(env 미설정이면 net 계층이 null 을 돌려주고 안내 상태로 뜬다).
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { Profile } from '../../save/profile.js';
import { t } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { stickerLabel } from '../../../data/stickers.js';
import { seedBaseByProfileId } from '../../../data/seedBases.js';
import type { CardInstance } from '../../../data/defenseCards.js';
import { cardRarityColor, cardRarityLabel, cardAffixOneLine } from '../cardsView.js';
import { GRID_COLS, GRID_ROWS, normalizeLayout } from '../defenseCommand.js';
import {
  fetchInvasionTargets,
  fetchLadder,
  fetchPlacementStatus,
  fetchPlacementTargets,
  fetchRevengeTargets,
  fetchIncomingInvasions,
  applyPlacementResult,
  placementPhase,
  placementProgressLabel,
  placementRemaining,
  readInvasionCooldowns,
  readInvasionsSeenAt,
  writeInvasionsSeenAt,
  countUnseenInvasions,
  type InvasionTarget,
  type LadderEntry,
  type PlacementStatus,
  type PlacementResult,
  type RevengeTarget,
  type IncomingInvasion,
} from '../../net/invasion.js';
import {
  shipSummaryText,
  maintenanceLabel,
  computeInvadeState,
  computePlacementInvadeState,
  placementTargetName,
  revengeCardState,
  incomingBannerText,
  incomingRowText,
  resultBannerText,
  previewCells,
  type ControlTowerCallbacks,
  type ControlTowerShowOpts,
  type InvasionResultView,
  type PreviewCell,
} from '../controlTower.js';
import { COLOR, UI_FONT, TEXT_SHADOW, hexColor } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER, type PanelContentBox } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { PixiTooltip } from './tooltip.js';
import { makeBanner } from './titleBar.js';
import { stripEmoji } from './text.js';

export type { ControlTowerCallbacks, ControlTowerShowOpts, InvasionResultView };

/**
 * 정찰 격자 글리프 → 도형. `previewCells`(DOM 판의 검증된 좌표 로직)가 돌려주는 이모지는
 * 캔버스에서 흑백 두부로 떨어지므로(스킬 §6 · 롤아웃 #3 교훈) 표시만 도형으로 바꾼다.
 * 표에 없는 글리프(포탑 6종·미지)는 전부 원(포탑)으로 그린다.
 */
const GLYPH_SHAPE: Record<string, 'core' | 'obstacle' | 'spawn'> = {
  '💠': 'core',
  '🧱': 'obstacle',
  '▲': 'spawn',
};

// --- 레이아웃 상수(디자인 스페이스) ---
const BANNER_W = 560;
const BANNER_H = 72;
const BANNER_Y = 12;
const SUB_Y = 94;

const MARGIN = 48;
const BOARD_W = DESIGN_WIDTH - MARGIN * 2;
const BOARD_TOP = 132;
/** 보드(열 패널)가 쓸 수 있는 아래 한계 — 그 밑은 안내문 + 기지로 버튼. */
const BOARD_BOTTOM = 950;
const GAP = 24;

/** 상태 패널(결과 배너·검증 중·배치전·카드 공개) 높이 한계. 내용에 맞춰 재는 값이다. */
const STATUS_MIN_H = 140;
const STATUS_MAX_H = 300;

/**
 * 열 폭 — 소식(복수·알림) 패널이 있을 때만 4열이 된다(없으면 나머지가 넓어진다).
 * 정찰 격자는 15×9 가로형이라 **폭이 곧 크기**다(높이는 남아돈다) → 정찰에 넓은 열을 준다.
 */
const COLS_3 = { targets: 640, recon: 700, ladder: 436 } as const;
const COLS_4 = { targets: 560, recon: 440, news: 420, ladder: 332 } as const;

/** 패널 제목(26px) 아래에서 본문이 시작한다 — 상자 top(60) + 58. */
const CONTENT_TOP = 118;

// 대상 목록 행.
const TGT_ROW_H = 96;
const TGT_ROW_GAP = 10;
const TGT_BTN_W = 170;
const TGT_BTN_H = 52;

// 소식(복수·알림) 목록 행.
/** 알림 행 최소 높이(문구가 짧아도 버튼이 들어갈 자리). 실제 높이는 문구 줄 수가 정한다. */
const NOTIF_ROW_H = 72;
const NEWS_HEAD_H = 40;
const NEWS_GAP = 8;
const NEWS_BTN_W = 120;
const NEWS_BTN_H = 44;
const NOTIF_BTN_W = 84;
const NOTIF_BTN_H = 40;

// 순위표.
const LAD_HEAD_H = 38;
const LAD_ROW_H = 34;

// 정찰 격자.
const RECON_CELL_MAX = 44;
const RECON_CELL_GAP = 3;

// 배치전 진행바.
const SEG_W = 56;
const SEG_H = 12;
const SEG_GAP = 8;

// 하단.
const NOTE_Y = 962;
const BACK_W = 300;
const BACK_H = 60;
const BACK_Y = 996;

/** 목록 행 바탕(선택 시 금색 링). 관제탑 전용 조립이라 공용으로 올리지 않는다(ADR-0014). */
function listRowBg(w: number, h: number, opts: { selected?: boolean; accent?: number } = {}): Graphics {
  const g = new Graphics();
  g.roundRect(0, 0, w, h, 10).fill({ color: 0x241d33, alpha: 0.92 });
  const stroke =
    opts.selected === true ? COLOR.gold : opts.accent !== undefined ? opts.accent : 0x5a4630;
  g.roundRect(0, 0, w, h, 10).stroke({
    color: stroke,
    width: opts.selected === true ? 3 : 2,
    alignment: 1,
  });
  return g;
}

export class ControlTowerScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  private ui: UiTextures = {};

  private onInvade: ControlTowerCallbacks['onInvade'] | null = null;
  private onSpectate: ControlTowerCallbacks['onSpectate'] | null = null;
  private onSticker: ControlTowerCallbacks['onSticker'] | null = null;
  private onBack: (() => void) | null = null;

  private targets: InvasionTarget[] | null = null; // null = 미로딩/미설정
  private ladder: LadderEntry[] | null = null;
  private cooldowns: Record<string, number> = {};
  private selectedId: string | null = null;
  private loading = true;
  private loadToken = 0;
  private opts: ControlTowerShowOpts = {};

  // 복수전(F1)·알림(계약 5) 상태 — 서버 권위. null = 미설정/미구현(→ 해당 UI 숨김).
  private revengeTargets: RevengeTarget[] | null = null;
  private incoming: IncomingInvasion[] | null = null;
  private unseenCount = 0;

  // 배치전(AC4) 상태 — 서버 권위. null = 미설정/미배치정보없음(→ 일반 침공만).
  private placement: PlacementStatus | null = null;
  private placementTargets: InvasionTarget[] | null = null;
  private placementResult: PlacementResult | null = null;
  private applying = false;

  // 목록 스크롤 위치(재렌더 사이 유지).
  private targetScrollY = 0;
  private newsScrollY = 0;
  private ladderScrollY = 0;

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    this.root.addChild(this.tooltip.container);
    // UI 킷 텍스처 비동기 로드 — 완료 후 열려 있으면 실 아트로 다시 그린다(그 전엔 폴백).
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(_profile: Profile, cb: ControlTowerCallbacks, opts: ControlTowerShowOpts = {}): void {
    this.onInvade = cb.onInvade;
    this.onSpectate = cb.onSpectate;
    this.onSticker = cb.onSticker;
    this.onBack = cb.onBack;
    this.opts = opts;
    this.selectedId = null;
    this.loading = true;
    this.targets = null;
    this.ladder = null;
    this.placement = null;
    this.placementTargets = null;
    this.placementResult = null;
    this.applying = false;
    this.revengeTargets = null;
    this.incoming = null;
    this.unseenCount = 0;
    this.targetScrollY = 0;
    this.newsScrollY = 0;
    this.ladderScrollY = 0;
    this.render();
    this.root.visible = true;
    // DOM HUD 는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다(스킬 §7).
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
    void this.load();
  }

  hide(): void {
    this.root.visible = false;
    this.tooltip.hide();
    this.onInvade = null;
    this.onSpectate = null;
    this.onSticker = null;
    this.onBack = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  // --- 로드 (DOM 판과 동일 규칙) --------------------------------------------

  /** 타깃·순위표·쿨다운을 비동기 로드하고 재렌더. race 방지 토큰 사용. */
  private async load(): Promise<void> {
    const token = ++this.loadToken;
    try {
      if (typeof localStorage !== 'undefined') this.cooldowns = readInvasionCooldowns(localStorage);
    } catch {
      this.cooldowns = {};
    }
    // 알림은 마지막 확인 시각 이후의 결과만 서버가 필터해 준다(폴링 전용, 계약 5).
    let seenAt = 0;
    try {
      if (typeof localStorage !== 'undefined') seenAt = readInvasionsSeenAt(localStorage);
    } catch {
      seenAt = 0;
    }
    const [targets, ladder, placement, revenge, incoming] = await Promise.all([
      fetchInvasionTargets(),
      fetchLadder(20),
      fetchPlacementStatus(),
      fetchRevengeTargets(),
      fetchIncomingInvasions(seenAt, 20),
    ]);
    if (token !== this.loadToken || !this.visible) return; // 낡은 로드 무시
    this.targets = targets;
    this.ladder = ladder;
    this.placement = placement;
    this.revengeTargets = revenge;
    this.incoming = incoming;
    // 미확인 수 계산 후, 확인 시각을 최신 결과 시각으로 갱신한다(다음 방문부터 새 것만 카운트).
    if (incoming !== null && incoming.length > 0) {
      this.unseenCount = countUnseenInvasions(incoming, seenAt);
      let maxAt = seenAt;
      for (const inv of incoming) if (inv.createdAtMs > maxAt) maxAt = inv.createdAtMs;
      try {
        if (typeof localStorage !== 'undefined') writeInvasionsSeenAt(localStorage, maxAt);
      } catch {
        // 저장 실패 무해(다음 방문에 같은 결과가 다시 새 것으로 셀 뿐).
      }
    } else {
      this.unseenCount = 0;
    }
    // 배치전 진행 중이면 NPC 시드 기지 목록도 로드(쿨다운 무시 제안).
    if (placement !== null && placementPhase(placement) === 'placement') {
      const pts = await fetchPlacementTargets();
      if (token !== this.loadToken || !this.visible) return;
      this.placementTargets = pts;
    }
    this.loading = false;
    this.render();
  }

  /** 배치전 5회 완료 후 순위 삽입을 서버에 요청하고 연출 상태로 재렌더한다. */
  private async applyPlacement(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    this.render();
    const result = await applyPlacementResult();
    if (!this.visible) return;
    this.applying = false;
    this.placementResult = result;
    if (result !== null && result.placed) {
      // 순위 진입 — 배치전 종료. 상태를 placed 로 갱신하고 순위표를 새로 로드한다.
      this.placement =
        this.placement !== null
          ? { ...this.placement, placed: true }
          : { completed: 0, won: 0, total: 0, placed: true };
      void this.load();
    } else {
      this.render();
    }
  }

  // --- 상호작용 (DOM 판과 동일 규칙) ----------------------------------------

  private selectTarget(id: string): void {
    this.selectedId = this.selectedId === id ? null : id;
    this.render();
  }

  /** 배치전 진행 단계인지(NPC 시드 기지 제안·쿨다운 무시). */
  private inPlacement(): boolean {
    return this.placement !== null && placementPhase(this.placement) === 'placement';
  }

  /** 배치전 5회를 다 치렀으나 아직 순위 삽입 전(연출 대상)인지. */
  private isCompleting(): boolean {
    return this.placement !== null && placementPhase(this.placement) === 'completing';
  }

  private invade(target: InvasionTarget): void {
    // 배치전 대상은 쿨다운을 무시(computePlacementInvadeState), 일반 침공은 쿨다운 미러 적용.
    const st = this.inPlacement()
      ? computePlacementInvadeState(target)
      : computeInvadeState(target, this.cooldowns, Date.now());
    if (!st.canInvade || st.layout === null) return;
    const cb = this.onInvade;
    // 침공 런으로 넘어가면 이 화면은 내려간다(런 종료 후 main 이 다시 연다).
    this.hide();
    cb?.(target, st.layout);
  }

  private back(): void {
    const cb = this.onBack;
    this.hide();
    cb?.();
  }

  // --- 공용 렌더 조각 -------------------------------------------------------

  /** 패널 제목 — top = 콘텐츠 상자 top(스킬 §4, 제목이 나무 테두리에 붙던 결함 재발 방지). */
  private panelTitle(parent: Container, box: PanelContentBox, text: string, color: number = COLOR.cream): void {
    const title = new Text({
      resolution: 2,
      text,
      style: {
        fontFamily: UI_FONT,
        fontSize: 26,
        fontWeight: '800',
        fill: color,
        dropShadow: TEXT_SHADOW,
      },
    });
    // 긴 제목은 줄바꿈 대신 가로만 줄인다 — 두 줄이 되면 본문 시작선(118)을 침범한다.
    title.position.set(box.x, box.y);
    if (title.width > box.w) title.scale.x = box.w / title.width;
    parent.addChild(title);
  }

  /** 안내/빈 상태 문구(콘텐츠 상자 안 가운데 정렬). */
  private msg(parent: Container, box: PanelContentBox, text: string): void {
    const el = new Text({
      resolution: 2,
      text,
      style: {
        fontFamily: UI_FONT,
        fontSize: 19,
        fill: COLOR.muted,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: box.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    el.anchor.set(0.5, 0);
    el.position.set(box.x + box.w / 2, CONTENT_TOP + 40);
    parent.addChild(el);
  }

  /**
   * 마스크 스크롤 영역을 만들고 콘텐츠 Container 를 돌려준다. 마스크 사각형은 호출자가
   * **행 경계로 클램프한 높이**로 넘긴다(반토막 행 금지 — 스킬 §4).
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
      mask.eventMode = 'static';
      mask.on('wheel', (e) => {
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
      if (child !== this.tooltip.container) {
        this.root.removeChild(child);
        child.destroy({ children: true });
      }
    }
    this.tooltip.hide();

    // 배경(불투명 — 뒤 아레나를 가린다). 별 장식 금지(세트 팔레트 확정).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChildAt(bg, 0);

    this.renderTitleBar();

    const statusH = this.renderStatusPanel();
    const boardY = statusH > 0 ? BOARD_TOP + statusH + GAP : BOARD_TOP;
    const boardH = BOARD_BOTTOM - boardY;
    this.renderBoard(boardY, boardH);

    this.renderFooter();

    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('ctl.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const sub = new Text({
      resolution: 2,
      text: t('ctl.sub'),
      style: { fontFamily: UI_FONT, fontSize: 19, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(DESIGN_WIDTH / 2, SUB_Y);
    this.root.addChild(sub);
  }

  /** 열 보드 — 대상 · 정찰 · (소식) · 순위표. 소식이 없으면 3열로 넓게 선다. */
  private renderBoard(y: number, h: number): void {
    const hasNews =
      (this.revengeTargets !== null && this.revengeTargets.length > 0) ||
      (this.incoming !== null && this.incoming.length > 0);
    const widths = hasNews
      ? [COLS_4.targets, COLS_4.recon, COLS_4.news, COLS_4.ladder]
      : [COLS_3.targets, COLS_3.recon, COLS_3.ladder];

    const xs: number[] = [];
    let cursor = MARGIN;
    for (const w of widths) {
      xs.push(cursor);
      cursor += w + GAP;
    }

    const at = (i: number): number => xs[i] ?? MARGIN;
    const wd = (i: number): number => widths[i] ?? 400;

    this.renderTargetsPanel(at(0), y, wd(0), h);
    this.renderReconPanel(at(1), y, wd(1), h);
    if (hasNews) {
      this.renderNewsPanel(at(2), y, wd(2), h);
      this.renderLadderPanel(at(3), y, wd(3), h);
    } else {
      this.renderLadderPanel(at(2), y, wd(2), h);
    }
  }

  /** 패널 한 장(프레임 + 위치)을 만들어 root 에 붙이고 콘텐츠 상자를 돌려준다. */
  private addPanel(x: number, y: number, w: number, h: number): { panel: Container; box: PanelContentBox } {
    const panel = new Container();
    panel.position.set(x, y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(w, h, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));
    return { panel, box: panelContent(w, h) };
  }

  // --- 상태 패널(결과 배너 · 검증 중 · 배치전 · 카드 공개) --------------------

  /**
   * 화면 위쪽 상태 패널. 표시할 것이 없으면 0 을 돌려 보드가 위로 올라온다. 내용을 먼저
   * 조립해 실제 높이를 잰 뒤 그 높이로 프레임을 깐다(문구 길이·로케일에 따라 줄 수가 변한다).
   */
  private renderStatusPanel(): number {
    const result = this.opts.result;
    const verifying = this.opts.verifying === true;
    const revealCard = result !== undefined ? (this.opts.revealCard ?? null) : null;
    const placementBlock = this.placementBlock();
    if (result === undefined && !verifying && revealCard === null && placementBlock === null) return 0;

    const box = panelContent(BOARD_W, STATUS_MIN_H);
    const content = new Container();
    let y = box.y;

    const line = (text: string, size: number, color: number, weight: '400' | '700' | '800'): void => {
      const el = new Text({
        resolution: 2,
        text,
        style: {
          fontFamily: UI_FONT,
          fontSize: size,
          fontWeight: weight,
          fill: color,
          wordWrap: true,
          wordWrapWidth: box.w,
          dropShadow: TEXT_SHADOW,
        },
      });
      el.position.set(box.x, y);
      content.addChild(el);
      y += el.height + 8;
    };

    if (result !== undefined) {
      line(resultBannerText(result), 24, this.resultColor(result), '800');
    }
    if (verifying) {
      line(t('ctl.verifying'), 20, COLOR.cream, '700');
    }
    if (placementBlock !== null) {
      y = placementBlock(content, box, y);
    }
    if (revealCard !== null) {
      y = this.renderRevealLines(content, box, y, revealCard);
    }

    // 아래 여백은 위와 **대칭**이어야 한다(box.y = border + pad). 실제 콘텐츠 바닥을 재서
    // 그만큼 더한다 — 줄 간격을 더해 어림하면 아래만 좁아 보인다(모서리 확대에서 잡힌 결함).
    const cb = content.getLocalBounds();
    const contentBottom = cb.y + cb.height;
    const h = Math.max(STATUS_MIN_H, Math.min(STATUS_MAX_H, Math.ceil(contentBottom + box.y)));
    const panel = new Container();
    panel.position.set(MARGIN, BOARD_TOP);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(BOARD_W, h, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));
    panel.addChild(content);
    return h;
  }

  /** 결과 배너 색 — 미제출·확정 중은 중립(크림), 확정 승 금색, 그 외(패배·거부) 살구색. */
  private resultColor(view: InvasionResultView): number {
    if (!view.submitted || view.attackerWon === null) return COLOR.cream;
    return view.status === 'verified' && view.attackerWon ? COLOR.gold : 0xffb0a0;
  }

  /** 상대 방어 카드 정찰 공개(스펙 R9) 3줄. 다음 y 를 돌려준다. */
  private renderRevealLines(
    content: Container,
    box: PanelContentBox,
    y0: number,
    card: CardInstance,
  ): number {
    let y = y0;
    const put = (text: string, size: number, color: number, weight: '400' | '700' | '800'): void => {
      const el = new Text({
        resolution: 2,
        text,
        style: {
          fontFamily: UI_FONT,
          fontSize: size,
          fontWeight: weight,
          fill: color,
          wordWrap: true,
          wordWrapWidth: box.w,
          dropShadow: TEXT_SHADOW,
        },
      });
      el.position.set(box.x, y);
      content.addChild(el);
      y += el.height + 4;
    };
    // '🃏 상대 방어 카드' 의 컬러 이모지는 캔버스에서 두부가 된다.
    put(stripEmoji(t('card.reveal.head')), 18, COLOR.muted, '700');
    put(
      `${t('card.reveal.grade', { rarity: cardRarityLabel(card.rarity) })} · ${t('card.reveal.charges', { n: card.chargesLeft })}`,
      20,
      hexColor(cardRarityColor(card.rarity)),
      '800',
    );
    put(cardAffixOneLine(card), 16, COLOR.muted, '400');
    return y + 4;
  }

  /**
   * 배치전 블록(진행바 / 순위 진입 버튼 / 진입 연출)을 그리는 클로저. 표시할 것이 없으면
   * null — 상태 패널이 통째로 빠질 수 있어야 해서 "그릴 게 있는지"를 먼저 판정한다.
   */
  private placementBlock():
    | ((content: Container, box: PanelContentBox, y0: number) => number)
    | null {
    // 방금 순위에 진입한 직후 연출(placementResult.placed)은 status.placed 여도 1회 표시.
    const entered = this.placementResult;
    if (entered !== null && entered.placed) {
      return (content, box, y0) => {
        const el = new Text({
          resolution: 2,
          text: t('ctl.place.entered', { rank: entered.rank, won: entered.matchesWon }),
          style: {
            fontFamily: UI_FONT,
            fontSize: 22,
            fontWeight: '800',
            fill: COLOR.gold,
            wordWrap: true,
            wordWrapWidth: box.w,
            dropShadow: TEXT_SHADOW,
          },
        });
        el.position.set(box.x, y0);
        content.addChild(el);
        return y0 + el.height + 8;
      };
    }
    const status = this.placement;
    if (status === null) return null;
    const phase = placementPhase(status);
    if (phase === 'ranked') return null; // 일반 침공 단계 — 배치전 UI 없음

    if (phase === 'completing') {
      return (content, box, y0) => {
        const el = new Text({
          resolution: 2,
          text: t('ctl.place.completeLine', { total: status.total, won: status.won }),
          style: {
            fontFamily: UI_FONT,
            fontSize: 21,
            fontWeight: '700',
            fill: COLOR.cream,
            dropShadow: TEXT_SHADOW,
          },
        });
        el.position.set(box.x, y0 + 14);
        content.addChild(el);

        const btn = new PixiButton({
          texture: this.ui['ui_btn_yellow.png'],
          fallbackColor: 0x9a7a2a,
          width: 240,
          height: 56,
          fontSize: 22,
          // 노란 버튼은 바탕이 밝아 흰 라벨이 묻힌다(롤아웃 #1~#5 와 동일 처리).
          labelColor: COLOR.darkLabel,
          label: this.applying ? t('ctl.place.applying') : t('ctl.place.enter'),
          onClick: () => void this.applyPlacement(),
        });
        btn.container.position.set(box.x + el.width + 32, y0);
        content.addChild(btn.container);
        if (this.applying) btn.setEnabled(false);
        return y0 + 56 + 8;
      };
    }

    return (content, box, y0) => {
      let y = y0;
      const label = new Text({
        resolution: 2,
        text: `${placementProgressLabel(status)}${t('ctl.place.remaining', { n: placementRemaining(status) })}`,
        style: {
          fontFamily: UI_FONT,
          fontSize: 21,
          fontWeight: '700',
          fill: COLOR.cream,
          dropShadow: TEXT_SHADOW,
        },
      });
      label.position.set(box.x, y);
      content.addChild(label);
      y += label.height + 10;

      const bar = new Graphics();
      for (let i = 0; i < status.total; i++) {
        const done = i < status.completed;
        bar
          .roundRect(box.x + i * (SEG_W + SEG_GAP), y, SEG_W, SEG_H, SEG_H / 2)
          .fill({ color: done ? COLOR.gold : 0x3a3050 })
          .stroke({ color: done ? COLOR.gold : 0x5a4630, width: 2, alignment: 1 });
      }
      content.addChild(bar);
      y += SEG_H + 12;

      const hint = new Text({
        resolution: 2,
        text: t('ctl.place.hint'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 16,
          fill: COLOR.muted,
          wordWrap: true,
          wordWrapWidth: box.w,
          dropShadow: TEXT_SHADOW,
        },
      });
      hint.position.set(box.x, y);
      content.addChild(hint);
      return y + hint.height + 8;
    };
  }

  // --- 대상 목록 -----------------------------------------------------------

  private renderTargetsPanel(x: number, y: number, w: number, h: number): void {
    const placementMode = this.inPlacement();
    const { panel, box } = this.addPanel(x, y, w, h);
    this.panelTitle(panel, box, placementMode ? t('ctl.tgt.placementHead') : t('ctl.tgt.head'));

    if (this.loading) {
      this.msg(panel, box, t('ctl.tgt.loading'));
      return;
    }
    // 배치전이 아직 안 끝났으나 순위 삽입 대기(completing)면 목록 대신 안내.
    if (this.isCompleting()) {
      this.msg(panel, box, t('ctl.tgt.completingMsg'));
      return;
    }

    const list = placementMode ? this.placementTargets : this.targets;
    if (list === null) {
      this.msg(panel, box, placementMode ? t('ctl.tgt.placementNull') : t('ctl.tgt.normalNull'));
      return;
    }
    if (list.length === 0) {
      this.msg(panel, box, placementMode ? t('ctl.tgt.placementEmpty') : t('ctl.tgt.normalEmpty'));
      return;
    }

    const step = TGT_ROW_H + TGT_ROW_GAP;
    const total = list.length * step - TGT_ROW_GAP;
    const avail = box.bottom - CONTENT_TOP;
    const bounds: number[] = [];
    for (let i = 1; i <= list.length; i++) bounds.push(i * step - TGT_ROW_GAP);
    const maskH = this.clampToRows(avail, bounds);

    const content = this.scrollArea(
      panel,
      box.x,
      CONTENT_TOP,
      box.w,
      maskH,
      total,
      () => this.targetScrollY,
      (v) => {
        this.targetScrollY = v;
      },
    );

    const now = Date.now();
    list.forEach((target, i) => {
      const row = this.makeTargetRow(target, placementMode, now, box.w);
      row.position.set(0, i * step);
      content.addChild(row);
    });
  }

  /** 대상 1행(일반/배치전 공통). 배치전은 쿨다운 무시 + 시드 이름·난이도 밴드 표시. */
  private makeTargetRow(target: InvasionTarget, placementMode: boolean, now: number, w: number): Container {
    const st = placementMode
      ? computePlacementInvadeState(target)
      : computeInvadeState(target, this.cooldowns, now);
    const meta = placementMode ? seedBaseByProfileId(target.profileId) : null;
    const selected = this.selectedId === target.profileId;

    const row = new Container();
    // 선택 클릭은 **행 전체**가 받는다. 바탕(Graphics)에만 걸면 이름·정비도 텍스트 위를
    // 눌렀을 때 먹지 않는다 — Pixi 는 위에 얹힌 텍스트에서 히트를 멈추고 그 위의 상호작용
    // 조상(화면 root)으로 올라가 버리기 때문이다(실측 결함). 침공 버튼만 아래에서 전파를 끊는다.
    row.eventMode = 'static';
    row.cursor = 'pointer';
    row.on('pointertap', () => this.selectTarget(target.profileId));
    row.addChild(listRowBg(w, TGT_ROW_H, { selected }));

    const rank = new Text({
      resolution: 2,
      text: `#${target.rank}`,
      style: { fontFamily: UI_FONT, fontSize: 24, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    rank.anchor.set(0.5, 0.5);
    rank.position.set(38, TGT_ROW_H / 2);
    row.addChild(rank);

    const textX = 76;
    const textW = Math.max(60, w - TGT_BTN_W - 24 - textX);

    const name = new Text({
      resolution: 2,
      text: placementMode ? placementTargetName(target) : target.displayName,
      style: { fontFamily: UI_FONT, fontSize: 21, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    name.position.set(textX, 12);
    if (name.width > textW) name.scale.x = textW / name.width;
    row.addChild(name);

    // 배치전이면 난이도 밴드 + 기체 요약, 일반이면 기체 요약.
    const desc = new Text({
      resolution: 2,
      text:
        meta !== null
          ? t('ctl.tgt.difficulty', { band: meta.difficultyBand, ship: shipSummaryText(target.shipSummary) })
          : shipSummaryText(target.shipSummary),
      style: { fontFamily: UI_FONT, fontSize: 16, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    desc.position.set(textX, 42);
    if (desc.width > textW) desc.scale.x = textW / desc.width;
    row.addChild(desc);

    const maint = new Text({
      resolution: 2,
      text: maintenanceLabel(target.maintenance),
      style: { fontFamily: UI_FONT, fontSize: 16, fontWeight: '700', fill: 0x8fd94c, dropShadow: TEXT_SHADOW },
    });
    maint.position.set(textX, 68);
    if (maint.width > textW) maint.scale.x = textW / maint.width;
    row.addChild(maint);

    const canInvade = st.canInvade;
    const btn = new PixiButton({
      texture: this.ui[canInvade ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: canInvade ? 0x9a7a2a : 0x4a3a24,
      width: TGT_BTN_W,
      height: TGT_BTN_H,
      // 비활성 라벨은 사유 문구("재도전까지 45분")라 한 단계 작게 잡는다.
      fontSize: canInvade ? 22 : 16,
      ...(canInvade ? { labelColor: COLOR.darkLabel } : {}),
      label: canInvade ? (placementMode ? t('ctl.tgt.btnPlacement') : t('ctl.tgt.btnInvade')) : st.reason,
      onClick: () => this.invade(target),
    });
    btn.container.position.set(w - TGT_BTN_W - 12, (TGT_ROW_H - TGT_BTN_H) / 2);
    // 침공은 행 선택과 다른 동작이다 — 버튼을 눌렀을 때 행 선택까지 따라오지 않게 끊는다.
    // (비활성 버튼은 eventMode 'none' 이라 이 리스너도 죽고, 클릭이 행 선택으로 넘어간다.)
    btn.container.on('pointertap', (e) => e.stopPropagation());
    row.addChild(btn.container);
    if (!canInvade) btn.setEnabled(false);

    return row;
  }

  // --- 기지 정찰 -----------------------------------------------------------

  private renderReconPanel(x: number, y: number, w: number, h: number): void {
    const { panel, box } = this.addPanel(x, y, w, h);
    this.panelTitle(panel, box, t('ctl.recon.head'));

    // 선택 대상은 일반/배치전 두 목록 중 하나에 있다.
    const inList = (list: InvasionTarget[] | null): InvasionTarget | null =>
      list?.find((entry) => entry.profileId === this.selectedId) ?? null;
    const target = inList(this.targets) ?? inList(this.placementTargets);
    if (target === null) {
      this.msg(panel, box, t('ctl.recon.selectPrompt'));
      return;
    }
    const layout = normalizeLayout(target.layout);
    if (layout === null) {
      this.msg(panel, box, t('ctl.recon.noBase'));
      return;
    }

    // 요약 한 줄 자리를 남기고 남은 상자 안에 격자를 정확히 맞춘다(상자 밖 침범 0).
    // 칸 크기는 폭·높이 양쪽에서 뽑아 작은 쪽을 쓴다 — 열이 좁아져도 격자가 상자를 넘지 않는다.
    const summaryH = 40;
    const availH = box.bottom - summaryH - CONTENT_TOP;
    const cellFromH = Math.floor((availH + RECON_CELL_GAP) / GRID_ROWS) - RECON_CELL_GAP;
    const cellFromW = Math.floor((box.w + RECON_CELL_GAP) / GRID_COLS) - RECON_CELL_GAP;
    const cell = Math.max(8, Math.min(RECON_CELL_MAX, cellFromH, cellFromW));
    const gridW = GRID_COLS * (cell + RECON_CELL_GAP) - RECON_CELL_GAP;
    const gridH = GRID_ROWS * (cell + RECON_CELL_GAP) - RECON_CELL_GAP;
    const gridX = box.x + Math.floor((box.w - gridW) / 2);
    // 격자 + 요약을 한 덩어리로 묶어 세로 가운데 정렬한다(요약만 바닥에 떨어지면 따로 논다).
    const gridY = CONTENT_TOP + Math.floor((availH - gridH) / 2);

    const occupied = new Map<string, PreviewCell>();
    for (const c of previewCells(layout)) occupied.set(`${c.col},${c.row}`, c);

    const grid = new Container();
    grid.position.set(gridX, gridY);
    panel.addChild(grid);
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const pc = occupied.get(`${col},${row}`);
        const c = this.makeReconCell(cell, pc);
        c.position.set(col * (cell + RECON_CELL_GAP), row * (cell + RECON_CELL_GAP));
        grid.addChild(c);
      }
    }

    const sum = new Text({
      resolution: 2,
      text: t('ctl.recon.summary', { t: layout.turrets.length, o: layout.obstacles.length }),
      style: { fontFamily: UI_FONT, fontSize: 17, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sum.anchor.set(0.5, 0);
    sum.position.set(box.x + box.w / 2, Math.min(gridY + gridH + 16, box.bottom - 22));
    if (sum.width > box.w) sum.scale.x = box.w / sum.width;
    panel.addChild(sum);
  }

  /** 정찰 격자 한 칸(도형 + hover 라벨 툴팁). DOM 판의 `title` 속성 툴팁과 같은 정보다. */
  private makeReconCell(size: number, pc: PreviewCell | undefined): Container {
    const cellRoot = new Container();
    const spawn = pc?.spawn === true;
    const bg = new Graphics();
    bg.roundRect(0, 0, size, size, 3).fill({ color: spawn ? 0x4a3a1e : 0x2a2440, alpha: 0.9 });
    cellRoot.addChild(bg);
    if (pc === undefined) return cellRoot;

    const color = hexColor(pc.accent);
    const c = size / 2;
    const r = size * 0.3;
    const shape = GLYPH_SHAPE[pc.glyph] ?? 'turret';
    const g = new Graphics();
    if (shape === 'core') {
      g.poly([c, c - r, c + r, c, c, c + r, c - r, c]).fill({ color });
    } else if (shape === 'obstacle') {
      g.roundRect(c - r, c - r, r * 2, r * 2, 2).fill({ color });
    } else if (shape === 'spawn') {
      g.poly([c, c - r, c + r, c + r, c - r, c + r]).fill({ color });
    } else {
      g.circle(c, c, r).fill({ color });
    }
    cellRoot.addChild(g);

    const label = pc.label;
    cellRoot.eventMode = 'static';
    cellRoot.on('pointerover', (e) => {
      const p = this.root.toLocal({ x: e.global.x, y: e.global.y });
      this.tooltip.show({ title: label, titleColor: color, subtitle: '', lines: [] }, p.x, p.y, color);
      this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    });
    cellRoot.on('pointerout', () => this.tooltip.hide());
    return cellRoot;
  }

  // --- 소식(복수전 · 알림) --------------------------------------------------

  /**
   * 복수 대상 카드(F1) + 내가 당한 침공 알림(계약 5)을 한 열에 담는다. 둘 다 "내 기지에
   * 벌어진 일"이고 각각은 대개 몇 건뿐이라, 열을 둘로 쪼개면 양쪽이 다 허전해진다.
   */
  private renderNewsPanel(x: number, y: number, w: number, h: number): void {
    const revenge = this.revengeTargets ?? [];
    const incoming = this.incoming ?? [];
    const { panel, box } = this.addPanel(x, y, w, h);
    const bannerText = incomingBannerText(this.unseenCount);
    const head =
      revenge.length > 0
        ? t('ctl.rev.head')
        : bannerText.length > 0
          ? bannerText
          : t('ctl.notif.head');
    this.panelTitle(panel, box, head, revenge.length > 0 ? 0xffb0a0 : COLOR.cream);

    // 행을 **미리 조립해** 각자의 실제 높이를 안 뒤 그 경계로 마스크를 클램프한다(반토막 행
    // 금지). 알림 행은 문구 길이·열 폭에 따라 줄 수가 달라져 높이가 고정이 아니다.
    const rows: { node: Container; h: number }[] = [];
    const now = Date.now();
    for (const target of revenge) {
      rows.push(this.makeRevengeRow(target, now, box.w));
    }
    if (revenge.length > 0 && incoming.length > 0) {
      // 두 종류가 섞이면 어디부터 알림인지 알려 준다(패널 제목은 복수전을 가리키고 있다).
      rows.push({
        node: this.makeNewsHeader(bannerText.length > 0 ? bannerText : t('ctl.notif.head'), box.w),
        h: NEWS_HEAD_H,
      });
    }
    for (const inv of incoming) {
      rows.push(this.makeIncomingRow(inv, box.w));
    }

    const bounds: number[] = [];
    let total = 0;
    rows.forEach((r, i) => {
      total += r.h + (i > 0 ? NEWS_GAP : 0);
      bounds.push(total);
    });
    const maskH = this.clampToRows(box.bottom - CONTENT_TOP, bounds);

    const content = this.scrollArea(
      panel,
      box.x,
      CONTENT_TOP,
      box.w,
      maskH,
      total,
      () => this.newsScrollY,
      (v) => {
        this.newsScrollY = v;
      },
    );

    let cursor = 0;
    for (const r of rows) {
      r.node.position.set(0, cursor);
      content.addChild(r.node);
      cursor += r.h + NEWS_GAP;
    }
  }

  private makeNewsHeader(text: string, w: number): Container {
    const row = new Container();
    const el = new Text({
      resolution: 2,
      text,
      style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    el.anchor.set(0, 1);
    el.position.set(0, NEWS_HEAD_H - 6);
    if (el.width > w) el.scale.x = w / el.width;
    row.addChild(el);
    return row;
  }

  /**
   * 복수 대상 카드 1장(24h 창 · 쿨다운 무시 배지 · 복수 침공 버튼). 소식 열은 좁아서 버튼을
   * 문구 옆에 두면 문구가 눌려 읽을 수 없게 된다 → 문구를 가로 폭 전체로 쓰고 버튼을 아래
   * 오른쪽에 세운다. 줄 수가 달라지므로 실제 높이를 재서 돌려준다.
   */
  private makeRevengeRow(target: RevengeTarget, now: number, w: number): { node: Container; h: number } {
    const st = revengeCardState(target, now);
    const row = new Container();

    // 쿨다운 무시 배지 — 이름 줄 오른쪽 끝에 금색 칩(이름과 겹치지 않게 자리를 먼저 잡는다).
    const badgeText = new Text({
      resolution: 2,
      text: t('ctl.rev.badge'),
      style: { fontFamily: UI_FONT, fontSize: 13, fontWeight: '800', fill: COLOR.darkLabel },
    });
    const badgeW = badgeText.width + 14;
    const badgeBox = new Container();
    const badge = new Graphics();
    badge.roundRect(0, 0, badgeW, 22, 6).fill({ color: COLOR.gold });
    badgeBox.addChild(badge);
    badgeText.position.set(7, 3);
    badgeBox.addChild(badgeText);
    badgeBox.position.set(w - 14 - badgeW, 13);

    const name = new Text({
      resolution: 2,
      text: target.displayName.length > 0 ? target.displayName : t('ctl.anonymous'),
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '800', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
    });
    name.position.set(14, 10);
    const nameMaxW = Math.max(40, w - 28 - badgeW - 12);
    if (name.width > nameMaxW) name.scale.x = nameMaxW / name.width;

    const rem = new Text({
      resolution: 2,
      text: st.expired ? t('ctl.rev.expired') : `${st.remainingLabel} · ${shipSummaryText(target.shipSummary)}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fontWeight: '700',
        fill: COLOR.gold,
        wordWrap: true,
        wordWrapWidth: w - 28,
        dropShadow: TEXT_SHADOW,
      },
    });
    rem.position.set(14, 44);

    const btnY = 44 + Math.ceil(rem.height) + 12;
    const h = btnY + NEWS_BTN_H + 12;
    row.addChild(listRowBg(w, h, { accent: 0x8a4a4a }));
    row.addChild(name);
    row.addChild(badgeBox);
    row.addChild(rem);

    const canRevenge = !st.expired && st.layout !== null;
    const btn = new PixiButton({
      texture: this.ui[canRevenge ? 'ui_btn_red.png' : 'ui_btn_wood.png'],
      fallbackColor: canRevenge ? 0x8a3a3a : 0x4a3a24,
      width: NEWS_BTN_W,
      height: NEWS_BTN_H,
      fontSize: 18,
      label: st.expired ? t('ctl.rev.btnExpired') : st.layout === null ? t('ctl.rev.btnNoBase') : t('ctl.rev.btnRevenge'),
      onClick: () => {
        const layout = st.layout;
        if (!canRevenge || layout === null) return;
        const cb = this.onInvade;
        this.hide();
        cb?.(target, layout);
      },
    });
    btn.container.position.set(w - NEWS_BTN_W - 14, btnY);
    row.addChild(btn.container);
    if (!canRevenge) btn.setEnabled(false);

    return { node: row, h };
  }

  /**
   * 내가 당한 침공 1건(결과 문구 + 도발/관전 버튼). 문구가 길거나 열이 좁으면 줄이 늘어나므로
   * **행 높이를 재서** 돌려준다 — 목록이 그 높이로 마스크를 클램프한다.
   */
  private makeIncomingRow(inv: IncomingInvasion, w: number): { node: Container; h: number } {
    const row = new Container();
    // 내가 이미 이 침공에 도발을 남겼으면 함께 표시(방어 성공 회신).
    const myTaunt = stickerLabel(inv.defenderSticker);
    const base =
      myTaunt.length > 0
        ? `${incomingRowText(inv)}${t('ctl.notif.myTaunt', { taunt: myTaunt })}`
        : incomingRowText(inv);

    const buttons: PixiButton[] = [];
    // 방어 성공(격퇴)했고 아직 회신 도발이 없으면 "도발" 버튼(F2 방어자 몫).
    if (inv.invasionId.length > 0 && !inv.attackerWon && inv.defenderSticker === null) {
      buttons.push(
        new PixiButton({
          texture: this.ui['ui_btn_wood.png'],
          fallbackColor: 0x4a3a24,
          width: NOTIF_BTN_W,
          height: NOTIF_BTN_H,
          fontSize: 16,
          label: t('ctl.notif.tauntBtn'),
          onClick: () => this.onSticker?.(inv.invasionId, inv.attackerName),
        }),
      );
    }
    if (inv.invasionId.length > 0) {
      buttons.push(
        new PixiButton({
          texture: this.ui['ui_btn_blue.png'],
          fallbackColor: 0x3a4a7a,
          width: NOTIF_BTN_W,
          height: NOTIF_BTN_H,
          fontSize: 16,
          label: t('ctl.notif.spectate'),
          onClick: () => this.onSpectate?.(inv.invasionId, inv.attackerName),
        }),
      );
    }

    const txt = new Text({
      resolution: 2,
      // 스티커 라벨의 컬러 이모지는 캔버스에서 두부로 떨어진다(문구는 남는다).
      text: stripEmoji(base),
      style: {
        fontFamily: UI_FONT,
        fontSize: 16,
        fill: inv.attackerWon ? 0xffb0a0 : 0xa8dda8,
        wordWrap: true,
        wordWrapWidth: w - 28,
        dropShadow: TEXT_SHADOW,
      },
    });
    txt.position.set(14, 12);

    // 버튼은 문구 아래 오른쪽 — 옆에 붙이면 좁은 열에서 문구가 눌린다(복수 카드와 같은 규칙).
    const btnY = 12 + Math.ceil(txt.height) + (buttons.length > 0 ? 10 : 0);
    const h = Math.max(NOTIF_ROW_H, btnY + (buttons.length > 0 ? NOTIF_BTN_H + 12 : 12));
    row.addChild(listRowBg(w, h, { accent: inv.attackerWon ? 0x8a4a4a : 0x4a7a4a }));
    row.addChild(txt);

    buttons.forEach((b, i) => {
      b.container.position.set(
        w - 14 - (buttons.length - i) * NOTIF_BTN_W - (buttons.length - 1 - i) * 8,
        btnY,
      );
      row.addChild(b.container);
    });

    return { node: row, h };
  }

  // --- 순위표 -------------------------------------------------------------

  private renderLadderPanel(x: number, y: number, w: number, h: number): void {
    const { panel, box } = this.addPanel(x, y, w, h);
    this.panelTitle(panel, box, t('ctl.ladder.head'));

    if (this.loading) {
      this.msg(panel, box, t('ctl.ladder.loading'));
      return;
    }
    const ladder = this.ladder;
    if (ladder === null) {
      this.msg(panel, box, t('ctl.ladder.null'));
      return;
    }
    if (ladder.length === 0) {
      this.msg(panel, box, t('ctl.ladder.empty'));
      return;
    }

    const rankW = Math.round(box.w * 0.22);
    const recW = Math.round(box.w * 0.3);
    const nameX = rankW + 8;
    const nameW = Math.max(40, box.w - rankW - recW - 16);

    // 헤더 행(고정) — 스크롤 대상이 아니다.
    const headStyle = { fontFamily: UI_FONT, fontSize: 15, fontWeight: '700' as const, fill: COLOR.muted };
    const headers: [string, number, number][] = [
      [t('ctl.ladder.rank'), 0, 0],
      [t('ctl.ladder.name'), nameX, 0],
      [t('ctl.ladder.record'), box.w, 1],
    ];
    for (const [label, hx, anchorX] of headers) {
      const el = new Text({ resolution: 2, text: label, style: headStyle });
      el.anchor.set(anchorX, 0);
      el.position.set(box.x + hx, CONTENT_TOP);
      panel.addChild(el);
    }
    const rule = new Graphics();
    rule
      .rect(box.x, CONTENT_TOP + LAD_HEAD_H - 8, box.w, 2)
      .fill({ color: 0x5a4630, alpha: 0.8 });
    panel.addChild(rule);

    const listTop = CONTENT_TOP + LAD_HEAD_H;
    const total = ladder.length * LAD_ROW_H;
    const bounds: number[] = [];
    for (let i = 1; i <= ladder.length; i++) bounds.push(i * LAD_ROW_H);
    const maskH = this.clampToRows(box.bottom - listTop, bounds);

    const content = this.scrollArea(
      panel,
      box.x,
      listTop,
      box.w,
      maskH,
      total,
      () => this.ladderScrollY,
      (v) => {
        this.ladderScrollY = v;
      },
    );

    ladder.forEach((e, i) => {
      const ry = i * LAD_ROW_H;
      if (i % 2 === 1) {
        const stripe = new Graphics();
        stripe.rect(0, ry, box.w, LAD_ROW_H).fill({ color: 0xffffff, alpha: 0.035 });
        content.addChild(stripe);
      }
      const rank = new Text({
        resolution: 2,
        text: `#${e.rank}`,
        style: { fontFamily: UI_FONT, fontSize: 17, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
      });
      rank.position.set(0, ry + 6);
      content.addChild(rank);

      const name = new Text({
        resolution: 2,
        text: e.displayName ?? `${e.profileId.slice(0, 6)}…`,
        style: { fontFamily: UI_FONT, fontSize: 16, fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      name.position.set(nameX, ry + 7);
      if (name.width > nameW) name.scale.x = nameW / name.width;
      content.addChild(name);

      const rec = new Text({
        resolution: 2,
        text: t('ctl.ladder.wl', { w: e.wins, l: e.losses }),
        style: { fontFamily: UI_FONT, fontSize: 16, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      rec.anchor.set(1, 0);
      rec.position.set(box.w, ry + 7);
      content.addChild(rec);
    });
  }

  // --- 하단 -------------------------------------------------------------

  private renderFooter(): void {
    const note = new Text({
      resolution: 2,
      text: t('ctl.note'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 16,
        fill: COLOR.muted,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: BOARD_W,
        dropShadow: TEXT_SHADOW,
      },
    });
    note.anchor.set(0.5, 0);
    note.position.set(DESIGN_WIDTH / 2, NOTE_Y);
    this.root.addChild(note);

    const back = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: BACK_W,
      height: BACK_H,
      fontSize: 22,
      label: t('common.backToBase'),
      onClick: () => this.back(),
    });
    back.container.position.set((DESIGN_WIDTH - BACK_W) / 2, BACK_Y);
    this.root.addChild(back.container);
  }
}
