/**
 * 촉매 **정련 축**(id 5~9) — 카드 본체가 들어갈 자리.
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
import { carries, spawnCatalystHazard, PROSPECT_OPEN, PROSPECT_SHIELDED } from './shared.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { CATALYST_LOOT_NEUTRAL } from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { readMark, writeMark } from '../catalystMarks.js';
import { RefinementSlot } from '../catalystSlots.js';
import { readCatalystSlot, writeCatalystSlot } from '../catalystSlots.js';
import { notifyCatalystFx, creditCatalyst, missCatalyst, CATALYST_FX } from './fx.js';

/** id 5 — slug `refinement`. 정본은 `src/data/catalysts.ts`. */
export const CARD_REFINEMENT = 5;

/** id 6 — slug `gilding`. 정본은 `src/data/catalysts.ts`. */
export const CARD_GILDING = 6;

/** id 7 — slug `prospect`. 정본은 `src/data/catalysts.ts`. */
export const CARD_PROSPECT = 7;

/** id 8 — slug `alchemy`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ALCHEMY = 8;

/** id 9 — slug `epiphany`. 정본은 `src/data/catalysts.ts`. */
export const CARD_EPIPHANY = 9;

// ---------------------------------------------------------------------------
// 공용 상수 · 순수 헬퍼 (이 그룹만 쓴다 — `shared.ts` 로 올리면 그 파일이 충돌 지점이 된다)
// ---------------------------------------------------------------------------

/**
 * 등급 코드. **정본은 `src/items/types.ts` 의 `RARITY_CODE`** 이고 `src/sim/drops.ts` 가
 * 같은 값을 재선언한다(그 파일 §10 주석). 여기서 세 번째로 적는 이유는 순환 회피다 —
 * `drops.ts` 는 `world.js` 를 값으로 끌지 않지만 `catalyst/**` 는 리프만 import 하기로
 * 못 박혀 있고(`shared.ts` §순환 금지), 등급 코드는 4개짜리 불변 눈금이라 베끼는 비용이
 * 임포트 사슬을 넓히는 비용보다 싸다.
 */
const RARITY_NORMAL = 0;
/** 최상 등급 코드(유니크). 여기 도달한 전리품은 정련로에 안 들어간다(올릴 칸이 없다). */
const RARITY_TOP = 3;

/** 정련로 한 등급 칸의 폭(비트). 칸 하나에 등급 둘을 접으므로 8비트씩이다. */
const STOCK_BITS = 8;
/** 정련로 한 등급 칸의 상한(8비트 눈금). 넘으면 더 안 쌓는다(절삭). */
const STOCK_MAX = (1 << STOCK_BITS) - 1;
/** *"같은 등급 셋을 한 단계 위 하나로"* — 승급에 필요한 재고 수. */
const REFINE_COST = 3;

/** `id 6 gilding` — 한 단계에 걸리는 틱(30초 × 60tps). */
const GILD_STEP_TICKS = 1800;
/** `id 6 gilding` — 최대 단계(마크 폭 2비트와 같다). */
const GILD_MAX = 3;
/** `id 6 gilding` — 단계당 적 이동 속도 증가분(대가 축). */
const GILD_SPEED_PER_STAGE = 0.12;
/**
 * `id 6 gilding` — 단계당 전리품 등급 배율 증가분(이득 축).
 * 3단계에서 `1 + 0.4×3 = 2.2` 로 카탈로그의 **상한 희귀도 ×2.2 와 정확히 같다**.
 */
const GILD_RARITY_PER_STAGE = 0.4;

/** `id 7 prospect` — 호위 판정 반경(월드 단위). */
const PROSPECT_GUARD_RADIUS = 140;
/** `id 7 prospect` — 무적이 서는 최소 호위 수. 이 아래로 흩어지면 창이 열린다. */
const PROSPECT_GUARD_MIN = 2;
/** `id 7 prospect` — 광맥 보유자 전리품 등급 배율. 카탈로그 상한 ×2.0 과 같다. */
const PROSPECT_RARITY = 2.0;
/** `id 7 prospect` — 지목 파생 salt(`mix32` 순수 파생 · RNG 미소비). */
const SALT_PROSPECT = 0x9e37_79b1;

/** `id 8 alchemy` — 노말 셋이 융합으로 인정되는 최대 상호 거리. */
const ALCHEMY_FUSE_RADIUS = 120;
/** `id 8 alchemy` — 융합 한 건에 필요한 노말 전리품 수. */
const ALCHEMY_FUSE_COUNT = 3;
/** `id 8 alchemy` — 유독 장판 반경. */
const ALCHEMY_HAZARD_RADIUS = 70;
/** `id 8 alchemy` — 유독 장판 지속 틱(3초). ⚠️ 영구(`life<0`) 금지(`shared.ts` §상한). */
const ALCHEMY_HAZARD_TICKS = 180;
/** `id 8 alchemy` — 유독 장판의 틱당 피해. 적에게도 플레이어에게도 같이 들어간다. */
const ALCHEMY_HAZARD_DAMAGE = 1;
/** 한 틱에 처리하는 융합 건수 상한. 격자 없이 O(n²) 를 도는 자리라 예산을 못 박는다. */
const ALCHEMY_FUSE_PER_TICK = 2;

/**
 * SplitMix32 계열 정수 해시. **RNG 를 한 칸도 소비하지 않는 파생**(헌장 §공통-B(a)) 이고
 * 선례는 `src/sim/drops.ts` 의 동명 함수다. 그쪽을 import 하지 않는 이유는 위
 * {@link RARITY_NORMAL} 주석과 같다(리프 유지).
 */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** 이 엔티티가 **표식을 찍어도 되는** 잡몹인가(보스·플레이어 `aux0` 는 뜻이 다르다). */
function taggableEnemy(e: Entity): boolean {
  return e.kind === 'enemy' && !e.dead;
}

/** 정련로 한 칸(등급 둘)에서 등급 하나의 재고를 읽는다. `hi` 가 상위 등급 쪽이다. */
function stockOf(packed: number, hi: boolean): number {
  return hi ? (packed >>> STOCK_BITS) & STOCK_MAX : packed & STOCK_MAX;
}

/** 정련로 한 칸에 등급 하나의 재고를 쓴다(폭 초과는 절삭 — 이웃 등급을 침범하지 않는다). */
function withStock(packed: number, hi: boolean, value: number): number {
  const v = value < 0 ? 0 : value > STOCK_MAX ? STOCK_MAX : value;
  const lo = packed & STOCK_MAX;
  const hiVal = (packed >>> STOCK_BITS) & STOCK_MAX;
  return hi ? ((v << STOCK_BITS) | lo) >>> 0 : ((hiVal << STOCK_BITS) | v) >>> 0;
}

/** 등급 코드 → 정련로 슬롯 번호. 0·1 은 {@link RefinementSlot.StockLow}, 2·3 은 `StockHigh`. */
function stockSlotOf(rarity: number): number {
  return rarity < 2 ? RefinementSlot.StockLow : RefinementSlot.StockHigh;
}

/** 등급 코드가 자기 슬롯 칸의 **상위 8비트** 쪽인가(1 과 3 이 상위). */
function stockHiOf(rarity: number): boolean {
  return (rarity & 1) === 1;
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
export function refineOnTick(state: WorldState, player: Entity): void {
  gildingTick(state, player);
  prospectTick(state);
}

// ---------------------------------------------------------------------------
// id 6 gilding — 도금 (§A · `aux0` `gilding` 2비트)
// ---------------------------------------------------------------------------

/**
 * 도금 시계. **1800틱-경계마다 화면의 모든 잡몹을 한 단계 올린다.**
 *
 * ## ⚠️ 왜 "적별 생존 시간"이 아니라 **전역 경계**인가 (실측 근거)
 * 적 엔티티에는 **스폰 틱을 담을 칸이 없다** — `aux1` 은 `MID_CLASH_LEADER_MARK` 가 매 런
 * 확정 점유하고(`catalystMarks.ts` §경고), `aux0` 촉매 구역은 2비트만 이 카드 몫이며,
 * `timer`·`iframes`·`ownerId` 는 전부 다른 소비자가 이미 싣고 있다. 새 칸을 만들면 헌장
 * §훅 예산이 이 카드를 **§A → §B 로 올린다**(예산 여유가 1뿐이라 그 순간 예산이 깨진다).
 *
 * 그래서 근사한다: 경계 직전에 태어난 적은 30초를 못 채우고 한 단계를 받는다. 규칙 문장의
 * *"살아 있는 시간에 비례해"* 와 **정확히 같지는 않다**(설계 정본과 어긋난 자리로 보고했다).
 * 방향은 보존된다 — 오래 사는 적일수록 단계가 높고, 상한 3 은 그대로다.
 *
 * ⚠️ 통지는 **경계 틱에 한 번**이다(1800틱당 1건). 매 틱 통지는 §가시성 규율의 틱당 64건
 * 상한을 혼자 먹는다.
 */
function gildingTick(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_GILDING)) return;
  if (state.tick <= 0 || state.tick % GILD_STEP_TICKS !== 0) return;
  let bumped = 0;
  for (const e of state.entities) {
    if (!taggableEnemy(e)) continue;
    const stage = readMark(e, 'gilding');
    if (stage >= GILD_MAX) continue;
    writeMark(e, 'gilding', stage + 1);
    bumped++;
  }
  if (bumped === 0) {
    // 축소 작동 — 적이 하나도 없어도 카드가 죽어 보이지 않게 "이번 경계는 도금할 것이
    // 없었다"를 놓침으로 적는다. 이득 없이 대가만 물리는 것이 아니라, 대가(적 강화)도 같이
    // 0 이므로 헌장 §축소 작동 규율을 만족한다.
    missCatalyst(state, CARD_GILDING, 1);
    return;
  }
  notifyCatalystFx(state, CARD_GILDING, CATALYST_FX.trigger, player.x, player.y);
}

// ---------------------------------------------------------------------------
// id 7 prospect — 시굴 (§A · `aux0` `prospect` 2비트)
// ---------------------------------------------------------------------------

/**
 * 광맥 보유자의 **호위 상태를 매 틱 갱신**한다 — 무적 여부를 비트 하나로 접어 두는 자리다.
 *
 * ## 왜 여기서 접어 두는가
 * 무적 판정의 실체는 *"근접 호위가 {@link PROSPECT_GUARD_MIN} 이상인가"* 라 공간 질의다.
 * 그것을 아군탄 명중 루프(`world.ts` 의 `grid.query` 콜백)에서 직접 재면 **탄 × 표적마다**
 * 공간 질의가 돌아 핫 경로가 무너진다. 그래서 틱당 한 번만 재서 `prospect` 필드에
 * {@link PROSPECT_SHIELDED} 로 접고, 소비자(`isPlayerTargetable` · 아군탄 루프)는 **비트 읽기
 * 하나**로 끝낸다.
 *
 * ⚠️ **조준 제외와 피해 차단은 한 쌍이다**(헌장). 둘 중 하나만 걸면 자동조준이 무적 표적을
 * 물어 DPS 가 통째로 버려지거나(`modes/objective.ts` §결함 #2), 반대로 "맞기는 하는데
 * 조준은 안 되는" 상태가 된다. 두 자리 모두 {@link isCatalystProspectShielded} 한 술어를 본다.
 *
 * ⚠️ 통지는 **상태가 뒤집히는 틱에만** 낸다(무적↔개방). 매 틱 내면 틱당 64건 상한을 먹는다.
 */
function prospectTick(state: WorldState): void {
  if (!carries(state, CARD_PROSPECT)) return;
  let holder: Entity | undefined;
  for (const e of state.entities) {
    if (!taggableEnemy(e)) continue;
    if (readMark(e, 'prospect') === 0) continue;
    holder = e;
    break;
  }
  if (holder === undefined) return;
  let guards = 0;
  const r2 = PROSPECT_GUARD_RADIUS * PROSPECT_GUARD_RADIUS;
  for (const e of state.entities) {
    if (e === holder || !taggableEnemy(e)) continue;
    const dx = e.x - holder.x;
    const dy = e.y - holder.y;
    if (dx * dx + dy * dy <= r2) guards++;
    if (guards >= PROSPECT_GUARD_MIN) break;
  }
  const next = guards >= PROSPECT_GUARD_MIN ? PROSPECT_SHIELDED : PROSPECT_OPEN;
  const prev = readMark(holder, 'prospect');
  if (prev === next) return;
  writeMark(holder, 'prospect', next);
  notifyCatalystFx(state, CARD_PROSPECT, CATALYST_FX.trigger, holder.x, holder.y);
  // 무적이 서면 그 동안은 못 뚫는다 = 놓친 창. 열리면 뚫을 수 있다 = 번 창.
  if (next === PROSPECT_SHIELDED) missCatalyst(state, CARD_PROSPECT, 1);
  else creditCatalyst(state, CARD_PROSPECT, 1);
}

// ---------------------------------------------------------------------------
// id 9 epiphany — **배선 완료**(파워업 3택 축). 거동 불변으로 `catalystHooks.ts` 에서 옮겨 왔다
// ---------------------------------------------------------------------------

/**
 * `id 9 epiphany` — 3택이 **1택으로 접힌다**(거부할 수 없다).
 *
 * 프리즈는 그대로라 픽 입력이 와야 런이 재개되고, `world.ts` 의 `idxOffered < length` 가드가
 * 1칸만 허용한다.
 *
 * ⚠️⚠️ **RNG 미소비.** `drawPowerupChoices` 가 이미 뽑아 놓은 결과를 **자리째 줄일 뿐**
 * 재추첨·추가 뽑기를 하지 않는다. 그래서 같은 시드의 `powerupRng` 스트림 위치가 촉매 유무와
 * 무관하게 동일하고, 이후 레벨의 3택도 통째로 같다.
 *
 * ⚠️ 적용 순서는 **mastery → epiphany 고정**이다(호출부 계약). mastery 가 전 칸을 첫 칸으로
 * 채운 뒤 epiphany 가 1칸으로 접으므로 남는 것은 첫 칸이다.
 */
export function epiphanyOnPowerupOffer(state: WorldState, offers: number[]): void {
  if (!carries(state, CARD_EPIPHANY)) return;
  offers.length = 1;
}

/**
 * `id 9 epiphany` 의 **중첩 추가분**(기본 1중첩 + 1 = 2중첩). `world.ts` 가 이미 기본 1중첩을
 * 적용한 뒤이므로 여기는 추가분만 센다.
 */
export function epiphanyExtraStacks(state: WorldState): number {
  return carries(state, CARD_EPIPHANY) ? 1 : 0;
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

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 refine 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function refineOnEnemyDamageTakenMult(
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

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/** {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnPlayerDamaged(state: WorldState, player: Entity, dmg: number, lethalSurvived: boolean, sources: DamageSourceMask): void {
  void state;
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/** {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void dmg;
  void source;
  // 핫 경로 — 명중마다 돈다. 첫 줄은 값싼 조기 반환이어야 한다(파일 §핫 경로 주석).
  if (!carries(state, CARD_GILDING)) return;
  // 이 앵커는 **피해 확정 + 격추 판정 직후**라(`world.ts` 앵커 ⑩ 주석) `dead` 가 그 틱의
  // 진실이다. 즉 여기서 `dead` 면 방금 이 명중으로 죽은 것이다.
  if (!target.dead || target.kind !== 'enemy') return;
  const stage = readMark(target, 'gilding');
  if (stage === 0) return;
  // ⚠️ **죽은 쪽의 표식을 지우지 않는다.** 같은 틱의 `compact()` 안에서 전리품 등급 롤
  // (`refineOnLootRoll`)이 시체의 도금 단계를 읽어야 하기 때문이다 — 지우면 *"전리품 등급은
  // 도금 단계를 따라간다"* 가 조용히 무효가 된다. 시체는 그 틱에 `state.entities` 에서
  // 사라지므로 남겨도 다음 틱에 영향이 없다.
  let best: Entity | undefined;
  let bestD2 = Infinity;
  for (const e of state.entities) {
    if (e === target || !taggableEnemy(e)) continue;
    const dx = e.x - target.x;
    const dy = e.y - target.y;
    const d2 = dx * dx + dy * dy;
    // 동률은 **배열 순서가 앞선 쪽**이 이긴다(`<` 비교) — 결정론 타이브레이크.
    if (d2 < bestD2) {
      bestD2 = d2;
      best = e;
    }
  }
  if (best === undefined) {
    // 옮겨 붙을 데가 없으면 도금이 그대로 사라진다(축소 작동 — 대가도 같이 사라진다).
    missCatalyst(state, CARD_GILDING, stage);
    return;
  }
  const cur = readMark(best, 'gilding');
  writeMark(best, 'gilding', cur >= stage ? cur : stage);
  notifyCatalystFx(state, CARD_GILDING, CATALYST_FX.trigger, best.x, best.y);
  creditCatalyst(state, CARD_GILDING, stage);
}

/** {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void state;
  void x;
  void y;
  void elite;
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnPowerupOffer(state: WorldState, offers: number[]): void {
  void offers;
  if (!carries(state, CARD_REFINEMENT)) return;
  // ## ⚠️⚠️ **선택지를 한 칸도 안 건드린다 — 재추첨은 물론 자리 덮기도 안 한다**
  // 카탈로그는 *"3택 한 칸이 정련로 카드로 바뀌어 보인다"* 라고 적었지만, sim 이 그것을
  // 표현할 수 있는 값은 `POWERUPS` 의 인덱스뿐이다. 두 경로 다 막혀 있다:
  //   ① `POWERUPS` 에 정련 항목을 **추가**하면 `drawPowerupChoices` 의 풀 구성이 바뀌어
  //      **무촉매 런의 3택이 통째로 달라진다**(`scripts/catalystByteInvariance.ts` 가 깨진다).
  //   ② 풀 밖의 **센티넬 코드**를 꽂으면 sim 은 견디지만(`applyPowerup` 이 `undefined` 무연산)
  //      `src/main.ts:2732` 의 오버레이가 그 인덱스로 정의를 찾다 빈 카드를 그린다.
  // 그래서 이 레인은 **정련로를 3택 밖에서 돌린다**(입고는 수거 순간, 승급은 셋이 모이는
  // 순간). 설계 정본과 어긋나는 자리라 인계에 보고했다.
  //
  // 여기서 하는 것은 **가시성 하나** — 레벨업마다 정련로 잔량이 있으면 발동 통지를 내
  // HUD 가 슬롯을 번쩍이게 한다. 레벨업당 1건이라 틱당 64건 상한과 무관하다.
  const low = readCatalystSlot(state.catalystSlots, RefinementSlot.StockLow);
  const high = readCatalystSlot(state.catalystSlots, RefinementSlot.StockHigh);
  if (low === 0 && high === 0) return;
  // ⚠️ 자리 인자는 0,0 이다 — 이 앵커에는 플레이어가 안 넘어오고(`offers` 뿐) `world.js` 는
  // type-only 라 값으로 끌 수 없다. HUD 슬롯 번쩍임은 좌표를 안 쓴다.
  notifyCatalystFx(state, CARD_REFINEMENT, CATALYST_FX.trigger, 0, 0);
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  void state;
  void amount;
  void x;
  void y;
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/** {@link import('../catalystHooks.js').onLootRollCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  void elite;
  const gild = carries(state, CARD_GILDING);
  const prospect = carries(state, CARD_PROSPECT);
  if (!gild && !prospect) return CATALYST_LOOT_NEUTRAL;
  // 이 앵커는 `compact()` 의 순회 **안**에서 불리고(호출부 `world.ts:5068`) 시체가 아직
  // `state.entities` 에 남아 있다 — `state.entities = survivors` 는 루프 **뒤**다. 그래서
  // 좌표로 시체를 되찾을 수 있고, 이것이 "이 드랍을 낸 적이 누구였나"를 아는 유일한 경로다
  // (앵커 시그니처가 엔티티를 안 넘긴다).
  let stage = 0;
  let vein = false;
  for (const e of state.entities) {
    if (e.kind !== 'enemy' || !e.dead) continue;
    if (e.x !== x || e.y !== y) continue;
    if (gild) stage = readMark(e, 'gilding');
    if (prospect) vein = readMark(e, 'prospect') !== 0;
    break;
  }
  let rarity = 1;
  if (stage > 0) rarity *= 1 + GILD_RARITY_PER_STAGE * stage;
  if (vein) rarity *= PROSPECT_RARITY;
  if (rarity === 1) return CATALYST_LOOT_NEUTRAL;
  // ⚠️ **재롤이 아니다** — 이미 뽑힌 롤에 곱하는 배율만 돌려준다(헌장 §공통-B(c)).
  return { rarity, count: 1 };
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnLootCollected(state: WorldState, loot: Entity): boolean {
  if (!carries(state, CARD_REFINEMENT)) return false;
  const rarity = loot.enemyType;
  // 최상 등급은 올릴 칸이 없다 — 정련로를 통과시킨다(축소 작동: 대가도 안 물린다).
  if (rarity < RARITY_NORMAL || rarity >= RARITY_TOP) return false;
  const slot = stockSlotOf(rarity);
  const hi = stockHiOf(rarity);
  const packed = readCatalystSlot(state.catalystSlots, slot);
  const next = stockOf(packed, hi) + 1;
  if (next < REFINE_COST) {
    // **정련로에 들어갔다** — 인벤(`state.loot`)에는 안 실린다. 이것이 카드의 대가다:
    // 셋이 안 모이면(또는 런에 지면) 넣은 것은 그대로 사라진다. 잔량은 슬롯에 남고
    // `catalystSettlementOf` 가 24칸을 그대로 내보내므로 정산이 그것을 본다.
    writeCatalystSlot(state.catalystSlots, slot, withStock(packed, hi, next));
    missCatalyst(state, CARD_REFINEMENT, 1);
    notifyCatalystFx(state, CARD_REFINEMENT, CATALYST_FX.trigger, loot.x, loot.y);
    return true;
  }
  // 셋이 모였다 — 재고를 비우고 **이 전리품을 한 단계 위로 승급시켜** 그대로 실어 보낸다.
  // ⚠️ 호출부(`collectLoot`)는 이 훅이 `false` 를 돌려준 **뒤에** `loot.enemyType` 을 읽어
  // `state.loot` 에 싣는다. 그래서 제자리 승급이 성립한다(새 엔티티를 만들 필요가 없다).
  writeCatalystSlot(state.catalystSlots, slot, withStock(packed, hi, 0));
  loot.enemyType = rarity + 1;
  creditCatalyst(state, CARD_REFINEMENT, 1);
  notifyCatalystFx(state, CARD_REFINEMENT, CATALYST_FX.trigger, loot.x, loot.y);
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  void prevSegment;
  if (!carries(state, CARD_PROSPECT)) return;
  // ⚠️ **RNG 미소비 지목**(헌장 §공통-B(a)) — 웨이브 인덱스에서 `mix32` 로 순수 파생한다.
  // `waveRng`/`dropRng`/`powerupRng` 어느 스트림도 건드리지 않으므로 같은 시드의 전개가
  // 촉매 유무와 무관하게 같다.
  let alive = 0;
  for (const e of state.entities) {
    if (!taggableEnemy(e)) continue;
    // 이전 웨이브의 광맥은 여기서 벗겨진다(웨이브당 보유자는 하나다).
    if (readMark(e, 'prospect') !== 0) writeMark(e, 'prospect', 0);
    alive++;
  }
  if (alive === 0) {
    // 축소 작동 — 지목할 적이 없는 전환에서는 아무 이득도 대가도 없다.
    missCatalyst(state, CARD_PROSPECT, 1);
    return;
  }
  const pick = mix32(nextSegment >>> 0, SALT_PROSPECT) % alive;
  let i = 0;
  for (const e of state.entities) {
    if (!taggableEnemy(e)) continue;
    if (i++ !== pick) continue;
    // 지목 직후는 **개방**이다. 무적 여부는 다음 틱의 {@link prospectTick} 이 호위 수로 정한다.
    writeMark(e, 'prospect', PROSPECT_OPEN);
    notifyCatalystFx(state, CARD_PROSPECT, CATALYST_FX.trigger, e.x, e.y);
    return;
  }
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnEnemyStep(state: WorldState, e: Entity): number {
  // 핫 경로 — 적마다 매 틱 돈다. 무도금이면 정확히 `1` 이라 호출부가 def 복제조차 안 한다.
  if (!carries(state, CARD_GILDING)) return 1;
  const stage = readMark(e, 'gilding');
  if (stage === 0) return 1;
  // `id 6` 의 **대가 축** — 도금된 적은 그만큼 강해진다. 여기서는 `e` 에 쓰기를 하지 않는다
  // (앵커 계약: 이 자리는 `stepEnemies` 순회 안이다).
  return 1 + GILD_SPEED_PER_STAGE * stage;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/** {@link import('../catalystHooks.js').stepCatalystHazards} 의 refine 몫. **미배선**(위 §주석). */
export function refineOnCatalystHazards(state: WorldState): void {
  if (!carries(state, CARD_ALCHEMY)) return;
  // ── id 8 alchemy — 바닥의 노말 셋이 매직 하나로 융합하고, 그 자리가 유독 장판이 된다 ──
  //
  // ## ⚠️ `id 5 refinement` 와의 **재료 우선순위 = alchemy 먼저**
  // 두 카드는 같은 재료(노말 등급 전리품)를 다툰다(카탈로그 §창발 메모가 *"우선순위를 구현
  // 레인에서 명시해야 한다"* 고 남긴 자리다). 규칙을 **단계로** 정한다:
  //
  //   ① `id 8` 은 **바닥에 있는 동안** 손댄다(이 함수 — `stepWorld` 의 해저드 단계).
  //   ② `id 5` 는 **수거하는 순간** 손댄다(`refineOnLootCollected`).
  //
  // ①이 ②보다 시간상 **항상 앞**이므로 우선순위는 alchemy 다. 근거는 자의적 선택이 아니라
  // 두 앵커의 위치다 — 같은 전리품이 바닥에 있는 동안 융합될 기회를 먼저 갖고, 살아남아
  // 수거된 것만 정련로로 들어간다. 둘 다 실린 런에서 노말 셋은 항상 매직 하나로 접힌 뒤
  // 정련로의 **매직 칸**에 쌓인다(노말 칸은 사실상 비어 있게 된다). 이 순서는 앵커 배치에서
  // 나오므로 같은 시드가 항상 같은 결과를 낸다.
  //
  // ⚠️ 스폰은 순회 **밖**에서 한다(`shared.ts` §스폰 규약). 좌표만 모은다.
  const spots: { x: number; y: number }[] = [];
  const group: Entity[] = [];
  const r2 = ALCHEMY_FUSE_RADIUS * ALCHEMY_FUSE_RADIUS;
  for (const seed of state.entities) {
    if (spots.length >= ALCHEMY_FUSE_PER_TICK) break;
    if (seed.dead || seed.kind !== 'loot' || seed.enemyType !== RARITY_NORMAL) continue;
    group.length = 0;
    for (const other of state.entities) {
      if (other === seed || other.dead || other.kind !== 'loot') continue;
      if (other.enemyType !== RARITY_NORMAL) continue;
      const dx = other.x - seed.x;
      const dy = other.y - seed.y;
      if (dx * dx + dy * dy > r2) continue;
      group.push(other);
      if (group.length >= ALCHEMY_FUSE_COUNT - 1) break;
    }
    if (group.length < ALCHEMY_FUSE_COUNT - 1) continue;
    // 셋 중 **씨앗 하나만 살려** 매직으로 올리고 나머지는 지운다. 씨앗은 배열 순서가 가장
    // 앞선 것이라 결정론적이다(질의 순서에 의존하지 않는다).
    for (const g of group) g.dead = true;
    seed.enemyType = RARITY_NORMAL + 1;
    spots.push({ x: seed.x, y: seed.y });
    creditCatalyst(state, CARD_ALCHEMY, 1);
    notifyCatalystFx(state, CARD_ALCHEMY, CATALYST_FX.trigger, seed.x, seed.y);
    // 지운 둘은 회수 못 한 전리품이다 — 대가로 적는다.
    missCatalyst(state, CARD_ALCHEMY, ALCHEMY_FUSE_COUNT - 1);
  }
  // 유독 장판 — **그 위의 모든 것을 태운다**. 적 피해는 `stepCatalystHazards` 의 공용 루프가,
  // 플레이어 피해는 `world.ts` 의 `kind === 'hazard' && hazardActive(t)` 분기가 진다.
  // ⚠️ 시한부다(`life<0` 금지 — `shared.ts` §상한). 동시 상한 초과분은 조용히 생략되고
  //    그때도 **RNG 를 한 칸도 안 쓴다**.
  for (const s of spots) {
    spawnCatalystHazard(
      state,
      s.x,
      s.y,
      ALCHEMY_HAZARD_RADIUS,
      0,
      ALCHEMY_HAZARD_TICKS,
      ALCHEMY_HAZARD_DAMAGE,
      true,
    );
  }
}
