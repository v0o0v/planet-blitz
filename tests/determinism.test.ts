import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { SeededRng } from '../src/sim/rng.js';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
  SPECIAL_POWERUP_PICK,
  TICK_RATE,
} from '../src/sim/world.js';
import {
  ARMOR_MAX_STACKS,
  OVERCHARGE_STILL_TICKS,
} from '../src/sim/shipSignature.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { runReplay, hashWorld, idleInputs } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';

/**
 * Build a deterministic, non-trivial input log that exercises movement, aiming
 * and dashing. Inputs are generated from a *separate* seeded RNG so the log
 * itself is reproducible but independent of the sim's internal RNG.
 */
function makeInputLog(seed: number, ticks: number): InputFrame[] {
  const gen = new SeededRng(seed);
  const inputs: InputFrame[] = [];
  for (let t = 0; t < ticks; t++) {
    inputs.push({
      moveX: gen.range(-1, 1),
      moveY: gen.range(-1, 1),
      aim: gen.range(-Math.PI, Math.PI),
      dash: gen.chance(0.05),
      special: 0,
    });
  }
  return inputs;
}

describe('deterministic replay (ADR-0005)', () => {
  it('produces identical per-tick hashes across two runs (idle input)', () => {
    const replay: Replay = { seed: 12345, inputs: idleInputs(600) };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.hashes.length).toBe(600);
  });

  it('produces identical per-tick hashes across a long roaming run (gimmicks/walls/LOS/chunks)', () => {
    // G2 determinism gate: idle/near-origin logs never leave the safe zone, so
    // they don't exercise chunk generation, wall slides, bullet-vs-wall or LOS.
    // This log drifts far off the origin (dashing) so walls, hazards, events and
    // chunk cull/regen all fire — the whole scroll-map surface under one hash.
    const gen = new SeededRng(0x1357);
    const ticks = 60 * 40; // 40 seconds
    const inputs: InputFrame[] = [];
    for (let t = 0; t < ticks; t++) {
      // Outward drift (diagonal) plus noise so the player genuinely roams into
      // gimmick territory instead of random-walking in place.
      inputs.push({
        moveX: 0.7 + gen.range(-0.5, 0.5),
        moveY: -0.7 + gen.range(-0.5, 0.5),
        aim: gen.range(-Math.PI, Math.PI),
        dash: gen.chance(0.06),
        special: 0,
      });
    }
    const replay: Replay = { seed: 0xbeef, inputs };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.hashes.length).toBe(ticks);
    // Sanity: the run really left the safe zone and materialised gimmicks.
    const player = a.finalState.entities[0]!;
    expect(Math.hypot(player.x, player.y)).toBeGreaterThan(2000);
    const gimmicks = a.finalState.entities.filter((e) =>
      ['wall', 'destructible', 'magnetEmitter', 'bombDevice', 'turretPickup'].includes(e.kind) ||
      (e.kind === 'hazard' && e.life < 0),
    );
    expect(gimmicks.length).toBeGreaterThan(0);
  });

  it('produces identical per-tick hashes across two runs (active input)', () => {
    const replay: Replay = { seed: 0xdecaf, inputs: makeInputLog(777, 60 * 8) };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
    // 8 seconds at 60 Hz.
    expect(a.hashes.length).toBe(60 * 8);
  });

  it('matches a freshly stepped world tick-for-tick', () => {
    const seed = 42;
    const inputs = makeInputLog(99, 300);
    const replay: Replay = { seed, inputs };
    const { hashes } = runReplay(replay);

    // Independently re-run with the low-level stepWorld loop.
    const state = createWorld(seed);
    const manual: number[] = [];
    for (const input of inputs) {
      stepWorld(state, input);
      manual.push(hashWorld(state));
    }
    expect(manual).toEqual(hashes);
  });

  it('diverges for different seeds', () => {
    const inputs = idleInputs(120);
    const a = runReplay({ seed: 1, inputs });
    const b = runReplay({ seed: 2, inputs });
    expect(a.finalHash).not.toBe(b.finalHash);
  });

  it('diverges for different input logs on the same seed', () => {
    const a = runReplay({ seed: 5, inputs: makeInputLog(1, 120) });
    const b = runReplay({ seed: 5, inputs: makeInputLog(2, 120) });
    expect(a.finalHash).not.toBe(b.finalHash);
  });

  it('actually evolves state over time (entities move)', () => {
    const inputs = idleInputs(120);
    const { hashes } = runReplay({ seed: 7, inputs });
    // Consecutive ticks should generally differ (dummies wander even when idle).
    const distinct = new Set(hashes);
    expect(distinct.size).toBeGreaterThan(100);
  });

  it('player dash moves the player further than a plain step', () => {
    const dashLog: InputFrame[] = [
      { moveX: 1, moveY: 0, aim: 0, dash: true, special: 0 },
    ];
    const walkLog: InputFrame[] = [
      { moveX: 1, moveY: 0, aim: 0, dash: false, special: 0 },
    ];
    const dashed = runReplay({ seed: 3, inputs: dashLog }).finalState.entities[0];
    const walked = runReplay({ seed: 3, inputs: walkLog }).finalState.entities[0];
    expect(dashed).toBeDefined();
    expect(walked).toBeDefined();
    expect(dashed!.x).toBeGreaterThan(walked!.x);
  });

  it('exposes the expected tick rate', () => {
    expect(TICK_RATE).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// M8 — `WorldConfig.shipType` 조건부 꼬리 폴드 + 시그니처의 **정규 경로** 배선.
//
// 설계서 §5(다섯 겹 방어)와 §10-1·§10-2 가 예측한 결함을 겨눈다:
//   · 타입 0(미지정 포함)에서 폴드가 한 번이라도 실행되면 기존 fixtures·W0 골든이 통째로
//     깨진다 → 첫 두 케이스가 "바이트 불변"을 직접 확인한다.
//   · 타입이 저장은 되는데 `WorldConfig` 에 도달하지 못하면 패시브가 영구 미발동인데
//     단위 테스트는 전부 그린이다 → 마지막 describe 가 Profile 에서 출발해 실제로 돌린다.
// ---------------------------------------------------------------------------

/** shipType 만 다른 config 두 벌로 per-tick 해시 스트림을 뽑는다. */
function shipTypeHashes(shipType: number | undefined, ticks = 240): number[] {
  const config: WorldConfig = { ...DEFAULT_CONFIG };
  if (shipType !== undefined) config.shipType = shipType;
  const state = createWorld(0x5417, config);
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, emptyInput());
    out.push(hashWorld(state));
  }
  return out;
}

describe('M8 기체 타입 해시 꼬리 폴드 (설계서 §4·§5)', () => {
  it('shipType 미지정과 0 명시가 per-tick 해시 배열 전체에서 동일하다 (스트라이커 불변)', () => {
    expect(shipTypeHashes(0)).toEqual(shipTypeHashes(undefined));
  });

  it('shipType 1·2·3·4 는 서로도, 스트라이커와도 해시가 갈린다', () => {
    const striker = shipTypeHashes(undefined, 60).at(-1);
    const seen = new Map<number, number | undefined>([[0, striker]]);
    for (const t of [1, 2, 3, 4]) {
      const h = shipTypeHashes(t, 60).at(-1);
      for (const [other, oh] of seen) {
        expect(h, `shipType ${t} vs ${other}`).not.toBe(oh);
      }
      seen.set(t, h);
    }
  });

  it('꼬리 폴드가 침공 블록 **바깥**이다 — PvE(invasion3 없음) 런에서도 타입이 봉인된다', () => {
    // 폴드를 invasion3 if-블록 안에 넣으면 이 케이스가 통과하지 못한다(PvE 는 그 블록을
    // 통째로 건너뛰므로 타입이 해시에 전혀 들어가지 않는다).
    const pve: WorldConfig = { ...DEFAULT_CONFIG };
    expect(pve.invasion3).toBeUndefined();
    const a = createWorld(11, pve);
    const b = createWorld(11, { ...pve, shipType: 1 });
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});

// ---------------------------------------------------------------------------
// 정규 경로 통합 — 모듈 직접 호출이 아니라 Profile 에서 출발한다.
//
// ⚠️ M8-L7 이 `buildRunConfig(profile)` 를 추출하면 아래 `assembleRunConfigLikeMain` 을
// 삭제하고 그 함수를 직접 호출하도록 바꿀 것. 그리고 **`shipType: ship.typeId` 한 줄을
// src/main.ts 의 조립 3곳(:706·:772·:930)에 반드시 넣어야 한다** — 현재 main.ts 는 그 필드를
// 세우지 않으므로, L7 전까지 실앱은 여전히 스트라이커로 달린다(설계서 §10-2).
// ---------------------------------------------------------------------------

// ✅ M8-L7 완료: 조립을 재현하지 않고 실제 앱(`src/main.ts`)이 부르는 `buildRunConfig` 를
// 그대로 호출한다. `playerHp` 만 테스트가 덮는데, 그것은 프로필 파생값이 아니라 무대 상수다.
function assembleRunConfigLikeMain(profile: Profile, playerHp: number): WorldConfig {
  return { ...buildRunConfig(profile, { planet: 0, stage: 1 }), playerHp };
}

/** 피격을 실제로 겪게 하려면 오래 살아야 한다 — 골든 하네스와 같은 관례. */
const DURABLE_HP = 100_000_000;

interface RunProbe {
  /** 런 전체에서 실제로 깎인 HP 총량(장갑 감소가 관측되는 자리). */
  hpLost: number;
  /** 관측된 최대 aux0 — 브루저는 장갑 스택, 아크캐스터는 정지 틱. */
  maxAux0: number;
  /**
   * 이번 런에서 관측된 아군 탄의 **최대 피해 배율**(`e.damage / weapon.damage`). 과충전이
   * 실제 발사에 반영되는지를 처치 수 같은 노이즈 없이 직접 본다 — 미보유면 정확히 0.
   */
  maxBulletAmp: number;
}

/**
 * 레벨업 프리즈를 자동으로 소화하며 런을 진행시킨다. 이것이 없으면 첫 레벨업에서 sim 이
 * 멈춰(`pendingLevelUp`) 런이 2분 내내 정지하고, 피격도 발사도 더 이상 일어나지 않는다.
 *
 * `starveMarksmanTrigger`: 스트라이커 **대조군** 전용(2026-08-06) — ADR-0049 로 스트라이커도
 * 시그니처(정조준 사이클, aux0)를 갖게 되어 "시그니처 없음" 대조군이 사라졌다
 * (`tests/shipSignatureWiring.test.ts` `starveTrigger` 헤더 주석 참조). 기체를 바꾸지 않고
 * (바꾸면 baseBp 까지 갈려 오염이 더 커진다) **스트라이커의 aux0 트리거만 매 틱 굶겨** 정조준이
 * 영영 발동하지 않게 한다 — 「트리거 굶기기」 패턴. `marksmanTriggered` 는 `aux0` 를 매 틱 진입
 * 직전에 읽으므로, 매 스텝 앞에서 0 으로 되돌리면 그 판정은 항상 0(<11)을 보고 절대 트리거되지
 * 않는다. maxAux0/maxBulletAmp 갱신도 굶기는 동안은 건너뛴다 — 이번 틱 발사분이 잠깐
 * aux0=1 을 만들어도(되돌리기 전 시점) 그 값은 "굶긴 대조군의 관측"이 아니라 우리가 만든
 * 잡음이라 반영하지 않는다.
 */
function probeRun(
  seed: number,
  config: WorldConfig,
  ticks: number,
  starveMarksmanTrigger = false,
): RunProbe {
  const state = createWorld(seed, config);
  const player = state.entities[0] as Entity;
  const startHp = player.hp;
  let maxAux0 = 0;
  let maxBulletAmp = 0;
  for (let i = 0; i < ticks; i++) {
    if (starveMarksmanTrigger) player.aux0 = 0;
    const frame = emptyInput();
    if (state.pendingLevelUp) frame.special = SPECIAL_POWERUP_PICK;
    stepWorld(state, frame);
    if (!starveMarksmanTrigger && player.aux0 > maxAux0) maxAux0 = player.aux0;
    for (const e of state.entities) {
      if (e.kind !== 'bullet') continue;
      const ratio = e.damage / state.weapon.damage;
      if (ratio > 1 + 1e-9 && ratio > maxBulletAmp) maxBulletAmp = ratio;
    }
  }
  return { hpLost: startHp - player.hp, maxAux0, maxBulletAmp };
}

/** 런이 실제로 굴러가려면 충분히 길어야 한다(피격 다수 + 과충전 진입 다수). */
const PROBE_TICKS = 7200;
const PROBE_SEED = 0xa2c;

describe('M8 정규 경로 통합 — Profile{typeId} → 런 설정 → createWorld/stepWorld (설계서 §10-1·§10-2)', () => {
  it('Profile 의 typeId 가 WorldConfig.shipType 까지 실제로 도달한다', () => {
    const profile = defaultProfile();
    activeShip(profile).typeId = 1;
    const config = assembleRunConfigLikeMain(profile, DURABLE_HP);
    expect(config.shipType).toBe(1);
    // 스트라이커 프로필은 미지정이 아니라 0 이다. `shipType` 해시 꼬리 폴드는 지금도 0 에서
    // 무실행이지만(replay.ts, 설계서 §5), ADR-0049 이후 `uniqueMask` 자체는 무연산이 아니다 —
    // 스트라이커도 자기 시그니처 비트(24, 정조준 사이클)를 켠다.
    expect(assembleRunConfigLikeMain(defaultProfile(), DURABLE_HP).shipType).toBe(0);
  });

  it('브루저(typeId 1) 런은 장갑 스택이 실제로 쌓이고 받은 피해가 줄어든다', () => {
    const striker = defaultProfile();
    const bruiser = defaultProfile();
    activeShip(bruiser).typeId = 1;

    // ⚠️ 2026-08-06 — 대조군(스트라이커)은 더 이상 "시그니처 없음"이 아니다(ADR-0049, 정조준
    // 사이클이 aux0 0..11 을 돈다). 기체를 바꾸지 않고 트리거만 굶긴다(probeRun 헤더 주석 —
    // 「트리거 굶기기」 패턴, `shipSignatureWiring.test.ts` 선례).
    const a = probeRun(
      PROBE_SEED,
      assembleRunConfigLikeMain(striker, DURABLE_HP),
      PROBE_TICKS,
      true,
    );
    const b = probeRun(PROBE_SEED, assembleRunConfigLikeMain(bruiser, DURABLE_HP), PROBE_TICKS);

    // ① 정조준 트리거를 굶긴 스트라이커는 aux0 이 끝까지 0 이다(= 장갑 스택 관측과 안 섞인다).
    expect(a.maxAux0).toBe(0);
    // ② 브루저는 정규 경로만으로 스택이 상한까지 쌓인다(패시브가 실제로 배선돼 있다).
    expect(b.maxAux0).toBeGreaterThan(0);
    expect(b.maxAux0).toBeLessThanOrEqual(ARMOR_MAX_STACKS);
    // ③ 그 스택이 관측 가능한 결과를 바꾼다 — 같은 seed·입력에서 피해를 덜 받는다.
    expect(a.hpLost).toBeGreaterThan(0);
    expect(b.hpLost).toBeLessThan(a.hpLost);
  });

  it('아크캐스터(typeId 2) 런은 정지 과충전이 실제 발사 피해에 반영된다', () => {
    const striker = defaultProfile();
    const arc = defaultProfile();
    activeShip(arc).typeId = 2;

    // ⚠️ 위 브루저 케이스와 같은 이유로 대조군(스트라이커)의 정조준 트리거를 굶긴다 — 굶기지
    // 않으면 정조준 볼리(+50%)가 maxBulletAmp 를 1.5 로 밀어 올려 "증폭 무실행" 기준선이 깨진다.
    const a = probeRun(
      PROBE_SEED,
      assembleRunConfigLikeMain(striker, DURABLE_HP),
      PROBE_TICKS,
      true,
    );
    const b = probeRun(PROBE_SEED, assembleRunConfigLikeMain(arc, DURABLE_HP), PROBE_TICKS);

    // 트리거를 굶긴 스트라이커는 아군 탄이 기본 피해를 절대 넘지 않는다(증폭 경로 무실행).
    expect(a.maxBulletAmp).toBe(0);
    // 아크캐스터는 정지 유지로 상한(OVERCHARGE_MAX_BP = 4000bp = ×1.4)에 근접한다.
    expect(b.maxBulletAmp).toBeGreaterThan(1);
    expect(b.maxAux0).toBeGreaterThanOrEqual(OVERCHARGE_STILL_TICKS);
  });
});
