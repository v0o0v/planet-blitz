/**
 * 행성 특산 설계도 분배 — 방어체 획득 경로의 정본 (M7b-acquisition · 기획 §4, 미결 #6 해소).
 *
 * "이 편대를 얻으려면 이 행성을 파밍한다" 는 동기가 **이 파일 하나**에 걸려 있다. M7a 임시
 * 카탈로그 13종(편대 3 · 설비 6 · 기물 3 · 보스 1)을 현행 행성 4종에 **겹치지 않게** 나눠,
 * 각 방어체의 공급원이 정확히 한 행성이 되게 했다. 겹치면 "아무 데나 돌아도 나온다" 가 되어
 * 행성 선택이 무의미해진다.
 *
 * ## 레이어 경계
 * sim(`src/sim/drops.ts`)은 방어체 카탈로그를 **몰라야 한다**. 그래서 sim 은 테이블 크기만
 * 받아 `{tableIndex, seed}` 불투명 코드를 내고, 그 코드를 실제 `{kind, catalogId}` 로 푸는
 * 것은 이 모듈(메타 레이어)이다 — 장비 드랍이 `rarityCode` 만 내고 `rollItem` 이 확정하는
 * 현행 철학과 같다.
 *
 * ## 가중치
 * 항목마다 `weight`(1 이상 정수)를 주고, 모듈 로드 시 **가중치만큼 펼친 배열**을 만든다.
 * sim 이 균등 인덱스를 뽑아도 펼친 배열 덕에 가중 추첨이 성립하고, 나눗셈·부동소수가 한 번도
 * 등장하지 않는다.
 *
 * ## 테이블 순서 = 계약(append-only)
 * `tableIndex` 가 펼친 배열의 인덱스이므로, 기존 항목 사이에 끼워 넣거나 가중치를 바꾸면
 * **같은 드랍 시드가 다른 설계도를 가리킨다**. 재현 대상은 아니지만(설계도 확정은 정산
 * 1회로 끝난다) 클라·서버 배포 스큐 구간에서 결과가 갈릴 수 있으므로, 항목 추가는 **행성
 * 목록 끝에 append** 하고 가중치 변경은 배포 경계에서만 한다.
 *
 * ## M7c 풀 카탈로그 확장 규칙
 *   1. 신규 방어체는 **테마 축**으로 배정한다 — 카르곤=화염·직격, 베르단=물량·소환,
 *      니플헤임=저지·보호, 아르케=정밀·기계.
 *   2. 한 방어체의 공급 행성은 **정확히 1곳**(중복 공급 금지 — 행성 선택의 의미를 지킨다).
 *   3. 행성별 항목 수는 ±1 이내로 균등하게 유지한다(한 행성만 파밍 가치가 몰리지 않게).
 *   4. 보스는 항상 최심 행성 우선 배정하고, 가중치를 가장 낮게 준다(천장 재료).
 *   5. 추가는 각 행성 배열 **끝에 append**(위 계약).
 *
 * 데이터 전용 모듈이다 — sim·render·ui 를 import 하지 않는다(`data/invasion/catalog.ts` 의
 * 종류 코드만 참조).
 */

import {
  CATALOG_FORMATION,
  CATALOG_FACILITY,
  CATALOG_PROP,
  CATALOG_BOSS,
} from '../invasion/catalog.js';

// ---------------------------------------------------------------------------
// 항목
// ---------------------------------------------------------------------------

/** 행성 특산 설계도 1종. */
export interface BlueprintSpecialty {
  /** 카탈로그 종류 코드(CATALOG_FORMATION..CATALOG_BOSS = 0..3). */
  readonly kind: number;
  /** 종류 안에서의 배열 인덱스 = catalogId(append-only 계약). */
  readonly catalogId: number;
  /** 추첨 가중치(1 이상 정수). 클수록 자주 나온다. */
  readonly weight: number;
}

/** 설계도 획득 1건(정산·서버 지급 입력). */
export interface BlueprintGrant {
  readonly kind: number;
  readonly catalogId: number;
  /** 장수(현행은 항상 1 — 복수 지급은 서버가 합산한다). */
  readonly count: number;
}

// ---------------------------------------------------------------------------
// 행성별 특산 목록 (미결 #6 확정값)
// ---------------------------------------------------------------------------

/**
 * 카르곤(0) — 화염·직격. 정면으로 밀어붙이는 계열이 여기서만 나온다.
 * 강습 돌격편대(편대 2) · 화염 분출구(설비 4) · 고정 주포(기물 2).
 */
export const KARGON_BLUEPRINTS: readonly BlueprintSpecialty[] = [
  { kind: CATALOG_FORMATION, catalogId: 2, weight: 3 },
  { kind: CATALOG_FACILITY, catalogId: 4, weight: 4 },
  { kind: CATALOG_PROP, catalogId: 2, weight: 2 },
];

/**
 * 베르단(1) — 물량·소환. 수를 불리는 계열의 공급원.
 * 정찰 드론편대(편대 0) · 드론 사출기(설비 5) · 중력 앵커(기물 1).
 */
export const BERDAN_BLUEPRINTS: readonly BlueprintSpecialty[] = [
  { kind: CATALOG_FORMATION, catalogId: 0, weight: 4 },
  { kind: CATALOG_FACILITY, catalogId: 5, weight: 3 },
  { kind: CATALOG_PROP, catalogId: 1, weight: 2 },
];

/**
 * 니플헤임(2) — 저지·보호. 진입을 늦추고 코어를 감싸는 계열.
 * 요격 편대(편대 1) · 속사포(설비 0) · 곡사 박격포(설비 2) · 실드 발생기(기물 0).
 */
export const NIFLHEIM_BLUEPRINTS: readonly BlueprintSpecialty[] = [
  { kind: CATALOG_FORMATION, catalogId: 1, weight: 3 },
  { kind: CATALOG_FACILITY, catalogId: 0, weight: 4 },
  { kind: CATALOG_FACILITY, catalogId: 2, weight: 3 },
  { kind: CATALOG_PROP, catalogId: 0, weight: 2 },
];

/**
 * 아르케(3) — 정밀·기계. 최심 행성이라 천장 재료(보스)를 여기서만 준다.
 * 관통 레일포(설비 1) · 레이저 격자(설비 3) · 강철 골리앗(보스 0).
 */
export const ARKE_BLUEPRINTS: readonly BlueprintSpecialty[] = [
  { kind: CATALOG_FACILITY, catalogId: 1, weight: 3 },
  { kind: CATALOG_FACILITY, catalogId: 3, weight: 3 },
  { kind: CATALOG_BOSS, catalogId: 0, weight: 1 },
];

/** 행성 index → 특산 목록(가중치 미전개). PLANETS 와 같은 순서. */
export const PLANET_BLUEPRINT_SPECIALTIES: readonly (readonly BlueprintSpecialty[])[] = [
  KARGON_BLUEPRINTS,
  BERDAN_BLUEPRINTS,
  NIFLHEIM_BLUEPRINTS,
  ARKE_BLUEPRINTS,
];

// ---------------------------------------------------------------------------
// 가중치 전개 + 조회
// ---------------------------------------------------------------------------

/** 가중치만큼 항목을 되풀이해 펼친다(균등 인덱스 → 가중 추첨). */
function expand(list: readonly BlueprintSpecialty[]): readonly BlueprintSpecialty[] {
  const out: BlueprintSpecialty[] = [];
  for (const e of list) {
    const w = Number.isInteger(e.weight) && e.weight > 0 ? e.weight : 1;
    for (let i = 0; i < w; i++) out.push(e);
  }
  return out;
}

/** 행성 index → **펼친** 특산 테이블. 길이가 곧 `DropOdds.blueprintTableSize` 다. */
export const PLANET_BLUEPRINT_TABLES: readonly (readonly BlueprintSpecialty[])[] =
  PLANET_BLUEPRINT_SPECIALTIES.map(expand);

/** 행성 index → 펼친 테이블 길이. 범위를 벗어나면 0(그 행성은 설계도 미지급). */
export function blueprintTableSize(planetIndex: number | undefined): number {
  return PLANET_BLUEPRINT_TABLES[planetIndex ?? 0]?.length ?? 0;
}

/**
 * sim 이 낸 불투명 코드 → 실제 설계도. 테이블 밖 인덱스는 null(조용히 미지급).
 *
 * `seed` 는 여기서 쓰지 않는다 — 현행 규칙은 "1건 = 1장" 이라 추가 롤이 필요 없다. 장수
 * 가변화(예: 유니크 드랍은 2장) 같은 확장이 붙으면 이 시드를 입력으로 쓴다.
 */
export function resolveBlueprintDrop(
  planetIndex: number | undefined,
  code: { tableIndex: number; seed: number },
): BlueprintGrant | null {
  const table = PLANET_BLUEPRINT_TABLES[planetIndex ?? 0];
  if (table === undefined) return null;
  const e = table[code.tableIndex];
  if (e === undefined) return null;
  return { kind: e.kind, catalogId: e.catalogId, count: 1 };
}

/** 같은 (kind, catalogId) 끼리 장수를 합친다(서버 지급 호출 수를 줄인다). */
export function mergeBlueprintGrants(grants: readonly BlueprintGrant[]): BlueprintGrant[] {
  const acc = new Map<string, BlueprintGrant>();
  for (const g of grants) {
    const key = `${g.kind}:${g.catalogId}`;
    const prev = acc.get(key);
    acc.set(key, prev === undefined ? g : { ...g, count: prev.count + g.count });
  }
  return [...acc.values()];
}

// ---------------------------------------------------------------------------
// 제작 — 설계도 + 희귀 광물
// ---------------------------------------------------------------------------

/**
 * 제작 1회 비용(설계도 장수 + 희귀 광물). **반복 파밍의 천장값**이다(기획 §4) — 설계도만
 * 쌓아도 광물이 없으면 못 만들고, 광물만 쌓아도 그 행성을 돌지 않으면 못 만든다.
 *
 * 값은 `supabase/migrations/20260722020000_m7b_blueprint_drops.sql` 의 `craft_defense_unit`
 * 과 **미러**다. 한쪽만 고치면 표기와 차감이 갈린다.
 */
export const CRAFT_BLUEPRINT_COST = 1;
/** 제작 1회 희귀 광물 비용(SQL 미러). */
export const CRAFT_MINERAL_COST = 12;
/** 보스 설계도는 천장 재료라 제작 비용이 더 든다(SQL 미러). */
export const CRAFT_MINERAL_COST_BOSS = 40;

/** 종류별 제작 광물 비용. 보스만 비싸다. */
export function craftMineralCost(kind: number): number {
  return kind === CATALOG_BOSS ? CRAFT_MINERAL_COST_BOSS : CRAFT_MINERAL_COST;
}
