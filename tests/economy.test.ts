/**
 * 경제 비용 공식 테스트(data/economy.ts).
 *
 * 단조성(등급↑→비용↑, 어픽스↑→비용↑, 레벨↑→리스펙↑, 회차↑→확장↑), 노 출력 3축(ADR-0040),
 * 경계값(0레벨·고착0·회차0), 앵커(구 하드코딩 값 보존), 재화 부족 시 실행 거부를 검증한다.
 */

import { describe, it, expect } from 'vitest';
import {
  rerollBaseCost,
  rollCost,
  baseRisk,
  meltRisk,
  respecCostCredits,
  stashExpansionCost,
  canAfford,
  REROLL_BASE,
  REROLL_PER_RARITY,
  REROLL_PER_AFFIX,
  HEAT,
  HEATS,
  RISK_CAP,
  RISK_EXP,
  RISK_MAX,
  RESPEC_CREDITS_PER_LEVEL,
  STASH_EXPANSION_BASE,
} from '../data/economy.js';
import type { Heat } from '../data/economy.js';
import type { Rarity } from '../src/items/types.js';
import {
  defaultProfile,
  respecCost,
  respecSkills,
  activeShip,
  investSkill,
  MAX_STASH_EXPANSIONS,
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

describe('economy: 노 출력 배수(ADR-0040)', () => {
  it('테이블 키 집합이 HEATS 와 정확히 일치한다', () => {
    expect(HEATS).toEqual(['low', 'mid', 'high']);
    expect(Object.keys(HEAT).sort()).toEqual([...HEATS].sort());
  });

  it('앵커: mid 는 현행 단발 리롤과 동일 비용(×1)', () => {
    expect(HEAT.mid.costMult).toBe(1);
    expect(HEAT.mid.riskMult).toBe(1);
    expect(rollCost('magic', 1, 'mid')).toBe(rerollBaseCost('magic', 1));
    expect(rollCost('magic', 1, 'mid')).toBe(12);
  });

  it('세 축이 한 몸으로 움직인다: 비용·위험·밴드 모두 low < mid < high 단조 증가', () => {
    for (let i = 1; i < HEATS.length; i++) {
      const prev = HEAT[HEATS[i - 1]!];
      const cur = HEAT[HEATS[i]!];
      expect(cur.costMult).toBeGreaterThan(prev.costMult);
      expect(cur.riskMult).toBeGreaterThan(prev.riskMult);
      expect(cur.band).toBeGreaterThan(prev.band);
    }
  });

  it('밴드는 [0,1] 안에 있다(레인 A 의 band 계약 전제)', () => {
    for (const h of HEATS) {
      expect(HEAT[h].band).toBeGreaterThanOrEqual(0);
      expect(HEAT[h].band).toBeLessThanOrEqual(1);
    }
  });

  it('rollCost: 노 출력↑ → 비용 단조 증가', () => {
    for (let i = 1; i < HEATS.length; i++) {
      expect(rollCost('rare', 3, HEATS[i]!)).toBeGreaterThan(rollCost('rare', 3, HEATS[i - 1]!));
    }
  });

  it('rollCost 는 항상 정수를 돌려준다(올림)', () => {
    for (const h of HEATS) {
      for (const rarity of ['normal', 'magic', 'rare', 'unique'] as Rarity[]) {
        for (let a = 0; a <= 6; a++) {
          const c = rollCost(rarity, a, h);
          expect(Number.isInteger(c)).toBe(true);
          expect(c).toBe(Math.ceil(rerollBaseCost(rarity, a) * HEAT[h].costMult));
        }
      }
    }
  });

  it('rollCost 올림 경계: 소수 배수여도 절삭이 아니라 올림이다', () => {
    // low(×0.6) · magic·어픽스 1개(기본 12) → 7.2 → 8
    expect(rollCost('magic', 1, 'low')).toBe(8);
  });

  it('결정론: 같은 입력은 항상 같은 값', () => {
    expect(rollCost('rare', 4, 'high')).toBe(rollCost('rare', 4, 'high'));
  });
});

describe('economy: 용해 위험(ADR-0040)', () => {
  it('고착 0 → baseRisk 가 어떤 어픽스 수에서도 정확히 0(하위 호환)', () => {
    for (let count = 0; count <= 8; count++) {
      expect(baseRisk(0, count)).toBe(0);
    }
    expect(baseRisk(-3, 4)).toBe(0); // 음수 방어
  });

  it('고착 0 → meltRisk 가 모든 heat 에서 정확히 0(하위 호환의 핵심 한 줄)', () => {
    for (const h of HEATS) {
      for (let count = 0; count <= 8; count++) {
        expect(meltRisk(0, count, h)).toBe(0);
      }
    }
  });

  it('어픽스 0 → 0(0 나눗셈 방어)', () => {
    expect(baseRisk(2, 0)).toBe(0);
    for (const h of HEATS) expect(meltRisk(2, 0, h)).toBe(0);
  });

  it('고착 수 단조: 고착이 늘수록 위험이 커진다', () => {
    const count = 6;
    for (let n = 1; n <= count; n++) {
      expect(baseRisk(n, count)).toBeGreaterThan(baseRisk(n - 1, count));
    }
    for (const h of HEATS) {
      for (let n = 1; n < count; n++) {
        // 클램프에 닿기 전 구간에서 단조(닿은 뒤에는 같아질 수 있다)
        expect(meltRisk(n, count, h)).toBeGreaterThanOrEqual(meltRisk(n - 1, count, h));
      }
    }
  });

  it('공식 일치: RISK_CAP × (n/count)^RISK_EXP', () => {
    expect(baseRisk(3, 6)).toBeCloseTo(RISK_CAP * Math.pow(0.5, RISK_EXP), 12);
    expect(baseRisk(6, 6)).toBeCloseTo(RISK_CAP, 12);
  });

  it('전부 고착이어도 baseRisk 는 RISK_CAP 을 넘지 않는다(비율 클램프)', () => {
    expect(baseRisk(6, 6)).toBeLessThanOrEqual(RISK_CAP);
    expect(baseRisk(99, 6)).toBe(RISK_CAP); // n > count 방어
  });

  it('노 출력 단조: heat↑ → 같은 고착 수에서 위험↑', () => {
    for (let i = 1; i < HEATS.length; i++) {
      expect(meltRisk(2, 6, HEATS[i]!)).toBeGreaterThan(meltRisk(2, 6, HEATS[i - 1]!));
    }
  });

  it('RISK_MAX 클램프가 실제로 걸린다: high·전부 고착 = 0.85×1.8 = 1.53 → RISK_MAX', () => {
    const raw = RISK_CAP * HEAT.high.riskMult;
    expect(raw).toBeGreaterThan(RISK_MAX); // 클램프가 유효한 경계인지 먼저 확인
    expect(meltRisk(6, 6, 'high')).toBe(RISK_MAX);
  });

  it('클램프 직전 구간은 클램프되지 않는다(무조건 상한이 아니다)', () => {
    expect(meltRisk(1, 6, 'low')).toBeLessThan(RISK_MAX);
    expect(meltRisk(1, 6, 'low')).toBeCloseTo(baseRisk(1, 6) * HEAT.low.riskMult, 12);
  });

  it('확률은 언제나 [0,1] 안에 있다', () => {
    for (const h of HEATS) {
      for (let count = 1; count <= 8; count++) {
        for (let n = 0; n <= count; n++) {
          const r = meltRisk(n, count, h);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('결정론: 무작위·시계 없이 같은 입력은 같은 값', () => {
    const h: Heat = 'mid';
    expect(meltRisk(3, 5, h)).toBe(meltRisk(3, 5, h));
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
  it('앵커: 1회차(확장 0개) = 1000 크레딧', () => {
    expect(STASH_EXPANSION_BASE).toBe(1000);
    expect(stashExpansionCost(0)).toBe(1000);
  });

  it('제곱 곡선: BASE×회차² (1000 · 4000 · 9000 · 16000)', () => {
    expect(stashExpansionCost(1)).toBe(4000);
    expect(stashExpansionCost(2)).toBe(9000);
    expect(stashExpansionCost(3)).toBe(16000);
  });

  it('회차 단조: 확장 수↑ → 비용↑', () => {
    expect(stashExpansionCost(1)).toBeGreaterThan(stashExpansionCost(0));
    expect(stashExpansionCost(2)).toBeGreaterThan(stashExpansionCost(1));
  });

  it('가속: 증가폭 자체가 회차마다 커진다(선형이 아니다)', () => {
    const d1 = stashExpansionCost(1) - stashExpansionCost(0);
    const d2 = stashExpansionCost(2) - stashExpansionCost(1);
    const d3 = stashExpansionCost(3) - stashExpansionCost(2);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
  });

  it('상한(MAX_STASH_EXPANSIONS)까지 전부 사면 누적 30000 크레딧', () => {
    let total = 0;
    for (let n = 0; n < MAX_STASH_EXPANSIONS; n++) total += stashExpansionCost(n);
    expect(total).toBe(30_000);
  });

  it('결정론 정수: 같은 입력은 항상 같은 정수, 음수는 1회차로 방어', () => {
    expect(Number.isInteger(stashExpansionCost(3))).toBe(true);
    expect(stashExpansionCost(2)).toBe(stashExpansionCost(2));
    expect(stashExpansionCost(-5)).toBe(STASH_EXPANSION_BASE);
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
