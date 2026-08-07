/**
 * 슬롯별 어픽스 풀의 **구조 하한** (ADR-0049 · affixes.md ②③).
 *
 * 이 파일은 "가중을 어떻게 바꾸든 깨지면 안 되는 것"을 지킨다. 설계서 ③-2 의 표를 그대로
 * 옮겨 놓은 이유는, 다음 사람이 가중 한 칸을 고쳤을 때 **어느 슬롯이 얼마나 움직였는지**를
 * 실패 메시지가 바로 보여 주기 위해서다.
 *
 * ⚠️ **하한을 못 맞추겠다고 기대값을 내리지 마라.** raw 6 과 N_eff 9 는 각각
 * `roll.ts` 의 개수 절단과 정련의 무한 싱크 성립에 걸려 있는 **기능 조건**이다.
 */

import { describe, expect, it } from 'vitest';
import {
  affixPoolFor,
  affixWeightFor,
  concentrationRatio,
  effectivePoolSize,
  isSkillAffix,
  refinePoolFor,
  skillAffixCount,
  skillAffixSibling,
  skillAffixesAllowed,
  SKILL_AFFIX_MIN_STAGE,
} from '../src/items/affixPool.js';
import { AFFIXES, ALL_AFFIXES, SKILL_AFFIXES } from '../data/affixes.js';
import { SLOT_KINDS } from '../src/items/types.js';
import type { SlotKind } from '../src/items/types.js';

/** 설계서 ③-2 의 실측표. 좌측이 정련·저단계 풀(base-24), 우측이 드랍 풀. */
const EXPECTED: Record<SlotKind, { raw: number; wBase: number; nEffRefine: number; nEffDrop: number; conc: number }> = {
  main: { raw: 18, wBase: 127, nEffRefine: 14.39, nEffDrop: 15.93, conc: 1.43 },
  sub: { raw: 17, wBase: 107, nEffRefine: 13.17, nEffDrop: 14.6, conc: 1.61 },
  armor: { raw: 15, wBase: 60, nEffRefine: 10.06, nEffDrop: 11.34, conc: 2.4 },
  shield: { raw: 15, wBase: 58, nEffRefine: 11.07, nEffDrop: 12.41, conc: 2.04 },
  engine: { raw: 16, wBase: 67, nEffRefine: 10.71, nEffDrop: 11.98, conc: 2.47 },
  core: { raw: 18, wBase: 94, nEffRefine: 12.14, nEffDrop: 13.59, conc: 1.92 },
  module: { raw: 17, wBase: 85, nEffRefine: 17.0, nEffDrop: 17.0, conc: 1.0 },
};

/** 드랍 풀이 스킬 어픽스를 싣는 조건. */
const DROP = { rarity: 'rare', stage: SKILL_AFFIX_MIN_STAGE } as const;

describe('affixPool — 슬롯 가중 테이블', () => {
  it('가중 튜플이 SLOT_KINDS 순서와 맞는다 (손으로 맞춘 표가 아니라 기계 검사)', () => {
    // `deadly` 는 main 전속(10)이고 나머지 6슬롯이 0 이다 — 튜플 첫 칸이 main 이 아니면
    // 이 단언이 먼저 깨진다.
    const deadly = AFFIXES.find((a) => a.id === 'deadly');
    expect(deadly).toBeDefined();
    expect(SLOT_KINDS.map((s) => deadly?.weights[s])).toEqual([10, 0, 0, 0, 0, 0, 0]);
    // `of-fortune` 은 core 전속(10) — 여섯 번째 칸이 core 임을 잠근다.
    const fortune = AFFIXES.find((a) => a.id === 'of-fortune');
    expect(SLOT_KINDS.map((s) => fortune?.weights[s])).toEqual([0, 0, 2, 2, 2, 10, 0]);
  });

  it('모든 어픽스가 7 슬롯 전부에 정수 가중을 갖는다', () => {
    for (const d of ALL_AFFIXES) {
      for (const s of SLOT_KINDS) {
        const wt = d.weights[s];
        expect(Number.isInteger(wt), `${d.id}.${s} = ${String(wt)}`).toBe(true);
        expect(wt).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('어떤 어픽스도 전 슬롯 0 이 아니다 (조용히 사라지는 어픽스 금지)', () => {
    for (const d of ALL_AFFIXES) {
      const total = SLOT_KINDS.reduce((a, s) => a + d.weights[s], 0);
      expect(total, `${d.id} 이 어느 슬롯에서도 안 나온다`).toBeGreaterThan(0);
    }
  });

  for (const slot of SLOT_KINDS) {
    const exp = EXPECTED[slot];

    it(`${slot} — raw·W_base 가 설계서 ③-2 와 같다`, () => {
      const refine = refinePoolFor(slot);
      expect(refine.length).toBe(exp.raw);
      expect(refine.reduce((a, e) => a + e.weight, 0)).toBe(exp.wBase);
    });

    it(`${slot} — 두 풀 모두 raw ≥ 6 (하드: roll.ts 개수 절단 방지)`, () => {
      expect(refinePoolFor(slot).length).toBeGreaterThanOrEqual(6);
      expect(affixPoolFor(slot, DROP.rarity, DROP.stage).length).toBeGreaterThanOrEqual(6);
    });

    it(`${slot} — 두 풀 모두 N_eff ≥ 9 (하드: 정련 무한 싱크 유지)`, () => {
      expect(effectivePoolSize(refinePoolFor(slot))).toBeGreaterThanOrEqual(9);
      expect(effectivePoolSize(affixPoolFor(slot, DROP.rarity, DROP.stage))).toBeGreaterThanOrEqual(9);
    });

    it(`${slot} — N_eff·집중 배율이 설계서 ③-2 실측과 같다`, () => {
      expect(effectivePoolSize(refinePoolFor(slot))).toBeCloseTo(exp.nEffRefine, 1);
      expect(effectivePoolSize(affixPoolFor(slot, DROP.rarity, DROP.stage))).toBeCloseTo(
        exp.nEffDrop,
        1,
      );
      // ⚠️ 집중 배율은 **드랍 풀(rawR)** 위에서 정의된다(③-3). 정련 풀로 재면 분모가
      // 달라져 armor 2.33 / engine 2.39 처럼 문서와 어긋난다 — 실제로 밟은 함정이다.
      expect(concentrationRatio(affixPoolFor(slot, DROP.rarity, DROP.stage))).toBeCloseTo(
        exp.conc,
        1,
      );
    });
  }
});

describe('affixPool — 스킬 어픽스 게이트', () => {
  it('rare·unique 이고 stage ≥ 9 에서만 롤에 들어간다', () => {
    expect(skillAffixesAllowed('rare', 9)).toBe(true);
    expect(skillAffixesAllowed('unique', 20)).toBe(true);
    expect(skillAffixesAllowed('rare', 8)).toBe(false);
    expect(skillAffixesAllowed('magic', 40)).toBe(false);
    expect(skillAffixesAllowed('normal', 40)).toBe(false);
  });

  it('게이트가 닫히면 풀이 정확히 base-24 부분집합이다', () => {
    for (const slot of SLOT_KINDS) {
      const low = affixPoolFor(slot, 'rare', SKILL_AFFIX_MIN_STAGE - 1);
      expect(low.some((e) => isSkillAffix(e.def))).toBe(false);
      expect(low.map((e) => e.def.id)).toEqual(refinePoolFor(slot).map((e) => e.def.id));
    }
  });

  it('module 은 등급·단계와 무관하게 스킬 어픽스를 못 받는다 (①-3 상한 정합)', () => {
    const pool = affixPoolFor('module', 'unique', 99);
    expect(pool.some((e) => isSkillAffix(e.def))).toBe(false);
  });

  it('축당 담당 슬롯이 정확히 2칸이다 — 상한 +4 는 확률이 아니라 구조다', () => {
    for (const d of SKILL_AFFIXES) {
      const carriers = SLOT_KINDS.filter((s) => affixWeightFor(d, s) > 0);
      expect(carriers.length, `${d.id} 담당 슬롯`).toBe(2);
    }
    // 축 → 담당 슬롯 매핑이 ADR 그대로인지.
    const carriersOf = (id: string): SlotKind[] => {
      const d = SKILL_AFFIXES.find((x) => x.id === id);
      return d === undefined ? [] : SLOT_KINDS.filter((s) => affixWeightFor(d, s) > 0);
    };
    expect(carriersOf('of-honing')).toEqual(['main', 'sub']);
    expect(carriersOf('of-tenacity')).toEqual(['armor', 'shield']);
    expect(carriersOf('of-discernment')).toEqual(['engine', 'core']);
  });

  it('파생 가중이 설계서 ②-1 스킬 어픽스 표와 같다 (W_base × 0.08 / 0.02)', () => {
    const wt = (id: string, slot: SlotKind): number => {
      const d = SKILL_AFFIXES.find((x) => x.id === id);
      return d === undefined ? -1 : affixWeightFor(d, slot);
    };
    expect([wt('of-honing', 'main'), wt('of-honing', 'sub')]).toEqual([10, 9]);
    expect([wt('of-the-apex', 'main'), wt('of-the-apex', 'sub')]).toEqual([3, 2]);
    expect([wt('of-tenacity', 'armor'), wt('of-tenacity', 'shield')]).toEqual([5, 5]);
    expect([wt('of-the-unbroken', 'armor'), wt('of-the-unbroken', 'shield')]).toEqual([1, 1]);
    expect([wt('of-discernment', 'engine'), wt('of-discernment', 'core')]).toEqual([5, 8]);
    expect([wt('of-the-adept', 'engine'), wt('of-the-adept', 'core')]).toEqual([1, 2]);
  });

  it('스킬 어픽스 풀 지분이 목표 9.1% 근처다 (드리프트 8.2~9.6% 는 알려진 것)', () => {
    for (const slot of ['main', 'sub', 'armor', 'shield', 'engine', 'core'] as const) {
      const pool = affixPoolFor(slot, 'rare', SKILL_AFFIX_MIN_STAGE);
      const total = pool.reduce((a, e) => a + e.weight, 0);
      const skill = pool.filter((e) => isSkillAffix(e.def)).reduce((a, e) => a + e.weight, 0);
      const share = skill / total;
      expect(share, `${slot} 지분 ${(share * 100).toFixed(1)}%`).toBeGreaterThan(0.08);
      expect(share, `${slot} 지분 ${(share * 100).toFixed(1)}%`).toBeLessThan(0.1);
    }
  });

  it('정련 풀은 등급·단계와 무관하게 스킬 어픽스를 영영 안 낸다 (①-9)', () => {
    for (const slot of SLOT_KINDS) {
      expect(refinePoolFor(slot).some((e) => isSkillAffix(e.def))).toBe(false);
    }
  });
});

describe('affixPool — 형제 쌍·계수 헬퍼', () => {
  it('형제 매핑이 대칭이고 축을 넘지 않는다', () => {
    for (const d of SKILL_AFFIXES) {
      const sib = skillAffixSibling(d.id);
      expect(sib, `${d.id} 형제`).toBeDefined();
      expect(skillAffixSibling(sib as string)).toBe(d.id);
      const sibDef = SKILL_AFFIXES.find((x) => x.id === sib);
      expect(sibDef?.stat).toBe(d.stat);
      expect(sibDef?.max).not.toBe(d.max);
    }
  });

  it('기본 24종은 형제가 없다', () => {
    for (const d of AFFIXES) expect(skillAffixSibling(d.id)).toBeUndefined();
  });

  it('skillAffixCount 는 스킬 어픽스만 센다', () => {
    expect(skillAffixCount([{ id: 'sharp' }, { id: 'of-honing' }, { id: 'of-greed' }])).toBe(1);
    expect(skillAffixCount([{ id: 'sharp' }])).toBe(0);
    expect(skillAffixCount([])).toBe(0);
  });
});
