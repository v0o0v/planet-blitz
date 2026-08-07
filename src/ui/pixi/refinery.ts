/**
 * 정제소 화면 — 정련 공정(ADR-0040, push-your-luck 연쇄) · 2026-08-02 AAA 시네마틱 전환
 * (레인 계약 `.omc/plans/refinery-aaa-2026-08-02.md`).
 *
 * 왼쪽에서 장비를 고르면 오른쪽에 **공정**이 열린다: 노 출력(약불·중불·강불)을 고르고 굴리면
 * 미고착 어픽스가 재추첨되고, 굴린 뒤 어픽스 하나까지 `고착`할 수 있다(해제 불가). 고착이
 * 쌓일수록 다음 굴림의 **용해** 위험이 오르고, 용해하면 그 공정의 고착이 전부 풀려 시작 직전
 * 상태로 돌아간다. 고착이 0개면 위험이 정확히 0 이라 구 단발 리롤이 규칙 하나에서 파생된다.
 *
 * 상태기계는 순수 모듈 `src/items/refiningChain.ts` 가 소유하고, 이 파일은 그 위에 입력·좌표·
 * 연출만 얹는다. 비용·위험 수치는 `data/economy.ts`(`rollCost`·`meltRisk`)가 정본이다.
 *
 * ⚠️ **결과 확정·저장이 언제나 연출보다 먼저다**(`persist()` → 연출 시작). 새로고침으로 나쁜
 * 롤을 무를 수 없는 이유가 이 순서에 있다. 연출은 이미 정해진 결과를 보여줄 뿐이라 render-only
 * 이고 결과에 영향을 주지 않는다.
 *
 * `main.ts` 가 직접 여는 **최상위 화면**이다(`refinery.show(profile, () => openBaseMap())`) —
 * 격납고 하위 화면들과 달리 suspend/resume 이 아니라 show/onClose 규약이다.
 *
 * ## 시네마틱 전환에서 바뀐 것은 **바탕과 배치**뿐이다
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재 슬래브), `makeBanner` → `makeHangarTitle`,
 * `makeCurrencyChip` → `makeHangarChip`, `ui_btn_*.png` → `cinematicButtonTexture` 주입,
 * `ui_slot*.png` → `cinematicSlotTexture`, 나무 칩 어픽스 행 → 석재 행 판(`rowPlate`),
 * 단색 배경 → `HangarBackdrop`. 굴림·고착·서버 왕복·저장 계약은 한 줄도 건드리지 않았다.
 *
 * ## 왜 배경 **창을 두지 않는가**(`windows: []`)
 * 형제 화면 넷의 결론: **창은 "배경이 보이는 구멍"이 아니라 "무언가를 보여주는 자리"다.**
 * 여기서 선택에 따라 바뀌는 것은 장비 하나인데, 그 장비의 유일한 그림은 인벤토리 아이콘
 * (`equipIconTexture`, 48~88px)이다. 400px 창에 세우면 **확대된 UI 아이콘**이지 회화가 아니다
 * (챔피언 선택은 전용 함선 원화가 있어 성립했다). 창에 세울 진짜 피사체는 노(furnace) 원화인데
 * 그건 신규 자산이라 이 레인 밖이고, 창 400px 을 떼면 상세 패널이 1188 → 788 로 줄어 어픽스
 * 행이 제목+설명 2줄을 못 담는다 — **정보 밀도가 이 화면의 목적이다**.
 *
 * ## 하단 [기지로 돌아가기] 버튼을 **없앴다**
 * 헤더 ✕ 와 같은 일(close)을 두 번 제공하면서 그 버튼 하나 때문에 패널 바닥이 894 에서 끊겨
 * 화면 하단 186px 이 통째로 비어 있었다. 형제 화면 넷은 전부 헤더 ✕ 하나만 쓴다. 되찾은
 * 세로는 두 패널이 받는다({@link PANEL_H} 는 파생값이다 — 하드코딩하면 여백을 바꿀 때 어긋난다).
 *
 * ## 신설: **용해 위험 트로프** — 공백을 메우는 것이 아니라 이 화면의 주제를 그린다
 * ADR-0040: "정련 연출의 무게중심은 결과 공개가 아니라 **누르기 전 긴장**이다." 그런데 위험은
 * 비용 줄 끝에 붙은 글자 조각이었고 고착 수는 반대편 끝에 따로 떠 있었다 — 둘은 같은 하나다.
 * 상자 폭 전체를 쓰는 파인 트로프 안에 `고착 n/총` + 게이지 바 + `용해 위험 n%` 를 모았다.
 * 위험 0 이면 게이지가 없고 "용해 위험 없음"만 남는다(위험이 없다는 사실이 시각적으로도 없어야
 * 한다는 기존 규칙 유지). 비용 줄에서는 위험 문구를 **뺐다** — 두 곳에서 같은 수치를 말하면
 * 하나는 노이즈다.
 *
 * ## 빈 자리를 남기지 않는다
 * 공정 뭉치(노 출력 → 비용 → 굴리기)를 콘텐츠 상자 **바닥에 못 박아** `lastBottom === boxBottom`
 * 이 등호로 성립한다. 어픽스 행 높이는 어픽스 수에서 **파생**해 4개 이상이면 영역을 거의 채우고
 * (n=4 잔여 20 · n=5 잔여 1 · n=6 잔여 4), 그보다 적으면 영역 한가운데 앉는다. 목록 격자도
 * 행 피치의 배수로 클램프해 잔여가 한 행 미만이다. 셋 다 단위 테스트가 잠근다.
 *
 * ## 행 사이에 **선을 긋지 않는다**
 * 세로 리브·가로 이음선·각인 번호판은 사용자가 격납고에서 삭제를 지시한 것들이다(2026-08-02).
 * 행 구분은 선이 아니라 **면의 밝기 차 + 2단 접지 그림자 + 행 간격**이 만든다.
 *
 * ## 재렌더 규율 — 이 화면은 **초당 14회** 갱신될 수 있다
 * 스핀 연출이 70ms 간격 12프레임이다. 옛 구현처럼 `render()` 로 루트를 통째로 다시 그리면 그
 * 매 프레임 배경과 석재 패널 2장이 다시 **구워진다**. 그래서
 *  - `buildChrome()` 은 1회(자산 도착 · **목록 개수 변화** 시에만 재건 — 목록 패널 제목이
 *    `refine.listHeader{n}` 이고 각인 제목 띠는 패널에 구워진다),
 *  - `syncValues()` 가 재화 칩·힌트를,
 *  - `renderGrid()` 가 격자 셀만, `renderDetail()` 이 상세 내용만 갈아끼운다.
 *  - `renderSpinFrame()` 은 예전처럼 **글자만** 바꾼다.
 *  - `update(dt)` 는 `main.ts` 가 매 프레임 부른다(`refinery.update(frame)`). 숨겨져 있으면
 *    즉시 반환하므로 정제소 밖 비용은 0 이다. ⚠️ 연구소가 이 배선을 빠뜨려 배경·패널 연출이
 *    통째로 멈춘 적이 있다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거)
 * - **행 클릭은 행 Container 에.** 바탕 Graphics 에 걸면 위에 얹힌 텍스트가 클릭을 삼킨다.
 * - **휠은 클립 Container 에.** 마스크 Graphics 는 히트 테스트에서 제외된다.
 * - 컬러 이모지 금지(`text.ts` stripEmoji 가 두부로 떨군다). `★ ✕` 는 보존 목록이다.
 * - ⚠️ `hudEl()` 에는 **캔버스 가드를 붙이지 않는다**(`typeof document.createElement !==
 *   'function'` 까지 검사하면 HUD 숨김이 통째로 죽는다 — 이 리포가 실제로 밟았다).
 * - ⚠️ 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드**다. 이 화면은 헤더 좌측이 비어 있어
 *   구조적으로 안전하지만, 나중에 뭔가 놓을 때가 진짜 위험이라 테스트로 잠갔다.
 * - ⚠️ 각인 제목은 중앙 정렬 Text 라 사각형이 없어 겹침 테스트가 못 잡는다 —
 *   {@link TITLE_BAND_HALF_W} 로 대역을 못 박는다(연구소에서 제목이 실제로 겹쳤다).
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js';
import { RARITY_CODE, SLOT_KINDS, type Item } from '../../items/types.js';
import { AFFIX_BY_ID } from '../../../data/affixes.js';
import { affixLines, affixTitleLine, affixDescLine } from '../affixText.js';
import { itemDisplayName, slotLabel } from '../itemNames.js';
import {
  openChain,
  fasten as fastenAffix,
  rollChain,
  isComplete,
  rerollableCount,
  type ChainState,
} from '../../items/refiningChain.js';
import { isSkillAffix, refinePoolFor } from '../../items/affixPool.js';
import { saveProfile, type KeyValueStore, type Profile } from '../../save/profile.js';
import { rollRefineOnServer } from '../../net/index.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { rollCost, meltRisk, canAfford, HEATS, type Heat } from '../../../data/economy.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, RARITY_COLOR_NUM, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { PixiButton } from './button.js';
import { makeSlotCell, rectGridPositions, equipIconTexture } from './slotGrid.js';
import { makeScrollArea } from './scrollArea.js';
import { PixiTooltip } from './tooltip.js';
import { stripEmoji } from './text.js';
import { graphicsSettings } from '../../render/graphicsSettings.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import { HELP_HEAD_W, openHelpOverlay, type HelpSpec } from './helpModal.js';
import {
  makeHangarTitle,
  makeHangarChip,
  cinematicButtonTexture,
  cinematicSlotTexture,
  chromeFallbackColor,
  chromeLabelColor,
  type ChromeTone,
} from './hangarChrome.js';

// 슬롯·무기 표시명은 `src/ui/itemNames.ts` 단일 정본을 쓴다(화면마다 다른 이름 금지).

// ---------------------------------------------------------------------------
// 레이아웃(디자인 스페이스 1920×1080)
//
// 여백 어휘(32 / 28 / 하단 28)와 헤더 높이 104 는 격납고·촉매 보관함·예비역 로스터·챔피언
// 선택·연구소와 **같은 값**이다. 형제 화면끼리 다르면 화면 전환에서 튄다.
// ---------------------------------------------------------------------------

/**
 * `cinematicPanel.ts` 콘텐츠 상자 기하의 **복제본**(출처: 그 파일의 `EDGE_PAD 24` ·
 * `CONTENT_GAP 16` · `TITLE_BAND_H = round(TITLE_SIZE 26 × 2)`).
 *
 * 왜 베끼는가: {@link refineryDetailLayout} 이 **Pixi 없이** 검증돼야 하는데(기존
 * `tests/pixiScreenPersistence.test.ts` 가 그 부등식을 캔버스 없이 잠근다) 패널 상자는 런타임
 * 객체다. 베낀 값이 조용히 어긋나면 공정 뭉치가 패널 테두리를 뚫는데 예외도 로그도 없다 —
 * `tests/refineryAaaLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조한다.
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

const PANEL_Y = HEADER_H + 8;
/** 패널 세로는 **남는 자리 전부**다(빈 자리 금지 — 하드코딩하면 여백을 바꿀 때 어긋난다). */
const PANEL_H = DESIGN_HEIGHT - BOTTOM_PAD - PANEL_Y;
const LIST_X = EDGE_X;
const LIST_W = 640;
const DETAIL_X = EDGE_X + LIST_W + GUTTER_X;
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

// --- 장비 격자(목록 패널) ---
/**
 * 정렬 버튼 줄 — 콘텐츠 상자 맨 위. 4칸이 상자 폭을 정확히 나눠 쓴다(폭은 파생값).
 * 격자는 그만큼 아래에서 시작하고, 셀 크기가 남은 세로에서 다시 역산된다.
 */
const SORT_H = 42;
const SORT_GAP_X = 10;
const SORT_TO_GRID = 12;
const SORT_COLS = 4;
const SORT_W = Math.floor((BOX_L.w - SORT_GAP_X * (SORT_COLS - 1)) / SORT_COLS);

const GRID_COLS = 6;
const CELL_GAP = 10;
const GRID_TOP = BOX_L.y + SORT_H + SORT_TO_GRID;
/** 격자가 쓸 수 있는 세로 — 정렬 줄을 뺀 나머지. */
const GRID_AVAIL = BOX_L.bottom - GRID_TOP;
/**
 * 셀 한 변은 **가용 세로에서 역산**한다(9행이 정확히 들어가는 최대 크기). 88 을 박아 두면
 * 정렬 줄을 넣거나 상자 높이가 바뀔 때마다 바닥에 반 행 몫의 죽은 자리가 남는다.
 */
const GRID_ROWS_FIT = 9;
const CELL = Math.floor((GRID_AVAIL + CELL_GAP) / GRID_ROWS_FIT) - CELL_GAP;
const CELL_PITCH = CELL + CELL_GAP;
const GRID_W = GRID_COLS * CELL_PITCH - CELL_GAP;
/** 마스크 하한 = 행 피치의 배수(반토막 셀 금지). 잔여는 한 행 미만이어야 한다. */
const GRID_H = Math.floor((GRID_AVAIL + CELL_GAP) / CELL_PITCH) * CELL_PITCH - CELL_GAP;
const GRID_X = BOX_L.x + Math.floor((BOX_L.w - GRID_W) / 2);

// --- 상세 패널(정련 공정) ---
/** 장비 머리(아이콘 + 이름 + 부제) 띠. 아이콘 한 변과 같은 높이다. */
const ITEM_ICON = 88;
const ITEM_HEAD_H = ITEM_ICON;
const ITEM_HEAD_GAP = 24;
const AFFIX_TOP = BOX_D.y + ITEM_HEAD_H + ITEM_HEAD_GAP;

// 어픽스 목록 아래 블록: [노 출력 3버튼] → [비용 줄] → [굴리기 · 공정 멈추기].
const HEAT_H = 56;
const HEAT_W = 200;
const HEAT_GAP = 14;
const HEAT_TO_COST = 16;
const COST_H = 30;
const COST_TO_ACTION = 14;
const ROLL_W = 380;
const ROLL_H = 68;
const STOP_W = 260;
const ACTION_GAP = 24;
/** 콘텐츠 상자 바닥에 못 박히는 세로 뭉치 높이(=184). */
const BLOCK_H = HEAT_H + HEAT_TO_COST + COST_H + COST_TO_ACTION + ROLL_H;
/** 뭉치는 **바닥에 붙는다** — 그래서 `lastBottom === boxBottom` 이 등호로 성립한다. */
const BLOCK_Y = BOX_D.bottom - BLOCK_H;

/** 용해 위험 트로프(파일 헤더 "신설"). 높이는 고정이고 남는 세로는 어픽스 영역이 받는다. */
const TROUGH_H = 84;
const TROUGH_GAP = 20;
const TROUGH_Y = BLOCK_Y - TROUGH_GAP - TROUGH_H;

/** 어픽스 목록이 쓸 수 있는 세로 — 트로프에서 **역산**한다. */
const AFFIX_TO_TROUGH = 20;
const AFFIX_REGION_H = TROUGH_Y - AFFIX_TO_TROUGH - AFFIX_TOP;
const AFFIX_GAP = 8;
/**
 * 어픽스 영역을 **파낸 노(furnace) 챔버**로 그리고, 행을 그 안쪽으로 이 값만큼 들여 앉힌다.
 *
 * ## 왜 필요한가 (실화면 1차 확인)
 * 어픽스가 1개인 장비에서 이 영역 428px 중 330px 이 그냥 빈 갈색 면이었다 — 형제 화면 넷이
 * 전부 잡아 고친 "쓸모도 볼거리도 아닌 자리"의 정확한 형태다. 그런데 어픽스 수는 장비가 정하는
 * 것이라 행으로 채울 수가 없다.
 *
 * → 처방은 채우는 것이 아니라 **그 자리에 이름을 주는 것**이다. 영역을 파내면 남는 공간이
 * "빈 패널 면"이 아니라 **비어 있는 노 안**이 된다. 아래 트로프와 같은 재질이라 둘이 한 설비로
 * 읽히고, 어픽스가 꽉 찬 장비에서는 행이 챔버를 덮으므로 아무 비용도 없다.
 * (파인 면의 조명 부호는 볼록한 행 판과 **반대**다: 위가 그늘, 아래가 수광.)
 */
const AFFIX_WELL_PAD = 12;
/** 행 폭 — 챔버 안쪽. 행이 챔버 테두리를 덮으면 파낸 것으로 안 읽힌다. */
const AFFIX_ROW_W = BOX_D.w - AFFIX_WELL_PAD * 2;
/**
 * 어픽스 행 높이의 하한·상한. 행은 어픽스 수에서 **파생**해 영역을 채운다(4개 이상이면 잔여가
 * 20px 이하다). 상한이 없으면 어픽스 1개짜리 장비에서 428px 짜리 행이 나오고, 하한이 없으면
 * 6어픽스 레어에서 제목+설명 두 줄이 안 들어간다.
 */
const AFFIX_H_MIN = 64;
const AFFIX_H_MAX = 96;
/**
 * 스크롤 없이 들어가야 하는 어픽스 행 수 — **레어의 최대 어픽스 수**다. 이 화면의 결정(어느
 * 어픽스를 고착할까)은 전량을 한눈에 봐야 성립하므로, 흔한 경우에 스크롤이 붙으면 안 된다.
 * 트로프를 키우거나 장비 머리를 키우면 영역이 줄어 조용히 깨지는 성질이라 테스트로 잠근다.
 */
const AFFIX_ROWS_NO_SCROLL = 6;

/** {@link refineryDetailLayout} 결과 — 전부 상세 패널 로컬 y 좌표. */
export interface RefineryDetailLayout {
  /** 어픽스 목록 첫 행의 top(영역 안에서 세로 중앙 정렬된 값). */
  readonly rowsTop: number;
  /** 어픽스 목록의 bottom. */
  readonly rowsEnd: number;
  /** 어픽스 행 한 장의 높이(어픽스 수 파생). */
  readonly rowH: number;
  /** 보이는 목록의 세로(넘치면 영역 높이로 클램프 — 스크롤이 나머지를 맡는다). */
  readonly viewH: number;
  /** 목록 전체 세로(스크롤 총량 판정용). */
  readonly totalH: number;
  /** 용해 위험 트로프의 top. */
  readonly troughY: number;
  readonly troughH: number;
  /** 노 출력 3버튼 행의 top. */
  readonly heatY: number;
  /** 비용 줄의 top. */
  readonly costY: number;
  /** 굴리기·공정 멈추기 버튼 행의 top. */
  readonly actionY: number;
  /** 상세 패널 마지막 요소의 bottom(= 버튼 행 bottom). */
  readonly lastBottom: number;
  /** 콘텐츠 상자 바닥 — 이 값을 넘으면 패널 테두리를 뚫는다. */
  readonly boxBottom: number;
}

/**
 * 어픽스 수에서 상세 패널 세로 좌표를 **파생**한다(하드코딩 금지 — 이 리포의 관례).
 *
 * 공정 뭉치는 콘텐츠 상자 바닥에 못 박혀 있고({@link BLOCK_Y}), 트로프는 그 위에 고정 높이로
 * 앉는다. 어픽스 목록은 남은 영역 안에서 **행 높이를 늘려** 영역을 채우되 상한
 * {@link AFFIX_H_MAX} 를 넘지 않고, 그래도 남으면 영역 한가운데에 앉는다. 그래서 어픽스가
 * 몇 개든 `lastBottom === boxBottom` 이고 `heatY >= rowsEnd` 가 **산술적으로** 성립한다 —
 * 6어픽스에서 버튼이 테두리를 뚫던 결함이 좌표 재유도 없이 구조적으로 막힌다.
 *
 * 순수 함수(Pixi 미의존) — 렌더와 테스트가 같은 식을 쓴다.
 */
export function refineryDetailLayout(affixCount: number): RefineryDetailLayout {
  const n = Math.max(0, Math.trunc(affixCount));
  const rowH =
    n <= 0
      ? AFFIX_H_MIN
      : Math.max(
          AFFIX_H_MIN,
          Math.min(AFFIX_H_MAX, Math.floor((AFFIX_REGION_H + AFFIX_GAP) / n) - AFFIX_GAP),
        );
  const totalH = n <= 0 ? 0 : n * (rowH + AFFIX_GAP) - AFFIX_GAP;
  const viewH = Math.min(totalH, AFFIX_REGION_H);
  const rowsTop = AFFIX_TOP + Math.floor((AFFIX_REGION_H - viewH) / 2);
  const costY = BLOCK_Y + HEAT_H + HEAT_TO_COST;
  const actionY = costY + COST_H + COST_TO_ACTION;
  return {
    rowsTop,
    rowsEnd: rowsTop + viewH,
    rowH,
    viewH,
    totalH,
    troughY: TROUGH_Y,
    troughH: TROUGH_H,
    heatY: BLOCK_Y,
    costY,
    actionY,
    lastBottom: actionY + ROLL_H,
    boxBottom: BOX_D.bottom,
  };
}

// --- 헤더 컨트롤 ---
const HEAD_GAP = 12;
const CHIP_W = 190;
const CLOSE_W = 56;
const CLOSE_X = DESIGN_WIDTH - EDGE_X - CLOSE_W;
const CREDIT_CHIP_X = CLOSE_X - HEAD_GAP - 2 - CHIP_W;
const MINERAL_CHIP_X = CREDIT_CHIP_X - HEAD_GAP - 2 - CHIP_W;
/** 도움말 버튼 — 오른쪽 컨트롤 줄의 맨 왼쪽(여섯 화면 공통 자리 · {@link HELP_HEAD_W} 주석). */
const HELP_X = MINERAL_CHIP_X - HEAD_GAP - 2 - HELP_HEAD_W;

/** 정제소 도움말 절 목록. 기구는 공용 모듈이 쥔다 — 여기서는 무엇을 말할지만 정한다. */
export const REFINERY_HELP: HelpSpec = {
  prefix: 'refine.help',
  sections: ['s1', 's2', 's3', 's4', 's5'],
};
/**
 * 각인 제목이 실제로 차지하는 가로 반폭. 중앙 정렬 Text 는 사각형이 없어 겹침 테스트가 못
 * 잡는다 — 연구소 실화면에서 제목이 헤더 버튼과 **실제로 겹쳤다**. 대역을 상수로 못 박고
 * 좌우 컨트롤이 이 안에 들어오지 못하게 테스트로 잠근다.
 */
export const TITLE_BAND_HALF_W = 280;

/**
 * 좌상단 예약 밴드 — `main.ts` SettingsScreen 의 설정 톱니가 쓰는 **전 화면 공용 자리**다.
 * 톱니는 매 프레임 stage 최상위로 올라오므로 여기에 컨트롤을 두면 통째로 클릭 불가가 된다.
 */
export const GEAR_BAND_W = 120;
export const GEAR_BAND_H = 120;

const HINT_Y = DESIGN_HEIGHT - 4;

/** 석재 슬래브 위 **보조 텍스트색**(연구소 `SLAB_BODY_FILL` 복제 — 그 파일은 화면이다). */
const SLAB_BODY_FILL = 0xe4dac7;
/** 행 판 바탕색·홈·반경 — 예비역 로스터 `rowPlate` → 챔피언 선택 → 연구소 경유 복제. */
const ROW_FACE = 0x3b3327;
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;
/** 위험 게이지의 차가운 끝 ↔ 뜨거운 끝. 숫자를 읽지 않아도 상태가 읽힌다. */
const RISK_COOL = 0xd8a24a;
const RISK_HOT = 0xe4552a;

/** 화면 좌표 사각형(디자인 스페이스). */
export interface RefineryRect {
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
export function refineryLayout(): {
  readonly screen: RefineryRect;
  readonly headerH: number;
  readonly panels: readonly { readonly id: string; readonly rect: RefineryRect }[];
  readonly headerControls: readonly { readonly id: string; readonly rect: RefineryRect }[];
  /** 배경이 보존되는 창 — **없다**(파일 헤더 "왜 배경 창을 두지 않는가"). */
  readonly windows: readonly RefineryRect[];
} {
  const head = (x: number, w: number): RefineryRect => ({ x, y: HEAD_Y, w, h: HEAD_H });
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels: [
      { id: 'list', rect: { x: LIST_X, y: PANEL_Y, w: LIST_W, h: PANEL_H } },
      { id: 'detail', rect: { x: DETAIL_X, y: PANEL_Y, w: DETAIL_W, h: PANEL_H } },
    ],
    headerControls: [
      { id: 'help', rect: head(HELP_X, HELP_HEAD_W) },
      { id: 'minerals', rect: head(MINERAL_CHIP_X, CHIP_W) },
      { id: 'credits', rect: head(CREDIT_CHIP_X, CHIP_W) },
      { id: 'close', rect: head(CLOSE_X, CLOSE_W) },
    ],
    windows: [],
  };
}

/** 장비 격자의 산술 전제(단위 테스트가 빈 자리·넘침을 잠근다). */
export const REFINERY_GRID = {
  cols: GRID_COLS,
  cell: CELL,
  gap: CELL_GAP,
  pitch: CELL_PITCH,
  w: GRID_W,
  h: GRID_H,
  x: GRID_X,
  y: GRID_TOP,
  /** 격자가 쓸 수 있었던 세로(정렬 줄을 뺀 나머지). `h` 와의 차가 한 행 피치 미만이어야 한다. */
  avail: GRID_AVAIL,
  boxW: BOX_L.w,
  /** 정렬 버튼 줄 — 콘텐츠 상자 맨 위. 4칸이 상자 폭을 정확히 나눠 쓴다. */
  sortY: BOX_L.y,
  sortH: SORT_H,
  sortW: SORT_W,
  sortGapX: SORT_GAP_X,
  sortCols: SORT_COLS,
} as const;

/**
 * 장비 목록 정렬 축. **획득순이 기본**이다 — 인벤토리 순서가 곧 획득 순서라 "방금 주운 것"이
 * 어디 있는지 알 수 있는 유일한 정렬이고, 다른 정렬을 기본으로 두면 그 정보가 사라진다.
 */
export type RefinerySort = 'recent' | 'rarity' | 'slot' | 'affixes';

/** 정렬 버튼 순서(화면 왼쪽 → 오른쪽) = 이 배열 순서다. */
export const REFINERY_SORTS: readonly RefinerySort[] = ['recent', 'rarity', 'slot', 'affixes'];

const SORT_LABEL_KEY: Record<RefinerySort, MessageKey> = {
  recent: 'refine.sort.recent',
  rarity: 'refine.sort.rarity',
  slot: 'refine.sort.slot',
  affixes: 'refine.sort.affixes',
};

/**
 * 목록 정렬(순수 함수 — 입력 배열을 건드리지 않는다).
 *
 * ⚠️ **`rerollable()` 자체는 정렬하지 않는다.** 그 함수는 "굴릴 수 있는 것"의 정의이고 회귀
 * 테스트가 쓰는 표면이라, 표시 순서를 거기에 섞으면 정렬을 바꿀 때마다 무관한 단언이 흔들린다.
 *
 * 세 정렬 다 **동률에서 획득순으로 되돌아간다** — 그렇지 않으면 같은 등급 장비들의 자리가
 * 굴릴 때마다 미묘하게 바뀌어, 방금 고른 칸이 어디로 갔는지 눈으로 못 쫓는다.
 *
 * ⚠️ 원래 인덱스 tie-break 는 **중복 방어이지 그 성질의 근거가 아니다** — `Array.sort` 는
 * ES2019 부터 안정 정렬이라 이 항을 지워도 결과가 같다(뮤테이션으로 실측: 지워도 초록).
 * 그래도 남겨 둔 이유는 의도를 코드에 적어 두기 위해서다. 이 항을 근거로 "그래서 안정적이다"
 * 라고 읽지 마라 — 근거는 `sort` 의 안정성이고, 이 항은 그것을 명시할 뿐이다.
 */
export function sortRefineryItems(items: readonly Item[], mode: RefinerySort): Item[] {
  const out = items.map((item, index) => ({ item, index }));
  const key = (it: Item): number => {
    if (mode === 'rarity') return -RARITY_CODE[it.rarity];
    if (mode === 'affixes') return -it.affixes.length;
    return SLOT_KINDS.indexOf(it.slot);
  };
  if (mode !== 'recent') {
    out.sort((a, b) => key(a.item) - key(b.item) || a.index - b.index);
  }
  return out.map((e) => e.item);
}

/** 상세 패널 콘텐츠 상자(단위 테스트가 실제 패널 상자와 대조한다). */
export const REFINERY_DETAIL_BOX = {
  x: BOX_D.x,
  y: BOX_D.y,
  w: BOX_D.w,
  h: BOX_D.h,
  bottom: BOX_D.bottom,
  /** 어픽스 목록 영역(트로프에서 역산된 값). */
  affixTop: AFFIX_TOP,
  affixRegionH: AFFIX_REGION_H,
  /** 노 챔버 안쪽 여백과 그 안에 앉는 행 폭. */
  wellPad: AFFIX_WELL_PAD,
  rowW: AFFIX_ROW_W,
  /** 스크롤 없이 들어가야 하는 행 수와 그 최소 세로. */
  rowsNoScroll: AFFIX_ROWS_NO_SCROLL,
  rowsNoScrollH: AFFIX_ROWS_NO_SCROLL * (AFFIX_H_MIN + AFFIX_GAP) - AFFIX_GAP,
  /** 노 출력 3버튼 행의 폭과, 그 오른쪽 안내가 접히려면 필요한 최소 폭(`renderHeatRow` 하한). */
  heatRowW: HEATS.length * HEAT_W + (HEATS.length - 1) * HEAT_GAP,
  heatHintGap: 20,
  heatHintMinW: 120,
} as const;

// --- 행 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 행 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 *
 * (예비역 로스터 `rowRamp` → 챔피언 선택 → 연구소 경유 복제. 형제 화면이라 같은 값이어야 하고,
 * 그 파일들은 공용 모듈이 아니라 화면이라 import 하지 않는다.)
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
   * 금지지만, 어느 어픽스가 고착됐는지는 이 목록이 말해야 하는 유일한 정보다.
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
 * **파낸 면** 한 장(노 챔버 · 위험 트로프가 공유한다). 볼록한 {@link rowPlate} 와 조명 부호가
 * 정확히 반대다: 위가 그늘이고 **아래 입술만** 빛을 받는다. 이 부호가 뒤집히면 파인 자리가
 * 아니라 얹어 놓은 판때기로 읽힌다.
 */
function recessedWell(x: number, y: number, w: number, h: number): Graphics {
  const g = new Graphics();
  g.roundRect(x, y, w, h, 12)
    .fill({ color: 0x14100a, alpha: 0.82 })
    .stroke({ color: 0x0a0705, width: 2, alignment: 1, alpha: 0.9 });
  g.moveTo(x + 14, y + h - 1.5)
    .lineTo(x + w - 14, y + h - 1.5)
    .stroke({ color: 0xc9a04a, width: 1, alpha: 0.3 });
  return g;
}

/** 연출 종류. 전부 render-only — 결과는 시작 전에 이미 확정·저장돼 있다. */
type FxKind = 'spin' | 'melt' | 'complete';
const FX_FRAMES: Record<FxKind, number> = { spin: 12, melt: 8, complete: 10 };

/** 노 출력 → 버튼 톤. 청록→금→적이 그 자체로 열 구배를 이룬다(나무 시절 wood→yellow→red 승계). */
const HEAT_TONE: Record<Heat, ChromeTone> = { low: 'blue', mid: 'gold', high: 'red' };

export class RefineryScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private selectedId: string | null = null;
  /** 현재 열려 있는 정련 공정. 장비를 새로 고르거나 화면을 나가면 버린다(인벤토리는 이미 최신). */
  private chain: ChainState | null = null;
  /** 노 출력. 공정을 새로 열 때마다 `mid` 로 리셋한다(중불이 비용 ×1 앵커). */
  private heat: Heat = 'mid';
  private spinning = false;
  /**
   * 굴림 재화 차감(`spend_currency`)의 서버 왕복이 진행 중인지 — 동시(재진입) 클릭 가드.
   * `spinning` 은 차감 확정 **뒤에야**(await 이후) 세워지므로 왕복 중에는 재진입을 막지 못한다.
   * 이 플래그가 그 창을 잠가 광물 이중 차감을 차단하고, 이후는 `spinning` 이 이어받는다.
   * 정련 공정은 스텝이 늘어 이 창이 더 자주 열린다 — **제거하지 마라.**
   */
  private busy = false;
  private hint = '';
  private spinTimer: ReturnType<typeof setInterval> | null = null;
  /** 진행 중인 연출(render-only). */
  private fx: { kind: FxKind; ticks: number } | null = null;
  /** 연출 오버레이(패널 전면 색 플래시). 프레임마다 알파만 갈아끼운다. */
  private fxOverlay: Graphics | null = null;
  /** 스핀 프레임이 글자만 갈아끼울 어픽스 행 텍스트(고착 행은 null). */
  private spinTexts: (Text | null)[] = [];
  private listScrollY = 0;
  private affixScrollY = 0;
  /** 목록 정렬 축. 화면을 나갔다 들어와도 유지한다(고른 정렬이 매번 풀리면 쓸모가 없다). */
  private sort: RefinerySort = 'recent';
  private ui: UiTextures = {};
  private art: HangarTextures = {};
  /** 진입 시점의 런 HUD `visibility` 인라인 값(닫을 때 그대로 되돌린다). */
  private hudPrevVisibility: string | null = null;

  // ── 위험 가시화(render-only) ──────────────────────────────────────────────
  /** 굴리기 버튼 뒤 열기 후광. 위험이 오를수록 짙어진다. */
  private heatHalo: Graphics | null = null;
  /** 트로프 게이지의 발광(후광과 **같은 위상**으로 맥동한다 — 갈리면 두 물건으로 읽힌다). */
  private riskGlow: Graphics | null = null;
  /** 미세 진동을 받는 굴리기 버튼 컨테이너와 그 기준 좌표. */
  private rollNode: Container | null = null;
  private rollBase = { x: 0, y: 0 };
  private haloPhase = 0;
  private haloTicking = false;

  // --- 유지되는 크롬(파일 헤더 "재렌더 규율") ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  private chromeBuilt = false;
  /** 크롬을 세운 시점의 목록 개수 — 목록 패널 제목에 구워지므로 바뀌면 재건한다. */
  private builtForItemCount = -1;
  private gridHost: Container | null = null;
  private detailHost: Container | null = null;
  private chipHost: Container | null = null;
  /** 화면 안내 팝업 — 열림 여부 · 스크롤 위치 · 그릇 · 패널(수명 관리용). */
  private helpOpen = false;
  private helpScroll = 0;
  private helpHost: Container | null = null;
  private helpPanel: CinematicPanel | null = null;
  private hintText: Text | null = null;

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
   * 즉시 반환하므로 정제소 밖 비용은 0 이다.
   */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const p of this.panels) p.update(dt);
  }

  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.selectedId = null;
    this.chain = null;
    this.heat = 'mid';
    this.stopSpin();
    this.hint = '';
    this.affixScrollY = 0;
    // 목록 개수가 바뀌었으면 목록 패널 제목이 달라진다 — 크롬을 다시 세운다.
    if (this.chromeBuilt && this.builtForItemCount !== this.rerollable().length) {
      this.destroyChrome();
    }
    this.buildChrome();
    this.refresh();
    this.root.visible = true;
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    this.hideRunHud();
  }

  hide(): void {
    this.stopSpin();
    this.stopHeatAnim();
    // 공정 상태만 버린다 — 굴린 결과는 굴릴 때마다 이미 인벤토리에 반영·저장돼 있다(ADR-0040).
    this.chain = null;
    this.root.visible = false;
    this.tooltip.hide();
    this.onClose = null;
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

  private stopSpin(): void {
    if (this.spinTimer !== null) {
      clearInterval(this.spinTimer);
      this.spinTimer = null;
    }
    this.fx = null;
    this.spinning = false;
  }

  private persist(): void {
    // ⚠️ 명시적 null 은 `saveProfile` 의 기본 인자를 밀어내고 즉시 return 된다 — main.ts 가
    // store 없이 이 화면을 만들기 때문에 그대로 넘기면 정제 결과가 저장되지 않는다.
    saveProfile(this.profile, this.store ?? undefined);
  }

  // --- 선택 / 노 출력 / 고착 / 굴림 ---------------------------------------

  /**
   * 재굴림 가능 어픽스가 하나라도 있는 인벤토리 장비(굴릴 가치가 있는 것만).
   *
   * `rerollableCount() > 0` — 어픽스가 전부 스킬 어픽스(암묵 고착)인 아이템은 굴릴 것이 없다.
   * ⚠️ 현행 규칙에서는 이 상태에 **도달 불가**하다(스킬 어픽스 최대 1개 + rare·unique 어픽스
   * 3~6 → rerollable ≥ 2, magic·normal 은 스킬 어픽스 자체가 0개) — 손으로 빚은 Item·향후
   * 규칙 완화에 대비한 방어 코드다. 도달 불가능한 이 분기 자체를 지우지는 마라.
   */
  private rerollable(): Item[] {
    return this.profile.inventory.filter((it) => rerollableCount(it) > 0);
  }

  private selected(): Item | undefined {
    if (this.selectedId === null) return undefined;
    return this.profile.inventory.find((it) => it.id === this.selectedId);
  }

  /**
   * 지금 굴림에 드는 광물(= 등급·어픽스 수 기본값 × 노 출력 배수).
   *
   * ⚠️ `heat` 를 **인자로 받는다.** `reroll()` 은 서버 왕복 전에 비용을 계산하고 왕복 후에 굴림을
   * 판정하는데, 둘이 각자 `this.heat` 를 읽으면 그 사이 노 출력이 바뀌었을 때 **지불한 열과
   * 적용된 열이 갈린다**(약불 값으로 강불 밴드를 사거나 그 반대). 호출부가 스냅샷한 같은 값을
   * 넘기게 해서 두 출처를 하나로 합친다 — 가드는 창을 좁힐 뿐 없애지 못한다.
   */
  private currentCost(heat: Heat = this.heat): number {
    const item = this.selected();
    if (item === undefined) return 0;
    return rollCost(item.rarity, item.affixes.length, heat);
  }

  /** 지금 굴리면 용해할 확률 [0,1]. 고착 0 이면 정확히 0. */
  private currentRisk(): number {
    const item = this.selected();
    if (item === undefined) return 0;
    // 분모는 rerollableCount() — 판정(rollChain)과 같은 분모를 써야 한다(refiningChain.ts 참조).
    return meltRisk(this.chain?.fastened.length ?? 0, rerollableCount(item), this.heat);
  }

  private fastenedCount(): number {
    return this.chain?.fastened.length ?? 0;
  }

  /**
   * 장비 선택. 공정을 새로 연다 — 이전 공정 상태(고착·위험)는 버리고 노 출력도 `mid` 로 리셋한다.
   * ⚠️ 메서드 이름은 회귀 테스트가 캐스팅으로 직접 부른다. 바꾸지 마라.
   */
  private select(item: Item): void {
    // 서버 왕복 중(`busy`)에는 선택을 바꾸지 않는다 — 왕복 뒤 복귀한 굴림이 남의 슬롯에 쓰는
    // 경로의 1차 방어다(본 방어는 `reroll()` 의 복귀 후 재검증).
    if (this.spinning || this.busy) return;
    this.selectedId = item.id;
    this.chain = openChain(item);
    this.heat = 'mid';
    this.hint = '';
    this.affixScrollY = 0;
    this.refresh();
  }

  /**
   * 목록 정렬 변경. **선택과 공정은 건드리지 않는다** — 자리만 바뀌지 무엇을 굴리는 중인지는
   * 그대로여야 한다. 연출·서버 왕복 중에는 막는다(재렌더가 스핀 텍스트를 파괴한다).
   */
  private setSort(mode: RefinerySort): void {
    if (this.spinning || this.busy) return;
    if (this.sort === mode) return;
    this.sort = mode;
    // 순서가 통째로 바뀌었으므로 스크롤 위치는 의미를 잃는다 — 맨 위로 되돌린다.
    this.listScrollY = 0;
    this.refresh();
  }

  private setHeat(heat: Heat): void {
    // 결제가 끝난 왕복 중에 노 출력을 바꾸면 화면에 띄운 위험·비용이 실제 판정과 달라진다.
    if (this.spinning || this.busy) return;
    this.heat = heat;
    this.refresh();
  }

  /**
   * 어픽스 고착(굴림당 1개, 해제 불가). 상태기계가 무시하면(`next === chain`) 아무 일도 없다.
   * 완주 판정은 **여기서** 한다 — 굴림은 고착 수를 바꾸지 않으므로 `RollOutcome.complete` 는
   * "입력이 이미 완주였다"는 뜻일 뿐이다(레인 C 계약 §1).
   */
  private fasten(index: number): void {
    if (this.spinning || this.busy) return;
    const chain = this.chain;
    if (chain === null) return;
    const next = fastenAffix(chain, index);
    if (next === chain) return; // 무시됨(범위 밖·중복·굴림 전) — 참조 비교가 판별식이다.
    this.chain = next;
    if (isComplete(next)) {
      this.hint = t('refine.chain.complete');
      this.startFx('complete');
      return;
    }
    this.hint = '';
    this.refresh();
  }

  /** 공정 멈추기 — 현재 상태를 확정하고 새 공정을 연다(고착·위험이 0으로 돌아간다). */
  private stopRefining(): void {
    if (this.spinning || this.busy) return;
    const item = this.selected();
    if (item === undefined) return;
    this.chain = openChain(item);
    this.hint = '';
    this.refresh();
  }

  /**
   * 굴림 1회. 현재 선택된 노 출력을 쓴다.
   * ⚠️ 메서드 이름은 회귀 테스트가 캐스팅으로 직접 부른다. 바꾸지 마라.
   */
  private async reroll(): Promise<void> {
    const item = this.selected();
    // 동시(재진입) 클릭 가드: `spinning` 은 await 뒤에야 세워지므로 서버 왕복 창은 `busy` 로 막는다.
    if (item === undefined || this.spinning || this.busy) return;
    // 공정 상태는 **선택된 장비의 것이어야 한다.** 외부 경로(main.ts 의 직접 `hide()`·하네스·
    // 테스트)가 선택을 바꿔 둘이 갈리면, 이 chain 으로 굴린 결과가 남의 슬롯에 쓰여 장비가
    // 사라지고 id 가 중복된다. 갈렸으면 선택된 장비로 공정을 다시 연다.
    let chain = this.chain;
    if (chain === null || chain.baseline.id !== item.id) {
      chain = openChain(item);
      this.chain = chain;
    }
    // 완주 후 굴림은 얻을 것이 0인데 위험은 최댓값이다. 상태기계도 막지만 여기서도 막는다(이중 방어).
    if (isComplete(chain)) return;

    // 노 출력을 **진입 시점에 스냅샷**한다 — 비용과 굴림 판정이 반드시 같은 값을 써야 한다.
    const heat = this.heat;
    const cost = this.currentCost(heat);
    if (!canAfford(this.profile.minerals, cost)) {
      this.hint = t('refine.err.noMinerals', { n: cost });
      this.refresh();
      return;
    }
    // 네트워크 창을 잠근다 — spend 확정 후에는 `spinning` 이 재진입을 막으므로 여기서만 유효하면 된다.
    this.busy = true;
    try {
      // 재화 서버 권위(ADR-0027): 온라인이면 spend_currency 로 광물 차감을 확정(ok 일 때만 굴림),
      // 미설정이면 기존 로컬 차감. 잔액 부족·오프라인(rejected)이면 굴리지도 용해하지도 않는다.
      // ⭐ 차감과 **굴림 값**을 한 번에 받는다(ADR-0050 §3 단계 1 둘째 축). 종전에는 차감만
      // 서버를 타고 시드는 아래에서 `Math.random()` 으로 만들었는데, `rollChain` 이 난수를
      // 주입받는 순수 함수라 **광물을 한 번만 내고 원하는 어픽스가 나올 때까지 로컬에서
      // 굴릴 수 있었다.** 시드를 서버가 주면 대가를 치른 횟수만큼만 굴린다.
      const res = await rollRefineOnServer(cost);
      // 서버가 준 굴림 값. `null` 이면 미설정(오프라인)이라 아래에서 로컬로 만든다.
      let serverSeed: number | null = null;
      let serverRisk: number | null = null;
      if (res.status === 'ok') {
        this.profile.credits = res.creditsLeft;
        this.profile.minerals = res.mineralsLeft;
        serverSeed = res.seed;
        serverRisk = res.riskRoll;
      } else if (res.status === 'unconfigured') {
        this.profile.minerals -= cost;
      } else if (res.status === 'rejected') {
        // 서버 원장이 판정해 거부했다. 로컬 미러는 치트·오프라인 가산으로 부풀 수 있으므로
        // **서버 잔액을 그대로 보여준다** — "광물이 부족합니다" 한 줄만 내면 광물을 잔뜩 든
        // 유저에게 거짓말이 된다(격납고 창고 확장에서 실제로 신고된 오탐과 같은 부류).
        this.hint = t('spend.err.rejectedMinerals', { n: cost, have: res.mineralsLeft });
        this.refresh();
        return;
      } else {
        // 판정 자체를 못 받았다(오프라인·네트워크 오류). 차감도 굴림도 용해도 없다.
        this.hint = t('spend.err.unavailable');
        this.refresh();
        return;
      }

      // ⚠️ 여기서부터 "떠날 때의 세계"를 믿지 않는다. 가드는 창을 좁힐 뿐 없애지 못한다 —
      //    `main.ts` 는 `close()` 를 거치지 않고 `hide()` 를 직접 부르고, 하네스·테스트는
      //    메서드를 직접 찌른다. 그래서 복귀 직후에 다시 확인한다.
      const stillSame = this.selectedId === item.id;
      const stillVisible = this.root.visible;

      // 굴림 시드·용해 주사위. 온라인이면 **서버가 준 값**을 쓴다 — 클라가 고르면 대가를 한 번만
      // 치르고 원하는 어픽스가 나올 때까지 굴릴 수 있다(`rollChain` 은 순수 함수다).
      // 미설정(오프라인 단일플레이)일 때만 로컬에서 만든다 — sim 밖이라 `Math.random` 자유다.
      // ⛔ 이 폴백을 온라인 실패 경로까지 넓히지 마라. 넓히면 "차감됐는지 모르는 채 굴리는"
      //    경로가 생겨 공짜 굴림의 문이 그대로 다시 열린다(위 `failed` 분기가 return 하는 이유).
      const seed = serverSeed ?? ((Math.random() * 0xffffffff) >>> 0);
      const riskRoll = serverRisk ?? Math.random();
      const outcome = rollChain(chain, heat, seed, riskRoll);

      // 인벤토리 반영·저장은 **무조건** 한다 — 이 장비의 굴림 값을 이미 지불했으므로 결과를
      // 삼키면 안 된다. **연출보다 먼저**여야 한다(ADR-0040 §결과 확정과 연출의 순서).
      const idx = this.profile.inventory.findIndex((it) => it.id === item.id);
      if (idx >= 0) this.profile.inventory[idx] = outcome.next.current;
      this.persist();

      // 화면 상태 갱신은 아직 같은 장비를 보고 있을 때만. 다르면 chain 을 덮어쓰지 않는다 —
      // 덮어쓰면 selectedId 와 chain 이 갈려 다음 굴림이 남의 슬롯에 쓴다(장비 영구 소실의 뿌리).
      if (!stillSame) return;
      this.chain = outcome.next;
      this.hint = outcome.melted ? t('refine.chain.melted') : '';
      // 이미 나간 화면에서 연출을 시작하면 Ticker·setInterval 이 샌다(render 누수).
      if (stillVisible) this.startFx(outcome.melted ? 'melt' : 'spin');
    } finally {
      this.busy = false;
    }
  }

  private itemName(item: Item): string {
    return itemDisplayName(item);
  }

  private affixText(item: Item, i: number): string {
    const a = item.affixes[i];
    if (a === undefined) return '';
    return affixTitleLine(a);
  }

  /** 값 범위가 퇴화(`min === max`)인 어픽스인가 — 노 출력 밴드가 값을 못 바꾼다. */
  private isDegenerate(item: Item, i: number): boolean {
    const a = item.affixes[i];
    if (a === undefined) return false;
    const def = AFFIX_BY_ID.get(a.id);
    return def !== undefined && def.min === def.max;
  }

  // --- 연출(render-only) ---------------------------------------------------

  /**
   * 연출을 시작한다. **호출 시점에 결과는 이미 확정·저장돼 있다** — 여기서 결과가 바뀌는 일은
   * 없고, 바뀌게 만들지도 마라(새로고침으로 나쁜 롤을 무를 수 없는 근거가 그 순서다).
   */
  private startFx(kind: FxKind): void {
    this.stopSpin();
    this.fx = { kind, ticks: 0 };
    this.spinning = true;
    this.refresh();
    const total = FX_FRAMES[kind];
    this.spinTimer = setInterval(() => {
      const fx = this.fx;
      if (fx === null) {
        this.stopSpin();
        return;
      }
      fx.ticks++;
      if (fx.ticks >= total) {
        this.stopSpin();
        this.refresh();
        return;
      }
      if (fx.kind === 'spin') this.renderSpinFrame();
      else this.updateFxOverlay();
    }, 70);
  }

  /**
   * 슬롯머신 프레임: 고착되지 않은 어픽스 행 문구를 무작위 어픽스 이름으로 덮어쓴다.
   *
   * 릴은 **정련 풀**(`refinePoolFor(item.slot)`, base-24 중 그 슬롯에서 나오는 것만)에서
   * 돈다 — 전역 24종에서 돌리면 이 슬롯에서 나올 수 없는 어픽스가 흘러가 거짓 기대를 만든다.
   * 결과 확정 **이후**의 연출이라 `Math.random` 자체는 결정론과 무관하다(ADR-0040).
   */
  private renderSpinFrame(): void {
    const item = this.selected();
    if (item === undefined) return;
    const pool = refinePoolFor(item.slot);
    if (pool.length === 0) return;
    for (const label of this.spinTexts) {
      if (label === null || label === undefined || label.destroyed) continue;
      const entry = pool[(Math.random() * pool.length) | 0];
      if (entry === undefined) continue;
      label.scale.x = 1;
      label.text = `${entry.def.name} (${entry.def.stat} +?)`;
    }
  }

  /** 용해·완주 플래시: 짧고 명확하게 사라진다(반복 피로 방지 — 용해는 자주 본다). */
  private updateFxOverlay(): void {
    const o = this.fxOverlay;
    const fx = this.fx;
    if (o === null || o.destroyed || fx === null) return;
    o.alpha = Math.max(0, 0.45 * (1 - fx.ticks / FX_FRAMES[fx.kind]));
  }

  /**
   * 열기 후광 + 트로프 게이지 발광 + 미세 진동을 프레임 구동한다. 위험이 오를수록 짙고 크게
   * 흔들린다 — 정련 연출의 무게중심은 결과 공개가 아니라 **누르기 전 긴장**이다(ADR-0040).
   *
   * 프레임 루프가 없는 환경(node 테스트·SSR)에서는 아예 구독하지 않는다(button.ts 와 동형).
   * 광과민 대응(`reducedMotion`)이면 정적 세기로 한 번만 칠하고 끝낸다.
   */
  private startHeatAnim(): void {
    if (this.haloTicking) return;
    if (typeof requestAnimationFrame !== 'function') return;
    if (graphicsSettings.getSettings().reducedMotion) return;
    this.haloTicking = true;
    Ticker.shared.add(this.onHeatFrame);
  }

  private stopHeatAnim(): void {
    this.heatHalo = null;
    this.riskGlow = null;
    this.rollNode = null;
    if (!this.haloTicking) return;
    this.haloTicking = false;
    Ticker.shared.remove(this.onHeatFrame);
  }

  private readonly onHeatFrame = (ticker: Ticker): void => {
    const halo = this.heatHalo;
    const glow = this.riskGlow;
    const node = this.rollNode;
    const dead = (g: Container | null): boolean => g === null || g.destroyed;
    if (dead(halo) && dead(glow) && dead(node)) {
      this.stopHeatAnim();
      return;
    }
    this.haloPhase += ticker.deltaMS / 1000;
    const risk = this.currentRisk();
    const pulse = Math.sin(this.haloPhase * 6);
    if (halo !== null && !halo.destroyed) {
      halo.alpha = Math.max(0, 0.18 + 0.42 * risk + 0.12 * risk * pulse);
    }
    if (glow !== null && !glow.destroyed) {
      glow.alpha = Math.max(0, 0.22 + 0.4 * risk + 0.14 * risk * pulse);
    }
    if (node !== null && !node.destroyed) {
      const amp = 2.6 * risk;
      node.position.set(
        this.rollBase.x + Math.sin(this.haloPhase * 23) * amp,
        this.rollBase.y + Math.cos(this.haloPhase * 31) * amp,
      );
    }
  };

  // --- 툴팁 ----------------------------------------------------------------

  private showTip(item: Item, globalX: number, globalY: number): void {
    // 툴팁은 제목 + 설명 2줄 묶음(목록 행은 한 줄짜리 affixText 그대로).
    const lines = affixLines(item.affixes);
    this.showTipLines(this.itemName(item), item, lines, globalX, globalY);
  }

  private showTipLines(
    title: string,
    item: Item,
    lines: string[],
    globalX: number,
    globalY: number,
  ): void {
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.show(
      {
        title,
        titleColor: RARITY_COLOR_NUM[item.rarity],
        subtitle: `${slotLabel(item.slot)} · ${t(`item.rarity.${item.rarity}` as MessageKey)}`,
        lines,
      },
      p.x,
      p.y,
      RARITY_COLOR_NUM[item.rarity],
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

  private close(): void {
    // 연출 중 이탈 금지 + 서버 왕복 중 이탈 금지(숨겨진 화면에서 Ticker·setInterval 이 샌다).
    // ⚠️ `main.ts` 는 화면 전환·런 시작에서 `close()` 를 거치지 않고 `hide()` 를 직접 부른다 —
    //    그래서 이 가드는 1차 방어일 뿐이고, 누수를 막는 것은 `reroll()` 의 `stillVisible` 이다.
    if (this.spinning || this.busy) return;
    const cb = this.onClose;
    this.hide();
    cb?.();
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
    // 연출 참조를 먼저 끊는다 — destroy 된 컨테이너를 update·Ticker 가 만지면 안 된다.
    this.helpPanel?.destroy();
    this.helpPanel = null;
    this.helpHost = null;
    this.stopHeatAnim();
    this.fxOverlay = null;
    this.spinTexts = [];
    this.backdrop?.destroy();
    this.backdrop = null;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.gridHost = null;
    this.detailHost = null;
    this.chipHost = null;
    this.hintText = null;
    for (const child of [...this.root.children]) {
      if (child === this.tooltip.container) continue;
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    this.chromeBuilt = false;
  }

  private buildChrome(): void {
    if (this.chromeBuilt) return;
    const count = this.rerollable().length;

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

    const listPanel = this.addPanel(
      LIST_X,
      PANEL_Y,
      LIST_W,
      PANEL_H,
      t('refine.listHeader', { n: count }),
    );
    const gridHost = new Container();
    listPanel.container.addChild(gridHost);
    this.gridHost = gridHost;

    const detailPanel = this.addPanel(
      DETAIL_X,
      PANEL_Y,
      DETAIL_W,
      PANEL_H,
      t('refine.processTitle'),
    );
    const detailHost = new Container();
    detailPanel.container.addChild(detailHost);
    this.detailHost = detailHost;

    this.buildHeader();

    const hintText = new Text({
      resolution: 2,
      text: '',
      style: {
        fontFamily: UI_FONT,
        fontSize: 18,
        fontWeight: '700',
        fill: 0xff9a7a,
        dropShadow: TEXT_SHADOW,
      },
    });
    hintText.anchor.set(0.5, 1);
    hintText.position.set(DESIGN_WIDTH / 2, HINT_Y);
    this.root.addChild(hintText);
    this.hintText = hintText;

    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    this.chromeBuilt = true;
    this.builtForItemCount = count;
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

  /** 시네마틱 버튼 — 기존 `PixiButton` 에 석재 텍스처만 주입한다(로직은 그대로). */
  private chromeButton(o: {
    tone: ChromeTone;
    width: number;
    height: number;
    fontSize: number;
    label: string;
    sound?: 'uiNavigate' | 'uiConfirm' | 'uiPositive';
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
      ...(o.sound === undefined ? {} : { sound: o.sound }),
      onClick: o.onClick,
    });
  }

  /**
   * 헤더 밴드(y 0..{@link HEADER_H}) — 각인 제목(중앙) · 재화 칩 2종 · 닫기(우).
   *
   * ⚠️ 컨트롤은 **전부 같은 세로 띠**를 쓰고 가로로만 배치한다(격납고 헤더 겹침 결함 이력).
   * ⚠️ **각인 석재 인방은 넣지 않는다**(격납고에서 사용자 판단으로 제거됨). 헤더는 배경이 그대로
   * 보이는 띠이고, 배경 모듈이 이 대역을 중간 세기로 눌러 글자 대비를 보장한다.
   */
  private buildHeader(): void {
    const title = makeHangarTitle(t('refine.title'));
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

    // 도움말 — 재화 칩·닫기와 **같은 세로 띠**를 쓰고 가로로만 자리를 잡는다.
    const help = this.chromeButton({
      tone: 'stone',
      width: HELP_HEAD_W,
      height: HEAD_H,
      fontSize: 20,
      label: t('refine.help'),
      onClick: () => this.openHelp(),
    });
    help.container.position.set(HELP_X, HEAD_Y);
    this.root.addChild(help.container);

    // 칩은 값이 구워진 컨테이너라 갱신이 아니라 재조립이다 — 그릇만 잡아 둔다.
    const chips = new Container();
    this.root.addChild(chips);
    this.chipHost = chips;

    // 도움말 팝업 그릇 — 항상 맨 위에 뜬다(툴팁만 그 위로 올라간다).
    const helpHost = new Container();
    this.root.addChild(helpHost);
    this.helpHost = helpHost;
  }

  /** 화면 안내 팝업 — 읽기 전용이라 정련 상태를 건드리지 않는다. */
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
      spec: REFINERY_HELP,
      get: () => this.helpScroll,
      set: (v) => {
        this.helpScroll = v;
      },
      onClose: () => this.closeHelp(),
    });
  }

  // --- 갱신 -----------------------------------------------------------------

  /** 값만 갈아끼운다. 배경·석재 패널은 다시 굽지 않는다(파일 헤더 "재렌더 규율"). */
  private refresh(): void {
    // 프레임 구동 참조가 이번 갱신에서 전부 파괴되므로 먼저 끊는다(파괴된 노드 접근 방지).
    this.stopHeatAnim();
    this.fxOverlay = null;
    this.spinTexts = [];
    this.syncValues();
    this.renderGrid();
    this.renderDetail();
    this.renderHelp();
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    if (this.currentRisk() > 0) this.startHeatAnim();
  }

  private syncValues(): void {
    if (this.chipHost !== null) {
      const host = this.chipHost;
      for (const child of [...host.children]) {
        host.removeChild(child);
        child.destroy({ children: true });
      }
      // 광물 = 청록 · 크레딧 = 금. 색만으로 두 칩이 구분된다(격납고·연구소와 같은 배정).
      const minerals = makeHangarChip(
        CHIP_W,
        HEAD_H,
        String(this.profile.minerals),
        this.ui['ui_icon_crystal.png'] ?? undefined,
        'teal',
      );
      minerals.position.set(MINERAL_CHIP_X, HEAD_Y);
      host.addChild(minerals);
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

    if (this.hintText !== null) {
      this.hintText.text = this.hint;
      this.hintText.visible = this.hint !== '';
    }
  }

  // --- 장비 격자 -------------------------------------------------------------

  private renderGrid(): void {
    const host = this.gridHost;
    if (host === null) return;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }

    // 정렬 줄은 목록이 비어 있어도 그린다 — 컨트롤이 상태에 따라 나타났다 사라지면 사용자는
    // 그것이 있었다는 사실 자체를 못 배운다.
    this.renderSortRow(host);

    const items = sortRefineryItems(this.rerollable(), this.sort);
    if (items.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('refine.noItems'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 19,
          fill: SLAB_BODY_FILL,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: BOX_L.w - 24,
          lineHeight: 28,
          dropShadow: TEXT_SHADOW,
        },
      });
      // 빈 목록 자리는 세로로 크므로 안내를 그 한가운데 둔다(위에 붙으면 버려진 여백처럼 보인다).
      empty.anchor.set(0.5, 0.5);
      empty.position.set(BOX_L.x + BOX_L.w / 2, GRID_TOP + GRID_H / 2);
      host.addChild(empty);
      return;
    }

    const rows = Math.ceil(items.length / GRID_COLS);
    const totalH = rows * CELL_PITCH - CELL_GAP;
    const content = makeScrollArea(host, {
      x: GRID_X,
      y: GRID_TOP,
      w: GRID_W,
      h: GRID_H,
      totalH,
      get: () => this.listScrollY,
      set: (v) => {
        this.listScrollY = v;
      },
      thumb: true,
    });

    const positions = rectGridPositions(items.length, GRID_COLS, CELL, CELL, CELL_GAP, CELL_GAP);
    items.forEach((item, i) => {
      const isSel = item.id === this.selectedId;
      const cell = makeSlotCell({
        size: CELL,
        item,
        slotTex: cinematicSlotTexture(isSel, i),
        iconTex: equipIconTexture(this.ui, item),
        highlight: isSel,
        highlightTex: cinematicSlotTexture(true, i),
        onClick: () => this.select(item),
        onHover: (gx, gy) => this.showTip(item, gx, gy),
        onMove: (gx, gy) => this.moveTip(gx, gy),
        onOut: () => this.tooltip.hide(),
      });
      if (isSel) {
        // 선택 표시: 금색 링(등급색 테두리 바깥). 등급 시각 언어를 가리지 않는다.
        const ring = new Graphics();
        ring
          .roundRect(2, 2, CELL - 4, CELL - 4, 9)
          .stroke({ color: COLOR.gold, width: 3, alignment: 1 });
        cell.addChild(ring);
      }
      const pos = positions[i];
      if (pos !== undefined) cell.position.set(pos.x, pos.y);
      content.addChild(cell);
    });
  }

  /**
   * 정렬 버튼 줄(라디오). 선택 표시는 노 출력 버튼과 **같은 어휘**(금색 링 + 미선택 한 톤
   * 낮춤)다 — 한 화면 안에 라디오 관용구가 둘이면 그중 하나는 버튼처럼 안 읽힌다.
   */
  private renderSortRow(host: Container): void {
    REFINERY_SORTS.forEach((mode, i) => {
      const isSel = this.sort === mode;
      const btn = this.chromeButton({
        // 정렬은 자원을 쓰지 않는 중립 조작이라 석재다(청록은 "자원을 쓴다"에 배정돼 있다).
        tone: 'stone',
        width: SORT_W,
        height: SORT_H,
        fontSize: 17,
        label: t(SORT_LABEL_KEY[mode]),
        sound: 'uiNavigate',
        onClick: () => this.setSort(mode),
      });
      const node = btn.container;
      node.position.set(BOX_L.x + i * (SORT_W + SORT_GAP_X), BOX_L.y);
      if (isSel) {
        const ring = new Graphics();
        ring
          .roundRect(2, 2, SORT_W - 4, SORT_H - 4, 9)
          .stroke({ color: COLOR.gold, width: 3, alignment: 1 });
        node.addChild(ring);
      } else {
        node.alpha = 0.72;
      }
      host.addChild(node);
      if (this.spinning) btn.setEnabled(false);
    });
  }

  // --- 정련 공정 -------------------------------------------------------------

  private renderDetail(): void {
    const host = this.detailHost;
    if (host === null) return;
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }

    // ⚠️ **설비는 장비가 없어도 그린다.** 옛 구현은 미선택이면 안내 한 줄만 남겨 패널
    //    1140×848 이 통째로 빈 갈색 면이었다(실화면 1차 확인 — 이 화면 최악의 빈 자리).
    //    노는 장비가 없어도 거기 있다: 빈 챔버 · 위험 트로프 · 노 출력 · 꺼진 굴리기 버튼을
    //    그대로 두고 **머리에서 무엇을 해야 하는지 말한다.** 그러면 남는 자리가 "빈 패널"이
    //    아니라 "쉬고 있는 설비"가 된다.
    const item = this.selected();
    this.renderItemHead(host, item);

    const L = refineryDetailLayout(item?.affixes.length ?? 0);
    // 노 챔버를 **먼저** 판다 — 행은 그 안에 앉는다. 어픽스가 적은 장비에서 남는 자리가
    // "빈 패널 면"이 아니라 "비어 있는 노 안"이 되게 하는 것이 이 한 줄의 전부다.
    host.addChild(recessedWell(BOX_D.x, AFFIX_TOP, BOX_D.w, AFFIX_REGION_H));
    if (item !== undefined) this.renderAffixList(host, item, L);
    this.renderTrough(host, item, L);
    this.renderHeatRow(host, L.heatY);
    if (item !== undefined) this.renderCostRow(host, L.costY);
    this.renderActionRow(host, L.actionY, item !== undefined);
    if (item === undefined) return;

    // 연출 오버레이는 패널 맨 위. 용해=붉음, 완주=금색. 알파는 프레임마다 줄어든다.
    const fx = this.fx;
    if (fx !== null && fx.kind !== 'spin') {
      const o = new Graphics();
      o.roundRect(BOX_D.x - 8, BOX_D.y - 8, BOX_D.w + 16, BOX_D.h + 16, 12).fill({
        color: fx.kind === 'melt' ? 0xd8452a : COLOR.gold,
      });
      o.alpha = 0.45;
      o.eventMode = 'none';
      host.addChild(o);
      this.fxOverlay = o;
    }
  }

  /**
   * 장비 머리 — 소켓에 앉은 아이콘 + 이름 + (슬롯 · 등급 · 고착 안내).
   *
   * `item` 이 없으면 **빈 소켓**과 안내 한 줄이 그 자리를 그대로 쓴다. 안내를 패널 한가운데
   * 띄우지 않는 이유는, 그러면 아래 설비(챔버·트로프·버튼)와 겹쳐 읽혀 무엇이 조작 대상인지
   * 흐려지기 때문이다 — 안내는 **비어 있는 소켓 옆**에 있어야 "여기에 넣어라"가 된다.
   */
  private renderItemHead(host: Container, item: Item | undefined): void {
    const cell = makeSlotCell({
      size: ITEM_ICON,
      ...(item === undefined ? {} : { item, iconTex: equipIconTexture(this.ui, item) }),
      slotTex: cinematicSlotTexture(item !== undefined, 0),
      highlight: item !== undefined,
      highlightTex: cinematicSlotTexture(true, 0),
    });
    cell.position.set(BOX_D.x, BOX_D.y);
    host.addChild(cell);

    const textX = BOX_D.x + ITEM_ICON + 18;
    const name = new Text({
      resolution: 2,
      text: item === undefined ? t('refine.selectPrompt') : this.itemName(item),
      style: {
        fontFamily: UI_FONT,
        fontSize: 32,
        fontWeight: '800',
        fill: item === undefined ? COLOR.muted : RARITY_COLOR_NUM[item.rarity],
        dropShadow: TEXT_SHADOW,
      },
    });
    name.position.set(textX, BOX_D.y + 6);
    host.addChild(name);

    const sub = new Text({
      resolution: 2,
      text:
        item === undefined
          ? t('refine.chain.fastenHint')
          : `${slotLabel(item.slot)} · ${t(`item.rarity.${item.rarity}` as MessageKey)} · ${t('refine.chain.fastenHint')}`,
      style: {
        fontFamily: UI_FONT,
        fontSize: 17,
        fill: SLAB_BODY_FILL,
        wordWrap: true,
        wordWrapWidth: BOX_D.right - textX,
        dropShadow: TEXT_SHADOW,
      },
    });
    sub.position.set(textX, BOX_D.y + 52);
    host.addChild(sub);
  }

  /**
   * 어픽스 목록. 행 높이는 어픽스 수 파생이라 4개 이상이면 영역을 거의 채우고, 그보다 적으면
   * 영역 한가운데 앉는다(빈 자리 금지). 넘치면 스크롤 영역이 받는다 — 지금 등급 정의로는
   * 최대 6이라 스크롤이 안 붙지만, 어픽스 수가 늘어도 목록이 트로프를 뚫지 않게 하는 보험이다.
   */
  private renderAffixList(host: Container, item: Item, L: RefineryDetailLayout): void {
    const content = makeScrollArea(host, {
      x: BOX_D.x + AFFIX_WELL_PAD,
      y: L.rowsTop,
      w: AFFIX_ROW_W,
      h: L.viewH,
      totalH: L.totalH,
      get: () => this.affixScrollY,
      set: (v) => {
        this.affixScrollY = v;
      },
      thumb: true,
    });
    for (let i = 0; i < item.affixes.length; i++) {
      const row = this.makeAffixRow(item, i, L.rowH);
      row.position.set(0, i * (L.rowH + AFFIX_GAP));
      content.addChild(row);
    }
  }

  /** 어픽스 한 행: 석재 행 판 + 제목 줄 + 설명 줄 + 고착 버튼(또는 고착됨 표식). */
  private makeAffixRow(item: Item, index: number, h: number): Container {
    const chain = this.chain;
    const roll = item.affixes[index];
    const def = roll === undefined ? undefined : AFFIX_BY_ID.get(roll.id);
    // 스킬 어픽스는 정련에서 암묵 고착이다(§3) — 고착 버튼이 아예 뜨지 않고 "고착됨 · 정련
    // 불가"만 보인다. `chain.fastened` 에는 절대 들어가지 않는다(사용자가 누를 방법이 없다).
    const isSkillAffixRow = def !== undefined && isSkillAffix(def);
    const isFastened = chain !== null && chain.fastened.indexOf(index) >= 0;
    const isLocked = isFastened || isSkillAffixRow;
    const canFasten = chain !== null && chain.canFasten && !isLocked && !this.spinning;
    const row = new Container();
    const w = AFFIX_ROW_W;

    const plate = rowPlate(w, h);
    row.addChild(plate.view);
    plate.setSelected(isFastened);
    if (!isLocked && this.fastenedCount() > 0) {
      // 고착된 행이 눈에 띄도록 나머지는 한 톤 낮춘다.
      row.alpha = 0.82;
    }

    const btnW = 132;
    const btnH = 40;
    const iconSize = 34;
    // 오른쪽 끝 요소(고착 버튼 또는 고착됨 표식)가 시작하는 x.
    const rightX = isFastened ? w - 20 - iconSize : w - 20 - btnW;

    const label = new Text({
      resolution: 2,
      text: this.affixText(item, index),
      style: {
        fontFamily: UI_FONT,
        fontSize: 20,
        fontWeight: '700',
        fill: this.spinning && !isLocked ? COLOR.muted : isLocked ? COLOR.gold : COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    label.anchor.set(0, 0.5);
    label.position.set(20, Math.round(h * 0.34));
    // 긴 어픽스 문구가 오른쪽 요소와 겹치지 않게 가로만 축소한다(잘라내면 무슨 어픽스인지 모른다).
    const maxLabelW = rightX - 14 - 20;
    try {
      if (label.width > maxLabelW) label.scale.x = maxLabelW / label.width;
    } catch {
      /* 캔버스 없는 환경(node 테스트)에서는 측정이 던진다 — 축소는 순수 장식이라 건너뛴다. */
    }
    row.addChild(label);
    this.spinTexts[index] = isLocked ? null : label;

    // 설명 줄 — 지금까지 hover 툴팁에만 있던 정보다. 1140px 폭에 64px 이상 높이면 그냥 들어간다.
    if (roll !== undefined) {
      const desc = new Text({
        resolution: 2,
        text: affixDescLine(roll),
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fill: SLAB_BODY_FILL,
          dropShadow: TEXT_SHADOW,
        },
      });
      desc.anchor.set(0, 0.5);
      desc.position.set(20, Math.round(h * 0.7));
      try {
        if (desc.width > maxLabelW) desc.scale.x = maxLabelW / desc.width;
      } catch {
        /* 캔버스 없는 환경 — 축소는 순수 장식이라 건너뛴다. */
      }
      row.addChild(desc);
    }

    if (isFastened) {
      // 고착은 해제 불가 — 눌러도 되는 것처럼 보이면 안 되므로 버튼이 아니라 표식이다.
      const lock = new Text({
        resolution: 2,
        text: '★',
        style: {
          fontFamily: UI_FONT,
          fontSize: iconSize,
          fontWeight: '800',
          fill: COLOR.gold,
          dropShadow: TEXT_SHADOW,
        },
      });
      lock.anchor.set(0.5);
      lock.position.set(rightX + iconSize / 2, h / 2);
      lock.eventMode = 'none';
      row.addChild(lock);
    } else if (isSkillAffixRow) {
      // 스킬 어픽스는 정련이 건드리지 못한다(§3 — roll.ts 가 암묵 고착으로 유지한다).
      // 버튼처럼 눌러도 될 것처럼 보이면 안 되므로 여기도 버튼이 아니라 표식이다.
      const locked = new Text({
        resolution: 2,
        text: stripEmoji(t('refine.skillAffix.locked')),
        style: {
          fontFamily: UI_FONT,
          fontSize: 15,
          fontWeight: '700',
          fill: COLOR.muted,
          align: 'right',
          wordWrap: true,
          wordWrapWidth: btnW,
          dropShadow: TEXT_SHADOW,
        },
      });
      locked.anchor.set(1, 0.5);
      locked.position.set(rightX + btnW, h / 2);
      locked.eventMode = 'none';
      row.addChild(locked);
    } else {
      const btn = this.chromeButton({
        tone: 'blue',
        width: btnW,
        height: btnH,
        fontSize: 18,
        label: stripEmoji(t('refine.chain.fasten')),
        sound: 'uiPositive',
        onClick: () => this.fasten(index),
      });
      btn.container.position.set(rightX, (h - btnH) / 2);
      row.addChild(btn.container);
      if (!canFasten) btn.setEnabled(false);
    }

    // hover 경고 둘 — 퇴화 범위(min === max, 강불이 값을 못 바꾼다)와 슬롯 밖 어픽스(정련
    // 풀에 없어 굴리면 되돌릴 수 없이 사라진다). 이미 고착됐거나 스킬 어픽스면 슬롯 밖 경고는
    // 의미가 없다(정련이 건드리지 못하므로 안전하다).
    // ⚠️ hover 판정은 **행 Container** 에 건다(바탕 Graphics 에만 걸면 위에 얹힌 텍스트가
    //    이벤트를 삼킨다 — 실측 결함).
    const isOffSlot =
      !isLocked &&
      def !== undefined &&
      !refinePoolFor(item.slot).some((e) => e.def.id === def.id);
    const tipLines: string[] = [];
    if (this.isDegenerate(item, index)) tipLines.push(t('refine.chain.noBand'));
    if (isOffSlot) tipLines.push(t('refine.offSlotWarn'));
    if (tipLines.length > 0) {
      row.eventMode = 'static';
      row.cursor = 'help';
      row.on('pointerover', (e) =>
        this.showTipLines(this.affixText(item, index), item, tipLines, e.global.x, e.global.y),
      );
      row.on('pointermove', (e) => this.moveTip(e.global.x, e.global.y));
      row.on('pointerout', () => this.tooltip.hide());
    }

    return row;
  }

  /**
   * 용해 위험 트로프 — 파인 홈 안에 `고착 n/총` + 게이지 + `용해 위험 n%`.
   *
   * 위험이 0 이면 게이지 자체를 그리지 않는다 — **위험이 없다는 사실이 시각적으로도 없어야**
   * 한다(구 구현의 규칙 유지). 위험 수치는 비용 줄에서 뺐다: 두 곳에서 같은 수치를 말하면
   * 하나는 노이즈다.
   */
  private renderTrough(host: Container, item: Item | undefined, L: RefineryDetailLayout): void {
    const x = BOX_D.x;
    const w = BOX_D.w;
    const h = L.troughH;
    const y = L.troughY;
    const risk = this.currentRisk();

    // 노 챔버와 **같은 파인 면**이다 — 둘이 한 설비(노)로 읽혀야 한다.
    host.addChild(recessedWell(x, y, w, h));

    // 장비가 없으면 고착 수를 말할 대상이 없다 — `0/0` 은 정보가 아니라 거짓말이라 비운다.
    if (item === undefined) {
      const idle = new Text({
        resolution: 2,
        text: t('refine.chain.riskNone'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 19,
          fontWeight: '800',
          fill: COLOR.muted,
          dropShadow: TEXT_SHADOW,
        },
      });
      idle.anchor.set(1, 0.5);
      idle.position.set(x + w - 22, y + h / 2);
      host.addChild(idle);
      return;
    }

    const fastened = new Text({
      resolution: 2,
      // 분모는 rerollableCount() — `n / count` 로 두면 스킬 어픽스가 낀 장비에서 영영 안
      // 차는 막대를 보게 된다(설계서 §3).
      text: t('refine.fastenCounter', {
        n: this.fastenedCount(),
        d: rerollableCount(item),
      }),
      style: {
        fontFamily: UI_FONT,
        fontSize: 19,
        fontWeight: '800',
        fill: COLOR.cream,
        dropShadow: TEXT_SHADOW,
      },
    });
    fastened.anchor.set(0, 0.5);
    fastened.position.set(x + 22, y + h / 2);
    host.addChild(fastened);

    const riskText = new Text({
      resolution: 2,
      text: risk > 0 ? t('refine.chain.risk', { n: Math.round(risk * 100) }) : t('refine.chain.riskNone'),
      style: {
        fontFamily: UI_FONT,
        fontSize: 19,
        fontWeight: '800',
        fill: risk > 0 ? 0xff9a5a : COLOR.muted,
        dropShadow: TEXT_SHADOW,
      },
    });
    riskText.anchor.set(1, 0.5);
    riskText.position.set(x + w - 22, y + h / 2);
    host.addChild(riskText);

    // 게이지는 두 글자 덩어리 **사이**에만 놓는다 — 글자 위로 지나가면 둘 다 못 읽는다.
    const barX = x + 22 + 190;
    const barRight = x + w - 22 - 200;
    const barW = barRight - barX;
    if (risk <= 0 || barW < 80) return;
    const barH = 14;
    const barY = y + Math.round((h - barH) / 2);

    const track = new Graphics();
    track.roundRect(barX, barY, barW, barH, barH / 2).fill({ color: 0x000000, alpha: 0.55 });
    host.addChild(track);

    // 위험이 오를수록 차가운 금 → 뜨거운 주홍. 채널별 선형 보간(색 하나를 더 굽지 않는다).
    const mix = (a: number, b: number, k: number): number => {
      const q = (sh: number): number =>
        Math.round(((a >> sh) & 0xff) + (((b >> sh) & 0xff) - ((a >> sh) & 0xff)) * k) & 0xff;
      return (q(16) << 16) | (q(8) << 8) | q(0);
    };
    const fillW = Math.max(barH, Math.round(barW * Math.min(1, risk)));
    const fill = new Graphics();
    fill.roundRect(barX, barY, fillW, barH, barH / 2).fill({ color: mix(RISK_COOL, RISK_HOT, risk) });
    host.addChild(fill);

    // 발광은 채움 **위에** 겹치는 별도 노드다 — 프레임마다 알파만 바뀌므로 채움을 다시 안 그린다.
    const glow = new Graphics();
    glow.roundRect(barX - 4, barY - 4, fillW + 8, barH + 8, (barH + 8) / 2).fill({ color: RISK_HOT });
    glow.alpha = 0.22 + 0.4 * risk;
    glow.eventMode = 'none';
    host.addChild(glow);
    this.riskGlow = glow;
  }

  /** 노 출력 3버튼(라디오). 선택 표시는 금색 링 — `PixiButton` 에는 토글 상태가 없다. */
  private renderHeatRow(host: Container, y: number): void {
    const rowW = HEATS.length * HEAT_W + (HEATS.length - 1) * HEAT_GAP;
    HEATS.forEach((heat, i) => {
      const isSel = this.heat === heat;
      const btn = this.chromeButton({
        tone: HEAT_TONE[heat],
        width: HEAT_W,
        height: HEAT_H,
        fontSize: 22,
        label: stripEmoji(t(`refine.chain.heat.${heat}` as MessageKey)),
        sound: 'uiNavigate',
        onClick: () => this.setHeat(heat),
      });
      const node = btn.container;
      node.position.set(BOX_D.x + i * (HEAT_W + HEAT_GAP), y);
      if (isSel) {
        const ring = new Graphics();
        ring
          .roundRect(2, 2, HEAT_W - 4, HEAT_H - 4, 9)
          .stroke({ color: COLOR.gold, width: 3, alignment: 1 });
        node.addChild(ring);
      } else {
        node.alpha = 0.72; // 미선택은 한 톤 낮춰 대비를 준다.
      }
      host.addChild(node);
      if (this.spinning) btn.setEnabled(false);
    });

    // 노 출력 설명은 버튼 오른쪽 남는 폭에 접어 넣는다(세로를 더 먹지 않는다).
    const hintX = BOX_D.x + rowW + 20;
    const hintW = BOX_D.right - hintX;
    if (hintW >= 120) {
      const hint = new Text({
        resolution: 2,
        text: t('refine.chain.heat.hint'),
        style: {
          fontFamily: UI_FONT,
          fontSize: 16,
          fill: SLAB_BODY_FILL,
          wordWrap: true,
          wordWrapWidth: hintW,
          lineHeight: 22,
          dropShadow: TEXT_SHADOW,
        },
      });
      hint.anchor.set(0, 0.5);
      hint.position.set(hintX, y + HEAT_H / 2);
      host.addChild(hint);
    }
  }

  /** 비용 한 줄. 위험은 트로프가 맡는다(같은 수치를 두 곳에서 말하지 않는다). */
  private renderCostRow(host: Container, y: number): void {
    const cost = new Text({
      resolution: 2,
      text: t('refine.chain.cost', { n: this.currentCost() }),
      style: {
        fontFamily: UI_FONT,
        fontSize: 21,
        fontWeight: '700',
        fill: COLOR.gold,
        dropShadow: TEXT_SHADOW,
      },
    });
    cost.anchor.set(0, 0.5);
    cost.position.set(BOX_D.x, y + COST_H / 2);
    host.addChild(cost);
  }

  /** 굴리기 + 공정 멈추기를 **같은 행에** 좌우로. 멈추기는 고착 ≥ 1 일 때만. */
  private renderActionRow(host: Container, y: number, hasItem: boolean): void {
    const showStop = hasItem && this.fastenedCount() >= 1;
    const totalW = showStop ? ROLL_W + ACTION_GAP + STOP_W : ROLL_W;
    const x0 = BOX_D.x + Math.max(0, Math.floor((BOX_D.w - totalW) / 2));

    // 열기 후광은 버튼 **뒤**에 먼저 그린다(위험이 오를수록 짙어진다).
    const risk = this.currentRisk();
    if (risk > 0) {
      const halo = new Graphics();
      halo.roundRect(x0 - 14, y - 14, ROLL_W + 28, ROLL_H + 28, 18).fill({ color: 0xff6a2a });
      halo.alpha = 0.18 + 0.42 * risk;
      halo.eventMode = 'none';
      host.addChild(halo);
      this.heatHalo = halo;
    }

    const chain = this.chain;
    const complete = chain !== null && isComplete(chain);
    const roll = this.chromeButton({
      tone: 'gold',
      width: ROLL_W,
      height: ROLL_H,
      fontSize: 25,
      label: stripEmoji(this.spinning ? t('refine.spinning') : t('refine.chain.rollBtn')),
      sound: 'uiConfirm',
      onClick: () => void this.reroll(),
    });
    roll.container.position.set(x0, y);
    host.addChild(roll.container);
    this.rollNode = roll.container;
    this.rollBase = { x: x0, y };
    // 완주 후 굴림은 순수 손해라 막는다(상태기계도 막는다 — 이중 방어이지 둘 중 하나가 아니다).
    // ⚠️ `!hasItem` 을 빼면 안 된다: 장비가 없으면 비용이 0 이라 `canAfford` 가 **참**이 되어
    //    아무것도 안 고른 채로 굴리기가 활성으로 보인다(눌러도 `reroll()` 이 즉시 반환하지만,
    //    "눌러도 되는 것처럼 보이는 버튼"은 그 자체가 결함이다).
    if (!hasItem || this.spinning || complete || !canAfford(this.profile.minerals, this.currentCost())) {
      roll.setEnabled(false);
    }

    if (!showStop) return;
    const stop = this.chromeButton({
      tone: 'stone',
      width: STOP_W,
      height: ROLL_H,
      fontSize: 22,
      label: stripEmoji(t('refine.chain.stop')),
      sound: 'uiPositive',
      onClick: () => this.stopRefining(),
    });
    stop.container.position.set(x0 + ROLL_W + ACTION_GAP, y);
    host.addChild(stop.container);
    if (this.spinning) stop.setEnabled(false);
  }
}
