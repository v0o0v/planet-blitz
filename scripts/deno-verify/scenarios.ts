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
  stage: 1,
  playerHp: DURABLE,
};

const BERDAN_ENGAGE: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 1,
  stage: 11,
  playerHp: DURABLE,
  loadout: BERDAN_LOADOUT,
};

const UNIQUE_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 1,
  stage: 11,
  playerHp: DURABLE,
  loadout: UNIQUE_LOADOUT,
};

// --- 시나리오 ③: 촉매 주입 런(ADR-0029) — 구 변칙 로밍 런 자리 -----------------------
// 촉매 시대 교차 검증: `hashWorld` 촉매 조건부 꼬리 폴드 + resolveCatalystMods 배선(드랍량·희귀도·
// 자원·파워·페널티)이 Node↔Deno 재실행에서 bit-identical 한지 자극한다. 여러 보상축(drop/rarity/
// resource/power-damage) + 페널티(enemyHp/enemyCount) 를 한 배열에 스택해 fold·배율을 한 번에 관통한다.
// 단계 11(교전)이라 엘리트 드랍이 실제로 발생 → 촉매 rarity·drop 관측 경로가 살아 있다.
const CATALYST_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 0,
  stage: 11,
  playerHp: DURABLE,
  // abundance(drop)·plunder(drop)·refinement(rarity)·extraction(resource)·overdrive(power dmg).
  catalysts: [0, 1, 5, 15, 25],
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
  stage: 21, // 섬멸(엘리트 2개·파워업 가중)
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
  stage: 11, // 교전
  playerHp: DURABLE,
  loadout: ARKE_BEAM_LOADOUT,
};

// --- 시나리오 ⑦: 비스트라이커 기체(해츨링) 런 — M8 기체 타입 교차 검증 ---------------
// ⚠️ 설계서 §10-8 이 예측한 **라이브 서비스 파손** 지점을 닫는 시나리오다. ①~⑥ 은 전부
// 스트라이커(=`shipType` 미지정) 전제라, EF/Deno 가 기체 타입을 모르면 클라 단위 테스트가
// 전부 그린인 채로 **비스트라이커 런만 서버 재실행에서 갈린다**. 그래서 이 시나리오는
// 세 가지를 동시에 자극한다:
//   ① `WorldConfig.shipType` 조건부 해시 꼬리 폴드(`replay.ts` 최후미)
//   ② 시그니처 비트(`uniqueMask` 18~21) → sim 의 `signatureOn` 분기와 파생 스탯
//   ③ 스트라이커와 **길이가 다른** `skillInvest`(해츨링 78) → 길이 프리픽스 폴드와
//      파워업 affinity 슬라이스(`nodesPerTree` 가 타입별)
// 로드아웃은 리터럴이 아니라 실제 파생 함수를 태워, 클라가 쓰는 경로와 같은 값이 되게 한다.
const HATCHLING_TYPE_ID = 4;

/**
 * 타입 무관 샘플 투자 벡터 — 각 계열(tree)의 **첫 base 노드**에 `ti + 2` 를 찍는다.
 *
 * 길이는 `zeroSkillInvest(typeId)` 가, 계열 경계는 `shipTreeRange` 가 준다 — **길이·계열 수를
 * 하드코딩하지 않는다.** 타입마다 `nodesPerTree` 가 다르기 때문이다(해츨링 78 / 나머지 63).
 * ⑦·⑧·⑨ 가 같은 생성기를 공유하므로 ⑦ 의 벡터는 도입 전과 바이트 동일하다(같은 호출·같은 값).
 */
function shipSampleInvest(typeId: number): number[] {
  const def = shipTypeDef(typeId);
  const v = zeroSkillInvest(typeId);
  // 세 계열 tier0 을 각각 다르게 찍어 affinity 슬라이스가 실제로 갈리게 한다.
  for (let ti = 0; ti < def.trees.length; ti++) {
    const { start } = shipTreeRange(def, ti);
    v[start] = ti + 2;
  }
  return v;
}

const HATCHLING_INVEST = shipSampleInvest(HATCHLING_TYPE_ID);

const HATCHLING_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2,
  stage: 11,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], HATCHLING_INVEST, undefined, HATCHLING_TYPE_ID).loadout,
  skillInvest: HATCHLING_INVEST,
  shipType: HATCHLING_TYPE_ID,
};

// --- 시나리오 ⑧·⑨: 말로우(완충) · 버블(방막) 런 — M8 시그니처 sim 분기 교차 검증 -------
// ⑦ 과 같은 이유(설계서 §10-8: EF/Deno 가 `shipType` 을 모르면 비스트라이커 침공이 전량
// `defense-mismatch`)로 추가한다. ⑦ 은 해츨링 하나뿐이라 **시그니처 sim 분기가 붙은 다른
// 타입들은 서버 재실행 커버리지가 0** 이었다.
//
// ⚠️ 길이 축은 여기서 자극되지 않는다 — `data/ships/mallow.ts`·`data/ships/bubble.ts` 는 둘 다
//    `nodesPerTree: NODES_PER_TREE` 라 스킬 노드 수가 **스트라이커와 같은 63** 이다. "스트라이커와
//    길이가 다른 skillInvest" 축은 해츨링(78) 전담이며 ⑧·⑨ 는 그 축을 대신하지 못한다.
//    ⑧·⑨ 가 새로 자극하는 것은 ①`shipType` 값 5·6 의 꼬리 폴드 ②시그니처 비트 22·23 의
//    `stepShipSignature`/`resolveCollisions` 분기(= aux0/aux1 조건부 폴드)다.
//
// ## 무대 선정 근거 — "얼마나 아픈가" 가 아니라 "어느 분기가 실행되는가" 로 골랐다
// 이 파일의 비교는 부등호가 아니라 **bit-identical 해시**다. 따라서 신호의 크기보다 **시그니처
// 분기가 한 번이라도 실행되는가**가 기준이다(실행되지 않는 분기는 EF 가 통째로 빠뜨려도
// 두 런타임의 해시가 같다 — 커버리지 0).
//  · ⑧ 말로우 = `planet 2 / tier 0` — 완충은 분기가 둘이다: **지연 적립**(피격 시)과
//    **정산**(연속 무피격 CUSHION_RECOVER_TICKS=180 을 채운 틱). 압박이 끊기지 않는 섬멸
//    티어(t2)는 무피격 최대 113틱이라 **정산 분기가 한 번도 실행되지 않는다**(실측). 정찰
//    티어라야 교전이 끊겨 두 분기가 모두 돈다.
//  · ⑨ 버블 = `planet 2 / tier 1` — 방막은 시간축만 필요해 무대에 둔감하다. 보스까지 도달해
//    루팅 시퀀스까지 함께 굳는 교전 티어를 골랐다(정찰 티어는 런이 짧아 막 재생 횟수가 준다).
// 실측 수치는 아래 각 엔트리 주석에 있다.
const MALLOW_TYPE_ID = 5;
const BUBBLE_TYPE_ID = 6;

const MALLOW_INVEST = shipSampleInvest(MALLOW_TYPE_ID);
const BUBBLE_INVEST = shipSampleInvest(BUBBLE_TYPE_ID);

const MALLOW_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2,
  stage: 1,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], MALLOW_INVEST, undefined, MALLOW_TYPE_ID).loadout,
  skillInvest: MALLOW_INVEST,
  shipType: MALLOW_TYPE_ID,
};

const BUBBLE_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2,
  stage: 11,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], BUBBLE_INVEST, undefined, BUBBLE_TYPE_ID).loadout,
  skillInvest: BUBBLE_INVEST,
  shipType: BUBBLE_TYPE_ID,
};

// --- 시나리오 ⑩·⑪·⑫: 브루저(장갑) · 아크캐스터(과충전) · 팬텀(은신) 런 -----------------
// ⑦⑧⑨ 와 같은 이유로 추가한다. 그 셋을 넣고도 **로스터 6종 중 3종(1·2·3)은 Node↔Deno
// bit-identical 검증을 한 번도 받지 못한 상태**였다(적대적 리뷰 determinism MED-2 / wiring MED-4).
// 특히 팬텀은 `patterns/index.ts`·`boss.ts` 라는 **적 AI 코드까지 바꾸는 유일한 시그니처**이고,
// 그 게이트를 위해 `src/sim/cloak.ts` 라는 신규 모듈 경계까지 생겼다 — 번들러가 모듈 초기화를
// 재배치했을 때 클라와 EF 가 갈리면 팬텀 런의 정상 침공 제출이 전량 거부된다. 이제 6종 전량이
// `deno task verify` 에 들어간다.
//
// ## 무대 선정 근거 (⑧⑨ 와 같은 기준 — "어느 분기가 실행되는가")
//  · ⑩ 브루저 = `planet 2 / tier 1` — 장갑은 **맞아야** 쌓인다. 교전 티어라야 피격이 반복돼
//    스택 적립(resolveCollisions)과 소멸 타이머(stepShipSignature) 두 분기가 모두 돈다.
//  · ⑪ 아크캐스터 = `planet 2 / tier 1` — 과충전은 **정지 입력**이 필요하다. `driveDurable` 은
//    보스·루팅 구간 외에는 `emptyInput`(정지)을 내므로 임계(90틱)를 넘겨 증폭 분기가 실행된다.
//  · ⑫ 팬텀 = `planet 0 / tier 0` — 은신은 **연속 무피격 240틱**이 필요하다. 압박이 빽빽한
//    무대에서는 진입 자체가 0 이라(실측) 정찰 티어를 골랐다. 여기서 은신·해제 배율·적 방출
//    억제 세 분기가 모두 실행된다.
const BRUISER_TYPE_ID = 1;
const ARCCASTER_TYPE_ID = 2;
const PHANTOM_TYPE_ID = 3;

const BRUISER_INVEST = shipSampleInvest(BRUISER_TYPE_ID);
const ARCCASTER_INVEST = shipSampleInvest(ARCCASTER_TYPE_ID);
const PHANTOM_INVEST = shipSampleInvest(PHANTOM_TYPE_ID);

const BRUISER_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2,
  stage: 11,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], BRUISER_INVEST, undefined, BRUISER_TYPE_ID).loadout,
  skillInvest: BRUISER_INVEST,
  shipType: BRUISER_TYPE_ID,
};

const ARCCASTER_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2,
  stage: 11,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], ARCCASTER_INVEST, undefined, ARCCASTER_TYPE_ID).loadout,
  skillInvest: ARCCASTER_INVEST,
  shipType: ARCCASTER_TYPE_ID,
};

const PHANTOM_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 0,
  stage: 1,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], PHANTOM_INVEST, undefined, PHANTOM_TYPE_ID).loadout,
  skillInvest: PHANTOM_INVEST,
  shipType: PHANTOM_TYPE_ID,
};

/** 12종 대표 시나리오(M2 4 + M3 표면 2 + M8 비스트라이커 6 = 로스터 전량). */
export const SCENARIOS: readonly Scenario[] = [
  {
    name: '① 카르곤 정찰 기본(로밍)',
    seed: 0x6a19,
    config: KARGON_RECON,
    checkpointInterval: 600,
    // 정찰은 보스까지 가되, 로밍으로 스크롤맵 기믹도 함께 자극.
    buildInputs: () => driveDurable(0x6a19, KARGON_RECON, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0x6a19_01, rarity: 'normal', source: { planet: 0, stage: 1 } },
      { dropSeed: 0x6a19_02, rarity: 'magic', source: { planet: 0, stage: 1 } },
      { dropSeed: 0x6a19_03, rarity: 'rare', source: { planet: 0, stage: 1 } },
    ],
  },
  {
    name: '② 베르단 교전 + 로드아웃 + 엘리트 어픽스',
    seed: 0xd0e5,
    config: BERDAN_ENGAGE,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0xd0e5, BERDAN_ENGAGE, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0xd0e5_11, rarity: 'rare', source: { planet: 1, stage: 11 } },
      { dropSeed: 0xd0e5_12, rarity: 'unique', source: { planet: 1, stage: 11 } },
      {
        dropSeed: 0xd0e5_13,
        rarity: 'rare',
        source: { planet: 1, stage: 11 },
        reroll: { rerollSeed: 0xbeef11, lockedIndex: 1 },
      },
    ],
  },
  {
    name: '③ 촉매 주입 런(드랍/희귀도/자원/파워 + 페널티, ADR-0029)',
    seed: 0xca7a,
    config: CATALYST_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0xca7a, CATALYST_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0xca7a_21, rarity: 'rare', source: { planet: 0, stage: 11 } },
      { dropSeed: 0xca7a_22, rarity: 'unique', source: { planet: 0, stage: 11 } },
    ],
  },
  {
    name: '④ 유니크 장착 런(과열 드럼 / 관통 자이로)',
    seed: 0x9e17,
    config: UNIQUE_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0x9e17, UNIQUE_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0x9e17_31, rarity: 'unique', source: { planet: 1, stage: 11 } },
      { dropSeed: 0x9e17_32, rarity: 'rare', source: { planet: 1, stage: 11 } },
      {
        dropSeed: 0x9e17_33,
        rarity: 'unique',
        source: { planet: 1, stage: 11 },
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
      { dropSeed: 0x51a1_51, rarity: 'rare', source: { planet: 2, stage: 21 } },
      { dropSeed: 0x51a1_52, rarity: 'unique', source: { planet: 2, stage: 21 } },
      {
        dropSeed: 0x51a1_53,
        rarity: 'rare',
        source: { planet: 2, stage: 21 },
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
      { dropSeed: 0x7e2e_61, rarity: 'unique', source: { planet: 3, stage: 11 } },
      { dropSeed: 0x7e2e_62, rarity: 'rare', source: { planet: 3, stage: 11 } },
      { dropSeed: 0x7e2e_63, rarity: 'unique', source: { planet: 3, stage: 11 } },
    ],
  },
  {
    name: '⑦ 해츨링(비스트라이커 기체) 런 — shipType 폴드 + 시그니처 + 78길이 벡터',
    seed: 0xb10f,
    config: HATCHLING_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0xb10f, HATCHLING_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0xb10f_71, rarity: 'rare', source: { planet: 2, stage: 11 } },
      { dropSeed: 0xb10f_72, rarity: 'unique', source: { planet: 2, stage: 11 } },
    ],
  },
  {
    // 완충은 **맞아야** 발현된다 — 피격 피해의 CUSHION_DEFER_BP(35%)를 지연분으로 떼어 aux0 에
    // 적립하고, 연속 무피격 CUSHION_RECOVER_TICKS(180)를 채운 틱에 풀을 통째로 정산한다.
    // 실측(런 3488틱, 보스 처치·승리): **지연 적립 34회**(aux0 최대 167) · **정산 6회**
    // (aux0 이 양수 → 0 으로 떨어진 횟수) · aux1 최대 322. 시그니처 억제 동형 대조군은
    // aux0/aux1 이 끝까지 0 이고(조건부 폴드 미발생) 승리에도 도달하지 못한다.
    name: '⑧ 말로우(완충) 런 — shipType 5 폴드 + 시그니처 22 지연적립/정산 aux 폴드',
    seed: 0xc0a5,
    config: MALLOW_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0xc0a5, MALLOW_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0xc0a5_81, rarity: 'rare', source: { planet: 2, stage: 1 } },
      { dropSeed: 0xc0a5_82, rarity: 'unique', source: { planet: 2, stage: 1 } },
    ],
  },
  {
    // 방막은 시간축만 필요하다 — 막이 없는 동안 FILM_PERIOD_TICKS(420)를 채우면 내구
    // FILM_ABSORB_FLAT(60)짜리 막이 서고, 내구가 소진되는 순간 파열해 반경 안의 적을 밀어낸다.
    // 실측(런 14400틱 = 주기의 34배, 보스 처치·승리): **막 재생 24회 · 파열 24회**
    // (aux0 0 → 60 → 0 왕복), aux1 최대 419(재생 임계 직전). 파열은 적 좌표를 직접 옮기므로
    // 해시에 그대로 반영된다. 억제 동형 대조군은 aux 가 끝까지 0.
    name: '⑨ 버블(방막) 런 — shipType 6 폴드 + 시그니처 23 흡수/파열 aux 폴드',
    seed: 0xf11a,
    config: BUBBLE_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0xf11a, BUBBLE_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0xf11a_91, rarity: 'rare', source: { planet: 2, stage: 11 } },
      { dropSeed: 0xf11a_92, rarity: 'unique', source: { planet: 2, stage: 11 } },
    ],
  },
  {
    name: '⑩ 브루저(장갑) 런 — shipType 1 폴드 + 시그니처 18 스택/소멸 aux 폴드',
    seed: 0x8b01,
    config: BRUISER_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0x8b01, BRUISER_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0x8b01_a1, rarity: 'rare', source: { planet: 2, stage: 11 } },
      { dropSeed: 0x8b01_a2, rarity: 'unique', source: { planet: 2, stage: 11 } },
    ],
  },
  {
    name: '⑪ 아크캐스터(과충전) 런 — shipType 2 폴드 + 시그니처 19 정지카운터 aux 폴드',
    seed: 0xa2cc,
    config: ARCCASTER_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0xa2cc, ARCCASTER_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0xa2cc_b1, rarity: 'rare', source: { planet: 2, stage: 11 } },
      { dropSeed: 0xa2cc_b2, rarity: 'unique', source: { planet: 2, stage: 11 } },
    ],
  },
  {
    name: '⑫ 팬텀(은신) 런 — shipType 3 폴드 + 시그니처 20 은신 aux 폴드 + 적 AI 방출 게이트',
    seed: 0x9fa3,
    config: PHANTOM_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0x9fa3, PHANTOM_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0x9fa3_c1, rarity: 'rare', source: { planet: 0, stage: 1 } },
      { dropSeed: 0x9fa3_c2, rarity: 'unique', source: { planet: 0, stage: 1 } },
    ],
  },
];
