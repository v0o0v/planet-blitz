/**
 * 전투력 점수 산식 검증 (src/save/combatPower — M5 C2, plan §5).
 *
 * 등급 가중 + 어픽스 깊이 합산이 순수·결정론임을 검증한다.
 */

import { describe, it, expect } from 'vitest';
import { itemCombatPower, totalCombatPower } from '../src/save/combatPower.js';
import type { Item, Rarity, AffixRoll } from '../src/items/types.js';

function mkItem(rarity: Rarity, affixCount: number): Item {
  const affixes: AffixRoll[] = [];
  for (let i = 0; i < affixCount; i++) affixes.push({ id: `a${i}`, stat: 'maxHpFlat', value: 1 });
  return {
    id: `${rarity}-${affixCount}`,
    slot: 'armor',
    rarity,
    affixes,
    source: { planet: 0, tier: 0 },
  };
}

describe('itemCombatPower', () => {
  it('상위 등급일수록 점수가 높다', () => {
    const normal = itemCombatPower(mkItem('normal', 0));
    const magic = itemCombatPower(mkItem('magic', 0));
    const rare = itemCombatPower(mkItem('rare', 0));
    const unique = itemCombatPower(mkItem('unique', 0));
    expect(normal).toBeLessThan(magic);
    expect(magic).toBeLessThan(rare);
    expect(rare).toBeLessThan(unique);
  });

  it('어픽스가 많을수록 점수가 높다(깊이 반영)', () => {
    expect(itemCombatPower(mkItem('rare', 3))).toBeGreaterThan(itemCombatPower(mkItem('rare', 0)));
  });

  it('결정론 — 같은 입력에 같은 점수', () => {
    expect(itemCombatPower(mkItem('magic', 2))).toBe(itemCombatPower(mkItem('magic', 2)));
  });
});

describe('totalCombatPower', () => {
  it('빈 배열은 0', () => {
    expect(totalCombatPower([])).toBe(0);
  });

  it('개별 점수의 합', () => {
    const items = [mkItem('normal', 0), mkItem('rare', 2), mkItem('unique', 1)];
    const expected = items.reduce((s, it) => s + itemCombatPower(it), 0);
    expect(totalCombatPower(items)).toBe(expected);
  });
});
