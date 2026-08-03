/**
 * 연구소 화면 — Pixi (2026-08-02 AAA 시네마틱 전환 · 레인 계약
 * `.omc/plans/research-lab-aaa-2026-08-02.md`).
 *
 * `main.ts` 가 직접 여는 **최상위 화면**이다(`researchLab.show(profile, () => openBaseMap())`) —
 * 격납고 하위 화면들과 달리 suspend/resume 이 아니라 show/onClose 규약이다. 스킬 트리 계열
 * 3종 × 20~25노드 + 캡스톤 투자(`investSkill`), 리스펙(`respecSkills`/`respecCost`), 파생 스탯
 * 미리보기(`computeSkillStats`), 액티브 스킬 장착(ADR-0041), i18n, Profile in-place 변이 +
 * `saveProfile` 를 담당한다.
 *
 * ## 시네마틱 전환에서 바뀐 것은 **바탕과 배치**뿐이다
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재 슬래브), `makeBanner` → `makeHangarTitle`,
 * `makeCurrencyChip` → `makeHangarChip`, `ui_btn_*.png` → `cinematicButtonTexture` 주입,
 * 자홍 카드 행(`listRowBg`) → 석재 행 판(`rowPlate`), 단색 배경 → `HangarBackdrop`.
 * 투자·리스펙·장착 계약과 저장 경로는 한 줄도 건드리지 않았다.
 *
 * ## 왜 배경 **창을 두지 않는가**(`windows: []`)
 * 형제 화면 셋의 결론: **창은 "배경이 보이는 구멍"이 아니라 "무언가를 보여주는 자리"다.**
 * 여기서 창에 세울 수 있는 피사체는 현역 기체 한 대뿐인데 이 화면에서 기체는 **바뀌지 않는다**
 * (교체는 챔피언 선택의 일이다) — 행을 눌러도 창 안 그림이 그대로다. 예비역 로스터에서 창을
 * 뺀 것과 같은 조건이다. 게다가 창은 최소 400px 폭을 요구해 계열 패널을 600 → 437 로 줄이는데,
 * 그러면 2열 투자 목록 한 칸이 194px 가 되어 이름이 포인트 배지에 눌린다 —
 * **정보 밀도가 이 화면의 목적이다**(격납고 계약 §0-bis-3). 배경 노출은 헤더 밴드와 패널 사이
 * 틈뿐이다.
 *
 * ## 스킬 **노드 격자·연결선은 만들지 않는다**
 * 4열×5행 노드 격자(ADR-0015 Consequences)는 **사용자 피드백으로 이미 철거**됐다. 지금 구조는
 * 본 패널이 그 계열에서 **찍은 노드만** 2열로 보여 주고, 전체 열람·투자는 **세로 스크롤 팝업**이
 * 맡는다. 격자와 연결선을 도로 만드는 것은 AAA 전환이 아니라 사용자가 되돌린 정보 설계를 다시
 * 되돌리는 일이라 이 레인의 범위 밖이다.
 *
 * ## 행 사이에 **선을 긋지 않는다**
 * 세로 리브·가로 이음선·각인 번호판은 사용자가 격납고에서 삭제를 지시한 것들이다(2026-08-02).
 * 행 구분은 선이 아니라 **면의 밝기 차 + 2단 접지 그림자 + 행 간격**이 만든다.
 *
 * ## 재렌더 규율 — 이 화면은 형제보다 더 자주 갱신된다
 * 클릭 한 번이 곧 투자라 값이 매번 바뀐다. `render()` 로 루트를 통째로 다시 그리면 노드를
 * 하나 찍을 때마다 배경과 석재 패널 4장이 다시 **구워진다**. 그래서
 *  - `buildChrome()` 은 1회(자산 도착·기체 타입 변경 시에만 재건),
 *  - `syncValues()` 가 칩·부제·캡스톤·파생 스탯·리스펙 라벨을,
 *  - `renderLists()` 가 계열 목록 행만,
 *  - 팝업은 `modalHost` 에서만 나고 진다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거)
 * - **목록 행 클릭은 행 Container 에.** 바탕 Graphics 에 걸면 위에 얹힌 텍스트가 클릭을 삼킨다.
 * - **휠은 클립 Container + hitArea 에.** 마스크 Graphics 는 히트 테스트에서 제외된다.
 * - **여백은 패널의 `box` 안에만.**
 * - 컬러 이모지 금지(`text.ts` stripEmoji 가 두부로 떨군다). `★ ✕` 는 보존 목록이다.
 * - ⚠️ `hudEl()` 에는 **캔버스 가드를 붙이지 않는다**(`typeof document.createElement !==
 *   'function'` 까지 검사하면 HUD 숨김이 통째로 죽는다 — 이 리포가 실제로 밟았다).
 * - ⚠️ 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드**다 — 그 자리 컨트롤은 통째로 클릭 불가가
 *   된다. 헤더 컨트롤은 전부 같은 세로 띠(y 26..78)에 가로로만 배치한다.
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { SkillNode } from '../../../data/skills.js';
import {
  shipTypeDef,
  flattenShipNodes,
  shipTreeRange,
  shipCapstoneIndex,
  type ShipTypeDef,
} from '../../../data/ships/index.js';
import type { StatKey } from '../../items/types.js';
import {
  computeSkillStats,
  shipCapstoneUnlocked,
  shipTreeBaseInvested,
  chainMissingPrereqs,
} from '../../items/skills.js';
import {
  activeSlotViews,
  equipActive,
  unequipActive,
  type ActiveSlotView,
} from '../../items/activeSkills.js';
import { ACTIVES_BY_SHIP } from '../../../data/ships/actives/index.js';
import {
  ACTIVE_SLOT_COUNT,
  activeSkillDescKey,
  activeSkillIconName,
  activeSkillNameKey,
} from '../../../data/ships/actives/types.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { shipTreeName, AFFINITY_ACCENT, tShipKey } from './shipLabels.js';
import {
  investSkill,
  respecSkills,
  applyRespecRefund,
  respecCost,
  totalInvested,
  saveProfile,
  activeShip,
  type KeyValueStore,
  type Profile,
} from '../../save/profile.js';
import { spendCurrencyOnServer } from '../../net/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW, iconContrastRingBands } from './theme.js';
import { loadUiTextures, skillIconName, type UiTextures } from './uiTextures.js';
import { PixiButton } from './button.js';
import { PixiTooltip } from './tooltip.js';
import { rectGridPositions } from './slotGrid.js';
import { makeScrollArea } from './scrollArea.js';
import { stopRowPropagation } from './listRow.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import {
  makeHangarTitle,
  makeHangarChip,
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';

// 계열 강조색(affinity 축)의 정본은 `./shipLabels.ts` 다 — 격납고·챔피언 선택도 같은 값을
// 쓰므로 이 화면 파일에 두면 다른 화면이 연구소 전체를 끌어오게 된다. 재수출만 한다.
export { AFFINITY_ACCENT } from './shipLabels.js';

/** 파생 스탯 미리보기 행: [StatKey, labelKey, isPercent]. DOM 판과 동일. */
const PREVIEW_ROWS: readonly [StatKey, MessageKey, boolean][] = [
  ['damagePct', 'lab.stat.damage', true],
  ['fireRatePct', 'lab.stat.fireRate', true],
  ['bulletCount', 'lab.stat.bulletCount', false],
  ['pierce', 'lab.stat.pierce', false],
  ['bulletSpeedPct', 'lab.stat.bulletSpeed', true],
  ['rangeFlat', 'lab.stat.range', false],
  ['maxHpFlat', 'lab.stat.maxHpFlat', false],
  ['maxHpPct', 'lab.stat.maxHp', true],
  ['dashCdPct', 'lab.stat.dashCd', true],
  ['moveSpeedPct', 'lab.stat.moveSpeed', true],
  ['magnetPct', 'lab.stat.magnet', true],
  ['xpPct', 'lab.stat.xp', true],
];

// ---------------------------------------------------------------------------
// 레이아웃(디자인 스페이스 1920×1080)
//
// 여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 격납고·촉매 보관함·예비역 로스터·
// 챔피언 선택과 **같은 값**이다. 형제 화면끼리 다르면 화면 전환에서 튄다.
// ---------------------------------------------------------------------------

/**
 * `cinematicPanel.ts` 콘텐츠 상자 기하의 **복제본**(출처: 그 파일의 `EDGE_PAD 24` ·
 * `CONTENT_GAP 16` · `TITLE_BAND_H = round(TITLE_SIZE 26 × 2)`).
 *
 * 왜 베끼는가: {@link INVESTED_LIST}·{@link POPUP_LIST}·{@link ACTIVES_PANEL} 이 스크롤 산술의
 * 전제라 **모듈 상수**여야 하는데(기존 테스트가 그 값으로 클램프 왕복을 검증한다) 패널 상자는
 * 런타임 객체다. 베낀 값이 조용히 어긋나면 목록 마지막 행이 영영 안 보이는데 예외도 로그도
 * 없다 — `tests/researchLabAaaLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조한다.
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
const BOTTOM_PAD = 28;

/** 계열 패널 열 수(레지스트리 계약 — 실제 패널 수는 `def().trees.length` 파생이다). */
const TREE_COLS = 3;
const PANEL_Y = HEADER_H + 8;
/** 파생 스탯 띠 — 6열×2행(행 28)이 상자에 들어가는 최소 높이에서 정한다. */
const STRIP_H = 152;
const STRIP_X = EDGE_X;
const STRIP_W = DESIGN_WIDTH - EDGE_X * 2;
const STRIP_Y = DESIGN_HEIGHT - BOTTOM_PAD - STRIP_H;
/** 계열 패널 세로는 **남는 자리 전부**다(빈 자리 금지 — 하드코딩하면 띠를 옮길 때 어긋난다). */
const PANEL_H = STRIP_Y - ROW_GAP_Y - PANEL_Y;

/** 계열 열 한 칸의 폭·x — 열 수에서 파생한다(3 을 박으면 계열 수가 다른 기체에서 삐져나온다). */
function treeColumnW(cols: number): number {
  if (cols <= 0) return 0;
  return Math.floor((STRIP_W - GUTTER_X * (cols - 1)) / cols);
}

function treeColumnX(col: number, cols: number): number {
  return EDGE_X + col * (treeColumnW(cols) + GUTTER_X);
}

/** 계열 패널 콘텐츠 상자(패널 로컬) — 위 복제 기하에서 파생. */
function treeBox(cols: number): { x: number; y: number; w: number; h: number; bottom: number } {
  const w = treeColumnW(cols) - PANEL_EDGE_PAD * 2;
  const h = PANEL_H - TITLED_BOX_Y - PANEL_EDGE_PAD;
  return { x: PANEL_EDGE_PAD, y: TITLED_BOX_Y, w, h, bottom: TITLED_BOX_Y + h };
}

const BOX = treeBox(TREE_COLS);

/** 전체 스킬 팝업을 여는 버튼(콘텐츠 상자 폭 전체) — 투자가 일어나는 유일한 진입점. */
const BROWSE_Y = BOX.y;
const BROWSE_H = 48;
const LIST_TOP = BROWSE_Y + BROWSE_H + 16;
const CAPSTONE_H = 60;
/** 캡스톤 바는 콘텐츠 상자 바닥에 붙인다 — 목록과의 간격이 자동으로 남는다. */
const CAPSTONE_Y = BOX.bottom - CAPSTONE_H;
/** 캡스톤 버튼 좌측 개별 아트 자리(라벨은 버튼 중앙이라 겹치지 않는다). */
const CAPSTONE_ICON = 40;
const CAPSTONE_ICON_X = 14;

/**
 * 투자 목록 셀: 2열. 스트라이커 20노드 = 10행 × 53 − 8 = 522 로 가용 536 안에 들어가므로 본
 * 패널에는 스크롤이 필요 없다(전체 열람은 팝업 몫). 해츨링 25노드는 13행 = 681 로 넘치므로
 * 목록은 스크롤 영역 안에 있어야 한다 — 두 성질 다 단위 테스트가 잠근다.
 */
const INV_COLS = 2;
const INV_GAP_X = 8;
const INV_GAP_Y = 8;
const INV_W = Math.floor((BOX.w - INV_GAP_X * (INV_COLS - 1)) / INV_COLS);
const INV_H = 45;
const INV_ICON = 32;

// --- 전체 스킬 팝업 ---
const POP_ROW_H = 65;
const POP_ROW_GAP = 4;
/** 행 피치 — 마스크 높이를 이 배수로 클램프해 반토막 행을 구조적으로 막는다. */
const POP_ROW_PITCH = POP_ROW_H + POP_ROW_GAP;
const POP_VISIBLE_ROWS = 11;
const POP_W = 900;
/** 팝업 세로는 **목록이 정한다**(빈 자리 금지 — 형제 화면 셋이 전부 잡아 고친 결함). */
const POP_SUB_GAP = 32;
const POP_LIST_TOP = TITLED_BOX_Y + POP_SUB_GAP;
const POP_H = POP_LIST_TOP + POP_VISIBLE_ROWS * POP_ROW_PITCH + PANEL_EDGE_PAD;
const POP_X = Math.round((DESIGN_WIDTH - POP_W) / 2);
const POP_Y = Math.round((DESIGN_HEIGHT - POP_H) / 2);
const PBOX = {
  x: PANEL_EDGE_PAD,
  y: TITLED_BOX_Y,
  w: POP_W - PANEL_EDGE_PAD * 2,
  right: POP_W - PANEL_EDGE_PAD,
  bottom: POP_H - PANEL_EDGE_PAD,
} as const;
const POP_ICON = 48;
/** 스크롤 막대 자리 — 행이 그 밑으로 들어가지 않도록 행 폭에서 미리 뺀다. */
const POP_BAR_W = 14;
const POP_ROW_W = PBOX.w - POP_BAR_W;

// --- 액티브 스킬 팝업(ADR-0041 · AC-16·17) ---
/**
 * 왜 **팝업**인가. 본 화면은 이미 꽉 차 있다 — 계열 패널 3장이 y=112..880 을 덮고 파생 스탯
 * 띠가 900..1052 를 덮는다. 게다가 패널 안 투자 목록의 가용 세로는 "스트라이커 20노드가
 * 스크롤 없이 들어간다"로 단위 테스트가 못 박아 둔 값이라, 액티브 칸을 패널 안에 끼우려고
 * 목록을 줄이면 그 단언이 즉시 깨진다. 그래서 전체 스킬 팝업과 같은 관용구를 재사용한다.
 */
const ACT_W = 1040;
const ACT_SUB_GAP = 32;
const ACT_SLOT_Y = TITLED_BOX_Y + ACT_SUB_GAP;
const ACT_SLOT_H = 78;
const ACT_SLOT_GAP = 14;
/** 계열 머리글 줄 → 그 아래가 (저티어/고티어) 2행 격자. */
const ACT_TREE_HEAD_Y = ACT_SLOT_Y + ACT_SLOT_H + 22;
const ACT_GRID_TOP = ACT_TREE_HEAD_Y + 32;
const ACT_COL_GAP = 14;
const ACT_CELL_H = 190;
const ACT_CELL_GAP_Y = 12;
const ACT_ROWS = 2;
/** 팝업 세로도 **격자가 정한다**(빈 자리 금지). */
const ACT_H = ACT_GRID_TOP + ACT_ROWS * ACT_CELL_H + ACT_CELL_GAP_Y * (ACT_ROWS - 1) + PANEL_EDGE_PAD;
const ACT_X = Math.round((DESIGN_WIDTH - ACT_W) / 2);
const ACT_Y = Math.round((DESIGN_HEIGHT - ACT_H) / 2);
const ABOX = {
  x: PANEL_EDGE_PAD,
  y: TITLED_BOX_Y,
  w: ACT_W - PANEL_EDGE_PAD * 2,
  right: ACT_W - PANEL_EDGE_PAD,
  bottom: ACT_H - PANEL_EDGE_PAD,
} as const;
const ACT_SLOT_W = Math.floor((ABOX.w - ACT_SLOT_GAP * (ACTIVE_SLOT_COUNT - 1)) / ACTIVE_SLOT_COUNT);
const ACT_ICON = 52;
/** 셀 안쪽 좌표(아이콘 상자 → 이름 → 상태 → 메타 → 설명). 겹침은 단위 테스트가 부등식으로 잠근다. */
const ACT_PAD = 12;
const ACT_NAME_X = ACT_PAD + ACT_ICON + 10;
const ACT_NAME_Y = 14;
const ACT_STATUS_Y = 82;
const ACT_META_Y = 106;
const ACT_DESC_Y = 130;
/** 티어 배지가 차지하는 우측 폭(이름이 그 밑으로 들어가지 않도록 미리 뺀다). */
const ACT_TIER_W = 58;

/** 헤더 컨트롤 치수. 좌상단 x<120 은 설정 톱니 예약 밴드라 132 부터 시작한다. */
const ACT_BTN_X = 132;
const ACT_BTN_W = 260;
const HEAD_GAP = 12;
const RESPEC_X = ACT_BTN_X + ACT_BTN_W + HEAD_GAP;
const RESPEC_W = 260;
/**
 * 각인 제목이 실제로 차지하는 가로 반폭. 실화면에서 "연구소 — 스킬 트리"가 ±237 을 먹어
 * 좌측 컨트롤(끝 744)과 **겹쳤다** — 중앙 정렬 Text 는 사각형이 없어 겹침 테스트가 못 잡는다.
 * 그래서 대역을 상수로 못 박고 좌우 컨트롤이 이 안에 들어오지 못하게 테스트로 잠근다.
 */
export const TITLE_BAND_HALF_W = 280;
const CHIP_W = 190;
const CLOSE_W = 56;
const CLOSE_X = DESIGN_WIDTH - EDGE_X - CLOSE_W;
const CREDIT_CHIP_X = CLOSE_X - HEAD_GAP - 2 - CHIP_W;
const POINT_CHIP_X = CREDIT_CHIP_X - HEAD_GAP - 2 - CHIP_W;
/** 헤더 컨트롤 아래 한 줄(총 투자·기체 레벨). 헤더 밴드 안에서 끝난다. */
const HEAD_SUB_Y = HEAD_Y + HEAD_H + 4;

// --- 파생 스탯 하단 가로 띠 ---
/** 띠 안쪽 콘텐츠 상자. 제목은 **각인 제목 띠**가 맡으므로 옛 제목 열 200 은 없앴다. */
const SBOX = {
  x: PANEL_EDGE_PAD,
  y: TITLED_BOX_Y,
  w: STRIP_W - PANEL_EDGE_PAD * 2,
  right: STRIP_W - PANEL_EDGE_PAD,
  h: STRIP_H - TITLED_BOX_Y - PANEL_EDGE_PAD,
} as const;
const STRIP_SYN_W = 360;
const STAT_COLS = 6;
const STAT_ROW_H = 28;
const STAT_COL_W = Math.floor((SBOX.w - STRIP_SYN_W - 24) / STAT_COLS);
const STAT_X = SBOX.x;

const HINT_Y = DESIGN_HEIGHT - 4;

/**
 * 좌상단 예약 밴드 — `main.ts` SettingsScreen 의 설정 톱니가 쓰는 **전 화면 공용 자리**다.
 * 톱니는 매 프레임 stage 최상위로 올라오므로 여기에 컨트롤을 두면 통째로 클릭 불가가 된다.
 */
export const GEAR_BAND_W = 120;
export const GEAR_BAND_H = 120;

/** 석재 슬래브 위 **보조 텍스트색**(챔피언 선택 `SLAB_BODY_FILL` 복제 — 그 파일은 화면이다). */
const SLAB_BODY_FILL = 0xe4dac7;
/** 행 판 바탕색·홈·반경 — 예비역 로스터 `rowPlate` → 챔피언 선택 경유 복제. */
const ROW_FACE = 0x3b3327;
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;

/** 화면 좌표 사각형(디자인 스페이스). */
export interface ResearchLabRect {
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
export function researchLabLayout(cols = TREE_COLS): {
  readonly screen: ResearchLabRect;
  readonly headerH: number;
  readonly panels: readonly { readonly id: string; readonly rect: ResearchLabRect }[];
  readonly headerControls: readonly { readonly id: string; readonly rect: ResearchLabRect }[];
  /** 배경이 보존되는 창 — **없다**(파일 헤더 "왜 배경 창을 두지 않는가"). */
  readonly windows: readonly ResearchLabRect[];
} {
  const w = treeColumnW(cols);
  const head = (x: number, cw: number): ResearchLabRect => ({ x, y: HEAD_Y, w: cw, h: HEAD_H });
  const panels: { id: string; rect: ResearchLabRect }[] = [];
  for (let i = 0; i < cols; i++) {
    panels.push({ id: `tree:${i}`, rect: { x: treeColumnX(i, cols), y: PANEL_Y, w, h: PANEL_H } });
  }
  panels.push({ id: 'stats', rect: { x: STRIP_X, y: STRIP_Y, w: STRIP_W, h: STRIP_H } });
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels,
    headerControls: [
      { id: 'actives', rect: head(ACT_BTN_X, ACT_BTN_W) },
      { id: 'respec', rect: head(RESPEC_X, RESPEC_W) },
      { id: 'points', rect: head(POINT_CHIP_X, CHIP_W) },
      { id: 'credits', rect: head(CREDIT_CHIP_X, CHIP_W) },
      { id: 'close', rect: head(CLOSE_X, CLOSE_W) },
    ],
    windows: [],
  };
}

/**
 * 계열에서 **포인트를 투자한** base 노드의 flat 인덱스 목록(flat 순서 = 티어 오름차순).
 * 캡스톤은 별도 바가 맡으므로 제외한다. 손상/짧은 벡터도 안전(누락 = 0).
 *
 * ⚠️ M8: 축이 트리 **이름**(`'firepower'|…`)에서 **(타입 정의, 트리 인덱스)** 로 바뀌었다.
 * 이름 축을 남기면 신규 기체의 계열이 이 함수에 아예 들어올 수 없고(타입이 3리터럴), 슬라이스
 * 폭도 스트라이커의 20 으로 고정돼 비온(25)에서 다섯 칸이 조용히 잘린다.
 *
 * 순수 함수(Pixi 미의존) — 본 패널이 "찍은 것만" 보이는 규칙의 진실의 원천이다.
 */
export function investedNodeIndices(
  invest: readonly number[],
  def: ShipTypeDef,
  treeIndex: number,
): number[] {
  const { start, end } = shipTreeRange(def, treeIndex);
  const out: number[] = [];
  for (let i = start; i < end; i++) {
    if ((invest[i] ?? 0) > 0) out.push(i);
  }
  return out;
}

/**
 * `count` 개를 `cols` 열로 쌓았을 때의 목록 총 세로(마지막 행 뒤 간격 제외). 순수 함수 —
 * 본 패널 목록이 스크롤 없이 들어가는지, 팝업 목록의 스크롤 총량이 얼마인지를 같은 식으로 센다.
 */
export function listStackHeight(count: number, cols: number, rowH: number, gapY: number): number {
  if (count <= 0 || cols <= 0) return 0;
  return Math.ceil(count / cols) * (rowH + gapY) - gapY;
}

/**
 * 본 패널 투자 목록의 레이아웃 수치. 상수를 건드려 20노드가 더 이상 안 들어가게 되면 단위
 * 테스트가 즉시 깨지도록 산술 전제를 여기로 노출한다(스크롤 없는 목록이 이 배치의 전제다).
 */
export const INVESTED_LIST = {
  cols: INV_COLS,
  cellW: INV_W,
  cellH: INV_H,
  gapX: INV_GAP_X,
  gapY: INV_GAP_Y,
  /** 목록에 쓸 수 있는 세로(콘텐츠 상자 안, 캡스톤 바 위까지). */
  avail: CAPSTONE_Y - 16 - LIST_TOP,
  /** 콘텐츠 상자 폭 — 2열이 간격까지 포함해 정확히 이 안에 들어가야 한다. */
  boxW: BOX.w,
} as const;

/** 팝업 목록의 레이아웃 수치(마스크 하한·행 피치 — 반토막 행 금지의 산술 전제). */
export const POPUP_LIST = {
  rowH: POP_ROW_H,
  gapY: POP_ROW_GAP,
  pitch: POP_ROW_PITCH,
  top: POP_LIST_TOP,
  /** 마스크 하한(패널 로컬) = 콘텐츠 상자 바닥. */
  bottom: PBOX.bottom,
  rowW: POP_ROW_W,
} as const;

/** 액티브 격자의 셀 폭. 열 수 = **그 기체의 계열 수**다(3 을 상수로 박으면 삐져나온다). */
export function activeCellWidth(cols: number): number {
  if (cols <= 0) return 0;
  return Math.floor((ABOX.w - ACT_COL_GAP * (cols - 1)) / cols);
}

/** 액티브 팝업의 레이아웃 수치(단위 테스트가 좌표 부등식으로 겹침을 잠근다). */
export const ACTIVES_PANEL = {
  w: ACT_W,
  h: ACT_H,
  boxX: ABOX.x,
  boxY: ABOX.y,
  boxW: ABOX.w,
  boxBottom: ABOX.bottom,
  subY: ABOX.y,
  slotY: ACT_SLOT_Y,
  slotH: ACT_SLOT_H,
  slotW: ACT_SLOT_W,
  slotGap: ACT_SLOT_GAP,
  treeHeadY: ACT_TREE_HEAD_Y,
  gridTop: ACT_GRID_TOP,
  cellH: ACT_CELL_H,
  cellGapY: ACT_CELL_GAP_Y,
  colGap: ACT_COL_GAP,
  pad: ACT_PAD,
  icon: ACT_ICON,
  nameX: ACT_NAME_X,
  nameY: ACT_NAME_Y,
  statusY: ACT_STATUS_Y,
  metaY: ACT_META_Y,
  descY: ACT_DESC_Y,
  tierW: ACT_TIER_W,
  /** 격자 행 수 = 티어 2종(저/고). */
  rows: ACT_ROWS,
} as const;

/** 액티브 한 칸의 격자 배치(계열 = 열, 티어 = 행). 순수 — 렌더와 테스트가 같은 식을 쓴다. */
export interface ActiveGridCell {
  readonly view: ActiveSlotView;
  readonly col: number;
  readonly row: number;
  /** 팝업 로컬 좌표(콘텐츠 상자 기준으로 이미 더해진 값). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

/**
 * 6칸을 (계열 × 티어) 격자에 앉힌다. 계열 인덱스가 열, 저/고 티어가 행이다 — "계열별로
 * 액티브 2칸이 보인다"(AC-16)를 배치로 직접 표현한다. 범위 밖 `treeIndex` 는 버린다(손상 방어).
 */
export function activeGridCells(views: readonly ActiveSlotView[], cols: number): ActiveGridCell[] {
  const w = activeCellWidth(cols);
  const out: ActiveGridCell[] = [];
  for (const view of views) {
    const col = view.def.treeIndex;
    if (col < 0 || col >= cols) continue;
    const row = view.def.tier === 'lo' ? 0 : 1;
    out.push({
      view,
      col,
      row,
      x: ABOX.x + col * (w + ACT_COL_GAP),
      y: ACT_GRID_TOP + row * (ACT_CELL_H + ACT_CELL_GAP_Y),
      w,
    });
  }
  return out;
}

/**
 * 마스크 높이를 행 피치의 배수로 내림한다(반토막 행 금지 — 반쪽 셀이 보이면 사용자는
 * "삐져나왔다"고 인지한다). 한 행도 못 들어가면 가용 높이를 그대로 쓴다. 순수 함수.
 */
export function clampToRowHeight(avail: number, pitch: number): number {
  if (pitch <= 0 || avail < pitch) return Math.max(0, avail);
  return Math.floor(avail / pitch) * pitch;
}

/** 스크롤 위치를 [0, totalH - viewH] 로 클램프(순수). 내용이 짧으면 항상 0. */
export function clampScroll(v: number, totalH: number, viewH: number): number {
  const max = Math.max(0, totalH - viewH);
  return Math.max(0, Math.min(max, v));
}

// --- 행 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 행 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 *
 * (예비역 로스터 `rowRamp` → 챔피언 선택 경유 복제. 형제 화면이라 같은 값이어야 하고, 그
 * 파일들은 공용 모듈이 아니라 화면이라 import 하지 않는다.)
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
   * 상태 링. **구분선이 아니라 상태 표시다** — 행 사이를 가르는 선은 표의 괘선으로 읽혀
   * 금지지만, 무엇을 이미 찍었는지/만렙인지는 이 목록이 말해야 하는 유일한 정보다.
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
 * 아이콘 자리 뒤에 까는 대비 홈({@link iconContrastRingBands} 근거). 스프라이트보다 먼저
 * 넣어 **뒤에** 깔리게 한다 — 아이콘을 가리지 않고 가장자리에서만 보인다.
 *
 * 홈은 아이콘 상자 밖으로 밴드 폭(44px 기준 2px)만 나가므로, 아이콘을 놓는 자리마다
 * {@link iconRingMargin} 이상의 여백만 잡으면 셀 밖으로 삐져나올 수 없다.
 */
function iconContrastRing(x: number, y: number, size: number): Graphics {
  const g = new Graphics();
  for (const b of iconContrastRingBands(size)) {
    g.roundRect(x - b.inset, y - b.inset, size + b.inset * 2, size + b.inset * 2, b.radius).stroke({
      color: b.color,
      width: b.width,
      alpha: b.alpha,
      alignment: 0.5,
    });
  }
  return g;
}

/** 홈이 아이콘 상자 밖으로 나가는 최대 px(= 밴드 폭). 자리 여백의 하한이다. */
function iconRingMargin(size: number): number {
  return Math.max(...iconContrastRingBands(size).map((b) => b.inset + b.width / 2));
}

/**
 * 스킬 아이콘 한 장을 **주어진 상자 안에만** 그린다(홈 포함). 상자보다 큰 그림이 셀 밖으로
 * 걸치는 결함을 코드로 막는다: 실제 스프라이트 변은 `size - 홈여백 × 2` 로 줄여 놓고 상자
 * 가운데에 앉힌다. 텍스처가 없으면 계열색 플레이스홀더로 폴백한다(자산 한 장이 빠져도 화면은
 * 죽지 않는다 — uiTextures null 폴백 규약).
 */
function makeSkillIcon(
  tex: Texture | null | undefined,
  boxX: number,
  boxY: number,
  boxSize: number,
  accent: number,
  bright: boolean,
): Container {
  const root = new Container();
  // 홈이 상자 밖으로 나가지 않도록 그림을 먼저 줄인다(2회 반복 없이 한 번에 수렴하는 근사).
  const margin = Math.ceil(iconRingMargin(boxSize));
  const size = Math.max(8, boxSize - margin * 2);
  const x = boxX + Math.round((boxSize - size) / 2);
  const y = boxY + Math.round((boxSize - size) / 2);
  root.addChild(iconContrastRing(x, y, size));
  if (tex) {
    const sp = new Sprite(tex);
    sp.width = size;
    sp.height = size;
    sp.position.set(x, y);
    root.addChild(sp);
  } else {
    const g = new Graphics();
    g.roundRect(x, y, size, size, Math.max(4, Math.round(size * 0.18)))
      .fill({ color: 0x000000, alpha: 0.28 })
      .stroke({ color: accent, width: 2, alpha: bright ? 0.9 : 0.45 });
    root.addChild(g);
  }
  return root;
}

/**
 * 액티브 한 칸의 파생 수치 한 줄(쿨다운 초 · 위력 %). 둘 다 `skillInvest` 파생이라
 * 투자를 늘리면 그 자리에서 값이 바뀐다(AC-13 이 화면에 보이는 유일한 자리다).
 */
function activeMetaLine(view: ActiveSlotView): string {
  return t('lab.actives.meta', {
    cd: (view.cooldownTicks / 60).toFixed(1),
    p: view.powerCenti,
  });
}

/** 계열 패널 하나가 들고 있는 갱신 대상 위젯들. */
interface TreeSlot {
  readonly panel: CinematicPanel;
  readonly browse: PixiButton;
  readonly listHost: Container;
  readonly capstoneHost: Container;
  readonly cols: number;
}

export class ResearchLabScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private hint = '';
  private ui: UiTextures = {};
  private art: HangarTextures = {};
  /** 열려 있는 전체 스킬 팝업의 **계열 인덱스**(null = 닫힘). */
  private popupTree: number | null = null;
  private popupScrollY = 0;
  /** 액티브 스킬 팝업이 열려 있는가(AC-16·17). 전체 스킬 팝업과 상호 배타다. */
  private activesOpen = false;
  /** 본 패널 투자 목록의 계열별 스크롤 위치(노드가 많은 타입에서만 쓰인다). */
  private readonly listScrollY: number[] = [0, 0, 0];
  /** 진입 시점의 런 HUD `visibility` 인라인 값(닫을 때 그대로 되돌린다). */
  private hudPrevVisibility: string | null = null;
  /**
   * 리스펙 재화 차감(`spend_currency`)의 서버 왕복이 진행 중인지 — 동시(재진입) 클릭 가드.
   * async `respec()` 의 사전검사와 첫 await 사이에 두 번째 클릭이 끼어들면 둘 다 검사를 통과해
   * 크레딧이 이중 차감되므로(온라인 ok 경로), 네트워크 창 동안 이 플래그로 재진입을 막는다.
   */
  private busy = false;

  // --- 유지되는 크롬(파일 헤더 "재렌더 규율") ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  private modalPanel: CinematicPanel | null = null;
  private chromeBuilt = false;
  /** 크롬을 세운 시점의 기체 타입 id — 바뀌면 계열 구성이 달라지므로 재건한다. */
  private builtForTypeId = -1;
  private trees: TreeSlot[] = [];
  private chipHost: Container | null = null;
  private statsHost: Container | null = null;
  private modalHost: Container | null = null;
  private headSub: Text | null = null;
  private hintText: Text | null = null;
  private respecBtn: PixiButton | null = null;
  private activesBtn: PixiButton | null = null;

  /**
   * 현재 편집 대상 = **활성 기체의 타입 정의**. 화면 전체가 이 하나에서 파생된다
   * (트리 수·노드 수·게이트·캡스톤 인덱스). 스트라이커 정본 상수를 직접 읽으면 비온(25노드,
   * 게이트 44)에서 그리드가 붕괴하고 캡스톤 잠금이 오판정된다.
   */
  private def(): ShipTypeDef {
    return shipTypeDef(activeShip(this.profile).typeId);
  }

  /**
   * 투자 벡터의 **정본**(M8 v4) = 활성 기체 벡터. `profile.skillInvest`(폐기 예정 별칭)를
   * 읽으면 M8-L7 이 그 필드를 지우는 순간 화면이 통째로 끊긴다.
   */
  private invest(): number[] {
    return activeShip(this.profile).skillInvest;
  }

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    this.root.addChild(this.tooltip.container);
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

  /**
   * 매 프레임 연출 진행. `dt` 는 **벽시계 초**다. `main.ts` 가 매 프레임 부르고, 숨겨져 있으면
   * 즉시 반환하므로 연구소 밖 비용은 0 이다.
   */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const p of this.panels) p.update(dt);
    this.modalPanel?.update(dt);
  }

  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.hint = '';
    // 캔버스 화면은 다음 화면이 자동으로 덮어 주지 않으므로 팝업 상태를 직접 되돌린다.
    this.popupTree = null;
    this.popupScrollY = 0;
    this.activesOpen = false;
    // 기체가 바뀌었으면 계열 구성이 달라진다 — 크롬을 다시 세운다.
    if (this.chromeBuilt && this.builtForTypeId !== this.def().id) this.destroyChrome();
    this.buildChrome();
    this.refresh();
    this.root.visible = true;
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    this.hideRunHud();
  }

  hide(): void {
    this.root.visible = false;
    this.tooltip.hide();
    this.onClose = null;
    this.popupTree = null;
    this.popupScrollY = 0;
    this.activesOpen = false;
    this.restoreRunHud();
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

  /** HUD 를 감추되 **진입 시점의 값을 기억**한다(닫을 때 그대로 되돌린다). */
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

  private persist(): void {
    // ⚠️ 명시적 null 은 `saveProfile` 의 기본 인자를 밀어내고 즉시 return 된다 — main.ts 가
    // store 없이 이 화면을 만들기 때문에 그대로 넘기면 스킬 투자가 저장되지 않는다.
    saveProfile(this.profile, this.store ?? undefined);
  }

  // --- 투자 / 리스펙 (DOM 판과 동일 규칙) ----------------------------------

  /**
   * 사슬 선행 조건(ADR-0047)이 `index` 를 막고 있으면 그 문구를, 아니면 null 을 돌려준다.
   *
   * 부족한 노드가 여럿이어도 **가장 낮은 티어 하나만** 이름으로 보여 주고 나머지는 `외 N개`
   * 로 접는다 — 행 한 줄에 이름을 여럿 욱여넣으면 폭이 터지고, 어차피 플레이어가 다음에
   * 눌러야 할 칸은 가장 낮은 티어 하나다. `chainMissingPrereqs` 가 티어 오름차순이라 `[0]`
   * 이 곧 그 칸이다. 캡스톤은 사슬 밖이라 항상 null 이다(게이트 문구는 `investCapstone` 이 낸다).
   */
  private prereqText(index: number, forHint: boolean): string | null {
    const def = this.def();
    const invest = this.invest();
    const missing = chainMissingPrereqs(invest, def, index);
    const first = missing[0];
    if (first === undefined) return null;
    const node = flattenShipNodes(def)[first];
    if (node === undefined) return null;
    const args = { name: node.name, cur: invest[first] ?? 0, max: node.maxPoints };
    if (forHint) return t('lab.err.chainLocked', args);
    return missing.length > 1
      ? t('lab.node.prereqMore', { ...args, n: missing.length - 1 })
      : t('lab.node.prereq', args);
  }

  private investNode(index: number): void {
    if (!investSkill(this.profile, index)) {
      // 우선순위: 포인트 없음 → 사슬 잠김 → 이미 최대. 사슬 잠김을 maxed 보다 먼저 봐야
      // "이미 최대까지 투자했습니다"라는 거짓 안내가 잠긴 칸에 뜨지 않는다.
      this.hint =
        this.profile.skillPoints <= 0
          ? t('lab.err.noPoints')
          : (this.prereqText(index, true) ?? t('lab.err.maxed'));
      this.refresh();
      return;
    }
    this.hint = '';
    this.persist();
    this.refresh();
  }

  private investCapstone(index: number, unlocked: boolean): void {
    if (!unlocked) {
      // 게이트 폭은 타입별이다(스트라이커·브루저·아크·팬텀 40, 비온 44) — 상수를 박으면 거짓말.
      this.hint = t('lab.capstone.needGate', { g: this.def().capstoneGate });
      this.refresh();
      return;
    }
    this.investNode(index);
  }

  private async respec(): Promise<void> {
    // 동시(재진입) 클릭 가드: 서버 왕복 중 두 번째 클릭이 두 번째 차감을 일으키지 못하게 막는다.
    if (this.busy) return;
    // 사전 게이트(투자 有 · 로컬 미러 잔액 충분)는 그대로 — 재화 서버 권위(ADR-0027)에서도
    // UX 즉시성을 위해 미러로 먼저 거른다(서버가 최종 재검증).
    if (totalInvested(this.profile) === 0) {
      this.hint = t('lab.err.noInvest');
      this.refresh();
      return;
    }
    const cost = respecCost(this.profile);
    if (this.profile.credits < cost) {
      this.hint = t('lab.err.noCredits', { n: cost });
      this.refresh();
      return;
    }
    // 네트워크 창을 잠근다 — 사전검사~첫 await 사이 재진입을 막아 크레딧 이중 차감(온라인 ok
    // 경로에서 두 번째 applyRespecRefund 는 0 환급이라 유저만 크레딧 이중 손실)을 차단한다.
    this.busy = true;
    try {
      // 온라인 → spend_currency 로 차감 확정(ok 일 때만 환급). 미설정 → 기존 로컬 차감(respecSkills).
      // 잔액 부족·오프라인(rejected)이면 환급하지 않는다(스킬 포인트 무상 환급 위조 차단).
      const res = await spendCurrencyOnServer(cost, 0, 'respec');
      if (res.status === 'ok') {
        this.profile.credits = res.creditsLeft;
        this.profile.minerals = res.mineralsLeft;
        applyRespecRefund(this.profile);
      } else if (res.status === 'unconfigured') {
        if (!respecSkills(this.profile)) {
          this.refresh();
          return;
        }
      } else if (res.reason === 'insufficient') {
        // 서버 원장이 판정해 거부했다. 로컬 미러는 치트·오프라인 가산으로 부풀 수 있으므로
        // **서버 잔액을 그대로 보여준다** — "크레딧이 부족합니다" 한 줄만 내면 크레딧을 잔뜩 든
        // 유저에게 거짓말이 된다(격납고 창고 확장에서 실제로 신고된 오탐과 같은 부류).
        this.hint = t('spend.err.rejectedCredits', { n: cost, have: res.creditsLeft });
        this.refresh();
        return;
      } else {
        // 판정 자체를 못 받았다(오프라인·네트워크 오류). 차감도 환급도 없다.
        this.hint = t('spend.err.unavailable');
        this.refresh();
        return;
      }
      this.hint = t('lab.respecDone');
      this.persist();
      this.refresh();
    } finally {
      this.busy = false;
    }
  }

  private openPopup(tree: number): void {
    this.popupTree = tree;
    this.popupScrollY = 0;
    this.activesOpen = false;
    this.hint = '';
    this.tooltip.hide();
    this.refresh();
  }

  private closePopup(): void {
    this.popupTree = null;
    this.popupScrollY = 0;
    this.refresh();
  }

  // --- 액티브 스킬 장착(AC-16·17) -------------------------------------------

  /** 지금 기체의 6칸 표시 상태. 해금·쿨다운·위력은 전부 `skillInvest` 파생이다(AC-13). */
  private activeViews(): ActiveSlotView[] {
    const ship = activeShip(this.profile);
    return activeSlotViews(ship.typeId, this.invest(), ship.activeSlots);
  }

  private openActives(): void {
    this.activesOpen = true;
    this.popupTree = null;
    this.hint = '';
    this.tooltip.hide();
    this.refresh();
  }

  private closeActives(): void {
    this.activesOpen = false;
    this.refresh();
  }

  /**
   * 빈 슬롯에 끼운다. 거부 사유별로 다른 안내를 낸다 — "장착이 안 된다"는 한 줄만 내면
   * 잠긴 것인지 슬롯이 찬 것인지 유저가 구분할 수 없다.
   *
   * 저장은 **연구소가 이미 쓰는 경로**(`persist()` → `saveProfile`) 그대로다. 새 저장 경로를
   * 만들면 스킬 투자와 장착이 서로 다른 시점에 기록돼 한쪽만 살아남는 상태가 생긴다.
   */
  private equip(id: string): void {
    const ship = activeShip(this.profile);
    const res = equipActive(ship.typeId, this.invest(), ship.activeSlots, id);
    if (!res.ok) {
      this.hint =
        res.reason === 'locked'
          ? t('lab.err.activeLocked')
          : res.reason === 'slots-full'
            ? t('lab.err.activeFull')
            : '';
      this.refresh();
      return;
    }
    ship.activeSlots = res.slots;
    this.hint = '';
    this.persist();
    this.refresh();
  }

  private unequip(slotIndex: number): void {
    const ship = activeShip(this.profile);
    if ((ship.activeSlots[slotIndex] ?? null) === null) return;
    ship.activeSlots = unequipActive(ship.activeSlots, slotIndex);
    this.hint = '';
    this.persist();
    this.refresh();
  }

  // --- 툴팁 ----------------------------------------------------------------

  private showTip(index: number, accent: number, globalX: number, globalY: number): void {
    const node = flattenShipNodes(this.def())[index];
    if (node === undefined) return;
    const cur = this.invest()[index] ?? 0;
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.show(
      { title: node.name, titleColor: accent, subtitle: `${cur} / ${node.maxPoints} pt`, lines: [node.desc] },
      p.x,
      p.y,
      accent,
    );
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private moveTip(globalX: number, globalY: number): void {
    if (!this.tooltip.container.visible) return;
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.container.position.set(
      Math.min(p.x + 14, DESIGN_WIDTH - this.tooltip.container.width),
      Math.min(p.y + 14, DESIGN_HEIGHT - this.tooltip.container.height),
    );
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
    // 연출 참조를 먼저 끊는다 — destroy 된 컨테이너를 update 가 만지면 안 된다.
    this.backdrop?.destroy();
    this.backdrop = null;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.modalPanel?.destroy();
    this.modalPanel = null;
    this.trees = [];
    this.chipHost = null;
    this.statsHost = null;
    this.modalHost = null;
    this.headSub = null;
    this.hintText = null;
    this.respecBtn = null;
    this.activesBtn = null;
    for (const child of [...this.root.children]) {
      if (child === this.tooltip.container) continue;
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    this.chromeBuilt = false;
  }

  private buildChrome(): void {
    if (this.chromeBuilt) return;
    const def = this.def();

    // 바닥 — 배경 자산이 없거나 실패해도 화면이 비지 않게(불투명, 뒤 아레나를 가린다).
    // 이벤트도 여기서 막는다(뒤 화면으로 클릭·휠이 새지 않게).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    // ⚠️ `view` 는 root 맨 뒤에 그대로 붙이고 스케일·이동을 걸지 마라(공기 마스크가 `view` 의
    // 자식이라 어긋난다). 창은 두지 않는다 — 파일 헤더 참조.
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    // ⚠️ **위 → 아래 순서로 붙인다.** 패널 접지 그림자는 아래로 59px 번지는데 행 간격은 20 이라,
    // 순서가 뒤집히면 위 패널의 그림자가 아래 패널 **위에** 얹혀 얼룩으로 읽힌다.
    const cols = def.trees.length;
    const colW = treeColumnW(cols);
    const box = treeBox(cols);
    for (let i = 0; i < cols; i++) {
      const treeDef = def.trees[i];
      if (treeDef === undefined) continue;
      const px = treeColumnX(i, cols);
      const panel = this.addPanel(px, PANEL_Y, colW, PANEL_H, shipTreeName(treeDef));

      const browse = this.chromeButton({
        tone: 'blue',
        width: box.w,
        height: BROWSE_H,
        fontSize: 17,
        label: '',
        onClick: () => this.openPopup(i),
      });
      browse.container.position.set(box.x, BROWSE_Y);
      panel.container.addChild(browse.container);

      const listHost = new Container();
      panel.container.addChild(listHost);
      const capstoneHost = new Container();
      panel.container.addChild(capstoneHost);

      this.trees.push({ panel, browse, listHost, capstoneHost, cols });
    }

    // 파생 스탯 띠.
    const strip = this.addPanel(STRIP_X, STRIP_Y, STRIP_W, STRIP_H, t('lab.derivedStats'));
    const statsHost = new Container();
    strip.container.addChild(statsHost);
    this.statsHost = statsHost;

    const syn = new Text({
      resolution: 2,
      text: t('lab.synergy'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: SLAB_BODY_FILL,
        wordWrap: true,
        wordWrapWidth: STRIP_SYN_W,
        lineHeight: 17,
        dropShadow: TEXT_SHADOW,
      },
    });
    syn.anchor.set(0, 0.5);
    syn.position.set(SBOX.right - STRIP_SYN_W, SBOX.y + SBOX.h / 2);
    strip.container.addChild(syn);

    this.buildHeader();

    const hintText = new Text({
      resolution: 2,
      text: '',
      style: { fontFamily: UI_FONT, fontSize: 17, fontWeight: '700', fill: 0xff9a7a, dropShadow: TEXT_SHADOW },
    });
    hintText.anchor.set(0.5, 1);
    hintText.position.set(DESIGN_WIDTH / 2, HINT_Y);
    this.root.addChild(hintText);
    this.hintText = hintText;

    // 팝업은 항상 맨 위에 뜬다 — 그릇을 마지막에 붙인다(툴팁만 그 위).
    const modal = new Container();
    this.root.addChild(modal);
    this.modalHost = modal;

    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    this.chromeBuilt = true;
    this.builtForTypeId = def.id;
  }

  /**
   * 석재 패널 한 장을 세운다.
   *
   * ⚠️ `screenX`/`screenY` 를 **반드시 넘긴다.** 안 넘기면 같은 치수의 패널끼리 조명·랜드마크
   * 시드가 같아져 위치별 조명이 조용히 무효가 된다 — 화면은 정상적으로 서고 테스트도 통과하므로
   * 눈으로만 잡히는 유형이다. 계열 패널 3장은 치수가 같으므로 여기가 유일한 구분이다.
   */
  private addPanel(px: number, py: number, pw: number, ph: number, title: string): CinematicPanel {
    const panel = makeCinematicPanel({
      width: pw,
      height: ph,
      variant: 'slab',
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
   * 헤더 밴드(y 0..{@link HEADER_H}) — 액티브·리스펙(좌) · 각인 제목(중앙) · 칩·닫기(우).
   *
   * ⚠️ 컨트롤은 **전부 같은 세로 띠**를 쓰고 가로로만 배치한다(격납고 헤더 겹침 결함 이력).
   * ⚠️ 좌상단 {@link GEAR_BAND_W}×{@link GEAR_BAND_H} 에는 아무것도 두지 않는다 — 설정 톱니가
   * 나중에 stage 최상위로 그려져 그 컨트롤을 통째로 클릭 불가로 만든다.
   * ⚠️ **각인 석재 인방은 넣지 않는다**(격납고에서 사용자 판단으로 제거됨). 헤더는 배경이 그대로
   * 보이는 띠이고, 배경 모듈이 이 대역을 중간 세기로 눌러 글자 대비를 보장한다.
   */
  private buildHeader(): void {
    const title = makeHangarTitle(t('lab.title'));
    title.position.set(DESIGN_WIDTH / 2, HEAD_Y - 4);
    this.root.addChild(title);

    const actives = this.chromeButton({
      tone: 'blue',
      width: ACT_BTN_W,
      height: HEAD_H,
      fontSize: 18,
      label: '',
      onClick: () => this.openActives(),
    });
    actives.container.position.set(ACT_BTN_X, HEAD_Y);
    this.root.addChild(actives.container);
    this.activesBtn = actives;

    const respec = this.chromeButton({
      tone: 'red',
      width: RESPEC_W,
      height: HEAD_H,
      fontSize: 18,
      label: '',
      onClick: () => void this.respec(),
    });
    respec.container.position.set(RESPEC_X, HEAD_Y);
    this.root.addChild(respec.container);
    this.respecBtn = respec;

    const close = this.chromeButton({
      tone: 'stone',
      width: CLOSE_W,
      height: HEAD_H,
      fontSize: 22,
      // 컬러 이모지는 Pixi 에서 두부가 된다(`text.ts` stripEmoji) — U+2715 는 흑백 글리프다.
      label: '✕',
      onClick: () => {
        const cb = this.onClose;
        this.hide();
        cb?.();
      },
    });
    close.container.position.set(CLOSE_X, HEAD_Y);
    this.root.addChild(close.container);

    // 칩은 값이 구워진 컨테이너라 갱신이 아니라 재조립이다 — 그릇만 잡아 둔다.
    const chips = new Container();
    this.root.addChild(chips);
    this.chipHost = chips;

    const sub = new Text({
      resolution: 2,
      text: '',
      style: { fontFamily: UI_FONT, fontSize: 15, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(1, 0);
    sub.position.set(DESIGN_WIDTH - EDGE_X, HEAD_SUB_Y);
    this.root.addChild(sub);
    this.headSub = sub;
  }

  // --- 갱신 -----------------------------------------------------------------

  /** 값만 갈아끼운다. 배경·석재 패널은 다시 굽지 않는다(파일 헤더 "재렌더 규율"). */
  private refresh(): void {
    this.syncValues();
    this.renderLists();
    this.renderModal();
  }

  private syncValues(): void {
    const ship = activeShip(this.profile);
    const def = this.def();

    if (this.chipHost !== null) {
      const host = this.chipHost;
      for (const child of [...host.children]) {
        host.removeChild(child);
        child.destroy({ children: true });
      }
      // 스킬 포인트 = 청록(재화가 아니다) · 크레딧 = 금. 색만으로 두 칩이 구분된다.
      const points = makeHangarChip(
        CHIP_W,
        HEAD_H,
        String(this.profile.skillPoints),
        this.ui['ui_icon_star.png'] ?? undefined,
        'teal',
      );
      points.position.set(POINT_CHIP_X, HEAD_Y);
      host.addChild(points);
      const credits = makeHangarChip(
        CHIP_W,
        HEAD_H,
        String(this.profile.credits),
        this.ui['ui_icon_coin.png'] ?? undefined,
        'gold',
      );
      credits.position.set(CREDIT_CHIP_X, HEAD_Y);
      host.addChild(credits);
    }

    if (this.headSub !== null) {
      this.headSub.text = `${t('lab.bar.invest')} ${totalInvested(this.profile)}pt · ${t('lab.bar.shipLv')} ${ship.level}`;
    }

    const equipped = ship.activeSlots.filter((s) => s !== null).length;
    this.activesBtn?.setLabel(`${t('lab.actives.btn')}  ${equipped}/${ACTIVE_SLOT_COUNT}`);

    const cost = respecCost(this.profile);
    this.respecBtn?.setLabel(t('lab.respecBtn', { n: cost }));
    this.respecBtn?.setEnabled(totalInvested(this.profile) > 0);

    const invest = this.invest();
    this.trees.forEach((slot, i) => {
      const picked = investedNodeIndices(invest, def, i);
      slot.browse.setLabel(t('lab.browseAll', { n: picked.length, m: def.nodesPerTree }));
      this.renderCapstone(i, slot);
    });

    this.renderStats();

    if (this.hintText !== null) {
      this.hintText.text = this.hint;
      this.hintText.visible = this.hint !== '';
    }
  }

  /** 파생 스탯 6열×2행. 값이 매 투자마다 바뀌므로 통째로 다시 만든다(글자뿐이라 싸다). */
  private renderStats(): void {
    const host = this.statsHost;
    if (host === null) return;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }

    // 파생 스탯도 **기체 타입** 을 함께 넘긴다 — 노드 정의가 타입별이라 타입을 빼면 비온의
    // 25번째 이후 노드가 통째로 무시되고, 트리 슬라이스 폭도 20 으로 오판정된다.
    const sums = computeSkillStats(this.invest(), this.def().id);
    const rows = PREVIEW_ROWS.filter(([key]) => sums[key] !== 0);

    if (rows.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('lab.noStats'),
        style: { fontFamily: UI_FONT, fontSize: 16, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      empty.anchor.set(0, 0.5);
      empty.position.set(STAT_X, SBOX.y + SBOX.h / 2);
      host.addChild(empty);
      return;
    }

    const cells = rectGridPositions(rows.length, STAT_COLS, STAT_COL_W, STAT_ROW_H, 0, 0);
    rows.forEach(([key, labelKey, isPct], i) => {
      const at = cells[i];
      if (at === undefined) return;
      const cy = SBOX.y + at.y + STAT_ROW_H / 2;
      const k = new Text({
        resolution: 2,
        text: t(labelKey),
        style: { fontFamily: UI_FONT, fontSize: 14, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      k.anchor.set(0, 0.5);
      k.position.set(STAT_X + at.x, cy);
      host.addChild(k);
      // 시너지 증폭은 분수를 만든다(예: 59.072) — 소수 1자리로 반올림해 표시 노이즈를 줄인다.
      const v = sums[key];
      const shownV = Number.isInteger(v) ? String(v) : v.toFixed(1);
      const val = new Text({
        resolution: 2,
        text: isPct ? `+${shownV}%` : `+${shownV}`,
        style: { fontFamily: UI_FONT, fontSize: 15, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
      });
      val.anchor.set(1, 0.5);
      val.position.set(STAT_X + at.x + STAT_COL_W - 12, cy);
      host.addChild(val);
      // 최악 조합(긴 라벨 "대시 재충전 감소" + 3자리 값 "+149.0%")이 붙어 보이지 않게, 값이
      // 차지하고 남은 자리에 라벨을 가로로 눌러 맞춘다. 로케일이 바뀌어도 겹치지 않는다.
      const labelRoom = STAT_COL_W - 12 - val.width - 10;
      if (k.width > labelRoom) k.scale.x = labelRoom / k.width;
    });
  }

  // --- 본 화면 계열 목록(찍은 것만) ----------------------------------------

  private renderLists(): void {
    const def = this.def();
    const box = treeBox(def.trees.length);
    this.trees.forEach((slot, treeIndex) => this.renderList(treeIndex, slot, def, box));
  }

  private renderList(
    treeIndex: number,
    slot: TreeSlot,
    def: ShipTypeDef,
    box: { x: number; y: number; w: number; h: number; bottom: number },
  ): void {
    const host = slot.listHost;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }

    const treeDef = def.trees[treeIndex];
    if (treeDef === undefined) return;
    const accent = AFFINITY_ACCENT[treeDef.affinity];
    const picked = investedNodeIndices(this.invest(), def, treeIndex);

    if (picked.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('lab.noInvested'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fill: SLAB_BODY_FILL,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: box.w - 20,
          lineHeight: 22,
          dropShadow: TEXT_SHADOW,
        },
      });
      // 빈 목록 자리는 세로로 크므로 안내를 그 한가운데 둔다(위에 붙으면 버려진 여백처럼 보인다).
      empty.anchor.set(0.5, 0.5);
      empty.position.set(box.x + box.w / 2, LIST_TOP + INVESTED_LIST.avail / 2);
      host.addChild(empty);
      return;
    }

    // ⚠️ 목록 세로가 가용 높이를 넘을 수 있다 — `nodesPerTree` 가 타입별이라(해츨링 25) 2열
    // 13행으로 가용을 넘긴다. 스크롤 영역에 넣어 두면 20노드 타입에서는 `totalH <= viewH` 라
    // 휠 리스너조차 안 붙어 기존 거동과 같다(makeScrollArea 규약).
    const nodes = flattenShipNodes(def);
    const cellW = Math.floor((box.w - INV_GAP_X * (INV_COLS - 1)) / INV_COLS);
    const cells = rectGridPositions(picked.length, INV_COLS, cellW, INV_H, INV_GAP_X, INV_GAP_Y);
    const totalH = listStackHeight(picked.length, INV_COLS, INV_H, INV_GAP_Y);
    const content = makeScrollArea(host, {
      x: box.x,
      y: LIST_TOP,
      w: box.w,
      h: INVESTED_LIST.avail,
      totalH,
      get: () => this.listScrollY[treeIndex] ?? 0,
      set: (v) => {
        this.listScrollY[treeIndex] = v;
      },
      thumb: true,
    });
    picked.forEach((index, i) => {
      const at = cells[i];
      const node = nodes[index];
      if (at === undefined || node === undefined) return;
      const row = this.makeInvestedRow(index, node, accent, cellW);
      row.position.set(at.x, at.y);
      content.addChild(row);
    });
  }

  /**
   * 본 패널의 투자 목록 행: 아이콘 + 이름 + `현재/최대`. **표시 전용**이다 — 투자는 팝업 한
   * 곳에서만 일어나게 해 진입점을 갈라 놓지 않는다. 설명은 hover 툴팁.
   */
  private makeInvestedRow(index: number, node: SkillNode, accent: number, w: number): Container {
    const cur = this.invest()[index] ?? 0;
    const maxed = cur >= node.maxPoints;

    const row = new Container();
    const plate = rowPlate(w, INV_H);
    row.addChild(plate.view);
    // 만렙 노드는 금색 링 — 목록이 말해야 하는 유일한 상태다.
    plate.setSelected(maxed);

    const iconBoxY = Math.round((INV_H - INV_ICON) / 2);
    row.addChild(makeSkillIcon(this.ui[skillIconName(node)], 7, iconBoxY, INV_ICON, accent, maxed));

    const pts = new Text({
      resolution: 2,
      text: `${cur}/${node.maxPoints}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fontWeight: '800',
        fill: maxed ? COLOR.gold : accent,
        dropShadow: TEXT_SHADOW,
      },
    });
    pts.anchor.set(1, 0.5);
    pts.position.set(w - 10, INV_H / 2);
    row.addChild(pts);

    const nameX = 7 + INV_ICON + 9;
    const nameRoom = w - nameX - pts.width - 16;
    const name = new Text({
      resolution: 2,
      text: node.name,
      style: {
        fontFamily: UI_FONT,
        fontSize: 14,
        fontWeight: '700',
        fill: maxed ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0, 0.5);
    name.position.set(nameX, INV_H / 2);
    // 로케일이 바뀌어 이름이 길어져도 포인트 배지를 침범하지 않게 가로로 눌러 맞춘다.
    if (name.width > nameRoom) name.scale.x = nameRoom / name.width;
    row.addChild(name);

    // 클릭 판정은 **행 Container** 에 — 바탕 Graphics 에만 걸면 위에 얹힌 텍스트·아이콘이
    // 이벤트를 삼킨다(실측 결함).
    row.eventMode = 'static';
    row.on('pointerover', (e) => this.showTip(index, accent, e.global.x, e.global.y));
    row.on('pointermove', (e) => this.moveTip(e.global.x, e.global.y));
    row.on('pointerout', () => this.tooltip.hide());
    return row;
  }

  /** 캡스톤: 해금이면 금색 버튼, 잠기면 석재 버튼 + 게이트 진행도. */
  private renderCapstone(treeIndex: number, slot: TreeSlot): void {
    const host = slot.capstoneHost;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }

    const def = this.def();
    const treeDef = def.trees[treeIndex];
    if (treeDef === undefined) return;
    const accent = AFFINITY_ACCENT[treeDef.affinity];
    const invest = this.invest();
    const index = shipCapstoneIndex(def, treeIndex);
    const node = flattenShipNodes(def)[index];
    if (node === undefined) return;
    const cur = invest[index] ?? 0;
    const unlocked = shipCapstoneUnlocked(invest, def, treeIndex);
    const gateProgress = shipTreeBaseInvested(invest, def, treeIndex);
    const box = treeBox(slot.cols);

    const label = unlocked
      ? `★ ${node.name}   ${cur}/${node.maxPoints}`
      : `${node.name}   ${gateProgress}/${def.capstoneGate}`;
    const btn = this.chromeButton({
      tone: unlocked ? 'gold' : 'stone',
      width: box.w,
      height: CAPSTONE_H,
      fontSize: 18,
      label,
      onClick: () => this.investCapstone(index, unlocked),
    });
    // 캡스톤은 perPoint 0 인 질적 노드라 스탯 아이콘을 붙이면 거짓말이 된다 — 계열별 개별 아트.
    btn.container.addChild(
      makeSkillIcon(
        this.ui[skillIconName(node)],
        CAPSTONE_ICON_X,
        Math.round((CAPSTONE_H - CAPSTONE_ICON) / 2),
        CAPSTONE_ICON,
        accent,
        unlocked,
      ),
    );
    btn.container.position.set(box.x, CAPSTONE_Y);
    btn.container.on('pointerover', (e) =>
      this.showTip(index, unlocked ? COLOR.gold : accent, e.global.x, e.global.y),
    );
    btn.container.on('pointermove', (e) => this.moveTip(e.global.x, e.global.y));
    btn.container.on('pointerout', () => this.tooltip.hide());
    if (!unlocked) btn.container.alpha = 0.78;
    host.addChild(btn.container);
  }

  // --- 팝업 -----------------------------------------------------------------

  private renderModal(): void {
    const host = this.modalHost;
    if (host === null) return;

    this.modalPanel?.destroy();
    this.modalPanel = null;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }

    if (this.popupTree !== null) this.renderPopup(this.popupTree, host);
    else if (this.activesOpen) this.renderActives(host);
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  /**
   * 시네마틱 팝업의 바탕 — 암막 + 슬래브 패널.
   *
   * **`makeModal` 을 쓰지 않는다** — 그 모듈은 나무 nine-slice 에 묶여 있고 다른 화면 5곳이
   * 쓰기 때문에 고치면 그 화면들이 같이 갈린다. 대신 `modal.ts` 헤더의 실측 규칙 세 가지를
   * 그대로 승계한다: ①암막은 **완전 불투명 채움** ②암막이 **이벤트를 먹는다**
   * ③패널 안쪽 탭은 암막까지 **전파를 끊는다**.
   *
   * ⚠️ 암막 알파는 뒤 화면 밝기에 따라 다르다 — 예비역 로스터에선 0.92 가 통했고 챔피언
   * 선택에선 0.96 이 필요했다. **이 화면은 0.96 으로도 뒤 글자가 그대로 읽혔다**(실화면 1차
   * 확인) — 슬래브가 화면을 거의 다 덮는 데다 금색 글자가 많아서다. 0.98 이 실측 하한이다.
   */
  private makeModalShell(
    host: Container,
    px: number,
    py: number,
    pw: number,
    ph: number,
    title: string,
    onDismiss: () => void,
  ): CinematicPanel {
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: 0.98 });
    scrim.eventMode = 'static';
    scrim.on('pointertap', onDismiss);
    host.addChild(scrim);

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
    stopRowPropagation(panel.container);
    host.addChild(panel.container);
    this.modalPanel = panel;
    return panel;
  }

  /**
   * 계열 전체 20~25노드를 아이콘 + 이름 + 설명 + `현재/최대` 로 보여 주고 거기서 투자시킨다.
   * 세로 스크롤은 마스크 + 클립 Container 조합이고, 마스크 높이는 행 피치의 배수로 클램프해
   * 반토막 행이 나오지 않게 한다.
   */
  private renderPopup(treeIndex: number, host: Container): void {
    const def = this.def();
    const treeDef = def.trees[treeIndex];
    if (treeDef === undefined) return;
    const accent = AFFINITY_ACCENT[treeDef.affinity];
    const nodes = flattenShipNodes(def);

    const panel = this.makeModalShell(
      host,
      POP_X,
      POP_Y,
      POP_W,
      POP_H,
      t('lab.all.title', { tree: shipTreeName(treeDef) }),
      () => this.closePopup(),
    );
    const container = panel.container;

    const close = this.chromeButton({
      tone: 'stone',
      width: 44,
      height: 44,
      fontSize: 20,
      label: '✕',
      onClick: () => this.closePopup(),
    });
    close.container.position.set(POP_W - PANEL_EDGE_PAD - 44, 4);
    container.addChild(close.container);

    const sub = new Text({
      resolution: 2,
      text: t('lab.all.sub', {
        n: this.profile.skillPoints,
        m: shipTreeBaseInvested(this.invest(), def, treeIndex),
      }),
      style: { fontFamily: UI_FONT, fontSize: 15, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0, 0);
    sub.position.set(PBOX.x, PBOX.y);
    container.addChild(sub);

    const scrollHint = new Text({
      resolution: 2,
      text: t('lab.all.hint'),
      style: { fontFamily: UI_FONT, fontSize: 13, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    scrollHint.anchor.set(1, 0);
    scrollHint.position.set(PBOX.right, PBOX.y + 2);
    container.addChild(scrollHint);

    // 마스크 하한은 콘텐츠 상자 바닥 — 목록이 패널 테두리에 닿지 않는다.
    const viewH = clampToRowHeight(PBOX.bottom - POP_LIST_TOP, POP_ROW_PITCH);
    const { start } = shipTreeRange(def, treeIndex);
    const perTree = def.nodesPerTree;
    const totalH = listStackHeight(perTree, 1, POP_ROW_H, POP_ROW_GAP);

    const clip = new Container();
    clip.position.set(PBOX.x, POP_LIST_TOP);
    container.addChild(clip);
    const mask = new Graphics();
    mask.rect(PBOX.x, POP_LIST_TOP, PBOX.w, viewH).fill({ color: 0xffffff });
    container.addChild(mask);
    clip.mask = mask;

    const content = new Container();
    clip.addChild(content);
    const scrollY = clampScroll(this.popupScrollY, totalH, viewH);
    this.popupScrollY = scrollY;
    content.y = -scrollY;

    for (let local = 0; local < perTree; local++) {
      const index = start + local;
      const node = nodes[index];
      if (node === undefined) continue;
      const row = this.makePopupRow(index, node, accent);
      row.position.set(0, local * POP_ROW_PITCH);
      content.addChild(row);
    }

    if (totalH > viewH) {
      // 스크롤 위치 표시 막대(오른쪽 안쪽, `POP_BAR_W` 만큼 행에서 미리 비워 둔 자리).
      const maxScroll = totalH - viewH;
      const thumbH = Math.max(40, Math.round((viewH / totalH) * viewH));
      const barX = PBOX.right - 6;
      const track = new Graphics();
      track.roundRect(barX, POP_LIST_TOP, 4, viewH, 2).fill({ color: 0x000000, alpha: 0.35 });
      container.addChild(track);
      const thumb = new Graphics();
      thumb.roundRect(barX, 0, 4, thumbH, 2).fill({ color: accent, alpha: 0.75 });
      thumb.y = POP_LIST_TOP + Math.round((scrollY / maxScroll) * (viewH - thumbH));
      container.addChild(thumb);

      // 휠은 **클립 Container** 가 받는다. 마스크로 쓰이는 Graphics 는 히트 테스트에서 제외돼
      // (`isMask`) 리스너가 영영 안 불린다(실측). hitArea 를 주면 행 사이 빈자리에서도 잡히고,
      // 행 위에서는 행 → 클립으로 버블링되어 함께 성립한다.
      clip.eventMode = 'static';
      clip.hitArea = new Rectangle(0, 0, PBOX.w, viewH);
      clip.on('wheel', (e) => {
        // 스크롤량을 행 피치에 맞춰 스냅한다 — 멈춘 자리에서 위쪽에 반토막 행이 남지 않는다.
        const snapped = Math.round((this.popupScrollY + e.deltaY) / POP_ROW_PITCH) * POP_ROW_PITCH;
        const next = clampScroll(snapped, totalH, viewH);
        this.popupScrollY = next;
        content.y = -next;
        thumb.y = POP_LIST_TOP + Math.round((next / maxScroll) * (viewH - thumbH));
      });
    }
  }

  /** 팝업 목록 행: 아이콘 + 이름 + 상세 설명 + `현재/최대`. 행 클릭 = 1포인트 투자. */
  private makePopupRow(index: number, node: SkillNode, accent: number): Container {
    const cur = this.invest()[index] ?? 0;
    const maxed = cur >= node.maxPoints;
    // 사슬 선행 조건(ADR-0047). 배치는 그대로 두고 **설명줄 글자만** 바꾼다.
    const prereq = this.prereqText(index, false);
    const canInvest = !maxed && prereq === null && this.profile.skillPoints > 0;

    const row = new Container();
    const plate = rowPlate(POP_ROW_W, POP_ROW_H);
    row.addChild(plate.view);
    plate.setSelected(cur > 0);

    const iconBoxY = Math.round((POP_ROW_H - POP_ICON) / 2);
    row.addChild(makeSkillIcon(this.ui[skillIconName(node)], 12, iconBoxY, POP_ICON, accent, maxed));

    const pts = new Text({
      resolution: 2,
      text: `${cur}/${node.maxPoints}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: '800',
        fill: maxed ? COLOR.gold : cur > 0 ? accent : SLAB_BODY_FILL,
        dropShadow: TEXT_SHADOW,
      },
    });
    pts.anchor.set(1, 0.5);
    pts.position.set(POP_ROW_W - 16, POP_ROW_H / 2);
    row.addChild(pts);

    const textX = 12 + POP_ICON + 12;
    const textW = POP_ROW_W - textX - pts.width - 28;

    const name = new Text({
      resolution: 2,
      text: node.name,
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fontWeight: '800',
        fill: maxed ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0, 0);
    name.position.set(textX, 11);
    if (name.width > textW) name.scale.x = textW / name.width;
    row.addChild(name);

    const detail = new Text({
      resolution: 2,
      text:
        prereq !== null
          ? `${node.desc} · ${prereq}`
          : `${node.desc} · ${t('lab.node.meta', { t: node.tier + 1, m: node.maxPoints })}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: SLAB_BODY_FILL,
        wordWrap: true,
        wordWrapWidth: textW,
        lineHeight: 17,
        dropShadow: TEXT_SHADOW,
      },
    });
    detail.anchor.set(0, 0);
    detail.position.set(textX, 36);
    row.addChild(detail);

    // 투자 여력이 없으면 흐리게 — 클릭은 살려 안내 힌트를 띄운다(DOM 판과 같은 규칙).
    if (!canInvest) row.alpha = maxed ? 0.85 : 0.62;

    // 클릭 판정은 행 Container 에(바탕 Graphics 에만 걸면 텍스트·아이콘이 삼킨다).
    row.eventMode = 'static';
    row.cursor = canInvest ? 'pointer' : 'default';
    row.on('pointertap', () => this.investNode(index));
    return row;
  }

  /**
   * 액티브 장착 팝업(AC-16·17). 위는 장착 슬롯 2칸(누르면 해제), 아래는 **계열 × 티어** 격자다 —
   * 한 열이 한 계열이고 위/아래가 저티어·고티어라 "어느 계열에 투자하면 무엇이 열리는가"가
   * 배치만으로 읽힌다. 잠긴 칸은 필요 투자량({@link ActiveSlotView.threshold})을 그대로 보여 준다.
   */
  private renderActives(host: Container): void {
    const def = this.def();
    const views = this.activeViews();
    const ship = activeShip(this.profile);

    const panel = this.makeModalShell(
      host,
      ACT_X,
      ACT_Y,
      ACT_W,
      ACT_H,
      t('lab.actives.title'),
      () => this.closeActives(),
    );
    const container = panel.container;

    const close = this.chromeButton({
      tone: 'stone',
      width: 44,
      height: 44,
      fontSize: 20,
      label: '✕',
      onClick: () => this.closeActives(),
    });
    close.container.position.set(ACT_W - PANEL_EDGE_PAD - 44, 4);
    container.addChild(close.container);

    const equipped = ship.activeSlots.filter((s) => s !== null).length;
    const sub = new Text({
      resolution: 2,
      // 슬롯 수는 `ACTIVE_SLOT_COUNT` 파생이다 — 2 를 문구에 박으면 슬롯이 늘 때 조용히 거짓말이 된다.
      text: t('lab.actives.sub', { n: equipped, m: ACTIVE_SLOT_COUNT }),
      style: { fontFamily: UI_FONT, fontSize: 15, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0, 0);
    sub.position.set(ABOX.x, ABOX.y);
    container.addChild(sub);

    const unequipHint = new Text({
      resolution: 2,
      text: t('lab.actives.unequipHint'),
      style: { fontFamily: UI_FONT, fontSize: 13, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    unequipHint.anchor.set(1, 0);
    unequipHint.position.set(ABOX.right, ABOX.y + 2);
    container.addChild(unequipHint);

    for (let slot = 0; slot < ACTIVE_SLOT_COUNT; slot++) {
      const card = this.makeActiveSlotCard(slot, views);
      card.position.set(ABOX.x + slot * (ACT_SLOT_W + ACT_SLOT_GAP), ACT_SLOT_Y);
      container.addChild(card);
    }

    if (views.length === 0) {
      // 저작 전 기체(빈 레지스트리)에서 격자만 텅 비면 "고장났다"로 읽힌다 — 이유를 적는다.
      const none = new Text({
        resolution: 2,
        text: t('lab.actives.none'),
        style: { fontFamily: UI_FONT, fontSize: 16, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      none.anchor.set(0.5, 0.5);
      none.position.set(ACT_W / 2, (ACT_GRID_TOP + ABOX.bottom) / 2);
      container.addChild(none);
      return;
    }

    const cols = def.trees.length;
    const cellW = activeCellWidth(cols);
    def.trees.forEach((treeDef, i) => {
      const head = new Text({
        resolution: 2,
        text: shipTreeName(treeDef),
        style: {
          fontFamily: UI_FONT,
          fontSize: 18,
          fontWeight: '800',
          fill: AFFINITY_ACCENT[treeDef.affinity],
          dropShadow: TEXT_SHADOW,
        },
      });
      head.anchor.set(0.5, 0);
      head.position.set(ABOX.x + i * (cellW + ACT_COL_GAP) + cellW / 2, ACT_TREE_HEAD_Y);
      if (head.width > cellW) head.scale.x = cellW / head.width;
      container.addChild(head);
    });

    for (const cell of activeGridCells(views, cols)) {
      const treeDef = def.trees[cell.col];
      const accent = treeDef === undefined ? COLOR.gold : AFFINITY_ACCENT[treeDef.affinity];
      const box = this.makeActiveCell(cell, accent);
      box.position.set(cell.x, cell.y);
      container.addChild(box);
    }
  }

  /** 장착 슬롯 카드 1칸. 채워져 있으면 누를 때 해제, 비어 있으면 무연산. */
  private makeActiveSlotCard(slot: number, views: readonly ActiveSlotView[]): Container {
    const view = views.find((v) => v.equippedSlot === slot);

    const card = new Container();
    const plate = rowPlate(ACT_SLOT_W, ACT_SLOT_H);
    card.addChild(plate.view);
    plate.setSelected(view !== undefined);

    const label = new Text({
      resolution: 2,
      text: t('lab.actives.slot', { n: slot + 1 }),
      style: { fontFamily: UI_FONT, fontSize: 12, fontWeight: '700', fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    label.anchor.set(0, 0);
    label.position.set(ACT_PAD, 8);
    card.addChild(label);

    if (view === undefined) {
      const empty = new Text({
        resolution: 2,
        text: t('lab.actives.slotEmpty'),
        style: { fontFamily: UI_FONT, fontSize: 16, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      empty.anchor.set(0.5, 0.5);
      empty.position.set(ACT_SLOT_W / 2, ACT_SLOT_H / 2 + 6);
      card.addChild(empty);
      return card;
    }

    const iconBox = 40;
    card.addChild(
      makeSkillIcon(
        this.ui[activeSkillIconName(shipTypeDef(view.def.shipTypeId).slug, this.indexInShip(view))],
        ACT_PAD,
        ACT_SLOT_H - iconBox - 8,
        iconBox,
        COLOR.gold,
        true,
      ),
    );

    const nameX = ACT_PAD + iconBox + 10;
    const name = new Text({
      resolution: 2,
      text: tShipKey(activeSkillNameKey(view.def.id), view.def.id),
      style: { fontFamily: UI_FONT, fontSize: 17, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    name.anchor.set(0, 0);
    name.position.set(nameX, 26);
    const room = ACT_SLOT_W - nameX - ACT_PAD;
    if (name.width > room) name.scale.x = room / name.width;
    card.addChild(name);

    const meta = new Text({
      resolution: 2,
      text: activeMetaLine(view),
      style: { fontFamily: UI_FONT, fontSize: 12, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    meta.anchor.set(0, 0);
    meta.position.set(nameX, 50);
    if (meta.width > room) meta.scale.x = room / meta.width;
    card.addChild(meta);

    // 클릭 판정은 **카드 Container** 에 — 바탕 Graphics 에만 걸면 위에 얹힌 텍스트가 삼킨다.
    card.eventMode = 'static';
    card.cursor = 'pointer';
    card.on('pointertap', () => this.unequip(slot));
    return card;
  }

  /** 6칸 안에서의 순번(0..5) — 아이콘 파일명 규약 `active_<slug>_<n>.png` 의 n−1 축. */
  private indexInShip(view: ActiveSlotView): number {
    return (ACTIVES_BY_SHIP[view.def.shipTypeId] ?? []).findIndex((d) => d.id === view.def.id);
  }

  /** 격자 셀 1칸: 아이콘 + 이름 + 티어 배지 + 상태(잠김/장착) + 쿨다운·위력 + 설명. */
  private makeActiveCell(cell: ActiveGridCell, accent: number): Container {
    const { view, w } = cell;
    const equipped = view.equippedSlot >= 0;
    const dim = !view.unlocked;

    const box = new Container();
    const plate = rowPlate(w, ACT_CELL_H);
    box.addChild(plate.view);
    plate.setSelected(equipped);

    box.addChild(
      makeSkillIcon(
        this.ui[activeSkillIconName(shipTypeDef(view.def.shipTypeId).slug, this.indexInShip(view))],
        ACT_PAD,
        ACT_PAD,
        ACT_ICON,
        accent,
        view.unlocked,
      ),
    );

    const tier = new Text({
      resolution: 2,
      text: t(view.def.tier === 'lo' ? 'lab.actives.tier.lo' : 'lab.actives.tier.hi'),
      style: { fontFamily: UI_FONT, fontSize: 12, fontWeight: '800', fill: accent, dropShadow: TEXT_SHADOW },
    });
    tier.anchor.set(1, 0);
    tier.position.set(w - ACT_PAD, ACT_NAME_Y);
    box.addChild(tier);

    const name = new Text({
      resolution: 2,
      // ⚠️ 이 호출이 존재해야 84키가 사문화되지 않는다(AC-22 · tests/i18n.test.ts 참조 단언).
      text: tShipKey(activeSkillNameKey(view.def.id), view.def.id),
      style: {
        fontFamily: UI_FONT,
        fontSize: 16,
        fontWeight: '800',
        fill: equipped ? COLOR.gold : COLOR.cream,
        wordWrap: true,
        wordWrapWidth: w - ACT_NAME_X - ACT_PAD - ACT_TIER_W,
        lineHeight: 20,
        dropShadow: TEXT_SHADOW,
      },
    });
    name.anchor.set(0, 0);
    name.position.set(ACT_NAME_X, ACT_NAME_Y);
    box.addChild(name);

    // 잠긴 칸은 **필요 투자량**을 그대로 보여 준다(AC-16). 임계는 `threshold` 파생이라
    // 해츨링 고티어의 44 가 자동으로 따라온다 — 문구에 40 을 박으면 그 기체에서만 거짓말이 된다.
    const status = new Text({
      resolution: 2,
      text: view.unlocked
        ? equipped
          ? t('lab.actives.ready')
          : ''
        : t('lab.actives.locked', { n: view.threshold }),
      style: {
        fontFamily: UI_FONT,
        fontSize: 14,
        fontWeight: '800',
        fill: view.unlocked ? COLOR.gold : 0xff9a7a,
        dropShadow: TEXT_SHADOW,
      },
    });
    status.anchor.set(0, 0);
    status.position.set(ACT_PAD, ACT_STATUS_Y);
    box.addChild(status);

    const meta = new Text({
      resolution: 2,
      text: activeMetaLine(view),
      style: { fontFamily: UI_FONT, fontSize: 13, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    meta.anchor.set(0, 0);
    meta.position.set(ACT_PAD, ACT_META_Y);
    if (meta.width > w - ACT_PAD * 2) meta.scale.x = (w - ACT_PAD * 2) / meta.width;
    box.addChild(meta);

    const desc = new Text({
      resolution: 2,
      text: tShipKey(activeSkillDescKey(view.def.id), ''),
      style: {
        fontFamily: UI_FONT,
        fontSize: 12,
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: w - ACT_PAD * 2,
        lineHeight: 16,
        dropShadow: TEXT_SHADOW,
      },
    });
    desc.anchor.set(0, 0);
    desc.position.set(ACT_PAD, ACT_DESC_Y);
    box.addChild(desc);

    if (dim) box.alpha = 0.6;

    // 클릭 판정은 셀 Container 에. 잠긴 칸도 클릭을 살려 이유를 안내한다(팝업 행과 같은 규칙).
    box.eventMode = 'static';
    box.cursor = view.unlocked && !equipped ? 'pointer' : 'default';
    box.on('pointertap', () => {
      if (equipped) this.unequip(view.equippedSlot);
      else this.equip(view.def.id);
    });
    return box;
  }
}
