/**
 * 방어 카드 경제 네트워크 계층 테스트 (src/net/cards.ts — M6 Lane D).
 *
 * 커버리지:
 *   1. no-op 모드(config=null): 모든 공개 함수가 SDK/네트워크 없이 안전값(null/false/[])을 돌려줌.
 *   2. fake 게이트웨이: 구매·합성·분해·보관함·장착·상점이력 위임 + 예외 흡수.
 *   3. 상점 로테이션 재현(rollCurrentShop/computeShopSeeds) — 순수·결정론(서버 호출 없음).
 */

import { describe, it, expect } from 'vitest';
import {
  getCardsUserId,
  buyShopCard,
  fuseCards,
  salvageCard,
  listCardInventory,
  fetchCardEquip,
  equipCard,
  listCardShopPurchases,
  rollCurrentShop,
  computeShopSeeds,
  type CardsGateway,
  type CardOwned,
  type CardEquipState,
  type CardBuyResult,
  type CardFuseResult,
  type CardSalvageResult,
} from '../src/net/cards.js';

/** 위임·실패 시뮬레이션용 fake 게이트웨이. */
class FakeCardsGateway implements CardsGateway {
  fail = false;
  uid = 'me-1';
  inventory: CardOwned[] = [];
  equip: CardEquipState = { defenseId: 'def-1', equippedCardId: null };
  purchases: number[] = [];
  equipCalls: { defenseId: string; cardId: string | null }[] = [];
  buyResult: CardBuyResult = { ok: true, cardId: 'c9', rarity: 'magic', credits: 500, price: 100 };
  fuseResult: CardFuseResult = { ok: true, cardId: 'c10', rarity: 'rare', promoted: true };
  salvageResult: CardSalvageResult = { ok: true, salvaged: 40, credits: 540, rarity: 'rare' };

  async getUserId(): Promise<string> {
    if (this.fail) throw new Error('offline');
    return this.uid;
  }
  async buyShopCard(): Promise<CardBuyResult> {
    if (this.fail) throw new Error('offline');
    return this.buyResult;
  }
  async fuseCards(): Promise<CardFuseResult> {
    if (this.fail) throw new Error('offline');
    return this.fuseResult;
  }
  async salvageCard(): Promise<CardSalvageResult> {
    if (this.fail) throw new Error('offline');
    return this.salvageResult;
  }
  async listInventory(): Promise<CardOwned[]> {
    if (this.fail) throw new Error('offline');
    return this.inventory;
  }
  async fetchEquip(): Promise<CardEquipState> {
    if (this.fail) throw new Error('offline');
    return this.equip;
  }
  async setEquippedCard(defenseId: string, cardId: string | null): Promise<void> {
    if (this.fail) throw new Error('rejected');
    this.equipCalls.push({ defenseId, cardId });
  }
  async listShopPurchases(): Promise<number[]> {
    if (this.fail) throw new Error('offline');
    return this.purchases;
  }
}

describe('net/cards — no-op 모드(미설정)', () => {
  const cfg = { config: null } as const;
  it('공개 함수가 SDK 없이 안전값을 돌려준다', async () => {
    expect(await getCardsUserId(cfg)).toBeNull();
    expect(await buyShopCard(0, cfg)).toBeNull();
    expect(await fuseCards(['a', 'b', 'c'], cfg)).toBeNull();
    expect(await salvageCard('x', cfg)).toBeNull();
    expect(await listCardInventory(cfg)).toBeNull();
    expect(await fetchCardEquip(cfg)).toBeNull();
    expect(await equipCard('d', 'c', cfg)).toBe(false);
    expect(await listCardShopPurchases(0, cfg)).toBeNull();
  });
});

describe('net/cards — fake 게이트웨이 위임', () => {
  it('정상 경로: 각 함수가 게이트웨이 결과를 그대로 전달', async () => {
    const g = new FakeCardsGateway();
    const deps = { gateway: g };
    expect(await getCardsUserId(deps)).toBe('me-1');
    expect(await buyShopCard(2, deps)).toEqual(g.buyResult);
    expect(await fuseCards(['a', 'b', 'c'], deps)).toEqual(g.fuseResult);
    expect(await salvageCard('x', deps)).toEqual(g.salvageResult);
    g.inventory = [{ id: 'c1', rarity: 'rare', chargesLeft: 3, card: {} as CardOwned['card'] }];
    expect(await listCardInventory(deps)).toBe(g.inventory);
    expect(await fetchCardEquip(deps)).toEqual(g.equip);
    expect(await equipCard('def-1', 'c1', deps)).toBe(true);
    expect(g.equipCalls).toEqual([{ defenseId: 'def-1', cardId: 'c1' }]);
    g.purchases = [0, 3];
    expect(await listCardShopPurchases(123, deps)).toEqual([0, 3]);
  });

  it('해제(cardId=null)도 위임된다', async () => {
    const g = new FakeCardsGateway();
    expect(await equipCard('def-1', null, { gateway: g })).toBe(true);
    expect(g.equipCalls).toEqual([{ defenseId: 'def-1', cardId: null }]);
  });

  it('게이트웨이 예외는 삼키고 안전값 반환(throw 안 함)', async () => {
    const g = new FakeCardsGateway();
    g.fail = true;
    const deps = { gateway: g };
    expect(await buyShopCard(0, deps)).toBeNull();
    expect(await fuseCards(['a', 'b', 'c'], deps)).toBeNull();
    expect(await salvageCard('x', deps)).toBeNull();
    expect(await listCardInventory(deps)).toBeNull();
    expect(await fetchCardEquip(deps)).toBeNull();
    expect(await equipCard('d', 'c', deps)).toBe(false);
    expect(await listCardShopPurchases(0, deps)).toBeNull();
  });
});

describe('net/cards — 상점 로테이션 재현(순수·결정론)', () => {
  it('같은 uid+nowMs 는 동일 재고(서버 호출 없음)', () => {
    const now = 1_760_000_000_000;
    const a = rollCurrentShop('user-abc', now);
    const b = rollCurrentShop('user-abc', now);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    // 재고는 normal·magic 만(스펙 R6).
    for (const c of a) expect(['normal', 'magic']).toContain(c.rarity);
  });

  it('다른 uid 는 (대개) 다른 재고 시드, computeShopSeeds 는 순수', () => {
    const now = 1_760_000_000_000;
    const s1 = computeShopSeeds('user-abc', now);
    const s2 = computeShopSeeds('user-xyz', now);
    expect(s1.dateSeed).toBe(s2.dateSeed); // 같은 날
    expect(s1.userSeed).not.toBe(s2.userSeed); // 다른 유저
  });
});
