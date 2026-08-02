/**
 * 챔피언(기체) 선택 화면 — Pixi (M8-L8, 설계서 §6·§8 · 2026-08-02 AAA 시네마틱 전환).
 *
 * 격납고에서 진입하는 **하위 화면**이다(촉매 보관함·예비역 로스터와 동일 suspend/resume 규약).
 * 좌측에 로스터 목록(`SHIP_TYPES` 전량 — ADR-0019 **해금 게이트 없음**), 우측에 선택한 타입의
 * 히어로 창 · 시그니처 패시브 · 섀시 보정(basis-point) · 3계열 미리보기를 보여 주고, 확정하면
 * **현역 기체를 퇴역시키고 그 타입의 새 기체로 세대 교체**한다.
 *
 * ## 시네마틱 전환에서 바뀐 것은 **바탕과 배치**뿐이다
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재 슬래브/유리창), `makeBanner` →
 * `makeHangarTitle`, `ui_btn_*.png` → `cinematicButtonTexture`, `makeModal`(나무) → 이 파일의
 * 시네마틱 팝업, 쇼케이스 `Sprite` 한 장 → `makeShipDock`. 퇴역 계약·저장 경로·만렙 게이트는
 * 한 줄도 건드리지 않았다.
 *
 * ## 왜 이 화면만 **창을 뚫는가**
 * 형제 화면 둘(촉매 보관함 PR#247 · 예비역 로스터 PR#248)은 창을 뚫었다가 뺐다 — 창 안에 초점
 * 피사체가 없어서다. **창은 "배경이 보이는 구멍"이 아니라 "무언가를 보여주는 자리"다.** 이
 * 화면은 그 조건을 유일하게 만족한다: 행을 바꾸면 창 안의 피사체가 실제로 바뀐다. 그래서
 * `windows: [히어로 창]` 이고 `makeShipDock` 이 그 안에 선다.
 *
 * ## 왜 카드 나열(`cinematicTile`)이 아닌가
 * 7종을 카드로 깔면 카드마다 함선이 128px 이하가 되는데, `shipDock` 의 접지 그림자·언더라이트·
 * 림은 전부 **실루엣 바닥선 파생**이라 스프라이트가 작아지면 몇 픽셀로 뭉개진다. 기체를 크게
 * 보여주는 것이 이 화면의 목적이므로 **중앙 히어로 창 + 좌측 목록**이 옳다.
 *
 * ## 함선 픽셀아트는 다시 그리지 않는다(사용자 확정)
 * 기체 정체성·파밍 시각 언어다. 조명·접지·프레이밍으로만 페인터리 배경에 앉힌다
 * (`shipDock.ts` 헤더에 실측 근거가 있다). 크래들(받침)은 사용자 판단으로 끈다.
 *
 * ## 사연(파일럿 파일) 진입은 이 화면에 두지 않는다 (사용자 확정 2026-08-02)
 * AAA 전환 1차에서 시그니처 패널 바닥에 [사연 읽기] 버튼을 뒀다가 화면을 본 사용자가 삭제를
 * 지시했다. 이 화면의 일은 **무엇으로 갈아탈지 정하는 것**이고 서사는 그 결정을 돕지 않는다.
 * 사연은 사라지지 않았다 — `recordsArchive.ts`(기록 보관소)가 같은 `makePilotFileModal` 로
 * 계속 연다. 되살리려면 그 화면 쪽을 보라.
 *
 * ## 퇴역은 되돌릴 수 없다 — 가독성이 연출보다 우선이다
 * 확인 팝업 암막은 뒤 화면 글자가 **읽히지 않을 만큼** 짙고(`alpha 0.92`), 본문은 크림색 큰
 * 글자다. 만렙 게이트가 닫혀 있으면 확정 버튼을 죽이고 **왜 막혔는지를 상시** 보여 준다 —
 * 죽은 버튼만 있으면 사용자는 고장으로 읽는다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거)
 * - **DOM 혼용 금지.** 캔버스는 남은 DOM 오버레이 아래로 깔리고 z-index 로 못 뒤집는다(ADR-0014).
 * - **목록 행 클릭은 행 Container 에.** 바탕 Graphics 에 걸면 위에 얹힌 텍스트가 클릭을 삼킨다.
 * - **휠은 클립 Container + hitArea 에.** 마스크 Graphics 는 히트 테스트에서 제외된다.
 * - **여백은 패널의 `box` 안에만.**
 * - **격납고와는 `suspend()`/`resume()`** — `show()` 로 되돌리면 미저장 장비 편집이 사라진다.
 * - 이름에 **컬러 이모지 금지**(`text.ts` stripEmoji 가 두부로 떨군다). ★ ✕ 는 보존 목록이다.
 * - ⚠️ `hudEl()` 에는 **캔버스 가드를 붙이지 않는다**(`typeof document.createElement !==
 *   'function'` 까지 검사하면 HUD 숨김이 통째로 죽는다 — 이 리포가 실제로 밟았다).
 *
 * ## 재렌더 규율
 * `render()` 로 루트를 통째로 다시 그리면 선택이 바뀔 때마다 배경과 석재 패널 4장이 다시
 * 구워진다. `buildChrome()` 은 1회, `renderList()` 가 행만, 선택 변경은 두 행의 링 · 히어로
 * 도크(함선 텍스처가 바뀐다) · 나머지 위젯의 `.text` 만 갈아끼운다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
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
import { retireActiveShip, retireGate } from '../../save/guardianLifecycle.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW } from './theme.js';
import {
  loadUiTextures,
  shipShowcaseName,
  shipPortraitName,
  LEGACY_SHOWCASE,
  type UiTextures,
} from './uiTextures.js';
import { PixiButton } from './button.js';
import { attachRowClick, stopRowPropagation } from './listRow.js';
import { makeScrollArea } from './scrollArea.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import { makeShipDock, type ShipDock } from './shipDock.js';
import {
  makeHangarTitle,
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';

import {
  shipTypeName,
  shipTypeRole,
  shipSignatureDesc,
  shipTreeName,
  tShipKey,
  AFFINITY_ACCENT,
} from './shipLabels.js';
import { t } from '../../i18n/index.js';

// ---------------------------------------------------------------------------
// 레이아웃(디자인 스페이스 1920×1080)
//
// 여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 격납고·촉매 보관함·예비역 로스터와
// **같은 값**이다. 형제 화면끼리 다르면 화면 전환에서 튄다.
// ---------------------------------------------------------------------------

/**
 * `cinematicPanel.ts` 콘텐츠 상자 기하의 **복제본**(출처: 그 파일의 `EDGE_PAD 24` ·
 * `CONTENT_GAP 16` · `TITLE_BAND_H = round(TITLE_SIZE 26 × 2)`).
 *
 * 왜 베끼는가: {@link ROSTER_LIST_AVAIL} 은 스크롤 산술의 전제라 **모듈 상수**여야 하는데
 * (기존 테스트가 그 값으로 클램프 왕복을 검증한다) 패널 상자는 런타임 객체다. 베낀 값이
 * 조용히 어긋나면 목록 마지막 행이 영영 안 보이는데 예외도 로그도 없다 —
 * `tests/championSelectLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조해 잠근다.
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
const ROW_GAP_Y = 20;

const ROSTER_X = EDGE_X;
const ROSTER_Y = HEADER_H + 8;
const ROSTER_W = 560;
const ROSTER_H = 940;

/** 우측 열 시작 x 와 그 폭 — 로스터에서 **파생**한다(하드코딩하면 거터가 조용히 어긋난다). */
const RIGHT_X = ROSTER_X + ROSTER_W + GUTTER_X;
const RIGHT_W = DESIGN_WIDTH - EDGE_X - RIGHT_X;

/**
 * 스킬 계열 패널 세로 — 카드가 실제로 쓰는 높이에서 역산한다(제목 띠 52 + 간격 16 + 카드 +
 * 아래 여백 24). 카드는 제목·메타·캡스톤 이름 2줄·설명 2줄이면 끝난다.
 */
const TREE_CARD_H = 152;
const TREE_BAND_H = TITLED_BOX_Y + TREE_CARD_H + PANEL_EDGE_PAD;

/** 히어로 창 · 시그니처 패널: 우측 열 상단을 반씩 나눈다. */
const HERO_W = Math.floor((RIGHT_W - GUTTER_X) / 2);
const HERO_X = RIGHT_X;
const HERO_Y = ROSTER_Y;
/**
 * 히어로 창·시그니처 패널의 세로는 **아래 스킬 계열 패널에서 역산**한다. 처음에는 창 580 ·
 * 계열 340 이었는데 실화면에서 계열 카드의 아래 절반과 시그니처 패널의 위아래가 통째로 비었다
 * — 형제 화면 둘이 똑같이 잡아 고친 "쓸모도 볼거리도 아닌 자리" 결함이다. 계열 패널을 카드가
 * 실제로 쓰는 높이로 줄이고 남는 세로를 창·시그니처가 받는다.
 */
const HERO_H = ROSTER_H - TREE_BAND_H - ROW_GAP_Y;
const SIG_X = HERO_X + HERO_W + GUTTER_X;
const SIG_W = DESIGN_WIDTH - EDGE_X - SIG_X;
const SIG_Y = HERO_Y;
const SIG_H = HERO_H;

/**
 * 스킬 계열 패널은 우측 열 **전폭**을 쓴다. 세로로 쌓으면 카드가 572px 폭에 108px 높이가 되어
 * 캡스톤 설명이 안 들어가고 띠 세 줄로 읽힌다 — 나란히 놓아야 카드로 선다(각 ≈396px).
 * 바닥은 로스터 패널 바닥과 **같아야** 하므로 파생시킨다(하드코딩 금지).
 */
const TREE_X = RIGHT_X;
const TREE_Y = HERO_Y + HERO_H + ROW_GAP_Y;
const TREE_W = RIGHT_W;
const TREE_H = TREE_BAND_H;

/** 헤더 닫기 한 변. */
const CLOSE_W = 56;

/**
 * 좌상단 예약 밴드 — `main.ts` SettingsScreen 의 설정 톱니가 쓰는 **전 화면 공용 자리**다.
 * 톱니는 매 프레임 stage 최상위로 올라오므로 여기에 컨트롤을 두면 통째로 클릭 불가가 된다.
 */
export const GEAR_BAND_W = 120;
export const GEAR_BAND_H = 120;

/** 로스터 패널 콘텐츠 상자(패널 로컬) — 위 복제 기하에서 파생. */
const ROSTER_BOX = {
  x: PANEL_EDGE_PAD,
  y: TITLED_BOX_Y,
  w: ROSTER_W - PANEL_EDGE_PAD * 2,
  h: ROSTER_H - TITLED_BOX_Y - PANEL_EDGE_PAD,
  get bottom(): number {
    return this.y + this.h;
  },
} as const;

/** 로스터 행 한 칸(초상 + 이름 + 역할 한 줄)과 행 사이 틈. */
export const ROSTER_ROW_H = 116;
export const ROSTER_ROW_GAP = 12;
/** 행 초상 한 변과 좌측 여백 — 글자 x 는 여기서 **파생**한다(하드코딩 금지). */
const ROSTER_ICON = 76;
const ROSTER_ICON_X = 16;
const ROSTER_TEXT_X = ROSTER_ICON_X + ROSTER_ICON + 16;

/** ADR-0019 안내(전체 개방)가 차지하는 세로 — 목록 상단을 여기서 역산한다. */
const ROSTER_SUB_SIZE = 15;
const ROSTER_SUB_LINE = 21;
const ROSTER_SUB_MAX_LINES = 2;
const ROSTER_LIST_TOP = ROSTER_BOX.y + ROSTER_SUB_LINE * ROSTER_SUB_MAX_LINES + 10;

const CONFIRM_W = 460;
const CONFIRM_H = 64;
/**
 * 확정 버튼 위에 남겨야 하는 세로 — "현재 기체" 한 줄과 **게이트 사유 2줄**이 들어간다.
 * 사유는 만렙 미만이면 상시 보이므로(사실상 전 사용자) 예산에서 빼면 목록과 겹친다.
 */
const ROSTER_FOOT_PAD = 76;

/** 로스터 목록에 쓸 수 있는 세로(콘텐츠 상자 안, 확정 버튼 영역 위까지). */
export const ROSTER_LIST_AVAIL =
  ROSTER_BOX.bottom - CONFIRM_H - ROSTER_FOOT_PAD - ROSTER_LIST_TOP;

/** 히어로 창 콘텐츠 상자(패널 로컬). **제목 띠가 없다** — 창이 다시 패널로 읽히지 않게. */
const HERO_BOX = {
  x: PANEL_EDGE_PAD,
  y: PANEL_EDGE_PAD,
  w: HERO_W - PANEL_EDGE_PAD * 2,
  h: HERO_H - PANEL_EDGE_PAD * 2,
} as const;
/** 함선 한 변. 창 안에서 접지 그림자(실루엣 바닥 아래 ~56px)가 상자 안에 들어오는 크기다. */
const SHIP_SIZE = 380;
/** 함선 중심의 세로 위치(창 상자 비). 아래에 기체 이름이 앉는다. */
const SHIP_CY_K = 0.44;

/**
 * 시그니처 패널의 세로 예산(패널 로컬 **상자 기준**).
 *
 * ⚠️ 캔버스 없는 환경(vitest)에서는 `Text.height`·`getLocalBounds()` 가 던지므로 실제 줄 수로
 * 이어 붙일 수 없다 — 최악의 로케일을 담는 **고정 예산**으로 쌓는다. 값은 실화면에서 잰
 * 줄 수(역할 3줄 · 시그니처 4줄 · 경고 3줄)에 맞췄다.
 */
const SIG_ROLE_Y = 0;
const SIG_BODY_Y = 106;
const SIG_CHASSIS_Y = 222;
const SIG_BP_HEAD_Y = 254;
const SIG_BP_TOP_Y = 282;
const BP_ROW_H = 36;
/**
 * 퇴역 경고는 **바닥 기준**(anchor bottom)으로 붙인다 — 위에서 내려오는 것은 섀시 표 하나뿐이라
 * 예비역 로스터가 겪은 "양쪽에서 쌓아 가운데서 겹침"이 구조적으로 생길 수 없다(섀시 표 바닥
 * {@link SIG_BP_TOP_Y} + 4행 = 426 · 경고 최대 3줄은 502 부터 시작한다).
 */
const SIG_WARN_BOTTOM_PAD = 6;

const CONFIRM_MODAL_W = 800;
/**
 * 팝업 높이는 **본문이 정한다.** 형제 화면(예비역 로스터)에서 420 은 본문과 버튼 사이가
 * 200px 넘게 비어 "로딩 중"으로 읽혔다. 이 화면 본문은 더 길다(무엇을 잃는지 전부 말한다).
 */
const CONFIRM_MODAL_H = 320;
const MODAL_BTN_H = 56;

/**
 * 석재 슬래브 위 **보조 텍스트색**. `hangar.ts` 의 `SLAB_BODY_FILL` 을 복제한 것이다(그 파일은
 * 화면이지 공용 모듈이 아니다 — 계약 "복제하고 헤더에 출처를 밝혀라").
 *
 * 옛 `COLOR.muted`(#aa9b87)를 쓸 수 없는 이유: 슬래브 면의 동작점이 L* 19 → 28 로 올라가면서
 * 그 위 글자의 대비가 3.00:1 로 WCAG AA 미달이 됐다. 배경을 도로 어둡게 하면 "화면 과반이
 * 평평한 암면" 결함이 되돌아오므로 **전경만 올린다.** `#e4dac7` 은 최악의 바탕에서 4.84:1.
 */
const SLAB_BODY_FILL = 0xe4dac7;
/** 게이트 사유·경고 문구색. 붉은 계열이되 슬래브 위에서 읽히는 밝기로. */
const WARN_FILL = 0xffa98a;

/** 행 판 바탕색·홈·반경 — 예비역 로스터 `rowPlate` 에서 복제(형제 화면끼리 갈리면 안 된다). */
const ROW_FACE = 0x3b3327;
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;

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

/** 화면 좌표 사각형(디자인 스페이스). */
export interface ChampionRect {
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
 * 꺼내 두면 겹침·화면 이탈·예약 밴드 침범을 단위 테스트가 잠근다.
 */
export function championSelectLayout(): {
  readonly screen: ChampionRect;
  readonly headerH: number;
  readonly panels: readonly {
    readonly id: 'roster' | 'hero' | 'signature' | 'trees';
    readonly rect: ChampionRect;
  }[];
  readonly headerControls: readonly { readonly id: string; readonly rect: ChampionRect }[];
  /** 배경이 보존되는 창(디자인 좌표) — 히어로 창의 **콘텐츠 상자**다. */
  readonly windows: readonly ChampionRect[];
} {
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels: [
      { id: 'roster', rect: { x: ROSTER_X, y: ROSTER_Y, w: ROSTER_W, h: ROSTER_H } },
      { id: 'hero', rect: { x: HERO_X, y: HERO_Y, w: HERO_W, h: HERO_H } },
      { id: 'signature', rect: { x: SIG_X, y: SIG_Y, w: SIG_W, h: SIG_H } },
      { id: 'trees', rect: { x: TREE_X, y: TREE_Y, w: TREE_W, h: TREE_H } },
    ],
    headerControls: [
      {
        id: 'close',
        rect: { x: DESIGN_WIDTH - EDGE_X - CLOSE_W, y: HEAD_Y, w: CLOSE_W, h: HEAD_H },
      },
    ],
    windows: [heroWindowRect()],
  };
}

/** 히어로 창의 화면 좌표(배경 모듈에 넘기는 값과 **같은 식**을 쓴다 — 따로 적으면 어긋난다). */
function heroWindowRect(): ChampionRect {
  return { x: HERO_X + HERO_BOX.x, y: HERO_Y + HERO_BOX.y, w: HERO_BOX.w, h: HERO_BOX.h };
}

// --- 행 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 행 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 *
 * (예비역 로스터 `rowRamp` 에서 복제. 형제 화면이라 같은 값이어야 하고, 그 파일은 공용 모듈이
 * 아니라 화면이라 import 하지 않는다.)
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
 * 행·카드 한 장의 바탕 — 2단 접지 그림자 + 석재 면 + 방향성 램프 + 안쪽 어두운 홈.
 *
 * **선은 긋지 않는다.** 행 사이 구분은 이 그림자와 행 간격이 만든다(세로 리브·가로 이음선은
 * 사용자가 격납고에서 삭제를 지시한 것들이다).
 */
function rowPlate(w: number, h: number): { view: Container; setSelected: (on: boolean) => void } {
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

  /**
   * 선택 링. **구분선이 아니라 상태 표시다** — 행 사이를 가르는 선은 표의 괘선으로 읽혀
   * 금지지만, 지금 무엇을 보고 있는지는 목록과 히어로 창을 잇는 유일한 단서다.
   */
  const ring = new Graphics();
  ring
    .roundRect(0, 0, w, h, ROW_RADIUS)
    .stroke({ color: COLOR.gold, width: 3, alignment: 1, alpha: 0.95 });
  ring.visible = false;
  root.addChild(ring);

  return {
    view: root,
    setSelected: (on: boolean) => {
      ring.visible = on;
    },
  };
}

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
 * ⚠️ **만렙 게이트**(`retireGate`): 현역 기체가 만렙이 아니면 `retireActiveShip` 이 Profile 을
 * 전혀 변형하지 않고 거부한다. 그때는 저장도 하지 않고 `null` 을 돌려준다 — 여기서 `saveProfile`
 * 을 무조건 부르면 아무것도 안 바뀐 프로필을 덮어써 거부가 성공처럼 보인다.
 *
 * @returns 실제로 활성이 된 타입 id(손상 입력은 레지스트리가 0 으로 되돌린다). 게이트에
 *   막히면 `null`.
 */
export function applyChampionChoice(
  profile: Profile,
  typeId: number,
  store: KeyValueStore | null,
): number | null {
  const result = retireActiveShip(profile, undefined, typeId);
  if (result === null) return null;
  // ⚠️ `store` 가 null 이면 **기본 인자가 적용되지 않는다** — `saveProfile` 은 명시적 null 을
  // 즉시 return 으로 처리한다. 화면은 store 없이 생성되므로(main.ts → HangarScreen → 여기)
  // null 을 그대로 넘기면 세대 교체가 저장되지 않는다. `?? undefined` 로 기본 store 를 태운다.
  saveProfile(profile, store ?? undefined);
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
  private art: HangarTextures = {};
  private selected = 0;
  private scrollY = 0;
  private confirming = false;
  private hint = '';
  /** 진입 시점의 런 HUD `visibility` 인라인 값(닫을 때 그대로 되돌린다 — 결함 C-4). */
  private hudPrevVisibility: string | null = null;

  // --- 유지되는 크롬(파일 헤더 "재렌더 규율") ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  private modalPanel: CinematicPanel | null = null;
  private chromeBuilt = false;
  private listHost: Container | null = null;
  private dockHost: Container | null = null;
  private dock: ShipDock | null = null;
  private modalHost: Container | null = null;
  /** 선택이 바뀌면 `.text` 만 갈아끼우는 위젯들. */
  private detail: {
    heroName: Text;
    role: Text;
    sigBody: Text;
    bp: { label: Text; now: Text; value: Text }[];
    trees: { name: Text; meta: Text; cap: Text; capDesc: Text }[];
    confirm: PixiButton;
    current: Text;
    locked: Text;
  } | null = null;
  /** 행별 선택 표시 토글 — 선택이 바뀔 때 목록을 다시 그리지 않기 위한 핸들. */
  private readonly rowSelect = new Map<number, (on: boolean) => void>();

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // 텍스처는 나중에 도착한다 — 도착하면 크롬을 통째로 다시 세운다(구운 텍스처가 바뀌므로
    // 갱신으로는 안 된다).
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

  /** 현재 선택된 타입 id(테스트·호출자 확인용). */
  get selectedTypeId(): number {
    return this.selected;
  }

  /**
   * 매 프레임 연출 진행. `dt` 는 **벽시계 초**다.
   *
   * ⚠️ 격납고가 **자기 가시성 가드보다 먼저** 이 메서드를 부른다 — 이 화면이 떠 있는 동안
   * 격납고 root 는 `suspend()` 로 숨겨져 있기 때문이다. 숨겨져 있으면 즉시 반환하므로 비용은 0.
   */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const p of this.panels) p.update(dt);
    this.modalPanel?.update(dt);
    this.dock?.update(dt);
  }

  show(profile: Profile, cb: ChampionSelectCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.hint = '';
    this.confirming = false;
    this.scrollY = 0;
    // 기본 선택은 **현역 기체 타입** — "지금 무엇을 타고 있는지" 에서 출발해야 비교가 된다.
    this.selected = shipTypeDef(activeShip(profile).typeId).id;
    this.buildChrome();
    this.syncDetail();
    this.renderList();
    this.renderModal();
    this.root.visible = true;
    this.raise();
    this.hideRunHud();
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    this.restoreRunHud();
  }

  /** 다른 캔버스 화면에 자리를 내주고 잠시 감춘다(상태 보존). */
  suspend(): void {
    this.root.visible = false;
  }

  resume(): void {
    this.root.visible = true;
    this.raise();
    this.syncDetail();
    this.renderList();
  }

  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  /**
   * 런 전용 DOM HUD 엘리먼트.
   *
   * ⚠️ 여기에는 **캔버스 가드를 붙이지 않는다** — `typeof document.createElement !== 'function'`
   * 까지 검사하면 HUD 숨김이 통째로 죽는다(실제로 밟았다). DOM 조회는 `document` 유무만 본다.
   */
  private hudEl(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return document.getElementById('pb-hud');
  }

  /**
   * HUD 를 감추되 **진입 시점의 값을 기억**한다.
   *
   * ⚠️ 예전 구현은 닫을 때 무조건 `visibility = ''` 로 되살렸다 — 이 화면은 격납고 **위**에서
   * 열리고 격납고도 자기 show/hide 에서 같은 스타일을 만지므로, 닫고 격납고로 돌아가면 런 HUD 가
   * 격납고 위로 다시 떠올랐다(결함 C-4). 이전 값 복원이 유일하게 옳은 규약이다.
   */
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

  // --- 동작 ----------------------------------------------------------------

  /** 행 선택 — 목록을 다시 그리지 않고 이전/현재 행의 링만 뒤집고, 히어로 도크를 갈아끼운다. */
  private select(typeId: number): void {
    const next = shipTypeDef(typeId).id;
    if (next === this.selected) return;
    const prev = this.selected;
    this.selected = next;
    this.hint = '';
    this.rowSelect.get(prev)?.(false);
    this.rowSelect.get(next)?.(true);
    this.syncDetail();
  }

  /**
   * 확정 = **퇴역 + 세대 교체**. `retireActiveShip` 이 수호 스냅샷·계보 지급·장비 회수·신규 기체
   * push·`activeShipIndex` 이동·폐기 예정 별칭 재바인딩까지 한 번에 처리한다.
   *
   * ⚠️ 여기서 저장을 빠뜨리면 설계서 §10-5 가 예측한 결함("그려지는데 선택이 저장 안 됨")이
   * 그대로 재현된다 — 화면은 정상으로 보이고 다음 실행에서만 드러난다.
   */
  private confirm(): void {
    const typeId = applyChampionChoice(this.profile, this.selected, this.store);
    this.confirming = false;
    // 만렙 게이트에 막히면 아무 변형도 일어나지 않았다 — 화면을 닫지 말고 이유만 띄운다.
    if (typeId === null) {
      this.hint = this.retireBlockedHint();
      this.renderModal();
      this.syncDetail();
      return;
    }
    const cb = this.cb;
    this.hide();
    cb?.onConfirmed?.(typeId);
    cb?.onClose();
  }

  /**
   * 왜 퇴역이 막혔는지(현재/필요 레벨) 한 줄. 게이트가 열려 있으면 빈 문자열.
   *
   * ⚠️ 일반 `t()` 를 쓴다 — `tShipKey` 는 **폴백 경로에서 `params` 를 치환하지 않으므로**,
   * 카탈로그에 키가 없으면 화면에 `Lv {level} / {required}` 리터럴이 그대로 노출된다.
   * 만렙 미만은 사실상 전 사용자라 이 문구는 상시 보인다(`champion.retire.needMaxLevel`).
   */
  private retireBlockedHint(): string {
    const gate = retireGate(this.profile);
    if (gate.ok) return '';
    return t('champion.retire.needMaxLevel', { level: gate.level, required: gate.required });
  }

  private close(): void {
    const cb = this.cb;
    this.hide();
    cb?.onClose();
  }

  // --- 크롬(1회 조립) -------------------------------------------------------

  /** 자산이 도착하면 크롬을 통째로 다시 세운다(구운 텍스처가 바뀌므로 갱신으로는 안 된다). */
  private rebuild(): void {
    if (!this.chromeBuilt) return;
    this.destroyChrome();
    this.buildChrome();
    this.syncDetail();
    this.renderList();
    this.renderModal();
  }

  private destroyChrome(): void {
    // 연출 참조를 먼저 끊는다 — destroy 된 컨테이너를 update 가 만지면 안 된다.
    this.backdrop?.destroy();
    this.backdrop = null;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.modalPanel?.destroy();
    this.modalPanel = null;
    this.dock = null;
    this.dockHost = null;
    this.listHost = null;
    this.modalHost = null;
    this.detail = null;
    this.rowSelect.clear();
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
    // 자식이라 어긋난다). 창은 **히어로 창 하나** — 그 안에서 함선이 배경 조명을 받는다.
    const w = heroWindowRect();
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [{ x: w.x, y: w.y, w: w.w, h: w.h }],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    // ⚠️ **위 → 아래 순서로 붙인다.** 패널 접지 그림자는 아래로 59px 번지는데 행 간격은 20 이라,
    // 순서가 뒤집히면 위 패널의 그림자가 아래 패널 **위에** 얹혀 얼룩으로 읽힌다.
    const rosterPanel = this.addPanel(
      ROSTER_X,
      ROSTER_Y,
      ROSTER_W,
      ROSTER_H,
      tShipKey('champion.roster', 'Roster'),
    );
    const heroPanel = this.addPanel(HERO_X, HERO_Y, HERO_W, HERO_H, '', 'window');
    const sigPanel = this.addPanel(
      SIG_X,
      SIG_Y,
      SIG_W,
      SIG_H,
      tShipKey('champion.signature', 'Signature'),
    );
    const treePanel = this.addPanel(
      TREE_X,
      TREE_Y,
      TREE_W,
      TREE_H,
      tShipKey('champion.trees', 'Skill trees'),
    );

    const heroName = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT,
        fontSize: 34,
        fontWeight: '800',
        fill: COLOR.gold,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: HERO_BOX.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    heroName.anchor.set(0.5, 1);
    heroName.position.set(HERO_BOX.x + HERO_BOX.w / 2, HERO_BOX.y + HERO_BOX.h - 8);
    heroPanel.container.addChild(heroName);

    // 도크는 선택이 바뀔 때마다 갈리므로 그릇만 잡아 둔다(패널·창은 다시 굽지 않는다).
    const dockHost = new Container();
    heroPanel.container.addChild(dockHost);
    // 함선은 이름·역할 **아래**로 내려가지 않는다 — 그릇을 먼저 붙였으므로 글자가 위에 온다.
    heroPanel.container.setChildIndex(dockHost, heroPanel.container.children.length - 2);
    this.dockHost = dockHost;

    const listHost = new Container();
    rosterPanel.container.addChild(listHost);
    this.listHost = listHost;

    const detail = this.buildDetail(rosterPanel, sigPanel, treePanel, heroName);
    this.detail = detail;

    this.buildHeader();

    // 확인 팝업은 항상 맨 위에 뜬다 — 그릇을 마지막에 붙인다.
    const modal = new Container();
    this.root.addChild(modal);
    this.modalHost = modal;

    this.chromeBuilt = true;
  }

  /**
   * 석재 패널 한 장을 세운다.
   *
   * ⚠️ `screenX`/`screenY` 를 **반드시 넘긴다.** 안 넘기면 같은 치수의 패널끼리 조명·랜드마크
   * 시드가 같아져 위치별 조명이 조용히 무효가 된다 — 화면은 정상적으로 서고 테스트도 통과하므로
   * 눈으로만 잡히는 유형이다. 램프 위치는 형제 화면과 같은 헤더 밴드 중앙 상단이다.
   */
  private addPanel(
    px: number,
    py: number,
    pw: number,
    ph: number,
    title: string,
    variant: 'slab' | 'window' = 'slab',
  ): CinematicPanel {
    const panel = makeCinematicPanel({
      width: pw,
      height: ph,
      variant,
      ...(title === '' ? {} : { title }),
      screenX: px,
      screenY: py,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(px, py);
    this.root.addChild(panel.container);
    this.panels.push(panel);
    return panel;
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
      label: o.label,
      onClick: o.onClick,
    });
  }

  /**
   * 헤더 밴드(y 0..{@link HEADER_H}) — 각인 제목(중앙) · 닫기.
   *
   * ⚠️ 컨트롤은 **전부 같은 세로 띠**를 쓰고 가로로만 배치한다(격납고 헤더 겹침 결함 이력).
   * ⚠️ 좌상단 {@link GEAR_BAND_W}×{@link GEAR_BAND_H} 에는 아무것도 두지 않는다 — 설정 톱니가
   * 나중에 stage 최상위로 그려져 그 컨트롤을 통째로 클릭 불가로 만든다.
   * ⚠️ **각인 석재 인방은 넣지 않는다**(격납고에서 사용자 판단으로 제거됨). 헤더는 배경이 그대로
   * 보이는 띠이고, 배경 모듈이 이 대역을 중간 세기로 눌러 글자 대비를 보장한다.
   */
  private buildHeader(): void {
    const title = makeHangarTitle(tShipKey('champion.title', 'Choose Your Ship'));
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
    close.container.position.set(DESIGN_WIDTH - EDGE_X - CLOSE_W, HEAD_Y);
    this.root.addChild(close.container);
  }

  /**
   * 선택에 따라 값만 갈리는 위젯을 **한 번만** 만든다. 행 클릭마다 패널을 다시 세우면 석재
   * 텍스처가 매번 다시 구워진다(파일 헤더 "재렌더 규율").
   */
  private buildDetail(
    rosterPanel: CinematicPanel,
    sigPanel: CinematicPanel,
    treePanel: CinematicPanel,
    heroName: Text,
  ): NonNullable<ChampionSelectScreen['detail']> {
    // --- 로스터 패널: 안내 · 확정 버튼 · 현재 기체 · 게이트 사유 ---------------------
    const R = rosterPanel.container;
    const sub = new Text({
      resolution: 2,
      // ADR-0019: 전체 개방이 **명시적 결정**이다. 이 안내가 그 결정을 화면에서도 못박는다.
      text: tShipKey('champion.rosterSub', 'All ships are available — no unlock requirements.'),
      style: {
        fontFamily: UI_FONT,
        fontSize: ROSTER_SUB_SIZE,
        fill: SLAB_BODY_FILL,
        wordWrap: true,
        wordWrapWidth: ROSTER_BOX.w,
        lineHeight: ROSTER_SUB_LINE,
        dropShadow: TEXT_SHADOW,
      },
    });
    sub.position.set(ROSTER_BOX.x, ROSTER_BOX.y);
    R.addChild(sub);

    const confirmW = Math.min(CONFIRM_W, ROSTER_BOX.w);
    const confirm = this.chromeButton({
      tone: 'gold',
      width: confirmW,
      height: CONFIRM_H,
      fontSize: 19,
      label: '',
      onClick: () => {
        // 게이트는 **팝업이 뜨기 전에** 막는다. 모델(`retireActiveShip`)에도 같은 게이트가
        // 있다(이중 방어) — 여기서 막는 이유는 되돌릴 수 없는 확인 흐름을 시작조차 하지
        // 않기 위해서다.
        if (!retireGate(this.profile).ok) {
          this.hint = this.retireBlockedHint();
          this.syncDetail();
          return;
        }
        this.confirming = true;
        this.renderModal();
      },
    });
    confirm.container.position.set(
      ROSTER_BOX.x + Math.round((ROSTER_BOX.w - confirmW) / 2),
      ROSTER_BOX.bottom - CONFIRM_H,
    );
    R.addChild(confirm.container);

    const current = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fill: SLAB_BODY_FILL,
        align: 'center',
        dropShadow: TEXT_SHADOW,
      },
    });
    current.anchor.set(0.5, 1);
    current.position.set(ROSTER_W / 2, ROSTER_BOX.bottom - CONFIRM_H - 8);
    R.addChild(current);

    /**
     * 게이트 사유는 **위에서 아래로** 쌓지 않고 확정 버튼 위에 바닥 기준으로 붙인다 — 이
     * 문구는 만렙 미만이면 상시 보이므로 예산({@link ROSTER_FOOT_PAD})을 미리 잡아 두었다.
     */
    const locked = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT,
        fontSize: 15,
        fontWeight: '700',
        fill: WARN_FILL,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: ROSTER_BOX.w,
        lineHeight: 20,
        dropShadow: TEXT_SHADOW,
      },
    });
    locked.anchor.set(0.5, 1);
    locked.position.set(ROSTER_W / 2, ROSTER_BOX.bottom - CONFIRM_H - 30);
    R.addChild(locked);

    // --- 시그니처·섀시 패널 ---------------------------------------------------------
    const S = sigPanel.container;
    const sBox = {
      x: PANEL_EDGE_PAD,
      y: TITLED_BOX_Y,
      w: SIG_W - PANEL_EDGE_PAD * 2,
      h: SIG_H - TITLED_BOX_Y - PANEL_EDGE_PAD,
    };
    // 전투 역할 — 창에서 옮겨 왔다. 창 하단은 배경 원화가 자리마다 밝기가 달라 작은 글씨의
    // 대비를 보장할 수 없다(스크림을 그만큼 키우면 M8 이 지운 "창을 96px 지우는 스크림"이
    // 되돌아온다). 창에는 기체 이름 하나만 남긴다.
    const roleHead = new Text({
      resolution: 2,
      text: tShipKey('champion.role', 'Role'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 14,
        fontWeight: '700',
        fill: SLAB_BODY_FILL,
        dropShadow: TEXT_SHADOW,
      },
    });
    roleHead.position.set(sBox.x, sBox.y + SIG_ROLE_Y);
    S.addChild(roleHead);

    const role = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: sBox.w,
        lineHeight: 24,
        dropShadow: TEXT_SHADOW,
      },
    });
    role.position.set(sBox.x, sBox.y + SIG_ROLE_Y + 24);
    S.addChild(role);

    const sigHead = new Text({
      resolution: 2,
      text: tShipKey('champion.signature', 'Signature'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 14,
        fontWeight: '700',
        fill: SLAB_BODY_FILL,
        dropShadow: TEXT_SHADOW,
      },
    });
    sigHead.position.set(sBox.x, sBox.y + SIG_BODY_Y - 24);
    S.addChild(sigHead);

    const sigBody = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: sBox.w,
        lineHeight: 25,
        dropShadow: TEXT_SHADOW,
      },
    });
    sigBody.position.set(sBox.x, sBox.y + SIG_BODY_Y);
    S.addChild(sigBody);

    const chassisHead = new Text({
      resolution: 2,
      text: tShipKey('champion.chassis', 'Chassis'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 21,
        fontWeight: '800',
        fill: COLOR.gold,
        dropShadow: TEXT_SHADOW,
      },
    });
    chassisHead.position.set(sBox.x, sBox.y + SIG_CHASSIS_Y);
    S.addChild(chassisHead);

    /**
     * 섀시 4축은 **행**으로 내고 `현재 → 선택` 두 열을 나란히 둔다.
     *
     * 왜 두 열인가: 이 화면의 질문은 "이 기체가 좋은가"가 아니라 **"지금 타는 것과 비교해
     * 어떤가"** 다(퇴역은 되돌릴 수 없다). 선택값만 보여 주면 사용자가 직전 화면을 기억으로
     * 대조해야 한다. 4열 배치는 572px 폭에서 라벨이 잘리고 값이 라벨과 세로로 떨어져 어느
     * 축의 값인지 눈이 다시 이어붙여야 했다.
     */
    const nowX = sBox.x + Math.round(sBox.w * 0.62);
    const pickX = sBox.x + sBox.w - 6;
    const headStyle = {
      fontFamily: UI_FONT,
      fontSize: 14,
      fontWeight: '700' as const,
      fill: SLAB_BODY_FILL,
      dropShadow: TEXT_SHADOW,
    };
    const nowHead = new Text({
      resolution: 2,
      text: tShipKey('champion.chassis.now', 'Current'),
      style: headStyle,
    });
    nowHead.anchor.set(1, 0);
    nowHead.position.set(nowX, sBox.y + SIG_BP_HEAD_Y);
    S.addChild(nowHead);
    const pickHead = new Text({
      resolution: 2,
      text: tShipKey('champion.chassis.pick', 'Selected'),
      style: { ...headStyle, fill: COLOR.gold },
    });
    pickHead.anchor.set(1, 0);
    pickHead.position.set(pickX, sBox.y + SIG_BP_HEAD_Y);
    S.addChild(pickHead);

    const bpTop = sBox.y + SIG_BP_TOP_Y;
    const bp: { label: Text; now: Text; value: Text }[] = [];
    for (let i = 0; i < BP_ROWS.length; i++) {
      const y = bpTop + i * BP_ROW_H;
      const label = new Text({
        resolution: 2,
        text: '',
        style: { fontFamily: UI_FONT, fontSize: 18, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      label.position.set(sBox.x + 6, y);
      S.addChild(label);
      const now = new Text({
        resolution: 2,
        text: '',
        style: { fontFamily: UI_FONT, fontSize: 18, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      now.anchor.set(1, 0);
      now.position.set(nowX, y);
      S.addChild(now);
      const value = new Text({
        resolution: 2,
        text: '',
        style: {
          fontFamily: UI_FONT,
          fontSize: 22,
          fontWeight: '800',
          fill: SLAB_BODY_FILL,
          dropShadow: TEXT_SHADOW,
        },
      });
      value.anchor.set(1, 0);
      value.position.set(pickX, y - 3);
      S.addChild(value);
      bp.push({ label, now, value });
    }

    // 퇴역 경고 — 되돌릴 수 없는 조작이므로 확인 팝업 **전에** 상시 보인다(예비역 로스터가
    // 소멸 경고를 패널에 상시 노출한 것과 같은 판단).
    const warn = new Text({
      resolution: 2,
      text: t('champion.retire.warn'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 16,
        fill: WARN_FILL,
        wordWrap: true,
        wordWrapWidth: sBox.w,
        lineHeight: 22,
        dropShadow: TEXT_SHADOW,
      },
    });
    warn.anchor.set(0, 1);
    warn.position.set(sBox.x, sBox.y + sBox.h - SIG_WARN_BOTTOM_PAD);
    S.addChild(warn);

    // --- 스킬 계열 패널(카드 3장 나란히) --------------------------------------------
    const T = treePanel.container;
    const tBox = {
      x: PANEL_EDGE_PAD,
      y: TITLED_BOX_Y,
      w: TREE_W - PANEL_EDGE_PAD * 2,
      h: TREE_H - TITLED_BOX_Y - PANEL_EDGE_PAD,
    };
    // 계열 수는 기체마다 같다(레지스트리 계약) — 첫 타입에서 읽어 위젯을 미리 만든다.
    const treeCount = shipTypeDef(this.selected).trees.length;
    const gap = 16;
    const cardW = Math.floor((tBox.w - gap * (treeCount - 1)) / treeCount);
    const cardH = TREE_CARD_H;
    const trees: { name: Text; meta: Text; cap: Text; capDesc: Text }[] = [];
    for (let i = 0; i < treeCount; i++) {
      const card = new Container();
      card.position.set(tBox.x + i * (cardW + gap), tBox.y);
      T.addChild(card);
      // 계열색은 카드 테두리가 아니라 **제목 글자**가 낸다 — 밝은 링을 두르면 대비가 링에
      // 먹힌다(격납고 계약 §0-bis `iconContrastRingBands` 의 "밝은 링이 아니라 어두운 홈").
      const plate = rowPlate(cardW, cardH);
      card.addChild(plate.view);

      const name = new Text({
        resolution: 2,
        text: '',
        style: {
          fontFamily: UI_FONT,
          fontSize: 20,
          fontWeight: '800',
          fill: COLOR.cream,
          dropShadow: TEXT_SHADOW,
        },
      });
      name.position.set(14, 12);
      card.addChild(name);

      const meta = new Text({
        resolution: 2,
        text: '',
        style: { fontFamily: UI_FONT, fontSize: 14, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      meta.position.set(14, 42);
      card.addChild(meta);

      const cap = new Text({
        resolution: 2,
        text: '',
        style: {
          fontFamily: UI_FONT,
          fontSize: 16,
          fontWeight: '700',
          fill: COLOR.gold,
          wordWrap: true,
          wordWrapWidth: cardW - 28,
          lineHeight: 21,
          dropShadow: TEXT_SHADOW,
        },
      });
      cap.position.set(14, 70);
      card.addChild(cap);

      const capDesc = new Text({
        resolution: 2,
        text: '',
        style: {
          fontFamily: UI_FONT,
          fontSize: 13,
          fill: SLAB_BODY_FILL,
          wordWrap: true,
          wordWrapWidth: cardW - 28,
          lineHeight: 18,
          dropShadow: TEXT_SHADOW,
        },
      });
      capDesc.position.set(14, 114);
      card.addChild(capDesc);

      trees.push({ name, meta, cap, capDesc });
    }

    return { heroName, role, sigBody, bp, trees, confirm, current, locked };
  }

  /** 선택에 따라 갈리는 값 전부 + 히어로 도크를 갱신한다. 패널·배경은 다시 만들지 않는다. */
  private syncDetail(): void {
    const d = this.detail;
    if (d === null) return;
    const def = shipTypeDef(this.selected);

    d.heroName.text = shipTypeName(def);
    d.role.text = shipTypeRole(def);

    d.sigBody.text =
      def.signatureBit < 0
        ? tShipKey('champion.signature.none', 'No signature passive — a clean baseline chassis.')
        : shipSignatureDesc(def);
    d.sigBody.style.fill = def.signatureBit < 0 ? SLAB_BODY_FILL : COLOR.cream;

    const currentDef = shipTypeDef(activeShip(this.profile).typeId);
    BP_ROWS.forEach(([key, msgKey, fallback], i) => {
      const row = d.bp[i];
      if (row === undefined) return;
      const value = def.baseBp[key];
      row.label.text = tShipKey(msgKey, fallback);
      row.now.text = formatBp(currentDef.baseBp[key]);
      row.value.text = formatBp(value);
      row.value.style.fill = value > 0 ? 0x8affc0 : value < 0 ? WARN_FILL : SLAB_BODY_FILL;
    });

    const nodes = flattenShipNodes(def);
    d.trees.forEach((card, i) => {
      const tree = def.trees[i];
      const has = tree !== undefined;
      card.name.visible = has;
      card.meta.visible = has;
      card.cap.visible = has;
      card.capDesc.visible = has;
      if (tree === undefined) return;
      const accent = AFFINITY_ACCENT[tree.affinity];
      card.name.text = shipTreeName(tree);
      card.name.style.fill = accent;
      card.meta.text = tShipKey('champion.tree.meta', '{n} nodes · gate {g}', {
        n: def.nodesPerTree,
        g: def.capstoneGate,
      });
      const capstone = nodes[shipCapstoneIndex(def, i)];
      card.cap.text = capstone === undefined ? '' : `★ ${capstone.name}`;
      card.capDesc.text = capstone?.desc ?? '';
    });

    d.current.text = tShipKey('champion.current', 'Current: {name}', {
      name: shipTypeName(currentDef),
    });

    const gate = retireGate(this.profile);
    d.confirm.setLabel(
      tShipKey('champion.confirm', 'Retire & Switch', { name: shipTypeName(def) }),
    );
    d.confirm.setEnabled(gate.ok);
    const reason = this.hint !== '' ? this.hint : this.retireBlockedHint();
    d.locked.text = reason;
    d.locked.visible = reason !== '';

    this.renderDock(def);
  }

  /**
   * 히어로 창 안의 함선 — `shipDock` 이 접지 그림자·언더라이트·림을 **실루엣 바닥선에서
   * 파생**해 그린다(크래들은 사용자 판단으로 끈다).
   *
   * 쇼케이스는 **기체 타입 파생**이다. 아트가 아직 없으면 조용히 레거시 텍스처로 폴백하고,
   * 그것도 없으면 절차적 실루엣을 세워 창이 비지 않게 한다(아트는 코드보다 늦게 도착한다).
   */
  private renderDock(def: ShipTypeDef): void {
    const host = this.dockHost;
    if (host === null) return;
    this.dock = null;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }

    const shipTex = this.ui[shipShowcaseName(def.id)] ?? this.ui[LEGACY_SHOWCASE];
    const dock = makeShipDock({
      width: HERO_BOX.w,
      height: HERO_BOX.h,
      ship: shipTex ?? undefined,
      shipSize: SHIP_SIZE,
      cx: HERO_BOX.w / 2,
      cy: Math.round(HERO_BOX.h * SHIP_CY_K),
      // 크래들(받침)은 **사용자 판단으로 끈다**(2026-08-02). 접지 그림자·언더라이트·림은
      // 실루엣 바닥선에서 파생하므로 그대로 살아 있다 — 함선은 여전히 그림자를 드리운다.
      cradle: false,
    });
    dock.container.position.set(HERO_BOX.x, HERO_BOX.y);
    host.addChild(dock.container);
    this.dock = dock;

    if (!shipTex) {
      // 자산 결손 폴백 — 도크는 함선을 그리지 않았으므로 여기서 실루엣만 세운다.
      // ⚠️ 좌표는 **반환된 값**에서 파생시킨다(도크가 창 여백 때문에 함선을 올릴 수 있다).
      const cx = HERO_BOX.x + dock.shipX;
      const cy = HERO_BOX.y + dock.shipY;
      const g = new Graphics();
      g.moveTo(cx, cy - SHIP_SIZE * 0.34)
        .lineTo(cx + SHIP_SIZE * 0.28, cy + SHIP_SIZE * 0.3)
        .lineTo(cx - SHIP_SIZE * 0.28, cy + SHIP_SIZE * 0.3)
        .closePath()
        .fill({ color: 0x39d0ff })
        .stroke({ color: 0xffffff, width: 3 });
      host.addChild(g);
    }
  }

  // --- 목록 ----------------------------------------------------------------

  /** 행만 갈아끼운다. 배경·패널·헤더는 그대로 둔다(파일 헤더 "재렌더 규율"). */
  private renderList(): void {
    const host = this.listHost;
    if (host === null) return;

    this.rowSelect.clear();
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }

    const roster = selectableShipTypes();
    const totalH = rosterStackHeight(roster.length);
    const content = makeScrollArea(host, {
      x: ROSTER_BOX.x,
      y: ROSTER_LIST_TOP,
      w: ROSTER_BOX.w,
      h: ROSTER_LIST_AVAIL,
      totalH,
      get: () => this.scrollY,
      set: (v) => {
        this.scrollY = v;
      },
      thumb: true,
    });

    roster.forEach((def, i) => {
      const row = this.makeRosterRow(def);
      row.position.set(0, i * (ROSTER_ROW_H + ROSTER_ROW_GAP));
      content.addChild(row);
    });
  }

  private makeRosterRow(def: ShipTypeDef): Container {
    const row = new Container();
    const plate = rowPlate(ROSTER_BOX.w, ROSTER_ROW_H);
    row.addChild(plate.view);
    plate.setSelected(def.id === this.selected);
    this.rowSelect.set(def.id, plate.setSelected);
    // 클릭은 **행 Container** 에(바탕 Graphics 면 위 텍스트가 삼킨다).
    attachRowClick(row, () => this.select(def.id));

    // 초상은 목록용 아트(`shipPortraitName`)를 먼저 쓴다 — 예비역 로스터 행과 **같은 그림**이라
    // 두 목록이 같은 기체를 같은 얼굴로 말한다. 없으면 쇼케이스·레거시로 폴백한다.
    const tex =
      this.ui[shipPortraitName(def.id)] ??
      this.ui[shipShowcaseName(def.id)] ??
      this.ui[LEGACY_SHOWCASE];
    const iconY = Math.round((ROSTER_ROW_H - ROSTER_ICON) / 2);
    if (tex) {
      const sp = new Sprite(tex);
      sp.width = ROSTER_ICON;
      sp.height = ROSTER_ICON;
      sp.position.set(ROSTER_ICON_X, iconY);
      row.addChild(sp);
    }

    const name = new Text({
      resolution: 2,
      text: shipTypeName(def),
      style: {
        fontFamily: UI_FONT,
        fontSize: 22,
        fontWeight: '800',
        fill: def.id === this.selected ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.position.set(ROSTER_TEXT_X, 20);
    row.addChild(name);

    const role = new Text({
      resolution: 2,
      text: shipTypeRole(def),
      style: {
        fontFamily: UI_FONT,
        fontSize: 14,
        fill: SLAB_BODY_FILL,
        wordWrap: true,
        // 우측 여백에서 파생한다 — 하드코딩하면 초상을 키울 때 글자가 밖으로 나간다.
        wordWrapWidth: ROSTER_BOX.w - ROSTER_TEXT_X - 14,
        lineHeight: 19,
        dropShadow: TEXT_SHADOW,
      },
    });
    role.position.set(ROSTER_TEXT_X, 52);
    row.addChild(role);

    return row;
  }

  // --- 퇴역 확인 팝업 --------------------------------------------------------

  /**
   * 시네마틱 확인 팝업. **`makeModal` 을 쓰지 않는다** — 그 모듈은 나무 nine-slice 에 묶여 있고
   * 다른 화면 5곳이 쓰기 때문에 고치면 그 화면들이 같이 갈린다. 대신 `modal.ts` 헤더의 실측 규칙
   * 세 가지를 그대로 승계한다:
   *  ① 암막은 **완전 불투명 채움**(뒤 화면 글자가 비쳐 읽히는 결함).
   *  ② 암막이 **이벤트를 먹는다**(안 그러면 뒤 목록이 스크롤된다).
   *  ③ 패널 안쪽 탭은 암막까지 **전파를 끊는다**(안 그러면 팝업 안을 누를 때마다 닫힌다).
   *
   * 퇴역은 되돌릴 수 없으므로 **무엇을 잃는지 먼저 말한다** — 레벨·투자가 초기화되고, 장착
   * 장비는 창고로 돌아오지 않고 **그 수호기에 잠긴다**(ADR-0024). 잠긴 장비는 그 수호기를
   * 소멸시킬 때에만 창고로 반환된다(계보는 남는다).
   */
  private renderModal(): void {
    const host = this.modalHost;
    if (host === null) return;

    this.modalPanel?.destroy();
    this.modalPanel = null;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
    if (!this.confirming) return;

    const def = shipTypeDef(this.selected);
    const ship = activeShip(this.profile);

    // ① · ② 암막.
    const scrim = new Graphics();
    // ⚠️ 0.92 로는 **뒤 화면 글자가 그대로 읽혔다**(실화면 1차 확인). 예비역 로스터에서 0.92
    // 가 통한 이유는 그 화면의 뒤 밝기가 낮아서다 — 여기는 밝은 슬래브가 화면을 더 덮는다.
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: 0.96 });
    scrim.eventMode = 'static';
    scrim.on('pointertap', () => {
      this.confirming = false;
      this.renderModal();
    });
    host.addChild(scrim);

    const px = Math.round((DESIGN_WIDTH - CONFIRM_MODAL_W) / 2);
    const py = Math.round((DESIGN_HEIGHT - CONFIRM_MODAL_H) / 2);
    const panel = makeCinematicPanel({
      width: CONFIRM_MODAL_W,
      height: CONFIRM_MODAL_H,
      variant: 'slab',
      title: tShipKey('champion.retire.title', 'Retire your ship?'),
      screenX: px,
      screenY: py,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(px, py);
    // ③ 패널 안쪽 탭이 암막까지 내려가지 않게 막는다.
    stopRowPropagation(panel.container);
    host.addChild(panel.container);
    this.modalPanel = panel;

    const box = panel.box;
    const cx = box.x + box.w / 2;

    const body = new Text({
      resolution: 2,
      text: tShipKey(
        'champion.retire.body',
        'Your current ship (Lv {level}) becomes a Guardian. Level, skill points and gear slots reset; your equipped gear stays locked to that Guardian and returns to your stash only when you dismiss it. You will pilot a fresh {name}.',
        { level: ship.level, name: shipTypeName(def) },
      ),
      style: {
        fontFamily: UI_FONT,
        fontSize: 19,
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: box.w,
        align: 'center',
        lineHeight: 29,
        dropShadow: TEXT_SHADOW,
      },
    });
    body.anchor.set(0.5, 0);
    body.position.set(cx, box.y + 8);
    panel.container.addChild(body);

    /**
     * 버튼은 패널 **바닥 기준**으로 놓는다. 본문 줄 수가 로케일·기체명 길이에 따라 변하는데
     * 본문 아래에 이어 붙이면 긴 문장에서 패널 밖으로 밀린다.
     */
    const btnY = box.y + box.h - MODAL_BTN_H - 4;
    const gap = 20;
    const yesW = 280;
    const noW = 200;
    const startX = cx - (yesW + gap + noW) / 2;

    const yes = this.chromeButton({
      tone: 'red',
      width: yesW,
      height: MODAL_BTN_H,
      fontSize: 19,
      label: tShipKey('champion.retire.yes', 'Retire and switch'),
      onClick: () => this.confirm(),
    });
    yes.container.position.set(startX, btnY);
    panel.container.addChild(yes.container);

    const no = this.chromeButton({
      tone: 'stone',
      width: noW,
      height: MODAL_BTN_H,
      fontSize: 19,
      label: tShipKey('champion.retire.no', 'Cancel'),
      onClick: () => {
        this.confirming = false;
        this.renderModal();
      },
    });
    no.container.position.set(startX + yesW + gap, btnY);
    panel.container.addChild(no.container);
  }

}

/** 로스터에 실제로 나오는 타입 수 = 레지스트리 전량(해금 게이트 없음, ADR-0019). */
export function rosterSize(): number {
  return SHIP_TYPES.length;
}
