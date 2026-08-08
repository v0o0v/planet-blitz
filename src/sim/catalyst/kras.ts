/**
 * 촉매 **크라스 특산**(id 45~47) — 카드 본체가 들어갈 자리.
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
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { CATALYST_LOOT_NEUTRAL, carries } from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { CATALYST_FX, creditCatalyst, notifyCatalystFx } from './fx.js';
import { BreachsteelSlot, readCatalystSlot, writeCatalystSlot } from '../catalystSlots.js';
import { blockBreakWallCount, isBreakableWall } from '../modes/blockBreak.js';
import { INVASION_ACCEL_BASE_CP, INVASION_ACCEL_MAX_CP } from '../invasion/constants.js';

/** id 45 — slug `kras-breach`. 정본은 `src/data/catalysts.ts`. */
export const CARD_KRAS_BREACH = 45;

/** id 46 — slug `kras-breachsteel`. 정본은 `src/data/catalysts.ts`. */
export const CARD_KRAS_BREACHSTEEL = 46;

/** id 47 — slug `kras-colossus`. 정본은 `src/data/catalysts.ts`. */
export const CARD_KRAS_COLOSSUS = 47;

// ---------------------------------------------------------------------------
// id 45 kras-breach — 세 배 단단한 블록 · 부순 층은 엄폐물로 남는다
// ---------------------------------------------------------------------------

/** 블록 hp 배수. **배치 시점**에 곱한다(`placeBlockBreakWalls` — 기존 지점). */
export const KRAS_BREACH_WALL_HP_MULT = 3;

/**
 * 이 런의 파괴가능 벽 hp 배수. `world.ts` 의 `createWorld` 가
 * {@link import('../modes/blockBreak.js').placeBlockBreakWalls} 에 그대로 넘긴다.
 *
 * ⚠️ 간선 방향은 **촉매 → 모드**가 아니라 **호출부가 촉매를 읽어 모드에 넘긴다**이다
 * (`catalystHooks.ts` 헤더 §모드 진행 게이트). 그래야 `modes/**` 가 촉매를 한 번도 import 하지
 * 않는 순수 환경 함수로 남는다.
 */
export function krasBreachWallHpMult(state: WorldState): number {
  if (!state.catalystOn || !carries(state, CARD_KRAS_BREACH)) return 1;
  return KRAS_BREACH_WALL_HP_MULT;
}

/**
 * 부순 블록이 **그 자리에 엄폐물로 남는가**(`id 45`). `world.ts` 의 벽 파괴 지점이 읽는다.
 *
 * ## 왜 hp 0 벽인가 — 신규 kind 를 만들지 않은 이유
 * 이 저장소에서 **`hp === 0` 인 `wall` 은 이미 "불파괴 차폐물"** 이다(침공·뱀서류 벽이 그것이고
 * `isBreakableWall` 이 `hp > 0` 으로 갈린다). 그래서 파괴된 층의 `dead` 를 내리고 hp 를 0 으로
 * 두면 **양 진영의 탄을 막는 엄폐물**이 공짜로 선다 — 탄-벽 스윕이 *"Both factions' bullets are
 * stopped by walls"* 라 적탄이 여기서 죽는다. 신규 kind 를 안 만든 것이 조준 술어·격자·아군탄
 * 화이트리스트 **세 목록이 갈라지지 않는 이유 자체**다.
 *
 * ## 왜 진행 교착이 아닌가
 *  1. 각 벽 행은 **항상 통과 틈새(±`BLOCKBREAK_GAP_HALF_W`)를 남긴다** — 엄폐물이 남아도 틈새는
 *     그대로라 전진 경로가 막히지 않는다.
 *  2. 엄폐물은 `isBreakableWall` 이 거짓이라 **압사 판정 대상이 아니다**(`isPinnedByWall`).
 *  3. `hp <= 0` 인 벽은 `isGimmick` 에 걸려 **청크 컬링이 뒤로 흘러간 것을 걷어 간다** — 무한
 *     누적이 없다.
 */
export function krasBreachKeepsCover(state: WorldState): boolean {
  return state.catalystOn && carries(state, CARD_KRAS_BREACH);
}

// ---------------------------------------------------------------------------
// id 46 kras-breachsteel — 따라다니는 조각(방패)
// ---------------------------------------------------------------------------

/** 동시에 지고 다닐 수 있는 조각 수의 상한. */
export const KRAS_SHARD_CAP = 5;

/**
 * 조각 하나가 환산되는 XP 배율 증분. 상한(5개)에서 정확히 **×2.0** 이 된다(카탈로그 §상한).
 */
const KRAS_SHARD_XP_STEP = 0.2;

/** 감속 듀티의 분모. `tick % 5 < shards` 라 5개면 **상시 감속**이다. */
const KRAS_SHARD_SLOW_PERIOD = 5;

// ---------------------------------------------------------------------------
// id 47 kras-colossus — 남은 블록이 곧 보스의 방어력
// ---------------------------------------------------------------------------

/** 블록이 하나도 안 깨졌을 때의 최대 피해 감소율. 전량 파괴 시 0 이 된다. */
const KRAS_COLOSSUS_MAX_REDUCTION = 0.5;

/** 부순 비율 1(전량)에서의 전리품 등급 배율(카탈로그 §상한 희귀도 ×2.4). */
const KRAS_COLOSSUS_RARITY_CAP = 2.4;

/** 부순 비율 1 에서 스크롤 가속에 더해지는 cp. 기존 노브(`accelCp`)의 **하한만** 끌어올린다. */
const KRAS_COLOSSUS_ACCEL_SPAN_CP = INVASION_ACCEL_MAX_CP - INVASION_ACCEL_BASE_CP;

// ---------------------------------------------------------------------------
// 파생 판정 — **슬롯을 안 먹는다**(남은 블록 수에서 그때그때 센다)
// ---------------------------------------------------------------------------

/** 지금 살아 있는 파괴가능 블록 수. */
function liveBlocks(state: WorldState): number {
  let n = 0;
  for (const w of state.entities) {
    if (!w.dead && isBreakableWall(w)) n++;
  }
  return n;
}

/**
 * 지금까지 **부순 블록의 비율**(0..1). `id 47` 의 세 축(보스 방어력·전리품 등급·스크롤 가속)이
 * 전부 이 하나에서 파생한다 — 보스 HP 를 외부 오브젝트에 두지 않는 것이 카탈로그 §훅의 요구다.
 *
 * 분모는 코스 배치에서 **순수 파생**한다({@link blockBreakWallCount}) — 런 시작 시점의 수를
 * 어딘가에 적어 둘 필요가 없다는 뜻이고, 그래서 이 카드는 슬롯을 한 칸도 안 먹는다.
 */
function brokenRatio(state: WorldState): number {
  const total = blockBreakWallCount();
  if (total <= 0) return 0;
  const broken = total - liveBlocks(state);
  if (broken <= 0) return 0;
  return broken >= total ? 1 : broken / total;
}

/** 지고 있는 조각 수(`id 46`). */
function shardsOf(state: WorldState): number {
  return readCatalystSlot(state.catalystSlots, BreachsteelSlot.Shards);
}

/** 살아 있는 보스가 있는가(= 보스에 도달했는가). */
function bossPresent(state: WorldState): boolean {
  for (const b of state.entities) {
    if (!b.dead && b.kind === 'boss') return true;
  }
  return false;
}

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 *
 * ⚠️ **지금은 비어 있다 — 누락이 아니라 미배선이다.** 카드 레인이 여기에 `carries` 게이트로
 * 분기를 넣는다. 앵커가 매 틱이 아닌 카드(드랍 롤·격추·접촉·해저드 …)는 이 함수가 아니라
 * `catalystHooks.ts` 의 **해당 디스패치**에 진입 함수를 새로 추가해 걸어라 — 매 틱 자리에
 * 억지로 넣으면 단조 누적이 되어 헌장 §틱 규율을 어긴다.
 */
export function krasOnTick(state: WorldState, player: Entity): void {
  breachsteelTick(state, player);
  colossusScrollTick(state);
}

/**
 * `id 46` 의 매 틱 몫 — **조각을 지고 있으면 느려지고, 보스에 닿으면 전부 경험치가 된다.**
 *
 * ## 감속을 듀티로 거는 이유
 * 촉매에는 플레이어 이동 배율 앵커가 없다(`onPlayerMoveParams` 는 스킬 축이다). 그래서 기존
 * `state.playerSlowTicks`(→ `PLAYER_SLOW_MULT = 0.5`)를 그대로 탄다 — `catalyst/drops.ts` 의
 * `id 2` 가 이미 선 선례다. 다만 그 축은 **켜짐/꺼짐** 뿐이라 *"조각 수만큼"* 이 안 되므로,
 * `tick % 5 < shards` 로 **듀티**를 만든다: 1개면 5틱 중 1틱, 5개면 상시. 정수 모듈러라 결정론이고
 * 이미 걸린 더 긴 감속을 덮지 않는다(덮으면 니플헤임 감속 지대가 이 카드 때문에 짧아진다).
 *
 * ## ⚠️ 교착이 아닌 이유
 * 강제 스크롤에서 느려지는 것은 **설계된 대가**다(지우지 마라). 다만 조각은 버릴 수단이 있다 —
 * 피격 한 번이 조각 하나를 소비한다({@link krasOnDamageChain}). 즉 감속이 압사 위험을 키우면
 * 그 압사(사슬 우회 피해원)가 아니라 **먼저 날아오는 적탄**이 조각을 깎아 속도가 돌아온다.
 * 상한 5 는 최악의 듀티를 100% 로 묶어 그 위로 못 가게 한다.
 */
function breachsteelTick(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_KRAS_BREACHSTEEL)) return;
  const shards = shardsOf(state);
  if (shards <= 0) return;
  // 보스 도달 — 조각을 **온전히 지고** 왔으면 전부 경험치가 된다.
  if (bossPresent(state)) {
    const mult = 1 + shards * KRAS_SHARD_XP_STEP;
    // ⚠️ `state.catalystMods` 는 readonly 필드를 가진 번들이라 **통째로 교체**한다.
    state.catalystMods = { ...state.catalystMods, xp: state.catalystMods.xp * mult };
    writeCatalystSlot(state.catalystSlots, BreachsteelSlot.Shards, 0);
    creditCatalyst(state, CARD_KRAS_BREACHSTEEL, shards);
    notifyCatalystFx(state, CARD_KRAS_BREACHSTEEL, CATALYST_FX.trigger, player.x, player.y);
    return;
  }
  // 감속 듀티(위 §). 이미 더 긴 감속이 걸려 있으면 덮지 않는다.
  if (state.tick % KRAS_SHARD_SLOW_PERIOD < shards && state.playerSlowTicks < 2) {
    state.playerSlowTicks = 2;
  }
}

/**
 * `id 47` 의 매 틱 몫 — **부순 자리로 스크롤이 더 빨리 밀려 올라온다.**
 *
 * 기존 노브(`scrollRuntime.accelCp`)의 **하한을 올린다**. 가산 오프셋으로 두면 다음 틱의
 * `nextAccelCp` 가 그 위에 또 가산해 복리로 폭주하지만, 하한은 몇 번을 다시 적용해도 같은
 * 값이라 그 부류가 원천적으로 생기지 않는다(정수 · RNG 미소비).
 */
function colossusScrollTick(state: WorldState): void {
  if (!carries(state, CARD_KRAS_COLOSSUS)) return;
  const rt = state.scrollRuntime;
  if (rt === undefined) return;
  const floorCp =
    INVASION_ACCEL_BASE_CP + Math.round(KRAS_COLOSSUS_ACCEL_SPAN_CP * brokenRatio(state));
  if (rt.accelCp < floorCp) rt.accelCp = floorCp;
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

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 kras 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function krasOnEnemyDamageTakenMult(
  state: WorldState,
  target: Entity,
  px: number,
  py: number,
): number {
  void state;
  void target;
  void px;
  void py;
  return 1;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/** {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnPlayerDamaged(state: WorldState, player: Entity, dmg: number, lethalSurvived: boolean, sources: DamageSourceMask): void {
  void state;
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 kras 몫 —
 * **`id 46` 조각 하나가 이번 피해를 통째로 막고 부서진다.**
 *
 * ⚠️ 아군탄 `b.phase` 를 쓰지 않는다 — 관통 자이로·수렴 프리즘이 이미 점유해 두 유니크를 낀
 * 런에서 이중 계산이 났다(초판이 밟은 형태). 조각 수는 슬롯 하나(`BreachsteelSlot.Shards`)뿐이다.
 *
 * ⚠️ 사슬을 **우회하는 피해원 8곳**(압사 포함)은 이 배율을 안 탄다 — 조각은 날아오는 것을
 * 막지, 벽에 눌리는 것을 막지 않는다. 그것이 이 카드의 대가가 실제로 아픈 이유다.
 */
export function krasOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  if (dmg <= 0) return 1;
  if (!carries(state, CARD_KRAS_BREACHSTEEL)) return 1;
  const shards = shardsOf(state);
  if (shards <= 0) return 1;
  writeCatalystSlot(state.catalystSlots, BreachsteelSlot.Shards, shards - 1);
  notifyCatalystFx(state, CARD_KRAS_BREACHSTEEL, CATALYST_FX.trigger, player.x, player.y);
  return 0;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 kras 몫 —
 * **`id 47` 보스가 남은 블록만큼 단단하다.**
 *
 * 이 앵커는 `t.hp -= dealt` **직후**라 감산이 이미 끝나 있다. 그래서 감소분을 **되돌려 준다** —
 * 결과는 "피해 감소"와 같고, 보스 HP 를 외부 오브젝트에 두지 않는다는 카탈로그 §훅 요구를
 * 지킨다(방어력은 오직 남은 블록 수의 함수다).
 *
 * ⚠️ 되돌린 뒤 hp 가 살아나면 `dead` 를 내려야 한다 — 호출부가 hp 감산 직후에 이미 세웠다.
 */
export function krasOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void source;
  if (target.kind !== 'boss' || dmg <= 0) return;
  if (!carries(state, CARD_KRAS_COLOSSUS)) return;
  const reduction = KRAS_COLOSSUS_MAX_REDUCTION * (1 - brokenRatio(state));
  if (reduction <= 0) return;
  target.hp += dmg * reduction;
  if (target.hp > 0 && target.dead) target.dead = false;
}

/** {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void state;
  void x;
  void y;
  void elite;
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  void state;
  void amount;
  void x;
  void y;
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 kras 몫 —
 * **`id 47` 부순 수만큼 전리품 등급이 오른다.**
 *
 * ⚠️ 재롤이 아니다(RNG 미소비). 이미 뽑힌 등급 배율에 곱하는 자리다.
 */
export function krasOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  void elite;
  if (!carries(state, CARD_KRAS_COLOSSUS)) return CATALYST_LOOT_NEUTRAL;
  const ratio = brokenRatio(state);
  if (ratio <= 0) return CATALYST_LOOT_NEUTRAL;
  const rarity = 1 + (KRAS_COLOSSUS_RARITY_CAP - 1) * ratio;
  notifyCatalystFx(state, CARD_KRAS_COLOSSUS, CATALYST_FX.trigger, x, y);
  return { rarity, count: 1 };
}

/**
 * **벽 파괴 진입점** — `world.ts` 의 아군탄-벽 스윕이 층 하나를 부순 그 자리에서 부른다.
 *
 * ## 왜 `catalystHooks.ts` 의 24앵커가 아닌가 (설계 정본과 갈리는 자리 — 보고 대상)
 * 24앵커에 **벽 파괴 지점이 없다**(`onDestructibleDestroyedCatalyst` 는 `destructible` kind 다).
 * 그리고 `compact` 는 그 틱 안에서 시체를 걷어 가므로 다음 틱의 `onTick` 에서는 **좌표조차
 * 복원할 수 없다** — 즉 이 사건은 발생 지점에서만 잡을 수 있다. 이 레인은 디스패처를 못 고치는
 * 제약이 있어 `world.ts` 가 이 함수를 직접 부른다. 앵커로 승격하는 것은 디스패처 소유 레인의 몫이다.
 *
 * 세 카드가 이 한 지점을 나눠 쓴다:
 *  - `id 45` — 층을 **엄폐물로 남긴다**(호출부가 {@link krasBreachKeepsCover} 로 판정한다).
 *  - `id 46` — 조각을 하나 **줍는다**(상한 5).
 *  - `id 47` — 부순 수는 세지 않는다. **남은 블록 수에서 파생**하므로 여기서 할 일이 없다.
 */
export function krasOnWallDestroyed(state: WorldState, wall: Entity): void {
  if (!state.catalystOn) return;
  if (carries(state, CARD_KRAS_BREACH)) {
    // 엄폐물이 선 그 자리 — 여기서 부순 층이 촉매를 뱉는 조건이 성립한다(귀속 장부).
    creditCatalyst(state, CARD_KRAS_BREACH, 1);
    notifyCatalystFx(state, CARD_KRAS_BREACH, CATALYST_FX.trigger, wall.x, wall.y);
  }
  if (carries(state, CARD_KRAS_BREACHSTEEL)) {
    const shards = shardsOf(state);
    if (shards < KRAS_SHARD_CAP) {
      writeCatalystSlot(state.catalystSlots, BreachsteelSlot.Shards, shards + 1);
      notifyCatalystFx(state, CARD_KRAS_BREACHSTEEL, CATALYST_FX.trigger, wall.x, wall.y);
    }
  }
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnEnemyStep(state: WorldState, e: Entity): number {
  void state;
  void e;
  return 1;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/** {@link import('../catalystHooks.js').stepCatalystHazards} 의 kras 몫. **미배선**(위 §주석). */
export function krasOnCatalystHazards(state: WorldState): void {
  void state;
}
