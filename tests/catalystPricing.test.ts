/**
 * 촉매 상점 가격 파생 — 48종 전수 단위 테스트 (ADR-0042, 계획 1단계).
 *
 * 가격 정본은 TS 이고 SQL 은 시드된 정수를 조회한다. 이 파일은 **정본 쪽**을 잠그고,
 * TS↔SQL 미러 대조는 `tests/catalystShopContract.test.ts` 가 맡는다.
 */
import { describe, expect, it } from 'vitest';

import {
  CATALYSTS,
  CATALYST_BASE_PRICE,
  CATALYST_PRICE_MIRROR,
  SALVAGE_RATIO_PCT,
  catalystBuyPrice,
  catalystIsPurchasable,
  catalystSalvageValue,
} from '../src/data/catalysts';

/** 계획이 못 박은 전수 기대값 — dropWeight 계단 5종에 대한 (구매가, 환급) 쌍. */
const EXPECTED_BY_WEIGHT: ReadonlyMap<number, readonly [number, number]> = new Map([
  [10, [10, 5]], // 공용 일반 (W_COMMON)
  [2, [50, 25]], // 파워축 (W_POWER)
  [1, [100, 50]], // ascendant (W_POWER_SKILLALL)
  [8, [12, 6]], // 특산 일반 (W_SIGNATURE) — 12.5 를 floor
  [4, [25, 12]], // 특산 보스 (W_SIGNATURE_BOSS)
]);

describe('촉매 상점 가격 파생', () => {
  it('밸런스 상수가 계획값과 일치한다', () => {
    expect(CATALYST_BASE_PRICE).toBe(10);
    expect(SALVAGE_RATIO_PCT).toBe(50);
  });

  it('48종 전부에 대해 구매가·환급이 정수로 절하된 기대값과 일치한다', () => {
    expect(CATALYSTS.length).toBe(48);
    for (const def of CATALYSTS) {
      const expected = EXPECTED_BY_WEIGHT.get(def.dropWeight);
      expect(expected, `dropWeight ${def.dropWeight} 기대값 미등록 (${def.slug})`).toBeDefined();
      const [buy, salvage] = expected!;
      expect(catalystBuyPrice(def.id), `${def.slug} 구매가`).toBe(buy);
      expect(catalystSalvageValue(def.id), `${def.slug} 환급`).toBe(salvage);
      expect(Number.isInteger(catalystBuyPrice(def.id))).toBe(true);
      expect(Number.isInteger(catalystSalvageValue(def.id))).toBe(true);
    }
  });

  it('특산 12종이 12.5 를 절하해 12 를 낸다 (Math.round 면 13 이라 계획 기대값과 어긋난다)', () => {
    const w8 = CATALYSTS.filter((c) => c.dropWeight === 8);
    expect(w8.length).toBeGreaterThan(0);
    for (const def of w8) expect(catalystBuyPrice(def.id)).toBe(12);
  });

  it('환급 결합 순서는 floor(price × pct / 100) × qty 다 — floor 안에 qty 를 넣으면 갈린다', () => {
    // buy_price 25(특산 보스) · qty 3 에서 36 vs 37 로 갈리는 지점.
    const bossSig = CATALYSTS.find((c) => c.dropWeight === 4);
    expect(bossSig).toBeDefined();
    const perUnit = catalystSalvageValue(bossSig!.id);
    expect(perUnit * 3).toBe(36);
    expect(Math.floor((catalystBuyPrice(bossSig!.id) * SALVAGE_RATIO_PCT * 3) / 100)).toBe(37);
  });

  it('미지 id 는 구매가 0 · 환급 0 · 구매 불가다', () => {
    expect(catalystBuyPrice(9999)).toBe(0);
    expect(catalystSalvageValue(9999)).toBe(0);
    expect(catalystIsPurchasable(9999)).toBe(false);
  });

  it('구매 가능 집합이 공용 30종(id 0~29)과 정확히 일치한다', () => {
    const purchasable = CATALYSTS.filter((c) => catalystIsPurchasable(c.id)).map((c) => c.id);
    expect(purchasable).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it('CATALYST_PRICE_MIRROR 가 카탈로그 전 행을 id 순으로 싣는다', () => {
    expect(CATALYST_PRICE_MIRROR.length).toBe(CATALYSTS.length);
    for (const [i, row] of CATALYST_PRICE_MIRROR.entries()) {
      expect(row.catalystId).toBe(CATALYSTS[i]!.id);
      expect(row.buyPrice).toBe(catalystBuyPrice(row.catalystId));
      expect(row.purchasable).toBe(catalystIsPurchasable(row.catalystId));
    }
  });

  it('모든 구매가가 양수라 price-unset 게이트에 걸리지 않는다', () => {
    for (const row of CATALYST_PRICE_MIRROR) expect(row.buyPrice).toBeGreaterThan(0);
  });
});
