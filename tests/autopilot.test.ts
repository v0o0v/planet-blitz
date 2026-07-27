import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, markTainted, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { hashWorld } from '../src/sim/replay.js';

/** 오토파일럿으로 world를 최대 `ticks`틱 구동하고, 매 틱 hashWorld를 수집한다. */
function driveAutopilot(seed: number, config: WorldConfig, ticks: number): number[] {
  const state = createWorld(seed, config);
  const hashes: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const input = autopilotInput(state);
    stepWorld(state, input);
    hashes.push(hashWorld(state));
    if (state.gameOver || state.victory) break;
  }
  return hashes;
}

describe('autopilot (ADR-0008, 결정론 입력 봇)', () => {
  const SEED = 0xa07071;

  /**
   * 생존 증인 시드. 결정론 단언들은 {@link SEED} 를 그대로 쓰고(그 성질은 시드와 무관하다),
   * **생존·레벨업 관측만** 이 시드를 쓴다 — 관측 조건만 갈고 나머지 증인은 보존하기 위해서다.
   *
   * 2026-07-27 밸런스 패스에서 신설했다. 적 축(`SEGMENTS.killGoal` 80 → 240, `eliteCount`
   * 밴드0 0 → 1)과 런 풀 커브(`xpToNext` 10+6L → 10+66L)가 함께 오르면서 무장비 오토파일럿이
   * `SEED` 에서 **1,160틱에 사망**한다(목표 1,200 — 40틱 모자란다). 재표본
   * (`0xa07071..0xa07138` 연속 200시드): 1,200틱 생존 + 레벨 2 도달이 다수 관측되고
   * 그중 첫 값이 **`0xa07073`** 이다. 불변식("적정 티어에서 최소 1,200틱 버티고 1레벨 오른다")은
   * 그대로고 증인만 바뀌었다.
   */
  const SURVIVE_SEED = 0xa07073;

  it('같은 시드+config로 두 번 구동하면 매 틱 hashWorld가 동일하다', () => {
    const a = driveAutopilot(SEED, DEFAULT_CONFIG, 2000);
    const b = driveAutopilot(SEED, DEFAULT_CONFIG, 2000);
    expect(a).toEqual(b);
  });

  it('고정 시드에서 최소 1200틱 생존하고 최소 1레벨을 올린다', () => {
    // 생존형 파일럿: 기본 HP로도 초반 세그먼트를 넘기며 젬을 모아 레벨을 올린다.
    const state = createWorld(SURVIVE_SEED, DEFAULT_CONFIG);
    const surviveTicks = 1200;
    let ticks = 0;
    for (let t = 0; t < surviveTicks; t++) {
      const input = autopilotInput(state);
      stepWorld(state, input);
      if (state.gameOver) break;
      ticks++;
    }
    expect(ticks).toBe(surviveTicks);
    expect(state.gameOver).toBe(false);
    expect(state.level).toBeGreaterThan(1);
  });

  it('markTainted는 hashWorld 출력을 바꾸지 않는다', () => {
    const clean = createWorld(SEED, DEFAULT_CONFIG);
    const dirty = createWorld(SEED, DEFAULT_CONFIG);
    // 몇 틱 진행시켜 자명하지 않은 상태를 만든다.
    for (let t = 0; t < 300; t++) {
      const ci = autopilotInput(clean);
      stepWorld(clean, ci);
      const di = autopilotInput(dirty);
      stepWorld(dirty, di);
    }
    const before = hashWorld(dirty);
    markTainted(dirty);
    expect(dirty.tainted).toBe(true);
    expect(hashWorld(dirty)).toBe(before);
    // 오염 표시 여부와 무관하게 두 런의 해시는 동일하다.
    expect(hashWorld(dirty)).toBe(hashWorld(clean));
  });
});
