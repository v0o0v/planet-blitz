/**
 * 정련 공정 순수 코어 — `reforgeAffixes` (ADR-0040 Phase 0-A).
 *
 * 잠그는 것: ①`band = 0` + 단일 고착이 기존 `rerollAffixes` 와 완전 동일 ②밴드 상향 시 값
 * 기댓값 단조 증가 ③퇴화 범위 3종은 밴드 무관 불변 ④다중 고착의 값·인덱스 보존과 중복 없음
 * ⑤어픽스 개수 보존 ⑥`band`·`fastened` 의 방어적 정규화.
 *
 * 통계적 단언(②)은 **하드코딩 시드**로 표본을 만들어 재현 가능하게 한다.
 */

import { describe, it, expect } from 'vitest';
import { rollItem, rerollAffixes, reforgeAffixes } from '../src/items/roll.js';
import type { Item, ItemSource } from '../src/items/types.js';
import { AFFIXES, AFFIX_BY_ID } from '../data/affixes.js';

const SRC: ItemSource = { planet: 0, stage: 1 };

/** 어픽스가 넉넉한 rare 아이템(재단조 커버리지용). */
function rareWithAffixes(seed: number, min = 3): Item {
  for (let s = seed; s < seed + 500; s++) {
    const it = rollItem(s, 'rare', SRC);
    if (it.affixes.length >= min) return it;
  }
  throw new Error(`no rare with ≥${min} affixes found`);
}

/** `min === max` 인 퇴화 범위 어픽스 id 들 — 계획서가 3종(다연장·관통·빙결)이라 못 박았다. */
const DEGENERATE_IDS = AFFIXES.filter((d) => d.min === d.max).map((d) => d.id);

describe('reforgeAffixes — 정련 공정 재단조 (ADR-0040)', () => {
  it('퇴화 범위 어픽스는 정확히 3종이다 (multibarrel·piercing·freezing)', () => {
    expect(DEGENERATE_IDS.slice().sort()).toEqual(['freezing', 'multibarrel', 'piercing']);
  });

  // --- AC1: 하위 호환 -------------------------------------------------------
  describe('band = 0 하위 호환 (AC1)', () => {
    it('단일 고착 + band 0 이면 기존 rerollAffixes 와 결과가 완전히 동일하다', () => {
      for (const seed of [1000, 2000, 3000, 4000, 5000]) {
        const item = rareWithAffixes(seed);
        for (let idx = 0; idx < item.affixes.length; idx++) {
          const legacy = rerollAffixes(item, 0xbeef + seed, idx);
          const next = reforgeAffixes(item, 0xbeef + seed, { fastened: [idx], band: 0 });
          expect(next).toEqual(legacy);
        }
      }
    });

    it('고착 없음 + band 0 이면 잠금 없는 기존 rerollAffixes 와 동일하다', () => {
      const item = rareWithAffixes(6000);
      expect(reforgeAffixes(item, 77, { fastened: [], band: 0 })).toEqual(
        rerollAffixes(item, 77),
      );
      expect(reforgeAffixes(item, 77)).toEqual(rerollAffixes(item, 77));
    });

    it('opts 를 아예 주지 않아도 무잠금 리롤과 같다', () => {
      const item = rareWithAffixes(6500);
      expect(reforgeAffixes(item, 4242).affixes).toEqual(rerollAffixes(item, 4242).affixes);
    });
  });

  // --- AC2: 밴드 단조성 -----------------------------------------------------
  describe('밴드 상향 → 값 기댓값 단조 증가 (AC2)', () => {
    /**
     * 고정 시드 표본의 값 합. RNG 스트림 형태가 밴드와 무관하게 같으므로 **같은 시드면
     * 같은 어픽스가 같은 순서로 뽑힌다** — 값만 달라진다. 따라서 합의 비교가 공정하다.
     */
    function valueSum(item: Item, band: number, samples: number): number {
      let sum = 0;
      for (let s = 0; s < samples; s++) {
        const out = reforgeAffixes(item, 0x51ee_d000 + s, { band });
        for (const a of out.affixes) sum += a.value;
      }
      return sum;
    }

    it('low(0) ≤ mid(0.25) ≤ high(0.55) — 400 표본', () => {
      const item = rareWithAffixes(7000, 5);
      const low = valueSum(item, 0, 400);
      const mid = valueSum(item, 0.25, 400);
      const high = valueSum(item, 0.55, 400);
      expect(mid).toBeGreaterThanOrEqual(low);
      expect(high).toBeGreaterThanOrEqual(mid);
      // 단조성이 우연이 아니라 실제 신호임을 못 박는다(400 표본이면 여유롭게 성립).
      expect(high).toBeGreaterThan(low);
    });

    it('band = 1 이면 모든 값이 def.max 다', () => {
      const item = rareWithAffixes(7500, 4);
      for (let s = 0; s < 50; s++) {
        const out = reforgeAffixes(item, 0x1a2b_0000 + s, { band: 1 });
        for (const a of out.affixes) {
          expect(a.value).toBe(AFFIX_BY_ID.get(a.id)!.max);
        }
      }
    });

    it('어떤 밴드에서도 값은 선언된 [min, max] 안에 있다', () => {
      const item = rareWithAffixes(7800, 4);
      for (const band of [0, 0.25, 0.55, 1]) {
        for (let s = 0; s < 40; s++) {
          const out = reforgeAffixes(item, 0x3c4d_0000 + s, { band });
          for (const a of out.affixes) {
            const def = AFFIX_BY_ID.get(a.id)!;
            expect(a.value).toBeGreaterThanOrEqual(def.min);
            expect(a.value).toBeLessThanOrEqual(def.max);
            expect(a.stat).toBe(def.stat);
          }
        }
      }
    });
  });

  // --- AC3: 퇴화 범위 -------------------------------------------------------
  it('퇴화 범위 3종은 전 밴드에서 값이 불변이다 (AC3)', () => {
    const item = rareWithAffixes(8000, 5);
    let seen = 0;
    for (const band of [0, 0.25, 0.55, 1]) {
      for (let s = 0; s < 60; s++) {
        const out = reforgeAffixes(item, 0x9f00_0000 + s, { band });
        for (const a of out.affixes) {
          if (!DEGENERATE_IDS.includes(a.id)) continue;
          seen++;
          expect(a.value).toBe(AFFIX_BY_ID.get(a.id)!.min);
          expect(a.value).toBe(1);
        }
      }
    }
    // 표본이 퇴화 어픽스를 실제로 밟았는가(공허 단언 방지).
    expect(seen).toBeGreaterThan(0);
  });

  // --- AC4: 다중 고착 -------------------------------------------------------
  describe('다중 고착 (AC4)', () => {
    it('고착 어픽스는 값·인덱스가 그대로 유지되고 다른 슬롯에 중복되지 않는다', () => {
      const item = rareWithAffixes(9000, 5);
      const fastened = [0, 2, 3];
      const kept = fastened.map((i) => item.affixes[i]!);
      const out = reforgeAffixes(item, 0xfa57_0001, { fastened, band: 0.25 });

      expect(out.affixes).toHaveLength(item.affixes.length);
      for (let k = 0; k < fastened.length; k++) {
        expect(out.affixes[fastened[k]!]).toEqual(kept[k]);
      }
      // 어픽스 id 전량 중복 없음(고착분이 재추첨 풀에서 빠졌다는 증거).
      const ids = out.affixes.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('고착 순서가 뒤죽박죽이어도(정렬 전) 결과가 같다', () => {
      const item = rareWithAffixes(9200, 5);
      const a = reforgeAffixes(item, 555, { fastened: [3, 0, 2] });
      const b = reforgeAffixes(item, 555, { fastened: [0, 2, 3] });
      expect(a).toEqual(b);
    });

    it('전 어픽스 고착이면 동일한 복사본을 돌려준다', () => {
      const item = rareWithAffixes(9400, 3);
      const all = item.affixes.map((_, i) => i);
      const out = reforgeAffixes(item, 12345, { fastened: all, band: 1 });
      expect(out.affixes).toEqual(item.affixes);
      expect(out.affixes).not.toBe(item.affixes);
    });

    it('고착이 늘수록 변하는 슬롯이 줄어든다 (재단조 표면 축소)', () => {
      const item = rareWithAffixes(9600, 5);
      const none = reforgeAffixes(item, 0x77, {});
      const two = reforgeAffixes(item, 0x77, { fastened: [1, 4] });
      const unchangedNone = none.affixes.filter((a, i) => a.id === item.affixes[i]!.id).length;
      const unchangedTwo = two.affixes.filter((a, i) => a.id === item.affixes[i]!.id).length;
      expect(unchangedTwo).toBeGreaterThanOrEqual(2);
      expect(unchangedTwo).toBeGreaterThanOrEqual(unchangedNone);
    });
  });

  // --- 개수 보존 · 순수성 ----------------------------------------------------
  it('어픽스 개수와 비-어픽스 필드가 보존된다', () => {
    for (const seed of [10_000, 11_000, 12_000]) {
      const item = rareWithAffixes(seed, 3);
      const out = reforgeAffixes(item, 0xabc, { fastened: [1], band: 0.55 });
      expect(out.affixes).toHaveLength(item.affixes.length);
      expect(out.id).toBe(item.id);
      expect(out.slot).toBe(item.slot);
      expect(out.rarity).toBe(item.rarity);
      expect(out.source).toEqual(item.source);
      expect(out.weaponType).toBe(item.weaponType);
      expect(out.uniqueId).toBe(item.uniqueId);
    }
  });

  it('순수 — 입력 아이템을 변형하지 않는다', () => {
    const item = rareWithAffixes(13_000, 4);
    const snapshot = JSON.parse(JSON.stringify(item)) as Item;
    reforgeAffixes(item, 999, { fastened: [0, 2], band: 0.55 });
    expect(item).toEqual(snapshot);
  });

  it('결정론 — 같은 입력이면 같은 결과', () => {
    const item = rareWithAffixes(14_000, 4);
    const a = reforgeAffixes(item, 0xdead, { fastened: [1, 2], band: 0.25 });
    const b = reforgeAffixes(item, 0xdead, { fastened: [1, 2], band: 0.25 });
    expect(a.affixes).toEqual(b.affixes);
  });

  it('어픽스 0개 아이템은 어떤 옵션에서도 동일한 복사본', () => {
    const normal = rollItem(10, 'normal', SRC);
    expect(normal.affixes).toHaveLength(0);
    const out = reforgeAffixes(normal, 5, { fastened: [0, 1], band: 1 });
    expect(out.affixes).toEqual([]);
    expect(out).not.toBe(normal);
  });

  // --- 방어적 정규화 --------------------------------------------------------
  describe('입력 정규화', () => {
    it('band 는 [0,1] 로 클램프된다', () => {
      const item = rareWithAffixes(15_000, 4);
      expect(reforgeAffixes(item, 31, { band: -5 }).affixes).toEqual(
        reforgeAffixes(item, 31, { band: 0 }).affixes,
      );
      expect(reforgeAffixes(item, 31, { band: 9 }).affixes).toEqual(
        reforgeAffixes(item, 31, { band: 1 }).affixes,
      );
      expect(reforgeAffixes(item, 31, { band: Number.NaN }).affixes).toEqual(
        reforgeAffixes(item, 31, { band: 0 }).affixes,
      );
    });

    it('fastened 의 중복·범위 밖·비정수 인덱스는 무시된다', () => {
      const item = rareWithAffixes(16_000, 4);
      const clean = reforgeAffixes(item, 64, { fastened: [1] });
      const dirty = reforgeAffixes(item, 64, {
        fastened: [1, 1, -3, 999, 1.5, Number.NaN, 1],
      });
      expect(dirty).toEqual(clean);
    });

    it('범위 밖 인덱스만 준 경우 = 고착 없음', () => {
      const item = rareWithAffixes(17_000, 3);
      expect(reforgeAffixes(item, 88, { fastened: [999, -1] }).affixes).toEqual(
        rerollAffixes(item, 88).affixes,
      );
    });
  });
});
