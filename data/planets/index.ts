/**
 * 행성 콘텐츠 레지스트리 — 데이터 주도 행성 메타(plan Phase E3, AC8).
 *
 * 한 행성의 "전투 콘텐츠 묶음"(로스터·엘리트·웨이브 카드 풀·보스·드랍 테이블·특산
 * 광물 2종)을 한 곳에 모아 index로 노출한다. 시뮬(웨이브 디렉터·보스)과 정산/성계
 * 지도(다른 레인)가 모두 이 레지스트리를 `state.config.planet`으로 조회해 소비한다 —
 * 새 행성 추가 = 여기에 행 하나 추가(코드 아닌 데이터 작업, plan 원칙4).
 *
 * planetIndex는 WorldConfig.planet(0 카르곤 / 1 베르단)과 1:1. 드랍 테이블은
 * src/sim/drops.ts가 rarity odds 기준으로 소비하고, 특산 광물은 정산 레이어(Lane 2)가
 * 분해 환산에 쓴다(광물 id·이름만 데이터로 고정, 수치 밸런스는 정산에서).
 */

import type { EnemyDef, EnemyRole } from '../../src/sim/patterns/types.js';
import type { WaveCard } from '../waves.js';
import type { BossDef } from '../boss.js';
import { KARGON_ROSTER } from '../enemies.js';
import { CARD_POOL } from '../waves.js';
import { LAVA_FORTRESS } from '../boss.js';
import { BERDAN_ROSTER, BERDAN_ELITES, BERDAN_CARD_POOL } from './berdan.js';
import { BERDAN_QUEEN } from '../bosses/berdan-queen.js';
import { NIFLHEIM_ROSTER, NIFLHEIM_ELITES, NIFLHEIM_CARD_POOL } from './niflheim.js';
import { NIFLHEIM_FLAGSHIP } from '../bosses/niflheim-flagship.js';
import { ARKE_ROSTER, ARKE_ELITES, ARKE_CARD_POOL } from './arke.js';
import { ARKE_OBELISK } from '../bosses/arke-obelisk.js';
import {
  PLANET_BLUEPRINT_SPECIALTIES,
  mergeBlueprintGrants,
  type BlueprintGrant,
  type BlueprintSpecialty,
} from './blueprints.js';
import { CATALOG_BOSS, CATALOG_KIND_COUNTS } from '../invasion/catalog.js';
import { rollBlueprintDrop } from '../../src/sim/drops.js';

/**
 * 행성 드랍 rarity 기준 확률(src/sim/drops.ts가 소비).
 *
 * 품질(침략 단계)⟂종류(행성) 직교(ADR-0022): 드랍 rarity 배율은 **전 행성 동일**이고,
 * 단계별 상향은 sim(`stageRareMult`/`stageUniqueMult`)이 얹는다. 종류(특산 설계도·광물)만
 * 행성별로 갈린다 — 그래서 `eliteRareBase` 등은 전 행성 동일값이다(심층 사다리 폐기).
 */
export interface PlanetDropTable {
  /** 엘리트 레어 기본 확률(단계1 기준, 전 행성 동일 — 단계 상향은 sim). */
  readonly eliteRareBase: number;
  /** 엘리트 유니크 기본 확률(단계1 기준, 전 행성 동일 — 단계 상향은 sim). */
  readonly eliteUniqueBase: number;
  /** 보스 유니크 기본 확률(나머지는 레어 확정). */
  readonly bossUniqueBase: number;
  /**
   * 행성 특산 설계도 테이블 크기(M7b-acquisition — **기존 3행 뒤에 append**). 값은 항상
   * `planetBlueprintTableSize(index)` 에서 가져온다(하드코딩하면 목록과 갈린다).
   */
  readonly blueprintTableSize?: number;
  /** 등급 코드별 설계도 동반 확률(centi-percent). 미지정이면 sim 기본표. */
  readonly blueprintChanceCp?: readonly number[];
}

/** 행성 특산 광물(분해 환산·상점 재료). 데이터 id·이름만 고정. */
export interface Mineral {
  readonly id: string;
  /** 한글 표기(툴팁/정산). */
  readonly name: string;
}

/** 한 행성의 전투 콘텐츠 묶음. */
export interface PlanetContent {
  readonly index: number;
  readonly id: string;
  /** 한글 표기(성계 지도/HUD). */
  readonly name: string;
  /** 역할 슬롯 로스터(웨이브 카드가 역할로 참조). */
  readonly roster: Record<EnemyRole, EnemyDef>;
  /** 정예(엘리트-타입) 적. 웨이브 카드의 elite 인덱스가 참조. */
  readonly elites: readonly EnemyDef[];
  readonly cardPool: readonly WaveCard[];
  readonly boss: BossDef;
  readonly dropTable: PlanetDropTable;
  /** 특산 광물 2종. */
  readonly minerals: readonly [Mineral, Mineral];
}

// ---------------------------------------------------------------------------
// 행성 특산 설계도 분배 규칙 (미결 #6 확정 — M7c-content)
// ---------------------------------------------------------------------------

/**
 * ## 분배 규칙 정본 (미결 #6)
 *
 * "이 편대를 얻으려면 이 행성을 파밍한다" 는 진행 동기가 이 규칙 하나에 걸려 있다. 규칙은
 * 두 층으로 나뉜다 — 사람이 정하는 **테마 배정**과, 손대지 않아도 굴러가는 **자동 파생**.
 *
 * 1. **명시 배정(테마 축)** — `data/planets/blueprints.ts` 의 행성별 목록이 정본이다.
 *    카르곤=화염·직격 / 베르단=물량·소환 / 니플헤임=저지·보호 / 아르케=정밀·기계.
 *    기획자가 테마를 판단해 넣는 층이라 코드가 대신할 수 없다.
 * 2. **자동 파생(미배정 잔여)** — 카탈로그에 있는데 어느 목록에도 없는 방어체는
 *    {@link derivePlanetBlueprints} 가 규칙으로 배정한다. 그래서 다음 마일스톤이 카탈로그에
 *    항목을 append 하고 표를 손으로 갱신하지 않아도 **분배가 비지 않는다**.
 * 3. **공급 행성은 정확히 1곳** — 명시 배정이 이미 있으면 자동 파생은 손대지 않는다.
 *    중복 공급을 만들면 "아무 데나 돌아도 나온다" 가 되어 행성 선택이 무의미해진다.
 * 4. **보스는 최심 행성 전용 · 최저 가중치** — 천장 재료다.
 * 5. **균등** — 보스를 먼저 놓고, 나머지는 **항목 수가 가장 적은 행성**(동수면 낮은 index)에
 *    붙인다. 그래서 파밍 가치가 한 행성에 몰리지 않는다.
 * 6. **append-only** — 자동 파생분은 언제나 그 행성 목록의 **끝에** 붙는다. 기존 항목의
 *    인덱스가 밀리지 않아 `PlanetDropTable` 은 4행 구조 그대로다.
 *
 * 순수 함수다(RNG·시각 미소비). 결과는 카탈로그 배열 길이만의 함수라 결정론적이다.
 */
export function derivePlanetBlueprints(
  explicit: readonly (readonly BlueprintSpecialty[])[],
  kindCounts: readonly number[] = CATALOG_KIND_COUNTS,
): BlueprintSpecialty[][] {
  const out: BlueprintSpecialty[][] = explicit.map((list) => [...list]);
  if (out.length === 0) return out;
  const deepest = out.length - 1;
  const assigned = new Set<string>();
  for (const list of explicit) for (const e of list) assigned.add(`${e.kind}:${e.catalogId}`);

  /** 미배정 항목을 (종류, catalogId) 오름차순으로 모은다 — 카탈로그 순서 = 결정론 순서. */
  const pending: { kind: number; catalogId: number }[] = [];
  for (let kind = 0; kind <= CATALOG_BOSS; kind++) {
    const count = kindCounts[kind] ?? 0;
    for (let catalogId = 0; catalogId < count; catalogId++) {
      if (!assigned.has(`${kind}:${catalogId}`)) pending.push({ kind, catalogId });
    }
  }
  // 규칙 4·5: 보스를 먼저 최심 행성에 못 박고, 그 무게까지 센 뒤 나머지를 균등 배분한다.
  for (const p of pending) {
    if (p.kind !== CATALOG_BOSS) continue;
    out[deepest]!.push({ ...p, weight: AUTO_BLUEPRINT_WEIGHT_BOSS });
  }
  for (const p of pending) {
    if (p.kind === CATALOG_BOSS) continue;
    let target = 0;
    for (let i = 1; i < out.length; i++) if (out[i]!.length < out[target]!.length) target = i;
    out[target]!.push({ ...p, weight: AUTO_BLUEPRINT_WEIGHT });
  }
  return out;
}

/** 자동 파생 항목의 기본 가중치(명시 배정 평균 근처 — 튀지 않게). */
export const AUTO_BLUEPRINT_WEIGHT = 2;
/** 자동 파생 보스의 가중치(규칙 4 — 항상 최저). */
export const AUTO_BLUEPRINT_WEIGHT_BOSS = 1;

/** 가중치만큼 펼친다(균등 인덱스 → 가중 추첨). `blueprints.ts` 의 전개와 같은 규칙. */
function expandWeights(list: readonly BlueprintSpecialty[]): readonly BlueprintSpecialty[] {
  const out: BlueprintSpecialty[] = [];
  for (const e of list) {
    const w = Number.isInteger(e.weight) && e.weight > 0 ? e.weight : 1;
    for (let i = 0; i < w; i++) out.push(e);
  }
  return out;
}

/**
 * 행성 index → 특산 목록(명시 배정 + 자동 파생, 가중치 미전개). **분배의 정본**이다 —
 * 드랍 테이블 크기도 확정도 전부 여기서 파생하므로 두 갈래 진실이 생기지 않는다.
 */
export const PLANET_BLUEPRINTS: readonly (readonly BlueprintSpecialty[])[] =
  derivePlanetBlueprints(PLANET_BLUEPRINT_SPECIALTIES);

/** 행성 index → **펼친** 특산 테이블. 길이가 곧 `DropOdds.blueprintTableSize` 다. */
export const PLANET_BLUEPRINT_DROP_TABLES: readonly (readonly BlueprintSpecialty[])[] =
  PLANET_BLUEPRINTS.map(expandWeights);

/** 행성 index → 펼친 테이블 길이. 범위를 벗어나면 0(그 행성은 설계도 미지급). */
export function planetBlueprintTableSize(planetIndex: number | undefined): number {
  return PLANET_BLUEPRINT_DROP_TABLES[planetIndex ?? 0]?.length ?? 0;
}

/**
 * sim 이 낸 불투명 코드 → 실제 설계도. 테이블 밖 인덱스는 null(조용히 미지급).
 * sim 은 카탈로그를 모르고 `{tableIndex, seed}` 만 낸다 — 확정은 이 메타 레이어의 책임이다.
 */
export function resolvePlanetBlueprintDrop(
  planetIndex: number | undefined,
  code: { tableIndex: number; seed: number },
): BlueprintGrant | null {
  const table = PLANET_BLUEPRINT_DROP_TABLES[planetIndex ?? 0];
  if (table === undefined) return null;
  const e = table[code.tableIndex];
  if (e === undefined) return null;
  return { kind: e.kind, catalogId: e.catalogId, count: 1 };
}

/** 카르곤(0) — M1 화산 행성. 기존 로스터/카드/보스 재사용. */
export const KARGON: PlanetContent = {
  index: 0,
  id: 'kargon',
  name: '카르곤',
  roster: KARGON_ROSTER,
  elites: [],
  cardPool: CARD_POOL,
  boss: LAVA_FORTRESS,
  // 카르곤 드랍 기준값 = src/sim/drops.ts 기존 상수(정합). 변경 시 함께 유지.
  dropTable: {
    eliteRareBase: 0.25,
    eliteUniqueBase: 0.03,
    bossUniqueBase: 0.15,
    blueprintTableSize: planetBlueprintTableSize(0),
    blueprintChanceCp: [0, 0, 500, 2000],
  },
  minerals: [
    { id: 'kargon-obsidian', name: '흑요석 파편' },
    { id: 'kargon-magmite', name: '용암정' },
  ],
};

/** 베르단(1) — M2 곤충 군체 행성. 물량 압박·소환 여왕. */
export const BERDAN: PlanetContent = {
  index: 1,
  id: 'berdan',
  name: '베르단',
  roster: BERDAN_ROSTER,
  elites: BERDAN_ELITES,
  cardPool: BERDAN_CARD_POOL,
  boss: BERDAN_QUEEN,
  // 품질(단계)⟂종류(행성) 직교(ADR-0022): rarity 배율은 전 행성 동일(= 카르곤 기본값 =
  // DEFAULT_DROP_ODDS). 심층 사다리(0.27/0.04/0.18)는 폐기 — 종류(특산 설계도·광물)만 행성별.
  dropTable: {
    eliteRareBase: 0.25,
    eliteUniqueBase: 0.03,
    bossUniqueBase: 0.15,
    blueprintTableSize: planetBlueprintTableSize(1),
    blueprintChanceCp: [0, 0, 600, 2200],
  },
  minerals: [
    { id: 'berdan-chitin', name: '경화 키틴' },
    { id: 'berdan-royal-jelly', name: '여왕 젤리' },
  ],
};

/** 니플헤임(2) — M3 빙설·유령 함대 행성. 그물·감속 압박·유령 기함. */
export const NIFLHEIM: PlanetContent = {
  index: 2,
  id: 'niflheim',
  name: '니플헤임',
  roster: NIFLHEIM_ROSTER,
  elites: NIFLHEIM_ELITES,
  cardPool: NIFLHEIM_CARD_POOL,
  boss: NIFLHEIM_FLAGSHIP,
  // 품질(단계)⟂종류(행성) 직교(ADR-0022): rarity 배율은 전 행성 동일(= 카르곤 기본값).
  // 심층 사다리(0.28/0.05/0.20)는 폐기 — 종류(특산 설계도·광물)만 행성별.
  dropTable: {
    eliteRareBase: 0.25,
    eliteUniqueBase: 0.03,
    bossUniqueBase: 0.15,
    blueprintTableSize: planetBlueprintTableSize(2),
    blueprintChanceCp: [0, 0, 700, 2400],
  },
  minerals: [
    { id: 'niflheim-rime-crystal', name: '서리 결정' },
    { id: 'niflheim-ghost-alloy', name: '유령 합금' },
  ],
};

/** 아르케(3) — M3 고대 기계 행성. 정밀 포격·기하학 탄막·수호자 오벨리스크. */
export const ARKE: PlanetContent = {
  index: 3,
  id: 'arke',
  name: '아르케',
  roster: ARKE_ROSTER,
  elites: ARKE_ELITES,
  cardPool: ARKE_CARD_POOL,
  boss: ARKE_OBELISK,
  // 품질(단계)⟂종류(행성) 직교(ADR-0022): rarity 배율은 전 행성 동일(= 카르곤 기본값).
  // 심층 사다리(0.30/0.06/0.22)는 폐기 — 종류(특산 설계도·광물)만 행성별.
  dropTable: {
    eliteRareBase: 0.25,
    eliteUniqueBase: 0.03,
    bossUniqueBase: 0.15,
    blueprintTableSize: planetBlueprintTableSize(3),
    blueprintChanceCp: [0, 0, 800, 2600],
  },
  minerals: [
    { id: 'arke-ancient-core', name: '고대 코어' },
    { id: 'arke-relic-plating', name: '유물 장갑판' },
  ],
};

/** 행성 레지스트리(index 순). 새 행성은 여기에 append. */
export const PLANETS: readonly PlanetContent[] = [KARGON, BERDAN, NIFLHEIM, ARKE];

/** planet index → 콘텐츠. 범위를 벗어나면 카르곤(0)으로 안전 폴백. */
export function planetContent(index: number | undefined): PlanetContent {
  return PLANETS[index ?? 0] ?? KARGON;
}

// ---------------------------------------------------------------------------
// 설계도 드랍 — 정산 입력 (M7b-acquisition)
// ---------------------------------------------------------------------------

/** {@link blueprintDropsFromLoot} 입력 — `LootRecord` 의 부분집합(sim 타입 의존 없음). */
export interface LootLike {
  readonly seed: number;
  readonly rarity: number;
  readonly planet: number;
}

/**
 * 런이 수거한 장비 드랍 목록 → 동반 설계도 목록(순수).
 *
 * 정산이 `LootRecord` 를 장비로 확정하는 것과 **같은 입력**에서 파생한다 — 설계도용 추가
 * RNG 소비도, `LootRecord` 스키마 확장도 없다(그래서 해시·fixture 가 그대로다). 판정은
 * 드랍이 난 행성의 특산 테이블로 하므로 "이 방어체는 이 행성" 규칙이 자동으로 지켜진다.
 */
export function blueprintDropsFromLoot(loot: readonly LootLike[]): BlueprintGrant[] {
  const grants: BlueprintGrant[] = [];
  for (const rec of loot) {
    const odds = planetContent(rec.planet).dropTable;
    const code = rollBlueprintDrop({ seed: rec.seed, rarityCode: rec.rarity }, odds);
    if (code === null) continue;
    const grant = resolvePlanetBlueprintDrop(rec.planet, code);
    if (grant !== null) grants.push(grant);
  }
  return mergeBlueprintGrants(grants);
}
