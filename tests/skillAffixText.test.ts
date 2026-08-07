/**
 * ADR-0049 스킬 어픽스(축 단위 +N 레벨) 표시 문자열 — 레인 3(어픽스 재편) 신규.
 *
 * `tests/affixText.test.ts` 의 `ALL_STATS` 는 `AFFIXES`(기본 24종)에서만 파생하므로
 * `SKILL_AFFIXES` 3종은 그 커버리지 밖이다. 이 파일이 그 사각을 메운다: ①표시명·수치
 * 서식·설명 커버리지 ②`hangar.affix.noInvest` 회색 처리(설계 ①-10 · 정본 1: 투자 0인
 * 축에는 스킬 어픽스가 무효과) ③퍼센트/플래그 어느 집합에도 안 들어가 `+1`/`+2` 그대로
 * 나오는지.
 */

import { describe, it, expect } from 'vitest';

import { SKILL_AFFIXES } from '../data/affixes.js';
import type { StatKey } from '../src/items/types.js';
import {
  affixLinesForHangar,
  affixTitleLine,
  skillAxisOfStat,
  statDesc,
  statLabel,
  statValueText,
} from '../src/ui/affixText.js';

const SKILL_STATS: StatKey[] = [...new Set(SKILL_AFFIXES.map((a) => a.stat))];

describe('스킬 어픽스 표시명·설명 커버리지', () => {
  it('skillLvOffense/Defense/Utility 전부 표시명이 있다(키가 그대로 새지 않는다)', () => {
    expect(SKILL_STATS.length).toBe(3);
    for (const stat of SKILL_STATS) {
      expect(statLabel(stat), stat).not.toBe(`stat.${stat}.name`);
      expect(statLabel(stat).length).toBeGreaterThan(0);
    }
  });

  it('설명이 있고 "이미 투자한" 정본 1 문구를 담는다(KO)', () => {
    for (const stat of SKILL_STATS) {
      const desc = statDesc(stat, 1);
      expect(desc, stat).not.toBe(`stat.${stat}.desc`);
      expect(desc, stat).not.toContain('{n}');
      expect(desc, stat).toContain('이미 투자한');
    }
  });
});

describe('스킬 어픽스 수치 서식 — 퍼센트도 플래그도 아니다', () => {
  it('+1 / +2 그대로 나온다(% 없음, 빈 문자열 아님)', () => {
    expect(statValueText('skillLvOffense', 1)).toBe('+1');
    expect(statValueText('skillLvOffense', 2)).toBe('+2');
    expect(statValueText('skillLvDefense', 1)).toBe('+1');
    expect(statValueText('skillLvUtility', 2)).toBe('+2');
  });

  it('제목 줄에 % 기호가 없다', () => {
    for (const stat of SKILL_STATS) {
      const line = affixTitleLine({ id: 'of-honing', stat, value: 1 });
      expect(line, stat).not.toContain('%');
    }
  });
});

describe('skillAxisOfStat', () => {
  it('3 스킬 stat 을 각자의 축으로 매핑한다', () => {
    expect(skillAxisOfStat('skillLvOffense')).toBe('offense');
    expect(skillAxisOfStat('skillLvDefense')).toBe('defense');
    expect(skillAxisOfStat('skillLvUtility')).toBe('utility');
  });

  it('일반 stat 은 undefined', () => {
    expect(skillAxisOfStat('damagePct')).toBeUndefined();
    expect(skillAxisOfStat('maxHpFlat')).toBeUndefined();
  });
});

describe('affixLinesForHangar — 축 투자 0이면 회색 + 안내', () => {
  it('그 축 투자가 0이면 두 줄 다 회색이고 noInvest 안내가 제목 줄에 붙는다', () => {
    const lines = affixLinesForHangar(
      [{ id: 'of-honing', stat: 'skillLvOffense', value: 1 }],
      () => 0,
    );
    expect(lines.length).toBe(2);
    expect(lines[0]!.color).toBeDefined();
    expect(lines[1]!.color).toBeDefined();
    expect(lines[0]!.color).toBe(lines[1]!.color);
    expect(lines[0]!.text).toContain(statLabel('skillLvOffense'));
    // 값을 숨기지 않는다 — 수치(+1)는 그대로 남아 있어야 한다.
    expect(lines[0]!.text).toContain('+1');
  });

  it('투자가 있으면 무채색이다(color 없음)', () => {
    const lines = affixLinesForHangar(
      [{ id: 'of-honing', stat: 'skillLvOffense', value: 1 }],
      () => 3,
    );
    expect(lines[0]!.color).toBeUndefined();
    expect(lines[1]!.color).toBeUndefined();
  });

  it('스킬 축이 아닌 일반 어픽스는 축 조회 콜백과 무관하게 항상 무채색이다', () => {
    const lines = affixLinesForHangar(
      [{ id: 'sharp', stat: 'damagePct', value: 8 }],
      () => 0, // 콜백이 0을 줘도 스킬 축이 아니므로 영향 없어야 한다.
    );
    expect(lines[0]!.color).toBeUndefined();
    expect(lines[1]!.color).toBeUndefined();
  });

  it('축이 다르면 서로 간섭하지 않는다 — offense 만 0이어도 defense 어픽스는 무채색', () => {
    const lines = affixLinesForHangar(
      [
        { id: 'of-honing', stat: 'skillLvOffense', value: 1 },
        { id: 'of-tenacity', stat: 'skillLvDefense', value: 1 },
      ],
      (axis) => (axis === 'offense' ? 0 : 5),
    );
    expect(lines[0]!.color).toBeDefined(); // offense 제목
    expect(lines[2]!.color).toBeUndefined(); // defense 제목
  });
});
