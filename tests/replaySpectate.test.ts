/**
 * 리플레이 관전 순수 로직 검증 (src/ui/replaySpectate.ts — M4 Phase F3, AC10).
 *
 * DOM 오버레이가 아니라 재생을 떠받치는 순수 함수를 검증한다:
 *   1) isPlayableReplay — 재생 가능한 리플레이 shape 게이트(손상 거부).
 *   2) nextSpectateSpeed — 배속 순환(1→2→4→1).
 *   3) spectateProgressLabel / spectateFraction — 진행 표시(초 환산·클램프).
 */

import { describe, it, expect } from 'vitest';
import {
  isPlayableReplay,
  nextSpectateSpeed,
  spectateProgressLabel,
  spectateFraction,
} from '../src/ui/replaySpectate.js';
import { emptyInput } from '../src/sim/world.js';

describe('isPlayableReplay — 재생 가능 shape 게이트', () => {
  it('seed(수) + 비어있지 않은 inputs 배열이면 통과', () => {
    expect(isPlayableReplay({ seed: 7, inputs: [emptyInput()] })).toBe(true);
    expect(isPlayableReplay({ seed: 0, inputs: [emptyInput(), emptyInput()] })).toBe(true);
  });

  it('손상/부재는 거부', () => {
    expect(isPlayableReplay(null)).toBe(false);
    expect(isPlayableReplay(undefined)).toBe(false);
    expect(isPlayableReplay({})).toBe(false);
    expect(isPlayableReplay({ seed: 'x', inputs: [emptyInput()] })).toBe(false);
    expect(isPlayableReplay({ seed: NaN, inputs: [emptyInput()] })).toBe(false);
    expect(isPlayableReplay({ seed: 1, inputs: [] })).toBe(false); // 빈 입력 로그
    expect(isPlayableReplay({ seed: 1, inputs: 'nope' })).toBe(false);
  });
});

describe('nextSpectateSpeed — 배속 순환', () => {
  it('1 → 2 → 4 → 1', () => {
    expect(nextSpectateSpeed(1)).toBe(2);
    expect(nextSpectateSpeed(2)).toBe(4);
    expect(nextSpectateSpeed(4)).toBe(1);
  });
});

describe('spectateProgressLabel — 초 환산(60fps)', () => {
  it('m:ss / m:ss 형식', () => {
    expect(spectateProgressLabel(0, 0)).toBe('0:00 / 0:00');
    expect(spectateProgressLabel(60, 240)).toBe('0:01 / 0:04');
    expect(spectateProgressLabel(60 * 83, 60 * 240)).toBe('1:23 / 4:00');
  });
});

describe('spectateFraction — 진행률 클램프', () => {
  it('0..1 로 클램프, total 0 이면 0', () => {
    expect(spectateFraction(0, 100)).toBe(0);
    expect(spectateFraction(50, 100)).toBe(0.5);
    expect(spectateFraction(100, 100)).toBe(1);
    expect(spectateFraction(150, 100)).toBe(1); // 초과 클램프
    expect(spectateFraction(10, 0)).toBe(0); // total 0
    expect(spectateFraction(-5, 100)).toBe(0); // 음수 클램프
  });
});
