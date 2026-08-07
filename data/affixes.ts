/**
 * Affix pool — 기본 24종 + ADR-0049 스킬 어픽스 6종.
 *
 * 12 prefixes (offence, 원소 3종 포함) + 12 suffixes (utility / survival) = 24. M2는
 * 원소 3종을 뺀 21종으로 시작했고, M3에서 원소 프리픽스(화염·냉기·전격)를 상태이상
 * 시스템(src/sim/status.ts)과 함께 투입해 24종을 완성한다.
 *
 * Data only: each affix names a `StatKey` the loadout pipeline (src/items/
 * loadout.ts) sums into a derived modifier, plus an inclusive integer roll range
 * [min, max]. Percent stats store the integer percent (10 = +10%); flat stats
 * store the absolute add. 원소 프리픽스는 명중 시 상태이상을 거는 강도를 정수로 담는다
 * (fireDmg = 틱당 피해, coldSlow = 감속 강도, lightning = 연쇄 피해). Balance numbers
 * are first-pass tuning (spec §5), expected to move during the fun-gate loop.
 *
 * ## 슬롯 가중 (ADR-0049 · affixes.md ②)
 *
 * 각 def 는 7 `SlotKind` 에 대한 **정수 가중**을 싣는다. 0 = 그 슬롯에서 안 나온다.
 * 척도는 `0 금지 / 2 원거리 / 3 주변 / 5 인접 / 8 준주제 / 10 주제`(②-0) — 1판의
 * `12/4/1` 급경사가 실효 풀(N_eff)을 무너뜨려 2판이 최대:최소를 **5:1** 로 완만하게
 * 깔았다. **정체성과 실효 풀은 같은 예산을 다툰다**(③-1).
 *
 * ⚠️ **배타 분할이 아니라 가중이다.** stat 분포가 `화력 12 : 방어 3 : 기동 3 : 메타 6`
 * 으로 편중돼 있어 주제만으로 자르면 장갑·실드·기관 풀이 3종이 되고, `roll.ts` 의
 * `n = min(count, pool.length)` 가 어픽스 개수를 잘라 그 슬롯만 구조적으로 싸고
 * 약해진다(`requiredLevel`·`itemCombatPower` 가 둘 다 개수 파생).
 *
 * ⚠️ **가중을 뾰족하게 만들기 전에 `tests/affixPool.test.ts` 를 보라.** 그 파일이 raw ≥ 6
 * (하드) · N_eff ≥ 9(하드)를 두 풀 모두에 대해 검사한다. 최저는 **armor N_eff 10.06**
 * 이라 여유가 1.06 뿐이다 — **armor 가중은 이 표에서 조정 여지가 가장 없는 자리다.**
 */

import type { AffixDef, SlotKind, SlotWeights, StatKey } from '../src/items/types.js';

/**
 * 가중 튜플 → `SlotWeights`. 순서는 `SLOT_KINDS`(main·sub·armor·shield·engine·core·module)
 * 와 같고, `tests/affixPool.test.ts` 가 그 정합을 검사한다(순서를 손으로 맞추지 마라).
 */
type W7 = readonly [number, number, number, number, number, number, number];

function w(t: W7): SlotWeights {
  return { main: t[0], sub: t[1], armor: t[2], shield: t[3], engine: t[4], core: t[5], module: t[6] };
}

function def(
  id: string,
  name: string,
  kind: 'prefix' | 'suffix',
  stat: StatKey,
  min: number,
  max: number,
  weights: W7,
): AffixDef {
  return { id, name, kind, stat, min, max, weights: w(weights) };
}

/** 12 offence prefixes (원소 3종 포함).
 *
 *  규칙 A(②-0) — 무기 프리픽스는 비무기 4슬롯(armor·shield·engine·core)에서 원칙 금지.
 *  예외 6종: `velocity`(추진=기관) · `ranging`(관측=코어) · `sharp`(코어 원거리 2) ·
 *  **원소 3종은 원거리 2**(실효 풀을 올린다). module 은 규칙 A 가 아니라 규칙 C 가 정한다.
 */
export const PREFIXES: readonly AffixDef[] = [
  //                                                        main sub arm shl eng cor mod
  def('sharp', '예리한', 'prefix', 'damagePct', 5, 10, [10, 8, 0, 0, 0, 2, 5]),
  def('brutal', '잔혹한', 'prefix', 'damagePct', 11, 20, [10, 8, 0, 0, 0, 0, 5]),
  def('deadly', '치명적인', 'prefix', 'damagePct', 21, 35, [10, 0, 0, 0, 0, 0, 0]),
  def('multibarrel', '다연장의', 'prefix', 'bulletCount', 1, 1, [8, 10, 0, 0, 0, 0, 5]),
  def('piercing', '관통의', 'prefix', 'pierce', 1, 1, [8, 8, 0, 0, 0, 0, 5]),
  def('rapid', '속사의', 'prefix', 'fireRatePct', 6, 12, [10, 10, 0, 0, 0, 0, 5]),
  def('overclocked', '과부하된', 'prefix', 'fireRatePct', 13, 22, [8, 8, 0, 0, 0, 0, 0]),
  def('velocity', '고속의', 'prefix', 'bulletSpeedPct', 8, 18, [10, 8, 0, 0, 5, 2, 5]),
  def('ranging', '장거리의', 'prefix', 'rangeFlat', 120, 360, [10, 5, 0, 0, 0, 8, 5]),
  // 원소 3종(M3, 상태이상): 화염=지속피해, 냉기=감속, 전격=연쇄.
  //   화염(fireDmg)·전격(lightning)은 값이 곧 강도(틱당 피해 / 연쇄 피해)라 범위가 의미
  //   있다. 냉기(coldSlow)는 **의도적 불리언 게이트**: 감속 배율·지속은 전역 상수
  //   (status.ts COLD_SLOW_MULT / COLD_DURATION)로 고정이고, 소비부(world.ts
  //   resolveCollisions)는 `coldSlow > 0` 여부만 본다 → 값 자체는 켜짐 표식(1)이다.
  //   그래서 min=max=1로 고정한다(퇴화가 아니라 플래그 — 리뷰 LOW). 냉기를 강도화하려면
  //   COLD_* 상수를 티어로 바꾸고 applySlow 소비부를 함께 고쳐야 하며, 그때 이 범위를 넓힌다.
  // ⚠️ 원소는 무기 2슬롯에서 **주제(10)** 다 — 재편이 무기 원소 기대를 +69~97% 올린다
  //    (affixes.md ⑤-6 실측). 아크캐스터 CH2·스트라이커 F6 은 그 상향을 이미 받았으므로
  //    **그 위에 또 수치를 올리지 마라**(이중 상향).
  def('flaming', '작열의', 'prefix', 'fireDmg', 2, 5, [10, 10, 2, 2, 2, 2, 5]),
  def('freezing', '빙결의', 'prefix', 'coldSlow', 1, 1, [10, 10, 2, 2, 2, 2, 5]),
  def('shocking', '방전의', 'prefix', 'lightning', 4, 10, [10, 10, 2, 2, 2, 2, 5]),
];

/** 12 utility / survival suffixes.
 *
 *  규칙 B(②-0) — 서픽스 12종은 비무기 4슬롯에서 **최소 가중 2**. 풀 크기 하한의 구조적
 *  보장이다(이 규칙이 없으면 armor·shield 의 raw 가 6 아래로 떨어진다).
 */
export const SUFFIXES: readonly AffixDef[] = [
  //                                                             main sub arm shl eng cor mod
  def('of-vitality', '활력의', 'suffix', 'maxHpFlat', 10, 25, [3, 2, 10, 5, 3, 3, 5]),
  def('of-fortitude', '견고함의', 'suffix', 'maxHpFlat', 26, 50, [2, 0, 10, 5, 2, 2, 0]),
  def('of-warding', '보호의', 'suffix', 'maxHpPct', 4, 9, [2, 0, 8, 10, 3, 3, 5]),
  def('of-swiftness', '신속의', 'suffix', 'moveSpeedPct', 4, 9, [2, 2, 5, 3, 10, 3, 5]),
  def('of-celerity', '민첩의', 'suffix', 'moveSpeedPct', 10, 16, [0, 0, 3, 3, 10, 2, 0]),
  def('of-the-dash', '도약의', 'suffix', 'dashCdPct', 6, 14, [0, 2, 3, 8, 10, 3, 5]),
  def('of-magnetism', '자력의', 'suffix', 'magnetPct', 8, 20, [2, 2, 3, 3, 5, 10, 5]),
  def('of-greed', '탐욕의', 'suffix', 'magnetPct', 21, 40, [0, 0, 2, 2, 3, 10, 0]),
  def('of-learning', '학습의', 'suffix', 'xpPct', 5, 12, [2, 2, 3, 5, 3, 10, 5]),
  def('of-wisdom', '지혜의', 'suffix', 'xpPct', 13, 25, [0, 0, 2, 3, 2, 10, 0]),
  def('of-prospecting', '탐광의', 'suffix', 'mineralFindPct', 10, 25, [0, 2, 3, 3, 3, 10, 5]),
  def('of-fortune', '행운의', 'suffix', 'mineralFindPct', 26, 50, [0, 0, 2, 2, 2, 10, 0]),
];

/**
 * 기본 24종 풀(프리픽스 → 서픽스). **정련이 실제로 쓰는 풀이 이것**이고(스킬 어픽스는
 * 정련 풀에서 영구 제외 — affixes.md ①-9), magic·normal 등급과 `stage < 9` 드랍도 전부
 * 이 풀로 돈다. 즉 **게임 대부분의 구간이 base-24 다.**
 */
export const AFFIXES: readonly AffixDef[] = [...PREFIXES, ...SUFFIXES];

/**
 * ADR-0049 스킬 어픽스 6종 — 축 단위 +N 레벨(affixes.md ①-2).
 *
 * ## 왜 module 가중이 전부 0 인가
 * module 은 칸이 둘(`module0`/`module1`)인데 `SlotKind` 는 하나라, 한 축이 4칸을 받게
 * 되어 **상한이 축마다 어긋난다**(①-3). 그래서 module 은 스킬 어픽스를 아예 안 받는다.
 *
 * ## 축당 상한 +4 는 확률이 아니라 구조다
 * 한 축을 받는 슬롯 **정확히 2칸** × 장비당 스킬 어픽스 **최대 1개** × 한 개의 최대값
 * **+2** = **+4**. 가중이 정하는 것은 그 안의 기대값뿐이고(축당 평상값 ≈ +1), 상한은
 * 슬롯 배치가 이미 증명한다.
 *
 * ## `min === max` 인 이유
 * `multibarrel`·`piercing`·`freezing` 과 같은 퇴화 범위다. `reforgeAffixes` 의 밴드
 * 산식(`lo = min + round((max-min)×band)`)이 자연히 `lo === max` 로 떨어져 노 출력이
 * 무의미하다 — 어차피 정련 재추첨 대상이 아니다(①-9).
 *
 * ⚠️ **가중은 여기서 상수로 박지 않는다.** 슬롯마다 기저 가중 총합이 58~127 로 2.2배
 * 차이라 상수를 박으면 등장률이 슬롯마다 갈린다. `affixPool.ts` 의 `SKILL_AFFIX_SHARE`
 * 가 슬롯 총량에서 비율로 파생한다(①-6) — 그래서 이 배열의 `weights` 는 **"어느 슬롯이
 * 이 축을 담당하는가"의 마스크**이고, 실제 가중은 파생값이 덮는다.
 */
export const SKILL_AFFIXES: readonly AffixDef[] = [
  //                                                                  main sub arm shl eng cor mod
  def('of-honing', '단련의', 'suffix', 'skillLvOffense', 1, 1, [1, 1, 0, 0, 0, 0, 0]),
  def('of-the-apex', '정점의', 'suffix', 'skillLvOffense', 2, 2, [1, 1, 0, 0, 0, 0, 0]),
  def('of-tenacity', '불굴의', 'suffix', 'skillLvDefense', 1, 1, [0, 0, 1, 1, 0, 0, 0]),
  def('of-the-unbroken', '불괴의', 'suffix', 'skillLvDefense', 2, 2, [0, 0, 1, 1, 0, 0, 0]),
  def('of-discernment', '통찰의', 'suffix', 'skillLvUtility', 1, 1, [0, 0, 0, 0, 1, 1, 0]),
  def('of-the-adept', '달인의', 'suffix', 'skillLvUtility', 2, 2, [0, 0, 0, 0, 1, 1, 0]),
];

/**
 * 스킬 어픽스의 **형제 쌍** — 같은 축의 (+1, +2) 두 def. 드랍 롤이 하나를 뽑으면 형제도
 * 함께 풀에서 빠져야 "장비당 스킬 어픽스 최대 1개"(①-3)가 선다.
 */
export const SKILL_AFFIX_SIBLINGS: ReadonlyMap<string, string> = new Map([
  ['of-honing', 'of-the-apex'],
  ['of-the-apex', 'of-honing'],
  ['of-tenacity', 'of-the-unbroken'],
  ['of-the-unbroken', 'of-tenacity'],
  ['of-discernment', 'of-the-adept'],
  ['of-the-adept', 'of-discernment'],
]);

/** 스킬 어픽스 id 집합 — `isSkillAffix` 의 정본 소스(`affixPool.ts` 가 감싼다). */
export const SKILL_AFFIX_IDS: ReadonlySet<string> = new Set(SKILL_AFFIXES.map((a) => a.id));

/** 기본 24종 + 스킬 어픽스 6종 = 30. **id 조회는 이 배열이 정본**이다. */
export const ALL_AFFIXES: readonly AffixDef[] = [...AFFIXES, ...SKILL_AFFIXES];

/** Lookup an affix def by id (undefined if unknown). 스킬 어픽스도 포함한다 — 저장된
 *  아이템의 어픽스를 표시·합산할 때 id 로 되찾는 유일한 경로다. */
export const AFFIX_BY_ID: ReadonlyMap<string, AffixDef> = new Map(
  ALL_AFFIXES.map((a) => [a.id, a]),
);

/** 한 어픽스의 슬롯 가중(0 = 그 슬롯에서 안 나온다). */
export function affixSlotWeight(d: AffixDef, slot: SlotKind): number {
  return d.weights[slot];
}
