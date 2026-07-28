/**
 * 하네스 리플레이 요약·직렬화 테스트 (`src/harness/replayStore.ts`).
 *
 * 핵심은 **parseReplay 가 어떤 입력에도 throw 하지 않는다**는 것과, 통과 기준이 관전 경로의
 * `isPlayableReplay` 와 같다는 것이다(하네스만 통과하고 관전에서 거부되는 괴리 금지).
 */

import { describe, it, expect } from 'vitest';
import { parseReplay, replaySummary, serializeReplay } from '../src/harness/replayStore.js';
import { isPlayableReplay } from '../src/ui/replaySpectate.js';
import type { Replay } from '../src/sim/replay.js';
import { DEFAULT_CONFIG, emptyInput, type InputFrame } from '../src/sim/world.js';
import { emptyInvasionLayers } from '../src/sim/invasion/normalize.js';
import { INVASION_TOTAL_TICKS } from '../src/sim/invasion/constants.js';
import { TICK_RATE } from '../src/sim/constants.js';

const FRAME: InputFrame = emptyInput();

function makeReplay(ticks: number, invasion: boolean): Replay {
  const inputs: InputFrame[] = new Array(ticks).fill(FRAME);
  return {
    seed: 4242,
    inputs,
    ...(invasion
      ? {
          config: {
            ...DEFAULT_CONFIG,
            invasion3: { layers: emptyInvasionLayers(), timeLimitTicks: INVASION_TOTAL_TICKS },
          },
        }
      : {}),
  };
}

describe('replaySummary', () => {
  it('틱 수 · 초 환산 · 시드를 낸다', () => {
    const s = replaySummary(makeReplay(180, false));
    expect(s.seed).toBe(4242);
    expect(s.ticks).toBe(180);
    expect(s.durationSec).toBe(180 / TICK_RATE);
    expect(s.invasion).toBe(false);
  });

  it('config.invasion3 가 있으면 invasion=true', () => {
    expect(replaySummary(makeReplay(60, true)).invasion).toBe(true);
  });

  it('config 는 있지만 invasion3 가 없으면 invasion=false', () => {
    const r: Replay = { seed: 1, inputs: [FRAME], config: { ...DEFAULT_CONFIG } };
    expect(replaySummary(r).invasion).toBe(false);
  });

  it('초 환산은 반올림 정수다', () => {
    expect(replaySummary(makeReplay(90, false)).durationSec).toBe(2);
    expect(replaySummary(makeReplay(89, false)).durationSec).toBe(1);
  });
});

describe('serializeReplay / parseReplay', () => {
  it('직렬화 → 파싱 왕복이 원본과 같다', () => {
    const r = makeReplay(120, true);
    const back = parseReplay(serializeReplay(r));
    expect(back).not.toBeNull();
    expect(back).toEqual(r);
    expect(replaySummary(back!)).toEqual(replaySummary(r));
  });

  it('손상 JSON 은 throw 하지 않고 null 을 낸다', () => {
    for (const bad of ['', '{', 'null', '[]', 'not json', '"문자열"', '123']) {
      expect(parseReplay(bad)).toBeNull();
    }
  });

  it('shape 불일치는 null(관전 경로 판정과 동일)', () => {
    const cases: unknown[] = [
      { seed: 1 },
      { seed: 1, inputs: [] },
      { seed: 'x', inputs: [FRAME] },
      { inputs: [FRAME] },
      { seed: Number.NaN, inputs: [FRAME] },
    ];
    for (const c of cases) {
      const json = JSON.stringify(c);
      expect(parseReplay(json)).toBeNull();
      expect(isPlayableReplay(c)).toBe(false);
    }
  });

  it('통과 기준이 isPlayableReplay 와 일치한다', () => {
    const ok = makeReplay(3, false);
    expect(isPlayableReplay(ok)).toBe(true);
    expect(parseReplay(serializeReplay(ok))).not.toBeNull();
  });
});
