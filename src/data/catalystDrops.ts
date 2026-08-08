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

import { CATALYSTS, catalystById, CAP_COMPOSE_FACTOR } from './catalysts.js';

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
  /** 런에 주입된 촉매 배열 — 특산 풀·귀속 표시가 쓴다. */
  readonly catalysts: readonly number[];
  /**
   * 런 **중에** 촉매 규칙이 실제로 만들어 낸 촉매 드랍 게이트 배율(≥1). 생략하면 1.
   *
   * ⚠️ **주입 목록에서 파생하지 마라.** ADR-0052 의 촉매 드랍축 4종(`id 21` 미정착 결정 ·
   * `id 33` 즉사 보너스 · `id 38` 기함 잔해 · `id 45` 엄폐 뒤 블록)은 전부 **조건부**라, 카드를
   * 꽂았다는 사실만으로는 배율이 서지 않는다. 구 모델은 `catalystRewardMult(ids,'catalystDrop')`
   * 로 여기서 직접 파생했고 그것이 곧 무조건 배율이었다 — 헌장 §상한 근거 규율이 금지한 형태다.
   * 값은 sim 이 규칙 발동을 실제로 세어 넘긴다(배선 레인). 그전까지는 1 이다.
   */
  readonly catalystDropMult?: number;
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
 * (도출 당시 `catalystDrop` 축 최대 배율은 SLOT_CAP 8스택 = ×2.2였다). 9500 으로 올려 헤드룸
 * 1.58배를 남긴다 — 상한을 두는 목적(확정 드랍 방지)은 유지된다.
 *
 * ⚠️ ADR-0052 가 SLOT_CAP 을 3으로 내리면서 **이 상한은 더 이상 구속하지 않는다**:
 * 현행 최대 배율은 `1 + 0.15×3 = ×1.45` 라 6000×1.45 = 8700 < 9500 이다. 값을 그대로 두는 것은
 * 의도적이다 — ADR-0052 의 규칙형 카탈로그(개별 상한 ×2.6)가 배선되면 다시 구속하게 되고,
 * 그 전에 내리면 카탈로그가 오기 전에 헤드룸을 없애는 셈이 된다.
 */
const MAX_DROP_CHANCE_CP = 9500;

/**
 * 실효 배율 천장 = `MAX_DROP_CHANCE_CP / BASE_DROP_CHANCE_CP` ≈ **×1.583**.
 *
 * ⚠️ 헌장 §경제 결합 규율: *"코드가 이미 자르는 값을 상한으로 적지 마라."* 게이트 확률이
 * 9500cp 에서 잘리므로 배율을 그 위로 올려도 드랍은 한 개도 안 늘어난다. 그래서 환산이
 * **여기서 먼저 클램프**한다 — 정산이 주장하는 배율과 실제로 굴려지는 배율이 갈리지 않게
 * 하기 위해서다(화면과 실제가 조용히 갈리는 것이 이 저장소의 지배적 실패 모드다).
 *
 * 현행 카탈로그에서는 이 클램프가 **닿지 않는다**(아래 합성식 최대 = ×1.5). 그래도 두는
 * 이유는 카탈로그가 자라도 자동으로 유계가 유지되게 하기 위해서다.
 */
const EFFECTIVE_MAX_DROP_MULT = MAX_DROP_CHANCE_CP / BASE_DROP_CHANCE_CP;

/**
 * {@link catalystDropMultFromContributions} 입력 한 행 — `RunResult.catalystContributions`
 * 원소와 **같은 구조를 그 자리에 적는다**(sim 타입을 import 하지 않는다. `save/settlement.ts`
 * 가 같은 규율을 지는 것과 같은 이유 — 데이터 층이 sim 타입을 알면 경계가 사라진다).
 */
export interface CatalystContributionLike {
  /** 촉매 id. */
  readonly id: number;
  /** 발동 횟수. */
  readonly fired: number;
  /** 조건을 만족해 **번** 액수의 합. */
  readonly earned: number;
  /** 조건 미달로 **놓친** 액수의 합. */
  readonly missed: number;
}

/**
 * 촉매 드랍축 4종의 **환산표** — 귀속 원장 한 행에서 "sim 이 실제로 센 수"를 뽑는 식과,
 * 그 수가 개별 상한(`cap.mult`)에 닿는 포화점.
 *
 * ⚠️⚠️ **주입 목록에서 파생하지 않는다.** 카드를 꽂았다는 사실만으로 서는 배율이 곧 헌장
 * §상한 근거 규율이 금지한 **무조건 배율**이고, 구 모델(`catalystRewardMult(ids,'catalystDrop')`)
 * 이 정확히 그 실수를 했다(인계 §5-3). 그래서 입력은 오직 귀속 원장이다 — 카드를 꽂고
 * 조건을 한 번도 못 채우면 `count === 0` 이라 배율이 정확히 1 이다.
 *
 * ⚠️ `cap.mult` 는 여기 적지 않는다 — `src/data/catalysts.ts` 의 `cap` 이 정본이고 이 표는
 * **발동 수의 의미**만 소유한다(값이 둘로 갈리면 픽커 표시와 정산이 어긋난다).
 */
const CATALYST_DROP_AXIS: readonly {
  readonly id: number;
  /** 원장 한 행 → 이 카드가 "실제로 센 수". */
  readonly count: (c: CatalystContributionLike) => number;
  /** 그 수가 개별 상한에 닿는 지점. // BALANCE (출시 전 일괄 튜닝 — defer-balance-tuning) */
  readonly saturation: number;
}[] = [
  {
    // `id 21 catalysis` — **정착한 결정 수**. 원장이 스폰마다 `earned+1`, 파괴마다 `missed+1`
    // 이므로 차가 곧 지금 바닥에 서 있는 결정 수다(`catalyst/chain.ts` §정착 수가 이 식을
    // 명시적으로 계약으로 적어 두었다 — 슬롯이 없어 원장으로 나가는 카드).
    id: 21,
    count: (c) => c.earned - c.missed,
    // 포화 = `SHARD_LIVE_CAP`(chain.ts = 12). 결정은 그 이상 동시에 설 수 없으므로 "밭이 가득
    // 찼다"가 이 카드가 도달할 수 있는 최선이다.
    saturation: 12,
  },
  {
    // `id 33 berdan-collapse` — **점프 직후 즉사시킨 적 수**(`berdan.ts` 가 `killed` 를 그대로
    // credit 한다). 놓친 칸은 이 카드에 없다.
    id: 33,
    count: (c) => c.earned,
    saturation: 20,
  },
  {
    // `id 38 niflheim-flagship` — **기함 격추**(격추마다 +1). 기함은 런당 한 척뿐이라 사건이
    // 이진이고, 그래서 포화가 1 이다. `missed` 는 대피소 복구에 쓴 **자원**이라 단위가 달라
    // 여기서 빼지 않는다(빼면 자원 수치가 드랍 배율을 깎는 엉뚱한 결합이 생긴다).
    id: 38,
    count: (c) => c.earned,
    saturation: 1,
  },
  {
    // `id 45 kras-breach` — **엄폐물을 남기며 부순 블록 수**(`kras.ts` 가 벽 파괴 지점에서 +1).
    id: 45,
    count: (c) => c.earned,
    saturation: 15,
  },
];

/**
 * 귀속 원장 → {@link CatalystDropInput.catalystDropMult}(≥1).
 *
 * ## 합성식은 헌장의 축별 합성 그대로다
 * ```
 * mult = 1 + Σ (cap_i − 1) × progress_i × CAP_COMPOSE_FACTOR      (progress_i = min(1, count_i / sat_i))
 * ```
 * `catalysts.ts` 의 {@link import('./catalysts.js').axisCapMult} 와 **같은 식**이고, 모든
 * 카드가 포화하면 정확히 그 값(= `axisCapMult(ids,'catalystDrop')`)이 된다. 즉 이 함수는
 * 상한을 새로 만들지 않고 **이미 선언된 상한 안에서 진행도만 곱한다** — 상한 정본이 둘로
 * 갈리지 않는 유일한 형태다. `catalystCapSweep` 이 전수로 잰 최댓값이 그대로 유계로 선다.
 *
 * @param contributions `RunResult.catalystContributions`. **무촉매 런은 `undefined`** 이고
 *   그때 반환은 정확히 `1` 이다(호출부는 그 경우 필드 자체를 안 싣는 것이 규율).
 */
export function catalystDropMultFromContributions(
  contributions: readonly CatalystContributionLike[] | undefined,
): number {
  if (contributions === undefined || contributions.length === 0) return 1;
  let sum = 0;
  for (const row of contributions) {
    const axis = CATALYST_DROP_AXIS.find((a) => a.id === row.id);
    if (axis === undefined) continue;
    // 카탈로그와 표가 갈리면(축이 바뀌거나 카드가 사라지면) **조용히 무시**하지 말고 세지
    // 않는다. 어긋남 자체는 `tests/` 의 정합 단언이 잡는다.
    const def = catalystById(row.id);
    if (def === undefined || def.cap.axis !== 'catalystDrop') continue;
    const n = axis.count(row);
    if (!Number.isFinite(n) || n <= 0) continue;
    sum += (def.cap.mult - 1) * Math.min(1, n / axis.saturation);
  }
  if (sum <= 0) return 1;
  return Math.min(EFFECTIVE_MAX_DROP_MULT, 1 + sum * CAP_COMPOSE_FACTOR);
}

/** 촉매 드랍축 카드 id 목록(정합 검사용 — 카탈로그의 `cap.axis === 'catalystDrop'` 과 같아야 한다). */
export const CATALYST_DROP_AXIS_IDS: readonly number[] = CATALYST_DROP_AXIS.map((a) => a.id);

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

  // 규칙이 실제로 만든 배율(≥1)로 base 확률을 스케일한 뒤 상한 클램프. 미배선이면 1 → base.
  const mult = Math.max(1, input.catalystDropMult ?? 1);
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
