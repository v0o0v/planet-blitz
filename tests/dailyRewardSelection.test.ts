/**
 * 일일 보상 — 진행 견인 후보 생산기 · 가치 환산표 · 낙찰의 잠금 (AC-10 ~ AC-17).
 *
 * 잠그는 것은 **정책이 코드에 있는가**다. 각 `it` 은 스펙 AC 번호를 인용한다 — 인용 없는
 * 단언은 나중에 "왜 이 값이지?"가 되어 조용히 완화된다(`tests/dailyRewardRamp.test.ts` 규율).
 *
 * 수치는 전부 밸런스 placeholder 이므로 **절대값을 단언하지 않는다.** 단언하는 것은 부호·
 * 단조성·순서·결정론뿐이다 — 출시 전 일괄 튜닝이 이 파일을 빨갛게 만들면 그 테스트가 잘못
 * 쓰인 것이다.
 */

import { describe, expect, it } from 'vitest';

import {
  COMMISSION_VALUE_BASE,
  DAILY_FALLBACK_GOAL_ID,
  DAILY_REWARD_AXES,
  DAILY_REWARD_PRODUCERS,
  type DailyRewardCandidate,
  type DailyRewardProgressInput,
  type DailyRewardSubject,
  blueprintValue,
  catalystValue,
  commissionValue,
  coreModuleValue,
  currencyCandidates,
  currencyValue,
  gearValue,
  makeCandidate,
  pickDailyReward,
  budgetTopUpCredits,
  toppedUpValue,
  produceDailyRewardCandidates,
  subjectValue,
} from '../data/dailyRewardSelection.js';
import { DAILY_BUDGET_DAY_1, resolveDailyBudget } from '../data/dailyReward.js';
import type { Rarity } from '../src/items/types.js';
import { RARITY_BY_CODE } from '../src/items/types.js';
import { stashExpansionCost } from '../data/economy.js';
import { moduleBuyPrice } from '../data/coreModules.js';

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

/** 아무 목표도 세워지지 않는 맨몸 입력 — 각 테스트가 필요한 축만 켠다. */
function emptyInput(): DailyRewardProgressInput {
  return {
    currency: {
      credits: 0,
      minerals: 0,
      stashExpansions: 0,
      stashMaxExpansions: 0,
      shipLevel: 0,
      wantsRespec: false,
      defenseUnits: [],
      moduleOffers: [],
    },
  };
}

function withCurrency(patch: Partial<DailyRewardProgressInput['currency']>): DailyRewardProgressInput {
  return { currency: { ...emptyInput().currency, ...patch } };
}

/** 거리·가치를 직접 지정한 합성 후보(낙찰 규칙만 시험할 때 쓴다). */
function synth(goalId: string, credits: number, distance: number): DailyRewardCandidate {
  const subject: DailyRewardSubject = { axis: 'currency', credits, minerals: 0 };
  return makeCandidate(goalId, subject, distance);
}

// ---------------------------------------------------------------------------
// 가치 환산표 (AC-16)
// ---------------------------------------------------------------------------

describe('가치 환산표 — 6축이 하나의 단위로 접힌다 (AC-16)', () => {
  it('AC-16: 전 축의 가치가 유한·양수다', () => {
    const subjects: DailyRewardSubject[] = [
      { axis: 'currency', credits: 1, minerals: 0 },
      { axis: 'currency', credits: 0, minerals: 1 },
      { axis: 'catalyst', catalystId: 0, count: 1 },
      // 미등록 id — `catalystBuyPrice` 가 0 을 돌려주는 자리다. 하한이 없으면 여기서 0 이 샌다.
      { axis: 'catalyst', catalystId: 9_999, count: 1 },
      { axis: 'blueprint', kind: 0, catalogId: 2, count: 1 },
      { axis: 'blueprint', kind: 99, catalogId: 99, count: 1 }, // 카탈로그 밖 → 대체 가중치
      { axis: 'coreModule', rarity: 'normal' },
      { axis: 'gear', rarity: 'normal', requiredLevel: 1 },
      { axis: 'commission', grade: 1 },
    ];
    for (const s of subjects) {
      const v = subjectValue(s);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('AC-16: 같은 축에서 등급이 오르면 가치가 단조 증가한다 — 코어 모듈', () => {
    let prev = -Infinity;
    for (const rarity of RARITY_BY_CODE) {
      const v = coreModuleValue(rarity);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('AC-16: 같은 축에서 등급이 오르면 가치가 단조 증가한다 — 장비', () => {
    let prev = -Infinity;
    for (const rarity of RARITY_BY_CODE) {
      const v = gearValue(rarity, 10);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    // 요구 레벨도 단조 축이다 — 같은 등급이라도 후반 드랍이 비싸다.
    let prevLv = -Infinity;
    for (const lv of [1, 10, 30, 60, 100]) {
      const v = gearValue('rare', lv);
      expect(v).toBeGreaterThan(prevLv);
      prevLv = v;
    }
  });

  it('AC-16: 같은 축에서 계급이 오르면 가치가 단조 증가한다 — 의뢰서', () => {
    let prev = -Infinity;
    for (const g of [1, 2, 3, 4] as const) {
      const v = commissionValue(g);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(commissionValue(1)).toBe(COMMISSION_VALUE_BASE);
  });

  it('AC-16: 등급 없는 축은 수량에 단조 증가한다 — 재화·촉매·설계도', () => {
    for (const n of [2, 3, 7]) {
      expect(currencyValue(n, 0)).toBeGreaterThan(currencyValue(n - 1, 0));
      expect(currencyValue(0, n)).toBeGreaterThan(currencyValue(0, n - 1));
      expect(catalystValue(0, n)).toBeGreaterThan(catalystValue(0, n - 1));
      expect(blueprintValue(0, 2, n)).toBeGreaterThan(blueprintValue(0, 2, n - 1));
    }
  });

  it('AC-16: 광물이 크레딧보다 무겁다 — 두 재화가 같은 자로 재진다', () => {
    expect(currencyValue(0, 1)).toBeGreaterThan(currencyValue(1, 0));
  });

  it('상점가와 갈리지 않는다 — 코어 모듈 가치가 `moduleBuyPrice` 그대로다', () => {
    // 별도 계수를 세우면 같은 모듈이 상점과 일일 보상에서 다른 값이 되어 재정거래가 열린다.
    for (const rarity of RARITY_BY_CODE) {
      expect(coreModuleValue(rarity)).toBe(moduleBuyPrice(rarity));
    }
  });

  it('설계도는 희소할수록(가중치가 낮을수록) 비싸다', () => {
    // 카르곤 특산: 편대2(weight 3) vs 설비4(weight 4) — 가중치가 낮은 쪽이 비싸야 한다.
    expect(blueprintValue(0, 2, 1)).toBeGreaterThan(blueprintValue(1, 4, 1));
  });

  it('손상 입력(음수·NaN·Infinity)이 가치를 NaN·무한대로 만들지 않는다', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const v = subjectValue({ axis: 'currency', credits: bad, minerals: bad });
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    expect(Number.isFinite(gearValue('rare', Number.NaN))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 후보 생산기 (AC-10)
// ---------------------------------------------------------------------------

describe('currencyCandidates — 재화 축 목표 후보 (AC-10)', () => {
  it('AC-10: 목표마다 후보가 서고 거리 점수가 붙는다', () => {
    const cs = currencyCandidates(
      withCurrency({ credits: 0, stashExpansions: 0, stashMaxExpansions: 4 }),
    );
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) {
      expect(c.axis).toBe('currency');
      expect(c.distance).toBeGreaterThan(0);
      expect(c.distance).toBeLessThanOrEqual(1);
      expect(c.value).toBeGreaterThan(0);
      expect(Number.isFinite(c.value)).toBe(true);
    }
  });

  it('아무 목표도 없는 상태는 후보 0개다 — 폴백 경로를 실제로 밟는다 (AC-12 준비)', () => {
    expect(currencyCandidates(emptyInput())).toEqual([]);
  });

  it('이미 살 수 있는 목표는 후보가 아니다 — 견인할 것이 없다', () => {
    const cost = stashExpansionCost(0);
    const rich = currencyCandidates(
      withCurrency({ credits: cost, stashExpansions: 0, stashMaxExpansions: 4 }),
    );
    expect(rich.some((c) => c.detail.goalId === 'stash:1')).toBe(false);
    // 1 크레딧이 모자라면 다시 후보가 된다.
    const poor = currencyCandidates(
      withCurrency({ credits: cost - 1, stashExpansions: 0, stashMaxExpansions: 4 }),
    );
    expect(poor.some((c) => c.detail.goalId === 'stash:1')).toBe(true);
  });

  it('후보의 가치 = 부족분 전액이다 — 보상이 그 목표를 정확히 연다', () => {
    const cost = stashExpansionCost(0);
    const cs = currencyCandidates(
      withCurrency({ credits: cost - 250, stashExpansions: 0, stashMaxExpansions: 4 }),
    );
    const stash = cs.find((c) => c.detail.goalId === 'stash:1');
    expect(stash).toBeDefined();
    expect(stash?.value).toBe(250);
    const subject = stash?.detail.subject;
    expect(subject?.axis).toBe('currency');
    if (subject?.axis === 'currency') {
      expect(subject.credits).toBe(250);
      expect(subject.minerals).toBe(0);
    }
  });

  it('거리는 정규화된다 — 축이 달라도 "거의 다 왔다"가 같은 숫자다', () => {
    const cost = stashExpansionCost(0);
    const cs = currencyCandidates(
      withCurrency({
        credits: cost / 2,
        minerals: 0,
        stashExpansions: 0,
        stashMaxExpansions: 4,
        refining: { rarity: 'rare', affixCount: 4, heat: 'mid' },
      }),
    );
    const stash = cs.find((c) => c.detail.goalId === 'stash:1');
    const refine = cs.find((c) => c.detail.goalId === 'refine:roll');
    expect(stash?.distance).toBeCloseTo(0.5, 6);
    // 광물이 0 이므로 정련은 전액이 모자란다 → 거리 1.
    expect(refine?.distance).toBeCloseTo(1, 6);
  });

  it('정련 목표는 광물로 지급된다 — 싱크의 재화를 그대로 준다', () => {
    const cs = currencyCandidates(
      withCurrency({ refining: { rarity: 'magic', affixCount: 2, heat: 'low' } }),
    );
    const refine = cs.find((c) => c.detail.goalId === 'refine:roll');
    expect(refine).toBeDefined();
    const subject = refine?.detail.subject;
    if (subject?.axis === 'currency') {
      expect(subject.minerals).toBeGreaterThan(0);
      expect(subject.credits).toBe(0);
    }
  });

  it('리스펙은 의사가 있을 때만 후보다 — 안 찍은 조종사에게 리스펙 목표는 소음이다', () => {
    const off = currencyCandidates(withCurrency({ shipLevel: 30, wantsRespec: false }));
    expect(off.some((c) => c.detail.goalId === 'respec')).toBe(false);
    const on = currencyCandidates(withCurrency({ shipLevel: 30, wantsRespec: true }));
    expect(on.some((c) => c.detail.goalId === 'respec')).toBe(true);
  });

  it('설계도가 모자란 승급은 재화 축의 목표가 아니다 — 막고 있는 것이 크레딧이 아니다', () => {
    const blocked = currencyCandidates(
      withCurrency({
        defenseUnits: [
          { key: 'u1', rarity: 'normal', level: 1, ascension: 0, dupBlueprints: 0 },
        ],
      }),
    );
    expect(blocked.some((c) => c.detail.goalId.includes(':ascend:'))).toBe(false);

    const ready = currencyCandidates(
      withCurrency({
        defenseUnits: [
          { key: 'u1', rarity: 'normal', level: 1, ascension: 0, dupBlueprints: 99 },
        ],
      }),
    );
    expect(ready.some((c) => c.detail.goalId.includes(':ascend:'))).toBe(true);
  });

  it('같은 등급 모듈이 재고에 여럿이어도 목표는 하나다', () => {
    const cs = currencyCandidates(withCurrency({ moduleOffers: ['normal', 'normal', 'magic'] }));
    const moduleGoals = cs.filter((c) => c.detail.goalId.startsWith('module:'));
    expect(moduleGoals.length).toBe(2);
  });

  it('목표 식별자가 회차마다 다르다 — 창고 2회차와 3회차가 같은 목표로 보이면 안 된다 (AC-14)', () => {
    const a = currencyCandidates(withCurrency({ stashExpansions: 1, stashMaxExpansions: 4 }));
    const b = currencyCandidates(withCurrency({ stashExpansions: 2, stashMaxExpansions: 4 }));
    expect(a[0]?.detail.goalId).toBe('stash:2');
    expect(b[0]?.detail.goalId).toBe('stash:3');
  });

  it('상한에 도달한 창고는 목표를 세우지 않는다', () => {
    const cs = currencyCandidates(withCurrency({ stashExpansions: 4, stashMaxExpansions: 4 }));
    expect(cs.some((c) => c.detail.goalId.startsWith('stash:'))).toBe(false);
  });

  it('같은 입력이면 같은 후보 배열이다 — 순수 함수다', () => {
    const input = withCurrency({
      credits: 700,
      minerals: 3,
      stashExpansions: 1,
      stashMaxExpansions: 4,
      shipLevel: 22,
      wantsRespec: true,
      refining: { rarity: 'rare', affixCount: 5, heat: 'high' },
      defenseUnits: [{ key: 'u1', rarity: 'magic', level: 25, ascension: 1, dupBlueprints: 4 }],
      moduleOffers: ['normal', 'magic'],
    });
    expect(currencyCandidates(input)).toEqual(currencyCandidates(input));
  });
});

// ---------------------------------------------------------------------------
// 반복 걸음 순번 (AC-14)
// ---------------------------------------------------------------------------

describe('걸음 순번 — 반복을 카운트다운으로 바꾼다 (AC-14)', () => {
  it('AC-14: 순번이 total 을 넘지 않는다', () => {
    const inputs = [0, 1, 2, 3].map((n) =>
      withCurrency({
        stashExpansions: n,
        stashMaxExpansions: 4,
        defenseUnits: [
          { key: 'u1', rarity: 'rare', level: 5, ascension: n, dupBlueprints: 99 },
        ],
      }),
    );
    let sawStep = false;
    for (const input of inputs) {
      for (const c of currencyCandidates(input)) {
        if (c.step === undefined) continue;
        sawStep = true;
        expect(c.step.index).toBeGreaterThanOrEqual(1);
        expect(c.step.index).toBeLessThanOrEqual(c.step.total);
        expect(c.step.total).toBeGreaterThanOrEqual(1);
      }
    }
    expect(sawStep).toBe(true);
  });

  it('AC-14: 손상된 순번도 불변식 안으로 접힌다 — 화면이 "5 중 7째"를 띄우지 않는다', () => {
    const c = makeCandidate(
      'x',
      { axis: 'currency', credits: 10, minerals: 0 },
      0.5,
      { index: 7, total: 5 },
    );
    expect(c.step?.index).toBe(5);
    expect(c.step?.total).toBe(5);
    const zero = makeCandidate(
      'x',
      { axis: 'currency', credits: 10, minerals: 0 },
      0.5,
      { index: 0, total: 0 },
    );
    expect(zero.step?.index).toBe(1);
    expect(zero.step?.total).toBe(1);
  });

  it('단발 목표에는 순번이 없다 — 존재하지 않는 카운트다운을 만들지 않는다', () => {
    const cs = currencyCandidates(
      withCurrency({
        shipLevel: 10,
        wantsRespec: true,
        refining: { rarity: 'normal', affixCount: 1, heat: 'mid' },
        moduleOffers: ['rare'],
      }),
    );
    for (const c of cs) expect(c.step).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 낙찰 (AC-11)
// ---------------------------------------------------------------------------

describe('pickDailyReward — 예산 안에서 거리 최소값 (AC-11)', () => {
  it('AC-11: 거리가 가장 가까운 후보가 낙찰된다', () => {
    const cs = [synth('far', 100, 0.9), synth('near', 100, 0.1), synth('mid', 100, 0.5)];
    const pick = pickDailyReward(cs, 1_000, 1, 1);
    expect(pick.fallback).toBe(false);
    expect(pick.candidate.detail.goalId).toBe('near');
  });

  it('AC-11: 예산을 넘는 후보는 거리가 더 가까워도 낙찰되지 않는다', () => {
    const cs = [synth('closest-but-expensive', 5_000, 0.01), synth('affordable', 100, 0.8)];
    const pick = pickDailyReward(cs, 1_000, 1, 1);
    expect(pick.candidate.detail.goalId).toBe('affordable');
  });

  it('AC-11: 예산과 정확히 같은 가치는 낙찰 가능하다 — 경계는 포함이다', () => {
    const pick = pickDailyReward([synth('exact', 1_000, 0.5)], 1_000, 1, 1);
    expect(pick.fallback).toBe(false);
    expect(pick.candidate.detail.goalId).toBe('exact');
    // 1 만 넘어도 빠진다.
    expect(pickDailyReward([synth('over', 1_001, 0.5)], 1_000, 1, 1).fallback).toBe(true);
  });

  it('AC-12: 후보가 0개면 재화로 폴백한다 — 예산 전액을 크레딧으로', () => {
    const pick = pickDailyReward([], 2_345.7, 42, 7);
    expect(pick.fallback).toBe(true);
    expect(pick.candidate.axis).toBe('currency');
    expect(pick.candidate.detail.goalId).toBe(DAILY_FALLBACK_GOAL_ID);
    const s = pick.candidate.detail.subject;
    if (s.axis === 'currency') {
      expect(s.credits).toBe(2_345);
      expect(s.minerals).toBe(0);
    }
  });

  it('AC-12: 전부 예산 초과여도 폴백한다 — "후보 0개"와 같은 자리다', () => {
    const pick = pickDailyReward([synth('a', 9_999, 0.01), synth('b', 8_888, 0.02)], 500, 1, 1);
    expect(pick.fallback).toBe(true);
    expect(pick.candidate.detail.goalId).toBe(DAILY_FALLBACK_GOAL_ID);
  });

  it('생산기가 아무것도 못 세운 신규 계정도 받을 것이 있다 — 실제 예산과 이어 붙인다', () => {
    const budget = resolveDailyBudget(1, 0).budget;
    const pick = pickDailyReward(produceDailyRewardCandidates(emptyInput()), budget, 100, 200);
    expect(pick.fallback).toBe(true);
    expect(pick.candidate.value).toBe(Math.floor(DAILY_BUDGET_DAY_1));
  });
});

// ---------------------------------------------------------------------------
// 동점 tie-break 결정론 (AC-13)
// ---------------------------------------------------------------------------

describe('pickDailyReward — 동점은 시드로 결정론적으로 갈린다 (AC-13)', () => {
  /** 거리·가치가 완전히 같고 목표만 다른 동점 4후보. */
  function tied(): DailyRewardCandidate[] {
    return ['alpha', 'bravo', 'charlie', 'delta'].map((id) => synth(id, 100, 0.25));
  }

  it('AC-13: 같은 (dateSeed, userSeed) 로 100회 호출해도 낙찰이 같다', () => {
    const first = pickDailyReward(tied(), 1_000, 20_123, 0xdead_beef).candidate.detail.goalId;
    for (let i = 0; i < 100; i++) {
      expect(pickDailyReward(tied(), 1_000, 20_123, 0xdead_beef).candidate.detail.goalId).toBe(
        first,
      );
    }
  });

  it('AC-13: 후보 배열 순서를 뒤집어도 낙찰이 같다 — 입력 순서에 비의존', () => {
    const forward = tied();
    const reversed = [...forward].reverse();
    const shuffled = [forward[2], forward[0], forward[3], forward[1]] as DailyRewardCandidate[];
    const a = pickDailyReward(forward, 1_000, 777, 12).candidate.detail.goalId;
    const b = pickDailyReward(reversed, 1_000, 777, 12).candidate.detail.goalId;
    const c = pickDailyReward(shuffled, 1_000, 777, 12).candidate.detail.goalId;
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('AC-13: 순서 비의존이 여러 시드에서 유지된다', () => {
    for (let seed = 0; seed < 40; seed++) {
      const forward = tied();
      const reversed = [...forward].reverse();
      expect(pickDailyReward(reversed, 1_000, seed, seed * 31).candidate.detail.goalId).toBe(
        pickDailyReward(forward, 1_000, seed, seed * 31).candidate.detail.goalId,
      );
    }
  });

  it('AC-13: 시드가 다르면 갈림이 실제로 달라진다 — tie-break 가 죽은 장치가 아니다', () => {
    const winners = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      winners.add(pickDailyReward(tied(), 1_000, seed, 5).candidate.detail.goalId);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it('AC-13: 유저가 다르면 같은 날에도 갈림이 달라질 수 있다', () => {
    const winners = new Set<string>();
    for (let uid = 0; uid < 60; uid++) {
      winners.add(pickDailyReward(tied(), 1_000, 20_000, uid).candidate.detail.goalId);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it('동점이 아니면 시드가 낙찰을 바꾸지 않는다 — 거리가 시드를 이긴다', () => {
    const cs = [synth('near', 100, 0.1), synth('far', 100, 0.9)];
    for (let seed = 0; seed < 30; seed++) {
      expect(pickDailyReward(cs, 1_000, seed, seed).candidate.detail.goalId).toBe('near');
    }
  });

  it('내용이 같은 후보가 중복돼도 결정론이 유지된다', () => {
    const dup = [synth('same', 100, 0.3), synth('same', 100, 0.3)];
    const first = pickDailyReward(dup, 1_000, 5, 5).candidate;
    for (let i = 0; i < 20; i++) {
      const again = pickDailyReward(dup, 1_000, 5, 5).candidate;
      expect(again.detail.goalId).toBe(first.detail.goalId);
      expect(again.value).toBe(first.value);
    }
  });
});

// ---------------------------------------------------------------------------
// 축·레지스트리 (슬라이스 경계)
// ---------------------------------------------------------------------------

describe('축 레지스트리 — 슬라이스 1 은 재화만 관통한다', () => {
  it('6축이 전부 선언돼 있다 — 가치 환산표는 6축을 덮는다 (AC-16)', () => {
    expect([...DAILY_REWARD_AXES].sort()).toEqual(
      ['blueprint', 'catalyst', 'commission', 'coreModule', 'currency', 'gear'].sort(),
    );
  });

  it('등록된 생산기는 재화 하나뿐이다 — 나머지는 슬라이스 2 다', () => {
    expect(Object.keys(DAILY_REWARD_PRODUCERS)).toEqual(['currency']);
  });

  it('미등록 축은 빈 스텁이 아니라 부재다 — 폴백 원인이 읽힌다 (AC-12)', () => {
    for (const axis of DAILY_REWARD_AXES) {
      if (axis === 'currency') continue;
      expect(DAILY_REWARD_PRODUCERS[axis]).toBeUndefined();
    }
  });

  it('레지스트리 경유 수집이 재화 생산기 결과와 같다', () => {
    const input = withCurrency({ stashExpansions: 0, stashMaxExpansions: 4, credits: 100 });
    expect(produceDailyRewardCandidates(input)).toEqual(currencyCandidates(input));
  });

  it('후보의 axis 가 지급물의 axis 와 항상 같다 — 중복 필드의 불변식', () => {
    const rarities: readonly Rarity[] = RARITY_BY_CODE;
    const input = withCurrency({
      stashExpansions: 0,
      stashMaxExpansions: 4,
      shipLevel: 10,
      wantsRespec: true,
      moduleOffers: rarities,
    });
    for (const c of produceDailyRewardCandidates(input)) {
      expect(c.axis).toBe(c.detail.subject.axis);
    }
  });
});

// ---------------------------------------------------------------------------
// 예산 보정 — 예산이 천장 필터로만 작동하던 것을 하한으로도 쓴다
// ---------------------------------------------------------------------------

describe('budgetTopUpCredits — 남은 예산을 크레딧으로 채운다 (2026-08-05 확정)', () => {
  /**
   * 실화면과 30일 시뮬레이션이 함께 잡은 것: 후보의 `value` 가 **목표까지 남은 부족분 전액**
   * 이라, 40 크레딧 모자란 목표 하나가 있으면 예산 20,000 인 30일차에도 지급이 **40** 이었다.
   * 예산이 천장 필터로만 작동하고 하한이 아니어서, 연속 접속 램프가 지급액에 전혀 나타나지
   * 않았다 — *"길어질수록 지급 규모가 오른다"* 는 연속 접속의 정의가 화면에서 거짓이 됐다.
   *
   * ⚠️ 보정은 **낙찰 규칙(AC-11)을 한 글자도 건드리지 않는다.** 무엇을 고를지는 그대로
   * 거리 최소값이고, 고른 뒤 남은 예산을 재화로 채울 뿐이다.
   */
  const goal = makeCandidate(
    'test:goal',
    { axis: 'currency', credits: 100, minerals: 0 },
    0.05,
  );

  it('목표가 예산을 다 못 쓰면 차액이 보정으로 나온다', () => {
    const pick = { candidate: goal, fallback: false };
    expect(budgetTopUpCredits(pick, 20_000)).toBe(19_900);
    expect(toppedUpValue(pick, 20_000)).toBeCloseTo(20_000, 9);
  });

  it('보정 뒤 실제 지급 가치가 예산과 같다 — 이것이 램프가 보이는 조건이다', () => {
    for (const budget of [2_000, 5_000, 12_345, 20_000]) {
      const pick = { candidate: goal, fallback: false };
      expect(toppedUpValue(pick, budget)).toBeCloseTo(budget, 6);
    }
  });

  it('폴백은 이미 예산 전액이라 보정이 0 이다 — 폴백 지표가 흐려지지 않는다', () => {
    const picked = pickDailyReward([], 7_777, 20_670, 12_345);
    expect(picked.fallback).toBe(true);
    expect(budgetTopUpCredits(picked, 7_777)).toBe(0);
  });

  it('예산을 넘겨 주지 않는다 — 목표가 예산보다 크면 보정 0', () => {
    const big = makeCandidate('test:big', { axis: 'currency', credits: 50_000, minerals: 0 }, 0.5);
    expect(budgetTopUpCredits({ candidate: big, fallback: false }, 2_000)).toBe(0);
  });

  it('손상 입력에서 음수·NaN 을 내지 않는다', () => {
    const pick = { candidate: goal, fallback: false };
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const v = budgetTopUpCredits(pick, bad);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
