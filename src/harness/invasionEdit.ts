/**
 * 하네스 침공 배치 세부 편집 (개발 도구, DEV 전용 — ADR-0008).
 *
 * 치트 패널의 침공 탭이 "슬롯 하나를 골라 레벨·등급·승급·카탈로그·어픽스 시드를 직접
 * 찍어 넣는" 조작을 하려면, 배치 스키마({@link InvasionLayers})를 **정규형을 깨지 않고**
 * 부분 수정하는 순수 연산이 필요하다. 이 모듈이 그 연산만 담당한다 — DOM·Pixi·네트워크를
 * 모르며 전부 순수 함수다(테스트가 캔버스 없이 전수 검증할 수 있다).
 *
 * ## 규율 3가지
 * ① **입력 무변형.** 모든 함수는 입력 `layers` 를 건드리지 않고 새 객체를 낸다. 치트 패널이
 *    "적용 전 미리보기"를 만들거나 되돌리기를 붙일 때 원본이 오염되면 안 된다.
 * ② **반환 전 반드시 {@link normalizeInvasionLayers}.** 스키마 전체가 정수 도메인이라는
 *    불변식(types.ts §불변식)을 편집 경로가 깨면, 그 배치로 출격한 런의 해시가 서버 재실행과
 *    갈린다. 정규화를 마지막에 한 번 통과시키는 것이 그 불변식의 유일한 강제 지점이다.
 * ③ **범위·개수는 전부 코드에서 파생.** 슬롯 개수는 정규형 배열 길이에서, 카탈로그 크기는
 *    `CATALOG_KIND_COUNTS` 에서 읽는다. 상수를 여기 복제하면 카탈로그가 append 될 때
 *    조용히 갈린다(data/invasion/catalog.ts 가 경고하는 바로 그 드리프트).
 *
 * ## L2 소켓 개수는 templateId 종속이다
 * `INVASION_SOCKET_COUNTS[templateId]`(직선 12 / 굴곡 10 / 병목 8)라서 슬롯 목록을 상수 12 로
 * 고정하면 굴곡·병목 템플릿에서 존재하지 않는 소켓이 UI 에 뜬다. {@link listSlots} 는 정규형
 * 배열 길이를 그대로 쓰므로 템플릿을 바꾸면 목록도 함께 줄어든다.
 *
 * 프로덕션 미포함: 하네스 배선(main.ts DEV 블록)에서만 import 되므로 트리셰이킹으로 제거된다.
 */

import { t, type MessageKey } from '../i18n/index.js';
import {
  CATALOG_BOSS,
  CATALOG_FACILITY,
  CATALOG_FORMATION,
  CATALOG_KIND_COUNTS,
  CATALOG_PROP,
  catalogEntry,
  def3NameKey,
} from '../../data/invasion/catalog.js';
import {
  INVASION_AFFIX_SEED_MASK,
  INVASION_ASCENSION_MAX,
  INVASION_ASCENSION_MIN,
  INVASION_LEVEL_MAX,
  INVASION_LEVEL_MIN,
  INVASION_RARITY_COUNT,
} from '../sim/invasion/constants.js';
import { normalizeInvasionLayers } from '../sim/invasion/normalize.js';
import type { InvasionLayers, InvasionRef } from '../sim/invasion/types.js';

// ---------------------------------------------------------------------------
// 슬롯 주소
// ---------------------------------------------------------------------------

/**
 * 편집 가능한 슬롯 묶음.
 *   - `wave`   : L1 웨이브 슬롯(편대)
 *   - `socket` : L2 설치 소켓(설비)
 *   - `boss`   : L3 방어 보스(단일)
 *   - `prop`   : L3 기물 소켓
 *
 * 수호(`l3.guardians`)와 코어 모듈(`l3.modules`)은 **일부러 뺐다**. 수호는 Ref 가 아니라
 * 퇴역 스냅샷 전체를 요구하고(정수 15필드), 코어 모듈은 스키마 예약 슬롯이라 sim 이 읽지
 * 않는다(정본은 `Invasion3Config.modules` — types.ts:165). 둘 다 "Ref 다섯 정수를 찍는다"는
 * 이 편집기의 조작 모델에 맞지 않는다.
 */
export type SlotGroup = 'wave' | 'socket' | 'boss' | 'prop';

/** 슬롯 1칸의 주소. `index` 는 0 기반이며 그룹별 슬롯 배열의 인덱스다(= 배치 jsonb 계약). */
export interface SlotPath {
  group: SlotGroup;
  index: number;
}

/** 슬롯 1칸의 표시 상태(치트 패널 목록 1행). */
export interface SlotView {
  path: SlotPath;
  /** UI 표시 라벨(`L1 편대 #3`). */
  label: string;
  /** 비어 있으면 null. */
  ref: InvasionRef | null;
  /** 카탈로그 표시명(비었으면 ''). */
  catalogName: string;
}

// ---------------------------------------------------------------------------
// 그룹 ↔ 카탈로그 종류
// ---------------------------------------------------------------------------

/**
 * 그룹이 참조하는 카탈로그 종류 코드(CATALOG_*). sim 이 각 슬롯을 해석할 때 쓰는 종류와
 * 같아야 한다 — 근거는 실제 스폰 코드다:
 *   - wave   → `src/sim/invasion/formation.ts` 가 `CATALOG_FORMATION` 으로 편대를 푼다
 *   - socket → `src/sim/invasion/facility.ts` 가 `CATALOG_FACILITY`
 *   - boss   → `src/sim/invasion/coreRoom.ts` 가 `CATALOG_BOSS`
 *   - prop   → `src/sim/invasion/coreRoom.ts` 가 `CATALOG_PROP`
 */
export function catalogKindFor(group: SlotGroup): number {
  switch (group) {
    case 'wave':
      return CATALOG_FORMATION;
    case 'socket':
      return CATALOG_FACILITY;
    case 'boss':
      return CATALOG_BOSS;
    case 'prop':
      return CATALOG_PROP;
  }
}

/**
 * 그룹의 카탈로그 등록 수(= `catalogId` 유효 범위 `[0, size-1]`).
 * `CATALOG_KIND_COUNTS` 파생이라 카탈로그에 append 하면 자동으로 늘어난다.
 */
export function catalogSizeFor(group: SlotGroup): number {
  return CATALOG_KIND_COUNTS[catalogKindFor(group)] ?? 0;
}

/**
 * 카탈로그 표시명. 등록 항목이면 i18n 정본(`def3.<i18nId>.name`)을 쓴다 —
 * **카탈로그 데이터 자체에는 이름 필드가 없다**(data/invasion/catalog.ts §규율: "표시 문자열은
 * 여기 두지 않는다"). 미등록 인덱스는 조용한 공백 대신 `#종류-번호` 로 드러낸다
 * (`src/ui/pixi/defenseCommand.ts` catalogName 과 같은 규율).
 */
function catalogDisplayName(kind: number, catalogId: number): string {
  const entry = catalogEntry(kind, catalogId);
  if (entry === undefined) return `#${kind}-${catalogId}`;
  return t(def3NameKey(entry.i18nId) as MessageKey);
}

// ---------------------------------------------------------------------------
// 정수 클램프 (normalize.ts 의 규율을 편집 경로에서도 선반영)
// ---------------------------------------------------------------------------

function clampInt(v: number, lo: number, hi: number): number {
  const i = Math.trunc(v);
  if (!Number.isFinite(i)) return lo;
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

/** 빈 슬롯을 채울 때의 기본 Ref(레벨 최소 · 등급 0 · 승급 0 · 시드 0 · 카탈로그 0). */
function defaultRef(): InvasionRef {
  return {
    catalogId: 0,
    level: INVASION_LEVEL_MIN,
    ascension: INVASION_ASCENSION_MIN,
    affixSeed: 0,
    rarity: 0,
  };
}

/**
 * `base` 에 `patch` 를 얹어 **각 필드를 도메인 범위로 클램프**한 Ref 를 만든다.
 * `catalogId` 상한은 그룹의 카탈로그 크기에서 파생한다(정규화는 상한을 모르므로 여기서 막지
 * 않으면 미등록 인덱스가 배치에 남아 sim 이 조용히 기본값으로 대체한다).
 */
function applyPatch(group: SlotGroup, base: InvasionRef, patch: Partial<InvasionRef>): InvasionRef {
  const size = catalogSizeFor(group);
  const maxCatalogId = size > 0 ? size - 1 : 0;
  const merged = { ...base, ...patch };
  return {
    catalogId: clampInt(merged.catalogId, 0, maxCatalogId),
    level: clampInt(merged.level, INVASION_LEVEL_MIN, INVASION_LEVEL_MAX),
    ascension: clampInt(merged.ascension, INVASION_ASCENSION_MIN, INVASION_ASCENSION_MAX),
    // uint32 도메인 — normalize.ts 와 같은 접기(`>>> 0`).
    affixSeed: (Math.trunc(merged.affixSeed) & INVASION_AFFIX_SEED_MASK) >>> 0,
    rarity: clampInt(merged.rarity, 0, INVASION_RARITY_COUNT - 1),
  };
}

// ---------------------------------------------------------------------------
// 슬롯 접근 (정규형 위에서만 동작)
// ---------------------------------------------------------------------------

/** 그룹의 슬롯 개수. 전부 정규형 배열 길이 파생(보스만 단일 슬롯이라 1). */
function slotCount(layers: InvasionLayers, group: SlotGroup): number {
  switch (group) {
    case 'wave':
      return layers.l1.waveSlots.length;
    case 'socket':
      return layers.l2.sockets.length;
    case 'boss':
      return 1;
    case 'prop':
      return layers.l3.props.length;
  }
}

function readSlot(layers: InvasionLayers, path: SlotPath): InvasionRef | null {
  const i = Math.trunc(path.index);
  if (i < 0 || i >= slotCount(layers, path.group)) return null;
  switch (path.group) {
    case 'wave':
      return layers.l1.waveSlots[i] ?? null;
    case 'socket':
      return layers.l2.sockets[i] ?? null;
    case 'boss':
      return layers.l3.boss;
    case 'prop':
      return layers.l3.props[i] ?? null;
  }
}

/** 정규형 draft 에 슬롯 값을 써 넣는다. 범위 밖 인덱스는 **조용히 무시**(치트 패널이 던지지 않게). */
function writeSlot(draft: InvasionLayers, path: SlotPath, value: InvasionRef | null): void {
  const i = Math.trunc(path.index);
  if (i < 0 || i >= slotCount(draft, path.group)) return;
  switch (path.group) {
    case 'wave':
      draft.l1.waveSlots[i] = value;
      return;
    case 'socket':
      draft.l2.sockets[i] = value;
      return;
    case 'boss':
      draft.l3.boss = value;
      return;
    case 'prop':
      draft.l3.props[i] = value;
      return;
  }
}

/** 그룹별 라벨 접두(한글 UI 문구 — 레이어 번호를 함께 보여 조작 대상이 어느 층인지 드러낸다). */
const GROUP_LABEL: Readonly<Record<SlotGroup, string>> = {
  wave: 'L1 편대',
  socket: 'L2 설비',
  boss: 'L3 보스',
  prop: 'L3 기물',
};

/** 슬롯 표시 라벨. 단일 슬롯(보스)은 번호를 붙이지 않는다. */
function slotLabel(path: SlotPath): string {
  const base = GROUP_LABEL[path.group];
  return path.group === 'boss' ? base : `${base} #${Math.trunc(path.index) + 1}`;
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/** 그룹 순회 순서(= UI 표시 순서). L1 → L2 → L3(보스 → 기물). */
const GROUP_ORDER: readonly SlotGroup[] = ['wave', 'socket', 'boss', 'prop'];

/**
 * 편집 가능한 전 슬롯을 표시용으로 펼친다. **현재 `templateId` 에 맞는 L2 소켓만** 나온다
 * (정규형 배열 길이 파생 — `INVASION_SOCKET_COUNTS[templateId]`).
 */
export function listSlots(layers: InvasionLayers): SlotView[] {
  const norm = normalizeInvasionLayers(layers);
  const out: SlotView[] = [];
  for (const group of GROUP_ORDER) {
    const kind = catalogKindFor(group);
    const n = slotCount(norm, group);
    for (let index = 0; index < n; index++) {
      const path: SlotPath = { group, index };
      const ref = readSlot(norm, path);
      out.push({
        path,
        label: slotLabel(path),
        ref,
        catalogName: ref === null ? '' : catalogDisplayName(kind, ref.catalogId),
      });
    }
  }
  return out;
}

/**
 * 슬롯 1칸을 patch 로 갱신한 **새 배치**를 낸다. 빈 슬롯이면 {@link defaultRef} 위에 patch 를
 * 얹어 채운다(= "빈칸에 레벨 30만 찍어도 방어체가 생긴다"). 범위 밖 인덱스는 무시하고 정규형
 * 사본만 돌려준다.
 */
export function setSlot(
  layers: InvasionLayers,
  path: SlotPath,
  patch: Partial<InvasionRef>,
): InvasionLayers {
  const draft = normalizeInvasionLayers(layers);
  const cur = readSlot(draft, path);
  writeSlot(draft, path, applyPatch(path.group, cur ?? defaultRef(), patch));
  return normalizeInvasionLayers(draft);
}

/** 슬롯 1칸을 비운 새 배치. 범위 밖 인덱스는 무시한다. */
export function clearSlot(layers: InvasionLayers, path: SlotPath): InvasionLayers {
  const draft = normalizeInvasionLayers(layers);
  writeSlot(draft, path, null);
  return normalizeInvasionLayers(draft);
}

/**
 * 전 슬롯을 같은 스펙으로 채운 새 배치(빠른 무대 조립 — "전부 unique 99레벨로 채워 최악의
 * 방어를 만들어 본다" 같은 조작). 기존 값은 무시하고 {@link defaultRef} + spec 으로 덮는다 —
 * 슬롯마다 다른 결과가 나오면 "전체 채움"이라는 조작 의미가 흐려지기 때문이다.
 */
export function fillAll(layers: InvasionLayers, spec: Partial<InvasionRef>): InvasionLayers {
  const draft = normalizeInvasionLayers(layers);
  for (const group of GROUP_ORDER) {
    const n = slotCount(draft, group);
    for (let index = 0; index < n; index++) {
      writeSlot(draft, { group, index }, applyPatch(group, defaultRef(), spec));
    }
  }
  return normalizeInvasionLayers(draft);
}
