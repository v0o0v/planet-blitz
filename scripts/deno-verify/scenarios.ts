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
  SPECIAL_POWERUP_PICK,
  SPECIAL_ACTIVE_SLOT1,
  SPECIAL_ACTIVE_SLOT2,
} from '../../src/sim/world.js';
import { wireIdOf } from '../../data/ships/actives/index.js';
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
import type { Rarity, ItemSource } from '../../src/items/types.js';

/** rollItem 결정론을 교차 검증하기 위한 단일 롤 스펙. */
export interface RollProbe {
  readonly dropSeed: number;
  readonly rarity: Rarity;
  readonly source: ItemSource;
  /** true면 rollItem 대신 rerollAffixes 검증(잠금 인덱스 lockedIndex). */
  readonly reroll?: { readonly rerollSeed: number; readonly lockedIndex?: number };
}

/**
 * `reforgeAffixes` 교차 검증용 재단조 스펙(ADR-0040 정련 공정).
 *
 * `RollProbe.reroll` 은 **단일 고착 · 밴드 0** 축만 밟는다 — 정련 공정이 새로 연
 * **다중 고착**과 **값 밴드** 경로는 그 프로브로는 한 번도 실행되지 않는다(커버리지 0).
 * 밴드는 `rng.int(lo, max)` 의 하한을 바꾸는데, `int` 는 `nextU32() % span` 이라 **span 이
 * 달라지면 나머지 연산 결과가 달라진다** — 두 런타임의 정수 산술이 어긋나면 여기서 갈린다.
 */
export interface ReforgeProbe {
  readonly dropSeed: number;
  readonly rarity: Rarity;
  readonly source: ItemSource;
  readonly reforgeSeed: number;
  /** 누적 고착 인덱스(중복·범위 밖은 구현이 무시한다 — 그 정규화도 함께 검증). */
  readonly fastened?: readonly number[];
  /** 값 품질 밴드 하한 [0,1]. */
  readonly band?: number;
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
  /** 정련 공정(다중 고착·밴드) 교차 검증용 재단조 스펙. 없으면 빈 목록으로 취급. */
  readonly reforges?: readonly ReforgeProbe[];
}

/**
 * 액티브 발동 파일럿(ADR-0041) — `driveDurable` 과 **완전히 같은 스티어링**에 액티브 비트만
 * 얹는다. 두 슬롯을 서로 다른 주기(150/210틱)로 눌러 쿨다운 잔여·버프 잔여가 **겹치는 구간과
 * 안 겹치는 구간이 둘 다** 나오게 한다 — 꼬리 폴드가 런 도중 켜졌다 꺼졌다 하는 형태를 실제로
 * 밟는 것이 이 시나리오의 목적이다(AS-OQ14).
 *
 * ⚠️ 프리즈(파워업 픽) 프레임에는 액티브 비트를 **싣지 않는다** — 컨트롤러 규율과 같다.
 * 실으면 sim 이 그 프레임을 조기 return 으로 버려 입력 로그와 실행이 어긋난 것처럼 보인다.
 */
function driveWithActives(seed: number, config: WorldConfig, maxTicks: number): InputFrame[] {
  const base = driveDurable(seed, config, maxTicks);
  return base.map((f, t) => {
    if ((f.special & SPECIAL_POWERUP_PICK) !== 0) return f;
    let special = f.special;
    if (t > 0 && t % 150 === 0) special |= SPECIAL_ACTIVE_SLOT1;
    if (t > 0 && t % 210 === 0) special |= SPECIAL_ACTIVE_SLOT2;
    return special === f.special ? f : { ...f, special };
  });
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

/**
 * 스트라이커(typeId 0)의 세 축 tier0(각 축 flat 인덱스 시작점)에만 투자한 스킬 벡터(파워업
 * 가중·결정론 필드 자극). ADR-0049: 길이는 `zeroSkillInvest(0)`(30칸), 축 경계는
 * `shipTreeRange` 가 준다 — 하드코딩하지 않는다.
 */
function sampleSkillInvest(): number[] {
  const typeId = 0; // 스트라이커
  const def = shipTypeDef(typeId);
  const v = zeroSkillInvest(typeId);
  const perAxis = [3, 2, 4]; // firepower(축0)·survival(축1)·mobility(축2) tier0
  for (let ti = 0; ti < def.trees.length; ti++) {
    const { start } = shipTreeRange(def, ti);
    v[start] = perAxis[ti] ?? 0;
  }
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
//   ③ (ADR-0049 이전) 스트라이커와 **길이가 다른** `skillInvest`(해츨링 78) → 길이 프리픽스
//      폴드와 파워업 affinity 슬라이스. **ADR-0049 가 이 축을 걷었다** — flat 레이아웃이
//      전 기체 30칸(`[축0 0..9][축1 10..19][축2 20..29]`)으로 통일돼 길이 차이 자체가
//      더 이상 존재하지 않는다. 이 시나리오는 ①②를 위해 남는다(길이 축은 재설계 대상 —
//      골든 재생성 레인 소관, `.omc/handoffs/skill-rebuild-commit2.md`).
// 로드아웃은 리터럴이 아니라 실제 파생 함수를 태워, 클라가 쓰는 경로와 같은 값이 되게 한다.
const HATCHLING_TYPE_ID = 4;

/**
 * 타입 무관 샘플 투자 벡터 — 각 축의 **첫 스킬**에 `ti + 2` 를 찍는다.
 *
 * 길이는 `zeroSkillInvest(typeId)` 가, 축 경계는 `shipTreeRange` 가 준다 — **길이·축 수를
 * 하드코딩하지 않는다.** ADR-0049 로 전 기체가 30칸(3축 × 10스킬) 균일이지만, 이 함수는
 * 그 값에 의존하지 않으므로 향후 레이아웃이 다시 바뀌어도 그대로 쓸 수 있다.
 * ⑦·⑧·⑨ 가 같은 생성기를 공유한다.
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
  loadout: computeLoadoutStats([], undefined, HATCHLING_TYPE_ID).loadout,
  skillInvest: HATCHLING_INVEST,
  shipType: HATCHLING_TYPE_ID,
};

// --- 시나리오 ⑧·⑨: 말로우(완충) · 버블(방막) 런 — M8 시그니처 sim 분기 교차 검증 -------
// ⑦ 과 같은 이유(설계서 §10-8: EF/Deno 가 `shipType` 을 모르면 비스트라이커 침공이 전량
// `defense-mismatch`)로 추가한다. ⑦ 은 해츨링 하나뿐이라 **시그니처 sim 분기가 붙은 다른
// 타입들은 서버 재실행 커버리지가 0** 이었다.
//
// ⚠️ 길이 축은 여기서 자극되지 않는다 — ADR-0049 이후 전 기체(`data/ships/mallow.ts`·
//    `data/ships/bubble.ts` 포함)의 `skillInvest` 가 균일하게 30칸이라 "길이가 다른
//    skillInvest" 축 자체가 더 이상 존재하지 않는다(⑦ 상단 주석 참조).
//    ⑧·⑨ 가 자극하는 것은 ①`shipType` 값 5·6 의 꼬리 폴드 ②시그니처 비트 22·23 의
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
  loadout: computeLoadoutStats([], undefined, MALLOW_TYPE_ID).loadout,
  skillInvest: MALLOW_INVEST,
  shipType: MALLOW_TYPE_ID,
};

const BUBBLE_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2,
  stage: 11,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], undefined, BUBBLE_TYPE_ID).loadout,
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
  loadout: computeLoadoutStats([], undefined, BRUISER_TYPE_ID).loadout,
  skillInvest: BRUISER_INVEST,
  shipType: BRUISER_TYPE_ID,
};

/**
 * 브루저 + **액티브 2개 장착** 런(ADR-0041). `BRUISER_RUN` 과 딱 한 필드(`activeSlots`)만
 * 다르다 — 그 차이가 신규 꼬리 폴드 2건을 켠다. 슬롯 값은 `wireIdOf` 파생이라 저작 순서가
 * 바뀌면 자동으로 따라온다(숫자를 박으면 조용히 다른 스킬을 가리킨다).
 */
const BRUISER_ACTIVE_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2,
  stage: 11,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], undefined, BRUISER_TYPE_ID).loadout,
  skillInvest: BRUISER_INVEST,
  shipType: BRUISER_TYPE_ID,
  activeSlots: [
    wireIdOf('as_bruiser_blade_lo'),
    wireIdOf('as_bruiser_fortify_lo'),
  ],
};

const ARCCASTER_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 2,
  stage: 11,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], undefined, ARCCASTER_TYPE_ID).loadout,
  skillInvest: ARCCASTER_INVEST,
  shipType: ARCCASTER_TYPE_ID,
};

const PHANTOM_RUN: WorldConfig = {
  ...DEFAULT_CONFIG,
  planet: 0,
  stage: 1,
  playerHp: DURABLE,
  loadout: computeLoadoutStats([], undefined, PHANTOM_TYPE_ID).loadout,
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
    // 정련 공정: 밴드 3단계(약불 0 / 중불 0.25 / 강불 0.55)를 **같은 아이템·같은 시드**로
    // 훑어 하한만 달라졌을 때의 정수 나머지 연산이 두 런타임에서 같은지 본다. band 0 은
    // 회귀 기준선(위 `reroll` 프로브와 바이트 동일해야 한다).
    reforges: [
      { dropSeed: 0xd0e5_13, rarity: 'rare', source: { planet: 1, stage: 11 }, reforgeSeed: 0xbeef11, fastened: [1], band: 0 },
      { dropSeed: 0xd0e5_13, rarity: 'rare', source: { planet: 1, stage: 11 }, reforgeSeed: 0xbeef11, fastened: [1], band: 0.25 },
      { dropSeed: 0xd0e5_13, rarity: 'rare', source: { planet: 1, stage: 11 }, reforgeSeed: 0xbeef11, fastened: [1], band: 0.55 },
      { dropSeed: 0xd0e5_13, rarity: 'rare', source: { planet: 1, stage: 11 }, reforgeSeed: 0xbeef11, band: 1 },
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
    // 다중 고착 축: 고착 0 → 1 → 2 → 3 개로 재추첨 풀이 줄어드는 경로와, 정규화(중복·범위
    // 밖·역순 인덱스)를 함께 태운다. 유니크 롤은 `uniqueId` 가 재단조를 타고 살아남는지도 본다.
    reforges: [
      { dropSeed: 0x51a1_53, rarity: 'rare', source: { planet: 2, stage: 21 }, reforgeSeed: 0x5150c0, band: 0.55 },
      { dropSeed: 0x51a1_53, rarity: 'rare', source: { planet: 2, stage: 21 }, reforgeSeed: 0x5150c0, fastened: [0, 2], band: 0.25 },
      { dropSeed: 0x51a1_53, rarity: 'rare', source: { planet: 2, stage: 21 }, reforgeSeed: 0x5150c0, fastened: [2, 0, 0, 99, -1], band: 0.25 },
      { dropSeed: 0x51a1_52, rarity: 'unique', source: { planet: 2, stage: 21 }, reforgeSeed: 0x5150c1, fastened: [0, 1, 2], band: 0.55 },
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
    name: '⑦ 해츨링(비스트라이커 기체) 런 — shipType 폴드 + 시그니처',
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
    // ⚠️ 증인 시드 재선정 2026-07-27(`0xc0a5` → `0xc0bf`, 밸런스 패스 ADR-0037). 적 축 상향
    // (`eliteCount` 밴드0 0 → 1 · `SEGMENTS.killGoal` 합계 80 → 240)으로 압박이 끊기지 않게 돼
    // 구 증인은 연속 무피격 `CUSHION_RECOVER_TICKS`(180)를 한 번도 못 채워 **정산 분기가 0회**가
    // 됐다(`tests/denoFixture.test.ts` 의 ⑧⑨ 공허 런 가드가 그걸 잡았다 — 가드가 제 일을 했다).
    // 재표본(`0xc0a5`..`0xc0e0` 연속 60시드)에서 적립·정산이 **모두** 도는 시드 8개를 찾았고,
    // 처치가 가장 많은 **`0xc0bf`**(적립 2회 · 정산 1회 · aux0 최대 3,496 · 처치 181)를 골랐다.
    // 무대(planet 2 / stage 1)와 단언은 그대로다. `rolls` 의 `dropSeed` 는 런 시드와 무관한
    // 독립 값이라 그대로 둔다.
    name: '⑧ 말로우(완충) 런 — shipType 5 폴드 + 시그니처 22 지연적립/정산 aux 폴드',
    seed: 0xc0bf,
    config: MALLOW_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveDurable(0xc0bf, MALLOW_RUN, MAX_RUN_TICKS),
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
  {
    // **액티브 스킬 꼬리 폴드 2건을 실제로 밟는 유일한 시나리오**(ADR-0041).
    // 위 12건은 전부 `activeSlots` 미탑재라 폴드가 한 번도 실행되지 않는다 — 그게 골든 바이트
    // 불변의 증명이자 동시에 **신규 폴드의 커버리지가 0** 이라는 뜻이다. 여기서만 갈린다:
    //   ① 런타임 정수 4개(쿨다운 2 + 버프 잔여 2) — 발동 직후 양수라 그 구간 매 틱 접힌다
    //   ② 장착 wire id 2칸 — config 스탬프라 런 내내 접힌다
    // 브루저를 고른 이유: `aux0`(장갑 스택)이 읽기·쓰기가 다 있는 정수라 **시그니처 aux 꼬리
    // 폴드까지 같은 런에서 함께** 밟힌다.
    name: '⑬ 브루저 액티브 발동 런 — 신규 꼬리 폴드 ①런타임 4정수 ②장착 wire id',
    seed: 0xac71,
    config: BRUISER_ACTIVE_RUN,
    checkpointInterval: 600,
    buildInputs: () => driveWithActives(0xac71, BRUISER_ACTIVE_RUN, MAX_RUN_TICKS),
    rolls: [
      { dropSeed: 0xac71_d1, rarity: 'rare', source: { planet: 2, stage: 11 } },
      { dropSeed: 0xac71_d2, rarity: 'unique', source: { planet: 2, stage: 11 } },
    ],
  },
];
