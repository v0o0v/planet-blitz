/**
 * 방어 카드 표시 헬퍼 순수 로직 테스트 (src/ui/cardsView.ts — M6 Lane D).
 *
 * 등급 색·라벨·어픽스 요약·잔여 경고·보관 게이지·합성 사전 검증·구매 오류 문구를 검증한다.
 * DOM 무관 순수 함수만 다룬다(defenseCommand DOM 조립은 별도).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { setLocale } from '../src/i18n/index.js';
import type { CardInstance } from '../data/defenseCards.js';
import type { CardOwned } from '../src/net/cards.js';
import {
  cardRarityColor,
  cardRarityLabel,
  cardAffixSummary,
  cardAffixOneLine,
  isLowCharge,
  isDepleted,
  storageGauge,
  checkFusionSelection,
  fusionCheckText,
  buyErrorText,
  shopSlotPrice,
} from '../src/ui/cardsView.js';

afterEach(() => setLocale('en'));

function card(partial: Partial<CardInstance> = {}): CardInstance {
  return {
    id: 'card-1',
    rarity: 'rare',
    prefixes: [],
    suffixes: [],
    chargesMax: 5,
    chargesLeft: 5,
    seed: 1,
    ...partial,
  };
}

function owned(id: string, rarity: string, chargesLeft = 3): CardOwned {
  return { id, rarity, chargesLeft, card: card({ id, rarity: rarity as CardInstance['rarity'] }) };
}

describe('cardsView — 등급 색·라벨', () => {
  it('cardRarityColor 는 등급별 색, 미지 등급은 normal 색', () => {
    expect(cardRarityColor('unique')).toBe('#ff8a3c');
    expect(cardRarityColor('rare')).toBe('#ffd24c');
    expect(cardRarityColor('bogus')).toBe(cardRarityColor('normal'));
  });

  it('cardRarityLabel 은 i18n 등급 라벨(로케일 반영)', () => {
    setLocale('en');
    expect(cardRarityLabel('unique')).toBe('Unique');
    setLocale('ko');
    expect(cardRarityLabel('unique')).toBe('유니크');
  });
});

describe('cardsView — 어픽스 요약', () => {
  it('접두·접미 카탈로그 name + 값, 유니크명 노출', () => {
    const c = card({
      rarity: 'unique',
      uniqueId: 'uq-blackout',
      prefixes: [{ id: 'cc-quench', stat: 'incomingDmgReductionPct', value: 12 }],
      suffixes: [{ id: 'ct-fury', stat: 'turretFireRatePct', value: 20 }],
    });
    const s = cardAffixSummary(c);
    expect(s.prefixes).toEqual(['소화의 +12']);
    expect(s.suffixes).toEqual(['의 격노 +20']);
    expect(s.unique).toBe('블랙아웃');
  });

  it('normal(어픽스 0) 은 요약 비고 oneLine 은 기저 안내', () => {
    setLocale('en');
    const c = card({ rarity: 'normal' });
    const s = cardAffixSummary(c);
    expect(s.prefixes).toEqual([]);
    expect(s.suffixes).toEqual([]);
    expect(s.unique).toBeNull();
    expect(cardAffixOneLine(c)).toBe('Base effect only');
  });
});

describe('cardsView — 잔여/보관', () => {
  it('isLowCharge 는 정확히 1회일 때만', () => {
    expect(isLowCharge(1)).toBe(true);
    expect(isLowCharge(2)).toBe(false);
    expect(isLowCharge(0)).toBe(false);
  });

  it('isDepleted 는 0 이하', () => {
    expect(isDepleted(0)).toBe(true);
    expect(isDepleted(1)).toBe(false);
  });

  it('storageGauge 백분율·만석 판정(기본 상한 20)', () => {
    expect(storageGauge(0)).toEqual({ count: 0, cap: 20, pct: 0, full: false });
    expect(storageGauge(10)).toEqual({ count: 10, cap: 20, pct: 50, full: false });
    expect(storageGauge(20)).toEqual({ count: 20, cap: 20, pct: 100, full: true });
    expect(storageGauge(25).full).toBe(true); // 초과도 만석
  });
});

describe('cardsView — 합성 사전 검증(EF 코드 정합)', () => {
  it('정확히 3장·동급·중복없음 → ok', () => {
    const sel = [owned('a', 'rare'), owned('b', 'rare'), owned('c', 'rare')];
    expect(checkFusionSelection(sel)).toEqual({ ok: true, code: 'ok' });
  });

  it('3장 미만/초과 → need-three', () => {
    expect(checkFusionSelection([owned('a', 'rare')]).code).toBe('need-three');
    expect(
      checkFusionSelection([owned('a', 'rare'), owned('b', 'rare'), owned('c', 'rare'), owned('d', 'rare')]).code,
    ).toBe('need-three');
  });

  it('같은 행 중복 → dup-ids', () => {
    const sel = [owned('a', 'rare'), owned('a', 'rare'), owned('c', 'rare')];
    expect(checkFusionSelection(sel).code).toBe('dup-ids');
  });

  it('등급 불일치 → rarity-mismatch', () => {
    const sel = [owned('a', 'rare'), owned('b', 'magic'), owned('c', 'rare')];
    expect(checkFusionSelection(sel).code).toBe('rarity-mismatch');
  });

  it('fusionCheckText: ok 는 빈 문자열, 나머지는 안내', () => {
    setLocale('en');
    expect(fusionCheckText('ok')).toBe('');
    expect(fusionCheckText('need-three')).toContain('3');
    expect(fusionCheckText('rarity-mismatch').length).toBeGreaterThan(0);
  });
});

describe('cardsView — 구매 오류·가격', () => {
  it('buyErrorText 코드별 문구(미지 코드는 일반 실패)', () => {
    setLocale('en');
    expect(buyErrorText('storage-full')).toContain('Storage');
    expect(buyErrorText('insufficient-credits')).toContain('credits');
    expect(buyErrorText('already-bought').length).toBeGreaterThan(0);
    expect(buyErrorText(undefined)).toBe(buyErrorText('weird-unknown-code'));
  });

  it('shopSlotPrice 는 서버 cardBuyPrice 와 동일(등급 단조)', () => {
    expect(shopSlotPrice('normal')).toBe(40);
    expect(shopSlotPrice('magic')).toBe(100);
    expect(shopSlotPrice('rare')).toBe(160);
    expect(shopSlotPrice('unique')).toBe(220);
  });
});
