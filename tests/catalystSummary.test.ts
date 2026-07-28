/**
 * 촉매 전체 효과 집계 — 순수 계약 (`src/data/catalystSummary.ts`, 사용자 요청 2026-07-28).
 *
 * 이 화면(픽커 하단 요약 · 런 중 정보판)의 존재 이유는 "8장을 넣었을 때 실제 배율이 얼마인가"
 * 였으므로, 테스트도 **집계가 sim 배율 함수와 같은 값을 내는지**에 건다. 표시용 별도 산식이
 * 슬쩍 생기면 여기서 깨진다.
 */

import { describe, it, expect } from 'vitest';
import {
  CATALYSTS,
  catalystPenaltyMult,
  catalystPowerMult,
  catalystRewardMult,
} from '../src/data/catalysts.js';
import { catalystSummary, formatCatalystMult } from '../src/data/catalystSummary.js';

describe('catalystSummary', () => {
  it('빈 배열은 줄이 하나도 없다', () => {
    const s = catalystSummary([]);
    expect(s.count).toBe(0);
    expect(s.kinds).toBe(0);
    expect(s.penalties).toEqual([]);
    expect(s.rewards).toEqual([]);
  });

  it('스택은 선형 가산 — 같은 촉매 3장이면 perStack 3배', () => {
    const def = CATALYSTS[0]!; // abundance: drop 보상 / enemyCount 페널티
    const s = catalystSummary([def.id, def.id, def.id]);
    expect(s.count).toBe(3);
    expect(s.kinds).toBe(1); // 스택은 1종으로 센다
    expect(s.rewards).toHaveLength(1);
    expect(s.rewards[0]!.axis).toBe('drop');
    expect(s.rewards[0]!.mult).toBeCloseTo(1 + def.reward.perStack * 3, 10);
    expect(s.penalties).toHaveLength(1);
    expect(s.penalties[0]!.axis).toBe('enemyCount');
    expect(s.penalties[0]!.mult).toBeCloseTo(1 + def.penalty.perStack * 3, 10);
  });

  it('배율은 sim 이 쓰는 함수와 정확히 같다(표시=계약)', () => {
    // 보상축이 서로 다른 촉매를 섞어 여러 줄이 나오게 한다.
    const ids = [0, 5, 10, 15, 20, 25, 25];
    const s = catalystSummary(ids);
    for (const line of s.penalties) {
      expect(line.mult).toBeCloseTo(catalystPenaltyMult(ids, line.axis), 10);
    }
    for (const line of s.rewards) {
      const expected =
        line.axis === 'power'
          ? catalystPowerMult(ids, line.powerStat!)
          : catalystRewardMult(ids, line.axis);
      expect(line.mult).toBeCloseTo(expected, 10);
    }
  });

  it('파워 보상은 스탯별로 갈라진다 — 합산 한 줄로 뭉치지 않는다', () => {
    // 25 = damage, 26 = fireRate.
    const s = catalystSummary([25, 26]);
    const power = s.rewards.filter((r) => r.axis === 'power');
    expect(power).toHaveLength(2);
    expect(power.map((p) => p.powerStat)).toEqual(['damage', 'fireRate']);
  });

  it('미지 id 는 count 에도 줄에도 들지 않는다', () => {
    const s = catalystSummary([0, 9999, -1]);
    expect(s.count).toBe(1);
    expect(s.rewards).toHaveLength(1);
  });

  it('축 순서는 주입 순서와 무관하게 고정이다', () => {
    const a = catalystSummary([20, 15, 10, 5, 0]);
    const b = catalystSummary([0, 5, 10, 15, 20]);
    expect(a.rewards.map((r) => r.axis)).toEqual(b.rewards.map((r) => r.axis));
    expect(a.penalties.map((p) => p.axis)).toEqual(b.penalties.map((p) => p.axis));
  });
});

describe('formatCatalystMult', () => {
  it('배율을 정수 퍼센트 증가분으로 옮긴다', () => {
    expect(formatCatalystMult(1)).toBe('+0%');
    expect(formatCatalystMult(1.15)).toBe('+15%');
    expect(formatCatalystMult(1.45)).toBe('+45%');
  });

  it('부동소수 찌꺼기를 남기지 않는다(0.15 세 번 = +45%)', () => {
    expect(formatCatalystMult(1 + 0.15 + 0.15 + 0.15)).toBe('+45%');
  });

  it('1 미만은 +0% 로 접는다(줄 유무는 집계가 이미 정했다)', () => {
    expect(formatCatalystMult(0.8)).toBe('+0%');
  });
});
