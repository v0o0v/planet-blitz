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
  type BlueprintUnitProgress,
  type DailyRewardCandidate,
  type DailyRewardProgressInput,
  type DailyRewardSubject,
  blueprintCandidates,
  blueprintValue,
  catalystCandidates,
  catalystValue,
  commissionCandidates,
  commissionValue,
  coreModuleCandidates,
  coreModuleValue,
  currencyCandidates,
  gearCandidates,
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
import { CATALYSTS, SLOT_CAP } from '../src/data/catalysts.js';
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

/** 슬라이스 2 의 형제 축 하나만 켠 입력. 나머지 축은 부재 → 후보 0개. */
function withAxis(patch: Partial<DailyRewardProgressInput>): DailyRewardProgressInput {
  return { ...emptyInput(), ...patch };
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
// 나머지 5축 생산기 (슬라이스 2 · C7)
// ---------------------------------------------------------------------------

describe('촉매 축 — 주입 슬롯을 채우는 것이 목표다', () => {
  it('보유 총량이 슬롯 상한 이상이면 후보가 없다 — 견인할 것이 없다', () => {
    const out = catalystCandidates(
      withAxis({ catalyst: { owned: [{ catalystId: 0, qty: SLOT_CAP }] } }),
    );
    expect(out).toEqual([]);
  });

  it('보유 종류가 있으면 그 종류만 후보다 — 부족분 전액을 준다', () => {
    const out = catalystCandidates(
      withAxis({ catalyst: { owned: [{ catalystId: 3, qty: 1 }, { catalystId: 7, qty: 1 }] } }),
    );
    expect(out.map((c) => c.detail.goalId).sort()).toEqual(
      ['catalyst:slots:3', 'catalyst:slots:7'].sort(),
    );
    for (const c of out) {
      const s = c.detail.subject;
      expect(s.axis).toBe('catalyst');
      // 총 2개 보유 → 남은 칸은 SLOT_CAP-2. 수량을 SLOT_CAP 상대로 적는 것이 계약이다 —
      // 예전 판은 2+1=3 을 박아 두어 ADR-0052(8→3)에서 후보가 0이 되며 단언이 공허해졌다.
      if (s.axis === 'catalyst') expect(s.count).toBe(SLOT_CAP - 2);
    }
  });

  it('보유가 하나도 없으면 공용 촉매만 후보다 — 특산은 행성이 잠근다', () => {
    const out = catalystCandidates(withAxis({ catalyst: { owned: [] } }));
    expect(out.length).toBeGreaterThan(0);
    const commonIds = new Set(CATALYSTS.filter((c) => c.kind === 'common').map((c) => c.id));
    for (const c of out) {
      const s = c.detail.subject;
      if (s.axis === 'catalyst') expect(commonIds.has(s.catalystId)).toBe(true);
    }
  });

  it('많이 가질수록 목표가 가깝다 — 거리가 단조 감소한다', () => {
    const at = (qty: number): number => {
      const out = catalystCandidates(withAxis({ catalyst: { owned: [{ catalystId: 0, qty }] } }));
      return out[0]?.distance ?? Number.POSITIVE_INFINITY;
    };
    // 상한 상대로 잰다. 절대 수량(1·4·7)을 박으면 SLOT_CAP 이 내려갈 때 상한 이상인 표본이
    // 후보 0 → Infinity 가 되어 "단조 감소"가 아니라 "둘 다 없음"을 통과시킨다.
    expect(at(0)).toBeGreaterThan(at(1));
    expect(at(1)).toBeGreaterThan(at(SLOT_CAP - 1));
    // 상한에 닿으면 후보 자체가 사라진다(위 첫 케이스의 짝) — Infinity 가 정상 종단이다.
    expect(at(SLOT_CAP)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('설계도 축 — 막고 있는 것이 설계도인 목표만 본다', () => {
  const unit = (patch: Partial<BlueprintUnitProgress> = {}): BlueprintUnitProgress => ({
    key: 'u1',
    kind: 0,
    catalogId: 2,
    rarity: 'normal',
    ascension: 0,
    dupBlueprints: 0,
    ...patch,
  });

  it('설계도가 이미 충분하면 승급 후보를 만들지 않는다', () => {
    const plenty = unit({ dupBlueprints: 999, rarity: 'unique' });
    expect(blueprintCandidates(withAxis({ blueprint: { units: [plenty] } }))).toEqual([]);
  });

  it('승급·등급승급 두 목표가 서로 다른 goalId 로 선다', () => {
    const out = blueprintCandidates(withAxis({ blueprint: { units: [unit()] } }));
    const ids = out.map((c) => c.detail.goalId);
    expect(ids).toContain('bpAscend:u1:0');
    expect(ids).toContain('bpRarity:u1:normal');
  });

  it('지급물이 그 방어체의 (kind, catalogId) 를 그대로 겨눈다 — 다른 설계도는 승급을 못 연다', () => {
    const out = blueprintCandidates(
      withAxis({ blueprint: { units: [unit({ kind: 2, catalogId: 5 })] } }),
    );
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      const s = c.detail.subject;
      expect(s.axis).toBe('blueprint');
      if (s.axis === 'blueprint') {
        expect(s.kind).toBe(2);
        expect(s.catalogId).toBe(5);
        expect(s.count).toBeGreaterThan(0);
      }
    }
  });

  it('보유 장수가 늘수록 거리가 준다 — 부족분 비율이다', () => {
    const at = (dup: number): number => {
      const out = blueprintCandidates(
        withAxis({ blueprint: { units: [unit({ ascension: 3, dupBlueprints: dup })] } }),
      );
      const c = out.find((x) => x.detail.goalId === 'bpAscend:u1:3');
      return c?.distance ?? Number.POSITIVE_INFINITY;
    };
    expect(at(1)).toBeGreaterThan(at(3));
  });
});

describe('코어 모듈 축 — 강화 슬롯을 채우는 것이 목표다', () => {
  it('슬롯 수만큼 이미 갖고 있으면 후보가 없다', () => {
    const out = coreModuleCandidates(
      withAxis({ coreModule: { equipSlots: 2, owned: 2, rarities: RARITY_BY_CODE } }),
    );
    expect(out).toEqual([]);
  });

  it('등급마다 후보가 서고 값이 등급에 단조 증가한다 — 예산이 고른다', () => {
    const out = coreModuleCandidates(
      withAxis({ coreModule: { equipSlots: 2, owned: 0, rarities: RARITY_BY_CODE } }),
    );
    expect(out.length).toBe(RARITY_BY_CODE.length);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.value).toBeGreaterThan(out[i - 1]!.value);
    }
  });

  it('걸음 순번이 남은 슬롯을 표시한다 — 부족분 전액 등식이 성립하지 않는 축이다', () => {
    const out = coreModuleCandidates(
      withAxis({ coreModule: { equipSlots: 2, owned: 1, rarities: ['normal'] } }),
    );
    expect(out[0]?.step).toEqual({ index: 2, total: 2 });
    expect(out[0]?.distance).toBeCloseTo(0.5);
  });
});

describe('장비 축 — 등급마다 후보가 하나씩 선다', () => {
  /** 여덟 장착 위치. `-1` = 빈 슬롯. */
  const slots = (...codes: number[]): number[] => codes;

  it('전 슬롯이 그 등급 이상이면 그 등급의 목표는 끝났다', () => {
    const full = slots(3, 3, 3, 3, 3, 3, 3, 3);
    const out = gearCandidates(withAxis({ gear: { slotRarityCodes: full, shipLevel: 40 } }));
    expect(out).toEqual([]);
  });

  it('낮은 등급일수록 목표가 가깝다 — 빈 슬롯만 세기 때문이다', () => {
    // 빈 2칸 + 노말 3칸 + 매직 3칸.
    const mixed = slots(-1, -1, 0, 0, 0, 1, 1, 1);
    const out = gearCandidates(withAxis({ gear: { slotRarityCodes: mixed, shipLevel: 20 } }));
    const byId = new Map(out.map((c) => [c.detail.goalId, c]));
    expect(byId.get('gear:normal')!.distance).toBeLessThan(byId.get('gear:magic')!.distance);
    expect(byId.get('gear:magic')!.distance).toBeLessThan(byId.get('gear:rare')!.distance);
  });

  it('요구 레벨이 기체 레벨을 넘지 않는다 (ADR-0030)', () => {
    const out = gearCandidates(
      withAxis({ gear: { slotRarityCodes: slots(-1, -1, -1, -1, -1, -1, -1, -1), shipLevel: 7 } }),
    );
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      const s = c.detail.subject;
      if (s.axis === 'gear') expect(s.requiredLevel).toBeLessThanOrEqual(7);
    }
  });
});

describe('의뢰서 축 — 보관 상한이 후보를 먼저 거른다', () => {
  it('만석이면 후보가 없다 — 낙찰만 되고 지급이 없는 하루를 막는다', () => {
    const out = commissionCandidates(withAxis({ commission: { stock: 12, stockCap: 12 } }));
    expect(out).toEqual([]);
  });

  it('상한을 넘겨 보관 중이어도 후보가 없다(손상 상태 방어)', () => {
    expect(commissionCandidates(withAxis({ commission: { stock: 30, stockCap: 12 } }))).toEqual([]);
  });

  it('계급 1..4 가 후보로 서고 값이 계급에 단조 증가한다', () => {
    const out = commissionCandidates(withAxis({ commission: { stock: 0, stockCap: 12 } }));
    expect(out.length).toBe(4);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.value).toBeGreaterThan(out[i - 1]!.value);
    }
  });

  it('재고가 찰수록 거리가 준다', () => {
    const at = (stock: number): number =>
      commissionCandidates(withAxis({ commission: { stock, stockCap: 12 } }))[0]!.distance;
    expect(at(1)).toBeGreaterThan(at(9));
  });
});

describe('5축이 붙어도 낙찰 결정론은 유지된다 (AC-13)', () => {
  it('축을 늘려도 같은 후보 집합은 같은 낙찰을 낸다 — 배열 순서를 안 본다', () => {
    const input = withAxis({
      catalyst: { owned: [{ catalystId: 0, qty: 1 }] },
      commission: { stock: 3, stockCap: 12 },
      coreModule: { equipSlots: 2, owned: 0, rarities: ['normal', 'magic'] },
      gear: { slotRarityCodes: [-1, -1, 0, 0, 1, 1, 2, 2], shipLevel: 30 },
    });
    const cs = produceDailyRewardCandidates(input);
    expect(cs.length).toBeGreaterThan(4);
    const forward = pickDailyReward(cs, 50_000, 77, 5).candidate.detail.goalId;
    const reversed = pickDailyReward([...cs].reverse(), 50_000, 77, 5).candidate.detail.goalId;
    expect(reversed).toBe(forward);
  });

  it('축이 늘면 폴백이 줄어든다 — 재화 후보가 0개인 입력에서도 낙찰이 난다', () => {
    // 재화 목표가 하나도 없는 상태(전부 이미 살 수 있음)인데 다른 축은 살아 있다.
    const input = withAxis({ commission: { stock: 0, stockCap: 12 } });
    expect(currencyCandidates(input)).toEqual([]);
    const pick = pickDailyReward(produceDailyRewardCandidates(input), 50_000, 1, 1);
    expect(pick.fallback).toBe(false);
    expect(pick.candidate.axis).toBe('commission');
  });
});

// ---------------------------------------------------------------------------
// 축·레지스트리 (슬라이스 경계)
// ---------------------------------------------------------------------------

describe('축 레지스트리 — 슬라이스 2 에서 6축이 전부 등록됐다', () => {
  it('6축이 전부 선언돼 있다 — 가치 환산표는 6축을 덮는다 (AC-16)', () => {
    expect([...DAILY_REWARD_AXES].sort()).toEqual(
      ['blueprint', 'catalyst', 'commission', 'coreModule', 'currency', 'gear'].sort(),
    );
  });

  it('6축 전부에 생산기가 등록돼 있다 (C7)', () => {
    expect([...Object.keys(DAILY_REWARD_PRODUCERS)].sort()).toEqual([...DAILY_REWARD_AXES].sort());
  });

  it('축 상태가 안 실린 호출은 그 축의 후보가 0개다 — 스텁이 아니라 입력 부재다', () => {
    // 재화 상태만 실어 보낸다. 나머지 다섯은 각자 `undefined` 를 보고 빈 배열을 낸다 —
    // 이것이 "미구현"과 구분되는 이유는 레지스트리에 **키가 있기** 때문이다(AC-12).
    const onlyCurrency = withCurrency({ stashExpansions: 0, stashMaxExpansions: 4, credits: 100 });
    for (const axis of DAILY_REWARD_AXES) {
      if (axis === 'currency') continue;
      expect(DAILY_REWARD_PRODUCERS[axis]?.(onlyCurrency)).toEqual([]);
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
