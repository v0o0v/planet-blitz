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
import { PLANET_MODE, type PlanetMode } from '../../src/sim/planetMode.js';
import { KARGON_ROSTER, KARGON_ELITES } from '../enemies.js';
import { CARD_POOL } from '../waves.js';
import { LAVA_FORTRESS } from '../boss.js';
import { BERDAN_ROSTER, BERDAN_ELITES, BERDAN_CARD_POOL } from './berdan.js';
import { BERDAN_QUEEN } from '../bosses/berdan-queen.js';
import { NIFLHEIM_ROSTER, NIFLHEIM_ELITES, NIFLHEIM_CARD_POOL } from './niflheim.js';
import { NIFLHEIM_FLAGSHIP } from '../bosses/niflheim-flagship.js';
import { ARKE_ROSTER, ARKE_ELITES, ARKE_CARD_POOL } from './arke.js';
import { ARKE_OBELISK } from '../bosses/arke-obelisk.js';
import { TOXAR_ROSTER, TOXAR_ELITES, TOXAR_CARD_POOL } from './toxar.js';
import { TOXAR_BLIGHT } from '../bosses/toxar-blight.js';
import { KRAS_ROSTER, KRAS_ELITES, KRAS_CARD_POOL } from './kras.js';
import { KRAS_COLOSSUS } from '../bosses/kras-colossus.js';
import {
  PLANET_BLUEPRINT_SPECIALTIES,
  mergeBlueprintGrants,
  type BlueprintGrant,
  type BlueprintSpecialty,
} from './blueprints.js';
import { CATALOG_BOSS, CATALOG_KIND_COUNTS } from '../invasion/catalog.js';
import {
  rollRunBlueprint,
  DEFAULT_BLUEPRINT_CHANCE_CP,
  type BlueprintCandidate,
} from '../../src/sim/drops.js';

/**
 * 행성 드랍 rarity 기준 확률(src/sim/drops.ts가 소비).
 *
 * 품질(침략 단계)⟂종류(행성) 직교(ADR-0022): 드랍 rarity 배율은 **전 행성 동일**이고,
 * 단계별 상향은 sim(`stageRareMult`/`stageUniqueMult`)이 얹는다. 종류(특산 설계도·광물)만
 * 행성별로 갈린다 — 그래서 `eliteRareBase` 등은 전 행성 동일값이다(심층 사다리 폐기).
 *
 * ⚠️ **전 행성 동일값은 계약이다.** 유니크 base 를 조정할 때 `src/sim/drops.ts` 의
 * `DEFAULT_DROP_ODDS` 만 고치고 여기를 빼먹으면 "카르곤만 유니크가 안 나온다" 류의 행성별
 * 편차 결함이 된다 — 두 곳을 **항상 같은 배수로** 움직인다(2026-07-27 유니크 base 1/7.5 패스).
 *
 * ⚠️ **계약의 범위가 좁아졌다(ADR-0038, 2026-07-27).** "전 행성 동일"은 이제 **품질(rarity) 축
 * 한정**이다 — 위 세 base 와 단계 곡선은 여전히 전 행성 동일이고 행성 인기 배율이 절대 닿지
 * 않는다. 반면 **수량·XP·자원 축은 행성별로 갈린다**(행성 인기 배율). 이 문장이 ADR-0022 ·
 * ADR-0035 · 이 주석 세 곳에 같이 적혀 있으니 하나만 고치지 마라.
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
  /**
   * 행성 모드(ADR-0021, Lane2). 이 행성이 어느 게임플레이 규칙 집합으로 도는지의 정본이다.
   * `buildRunConfig` 가 이 값을 `WorldConfig.planetMode` 로 스탬프한다(데이터 주도).
   */
  readonly mode: PlanetMode;
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
  // 보스 설계도는 **고정 보스 행성**에만 쌓는다(규칙 4 완화 — Lane9). parallel-planet 모델에서
  // "최심"은 무의미하므로 out.length-1(최종 행성)이 아니라 아르케(BOSS_BLUEPRINT_PLANET)에
  // 못 박는다. 방어적: 행성이 4개 미만이라 상수가 범위를 벗어나면 최종 행성으로 폴백한다.
  const bossPlanet = BOSS_BLUEPRINT_PLANET < out.length ? BOSS_BLUEPRINT_PLANET : out.length - 1;
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
  // 규칙 4·5: 보스를 먼저 고정 보스 행성에 못 박고, 그 무게까지 센 뒤 나머지를 균등 배분한다.
  for (const p of pending) {
    if (p.kind !== CATALOG_BOSS) continue;
    out[bossPlanet]!.push({ ...p, weight: AUTO_BLUEPRINT_WEIGHT_BOSS });
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

/**
 * 보스 설계도가 쌓이는 **고정 행성 index**(아르케 = 3, Lane9 규칙 4 완화).
 *
 * 6행성 parallel-planet 모델(ADR-0021)에선 "최심 행성"이 무의미해졌다 — 톡사르(4)·크라스(5)는
 * 아르케보다 뒤 index 지만 난이도 사다리의 더 깊은 층이 아니다. 그래서 보스 blueprint 는
 * `derivePlanetBlueprints` 의 자동 파생이든 명시 배정이든 이 상수 한 곳(아르케)에 집중한다.
 * `blueprints.ts` 의 명시 배정도 이 index 를 쓰고, `tests/planetDrops.test.ts` 가 이 상수를
 * 보스 행성 오라클로 참조한다(하드코딩 3 이 여기저기 흩어지지 않게).
 */
export const BOSS_BLUEPRINT_PLANET = 3;

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
  // ADR-0021 배정: 카르곤 = vampire(0) 온보딩 기준 모드(현행 뱀서류 경로).
  mode: PLANET_MODE.vampire,
  roster: KARGON_ROSTER,
  // 2026-08-04: 오래 비어 있던 자리. 비어 있는 동안 카르곤은 정예 카드가 없었고
  // `stepEliteSummons` 가 로스터로 폴백해 정예 소집령이 일반몹을 내려보냈다(`data/enemies.ts`).
  elites: KARGON_ELITES,
  cardPool: CARD_POOL,
  boss: LAVA_FORTRESS,
  // 카르곤 드랍 기준값 = src/sim/drops.ts 기존 상수(정합). 변경 시 함께 유지.
  dropTable: {
    eliteRareBase: 0.25,
    eliteUniqueBase: 0.004,
    bossUniqueBase: 0.02,
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
  // ADR-0021 배정: 베르단 = shrink(4) 수축 지대(곤충 군체 공간압박).
  mode: PLANET_MODE.shrink,
  roster: BERDAN_ROSTER,
  elites: BERDAN_ELITES,
  cardPool: BERDAN_CARD_POOL,
  boss: BERDAN_QUEEN,
  // 품질(단계)⟂종류(행성) 직교(ADR-0022): rarity 배율은 전 행성 동일(= 카르곤 기본값 =
  // DEFAULT_DROP_ODDS). 심층 사다리(0.27/0.04/0.18)는 폐기 — 종류(특산 설계도·광물)만 행성별.
  dropTable: {
    eliteRareBase: 0.25,
    eliteUniqueBase: 0.004,
    bossUniqueBase: 0.02,
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
  // ADR-0021 배정: 니플헤임 = chase(3) 추격·탈출(유령 기함·서리 안개).
  mode: PLANET_MODE.chase,
  roster: NIFLHEIM_ROSTER,
  elites: NIFLHEIM_ELITES,
  cardPool: NIFLHEIM_CARD_POOL,
  boss: NIFLHEIM_FLAGSHIP,
  // 품질(단계)⟂종류(행성) 직교(ADR-0022): rarity 배율은 전 행성 동일(= 카르곤 기본값).
  // 심층 사다리(0.28/0.05/0.20)는 폐기 — 종류(특산 설계도·광물)만 행성별.
  dropTable: {
    eliteRareBase: 0.25,
    eliteUniqueBase: 0.004,
    bossUniqueBase: 0.02,
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
  // ADR-0021 배정: 아르케 = racing(2) 레이싱(기계 정밀·속도).
  mode: PLANET_MODE.racing,
  roster: ARKE_ROSTER,
  elites: ARKE_ELITES,
  cardPool: ARKE_CARD_POOL,
  boss: ARKE_OBELISK,
  // 품질(단계)⟂종류(행성) 직교(ADR-0022): rarity 배율은 전 행성 동일(= 카르곤 기본값).
  // 심층 사다리(0.30/0.06/0.22)는 폐기 — 종류(특산 설계도·광물)만 행성별.
  dropTable: {
    eliteRareBase: 0.25,
    eliteUniqueBase: 0.004,
    bossUniqueBase: 0.02,
    blueprintTableSize: planetBlueprintTableSize(3),
    blueprintChanceCp: [0, 0, 800, 2600],
  },
  minerals: [
    { id: 'arke-ancient-core', name: '고대 코어' },
    { id: 'arke-relic-plating', name: '유물 장갑판' },
  ],
};

/** 톡사르(4) — Lane9 오염·부식 행성. 산성 장판·지속 피해·부패의 모체. */
export const TOXAR: PlanetContent = {
  index: 4,
  id: 'toxar',
  name: '톡사르',
  // ADR-0021 배정: 톡사르 = contamination(5) 오염 확산(부식·중독 잠식).
  mode: PLANET_MODE.contamination,
  roster: TOXAR_ROSTER,
  elites: TOXAR_ELITES,
  cardPool: TOXAR_CARD_POOL,
  boss: TOXAR_BLIGHT,
  // 품질(단계)⟂종류(행성) 직교(ADR-0022): rarity 배율은 전 행성 동일(= 카르곤 기본값).
  // 종류(특산 설계도·광물)만 행성별. blueprintChanceCp 는 플레이스홀더(// TODO(밸런스)).
  dropTable: {
    eliteRareBase: 0.25,
    eliteUniqueBase: 0.004,
    bossUniqueBase: 0.02,
    blueprintTableSize: planetBlueprintTableSize(4),
    blueprintChanceCp: [0, 0, 600, 2200], // TODO(밸런스)
  },
  minerals: [
    { id: 'toxar-blightspore', name: '역병 포자' },
    { id: 'toxar-acid-resin', name: '산성 수지' },
  ],
};

/** 크라스(5) — Lane9 파괴·관통 행성. 중장 돌격·고관통 포격·공성 콜로서스. */
export const KRAS: PlanetContent = {
  index: 5,
  id: 'kras',
  name: '크라스',
  // ADR-0021 배정: 크라스 = blockBreak(1) 블록격파(파괴·관통).
  mode: PLANET_MODE.blockBreak,
  roster: KRAS_ROSTER,
  elites: KRAS_ELITES,
  cardPool: KRAS_CARD_POOL,
  boss: KRAS_COLOSSUS,
  // 품질(단계)⟂종류(행성) 직교(ADR-0022): rarity 배율은 전 행성 동일(= 카르곤 기본값).
  // 종류(특산 설계도·광물)만 행성별. blueprintChanceCp 는 플레이스홀더(// TODO(밸런스)).
  dropTable: {
    eliteRareBase: 0.25,
    eliteUniqueBase: 0.004,
    bossUniqueBase: 0.02,
    blueprintTableSize: planetBlueprintTableSize(5),
    blueprintChanceCp: [0, 0, 700, 2400], // TODO(밸런스)
  },
  minerals: [
    { id: 'kras-breachsteel', name: '돌파 강철' },
    { id: 'kras-ruin-slag', name: '파멸 슬래그' },
  ],
};

/** 행성 레지스트리(index 순). 새 행성은 여기에 append. */
export const PLANETS: readonly PlanetContent[] = [KARGON, BERDAN, NIFLHEIM, ARKE, TOXAR, KRAS];

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
  /** 엘리트 유래 표식(ADR-0038). 미지정 = 보스 확정 드랍 → 수량 배율 보정 대상 아님. */
  readonly elite?: 1;
}

/**
 * 런이 수거한 장비 드랍 목록 → 동반 설계도 목록(순수). **클리어한 런만** 설계도를 낸다.
 *
 * 정산이 `LootRecord` 를 장비로 확정하는 것과 **같은 입력**에서 파생한다 — 설계도용 추가
 * RNG 소비도 없다(그래서 해시·fixture 가 그대로다). 판정은 드랍이 난 행성의 특산 테이블로
 * 하므로 "이 방어체는 이 행성" 규칙이 자동으로 지켜진다.
 *
 * ## 2026-08-08 재조정 — 런 단위 3% 게이트 (사용자 지시)
 * 구 모델은 레코드마다 등급별 cp 를 굴려 런당 **0~N개**를 냈고, "런당 획득 확률"은 어디에도
 * 적혀 있지 않은 창발값이었다(재구성치 약 7%~14%). 지금은 두 축으로 쪼갠다:
 *   - **총량** — `rollRunBlueprint` 의 게이트 1회. `BLUEPRINT_RUN_CHANCE_CP`(=3%) 하나가
 *     드랍 건수·단계·행성 배율과 무관하게 런당 확률을 정한다. 결과는 **0개 아니면 1개**.
 *   - **분포** — 게이트를 통과했을 때 후보를 등급별 cp 로 가중 추첨한다. rare:unique 비중과
 *     행성별 편차(카르곤 5/20 … 아르케 8/26)가 종전 그대로 보존된다.
 *
 * ## 클리어 게이트
 * `victory` 가 아니면 즉시 빈 목록이다. 예전에는 패배·중도 이탈 런도 수거한 드랍만 있으면
 * 설계도가 나왔다 — "클리어할 때만 먹는다"가 지시의 첫 줄이고, 여기가 그 유일한 관문이다.
 * (의뢰서 쪽 대응 관문은 서버 `issue_commission_for_run` 의 `victory and bossKilled` 다.)
 *
 * ## ⚠️ `planetMult` 역수 보정을 **걷어냈다**
 * ADR-0038 의 보정은 "수량 배율이 엘리트 드랍 **건수**를 ×m 으로 바꾸면 설계도 기대 획득량도
 * ×m 이 된다"는 문제를 풀기 위한 것이었다. 런 단위 게이트는 건수와 획득률을 **구조적으로
 * 분리**하므로 그 문제가 존재하지 않는다 — 드랍이 2건이든 20건이든 런당 3% 다. 보정을 남기면
 * 이제는 기대 획득률이 아니라 **엘리트 대 보스의 추첨 비중만** 근거 없이 틀어놓는다. 그래서
 * 지운다. ADR-0038 이 지키려던 불변("특산 설계도 기대 획득률은 배율 밖")은 보정이 아니라
 * 게이트가 더 강하게 지킨다(근사가 아니라 항등).
 */
export function blueprintDropsFromLoot(
  loot: readonly LootLike[],
  planetMult = 1,
  victory = false,
): BlueprintGrant[] {
  void planetMult; // ADR-0038 역수 보정 철거 잔여 — 호출부 시그니처는 유지한다(위 주석).
  if (!victory) return [];

  // 후보 구성 — 순회 순서가 해시 계약이라 `loot` 순서를 그대로 유지한다.
  const cands: BlueprintCandidate[] = loot.map((rec) => {
    const base = planetContent(rec.planet).dropTable;
    const table = base.blueprintChanceCp ?? DEFAULT_BLUEPRINT_CHANCE_CP;
    return {
      seed: rec.seed,
      weightCp: table[rec.rarity] ?? 0,
      tableSize: base.blueprintTableSize ?? 0,
    };
  });

  const hit = rollRunBlueprint(cands);
  if (hit === null) return [];
  const rec = loot[hit.pick];
  if (rec === undefined) return [];
  const grant = resolvePlanetBlueprintDrop(rec.planet, hit.code);
  return grant === null ? [] : mergeBlueprintGrants([grant]);
}
