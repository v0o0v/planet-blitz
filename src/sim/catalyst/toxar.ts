/**
 * 촉매 **톡사르 특산**(id 42~44) — 카드 본체가 들어갈 자리.
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
import {
  CATALYST_LOOT_NEUTRAL,
  carries,
  isCatalystHazardMarked,
  spawnCatalystHazard,
} from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { CATALYST_FX, creditCatalyst, missCatalyst, notifyCatalystFx } from './fx.js';
import { circlesOverlap } from '../collision.js';
import { isContaminationCell } from '../modes/contamination.js';

/** id 42 — slug `toxar-outbreak`. 정본은 `src/data/catalysts.ts`. */
export const CARD_TOXAR_OUTBREAK = 42;

/** id 43 — slug `toxar-blightspore`. 정본은 `src/data/catalysts.ts`. */
export const CARD_TOXAR_BLIGHTSPORE = 43;

/** id 44 — slug `toxar-blight-mother`. 정본은 `src/data/catalysts.ts`. */
export const CARD_TOXAR_BLIGHT_MOTHER = 44;

// ---------------------------------------------------------------------------
// id 42 toxar-outbreak — 정화가 절반만 · 오염 위 탄이 커진다 · 오염 위 처치는 이중 드랍
// ---------------------------------------------------------------------------

/**
 * **정화 계수의 하한. 이 값은 계약이지 밸런스 노브가 아니다.**
 *
 * 0 으로 내리면 오염이 단조 증가로 돌아가 실패가 *"되돌릴 수 없는 숨은 카운트다운"* 이 된다 —
 * 사용자 신고 2026-07-27 을 그대로 재현하는 형태이고 헌장 §페널티 금지 ③ 이 금지한 축이다
 * (경위 전문은 `modes/contamination.ts` 의 {@link import('../modes/contamination.js').purifyContamination}
 * 주석). 그래서 이 카드는 정화를 **정확히 절반**으로 늦추는 데서 멈춘다.
 */
export const TOXAR_PURIFY_FACTOR_MIN = 0.5;

/** `id 42` 의 정화 계수(하한과 같다 — 위 §계약). */
export const TOXAR_PURIFY_FACTOR = 0.5;

/**
 * 정화 판정 간격에 곱할 **정수 배수**. `world.ts` 가
 * {@link import('../modes/contamination.js').purifyContamination} 에 넘긴다.
 *
 * ## 왜 간선이 이 방향인가
 * `modes/contamination.ts` 가 이 모듈을 끌면 **순환**이다(이 모듈이 그 모듈의 셀 판별자를 쓴다).
 * 그래서 모드는 배수를 **인자로 받고**, 호출부인 `world.ts` 가 촉매를 읽어 넘긴다 —
 * `catalystHooks.ts` 헤더 §「모드 진행 게이트를 만지는 특산 7종은 여기서 모드를 읽는다」의
 * 간선 방향 그대로다.
 *
 * 계수 0.5 = 간격 2배다. 하한을 코드로 잠근다 — 계수를 더 내리려는 편집은 여기서 막힌다.
 */
export function toxarPurifyIntervalMult(state: WorldState): number {
  if (!state.catalystOn || !carries(state, CARD_TOXAR_OUTBREAK)) return 1;
  const f = TOXAR_PURIFY_FACTOR < TOXAR_PURIFY_FACTOR_MIN
    ? TOXAR_PURIFY_FACTOR_MIN
    : TOXAR_PURIFY_FACTOR;
  return Math.round(1 / f);
}

/** 오염 셀 하나를 밟을 때마다 아군탄 반경에 더하는 양. */
const TOXAR_BULLET_GROWTH = 1.2;

/** 오염을 먹고 커진 아군탄의 반경 상한(무한 성장 방지 — 화면을 덮는 탄을 만들지 않는다). */
const TOXAR_BULLET_RADIUS_CAP = 36;

/** 오염 위에서 죽은 적의 전리품 개수 배율(상한 드랍 ×2.4 안). */
const TOXAR_OUTBREAK_LOOT = 2;

// ---------------------------------------------------------------------------
// id 43 toxar-blightspore — 처치 자리에 포자 구름
// ---------------------------------------------------------------------------

/**
 * 포자 구름 해저드의 마커(`hazard.ownerId`). 촉매 해저드는 여섯 카드가 같은 서브타입을
 * 공유하므로, 자기 것만 골라내려면 마커가 필요하다({@link isCatalystHazardMarked}).
 */
export const TOXAR_SPORE_MARK = 0xc0de43;

/** 구름 반경. */
const TOXAR_SPORE_RADIUS = 190;

/**
 * 구름 지속 틱.
 *
 * ⚠️ **최소 2 다.** `stepHazards` 가 `life` 를 **먼저** 깎고 0 이면 그 자리에서 `dead` 를 세우는데,
 * `stepCatalystHazards` 는 같은 틱의 **뒤**에서 돌면서 `dead` 를 거른다 — `activeTicks = 1` 인
 * 해저드는 한 번도 효과를 못 낸다(앞 레인 실측). 이 카드의 구름은 피해가 0 이라 그 공용 루프를
 * 아예 안 타지만(아래 §피해 0), 판정이 `hazardActive` 위치 질의라 같은 수명 규율을 진다.
 */
const TOXAR_SPORE_TICKS = 180;

/** 구름 안 적의 이동 배율(앵커 `OnEnemyStep` — 중립 1). */
const TOXAR_SPORE_SPEED = 2;

/** 구름 안에서 죽은 적의 전리품 개수 배율(상한 드랍 ×2.0). */
const TOXAR_SPORE_LOOT = 2;

// ---------------------------------------------------------------------------
// id 44 toxar-blight-mother — 보스의 4단째 페이즈
// ---------------------------------------------------------------------------

/**
 * **두 번째 형태의 페이즈 인덱스**. 보스는 0/1/2 세 페이즈이므로 3 이 곧 *"4단째"* 다.
 *
 * ⚠️ `boss` kind 를 죽였다가 다시 만들지 않는다 — kind 사망은 곧 런 승리다. 이 카드는
 * **hp 가 0 을 찍는 그 순간**(앵커 ⑩ `OnEnemyDamaged`)에 페이즈를 3 으로 올리고 hp 를
 * 되세워, 보스가 **한 번도 죽지 않게** 만든다. 그래서 상태를 들 슬롯도, 순회 밖으로 미룰
 * 표식도 필요 없다 — 표식이 곧 `boss.phase` 다(보스 `aux0` 는 추격 취약화 플래그라 금지).
 *
 * `boss.phase = 3` 은 `bossDef.phases[3]` 이 없다 — `src/sim/boss.ts` 가 **마지막 페이즈로
 * 접어** 공격 세트를 잇는다(그 한 줄이 4단째를 실체로 만든다). 무촉매 런은 `targetPhase` 가
 * 2 를 넘지 않아 그 분기에 절대 도달하지 않는다(바이트 불변).
 */
export const TOXAR_MOTHER_PHASE = 3;

/** 두 번째 형태로 일어설 때 되세우는 hp 비율(최대 HP 대비). */
const TOXAR_MOTHER_HP_FRAC = 0.6;

/**
 * 두 번째 형태로 일어서는 동안의 프리즈 틱 = 보스 페이즈 전환 애니메이션과 **같은 2초**.
 *
 * ⚠️ `boss.ts` 의 `BOSS_PHASE_TRANSITION_TICKS` 를 import 하지 않고 값을 적었다 — 이 모듈은
 * 리프여야 하고(`boss.ts` 는 `waves.js`·`modes/chase.js` 를 값으로 끈다) 그 사슬을 끌어오면
 * 순환이 생긴다. 두 값이 갈리면 전환 연출의 길이만 달라지고 규칙은 안 바뀐다.
 */
const TOXAR_MOTHER_TRANSITION_TICKS = 120;

/** 두 번째 형태를 잡았을 때의 전리품 등급 배율(상한 희귀도 ×2.6). */
const TOXAR_MOTHER_RARITY = 2.6;

/**
 * 잠금·해제 장부에 적는 **판돈 눈금**(전리품 1건). sim 은 아이템의 실제 값을 모르므로
 * (`catalystMarks.ts` §액수 주석과 같은 규율) 여기 실리는 것은 건수다.
 */
const TOXAR_MOTHER_STAKE = 1;

// ---------------------------------------------------------------------------
// 위치 질의 — 세 카드가 공유하는 순수 술어(상태 저장 0)
// ---------------------------------------------------------------------------

/** (x,y) 반경 r 이 살아 있는 오염 지형 셀과 겹치는가. `id 42` 의 유일 판정. */
function onContamination(state: WorldState, x: number, y: number, r: number): boolean {
  for (const c of state.entities) {
    if (c.dead || !isContaminationCell(c)) continue;
    if (circlesOverlap(c.x, c.y, c.radius, x, y, r)) return true;
  }
  return false;
}

/** (x,y) 반경 r 이 살아 있는 포자 구름과 겹치는가. `id 43` 의 유일 판정(적 상태 저장 없음). */
function inSporeCloud(state: WorldState, x: number, y: number, r: number): boolean {
  for (const h of state.entities) {
    if (h.dead || !isCatalystHazardMarked(h, TOXAR_SPORE_MARK)) continue;
    if (circlesOverlap(h.x, h.y, h.radius, x, y, r)) return true;
  }
  return false;
}

/**
 * 이번 격추가 **두 번째 형태**였는가 — 아직 `state.entities` 안에 남아 있는 `dead` 보스의
 * 페이즈로 판정한다.
 *
 * 앵커 ⑱·⑲ 는 `compact` 의 `for (const e of state.entities)` **안**에서 불리고
 * `state.entities = survivors` 는 그 루프가 끝난 **뒤**라, 이 시점의 시체는 아직 배열에 있다.
 */
function bossSecondFormDown(state: WorldState): boolean {
  for (const b of state.entities) {
    if (b.kind !== 'boss' || !b.dead) continue;
    if (b.phase >= TOXAR_MOTHER_PHASE) return true;
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
export function toxarOnTick(state: WorldState, player: Entity): void {
  void player;
  outbreakBulletTick(state);
}

/**
 * `id 42` 의 매 틱 몫 — **오염 위의 아군탄이 오염을 먹고 커진다**(밟은 셀 수만큼).
 *
 * ⚠️ 셀을 먼저 한 번만 모은다 — 탄마다 전 엔티티를 다시 훑으면 O(탄 × 엔티티)가 된다
 * (`catalyst/drops.ts` 의 `harvestTick` 이 같은 형태로 이미 서 있다).
 *
 * ⚠️ 통지는 하지 않는다 — 매 틱 도는 자리이고(헌장 §틱당 64건 상한), 커진 반경은
 * `bullet.radius` 라 **그 자체가 화면에 그대로 보인다**.
 */
function outbreakBulletTick(state: WorldState): void {
  if (!carries(state, CARD_TOXAR_OUTBREAK)) return;
  const cells: Entity[] = [];
  for (const c of state.entities) if (!c.dead && isContaminationCell(c)) cells.push(c);
  if (cells.length === 0) return;
  for (const b of state.entities) {
    if (b.dead || b.kind !== 'bullet') continue;
    let stepped = 0;
    for (const c of cells) {
      if (circlesOverlap(c.x, c.y, c.radius, b.x, b.y, b.radius)) stepped++;
    }
    if (stepped === 0) continue;
    const grown = b.radius + TOXAR_BULLET_GROWTH * stepped;
    b.radius = grown > TOXAR_BULLET_RADIUS_CAP ? TOXAR_BULLET_RADIUS_CAP : grown;
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

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 toxar 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function toxarOnEnemyDamageTakenMult(
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

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/** {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnPlayerDamaged(state: WorldState, player: Entity, dmg: number, lethalSurvived: boolean, sources: DamageSourceMask): void {
  void state;
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 toxar 몫 —
 * **`id 44` 의 4단째 페이즈 전환이 여기서 일어난다.**
 *
 * ## 왜 `OnBossDeath` 가 아니라 여기인가
 * `OnBossDeath` 시점의 보스는 이미 `dead` 이고 곧 `state.entities` 밖으로 나간다 — 되살리려면
 * 새로 스폰해야 하는데 그 호출은 `compact` 순회 **안**이라 스폰이 금지돼 있고, `boss` kind 를
 * 다시 만드는 것 자체가 조준 술어·충돌 격자·아군탄 화이트리스트 **세 목록을 갈라 놓는다**.
 *
 * 이 앵커는 `t.hp -= dealt` **직후**라(`world.ts` 의 아군탄 명중 루프) 페이즈를 올리고 hp 를
 * 되세우면 보스가 **애초에 죽지 않는다** — 전환이 곧 재해석이라 스폰도, 승리 억제도, 표식을
 * 들 슬롯도 필요 없다. 수호 기체의 격추 재기동(`guardian` `phase > 0`)이 같은 형태의 선례다.
 *
 * ⚠️ 이 앵커가 불리는 시점엔 `t.dead` 가 **이미 서 있다**(`world.ts` 가 hp 감산 직후에 세운다).
 * 그래서 `dead` 를 명시적으로 내려야 `compact` 가 시체를 수거하지 않는다.
 *
 * ⚠️ 이 앵커는 **아군탄 명중 경로만** 덮는다. 보스를 그 밖의 경로로 죽이는 피해원은 이 저장소에
 * 없다(촉매 해저드는 `id 43` 구름이 피해 0 이고, 접촉·압사는 플레이어 쪽 피해다).
 */
export function toxarOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void dmg;
  void source;
  if (target.kind !== 'boss') return;
  if (!carries(state, CARD_TOXAR_BLIGHT_MOTHER)) return;
  if (target.phase >= TOXAR_MOTHER_PHASE || target.hp > 0) return;
  // 두 번째 형태로 일어선다 — 페이즈 전환 프리즈(2초)가 "부풀어 터지며 일어서는" 그 박자다.
  target.dead = false;
  target.hp = Math.round(target.maxHp * TOXAR_MOTHER_HP_FRAC);
  target.phase = TOXAR_MOTHER_PHASE;
  target.timer = TOXAR_MOTHER_TRANSITION_TICKS;
  target.iframes = 0;
  target.cooldown = 0;
  target.dashCooldown = 0;
  // 헌장 §가시성 — **잠금이 화면에 읽혀야 한다.** 첫 형태의 보상은 이 순간 판돈이 되어
  // 장부의 `missed` 로 들어가고, 두 번째를 잡으면 아래 전리품 앵커가 세 배로 `earned` 를 적는다.
  missCatalyst(state, CARD_TOXAR_BLIGHT_MOTHER, TOXAR_MOTHER_STAKE);
  notifyCatalystFx(state, CARD_TOXAR_BLIGHT_MOTHER, CATALYST_FX.trigger, target.x, target.y);
}

/**
 * {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 toxar 몫 —
 * **`id 43` 이 처치 자리에 포자 구름을 남긴다.**
 *
 * ⚠️ 이 앵커는 `state.entities = survivors` **뒤**에 불리므로 스폰이 안전하다(`compact` 꼬리의
 * `for (const d of enemyDeaths)` 루프). 상한(12)에 걸리면 {@link spawnCatalystHazard} 이
 * **RNG 를 한 칸도 안 쓰고** 생략만 하므로 시드 스트림이 밀리지 않는다.
 */
export function toxarOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void elite;
  if (!carries(state, CARD_TOXAR_BLIGHTSPORE)) return;
  const cloud = spawnCatalystHazard(
    state,
    x,
    y,
    TOXAR_SPORE_RADIUS,
    0, // windup: 즉시(예열이 있으면 처치 직후의 그 자리라는 그림이 흐려진다)
    TOXAR_SPORE_TICKS,
    0, // damage 0 — 구름은 **가속과 배당의 장**이지 피해원이 아니다(공용 피해 루프 미진입)
    true, // continuous(phase 1) — 위치 질의가 활성 창 내내 성립해야 한다
    TOXAR_SPORE_MARK,
  );
  if (cloud === undefined) return;
  notifyCatalystFx(state, CARD_TOXAR_BLIGHTSPORE, CATALYST_FX.trigger, x, y);
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  void state;
  void amount;
  void x;
  void y;
}

/**
 * {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 toxar 몫 — **억제하지 않는다.**
 *
 * ## 왜 `id 44` 가 이 억제를 안 쓰는가 (설계 정본과 갈리는 자리 — 보고 대상)
 * 카탈로그는 이 앵커를 `id 44` 의 소비처로 적었지만, 억제는 **승리·보스 드랍을 통째로
 * 건너뛴다.** 즉 억제한 뒤에 두 번째 형태를 세우지 못하면 보스는 사라졌는데 승리 조건은 남아
 * **런이 그 자리에서 교착**한다(헌장 §페널티 금지 ④). 그리고 여기서는 스폰이 금지돼 있어
 * (`compact` 순회 안) 두 번째 형태를 이 시점에 세울 방법이 원리적으로 없다.
 *
 * 그래서 이 카드는 **죽기 전에** 개입한다({@link toxarOnEnemyDamaged}) — 보스가 한 번도 죽지
 * 않으므로 억제할 격추 자체가 없고, 교착 경로가 구조적으로 생기지 않는다. 두 번째 형태의
 * 격추는 정상적인 승리이고 그때 이 함수는 종전대로 `false` 를 돌려준다.
 */
export function toxarOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 toxar 몫 — 세 카드가 전부 여기 걸린다.
 *
 *  - `id 42` — **오염 위**에서 죽었으면 개수 ×2
 *  - `id 43` — **포자 구름 안**에서 죽었으면 개수 ×2
 *  - `id 44` — 이번 격추가 **두 번째 형태**면 등급 ×2.6 (잠겼던 판돈이 여기서 풀린다)
 *
 * ⚠️ **재롤이 아니다** — 이미 뽑힌 결과에 곱하는 자리라 RNG 를 한 칸도 소비하지 않는다.
 */
export function toxarOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  let rarity = 1;
  let count = 1;
  if (carries(state, CARD_TOXAR_OUTBREAK) && onContamination(state, x, y, 0)) {
    count *= TOXAR_OUTBREAK_LOOT;
    notifyCatalystFx(state, CARD_TOXAR_OUTBREAK, CATALYST_FX.trigger, x, y);
    creditCatalyst(state, CARD_TOXAR_OUTBREAK, TOXAR_OUTBREAK_LOOT - 1);
  }
  if (carries(state, CARD_TOXAR_BLIGHTSPORE) && inSporeCloud(state, x, y, 0)) {
    count *= TOXAR_SPORE_LOOT;
    notifyCatalystFx(state, CARD_TOXAR_BLIGHTSPORE, CATALYST_FX.trigger, x, y);
    creditCatalyst(state, CARD_TOXAR_BLIGHTSPORE, TOXAR_SPORE_LOOT - 1);
  }
  // 보스 확정 드랍(`elite === false`)에서만 본다 — 엘리트 드랍은 두 번째 형태와 무관하다.
  if (!elite && carries(state, CARD_TOXAR_BLIGHT_MOTHER) && bossSecondFormDown(state)) {
    rarity *= TOXAR_MOTHER_RARITY;
    notifyCatalystFx(state, CARD_TOXAR_BLIGHT_MOTHER, CATALYST_FX.trigger, x, y);
    // 판돈의 세 배 — 잠금(위 `missed`)이 풀리며 펼쳐지는 그 액수다.
    creditCatalyst(state, CARD_TOXAR_BLIGHT_MOTHER, TOXAR_MOTHER_STAKE * 3);
  }
  if (rarity === 1 && count === 1) return CATALYST_LOOT_NEUTRAL;
  return { rarity, count };
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/**
 * {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 toxar 몫 —
 * **`id 43` 구름 안의 적은 두 배로 빨라진다.**
 *
 * ⚠️ 핫 경로(적마다 매 틱 × 13그룹)라 첫 줄이 값싼 조기 반환이다. 판정은 **위치 질의**뿐이라
 * 적에 상태를 남기지 않는다 — 초판의 "감염된 적"은 적 대상 **4번째 디버프 축**이라 기각됐고,
 * 그래서 `catalystMarks` 를 한 비트도 쓰지 않는다.
 */
export function toxarOnEnemyStep(state: WorldState, e: Entity): number {
  if (!carries(state, CARD_TOXAR_BLIGHTSPORE)) return 1;
  if (e.kind !== 'enemy') return 1;
  return inSporeCloud(state, e.x, e.y, e.radius) ? TOXAR_SPORE_SPEED : 1;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/** {@link import('../catalystHooks.js').stepCatalystHazards} 의 toxar 몫. **미배선**(위 §주석). */
export function toxarOnCatalystHazards(state: WorldState): void {
  void state;
}
