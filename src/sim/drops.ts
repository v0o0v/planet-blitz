/**
 * Drop determination (M2 plan B3, GDD §3).
 *
 * Elites and the boss are the only sources of floor loot (rank-and-file enemies
 * drop gems only). The sim emits a DROP SEED (u32) + rarity code; `rollItem`
 * confirms the item later (ADR-0005, plan §2 ①A). All rarity/seed choices are
 * drawn from `state.dropRng` (`rng.fork('drops')`) so the drop stream is a pure
 * function of the seed and independent of other subsystems.
 *
 * Rarity codes match src/items/types.ts RARITY_CODE (0 normal .. 3 unique). They
 * are duplicated here as plain numbers to keep the sim core free of any runtime
 * dependency on the item layer.
 */

import type { SeededRng } from './rng.js';

export const RARITY_MAGIC = 1;
export const RARITY_RARE = 2;
export const RARITY_UNIQUE = 3;

/** A confirmed drop: the seed the item is rolled from + its rarity code. */
export interface DropRoll {
  seed: number;
  rarityCode: number;
}

/**
 * 행성 rarity 기준 확률(data/planets/index.ts PlanetDropTable와 동형). sim
 * 코어가 item 레이어에 런타임 의존하지 않도록 여기서 최소 형태만 정의한다.
 */
export interface DropOdds {
  readonly eliteRareBase: number;
  readonly eliteUniqueBase: number;
  readonly bossUniqueBase: number;
  /**
   * 행성 특산 설계도 테이블의 항목 수(M7b). 0/미지정이면 그 행성은 설계도를 떨구지 않는다.
   * **sim 은 테이블 내용을 모른다** — 개수만 받아 인덱스를 뽑고, 어떤 방어체인지는 메타
   * 레이어(data/planets/blueprints.ts)가 확정한다(현행 rarityCode 와 동일 철학).
   */
  readonly blueprintTableSize?: number;
  /**
   * 등급 코드별 설계도 동반 확률(centi-percent, 인덱스 = rarityCode 0..3).
   * 미지정이면 {@link DEFAULT_BLUEPRINT_CHANCE_CP}.
   */
  readonly blueprintChanceCp?: readonly number[];
}

/**
 * 기본 드랍 확률. 테이블 미지정 시 폴백이며 `data/planets/index.ts` 의 전 행성 `dropTable` 과
 * **항상 같은 값**이어야 한다(ADR-0022 품질⟂종류 직교 — 행성별 유니크 편차 금지).
 *
 * ## 유니크 base 1/7.5 하향 (2026-07-27 밸런스 패스)
 * 구값(`eliteUniqueBase 0.03` · `bossUniqueBase 0.15`)은 표준 진행 경로 240런 기준
 * **career 기대 유니크 약 83개**를 냈다 — 저작된 유니크가 **15종**뿐이라 5.6배 과잉이고,
 * 만렙 표준 빌드가 8칸 전부 유니크로 차 버린다(Lane C 정량화). 목표는 **만렙 1~2칸**이라
 * 두 base 를 같은 배수(약 1/7.5)로 내렸다.
 *
 * ⚠️ **base 만 내렸고 단계 점근 곡선({@link stageUniqueMult})은 그대로다** — ADR-0035 의
 * "품질은 단계와 함께 오르되 상한에 점근"은 유지된다. 저단계가 더 희소해지고 고단계에서
 * 회복되는 형태가 된다.
 *
 * ⚠️ `rollBossDrop` 은 유니크가 아니면 **rare** 를 낸다 — base 하향으로 보스 드랍이 거의
 * 항상 rare 가 되는 것은 의도된 귀결이다(보스 확정 드랍 1개 계약은 그대로).
 */
export const DEFAULT_DROP_ODDS: DropOdds = {
  eliteRareBase: 0.25,
  eliteUniqueBase: 0.004,
  bossUniqueBase: 0.02,
};

// ---------------------------------------------------------------------------
// 설계도 드랍 (M7b-acquisition) — RNG 미소비 순수 파생
// ---------------------------------------------------------------------------

/**
 * 등급 코드별 설계도 **상대 가중치**(centi-percent 형태). 인덱스 = rarityCode.
 *
 * normal·magic 은 0 이다 — 설계도는 **엘리트·보스 드랍 중심**(기획 §4)이고, 잡몹은 애초에
 * 젬만 떨군다. 엘리트/보스가 rare 이상을 뽑았을 때만 설계도가 따라붙는다.
 *
 * ⚠️ **2026-08-08 의미 변경: 절대 확률 → 상대 가중치.** 예전에는 이 값이 "이 레코드 하나에
 * 설계도가 동반될 확률"이었고, 그래서 런당 획득 확률이 드랍 건수·단계·행성 배율에 따라
 * 흔들렸다(실측 약 7%~14%, 최대 N개). 지금은 런 단위 게이트
 * {@link BLUEPRINT_RUN_CHANCE_CP} 가 "설계도가 나오는가"를 정확히 한 번 정하고, 이 표는
 * **통과했을 때 어느 레코드가 뽑히는가**의 가중치로만 쓰인다({@link rollRunBlueprint}).
 * 즉 rare:unique 비중(그리고 행성별 편차)은 종전 그대로 보존되고, 총량만 3% 로 고정된다.
 *
 * 표를 바꾸면 이제 **획득률이 아니라 등급 비중이** 바뀐다. 총량을 바꾸려면
 * {@link BLUEPRINT_RUN_CHANCE_CP} 를 건드려야 한다.
 */
export const DEFAULT_BLUEPRINT_CHANCE_CP: readonly number[] = [0, 0, 600, 2500];

/**
 * **런 1회(클리어)당 설계도가 나올 확률**(centi-percent). 300 = 3%.
 *
 * ## 왜 런 단위 게이트인가 (2026-08-08 사용자 지시)
 * 구 모델은 레코드마다 {@link DEFAULT_BLUEPRINT_CHANCE_CP} 를 굴렸다. 그래서 "런당 확률"이
 * 어디에도 적혀 있지 않았고 — 드랍 건수 × 단계 품질 곡선 × 행성 인기 배율의 곱으로 창발했다.
 * 실측 재구성치가 단계 1 카르곤 약 7.2%, 단계 21 아르케 약 14.2% 로, **의도한 값이 아니라
 * 다른 손잡이들이 흘려보낸 잔여값**이었다. 지시는 "런 클리어시 3%, 그 안의 등급 확률은 원래대로"
 * 였으므로 축을 둘로 쪼갠다:
 *   - **총량** = 이 상수 하나 (드랍 건수·단계·행성 배율 전부와 무관하게 정확히 3%)
 *   - **분포** = 기존 cp 표 + 행성 특산 weight 표 (건드리지 않았다)
 *
 * 클리어 런은 보스 확정 드랍(항상 rare 이상, ADR-0035)을 반드시 1건 갖기 때문에 후보가
 * 비는 일이 없다 — 그래서 "3%"가 근사치가 아니라 **정확히 3%** 다.
 */
export const BLUEPRINT_RUN_CHANCE_CP = 300;

/**
 * 설계도 드랍 1건의 **불투명 코드**. sim 은 방어체 카탈로그를 몰라야 하므로 여기까지가
 * sim 의 책임이다 — 실제 종류·catalogId 확정은 메타 레이어가 행성 특산 테이블로 한다.
 */
export interface BlueprintDropCode {
  /** 행성 특산 테이블의 인덱스 [0, blueprintTableSize). */
  tableIndex: number;
  /** 파생 시드(uint32). 메타 레이어가 필요하면 추가 롤 입력으로 쓴다. */
  seed: number;
}

/** 정수 해시(murmur3 finalizer). 순수·결정론 — 부동소수 누적 없음. */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 판정 축별 salt — 각 축이 같은 시드에서 서로 독립적으로 갈리게 한다. */
const SALT_GATE = 0x9e3779b9;
const SALT_INDEX = 0x7f4a7c15;
const SALT_SEED = 0x2545f491;
/** 런 단위 게이트·가중 추첨 salt(2026-08-08). 위 세 축과 겹치면 상관이 생긴다. */
const SALT_RUN_GATE = 0x94d049bb;
const SALT_RUN_PICK = 0xff51afd7;

/**
 * 이미 확정된 장비 드랍 1건에 설계도가 동반되는지 판정한다(순수).
 *
 * ## 왜 RNG 를 소비하지 않는가
 * `dropRng` 에서 한 번이라도 더 뽑으면 드랍 스트림 전체가 밀려 **모든 기존 fixture 와
 * 해시가 갈린다**. 그래서 이미 뽑아 둔 드랍 시드를 정수 해시로 되풀어 쓴다 — 새 결정론
 * 입력이 0 이므로 `hashWorld` 도 `LootRecord` 스키마도 한 바이트 변하지 않는다. 시드가
 * 이미 해시에 접혀 있으니 파생값을 따로 접을 필요도 없다(순수 함수 = 재확정 가능).
 *
 * 설계도가 없으면 null.
 */
export function rollBlueprintDrop(drop: DropRoll, odds: DropOdds = DEFAULT_DROP_ODDS): BlueprintDropCode | null {
  const size = odds.blueprintTableSize ?? 0;
  if (!Number.isInteger(size) || size <= 0) return null;
  const table = odds.blueprintChanceCp ?? DEFAULT_BLUEPRINT_CHANCE_CP;
  const chanceCp = table[drop.rarityCode] ?? 0;
  if (chanceCp <= 0) return null;
  const seed = drop.seed >>> 0;
  if (mix32(seed, SALT_GATE) % 10000 >= chanceCp) return null;
  return { tableIndex: mix32(seed, SALT_INDEX) % size, seed: mix32(seed, SALT_SEED) };
}

/** {@link rollRunBlueprint} 입력 1건 — 런이 남긴 드랍 레코드 하나의 추첨 자격. */
export interface BlueprintCandidate {
  /** 그 드랍의 확정 시드. 해시 입력이자 뽑혔을 때의 파생 원천. */
  readonly seed: number;
  /** 상대 가중치(등급별 cp). 0 이하면 후보에서 빠진다 — normal·magic 이 그렇다. */
  readonly weightCp: number;
  /** 그 드랍이 난 행성의 특산 테이블 크기. 0 이하면 후보에서 빠진다. */
  readonly tableSize: number;
}

/**
 * **런 1회의 설계도 추첨**(순수) — 게이트 1회 + 가중 추첨 1회, 결과는 0개 아니면 1개다.
 *
 * ## 왜 RNG 를 소비하지 않는가
 * {@link rollBlueprintDrop} 과 같은 규율이다. `dropRng` 에서 한 번이라도 더 뽑으면 드랍
 * 스트림 전체가 밀려 모든 기존 fixture 와 해시가 갈린다. 그래서 이미 확정된 드랍 시드들을
 * murmur3 finalizer 로 접어 게이트·추첨 두 축을 만든다 — 새 결정론 입력이 0 이므로
 * `hashWorld` 도 `LootRecord` 스키마도 한 바이트 변하지 않는다.
 *
 * ⚠️ **접는 순서가 계약이다.** `cands` 의 순회 순서가 fold 결과를 바꾼다 — 호출부는 항상
 * `LootRecord` 배열 순서(= 수거 순서, 보스는 꼬리) 그대로 넘겨야 재현성이 선다.
 *
 * ⚠️ 후보가 하나도 없으면(= 전부 magic 이하이거나 테이블이 빈 행성) null 이다. 클리어 런은
 * 보스 확정 드랍이 항상 rare 이상이라 이 경로로 새지 않는다 — 미클리어 런을 애초에 넘기지
 * 않는 것이 호출부(`blueprintDropsFromLoot`)의 책임이다.
 *
 * @returns 뽑힌 후보의 `cands` 인덱스와 그 설계도 코드. 게이트 실패·후보 없음이면 null.
 */
export function rollRunBlueprint(
  cands: readonly BlueprintCandidate[],
  chanceCp: number = BLUEPRINT_RUN_CHANCE_CP,
): { pick: number; code: BlueprintDropCode } | null {
  if (!(chanceCp > 0)) return null;
  const eligible = (c: BlueprintCandidate): boolean =>
    c.weightCp > 0 && Number.isInteger(c.tableSize) && c.tableSize > 0;

  // 1. 후보 시드를 접어 이 런 고유의 32비트를 만든다(게이트·추첨이 여기서 갈라진다).
  let fold = 0x9e3779b9;
  let total = 0;
  for (const c of cands) {
    if (!eligible(c)) continue;
    fold = mix32(fold ^ (c.seed >>> 0), SALT_RUN_GATE);
    total += c.weightCp;
  }
  if (total <= 0) return null;

  // 2. 총량 게이트 — 여기 하나가 "런당 3%"의 전부다.
  if (fold % 10000 >= chanceCp) return null;

  // 3. 가중 추첨 — 등급 비중(rare:unique)과 행성 편차가 여기서 보존된다.
  let pick = mix32(fold, SALT_RUN_PICK) % total;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (c === undefined || !eligible(c)) continue;
    if (pick < c.weightCp) {
      const seed = c.seed >>> 0;
      return {
        pick: i,
        code: { tableIndex: mix32(seed, SALT_INDEX) % c.tableSize, seed: mix32(seed, SALT_SEED) },
      };
    }
    pick -= c.weightCp;
  }
  return null; // 도달 불가(total 이 곧 가중치 합) — 방어적 착지.
}

// ---------------------------------------------------------------------------
// 단계 품질 곡선 (ADR-0035 — 연속 곡선 + 상한 점근)
// ---------------------------------------------------------------------------

/**
 * 품질 배율 곡선(유리함수):
 *
 * ```
 * mult(stage) = 1 + (CAP - 1) × (stage - 1) / ((stage - 1) + K)
 * ```
 *
 * - `stage = 1` 에서 **정확히 1.0** — 단계1 불변 계약(ADR-0022 결정론 규율 1)을 산술로 보장한다
 *   (`stage <= 1` early-return 이라 부동소수 오차조차 없다).
 * - 단조 증가, `stage → ∞` 에서 `CAP` 에 점근한다. 상한은 있으나 **평평해지지 않는다** — 침략
 *   단계가 무한히 깊어진다는 구조(CONTEXT.md)와 정합.
 * - `K` = 중간점: `stage = 1 + K` 에서 `1 + (CAP-1)/2`.
 *
 * ⚠️ **사칙연산만 쓴다.** `Math.exp`/`Math.pow`/`Math.log` 는 EF(Deno)↔브라우저 IEEE754 정확
 * 재현 계약을 깨므로 결정론 경로에 넣지 않는다(ADR-0005).
 */
function stageQualityMult(stage: number, cap: number, k: number): number {
  if (stage <= 1) return 1; // 단계1 ≡ 정확히 1.0(오차 없음).
  const t = stage - 1;
  return 1 + ((cap - 1) * t) / (t + k);
}

/**
 * 레어 배율 곡선 계수. `K` 는 **단계 11 에서 구 계단값 1.6 과 정확히 일치**하도록 잡았다
 * (`1 + 1.8 × 10/30 = 1.6`) — 곡선 도입이 중간 밴드를 급변시키지 않는다.
 * 점근 레어 확률 = `eliteRareBase 0.25 × 2.8 = 0.70`.
 */
const RARE_MULT_CAP = 2.8;
const RARE_MULT_K = 20;

/**
 * 유니크 배율 곡선 계수. 단계 11 ≈ 1.857(구 계단값 1.5 보다 높다 — 유니크는 곡선 도입으로
 * 중간 밴드부터 완만히 오른다). 점근 유니크 확률 = `eliteUniqueBase 0.004 × 4.0 = 0.016`
 * (base 1/7.5 하향 반영 — 곡선 계수 자체는 그대로다).
 */
const UNIQUE_MULT_CAP = 4.0;
const UNIQUE_MULT_K = 25;

/**
 * 단계 기반 레어 배율(ADR-0022 품질 축 · ADR-0035 연속화). 단계1 = 1.0, 이후 연속 상승해
 * {@link RARE_MULT_CAP} 에 점근한다.
 */
export function stageRareMult(stage: number): number {
  return stageQualityMult(stage, RARE_MULT_CAP, RARE_MULT_K);
}

/**
 * 단계 기반 유니크 배율(ADR-0022 품질 축 · ADR-0035 연속화). 단계1 = 1.0, 이후 연속 상승해
 * {@link UNIQUE_MULT_CAP} 에 점근한다.
 */
export function stageUniqueMult(stage: number): number {
  return stageQualityMult(stage, UNIQUE_MULT_CAP, UNIQUE_MULT_K);
}

// ---------------------------------------------------------------------------
// 엘리트 드랍 확률화 (ADR-0035 — 수량은 전 단계 고정, 단계는 품질만 올린다)
// ---------------------------------------------------------------------------

/**
 * 런당 목표 엘리트 드랍 수(설계값). 보스 확정 드랍 1개와 합쳐 **런당 장비 2~3개**가 된다
 * (ADR-0035 §전리품 수량 — 인벤 유입 3~5 = 장비 2~3 + 촉매 1~2 + 설계도 희소).
 */
export const TARGET_ELITE_DROPS_PER_RUN = 1.5;

/**
 * 완주 런의 카드 스폰 수(실측). 엘리트 승격은 **카드 1장당 `eliteCount` 마리**
 * (`src/sim/waves.ts`)이므로 런당 엘리트 수 ≈ `이 값 × eliteCount` 다.
 *
 * ## ⚠️ 이 값은 **런 길이**에 종속된다 — 런 길이를 움직이는 것을 만졌으면 함께 재측정하라
 * 카드는 세그먼트가 진행되는 동안 계속 뽑히므로 **런이 길어지면 비례해 늘어난다**. 런 길이를
 * 정하는 것은 «처치 할당(`killGoal`) 합계»만이 아니다 — **적 총 HP 풀과 플레이어 화력의 비**가
 * 곧 런 길이다(ADR-0011 창발 런 길이). 그래서 `killGoal` 을 한 번도 안 만져도 **플레이어 공격력
 * 상향만으로** 이 값이 낡는다. 2026-08-08 에 실제로 그렇게 낡았다(아래 §현재값 32 의 근거).
 *
 * 실제로 한 번 어긋났다: 초깃값 15 는 `killGoal` 합계가 **80**(`[10,14,16,18,22]`)이던 시절의
 * 실측(단계1 완주 런 14.87, `.omc/research/economy-baseline-2026-07-27.md` §1)이었는데, 적 곡선
 * 레인이 합계를 **240** 으로 올리자 런이 33초 → 약 100초가 되면서 카드가 **41.8장**이 됐다.
 * 15 를 그대로 뒀다면 런당 엘리트 드랍이 1.5개가 아니라 **약 4.4개**가 됐을 것이다(재보정 전
 * 실측 rolled 5.38 = 보스1 + 엘리트4.38). 그동안 단위 테스트는 전부 초록이었다.
 *
 * ## 현재값 32 의 근거 (2026-08-08 재측정 — 런이 28% 짧아졌다)
 * `killGoal` 합계는 그대로인데 **런이 짧아졌다.** 2026-08-08 플레이테스트 루프가 플레이어
 * 공격력을 8 → 12.75 로 올렸고(`world.ts` `DEFAULT_WEAPON`), 적 총 HP 풀은 밀도 패스의 짝
 * (`ENEMY_COUNT_MULT` × `ENEMY_HP_MULT` = 1)이 보존했으므로 **같은 풀을 더 빨리 밀어냈다.**
 * 완주 초가 97.2 → 70.3 이 됐고 카드는 그만큼 덜 뽑혔다.
 *
 * 표준 빌드 96시드 · planet 0 · 장비 시드 = 런 시드 · **완주 런** 평균:
 *
 * | 단계 | Lv | 초 | 처치 | 카드 | 장비 드랍(수거+바닥) |
 * |---|---|---|---|---|---|
 * | 1  | 5  | 70.3 | 231.1 | 30.05 | 1.95 |
 * | 5  | 25 | 74.6 | 239.7 | 31.34 | 1.99 |
 * | 11 | 55 | 81.2 | 254.1 | 33.34 | 1.96 |
 *
 * 세 점 평균 31.6 → **32**. 42 를 그대로 두면 `eliteDropChance` 가 그만큼 낮게 잡혀 런당 장비가
 * 설계 2~3 이 아니라 **약 1.95** 가 된다(위 표 마지막 열이 그 상태의 실측이다).
 *
 * ⚠️ **단계 21(Lv100)은 이번에 못 쟀다** — 완주율이 0% 라 완주 런 표본이 없다(§R51 장비 축
 * 포화). 옛 표의 43.52 는 그 시절 값이므로 이 표에 섞지 않았다. 그 축이 열리면 다시 재라.
 *
 * ⚠️ **처치 수 대리 지표는 이제 옛 표와 직접 비교하면 안 된다.** 밀도 패스가 카드 1장당 적
 * 수를 1.3배로 올렸으므로 «처치/카드» 비율이 달라졌다 — 같은 스윕 안에서만 비례한다.
 *
 * ## 옛 값 42 의 근거 (2026-07-27 적 곡선 확정본에서 실측 — 이력)
 * `SEGMENTS.killGoal = [10,46,53,59,72]`(합계 240) 기준, 표준 빌드 60시드(1000..1059) planet 0
 * **완주 런** 평균. 장비 시드는 `runCurveSweep` 기본 규약대로 **런 시드를 그대로** 썼다:
 *
 * | 단계 | Lv | 초 | 처치 | 카드 | 엘리트 처치 | 장비 드랍 |
 * |---|---|---|---|---|---|---|
 * | 1  | 5   | 97.2  | 262.6 | 41.92 | 40.67 | 2.50 |
 * | 11 | 55  | 98.2  | 261.6 | 42.29 | 40.64 | 2.60 |
 * | 21 | 100 | 102.4 | 268.3 | 43.52 | 82.56 | 2.59 |
 *
 * 카드 수를 직접 셀 수 없는 하네스라면 **처치 수**를 대리 지표로 써도 된다(위 표에 함께 실었다 —
 * 카드와 거의 비례한다).
 *
 * ⚠️ **승률은 일부러 싣지 않았다.** 위 값들은 장비 시드 규약에 **거의 무관**하지만(고정 시드
 * `0xbeef` 로 재면 카드 41.75 / 42.40 / 47.07 · 드랍 2.50 / 2.53 / 2.21 로 사실상 동일) **승률만은
 * 규약에 크게 흔들린다** — 단계1 이 66.7%(런 시드) ↔ 93.3%(고정 `0xbeef`)로 갈린다. 클리어율의
 * 정본은 이 파일이 아니라 적 곡선 레인의 `runCurveSweep`(96시드 · 장비 시드 = 런 시드)이다.
 * **밸런스 판단에 이 주석의 수치로 클리어율을 논하지 마라.** 드랍 축 결론이 그 규약과 무관하다는
 * 사실이 곧 이 상수를 신뢰할 수 있는 근거다.
 *
 * **`SEGMENTS.killGoal` 의 *합계*를 다시 만지면 이 상수를 다시 재야 한다.** 세그먼트 간 재배분은
 * 합계가 같으면 카드 수를 거의 안 흔든다 — `[30,42,48,54,66]` → `[10,46,53,59,72]` 재배분에서
 * 위 값이 바이트 동일하게 재현됐다.
 *
 * ## 🚨 이 상수를 지키던 자동 감시자는 **없어졌다** (2026-08-06, ADR-0051)
 * `tests/drops.test.ts` 의 "런당 장비 유입" 통합 가드가 그 역할이었고, 이 주석은 오래도록
 * "어긋나면 큰 소리로 실패한다"고 적고 있었다. **그 문장은 더 이상 사실이 아니다.** 그 가드는
 * 표본을 `filter((r) => r.victory)` 로 만들고 `승리 4건 이상`을 공허 가드로 걸어, 단언의 성립
 * 자체가 "봇이 이길 수 있는가"에 얹혀 있었다(ADR-0051 §1 판정 규칙). 최소 틱으로 다시 쓰지도
 * 못했다 — 카드 수는 `cardInterval`·`killGoal`·급행 램프가 함께 만드는 **런 길이 종속 창발값**
 * 이라 `SEGMENTS` 에서 산술로 파생시킬 수가 없다.
 *
 * **그래서 지금은 이 값이 낡아도 스위트가 조용히 초록이다.** 위 "한 번 어긋났다" 절의 사고
 * (15 → 42, 런당 장비 1.5 → 4.4개)가 **다시 나도 아무도 안 알려 준다.**
 *
 * 런 길이를 움직이는 것(플레이어 화력 · 적 HP 풀 · `killGoal` 합계)을 만졌다면 **손으로 재라**:
 *   `pnpm balance` (예산제 하네스) 또는 `runCurveSweep`(`src/bench/rosterBench.ts`) 을
 *   표준 빌드 60시드 · planet 0 · 장비 시드 = 런 시드로 돌려 위 표의 "카드" 열을 다시 채운다.
 *   카드를 직접 못 세는 하네스면 "처치" 열이 대리 지표다(위 §카드 수 참조).
 */
export const EXPECTED_CARDS_PER_RUN = 32;

/**
 * 엘리트 처치 1회의 드랍 확률(ADR-0035).
 *
 * ## 왜 확정 1개가 아니라 확률인가
 * 구 구현은 엘리트 처치 = **확정 1개**였다. 그래서 `eliteCount`(0/1/2)가 난이도와 드랍 수량을
 * **동시에** 정하는 이중 노브였고, 런당 유입이 0개(단계1~10) → 약 15개(11~20) → 약 30개(21+)로
 * 계단 폭주했다(economy-baseline §3). 확률화하면 `eliteCount` 는 **순수 난이도 노브**로 환원되고
 * 런당 기대 수량은 이 함수 하나가 지정한다.
 *
 * ## 왜 `eliteCount` 에 반비례하는가
 * 적 곡선 레인이 `eliteCount` 를 자유롭게 움직여도 **런당 장비 유입이 고정**되어야 하기 때문이다:
 *
 * ```
 * 기대 드랍/런 = (카드 수 × eliteCount) × p = TARGET   ⇒   p = TARGET / (카드 수 × eliteCount)
 * ```
 *
 * `eliteCount === 0` 이면 드랍원이 없으므로 0(0 나눗셈 가드). 현행 밴드는 전부 1 이상이라
 * 이 분기는 방어용이다.
 *
 * ⚠️ **보스 확정 드랍 1개는 확률화하지 않는다** — GDD 의 "사망 페널티 = 보스 보상 상실"이 그
 * 확정성 하나에 걸려 있어, 보스까지 확률화하면 사망 페널티가 통째로 사라진다(ADR-0035).
 *
 * ⚠️ `eliteCount` 를 **인자로 받는다** — `stageParams` 를 여기서 부르면 sim 코어가 데이터
 * 레이어(`data/waves.ts`)에 런타임 의존하게 되고, 그 경계는 `tests/planetDrops.test.ts` ⑤ 가
 * 못박고 있다. 단계 → `eliteCount` 해석은 호출부(`src/sim/world.ts`)의 책임이다.
 *
 * ## `planetMult` — 행성 인기 수량 배율(ADR-0038)
 * 이 게이트 확률에 그대로 곱한다. **양방향 대칭**이 이 지점을 고른 이유다: 촉매 드랍량축이
 * 쓰는 `bonusLootSeeds` 는 배율 > 1 만 다룰 수 있어(추가 시드 파생) 0.85 같은 하향을 표현할
 * 수 없는데, 게이트 확률은 위아래로 똑같이 움직인다. 기본값 1 이면 산술이 구 경로와 **바이트
 * 동일**하다(`p * 1` 은 IEEE754 에서 정확). 상한 클램프(p > 1 → 1)는 그대로 뒤에서 걸린다.
 */
export function eliteDropChance(eliteCount: number, planetMult = 1): number {
  if (!(eliteCount > 0)) return 0;
  const p = (TARGET_ELITE_DROPS_PER_RUN / (EXPECTED_CARDS_PER_RUN * eliteCount)) * planetMult;
  if (!(p > 0)) return 0;
  return p > 1 ? 1 : p;
}

/**
 * 엘리트 드랍 게이트 롤. 통과하면 호출부가 {@link rollEliteDrop} 으로 등급·시드를 확정한다.
 *
 * ⚠️ **드랍 스트림이 밀린다.** 엘리트 처치마다 `dropRng` 를 한 번 더 소비하므로 PvE 골든 해시가
 * 갈린다 — 확정 비용이고 골든 재생성으로 흡수한다. **침공(PvP)은 무영향**이다: 엘리트 승격은
 * `updateWaves`(`src/sim/waves.ts`) 안에만 있고 침공은 `if (!designedRun) updateWaves(...)`
 * (`src/sim/world.ts`)로 그것을 아예 실행하지 않으므로 이 게이트가 호출되지 않는다.
 */
export function rollEliteDropGate(
  dropRng: SeededRng,
  eliteCount: number,
  planetMult = 1,
): boolean {
  // ⚠️ **RNG 는 배율과 무관하게 항상 정확히 1회 소비된다** — 배율은 threshold 만 움직인다.
  // 소비 횟수가 배율에 따라 갈리면 드랍 스트림 전체가 밀려 같은 시드가 다른 런이 된다.
  return dropRng.nextFloat() < eliteDropChance(eliteCount, planetMult);
}

/**
 * Roll an elite's drop rarity + seed. Draws the rarity tier first, then the seed,
 * so the sequence is fixed per RNG position.
 * `odds`(행성 드랍 테이블) 미지정 시 카르곤 기본값을 쓴다(하위 호환).
 *
 * ⚠️ **드랍 여부는 이 함수가 정하지 않는다** — 구 구현은 "엘리트 = 확정 1개"였으나 ADR-0035 가
 * 확률화했다. 호출부는 {@link rollEliteDropGate} 로 먼저 게이트를 굴리고, 통과한 경우에만 이
 * 함수로 등급·시드를 확정한다. 이 함수 자체는 등급 축 단독이라 계약이 그대로다.
 *
 * `rarityMult`(촉매 희귀도 보상축, ≥1)는 rare/unique 확률에 균일하게 곱한다 — 구 변칙
 * `dropRateMult`·`uniqueChanceMult` 자리를 촉매 배율이 승계한다. **rarityMult===1 이면**
 * threshold·RNG 소비 순서가 구 무변칙 경로와 바이트 동일하므로, 촉매 무주입 골든이 불변이다.
 * 단계1(구 정찰)도 배율 1.0 이라 구 tier0 과 동일.
 */
export function rollEliteDrop(
  dropRng: SeededRng,
  stage: number,
  rarityMult: number,
  odds: DropOdds = DEFAULT_DROP_ODDS,
): DropRoll {
  const uniqueChance = odds.eliteUniqueBase * stageUniqueMult(stage) * rarityMult;
  const rareChance = odds.eliteRareBase * stageRareMult(stage) * rarityMult;
  const r = dropRng.nextFloat();
  const seed = dropRng.nextU32();
  let rarityCode = RARITY_MAGIC;
  if (r < uniqueChance) rarityCode = RARITY_UNIQUE;
  else if (r < uniqueChance + rareChance) rarityCode = RARITY_RARE;
  return { seed, rarityCode };
}

/**
 * Roll the boss's guaranteed drop: always rare, occasionally unique. Elevated
 * unique odds vs elites; 높은 침략 단계와 촉매 희귀도(rarityMult)가 더 밀어 올린다.
 * rarityMult===1 이면 구 무변칙 경로와 바이트 동일(RNG 소비·threshold 불변).
 */
export function rollBossDrop(
  dropRng: SeededRng,
  stage: number,
  rarityMult: number,
  odds: DropOdds = DEFAULT_DROP_ODDS,
): DropRoll {
  const uniqueChance = odds.bossUniqueBase * stageUniqueMult(stage) * rarityMult;
  const r = dropRng.nextFloat();
  const seed = dropRng.nextU32();
  const rarityCode = r < uniqueChance ? RARITY_UNIQUE : RARITY_RARE;
  return { seed, rarityCode };
}

// ---------------------------------------------------------------------------
// 드랍량(촉매 'drop' 보상축) — RNG 미소비 순수 파생
// ---------------------------------------------------------------------------

/** 드랍량 파생 salt(rollBlueprintDrop 과 같은 철학 — 이미 뽑힌 드랍 시드를 되풀어 쓴다). */
const SALT_BONUS_GATE = 0x1b56c4e9;
const SALT_BONUS_SEED = 0x27d4eb2f;

/**
 * 이미 확정된 드랍 1건에 촉매 드랍량 배율(`mult` ≥ 1)만큼 **추가 루팅 시드**를 파생한다(순수).
 *
 * ## 왜 dropRng 를 소비하지 않는가
 * `dropRng` 에서 한 번이라도 더 뽑으면 드랍 스트림 전체가 밀려 기존 fixture·해시가 갈린다
 * (rollBlueprintDrop 과 동일 규율). 그래서 이미 뽑아 둔 드랍 시드를 정수 해시로 되풀어 쓴다 —
 * **mult ≤ 1 이면 빈 배열**이라 촉매 무주입 런은 드랍 스폰이 한 건도 늘지 않는다(바이트 불변).
 *
 * 정수부(mult−1)는 확정 추가분, 소수부는 시드 파생 확률로 1건 더(결정론). 각 추가 시드는
 * 원 시드에서 서로 다른 salt 로 파생해 유니크하다(같은 등급으로 스폰 — 등급은 rarity 축 소관).
 */
export function bonusLootSeeds(seed: number, mult: number): number[] {
  if (!(mult > 1)) return [];
  const whole = Math.floor(mult - 1);
  const frac = mult - 1 - whole;
  let count = whole;
  if (frac > 1e-9 && mix32(seed >>> 0, SALT_BONUS_GATE) % 10000 < Math.round(frac * 10000)) count++;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(mix32(seed >>> 0, (SALT_BONUS_SEED + i) >>> 0));
  return out;
}
