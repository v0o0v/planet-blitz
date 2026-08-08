/**
 * 촉매 **공명 12**(태그 6종 × 약/강) — ADR-0052 §태그 & 공명.
 *
 * ## 왜 여기만 `CARD_*` id 가 없는가
 * 공명은 카드가 아니다 — 실린 3장의 **태그 집계 결과**라 id 가 없고, 정본
 * (`src/data/catalystResonance.ts`)이 `태그:단` 키로 관리한다(`RESONANCES`). 그래서 이 모듈은
 * id 상수 대신 **슬러그 상수**를 둔다. 한 런에 발동하는 공명은 **하나**(강공명 우선)다.
 *
 * ## 왜 파일을 따로 가르는가
 * 그룹 모듈과 같은 사유다 — 병렬 레인의 머지 충돌을 막는다. 공명은 12종이 서로 배타라
 * 한 레인이 통째로 소유해도 충돌이 없다.
 *
 * ⚠️ `world.js` 는 **type-only** import 만(순환 금지).
 * ⚠️ 공명 분기는 카드 소지(`carries`)가 아니라 **발동 공명 판정**을 게이트로 쓴다 —
 * {@link activeResonance} 가 정본이고 그것은 `resolveResonance` 한 곳만 부른다. 여기서 태그를
 * 다시 세지 마라(네 곳이 각자 판정하면 갈린다).
 *
 * ## ⭐ 이 모듈이 지키는 공통 규율 (어기면 무촉매 런·재실행이 갈린다)
 *  1. **RNG 를 한 칸도 소비하지 않는다.** 새 난수가 필요한 자리(선불 전리품 시드·함몰 열매
 *     시드)는 전부 {@link mix32} 순수 파생이다(헌장 §공통-B(a) 기본값).
 *  2. **소환은 `spawnLoot`(RNG 미소비)뿐이다.** 적을 낳지 않으므로 `spawnEnemy`/`summonEnemy`
 *     둘 다 안 쓴다.
 *  3. **새 `WorldState` 칸이 0 개다.** 상태는 슬롯 20·21(공명 구역)과 `catalystMarks` 접근자,
 *     그리고 **기존 필드 재해석**(적탄 `aux0`·전리품 `enemyType`/`timer`/`radius` ·
 *     `state.loot[0].rarity` 예약값)뿐이다. `player.aux0/aux1/targetX` · 적 `aux1` ·
 *     보스 `aux0` 는 한 번도 안 만진다.
 *  4. **모듈 스코프에 틱을 넘기는 상태를 두지 않는다.** 유일한 모듈 스크래치
 *     {@link CHAIN_SEEN} 은 **한 호출 안에서만** 살고 진입할 때 비운다 — `determinismGate` 가
 *     두 월드를 교대로 `stepWorld` 하므로 틱을 넘기는 스크래치는 서로를 오염시킨다.
 *
 * ## ⭐ 어느 앵커에서 무엇을 하는가 (자리 선택의 근거)
 *  - **`resonanceOnCatalystHazards`** 는 `stepCatalystHazards` 안, **격자 삽입 루프 직후**다 —
 *    ①`state.grid` 가 이번 틱 좌표로 완성돼 있고 ②아직 아무 hp 도 안 깎였다. 격자 질의가
 *    필요한 넷(오폭·반사·덫·결실 강등)이 전부 여기 선다. `resonanceOnTick` 은 `resolveCollisions`
 *    **앞**이라 격자가 한 틱 낡아 있다.
 *  - **`resonanceOnTick`** 은 격자가 필요 없는 것(마크 감쇠·인력·벼름 타이머·마모·함몰·선불·
 *    청산 봉인)을 진다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { spawnLoot } from '../entities.js';
import { circlesOverlap } from '../collision.js';
import { readMark, writeMark } from '../catalystMarks.js';
import {
  ErosionWeakSlot,
  PrecisionStrongSlot,
  PrecisionWeakSlot,
  BulwarkSlot,
  readCatalystSlot,
  writeCatalystSlot,
} from '../catalystSlots.js';
import { CATALYST_LOOT_NEUTRAL, CATALYST_SEED_MARK, CATALYST_TREE_MARK } from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { CATALYST_FX, notifyCatalystFx, creditCatalyst, missCatalyst } from './fx.js';
import { resolveResonance, resonanceVoidOnPlanet } from '../../data/catalystResonance.js';
import type { ResonanceDef } from '../../data/catalystResonance.js';
import { catalystById } from '../../data/catalysts.js';
import { SEALED_RARITY_CODE } from '../../items/types.js';
import { SEGMENTS } from '../../../data/waves.js';

/** 점화 약 — slug `ember`. */
export const RESO_EMBER = 'ember';
/** 점화 강 — slug `reverberation`. */
export const RESO_REVERBERATION = 'reverberation';
/** 밀도 약 — slug `attraction`. */
export const RESO_ATTRACTION = 'attraction';
/** 밀도 강 — slug `crossfire`. */
export const RESO_CROSSFIRE = 'crossfire';
/** 정밀 약 — slug `whetting`. */
export const RESO_WHETTING = 'whetting';
/** 정밀 강 — slug `deflection`. */
export const RESO_DEFLECTION = 'deflection';
/** 수확 약 — slug `snare`. */
export const RESO_SNARE = 'snare';
/** 수확 강 — slug `fruition`. */
export const RESO_FRUITION = 'fruition';
/** 도박 약 — slug `advance`. */
export const RESO_ADVANCE = 'advance';
/** 도박 강 — slug `settlement`. */
export const RESO_SETTLEMENT = 'settlement';
/** 침식 약 — slug `abrasion`. */
export const RESO_ABRASION = 'abrasion';
/** 침식 강 — slug `subsidence`. */
export const RESO_SUBSIDENCE = 'subsidence';

// ---------------------------------------------------------------------------
// 발동 판정 — **`resolveResonance` 한 곳만 부른다**
// ---------------------------------------------------------------------------

/**
 * 조합 배열 → 발동 공명의 **메모**. `resolveResonance` 는 호출마다 `Map` 을 새로 만드는데
 * 이 모듈은 적마다·탄마다 도는 앵커에서 그것을 물어야 한다.
 *
 * ⚠️ **키는 `state.config.catalysts` 배열 참조**다. 그 배열은 런 시작에 고정되고
 * `resolveResonance` 는 순수 함수이므로, 같은 참조에 같은 답이 나오는 것이 보장된다 —
 * 두 월드를 교대로 돌려도(`determinismGate`) 서로 다른 배열이면 서로 다른 칸을 쓴다.
 * `WeakMap` 이라 월드가 사라지면 같이 사라진다(누수 없음).
 */
const RESO_MEMO = new WeakMap<readonly number[], ResonanceDef | null>();

/**
 * 이 런에서 **실제로 발동한 공명 하나**(없으면 null). 공명 분기의 **유일 게이트**다.
 *
 * 무촉매 런은 `config.catalysts` 가 없어 첫 줄에서 끝난다(바이트 불변).
 */
export function activeResonance(state: WorldState): ResonanceDef | null {
  const ids = state.config.catalysts;
  if (ids === undefined || ids.length === 0) return null;
  const hit = RESO_MEMO.get(ids);
  if (hit !== undefined) return hit;
  const r = resolveResonance(ids);
  RESO_MEMO.set(ids, r);
  return r;
}

/** 지금 발동한 공명이 `slug` 인가. 12종 분기가 전부 이 한 줄을 통과한다. */
function isReso(state: WorldState, slug: string): boolean {
  const r = activeResonance(state);
  return r !== null && r.slug === slug;
}

/**
 * 공명 사건의 **HUD 귀속 대상 카드 id**(없으면 `-1`).
 *
 * ## 왜 카드 id 로 내는가 — 공명에는 id 가 없다
 * `notifyCatalystFx` 의 첫 칸은 **촉매 id** 이고, HUD 는 그 값으로 3칸 슬롯 중 하나를 찾아
 * 번쩍인다(`render/catalystFx.ts` §`catalystFxFlashesSlot`). 공명 전용 번호를 새로 만들면
 * ①어느 슬롯도 안 번쩍여 헌장 §귀속 규율 1(*"어느 카드인지가 화면 한 곳에서 항상 읽힌다"*)이
 * 깨지고 ②정산 명세(`catalystContributionsOf`)에 **카드가 아닌 id 행**이 섞여 화면이 그것을
 * 촉매로 오독한다.
 *
 * ## 왜 **구성원 하나**인가 (전원 아님)
 * 구성원 전원에게 통지하면 슬롯 셋이 같이 번쩍여 "공명이다"가 더 선명해지지만, 그 순간
 * 정산의 **발동 횟수가 사건 하나당 3 으로 부풀어** 카드별 기여가 거짓이 된다(`fired` 는
 * `trigger` 통지 수와 1:1 이다). 회계가 거짓이 되는 쪽이 훨씬 비싸므로 **한 장**만 고른다.
 *
 * 고르는 규칙은 **공명 태그를 실제로 단 구성원 중 가장 작은 id** 다 — 조합 배열의 순서가
 * 아니라 id 순이라 같은 3장이면 어느 칸에 꽂혀도 같은 답이 나온다(슬롯 배정이 해시를 바꾸면
 * 안 된다는 `catalystSlots.ts` §배정 규약과 같은 결).
 *
 * ⚠️ **남은 간극**: 이 방식으로도 "카드가 아니라 공명이 낸 사건"이라는 사실 자체는 화면에
 * 안 실린다. 전용 표시를 내려면 `CatalystFxEvent` 에 칸이 하나 더 필요하고 그것은 이 레인의
 * 소관 밖이라 **보고로 남긴다**.
 */
function resoFxId(state: WorldState): number {
  const r = activeResonance(state);
  const ids = state.config.catalysts;
  if (r === null || ids === undefined) return -1;
  let best = -1;
  for (const id of ids) {
    const def = catalystById(id);
    if (def === undefined) continue;
    if (!def.tags.includes(r.tag)) continue;
    if (best < 0 || id < best) best = id;
  }
  return best;
}

/** 공명 발동 통지 한 줄. 귀속 카드가 없으면(있을 수 없다) 조용히 넘어간다. */
function fx(state: WorldState, kind: 0 | 1 | 2 | 3, x: number, y: number): void {
  const id = resoFxId(state);
  if (id < 0) return;
  notifyCatalystFx(state, id, kind, x, y);
}

/**
 * `catalyst/shared.ts` 의 `mix32` 와 **같은 형태**의 RNG 미소비 순수 파생(헌장 §공통-B(a)).
 * 사본을 두는 것이 계약이다 — 값이 아니라 형태를 따른다.
 */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 이 월드의 플레이어. 공명 자해(되울림)가 유일한 소비자라 **사슬이 났을 때만** 돈다. */
function findPlayer(state: WorldState): Entity | undefined {
  for (const e of state.entities) if (e.kind === 'player') return e;
  return undefined;
}

// ---------------------------------------------------------------------------
// 공용 수치 (// BALANCE)
// ---------------------------------------------------------------------------

/** 60틱 = 1초. */
const SEC = 60;

/**
 * 적 단위 **공명 카운트다운**(`catalystMarks` 의 `resoTicks`)의 눈금. 한 칸 = 10틱.
 *
 * 한 런에 공명은 하나뿐이라 이 칸을 **불씨(밀려남)와 덫(붙잡힘)이 공유**한다 — 둘이 동시에
 * 뜨는 조합이 존재하지 않으므로 의미가 섞이지 않는다. 감쇠는 `tick % RESO_MARK_UNIT === 0`
 * 인 틱에 1씩이라 실지속은 눈금 하나만큼(≤10틱) 짧을 수 있다.
 */
const RESO_MARK_UNIT = 10;
/** 1초에 해당하는 눈금 수. */
const RESO_MARK_1S = SEC / RESO_MARK_UNIT;

// 점화 약 '불씨' // BALANCE
const EMBER_RADIUS = 240;
const EMBER_PUSH = 160;
/** 밀려난 적이 **받는** 피해 배율. §B 인 이유가 이 임의 배율이다(설계 정본이 그렇게 뒀다). */
const EMBER_DAMAGE_TAKEN = 0.6;

// 점화 강 '되울림' // BALANCE
const REVERB_RADIUS = 260;
/** 사슬의 **마지막 하나**가 플레이어에게 꽂는 피해의 비율. */
const REVERB_SELF_HARM = 0.5;
/** 한 사슬의 최대 전파 수 — 무제한 규칙의 **종료 보장은 방문 집합**이고 이것은 2차 안전망이다. */
const REVERB_HARD_CAP = 512;

// 밀도 약 '인력' // BALANCE
const ATTRACT_MIN_ENEMIES = 15;
const ATTRACT_RADIUS = 520;
const ATTRACT_PULL = 6;
/** 뭉친 적이 피격 후 **되돌려받는** hp 비율(= 체감 방어력). 치명타는 절대 막지 않는다. */
const ATTRACT_TOUGHNESS = 0.3;
const ATTRACT_FX_INTERVAL = 60;

// 정밀 약 '벼름' // BALANCE
const WHET_NOHIT_TICKS = 10 * SEC;
const WHET_PIERCE = 6;
const WHET_SLOW_TICKS = 3 * SEC;

// 정밀 강 '반사' // BALANCE
/** 몇 발마다 하나를 튕기는가(결정론적 카운터 — RNG 아님). */
const DEFLECT_EVERY = 3;
/** 안 튕긴 탄의 피해 배율. */
const DEFLECT_NONREFLECT_DAMAGE = 2;
/** 적탄 `aux0` 판별값 — 0 미처리 / 1 미반사(피해 2배 적용됨) / 2 반사됨. */
const DEFLECT_MARK_KEPT = 1;
const DEFLECT_MARK_REFLECTED = 2;

// 수확 약 '덫' // BALANCE
/** `spawnLoot` 이 세우는 전리품 반경(`entities.ts`). 덫이 잠글 때 0 으로 낮췄다가 되돌린다. */
const LOOT_PICKUP_RADIUS = 44;

// 수확 강 '결실' // BALANCE
const FRUITION_RADIUS = 200;
const RARITY_MAX = 3;
/** 같은 전리품이 연속으로 강등되지 않게 하는 냉각(전리품 `timer` 재해석). */
const FRUITION_DEGRADE_COOLDOWN = SEC;

// 도박 약 '선불' // BALANCE
/** 선불 전리품이 떨어지는 거리 — 플레이어 발밑이 아니라 **가지러 가야 하는** 자리다. */
const ADVANCE_OFFSET = 900;
const ADVANCE_SALT = 0xadd0_1c3e;

// 도박 강 '청산' // BALANCE
/**
 * 봉인 등급의 **예약값**. `RARITY_BY_CODE` 는 0..3 뿐이라 이 값은 어느 등급도 아니다
 * (`items/types.ts` §"NEVER renumber" 구간 밖). 신규 칸 0 — `replay.ts` 가 `hashU32(rarity)`
 * 로 접으므로 예약값도 결정론적이다.
 *
 * ⚠️ **값의 정본은 `items/types.ts` 의 `SEALED_RARITY_CODE`** 다 — 이 규칙의 마지막 조항
 * (*"지면 그것만 사라진다"*)을 집행하는 것은 정산(`save/settlement.ts`)인데, 그쪽은 sim 을
 * import 할 수 없어 코드 표를 소유한 리프가 유일한 공통 조상이다. 여기 이름은 그 별칭이다.
 */
export const SEALED_RARITY = SEALED_RARITY_CODE;
/** 보스를 처치했을 때 봉인이 열리는 등급(최고). */
const SEALED_OPEN_RARITY = RARITY_MAX;

// 침식 약 '마모' // BALANCE
const ABRASION_STEP_TICKS = 30 * SEC;
const ABRASION_SPEED_PER_STEP = 0.08;
const ABRASION_RADIUS_PER_STEP = 0.1;
/** 단계 상한 — 단조 증가 페널티에 천장을 둔다(헌장 §페널티 3). */
const ABRASION_MAX_STEP = 6;

// 침식 강 '함몰' // BALANCE
const SUBSIDE_STEP_TICKS = 30 * SEC;
const SUBSIDE_START_RADIUS = 6000;
const SUBSIDE_PER_STEP = 500;
/** 반경 하한 — **진행 교착 금지**(헌장 §페널티 4). 0 으로 수렴시키지 않는다. */
const SUBSIDE_MIN_RADIUS = 2200;
/** 좁아진 만큼 오르는 드랍 밀도(단계당). */
const SUBSIDE_DROP_PER_STEP = 0.1;
const SUBSIDE_FRUIT_SALT = 0x5eed_c011;
/** `catalyst/chain.ts` 의 `FRUIT_RARITY_CODE` 와 같은 값 — 열매는 무등급이다. */
const SUBSIDE_FRUIT_RARITY = 0;

/**
 * 중반 격전 세그먼트의 인덱스 — `SEGMENTS` 에서 **도출**한다(리터럴 3 을 코드에 적지 않는다).
 * 격전은 `killGoal: 0` 고정 인덱스 세그먼트라 `segmentIndex > CLASH_INDEX` 가 곧 "리더를
 * 처치했다"이고, 그래서 함몰의 절반 복구가 **틱과 `segmentIndex` 의 순수 파생**으로 닫힌다.
 */
const CLASH_INDEX = SEGMENTS.findIndex((s) => s.clash === true);

// ---------------------------------------------------------------------------
// 점화 약 '불씨' — 밀려난 적이 받는 피해 배율 (world.ts 가 부른다)
// ---------------------------------------------------------------------------

/**
 * 이 표적이 **불씨에 밀려나 있는 동안** 받는 피해 배율.
 *
 * ## 왜 `world.ts` 의 `dealt` 식에 얹는가
 * 앵커 ⑩(`onEnemyDamagedCatalyst`)은 `t.hp -= dealt` **뒤**라 이번 명중의 피해를 못 바꾸고,
 * 거기서 hp 를 되돌리면 이미 `dead` 가 선 적을 되살려 **좀비**를 만든다. 그래서 유일하게
 * 옳은 자리가 피해 산출식이고, 이 **임의 피해 배율**이 불씨를 §B 로 만드는 근거 자체다
 * (설계 정본이 그렇게 뒀다 — 예산 §B 는 불씨·반사 둘뿐이다).
 *
 * ⚠️ 무촉매 런은 `emberPushed` 비트가 전부 0 이라 **항상 정확히 `1`** 을 돌려준다(`x * 1 === x`
 * 는 부동소수에서도 비트 불변이다). 그래서 호출부에 게이트가 필요 없다.
 */
export function emberDamageTakenMult(e: Entity): number {
  if (e.kind !== 'enemy') return 1;
  return readMark(e, 'emberPushed') === 0 ? 1 : EMBER_DAMAGE_TAKEN;
}

// ---------------------------------------------------------------------------
// 매 틱 진입점
// ---------------------------------------------------------------------------

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **그룹 12개 다음, 마지막으로** 부른다.
 *
 * 순서가 계약인 이유: 공명은 카드들의 **집계 결과**라 카드 효과가 이번 틱에 만든 상태 위에
 * 얹히는 것이 자연스럽다. 앞으로 당기면 같은 런이 다른 값을 낸다.
 *
 * ⚠️ 이 자리는 `resolveCollisions` **앞**이라 `state.grid` 가 한 틱 낡아 있다. 격자 질의가
 * 필요한 넷은 {@link resonanceOnCatalystHazards} 에 있다.
 */
export function resonanceOnTick(state: WorldState, player: Entity): void {
  const r = activeResonance(state);
  if (r === null) return;
  decayResoMarks(state);
  switch (r.slug) {
    case RESO_ATTRACTION:
      attractionTick(state);
      break;
    case RESO_WHETTING:
      whettingTick(state, player);
      break;
    case RESO_ADVANCE:
      advanceTick(state, player);
      break;
    case RESO_SETTLEMENT:
      settlementTick(state);
      break;
    case RESO_ABRASION:
      abrasionTick(state, player);
      break;
    case RESO_SUBSIDENCE:
      subsidenceTick(state, player);
      break;
    default:
      break;
  }
}

/**
 * 적 단위 공명 카운트다운의 감쇠 — 불씨(밀려남)와 덫(붙잡힘)이 **같은 칸을 공유**한다.
 *
 * 눈금이 0 이 되는 순간 두 표식을 같이 지운다. 표식만 남고 카운트다운이 끝나면 "영영 밀려난
 * 적"이 되어 대가가 이득으로 뒤집힌다(불씨는 **받는 피해가 주는** 쪽이다).
 */
function decayResoMarks(state: WorldState): void {
  if (state.tick % RESO_MARK_UNIT !== 0) return;
  for (const e of state.entities) {
    if (e.kind !== 'enemy') continue;
    const left = readMark(e, 'resoTicks');
    if (left === 0) continue;
    const next = left - 1;
    writeMark(e, 'resoTicks', next);
    if (next === 0) writeMark(e, 'emberPushed', 0);
  }
}

// ---------------------------------------------------------------------------
// 점화 강 '되울림' — 처치가 연쇄한다 / 사슬의 마지막 하나는 너를 친다
// ---------------------------------------------------------------------------

/**
 * 사슬의 **방문 집합**. 규칙이 "무제한"이라 종료 보장이 이 집합 하나에 걸려 있다 —
 * 한 개체는 사슬당 한 번만 전파원이 되고, 집합에 이미 있으면 즉시 접는다.
 *
 * ⚠️ **한 호출 안에서만 산다.** {@link reverberationChain} 이 진입 첫 줄에서 비우고 사슬은
 * 그 호출 안에서 동기적으로 끝난다 — 틱을 넘기지 않으므로 두 월드를 교대로 돌려도 서로를
 * 오염시키지 않는다(§모듈 스코프 규율 4).
 */
const CHAIN_SEEN = new Set<number>();
/** 사슬의 다음 전파원 큐. {@link CHAIN_SEEN} 과 같은 수명 규율. */
const CHAIN_QUEUE: Entity[] = [];

/**
 * 처치 하나에서 시작하는 전파. 죽은 적 반경 안의 적이 **같은 피해**를 받고, 그 적이 죽으면
 * 다시 전파한다.
 *
 * ## ⚠️ 종료 보장 — 방문 집합
 * 전파원이 될 수 있는 것은 **{@link CHAIN_SEEN} 에 없는 개체뿐**이고 넣은 뒤에는 다시 안 넣는다.
 * 개체 수는 유한하고 매 단계 집합이 최소 1 커지므로 사슬 길이는 개체 수로 유계다. 재귀가
 * 아니라 **명시 큐**라 스택 깊이도 상수다. {@link REVERB_HARD_CAP} 은 그 위의 2차 안전망이다.
 *
 * ## ⚠️ 좀비 금지
 * `blastDamage` 계열이 한 번 깨졌던 형태 그대로다 — hp 만 0 으로 만들고 `dead` 를 안 세우면
 * `compact()` 의 첫 줄이 그 개체를 생존자로 넘겨 **처치도 젬도 전리품도 안 나온다**. 그래서
 * 전파 피해는 `hp <= 0` 이면 반드시 `dead = true` 를 같이 세운다.
 *
 * ## 사슬의 마지막 하나는 너를 친다
 * 마지막 전파 대상의 좌표에서 플레이어에게 `dmg * REVERB_SELF_HARM` 이 꽂힌다. 통지는
 * **`CATALYST_FX.selfHarm`** 이라 적 피해와 색·소리가 갈린다(헌장 §귀속 규율 3).
 */
function reverberationChain(state: WorldState, origin: Entity, dmg: number): void {
  if (dmg <= 0) return;
  CHAIN_SEEN.clear();
  CHAIN_QUEUE.length = 0;
  CHAIN_SEEN.add(origin.id);
  CHAIN_QUEUE.push(origin);

  let steps = 0;
  let lastX = origin.x;
  let lastY = origin.y;
  let propagated = false;

  for (let head = 0; head < CHAIN_QUEUE.length && steps < REVERB_HARD_CAP; head++) {
    const src = CHAIN_QUEUE[head] as Entity;
    for (const t of state.entities) {
      if (t.kind !== 'enemy' || t.dead) continue;
      if (CHAIN_SEEN.has(t.id)) continue;
      if (!circlesOverlap(src.x, src.y, REVERB_RADIUS, t.x, t.y, t.radius)) continue;
      CHAIN_SEEN.add(t.id); // ⭐ 종료 보장 — 넣기 전에는 큐에 안 들어간다.
      steps++;
      propagated = true;
      lastX = t.x;
      lastY = t.y;
      t.hp -= dmg;
      if (t.hp <= 0) {
        t.dead = true; // ⚠️ 좀비 방지(위 §주의).
        CHAIN_QUEUE.push(t);
      }
      if (steps >= REVERB_HARD_CAP) break;
    }
  }

  if (!propagated) return;
  fx(state, CATALYST_FX.trigger, origin.x, origin.y);
  const player = findPlayer(state);
  if (player === undefined) return;
  const self = dmg * REVERB_SELF_HARM;
  player.hp -= self;
  if (player.hp < 0) player.hp = 0;
  fx(state, CATALYST_FX.selfHarm, lastX, lastY);
}

// ---------------------------------------------------------------------------
// 밀도 약 '인력'
// ---------------------------------------------------------------------------

/**
 * 화면 적이 {@link ATTRACT_MIN_ENEMIES} 이상이면 **같은 종류끼리 서로 끌린다**.
 *
 * ⚠️ `id 20`(동조 — 같은 종류 셋이 모이면 발동)·`id 17`(금빛 적 추적)·`id 0`(더미 정리)과
 * **순방향**이다. 3판의 "뭉치지 못한다"가 자기 구성원의 발동 조건을 원천 차단했던 것을
 * 뒤집은 것이 이 규칙의 존재 이유다(설계 정본 §공명 × 구성원 전수 대조).
 *
 * 좌표를 **직접 당긴다** — `onEnemyStep` 은 배율 하나라 방향을 못 바꾼다. 이동 단계 밖의
 * 위치 보정이라 패턴 엔진의 조향을 지우지 않고 그 위에 얹힌다.
 */
function attractionTick(state: WorldState): void {
  let n = 0;
  for (const e of state.entities) if (e.kind === 'enemy' && !e.dead) n++;
  if (n < ATTRACT_MIN_ENEMIES) return;

  for (const e of state.entities) {
    if (e.kind !== 'enemy' || e.dead) continue;
    let sx = 0;
    let sy = 0;
    let k = 0;
    for (const o of state.entities) {
      if (o === e || o.kind !== 'enemy' || o.dead) continue;
      if (o.enemyType !== e.enemyType) continue;
      const dx = o.x - e.x;
      const dy = o.y - e.y;
      if (dx * dx + dy * dy > ATTRACT_RADIUS * ATTRACT_RADIUS) continue;
      sx += dx;
      sy += dy;
      k++;
    }
    if (k === 0) continue;
    const len = Math.sqrt(sx * sx + sy * sy);
    if (len <= 0) continue;
    e.x += (sx / len) * ATTRACT_PULL;
    e.y += (sy / len) * ATTRACT_PULL;
  }
  if (state.tick % ATTRACT_FX_INTERVAL === 0) {
    const p = findPlayer(state);
    fx(state, CATALYST_FX.trigger, p?.x ?? 0, p?.y ?? 0);
  }
}

/**
 * 인력의 **대가** — 뭉친 적은 서로 방어력을 나눠 단단해진다.
 *
 * ## 왜 피해 배율이 아니라 **되돌림**인가
 * 적 엔티티에 방어력 칸이 없고, 피해 산출식에 임의 배율을 하나 더 얹으면 그 순간 이 공명이
 * §B 로 올라간다(§훅 예산은 §B 를 불씨·반사 둘로 못 박았다). 그래서 앵커 ⑩에서 **살아남은
 * 경우에만** hp 를 일부 되돌린다 — 죽은 적은 절대 되살리지 않으므로 좀비가 구조적으로 안 생기고
 * (`t.dead` 가 이미 서 있으면 건너뛴다), `maxHp` 를 넘지도 않는다.
 */
function attractionToughness(state: WorldState, target: Entity, dmg: number): void {
  if (target.dead || target.kind !== 'enemy' || dmg <= 0) return;
  let k = 0;
  for (const o of state.entities) {
    if (o === target || o.kind !== 'enemy' || o.dead) continue;
    if (o.enemyType !== target.enemyType) continue;
    const dx = o.x - target.x;
    const dy = o.y - target.y;
    if (dx * dx + dy * dy <= ATTRACT_RADIUS * ATTRACT_RADIUS) k++;
    if (k >= 2) break;
  }
  if (k < 2) return;
  const back = dmg * ATTRACT_TOUGHNESS;
  target.hp += back;
  if (target.hp > target.maxHp) target.hp = target.maxHp;
}

// ---------------------------------------------------------------------------
// 정밀 약 '벼름'
// ---------------------------------------------------------------------------

/**
 * 무피격 10초마다 **다음 한 발이 관통**하고, 그 한 발 직후 3초간 발사가 느려진다.
 *
 * 슬롯 인코딩(`PrecisionWeakSlot.PierceArmed`, 값 규약 1 = "0 은 없음"):
 * `0` 대기 없음 · `1` 관통 장전됨 · `2 이상` 발사 감속 잔여 틱 + 1.
 *
 * 감속은 `player.cooldown` 을 매 틱 1 더 올리는 형태다 — 발사 간격 상수를 만지지 않고
 * **기존 쿨다운 칸**만 밀므로 신규 상태가 0 이다.
 */
function whettingTick(state: WorldState, player: Entity): void {
  const slots = state.catalystSlots;
  const armedRaw = readCatalystSlot(slots, PrecisionWeakSlot.PierceArmed);
  if (armedRaw >= 2) {
    // 발사 감속 창.
    player.cooldown += 1;
    const left = armedRaw - 1 - 1;
    writeCatalystSlot(slots, PrecisionWeakSlot.PierceArmed, left > 0 ? left + 1 : 0);
    return;
  }
  if (armedRaw === 1) return; // 장전 완료 — 다음 볼리에서 소비한다.
  const noHit = readCatalystSlot(slots, PrecisionWeakSlot.NoHitTicks) + 1;
  if (noHit >= WHET_NOHIT_TICKS) {
    writeCatalystSlot(slots, PrecisionWeakSlot.NoHitTicks, 0);
    writeCatalystSlot(slots, PrecisionWeakSlot.PierceArmed, 1);
    fx(state, CATALYST_FX.trigger, player.x, player.y);
    return;
  }
  writeCatalystSlot(slots, PrecisionWeakSlot.NoHitTicks, noHit);
}

/** 장전된 관통을 이번 볼리의 아군탄에 싣고, 곧바로 감속 창을 연다. */
function whettingConsume(state: WorldState, player: Entity): void {
  const slots = state.catalystSlots;
  if (readCatalystSlot(slots, PrecisionWeakSlot.PierceArmed) !== 1) return;
  let touched = false;
  for (const b of state.entities) {
    if (b.kind !== 'bullet' || b.dead) continue;
    if (b.pierce >= WHET_PIERCE) continue;
    b.pierce = WHET_PIERCE;
    touched = true;
  }
  if (!touched) return;
  writeCatalystSlot(slots, PrecisionWeakSlot.PierceArmed, WHET_SLOW_TICKS + 1);
  fx(state, CATALYST_FX.credit, player.x, player.y);
}

// ---------------------------------------------------------------------------
// 도박 약 '선불'
// ---------------------------------------------------------------------------

/**
 * 런 시작 시 전리품 하나를 미리 받는다.
 *
 * ⚠️ **대가**: 떨어지는 자리가 플레이어 발밑이 아니라 {@link ADVANCE_OFFSET} 만큼 떨어진
 * 곳이라 **가지러 가야** 한다(그동안 적이 밟으면 결실·덫과 같은 축의 압박을 받는다). 그리고
 * 규칙문대로 **지면 그것도 잃는다** — 바닥 전리품은 회수 전에는 `state.loot` 에 없고, 회수
 * 뒤에도 런에 지면 전리품 전량과 함께 사라진다.
 *
 * 시드는 `mix32` 순수 파생이라 **RNG 를 한 칸도 안 쓴다**(헌장 §공통-B(a)).
 */
function advanceTick(state: WorldState, player: Entity): void {
  if (state.tick !== 0) return;
  // ⚠️ `getState()` 는 **읽기**다 — 스트림을 한 칸도 밀지 않는다. `WorldState` 에 원 시드
  // 칸이 없어서(런 시드는 `createWorld` 인자로만 산다) 시드 의존 파생의 유일한 출처다.
  const seed = mix32(state.dropRng.getState(), ADVANCE_SALT);
  spawnLoot(state, player.x + ADVANCE_OFFSET, player.y, seed, 1);
  fx(state, CATALYST_FX.trigger, player.x + ADVANCE_OFFSET, player.y);
}

// ---------------------------------------------------------------------------
// 도박 강 '청산'
// ---------------------------------------------------------------------------

/**
 * 런 중 **처음 얻은 전리품 하나가 봉인**된다.
 *
 * "첫 전리품 = `state.loot[0]`" 이 성립하는 근거: 보스 확정 드랍·승리틱 엘리트 드랍은
 * `state.loot` 에 직접 push 되지만 **런 중 첫 픽업은 항상 `collectLoot`** 이다(설계 정본 (b)).
 * 도박 약 '선불'과의 인덱스 경합은 §공명 2단이 자동 해소한다 — 3장이면 약공명이 흡수된다(c).
 *
 * 표현은 `rarity` **예약값**({@link SEALED_RARITY})이라 신규 칸이 0 이다.
 */
function settlementTick(state: WorldState): void {
  const first = state.loot[0];
  if (first === undefined) return;
  if (first.rarity === SEALED_RARITY || first.rarity === SEALED_OPEN_RARITY) return;
  if (state.wave.boss) return; // 보스 창에 들어선 뒤 주운 것은 "첫 전리품"이 아니다.
  first.rarity = SEALED_RARITY;
  const p = findPlayer(state);
  fx(state, CATALYST_FX.trigger, p?.x ?? 0, p?.y ?? 0);
  missCatalyst(state, resoFxId(state), 1); // 봉인된 동안은 **놓친 액수** 축이다.
}

// ---------------------------------------------------------------------------
// 침식 약 '마모'
// ---------------------------------------------------------------------------

/**
 * 30초마다 **이동 속도가 오르고 피격 반경이 커진다**(웨이브 전환 시 복구).
 *
 * ## ⚠️ `playerSpeed` 는 감시 대상 공유 필드다 — 우선순위와 근거
 * `id 39 arke-overclock` 의 대가가 *"최대 속도가 한 단계 내려간다"* 라 **반대 방향**이고,
 * `id 46 kras-breachsteel` 도 조각을 지면 느려진다. 데이터 쪽 픽커 경고가 그 쌍 둘을 이미
 * 노랑으로 등재했다(`catalystConflicts.ts` — `{39, erosion/weak}` · `{46, erosion/weak}`).
 *
 * **우선순위: 카드가 먼저, 공명이 나중이다.** 근거는 두 가지다. ①디스패처가 공명을 **마지막**
 * 으로 부르는 것이 계약이고(공명은 카드가 만든 상태 위에 얹힌다) ②마모는 자기 단계를
 * **슬롯에 적은 뒤 그 단계만 되돌린다** — 절대값을 쓰지 않고 비율만 곱했다 되나누므로,
 * `id 39` 가 같은 틱에 무엇을 하든 그 결과 위에 곱해지고 복구도 정확히 자기 몫만 되돌린다.
 * 절대 대입이었다면 `id 39` 의 감속이 조용히 지워졌을 것이다.
 *
 * 단계는 `state.wave.segmentElapsed` 의 파생이라 **웨이브 전환에 자동으로 0** 이 된다.
 */
function abrasionTick(state: WorldState, player: Entity): void {
  const slots = state.catalystSlots;
  const applied = readCatalystSlot(slots, ErosionWeakSlot.Step); // 0 = 없음
  const rawStep = Math.floor(state.wave.segmentElapsed / ABRASION_STEP_TICKS);
  const want = rawStep > ABRASION_MAX_STEP ? ABRASION_MAX_STEP : rawStep;
  if (want === applied) return;
  const from = applied;
  const speedRatio =
    (1 + want * ABRASION_SPEED_PER_STEP) / (1 + from * ABRASION_SPEED_PER_STEP);
  const radiusRatio =
    (1 + want * ABRASION_RADIUS_PER_STEP) / (1 + from * ABRASION_RADIUS_PER_STEP);
  state.config.playerSpeed *= speedRatio;
  player.radius *= radiusRatio;
  writeCatalystSlot(slots, ErosionWeakSlot.Step, want);
  fx(state, want > from ? CATALYST_FX.trigger : CATALYST_FX.credit, player.x, player.y);
}

// ---------------------------------------------------------------------------
// 침식 강 '함몰'
// ---------------------------------------------------------------------------

/**
 * 이 런에서 함몰이 **발동하는가**. 베르단·니플헤임에서는 거짓이다.
 *
 * ⚠️ 두 행성 제외는 §페널티 4(진행 교착 금지)의 직접 귀결이다 — 베르단은 안전 원과 이중
 * 수축이고, 니플헤임은 마지막 일반 세그먼트가 대피소 전량 확보를 요구해 반경이 줄면 바깥
 * 대피소에 물리적으로 못 닿는다. **여기 한 곳이 유일한 게이트다**(반경 계산·지형 붕괴·드랍
 * 밀도 셋이 전부 이 술어를 통과해야 갈리지 않는다).
 *
 * ## ⚠️ 제외 행성 **목록은 여기 없다** — `ResonanceDef.voidOnPlanets` 가 정본이다
 * 종전에는 이 파일의 지역 상수 둘(`PLANET_BERDAN`·`PLANET_NIFLHEIM`)이 답을 갖고 있었고,
 * 픽커는 그 목록을 볼 수단이 없어 «함몰은 이 행성에서 안 뜬다»를 **고지하지 못했다**
 * (헌장 §축소 작동 규율이 요구하는 회색 경고). 이제 데이터 한 칸이 픽커와 sim 양쪽의 답이라
 * 두 화면이 갈릴 수 없다. 축은 **행성 인덱스**(`config.planet`)로 통일했다 — 카드 쪽
 * `voidOnPlanets` 와 같은 축이다.
 */
export function subsidenceActive(state: WorldState): boolean {
  const r = activeResonance(state);
  if (r === null || r.slug !== RESO_SUBSIDENCE) return false;
  return !resonanceVoidOnPlanet(r, state.config.planet ?? 0);
}

/**
 * 지금 이 틱의 **활동 반경**. `floor(tick / SUBSIDE_STEP_TICKS)` 과 `state.wave.segmentIndex`
 * 의 **순수 파생**이라 슬롯을 한 칸도 안 쓴다(저장하면 §B 로 올라간다).
 *
 * 격전 세그먼트를 통과했으면(`segmentIndex > CLASH_INDEX`) 줄어든 만큼의 절반이 돌아온다 —
 * 격전은 `killGoal: 0` 고정 인덱스 세그먼트라 그 부등식이 곧 "리더를 처치했다"이다.
 * 하한 {@link SUBSIDE_MIN_RADIUS} 가 반경이 0 으로 수렴하는 것을 막는다(§페널티 4).
 */
export function subsidenceRadius(state: WorldState): number {
  const step = Math.floor(state.tick / SUBSIDE_STEP_TICKS);
  let r = SUBSIDE_START_RADIUS - step * SUBSIDE_PER_STEP;
  if (r < SUBSIDE_MIN_RADIUS) r = SUBSIDE_MIN_RADIUS;
  if (CLASH_INDEX >= 0 && state.wave.segmentIndex > CLASH_INDEX) {
    r += (SUBSIDE_START_RADIUS - r) / 2;
  }
  return r;
}

/**
 * 가장자리부터 지형이 무너져 활동 반경이 줄어든다.
 *
 * ## 왜 **피해**가 아니라 되밀기인가
 * 헌장 §페널티 1 이 입력 씹기를 금지하고 §페널티 4 가 진행 교착을 금지한다. 되밀기는 입력을
 * 전부 살린 채 **물리·기하만** 바꾸므로 둘 다 안 건드리고, 하한 반경이 목표물 도달 가능성을
 * 남긴다. 베르단의 수축이 하드 클램프 없이 **피해**로 압박하는 것과 의도적으로 다른 결이다 —
 * 여기서 피해까지 주면 침식 태그 카드 셋의 지속 손실 위에 네 번째 손실이 겹친다.
 *
 * ⚠️ 무너지는 자리의 씨앗·나무(`id 23`)는 **사라지기 전에 열매를 전부 떨군다**
 * (`catalyst/chain.ts` §함몰 진입점이 열어 둔 계약: `pierce` = 남은 열매 수 → 좌표에 열매를
 * 낳고 `pierce = 0` 뒤 `dead`).
 */
function subsidenceTick(state: WorldState, player: Entity): void {
  if (!subsidenceActive(state)) return;
  const r = subsidenceRadius(state);

  const d = Math.sqrt(player.x * player.x + player.y * player.y);
  if (d > r && d > 0) {
    const k = r / d;
    player.x *= k;
    player.y *= k;
  }

  const r2 = r * r;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'destructible') continue;
    if (e.ownerId !== CATALYST_SEED_MARK && e.ownerId !== CATALYST_TREE_MARK) continue;
    if (e.x * e.x + e.y * e.y <= r2) continue;
    // 사라지기 전에 남은 열매를 전부 떨군다 — 시드는 RNG 미소비 파생이다.
    for (let i = 0; i < e.pierce; i++) {
      spawnLoot(
        state,
        e.x,
        e.y,
        mix32((e.id << 8) ^ i, SUBSIDE_FRUIT_SALT ^ state.tick),
        SUBSIDE_FRUIT_RARITY,
      );
    }
    e.pierce = 0;
    e.dead = true;
  }

  if (state.tick % SUBSIDE_STEP_TICKS === 0 && state.tick > 0) {
    fx(state, CATALYST_FX.trigger, player.x, player.y);
  }
}

// ---------------------------------------------------------------------------
// 앵커 팬아웃 진입점 — **카드 레인은 `catalystHooks.ts` 를 한 줄도 고치지 않는다**
// ---------------------------------------------------------------------------
//
// `catalystHooks.ts` 의 앵커 하나하나가 13개 그룹 모듈 전부에 **고정 순서로** 위임한다. 그래서
// 카드 레인은 자기 그룹 파일의 함수 본체만 채우면 되고, 디스패처는 손대지 않는다 — 이것이
// 병렬 레인의 마지막 충돌 지점을 없앤다.
//
// ## ⚠️ 자기 몫이 없는 앵커는 **지우지 마라**
// 빈 함수(또는 중립값 반환)로 남긴다. 지우면 디스패처가 깨지고 그 순간 이 파일이 다시 충돌
// 지점이 된다.
//
// ## ⚠️ 반환값이 있는 앵커의 **합성 규칙**(디스패처가 진다)
//  - 배율형(`DamageChain`·`EnemyStep`·`LootRoll`) — 그룹 순서대로 **곱해서 누적**한다.
//    중립은 `1`(전리품은 {@link CATALYST_LOOT_NEUTRAL}). 새 객체를 만들지 말고 그대로 돌려라.
//  - 억제형(`BossDeath`·`LootCollected`·`DestructibleDestroyed`) — **하나라도 `true` 면 억제**.
//
// ## ⚠️ 핫 경로 — 첫 줄은 반드시 **값싼 조기 반환**
// `EnemyDamaged`·`EnemyStep`·`EnemyContact` 는 적마다 매 틱 돈다(× 13 그룹). 그래서 아래는
// 전부 {@link activeResonance}(WeakMap 메모 한 번) 또는 {@link isReso} 로 시작한다.

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 resonance 몫 — 정밀 약 '벼름'. */
export function resonanceOnVolleyFired(state: WorldState, player: Entity): void {
  if (!isReso(state, RESO_WHETTING)) return;
  whettingConsume(state, player);
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 resonance 몫 —
 * **점화 약공명 '불씨': 밀려난 적은 1초간 받는 피해가 준다.**
 *
 * ⚠️ 종전에는 `world.ts` 가 {@link emberDamageTakenMult} 를 **직접 import** 해 보스 갑주
 * (`id 32`) 바로 뒤에 곱했다. 두 배율이 **같은 산식 자리를 다투는데** 합성 순서가 소스 줄
 * 순서에만 걸려 있었고, 무엇보다 이쪽은 **`catalystOn` 게이트가 아예 없었다**(마크가 0 이라
 * 우연히 맞았을 뿐이다). 앵커로 승격하면서 게이트가 그 첫 줄 하나로 모였고, 순서는 팬아웃
 * 순서(kargon → resonance)로 **명시된 계약**이 됐다 — 옮기기 전과 같은 순서다.
 *
 * 계산 본체는 그대로 두고 여기서는 **위임만** 한다(값은 비트 동일). `px`/`py` 는 안 쓴다 —
 * 이 공명은 거리와 무관하게 표식만 본다.
 */
export function resonanceOnEnemyDamageTakenMult(
  state: WorldState,
  target: Entity,
  px: number,
  py: number,
): number {
  void state;
  void px;
  void py;
  return emberDamageTakenMult(target);
}

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/**
 * {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 resonance 몫 —
 * 정밀 약 '벼름'의 무피격 누적을 되돌린다.
 */
export function resonanceOnPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
): void {
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
  if (!isReso(state, RESO_WHETTING)) return;
  writeCatalystSlot(state.catalystSlots, PrecisionWeakSlot.NoHitTicks, 0);
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnBulletExpired(
  state: WorldState,
  bullet: Entity,
  reason: BulletExpiryReason,
): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 resonance 몫. **중립**. */
export function resonanceOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 resonance 몫 —
 * 점화 강 '되울림'(처치 연쇄)과 밀도 약 '인력'의 대가(단단해짐).
 *
 * ⚠️ 이 앵커는 `for (const b of state.entities)` **순회 안**이라 스폰이 금지돼 있다. 둘 다
 * 스폰하지 않는다(연쇄는 hp 만 깎고 `dead` 를 세우며, 되돌림은 hp 만 올린다).
 */
export function resonanceOnEnemyDamaged(
  state: WorldState,
  target: Entity,
  dmg: number,
  source: Entity | undefined,
): void {
  void source;
  const r = activeResonance(state);
  if (r === null) return;
  if (r.slug === RESO_REVERBERATION) {
    // 전파의 씨앗은 **이번 피해로 죽은 개체**뿐이다.
    if (target.kind === 'enemy' && target.dead) reverberationChain(state, target, dmg);
    return;
  }
  if (r.slug === RESO_ATTRACTION) attractionToughness(state, target, dmg);
}

/**
 * {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 resonance 몫 —
 * 점화 약 '불씨'(파열이 밀어낸다)와 수확 강 '결실'(전리품 위에서 죽으면 등급이 오른다).
 *
 * ⚠️ 이 앵커는 `state.entities = survivors` **뒤**라 시체를 되찾을 수 없다 — 좌표만 온다.
 * 둘 다 좌표만으로 성립하도록 짰다.
 */
export function resonanceOnEnemyDeath(
  state: WorldState,
  x: number,
  y: number,
  elite: boolean,
): void {
  void elite;
  const r = activeResonance(state);
  if (r === null) return;

  if (r.slug === RESO_EMBER) {
    let pushed = false;
    for (const e of state.entities) {
      if (e.kind !== 'enemy' || e.dead) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > EMBER_RADIUS * EMBER_RADIUS || d2 <= 0) continue;
      const d = Math.sqrt(d2);
      e.x += (dx / d) * EMBER_PUSH;
      e.y += (dy / d) * EMBER_PUSH;
      // 대가 — 밀려난 적은 1초간 **받는 피해가 준다**(`emberDamageTakenMult`).
      writeMark(e, 'emberPushed', 1);
      writeMark(e, 'resoTicks', RESO_MARK_1S);
      pushed = true;
    }
    if (pushed) fx(state, CATALYST_FX.trigger, x, y);
    return;
  }

  if (r.slug === RESO_FRUITION) {
    let up = false;
    for (const l of state.entities) {
      if (l.kind !== 'loot' || l.dead) continue;
      const dx = l.x - x;
      const dy = l.y - y;
      if (dx * dx + dy * dy > FRUITION_RADIUS * FRUITION_RADIUS) continue;
      if (l.enemyType >= RARITY_MAX) continue;
      l.enemyType += 1; // 전리품의 등급코드는 `enemyType` 이다(`spawnLoot`).
      up = true;
    }
    if (up) {
      fx(state, CATALYST_FX.credit, x, y);
      creditCatalyst(state, resoFxId(state), 1);
    }
  }
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnPowerupPicked(
  state: WorldState,
  poolIndex: number,
  offeredIndex: number,
): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnResourceGranted(
  state: WorldState,
  amount: number,
  x: number,
  y: number,
): void {
  void state;
  void amount;
  void x;
  void y;
}

/**
 * {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 resonance 몫 —
 * 도박 강 '청산'의 **개봉**. 봉인된 첫 전리품이 최고 등급으로 열린다.
 *
 * ⚠️ 반환은 **억제 여부**다. 청산은 보스 드랍을 억제하지 않으므로 항상 `false` 다 —
 * 억제하면 모드 계약(*"모든 행성 모드는 보스 처치로 완주한다"*)의 보상 축이 사라진다.
 */
export function resonanceOnBossDeath(state: WorldState, x: number, y: number): boolean {
  if (!isReso(state, RESO_SETTLEMENT)) return false;
  const first = state.loot[0];
  if (first === undefined || first.rarity !== SEALED_RARITY) return false;
  first.rarity = SEALED_OPEN_RARITY;
  fx(state, CATALYST_FX.credit, x, y);
  creditCatalyst(state, resoFxId(state), 1);
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 resonance 몫 —
 * 침식 강 '함몰'의 **드랍 밀도**(좁아진 만큼 오른다).
 *
 * ⚠️ 새 객체를 만들지 않는 것이 계약이라 몫이 없으면 {@link CATALYST_LOOT_NEUTRAL} 을 그대로
 * 돌려준다. 함몰일 때만 한 쌍을 새로 만든다(적 격추마다 도는 자리라 그 외에는 할당 0).
 */
export function resonanceOnLootRoll(
  state: WorldState,
  x: number,
  y: number,
  elite: boolean,
): CatalystLootRoll {
  void x;
  void y;
  void elite;
  if (!subsidenceActive(state)) return CATALYST_LOOT_NEUTRAL;
  const step = Math.floor(state.tick / SUBSIDE_STEP_TICKS);
  return { rarity: 1, count: 1 + step * SUBSIDE_DROP_PER_STEP };
}

/**
 * {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 resonance 몫. **억제 없음**.
 *
 * ⚠️ 수확 약 '덫'이 여기서 `true` 를 돌려주면 안 된다 — `collectLoot` 은 이 훅 **앞에서**
 * 이미 `loot.dead = true` 를 세우므로 억제는 "1초간 회수 불가"가 아니라 **영구 소멸**이 된다.
 * 그래서 덫은 픽업 반경(`loot.radius`)을 0 으로 잠갔다 되돌리는 형태다({@link snareTick}).
 */
export function resonanceOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnWaveAdvanced(
  state: WorldState,
  prevSegment: number,
  nextSegment: number,
): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 resonance 몫. **몫 없음**. */
export function resonanceOnEnemyContact(
  state: WorldState,
  player: Entity,
  target: Entity,
): void {
  void state;
  void player;
  void target;
}

/**
 * {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 resonance 몫 —
 * 수확 약 '덫'에 붙잡힌 적은 **멈춘다**.
 *
 * 첫 줄이 값싼 조기 반환이다(적마다 매 틱 돈다).
 */
export function resonanceOnEnemyStep(state: WorldState, e: Entity): number {
  if (!isReso(state, RESO_SNARE)) return 1;
  return readMark(e, 'resoTicks') === 0 ? 1 : 0;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 resonance 몫. **억제 없음**. */
export function resonanceOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

// ---------------------------------------------------------------------------
// 격자 질의가 필요한 넷 — `stepCatalystHazards` 안(격자 삽입 직후)
// ---------------------------------------------------------------------------

/**
 * {@link import('../catalystHooks.js').stepCatalystHazards} 의 resonance 몫.
 *
 * 여기가 **격자 삽입 루프 직후**라 ①좌표가 이번 틱 기준이고 ②아직 아무 hp 도 안 깎였다.
 * 격자 질의가 필요한 넷(밀도 강 '오폭' · 정밀 강 '반사' · 수확 약 '덫' · 수확 강 '결실'의
 * 강등)이 전부 여기 선다.
 */
export function resonanceOnCatalystHazards(state: WorldState): void {
  const r = activeResonance(state);
  if (r === null) return;
  switch (r.slug) {
    case RESO_CROSSFIRE:
      crossfireStep(state);
      break;
    case RESO_DEFLECTION:
      deflectionStep(state);
      break;
    case RESO_SNARE:
      snareTick(state);
      break;
    case RESO_FRUITION:
      fruitionDegradeTick(state);
      break;
    default:
      break;
  }
}

/**
 * 밀도 강 '오폭' — **적의 탄이 적에게도 맞는다**. 대신 **네 탄은 첫 적에서 멎는다**.
 *
 * 적탄은 이미 공간 해시에 등록돼 있어(`world.ts` 의 격자 삽입 필터가 `enemyBullet` 을 포함한다)
 * 적↔적탄 판정을 **질의로** 붙일 수 있다 — 신규 칸 0, 처리 단계만 1 늘어난다(헌장의 기계
 * 기준은 "새 칸"이다).
 *
 * 관통 소실은 `bullet.pierce = 0`(기존 필드)이고, 이 자리가 `resolveCollisions` **앞**이라
 * 이번 틱의 명중부터 곧바로 적용된다.
 */
function crossfireStep(state: WorldState): void {
  let hit = false;
  for (const b of state.entities) {
    if (b.dead) continue;
    if (b.kind === 'bullet') {
      b.pierce = 0; // 대가 — 네 탄은 첫 적에서 멎는다.
      continue;
    }
    if (b.kind !== 'enemyBullet') continue;
    const dmg = b.damage;
    if (dmg <= 0) continue;
    state.grid.query(b.x, b.y, b.radius, (t) => {
      if (b.dead || t.dead || t.kind !== 'enemy') return;
      if (!circlesOverlap(b.x, b.y, b.radius, t.x, t.y, t.radius)) return;
      t.hp -= dmg;
      if (t.hp <= 0) t.dead = true; // ⚠️ 좀비 방지.
      b.dead = true;
      hit = true;
    });
  }
  if (hit) {
    const p = findPlayer(state);
    fx(state, CATALYST_FX.trigger, p?.x ?? 0, p?.y ?? 0);
  }
}

/**
 * 정밀 강 '반사' — 적탄 일부가 **튕겨 나가 다른 적을 맞힌다**. 대신 **튕기지 않은 탄은 피해가
 * 두 배**다.
 *
 * ## ⚠️⚠️ `id 28` 방벽 **우선**
 * 방벽이 소멸시킨 탄은 반사되지 않는다 — 소멸시키면 반사할 탄이 없다(설계 정본 §전수 대조).
 * 그래서 판정이 {@link BulwarkSlot.Ticks} 를 읽은 **뒤**에 선다. `id 28` 은 다른 레인이 배선
 * 중이고, 아직 서 있지 않으면 슬롯 읽기가 **0 을 돌려주는 것이 정상**이다(그때는 반사가 평소대로
 * 돈다).
 *
 * ## 어느 탄을 튕기는가 — **결정론적 카운터**(RNG 금지)
 * {@link PrecisionStrongSlot.ReflectState} 를 탄 하나마다 1씩 올려 `% DEFLECT_EVERY` 로 가른다.
 * 난수를 쓰면 시드 스트림이 밀려 무촉매 대조가 무너진다.
 *
 * 처리 표식은 **적탄 `aux0`** 다 — 헌장 §훅 예산이 *"적탄 `ownerId`/`aux0`/`aux1` 은 비어
 * 있다"* 고 실측으로 적은 칸이라 신규 칸이 아니다. 없으면 같은 탄이 매 틱 두 배가 되어
 * 피해가 지수로 폭주한다.
 */
function deflectionStep(state: WorldState): void {
  const slots = state.catalystSlots;
  const bulwarkOn = readCatalystSlot(slots, BulwarkSlot.Ticks) > 0;
  let counter = readCatalystSlot(slots, PrecisionStrongSlot.ReflectState);

  for (const b of state.entities) {
    if (b.dead || b.kind !== 'enemyBullet') continue;

    if (b.aux0 === 0) {
      // ⚠️ 방벽 우선 — 방벽이 서 있는 동안 들어온 탄은 반사 판정 자체를 받지 않는다.
      if (bulwarkOn) continue;
      counter = (counter + 1) >>> 0;
      if (counter % DEFLECT_EVERY === 0) {
        b.vx = -b.vx;
        b.vy = -b.vy;
        b.angle += Math.PI;
        b.aux0 = DEFLECT_MARK_REFLECTED;
        fx(state, CATALYST_FX.trigger, b.x, b.y);
      } else {
        b.damage *= DEFLECT_NONREFLECT_DAMAGE; // 대가 — 안 튕긴 탄은 두 배다.
        b.aux0 = DEFLECT_MARK_KEPT;
      }
    }

    if (b.aux0 !== DEFLECT_MARK_REFLECTED) continue;
    const dmg = b.damage;
    if (dmg <= 0) continue;
    state.grid.query(b.x, b.y, b.radius, (t) => {
      if (b.dead || t.dead || t.kind !== 'enemy') return;
      if (!circlesOverlap(b.x, b.y, b.radius, t.x, t.y, t.radius)) return;
      t.hp -= dmg;
      if (t.hp <= 0) t.dead = true; // ⚠️ 좀비 방지.
      b.dead = true;
      creditCatalyst(state, resoFxId(state), 1);
    });
  }
  writeCatalystSlot(slots, PrecisionStrongSlot.ReflectState, counter % 0x1000000);
}

/**
 * 수확 약 '덫' — 바닥의 전리품을 **적이 밟으면 1초간 붙잡힌다**. 대신 붙잡힌 동안 그 전리품은
 * **회수할 수 없다**.
 *
 * 회수 불가는 억제 앵커가 아니라 **픽업 반경 0** 으로 낸다 — 사유는
 * {@link resonanceOnLootCollected} 주석(억제하면 영구 소멸이 된다). 반경은 붙잡힌 적이
 * 없어지는 즉시 {@link LOOT_PICKUP_RADIUS} 로 되돌아간다.
 */
function snareTick(state: WorldState): void {
  let snapped = false;
  for (const l of state.entities) {
    if (l.dead || l.kind !== 'loot') continue;
    let locked = false;
    state.grid.query(l.x, l.y, LOOT_PICKUP_RADIUS, (t) => {
      if (t.dead || t.kind !== 'enemy') return;
      if (!circlesOverlap(l.x, l.y, LOOT_PICKUP_RADIUS, t.x, t.y, t.radius)) return;
      writeMark(t, 'resoTicks', RESO_MARK_1S);
      locked = true;
    });
    if (!locked) {
      // 아직 붙잡힌 적이 남아 있으면 잠금을 유지한다.
      for (const t of state.entities) {
        if (t.dead || t.kind !== 'enemy' || readMark(t, 'resoTicks') === 0) continue;
        if (!circlesOverlap(l.x, l.y, LOOT_PICKUP_RADIUS, t.x, t.y, t.radius)) continue;
        locked = true;
        break;
      }
    }
    const want = locked ? 0 : LOOT_PICKUP_RADIUS;
    if (l.radius !== want) {
      l.radius = want;
      if (locked) snapped = true;
    }
  }
  if (snapped) fx(state, CATALYST_FX.trigger, 0, 0);
}

/**
 * 수확 강 '결실'의 **대가** — 적이 전리품을 밟으면 등급이 내려간다.
 *
 * 같은 전리품이 매 틱 강등되면 1초 안에 바닥으로 떨어지므로 전리품의 `timer`(전리품에서는
 * 비어 있는 칸)를 냉각으로 재해석한다 — 신규 칸 0.
 */
function fruitionDegradeTick(state: WorldState): void {
  for (const l of state.entities) {
    if (l.dead || l.kind !== 'loot') continue;
    if (l.timer > 0) {
      l.timer -= 1;
      continue;
    }
    let stepped = false;
    state.grid.query(l.x, l.y, LOOT_PICKUP_RADIUS, (t) => {
      if (t.dead || t.kind !== 'enemy') return;
      if (!circlesOverlap(l.x, l.y, LOOT_PICKUP_RADIUS, t.x, t.y, t.radius)) return;
      stepped = true;
    });
    if (!stepped) continue;
    l.timer = FRUITION_DEGRADE_COOLDOWN;
    if (l.enemyType <= 0) continue;
    l.enemyType -= 1;
    missCatalyst(state, resoFxId(state), 1);
    fx(state, CATALYST_FX.miss, l.x, l.y);
  }
}
