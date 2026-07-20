/**
 * 관제탑 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #6).
 *
 * `src/ui/controlTower.ts` 의 DOM `ControlTower` 와 기능 동등하게 침공 사령 화면을 Pixi
 * 캔버스(1920×1080 디자인 스페이스)로 재구현한다. 공개 인터페이스(`show`/`hide`/`visible`)와
 * 콜백·옵션 타입은 DOM 판 그대로라 main.ts 는 생성자 한 줄만 바뀐다(롤아웃 공통 규칙 2).
 * DOM 클래스는 회귀 대비로 남긴다(ADR-0014).
 *
 * ── 화면 구성(실화면 판정에서 사용자가 정한 형태) ──
 * 한 화면에 모든 표를 늘어놓으면 어느 것도 제대로 못 본다. **지금 행동할 것만 보드에 두고,
 * 훑어보는 것은 팝업으로 뺐다**:
 *   - 보드(상시): 침공 대상 제안 · 기지 정찰 · (복수전 — 24h 창이 있을 때만)
 *   - 팝업: 순위표(검색·페이징·내 순위) · 침공 알림(우상단 버튼, 내용 있을 때만) ·
 *     전투 기록(공/수 필터·정렬·검색·페이징)
 *   - 위: 상태 패널(결과 배너 · 서버 검증 중 · 배치전 진행/순위 진입 · 상대 카드 정찰 공개)
 *
 * 서버 왕복이 있는 유일한 메타 화면이다 — 로딩·미설정·빈 목록 문구 경로를 DOM 판 그대로
 * 유지한다(env 미설정/미로그인이면 net 계층이 null 을 돌려주고 안내 상태로 뜬다).
 * 팝업 데이터(순위표 전체·전투 기록)는 **열 때 로드**한다(화면 진입을 무겁게 하지 않는다).
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Rectangle, Sprite, Text, type FederatedPointerEvent } from 'pixi.js';
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
  fetchPlacementStatus,
  fetchPlacementTargets,
  fetchRevengeTargets,
  fetchIncomingInvasions,
  fetchLadderPage,
  fetchMyLadderRank,
  fetchInvasionHistory,
  applyPlacementResult,
  placementPhase,
  placementProgressLabel,
  placementRemaining,
  readInvasionCooldowns,
  readInvasionsSeenAt,
  writeInvasionsSeenAt,
  countUnseenInvasions,
  historyIWon,
  type InvasionTarget,
  type LadderEntry,
  type PlacementStatus,
  type PlacementResult,
  type RevengeTarget,
  type IncomingInvasion,
  type InvasionHistoryEntry,
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
import { loadUiTextures, stickerIconName, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER, type PanelContentBox } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { PixiTooltip } from './tooltip.js';
import { makeBanner, makeIconButton } from './titleBar.js';
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

/** 열려 있는 팝업 종류(없으면 null). */
type ModalKind = 'ladder' | 'alerts' | 'history';

/** 전투 기록 필터(공/수). */
type HistoryFilter = 'all' | 'attack' | 'defense';

// --- 레이아웃 상수(디자인 스페이스) ---
const BANNER_W = 440;
const BANNER_H = 72;
const BANNER_Y = 12;
const SUB_Y = 94;

const MARGIN = 48;
const BOARD_W = DESIGN_WIDTH - MARGIN * 2;
const BOARD_TOP = 132;
/** 보드(열 패널)가 쓸 수 있는 아래 한계 — 그 밑은 하단 버튼 행. */
const BOARD_BOTTOM = 956;
const GAP = 24;

/** 상태 패널(결과 배너·검증 중·배치전·카드 공개) 높이 한계. 내용에 맞춰 재는 값이다. */
const STATUS_MIN_H = 140;
const STATUS_MAX_H = 300;

/** 열 폭 — 복수전(24h 창)이 있을 때만 3열이 된다(없으면 둘이 넓어진다). */
const COLS_2 = { targets: 900, recon: 900 } as const;
const COLS_3 = { targets: 640, recon: 700, revenge: 436 } as const;

/** 패널 제목(26px) 아래에서 본문이 시작한다 — 상자 top(60) + 58. */
const CONTENT_TOP = 118;

// 알림 버튼(우상단).
const ALERT_BTN_W = 240;
const ALERT_BTN_H = 56;
const ALERT_BTN_Y = 22;
/** 알림 행의 도발 스티커 아이콘 크기 — 첫 줄(상대 도발) · 상세 줄(내 회신 도발). */
const ALERT_ICON_H = 28;
const ALERT_ICON_SUB = 22;

// 대상 목록 행.
const TGT_ROW_H = 96;
const TGT_ROW_GAP = 10;
const TGT_BTN_W = 170;
const TGT_BTN_H = 52;

// 복수전 행.
const REV_BTN_W = 120;
const REV_BTN_H = 44;
const REV_ROW_GAP = 8;

// 배치전 진행바.
const SEG_W = 56;
const SEG_H = 12;
const SEG_GAP = 8;

// 정찰 격자.
const RECON_CELL_MAX = 44;
const RECON_CELL_GAP = 3;

// 하단 버튼 행.
const FOOT_Y = 980;
const FOOT_H = 64;
const BACK_W = 300;
const SIDE_BTN_W = 260;
const FOOT_GAP = 24;

// 팝업.
const MODAL_W = 1360;
const MODAL_H = 880;
const MODAL_X = (DESIGN_WIDTH - MODAL_W) / 2;
const MODAL_Y = (DESIGN_HEIGHT - MODAL_H) / 2;
/** 팝업 제목(60) 아래 — 검색줄·요약줄이 여기서 시작한다. */
const MODAL_TOOL_Y = 124;
const SEARCH_W = 420;
const SEARCH_H = 48;
const LADDER_ROW_H = 44;
/** 마지막 행이 페이지 이동 줄을 밀지 않는 최대 행 수(상자 바닥에서 역산한 값). */
const LADDER_PAGE = 11;
const HIST_ROW_H = 48;
const HIST_PAGE = 10;
/** 페이지 이동 줄이 차지하는 높이 — 표는 이 위에서 끝난다. */
const PAGER_H = 52;
/** 순위표 RPC 상한(get_ladder_top 은 200 을 넘겨도 200 으로 자른다). */
const LADDER_CAP = 200;
/** 전투 기록 조회 상한. */
const HISTORY_CAP = 100;

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

/** 승률 %(정수). 전적이 없으면 0. */
function winRate(wins: number, losses: number): number {
  const total = wins + losses;
  return total > 0 ? Math.round((wins / total) * 100) : 0;
}

/** epoch ms → "3시간 전" 같은 상대 시각(순수 표시). */
function relTime(atMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - atMs);
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('ctl.time.now');
  if (min < 60) return t('ctl.time.min', { n: min });
  const hour = Math.floor(min / 60);
  if (hour < 24) return t('ctl.time.hour', { n: hour });
  return t('ctl.time.day', { n: Math.floor(hour / 24) });
}

/**
 * 캔버스 위에 얹는 DOM 검색 입력.
 *
 * Pixi 에는 텍스트 입력이 없다. 캔버스 좌표(디자인 스페이스)를 stage 변환 + 캔버스 화면
 * 위치로 환산해 `<input>` 을 절대 배치한다. **한 글자 칠 때마다 화면이 다시 그려져도 이
 * 엘리먼트는 다시 만들지 않는다** — 재생성하면 포커스와 IME 조합이 끊긴다.
 */
class SearchInput {
  private el: HTMLInputElement | null = null;
  private key = '';
  private onResize: (() => void) | null = null;
  private rect = { x: 0, y: 0, w: 0, h: 0 };
  private stage: Container | null = null;

  /** `key` 가 같으면 기존 엘리먼트를 재사용하고 위치만 갱신한다. */
  mount(
    stage: Container,
    key: string,
    rect: { x: number; y: number; w: number; h: number },
    placeholder: string,
    value: string,
    onInput: (v: string) => void,
  ): void {
    this.stage = stage;
    this.rect = rect;
    if (this.el !== null && this.key === key) {
      this.reposition();
      return;
    }
    this.unmount();
    this.key = key;
    const el = document.createElement('input');
    el.type = 'text';
    el.value = value;
    el.placeholder = placeholder;
    el.style.cssText = [
      'position:fixed',
      'z-index:40',
      'box-sizing:border-box',
      'outline:none',
      'border-radius:8px',
      'border:2px solid #6b4a2a',
      'background:#1c182e',
      'color:#ebdcbe',
      `font-family:${UI_FONT}`,
      'padding:0 10px',
    ].join(';');
    el.addEventListener('input', () => onInput(el.value));
    document.body.appendChild(el);
    this.el = el;
    this.onResize = () => this.reposition();
    window.addEventListener('resize', this.onResize);
    this.reposition();
    el.focus();
  }

  /** 디자인 좌표 → 화면 좌표. stage 변환(레터박스 스케일 + 오프셋) + 캔버스 위치. */
  reposition(): void {
    const el = this.el;
    const stage = this.stage;
    if (el === null || stage === null) return;
    const canvas = document.querySelector('canvas');
    if (canvas === null) return;
    const bounds = canvas.getBoundingClientRect();
    const wt = stage.worldTransform;
    const sx = wt.a;
    const sy = wt.d;
    el.style.left = `${bounds.left + this.rect.x * sx + wt.tx}px`;
    el.style.top = `${bounds.top + this.rect.y * sy + wt.ty}px`;
    el.style.width = `${this.rect.w * sx}px`;
    el.style.height = `${this.rect.h * sy}px`;
    el.style.fontSize = `${Math.max(11, Math.round(20 * sy))}px`;
  }

  unmount(): void {
    if (this.onResize !== null) {
      window.removeEventListener('resize', this.onResize);
      this.onResize = null;
    }
    this.el?.remove();
    this.el = null;
    this.key = '';
  }
}

export class ControlTowerScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  private readonly search = new SearchInput();
  private ui: UiTextures = {};

  private onInvade: ControlTowerCallbacks['onInvade'] | null = null;
  private onSpectate: ControlTowerCallbacks['onSpectate'] | null = null;
  private onSticker: ControlTowerCallbacks['onSticker'] | null = null;
  private onBack: (() => void) | null = null;

  private targets: InvasionTarget[] | null = null; // null = 미로딩/미설정
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

  // --- 팝업 상태(열 때 로드) ---
  private modal: ModalKind | null = null;
  private ladderAll: LadderEntry[] | null = null;
  private myRank: LadderEntry | null = null;
  private ladderLoading = false;
  private ladderPage = 0;
  private ladderQuery = '';
  private history: InvasionHistoryEntry[] | null = null;
  private historyLoading = false;
  private historyPage = 0;
  private historyQuery = '';
  private historyFilter: HistoryFilter = 'all';
  private historyNewestFirst = true;
  /** profileId → 표시명(순위표·대상 목록·시드 기지에서 모은다). */
  private readonly names = new Map<string, string>();

  // 목록 스크롤 위치(재렌더 사이 유지).
  private targetScrollY = 0;
  private revengeScrollY = 0;
  private alertScrollY = 0;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.root.visible || this.modal === null) return;
    if (e.key === 'Escape') this.closeModal();
  };

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    this.root.addChild(this.tooltip.container);
    window.addEventListener('keydown', this.onKeyDown);
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
    this.placement = null;
    this.placementTargets = null;
    this.placementResult = null;
    this.applying = false;
    this.revengeTargets = null;
    this.incoming = null;
    this.unseenCount = 0;
    this.modal = null;
    this.ladderAll = null;
    this.myRank = null;
    this.history = null;
    this.ladderPage = 0;
    this.historyPage = 0;
    this.ladderQuery = '';
    this.historyQuery = '';
    this.historyFilter = 'all';
    this.historyNewestFirst = true;
    this.names.clear();
    this.targetScrollY = 0;
    this.revengeScrollY = 0;
    this.alertScrollY = 0;
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
    this.search.unmount();
    this.modal = null;
    this.onInvade = null;
    this.onSpectate = null;
    this.onSticker = null;
    this.onBack = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  // --- 로드 (DOM 판과 동일 규칙) --------------------------------------------

  /** 타깃·복수·알림·배치전·쿨다운을 비동기 로드하고 재렌더. race 방지 토큰 사용. */
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
    const [targets, placement, revenge, incoming] = await Promise.all([
      fetchInvasionTargets(),
      fetchPlacementStatus(),
      fetchRevengeTargets(),
      fetchIncomingInvasions(seenAt, 20),
    ]);
    if (token !== this.loadToken || !this.visible) return; // 낡은 로드 무시
    this.targets = targets;
    this.placement = placement;
    this.revengeTargets = revenge;
    this.incoming = incoming;
    this.rememberNames(targets);
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
      this.rememberNames(pts);
    }
    this.loading = false;
    this.render();
  }

  /** 순위표 전체(상한 200) + 내 순위 — 순위표/전투 기록 팝업이 열릴 때 한 번 받는다. */
  private async loadLadder(): Promise<void> {
    if (this.ladderLoading || this.ladderAll !== null) return;
    this.ladderLoading = true;
    this.render();
    const [page, mine] = await Promise.all([fetchLadderPage(LADDER_CAP, 0), fetchMyLadderRank()]);
    if (!this.visible) return;
    this.ladderLoading = false;
    this.ladderAll = page;
    this.myRank = mine;
    if (page !== null) {
      for (const e of page) {
        if (e.displayName !== undefined && e.displayName.length > 0) this.names.set(e.profileId, e.displayName);
      }
    }
    this.render();
  }

  /** 전투 기록 — 상대 이름 해석에 순위표가 필요해 함께 받는다. */
  private async loadHistory(): Promise<void> {
    if (this.historyLoading || this.history !== null) return;
    this.historyLoading = true;
    this.render();
    void this.loadLadder();
    const rows = await fetchInvasionHistory(HISTORY_CAP);
    if (!this.visible) return;
    this.historyLoading = false;
    this.history = rows;
    this.render();
  }

  /** 대상 목록의 표시명을 이름 사전에 모은다(전투 기록의 상대 이름 해석에 쓴다). */
  private rememberNames(list: InvasionTarget[] | null): void {
    if (list === null) return;
    for (const target of list) {
      if (target.displayName.length > 0) this.names.set(target.profileId, target.displayName);
    }
  }

  /** profileId → 표시명. 순위표·대상 목록 → NPC 시드 기지 메타 → 무명 순으로 찾는다. */
  private nameOf(profileId: string): string {
    const known = this.names.get(profileId);
    if (known !== undefined && known.length > 0) return known;
    const seed = seedBaseByProfileId(profileId);
    if (seed !== null) return seed.name;
    return t('ctl.anonymous');
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
      // 순위 진입 — 배치전 종료. 상태를 placed 로 갱신하고 목록을 새로 로드한다.
      this.placement =
        this.placement !== null
          ? { ...this.placement, placed: true }
          : { completed: 0, won: 0, total: 0, placed: true };
      this.ladderAll = null; // 순위가 바뀌었으니 팝업 캐시를 버린다.
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

  private openModal(kind: ModalKind): void {
    this.modal = kind;
    if (kind === 'ladder') {
      this.ladderPage = 0;
      void this.loadLadder();
    }
    if (kind === 'history') {
      this.historyPage = 0;
      void this.loadHistory();
    }
    this.render();
  }

  private closeModal(): void {
    this.modal = null;
    this.search.unmount();
    this.render();
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
  private msg(parent: Container, box: PanelContentBox, text: string, top = CONTENT_TOP + 40): void {
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
    el.position.set(box.x + box.w / 2, top);
    parent.addChild(el);
  }

  private label(
    text: string,
    size: number,
    color: number,
    weight: '400' | '700' | '800' = '400',
    maxW?: number,
  ): Text {
    const el = new Text({
      resolution: 2,
      text,
      style: { fontFamily: UI_FONT, fontSize: size, fontWeight: weight, fill: color, dropShadow: TEXT_SHADOW },
    });
    if (maxW !== undefined && el.width > maxW) el.scale.x = maxW / el.width;
    return el;
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
      // 휠은 **클립 Container** 가 받는다 — 마스크로 쓰이는 Graphics 는 히트 테스트에서 제외돼
      // (`isMask`) 리스너가 영영 불리지 않는다(카드 화면 #7 에서 실측). hitArea 를 주면 행 사이
      // 빈 자리에서도 잡히고, 행 위에서는 행 → 클립으로 버블링되어 함께 성립한다.
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
    this.renderBoard(boardY, BOARD_BOTTOM - boardY);

    this.renderFooter();
    this.renderModal();

    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('ctl.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const sub = this.label(t('ctl.sub'), 19, COLOR.muted);
    sub.anchor.set(0.5, 0);
    sub.position.set(DESIGN_WIDTH / 2, SUB_Y);
    this.root.addChild(sub);

    // 알림 버튼은 **내용이 있을 때만** 우상단에 뜬다(빈 알림 버튼은 누를 이유가 없다).
    const incoming = this.incoming;
    if (incoming === null || incoming.length === 0) return;
    const unseen = this.unseenCount > 0;
    const alerts = new PixiButton({
      texture: this.ui[unseen ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: unseen ? 0x9a7a2a : 0x4a3a24,
      width: ALERT_BTN_W,
      height: ALERT_BTN_H,
      fontSize: 21,
      ...(unseen ? { labelColor: COLOR.darkLabel } : {}),
      label: unseen ? t('ctl.btn.alerts', { n: this.unseenCount }) : t('ctl.notif.title'),
      onClick: () => this.openModal('alerts'),
    });
    alerts.container.position.set(DESIGN_WIDTH - MARGIN - ALERT_BTN_W, ALERT_BTN_Y);
    this.root.addChild(alerts.container);
  }

  /** 보드 — 대상 · 정찰 · (복수전). 복수 대상이 없으면 둘이 넓게 선다. */
  private renderBoard(y: number, h: number): void {
    const revenge = this.revengeTargets ?? [];
    const widths = revenge.length > 0
      ? [COLS_3.targets, COLS_3.recon, COLS_3.revenge]
      : [COLS_2.targets, COLS_2.recon];

    const xs: number[] = [];
    let cursor = MARGIN;
    for (const w of widths) {
      xs.push(cursor);
      cursor += w + GAP;
    }
    const at = (i: number): number => xs[i] ?? MARGIN;
    const wd = (i: number): number => widths[i] ?? 600;

    this.renderTargetsPanel(at(0), y, wd(0), h);
    this.renderReconPanel(at(1), y, wd(1), h);
    if (revenge.length > 0) this.renderRevengePanel(at(2), y, wd(2), h, revenge);
  }

  /** 패널 한 장(프레임 + 위치)을 만들어 부모에 붙이고 콘텐츠 상자를 돌려준다. */
  private addPanel(
    parent: Container,
    x: number,
    y: number,
    w: number,
    h: number,
  ): { panel: Container; box: PanelContentBox } {
    const panel = new Container();
    panel.position.set(x, y);
    parent.addChild(panel);
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
        const el = this.label(
          t('ctl.place.completeLine', { total: status.total, won: status.won }),
          21,
          COLOR.cream,
          '700',
        );
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
      const label = this.label(
        `${placementProgressLabel(status)}${t('ctl.place.remaining', { n: placementRemaining(status) })}`,
        21,
        COLOR.cream,
        '700',
      );
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
    const { panel, box } = this.addPanel(this.root, x, y, w, h);
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
    const bounds: number[] = [];
    for (let i = 1; i <= list.length; i++) bounds.push(i * step - TGT_ROW_GAP);
    const maskH = this.clampToRows(box.bottom - CONTENT_TOP, bounds);

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

    const rank = this.label(`#${target.rank}`, 24, COLOR.gold, '800');
    rank.anchor.set(0.5, 0.5);
    rank.position.set(38, TGT_ROW_H / 2);
    row.addChild(rank);

    const textX = 76;
    const textW = Math.max(60, w - TGT_BTN_W - 24 - textX);

    const name = this.label(
      placementMode ? placementTargetName(target) : target.displayName,
      21,
      COLOR.cream,
      '800',
      textW,
    );
    name.position.set(textX, 12);
    row.addChild(name);

    // 배치전이면 난이도 밴드 + 기체 요약, 일반이면 기체 요약.
    const desc = this.label(
      meta !== null
        ? t('ctl.tgt.difficulty', { band: meta.difficultyBand, ship: shipSummaryText(target.shipSummary) })
        : shipSummaryText(target.shipSummary),
      16,
      COLOR.muted,
      '400',
      textW,
    );
    desc.position.set(textX, 42);
    row.addChild(desc);

    const maint = this.label(maintenanceLabel(target.maintenance), 16, 0x8fd94c, '700', textW);
    maint.position.set(textX, 68);
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
    btn.container.on('pointertap', (e: FederatedPointerEvent) => e.stopPropagation());
    row.addChild(btn.container);
    if (!canInvade) btn.setEnabled(false);

    return row;
  }

  // --- 기지 정찰 -----------------------------------------------------------

  private renderReconPanel(x: number, y: number, w: number, h: number): void {
    const { panel, box } = this.addPanel(this.root, x, y, w, h);
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

    const sum = this.label(
      t('ctl.recon.summary', { t: layout.turrets.length, o: layout.obstacles.length }),
      17,
      COLOR.muted,
      '400',
      box.w,
    );
    sum.anchor.set(0.5, 0);
    sum.position.set(box.x + box.w / 2, Math.min(gridY + gridH + 16, box.bottom - 22));
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

  // --- 복수전 -------------------------------------------------------------

  /** 복수 대상 열(F1) — 24h 창이 살아 있는 대상이 있을 때만 보드에 낀다. */
  private renderRevengePanel(
    x: number,
    y: number,
    w: number,
    h: number,
    list: readonly RevengeTarget[],
  ): void {
    const { panel, box } = this.addPanel(this.root, x, y, w, h);
    this.panelTitle(panel, box, t('ctl.rev.head'), 0xffb0a0);

    const now = Date.now();
    const rows = list.map((target) => this.makeRevengeRow(target, now, box.w));
    const bounds: number[] = [];
    let total = 0;
    rows.forEach((r, i) => {
      total += r.h + (i > 0 ? REV_ROW_GAP : 0);
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
      () => this.revengeScrollY,
      (v) => {
        this.revengeScrollY = v;
      },
    );
    let cursor = 0;
    for (const r of rows) {
      r.node.position.set(0, cursor);
      content.addChild(r.node);
      cursor += r.h + REV_ROW_GAP;
    }
  }

  /**
   * 복수 대상 카드 1장(24h 창 · 쿨다운 무시 배지 · 복수 침공 버튼). 열이 좁아 버튼을 문구
   * 옆에 두면 문구가 눌려 읽을 수 없다 → 문구는 가로 폭 전체, 버튼은 그 아래 오른쪽.
   * 줄 수가 달라지므로 실제 높이를 재서 돌려준다.
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

    const nameMaxW = Math.max(40, w - 28 - badgeW - 12);
    const name = this.label(
      target.displayName.length > 0 ? target.displayName : t('ctl.anonymous'),
      20,
      COLOR.cream,
      '800',
      nameMaxW,
    );
    name.position.set(14, 10);

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
    const h = btnY + REV_BTN_H + 12;
    row.addChild(listRowBg(w, h, { accent: 0x8a4a4a }));
    row.addChild(name);
    row.addChild(badgeBox);
    row.addChild(rem);

    const canRevenge = !st.expired && st.layout !== null;
    const btn = new PixiButton({
      texture: this.ui[canRevenge ? 'ui_btn_red.png' : 'ui_btn_wood.png'],
      fallbackColor: canRevenge ? 0x8a3a3a : 0x4a3a24,
      width: REV_BTN_W,
      height: REV_BTN_H,
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
    btn.container.position.set(w - REV_BTN_W - 14, btnY);
    row.addChild(btn.container);
    if (!canRevenge) btn.setEnabled(false);

    return { node: row, h };
  }

  // --- 하단 버튼 행 --------------------------------------------------------

  private renderFooter(): void {
    const rowW = SIDE_BTN_W * 2 + BACK_W + FOOT_GAP * 2;
    const x0 = (DESIGN_WIDTH - rowW) / 2;

    const ladder = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: SIDE_BTN_W,
      height: FOOT_H,
      fontSize: 22,
      label: t('ctl.btn.ladder'),
      onClick: () => this.openModal('ladder'),
    });
    ladder.container.position.set(x0, FOOT_Y);
    this.root.addChild(ladder.container);

    const back = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: BACK_W,
      height: FOOT_H,
      fontSize: 22,
      label: t('common.backToBase'),
      onClick: () => this.back(),
    });
    back.container.position.set(x0 + SIDE_BTN_W + FOOT_GAP, FOOT_Y);
    this.root.addChild(back.container);

    const history = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: SIDE_BTN_W,
      height: FOOT_H,
      fontSize: 22,
      label: t('ctl.btn.history'),
      onClick: () => this.openModal('history'),
    });
    history.container.position.set(x0 + SIDE_BTN_W + BACK_W + FOOT_GAP * 2, FOOT_Y);
    this.root.addChild(history.container);
  }

  // --- 팝업 ---------------------------------------------------------------

  /** 팝업 껍데기(암막 + 패널 + 제목 + 닫기). 열려 있지 않으면 검색 입력을 걷어낸다. */
  private renderModal(): void {
    const kind = this.modal;
    if (kind === null) {
      this.search.unmount();
      return;
    }

    // 암막 — 뒤 보드로 포인터/휠이 새지 않게 막고, 바깥을 누르면 닫는다.
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: 0.78 });
    scrim.eventMode = 'static';
    scrim.on('pointertap', () => this.closeModal());
    this.root.addChild(scrim);

    const { panel, box } = this.addPanel(this.root, MODAL_X, MODAL_Y, MODAL_W, MODAL_H);
    // 팝업 안쪽 클릭이 암막으로 새어 나가 창이 닫히지 않도록 막는다.
    panel.eventMode = 'static';
    panel.on('pointertap', (e: FederatedPointerEvent) => e.stopPropagation());

    const titleKey =
      kind === 'ladder' ? 'ctl.ladder.title' : kind === 'alerts' ? 'ctl.notif.title' : 'ctl.hist.title';
    this.panelTitle(panel, box, t(titleKey));

    const close = makeIconButton(44, () => this.closeModal(), this.ui['ui_icon_close.png']);
    close.position.set(box.right - 44, box.y - 4);
    panel.addChild(close);

    if (kind === 'ladder') this.renderLadderModal(panel, box);
    else if (kind === 'alerts') this.renderAlertsModal(panel, box);
    else this.renderHistoryModal(panel, box);
  }

  /** 팝업 안 표 헤더 한 줄 + 밑줄. 열 정의는 상자 기준 상대 좌표. */
  private tableHeader(
    panel: Container,
    box: PanelContentBox,
    y: number,
    cols: readonly { label: string; x: number; anchor: 0 | 1 }[],
  ): void {
    for (const col of cols) {
      const el = this.label(col.label, 16, COLOR.muted, '700');
      el.anchor.set(col.anchor, 0);
      el.position.set(box.x + col.x, y);
      panel.addChild(el);
    }
    const rule = new Graphics();
    rule.rect(box.x, y + 28, box.w, 2).fill({ color: 0x5a4630, alpha: 0.8 });
    panel.addChild(rule);
  }

  /** 페이지 이동 줄([이전] N/M 쪽 [다음]) — 상자 바닥에 붙인다. */
  private pager(
    panel: Container,
    box: PanelContentBox,
    page: number,
    pageCount: number,
    onPage: (next: number) => void,
  ): void {
    const y = box.bottom - PAGER_H;
    const btnW = 130;
    const btnH = 48;
    const prev = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: btnW,
      height: btnH,
      fontSize: 19,
      label: t('ctl.pop.prev'),
      onClick: () => onPage(page - 1),
    });
    prev.container.position.set(box.x + box.w / 2 - 160 - btnW, y);
    panel.addChild(prev.container);
    if (page <= 0) prev.setEnabled(false);

    const label = this.label(
      t('ctl.pop.page', { cur: page + 1, total: Math.max(1, pageCount) }),
      20,
      COLOR.cream,
      '700',
    );
    label.anchor.set(0.5, 0.5);
    label.position.set(box.x + box.w / 2, y + btnH / 2);
    panel.addChild(label);

    const next = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: btnW,
      height: btnH,
      fontSize: 19,
      label: t('ctl.pop.next'),
      onClick: () => onPage(page + 1),
    });
    next.container.position.set(box.x + box.w / 2 + 160, y);
    panel.addChild(next.container);
    if (page >= pageCount - 1) next.setEnabled(false);
  }

  // --- 순위표 팝업 ---------------------------------------------------------

  private renderLadderModal(panel: Container, box: PanelContentBox): void {
    // 내 순위 — 목록 어디에 있든 항상 맨 위에 따로 보여 준다(찾아 헤매지 않게).
    const mine = this.myRank;
    const mineBg = new Graphics();
    mineBg.roundRect(box.x, MODAL_TOOL_Y, box.w - SEARCH_W - 24, 56, 10)
      .fill({ color: 0x2a2238, alpha: 0.95 })
      .stroke({ color: COLOR.gold, width: 2, alignment: 1 });
    panel.addChild(mineBg);
    const mineText = this.label(
      mine !== null
        ? t('ctl.ladder.meRank', {
            n: mine.rank,
            w: mine.wins,
            l: mine.losses,
            p: winRate(mine.wins, mine.losses),
          })
        : this.ladderLoading
          ? t('ctl.pop.loading')
          : t('ctl.ladder.meUnranked'),
      20,
      mine !== null ? COLOR.gold : COLOR.muted,
      '700',
      box.w - SEARCH_W - 60,
    );
    mineText.anchor.set(0, 0.5);
    mineText.position.set(box.x + 16, MODAL_TOOL_Y + 28);
    panel.addChild(mineText);

    // 검색 입력(DOM 오버레이) — 팝업 좌표를 화면 좌표로 환산해 얹는다.
    this.search.mount(
      this.stage,
      'ladder',
      {
        x: MODAL_X + box.right - SEARCH_W,
        y: MODAL_Y + MODAL_TOOL_Y + 4,
        w: SEARCH_W,
        h: SEARCH_H,
      },
      t('ctl.pop.search'),
      this.ladderQuery,
      (v) => {
        this.ladderQuery = v;
        this.ladderPage = 0;
        this.render();
      },
    );

    const listTop = MODAL_TOOL_Y + 84;
    if (this.ladderLoading) {
      this.msg(panel, box, t('ctl.pop.loading'), listTop + 40);
      return;
    }
    const all = this.ladderAll;
    if (all === null) {
      this.msg(panel, box, t('ctl.ladder.null'), listTop + 40);
      return;
    }
    if (all.length === 0) {
      this.msg(panel, box, t('ctl.ladder.empty'), listTop + 40);
      return;
    }

    const query = this.ladderQuery.trim().toLowerCase();
    const rows = query.length === 0
      ? all
      : all.filter((e) => this.ladderName(e).toLowerCase().includes(query));
    if (rows.length === 0) {
      this.msg(panel, box, t('ctl.pop.noMatch'), listTop + 40);
      return;
    }

    const nameX = 130;
    const recX = Math.round(box.w * 0.66);
    const rateX = box.w;
    this.tableHeader(panel, box, listTop, [
      { label: t('ctl.ladder.rank'), x: 0, anchor: 0 },
      { label: t('ctl.ladder.name'), x: nameX, anchor: 0 },
      { label: t('ctl.ladder.games'), x: recX, anchor: 1 },
      { label: t('ctl.ladder.winRate'), x: rateX, anchor: 1 },
    ]);

    const pageCount = Math.max(1, Math.ceil(rows.length / LADDER_PAGE));
    const page = Math.min(this.ladderPage, pageCount - 1);
    const start = page * LADDER_PAGE;
    const slice = rows.slice(start, start + LADDER_PAGE);
    const rowTop = listTop + 40;
    const myId = this.myRank?.profileId ?? null;

    slice.forEach((e, i) => {
      const y = rowTop + i * LADDER_ROW_H;
      const isMe = myId !== null && e.profileId === myId;
      const bgRow = new Graphics();
      bgRow
        .roundRect(box.x, y, box.w, LADDER_ROW_H - 4, 8)
        .fill({ color: isMe ? 0x3a3020 : 0xffffff, alpha: isMe ? 0.9 : i % 2 === 1 ? 0.035 : 0.012 });
      if (isMe) bgRow.roundRect(box.x, y, box.w, LADDER_ROW_H - 4, 8).stroke({ color: COLOR.gold, width: 2, alignment: 1 });
      panel.addChild(bgRow);

      const rank = this.label(`#${e.rank}`, 19, COLOR.gold, '800');
      rank.position.set(box.x + 10, y + 9);
      panel.addChild(rank);

      const nameLabel = isMe ? `${this.ladderName(e)} (${t('ctl.ladder.me')})` : this.ladderName(e);
      const name = this.label(nameLabel, 18, isMe ? COLOR.gold : COLOR.cream, isMe ? '800' : '400', recX - nameX - 24);
      name.position.set(box.x + nameX, y + 10);
      panel.addChild(name);

      const rec = this.label(t('ctl.ladder.wl', { w: e.wins, l: e.losses }), 18, COLOR.muted);
      rec.anchor.set(1, 0);
      rec.position.set(box.x + recX, y + 10);
      panel.addChild(rec);

      const rate = this.label(`${winRate(e.wins, e.losses)}%`, 18, COLOR.cream, '700');
      rate.anchor.set(1, 0);
      rate.position.set(box.x + rateX, y + 10);
      panel.addChild(rate);
    });

    // 상한 안내는 페이지 이동 줄 왼쪽에 얹는다 — 표와 줄 사이에 따로 한 줄을 쓰면 마지막
    // 행이 밀려 페이저와 겹친다(실화면에서 잡힌 결함).
    const cap = this.label(t('ctl.ladder.cap', { n: LADDER_CAP }), 15, COLOR.muted);
    cap.anchor.set(0, 0.5);
    cap.position.set(box.x, box.bottom - PAGER_H / 2);
    panel.addChild(cap);

    this.pager(panel, box, page, pageCount, (nextPage) => {
      this.ladderPage = Math.max(0, Math.min(pageCount - 1, nextPage));
      this.render();
    });
  }

  /** 순위표 한 행의 표시명(서버가 이름을 안 주면 id 앞자리 — DOM 판과 동일 폴백). */
  private ladderName(e: LadderEntry): string {
    if (e.displayName !== undefined && e.displayName.length > 0) return e.displayName;
    const known = this.names.get(e.profileId);
    if (known !== undefined) return known;
    return `${e.profileId.slice(0, 6)}…`;
  }

  // --- 알림 팝업 -----------------------------------------------------------

  private renderAlertsModal(panel: Container, box: PanelContentBox): void {
    const incoming = this.incoming ?? [];
    const banner = incomingBannerText(this.unseenCount);
    if (banner.length > 0) {
      const el = this.label(banner, 20, COLOR.gold, '700', box.w);
      el.position.set(box.x, MODAL_TOOL_Y);
      panel.addChild(el);
    }
    const listTop = banner.length > 0 ? MODAL_TOOL_Y + 44 : MODAL_TOOL_Y;

    if (incoming.length === 0) {
      this.msg(panel, box, t('ctl.notif.empty'), listTop + 40);
      return;
    }

    const now = Date.now();
    const rows = incoming.map((inv) => this.makeAlertRow(inv, now, box.w));
    const bounds: number[] = [];
    let total = 0;
    rows.forEach((r, i) => {
      total += r.h + (i > 0 ? REV_ROW_GAP : 0);
      bounds.push(total);
    });
    const maskH = this.clampToRows(box.bottom - listTop, bounds);

    const content = this.scrollArea(
      panel,
      box.x,
      listTop,
      box.w,
      maskH,
      total,
      () => this.alertScrollY,
      (v) => {
        this.alertScrollY = v;
      },
    );
    let cursor = 0;
    for (const r of rows) {
      r.node.position.set(0, cursor);
      content.addChild(r.node);
      cursor += r.h + REV_ROW_GAP;
    }
  }

  /**
   * 도발 스티커 아이콘 Sprite(정사각 `size`). 인덱스가 손상/미설정이거나 자산이 아직 없으면
   * null 을 돌려주고, 호출자는 스티커 **문구만** 남긴다(자산 하나가 빠져도 화면은 죽지 않는다).
   */
  private stickerIcon(index: unknown, size: number): Sprite | null {
    const name = stickerIconName(index);
    if (name === null) return null;
    const tex = this.ui[name];
    if (!tex) return null;
    const sp = new Sprite(tex);
    sp.width = size;
    sp.height = size;
    return sp;
  }

  /** 알림 1행 — 결과 문구 + 시각/도발 상세 + 도발·관전 버튼. */
  private makeAlertRow(inv: IncomingInvasion, now: number, w: number): { node: Container; h: number } {
    const row = new Container();
    const btnW = 120;
    const btnH = 46;

    const buttons: PixiButton[] = [];
    // 방어 성공(격퇴)했고 아직 회신 도발이 없으면 "도발" 버튼(F2 방어자 몫).
    if (inv.invasionId.length > 0 && !inv.attackerWon && inv.defenderSticker === null) {
      buttons.push(
        new PixiButton({
          texture: this.ui['ui_btn_wood.png'],
          fallbackColor: 0x4a3a24,
          width: btnW,
          height: btnH,
          fontSize: 18,
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
          width: btnW,
          height: btnH,
          fontSize: 18,
          label: t('ctl.notif.spectate'),
          onClick: () => this.onSpectate?.(inv.invasionId, inv.attackerName),
        }),
      );
    }
    const btnArea = buttons.length > 0 ? buttons.length * btnW + (buttons.length - 1) * 10 + 28 : 14;
    const textW = Math.max(120, w - 14 - btnArea);

    // 스티커 라벨의 컬러 이모지는 캔버스에서 두부로 떨어져 stripEmoji 가 걷어낸다 — 그 자리를
    // 아이콘 텍스처가 대신한다. 자산이 아직 없으면 아이콘만 빠지고 **문구는 그대로 남는다**(폴백).
    const headIcon = this.stickerIcon(inv.sticker, ALERT_ICON_H);
    const headX = 14 + (headIcon !== null ? ALERT_ICON_H + 8 : 0);
    const head = this.label(
      stripEmoji(incomingRowText(inv)),
      19,
      inv.attackerWon ? 0xffb0a0 : 0xa8dda8,
      '700',
      Math.max(60, textW - (headX - 14)),
    );
    head.position.set(headX, 12);
    headIcon?.position.set(14, 11);

    // 상대 도발은 `incomingRowText` 가 이미 첫 줄에 붙여 준다 — 여기서 또 적으면 같은 문장이
    // 두 번 나온다. 상세 줄에는 첫 줄에 없는 것(시각·내 회신 도발)만 담는다.
    const details: string[] = [t('ctl.notif.when', { when: relTime(inv.createdAtMs, now) })];
    const mine = stickerLabel(inv.defenderSticker);
    if (mine.length > 0) details.push(t('ctl.notif.mine', { taunt: mine }));
    const subIcon = mine.length > 0 ? this.stickerIcon(inv.defenderSticker, ALERT_ICON_SUB) : null;
    const subX = 14 + (subIcon !== null ? ALERT_ICON_SUB + 6 : 0);
    const sub = new Text({
      resolution: 2,
      text: stripEmoji(details.join(' · ')),
      style: {
        fontFamily: UI_FONT,
        fontSize: 16,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: Math.max(60, textW - (subX - 14)),
        dropShadow: TEXT_SHADOW,
      },
    });
    sub.position.set(subX, 42);
    subIcon?.position.set(14, 43);

    const h = Math.max(96, 42 + Math.ceil(sub.height) + 20);
    row.addChild(listRowBg(w, h, { accent: inv.attackerWon ? 0x8a4a4a : 0x4a7a4a }));
    if (headIcon !== null) row.addChild(headIcon);
    if (subIcon !== null) row.addChild(subIcon);
    row.addChild(head);
    row.addChild(sub);
    buttons.forEach((b, i) => {
      b.container.position.set(
        w - 14 - (buttons.length - i) * btnW - (buttons.length - 1 - i) * 10,
        (h - btnH) / 2,
      );
      row.addChild(b.container);
    });
    return { node: row, h };
  }

  // --- 전투 기록 팝업 ------------------------------------------------------

  private renderHistoryModal(panel: Container, box: PanelContentBox): void {
    // 필터(전체·공격·방어) + 정렬 토글 — 한 줄에 나란히.
    const chipW = 118;
    const chipH = 46;
    const chipGap = 10;
    const filters: readonly [HistoryFilter, string][] = [
      ['all', t('ctl.hist.filter.all')],
      ['attack', t('ctl.hist.filter.attack')],
      ['defense', t('ctl.hist.filter.defense')],
    ];
    filters.forEach(([kind, label], i) => {
      const selected = this.historyFilter === kind;
      const btn = new PixiButton({
        texture: this.ui[selected ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
        fallbackColor: selected ? 0x9a7a2a : 0x4a3a24,
        width: chipW,
        height: chipH,
        fontSize: 18,
        ...(selected ? { labelColor: COLOR.darkLabel } : {}),
        label,
        onClick: () => {
          this.historyFilter = kind;
          this.historyPage = 0;
          this.render();
        },
      });
      btn.container.position.set(box.x + i * (chipW + chipGap), MODAL_TOOL_Y + 2);
      panel.addChild(btn.container);
    });

    const sortW = 150;
    const sort = new PixiButton({
      texture: this.ui['ui_btn_wood.png'],
      fallbackColor: 0x4a3a24,
      width: sortW,
      height: chipH,
      fontSize: 17,
      label: this.historyNewestFirst ? t('ctl.hist.sort.newest') : t('ctl.hist.sort.oldest'),
      onClick: () => {
        this.historyNewestFirst = !this.historyNewestFirst;
        this.historyPage = 0;
        this.render();
      },
    });
    sort.container.position.set(box.x + 3 * (chipW + chipGap) + 14, MODAL_TOOL_Y + 2);
    panel.addChild(sort.container);

    this.search.mount(
      this.stage,
      'history',
      { x: MODAL_X + box.right - SEARCH_W, y: MODAL_Y + MODAL_TOOL_Y + 2, w: SEARCH_W, h: SEARCH_H },
      t('ctl.pop.search'),
      this.historyQuery,
      (v) => {
        this.historyQuery = v;
        this.historyPage = 0;
        this.render();
      },
    );

    const listTop = MODAL_TOOL_Y + 100;
    if (this.historyLoading) {
      this.msg(panel, box, t('ctl.hist.loading'), listTop + 40);
      return;
    }
    const all = this.history;
    if (all === null) {
      this.msg(panel, box, t('ctl.hist.null'), listTop + 40);
      return;
    }
    if (all.length === 0) {
      this.msg(panel, box, t('ctl.hist.empty'), listTop + 40);
      return;
    }

    // 요약은 **필터 전 전체**를 센다(지금 보고 있는 조각이 아니라 내 전적이다).
    let wins = 0;
    let losses = 0;
    let attacks = 0;
    for (const e of all) {
      if (e.attacking) attacks++;
      const won = historyIWon(e);
      if (won === true) wins++;
      else if (won === false) losses++;
    }
    const summary = this.label(
      t('ctl.hist.summary', { n: all.length, w: wins, l: losses, a: attacks, d: all.length - attacks }),
      17,
      COLOR.muted,
      '700',
      box.w,
    );
    summary.position.set(box.x, MODAL_TOOL_Y + 60);
    panel.addChild(summary);

    const query = this.historyQuery.trim().toLowerCase();
    const rows = all
      .filter((e) => (this.historyFilter === 'all' ? true : this.historyFilter === 'attack' ? e.attacking : !e.attacking))
      .filter((e) => (query.length === 0 ? true : this.nameOf(e.opponentId).toLowerCase().includes(query)))
      .slice()
      .sort((a, b) => (this.historyNewestFirst ? b.atMs - a.atMs : a.atMs - b.atMs));
    if (rows.length === 0) {
      this.msg(panel, box, t('ctl.pop.noMatch'), listTop + 40);
      return;
    }

    const sideX = 170;
    const oppX = 290;
    const resX = Math.round(box.w * 0.6);
    const statX = Math.round(box.w * 0.72);
    const specW = 110;
    const specH = 36;
    this.tableHeader(panel, box, listTop, [
      { label: t('ctl.hist.col.when'), x: 0, anchor: 0 },
      { label: t('ctl.hist.col.side'), x: sideX, anchor: 0 },
      { label: t('ctl.hist.col.opponent'), x: oppX, anchor: 0 },
      { label: t('ctl.hist.col.result'), x: resX, anchor: 0 },
      { label: t('ctl.hist.col.status'), x: statX, anchor: 0 },
    ]);

    const pageCount = Math.max(1, Math.ceil(rows.length / HIST_PAGE));
    const page = Math.min(this.historyPage, pageCount - 1);
    const slice = rows.slice(page * HIST_PAGE, page * HIST_PAGE + HIST_PAGE);
    const rowTop = listTop + 40;
    const now = Date.now();

    slice.forEach((e, i) => {
      const y = rowTop + i * HIST_ROW_H;
      if (i % 2 === 1) {
        const stripe = new Graphics();
        stripe.roundRect(box.x, y, box.w, HIST_ROW_H - 4, 8).fill({ color: 0xffffff, alpha: 0.035 });
        panel.addChild(stripe);
      }

      const when = this.label(relTime(e.atMs, now), 17, COLOR.muted);
      when.position.set(box.x + 10, y + 11);
      panel.addChild(when);

      const side = this.label(
        e.attacking ? t('ctl.hist.side.attack') : t('ctl.hist.side.defense'),
        17,
        e.attacking ? 0xffc98a : 0x9fd0ff,
        '700',
      );
      side.position.set(box.x + sideX, y + 11);
      panel.addChild(side);

      const opp = this.label(this.nameOf(e.opponentId), 18, COLOR.cream, '400', resX - oppX - 24);
      opp.position.set(box.x + oppX, y + 10);
      panel.addChild(opp);

      const won = historyIWon(e);
      const resultText =
        won === null ? t('ctl.hist.result.pending') : won ? t('ctl.hist.result.win') : t('ctl.hist.result.lose');
      const result = this.label(
        resultText,
        18,
        won === null ? COLOR.muted : won ? COLOR.gold : 0xffb0a0,
        '800',
      );
      result.position.set(box.x + resX, y + 10);
      panel.addChild(result);

      const statusText =
        e.status === 'verified'
          ? t('ctl.hist.status.verified')
          : e.status === 'rejected'
            ? t('ctl.hist.status.rejected')
            : t('ctl.hist.status.pending');
      const status = this.label(statusText, 16, e.status === 'rejected' ? 0xffb0a0 : COLOR.muted);
      status.position.set(box.x + statX, y + 11);
      panel.addChild(status);

      // 리플레이는 공격·방어 양쪽 참가자가 읽을 수 있다(RLS) — 어느 행이든 다시 볼 수 있다.
      if (e.invasionId.length > 0) {
        const spec = new PixiButton({
          texture: this.ui['ui_btn_blue.png'],
          fallbackColor: 0x3a4a7a,
          width: specW,
          height: specH,
          fontSize: 16,
          label: t('ctl.notif.spectate'),
          onClick: () => this.onSpectate?.(e.invasionId, this.nameOf(e.opponentId)),
        });
        spec.container.position.set(box.right - specW, y + (HIST_ROW_H - 4 - specH) / 2);
        panel.addChild(spec.container);
      }
    });

    this.pager(panel, box, page, pageCount, (nextPage) => {
      this.historyPage = Math.max(0, Math.min(pageCount - 1, nextPage));
      this.render();
    });
  }
}
