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
import { TUTORIAL_SEED, TUTORIAL_PLANET, TUTORIAL_STAGE, TUTORIAL_MAX_SEGMENTS } from '../src/ui/tutorial.js';

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
  // 처치 할당 게이트(ADR-0011): 세그먼트는 시간이 아니라 처치 수로 넘어간다. 내구
  // 파일럿(무입력, 오토어택은 자동 사격)이 3개 세그먼트 분량 처치 할당을 채우고 곧장
  // 보스로 점프하기에 넉넉한 틱 예산. 고정 타이머 폐지로 정확한 합산이 불가하므로 상한
  // 여유를 크게 준다(궤적은 처치 진행에 따라 창발).
  const ampleTicks = 60 * 200; // 여유 상한 — 실제 점프는 처치 할당 달성 시 발생.

  it('상한 3이면 세그먼트 0→1→2 후 곧장 보스 세그먼트로 점프한다', () => {
    const trace = segmentTrace({ ...DURABLE, maxSegments: 3 }, ampleTicks);
    expect(trace).toEqual([0, 1, 2, BOSS_INDEX]);
  });

  it('필드 부재 시 풀 런 순서(0→1→2→3→4→5→보스)가 보존된다(회귀 0)', () => {
    const trace = segmentTrace({ ...DURABLE }, ampleTicks);
    // 상한 부재 → 조기 보스 점프 없이 일반 세그먼트를 순서대로 소화 후 보스. index 3 은 중반
    // 격전(ADR-0032)이라 리더 처치로 넘어간다 — 궤적에는 다른 세그먼트와 똑같이 한 칸 찍힌다.
    expect(trace).toEqual([0, 1, 2, 3, 4, 5, BOSS_INDEX]);
  });

  it('단축 런은 동일 시드·입력으로 per-tick 해시가 재현된다(ADR-0005)', () => {
    const config: WorldConfig = {
      ...DEFAULT_CONFIG,
      planet: TUTORIAL_PLANET,
      stage: TUTORIAL_STAGE,
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
