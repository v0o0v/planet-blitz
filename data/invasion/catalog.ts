/**
 * 침공 3레이어 — 임시 카탈로그 레지스트리 (M7a · L9-garrison-catalog).
 *
 * 편대(L1)·설비(L2)·기물/보스(L3)·맵 템플릿은 각자 별도 파일에 정의돼 있고 그 배열 인덱스가
 * 곧 `catalogId`(= `defenses.layout` jsonb 계약)다. 이 모듈은 그 다섯 배열을 **읽기 전용으로
 * 한데 묶어** 카탈로그 전체를 순회할 수 있게 한다. 정의를 복제하지 않고 원본에서 파생하므로
 * 드리프트가 구조적으로 불가능하다 — 어느 레인이 카탈로그에 append 하면 여기 목록도 즉시 늘고,
 * i18n 누락은 tests/i18n.test.ts 가 그 자리에서 잡는다.
 *
 * ## 규율
 * - **배열 인덱스 = catalogId, append-only.** 중간 삽입·재정렬은 배치 jsonb·해시 스트림·EF
 *   재실행을 동시에 깨뜨린다(data/stickers.ts / data/enemies.ts 선례).
 * - 카탈로그는 **종류(kind)별로 독립된 id 공간**을 쓴다. 편대 0 과 설비 0 은 서로 다른 것이고,
 *   배치 스키마도 슬롯 위치로 종류가 결정되므로 전역 유일 id 가 필요 없다.
 * - 표시 문자열은 여기 두지 않는다. `def3.<i18nId>.name` / `def3.<i18nId>.desc` 키만 파생하고
 *   본문은 `src/i18n/catalog.ts`(EN 정본 + KO 전수)가 갖는다. 이름에 컬러 이모지 금지 —
 *   Pixi 텍스트에서 두부(tofu)로 렌더된다.
 * - 데이터 전용 모듈이다. sim·render·ui 를 import 하지 않는다.
 */

import { FORMATIONS } from './formations.js';
import { INVASION_FACILITIES } from './facilities.js';
import { L3_PROPS } from './props.js';
import { DEFENSE_BOSSES } from './defenseBosses.js';
import { INVASION_MAP_TEMPLATES } from './mapTemplates.js';

// ---------------------------------------------------------------------------
// 종류 코드
// ---------------------------------------------------------------------------

/** 카탈로그 종류 — L1 편대. */
export const CATALOG_FORMATION = 0;
/** 카탈로그 종류 — L2 설비. */
export const CATALOG_FACILITY = 1;
/** 카탈로그 종류 — L3 기물. */
export const CATALOG_PROP = 2;
/** 카탈로그 종류 — L3 방어 보스. */
export const CATALOG_BOSS = 3;
/** 카탈로그 종류 — L2 맵 템플릿. */
export const CATALOG_MAP = 4;

/** 종류 개수(코드 0..4). append-only. */
export const CATALOG_KIND_COUNT = 5;

/**
 * 종류별 i18n 키 접두. 인덱스 = 종류 코드(계약 — 재배치 금지).
 * 최종 키는 `def3.<접두>.<슬러그>.name` 꼴이다.
 */
export const CATALOG_KIND_PREFIX: readonly string[] = [
  'formation',
  'fac',
  'prop',
  'boss',
  'map',
];

// ---------------------------------------------------------------------------
// i18n 식별자 파생
// ---------------------------------------------------------------------------

/**
 * 원본 파일이 쓰는 안정 식별자(`FormationDef.id`·`FacilitySpec.key` 등)에서 슬러그를 뽑는다.
 *
 * 원본마다 접두 표기가 제각각이다(`formation-scout-drones` / `fac.rapid` / `shieldGenerator`).
 * 여기서 종류 접두를 한 번 벗겨 `def3.<접두>.<슬러그>` 한 형태로 통일한다 — 하드코딩 표가
 * 아니라 순수 파생이라 원본이 늘어도 손댈 곳이 없다.
 */
export function catalogSlug(kind: number, rawId: string): string {
  const prefix = CATALOG_KIND_PREFIX[kind];
  if (prefix === undefined) return rawId;
  if (rawId.startsWith(`${prefix}.`)) return rawId.slice(prefix.length + 1);
  if (rawId.startsWith(`${prefix}-`)) return rawId.slice(prefix.length + 1);
  return rawId;
}

/** 카탈로그 항목 1건의 i18n 식별자(`formation.scout-drones` 꼴). */
export function catalogI18nId(kind: number, rawId: string): string {
  const prefix = CATALOG_KIND_PREFIX[kind] ?? '';
  return `${prefix}.${catalogSlug(kind, rawId)}`;
}

/** 표시명 i18n 키. */
export function def3NameKey(i18nId: string): string {
  return `def3.${i18nId}.name`;
}

/** 설명 i18n 키. */
export function def3DescKey(i18nId: string): string {
  return `def3.${i18nId}.desc`;
}

// ---------------------------------------------------------------------------
// 레지스트리
// ---------------------------------------------------------------------------

/** 카탈로그 항목 1건(원본 배열에서 파생 — 정의를 복제하지 않는다). */
export interface CatalogEntry {
  /** 종류 코드(CATALOG_*). */
  readonly kind: number;
  /** 종류 안에서의 배열 인덱스 = catalogId(계약). */
  readonly catalogId: number;
  /** 원본이 선언한 안정 식별자(`FormationDef.id` 등). */
  readonly rawId: string;
  /** 통일된 i18n 식별자(`fac.rapid` 꼴). */
  readonly i18nId: string;
}

function entriesOf(kind: number, rawIds: readonly string[]): CatalogEntry[] {
  return rawIds.map((rawId, catalogId) => ({
    kind,
    catalogId,
    rawId,
    i18nId: catalogI18nId(kind, rawId),
  }));
}

/**
 * 카탈로그 전량(M7a 임시 16종 — 편대 3 · 설비 6 · 기물 3 · 보스 1 · 맵 3).
 * 순서 = 종류 코드 오름차순 → 종류 안에서 catalogId 오름차순.
 * M7c 풀 카탈로그는 원본 배열에 append 만 하면 여기 자동 반영된다.
 */
export const INVASION_CATALOG: readonly CatalogEntry[] = [
  ...entriesOf(
    CATALOG_FORMATION,
    FORMATIONS.map((f) => f.id),
  ),
  ...entriesOf(
    CATALOG_FACILITY,
    INVASION_FACILITIES.map((f) => f.key),
  ),
  ...entriesOf(
    CATALOG_PROP,
    L3_PROPS.map((p) => p.id),
  ),
  ...entriesOf(
    CATALOG_BOSS,
    DEFENSE_BOSSES.map((b) => b.id),
  ),
  ...entriesOf(
    CATALOG_MAP,
    INVASION_MAP_TEMPLATES.map((m) => m.key),
  ),
];

/** 종류별 등록 수. 인덱스 = 종류 코드. */
export const CATALOG_KIND_COUNTS: readonly number[] = [
  FORMATIONS.length,
  INVASION_FACILITIES.length,
  L3_PROPS.length,
  DEFENSE_BOSSES.length,
  INVASION_MAP_TEMPLATES.length,
];

/** 등록된 카탈로그 항목 총수. */
export const INVASION_CATALOG_COUNT = INVASION_CATALOG.length;

/** 종류 + catalogId → 항목. 미등록이면 undefined(호출부가 조용히 건너뛴다). */
export function catalogEntry(kind: number, catalogId: number): CatalogEntry | undefined {
  for (const e of INVASION_CATALOG) {
    if (e.kind === kind && e.catalogId === catalogId) return e;
  }
  return undefined;
}

/** 특정 종류의 항목 전량(등록 순서 = catalogId 순서). */
export function catalogEntriesOfKind(kind: number): CatalogEntry[] {
  return INVASION_CATALOG.filter((e) => e.kind === kind);
}

/**
 * 카탈로그 전량에서 파생한 i18n 키 목록(name·desc 각 1건).
 * tests/i18n.test.ts 가 이 목록으로 EN·KO 전수 존재를 강제한다 — 하드코딩 목록이 아니라
 * 파생이라, 신규 방어체를 추가하면 문구를 채우기 전까지 테스트가 빨간불로 남는다.
 */
export const DEF3_MESSAGE_KEYS: readonly string[] = INVASION_CATALOG.flatMap((e) => [
  def3NameKey(e.i18nId),
  def3DescKey(e.i18nId),
]);
