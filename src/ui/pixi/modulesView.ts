/**
 * 코어 모듈 화면 — 슬롯 2 · 보관함 · 일일 상점 (M7b-core-modules, ADR-0018)
 * · 2026-08-03 AAA 시네마틱 전환(레인 계약 `.omc/plans/core-modules-aaa-2026-08-03.md`).
 *
 * ## 무엇이 바뀌었나 (구 카드 화면 대비)
 * 구 `src/ui/pixi/cardsView.ts`(M6 방어 카드)는 **슬롯 1개**에 카드 한 장을 꽂는 화면이었다.
 * 3레이어 개편에서 방어 카드는 폐지되고 **L3 코어의 강화 슬롯 2개에 꽂는 소모성 코어 모듈**
 * 이 됐다(ADR-0018). 그래서 이 화면은:
 *   - 슬롯을 **2칸 목록**으로 그리고(슬롯 i ↔ 표시 i, 밀집화 금지),
 *   - 장착은 "슬롯을 고른 뒤 보관함에서 장착"이라는 2단 조작이며(빈 슬롯 자동 선택 폴백),
 *   - 남은 사용 횟수를 슬롯·보관함·상점 세 곳에서 모두 드러낸다(소모품이라는 사실이 화면에서
 *     사라지면 사용자가 "왜 모듈이 없어졌냐"고 묻게 된다).
 *
 * ## 진입·복귀 — **한 줄도 건드리지 않는다**
 * 방어 사령부(`defenseCommand.ts`) L3 코어 블록의 `[모듈 관리]` 에서 진입하며, 사령부는
 * `suspend()` 로 자기 화면만 감췄다가 이 화면이 닫힐 때 `resume()` 한다 — `show()` 로 되돌리면
 * **미저장 배치 편집이 날아간다**(실측 규율). 하네스 직행(`__pb.openModules()`)은 사령부를
 * 거치지 않으므로 배치 편집과 무관하다.
 *
 * ## 서버 권위
 * 구매·합성은 `modules` Edge Function, 분해는 `salvage_core_module` RPC, 장착은 defenses
 * update(소유권 트리거)가 최종 판정한다. 이 화면은 거부 코드를 문구로 옮기고(4xx 사유 매핑
 * 보존) 성공 후 서버 크레딧을 프로필에 pull 한다. 순수 render/UI 레이어(ADR-0005) — sim 은
 * 이 파일을 모른다.
 *
 * ---------------------------------------------------------------------------
 * ## 시네마틱 전환에서 바뀐 것은 **바탕과 배치**뿐이다
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재), `makeBanner` → `makeHangarTitle`,
 * `makeCurrencyChip` → `makeHangarChip`, `ui_btn_*.png` → `cinematicButtonTexture` 주입,
 * `makeModal`(나무) → 이 파일의 시네마틱 팝업, 나무 행 바탕(`listRowBg`) → 석재 행 판
 * (`rowPlate`), 단색 배경 → `HangarBackdrop`. 서버 왕복·판정 함수·장착 규칙은 그대로다.
 *
 * ## 왜 여기는 **창을 안 뚫는가**(방어 사령부·챔피언 선택은 뚫었다)
 * 형제 화면 여섯의 결론은 "창은 배경이 보이는 구멍이 아니라 **무언가를 보여주는 자리**"였다.
 * 뚫은 둘은 피사체가 있었다 — 챔피언 선택은 전용 함선 원화, 방어 사령부는
 * `createWorld(invasion3)` 실제 정지 렌더. 코어 모듈은 **아이콘도 3D 도 없는 순수 수치
 * 인스턴스**(등급·잔여 횟수·어픽스 문자열)라 창을 뚫으면 배경만 보이는 구멍이 된다.
 * → 패널 셋 전부 `variant: 'slab'`, 배경 `windows: []`.
 *
 * ## **정보 밀도가 목적인 화면이다** → 3열을 유지하고 탭을 두지 않는다
 * 이 화면의 기본 동작은 세 목록을 오가며 비교하는 것이다: 슬롯(어디에 꽂나) ↔ 보관함(무엇을
 * 꽂나) ↔ 상점(무엇을 더 사나). 보관 게이지 20칸이 그 셋을 동시에 제약한다(만석이면 구매·합성
 * 결과가 막힌다). 한 열이라도 접으면 조작이 왕복이 된다. 전환할 축이 없으므로 탭 줄 자체가
 * 이 화면에서는 빈 자리다.
 *
 * ## 게이지·합성 바를 보관함 패널에서 **하단 액션 띠로 내렸다**
 * 옛 구현은 게이지(라벨+미터)와 합성 바(버튼 2개)를 보관함 콘텐츠 상자 **맨 위**에 얹어 목록
 * 시작 y 를 118 → 약 230 으로 밀었다. 둘 다 보관함 한 열의 성질이 아니라 **화면 전역 제약**이다
 * — 만석이면 상점 [구매]도 막히고, 합성 결과는 게이지와 슬롯 양쪽을 움직인다. 내려 보내면
 * ⓐ보관함 목록이 상자 세로를 전부 쓰고 ⓑ하단 띠에 빈 자리가 없어진다.
 * ⚠️ 하단 버튼 자리는 **모드와 무관하게 고정 폭**이다(비합성 = 안내 문구 + [합성 시작],
 * 합성 중 = [취소] + [합성 확정]). 모드마다 폭이 달라지면 오른쪽 끝 등호가 깨지고 버튼이
 * 화면에서 좌우로 튄다.
 *
 * ## 하단 [방어 사령부로] 버튼은 **없앴다**
 * 헤더 ✕ 와 같은 일(close)을 두 번 하고 있었다. 형제 화면 여섯은 전부 헤더 ✕ 하나만 쓴다.
 * 사문화된 문구 키 `mod.back` 은 **카탈로그에 남긴다**(지우면 무관한 i18n 단언이 흔들린다).
 *
 * ## 분해에 **확인 팝업**을 붙였다
 * 분해는 되돌릴 수 없이 모듈을 없애고 크레딧으로 바꾼다. 옛 구현은 행의 [분해] 한 번으로 즉시
 * 실행됐고 그 버튼은 [장착] **바로 옆** 108px 이었다. 이 화면에서 유일하게 퇴로가 없는 조작이라
 * 확인을 한 겹 둔다(방어 사령부 `confirmTest` 선례 · 확정 톤 `red`).
 *
 * ## 빈 자리를 남기지 않는다
 * 슬롯 열은 **원리적으로 2행뿐**이고(`MODULE_EQUIP_SLOTS = 2`) 상점은 4~6칸이라, 둘 다 세로가
 * 남는다. 남는 세로를 행이 나눠 갖고({@link fillRowHeights}, 상한까지) 그래도 남으면 그 자리를
 * **파낸 챔버**로 그리고 이름을 준다 — "빈 패널 면"이 아니라 "아직 안 찬 자리"가 된다.
 * 로딩·오프라인·조회 실패·빈 보관함도 같은 처방으로 챔버가 된다(정제소 §6-bis-2).
 *
 * ## 행 사이에 **선을 긋지 않는다**
 * 세로 리브·가로 이음선·각인 번호판은 사용자가 격납고에서 삭제를 지시한 것들이다(2026-08-02).
 * 행 구분은 선이 아니라 **면의 밝기 차 + 2단 접지 그림자 + 행 간격**이 만든다. 등급은 제목
 * 글자색이, 선택은 금색 링이 말한다(둘 다 면 위의 "부품"이 아니다).
 *
 * ## 재렌더 규율
 * 옛 구현은 `render()` 가 루트를 통째로 지우고 다시 그렸다 — 슬롯 클릭 한 번, 합성 토글 한 번마다
 * 배경과 석재 패널 3장이 다시 **구워진다**. 그래서
 *  - `buildChrome()` 은 1회(자산 도착 시에만 재건),
 *  - `syncValues()` 가 재화 칩·보관 게이지·상태 문구·하단 버튼을,
 *  - `renderSlots()`/`renderInventory()`/`renderShop()`/`renderModal()` 이 각자 host 안만
 *    갈아끼운다.
 *  - `update(dt)` 는 `main.ts` 가 매 프레임 부른다(`modulesScreen.update(frame)`). 숨겨져
 *    있으면 즉시 반환하므로 이 화면 밖 비용은 0 이다. ⚠️ 연구소가 이 배선을 빠뜨려 배경·패널
 *    연출이 통째로 멈춘 적이 있다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거)
 * - ⚠️ **크롬(헤더·하단 띠)은 패널보다 뒤에 붙여 위로 올린다.** Pixi v8 은 자식을 역순으로
 *   훑다가 픽셀에 걸리면 거기서 멈추고 가장 가까운 상호작용 조상을 반환한다 — 석재 패널이
 *   접지 그림자를 텍스처에 구워 자기 사각보다 30px 가까이 번지므로 **비상호작용 그림자도 클릭을
 *   훔친다**(방어 사령부에서 "탭 아래 절반이 클릭 안 됨"으로 실제 신고됐다). 여백을 벌리는
 *   것으로는 못 푼다 — 번짐 폭이 패널 치수에서 파생돼 조용히 커진다.
 * - ⚠️ **`PixiButton` 의 `pointerout` 이 `container.alpha` 를 1 로 되돌린다.** 흐림(0.72)은
 *   감싸는 host 에 건다.
 * - **행 클릭은 행 Container 에.** 바탕 Graphics 에 걸면 위에 얹힌 텍스트가 클릭을 삼킨다.
 * - **휠은 클립 Container 에.** 마스크 Graphics 는 히트 테스트에서 제외된다.
 * - 컬러 이모지 금지(`text.ts` stripEmoji 가 두부로 떨군다). `★ ✕ ▶ ◀` 는 보존 목록이다.
 * - ⚠️ `hudEl()` 에는 **캔버스 가드를 붙이지 않는다**(`typeof document.createElement !==
 *   'function'` 까지 검사하면 HUD 숨김이 통째로 죽는다 — 이 리포가 실제로 밟았다).
 * - ⚠️ 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드**다. 헤더 좌측을 비워 두고, 패널 상단도
 *   그 아래에서 시작한다(슬롯 패널이 x32 라 톱니와 가로로 겹친다).
 * - ⚠️ 각인 제목은 중앙 정렬 Text 라 사각형이 없어 겹침 테스트가 못 잡는다 —
 *   {@link TITLE_BAND_HALF_W} 로 대역을 못 박는다(연구소에서 제목이 실제로 겹쳤다).
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { saveProfile, type KeyValueStore, type Profile } from '../../save/profile.js';
import { refreshPendingProfile } from '../../net/profileSync.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW, hexColor } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { PixiButton } from './button.js';
import { stripEmoji } from './text.js';
import { makeScrollArea, rowBounds, clampToRows } from './scrollArea.js';
import { attachRowClick, stopRowPropagation } from './listRow.js';
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
import {
  getModulesUserId,
  listModuleInventory,
  fetchModuleEquip,
  equipModules,
  salvageModule as netSalvageModule,
  buyShopModule as netBuyShopModule,
  fuseModules as netFuseModules,
  listModuleShopPurchases,
  rollCurrentModuleShop,
  computeShopSeeds,
  type ModuleOwned,
  type ModuleEquipState,
} from '../../net/modules.js';
import {
  MODULE_FUSION_INPUT_COUNT,
  MODULE_EQUIP_SLOTS,
  type ModuleInstance,
} from '../../../data/coreModules.js';
import {
  moduleRarityColor,
  moduleRarityLabel,
  moduleEffectLines,
  isLowCharge,
  storageGauge,
  checkFusionSelection,
  fusionCheckText,
  buyErrorText,
  shopSlotPrice,
  pickEquipSlot,
} from '../modulesView.js';

// ---------------------------------------------------------------------------
// 로드 상태 판정 (순수) — **조회 실패를 "비어 있음"으로 말하지 않는다**
// ---------------------------------------------------------------------------
//
// 실측 결함: uid 획득만 성공하면 `online = true` 를 세운 뒤 보관함 조회가 실패해도 `inv ?? []`
// 로 빈 배열과 동일하게 취급했다. 그래서 서버 오류인데 화면은 "보관함이 비어 있습니다"·"방어
// 미배치"라고 단정했고, 사용자는 **자기 모듈이 사라진 줄 안다**. 없다고 말하는 것과 모른다고
// 말하는 것은 다르다. 판정을 순수 함수로 빼 두어 캔버스 없이 검증한다.

/** 보관함 패널이 보여야 할 상태. */
export type InventoryPanelKind = 'failed' | 'empty' | 'list';

/**
 * 보관함 패널 상태. 조회에 실패해도 **직전에 받아 둔 목록이 있으면 그것을 계속 보여 준다**
 * (있던 것을 지워 놓고 오류를 띄우면 그게 더 무섭다). 목록이 없을 때만 실패를 말한다.
 */
export function inventoryPanelKind(s: { count: number; failed: boolean }): InventoryPanelKind {
  if (s.count > 0) return 'list';
  return s.failed ? 'failed' : 'empty';
}

/** 슬롯 패널이 보여야 할 상태. */
export type SlotPanelKind = 'failed' | 'noBase' | 'slots';

/**
 * 슬롯 패널 상태. 장착 상태 조회가 실패한 것(`equip === null` + failed)과 방어를 아직 안 짠 것
 * (`defenseId === null`)은 사용자가 해야 할 일이 정반대다 — 전자는 기다리기, 후자는 배치 저장하기.
 */
export function slotPanelKind(s: { equip: ModuleEquipState | null; failed: boolean }): SlotPanelKind {
  if (s.equip === null) return s.failed ? 'failed' : 'noBase';
  return s.equip.defenseId === null ? 'noBase' : 'slots';
}

/**
 * 상태 → 안내 문구 키(목록을 그리는 상태면 null). 세 상태가 **서로 다른 키**로 갈리는 것이
 * 이 함수의 계약이다.
 *
 * 실패는 `mod.load.failed`(조회 실패 전용)를 쓴다. 서버 연결 안내(`mod.slot.offline`)를 빌려
 * 쓰면 "연결이 없다"와 "물어봤는데 답을 못 받았다"가 한 문구로 뭉개져, 온라인인데 조회만 실패한
 * 사용자가 자기 연결을 의심하게 된다. 실패 안내에는 재시도 버튼이 함께 붙는다.
 */
export function panelMessageKey(kind: InventoryPanelKind | SlotPanelKind): MessageKey | null {
  switch (kind) {
    case 'failed':
      return 'mod.load.failed';
    case 'empty':
      return 'mod.inv.empty';
    case 'noBase':
      return 'mod.slot.noBase';
    default:
      return null;
  }
}

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
 * `tests/coreModulesAaaLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조한다.
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

/**
 * 패널 상단. 헤더 밴드(104) 바로 아래가 아니라 **{@link GEAR_BAND_H}(120) 아래**다 —
 * 슬롯 패널이 화면 좌측 끝(x 32)에서 시작하므로 설정 톱니 예약 밴드와 가로로 겹치고, 세로로
 * 조금만 물려도 톱니가 매 프레임 맨 앞으로 올라와 그 자리를 통째로 삼킨다(테스트가 잠근다).
 */
const PANEL_Y = GEAR_BAND_H + 4;

/** 하단 액션 띠 — 오른쪽에 합성 컨트롤, 왼쪽은 보관 게이지·상태 문구가 쓴다(빈 자리 0). */
const FOOT_H = 64;
const FOOT_Y = DESIGN_HEIGHT - BOTTOM_PAD - FOOT_H;
const FOOT_GAP = 16;
/** 오른쪽 끝: 비합성 `[합성 시작]` · 합성 중 `[합성 확정 (n/3)]`. */
const FUSE_MAIN_W = 300;
/** 그 왼쪽: 비합성 = 합성 안내 문구 · 합성 중 = `[취소]`. **폭은 모드와 무관하게 고정**이다. */
const FUSE_SIDE_W = 200;
const FOOT_BTN_W = FUSE_MAIN_W + FUSE_SIDE_W + FOOT_GAP;
const FOOT_BTN_X = EDGE_X + CONTENT_W - FOOT_BTN_W;

/** 패널 세로는 **남는 자리 전부**다(빈 자리 금지 — 하드코딩하면 여백을 바꿀 때 어긋난다). */
const PANEL_TO_FOOT = 16;
const PANEL_H = FOOT_Y - PANEL_TO_FOOT - PANEL_Y;

/** 열 폭 — 슬롯(2칸뿐이라 좁게) · 보관함(행에 버튼 둘이라 가장 넓게) · 상점(버튼이 문구 아래). */
const SLOT_X = EDGE_X;
const SLOT_W = 460;
const INV_X = SLOT_X + SLOT_W + GUTTER_X;
const INV_W = 800;
const SHOP_X = INV_X + INV_W + GUTTER_X;
const SHOP_W = DESIGN_WIDTH - EDGE_X - SHOP_X;

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

const BOX_SLOT = titledBox(SLOT_W, PANEL_H);
const BOX_INV = titledBox(INV_W, PANEL_H);
const BOX_SHOP = titledBox(SHOP_W, PANEL_H);

/** 행 공통. */
const ROW_GAP = 10;
const ROW_PAD = 16;
const ROW_BTN_W = 116;
const ROW_BTN_H = 40;

/**
 * 행 높이 상한 — 목록이 짧을 때 **행을 늘려 영역을 채우되** 여기서 멈춘다.
 *
 * ## 왜 (형제 화면 여섯의 공통 처방)
 * 슬롯은 `MODULE_EQUIP_SLOTS = 2` 라 **원리적으로 2행뿐**이고 상점 재고는 4~6칸이다. 행 수로는
 * 세로를 못 채운다. → ①남는 세로를 행에 **고르게 나눠 준다**(상한까지) ②그래도 남으면 그 자리를
 * **파낸 챔버**로 그리고 이름을 준다. 상한이 없으면 2행짜리에서 378px 짜리 행이 나온다.
 */
const SLOT_ROW_MAX_H = 240;
const INV_ROW_MAX_H = 132;
const SHOP_ROW_MAX_H = 168;
/** 꼬리 챔버를 그릴 최소 잔여(이보다 작으면 그냥 여백이다). */
const TAIL_WELL_MIN_H = 72;

/**
 * 남는 세로를 행에 **고르게 나눈** 새 높이 배열(순수 함수 — Pixi 미의존).
 *
 * 넘치면(스크롤이 붙으면) 입력 그대로 돌려준다. 나눠 준 뒤에도 상한 때문에 남을 수 있고,
 * 그 잔여는 호출부가 꼬리 챔버로 받는다. 반올림 잔여는 **행 수 미만**이다.
 * (방어 사령부 `fillRowHeights` 복제 — 그 파일은 공용 모듈이 아니라 화면이다.)
 *
 * ⚠️ **상한은 늘리기만 막는다. 자연 높이를 깎지 않는다.**
 * `Math.min(maxH, h + add)` 만 쓰면 자연 높이가 상한보다 큰 행이 **줄어들어** 내용이 판 밖으로
 * 삐져나온다 — 효과를 수치로 적기 시작하자 슬롯 행이 상한(240)을 넘겼고 `[해제]` 버튼이 판
 * 아래로 반쯤 튀어나온 채로 찍혔다(실화면 2차 확인). 목록이 짧을 때만 나타나므로(길면 위
 * `total >= avail` 에서 그대로 반환된다) 눈으로만 잡히는 유형이다.
 * ⚠️ 같은 산술이 `defenseCommand.ts` 에도 복제돼 있다 — 거기는 아직 자연 높이가 상한 아래라
 * 증상이 없지만 같은 함정을 안고 있다(후속 칩).
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

// --- 헤더 컨트롤(정제소·방어 사령부와 **같은 x**) ---
const HEAD_GAP = 12;
const CHIP_W = 190;
const CLOSE_W = 56;
const CLOSE_X = DESIGN_WIDTH - EDGE_X - CLOSE_W;
/**
 * 크레딧 칩. **광물 칩은 두지 않는다** — 이 화면의 재화는 크레딧뿐이다(구매·분해). 헤더 밴드는
 * 배경이 그대로 보이는 띠라 칩이 하나여도 빈 자리가 아니다.
 */
const CREDIT_CHIP_X = CLOSE_X - HEAD_GAP - 2 - CHIP_W;

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
/**
 * 모듈이 하는 일을 **한 줄에 하나씩, 전부 수치로** 적은 블록(사용자 지시 2026-08-03).
 *
 * 그때까지 이 화면은 `소화의 +12` 처럼 표기명 + 롤 값만 보여 줬다 — 값은 있는데 그 값이
 * **무엇을 얼마나** 바꾸는지가 없었고, normal 모듈은 `기저 효과만` 한 마디로 끝났지만 실제로는
 * 화력 +3% · 코어 HP +3% 가 무조건 걸린다(있는 효과를 없다고 말하고 있었다).
 * 조립 규칙과 부호 규율은 `src/ui/modulesView.ts` 의 {@link moduleEffectLines} 주석이 정본이다.
 */
function effectText(mod: ModuleInstance): string {
  return moduleEffectLines(mod).join('\n');
}

/** 잔여 1회 경고·만석 경고에 쓰는 주황(구 구현 승계). */
const WARN_COLOR = 0xffb14c;
/** 장착 모듈 강조색(구 구현 승계 — 글자색으로만 쓴다). */
const EQUIPPED_COLOR = 0x8fd94c;
/** 보관 게이지 만석색. */
const GAUGE_FULL_COLOR = 0xff6a6a;

/** 보관 게이지 미터(하단 액션 띠 왼쪽). 상자 끝까지 늘리면 실처럼 길어져 눈금이 안 읽힌다. */
const GAUGE_W = 280;
const GAUGE_H = 14;

/**
 * 팝업 암막 알파. **뒤 화면 밝기에 따라 다르다** — 예비역 로스터 0.92 · 챔피언 선택 0.96 ·
 * 연구소 0.98 · 방어 사령부 0.99. 여기는 밝은 슬래브가 **셋**이라 화면을 거의 다 덮는다.
 * 실측으로 정한 값이니 눈대중으로 낮추지 마라.
 */
const SCRIM_ALPHA = 0.99;

/** 화면 좌표 사각형(디자인 스페이스). */
export interface ModulesRect {
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
export function coreModulesLayout(): {
  readonly screen: ModulesRect;
  readonly headerH: number;
  readonly panels: readonly { readonly id: string; readonly rect: ModulesRect }[];
  readonly footer: { readonly band: ModulesRect; readonly slots: readonly ModulesRect[] };
  readonly headerControls: readonly { readonly id: string; readonly rect: ModulesRect }[];
  /** 배경이 보존되는 창 — **없다**(파일 헤더 "왜 여기는 창을 안 뚫는가"). */
  readonly windows: readonly ModulesRect[];
} {
  const head = (x: number, w: number): ModulesRect => ({ x, y: HEAD_Y, w, h: HEAD_H });
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    panels: [
      { id: 'slots', rect: { x: SLOT_X, y: PANEL_Y, w: SLOT_W, h: PANEL_H } },
      { id: 'inventory', rect: { x: INV_X, y: PANEL_Y, w: INV_W, h: PANEL_H } },
      { id: 'shop', rect: { x: SHOP_X, y: PANEL_Y, w: SHOP_W, h: PANEL_H } },
    ],
    footer: {
      band: { x: EDGE_X, y: FOOT_Y, w: CONTENT_W, h: FOOT_H },
      slots: [
        { x: FOOT_BTN_X, y: FOOT_Y, w: FUSE_SIDE_W, h: FOOT_H },
        { x: FOOT_BTN_X + FUSE_SIDE_W + FOOT_GAP, y: FOOT_Y, w: FUSE_MAIN_W, h: FOOT_H },
      ],
    },
    headerControls: [
      { id: 'credits', rect: head(CREDIT_CHIP_X, CHIP_W) },
      { id: 'close', rect: head(CLOSE_X, CLOSE_W) },
    ],
    windows: [],
  };
}

/** 패널 콘텐츠 상자와 행 기하(단위 테스트가 실제 패널 상자와 대조한다). */
export const MODULES_BOXES = {
  slots: { x: BOX_SLOT.x, y: BOX_SLOT.y, w: BOX_SLOT.w, h: BOX_SLOT.h, bottom: BOX_SLOT.bottom },
  inventory: { x: BOX_INV.x, y: BOX_INV.y, w: BOX_INV.w, h: BOX_INV.h, bottom: BOX_INV.bottom },
  shop: { x: BOX_SHOP.x, y: BOX_SHOP.y, w: BOX_SHOP.w, h: BOX_SHOP.h, bottom: BOX_SHOP.bottom },
  /** 행 글자 폭 — 하한이 있어야 이름·어픽스가 가로 축소로 뭉개지지 않는다. */
  slotRowTextW: BOX_SLOT.w - ROW_BTN_W - ROW_PAD * 2 - 12,
  invRowTextW: BOX_INV.w - ROW_BTN_W * 2 - 8 - ROW_PAD * 2 - 12,
  shopRowTextW: BOX_SHOP.w - ROW_PAD * 2,
  /** 행 높이 상한과 꼬리 챔버 하한(빈 자리 금지 처방 — {@link fillRowHeights} 주석이 근거). */
  rowGap: ROW_GAP,
  slotRowMaxH: SLOT_ROW_MAX_H,
  invRowMaxH: INV_ROW_MAX_H,
  shopRowMaxH: SHOP_ROW_MAX_H,
  tailWellMinH: TAIL_WELL_MIN_H,
} as const;

/**
 * 분해 확인 팝업의 기하. 높이를 **내용에서 역산**해 버려지는 세로가 0 이다.
 *
 * `68 = TITLE_BAND_H(52) + CONTENT_GAP(16)` · `24 = EDGE_PAD` — 제목 띠가 있는 시네마틱
 * 패널의 콘텐츠 상자 기하다. `makeModal`(나무)은 고치지 않는다(다른 화면 다섯이 쓴다).
 */
const CONFIRM_HEAD_H = 30;
const CONFIRM_HEAD_GAP = 8;
/** 효과 한 줄이 쓰는 세로. 줄은 **줄바꿈 없이** 가로 축소로 맞춘다 — 그래야 줄 수가 정확하다. */
const CONFIRM_LINE_H = 22;
const CONFIRM_LINES_GAP = 14;
const CONFIRM_BODY_H = 26;
const CONFIRM_BODY_GAP = 16;
const CONFIRM_BTN_H = 56;
const CONFIRM_LINES_MIN = 1;
const CONFIRM_LINES_MAX = 8;

/**
 * 분해 확인 팝업의 세로 뭉치 — **효과 줄 수에서 역산**한다(버려지는 세로 0).
 *
 * ⚠️ 처음에는 본문 높이를 상수 96 으로 박았는데, 효과를 수치로 적기 시작하자 등급이 높은 모듈의
 * 효과 블록이 5줄이 되어 **경고 문장과 버튼을 뚫고 겹쳤다**(실화면 2차 확인). 팝업이 담는 것이
 * 가변 길이면 높이도 그 길이에서 나와야 한다 — 방어 사령부 `pickModalHeight` 와 같은 처방이다.
 */
export function salvageModalBlockH(lineCount: number): number {
  const n = Math.max(CONFIRM_LINES_MIN, Math.min(CONFIRM_LINES_MAX, Math.trunc(lineCount)));
  return (
    CONFIRM_HEAD_H +
    CONFIRM_HEAD_GAP +
    n * CONFIRM_LINE_H +
    CONFIRM_LINES_GAP +
    CONFIRM_BODY_H +
    CONFIRM_BODY_GAP +
    CONFIRM_BTN_H
  );
}

/** 분해 확인 팝업 높이 — 효과 줄 수에서 역산. */
export function salvageModalHeight(lineCount: number): number {
  return TITLED_BOX_Y + salvageModalBlockH(lineCount) + PANEL_EDGE_PAD;
}

export const MODULES_MODAL = {
  w: 760,
  headH: CONFIRM_HEAD_H,
  lineH: CONFIRM_LINE_H,
  bodyH: CONFIRM_BODY_H,
  btnH: CONFIRM_BTN_H,
  linesMin: CONFIRM_LINES_MIN,
  linesMax: CONFIRM_LINES_MAX,
  /** 콘텐츠 상자 기하 — 테스트가 역산식을 되짚는다. */
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
 * (예비역 로스터 `rowRamp` → 챔피언 선택 → 연구소 → 정제소 → 방어 사령부 경유 복제. 형제 화면이라
 * 같은 값이어야 하고, 그 파일들은 공용 모듈이 아니라 화면이라 import 하지 않는다.)
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
 * 사용자가 격납고에서 삭제를 지시한 것들이다). 등급은 제목 글자색이, 선택은 금색 링이 말한다.
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

  if (selected) {
    const ring = new Graphics();
    ring
      .roundRect(0, 0, w, h, ROW_RADIUS)
      .stroke({ color: COLOR.gold, width: 3, alignment: 1, alpha: 0.95 });
    root.addChild(ring);
  }
  return root;
}

/**
 * **파낸 면** 한 장(빈 보관 챔버 · 꼬리 챔버가 공유한다). 볼록한 {@link rowPlate} 와 조명
 * 부호가 정확히 반대다: 위가 그늘이고 **아래 입술만** 빛을 받는다. 이 부호가 뒤집히면 파인
 * 자리가 아니라 얹어 놓은 판때기로 읽힌다.
 * (정제소 `recessedWell` → 방어 사령부 경유 복제 — 그 파일들은 공용 모듈이 아니라 화면이다.)
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

// ===========================================================================
// 화면
// ===========================================================================

export class ModulesScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private art: HangarTextures = {};
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private onClose: (() => void) | null = null;

  // 서버 권위 상태. null/false = 미로딩·미설정(안내 상태).
  private uid: string | null = null;
  private online = false;
  private loading = true;
  private loadToken = 0;
  private inventory: ModuleOwned[] = [];
  private equip: ModuleEquipState | null = null;
  /** 직전 보관함/장착 조회가 실패했는가(= 비어 있음과 구분해야 하는 상태). */
  private invFailed = false;
  private equipFailed = false;
  private shop: ModuleInstance[] = [];
  private purchases: number[] = [];

  /** 장착 대상 슬롯(사용자 선택). null 이면 첫 빈 슬롯이 대상이 된다. */
  private selectedSlot: number | null = null;
  /** 합성 선택 모드 여부 + 선택된 보관함 행 id 집합. */
  private fuseMode = false;
  private readonly fusePicks = new Set<string>();
  /** 분해 확인 팝업 대상(보관함 행 id). null 이면 팝업이 없다. */
  private salvageId: string | null = null;
  /** 하단 안내(성공/오류 토스트). */
  private msgText = '';
  /** 네트워크 요청 진행 중(중복 클릭 방지). */
  private busy = false;

  /** 진입 시점의 런 HUD `visibility` 인라인 값(닫을 때 그대로 되돌린다). */
  private hudPrevVisibility: string | null = null;

  // 목록 스크롤 위치(재렌더 사이 유지).
  private invScrollY = 0;
  private shopScrollY = 0;

  // --- 유지되는 크롬(파일 헤더 "재렌더 규율") ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  private chromeBuilt = false;
  private slotsPanel: CinematicPanel | null = null;
  private invPanel: CinematicPanel | null = null;
  private shopPanel: CinematicPanel | null = null;
  private slotsHost: Container | null = null;
  private invHost: Container | null = null;
  private shopHost: Container | null = null;
  private chipHost: Container | null = null;
  private footHost: Container | null = null;
  private modalHost: Container | null = null;
  private modalPanel: CinematicPanel | null = null;

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    // 텍스처는 나중에 도착한다 — 도착하면 크롬을 통째로 다시 세운다(구운 텍스처가 바뀌므로
    // 갱신으로는 안 된다).
    // ⚠ 리스너를 이 콜백 안에서 새로 달면 재렌더 때마다 중복 등록돼 클릭이 두 번 돈다(실측).
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
   * 즉시 반환하므로 이 화면 밖 비용은 0 이다.
   * ⚠️ 연구소가 이 배선을 빠뜨려 배경·패널 연출이 통째로 멈춘 적이 있다.
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
    this.uid = null;
    this.online = false;
    this.loading = true;
    this.inventory = [];
    this.equip = null;
    this.invFailed = false;
    this.equipFailed = false;
    this.shop = [];
    this.purchases = [];
    this.selectedSlot = null;
    this.fuseMode = false;
    this.fusePicks.clear();
    this.salvageId = null;
    this.msgText = '';
    this.busy = false;
    this.invScrollY = 0;
    this.shopScrollY = 0;
    this.root.visible = true;
    this.buildChrome();
    // 방어 프리뷰(정지 월드)는 방어 사령부 진입 때 stage 에 붙으므로 이 화면보다 뒤에 생성돼도
    // **위에** 그려진다 — 열 때마다 맨 앞으로 올려 아레나가 패널을 뚫고 보이지 않게 한다.
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
    this.hideRunHud();
    this.refresh();
    void this.load();
  }

  hide(): void {
    this.root.visible = false;
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

  // --- 로드 ------------------------------------------------------------------

  /** uid → 보관함·장착 상태·상점 재고·구매 이력. race 방지 토큰 사용. */
  private async load(): Promise<void> {
    const token = ++this.loadToken;
    this.loading = true;
    this.refresh();
    const uid = await getModulesUserId();
    if (token !== this.loadToken || !this.visible) return;
    if (uid === null) {
      this.online = false;
      this.loading = false;
      this.refresh();
      return;
    }
    this.uid = uid;
    this.online = true;
    const dateSeed = computeShopSeeds(uid).dateSeed;
    const [inv, equip, purchases] = await Promise.all([
      listModuleInventory(),
      fetchModuleEquip(),
      listModuleShopPurchases(dateSeed),
    ]);
    if (token !== this.loadToken || !this.visible) return;
    // 실패(null)를 빈 배열로 뭉개지 않는다 — 뭉개면 "보관함이 비어 있습니다"라고 거짓말하게 된다.
    this.invFailed = inv === null;
    this.equipFailed = equip === null;
    if (inv !== null) this.inventory = inv;
    this.equip = equip;
    this.purchases = purchases ?? [];
    // 상점 재고는 (dateSeed,userSeed) 순수 함수로 클라가 재현(서버 호출 없음 — 표시=구매 대상 일치).
    this.shop = rollCurrentModuleShop(uid);
    this.loading = false;
    this.refresh();
  }

  /** 보관함·장착·구매이력 재조회(상점 재고는 순수 재현이라 불변). */
  private async reload(): Promise<void> {
    const token = ++this.loadToken;
    const uid = this.uid;
    if (uid === null) {
      this.refresh();
      return;
    }
    const dateSeed = computeShopSeeds(uid).dateSeed;
    const [inv, equip, purchases] = await Promise.all([
      listModuleInventory(),
      fetchModuleEquip(),
      listModuleShopPurchases(dateSeed),
    ]);
    if (token !== this.loadToken || !this.visible) return;
    this.invFailed = inv === null;
    this.equipFailed = equip === null;
    if (inv !== null) this.inventory = inv;
    if (equip !== null) this.equip = equip;
    if (purchases !== null) this.purchases = purchases;
    this.refresh();
  }

  // --- 서버 액션 (거부 코드 → 문구 매핑 보존) ---------------------------------

  /** 서버가 반환한 크레딧을 로컬 프로필에 반영·영속(정비 크레딧 pull 패턴과 동일). */
  private pullServerCredits(credits: number): void {
    this.profile.credits = credits;
    saveProfile(this.profile, this.store ?? undefined);
    const pendingStore = this.pendingStore();
    if (pendingStore !== null) refreshPendingProfile(pendingStore, this.profile);
  }

  /** net 대기 슬롯이 사는 스토어(주입 store 우선, 없으면 ambient localStorage). */
  private pendingStore(): KeyValueStore | null {
    if (this.store !== null) return this.store;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
      // 사생활 모드 등 — 접근 자체가 throw 할 수 있음.
    }
    return null;
  }

  /** 슬롯 배열의 한 칸만 바꾼 새 배열(고정 길이 유지 — 밀집화 금지). */
  private nextEquipped(slotIndex: number, moduleId: string | null): (string | null)[] {
    const cur = this.equip?.equipped ?? [];
    const out: (string | null)[] = [];
    for (let i = 0; i < MODULE_EQUIP_SLOTS; i++) {
      const v = cur[i] ?? null;
      // 같은 모듈이 다른 슬롯에 이미 있으면 그 칸을 비운다(중복 장착 금지 — 서버 트리거 동일 규칙).
      out.push(i === slotIndex ? moduleId : v === moduleId && moduleId !== null ? null : v);
    }
    return out;
  }

  private async doEquip(defenseId: string, slotIndex: number, moduleId: string | null): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.refresh();
    // busy 해제는 finally — 화면이 닫히거나 조기 반환해도 잠금이 굳지 않는다(방어 사령부 이력).
    let ok: boolean;
    try {
      ok = await equipModules(defenseId, this.nextEquipped(slotIndex, moduleId));
    } finally {
      this.busy = false;
    }
    if (!this.visible) return;
    if (ok) {
      this.msgText = moduleId === null ? t('mod.equip.unequipped') : t('mod.equip.done');
      const equip = await fetchModuleEquip();
      if (!this.visible) return;
      if (equip !== null) this.equip = equip;
    } else {
      this.msgText = t('mod.equip.failed');
    }
    this.refresh();
  }

  /** 보관함 행의 "장착" — 선택 슬롯(없으면 첫 빈 슬롯)에 꽂는다. 둘 다 차 있으면 안내만. */
  private equipToSlot(moduleId: string): void {
    const equip = this.equip;
    if (equip === null || equip.defenseId === null) return;
    const slot = pickEquipSlot(equip.equipped, this.selectedSlot);
    if (slot === null) {
      this.msgText = t('mod.equip.noSlot');
      this.refresh();
      return;
    }
    void this.doEquip(equip.defenseId, slot, moduleId);
  }

  private async doSalvage(moduleId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.refresh();
    let result: Awaited<ReturnType<typeof netSalvageModule>>;
    try {
      result = await netSalvageModule(moduleId);
    } finally {
      this.busy = false;
    }
    if (!this.visible) return;
    if (result === null) {
      this.msgText = t('mod.salvage.failed');
    } else if (!result.ok) {
      this.msgText = t('mod.salvage.notOwned');
    } else {
      if (result.credits !== undefined) this.pullServerCredits(result.credits);
      this.msgText = t('mod.salvage.done', { c: result.salvaged ?? 0 });
    }
    await this.reload();
  }

  private async doBuy(slotIndex: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.refresh();
    let result: Awaited<ReturnType<typeof netBuyShopModule>>;
    try {
      result = await netBuyShopModule(slotIndex);
    } finally {
      this.busy = false;
    }
    if (!this.visible) return;
    if (result === null) {
      this.msgText = t('mod.buy.failed');
    } else if (!result.ok) {
      // 서버가 내려준 거부 코드를 그대로 사유 문구로 옮긴다(잔액 부족·만석·중복 구매 …).
      this.msgText = buyErrorText(result.code);
    } else {
      if (result.credits !== undefined) this.pullServerCredits(result.credits);
      this.msgText = t('mod.buy.done', { rarity: moduleRarityLabel(result.rarity ?? 'normal') });
    }
    await this.reload();
  }

  private async doFuse(): Promise<void> {
    if (this.busy) return;
    const picks = this.pickedOwned();
    const check = checkFusionSelection(picks);
    if (!check.ok) {
      this.msgText = fusionCheckText(check.code);
      this.refresh();
      return;
    }
    this.busy = true;
    this.refresh();
    const ids = picks.map((m) => m.id) as unknown as readonly [string, string, string];
    let result: Awaited<ReturnType<typeof netFuseModules>>;
    try {
      result = await netFuseModules(ids);
    } finally {
      this.busy = false;
    }
    if (!this.visible) return;
    this.fuseMode = false;
    this.fusePicks.clear();
    if (result === null) {
      this.msgText = t('mod.fuse.failed');
    } else if (!result.ok) {
      this.msgText = result.code === 'not-owned' ? t('mod.fuse.notOwned') : t('mod.fuse.failed');
    } else {
      const rarityLabel = moduleRarityLabel(result.rarity ?? 'normal');
      this.msgText =
        result.promoted === true
          ? t('mod.fuse.promoted', { rarity: rarityLabel })
          : t('mod.fuse.done', { rarity: rarityLabel });
    }
    await this.reload();
  }

  // --- 상호작용 --------------------------------------------------------------

  private ownedById(id: string): ModuleOwned | undefined {
    return this.inventory.find((m) => m.id === id);
  }

  /** 현재 합성 선택된 소유 모듈 목록(존재하는 것만). */
  private pickedOwned(): ModuleOwned[] {
    const out: ModuleOwned[] = [];
    for (const id of this.fusePicks) {
      const owned = this.ownedById(id);
      if (owned !== undefined) out.push(owned);
    }
    return out;
  }

  /**
   * 합성 선택 토글. 상한(3개)은 여기서 지킨다 — 비활성 버튼은 이벤트를 받지 않아 클릭이
   * 행 선택으로 넘어오므로, 버튼 disabled 만으로는 상한이 강제되지 않는다.
   */
  private togglePick(id: string): void {
    if (this.busy) return;
    if (this.fusePicks.has(id)) this.fusePicks.delete(id);
    else if (this.fusePicks.size < MODULE_FUSION_INPUT_COUNT) this.fusePicks.add(id);
    this.refresh();
  }

  private close(): void {
    const cb = this.onClose;
    this.hide();
    cb?.();
  }

  // --- 공용 렌더 조각 ---------------------------------------------------------

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

  /** 줄바꿈 문구(폭 고정, 높이는 내용이 정한다). */
  private wrapped(text: string, size: number, color: number, w: number, weight: '400' | '700' = '400'): Text {
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

  /**
   * 비활성일 때 쓸 톤.
   *
   * ⚠️ `PixiButton.setEnabled(false)` 는 container 알파를 **0.4** 로 떨어뜨린다. 금 톤은 라벨이
   * `COLOR.darkLabel`(진한 갈색)이라 밝은 판이 흐려지는 순간 글자가 **통째로 사라진다** —
   * 실화면에서 `합성 확정 (2/3)` 과 `구매함` 이 빈 판때기로 찍혔다. 정작 그 숫자가 사용자가
   * 알아야 할 정보다. 옛 나무 구현도 같은 이유로 비활성이면 텍스처를 `ui_btn_wood` 로 바꿨다
   * — 그 규율을 톤으로 옮긴다(석재 톤은 라벨이 밝아 0.4 에서도 읽힌다).
   */
  private toneFor(tone: ChromeTone, enabled: boolean): ChromeTone {
    return enabled ? tone : 'stone';
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
   * 비어 있는 패널을 **파낸 보관 챔버**로 그리고 그 안에서 안내한다(선택적으로 버튼 하나).
   *
   * 정제소 §6-bis-2 의 처방 그대로다 — "빈 패널 면"이 아니라 "비어 있는 챔버"가 되면 그 자리가
   * 쓸모도 볼거리도 아닌 자리이기를 멈춘다. 채울 수 있는 것이 없을 때(오프라인·보유 0·조회 실패)
   * 남는 세로를 행으로 메울 방법이 원리적으로 없기 때문에 **자리에 이름을 주는** 쪽으로 푼다.
   */
  private emptyWell(
    host: Container,
    box: { x: number; y: number; w: number; h: number },
    text: string,
    action?: { label: string; onClick: () => void },
  ): void {
    host.addChild(recessedWell(box.x, box.y, box.w, box.h));
    const el = this.wrapped(text, 20, SLAB_BODY_FILL, box.w - 64);
    el.anchor.set(0.5, 0.5);
    const cy = action === undefined ? box.y + box.h / 2 : box.y + box.h / 2 - 40;
    el.position.set(box.x + box.w / 2, cy);
    host.addChild(el);
    if (action === undefined) return;

    const bw = Math.min(220, box.w - 64);
    const btn = this.chromeButton({
      tone: 'stone',
      width: bw,
      height: 48,
      fontSize: 18,
      label: action.label,
      enabled: !this.busy,
      onClick: action.onClick,
    });
    btn.container.position.set(box.x + (box.w - bw) / 2, cy + el.height / 2 + 20);
    host.addChild(btn.container);
  }

  /**
   * 목록이 영역을 다 못 채우고 남았을 때 그 자리를 **파낸 챔버**로 그리고 이름을 준다.
   * 정제소 §6-bis 처방 — "빈 패널 면"이 아니라 "아직 안 찬 자리"가 된다. 잔여가
   * {@link TAIL_WELL_MIN_H} 미만이면 그냥 여백이므로 아무것도 그리지 않는다.
   */
  private tailWell(
    host: Container,
    box: { x: number; y: number; w: number; bottom: number },
    usedBottom: number,
    text: string | null,
  ): void {
    const y = usedBottom + ROW_GAP;
    const h = box.bottom - y;
    if (h < TAIL_WELL_MIN_H) return;
    host.addChild(recessedWell(box.x, y, box.w, h));
    if (text === null) return;
    const el = this.wrapped(text, 17, COLOR.muted, box.w - 64);
    el.anchor.set(0.5, 0.5);
    el.position.set(box.x + box.w / 2, y + h / 2);
    host.addChild(el);
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
    this.slotsPanel = null;
    this.invPanel = null;
    this.shopPanel = null;
    this.slotsHost = null;
    this.invHost = null;
    this.shopHost = null;
    this.chipHost = null;
    this.footHost = null;
    this.modalHost = null;
    for (const child of [...this.root.children]) {
      this.root.removeChild(child);
      child.destroy({ children: true });
    }
    this.chromeBuilt = false;
  }

  private buildChrome(): void {
    if (this.chromeBuilt) return;

    // 바닥 — 배경 자산이 없거나 실패해도 화면이 비지 않게(불투명, 뒤 방어 프리뷰를 가린다).
    // 이벤트도 여기서 막는다(뒤 화면으로 클릭·휠이 새지 않게).
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChild(bg);

    // ⚠️ `view` 는 root 맨 뒤에 그대로 붙이고 스케일·이동을 걸지 마라(공기 마스크가 `view` 의
    // 자식이라 어긋난다). 창은 **없다** — 파일 헤더 "왜 여기는 창을 안 뚫는가" 참조.
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    /**
     * ⚠️ **크롬(헤더·하단 띠)은 패널보다 뒤에 붙여 위로 올린다.**
     *
     * 방어 사령부에서 사용자 신고(2026-08-02) "탭 아래 절반이 클릭이 안 된다"의 실체가 이
     * 순서였다. 석재 패널은 접지 그림자·글로우를 텍스처에 구워 넣어 **자기 사각보다 30px 가까이
     * 위아래로 번지고**, 그 번짐이 위아래 크롬을 덮는다.
     *
     * 왜 "비상호작용이니 안 가린다"가 틀렸나: Pixi v8 은 자식을 역순으로 훑다가 **픽셀에 걸리면
     * 거기서 멈추고 가장 가까운 상호작용 조상**을 반환한다. 그림자 스프라이트가 passive 여도
     * 탐색은 거기서 끝나고 결과는 루트가 된다 — 크롬은 영영 후보에 오르지 못한다.
     * ⚠️ 여백을 벌리는 것으로는 못 푼다 — 번짐 폭은 패널 치수에서 파생돼 조용히 커진다.
     */
    this.slotsPanel = this.addPanel(SLOT_X, PANEL_Y, SLOT_W, PANEL_H, t('mod.slot.head'));
    this.invPanel = this.addPanel(INV_X, PANEL_Y, INV_W, PANEL_H, t('mod.inv.head'));
    this.shopPanel = this.addPanel(SHOP_X, PANEL_Y, SHOP_W, PANEL_H, t('mod.shop.head'));

    const slotsHost = new Container();
    this.slotsPanel.container.addChild(slotsHost);
    this.slotsHost = slotsHost;
    const invHost = new Container();
    this.invPanel.container.addChild(invHost);
    this.invHost = invHost;
    const shopHost = new Container();
    this.shopPanel.container.addChild(shopHost);
    this.shopHost = shopHost;

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
   * 헤더 밴드(y 0..{@link HEADER_H}) — 각인 제목(중앙) · 크레딧 칩 · 닫기(우).
   *
   * ⚠️ 컨트롤은 **전부 같은 세로 띠**를 쓰고 가로로만 배치한다(격납고 헤더 겹침 결함 이력).
   * ⚠️ **각인 석재 인방은 넣지 않는다**(격납고에서 사용자 판단으로 제거됨). 헤더는 배경이 그대로
   * 보이는 띠이고, 배경 모듈이 이 대역을 중간 세기로 눌러 글자 대비를 보장한다.
   * ⚠️ 좌측은 **비워 둔다** — x<120 · y<120 은 설정 톱니 예약 밴드다.
   */
  private buildHeader(): void {
    const title = makeHangarTitle(t('mod.title'));
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

    // 칩은 값이 구워진 컨테이너라 갱신이 아니라 재조립이다 — 그릇만 잡아 둔다.
    const chips = new Container();
    this.root.addChild(chips);
    this.chipHost = chips;
  }

  /**
   * 하단 액션 띠. 옛 하단 [방어 사령부로]는 **없앴다**(헤더 ✕ 와 같은 일을 두 번 했다).
   *
   * 내용은 매 갱신마다 갈아끼운다(게이지 미터가 Graphics 이고 합성 버튼 라벨·활성이 모드에
   * 따라 바뀐다) — 그릇만 여기서 잡는다.
   */
  private buildFooter(): void {
    const host = new Container();
    this.root.addChild(host);
    this.footHost = host;
  }

  // --- 갱신 -----------------------------------------------------------------

  /** 값과 목록만 갈아끼운다. 배경·석재 패널은 다시 굽지 않는다(파일 헤더 "재렌더 규율"). */
  private refresh(): void {
    if (!this.chromeBuilt) return;
    this.syncValues();
    this.renderSlots();
    this.renderInventory();
    this.renderShop();
    this.renderModal();
  }

  private clearHost(host: Container): void {
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
  }

  private syncValues(): void {
    if (this.chipHost !== null) {
      const host = this.chipHost;
      this.clearHost(host);
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
    this.renderFooter();
  }

  /**
   * 하단 액션 띠 — 왼쪽 위 보관 게이지 · 왼쪽 아래 상태 문구 · 오른쪽 합성 컨트롤.
   *
   * ⚠️ 버튼 **자리 두 개는 모드와 무관하게 고정 폭**이다(w200 + w300). 모드마다 폭이 달라지면
   * 오른쪽 끝 등호가 깨지고 버튼이 화면에서 좌우로 튄다. 비합성 모드의 w200 자리는 합성 안내
   * 문구가 쓰므로 빈 자리가 아니다.
   */
  private renderFooter(): void {
    const host = this.footHost;
    if (host === null) return;
    this.clearHost(host);

    // --- 왼쪽 아래 줄에 무엇이 앉는지 먼저 정한다 — 게이지의 세로 자리가 거기서 갈린다. ---
    const gauge = storageGauge(this.inventory.length);
    const gaugeShown = this.online && !this.invFailed;
    // 만석 경고는 토스트가 없을 때만 그 자리를 쓴다(실제 조작 결과가 정보량이 더 많다).
    const line = this.msgText !== '' ? this.msgText : gaugeShown && gauge.full ? t('mod.inv.full') : '';

    // --- 왼쪽: 보관 게이지. 아래 줄이 비면 **띠 세로 중앙**으로 내려온다 —
    //     위쪽에 붙여 두면 아래 절반이 빈 자리가 된다(실화면 1차 확인).
    if (gaugeShown) {
      const gy = line === '' ? FOOT_Y + FOOT_H / 2 : FOOT_Y + 16;
      const gLabel = this.label(
        t('mod.inv.storage', { count: gauge.count, cap: gauge.cap }),
        18,
        gauge.full ? WARN_COLOR : COLOR.cream,
        '700',
      );
      gLabel.anchor.set(0, 0.5);
      gLabel.position.set(EDGE_X, gy);
      host.addChild(gLabel);

      const meterX = EDGE_X + gLabel.width + 16;
      const meter = new Graphics();
      meter
        .roundRect(meterX, gy - GAUGE_H / 2, GAUGE_W, GAUGE_H, 6)
        .fill({ color: 0x0f0b1c })
        .roundRect(
          meterX,
          gy - GAUGE_H / 2,
          Math.max(2, (GAUGE_W * gauge.pct) / 100),
          GAUGE_H,
          6,
        )
        .fill({ color: gauge.full ? GAUGE_FULL_COLOR : EQUIPPED_COLOR });
      host.addChild(meter);
    }

    // --- 왼쪽 아래: 상태 문구(토스트 또는 만석 경고). ---
    if (line !== '') {
      const msg = this.label(
        line,
        19,
        this.msgText !== '' ? COLOR.gold : WARN_COLOR,
        '700',
        FOOT_BTN_X - EDGE_X - 24,
      );
      msg.anchor.set(0, 0.5);
      msg.position.set(EDGE_X, FOOT_Y + FOOT_H - 18);
      host.addChild(msg);
    }

    // --- 오른쪽: 합성 컨트롤(자리 둘 고정) ---
    const sideX = FOOT_BTN_X;
    const mainX = FOOT_BTN_X + FUSE_SIDE_W + FOOT_GAP;

    if (!this.fuseMode) {
      // 안내 문구가 w200 자리를 쓴다 — 버튼이 없다고 빈 자리가 되지 않는다.
      const hint = this.wrapped(t('mod.inv.fuseHint'), 15, COLOR.muted, FUSE_SIDE_W);
      hint.anchor.set(0.5, 0.5);
      hint.position.set(sideX + FUSE_SIDE_W / 2, FOOT_Y + FOOT_H / 2);
      host.addChild(hint);

      const startEnabled = !this.busy && this.inventory.length >= MODULE_FUSION_INPUT_COUNT;
      const start = this.chromeButton({
        tone: this.toneFor('gold', startEnabled),
        width: FUSE_MAIN_W,
        height: FOOT_H,
        fontSize: 21,
        label: t('mod.inv.fuseStart'),
        enabled: startEnabled,
        onClick: () => {
          this.fuseMode = true;
          this.fusePicks.clear();
          this.msgText = t('mod.inv.fuseMode');
          this.refresh();
        },
      });
      start.container.position.set(mainX, FOOT_Y);
      host.addChild(start.container);
      return;
    }

    const cancel = this.chromeButton({
      tone: 'stone',
      width: FUSE_SIDE_W,
      height: FOOT_H,
      fontSize: 21,
      label: t('mod.inv.fuseCancel'),
      onClick: () => {
        this.fuseMode = false;
        this.fusePicks.clear();
        this.msgText = '';
        this.refresh();
      },
    });
    cancel.container.position.set(sideX, FOOT_Y);
    host.addChild(cancel.container);

    const check = checkFusionSelection(this.pickedOwned());
    const confirmEnabled = !this.busy && check.ok;
    const confirm = this.chromeButton({
      tone: this.toneFor('gold', confirmEnabled),
      width: FUSE_MAIN_W,
      height: FOOT_H,
      fontSize: 21,
      label: t('mod.inv.fuseConfirm', { n: this.fusePicks.size }),
      enabled: confirmEnabled,
      onClick: () => void this.doFuse(),
    });
    confirm.container.position.set(mainX, FOOT_Y);
    host.addChild(confirm.container);
  }

  // --- 코어 모듈 슬롯(2) ------------------------------------------------------

  /** 슬롯 2칸 목록 — 각 칸은 장착 모듈 요약 또는 빈 슬롯 안내. 클릭하면 장착 대상이 된다. */
  private renderSlots(): void {
    const host = this.slotsHost;
    if (host === null) return;
    this.clearHost(host);

    if (this.loading) {
      this.emptyWell(host, BOX_SLOT, t('mod.slot.loading'));
      return;
    }
    if (!this.online) {
      this.emptyWell(host, BOX_SLOT, t('mod.slot.offline'));
      return;
    }

    const equip = this.equip;
    const kind = slotPanelKind({ equip, failed: this.equipFailed });
    if (kind !== 'slots' || equip === null || equip.defenseId === null) {
      // 조회 실패("모른다")와 방어 미배치("아직 안 짰다")를 다른 문구로 가른다.
      // ⚠️ 실패해도 여기에는 [다시 시도]를 두지 않는다 — 보관함·장착은 **한 번의 재조회**가
      // 함께 받아 오므로 버튼이 둘이면 같은 일을 하는 버튼이 두 개가 된다(실화면 1차 확인).
      // 재시도는 가운데 보관함 챔버가 하나만 갖는다.
      this.emptyWell(host, BOX_SLOT, t(panelMessageKey(kind) ?? 'mod.slot.noBase'));
      return;
    }
    const defenseId = equip.defenseId;

    const built: { node: Container; natural: number; finish: (h: number) => void }[] = [];
    for (let i = 0; i < MODULE_EQUIP_SLOTS; i++) {
      const moduleId = equip.equipped[i] ?? null;
      const owned = moduleId !== null ? this.ownedById(moduleId) : undefined;
      built.push(this.makeSlotRow(i, owned, BOX_SLOT.w, defenseId));
    }
    // 남는 세로를 행이 나눠 갖는다(빈 자리 금지 — {@link fillRowHeights} 주석이 근거).
    const hs = fillRowHeights(
      built.map((b) => b.natural),
      ROW_GAP,
      BOX_SLOT.h,
      SLOT_ROW_MAX_H,
    );
    built.forEach((b, i) => b.finish(hs[i] ?? b.natural));

    const bounds = rowBounds(hs, ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(BOX_SLOT.h, bounds);
    const content = makeScrollArea(host, {
      x: BOX_SLOT.x,
      y: BOX_SLOT.y,
      w: BOX_SLOT.w,
      h: maskH,
      totalH: total,
      get: () => 0,
      set: () => {
        /* 슬롯은 2칸이라 항상 다 보인다 — 스크롤 상태를 둘 필요가 없다. */
      },
    });
    let cy = 0;
    built.forEach((b, i) => {
      b.node.position.set(0, cy);
      content.addChild(b.node);
      cy += (hs[i] ?? b.natural) + ROW_GAP;
    });
    // 슬롯은 원리적으로 2행뿐이라 세로가 남는다 — 그 자리에 **자동 발동**이라는 사실을 준다.
    this.tailWell(host, BOX_SLOT, BOX_SLOT.y + Math.min(maskH, total), t('mod.slot.autoHint'));
  }

  /**
   * 슬롯 1칸. 행 전체가 "이 슬롯을 장착 대상으로" 선택 토글이다.
   *
   * **2단계로 만든다**: 내용을 먼저 얹어 자연 높이(`natural`)를 재고, 호출부가 영역에 맞춰
   * 나눠 준 최종 높이로 `finish()` 를 부른다. 바탕 판과 버튼 세로 중앙은 그때 결정된다 —
   * 판을 먼저 구우면 높이를 나중에 못 늘린다(그래서 빈 자리가 생겼다).
   */
  private makeSlotRow(
    index: number,
    owned: ModuleOwned | undefined,
    w: number,
    defenseId: string,
  ): { node: Container; natural: number; finish: (h: number) => void } {
    const selected = this.selectedSlot === index;
    const row = new Container();
    // 선택 클릭은 **행 Container** 가 받는다(바탕 Graphics 면 위에 얹힌 텍스트가 삼킨다).
    attachRowClick(row, () => {
      if (this.busy) return;
      this.selectedSlot = selected ? null : index;
      this.refresh();
    });

    /**
     * 내용은 **inner 에 담아 최종 높이 안에서 세로 중앙에 놓는다**(실화면 1차 확인).
     *
     * 슬롯은 2칸뿐이라 {@link fillRowHeights} 가 행을 상한까지 늘리는데, 빈 슬롯은 글자가 세 줄
     * 뿐이라 늘어난 판 아래쪽 150px 가 통째로 빈 면이 됐다 — 패널이 아니라 **행 안에** 생긴 빈
     * 자리다. 중앙에 놓으면 늘어난 판이 "여유 있는 칸"으로 읽히고 위아래가 대칭이 된다.
     */
    const inner = new Container();
    row.addChild(inner);

    const textW = MODULES_BOXES.slotRowTextW;
    let cy = 14;
    const put = (el: Text): void => {
      el.position.set(ROW_PAD, cy);
      inner.addChild(el);
      cy += el.height + 6;
    };

    const head = `${t('mod.slot.label', { n: index + 1 })}${selected ? ` · ${t('mod.slot.selected')}` : ''}`;
    put(this.label(head, 20, selected ? COLOR.gold : COLOR.cream, '800', w - ROW_PAD * 2));

    let clear: PixiButton | null = null;
    if (owned === undefined) {
      put(this.wrapped(t('mod.slot.empty'), 17, SLAB_BODY_FILL, w - ROW_PAD * 2));
      put(this.wrapped(t('mod.slot.emptyHint'), 15, COLOR.muted, w - ROW_PAD * 2));
    } else {
      // 등급은 **제목 글자색**이 말한다 — 면 위에 얹히는 표식(악센트 바)은 넣지 않는다.
      const accent = hexColor(moduleRarityColor(owned.rarity));
      put(this.label(`${t('mod.slot.equipped')} · ${moduleRarityLabel(owned.rarity)}`, 19, accent, '800', textW));
      put(
        this.label(
          t('mod.slot.charges', { n: owned.chargesLeft, m: owned.module.chargesMax }),
          17,
          isLowCharge(owned.chargesLeft) ? WARN_COLOR : SLAB_BODY_FILL,
          '700',
          textW,
        ),
      );
      if (isLowCharge(owned.chargesLeft)) {
        put(this.wrapped(t('mod.slot.lastCharge'), 15, WARN_COLOR, w - ROW_PAD * 2, '700'));
      }
      put(this.wrapped(effectText(owned.module), 15, COLOR.muted, w - ROW_PAD * 2));

      clear = this.chromeButton({
        tone: 'stone', // 이미 석재 — 비활성 대체가 필요 없다
        width: ROW_BTN_W,
        height: ROW_BTN_H,
        fontSize: 17,
        label: t('mod.slot.unequip'),
        enabled: !this.busy,
        onClick: () => void this.doEquip(defenseId, index, null),
      });
      // 해제 버튼은 글자 뭉치 **바로 아래**에 흐름대로 붙는다 — 판 바닥에 고정하면 늘어난
      // 행에서 글자와 버튼 사이가 통째로 빈다.
      clear.container.position.set(w - ROW_BTN_W - ROW_PAD, cy + 4);
      // 해제 버튼 클릭이 행 선택 토글까지 함께 발동하지 않게 끊는다.
      stopRowPropagation(clear.container);
      inner.addChild(clear.container);
      cy += ROW_BTN_H + 4;
    }

    const natural = Math.max(96, cy + 8);
    return {
      node: row,
      natural,
      finish: (h: number) => {
        // 바탕 판은 **맨 뒤**로 넣는다(내용이 이미 얹혀 있다).
        row.addChildAt(rowPlate(w, h, selected), 0);
        inner.y = Math.max(0, Math.round((h - natural) / 2));
      },
    };
  }

  // --- 보관함 ----------------------------------------------------------------

  /** 모듈 목록(장착/분해 또는 합성 선택). 게이지·합성 바는 하단 띠로 내렸다(파일 헤더). */
  private renderInventory(): void {
    const host = this.invHost;
    if (host === null) return;
    this.clearHost(host);

    if (this.loading) {
      this.emptyWell(host, BOX_INV, t('mod.slot.loading'));
      return;
    }
    if (!this.online) {
      // ⚠️ 왼쪽 슬롯 패널이 이미 "서버 연결이 필요하다"를 말한다 — 같은 문장을 두 번 쓰면
      // 화면이 자기 말을 되풀이하는 것으로 읽힌다(실화면 1차 확인). 여기서는 **보관함이 어디에
      // 사는지**를 말한다. 상점 패널도 같은 이유로 제 나름의 문장을 쓴다.
      this.emptyWell(host, BOX_INV, t('mod.inv.offlineNote'));
      return;
    }

    const kind = inventoryPanelKind({ count: this.inventory.length, failed: this.invFailed });
    if (kind === 'failed') {
      // 조회 실패에 게이지·합성 버튼을 함께 그리면 **모듈이 0개라고 단정**하는 화면이 된다.
      // 실패일 때는 수치를 아예 말하지 않는다(하단 띠 게이지도 `invFailed` 로 꺼진다).
      this.emptyWell(host, BOX_INV, t(panelMessageKey(kind) ?? 'mod.load.failed'), {
        label: t('mod.load.retry'),
        onClick: () => void this.reload(),
      });
      return;
    }
    if (kind === 'empty') {
      this.emptyWell(host, BOX_INV, t(panelMessageKey(kind) ?? 'mod.inv.empty'));
      return;
    }

    const equippedIds = new Set((this.equip?.equipped ?? []).filter((v): v is string => v !== null));
    const built = this.inventory.map((owned) => this.makeInvRow(owned, BOX_INV.w, equippedIds));
    const hs = fillRowHeights(
      built.map((b) => b.natural),
      ROW_GAP,
      BOX_INV.h,
      INV_ROW_MAX_H,
    );
    built.forEach((b, i) => b.finish(hs[i] ?? b.natural));

    const bounds = rowBounds(hs, ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(BOX_INV.h, bounds);
    const content = makeScrollArea(host, {
      x: BOX_INV.x,
      y: BOX_INV.y,
      w: BOX_INV.w,
      h: maskH,
      totalH: total,
      get: () => this.invScrollY,
      set: (v) => {
        this.invScrollY = v;
      },
      // 마스크를 행 경계로 자르면 마지막 행이 온전히 보여 **잘렸다는 신호가 사라진다** —
      // 위치 표시가 유일한 "더 있다" 단서다(스크롤할 게 없으면 그려지지 않는다).
      thumb: true,
    });
    let cy = 0;
    built.forEach((b, i) => {
      b.node.position.set(0, cy);
      content.addChild(b.node);
      cy += (hs[i] ?? b.natural) + ROW_GAP;
    });
    this.tailWell(host, BOX_INV, BOX_INV.y + Math.min(maskH, total), t('mod.inv.more'));
  }

  /** 보관함 1행. 합성 모드에서는 **행 전체**가 선택 토글이 된다. */
  private makeInvRow(
    owned: ModuleOwned,
    w: number,
    equippedIds: ReadonlySet<string>,
  ): { node: Container; natural: number; finish: (h: number) => void } {
    const isEquipped = equippedIds.has(owned.id);
    const isPicked = this.fusePicks.has(owned.id);
    const rarityColor = hexColor(moduleRarityColor(owned.rarity));

    const row = new Container();
    // 선택 클릭은 **행 전체**가 받는다(바탕 Graphics 면 텍스트 위 클릭이 먹지 않는다).
    if (this.fuseMode) attachRowClick(row, () => this.togglePick(owned.id));

    const textW = MODULES_BOXES.invRowTextW;
    const grade = this.label(
      `${moduleRarityLabel(owned.rarity)}${isEquipped ? ` · ${t('mod.inv.equipped')}` : ''}`,
      20,
      isEquipped ? EQUIPPED_COLOR : rarityColor,
      '800',
      textW,
    );
    grade.position.set(ROW_PAD, 12);

    const charges = this.label(
      t('mod.inv.charges', { n: owned.chargesLeft }),
      16,
      isLowCharge(owned.chargesLeft) ? WARN_COLOR : COLOR.muted,
      '700',
    );
    charges.position.set(ROW_PAD + grade.width + 10, 16);

    const affix = this.wrapped(effectText(owned.module), 15, COLOR.muted, textW);
    affix.position.set(ROW_PAD, 42);
    row.addChild(grade, charges, affix);

    const natural = Math.max(80, 42 + affix.height + 14);
    const buttons: PixiButton[] = [];

    if (this.fuseMode) {
      const pick = this.chromeButton({
        tone: isPicked ? 'gold' : 'blue',
        width: ROW_BTN_W,
        height: ROW_BTN_H,
        fontSize: 17,
        label: isPicked ? t('mod.inv.picked') : t('mod.inv.pick'),
        enabled: !this.busy,
        onClick: () => this.togglePick(owned.id),
      });
      pick.container.x = w - ROW_BTN_W - ROW_PAD;
      // 버튼 클릭이 행 토글까지 겹쳐 두 번 뒤집히지 않게 끊는다.
      stopRowPropagation(pick.container);
      row.addChild(pick.container);
      buttons.push(pick);
    } else {
      const canEquip = !isEquipped && this.equip?.defenseId != null && !this.busy;
      const eq = this.chromeButton({
        tone: this.toneFor('blue', canEquip),
        width: ROW_BTN_W,
        height: ROW_BTN_H,
        fontSize: 17,
        label: isEquipped ? t('mod.inv.equipped') : t('mod.inv.equip'),
        enabled: canEquip,
        onClick: () => this.equipToSlot(owned.id),
      });
      eq.container.x = w - ROW_BTN_W * 2 - 8 - ROW_PAD;
      stopRowPropagation(eq.container);
      row.addChild(eq.container);
      buttons.push(eq);

      const sv = this.chromeButton({
        tone: 'stone',
        width: ROW_BTN_W,
        height: ROW_BTN_H,
        fontSize: 17,
        label: t('mod.inv.salvage'),
        enabled: !this.busy,
        // 분해는 되돌릴 수 없다 — 확인을 한 겹 둔다(파일 헤더 "분해에 확인 팝업을 붙였다").
        onClick: () => {
          this.salvageId = owned.id;
          this.refresh();
        },
      });
      sv.container.x = w - ROW_BTN_W - ROW_PAD;
      stopRowPropagation(sv.container);
      row.addChild(sv.container);
      buttons.push(sv);
    }

    return {
      node: row,
      natural,
      finish: (h: number) => {
        row.addChildAt(rowPlate(w, h, isPicked), 0);
        const btnY = Math.round((h - ROW_BTN_H) / 2);
        for (const b of buttons) b.container.y = btnY;
      },
    };
  }

  // --- 일일 상점 --------------------------------------------------------------

  /** 오늘 재고(옵션 미리 공개 · 가격), 이미 산 슬롯은 비활성. */
  private renderShop(): void {
    const host = this.shopHost;
    if (host === null) return;
    this.clearHost(host);

    if (this.loading) {
      this.emptyWell(host, BOX_SHOP, t('mod.slot.loading'));
      return;
    }
    if (!this.online) {
      // ⚠️ 왼쪽 두 패널이 이미 "서버 연결이 필요하다"를 말한다 — 같은 문장을 세 번 쓰면 화면이
      // 자기 말을 되풀이하는 것으로 읽힌다. 여기서는 **상점이 무엇인지**를 말한다.
      this.emptyWell(host, BOX_SHOP, t('mod.shop.note'));
      return;
    }
    if (this.shop.length === 0) {
      this.emptyWell(host, BOX_SHOP, t('mod.shop.empty'));
      return;
    }

    const storageFull = storageGauge(this.inventory.length).full;
    const built = this.shop.map((mod, i) => this.makeShopRow(mod, i, BOX_SHOP.w, storageFull));
    const hs = fillRowHeights(
      built.map((b) => b.natural),
      ROW_GAP,
      BOX_SHOP.h,
      SHOP_ROW_MAX_H,
    );
    built.forEach((b, i) => b.finish(hs[i] ?? b.natural));

    const bounds = rowBounds(hs, ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(BOX_SHOP.h, bounds);
    const content = makeScrollArea(host, {
      x: BOX_SHOP.x,
      y: BOX_SHOP.y,
      w: BOX_SHOP.w,
      h: maskH,
      totalH: total,
      get: () => this.shopScrollY,
      set: (v) => {
        this.shopScrollY = v;
      },
      thumb: true,
    });
    let cy = 0;
    built.forEach((b, i) => {
      b.node.position.set(0, cy);
      content.addChild(b.node);
      cy += (hs[i] ?? b.natural) + ROW_GAP;
    });
    // 재고는 4~6칸이라 세로가 남는다 — 그 자리에 **로테이션 규칙**을 준다.
    this.tailWell(host, BOX_SHOP, BOX_SHOP.y + Math.min(maskH, total), t('mod.shop.note'));
  }

  /**
   * 상점 1행. 열이 좁아 구매 버튼은 문구 **옆이 아니라 아래**에 둔다 — 옆에 붙이면 어픽스
   * 문구 폭이 눌려 가로 축소가 걸리고 읽을 수 없다(관제탑 교훈).
   */
  private makeShopRow(
    mod: ModuleInstance,
    slotIndex: number,
    w: number,
    storageFull: boolean,
  ): { node: Container; natural: number; finish: (h: number) => void } {
    const bought = this.purchases.includes(slotIndex);
    const rarityColor = hexColor(moduleRarityColor(mod.rarity));
    const row = new Container();
    // 슬롯 행과 같은 이유로 내용을 inner 에 담아 세로 중앙에 놓는다({@link makeSlotRow} 주석).
    const inner = new Container();
    row.addChild(inner);
    const textW = MODULES_BOXES.shopRowTextW;

    const head = this.label(
      `${moduleRarityLabel(mod.rarity)} · ${t('mod.shop.price', { c: shopSlotPrice(mod.rarity) })}`,
      19,
      bought ? COLOR.muted : rarityColor,
      '800',
      textW,
    );
    head.position.set(ROW_PAD, 12);

    // 소모품이라는 사실이 구매 전에 보여야 한다 — 잔여 횟수를 재고에서 미리 드러낸다.
    const charges = this.label(
      t('mod.slot.charges', { n: mod.chargesLeft, m: mod.chargesMax }),
      15,
      COLOR.muted,
      '700',
      textW,
    );
    charges.position.set(ROW_PAD, 38);

    const affix = this.wrapped(effectText(mod), 15, SLAB_BODY_FILL, textW);
    affix.position.set(ROW_PAD, 62);
    inner.addChild(head, charges, affix);

    const buyY = 62 + affix.height + 10;
    const natural = buyY + ROW_BTN_H + 12;

    const canBuy = !bought && !storageFull && !this.busy;
    const buy = this.chromeButton({
      tone: this.toneFor('gold', canBuy),
      width: 150,
      height: ROW_BTN_H,
      fontSize: 18,
      label: bought ? t('mod.shop.bought') : t('mod.shop.buy'),
      enabled: canBuy,
      onClick: () => void this.doBuy(slotIndex),
    });
    buy.container.position.set(w - 150 - ROW_PAD, buyY);
    inner.addChild(buy.container);

    return {
      node: row,
      natural,
      finish: (h: number) => {
        row.addChildAt(rowPlate(w, h, false), 0);
        inner.y = Math.max(0, Math.round((h - natural) / 2));
      },
    };
  }

  // --- 팝업 ----------------------------------------------------------------

  /**
   * 시네마틱 팝업(분해 확인). **`makeModal` 을 쓰지 않는다** — 그 모듈은 나무 nine-slice 에
   * 묶여 있고 다른 화면 다섯이 쓰기 때문에 고치면 그 화면들이 같이 갈린다. 대신 `modal.ts`
   * 헤더의 실측 규칙 세 가지를 그대로 승계한다:
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
    const targetId = this.salvageId;
    if (targetId === null) return;
    const owned = this.ownedById(targetId);
    if (owned === undefined) {
      this.salvageId = null;
      return;
    }
    // 팝업은 언제나 맨 앞이어야 한다.
    this.root.setChildIndex(host, this.root.children.length - 1);

    // ① · ② 암막.
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: SCRIM_ALPHA });
    scrim.eventMode = 'static';
    scrim.on('pointertap', () => this.closeModal());
    host.addChild(scrim);

    // 높이는 **효과 줄 수에서 역산**한다 — 팝업이 담는 것이 가변 길이면 높이도 거기서 나와야
    // 한다(상수로 박았더니 5줄짜리 모듈이 경고 문장과 버튼을 뚫었다 — 실화면 2차 확인).
    const lines = moduleEffectLines(owned.module).slice(0, MODULES_MODAL.linesMax);
    const modalH = salvageModalHeight(lines.length);
    const px = Math.round((DESIGN_WIDTH - MODULES_MODAL.w) / 2);
    const py = Math.round((DESIGN_HEIGHT - modalH) / 2);
    const panel = makeCinematicPanel({
      width: MODULES_MODAL.w,
      height: modalH,
      variant: 'slab',
      title: t('mod.salvage.confirm.title'),
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
    // 무엇을 없애는지 보여야 확인이 확인이 된다(등급 · 잔여 · 효과 전량).
    const what = this.label(
      `${moduleRarityLabel(owned.rarity)} · ${t('mod.inv.charges', { n: owned.chargesLeft })}`,
      22,
      hexColor(moduleRarityColor(owned.rarity)),
      '800',
      box.w,
    );
    what.anchor.set(0.5, 0);
    what.position.set(box.x + box.w / 2, box.y);
    panel.container.addChild(what);

    // ⚠️ 효과는 **줄바꿈 없이 한 줄씩** 놓는다(`label` 이 넘치면 가로로 줄인다). 자동 줄바꿈을
    // 쓰면 렌더 줄 수가 역산에 쓴 줄 수와 갈려 높이가 다시 거짓말한다.
    let ly = box.y + MODULES_MODAL.headH + 8;
    for (const line of lines) {
      const el = this.label(line, 16, SLAB_BODY_FILL, '400', box.w);
      el.anchor.set(0.5, 0);
      el.position.set(box.x + box.w / 2, ly);
      panel.container.addChild(el);
      ly += MODULES_MODAL.lineH;
    }

    const body = this.label(t('mod.salvage.confirm.body'), 18, WARN_COLOR, '700', box.w);
    body.anchor.set(0.5, 0);
    body.position.set(box.x + box.w / 2, ly + 14);
    panel.container.addChild(body);

    // 버튼은 **패널 바닥 기준**으로 놓는다 — 본문 길이가 로케일에 따라 변하는데 본문 아래에
    // 이어 붙이면 긴 문장에서 패널 밖으로 밀린다(챔피언 선택 실측 규율).
    const gap = 16;
    const bw = Math.floor((box.w - gap) / 2);
    const by = box.bottom - MODULES_MODAL.btnH;
    const ok = this.chromeButton({
      tone: 'red',
      width: bw,
      height: MODULES_MODAL.btnH,
      fontSize: 20,
      label: t('mod.salvage.confirm.ok'),
      enabled: !this.busy,
      onClick: () => {
        this.salvageId = null;
        void this.doSalvage(owned.id);
      },
    });
    ok.container.position.set(box.x, by);
    panel.container.addChild(ok.container);

    const cancel = this.chromeButton({
      tone: 'stone',
      width: bw,
      height: MODULES_MODAL.btnH,
      fontSize: 20,
      label: t('mod.salvage.confirm.cancel'),
      onClick: () => this.closeModal(),
    });
    cancel.container.position.set(box.x + bw + gap, by);
    panel.container.addChild(cancel.container);
  }

  private closeModal(): void {
    this.salvageId = null;
    this.refresh();
  }
}
