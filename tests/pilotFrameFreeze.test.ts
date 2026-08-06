/**
 * `autopilotInput` **거동 동결** 골든 (ADR-0049 §0-A 결정 B).
 *
 * ## 왜 이 파일이 있는가
 * 측정 전용 파일럿 프로파일을 신설하면서 두 파일럿이 조용히 갈리지 않도록 **입력 생성 로직을
 * 공유**하기로 했다(`prerequisites.md` §0-A). 공유는 곧 `autopilot.ts` 리팩터이고, 그 파일의
 * 출력 위에는 **벤치·회귀 골든 전부**가 산다 — `tests/fixtures/striker-prem8.json` ·
 * `encounter-baseline.json` · `scripts/deno-verify/fixtures.json` · `bench/**` 전부다.
 *
 * 그 골든들은 `pnpm test:sim` 으로만 돌고 7분 25초가 걸린다. 즉 **편집 중에는 아무도 갈림을
 * 알려 주지 않는다.** 이 파일이 그 자리를 메운다: 오토파일럿이 실제로 뱉는 **입력 프레임 열
 * 자체**를 비트 단위로 접어, 리팩터가 한 프레임이라도 바꾸면 기본 스위트에서 즉시 빨개진다.
 *
 * ## ⚠️ `tsc` 는 이 축을 못 잡는다
 * 이 저장소에는 **위치 인자를 지웠는데 타입이 우연히 맞아 `tsc` 를 통과한** 선례가 있다
 * (`skill-rebuild-commit2.md` 「구현하며 드러난 것」 1번 — `computeLoadoutStats` 의 가운데
 * 인자). "컴파일되니까 같다"는 근거가 아니다.
 *
 * ## ⚠️ 기대값을 다시 뜨지 마라
 * 아래 상수는 **리팩터 이전**(main `bed3cb8`)에서 뜬 값이다. 여기가 빨개졌다는 것은
 * "골든을 갱신할 때가 됐다"가 아니라 **오토파일럿 거동이 실제로 바뀌었다**는 뜻이고, 그것은
 * 결정 B 위반이다(기존 오토파일럿은 동결이 계약이다). 다시 뜬 골든으로 그 골든을 검사하면
 * 항진이다 — 같은 함정을 이 리포가 이미 두 번 적어 뒀다.
 *
 * ## 무엇을 접는가
 * 매 틱 `autopilotInput(state)` 가 낸 프레임의 5필드를 **float64 비트 그대로** 접는다
 * (`moveX`·`moveY`·`aim` 은 8바이트, `dash` 는 0/1, `special` 은 u32). 마지막에 **소요 틱 수**도
 * 접는다 — 런이 짧아지거나 길어지는 변화도 갈림으로 잡기 위해서다.
 *
 * `-0` 과 `0` 은 `setFloat64` 가 구분한다(의도적으로 더 엄격하다).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { standardEquipped, standardPerTree, standardStage, investVector } from '../src/bench/standardBuild.js';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const scratch = new DataView(new ArrayBuffer(8));

function foldF64(h: number, v: number): number {
  scratch.setFloat64(0, v);
  let out = h;
  for (let i = 0; i < 8; i++) out = Math.imul(out ^ scratch.getUint8(i), FNV_PRIME) >>> 0;
  return out;
}

function foldU32(h: number, v: number): number {
  let out = h;
  for (let i = 0; i < 4; i++) out = Math.imul(out ^ ((v >>> (i * 8)) & 0xff), FNV_PRIME) >>> 0;
  return out;
}

/** 행성 6종 전부(뱀서류·블록격파·레이싱·추격·수축·오염) — 모드 분기를 전수로 태운다. */
const PLANETS = [0, 1, 2, 3, 4, 5] as const;
/** 시드 3개. 장비 롤·웨이브 추첨이 갈리므로 서로 다른 분기 조합을 밟는다. */
const SEEDS = [1, 4242, 90210] as const;
/** 런당 최대 틱. 수천 틱이면 회피·전리품·카이팅·레벨업 프리즈가 전부 나온다. */
const MAX_TICKS = 3000;
const LEVEL = 40;

/**
 * 한 (행성, 시드) 런의 **입력 프레임 열 해시**. 결정론이므로 같은 입력이면 항상 같은 값이다.
 *
 * 기체는 행성·시드로 파생해 7종이 고루 섞이게 한다 — 무기 사거리가 갈리면 카이팅 분기의
 * 밟는 지점도 갈린다.
 */
function frameStreamHash(planet: number, seed: number, shipTypeId: number): number {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = shipTypeId;
  ship.level = LEVEL;
  ship.skillInvest = investVector(shipTypeId, standardPerTree(LEVEL));
  ship.equipped = standardEquipped(LEVEL, seed, planet);
  const config = buildRunConfig(profile, { planet, stage: standardStage(LEVEL) });

  const state = createWorld(seed, config);
  let h = FNV_OFFSET;
  let ticks = 0;
  for (let i = 0; i < MAX_TICKS; i++) {
    const f = autopilotInput(state);
    h = foldF64(h, f.moveX);
    h = foldF64(h, f.moveY);
    h = foldF64(h, f.aim);
    h = foldU32(h, f.dash ? 1 : 0);
    h = foldU32(h, f.special >>> 0);
    stepWorld(state, f);
    ticks++;
    if (state.victory || state.gameOver) break;
  }
  // 런 길이도 접는다 — 프레임이 같아도 런이 일찍 끝나면 그것도 갈림이다.
  return foldU32(h, ticks);
}

function keyOf(planet: number, seed: number): string {
  return `p${planet}s${seed}`;
}

/**
 * **리팩터 이전(main `bed3cb8`)에 실측한 값**. 위 ⚠️ 절을 읽지 않고 갱신하지 마라.
 */
const EXPECTED: Readonly<Record<string, number>> = {
  p0s1: 444736789,
  p0s4242: 3681804744,
  p0s90210: 2462308341,
  p1s1: 886441892,
  p1s4242: 2626187176,
  p1s90210: 4255032204,
  p2s1: 1849874522,
  p2s4242: 757372333,
  p2s90210: 3226533435,
  p3s1: 3367512787,
  p3s4242: 3770969838,
  p3s90210: 431891899,
  p4s1: 363988900,
  p4s4242: 2988652253,
  p4s90210: 2797028908,
  p5s1: 97381921,
  p5s4242: 2459267831,
  p5s90210: 2315352542,
};

describe('autopilotInput 거동 동결 — 입력 프레임 열 골든', () => {
  it('행성 6종 × 시드 3개의 프레임 열이 동결값과 바이트 단위로 같다', () => {
    const actual: Record<string, number> = {};
    for (const planet of PLANETS) {
      for (const seed of SEEDS) {
        const shipTypeId = (planet + (seed % 7)) % 7;
        actual[keyOf(planet, seed)] = frameStreamHash(planet, seed, shipTypeId);
      }
    }
    expect(actual).toEqual(EXPECTED);
  });

  it('같은 입력을 두 번 접으면 같다 (계측기가 상태를 흘리지 않는다)', () => {
    expect(frameStreamHash(0, 1, 0)).toBe(frameStreamHash(0, 1, 0));
  });

  it('⚠️ 공허 방어 — 실제로 수백 틱 이상 굴렸고 프레임이 한 종류가 아니다', () => {
    const profile = defaultProfile();
    const ship = activeShip(profile);
    ship.typeId = 0;
    ship.level = LEVEL;
    ship.skillInvest = investVector(0, standardPerTree(LEVEL));
    ship.equipped = standardEquipped(LEVEL, 1, 0);
    const state = createWorld(1, buildRunConfig(profile, { planet: 0, stage: standardStage(LEVEL) }));
    const seen = new Set<string>();
    let ticks = 0;
    for (let i = 0; i < MAX_TICKS; i++) {
      const f = autopilotInput(state);
      seen.add(`${f.moveX},${f.moveY},${f.aim},${f.dash},${f.special}`);
      stepWorld(state, f);
      ticks++;
      if (state.victory || state.gameOver) break;
    }
    // 런이 조기에 끝나면 골든이 "아무것도 안 잰 0" 이 된다 — 그 상태를 명시적으로 막는다.
    expect(ticks).toBeGreaterThan(300);
    expect(seen.size).toBeGreaterThan(50);
  });

  it('오토파일럿은 대시도 액티브도 누르지 않는다 (결정 B 의 "동결" 대상 그 자체)', () => {
    const profile = defaultProfile();
    const ship = activeShip(profile);
    ship.typeId = 0;
    ship.level = LEVEL;
    ship.skillInvest = investVector(0, standardPerTree(LEVEL));
    ship.equipped = standardEquipped(LEVEL, 7, 0);
    const state = createWorld(7, buildRunConfig(profile, { planet: 0, stage: standardStage(LEVEL) }));
    let dashes = 0;
    let actives = 0;
    for (let i = 0; i < 1200; i++) {
      const f = autopilotInput(state);
      if (f.dash) dashes++;
      // 비트 9·10 = 액티브 슬롯 1·2(`data/inputBits.ts`).
      if ((f.special & ((1 << 9) | (1 << 10))) !== 0) actives++;
      stepWorld(state, f);
      if (state.victory || state.gameOver) break;
    }
    expect(dashes).toBe(0);
    expect(actives).toBe(0);
  });
});
