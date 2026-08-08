/**
 * **벤치 오퍼 픽 정책**(`applyPilotPickPolicy`, `src/sim/autopilot.ts`) — 계약 전수.
 *
 * ## 이 파일이 잠그는 것
 * | # | 계약 | 절 |
 * |---|---|---|
 * | 1 | 정책 미지정이면 프레임·**해시 스트림**이 비트 동일 | ① |
 * | 2 | 프리즈 틱에서만, `special` 인덱스 **하나만** 바뀐다 | ② |
 * | 3 | 오퍼 수로 **클램프**한다(범위 밖 픽 = 영구 프리즈를 막는다) | ③ |
 * | 4 | 같은 시드 두 번 → 같은 해시 스트림(RNG 미소비) | ④ |
 * | 5 | `--pick=2` 가 실제로 칸 2 를 누른다(`id 18` 부채가 선다) | ⑤ |
 *
 * ① 이 이 레인의 실질이다 — `pilotFreezeFrame()` 은 **두 파일럿과 그 골든의 정본**이라,
 * "게이트를 바깥에 뒀다"는 주장이 아니라 **해시 스트림 대조**가 증거여야 한다
 * (`tests/contactPilot.test.ts` ① 과 같은 규율).
 *
 * ③ 이 없으면 sim 이 범위 밖 인덱스를 **소비하지 않고 프리즈를 유지**하므로
 * (`src/sim/world.ts` 픽 처리 블록) 3택이 접힌 레벨업에서 런이 영원히 멈춘다.
 *
 * ⚠️ rig 는 `DEFAULT_CONFIG` 가 아니라 **`bench/runCurve.ts` 와 같은 표준 빌드 + 내구 HP** 다.
 * 기본 설정(1레벨·무장비)으로는 6000틱에 레벨업이 0~1회라 픽 경로를 사실상 안 지난다 —
 * 그 위에서 초록이면 아무것도 안 잰 초록이다(실측으로 확인하고 rig 를 바꿨다).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, packPowerupPick, SPECIAL_NONE } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { beginMeasureRun } from '../src/sim/measurePilot.js';
import { applyPilotPickPolicy, MAX_PICK_INDEX } from '../src/sim/autopilot.js';
import { contactPilotInput } from '../bench/contactPilot.js';
import {
  CARD_MERCANTILE,
  MERCANTILE_DEBT_INDEX,
  mercantileDebtOf,
} from '../src/sim/catalyst/resource.js';
import {
  standardEquipped,
  standardPerTree,
  standardStage,
  investVector,
} from '../src/bench/standardBuild.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { buildRunConfig } from '../src/run/runConfig.js';

/** 내구 파일럿 HP — `bench/runCurve.ts --durable` 과 같은 값. 죽어서 레벨업을 못 밟는 것을 막는다. */
const DURABLE_HP = 100_000_000;

/** `bench/runCurve.ts` 의 `runOne` 과 같은 런 설정(표준 빌드 · 행성 0 · 내구 파일럿). */
function benchConfig(level: number, seed: number, catalysts: readonly number[] = []): WorldConfig {
  const p = defaultProfile();
  const s = activeShip(p);
  s.typeId = 0;
  s.skillInvest = investVector(0, standardPerTree(level));
  s.level = level;
  s.equipped = standardEquipped(level, seed, 0);
  const cfg = buildRunConfig(p, {
    planet: 0,
    stage: standardStage(level),
    catalysts: [...catalysts],
  });
  cfg.playerHp = DURABLE_HP;
  return cfg;
}

interface RunTrace {
  readonly hashes: number[];
  readonly frames: InputFrame[];
  readonly freezeTicks: number;
  readonly state: WorldState;
}

/** `pickIndex` 정책으로 한 런을 굴리며 틱별 해시와 프레임을 모은다. */
function trace(
  seed: number,
  cfg: WorldConfig,
  ticks: number,
  pickIndex: number | undefined,
): RunTrace {
  const state = createWorld(seed, cfg);
  beginMeasureRun(state);
  const hashes: number[] = [hashWorld(state)];
  const frames: InputFrame[] = [];
  let freezeTicks = 0;
  for (let i = 0; i < ticks; i++) {
    if (state.pendingLevelUp) freezeTicks++;
    const f = applyPilotPickPolicy(state, contactPilotInput(state), pickIndex);
    frames.push(f);
    stepWorld(state, f);
    hashes.push(hashWorld(state));
    if (state.victory || state.gameOver) break;
  }
  return { hashes, frames, freezeTicks, state };
}

// ---------------------------------------------------------------------------
// ① 정책 미지정 — 종전 경로와 비트 동일
// ---------------------------------------------------------------------------

describe('① 정책 미지정이면 종전과 비트 동일하다', () => {
  /** 정책 층을 씌운 런과 **아예 안 씌운** 런의 해시 스트림을 원소 단위로 비교한다. */
  function assertIdentical(seed: number, cfg: WorldConfig, ticks: number): number {
    const withLayer = trace(seed, cfg, ticks, undefined);

    const bare = createWorld(seed, cfg);
    beginMeasureRun(bare);
    const bareHashes: number[] = [hashWorld(bare)];
    const bareFrames: InputFrame[] = [];
    for (let i = 0; i < ticks; i++) {
      const f = contactPilotInput(bare);
      bareFrames.push(f);
      stepWorld(bare, f);
      bareHashes.push(hashWorld(bare));
      if (bare.victory || bare.gameOver) break;
    }

    expect(withLayer.hashes.length).toBe(bareHashes.length);
    for (let i = 0; i < bareHashes.length; i++) {
      expect(withLayer.hashes[i]).toBe(bareHashes[i]);
    }
    expect(withLayer.frames).toEqual(bareFrames);
    return withLayer.freezeTicks;
  }

  it('무촉매 런 (곡선 스윕 base 경로) — 레벨업을 실제로 밟는다', () => {
    // 공허 방어 — 프리즈 틱이 0 이면 이 단언이 픽 경로를 한 번도 안 지난 초록이다.
    expect(assertIdentical(1234, benchConfig(10, 1234), 3000)).toBeGreaterThan(0);
  });

  it('`id 18` 이 실린 런', () => {
    expect(assertIdentical(777, benchConfig(10, 777, [CARD_MERCANTILE]), 3000)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ② 프리즈 틱에서만, `special` 하나만 바뀐다
// ---------------------------------------------------------------------------

/** 레벨업 프리즈가 걸릴 때까지 굴린다. 안 걸리면 실패(공허 방어). */
function stepToFreeze(seed: number, level = 10, ticks = 3000): WorldState {
  const state = createWorld(seed, benchConfig(level, seed));
  beginMeasureRun(state);
  for (let i = 0; i < ticks; i++) {
    if (state.pendingLevelUp) return state;
    stepWorld(state, contactPilotInput(state));
    if (state.victory || state.gameOver) break;
  }
  throw new Error('no level-up freeze occurred -- rig is measuring nothing');
}

describe('② 프리즈 틱의 `special` 인덱스만 갈아 끼운다', () => {
  it('칸 2 를 고르면 `special` 이 `packPowerupPick(2)` 다 (나머지 필드 불변)', () => {
    const state = stepToFreeze(1234);
    expect(state.powerupChoices.length).toBeGreaterThan(2);
    const base = contactPilotInput(state);
    expect(base.special).toBe(packPowerupPick(0));

    const picked = applyPilotPickPolicy(state, base, 2);
    expect(picked.special).toBe(packPowerupPick(2));
    expect(picked.moveX).toBe(base.moveX);
    expect(picked.moveY).toBe(base.moveY);
    expect(picked.aim).toBe(base.aim);
    expect(picked.dash).toBe(base.dash);
  });

  it('칸 0 을 명시해도 종전 프레임과 같다 (같은 객체를 그대로 돌려준다)', () => {
    const state = stepToFreeze(777);
    const base = contactPilotInput(state);
    expect(applyPilotPickPolicy(state, base, 0)).toBe(base);
  });

  it('프리즈 틱이 아니면 손대지 않는다', () => {
    const state = createWorld(101, benchConfig(10, 101));
    beginMeasureRun(state);
    for (let i = 0; i < 60; i++) stepWorld(state, contactPilotInput(state));
    expect(state.pendingLevelUp).toBeFalsy();
    const base = contactPilotInput(state);
    expect(applyPilotPickPolicy(state, base, 2)).toBe(base);
  });

  it('픽 비트가 없는 프레임은 손대지 않는다 (발동 비트를 새로 싣지 않는다)', () => {
    const state = stepToFreeze(1234);
    const noPick: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: SPECIAL_NONE };
    expect(applyPilotPickPolicy(state, noPick, 2)).toBe(noPick);
  });
});

// ---------------------------------------------------------------------------
// ③ 클램프 — 범위 밖 인덱스가 런을 멈추지 못하게 한다
// ---------------------------------------------------------------------------

describe('③ 오퍼 수로 클램프한다', () => {
  it('오퍼가 2칸이면 칸 2 요청이 칸 1 로 접힌다', () => {
    const state = stepToFreeze(1234);
    state.powerupChoices = state.powerupChoices.slice(0, 2);
    expect(applyPilotPickPolicy(state, contactPilotInput(state), 2).special).toBe(
      packPowerupPick(1),
    );
  });

  it('오퍼가 1칸이면 어떤 요청도 칸 0 이다', () => {
    const state = stepToFreeze(1234);
    state.powerupChoices = state.powerupChoices.slice(0, 1);
    expect(applyPilotPickPolicy(state, contactPilotInput(state), 2).special).toBe(
      packPowerupPick(0),
    );
  });

  it('오퍼가 0칸이면 프레임을 그대로 둔다 (고를 자리가 없다)', () => {
    const state = stepToFreeze(1234);
    state.powerupChoices = [];
    const base = contactPilotInput(state);
    expect(applyPilotPickPolicy(state, base, 2)).toBe(base);
  });

  it('2비트 상한을 넘는 요청은 상한으로 접힌다 (조용히 뒤집히지 않는다)', () => {
    const state = stepToFreeze(1234);
    // 오퍼가 상한보다 많아도 인덱스는 2비트(`packPowerupPick` 의 `& 0x3`)라 상한을 못 넘는다.
    const pool = state.powerupChoices[0] ?? 0;
    state.powerupChoices = [pool, pool, pool, pool, pool, pool];
    expect(applyPilotPickPolicy(state, contactPilotInput(state), 99).special).toBe(
      packPowerupPick(MAX_PICK_INDEX),
    );
  });

  it('음수는 칸 0 이다', () => {
    const state = stepToFreeze(1234);
    expect(applyPilotPickPolicy(state, contactPilotInput(state), -3).special).toBe(
      packPowerupPick(0),
    );
  });

  it('접힌 3택 + 칸 2 요청으로도 런이 멈추지 않는다 (프리즈가 실제로 풀린다)', () => {
    // 클램프가 없으면 sim 이 픽을 소비하지 않아 여기서 프리즈가 영원히 유지된다.
    const state = stepToFreeze(1234);
    state.powerupChoices = state.powerupChoices.slice(0, 2);
    stepWorld(state, applyPilotPickPolicy(state, contactPilotInput(state), 2));
    expect(state.pendingLevelUp).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ④ 결정론 — RNG 미소비
// ---------------------------------------------------------------------------

describe('④ 같은 시드 두 번이면 같은 해시 스트림', () => {
  it('`--pick=2` 런이 재현된다', () => {
    const cfg = benchConfig(10, 1234, [CARD_MERCANTILE]);
    const a = trace(1234, cfg, 1500, MERCANTILE_DEBT_INDEX);
    const b = trace(1234, cfg, 1500, MERCANTILE_DEBT_INDEX);
    expect(a.hashes.length).toBeGreaterThan(500);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.frames).toEqual(b.frames);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 손잡이가 실제로 그 칸을 누른다 — `id 18` 부채
// ---------------------------------------------------------------------------

describe('⑤ 칸 2 를 누르면 `id 18` 부채가 선다', () => {
  it('기본(칸 0)은 부채 0, `--pick=2` 는 부채 > 0', () => {
    const cfg = benchConfig(10, 1234, [CARD_MERCANTILE]);
    const dflt = trace(1234, cfg, 3000, undefined);
    const picked = trace(1234, cfg, 3000, MERCANTILE_DEBT_INDEX);

    // 공허 방어 — 레벨업을 안 밟으면 양쪽 다 0 이 당연하다.
    expect(picked.freezeTicks).toBeGreaterThan(0);
    expect(mercantileDebtOf(dflt.state)).toBe(0);
    expect(mercantileDebtOf(picked.state)).toBeGreaterThan(0);
  });
});
