/**
 * 촉매 **공명 12**(태그 6종 × 약/강) — 본체가 들어갈 자리.
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
 * `activeResonance` 계열이 정본이고 그 결과를 여기서 다시 계산하지 마라(두 곳이 갈린다).
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { CATALYST_LOOT_NEUTRAL } from './shared.js';
import type { CatalystLootRoll } from './shared.js';

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

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **그룹 12개 다음, 마지막으로** 부른다.
 *
 * 순서가 계약인 이유: 공명은 카드들의 **집계 결과**라 카드 효과가 이번 틱에 만든 상태 위에
 * 얹히는 것이 자연스럽다. 앞으로 당기면 같은 런이 다른 값을 낸다.
 *
 * ⚠️ **지금은 비어 있다 — 누락이 아니라 미배선이다.**
 */
export function resonanceOnTick(state: WorldState, player: Entity): void {
  void state;
  void player;
}

// ---------------------------------------------------------------------------
// 앵커 팬아웃 진입점 — **카드 레인은 `catalystHooks.ts` 를 한 줄도 고치지 않는다**
// ---------------------------------------------------------------------------
//
// `catalystHooks.ts` 의 앵커 하나하나가 13개 그룹 모듈 전부에 **고정 순서로** 위임한다. 그래서
// 카드 레인은 자기 그룹 파일의 함수 본체만 채우면 되고, 디스패처는 손대지 않는다 — 이것이
// 병렬 레인의 마지막 충돌 지점을 없앤다.
//
// ## ⚠️ 지금은 전부 비어 있다 — **누락이 아니라 미배선이다**
// 자기 몫이 없는 앵커는 빈 함수(또는 중립값 반환)로 남긴다. 지우지 마라 — 지우면 디스패처가
// 깨지고 그 순간 이 파일이 다시 충돌 지점이 된다.
//
// ## ⚠️ 반환값이 있는 앵커의 **합성 규칙**(디스패처가 진다)
//  - 배율형(`DamageChain`·`EnemyStep`·`LootRoll`) — 그룹 순서대로 **곱해서 누적**한다.
//    중립은 `1`(전리품은 {@link CATALYST_LOOT_NEUTRAL}). 새 객체를 만들지 말고 그대로 돌려라.
//  - 억제형(`BossDeath`·`LootCollected`·`DestructibleDestroyed`) — **하나라도 `true` 면 억제**.
//    디스패처는 단락 없이 13개를 **전부** 부르고 OR 로 접는다(단락하면 뒤 그룹의 부수효과가 사라진다).
//
// ## ⚠️ 핫 경로 — 첫 줄은 반드시 **값싼 조기 반환**
// `EnemyDamaged`·`EnemyStep`·`EnemyContact` 는 적마다 매 틱 돈다(× 13 그룹). 본체를 채울 때
// 첫 줄을 `if (!carries(state, CARD_*)) return …;` 로 두어라. 캐시하겠다고 `WorldState` 에
// 새 칸을 만들지 마라 — 헌장 §훅 예산이 그것을 §B 로 올린다.

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/** {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnPlayerDamaged(state: WorldState, player: Entity, dmg: number, lethalSurvived: boolean, sources: DamageSourceMask): void {
  void state;
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/** {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void state;
  void target;
  void dmg;
  void source;
}

/** {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void state;
  void x;
  void y;
  void elite;
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  void state;
  void amount;
  void x;
  void y;
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/** {@link import('../catalystHooks.js').onLootRollCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  void state;
  void x;
  void y;
  void elite;
  return CATALYST_LOOT_NEUTRAL;
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnEnemyStep(state: WorldState, e: Entity): number {
  void state;
  void e;
  return 1;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/** {@link import('../catalystHooks.js').stepCatalystHazards} 의 resonance 몫. **미배선**(위 §주석). */
export function resonanceOnCatalystHazards(state: WorldState): void {
  void state;
}
