/**
 * 슬롯별 어픽스 풀 (ADR-0049 · `.omc/plans/skill-rebuild-2026-08-05/affixes.md` ②③).
 *
 * 이 파일이 정하는 것은 **"어느 슬롯에서 어떤 어픽스가 어떤 가중으로 나오는가"** 하나뿐이다.
 * 순수 함수만 있고 RNG 를 만지지 않는다 — 추첨은 `roll.ts`(드랍)·`refiningChain.ts`(정련)의
 * 소관이고, 이 파일은 그 둘에게 **같은 풀**을 주는 단일 소스다. 둘이 다른 풀을 보면
 * "정련하면 이 슬롯에 없는 어픽스가 붙는다"가 되어 재편 자체가 무의미해진다.
 *
 * ## 풀이 하나가 아니라 셋이다 (③-1)
 *
 * | 풀 | 구성 | 언제 도는가 |
 * |---|---|---|
 * | **드랍(전체)** | base-24 + 스킬 어픽스 2 | rare·unique **이고** `stage ≥ 9` 인 드랍 |
 * | **정련·저단계(base-24)** | base-24 만 | **정련 전량** + magic 전체 + normal + `stage < 9` |
 * | 모듈 | base-17 | module 슬롯(스킬 어픽스가 애초에 없다) |
 *
 * ⚠️ **하한 판정을 드랍 풀로만 하지 마라.** 설계 2판이 그 실수를 했다 — 정련 수렴·무한
 * 싱크 기준(③-1 B·D)은 **정련 풀(base-24)** 의 기준이고, 게임 대부분의 구간(magic 전체 ·
 * `stage < 9`)이 그쪽 풀로 돈다. `tests/affixPool.test.ts` 가 **두 풀 모두**를 검사한다.
 *
 * ## 하한 (`tests/affixPool.test.ts` 가 기계로 검사한다)
 *
 * - **raw ≥ 6 (하드)** — `roll.ts` 의 `n = min(count, pool.length)` 는 splice 루프의 **실재
 *   항목 수**만 본다(가중 무관). 풀 < 6 이면 그 슬롯만 어픽스가 잘려 `requiredLevel`·
 *   `itemCombatPower` 가 함께 낮아진다.
 * - **N_eff ≥ 9 (하드)** — `N_eff = 1 / Σpᵢ²`(역 Simpson). "체감상 몇 종짜리 풀인가"다.
 *   9 아래로 가면 정련이 무한 싱크에서 이탈한다(원하는 3종 동시 적중이 5% 를 넘는다).
 * - N_eff ≥ 12 (목표) — **산술적 상한이라 여유 있는 슬롯에서만 달성된다.** `N_eff ≤ raw`
 *   이고 등호는 균등 풀에서만 성립하니, 목표를 전 슬롯에 강제하면 가중이 평평해져
 *   **정체성이 사라진다.** 정체성과 실효 풀은 같은 예산을 다툰다.
 */

import {
  AFFIXES,
  SKILL_AFFIXES,
  SKILL_AFFIX_IDS,
  SKILL_AFFIX_SIBLINGS,
  affixSlotWeight,
} from '../../data/affixes.js';
import type { AffixDef, Rarity, SlotKind } from './types.js';

/**
 * 스킬 어픽스가 드랍 롤에 들어가기 시작하는 최소 단계. 📝 밸런스 튜닝 대상.
 *
 * ## 왜 9 인가 — 세 값의 **의미**가 다르다 (①-7)
 * `stageLevelCap(s) = 5(s−1) + 1` 이라 rare 의 기본 요구 레벨(41~50)이 단계 상한에 눌린다.
 * - **6**: 사실상 하한 없음(상한 26 이라 rare 가 등급 서열대로 비싸지지도 않는 구간).
 * - **9**: 상한 41 — 등급 서열이 상한에 **눌리지 않기 시작하는 첫 단계**. ← 채택
 * - **11**: 상한 51 — 6어픽스 rare(50)까지 **전액** 서열이 복원되는 시점(더 엄격).
 *
 * 밸런스 레인이 숫자가 아니라 **의미**를 보고 고르도록 셋을 다 적어 둔다.
 *
 * ⚠️ 하한의 사유는 **파밍 동기 배치 하나뿐**이다. 1판이 근거로 든 요구 레벨 가산은
 * 철회됐다(①-8 — `requiredLevel` 이 `min(stageLevelCap, ownerLevelCap)` 을 씌워
 * 실효 무연산이었다).
 *
 * 📌 daily-reward 는 `dailyGearSource(lv)` 가 `stage = floor((lv−1)/5) + 2` 를 쓰므로
 * **Lv36 이상**에서만 스킬 어픽스가 나온다. 추가 배선은 불요이나 그 값이 의도인지는
 * 밸런스 레인의 승인 항목이다.
 */
export const SKILL_AFFIX_MIN_STAGE = 9;

/**
 * 스킬 어픽스가 슬롯 풀 가중에서 차지하는 목표 지분과 그 내부 배분(①-6).
 *
 * 상수 가중을 박지 않고 **슬롯 총량에서 비율로 파생**한다 — 슬롯별 기저 가중 총합이
 * 58~127 로 2.2배 차이라, 상수를 박으면 등장률이 슬롯마다 갈린다.
 *
 * `adept(+1) = round(W_base × 0.08)` · `master(+2) = round(W_base × 0.02)`
 * → 합 0.10 이 기저 1.00 위에 얹히므로 풀 지분은 **0.10 / 1.10 = 9.1%**.
 *
 * ⚠️ **드리프트 둘은 알려진 것이고 감수한다**: ①`round` 방향 때문에 실제 풀 지분이
 * 8.2~9.6% 로 흔들린다(최저 engine) — 다만 축 단위 기대는 0.92~0.95 로 3% 차라 거의
 * 사라진다. ②`+2` 지분이 17~23%(목표 20%). 정밀히 맞추려면 가중을 basis-point 로
 * 올리면 되고, 가중 draw 가 `rng.int(0, total-1)` **1회**라 자릿수가 늘어도 RNG
 * 스트림은 불변이다.
 */
const SKILL_AFFIX_SHARE = { plusOne: 0.08, plusTwo: 0.02 } as const;

/** 스킬 어픽스인가(id 기준 — `stat` 으로 판정하지 마라, 새 stat 이 생기면 조용히 갈린다). */
export function isSkillAffix(d: AffixDef): boolean {
  return SKILL_AFFIX_IDS.has(d.id);
}

/**
 * id 로 판정하는 형태. 굴려진 어픽스(`AffixRoll` — `{id, stat, value}`)는 `AffixDef` 가
 * 아니라 def 를 되찾지 않고는 {@link isSkillAffix} 를 못 쓴다. 저장된 아이템을 훑는
 * 자리(정련 상태기계·UI 행)는 전부 이쪽을 쓴다.
 */
export function isSkillAffixId(id: string): boolean {
  return SKILL_AFFIX_IDS.has(id);
}

/** 같은 축의 형제 스킬 어픽스 id(+1 ↔ +2). 스킬 어픽스가 아니면 `undefined`. */
export function skillAffixSibling(id: string): string | undefined {
  return SKILL_AFFIX_SIBLINGS.get(id);
}

/** 아이템이 실은 스킬 어픽스 개수(정련의 `rerollable` 분모가 이것을 뺀다 — ①-9). */
export function skillAffixCount(affixes: readonly { readonly id: string }[]): number {
  let n = 0;
  for (const a of affixes) if (SKILL_AFFIX_IDS.has(a.id)) n++;
  return n;
}

/** 한 슬롯의 기저 가중 총합 `W_base`(스킬 어픽스 제외). 파생 가중의 분모다. */
function baseWeightTotal(slot: SlotKind): number {
  let sum = 0;
  for (const d of AFFIXES) sum += affixSlotWeight(d, slot);
  return sum;
}

/** 슬롯당 1회만 계산하면 되는 값이라 모듈 수명 동안 캐시한다(순수 — 입력이 상수 테이블). */
const BASE_TOTAL_CACHE = new Map<SlotKind, number>();

function baseTotal(slot: SlotKind): number {
  const hit = BASE_TOTAL_CACHE.get(slot);
  if (hit !== undefined) return hit;
  const v = baseWeightTotal(slot);
  BASE_TOTAL_CACHE.set(slot, v);
  return v;
}

/**
 * 스킬 어픽스 하나의 파생 가중. 담당 슬롯이 아니면(마스크 0) 0.
 *
 * `max === 2` 가 곧 "+2 어픽스"라는 판정 기준이다 — `min === max` 인 퇴화 범위라 값이
 * 정체성을 그대로 담는다.
 */
function skillAffixWeight(d: AffixDef, slot: SlotKind): number {
  if (affixSlotWeight(d, slot) <= 0) return 0;
  const share = d.max >= 2 ? SKILL_AFFIX_SHARE.plusTwo : SKILL_AFFIX_SHARE.plusOne;
  return Math.round(baseTotal(slot) * share);
}

/**
 * 어픽스 하나가 이 슬롯에서 갖는 **실효 가중**. 기저 24종은 테이블 값 그대로, 스킬
 * 어픽스는 슬롯 총량에서 파생한 값이다. 0 이면 풀에 안 들어간다.
 */
export function affixWeightFor(d: AffixDef, slot: SlotKind): number {
  return isSkillAffix(d) ? skillAffixWeight(d, slot) : affixSlotWeight(d, slot);
}

/** `affixPoolFor` 의 반환 — def 와 그 실효 가중을 짝지어 준다(가중 draw 가 그대로 쓴다). */
export interface AffixPoolEntry {
  readonly def: AffixDef;
  readonly weight: number;
}

/**
 * 이 슬롯·등급·단계에서 뽑힐 수 있는 어픽스 전량과 그 가중.
 *
 * 순수 함수 — 같은 입력에 같은 배열(원소 순서는 `AFFIXES` → `SKILL_AFFIXES` 선언 순서로
 * **안정**하다. 순서가 흔들리면 같은 시드가 다른 어픽스를 뽑는다).
 *
 * @param slot   아이템 슬롯. `module` 은 스킬 어픽스를 영영 못 받는다(①-3).
 * @param rarity `rare`·`unique` 만 스킬 어픽스를 받는다. `affixCountFor` 가 두 등급에
 *               같은 3~6 범위를 주므로 유니크도 같은 확률이다 — 유니크가 최상위 파밍
 *               목표라는 위치와 정합한다.
 * @param stage  드랍 출처 단계. `SKILL_AFFIX_MIN_STAGE` 미만이면 스킬 어픽스가 빠진다.
 *               ⚠️ 손으로 빚은 `Item`(하네스·벤치)은 `stage` 가 임의값이다.
 */
export function affixPoolFor(slot: SlotKind, rarity: Rarity, stage: number): AffixPoolEntry[] {
  const out: AffixPoolEntry[] = [];
  for (const d of AFFIXES) {
    const wt = affixSlotWeight(d, slot);
    if (wt > 0) out.push({ def: d, weight: wt });
  }
  if (!skillAffixesAllowed(rarity, stage)) return out;
  for (const d of SKILL_AFFIXES) {
    const wt = skillAffixWeight(d, slot);
    if (wt > 0) out.push({ def: d, weight: wt });
  }
  return out;
}

/** 스킬 어픽스가 이 등급·단계에서 롤에 들어가는가(①-2 · ①-7). */
export function skillAffixesAllowed(rarity: Rarity, stage: number): boolean {
  if (rarity !== 'rare' && rarity !== 'unique') return false;
  return Number.isFinite(stage) && stage >= SKILL_AFFIX_MIN_STAGE;
}

/**
 * **정련 전용 풀** — base-24 만. 스킬 어픽스는 드랍 롤에서만 나온다: 정련으로 얻을 수도,
 * 잃을 수도 없다(①-9).
 *
 * 근거 셋: ①전투력 점수 불변식(⑤-3) ②정련이 **가치 최적화기**로 남고 **정체성 로또**가
 * 되지 않는다 ③ADR 이 "엔드게임 **파밍** 동기"라 썼지 "크래프팅 동기"라 쓰지 않았다.
 *
 * 등급·단계를 안 받는다 — 정련은 등급을 안 바꾸고, 어느 등급이든 base-24 로 돈다.
 */
export function refinePoolFor(slot: SlotKind): AffixPoolEntry[] {
  const out: AffixPoolEntry[] = [];
  for (const d of AFFIXES) {
    const wt = affixSlotWeight(d, slot);
    if (wt > 0) out.push({ def: d, weight: wt });
  }
  return out;
}

/**
 * 실효 종수 `N_eff = 1 / Σpᵢ²`(역 Simpson 지수). 균등 풀이면 `raw` 와 같고, 쏠릴수록
 * 작아진다. 하한 검사(`tests/affixPool.test.ts`)와 문서 표가 같은 함수를 쓴다 —
 * **지표를 두 번 구현하면 문서와 코드가 갈린다.**
 */
export function effectivePoolSize(pool: readonly AffixPoolEntry[]): number {
  let total = 0;
  for (const e of pool) total += e.weight;
  if (total <= 0) return 0;
  let sumSq = 0;
  for (const e of pool) {
    const p = e.weight / total;
    sumSq += p * p;
  }
  return sumSq > 0 ? 1 / sumSq : 0;
}

/**
 * 집중 배율 = (상위 3어픽스 가중 점유) / (3 / raw) — "가장 자주 나오는 3개가 균등 풀
 * 이었을 때보다 몇 배 자주 나오는가."
 *
 * ⚠️ **드랍 풀(`rawR`) 위에서 재라.** 설계서 ③-3 의 표가 그 분모로 쓰였다 — 정련 풀로
 * 재면 분모가 2 작아져 armor 2.40 이 2.33 으로, engine 2.47 이 2.39 로 어긋난다.
 *
 * 정체성 지표를 **절대 점유율에서 이것으로 바꾼 것**이 2판의 핵심 정정이다. 1판의
 * "주제 stat 점유 ≥ 50%"는 실효 풀을 무너뜨린 대가로 산 수치였다(armor 70% ↔ N_eff 5.7).
 * 사용자가 체감하는 것은 절대 점유율이 아니라 **균등 대비 편차**다.
 */
export function concentrationRatio(pool: readonly AffixPoolEntry[]): number {
  const raw = pool.length;
  if (raw <= 0) return 0;
  let total = 0;
  for (const e of pool) total += e.weight;
  if (total <= 0) return 0;
  const top3 = pool
    .map((e) => e.weight)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((a, b) => a + b, 0);
  return top3 / total / (Math.min(3, raw) / raw);
}
