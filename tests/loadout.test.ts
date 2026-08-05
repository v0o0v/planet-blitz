/**
 * ⚠️ **ADR-0049 로 `computeLoadoutStats` 의 위치 인자가 하나 줄었다** —
 * 구 `(equipped, invest, shipBonusBp, typeId)` → 신 `(equipped, shipBonusBp, typeId)`.
 *
 * 이 파일은 그 변경에서 **`tsc` 가 못 잡은 유일한 자리**였다. 구 호출
 * `computeLoadoutStats([], undefined, 5000)` 은 신 시그니처에서 `shipBonusBp = undefined`
 * · `typeId = 5000` 으로 **말이 되어 버려** 타입 검사를 통과하고, `shipTypeDef` 가 범위 밖
 * 5000 을 스트라이커로 정규화해 **계보 보너스가 조용히 사라진** 채 초록이 될 뻔했다
 * (전체 스위트가 잡았다). 위치 인자를 지울 때는 "타입이 우연히 맞는" 조합을 먼저 세어라.
 */
import { describe, it, expect } from 'vitest';
import {
  computeLoadoutStats,
  neutralLoadout,
  WEAPON_VULCAN,
  WEAPON_SPREAD,
  WEAPON_RAILGUN,
  SUB_WEAPON_NONE,
} from '../src/items/loadout.js';
import type { Item, ItemSource, SlotKind, StatKey } from '../src/items/types.js';

const SRC: ItemSource = { planet: 0, stage: 1 };

function item(slot: SlotKind, affixes: { stat: StatKey; value: number }[], weaponType?: number): Item {
  return {
    id: `t-${slot}`,
    slot,
    rarity: 'rare',
    affixes: affixes.map((a, i) => ({ id: `a${i}`, stat: a.stat, value: a.value })),
    source: SRC,
    ...(weaponType !== undefined ? { weaponType } : {}),
  };
}

describe('computeLoadoutStats — derived stats pipeline (AC4)', () => {
  it('empty loadout is neutral', () => {
    const { loadout } = computeLoadoutStats([]);
    expect(loadout).toEqual(neutralLoadout());
    expect(loadout.weaponType).toBe(WEAPON_VULCAN);
    expect(loadout.subWeaponType).toBe(SUB_WEAPON_NONE);
  });

  it('reads weapon type from the equipped main item', () => {
    expect(computeLoadoutStats([item('main', [], WEAPON_RAILGUN)]).loadout.weaponType).toBe(
      WEAPON_RAILGUN,
    );
    expect(computeLoadoutStats([item('sub', [], 1)]).loadout.subWeaponType).toBe(1);
  });

  it('applies distinct weapon-type baselines (spread vs railgun)', () => {
    const spread = computeLoadoutStats([item('main', [], WEAPON_SPREAD)]).loadout;
    expect(spread.bulletCountAdd).toBe(2);
    expect(spread.spreadAdd).toBeCloseTo(0.5);
    expect(spread.damageMult).toBeLessThan(1);

    const rail = computeLoadoutStats([item('main', [], WEAPON_RAILGUN)]).loadout;
    expect(rail.pierceAdd).toBe(3);
    expect(rail.damageMult).toBeGreaterThan(2);
    expect(rail.fireRateMult).toBeGreaterThan(1); // slower cadence
  });

  it('sums affixes across all equipped items', () => {
    const equipped = [
      item('armor', [{ stat: 'damagePct', value: 10 }]),
      item('core', [{ stat: 'damagePct', value: 15 }]),
      item('module', [
        { stat: 'pierce', value: 1 },
        { stat: 'bulletCount', value: 1 },
      ]),
      item('engine', [{ stat: 'moveSpeedPct', value: 20 }]),
    ];
    const { loadout, worldMods } = computeLoadoutStats(equipped);
    expect(loadout.damageMult).toBeCloseTo(1.25); // +25%
    expect(loadout.pierceAdd).toBe(1);
    expect(loadout.bulletCountAdd).toBe(1);
    expect(loadout.moveSpeedMult).toBeCloseTo(1.2);
    expect(worldMods.mineralFindMult).toBe(1);
  });

  it('routes mineral find to worldMods (meta only), xp to the sim block', () => {
    const equipped = [
      item('shield', [{ stat: 'mineralFindPct', value: 30 }]),
      item('core', [{ stat: 'xpPct', value: 25 }]),
    ];
    const { loadout, worldMods } = computeLoadoutStats(equipped);
    expect(worldMods.mineralFindMult).toBeCloseTo(1.3);
    expect(loadout.xpMult).toBeCloseTo(1.25);
  });

  it('is deterministic and order-independent', () => {
    const a = item('armor', [{ stat: 'damagePct', value: 10 }]);
    const b = item('core', [{ stat: 'maxHpFlat', value: 20 }]);
    expect(computeLoadoutStats([a, b])).toEqual(computeLoadoutStats([b, a]));
  });
});

describe('computeLoadoutStats — 계보 기체 가지 보너스 (ADR-0007)', () => {
  it('미지정·0 보너스는 기존 결과와 완전 동일 (하위 호환)', () => {
    expect(computeLoadoutStats([], 0).loadout).toEqual(neutralLoadout());
    expect(computeLoadoutStats([], 0)).toEqual(computeLoadoutStats([]));
  });

  it('상한 보너스(5000bp=+50%)를 데미지·연사·HP 3축에 적용한다', () => {
    const { loadout } = computeLoadoutStats([], 5000);
    expect(loadout.damageMult).toBeCloseTo(1.5);
    expect(loadout.fireRateMult).toBeCloseTo(10000 / 15000); // 발사 간격 ÷1.5 = 연사↑
    expect(loadout.maxHpAdd).toBe(50); // 기준 HP 100 의 +50%
    // 비대상 축은 불변(소폭 강화 원칙)
    expect(loadout.moveSpeedMult).toBe(1);
    expect(loadout.bulletSpeedMult).toBe(1);
    expect(loadout.magnetMult).toBe(1);
    expect(loadout.xpMult).toBe(1);
  });

  it('중간 보너스(2500bp=+25%)는 비례 적용, 범위 밖은 클램프', () => {
    const mid = computeLoadoutStats([], 2500).loadout;
    expect(mid.damageMult).toBeCloseTo(1.25);
    expect(mid.maxHpAdd).toBe(25);
    // 음수 → 0, 5000 초과 → 5000 (normalizeLineageBonus 클램프)
    expect(computeLoadoutStats([], -100).loadout).toEqual(neutralLoadout());
    expect(computeLoadoutStats([], 99999).loadout).toEqual(
      computeLoadoutStats([], 5000).loadout,
    );
  });

  it('장비·스킬 위에 곱연산으로 겹친다 (ARPG 스택)', () => {
    const gear = [item('armor', [{ stat: 'damagePct', value: 20 }])];
    const { loadout } = computeLoadoutStats(gear, 5000);
    expect(loadout.damageMult).toBeCloseTo(1.2 * 1.5);
  });
});
