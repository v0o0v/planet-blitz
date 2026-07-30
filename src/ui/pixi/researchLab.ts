/**
 * 연구소 화면 (Pixi 카툰나무풍 리스킨 — `.omc/plans/cartoonwood-rollout.md` #2).
 *
 * `src/ui/researchLab.ts` 의 DOM `ResearchLab` 과 기능 1:1 동등하게 스킬 트리를 Pixi
 * 캔버스(1920×1080 디자인 스페이스)로 재구현한다: 계열 3종 × 20노드 + 캡스톤 투자
 * (`investSkill`), 리스펙(`respecSkills`/`respecCost`), 파생 스탯 미리보기
 * (`computeSkillStats`), 시너지 안내, i18n, Profile in-place 변이 + saveProfile.
 *
 * ── 화면 구조(사용자 피드백 반영) ──
 * 본 화면의 계열 패널은 그 계열에서 **포인트를 투자한 노드만** 목록으로 보여 준다(아이콘 +
 * 이름 + 투자 포인트). 전체 20노드는 패널의 "전체 스킬 보기" 버튼이 여는 **세로 스크롤
 * 팝업**으로 빠졌고, 상세 설명 열람과 포인트 투자는 거기서 한다.
 *
 * 이 구조가 이전 레이아웃의 전제를 지운다: 4열 × 5행(셀 119×95)은 "20노드를 한 화면에 전부"
 * 라는 제약에서 산술적으로 유도된 배치였는데(ADR-0015 Consequences), 전체 목록이 스크롤
 * 팝업으로 빠지면서 그 제약이 사라졌다. 본 패널은 항목 수가 훨씬 적으므로 2열 목록 행으로
 * 되돌리고(한 계열을 전부 찍어도 10행 × 2열 = 20 이 스크롤 없이 들어간다), 팝업은 세로
 * 스크롤이라 세로 제약을 받지 않는다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js';
import type { SkillNode } from '../../../data/skills.js';
import {
  shipTypeDef,
  flattenShipNodes,
  shipTreeRange,
  shipCapstoneIndex,
  type ShipTypeDef,
} from '../../../data/ships/index.js';
import type { StatKey } from '../../items/types.js';
import { computeSkillStats, shipCapstoneUnlocked, shipTreeBaseInvested } from '../../items/skills.js';
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
import { nineSlicePanel, panelContent, PANEL_BORDER } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { PixiTooltip } from './tooltip.js';
import { makeBanner, makeCurrencyChip, makeIconButton } from './titleBar.js';
import { rectGridPositions } from './slotGrid.js';
import { makeScrollArea } from './scrollArea.js';

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

// --- 본 화면 레이아웃 상수(디자인 스페이스) ---
const BANNER_W = 620;
const BANNER_H = 72;
const BANNER_Y = 10;
const CHIP_W = 190;
const CHIP_H = 52;
const SUB_Y = 84;
const PANEL_Y = 112;
const PANEL_H = 740;
const PANEL_W = 620;
const PANEL_GAP = 14;
const PANEL_COLS = 3;
const PANEL_X0 = Math.round((DESIGN_WIDTH - (PANEL_W * PANEL_COLS + PANEL_GAP * (PANEL_COLS - 1))) / 2);
/**
 * 패널 안쪽 콘텐츠 상자. 제목·부제·목록·버튼·캡스톤을 전부 이 상자 기준으로 잡는다 —
 * 프레임에 붙는 것을 좌표 재유도 없이 구조적으로 막는다(nineSlicePanel §PANEL_INNER_PAD).
 */
const BOX = panelContent(PANEL_W, PANEL_H);
const TITLE_Y = BOX.y;
const TREE_SUB_Y = 96;
/** 전체 스킬 팝업을 여는 버튼(콘텐츠 상자 폭 전체). */
const BROWSE_Y = 118;
const BROWSE_H = 42;
const LIST_TOP = 168;
const CAPSTONE_H = 52;
/** 캡스톤 바는 콘텐츠 상자 바닥에 붙인다 — 목록과의 간격이 자동으로 남는다. */
const CAPSTONE_Y = BOX.bottom - CAPSTONE_H;
/** 캡스톤 버튼 좌측 개별 아트 자리(라벨은 버튼 중앙이라 겹치지 않는다). */
const CAPSTONE_ICON = 40;
const CAPSTONE_ICON_X = 10;

/**
 * 투자 목록 셀: 2열. 한 계열 20노드를 **전부** 찍어도 10행 × 45 = 448 로 가용
 * 450(= `CAPSTONE_Y` 628 − 10 − `LIST_TOP` 168) 안에 들어가므로 본 패널에는 스크롤이
 * 필요 없다(전체 열람은 팝업 몫). 이 여유는 아래 {@link INVESTED_LIST} 가 고정한다.
 */
const INV_COLS = 2;
const INV_GAP_X = 8;
const INV_GAP_Y = 2;
const INV_W = Math.floor((BOX.w - INV_GAP_X * (INV_COLS - 1)) / INV_COLS);
const INV_H = 43;
const INV_ICON = 32;

// --- 전체 스킬 팝업 ---
const POP_W = 900;
const POP_H = 880;
const POP_X = Math.round((DESIGN_WIDTH - POP_W) / 2);
const POP_Y = Math.round((DESIGN_HEIGHT - POP_H) / 2);
const PBOX = panelContent(POP_W, POP_H);
const POP_SUB_Y = 100;
const POP_LIST_TOP = 130;
const POP_ROW_H = 65;
const POP_ROW_GAP = 4;
/** 행 피치 — 마스크 높이를 이 배수로 클램프해 반토막 행을 구조적으로 막는다. */
const POP_ROW_PITCH = POP_ROW_H + POP_ROW_GAP;
const POP_ICON = 48;
const POP_CLOSE = 40;
/** 스크롤 막대 자리 — 행이 그 밑으로 들어가지 않도록 행 폭에서 미리 뺀다. */
const POP_BAR_W = 14;
const POP_ROW_W = PBOX.w - POP_BAR_W;

// --- 액티브 스킬 팝업(ADR-0041 · AC-16·17) ---
/**
 * 왜 **팝업**인가. 본 화면은 이미 꽉 차 있다 — 계열 패널 3장(620×740)이 y=112..852 를 덮고
 * 파생 스탯 띠가 864..1036 을 덮는다. 게다가 패널 안 투자 목록의 가용 세로 450 은
 * `tests/researchLabLayout.test.ts` 가 "스트라이커 20노드(448)가 스크롤 없이 들어간다"로
 * **2px 여유까지 못 박아 둔 값**이라, 액티브 칸을 패널 안에 끼우려고 목록을 줄이면 그 단언이
 * 즉시 깨진다. 그래서 전체 스킬 팝업과 같은 관용구(막 + 중앙 패널)를 재사용한다.
 */
const ACT_W = 1040;
const ACT_H = 820;
const ACT_X = Math.round((DESIGN_WIDTH - ACT_W) / 2);
const ACT_Y = Math.round((DESIGN_HEIGHT - ACT_H) / 2);
/** 팝업 안쪽 콘텐츠 상자(920×700). 제목·슬롯 바·계열 격자를 전부 이 상자 기준으로 잡는다. */
const ABOX = panelContent(ACT_W, ACT_H);
const ACT_SUB_Y = 100;
const ACT_SLOT_Y = 130;
const ACT_SLOT_H = 78;
const ACT_SLOT_GAP = 14;
const ACT_SLOT_W = Math.floor((ABOX.w - ACT_SLOT_GAP * (ACTIVE_SLOT_COUNT - 1)) / ACTIVE_SLOT_COUNT);
/** 계열 머리글 줄 → 그 아래가 (저티어/고티어) 2행 격자. */
const ACT_TREE_HEAD_Y = ACT_SLOT_Y + ACT_SLOT_H + 22;
const ACT_GRID_TOP = ACT_TREE_HEAD_Y + 32;
const ACT_COL_GAP = 14;
const ACT_CELL_H = 232;
const ACT_CELL_GAP_Y = 12;
const ACT_CLOSE = 40;
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

/** 타이틀바 좌측 진입 버튼 — 우측 리스펙 버튼과 좌우 대칭(1920 − 1500 − 300 = 120). */
const ACT_BTN_W = 300;
const ACT_BTN_H = 52;
const ACT_BTN_X = 120;
const ACT_BTN_Y = BANNER_Y + (BANNER_H - ACT_BTN_H) / 2;

/**
 * 액티브 격자의 셀 폭. 열 수 = **그 기체의 계열 수**다 — 3계열을 상수로 박으면 계열 수가 다른
 * 기체가 들어오는 순간 셀이 상자 밖으로 삐져나온다(본 화면이 M8 에서 겪은 것과 같은 부류).
 */
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
  subY: ACT_SUB_Y,
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
  rows: 2,
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

// --- 파생 스탯 하단 가로 띠 ---
const STRIP_W = PANEL_W * PANEL_COLS + PANEL_GAP * (PANEL_COLS - 1);
const STRIP_X = PANEL_X0;
const STRIP_Y = PANEL_Y + PANEL_H + 12;
const STRIP_H = 172;
/** 띠 안쪽 콘텐츠 상자(1768 × 52). 제목·스탯 그리드·시너지 안내를 가로로 나눠 쓴다. */
const SBOX = panelContent(STRIP_W, STRIP_H);
const STRIP_TITLE_W = 200;
const STRIP_SYN_W = 360;
const STAT_COLS = 6;
const STAT_ROW_H = 26;
/** 제목·시너지 열을 뺀 나머지를 6열로 나눈 폭: (1768 - 200 - 16 - 360 - 16) / 6 = 196. */
const STAT_COL_W = Math.floor((SBOX.w - STRIP_TITLE_W - STRIP_SYN_W - 32) / STAT_COLS);
const STAT_X = SBOX.x + STRIP_TITLE_W + 16;

// 리스펙은 하단 띠에 자리를 내주고 타이틀바 우측(크레딧 칩 ~ 닫기 버튼 사이)으로 옮겼다.
const RESPEC_W = 300;
const RESPEC_H = 52;
const RESPEC_X = 1500;
const RESPEC_Y = BANNER_Y + (BANNER_H - RESPEC_H) / 2;

const HINT_Y = DESIGN_HEIGHT - 8;

/** 목록 행 바탕(카드 화면과 같은 값 — 세트 안에서 목록 행의 생김새를 갈리게 하지 않는다). */
function listRowBg(w: number, h: number, accent: number, active: boolean): Graphics {
  const g = new Graphics();
  g.roundRect(0, 0, w, h, 8).fill({ color: 0x241d33, alpha: 0.92 });
  g.roundRect(0, 0, w, h, 8).stroke({ color: active ? accent : 0x5a4630, width: 2, alignment: 1 });
  return g;
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

function panelX(col: number): number {
  return PANEL_X0 + col * (PANEL_W + PANEL_GAP);
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
  avail: CAPSTONE_Y - 10 - LIST_TOP,
  /** 콘텐츠 상자 폭 — 2열이 간격까지 포함해 정확히 이 안에 들어가야 한다. */
  boxW: BOX.w,
} as const;

/** 팝업 목록의 레이아웃 수치(마스크 하한·행 피치 — 반토막 행 금지의 산술 전제). */
export const POPUP_LIST = {
  rowH: POP_ROW_H,
  gapY: POP_ROW_GAP,
  pitch: POP_ROW_PITCH,
  top: POP_LIST_TOP,
  /** 마스크 하한(패널 로컬) = 콘텐츠 상자 바닥. 프레임 46 + 여백 14 위다. */
  bottom: PBOX.bottom,
  rowW: POP_ROW_W,
} as const;

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

export class ResearchLabScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private hint = '';
  private ui: UiTextures = {};
  /** 열려 있는 전체 스킬 팝업의 **계열 인덱스**(null = 닫힘). */
  private popupTree: number | null = null;
  private popupScrollY = 0;
  /** 액티브 스킬 팝업이 열려 있는가(AC-16·17). 전체 스킬 팝업과 상호 배타다. */
  private activesOpen = false;
  /** 본 패널 투자 목록의 계열별 스크롤 위치(노드가 많은 타입에서만 쓰인다). */
  private readonly listScrollY: number[] = [0, 0, 0];
  /**
   * 리스펙 재화 차감(`spend_currency`)의 서버 왕복이 진행 중인지 — 동시(재진입) 클릭 가드.
   * async `respec()` 의 사전검사와 첫 await 사이에 두 번째 클릭이 끼어들면 둘 다 검사를 통과해
   * 크레딧이 이중 차감되므로(온라인 ok 경로), 네트워크 창 동안 이 플래그로 재진입을 막는다.
   */
  private busy = false;

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
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.hint = '';
    // 캔버스 화면은 다음 화면이 자동으로 덮어 주지 않으므로 팝업 상태를 직접 되돌린다.
    this.popupTree = null;
    this.popupScrollY = 0;
    this.activesOpen = false;
    this.render();
    this.root.visible = true;
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    // DOM HUD 는 런 전용 — 캔버스 메타 화면 위에 떠 보이므로 숨긴다(스킬 §7).
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    this.tooltip.hide();
    this.onClose = null;
    this.popupTree = null;
    this.popupScrollY = 0;
    this.activesOpen = false;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  private persist(): void {
    // ⚠️ 명시적 null 은 `saveProfile` 의 기본 인자를 밀어내고 즉시 return 된다 — main.ts 가
    // store 없이 이 화면을 만들기 때문에 그대로 넘기면 스킬 투자가 저장되지 않는다.
    saveProfile(this.profile, this.store ?? undefined);
  }

  // --- 투자 / 리스펙 (DOM 판과 동일 규칙) ----------------------------------

  private investNode(index: number): void {
    if (!investSkill(this.profile, index)) {
      this.hint = this.profile.skillPoints <= 0 ? t('lab.err.noPoints') : t('lab.err.maxed');
      this.render();
      return;
    }
    this.hint = '';
    this.persist();
    this.render();
  }

  private investCapstone(index: number, unlocked: boolean): void {
    if (!unlocked) {
      // 게이트 폭은 타입별이다(스트라이커·브루저·아크·팬텀 40, 비온 44) — 상수를 박으면 거짓말.
      this.hint = t('lab.capstone.needGate', { g: this.def().capstoneGate });
      this.render();
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
      this.render();
      return;
    }
    const cost = respecCost(this.profile);
    if (this.profile.credits < cost) {
      this.hint = t('lab.err.noCredits', { n: cost });
      this.render();
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
          this.render();
          return;
        }
      } else if (res.reason === 'insufficient') {
        // 서버 원장이 판정해 거부했다. 로컬 미러는 치트·오프라인 가산으로 부풀 수 있으므로
        // **서버 잔액을 그대로 보여준다** — "크레딧이 부족합니다" 한 줄만 내면 크레딧을 잔뜩 든
        // 유저에게 거짓말이 된다(격납고 창고 확장에서 실제로 신고된 오탐과 같은 부류).
        this.hint = t('spend.err.rejectedCredits', { n: cost, have: res.creditsLeft });
        this.render();
        return;
      } else {
        // 판정 자체를 못 받았다(오프라인·네트워크 오류). 차감도 환급도 없다.
        this.hint = t('spend.err.unavailable');
        this.render();
        return;
      }
      this.hint = t('lab.respecDone');
      this.persist();
      this.render();
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
    this.render();
  }

  private closePopup(): void {
    this.popupTree = null;
    this.popupScrollY = 0;
    this.render();
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
    this.render();
  }

  private closeActives(): void {
    this.activesOpen = false;
    this.render();
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
      this.render();
      return;
    }
    ship.activeSlots = res.slots;
    this.hint = '';
    this.persist();
    this.render();
  }

  private unequip(slotIndex: number): void {
    const ship = activeShip(this.profile);
    if ((ship.activeSlots[slotIndex] ?? null) === null) return;
    ship.activeSlots = unequipActive(ship.activeSlots, slotIndex);
    this.hint = '';
    this.persist();
    this.render();
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

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    for (const child of [...this.root.children]) {
      if (child !== this.tooltip.container) {
        this.root.removeChild(child);
        child.destroy({ children: true });
      }
    }
    this.tooltip.hide();

    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChildAt(bg, 0);

    this.renderTitleBar();
    // 계열 수·구성은 **활성 기체 타입** 이 정한다(3계열 고정 가정 제거).
    this.def().trees.forEach((_, i) => this.renderTreePanel(i));
    this.renderStatsStrip();
    this.renderActions();
    // 팝업을 먼저 얹고 힌트를 그 위에 — 팝업에서 투자에 실패했을 때 안내가 막에 가리지 않는다.
    // 두 팝업은 상호 배타다(여는 쪽이 상대를 닫는다) — 겹쳐 뜨면 뒤쪽 막이 앞쪽 클릭을 먹는다.
    if (this.popupTree !== null) this.renderPopup(this.popupTree);
    else if (this.activesOpen) this.renderActives();
    this.renderHint();

    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, t('lab.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const chipY = BANNER_Y + (BANNER_H - CHIP_H) / 2;
    const points = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.skillPoints),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_star.png'],
    );
    points.position.set((DESIGN_WIDTH - BANNER_W) / 2 - CHIP_W - 20, chipY);
    this.root.addChild(points);

    const credits = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.credits),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_coin.png'],
    );
    credits.position.set((DESIGN_WIDTH + BANNER_W) / 2 + 20, chipY);
    this.root.addChild(credits);

    const ship = activeShip(this.profile);
    const sub = new Text({
      resolution: 2,
      text: `${t('lab.bar.invest')} ${totalInvested(this.profile)}pt · ${t('lab.bar.shipLv')} ${ship.level}`,
      style: { fontFamily: UI_FONT, fontSize: 18, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(DESIGN_WIDTH / 2, SUB_Y);
    this.root.addChild(sub);

    // 액티브 스킬 진입 버튼 — 우측 리스펙과 좌우 대칭 자리. 라벨에 장착 수를 실어 팝업을 열지
    // 않고도 "2칸 중 몇 칸을 쓰고 있는가"가 보이게 한다.
    const equipped = ship.activeSlots.filter((s) => s !== null).length;
    const actives = new PixiButton({
      texture: this.ui['ui_btn_blue.png'],
      fallbackColor: 0x2a4a7a,
      width: ACT_BTN_W,
      height: ACT_BTN_H,
      fontSize: 18,
      label: `${t('lab.actives.btn')}  ${equipped}/${ACTIVE_SLOT_COUNT}`,
      onClick: () => this.openActives(),
    });
    actives.container.position.set(ACT_BTN_X, ACT_BTN_Y);
    this.root.addChild(actives.container);

    const close = makeIconButton(
      56,
      () => {
        const cb = this.onClose;
        this.hide();
        cb?.();
      },
      this.ui['ui_icon_close.png'],
    );
    close.position.set(DESIGN_WIDTH - 24 - 56, 12);
    this.root.addChild(close);
  }

  // --- 본 화면 계열 패널(찍은 것만) ----------------------------------------

  private renderTreePanel(treeIndex: number): void {
    const def = this.def();
    const treeDef = def.trees[treeIndex];
    if (treeDef === undefined) return;
    const accent = AFFINITY_ACCENT[treeDef.affinity];
    const col = treeIndex;
    const panel = new Container();
    panel.position.set(panelX(col), PANEL_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(PANEL_W, PANEL_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    const title = new Text({
      resolution: 2,
      text: shipTreeName(treeDef),
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: accent, dropShadow: TEXT_SHADOW },
    });
    title.anchor.set(0.5, 0);
    title.position.set(PANEL_W / 2, TITLE_Y);
    panel.addChild(title);

    const invested = shipTreeBaseInvested(this.invest(), def, treeIndex);
    const sub = new Text({
      resolution: 2,
      text: t('lab.tree.sub', { n: invested }),
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: COLOR.muted,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: BOX.w,
        dropShadow: TEXT_SHADOW,
      },
    });
    sub.anchor.set(0.5, 0);
    sub.position.set(PANEL_W / 2, TREE_SUB_Y);
    panel.addChild(sub);

    const picked = investedNodeIndices(this.invest(), def, treeIndex);

    // 전체 목록은 팝업 몫 — 이 버튼이 유일한 진입점이자, 투자가 일어나는 자리다.
    const browse = new PixiButton({
      texture: this.ui['ui_btn_blue.png'],
      fallbackColor: 0x2a4a7a,
      width: BOX.w,
      height: BROWSE_H,
      fontSize: 17,
      label: t('lab.browseAll', { n: picked.length, m: def.nodesPerTree }),
      onClick: () => this.openPopup(treeIndex),
    });
    browse.container.position.set(BOX.x, BROWSE_Y);
    panel.addChild(browse.container);

    if (picked.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('lab.noInvested'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fill: COLOR.muted,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: BOX.w - 20,
          lineHeight: 22,
          dropShadow: TEXT_SHADOW,
        },
      });
      // 빈 목록 자리는 세로로 크므로 안내를 그 한가운데 둔다(위에 붙으면 버려진 여백처럼 보인다).
      empty.anchor.set(0.5, 0.5);
      empty.position.set(PANEL_W / 2, LIST_TOP + INVESTED_LIST.avail / 2);
      panel.addChild(empty);
    } else {
      // ⚠️ 목록 세로가 가용 높이를 넘을 수 있다 — `nodesPerTree` 가 타입별이라(비온 25) 2열
      // 13행 = 585 로 가용 450 을 넘긴다. 스크롤 영역에 넣어 두면 20노드 타입에서는
      // `totalH <= viewH` 라 휠 리스너조차 안 붙어 기존 거동과 같다(makeScrollArea 규약).
      const nodes = flattenShipNodes(def);
      const cells = rectGridPositions(picked.length, INV_COLS, INV_W, INV_H, INV_GAP_X, INV_GAP_Y);
      const totalH = listStackHeight(picked.length, INV_COLS, INV_H, INV_GAP_Y);
      const content = makeScrollArea(panel, {
        x: BOX.x,
        y: LIST_TOP,
        w: BOX.w,
        h: INVESTED_LIST.avail,
        totalH,
        get: () => this.listScrollY[treeIndex] ?? 0,
        set: (v) => {
          this.listScrollY[treeIndex] = v;
        },
      });
      picked.forEach((index, i) => {
        const at = cells[i];
        const node = nodes[index];
        if (at === undefined || node === undefined) return;
        const row = this.makeInvestedRow(index, node, accent);
        row.position.set(at.x, at.y);
        content.addChild(row);
      });
    }

    panel.addChild(this.makeCapstone(treeIndex, accent));
  }

  /**
   * 본 패널의 투자 목록 행(246×43): 아이콘 + 이름 + `현재/최대`. **표시 전용**이다 —
   * 투자는 팝업 한 곳에서만 일어나게 해 진입점을 갈라 놓지 않는다. 설명은 hover 툴팁.
   */
  private makeInvestedRow(index: number, node: SkillNode, accent: number): Container {
    const cur = this.invest()[index] ?? 0;
    const maxed = cur >= node.maxPoints;

    const row = new Container();
    row.addChild(listRowBg(INV_W, INV_H, accent, maxed));

    const iconBoxY = Math.round((INV_H - INV_ICON) / 2);
    row.addChild(
      makeSkillIcon(this.ui[skillIconName(node)], 6, iconBoxY, INV_ICON, accent, maxed),
    );

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
    pts.position.set(INV_W - 8, INV_H / 2);
    row.addChild(pts);

    const nameX = 6 + INV_ICON + 8;
    const nameRoom = INV_W - nameX - pts.width - 14;
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

  /** 캡스톤: 해금이면 노란 버튼, 잠기면 나무 버튼 + 게이트 진행도. */
  private makeCapstone(treeIndex: number, accent: number): Container {
    const def = this.def();
    const invest = this.invest();
    const index = shipCapstoneIndex(def, treeIndex);
    const node = flattenShipNodes(def)[index]!;
    const cur = invest[index] ?? 0;
    const unlocked = shipCapstoneUnlocked(invest, def, treeIndex);
    const gateProgress = shipTreeBaseInvested(invest, def, treeIndex);

    const label = unlocked
      ? `★ ${node.name}   ${cur}/${node.maxPoints}`
      : `${node.name}   ${gateProgress}/${def.capstoneGate}`;
    const btn = new PixiButton({
      texture: this.ui[unlocked ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: unlocked ? 0x9a7a2a : 0x4a3a24,
      width: BOX.w,
      height: CAPSTONE_H,
      fontSize: 18,
      // 노란 버튼은 바탕이 밝아 흰 라벨이 묻힌다(기지 맵과 동일 처리).
      ...(unlocked ? { labelColor: COLOR.darkLabel } : {}),
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

    btn.container.position.set(BOX.x, CAPSTONE_Y);
    btn.container.on('pointerover', (e) => this.showTip(index, unlocked ? COLOR.gold : accent, e.global.x, e.global.y));
    btn.container.on('pointermove', (e) => this.moveTip(e.global.x, e.global.y));
    btn.container.on('pointerout', () => this.tooltip.hide());
    if (!unlocked) btn.container.alpha = 0.7;
    return btn.container;
  }

  // --- 전체 스킬 팝업 -------------------------------------------------------

  /**
   * 계열 전체 20노드를 아이콘 + 이름 + 설명 + `현재/최대` 로 보여 주고 거기서 투자시킨다.
   * 세로 스크롤은 마스크 + 클립 Container 조합이고, 마스크 높이는 행 피치의 배수로 클램프해
   * 반토막 행이 나오지 않게 한다.
   */
  private renderPopup(treeIndex: number): void {
    const def = this.def();
    const treeDef = def.trees[treeIndex];
    if (treeDef === undefined) return;
    const meta = { accent: AFFINITY_ACCENT[treeDef.affinity], name: shipTreeName(treeDef) };
    const nodes = flattenShipNodes(def);

    // 뒤 화면을 덮는 막 — 클릭을 흡수하고(뒤 행이 눌리지 않게) 바깥 클릭은 닫기로 쓴다.
    const veil = new Graphics();
    veil.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x000000, alpha: 0.62 });
    veil.eventMode = 'static';
    veil.on('pointertap', () => this.closePopup());
    this.root.addChild(veil);

    const panel = new Container();
    panel.position.set(POP_X, POP_Y);
    this.root.addChild(panel);
    // 밝은 화면 위 팝업은 불투명이어야 한다 — 반투명이면 뒤가 비쳐 읽기 어렵다(실측 결함).
    // 채움과 나무 살 사이 틈(뒤 화면이 비치던 띠)은 `fillInset` 기본값이 자산 실측으로
    // 바뀌면서 없어졌다 — 여기서 따로 당기지 않는다.
    panel.addChild(
      nineSlicePanel(POP_W, POP_H, {
        texture: this.ui['ui_panel.png'],
        border: PANEL_BORDER,
        fillAlpha: 1,
      }),
    );
    // 패널 위 클릭이 뒤의 막까지 새지 않게 막는다(패널 안 빈자리 클릭 = 닫힘 방지).
    const block = new Graphics();
    block.rect(0, 0, POP_W, POP_H).fill({ color: 0x000000, alpha: 0.001 });
    block.eventMode = 'static';
    panel.addChild(block);

    const title = new Text({
      resolution: 2,
      text: t('lab.all.title', { tree: meta.name }),
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: meta.accent, dropShadow: TEXT_SHADOW },
    });
    title.anchor.set(0, 0);
    title.position.set(PBOX.x, PBOX.y);
    panel.addChild(title);

    const close = makeIconButton(POP_CLOSE, () => this.closePopup(), this.ui['ui_icon_close.png']);
    close.position.set(PBOX.right - POP_CLOSE, PBOX.y);
    panel.addChild(close);

    const sub = new Text({
      resolution: 2,
      text: t('lab.all.sub', {
        n: this.profile.skillPoints,
        m: shipTreeBaseInvested(this.invest(), def, treeIndex),
      }),
      style: { fontFamily: UI_FONT, fontSize: 15, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0, 0);
    sub.position.set(PBOX.x, POP_SUB_Y);
    panel.addChild(sub);

    const scrollHint = new Text({
      resolution: 2,
      text: t('lab.all.hint'),
      style: { fontFamily: UI_FONT, fontSize: 13, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    scrollHint.anchor.set(1, 0);
    scrollHint.position.set(PBOX.right, POP_SUB_Y + 2);
    panel.addChild(scrollHint);

    // 마스크 하한은 콘텐츠 상자 바닥(프레임 + 여백 위) — 목록이 나무 테두리에 닿지 않는다.
    const viewH = clampToRowHeight(PBOX.bottom - POP_LIST_TOP, POP_ROW_PITCH);
    const { start } = shipTreeRange(def, treeIndex);
    const perTree = def.nodesPerTree;
    const totalH = listStackHeight(perTree, 1, POP_ROW_H, POP_ROW_GAP);

    const clip = new Container();
    clip.position.set(PBOX.x, POP_LIST_TOP);
    panel.addChild(clip);
    const mask = new Graphics();
    mask.rect(PBOX.x, POP_LIST_TOP, PBOX.w, viewH).fill({ color: 0xffffff });
    panel.addChild(mask);
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
      const row = this.makePopupRow(index, node, meta.accent);
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
      panel.addChild(track);
      const thumb = new Graphics();
      thumb.roundRect(barX, 0, 4, thumbH, 2).fill({ color: meta.accent, alpha: 0.75 });
      thumb.y = POP_LIST_TOP + Math.round((scrollY / maxScroll) * (viewH - thumbH));
      panel.addChild(thumb);

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

  /** 팝업 목록 행(780×65): 아이콘 + 이름 + 상세 설명 + `현재/최대`. 행 클릭 = 1포인트 투자. */
  private makePopupRow(index: number, node: SkillNode, accent: number): Container {
    const cur = this.invest()[index] ?? 0;
    const maxed = cur >= node.maxPoints;
    const canInvest = !maxed && this.profile.skillPoints > 0;

    const row = new Container();
    row.addChild(listRowBg(POP_ROW_W, POP_ROW_H, accent, cur > 0));

    const iconBoxY = Math.round((POP_ROW_H - POP_ICON) / 2);
    row.addChild(makeSkillIcon(this.ui[skillIconName(node)], 10, iconBoxY, POP_ICON, accent, maxed));

    const pts = new Text({
      resolution: 2,
      text: `${cur}/${node.maxPoints}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: '800',
        fill: maxed ? COLOR.gold : cur > 0 ? accent : COLOR.muted,
        dropShadow: TEXT_SHADOW,
      },
    });
    pts.anchor.set(1, 0.5);
    pts.position.set(POP_ROW_W - 14, POP_ROW_H / 2);
    row.addChild(pts);

    const textX = 10 + POP_ICON + 12;
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
      text: `${node.desc} · ${t('lab.node.meta', { t: node.tier + 1, m: node.maxPoints })}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: COLOR.muted,
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
    if (!canInvest) row.alpha = maxed ? 0.85 : 0.6;

    // 클릭 판정은 행 Container 에(바탕 Graphics 에만 걸면 텍스트·아이콘이 삼킨다).
    row.eventMode = 'static';
    row.cursor = canInvest ? 'pointer' : 'default';
    row.on('pointertap', () => this.investNode(index));
    return row;
  }

  // --- 액티브 스킬 팝업 -----------------------------------------------------

  /**
   * 액티브 장착 팝업(AC-16·17). 위는 장착 슬롯 2칸(누르면 해제), 아래는 **계열 × 티어** 격자다 —
   * 한 열이 한 계열이고 위/아래가 저티어·고티어라 "어느 계열에 투자하면 무엇이 열리는가"가
   * 배치만으로 읽힌다. 잠긴 칸은 필요 투자량({@link ActiveSlotView.threshold})을 그대로 보여 준다.
   */
  private renderActives(): void {
    const def = this.def();
    const views = this.activeViews();
    const ship = activeShip(this.profile);

    const veil = new Graphics();
    veil.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x000000, alpha: 0.62 });
    veil.eventMode = 'static';
    veil.on('pointertap', () => this.closeActives());
    this.root.addChild(veil);

    const panel = new Container();
    panel.position.set(ACT_X, ACT_Y);
    this.root.addChild(panel);
    // 밝은 화면 위 팝업은 불투명이어야 한다(전체 스킬 팝업과 같은 규율).
    panel.addChild(
      nineSlicePanel(ACT_W, ACT_H, {
        texture: this.ui['ui_panel.png'],
        border: PANEL_BORDER,
        fillAlpha: 1,
      }),
    );
    const block = new Graphics();
    block.rect(0, 0, ACT_W, ACT_H).fill({ color: 0x000000, alpha: 0.001 });
    block.eventMode = 'static';
    panel.addChild(block);

    const title = new Text({
      resolution: 2,
      text: t('lab.actives.title'),
      style: { fontFamily: UI_FONT, fontSize: 26, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
    });
    title.anchor.set(0, 0);
    title.position.set(ABOX.x, ABOX.y);
    panel.addChild(title);

    const close = makeIconButton(ACT_CLOSE, () => this.closeActives(), this.ui['ui_icon_close.png']);
    close.position.set(ABOX.right - ACT_CLOSE, ABOX.y);
    panel.addChild(close);

    const equipped = ship.activeSlots.filter((s) => s !== null).length;
    const sub = new Text({
      resolution: 2,
      // 슬롯 수는 `ACTIVE_SLOT_COUNT` 파생이다 — 2 를 문구에 박으면 슬롯이 늘 때 조용히 거짓말이 된다.
      text: t('lab.actives.sub', { n: equipped, m: ACTIVE_SLOT_COUNT }),
      style: { fontFamily: UI_FONT, fontSize: 15, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    sub.anchor.set(0, 0);
    sub.position.set(ABOX.x, ACT_SUB_Y);
    panel.addChild(sub);

    const unequipHint = new Text({
      resolution: 2,
      text: t('lab.actives.unequipHint'),
      style: { fontFamily: UI_FONT, fontSize: 13, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    unequipHint.anchor.set(1, 0);
    unequipHint.position.set(ABOX.right, ACT_SUB_Y + 2);
    panel.addChild(unequipHint);

    for (let slot = 0; slot < ACTIVE_SLOT_COUNT; slot++) {
      const card = this.makeActiveSlotCard(slot, views);
      card.position.set(ABOX.x + slot * (ACT_SLOT_W + ACT_SLOT_GAP), ACT_SLOT_Y);
      panel.addChild(card);
    }

    if (views.length === 0) {
      // 저작 전 기체(빈 레지스트리)에서 격자만 텅 비면 "고장났다"로 읽힌다 — 이유를 적는다.
      const none = new Text({
        resolution: 2,
        text: t('lab.actives.none'),
        style: { fontFamily: UI_FONT, fontSize: 16, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      none.anchor.set(0.5, 0.5);
      none.position.set(ACT_W / 2, (ACT_GRID_TOP + ABOX.bottom) / 2);
      panel.addChild(none);
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
      panel.addChild(head);
    });

    for (const cell of activeGridCells(views, cols)) {
      const treeDef = def.trees[cell.col];
      const accent = treeDef === undefined ? COLOR.gold : AFFINITY_ACCENT[treeDef.affinity];
      const box = this.makeActiveCell(cell, accent);
      box.position.set(cell.x, cell.y);
      panel.addChild(box);
    }
  }

  /** 장착 슬롯 카드 1칸. 채워져 있으면 누를 때 해제, 비어 있으면 무연산. */
  private makeActiveSlotCard(slot: number, views: readonly ActiveSlotView[]): Container {
    const view = views.find((v) => v.equippedSlot === slot);
    const accent = view === undefined ? 0x5a4630 : COLOR.gold;

    const card = new Container();
    card.addChild(listRowBg(ACT_SLOT_W, ACT_SLOT_H, accent, view !== undefined));

    const label = new Text({
      resolution: 2,
      text: t('lab.actives.slot', { n: slot + 1 }),
      style: { fontFamily: UI_FONT, fontSize: 12, fontWeight: '700', fill: COLOR.muted, dropShadow: TEXT_SHADOW },
    });
    label.anchor.set(0, 0);
    label.position.set(ACT_PAD, 8);
    card.addChild(label);

    if (view === undefined) {
      const empty = new Text({
        resolution: 2,
        text: t('lab.actives.slotEmpty'),
        style: { fontFamily: UI_FONT, fontSize: 16, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
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
      style: { fontFamily: UI_FONT, fontSize: 12, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
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
    box.addChild(listRowBg(w, ACT_CELL_H, equipped ? COLOR.gold : accent, equipped));

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
      style: { fontFamily: UI_FONT, fontSize: 13, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
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

    if (dim) box.alpha = 0.55;

    // 클릭 판정은 셀 Container 에. 잠긴 칸도 클릭을 살려 이유를 안내한다(팝업 행과 같은 규칙).
    box.eventMode = 'static';
    box.cursor = view.unlocked && !equipped ? 'pointer' : 'default';
    box.on('pointertap', () => {
      if (equipped) this.unequip(view.equippedSlot);
      else this.equip(view.def.id);
    });
    return box;
  }

  // --- 파생 스탯 하단 띠 ----------------------------------------------------

  /**
   * 파생 스탯 미리보기 — 화면 하단 가로 띠. 세로 목록이던 것을 눕혀 화면 폭을 쓴다
   * (계열 패널이 620px 로 넓어지면서 4번째 세로 패널 자리가 없어졌다).
   *
   * 콘텐츠 상자(1768×52)를 [제목 200 | 스탯 6열×2행 | 시너지 안내 360] 으로 가로 분할한다.
   */
  private renderStatsStrip(): void {
    const panel = new Container();
    panel.position.set(STRIP_X, STRIP_Y);
    this.root.addChild(panel);
    panel.addChild(nineSlicePanel(STRIP_W, STRIP_H, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));

    const midY = SBOX.y + SBOX.h / 2;

    const title = new Text({
      resolution: 2,
      text: t('lab.derivedStats'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: '800',
        fill: COLOR.cream,
        wordWrap: true,
        wordWrapWidth: STRIP_TITLE_W,
        dropShadow: TEXT_SHADOW,
      },
    });
    title.anchor.set(0, 0.5);
    title.position.set(SBOX.x, midY);
    panel.addChild(title);

    // 파생 스탯도 **기체 타입** 을 함께 넘긴다 — 노드 정의가 타입별이라 타입을 빼면 비온의
    // 25번째 이후 노드가 통째로 무시되고, 트리 슬라이스 폭도 20 으로 오판정된다.
    const sums = computeSkillStats(this.invest(), this.def().id);
    const rows = PREVIEW_ROWS.filter(([key]) => sums[key] !== 0);
    const cells = rectGridPositions(rows.length, STAT_COLS, STAT_COL_W, STAT_ROW_H, 0, 0);
    rows.forEach(([key, labelKey, isPct], i) => {
      const at = cells[i];
      if (at === undefined) return;
      const cy = SBOX.y + at.y + STAT_ROW_H / 2;
      const k = new Text({
        resolution: 2,
        text: t(labelKey),
        style: { fontFamily: UI_FONT, fontSize: 14, fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      k.anchor.set(0, 0.5);
      k.position.set(STAT_X + at.x, cy);
      panel.addChild(k);
      // 시너지 증폭은 분수를 만든다(예: 59.072) — 소수 1자리로 반올림해 표시 노이즈를 줄인다.
      const v = sums[key];
      const shownV = Number.isInteger(v) ? String(v) : v.toFixed(1);
      const val = new Text({
        resolution: 2,
        text: isPct ? `+${shownV}%` : `+${shownV}`,
        style: { fontFamily: UI_FONT, fontSize: 14, fontWeight: '800', fill: COLOR.gold, dropShadow: TEXT_SHADOW },
      });
      val.anchor.set(1, 0.5);
      val.position.set(STAT_X + at.x + STAT_COL_W - 10, cy);
      panel.addChild(val);
      // 최악 조합(긴 라벨 "대시 재충전 감소" + 3자리 값 "+149.0%")이 붙어 보이지 않게, 값이
      // 차지하고 남은 자리에 라벨을 가로로 눌러 맞춘다. 로케일이 바뀌어도 겹치지 않는다.
      const labelRoom = STAT_COL_W - 10 - val.width - 10;
      if (k.width > labelRoom) k.scale.x = labelRoom / k.width;
    });

    if (rows.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('lab.noStats'),
        style: { fontFamily: UI_FONT, fontSize: 16, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      empty.anchor.set(0, 0.5);
      empty.position.set(STAT_X, midY);
      panel.addChild(empty);
    }

    const syn = new Text({
      resolution: 2,
      text: t('lab.synergy'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 13,
        fill: COLOR.muted,
        wordWrap: true,
        wordWrapWidth: STRIP_SYN_W,
        lineHeight: 17,
        dropShadow: TEXT_SHADOW,
      },
    });
    syn.anchor.set(0, 0.5);
    syn.position.set(SBOX.right - STRIP_SYN_W, midY);
    panel.addChild(syn);
  }

  /** 리스펙 버튼 — 하단 띠에 자리를 내주고 타이틀바 우측으로 옮겼다. */
  private renderActions(): void {
    const cost = respecCost(this.profile);
    const respec = new PixiButton({
      texture: this.ui['ui_btn_red.png'],
      fallbackColor: 0x9a2a2a,
      width: RESPEC_W,
      height: RESPEC_H,
      fontSize: 18,
      label: t('lab.respecBtn', { n: cost }),
      onClick: () => void this.respec(),
    });
    respec.container.position.set(RESPEC_X, RESPEC_Y);
    this.root.addChild(respec.container);
    if (totalInvested(this.profile) === 0) respec.setEnabled(false);
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const h = new Text({
      resolution: 2,
      text: this.hint,
      style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: 0xff9a7a, dropShadow: TEXT_SHADOW },
    });
    h.anchor.set(0.5, 1);
    h.position.set(DESIGN_WIDTH / 2, HINT_Y);
    this.root.addChild(h);
  }
}
