/**
 * 어픽스 재편(ADR-0049 단계 2·3) — 슬롯 가중 draw 로 전환한 `rollAffixes`/`rollItem`
 * (드랍) · `reforgeAffixes`(정련)의 증명. 세 축을 검사한다:
 *   1. RNG 스트림 형태 불변 — 뽑힌 어픽스 내용과 무관하게 `nextU32` 소비 횟수가 같다.
 *   2. 뽑힌 어픽스가 항상 그 슬롯의 풀 안에 있다.
 *   3. 스킬 어픽스 게이트(등급·단계·장비당 최대 1개)와 `slotOverride`·`reforgeAffixes`
 *      의 뮤테이션 대조(고의로 배선을 부숴 실패를 확인).
 */
import { describe, it, expect } from 'vitest';
import { rollItem, reforgeAffixes } from '../src/items/roll.js';
import { SeededRng } from '../src/sim/rng.js';
import { SLOT_KINDS } from '../src/items/types.js';
import type { Item, ItemSource, Rarity } from '../src/items/types.js';
import {
  affixPoolFor,
  refinePoolFor,
  skillAffixCount,
  SKILL_AFFIX_MIN_STAGE,
} from '../src/items/affixPool.js';
import { SKILL_AFFIX_IDS } from '../data/affixes.js';

/** `fn` 실행 동안 `SeededRng.nextU32` 가 소비된 횟수를 센다(프로토타입을 감싸 원복). */
function countDraws(fn: () => void): number {
  const orig = SeededRng.prototype.nextU32;
  let count = 0;
  SeededRng.prototype.nextU32 = function (this: SeededRng): number {
    count++;
    return orig.call(this);
  };
  try {
    fn();
  } finally {
    SeededRng.prototype.nextU32 = orig;
  }
  return count;
}

const LOW_SRC: ItemSource = { planet: 0, stage: 1 };
const HIGH_SRC: ItemSource = { planet: 0, stage: SKILL_AFFIX_MIN_STAGE };
const RARITIES: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];
const SEEDS = [1, 2, 3, 42, 999, 0xdeadbeef, 424242, 7, 88, 12345];

describe('affixSlotRoll — RNG 스트림 형태 불변 (draw 횟수 증명)', () => {
  it('같은 시드·등급에서 스킬 어픽스 게이트 유무(저단계 vs 고단계)와 무관하게 소비 횟수가 같다', () => {
    for (const rarity of RARITIES) {
      for (const seed of SEEDS) {
        const lowDraws = countDraws(() => rollItem(seed, rarity, LOW_SRC));
        const highDraws = countDraws(() => rollItem(seed, rarity, HIGH_SRC));
        expect(highDraws, `rarity=${rarity} seed=${seed}`).toBe(lowDraws);
        expect(lowDraws, `rarity=${rarity} seed=${seed} (draw>0)`).toBeGreaterThan(0);
      }
    }
  });

  it('slotOverride 를 7 슬롯 전부로 돌려도 같은 시드·등급에서 소비 횟수가 같다(override 는 draw 형태를 안 바꾼다)', () => {
    for (const rarity of RARITIES) {
      for (const seed of SEEDS) {
        const base = countDraws(() => rollItem(seed, rarity, HIGH_SRC));
        for (const slot of SLOT_KINDS) {
          const withOverride = countDraws(() => rollItem(seed, rarity, HIGH_SRC, slot));
          expect(withOverride, `rarity=${rarity} seed=${seed} slot=${slot}`).toBe(base);
        }
      }
    }
  });

  it('unique 레지스트리가 비어 있든 채워져 있든(uniqueId draw 는 항상 1회) 소비 횟수가 같다 — override 조합에서도 성립', () => {
    // uniques.ts 의 기존 불변식(리뷰 LOW-2)이 slotOverride 도입 후에도 유지되는지.
    for (const seed of SEEDS) {
      const noOverride = countDraws(() => rollItem(seed, 'unique', HIGH_SRC));
      const withOverride = countDraws(() => rollItem(seed, 'unique', HIGH_SRC, 'core'));
      expect(withOverride, `seed=${seed}`).toBe(noOverride);
    }
  });

  it('reforgeAffixes — 같은 슬롯·같은 needed(=count-fastened) 라면 아이템의 실제 어픽스 내용과 무관하게 소비 횟수가 같다', () => {
    // 같은 슬롯(armor)에서 서로 다른 시드로 뽑은 두 아이템을 준비해 '내용은 다르지만
    // needed 는 같다'는 상황을 만든다.
    const armorItems: Item[] = [];
    for (let seed = 1; seed < 5000 && armorItems.length < 2; seed++) {
      const it = rollItem(seed, 'rare', LOW_SRC, 'armor');
      if (it.affixes.length >= 3) armorItems.push(it);
    }
    expect(armorItems.length).toBe(2);
    const [a, b] = armorItems as [Item, Item];
    // 두 아이템의 실제 어픽스 id 집합이 다름을 확인(내용이 실제로 갈리는 케이스인지 보장).
    expect(a.affixes.map((x) => x.id)).not.toEqual(b.affixes.map((x) => x.id));
    for (const seed of [1, 2, 3]) {
      const needed = Math.min(a.affixes.length, b.affixes.length);
      // count 를 맞추기 위해 필요하면 앞쪽만 잘라 재구성한 것이 아니라, 같은 count 를
      // 가진 두 아이템만 비교 대상으로 쓴다.
      if (a.affixes.length !== b.affixes.length) continue;
      const drawsA = countDraws(() => reforgeAffixes(a, seed));
      const drawsB = countDraws(() => reforgeAffixes(b, seed));
      expect(drawsB, `seed=${seed} needed=${needed}`).toBe(drawsA);
    }
  });
});

describe('affixSlotRoll — 뽑힌 어픽스는 항상 그 슬롯 풀 안이다', () => {
  it('드랍(rollItem, slotOverride) — 등급·단계 조합 전수에서 벗어나지 않는다', () => {
    for (const slot of SLOT_KINDS) {
      for (const rarity of RARITIES) {
        for (const src of [LOW_SRC, HIGH_SRC]) {
          const poolIds = new Set(affixPoolFor(slot, rarity, src.stage).map((e) => e.def.id));
          for (let seed = 1; seed <= 40; seed++) {
            const item = rollItem(seed * 97 + 3, rarity, src, slot);
            for (const a of item.affixes) {
              expect(poolIds.has(a.id), `slot=${slot} rarity=${rarity} stage=${src.stage} id=${a.id}`).toBe(
                true,
              );
            }
          }
        }
      }
    }
  });

  it('정련(reforgeAffixes) — 재추첨된 칸은 정련 풀(base-24) 안에서만 나온다', () => {
    for (const slot of SLOT_KINDS) {
      const poolIds = new Set(refinePoolFor(slot).map((e) => e.def.id));
      for (let seed = 1; seed <= 30; seed++) {
        const item = rollItem(seed * 53 + 11, 'rare', HIGH_SRC, slot);
        if (item.affixes.length === 0) continue;
        const out = reforgeAffixes(item, seed * 31 + 5);
        const fastenedIds = new Set(
          item.affixes.filter((a) => SKILL_AFFIX_IDS.has(a.id)).map((a) => a.id),
        );
        for (const a of out.affixes) {
          if (fastenedIds.has(a.id)) continue; // 암묵 고착 스킬 어픽스는 풀 검사 대상이 아니다.
          expect(poolIds.has(a.id), `slot=${slot} id=${a.id}`).toBe(true);
        }
      }
    }
  });
});

describe('affixSlotRoll — 스킬 어픽스 게이트 (등급·단계·개수)', () => {
  it('rare·stage>=9 에서 장비당 스킬 어픽스가 최대 1개다 (수천 시드에 2개 이상 0건)', () => {
    let checked = 0;
    let twoPlus = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      const item = rollItem(seed, 'rare', HIGH_SRC);
      const n = skillAffixCount(item.affixes);
      checked++;
      if (n >= 2) twoPlus++;
    }
    expect(checked).toBe(4000);
    expect(twoPlus).toBe(0);
  });

  it('stage < 9 · magic · normal 에서는 스킬 어픽스가 0건이다', () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const lowStageRare = rollItem(seed, 'rare', { planet: 0, stage: SKILL_AFFIX_MIN_STAGE - 1 });
      expect(skillAffixCount(lowStageRare.affixes), `low-stage rare seed=${seed}`).toBe(0);
      const magic = rollItem(seed, 'magic', HIGH_SRC);
      expect(skillAffixCount(magic.affixes), `magic seed=${seed}`).toBe(0);
      const normal = rollItem(seed, 'normal', HIGH_SRC);
      expect(skillAffixCount(normal.affixes), `normal seed=${seed}`).toBe(0);
    }
  });

  // ⭐ 위 두 테스트는 게이트를 고의로 부숴(SKILL_AFFIX_MIN_STAGE 를 임시로 0 으로,
  // affixCountFor 를 rare 에 6 고정 등) 실제로 빨개지는지 수동 확인했다 — 통과 상태로
  // 되돌린 뒤 커밋한다(보고서 참조).
});

describe('affixSlotRoll — slotOverride: weaponType 은 불변, 어픽스는 override 슬롯을 따른다', () => {
  it('같은 시드에서 override 유무로 weaponType 은 같고 어픽스 구성은(대개) 다르다', () => {
    let diffSeen = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const plain = rollItem(seed, 'rare', HIGH_SRC);
      const overridden = rollItem(seed, 'rare', HIGH_SRC, 'module');
      expect(overridden.weaponType, `seed=${seed}`).toBe(plain.weaponType);
      if (plain.slot !== 'module') {
        // 어픽스 풀이 실제로 갈리는 케이스: 어픽스 id 집합이 달라야 한다(풀이 다르므로).
        const a = plain.affixes.map((x) => x.id).sort().join(',');
        const b = overridden.affixes.map((x) => x.id).sort().join(',');
        if (a !== b) diffSeen++;
      }
    }
    expect(diffSeen).toBeGreaterThan(0);
  });
});

describe('affixSlotRoll — reforgeAffixes: 스킬 어픽스 암묵 고착', () => {
  function findRareWithSkillAffix(startSeed: number): Item {
    for (let seed = startSeed; seed < startSeed + 20000; seed++) {
      const item = rollItem(seed, 'rare', HIGH_SRC);
      if (skillAffixCount(item.affixes) === 1) return item;
    }
    throw new Error('no rare with a skill affix found in range');
  }

  it('스킬 어픽스가 붙은 칸은 재추첨해도 값·id 그대로고, 나머지는 그 슬롯 풀 안에서만, 개수는 보존된다', () => {
    const item = findRareWithSkillAffix(1);
    const skillIdx = item.affixes.findIndex((a) => SKILL_AFFIX_IDS.has(a.id));
    expect(skillIdx).toBeGreaterThanOrEqual(0);
    const skillAffix = item.affixes[skillIdx]!;

    const poolIds = new Set(refinePoolFor(item.slot).map((e) => e.def.id));
    for (const seed of [1, 2, 3, 999]) {
      const out = reforgeAffixes(item, seed);
      expect(out.affixes).toHaveLength(item.affixes.length);
      expect(out.affixes[skillIdx]).toEqual(skillAffix);
      for (let i = 0; i < out.affixes.length; i++) {
        if (i === skillIdx) continue;
        expect(poolIds.has(out.affixes[i]!.id), `seed=${seed} idx=${i}`).toBe(true);
        expect(out.affixes[i]!.id).not.toBe(skillAffix.id);
      }
    }
  });

  // ⭐ 위 테스트는 고의로 암묵 고착 로직을 지워(skillAffixIndices 를 빈 배열 반환하도록)
  // 실제로 빨개지는지(스킬 어픽스 칸이 재추첨돼 값이 바뀌는지) 수동 확인했다 — 되돌린 뒤
  // 커밋한다(보고서 참조).
});
