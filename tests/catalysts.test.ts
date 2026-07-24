/**
 * 촉매 데이터 계약 검증 (src/data/catalysts.ts — Lane 0).
 *
 * 하위 레인(2·3·4)이 의존하는 계약을 고정한다:
 *  1) 카탈로그 구조 — id 0~47 유일·연속, 공용 30 + 특산 18, 특산 행성 배정.
 *  2) normalizeCatalystArray — 순서 무관·중복 보존·미지 id 제거.
 *  3) 배율 함수 — 축별 정확·선형 가산(N장 = N·perStack)·순서 무관.
 *  4) SLOT_CAP 초과 거부(isWithinSlotCap).
 *  5) 48종 각각 reward/penalty 방향(부호) 존재.
 *  6) CATALYST_RESOURCE_MIRROR / 아이콘 참조 형태.
 *
 * 순수 데이터/함수라 DOM·sim 없이 돈다. 밸런스 수치가 아니라 구조·부호를 검증한다.
 */

import { describe, it, expect } from 'vitest';
import {
  CATALYSTS,
  SLOT_CAP,
  MODE_HOOK,
  CATALYST_RESOURCE_MIRROR,
  catalystById,
  normalizeCatalystArray,
  isWithinSlotCap,
  catalystRewardMult,
  catalystPenaltyMult,
  resourceMultOf,
  catalystPowerMult,
  catalystIconKey,
  type RewardAxis,
  type PenaltyAxis,
  type PowerStat,
} from '../src/data/catalysts.js';

const REWARD_AXES: readonly RewardAxis[] = ['drop', 'rarity', 'xp', 'resource', 'catalystDrop', 'power'];
const PENALTY_AXES: readonly PenaltyAxis[] = [
  'enemyHp',
  'enemySpeed',
  'enemyDamage',
  'enemyCount',
  'enemyBulletSpeed',
  'playerHpDown',
];
const POWER_STATS: readonly PowerStat[] = ['damage', 'fireRate', 'moveSpeed', 'maxHp', 'skillAll'];

describe('catalysts — 카탈로그 구조', () => {
  it('id 는 0~47 유일·연속이고 배열 인덱스와 일치한다', () => {
    expect(CATALYSTS.length).toBe(48);
    const ids = CATALYSTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(48);
    for (let i = 0; i < 48; i++) {
      expect(ids[i]).toBe(i);
      expect(catalystById(i)?.id).toBe(i);
    }
  });

  it('공용 30 + 특산 18 이고 특산만 planet(0..5)을 갖는다', () => {
    const common = CATALYSTS.filter((c) => c.kind === 'common');
    const signature = CATALYSTS.filter((c) => c.kind === 'signature');
    expect(common.length).toBe(30);
    expect(signature.length).toBe(18);
    // 공용은 id 0~29, planet 없음.
    for (const c of common) {
      expect(c.id).toBeLessThan(30);
      expect(c.planet).toBeUndefined();
    }
    // 특산은 id 30~47, planet 0..5 로 행성당 3종.
    for (const c of signature) {
      expect(c.id).toBeGreaterThanOrEqual(30);
      expect(c.planet).toBeGreaterThanOrEqual(0);
      expect(c.planet).toBeLessThanOrEqual(5);
    }
    for (let p = 0; p < 6; p++) {
      const forPlanet = signature.filter((c) => c.planet === p);
      expect(forPlanet.length, `planet ${p} 특산 3종`).toBe(3);
      // planet p → id 30+3p, 31+3p, 32+3p
      expect(forPlanet.map((c) => c.id).sort((a, b) => a - b)).toEqual([30 + 3 * p, 31 + 3 * p, 32 + 3 * p]);
    }
  });

  it('slug 는 전부 유일하다', () => {
    const slugs = CATALYSTS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(48);
  });

  it('행성당 특산 3슬롯 = 모드훅 1 · 자원형 1 · 나머지(보스형) 1', () => {
    for (let p = 0; p < 6; p++) {
      const trio = CATALYSTS.filter((c) => c.planet === p);
      // ① 모드 격화형: 정확히 1종이 modeHook 을 갖는다.
      expect(trio.filter((c) => c.modeHook !== undefined).length, `planet ${p} 모드형 1`).toBe(1);
      // ② 테마 자원형: 정확히 1종이 resource 보상축.
      expect(trio.filter((c) => c.reward.axis === 'resource').length, `planet ${p} 자원형 1`).toBe(1);
      // ③ 보스 격화형: modeHook 없고 resource 아닌 나머지 1종의 보상축은 drop 또는 rarity.
      const boss = trio.filter((c) => c.modeHook === undefined && c.reward.axis !== 'resource');
      expect(boss.length, `planet ${p} 보스형 1`).toBe(1);
      expect(['drop', 'rarity']).toContain(boss[0]!.reward.axis);
    }
  });

  it('모드 격화형 6종의 modeHook 은 행성 모드와 1:1 매핑이다', () => {
    const hookByPlanet: Record<number, string> = {
      0: MODE_HOOK.vampire,
      1: MODE_HOOK.shrink,
      2: MODE_HOOK.chase,
      3: MODE_HOOK.racing,
      4: MODE_HOOK.contamination,
      5: MODE_HOOK.blockBreak,
    };
    const modeCatalysts = CATALYSTS.filter((c) => c.modeHook !== undefined);
    expect(modeCatalysts.length).toBe(6);
    for (const c of modeCatalysts) {
      expect(c.modeHook).toBe(hookByPlanet[c.planet!]);
    }
    // 훅 식별자 6종은 서로 다르다.
    expect(new Set(modeCatalysts.map((c) => c.modeHook)).size).toBe(6);
  });
});

describe('catalysts — 방향(부호) 존재', () => {
  it('48종 각각 reward/penalty 방향이 존재한다(양수 perStack)', () => {
    for (const c of CATALYSTS) {
      expect(REWARD_AXES).toContain(c.reward.axis);
      expect(PENALTY_AXES).toContain(c.penalty.axis);
      // 순수 버프 없음: 페널티 perStack > 0 으로 난이도 상승 방향.
      expect(c.penalty.perStack, `${c.slug} 페널티 부호`).toBeGreaterThan(0);
      // 보상 perStack > 0 으로 이득 방향.
      expect(c.reward.perStack, `${c.slug} 보상 부호`).toBeGreaterThan(0);
      expect(c.dropWeight, `${c.slug} 드랍 가중치`).toBeGreaterThan(0);
      // 파워축은 powerStat 필수, 비파워축은 powerStat 없음.
      if (c.reward.axis === 'power') {
        expect(POWER_STATS, `${c.slug} powerStat`).toContain(c.reward.powerStat);
      } else {
        expect(c.reward.powerStat).toBeUndefined();
      }
    }
  });

  it('보상 6축이 전부 최소 1종씩 존재한다(고른 분포)', () => {
    for (const axis of REWARD_AXES) {
      expect(CATALYSTS.some((c) => c.reward.axis === axis), `보상축 ${axis}`).toBe(true);
    }
  });

  it('파워축은 5개 스탯 전부에 최소 1종씩 존재한다', () => {
    for (const stat of POWER_STATS) {
      expect(
        CATALYSTS.some((c) => c.reward.axis === 'power' && c.reward.powerStat === stat),
        `파워 스탯 ${stat}`,
      ).toBe(true);
    }
  });

  it('파워축 촉매 드랍 가중치는 일반 공용축보다 낮다(무등급: 프리미엄=희소 드랍)', () => {
    const powerWeights = CATALYSTS.filter((c) => c.reward.axis === 'power').map((c) => c.dropWeight);
    const commonNonPower = CATALYSTS.filter((c) => c.kind === 'common' && c.reward.axis !== 'power');
    const minCommon = Math.min(...commonNonPower.map((c) => c.dropWeight));
    for (const w of powerWeights) expect(w).toBeLessThan(minCommon);
  });
});

describe('normalizeCatalystArray — 순서 무관·중복 보존·미지 제거', () => {
  it('같은 집합이면 입력 순서와 무관하게 동일 결과다', () => {
    const a = normalizeCatalystArray([3, 1, 2, 0]);
    const b = normalizeCatalystArray([0, 2, 1, 3]);
    expect(a).toEqual(b);
    expect(a).toEqual([0, 1, 2, 3]);
  });

  it('중복(스택)을 보존한다', () => {
    expect(normalizeCatalystArray([5, 5, 5])).toEqual([5, 5, 5]);
    expect(normalizeCatalystArray([2, 5, 2])).toEqual([2, 2, 5]);
  });

  it('미지 id 를 제거한다(음수·범위 밖·비정수)', () => {
    expect(normalizeCatalystArray([-1, 48, 999, 3])).toEqual([3]);
    expect(normalizeCatalystArray([1.5, 0])).toEqual([0]);
  });

  it('빈 배열은 빈 배열이다(촉매 무관 런)', () => {
    expect(normalizeCatalystArray([])).toEqual([]);
  });
});

describe('SLOT_CAP — 초과 거부', () => {
  it('SLOT_CAP 은 양의 정수 상수다', () => {
    expect(Number.isInteger(SLOT_CAP)).toBe(true);
    expect(SLOT_CAP).toBeGreaterThan(0);
  });

  it('정규화 후 개수가 SLOT_CAP 이내면 통과, 초과면 거부', () => {
    const cap = Array.from({ length: SLOT_CAP }, () => 0); // 동일 id 스택도 개수로 센다
    expect(isWithinSlotCap(cap)).toBe(true);
    expect(isWithinSlotCap([...cap, 0])).toBe(false);
  });

  it('미지 id 는 캡 계산에서 빠진다(정규화 후 카운트)', () => {
    const overWithJunk = [...Array.from({ length: SLOT_CAP }, () => 1), 999, -1];
    expect(isWithinSlotCap(overWithJunk)).toBe(true); // junk 2개 제거 후 정확히 SLOT_CAP
  });
});

describe('배율 함수 — 축별 정확·선형 가산·순서 무관', () => {
  it('catalystRewardMult: 빈 배열은 1(무효과)', () => {
    for (const axis of REWARD_AXES) expect(catalystRewardMult([], axis)).toBe(1);
  });

  it('catalystRewardMult: 축별로 해당 촉매만 합산한다', () => {
    // id 0 = drop 축(perStack REWARD). id 5 = rarity 축. 서로 섞이지 않는다.
    const drop0 = catalystById(0)!;
    const dropMult = catalystRewardMult([0], 'drop');
    expect(dropMult).toBeCloseTo(1 + drop0.reward.perStack, 10);
    // drop 촉매는 rarity 배율에 영향 없음.
    expect(catalystRewardMult([0], 'rarity')).toBe(1);
  });

  it('catalystRewardMult: N장 스택 = 1 + N·perStack (선형 가산)', () => {
    const def = catalystById(0)!; // drop 축
    for (let n = 1; n <= 5; n++) {
      const ids = Array.from({ length: n }, () => 0);
      expect(catalystRewardMult(ids, 'drop')).toBeCloseTo(1 + n * def.reward.perStack, 10);
    }
  });

  it('catalystRewardMult: 서로 다른 같은-축 촉매도 합산된다', () => {
    // id 0,1,2,3,4 모두 drop 축.
    const sum = [0, 1, 2, 3, 4].reduce((acc, id) => acc + catalystById(id)!.reward.perStack, 0);
    expect(catalystRewardMult([0, 1, 2, 3, 4], 'drop')).toBeCloseTo(1 + sum, 10);
  });

  it('catalystRewardMult: 입력 순서와 무관하다', () => {
    expect(catalystRewardMult([0, 1, 2], 'drop')).toBeCloseTo(catalystRewardMult([2, 0, 1], 'drop'), 10);
  });

  it('catalystPenaltyMult: 축별 합산·선형 가산', () => {
    // id 1 = enemyHp 페널티.
    const def = catalystById(1)!;
    expect(def.penalty.axis).toBe('enemyHp');
    for (let n = 1; n <= 4; n++) {
      const ids = Array.from({ length: n }, () => 1);
      expect(catalystPenaltyMult(ids, 'enemyHp')).toBeCloseTo(1 + n * def.penalty.perStack, 10);
    }
    // 다른 페널티축엔 영향 없음.
    expect(catalystPenaltyMult([1], 'enemyCount')).toBe(1);
  });

  it('catalystPenaltyMult: 빈 배열은 전 축 1', () => {
    for (const axis of PENALTY_AXES) expect(catalystPenaltyMult([], axis)).toBe(1);
  });

  it('resourceMultOf = catalystRewardMult(ids, "resource")', () => {
    // id 15 = resource 축.
    const ids = [15, 15, 16];
    expect(resourceMultOf(ids)).toBeCloseTo(catalystRewardMult(ids, 'resource'), 10);
    expect(resourceMultOf([15])).toBeGreaterThan(1);
    expect(resourceMultOf([0])).toBe(1); // drop 촉매는 자원 배율에 무영향
  });

  it('catalystPowerMult: 스탯별 정확·선형·타 스탯 무영향', () => {
    // id 25 = power damage.
    const dmg = catalystById(25)!;
    expect(dmg.reward.powerStat).toBe('damage');
    expect(catalystPowerMult([25], 'damage')).toBeCloseTo(1 + dmg.reward.perStack, 10);
    expect(catalystPowerMult([25, 25], 'damage')).toBeCloseTo(1 + 2 * dmg.reward.perStack, 10);
    // damage 촉매는 fireRate 배율에 무영향.
    expect(catalystPowerMult([25], 'fireRate')).toBe(1);
    // 빈 배열은 1.
    for (const stat of POWER_STATS) expect(catalystPowerMult([], stat)).toBe(1);
  });

  it('catalystPowerMult: 여러 파워 스탯이 섞여도 스탯별로만 합산한다', () => {
    // 25=damage, 26=fireRate. 함께 넣어도 서로 안 섞인다.
    const dmg = catalystById(25)!.reward.perStack;
    const fr = catalystById(26)!.reward.perStack;
    expect(catalystPowerMult([25, 26], 'damage')).toBeCloseTo(1 + dmg, 10);
    expect(catalystPowerMult([25, 26], 'fireRate')).toBeCloseTo(1 + fr, 10);
  });
});

describe('CATALYST_RESOURCE_MIRROR — SQL 시드 형태', () => {
  it('48행, id 오름차순, 자원축만 perStack 그 외 0', () => {
    expect(CATALYST_RESOURCE_MIRROR.length).toBe(48);
    for (let i = 0; i < 48; i++) {
      const row = CATALYST_RESOURCE_MIRROR[i]!;
      expect(row.id).toBe(i);
      const def = catalystById(i)!;
      if (def.reward.axis === 'resource') {
        expect(row.resourcePerStack).toBeCloseTo(def.reward.perStack, 10);
        expect(row.resourcePerStack).toBeGreaterThan(0);
      } else {
        expect(row.resourcePerStack).toBe(0);
      }
    }
  });

  it('미러 자원 배율은 resourceMultOf 와 정합한다', () => {
    // 자원 촉매 하나를 미러에서 찾아 resourceMultOf 와 대조.
    const resRow = CATALYST_RESOURCE_MIRROR.find((r) => r.resourcePerStack > 0)!;
    expect(resourceMultOf([resRow.id])).toBeCloseTo(1 + resRow.resourcePerStack, 10);
  });
});

describe('catalystIconKey — slug 기반 축별 placeholder', () => {
  it('비파워 촉매는 catalyst_axis_<rewardAxis>', () => {
    expect(catalystIconKey(catalystById(0)!)).toBe('catalyst_axis_drop'); // drop
    expect(catalystIconKey(catalystById(5)!)).toBe('catalyst_axis_rarity'); // rarity
    expect(catalystIconKey(catalystById(15)!)).toBe('catalyst_axis_resource'); // resource
  });

  it('파워 촉매는 catalyst_axis_power_<powerStat>', () => {
    expect(catalystIconKey(catalystById(25)!)).toBe('catalyst_axis_power_damage');
    expect(catalystIconKey(catalystById(29)!)).toBe('catalyst_axis_power_skillAll');
  });

  it('48종 전부 아이콘 키를 반환한다(빈 문자열 없음)', () => {
    for (const c of CATALYSTS) {
      expect(catalystIconKey(c).length).toBeGreaterThan(0);
    }
  });
});
