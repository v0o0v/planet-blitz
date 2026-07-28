/**
 * 리플레이 config 별칭 결함 (2026-07-29 하네스 리플레이 도구로 실측 발견).
 *
 * ## 결함
 * `createWorld` 는 받은 config 를 **얕게 복사한 뒤 그 사본에 로드아웃·촉매 파생을 적용해서**
 * `state.config` 로 삼는다(`src/sim/world.ts` — `const cfg = { ...config }` → `cfg.playerSpeed =
 * Math.round(cfg.playerSpeed * lo.moveSpeedMult)` 등). 런 중에는 파워업이 같은 사본을 또 바꾼다
 * (`src/sim/powerups.ts` 이동 속도 +12% / +10%).
 *
 * `main.ts` 는 예전에 `new ReplayRecorder(seed, world.config)` 로 **그 파생된 사본**을 리플레이에
 * 실었다. 그래서 리플레이를 재실행하면 파생이 **두 번** 적용되고, 파워업으로 오른 속도를 시작값
 * 으로 물고 출발한다 — 제출된 리플레이가 실제로 플레이한 런이 아니게 된다.
 *
 * ## 왜 지금까지 안 드러났나
 * 로드아웃 배율이 전부 1 이고 파워업을 안 먹은 런에서는 원본과 파생본이 같은 값이라 두 경로가
 * 일치한다. 골든 픽스처는 리플레이를 직접 조립해 `DEFAULT_CONFIG` 를 쓰므로 이 축을 밟지 않는다.
 *
 * ## 무게
 * `src/net/invasion.ts` `buildClientResult(replay)` 도 서버 `verify-invasion` 도 **제출된 리플레이를
 * 다시 돌려** 승패·해시 스트림을 만든다. 즉 클라와 서버는 서로 일치하지만 둘 다 실제 플레이가
 * 아닌 런을 판정한다(강화가 겹쳐 공격자에게 유리한 방향).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, DEFAULT_CONFIG, emptyInput, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { ReplayRecorder, hashWorld, runReplay } from '../src/sim/replay.js';

/** 이동 속도 배율이 1 이 아닌 로드아웃(파생이 실제로 일어나는 최소 조건). */
function configWithLoadout(): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    loadout: {
      weaponType: 0,
      subWeaponType: -1,
      damageMult: 1,
      fireRateMult: 1,
      bulletCountAdd: 0,
      pierceAdd: 0,
      bulletSpeedMult: 1,
      spreadAdd: 0,
      rangeAdd: 0,
      moveSpeedMult: 1.2, // ← 이 한 축만 1 이 아니어도 결함이 드러난다
      maxHpAdd: 0,
      dashCdMult: 1,
      magnetMult: 1,
      xpMult: 1,
      uniqueMask: 0,
      fireDmg: 0,
      coldSlow: 0,
      lightning: 0,
    },
  };
}

/** 살짝 움직이는 입력(파생 차이가 상태로 번지도록). */
function movingInput(): InputFrame {
  return { ...emptyInput(), moveX: 1, moveY: 0 };
}

describe('createWorld 는 config 를 파생해 사본으로 들고 있다', () => {
  it('world.config 는 넘긴 config 와 다른 객체이고 playerSpeed 가 파생돼 있다', () => {
    const config = configWithLoadout();
    const before = config.playerSpeed;
    const world = createWorld(1234, config);

    expect(world.config).not.toBe(config); // 얕은 사본
    expect(config.playerSpeed, '원본은 건드리지 않는다').toBe(before);
    expect(world.config.playerSpeed).toBe(Math.round(before * 1.2));
  });
});

describe('리플레이는 **런 시작 config** 를 실어야 재현된다', () => {
  const TICKS = 90;

  /** 같은 입력으로 라이브 런을 돌리고, 두 가지 config 로 만든 리플레이를 함께 낸다. */
  function runOnce(): { liveHash: number; withOriginal: number; withDerived: number } {
    const config = configWithLoadout();
    const world = createWorld(1234, config);
    const recOriginal = new ReplayRecorder(1234, config);
    const recDerived = new ReplayRecorder(1234, world.config);
    for (let i = 0; i < TICKS; i++) {
      const input = movingInput();
      recOriginal.record(input);
      recDerived.record(input);
      stepWorld(world, input);
    }
    return {
      liveHash: hashWorld(world),
      withOriginal: runReplay(recOriginal.toReplay()).finalHash,
      withDerived: runReplay(recDerived.toReplay()).finalHash,
    };
  }

  it('런 시작 config 를 실으면 재실행이 라이브 런을 정확히 재현한다', () => {
    const r = runOnce();
    expect(r.withOriginal).toBe(r.liveHash);
  });

  it('파생된 world.config 를 실으면 재현되지 않는다 — 이 테스트가 지키는 결함 그 자체', () => {
    const r = runOnce();
    expect(r.withDerived).not.toBe(r.liveHash);
  });

  it('로드아웃이 중립(배율 전부 1)이면 두 경로가 같다 — 결함이 오래 숨어 있던 이유', () => {
    const config: WorldConfig = { ...DEFAULT_CONFIG };
    const world = createWorld(1234, config);
    const recOriginal = new ReplayRecorder(1234, config);
    const recDerived = new ReplayRecorder(1234, world.config);
    for (let i = 0; i < TICKS; i++) {
      const input = movingInput();
      recOriginal.record(input);
      recDerived.record(input);
      stepWorld(world, input);
    }
    const a = runReplay(recOriginal.toReplay()).finalHash;
    const b = runReplay(recDerived.toReplay()).finalHash;
    expect(a).toBe(hashWorld(world));
    expect(b).toBe(a);
  });
});

// ---------------------------------------------------------------------------
// 배선 축 — main.ts 가 실제로 어느 config 를 recorder 에 주는가
// ---------------------------------------------------------------------------

/**
 * `main.ts` 는 import 시 `main()` 을 즉시 실행하는 브라우저 엔트리라 node 에서 로드할 수 없다.
 * 그래서 이 축만 소스 대조다(저장소 기존 패턴: `tests/harnessSettleWiring.test.ts`).
 */
describe('배선 — main.ts 의 recorder 생성', () => {
  const MAIN = new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url))),
  );
  const CODE = MAIN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('세 진입점 모두 recorder 에 world.config 를 주지 않는다', () => {
    const calls = CODE.match(/new ReplayRecorder\([^)]*\)/g) ?? [];
    expect(calls.length, 'recorder 생성 지점은 PvE·정식 침공·하네스 침공 셋이다').toBe(3);
    for (const call of calls) {
      expect(call, `${call} 이 파생된 world.config 를 싣고 있다`).not.toContain('world.config');
    }
  });

  it('recorder 는 createWorld 에 넘긴 것과 같은 config 식별자를 쓴다', () => {
    const calls = CODE.match(/new ReplayRecorder\([^)]*\)/g) ?? [];
    for (const call of calls) {
      expect(call, `${call} 이 config 를 싣지 않는다`).toMatch(/,\s*config\s*\)/);
    }
  });
});
