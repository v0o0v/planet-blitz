/**
 * 격납고 화면 — 시네마틱 전환(`.omc/plans/hangar-aaa-2026-08-02.md`).
 *
 * `src/ui/inventory.ts` InventoryOverlay(DOM) 와 기능 1:1 동등하게 장비 정비를 Pixi
 * 캔버스(1920×1080 디자인 스페이스, src/render/app.ts)로 재구현한다: 장착/해제(모듈 2슬롯
 * 규칙), 일괄 분해 2종, 창고 확장, 스탯 미리보기(computeLoadoutStats), 툴팁+장착 비교,
 * 재화 표시, i18n, Profile in-place 변이 + saveProfile. 기체 쇼케이스 8슬롯 연결선,
 * 스탯 1줄 설명, 원소 강도/계보/유니크 조건부 행.
 *
 * ## 왜 나무 패널을 걷어냈나
 * 타이틀·인트로·기지를 풀블리드 시네마틱 키아트로 올린 뒤(PR#236·#238·#240·#245) 같은 붓을
 * 다음 화면으로 롤아웃한다. 격납고가 그 대상이다. 나무 nine-slice(`ui_panel.png`)와 나무
 * 판때기 버튼(`ui_btn_*.png`)은 여기서 은퇴하고, 석재 슬래브 + 각인 크롬으로 바꾼다.
 *
 * ## 기지와 결정적으로 다른 점 — **배경이 보일 자리가 없다**
 * 기지는 카드 8장이 배경 **위에 떠 있는** 구성이라 배경이 넓게 보였다. 격납고는 패널 4장이
 * 화면의 약 97% 를 덮는 **조작 화면**이다. 그 구성을 그대로 옮기면 아무리 잘 그린 배경도
 * 보이지 않는다 — 실제로 좌우 여백 24 · 거터 20 이 배경의 전부였다.
 *
 * 그래서 배경을 패널 **뒤**가 아니라 패널 **안**으로 들여온다: 기체 쇼케이스 패널을 불투명
 * 채움이 아니라 **배경이 비치는 도크 창**(`variant: 'window'`)으로 뚫는다. 그 창(936×496 =
 * 화면 22.6%)과 헤더 밴드(1920×104 = 9.6%)를 합쳐 **약 32%** 가 실제 키아트다. 나머지는
 * 석재가 덮는다 — AAA 허브는 배경을 넓게 펼치는 게 아니라 **창을 뚫는다**.
 *
 * 배경 원화도 그 창 위치에 맞춰 생성했다(`assets/hangar/README.md` — 우측 절반 정비 도크,
 * 좌측·하단은 의도적으로 어두운 석재). ⚠️ 아래 패널 좌표를 바꾸면 그 대응이 어긋나고,
 * 톤매핑으로는 못 푼다(없는 디테일은 만들 수 없다 — 기지 배경에서 확인한 한계다).
 *
 * ## 레이어 구조 (뒤 → 앞)
 * ```
 *   backdrop  HangarBackdrop     풀블리드 도크 홀 + 창 보존 · 창 밖/헤더 감쇠 · 비네트
 *   panels    CinematicPanel ×4  석재 슬래브 3 + 유리창 1(쇼케이스)
 *   content   슬롯 · 그리드 · 스탯 행 · 툴팁      ← 기능은 전혀 바뀌지 않았다
 *   chrome    각인 제목 · 재화 칩 · 버튼(석재 텍스처를 PixiButton 에 주입)
 * ```
 *
 * ## 기능은 한 줄도 바꾸지 않았다
 * 요구 레벨 게이트(ADR-0030) · 중복 유니크 거부 · 휠 스크롤(클립 Container 에 — 마스크
 * Graphics 에 걸면 영영 안 불린다) · 좌/우클릭 이동 · 일괄 분해의 "보이는 것 = 대상" 규율 ·
 * 하위 화면 `suspend()`/`resume()` 는 그대로다. 등급 색(`RARITY_COLOR_NUM` 계열)도 손대지
 * 않았다 — 파밍 시각 언어이고 `theme.ts` 헤더에 ΔE 실측 근거가 있다.
 *
 * 시네마틱 전환에서 실제로 바뀐 것은 **바탕**뿐이다: `nineSlicePanel` → `makeCinematicPanel`,
 * `ui_btn_*.png` → `cinematicButtonTexture`, `ui_slot*.png` → `cinematicSlotTexture`.
 * 기존 컴포넌트(`PixiButton` · `makeSlotCell`)는 수정하지 않고 **텍스처만 주입**한다 —
 * 그 둘은 다른 화면 6곳이 쓰고 있어서, 고쳐 쓰면 기능이 조용히 퇴행한다.
 *
 * ## 연출은 `update(dt)` 로만 산다
 * 배경 패럴랙스·티끌·램프 맥동·패널 광택 호흡은 전부 벽시계 기반이고 **렌더 루프가 불러 줘야**
 * 돈다(`main.ts` 의 `inventory.update(frame)`). 화면이 숨겨져 있으면 즉시 반환하므로 런 중
 * 비용은 0 이다.
 *
 * Profile 을 in-place 로 바꾸고 매 변경마다 저장하므로(InventoryOverlay 와 동일), 다음
 * 런의 로드아웃은 여기서 장착한 결과를 반영한다. 순수 render/UI 레이어(ADR-0005) — sim 은
 * 이 파일을 모른다.
 */

import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import type { Item, EquipSlotId, SlotKind, Rarity } from '../../items/types.js';
import { EQUIP_SLOTS, RARITY_CODE } from '../../items/types.js';
import { LEVEL_CAP } from '../../../data/waves.js';
import { affixLines } from '../affixText.js';
import { itemDisplayName, slotLabel, weaponLabel } from '../itemNames.js';
import { compareLines } from '../itemCompare.js';
import { computeLoadoutStats } from '../../items/loadout.js';
import { canEquip, requiredLevel } from '../../items/requiredLevel.js';
import { duplicateUniqueSlot, redundantUniqueIndices } from '../../items/uniqueEquip.js';
import { UNIQUE_REGISTRY } from '../../items/uniques.js';
import { shipBonusBp } from '../../../data/lineage.js';
import { shipTypeDef } from '../../../data/ships/index.js';
import {
  saveProfile,
  activeShip,
  stashCapacity,
  INVENTORY_CAP,
  MAX_STASH_EXPANSIONS,
  type KeyValueStore,
  type Profile,
} from '../../save/profile.js';
import { salvageItems } from '../../save/settlement.js';
import { spendCurrencyOnServer, grantCurrencyToServer } from '../../net/index.js';
import { t, type MessageKey } from '../../i18n/index.js';
import { stashExpansionCost, canAfford } from '../../../data/economy.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, RARITY_COLOR_NUM, UI_FONT, TEXT_SHADOW } from './theme.js';
import { loadUiTextures, shipShowcaseName, LEGACY_SHOWCASE, type UiTextures } from './uiTextures.js';
import { ChampionSelectScreen } from './championSelect.js';
import { GuardianRosterScreen } from './guardianRoster.js';
import { CatalystArchiveScreen } from './catalystArchive.js';
import { shipTypeName, tShipKey } from './shipLabels.js';
import { PixiButton } from './button.js';
import { makeSlotCell, rectGridPositions, fitGridCols, equipIconTexture } from './slotGrid.js';
import { PixiTooltip } from './tooltip.js';
import { loadHangarTextures, HANGAR_BACKDROP_NAME, type HangarTextures } from './hangarTextures.js';
import { HangarBackdrop } from './hangarBackdrop.js';
import { makeCinematicPanel, type CinematicPanel } from './cinematicPanel.js';
import { makeShipDock, type ShipDock } from './shipDock.js';
import {
  makeHangarTitle,
  makeHangarChip,
  makeSlotContactShadow,
  cinematicButtonTexture,
  chromeFallbackColor,
  chromeLabelColor,
  cinematicSlotTexture,
  type ChromeTone,
} from './hangarChrome.js';

// 슬롯·무기 표시명은 `src/ui/itemNames.ts` 단일 정본을 쓴다 — 이 파일에 있던 사본은 무기 3종에서
// 멈춰 있어 미사일·빔이 `?`/`발칸` 으로 표시됐다(사용자 신고 2026-07-27).

function slotKindOf(id: EquipSlotId): SlotKind {
  return (id === 'module0' || id === 'module1' ? 'module' : id) as SlotKind;
}

// ---------------------------------------------------------------------------
// 레이아웃 (디자인 스페이스 1920×1080) — 시네마틱 전환에서 재설계했다.
//
// 옛 판은 좌우 여백 24 · 거터 20 으로 패널이 화면의 97% 를 덮었다. 배경을 아무리 잘 그려도
// 보일 자리가 없다는 뜻이라(파일 헤더 참조), 여백·거터를 키워 **헤더 밴드**를 만들고 쇼케이스
// 패널을 **창**으로 뚫었다. 아래 숫자는 그 둘의 합이 화면의 32% 가 되도록 잡은 것이다.
//
// ⚠️ **이 좌표는 배경 원화와 계약 관계다.** `assets/hangar/hangar_backdrop.webp` 는 우측
// 절반에 정비 도크를, 좌측·하단에 어두운 석재를 두도록 생성했다 — 창을 옮기면 창 안에
// 그림이 없어지고, 그건 톤매핑으로 못 푼다(`assets/hangar/README.md`).
// ---------------------------------------------------------------------------

/** 헤더 밴드 높이. 배경이 그대로 보이는 두 자리 중 하나이고, 제목·칩·버튼이 여기 앉는다. */
const HEADER_H = 104;
/** 헤더 컨트롤(칩·버튼) 상단과 높이 — 전부 같은 세로 띠를 쓴다(겹침 방지). */
const HEAD_Y = 26;
const HEAD_H = 52;
/** 화면 좌우 여백 · 패널 사이 거터 · 두 행 사이 간격. */
const EDGE_X = 32;
const GUTTER_X = 28;
const ROW_GAP = 20;
/** 좌/우 열의 x 와 폭. 우열이 넓은 것은 인벤토리 그리드가 열을 더 먹기 때문이다. */
const COL_L_X = EDGE_X;
const COL_L_W = 892;
const COL_R_X = COL_L_X + COL_L_W + GUTTER_X;
const COL_R_W = DESIGN_WIDTH - EDGE_X - COL_R_X;
/** 위 행(스탯 · 쇼케이스)과 아래 행(창고 · 인벤토리)의 y 와 높이. */
const ROW_T_Y = HEADER_H + 8;
const ROW_T_H = 496;
const ROW_B_Y = ROW_T_Y + ROW_T_H + ROW_GAP;
const ROW_B_H = 424;

/**
 * 쇼케이스 창의 화면 좌표 — 배경 모듈에 **여기서 파생해** 넘긴다.
 *
 * 배경 쪽에 좌표를 하드코딩해 두면 여기 레이아웃을 바꿀 때 조용히 어긋난다(기지에서 Lane A 가
 * 실제로 그렇게 인계했고, 리드가 격자 파생으로 되돌렸다). 같은 실수를 반복하지 않는다.
 */
export function showcaseWindowRect(): { x: number; y: number; w: number; h: number } {
  return { x: COL_R_X, y: ROW_T_Y, w: COL_R_W, h: ROW_T_H };
}

/**
 * 석재 슬래브 위 **보조 텍스트색**(설명·안내·빈 목록 문구).
 *
 * 옛 `COLOR.muted`(#aa9b87)를 쓸 수 없다. 1차 AAA 판정 M4 처방으로 슬래브 면의 동작점을
 * L* 19 → 28 로 올렸는데(그전에는 화면 과반이 지각적으로 평평한 암면이었다), 배경이 밝아지면
 * 그 위 글자의 대비는 **내려간다**. 실측으로 콘텐츠 상자 안 가장 밝은 지점에서 옛 부제색
 * `#b8ac97` 이 **3.00:1** 로 WCAG AA(4.5:1) 미달이 됐다.
 *
 * 고치는 방향이 중요하다 — 배경을 도로 어둡게 하면 C1(단일 평면 재질)·M4 가 함께 되돌아온다.
 * **배경은 그대로 두고 전경만 올린다.** 대비는 두 항의 비인데 건드려도 되는 항이 하나뿐이다
 * (기지 화면 `cinematicTile.ts` `DESC_FILL` 이 같은 논리로 결정됐다).
 *
 * `#e4dac7` 검산: 최악의 바탕(콘텐츠 상자 최대 밝기)에서 **4.84:1** — AA 를 0.34 여유로 넘고,
 * 제목(`COLOR.cream` 계열 · 굵기 700~800 · 큰 크기)과의 위계도 유지된다.
 *
 * ⚠️ 헤더 밴드의 잠금 사유 문구는 여기 해당하지 않는다 — 그 글자는 슬래브가 아니라 **각인
 * 인방** 위에 앉고, 인방의 글자 띠는 오히려 배경보다 어둡다(Lane C 실측 L* 10.7).
 */
const SLAB_BODY_FILL = 0xe4dac7;

/**
 * 휠 스크롤을 **클립 Container** 에 건다 (결함 C-2).
 *
 * ⚠️ 마스크로 쓰이는 Graphics 는 Pixi 히트 테스트에서 통째로 제외된다(`isMask`) — 마스크에 건
 * `wheel` 리스너는 영영 안 불린다. 격납고 3패널(스탯·창고·인벤토리)이 전부 마스크에 걸어 두어
 * 휠이 죽어 있었다. 클립 Container 에 `hitArea` 를 주면 셀 사이 빈 자리에서도 잡히고, 셀 위에서는
 * 셀 → 클립으로 버블링돼 함께 성립한다(`scrollArea.ts`·방어 사령부 팝업의 확인된 관용구).
 *
 * `set` 은 클램프된 값을 받는다 — 호출자가 그 값으로 상태와 `content.y` 를 함께 갱신한다.
 */
export function attachWheelScroll(
  clip: Container,
  viewW: number,
  viewH: number,
  maxScroll: number,
  get: () => number,
  set: (v: number) => void,
): boolean {
  if (maxScroll <= 0) return false;
  clip.eventMode = 'static';
  clip.hitArea = new Rectangle(0, 0, viewW, viewH);
  clip.on('wheel', (e) => {
    set(Math.max(0, Math.min(maxScroll, get() + e.deltaY)));
  });
  return true;
}

// ---------------------------------------------------------------------------
// 인벤토리·창고 분류 보기(슬롯 필터 + 정렬 토글)
//
// 두 패널 모두 "아이템이 쌓이면 원하는 것을 못 찾는다"가 문제였다. 신규 자산 없이(카툰나무풍
// 어휘 = PixiButton) 필터 탭 한 줄 + 정렬 순환 버튼 하나로 해결한다. 실제 걸러내기·정렬은
// Pixi 없이 도는 순수 함수({@link arrangeItems})로 분리해 UI 없이 검증한다.
// ---------------------------------------------------------------------------

/** 슬롯 분류 탭 순서. 인덱스 0 = 전체(필터 없음), 나머지는 슬롯 종류. */
export const FILTER_KINDS: readonly (SlotKind | null)[] = [
  null,
  'main',
  'sub',
  'armor',
  'shield',
  'engine',
  'core',
  'module',
];

/** 정렬 모드. default = 획득순(배열 그대로), rarity = 희귀도 높은 순, slot = 슬롯 종류 순. */
export type ItemSortMode = 'default' | 'rarity' | 'slot';

/** 정렬 순환 순서(버튼을 누를 때마다 다음으로). */
export const SORT_MODES: readonly ItemSortMode[] = ['default', 'rarity', 'slot'];

const SORT_LABEL_KEY: Record<ItemSortMode, MessageKey> = {
  default: 'inv.sort.default',
  rarity: 'inv.sort.rarity',
  slot: 'inv.sort.slot',
};

/** 슬롯 정렬 기준 순서(장착 슬롯 나열 순 — 필터 탭 순서와 같다). */
const SLOT_ORDER: readonly SlotKind[] = ['main', 'sub', 'armor', 'shield', 'engine', 'core', 'module'];

/**
 * 필터·정렬을 적용해 **그리드에 그릴 셀 목록**을 만든다(순수 — 테스트 대상).
 *
 * 규율 둘:
 *  ① **원본 배열을 절대 건드리지 않는다.** 장착(`equip`)은 `inventory.indexOf(item)` 로 원본에서
 *     아이템을 빼므로 셀이 정렬된 사본을 들고 있어도 정확히 동작한다. 반대로 원본을 정렬해 버리면
 *     저장 파일의 순서가 화면 조작으로 바뀐다(= 표시 상태가 데이터로 새어나간다).
 *  ② 동률은 **획득순 유지**(안정 정렬) — 같은 등급끼리 매 렌더마다 순서가 흔들리면 클릭을 놓친다.
 *
 * 빈 칸 정책: 필터가 없으면 용량(cap)까지 빈 칸을 채워 "남은 자리"를 보여준다. 필터 중에는 남은
 * 자리라는 개념이 없으므로 마지막 행만 채워 그리드 모양을 유지한다.
 */
export function arrangeItems(
  source: readonly Item[],
  cap: number,
  filter: SlotKind | null,
  sort: ItemSortMode,
  cols: number,
): (Item | undefined)[] {
  const items = filter === null ? [...source] : source.filter((it) => it.slot === filter);
  if (sort !== 'default') {
    const rank =
      sort === 'rarity'
        ? (it: Item): number => -RARITY_CODE[it.rarity] // 유니크(3) → -3 이 앞
        : (it: Item): number => SLOT_ORDER.indexOf(it.slot);
    const decorated = items.map((it, i) => ({ it, i, k: rank(it) }));
    decorated.sort((a, b) => a.k - b.k || a.i - b.i);
    items.length = 0;
    for (const d of decorated) items.push(d.it);
  }
  const cells: (Item | undefined)[] = [...items];
  const perRow = Math.max(1, cols);
  const target =
    filter === null
      ? Math.max(cap, cells.length)
      : Math.ceil(cells.length / perRow) * perRow;
  while (cells.length < target) cells.push(undefined);
  return cells;
}

/** 스탯 행 정의: 라벨 · 값 · 1줄 설명(결정 7). */
interface StatRow {
  label: string;
  value: string;
  desc: string;
  color: number;
}

export class HangarScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private readonly tooltip = new PixiTooltip();
  /**
   * 현재 장착 장비 팝업(사용자 요청 2026-07-27) — 후보 팝업 옆에 나란히 선다. 별도 인스턴스인
   * 이유는 두 장이 **동시에** 떠 있어야 하기 때문이다(하나를 재사용하면 후보를 덮어쓴다).
   */
  private readonly equippedTip = new PixiTooltip();
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private onClose: (() => void) | null = null;
  private hint = '';
  private ui: UiTextures = {};
  /** 시네마틱 배경 자산(배경 1장). 없으면 절차적 폴백으로 내려간다. */
  private art: HangarTextures = {};
  /** 연출을 가진 것들 — `update(dt)` 가 매 프레임 이 둘만 돌린다. */
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  /** 기체 도크(쇼케이스 창 안의 접지·크래들·림 + 함선 스프라이트). */
  private dock: ShipDock | null = null;
  private stashScrollY = 0;
  private statsScrollY = 0;
  private inventoryScrollY = 0;
  /**
   * 창고 확장 재화 차감(`spend_currency`)의 서버 왕복이 진행 중인지 — 동시(재진입) 클릭 가드.
   * async `expandStash()` 는 비용을 첫 await 전에 `stashExpansions` 로 산정하므로, 왕복 중
   * 두 번째 클릭이 끼면 둘 다 같은(싼) 가격으로 과금돼 2차 확장을 언더페이한다(이 플래그로 차단).
   */
  private busy = false;
  /**
   * 분류 보기 상태(창고·인벤토리 각각). **화면 인스턴스 필드**라 wipe-then-rebuild 규약
   * (`render()` 가 자식을 통째로 지우고 다시 만든다)에서도 살아남는다 — 장착 한 번에 필터가
   * 풀리면 쓸 수 없는 기능이 된다.
   */
  private stashFilter: SlotKind | null = null;
  private stashSort: ItemSortMode = 'default';
  private invFilter: SlotKind | null = null;
  private invSort: ItemSortMode = 'default';
  /**
   * 챔피언(기체) 선택 화면. 격납고의 **하위 화면**이라 `show()` 가 아니라 `suspend()`/`resume()`
   * 로 자리를 주고받는다 — `show()` 로 되돌리면 미저장 장비 편집이 사라진다(defenseCommand 선례).
   */
  private readonly champion: ChampionSelectScreen;
  /**
   * 예비역 수호기 로스터(소멸 표면, ADR-0024). 챔피언 선택과 같은 하위 화면 규약
   * (`suspend()`/`resume()`)으로 자리를 주고받는다.
   */
  private readonly roster: GuardianRosterScreen;
  /**
   * 촉매 보관함(분해 표면, ADR-0029). 챔피언·로스터와 같은 하위 화면 규약(`suspend()`/`resume()`).
   */
  private readonly catalystArchive: CatalystArchiveScreen;

  constructor(profile: Profile, stage: Container, store: KeyValueStore | null = null) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.champion = new ChampionSelectScreen(profile, stage, store);
    this.roster = new GuardianRosterScreen(profile, stage, store);
    this.catalystArchive = new CatalystArchiveScreen(profile, stage, store);
    this.root.visible = false;
    this.root.eventMode = 'static';
    this.stage.addChild(this.root);
    this.root.addChild(this.equippedTip.container);
    this.root.addChild(this.tooltip.container);
    // UI 킷 텍스처를 비동기 로드; 완료 후 열려 있으면 실 아트로 다시 그린다(그 전엔 폴백).
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
    void loadHangarTextures().then((tex) => {
      this.art = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * 매 프레임 연출 진행(`main.ts` 렌더 루프). `dt` 는 **벽시계 초**다. 화면이 숨겨져 있으면
   * 아무것도 하지 않는다 — 격납고 밖에서는 비용이 0 이다(기지와 같은 규약).
   */
  update(dt: number): void {
    // ⚠️ 하위 화면은 **가시성 가드보다 먼저** 흘린다. 하위 화면이 떠 있는 동안 격납고 root 는
    // `suspend()` 로 숨겨져 있으므로, 가드 뒤에 두면 촉매 보관함의 배경 패럴랙스·티끌·패널
    // 광택이 통째로 멈춘다(자기 안에서 다시 가시성으로 걸러내므로 여기서 조건을 따질 필요 없다).
    this.catalystArchive.update(dt);
    if (!this.root.visible) return;
    this.backdrop?.update(dt);
    for (const p of this.panels) p.update(dt);
    this.dock?.update(dt);
  }

  /** 격납고를 연다. `profile` 재바인딩으로 항상 라이브 상태를 반영한다. */
  show(profile: Profile, onClose: () => void): void {
    this.profile = profile;
    this.onClose = onClose;
    this.hint = '';
    this.render();
    this.root.visible = true;
    // 툴팁 두 장은 최상위로(후보를 마지막에 = 겹칠 때 위로).
    this.root.setChildIndex(this.equippedTip.container, this.root.children.length - 1);
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
    // DOM HUD(HP/LV, 좌하단)는 런 전용이라 캔버스 격납고 위에 떠 보인다 — 표시 중 숨긴다.
    // (기존 메뉴 화면들은 전면 DOM 오버레이라 자연히 가려졌던 것을 캔버스 화면에서 명시 처리.)
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = 'hidden';
  }

  hide(): void {
    this.root.visible = false;
    this.hideTips();
    this.onClose = null;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = '';
  }

  /** 다른 캔버스 화면(챔피언 선택)에 자리를 내주고 잠시 감춘다 — **상태는 그대로 남는다**. */
  suspend(): void {
    this.root.visible = false;
    this.hideTips();
  }

  resume(): void {
    this.root.visible = true;
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
    this.render();
  }

  /**
   * 챔피언 선택으로 내려간다. 확정되면 활성 기체가 통째로 바뀌므로(퇴역 = 세대 교체) 돌아올 때
   * `render()` 가 새 기체를 읽는다 — `resume()` 이 그 일을 한다.
   */
  private openChampionSelect(): void {
    this.suspend();
    this.champion.show(this.profile, {
      onClose: () => this.resume(),
    });
  }

  /**
   * 예비역 수호기 로스터로 내려간다(소멸 표면). 소멸은 profile.guardians·stash·lineage 를
   * 변형하므로 돌아올 때 `resume()` 의 `render()` 가 갱신된 창고를 다시 읽는다.
   */
  private openGuardianRoster(): void {
    this.suspend();
    this.roster.show(this.profile, {
      onClose: () => this.resume(),
    });
  }

  /**
   * 촉매 보관함으로 내려간다(분해 표면). 분해는 서버 보유·재화를 변형하므로 돌아올 때 `resume()`
   * 의 `render()` 가 갱신된 재화 미러를 다시 읽는다(보유는 보관함이 서버에서 재조회).
   */
  private openCatalystArchive(): void {
    this.suspend();
    this.catalystArchive.show(this.profile, {
      onClose: () => this.resume(),
    });
  }

  private persist(): void {
    // ⚠️ `this.store` 가 null 이면 **기본 인자가 적용되지 않는다** — `saveProfile` 은 명시적
    // null 을 "저장하지 마라" 로 읽고 즉시 return 한다. main.ts 는 store 없이 이 화면을 만들기
    // 때문에(= null), 그대로 넘기면 장비 장착이 통째로 no-op 이 된다. `?? undefined` 로 넘겨야
    // localStorage 기본 store 가 잡힌다(defenseCommand/modulesView 와 같은 관용구).
    saveProfile(this.profile, this.store ?? undefined);
  }

  // --- 장착 / 해제 (InventoryOverlay 와 동일 규칙) -------------------------

  private equip(item: Item): void {
    const ship = activeShip(this.profile);
    if (!canEquip(ship.level, item)) return; // 요구 레벨 미달 — no-op(에러·토스트 없음)
    const kind = item.slot;
    let target: EquipSlotId;
    if (kind === 'module') {
      target =
        ship.equipped.module0 === undefined
          ? 'module0'
          : ship.equipped.module1 === undefined
            ? 'module1'
            : 'module0';
    } else {
      target = kind as EquipSlotId;
    }
    // 같은 유니크를 두 칸에 꽂는 것을 막는다(`src/items/uniqueEquip.ts`). `uniqueMask` 는 비트 OR 라
    // 두 번째 사본의 유니크 효과가 통째로 무효가 되고 그 칸이 낭비된다 — 어픽스는 정상 합산되므로
    // 화면상 아무 경고 없이 조용히 손해만 본다. 요구 레벨 게이트와 달리 **무음 거부를 하지 않는다**:
    // 잠김 셀은 dim + Lv 배지로 이유가 보이지만 중복 유니크는 겉모습이 멀쩡해서, 아무 반응이 없으면
    // 클릭이 먹통이라는 버그로 신고된다(요구 레벨 게이트 도입 때의 교훈).
    const dupSlot = duplicateUniqueSlot(ship.equipped, item, target);
    if (dupSlot !== null) {
      this.hint = t('inv.err.duplicateUnique', { name: this.itemName(item) });
      this.render();
      return;
    }
    const idx = this.profile.inventory.indexOf(item);
    if (idx >= 0) this.profile.inventory.splice(idx, 1);
    const displaced = ship.equipped[target];
    if (displaced !== undefined) this.profile.inventory.push(displaced);
    ship.equipped[target] = item;
    this.persist();
    this.render();
  }

  private unequip(id: EquipSlotId): void {
    const ship = activeShip(this.profile);
    const item = ship.equipped[id];
    if (item === undefined) return;
    if (this.profile.inventory.length >= INVENTORY_CAP) {
      this.hint = t('inv.err.full');
      this.render();
      return;
    }
    delete ship.equipped[id];
    this.profile.inventory.push(item);
    this.persist();
    this.render();
  }

  // --- 창고 ↔ 인벤토리 이동 (사용자 요청 2026-07-27) ------------------------

  /**
   * 보관함 → 인벤토리. 보관함 장비는 **장착 후보인데 꺼낼 방법이 없었다** — 런 정산이 인벤토리를
   * 채운 뒤 넘친 것을 보관함에 넣기만 하고, 그 뒤로는 화면에서 되돌릴 수단이 아예 없었다.
   *
   * 용량 초과는 조용히 실패하지 않고 힌트로 말한다(분해와 달리 되돌릴 수 있는 조작이라, 막힌
   * 이유를 알려 주면 사용자가 자리를 만들고 다시 시도할 수 있다).
   */
  private moveToInventory(item: Item): void {
    if (this.profile.inventory.length >= INVENTORY_CAP) {
      this.hint = t('inv.err.full');
      this.render();
      return;
    }
    const idx = this.profile.stash.indexOf(item);
    if (idx < 0) return;
    this.profile.stash.splice(idx, 1);
    this.profile.inventory.push(item);
    this.hint = t('inv.moved.toInventory', { name: this.itemName(item) });
    this.persist();
    this.render();
  }

  /** 인벤토리 → 보관함. 용량은 확장 수에 따라 달라지므로 매번 계산한다. */
  private moveToStash(item: Item): void {
    if (this.profile.stash.length >= stashCapacity(this.profile.stashExpansions)) {
      this.hint = t('inv.err.stashFull');
      this.render();
      return;
    }
    const idx = this.profile.inventory.indexOf(item);
    if (idx < 0) return;
    this.profile.inventory.splice(idx, 1);
    this.profile.stash.push(item);
    this.hint = t('inv.moved.toStash', { name: this.itemName(item) });
    this.persist();
    this.render();
  }

  // --- 분해 / 창고 ---------------------------------------------------------

  /**
   * 일괄 분해 — **화면에 보이는 것만** 지운다.
   *
   * ⚠️ 슬롯 분류 필터가 생기기 전에는 "인벤토리 전체 = 보이는 것" 이라 등급만 보면 됐다. 필터가
   * 생긴 뒤로는 그 전제가 깨진다: `주무기` 탭을 켜서 무기 3개만 보이는 상태에서 하급 일괄 분해를
   * 누르면, 등급만 걸렀을 때 **화면에 없던 방어구까지 함께 분해된다**. 분해는 되돌릴 수 없으므로
   * 활성 필터를 반드시 함께 적용해 "보이는 것 = 대상" 을 유지한다(그리드가 쓰는 `arrangeItems`
   * 의 필터 조건과 같은 술어여야 한다).
   *
   * `source` 로 인벤토리/보관함을 가른다(사용자 요청 2026-07-27 — 보관함에도 분해 버튼).
   * **각 목록은 자기 패널의 필터를 쓴다** — 보관함 분해가 인벤토리 탭 상태를 보면 "보이는 것 =
   * 대상" 규율이 그 자리에서 깨진다.
   */
  private async salvageByRarities(
    source: 'inventory' | 'stash',
    rarities: readonly Rarity[],
  ): Promise<void> {
    const set = new Set(rarities);
    const slot = source === 'stash' ? this.stashFilter : this.invFilter;
    const pool = source === 'stash' ? this.profile.stash : this.profile.inventory;
    const targets = pool.filter(
      (it) => set.has(it.rarity) && (slot === null || it.slot === slot),
    );
    if (targets.length === 0) {
      this.hint = t('inv.err.noSalvage');
      this.render();
      return;
    }
    const mineralFindMult = this.computeStats().worldMods.mineralFindMult;
    // salvageItems 는 아이템만 제거하고 획득 재화를 반환한다(미러 미가산 — ADR-0027). 재화 지급은:
    //  온라인 → grant_currency(source='salvage')로 서버에 가산하고 미러를 서버 잔액으로 갱신.
    //  미설정/전송실패 → 로컬 미러에 가산(단일플레이 보존, 서버 있으면 다음 fetchProfile 이 정정).
    const y = salvageItems(this.profile, targets, mineralFindMult);
    const g = await grantCurrencyToServer(y.credits, y.minerals, 'salvage');
    if (g.status === 'applied') {
      this.profile.credits = g.creditsLeft;
      this.profile.minerals = g.mineralsLeft;
    } else {
      this.profile.credits += y.credits;
      this.profile.minerals += y.minerals;
    }
    this.hint = t('inv.salvageDone', { n: targets.length, credits: y.credits, minerals: y.minerals });
    this.persist();
    this.render();
  }

  private async expandStash(): Promise<void> {
    // 동시(재진입) 클릭 가드: 서버 왕복 중 두 번째 클릭이 2차 확장을 언더페이하지 못하게 막는다.
    if (this.busy) return;
    if (this.profile.stashExpansions >= MAX_STASH_EXPANSIONS) {
      this.hint = t('inv.stashMax');
      this.render();
      return;
    }
    const cost = stashExpansionCost(this.profile.stashExpansions);
    if (!canAfford(this.profile.credits, cost)) {
      this.hint = t('inv.err.noCredits', { n: cost });
      this.render();
      return;
    }
    // 네트워크 창을 잠근다 — 비용이 첫 await 전에 산정되므로, 왕복 중 재진입을 막지 않으면
    // 두 클릭이 같은(싼) 가격으로 과금돼 2차 확장을 언더페이한다.
    this.busy = true;
    try {
      // 재화 서버 권위(ADR-0027): 온라인이면 spend_currency 로 차감을 확정하고(ok 일 때만 확장),
      // 미설정이면 기존 로컬 차감. 잔액 부족·오프라인(rejected)이면 확장하지 않는다(위조 차단).
      const res = await spendCurrencyOnServer(cost, 0, 'stash');
      if (res.status === 'ok') {
        this.profile.credits = res.creditsLeft;
        this.profile.minerals = res.mineralsLeft;
      } else if (res.status === 'unconfigured') {
        this.profile.credits -= cost;
      } else if (res.reason === 'insufficient') {
        // 서버 원장이 판정해 거부했다. 로컬 미러(this.profile.credits)는 하네스 치트·오프라인
        // 가산으로 부풀어 있을 수 있으므로 **서버 잔액을 그대로 보여준다** — "크레딧이 부족합니다"
        // 한 줄만 내면 11201 크레딧을 든 유저에게 거짓말이 된다(하네스 오탐의 정체).
        this.hint = t('spend.err.rejectedCredits', { n: cost, have: res.creditsLeft });
        this.render();
        return;
      } else {
        // 판정 자체를 못 받았다(오프라인·네트워크 오류). 차감도 확장도 없다.
        this.hint = t('spend.err.unavailable');
        this.render();
        return;
      }
      this.profile.stashExpansions++;
      this.hint = t('inv.stashExpanded');
      this.persist();
      this.render();
    } finally {
      this.busy = false;
    }
  }

  /**
   * 격납고 미리보기가 쓰는 파생 스탯. **런과 같은 입력 4종**(장착 · 스킬 투자 · 계보 bp ·
   * 기체 타입)을 전부 넘긴다.
   *
   * ⚠️ 이전 구현은 `computeLoadoutStats(this.equippedItems())` 뿐이라 투자·계보·기체 타입이
   * 통째로 빠져 있었다 — 유저가 격납고에서 보는 수치와 실제 런 수치가 갈렸고, 브루저의
   * HP +25% 같은 섀시 보정은 화면 어디에도 나타나지 않았다(M8 통합 게이트 findings ④).
   */
  private computeStats(): ReturnType<typeof computeLoadoutStats> {
    const ship = activeShip(this.profile);
    return computeLoadoutStats(
      this.equippedItems(),
      ship.skillInvest,
      shipBonusBp(this.profile.lineage),
      ship.typeId,
    );
  }

  private equippedItems(): Item[] {
    const ship = activeShip(this.profile);
    const out: Item[] = [];
    for (const id of EQUIP_SLOTS) {
      const it = ship.equipped[id];
      if (it !== undefined) out.push(it);
    }
    return out;
  }

  private equippedFor(kind: SlotKind): Item | undefined {
    const ship = activeShip(this.profile);
    if (kind === 'module') return ship.equipped.module0 ?? ship.equipped.module1;
    return ship.equipped[kind as EquipSlotId];
  }

  private itemName(item: Item): string {
    return itemDisplayName(item);
  }

  // --- 툴팁 ----------------------------------------------------------------

  /**
   * 후보 툴팁 옆에 **현재 장착 장비 팝업**을 나란히 세운다(사용자 요청 2026-07-27).
   *
   * 증감 블록만으로는 "무엇에서 무엇으로" 가 안 보인다 — 델타는 차이만 말하고 현재 장비의 실제
   * 어픽스·요구 레벨·이름은 여전히 격납고 슬롯을 따로 hover 해야 알 수 있었다. 두 장을 나란히
   * 두면 그 왕복이 사라진다(디아블로류 관용구).
   *
   * 배치는 후보 팝업의 **왼쪽**이 기본이다 — 후보는 포인터 오른쪽·아래에 붙으므로, 장착 팝업을
   * 오른쪽에 두면 화면 밖으로 밀리기 쉽다. 왼쪽 공간이 부족하면 오른쪽으로 뒤집고, 그것도 안 되면
   * 화면 안으로 클램프한다.
   */
  private showEquippedTip(equipped: Item): void {
    const ship = activeShip(this.profile);
    const req = requiredLevel(equipped);
    const met = ship.level >= req;
    // 좌표는 아래에서 후보 팝업 기준으로 다시 잡는다 — 여기서는 내용만 세운다(0,0 임시).
    this.equippedTip.show(
      {
        title: this.itemName(equipped),
        titleColor: RARITY_COLOR_NUM[equipped.rarity],
        subtitle: t('inv.tip.equippedNow'),
        reqLine: { text: t('item.reqLevel', { n: req }), color: met ? 0x8896b8 : 0xff5a5a },
        lines: affixLines(equipped.affixes),
      },
      0,
      0,
      RARITY_COLOR_NUM[equipped.rarity],
    );
  }

  /** 두 팝업을 포인터 기준으로 배치한다(후보=포인터 옆, 장착=후보 왼쪽). */
  private placeTips(designX: number, designY: number): void {
    const cand = this.tooltip.container;
    const eq = this.equippedTip.container;
    const PAD = 14;
    const candW = cand.width;
    const candH = cand.height;
    let cx = designX + PAD;
    const cy = Math.max(0, Math.min(designY + PAD, DESIGN_HEIGHT - candH));

    if (!eq.visible) {
      cand.position.set(Math.max(0, Math.min(cx, DESIGN_WIDTH - candW)), cy);
      return;
    }

    const eqW = eq.width;
    const GAP = 8;
    // 두 장을 합친 폭이 포인터 오른쪽에 안 들어가면 통째로 왼쪽으로 넘긴다.
    if (cx + candW > DESIGN_WIDTH) cx = designX - candW - PAD;
    cx = Math.max(eqW + GAP, Math.min(cx, DESIGN_WIDTH - candW));
    let ex = cx - GAP - eqW;
    if (ex < 0) ex = Math.min(cx + candW + GAP, DESIGN_WIDTH - eqW); // 왼쪽이 없으면 오른쪽으로
    cand.position.set(cx, cy);
    // 장착 팝업은 후보와 위쪽을 맞춘다(두 장을 한 덩어리로 읽히게).
    eq.position.set(Math.max(0, ex), Math.max(0, Math.min(cy, DESIGN_HEIGHT - eq.height)));
  }

  /** 두 팝업을 함께 감춘다(셀 밖으로 나갈 때). */
  private hideTips(): void {
    this.tooltip.hide();
    this.equippedTip.hide();
  }

  private showTip(item: Item, globalX: number, globalY: number, compareTo?: Item): void {
    // 어픽스 = 제목 줄(이름 · 표시명 +수치) + 설명 줄. raw StatKey 노출을 없앤다(2026-07-26 지적).
    const lines = affixLines(item.affixes);
    // 장착 장비 대비 스탯 증감(사용자 요청 2026-07-27). 어픽스 **개수**만 알려 주던 한 줄로는
    // 좋고 나쁨을 판단할 수 없었다 — 무슨 수치가 얼마나 오르내리는지를 색으로 보여준다.
    const cmp = compareTo !== undefined ? compareLines(item, compareTo) : [];
    // 구 요약 줄(`장착 중: 엔진 (어픽스 3개)`)은 증감 블록이 있으면 생략한다 — 같은 자리에서
    // 같은 것을 두 번 말하게 되고, 개수는 증감 앞에서 판단에 기여하지 않는다(실측 중복).
    const compare =
      cmp.length === 0 && compareTo !== undefined && compareTo !== item
        ? t('inv.tip.compare', { name: this.itemName(compareTo), n: compareTo.affixes.length })
        : undefined;
    // 요구 레벨 줄(AC9): 미달이면 빨강, 충족이면 무채색. 미달 아이템도 툴팁·비교는 정상 노출.
    const ship = activeShip(this.profile);
    const req = requiredLevel(item);
    const met = ship.level >= req;
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.tooltip.show(
      {
        title: this.itemName(item),
        titleColor: RARITY_COLOR_NUM[item.rarity],
        subtitle: `${slotLabel(item.slot)} · ${t(`item.rarity.${item.rarity}` as MessageKey)}`,
        reqLine: { text: t('item.reqLevel', { n: req }), color: met ? 0x8896b8 : 0xff5a5a },
        lines,
        compare,
        compareLines: cmp,
      },
      p.x,
      p.y,
      RARITY_COLOR_NUM[item.rarity],
    );
    // 현재 장착 장비 팝업을 함께 띄운다 — 비교 대상이 있고, 그것이 후보 자신이 아닐 때만.
    if (compareTo !== undefined && compareTo.id !== item.id) this.showEquippedTip(compareTo);
    else this.equippedTip.hide();
    this.placeTips(p.x, p.y);
    // 두 팝업 모두 맨 앞으로(패널 재빌드로 뒤에 깔리지 않게). 후보를 마지막에 올려 겹칠 때 위로.
    this.root.setChildIndex(this.equippedTip.container, this.root.children.length - 1);
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  private moveTip(globalX: number, globalY: number): void {
    if (!this.tooltip.container.visible) return;
    const p = this.root.toLocal({ x: globalX, y: globalY });
    this.placeTips(p.x, p.y);
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    // 연출 참조를 먼저 끊는다 — destroy 된 컨테이너를 update 가 만지면 안 된다.
    this.backdrop?.destroy();
    this.backdrop = null;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.dock?.destroy();
    this.dock = null;
    // 툴팁 컨테이너는 유지하고 나머지를 지운다.
    for (const child of [...this.root.children]) {
      if (child !== this.tooltip.container && child !== this.equippedTip.container) {
        this.root.removeChild(child);
        child.destroy({ children: true });
      }
    }
    this.hideTips();

    // 바닥 — 배경 자산이 없거나 실패해도 화면이 비지 않게(불투명, 뒤 아레나를 가린다).
    // 이벤트도 여기서 막는다.
    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static';
    this.root.addChildAt(bg, 0);

    // 배경 — 창 좌표는 **레이아웃에서 파생해** 넘긴다(하드코딩 금지, `showcaseWindowRect`).
    // ⚠️ Lane A 인계 제약 ③: `view` 는 root 맨 뒤에 그대로 붙이고 스케일·이동을 걸지 마라
    // (공기 마스크가 `view` 자식이라 어긋난다).
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [showcaseWindowRect()],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    // ⚠️ **위 행 → 아래 행 순서로 붙인다**(Lane B 인계 제약 ①). 패널 접지 그림자는 아래로
    // 59px(확산 spread 48 + offset 11) 번지는데 행 간격은 20 이라, 순서가 뒤집히면 위 행의
    // 그림자가 아래 행 패널 **위에** 얹혀 얼룩으로 읽힌다.
    this.renderStatsPanel();
    this.renderShowcasePanel();
    this.renderStashPanel();
    this.renderInventoryPanel();
    // 헤더는 패널보다 뒤에 붙는다 — 헤더 밴드는 패널 위쪽 빈 띠라 겹치지 않지만, 잠금 사유
    // 문구처럼 버튼 아래로 흐르는 글자가 패널 그림자에 묻히지 않게 한다.
    this.renderTitleBar();
    this.renderHint();

    this.root.setChildIndex(this.equippedTip.container, this.root.children.length - 1);
    this.root.setChildIndex(this.tooltip.container, this.root.children.length - 1);
  }

  /**
   * 석재 패널 한 장을 세우고 화면 좌표와 콘텐츠 상자를 함께 돌려준다.
   *
   * `box` 는 **패널 로컬**이라 화면 좌표로 쓰려면 매번 `px + box.x` 를 더해야 한다 — 그 덧셈을
   * 호출부마다 반복하면 한 곳만 빠뜨려도 조용히 어긋나므로, 여기서 화면 좌표로 풀어 준다.
   */
  private addPanel(
    px: number,
    py: number,
    pw: number,
    ph: number,
    variant: 'slab' | 'window',
    title: string,
  ): { x: number; y: number; w: number; h: number; right: number; bottom: number } {
    // ⚠️ `screenX`/`screenY` 를 **반드시 넘긴다**(Lane B 인계 제약 ③). 안 넘기면 같은 치수의
    // 패널끼리 조명·랜드마크 시드가 같아져 M6(위치별 조명)·C1(비반복 랜드마크)이 조용히
    // 무효가 된다 — 화면은 정상적으로 서고 테스트도 통과하므로 눈으로만 잡히는 유형이다.
    // 램프 위치는 헤더 밴드 중앙 상단 — 배경 원화에서 실제로 빛이 오는 대역이다.
    const panel = makeCinematicPanel({
      width: pw,
      height: ph,
      variant,
      title,
      screenX: px,
      screenY: py,
      lightOrigin: { x: DESIGN_WIDTH / 2, y: 60 },
    });
    panel.container.position.set(px, py);
    this.root.addChild(panel.container);
    this.panels.push(panel);
    const b = panel.box;
    return {
      x: px + b.x,
      y: py + b.y,
      w: b.w,
      h: b.h,
      right: px + b.right,
      bottom: py + b.bottom,
    };
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
      // ⚠️ 텍스처는 128×64 로 1:1 구워져 있다 — `cap: 32` 여야 모서리가 안 뭉개진다
      // (Lane C 인계 제약 ①).
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
   * 헤더 밴드(y 0..{@link HEADER_H}) — 각인 제목 · 재화 칩 2 · 진입 버튼 3 · 닫기.
   *
   * ⚠️ **여섯 요소가 전부 같은 세로 띠**(y {@link HEAD_Y}..{@link HEAD_Y}+{@link HEAD_H})를
   * 쓴다. 이 화면은 헤더가 겹치는 결함을 이미 겪었으므로(하단 패널의 "겹치면 안 되는 세로 띠
   * 4줄" 주석과 같은 유형), 세로로 쌓지 않고 **가로로만** 배치해 겹침을 구조적으로 없앤다.
   * 좌→우: [촉매][크레딧][광물] … 제목(중앙) … [예비역][기체 교체][닫기].
   */
  private renderTitleBar(): void {
    // ⚠️ **각인 석재 인방은 사용자 판단으로 제거됐다**(2026-08-02).
    //
    // AAA 비평 M7 은 헤더 밴드의 디테일 밀도(|HF| 1.30~1.56)가 창 키아트(17.15)의 1/11~1/13
    // 이라며 "배경 노출 구간"을 "건축 요소"로 재정의하라고 요구했고, 인방은 그 지표를 실제로
    // 달성했다(|HF| 상단 37.38 · 하단 26.64). 그런데 화면을 본 사용자 판단은 **헤더가 비어
    // 있는 쪽**이었다 — 판정 기준은 스크린샷이고 비평 수치는 대리 지표다(계약 §6-6).
    //
    // 그래서 헤더 밴드는 다시 **배경이 그대로 보이는 띠**다. 배경 모듈이 이 대역을 중간 세기로
    // 누르고 있으므로(창 밖 ×0.30 vs 헤더 ×0.46) 제목·칩 글자 대비는 인방 없이도 성립한다
    // (인방 도입 전 실측 제목 8.08:1 · 칩 5.25:1, 요구 4.5:1).
    //
    // 되살릴 일이 생기면 `hangarChrome.makeHangarLintel(w, h, niches)` 가 그대로 있다 —
    // 세 번째 인자는 재화 칩이 앉을 감실이고, 감실 바닥 밝기는 칩 글자 대비 4.5:1 하한에서
    // 역산돼 있다(`NICHE_FLOOR` 헤더).
    const chipW = 190;
    const catalystX = 132;
    const actW = 128;
    const headGap = 14;
    const creditsX = catalystX + actW + headGap;

    const title = makeHangarTitle(t('hangar.title'));
    title.position.set(DESIGN_WIDTH / 2, HEAD_Y - 4);
    this.root.addChild(title);

    // 촉매 보관함 진입 — 좌상단 꼭짓점은 **설정 톱니**(main.ts SettingsScreen)가 쓰는 전 화면
    // 공용 자리다: 톱니는 격납고보다 나중에 stage 최상위로 그려져 항상 위에 얹히므로, 겹치면
    // 촉매 버튼이 통째로 클릭 불가가 된다(하네스 실측: 톱니 CSS (16,13,51,51) ↔ 촉매 CSS
    // (16,12,85,35) — 거의 완전 겹침). 톱니의 디자인 스페이스 점유는 대략 x 24..101 ·
    // y 20..96 이고, 여유를 둔 예약 밴드는 x<120 · y<120 이다. 그래서 x 를 밴드 밖으로 민다.
    const CATALYST_X = catalystX;
    const catBtn = this.chromeButton({
      tone: 'stone',
      width: actW,
      height: HEAD_H,
      fontSize: 15,
      label: t('catalyst.manage.open'),
      onClick: () => this.openCatalystArchive(),
    });
    catBtn.container.position.set(CATALYST_X, HEAD_Y);
    this.root.addChild(catBtn.container);

    const credits = makeHangarChip(
      chipW,
      HEAD_H,
      String(this.profile.credits),
      this.ui['ui_icon_coin.png'] ?? undefined,
      'gold',
    );
    credits.position.set(creditsX, HEAD_Y);
    this.root.addChild(credits);

    const minerals = makeHangarChip(
      chipW,
      HEAD_H,
      String(this.profile.minerals),
      this.ui['ui_icon_crystal.png'] ?? undefined,
      'teal',
    );
    minerals.position.set(creditsX + chipW + headGap, HEAD_Y);
    this.root.addChild(minerals);

    // 우측: [예비역][기체 교체][닫기]. 닫기부터 오른쪽 끝에 붙이고 왼쪽으로 쌓는다.
    const closeW = 56;
    const closeX = DESIGN_WIDTH - EDGE_X - closeW;
    const close = this.chromeButton({
      tone: 'stone',
      width: closeW,
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
    close.container.position.set(closeX, HEAD_Y);
    this.root.addChild(close.container);

    const swapX = closeX - headGap - actW;
    // 기체 교체 = 퇴역·세대 교체다. 만렙(LEVEL_CAP) 전에는 성장 여지를 남긴 기체를 버리는 셈이라
    // 잠근다. 여기는 **버튼 게이트**일 뿐이고 실제 강제는 championSelect/guardianLifecycle 몫이다.
    const canSwap = activeShip(this.profile).level >= LEVEL_CAP;
    const swap = this.chromeButton({
      tone: 'stone',
      width: actW,
      height: HEAD_H,
      fontSize: 15,
      label: tShipKey('hangar.act.swapShip', 'Change Ship'),
      // 비활성 버튼은 클릭이 안 오지만, 게이트가 두 곳에서 어긋나도 진입만은 막히도록 한 번 더 본다.
      onClick: () => {
        if (!canSwap) {
          this.hint = t('hangar.err.swapNeedMaxLevel', {
            n: LEVEL_CAP,
            lv: activeShip(this.profile).level,
          });
          this.render();
          return;
        }
        this.openChampionSelect();
      },
    });
    swap.container.position.set(swapX, HEAD_Y);
    this.root.addChild(swap.container);
    if (!canSwap) {
      swap.setEnabled(false);
      // 비활성 버튼은 hover 이벤트도 죽으므로(툴팁 불가) 잠긴 이유를 버튼 바로 아래 한 줄로
      // 남긴다. 폰트 14 ≈ 18px 이라 y 82..100 을 쓰고 헤더 밴드(104) 안에서 끝난다.
      const why = new Text({
        resolution: 2,
        text: t('hangar.err.swapNeedMaxLevel', { n: LEVEL_CAP, lv: activeShip(this.profile).level }),
        style: { fontFamily: UI_FONT, fontSize: 14, fill: COLOR.muted, dropShadow: TEXT_SHADOW },
      });
      why.anchor.set(1, 0);
      why.position.set(swapX + actW, HEAD_Y + HEAD_H + 4);
      this.root.addChild(why);
    }

    const guardians = this.chromeButton({
      tone: 'stone',
      width: actW,
      height: HEAD_H,
      fontSize: 15,
      label: tShipKey('hangar.act.guardians', 'Guardians'),
      onClick: () => this.openGuardianRoster(),
    });
    guardians.container.position.set(swapX - headGap - actW, HEAD_Y);
    this.root.addChild(guardians.container);
  }

  private statRows(): StatRow[] {
    const { loadout, worldMods } = this.computeStats();
    const rows: StatRow[] = [
      // ⚠️ 폴백을 `item.weapon.0`(발칸)으로 두면 표가 낡았을 때 **다른 무기를 발칸이라고 적는다**.
      // 실제로 표가 3종에서 멈춰 빔·미사일 장착이 "발칸"으로 표시됐다(2026-07-27). weaponLabel 은
      // 범위 밖을 `?` 로 낸다 — 조용한 오표기보다 눈에 띄는 물음표가 낫다.
      { label: t('inv.stat.weapon'), value: weaponLabel(loadout.weaponType), desc: t('hangar.desc.weapon'), color: COLOR.gold },
      { label: t('inv.stat.damage'), value: `×${loadout.damageMult.toFixed(2)}`, desc: t('hangar.desc.damage'), color: COLOR.gold },
      { label: t('inv.stat.fireRate'), value: `×${(1 / loadout.fireRateMult).toFixed(2)}`, desc: t('hangar.desc.fireRate'), color: COLOR.gold },
      { label: t('inv.stat.bullets'), value: `+${loadout.bulletCountAdd}`, desc: t('hangar.desc.bullets'), color: COLOR.gold },
      { label: t('inv.stat.pierce'), value: `+${loadout.pierceAdd}`, desc: t('hangar.desc.pierce'), color: COLOR.gold },
      { label: t('inv.stat.moveSpeed'), value: `×${loadout.moveSpeedMult.toFixed(2)}`, desc: t('hangar.desc.moveSpeed'), color: COLOR.gold },
      // ⚠️ `maxHpAdd` 는 배율 합산의 결과라 부동소수점 꼬리가 남는다 — 그대로 찍으면
      // `+424.35200000000003` 이 화면에 나온다(실화면에서 잡았다). 다른 행은 전부 `toFixed`
      // 를 거치는데 이 행만 정수라고 가정하고 생으로 넣고 있었다. HP 는 1 미만이 의미 없다.
      { label: t('inv.stat.hp'), value: `+${Math.round(loadout.maxHpAdd)}`, desc: t('hangar.desc.hp'), color: COLOR.gold },
      { label: t('inv.stat.magnet'), value: `×${loadout.magnetMult.toFixed(2)}`, desc: t('hangar.desc.magnet'), color: COLOR.gold },
      { label: t('inv.stat.xp'), value: `×${loadout.xpMult.toFixed(2)}`, desc: t('hangar.desc.xp'), color: COLOR.gold },
      { label: t('inv.stat.mineralFind'), value: `×${worldMods.mineralFindMult.toFixed(2)}`, desc: t('hangar.desc.mineralFind'), color: COLOR.gold },
    ];
    // 원소 강도(0 이면 숨김) — 원소색.
    if (loadout.fireDmg > 0)
      rows.push({ label: t('hangar.stat.element.fire'), value: `+${loadout.fireDmg}`, desc: t('hangar.desc.element.fire'), color: 0xff783c });
    if (loadout.coldSlow > 0)
      rows.push({ label: t('hangar.stat.element.cold'), value: `+${loadout.coldSlow}`, desc: t('hangar.desc.element.cold'), color: 0x6ebeff });
    if (loadout.lightning > 0)
      rows.push({ label: t('hangar.stat.element.lightning'), value: `+${loadout.lightning}`, desc: t('hangar.desc.element.lightning'), color: 0xffe033 });
    // 계보 기체 보너스(0 이면 숨김).
    const bp = shipBonusBp(this.profile.lineage);
    if (bp > 0)
      rows.push({ label: t('hangar.stat.lineage'), value: `+${(bp / 100).toFixed(1)}%`, desc: t('hangar.desc.lineage'), color: 0x8affc0 });
    // 유니크 효과(장착 유니크별 1행). 게이트(equip)가 생기기 **전에 저장된 세이브**에는 같은
    // 유니크가 두 칸에 남아 있을 수 있다 — 자동 해제 대신 유지가 정책이므로(uniqueEquip.ts
    // LEGACY_DUPLICATE_POLICY), 무효가 된 사본을 여기서 명시해 사용자가 스스로 갈아끼우게 한다.
    const equippedItems = this.equippedItems();
    const redundant = redundantUniqueIndices(equippedItems);
    for (let i = 0; i < equippedItems.length; i++) {
      const it = equippedItems[i];
      if (it?.uniqueId === undefined) continue;
      const def = UNIQUE_REGISTRY.get(it.uniqueId);
      if (def !== undefined)
        rows.push({
          label: t('hangar.stat.unique'),
          value: redundant.has(i) ? t('hangar.stat.uniqueDup', { name: def.name }) : def.name,
          desc: '',
          color: redundant.has(i) ? COLOR.muted : RARITY_COLOR_NUM.unique,
        });
    }
    return rows;
  }

  private renderStatsPanel(): void {
    // 제목은 패널의 **각인 띠**가 그린다 — 예전처럼 콘텐츠 상자 안에 Text 로 얹으면 첫 행과
    // 같은 세로 띠를 다투게 되고, 그 자리는 이미 결함 이력이 있다.
    const box = this.addPanel(
      COL_L_X,
      ROW_T_Y,
      COL_L_W,
      ROW_T_H,
      'slab',
      t('hangar.panel.stats'),
    );

    // 스크롤 가능한 스탯 콘텐츠(마스크 클립 + 휠). 스크롤바 시각 요소 없음. 콘텐츠 top 을
    // 제목 띠 바로 아래로 당기고 행 간격/폰트를 줄여 기본 10행+설명이 스크롤 없이 최대한
    // 보이도록 한다(넘치는 원소/계보/유니크 조건부 행만 스크롤로).
    const contentX = box.x;
    const contentTop = box.y;
    const contentW = box.w;
    // 마스크 하한 = 콘텐츠 상자 바닥 — 프레임 침범도 붙는 것도 막는다.
    const STAT_STEP = 48;
    const contentH = Math.floor(box.h / STAT_STEP) * STAT_STEP; // 행 단위 클램프

    const clip = new Container();
    clip.position.set(contentX, contentTop);
    this.root.addChild(clip);
    const mask = new Graphics();
    mask.rect(contentX, contentTop, contentW, contentH).fill({ color: 0xffffff });
    this.root.addChild(mask);
    clip.mask = mask;

    const content = new Container();
    clip.addChild(content);

    const rows = this.statRows();
    const step = STAT_STEP;
    let y = 0;
    for (const r of rows) {
      const name = new Text({ resolution: 2,
        text: r.label,
        style: { fontFamily: UI_FONT, fontSize: 24, fontWeight: '700', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      name.position.set(0, y);
      content.addChild(name);
      const val = new Text({ resolution: 2,
        text: r.value,
        style: { fontFamily: UI_FONT, fontSize: 24, fontWeight: '800', fill: r.color, dropShadow: TEXT_SHADOW },
      });
      val.position.set(440, y);
      content.addChild(val);
      if (r.desc !== '') {
        const desc = new Text({ resolution: 2,
          text: r.desc,
          style: { fontFamily: UI_FONT, fontSize: 15, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
        });
        desc.position.set(0, y + 27);
        content.addChild(desc);
      }
      y += step;
    }

    const total = y;
    const maxScroll = Math.max(0, total - contentH);
    this.statsScrollY = Math.min(this.statsScrollY, maxScroll);
    content.y = -this.statsScrollY;

    attachWheelScroll(
      clip,
      contentW,
      contentH,
      maxScroll,
      () => this.statsScrollY,
      (v) => {
        this.statsScrollY = v;
        content.y = -v;
      },
    );
  }

  /**
   * 기체 쇼케이스 — 이 화면에서 **유일하게 배경이 그대로 보이는 창**이다.
   *
   * 다른 셋과 달리 `variant: 'window'` 라 내부 채움이 없다. 배경 원화의 정비 도크가 그대로
   * 비치고, 그 앞에 함선 스프라이트와 8슬롯이 선다 — 함선이 도크에 들어와 있는 그림이 된다.
   * 함선 아트는 **픽셀아트 그대로 둔다**(사용자 확정): 기체 정체성·파밍 언어라 재생성하면
   * 인게임 함선과 표시가 갈린다. 대신 뒤에 조명이 들어오게 해서 페인터리 배경에 앉힌다.
   *
   * ⚠️ Lane A 인계 제약 ①: 창 안은 계수 1 = 원화 그대로다(창 밖은 ×0.30). 창에 얹는 것이
   * 배경보다 밝지 않으면 살아나지 않는다 — 함선 뒤 후광과 슬롯 소켓의 어두운 홈이 그 대비를
   * 만든다.
   */
  private renderShowcasePanel(): void {
    const px = COL_R_X;
    const py = ROW_T_Y;
    const pw = COL_R_W;
    const ship = activeShip(this.profile);
    const box = this.addPanel(
      px,
      py,
      pw,
      ROW_T_H,
      'window',
      `${shipTypeName(shipTypeDef(ship.typeId))} · Lv ${ship.level}`,
    );

    // --- 기체 도크(접지 · 크래들 · 림) ------------------------------------------
    //
    // 1차 AAA 판정 CRIT-C3: 함선의 접지 그림자가 **정확히 0** 이었다(아래 띠 / 같은 y 의 좌우
    // 측면 = 1.001). 게다가 주변 장면 R/B 가 1.844 인데 함선 하단은 0.511 로, 바닥의 금빛
    // 반사광이 함선에 전혀 닿지 않았다 — "스프라이트를 레이어에 얹은" 상태였다.
    //
    // 픽셀아트 함선은 **다시 그리지 않는 것이 확정 사항**이다(기체 정체성·파밍 시각 언어).
    // 그래서 조명·접지·프레이밍으로만 페인터리 배경에 앉힌다. `shipDock` 이 함선 스프라이트
    // 자체를 그리는 이유는 접지·크래들·림의 z 순서를 한 곳에서 보장하기 위해서다.
    //
    // 쇼케이스는 **기체 타입 파생**이다. 아트가 아직 없으면 조용히 레거시 텍스처로 폴백해
    // 화면이 비지 않게 한다(설계서 §8·§9 — 아트는 코드보다 늦게 도착한다).
    const shipTex = this.ui[shipShowcaseName(ship.typeId)] ?? this.ui[LEGACY_SHOWCASE];
    const dock = makeShipDock({
      width: box.w,
      height: box.h,
      ship: shipTex ?? undefined,
      shipSize: 256,
      cx: box.w / 2,
      cy: box.h / 2,
      // 크래들(받침)은 **사용자 판단으로 끈다**(2026-08-02). 접지 그림자·언더라이트·림은
      // 실루엣 바닥선에서 파생하므로 그대로 살아 있다 — 함선은 여전히 그림자를 드리운다.
      cradle: false,
    });
    dock.container.position.set(box.x, box.y);
    this.root.addChild(dock.container);
    this.dock = dock;

    // ⚠️ 연결선·폴백은 **반환된 좌표**로 파생시킨다(Lane D 인계 제약 ①) — 데크선이 창 하단
    // 여백을 침범하면 도크가 함선을 위로 올리므로, `box.h / 2` 를 그대로 쓰면 어긋난다.
    const shipCx = box.x + dock.shipX;
    const shipCy = box.y + dock.shipY;
    if (!shipTex) {
      // 자산 결손 폴백 — 도크는 함선을 그리지 않았으므로 여기서 실루엣만 세운다(제약 ②).
      const g = new Graphics();
      g.moveTo(shipCx, shipCy - 90)
        .lineTo(shipCx + 70, shipCy + 80)
        .lineTo(shipCx - 70, shipCy + 80)
        .closePath()
        .fill({ color: 0x39d0ff })
        .stroke({ color: 0xffffff, width: 3 });
      this.root.addChild(g);
    }

    // 장착 8슬롯: 좌 4 / 우 4 컬럼. 라벨은 슬롯 바깥쪽.
    const slotSize = 72;
    // 바깥쪽 라벨(최대 ~90px)이 콘텐츠 상자 안에 들어오도록 컬럼을 안쪽으로.
    const labelGutter = 90 + 12;
    const leftX = box.x + labelGutter;
    const rightX = box.right - labelGutter - slotSize;
    const colTop = box.y + 16;
    // 4행째(실드/모듈2) 하단이 콘텐츠 상자 바닥 안에 들어오는 간격을 역산한다.
    const colStep = Math.floor((box.h - 16 - slotSize) / 3);

    // 연결선 레이어(슬롯보다 아래).
    const lines = new Graphics();
    this.root.addChild(lines);

    EQUIP_SLOTS.forEach((id, i) => {
      const left = i < 4;
      const col = left ? 0 : 1;
      const row = i % 4;
      const sx = left ? leftX : rightX;
      const sy = colTop + row * colStep;
      const item = ship.equipped[id];

      // 연결선(슬롯 중심 → 기체 중심 부근) — **슬롯 쪽에서 나와 함선 쪽으로 사라진다**.
      //
      // 1차·2차 AAA 판정 MINOR: 예전 판은 균일 알파 3px 벡터 8줄이라 CAD 와이어프레임으로
      // 읽혔고, 도크 크래들이 들어온 뒤로는 금색 원호와 교차해 엉킴이 더 심해졌다. 물리적으로
      // 이 선은 배선 하네스이지 도면 지시선이 아니다 — 슬롯 단자에서 굵고 밝게 시작해 함선
      // 안으로 들어가며 가늘고 흐려져야 한다.
      //
      // ⚠️ 테이퍼는 세그먼트로 만들되 **구간을 정확히 이어 붙인다**(t_i → t_{i+1}). 세그먼트를
      // 겹치면 겹친 자리의 알파가 두 배가 되어 마디가 생긴다 — 세로 램프에서 이 리포가 실제로
      // 겪은 결함과 같은 원리다(계약 §0-4).
      const partY = shipCy - 60 + row * 40;
      const partX = shipCx + (left ? -40 : 40);
      const x0 = sx + slotSize / 2;
      const y0 = sy + slotSize / 2;
      const SEGS = 7;
      for (let s = 0; s < SEGS; s++) {
        const t0 = s / SEGS;
        const t1 = (s + 1) / SEGS;
        // 중점 기준 감쇠 — 슬롯 쪽(t=0) 굵고 진하게, 함선 쪽(t=1) 가늘고 흐리게.
        const k = 1 - (t0 + t1) / 2;
        lines
          .moveTo(x0 + (partX - x0) * t0, y0 + (partY - y0) * t0)
          .lineTo(x0 + (partX - x0) * t1, y0 + (partY - y0) * t1)
          .stroke({
            color: COLOR.connector,
            width: 1.2 + 2.2 * k,
            alpha: 0.16 + 0.52 * k,
            cap: 'butt',
          });
      }
      // 슬롯 쪽 단자 노드 — 선이 어디서 나오는지를 말한다. 이게 없으면 선이 셀 밑에서
      // 시작하는지 위에서 시작하는지가 안 읽힌다.
      lines.circle(x0, y0, 4.5).fill({ color: COLOR.connector, alpha: 0.5 });
      lines.circle(x0, y0, 2.2).fill({ color: 0xfff0c8, alpha: 0.85 });

      // 접지 그림자 — 셀과 **같은 좌표**에 셀보다 먼저 붙인다(스스로 셀 밖으로 번진다,
      // Lane C 인계 제약 ③). 이게 없으면 슬롯이 유리 위에 붙은 스티커로 읽힌다(1차 판정
      // MINOR-b). 슬롯 텍스처 안에 굽지 않은 이유는 비평이 유지를 지시한 셀 내부 세로
      // 프로파일(20→55 단조 상승 = 움푹한 우물)이 깨지기 때문이다.
      const cellShadow = makeSlotContactShadow(slotSize);
      cellShadow.position.set(sx, sy);
      this.root.addChild(cellShadow);

      const cell = makeSlotCell({
        size: slotSize,
        item,
        // 나무 슬롯 텍스처 대신 석재 소켓을 주입한다(Lane C). 밝은 링이 없어 등급 테두리가
        // 프레임 금색에 흡수되던 충돌이 구조적으로 재발하지 않는다(`theme.ts` SLOT_RARITY 헤더).
        // `i` 를 종 인덱스로 넘겨 8칸이 같은 도장이 되지 않게 한다(감싸 처리는 Lane C 가 한다).
        slotTex: cinematicSlotTexture(item !== undefined, i),
        iconTex: equipIconTexture(this.ui, item),
        highlight: item !== undefined,
        highlightTex: cinematicSlotTexture(true, i),
        onClick: item !== undefined ? () => this.unequip(id) : undefined,
        onHover: item !== undefined ? (gx, gy) => this.showTip(item, gx, gy) : undefined,
        onMove: (gx, gy) => this.moveTip(gx, gy),
        onOut: () => this.hideTips(),
      });
      cell.position.set(sx, sy);
      this.root.addChild(cell);

      // 라벨: 좌 컬럼은 슬롯 왼쪽(anchor 오른쪽), 우 컬럼은 슬롯 오른쪽(anchor 왼쪽).
      const labelText =
        id === 'module0' ? t('inv.module1') : id === 'module1' ? t('inv.module2') : slotLabel(slotKindOf(id));
      const label = new Text({ resolution: 2,
        text: labelText,
        style: { fontFamily: UI_FONT, fontSize: 18, fontWeight: '700', fill: COLOR.cream, dropShadow: TEXT_SHADOW },
      });
      label.anchor.set(col === 0 ? 1 : 0, 0.5);
      label.position.set(col === 0 ? sx - 12 : sx + slotSize + 12, sy + slotSize / 2);
      this.root.addChild(label);
    });
  }

  // --- 하단 두 패널(창고·인벤토리) 공통 기하 ---------------------------------
  //
  // 시네마틱 패널은 제목을 **각인 띠**가 가져가므로(로컬 0..52, 그 아래 숨틈 16) 콘텐츠 상자가
  // 로컬 y 68 에서 시작한다. 그 아래로 액션 행(68..112) · 안내 한 줄(118..138) ·
  // 분류 탭 행(142..178) · 그리드(184..400 = 정확히 3행)가 순서대로 앉는다.
  //
  // ⚠️ 이 네 줄은 **서로 겹치면 안 되는 세로 띠**다. 예전에는 안내 한 줄을 제목 바로 아래에
  // 얹어 두었는데, 액션 버튼·분류 탭과 같은 띠를 나눠 써서 실제로 글자가 버튼과 탭 밑으로
  // 파묻혔다(사용자 신고 2026-07-27: "글자가 겹쳐서 안보임"). 안내 줄은 패널 폭 전체를 쓰므로
  // **자기 줄을 통째로 가져야 한다**. 값은 전부 패널 로컬 y 이고,
  // `tests/hangarInventoryUi.test.ts` 가 띠 경계를 산술로 못 박는다(측정 스텁에 기대지 않고).
  //
  // 세로 예산: 패널 424 − 콘텐츠 시작 68 − 하단 여백 24 = 332 이 콘텐츠 상자 높이다.
  // 그리드는 184 에서 시작해 400 에서 끝나고, 셀 62 + 간격 8 = 70 이므로 정확히 3행이다.

  /** 하단 패널 상단 y(디자인 스페이스). */
  private static readonly BOTTOM_PY = ROW_B_Y;
  /** 하단 패널 높이. */
  private static readonly BOTTOM_PH = ROW_B_H;
  /**
   * 콘텐츠 상자 상단(패널 로컬 y) = 각인 제목 띠 52 + 숨틈 16.
   *
   * ⚠️ 이 값은 `cinematicPanel.ts` 의 계약(제목 띠 **고정 52**)에서 온다. 옛 판은
   * `PANEL_BORDER 46 + PANEL_INNER_PAD 14 = 60` 이었고, 테스트가 그 60 을 하드코딩하고 있었다.
   * 상수로 올려 두 곳이 갈리지 않게 한다.
   */
  static readonly CONTENT_TOP = 68;
  /** 제목·액션 버튼 행의 높이(콘텐츠 상자 상단부터). */
  private static readonly ACTION_H = 44;
  /** 조작 안내 한 줄의 패널 로컬 y(액션 행 아래 자기 줄). */
  private static readonly HELP_Y = 118;
  /** 분류 탭 행의 패널 로컬 y 와 높이. */
  private static readonly FILTER_Y = 142;
  private static readonly FILTER_H = 36;
  /** 그리드 시작(패널 로컬 y). */
  private static readonly GRID_TOP = 184;
  /** 슬롯 셀 한 변과 세로 간격(가로 간격은 {@link fitGridCols} 가 폭에 맞춰 넓힌다). */
  private static readonly CELL = 62;
  private static readonly GAP = 8;

  /**
   * 슬롯 분류 탭 한 줄(전체 + 슬롯 7종). `makeTabBar` 는 높이가 58 고정이라 여기 쓰면 그리드가
   * 한 행 줄어든다 — 같은 어휘(PixiButton + 노란 판때기 = 선택)로 40px 짜리를 직접 깐다.
   */
  private renderFilterBar(
    x: number,
    y: number,
    w: number,
    active: SlotKind | null,
    onSelect: (kind: SlotKind | null) => void,
  ): void {
    const n = FILTER_KINDS.length;
    const gap = 6;
    const bw = Math.floor((w - gap * (n - 1)) / n);
    FILTER_KINDS.forEach((kind, i) => {
      const isActive = kind === active;
      const last = i === n - 1;
      // 선택 = 금박 각인 판, 비선택 = 석재. 라벨색은 톤에서 파생하므로(밝은 바탕 위 흰 글씨
      // 방지) 여기서 따로 정하지 않는다.
      const btn = this.chromeButton({
        tone: isActive ? 'gold' : 'stone',
        // 반올림 오차는 마지막 칸이 흡수한다 — 오른쪽 끝이 콘텐츠 폭과 정확히 맞는다.
        width: last ? w - (bw + gap) * (n - 1) : bw,
        height: HangarScreen.FILTER_H,
        fontSize: 15,
        label: kind === null ? t('inv.filter.all') : slotLabel(kind),
        onClick: () => onSelect(kind),
      });
      btn.container.position.set(x + i * (bw + gap), y);
      this.root.addChild(btn.container);
    });
  }

  /**
   * 패널 조작 안내 한 줄(제목 아래). 좌/우클릭에 서로 다른 동작이 걸려 있으면 **화면이 그것을
   * 말해야 한다** — 보관함↔인벤토리 이동 수단이 있어도 알 수 없으면 없는 것과 같다(사용자 신고
   * 2026-07-27: "이동을 할 수 있는 방법이 없어").
   *
   * ⚠️ 이 줄은 패널 폭 전체를 쓴다 — 액션 버튼·분류 탭과 같은 세로 띠에 두면 반드시 겹친다
   * ({@link HangarScreen.HELP_Y} 가 그 전용 줄이다). 폰트 14 = 줄 높이 약 18px 로, 106..124
   * 안에 들어가 분류 탭(128) 을 침범하지 않는다.
   */
  private renderPanelHelp(x: number, y: number, text: string): void {
    const help = new Text({
      resolution: 2,
      text,
      style: { fontFamily: UI_FONT, fontSize: 14, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
    });
    help.position.set(x, y);
    this.root.addChild(help);
  }

  /** 정렬 순환 버튼(획득순 → 희귀도 → 슬롯 → …). 현재 모드를 라벨에 그대로 보여준다. */
  private renderSortButton(
    x: number,
    y: number,
    mode: ItemSortMode,
    onCycle: (next: ItemSortMode) => void,
    width = 160,
  ): void {
    const next = SORT_MODES[(SORT_MODES.indexOf(mode) + 1) % SORT_MODES.length] ?? 'default';
    const btn = this.chromeButton({
      tone: 'stone',
      width,
      height: HangarScreen.ACTION_H,
      fontSize: 16,
      label: t('inv.act.sort', { v: t(SORT_LABEL_KEY[mode]) }),
      onClick: () => onCycle(next),
    });
    btn.container.position.set(x, y);
    this.root.addChild(btn.container);
  }

  private renderStashPanel(): void {
    const px = COL_L_X;
    const py = HangarScreen.BOTTOM_PY;
    const pw = COL_L_W;
    const ph = HangarScreen.BOTTOM_PH;
    const cap = stashCapacity(this.profile.stashExpansions);
    // 제목(보유/용량)은 패널의 각인 띠가 그린다 — 액션 버튼 행과 같은 세로 띠를 다투지 않는다.
    const box = this.addPanel(
      px,
      py,
      pw,
      ph,
      'slab',
      t('inv.stashHeader', { n: this.profile.stash.length, cap }),
    );
    this.renderPanelHelp(box.x, py + HangarScreen.HELP_Y, t('inv.help.stash'));

    // 헤더 우측 액션 줄: [하급 분해][상급 분해][정렬][확장]. 창고 패널은 인벤토리보다 좁아
    // (콘텐츠 780 vs 832) 인벤토리의 210px 버튼을 그대로 쓰면 제목 자리가 사라진다 — 같은
    // 동작이므로 **양쪽 다** 등급을 밝힌 짧은 라벨을 쓰고, 창고 쪽만 폭을 조인다.
    const SALV_W = 126;
    const SORT_W = 116;
    const EXPAND_W = 196;
    const AGAP = 10;
    const rowY = box.y;
    let cursorX = box.right;

    // 창고 확장 버튼(파랑) — 패널 우상단.
    const nextCost = stashExpansionCost(this.profile.stashExpansions);
    const maxed = this.profile.stashExpansions >= MAX_STASH_EXPANSIONS;
    cursorX -= EXPAND_W;
    const expandBtn = this.chromeButton({
      tone: 'blue',
      width: EXPAND_W,
      height: HangarScreen.ACTION_H,
      fontSize: 16,
      label: maxed ? t('inv.act.expandMax') : t('inv.act.expand', { n: nextCost }),
      onClick: () => void this.expandStash(),
    });
    expandBtn.container.position.set(cursorX, rowY);
    this.root.addChild(expandBtn.container);
    if (maxed || !canAfford(this.profile.credits, nextCost)) expandBtn.setEnabled(false);

    // 정렬 순환(확장 버튼 왼쪽).
    cursorX -= AGAP + SORT_W;
    this.renderSortButton(cursorX, rowY, this.stashSort, (next) => {
      this.stashSort = next;
      this.stashScrollY = 0;
      this.render();
    }, SORT_W);

    // 보관함 일괄 분해 2종(빨강) — 인벤토리와 같은 규칙(활성 필터 + 등급). 보관함에만 쌓아 둔
    // 하급 장비를 꺼내지 않고 그 자리에서 정리할 수 있어야 한다(사용자 요청 2026-07-27).
    for (const spec of [
      { key: 'inv.act.salvageHighShort' as const, rarities: ['rare', 'unique'] as const },
      { key: 'inv.act.salvageLowShort' as const, rarities: ['normal', 'magic'] as const },
    ]) {
      cursorX -= AGAP + SALV_W;
      const btn = this.chromeButton({
        tone: 'red',
        width: SALV_W,
        height: HangarScreen.ACTION_H,
        fontSize: 15,
        label: t(spec.key),
        onClick: () => void this.salvageByRarities('stash', spec.rarities),
      });
      btn.container.position.set(cursorX, rowY);
      this.root.addChild(btn.container);
    }
    this.renderFilterBar(
      box.x,
      py + HangarScreen.FILTER_Y,
      box.w,
      this.stashFilter,
      (kind) => {
        this.stashFilter = kind;
        this.stashScrollY = 0;
        this.render();
      },
    );

    // 스크롤 그리드(마스크 클립 + 휠, 스크롤바 없음).
    const contentX = box.x;
    const contentTop = py + HangarScreen.GRID_TOP;
    const contentW = box.w;
    const cell = HangarScreen.CELL;
    const gap = HangarScreen.GAP;
    // 마스크 하한 = 콘텐츠 상자 바닥, 셀 행 배수로 클램프(반토막 셀 금지).
    const gridH = box.bottom - contentTop;
    const contentH = Math.floor((gridH + gap) / (cell + gap)) * (cell + gap) - gap;
    // 열 수는 폭에서 유도하고 남는 폭은 열 간격이 흡수한다(우측 여백 제거).
    const fit = fitGridCols(contentW, cell, gap);
    const cols = fit.cols;

    const clip = new Container();
    clip.position.set(contentX, contentTop);
    this.root.addChild(clip);
    const mask = new Graphics();
    mask.rect(contentX, contentTop, contentW, contentH).fill({ color: 0xffffff });
    this.root.addChild(mask);
    clip.mask = mask;

    const content = new Container();
    clip.addChild(content);

    const ship = activeShip(this.profile);
    const cells = arrangeItems(this.profile.stash, cap, this.stashFilter, this.stashSort, cols);
    const positions = rectGridPositions(cells.length, cols, cell, cell, fit.gapX, gap);
    for (let i = 0; i < cells.length; i++) {
      const item = cells[i];
      // 보관함 장비도 장착 후보다 — 인벤토리와 같은 기준으로 현재 장착과 비교해 보여준다.
      const compareTo = item !== undefined ? this.equippedFor(item.slot) : undefined;
      const locked = item !== undefined && !canEquip(ship.level, item);
      const c = makeSlotCell({
        size: cell,
        item,
        // 종 인덱스 `i` — 80칸이 전부 같은 스탬프면 그리드가 벽지로 읽힌다(1차 판정 MINOR-a).
        slotTex: cinematicSlotTexture(false, i),
        iconTex: equipIconTexture(this.ui, item),
        reqLevel: item !== undefined ? requiredLevel(item) : undefined,
        locked,
        // 보관함 셀은 좌클릭이 비어 있었다 — 꺼내기(→ 인벤토리)를 그 자리에 얹는다. 요구 레벨
        // 미달이어도 꺼낼 수는 있어야 한다(레벨을 올린 뒤 장착하는 흐름) — locked 게이트 없음.
        onClick: item !== undefined ? () => this.moveToInventory(item) : undefined,
        onHover: item !== undefined ? (gx, gy) => this.showTip(item, gx, gy, compareTo) : undefined,
        onMove: (gx, gy) => this.moveTip(gx, gy),
        onOut: () => this.hideTips(),
      });
      const pos = positions[i];
      if (pos !== undefined) c.position.set(pos.x, pos.y);
      content.addChild(c);
    }

    // 필터 중이면 걸러진 결과가 하나도 없을 수 있다 — 빈 그리드만 두면 고장으로 읽힌다.
    if (cells.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('inv.filter.empty'),
        style: { fontFamily: UI_FONT, fontSize: 18, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      empty.position.set(0, 8);
      content.addChild(empty);
    }

    const rows = Math.ceil(cells.length / cols);
    const total = rows * (cell + gap);
    const maxScroll = Math.max(0, total - contentH);
    this.stashScrollY = Math.min(this.stashScrollY, maxScroll);
    content.y = -this.stashScrollY;
    attachWheelScroll(
      clip,
      contentW,
      contentH,
      maxScroll,
      () => this.stashScrollY,
      (v) => {
        this.stashScrollY = v;
        content.y = -v;
      },
    );
  }

  private renderInventoryPanel(): void {
    const px = COL_R_X;
    const py = HangarScreen.BOTTOM_PY;
    const pw = COL_R_W;
    const ph = HangarScreen.BOTTOM_PH;
    const box = this.addPanel(
      px,
      py,
      pw,
      ph,
      'slab',
      t('inv.invHeader', { n: this.profile.inventory.length, cap: INVENTORY_CAP }),
    );
    this.renderPanelHelp(box.x, py + HangarScreen.HELP_Y, t('inv.help.inventory'));

    // 일괄 분해 버튼 2종(빨강) — 패널 우상단 나란히.
    const bw = 210;
    const bh = HangarScreen.ACTION_H;
    const salvageHigh = this.chromeButton({
      tone: 'red',
      width: bw,
      height: bh,
      fontSize: 16,
      label: t('inv.act.salvageHigh'),
      onClick: () => void this.salvageByRarities('inventory', ['rare', 'unique']),
    });
    salvageHigh.container.position.set(box.right - bw, box.y);
    this.root.addChild(salvageHigh.container);

    const salvageLow = this.chromeButton({
      tone: 'red',
      width: bw,
      height: bh,
      fontSize: 16,
      label: t('inv.act.salvageLow'),
      onClick: () => void this.salvageByRarities('inventory', ['normal', 'magic']),
    });
    salvageLow.container.position.set(box.right - bw * 2 - 12, box.y);
    this.root.addChild(salvageLow.container);

    // 정렬 순환(일괄 분해 버튼 왼쪽) + 슬롯 분류 탭(그 아래 한 줄).
    this.renderSortButton(box.right - bw * 2 - 12 - 12 - 160, box.y, this.invSort, (next) => {
      this.invSort = next;
      this.inventoryScrollY = 0;
      this.render();
    });
    this.renderFilterBar(
      box.x,
      py + HangarScreen.FILTER_Y,
      box.w,
      this.invFilter,
      (kind) => {
        this.invFilter = kind;
        this.inventoryScrollY = 0;
        this.render();
      },
    );

    // 마스크 클립 + 휠 스크롤(패널 프레임 침범 0, 스크롤바 시각 요소 없음). 열 수는 **폭에서
    // 유도**한다 — 예전에는 `cols = 8` 하드코딩이라 832px 폭에 584px 만 그려져 오른쪽 248px 이
    // 통째로 비어 있었다(용량 표기 48칸과도 안 맞아 보였다).
    const contentX = box.x;
    const contentTop = py + HangarScreen.GRID_TOP;
    const contentW = box.w;
    const cell = HangarScreen.CELL;
    const gap = HangarScreen.GAP;
    const fit = fitGridCols(contentW, cell, gap);
    const cols = fit.cols;
    // 마스크 하한 = 콘텐츠 상자 바닥, 셀 행 배수로 클램프(반토막 셀 금지).
    const gridH = box.bottom - contentTop;
    const contentH = Math.floor((gridH + gap) / (cell + gap)) * (cell + gap) - gap;

    const clip = new Container();
    clip.position.set(contentX, contentTop);
    this.root.addChild(clip);
    const mask = new Graphics();
    mask.rect(contentX, contentTop, contentW, contentH).fill({ color: 0xffffff });
    this.root.addChild(mask);
    clip.mask = mask;

    const content = new Container();
    clip.addChild(content);

    const ship = activeShip(this.profile);
    const cells = arrangeItems(this.profile.inventory, INVENTORY_CAP, this.invFilter, this.invSort, cols);
    const positions = rectGridPositions(cells.length, cols, cell, cell, fit.gapX, gap);
    for (let i = 0; i < cells.length; i++) {
      const item = cells[i];
      const compareTo = item !== undefined ? this.equippedFor(item.slot) : undefined;
      const locked = item !== undefined && !canEquip(ship.level, item);
      const c = makeSlotCell({
        size: cell,
        item,
        // 종 인덱스 `i` — 80칸이 전부 같은 스탬프면 그리드가 벽지로 읽힌다(1차 판정 MINOR-a).
        slotTex: cinematicSlotTexture(false, i),
        iconTex: equipIconTexture(this.ui, item),
        reqLevel: item !== undefined ? requiredLevel(item) : undefined,
        locked,
        onClick: item !== undefined && !locked ? () => this.equip(item) : undefined,
        // 좌클릭이 장착에 묶여 있으므로 보관함으로 보내기는 우클릭에 얹는다(패널 안내 문구가
        // 이를 알린다). 요구 레벨 미달이라 장착이 막힌 아이템도 보관은 되어야 한다.
        onRightClick: item !== undefined ? () => this.moveToStash(item) : undefined,
        onHover: item !== undefined ? (gx, gy) => this.showTip(item, gx, gy, compareTo) : undefined,
        onMove: (gx, gy) => this.moveTip(gx, gy),
        onOut: () => this.hideTips(),
      });
      const pos = positions[i];
      if (pos !== undefined) c.position.set(pos.x, pos.y);
      content.addChild(c);
    }

    if (cells.length === 0) {
      const empty = new Text({
        resolution: 2,
        text: t('inv.filter.empty'),
        style: { fontFamily: UI_FONT, fontSize: 18, fill: SLAB_BODY_FILL, dropShadow: TEXT_SHADOW },
      });
      empty.position.set(0, 8);
      content.addChild(empty);
    }

    const rows = Math.ceil(cells.length / cols);
    const total = rows * (cell + gap);
    const maxScroll = Math.max(0, total - contentH);
    this.inventoryScrollY = Math.min(this.inventoryScrollY, maxScroll);
    content.y = -this.inventoryScrollY;
    attachWheelScroll(
      clip,
      contentW,
      contentH,
      maxScroll,
      () => this.inventoryScrollY,
      (v) => {
        this.inventoryScrollY = v;
        content.y = -v;
      },
    );
  }

  private renderHint(): void {
    if (this.hint === '') return;
    const t2 = new Text({ resolution: 2,
      text: this.hint,
      style: { fontFamily: UI_FONT, fontSize: 20, fontWeight: '700', fill: 0xff9a7a, dropShadow: TEXT_SHADOW },
    });
    t2.anchor.set(0.5, 1);
    // 하단 패널 바닥(1052) 아래 남은 28px 띠. 패널 접지 그림자가 이 위로 번지므로 글자가
    // 어두운 바탕 위에 앉는다 — 밝은 살구색이라 오히려 잘 읽힌다.
    t2.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 6);
    this.root.addChild(t2);
  }
}
