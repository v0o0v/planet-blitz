/**
 * 어픽스 표시 문자열 — 툴팁이 raw StatKey 를 노출하지 않는다 (사용자 피드백 2026-07-26).
 *
 * 지적의 실체: `예리한 (damagePct +8)` 처럼 **내부 식별자**가 화면에 그대로 나와 무엇이
 * 좋아지는지 읽히지 않았다. 여기서는 ①모든 StatKey 에 표시명·설명이 실제로 있고(키가 그대로
 * 새지 않고) ②퍼센트/절대값 단위가 갈리고 ③툴팁 줄 어디에도 StatKey 문자열이 남지 않음을
 * 못 박는다.
 */

import { describe, it, expect } from 'vitest';

import { AFFIXES } from '../data/affixes.js';
import type { StatKey } from '../src/items/types.js';
import {
  affixLines,
  affixTitleLine,
  statDesc,
  statLabel,
  statValueText,
} from '../src/ui/affixText.js';

/** 카탈로그에 실린 전 StatKey(어픽스 풀에서 파생 — 새 어픽스가 늘면 자동으로 검사 대상이 된다). */
const ALL_STATS: StatKey[] = [...new Set(AFFIXES.map((a) => a.stat))];

describe('stat 표시명·설명 커버리지', () => {
  it('모든 StatKey 에 표시명이 있다(키가 그대로 새지 않는다)', () => {
    for (const stat of ALL_STATS) {
      expect(statLabel(stat), stat).not.toBe(`stat.${stat}.name`);
      expect(statLabel(stat).length).toBeGreaterThan(0);
    }
  });

  it('모든 StatKey 에 설명이 있고 수치가 치환된다', () => {
    for (const stat of ALL_STATS) {
      const desc = statDesc(stat, 7);
      expect(desc, stat).not.toBe(`stat.${stat}.desc`);
      expect(desc, stat).not.toContain('{n}'); // 미치환 플레이스홀더 금지
    }
  });
});

describe('수치 서식', () => {
  it('퍼센트 stat 은 %, 절대값 stat 은 숫자 그대로', () => {
    expect(statValueText('damagePct', 8)).toBe('+8%');
    expect(statValueText('rangeFlat', 120)).toBe('+120');
    expect(statValueText('maxHpFlat', 25)).toBe('+25');
  });

  it('냉기는 값이 항상 1 인 플래그라 수치를 붙이지 않는다', () => {
    expect(statValueText('coldSlow', 1)).toBe('');
    expect(affixTitleLine({ id: 'freezing', stat: 'coldSlow', value: 1 })).not.toContain('+1');
  });
});

describe('툴팁 줄', () => {
  it('제목 줄에 어픽스 이름과 표시명이 함께 나오고 StatKey 는 없다', () => {
    const line = affixTitleLine({ id: 'sharp', stat: 'damagePct', value: 8 });
    expect(line).toContain('예리한');
    expect(line).toContain(statLabel('damagePct'));
    expect(line).not.toContain('damagePct');
  });

  it('어픽스 1개당 제목 + 설명 2줄이 나온다', () => {
    const lines = affixLines([
      { id: 'sharp', stat: 'damagePct', value: 8 },
      { id: 'of-vitality', stat: 'maxHpFlat', value: 20 },
    ]);
    expect(lines.length).toBe(4);
    for (const stat of ALL_STATS) {
      for (const line of lines) expect(line).not.toContain(stat);
    }
  });

  it('정의를 못 찾는 어픽스도 표시명·수치는 남긴다(빈 줄 금지)', () => {
    const line = affixTitleLine({ id: 'no-such-affix', stat: 'xpPct', value: 5 });
    expect(line).toBe(`${statLabel('xpPct')} +5%`);
  });
});
