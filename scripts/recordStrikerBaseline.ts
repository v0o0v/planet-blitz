/**
 * M8-L0 — 스트라이커(기존 단일 기체) 해시 골든 녹화기.
 *
 * ## 왜 필요한가
 * M8(기체 챔피언화)은 `data/skills.ts` 인덱스에 걸린 **삼중 해시 계약**을 건드린다:
 *   (1) 직접 폴드   — `src/sim/replay.ts` 가 `skillInvest` 를 길이 프리픽스 + u32 로 접는다
 *   (2) 파생 스탯   — `src/items/loadout.ts` → `cfg.loadout` → replay 폴드
 *   (3) sim RNG 슬라이스 — `src/sim/powerups.ts` 의 `investedInTree()` 가 트리 블록을
 *       인덱스 범위로 잘라 파워업 가중을 만들고, `drawPowerupChoices` 가 그 가중으로
 *       **powerupRng 를 소비**한다
 *
 * (3) 이 가장 위험하다 — 해시 폴드 레이아웃을 완벽히 보존해도 슬라이스 레이아웃이 한 칸만
 * 밀리면 **레벨업 틱부터 RNG 스트림이 갈린다.** 그래서 이 녹화기는 per-tick 해시뿐 아니라
 * **`drawPowerupChoices` 가 실제로 뱉은 인덱스 시퀀스**까지 통째로 굳힌다.
 *
 * ## 이 파일이 절대 하지 않는 것
 * 프로덕션 코드를 한 줄도 건드리지 않는다. 순수 관찰자다.
 *
 * ## 골든과 픽스처 재생성의 차이
 * `scripts/deno-verify/fixtures.json` 은 **테스트가 매 실행마다 다시 굳히는** 재생성형
 * 픽스처다(시뮬을 바꾸면 값이 따라 움직인다). 이 파일이 만드는
 * `tests/fixtures/striker-prem8.json` 은 정반대로 **M8 착수 전 상태에 못 박는 골든**이다 —
 * 테스트는 절대 다시 쓰지 않고 읽어서 비교만 한다. 그래야 회귀가 실패로 드러난다.
 *
 * ## 재생성 (의도적일 때만)
 *   RECORD_STRIKER_BASELINE=1 npx vite-node scripts/recordStrikerBaseline.ts
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createWorld,
  stepWorld,
  emptyInput,
  packPowerupPick,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';
import { computeLoadoutStats } from '../src/items/loadout.js';
import { SeededRng } from '../src/sim/rng.js';
import { atan2, length } from '../src/sim/math.js';
import {
  SKILLS,
  SKILL_TREES,
  SKILL_NODE_COUNT,
  CAPSTONE_GATE,
  capstoneIndex,
  treeRange,
} from '../data/skills.js';
import type { SkillTree } from '../data/skills.js';

/** 골든 픽스처 경로(테스트가 읽는 정본). */
export const BASELINE_FIXTURE_PATH = fileURLToPath(
  new URL('../tests/fixtures/striker-prem8.json', import.meta.url),
);

/** 런당 틱 수. 3000틱 = 50초 — 레벨업이 여러 번 나고 웨이브 세그먼트가 몇 번 도는 길이. */
export const BASELINE_TICKS = 3000;

/**
 * 골든 포맷 버전. 이 값을 올리는 것은 "M8 이전 상태를 못 박는다"는 계약을 스스로 깨는
 * 행위이므로, 리팩터 중에는 **절대 올리지 않는다**(올려야 한다면 그건 회귀 탐지기를 끄는
 * 것이고 별도 승인 사안이다).
 */
export const BASELINE_FORMAT = 1;

/** 사망으로 런이 조기 종료되지 않도록 하는 내구 HP(scripts/deno-verify 와 같은 관용구). */
const DURABLE = 100_000_000;

// ---------------------------------------------------------------------------
// 스킬 벡터 조립 — data/skills.ts 의 export 만 읽는다(리터럴 복사 금지).
// ---------------------------------------------------------------------------

function zeroInvest(): number[] {
  return new Array<number>(SKILL_NODE_COUNT).fill(0);
}

/**
 * 한 계열의 base 노드에 인덱스 오름차순(=티어 오름차순)으로 `points` 를 채운다.
 * 노드별 상한(`maxPoints`)을 지키므로 연구소가 허용하는 형태의 벡터만 나온다.
 * 반환값은 실제로 투입된 포인트 수(용량 초과분은 버려진다).
 */
function investTree(v: number[], tree: SkillTree, points: number): number {
  const { start, end } = treeRange(tree);
  let left = points;
  for (let i = start; i < end && left > 0; i++) {
    const node = SKILLS[i];
    if (node === undefined) continue;
    const put = Math.min(node.maxPoints, left);
    v[i] = (v[i] ?? 0) + put;
    left -= put;
  }
  return points - left;
}

/** 게이트(CAPSTONE_GATE) 를 넘긴 계열의 캡스톤에 1포인트 — sim 캡스톤 비트가 실제로 켜진다. */
function takeCapstone(v: number[], tree: SkillTree): void {
  v[capstoneIndex(tree)] = 1;
}

/** 계열 캡스톤 빌드: 게이트+4 포인트를 그 계열에 몰아넣고 캡스톤을 찍는다. */
function capstoneBuild(tree: SkillTree): number[] {
  const v = zeroInvest();
  investTree(v, tree, CAPSTONE_GATE + 4);
  takeCapstone(v, tree);
  return v;
}

/** 3계열 혼합(캡스톤 없음) — 어느 계열도 게이트를 못 넘는 분산 빌드. */
function mixedBuild(): number[] {
  const v = zeroInvest();
  investTree(v, 'firepower', 22);
  investTree(v, 'survival', 20);
  investTree(v, 'mobility', 18);
  return v;
}

/**
 * 만렙 근접 투자(≈99 포인트 + 캡스톤 1) — 화력을 캡스톤까지 밀고 나머지를 생존·기동에
 * 배분한 실전형 상한 빌드. 세 계열 슬라이스가 전부 0이 아니어서 파워업 가중이 최대로 갈린다.
 */
function nearMaxBuild(): number[] {
  const v = zeroInvest();
  investTree(v, 'firepower', CAPSTONE_GATE);
  takeCapstone(v, 'firepower');
  investTree(v, 'survival', 35);
  investTree(v, 'mobility', 24);
  return v;
}

/** 6종 빌드 정의(순서 고정 — 골든 엔트리 순서의 축). */
export interface BuildSpec {
  readonly id: string;
  readonly label: string;
  readonly invest: number[];
}

export const BASELINE_BUILDS: readonly BuildSpec[] = [
  { id: 'no-invest', label: '① 무투자', invest: zeroInvest() },
  { id: 'capstone-firepower', label: '② 화력 캡스톤', invest: capstoneBuild('firepower') },
  { id: 'capstone-survival', label: '③ 생존 캡스톤', invest: capstoneBuild('survival') },
  { id: 'capstone-mobility', label: '④ 기동 캡스톤', invest: capstoneBuild('mobility') },
  { id: 'mixed-three', label: '⑤ 3계열 혼합', invest: mixedBuild() },
  { id: 'near-max', label: '⑥ 만렙 근접', invest: nearMaxBuild() },
];

// ---------------------------------------------------------------------------
// 행성 2종 × 빌드 6종 = 12 런.
// ---------------------------------------------------------------------------

export interface PlanetSpec {
  readonly id: string;
  readonly label: string;
  readonly planet: number;
  /** 침략 단계(ADR-0022). 밴드 대표: 1=구 정찰(tier0), 11=구 교전(tier1). */
  readonly stage: number;
  /** 런 시드의 축(빌드 인덱스와 섞어 런마다 다른 시드를 만든다). */
  readonly seedBase: number;
}

// 침략 단계로 전환(ADR-0022). 단계 11 은 구 교전(tier1)과 sim 파라미터가 byte-identical
// (STAGE_MILESTONES 밴드1 = minStage11)이므로 스폰/HP/엘리트 거동이 그대로다 — 단, 해시
// config 폴드는 0-기반 인덱스라(단계11 → 10) 구 tier1 폴드(=1)와 달라 berdan 골든만 재녹화된다.
// 카르곤(단계1)은 폴드·파라미터 모두 구 tier0 과 동일해 바이트 불변이다(결정론 규율 1).
export const BASELINE_PLANETS: readonly PlanetSpec[] = [
  { id: 'kargon-recon', label: '카르곤 단계1', planet: 0, stage: 1, seedBase: 0x5731 },
  // seedBase 는 임의값이 아니라 **선별값**이다: 6빌드 전부가 3000틱 안에 레벨업 3회 이상을
  // 내는 시드를 고른 것(0xb4d0 은 무투자 런이 0회라 파워업 골든이 비었다 — 실측).
  { id: 'berdan-engage', label: '베르단 단계11', planet: 1, stage: 11, seedBase: 0x2211 },
];

/**
 * 런 설정 조립 — `src/main.ts:930-940`(PvE 런 시작)의 조립과 **같은 순서·같은 함수**다.
 * 장비는 비운다(골든의 목적은 스킬트리·파워업 슬라이스 불변 증명이라 장비 축은 잡음).
 * 계보 보너스 0 = `applyShipLineageBonus` 조기 반환 → 중립.
 */
export function baselineConfig(planet: PlanetSpec, invest: readonly number[]): WorldConfig {
  const skillInvest = invest.slice();
  const { loadout } = computeLoadoutStats([], skillInvest, 0);
  return {
    ...DEFAULT_CONFIG,
    planet: planet.planet,
    stage: planet.stage,
    playerHp: DURABLE,
    loadout,
    skillInvest,
  };
}

// ---------------------------------------------------------------------------
// 입력 로그 — 결정론적 파일럿.
// ---------------------------------------------------------------------------

const HOSTILE_KINDS: readonly string[] = ['enemy', 'boss'];

function nearestHostile(state: WorldState, px: number, py: number): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const e of state.entities) {
    if (!HOSTILE_KINDS.includes(e.kind)) continue;
    const d = length(e.x - px, e.y - py);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/**
 * 결정론적 파일럿 정책:
 *   - 레벨업 대기 중이면 0번 제안을 선택(파워업이 실제로 적용돼 빌드가 진화한다)
 *   - 그 외에는 최근접 적을 향해 **교전 접근**하면서 조준도 그쪽으로. 시드 RNG 노이즈를
 *     섞어 직선 추격이 아니라 흔들리며 접근한다 → 청크·벽·기믹도 함께 자극된다.
 *   - 적이 없으면 시드 RNG 로 로밍
 *
 * 접근(추격)을 쓰는 이유는 취향이 아니다 — 3000틱 안에 **레벨업이 여러 번 나야** 파워업
 * 추첨 시퀀스가 골든으로서 의미가 있다. 로밍만 하면 처치가 모자라 런당 추첨이 1~2회로
 * 떨어져 RNG 슬라이스 회귀를 거의 못 잡는다(실측).
 *
 * throwaway 월드를 굴려 입력을 만든 뒤 그 로그를 그대로 재생한다 — 월드 진화 자체가
 * 결정론이므로 로그도 결정론이다(scripts/deno-verify/scenarios.ts 의 driveDurable 관용구).
 */
export function driveBaseline(seed: number, config: WorldConfig, ticks: number): InputFrame[] {
  const state = createWorld(seed, config);
  const gen = new SeededRng((seed ^ 0x5bd1c0de) >>> 0);
  const inputs: InputFrame[] = [];
  for (let t = 0; t < ticks; t++) {
    let frame: InputFrame;
    if (state.pendingLevelUp) {
      frame = { ...emptyInput(), special: packPowerupPick(0) };
    } else {
      const p = state.entities[0];
      const px = p?.x ?? 0;
      const py = p?.y ?? 0;
      const target = nearestHostile(state, px, py);
      const nx = gen.range(-0.35, 0.35);
      const ny = gen.range(-0.35, 0.35);
      const dash = gen.chance(0.04);
      if (target === undefined) {
        frame = {
          moveX: 0.55 + nx,
          moveY: -0.45 + ny,
          aim: gen.range(-Math.PI, Math.PI),
          dash,
          special: 0,
        };
      } else {
        const dx = target.x - px;
        const dy = target.y - py;
        const len = length(dx, dy) || 1;
        frame = {
          moveX: dx / len + nx,
          moveY: dy / len + ny,
          aim: atan2(dy, dx),
          dash,
          special: 0,
        };
      }
    }
    inputs.push(frame);
    stepWorld(state, frame);
  }
  return inputs;
}

// ---------------------------------------------------------------------------
// 녹화.
// ---------------------------------------------------------------------------

export interface BaselineRun {
  /** `<planet.id>/<build.id>` — 골든 엔트리 키. */
  readonly key: string;
  readonly label: string;
  readonly planet: number;
  readonly stage: number;
  readonly seed: number;
  readonly ticks: number;
  /** 이 런의 스킬 투자 벡터(길이 SKILL_NODE_COUNT). */
  readonly skillInvest: readonly number[];
  /** per-tick 해시 전량(길이 === ticks). 요약이 아니라 원소 단위 골든이다. */
  readonly hashes: readonly number[];
  /**
   * 레벨업마다 `drawPowerupChoices` 가 뱉은 인덱스 배열(제안 순서 그대로).
   * 삼중 해시 계약의 (3)번 — sim RNG 슬라이스 — 을 직접 겨냥한 증거다.
   */
  readonly powerupDraws: readonly (readonly number[])[];
  /** 레벨업 제안이 발생한 틱 번호(순서대로). */
  readonly drawTicks: readonly number[];
  readonly summary: {
    readonly levelUps: number;
    readonly drawCount: number;
    readonly kills: number;
    readonly level: number;
    readonly gems: number;
    readonly entityCount: number;
    readonly bossSpawned: boolean;
    readonly gameOver: boolean;
    readonly victory: boolean;
    readonly uniqueMask: number;
    readonly finalHash: number;
  };
}

export interface Baseline {
  readonly meta: {
    readonly format: number;
    readonly generatedBy: string;
    readonly ticks: number;
    readonly skillNodeCount: number;
    readonly runCount: number;
  };
  readonly runs: readonly BaselineRun[];
}

/** 런 1건을 녹화한다(입력 생성 → 재생 → per-tick 해시 + 파워업 추첨 시퀀스). */
export function recordRun(planet: PlanetSpec, build: BuildSpec, buildIndex: number): BaselineRun {
  const config = baselineConfig(planet, build.invest);
  const seed = (planet.seedBase + buildIndex * 0x1_0001) >>> 0;
  const inputs = driveBaseline(seed, config, BASELINE_TICKS);

  const state = createWorld(seed, config);
  const hashes: number[] = [];
  const powerupDraws: number[][] = [];
  const drawTicks: number[] = [];
  let prevPending = state.pendingLevelUp;
  for (let t = 0; t < inputs.length; t++) {
    stepWorld(state, inputs[t] as InputFrame);
    // false → true 전이 시점의 powerupChoices 가 곧 drawPowerupChoices 의 반환값이다
    // (world.ts 가 그 배열을 그대로 대입한다). 프로덕션 코드를 건드리지 않고 관측한다.
    if (!prevPending && state.pendingLevelUp) {
      powerupDraws.push([...state.powerupChoices]);
      drawTicks.push(state.tick);
    }
    prevPending = state.pendingLevelUp;
    hashes.push(hashWorld(state));
  }

  return {
    key: `${planet.id}/${build.id}`,
    label: `${planet.label} · ${build.label}`,
    planet: planet.planet,
    stage: planet.stage,
    seed,
    ticks: inputs.length,
    skillInvest: build.invest.slice(),
    hashes,
    powerupDraws,
    drawTicks,
    summary: {
      levelUps: Math.max(0, state.level - 1),
      drawCount: powerupDraws.length,
      kills: state.kills,
      level: state.level,
      gems: state.gems,
      entityCount: state.entities.length,
      bossSpawned: state.bossSpawned,
      gameOver: state.gameOver,
      victory: state.victory,
      uniqueMask: config.loadout?.uniqueMask ?? 0,
      finalHash: hashes[hashes.length - 1] ?? 0,
    },
  };
}

/** 12 런(행성 2 × 빌드 6) 전량을 녹화한다. */
export function buildBaseline(): Baseline {
  const runs: BaselineRun[] = [];
  for (const planet of BASELINE_PLANETS) {
    for (let b = 0; b < BASELINE_BUILDS.length; b++) {
      runs.push(recordRun(planet, BASELINE_BUILDS[b] as BuildSpec, b));
    }
  }
  return {
    meta: {
      format: BASELINE_FORMAT,
      generatedBy: 'scripts/recordStrikerBaseline.ts',
      ticks: BASELINE_TICKS,
      skillNodeCount: SKILL_NODE_COUNT,
      runCount: runs.length,
    },
    runs,
  };
}

/**
 * 골든을 직렬화한다. 들여쓰기 없음 — 12×3000 해시라 pretty 출력은 파일이 3배가 된다.
 * 키 순서가 고정된 객체 리터럴만 담기므로 같은 입력이면 **바이트 동일**하다.
 */
export function serializeBaseline(baseline: Baseline): string {
  return JSON.stringify(baseline) + '\n';
}

// ---------------------------------------------------------------------------
// CLI — `RECORD_STRIKER_BASELINE=1 npx vite-node scripts/recordStrikerBaseline.ts`
//
// 쓰기는 **환경 변수로만** 열린다. vite-node 는 entry 경로를 argv 에서 걷어내므로
// "직접 실행인가" 를 argv 로 판정할 수 없고(실측), 무엇보다 골든이 import 만으로
// 덮어써지는 사고를 원천 차단해야 한다 — 테스트가 이 모듈을 import 하기 때문이다.
// ---------------------------------------------------------------------------

// `process` 는 이 저장소에 타입 선언이 (거의) 없다(@types/node 미의존, tests/node-shims.d.ts
// 가 `version` 만 선언). 전역 선언을 새로 추가하면 그 파일과 충돌하므로 globalThis 를 좁혀
// 읽는다 — 소유하지 않은 파일을 건드리지 않기 위한 우회다.
const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env;

if (nodeEnv?.RECORD_STRIKER_BASELINE === '1') {
  const baseline = buildBaseline();
  const text = serializeBaseline(baseline);
  writeFileSync(BASELINE_FIXTURE_PATH, text, 'utf8');
  const trees = SKILL_TREES.join('/');
  const lines = [
    `[recordStrikerBaseline] ${baseline.runs.length} runs × ${BASELINE_TICKS} ticks ` +
      `(trees=${trees}, nodes=${SKILL_NODE_COUNT}) → ${BASELINE_FIXTURE_PATH} (${text.length} bytes)`,
  ];
  for (const r of baseline.runs) {
    lines.push(
      `  ${r.key.padEnd(30)} levelUps=${String(r.summary.levelUps).padStart(2)} ` +
        `draws=${String(r.summary.drawCount).padStart(2)} kills=${String(r.summary.kills).padStart(3)} ` +
        `entities=${String(r.summary.entityCount).padStart(3)} uniqueMask=0x${r.summary.uniqueMask.toString(16)} ` +
        `final=0x${(r.summary.finalHash >>> 0).toString(16)}`,
    );
  }
  console.log(lines.join('\n'));
}
