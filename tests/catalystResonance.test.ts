/**
 * 태그 공명 계약 — `src/data/catalystResonance.ts` (ADR-0052 §태그 & 공명).
 *
 * 잠그는 것:
 *  ① 12종 전수 — 태그 6 × 단 2 가 빠짐없이 있고 slug 가 유일하다
 *  ② 약공명 상한 하드 천장(≤1.3) · 상한 축이 5종 안
 *  ③ 태그 집계 — 태그 2개 카드는 두 태그 모두에 세고, 중복 id 는 접힌다
 *  ④ **한 런에 하나만** — 약공명 후보가 여럿이어도 정확히 하나가 나온다
 *  ⑤ **강 우선** — 3장이 같은 태그면 약이 아니라 강
 *  ⑥ **동급이면 태그 우선순위**(점화 > 밀도 > 정밀 > 수확 > 도박 > 침식) — 실제 카드로 실증
 *  ⑦ 후보가 없으면 null
 *
 * ⚠️ 조합은 전부 **실제 카드 id** 로 쓴다. 태그 목록을 흉내 낸 가짜 입력으로 우선순위를
 * 실증하면 카탈로그가 갈렸을 때 이 파일이 조용히 통과한다.
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_WEAK_RESONANCE_CAP,
  RESONANCES,
  RESONANCE_STRONG_COUNT,
  RESONANCE_WEAK_COUNT,
  resolveResonance,
  resonanceOf,
  tagCounts,
} from '../src/data/catalystResonance.js';
import {
  CATALYST_CAP_AXES,
  CATALYST_TAG_PRIORITY,
  catalystById,
  type CatalystTag,
} from '../src/data/catalysts.js';

/** 조합의 태그 구성을 사람이 읽을 수 있게 — 실패 메시지용. */
function describeIds(ids: readonly number[]): string {
  return ids.map((id) => `${id}:${catalystById(id)!.tags.join('/')}`).join(' + ');
}

// ---------------------------------------------------------------------------
// ① 12종 전수
// ---------------------------------------------------------------------------

describe('RESONANCES — 태그 6 × 단 2 = 12종 전수', () => {
  it('12종이고 (태그, 단) 조합이 빠짐없이 한 번씩 있다', () => {
    expect(RESONANCES).toHaveLength(12);
    const seen = new Set(RESONANCES.map((r) => `${r.tag}:${r.tier}`));
    expect(seen.size).toBe(12);
    for (const tag of CATALYST_TAG_PRIORITY) {
      for (const tier of ['weak', 'strong'] as const) {
        expect(seen.has(`${tag}:${tier}`), `${tag} ${tier}`).toBe(true);
        expect(resonanceOf(tag, tier), `${tag} ${tier}`).toBeDefined();
        expect(resonanceOf(tag, tier)!.tag).toBe(tag);
        expect(resonanceOf(tag, tier)!.tier).toBe(tier);
      }
    }
  });

  it('slug 12개가 전부 유일하다(i18n 앵커)', () => {
    expect(new Set(RESONANCES.map((r) => r.slug)).size).toBe(12);
  });

  it('발동 장수는 약 2 · 강 3 이다', () => {
    expect(RESONANCE_WEAK_COUNT).toBe(2);
    expect(RESONANCE_STRONG_COUNT).toBe(3);
  });

  it('미지 조합은 undefined 다(타입 밖 입력 방어)', () => {
    expect(resonanceOf('ignite' as CatalystTag, 'mid' as 'weak')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ② 상한
// ---------------------------------------------------------------------------

describe('공명 상한 — 약은 ≤1.3, 축은 5종 안', () => {
  it('약공명 6종은 전부 1 초과 ~ MAX_WEAK_RESONANCE_CAP(1.3) 이하다', () => {
    expect(MAX_WEAK_RESONANCE_CAP).toBe(1.3);
    const weak = RESONANCES.filter((r) => r.tier === 'weak');
    expect(weak).toHaveLength(6);
    for (const r of weak) {
      expect(r.cap.mult, r.slug).toBeGreaterThan(1);
      expect(r.cap.mult, r.slug).toBeLessThanOrEqual(MAX_WEAK_RESONANCE_CAP);
    }
  });

  it('강공명 6종은 약보다 크다(하위 호환 = 흡수의 근거)', () => {
    const strong = RESONANCES.filter((r) => r.tier === 'strong');
    expect(strong).toHaveLength(6);
    for (const s of strong) {
      const w = resonanceOf(s.tag, 'weak')!;
      expect(s.cap.mult, s.tag).toBeGreaterThan(w.cap.mult);
    }
  });

  it('공명 상한 축은 CATALYST_CAP_AXES 안이다(축별 합성에 들어갈 수 있어야 한다)', () => {
    for (const r of RESONANCES) expect(CATALYST_CAP_AXES, r.slug).toContain(r.cap.axis);
  });
});

// ---------------------------------------------------------------------------
// ③ 태그 집계
// ---------------------------------------------------------------------------

describe('tagCounts — 태그 2개 카드는 두 태그 모두에 센다', () => {
  it('id 0(harvest/density) 1장이면 두 태그가 각 1 이다', () => {
    expect(catalystById(0)!.tags).toEqual(['harvest', 'density']);
    const c = tagCounts([0]);
    expect(c.get('harvest')).toBe(1);
    expect(c.get('density')).toBe(1);
    expect(c.get('gamble')).toBeUndefined();
  });

  it('중복 id 는 접힌다 — [0,0,0] 은 [0] 과 같다', () => {
    expect(Object.fromEntries(tagCounts([0, 0, 0]))).toEqual(Object.fromEntries(tagCounts([0])));
  });

  it('미지 id 는 세지 않는다', () => {
    expect(Object.fromEntries(tagCounts([0, 9999, -1]))).toEqual(
      Object.fromEntries(tagCounts([0])),
    );
  });

  it('빈 조합은 빈 집계다', () => {
    expect(tagCounts([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ④~⑦ resolveResonance
// ---------------------------------------------------------------------------

describe('resolveResonance — 한 런에 하나만', () => {
  it('후보가 없으면 null(1장·빈 조합)', () => {
    expect(resolveResonance([])).toBeNull();
    expect(resolveResonance([11])).toBeNull(); // gamble 1장뿐
    expect(resolveResonance([13])).toBeNull(); // precision 1장뿐
  });

  it('같은 카드 중복은 공명을 못 만든다 — [0,0,0] 은 null', () => {
    // 유니크 주입 때문에 태그가 1씩만 세어진다. 스택으로 공명을 사는 길이 없다는 증명.
    expect(resolveResonance([0, 0, 0])).toBeNull();
  });

  it('약공명 후보가 셋이어도 정확히 하나만 나온다', () => {
    // 8(ignite/erosion) + 16(density/erosion) + 20(ignite/density)
    //  → ignite 2 · erosion 2 · density 2 — 약공명 후보 셋.
    const ids = [8, 16, 20];
    const counts = tagCounts(ids);
    expect(counts.get('ignite')).toBe(2);
    expect(counts.get('density')).toBe(2);
    expect(counts.get('erosion')).toBe(2);
    const r = resolveResonance(ids);
    expect(r, describeIds(ids)).not.toBeNull();
    // 반환은 단일 객체다 — 배열이 아니고, 후보 중 하나로 특정된다.
    expect(r!.tier).toBe('weak');
    expect(r!.tag).toBe('ignite'); // 우선순위 최상위
    expect(r!.slug).toBe('ember');
  });

  it('강 우선 — 같은 태그 3장이면 약이 아니라 강이 나온다', () => {
    // 20(ignite/density) + 22(ignite/density) + 24(ignite/gamble) → ignite 3 · density 2.
    const ids = [20, 22, 24];
    expect(tagCounts(ids).get('ignite')).toBe(3);
    expect(tagCounts(ids).get('density')).toBe(2);
    const r = resolveResonance(ids)!;
    expect(r.tier, describeIds(ids)).toBe('strong');
    expect(r.tag).toBe('ignite');
    expect(r.slug).toBe('reverberation');
  });

  it('강 우선 — 우선순위가 낮은 태그라도 3장이면 높은 태그의 2장을 이긴다', () => {
    // 25(precision/erosion) + 27(precision/erosion) + 46(precision/erosion)
    //  → precision 3 · erosion 3. 둘 다 강이므로 우선순위로 precision.
    // 아래는 "낮은 태그 강 vs 높은 태그 약" 을 격리한 조합:
    // 2(harvest/gamble) + 3(harvest/gamble) + 20(ignite/density)
    //  → harvest 2 · gamble 2 · ignite 1 · density 1 → 강 없음. 대신 아래를 쓴다.
    // 15(harvest/gamble) + 18(gamble/harvest) + 21(gamble/harvest) → harvest 3 · gamble 3.
    // 진짜 격리: gamble 3 · ignite 2 를 만든다.
    // 1(gamble/ignite) + 24(ignite/gamble) + 11(gamble) → gamble 3 · ignite 2.
    const ids = [1, 24, 11];
    const counts = tagCounts(ids);
    expect(counts.get('gamble')).toBe(3);
    expect(counts.get('ignite')).toBe(2);
    const r = resolveResonance(ids)!;
    // 점화(우선순위 1위)가 2장으로 약공명 후보지만, 도박(5위) 3장의 강공명이 이긴다.
    expect(r.tier, describeIds(ids)).toBe('strong');
    expect(r.tag).toBe('gamble');
    expect(r.slug).toBe('settlement');
  });

  it('동급(강) 충돌 — 태그 우선순위로 하나를 고른다(정밀 > 침식)', () => {
    // 25·27·46 전부 precision/erosion → precision 3 · erosion 3, 둘 다 강.
    const ids = [25, 27, 46];
    const counts = tagCounts(ids);
    expect(counts.get('precision')).toBe(3);
    expect(counts.get('erosion')).toBe(3);
    const r = resolveResonance(ids)!;
    expect(r.tier).toBe('strong');
    expect(r.tag, describeIds(ids)).toBe('precision');
    expect(r.slug).toBe('deflection');
  });

  it('동급(약) 충돌 — 밀도 > 수확 > 침식', () => {
    // 16(density/erosion) + 23(harvest/erosion) + 45(harvest/density)
    //  → density 2 · erosion 2 · harvest 2. 셋 다 약. 점화·정밀은 0.
    const ids = [16, 23, 45];
    const counts = tagCounts(ids);
    expect(counts.get('density')).toBe(2);
    expect(counts.get('harvest')).toBe(2);
    expect(counts.get('erosion')).toBe(2);
    expect(counts.get('ignite') ?? 0).toBe(0);
    expect(counts.get('precision') ?? 0).toBe(0);
    const r = resolveResonance(ids)!;
    expect(r.tier).toBe('weak');
    expect(r.tag, describeIds(ids)).toBe('density');
    expect(r.slug).toBe('attraction');
  });

  it('동급(약) 충돌 — 수확 > 도박(밀도·정밀·점화가 없을 때)', () => {
    // 23(harvest/erosion) + 3(harvest/gamble) + 12(gamble/erosion)
    //  → harvest 2 · gamble 2 · erosion 2. 우선순위 harvest(4위) > gamble(5위) > erosion(6위).
    // ⚠️ 5판 재태깅(2026-08-08) 전에는 `34 berdan-royal-jelly` 를 썼다 — 그 카드가
    // `수확` 단태그가 되면서 gamble 이 1로 떨어져 이 fixture 가 깨졌다. 같은 태그 모양을
    // 만드는 `3 bounty`(수확·도박)로 교체했다. 단언 대상(우선순위 해소)은 그대로다.
    const ids = [23, 3, 12];
    const counts = tagCounts(ids);
    expect(counts.get('harvest')).toBe(2);
    expect(counts.get('gamble')).toBe(2);
    expect(counts.get('erosion')).toBe(2);
    const r = resolveResonance(ids)!;
    expect(r.tier).toBe('weak');
    expect(r.tag, describeIds(ids)).toBe('harvest');
    expect(r.slug).toBe('snare');
  });

  it('입력 순서를 바꿔도 같은 공명이 나온다(우선순위가 배열 순서가 아니다)', () => {
    const a = resolveResonance([16, 23, 45])!;
    const b = resolveResonance([45, 23, 16])!;
    const c = resolveResonance([23, 45, 16])!;
    expect(b.slug).toBe(a.slug);
    expect(c.slug).toBe(a.slug);
  });

  it('발동한 공명은 반드시 RESONANCES 의 원소다(임시 객체 생성 아님)', () => {
    for (const ids of [
      [8, 16, 20],
      [20, 22, 24],
      [25, 27, 46],
      [16, 23, 45],
      [1, 24, 11],
    ]) {
      const r = resolveResonance(ids);
      expect(r, describeIds(ids)).not.toBeNull();
      expect(RESONANCES, describeIds(ids)).toContain(r!);
    }
  });
});
