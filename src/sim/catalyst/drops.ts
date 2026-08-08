/**
 * 촉매 **드랍 축**(id 0~4) — 카드 본체.
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
 *
 * ## ⭐ 이 그룹이 지키는 공통 규율 (어기면 무촉매 런이 갈린다)
 *  1. **RNG 를 한 칸도 소비하지 않는다.** 등급·드랍은 **이미 뽑힌 결과에 곱할** 뿐이고
 *     (`dropsOnLootRoll`), 억제도 굴린 뒤 결과를 버리는 형태다. 새 난수도 안 만든다 —
 *     이 그룹의 모든 수치가 피해량·좌표·등급코드의 **순수 파생**이다.
 *  2. **적 표식은 `catalystMarks` 접근자로만**(`aux0` 촉매 비트). `aux1`·`player.aux0/aux1`·
 *     `player.targetX` 는 한 번도 안 만진다.
 *  3. **새 `WorldState` 칸이 0 개다** — 다섯 장 전부 §A 로 배선됐다. 쓰는 슬롯은 배정표가
 *     이미 준 {@link AbundanceSlot.GroundLoot} 한 칸뿐이다.
 *  4. **스폰은 순회 밖에서만.** 어느 앵커가 순회 안인지는 각 함수 doc 에 실측으로 적었다.
 *
 * ## ⚠️ 틱 스크래치 두 벌 — 왜 모듈 지역 배열인가
 * {@link PLUNDER_LOST}·{@link HARVEST_PIERCE_KILLS} 는 **한 틱 안에서만** 산다(채우는 앵커와
 * 읽는 앵커가 같은 틱의 앞뒤다). {@link dropsOnTick} 이 매 틱 첫머리에서 비우므로 틱을 넘겨
 * 살아남지 않고, 그래서 `WorldState` 칸도 해시 폴드도 필요 없다 —
 * `catalystHooks.ts` 의 `DASH_PIERCE_SCRATCH` 와 같은 규율이다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { spawnLoot, hazardActive } from '../entities.js';
import { isElite } from '../elite.js';
import { circlesOverlap } from '../collision.js';
import { readMark, writeMark } from '../catalystMarks.js';
import { AbundanceSlot, readCatalystSlot, writeCatalystSlot } from '../catalystSlots.js';
import { CATALYST_LOOT_NEUTRAL, carries, isCatalystHazard, spawnCatalystHazard } from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { CATALYST_FX, notifyCatalystFx, creditCatalyst, missCatalyst } from './fx.js';

/** id 0 — slug `abundance`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ABUNDANCE = 0;

/** id 1 — slug `plunder`. 정본은 `src/data/catalysts.ts`. */
export const CARD_PLUNDER = 1;

/** id 2 — slug `harvest`. 정본은 `src/data/catalysts.ts`. */
export const CARD_HARVEST = 2;

/** id 3 — slug `bounty`. 정본은 `src/data/catalysts.ts`. */
export const CARD_BOUNTY = 3;

/** id 4 — slug `cornucopia`. 정본은 `src/data/catalysts.ts`. */
export const CARD_CORNUCOPIA = 4;

// ---------------------------------------------------------------------------
// 등급코드 구간 — `loot` kind 재해석 (신규 kind 금지 = §A 유지의 핵심)
// ---------------------------------------------------------------------------
//
// 일반 전리품의 `enemyType`(= 등급코드)은 **0..3** 이다(`src/sim/drops.ts` RARITY_*).
// `id 1`·`id 3` 은 신규 kind 를 만들지 않고 그 칸의 **위쪽 구간**을 빌려 쓴다 — 카탈로그가
// *"신규 kind 를 만들면 §B"* 라고 못 박은 그 대안이다. 두 구간은 서로 겹치지 않는다.

/** 일반 전리품 등급코드의 상한(포함). 이보다 크면 촉매가 재해석한 전리품이다. */
const RARITY_CODE_MAX = 3;

/**
 * `id 1 plunder` — **강탈되지 않은 채 격추된 엘리트가 떨군 잠긴 전리품**의 등급코드 기준값.
 * 실제 코드는 `LOCK + 원래 등급` 이라 32..35 를 쓴다(원래 등급을 보존해 연출이 색을 낸다).
 */
const PLUNDER_LOCK_CODE = 32;

/**
 * `id 3 bounty` — **현상금 표식**의 등급코드 기준값. 실제 코드는 `BOUNTY + 액수` 이고 액수는
 * 1..{@link BOUNTY_AMOUNT_MAX} 라 65..127 을 쓴다. 액수를 등급코드 구간으로 표현하라는 것이
 * 카탈로그 §훅의 지시 그대로다.
 */
const BOUNTY_CODE = 64;

/** 현상금 표식 하나가 실을 수 있는 최대 액수(등급코드 구간 폭). */
const BOUNTY_AMOUNT_MAX = 63;

/** 이 전리품이 **정상 등급의 진짜 장비**인가(촉매가 재해석한 것이 아닌가). */
function isPlainLoot(e: Entity): boolean {
  return e.kind === 'loot' && !e.dead && e.enemyType >= 0 && e.enemyType <= RARITY_CODE_MAX;
}

/** 이 전리품이 `id 1` 이 잠근 것인가. */
function isPlunderLocked(e: Entity): boolean {
  return (
    e.kind === 'loot' && e.enemyType >= PLUNDER_LOCK_CODE && e.enemyType < PLUNDER_LOCK_CODE + 4
  );
}

/** 이 전리품이 `id 3` 의 현상금 표식인가. */
function isBountyMark(e: Entity): boolean {
  return e.kind === 'loot' && e.enemyType > BOUNTY_CODE && e.enemyType <= BOUNTY_CODE + BOUNTY_AMOUNT_MAX;
}

/** 현상금 표식이 실은 액수. 표식이 아니면 0. */
function bountyAmountOf(e: Entity): number {
  return isBountyMark(e) ? e.enemyType - BOUNTY_CODE : 0;
}

// ---------------------------------------------------------------------------
// 카드별 상수 — **한 곳에 모아 둔다**(밸런스 손잡이가 코드 사이에 흩어지지 않게)
// ---------------------------------------------------------------------------

/** `id 0` — 이 개수부터 더미가 적을 가속한다(카탈로그 규칙문의 "다섯 개 이상"). */
const ABUNDANCE_PILE_MIN = 5;
/** `id 0` — 임계 초과 1개당 적 속도 증가분. */
const ABUNDANCE_SPEED_STEP = 0.03;
/** `id 0` — 가속의 상한 단계(초과분 10개 = ×1.30). 무한 가속을 막는다. */
const ABUNDANCE_SPEED_STACK_MAX = 10;
/** `id 0` — 전리품 개수 배율. 카탈로그 §상한 「드랍 ×2.0」 그대로다. */
const ABUNDANCE_LOOT_COUNT = 2;

/** `id 1` — 강탈해 둔 엘리트가 뱉는 전리품 개수 배율(카탈로그 §상한 「드랍 ×1.8」). */
const PLUNDER_LOOT_COUNT = 1.8;

/** `id 2` — 수확 지대의 반경. */
const HARVEST_ZONE_RADIUS = 130;
/** `id 2` — 수확 지대의 지속 틱(3초). */
const HARVEST_ZONE_TICKS = 180;
/** `id 2` — 지대 위 아군탄이 얻는 관통 예산. */
const HARVEST_PIERCE = 1;
/**
 * `id 2` — 지대를 밟는 동안 매 틱 다시 세우는 감속 잔여 틱.
 *
 * ⚠️ `PLAYER_SLOW_DURATION`(90)을 쓰지 않는다. 그 상수는 "한 번 밟으면 1.5초" 라는 **감속
 * 지대**의 계약이고, 이 카드는 *"밟는 동안"* 이라 지대를 벗어나면 즉시 풀려야 한다. 짧게 세우고
 * 매 틱 갱신하는 것이 그 문장의 정확한 표현이다. 배율 자체는 기존 `PLAYER_SLOW_MULT` 를 그대로
 * 탄다(`world.ts` 의 `slowMult`).
 */
const HARVEST_SLOW_TICKS = 2;

/** `id 3` — 동시에 바닥에 있을 수 있는 현상금 표식 수. 넘으면 그 피격분은 놓친다. */
const BOUNTY_LIVE_CAP = 12;
/** `id 3` — 적이 표식을 먹었을 때 그 적이 얻는 HP(액수 × 이 값). */
const BOUNTY_ENEMY_HP_PER_AMOUNT = 2;

/** `id 4` — 전리품 하나가 터지며 만드는 폭발 반경. */
const CORNUCOPIA_BLAST_RADIUS = 150;
/** `id 4` — 그 폭발의 피해. */
const CORNUCOPIA_BLAST_DAMAGE = 40;
/**
 * `id 4` — 폭발 해저드의 활성 틱.
 *
 * ⚠️ **2 여야 한다(1 이 아니다).** `stepHazards` 가 `life` 를 먼저 깎고 `life === 0` 이면
 * 그 자리에서 `dead` 를 세우는데, `stepCatalystHazards` 는 같은 틱 **뒤**에서 `h.dead` 를
 * 걸러 낸다 — `life = 1` 로 두면 한 번도 안 때리고 사라진다(실측).
 */
const CORNUCOPIA_BLAST_TICKS = 2;

// ---------------------------------------------------------------------------
// 틱 스크래치 — **틱을 넘겨 살지 않는다**(헤더 §틱 스크래치)
// ---------------------------------------------------------------------------

/**
 * `id 1` — 이번 틱에 **강탈되지 않은 채** 격추된 엘리트의 좌표(x, y 를 번갈아 담는다).
 *
 * 채우는 곳은 {@link dropsOnEnemyDamaged}(치명타 시점 = 표식을 읽을 수 있는 마지막 자리),
 * 읽는 곳은 같은 틱 뒤의 {@link dropsOnLootRoll}·{@link dropsOnEnemyDeath} 다.
 * 좌표가 열쇠가 되는 근거: 치명타(`resolveCollisions`)와 `compact` 사이에 적은 **이동하지
 * 않는다** — 두 지점이 보는 `e.x`/`e.y` 가 같은 값이다.
 */
const PLUNDER_LOST: number[] = [];

/**
 * `id 2` — 이번 틱에 **수확 지대 위 관통탄으로** 격추된 적의 좌표(x, y 번갈아).
 *
 * 채우는 곳은 {@link dropsOnEnemyDamaged}, 읽는 곳은 {@link dropsOnEnemyDeath} 다. 후자가
 * `compact` 의 젬 스폰 **뒤**라, 그 자리에 방금 태어난 젬의 값을 두 배로 만들 수 있다.
 */
const HARVEST_PIERCE_KILLS: number[] = [];

/** 좌표 쌍 스크래치에서 (x, y) 를 찾아 **소비**한다(찾았으면 지우고 `true`). */
function takeCoord(scratch: number[], x: number, y: number): boolean {
  for (let i = 0; i < scratch.length; i += 2) {
    if (scratch[i] !== x || scratch[i + 1] !== y) continue;
    scratch.splice(i, 2);
    return true;
  }
  return false;
}

/** 좌표 쌍 스크래치에 (x, y) 가 있는가(소비하지 않는다). */
function hasCoord(scratch: readonly number[], x: number, y: number): boolean {
  for (let i = 0; i < scratch.length; i += 2) {
    if (scratch[i] === x && scratch[i + 1] === y) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// `id 2` 수확 지대 — 판별자
// ---------------------------------------------------------------------------
//
// 수확 지대와 `id 4` 의 폭발은 **둘 다 촉매 해저드**라 판별이 필요하다. 축은 `damage` 다:
// 지대는 **피해 0**(밟아도 안 아프다 — 대가는 감속이다)이고 폭발은 피해가 있다. 그래서
// `catalystHazardDamaging`(= 피해 > 0)이 지대를 자동으로 걸러 내고, 공용 적↔해저드 루프가
// 지대를 한 번도 안 때린다.

/** 지금 효력이 있는 수확 지대인가. */
function isHarvestZone(e: Entity): boolean {
  return !e.dead && isCatalystHazard(e) && e.damage === 0 && hazardActive(e);
}

/** (x, y) 가 어느 수확 지대 안인가. */
function insideHarvestZone(state: WorldState, x: number, y: number, r: number): boolean {
  for (const h of state.entities) {
    if (!isHarvestZone(h)) continue;
    if (circlesOverlap(h.x, h.y, h.radius, x, y, r)) return true;
  }
  return false;
}

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 *
 * 지점은 `stepShipSignature`(= `stepPlayer` 직후 · `stepEnemies`/`resolveCollisions`/`compact`
 * **앞**)이다. 이 순서가 아래 셋의 계약을 통째로 정한다:
 *  - `id 0` 의 바닥 전리품 수는 **직전 틱 `compact` 이 남긴 배열**을 세므로 항상 **한 틱
 *    지연**된다(카탈로그가 계약으로 명시한 그 지연이다). 같은 틱의 `stepEnemies` 가 그 값을
 *    읽으므로 가속은 세고 나서 **같은 틱에** 걸린다.
 *  - `id 2` 의 감속·관통은 이번 틱 이동(`stepPlayer`)이 이미 끝난 뒤에 세워지므로 **다음 틱**
 *    이동부터 듣는다.
 *  - `id 3` 의 표식 회수/탈취 판정은 이번 틱 충돌 판정보다 앞이다.
 *
 * ⚠️ 첫 두 줄의 스크래치 비우기는 **카드 소지와 무관하게** 돈다 — 스크래치가 틱을 넘겨
 * 살아남지 않는다는 것이 이 파일의 전제이고, 게이트 안에 두면 카드 조합에 따라 그 전제가 깨진다.
 */
export function dropsOnTick(state: WorldState, player: Entity): void {
  PLUNDER_LOST.length = 0;
  HARVEST_PIERCE_KILLS.length = 0;
  if (carries(state, CARD_ABUNDANCE)) abundanceCountPile(state, player);
  if (carries(state, CARD_HARVEST)) harvestTick(state, player);
  if (carries(state, CARD_BOUNTY)) bountyTick(state);
}

// ---------------------------------------------------------------------------
// id 0 abundance — 전리품 두 배 / 더미가 적을 가속
// ---------------------------------------------------------------------------

/**
 * `id 0` — 바닥 전리품을 세어 {@link AbundanceSlot.GroundLoot} 에 적는다.
 *
 * ## ⚠️ 이 값은 **한 틱 지연**이 계약이다
 * 카탈로그는 이 카운터를 *"`compact()` 순회에 얹는 파생"* 으로 적었고 `compact` 은 `stepWorld`
 * 하단이라 읽는 쪽이 항상 한 틱 늦은 값을 본다고 못 박았다. 여기서는 `compact` 을 고치는 대신
 * **`compact` 이 남긴 배열을 다음 틱 첫머리에 센다** — 관측되는 값이 정확히 같고(둘 다 "직전
 * `compact` 직후의 바닥 개수"), `world.ts` 를 한 줄도 안 건드린다.
 *
 * ## 무엇을 세는가
 * **진짜 장비만** 센다(`id 3` 현상금 표식·`id 1` 잠긴 전리품 제외). 셋을 같이 세면 두 카드가
 * 같이 실린 런에서 *"전리품 더미"* 라는 화면의 말과 규칙이 갈린다(헌장 §귀속 규율).
 */
function abundanceCountPile(state: WorldState, player: Entity): void {
  let n = 0;
  for (const e of state.entities) if (isPlainLoot(e)) n++;
  const slots = state.catalystSlots;
  const prev = readCatalystSlot(slots, AbundanceSlot.GroundLoot);
  writeCatalystSlot(slots, AbundanceSlot.GroundLoot, n);
  // 신호는 **임계를 넘나든 틱에만** 낸다. 매 틱 통지하면 HUD 가 계속 번쩍여 귀속이 무의미해진다
  // (헌장 §가시성 규율의 "틱당 64건 상한"은 상한일 뿐 목표가 아니다).
  const was = prev >= ABUNDANCE_PILE_MIN;
  const now = n >= ABUNDANCE_PILE_MIN;
  if (was !== now) notifyCatalystFx(state, CARD_ABUNDANCE, CATALYST_FX.trigger, player.x, player.y);
}

/** `id 0` — 더미가 5개 이상일 때의 적 속도 배율(치우면 즉시 가라앉는다). */
function abundanceSpeedMult(state: WorldState): number {
  const n = readCatalystSlot(state.catalystSlots, AbundanceSlot.GroundLoot);
  if (n < ABUNDANCE_PILE_MIN) return 1;
  const over = n - ABUNDANCE_PILE_MIN + 1;
  const stack = over > ABUNDANCE_SPEED_STACK_MAX ? ABUNDANCE_SPEED_STACK_MAX : over;
  return 1 + stack * ABUNDANCE_SPEED_STEP;
}

// ---------------------------------------------------------------------------
// id 2 harvest — 수확 지대(관통 + 감속)
// ---------------------------------------------------------------------------

/**
 * `id 2` 의 매 틱 몫 — **지대 위 아군탄에 관통을 주고, 밟고 있으면 느려진다.**
 *
 * ⚠️ 감속은 기존 `state.playerSlowTicks`(→ `PLAYER_SLOW_MULT = 0.5`)를 그대로 탄다. 새 배율도
 * 새 칸도 만들지 않는다. 이미 더 긴 감속이 걸려 있으면 **덮지 않는다** — 덮으면 니플헤임
 * 감속 지대의 1.5초가 이 카드 때문에 2틱으로 줄어든다.
 */
function harvestTick(state: WorldState, player: Entity): void {
  // 지대를 먼저 한 번만 모은다 — 탄마다 전 엔티티를 다시 훑으면 O(탄 × 엔티티)가 된다.
  const zones: Entity[] = [];
  for (const h of state.entities) if (isHarvestZone(h)) zones.push(h);
  if (zones.length === 0) return;
  for (const b of state.entities) {
    if (b.dead || b.kind !== 'bullet') continue;
    for (const h of zones) {
      if (!circlesOverlap(h.x, h.y, h.radius, b.x, b.y, b.radius)) continue;
      if (b.pierce < HARVEST_PIERCE) b.pierce = HARVEST_PIERCE;
      break;
    }
  }
  for (const h of zones) {
    if (!circlesOverlap(h.x, h.y, h.radius, player.x, player.y, player.radius)) continue;
    if (state.playerSlowTicks < HARVEST_SLOW_TICKS) state.playerSlowTicks = HARVEST_SLOW_TICKS;
    break;
  }
}

// ---------------------------------------------------------------------------
// id 3 bounty — 피격 지점의 현상금 표식
// ---------------------------------------------------------------------------

/**
 * `id 3` 의 매 틱 몫 — **적이 표식을 먼저 밟으면 그 적이 먹고 강화된다.**
 *
 * ⚠️ 플레이어 회수는 여기가 아니라 기존 픽업 경로(`collectLoot` → {@link dropsOnLootCollected})
 * 다. 표식이 `loot` kind 그대로라 픽업이 **공짜로 성립**하는 것이 등급코드 구간을 쓴 이득이다.
 */
function bountyTick(state: WorldState): void {
  for (const m of state.entities) {
    if (m.dead || !isBountyMark(m)) continue;
    const amount = bountyAmountOf(m);
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'enemy') continue;
      if (!circlesOverlap(m.x, m.y, m.radius, e.x, e.y, e.radius)) continue;
      // 그 적이 먹고 강화된다 — 액수가 그대로 그 적의 맷집이 된다.
      const gain = amount * BOUNTY_ENEMY_HP_PER_AMOUNT;
      e.hp += gain;
      e.maxHp += gain;
      m.dead = true;
      notifyCatalystFx(state, CARD_BOUNTY, CATALYST_FX.trigger, m.x, m.y);
      missCatalyst(state, CARD_BOUNTY, amount);
      break;
    }
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
// ## ⚠️ 자기 몫이 없는 앵커는 빈 함수(또는 중립값 반환)로 남긴다
// 지우지 마라 — 지우면 디스패처가 깨지고 그 순간 이 파일이 다시 충돌 지점이 된다.
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

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 drops 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function dropsOnEnemyDamageTakenMult(
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

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/**
 * {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 drops 몫 —
 * **`id 3 bounty`: 맞은 그 자리에 현상금 표식이 떨어진다.**
 *
 * ## 여기서 스폰해도 되는가 — 실측으로 안전하다
 * 호출부(`world.ts` 의 `resolveCollisions` 말미)는 격자 질의 콜백도, `state.entities` 순회도
 * **아니다**(아군탄 루프와 픽업 질의가 둘 다 이 지점보다 앞에서 닫힌다). 그래서 이 앵커는
 * 이 그룹에서 **순회 밖 스폰이 허용되는 세 자리** 중 하나다(나머지는 `onEnemyDeath`·`onLevelUp`).
 *
 * ## ⚠️ 피해원을 가리지 않는다
 * 규칙문이 *"피격당하면"* 이라 접촉·적탄·해저드를 구분하지 않는다(`id 24` 와 같은 판단).
 * 그래서 `sources` 를 게이트하지 않는다.
 *
 * ## 액수와 상한
 * 액수는 **입은 피해의 정수 반올림**이고 등급코드 구간 폭(1..{@link BOUNTY_AMOUNT_MAX})으로
 * 절삭된다. 동시 표식은 {@link BOUNTY_LIVE_CAP} 개까지고, 넘으면 **그 피격분을 놓친다**
 * (`missCatalyst`) — 조용히 버리지 않는 것이 헌장 §가시성 규율이 요구하는 축이다.
 */
export function dropsOnPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
): void {
  void lethalSurvived;
  void sources;
  if (!carries(state, CARD_BOUNTY)) return;
  const raw = Math.round(dmg);
  if (raw <= 0) return;
  const amount = raw > BOUNTY_AMOUNT_MAX ? BOUNTY_AMOUNT_MAX : raw;
  let live = 0;
  for (const e of state.entities) if (!e.dead && isBountyMark(e)) live++;
  if (live >= BOUNTY_LIVE_CAP) {
    missCatalyst(state, CARD_BOUNTY, amount);
    notifyCatalystFx(state, CARD_BOUNTY, CATALYST_FX.miss, player.x, player.y);
    return;
  }
  // 시드 칸(`damage`)에는 0 을 싣는다 — 표식은 아이템이 아니라서 롤할 것이 없고,
  // {@link dropsOnLootCollected} 가 `state.loot` 진입을 통째로 막으므로 이 값은 소비처가 없다.
  spawnLoot(state, player.x, player.y, 0, BOUNTY_CODE + amount);
  notifyCatalystFx(state, CARD_BOUNTY, CATALYST_FX.trigger, player.x, player.y);
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 drops 몫 — **두 카드의
 * 치명타 관측 지점**이다. 여기서 상태를 만들지 않고 좌표만 스크래치에 적는다.
 *
 * ⚠️ **스폰 금지**(호출부가 `for (const b of state.entities)` 순회 안이다).
 *
 * - `id 1` — 강탈되지 않은 엘리트가 여기서 죽으면 그 좌표를 {@link PLUNDER_LOST} 에 남긴다.
 *   표식(`aux0`)을 읽을 수 있는 **마지막 자리**다(다음 관측 지점인 `onEnemyDeath` 는 좌표만
 *   받고 시체는 이미 `state.entities` 밖이다).
 *   ⚠️ 아군탄 명중 **외** 경로(화염 DoT·전격·폭탄 기물)로 죽은 엘리트는 이 앵커에 오지 않아
 *   잠기지 않는다 — 알려진 누수이고, 그 경로를 덮으려면 새 앵커가 필요하다(= §B).
 * - `id 2` — 수확 지대 위의 **관통탄**이 낸 치명타 좌표를 {@link HARVEST_PIERCE_KILLS} 에 남긴다.
 */
export function dropsOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void dmg;
  if (target.hp > 0) return;
  if (carries(state, CARD_PLUNDER) && isElite(target) && readMark(target, 'plunder') === 0) {
    PLUNDER_LOST.push(target.x, target.y);
  }
  if (
    carries(state, CARD_HARVEST) &&
    target.kind === 'enemy' &&
    source !== undefined &&
    source.kind === 'bullet' &&
    source.pierce > 0 &&
    insideHarvestZone(state, source.x, source.y, source.radius)
  ) {
    HARVEST_PIERCE_KILLS.push(target.x, target.y);
  }
}

/**
 * {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 drops 몫.
 *
 * 호출 지점은 `compact` 의 **말미**다 — `state.entities = survivors` 와 젬·전리품 스폰이
 * 전부 끝난 뒤라 ①여기서 스폰해도 안전하고 ②이번 틱에 태어난 젬·전리품을 **조회·수정할 수
 * 있다.** 아래 두 카드가 정확히 그 성질에 기대고 있다.
 *
 * - `id 2` — 적이 죽은 자리에 **수확 지대**를 연다. 그리고 그 죽음이 지대 위 관통탄의 것이었으면
 *   방금 태어난 젬의 값을 **두 배**로 만든다(카탈로그 §상한의 「젬을 두 배」).
 * - `id 1` — 강탈되지 않은 채 죽은 엘리트의 전리품을 **잠근다**(등급코드를 잠금 구간으로 옮긴다).
 *   회수하면 인벤에 안 들어가고 놓친 것으로 적힌다({@link dropsOnLootCollected}).
 */
export function dropsOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  if (carries(state, CARD_HARVEST)) {
    // 지대: 피해 0 · 지속형. 피해가 0 이라 공용 적↔해저드 루프가 자동으로 건너뛴다.
    const z = spawnCatalystHazard(state, x, y, HARVEST_ZONE_RADIUS, 0, HARVEST_ZONE_TICKS, 0, true);
    if (z !== undefined) notifyCatalystFx(state, CARD_HARVEST, CATALYST_FX.trigger, x, y);
    if (takeCoord(HARVEST_PIERCE_KILLS, x, y)) {
      for (const g of state.entities) {
        if (g.dead || g.kind !== 'gem' || g.x !== x || g.y !== y) continue;
        // `phase` 는 젬이 안 쓰는 칸이다 — 두 번 불리는 일은 없지만, 표식을 남겨 두면
        // 나중에 같은 좌표에 젬이 또 놓여도 이 젬이 다시 부풀지 않는다.
        if (g.phase !== 0) continue;
        const bonus = g.damage;
        g.damage += bonus;
        g.phase = 1;
        creditCatalyst(state, CARD_HARVEST, bonus);
        break;
      }
    }
  }
  if (elite && carries(state, CARD_PLUNDER) && takeCoord(PLUNDER_LOST, x, y)) {
    for (const l of state.entities) {
      if (!isPlainLoot(l) || l.x !== x || l.y !== y) continue;
      l.enemyType = PLUNDER_LOCK_CODE + l.enemyType;
    }
  }
}

/**
 * {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 drops 몫 —
 * **`id 4 cornucopia`: 레벨업 순간 바닥 전리품이 전부 폭발한다.**
 *
 * 호출 지점(`checkLevelUp`)은 `compact` **뒤**의 최상위라 스폰이 안전하다.
 *
 * ## 터진 것은 등급이 한 단계 내려간 채 **회수된다**
 * `state.loot` 에 직접 싣는다 — 바닥 개체는 `dead` 로 지운다. 시드는 **그 전리품이 이미
 * 가지고 있던 것**을 그대로 쓰므로 드랍 시드 수가 늘지 않는다(= `catalystDropsFromRun` 의
 * 60% 게이트 횟수 불변 → 촉매가 공짜로 늘지 않는다).
 *
 * ## ⚠️ 폭발은 `blastDamage` 가 아니라 **촉매 해저드**로 낸다
 * `blastDamage`(`activeTypes.ts`)는 `e.dead` 를 안 세워 처치·젬·전리품이 안 나오는 **좀비**를
 * 만든다. `stepCatalystHazards` 는 `t.hp <= 0` 에서 `dead` 를 **명시적으로** 세우므로 폭발로
 * 죽은 적이 정상적으로 집계된다.
 */
export function dropsOnLevelUp(state: WorldState, level: number): void {
  void level;
  if (!carries(state, CARD_CORNUCOPIA)) return;
  const planet = state.config.planet ?? 0;
  const stage = state.config.stage ?? 1;
  let burst = 0;
  const spots: number[] = [];
  for (const l of state.entities) {
    if (!isPlainLoot(l)) continue;
    const rarity = l.enemyType > 0 ? l.enemyType - 1 : 0; // 한 단계 강등(하한 normal).
    state.loot.push({ seed: l.damage >>> 0, rarity, planet, stage, elite: 1 });
    l.dead = true;
    spots.push(l.x, l.y);
    burst++;
  }
  if (burst === 0) return;
  // ⚠️ 스폰은 순회 **밖**에서. 위 루프는 `state.entities` 를 돌고 있었다.
  for (let i = 0; i < spots.length; i += 2) {
    const x = spots[i] ?? 0;
    const y = spots[i + 1] ?? 0;
    spawnCatalystHazard(
      state,
      x,
      y,
      CORNUCOPIA_BLAST_RADIUS,
      0,
      CORNUCOPIA_BLAST_TICKS,
      CORNUCOPIA_BLAST_DAMAGE,
      true,
    );
    notifyCatalystFx(state, CARD_CORNUCOPIA, CATALYST_FX.trigger, x, y);
  }
  creditCatalyst(state, CARD_CORNUCOPIA, burst);
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  void state;
  void amount;
  void x;
  void y;
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 drops 몫 — **개수 배율**.
 *
 * ⚠️ **재롤이 아니다.** 이미 뽑힌 결과에 곱할 배율만 돌려주고 난수를 한 칸도 안 쓴다
 * (`bonusLootSeeds` 가 그 배율로 시드를 **순수 파생**한다).
 *
 * - `id 0` — 무조건 ×{@link ABUNDANCE_LOOT_COUNT}. 대가는 바닥에 쌓인 더미가 진다.
 * - `id 1` — **강탈해 둔 엘리트에게만** ×{@link PLUNDER_LOOT_COUNT}. 강탈되지 않은 엘리트는
 *   이 틱의 {@link PLUNDER_LOST} 에 좌표가 들어 있으므로 배율이 1 이고, 떨어진 전리품도
 *   {@link dropsOnEnemyDeath} 가 잠근다.
 */
export function dropsOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  let count = 1;
  if (carries(state, CARD_ABUNDANCE)) {
    count *= ABUNDANCE_LOOT_COUNT;
    creditCatalyst(state, CARD_ABUNDANCE, ABUNDANCE_LOOT_COUNT - 1);
    notifyCatalystFx(state, CARD_ABUNDANCE, CATALYST_FX.credit, x, y);
  }
  if (carries(state, CARD_PLUNDER) && elite && !hasCoord(PLUNDER_LOST, x, y)) {
    count *= PLUNDER_LOOT_COUNT;
    // 귀속 장부 — 단위는 **개수 증분**이다(`id 1` 의 상한 축이 `drop`, `catalysts.ts:241`).
    // 바로 위 `id 0` 과 같은 모양: 배율 그대로가 아니라 `배율 - 1`(= 이 롤이 더 뱉은 몫)을 적는다.
    // 이 줄이 없어 정산 화면의 `earned` 칸이 0 으로 남아 있었다(`missed` 는 아래 잠금 분기가 적는다).
    creditCatalyst(state, CARD_PLUNDER, PLUNDER_LOOT_COUNT - 1);
    notifyCatalystFx(state, CARD_PLUNDER, CATALYST_FX.credit, x, y);
  }
  if (count === 1) return CATALYST_LOOT_NEUTRAL;
  return { rarity: 1, count };
}

/**
 * {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 drops 몫 — **`state.loot`
 * 진입 억제**. 이 그룹이 진 **가장 위험한 계약**이라 사유를 여기 남긴다.
 *
 * ## ⚠️ 억제가 없으면 촉매가 공짜로 늘어난다
 * `collectLoot` 은 주운 것을 그대로 `state.loot` 에 `elite:1` 로 민다. `id 3` 의 표식은
 * 장비가 아닌데도 그 길을 타면 **표식 하나 = 장비 하나**가 되고, 더 나쁘게는
 * `catalystDropsFromRun` 이 **드랍 시드마다 60% 게이트를 굴려 촉매까지 공짜로 늘어난다.**
 * 그래서 이 분기는 "있으면 좋은 것"이 아니라 카드의 **필수 선결**이다.
 *
 * - `id 3` 표식 — 억제하고 **실제 자원 경로**(`state.resources`)로 액수를 준다.
 *   ⚠️ `creditCatalyst` 는 자원을 주지 않는다(귀속 장부일 뿐이다) — 두 곳을 같이 부른다.
 * - `id 1` 잠긴 전리품 — 억제하고 **놓친 것으로 적는다**(자원도 아이템도 없다).
 */
export function dropsOnLootCollected(state: WorldState, loot: Entity): boolean {
  if (carries(state, CARD_BOUNTY) && isBountyMark(loot)) {
    const amount = bountyAmountOf(loot);
    state.resources += amount;
    creditCatalyst(state, CARD_BOUNTY, amount);
    notifyCatalystFx(state, CARD_BOUNTY, CATALYST_FX.credit, loot.x, loot.y);
    return true;
  }
  if (carries(state, CARD_PLUNDER) && isPlunderLocked(loot)) {
    missCatalyst(state, CARD_PLUNDER, 1);
    notifyCatalystFx(state, CARD_PLUNDER, CATALYST_FX.miss, loot.x, loot.y);
    return true;
  }
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/**
 * {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 drops 몫 —
 * **`id 1 plunder`: 몸으로 부딪혀 강탈한다.**
 *
 * ## ⚠️ 이 앵커는 무적 조기 반환보다 **앞**이다
 * 대시 무적으로 파고들어 뜯는 것이 카드의 그림이라, 무적 뒤였다면 그 플레이가 구조적으로
 * 0회가 된다(호출부 주석이 정본). 그리고 **부딪히는 것은 곧 접촉 피해를 받는 것**이므로 대가는
 * 이 함수가 따로 물리지 않는다 — 같은 틱의 접촉 피해가 그 대가다(`selfHarm` 으로 갈라 통지한다).
 *
 * ## ⚠️ 스폰 금지 · 잡몹 한정
 * 호출부가 격자 질의 콜백 안이라 여기서는 표식만 세운다. 그리고 `writeMark` 는
 * **`kind === 'enemy'` 에만** 쓸 수 있다(보스 `aux0` 는 추격 취약화 플래그다) — `isElite` 가
 * 그 게이트를 이미 포함한다.
 */
export function dropsOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  if (!carries(state, CARD_PLUNDER)) return;
  if (!isElite(target)) return;
  if (readMark(target, 'plunder') !== 0) return;
  writeMark(target, 'plunder', 1);
  notifyCatalystFx(state, CARD_PLUNDER, CATALYST_FX.trigger, target.x, target.y);
  notifyCatalystFx(state, CARD_PLUNDER, CATALYST_FX.selfHarm, player.x, player.y);
}

/**
 * {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 drops 몫 —
 * **`id 0 abundance`: 바닥에 쌓인 더미만큼 적이 빨라진다.**
 *
 * ⚠️ 여기서 `e` 에 쓰기를 하지 않는다(호출부 계약). 읽는 값은 이번 틱 첫머리에
 * {@link abundanceCountPile} 이 적어 둔 슬롯 하나뿐이라 적마다 순회가 늘지 않는다.
 */
export function dropsOnEnemyStep(state: WorldState, e: Entity): number {
  if (!carries(state, CARD_ABUNDANCE)) return 1;
  void e;
  return abundanceSpeedMult(state);
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/** {@link import('../catalystHooks.js').stepCatalystHazards} 의 drops 몫. **미배선**(위 §주석). */
export function dropsOnCatalystHazards(state: WorldState): void {
  void state;
}
