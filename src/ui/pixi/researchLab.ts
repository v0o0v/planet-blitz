/**
 * 연구소 화면 — Pixi (2026-08-02 AAA 시네마틱 전환 · 레인 계약
 * `.omc/plans/research-lab-aaa-2026-08-02.md` → ADR-0049 flat 재편으로 스킬 모델 교체).
 *
 * `main.ts` 가 직접 여는 **최상위 화면**이다(`researchLab.show(profile, () => openBaseMap())`) —
 * 격납고 하위 화면들과 달리 suspend/resume 이 아니라 show/onClose 규약이다. 스킬 축 3종 ×
 * 축당 10스킬(ADR-0049, 캡스톤·티어·사슬 선행 없음) 투자(`investSkill`), 리스펙
 * (`respecSkills`/`respecCost`), 액티브 스킬 장착(ADR-0041), i18n, Profile in-place 변이 +
 * `saveProfile` 를 담당한다.
 *
 * ## ADR-0049 가 이 화면에서 지운 것
 * 구조가 **티어 5단 × 계열 3 + 계열별 캡스톤 1**(63노드, 스탯 수치 노드)에서 **flat 3축 ×
 * 10스킬**(30노드, 메커닉 노드)로 바뀌면서 다음이 전부 폐기됐다 — 비활성으로 남기지 않고
 * 그리는 코드 자체를 지운다:
 *  - **티어 행·연결선**: flat 구조에는 티어가 없다. 축 하나를 그냥 10칸 격자로 보여준다.
 *  - **계열 캡스톤 바**(`renderCapstone`/`investCapstone`): 캡스톤 자체가 폐기됐다.
 *  - **사슬 선행 조건**(ADR-0047, `chainMissingPrereqs`/`prereqText`): "축당 10스킬은 처음부터
 *    전부 투자 가능"이 ADR-0049 의 명시적 설계다.
 *  - **파생 스탯 미리보기 띠**(`computeSkillStats`): 스킬은 더 이상 `StatKey` 에 수치를
 *    더하지 않는다 — 효과는 sim 안의 규칙이라 이 화면이 미리 계산할 값 자체가 없다. 없는
 *    데이터를 추측해 만들지 않는다(`node.desc` 한 문장이 스킬 설명의 전부다).
 * 캡스톤 바가 빠지며 계열 패널 콘텐츠 상자 전체가 목록 몫이 되고, 스탯 띠가 빠지며 그 자리를
 * 계열 패널 세로가 그대로 흡수한다(아래 레이아웃 상수 참조).
 *
 * ## 시네마틱 전환에서 바뀐 것은 **바탕과 배치**뿐이다(2026-08-02 유산)
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재 슬래브), `makeBanner` → `makeHangarTitle`,
 * `makeCurrencyChip` → `makeHangarChip`, `ui_btn_*.png` → `cinematicButtonTexture` 주입,
 * 자홍 카드 행(`listRowBg`) → 석재 행 판(`rowPlate`), 단색 배경 → `HangarBackdrop`.
 * 투자·리스펙·장착 계약과 저장 경로는 한 줄도 건드리지 않았다.
 *
 * ## 왜 배경 **창을 두지 않는가**(`windows: []`)
 * 형제 화면 셋의 결론: **창은 "배경이 보이는 구멍"이 아니라 "무언가를 보여주는 자리"다.**
 * 여기서 창에 세울 수 있는 피사체는 현역 기체 한 대뿐인데 이 화면에서 기체는 **바뀌지 않는다**
 * (교체는 챔피언 선택의 일이다) — 행을 눌러도 창 안 그림이 그대로다. 예비역 로스터에서 창을
 * 뺀 것과 같은 조건이다. **정보 밀도가 이 화면의 목적이다**(격납고 계약 §0-bis-3). 배경 노출은
 * 헤더 밴드와 패널 사이 틈뿐이다.
 *
 * ## 스킬 **노드 격자·연결선은 만들지 않는다**
 * 본 패널은 그 축에서 **찍은 노드만** 2열로 보여 주고, 전체 열람·투자는 **세로 스크롤 팝업**이
 * 맡는다. 축당 10스킬 고정이라(ADR-0049) 팝업은 스크롤이 사실상 필요 없어졌지만(10행이 한
 * 화면에 다 들어온다), 기구는 그대로 재사용한다 — 노드 수가 다시 늘 가능성에 대비한 방어적
 * 여지이자, 기존에 검증된 마스크·휠 관용구를 다시 만들지 않기 위해서다.
 *
 * ## 행 사이에 **선을 긋지 않는다**
 * 세로 리브·가로 이음선·각인 번호판은 사용자가 격납고에서 삭제를 지시한 것들이다(2026-08-02).
 * 행 구분은 선이 아니라 **면의 밝기 차 + 2단 접지 그림자 + 행 간격**이 만든다.
 *
 * ## 재렌더 규율 — 이 화면은 형제보다 더 자주 갱신된다
 * 클릭 한 번이 곧 투자라 값이 매번 바뀐다. `render()` 로 루트를 통째로 다시 그리면 노드를
 * 하나 찍을 때마다 배경과 석재 패널이 다시 **구워진다**. 그래서
 *  - `buildChrome()` 은 1회(자산 도착·기체 타입 변경 시에만 재건),
 *  - `syncValues()` 가 칩·부제·파생 스탯·리스펙 라벨을,
 *  - `renderLists()` 가 계열 목록 행만,
 *  - 팝업은 `modalHost` 에서만 나고 진다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거)
 * - **목록 행 클릭은 행 Container 에.** 바탕 Graphics 에 걸면 위에 얹힌 텍스트가 클릭을 삼킨다.
 * - **휠은 클립 Container + hitArea 에.** 마스크 Graphics 는 히트 테스트에서 제외된다.
 * - **여백은 패널의 `box` 안에만.**
 * - 컬러 이모지 금지(`text.ts` stripEmoji 가 두부로 떨군다). `✕` 는 보존 목록이다.
 * - ⚠️ `hudEl()` 에는 **캔버스 가드를 붙이지 않는다**(`typeof document.createElement !==
 *   'function'` 까지 검사하면 HUD 숨김이 통째로 죽는다 — 이 리포가 실제로 밟았다).
 * - ⚠️ 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드**다 — 그 자리 컨트롤은 통째로 클릭 불가가
 *   된다. 헤더 컨트롤은 전부 같은 세로 띠(y 26..78)에 가로로만 배치한다.
 *
 * 순수 render/UI 레이어(ADR-0005 · ADR-0014) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import {
  shipTypeDef,
  flattenShipNodes,
  shipTreeRange,
  SKILLS_PER_AXIS,
  type ShipTypeDef,
  type ShipSkillDef,
} from '../../../data/ships/index.js';
import { axisInvested } from '../../items/skills.js';
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
import { t } from '../../i18n/index.js';
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
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { PixiButton } from './button.js';
import { PixiTooltip } from './tooltip.js';
import { rectGridPositions } from './slotGrid.js';
import { makeScrollArea } from './scrollArea.js';
import { stopRowPropagation } from './listRow.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import { HELP_HEAD_W, openHelpOverlay, type HelpSpec } from './helpModal.js';
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
const BOTTOM_PAD = 28;

/** 계열 패널 열 수(레지스트리 계약 — 실제 패널 수는 `def().trees.length` 파생이다). */
const TREE_COLS = 3;
const PANEL_Y = HEADER_H + 8;
/**
 * 계열 패널 세로는 **화면 하단까지 남는 자리 전부**다. ADR-0049 가 파생 스탯 하단 띠를
 * 없애면서(캡스톤과 함께 폐기 — 파일 헤더 참조) 계열 패널이 그 세로를 그대로 흡수한다.
 */
const PANEL_H = DESIGN_HEIGHT - BOTTOM_PAD - PANEL_Y;

/** 계열 열 한 칸의 폭·x — 열 수에서 파생한다(3 을 박으면 계열 수가 다른 기체에서 삐져나온다). */
function treeColumnW(cols: number): number {
  if (cols <= 0) return 0;
  return Math.floor((DESIGN_WIDTH - EDGE_X * 2 - GUTTER_X * (cols - 1)) / cols);
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

/**
 * 투자 목록 셀: 2열. 축당 10스킬(ADR-0049, 전 기체 동일) = 5행 × 53 − 8 = 257 로 가용 안에
 * 여유 있게 들어가므로 본 패널에는 스크롤이 필요 없다(전체 열람은 팝업 몫).
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
/**
 * 팝업에 보이는 행 수 = **축당 스킬 수**(ADR-0049, 전 기체 10 고정). 구 버전은 11(스트라이커
 * 20노드 초과분을 감당하는 임의값)이었다 — flat 구조는 수량이 고정이라 "빈 자리 금지"
 * 원칙대로 정확히 그 수만큼만 잡는다(팝업 헤더 "왜 창을 두지 않는가" 절의 같은 원칙).
 */
const POP_VISIBLE_ROWS = SKILLS_PER_AXIS;
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
 * 왜 **팝업**인가. 본 화면은 이미 꽉 차 있다 — 계열 패널 3장이 화면 세로 대부분을 덮는다.
 * 게다가 패널 안 투자 목록의 가용 세로는 "10노드가 스크롤 없이 들어간다"로 단위 테스트가
 * 못 박아 둔 값이라, 액티브 칸을 패널 안에 끼우려고 목록을 줄이면 그 단언이 즉시 깨진다.
 * 그래서 전체 스킬 팝업과 같은 관용구를 재사용한다.
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
/** 도움말 버튼 — 오른쪽 컨트롤 줄의 맨 왼쪽(여섯 화면 공통 자리 · {@link HELP_HEAD_W} 주석). */
const HELP_X = POINT_CHIP_X - HEAD_GAP - 2 - HELP_HEAD_W;

/** 연구소 도움말 절 목록. 기구는 공용 모듈이 쥔다 — 여기서는 무엇을 말할지만 정한다. */
export const LAB_HELP: HelpSpec = {
  prefix: 'lab.help',
  sections: ['s1', 's2', 's3', 's4', 's5', 's6'],
};
/** 헤더 컨트롤 아래 한 줄(총 투자·기체 레벨). 헤더 밴드 안에서 끝난다. */
const HEAD_SUB_Y = HEAD_Y + HEAD_H + 4;

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
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels,
    headerControls: [
      { id: 'actives', rect: head(ACT_BTN_X, ACT_BTN_W) },
      { id: 'respec', rect: head(RESPEC_X, RESPEC_W) },
      { id: 'help', rect: head(HELP_X, HELP_HEAD_W) },
      { id: 'points', rect: head(POINT_CHIP_X, CHIP_W) },
      { id: 'credits', rect: head(CREDIT_CHIP_X, CHIP_W) },
      { id: 'close', rect: head(CLOSE_X, CLOSE_W) },
    ],
    windows: [],
  };
}

/**
 * 계열에서 **포인트를 투자한** 스킬의 flat 인덱스 목록(flat 순서 = 축 내부 등록 순서).
 * 손상/짧은 벡터도 안전(누락 = 0).
 *
 * ⚠️ M8: 축이 트리 **이름**(`'firepower'|…`)에서 **(타입 정의, 트리 인덱스)** 로 바뀌었다.
 * 이름 축을 남기면 신규 기체의 계열이 이 함수에 아예 들어올 수 없다.
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
 * 본 패널 투자 목록의 레이아웃 수치. 상수를 건드려 10노드가 더 이상 안 들어가게 되면 단위
 * 테스트가 즉시 깨지도록 산술 전제를 여기로 노출한다(스크롤 없는 목록이 이 배치의 전제다).
 */
export const INVESTED_LIST = {
  cols: INV_COLS,
  cellW: INV_W,
  cellH: INV_H,
  gapX: INV_GAP_X,
  gapY: INV_GAP_Y,
  /** 목록에 쓸 수 있는 세로(콘텐츠 상자 안 전체 — ADR-0049 가 캡스톤 바를 없애 상자 바닥까지). */
  avail: BOX.bottom - LIST_TOP,
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

/**
 * 스킬 노드 → 아이콘 파일명(ADR-0049).
 *
 * 구 `skillIconName`(`uiTextures.ts`)은 `SkillNode.stat`+`tier` 에서 유도했다 — 스킬이
 * 메커닉으로 바뀌며 그 두 필드가 통째로 사라져 재사용할 수 없다. 지금 데이터에서 유도
 * 가능한 유일한 시각 축은 **축(affinity)** 뿐이라 축당 공유 아이콘 하나로 접는다.
 *
 * `uiTextures.ts` 의 `SKILL_ICON_NAMES`/`UI_ASSET_NAMES` 레지스트리에는 이 이름이 아직
 * 등재돼 있지 않다(그 파일은 이 레인의 담당 밖 — `makeSkillIcon` 이 미등록 텍스처를 계열색
 * placeholder 로 이미 우아하게 대체하므로 화면은 죽지 않는다). 없는 스탯 데이터를 추측해
 * 예전처럼 스탯별 아이콘을 고르지 않는다.
 */
export function skillNodeIconName(node: ShipSkillDef): string {
  return `skill_axis_${node.axis}.png`;
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
  /** 본 패널 투자 목록의 계열별 스크롤 위치(방어적으로 유지 — 지금은 축당 10노드라 실사용 없음). */
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
  private modalHost: Container | null = null;
  /** 화면 안내 팝업이 열려 있는가 + 그 스크롤 위치(재렌더 사이 유지). */
  private helpOpen = false;
  private helpScroll = 0;
  private headSub: Text | null = null;
  private hintText: Text | null = null;
  private respecBtn: PixiButton | null = null;
  private activesBtn: PixiButton | null = null;

  /**
   * 현재 편집 대상 = **활성 기체의 타입 정의**. 화면 전체가 이 하나에서 파생된다
   * (트리 수·게이트). 스트라이커 정본 상수를 직접 읽으면 신규 기체에서 그리드가 붕괴한다.
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
   * ADR-0049: 축당 10스킬은 처음부터 전부 투자 가능하다 — 선행 조건 판정 자체가 없다.
   * 실패 사유는 포인트 없음 또는 이미 최대 두 가지뿐이다.
   */
  private investNode(index: number): void {
    if (!investSkill(this.profile, index)) {
      this.hint = this.profile.skillPoints <= 0 ? t('lab.err.noPoints') : t('lab.err.maxed');
      this.refresh();
      return;
    }
    this.hint = '';
    this.persist();
    this.refresh();
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

  /** 화면 안내 팝업 — 읽기 전용이라 투자 상태를 건드리지 않는다. */
  private openHelp(): void {
    this.helpOpen = true;
    this.helpScroll = 0;
    this.tooltip.hide();
    this.refresh();
  }

  private closeHelp(): void {
    this.helpOpen = false;
    this.refresh();
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

      this.trees.push({ panel, browse, listHost, cols });
    }

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

    // 리스펙은 **확인 모달이 없고** 클릭 즉시 전액 환급이다(이 화면에도 리포에도 공용 confirm
    // 헬퍼가 없다 — 실측). 그런데 어픽스 정본 1(투자 ≥1 인 스킬에만 가산) 때문에 환급하는
    // 순간 **장착 장비의 계열 스킬 레벨 보너스가 전부 함께 꺼진다**(affixes.md ①-10).
    // 결함이 아니라 의도된 귀결이지만 **말없이 일어나면 "어픽스가 고장 났다"로 읽힌다.**
    // 확인 모달을 새로 짓는 것은 이 레인 범위 밖이라, 누르기 **전에** 읽을 수 있는 유일한
    // 자리인 hover 툴팁에 고지를 건다. 모달이 생기면 그쪽으로 옮겨라(키는 그대로 쓴다).
    respec.container.eventMode = 'static';
    respec.container.on('pointerover', (e) => {
      const p = this.root.toLocal(e.global);
      this.tooltip.show(
        {
          title: t('lab.respecBtn', { n: respecCost(this.profile) }),
          titleColor: 0xe0685a,
          subtitle: '',
          lines: [t('lab.respec.affixNotice')],
        },
        p.x,
        p.y,
        0xe0685a,
      );
      this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    });
    respec.container.on('pointermove', (e) => this.moveTip(e.global.x, e.global.y));
    respec.container.on('pointerout', () => this.tooltip.hide());

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

    // 도움말 — 재화 칩·닫기와 **같은 세로 띠**를 쓰고 가로로만 자리를 잡는다.
    const help = this.chromeButton({
      tone: 'stone',
      width: HELP_HEAD_W,
      height: HEAD_H,
      fontSize: 20,
      label: t('lab.help'),
      onClick: () => this.openHelp(),
    });
    help.container.position.set(HELP_X, HEAD_Y);
    this.root.addChild(help.container);

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
      slot.browse.setLabel(t('lab.browseAll', { n: picked.length, m: SKILLS_PER_AXIS }));
    });

    if (this.hintText !== null) {
      this.hintText.text = this.hint;
      this.hintText.visible = this.hint !== '';
    }
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

    // 축당 10스킬 고정(ADR-0049)이라 본 패널 목록은 스크롤 없이 항상 들어간다. 그래도
    // `makeScrollArea` 는 그대로 쓴다 — `totalH <= viewH` 면 휠 리스너조차 안 붙는다(규약).
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
  private makeInvestedRow(index: number, node: ShipSkillDef, accent: number, w: number): Container {
    const cur = this.invest()[index] ?? 0;
    const maxed = cur >= node.maxPoints;

    const row = new Container();
    const plate = rowPlate(w, INV_H);
    row.addChild(plate.view);
    // 만렙 노드는 금색 링 — 목록이 말해야 하는 유일한 상태다.
    plate.setSelected(maxed);

    const iconBoxY = Math.round((INV_H - INV_ICON) / 2);
    row.addChild(makeSkillIcon(this.ui[skillNodeIconName(node)], 7, iconBoxY, INV_ICON, accent, maxed));

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

    if (this.helpOpen) {
      // 도움말은 화면의 팝업 기구를 빌리지 않고 공용 모듈이 통째로 세운다(암막+패널+내용) —
      // 화면 여섯이 같은 팝업을 쓰므로 여기서 다시 조립하면 그 순간 여섯 벌이 갈린다.
      this.modalPanel = openHelpOverlay(host, {
        spec: LAB_HELP,
        get: () => this.helpScroll,
        set: (v) => {
          this.helpScroll = v;
        },
        onClose: () => this.closeHelp(),
      });
    } else if (this.popupTree !== null) this.renderPopup(this.popupTree, host);
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
   * 계열 전체 10노드를 아이콘 + 이름 + 설명 + `현재/최대` 로 보여 주고 거기서 투자시킨다.
   * 세로 스크롤은 마스크 + 클립 Container 조합이고, 마스크 높이는 행 피치의 배수로 클램프해
   * 반토막 행이 나오지 않게 한다(축당 10노드 고정이라 지금은 스크롤이 실제로 발동하지 않지만
   * 기구는 방어적으로 유지한다).
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
        m: axisInvested(this.invest(), def, treeIndex),
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
    const perTree = SKILLS_PER_AXIS;
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

  /**
   * 팝업 목록 행: 아이콘 + 이름 + 설명 + `현재/최대`. 행 클릭 = 1포인트 투자. ADR-0049 이후
   * 선행 조건이 없으므로 `canInvest` 는 포인트 有 + 미달성 두 조건뿐이다.
   */
  private makePopupRow(index: number, node: ShipSkillDef, accent: number): Container {
    const cur = this.invest()[index] ?? 0;
    const maxed = cur >= node.maxPoints;
    const canInvest = !maxed && this.profile.skillPoints > 0;

    const row = new Container();
    const plate = rowPlate(POP_ROW_W, POP_ROW_H);
    row.addChild(plate.view);
    plate.setSelected(cur > 0);

    const iconBoxY = Math.round((POP_ROW_H - POP_ICON) / 2);
    row.addChild(makeSkillIcon(this.ui[skillNodeIconName(node)], 12, iconBoxY, POP_ICON, accent, maxed));

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

    // 설명은 `node.desc` 그대로다 — 구 코드는 `stat`/`perPoint` 로 "+3% 공격력" 문구를
    // **생성**했지만 ADR-0049 는 그 데이터를 지웠다. 없는 수치를 추측해 만들지 않는다.
    const detail = new Text({
      resolution: 2,
      text: node.desc,
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
    // 기체별 게이트(`activeHiGate`)가 자동으로 따라온다 — 문구에 상수를 박으면 그 기체에서만 거짓말이 된다.
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
