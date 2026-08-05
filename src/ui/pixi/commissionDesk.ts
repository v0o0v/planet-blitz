/**
 * 지시 수신소 — 두 번째 PvE 출격구 (의뢰서 시스템 Phase E · 2026-08-03 AAA 시네마틱 전환)
 * · 레인 계약 `.omc/plans/commission-desk-aaa-2026-08-03.md`.
 *
 * 기지 맵에서 진입하는 전체 화면(`main.ts:824 openCommissionDesk()`). **suspend/resume 은
 * 없다** — `show(profile, {onClose, onLaunch})` / `hide()` 규약이고, 형제 화면과 달리
 * **생성자가 `profile` 을 받는다**(`new CommissionDeskScreen(profile, gameApp.stage)`).
 * 공개 인터페이스는 한 줄도 바뀌지 않았다.
 *
 * ---------------------------------------------------------------------------
 * ## 서버 권위 · 봉인 로드아웃 · 런 시작 신호 (전환 전과 동일 — 손대지 않았다)
 * 보유 목록의 정본은 서버 원장(`commission_inventory`)이다. 이 화면은 스냅샷만 읽고, 출격은
 * `consume_commission` RPC 가 확정한다. 미설정/오프라인이면 **온라인 전용** 안내만 내고 출격을
 * 막는다(촉매와 달리 무의뢰 폴백이 없다 — 의뢰서 자체가 서버 원장이다).
 *
 * [출격] 은 `commissionSealedLoadout`(runConfig.ts)으로 **`buildRunConfig` 가 실제 런에 구울
 * 것과 같은 함수·같은 인자**로 로드아웃을 뽑아 `consume_commission` 에 싣는다 — 여기서 다른
 * 방식으로 계산하면 정직한 런도 `commission-loadout-mismatch` 로 거부될 수 있다.
 *
 * 출격 성공 직후 이 화면은 **자기 자신을 닫고** `onLaunch` 만 부른다(성계 지도 self-hide 규약).
 * `hide()` 가 콜백을 비우므로 콜백은 **먼저 캡처**한다.
 *
 * ---------------------------------------------------------------------------
 * ## 시네마틱 전환에서 바뀐 것은 **바탕과 배치**뿐이다
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재), `makeBanner` → `makeHangarTitle`,
 * `listRowBg` → 석재 행 판(`rowPlate`), 단색 배경 → `HangarBackdrop`.
 * 표시 판정(라벨·보상 요약·제약 문구·재고 문구)은 계속 `commissionDeskView.ts`(Pixi 없는 순수
 * 계층)가 소유한다 — 캔버스 스텁은 글자 크기를 실제보다 작게 재서 겹침·문구 판정을 놓친다.
 *
 * ## 왜 여기는 **창을 뚫지 않는가**(챔피언 선택·방어 사령부는 뚫었다)
 * 형제 화면 열의 결론은 "창은 배경이 보이는 구멍이 아니라 **무언가를 보여주는 자리**"였다.
 * 여기서 유일한 후보는 의뢰 대상 **행성**인데 실측하면 `assets/ui_planet_*.png` 는 **64×64**
 * 오브이고 그나마 행성 6종 중 4종만 있다. 상세 패널의 개구부(≈1094×774)에 채우면 17배 확대이고
 * (기록 보관소가 5.4배로 이미 기각했다), 자산 없는 행성을 고르면 **창이 비는 것이 정상**이 된다.
 * 그래서 패널 둘 다 `slab`, 배경 `windows: []`.
 *
 * ## 1열을 버리고 **2열 목록/상세**로 갔다
 * 옛 구현은 1200×830 패널 하나에 **168px 짜리 두꺼운 행**을 쌓고 좌우 720px 을 통째로 비웠다.
 * 행 안에 계급·주문·보상 요약·제약 문구·[출격] 이 전부 있었고 제약 문구 줄 수가 의뢰마다 달라
 * **행 높이를 역산할 수 없었다**. 2열이면 목록 행이 고정 높이로 얇아지고, 상세 열이 **행을 바꿀
 * 때마다 바뀌는 자리**가 되어 오른쪽이 비지 않으며, 가변 길이는 상세 챔버 + 스크롤이 흡수한다.
 *
 * ## 탭을 두지 않는다 · 재화 칩을 두지 않는다
 * 목록이 하나뿐이라 탭 줄을 만들면 칸이 하나인 탭 줄이 되어 죽은 자리가 된다. 그래서 패널이
 * 설정 톱니 예약 밴드 바로 아래({@link GEAR_BAND_H} + 4)에서 시작한다.
 * 그리고 이 화면은 크레딧·광물을 **쓰지 않는다** — 옛 구현의 재화 칩 둘은 형제 화면 복사의
 * 잔재였다. 안 쓰는 화면의 칩은 "그 화면의 결정을 돕지 않는 진입점"이다.
 *
 * ## ⚠️ 이 화면의 **기본 상태는 "보유 0 · 오프라인"이다**
 * 의뢰서는 서버 원장이 정본이고 무의뢰 폴백이 없다 — 미로그인/오프라인이면 목록이 **항상**
 * 비어 있다. 그러니 빈 화면 처방이 예외가 아니라 기본이다: 목록 상자 전체가 **파낸 챔버**
 * ({@link recessedWell})가 되고 그 안에서 안내한다. 상세 열도 같다.
 * ⚠️ {@link fillRowHeights} 는 **늘려만 준다** — 보유 상한(12장)이면 자연 높이 합이 상자를
 * 넘으므로 목록에 스크롤을 붙였고, 상세 챔버도 제약 문구 줄 수가 가변이라 스크롤을 붙였다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거)
 * - ⚠️ **크롬(헤더·하단 띠)은 패널보다 뒤에 붙인다.** Pixi v8 은 자식을 역순으로 훑다가 픽셀에
 *   걸리면 거기서 멈추고 가장 가까운 상호작용 조상을 반환한다 — 그림자 스프라이트가 passive
 *   여도 탐색은 끝난다. 석재 패널은 접지 그림자를 텍스처에 구워 자기 사각보다 30px 가까이
 *   번지므로, 먼저 붙은 크롬은 아래 절반을 통째로 빼앗긴다(방어 사령부 실제 신고).
 * - ⚠️ **`setEnabled(false)` + `gold` 톤 금지.** container alpha 0.4 + 어두운 갈색 라벨 +
 *   그림자 꺼짐이 겹쳐 **글자가 통째로 사라진다**(실화면 확인). 비활성은 크림 라벨인 `stone`
 *   이고, 톤이 바뀌므로 **상태가 바뀔 때만** 버튼을 다시 세운다({@link footBtnKey}).
 * - **행 클릭은 행 Container 에.** 바탕 Graphics 에 걸면 위에 얹힌 텍스트가 클릭을 삼킨다.
 * - **휠은 클립 Container 에.** 마스크 Graphics 는 히트 테스트에서 제외된다.
 * - 컬러 이모지 금지(`text.ts` stripEmoji). `★ ✕ ▶ ◀` 는 보존 목록.
 * - ⚠️ `hudEl()` 에는 **캔버스 가드를 붙이지 않는다**(HUD 숨김이 통째로 죽는다).
 * - ⚠️ 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드**다.
 * - ⚠️ 각인 제목은 중앙 정렬 Text 라 사각형이 없어 겹침 테스트가 못 잡는다 —
 *   {@link TITLE_BAND_HALF_W} 로 대역을 못 박는다.
 *
 * ## 재렌더 규율
 * 옛 구현은 `render()` 가 루트를 통째로 지우고 다시 그렸다 — 행 클릭 한 번, 재고 갱신 한 번마다
 * 배경과 석재 패널이 다시 **구워진다**. 그래서
 *  - `buildChrome()` 은 1회(자산 도착 시에만 재건),
 *  - `syncValues()` 가 재고·상태 문구와 [출격] 버튼 상태를,
 *  - `renderList()`/`renderDetail()` 이 각자 host 안만 갈아끼운다.
 *  - `update(dt)` 는 `main.ts` 가 매 프레임 부른다(`commissionDesk.update(frame)`). 숨겨져
 *    있으면 즉시 반환하므로 이 화면 밖 비용은 0 이다. ⚠️ 연구소가 이 배선을 빠뜨려 배경·패널
 *    연출이 통째로 멈춘 적이 있다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Profile } from '../../save/profile.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';
import { attachRowClick, stopRowPropagation } from './listRow.js';
import { makeScrollArea, rowBounds } from './scrollArea.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import { HELP_HEAD_W, openHelpOverlay, type HelpSpec } from './helpModal.js';
import {
  makeHangarTitle,
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';
import { t, type MessageKey } from '../../i18n/index.js';
import {
  fetchCommissionInventoryOnline,
  consumeCommissionOnServer,
  discardCommissionOnServer,
} from '../../net/index.js';
import type { CommissionInventoryRow } from '../../net/commissionGateway.js';
import type { CommissionPayload } from '../../run/commission.js';
import { commissionSealedLoadout } from '../../run/runConfig.js';
import { COMMISSION_STOCK_CAP } from '../../run/commissionServerConstants.js';
import { planetById } from '../../../data/planets.js';
import {
  commissionGradeLabel,
  commissionOrderLabel,
  commissionRewardSummary,
  commissionConstraintLines,
  commissionEliteNoteFor,
  commissionStockText,
} from './commissionDeskView.js';

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

// ===========================================================================
// 레이아웃(디자인 스페이스 1920×1080) — Pixi 없이 검증되는 순수 서술
//
// 여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 격납고·촉매 보관함·예비역 로스터·
// 챔피언 선택·연구소·정제소·방어 사령부·관제탑·기록 보관소와 **같은 값**이다.
// ===========================================================================

/**
 * `cinematicPanel.ts` 콘텐츠 상자 기하의 **복제본**(출처: 그 파일의 `EDGE_PAD 24` ·
 * `CONTENT_GAP 16` · `TITLE_BAND_H = round(TITLE_SIZE 26 × 2)`).
 *
 * 왜 베끼는가: 좌표 서술이 **Pixi 없이** 검증돼야 하는데 패널 상자는 런타임 객체다. 베낀 값이
 * 조용히 어긋나면 내용이 패널 테두리를 뚫는데 예외도 로그도 없다 —
 * `tests/commissionDeskAaaLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조한다.
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

/** 하단 액션 띠 — 오른쪽에 [출격], 왼쪽은 재고·상태 문구가 쓴다(빈 자리 0). */
const FOOT_H = 64;
const FOOT_Y = DESIGN_HEIGHT - BOTTOM_PAD - FOOT_H;
const LAUNCH_W = 320;
const FOOT_BTN_X = EDGE_X + CONTENT_W - LAUNCH_W;
/**
 * [폐기]는 [출격] **왼쪽**에 붙는다(2026-08-03). 파괴적 동작을 주 동작 오른쪽에 두면 눌러야 할
 * 것 옆에 되돌릴 수 없는 것이 오고, 오른쪽 끝은 손이 먼저 가는 자리다. 폭도 일부러 좁게 잡아
 * 시각 무게를 낮춘다 — 이 화면의 주 동작은 출격이지 폐기가 아니다.
 */
const DISCARD_W = 200;
const FOOT_BTN_GAP = 16;
const DISCARD_X = FOOT_BTN_X - FOOT_BTN_GAP - DISCARD_W;

/**
 * 패널 줄 상단. 헤더 밴드(104) 바로 아래가 아니라 **{@link GEAR_BAND_H}(120) 아래**다 —
 * 목록 패널이 화면 좌측 끝(x 32)에서 시작하므로 설정 톱니 예약 밴드와 가로로 겹치고, 세로로
 * 몇 px 만 물려도 톱니가 매 프레임 맨 앞으로 올라와 그 자리를 통째로 삼킨다(테스트가 잠근다).
 */
const PANEL_Y = GEAR_BAND_H + 4;
const PANEL_TO_FOOT = 16;
/** 패널 세로는 **남는 자리 전부**다(빈 자리 금지 — 하드코딩하면 여백을 바꿀 때 어긋난다). */
const PANEL_H = FOOT_Y - PANEL_TO_FOOT - PANEL_Y;

const LIST_X = EDGE_X;
const LIST_W = 720;
const DETAIL_X = LIST_X + LIST_W + GUTTER_X;
const DETAIL_W = DESIGN_WIDTH - EDGE_X - DETAIL_X;

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

const BOX_L = titledBox(LIST_W, PANEL_H);
const BOX_D = titledBox(DETAIL_W, PANEL_H);

// --- 헤더 컨트롤(형제 화면과 **같은 x**) ---
const CLOSE_W = 56;
const CLOSE_X = DESIGN_WIDTH - EDGE_X - CLOSE_W;
/** 도움말 버튼 — 닫기 왼쪽(여섯 화면 공통 자리 · {@link HELP_HEAD_W} 주석). */
const HELP_X = CLOSE_X - 12 - 2 - HELP_HEAD_W;

/** 지시 수신소 도움말 절 목록. 기구는 공용 모듈이 쥔다 — 여기서는 무엇을 말할지만 정한다. */
export const DESK_HELP: HelpSpec = {
  prefix: 'commission.help',
  sections: ['s1', 's2', 's3', 's4', 's5'],
};

/**
 * 각인 제목이 실제로 차지하는 가로 반폭. 중앙 정렬 Text 는 사각형이 없어 겹침 테스트가 못
 * 잡는다 — 연구소 실화면에서 제목이 헤더 버튼과 **실제로 겹쳤다**. 대역을 상수로 못 박고
 * 좌우 컨트롤이 이 안에 들어오지 못하게 테스트로 잠근다.
 */
export const TITLE_BAND_HALF_W = 280;

/** 석재 슬래브 위 **보조 텍스트색**(정제소 `SLAB_BODY_FILL` 복제 — 그 파일은 화면이다). */
const SLAB_BODY_FILL = 0xe4dac7;
/** 행 판 바탕색·홈·반경 — 예비역 로스터 `rowPlate` → … → 기록 보관소 경유 복제. */
const ROW_FACE = 0x3b3327;
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;
/** 제약·오류 문구색(옛 구현에서 그대로 승계 — 이 화면의 "주의" 색이다). */
const WARN_FILL = 0xff9a7a;

// --- 목록/상세 기하 ---
const ROW_GAP = 10;
const ROW_PAD = 16;

/** 의뢰 행 — 1줄 `계급 · 주문`, 2줄 `N개 무대 · 크레딧 +X`. 나머지는 상세 열이 말한다. */
const ROW_H = 76;
const ROW_MAX_H = 120;
/**
 * 목록 **꼬리 챔버**의 최소 세로.
 *
 * ⚠️ 이 화면에만 있는 문제다: 형제 화면들은 목록 길이가 데이터로 고정(파일럿 7 · 파편 8)이라
 * {@link fillRowHeights} 만으로 상자가 채워졌는데, **보유 의뢰서는 0..12 장으로 변한다.**
 * 1~5장이면 행이 상한(120)에 먼저 걸려 목록 상자에 최대 626px 가 통째로 남는다 — 단위 테스트가
 * 실제로 잡았다(`1장에서 목록에 빈 면이 남는다: 636`). 그 자리를 **파낸 챔버로 이름 지어**
 * "여기 더 쌓인다"를 말하게 한다(빈 면이 아니라 비어 있는 자리가 된다).
 */
const TAIL_MIN_H = 96;

/** 목록 행 오른쪽의 보상 요약이 먹는 폭 — 행 왼쪽 글자 폭이 여기서 파생된다. */
const ROW_REWARD_W = 200;

/** 상세 챔버 넷(개요 · 무대 · 확정 보상 · 제약)이 남는 세로를 나눠 갖는다. */
const CHAMBER_MAX_H = 240;
/** 챔버가 최소한 담아야 하는 세로(머리글 + 본문 두 줄) — 열 폭 하한을 되짚는 값이다. */
const CHAMBER_MIN_H = 96;
const DETAIL_CHAMBERS = 4;
/**
 * 챔버 안 **머리글 열**의 폭. 머리글을 본문 위에 얹지 않고 왼쪽에 세우는 이유: 상세 열이
 * 1060px 인데 본문은 한두 줄짜리 짧은 문구라, 위아래로 쌓으면 오른쪽 700px 가 통째로 빈다
 * (실화면 1차 확인 2026-08-03). 왼쪽 라벨 + 오른쪽 값은 **지시서**가 실제로 읽히는 형태이기도 하다.
 */
const CHAMBER_HEAD_W = 220;
const CHAMBER_HEAD_GAP = 24;

/**
 * 폐기 확인 팝업(2026-08-03). 높이는 **내용에서 역산**한다 — 제목 띠 52 + 간격 16 = 상자 y 68,
 * 그 아래 이름 한 줄(≈48) + 본문 두 줄(≈60) + 숨 52 + 버튼 64 + 아래 여백 24.
 * 관제탑 시네마틱 팝업과 같은 방식이다(고정 높이를 적으면 문구가 길어질 때 조용히 뚫린다).
 */
const MODAL_W = 760;
const MODAL_H = 320;
const MODAL_X = Math.round((DESIGN_WIDTH - MODAL_W) / 2);
const MODAL_Y = Math.round((DESIGN_HEIGHT - MODAL_H) / 2);
const MODAL_BTN_W = 300;
const MODAL_BTN_H = 64;

/** 화면 좌표 사각형(디자인 스페이스). */
export interface DeskRect {
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
 *
 * ⚠️ **인자를 받지 않는 것 자체가 계약**이다 — 보유 수·선택 상태로 기하가 갈리면 조작 한 번마다
 * 배경과 석재를 다시 구워야 한다.
 */
export function commissionDeskLayout(): {
  readonly screen: DeskRect;
  readonly headerH: number;
  readonly panels: readonly { readonly id: string; readonly rect: DeskRect }[];
  readonly footer: { readonly band: DeskRect; readonly buttons: readonly DeskRect[] };
  readonly headerControls: readonly { readonly id: string; readonly rect: DeskRect }[];
  /** 배경이 보존되는 창 — **없다**(파일 헤더 "왜 여기는 창을 뚫지 않는가"). */
  readonly windows: readonly DeskRect[];
} {
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels: [
      { id: 'list', rect: { x: LIST_X, y: PANEL_Y, w: LIST_W, h: PANEL_H } },
      { id: 'detail', rect: { x: DETAIL_X, y: PANEL_Y, w: DETAIL_W, h: PANEL_H } },
    ],
    footer: {
      band: { x: EDGE_X, y: FOOT_Y, w: CONTENT_W, h: FOOT_H },
      // 왼쪽→오른쪽 순서다(폐기 · 출격). 파괴적 동작이 주 동작 오른쪽에 오면 안 된다.
      buttons: [
        { x: DISCARD_X, y: FOOT_Y, w: DISCARD_W, h: FOOT_H },
        { x: FOOT_BTN_X, y: FOOT_Y, w: LAUNCH_W, h: FOOT_H },
      ],
    },
    headerControls: [
      { id: 'help', rect: { x: HELP_X, y: HEAD_Y, w: HELP_HEAD_W, h: HEAD_H } },
      { id: 'close', rect: { x: CLOSE_X, y: HEAD_Y, w: CLOSE_W, h: HEAD_H } },
    ],
    windows: [],
  };
}

/** 패널 콘텐츠 상자와 그 안의 고정 블록(단위 테스트가 실제 패널 상자와 대조한다). */
export const DESK_BOXES = {
  list: { x: BOX_L.x, y: BOX_L.y, w: BOX_L.w, h: BOX_L.h, bottom: BOX_L.bottom },
  detail: { x: BOX_D.x, y: BOX_D.y, w: BOX_D.w, h: BOX_D.h, bottom: BOX_D.bottom },
  rowGap: ROW_GAP,
  rowH: ROW_H,
  rowMaxH: ROW_MAX_H,
  /** 목록 행에서 좌우 여백·보상 요약이 먹고 남는 글자 폭 — 하한이 있어야 주문명이 안 뭉개진다. */
  rowTextW: BOX_L.w - ROW_PAD * 2 - ROW_REWARD_W,
  rowRewardW: ROW_REWARD_W,
  chamberMaxH: CHAMBER_MAX_H,
  chamberMinH: CHAMBER_MIN_H,
  chambers: DETAIL_CHAMBERS,
  chamberHeadW: CHAMBER_HEAD_W,
  /** 상세 챔버 안 **본문** 글줄 폭(머리글 열 오른쪽 — 무대·제약 문구가 여기서 접힌다). */
  chamberTextW: BOX_D.w - ROW_PAD * 2 - 8 - CHAMBER_HEAD_W - CHAMBER_HEAD_GAP,
  stockCap: COMMISSION_STOCK_CAP,
} as const;

/**
 * 남는 세로를 행에 **고르게 나눈** 새 높이 배열(순수 함수 — Pixi 미의존).
 *
 * 넘치면(스크롤이 붙으면) 입력 그대로 돌려준다. 반올림 잔여는 **행 수 미만**이다.
 *
 * ⚠️ **상한은 늘리기만 막는다. 자연 높이를 깎지 않는다.** `Math.min(maxH, h + add)` 만 쓰면
 * 자연 높이가 상한보다 큰 행이 **줄어들어** 내용이 판 밖으로 삐져나온다 — 바탕 판은 최종
 * 높이로 그려지는데 글자는 이미 자연 높이만큼 자라 있기 때문이다(코어 모듈 화면의 같은 산술
 * 복제본에서 실제로 터졌다). 그래서 `Math.max(h, ...)` 로 감싼다.
 * (기록 보관소 `fillRowHeights` 복제 — 그 파일은 공용 모듈이 아니라 화면이다.)
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
  return heights.map((h) => Math.max(h, Math.min(maxH, h + add)));
}

/**
 * 목록 열의 세로 배분 — 행 높이들과 **꼬리 챔버** 높이(0 이면 없음). 순수 함수라 Pixi 없이
 * 검증된다.
 *
 * 보유 수가 적으면 행이 상한에 먼저 걸려 상자 아래가 통째로 빈다({@link TAIL_MIN_H} 참조).
 * 남는 자리를 꼬리 챔버가 **전부** 받으므로, 어느 보유 수에서도 목록에 이름 없는 빈 면이
 * 행 수보다 크게 남지 않는다(테스트가 그것을 등호에 가깝게 잠근다).
 */
export function listFill(count: number): { heights: number[]; tailH: number } {
  const avail = BOX_L.h;
  if (count <= 0) return { heights: [], tailH: avail };
  const heights = fillRowHeights(
    Array.from({ length: count }, () => ROW_H),
    ROW_GAP,
    avail,
    ROW_MAX_H,
  );
  const used = heights.reduce((a, b) => a + b, 0) + ROW_GAP * (count - 1);
  const rest = avail - used - ROW_GAP;
  return { heights, tailH: rest >= TAIL_MIN_H ? rest : 0 };
}

// --- 행 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 행 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
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
 * **선은 긋지 않는다.** 행 사이 구분은 이 그림자와 행 간격이 만든다. 선택은 금색 링이 말한다.
 */
function rowPlate(w: number, h: number, selected: boolean): Container {
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

  if (selected) root.addChild(selectionRing(0, 0, w, h, ROW_RADIUS));
  return root;
}

/** 선택 표식 — 금색 링 하나. 히트 테스트에서 빠져야 행 클릭을 삼키지 않는다. */
function selectionRing(x: number, y: number, w: number, h: number, radius: number): Graphics {
  const ring = new Graphics();
  ring
    .roundRect(x, y, w, h, radius)
    .stroke({ color: COLOR.gold, width: 3, alignment: 1, alpha: 0.95 });
  ring.eventMode = 'none';
  return ring;
}

/**
 * **파낸 면** 한 장(상세 챔버 · 빈 자리가 공유한다). 볼록한 {@link rowPlate} 와 조명 부호가
 * 정확히 반대다: 위가 그늘이고 **아래 입술만** 빛을 받는다. 이 부호가 뒤집히면 파인 자리가
 * 아니라 얹어 놓은 판때기로 읽힌다.
 * (정제소 `recessedWell` → … → 기록 보관소 경유 복제 — 그 파일들은 화면이지 공용 모듈이 아니다.)
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

/** 무대 한 줄 — `행성명 · 침략 N단계`. 행성명 정본은 `data/planets.ts` 레지스트리다. */
function segmentLine(planet: number, stage: number): string {
  return t('commission.stageLine', { name: planetById(planet).name, stage });
}

export class CommissionDeskScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private art: HangarTextures = {};

  private profile: Profile;
  private cb: CommissionDeskCallbacks | null = null;

  private inventory: CommissionInventoryRow[] = [];
  /** 선택된 의뢰서(상세 열이 보여 주는 것 · [출격] 이 소비하는 것). */
  private selectedId: string | null = null;
  private listScrollY = 0;
  private detailScrollY = 0;
  private hint = '';
  /** 서버 왕복이 가능한 세션인가(미설정/오프라인이면 false — 의뢰서는 무의뢰 폴백이 없다). */
  private online = false;
  /** 출격 서버 왕복 중 재진입(동시 클릭) 가드. */
  private busy = false;

  /** 진입 전 런 HUD 의 visibility — 닫을 때 **원래 값으로** 되돌린다(무조건 '' 금지). */
  private hudPrevVisibility: string | null = null;

  // --- 크롬(1회 조립) ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  private chromeBuilt = false;
  /** 화면 안내 팝업 — 열림 여부 · 스크롤 위치 · 그릇 · 패널(수명 관리용). */
  private helpOpen = false;
  private helpScroll = 0;
  private helpHost: Container | null = null;
  private helpPanel: CinematicPanel | null = null;
  private listHost: Container | null = null;
  private detailHost: Container | null = null;
  private footHost: Container | null = null;
  private stockNode: Text | null = null;
  private statusNode: Text | null = null;
  private launchBtn: PixiButton | null = null;
  private discardBtn: PixiButton | null = null;
  /**
   * 폐기 확인 팝업(열려 있으면 non-null). **크롬이 아니라 그때그때 세운다** — 상태가 아니라
   * 사건이고, 안 열려 있을 때 화면에 아무 흔적도 남기지 않아야 뒤 컨트롤의 클릭을 안 훔친다.
   */
  private discardModal: Container | null = null;
  /**
   * [출격] 버튼을 **다시 세워야 하는가**를 판정하는 키. 활성/비활성은 톤이 갈리고
   * (`gold` ↔ `stone`) 톤은 텍스처를 바꾸므로 갱신으로는 안 된다 — 그렇다고 매 갱신마다
   * 다시 세우면 누를 때마다 텍스처가 다시 붙는다. 상태가 **바뀔 때만** 세운다.
   */
  private footBtnKey = '';

  constructor(profile: Profile, stage: Container) {
    this.profile = profile;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // 배경 텍스처 비동기 로드 — 완료 후 열려 있으면 크롬을 다시 세운다(구운 텍스처가 바뀌므로
    // 갱신으로는 안 된다). ⚠️ 나무 UI 킷(`loadUiTextures`)은 **더 이상 부르지 않는다** — 이
    // 화면의 모든 크롬이 절차적 석재(`cinematicButtonTexture`·`makeCinematicPanel`)로 바뀌어
    // 쓰는 자산이 하나도 없다. 남겨 두면 진입할 때마다 안 쓰는 아틀라스를 디코드한다.
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
  }

  show(profile: Profile, cb: CommissionDeskCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.hint = '';
    this.listScrollY = 0;
    this.detailScrollY = 0;

    // 팝업은 사건이지 상태다 — 재진입할 때 열려 있으면 안 된다(닫지 않고 화면을 벗어나는
    // 경로가 실제로 있다: 출격 성공 self-hide · 하네스 goto).
    this.closeDiscardConfirm();
    this.buildChrome();
    this.refresh();
    this.root.visible = true;
    this.raise();
    this.hideRunHud();
    void this.refreshInventory();
  }

  hide(): void {
    this.closeDiscardConfirm();
    this.root.visible = false;
    this.cb = null;
    this.restoreRunHud();
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  /** `hide()` 가 콜백을 비우므로 **먼저 캡처**한다(형제 화면과 같은 순서 계약). */
  private close(): void {
    const cb = this.cb;
    this.hide();
    cb?.onClose();
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

  /** 원래 값으로 되돌린다 — 무조건 `''` 로 되살리면 런 중 HUD 상태를 덮어쓴다. */
  private restoreRunHud(): void {
    const el = this.hudEl();
    if (el !== null && this.hudPrevVisibility !== null) el.style.visibility = this.hudPrevVisibility;
    this.hudPrevVisibility = null;
  }

  // --- 서버 -----------------------------------------------------------------

  private async refreshInventory(): Promise<void> {
    const rows = await fetchCommissionInventoryOnline();
    this.online = rows !== null;
    this.inventory = rows ?? [];
    // 선택이 사라졌으면(소비·만료) 첫 항목으로 되돌린다 — 상세 열이 비지 않게.
    if (this.selectedRow() === undefined) {
      this.selectedId = this.inventory[0]?.commissionId ?? null;
    }
    if (this.root.visible) this.refresh();
  }

  private selectedRow(): CommissionInventoryRow | undefined {
    const id = this.selectedId;
    if (id === null) return undefined;
    return this.inventory.find((r) => r.commissionId === id);
  }

  /**
   * 출격(계약 §5-2) — 봉인 로드아웃을 계산해 `consume_commission` 을 부른다. 성공하면 **이
   * 화면을 먼저 닫고** `onLaunch` 를 호출한다(성계 지도 self-hide 규약). 실패는 서버 예외
   * 메시지를 그대로 안내한다(고정 매핑표를 만들지 않는다).
   *
   * ⚠️ `commissionSealedLoadout` 은 `buildRunConfig` 와 **같은 함수·같은 인자**여야 한다 —
   * 여기서 다르게 계산하면 정직한 런도 `commission-loadout-mismatch` 로 거부된다.
   */
  private async launch(row: CommissionInventoryRow): Promise<void> {
    if (this.busy) return;
    const cb = this.cb;
    if (cb === null) return;
    this.busy = true;
    this.hint = '';
    this.refresh();
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
      if (this.root.visible) this.refresh();
    }
  }

  /**
   * 폐기(2026-08-03) — `discard_commission` RPC. **확인 팝업을 통과한 뒤에만** 불린다.
   *
   * ## 왜 이 기능이 필요한가
   * 보관 상한(12)이 차면 **새 의뢰서가 발령되지 않는데**(`issue_commission_for_run` 4단계),
   * 그 상한을 내리는 방법이 지금까지 출격 하나뿐이었다. 원치 않는 저계급 의뢰가 12칸을 물면
   * 보스를 아무리 잡아도 아무것도 안 들어오고, 발령은 **조용히 스킵**되므로 화면 어디에도
   * 이유가 안 적힌다.
   *
   * ## 규율
   * - 성공해도 **목록을 손으로 깎지 않는다** — 원장을 다시 읽는다(`refreshInventory`).
   *   감산하면 서버와 갈리는 두 번째 진실이 생기고, 갈리는 날 화면이 어느 쪽인지 못 말한다.
   * - 출격과 **같은 `busy` 가드**를 공유한다(둘 다 원장 왕복이다).
   * - 거부는 서버 예외 메시지를 그대로 안내한다(고정 매핑표를 만들지 않는다).
   */
  private async discard(row: CommissionInventoryRow): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.hint = '';
    this.refresh();
    try {
      const res = await discardCommissionOnServer(row.commissionId);
      if (res.status === 'ok') {
        // 지워진 것이 선택돼 있었으므로 선택을 비운다 — `refreshInventory` 가 첫 항목을 다시 고른다.
        this.selectedId = null;
        this.listScrollY = 0;
        this.detailScrollY = 0;
        return;
      }
      this.hint = res.status === 'unconfigured' ? t('commission.offline') : res.reason;
    } finally {
      this.busy = false;
      // ⚠️ 성공이든 실패든 **원장을 다시 읽는다.** 실패해도 다시 읽는 이유는 "의뢰서 없음"
      // 거부가 곧 "누군가 이미 지웠다"이기 때문이다 — 그때 화면에 남아 있으면 유령 행이 된다.
      if (this.root.visible) void this.refreshInventory();
    }
  }

  // --- 폐기 확인 팝업 -------------------------------------------------------

  /**
   * 되돌릴 수 없는 조작이므로 **확인을 받는다.** 팝업은 이 파일 안에서 시네마틱으로 세운다 —
   * `makeModal`(나무)은 다른 화면 다섯이 쓰고 있어 고치면 그쪽이 함께 바뀐다.
   *
   * `modal.ts` 헤더가 실측으로 남긴 규칙 셋을 그대로 승계한다:
   *  ① 암막은 **불투명**해야 한다(뒤 화면이 비치면 팝업이 떠 있는지 안 떠 있는지 안 읽힌다).
   *  ② 암막이 **이벤트를 먹어야** 한다(안 먹으면 뒤 목록이 계속 눌린다).
   *  ③ 패널 안쪽 탭은 **전파를 끊어야** 한다(안 끊으면 패널을 눌러도 암막이 받아 닫힌다).
   * 암막 알파는 뒤 화면 밝기마다 다르다 — 이 화면은 석재 패널 둘이 화면을 거의 덮어 밝으므로
   * 방어 사령부·관제탑과 같은 0.99 를 쓴다.
   */
  private openDiscardConfirm(row: CommissionInventoryRow): void {
    if (this.discardModal !== null) return;
    const { payload } = row;

    const modal = new Container();
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: 0.99 });
    scrim.eventMode = 'static';
    modal.addChild(scrim);

    const panel = makeCinematicPanel({
      width: MODAL_W,
      height: MODAL_H,
      variant: 'slab',
      title: t('commission.discard.title'),
      screenX: MODAL_X,
      screenY: MODAL_Y,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(MODAL_X, MODAL_Y);
    // ③ 패널 안쪽 탭이 암막까지 올라가지 않게 끊는다.
    stopRowPropagation(panel.container);
    modal.addChild(panel.container);
    this.panels.push(panel);

    const box = titledBox(MODAL_W, MODAL_H);
    const innerW = box.w - 32;

    // 무엇을 버리는지 이름으로 말한다 — "이 의뢰서"만 쓰면 잘못 고른 것을 확인할 수가 없다.
    const what = this.wrapped(
      `${commissionGradeLabel(payload.grade)}  ·  ${commissionOrderLabel(payload.order)}`,
      24,
      COLOR.gold,
      innerW,
      '800',
      34,
    );
    what.anchor.set(0.5, 0);
    what.position.set(MODAL_W / 2, box.y + 4);
    panel.container.addChild(what);

    const body = this.wrapped(t('commission.discard.body'), 19, SLAB_BODY_FILL, innerW, '400', 30);
    body.anchor.set(0.5, 0);
    body.position.set(MODAL_W / 2, box.y + 52);
    panel.container.addChild(body);

    const btnY = box.bottom - MODAL_BTN_H;
    const cancel = this.chromeButton({
      tone: 'stone',
      width: MODAL_BTN_W,
      height: MODAL_BTN_H,
      fontSize: 21,
      label: t('commission.discard.cancel'),
      onClick: () => this.closeDiscardConfirm(),
    });
    cancel.container.position.set(box.x, btnY);
    panel.container.addChild(cancel.container);

    const confirm = this.chromeButton({
      tone: 'red',
      width: MODAL_BTN_W,
      height: MODAL_BTN_H,
      fontSize: 21,
      label: t('commission.discard.confirm'),
      onClick: () => {
        this.closeDiscardConfirm();
        void this.discard(row);
      },
    });
    confirm.container.position.set(box.right - MODAL_BTN_W, btnY);
    panel.container.addChild(confirm.container);

    // ② 암막이 이벤트를 먹되, 암막 자체를 눌러 닫는 것은 **막는다** — 파괴적 팝업에서 바깥 탭
    //    닫기는 "취소"와 "실수로 닫힘"을 구분하지 못하게 만든다. 닫는 길은 [취소] 하나다.
    this.root.addChild(modal);
    this.discardModal = modal;
  }

  private closeDiscardConfirm(): void {
    const modal = this.discardModal;
    if (modal === null) return;
    this.discardModal = null;
    // 팝업 패널도 `update(dt)` 대상 목록에 들어 있었으므로 함께 빼야 파괴된 객체를 매 프레임
    // 건드리지 않는다(빠뜨리면 팝업을 한 번 연 뒤부터 프레임마다 조용히 죽은 참조를 민다).
    const live: CinematicPanel[] = [];
    for (const p of this.panels) {
      if (modal.children.includes(p.container)) p.destroy();
      else live.push(p);
    }
    this.panels = live;
    this.root.removeChild(modal);
    modal.destroy({ children: true });
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
    lineHeight?: number,
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
        ...(lineHeight === undefined ? {} : { lineHeight }),
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
    onClick: () => void;
  }): PixiButton {
    return new PixiButton({
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
  }

  /**
   * 비어 있는 자리를 **파낸 챔버**로 그리고 그 안에서 안내한다. "빈 패널 면"이 아니라 "비어
   * 있는 챔버"가 되면 그 자리가 쓸모도 볼거리도 아닌 자리이기를 멈춘다(정제소 처방).
   *
   * ⚠️ 이 화면에서는 **예외가 아니라 기본 경로**다 — 의뢰서는 서버 원장이 정본이라 미로그인·
   * 오프라인이면 목록이 항상 비어 있다.
   */
  private emptyWell(
    host: Container,
    box: { x: number; y: number; w: number; h: number },
    text: string,
  ): void {
    host.addChild(recessedWell(box.x, box.y, box.w, box.h));
    const el = this.wrapped(text, 19, SLAB_BODY_FILL, Math.max(80, box.w - 96), '400', 30);
    el.anchor.set(0.5, 0.5);
    el.position.set(box.x + box.w / 2, box.y + box.h / 2);
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
    this.helpPanel?.destroy();
    this.helpPanel = null;
    this.helpHost = null;
    this.backdrop?.destroy();
    this.backdrop = null;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.listHost = null;
    this.detailHost = null;
    this.footHost = null;
    this.stockNode = null;
    this.statusNode = null;
    this.launchBtn = null;
    this.discardBtn = null;
    this.discardModal = null;
    this.footBtnKey = '';
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
     * 석재 패널은 접지 그림자·글로우를 텍스처에 구워 넣어 **자기 사각보다 30px 가까이 번지고**,
     * 그 번짐이 위 컨트롤을 덮었다. Pixi v8 은 자식을 역순으로 훑다가 **픽셀에 걸리면 거기서
     * 멈추고 가장 가까운 상호작용 조상**을 반환하므로 그림자가 passive 여도 탐색은 끝난다.
     * ⚠️ 여백을 벌리는 것으로는 못 푼다 — 번짐 폭은 패널 치수에서 파생돼 조용히 커진다.
     */
    const listPanel = this.addPanel(LIST_X, PANEL_Y, LIST_W, PANEL_H, t('commission.list.head'));
    const detailPanel = this.addPanel(
      DETAIL_X,
      PANEL_Y,
      DETAIL_W,
      PANEL_H,
      t('commission.detail.head'),
    );

    const listHost = new Container();
    listPanel.container.addChild(listHost);
    this.listHost = listHost;
    const detailHost = new Container();
    detailPanel.container.addChild(detailHost);
    this.detailHost = detailHost;

    // 크롬은 여기서부터 — 패널 위에 얹힌다(바로 위 주석이 근거).
    this.buildHeader();
    this.buildFooter();

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
   * ⚠️ **재화 칩은 두지 않는다.** 이 화면은 크레딧·광물을 쓰지 않는다(의뢰서는 보스 처치로
   * 얻고 출격은 무료다) — 옛 구현의 칩 둘은 형제 화면 복사의 잔재였다. 안 쓰는 화면에 얹는 것은
   * "그 화면의 결정을 돕지 않는 진입점"이다. ⚠️ 좌측은 **비워 둔다**(설정 톱니 예약 밴드).
   */
  private buildHeader(): void {
    const title = makeHangarTitle(t('commission.title'));
    title.position.set(DESIGN_WIDTH / 2, HEAD_Y - 4);
    this.root.addChild(title);

    const close = this.chromeButton({
      tone: 'stone',
      width: CLOSE_W,
      height: HEAD_H,
      fontSize: 22,
      // 컬러 이모지는 Pixi 에서 두부가 된다(`text.ts` stripEmoji) — U+2715 는 흑백 글리프다.
      label: '✕',
      onClick: () => this.close(),
    });
    close.container.position.set(CLOSE_X, HEAD_Y);
    this.root.addChild(close.container);

    // 도움말 — 닫기와 **같은 세로 띠**를 쓰고 가로로만 자리를 잡는다.
    const help = this.chromeButton({
      tone: 'stone',
      width: HELP_HEAD_W,
      height: HEAD_H,
      fontSize: 20,
      label: t('commission.help'),
      onClick: () => this.openHelp(),
    });
    help.container.position.set(HELP_X, HEAD_Y);
    this.root.addChild(help.container);

    // 도움말 팝업 그릇 — 항상 맨 위에 뜬다.
    const helpHost = new Container();
    this.root.addChild(helpHost);
    this.helpHost = helpHost;
  }

  /** 화면 안내 팝업 — 읽기 전용이라 의뢰서를 건드리지 않는다. */
  private openHelp(): void {
    this.helpOpen = true;
    this.helpScroll = 0;
    this.refresh();
  }

  private closeHelp(): void {
    this.helpOpen = false;
    this.refresh();
  }

  /** 도움말 팝업을 다시 그린다. 기구는 공용 모듈이 통째로 쥔다(암막+패널+내용). */
  private renderHelp(): void {
    const host = this.helpHost;
    if (host === null) return;
    this.helpPanel?.destroy();
    this.helpPanel = null;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
    if (!this.helpOpen) return;
    this.root.setChildIndex(host, this.root.children.length - 1);
    this.helpPanel = openHelpOverlay(host, {
      spec: DESK_HELP,
      get: () => this.helpScroll,
      set: (v) => {
        this.helpScroll = v;
      },
      onClose: () => this.closeHelp(),
    });
  }

  /**
   * 하단 액션 띠 — 왼쪽 **두 줄**(재고 `보유 N/12` · 상태 문구), 오른쪽 [폐기] [출격].
   *
   * 옛 구현은 재고 문구가 패널 안 우상단, 오류 힌트가 화면 맨 아래 중앙에 떠 있었다. 둘을 여기로
   * 모아 띠 왼쪽을 채운다 — 띠 안에 빈 자리가 없다. 상태 문구는 오류가 있으면 오류, 없으면
   * 부제(`commission.sub`)다.
   */
  private buildFooter(): void {
    const host = new Container();
    this.root.addChild(host);
    this.footHost = host;

    const textW = DISCARD_X - EDGE_X - 24;
    const stock = this.label('', 19, COLOR.gold, '700', textW);
    stock.anchor.set(0, 0.5);
    stock.position.set(EDGE_X, FOOT_Y + FOOT_H / 2 - 13);
    host.addChild(stock);
    this.stockNode = stock;

    const status = this.label('', 17, COLOR.muted, '400', textW);
    status.anchor.set(0, 0.5);
    status.position.set(EDGE_X, FOOT_Y + FOOT_H / 2 + 13);
    host.addChild(status);
    this.statusNode = status;
  }

  /**
   * [출격] 버튼을 **상태가 바뀔 때만** 다시 세운다.
   *
   * ⚠️ **`setEnabled(false)` + `gold` 톤 금지** — container alpha 0.4 + 어두운 갈색 라벨 +
   * 그림자 꺼짐이 겹쳐 글자가 통째로 사라진다(실화면 확인). 비활성은 크림 라벨인 `stone` 이다.
   * 톤은 텍스처를 바꾸므로 갱신으로 못 하고, 그렇다고 매 갱신마다 세우면 조작 한 번마다 다시
   * 붙는다 — 그래서 (활성 여부 + 라벨) 키가 바뀔 때만 세운다.
   */
  private syncLaunchButton(): void {
    const host = this.footHost;
    if (host === null) return;
    const enabled = this.canLaunch();
    const label = this.busy ? t('commission.launching') : t('commission.launch');
    // 폐기 버튼도 같은 키에 접는다 — 활성 조건이 같아서(온라인 · 선택 있음 · 왕복 중 아님)
    // 따로 두면 키가 둘로 갈리고, 갈린 키는 언젠가 한쪽만 갱신되는 자리가 된다.
    const key = `${enabled ? '1' : '0'}|${label}`;
    if (key === this.footBtnKey && this.launchBtn !== null) return;
    this.footBtnKey = key;

    for (const old of [this.launchBtn, this.discardBtn]) {
      if (old === null) continue;
      host.removeChild(old.container);
      old.container.destroy({ children: true });
    }
    const btn = this.chromeButton({
      tone: enabled ? 'gold' : 'stone',
      width: LAUNCH_W,
      height: FOOT_H,
      fontSize: 22,
      label,
      onClick: () => {
        const row = this.selectedRow();
        if (row !== undefined) void this.launch(row);
      },
    });
    btn.container.position.set(FOOT_BTN_X, FOOT_Y);
    btn.setEnabled(enabled);
    host.addChild(btn.container);
    this.launchBtn = btn;

    // 폐기는 **되돌릴 수 없다** — 그래서 붉은 톤이고, 누르면 바로 지우지 않고 확인 팝업을 연다.
    const discard = this.chromeButton({
      tone: enabled ? 'red' : 'stone',
      width: DISCARD_W,
      height: FOOT_H,
      fontSize: 20,
      label: t('commission.discard'),
      onClick: () => {
        const row = this.selectedRow();
        if (row !== undefined) this.openDiscardConfirm(row);
      },
    });
    discard.container.position.set(DISCARD_X, FOOT_Y);
    discard.setEnabled(enabled);
    host.addChild(discard.container);
    this.discardBtn = discard;
  }

  /**
   * 출격 가능 조건 — 온라인 · 선택된 의뢰서 있음 · 왕복 중이 아님.
   *
   * 폐기도 **같은 조건**을 쓴다: 둘 다 서버 원장 왕복이고, 왕복 중에 다른 쪽을 누를 수 있으면
   * "출격과 폐기가 같은 한 장을 동시에 노리는" 상태가 클라에서 만들어진다(서버는 `for update`
   * 로 한쪽을 떨어뜨리지만, 화면이 그 경합을 먼저 안 만드는 것이 옳다).
   */
  private canLaunch(): boolean {
    return this.online && !this.busy && this.selectedRow() !== undefined;
  }

  // --- 갱신 -----------------------------------------------------------------

  /** 값과 목록만 갈아끼운다. 배경·석재 패널은 다시 굽지 않는다(파일 헤더 "재렌더 규율"). */
  private refresh(): void {
    if (!this.chromeBuilt) return;
    this.syncValues();
    this.renderList();
    this.renderDetail();
    this.renderHelp();
  }

  private syncValues(): void {
    if (this.stockNode !== null) {
      this.stockNode.text = stripEmoji(
        commissionStockText(this.inventory.length, COMMISSION_STOCK_CAP),
      );
    }
    if (this.statusNode !== null) {
      const err = this.hint !== '';
      this.statusNode.text = stripEmoji(err ? this.hint : t('commission.sub'));
      this.statusNode.style.fill = err ? WARN_FILL : COLOR.muted;
    }
    this.syncLaunchButton();
  }

  // --- 목록 열 -------------------------------------------------------------

  private renderList(): void {
    const host = this.listHost;
    if (host === null) return;
    this.clearHost(host);

    if (this.inventory.length === 0) {
      // ⚠️ 이 화면의 **기본 상태**다(파일 헤더). 오프라인이면 온라인 전용 안내, 접속했는데
      // 0장이면 획득 안내 — 둘은 플레이어가 할 일이 다르므로 문구를 뭉개지 않는다.
      this.emptyWell(host, BOX_L, t(this.online ? 'commission.empty' : 'commission.offline'));
      return;
    }

    // 남는 세로를 행이 나눠 갖고, 그래도 남으면 **꼬리 챔버**가 받는다(빈 자리 금지).
    const { heights: hs, tailH } = listFill(this.inventory.length);
    const bounds = rowBounds(hs, ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    /**
     * ⚠️ 마스크를 **행 경계로 자르지 않는다**(`clampToRows` 미사용).
     *
     * 형제 화면들은 목록 길이가 데이터로 고정이라 스크롤이 안 생겨 차이가 없었지만, 보유
     * 의뢰서는 9장부터 넘친다 — 그때 행 경계로 자르면 상자 아래에 **78px 짜리 맨 석재 면**이
     * 남는다(실화면 1차 확인 12장 상태). 상자 높이를 그대로 쓰면 마지막 행이 반쯤 걸쳐 보이고,
     * 그 반쪽이 곧 "아래에 더 있다"는 신호가 된다.
     */
    const maskH = BOX_L.h;

    if (tailH > 0) {
      // ⚠️ 스크롤 콘텐츠 **밖**에 둔다 — 꼬리가 생긴다는 것은 곧 스크롤이 없다는 뜻이고
      // (남는 자리가 있다), 안에 넣으면 스크롤 총 높이가 늘어 헛돌게 된다.
      this.emptyWell(
        host,
        { x: BOX_L.x, y: BOX_L.y + total + ROW_GAP, w: BOX_L.w, h: tailH },
        t('commission.list.tail'),
      );
    }

    const content = makeScrollArea(host, {
      x: BOX_L.x,
      y: BOX_L.y,
      w: BOX_L.w,
      h: maskH,
      totalH: total,
      get: () => this.listScrollY,
      set: (v) => {
        this.listScrollY = v;
      },
      thumb: true,
    });

    let cy = 0;
    this.inventory.forEach((row, i) => {
      const h = hs[i] ?? ROW_H;
      const node = this.makeRow(row, BOX_L.w, h);
      node.position.set(0, cy);
      content.addChild(node);
      cy += h + ROW_GAP;
    });
  }

  /** 의뢰 1행 — `계급 · 주문` + `N개 무대 · 크레딧 +X`. 상세는 오른쪽 열이 말한다. */
  private makeRow(row: CommissionInventoryRow, w: number, h: number): Container {
    const { payload } = row;
    const selected = this.selectedId === row.commissionId;

    const node = new Container();
    // 클릭은 **행 Container** 가 받는다(바탕 Graphics 에 걸면 위 텍스트가 삼킨다).
    attachRowClick(node, () => {
      if (this.selectedId === row.commissionId) return;
      this.selectedId = row.commissionId;
      this.detailScrollY = 0;
      this.hint = '';
      this.refresh();
    });
    node.addChild(rowPlate(w, h, selected));

    const textW = w - ROW_PAD * 2 - ROW_REWARD_W;
    // 행 높이가 늘어나도 두 줄이 세로 가운데에 남게 위쪽 여백을 파생시킨다.
    const top = Math.round((h - 46) / 2);

    const title = this.label(
      `${commissionGradeLabel(payload.grade)}  ·  ${commissionOrderLabel(payload.order)}`,
      21,
      selected ? COLOR.gold : COLOR.cream,
      '800',
      textW,
    );
    title.position.set(ROW_PAD, top);
    node.addChild(title);

    const sub = this.label(
      t('commission.segments', { n: payload.segments.length }),
      16,
      COLOR.muted,
      '400',
      textW,
    );
    sub.position.set(ROW_PAD, top + 26);
    node.addChild(sub);

    // 오른쪽은 **보상**이 받는다 — 왼쪽 글자만 두면 행 오른쪽 절반이 통째로 빈다(실화면 1차
    // 확인). 의뢰서를 고르는 결정은 사실상 "무엇을 얼마에"라서 여기 있는 것이 옳다.
    const reward = commissionRewardSummary(payload);
    const rewardText = this.label(
      reward.creditsText,
      19,
      COLOR.gold,
      '700',
      ROW_REWARD_W - ROW_PAD,
    );
    rewardText.anchor.set(1, 0);
    rewardText.position.set(w - ROW_PAD, top);
    node.addChild(rewardText);

    const extras = [
      // 확정 경험치는 **모든 의뢰서가 가지는 축**이라 광물·아이템보다 앞에 온다.
      reward.xpText,
      ...(reward.mineralsText !== null ? [reward.mineralsText] : []),
      ...(reward.itemsText !== null ? [reward.itemsText] : []),
      ...(reward.hasUnique ? [t('commission.rewards.unique')] : []),
    ];
    if (extras.length > 0) {
      const sideSub = this.label(
        extras.join(' · '),
        15,
        SLAB_BODY_FILL,
        '400',
        ROW_REWARD_W - ROW_PAD,
      );
      sideSub.anchor.set(1, 0);
      sideSub.position.set(w - ROW_PAD, top + 26);
      node.addChild(sideSub);
    }

    return node;
  }

  // --- 상세 열 -------------------------------------------------------------

  /**
   * 상세 열 — 챔버 넷(개요 · 무대 · 확정 보상 · 제약)이 남는 세로를 나눠 갖는다.
   *
   * ⚠️ 제약 문구 줄 수가 의뢰마다 다르므로 자연 높이 합이 상자를 넘을 수 있다.
   * {@link fillRowHeights} 는 늘려 주기만 할 뿐 줄여 주지 않아 그대로 두면 챔버가 패널 테두리를
   * 뚫는데 예외도 로그도 없다 — 그래서 스크롤을 붙인다(휠은 클립 Container 가 받는다).
   */
  private renderDetail(): void {
    const host = this.detailHost;
    if (host === null) return;
    this.clearHost(host);

    const row = this.selectedRow();
    if (row === undefined) {
      this.renderPrimer(host);
      return;
    }
    const { payload } = row;

    const reward = commissionRewardSummary(payload);
    const rewardLines = [
      reward.creditsText,
      reward.xpText,
      ...(reward.mineralsText !== null ? [reward.mineralsText] : []),
      ...(reward.itemsText !== null ? [reward.itemsText] : []),
      ...(reward.hasUnique ? [t('commission.rewards.unique')] : []),
    ];
    const constraintLines: string[] = [];
    const eliteNote = commissionEliteNoteFor(payload.order);
    if (eliteNote !== null) constraintLines.push(eliteNote);
    constraintLines.push(...commissionConstraintLines(payload));
    if (constraintLines.length === 0) constraintLines.push(t('commission.detail.noConstraints'));

    const chambers: { headKey: MessageKey; body: string; warn: boolean }[] = [
      {
        headKey: 'commission.detail.brief',
        body: `${commissionGradeLabel(payload.grade)}  ·  ${commissionOrderLabel(payload.order)}\n${t('commission.segments', { n: payload.segments.length })}`,
        warn: false,
      },
      {
        headKey: 'commission.detail.stages',
        body: payload.segments
          .map((s, i) => `${i + 1}.  ${segmentLine(s.planet, s.stage)}`)
          .join('\n'),
        warn: false,
      },
      { headKey: 'commission.detail.rewards', body: rewardLines.join('\n'), warn: false },
      { headKey: 'commission.detail.constraints', body: constraintLines.join('\n'), warn: true },
    ];
    this.renderChambers(host, chambers);
  }

  /**
   * 아무것도 선택되지 않은 상세 열 — **안내 챔버 셋**.
   *
   * ## 왜 "왼쪽에서 고른다" 한 줄이 아닌가 (실화면 1차 확인 2026-08-03)
   * 이 화면의 **기본 상태가 보유 0 · 오프라인**이라(서버 원장이 정본) 한 줄짜리 안내를 넣으면
   * 1060×756 짜리 빈 상자 하나가 이 화면의 첫인상이 된다 — 실제로 그렇게 찍혔다. 그런데 그
   * 상태에서 플레이어가 알아야 하는 것은 "고르라"가 아니라 **"어떻게 얻고 몇 장까지 쌓이는가"**
   * 다. 그래서 그 자리를 안내가 받는다: 채워진 화면과 **같은 챔버 기계**를 쓰므로 두 상태가
   * 같은 골격으로 읽히고, 빈 면이 남지 않는다.
   */
  private renderPrimer(host: Container): void {
    this.renderChambers(host, [
      { headKey: 'commission.about.what', body: t('commission.about.whatBody'), warn: false },
      { headKey: 'commission.about.get', body: t('commission.about.getBody'), warn: false },
      {
        headKey: 'commission.about.stock',
        body: t('commission.about.stockBody', { cap: COMMISSION_STOCK_CAP }),
        warn: false,
      },
    ]);
  }

  /**
   * 상세 열의 챔버 세로 쌓기 — 머리글은 **왼쪽 열**, 본문은 오른쪽.
   *
   * ⚠️ 머리글을 본문 **위**에 얹었더니 상세 열 오른쪽 700px 가 통째로 비었다(실화면 1차 확인).
   * 본문이 한두 줄짜리 짧은 문구인데 열은 1060px 이기 때문이다 — 왼쪽 라벨 + 오른쪽 값이
   * 지시서가 실제로 읽히는 형태이기도 하다.
   */
  private renderChambers(
    host: Container,
    chambers: readonly { headKey: MessageKey; body: string; warn: boolean }[],
  ): void {
    const headW = CHAMBER_HEAD_W;
    const bodyX = ROW_PAD + 4 + headW + CHAMBER_HEAD_GAP;
    const bodyW = BOX_D.w - ROW_PAD - 4 - bodyX;

    // 자연 높이를 먼저 재고(제약 줄 수가 의뢰마다 다르다) 남는 세로를 그 위에서 나눠 준다.
    const built = chambers.map((c) => {
      const head = this.label(t(c.headKey), 20, COLOR.gold, '800', headW);
      const body = this.wrapped(c.body, 18, c.warn ? WARN_FILL : SLAB_BODY_FILL, bodyW, '400', 28);
      const inner = Math.max(Math.ceil(head.height), Math.ceil(body.height));
      return { head, body, inner, natural: Math.max(CHAMBER_MIN_H, 18 + inner + 18) };
    });
    const hs = fillRowHeights(
      built.map((b) => b.natural),
      ROW_GAP,
      BOX_D.h,
      CHAMBER_MAX_H,
    );
    const bounds = rowBounds(hs, ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);

    const content = makeScrollArea(host, {
      x: BOX_D.x,
      y: BOX_D.y,
      w: BOX_D.w,
      h: Math.min(BOX_D.h, total),
      totalH: total,
      get: () => this.detailScrollY,
      set: (v) => {
        this.detailScrollY = v;
      },
      thumb: true,
    });

    let cy = 0;
    built.forEach((b, i) => {
      const h = hs[i] ?? b.natural;
      content.addChild(recessedWell(0, cy, BOX_D.w, h));
      // 챔버가 남는 세로를 나눠 가지며 자라므로 글자를 위에 고정하면 아래가 빈 면이 된다 —
      // 머리글·본문을 챔버 세로 가운데에 앉힌다(기록 보관소 챕터와 같은 처방).
      const top = cy + Math.max(14, Math.round((h - b.inner) / 2));
      b.head.position.set(ROW_PAD + 4, top);
      content.addChild(b.head);
      b.body.position.set(bodyX, top);
      content.addChild(b.body);
      cy += h + ROW_GAP;
    });
  }
}
