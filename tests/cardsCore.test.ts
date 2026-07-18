/**
 * cards Edge Function 계획 코어 테스트 (M6 방어 카드 경제 — 구매·합성·드랍 순수 로직).
 *
 * cards EF 순수 코어(`supabase/functions/cards/cardsCore.ts`)를 Node(vitest)에서 직접 구동한다 —
 * 코어는 플랫폼 전역 무참조라 CI 에서 그대로 돈다(verifyInvasionCore 규율과 동일). 상점 재고 재현·
 * 가격 책정·슬롯 상한 검증·합성 입력 규칙·드랍 판정을 게이트한다. Deno 측 동형 실행은 EF check.
 */

import { describe, it, expect } from 'vitest';
import {
  planShopPurchase,
  validateFusion,
  planFusion,
  planDefenseDrop,
} from '../supabase/functions/cards/cardsCore.js';
import {
  cardBuyPrice,
  rollDropRarity,
  shopUserSeed,
  shopDateSeedFromMs,
  defenseSuccessDropChance,
  DEFENSE_DROP_BASE_CHANCE,
  CARD_BUY_BASE,
  CARD_BUY_PER_RARITY,
} from '../data/defenseCards.js';
import { rollShopRotation, attemptFusion, rollCard } from '../src/items/rollCard.js';
import type { Rarity } from '../src/items/types.js';

const DATE_SEED = 20289;
const USER_SEED = 0xabcdef12;

describe('planShopPurchase', () => {
  it('슬롯 카드를 상점 로테이션과 바이트 동일하게 재현하고 등급 가격을 매긴다', () => {
    const rotation = rollShopRotation(DATE_SEED, USER_SEED);
    expect(rotation.length).toBeGreaterThan(0);
    for (let i = 0; i < rotation.length; i++) {
      const expected = rotation[i];
      if (expected === undefined) continue;
      const r = planShopPurchase(DATE_SEED, USER_SEED, i);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.plan.card).toEqual(expected);
      expect(r.plan.rarity).toBe(expected.rarity);
      expect(r.plan.price).toBe(cardBuyPrice(expected.rarity));
    }
  });

  it('범위 밖·음수·비정수 슬롯은 bad-slot', () => {
    const len = rollShopRotation(DATE_SEED, USER_SEED).length;
    for (const bad of [-1, len, len + 5, 1.5, Number.NaN]) {
      const r = planShopPurchase(DATE_SEED, USER_SEED, bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('bad-slot');
    }
  });

  it('같은 (dateSeed,userSeed,slot)은 항상 동일 카드(결정론)', () => {
    const a = planShopPurchase(DATE_SEED, USER_SEED, 0);
    const b = planShopPurchase(DATE_SEED, USER_SEED, 0);
    expect(a).toEqual(b);
  });
});

describe('validateFusion', () => {
  const mk = (id: string, rarity: Rarity) => ({ id, rarity });

  it('동급 3장(고유 id)은 통과하고 등급을 반환', () => {
    const r = validateFusion([mk('a', 'magic'), mk('b', 'magic'), mk('c', 'magic')]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rarity).toBe('magic');
  });

  it('3장이 아니면 need-three', () => {
    expect(validateFusion([mk('a', 'magic'), mk('b', 'magic')])).toMatchObject({ ok: false, code: 'need-three' });
    expect(
      validateFusion([mk('a', 'magic'), mk('b', 'magic'), mk('c', 'magic'), mk('d', 'magic')]),
    ).toMatchObject({ ok: false, code: 'need-three' });
  });

  it('중복 id 는 dup-ids(같은 카드 3번 위조 차단)', () => {
    const r = validateFusion([mk('a', 'rare'), mk('a', 'rare'), mk('b', 'rare')]);
    expect(r).toMatchObject({ ok: false, code: 'dup-ids' });
  });

  it('등급 불일치는 rarity-mismatch', () => {
    const r = validateFusion([mk('a', 'magic'), mk('b', 'rare'), mk('c', 'magic')]);
    expect(r).toMatchObject({ ok: false, code: 'rarity-mismatch' });
  });
});

describe('planFusion', () => {
  it('attemptFusion 과 동일 결과(승급 플래그·결과 카드)', () => {
    for (const seed of [1, 12345, 0xdeadbeef]) {
      const expected = attemptFusion(seed, 'magic');
      const plan = planFusion('magic', seed);
      expect(plan.promoted).toBe(expected.promoted);
      expect(plan.card).toEqual(expected.card);
      expect(plan.rarity).toBe(expected.card.rarity);
    }
  });
});

describe('planDefenseDrop', () => {
  it('dropRoll 이 확률 미만이면 드랍(rollDropRarity·rollCard 재현)', () => {
    const seed = 777;
    const rarityRoll = 0.5; // rare 구간
    const plan = planDefenseDrop({
      base: DEFENSE_DROP_BASE_CHANCE,
      attackerCp: 0,
      defenderCp: 0,
      dropRoll: 0, // 항상 확률 미만
      rarityRoll,
      seed,
    });
    expect(plan.dropped).toBe(true);
    if (plan.dropped) {
      const rarity = rollDropRarity(rarityRoll);
      expect(plan.rarity).toBe(rarity);
      expect(plan.card).toEqual(rollCard(seed, rarity));
    }
  });

  it('dropRoll 이 확률 이상이면 미드랍', () => {
    const plan = planDefenseDrop({
      base: DEFENSE_DROP_BASE_CHANCE,
      attackerCp: 0,
      defenderCp: 0,
      dropRoll: 0.999,
      rarityRoll: 0.5,
      seed: 1,
    });
    expect(plan.dropped).toBe(false);
  });

  it('전투력 우위가 클수록 드랍 확률이 오른다(경계 roll 로 검증)', () => {
    // base=0.15, 큰 CP 차(cap) → 0.30. roll=0.2 는 base 로는 미드랍, 우위로는 드랍.
    const lo = planDefenseDrop({
      base: DEFENSE_DROP_BASE_CHANCE, attackerCp: 0, defenderCp: 0,
      dropRoll: 0.2, rarityRoll: 0.5, seed: 3,
    });
    const hi = planDefenseDrop({
      base: DEFENSE_DROP_BASE_CHANCE, attackerCp: 100000, defenderCp: 0,
      dropRoll: 0.2, rarityRoll: 0.5, seed: 3,
    });
    expect(lo.dropped).toBe(false);
    expect(hi.dropped).toBe(true);
    // 순수 함수 정합 재확인.
    expect(defenseSuccessDropChance(DEFENSE_DROP_BASE_CHANCE, 100000, 0)).toBeCloseTo(0.3, 10);
  });
});

describe('data 순수 함수(가격·시드·드랍 등급)', () => {
  it('cardBuyPrice 는 등급에 단조 증가(BASE + PER_RARITY×랭크)', () => {
    expect(cardBuyPrice('normal')).toBe(CARD_BUY_BASE);
    expect(cardBuyPrice('magic')).toBe(CARD_BUY_BASE + CARD_BUY_PER_RARITY);
    expect(cardBuyPrice('rare')).toBe(CARD_BUY_BASE + CARD_BUY_PER_RARITY * 2);
    expect(cardBuyPrice('unique')).toBe(CARD_BUY_BASE + CARD_BUY_PER_RARITY * 3);
    expect(cardBuyPrice('magic')).toBeGreaterThan(cardBuyPrice('normal'));
    expect(cardBuyPrice('unique')).toBeGreaterThan(cardBuyPrice('rare'));
  });

  it('shopUserSeed 는 uid 안정·u32 범위, 다른 uid 는 대개 다른 값', () => {
    const a = shopUserSeed('user-abc');
    expect(shopUserSeed('user-abc')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(a)).toBe(true);
    expect(shopUserSeed('user-xyz')).not.toBe(a);
  });

  it('shopDateSeedFromMs 는 UTC 일 단위(같은 날 동일, 다음 날 +1)', () => {
    const day = 20289;
    const ms = day * 86_400_000;
    expect(shopDateSeedFromMs(ms)).toBe(day);
    expect(shopDateSeedFromMs(ms + 3_600_000)).toBe(day); // 같은 날
    expect(shopDateSeedFromMs(ms + 86_400_000)).toBe(day + 1); // 다음 날
  });

  it('rollDropRarity: rare 중심 + unique 극저(경계 검증)', () => {
    expect(rollDropRarity(0)).toBe('unique');
    expect(rollDropRarity(0.039)).toBe('unique');
    expect(rollDropRarity(0.05)).toBe('magic');
    expect(rollDropRarity(0.34)).toBe('magic');
    expect(rollDropRarity(0.5)).toBe('rare');
    expect(rollDropRarity(0.999)).toBe('rare');
    // normal 은 드랍되지 않는다.
    for (const roll of [0, 0.1, 0.35, 0.7, 0.99]) {
      expect(rollDropRarity(roll)).not.toBe('normal');
    }
  });
});
