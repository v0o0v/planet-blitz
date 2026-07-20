/**
 * 방어 사령부 — 침공 3레이어 배치 사령 화면 (M7b-command-ui, ADR-0017/0018).
 *
 * ## 왜 전면 신규인가
 * 구 사령부(15×9 격자 · 포탑 6종 · 배치 포인트 예산제, `src/ui/defenseCommand.ts`)는 M7a
 * 3레이어 개편으로 전제가 통째로 사라져 L11 에서 삭제됐다. 격자도, 포탑도, 단일 아레나
 * 카메라도 없다. 지금 방어는 **레이어 세 장에 슬롯을 꽂는 일**이다:
 *   L1 대기권 = 웨이브 슬롯 6(편대) · L2 회랑 = 맵 템플릿 + 소켓 12/10/8(설비) ·
 *   L3 코어방 = 보스 1 + 수호 2 + 기물 6 + 코어.
 *
 * ## 처음부터 Pixi 다 (DOM 혼용 금지)
 * DOM 오버레이를 섞으면 캔버스 UI 가 남은 DOM 아래로 깔리고 **z-index 로 못 뒤집는다**
 * (실측 — 설정 톱니가 DOM 타이틀에 가려졌던 결함). 그래서 이 화면은 검색 입력 같은 것도
 * 두지 않고 전부 Pixi 로 만든다.
 *
 * ## 화면 구조
 * 탭 5장(L1 / L2 / L3 / 보관함 / 모듈). 레이어 탭은 왼쪽에 **실제 sim 정지 프리뷰**
 * (`src/render/defensePreview.ts` — 목업이 아니라 createWorld 결과), 오른쪽에 슬롯 목록.
 * 표가 셋 이상 필요해지는 지점(방어체 고르기·강화·설계도)은 보드에 밀어 넣지 않고
 * **팝업으로 분리**한다(관제탑 선례).
 *
 * ## 서버 권위
 * 강화 3축(레벨·승급·어픽스 리롤)과 제작은 전부 서버 RPC 가 판정하고 차감한다. 이 화면은
 * `data/defenseUnits.ts` 의 **같은 산식**으로 비용을 표기만 하고, 성공 후 서버가 돌려준
 * 크레딧·광물을 프로필에 pull 한다(정비 크레딧 pull 선례). 배치는 로컬 프로필에 즉시 저장하고
 * `uploadDefenseLayout` 으로 서버에 올린다(정규화는 업로드 함수가 한 번 더 한다 — 총 함수).
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { saveProfile, type KeyValueStore, type Profile } from '../../save/profile.js';
import { refreshPendingProfile } from '../../net/profileSync.js';
import { t, type MessageKey, type TParams } from '../../i18n/index.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../../render/app.js';
import { COLOR, UI_FONT, TEXT_SHADOW, RARITY_COLOR_NUM } from './theme.js';
import { loadUiTextures, type UiTextures } from './uiTextures.js';
import { nineSlicePanel, panelContent, PANEL_BORDER, type PanelContentBox } from './nineSlicePanel.js';
import { PixiButton } from './button.js';
import { makeBanner, makeCurrencyChip, makeIconButton } from './titleBar.js';
import { stripEmoji } from './text.js';
import { makeTabBar, TAB_H } from './tabs.js';
import { makeScrollArea, rowBounds, clampToRows } from './scrollArea.js';
import { listRowBg, attachRowClick, stopRowPropagation } from './listRow.js';
import { makeModal, type ModalParts } from './modal.js';
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
  defenseUnitRarityRank,
  ascensionVisualTier,
  type DefenseUnitInstance,
  type Rarity,
} from '../../../data/defenseUnits.js';
import { toInvasionRef, defenseUnitFromRef } from '../../items/rollDefenseUnit.js';
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
 * 카탈로그 파생으로 잡는다. 이 화면의 `def3.cmd.*` 정본은 src/i18n/catalog.ts 다
 * (통합 게이트가 레인 로컬 폴백표를 승격하며 이 다리를 철거했다).
 * 컬러 이모지 금지: Pixi 에서 두부로 렌더된다(◀ ▶ 같은 기하 기호만 허용).
 */
export function tCmd(key: string, params?: TParams): string {
  return t(key as MessageKey, params);
}

// ===========================================================================
// 순수 모델 — 슬롯 주소 · 배치 편집 · 화면 상태
// ===========================================================================

/** 탭 코드(배열 인덱스 = 탭 순서). */
export const DEF_TAB_L1 = 0;
export const DEF_TAB_L2 = 1;
export const DEF_TAB_L3 = 2;
export const DEF_TAB_INV = 3;
export const DEF_TAB_MOD = 4;
export const DEF_TAB_COUNT = 5;

/** 탭 라벨 i18n 키(인덱스 = 탭 코드). */
export const DEF_TAB_KEYS: readonly string[] = [
  'def3.cmd.tab.l1',
  'def3.cmd.tab.l2',
  'def3.cmd.tab.l3',
  'def3.cmd.tab.inv',
  'def3.cmd.tab.mod',
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

/** 되돌리기 — 저장본으로 초안을 복원한다. */
export function revertDraft(state: CommandState): void {
  state.draft = cloneInvasionLayers(state.saved);
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

/** 어픽스 한 줄(상시/조건부 분리 표기 — 합쳐 쓰면 항상 실린다고 오독한다). */
export function unitAffixLine(unit: DefenseUnitInstance): string {
  const parts: string[] = [];
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
// 화면
// ===========================================================================

const MARGIN = 36;
const BANNER_W = 460;
const BANNER_H = 72;
const BANNER_Y = 10;
const CHIP_W = 180;
const CHIP_H = 52;

const TABS_Y = 100;
const BOARD_TOP = TABS_Y + TAB_H;
const BOARD_BOTTOM = 930;
const BOARD_W = DESIGN_WIDTH - MARGIN * 2;
const BOARD_H = BOARD_BOTTOM - BOARD_TOP;

/** 패널 제목(26px) 아래에서 본문이 시작한다. */
const CONTENT_TOP = 118;

/** 레이어 탭 좌측 프리뷰 열 폭. */
const PREVIEW_COL_W = 900;
const COL_GAP = 24;

const ROW_GAP = 10;
const ROW_BTN_W = 104;
const ROW_BTN_H = 40;

const FOOT_Y = 950;
const FOOT_H = 58;

const MODAL_W = 1180;
const MODAL_H = 800;

const WARN_COLOR = 0xffb14c;

/** 팝업 종류. */
type ModalKind = 'pick' | 'unit' | 'blueprints' | null;

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
    // UI 킷 텍스처 비동기 로드 — 완료 후 열려 있으면 실 아트로 다시 그린다.
    // ⚠ 리스너를 이 콜백 안에서 새로 달면 재렌더 때마다 중복 등록돼 클릭이 두 번 돈다(실측).
    // 여기서는 render() 만 부른다.
    void loadUiTextures().then((tex) => {
      this.ui = tex;
      if (this.root.visible) this.render();
    });
  }

  get visible(): boolean {
    return this.root.visible;
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
    this.raise();
    this.hideRunHud(true);
    // 프리뷰는 이 화면의 자식으로 산다 — 배경 위·패널 아래(placePreview 가 순서를 강제).
    this.preview.attachTo(this.root);
    this.render();
    void this.load();
  }

  hide(): void {
    this.root.visible = false;
    this.cb = null;
    this.preview.stop();
    this.hideRunHud(false);
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
    this.render();
  }

  /** 이 화면을 stage 맨 앞으로(뒤에 붙은 런 레이어·프리뷰 위로). */
  private raise(): void {
    this.stage.setChildIndex(this.root, this.stage.children.length - 1);
  }

  /** 런 전용 DOM HUD 는 캔버스 메타 화면 위에 떠 보이므로 감춘다(node 환경 가드 포함). */
  private hideRunHud(hidden: boolean): void {
    if (typeof document === 'undefined') return;
    const hud = document.getElementById('pb-hud');
    if (hud !== null) hud.style.visibility = hidden ? 'hidden' : '';
  }

  // --- 로드 ----------------------------------------------------------------

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    const uid = await getDefenseUnitsUserId();
    if (token !== this.loadToken || !this.visible) return;
    if (uid === null) {
      this.online = false;
      this.loading = false;
      this.render();
      return;
    }
    this.online = true;
    const [units, bps] = await Promise.all([listDefenseUnits(), listBlueprints()]);
    if (token !== this.loadToken || !this.visible) return;
    this.units = units ?? [];
    this.blueprints = bps ?? [];
    this.loading = false;
    this.render();
  }

  private async reload(): Promise<void> {
    if (!this.online) return;
    const token = ++this.loadToken;
    const [units, bps] = await Promise.all([listDefenseUnits(), listBlueprints()]);
    if (token !== this.loadToken || !this.visible) return;
    if (units !== null) this.units = units;
    if (bps !== null) this.blueprints = bps;
    this.render();
  }

  // --- 배치 저장 -----------------------------------------------------------

  /** 로컬 저장(즉시) → 서버 업로드(fire-and-forget, 결과만 토스트로 승격). */
  private async saveLayout(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const layers = cloneInvasionLayers(this.state.draft);
    this.profile.defenseLayout = layers;
    saveProfile(this.profile, this.store ?? undefined);
    commitDraft(this.state);
    this.msgText = tCmd('def3.cmd.savedLocal');
    this.render();
    const result = await uploadDefenseLayout(layers);
    if (!this.visible) return;
    this.busy = false;
    this.msgText = result === null ? tCmd('def3.cmd.savedLocal') : tCmd('def3.cmd.saved');
    this.render();
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
  private async runUpgrade(
    fn: () => Promise<DefenseUnitUpgradeResult | null>,
  ): Promise<void> {
    if (this.busy || !this.online) {
      if (!this.online) this.msgText = tCmd('def3.cmd.err.offline');
      this.render();
      return;
    }
    this.busy = true;
    this.render();
    const result = await fn();
    if (!this.visible) return;
    this.busy = false;
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
    this.render();
  }

  private mutate(next: InvasionLayers): void {
    this.state.draft = next;
    this.syncPreview();
    this.render();
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
    this.render();
  }

  private closeModal(): void {
    this.modal = null;
    this.render();
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

  /** 패널 제목 — top = 콘텐츠 상자 top(제목이 나무 테두리에 붙던 결함 재발 방지). */
  private panelTitle(parent: Container, box: PanelContentBox, text: string, color: number = COLOR.cream): void {
    const title = this.label(text, 26, color, '800');
    title.position.set(box.x, box.y);
    if (title.width > box.w) title.scale.x = box.w / title.width;
    parent.addChild(title);
  }

  private msg(parent: Container, box: PanelContentBox, text: string, top = CONTENT_TOP + 40): void {
    const el = this.wrapped(text, 19, COLOR.muted, box.w);
    el.anchor.set(0.5, 0);
    el.position.set(box.x + box.w / 2, top);
    parent.addChild(el);
  }

  private addPanel(
    parent: Container,
    x: number,
    y: number,
    w: number,
    h: number,
  ): { panel: Container; box: PanelContentBox } {
    const panel = new Container();
    panel.position.set(x, y);
    parent.addChild(panel);
    panel.addChild(nineSlicePanel(w, h, { texture: this.ui['ui_panel.png'], border: PANEL_BORDER }));
    return { panel, box: panelContent(w, h) };
  }

  private woodButton(
    label: string,
    w: number,
    h: number,
    onClick: () => void,
    opts: { primary?: boolean; enabled?: boolean; fontSize?: number } = {},
  ): PixiButton {
    const primary = opts.primary === true;
    const btn = new PixiButton({
      texture: this.ui[primary ? 'ui_btn_yellow.png' : 'ui_btn_wood.png'],
      fallbackColor: primary ? 0x9a7a2a : 0x4a3a24,
      width: w,
      height: h,
      fontSize: opts.fontSize ?? 19,
      ...(primary ? { labelColor: COLOR.darkLabel } : {}),
      label: stripEmoji(label),
      onClick,
    });
    if (opts.enabled === false) btn.setEnabled(false);
    return btn;
  }

  // --- 렌더 ----------------------------------------------------------------

  private render(): void {
    const previewNode = this.preview.layer;
    for (const child of [...this.root.children]) {
      // 프리뷰 노드는 이 화면이 만든 것이 아니다 — 떼기만 하고 **절대 destroy 하지 않는다**
      // (destroy 하면 다음 렌더에서 죽은 Container 를 다시 붙이게 된다).
      if (child === previewNode) {
        this.root.removeChild(child);
        continue;
      }
      this.root.removeChild(child);
      child.destroy({ children: true });
    }

    const bg = new Graphics();
    bg.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: COLOR.bg });
    bg.eventMode = 'static'; // 뒤로 이벤트가 새지 않게 막는다.
    this.root.addChild(bg);

    this.renderTitleBar();
    this.renderTabs();

    const tab = this.state.tab;
    if (tab === DEF_TAB_L1 || tab === DEF_TAB_L2 || tab === DEF_TAB_L3) this.renderLayerTab(tab);
    else if (tab === DEF_TAB_INV) this.renderInventoryTab();
    else this.renderModuleTab();

    this.renderFooter();
    this.renderModal();

    // 프리뷰는 화면 루트보다 뒤(=아래)에 있어야 패널에 가려지지 않는다 — 레이어 탭에서만
    // 보이게 하고, 그리기 순서를 매 렌더 끝에 다시 맞춘다.
    this.placePreview();
  }

  private renderTitleBar(): void {
    const banner = makeBanner(BANNER_W, BANNER_H, tCmd('def3.cmd.title'), this.ui['ui_banner.png']);
    banner.position.set((DESIGN_WIDTH - BANNER_W) / 2, BANNER_Y);
    this.root.addChild(banner);

    const chipY = BANNER_Y + (BANNER_H - CHIP_H) / 2;
    const credits = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.credits),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_coin.png'],
    );
    credits.position.set((DESIGN_WIDTH - BANNER_W) / 2 - CHIP_W - 16, chipY);
    this.root.addChild(credits);

    const minerals = makeCurrencyChip(
      CHIP_W,
      CHIP_H,
      String(this.profile.minerals),
      this.ui['ui_chip.png'],
      this.ui['ui_icon_crystal.png'],
    );
    minerals.position.set((DESIGN_WIDTH + BANNER_W) / 2 + 16, chipY);
    this.root.addChild(minerals);

    const close = makeIconButton(56, () => this.close(), this.ui['ui_icon_close.png']);
    close.position.set(DESIGN_WIDTH - 24 - 56, 12);
    this.root.addChild(close);
  }

  private renderTabs(): void {
    const bar = makeTabBar({
      width: BOARD_W,
      labels: DEF_TAB_KEYS.map((k) => tCmd(k)),
      activeIndex: this.state.tab,
      activeTexture: this.ui['ui_btn_yellow.png'],
      idleTexture: this.ui['ui_btn_wood.png'],
      onSelect: (i) => {
        setTab(this.state, i);
        this.syncPreview();
        this.render();
      },
    });
    bar.position.set(MARGIN, TABS_Y);
    this.root.addChild(bar);
  }

  private renderFooter(): void {
    const gap = 16;
    const saveW = 240;
    const revertW = 180;
    const testW = 220;
    const backW = 240;
    const total = saveW + revertW + testW + backW + gap * 3;
    let x = Math.round((DESIGN_WIDTH - total) / 2);

    const dirty = isDirty(this.state);
    const save = this.woodButton(tCmd('def3.cmd.save'), saveW, FOOT_H, () => void this.saveLayout(), {
      primary: dirty,
      enabled: dirty && !this.busy,
      fontSize: 21,
    });
    save.container.position.set(x, FOOT_Y);
    this.root.addChild(save.container);
    x += saveW + gap;

    const revert = this.woodButton(
      tCmd('def3.cmd.revert'),
      revertW,
      FOOT_H,
      () => {
        revertDraft(this.state);
        this.syncPreview();
        this.render();
      },
      { enabled: dirty && !this.busy, fontSize: 21 },
    );
    revert.container.position.set(x, FOOT_Y);
    this.root.addChild(revert.container);
    x += revertW + gap;

    const test = this.woodButton(
      tCmd('def3.cmd.test'),
      testW,
      FOOT_H,
      () => {
        const cb = this.cb;
        const layers = cloneInvasionLayers(this.state.draft);
        this.hide();
        cb?.onTestInvade(layers);
      },
      { fontSize: 21 },
    );
    test.container.position.set(x, FOOT_Y);
    this.root.addChild(test.container);
    x += testW + gap;

    const back = this.woodButton(tCmd('def3.cmd.back'), backW, FOOT_H, () => this.close(), {
      fontSize: 21,
    });
    back.container.position.set(x, FOOT_Y);
    this.root.addChild(back.container);

    if (dirty) {
      const warn = this.label(tCmd('def3.cmd.dirty'), 18, WARN_COLOR, '700');
      warn.anchor.set(1, 0.5);
      warn.position.set(MARGIN + BOARD_W, FOOT_Y + FOOT_H / 2);
      this.root.addChild(warn);
    }
    if (this.msgText !== '') {
      const hint = this.label(this.msgText, 19, COLOR.gold, '700', BOARD_W);
      hint.anchor.set(0.5, 1);
      hint.position.set(DESIGN_WIDTH / 2, DESIGN_HEIGHT - 8);
      this.root.addChild(hint);
    }
  }

  private close(): void {
    const cb = this.cb;
    this.hide();
    cb?.onClose();
  }

  // --- 레이어 탭 -----------------------------------------------------------

  /** 프리뷰 뷰포트(레이어 탭 좌측 패널 안). */
  private previewViewport(): PreviewViewport {
    const box = panelContent(PREVIEW_COL_W, BOARD_H);
    return {
      x: MARGIN + box.x,
      y: BOARD_TOP + CONTENT_TOP,
      w: box.w,
      h: BOARD_H - CONTENT_TOP - PANEL_BORDER - 40,
    };
  }

  /**
   * 프리뷰 노드를 화면 루트 **바로 뒤**로 돌린다. 프리뷰는 stage 에 붙는 별도 노드라
   * 이 화면보다 먼저 붙었든 나중에 붙었든 순서를 매 렌더 끝에 강제해야 패널을 뚫지 않는다.
   */
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
    if (node.parent === this.root) this.root.setChildIndex(node, 1); // 배경 바로 위.
  }

  private renderLayerTab(tab: number): void {
    // 좌측: 프리뷰 액자(내용은 preview 노드가 그린다).
    const { panel, box } = this.addPanel(this.root, MARGIN, BOARD_TOP, PREVIEW_COL_W, BOARD_H);
    this.panelTitle(panel, box, tCmd('def3.cmd.preview'));
    const hint = this.wrapped(tCmd('def3.cmd.previewHint'), 16, COLOR.muted, box.w);
    hint.position.set(box.x, box.bottom - hint.height);
    panel.addChild(hint);

    // 우측: 슬롯 목록.
    const listX = MARGIN + PREVIEW_COL_W + COL_GAP;
    const listW = BOARD_W - PREVIEW_COL_W - COL_GAP;
    const { panel: listPanel, box: listBox } = this.addPanel(this.root, listX, BOARD_TOP, listW, BOARD_H);
    const headKey = tab === DEF_TAB_L1 ? 'def3.cmd.slots.l1' : tab === DEF_TAB_L2 ? 'def3.cmd.slots.l2' : 'def3.cmd.slots.l3';
    this.panelTitle(listPanel, listBox, tCmd(headKey));

    let top = CONTENT_TOP;
    if (tab === DEF_TAB_L2) top = this.renderTemplateChooser(listPanel, listBox, top) + 16;

    const slots = this.tabSlots(tab);
    const rows = slots.map((s) => this.makeSlotRow(s, listBox.w));
    const bounds = rowBounds(rows.map((r) => r.h), ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(listBox.bottom - top, bounds);
    const content = makeScrollArea(listPanel, {
      x: listBox.x,
      y: top,
      w: listBox.w,
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

  /** 회랑 맵 템플릿 선택 칩 3개. 다음 y 를 돌려준다. */
  private renderTemplateChooser(panel: Container, box: PanelContentBox, top: number): number {
    const head = this.label(tCmd('def3.cmd.template'), 20, COLOR.cream, '700');
    head.position.set(box.x, top);
    panel.addChild(head);

    const y = top + head.height + 8;
    const gap = 8;
    const w = Math.floor((box.w - gap * (INVASION_TEMPLATE_COUNT - 1)) / INVASION_TEMPLATE_COUNT);
    for (let i = 0; i < INVASION_TEMPLATE_COUNT; i++) {
      const active = this.state.draft.l2.templateId === i;
      const name = catalogName(CATALOG_MAP, i);
      const btn = this.woodButton(
        `${name} (${tCmd('def3.cmd.template.sockets', { n: INVASION_SOCKET_COUNTS[i] ?? 0 })})`,
        w,
        44,
        () => this.mutate(setTemplateId(this.state.draft, i)),
        { primary: active, fontSize: 16 },
      );
      btn.container.position.set(box.x + i * (w + gap), y);
      panel.addChild(btn.container);
    }
    return y + 44;
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

    const accent =
      unit !== null ? RARITY_COLOR_NUM[unit.rarity] : guardian !== null ? 0x8fd94c : undefined;

    const textW = Math.max(140, w - ROW_BTN_W * 2 - 40);
    const head = this.label(title, 19, COLOR.cream, '800', textW);
    head.position.set(16, 12);

    const bodyText =
      unit !== null
        ? unitSummary(unit)
        : guardian !== null
          ? `${tCmd('def3.cmd.slot.guardian', { n: slot.index + 1 })} · ${guardian.performanceCP}cp`
          : slot.kind === 'prop'
            ? tCmd('def3.cmd.slot.emptyProp')
            : tCmd('def3.cmd.slot.empty');
    const body = this.wrapped(bodyText, 16, unit !== null ? COLOR.muted : COLOR.muted, textW);
    body.position.set(16, 40);

    let cy = 40 + body.height;
    let affix: Text | null = null;
    if (unit !== null) {
      affix = this.wrapped(unitAffixLine(unit), 15, COLOR.muted, textW);
      affix.position.set(16, cy + 4);
      cy += affix.height + 4;
    }
    const h = Math.max(84, cy + 14);

    row.addChild(listRowBg(w, h, { selected, ...(accent !== undefined ? { accent } : {}) }));
    row.addChild(head, body);
    if (affix !== null) row.addChild(affix);

    const btnY = Math.round((h - ROW_BTN_H) / 2);
    const place = this.woodButton(
      tCmd('def3.cmd.slot.place'),
      ROW_BTN_W,
      ROW_BTN_H,
      () => {
        this.state.selected = slot;
        if (slot.kind === 'guardian') this.placeNextGuardian(slot.index);
        else this.openModal('pick');
      },
      { fontSize: 17, enabled: !this.busy },
    );
    place.container.position.set(w - ROW_BTN_W * 2 - 8 - 12, btnY);
    stopRowPropagation(place.container);
    row.addChild(place.container);

    const clear = this.woodButton(
      tCmd('def3.cmd.slot.clear'),
      ROW_BTN_W,
      ROW_BTN_H,
      () => this.mutate(clearSlot(this.state.draft, slot)),
      { fontSize: 17, enabled: ref !== null || guardian !== null },
    );
    clear.container.position.set(w - ROW_BTN_W - 12, btnY);
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
    const used = new Set<string>();
    for (const g of this.state.draft.l3.guardians) {
      if (g !== null && g !== undefined) used.add(String(g.snapshot.hp) + ':' + String(g.performanceCP));
    }
    const pick = this.profile.guardians.find(
      (g) => !g.retired && !used.has(String(g.snapshot.hp) + ':' + String(g.performanceCP)),
    );
    if (pick === undefined) {
      this.msgText = tCmd('def3.cmd.pick.none');
      this.render();
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
    this.mutate(placeGuardian(this.state.draft, index, placement));
  }

  // --- 보관함 탭 -----------------------------------------------------------

  private renderInventoryTab(): void {
    const { panel, box } = this.addPanel(this.root, MARGIN, BOARD_TOP, BOARD_W, BOARD_H);
    this.panelTitle(panel, box, tCmd('def3.cmd.inv.head'));

    const bpBtn = this.woodButton(
      tCmd('def3.cmd.inv.blueprints'),
      220,
      44,
      () => this.openModal('blueprints'),
      { fontSize: 18 },
    );
    bpBtn.container.position.set(box.right - 220, box.y - 4);
    panel.addChild(bpBtn.container);

    if (this.loading) {
      this.msg(panel, box, tCmd('def3.cmd.loading'));
      return;
    }
    if (!this.online) {
      this.msg(panel, box, tCmd('def3.cmd.offline'));
      return;
    }
    if (this.units.length === 0) {
      this.msg(panel, box, tCmd('def3.cmd.inv.empty'));
      return;
    }

    const top = CONTENT_TOP;
    const rows = this.units.map((u) => this.makeUnitRow(u, box.w));
    const bounds = rowBounds(rows.map((r) => r.h), ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(box.bottom - top, bounds);
    const content = makeScrollArea(panel, {
      x: box.x,
      y: top,
      w: box.w,
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

    const head = this.label(unitSummary(unit), 19, RARITY_COLOR_NUM[unit.rarity], '800', w - 200);
    head.position.set(16, 12);
    const affix = this.wrapped(unitAffixLine(unit), 15, COLOR.muted, w - 200);
    affix.position.set(16, 42);
    const h = Math.max(80, 42 + affix.height + 14);

    row.addChild(listRowBg(w, h, placed ? { accent: 0x8fd94c } : {}));
    row.addChild(head, affix);

    if (placed) {
      const badge = this.label(tCmd('def3.cmd.pick.placed'), 16, 0x8fd94c, '700');
      badge.anchor.set(1, 0.5);
      badge.position.set(w - 16, h / 2);
      row.addChild(badge);
    }
    return { node: row, h };
  }

  // --- 모듈 탭 -------------------------------------------------------------

  private renderModuleTab(): void {
    const { panel, box } = this.addPanel(this.root, MARGIN, BOARD_TOP, BOARD_W, BOARD_H);
    this.panelTitle(panel, box, tCmd('def3.cmd.mod.head'));
    const note = this.wrapped(tCmd('def3.cmd.mod.note'), 19, COLOR.muted, box.w);
    note.position.set(box.x, CONTENT_TOP);
    panel.addChild(note);

    const open = this.woodButton(
      tCmd('def3.cmd.mod.open'),
      320,
      58,
      () => {
        const cb = this.cb;
        // suspend/resume — show() 로 되돌리면 미저장 배치 편집이 날아간다(실측 규율).
        this.suspend();
        cb?.onOpenModules(() => this.resume());
      },
      { primary: true, fontSize: 21 },
    );
    open.container.position.set(box.x, CONTENT_TOP + note.height + 24);
    panel.addChild(open.container);
  }

  // --- 팝업 ----------------------------------------------------------------

  private renderModal(): void {
    if (this.modal === null) return;
    const titleKey =
      this.modal === 'pick'
        ? 'def3.cmd.pick.title'
        : this.modal === 'unit'
          ? 'def3.cmd.inv.head'
          : 'def3.cmd.inv.blueprints';
    const parts = makeModal({
      width: MODAL_W,
      height: MODAL_H,
      title: tCmd(titleKey),
      onClose: () => this.closeModal(),
      panelTexture: this.ui['ui_panel.png'],
      closeTexture: this.ui['ui_icon_close.png'],
    });
    this.root.addChild(parts.root);

    if (this.modal === 'pick') this.renderPickModal(parts);
    else if (this.modal === 'unit') this.renderUnitModal(parts);
    else this.renderBlueprintModal(parts);
  }

  /** 슬롯에 꽂을 방어체 고르기. */
  private renderPickModal(parts: ModalParts): void {
    const { panel, box } = parts;
    const slot = this.state.selected;
    if (slot === null) return;
    if (!this.online || this.units.length === 0) {
      this.msg(panel, box, this.online ? tCmd('def3.cmd.pick.none') : tCmd('def3.cmd.offline'));
      return;
    }
    const list = eligibleUnits(this.units, this.state.draft, slot);
    if (list.length === 0) {
      this.msg(panel, box, tCmd('def3.cmd.pick.none'));
      return;
    }

    const top = CONTENT_TOP;
    const rows = list.map((owned) => {
      const row = new Container();
      const ref = toInvasionRef(owned.unit);
      const chosen = refEquals(ref, slotRef(this.state.draft, slot));
      attachRowClick(row, () => {
        this.mutate(placeRef(this.state.draft, slot, ref));
        this.closeModal();
      });
      const head = this.label(unitSummary(owned.unit), 19, RARITY_COLOR_NUM[owned.unit.rarity], '800', box.w - 32);
      head.position.set(16, 12);
      const affix = this.wrapped(unitAffixLine(owned.unit), 15, COLOR.muted, box.w - 32);
      affix.position.set(16, 42);
      const h = Math.max(78, 42 + affix.height + 14);
      // 팝업 안 행은 완전 불투명(밝은 패널 위에서 반투명이면 뒤 무늬가 비친다).
      row.addChild(listRowBg(box.w, h, { selected: chosen, fillAlpha: 1 }));
      row.addChild(head, affix);
      return { node: row, h };
    });

    const bounds = rowBounds(rows.map((r) => r.h), ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(box.bottom - top, bounds);
    const content = makeScrollArea(panel, {
      x: box.x,
      y: top,
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
      cy += row.h + ROW_GAP;
    }
  }

  /** 강화 3축 팝업(레벨 · 승급 · 어픽스 리롤) + 등급 승급. */
  private renderUnitModal(parts: ModalParts): void {
    const { panel, box } = parts;
    const owned = this.units.find((u) => u.id === this.focusUnitId);
    if (owned === undefined) {
      this.msg(panel, box, tCmd('def3.cmd.inv.empty'));
      return;
    }
    const unit = owned.unit;

    const head = this.label(unitSummary(unit), 24, RARITY_COLOR_NUM[unit.rarity], '800', box.w);
    head.position.set(box.x, CONTENT_TOP);
    panel.addChild(head);

    const affix = this.wrapped(unitAffixLine(unit), 18, COLOR.cream, box.w);
    affix.position.set(box.x, CONTENT_TOP + 40);
    panel.addChild(affix);

    const tier = this.label(
      `${tCmd('def3.cmd.unit.ascension', { n: unit.ascension })} (T${ascensionVisualTier(unit.ascension)})`,
      18,
      COLOR.muted,
      '700',
    );
    tier.position.set(box.x, CONTENT_TOP + 40 + affix.height + 12);
    panel.addChild(tier);

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

    let y = tier.y + tier.height + 24;
    const btnW = 260;
    for (const a of actions) {
      const btn = this.woodButton(a.label, btnW, 52, () => void this.runUpgrade(a.run), {
        primary: a.enabled && !this.busy,
        enabled: a.enabled && !this.busy && this.online,
        fontSize: 20,
      });
      btn.container.position.set(box.x, y);
      panel.addChild(btn.container);
      const cost = this.label(a.cost, 18, a.enabled ? COLOR.gold : COLOR.muted, '700', box.w - btnW - 40);
      cost.anchor.set(0, 0.5);
      cost.position.set(box.x + btnW + 20, y + 26);
      panel.addChild(cost);
      y += 66;
    }
  }

  /** 설계도 → 제작. */
  private renderBlueprintModal(parts: ModalParts): void {
    const { panel, box } = parts;
    if (!this.online) {
      this.msg(panel, box, tCmd('def3.cmd.offline'));
      return;
    }
    if (this.blueprints.length === 0) {
      this.msg(panel, box, tCmd('def3.cmd.inv.bpEmpty'));
      return;
    }
    const top = CONTENT_TOP;
    const rows = this.blueprints.map((bp) => {
      const row = new Container();
      const name = `${catalogName(bp.kind, bp.catalogId)} ${tCmd('def3.cmd.inv.count', { n: bp.count })}`;
      const head = this.label(name, 20, COLOR.cream, '800', box.w - 200);
      head.position.set(16, 14);
      const h = 72;
      row.addChild(listRowBg(box.w, h, { fillAlpha: 1 }));
      row.addChild(head);
      const craft = this.woodButton(
        tCmd('def3.cmd.inv.craft'),
        150,
        44,
        () => void this.runUpgrade(() => craftDefenseUnit(bp.kind, bp.catalogId)),
        { primary: true, fontSize: 18, enabled: !this.busy && bp.count > 0 },
      );
      craft.container.position.set(box.w - 150 - 16, 14);
      stopRowPropagation(craft.container);
      row.addChild(craft.container);
      return { node: row, h };
    });

    const bounds = rowBounds(rows.map((r) => r.h), ROW_GAP);
    const total = bounds.length === 0 ? 0 : (bounds[bounds.length - 1] ?? 0);
    const maskH = clampToRows(box.bottom - top, bounds);
    const content = makeScrollArea(panel, {
      x: box.x,
      y: top,
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
      cy += row.h + ROW_GAP;
    }
  }
}

/** 기본 코어 내구도(빈 배치 표시용 — 스키마 기본값과 같은 값). */
export const DEFAULT_CORE_HP = INVASION_CORE_HP;
