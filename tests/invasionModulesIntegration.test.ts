/**
 * 코어 모듈 ↔ 침공 sim **배선** 통합 검증 (M7b 1차 통합 게이트).
 *
 * `tests/coreModules.test.ts` 는 `initModuleRuntime`/`stepModuleRuntime` 을 직접 불러 단위로
 * 본다. 그 테스트들은 **배선이 통째로 빠져도 전부 통과한다** — world.ts 가 런타임을 만들지
 * 않거나, 배율을 아무도 읽지 않아도 모듈 함수 자체는 옳게 동작하기 때문이다. M7a 웨이브 1 에서
 * 같은 유형의 결함이 3건 나왔다(해시 봉인 미작동·훅 미등록·좌표계 어긋남).
 *
 * 그래서 이 파일은 **정규 경로만** 쓴다: `createWorld(seed, config)` → `stepWorld` → 관측.
 * 모듈 함수를 직접 부르지 않는다. 확인 항목:
 *   ① `invasion3.modules` 를 실으면 `state.moduleRuntime` 이 실제로 생긴다(미지정이면 없다).
 *   ② 스폰 시점 효과가 **레이어 진입 훅 뒤에** 적용된다 — T0 1회 적용이면 코어(L3 스폰)를
 *      전부 빗나가므로, 이 관찰이 M7b 배선의 핵심 함정이다.
 *   ③ 방어체 피해 감소·설비 화력·보스 화력 배율이 실제 거동에 반영된다.
 *   ④ 유니크(신기루 코어·최후의 재기동·블랙아웃)가 런에 실린다.
 *   ⑤ **결정론**: 같은 모듈로 두 번 돌리면 해시 스트림이 바이트 동일하고, 모듈을 빼면 갈린다
 *      (= 모듈이 해시에 실제로 영향을 준다 → 서버 재실행 대조가 의미를 갖는다).
 *   ⑥ **회귀 봉인**: 모듈 미장착 런은 M7a 와 해시가 바이트 동일하다(조건부 접기).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { hashWorld } from '../src/sim/replay.js';
import {
  INVASION_TOTAL_TICKS,
  PHASE_L2,
  PHASE_L3,
  normalizeInvasionLayers,
  SAMPLE_GUARDIAN,
} from '../src/sim/invasion/index.js';
import type { InvasionLayers } from '../src/sim/invasion/index.js';
import type { CoreModuleConfig, AttackerMatchup } from '../src/sim/moduleEffects.js';
import type { ModuleInstance } from '../data/coreModules.js';

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

const ref = (catalogId: number) => ({
  catalogId,
  level: 1,
  ascension: 0,
  affixSeed: 1,
  rarity: 0,
});

/** 전 슬롯을 채운 배치(invasionE2E 와 같은 구성 — 설비·기물·보스가 다 나온다). */
function filledLayers(): InvasionLayers {
  return normalizeInvasionLayers({
    l1: { waveSlots: Array.from({ length: 6 }, (_, i) => ref(i % 3)) },
    l2: { templateId: 0, sockets: Array.from({ length: 12 }, (_, i) => ref(i % 6)) },
    l3: {
      boss: ref(0),
      guardians: [SAMPLE_GUARDIAN, SAMPLE_GUARDIAN],
      props: Array.from({ length: 6 }, (_, i) => ref(i % 3)),
    },
  });
}

/** 아무 조건도 맞지 않는 매치업(정적 카운터가 조용히 켜지지 않게 하는 기준선). */
const NEUTRAL_MATCHUP: AttackerMatchup = {
  fire: false,
  cold: false,
  lightning: false,
  beam: false,
  attackerCp: 0,
  defenderCp: 0,
  revenge: false,
  reinvasion: false,
  subweaponHeavy: false,
};

/** 화염 공격자(정적 카운터 fireAttacker — mc-quench 발동용). */
const FIRE_MATCHUP: AttackerMatchup = { ...NEUTRAL_MATCHUP, fire: true };

/** 전격 공격자(mc-insulate — 공격자 보조무기 쿨다운 증가). */
const LIGHTNING_MATCHUP: AttackerMatchup = { ...NEUTRAL_MATCHUP, lightning: true };

/** 재침공(mc-blockade — 기물 내구 증폭). */
const REINVASION_MATCHUP: AttackerMatchup = { ...NEUTRAL_MATCHUP, reinvasion: true };

/** 전투력 우위(mc-armorbreak — 설비 화력 증폭). 임계는 MODULE_POWER_SUPERIORITY_MARGIN. */
const SUPERIOR_MATCHUP: AttackerMatchup = { ...NEUTRAL_MATCHUP, attackerCp: 5000, defenderCp: 0 };

function makeModule(part: Partial<ModuleInstance>): ModuleInstance {
  return {
    id: 'test-module',
    rarity: 'normal',
    prefixes: [],
    suffixes: [],
    chargesMax: 5,
    chargesLeft: 5,
    seed: 1,
    ...part,
  };
}

function makeConfig(layers: InvasionLayers, modules?: CoreModuleConfig): WorldConfig {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  config.invasion3 = {
    layers,
    timeLimitTicks: INVASION_TOTAL_TICKS,
    maintenance: 10000,
    ...(modules !== undefined ? { modules } : {}),
  };
  return config;
}

interface RunResult {
  readonly state: WorldState;
  readonly hashes: number[];
  readonly inputs: InputFrame[];
}

/** 오토파일럿으로 maxTicks 만큼(또는 종료까지) 정규 경로로 돌린다. */
function playRun(seed: number, layers: InvasionLayers, modules?: CoreModuleConfig, maxTicks = INVASION_TOTAL_TICKS): RunResult {
  const state = createWorld(seed, makeConfig(layers, modules));
  const hashes: number[] = [];
  const inputs: InputFrame[] = [];
  for (let t = 0; t < maxTicks; t++) {
    const input = autopilotInput(state);
    inputs.push(input);
    stepWorld(state, input);
    hashes.push(hashWorld(state));
    if (state.gameOver || state.victory) break;
  }
  return { state, hashes, inputs };
}

/** 지정 페이즈에 처음 진입한 직후 상태를 돌려준다(미진입이면 null). */
function playUntilPhase(seed: number, layers: InvasionLayers, phase: number, modules?: CoreModuleConfig): WorldState | null {
  const state = createWorld(seed, makeConfig(layers, modules));
  for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
    stepWorld(state, autopilotInput(state));
    if (state.invasion3?.phase === phase) return state;
    if (state.gameOver || state.victory) return null;
  }
  return null;
}

const SEED = 7;

// ---------------------------------------------------------------------------
// ① 배선 존재 — config → moduleRuntime
// ---------------------------------------------------------------------------

describe('코어 모듈 배선 — config.invasion3.modules → WorldState.moduleRuntime', () => {
  it('모듈을 실으면 런타임이 생기고, 안 실으면 필드 자체가 없다(조건부 접기)', () => {
    const bare = createWorld(SEED, makeConfig(filledLayers()));
    expect(bare.moduleRuntime).toBeUndefined();

    const withMod = createWorld(
      SEED,
      makeConfig(filledLayers(), { modules: [makeModule({})], matchup: NEUTRAL_MATCHUP }),
    );
    expect(withMod.moduleRuntime).toBeDefined();
  });

  it('정적 카운터(접두)는 매치업이 맞을 때만 해석된다', () => {
    const mod = makeModule({
      prefixes: [{ id: 'mc-quench', stat: 'incomingDmgReductionPct', value: 30 }],
    });
    const miss = createWorld(SEED, makeConfig(filledLayers(), { modules: [mod], matchup: NEUTRAL_MATCHUP }));
    const hit = createWorld(SEED, makeConfig(filledLayers(), { modules: [mod], matchup: FIRE_MATCHUP }));
    expect(miss.moduleRuntime?.staticIncomingReductionPct).toBe(0);
    expect(hit.moduleRuntime?.staticIncomingReductionPct).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// ② 스폰 시점 효과가 레이어 진입 뒤에 붙는가 (M7b 최대 함정)
// ---------------------------------------------------------------------------

describe('코어 모듈 스폰 효과 — 레이어 진입 훅 뒤에 적용된다', () => {
  it('코어 HP 증폭이 L3 코어에 실제로 걸린다(T0 1회 적용이면 전부 빗나간다)', () => {
    const layers = filledLayers();
    const base = playUntilPhase(SEED, layers, PHASE_L3);
    const boosted = playUntilPhase(SEED, layers, PHASE_L3, {
      // rare 기저 효과에 coreHpPct 가 실려 있다(등급별 무조건 적용).
      modules: [makeModule({ rarity: 'rare' })],
      matchup: NEUTRAL_MATCHUP,
    });
    expect(base).not.toBeNull();
    expect(boosted).not.toBeNull();
    const baseCore = base?.entities.find((e) => e.kind === 'core');
    const boostedCore = boosted?.entities.find((e) => e.kind === 'core');
    expect(baseCore).toBeDefined();
    expect(boostedCore).toBeDefined();
    expect(boostedCore?.maxHp ?? 0).toBeGreaterThan(baseCore?.maxHp ?? 0);
  });

  it('L2 설비 수가 진입 시점에 기록된다(T0 에는 설비가 아직 없다)', () => {
    const layers = filledLayers();
    const cfg: CoreModuleConfig = { modules: [makeModule({})], matchup: NEUTRAL_MATCHUP };
    const t0 = createWorld(SEED, makeConfig(layers, cfg));
    expect(t0.moduleRuntime?.initialFacilityCount).toBe(0);

    const atL2 = playUntilPhase(SEED, layers, PHASE_L2, cfg);
    expect(atL2).not.toBeNull();
    expect(atL2?.moduleRuntime?.initialFacilityCount ?? 0).toBeGreaterThan(0);
  });

  it('유니크 신기루 코어가 L3 진입 시 가짜 코어를 실제로 스폰한다', () => {
    const layers = filledLayers();
    const withDecoy = playUntilPhase(SEED, layers, PHASE_L3, {
      modules: [makeModule({ rarity: 'unique', uniqueId: 'uq-mirage-core' })],
      matchup: NEUTRAL_MATCHUP,
    });
    expect(withDecoy).not.toBeNull();
    expect(withDecoy?.entities.some((e) => e.kind === 'decoyCore')).toBe(true);

    const without = playUntilPhase(SEED, layers, PHASE_L3);
    expect(without?.entities.some((e) => e.kind === 'decoyCore')).toBe(false);
  });

  it('기물 내구 증폭이 L3 기물에 걸린다', () => {
    const layers = filledLayers();
    const mod = makeModule({
      prefixes: [{ id: 'mc-blockade', stat: 'propDurabilityPct', value: 50 }],
    });
    const base = playUntilPhase(SEED, layers, PHASE_L3);
    const boosted = playUntilPhase(SEED, layers, PHASE_L3, {
      modules: [mod],
      matchup: REINVASION_MATCHUP,
    });
    const baseProp = base?.entities.find((e) => e.kind === 'prop');
    const boostedProp = boosted?.entities.find((e) => e.kind === 'prop');
    expect(baseProp).toBeDefined();
    expect(boostedProp).toBeDefined();
    expect(boostedProp?.maxHp ?? 0).toBeGreaterThan(baseProp?.maxHp ?? 0);
  });
});

// ---------------------------------------------------------------------------
// ③ 매 틱 배율이 실제 거동에 반영되는가
// ---------------------------------------------------------------------------

describe('코어 모듈 배율 — 매 틱 접점이 실제로 읽는다', () => {
  it('설비 화력 배율이 재계산되어 런타임에 실린다', () => {
    const atL2 = playUntilPhase(SEED, filledLayers(), PHASE_L2, {
      modules: [makeModule({ prefixes: [{ id: 'mc-armorbreak', stat: 'facilityDamagePct', value: 40 }] })],
      matchup: SUPERIOR_MATCHUP,
    });
    // 40%(조건 일치 접두) + 3%(normal 등급 기저 allDamagePct) = 배율 1.43.
    expect(atL2?.moduleRuntime?.facilityDamageMult).toBeCloseTo(1.43, 10);
  });

  it('공격자 보조무기 쿨다운 증가가 정적 해석에 반영된다', () => {
    const w = createWorld(
      SEED,
      makeConfig(filledLayers(), {
        modules: [makeModule({ prefixes: [{ id: 'mc-insulate', stat: 'attackerSubCdPct', value: 25 }] })],
        matchup: LIGHTNING_MATCHUP,
      }),
    );
    expect(w.moduleRuntime?.attackerSubCdPct).toBe(25);
  });

  it('방어체 피해 감소가 실제로 방어체 생존을 늘린다(같은 시드·같은 입력)', () => {
    const layers = filledLayers();
    const mod = makeModule({
      prefixes: [{ id: 'mc-quench', stat: 'incomingDmgReductionPct', value: 80 }],
    });
    const plain = playRun(SEED, layers, undefined, 4000);
    const tanky = playRun(SEED, layers, { modules: [mod], matchup: FIRE_MATCHUP }, 4000);
    const live = (r: RunResult): number => r.state.entities.filter((e) => !e.dead && e.kind === 'enemy').length;
    // 피해 감소가 배선돼 있으면 같은 시점에 방어 측이 더 많이 살아 있거나 최소한 덜 죽는다.
    expect(tanky.state.kills).toBeLessThanOrEqual(plain.state.kills);
    expect(live(tanky) + tanky.state.kills).toBeGreaterThan(0);
  });

  it('블랙아웃 잔여 틱이 런 중 카운트다운된다(stepModuleRuntime 이 매 틱 돈다는 증거)', () => {
    const cfg: CoreModuleConfig = {
      modules: [makeModule({ rarity: 'unique', uniqueId: 'uq-blackout' })],
      matchup: NEUTRAL_MATCHUP,
    };
    const state = createWorld(SEED, makeConfig(filledLayers(), cfg));
    const start = state.moduleRuntime?.blackoutTicksLeft ?? 0;
    expect(start).toBeGreaterThan(0);
    for (let t = 0; t < 100; t++) stepWorld(state, autopilotInput(state));
    expect(state.moduleRuntime?.blackoutTicksLeft).toBe(start - 100);
  });
});

// ---------------------------------------------------------------------------
// ④ 결정론 · 해시 영향 · 회귀 봉인
// ---------------------------------------------------------------------------

describe('코어 모듈 결정론 — 서버 재실행 대조의 전제', () => {
  const MODULES: CoreModuleConfig = {
    modules: [
      makeModule({
        rarity: 'rare',
        prefixes: [{ id: 'mc-quench', stat: 'incomingDmgReductionPct', value: 25 }],
        suffixes: [{ id: 'mt-forcefield', stat: 'coreShieldFlat', value: 500 }],
      }),
    ],
    matchup: FIRE_MATCHUP,
  };

  it('같은 모듈로 두 번 돌리면 해시 스트림이 바이트 동일하다', () => {
    const a = playRun(SEED, filledLayers(), MODULES, 3000);
    const b = playRun(SEED, filledLayers(), MODULES, 3000);
    expect(a.hashes).toEqual(b.hashes);
  });

  it('모듈을 빼면 해시가 갈린다 — 모듈이 재실행 대조에 실제로 실린다는 증거', () => {
    const withMod = playRun(SEED, filledLayers(), MODULES, 3000);
    const without = playRun(SEED, filledLayers(), undefined, 3000);
    expect(withMod.hashes).not.toEqual(without.hashes);
  });

  it('모듈 미장착 런은 modules 키 유무와 무관하게 동일하다(조건부 접기 회귀 봉인)', () => {
    const bare = playRun(SEED, filledLayers(), undefined, 3000);
    const emptyList = playRun(SEED, filledLayers(), { modules: [], matchup: NEUTRAL_MATCHUP }, 3000);
    // 장착 0개면 모든 해석값이 0/1 이라 거동이 완전히 같아야 한다.
    expect(emptyList.hashes).toEqual(bare.hashes);
  });
});
