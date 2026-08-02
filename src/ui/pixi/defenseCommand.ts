/**
 * 방어 사령부 — 침공 3레이어 배치 사령 화면 (M7b-command-ui, ADR-0017/0018)
 * · 2026-08-02 AAA 시네마틱 전환(레인 계약 `.omc/plans/defense-command-aaa-2026-08-02.md`).
 *
 * ## 왜 전면 신규였는가 (M7a 이력)
 * 구 사령부(15×9 격자 · 포탑 6종 · 배치 포인트 예산제)는 M7a 3레이어 개편으로 전제가 통째로
 * 사라져 L11 에서 삭제됐다. 지금 방어는 **레이어 세 장에 슬롯을 꽂는 일**이다:
 *   L1 대기권 = 웨이브 슬롯 6(편대) · L2 회랑 = 맵 템플릿 + 소켓 12/10/8(설비) ·
 *   L3 코어방 = 보스 1 + 수호 2 + 기물 6 + 코어.
 *
 * ## 처음부터 Pixi 다 (DOM 혼용 금지)
 * DOM 오버레이를 섞으면 캔버스 UI 가 남은 DOM 아래로 깔리고 **z-index 로 못 뒤집는다**
 * (실측 — 설정 톱니가 DOM 타이틀에 가려졌던 결함).
 *
 * ## 서버 권위
 * 강화 3축(레벨·승급·어픽스 리롤)과 제작은 전부 서버 RPC 가 판정하고 차감한다. 이 화면은
 * `data/defenseUnits.ts` 의 **같은 산식**으로 비용을 표기만 하고, 성공 후 서버가 돌려준
 * 크레딧·광물을 프로필에 pull 한다. 배치는 로컬 프로필에 즉시 저장하고 `uploadDefenseLayout`
 * 으로 서버에 올린다(정규화는 업로드 함수가 한 번 더 한다 — 총 함수).
 *
 * ---------------------------------------------------------------------------
 * ## 시네마틱 전환에서 바뀐 것은 **바탕과 배치**뿐이다
 * `nineSlicePanel`(나무) → `makeCinematicPanel`(석재), `makeBanner` → `makeHangarTitle`,
 * `makeCurrencyChip` → `makeHangarChip`, `ui_btn_*.png` → `cinematicButtonTexture` 주입,
 * `makeTabBar`(나무) → 이 파일의 시네마틱 탭, `makeModal`(나무) → 이 파일의 시네마틱 팝업,
 * 나무 행 바탕 → 석재 행 판(`rowPlate`), 단색 배경 → `HangarBackdrop`.
 * 배치 편집·저장·서버 왕복·suspend/resume 계약은 한 줄도 건드리지 않았다.
 *
 * ## 왜 여기는 **창을 뚫는가**(형제 화면 넷은 안 뚫었다)
 * 형제 화면들의 결론은 "창은 배경이 보이는 구멍이 아니라 **무언가를 보여주는 자리**"였고,
 * 촉매 보관함·예비역 로스터·연구소·정제소는 초점 피사체가 없어 뚫었다 뺐다. 여기는 챔피언
 * 선택 쪽이다 — 좌측 프리뷰는 목업이 아니라 **`createWorld(invasion3)` 실제 정지 렌더**이고,
 * 슬롯을 꽂거나 탭을 바꾸면 **그림이 실제로 바뀐다**. 창에 세울 피사체가 이미 있다.
 * ⚠️ `window` 변종 위에 채워진 그림자를 깔면 창이 −66L 로 검게 죽는다 — `cinematicPanel.ts`
 * 가 링으로 파낸 텍스처를 쓰므로 그대로 두고 위에 아무것도 덮지 않는다.
 *
 * ## 모든 탭이 **같은 패널 기하**를 쓴다 (왼 1100 · 오른 728)
 * 탭마다 패널 배치가 달라지면 전환할 때 석재가 통째로 튀고, 재렌더 규율상 탭 전환마다 배경과
 * 슬래브를 다시 **구워야** 한다. 패널 4장을 한 번에 세워 두고 `visible` 만 토글한다.
 * 그래서 슬롯 패널 제목은 레이어별로 갈리지 않고 공통 `배치 슬롯` 이다(각인 제목은 패널에
 * 구워지므로 레이어마다 다르면 재건이 필요해진다 — 어느 레이어인지는 탭 바가 이미 말한다).
 *
 * ## [코어 모듈] **탭을 없앴다** — 탭 하나 전체가 버튼 하나였다
 * 그 탭의 내용은 안내 한 문단 + 버튼 하나가 전부라 1856×788 슬래브가 그것만을 위해 있었다.
 * 코어 모듈은 **L3 코어의 소모성 인스턴스**이므로 L3 슬롯 패널 맨 위 **코어 블록**(코어 내구도
 * + `[모듈 관리]`)으로 옮겼다. 진입점·`onOpenModules` 계약·suspend/resume 은 그대로다.
 * ⚠️ 사문화된 문구 키(`def3.cmd.tab.mod`·`mod.head`·`mod.note`·`back`)는 **카탈로그에 남긴다**
 * — `tests/i18n.test.ts` 가 `def3.cmd.back` 을 "빌려 쓰던 원 문구" 대조 표본으로 이름을 박아
 * 쓰고 있어, 지우면 무관한 단언이 흔들린다.
 *
 * ## 빈 자리를 남기지 않는다
 * 하단 [기지로 돌아가기]는 헤더 ✕ 와 같은 일을 두 번 하고 있어 지웠다. 하단 띠에는 저장·
 * 되돌리기·시험 침공만 남고 왼쪽 절반은 상태 문구가 쓴다. 보유 방어체·설계도가 비거나
 * 오프라인이면 패널을 **파낸 보관 챔버**(`recessedWell`)로 그리고 그 안에서 안내한다 —
 * "빈 패널 면"이 아니라 "비어 있는 챔버"다(정제소에서 확인된 처방).
 * 팝업 세 종은 높이를 **내용에서 역산**해 버려지는 세로가 0 이다({@link DEFENSE_MODALS}).
 *
 * ## 행 사이에 **선을 긋지 않는다**
 * 세로 리브·가로 이음선·각인 번호판은 사용자가 격납고에서 삭제를 지시한 것들이다(2026-08-02).
 * 행 구분은 선이 아니라 **면의 밝기 차 + 2단 접지 그림자 + 행 간격**이 만든다. 등급은 제목
 * 글자색이 말하고, 선택은 금색 링이 말한다(둘 다 면 위의 "부품"이 아니다).
 *
 * ## 재렌더 규율
 * 옛 구현은 `render()` 가 루트를 통째로 지우고 다시 그렸다 — 슬롯 클릭 한 번, 탭 전환 한 번마다
 * 배경과 석재 패널 4장이 다시 **구워진다**. 그래서
 *  - `buildChrome()` 은 1회(자산 도착 시에만 재건 — **탭 전환으로는 재건하지 않는다**),
 *  - `syncValues()` 가 재화 칩·상태 문구·탭 활성·하단 버튼 활성을,
 *  - `renderSlots()`/`renderUnits()`/`renderBlueprints()`/`renderModal()` 이 각자 host 안만
 *    갈아끼운다.
 *  - `update(dt)` 는 `main.ts` 가 매 프레임 부른다(`defenseCommand.update(frame)`). 숨겨져
 *    있으면 즉시 반환하므로 이 화면 밖 비용은 0 이다. ⚠️ 연구소가 이 배선을 빠뜨려 배경·패널
 *    연출이 통째로 멈춘 적이 있다.
 *
 * ## 여기서 밟기 쉬운 함정 (전부 실측 근거)
 * - **행 클릭은 행 Container 에.** 바탕 Graphics 에 걸면 위에 얹힌 텍스트가 클릭을 삼킨다.
 * - **휠은 클립 Container 에.** 마스크 Graphics 는 히트 테스트에서 제외된다.
 * - 컬러 이모지 금지(`text.ts` stripEmoji 가 두부로 떨군다). `★ ✕ ▶ ◀` 는 보존 목록이다.
 * - ⚠️ `hudEl()` 에는 **캔버스 가드를 붙이지 않는다**(`typeof document.createElement !==
 *   'function'` 까지 검사하면 HUD 숨김이 통째로 죽는다 — 이 리포가 실제로 밟았다).
 * - ⚠️ 좌상단 x<120 · y<120 은 **설정 톱니 예약 밴드**다. 헤더 좌측을 비워 둔다.
 * - ⚠️ 각인 제목은 중앙 정렬 Text 라 사각형이 없어 겹침 테스트가 못 잡는다 —
 *   {@link TITLE_BAND_HALF_W} 로 대역을 못 박는다(연구소에서 제목이 실제로 겹쳤다).
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import {
  saveProfile,
  type GuardianRecord,
  type KeyValueStore,
  type Profile,
} from '../../save/profile.js';
import { refreshPendingProfile } from '../../net/profileSync.js';
import { t, type MessageKey, type TParams } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW, RARITY_COLOR_NUM } from './theme.js';
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
import type { DefensePreviewControls, PreviewViewport } from '../../render/defensePreview.js';
import {
  normalizeInvasionLayers,
  emptyInvasionLayers,
  cloneInvasionLayers,
  layersEqual,
  INVASION_WAVE_SLOTS,
  INVASION_PROP_SLOTS,
  INVASION_GUARDIAN_SLOTS,
  INVASION_SOCKET_COUNTS,
  INVASION_TEMPLATE_COUNT,
  INVASION_CORE_HP,
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
  type InvasionLayers,
  type InvasionPhase,
  type InvasionRef,
  type InvasionGuardianPlacement,
} from '../../sim/invasion/index.js';
import {
  CATALOG_FORMATION,
  CATALOG_FACILITY,
  CATALOG_PROP,
  CATALOG_BOSS,
  CATALOG_MAP,
  catalogEntry,
  def3NameKey,
} from '../../../data/invasion/catalog.js';
import { guardianBonusBp, guardianMilestones } from '../../../data/lineage.js';
import {
  defenseUnitPowerBp,
  defenseUnitLevelUpCost,
  defenseUnitAscendCost,
  defenseUnitRerollCost,
  defenseUnitRarityUpCost,
  defenseUnitAffixNameKey,
  defenseUniqueNameKey,
  defenseUnitRarityRank,
  ascensionVisualTier,
  type DefenseUnitInstance,
  type Rarity,
} from '../../../data/defenseUnits.js';
import { toInvasionRef, defenseUnitFromRef, defenseUnitUnique } from '../../items/rollDefenseUnit.js';
import {
  getDefenseUnitsUserId,
  listDefenseUnits,
  listBlueprints,
  levelUpDefenseUnit,
  ascendDefenseUnit,
  rerollDefenseUnitAffixes,
  promoteDefenseUnitRarity,
  craftDefenseUnit,
  type DefenseUnitOwned,
  type BlueprintOwned,
  type DefenseUnitUpgradeResult,
} from '../../net/defenseUnits.js';
import { uploadDefenseLayout } from '../../net/defenseSync.js';

// ===========================================================================
// i18n
// ===========================================================================

/**
 * 문구 조회. 키가 동적(카탈로그 방어체명 `def3.<i18nId>.name` 등)이라 `MessageKey`
 * 캐스팅이 필요하다 — 스티커(`sticker.<id>`) 와 같은 선례이며, 누락은 i18n 테스트가
 * 카탈로그 파생으로 잡는다. 이 화면의 `def3.cmd.*` 정본은 src/i18n/catalog.ts 다.
 * 컬러 이모지 금지: Pixi 에서 두부로 렌더된다(◀ ▶ ✕ 같은 기하 기호만 허용).
 */
export function tCmd(key: string, params?: TParams): string {
  return t(key as MessageKey, params);
}

// ===========================================================================
// 순수 모델 — 슬롯 주소 · 배치 편집 · 화면 상태
// ===========================================================================

/**
 * 탭 코드(배열 인덱스 = 탭 순서).
 *
 * ⚠️ 옛 `DEF_TAB_MOD`(4)는 사라졌다 — 그 탭 전체가 버튼 하나였고 코어 모듈은 L3 코어 블록으로
 * 옮겼다(파일 헤더). `DEF_TAB_INV` 는 **3 그대로**라 탭 순서는 바뀌지 않는다.
 */
export const DEF_TAB_L1 = 0;
export const DEF_TAB_L2 = 1;
export const DEF_TAB_L3 = 2;
export const DEF_TAB_INV = 3;
export const DEF_TAB_COUNT = 4;

/** 탭 라벨 i18n 키(인덱스 = 탭 코드). */
export const DEF_TAB_KEYS: readonly string[] = [
  'def3.cmd.tab.l1',
  'def3.cmd.tab.l2',
  'def3.cmd.tab.l3',
  'def3.cmd.tab.inv',
];

/** 편집 가능한 슬롯의 종류. */
export type SlotKind = 'wave' | 'socket' | 'boss' | 'prop' | 'guardian';

/** 슬롯 하나의 주소. `guardian` 만 `InvasionRef` 가 아니라 수호 배치를 담는다. */
export interface DefenseSlotRef {
  readonly kind: SlotKind;
  readonly index: number;
}

/** 슬롯 종류 → 카탈로그 종류 코드(CATALOG_*). 수호는 카탈로그가 아니라 퇴역 기체다. */
export function slotCatalogKind(kind: SlotKind): number {
  if (kind === 'wave') return CATALOG_FORMATION;
  if (kind === 'socket') return CATALOG_FACILITY;
  if (kind === 'prop') return CATALOG_PROP;
  return CATALOG_BOSS;
}

/** 슬롯 종류가 이 배치에서 갖는 칸 수(소켓만 템플릿에 따라 달라진다). */
export function slotCount(layers: InvasionLayers, kind: SlotKind): number {
  if (kind === 'wave') return INVASION_WAVE_SLOTS;
  if (kind === 'socket') return layers.l2.sockets.length;
  if (kind === 'prop') return INVASION_PROP_SLOTS;
  if (kind === 'guardian') return INVASION_GUARDIAN_SLOTS;
  return 1;
}

/** 슬롯에 꽂힌 참조(없으면 null). 수호 슬롯은 항상 null 을 돌려준다(다른 축이다). */
export function slotRef(layers: InvasionLayers, slot: DefenseSlotRef): InvasionRef | null {
  if (slot.kind === 'wave') return layers.l1.waveSlots[slot.index] ?? null;
  if (slot.kind === 'socket') return layers.l2.sockets[slot.index] ?? null;
  if (slot.kind === 'prop') return layers.l3.props[slot.index] ?? null;
  if (slot.kind === 'boss') return layers.l3.boss;
  return null;
}

/** 수호 슬롯 배치(없으면 null). */
export function guardianAt(
  layers: InvasionLayers,
  index: number,
): InvasionGuardianPlacement | null {
  return layers.l3.guardians[index] ?? null;
}

/**
 * 고정 길이 배열의 한 칸만 바꾼 **새 배열**을 만든다. 길이는 절대 변하지 않는다 —
 * 슬롯 배열은 밀집화 금지가 계약이다(슬롯 i ↔ 수호 pierce i 등 인덱스 자체가 의미를 진다).
 */
function withSlot<T>(arr: readonly (T | null)[], index: number, value: T | null): (T | null)[] {
  const out = arr.slice();
  if (index >= 0 && index < out.length) out[index] = value;
  return out;
}

/** 슬롯에 참조를 꽂은 새 배치(정규화 완료). 수호 슬롯에는 쓰지 않는다. */
export function placeRef(
  layers: InvasionLayers,
  slot: DefenseSlotRef,
  ref: InvasionRef | null,
): InvasionLayers {
  const next = cloneInvasionLayers(layers);
  if (slot.kind === 'wave') next.l1.waveSlots = withSlot(next.l1.waveSlots, slot.index, ref);
  else if (slot.kind === 'socket') next.l2.sockets = withSlot(next.l2.sockets, slot.index, ref);
  else if (slot.kind === 'prop') next.l3.props = withSlot(next.l3.props, slot.index, ref);
  else if (slot.kind === 'boss') next.l3.boss = ref;
  return normalizeInvasionLayers(next);
}

/** 수호 슬롯 배치(또는 비우기). */
export function placeGuardian(
  layers: InvasionLayers,
  index: number,
  placement: InvasionGuardianPlacement | null,
): InvasionLayers {
  const next = cloneInvasionLayers(layers);
  next.l3.guardians = withSlot(next.l3.guardians, index, placement);
  return normalizeInvasionLayers(next);
}

/** 슬롯 비우기(수호 포함). */
export function clearSlot(layers: InvasionLayers, slot: DefenseSlotRef): InvasionLayers {
  if (slot.kind === 'guardian') return placeGuardian(layers, slot.index, null);
  return placeRef(layers, slot, null);
}

/**
 * 회랑 맵 템플릿 교체. 소켓 배열 길이가 템플릿마다 다르므로(12/10/8) **겹치는 앞부분만
 * 승계**하고 나머지는 빈 소켓이 된다. 밀집화하지 않는다 — 소켓 인덱스는 좌표 계약이라
 * 남은 설비를 앞으로 당기면 다른 자리에 서 있게 된다.
 */
export function setTemplateId(layers: InvasionLayers, templateId: number): InvasionLayers {
  const id = Math.max(0, Math.min(INVASION_TEMPLATE_COUNT - 1, Math.trunc(templateId)));
  const size = INVASION_SOCKET_COUNTS[id] ?? 0;
  const next = cloneInvasionLayers(layers);
  const sockets: (InvasionRef | null)[] = [];
  for (let i = 0; i < size; i++) sockets.push(next.l2.sockets[i] ?? null);
  next.l2.templateId = id;
  next.l2.sockets = sockets;
  return normalizeInvasionLayers(next);
}

/** 코어 내구도 변경(1 이상 정수). */
export function setCoreHp(layers: InvasionLayers, hp: number): InvasionLayers {
  const next = cloneInvasionLayers(layers);
  next.l3.core = { ...next.l3.core, hp: Math.max(1, Math.trunc(hp)) };
  return normalizeInvasionLayers(next);
}

/** 두 참조가 같은 방어체를 가리키는가(정수 5필드 전수 비교). */
export function refEquals(a: InvasionRef | null, b: InvasionRef | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.catalogId === b.catalogId &&
    a.level === b.level &&
    a.ascension === b.ascension &&
    a.affixSeed === b.affixSeed &&
    a.rarity === b.rarity
  );
}

/** 배치 전체에서 이 참조를 쓰고 있는 슬롯이 있는가(중복 배치 방지). */
export function isRefPlaced(layers: InvasionLayers, ref: InvasionRef): boolean {
  if (refEquals(layers.l3.boss, ref)) return true;
  for (const s of layers.l1.waveSlots) if (refEquals(s, ref)) return true;
  for (const s of layers.l2.sockets) if (refEquals(s, ref)) return true;
  for (const s of layers.l3.props) if (refEquals(s, ref)) return true;
  return false;
}

/**
 * 이 슬롯에 꽂을 수 있는 보유 방어체 목록.
 * ① 종류가 맞아야 하고(편대는 웨이브에만), ② 이미 다른 칸에 꽂혀 있으면 제외한다.
 * 다만 **지금 이 칸에 꽂혀 있는 것은 남긴다**(선택 상태를 보여 주기 위해).
 */
export function eligibleUnits(
  units: readonly DefenseUnitOwned[],
  layers: InvasionLayers,
  slot: DefenseSlotRef,
): DefenseUnitOwned[] {
  const want = slotCatalogKind(slot.kind);
  const here = slotRef(layers, slot);
  return units.filter((u) => {
    if (u.kind !== want) return false;
    const ref = toInvasionRef(u.unit);
    if (refEquals(ref, here)) return true;
    return !isRefPlaced(layers, ref);
  });
}

/** 슬롯 종류가 속한 탭. */
export function tabForSlot(kind: SlotKind): number {
  if (kind === 'wave') return DEF_TAB_L1;
  if (kind === 'socket') return DEF_TAB_L2;
  return DEF_TAB_L3;
}

/** 탭 → 프리뷰가 보여줄 페이즈(레이어 탭이 아니면 null). */
export function tabPhase(tab: number): InvasionPhase | null {
  if (tab === DEF_TAB_L1) return PHASE_L1;
  if (tab === DEF_TAB_L2) return PHASE_L2;
  if (tab === DEF_TAB_L3) return PHASE_L3;
  return null;
}

/** 화면 상태(순수 데이터 — Pixi 를 모른다). */
export interface CommandState {
  /** 현재 탭. */
  tab: number;
  /** 편집 중 배치(미저장). */
  draft: InvasionLayers;
  /** 마지막으로 저장된 배치(되돌리기 기준). */
  saved: InvasionLayers;
  /** 선택 슬롯(프리뷰 초점 + 팝업 대상). */
  selected: DefenseSlotRef | null;
  /** 탭별 목록 스크롤 위치(탭을 오가도 보존된다). */
  scroll: number[];
  /**
   * 수호 슬롯 i 에 꽂은 {@link GuardianRecord.id} (UI 로컬 · 미저장).
   *
   * 배치 스키마(`InvasionGuardianPlacement`)는 수호를 **스냅샷 + 성능%** 로만 싣고 원본
   * 레코드 id 는 싣지 않는다(wire 계약이라 이 레인이 바꿀 수 없다). 그래서 "이미 꽂은 수호"
   * 판정을 `hp:performanceCP` 로 지어내면 **같은 프리셋·같은 점수로 두 번 퇴역한 기체가
   * 완전히 겹친다** — `retireActiveShip` 이 신규 수호를 항상 `PERFORMANCE_FULL` 로 만들고
   * hp 는 (preset, combatScore)의 순수 함수이며, 퇴역 직후 기체는 장비·투자가 0 이라
   * combatScore 가 1 로 clamp 되기 때문에 연속 퇴역이면 **필연적으로** 같은 키가 된다.
   * 그 결과 수호 2기를 갖고도 슬롯 2 를 영영 못 채웠다.
   *
   * 이 배열은 그 손실을 UI 안에서만 복구한다. 저장본에서 되살아난 슬롯은 id 를 모르므로
   * (`null`) 기존 키 매칭으로 폴백하되, **다중집합으로 한 번씩만 소진**해 중복 기체가
   * 서로를 지우지 않게 한다({@link pickGuardianId}).
   */
  guardianIds: (string | null)[];
}

/** 수호 신원의 **손실 있는** 대체 키(저장본 복원 슬롯 전용 폴백). */
export function guardianFallbackKey(hp: number, performanceCP: number): string {
  return `${hp}:${performanceCP}`;
}

/**
 * 이 슬롯에 새로 꽂을 수호 레코드 id. 없으면 null.
 *
 * - 다른 슬롯이 **id 로** 점유한 기체는 제외한다(정확).
 * - 저장본에서 복원돼 id 를 모르는 슬롯은 대체 키 **다중집합**으로 한 번씩만 소진한다 —
 *   같은 키를 가진 기체가 2기면 1기만 가려지고 나머지 1기는 후보로 남는다.
 * - **대상 슬롯 자신은 점유에서 제외**한다(재배치가 막히면 안 된다).
 */
export function pickGuardianId(
  guardians: readonly GuardianRecord[],
  slots: readonly (InvasionGuardianPlacement | null)[],
  slotIds: readonly (string | null)[],
  target: number,
): string | null {
  const usedIds = new Set<string>();
  const unknown = new Map<string, number>();
  for (let i = 0; i < slots.length; i++) {
    if (i === target) continue;
    const g = slots[i];
    if (g === null || g === undefined) continue;
    const id = slotIds[i] ?? null;
    if (id !== null) {
      usedIds.add(id);
      continue;
    }
    const key = guardianFallbackKey(g.snapshot.hp, g.performanceCP);
    unknown.set(key, (unknown.get(key) ?? 0) + 1);
  }
  for (const g of guardians) {
    if (g.retired) continue;
    if (usedIds.has(g.id)) continue;
    const key = guardianFallbackKey(g.snapshot.hp, g.performanceCP);
    const left = unknown.get(key) ?? 0;
    if (left > 0) {
      unknown.set(key, left - 1); // 이 슬롯이 점유 중인 기체로 간주하고 한 번만 가린다
      continue;
    }
    return g.id;
  }
  return null;
}

/** 저장된 배치에서 화면 상태를 만든다. `saved` 가 없으면 빈 배치에서 시작. */
export function createCommandState(saved: InvasionLayers | null | undefined): CommandState {
  const base = normalizeInvasionLayers(saved ?? emptyInvasionLayers());
  return {
    tab: DEF_TAB_L1,
    draft: cloneInvasionLayers(base),
    saved: cloneInvasionLayers(base),
    selected: { kind: 'wave', index: 0 },
    scroll: new Array<number>(DEF_TAB_COUNT).fill(0),
    guardianIds: new Array<string | null>(INVASION_GUARDIAN_SLOTS).fill(null),
  };
}

/**
 * 탭 전환. **스크롤·초안·선택은 보존한다** — 탭을 오갔다고 편집이 사라지면 안 된다(레이어를
 * 비교해 가며 꽂는 것이 이 화면의 기본 동작이다).
 */
export function setTab(state: CommandState, tab: number): void {
  if (tab < 0 || tab >= DEF_TAB_COUNT) return;
  state.tab = tab;
  // 레이어 탭으로 옮기면 그 레이어의 첫 슬롯을 기본 선택해 프리뷰 초점을 맞춘다.
  const phase = tabPhase(tab);
  if (phase === null) return;
  if (state.selected === null || tabForSlot(state.selected.kind) !== tab) {
    state.selected =
      tab === DEF_TAB_L1
        ? { kind: 'wave', index: 0 }
        : tab === DEF_TAB_L2
          ? { kind: 'socket', index: 0 }
          : { kind: 'boss', index: 0 };
  }
}

/** 저장되지 않은 변경이 있는가(전 필드 깊은 비교 — `layersEqual` 정본). */
export function isDirty(state: CommandState): boolean {
  return !layersEqual(state.draft, state.saved);
}

/**
 * 되돌리기 — 저장본으로 초안을 복원한다. 수호 슬롯의 id 추적도 함께 버린다(복원된 배치가
 * 어느 레코드였는지 알 수 없으므로 대체 키 폴백으로 되돌아간다 — 거짓 신원보다 낫다).
 */
export function revertDraft(state: CommandState): void {
  state.draft = cloneInvasionLayers(state.saved);
  state.guardianIds = new Array<string | null>(INVASION_GUARDIAN_SLOTS).fill(null);
}

/**
 * [시험 침공] 을 눌렀을 때 무엇을 해야 하는가. 미저장 편집이 있으면 **먼저 물어야 한다** —
 * 시험 침공은 화면을 닫고(`hide()` → `cb = null`), 복귀는 `show()` 라 저장본에서 상태를 새로
 * 만든다. 즉 확인 없이 넘기면 방금 편집한 배치로 침공이 정상 실행되므로 편집이 살아 있다고
 * 믿게 되는데, 돌아오면 초안도 '미저장' 경고도 함께 사라져 **무엇을 잃었는지조차 모른다**.
 */
export type TestInvadeAction = 'confirm' | 'go';
export function testInvadeAction(state: CommandState): TestInvadeAction {
  return isDirty(state) ? 'confirm' : 'go';
}

/** 저장 확정 — 초안을 저장본으로 승격한다(서버 업로드 성공 여부와 무관한 로컬 정본). */
export function commitDraft(state: CommandState): void {
  state.saved = cloneInvasionLayers(state.draft);
}

// --- 표시 파생 -------------------------------------------------------------

/** 카탈로그 표시명(미등록이면 종류·번호를 그대로 보여 준다 — 조용한 공백 금지). */
export function catalogName(kind: number, catalogId: number): string {
  const entry = catalogEntry(kind, catalogId);
  if (entry === undefined) return `#${kind}-${catalogId}`;
  return tCmd(def3NameKey(entry.i18nId));
}

/** 등급 표시명. */
export function rarityLabel(rarity: Rarity): string {
  return tCmd(`def3.cmd.rarity.${rarity}`);
}

/** 승급 별 표시(컬러 이모지 금지 — 기하 기호만). */
export function ascensionMark(ascension: number): string {
  if (ascension <= 0) return '';
  return ' ' + '*'.repeat(Math.min(5, ascension));
}

/** 방어체 한 줄 요약(등급 · 이름 · 레벨 · 승급 · 전력 배율). */
export function unitSummary(unit: DefenseUnitInstance): string {
  // 전력 배율은 sim 정본 산식(`defenseUnitScaleStat`)에서 파생한다 — 표기 전용 산식을 따로
  // 두면 표기와 실제 스탯이 갈린다(계약). 등급은 코드(0..3)로 넘긴다.
  const power = defenseUnitPowerBp(
    unit.kind,
    unit.level,
    unit.ascension,
    defenseUnitRarityRank(unit.rarity),
  );
  return (
    `${rarityLabel(unit.rarity)} ${catalogName(unit.kind, unit.catalogId)}` +
    `${ascensionMark(unit.ascension)} · ` +
    `${tCmd('def3.cmd.unit.level', { n: unit.level })} · ` +
    `${tCmd('def3.cmd.unit.power', { p: Math.round(power / 100) })}`
  );
}

/**
 * 어픽스 한 줄(상시/조건부 분리 표기 — 합쳐 쓰면 항상 실린다고 오독한다).
 *
 * **유니크 고유 효과를 맨 앞에 싣는다**(M7c 통합 게이트). `defenseUnitUnique` 는 sim 에서만
 * 소비되고 화면에는 한 곳도 배선되지 않아, 유니크 방어체를 뽑아도 플레이어가 그 사실을 알
 * 방법이 없었다 — 어픽스가 하나도 없는 유니크는 오히려 "기본 스탯뿐"으로 표기됐다. 유니크는
 * 런 상태의 연속 함수라 어픽스 문법으로 표현되지 않으므로 값 대신 이름만 표기하고, 수치는
 * `def3.duq.<id>.desc` 가 담는다.
 */
export function unitAffixLine(unit: DefenseUnitInstance): string {
  const parts: string[] = [];
  const unique = defenseUnitUnique(unit);
  if (unique !== null) parts.push(`[${tCmd(defenseUniqueNameKey(unique.id))}]`);
  for (const r of unit.prefixes) parts.push(`${tCmd(defenseUnitAffixNameKey(r.id))} +${r.value}`);
  for (const r of unit.suffixes) {
    parts.push(`(${tCmd('def3.cmd.unit.affix.cond')}) ${tCmd(defenseUnitAffixNameKey(r.id))} +${r.value}`);
  }
  return parts.length === 0 ? tCmd('def3.cmd.unit.affix.none') : parts.join(' · ');
}

/** 비용 한 줄(0 인 항목은 생략 — "0 설계도"는 읽는 사람을 헷갈리게 한다). */
export function costLine(cost: { credits: number; minerals: number; blueprints: number } | null): string {
  if (cost === null) return tCmd('def3.cmd.unit.max');
  const parts: string[] = [];
  if (cost.credits > 0) parts.push(`${cost.credits} cr`);
  if (cost.minerals > 0) parts.push(`${cost.minerals} min`);
  if (cost.blueprints > 0) parts.push(`${cost.blueprints} bp`);
  return parts.length === 0 ? '-' : parts.join(' / ');
}

// ===========================================================================
// 레이아웃(디자인 스페이스 1920×1080) — Pixi 없이 검증되는 순수 서술
//
// 여백 어휘(32 / 28 / 20 / 하단 28)와 헤더 높이 104 는 격납고·촉매 보관함·예비역 로스터·
// 챔피언 선택·연구소·정제소와 **같은 값**이다. 형제 화면끼리 다르면 화면 전환에서 튄다.
// ===========================================================================

/**
 * `cinematicPanel.ts` 콘텐츠 상자 기하의 **복제본**(출처: 그 파일의 `EDGE_PAD 24` ·
 * `CONTENT_GAP 16` · `TITLE_BAND_H = round(TITLE_SIZE 26 × 2)`).
 *
 * 왜 베끼는가: 좌표 서술이 **Pixi 없이** 검증돼야 하는데 패널 상자는 런타임 객체다. 베낀 값이
 * 조용히 어긋나면 내용이 패널 테두리를 뚫는데 예외도 로그도 없다 —
 * `tests/defenseCommandAaaLayout.test.ts` 가 실제 `makeCinematicPanel(...).box` 와 대조한다.
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
 * ⚠️ {@link TAB_Y} 가 이 값에서 파생되므로 **선언 순서를 바꾸지 마라**(TDZ).
 */
export const GEAR_BAND_W = 120;
export const GEAR_BAND_H = 120;

/** 탭 줄. 4칸이 콘텐츠 폭을 정확히 나눠 쓴다(칸 폭은 파생값). */
const CONTENT_W = DESIGN_WIDTH - EDGE_X * 2;
/**
 * 탭 줄 상단. 헤더 밴드(104) 바로 아래가 아니라 **{@link GEAR_BAND_H}(120) 아래**다 —
 * 첫 탭이 화면 좌측 끝에서 시작하므로 설정 톱니 예약 밴드와 가로로 겹치고, 세로로 8px 만
 * 물려도 톱니가 매 프레임 맨 앞으로 올라와 그 자리를 통째로 삼킨다(테스트가 잠근다).
 */
const TAB_Y = GEAR_BAND_H + 4;
const TAB_H = 56;
const TAB_GAP = 12;
const TAB_W = Math.floor((CONTENT_W - TAB_GAP * (DEF_TAB_COUNT - 1)) / DEF_TAB_COUNT);

/** 하단 액션 띠 — 오른쪽에 버튼 셋, 왼쪽 절반은 상태 문구가 쓴다(빈 자리 0). */
const FOOT_H = 64;
const FOOT_Y = DESIGN_HEIGHT - BOTTOM_PAD - FOOT_H;
const FOOT_GAP = 16;
const SAVE_W = 260;
const REVERT_W = 200;
const TEST_W = 240;
const FOOT_BTN_W = SAVE_W + REVERT_W + TEST_W + FOOT_GAP * 2;
const FOOT_BTN_X = EDGE_X + CONTENT_W - FOOT_BTN_W;

/** 패널 세로는 **남는 자리 전부**다(빈 자리 금지 — 하드코딩하면 여백을 바꿀 때 어긋난다). */
const PANEL_Y = TAB_Y + TAB_H + 16;
const PANEL_TO_FOOT = 16;
const PANEL_H = FOOT_Y - PANEL_TO_FOOT - PANEL_Y;
const LEFT_X = EDGE_X;
const LEFT_W = 1100;
const RIGHT_X = LEFT_X + LEFT_W + GUTTER_X;
const RIGHT_W = DESIGN_WIDTH - EDGE_X - RIGHT_X;

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

const BOX_L = titledBox(LEFT_W, PANEL_H);
const BOX_R = titledBox(RIGHT_W, PANEL_H);

/** L3 코어 블록(코어 내구도 + [모듈 관리]) — 슬롯 목록 위에 고정으로 앉는다. */
const CORE_BLOCK_H = 96;
const CORE_BLOCK_GAP = 16;

/** 회랑 맵 템플릿 선택 줄(L2 전용) — 코어 블록과 같은 자리에 앉는다. */
const TEMPLATE_BLOCK_H = 96;

/** 슬롯 행 위 버튼. */
const ROW_GAP = 10;
const ROW_BTN_W = 104;
const ROW_BTN_H = 40;
const ROW_PAD = 16;

// --- 헤더 컨트롤(정제소·연구소와 **같은 x**) ---
const HEAD_GAP = 12;
const CHIP_W = 190;
const CLOSE_W = 56;
const CLOSE_X = DESIGN_WIDTH - EDGE_X - CLOSE_W;
const CREDIT_CHIP_X = CLOSE_X - HEAD_GAP - 2 - CHIP_W;
const MINERAL_CHIP_X = CREDIT_CHIP_X - HEAD_GAP - 2 - CHIP_W;

/**
 * 각인 제목이 실제로 차지하는 가로 반폭. 중앙 정렬 Text 는 사각형이 없어 겹침 테스트가 못
 * 잡는다 — 연구소 실화면에서 제목이 헤더 버튼과 **실제로 겹쳤다**. 대역을 상수로 못 박고
 * 좌우 컨트롤이 이 안에 들어오지 못하게 테스트로 잠근다.
 */
export const TITLE_BAND_HALF_W = 280;

/** 석재 슬래브 위 **보조 텍스트색**(정제소 `SLAB_BODY_FILL` 복제 — 그 파일은 화면이다). */
const SLAB_BODY_FILL = 0xe4dac7;
/** 행 판 바탕색·홈·반경 — 예비역 로스터 `rowPlate` → 챔피언 선택 → 연구소 → 정제소 경유 복제. */
const ROW_FACE = 0x3b3327;
const ROW_GROOVE = 0x17130d;
const ROW_RADIUS = 10;
/** 미저장 경고색(구 구현 승계). */
const WARN_COLOR = 0xffb14c;
/** 배치 완료 표식색(구 구현 승계 — 글자색으로만 쓴다). */
const PLACED_COLOR = 0x8fd94c;

/** 화면 좌표 사각형(디자인 스페이스). */
export interface DefenseRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 프리뷰가 그려질 뷰포트 = 왼쪽 패널의 콘텐츠 상자(화면 좌표).
 * 배경 `windows` 도 **정확히 이 사각형**이다 — 창과 프리뷰가 어긋나면 밝기 보존이 헛돈다.
 */
const PREVIEW_VIEWPORT: DefenseRect = {
  x: LEFT_X + BOX_L.x,
  y: PANEL_Y + BOX_L.y,
  w: BOX_L.w,
  h: BOX_L.h,
};

/**
 * 이 화면의 레이아웃 전량 — **Pixi 없이 검증되는 순수 서술**이다.
 *
 * 왜 내보내는가: 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고,
 * 캔버스 없는 vitest 는 화면을 세울 수 없어 눈으로만 잡히는 유형이 된다. 좌표를 순수 값으로
 * 꺼내 두면 겹침·화면 이탈·톱니 예약 밴드 침범을 단위 테스트가 잠근다.
 */
export function defenseCommandLayout(): {
  readonly screen: DefenseRect;
  readonly headerH: number;
  readonly tabs: readonly DefenseRect[];
  readonly panels: readonly { readonly id: string; readonly rect: DefenseRect }[];
  readonly footer: { readonly band: DefenseRect; readonly buttons: readonly DefenseRect[] };
  readonly headerControls: readonly { readonly id: string; readonly rect: DefenseRect }[];
  /** 배경이 보존되는 창 — **배치 프리뷰 하나**(파일 헤더 "왜 여기는 창을 뚫는가"). */
  readonly windows: readonly DefenseRect[];
} {
  const head = (x: number, w: number): DefenseRect => ({ x, y: HEAD_Y, w, h: HEAD_H });
  const tabs: DefenseRect[] = [];
  for (let i = 0; i < DEF_TAB_COUNT; i++) {
    tabs.push({ x: EDGE_X + i * (TAB_W + TAB_GAP), y: TAB_Y, w: TAB_W, h: TAB_H });
  }
  let fx = FOOT_BTN_X;
  const buttons: DefenseRect[] = [];
  for (const w of [SAVE_W, REVERT_W, TEST_W]) {
    buttons.push({ x: fx, y: FOOT_Y, w, h: FOOT_H });
    fx += w + FOOT_GAP;
  }
  return {
    screen: { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT },
    headerH: HEADER_H,
    tabs,
    panels: [
      { id: 'left', rect: { x: LEFT_X, y: PANEL_Y, w: LEFT_W, h: PANEL_H } },
      { id: 'right', rect: { x: RIGHT_X, y: PANEL_Y, w: RIGHT_W, h: PANEL_H } },
    ],
    footer: {
      band: { x: EDGE_X, y: FOOT_Y, w: CONTENT_W, h: FOOT_H },
      buttons,
    },
    headerControls: [
      { id: 'minerals', rect: head(MINERAL_CHIP_X, CHIP_W) },
      { id: 'credits', rect: head(CREDIT_CHIP_X, CHIP_W) },
      { id: 'close', rect: head(CLOSE_X, CLOSE_W) },
    ],
    windows: [PREVIEW_VIEWPORT],
  };
}

/** 패널 콘텐츠 상자와 그 안의 고정 블록(단위 테스트가 실제 패널 상자와 대조한다). */
export const DEFENSE_BOXES = {
  left: { x: BOX_L.x, y: BOX_L.y, w: BOX_L.w, h: BOX_L.h, bottom: BOX_L.bottom },
  right: { x: BOX_R.x, y: BOX_R.y, w: BOX_R.w, h: BOX_R.h, bottom: BOX_R.bottom },
  /** L3 코어 블록 · L2 템플릿 줄 — 상자 맨 위에 앉고 목록이 그만큼 아래에서 시작한다. */
  coreBlockH: CORE_BLOCK_H,
  templateBlockH: TEMPLATE_BLOCK_H,
  blockGap: CORE_BLOCK_GAP,
  /** 슬롯 행 폭에서 버튼 둘과 여백을 뺀 글자 폭 — 하한이 있어야 이름이 뭉개지지 않는다. */
  rowTextW: BOX_R.w - ROW_BTN_W * 2 - ROW_PAD * 2 - 12,
} as const;

/**
 * 팝업 세 종의 기하. 높이를 **내용에서 역산**해 버려지는 세로가 0 이다.
 *
 * `68 = TITLE_BAND_H(52) + CONTENT_GAP(16)` · `24 = EDGE_PAD` — 제목 띠가 있는 시네마틱
 * 패널의 콘텐츠 상자 기하다. `makeModal`(나무)은 고치지 않는다(다른 화면 다섯이 쓴다).
 */
const PICK_ROW_H = 92;
const PICK_ROW_GAP = 10;
const PICK_PITCH = PICK_ROW_H + PICK_ROW_GAP;
const PICK_ROWS_MIN = 3;
const PICK_ROWS_MAX = 7;

/** 방어체 고르기 팝업 높이 — 행 수에서 역산(빈 자리 0). 행 수는 [3, 7] 로 클램프한다. */
export function pickModalHeight(rowCount: number): number {
  const n = Math.max(PICK_ROWS_MIN, Math.min(PICK_ROWS_MAX, Math.trunc(rowCount)));
  return TITLED_BOX_Y + (n * PICK_PITCH - PICK_ROW_GAP) + PANEL_EDGE_PAD;
}

/** 강화 팝업 세로 뭉치(머리 → 어픽스 챔버 → 등급 → 강화 4행). */
const UNIT_HEAD_H = 34;
const UNIT_AFFIX_H = 64;
const UNIT_TIER_H = 26;
const UNIT_ACT_H = 56;
const UNIT_ACT_GAP = 12;
const UNIT_ACT_ROWS = 4;
const UNIT_BLOCK_H =
  UNIT_HEAD_H + 10 + UNIT_AFFIX_H + 10 + UNIT_TIER_H + 18 + (UNIT_ACT_ROWS * (UNIT_ACT_H + UNIT_ACT_GAP) - UNIT_ACT_GAP);

/** 확인 팝업 세로 뭉치(본문 → 버튼 한 줄). */
const CONFIRM_BODY_H = 110;
const CONFIRM_BTN_H = 56;
const CONFIRM_BLOCK_H = CONFIRM_BODY_H + 20 + CONFIRM_BTN_H;

export const DEFENSE_MODALS = {
  pick: {
    w: 1180,
    rowH: PICK_ROW_H,
    rowGap: PICK_ROW_GAP,
    pitch: PICK_PITCH,
    rowsMin: PICK_ROWS_MIN,
    rowsMax: PICK_ROWS_MAX,
  },
  unit: { w: 900, h: TITLED_BOX_Y + UNIT_BLOCK_H + PANEL_EDGE_PAD, blockH: UNIT_BLOCK_H },
  confirm: { w: 900, h: TITLED_BOX_Y + CONFIRM_BLOCK_H + PANEL_EDGE_PAD, blockH: CONFIRM_BLOCK_H },
  /** 콘텐츠 상자 기하(세 팝업 공통) — 테스트가 역산식을 되짚는다. */
  boxY: TITLED_BOX_Y,
  edgePad: PANEL_EDGE_PAD,
} as const;

/**
 * 화면 루트에서 프리뷰 노드가 놓일 z 인덱스 — **맨 앞**.
 *
 * 예전엔 인덱스 1(배경 바로 위)로 내렸다 — "패널을 뚫지 않게" 하려던 것인데, 프리뷰 액자
 * 패널이 그 위를 반투명으로 덮어 실측 기여분이 **4.6%** 였다(프리뷰 배경 `0x0b0a18` 이 화면에
 * (27,23,45) 로, 마커 링 `0xff6a5a` 가 (37,27,48) 로 찍혔다). 즉 프레이밍·마커를 아무리 고쳐도
 * 액자 뒤에 묻혀 사실상 빈 상자였다. 프리뷰는 자기 뷰포트로 마스크되고 그 뷰포트는 창 안쪽이라
 * 맨 앞에 둬도 다른 UI 를 가리지 않는다. 팝업이 뜨면 `stop()` 이 노드를 떼므로 팝업도 안전하다.
 *
 * 순수 함수로 빼 둔 이유는 노드 없이 이 계약을 테스트하기 위해서다(vitest 는 node 환경이라
 * Pixi 표시 객체를 만들 수 없다).
 */
export function previewChildIndex(childCount: number): number {
  return Math.max(0, childCount - 1);
}

// --- 행 판 조명 램프(모듈 1회 굽기) ------------------------------------------

/**
 * 행 판의 **방향성 조명**을 위한 세로 알파 램프.
 *
 * ⚠️ 띠를 겹쳐 그라디언트를 근사하지 않는다 — 1px 겹침이 알파를 두 배로 만들어 가로줄이 생긴다
 * (실제 사용자 신고). 폭 1px 캔버스에 픽셀로 굽고 `linear` 로 늘린다.
 *
 * (예비역 로스터 `rowRamp` → 챔피언 선택 → 연구소 → 정제소 경유 복제. 형제 화면이라 같은 값이어야
 * 하고, 그 파일들은 공용 모듈이 아니라 화면이라 import 하지 않는다.)
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
 * **파낸 면** 한 장(빈 보관 챔버 · 코어 블록 · 어픽스 챔버가 공유한다). 볼록한
 * {@link rowPlate} 와 조명 부호가 정확히 반대다: 위가 그늘이고 **아래 입술만** 빛을 받는다.
 * 이 부호가 뒤집히면 파인 자리가 아니라 얹어 놓은 판때기로 읽힌다.
 * (정제소 `recessedWell` 복제 — 그 파일은 공용 모듈이 아니라 화면이다.)
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

/** 팝업 종류. `confirmTest` = 미저장 편집이 있는 채로 시험 침공을 누른 경우의 확인. */
type ModalKind = 'pick' | 'unit' | 'confirmTest' | null;

/** 방어 사령부 화면 콜백. */
export interface DefenseCommandCallbacks {
  /** 닫기(기지 맵 복귀). */
  onClose: () => void;
  /**
   * 시험 침공 — 지금 편집 중인 배치로 **오염 런**을 띄운다(ADR-0008). 정산·리플레이 제출
   * 경로를 타지 않는 하네스 침공 경로여야 한다. 배선은 `src/main.ts` 가 한다.
   */
  onTestInvade: (layers: InvasionLayers) => void;
  /**
   * 코어 모듈 화면 진입. 이 화면은 **감췄다가 그대로 되살아난다**(suspend/resume) —
   * `show()` 로 되돌리면 미저장 배치 편집이 날아간다(실측 규율).
   */
  onOpenModules: (resume: () => void) => void;
}

export class DefenseCommandScreen {
  private readonly stage: Container;
  private readonly root = new Container();
  private ui: UiTextures = {};
  private art: HangarTextures = {};
  private profile: Profile;
  private readonly store: KeyValueStore | null;
  private readonly preview: DefensePreviewControls;
  private cb: DefenseCommandCallbacks | null = null;

  private state: CommandState = createCommandState(null);
  private modal: ModalKind = null;
  private modalScroll = 0;
  /** 강화 팝업 대상(보관함 행 uuid). */
  private focusUnitId: string | null = null;

  // 서버 상태.
  private online = false;
  private loading = true;
  private loadToken = 0;
  private units: DefenseUnitOwned[] = [];
  private blueprints: BlueprintOwned[] = [];
  private busy = false;
  private msgText = '';

  /** 진입 시점의 런 HUD `visibility` 인라인 값(닫을 때 그대로 되돌린다). */
  private hudPrevVisibility: string | null = null;

  // --- 유지되는 크롬(파일 헤더 "재렌더 규율") ---
  private backdrop: HangarBackdrop | null = null;
  private panels: CinematicPanel[] = [];
  private chromeBuilt = false;
  private previewPanel: CinematicPanel | null = null;
  private slotsPanel: CinematicPanel | null = null;
  private unitsPanel: CinematicPanel | null = null;
  private bpPanel: CinematicPanel | null = null;
  private slotsHost: Container | null = null;
  private unitsHost: Container | null = null;
  private bpHost: Container | null = null;
  private chipHost: Container | null = null;
  private modalHost: Container | null = null;
  private modalPanel: CinematicPanel | null = null;
  private msgTextNode: Text | null = null;
  private dirtyNode: Text | null = null;
  private tabButtons: { btn: PixiButton; ring: Graphics }[] = [];
  private footButtons: { save: PixiButton; revert: PixiButton } | null = null;

  constructor(
    profile: Profile,
    stage: Container,
    preview: DefensePreviewControls,
    store: KeyValueStore | null = null,
  ) {
    this.profile = profile;
    this.store = store;
    this.stage = stage;
    this.preview = preview;
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

  /** 화면 열기. 저장된 배치에서 편집 상태를 새로 만든다. */
  show(profile: Profile, cb: DefenseCommandCallbacks): void {
    this.profile = profile;
    this.cb = cb;
    this.state = createCommandState(profile.defenseLayout ?? null);
    this.modal = null;
    this.focusUnitId = null;
    this.msgText = '';
    this.busy = false;
    this.loading = true;
    this.online = false;
    this.units = [];
    this.blueprints = [];
    this.root.visible = true;
    this.buildChrome();
    this.raise();
    this.hideRunHud();
    // 프리뷰는 이 화면의 자식으로 산다 — 순서는 placePreview 가 매번 다시 맞춘다.
    this.preview.attachTo(this.root);
    this.refresh();
    void this.load();
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    this.preview.stop();
    this.restoreRunHud();
  }

  /**
   * 다른 캔버스 화면(코어 모듈)에 자리를 내주고 잠시 감춘다. **상태는 그대로 남는다** —
   * 되살아날 때 `show()` 를 다시 부르면 미저장 편집이 사라지므로 이 쌍을 쓴다.
   */
  suspend(): void {
    this.root.visible = false;
    this.preview.stop();
  }

  resume(): void {
    this.root.visible = true;
    this.raise();
    this.preview.attachTo(this.root);
    this.refresh();
  }

  /** 이 화면을 stage 맨 앞으로(뒤에 붙은 런 레이어·프리뷰 위로). */
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

  // --- 로드 ----------------------------------------------------------------

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    const uid = await getDefenseUnitsUserId();
    if (token !== this.loadToken || !this.visible) return;
    if (uid === null) {
      this.online = false;
      this.loading = false;
      this.refresh();
      return;
    }
    this.online = true;
    const [units, bps] = await Promise.all([listDefenseUnits(), listBlueprints()]);
    if (token !== this.loadToken || !this.visible) return;
    this.units = units ?? [];
    this.blueprints = bps ?? [];
    this.loading = false;
    this.refresh();
  }

  private async reload(): Promise<void> {
    if (!this.online) return;
    const token = ++this.loadToken;
    const [units, bps] = await Promise.all([listDefenseUnits(), listBlueprints()]);
    if (token !== this.loadToken || !this.visible) return;
    if (units !== null) this.units = units;
    if (bps !== null) this.blueprints = bps;
    this.refresh();
  }

  // --- 배치 저장 -----------------------------------------------------------

  /**
   * 로컬 저장(즉시) → 서버 업로드(fire-and-forget, 결과만 토스트로 승격).
   *
   * ⚠ `busy` 해제는 **finally** 여야 한다. 예전에는 await 뒤 `if (!this.visible) return;` 이
   * 해제보다 먼저 있어, 업로드 중에 [코어 모듈 열기]로 suspend 되면 busy 가 true 로 굳었다.
   * `resume()` 은 busy 를 건드리지 않고 리셋은 `show()` 뿐이라 복귀 후 저장·되돌리기·배치·
   * 강화·제작 버튼이 **영구 비활성**이 됐다.
   */
  private async saveLayout(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const layers = cloneInvasionLayers(this.state.draft);
    let result: unknown;
    try {
      this.profile.defenseLayout = layers;
      saveProfile(this.profile, this.store ?? undefined);
      commitDraft(this.state);
      this.msgText = tCmd('def3.cmd.savedLocal');
      this.refresh();
      result = await uploadDefenseLayout(layers);
    } finally {
      this.busy = false;
    }
    if (!this.visible) return;
    this.msgText = result === null ? tCmd('def3.cmd.savedLocal') : tCmd('def3.cmd.saved');
    this.refresh();
  }

  /** 서버가 돌려준 잔액을 프로필에 반영·영속(정비 크레딧 pull 선례). */
  private pullServerCurrency(result: DefenseUnitUpgradeResult): void {
    if (result.credits !== undefined) this.profile.credits = result.credits;
    if (result.minerals !== undefined) this.profile.minerals = result.minerals;
    saveProfile(this.profile, this.store ?? undefined);
    const store = this.pendingStore();
    if (store !== null) refreshPendingProfile(store, this.profile);
  }

  private pendingStore(): KeyValueStore | null {
    if (this.store !== null) return this.store;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
      // 사생활 모드 등 — 접근 자체가 throw 할 수 있다.
    }
    return null;
  }

  /** 강화 RPC 공통 처리(성공 → 잔액 pull + 보관함 재조회). */
  private async runUpgrade(fn: () => Promise<DefenseUnitUpgradeResult | null>): Promise<void> {
    if (this.busy || !this.online) {
      if (!this.online) this.msgText = tCmd('def3.cmd.err.offline');
      this.refresh();
      return;
    }
    this.busy = true;
    this.refresh();
    // busy 해제는 finally — suspend 중 완료돼도 잠금이 남지 않는다(saveLayout 주석 참고).
    let result: DefenseUnitUpgradeResult | null;
    try {
      result = await fn();
    } finally {
      this.busy = false;
    }
    if (!this.visible) return;
    if (result === null || !result.ok) {
      this.msgText = result?.code !== undefined ? result.code : tCmd('def3.cmd.err.failed');
    } else {
      this.pullServerCurrency(result);
      this.msgText = tCmd('def3.cmd.ok.upgrade');
    }
    await this.reload();
  }

  // --- 상호작용 ------------------------------------------------------------

  private select(slot: DefenseSlotRef): void {
    this.state.selected = slot;
    this.syncPreview();
    this.refresh();
  }

  private mutate(next: InvasionLayers): void {
    this.state.draft = next;
    this.syncPreview();
    this.refresh();
  }

  /** 프리뷰를 현재 초안·탭·선택 슬롯에 맞춘다. */
  private syncPreview(): void {
    const phase = tabPhase(this.state.tab);
    this.preview.setLayers(this.state.draft);
    if (phase === null) return;
    const sel = this.state.selected;
    const slotIndex = sel !== null && sel.kind === 'wave' ? sel.index : 0;
    this.preview.setFocus(phase, slotIndex);
  }

  private openModal(kind: Exclude<ModalKind, null>): void {
    this.modal = kind;
    this.modalScroll = 0;
    this.refresh();
  }

  private closeModal(): void {
    this.modal = null;
    this.refresh();
  }

  private close(): void {
    const cb = this.cb;
    this.hide();
    cb?.onClose();
  }

  /** 시험 침공 실행 — 현재 초안으로 오염 런을 띄우고 화면을 닫는다(ADR-0008). */
  private startTestInvade(): void {
    const cb = this.cb;
    const layers = cloneInvasionLayers(this.state.draft);
    this.modal = null;
    this.hide();
    cb?.onTestInvade(layers);
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
    weight: '400' | '700' = '400',
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
   * 비어 있는 패널을 **파낸 보관 챔버**로 그리고 그 안에서 안내한다.
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
    const el = this.wrapped(text, 20, SLAB_BODY_FILL, box.w - 96);
    el.anchor.set(0.5, 0.5);
    el.position.set(box.x + box.w / 2, box.y + box.h / 2);
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
    this.previewPanel = null;
    this.slotsPanel = null;
    this.unitsPanel = null;
    this.bpPanel = null;
    this.slotsHost = null;
    this.unitsHost = null;
    this.bpHost = null;
    this.chipHost = null;
    this.modalHost = null;
    this.msgTextNode = null;
    this.dirtyNode = null;
    this.tabButtons = [];
    this.footButtons = null;
    const previewNode = this.preview.layer;
    for (const child of [...this.root.children]) {
      // 프리뷰 노드는 이 화면이 만든 것이 아니다 — 떼기만 하고 **절대 destroy 하지 않는다**.
      this.root.removeChild(child);
      if (child === previewNode) continue;
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
    // 자식이라 어긋난다). 창은 **프리뷰 뷰포트 하나**다 — 파일 헤더 참조.
    const backdrop = new HangarBackdrop(this.art[HANGAR_BACKDROP_NAME], {
      windows: [PREVIEW_VIEWPORT],
      headerH: HEADER_H,
    });
    this.root.addChild(backdrop.view);
    this.backdrop = backdrop;

    this.buildHeader();
    this.buildTabs();

    // 패널 4장을 한 번에 세운다(§ 파일 헤더 "모든 탭이 같은 패널 기하를 쓴다").
    this.previewPanel = this.addPanel(
      LEFT_X,
      PANEL_Y,
      LEFT_W,
      PANEL_H,
      tCmd('def3.cmd.preview'),
      'window',
    );
    this.slotsPanel = this.addPanel(RIGHT_X, PANEL_Y, RIGHT_W, PANEL_H, tCmd('def3.cmd.slots'), 'slab');
    this.unitsPanel = this.addPanel(LEFT_X, PANEL_Y, LEFT_W, PANEL_H, tCmd('def3.cmd.inv.head'), 'slab');
    this.bpPanel = this.addPanel(
      RIGHT_X,
      PANEL_Y,
      RIGHT_W,
      PANEL_H,
      tCmd('def3.cmd.inv.blueprints'),
      'slab',
    );

    const slotsHost = new Container();
    this.slotsPanel.container.addChild(slotsHost);
    this.slotsHost = slotsHost;
    const unitsHost = new Container();
    this.unitsPanel.container.addChild(unitsHost);
    this.unitsHost = unitsHost;
    const bpHost = new Container();
    this.bpPanel.container.addChild(bpHost);
    this.bpHost = bpHost;

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
  private addPanel(
    px: number,
    py: number,
    pw: number,
    ph: number,
    title: string,
    variant: 'slab' | 'window',
  ): CinematicPanel {
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
    return panel;
  }

  /**
   * 헤더 밴드(y 0..{@link HEADER_H}) — 각인 제목(중앙) · 재화 칩 2종 · 닫기(우).
   *
   * ⚠️ 컨트롤은 **전부 같은 세로 띠**를 쓰고 가로로만 배치한다(격납고 헤더 겹침 결함 이력).
   * ⚠️ **각인 석재 인방은 넣지 않는다**(격납고에서 사용자 판단으로 제거됨). 헤더는 배경이 그대로
   * 보이는 띠이고, 배경 모듈이 이 대역을 중간 세기로 눌러 글자 대비를 보장한다.
   * ⚠️ 좌측은 **비워 둔다** — x<120 · y<120 은 설정 톱니 예약 밴드다.
   */
  private buildHeader(): void {
    const title = makeHangarTitle(tCmd('def3.cmd.title'));
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
   * 탭 4칸. 나무 `makeTabBar` 를 버리고 정제소 정렬 라디오와 **같은 어휘**를 쓴다 —
   * 금색 링 + 미선택 0.72. 톤을 바꾸면 활성/비활성마다 버튼을 다시 구워야 하는데(텍스처가
   * 톤별로 구워진다) 탭은 자주 바뀌므로 링·알파로 상태를 말한다.
   */
  private buildTabs(): void {
    for (let i = 0; i < DEF_TAB_COUNT; i++) {
      const x = EDGE_X + i * (TAB_W + TAB_GAP);
      const host = new Container();
      host.position.set(x, TAB_Y);
      const btn = this.chromeButton({
        tone: 'stone',
        width: TAB_W,
        height: TAB_H,
        fontSize: 20,
        label: tCmd(DEF_TAB_KEYS[i] ?? ''),
        onClick: () => {
          setTab(this.state, i);
          this.syncPreview();
          this.refresh();
        },
      });
      host.addChild(btn.container);
      const ring = new Graphics();
      ring
        .roundRect(0, 0, TAB_W, TAB_H, 12)
        .stroke({ color: COLOR.gold, width: 3, alignment: 1, alpha: 0.95 });
      ring.visible = false;
      // 링은 히트 테스트에서 빠져야 한다 — 안 그러면 활성 탭의 클릭을 링이 삼킨다.
      ring.eventMode = 'none';
      host.addChild(ring);
      this.root.addChild(host);
      this.tabButtons.push({ btn, ring });
    }
  }

  /**
   * 하단 액션 띠 — 오른쪽에 [저장][되돌리기][시험 침공], 왼쪽에 상태 문구.
   *
   * 옛 구현의 [기지로 돌아가기]는 **없앴다**(헤더 ✕ 와 같은 일을 두 번 했다). 버튼을 오른쪽에
   * 몰고 상태 문구를 왼쪽에 두면 이 띠 안에 빈 자리가 없다.
   */
  private buildFooter(): void {
    let x = FOOT_BTN_X;
    const save = this.chromeButton({
      tone: 'gold',
      width: SAVE_W,
      height: FOOT_H,
      fontSize: 21,
      label: tCmd('def3.cmd.save'),
      onClick: () => void this.saveLayout(),
    });
    save.container.position.set(x, FOOT_Y);
    this.root.addChild(save.container);
    x += SAVE_W + FOOT_GAP;

    const revert = this.chromeButton({
      tone: 'stone',
      width: REVERT_W,
      height: FOOT_H,
      fontSize: 21,
      label: tCmd('def3.cmd.revert'),
      onClick: () => {
        revertDraft(this.state);
        this.syncPreview();
        this.refresh();
      },
    });
    revert.container.position.set(x, FOOT_Y);
    this.root.addChild(revert.container);
    x += REVERT_W + FOOT_GAP;

    const test = this.chromeButton({
      tone: 'blue',
      width: TEST_W,
      height: FOOT_H,
      fontSize: 21,
      label: tCmd('def3.cmd.test'),
      onClick: () => {
        // 미저장 편집이 있으면 먼저 묻는다(testInvadeAction 주석 = 근거).
        if (testInvadeAction(this.state) === 'confirm') this.openModal('confirmTest');
        else this.startTestInvade();
      },
    });
    test.container.position.set(x, FOOT_Y);
    this.root.addChild(test.container);

    this.footButtons = { save, revert };

    const dirty = this.label('', 18, WARN_COLOR, '700');
    dirty.anchor.set(0, 0.5);
    dirty.position.set(EDGE_X, FOOT_Y + 18);
    dirty.visible = false;
    this.root.addChild(dirty);
    this.dirtyNode = dirty;

    const msg = this.label('', 19, COLOR.gold, '700');
    msg.anchor.set(0, 0.5);
    msg.position.set(EDGE_X, FOOT_Y + FOOT_H - 18);
    msg.visible = false;
    this.root.addChild(msg);
    this.msgTextNode = msg;
  }

  // --- 갱신 -----------------------------------------------------------------

  /** 값과 목록만 갈아끼운다. 배경·석재 패널은 다시 굽지 않는다(파일 헤더 "재렌더 규율"). */
  private refresh(): void {
    if (!this.chromeBuilt) return;
    this.syncValues();
    this.renderSlots();
    this.renderUnits();
    this.renderBlueprints();
    this.renderModal();
    this.placePreview();
  }

  private syncValues(): void {
    const tab = this.state.tab;
    const layerTab = tabPhase(tab) !== null;

    if (this.previewPanel !== null) this.previewPanel.container.visible = layerTab;
    if (this.slotsPanel !== null) this.slotsPanel.container.visible = layerTab;
    if (this.unitsPanel !== null) this.unitsPanel.container.visible = !layerTab;
    if (this.bpPanel !== null) this.bpPanel.container.visible = !layerTab;

    this.tabButtons.forEach((e, i) => {
      const active = i === tab;
      e.ring.visible = active;
      e.btn.container.alpha = active ? 1 : 0.72;
    });

    if (this.chipHost !== null) {
      const host = this.chipHost;
      for (const child of [...host.children]) {
        host.removeChild(child);
        child.destroy({ children: true });
      }
      // 광물 = 청록 · 크레딧 = 금. 색만으로 두 칩이 구분된다(형제 화면과 같은 배정).
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

    const dirty = isDirty(this.state);
    if (this.footButtons !== null) {
      this.footButtons.save.setEnabled(dirty && !this.busy);
      this.footButtons.revert.setEnabled(dirty && !this.busy);
    }
    if (this.dirtyNode !== null) {
      this.dirtyNode.text = dirty ? stripEmoji(tCmd('def3.cmd.dirty')) : '';
      this.dirtyNode.visible = dirty;
    }
    if (this.msgTextNode !== null) {
      this.msgTextNode.text = stripEmoji(this.msgText);
      this.msgTextNode.visible = this.msgText !== '';
    }
  }

  private clearHost(host: Container): void {
    for (const child of [...host.children]) {
      host.removeChild(child);
      child.destroy({ children: true });
    }
  }

  // --- 프리뷰 --------------------------------------------------------------

  private previewViewport(): PreviewViewport {
    return { ...PREVIEW_VIEWPORT };
  }

  /** 프리뷰 노드를 화면 루트 **맨 앞**으로 돌린다(근거는 {@link previewChildIndex}). */
  private placePreview(): void {
    const phase = tabPhase(this.state.tab);
    if (phase === null || this.modal !== null) {
      this.preview.stop();
      return;
    }
    this.preview.setViewport(this.previewViewport());
    this.preview.start(this.state.draft);
    this.syncPreview();
    const node = this.preview.layer;
    if (node.parent === this.root) {
      this.root.setChildIndex(node, previewChildIndex(this.root.children.length));
    }
  }

  // --- 슬롯 목록(레이어 탭) --------------------------------------------------

  private renderSlots(): void {
    const host = this.slotsHost;
    if (host === null) return;
    this.clearHost(host);
    const tab = this.state.tab;
    if (tabPhase(tab) === null) return;

    let top = BOX_R.y;
    if (tab === DEF_TAB_L2) top = this.renderTemplateChooser(host) + CORE_BLOCK_GAP;
    else if (tab === DEF_TAB_L3) top = this.renderCoreBlock(host) + CORE_BLOCK_GAP;

    const slots = this.tabSlots(tab);
    const rows = slots.map((s) => this.makeSlotRow(s, BOX_R.w));
    const bounds = rowBounds(
      rows.map((r) => r.h),
      ROW_GAP,
    );
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(BOX_R.bottom - top, bounds);
    const content = makeScrollArea(host, {
      x: BOX_R.x,
      y: top,
      w: BOX_R.w,
      h: maskH,
      totalH: total,
      get: () => this.state.scroll[tab] ?? 0,
      set: (v) => {
        this.state.scroll[tab] = v;
      },
    });
    let cy = 0;
    for (const row of rows) {
      row.node.position.set(0, cy);
      content.addChild(row.node);
      cy += row.h + ROW_GAP;
    }
  }

  /** 탭이 보여줄 슬롯 주소 목록. */
  private tabSlots(tab: number): DefenseSlotRef[] {
    const layers = this.state.draft;
    if (tab === DEF_TAB_L1) {
      return Array.from({ length: slotCount(layers, 'wave') }, (_, i) => ({ kind: 'wave' as const, index: i }));
    }
    if (tab === DEF_TAB_L2) {
      return Array.from({ length: slotCount(layers, 'socket') }, (_, i) => ({ kind: 'socket' as const, index: i }));
    }
    const out: DefenseSlotRef[] = [{ kind: 'boss', index: 0 }];
    for (let i = 0; i < slotCount(layers, 'guardian'); i++) out.push({ kind: 'guardian', index: i });
    for (let i = 0; i < slotCount(layers, 'prop'); i++) out.push({ kind: 'prop', index: i });
    return out;
  }

  /**
   * L3 코어 블록 — 코어 내구도 + [모듈 관리]. 옛 `모듈` 탭이 여기로 들어왔다(파일 헤더).
   * 파낸 면이라 "슬롯에 꽂는 행"들과 성격이 다르다는 것이 조명 부호로 읽힌다.
   * 다음 y 를 돌려준다.
   */
  private renderCoreBlock(host: Container): number {
    host.addChild(recessedWell(BOX_R.x, BOX_R.y, BOX_R.w, CORE_BLOCK_H));

    const hp = this.label(
      tCmd('def3.cmd.core.hp', { hp: this.state.draft.l3.core.hp }),
      20,
      SLAB_BODY_FILL,
      '800',
      BOX_R.w - 220,
    );
    hp.position.set(BOX_R.x + 18, BOX_R.y + 20);
    host.addChild(hp);

    const note = this.label(tCmd('def3.cmd.core.note'), 15, COLOR.muted, '400', BOX_R.w - 220);
    note.position.set(BOX_R.x + 18, BOX_R.y + 52);
    host.addChild(note);

    const open = this.chromeButton({
      tone: 'blue',
      width: 176,
      height: 48,
      fontSize: 18,
      label: tCmd('def3.cmd.mod.open'),
      onClick: () => {
        const cb = this.cb;
        // suspend/resume — show() 로 되돌리면 미저장 배치 편집이 날아간다(실측 규율).
        this.suspend();
        cb?.onOpenModules(() => this.resume());
      },
    });
    open.container.position.set(BOX_R.x + BOX_R.w - 176 - 18, BOX_R.y + (CORE_BLOCK_H - 48) / 2);
    host.addChild(open.container);

    return BOX_R.y + CORE_BLOCK_H;
  }

  /** 회랑 맵 템플릿 선택 칩 3개(L2). 다음 y 를 돌려준다. */
  private renderTemplateChooser(host: Container): number {
    host.addChild(recessedWell(BOX_R.x, BOX_R.y, BOX_R.w, TEMPLATE_BLOCK_H));

    const head = this.label(tCmd('def3.cmd.template'), 17, COLOR.muted, '700');
    head.position.set(BOX_R.x + 18, BOX_R.y + 12);
    host.addChild(head);

    const gap = 10;
    const inner = BOX_R.w - 36;
    const w = Math.floor((inner - gap * (INVASION_TEMPLATE_COUNT - 1)) / INVASION_TEMPLATE_COUNT);
    const y = BOX_R.y + 40;
    for (let i = 0; i < INVASION_TEMPLATE_COUNT; i++) {
      const active = this.state.draft.l2.templateId === i;
      const name = catalogName(CATALOG_MAP, i);
      const btn = this.chromeButton({
        tone: 'stone',
        width: w,
        height: 44,
        fontSize: 15,
        label: `${name} (${tCmd('def3.cmd.template.sockets', { n: INVASION_SOCKET_COUNTS[i] ?? 0 })})`,
        onClick: () => this.mutate(setTemplateId(this.state.draft, i)),
      });
      const bx = BOX_R.x + 18 + i * (w + gap);
      btn.container.position.set(bx, y);
      // 선택 표시는 탭·정제소 정렬 줄과 **같은 어휘**(금색 링 + 미선택 0.72)다.
      btn.container.alpha = active ? 1 : 0.72;
      host.addChild(btn.container);
      if (active) {
        const ring = new Graphics();
        ring.roundRect(bx, y, w, 44, 10).stroke({ color: COLOR.gold, width: 3, alignment: 1, alpha: 0.95 });
        ring.eventMode = 'none';
        host.addChild(ring);
      }
    }
    return BOX_R.y + TEMPLATE_BLOCK_H;
  }

  /** 슬롯 1행 — 이름 · 내용 · [배치]/[비우기]. 행 전체가 선택 대상이다. */
  private makeSlotRow(slot: DefenseSlotRef, w: number): { node: Container; h: number } {
    const layers = this.state.draft;
    const sel = this.state.selected;
    const selected = sel !== null && sel.kind === slot.kind && sel.index === slot.index;

    const row = new Container();
    // 클릭은 **행 Container** 에 건다(바탕 Graphics 면 위 텍스트가 삼킨다 — 실측).
    attachRowClick(row, () => this.select(slot));

    const title = this.slotTitle(slot);
    const ref = slotRef(layers, slot);
    const guardian = slot.kind === 'guardian' ? guardianAt(layers, slot.index) : null;
    const unit = ref === null ? null : defenseUnitFromRef(slotCatalogKind(slot.kind), ref);

    const textW = Math.max(140, w - ROW_BTN_W * 2 - ROW_PAD * 2 - 12);
    // 등급은 **제목 글자색**이 말한다 — 면 위에 얹히는 표식(악센트 바)은 넣지 않는다.
    const head = this.label(
      title,
      19,
      unit !== null ? RARITY_COLOR_NUM[unit.rarity] : guardian !== null ? PLACED_COLOR : COLOR.cream,
      '800',
      textW,
    );
    head.position.set(ROW_PAD, 12);

    const bodyText =
      unit !== null
        ? unitSummary(unit)
        : guardian !== null
          ? `${tCmd('def3.cmd.slot.guardian', { n: slot.index + 1 })} · ${guardian.performanceCP}cp`
          : slot.kind === 'prop'
            ? tCmd('def3.cmd.slot.emptyProp')
            : tCmd('def3.cmd.slot.empty');
    const body = this.wrapped(bodyText, 16, SLAB_BODY_FILL, textW);
    body.position.set(ROW_PAD, 40);

    let cy = 40 + body.height;
    let affix: Text | null = null;
    if (unit !== null) {
      affix = this.wrapped(unitAffixLine(unit), 15, COLOR.muted, textW);
      affix.position.set(ROW_PAD, cy + 4);
      cy += affix.height + 4;
    }
    const h = Math.max(84, cy + 14);

    row.addChild(rowPlate(w, h, selected));
    row.addChild(head, body);
    if (affix !== null) row.addChild(affix);

    const btnY = Math.round((h - ROW_BTN_H) / 2);
    const place = this.chromeButton({
      tone: 'blue',
      width: ROW_BTN_W,
      height: ROW_BTN_H,
      fontSize: 17,
      label: tCmd('def3.cmd.slot.place'),
      enabled: !this.busy,
      onClick: () => {
        this.state.selected = slot;
        if (slot.kind === 'guardian') this.placeNextGuardian(slot.index);
        else this.openModal('pick');
      },
    });
    place.container.position.set(w - ROW_BTN_W * 2 - 8 - ROW_PAD, btnY);
    stopRowPropagation(place.container);
    row.addChild(place.container);

    const clear = this.chromeButton({
      tone: 'stone',
      width: ROW_BTN_W,
      height: ROW_BTN_H,
      fontSize: 17,
      label: tCmd('def3.cmd.slot.clear'),
      enabled: ref !== null || guardian !== null,
      onClick: () => {
        // 수호를 비우면 신원 추적도 함께 비운다(안 그러면 그 기체가 영영 후보에서 빠진다).
        if (slot.kind === 'guardian') this.state.guardianIds[slot.index] = null;
        this.mutate(clearSlot(this.state.draft, slot));
      },
    });
    clear.container.position.set(w - ROW_BTN_W - ROW_PAD, btnY);
    stopRowPropagation(clear.container);
    row.addChild(clear.container);

    return { node: row, h };
  }

  private slotTitle(slot: DefenseSlotRef): string {
    if (slot.kind === 'wave') return tCmd('def3.cmd.slot.wave', { n: slot.index + 1 });
    if (slot.kind === 'socket') return tCmd('def3.cmd.slot.socket', { n: slot.index + 1 });
    if (slot.kind === 'prop') return tCmd('def3.cmd.slot.prop', { n: slot.index + 1 });
    if (slot.kind === 'guardian') return tCmd('def3.cmd.slot.guardian', { n: slot.index + 1 });
    return tCmd('def3.cmd.slot.boss');
  }

  /**
   * 수호 슬롯 채우기 — 보유 수호(미소멸) 중 아직 안 쓴 것을 순서대로 넣는다.
   *
   * 수호는 카탈로그 방어체가 아니라 **퇴역 기체 레코드**라 방어체 보관함 팝업을 쓰지 않는다.
   * 좌표는 코어 기준 고정 오프셋이다 — 3레이어에는 격자가 없고, 수호 배치의 자유도는
   * 기획상 "어느 기체를 쓰느냐"이지 "몇 픽셀에 두느냐"가 아니다.
   */
  private placeNextGuardian(index: number): void {
    // 신원 판정은 `pickGuardianId` 가 한다 — hp:performanceCP 키는 연속 퇴역 시 필연적으로
    // 충돌해 슬롯 2 를 영영 못 채웠다(그 함수 주석이 근거).
    const id = pickGuardianId(
      this.profile.guardians,
      this.state.draft.l3.guardians,
      this.state.guardianIds,
      index,
    );
    const pick = id === null ? undefined : this.profile.guardians.find((g) => g.id === id);
    if (pick === undefined) {
      this.msgText = tCmd('def3.cmd.pick.none');
      this.refresh();
      return;
    }
    const core = this.state.draft.l3.core;
    const placement: InvasionGuardianPlacement = {
      x: core.x + (index === 0 ? -260 : 260),
      y: core.y - 160,
      snapshot: pick.snapshot,
      performanceCP: pick.performanceCP,
      lineageBonusBp: guardianBonusBp(this.profile.lineage),
      milestones: guardianMilestones(this.profile.lineage.guardianLevel),
    };
    this.state.guardianIds[index] = pick.id;
    this.mutate(placeGuardian(this.state.draft, index, placement));
  }

  // --- 보관함 탭 -----------------------------------------------------------

  private renderUnits(): void {
    const host = this.unitsHost;
    if (host === null) return;
    this.clearHost(host);
    if (tabPhase(this.state.tab) !== null) return;

    if (this.loading) {
      this.emptyWell(host, BOX_L, tCmd('def3.cmd.loading'));
      return;
    }
    if (!this.online) {
      this.emptyWell(host, BOX_L, tCmd('def3.cmd.offline'));
      return;
    }
    if (this.units.length === 0) {
      this.emptyWell(host, BOX_L, tCmd('def3.cmd.inv.empty'));
      return;
    }

    const rows = this.units.map((u) => this.makeUnitRow(u, BOX_L.w));
    const bounds = rowBounds(
      rows.map((r) => r.h),
      ROW_GAP,
    );
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(BOX_L.h, bounds);
    const content = makeScrollArea(host, {
      x: BOX_L.x,
      y: BOX_L.y,
      w: BOX_L.w,
      h: maskH,
      totalH: total,
      get: () => this.state.scroll[DEF_TAB_INV] ?? 0,
      set: (v) => {
        this.state.scroll[DEF_TAB_INV] = v;
      },
    });
    let cy = 0;
    for (const row of rows) {
      row.node.position.set(0, cy);
      content.addChild(row.node);
      cy += row.h + ROW_GAP;
    }
  }

  /** 보관함 1행 — 행 전체가 강화 팝업 진입이다. */
  private makeUnitRow(owned: DefenseUnitOwned, w: number): { node: Container; h: number } {
    const unit = owned.unit;
    const placed = isRefPlaced(this.state.draft, toInvasionRef(unit));
    const row = new Container();
    attachRowClick(row, () => {
      this.focusUnitId = owned.id;
      this.openModal('unit');
    });

    const textW = w - ROW_PAD * 2 - 200;
    const head = this.label(unitSummary(unit), 19, RARITY_COLOR_NUM[unit.rarity], '800', textW);
    head.position.set(ROW_PAD, 12);
    const affix = this.wrapped(unitAffixLine(unit), 15, COLOR.muted, textW);
    affix.position.set(ROW_PAD, 42);
    const h = Math.max(80, 42 + affix.height + 14);

    row.addChild(rowPlate(w, h, false));
    row.addChild(head, affix);

    if (placed) {
      const badge = this.label(tCmd('def3.cmd.pick.placed'), 16, PLACED_COLOR, '700');
      badge.anchor.set(1, 0.5);
      badge.position.set(w - ROW_PAD, h / 2);
      row.addChild(badge);
    }
    return { node: row, h };
  }

  /**
   * 설계도 · 제작 패널. 옛 구현은 팝업이었다 — 보관함 탭의 오른쪽 728px 이 그동안 통째로
   * 비어 있었고(옛 보관함은 전폭 1패널), 설계도는 "보유 방어체가 없을 때 갈 곳"이라 그 자리에
   * 상주하는 편이 결정에 더 가깝다.
   */
  private renderBlueprints(): void {
    const host = this.bpHost;
    if (host === null) return;
    this.clearHost(host);
    if (tabPhase(this.state.tab) !== null) return;

    if (this.loading || !this.online) {
      this.emptyWell(host, BOX_R, tCmd(this.loading ? 'def3.cmd.loading' : 'def3.cmd.offline'));
      return;
    }
    if (this.blueprints.length === 0) {
      this.emptyWell(host, BOX_R, tCmd('def3.cmd.inv.bpEmpty'));
      return;
    }

    const rowH = 76;
    const rows = this.blueprints.map((bp) => {
      const row = new Container();
      const name = `${catalogName(bp.kind, bp.catalogId)} ${tCmd('def3.cmd.inv.count', { n: bp.count })}`;
      row.addChild(rowPlate(BOX_R.w, rowH, false));
      const head = this.label(name, 19, COLOR.cream, '800', BOX_R.w - 150 - ROW_PAD * 2 - 12);
      head.position.set(ROW_PAD, 16);
      row.addChild(head);
      const craft = this.chromeButton({
        tone: 'gold',
        width: 150,
        height: 44,
        fontSize: 18,
        label: tCmd('def3.cmd.inv.craft'),
        enabled: !this.busy && bp.count > 0,
        onClick: () => void this.runUpgrade(() => craftDefenseUnit(bp.kind, bp.catalogId)),
      });
      craft.container.position.set(BOX_R.w - 150 - ROW_PAD, 16);
      stopRowPropagation(craft.container);
      row.addChild(craft.container);
      return { node: row, h: rowH };
    });

    const bounds = rowBounds(
      rows.map((r) => r.h),
      ROW_GAP,
    );
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(BOX_R.h, bounds);
    const content = makeScrollArea(host, {
      x: BOX_R.x,
      y: BOX_R.y,
      w: BOX_R.w,
      h: maskH,
      totalH: total,
      get: () => this.modalScroll,
      set: (v) => {
        this.modalScroll = v;
      },
    });
    let cy = 0;
    for (const row of rows) {
      row.node.position.set(0, cy);
      content.addChild(row.node);
      cy += row.h + ROW_GAP;
    }
  }

  // --- 팝업 ----------------------------------------------------------------

  /**
   * 시네마틱 팝업. **`makeModal` 을 쓰지 않는다** — 그 모듈은 나무 nine-slice 에 묶여 있고 다른
   * 화면 다섯이 쓰기 때문에 고치면 그 화면들이 같이 갈린다. 대신 `modal.ts` 헤더의 실측 규칙
   * 세 가지를 그대로 승계한다:
   *  ① 암막은 **완전 불투명 채움**(뒤 화면 글자가 비쳐 읽히는 결함).
   *  ② 암막이 **이벤트를 먹는다**(안 그러면 뒤 목록이 스크롤된다).
   *  ③ 패널 안쪽 탭은 암막까지 **전파를 끊는다**(안 그러면 팝업 안을 누를 때마다 닫힌다).
   *
   * ⚠️ 알파는 뒤 화면 밝기에 따라 다르다(예비역 0.92 · 챔피언 0.96 · 연구소 0.98). 여기는
   * 밝은 슬래브 2장이 화면을 크게 덮으므로 0.97 에서 시작해 실화면으로 확인했다.
   */
  private renderModal(): void {
    const host = this.modalHost;
    if (host === null) return;
    this.modalPanel?.destroy();
    this.modalPanel = null;
    this.clearHost(host);
    if (this.modal === null) return;
    // 팝업은 언제나 맨 앞이어야 한다(프리뷰는 placePreview 가 stop 하지만 순서도 못 박는다).
    this.root.setChildIndex(host, this.root.children.length - 1);

    const kind = this.modal;
    const geom =
      kind === 'pick'
        ? {
            w: DEFENSE_MODALS.pick.w,
            h: pickModalHeight(this.pickRows().length),
            title: tCmd('def3.cmd.pick.title'),
          }
        : kind === 'unit'
          ? { w: DEFENSE_MODALS.unit.w, h: DEFENSE_MODALS.unit.h, title: tCmd('def3.cmd.inv.head') }
          : {
              w: DEFENSE_MODALS.confirm.w,
              h: DEFENSE_MODALS.confirm.h,
              title: tCmd('def3.cmd.test.confirm.title'),
            };

    // ① · ② 암막.
    const scrim = new Graphics();
    scrim.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: 0x05060f, alpha: 0.97 });
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

    if (kind === 'pick') this.renderPickModal(panel);
    else if (kind === 'unit') this.renderUnitModal(panel);
    else this.renderConfirmTestModal(panel);
  }

  /** 방어체 고르기 팝업이 보여줄 행(높이 역산에도 쓰이므로 한 곳에서 만든다). */
  private pickRows(): DefenseUnitOwned[] {
    const slot = this.state.selected;
    if (slot === null || !this.online) return [];
    return eligibleUnits(this.units, this.state.draft, slot);
  }

  /** 슬롯에 꽂을 방어체 고르기. 높이는 {@link pickModalHeight} 가 행 수에서 역산했다. */
  private renderPickModal(panel: CinematicPanel): void {
    const box = panel.box;
    const slot = this.state.selected;
    if (slot === null) return;
    const list = this.pickRows();
    if (list.length === 0) {
      this.emptyWell(
        panel.container,
        box,
        this.online ? tCmd('def3.cmd.pick.none') : tCmd('def3.cmd.offline'),
      );
      return;
    }

    const rows = list.map((owned) => {
      const row = new Container();
      const ref = toInvasionRef(owned.unit);
      const chosen = refEquals(ref, slotRef(this.state.draft, slot));
      attachRowClick(row, () => {
        this.mutate(placeRef(this.state.draft, slot, ref));
        this.closeModal();
      });
      row.addChild(rowPlate(box.w, PICK_ROW_H, chosen));
      const head = this.label(
        unitSummary(owned.unit),
        19,
        RARITY_COLOR_NUM[owned.unit.rarity],
        '800',
        box.w - ROW_PAD * 2,
      );
      head.position.set(ROW_PAD, 14);
      const affix = this.wrapped(unitAffixLine(owned.unit), 15, COLOR.muted, box.w - ROW_PAD * 2);
      affix.position.set(ROW_PAD, 46);
      row.addChild(head, affix);
      return { node: row, h: PICK_ROW_H };
    });

    const bounds = rowBounds(
      rows.map((r) => r.h),
      PICK_ROW_GAP,
    );
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(box.h, bounds);
    const content = makeScrollArea(panel.container, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: maskH,
      totalH: total,
      get: () => this.modalScroll,
      set: (v) => {
        this.modalScroll = v;
      },
    });
    let cy = 0;
    for (const row of rows) {
      row.node.position.set(0, cy);
      content.addChild(row.node);
      cy += row.h + PICK_ROW_GAP;
    }
  }

  /**
   * 강화 3축 팝업(레벨 · 승급 · 어픽스 리롤) + 등급 승급.
   * 세로 뭉치는 {@link DEFENSE_MODALS}`.unit.blockH` 가 정본이고 팝업 높이가 거기서 역산됐다 —
   * 여기서 y 를 임의로 늘리면 뭉치가 상자 바닥을 뚫는다(단위 테스트가 등호로 잠근다).
   */
  private renderUnitModal(panel: CinematicPanel): void {
    const box = panel.box;
    const owned = this.units.find((u) => u.id === this.focusUnitId);
    if (owned === undefined) {
      this.emptyWell(panel.container, box, tCmd('def3.cmd.inv.empty'));
      return;
    }
    const unit = owned.unit;

    let y = box.y;
    const head = this.label(unitSummary(unit), 24, RARITY_COLOR_NUM[unit.rarity], '800', box.w);
    head.position.set(box.x, y);
    panel.container.addChild(head);
    y += UNIT_HEAD_H + 10;

    // 어픽스는 **파낸 챔버** 안에 앉는다 — 줄 수가 장비마다 달라 그냥 두면 남는 세로가 빈 면이
    // 된다(정제소 노 챔버와 같은 처방).
    panel.container.addChild(recessedWell(box.x, y, box.w, UNIT_AFFIX_H));
    const affix = this.wrapped(unitAffixLine(unit), 17, SLAB_BODY_FILL, box.w - 32);
    affix.anchor.set(0, 0.5);
    affix.position.set(box.x + 16, y + UNIT_AFFIX_H / 2);
    panel.container.addChild(affix);
    y += UNIT_AFFIX_H + 10;

    const tier = this.label(
      `${tCmd('def3.cmd.unit.ascension', { n: unit.ascension })} (T${ascensionVisualTier(unit.ascension)})`,
      18,
      COLOR.muted,
      '700',
      box.w,
    );
    tier.position.set(box.x, y);
    panel.container.addChild(tier);
    y += UNIT_TIER_H + 18;

    const actions: {
      label: string;
      cost: string;
      run: () => Promise<DefenseUnitUpgradeResult | null>;
      enabled: boolean;
    }[] = [
      {
        label: tCmd('def3.cmd.unit.levelUp'),
        cost: costLine(defenseUnitLevelUpCost(unit.rarity, unit.level)),
        run: () => levelUpDefenseUnit(owned.id),
        enabled: defenseUnitLevelUpCost(unit.rarity, unit.level) !== null,
      },
      {
        label: tCmd('def3.cmd.unit.ascend'),
        cost: costLine(defenseUnitAscendCost(unit.ascension)),
        run: () => ascendDefenseUnit(owned.id),
        enabled: defenseUnitAscendCost(unit.ascension) !== null,
      },
      {
        label: tCmd('def3.cmd.unit.reroll'),
        cost: costLine(defenseUnitRerollCost(unit.rarity)),
        run: () => rerollDefenseUnitAffixes(owned.id),
        enabled: true,
      },
      {
        label: tCmd('def3.cmd.unit.promote'),
        cost: costLine(defenseUnitRarityUpCost(unit.rarity)),
        run: () => promoteDefenseUnitRarity(owned.id),
        enabled: defenseUnitRarityUpCost(unit.rarity) !== null,
      },
    ];

    const btnW = 260;
    for (const a of actions) {
      const btn = this.chromeButton({
        tone: 'gold',
        width: btnW,
        height: UNIT_ACT_H,
        fontSize: 20,
        label: a.label,
        enabled: a.enabled && !this.busy && this.online,
        onClick: () => void this.runUpgrade(a.run),
      });
      btn.container.position.set(box.x, y);
      panel.container.addChild(btn.container);
      const cost = this.label(
        a.cost,
        18,
        a.enabled ? COLOR.gold : COLOR.muted,
        '700',
        box.w - btnW - 40,
      );
      cost.anchor.set(0, 0.5);
      cost.position.set(box.x + btnW + 20, y + UNIT_ACT_H / 2);
      panel.container.addChild(cost);
      y += UNIT_ACT_H + UNIT_ACT_GAP;
    }
  }

  /**
   * 미저장 편집 + [시험 침공] 확인. 세 갈래: 저장 후 진행 / 그대로 진행(초안 폐기) / 취소.
   *
   * 문구는 `def3.cmd.test.confirm.*` 전용 키다 — 버튼 라벨을 조합해 만든 문장("저장하지 않은
   * 변경 · 시험 침공")은 세 갈래가 각각 무슨 결과인지 말해 주지 못했다.
   */
  private renderConfirmTestModal(panel: CinematicPanel): void {
    const box = panel.box;
    const body = this.wrapped(tCmd('def3.cmd.test.confirm.body'), 20, SLAB_BODY_FILL, box.w);
    body.anchor.set(0.5, 0);
    body.position.set(box.x + box.w / 2, box.y);
    panel.container.addChild(body);

    const gap = 14;
    const bw = Math.floor((box.w - gap * 2) / 3);
    // 버튼은 **패널 바닥 기준**으로 놓는다 — 본문 줄 수가 로케일에 따라 변하는데 본문 아래에
    // 이어 붙이면 긴 문장에서 패널 밖으로 밀린다(챔피언 선택 실측 규율).
    const by = box.bottom - CONFIRM_BTN_H;
    const buttons: { label: string; tone: ChromeTone; run: () => void }[] = [
      {
        label: tCmd('def3.cmd.test.confirm.saveAndGo'),
        tone: 'gold',
        run: () => {
          // 로컬 저장은 동기로 끝나고 업로드만 뒤에서 계속된다 — 초안이 확실히 남는다.
          void this.saveLayout();
          this.startTestInvade();
        },
      },
      { label: tCmd('def3.cmd.test.confirm.discardAndGo'), tone: 'red', run: () => this.startTestInvade() },
      { label: tCmd('def3.cmd.test.confirm.cancel'), tone: 'stone', run: () => this.closeModal() },
    ];
    buttons.forEach((b, i) => {
      const btn = this.chromeButton({
        tone: b.tone,
        width: bw,
        height: CONFIRM_BTN_H,
        fontSize: 19,
        label: b.label,
        enabled: !this.busy || i > 0,
        onClick: b.run,
      });
      btn.container.position.set(box.x + i * (bw + gap), by);
      panel.container.addChild(btn.container);
    });
  }
}

/** 기본 코어 내구도(빈 배치 표시용 — 스키마 기본값과 같은 값). */
export const DEFAULT_CORE_HP = INVASION_CORE_HP;
