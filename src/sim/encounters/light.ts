/**
 * 경량 조우 4종 — 오스카 제단 · 봉인 수호자 · 기록 파편우 · 유령 보급선단
 * (조우 프레임워크 Phase B, ADR-0033. 에코 신호 ADR-0023 의 직계 확장).
 *
 * ## 왜 이 4종은 detour 가 아니라 "인라인/오버레이"인가
 * 보물 격실(treasureVault)만이 플레이어 좌표를 딴 세상으로 워프시키는 신규 제어흐름이고
 * (`stepWorld` 최상단 단일 분기로 격리 — 계획 step 7), 나머지 4종은 **메인 런 위에서 그대로
 * 돈다**. 즉 메인 파이프라인(웨이브·적·탄·충돌·compact)이 평소처럼 전진하고, 이 모듈은 그
 * 위에 오브젝트를 얹거나 보상을 정산할 뿐이다. 그래서 detour 가 짊어진 7개 충돌점(웨이브
 * 정지·모드 좌표계·적 재추적·xp 누수 격리 등)이 여기엔 애초에 없다. 이 파일은 에코와 같은
 * 지위다 — **전 PvE 모드에서 무해**하고, 조우가 안 뽑힌 런에서는 단 한 줄도 실행되지 않는다.
 *
 * ## 그래서 봉인 수호자의 처치는 "격리하지 않는다"
 * 계획 AC7(전투력 불개입)은 **detour 방(房) 안의 처치**에 대한 규율이다 — 딴 세상에서 공짜로
 * 큰 적을 잡아 xp·레벨을 끌어올리는 것을 막으려는 것. 봉인 수호자는 딴 세상이 아니라 **지금
 * 이 아레나에 실제로 소환된 적**이므로 처치가 메인 경로(`compact`: kills++·젬 드랍)를 그대로
 * 타는 것이 정상이고, 억제하면 오히려 "같은 아레나에서 잡은 적인데 어떤 건 세고 어떤 건 안
 * 세는" 비일관이 된다. 이 문단은 리뷰에서 AC7 위반으로 오독되는 것을 막기 위한 명시적 근거다.
 *
 * ## 결정론 규율 (절대 위반 금지)
 *  - **RNG 를 단 한 번도 소비하지 않는다.** 스폰 좌표는 전부 플레이어 기준 고정 오프셋이거나
 *    `cos`/`sin`(math.ts 의 결정론 테일러 구현) 고정 각도이고, 적 소환은 RNG 미소비 경로인
 *    `summonEnemy`(waves.ts)만 쓴다. 드랍 시드는 난수가 아니라 `mixSeed`(murmur3 finalizer)로
 *    `spawnTick`+인덱스에서 파생한다. 이유: `waveRng`/`dropRng`/`eliteRng`/`supplyRng` 를 한 칸
 *    이라도 밀면 조우 발생 런의 웨이브·드랍 시퀀스가 통째로 갈려 기존 PvE 골든과 대조가 불가능
 *    해진다(에코가 `fork` 로 부모를 미전진시킨 것과 같은 동기).
 *  - `Math.random`·`Date.now` 금지. 시간 축은 `state.tick` 뿐이다.
 *  - **{@link EncounterRuntime} 에 신규 필드를 추가하지 않는다.** 그 인터페이스는 `hashWorld`
 *    조건부 꼬리 폴드 계약이라 필드가 늘면 조우 발생 런의 해시 레이아웃이 바뀐다. 유형별
 *    진행 상태는 전부 정수 하나(`rt.aux`)에 비트로 패킹한다(아래 패킹 규약).
 *
 * ## rt.aux 패킹 규약 (정수 1개 — 전 유형 공용, 해시 대상)
 * ```
 *   비트 0..7    카운터 A  — shardRain: 스폰한 파편 수 / ghostConvoy: 스폰한 보급선 수
 *   비트 8..15   카운터 B  — shardRain: 크레딧 정산이 끝난 수집 수 / sealedGuardian: 처치 수
 *   비트 16..17  제단 선택 인덱스(0..3) — oscarAltar 전용
 *   비트 18      플래그 ①  — 개방/스폰 완료(수호자 봉인 개방·선단 스폰)
 *   비트 19      플래그 ②  — 완료 보상 지급됨(2중 지급 방지)
 * ```
 * 카운터는 8비트(0..255)다 — 아래 개수 상수는 전부 그보다 훨씬 작은 플레이스홀더이며, 늘릴
 * 때는 폭이 아니라 **상수를 이 범위 안에서** 조정한다(폭을 바꾸면 해시 의미가 갈린다).
 *
 * ## 순환 의존 주의
 * `world.ts` → `encounter.ts` → 이 파일 순으로 런타임 import 되므로, 이 파일은 `world.ts` 와
 * `encounter.ts` 에서 **타입만** 가져온다(`import type`). 런타임 의존은 leaf 모듈로만 —
 * `entities.ts`(스폰 팩토리)·`waves.ts`(summonEnemy, world 를 타입으로만 참조)·`math.ts`·
 * `data/encounters.ts`(다른 sim 모듈을 절대 import 하지 않는 순수 데이터)·`data/enemies.ts`.
 * echo.ts 상단의 같은 주의문과 동일 규율이다.
 *
 * ## 수치 규율
 * 등급·배율·개수·반경·지속 틱은 **전부 플레이스홀더**다. TODO(밸런스): 출시 직전 일괄 튜닝
 * 대상이고 이 파일은 구조(상태 전이·보상 경로·패킹 의미)만 고정한다(에코 계수 선례).
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { InputFrame } from '../world.js';
import type { EncounterRuntime } from '../encounter.js';
import type { EnemyDef } from '../patterns/types.js';
import { spawnLoot, spawnSupply } from '../entities.js';
import { summonEnemy } from '../waves.js';
import { cos, sin, TWO_PI } from '../math.js';
import { ENEMY_BY_TYPE } from '../../../data/enemies.js';
import {
  ENCOUNTER_TYPE,
  ENCOUNTER_INTERACT_RADIUS,
  SPECIAL_ENCOUNTER_ENTER,
  SPECIAL_ENCOUNTER_DECLINE,
  SPECIAL_ENCOUNTER_ALTAR_PICK,
} from '../../../data/encounters.js';

// ---------------------------------------------------------------------------
// EncounterRuntime.state 코드 (레인 A 계약 — 여기서 재정의하지 않고 이름만 붙인다)
// ---------------------------------------------------------------------------
/** 대기 — 스폰 틱 전. */
const ENC_STATE_IDLE = 0;
/** 출현 — 오브젝트가 떴고 플레이어 입력/개시를 기다린다. */
const ENC_STATE_APPEARED = 1;
/** 진행중 — 개방·스폰이 끝나고 결과를 기다린다. */
const ENC_STATE_ACTIVE = 2;
/** 완료 — 보상까지 지급됨. */
const ENC_STATE_DONE = 3;
/** 거부 — 플레이어가 무시했다. 이후 아무 일도 일어나지 않는다(AC5). */
const ENC_STATE_DECLINED = 4;

// ---------------------------------------------------------------------------
// rt.aux 비트 헬퍼 (위 패킹 규약의 유일한 정본 — 다른 곳에서 시프트를 재작성하지 말 것)
// ---------------------------------------------------------------------------

const AUX_A_SHIFT = 0;
const AUX_B_SHIFT = 8;
const AUX_ALTAR_SHIFT = 16;
const AUX_BYTE_MASK = 0xff;
const AUX_FLAG_OPENED = 1 << 18;
const AUX_FLAG_REWARDED = 1 << 19;

/** 카운터 A 읽기(0..255). */
export function auxCounterA(aux: number): number {
  return (aux >>> AUX_A_SHIFT) & AUX_BYTE_MASK;
}
/** 카운터 B 읽기(0..255). */
export function auxCounterB(aux: number): number {
  return (aux >>> AUX_B_SHIFT) & AUX_BYTE_MASK;
}
/** 제단 선택 인덱스 읽기(0..3). */
export function auxAltarIndex(aux: number): number {
  return (aux >>> AUX_ALTAR_SHIFT) & 0x3;
}
/** 카운터 A 를 v 로 갈아끼운 새 aux(상한 255 로 포화 — 폭 초과가 다른 필드를 오염시키지 않는다). */
function withCounterA(aux: number, v: number): number {
  const c = v > AUX_BYTE_MASK ? AUX_BYTE_MASK : v;
  return ((aux & ~(AUX_BYTE_MASK << AUX_A_SHIFT)) | (c << AUX_A_SHIFT)) >>> 0;
}
/** 카운터 B 를 v 로 갈아끼운 새 aux(상한 255 로 포화). */
function withCounterB(aux: number, v: number): number {
  const c = v > AUX_BYTE_MASK ? AUX_BYTE_MASK : v;
  return ((aux & ~(AUX_BYTE_MASK << AUX_B_SHIFT)) | (c << AUX_B_SHIFT)) >>> 0;
}
/** 제단 선택 인덱스를 실은 새 aux. */
function withAltarIndex(aux: number, index: number): number {
  return ((aux & ~(0x3 << AUX_ALTAR_SHIFT)) | ((index & 0x3) << AUX_ALTAR_SHIFT)) >>> 0;
}

// ---------------------------------------------------------------------------
// 결정론 시드 파생 (RNG 미소비 — drops.ts 의 mix32/bonusLootSeeds 와 동형)
// ---------------------------------------------------------------------------

/**
 * 정수 해시(murmur3 finalizer). `drops.ts` 의 `mix32` 와 같은 구현이지만 그쪽은 export 되지
 * 않아 여기 사본을 둔다 — 이 사본을 없애려고 drops.ts 를 여는 것은 레인 경계 침범이다.
 * 순수·결정론이고 부동소수 누적이 없다.
 */
function mixSeed(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 조우 보상 드랍 시드용 솔트(계약 — 바꾸면 같은 런의 조우 보상 아이템이 통째로 갈린다). */
const SALT_ENCOUNTER_LOOT = 0x45_6e_63_31; // "Enc1"

/**
 * 조우 보상 1건의 드랍 시드. 입력은 `spawnTick`(런 시드에서 파생된 정수)과 유형·인덱스뿐이라
 * **RNG 를 소비하지 않고도** 런마다·유형마다·개수마다 다른 시드가 나온다. 리플레이는 같은
 * 시드에서 같은 spawnTick 이 나오므로 서버 재검증이 그대로 성립한다.
 */
function encounterLootSeed(rt: EncounterRuntime, index: number): number {
  return mixSeed((rt.spawnTick * 31 + rt.type * 7 + index) >>> 0, SALT_ENCOUNTER_LOOT);
}

/**
 * 등급을 강제한 전리품 레코드를 `state.loot` 에 직접 담는다(바닥 `spawnLoot` 이 아니라 직행).
 *
 * **왜 바닥 드랍이 아닌가**: `compact` 의 보스 처치 분기가 이미 같은 이유로 직행한다 — 승리·
 * 사망 틱에 바닥에 깔린 loot 는 다음 `resolveCollisions` 가 돌지 않아 영영 수거되지 않는다.
 * 조우 보상은 "이 조우를 완수한 대가"라 수거 실패로 증발하면 안 되므로 같은 선례를 따른다.
 * (기록 파편우의 파편만은 예외 — 그건 **줍는 행위 자체가 콘텐츠**라 바닥에 깐다.)
 */
function grantLoot(state: WorldState, rt: EncounterRuntime, count: number, rarity: number): void {
  const planet = state.config.planet ?? 0;
  const stage = state.config.stage ?? 1;
  for (let i = 0; i < count; i++) {
    state.loot.push({ seed: encounterLootSeed(rt, i) >>> 0, rarity, planet, stage });
  }
}

// ---------------------------------------------------------------------------
// 플레이스홀더 계수 — 전부 TODO(밸런스): 출시 직전 일괄 튜닝. 구조만 고정.
// ---------------------------------------------------------------------------

// --- ① 오스카 제단 ---
/** 제단 선택지 수(0 즉시 보상 · 1 부스트 · 2 봉인 상자). TODO(밸런스). */
export const ALTAR_CHOICE_COUNT = 3;
/** 선택 0(즉시 보상): 지급 전리품 수. TODO(밸런스). */
export const ALTAR_INSTANT_LOOT_COUNT = 1;
/** 선택 0(즉시 보상): 전리품 등급 코드(0 normal .. 3 unique). TODO(밸런스). */
export const ALTAR_INSTANT_LOOT_RARITY = 2;
/** 선택 0(즉시 보상): 함께 지급되는 크레딧. TODO(밸런스). */
export const ALTAR_INSTANT_CREDITS = 8;
/** 선택 1(부스트): 남은 런의 `catalystMods.drop` 에 곱할 배율. TODO(밸런스). */
export const ALTAR_BOOST_DROP_MULT = 1.5;
/** 선택 2(봉인 상자, 바닥 보장): 지급 전리품 수. TODO(밸런스). */
export const ALTAR_CHEST_LOOT_COUNT = 3;
/** 선택 2(봉인 상자): 전리품 등급 코드 — "바닥 보장"이라 최저 등급 고정. TODO(밸런스). */
export const ALTAR_CHEST_LOOT_RARITY = 0;

// --- ② 봉인 수호자 ---
/**
 * 수호자의 기반 적 정의 인덱스(`ENEMY_BY_TYPE`). 0 = 카르곤 파쇄차. **전용 적 정의를 새로
 * 만들지 않는 것이 의도**다 — `typeIndex` 는 전역 append-only 해시 계약이라 신규 행 추가는
 * 레인 C(data/enemies) 소관이고, 여기서는 기존 행을 배수로 강화하는 것으로 충분하다.
 * TODO(밸런스).
 */
export const GUARDIAN_ENEMY_TYPE = 0;
/** 수호자 HP 배수(정수 반올림). TODO(밸런스). */
export const GUARDIAN_HP_MULT = 12;
/** 수호자 접촉 피해 배수(정수 반올림). TODO(밸런스). */
export const GUARDIAN_DAMAGE_MULT = 2;
/** 수호자 소환 위치 — 플레이어 기준 고정 오프셋(난수 없음). TODO(밸런스). */
export const GUARDIAN_SPAWN_OFFSET_X = 420;
export const GUARDIAN_SPAWN_OFFSET_Y = -260;
/** 수호자 처치 보상 전리품 수. TODO(밸런스). */
export const GUARDIAN_LOOT_COUNT = 1;
/** 수호자 처치 보상 전리품 등급 코드(확정 고희귀). TODO(밸런스). */
export const GUARDIAN_LOOT_RARITY = 3;
/** 수호자 처치 보상 크레딧. TODO(밸런스). */
export const GUARDIAN_CREDITS = 12;
/**
 * 봉인 수호자 마커. 소환된 적 엔티티의 **`aux1`** 에 싣는다.
 *
 * ⚠️ **`ownerId` 가 아닌 이유(중요 — 여기서만 규정)**: `enemy` kind 의 `ownerId` 는 이미
 * `status.ts` 가 **냉기 감속 잔여 틱**으로 재활용 중이다(`applySlow`/`enemyStatusSlowMult`/
 * `tickEnemyStatus`). 냉기 어픽스 탄이 수호자를 한 번만 맞혀도 마커가 감속 틱으로 덮여
 * ① 처치 판정이 마커를 잃어 보상이 영영 안 나가고 ② 반대로 마커 상수가 감속 틱으로 오독돼
 * 수호자가 수천 틱 동안 느려지는 이중 결함이 난다. `enemy` 의 `aux0`/`aux1` 은 PvE 경로에서
 * 아무도 쓰지 않으므로(침공 전용 formation·facilitySpawner 만 사용) 마커 자리로 안전하다.
 */
export const SEALED_GUARDIAN_MARK = 0x5ea1;

// --- ③ 기록 파편우 ---
/** 뿌릴 파편 총 개수(카운터 A 폭 255 이내). TODO(밸런스). */
export const SHARD_RAIN_COUNT = 8;
/** 파편 1개 사이의 간격 틱. TODO(밸런스). */
export const SHARD_RAIN_INTERVAL_TICKS = 30;
/** 파편우 하드 타임아웃(스폰 틱 기준). 플레이어가 전부 무시해도 여기서 종료한다. TODO(밸런스). */
export const SHARD_RAIN_TIMEOUT_TICKS = 1800;
/** 파편 배치 반경(플레이어 기준 고정 원형 패턴). TODO(밸런스). */
export const SHARD_RAIN_RADIUS = 360;
/** 파편 전리품 등급 코드(최저 등급 — 파편은 장비가 아니라 "부스러기"다). TODO(밸런스). */
export const SHARD_RAIN_LOOT_RARITY = 0;
/** 파편 1개 수집당 크레딧. TODO(밸런스). */
export const SHARD_RAIN_CREDITS_PER = 2;
/**
 * 파편 마커. **바닥 `loot` 엔티티의 `ownerId`** 에 싣는다. `loot` kind 는 `damage`(드랍 시드)와
 * `enemyType`(등급)만 쓰고 `ownerId` 는 어디서도 읽지 않으므로 안전하다(수호자와 달리 냉기
 * 상태이상은 `enemy` kind 에만 걸린다 — world.ts 의 `t.kind === 'enemy'` 게이트).
 */
export const SHARD_RAIN_MARK = 0x5ba1;

// --- ④ 유령 보급선단 ---
/** 편대 규모(카운터 A 폭 255 이내). TODO(밸런스). */
export const GHOST_CONVOY_COUNT = 4;
/** 보급선 1기 HP. TODO(밸런스). */
export const GHOST_CONVOY_HP = 120;
/** 보급선 체류 틱(만료 = 이탈, 기존 supply 경로가 보상 없이 despawn 한다). TODO(밸런스). */
export const GHOST_CONVOY_LIFE_TICKS = 900;
/** 보급선 횡단 속도(units/second — 기존 supply 와 같은 축). TODO(밸런스). */
export const GHOST_CONVOY_SPEED = 220;
/** 편대 스폰 X 오프셋(플레이어 기준 — 오른쪽에서 등장해 왼쪽으로 흐른다). TODO(밸런스). */
export const GHOST_CONVOY_SPAWN_X = 900;
/** 편대원 간 Y 간격(사다리꼴이 아니라 단순 종대 — 고정 패턴). TODO(밸런스). */
export const GHOST_CONVOY_SPACING_Y = 180;
/** 편대 X 계단 오프셋(종대가 일직선으로 겹쳐 보이지 않게). TODO(밸런스). */
export const GHOST_CONVOY_STAGGER_X = 140;
/** 선단 소멸(전멸/이탈) 시 보너스 크레딧. TODO(밸런스). */
export const GHOST_CONVOY_BONUS_CREDITS = 10;
/**
 * 선단 마커. **`supply` 엔티티의 `ownerId`** 에 싣는다. `supply` 는 `vx`/`life`/`hp` 만 쓰고
 * `ownerId` 를 읽는 경로가 없다(상태이상도 `enemy` 전용). 정규 보급 습격은 `ownerId=0` 이라
 * 이 마커와 절대 겹치지 않는다 — 즉 "선단 소속"을 정확히 가려낸다.
 */
export const GHOST_CONVOY_MARK = 0x9c07;

// ---------------------------------------------------------------------------
// 공통 헬퍼
// ---------------------------------------------------------------------------

/** `rt.entityId` 가 가리키는 살아 있는 조우 오브젝트(없으면 undefined). */
function encounterObject(state: WorldState, rt: EncounterRuntime): Entity | undefined {
  if (rt.entityId === 0) return undefined;
  for (const e of state.entities) {
    if (e.id === rt.entityId && !e.dead) return e;
  }
  return undefined;
}

/**
 * 플레이어가 상호작용 반경 안에 있는가. 오브젝트가 없는 유형(인라인 — 파편우·선단)은 애초에
 * 근접 판정 대상이 아니므로 **true** 를 돌려준다(입력 게이트만 남는다).
 */
function withinInteract(player: Entity, obj: Entity | undefined): boolean {
  if (obj === undefined) return true;
  const dx = player.x - obj.x;
  const dy = player.y - obj.y;
  const r = ENCOUNTER_INTERACT_RADIUS;
  return dx * dx + dy * dy <= r * r;
}

/** 이 마커를 단 살아 있는 엔티티 수(kind 로 한 번 더 좁혀 오탐을 막는다). */
function countMarked(state: WorldState, kind: Entity['kind'], mark: number, field: 'ownerId' | 'aux1'): number {
  let n = 0;
  for (const e of state.entities) {
    if (e.dead || e.kind !== kind) continue;
    if ((field === 'ownerId' ? e.ownerId : e.aux1) === mark) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// ① 오스카 제단 — 3택 도박
// ---------------------------------------------------------------------------

/**
 * 제단 한 틱. 출현 상태에서 플레이어가 반경 안에 있고 `SPECIAL_ENCOUNTER_ALTAR_PICK` 이
 * 실린 프레임에만 선택이 확정된다.
 *
 * ⚠️ **인덱스 범위 밖이면 선택을 소비하지 않고 pending 을 유지한다** — `stepWorld` 의 레벨업
 * 3택이 `idxOffered < length` 가드로 같은 규율을 지킨다. 잘못된 프레임 하나로 조우가 조용히
 * 사라지면 플레이어는 원인을 알 수 없고, 서버 재검증도 "왜 보상이 없나"를 설명할 수 없다.
 */
function stepAltar(state: WorldState, player: Entity, rt: EncounterRuntime, input: InputFrame): void {
  if (rt.state !== ENC_STATE_APPEARED) return;
  if ((input.special & SPECIAL_ENCOUNTER_ALTAR_PICK) === 0) return;
  const altar = encounterObject(state, rt);
  if (!withinInteract(player, altar)) return; // 멀리서 누른 프레임 — 소비하지 않는다.
  const index = (input.special >>> 6) & 0x3;
  if (index >= ALTAR_CHOICE_COUNT) return; // 범위 밖 — pending 유지(위 주석 근거).

  if (index === 0) {
    // (a) 즉시 보상 — 등급 강제 전리품 + 크레딧. 둘 다 정산 경제 축이라 전투력 무개입.
    grantLoot(state, rt, ALTAR_INSTANT_LOOT_COUNT, ALTAR_INSTANT_LOOT_RARITY);
    state.resources += ALTAR_INSTANT_CREDITS;
  } else if (index === 1) {
    // (b) 부스트 — 남은 런의 드랍량 배율을 올린다. `CatalystMods` 는 readonly 필드 번들이라
    // 필드를 직접 쓰지 않고 **번들을 통째로 교체**한다(스프레드). `catalystMods` 는 config 의
    // 순수 파생이라 `hashWorld` 가 접지 않지만, 이 조우의 선택 인덱스는 `rt.aux` 로 접히고
    // 배율의 결과(추가 전리품)는 `state.loot` 로 접히므로 서버 리플레이가 그대로 재현한다.
    state.catalystMods = {
      ...state.catalystMods,
      drop: state.catalystMods.drop * ALTAR_BOOST_DROP_MULT,
    };
  } else {
    // (c) 봉인 상자 — 최저 등급 다수. "바닥 보장"이라 기대값은 낮되 빈손이 없다.
    grantLoot(state, rt, ALTAR_CHEST_LOOT_COUNT, ALTAR_CHEST_LOOT_RARITY);
  }

  rt.aux = withAltarIndex(rt.aux, index) | AUX_FLAG_REWARDED;
  rt.state = ENC_STATE_DONE;
  if (altar !== undefined) altar.dead = true; // compact 가 다음에 수거한다.
}

// ---------------------------------------------------------------------------
// ② 봉인 수호자 — 라이브 오버레이 미니 보스
// ---------------------------------------------------------------------------

/**
 * 수호자 한 틱. 개방(출현→진행중)과 처치 판정(진행중→완료) 두 단계뿐이다.
 *
 * 처치 판정은 **마커 엔티티 생존 스캔 파생**이다(계획 AC9 의 리더 게이트와 같은 규율) —
 * "죽었다"는 신규 폴드 필드를 만들지 않고, 마커를 단 적이 `state.entities` 에서 사라졌다는
 * 사실로부터 판정한다. 사라지는 경로는 `compact`(hp<=0 → dead 수거) 하나뿐이라 창발이 보존된다.
 */
function stepGuardian(state: WorldState, player: Entity, rt: EncounterRuntime, input: InputFrame): void {
  if (rt.state === ENC_STATE_APPEARED) {
    if ((input.special & SPECIAL_ENCOUNTER_ENTER) === 0) return;
    const seal = encounterObject(state, rt);
    if (!withinInteract(player, seal)) return;
    const def: EnemyDef | undefined = ENEMY_BY_TYPE[GUARDIAN_ENEMY_TYPE];
    if (def === undefined) return; // 카탈로그가 비면 개방하지 않는다(방어 — 정상 경로엔 없다).
    // RNG 미소비 소환(summonEnemy). `spawnEnemy` 는 첫 발사 쿨다운을 waveRng 로 흔들어
    // 웨이브 스트림을 밀기 때문에 여기서 절대 쓰지 않는다.
    const g = summonEnemy(state, def, player.x + GUARDIAN_SPAWN_OFFSET_X, player.y + GUARDIAN_SPAWN_OFFSET_Y);
    g.hp = Math.round(g.hp * GUARDIAN_HP_MULT);
    g.maxHp = g.hp;
    g.damage = Math.round(g.damage * GUARDIAN_DAMAGE_MULT);
    g.aux1 = SEALED_GUARDIAN_MARK; // ownerId 가 아닌 이유는 상수 주석 참조(냉기 충돌).
    rt.aux |= AUX_FLAG_OPENED;
    rt.state = ENC_STATE_ACTIVE;
    if (seal !== undefined) seal.dead = true;
    return; // 개방 틱에는 스캔하지 않는다(방금 세운 수호자가 살아 있는 게 당연하다).
  }
  if (rt.state !== ENC_STATE_ACTIVE) return;
  if (countMarked(state, 'enemy', SEALED_GUARDIAN_MARK, 'aux1') > 0) return;
  // 처치됨 — 등급 강제 전리품 + 크레딧. 처치 자체의 kills++·젬은 `compact` 가 이미 정상
  // 경로로 처리했다(파일 상단 "격리하지 않는다" 문단의 근거).
  grantLoot(state, rt, GUARDIAN_LOOT_COUNT, GUARDIAN_LOOT_RARITY);
  state.resources += GUARDIAN_CREDITS;
  rt.aux = withCounterB(rt.aux, auxCounterB(rt.aux) + 1) | AUX_FLAG_REWARDED;
  rt.state = ENC_STATE_DONE;
}

// ---------------------------------------------------------------------------
// ③ 기록 파편우 — 인라인 파편 스폰
// ---------------------------------------------------------------------------

/**
 * 파편우 한 틱. 스폰 틱부터 `SHARD_RAIN_INTERVAL_TICKS` 간격으로 파편을 하나씩 뿌리고, 수집된
 * 만큼 크레딧을 정산한다.
 *
 * ⚠️ **파편은 절대 `spawnGem` 이 아니다.** 젬은 `collectGem` 이 xp 로 환산해 레벨업·전투력을
 * 끌어올린다 — 조우가 전투력에 개입하지 않는다는 ADR-0033 대전제가 그 한 줄로 무너진다.
 * 그래서 파편은 최저 등급 `loot` 엔티티다(정산 경제 축).
 *
 * 수집 정산은 "스폰 수 − 생존 수" 파생이다. 카운터 A(스폰)와 B(정산 완료)의 차이만큼만
 * 크레딧을 주므로 매 틱 재계산해도 2중 지급이 없다(멱등).
 */
function stepShardRain(state: WorldState, player: Entity, rt: EncounterRuntime): void {
  if (rt.state === ENC_STATE_APPEARED) rt.state = ENC_STATE_ACTIVE; // 인라인 — opt-in 없이 개시.
  if (rt.state !== ENC_STATE_ACTIVE) return;

  // 1) 스폰: 고정 원형 패턴(각도 = i/총개수, 결정론 cos/sin). 난수 좌표 금지.
  const spawned = auxCounterA(rt.aux);
  if (spawned < SHARD_RAIN_COUNT && state.tick >= rt.spawnTick + spawned * SHARD_RAIN_INTERVAL_TICKS) {
    const ang = (spawned * TWO_PI) / SHARD_RAIN_COUNT;
    const shard = spawnLoot(
      state,
      player.x + cos(ang) * SHARD_RAIN_RADIUS,
      player.y + sin(ang) * SHARD_RAIN_RADIUS,
      encounterLootSeed(rt, spawned),
      SHARD_RAIN_LOOT_RARITY,
    );
    shard.ownerId = SHARD_RAIN_MARK;
    rt.aux = withCounterA(rt.aux, spawned + 1);
  }

  // 2) 수집 정산: 사라진 파편 = 수집된 파편(loot 는 수명·컬링 경로가 없어 `collectLoot` 로만
  //    사라진다 — isGimmick 목록에 loot 가 없다는 사실이 이 파생의 근거다).
  const alive = countMarked(state, 'loot', SHARD_RAIN_MARK, 'ownerId');
  const collected = auxCounterA(rt.aux) - alive;
  const settled = auxCounterB(rt.aux);
  if (collected > settled) {
    state.resources += (collected - settled) * SHARD_RAIN_CREDITS_PER;
    rt.aux = withCounterB(rt.aux, collected);
  }

  // 3) 종료: 전부 뿌렸고 남은 파편이 없거나, 하드 타임아웃(전부 무시한 플레이어)에 걸리면 완료.
  const allSpawned = auxCounterA(rt.aux) >= SHARD_RAIN_COUNT;
  const timedOut = state.tick >= rt.spawnTick + SHARD_RAIN_TIMEOUT_TICKS;
  if ((allSpawned && alive === 0) || timedOut) rt.state = ENC_STATE_DONE;
}

// ---------------------------------------------------------------------------
// ④ 유령 보급선단 — 인라인 편대
// ---------------------------------------------------------------------------

/**
 * 선단 한 틱. 개시 시 보급선 편대를 고정 오프셋에 한 번에 스폰하고(RNG 미소비 —
 * `maybeSpawnSupply` 는 `supplyRng` 로 진입 방향·Y 를 흔들지만 여기선 쓰지 않는다), 이후
 * 편대가 전멸(격추)하거나 이탈(수명 만료·화면 밖)할 때까지 기다린다.
 *
 * 격추 보상은 기존 `compact` 의 supply 분기가 그대로 처리한다(크레딧 milli 캐리 + 보상 젬).
 * 이 함수는 그 위에 **선단 소멸 보너스**만 얹는다.
 */
function stepGhostConvoy(state: WorldState, player: Entity, rt: EncounterRuntime): void {
  if (rt.state === ENC_STATE_APPEARED) {
    for (let i = 0; i < GHOST_CONVOY_COUNT; i++) {
      const ship = spawnSupply(
        state,
        player.x + GHOST_CONVOY_SPAWN_X + i * GHOST_CONVOY_STAGGER_X,
        player.y + (i - (GHOST_CONVOY_COUNT - 1) / 2) * GHOST_CONVOY_SPACING_Y,
        -GHOST_CONVOY_SPEED, // 오른쪽 → 왼쪽으로 횡단(부호 고정 — 난수 방향 없음).
        GHOST_CONVOY_HP,
        GHOST_CONVOY_LIFE_TICKS,
      );
      ship.ownerId = GHOST_CONVOY_MARK;
    }
    rt.aux = withCounterA(rt.aux, GHOST_CONVOY_COUNT) | AUX_FLAG_OPENED;
    rt.state = ENC_STATE_ACTIVE;
    return; // 스폰 틱에는 소멸 판정을 하지 않는다(방금 띄운 편대가 살아 있는 게 당연하다).
  }
  if (rt.state !== ENC_STATE_ACTIVE) return;
  if (countMarked(state, 'supply', GHOST_CONVOY_MARK, 'ownerId') > 0) return;
  state.resources += GHOST_CONVOY_BONUS_CREDITS;
  rt.aux |= AUX_FLAG_REWARDED;
  rt.state = ENC_STATE_DONE;
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

/**
 * 경량 조우 한 틱 — `src/sim/encounter.ts` 의 `stepEncounter` 가 부르는 **유일한** 진입점.
 *
 * 디스패치 전에 거부(`SPECIAL_ENCOUNTER_DECLINE`)를 공통 처리한다: 출현 상태에서 거부하면
 * `state = 4` 로 끝나고 오브젝트도 치운다 → **그 이후 이 함수는 어떤 상태도 건드리지 않으므로
 * 조우 미발생 런과 결과가 완전히 같다**(AC5). 이미 개시된(진행중) 조우는 되돌릴 수 없으므로
 * 거부를 받지 않는다 — 소환된 수호자를 입력 한 번으로 지우면 그게 곧 무적 탈출이 된다.
 *
 * 보물 격실(`treasureVault`)은 detour 유형이라 레인 A 의 `stepDetour` 소관이고 여기선 no-op 이다.
 */
export function stepLightEncounter(
  state: WorldState,
  player: Entity,
  rt: EncounterRuntime,
  input: InputFrame,
): void {
  if (rt.state === ENC_STATE_IDLE || rt.state === ENC_STATE_DONE || rt.state === ENC_STATE_DECLINED) {
    return;
  }
  if (rt.type === ENCOUNTER_TYPE.treasureVault) return;

  if (rt.state === ENC_STATE_APPEARED && (input.special & SPECIAL_ENCOUNTER_DECLINE) !== 0) {
    const obj = encounterObject(state, rt);
    if (obj !== undefined) obj.dead = true;
    rt.state = ENC_STATE_DECLINED;
    return;
  }

  switch (rt.type) {
    case ENCOUNTER_TYPE.oscarAltar:
      stepAltar(state, player, rt, input);
      return;
    case ENCOUNTER_TYPE.sealedGuardian:
      stepGuardian(state, player, rt, input);
      return;
    case ENCOUNTER_TYPE.shardRain:
      stepShardRain(state, player, rt);
      return;
    case ENCOUNTER_TYPE.ghostConvoy:
      stepGhostConvoy(state, player, rt);
      return;
    default:
      return; // 미지의 유형 — 조용히 무시(카탈로그가 앞서 나가도 sim 이 깨지지 않는다).
  }
}

// ---------------------------------------------------------------------------
// RunResult 리더 헬퍼 (정산이 소비 — 이 파일은 순수 리더만 제공)
// ---------------------------------------------------------------------------

/**
 * 이번 런에 **기록 파편을 실제로 수집했는가**(정산 `RunResult.echoStabilized` 와 같은 축).
 *
 * `echo.ts` 의 `echoStabilizedOf` 가 정본 선례다 — 그쪽은 `echoRuntime.state===2` 라는 sim
 * 사실에서 파생하고, 정산(`src/save/settlement.ts`)이 그 불리언을 받아 `RECORD_SHARDS` 순서로
 * 첫 미수집 파편 1개를 담는다. **신규 보상 시스템을 만들지 않고 그 경로를 그대로 재사용**한다:
 * 파편우가 완료됐고 실제로 하나 이상 수집됐을 때만 true.
 *
 * ⚠️ 인자를 `WorldState` 가 아니라 런타임 객체로 받는 것은 의도적이다 — `WorldState` 의 조우
 * 런타임 필드는 레인 A 소유라, 필드명에 결합하면 이 리더가 레인 경계를 넘는다. 호출부는
 * `encounterShardCollectedOf(state.encounterRuntime)` 로 쓴다.
 */
export function encounterShardCollectedOf(rt: EncounterRuntime | undefined): boolean {
  if (rt === undefined) return false;
  return (
    rt.type === ENCOUNTER_TYPE.shardRain &&
    rt.state === ENC_STATE_DONE &&
    auxCounterB(rt.aux) > 0
  );
}
