/**
 * 촉매 카탈로그 계약 — **유니크 양날 규칙 48종**(ADR-0052).
 *
 * 정본: `.omc/plans/catalyst-rebuild-2026-08-06/{charter,audit,impl-contract-table}.md`.
 * 이 파일은 그중 **기계가 강제할 수 있는 칸**만 잠근다 — 규칙문·신호는 설계 문서의 몫이다.
 *
 * ## 이 파일이 잠그는 축
 *  ① 48종 전수 불변식(id·slug·종류·행성·모드훅)
 *  ② 태그 — 개수·중복·하한·태그쌍 상한
 *  ③ 상한 — 하드 천장 ×2.6 · 축 5종 · 보상 축 쿼터
 *  ④ 훅 예산 — §A/§B/§C 집계 + §B 명단
 *  ⑤ 유니크 주입 · 슬롯 상한 · 특산 상한
 *  ⑥ 상한 합성식(축 격리 · 중복 무영향 · 빈 배열 중립원)
 *  ⑦ 가격 불변 — **재작성 전(origin/main) 값의 리터럴 표**와 전수 대조
 *  ⑧ SQL 미러 2종 · 아이콘 키
 *
 * ⚠️ **골든 재생성 금지.** ⑦ 의 표는 `dropWeight` 에서 다시 파생한 값이 아니라 ADR-0052
 * **재작성 이전 소스**에서 뜬 값을 손으로 옮긴 것이다. 파생식으로 다시 계산해 그 값을 검사하면
 * 항진이라 회귀를 못 잡는다.
 */

import { describe, it, expect } from 'vitest';
import {
  CATALYSTS,
  CATALYST_CAP_AXES,
  CATALYST_CAP_MIRROR,
  CATALYST_ICON_NAMES,
  CATALYST_PRICE_MIRROR,
  CATALYST_RESOURCE_MIRROR,
  CATALYST_TAG_PRIORITY,
  CAP_ALL_AXIS_FACTOR,
  CAP_COMPOSE_FACTOR,
  MAX_CATALYST_CAP_MULT,
  MODE_HOOK,
  SIGNATURE_CAP,
  SLOT_CAP,
  allAxisCapMult,
  axisCapMult,
  catalystBuyPrice,
  catalystById,
  catalystIconFallbackKey,
  catalystIconKey,
  catalystIsPurchasable,
  catalystSalvageValue,
  catalystVoidOnMode,
  hasCatalyst,
  isWithinSignatureCap,
  isWithinSlotCap,
  normalizeCatalystArray,
  resourceCapMult,
  type CatalystCapAxis,
  type CatalystTag,
} from '../src/data/catalysts.js';

const ALL_TAGS: readonly CatalystTag[] = [
  'ignite',
  'density',
  'precision',
  'harvest',
  'gamble',
  'erosion',
];

/** 태그쌍 상한(헌장 §태그 — 같은 태그쌍을 단 카드는 4장을 넘지 않는다). */
const MAX_SAME_TAG_PAIR = 4;
/** 태그 하한(헌장 §태그 — 각 태그 최소 7종. **48종 전체 기준**이다). */
const MIN_TAG_COUNT = 7;

function tagPairKey(tags: readonly CatalystTag[]): string {
  return [...tags].sort().join('+');
}

// ---------------------------------------------------------------------------
// ① 48종 전수 불변식
// ---------------------------------------------------------------------------

describe('카탈로그 구조 — 48종 전수', () => {
  it('id 0..47 이 빠짐없이 1회씩 있고 배열 인덱스와 일치한다', () => {
    expect(CATALYSTS).toHaveLength(48);
    for (let i = 0; i < 48; i++) {
      expect(CATALYSTS[i]!.id, `index ${i}`).toBe(i);
      expect(catalystById(i)!.id).toBe(i);
    }
  });

  it('slug 는 48종 전부 유일하다', () => {
    expect(new Set(CATALYSTS.map((c) => c.slug)).size).toBe(48);
  });

  it('공용 30(id<30, planet 없음) + 특산 18(id>=30) 이다', () => {
    const common = CATALYSTS.filter((c) => c.kind === 'common');
    const signature = CATALYSTS.filter((c) => c.kind === 'signature');
    expect(common).toHaveLength(30);
    expect(signature).toHaveLength(18);
    for (const c of common) {
      expect(c.id, c.slug).toBeLessThan(30);
      expect(c.planet, c.slug).toBeUndefined();
    }
    for (const s of signature) {
      expect(s.id, s.slug).toBeGreaterThanOrEqual(30);
      expect(s.planet, s.slug).toBeGreaterThanOrEqual(0);
      expect(s.planet, s.slug).toBeLessThanOrEqual(5);
    }
  });

  it('특산은 행성 0..5 마다 정확히 3종이다', () => {
    for (let p = 0; p <= 5; p++) {
      const n = CATALYSTS.filter((c) => c.kind === 'signature' && c.planet === p);
      expect(n.map((c) => c.slug), `planet ${p}`).toHaveLength(3);
    }
  });

  it('특산 18종 전원이 modeHook 을 갖고, 공용 30종은 하나도 갖지 않는다', () => {
    const hooks: string[] = [];
    for (const c of CATALYSTS) {
      if (c.kind === 'signature') {
        expect(c.modeHook, c.slug).toBeDefined();
        hooks.push(c.modeHook!);
      } else {
        expect(c.modeHook, c.slug).toBeUndefined();
      }
    }
    // 18종의 modeHook 은 서로 다르고 MODE_HOOK 레지스트리와 정확히 같은 집합이다.
    expect(new Set(hooks).size).toBe(18);
    expect([...hooks].sort()).toEqual([...Object.values(MODE_HOOK)].sort());
  });

  it('modeHook 문자열은 그 카드의 slug 와 동일하다(i18n·아이콘 앵커 정합)', () => {
    for (const c of CATALYSTS) {
      if (c.kind !== 'signature') continue;
      expect(c.modeHook, c.slug).toBe(c.slug);
    }
  });

  it('dropWeight 는 전부 양의 정수다(드랍 풀이 정수 가중으로 펼쳐진다)', () => {
    for (const c of CATALYSTS) {
      expect(Number.isInteger(c.dropWeight), c.slug).toBe(true);
      expect(c.dropWeight, c.slug).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ② 태그
// ---------------------------------------------------------------------------

describe('태그 — 개수·중복·6종 폐쇄·하한·태그쌍 상한', () => {
  it('카드마다 태그가 1~2개이고 중복이 없으며 6종 밖이 없다', () => {
    for (const c of CATALYSTS) {
      expect(c.tags.length, c.slug).toBeGreaterThanOrEqual(1);
      expect(c.tags.length, c.slug).toBeLessThanOrEqual(2);
      expect(new Set(c.tags).size, c.slug).toBe(c.tags.length);
      for (const t of c.tags) expect(ALL_TAGS, `${c.slug}:${t}`).toContain(t);
    }
  });

  it('CATALYST_TAG_PRIORITY 는 6종 전부를 우선순위 순으로 한 번씩 담는다', () => {
    expect(CATALYST_TAG_PRIORITY).toEqual([
      'ignite',
      'density',
      'precision',
      'harvest',
      'gamble',
      'erosion',
    ]);
    expect(new Set(CATALYST_TAG_PRIORITY).size).toBe(6);
  });

  it('각 태그가 최소 7종을 확보한다(48종 전체 기준 — 공용 30만 세면 미달이다)', () => {
    const counts = new Map<CatalystTag, number>();
    for (const c of CATALYSTS) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of ALL_TAGS) {
      expect(counts.get(t) ?? 0, t).toBeGreaterThanOrEqual(MIN_TAG_COUNT);
    }
    // 하한만 보면 "전원 48" 같은 퇴화도 통과한다 — 총 태그 슬롯 수를 함께 못박는다.
    // 5판 재태깅(2026-08-08)으로 단태그가 4종 → 11종이 됐다: 기존 넷(11 tutelage ·
    // 13 enlightenment · 32 kargon-lava-warden · 44 toxar-blight-mother)에 5 refinement ·
    // 9 epiphany · 14 mastery · 18 mercantile · 26 rapidcore · 34 berdan-royal-jelly ·
    // 39 arke-overclock 이 더해졌다. 48×2 − 11 = 85.
    const totalSlots = CATALYSTS.reduce((n, c) => n + c.tags.length, 0);
    expect(totalSlots).toBe(85);
    expect(CATALYSTS.filter((c) => c.tags.length === 1).map((c) => c.id)).toEqual([
      5, 9, 11, 13, 14, 18, 26, 32, 34, 39, 44,
    ]);
  });

  it('태그쌍 4장 상한 — 예외 없이 전 쌍이 4 이하다', () => {
    const pairs = new Map<string, number>();
    for (const c of CATALYSTS) {
      if (c.tags.length !== 2) continue;
      const k = tagPairKey(c.tags);
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
    // 2026-08-08 이전에는 `gamble+harvest` 9 · `gamble+precision` 8 이 헌장 §태그쌍 4장
    // 상한을 어기고 있어 이 자리에 `RECORDED_EXCESS` 예외가 박혀 있었다. 5판 재태깅이
    // 아홉 장의 태그를 고쳐 초과를 없앴으므로 **예외를 지우고 무조건으로 잠근다** —
    // 다시 예외를 여는 것은 헌장을 데이터에 맞춰 내리는 것이다.
    for (const [k, n] of pairs) {
      expect(n, `태그쌍 ${k}`).toBeLessThanOrEqual(MAX_SAME_TAG_PAIR);
    }
    // 상한에 정확히 붙은 3쌍은 한 장도 더 못 늘어난다(다음 레인이 무심코 넘기는 자리다).
    expect(pairs.get('harvest+precision')).toBe(MAX_SAME_TAG_PAIR);
    expect(pairs.get('gamble+harvest')).toBe(MAX_SAME_TAG_PAIR);
    expect(pairs.get('gamble+precision')).toBe(MAX_SAME_TAG_PAIR);
  });
});

// ---------------------------------------------------------------------------
// ③ 상한 — 천장 · 축 · 쿼터
// ---------------------------------------------------------------------------

describe('상한 — 하드 천장 · 축 5종 · 보상 축 쿼터', () => {
  it('개별 상한은 48종 전부 1 초과 ~ MAX_CATALYST_CAP_MULT(2.6) 이하다', () => {
    expect(MAX_CATALYST_CAP_MULT).toBe(2.6);
    for (const c of CATALYSTS) {
      expect(c.cap.mult, c.slug).toBeGreaterThan(1);
      expect(c.cap.mult, c.slug).toBeLessThanOrEqual(MAX_CATALYST_CAP_MULT);
    }
    // 천장이 사문화되지 않았는지(= 실제로 붙어 있는 카드가 있는지) 함께 본다.
    expect(CATALYSTS.some((c) => c.cap.mult === MAX_CATALYST_CAP_MULT)).toBe(true);
  });

  it('상한 축은 CATALYST_CAP_AXES 5종 안이고 5종 전부 최소 1장이 쓴다', () => {
    expect(CATALYST_CAP_AXES).toEqual(['drop', 'resource', 'rarity', 'xp', 'catalystDrop']);
    const used = new Set(CATALYSTS.map((c) => c.cap.axis));
    for (const c of CATALYSTS) expect(CATALYST_CAP_AXES, c.slug).toContain(c.cap.axis);
    for (const a of CATALYST_CAP_AXES) expect(used.has(a), a).toBe(true);
  });

  it('보상 축 쿼터 — 축별 종수가 설계 정본 집계와 일치한다', () => {
    const counts = new Map<CatalystCapAxis, number>();
    for (const c of CATALYSTS) counts.set(c.cap.axis, (counts.get(c.cap.axis) ?? 0) + 1);
    // ⚠️ `audit.md` §보상 축 분포는 드랍 14 · 자원 12 로 기록돼 있으나 구현 데이터는
    //   드랍 15 · 자원 11 이다(`id 15 extraction` 이 자원축 → 드랍축으로 옮겨간 결과).
    //   자원 쿼터(≤12)는 여전히 충족이고 드랍은 "12 안팎" 대비 초과폭이 audit 기록보다 1 크다.
    //   상위에 보고된 차이이므로 값을 그대로 잠근다.
    expect(Object.fromEntries(counts)).toEqual({
      drop: 15,
      resource: 11,
      rarity: 10,
      xp: 8,
      catalystDrop: 4,
    });
    // 헌장이 **하드 상한**으로 적은 것은 자원축 하나다(≤12).
    expect(counts.get('resource')!).toBeLessThanOrEqual(12);
    // 합이 48 — 축 하나가 통째로 빠져도 못 알아채는 것을 막는다.
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// ④ 훅 예산 (카드 48 + 공명 12 = 60)
// ---------------------------------------------------------------------------

describe('훅 예산 — 카드 48 + 공명 12 합산', () => {
  it('§A 47 · §B 13 · §C 0 이고 예산(§A≥30 · §B≤14 · §C≤4)을 지킨다', async () => {
    // 2026-08-08 재등급: `id 29 ascendant` 가 §B → §A 로 내려갔다(`status.ts` 의 정지 축
    // `applyStasis`/`enemyStatusStopMult` 가 생겨 "이동 불능을 표현할 수단이 없다"는 사유가
    // 사라졌다). 그래서 §B 예산에 **여유 1** 이 생겼다.
    const { RESONANCES } = await import('../src/data/catalystResonance.js');
    const grades = [...CATALYSTS.map((c) => c.hook), ...RESONANCES.map((r) => r.hook)];
    expect(grades).toHaveLength(60);
    const n = (g: string): number => grades.filter((x) => x === g).length;
    expect({ A: n('A'), B: n('B'), C: n('C') }).toEqual({ A: 47, B: 13, C: 0 });
    expect(n('A')).toBeGreaterThanOrEqual(30);
    expect(n('B')).toBeLessThanOrEqual(14);
    expect(n('C')).toBeLessThanOrEqual(4);
  });

  it('§B 명단 — 공용 6 · 특산 5 · 공명 2 가 정확히 이것들이다', async () => {
    const { RESONANCES } = await import('../src/data/catalystResonance.js');
    const cardB = CATALYSTS.filter((c) => c.hook === 'B').map((c) => c.id);
    // `29` 가 빠졌다 — 위 절의 재등급 주석 참조.
    expect(cardB).toEqual([5, 10, 16, 25, 26, 28, 33, 36, 38, 41, 46]);
    const resB = RESONANCES.filter((r) => r.hook === 'B').map((r) => `${r.tag}:${r.tier}`);
    // `점화 약`(ember) · `정밀 강`(deflection).
    expect(resB).toEqual(['ignite:weak', 'precision:strong']);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 정규화 · 슬롯 상한 · 특산 상한
// ---------------------------------------------------------------------------

describe('normalizeCatalystArray — 유니크 주입(ADR-0052 거동 변경)', () => {
  it('중복을 제거한다 — [3,3,3] → [3]', () => {
    expect(normalizeCatalystArray([3, 3, 3])).toEqual([3]);
    expect(normalizeCatalystArray([1, 5, 1, 5, 1])).toEqual([1, 5]);
  });

  it('같은 집합이면 입력 순서와 무관하게 오름차순 동일 배열이다', () => {
    expect(normalizeCatalystArray([5, 1, 20])).toEqual([1, 5, 20]);
    expect(normalizeCatalystArray([20, 5, 1])).toEqual([1, 5, 20]);
  });

  it('미지 id(음수·범위 밖·비정수)를 제거하고 유효 id 는 남긴다', () => {
    expect(normalizeCatalystArray([-1, 48, 9999, 2.5])).toEqual([]);
    expect(normalizeCatalystArray([-1, 7, 48, 7])).toEqual([7]);
  });

  it('빈 배열은 빈 배열이다', () => {
    expect(normalizeCatalystArray([])).toEqual([]);
  });
});

describe('SLOT_CAP / SIGNATURE_CAP — 중복 제거 후 판정', () => {
  it('SLOT_CAP 은 3, SIGNATURE_CAP 은 2 다', () => {
    expect(SLOT_CAP).toBe(3);
    expect(SIGNATURE_CAP).toBe(2);
  });

  it('isWithinSlotCap 은 중복을 접은 뒤 센다 — [3,3,3,3] 통과, 서로 다른 4장은 거부', () => {
    expect(isWithinSlotCap([3, 3, 3, 3])).toBe(true);
    expect(isWithinSlotCap([0, 1, 2])).toBe(true);
    expect(isWithinSlotCap([0, 1, 2, 3])).toBe(false);
  });

  it('미지 id 는 슬롯 계산에서 빠진다', () => {
    expect(isWithinSlotCap([0, 1, 2, 9999, -5])).toBe(true);
  });

  it('isWithinSignatureCap: 특산 3장은 거부, 2장은 통과', () => {
    expect(isWithinSignatureCap([30, 31, 32])).toBe(false);
    expect(isWithinSignatureCap([30, 31])).toBe(true);
    expect(isWithinSignatureCap([30, 31, 0])).toBe(true);
    // 공용만 3장이면 특산 0장이므로 통과.
    expect(isWithinSignatureCap([0, 1, 2])).toBe(true);
  });

  it('isWithinSignatureCap 도 중복을 접는다 — 같은 특산 3장은 1장으로 센다', () => {
    expect(isWithinSignatureCap([30, 30, 30])).toBe(true);
  });
});

describe('hasCatalyst / catalystVoidOnMode — 술어 단일 정본', () => {
  it('hasCatalyst 는 소지 여부를 그대로 답한다', () => {
    expect(hasCatalyst([1, 5, 20], 5)).toBe(true);
    expect(hasCatalyst([1, 5, 20], 6)).toBe(false);
    expect(hasCatalyst([], 0)).toBe(false);
  });

  it('catalystVoidOnMode: id 2(harvest)는 아르케(3)·크라스(5)에서 무효, 그 밖에서는 유효', () => {
    const harvest = catalystById(2)!;
    expect(harvest.voidOnModes).toEqual([3, 5]);
    expect(catalystVoidOnMode(harvest, 3)).toBe(true);
    expect(catalystVoidOnMode(harvest, 5)).toBe(true);
    expect(catalystVoidOnMode(harvest, 0)).toBe(false);
  });

  it('voidOnModes 가 없는 카드는 어느 모드에서도 무효가 아니다', () => {
    const abundance = catalystById(0)!;
    expect(abundance.voidOnModes).toBeUndefined();
    for (let m = 0; m <= 5; m++) expect(catalystVoidOnMode(abundance, m), `mode ${m}`).toBe(false);
  });

  it('voidOnModes 는 있다면 전부 유효 모드 인덱스(0..5)다', () => {
    for (const c of CATALYSTS) {
      for (const m of c.voidOnModes ?? []) {
        expect(m, c.slug).toBeGreaterThanOrEqual(0);
        expect(m, c.slug).toBeLessThanOrEqual(5);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ⑥ 상한 합성
// ---------------------------------------------------------------------------

describe('axisCapMult — 1 + Σ(cap−1)×0.5, 축 격리', () => {
  it('합성 계수는 0.5, 전축 계수는 1.2 다', () => {
    expect(CAP_COMPOSE_FACTOR).toBe(0.5);
    expect(CAP_ALL_AXIS_FACTOR).toBe(1.2);
  });

  it('빈 배열은 전 축 1(중립원)', () => {
    for (const a of CATALYST_CAP_AXES) expect(axisCapMult([], a), a).toBe(1);
  });

  it('1장 — id 17(greed, resource 2.6) → 1 + 1.6×0.5 = 1.8', () => {
    expect(catalystById(17)!.cap).toEqual({ axis: 'resource', mult: 2.6 });
    expect(axisCapMult([17], 'resource')).toBeCloseTo(1.8, 10);
  });

  it('2장 같은 축 — id 17(2.6) + id 19(2.4) → 1 + (1.6+1.4)×0.5 = 2.5', () => {
    expect(catalystById(19)!.cap).toEqual({ axis: 'resource', mult: 2.4 });
    expect(axisCapMult([17, 19], 'resource')).toBeCloseTo(2.5, 10);
  });

  it('축이 다르면 서로 안 섞인다 — id 0 은 drop 만 올리고 resource 는 1 그대로', () => {
    expect(catalystById(0)!.cap).toEqual({ axis: 'drop', mult: 2.0 });
    expect(axisCapMult([0], 'drop')).toBeCloseTo(1.5, 10);
    expect(axisCapMult([0], 'resource')).toBe(1);
    // 섞인 조합에서도 각 축이 자기 것만 센다.
    expect(axisCapMult([0, 17], 'drop')).toBeCloseTo(1.5, 10);
    expect(axisCapMult([0, 17], 'resource')).toBeCloseTo(1.8, 10);
  });

  it('중복 id 는 두 번 세어지지 않는다(유니크 주입)', () => {
    expect(axisCapMult([17, 17, 17], 'resource')).toBeCloseTo(axisCapMult([17], 'resource'), 10);
  });

  it('미지 id 는 무시된다', () => {
    expect(axisCapMult([17, 9999, -1], 'resource')).toBeCloseTo(axisCapMult([17], 'resource'), 10);
  });

  it('resourceCapMult = axisCapMult(ids, "resource")', () => {
    for (const ids of [[], [17], [17, 19], [0, 17, 19]]) {
      expect(resourceCapMult(ids)).toBe(axisCapMult(ids, 'resource'));
    }
  });

  it('allAxisCapMult = max(축별) × 1.2', () => {
    expect(allAxisCapMult([])).toBeCloseTo(1.2, 10);
    // [0(drop 2.0), 17(resource 2.6), 19(resource 2.4)] → drop 1.5 · resource 2.5 → max 2.5.
    expect(allAxisCapMult([0, 17, 19])).toBeCloseTo(2.5 * 1.2, 10);
  });

  it('SLOT_CAP 3장 조합의 전축 상한은 설계 사거리(×3.9) 안이다', () => {
    // 자원축 최악(설계 문서 §상한 합성): greed 2.6 + motherlode 2.4 + 남은 자원축 최대.
    const worstResource = [17, 19, 34]; // 2.6 + 2.4 + 2.4(berdan-royal-jelly)
    expect(axisCapMult(worstResource, 'resource')).toBeCloseTo(1 + (1.6 + 1.4 + 1.4) * 0.5, 10);
    expect(allAxisCapMult(worstResource)).toBeLessThanOrEqual(3.9);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 가격 불변 — 재작성 전(origin/main) 값의 리터럴 표
// ---------------------------------------------------------------------------

/**
 * `[id, buyPrice, salvageValue, purchasable]` — **ADR-0052 재작성 이전** 소스에서 뜬 값이다.
 * `dropWeight` 가 동결이므로 재작성 후에도 한 자리도 달라지면 안 된다.
 * ⚠️ 이 표를 `catalystBuyPrice` 로 다시 채우지 마라 — 항진이 되어 회귀를 못 잡는다.
 */
const PRICE_BASELINE: readonly [number, number, number, boolean][] = [
  [0, 10, 5, true],
  [1, 10, 5, true],
  [2, 10, 5, true],
  [3, 10, 5, true],
  [4, 10, 5, true],
  [5, 10, 5, true],
  [6, 10, 5, true],
  [7, 10, 5, true],
  [8, 10, 5, true],
  [9, 10, 5, true],
  [10, 10, 5, true],
  [11, 10, 5, true],
  [12, 10, 5, true],
  [13, 10, 5, true],
  [14, 10, 5, true],
  [15, 10, 5, true],
  [16, 10, 5, true],
  [17, 10, 5, true],
  [18, 10, 5, true],
  [19, 10, 5, true],
  [20, 10, 5, true],
  [21, 10, 5, true],
  [22, 10, 5, true],
  [23, 10, 5, true],
  [24, 10, 5, true],
  [25, 50, 25, true],
  [26, 50, 25, true],
  [27, 50, 25, true],
  [28, 50, 25, true],
  [29, 100, 50, true],
  [30, 12, 6, false],
  [31, 12, 6, false],
  [32, 25, 12, false],
  [33, 12, 6, false],
  [34, 12, 6, false],
  [35, 25, 12, false],
  [36, 12, 6, false],
  [37, 12, 6, false],
  [38, 25, 12, false],
  [39, 12, 6, false],
  [40, 12, 6, false],
  [41, 25, 12, false],
  [42, 12, 6, false],
  [43, 12, 6, false],
  [44, 25, 12, false],
  [45, 12, 6, false],
  [46, 12, 6, false],
  [47, 25, 12, false],
];

describe('가격 불변 — 재작성 전과 한 자리도 다르지 않다', () => {
  it('48종 구매가·환급액·진열여부가 기준선 표와 전수 일치한다', () => {
    expect(PRICE_BASELINE).toHaveLength(48);
    for (const [id, buy, salvage, purchasable] of PRICE_BASELINE) {
      expect(catalystBuyPrice(id), `buy id=${id}`).toBe(buy);
      expect(catalystSalvageValue(id), `salvage id=${id}`).toBe(salvage);
      expect(catalystIsPurchasable(id), `purchasable id=${id}`).toBe(purchasable);
    }
  });

  it('특산 12/25 는 floor 절하 결과다(12.5 → 12, 환급 6)', () => {
    // 절하가 사라지면(반올림이 되면) 13/6 이 되어 서버 청구와 갈린다.
    expect(catalystBuyPrice(30)).toBe(12);
    expect(catalystSalvageValue(30)).toBe(6);
  });

  it('미지 id 의 구매가는 0 이다(서버 price-unset 게이트와 같은 방향)', () => {
    expect(catalystBuyPrice(9999)).toBe(0);
    expect(catalystSalvageValue(9999)).toBe(0);
    expect(catalystIsPurchasable(9999)).toBe(false);
  });

  it('CATALYST_PRICE_MIRROR 는 48행이고 기준선과 일치한다(SQL 시드 정본)', () => {
    expect(CATALYST_PRICE_MIRROR).toHaveLength(48);
    for (const [id, buy, , purchasable] of PRICE_BASELINE) {
      const row = CATALYST_PRICE_MIRROR[id]!;
      expect(row.catalystId).toBe(id);
      expect(row.buyPrice, `id=${id}`).toBe(buy);
      expect(row.purchasable, `id=${id}`).toBe(purchasable);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑧ SQL 미러 2종 · 아이콘
// ---------------------------------------------------------------------------

describe('SQL 미러 — CATALYST_CAP_MIRROR / CATALYST_RESOURCE_MIRROR', () => {
  it('CAP_MIRROR 는 48행, id 오름차순이고 정의의 축·배율과 일치한다', () => {
    expect(CATALYST_CAP_MIRROR).toHaveLength(48);
    for (let i = 0; i < 48; i++) {
      const row = CATALYST_CAP_MIRROR[i]!;
      const def = CATALYSTS[i]!;
      expect(row.id).toBe(i);
      expect(row.capAxis, def.slug).toBe(def.cap.axis);
      expect(row.capMult, def.slug).toBe(def.cap.mult);
    }
  });

  it('RESOURCE_MIRROR 는 48행이고 자원축이면 개별 상한, 아니면 1 이다(0 아님)', () => {
    expect(CATALYST_RESOURCE_MIRROR).toHaveLength(48);
    let resourceRows = 0;
    for (let i = 0; i < 48; i++) {
      const row = CATALYST_RESOURCE_MIRROR[i]!;
      const def = CATALYSTS[i]!;
      expect(row.id).toBe(i);
      if (def.cap.axis === 'resource') {
        expect(row.resourceCap, def.slug).toBe(def.cap.mult);
        resourceRows++;
      } else {
        expect(row.resourceCap, def.slug).toBe(1);
      }
    }
    // 자원축이 하나도 없으면 위 루프가 통째로 else 만 돌아도 통과한다 — 긍정 짝.
    expect(resourceRows).toBe(11);
  });

  it('RESOURCE_MIRROR 의 1 은 합성식의 중립원이라 총상한을 안 움직인다', () => {
    // 비자원축 카드만 넣어도 resourceCapMult 가 1 그대로여야 한다.
    expect(catalystById(0)!.cap.axis).not.toBe('resource');
    expect(resourceCapMult([0])).toBe(1);
  });
});

describe('아이콘 키 — slug 기반 개별 아트 + 축 폴백', () => {
  it('slug 의 - 를 _ 로 옮긴다', () => {
    expect(catalystIconKey(catalystById(30)!)).toBe('catalyst_kargon_swarmcall');
    expect(catalystIconKey(catalystById(0)!)).toBe('catalyst_abundance');
  });

  it('48종이 서로 다른 개별 키를 갖는다(1:1)', () => {
    expect(new Set(CATALYSTS.map(catalystIconKey)).size).toBe(48);
  });

  it('폴백 키는 상한 축별 공용이고 축 5종뿐이다', () => {
    expect(catalystIconFallbackKey(catalystById(17)!)).toBe('catalyst_axis_resource');
    expect(new Set(CATALYSTS.map(catalystIconFallbackKey)).size).toBe(5);
  });

  it('로더 목록은 개별 48 + 축 폴백 5 = 53 이고 중복이 없다', () => {
    expect(CATALYST_ICON_NAMES).toHaveLength(53);
    expect(new Set(CATALYST_ICON_NAMES).size).toBe(53);
    expect(CATALYST_ICON_NAMES).toContain('catalyst_abundance.png');
    expect(CATALYST_ICON_NAMES).toContain('catalyst_axis_catalystDrop.png');
    // 폐기된 power 축 폴백은 더 이상 잡히지 않는다.
    expect(CATALYST_ICON_NAMES.some((n) => n.startsWith('catalyst_axis_power'))).toBe(false);
  });
});
