/**
 * 설계도 획득 경로 검증 (M7b-acquisition).
 *
 * 세 가지를 못 박는다:
 *   ① **드랍 결정론 + RNG 무소비** — 설계도 판정이 `dropRng` 를 건드리면 기존 fixture·해시가
 *      전부 갈린다. 같은 시드 → 같은 결과이면서 RNG 커서가 1도 안 움직이는지 직접 관찰한다.
 *   ② **행성별 분배**(미결 #6) — M7a 카탈로그 13종이 빠짐없이, 그리고 **정확히 한 행성**에만
 *      실려 있는지. 겹치면 "아무 데나 돌아도 나온다" 가 되어 행성 선택이 무의미해진다.
 *   ③ **정찰 정보 누출 가드**(결정 #15) — 잠금 정찰 뷰에 레벨·어픽스 시드·카탈로그 id 가
 *      단 한 곳도 실리지 않는지. 이게 뚫리면 정찰이 곧 전체 스펙 공개가 된다.
 */

import { describe, it, expect } from 'vitest';
import {
  rollBlueprintDrop,
  rollEliteDrop,
  DEFAULT_DROP_ODDS,
  DEFAULT_BLUEPRINT_CHANCE_CP,
  BLUEPRINT_RUN_CHANCE_CP,
  RARITY_MAGIC,
  RARITY_RARE,
  RARITY_UNIQUE,
} from '../src/sim/drops.js';
import { SeededRng } from '../src/sim/rng.js';
import {
  PLANETS,
  planetContent,
  blueprintDropsFromLoot,
  // M7c 통합 게이트: 분배 정본이 `blueprints.ts`(명시 배정만) → `index.ts`(명시 + 규칙 파생)로
  // 옮겨졌다. 아래 단언들은 **프로덕션이 실제로 호출하는** 파생본을 대상으로 한다 — 예전엔
  // 명시 전용 헬퍼(`resolveBlueprintDrop` 등)를 봤는데, 그건 아무도 호출하지 않는 함수라
  // 카탈로그가 늘어나는 순간 "배송되지 않는 코드를 통과시키는 테스트"가 됐다.
  PLANET_BLUEPRINTS,
  PLANET_BLUEPRINT_DROP_TABLES,
  planetBlueprintTableSize,
  resolvePlanetBlueprintDrop,
  type LootLike,
} from '../data/planets/index.js';
import {
  mergeBlueprintGrants,
  craftMineralCost,
  CRAFT_MINERAL_COST,
  CRAFT_MINERAL_COST_BOSS,
} from '../data/planets/blueprints.js';
import { CATALOG_KIND_COUNTS, CATALOG_BOSS, catalogEntry } from '../data/invasion/catalog.js';
import { normalizeInvasionLayers } from '../src/sim/invasion/normalize.js';
import { reconView, reconSlotLabel, ascensionStars, reconRarityColor } from '../src/ui/controlTower.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ARKE_INDEX = 3;

/** 배치 Ref 하나(정수 5필드). */
function ref(catalogId: number, level: number, ascension: number, rarity: number) {
  return { catalogId, level, ascension, affixSeed: 0x1234abcd, rarity };
}

// ---------------------------------------------------------------------------
// ① 드랍 결정론 · RNG 무소비
// ---------------------------------------------------------------------------

describe('설계도 드랍 판정(sim)', () => {
  it('같은 드랍이면 항상 같은 설계도 코드(순수 함수)', () => {
    const odds = planetContent(ARKE_INDEX).dropTable;
    for (let seed = 1; seed < 200; seed++) {
      const a = rollBlueprintDrop({ seed, rarityCode: RARITY_UNIQUE }, odds);
      const b = rollBlueprintDrop({ seed, rarityCode: RARITY_UNIQUE }, odds);
      expect(b).toEqual(a);
    }
  });

  it('RNG 를 한 번도 소비하지 않는다(드랍 스트림 불변 = 해시·fixture 불변)', () => {
    const rng = new SeededRng(0xfeed);
    const odds = planetContent(1).dropTable;
    // 촉매 희귀도 배율 1(무촉매) — 구 무변칙 경로와 동일 소비.
    const drop = rollEliteDrop(rng, 1, 1, odds);
    const before = rng.getState();
    for (let i = 0; i < 50; i++) rollBlueprintDrop(drop, odds);
    expect(rng.getState()).toBe(before);
  });

  it('노말·매직 드랍에는 설계도가 붙지 않는다(엘리트·보스 중심 — 기획 §4)', () => {
    const odds = planetContent(ARKE_INDEX).dropTable;
    for (let seed = 1; seed < 400; seed++) {
      expect(rollBlueprintDrop({ seed, rarityCode: 0 }, odds)).toBeNull();
      expect(rollBlueprintDrop({ seed, rarityCode: RARITY_MAGIC }, odds)).toBeNull();
    }
    expect(DEFAULT_BLUEPRINT_CHANCE_CP[0]).toBe(0);
    expect(DEFAULT_BLUEPRINT_CHANCE_CP[1]).toBe(0);
  });

  it('테이블이 없는 odds 는 항상 null(기존 DEFAULT_DROP_ODDS 하위 호환)', () => {
    for (let seed = 1; seed < 200; seed++) {
      expect(rollBlueprintDrop({ seed, rarityCode: RARITY_UNIQUE }, DEFAULT_DROP_ODDS)).toBeNull();
    }
  });

  it('tableIndex 는 항상 테이블 범위 안의 정수다', () => {
    for (const planet of PLANETS) {
      const size = planet.dropTable.blueprintTableSize ?? 0;
      for (let seed = 1; seed < 500; seed++) {
        const code = rollBlueprintDrop({ seed, rarityCode: RARITY_UNIQUE }, planet.dropTable);
        if (code === null) continue;
        expect(Number.isInteger(code.tableIndex)).toBe(true);
        expect(code.tableIndex).toBeGreaterThanOrEqual(0);
        expect(code.tableIndex).toBeLessThan(size);
        expect(Number.isInteger(code.seed)).toBe(true);
      }
    }
  });

  it('실제 발생률이 선언한 centi-percent 근처다(±3%p)', () => {
    const odds = planetContent(ARKE_INDEX).dropTable;
    const want = odds.blueprintChanceCp?.[RARITY_UNIQUE] ?? 0;
    let hit = 0;
    const N = 20000;
    for (let seed = 1; seed <= N; seed++) {
      if (rollBlueprintDrop({ seed, rarityCode: RARITY_UNIQUE }, odds) !== null) hit++;
    }
    expect(Math.abs((hit / N) * 10000 - want)).toBeLessThan(300);
  });
});

// ---------------------------------------------------------------------------
// ② 행성별 분배 (미결 #6)
// ---------------------------------------------------------------------------

describe('행성별 특산 설계도 분배', () => {
  it('행성 수만큼 목록이 있다', () => {
    expect(PLANET_BLUEPRINTS.length).toBe(PLANETS.length);
    expect(PLANET_BLUEPRINT_DROP_TABLES.length).toBe(PLANETS.length);
  });

  it('M7a 카탈로그(편대·설비·기물·보스) 전종이 정확히 한 행성에만 실려 있다', () => {
    const seen = new Map<string, number[]>();
    PLANET_BLUEPRINTS.forEach((list, planet) => {
      for (const e of list) {
        const key = `${e.kind}:${e.catalogId}`;
        seen.set(key, [...(seen.get(key) ?? []), planet]);
      }
    });
    // 카탈로그 전종 커버(맵 템플릿 kind 4 는 방어체가 아니라 대상 아님).
    for (let kind = 0; kind <= CATALOG_BOSS; kind++) {
      const count = CATALOG_KIND_COUNTS[kind] ?? 0;
      expect(count).toBeGreaterThan(0);
      for (let id = 0; id < count; id++) {
        const where = seen.get(`${kind}:${id}`);
        expect(where, `미배정 카탈로그 ${kind}:${id}`).toBeDefined();
        expect(where!.length, `중복 공급 ${kind}:${id} → ${where}`).toBe(1);
      }
    }
    // 반대로 카탈로그에 없는 항목이 실려 있으면 안 된다.
    for (const key of seen.keys()) {
      const [kind, id] = key.split(':').map(Number);
      expect(catalogEntry(kind!, id!), `미등록 카탈로그 ${key}`).toBeDefined();
    }
  });

  it('행성별 항목 수가 ±1 이내로 균등하다(파밍 가치 쏠림 방지 규칙 3)', () => {
    const sizes = PLANET_BLUEPRINTS.map((l) => l.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('보스 설계도는 최심 행성(아르케)에서만, 가중치가 가장 낮다', () => {
    PLANET_BLUEPRINTS.forEach((list, planet) => {
      for (const e of list) {
        if (e.kind === CATALOG_BOSS) expect(planet).toBe(ARKE_INDEX);
      }
    });
    const arke = PLANET_BLUEPRINTS[ARKE_INDEX]!;
    const boss = arke.find((e) => e.kind === CATALOG_BOSS)!;
    for (const e of arke) expect(boss.weight).toBeLessThanOrEqual(e.weight);
  });

  it('펼친 테이블 길이 = 가중치 합 = dropTable.blueprintTableSize', () => {
    PLANET_BLUEPRINTS.forEach((list, planet) => {
      const sum = list.reduce((n, e) => n + e.weight, 0);
      expect(PLANET_BLUEPRINT_DROP_TABLES[planet]!.length).toBe(sum);
      expect(planetBlueprintTableSize(planet)).toBe(sum);
      expect(PLANETS[planet]!.dropTable.blueprintTableSize).toBe(sum);
    });
  });

  it('resolvePlanetBlueprintDrop 이 그 행성 목록 밖의 방어체를 절대 내지 않는다', () => {
    PLANETS.forEach((planet, index) => {
      const allowed = new Set(
        PLANET_BLUEPRINTS[index]!.map((e) => `${e.kind}:${e.catalogId}`),
      );
      for (let seed = 1; seed < 800; seed++) {
        const code = rollBlueprintDrop({ seed, rarityCode: RARITY_RARE }, planet.dropTable);
        if (code === null) continue;
        const grant = resolvePlanetBlueprintDrop(index, code)!;
        expect(allowed.has(`${grant.kind}:${grant.catalogId}`)).toBe(true);
        expect(grant.count).toBe(1);
      }
    });
  });

  it('테이블 밖 인덱스·미지 행성은 조용히 null', () => {
    expect(resolvePlanetBlueprintDrop(0, { tableIndex: 9999, seed: 1 })).toBeNull();
    expect(resolvePlanetBlueprintDrop(99, { tableIndex: 0, seed: 1 })).toBeNull();
    expect(planetBlueprintTableSize(99)).toBe(0);
  });
});

/**
 * 합성 런 N 회를 돌려 지급 목록을 모은다(런 단위 3% 게이트 이후의 표준 표본 만들기).
 *
 * ⚠️ **한 런에 레코드를 300개 밀어 넣는 옛 방식은 이제 표본이 아니다.** 게이트는 레코드가
 * 몇 건이든 런당 한 번만 굴리므로, 레코드를 늘려도 기대 건수는 0.03 에서 꿈쩍 안 하고
 * 분포만 바뀐다. 표본을 늘리려면 **런 수**를 늘려야 한다.
 */
function sampleRuns(
  runs: number,
  mk: (run: number) => LootLike[],
): ReturnType<typeof blueprintDropsFromLoot> {
  const out: ReturnType<typeof blueprintDropsFromLoot> = [];
  for (let run = 0; run < runs; run++) out.push(...blueprintDropsFromLoot(mk(run), true));
  return out;
}

describe('정산 입력(blueprintDropsFromLoot)', () => {
  it('행성 파밍 결과가 그 행성 특산으로만 나온다', () => {
    const grants = sampleRuns(600, (run) => [
      { seed: (run * 0x9e3779b1 + 1) >>> 0, rarity: RARITY_UNIQUE, planet: 1 },
    ]);
    expect(grants.length).toBeGreaterThan(0);
    const allowed = new Set(PLANET_BLUEPRINTS[1]!.map((e) => `${e.kind}:${e.catalogId}`));
    for (const g of grants) expect(allowed.has(`${g.kind}:${g.catalogId}`)).toBe(true);
  });

  it('클리어하지 않은 런은 설계도 0(2026-08-08 클리어 게이트)', () => {
    // 지시 첫 줄 "의뢰서와 설계도는 클리어 할때만 먹을 수 있게 한다"의 클라 측 관문.
    // ⚠️ 기본값이 false 다 — settlement.ts 가 victory 를 넘기는 배선이 지워지면 축 전체가
    //    조용히 죽는다. 그래서 "0이다"만 재는 것으로는 부족하고 아래 짝 단언이 함께 선다.
    // ⚠️ **단일 런으로 재면 안 된다.** 게이트를 지워도 그 한 런이 3% 를 못 뚫으면 통과한다
    //    (뮤테이션 실험에서 실제로 통과했다). 클리어 표본과 **같은 런 집합**을 false 로 돌려
    //    양쪽을 비교해야 "0 인 이유가 게이트"임이 증명된다.
    const mk = (run: number): LootLike[] => [
      { seed: (run * 0x9e3779b1 + 7) >>> 0, rarity: RARITY_UNIQUE, planet: 3 },
    ];
    const RUNS = 600;
    let lost = 0;
    for (let run = 0; run < RUNS; run++) lost += blueprintDropsFromLoot(mk(run), false).length;
    expect(lost).toBe(0);
    // 짝: 같은 런 집합이 클리어면 반드시 나온다 → 위 0 이 "축이 죽어서"가 아님을 증명.
    expect(sampleRuns(RUNS, mk).length).toBeGreaterThan(0);
  });

  it('런당 획득률이 약 3% 이고 드랍 건수에 불변이다', () => {
    // 새 계약의 본체. BLUEPRINT_RUN_CHANCE_CP 하나가 총량을 정하고, 레코드 수·행성·등급은
    // "어느 설계도인가"만 바꾼다. 1건짜리 런과 12건짜리 런의 획득률이 같아야 한다.
    const N = 4000;
    const rate = (mk: (run: number) => LootLike[]): number =>
      sampleRuns(N, mk).length / N;
    const thin = rate((run) => [
      { seed: (run * 0x9e3779b1 + 3) >>> 0, rarity: RARITY_UNIQUE, planet: 2 },
    ]);
    const fat = rate((run) =>
      Array.from({ length: 12 }, (_, i) => ({
        seed: (run * 0x9e3779b1 + i * 0x85ebca6b + 3) >>> 0,
        rarity: i % 2 === 0 ? RARITY_RARE : RARITY_UNIQUE,
        planet: 2,
      })),
    );
    const target = BLUEPRINT_RUN_CHANCE_CP / 10000;
    expect(thin).toBeGreaterThan(target * 0.6);
    expect(thin).toBeLessThan(target * 1.4);
    expect(fat).toBeGreaterThan(target * 0.6);
    expect(fat).toBeLessThan(target * 1.4);
  });

  it('한 런은 최대 1장이다', () => {
    // 게이트가 통과해도 추첨은 한 번뿐 — 구 모델의 "런당 0~N개"가 여기서 닫힌다.
    for (let run = 0; run < 3000; run++) {
      const loot = Array.from({ length: 8 }, (_, i) => ({
        seed: (run * 0x9e3779b1 + i * 0xc2b2ae35 + 5) >>> 0,
        rarity: RARITY_UNIQUE,
        planet: 3,
      }));
      const total = blueprintDropsFromLoot(loot, true).reduce((s, g) => s + g.count, 0);
      expect(total).toBeLessThanOrEqual(1);
    }
  });

  it('같은 설계도는 장수로 합쳐진다', () => {
    const merged = mergeBlueprintGrants([
      { kind: 0, catalogId: 2, count: 1 },
      { kind: 1, catalogId: 4, count: 1 },
      { kind: 0, catalogId: 2, count: 1 },
    ]);
    expect(merged.length).toBe(2);
    expect(merged.find((g) => g.kind === 0)!.count).toBe(2);
  });

  it('노말·매직만 있는 런은 설계도 0(잡몹 파밍으로는 못 얻는다)', () => {
    // 클리어 게이트를 열어 둔 채로 재야 한다 — false 로 재면 무엇 때문에 0 인지 안 갈린다.
    expect(
      sampleRuns(600, (run) =>
        Array.from({ length: 30 }, (_, i) => ({
          seed: (run * 0x9e3779b1 + i + 1) >>> 0,
          rarity: RARITY_MAGIC,
          planet: 3,
        })),
      ),
    ).toEqual([]);
  });

  it('같은 런 입력이면 항상 같은 지급 목록', () => {
    // ⚠️ 옛 픽스처는 고정 3레코드(시드 11·22·33)였다. 게이트 도입 후 그 시드의 fold 잔여가
    //    1836(>300) 이라 **`[]` 와 `[]` 를 비교하는 공허한 단언**이 됐고 리뷰에서 잡혔다.
    //    지금은 **히트가 실제로 나는 런을 찾아서** 그 런으로 대조한다 — 못 찾으면 실패한다.
    const mk = (run: number): LootLike[] => [
      { seed: (run * 0x9e3779b1 + 11) >>> 0, rarity: RARITY_RARE, planet: 0 },
      { seed: (run * 0x85ebca6b + 22) >>> 0, rarity: RARITY_UNIQUE, planet: 2 },
      { seed: (run * 0xc2b2ae35 + 33) >>> 0, rarity: RARITY_RARE, planet: 3 },
    ];
    let hitRun = -1;
    for (let run = 0; run < 2000 && hitRun < 0; run++) {
      if (blueprintDropsFromLoot(mk(run), true).length > 0) hitRun = run;
    }
    expect(hitRun, '2000런 안에 히트가 없다 — 게이트가 죽었거나 확률이 오타다').toBeGreaterThanOrEqual(0);
    const loot = mk(hitRun);
    const a = blueprintDropsFromLoot(loot, true);
    expect(a.length).toBeGreaterThan(0); // 비지 않음을 못 박아 공허 재발을 막는다.
    expect(blueprintDropsFromLoot(loot, true)).toEqual(a);
  });

  it('레코드 순서가 바뀌면 결과가 바뀔 수 있다(fold 순서 계약)', () => {
    // rollRunBlueprint 주석이 못박은 계약을 실제로 잰다 — 호출부가 loot 를 정렬·필터해서
    // 넘기기 시작하면 같은 런이 다른 설계도를 내고, 리플레이 대조가 조용히 갈린다.
    const mk = (n: number): LootLike[] =>
      Array.from({ length: 4 }, (_, i) => ({
        seed: (n * 0x9e3779b1 + i * 0x7f4a7c15 + 1) >>> 0,
        rarity: RARITY_UNIQUE,
        planet: 3,
      }));
    let differs = 0;
    for (let n = 0; n < 400; n++) {
      const fwd = JSON.stringify(blueprintDropsFromLoot(mk(n), true));
      const rev = JSON.stringify(blueprintDropsFromLoot([...mk(n)].reverse(), true));
      if (fwd !== rev) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });
});

describe('제작 비용', () => {
  it('보스만 비싸다', () => {
    expect(craftMineralCost(CATALOG_BOSS)).toBe(CRAFT_MINERAL_COST_BOSS);
    expect(craftMineralCost(0)).toBe(CRAFT_MINERAL_COST);
    expect(CRAFT_MINERAL_COST_BOSS).toBeGreaterThan(CRAFT_MINERAL_COST);
  });

  it('마이그레이션 SQL 이 같은 상수를 쓴다(TS↔SQL 미러 드리프트 가드)', () => {
    const url = new URL('../supabase/migrations/20260722020000_m7b_blueprint_drops.sql', import.meta.url);
    const sql = new TextDecoder().decode(readFileSync(fileURLToPath(url)));
    expect(sql).toContain(`case when p_kind = 3 then ${CRAFT_MINERAL_COST_BOSS} else ${CRAFT_MINERAL_COST} end`);
    // 약탈 확률(centi-percent)도 주석과 본문이 함께 갱신되게 묶어 둔다.
    expect(sql).toContain('v_roll >= 1200');
    // 방어자 무손실(ADR-0003): 방어자 행을 지우거나 깎는 문장이 없어야 한다.
    expect(sql).not.toMatch(/delete\s+from\s+public\.defense_units/i);
    expect(sql).not.toMatch(/update\s+public\.defenses\b/i);
  });
});

// ---------------------------------------------------------------------------
// ③ 정찰 정보 누출 가드 (결정 #15)
// ---------------------------------------------------------------------------

/** 정찰 검증용 배치 — 슬롯마다 다른 레벨·어픽스 시드를 넣어 누출을 눈에 띄게 한다. */
function sampleLayers() {
  return normalizeInvasionLayers({
    l1: { waveSlots: [ref(2, 47, 3, 3), null, ref(0, 12, 0, 1), null, null, null] },
    l2: { templateId: 0, sockets: [ref(4, 88, 5, 2), null, ref(1, 31, 1, 0)] },
    l3: {
      boss: ref(0, 63, 2, 3),
      props: [ref(2, 25, 4, 2), null, null, null, null, null],
      guardians: [],
      core: { hp: 8000, x: 0, y: 0 },
      modules: [],
    },
  });
}

/** 객체 트리 전체의 키 이름을 모은다(중첩 배열 포함). */
function allKeys(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) {
    for (const e of v) allKeys(e, out);
  } else if (v !== null && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      out.add(k);
      allKeys(val, out);
    }
  }
  return out;
}

describe('3레이어 정찰 뷰(정보 공개 범위)', () => {
  it('잠금 상태에 정확 스펙 필드가 단 하나도 없다', () => {
    const view = reconView(sampleLayers(), false);
    const keys = allKeys(view.strips);
    for (const leak of ['level', 'affixSeed', 'catalogId', 'rarityName', 'hp', 'x', 'y']) {
      expect(keys.has(leak), `정찰 누출: ${leak}`).toBe(false);
    }
    expect([...keys].sort()).toEqual(['ascension', 'kind', 'layer', 'nameKey', 'occupied', 'rarity', 'slots']);
  });

  it('잠금 상태에서는 종류 이름이 열리지 않는다(실루엣만)', () => {
    const view = reconView(sampleLayers(), false);
    expect(view.revealed).toBe(false);
    for (const strip of view.strips) {
      for (const slot of strip.slots) {
        expect(slot.nameKey).toBeNull();
        if (slot.occupied) expect(reconSlotLabel(slot)).toBe('?');
      }
    }
  });

  it('1회 침공 후에는 종류 이름만 열리고 정확 스펙은 여전히 없다', () => {
    const view = reconView(sampleLayers(), true);
    expect(view.revealed).toBe(true);
    const named = view.strips.flatMap((s) => s.slots).filter((s) => s.nameKey !== null);
    expect(named.length).toBeGreaterThan(0);
    for (const slot of named) expect(slot.nameKey).toMatch(/^def3\..+\.name$/);
    // 해금이어도 필드 집합은 그대로다(레벨·어픽스는 결과 화면 몫).
    expect(allKeys(view.strips).has('level')).toBe(false);
  });

  it('등급·승급은 배치 그대로 낸다(칩 색·별의 근거)', () => {
    const view = reconView(sampleLayers(), false);
    const l1 = view.strips.find((s) => s.layer === 1)!;
    expect(l1.slots.length).toBe(6);
    expect(l1.slots[0]).toEqual({ occupied: true, rarity: 3, ascension: 3, nameKey: null });
    expect(l1.slots[1]).toEqual({ occupied: false, rarity: 0, ascension: 0, nameKey: null });
  });

  it('레이어별 슬롯 수가 배치 스키마와 일치한다', () => {
    const layers = sampleLayers();
    const view = reconView(layers, false);
    const of = (layer: number, kind: number) =>
      view.strips.find((s) => s.layer === layer && s.kind === kind)!;
    expect(of(1, 0).slots.length).toBe(layers.l1.waveSlots.length);
    expect(of(2, 1).slots.length).toBe(layers.l2.sockets.length);
    expect(of(3, 2).slots.length).toBe(layers.l3.props.length);
    expect(of(3, 3).slots.length).toBe(1);
  });

  it('승급 별·등급 색이 범위를 벗어나도 안전하다', () => {
    expect(ascensionStars(0)).toBe('☆☆☆☆☆');
    expect(ascensionStars(3)).toBe('★★★☆☆');
    expect(ascensionStars(99)).toBe('★★★★★');
    expect(ascensionStars(-4)).toBe('☆☆☆☆☆');
    expect(reconRarityColor(0)).toBe(reconRarityColor(-1));
    expect(reconRarityColor(3)).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
