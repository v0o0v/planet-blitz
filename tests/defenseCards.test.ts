/**
 * 방어 카드 데이터·롤러 테스트 (Lane A — data/defenseCards.ts + src/items/rollCard.ts).
 *
 * 커버리지:
 *   - rollCard 결정론(같은 시드 → 같은 카드), 등급별 어픽스 수·사용 횟수 범위, 어픽스 값/kind/distinct.
 *   - 유니크 카드: 고정 어픽스 수 + 등록된 uniqueId.
 *   - 합성 확률 통계(고정 시드 배열): n→m 50% / m→r 20% / r→u 3% 근사, 승급/실패 등급 규칙.
 *   - 상점 로테이션 결정론(같은 날·유저 동일 재고, normal·magic 만, 재고 범위).
 *   - 방어 성공 획득 확률(OQ#2 산식): 경계·단조·clamp.
 *   - 분해 환급 단조, 직렬화 계약 상수(보관 20).
 */

import { describe, it, expect } from 'vitest';
import { rollCard, attemptFusion, rollShopRotation } from '../src/items/rollCard.js';
import {
  CARD_PREFIXES,
  CARD_SUFFIXES,
  CARD_AFFIX_BY_ID,
  CARD_CHARGE_RANGE,
  CARD_UNIQUE_AFFIX_COUNT,
  CARD_STORAGE_CAP,
  DEFENSE_CARD_UNIQUES,
  DEFENSE_CARD_UNIQUE_BY_ID,
  FUSION_CHANCE,
  FUSION_INPUT_COUNT,
  dailyShopRotation,
  defenseSuccessDropChance,
  DROP_CP_DIFF_CAP,
  nextRarityUp,
  cardSalvageValue,
  SHOP_NORMAL_RANGE,
  SHOP_MAGIC_RANGE,
} from '../data/defenseCards.js';
import type { Rarity } from '../src/items/types.js';

const RARITIES: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];

// ---------------------------------------------------------------------------
// rollCard — 결정론 + 등급별 규칙
// ---------------------------------------------------------------------------
describe('rollCard — 결정론 카드 롤러', () => {
  it('같은 시드 + 등급 → 바이트 동일 카드', () => {
    for (const seed of [1, 42, 0xdeadbeef, 123456789]) {
      for (const rarity of RARITIES) {
        expect(rollCard(seed, rarity)).toEqual(rollCard(seed, rarity));
      }
    }
  });

  it('등급별 어픽스 수: normal 0 / magic 1~2 / rare 3~6 / unique 고정', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const normal = rollCard(seed, 'normal');
      expect(normal.prefixes.length + normal.suffixes.length).toBe(0);

      const magic = rollCard(seed, 'magic');
      const magicCount = magic.prefixes.length + magic.suffixes.length;
      expect(magicCount).toBeGreaterThanOrEqual(1);
      expect(magicCount).toBeLessThanOrEqual(2);

      const rare = rollCard(seed, 'rare');
      const rareCount = rare.prefixes.length + rare.suffixes.length;
      expect(rareCount).toBeGreaterThanOrEqual(3);
      expect(rareCount).toBeLessThanOrEqual(6);

      const unique = rollCard(seed, 'unique');
      expect(unique.prefixes.length + unique.suffixes.length).toBe(CARD_UNIQUE_AFFIX_COUNT);
    }
  });

  it('사용 횟수는 등급 범위 내이고 chargesLeft = chargesMax(생성 시)', () => {
    for (let seed = 1; seed <= 400; seed++) {
      for (const rarity of RARITIES) {
        const card = rollCard(seed, rarity);
        const [lo, hi] = CARD_CHARGE_RANGE[rarity];
        expect(card.chargesMax).toBeGreaterThanOrEqual(lo);
        expect(card.chargesMax).toBeLessThanOrEqual(hi);
        expect(card.chargesLeft).toBe(card.chargesMax);
      }
    }
  });

  it('어픽스는 distinct 하며 값이 [min,max] 내, kind 로 접두/접미 분류가 정확', () => {
    const card = rollCard(777, 'rare');
    const ids = new Set<string>();
    for (const roll of [...card.prefixes, ...card.suffixes]) {
      expect(ids.has(roll.id)).toBe(false); // distinct
      ids.add(roll.id);
      const def = CARD_AFFIX_BY_ID.get(roll.id);
      expect(def).toBeDefined();
      expect(roll.value).toBeGreaterThanOrEqual(def!.min);
      expect(roll.value).toBeLessThanOrEqual(def!.max);
      expect(roll.stat).toBe(def!.stat);
    }
    // 접두 배열은 전부 prefix-kind, 접미 배열은 전부 suffix-kind.
    for (const p of card.prefixes) expect(CARD_AFFIX_BY_ID.get(p.id)!.kind).toBe('prefix');
    for (const s of card.suffixes) expect(CARD_AFFIX_BY_ID.get(s.id)!.kind).toBe('suffix');
  });

  it('id 는 시드 파생, seed 필드 보존', () => {
    const card = rollCard(555, 'magic');
    expect(card.id).toBe('card-555');
    expect(card.seed).toBe(555);
  });

  it('유니크 카드는 등록된 uniqueId 를 갖고 어픽스 수 고정', () => {
    for (const seed of [1, 999, 0xdeadbeef, 424242, 7, 88]) {
      const card = rollCard(seed, 'unique');
      expect(card.rarity).toBe('unique');
      expect(card.uniqueId).toBeDefined();
      expect(DEFENSE_CARD_UNIQUE_BY_ID.has(card.uniqueId!)).toBe(true);
      expect(card.prefixes.length + card.suffixes.length).toBe(CARD_UNIQUE_AFFIX_COUNT);
    }
  });

  it('비유니크 카드는 uniqueId 가 없다', () => {
    for (const rarity of ['normal', 'magic', 'rare'] as Rarity[]) {
      expect(rollCard(12345, rarity).uniqueId).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 카탈로그 무결성
// ---------------------------------------------------------------------------
describe('카드 어픽스 카탈로그', () => {
  it('접두 8종(정적 카운터)에 condition, 접미 8종(동적 트리거)에 trigger 지정', () => {
    expect(CARD_PREFIXES).toHaveLength(8);
    expect(CARD_SUFFIXES).toHaveLength(8);
    for (const p of CARD_PREFIXES) {
      expect(p.kind).toBe('prefix');
      expect(p.condition).toBeDefined();
      expect(p.min).toBeLessThanOrEqual(p.max);
    }
    for (const s of CARD_SUFFIXES) {
      expect(s.kind).toBe('suffix');
      expect(s.trigger).toBeDefined();
      expect(s.min).toBeLessThanOrEqual(s.max);
    }
  });

  it('어픽스 id 는 전역 유일(재번호 금지 계약)', () => {
    const ids = [...CARD_PREFIXES, ...CARD_SUFFIXES].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('유니크 4종은 유일 id + 파라미터를 갖는다', () => {
    expect(DEFENSE_CARD_UNIQUES).toHaveLength(4);
    const ids = DEFENSE_CARD_UNIQUES.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const u of DEFENSE_CARD_UNIQUES) {
      expect(Object.keys(u.params).length).toBeGreaterThan(0);
    }
  });

  it('보관 상한 상수 = 20(만석 규칙)', () => {
    expect(CARD_STORAGE_CAP).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 합성 — 등급 규칙 + 확률 통계
// ---------------------------------------------------------------------------
describe('attemptFusion — 3장 승급 판정', () => {
  it('결정론: 같은 시드+등급 → 같은 결과', () => {
    for (const seed of [1, 42, 999, 0xabcdef]) {
      expect(attemptFusion(seed, 'normal')).toEqual(attemptFusion(seed, 'normal'));
    }
  });

  it('승급 성공 → 상위 등급 카드, 실패 → 동급 카드', () => {
    for (let seed = 1; seed <= 500; seed++) {
      for (const rarity of ['normal', 'magic', 'rare'] as Rarity[]) {
        const r = attemptFusion(seed, rarity);
        if (r.promoted) expect(r.card.rarity).toBe(nextRarityUp(rarity));
        else expect(r.card.rarity).toBe(rarity);
      }
    }
  });

  it('unique 합성은 승급 불가 — 항상 동급 유니크 재롤', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = attemptFusion(seed, 'unique');
      expect(r.promoted).toBe(false);
      expect(r.card.rarity).toBe('unique');
      expect(r.card.uniqueId).toBeDefined();
    }
  });

  it('FUSION_INPUT_COUNT = 3(3장 소모 규칙)', () => {
    expect(FUSION_INPUT_COUNT).toBe(3);
  });

  it('승급 확률이 설정값과 통계적으로 일치(고정 시드 배열)', () => {
    const N = 20000;
    const cases: { rarity: Rarity; expected: number; tol: number }[] = [
      { rarity: 'normal', expected: FUSION_CHANCE.normal!, tol: 0.02 },
      { rarity: 'magic', expected: FUSION_CHANCE.magic!, tol: 0.02 },
      { rarity: 'rare', expected: FUSION_CHANCE.rare!, tol: 0.01 },
    ];
    for (const { rarity, expected, tol } of cases) {
      let promoted = 0;
      for (let seed = 1; seed <= N; seed++) {
        if (attemptFusion(seed, rarity).promoted) promoted++;
      }
      const rate = promoted / N;
      expect(Math.abs(rate - expected)).toBeLessThan(tol);
    }
  });
});

// ---------------------------------------------------------------------------
// 상점 로테이션 — 결정론 + 재고 규칙
// ---------------------------------------------------------------------------
describe('dailyShopRotation — 일일 로테이션', () => {
  it('같은 날 같은 유저 → 동일 재고(시드 검증)', () => {
    expect(dailyShopRotation(20260718, 4242)).toEqual(dailyShopRotation(20260718, 4242));
    expect(rollShopRotation(20260718, 4242)).toEqual(rollShopRotation(20260718, 4242));
  });

  it('normal·magic 만 등장하며 재고 범위 준수(normal 3~4 + magic 1~2)', () => {
    for (let day = 0; day < 60; day++) {
      for (const user of [1, 4242, 99999, 0xbeef]) {
        const slots = dailyShopRotation(20260700 + day, user);
        const normals = slots.filter((s) => s.rarity === 'normal').length;
        const magics = slots.filter((s) => s.rarity === 'magic').length;
        expect(normals).toBeGreaterThanOrEqual(SHOP_NORMAL_RANGE[0]);
        expect(normals).toBeLessThanOrEqual(SHOP_NORMAL_RANGE[1]);
        expect(magics).toBeGreaterThanOrEqual(SHOP_MAGIC_RANGE[0]);
        expect(magics).toBeLessThanOrEqual(SHOP_MAGIC_RANGE[1]);
        // 레어·유니크는 상점에 없음.
        expect(slots.every((s) => s.rarity === 'normal' || s.rarity === 'magic')).toBe(true);
      }
    }
  });

  it('rollShopRotation 이 계획을 실제 카드로 확정(등급·시드 일치)', () => {
    const plan = dailyShopRotation(20260718, 7);
    const cards = rollShopRotation(20260718, 7);
    expect(cards).toHaveLength(plan.length);
    for (let i = 0; i < plan.length; i++) {
      expect(cards[i]!.rarity).toBe(plan[i]!.rarity);
      expect(cards[i]!.seed).toBe(plan[i]!.seed);
    }
  });

  it('날짜/유저가 다르면 재고가 갈린다(로테이션 감각)', () => {
    const a = dailyShopRotation(20260718, 7);
    const b = dailyShopRotation(20260719, 7); // 다음 날
    const c = dailyShopRotation(20260718, 8); // 다른 유저
    // 시드 시퀀스가 달라 최소 한 슬롯은 다르다(길이가 같아도 seed 상이).
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });
});

// ---------------------------------------------------------------------------
// 방어 성공 획득 확률 (OQ#2)
// ---------------------------------------------------------------------------
describe('defenseSuccessDropChance — 전투력 차 계수(OQ#2)', () => {
  const base = 0.05;

  it('차 ≤ 0 → base(약한 공격자는 상승 없음)', () => {
    expect(defenseSuccessDropChance(base, 100, 100)).toBeCloseTo(base, 10);
    expect(defenseSuccessDropChance(base, 50, 300)).toBeCloseTo(base, 10);
  });

  it('차 = CAP → base 의 2배(최대)', () => {
    expect(defenseSuccessDropChance(base, DROP_CP_DIFF_CAP, 0)).toBeCloseTo(base * 2, 10);
  });

  it('차 ≥ CAP 는 상한(2배에서 포화)', () => {
    expect(defenseSuccessDropChance(base, DROP_CP_DIFF_CAP * 3, 0)).toBeCloseTo(base * 2, 10);
  });

  it('차 = CAP/2 → base × 1.5(선형 중간)', () => {
    expect(defenseSuccessDropChance(base, DROP_CP_DIFF_CAP / 2, 0)).toBeCloseTo(base * 1.5, 10);
  });

  it('전투력 차 단조: 차가 클수록 확률↑(상한까지)', () => {
    let prev = -1;
    for (let diff = 0; diff <= DROP_CP_DIFF_CAP; diff += 250) {
      const p = defenseSuccessDropChance(base, diff, 0);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

// ---------------------------------------------------------------------------
// 분해 환급
// ---------------------------------------------------------------------------
describe('cardSalvageValue — 분해 환급', () => {
  it('등급 단조: 동일 조건에서 상위 등급 환급이 크다', () => {
    // 어픽스 없는 노말 vs 매직 기저 비교(간단히 실제 롤 카드로).
    const normal = cardSalvageValue(rollCard(1, 'normal'));
    const rare = cardSalvageValue(rollCard(1, 'rare'));
    const unique = cardSalvageValue(rollCard(1, 'unique'));
    expect(rare).toBeGreaterThan(normal);
    expect(unique).toBeGreaterThan(rare);
  });

  it('어픽스가 많을수록 환급↑(같은 등급)', () => {
    // 같은 등급이라도 어픽스 수가 다르면 환급이 다름 — 여러 시드 중 어픽스 수 차이를 찾는다.
    const low = cardSalvageValue({
      id: 'x',
      rarity: 'rare',
      prefixes: [],
      suffixes: [],
      chargesMax: 3,
      chargesLeft: 3,
      seed: 0,
    });
    const high = cardSalvageValue({
      id: 'y',
      rarity: 'rare',
      prefixes: [{ id: 'cc-quench', stat: 'incomingDmgReductionPct', value: 10 }],
      suffixes: [{ id: 'ct-fury', stat: 'turretFireRatePct', value: 20 }],
      chargesMax: 3,
      chargesLeft: 1,
      seed: 0,
    });
    expect(high).toBeGreaterThan(low);
  });

  it('항상 양의 정수', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const rarity of RARITIES) {
        const v = cardSalvageValue(rollCard(seed, rarity));
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
  });
});
