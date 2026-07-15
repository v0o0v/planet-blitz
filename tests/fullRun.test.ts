import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import { atan2, length } from '../src/sim/math.js';
import { runReplay } from '../src/sim/replay.js';

/**
 * Drive a full run to completion with a durable pilot.
 *
 * The vulcan auto-targets the nearest hostile, so during the six wave segments
 * an idle pilot clears them (segments also advance on their own timers). Once the
 * boss appears the pilot steers toward it — otherwise a perfectly stationary
 * pilot can get pinned targeting a knot of leftover self-healing adds that sit
 * marginally closer than the boss. The steering policy is a pure function of the
 * world state, so every frame is deterministic and the log replays identically.
 */
function playToEnd(seed: number, config: WorldConfig): { state: WorldState; inputs: InputFrame[] } {
  const state = createWorld(seed, config);
  const inputs: InputFrame[] = [];
  const maxTicks = 60 * 600; // generous 10-minute ceiling
  for (let t = 0; t < maxTicks; t++) {
    const player = state.entities[0]!;
    const boss = state.entities.find((e) => e.kind === 'boss');
    let frame: InputFrame;
    if (state.pendingLevelUp) {
      frame = { ...emptyInput(), special: packPowerupPick(0) };
    } else if (boss !== undefined) {
      const dx = boss.x - player.x;
      const dy = boss.y - player.y;
      const len = length(dx, dy) || 1;
      frame = { moveX: dx / len, moveY: dy / len, aim: atan2(dy, dx), dash: false, special: 0 };
    } else {
      frame = emptyInput();
    }
    inputs.push(frame);
    stepWorld(state, frame);
    if (state.gameOver || state.victory) break;
  }
  return { state, inputs };
}

describe('full run to victory (task 15, e2e)', () => {
  // Durable pilot: survives the whole run so the boss segment is always reached.
  const durable: WorldConfig = { ...DEFAULT_CONFIG, playerHp: 100_000_000 };

  it('clears six segments, defeats the boss, and reaches victory without throwing', () => {
    const { state } = playToEnd(0x50c1a1, durable);
    expect(state.victory).toBe(true);
    expect(state.gameOver).toBe(false);
    // Reached the boss segment (index 5) and spawned + killed the boss.
    expect(state.wave.segmentIndex).toBe(5);
    expect(state.bossSpawned).toBe(true);
    expect(state.entities.some((e) => e.kind === 'boss')).toBe(false); // boss dead
    // A real run: enemies were killed and levels were gained along the way.
    expect(state.kills).toBeGreaterThan(0);
    expect(state.level).toBeGreaterThan(1);
  });

  it('records the boss guaranteed rare+ drop into finalState.loot on victory (리뷰 HIGH)', () => {
    // 회귀: 승리 tick에는 다음 stepWorld가 즉시 return해 바닥 loot가 수거되지 않는다.
    // 보스 확정 드랍은 compact에서 state.loot에 직접 기록돼야 정산에서 유실되지 않는다.
    const { state } = playToEnd(0x50c1a1, durable);
    expect(state.victory).toBe(true);
    // rare(2) 이상 엔트리가 최소 1개(보스 확정 드랍) 존재해야 한다.
    const rarePlus = state.loot.filter((r) => r.rarity >= 2);
    expect(rarePlus.length).toBeGreaterThanOrEqual(1);
  });

  it('the winning run replays deterministically to the same victory', () => {
    const { inputs } = playToEnd(0x50c1a1, durable);
    const a = runReplay({ seed: 0x50c1a1, config: durable, inputs });
    const b = runReplay({ seed: 0x50c1a1, config: durable, inputs });
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalState.victory).toBe(true);
    expect(b.finalState.victory).toBe(true);
  });
});
