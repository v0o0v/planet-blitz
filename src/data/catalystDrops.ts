/**
 * 촉매 드랍 파생 — 런 정산 입력 (ADR-0029, Lane 4).
 *
 * "1단계 런에서 촉매가 드랍돼 바로 다음 런에 주입" 경로의 정본이다. 런이 수거한 장비 드랍
 * 목록에서 **동반 촉매**를 파생한다 — `data/planets/index.ts` 의 `blueprintDropsFromLoot`
 * (설계도 드랍)와 **완전히 같은 철학**이다.
 *
 * ## 왜 RNG·해시를 건드리지 않는가 (순수성 계약 — 결정론 동결)
 * sim 의 `dropRng` 에서 한 번이라도 더 뽑으면 드랍 스트림 전체가 밀려 **모든 fixture·해시가
 * 갈린다**. 그래서 이미 뽑아 둔 **장비 드랍 시드**(이미 `hashWorld` 에 접혀 있다)를 정수 해시
 * (`mix32`, murmur3 finalizer — `src/sim/drops.ts` 와 같은 방식)로 되풀어 쓴다. 새 결정론 입력이
 * 0 이므로 `hashWorld` 도 `LootRecord` 스키마도 한 바이트 변하지 않는다. 순수 함수(= 서버가
 * 필요하면 재확정 가능)이고, 촉매 무주입/무드랍 런은 이 파생이 빈 배열이라 완전 무영향이다.
 *
 * ## 촉매 드랍률 보상축(`catalystDrop`)
 * 런에 주입된 촉매의 `catalystDrop` 보상 배율(≥1)이 **드랍 게이트 확률을 스케일**한다 — 촉매를
 * 더 부을수록 촉매가 더 자주 나온다(자기 강화 루프). 배율 1(무주입)이면 base 확률 그대로다.
 *
 * ## 어떤 촉매가 나오는가 (풀)
 * 드랍 풀 = **공용 촉매 전체**(전 행성 드랍) + **그 런 행성의 특산 촉매**(출신 행성 런에서만).
 * 각 촉매의 `dropWeight` 만큼 펼친 배열에서 뽑으므로(정수 가중, 부동소수 없음) 무등급 희소성이
 * 자연히 반영된다(파워·보스 특산은 가중치가 낮아 드물다).
 *
 * ## 밸런스
 * 드랍률 상수(`BASE_DROP_CHANCE_CP`·`MAX_DROP_CHANCE_CP`)는 **출시 전 일괄 튜닝 패스
 * (2026-07-27, ADR-0035)에서 확정**했다. 촉매 축이 장비 축에 종속돼 있어(게이트를 장비 드랍
 * 시드마다 굴린다) 장비 수량을 고정하는 같은 패스에서 함께 조정해야 했다 — 상수 주석의 도출 참조.
 *
 * 데이터/파생 전용 모듈 — sim·render·ui 를 import 하지 않는다(catalysts.ts 만 참조).
 */

import { CATALYSTS, catalystRewardMult } from './catalysts.js';

/** 촉매 드랍 1건(정산·서버 적립 입력). 같은 id 는 `catalystDropsFromRun` 이 qty 로 합친다. */
export interface CatalystDrop {
  /** 촉매 id(catalysts.ts 안정 id). */
  readonly id: number;
  /** 드랍 수량(≥1). */
  readonly qty: number;
}

/** {@link catalystDropsFromRun} 입력 — `LootRecord` 의 부분집합(sim 타입 의존 없음). */
export interface CatalystLootLike {
  /** 이미 확정된 장비 드랍 시드(이 값을 되풀어 촉매 드랍을 파생한다 — RNG 미소비). */
  readonly seed: number;
}

/** {@link catalystDropsFromRun} 입력 묶음. */
export interface CatalystDropInput {
  /** 런이 수거한 장비 드랍 목록(시드만 쓴다). */
  readonly loot: readonly CatalystLootLike[];
  /** 런이 벌어진 행성 index(0..5) — 특산 촉매 풀 결정. */
  readonly planet: number;
  /** 런에 주입된 촉매 배열 — `catalystDrop` 보상 배율(드랍 게이트 스케일) 산정. */
  readonly catalysts: readonly number[];
}

// --- 밸런스 상수 (출시 전 일괄 튜닝 패스 2026-07-27 에서 확정 — ADR-0035) -----------
//
// ⚠️ 촉매 축은 장비 축에 **종속**돼 있다. 이 게이트는 수거한 장비 드랍 **시드마다** 굴리므로
// `기대 촉매/런 ≈ 장비 드랍 수 × BASE_DROP_CHANCE_CP / 10000` 이다. ADR-0035 가 런당 장비를
// 약 15개(단계11+ 완주)에서 **2~3개**로 줄였으므로, 구 400(4%)을 그대로 두면 기대 촉매가
// 0.6 → 0.1 개가 되어 촉매 획득 경로가 사실상 사라진다. 그래서 두 축을 같은 패스에서 맞춘다.

/**
 * 장비 드랍 1건당 촉매 동반 base 확률(만분율). 6000 = 60%.
 *
 * 도출: `목표 촉매/런(1.5) / 목표 장비/런(2.5) × 10000 = 6000`
 * (ADR-0035 §전리품 수량 — 인벤 유입 3~5 = 장비 2~3 + 촉매 1~2 + 설계도 희소).
 */
const BASE_DROP_CHANCE_CP = 6000;
/**
 * 촉매 드랍 게이트 확률 상한(만분율) — `catalystDrop` 배율이 아무리 커도 이 위로는 안 간다.
 *
 * base 가 6000 이라 구 상한 8000 이면 배율 헤드룸이 1.33배뿐이라 촉매 자기 강화 루프가 죽는다
 * (`catalystDrop` 축 최대 배율은 SLOT_CAP 8스택 = ×2.2). 9500 으로 올려 헤드룸 1.58배를 남긴다
 * — 상한을 두는 목적(확정 드랍 방지)은 유지된다.
 */
const MAX_DROP_CHANCE_CP = 9500;

// --- 순수 정수 해시 (murmur3 finalizer — src/sim/drops.ts 와 같은 방식, 부동소수 없음) ---

/** 판정 축별 salt — 게이트/인덱스가 같은 시드에서 독립적으로 갈리게 한다(드랍 축과도 독립). */
const SALT_CAT_GATE = 0x632be5ab;
const SALT_CAT_INDEX = 0xb55a4f09;

/** 정수 해시(murmur3 finalizer). 순수·결정론 — 부동소수 누적 없음. */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 행성 index → 드랍 풀(가중치 펼친 catalyst id 배열, 순수). 공용 전체 + 그 행성 특산.
 * `dropWeight` 만큼 id 를 반복해 담아, 균등 인덱스 추첨이 곧 가중 추첨이 되게 한다.
 */
export function catalystDropPool(planet: number): number[] {
  const pool: number[] = [];
  for (const def of CATALYSTS) {
    const eligible: boolean = def.kind === 'common' || def.planet === planet;
    if (!eligible) continue;
    const w = Math.max(0, Math.floor(def.dropWeight));
    for (let i = 0; i < w; i++) pool.push(def.id);
  }
  return pool;
}

/**
 * 런의 장비 드랍 목록 → 동반 촉매 드랍 목록(순수, RNG·해시 무영향).
 *
 * 각 장비 드랍 시드마다 촉매 게이트를 굴리고(catalystDrop 배율로 스케일된 확률), 통과하면 그 런
 * 행성의 드랍 풀에서 가중 추첨으로 촉매 1개를 뽑는다. 같은 id 는 qty 로 합쳐 서버 적립 호출 수를
 * 줄인다(`grant_catalyst` 는 upsert 로 합산하지만 클라 호출도 줄이는 게 낫다).
 */
export function catalystDropsFromRun(input: CatalystDropInput): CatalystDrop[] {
  const pool = catalystDropPool(input.planet);
  if (pool.length === 0 || input.loot.length === 0) return [];

  // catalystDrop 보상 배율(≥1)로 base 확률을 스케일한 뒤 상한 클램프. 무주입이면 배율 1 → base.
  const mult = catalystRewardMult(input.catalysts, 'catalystDrop');
  const chanceCp = Math.min(MAX_DROP_CHANCE_CP, Math.round(BASE_DROP_CHANCE_CP * mult));
  if (chanceCp <= 0) return [];

  const counts = new Map<number, number>();
  for (const rec of input.loot) {
    const seed = rec.seed >>> 0;
    if (mix32(seed, SALT_CAT_GATE) % 10000 >= chanceCp) continue;
    const idx = mix32(seed, SALT_CAT_INDEX) % pool.length;
    const id = pool[idx];
    if (id === undefined) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const out: CatalystDrop[] = [];
  for (const [id, qty] of counts) out.push({ id, qty });
  // id 오름차순으로 안정 정렬(표시·테스트 결정성).
  out.sort((a, b) => a.id - b.id);
  return out;
}
