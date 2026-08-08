/**
 * 행성별 설계도 분배 규칙 검증 (미결 #6 확정 — M7c-content · C6-planet-distribution).
 *
 * `tests/blueprintDrops.test.ts` 가 **지금 표가 맞는지**를 본다면, 이 파일은 **규칙이 맞는지**를
 * 본다 — 다음 마일스톤이 카탈로그에 방어체를 append 했을 때 표를 손으로 갱신하지 않아도
 * 분배가 성립하는가. 그래서 검증 대상은 고정 표가 아니라 {@link derivePlanetBlueprints} 다.
 *
 * 못 박는 것:
 *   ① 드랍 결정론 — 같은 시드 → 같은 설계도(직렬화 바이트 동일).
 *   ② 분배가 규칙과 일치 — 카탈로그 배열에서 파생해 대조(하드코딩 표 금지).
 *   ③ 4행성 각각이 고유 항목을 최소 1개 갖는다(파밍 동기).
 *   ④ 가상 append 확장성 — 카탈로그가 늘어도 규칙이 자동으로 메운다.
 *   ⑤ 레이어 경계 — sim 의 드랍 모듈이 방어체 카탈로그를 모른다.
 *   ⑥ **정규 경로 통합** — createWorld → stepWorld 실런의 `state.loot` 이 실제로 설계도로
 *      풀리는가. 모듈 직접 호출만으로는 "배선이 통째로 없는" 결함이 잡히지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PLANETS,
  PLANET_BLUEPRINTS,
  PLANET_BLUEPRINT_DROP_TABLES,
  planetBlueprintTableSize,
  resolvePlanetBlueprintDrop,
  derivePlanetBlueprints,
  blueprintDropsFromLoot,
  AUTO_BLUEPRINT_WEIGHT,
  AUTO_BLUEPRINT_WEIGHT_BOSS,
  BOSS_BLUEPRINT_PLANET,
  type LootLike,
} from '../data/planets/index.js';
import { PLANET_BLUEPRINT_SPECIALTIES, type BlueprintSpecialty } from '../data/planets/blueprints.js';
import { CATALOG_BOSS, CATALOG_KIND_COUNTS, catalogEntry } from '../data/invasion/catalog.js';
import { rollBlueprintDrop, RARITY_RARE, RARITY_UNIQUE } from '../src/sim/drops.js';
import { createWorld, stepWorld, emptyInput, packPowerupPick, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import {
  GARRISON_FORMATION_CATALOG_ID,
  GARRISON_FACILITY_CATALOG_ID,
} from '../data/invasion/garrison.js';
import { CATALOG_FORMATION, CATALOG_FACILITY } from '../data/invasion/catalog.js';

/**
 * 보스 설계도가 쌓이는 **고정 보스 행성** index(규칙 4 — Lane9 완화). 6행성 parallel-planet
 * 모델(ADR-0021)에선 "최심"이 무의미하므로 `PLANETS.length-1`(=크라스)이 아니라 정본 상수
 * `BOSS_BLUEPRINT_PLANET`(=아르케 3)을 오라클로 쓴다. 프로덕션 코드와 같은 상수를 참조해야
 * 하드코딩 3 이 테스트·코드 두 곳에 흩어져 갈리지 않는다.
 */
const BOSS_PLANET = BOSS_BLUEPRINT_PLANET;

const key = (e: { kind: number; catalogId: number }) => `${e.kind}:${e.catalogId}`;

/** 카탈로그(맵 kind 제외)의 방어체 전량을 배열에서 파생한다 — 하드코딩 표를 쓰지 않는다. */
function catalogDefenseKeys(counts: readonly number[] = CATALOG_KIND_COUNTS): string[] {
  const out: string[] = [];
  for (let kind = 0; kind <= CATALOG_BOSS; kind++) {
    for (let id = 0; id < (counts[kind] ?? 0); id++) out.push(`${kind}:${id}`);
  }
  return out;
}

/** 행성 → 공급 목록(kind:catalogId) 집합. */
function supplySets(tables: readonly (readonly BlueprintSpecialty[])[]): Set<string>[] {
  return tables.map((list) => new Set(list.map(key)));
}

// ---------------------------------------------------------------------------
// ① 드랍 결정론
// ---------------------------------------------------------------------------

describe('① 설계도 드랍 결정론', () => {
  it('같은 시드 목록 → 직렬화 바이트가 동일하다', () => {
    // ⚠️ 런 단위 3% 게이트(2026-08-08) 이후 **한 런은 대개 빈 목록**이다. 그래서 "비지 않음"은
    //    런을 여러 번 돌려서 재고, 결정론은 각 런에서 바이트 대조로 잰다. 옛 방식(레코드 500개를
    //    한 런에 밀어 넣기)은 게이트를 한 번만 통과하므로 표본이 되지 않는다.
    let nonEmpty = 0;
    for (let run = 0; run < 400; run++) {
      const loot: LootLike[] = [];
      for (let i = 1; i <= 5; i++) {
        const seed = (run * 0x9e3779b1 + i * 0x85ebca6b) >>> 0;
        loot.push({
          seed,
          rarity: i % 2 === 0 ? RARITY_RARE : RARITY_UNIQUE,
          planet: i % PLANETS.length,
        });
      }
      const a = JSON.stringify(blueprintDropsFromLoot(loot, true));
      const b = JSON.stringify(blueprintDropsFromLoot(loot, true));
      expect(b).toBe(a);
      if (a.length > 2) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThan(0);
  });

  it('규칙 파생 자체가 순수하다(두 번 돌려도 같은 표)', () => {
    const a = derivePlanetBlueprints(PLANET_BLUEPRINT_SPECIALTIES);
    const b = derivePlanetBlueprints(PLANET_BLUEPRINT_SPECIALTIES);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(a)).toBe(JSON.stringify(PLANET_BLUEPRINTS));
  });
});

// ---------------------------------------------------------------------------
// ② 분배가 규칙과 일치 (카탈로그 배열 파생)
// ---------------------------------------------------------------------------

describe('② 행성별 분배 규칙', () => {
  it('카탈로그 방어체 전량이 정확히 한 행성에서만 나온다(규칙 3)', () => {
    const sets = supplySets(PLANET_BLUEPRINTS);
    for (const k of catalogDefenseKeys()) {
      const where = sets.flatMap((s, i) => (s.has(k) ? [i] : []));
      expect(where, `미배정 카탈로그 ${k}`).toHaveLength(1);
    }
  });

  it('카탈로그에 없는 항목이 실려 있지 않다', () => {
    for (const list of PLANET_BLUEPRINTS) {
      for (const e of list) {
        expect(catalogEntry(e.kind, e.catalogId), `미등록 ${key(e)}`).toBeDefined();
        expect(Number.isInteger(e.weight) && e.weight > 0).toBe(true);
      }
    }
  });

  it('보스 설계도는 최심 행성에서만 나오고 가중치가 가장 낮다(규칙 4)', () => {
    PLANET_BLUEPRINTS.forEach((list, planet) => {
      for (const e of list) if (e.kind === CATALOG_BOSS) expect(planet).toBe(BOSS_PLANET);
    });
    const deep = PLANET_BLUEPRINTS[BOSS_PLANET]!;
    const bosses = deep.filter((e) => e.kind === CATALOG_BOSS);
    expect(bosses.length).toBeGreaterThan(0);
    const minWeight = Math.min(...deep.map((e) => e.weight));
    for (const b of bosses) expect(b.weight).toBe(minWeight);
  });

  it('행성별 항목 수가 ±1 이내다(규칙 5 — 파밍 가치 쏠림 방지)', () => {
    const sizes = PLANET_BLUEPRINTS.map((l) => l.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('명시 배정이 접두로 그대로 보존된다(규칙 6 — append-only)', () => {
    PLANET_BLUEPRINT_SPECIALTIES.forEach((explicit, planet) => {
      const merged = PLANET_BLUEPRINTS[planet]!;
      expect(merged.length).toBeGreaterThanOrEqual(explicit.length);
      expect(JSON.stringify(merged.slice(0, explicit.length))).toBe(JSON.stringify(explicit));
    });
  });

  it('펼친 테이블 길이 = 가중치 합 = dropTable.blueprintTableSize(배선 확인)', () => {
    PLANET_BLUEPRINTS.forEach((list, planet) => {
      const sum = list.reduce((n, e) => n + e.weight, 0);
      expect(PLANET_BLUEPRINT_DROP_TABLES[planet]!.length).toBe(sum);
      expect(planetBlueprintTableSize(planet)).toBe(sum);
      expect(PLANETS[planet]!.dropTable.blueprintTableSize).toBe(sum);
    });
  });

  it('드랍 확정이 그 행성 공급 목록 밖으로 새지 않는다', () => {
    PLANETS.forEach((planet, index) => {
      const allowed = supplySets(PLANET_BLUEPRINTS)[index]!;
      for (let seed = 1; seed < 800; seed++) {
        const code = rollBlueprintDrop({ seed, rarityCode: RARITY_RARE }, planet.dropTable);
        if (code === null) continue;
        const grant = resolvePlanetBlueprintDrop(index, code)!;
        expect(allowed.has(key(grant))).toBe(true);
        expect(grant.count).toBe(1);
      }
    });
  });

  it('기본 수비대 방어체도 어느 행성에선가 실제로 얻을 수 있다(막다른 길 방지)', () => {
    const sets = supplySets(PLANET_BLUEPRINTS);
    const garrison = [
      `${CATALOG_FORMATION}:${GARRISON_FORMATION_CATALOG_ID}`,
      `${CATALOG_FACILITY}:${GARRISON_FACILITY_CATALOG_ID}`,
    ];
    for (const k of garrison) expect(sets.some((s) => s.has(k)), `공급원 없음 ${k}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ③ 행성마다 고유 항목
// ---------------------------------------------------------------------------

describe('③ 행성마다 고유 획득물', () => {
  it('각 행성이 다른 어느 행성에서도 못 얻는 항목을 최소 1개 갖는다', () => {
    const sets = supplySets(PLANET_BLUEPRINTS);
    sets.forEach((mine, i) => {
      const others = sets.filter((_, j) => j !== i);
      const exclusive = [...mine].filter((k) => !others.some((s) => s.has(k)));
      expect(exclusive.length, `행성 ${i} 고유 항목 없음`).toBeGreaterThanOrEqual(1);
    });
  });

  it('실제 드랍으로도 행성별 결과 집합이 서로 다르다', () => {
    const rolled = PLANETS.map((planet, index) => {
      const got = new Set<string>();
      for (let seed = 1; seed < 3000; seed++) {
        const code = rollBlueprintDrop({ seed, rarityCode: RARITY_UNIQUE }, planet.dropTable);
        if (code === null) continue;
        const grant = resolvePlanetBlueprintDrop(index, code);
        if (grant !== null) got.add(key(grant));
      }
      return got;
    });
    rolled.forEach((mine, i) => {
      expect(mine.size, `행성 ${i} 드랍 없음`).toBeGreaterThan(0);
      rolled.forEach((other, j) => {
        if (i === j) return;
        for (const k of mine) expect(other.has(k), `행성 ${i}·${j} 중복 공급 ${k}`).toBe(false);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// ④ 확장성 — 가상 append
// ---------------------------------------------------------------------------

describe('④ 카탈로그 확장 시 규칙 자동 파생', () => {
  /** 현행 카탈로그 뒤에 편대·설비·기물·보스를 1종씩 가상 append 한 개수표. */
  const grown = CATALOG_KIND_COUNTS.map((n, kind) => (kind <= CATALOG_BOSS ? n + 1 : n));

  it('가상 append 항목이 전부 배정된다(표를 손대지 않아도 빈 자리가 없다)', () => {
    const derived = derivePlanetBlueprints(PLANET_BLUEPRINT_SPECIALTIES, grown);
    const sets = supplySets(derived);
    for (const k of catalogDefenseKeys(grown)) {
      const where = sets.flatMap((s, i) => (s.has(k) ? [i] : []));
      expect(where, `미배정 ${k}`).toHaveLength(1);
    }
  });

  it('가상 append 후에도 규칙 4·5·6 이 유지된다', () => {
    const derived = derivePlanetBlueprints(PLANET_BLUEPRINT_SPECIALTIES, grown);
    // 규칙 6 — 기존 명시 배정은 접두 그대로.
    PLANET_BLUEPRINT_SPECIALTIES.forEach((explicit, planet) => {
      expect(JSON.stringify(derived[planet]!.slice(0, explicit.length))).toBe(JSON.stringify(explicit));
    });
    // 규칙 4 — 신규 보스도 최심 행성 · 최저 가중치.
    derived.forEach((list, planet) => {
      for (const e of list) if (e.kind === CATALOG_BOSS) expect(planet).toBe(BOSS_PLANET);
    });
    const newBoss = derived[BOSS_PLANET]!.find((e) => e.kind === CATALOG_BOSS && e.catalogId === CATALOG_KIND_COUNTS[CATALOG_BOSS])!;
    expect(newBoss.weight).toBe(AUTO_BLUEPRINT_WEIGHT_BOSS);
    // 규칙 5 재정의(Lane9 — boss=BOSS_PLANET 고정의 논리적 귀결).
    // 보스는 천장 재료라 BOSS_PLANET 한 곳에만 쌓인다. 6행성이면 6-사이즈 행성이 여럿 남아
    // 가상 보스가 BOSS_PLANET 의 '총' 사이즈를 스프레드 2 로 올린다(보스 적재분 때문). 균등의
    // 실제 대상인 '비보스 적재'를 두 축으로 갈라 단언한다:
    //   (a) BOSS_PLANET 을 제외한 행성들의 총 사이즈가 ±1(순수 파밍 분배가 균등하다).
    //   (b) BOSS_PLANET 의 비보스 적재도 다른 행성 이하다(보스 외 추가 쏠림이 없다).
    const sizes = derived.map((l) => l.length);
    const nonBossPlanetSizes = sizes.filter((_, p) => p !== BOSS_PLANET);
    expect(Math.max(...nonBossPlanetSizes) - Math.min(...nonBossPlanetSizes)).toBeLessThanOrEqual(1);
    const bossPlanetNonBoss = derived[BOSS_PLANET]!.filter((e) => e.kind !== CATALOG_BOSS).length;
    expect(bossPlanetNonBoss).toBeLessThanOrEqual(Math.max(...nonBossPlanetSizes));
    // 신규 비보스는 자동 가중치.
    const autoAdded = derived.flatMap((l, p) => l.slice(PLANET_BLUEPRINT_SPECIALTIES[p]!.length));
    for (const e of autoAdded) {
      expect(e.weight).toBe(e.kind === CATALOG_BOSS ? AUTO_BLUEPRINT_WEIGHT_BOSS : AUTO_BLUEPRINT_WEIGHT);
    }
    expect(autoAdded.length).toBe(4);
  });

  it('명시 배정이 통째로 비어도 규칙만으로 전량이 배분된다(최악 케이스)', () => {
    const empty = PLANETS.map(() => [] as BlueprintSpecialty[]);
    const derived = derivePlanetBlueprints(empty, CATALOG_KIND_COUNTS);
    const sets = supplySets(derived);
    for (const k of catalogDefenseKeys()) {
      expect(sets.flatMap((s, i) => (s.has(k) ? [i] : [])), `미배정 ${k}`).toHaveLength(1);
    }
    const sizes = derived.map((l) => l.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    derived.forEach((list, planet) => {
      for (const e of list) if (e.kind === CATALOG_BOSS) expect(planet).toBe(BOSS_PLANET);
    });
  });

  it('행성이 0개면 빈 결과(방어적 — 던지지 않는다)', () => {
    expect(derivePlanetBlueprints([], CATALOG_KIND_COUNTS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 레이어 경계 — sim 은 카탈로그를 모른다
// ---------------------------------------------------------------------------

describe('⑤ sim ↔ 메타 레이어 경계', () => {
  const readSrc = (rel: string) =>
    new TextDecoder().decode(readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url))));

  it('src/sim/drops.ts 가 data/ 를 import 하지 않는다', () => {
    const src = readSrc('src/sim/drops.ts');
    const imports = [...src.matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec.includes('data/'), `sim 이 데이터 레이어를 import 함: ${spec}`).toBe(false);
    }
  });

  it('sim 드랍 코드는 불투명하다 — kind·catalogId 를 내지 않는다', () => {
    const odds = PLANETS[BOSS_PLANET]!.dropTable;
    const code = rollBlueprintDrop({ seed: 12345, rarityCode: RARITY_UNIQUE }, odds);
    if (code !== null) {
      expect(Object.keys(code).sort()).toEqual(['seed', 'tableIndex']);
    }
    // 주석은 벗기고 **코드**만 본다(주석에는 경계 설명으로 catalogId 가 등장한다).
    const code2 = readSrc('src/sim/drops.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code2).not.toMatch(/catalogId|CATALOG_|kind/);
  });

  it('명시 표 전용 헬퍼가 프로덕션 배선에 남아 있지 않다(두 갈래 진실 방지)', () => {
    // 크기·확정은 index.ts 의 파생본(planetBlueprintTableSize / resolvePlanetBlueprintDrop)만
    // 쓴다. blueprints.ts 의 명시 전용 헬퍼를 누가 다시 부르면 자동 파생분이 누락된다.
    const idx = readSrc('data/planets/index.ts');
    expect(idx).not.toMatch(/\bblueprintTableSize\(/);
    expect(idx).not.toMatch(/[^t]resolveBlueprintDrop\(/);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 정규 경로 통합 — 실런에서 실제로 배선돼 있는가
// ---------------------------------------------------------------------------

/** 실제 런을 돌려 바닥 드랍을 수거한다(정규 경로 — 모듈 직접 호출이 아니다). */
function runForLoot(seed: number, planet: number) {
  const config: WorldConfig = { ...DEFAULT_CONFIG, planet, playerHp: 100_000_000 };
  const state = createWorld(seed, config);
  for (let t = 0; t < 60 * 400; t++) {
    const frame = state.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : emptyInput();
    stepWorld(state, frame);
    if (state.gameOver || state.victory) break;
    if (state.loot.length >= 12) break;
  }
  return state;
}

describe('⑥ 정규 경로 통합(createWorld → stepWorld → 정산 입력)', () => {
  it('실런의 loot 이 그 행성 특산 설계도로 풀린다', () => {
    // ⚠️ 증인 시드 재선정 2026-07-27(0xc6d1 → 0xc6fd, 밸런스 패스 ADR-0037). 이 하네스는
    // 무입력 내구 파일럿이라 죽지는 않지만, `SEGMENTS.killGoal` 합계가 80 → 240 이 되면서
    // 24,000틱 예산 안에 **바닥 드랍을 한 건도 못 만든다**(구 증인 실측 loot 0). 즉 드랍 경로가
    // 죽은 것이 아니라 표본이 비었던 것이다. 재표본(0xc6d1..0xc798 연속 200시드): 12시드가
    // loot ≥ 1 이고 그중 **0xc6fd 는 loot 2** 로 아래 부풀리기 표본(2 × 40 = 80)까지 여유가 있다.
    const state = runForLoot(0xc6fd, BOSS_PLANET);
    expect(state.loot.length).toBeGreaterThan(0);
    for (const rec of state.loot) expect(rec.planet).toBe(BOSS_PLANET);
    const grants = blueprintDropsFromLoot(state.loot, true);
    const allowed = supplySets(PLANET_BLUEPRINTS)[BOSS_PLANET]!;
    for (const g of grants) {
      expect(allowed.has(key(g)), `행성 밖 설계도 ${key(g)}`).toBe(true);
      expect(g.count).toBeGreaterThanOrEqual(1);
    }
    // 표본이 작으면 0건일 수 있으므로 건수는 강제하지 않는다. 대신 **런을 여러 번 흉내내서**
    // 최소 1건이 실제로 나오는지 확인한다(경로가 죽어 있으면 여기서 0이 된다).
    // ⚠️ 옛 버전은 한 런의 레코드를 40배로 부풀렸다 — 런 단위 게이트에서는 그래도 확률이
    //    3% 그대로라 이 단언이 97% 확률로 실패한다. 부풀릴 축은 레코드가 아니라 **런**이다.
    let hits = 0;
    for (let run = 0; run < 600; run++) {
      const loot = state.loot.map((r) => ({
        ...r,
        seed: (r.seed + run * 0x9e3779b1) >>> 0,
        rarity: RARITY_UNIQUE,
      }));
      hits += blueprintDropsFromLoot(loot, true).length;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('같은 시드의 두 실런이 같은 설계도를 낸다(런 단위 결정론)', () => {
    const a = runForLoot(0xc6d2, 1);
    const b = runForLoot(0xc6d2, 1);
    expect(JSON.stringify(b.loot)).toBe(JSON.stringify(a.loot));
    expect(JSON.stringify(blueprintDropsFromLoot(b.loot, true))).toBe(
      JSON.stringify(blueprintDropsFromLoot(a.loot, true)),
    );
  });
});
