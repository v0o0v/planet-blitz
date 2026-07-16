/**
 * 튜토리얼 단축판 (M3 후속 — GDD §12 "3~4분 단축판").
 *
 * config.maxSegments가 일반 세그먼트를 상한만큼만 소화하고 곧장 보스 세그먼트로
 * 점프하는지, 필드 부재 시 풀 런 거동이 그대로인지(회귀 0), 그리고 단축 런이
 * 결정론적으로 재현되는지(ADR-0005) 확인한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import { runReplay, idleInputs } from '../src/sim/replay.js';
import { SEGMENTS } from '../data/waves.js';
import { TUTORIAL_SEED, TUTORIAL_PLANET, TUTORIAL_TIER, TUTORIAL_MAX_SEGMENTS } from '../src/ui/tutorial.js';

const BOSS_INDEX = SEGMENTS.length - 1;

/** 내구 파일럿 — 무입력 방치로도 런이 끊기지 않게(세그먼트 궤적 관찰용). */
const DURABLE: WorldConfig = { ...DEFAULT_CONFIG, playerHp: 100_000_000 };

/** maxSegments 상한 런에서 도달한 세그먼트 인덱스 궤적을 수집한다. */
function segmentTrace(config: WorldConfig, ticks: number): number[] {
  const state = createWorld(0x707, config);
  const seen: number[] = [];
  for (let t = 0; t < ticks; t++) {
    // 레벨업 선택 대기는 sim을 멈추므로 첫 후보를 자동 픽해 궤적 관찰을 지속한다.
    const frame = state.pendingLevelUp
      ? { ...emptyInput(), special: packPowerupPick(0) }
      : emptyInput();
    stepWorld(state, frame);
    const idx = state.wave.segmentIndex;
    if (seen[seen.length - 1] !== idx) seen.push(idx);
  }
  return seen;
}

describe('튜토리얼 단축판 (maxSegments)', () => {
  // 일반 세그먼트 3개 분량 + 여유 1세그. durationTicks는 데이터에서 직접 합산.
  const seg = (i: number): number => SEGMENTS[i]?.durationTicks ?? 0;
  const threeSegTicks = seg(0) + seg(1) + seg(2) + seg(3);

  it('상한 3이면 세그먼트 0→1→2 후 곧장 보스 세그먼트로 점프한다', () => {
    const trace = segmentTrace({ ...DURABLE, maxSegments: 3 }, threeSegTicks);
    expect(trace).toEqual([0, 1, 2, BOSS_INDEX]);
  });

  it('필드 부재 시 풀 런 순서(0→1→2→3…)가 보존된다(회귀 0)', () => {
    const trace = segmentTrace({ ...DURABLE }, threeSegTicks);
    expect(trace).toEqual([0, 1, 2, 3]);
  });

  it('단축 런은 동일 시드·입력으로 per-tick 해시가 재현된다(ADR-0005)', () => {
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      planet: TUTORIAL_PLANET,
      tier: TUTORIAL_TIER,
      maxSegments: TUTORIAL_MAX_SEGMENTS,
    };
    const inputs = idleInputs(900);
    const a = runReplay({ seed: TUTORIAL_SEED, config, inputs });
    const b = runReplay({ seed: TUTORIAL_SEED, config, inputs });
    expect(a.hashes).toEqual(b.hashes);
  });

  it('maxSegments 유/무는 첫 틱부터 해시가 갈린다(서버 검증 가능 입력)', () => {
    const inputs = idleInputs(1);
    const full = runReplay({ seed: 0x515, config: { ...DEFAULT_CONFIG }, inputs });
    const short = runReplay({ seed: 0x515, config: { ...DEFAULT_CONFIG, maxSegments: 3 }, inputs });
    expect(short.finalHash).not.toBe(full.finalHash);
  });
});
