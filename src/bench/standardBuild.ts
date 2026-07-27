/**
 * 표준 빌드 — **표준 장비 세트 + 표준 스킬 투자** (ADR-0035 2026-07-27 개정 · L1).
 *
 * 표준 진행 경로(ADR-0035)는 "기체 레벨 ↔ 침략 단계 ↔ 런당 기대 XP·전리품"까지만 정의했고
 * **장비를 빠뜨렸다**. 그래서 이 리포의 밸런스 측정 전체가 무장비 기준이었다
 * (`rosterBench.ts` 의 `runOne` 이 `defaultProfile()` = 장착 0개를 썼다). 이 모듈이 그 구멍을
 * 메운다 — 레벨 밴드마다 **8칸 중 채움 수 · 등급 분포 · 어픽스 개수**를 설계값으로 정하고
 * **고정 시드로 결정론 조립**한다.
 *
 * ## 왜 설계값인가 (진행 시뮬레이션 기각)
 * 드랍을 실제로 굴려 파생하면 "무엇을 장착할지" 정책이 곧 결론이 된다(ADR-0035 본문이 같은
 * 이유로 진행 루프 벤치를 기각했다). 여기서는 밴드별 도달점을 **설계값으로 못박고** 그
 * 설계값을 결정론으로 재현한다.
 *
 * ## 결정론 계약
 * `Math.random` · `Date.now` 를 쓰지 않는다. 같은 `(level, seed)` 는 항상 **바이트 동일한**
 * 아이템 배열을 낸다. 아이템 생성은 기존 정본 `rollItem`(`src/items/roll.ts`)만 쓰며 새 롤
 * 경로를 만들지 않는다 — 롤 결과가 바뀌면 실제 게임의 드랍도 같이 바뀐다는 뜻이다.
 *
 * ## 결정론 경계
 * 이 모듈은 **측정 계층**이다(`src/bench/**`). `src/sim/**` 은 이 파일을 import 하지 않는다.
 * 반대로 이 파일은 sim 을 import 하지 않고 아이템 계층(`src/items/**`)과 기체 데이터
 * (`data/ships/**`)만 읽는다.
 */

import { rollItem } from '../items/roll.js';
import { canEquip } from '../items/requiredLevel.js';
import { EQUIP_SLOTS } from '../items/types.js';
import type { EquipSlotId, Item, ItemSource, Rarity, SlotKind } from '../items/types.js';
import {
  shipTypeDef,
  zeroSkillInvest,
  flattenShipNodes,
  shipTreeRange,
  shipCapstoneIndex,
} from '../../data/ships/index.js';
// ⚠️ `STANDARD_PROGRESSION_PATH` 를 여기서 import 하지 않는다 — 측정 기준자가 튜닝 대상에
// 런타임 의존하면 순환 결합이 된다({@link STANDARD_BAND_RUNS} 주석). 두 값의 정합은
// `tests/standardBuild.test.ts` 의 드리프트 가드가 대조한다.
import { LEVEL_PER_STAGE, MAX_STANDARD_STAGE, standardStage } from '../save/progressionPath.js';
import { DEFAULT_DROP_ODDS, stageRareMult, stageUniqueMult } from '../sim/drops.js';

// ---------------------------------------------------------------------------
// 레벨 ↔ 단계 대응 (ADR-0035 §1.1)
// ---------------------------------------------------------------------------

// `LEVEL_PER_STAGE` · `standardStage` 의 **정본은 `src/save/progressionPath.ts`** 다(ADR-0035).
// 여기서 재정의하지 않고 그대로 재수출한다 — 중복 정의는 두 축이 조용히 갈라지는 지름길이고,
// ADR-0035 개정이 다룬 문제가 정확히 그 상황(GDD `Lv≈단계` vs 게이트 `Lv≈단계×5`)이었다.
export { LEVEL_PER_STAGE, standardStage };

/** 표준 경로의 밴드 수(= 만렙 100 ÷ 5 = 20). 밴드 s 는 Lv `5s-4 .. 5s` 를 덮는다. */
export const STANDARD_BAND_COUNT = MAX_STANDARD_STAGE;

/**
 * 밴드 대표 레벨 20개 = `[5, 10, …, 100]`. **이 지점에서만** `floor(Lv/5) == ceil(Lv/5)` 라
 * 표준 단계와 드랍처 단계({@link gearDropStage})가 정확히 일치한다 — 곡선 스윕은 전부 여기서 돈다.
 */
export const BAND_LEVELS: readonly number[] = Array.from(
  { length: STANDARD_BAND_COUNT },
  (_, i) => (i + 1) * LEVEL_PER_STAGE,
);

/** 레벨이 속한 설계 밴드(= 표준 단계와 동일 정의). */
export function standardBand(level: number): number {
  return standardStage(level);
}

/**
 * 표준 세트를 **어느 단계에서 딴 것으로 볼 것인가**(= `ItemSource.stage`).
 *
 * ⚠️ 표준 단계(`ceil(L/5)`)를 그대로 쓰면 안 된다. `floor` 를 쓰면 `5 × stage ≤ L` 이 항상
 * 성립해 드랍처 상한이 레벨을 넘지 못하고, 자기검증(`canEquip`)이 **구조적으로** 보장된다.
 * `ceil` 은 그 보장을 잃는다(구 상한 `5 × stage` 기준으로 Lv11 → 단계3 → 상한 15 → 요구 15
 * 레어가 섞이는 형태였다). 밴드 대표 레벨(Lv 5,10,…,100)에서는 `floor == ceil` 이라 표준
 * 단계와 정확히 일치한다 — 곡선 스윕은 전부 이 지점에서 돈다.
 *
 * (2026-07-27 ADR-0030 개정 2 로 상한이 `5 × stage` → `5 × (stage-1) + 1` = 밴드 시작으로
 * 내려가 여유가 더 커졌지만, `floor` 규약은 그대로 둔다 — 아래 의미론적 근거가 그대로고
 * 바꾸면 밴드 대표가 아닌 레벨의 표준 세트가 조용히 달라진다.)
 *
 * 의미도 맞다: Lv11 조종사가 입고 있는 장비는 "지금 도전하는 단계3" 이 아니라 "여태 돌던
 * 단계2" 에서 나온 것이다.
 */
export function gearDropStage(level: number): number {
  const lv = Math.max(1, Math.floor(level));
  return Math.max(1, Math.min(STANDARD_BAND_COUNT, Math.floor(lv / LEVEL_PER_STAGE)));
}

// ---------------------------------------------------------------------------
// 밴드별 설계 테이블
// ---------------------------------------------------------------------------

/**
 * 한 밴드의 장비 설계값. `normal + magic + rare + unique === fill` 이 불변식이다.
 *
 * ⚠️ `normal` 은 **항상 0 이다.** PvE 드랍의 등급 바닥은 매직이다 — `rollEliteDrop` 은
 * `magic / rare(25%) / unique(3%)` 만 내고(`src/sim/drops.ts`), `rollBossDrop` 은
 * `rare / unique(15%)` 만 낸다. 즉 **노말 장비는 파밍으로 얻을 수 없다.** 필드를 남겨 둔 것은
 * 불변식 검사와 향후 등급 축 변경에 대비한 자리다.
 */
export interface BandGearDesign {
  /** 8칸 중 채운 칸 수. */
  readonly fill: number;
  readonly normal: number;
  readonly magic: number;
  readonly rare: number;
  readonly unique: number;
}

/**
 * 등급이 정하는 어픽스 개수 — **밴드 축이 아니다**(사용자 결정 2, 2026-07-27).
 *
 * 값은 각 등급의 **롤 상한**이다(`src/items/roll.ts` `affixCountFor`: magic 1\~2 · rare/unique 3\~6).
 * 밴드당 30개가 들어오고 슬롯당 기대 2\~4개가 쌓이므로 플레이어는 같은 등급 안에서 곧바로
 * 최고 롤로 갈아탄다 — 즉 어픽스 개수는 등급이 정해지는 순간 사실상 상한에 붙는다.
 *
 * ⚠️ 어픽스 롤 **값**은 아이템 레벨·단계와 무관하다(`rollAffixes` 가 `data/affixes.ts` 의
 * min/max 를 그대로 쓴다). 그래서 장비 축의 이론 상한은 `8칸 × 6어픽스` 로 고정이고 후반
 * 성장이 유니크 개수에만 남는다. **이 포화는 ADR-0037 이 어픽스 롤을 불가침으로 못박았으므로
 * 이 레인에서 다루지 않는다** — 발견 사실로만 기록하고 별도 레인 큐에 남긴다.
 */
export const AFFIX_BY_RARITY: Readonly<Record<Rarity, number>> = {
  normal: 0,
  magic: 2,
  rare: 6,
  unique: 6,
};

/** 등급이 정하는 어픽스 개수({@link AFFIX_BY_RARITY} 조회). */
export function standardAffixCount(rarity: Rarity): number {
  return AFFIX_BY_RARITY[rarity];
}

// ---------------------------------------------------------------------------
// 유입 산술 상수 (전부 코드에서 파생하거나 ADR 설계값)
// ---------------------------------------------------------------------------

/** 보스 확정 드랍 개수/런 — ADR-0035 §3.2("보스 확정 드랍 1개는 유지한다"). */
const BOSS_DROPS_PER_RUN = 1;
/** 엘리트 기대 드랍 개수/런 — ADR-0035 §3.2 `TARGET_ELITE_DROPS_PER_RUN`. */
const ELITE_DROPS_PER_RUN = 1.5;

/**
 * 최대 롤(6어픽스) 유니크의 비율. `affixCountFor('unique')` = `int(3,6)` 균등이므로 **1/4**.
 * {@link BAND_TABLE} 유도 ⑤ 의 장착 규율에 쓴다.
 */
const MAX_ROLL_UNIQUE_FRACTION = 1 / 4;

/** 슬롯 종류 수(= `SLOT_KINDS.length`). 쿠폰 수집 산술의 분모다. */
const SLOT_KIND_COUNT = 7;

/**
 * 크기 `x` 인 등급 풀이 덮는 **기대 장착 칸 수**(쿠폰 수집).
 *
 * `rollItem` 은 슬롯 7종을 균등히 뽑고(`SLOT_KINDS`), 8칸 중 `module` 이 2칸이다. 따라서
 * `q = 6/7` 일 때
 *
 *     slots(x) = 7·(1 − q^x)  +  (1 − q^x − x·(1/7)·q^(x−1))
 *                └ 7종이 각각 ≥1 개    └ module 이 ≥2 개(두 번째 모듈 칸)
 */
function expectedFilledSlots(x: number): number {
  if (x <= 0) return 0;
  const q = (SLOT_KIND_COUNT - 1) / SLOT_KIND_COUNT;
  const none = Math.pow(q, x);
  const atLeastOne = 1 - none;
  const atLeastTwo = atLeastOne - (x / SLOT_KIND_COUNT) * Math.pow(q, x - 1);
  return Math.min(EQUIP_SLOTS.length, SLOT_KIND_COUNT * atLeastOne + atLeastTwo);
}

/**
 * 밴드 1~20 의 표준 장비 설계표(index 0 = 밴드 1) — **하드코딩이 아니라 코드에서 파생한다**.
 *
 * # 기준: **실제 파밍 산출 근사** (사용자 결정 1, 2026-07-27)
 *
 * ADR-0035 개정이 적은 "밴드마다 채움률·등급·어픽스가 오른다"는 완만한 램프는 **현 아이템
 * 시스템에서 성립하지 않는다**(L1 1차 보고 §6-1). 그래서 이 표는 램프를 버리고 **실제 파밍이
 * 내는 것**을 근사한다. ADR-0037("난이도 곡선은 적 축에서만")과도 이쪽이 정합적이다 —
 * 장비가 전 밴드 평평하면 난이도 곡선 전량을 적 축이 지고, 표준 경로가 실제 플레이어 장비와
 * 어긋나지 않는다.
 *
 * ## ① 밴드당 유입 — **고정 설계 상수** {@link STANDARD_BAND_RUNS}
 * 런당 장비 `1(보스) + 1.5(엘리트) = 2.5`개 × **그 밴드의 런 수**.
 *
 * ⚠️ **이 런 수를 `STANDARD_PROGRESSION_PATH[s-1].runs` 에서 런타임으로 읽지 않는다.**
 * 예전에는 그렇게 했고("Lane A 가 XP 커브를 조정하면 이 표가 자동으로 따라간다"), 그것이
 * **순환 결합**이었다: 경제 상수 → 밴드 런 수 → 장비 유입 → 표준 장비표 → 표준 빌드 파워 →
 * 클리어율·런당 메타 XP → **그게 다시 그 경제 상수의 실측 근거**. 즉 상수를 고치는 행위가
 * 측정 기준자를 함께 움직였다. 2026-07-27 경제 재보정에서 실제로 터졌다 — 상수를 갱신하자
 * 밴드1 이 `M2/R6` → `R8` 로 좋아지며 단계1 클리어율이 **58.3% → 68.8%** 로 뛰었고,
 * 그대로 두면 되먹임이 **진동**한다(밴드1 이 약해지면 E1 이 내려가고, E1 이 내려가면 런 수가
 * 늘어 밴드1 이 다시 강해진다).
 *
 * **측정 기준자는 안정해야 한다.** 그래서 런 수를 여기 명시적 설계 상수로 **고정**하고,
 * 경제 상수와 어긋나면 `tests/standardBuild.test.ts` 가 **큰 소리로 실패**하게 했다.
 *
 * ## ② 등급 분해 — `src/sim/drops.ts` 에서 파생
 * 확률 바닥은 `DEFAULT_DROP_ODDS`(엘리트 rare 0.25 · unique 0.03, 보스 unique 0.15), 단계 배율은
 * `stageRareMult`/`stageUniqueMult` 를 **직접 호출**한다. 상수를 베껴 적지 않으므로 Lane B 가
 * 품질 곡선을 연속화하면 이 표도 자동으로 재유도된다.
 *
 *  - 보스 드랍: `U = bossUniqueBase × uniqMult`, 나머지 전부 **rare**(`rollBossDrop` 은 매직을
 *    내지 않는다).
 *  - 엘리트 드랍: `U = eliteUniqueBase × uniqMult`, `R = eliteRareBase × rareMult`, 나머지 매직.
 *
 * ## ③ 요구 레벨 지연은 **밴드를 미루지 않는다** (2026-07-27 2차 정정)
 * 단계 s 드랍의 요구 레벨은 `min(등급산식, stageLevelCap = 5s)` 이다. 그리고 **밴드 s 의 표준
 * 레벨이 바로 `Lv 5s`** 이므로(ADR-0035 앵커 `기체 Lv ≈ 단계 × 5`, 곡선 스윕 측정점도 Lv 5,10,…,100)
 * `canEquip(5s, item)` = `5s >= min(·, 5s)` = **항상 true** 다. 즉 **밴드 1..s 누적 전량이
 * `Lv 5s` 에서 열린다**:
 *
 *     N(s) = 2.5 × Σ_{t=1..s} runs(t)
 *
 * > ⚠️ 1차 유도는 여기서 한 밴드를 어긋나게 잡아(`N(s) = 30(s−1)`) **밴드 1 = 무장비**라는
 * > 틀린 결론을 냈다. "Lv 5s 이전에는 못 입는다"는 참이지만 측정점이 바로 그 `Lv 5s` 다.
 * > 그리고 그 명제는 **저단계에서만** 참이다 — 등급 산식이 상한보다 낮아지는 지점부터는 밴드
 * > 중간에 열린다(예: 단계 3 상한 15, 매직 2어픽스 = `min(14,15)=14` → Lv14 에 열린다).
 *
 * ## ④ 쿠폰 수집
 * {@link expectedFilledSlots} 참조.
 *
 * ## ⑤ 유니크 장착 규율 (**측정 인프라가 도입한 가정** — 보고 대상)
 * 유니크도 어픽스는 3\~6 롤이라 **어픽스 3개 유니크는 어픽스 6개 레어보다 순수 스탯이 낮다**.
 * 표준 플레이어는 다운그레이드하지 않으므로 **최대 롤(6어픽스) 유니크만** 갈아탄다고 본다
 * → 유효 유니크 = `U(s) × 1/4`({@link MAX_ROLL_UNIQUE_FRACTION}).
 *
 * ⚠️ **이 축은 드랍률 상수에 극도로 민감하다.** 구값(`eliteUniqueBase 0.03` ·
 * `bossUniqueBase 0.15`)에서는 career 기대 유니크가 **83.5개**로 저작 15종의 **5.6배**였고
 * 만렙 표준 빌드가 **8칸 전부 유니크**였다 — 측정이 유니크 효과에 지배당하는 상태였다.
 * 사용자 결정으로 드랍률이 약 1/7.5 로 내려간 뒤(`0.004` / `0.02`)는 career 기대 유니크
 * **약 11개**(저작 15종의 **0.74배**), 만렙 유니크 칸 **2칸**이 된다.
 * 두 값 모두 이 표가 런타임으로 읽는 상수에서 나오므로 **드랍률이 다시 움직이면 표도
 * 따라 움직인다.** 실제 수치는 {@link gearInflowSummary} 로 조회하고, 포화(8칸) 회귀는
 * `tests/standardBuild.test.ts` 가 막는다.
 *
 * ## ⑥ 배정 규칙
 * `unique 칸 = round(slots(U_eff))` → `rare 칸 = round(slots(U+R)) − unique 칸` →
 * `magic 칸 = round(slots(전체)) − round(slots(U+R))`.
 *
 * 결과(현행 코드 기준): **밴드 1 부터 이미 8칸이 차고**(M2/R6), 밴드 2 에서 레어가 8칸을 덮은 뒤
 * **유니크 개수만 완만히** 밀린다. 즉 장비 축은 **전 밴드 사실상 평평**하다.
 * 유니크 칸의 절대값은 드랍률 상수에 달려 있어 여기 적지 않는다 — `standardGearTable()` 로 조회하라.
 *
 * ## ⑦ 노말은 전 밴드 0
 * PvE 드랍의 등급 바닥이 매직이라(위 `BandGearDesign` 주석) **노말은 파밍으로 얻을 수 없다**.
 */
/**
 * 밴드별 표준 런 수 — **측정 기준자의 고정 설계 상수**(순환 결합 차단, 위 ① 참조).
 *
 * ## 출처
 * 2026-07-27 경제 재보정(Lane F)이 수렴시킨 `src/save/progressionPath.ts` 상수
 * (`RUN_META_XP_STAGE1 = 1927` · `RUN_SECONDS_PAR = 95` · `META_XP_BASE = 40` ·
 * `META_XP_SLOPE = 1860` · `RUN_XP_GROWTH_GAIN_PERMILLE = 1000` · `RUN_XP_GROWTH_K = 42`)
 * 에서 `STANDARD_PROGRESSION_PATH[].runs` 로 산출된 값을 그대로 박았다. 총 378.5런.
 *
 * ## 측정 조건
 * - 트리: `git HEAD bc73201` + 2026-07-27 밸런싱 레인 작업트리
 * - 근거 실측: 표준 빌드 · `striker`(typeId 0) · `planet 0` · **96시드** · 상한 18,000틱 ·
 *   `gearSeed` 미고정(런 시드를 장비 시드로)
 * - 상세·수렴 이력: `.omc/research/economy-recalibrated-2026-07-27.md`
 *
 * ## 갱신 규칙
 * 경제 상수를 바꾸면 이 배열이 **자동으로 따라가지 않는다** — 그게 이 상수의 존재 이유다.
 * `tests/standardBuild.test.ts` 의 드리프트 가드가 어긋남을 잡으면, **곡선을 재측정한 뒤**
 * 이 배열을 새 값으로 갱신하고 위 출처 주석도 함께 고쳐라.
 */
export const STANDARD_BAND_RUNS: readonly number[] = [
  14.58, 18.92, 20.05, 20.38, 20.44, 20.38, 20.24, 20.07, 19.89, 19.71,
  19.52, 19.32, 19.15, 18.97, 18.8, 18.63, 18.47, 18.32, 18.18, 14.36,
];

function deriveBandTable(): { table: readonly BandGearDesign[]; inflow: GearInflowSummary } {
  const out: BandGearDesign[] = [];
  let cumUnique = 0;
  let cumRare = 0;
  let cumAll = 0;
  let cumRuns = 0;
  for (let stage = 1; stage <= MAX_STANDARD_STAGE; stage++) {
    // ⚠️ 고정 설계 상수다 — `STANDARD_PROGRESSION_PATH[].runs` 를 읽지 마라(순환 결합).
    const runs = STANDARD_BAND_RUNS[stage - 1] ?? 0;
    const bossItems = runs * BOSS_DROPS_PER_RUN;
    const eliteItems = runs * ELITE_DROPS_PER_RUN;
    const uniqMult = stageUniqueMult(stage);
    const rareMult = stageRareMult(stage);

    const bossUnique = bossItems * DEFAULT_DROP_ODDS.bossUniqueBase * uniqMult;
    const eliteUnique = eliteItems * DEFAULT_DROP_ODDS.eliteUniqueBase * uniqMult;
    const eliteRare = eliteItems * DEFAULT_DROP_ODDS.eliteRareBase * rareMult;
    // `rollBossDrop` 은 유니크가 아니면 **무조건 레어**다(매직을 내지 않는다).
    cumUnique += bossUnique + eliteUnique;
    cumRare += bossItems - bossUnique + eliteRare;
    cumAll += bossItems + eliteItems;
    cumRuns += runs;

    const unique = Math.round(expectedFilledSlots(cumUnique * MAX_ROLL_UNIQUE_FRACTION));
    const rarePlus = Math.round(expectedFilledSlots(cumUnique + cumRare));
    const fill = Math.round(expectedFilledSlots(cumAll));
    out.push({
      fill,
      normal: 0,
      magic: fill - rarePlus,
      rare: rarePlus - unique,
      unique,
    });
  }
  return {
    table: out,
    inflow: { runs: cumRuns, items: cumAll, uniques: cumUnique, rares: cumRare },
  };
}

/**
 * Lv1 → 만렙 **career 전체**의 장비 유입 합계(설계 파생, 실측 아님).
 *
 * `uniques` 를 `data/uniques.ts` 의 저작 종수와 대조하면 **유니크 공급이 콘텐츠 대비 과잉인지**
 * 바로 나온다 — `tests/standardBuild.test.ts` 가 그 비율을 계약으로 못박는다.
 */
export interface GearInflowSummary {
  /** career 총 런 수(= `TOTAL_PROGRESSION_RUNS`). */
  readonly runs: number;
  /** career 총 장비 유입 개수. */
  readonly items: number;
  /** career 기대 유니크 개수. */
  readonly uniques: number;
  /** career 기대 레어 개수. */
  readonly rares: number;
}

const DERIVED = deriveBandTable();
const BAND_TABLE: readonly BandGearDesign[] = DERIVED.table;

/** career 전체 장비 유입 합계(위 {@link GearInflowSummary}). 드랍 상수에서 파생된다. */
export function gearInflowSummary(): GearInflowSummary {
  return DERIVED.inflow;
}

/** 밴드 s(1..20)의 설계값. 범위 밖은 양 끝으로 클램프한다. */
export function bandGearDesign(band: number): BandGearDesign {
  const i = Math.max(1, Math.min(STANDARD_BAND_COUNT, Math.floor(band))) - 1;
  const d = BAND_TABLE[i];
  if (d === undefined) throw new Error(`bandGearDesign: 밴드 ${band} 설계값 없음`);
  return d;
}

/** 설계표 전체(테스트·문서 렌더용). */
export function standardGearTable(): readonly BandGearDesign[] {
  return BAND_TABLE;
}

// ---------------------------------------------------------------------------
// 결정론 시드 파생
// ---------------------------------------------------------------------------

/**
 * SplitMix32 계열 정수 해시. `src/sim/drops.ts` 의 `mix32` 와 같은 철학이다(정수 연산만 —
 * 플랫폼 무관 정확 재현). sim 을 import 하지 않기 위해 여기 인라인으로 둔다.
 */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const SALT_BASE = 0x9e3779b9;
const SALT_SLOT = 0x7f4a7c15;
const SALT_ATTEMPT = 0x2545f491;

/**
 * 시도 상한. `rollItem` 은 슬롯을 **스스로** 고르므로(1/7) 원하는 슬롯이 나올 때까지
 * 결정론적으로 시드를 되풀어 쓴다. 어픽스 개수 일치까지 요구하면 레어 기준 기대 시도는
 * 약 28회(1/7 × 1/4)다. 4096 이면 실패 확률이 사실상 0 이고, 그래도 못 찾으면 설계값이
 * 롤러가 만들 수 없는 조합이라는 뜻이므로 **LOUD-FAIL** 한다(조용한 빈 슬롯 금지).
 */
const MAX_ROLL_ATTEMPTS = 4096;

// ---------------------------------------------------------------------------
// 슬롯 배치
// ---------------------------------------------------------------------------

/**
 * 8칸(`EQUIP_SLOTS`) → 슬롯 종류(`SlotKind`) 대응. 모듈 2칸은 같은 종류(`module`)를 쓴다.
 * `EQUIP_SLOTS` 순서는 계약이다(`src/run/runConfig.ts` `equippedItems` 주석 — 무기/보조
 * 선택이 `find` 라 순서에 의존한다).
 */
const EQUIP_SLOT_KIND: Record<EquipSlotId, SlotKind> = {
  main: 'main',
  sub: 'sub',
  armor: 'armor',
  shield: 'shield',
  engine: 'engine',
  core: 'core',
  module0: 'module',
  module1: 'module',
};

/**
 * 채움 순서 = `EQUIP_SLOTS` 순서. 슬롯 자체는 스탯을 주지 않고 어픽스 합만 능력치가 되므로
 * (`docs/player-power-reference.md` §2-1) 순서는 대부분 무의미하지만 **`main`/`sub` 두 칸만
 * 예외**다(주무기 타입·보조무기 타입이 기본 성능을 정한다). `EQUIP_SLOTS` 는 그 둘을 맨 앞에
 * 두므로, "먼저 채우는 칸이 가장 중요한 칸" 이라는 실제 플레이 순서와도 맞는다.
 */
const FILL_ORDER: readonly EquipSlotId[] = EQUIP_SLOTS;

/** 등급 배정 순서 — 좋은 등급을 앞칸(주무기부터)에 준다. 실제 플레이어의 우선순위다. */
const RARITY_ORDER: readonly Rarity[] = ['unique', 'rare', 'magic', 'normal'];

/** 밴드 설계값을 `FILL_ORDER` 순서의 등급 배열로 펼친다(길이 = fill). */
function rarityPlan(design: BandGearDesign): Rarity[] {
  const counts: Record<Rarity, number> = {
    unique: design.unique,
    rare: design.rare,
    magic: design.magic,
    normal: design.normal,
  };
  const plan: Rarity[] = [];
  for (const r of RARITY_ORDER) for (let i = 0; i < counts[r]; i++) plan.push(r);
  if (plan.length !== design.fill) {
    throw new Error(
      `표준 장비 설계값 불일치: 등급 합 ${plan.length} ≠ fill ${design.fill}. BAND_TABLE 을 확인하라.`,
    );
  }
  return plan;
}

/**
 * 한 칸을 채운다. `rollItem` 이 원하는 슬롯 종류·어픽스 개수를 낼 때까지 시드를 결정론적으로
 * 되풀어 쓰고, 마지막에 **`canEquip` 자기검증**을 통과한 것만 받는다.
 *
 * `usedUniqueIds` 는 이미 배정된 유니크 id 집합이다. **같은 유니크를 두 칸에 꽂으면 안 된다** —
 * `computeLoadoutStats` 가 `uniqueMask` 를 OR 하므로 두 번째 사본은 효과가 중복 적용되지 않고
 * 그 칸이 통째로 낭비된다(모듈 2칸처럼 같은 종류를 두 번 채울 때 실제로 발생한다).
 *
 * ⚠️ 여기서 회피하는 그 결함은 **실제 게임의 장착 경로에도 있었고**, 2026-07-28 에 장착 게이트
 * (`src/items/uniqueEquip.ts` `duplicateUniqueSlot` → 격납고 `equip`)로 막혔다. 조립기는 게이트를
 * 부르지 않고 지금의 "후보를 버리고 다시 굴린다" 방식을 유지한다 — 게이트는 *거부*(사용자에게
 * 사유 표시)가 목적이고 여기는 *조건을 만족하는 롤을 찾는 것*이 목적이라 성격이 다르다. 두 축은
 * 같은 불변식("장착 표에 같은 uniqueId 둘 없음")을 다른 방식으로 지킨다.
 */
function rollForSlot(
  base: number,
  slotIndex: number,
  slot: EquipSlotId,
  rarity: Rarity,
  wantAffix: number,
  level: number,
  usedUniqueIds: Set<string>,
  source: ItemSource,
): Item {
  const wantKind = EQUIP_SLOT_KIND[slot];
  const slotSeed = mix32(base + slotIndex, SALT_SLOT);
  for (let attempt = 0; attempt < MAX_ROLL_ATTEMPTS; attempt++) {
    const dropSeed = mix32(slotSeed + attempt, SALT_ATTEMPT);
    const item = rollItem(dropSeed, rarity, source);
    if (item.slot !== wantKind) continue;
    if (item.affixes.length !== wantAffix) continue;
    // 같은 유니크를 두 번 꽂지 않는다(uniqueMask OR — 두 번째 사본은 칸 낭비다).
    if (item.uniqueId !== undefined && usedUniqueIds.has(item.uniqueId)) continue;
    // 자기검증: 드랍처 상한(stageLevelCap = 5 × stage)이 걸려 있으므로 여기는 **항상** 참이어야
    // 한다. 거짓이면 설계값이나 gearDropStage 가 틀린 것이다(ADR-0035 개정 §합격선).
    if (!canEquip(level, item)) continue;
    if (item.uniqueId !== undefined) usedUniqueIds.add(item.uniqueId);
    return item;
  }
  throw new Error(
    `표준 장비 조립 실패: slot=${slot} rarity=${rarity} affix=${wantAffix} level=${level} ` +
      `stage=${source.stage} — ${MAX_ROLL_ATTEMPTS}회 안에 조건을 만족하는 롤이 없다. ` +
      '밴드 설계값(BAND_TABLE) 또는 gearDropStage 를 확인하라. ' +
      '(유니크 칸이 그 슬롯 종류에 저작된 유니크 개수를 넘으면 여기서 터진다 — ' +
      'data/uniques.ts 의 슬롯별 저작 수를 확인하라.)',
  );
}

/** 한 칸의 조립 결과(칸 id 포함). */
export interface StandardGearEntry {
  readonly slot: EquipSlotId;
  readonly item: Item;
}

/**
 * 표준 장비 세트를 칸 정보와 함께 조립한다. `(level, seed)` 에 대해 완전 결정론.
 *
 * `planet` 은 요구 레벨·어픽스에 영향을 주지 않지만(`stageLevelCap` 은 단계 축 단독 —
 * `requiredLevel.ts` 주석) `ItemSource` 가 요구하므로 기본 0(카르곤)을 스탬프한다.
 */
export function standardGearEntries(level: number, seed: number, planet = 0): StandardGearEntry[] {
  return standardGearSetForBand(level, seed, standardBand(level), planet).entries;
}

/**
 * 임의 밴드 설계를 임의 레벨에 얹어 조립한다(**감도 분석용**). 정규 경로는
 * {@link standardGearEntries} 이고 이 함수는 `band === standardBand(level)` 일 때 그것과 동일하다.
 *
 * 예: `standardGearSetForBand(5, seed, 20)` = Lv5 에 만렙 설계를 얹는다. 단계1 드랍은 등급
 * 무관 요구 레벨 5 라 실제로 착용 가능하므로, "밴드 1 무장비" 가정이 곡선을 얼마나 움직이는지
 * 상한을 잴 수 있다.
 */
export function standardGearSetForBand(
  level: number,
  seed: number,
  band: number,
  planet = 0,
): { entries: StandardGearEntry[]; design: BandGearDesign } {
  const lv = Math.max(1, Math.floor(level));
  const design = bandGearDesign(band);
  // Lv < 5 는 **입을 수 있는 장비가 존재하지 않는다**: 파밍 드랍의 등급 바닥이 매직이고
  // (요구 레벨 산식 바닥 10), 드랍처 상한이 `5 × 단계` 라 단계1 드랍은 등급과 무관하게 전부
  // 요구 레벨 5 로 수렴한다. 그래서 빈 세트가 정답이다(조용한 미착용이 아니라 산술의 귀결).
  // ⚠️ 이 경계는 **Lv 5 미만에서만** 걸린다 — 표준 레벨 Lv 5s 는 그 자체가 상한 5s 와 같아
  // `canEquip(5s, ·)` 이 항상 참이다(BAND_TABLE 유도 ③). 밴드 1 의 표준 레벨 Lv5 는 통과한다.
  if (lv < LEVEL_PER_STAGE) return { entries: [], design };
  const plan = rarityPlan(design);
  const source: ItemSource = { planet, stage: gearDropStage(lv) };
  const base = mix32((seed >>> 0) ^ Math.imul(lv, 0x01000193), SALT_BASE);

  const out: StandardGearEntry[] = [];
  const usedUniqueIds = new Set<string>();
  for (let i = 0; i < plan.length; i++) {
    const slot = FILL_ORDER[i];
    const rarity = plan[i];
    if (slot === undefined || rarity === undefined) break;
    const item = rollForSlot(
      base,
      i,
      slot,
      rarity,
      standardAffixCount(rarity),
      lv,
      usedUniqueIds,
      source,
    );
    out.push({ slot, item });
  }
  return { entries: out, design };
}

/**
 * 표준 장비 세트(ADR-0035 개정 L1의 정본 진입점). 반환 배열은 **`EQUIP_SLOTS` 순서**라
 * `computeLoadoutStats` 의 무기/보조 `find` 계약을 그대로 만족한다.
 */
export function standardGearSet(level: number, seed: number, planet = 0): Item[] {
  return standardGearEntries(level, seed, planet).map((e) => e.item);
}

/** 조립 결과를 `Ship.equipped` 모양(칸 id → 아이템)으로 접는다. */
export function equippedFromEntries(
  entries: readonly StandardGearEntry[],
): Partial<Record<EquipSlotId, Item>> {
  const out: Partial<Record<EquipSlotId, Item>> = {};
  for (const e of entries) out[e.slot] = e.item;
  return out;
}

/** 표준 장비 세트를 `Ship.equipped` 모양(칸 id → 아이템)으로 조립한다. */
export function standardEquipped(
  level: number,
  seed: number,
  planet = 0,
): Partial<Record<EquipSlotId, Item>> {
  return equippedFromEntries(standardGearEntries(level, seed, planet));
}

// ---------------------------------------------------------------------------
// 표준 스킬 투자
// ---------------------------------------------------------------------------

/**
 * flat `skillInvest` 벡터를 만든다. 트리별로 base 노드를 앞에서부터 `maxPoints` 까지 채우고,
 * 계열 투자가 `capstoneGate` 이상이면 그 트리 캡스톤에 1점.
 *
 * ⚠️ `flattenShipNodes` 로 얻은 인덱스를 그대로 쓴다 — 트리 배열을 concat 하면 안 된다
 * (레이아웃 `[트리0 base][트리1 base][트리2 base][캡스톤 3]` 이 해시 계약이다).
 *
 * (M8 `rosterBench.ts` 에서 옮겨왔다. 매트릭스 모드와 곡선 모드가 **같은 배분 함수**를 쓰게
 * 해서 두 측정이 비교 가능하도록 유지한다.)
 */
export function investVector(typeId: number, perTree: readonly number[]): number[] {
  const def = shipTypeDef(typeId);
  const v = zeroSkillInvest(typeId);
  const nodes = flattenShipNodes(def);
  for (let t = 0; t < def.trees.length; t++) {
    let rest = perTree[t] ?? 0;
    if (rest <= 0) continue;
    const spent = rest;
    const { start, end } = shipTreeRange(def, t);
    for (let i = start; i < end && rest > 0; i++) {
      const node = nodes[i];
      if (node === undefined) break;
      const put = Math.min(node.maxPoints, rest);
      v[i] = put;
      rest -= put;
    }
    if (spent >= def.capstoneGate) v[shipCapstoneIndex(def, t)] = 1;
  }
  return v;
}

/**
 * 표준 투자 예산. 스킬 포인트는 **레벨업 1회당 1점**(`src/save/settlement.ts` `settleRun`)
 * 이므로 Lv L 의 누적 예산은 `L - 1` 점이다. 레벨 캡 100 → 최대 99점.
 */
export function standardSkillBudget(level: number): number {
  const lv = Math.max(1, Math.floor(level));
  return Math.max(0, Math.min(99, lv - 1));
}

/**
 * 표준 투자 배분 비율. `rosterBench.ts` 의 P2(만렙 99점 = 45/27/27)를 기준으로 삼는다 —
 * 공격 계열 45pt 는 `capstoneGate`(40, 해츨링 44)를 전 기체에서 넘겨 캡스톤이 실제로 붙는
 * 유일한 배분이고, 만렙 표준 빌드는 그 상태여야 한다.
 */
const STANDARD_RATIO: readonly [number, number, number] = [45, 27, 27];
const STANDARD_RATIO_TOTAL = 99;

/**
 * 레벨에서 파생한 표준 투자 벡터. 총점은 `standardSkillBudget(level)` 이고 배분은
 * {@link STANDARD_RATIO} 비례다.
 *
 * 나머지 점수는 **공격 계열(트리 0)에 몰아준다** — `floor` 로 유틸/방어를 먼저 확정하고 남은
 * 전량을 공격에 주므로 Lv100 에서 정확히 45/27/27 이 되고(P2 와 바이트 동일), 중간 레벨에서도
 * "공격 우선" 성격이 유지된다.
 *
 * ⚠️ 화력 계열 30pt 부근에서 `rangeFlat` 노드가 붙어 `weapon.range` 가 커진다. 파생
 * `weapon.range` 를 측정 산출물에 **반드시 함께 기록**해 오염 여부를 사후 검증할 수 있게 한다
 * (`rosterBench.ts` 곡선 모드의 `range` 열).
 */
export function standardPerTree(level: number): [number, number, number] {
  const budget = standardSkillBudget(level);
  const t1 = Math.floor((budget * STANDARD_RATIO[1]) / STANDARD_RATIO_TOTAL);
  const t2 = Math.floor((budget * STANDARD_RATIO[2]) / STANDARD_RATIO_TOTAL);
  return [budget - t1 - t2, t1, t2];
}

/** 표준 투자 벡터(기체 타입별 노드 레이아웃 준수). */
export function standardSkillInvest(typeId: number, level: number): number[] {
  return investVector(typeId, standardPerTree(level));
}
