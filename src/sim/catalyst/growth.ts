/**
 * 촉매 **성장 축**(id 10~14) — 카드 본체가 들어갈 자리.
 *
 * ## 왜 그룹마다 파일을 가르는가
 * 카드 45종을 **병렬 레인이 동시에** 채운다. 한 파일이면 레인마다 같은 함수를 만져 **매 머지가
 * 충돌**하고, 충돌 해소가 사람 손이라 조용한 유실이 생긴다. 그룹 = 카드 묶음 하나라 레인
 * 하나가 파일 하나를 통째로 소유한다. 공용 술어·해저드 규약은 {@link file://./shared.ts} 다.
 *
 * ⚠️ 이 모듈은 `world.js` 를 **type-only** 로만 import 한다(순환 금지). 값이 필요하면
 * `catalystHooks.ts` 가 인자로 넘겨라.
 *
 * ⚠️ 카드 분기는 반드시 {@link carries}`(state, CARD_*)` 게이트 **안쪽**이어야 한다 —
 * `state.catalystOn` 만으로 켜면 아무 촉매 한 장에 그룹 전체가 발동한다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import { carries } from './shared.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { CATALYST_LOOT_NEUTRAL } from './shared.js';
import type { CatalystLootRoll } from './shared.js';

/** id 10 — slug `insight`. 정본은 `src/data/catalysts.ts`. */
export const CARD_INSIGHT = 10;

/** id 11 — slug `tutelage`. 정본은 `src/data/catalysts.ts`. */
export const CARD_TUTELAGE = 11;

/** id 12 — slug `ascension`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ASCENSION = 12;

/** id 13 — slug `enlightenment`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ENLIGHTENMENT = 13;

/** id 14 — slug `mastery`. 정본은 `src/data/catalysts.ts`. */
export const CARD_MASTERY = 14;

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 *
 * ⚠️ **지금은 비어 있다 — 누락이 아니라 미배선이다.** 카드 레인이 여기에 `carries` 게이트로
 * 분기를 넣는다. 앵커가 매 틱이 아닌 카드(드랍 롤·격추·접촉·해저드 …)는 이 함수가 아니라
 * `catalystHooks.ts` 의 **해당 디스패치**에 진입 함수를 새로 추가해 걸어라 — 매 틱 자리에
 * 억지로 넣으면 단조 누적이 되어 헌장 §틱 규율을 어긴다.
 */
export function growthOnTick(state: WorldState, player: Entity): void {
  void state;
  void player;
}

// ---------------------------------------------------------------------------
// id 14 mastery — **배선 완료**(파워업 3택 축). 거동 불변으로 `catalystHooks.ts` 에서 옮겨 왔다
// ---------------------------------------------------------------------------

/**
 * `id 14 mastery` — **세 자리가 전부 같은 파워업이 된다**(폭을 잃고 깊이를 얻는다).
 *
 * ⚠️ `GAMBLER_EXTRA_CHOICES` 로 4택이 된 런에서도 자리 수와 무관하게 전부 덮는다.
 *
 * ⚠️⚠️ **RNG 미소비.** 이미 뽑힌 결과를 **자리째 덮을 뿐** 재추첨하지 않는다 —
 * `powerupRng` 스트림 위치가 촉매 유무와 무관하게 동일하다.
 *
 * ⚠️ 호출 순서는 **mastery → epiphany 고정**이다(`refine.ts` 쪽 주석과 쌍).
 *
 * @param first `offers[0]` — 호출부가 `undefined` 가 아님을 이미 확인한 값이다.
 */
export function masteryOnPowerupOffer(state: WorldState, offers: number[], first: number): void {
  if (!carries(state, CARD_MASTERY)) return;
  for (let i = 1; i < offers.length; i++) offers[i] = first;
}

/**
 * `id 14 mastery` 의 **중첩 추가분**(기본 1중첩 + 2 = 3중첩). `world.ts` 가 이미 기본 1중첩을
 * 적용한 뒤이므로 여기는 추가분만 센다.
 */
export function masteryExtraStacks(state: WorldState): number {
  return carries(state, CARD_MASTERY) ? 2 : 0;
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

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/** {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnPlayerDamaged(state: WorldState, player: Entity, dmg: number, lethalSurvived: boolean, sources: DamageSourceMask): void {
  void state;
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/** {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void state;
  void target;
  void dmg;
  void source;
}

/** {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void state;
  void x;
  void y;
  void elite;
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  void state;
  void amount;
  void x;
  void y;
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/** {@link import('../catalystHooks.js').onLootRollCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  void state;
  void x;
  void y;
  void elite;
  return CATALYST_LOOT_NEUTRAL;
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnEnemyStep(state: WorldState, e: Entity): number {
  void state;
  void e;
  return 1;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/** {@link import('../catalystHooks.js').stepCatalystHazards} 의 growth 몫. **미배선**(위 §주석). */
export function growthOnCatalystHazards(state: WorldState): void {
  void state;
}
