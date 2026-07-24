/**
 * 조우 프레임워크 + 중반 격전 — **도입 전 기준선(baseline) 녹화기**.
 *
 * ## 왜 필요한가
 * 이 변경은 두 개의 서로 다른 해시 계약을 동시에 건드린다.
 *   - **조우**: `worldRng.fork('encounter')` + 조건부 꼬리 폴드 → 조우 **미발생** 런은
 *     per-tick 해시가 **바이트 불변**이어야 한다(AC1).
 *   - **중반 격전**: `SEGMENTS` 중반 삽입 → PvE 비-invasion baseline 해시는 **바뀐다**(AC3).
 *     그러나 침공은 `updateWaves` 를 실행하지 않으므로(`world.ts` 의 `if (!designedRun)`)
 *     invasion per-tick 해시는 **바이트 불변**이어야 한다(AC2).
 *
 * "구조적으로 그럴 것이다" 는 증명이 아니다. 이 녹화기를 **변경 전 커밋(9301f10)에서
 * 체크아웃한 detached 워크트리**에서 한 번 돌려 기준선을 굳히고, 변경 후 코드가 그 기준선과
 * 바이트로 일치하는지 `tests/encounterHashInvariance.test.ts` 가 대조한다.
 *
 * ## 중반 격전이 PvE 를 바꾸는데 어떻게 AC1 을 증명하나
 * 격전 세그먼트는 **중반(index ≥ 1)** 에만 삽입되므로 세그먼트 0~2 구간의 sim 은 삽입 전과
 * 완전히 동일하다. 그래서 각 런마다 "세그먼트 인덱스가 처음 3 이 된 틱"(`seg3Tick`)을 함께
 * 굳혀 두고, 대조는 `hashes[0 .. seg3Tick)` 구간에서만 한다. 이 구간은 중반 격전과 무관하므로
 * 여기서의 바이트 일치가 곧 **조우 도입이 한 바이트도 새지 않았다** 는 증명이다.
 * (조우가 실제로 발생한 런은 조건부 폴드가 켜져 당연히 갈리므로 대조에서 제외한다 —
 *  제외 판정은 대조 테스트가 `state.encounterRuntime` 존재로 한다.)
 *
 * ## 재생성 (의도적일 때만)
 *   RECORD_ENCOUNTER_BASELINE=1 npx vite-node scripts/recordEncounterBaseline.ts
 * 기본 출력 경로는 `tests/fixtures/encounter-baseline.json` 이고,
 * `ENCOUNTER_BASELINE_OUT` 로 덮어쓸 수 있다(기준선 워크트리에서 스크래치패드로 뽑을 때 사용).
 *
 * ## 이 파일이 절대 하지 않는 것
 * 프로덕션 코드를 한 줄도 건드리지 않는다. 순수 관찰자다. 조우 모듈(`src/sim/encounter.ts`)을
 * import 하지도 않는다 — 변경 **전** 워크트리에서도 그대로 돌아야 하기 때문이다.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import { hashWorld, idleInputs } from '../src/sim/replay.js';
import {
  BASELINE_PLANETS,
  BASELINE_BUILDS,
  baselineConfig,
  driveBaseline,
} from './recordStrikerBaseline.js';
import type { PlanetSpec, BuildSpec } from './recordStrikerBaseline.js';
import {
  SAMPLE_GUARDIAN,
  SAMPLE_REF,
  emptyInvasionLayers,
  normalizeInvasionLayers,
} from '../src/sim/invasion/normalize.js';
import type { InvasionLayers, InvasionRuntime } from '../src/sim/invasion/types.js';
import { INVASION_TOTAL_TICKS, INVASION_ACCEL_BASE_CP, PHASE_L1 } from '../src/sim/invasion/constants.js';

/** 기준선 포맷 버전. 스키마가 바뀌면 올린다(대조 테스트가 검사한다). */
export const ENCOUNTER_BASELINE_FORMAT = 1;

/** PvE 런 길이(틱). 세그먼트 0~2 구간을 넉넉히 덮는다. */
export const PVE_BASELINE_TICKS = 1800;
/** 침공 런 길이(틱). */
export const INVASION_BASELINE_TICKS = 900;

export const ENCOUNTER_BASELINE_PATH = fileURLToPath(
  new URL('../tests/fixtures/encounter-baseline.json', import.meta.url),
);

export interface PveBaselineRun {
  readonly key: string;
  readonly planet: number;
  readonly stage: number;
  readonly seed: number;
  readonly skillInvest: readonly number[];
  readonly ticks: number;
  /** 세그먼트 인덱스가 처음 3 이 된 틱(0-기반 hashes 인덱스). 끝까지 도달 못 하면 -1. */
  readonly seg3Tick: number;
  readonly hashes: readonly number[];
}

export interface InvasionBaselineRun {
  readonly key: string;
  readonly seed: number;
  readonly ticks: number;
  readonly hashes: readonly number[];
}

export interface EncounterBaseline {
  readonly meta: {
    readonly format: number;
    readonly generatedBy: string;
    readonly pveTicks: number;
    readonly invasionTicks: number;
    readonly pveRunCount: number;
    readonly invasionRunCount: number;
  };
  readonly pve: readonly PveBaselineRun[];
  readonly invasion: readonly InvasionBaselineRun[];
}

// ---------------------------------------------------------------------------
// PvE — 스트라이커 골든 녹화기의 파일럿·설정을 그대로 재사용한다(동일 조건 보장).
// ---------------------------------------------------------------------------

/**
 * 한 PvE 런을 녹화한다. 입력 로그는 `driveBaseline`(추적 파일럿)이 만들고, 재생하면서
 * per-tick 해시와 `seg3Tick` 을 굳힌다.
 *
 * ⚠️ 입력 로그 자체가 sim 을 굴려 만들어지므로 중반 격전 삽입 후에는 **세그먼트 3 도달 이후의
 * 입력이 달라진다.** 대조를 `seg3Tick` 앞까지로 자르는 이유가 이것이다(그 앞은 sim 이 동일하니
 * 입력도 바이트 동일하다).
 */
export function recordPveRun(planet: PlanetSpec, build: BuildSpec, buildIndex: number): PveBaselineRun {
  const seed = (planet.seedBase + buildIndex * 0x1000) >>> 0;
  const config = baselineConfig(planet, build.invest);
  const inputs = driveBaseline(seed, config, PVE_BASELINE_TICKS);
  const state = createWorld(seed, config);
  const hashes: number[] = [];
  let seg3Tick = -1;
  for (let t = 0; t < inputs.length; t++) {
    stepWorld(state, inputs[t] as InputFrame);
    if (seg3Tick < 0 && state.wave.segmentIndex >= 3) seg3Tick = t;
    hashes.push(hashWorld(state));
  }
  return {
    key: `${planet.id}/${build.id}`,
    planet: planet.planet,
    stage: planet.stage,
    seed,
    skillInvest: build.invest.slice(),
    ticks: inputs.length,
    seg3Tick,
    hashes,
  };
}

// ---------------------------------------------------------------------------
// 침공 — tests/invasionHash.test.ts 의 하네스와 같은 방식으로 3레이어 상태를 싣는다.
// 침공은 updateWaves 를 실행하지 않으므로 중반 격전 삽입의 영향이 **구조적으로 0** 이다.
// 이 기준선은 그 주장을 바이트로 증명하는 물증이다(AC2).
// ---------------------------------------------------------------------------

interface Invasion3Carrier {
  config: { invasion3?: { layers: InvasionLayers; timeLimitTicks: number; maintenance?: number } };
  invasion3?: InvasionRuntime;
}

function baseRuntime(): InvasionRuntime {
  return {
    phase: PHASE_L1 as InvasionRuntime['phase'],
    phaseEnterTick: 0,
    scrollX: 0,
    scrollY: 0,
    accelCp: INVASION_ACCEL_BASE_CP,
  };
}

/** 모든 슬롯이 채워진 배치 — 침공 파이프라인 표면을 최대로 켠다. */
function filledLayers(): InvasionLayers {
  const empty = emptyInvasionLayers();
  return normalizeInvasionLayers({
    l1: { waveSlots: empty.l1.waveSlots.map(() => SAMPLE_REF) },
    l2: { templateId: 0, sockets: new Array(12).fill(SAMPLE_REF) },
    l3: {
      boss: SAMPLE_REF,
      guardians: empty.l3.guardians.map(() => SAMPLE_GUARDIAN),
      props: empty.l3.props.map(() => SAMPLE_REF),
      core: { hp: 8000, x: 0, y: -1200 },
      modules: empty.l3.modules.map(() => SAMPLE_REF),
    },
  });
}

export function makeInvasionState(seed: number): WorldState {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  const state = createWorld(seed, config);
  const carrier = state as unknown as Invasion3Carrier;
  carrier.config.invasion3 = {
    layers: filledLayers(),
    timeLimitTicks: INVASION_TOTAL_TICKS,
    maintenance: 8000,
  };
  carrier.invasion3 = baseRuntime();
  return state;
}

export function recordInvasionRun(seed: number): InvasionBaselineRun {
  const state = makeInvasionState(seed);
  const inputs = idleInputs(INVASION_BASELINE_TICKS);
  const hashes: number[] = [];
  for (let t = 0; t < inputs.length; t++) {
    stepWorld(state, inputs[t] as InputFrame);
    hashes.push(hashWorld(state));
  }
  return { key: `invasion/${seed}`, seed, ticks: inputs.length, hashes };
}

/** 침공 시드 3종(임의 고정값 — 시드마다 배치·전개가 달라 커버리지를 넓힌다). */
export const INVASION_SEEDS: readonly number[] = [4242, 0xbeef, 0x1357];

export function buildEncounterBaseline(): EncounterBaseline {
  const pve: PveBaselineRun[] = [];
  for (const planet of BASELINE_PLANETS) {
    for (let b = 0; b < BASELINE_BUILDS.length; b++) {
      pve.push(recordPveRun(planet, BASELINE_BUILDS[b] as BuildSpec, b));
    }
  }
  const invasion = INVASION_SEEDS.map((s) => recordInvasionRun(s));
  return {
    meta: {
      format: ENCOUNTER_BASELINE_FORMAT,
      generatedBy: 'scripts/recordEncounterBaseline.ts',
      pveTicks: PVE_BASELINE_TICKS,
      invasionTicks: INVASION_BASELINE_TICKS,
      pveRunCount: pve.length,
      invasionRunCount: invasion.length,
    },
    pve,
    invasion,
  };
}

/** 들여쓰기 없음 — 해시 배열이 커서 pretty 출력은 파일이 몇 배가 된다. */
export function serializeEncounterBaseline(b: EncounterBaseline): string {
  return JSON.stringify(b) + '\n';
}

// ---------------------------------------------------------------------------
// CLI — 쓰기는 **환경 변수로만** 열린다(recordStrikerBaseline 선례). 테스트가 이 모듈을
// import 하므로 import 만으로 기준선이 덮어써지는 사고를 원천 차단한다.
// ---------------------------------------------------------------------------

const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env;

if (nodeEnv?.RECORD_ENCOUNTER_BASELINE === '1') {
  const out = nodeEnv.ENCOUNTER_BASELINE_OUT ?? ENCOUNTER_BASELINE_PATH;
  const baseline = buildEncounterBaseline();
  const text = serializeEncounterBaseline(baseline);
  writeFileSync(out, text, 'utf8');
  const lines = [
    `[recordEncounterBaseline] pve=${baseline.pve.length}×${PVE_BASELINE_TICKS} ` +
      `invasion=${baseline.invasion.length}×${INVASION_BASELINE_TICKS} → ${out} (${text.length} bytes)`,
  ];
  for (const r of baseline.pve) {
    lines.push(`  pve ${r.key} seed=${r.seed} seg3Tick=${r.seg3Tick} final=${r.hashes[r.hashes.length - 1]}`);
  }
  for (const r of baseline.invasion) {
    lines.push(`  inv ${r.key} final=${r.hashes[r.hashes.length - 1]}`);
  }
  console.log(lines.join('\n'));
}
