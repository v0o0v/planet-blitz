/**
 * 경제 비용 공식 테스트(data/economy.ts).
 *
 * 단조성(등급↑→비용↑, 어픽스↑→비용↑, 레벨↑→리스펙↑, 회차↑→확장↑), 잠금 배수(GDD §9),
 * 경계값(0레벨·잠금0·회차0), 앵커(구 하드코딩 값 보존), 재화 부족 시 실행 거부를 검증한다.
 */

import { describe, it, expect } from 'vitest';
import {
  rerollBaseCost,
  rerollCost,
  lockMultiplier,
  respecCostCredits,
  stashExpansionCost,
  canAfford,
  REROLL_BASE,
  REROLL_PER_RARITY,
  REROLL_PER_AFFIX,
  LOCKED_REROLL_MULT,
  RESPEC_CREDITS_PER_LEVEL,
  STASH_EXPANSION_BASE,
} from '../data/economy.js';
import type { Rarity } from '../src/items/types.js';
import {
  defaultProfile,
  respecCost,
  respecSkills,
  activeShip,
  investSkill,
} from '../src/save/profile.js';

describe('economy: 어픽스 리롤 비용', () => {
  it('앵커: magic·어픽스 1개 = 광물 12(구 하드코딩 값)', () => {
    expect(rerollBaseCost('magic', 1)).toBe(12);
  });

  it('등급 단조: 동일 어픽스 수에서 normal < magic < rare < unique', () => {
    const order: Rarity[] = ['normal', 'magic', 'rare', 'unique'];
    for (let i = 1; i < order.length; i++) {
      expect(rerollBaseCost(order[i]!, 3)).toBeGreaterThan(rerollBaseCost(order[i - 1]!, 3));
    }
  });

  it('레어가 매직보다 비싸다(요구사항 명시)', () => {
    expect(rerollBaseCost('rare', 2)).toBeGreaterThan(rerollBaseCost('magic', 2));
  });

  it('어픽스 수 단조: 동일 등급에서 어픽스가 많을수록 비싸다', () => {
    expect(rerollBaseCost('rare', 6)).toBeGreaterThan(rerollBaseCost('rare', 3));
    expect(rerollBaseCost('magic', 2)).toBeGreaterThan(rerollBaseCost('magic', 1));
  });

  it('공식 일치: BASE + PER_RARITY×rank + PER_AFFIX×affix', () => {
    // rare(rank 2)·4어픽스
    expect(rerollBaseCost('rare', 4)).toBe(REROLL_BASE + REROLL_PER_RARITY * 2 + REROLL_PER_AFFIX * 4);
  });
});

describe('economy: 잠금 배수(GDD §9)', () => {
  it('잠금 0 → ×1(일반 리롤)', () => {
    expect(lockMultiplier(0)).toBe(1);
  });

  it('잠금 1 → ×3(GDD "잠금 시 비용 3배")', () => {
    expect(lockMultiplier(1)).toBe(LOCKED_REROLL_MULT);
    expect(lockMultiplier(1)).toBe(3);
  });

  it('잠금 수 비례: 잠금 2 → ×6', () => {
    expect(lockMultiplier(2)).toBe(LOCKED_REROLL_MULT * 2);
  });

  it('rerollCost: 잠금 리롤 = 기본 × 잠금 배수', () => {
    const base = rerollBaseCost('rare', 3);
    expect(rerollCost('rare', 3, 0)).toBe(base);
    expect(rerollCost('rare', 3, 1)).toBe(base * 3);
    expect(rerollCost('rare', 3, 2)).toBe(base * 6);
  });

  it('rerollCost 기본 인자(lockCount 생략) = 잠금 없음', () => {
    expect(rerollCost('magic', 1)).toBe(rerollBaseCost('magic', 1));
  });
});

describe('economy: 리스펙 비용', () => {
  it('앵커: 레벨 1당 100 크레딧', () => {
    expect(RESPEC_CREDITS_PER_LEVEL).toBe(100);
    expect(respecCostCredits(1)).toBe(100);
  });

  it('레벨 경계 0 → 0', () => {
    expect(respecCostCredits(0)).toBe(0);
  });

  it('레벨 단조: 레벨↑ → 리스펙↑', () => {
    for (let lv = 1; lv <= 100; lv++) {
      expect(respecCostCredits(lv)).toBeGreaterThan(respecCostCredits(lv - 1));
    }
  });

  it('음수 방어: 음수 레벨 → 0', () => {
    expect(respecCostCredits(-5)).toBe(0);
  });
});

describe('economy: 창고 확장 비용', () => {
  it('앵커: 1회차(확장 0개) = 200 크레딧', () => {
    expect(STASH_EXPANSION_BASE).toBe(200);
    expect(stashExpansionCost(0)).toBe(200);
  });

  it('회차 비례: 2회차(확장 1개) = 400', () => {
    expect(stashExpansionCost(1)).toBe(400);
  });

  it('회차 단조: 확장 수↑ → 비용↑', () => {
    expect(stashExpansionCost(1)).toBeGreaterThan(stashExpansionCost(0));
    expect(stashExpansionCost(2)).toBeGreaterThan(stashExpansionCost(1));
  });
});

describe('economy: canAfford 게이트', () => {
  it('잔고 ≥ 비용 → true', () => {
    expect(canAfford(12, 12)).toBe(true);
    expect(canAfford(13, 12)).toBe(true);
  });

  it('잔고 < 비용 → false', () => {
    expect(canAfford(11, 12)).toBe(false);
    expect(canAfford(0, 1)).toBe(false);
  });
});

describe('economy: 소비처 배선(재화 부족 시 실행 거부)', () => {
  it('리스펙: respecCost 는 공식과 일치하고, 부족 시 respecSkills 거부', () => {
    const p = defaultProfile();
    const ship = activeShip(p);
    ship.level = 5;
    p.skillPoints = 10;
    expect(investSkill(p, 0)).toBe(true); // 트리에 최소 1포인트 투자(리스펙 대상 존재)
    expect(respecCost(p)).toBe(respecCostCredits(ship.level));

    p.credits = respecCost(p) - 1; // 1 부족
    expect(respecSkills(p)).toBe(false); // 실행 거부
    p.credits = respecCost(p); // 정확히 지불 가능
    expect(respecSkills(p)).toBe(true);
  });
});
