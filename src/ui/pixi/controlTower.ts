/**
 * 관제탑 — 침공 사령 화면 (ADR-0014 Pixi 이관 · 2026-08-03 AAA 시네마틱 전환)
 * · 레인 계약 `.omc/plans/control-tower-aaa-2026-08-03.md`.
 *
 * `src/ui/controlTower.ts` 의 **순수 모델**(뷰 문구·침공 가능 판정·정찰 뷰)을 그대로 쓰고
 * 이 파일은 그리기만 한다. 공개 인터페이스(`show`/`hide`/`visible`)와 콜백·옵션 타입은
 * `main.ts` 계약이라 한 줄도 바꾸지 않았다. **suspend/resume 은 없다**(방어 사령부와 다른 점).
 *
 * ---------------------------------------------------------------------------
 * ## 시네마틱 전환에서 바뀐 것은 **바탕과 배치**뿐이다
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재), `makeBanner` → `makeHangarTitle`,
 * `ui_btn_*.png` → `cinematicButtonTexture` 주입, 나무 행 바탕 → 석재 행 판(`rowPlate`),
 * 나무 팝업 → 이 파일의 시네마틱 팝업, 단색 배경 → `HangarBackdrop`.
 * 서버 왕복·침공 진입·소집·알림 확인 시각 갱신 계약은 건드리지 않았다.
 *
 * ## 왜 여기는 **창을 뚫지 않는가**(방어 사령부·챔피언 선택은 뚫었다)
 * 형제 화면 일곱의 결론은 "창은 배경이 보이는 구멍이 아니라 **무언가를 보여주는 자리**"였다.
 * 여기서 "행을 바꾸면 바뀌는 피사체" 후보는 기지 정찰뿐인데, 정찰은 설계상 **정확 스펙을 내지
 * 않는 것이 계약**이다(`reconView` — 실루엣 칩·등급 색·승급 별만, 종류 이름은 1회 침공한
 * 상대만 열린다). 여기에 실제 정지 렌더를 세우면 **감추기로 한 정보를 그림으로 통째로
 * 흘린다** — 미관을 위해 기능 계약을 깨는 것이라 금지다. 남는 후보는 확대된 UI 칩뿐이고
 * 칩 조건은 창을 뚫지 않는다. 그래서 패널 셋 전부 `slab`, 배경 `windows: []`.
 *
 * ## **열을 고정한다** — 상태에 따라 열이 비는 것이 이 화면의 최대 위험이었다
 * 옛 구현은 복수 대상 유무로 **2열/3열이 갈렸고**(`COLS_2`/`COLS_3`), 결과판 유무로 상단 상태
 * 패널이 통째로 났다 사라졌다(보드가 위로 올라옴). 같은 화면이 상태에 따라 네 가지 기하를
 * 가진 셈이고, 재렌더 규율상 그때마다 배경과 석재 패널을 다시 **구워야** 한다.
 * 그래서 **3열 고정**이다: 침공 대상 640 · 기지 정찰 700 · 작전 상황 460.
 * 옛 "상단 상태 패널"과 옛 "복수 열"은 둘 다 조건부이고 둘 다 세로로 짧아 **작전 상황 한 열로
 * 합쳤다** — 합치면 조건부 기하가 사라진다.
 * ⚠️ 대상 패널 제목은 배치전/일반에서 갈리지 않는다. 각인 제목은 패널 텍스처에 **구워지므로**
 * 상태에 따라 바뀌면 로드 완료 시 패널을 다시 구워야 한다. 배치전이라는 사실은 작전 상황
 * 열의 배치전 블록이 이미 말한다(방어 사령부가 제목 하나로 세 레이어를 덮은 것과 같은 처방).
 *
 * ## 빈 자리를 남기지 않는다 — 여기는 **비어 있는 상태가 정상**이다
 * 오프라인·미로그인이면 목록 셋이 전부 null 이다. 그것이 "쉬고 있는 상태"이지 결함이 아니므로
 * 그 상태에도 처방이 적용돼야 한다. 짧으면 `fillRowHeights` 로 행이 남는 세로를 나눠 갖고,
 * 그래도 남으면 **파낸 챔버**(`tailWell`)로 그 자리에 이름을 준다. 아예 비었으면 상자 전체를
 * 챔버(`emptyWell`)로 그리고 그 안에서 안내한다. 작전 상황 열은 맨 위 **내 전황 블록**이
 * 상시 들어가 원리적으로 비지 않는다(그래서 `fetchMyLadderRank` 를 진입 로드로 끌어올렸다 —
 * 단건 RPC 라 가볍다. 200행 순위표 전체는 팝업이 열릴 때 그대로 늦게 받는다).
 * 하단 [기지로 돌아가기]는 헤더 ✕ 와 **같은 함수**를 불러 지웠다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거)
 * - ⚠️ **크롬(헤더·하단 띠)은 패널보다 뒤에 붙인다.** Pixi v8 은 자식을 역순으로 훑다가 픽셀에
 *   걸리면 거기서 멈추고 가장 가까운 상호작용 조상을 반환한다 — 그림자 스프라이트가 passive
 *   여도 탐색은 끝난다. 석재 패널은 접지 그림자·글로우를 텍스처에 구워 자기 사각보다 30px
 *   가까이 번지므로, 먼저 붙은 크롬은 그 번짐에 클릭을 빼앗긴다(방어 사령부 실제 신고).
 *   여백으로는 못 푼다 — 번짐 폭이 패널 치수에서 파생돼 조용히 커진다.
 * - ⚠️ **`setEnabled(false)` + `gold` 톤 금지.** alpha 0.4 + 어두운 갈색 라벨 + 그림자 꺼짐이
 *   겹쳐 글자가 통째로 사라진다(실화면에서 확인). 비활성은 크림 라벨인 `stone`.
 * - ⚠️ 흐림은 `PixiButton` container 가 아니라 감싸는 host 에 건다(`pointerout` 이 alpha 를 1로
 *   되돌린다).
 * - **행 클릭은 행 Container 에.** 바탕 Graphics 에 걸면 위에 얹힌 텍스트가 클릭을 삼킨다.
 * - **휠은 클립 Container 에.** 마스크 Graphics 는 히트 테스트에서 제외된다.
 * - 컬러 이모지 금지(`text.ts` stripEmoji 가 두부로 떨군다). `★ ✕ ▶ ◀` 는 보존 목록.
 * - ⚠️ `hudEl()` 에는 **캔버스 가드를 붙이지 않는다**(HUD 숨김이 통째로 죽는다).
 * - ⚠️ 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드**다. 그래서 패널 줄이 헤더(104)가 아니라
 *   {@link GEAR_BAND_H}(120) 아래에서 시작한다 — 첫 패널이 x 32 라 가로로 겹친다.
 * - ⚠️ 각인 제목은 중앙 정렬 Text 라 사각형이 없어 겹침 테스트가 못 잡는다 —
 *   {@link TITLE_BAND_HALF_W} 로 대역을 못 박는다(연구소에서 제목이 실제로 겹쳤다).
 * - ⚠️ 검색 `<input>` 은 **재생성하면 포커스와 한글 IME 조합이 끊긴다** — key 가 같으면 재사용.
 *
 * ## 재렌더 규율
 * 옛 구현은 `render()` 가 루트를 통째로 지우고 다시 그렸다 — 행 선택 한 번, 검색 한 글자마다
 * 배경과 석재 패널 셋이 다시 **구워진다**. 그래서
 *  - `buildChrome()` 은 1회(자산 도착 시에만 재건),
 *  - `syncValues()` 가 하단 상태 문구와 알림 버튼 톤을(미확인 수가 **바뀔 때만** 재조립),
 *  - `renderTargets()`/`renderRecon()`/`renderOps()`/`renderModal()` 이 각자 host 안만 간다.
 *  - `update(dt)` 는 `main.ts` 가 매 프레임 부른다(`controlTower.update(frame)`). 숨겨져 있으면
 *    즉시 반환하므로 이 화면 밖 비용은 0 이다. ⚠️ 연구소가 이 배선을 빠뜨려 배경·패널 연출이
 *    통째로 멈춘 적이 있다.
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { activeShip } from '../../save/profile.js';
import type { Profile, GuardianRecord } from '../../save/profile.js';
import { activeGuardians } from '../../save/guardianLifecycle.js';
import type { InvasionLayers } from '../../sim/invasion/types.js';
import { shipTypeDef } from '../../../data/ships/index.js';
import { shipTypeName } from './shipLabels.js';
import { t } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { stickerLabel } from '../../../data/stickers.js';
import { seedBaseByProfileId } from '../../../data/seedBases.js';
import { moduleRarityColor, moduleRarityLabel, moduleAffixOneLine } from '../modulesView.js';
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
  reconView,
  reconRarityColor,
  reconSlotLabel,
  normalizeTargetLayers,
  type ReconStrip,
  type ControlTowerCallbacks,
  type ControlTowerShowOpts,
  type InvasionResultView,
} from '../controlTower.js';
import { COLOR, UI_FONT, TEXT_SHADOW, hexColor } from './theme.js';
import { loadUiTextures, stickerIconName, type UiTextures } from './uiTextures.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';
import { makeScrollArea, rowBounds, clampToRows } from './scrollArea.js';
import { attachRowClick, stopRowPropagation } from './listRow.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import {
  makeHangarTitle,
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';

export type { ControlTowerCallbacks, ControlTowerShowOpts, InvasionResultView };

/** 열려 있는 팝업 종류(없으면 null). `sortie` = 출격 기체 선택(ADR-0024 예비역 소집). */
type ModalKind = 'ladder' | 'alerts' | 'history' | 'sortie';

/** 전투 기록 필터(공/수). */
type HistoryFilter = 'all' | 'attack' | 'defense';

// ===========================================================================
// 레이아웃(디자인 스페이스 1920×1080) — Pixi 없이 검증되는 순수 서술
//
// 여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 격납고·촉매 보관함·예비역 로스터·
// 챔피언 선택·연구소·정제소·방어 사령부와 **같은 값**이다. 형제끼리 다르면 전환에서 튄다.
// ===========================================================================

/**
 * `cinematicPanel.ts` 콘텐츠 상자 기하의 **복제본**(출처: 그 파일의 `EDGE_PAD 24` ·
 * `CONTENT_GAP 16` · `TITLE_BAND_H = round(TITLE_SIZE 26 × 2)`).
 *
 * 왜 베끼는가: 좌표 서술이 **Pixi 없이** 검증돼야 하는데 패널 상자는 런타임 객체다. 베낀 값이
 * 조용히 어긋나면 내용이 패널 테두리를 뚫는데 예외도 로그도 없다 —
 * `tests/controlTowerAaaLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조한다.
 */
export const PANEL_EDGE_PAD = 24;
export const PANEL_TITLE_BAND_H = 52;
export const PANEL_CONTENT_GAP = 16;
/** 제목 띠가 있는 패널의 콘텐츠 상자 로컬 y. */
const TITLED_BOX_Y = PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP;

/** 헤더 밴드 높이 — 배경이 그대로 보이는 자리. 각인 석재 인방은 얹지 않는다(사용자 확정). */
const HEADER_H = 104;
/** 헤더 컨트롤의 세로 띠 — 전부 이 하나를 쓴다(격납고 헤더 겹침 결함 이력). */
const HEAD_Y = 26;
const HEAD_H = 52;
const EDGE_X = 32;
const GUTTER_X = 28;
const BOTTOM_PAD = 28;

/**
 * 좌상단 예약 밴드 — `main.ts` SettingsScreen 의 설정 톱니가 쓰는 **전 화면 공용 자리**다.
 * 톱니는 매 프레임 stage 최상위로 올라오므로 여기에 컨트롤을 두면 통째로 클릭 불가가 된다.
 * ⚠️ {@link PANEL_Y} 가 이 값에서 파생되므로 **선언 순서를 바꾸지 마라**(TDZ).
 */
export const GEAR_BAND_W = 120;
export const GEAR_BAND_H = 120;

const CONTENT_W = DESIGN_WIDTH - EDGE_X * 2;

/** 하단 액션 띠 — 오른쪽에 버튼 셋, 왼쪽 절반은 상태 문구가 쓴다(빈 자리 0). */
const FOOT_H = 64;
const FOOT_Y = DESIGN_HEIGHT - BOTTOM_PAD - FOOT_H;
const FOOT_GAP = 16;
const LADDER_BTN_W = 240;
const HIST_BTN_W = 240;
const ALERT_BTN_W = 260;
const FOOT_BTN_W = LADDER_BTN_W + HIST_BTN_W + ALERT_BTN_W + FOOT_GAP * 2;
const FOOT_BTN_X = EDGE_X + CONTENT_W - FOOT_BTN_W;

/**
 * 패널 줄 상단. 헤더 밴드(104) 바로 아래가 아니라 **{@link GEAR_BAND_H}(120) 아래**다 —
 * 첫 패널이 화면 좌측 끝(x 32)에서 시작하므로 설정 톱니 예약 밴드와 가로로 겹치고, 세로로
 * 몇 px 만 물려도 톱니가 매 프레임 맨 앞으로 올라와 그 자리를 통째로 삼킨다(테스트가 잠근다).
 */
const PANEL_Y = GEAR_BAND_H + 4;
const PANEL_TO_FOOT = 16;
/** 패널 세로는 **남는 자리 전부**다(빈 자리 금지 — 하드코딩하면 여백을 바꿀 때 어긋난다). */
const PANEL_H = FOOT_Y - PANEL_TO_FOOT - PANEL_Y;

const TGT_X = EDGE_X;
const TGT_W = 640;
const RECON_X = TGT_X + TGT_W + GUTTER_X;
const RECON_W = 700;
const OPS_X = RECON_X + RECON_W + GUTTER_X;
const OPS_W = DESIGN_WIDTH - EDGE_X - OPS_X;

/** 제목 띠가 있는 패널의 콘텐츠 상자(패널 로컬) — 위 복제 기하에서 파생. */
function titledBox(
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number; right: number; bottom: number } {
  return {
    x: PANEL_EDGE_PAD,
    y: TITLED_BOX_Y,
    w: w - PANEL_EDGE_PAD * 2,
    h: h - TITLED_BOX_Y - PANEL_EDGE_PAD,
    right: w - PANEL_EDGE_PAD,
    bottom: h - PANEL_EDGE_PAD,
  };
}

const BOX_T = titledBox(TGT_W, PANEL_H);
const BOX_R = titledBox(RECON_W, PANEL_H);
const BOX_O = titledBox(OPS_W, PANEL_H);

// --- 헤더 컨트롤(형제 화면과 **같은 x**) ---
const CLOSE_W = 56;
const CLOSE_X = DESIGN_WIDTH - EDGE_X - CLOSE_W;

/**
 * 각인 제목이 실제로 차지하는 가로 반폭. 중앙 정렬 Text 는 사각형이 없어 겹침 테스트가 못
 * 잡는다 — 연구소 실화면에서 제목이 헤더 버튼과 **실제로 겹쳤다**. 대역을 상수로 못 박고
 * 좌우 컨트롤이 이 안에 들어오지 못하게 테스트로 잠근다.
 */
export const TITLE_BAND_HALF_W = 280;

/** 석재 슬래브 위 **보조 텍스트색**(정제소 `SLAB_BODY_FILL` 복제 — 그 파일은 화면이다). */
const SLAB_BODY_FILL = 0xe4dac7;
/** 행 판 바탕색·홈·반경 — 예비역 로스터 `rowPlate` → … → 방어 사령부 경유 복제. */
const ROW_FACE = 0x3b3327;
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;
/** 패배·거부처럼 나쁜 소식을 말하는 살구색(구 구현 승계). */
const BAD_COLOR = 0xffb0a0;
/** 정비도·방어 성공처럼 좋은 소식을 말하는 연두(구 구현 승계). */
const GOOD_COLOR = 0x8fd94c;

/**
 * 팝업 암막 알파. **뒤 화면 밝기에 따라 다르다** — 예비역 로스터 0.92 · 챔피언 선택 0.96 ·
 * 연구소 0.98 · 방어 사령부 0.99. 여기는 밝은 슬래브 **셋**이 화면을 거의 다 덮는다.
 * 실측으로 정하는 값이니 눈대중으로 낮추지 마라.
 */
const SCRIM_ALPHA = 0.98;

// --- 목록 행 기하 ---
const ROW_GAP = 10;
const ROW_PAD = 16;
/** 꼬리 챔버를 그릴 최소 잔여(이보다 작으면 그냥 여백이다). */
const TAIL_WELL_MIN_H = 72;

const TGT_ROW_H = 96;
const TGT_ROW_MAX_H = 148;
const TGT_BTN_W = 170;
const TGT_BTN_H = 52;

/** 정찰 판독 요약 줄(파낸 챔버) + 그 아래 레이어 슬라이스 5장. */
const RECON_SUMMARY_H = 48;
const RECON_SLICE_H = 120;
const RECON_SLICE_MAX_H = 176;
/** `reconView` 가 돌려주는 슬라이스 수(L1 편대 · L2 설비 · L3 보스/기물/수호). */
const RECON_SLICE_COUNT = 5;
/** 슬라이스 이름 i18n 키(인덱스 = `reconView().strips` 순서). */
const RECON_SLICE_KEYS: readonly string[] = [
  'ctl.recon.slice.wave',
  'ctl.recon.slice.socket',
  'ctl.recon.slice.boss',
  'ctl.recon.slice.prop',
  'ctl.recon.slice.guardian',
];
const RECON_CHIP = 44;
const RECON_CHIP_GAP = 10;

/** 작전 상황 열 — 내 전황 블록(상시)과 블록 사이 간격. */
const OPS_RANK_H = 108;
const OPS_GAP = 12;
/** 결과판 블록 높이 상한(정찰 공개 모듈이 붙으면 길어진다 — 넘치면 잘라 낸다). */
const OPS_RESULT_MAX_H = 300;
const REV_ROW_H = 112;
const REV_ROW_MAX_H = 160;
const REV_BTN_W = 120;
const REV_BTN_H = 44;

/** 배치전 진행바 세그먼트. */
const SEG_W = 56;
const SEG_H = 12;
const SEG_GAP = 8;

/** 순위표 RPC 상한(get_ladder_top 은 200 을 넘겨도 200 으로 자른다). */
const LADDER_CAP = 200;
/** 전투 기록 조회 상한. */
const HISTORY_CAP = 100;

/** 화면 좌표 사각형(디자인 스페이스). */
export interface TowerRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 이 화면의 레이아웃 전량 — **Pixi 없이 검증되는 순수 서술**이다.
 *
 * 왜 내보내는가: 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고,
 * 캔버스 없는 vitest 는 화면을 세울 수 없어 눈으로만 잡히는 유형이 된다. 좌표를 순수 값으로
 * 꺼내 두면 겹침·화면 이탈·톱니 예약 밴드 침범을 단위 테스트가 잠근다.
 */
export function controlTowerLayout(): {
  readonly screen: TowerRect;
  readonly headerH: number;
  readonly panels: readonly { readonly id: string; readonly rect: TowerRect }[];
  readonly footer: { readonly band: TowerRect; readonly buttons: readonly TowerRect[] };
  readonly headerControls: readonly { readonly id: string; readonly rect: TowerRect }[];
  /** 배경이 보존되는 창 — **없다**(파일 헤더 "왜 여기는 창을 뚫지 않는가"). */
  readonly windows: readonly TowerRect[];
} {
  let fx = FOOT_BTN_X;
  const buttons: TowerRect[] = [];
  for (const w of [LADDER_BTN_W, HIST_BTN_W, ALERT_BTN_W]) {
    buttons.push({ x: fx, y: FOOT_Y, w, h: FOOT_H });
    fx += w + FOOT_GAP;
  }
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels: [
      { id: 'targets', rect: { x: TGT_X, y: PANEL_Y, w: TGT_W, h: PANEL_H } },
      { id: 'recon', rect: { x: RECON_X, y: PANEL_Y, w: RECON_W, h: PANEL_H } },
      { id: 'ops', rect: { x: OPS_X, y: PANEL_Y, w: OPS_W, h: PANEL_H } },
    ],
    footer: { band: { x: EDGE_X, y: FOOT_Y, w: CONTENT_W, h: FOOT_H }, buttons },
    headerControls: [{ id: 'close', rect: { x: CLOSE_X, y: HEAD_Y, w: CLOSE_W, h: HEAD_H } }],
    windows: [],
  };
}

/** 패널 콘텐츠 상자와 그 안의 고정 블록(단위 테스트가 실제 패널 상자와 대조한다). */
export const TOWER_BOXES = {
  targets: { x: BOX_T.x, y: BOX_T.y, w: BOX_T.w, h: BOX_T.h, bottom: BOX_T.bottom },
  recon: { x: BOX_R.x, y: BOX_R.y, w: BOX_R.w, h: BOX_R.h, bottom: BOX_R.bottom },
  ops: { x: BOX_O.x, y: BOX_O.y, w: BOX_O.w, h: BOX_O.h, bottom: BOX_O.bottom },
  rowGap: ROW_GAP,
  tailWellMinH: TAIL_WELL_MIN_H,
  tgtRowH: TGT_ROW_H,
  tgtRowMaxH: TGT_ROW_MAX_H,
  /** 대상 행 폭에서 침공 버튼과 여백을 뺀 글자 폭 — 하한이 있어야 이름이 뭉개지지 않는다. */
  tgtTextW: BOX_T.w - TGT_BTN_W - 24 - 76,
  reconSummaryH: RECON_SUMMARY_H,
  reconSliceH: RECON_SLICE_H,
  reconSliceMaxH: RECON_SLICE_MAX_H,
  reconSliceCount: RECON_SLICE_COUNT,
  opsRankH: OPS_RANK_H,
  opsGap: OPS_GAP,
  revRowH: REV_ROW_H,
  revRowMaxH: REV_ROW_MAX_H,
} as const;

/**
 * 남는 세로를 행에 **고르게 나눈** 새 높이 배열(순수 함수 — Pixi 미의존).
 *
 * 넘치면(스크롤이 붙으면) 입력 그대로 돌려준다. 나눠 준 뒤에도 상한 때문에 남을 수 있고,
 * 그 잔여는 호출부가 꼬리 챔버로 받는다. 반올림 잔여는 **행 수 미만**이다.
 * (방어 사령부 `fillRowHeights` 복제 — 그 파일은 공용 모듈이 아니라 화면이다.)
 */
export function fillRowHeights(
  heights: readonly number[],
  gap: number,
  avail: number,
  maxH: number,
): number[] {
  const n = heights.length;
  if (n === 0) return [];
  const total = heights.reduce((a, b) => a + b, 0) + gap * (n - 1);
  if (total >= avail) return [...heights];
  const add = Math.floor((avail - total) / n);
  if (add <= 0) return [...heights];
  return heights.map((h) => Math.min(maxH, h + add));
}

// --- 팝업 넷: 높이를 **내용에서 역산**한다(버려지는 세로 0) ---------------------
//
// `68 = TITLE_BAND_H(52) + CONTENT_GAP(16)` · `24 = EDGE_PAD` — 제목 띠가 있는 시네마틱
// 패널의 콘텐츠 상자 기하다. `makeModal`(나무)은 고치지 않는다(다른 화면 다섯이 쓴다).

const SEARCH_W = 420;
const SEARCH_H = 48;
/** 페이지 이동 줄(맨 아래). */
const PAGER_H = 52;
const PAGER_GAP = 12;
/** 표 머리 한 줄(라벨 + 밑줄). */
const TABLE_HEAD_H = 40;

const LADDER_MINE_H = 56;
const LADDER_MINE_GAP = 12;
const LADDER_ROW_H = 44;
/** 순위표 한 쪽 행 수 — 높이가 여기서 역산되므로 둘은 같은 값에서 파생돼야 한다. */
const LADDER_PAGE = 11;
const LADDER_BLOCK_H =
  LADDER_MINE_H + LADDER_MINE_GAP + TABLE_HEAD_H + LADDER_PAGE * LADDER_ROW_H + PAGER_GAP + PAGER_H;

const HIST_FILTER_H = 46;
const HIST_FILTER_GAP = 12;
const HIST_SUMMARY_H = 24;
const HIST_SUMMARY_GAP = 8;
const HIST_ROW_H = 48;
const HIST_PAGE = 10;
const HIST_BLOCK_H =
  HIST_FILTER_H +
  HIST_FILTER_GAP +
  HIST_SUMMARY_H +
  HIST_SUMMARY_GAP +
  TABLE_HEAD_H +
  HIST_PAGE * HIST_ROW_H +
  PAGER_GAP +
  PAGER_H;

const ALERT_ROW_H = 108;
const ALERT_ROW_GAP = 10;
const ALERT_PITCH = ALERT_ROW_H + ALERT_ROW_GAP;
const ALERT_ROWS_MIN = 2;
const ALERT_ROWS_MAX = 6;

const SORTIE_ROW_H = 88;
const SORTIE_ROW_GAP = 12;
const SORTIE_PITCH = SORTIE_ROW_H + SORTIE_ROW_GAP;
const SORTIE_ROWS_MIN = 1;
const SORTIE_ROWS_MAX = 6;

/** 행 수에서 팝업 높이를 역산한다(빈 자리 0). 행 수는 [min, max] 로 클램프한다. */
function rowsModalHeight(rowCount: number, pitch: number, gap: number, min: number, max: number): number {
  const n = Math.max(min, Math.min(max, Math.trunc(rowCount)));
  return TITLED_BOX_Y + (n * pitch - gap) + PANEL_EDGE_PAD;
}

/** 침공 알림 팝업 높이 — 행 수에서 역산. */
export function alertsModalHeight(rowCount: number): number {
  return rowsModalHeight(rowCount, ALERT_PITCH, ALERT_ROW_GAP, ALERT_ROWS_MIN, ALERT_ROWS_MAX);
}

/** 출격 기체 선택 팝업 높이 — 행 수에서 역산. */
export function sortieModalHeight(rowCount: number): number {
  return rowsModalHeight(rowCount, SORTIE_PITCH, SORTIE_ROW_GAP, SORTIE_ROWS_MIN, SORTIE_ROWS_MAX);
}

export const TOWER_MODALS = {
  ladder: {
    w: 1360,
    h: TITLED_BOX_Y + LADDER_BLOCK_H + PANEL_EDGE_PAD,
    blockH: LADDER_BLOCK_H,
    rowH: LADDER_ROW_H,
    page: LADDER_PAGE,
  },
  history: {
    w: 1360,
    h: TITLED_BOX_Y + HIST_BLOCK_H + PANEL_EDGE_PAD,
    blockH: HIST_BLOCK_H,
    rowH: HIST_ROW_H,
    page: HIST_PAGE,
  },
  alerts: {
    w: 1100,
    rowH: ALERT_ROW_H,
    rowGap: ALERT_ROW_GAP,
    pitch: ALERT_PITCH,
    rowsMin: ALERT_ROWS_MIN,
    rowsMax: ALERT_ROWS_MAX,
  },
  sortie: {
    w: 1000,
    rowH: SORTIE_ROW_H,
    rowGap: SORTIE_ROW_GAP,
    pitch: SORTIE_PITCH,
    rowsMin: SORTIE_ROWS_MIN,
    rowsMax: SORTIE_ROWS_MAX,
  },
  /** 콘텐츠 상자 기하(네 팝업 공통) — 테스트가 역산식을 되짚는다. */
  boxY: TITLED_BOX_Y,
  edgePad: PANEL_EDGE_PAD,
} as const;

// --- 행 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 행 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 *
 * (예비역 로스터 `rowRamp` → 챔피언 선택 → 연구소 → 정제소 → 방어 사령부 경유 복제. 형제
 * 화면이라 같은 값이어야 하고, 그 파일들은 공용 모듈이 아니라 화면이라 import 하지 않는다.)
 */
let rowRampTex: Texture | null | undefined;

function rowRamp(): Texture | null {
  if (rowRampTex !== undefined) return rowRampTex;
  // ⚠️ 이 가드는 **캔버스를 굽는 함수에만** 붙인다. DOM 조회(`hudEl`)에 붙이면 HUD 숨김이
  // 통째로 죽는다(이 리포가 실제로 밟았다).
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    rowRampTex = null;
    return null;
  }
  try {
    const n = 64;
    const cv = document.createElement('canvas');
    cv.width = 1;
    cv.height = n;
    const ctx = cv.getContext('2d');
    if (ctx === null) {
      rowRampTex = null;
      return null;
    }
    const img = ctx.createImageData(1, n);
    for (let i = 0; i < n; i++) {
      // 위 1 → 아래 0. 선형이 아니라 위쪽에 몰리게(면이 위에서 빛을 받는다).
      const u = 1 - i / (n - 1);
      const a = Math.round(255 * u * u);
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    rowRampTex = Texture.from(cv);
    return rowRampTex;
  } catch {
    rowRampTex = null;
    return null;
  }
}

/**
 * 행 한 장의 바탕 — 2단 접지 그림자 + 석재 면 + 방향성 램프 + 안쪽 어두운 홈.
 *
 * **선은 긋지 않는다.** 행 사이 구분은 이 그림자와 행 간격이 만든다(세로 리브·가로 이음선은
 * 사용자가 격납고에서 삭제를 지시한 것들이다). 선택은 금색 링이, 성격은 글자색이 말한다.
 */
function rowPlate(w: number, h: number, selected: boolean, accent?: number): Container {
  const root = new Container();

  // 2단 접지 그림자 — 한 층으로는 접지가 안 읽힌다(넓고 옅은 확산 + 좁고 짙은 접촉).
  const diffuse = new Graphics();
  diffuse.roundRect(-3, 6, w + 6, h, ROW_RADIUS + 3).fill({ color: 0x000000, alpha: 0.22 });
  root.addChild(diffuse);
  const contact = new Graphics();
  contact.roundRect(1, 3, w - 2, h, ROW_RADIUS).fill({ color: 0x000000, alpha: 0.3 });
  root.addChild(contact);

  const face = new Graphics();
  face.roundRect(0, 0, w, h, ROW_RADIUS).fill({ color: ROW_FACE });
  root.addChild(face);

  const ramp = rowRamp();
  if (ramp !== null) {
    const clip = new Container();
    const mask = new Graphics();
    mask.roundRect(0, 0, w, h, ROW_RADIUS).fill({ color: 0xffffff });
    clip.addChild(mask);
    clip.mask = mask;

    const lit = new Sprite(ramp);
    lit.width = w;
    lit.height = h;
    lit.alpha = 0.11;
    clip.addChild(lit);

    const shade = new Sprite(ramp);
    shade.width = w;
    shade.height = h;
    shade.tint = 0x000000;
    shade.alpha = 0.3;
    // 뒤집어 아래쪽이 짙어지게 한다.
    shade.scale.y = -Math.abs(shade.scale.y);
    shade.y = h;
    clip.addChild(shade);

    root.addChild(clip);
  }

  const groove = new Graphics();
  groove
    .roundRect(0, 0, w, h, ROW_RADIUS)
    .stroke({ color: ROW_GROOVE, width: 2, alignment: 1, alpha: 0.85 });
  root.addChild(groove);

  const ringColor = selected ? COLOR.gold : accent;
  if (ringColor !== undefined) {
    const ring = new Graphics();
    ring
      .roundRect(0, 0, w, h, ROW_RADIUS)
      .stroke({ color: ringColor, width: selected ? 3 : 2, alignment: 1, alpha: 0.95 });
    root.addChild(ring);
  }
  return root;
}

/**
 * **파낸 면** 한 장(빈 목록 챔버 · 내 전황 · 결과판 · 정찰 슬라이스가 공유한다). 볼록한
 * {@link rowPlate} 와 조명 부호가 정확히 반대다: 위가 그늘이고 **아래 입술만** 빛을 받는다.
 * 이 부호가 뒤집히면 파인 자리가 아니라 얹어 놓은 판때기로 읽힌다.
 * (정제소 `recessedWell` → 방어 사령부 경유 복제 — 그 파일들은 공용 모듈이 아니라 화면이다.)
 */
function recessedWell(x: number, y: number, w: number, h: number): Graphics {
  const g = new Graphics();
  g.roundRect(x, y, w, h, 12)
    .fill({ color: 0x14100a, alpha: 0.82 })
    .stroke({ color: 0x0a0705, width: 2, alignment: 1, alpha: 0.9 });
  g.moveTo(x + 14, y + h - 1.5)
    .lineTo(x + w - 14, y + h - 1.5)
    .stroke({ color: 0x6a5a3e, width: 1.5, alpha: 0.45 });
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
    // 석재 크롬에 맞춘 어두운 입력면(옛 나무 팔레트에서 옮겨 온 유일한 DOM 조각이다).
    el.style.cssText = [
      'position:fixed',
      'z-index:40',
      'box-sizing:border-box',
      'outline:none',
      'border-radius:8px',
      'border:2px solid #0a0705',
      'background:#14100a',
      'color:#e4dac7',
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
  private readonly search = new SearchInput();
  private ui: UiTextures = {};
  private art: HangarTextures = {};

  private onInvade: ControlTowerCallbacks['onInvade'] | null = null;
  private onSpectate: ControlTowerCallbacks['onSpectate'] | null = null;
  private onSticker: ControlTowerCallbacks['onSticker'] | null = null;
  private onBack: (() => void) | null = null;

  // 소집(ADR-0024)용 프로필 참조 — 소집 가능 수호기 목록·기체 타입명 표시에 쓴다(순수 읽기).
  private profile: Profile | null = null;
  // 출격 기체 선택 팝업이 열려 있는 동안 보관하는 대상+정규화 배치. 확정 시 onInvade 로 넘어간다.
  private pendingSortie: { target: InvasionTarget; layout: InvasionLayers } | null = null;
  private sortieScrollY = 0;

  private targets: InvasionTarget[] | null = null; // null = 미로딩/미설정
  private cooldowns: Record<string, number> = {};
  private selectedId: string | null = null;
  private loading = true;
  private loadToken = 0;
  private opts: ControlTowerShowOpts = {};

  // 복수전(F1)·알림(계약 5) 상태 — 서버 권위. null = 미설정/미구현(→ 안내 챔버).
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
  /** 내 순위 — **진입 로드**로 끌어올렸다(작전 상황 열의 내 전황 블록이 상시 쓴다). */
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
  private modalScrollY = 0;

  /** 진입 전 런 HUD 의 visibility — 닫을 때 **원래 값으로** 되돌린다(무조건 '' 금지). */
  private hudPrevVisibility: string | null = null;

  // --- 크롬(1회 조립) ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  private chromeBuilt = false;
  private tgtHost: Container | null = null;
  private reconHost: Container | null = null;
  private opsHost: Container | null = null;
  private modalHost: Container | null = null;
  private modalPanel: CinematicPanel | null = null;
  private footHost: Container | null = null;
  private footNote: Text | null = null;
  /** 알림 버튼을 마지막으로 세울 때의 미확인 수 — 톤이 갈리므로 바뀔 때만 다시 세운다. */
  private footBuiltUnseen: number | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.root.visible || this.modal === null) return;
    if (e.key === 'Escape') this.closeModal();
  };

  constructor(stage: Container) {
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    window.addEventListener('keydown', this.onKeyDown);
    // UI 킷·배경 텍스처 비동기 로드 — 완료 후 열려 있으면 크롬을 다시 세운다(구운 텍스처가
    // 바뀌므로 갱신으로는 안 된다).
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      this.rebuild();
    });
    void loadHangarTextures().then((tex) => {
      this.art = tex;
      this.rebuild();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** 배경·석재 패널 연출 진행. `main.ts` 가 매 프레임 부른다 — 숨겨져 있으면 즉시 반환. */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const p of this.panels) p.update(dt);
    this.modalPanel?.update(dt);
  }

  show(profile: Profile, cb: ControlTowerCallbacks, opts: ControlTowerShowOpts = {}): void {
    this.profile = profile;
    this.onInvade = cb.onInvade;
    this.onSpectate = cb.onSpectate;
    this.onSticker = cb.onSticker;
    this.onBack = cb.onBack;
    this.opts = opts;
    this.pendingSortie = null;
    this.sortieScrollY = 0;
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
    this.modalScrollY = 0;

    this.buildChrome();
    this.refresh();
    this.root.visible = true;
    this.hideRunHud();
    void this.load();
  }

  hide(): void {
    this.root.visible = false;
    this.search.unmount();
    this.modal = null;
    this.pendingSortie = null;
    this.profile = null;
    this.onInvade = null;
    this.onSpectate = null;
    this.onSticker = null;
    this.onBack = null;
    this.restoreRunHud();
  }

  // --- 런 HUD ---------------------------------------------------------------

  /**
   * ⚠️ 여기에는 **캔버스 가드를 붙이지 않는다.** `typeof document.createElement !== 'function'`
   * 까지 검사하면 HUD 숨김이 통째로 죽는다(이 리포가 실제로 밟았다). 가드는 캔버스를 굽는
   * 함수({@link rowRamp})에만 붙인다.
   */
  private hudEl(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return document.getElementById('pb-hud');
  }

  private hideRunHud(): void {
    const el = this.hudEl();
    if (el === null) return;
    if (this.hudPrevVisibility === null) this.hudPrevVisibility = el.style.visibility;
    el.style.visibility = 'hidden';
  }

  /** 원래 값으로 되돌린다 — 옛 구현은 무조건 `''` 로 되살려 런 중 HUD 상태를 덮어썼다. */
  private restoreRunHud(): void {
    const el = this.hudEl();
    if (el !== null && this.hudPrevVisibility !== null) el.style.visibility = this.hudPrevVisibility;
    this.hudPrevVisibility = null;
  }

  // --- 로드 (DOM 판과 동일 규칙) --------------------------------------------

  /** 타깃·복수·알림·배치전·내 순위·쿨다운을 비동기 로드하고 재렌더. race 방지 토큰 사용. */
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
    // 내 순위는 단건 RPC 라 진입 로드에 함께 넣는다 — 작전 상황 열의 내 전황 블록이 상시 쓴다
    // (200행 순위표 전체는 팝업이 열릴 때 그대로 늦게 받는다).
    const [targets, placement, revenge, incoming, mine] = await Promise.all([
      fetchInvasionTargets(),
      fetchPlacementStatus(),
      fetchRevengeTargets(),
      fetchIncomingInvasions(seenAt, 20),
      fetchMyLadderRank(),
    ]);
    if (token !== this.loadToken || !this.visible) return; // 낡은 로드 무시
    this.targets = targets;
    this.placement = placement;
    this.revengeTargets = revenge;
    this.incoming = incoming;
    this.myRank = mine;
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
    this.refresh();
  }

  /** 순위표 전체(상한 200) — 순위표/전투 기록 팝업이 열릴 때 한 번 받는다. */
  private async loadLadder(): Promise<void> {
    if (this.ladderLoading || this.ladderAll !== null) return;
    this.ladderLoading = true;
    this.refresh();
    const page = await fetchLadderPage(LADDER_CAP, 0);
    if (!this.visible) return;
    this.ladderLoading = false;
    this.ladderAll = page;
    if (page !== null) {
      for (const e of page) {
        if (e.displayName !== undefined && e.displayName.length > 0) {
          this.names.set(e.profileId, e.displayName);
        }
      }
    }
    this.refresh();
  }

  /** 전투 기록 — 상대 이름 해석에 순위표가 필요해 함께 받는다. */
  private async loadHistory(): Promise<void> {
    if (this.historyLoading || this.history !== null) return;
    this.historyLoading = true;
    this.refresh();
    void this.loadLadder();
    const rows = await fetchInvasionHistory(HISTORY_CAP);
    if (!this.visible) return;
    this.historyLoading = false;
    this.history = rows;
    this.refresh();
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
    this.refresh();
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
      this.refresh();
    }
  }

  // --- 상호작용 (DOM 판과 동일 규칙) ----------------------------------------

  private selectTarget(id: string): void {
    this.selectedId = this.selectedId === id ? null : id;
    this.refresh();
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
    // 예비역 소집(ADR-0024): 소집 가능한 수호기(활성·미소멸 + 실물 빌드 有)가 하나라도 있으면
    // 출격 기체 선택 팝업을 띄운다. 없으면 기존과 동일하게 활성 기체로 즉시 출격한다(마찰 0·거동
    // 불변 — pilotGuardianId 인자 자체를 넘기지 않아 침공 경로가 바이트 그대로 유지된다).
    if (this.callupEligible().length > 0) {
      this.pendingSortie = { target, layout: st.layout };
      this.openModal('sortie');
      return;
    }
    const cb = this.onInvade;
    // 침공 런으로 넘어가면 이 화면은 내려간다(런 종료 후 main 이 다시 연다).
    // ⚠️ `hide()` 가 `onInvade` 를 비우므로 **먼저 캡처**한다.
    this.hide();
    cb?.(target, st.layout);
  }

  /** 소집 가능한 수호기(활성·미소멸 + 실물 빌드 有). build 없는 구 수호기는 소집 비활성(ADR-0024). */
  private callupEligible(): GuardianRecord[] {
    const p = this.profile;
    if (p === null) return [];
    return activeGuardians(p).filter((g) => g.build !== undefined);
  }

  /**
   * 출격 기체 선택 확정 — 팝업을 닫고 선택(활성=null / 수호기 id)을 침공 런으로 넘긴다.
   * `hide()` 가 `onInvade`·`pendingSortie` 를 비우므로 먼저 캡처한 뒤 호출한다.
   */
  private launchSortie(pilotGuardianId: string | null): void {
    const pending = this.pendingSortie;
    if (pending === null) return;
    const cb = this.onInvade;
    this.hide();
    cb?.(pending.target, pending.layout, pilotGuardianId);
  }

  private back(): void {
    const cb = this.onBack;
    this.hide();
    cb?.();
  }

  private openModal(kind: ModalKind): void {
    this.modal = kind;
    this.modalScrollY = 0;
    if (kind === 'ladder') {
      this.ladderPage = 0;
      void this.loadLadder();
    }
    if (kind === 'history') {
      this.historyPage = 0;
      void this.loadHistory();
    }
    this.refresh();
  }

  private closeModal(): void {
    this.modal = null;
    // 소집 팝업을 암막·닫기·Esc 로 닫으면 출격을 취소한다 — 대기 중인 대상+배치를 버린다.
    this.pendingSortie = null;
    this.search.unmount();
    this.refresh();
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

  private wrapped(
    text: string,
    size: number,
    color: number,
    w: number,
    weight: '400' | '700' | '800' = '400',
  ): Text {
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

  /** 시네마틱 버튼 — 기존 `PixiButton` 에 석재 텍스처만 주입한다(로직은 그대로). */
  private chromeButton(o: {
    tone: ChromeTone;
    width: number;
    height: number;
    fontSize: number;
    label: string;
    enabled?: boolean;
    onClick: () => void;
  }): PixiButton {
    const btn = new PixiButton({
      // ⚠️ 텍스처는 128×64 로 구워져 있다 — `cap: 32` 여야 모서리가 안 뭉개진다.
      texture: cinematicButtonTexture(o.tone),
      cap: 32,
      fallbackColor: chromeFallbackColor(o.tone),
      labelColor: chromeLabelColor(o.tone),
      width: o.width,
      height: o.height,
      fontSize: o.fontSize,
      label: stripEmoji(o.label),
      onClick: o.onClick,
    });
    if (o.enabled === false) btn.setEnabled(false);
    return btn;
  }

  /**
   * 비어 있는 자리를 **파낸 챔버**로 그리고 그 안에서 안내한다.
   *
   * 정제소 §6-bis-2 의 처방 그대로다 — "빈 패널 면"이 아니라 "비어 있는 챔버"가 되면 그 자리가
   * 쓸모도 볼거리도 아닌 자리이기를 멈춘다. 채울 수 있는 것이 없을 때(오프라인·보유 0) 남는
   * 세로를 행으로 메울 방법이 원리적으로 없기 때문에 **자리에 이름을 주는** 쪽으로 푼다.
   */
  private emptyWell(
    host: Container,
    box: { x: number; y: number; w: number; h: number },
    text: string,
  ): void {
    host.addChild(recessedWell(box.x, box.y, box.w, box.h));
    const el = this.wrapped(text, 19, SLAB_BODY_FILL, Math.max(80, box.w - 72));
    el.anchor.set(0.5, 0.5);
    el.position.set(box.x + box.w / 2, box.y + box.h / 2);
    host.addChild(el);
  }

  /**
   * 목록이 영역을 다 못 채우고 남았을 때 그 자리를 **파낸 챔버**로 그린다. 잔여가
   * {@link TAIL_WELL_MIN_H} 미만이면 그냥 여백이므로 아무것도 그리지 않는다.
   */
  private tailWell(
    host: Container,
    box: { x: number; w: number; bottom: number },
    usedBottom: number,
    text: string | null,
  ): void {
    const y = usedBottom + ROW_GAP;
    const h = box.bottom - y;
    if (h < TAIL_WELL_MIN_H) return;
    host.addChild(recessedWell(box.x, y, box.w, h));
    if (text === null) return;
    const el = this.wrapped(text, 17, COLOR.muted, Math.max(80, box.w - 64));
    el.anchor.set(0.5, 0.5);
    el.position.set(box.x + box.w / 2, y + h / 2);
    host.addChild(el);
  }

  private clearHost(host: Container): void {
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
  }

  // --- 크롬(1회 조립) -------------------------------------------------------

  /** 자산이 도착하면 크롬을 통째로 다시 세운다(구운 텍스처가 바뀌므로 갱신으로는 안 된다). */
  private rebuild(): void {
    if (!this.chromeBuilt) return;
    this.destroyChrome();
    this.buildChrome();
    this.refresh();
  }

  private destroyChrome(): void {
    this.modalPanel?.destroy();
    this.modalPanel = null;
    this.backdrop?.destroy();
    this.backdrop = null;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.tgtHost = null;
    this.reconHost = null;
    this.opsHost = null;
    this.modalHost = null;
    this.footHost = null;
    this.footNote = null;
    this.footBuiltUnseen = null;
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    this.chromeBuilt = false;
  }

  private buildChrome(): void {
    if (this.chromeBuilt) return;

    // 바닥 — 배경 자산이 없거나 실패해도 화면이 비지 않게(불투명, 뒤 아레나를 가린다).
    // 이벤트도 여기서 막는다(뒤 화면으로 클릭·휠이 새지 않게).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    // ⚠️ `view` 는 root 맨 뒤에 그대로 붙이고 스케일·이동을 걸지 마라(공기 마스크가 `view` 의
    // 자식이라 어긋난다). **창은 없다** — 파일 헤더 "왜 여기는 창을 뚫지 않는가".
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    /**
     * ⚠️ **크롬(헤더·하단 띠)은 패널보다 뒤에 붙여 위로 올린다.**
     *
     * 사용자 신고(2026-08-02, 방어 사령부) "탭 아래 절반이 클릭이 안 된다"의 실체가 이 순서였다.
     * 석재 패널은 접지 그림자·글로우를 텍스처에 구워 넣어 **자기 사각보다 30px 가까이 위아래로
     * 번지고**(패널 top 196 인데 bounds 가 y166 을 포함), 그 번짐이 위 컨트롤을 덮었다.
     *
     * 왜 "비상호작용이니 안 가린다"가 틀렸나: Pixi v8 은 자식을 역순으로 훑다가 **픽셀에 걸리면
     * 거기서 멈추고 가장 가까운 상호작용 조상**을 반환한다. 그림자 스프라이트가 passive 여도
     * 탐색은 거기서 끝나고 결과는 루트가 된다 — 컨트롤은 영영 후보에 오르지 못한다.
     *
     * ⚠️ 여백을 벌리는 것으로는 못 푼다 — 번짐 폭은 패널 치수에서 파생돼 조용히 커진다.
     */
    const tgtPanel = this.addPanel(TGT_X, PANEL_Y, TGT_W, PANEL_H, t('ctl.tgt.head'));
    const reconPanel = this.addPanel(RECON_X, PANEL_Y, RECON_W, PANEL_H, t('ctl.recon.head'));
    const opsPanel = this.addPanel(OPS_X, PANEL_Y, OPS_W, PANEL_H, t('ctl.ops.head'));

    const tgtHost = new Container();
    tgtPanel.container.addChild(tgtHost);
    this.tgtHost = tgtHost;
    const reconHost = new Container();
    reconPanel.container.addChild(reconHost);
    this.reconHost = reconHost;
    const opsHost = new Container();
    opsPanel.container.addChild(opsHost);
    this.opsHost = opsHost;

    // 크롬은 여기서부터 — 패널 위에 얹힌다(바로 위 주석이 근거).
    this.buildHeader();
    this.buildFooter();

    const modalHost = new Container();
    this.root.addChild(modalHost);
    this.modalHost = modalHost;

    this.chromeBuilt = true;
  }

  /**
   * 석재 패널 한 장을 세운다.
   *
   * ⚠️ `screenX`/`screenY` 를 **반드시 넘긴다.** 안 넘기면 같은 치수의 패널끼리 조명·랜드마크
   * 시드가 같아져 위치별 조명이 조용히 무효가 된다 — 화면은 정상적으로 서고 테스트도 통과하므로
   * 눈으로만 잡히는 유형이다.
   */
  private addPanel(px: number, py: number, pw: number, ph: number, title: string): CinematicPanel {
    const panel = makeCinematicPanel({
      width: pw,
      height: ph,
      variant: 'slab',
      title,
      screenX: px,
      screenY: py,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(px, py);
    this.root.addChild(panel.container);
    this.panels.push(panel);
    return panel;
  }

  /**
   * 헤더 밴드(y 0..{@link HEADER_H}) — 각인 제목(중앙) · 닫기(우).
   *
   * ⚠️ **재화 칩은 두지 않는다.** 이 화면은 크레딧·광물을 쓰지 않는다 — 형제 화면의 칩 x
   * (1424/1628)는 재화를 쓰는 화면의 어휘이고, 안 쓰는 화면에 얹는 것은 "그 화면의 결정을 돕지
   * 않는 진입점"이다.
   * ⚠️ **각인 석재 인방은 넣지 않는다**(격납고에서 사용자 판단으로 제거됨).
   * ⚠️ 좌측은 **비워 둔다** — x<120 · y<120 은 설정 톱니 예약 밴드다.
   */
  private buildHeader(): void {
    const title = makeHangarTitle(t('ctl.title'));
    title.position.set(DESIGN_WIDTH / 2, HEAD_Y - 4);
    this.root.addChild(title);

    const close = this.chromeButton({
      tone: 'stone',
      width: CLOSE_W,
      height: HEAD_H,
      fontSize: 22,
      // 컬러 이모지는 Pixi 에서 두부가 된다(`text.ts` stripEmoji) — U+2715 는 흑백 글리프다.
      label: '✕',
      onClick: () => this.back(),
    });
    close.container.position.set(CLOSE_X, HEAD_Y);
    this.root.addChild(close.container);
  }

  /**
   * 하단 액션 띠 — 오른쪽에 [순위표][전투 기록][침공 알림], 왼쪽에 상태 문구.
   *
   * 옛 [기지로 돌아가기]는 **없앴다**(헤더 ✕ 와 **같은 함수**를 불렀다). 옛 알림 버튼은 헤더에서
   * 내려 상시로 만들었다 — "내용이 있을 때만" 띄우면 헤더 우측이 상태에 따라 났다 사라진다.
   */
  private buildFooter(): void {
    const host = new Container();
    this.root.addChild(host);
    this.footHost = host;

    // 왼쪽 쉬는 문구 — 로딩·오프라인이면 그 안내, 아니면 화면 부제(옛 헤더 부제를 여기로 옮겼다).
    const note = this.label('', 19, COLOR.muted, '400', FOOT_BTN_X - EDGE_X - 24);
    note.anchor.set(0, 0.5);
    note.position.set(EDGE_X, FOOT_Y + FOOT_H / 2);
    this.root.addChild(note);
    this.footNote = note;
  }

  /**
   * 하단 버튼 셋을 세운다. **미확인 수가 바뀔 때만** 다시 세운다(알림 톤이 갈리기 때문).
   *
   * ⚠️ 알림 버튼의 톤이 상태에 따라 갈리는 이유: `gold` 톤의 라벨색은 **어두운 갈색**이라
   * 밝은 판 위에서만 읽힌다. 미확인이 없을 때까지 금색이면 "새 소식"이라는 신호가 죽는다.
   * (그리고 `setEnabled(false)` + `gold` 는 alpha 0.4 와 겹쳐 **글자가 통째로 사라진다** —
   * 이 화면의 버튼 중 비활성이 될 수 있는 것은 페이지 이동뿐이고 그것은 `stone` 이다.)
   */
  private buildFooterButtons(unseen: number): void {
    const host = this.footHost;
    if (host === null) return;
    this.clearHost(host);
    this.footBuiltUnseen = unseen;

    let x = FOOT_BTN_X;
    const ladder = this.chromeButton({
      tone: 'stone',
      width: LADDER_BTN_W,
      height: FOOT_H,
      fontSize: 21,
      label: t('ctl.btn.ladder'),
      onClick: () => this.openModal('ladder'),
    });
    ladder.container.position.set(x, FOOT_Y);
    host.addChild(ladder.container);
    x += LADDER_BTN_W + FOOT_GAP;

    const history = this.chromeButton({
      tone: 'stone',
      width: HIST_BTN_W,
      height: FOOT_H,
      fontSize: 21,
      label: t('ctl.btn.history'),
      onClick: () => this.openModal('history'),
    });
    history.container.position.set(x, FOOT_Y);
    host.addChild(history.container);
    x += HIST_BTN_W + FOOT_GAP;

    const alerts = this.chromeButton({
      tone: unseen > 0 ? 'gold' : 'stone',
      width: ALERT_BTN_W,
      height: FOOT_H,
      fontSize: 21,
      label: unseen > 0 ? t('ctl.btn.alerts', { n: unseen }) : t('ctl.notif.title'),
      onClick: () => this.openModal('alerts'),
    });
    alerts.container.position.set(x, FOOT_Y);
    host.addChild(alerts.container);
  }

  // --- 갱신 -----------------------------------------------------------------

  /** 값과 목록만 갈아끼운다. 배경·석재 패널은 다시 굽지 않는다(파일 헤더 "재렌더 규율"). */
  private refresh(): void {
    if (!this.chromeBuilt) return;
    this.syncValues();
    this.renderTargets();
    this.renderRecon();
    this.renderOps();
    this.renderModal();
  }

  private syncValues(): void {
    if (this.footBuiltUnseen !== this.unseenCount) this.buildFooterButtons(this.unseenCount);
    if (this.footNote !== null) {
      const offline = !this.loading && this.targets === null && this.placementTargets === null;
      const text = this.loading
        ? t('ctl.tgt.loading')
        : offline
          ? t('ctl.tgt.normalNull')
          : t('ctl.sub');
      this.footNote.text = stripEmoji(text);
      this.footNote.style.fill = offline ? BAD_COLOR : COLOR.muted;
    }
  }

  // --- 침공 대상 -----------------------------------------------------------

  private renderTargets(): void {
    const host = this.tgtHost;
    if (host === null) return;
    this.clearHost(host);

    const placementMode = this.inPlacement();
    if (this.loading) {
      this.emptyWell(host, BOX_T, t('ctl.tgt.loading'));
      return;
    }
    // 배치전이 아직 안 끝났으나 순위 삽입 대기(completing)면 목록 대신 안내.
    if (this.isCompleting()) {
      this.emptyWell(host, BOX_T, t('ctl.tgt.completingMsg'));
      return;
    }

    const list = placementMode ? this.placementTargets : this.targets;
    if (list === null) {
      this.emptyWell(host, BOX_T, placementMode ? t('ctl.tgt.placementNull') : t('ctl.tgt.normalNull'));
      return;
    }
    if (list.length === 0) {
      this.emptyWell(host, BOX_T, placementMode ? t('ctl.tgt.placementEmpty') : t('ctl.tgt.normalEmpty'));
      return;
    }

    const now = Date.now();
    // 남는 세로를 행이 나눠 갖는다(빈 자리 금지 — {@link fillRowHeights}).
    const hs = fillRowHeights(
      list.map(() => TGT_ROW_H),
      ROW_GAP,
      BOX_T.h,
      TGT_ROW_MAX_H,
    );
    const bounds = rowBounds(hs, ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(BOX_T.h, bounds);

    const content = makeScrollArea(host, {
      x: BOX_T.x,
      y: BOX_T.y,
      w: BOX_T.w,
      h: maskH,
      totalH: total,
      get: () => this.targetScrollY,
      set: (v) => {
        this.targetScrollY = v;
      },
    });

    let cy = 0;
    list.forEach((target, i) => {
      const h = hs[i] ?? TGT_ROW_H;
      const row = this.makeTargetRow(target, placementMode, now, BOX_T.w, h);
      row.position.set(0, cy);
      content.addChild(row);
      cy += h + ROW_GAP;
    });
    this.tailWell(host, BOX_T, BOX_T.y + Math.min(maskH, total), null);
  }

  /** 대상 1행(일반/배치전 공통). 배치전은 쿨다운 무시 + 시드 이름·난이도 밴드 표시. */
  private makeTargetRow(
    target: InvasionTarget,
    placementMode: boolean,
    now: number,
    w: number,
    h: number,
  ): Container {
    const st = placementMode
      ? computePlacementInvadeState(target)
      : computeInvadeState(target, this.cooldowns, now);
    const meta = placementMode ? seedBaseByProfileId(target.profileId) : null;
    const selected = this.selectedId === target.profileId;

    const row = new Container();
    // 선택 클릭은 **행 전체**가 받는다. 바탕(Graphics)에만 걸면 이름·정비도 텍스트 위를
    // 눌렀을 때 먹지 않는다 — Pixi 는 위에 얹힌 텍스트에서 히트를 멈추고 그 위의 상호작용
    // 조상(화면 root)으로 올라가 버리기 때문이다(실측 결함). 침공 버튼만 아래에서 전파를 끊는다.
    attachRowClick(row, () => this.selectTarget(target.profileId));
    row.addChild(rowPlate(w, h, selected));

    const rank = this.label(`#${target.rank}`, 24, COLOR.gold, '800');
    rank.anchor.set(0.5, 0.5);
    rank.position.set(38, h / 2);
    row.addChild(rank);

    const textX = 76;
    const textW = Math.max(60, w - TGT_BTN_W - 24 - textX);
    // 행 높이가 늘어나도 세 줄이 세로 가운데에 남게 위쪽 여백을 파생시킨다(빈 자리 금지에서
    // 행이 자라므로, 고정 y 로 두면 글자가 위에 몰리고 아래에 빈 면이 생긴다).
    const top = Math.round((h - 78) / 2);

    const name = this.label(
      placementMode ? placementTargetName(target) : target.displayName,
      21,
      COLOR.cream,
      '800',
      textW,
    );
    name.position.set(textX, top);
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
    desc.position.set(textX, top + 30);
    row.addChild(desc);

    const maint = this.label(maintenanceLabel(target.maintenance), 16, GOOD_COLOR, '700', textW);
    maint.position.set(textX, top + 56);
    row.addChild(maint);

    const canInvade = st.canInvade;
    const btn = this.chromeButton({
      // ⚠️ 비활성에 `gold` 를 쓰면 alpha 0.4 + 어두운 라벨이 겹쳐 글자가 통째로 사라진다.
      tone: canInvade ? 'gold' : 'stone',
      width: TGT_BTN_W,
      height: TGT_BTN_H,
      // 비활성 라벨은 사유 문구("재도전까지 45분")라 한 단계 작게 잡는다.
      fontSize: canInvade ? 22 : 16,
      label: canInvade ? (placementMode ? t('ctl.tgt.btnPlacement') : t('ctl.tgt.btnInvade')) : st.reason,
      enabled: canInvade,
      onClick: () => this.invade(target),
    });
    btn.container.position.set(w - TGT_BTN_W - 12, (h - TGT_BTN_H) / 2);
    // 침공은 행 선택과 다른 동작이다 — 버튼을 눌렀을 때 행 선택까지 따라오지 않게 끊는다.
    // (비활성 버튼은 eventMode 'none' 이라 이 리스너도 죽고, 클릭이 행 선택으로 넘어간다.)
    stopRowPropagation(btn.container);
    row.addChild(btn.container);

    return row;
  }

  // --- 기지 정찰 -----------------------------------------------------------

  /**
   * 정찰 판독 — 요약 챔버 한 줄 + **레이어 슬라이스 5장**.
   *
   * 옛 구현은 슬라이스를 얇은 줄로 그려 756px 중 500px 가까이를 빈 갈색 면으로 남겼다. 슬라이스
   * 개수는 규격이 정하므로 행 개수로는 못 채운다 → 남는 세로를 슬라이스가 **나눠 갖는다**.
   * 슬라이스는 파낸 챔버다 — "판독 슬롯"이라는 성격이 조명 부호로 읽힌다.
   */
  private renderRecon(): void {
    const host = this.reconHost;
    if (host === null) return;
    this.clearHost(host);

    // 선택 대상은 일반/배치전 두 목록 중 하나에 있다.
    const inList = (list: InvasionTarget[] | null): InvasionTarget | null =>
      list?.find((entry) => entry.profileId === this.selectedId) ?? null;
    const target = inList(this.targets) ?? inList(this.placementTargets);
    if (target === null) {
      this.emptyWell(host, BOX_R, t('ctl.recon.selectPrompt'));
      return;
    }
    const layers = normalizeTargetLayers(target.layout);
    if (layers === null) {
      this.emptyWell(host, BOX_R, t('ctl.recon.noBase'));
      return;
    }

    // 3레이어 정찰(M7b-acquisition · 결정 #15). 15×9 미니 격자는 M7a 에서 사라졌다 —
    // 3레이어(종스크롤 → 횡스크롤 → 코어방)에는 격자 좌표계 자체가 없다. 대신 레이어별
    // **실루엣 칩 · 등급 색 · 승급 별**만 낸다. 정확 스펙(레벨·어픽스)은 뷰 모델에 필드가
    // 없어 여기서 흘릴 방법이 아예 없고, 종류 이름은 1회 침공한 상대만 열린다.
    const view = reconView(layers, this.cooldowns[target.profileId] !== undefined);

    host.addChild(recessedWell(BOX_R.x, BOX_R.y, BOX_R.w, RECON_SUMMARY_H));
    const summary = this.label(view.summary, 18, SLAB_BODY_FILL, '700', BOX_R.w - 32);
    summary.anchor.set(0, 0.5);
    summary.position.set(BOX_R.x + 16, BOX_R.y + RECON_SUMMARY_H / 2);
    host.addChild(summary);

    const top = BOX_R.y + RECON_SUMMARY_H + OPS_GAP;
    const strips = view.strips.slice(0, RECON_SLICE_COUNT);
    const hs = fillRowHeights(
      strips.map(() => RECON_SLICE_H),
      ROW_GAP,
      BOX_R.bottom - top,
      RECON_SLICE_MAX_H,
    );
    let cy = top;
    strips.forEach((strip, i) => {
      const h = hs[i] ?? RECON_SLICE_H;
      this.renderReconSlice(host, strip, i, cy, h);
      cy += h + ROW_GAP;
    });
    this.tailWell(host, BOX_R, cy - ROW_GAP, null);
  }

  /** 정찰 슬라이스 한 장 — 파낸 챔버 + 이름/점유 수 + 슬롯 칩(등급 색 · 승급 별). */
  private renderReconSlice(host: Container, strip: ReconStrip, index: number, y: number, h: number): void {
    host.addChild(recessedWell(BOX_R.x, y, BOX_R.w, h));

    const occupied = strip.slots.filter((s) => s.occupied).length;
    const head = this.label(
      `${t((RECON_SLICE_KEYS[index] ?? 'ctl.recon.head') as Parameters<typeof t>[0])} · ${occupied}/${strip.slots.length}`,
      17,
      SLAB_BODY_FILL,
      '700',
      BOX_R.w - 32,
    );
    head.position.set(BOX_R.x + 16, y + 12);
    host.addChild(head);

    const x0 = BOX_R.x + 16;
    // 소켓이 12개까지 늘어나므로 남는 폭에 맞춰 칸 간격을 줄인다(넘치면 잘리는 대신 좁아진다).
    const avail = Math.max(RECON_CHIP, BOX_R.w - 32);
    const step = Math.min(
      RECON_CHIP + RECON_CHIP_GAP,
      strip.slots.length > 0 ? avail / strip.slots.length : avail,
    );
    // 칩 줄은 머리글 아래 남는 세로의 가운데에 앉는다(챔버가 자라도 위에 몰리지 않게).
    const chipY = y + 44 + Math.max(0, Math.round((h - 44 - RECON_CHIP - 14) / 2));

    strip.slots.forEach((slot, i) => {
      const g = new Graphics();
      if (slot.occupied) {
        g.roundRect(0, 0, RECON_CHIP, RECON_CHIP, 8).fill({ color: hexColor(reconRarityColor(slot.rarity)) });
      } else {
        g.roundRect(0, 0, RECON_CHIP, RECON_CHIP, 8).stroke({ color: 0x5a4a34, width: 2 });
      }
      g.position.set(x0 + i * step, chipY);
      host.addChild(g);
      if (!slot.occupied) return;

      // 실루엣 글리프: 해금이면 이름 첫 글자, 잠금이면 '?'. 정확 스펙은 어느 쪽이든 안 낸다.
      const glyph = this.label(reconSlotLabel(slot).slice(0, 1), 20, COLOR.darkLabel, '800');
      glyph.position.set(x0 + i * step + (RECON_CHIP - glyph.width) / 2, chipY + (RECON_CHIP - 24) / 2);
      host.addChild(glyph);

      if (slot.ascension > 0) {
        // 승급 별은 채워진 개수만 작게 얹는다(빈 별까지 그리면 칩이 뭉갠다).
        const stars = this.label('★'.repeat(Math.min(slot.ascension, 5)), 12, COLOR.gold, '800', RECON_CHIP);
        stars.position.set(x0 + i * step, chipY + RECON_CHIP - 2);
        host.addChild(stars);
      }
    });
  }

  // --- 작전 상황(내 전황 · 결과판 · 검증 중 · 배치전 · 복수) --------------------

  /**
   * 옛 "상단 상태 패널"(가로 전폭 · 조건부)과 옛 "복수 열"(조건부)을 한 열로 합친 자리다.
   * 둘 다 조건부였고 둘 다 세로로 짧아, 합치면 **상태에 따라 기하가 갈리는 병**이 사라진다.
   * 맨 위 내 전황 블록은 상시라 이 열은 원리적으로 비지 않는다.
   */
  private renderOps(): void {
    const host = this.opsHost;
    if (host === null) return;
    this.clearHost(host);

    let y = BOX_O.y;
    y = this.renderMyStanding(host, y) + OPS_GAP;

    const result = this.opts.result;
    if (result !== undefined) y = this.renderResultBlock(host, y, result) + OPS_GAP;
    if (this.opts.verifying === true) y = this.renderVerifyingBlock(host, y) + OPS_GAP;
    y = this.renderPlacementBlock(host, y);

    this.renderRevenge(host, y);
  }

  /** 내 전황 — 순위·전적·승률. 진입 로드에서 받은 단건이라 팝업을 열지 않아도 보인다. */
  private renderMyStanding(host: Container, y: number): number {
    host.addChild(recessedWell(BOX_O.x, y, BOX_O.w, OPS_RANK_H));
    const head = this.label(t('ctl.ops.rankHead'), 16, COLOR.muted, '700', BOX_O.w - 32);
    head.position.set(BOX_O.x + 16, y + 12);
    host.addChild(head);

    const mine = this.myRank;
    const body =
      mine !== null
        ? t('ctl.ladder.meRank', {
            n: mine.rank,
            w: mine.wins,
            l: mine.losses,
            p: winRate(mine.wins, mine.losses),
          })
        : this.loading
          ? t('ctl.pop.loading')
          : t('ctl.ladder.meUnranked');
    const el = this.wrapped(body, 18, mine !== null ? COLOR.gold : COLOR.muted, BOX_O.w - 32, '700');
    el.position.set(BOX_O.x + 16, y + 38);
    host.addChild(el);
    return y + OPS_RANK_H;
  }

  /** 침공 결과판 — 배너 한 줄 + (있으면) 상대 코어 모듈 정찰 공개 3줄/모듈. */
  private renderResultBlock(host: Container, y: number, result: InvasionResultView): number {
    const modules = this.opts.revealModules ?? [];
    const inner = new Container();
    let cy = 0;
    const put = (text: string, size: number, color: number, weight: '400' | '700' | '800'): void => {
      const el = this.wrapped(text, size, color, BOX_O.w - 32, weight);
      el.position.set(0, cy);
      inner.addChild(el);
      cy += el.height + 6;
    };
    put(resultBannerText(result), 20, this.resultColor(result), '800');
    for (const mod of modules) {
      // 컬러 이모지는 캔버스에서 두부가 된다(문구 자체에도 넣지 않지만 방어적으로 벗긴다).
      put(t('mod.reveal.head'), 15, COLOR.muted, '700');
      put(
        `${t('mod.reveal.grade', { rarity: moduleRarityLabel(mod.rarity) })} · ${t('mod.reveal.charges', { n: mod.chargesLeft })}`,
        17,
        hexColor(moduleRarityColor(mod.rarity)),
        '800',
      );
      put(moduleAffixOneLine(mod), 14, COLOR.muted, '400');
    }
    const h = Math.min(OPS_RESULT_MAX_H, Math.ceil(cy) + 24);
    host.addChild(recessedWell(BOX_O.x, y, BOX_O.w, h));
    inner.position.set(BOX_O.x + 16, y + 12);
    // 상한을 넘치면 잘라 낸다 — 챔버 밖으로 글자가 흘러나오면 아래 블록과 겹친다.
    const clip = new Graphics();
    clip.rect(BOX_O.x, y, BOX_O.w, h).fill({ color: 0xffffff });
    host.addChild(clip);
    inner.mask = clip;
    host.addChild(inner);
    return y + h;
  }

  /** 결과 배너 색 — 미제출·확정 중은 중립(크림), 확정 승 금색, 그 외(패배·거부) 살구색. */
  private resultColor(view: InvasionResultView): number {
    if (!view.submitted || view.attackerWon === null) return COLOR.cream;
    return view.status === 'verified' && view.attackerWon ? COLOR.gold : BAD_COLOR;
  }

  private renderVerifyingBlock(host: Container, y: number): number {
    const el = this.wrapped(t('ctl.verifying'), 17, COLOR.cream, BOX_O.w - 32, '700');
    const h = Math.ceil(el.height) + 24;
    host.addChild(recessedWell(BOX_O.x, y, BOX_O.w, h));
    el.position.set(BOX_O.x + 16, y + 12);
    host.addChild(el);
    return y + h;
  }

  /**
   * 배치전 블록(진행바 / 순위 진입 버튼 / 진입 연출). 표시할 것이 없으면 y 를 그대로 돌려준다 —
   * 이 열은 조건부 블록을 세로로 쌓고 남는 자리를 복수 목록이 받는 구조다.
   */
  private renderPlacementBlock(host: Container, y0: number): number {
    // 방금 순위에 진입한 직후 연출(placementResult.placed)은 status.placed 여도 1회 표시.
    const entered = this.placementResult;
    if (entered !== null && entered.placed) {
      const el = this.wrapped(
        t('ctl.place.entered', { rank: entered.rank, won: entered.matchesWon }),
        18,
        COLOR.gold,
        BOX_O.w - 32,
        '800',
      );
      const h = Math.ceil(el.height) + 24;
      host.addChild(recessedWell(BOX_O.x, y0, BOX_O.w, h));
      el.position.set(BOX_O.x + 16, y0 + 12);
      host.addChild(el);
      return y0 + h + OPS_GAP;
    }
    const status = this.placement;
    if (status === null) return y0;
    const phase = placementPhase(status);
    if (phase === 'ranked') return y0; // 일반 침공 단계 — 배치전 UI 없음

    if (phase === 'completing') {
      const line = this.wrapped(
        t('ctl.place.completeLine', { total: status.total, won: status.won }),
        17,
        COLOR.cream,
        BOX_O.w - 32,
        '700',
      );
      const h = Math.ceil(line.height) + 12 + 56 + 24;
      host.addChild(recessedWell(BOX_O.x, y0, BOX_O.w, h));
      line.position.set(BOX_O.x + 16, y0 + 12);
      host.addChild(line);
      const btn = this.chromeButton({
        // ⚠️ `applying` 중에는 `stone` — `gold` + setEnabled(false) 는 라벨이 사라진다.
        tone: this.applying ? 'stone' : 'gold',
        width: BOX_O.w - 32,
        height: 56,
        fontSize: 21,
        label: this.applying ? t('ctl.place.applying') : t('ctl.place.enter'),
        enabled: !this.applying,
        onClick: () => void this.applyPlacement(),
      });
      btn.container.position.set(BOX_O.x + 16, y0 + 12 + Math.ceil(line.height) + 12);
      host.addChild(btn.container);
      return y0 + h + OPS_GAP;
    }

    const label = this.wrapped(
      `${placementProgressLabel(status)}${t('ctl.place.remaining', { n: placementRemaining(status) })}`,
      17,
      COLOR.cream,
      BOX_O.w - 32,
      '700',
    );
    const hint = this.wrapped(t('ctl.place.hint'), 14, COLOR.muted, BOX_O.w - 32);
    const h = 12 + Math.ceil(label.height) + 10 + SEG_H + 12 + Math.ceil(hint.height) + 12;
    host.addChild(recessedWell(BOX_O.x, y0, BOX_O.w, h));
    let y = y0 + 12;
    label.position.set(BOX_O.x + 16, y);
    host.addChild(label);
    y += Math.ceil(label.height) + 10;

    const bar = new Graphics();
    for (let i = 0; i < status.total; i++) {
      const done = i < status.completed;
      bar
        .roundRect(BOX_O.x + 16 + i * (SEG_W + SEG_GAP), y, SEG_W, SEG_H, SEG_H / 2)
        .fill({ color: done ? COLOR.gold : 0x3a3050 })
        .stroke({ color: done ? COLOR.gold : 0x5a4630, width: 2, alignment: 1 });
    }
    host.addChild(bar);
    y += SEG_H + 12;

    hint.position.set(BOX_O.x + 16, y);
    host.addChild(hint);
    return y0 + h + OPS_GAP;
  }

  /** 복수 대상(F1) — 24h 창이 살아 있는 대상. 이 열의 **남는 세로 전부**를 쓴다. */
  private renderRevenge(host: Container, y: number): void {
    const avail = BOX_O.bottom - y;
    if (avail < TAIL_WELL_MIN_H) return;
    const box = { x: BOX_O.x, y, w: BOX_O.w, h: avail, bottom: BOX_O.bottom };
    const list = this.revengeTargets ?? [];
    if (list.length === 0) {
      this.emptyWell(host, box, t('ctl.rev.none'));
      return;
    }

    const now = Date.now();
    const hs = fillRowHeights(
      list.map(() => REV_ROW_H),
      ROW_GAP,
      avail,
      REV_ROW_MAX_H,
    );
    const bounds = rowBounds(hs, ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(avail, bounds);

    const content = makeScrollArea(host, {
      x: box.x,
      y,
      w: box.w,
      h: maskH,
      totalH: total,
      get: () => this.revengeScrollY,
      set: (v) => {
        this.revengeScrollY = v;
      },
    });
    let cy = 0;
    list.forEach((target, i) => {
      const h = hs[i] ?? REV_ROW_H;
      const row = this.makeRevengeRow(target, now, box.w, h);
      row.position.set(0, cy);
      content.addChild(row);
      cy += h + ROW_GAP;
    });
    this.tailWell(host, box, y + Math.min(maskH, total), null);
  }

  /**
   * 복수 대상 카드 1장(24h 창 · 쿨다운 무시 배지 · 복수 침공 버튼). 열이 좁아 버튼을 문구
   * 옆에 두면 문구가 눌려 읽을 수 없다 → 문구는 가로 폭 전체, 버튼은 그 아래 오른쪽.
   */
  private makeRevengeRow(target: RevengeTarget, now: number, w: number, h: number): Container {
    const st = revengeCardState(target, now);
    const row = new Container();
    row.addChild(rowPlate(w, h, false, 0x8a4a4a));

    const name = this.label(
      target.displayName.length > 0 ? target.displayName : t('ctl.anonymous'),
      19,
      COLOR.cream,
      '800',
      w - 28,
    );
    name.position.set(14, 10);
    row.addChild(name);

    const badge = this.label(t('ctl.rev.badge'), 13, COLOR.gold, '800', w - 28);
    badge.position.set(14, 36);
    row.addChild(badge);

    const rem = this.label(
      st.expired ? t('ctl.rev.expired') : `${st.remainingLabel} · ${shipSummaryText(target.shipSummary)}`,
      15,
      st.expired ? BAD_COLOR : COLOR.gold,
      '700',
      w - 28,
    );
    rem.position.set(14, 58);
    row.addChild(rem);

    const canRevenge = !st.expired && st.layout !== null;
    const btn = this.chromeButton({
      tone: canRevenge ? 'red' : 'stone',
      width: REV_BTN_W,
      height: REV_BTN_H,
      fontSize: 18,
      label: st.expired
        ? t('ctl.rev.btnExpired')
        : st.layout === null
          ? t('ctl.rev.btnNoBase')
          : t('ctl.rev.btnRevenge'),
      enabled: canRevenge,
      onClick: () => {
        const layout = st.layout;
        if (!canRevenge || layout === null) return;
        const cb = this.onInvade;
        this.hide();
        cb?.(target, layout);
      },
    });
    btn.container.position.set(w - REV_BTN_W - 14, h - REV_BTN_H - 12);
    stopRowPropagation(btn.container);
    row.addChild(btn.container);

    return row;
  }

  // --- 팝업 ---------------------------------------------------------------

  /**
   * 시네마틱 팝업. **`makeModal` 을 쓰지 않는다** — 그 모듈은 나무 nine-slice 에 묶여 있고 다른
   * 화면 다섯이 쓰기 때문에 고치면 그 화면들이 같이 갈린다. 대신 `modal.ts` 헤더의 실측 규칙
   * 세 가지를 그대로 승계한다:
   *  ① 암막은 **완전 불투명 채움**(뒤 화면 글자가 비쳐 읽히는 결함).
   *  ② 암막이 **이벤트를 먹는다**(안 그러면 뒤 목록이 스크롤된다).
   *  ③ 패널 안쪽 탭은 암막까지 **전파를 끊는다**(안 그러면 팝업 안을 누를 때마다 닫힌다).
   */
  private renderModal(): void {
    const host = this.modalHost;
    if (host === null) return;
    this.modalPanel?.destroy();
    this.modalPanel = null;
    this.clearHost(host);
    if (this.modal === null) {
      this.search.unmount();
      return;
    }
    // 팝업은 언제나 맨 앞이어야 한다.
    this.root.setChildIndex(host, this.root.children.length - 1);

    const kind = this.modal;
    const geom =
      kind === 'ladder'
        ? { w: TOWER_MODALS.ladder.w, h: TOWER_MODALS.ladder.h, title: t('ctl.ladder.title') }
        : kind === 'history'
          ? { w: TOWER_MODALS.history.w, h: TOWER_MODALS.history.h, title: t('ctl.hist.title') }
          : kind === 'alerts'
            ? {
                w: TOWER_MODALS.alerts.w,
                h: alertsModalHeight((this.incoming ?? []).length),
                title: t('ctl.notif.title'),
              }
            : {
                w: TOWER_MODALS.sortie.w,
                h: sortieModalHeight(this.callupEligible().length + 1),
                title: t('sortie.title'),
              };

    // ① · ② 암막.
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: SCRIM_ALPHA });
    scrim.eventMode = 'static';
    scrim.on('pointertap', () => this.closeModal());
    host.addChild(scrim);

    const px = Math.round((DESIGN_WIDTH - geom.w) / 2);
    const py = Math.round((DESIGN_HEIGHT - geom.h) / 2);
    const panel = makeCinematicPanel({
      width: geom.w,
      height: geom.h,
      variant: 'slab',
      title: geom.title,
      screenX: px,
      screenY: py,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(px, py);
    // ③ 패널 안쪽 탭이 암막까지 내려가지 않게 막는다.
    stopRowPropagation(panel.container);
    host.addChild(panel.container);
    this.modalPanel = panel;

    if (kind === 'ladder') this.renderLadderModal(panel, px, py);
    else if (kind === 'history') this.renderHistoryModal(panel, px, py);
    else if (kind === 'alerts') this.renderAlertsModal(panel);
    else this.renderSortieModal(panel);
  }

  /** 팝업 안 표 헤더 한 줄 + 밑줄. 열 정의는 상자 기준 상대 좌표. */
  private tableHeader(
    panel: CinematicPanel,
    y: number,
    cols: readonly { label: string; x: number; anchor: 0 | 1 }[],
  ): void {
    const box = panel.box;
    for (const col of cols) {
      const el = this.label(col.label, 16, COLOR.muted, '700');
      el.anchor.set(col.anchor, 0);
      el.position.set(box.x + col.x, y);
      panel.container.addChild(el);
    }
    const rule = new Graphics();
    rule.rect(box.x, y + 28, box.w, 2).fill({ color: 0x0a0705, alpha: 0.9 });
    panel.container.addChild(rule);
  }

  /** 페이지 이동 줄([이전] N/M 쪽 [다음]) — 상자 바닥에 붙인다. */
  private pager(
    panel: CinematicPanel,
    page: number,
    pageCount: number,
    onPage: (next: number) => void,
  ): void {
    const box = panel.box;
    const y = box.bottom - PAGER_H;
    const btnW = 130;
    const btnH = 48;
    const prev = this.chromeButton({
      tone: 'stone',
      width: btnW,
      height: btnH,
      fontSize: 19,
      label: t('ctl.pop.prev'),
      enabled: page > 0,
      onClick: () => onPage(page - 1),
    });
    prev.container.position.set(box.x + box.w / 2 - 160 - btnW, y);
    panel.container.addChild(prev.container);

    const label = this.label(
      t('ctl.pop.page', { cur: page + 1, total: Math.max(1, pageCount) }),
      20,
      COLOR.cream,
      '700',
    );
    label.anchor.set(0.5, 0.5);
    label.position.set(box.x + box.w / 2, y + btnH / 2);
    panel.container.addChild(label);

    const next = this.chromeButton({
      tone: 'stone',
      width: btnW,
      height: btnH,
      fontSize: 19,
      label: t('ctl.pop.next'),
      enabled: page < pageCount - 1,
      onClick: () => onPage(page + 1),
    });
    next.container.position.set(box.x + box.w / 2 + 160, y);
    panel.container.addChild(next.container);
  }

  // --- 순위표 팝업 ---------------------------------------------------------

  private renderLadderModal(panel: CinematicPanel, px: number, py: number): void {
    const box = panel.box;
    // 내 순위 — 목록 어디에 있든 항상 맨 위에 따로 보여 준다(찾아 헤매지 않게).
    const mine = this.myRank;
    const mineW = box.w - SEARCH_W - 24;
    panel.container.addChild(recessedWell(box.x, box.y, mineW, LADDER_MINE_H));
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
      mineW - 32,
    );
    mineText.anchor.set(0, 0.5);
    mineText.position.set(box.x + 16, box.y + LADDER_MINE_H / 2);
    panel.container.addChild(mineText);

    // 검색 입력(DOM 오버레이) — 팝업 좌표를 화면 좌표로 환산해 얹는다.
    this.search.mount(
      this.stage,
      'ladder',
      { x: px + box.right - SEARCH_W, y: py + box.y + 4, w: SEARCH_W, h: SEARCH_H },
      t('ctl.pop.search'),
      this.ladderQuery,
      (v) => {
        this.ladderQuery = v;
        this.ladderPage = 0;
        this.refresh();
      },
    );

    const listTop = box.y + LADDER_MINE_H + LADDER_MINE_GAP;
    const restBox = { x: box.x, y: listTop, w: box.w, h: box.bottom - listTop };
    if (this.ladderLoading) {
      this.emptyWell(panel.container, restBox, t('ctl.pop.loading'));
      return;
    }
    const all = this.ladderAll;
    if (all === null) {
      this.emptyWell(panel.container, restBox, t('ctl.ladder.null'));
      return;
    }
    if (all.length === 0) {
      this.emptyWell(panel.container, restBox, t('ctl.ladder.empty'));
      return;
    }

    const query = this.ladderQuery.trim().toLowerCase();
    const rows =
      query.length === 0 ? all : all.filter((e) => this.ladderName(e).toLowerCase().includes(query));
    if (rows.length === 0) {
      this.emptyWell(panel.container, restBox, t('ctl.pop.noMatch'));
      return;
    }

    const nameX = 130;
    const recX = Math.round(box.w * 0.66);
    const rateX = box.w;
    this.tableHeader(panel, listTop, [
      { label: t('ctl.ladder.rank'), x: 0, anchor: 0 },
      { label: t('ctl.ladder.name'), x: nameX, anchor: 0 },
      { label: t('ctl.ladder.games'), x: recX, anchor: 1 },
      { label: t('ctl.ladder.winRate'), x: rateX, anchor: 1 },
    ]);

    const pageCount = Math.max(1, Math.ceil(rows.length / LADDER_PAGE));
    const page = Math.min(this.ladderPage, pageCount - 1);
    const slice = rows.slice(page * LADDER_PAGE, page * LADDER_PAGE + LADDER_PAGE);
    const rowTop = listTop + TABLE_HEAD_H;
    const myId = this.myRank?.profileId ?? null;

    slice.forEach((e, i) => {
      const y = rowTop + i * LADDER_ROW_H;
      const isMe = myId !== null && e.profileId === myId;
      if (isMe) {
        const ring = new Graphics();
        ring
          .roundRect(box.x, y, box.w, LADDER_ROW_H - 4, 8)
          .fill({ color: 0x3a3020, alpha: 0.9 })
          .stroke({ color: COLOR.gold, width: 2, alignment: 1 });
        panel.container.addChild(ring);
      } else if (i % 2 === 1) {
        const stripe = new Graphics();
        stripe.roundRect(box.x, y, box.w, LADDER_ROW_H - 4, 8).fill({ color: 0x000000, alpha: 0.22 });
        panel.container.addChild(stripe);
      }

      const rank = this.label(`#${e.rank}`, 19, COLOR.gold, '800');
      rank.position.set(box.x + 10, y + 9);
      panel.container.addChild(rank);

      const nameLabel = isMe ? `${this.ladderName(e)} (${t('ctl.ladder.me')})` : this.ladderName(e);
      const name = this.label(
        nameLabel,
        18,
        isMe ? COLOR.gold : COLOR.cream,
        isMe ? '800' : '400',
        recX - nameX - 24,
      );
      name.position.set(box.x + nameX, y + 10);
      panel.container.addChild(name);

      const rec = this.label(t('ctl.ladder.wl', { w: e.wins, l: e.losses }), 18, COLOR.muted);
      rec.anchor.set(1, 0);
      rec.position.set(box.x + recX, y + 10);
      panel.container.addChild(rec);

      const rate = this.label(`${winRate(e.wins, e.losses)}%`, 18, COLOR.cream, '700');
      rate.anchor.set(1, 0);
      rate.position.set(box.x + rateX, y + 10);
      panel.container.addChild(rate);
    });

    // 상한 안내는 페이지 이동 줄 왼쪽에 얹는다 — 표와 줄 사이에 따로 한 줄을 쓰면 마지막
    // 행이 밀려 페이저와 겹친다(실화면에서 잡힌 결함).
    const cap = this.label(t('ctl.ladder.cap', { n: LADDER_CAP }), 15, COLOR.muted);
    cap.anchor.set(0, 0.5);
    cap.position.set(box.x, box.bottom - PAGER_H / 2);
    panel.container.addChild(cap);

    this.pager(panel, page, pageCount, (nextPage) => {
      this.ladderPage = Math.max(0, Math.min(pageCount - 1, nextPage));
      this.refresh();
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

  private renderAlertsModal(panel: CinematicPanel): void {
    const box = panel.box;
    const incoming = this.incoming ?? [];
    if (incoming.length === 0) {
      this.emptyWell(panel.container, box, t('ctl.notif.empty'));
      return;
    }

    const now = Date.now();
    const banner = incomingBannerText(this.unseenCount);
    const bounds = rowBounds(
      incoming.map(() => ALERT_ROW_H),
      ALERT_ROW_GAP,
    );
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(box.h, bounds);
    const content = makeScrollArea(panel.container, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: maskH,
      totalH: total,
      get: () => this.modalScrollY,
      set: (v) => {
        this.modalScrollY = v;
      },
    });
    incoming.forEach((inv, i) => {
      const row = this.makeAlertRow(inv, now, box.w, banner.length > 0 && i === 0 ? banner : null);
      row.position.set(0, i * ALERT_PITCH);
      content.addChild(row);
    });
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

  /**
   * 알림 1행 — 결과 문구 + 시각/도발 상세 + 도발·관전 버튼.
   *
   * ⚠️ **높이가 고정이다.** 옛 구현은 문구 줄 수에 따라 행이 자랐는데, 그러면 팝업 높이를
   * 내용에서 역산할 수 없다(빈 자리가 생기거나 마지막 행이 반토막 난다). 문구는 한 줄로
   * 눌러 담고(`label` 의 maxW 축소), 넘치는 정보는 상세 줄이 받는다.
   */
  private makeAlertRow(inv: IncomingInvasion, now: number, w: number, banner: string | null): Container {
    const row = new Container();
    const btnW = 120;
    const btnH = 46;
    row.addChild(rowPlate(w, ALERT_ROW_H, false, inv.attackerWon ? 0x8a4a4a : 0x4a7a4a));

    const buttons: PixiButton[] = [];
    // 방어 성공(격퇴)했고 아직 회신 도발이 없으면 "도발" 버튼(F2 방어자 몫).
    if (inv.invasionId.length > 0 && !inv.attackerWon && inv.defenderSticker === null) {
      buttons.push(
        this.chromeButton({
          tone: 'stone',
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
        this.chromeButton({
          tone: 'blue',
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
    const headIcon = this.stickerIcon(inv.sticker, 28);
    const headX = 14 + (headIcon !== null ? 36 : 0);
    if (headIcon !== null) {
      headIcon.position.set(14, 12);
      row.addChild(headIcon);
    }
    const head = this.label(
      incomingRowText(inv),
      19,
      inv.attackerWon ? BAD_COLOR : 0xa8dda8,
      '700',
      Math.max(60, textW - (headX - 14)),
    );
    head.position.set(headX, 13);
    row.addChild(head);

    // 상대 도발은 `incomingRowText` 가 이미 첫 줄에 붙여 준다 — 여기서 또 적으면 같은 문장이
    // 두 번 나온다. 상세 줄에는 첫 줄에 없는 것(시각·내 회신 도발)만 담는다.
    const details: string[] = [t('ctl.notif.when', { when: relTime(inv.createdAtMs, now) })];
    const mine = stickerLabel(inv.defenderSticker);
    if (mine.length > 0) details.push(t('ctl.notif.mine', { taunt: mine }));
    const subIcon = mine.length > 0 ? this.stickerIcon(inv.defenderSticker, 22) : null;
    const subX = 14 + (subIcon !== null ? 30 : 0);
    if (subIcon !== null) {
      subIcon.position.set(14, 45);
      row.addChild(subIcon);
    }
    const sub = this.label(details.join(' · '), 16, COLOR.muted, '400', Math.max(60, textW - (subX - 14)));
    sub.position.set(subX, 44);
    row.addChild(sub);

    // 미확인 안내는 첫 행 바닥에만 한 줄 얹는다(표 위에 따로 한 줄을 쓰면 역산이 깨진다).
    if (banner !== null) {
      const el = this.label(banner, 15, COLOR.gold, '700', textW - 4);
      el.position.set(14, 76);
      row.addChild(el);
    }

    buttons.forEach((b, i) => {
      b.container.position.set(
        w - 14 - (buttons.length - i) * btnW - (buttons.length - 1 - i) * 10,
        (ALERT_ROW_H - btnH) / 2,
      );
      row.addChild(b.container);
    });
    return row;
  }

  // --- 출격 기체 선택(예비역 소집, ADR-0024) --------------------------------

  /**
   * 출격 기체 선택 팝업. 활성 기체(기본) + 소집 가능한 수호기 목록을 보여 주고, 한 행을 고르면
   * 그 파일럿으로 침공 런을 시작한다(활성=null, 수호기=id). 대기 중인 대상+배치는
   * {@link pendingSortie} 에 보관돼 있고 확정 시 `onInvade` 로 넘어간다. 취소(암막·닫기·Esc)면
   * 관제탑에 그대로 남는다.
   */
  private renderSortieModal(panel: CinematicPanel): void {
    const box = panel.box;
    const profile = this.profile;
    if (profile === null) return;

    // 첫 행 = 활성 기체(id=null, 기본), 이어서 소집 가능한 수호기 각 1행.
    const entries: (GuardianRecord | null)[] = [null, ...this.callupEligible()];
    const bounds = rowBounds(
      entries.map(() => SORTIE_ROW_H),
      SORTIE_ROW_GAP,
    );
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(box.h, bounds);
    const content = makeScrollArea(panel.container, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: maskH,
      totalH: total,
      get: () => this.sortieScrollY,
      set: (v) => {
        this.sortieScrollY = v;
      },
    });
    entries.forEach((g, i) => {
      const row = this.makeSortieRow(g, box.w);
      row.position.set(0, i * SORTIE_PITCH);
      content.addChild(row);
    });
  }

  /**
   * 출격 기체 행 1장. `guardian === null` = 활성 기체(성능 100%·기존 거동), 아니면 소집 수호기
   * (잠긴 빌드의 기체 타입명 · 남은 성능% · 잠긴 장비 수). 행 전체와 우측 출격 버튼이 같은 동작이다.
   */
  private makeSortieRow(guardian: GuardianRecord | null, w: number): Container {
    const profile = this.profile;
    const active = guardian === null;

    let typeId: number;
    let desc: string;
    if (active) {
      const ship = profile !== null ? activeShip(profile) : null;
      typeId = ship?.typeId ?? 0;
      // 활성 기체는 풍화 대상이 아니다(라이브 기체) — 성능 100%. 문구는 sortie.active 에 담겨 있다.
      desc = t('sortie.active');
    } else {
      const build = guardian.build;
      typeId = build?.typeId ?? 0;
      const gearCount =
        build !== undefined ? Object.values(build.equipped).filter((it) => it !== undefined).length : 0;
      const perfVal = guardian.performanceCP / 100;
      const perfPct = Number.isInteger(perfVal) ? String(perfVal) : perfVal.toFixed(1);
      desc = `${t('sortie.guardian')} · ${t('sortie.perf', { n: perfPct })} · ${t('sortie.gear', { n: gearCount })}`;
    }
    const gid = active ? null : guardian.id;

    const row = new Container();
    // 행 전체가 선택(출격) 대상 — 버튼만 아래에서 전파를 끊는다(중복 실행 방지, 대상 목록 규약과 동일).
    attachRowClick(row, () => this.launchSortie(gid));
    // 기본(활성) 행은 금색 링으로 강조한다.
    row.addChild(rowPlate(w, SORTIE_ROW_H, active));

    const textW = Math.max(80, w - 200 - 24 - 16);
    const name = this.label(shipTypeName(shipTypeDef(typeId)), 22, COLOR.cream, '800', textW);
    name.position.set(ROW_PAD, 16);
    row.addChild(name);

    const descEl = this.label(desc, 16, COLOR.muted, '400', textW);
    descEl.position.set(ROW_PAD, 50);
    row.addChild(descEl);

    const btn = this.chromeButton({
      tone: 'gold',
      width: 200,
      height: 56,
      fontSize: 22,
      label: t('sortie.launch'),
      onClick: () => this.launchSortie(gid),
    });
    btn.container.position.set(w - 200 - 16, (SORTIE_ROW_H - 56) / 2);
    stopRowPropagation(btn.container);
    row.addChild(btn.container);

    return row;
  }

  // --- 전투 기록 팝업 ------------------------------------------------------

  private renderHistoryModal(panel: CinematicPanel, px: number, py: number): void {
    const box = panel.box;
    // 필터(전체·공격·방어) + 정렬 토글 — 한 줄에 나란히.
    const chipW = 118;
    const chipGap = 10;
    const filters: readonly [HistoryFilter, string][] = [
      ['all', t('ctl.hist.filter.all')],
      ['attack', t('ctl.hist.filter.attack')],
      ['defense', t('ctl.hist.filter.defense')],
    ];
    filters.forEach(([kind, label], i) => {
      const selected = this.historyFilter === kind;
      const btn = this.chromeButton({
        tone: selected ? 'gold' : 'stone',
        width: chipW,
        height: HIST_FILTER_H,
        fontSize: 18,
        label,
        onClick: () => {
          this.historyFilter = kind;
          this.historyPage = 0;
          this.refresh();
        },
      });
      btn.container.position.set(box.x + i * (chipW + chipGap), box.y);
      panel.container.addChild(btn.container);
    });

    const sort = this.chromeButton({
      tone: 'stone',
      width: 150,
      height: HIST_FILTER_H,
      fontSize: 17,
      label: this.historyNewestFirst ? t('ctl.hist.sort.newest') : t('ctl.hist.sort.oldest'),
      onClick: () => {
        this.historyNewestFirst = !this.historyNewestFirst;
        this.historyPage = 0;
        this.refresh();
      },
    });
    sort.container.position.set(box.x + 3 * (chipW + chipGap) + 14, box.y);
    panel.container.addChild(sort.container);

    this.search.mount(
      this.stage,
      'history',
      { x: px + box.right - SEARCH_W, y: py + box.y, w: SEARCH_W, h: SEARCH_H },
      t('ctl.pop.search'),
      this.historyQuery,
      (v) => {
        this.historyQuery = v;
        this.historyPage = 0;
        this.refresh();
      },
    );

    const listTop = box.y + HIST_FILTER_H + HIST_FILTER_GAP + HIST_SUMMARY_H + HIST_SUMMARY_GAP;
    const restBox = { x: box.x, y: listTop, w: box.w, h: box.bottom - listTop };
    if (this.historyLoading) {
      this.emptyWell(panel.container, restBox, t('ctl.hist.loading'));
      return;
    }
    const all = this.history;
    if (all === null) {
      this.emptyWell(panel.container, restBox, t('ctl.hist.null'));
      return;
    }
    if (all.length === 0) {
      this.emptyWell(panel.container, restBox, t('ctl.hist.empty'));
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
    summary.position.set(box.x, box.y + HIST_FILTER_H + HIST_FILTER_GAP);
    panel.container.addChild(summary);

    const query = this.historyQuery.trim().toLowerCase();
    const rows = all
      .filter((e) =>
        this.historyFilter === 'all' ? true : this.historyFilter === 'attack' ? e.attacking : !e.attacking,
      )
      .filter((e) => (query.length === 0 ? true : this.nameOf(e.opponentId).toLowerCase().includes(query)))
      .slice()
      .sort((a, b) => (this.historyNewestFirst ? b.atMs - a.atMs : a.atMs - b.atMs));
    if (rows.length === 0) {
      this.emptyWell(panel.container, restBox, t('ctl.pop.noMatch'));
      return;
    }

    const sideX = 170;
    const oppX = 290;
    const resX = Math.round(box.w * 0.6);
    const statX = Math.round(box.w * 0.72);
    const specW = 110;
    const specH = 36;
    this.tableHeader(panel, listTop, [
      { label: t('ctl.hist.col.when'), x: 0, anchor: 0 },
      { label: t('ctl.hist.col.side'), x: sideX, anchor: 0 },
      { label: t('ctl.hist.col.opponent'), x: oppX, anchor: 0 },
      { label: t('ctl.hist.col.result'), x: resX, anchor: 0 },
      { label: t('ctl.hist.col.status'), x: statX, anchor: 0 },
    ]);

    const pageCount = Math.max(1, Math.ceil(rows.length / HIST_PAGE));
    const page = Math.min(this.historyPage, pageCount - 1);
    const slice = rows.slice(page * HIST_PAGE, page * HIST_PAGE + HIST_PAGE);
    const rowTop = listTop + TABLE_HEAD_H;
    const now = Date.now();

    slice.forEach((e, i) => {
      const y = rowTop + i * HIST_ROW_H;
      if (i % 2 === 1) {
        const stripe = new Graphics();
        stripe.roundRect(box.x, y, box.w, HIST_ROW_H - 4, 8).fill({ color: 0x000000, alpha: 0.22 });
        panel.container.addChild(stripe);
      }

      const when = this.label(relTime(e.atMs, now), 17, COLOR.muted);
      when.position.set(box.x + 10, y + 11);
      panel.container.addChild(when);

      const side = this.label(
        e.attacking ? t('ctl.hist.side.attack') : t('ctl.hist.side.defense'),
        17,
        e.attacking ? 0xffc98a : 0x9fd0ff,
        '700',
      );
      side.position.set(box.x + sideX, y + 11);
      panel.container.addChild(side);

      const opp = this.label(this.nameOf(e.opponentId), 18, COLOR.cream, '400', resX - oppX - 24);
      opp.position.set(box.x + oppX, y + 10);
      panel.container.addChild(opp);

      const won = historyIWon(e);
      const resultText =
        won === null ? t('ctl.hist.result.pending') : won ? t('ctl.hist.result.win') : t('ctl.hist.result.lose');
      const result = this.label(resultText, 18, won === null ? COLOR.muted : won ? COLOR.gold : BAD_COLOR, '800');
      result.position.set(box.x + resX, y + 10);
      panel.container.addChild(result);

      const statusText =
        e.status === 'verified'
          ? t('ctl.hist.status.verified')
          : e.status === 'rejected'
            ? t('ctl.hist.status.rejected')
            : t('ctl.hist.status.pending');
      const status = this.label(statusText, 16, e.status === 'rejected' ? BAD_COLOR : COLOR.muted);
      status.position.set(box.x + statX, y + 11);
      panel.container.addChild(status);

      // 리플레이는 공격·방어 양쪽 참가자가 읽을 수 있다(RLS) — 어느 행이든 다시 볼 수 있다.
      if (e.invasionId.length > 0) {
        const spec = this.chromeButton({
          tone: 'blue',
          width: specW,
          height: specH,
          fontSize: 16,
          label: t('ctl.notif.spectate'),
          onClick: () => this.onSpectate?.(e.invasionId, this.nameOf(e.opponentId)),
        });
        spec.container.position.set(box.right - specW, y + (HIST_ROW_H - 4 - specH) / 2);
        panel.container.addChild(spec.container);
      }
    });

    this.pager(panel, page, pageCount, (nextPage) => {
      this.historyPage = Math.max(0, Math.min(pageCount - 1, nextPage));
      this.refresh();
    });
  }
}
