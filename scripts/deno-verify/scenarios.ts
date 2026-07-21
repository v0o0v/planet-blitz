/**
 * 크로스 검증 시나리오 정의 (M4 선행 스파이크 — Deno 결정론 검증).
 *
 * 이 모듈은 Node(vitest)와 Deno 양쪽에서 **동일하게** import된다:
 *   - Node 측(tests/deno-fixture.test.ts)이 각 시나리오를 실행해 기대 해시를
 *     fixtures.json으로 굳힌다(ground truth).
 *   - Deno 측(verify.ts)이 같은 시나리오를 재실행해 fixtures.json과 bit-identical
 *     비교한다.
 *
 * 시나리오 입력은 시드로부터 결정론적으로 재구성된다(buildInputs). 스티어링이
 * 필요한 런(보스 추적·파워업 픽·루팅)은 throwaway 월드를 굴려 입력 로그를 만들되,
 * 그 월드 진화 자체가 결정론적이므로 두 런타임이 동일한 입력 로그를 얻는다. 입력
 * 생성이 어긋나면 최종 해시가 갈라져 그대로 검출된다(추가로 inputsHash도 비교).
 *
 * 시뮬 코어(src/sim)와 아이템 롤러(src/items/roll)는 `.js` specifier로 import하며,
 * Deno는 sloppy-imports(unstable, deno.json)로 `.ts`에 resolve한다 — 소스 무수정.
 */

import {
  createWorld,
  stepWorld,
  emptyInput,
  packPowerupPick,
  DEFAULT_CONFIG,
} from '../../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../../src/sim/world.js';
import { neutralLoadout, computeLoadoutStats } from '../../src/items/loadout.js';
import { shipTypeDef, zeroSkillInvest, shipTreeRange } from '../../data/ships/index.js';
import {
  UQ_OVERHEAT_DRUM,
  UQ_PIERCE_GYRO,
  UQ_CONVERGE_PRISM,
  UQ_GREED_HEART,
} from '../../src/sim/uniques.js';
import { atan2, length } from '../../src/sim/math.js';
import { SeededRng } from '../../src/sim/rng.js';
import { SKILL_NODE_COUNT } from '../../data/skills.js';
import type { Rarity, ItemSource } from '../../src/items/types.js';

/** rollItem 결정론을 교차 검증하기 위한 단일 롤 스펙. */
export interface RollProbe {
  readonly dropSeed: number;
  readonly rarity: Rarity;
  readonly source: ItemSource;
  /** true면 rollItem 대신 rerollAffixes 검증(잠금 인덱스 lockedIndex). */
  readonly reroll?: { readonly rerollSeed: number; readonly lockedIndex?: number };
}

export interface Scenario {
  readonly name: string;
  readonly seed: number;
  readonly config: WorldConfig;
  /** 체크포인트 해시 간격(틱). 매 interval 틱마다 해시를 기록. */
  readonly checkpointInterval: number;
  /** 결정론적 입력 로그를 (재)생성. 두 런타임이 동일 로그를 얻는다. */
  buildInputs(): InputFrame[];
  /** roll.ts 교차 검증용 롤 스펙 묶음. */
  readonly rolls: readonly RollProbe[];
}

/**
 * 내구 파일럿 스티어링: 보스가 있으면 추적, 파워업 대기 시 0번 선택, 승리 후 남은
 * 바닥 loot로 이동해 수거, 그 외 idle. 순수 상태 함수라 프레임이 결정론적이다.
 * (tests/fullRun.test.ts·integration.test.ts의 검증된 정책과 동일 골자.)
 */
function driveDurable(seed: number, config: WorldConfig, maxTicks: number): InputFrame[] {
  const state: WorldState = createWorld(seed, config);
  const inputs: InputFrame[] = [];
  let grace = 0;
  for (let t = 0; t < maxTicks; t++) {
    const player = state.entities[0]!;
    const boss = state.entities.find((e) => e.kind === 'boss');
    const lootE = state.entities.find((e) => e.kind === 'loot');
    let frame: InputFrame;
    if (state.pendingLevelUp) {
      frame = { ...emptyInput(), special: packPowerupPick(0) };
    } else if (boss !== undefined) {
      const dx = boss.x - player.x;
      const dy = boss.y - player.y;
      const len = length(dx, dy) || 1;
      frame = { moveX: dx / len, moveY: dy / len, aim: atan2(dy, dx), dash: false, special: 0 };
    } else if (state.victory && lootE !== undefined) {
      const dx = lootE.x - player.x;
      const dy = lootE.y - player.y;
      const len = length(dx, dy) || 1;
      frame = { moveX: dx / len, moveY: dy / len, aim: atan2(dy, dx), dash: false, special: 0 };
    } else {
      frame = emptyInput();
    }
    inputs.push(frame);
    stepWorld(state, frame);
    if (state.gameOver) break;
    if (state.victory && state.entities.every((e) => e.kind !== 'loot')) {
      if (++grace > 20) break;
    } else {
      grace = 0;
    }
  }
  return inputs;
}

/** 시드 기반 로밍 입력(대각 드리프트 + 노이즈) — 청크/기믹/벽/LOS까지 자극. */
function driveRoam(inputSeed: number, ticks: number): InputFrame[] {
  const gen = new SeededRng(inputSeed);
  const inputs: InputFrame[] = [];
  for (let t = 0; t < ticks; t++) {
    inputs.push({
      moveX: 0.7 + gen.range(-0.5, 0.5),
      moveY: -0.7 + gen.range(-0.5, 0.5),
      aim: gen.range(-Math.PI, Math.PI),
      dash: gen.chance(0.06),
      special: 0,
    });
  }
  return inputs;
}

/** 이상현상을 제안하는 시드를 결정론적으로 탐색(anomalyAccepted 검증용). */
function findAnomalySeed(base: WorldConfig): number {
  for (let s = 1; s < 4000; s++) {
    const w = createWorld(s, { ...base, anomalyAccepted: false });
    if (w.anomaly.kind !== 0 /* ANOMALY_NONE */) return s;
  }
  return 1;
}

const DURABLE = 100_000_000;
const MAX_RUN_TICKS = 60 * 240; // 4분 상한(내구 파일럿은 보스까지 충분히 도달).

// --- 시나리오 ④: 유니크 장착(과열 드럼 + 관통 자이로) 로드아웃 ------------------
const UNIQUE_LOADOUT = {
  ...neutralLoadout(),
  weaponType: 2, // 레일건 — 관통 자이로 훅이 실제로 발화.
  uniqueMask: (1 << UQ_OVERHEAT_DRUM) | (1 << UQ_PIERCE_GYRO),
};

// --- 시나리오 ②: 베르단 교전 + 로드아웃 + 엘리트 어픽스 ----------------------
const BERDAN_LOADOUT = {
  ...neutralLoadout(),
  weaponType: 1, // 스프레드
  damageMult: 1.5,
  fireRateMult: 0.9,
  bulletCountAdd: 1,
  pierceAdd: 2,
  bulletSpeedMult: 1.2,
  spreadAdd: 0.1,
  rangeAdd: 200,
  moveSpeedMult: 1.1,
  maxHpAdd: 40,
  dashCdMult: 0.85,
  magnetMult: 1.3,
  xpMult: 1.25,
  uniqueMask: 1 << UQ_OVERHEAT_DRUM,
};

const KARGON_RECON: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 0,
  tier: 0,
  playerHp: DURABLE,
};

const BERDAN_ENGAGE: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 1,
  tier: 1,
  playerHp: DURABLE,
  loadout: BERDAN_LOADOUT,
};

const ANOMALY_BASE: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 0,
  tier: 0,
  playerHp: DURABLE,
  anomalyAccepted: true,
};
const ANOMALY_SEED = findAnomalySeed(ANOMALY_BASE);

const UNIQUE_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 1,
  tier: 1,
  playerHp: DURABLE,
  loadout: UNIQUE_LOADOUT,
};

/** 몇 노드에만 투자한 길이 SKILL_NODE_COUNT 스킬 벡터(파워업 가중·결정론 필드 자극). */
function sampleSkillInvest(): number[] {
  const v = Array<number>(SKILL_NODE_COUNT).fill(0);
  v[0] = 3; // firepower tier0
  v[20] = 2; // survival tier0
  v[40] = 4; // mobility tier0
  return v;
}

// --- 시나리오 ⑤: 니플헤임 섬멸 + 미사일 + 원소 어픽스 + 스킬투자 (M3 표면) ---------
// 미사일(weaponType 3) 유도 발사 + 화염·냉기·전격 상태이상 + 스킬 벡터(파워업 가중)를
// 한 런에 실어 M3 신규 표면을 크로스 검증한다.
const NIFLHEIM_LOADOUT = {
  ...neutralLoadout(),
  weaponType: 3, // 미사일 — homeMissile 유도 + 섬멸 티어 밀집 표적.
  damageMult: 1.3,
  fireRateMult: 0.95,
  pierceAdd: 1,
  bulletSpeedMult: 1.1,
  rangeAdd: 150,
  moveSpeedMult: 1.1,
  maxHpAdd: 60,
  dashCdMult: 0.9,
  fireDmg: 5, // 화염(지속피해)
  coldSlow: 1, // 냉기(불리언 게이트)
  lightning: 8, // 전격(연쇄)
};

const NIFLHEIM_ANNIHILATION: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2, // 니플헤임(신규 행성)
  tier: 2, // 섬멸(엘리트 2개·파워업 가중)
  playerHp: DURABLE,
  loadout: NIFLHEIM_LOADOUT,
  skillInvest: sampleSkillInvest(),
};

// --- 시나리오 ⑥: 아르케 교전 + 빔 + M3 유니크(수렴 프리즘 + 탐욕의 심장) -----------
// 빔(weaponType 4) 세그먼트 판정 + 관통 적 수 비례 증폭(수렴 프리즘) + 젬 획득 콤보/자석
// 스택(탐욕의 심장)을 실어 M3 유니크 훅을 크로스 검증한다. 프리즘은 빔과 페어링(MED-1).
const ARKE_BEAM_LOADOUT = {
  ...neutralLoadout(),
  weaponType: 4, // 빔 — 수렴 프리즘(빔 전용) 페어링.
  uniqueMask: (1 << UQ_CONVERGE_PRISM) | (1 << UQ_GREED_HEART),
  damageMult: 1.25,
  fireRateMult: 0.9,
  rangeAdd: 200,
  bulletSpeedMult: 1.1,
  moveSpeedMult: 1.05,
  maxHpAdd: 40,
  magnetMult: 1.4,
  xpMult: 1.2,
};

const ARKE_ENGAGE: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 3, // 아르케(신규 행성)
  tier: 1, // 교전
  playerHp: DURABLE,
  loadout: ARKE_BEAM_LOADOUT,
};

// --- 시나리오 ⑦: 비스트라이커 기체(비온) 런 — M8 기체 타입 교차 검증 -----------------
// ⚠️ 설계서 §10-8 이 예측한 **라이브 서비스 파손** 지점을 닫는 시나리오다. ①~⑥ 은 전부
// 스트라이커(=`shipType` 미지정) 전제라, EF/Deno 가 기체 타입을 모르면 클라 단위 테스트가
// 전부 그린인 채로 **비스트라이커 런만 서버 재실행에서 갈린다**. 그래서 이 시나리오는
// 세 가지를 동시에 자극한다:
//   ① `WorldConfig.shipType` 조건부 해시 꼬리 폴드(`replay.ts` 최후미)
//   ② 시그니처 비트(`uniqueMask` 18~21) → sim 의 `signatureOn` 분기와 파생 스탯
//   ③ 스트라이커와 **길이가 다른** `skillInvest`(비온 78) → 길이 프리픽스 폴드와
//      파워업 affinity 슬라이스(`nodesPerTree` 가 타입별)
// 로드아웃은 리터럴이 아니라 실제 파생 함수를 태워, 클라가 쓰는 경로와 같은 값이 되게 한다.
const BION_TYPE_ID = 4;

function bionSkillInvest(): number[] {
  const def = shipTypeDef(BION_TYPE_ID);
  const v = zeroSkillInvest(BION_TYPE_ID);
  // 세 계열 tier0 을 각각 다르게 찍어 affinity 슬라이스가 실제로 갈리게 한다.
  for (let ti = 0; ti < def.trees.length; ti++) {
    const { start } = shipTreeRange(def, ti);
    v[start] = ti + 2;
  }
  return v;
}

const BION_INVEST = bionSkillInvest();

const BION_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2,
  tier: 1,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], BION_INVEST, undefined, BION_TYPE_ID).loadout,
  skillInvest: BION_INVEST,
  shipType: BION_TYPE_ID,
};

/** 7종 대표 시나리오(M2 4 + M3 표면 2 + M8 비스트라이커 1). */
export const SCENARIOS: readonly Scenario[] = [
  {
    name: '① 카르곤 정찰 기본(로밍)',
    seed: 0x6a19,
    config: KARGON_RECON,
    checkpointInterval: 600,
    // 정찰은 보스까지 가되, 로밍으로 스크롤맵 기믹도 함께 자극.
    buildInputs: () => driveDurable(0x6a19, KARGON_RECON, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0x6a19_01, rarity: 'normal', source: { planet: 0, tier: 0 } },
      { dropSeed: 0x6a19_02, rarity: 'magic', source: { planet: 0, tier: 0 } },
      { dropSeed: 0x6a19_03, rarity: 'rare', source: { planet: 0, tier: 0 } },
    ],
  },
  {
    name: '② 베르단 교전 + 로드아웃 + 엘리트 어픽스',
    seed: 0xd0e5,
    config: BERDAN_ENGAGE,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0xd0e5, BERDAN_ENGAGE, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0xd0e5_11, rarity: 'rare', source: { planet: 1, tier: 1 } },
      { dropSeed: 0xd0e5_12, rarity: 'unique', source: { planet: 1, tier: 1 } },
      {
        dropSeed: 0xd0e5_13,
        rarity: 'rare',
        source: { planet: 1, tier: 1 },
        reroll: { rerollSeed: 0xbeef11, lockedIndex: 1 },
      },
    ],
  },
  {
    name: '③ 변칙(이상현상) 수락 런',
    seed: ANOMALY_SEED,
    config: ANOMALY_BASE,
    checkpointInterval: 600,
    buildInputs: () => driveRoam(0xa0a0, 60 * 40),
    rolls: [
      { dropSeed: 0xa0_21, rarity: 'magic', source: { planet: 0, tier: 0 } },
      { dropSeed: 0xa0_22, rarity: 'unique', source: { planet: 0, tier: 0 } },
    ],
  },
  {
    name: '④ 유니크 장착 런(과열 드럼 / 관통 자이로)',
    seed: 0x9e17,
    config: UNIQUE_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0x9e17, UNIQUE_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0x9e17_31, rarity: 'unique', source: { planet: 1, tier: 1 } },
      { dropSeed: 0x9e17_32, rarity: 'rare', source: { planet: 1, tier: 1 } },
      {
        dropSeed: 0x9e17_33,
        rarity: 'unique',
        source: { planet: 1, tier: 1 },
        reroll: { rerollSeed: 0x1234abc },
      },
    ],
  },
  {
    name: '⑤ 니플헤임 섬멸 + 미사일 + 원소 어픽스 + 스킬투자',
    seed: 0x51a1,
    config: NIFLHEIM_ANNIHILATION,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0x51a1, NIFLHEIM_ANNIHILATION, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0x51a1_51, rarity: 'rare', source: { planet: 2, tier: 2 } },
      { dropSeed: 0x51a1_52, rarity: 'unique', source: { planet: 2, tier: 2 } },
      {
        dropSeed: 0x51a1_53,
        rarity: 'rare',
        source: { planet: 2, tier: 2 },
        reroll: { rerollSeed: 0x5150c0, lockedIndex: 0 },
      },
    ],
  },
  {
    name: '⑥ 아르케 교전 + 빔 + M3 유니크(수렴 프리즘 / 탐욕의 심장)',
    seed: 0x7e2e,
    config: ARKE_ENGAGE,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0x7e2e, ARKE_ENGAGE, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0x7e2e_61, rarity: 'unique', source: { planet: 3, tier: 1 } },
      { dropSeed: 0x7e2e_62, rarity: 'rare', source: { planet: 3, tier: 1 } },
      { dropSeed: 0x7e2e_63, rarity: 'unique', source: { planet: 3, tier: 1 } },
    ],
  },
  {
    name: '⑦ 비온(비스트라이커 기체) 런 — shipType 폴드 + 시그니처 + 78길이 벡터',
    seed: 0xb10f,
    config: BION_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0xb10f, BION_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0xb10f_71, rarity: 'rare', source: { planet: 2, tier: 1 } },
      { dropSeed: 0xb10f_72, rarity: 'unique', source: { planet: 2, tier: 1 } },
    ],
  },
];
