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
  pilotLevelMult,
  neutralLoadout,
  WEAPON_VULCAN,
  WEAPON_SPREAD,
  WEAPON_RAILGUN,
  SUB_WEAPON_NONE,
} from '../src/items/loadout.js';
import { SIG_STRIKER_MARKSMAN } from '../src/sim/shipSignature.js';
import { DEFAULT_CONFIG } from '../src/sim/world.js';
import type { Item, ItemSource, SlotKind, StatKey } from '../src/items/types.js';

const SRC: ItemSource = { planet: 0, stage: 1 };

/**
 * ⚠️ 2026-08-06 — ADR-0049 로 스트라이커(typeId 미지정 = 0)도 시그니처(정조준 사이클, 비트24)를
 * 갖는다. `neutralLoadout()` 자체는 여전히 `uniqueMask:0` 인 "완전 무연산" 기준선이지만,
 * `computeLoadoutStats` 가 실제로 만드는 "타입 0·무보정" 결과는 그 기준선과 **`uniqueMask` 한
 * 필드만** 다르다 — 자기 시그니처 비트가 항상 OR-in 되기 때문이다(`loadout.ts` `computeLoadoutStats`
 * 꼬리). 아래 비교들은 그 한 필드를 분리해 "나머지는 완전히 중립"이라는 원래 계약을 그대로 지키고,
 * `uniqueMask` 는 별도로 스트라이커 비트임을 못박는다(값을 느슨하게 맞춘 것이 아니라 계약을
 * 재정의한 것 — `neutralLoadout()` 은 여전히 0 이고, "스트라이커 config" 만 0 이 아니다).
 */
const STRIKER_NEUTRAL = { ...neutralLoadout(), uniqueMask: 1 << SIG_STRIKER_MARKSMAN };

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
  it('empty loadout is neutral (스트라이커 자기 시그니처 비트는 예외)', () => {
    const { loadout } = computeLoadoutStats([]);
    expect(loadout).toEqual(STRIKER_NEUTRAL);
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
  it('미지정·0 보너스는 기존 결과와 완전 동일 (하위 호환, 스트라이커 시그니처 비트는 예외)', () => {
    expect(computeLoadoutStats([], 0).loadout).toEqual(STRIKER_NEUTRAL);
    expect(computeLoadoutStats([], 0)).toEqual(computeLoadoutStats([]));
  });

  it('상한 보너스(5000bp=+50%)를 데미지·연사·HP 3축에 적용한다', () => {
    const { loadout } = computeLoadoutStats([], 5000);
    expect(loadout.damageMult).toBeCloseTo(1.5);
    expect(loadout.fireRateMult).toBeCloseTo(10000 / 15000); // 발사 간격 ÷1.5 = 연사↑
    // 기준 HP 는 **리터럴이 아니라 정본 파생**이다 — `loadout.ts` 의 `BASE_HP_REF` 가 자기 주석에
    // "matches DEFAULT_CONFIG" 를 계약으로 적어 두었고, 그 값은 밸런스 튜닝 대상이다
    // (2026-08-08 에 100 → 151). 리터럴로 두면 튜닝할 때마다 이 케이스가 빨개진다.
    expect(loadout.maxHpAdd).toBe(Math.round(DEFAULT_CONFIG.playerHp * 0.5));
    // 비대상 축은 불변(소폭 강화 원칙)
    expect(loadout.moveSpeedMult).toBe(1);
    expect(loadout.bulletSpeedMult).toBe(1);
    expect(loadout.magnetMult).toBe(1);
    expect(loadout.xpMult).toBe(1);
  });

  it('중간 보너스(2500bp=+25%)는 비례 적용, 범위 밖은 클램프', () => {
    const mid = computeLoadoutStats([], 2500).loadout;
    expect(mid.damageMult).toBeCloseTo(1.25);
    expect(mid.maxHpAdd).toBe(Math.round(DEFAULT_CONFIG.playerHp * 0.25));
    // 음수 → 0, 5000 초과 → 5000 (normalizeLineageBonus 클램프)
    expect(computeLoadoutStats([], -100).loadout).toEqual(STRIKER_NEUTRAL);
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

/**
 * 조종사 레벨 성장(§R51 — 장비 축 포화 복구).
 *
 * ⚠️ **공비 리터럴(1.0164)을 여기 적지 않는다.** 그 값은 밸런스 튜닝 대상이고, 리터럴로 박으면
 * 다음 튜닝에서 이 파일이 통째로 빨개진다(이 파일이 `BASE_HP_REF` 로 이미 한 번 겪은 형태 —
 * 위 「상한 보너스」 케이스 주석). 여기서 못 박는 것은 **성질**이다: 레벨1 무연산 · 단조 증가 ·
 * 두 축(피해·HP)의 성장률 일치 · 재현성 · 손상 입력 방어.
 */
describe('computeLoadoutStats — 조종사 레벨 성장 (§R51)', () => {
  it('레벨 1 은 무연산이다 (기존 골든 바이트 불변의 근거)', () => {
    expect(pilotLevelMult(1)).toBe(1);
    // 인자 미지정 = 레벨 1. 두 결과가 **정확히** 같아야 한다(근사 비교가 아니다).
    expect(computeLoadoutStats([], 0, 0, 1)).toEqual(computeLoadoutStats([], 0, 0));
    const gear = [item('armor', [{ stat: 'damagePct', value: 20 }, { stat: 'maxHpFlat', value: 40 }])];
    expect(computeLoadoutStats(gear, 2500, 1, 1)).toEqual(computeLoadoutStats(gear, 2500, 1));
  });

  it('레벨이 오르면 단조 증가하고, 같은 입력은 항상 같은 값이다 (결정론)', () => {
    let prev = 1;
    for (let lv = 2; lv <= 100; lv++) {
      const m = pilotLevelMult(lv);
      expect(m, `Lv${lv}`).toBeGreaterThan(prev);
      expect(m).toBe(pilotLevelMult(lv)); // 재호출 비트 동일(반복 곱 — Math.pow 아님)
      prev = m;
    }
  });

  it('피해와 HP 의 성장률이 정확히 같다 (두 축 동시 적용 — 사용자 결정)', () => {
    const LV = 100;
    const m = pilotLevelMult(LV);
    const base = computeLoadoutStats([], undefined, 0).loadout;
    const grown = computeLoadoutStats([], undefined, 0, LV).loadout;
    expect(grown.damageMult).toBeCloseTo(base.damageMult * m, 10);
    // HP 는 가산 축이라 «기준 HP 포함 실효값» 이 배율을 받는다. 기준값은 리터럴이 아니라
    // 정본 파생(`DEFAULT_CONFIG.playerHp` == `BASE_HP_REF` 계약).
    const ehpBase = DEFAULT_CONFIG.playerHp + base.maxHpAdd;
    expect(DEFAULT_CONFIG.playerHp + grown.maxHpAdd).toBe(Math.round(ehpBase * m));
  });

  it('장비가 준 HP 에도 걸린다 (맨 끝 적용 — 반쪽 적용 방지)', () => {
    const gear = [item('armor', [{ stat: 'maxHpFlat', value: 200 }])];
    const LV = 50;
    const m = pilotLevelMult(LV);
    const base = computeLoadoutStats(gear, undefined, 0).loadout;
    const grown = computeLoadoutStats(gear, undefined, 0, LV).loadout;
    expect(base.maxHpAdd).toBe(200);
    // 200 이 아니라 (기준HP + 200) 전체가 배율을 받는다 — 섀시 보정 자리에서 부르면 이 단언이 깨진다.
    expect(DEFAULT_CONFIG.playerHp + grown.maxHpAdd).toBe(
      Math.round((DEFAULT_CONFIG.playerHp + 200) * m),
    );
  });

  it('로스터 밴드가 정확히 불변이다 (전 기체 공통 배율의 존재 이유)', () => {
    // 같은 레벨에서 기체 간 피해 배율의 비가 레벨과 무관해야 한다 — 이것이 깨지면
    // 명목표 SPREAD(여유 2%)가 움직인다.
    for (const typeId of [1, 2, 3]) {
      const a1 = computeLoadoutStats([], undefined, typeId, 1).loadout;
      const s1 = computeLoadoutStats([], undefined, 0, 1).loadout;
      const a100 = computeLoadoutStats([], undefined, typeId, 100).loadout;
      const s100 = computeLoadoutStats([], undefined, 0, 100).loadout;
      expect(a100.damageMult / s100.damageMult).toBeCloseTo(a1.damageMult / s1.damageMult, 10);
    }
  });

  it('손상 세이브 방어 — 비유한·0·음수 레벨은 무연산으로 떨어진다', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pilotLevelMult(bad), `level=${String(bad)}`).toBe(1);
    }
    // 상한 가드: 터무니없이 큰 레벨도 유한하고, 상한 위로는 더 안 자란다(루프 가드).
    expect(Number.isFinite(pilotLevelMult(1e9))).toBe(true);
    expect(pilotLevelMult(1e9)).toBe(pilotLevelMult(201));
  });
});
