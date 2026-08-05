/**
 * 일일 보상 — 연속일 전이 · 직선 램프 · 진입 게이트의 순수 산식 잠금 (ADR-0048).
 *
 * 여기서 잠그는 것은 **정책이 코드에 있는가**다. 각 `it` 은 ADR / 스펙 AC 번호를 인용한다 —
 * 인용 없는 단언은 나중에 "왜 이 값이지?"가 되어 조용히 완화된다.
 */

import { describe, expect, it } from 'vitest';

import {
  DAILY_BUDGET_DAY_1,
  DAILY_BUDGET_DAY_30,
  DAILY_BUDGET_FLOOR,
  DAILY_CEILING_RATE,
  DAILY_SEED_NEVER,
  DAILY_SIDE_CREDITS,
  DAILY_STREAK_CYCLE,
  budgetCeilingFromLifetime,
  dailyDateSeed,
  nextStreak,
  resolveDailyBudget,
  shouldOpenDailyReward,
  valueBudgetForStreak,
} from '../data/dailyReward.js';
import { shopDateSeedFromMs } from '../data/coreModules.js';

// ---------------------------------------------------------------------------
// 연속 접속 전이 (AC-7 · AC-8 · AC-9)
// ---------------------------------------------------------------------------

describe('nextStreak — 연속 접속 전이', () => {
  it('AC-7: 직전 수령이 오늘−1 이면 이어진다', () => {
    expect(nextStreak(99, 100, 5)).toBe(6);
    expect(nextStreak(0, 1, 1)).toBe(2);
  });

  it('AC-8: 하루를 놓치면 1 이다 — 0 도 절반도 유지도 아니다', () => {
    expect(nextStreak(98, 100, 29)).toBe(1); // 하루 건너뜀
    expect(nextStreak(70, 100, 30)).toBe(1); // 한 달 건너뜀
    // 0 이 아님을 명시적으로 — 오늘 수령분이 이미 1일차이므로 0 이 될 수 없다.
    expect(nextStreak(98, 100, 29)).not.toBe(0);
    // 절반 후퇴가 아님을 명시적으로 — 풍화(바닥 50%) 문법을 쓰지 않는다(ADR-0048 §왜 전멸 리셋인가).
    expect(nextStreak(98, 100, 30)).not.toBe(15);
  });

  it('AC-9: 30일차 다음 수령은 1 로 돌아간다', () => {
    expect(nextStreak(99, 100, DAILY_STREAK_CYCLE)).toBe(1);
  });

  it('첫 수령(미수령 센티넬)은 1 이다', () => {
    expect(nextStreak(DAILY_SEED_NEVER, 20_000, 0)).toBe(1);
  });

  it('같은 날 재호출은 연속일을 바꾸지 않는다 — 멱등 재시도가 램프를 밀면 안 된다', () => {
    expect(nextStreak(100, 100, 7)).toBe(7);
    expect(nextStreak(100, 100, DAILY_STREAK_CYCLE)).toBe(DAILY_STREAK_CYCLE);
  });

  it('미래 시드(시계 되감김)는 끊긴 것으로 본다 — 앞으로 당겨 주면 그것이 위조 창구다', () => {
    expect(nextStreak(105, 100, 20)).toBe(1);
  });

  it('30일 완주 궤적: 1..30 을 지나 그 다음이 1 이다', () => {
    let streak = 0;
    let seed = 1_000;
    const seen: number[] = [];
    for (let day = 0; day < DAILY_STREAK_CYCLE; day++) {
      const prevSeed = day === 0 ? DAILY_SEED_NEVER : seed - 1;
      streak = nextStreak(prevSeed, seed, streak);
      seen.push(streak);
      seed += 1;
    }
    expect(seen[0]).toBe(1);
    expect(seen[DAILY_STREAK_CYCLE - 1]).toBe(DAILY_STREAK_CYCLE);
    // 31일째
    expect(nextStreak(seed - 1, seed, streak)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 진입 게이트 (AC-18)
// ---------------------------------------------------------------------------

describe('shouldOpenDailyReward — 그날 첫 기지 진입 판정', () => {
  it('AC-18: 그날 처음이면 열고, 두 번째부터는 안 연다', () => {
    expect(shouldOpenDailyReward(DAILY_SEED_NEVER, 100)).toBe(true);
    expect(shouldOpenDailyReward(99, 100)).toBe(true);
    expect(shouldOpenDailyReward(100, 100)).toBe(false);
  });

  it('재진입 경로와 무관하다 — 판정 입력이 (마지막 표시 시드, 오늘 시드) 둘뿐이다', () => {
    // 언어 전환 rerender · 하네스 refresh 는 같은 (100,100) 을 다시 넘긴다.
    for (let i = 0; i < 5; i++) expect(shouldOpenDailyReward(100, 100)).toBe(false);
  });

  it('날이 바뀌면 다시 연다', () => {
    expect(shouldOpenDailyReward(100, 101)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 날짜 경계 (ADR-0048 §왜 UTC 경계인가)
// ---------------------------------------------------------------------------

describe('dailyDateSeed — 날짜 관념을 새로 만들지 않는다', () => {
  it('shopDateSeedFromMs 와 한 바이트도 다르지 않다', () => {
    for (const ms of [0, 86_399_999, 86_400_000, 1_754_000_000_000]) {
      expect(dailyDateSeed(ms)).toBe(shopDateSeedFromMs(ms));
    }
  });

  it('UTC 자정 경계에서 정확히 1 오른다', () => {
    expect(dailyDateSeed(86_400_000) - dailyDateSeed(86_399_999)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 직선 램프 (AC-15)
// ---------------------------------------------------------------------------

describe('valueBudgetForStreak — 공통 가치 예산은 직선이다', () => {
  it('AC-15: n→n+1 증분이 전 구간에서 상수다(계단·마일스톤 없음)', () => {
    const deltas: number[] = [];
    for (let s = 1; s < DAILY_STREAK_CYCLE; s++) {
      deltas.push(valueBudgetForStreak(s + 1) - valueBudgetForStreak(s));
    }
    const first = deltas[0] as number;
    for (const d of deltas) expect(d).toBeCloseTo(first, 9);
    // 양의 기울기 — 램프가 오른다.
    expect(first).toBeGreaterThan(0);
  });

  it('끝점이 상수 정본과 일치한다', () => {
    expect(valueBudgetForStreak(1)).toBeCloseTo(DAILY_BUDGET_DAY_1, 9);
    expect(valueBudgetForStreak(DAILY_STREAK_CYCLE)).toBeCloseTo(DAILY_BUDGET_DAY_30, 9);
  });

  it('30일차가 최고점이다 — 그 위로 솟는 잭팟이 없다', () => {
    let max = -Infinity;
    for (let s = 1; s <= DAILY_STREAK_CYCLE; s++) max = Math.max(max, valueBudgetForStreak(s));
    expect(max).toBeCloseTo(valueBudgetForStreak(DAILY_STREAK_CYCLE), 9);
  });

  it('정의역 밖은 주기로 clamp 한다 — 손상된 연속일이 음수·무한 예산을 만들지 않는다', () => {
    expect(valueBudgetForStreak(0)).toBeCloseTo(DAILY_BUDGET_DAY_1, 9);
    expect(valueBudgetForStreak(-5)).toBeCloseTo(DAILY_BUDGET_DAY_1, 9);
    expect(valueBudgetForStreak(999)).toBeCloseTo(DAILY_BUDGET_DAY_30, 9);
    expect(Number.isFinite(valueBudgetForStreak(Number.MAX_SAFE_INTEGER))).toBe(true);
  });

  it('전 구간이 유한·양수다', () => {
    for (let s = 1; s <= DAILY_STREAK_CYCLE; s++) {
      const v = valueBudgetForStreak(s);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 상한 유계 — 예산 천장 (AC-17)
// ---------------------------------------------------------------------------

describe('budgetCeilingFromLifetime — 신규 계정 하한(FLOOR)', () => {
  it('lifetime_granted = 0 이어도 예산이 0 이 아니다 — "접속만으로 성립"', () => {
    expect(budgetCeilingFromLifetime(0)).toBeGreaterThan(0);
    expect(resolveDailyBudget(1, 0).budget).toBeGreaterThan(0);
  });

  it('하한이 1일차 예산과 같다 — 이 등식이 유계의 하중 부재다', () => {
    // 떼어 놓으면 한쪽만 튜닝돼 조용히 갈린다. 등식 자체를 계약으로 잠근다.
    expect(DAILY_BUDGET_FLOOR).toBe(DAILY_BUDGET_DAY_1);
  });

  it('플레이 0 계정은 연속일과 무관하게 1일차 예산에 고정된다 — 램프가 보이지 않는다', () => {
    for (let s = 1; s <= DAILY_STREAK_CYCLE; s++) {
      expect(resolveDailyBudget(s, 0).budget).toBeCloseTo(DAILY_BUDGET_DAY_1, 9);
    }
    // 30일 봇 접속이 30일차 물건을 열지 못한다 — ADR §왜 30일차 최고점에도 상한이 이기는가.
    expect(resolveDailyBudget(DAILY_STREAK_CYCLE, 0).budget).toBeLessThan(DAILY_BUDGET_DAY_30);
    expect(resolveDailyBudget(DAILY_STREAK_CYCLE, 0).clamped).toBe(true);
  });

  it('누적이 오르면 천장이 단조로 오른다', () => {
    let prev = -Infinity;
    for (const lg of [0, 10_000, 100_000, 500_000, 1_000_000, 5_000_000]) {
      const c = budgetCeilingFromLifetime(lg);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('30일차 최고점을 열려면 실제 플레이가 필요하다', () => {
    const needed = DAILY_BUDGET_DAY_30 / DAILY_CEILING_RATE;
    expect(budgetCeilingFromLifetime(needed)).toBeCloseTo(DAILY_BUDGET_DAY_30, 6);
    expect(resolveDailyBudget(DAILY_STREAK_CYCLE, needed).clamped).toBe(false);
    // 그 절반에서는 아직 물린다.
    expect(resolveDailyBudget(DAILY_STREAK_CYCLE, needed / 2).clamped).toBe(true);
  });

  it('손상 입력(음수·NaN·Infinity)이 천장을 무한대로 만들지 않는다', () => {
    for (const bad of [-1, -1e9, Number.NaN]) {
      expect(budgetCeilingFromLifetime(bad)).toBe(DAILY_BUDGET_FLOOR);
    }
    expect(budgetCeilingFromLifetime(Number.POSITIVE_INFINITY)).toBe(DAILY_BUDGET_FLOOR);
  });
});

describe('resolveDailyBudget — 30일차에도 상한 예외가 없다 (AC-17)', () => {
  it('예산은 항상 램프와 천장의 최소값이다', () => {
    for (const lg of [0, 250_000, 1_000_000, 10_000_000]) {
      for (const s of [1, 15, DAILY_STREAK_CYCLE]) {
        const r = resolveDailyBudget(s, lg);
        expect(r.budget).toBeCloseTo(Math.min(r.ramp, r.ceiling), 9);
        expect(r.budget).toBeLessThanOrEqual(r.ramp + 1e-9);
        expect(r.budget).toBeLessThanOrEqual(r.ceiling + 1e-9);
      }
    }
  });

  it('clamped 가 관측 가능한 신호다 — 천장이 물면 true, 아니면 false', () => {
    expect(resolveDailyBudget(DAILY_STREAK_CYCLE, 0).clamped).toBe(true);
    expect(resolveDailyBudget(1, 1_000_000_000).clamped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 곁들이 크레딧 — 서버 per-call 캡과의 정합성
// ---------------------------------------------------------------------------

describe('한 번의 수령이 서버 per-call 캡에 조용히 절삭되지 않는다', () => {
  /**
   * `20260805000000_daily_reward.sql` 9절이 `grant_currency_for` 의 `case p_source` 에
   * 등록한 값. ⚠️ **여기에 리터럴로 박는다** — SQL 에서 읽어 오면 상수가 틀렸을 때 양변이
   * 함께 틀려 **항진 테스트**가 된다. SQL 과 이 값의 일치는 `dailyRewardContract.test.ts`
   * 가 따로 대조한다(그쪽은 양변의 출처가 다르므로 항진이 아니다).
   */
  const CAP_DAILY_REWARD_CREDITS = 25_000;
  /** 등록하지 않았을 때 떨어졌을 자리. 이 두 값의 간격이 캡 등록의 존재 이유다. */
  const CAP_DEFAULT_CREDITS = 1_000;

  it('곁들이 + 30일차 주 보상의 합이 per-call 상한 이하다', () => {
    expect(DAILY_SIDE_CREDITS + DAILY_BUDGET_DAY_30).toBeLessThanOrEqual(CAP_DAILY_REWARD_CREDITS);
  });

  it('캡 등록이 실제로 필요했다 — CAP_DEFAULT 였다면 30일차가 잘린다', () => {
    // 이 단언이 빨개지는 유일한 경우는 보상 규모를 1000 안으로 낮췄을 때다. 그때는
    // 캡 등록을 되돌릴 수 있다는 신호이지, 이 테스트를 지우라는 신호가 아니다.
    expect(DAILY_SIDE_CREDITS + DAILY_BUDGET_DAY_30).toBeGreaterThan(CAP_DEFAULT_CREDITS);
  });

  it('1일차도 당연히 이하다(하한 쪽 회귀 방지)', () => {
    expect(DAILY_SIDE_CREDITS + DAILY_BUDGET_DAY_1).toBeLessThanOrEqual(CAP_DAILY_REWARD_CREDITS);
  });
});
