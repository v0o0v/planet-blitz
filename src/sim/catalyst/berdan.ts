/**
 * 촉매 **베르단 특산**(id 33~35) — `berdan-collapse` · `berdan-royal-jelly` · `berdan-hive-queen`.
 *
 * ## 왜 그룹마다 파일을 가르는가
 * 카드 45종을 **병렬 레인이 동시에** 채운다. 한 파일이면 레인마다 같은 함수를 만져 **매 머지가
 * 충돌**하고, 충돌 해소가 사람 손이라 조용한 유실이 생긴다. 그룹 = 카드 묶음 하나라 레인
 * 하나가 파일 하나를 통째로 소유한다. 공용 술어·해저드 규약은 {@link file://./shared.ts} 다.
 *
 * ⚠️ 이 모듈은 `world.js` 를 **type-only** 로만 import 한다(순환 금지).
 *
 * ## ⚠️ 간선 방향이 계약이다 — **촉매가 모드 상태를 읽는다**
 * 모드(`modes/shrink.ts`)가 촉매를 import 하는 것이 아니다. 안전 원 중심은
 * {@link berdanSafeCenterX} 로 `catalyst/shared.ts` 에 있고(거기 §주석이 사유의 정본이다),
 * `waves.ts`·`world.ts`·`bossProgress.ts` 가 그것을 **인자로 넘긴다**. 이 파일은 반대로
 * `state.shrinkRuntime` 을 **읽기만** 한다(타입 접근이라 런타임 import 가 0 이다).
 *
 * ## 이 그룹이 쓰는 상태 — **슬롯 0칸**
 * `id 33` 중심은 틱의 순수 파생, `id 34` 는 젤리 장판 **오브젝트 자체**가 상태, `id 35` 는
 * 보스 HP 에서의 **파생 계산**이다. 적 단위 표식 하나(`hiveWorker` 비트)만 `aux0` 를 쓴다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { CATALYST_LOOT_NEUTRAL } from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import {
  carries,
  spawnCatalystHazard,
  isCatalystHazardMarked,
  isCatalystShadow,
  berdanSafeCenterX,
  berdanSafeCenterY,
  berdanCollapseLocked,
  BERDAN_JUMP_TICKS,
} from './shared.js';
import { readMark, writeMark } from '../catalystMarks.js';
import { circlesOverlap } from '../collision.js';
import { cos, sin, TWO_PI } from '../math.js';
import { summonEnemy } from '../waves.js';
import { ENEMY_BY_TYPE } from '../../../data/enemies.js';
import { notifyCatalystFx, creditCatalyst, missCatalyst, CATALYST_FX } from './fx.js';

/** id 33 — slug `berdan-collapse`. 정본은 `src/data/catalysts.ts`. */
export const CARD_BERDAN_COLLAPSE = 33;

/** id 34 — slug `berdan-royal-jelly`. 정본은 `src/data/catalysts.ts`. */
export const CARD_BERDAN_ROYAL_JELLY = 34;

/** id 35 — slug `berdan-hive-queen`. 정본은 `src/data/catalysts.ts`. */
export const CARD_BERDAN_HIVE_QUEEN = 35;

/** `id 34` 젤리 띠(`hazard.ownerId`). `id 10` 예고선도 피해 0 이라 값으로는 못 가른다. */
export const JELLY_MARK = 0xc0de34;

/**
 * `drops.ts:377-386`(`bonusLootSeeds`) 계열의 **RNG 미소비 순수 파생**(헌장 공통-B(a)의 기본값).
 * 이 파일이 새 난수를 필요로 하는 자리는 젤리 각도 하나뿐이고, 그것도 `safeRadius` 의 파생이다.
 */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// id 33 berdan-collapse — 안전 원이 15초마다 점프한다 · 점프 직후 5초 즉사
// ---------------------------------------------------------------------------
//
// ## ⭐⭐ 이 카드의 최대 함정 — **세그먼트 자동 전진**
// 수축은 여섯 무대 중 유일하게 **적 자체가 진행 게이트**다(`shrinkRingCleared` — 안전 반경 안
// 적이 없으면 전진). 그런데 이 카드는 즉사 창마다 그 원을 **비운다**. 그대로 두면 15초마다
// 세그먼트가 자동으로 넘어가 런이 보스까지 공짜로 간다.
//
// ⚠️ **중심을 넷 다 인자화하는 것만으로는 이 결함이 안 사라진다.** 원이 어디에 있든 즉사가
// 그 원을 비우기 때문이다. 그래서 잠금이 따로 필요하고, 그것이
// {@link berdanCollapseLocked}(`catalyst/shared.ts`)다 — **즉사 창 동안 전진 게이트만** 잠그고
// 안전 원·수축·보스는 그대로 둔다(헌장 §모드 계약: 격화지 교체가 아니다).
//
// ## 중심 인자화한 자리 넷 (전부 기본 인자 `(0,0)` → 무촉매 런 비트 불변)
//  1. `shrinkRingCleared`(`modes/shrink.ts`) — **세그먼트 전진 게이트**. `waves.ts` 와
//     `bossProgress.ts` 둘이 부른다.
//  2. `shrinkOutOfBounds`(`modes/shrink.ts`) — 원 밖 지속 피해. `world.ts` 가 부른다.
//  3. 스폰 링(`waves.ts` `formationPositions` 의 shrink 분기) — 반경은 `shrinkSpawnRadius` 가
//     그대로 정하고 **중심만** 옮긴다.
//  4. 보스 소환 좌표(`world.ts` 의 shrink 분기) — 종전 하드코딩 `(0,0)`.

/** 즉사 창에서 적이 지워지는 반경 = 그 순간의 안전 반경(원 자체가 무기가 된다). */
function collapseKill(state: WorldState): void {
  if (!berdanCollapseLocked(state)) return;
  const rt = state.shrinkRuntime;
  if (rt === undefined) return;
  const cx = berdanSafeCenterX(state);
  const cy = berdanSafeCenterY(state);
  const r2 = rt.safeRadius * rt.safeRadius;
  let killed = 0;
  let fx = 0;
  let fy = 0;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy') continue;
    // `id 36` 그림자는 **죽일 수 없다** — 조준 제외와 쌍이다(`catalyst/shared.ts`).
    // 베르단과 니플헤임 특산이 한 런에 같이 실릴 수는 없지만, 술어를 빠뜨리면 그 사실이
    // 코드가 아니라 데이터에만 사는 전제가 된다.
    if (isCatalystShadow(e)) continue;
    const dx = e.x - cx;
    const dy = e.y - cy;
    if (dx * dx + dy * dy > r2) continue;
    e.dead = true;
    if (killed === 0) {
      fx = e.x;
      fy = e.y;
    }
    killed++;
  }
  if (killed === 0) return;
  // 명세의 `경제:` — *"즉사한 적은 촉매를 떨굴 수 있다(즉사시킨 수에 비례)"*.
  // ⚠️ 배율을 **주입 목록에서 파생하지 않는다**(인계 §5-3) — sim 이 실제로 센 수가 귀속 원장에
  // 적히고, 정산이 그 값을 `CatalystDropInput.catalystDropMult` 로 쓴다.
  creditCatalyst(state, CARD_BERDAN_COLLAPSE, killed);
  notifyCatalystFx(state, CARD_BERDAN_COLLAPSE, CATALYST_FX.trigger, fx, fy);
}

// ---------------------------------------------------------------------------
// id 34 berdan-royal-jelly — 조여든 자리에 젤리가 남는다
// ---------------------------------------------------------------------------
//
// ## 왜 어그로 변경이 필요 없는가
// **플레이어가 먹는 것이 아니라 적에게 먹이는 구조**다. 젤리는 수축 흔적에 깔리고 적이 그 위를
// 지나가면 굼떠지며(그리고 그 자리에서 죽으면 전리품을 더 뱉고) 못 지나간 적은 빨라진다.
// 플레이어의 조작은 "원이 넓은 초반에 띠를 길게 깔아 두는 운용"이지 젤리를 주우러 가는 것이 아니다.
//
// ## 표식이 필요 없다 — **위치가 곧 상태다**
// "젤리를 먹은 적"을 `aux0` 에 적지 않는다. 감속도 전리품 배율도 **판정 시점에 젤리 위인가** 하나로
// 결정되므로 적별 장부가 원리적으로 불필요하다(인계 §2 가 지목한 "장부가 필요하면 §B 로
// 뒤집힌다"를 이 형태가 피한다).

/** 안전 반경이 이 눈금을 지날 때마다 젤리 한 장이 남는다(월드 유닛). */
const JELLY_RADIUS_STEP = 200;

/** 젤리 한 장의 반경. */
const JELLY_RADIUS = 260;

/** 젤리가 바닥에 남는 틱 수(15초). 수축이 느려 이보다 짧으면 띠가 안 읽힌다. */
const JELLY_TICKS = 900;

/** 젤리를 먹은 적의 이동 배율(감속). */
const JELLY_SLOW_MULT = 0.55;

/** 못 먹은 적의 이동 배율(가속) — *"먹지 못한 적은 그만큼 빨라진다"*. */
const JELLY_HASTE_MULT = 1.25;

/**
 * 젤리 위에서 죽은 적의 **전리품 개수 배율**. 선언 상한(`data/catalysts.ts` `id 34` = 드랍
 * ×2.4)과 **같은 값이다** — 배율이 상한을 넘을 수 없게 하는 가장 값싼 형태다.
 *
 * ## ⚠️ 왜 자원이 아니라 드랍인가 (2026-08-08 사용자 판정)
 * 종전 구현은 처치마다 **자원 3 을 절대량으로** 적립했다. 잡몹 처치는 원래 자원이 0 이고
 * `state.resources` 는 보급 습격만 올려서 *"자원을 세 배"* 에 **곱할 기준이 sim 에 없었기**
 * 때문이다. 그 형태는 처치 수에 선형이라 선언 상한 `자원 ×2.4` 가 유계하지 못했다.
 * 드랍축은 이미 기준이 있다 — `bonusLootSeeds(seed, mult)` 의 `mult` 자리. 그래서 축을 옮기면
 * 상한이 **구조적으로** 선다(격추 한 건이 만드는 배율의 상한이 곧 이 상수다).
 */
export const JELLY_LOOT_MULT = 2.4;

/** 젤리 각도 파생 전용 소금. */
const JELLY_SALT = 0x27d4eb2f;

/** 이 좌표가 살아 있는 젤리 위인가. */
export function onRoyalJelly(state: WorldState, x: number, y: number): boolean {
  for (const h of state.entities) {
    if (h.dead || !isCatalystHazardMarked(h, JELLY_MARK)) continue;
    if (circlesOverlap(x, y, 0, h.x, h.y, h.radius)) return true;
  }
  return false;
}

/** 살아 있는 젤리가 하나라도 있는가 — 없으면 `id 34` 의 이동 배율이 통째로 중립이다. */
function anyJelly(state: WorldState): boolean {
  for (const h of state.entities) {
    if (!h.dead && isCatalystHazardMarked(h, JELLY_MARK)) return true;
  }
  return false;
}

function royalJellyOnTick(state: WorldState): void {
  if (!carries(state, CARD_BERDAN_ROYAL_JELLY)) return;
  const rt = state.shrinkRuntime;
  if (rt === undefined) return;
  // 유예 중에는 반경이 **홀드**된다(`advanceShrinkRuntime`) — 그때 눈금 위에 서 있으면 매 틱
  // 젤리가 쌓이므로 유예를 배제한다. "밀려난 자리"는 실제로 조여든 틱에만 생긴다.
  if (rt.graceTicks > 0) return;
  const r = rt.safeRadius;
  if (r <= 0 || r % JELLY_RADIUS_STEP !== 0) return;

  // 각도는 `safeRadius` 의 **순수 파생**이다 — RNG 를 한 칸도 안 쓴다(헌장 공통-B(a)).
  const ang = (mix32(r, JELLY_SALT) / 4294967296) * TWO_PI;
  const x = berdanSafeCenterX(state) + cos(ang) * r;
  const y = berdanSafeCenterY(state) + sin(ang) * r;
  const h = spawnCatalystHazard(
    state,
    x,
    y,
    JELLY_RADIUS,
    0,
    JELLY_TICKS,
    0, // 피해 0 — 젤리는 태우지 않는다(`stepCatalystHazards` 의 `damage > 0` 게이트를 안 탄다)
    true,
    JELLY_MARK,
  );
  if (h === undefined) return;
  notifyCatalystFx(state, CARD_BERDAN_ROYAL_JELLY, CATALYST_FX.trigger, x, y);
}

// ---------------------------------------------------------------------------
// id 35 berdan-hive-queen — 보스가 피해를 입으면 그만큼 일벌을 토한다
// ---------------------------------------------------------------------------
//
// ## ⚠️⚠️ `boss` kind 를 늘리지 않는다
// `boss` kind 하나가 죽으면 **그 자리에서 런 승리**다(`world.ts:4356`). 일벌은 **일반 적 kind +
// 센티넬 마커**(`catalystMarks` 의 `hiveWorker` 비트)이고 보스는 끝까지 하나다.
//
// ## HP 연동은 **파생 계산**이다 — 슬롯을 한 칸도 안 쓴다
// 저장할 것은 "직전 보스 HP" 하나뿐인데, 그것 없이도 불변식 하나로 같은 것을 얻는다:
//
// ```
//   want = min(floor((boss.maxHp - boss.hp) / HIVE_HP_PER_WORKER), HIVE_LIVE_CAP)
//   have = 살아 있는 일벌 수(hiveWorker 비트)
//   have < want 이면 그 차이만큼 소환한다
// ```
//
// 그리고 **일벌이 죽으면 보스 HP 를 `HIVE_HP_PER_WORKER` 만큼 깎는다** — 이것이 *"일벌은 보스의
// HP 를 나눠 가지고 있어 일벌을 죽이면 보스가 그만큼 약해진다"* 의 코드다. 두 규칙이 물리는
// 방식이 이 카드의 그림 자체다: 일벌을 잡을수록 `lost` 가 커져 다음 일벌이 나오고, 보스 HP 는
// 그만큼 줄어든다 → **광역 화력은 보스를 녹이고 단일 대상 특화는 화면이 막힌다.**
// 총 소환 수는 `maxHp / HIVE_HP_PER_WORKER` 로 유계라 무한 루프가 아니다.
//
// ## ⚠️ 소환은 반드시 `summonEnemy`
// `spawnEnemy`(`waves.ts:596`)는 `waveRng` 를 소비해 같은 시드의 웨이브·드랍·엘리트 시퀀스를
// **통째로 민다**. `summonEnemy`(`:627`)가 RNG 미소비 정본이다(해츨링 선례).

/** 일벌 하나가 나눠 가진 보스 HP. 처치 시 보스가 정확히 이만큼 약해진다. */
export const HIVE_HP_PER_WORKER = 220;

/** 동시에 살아 있을 수 있는 일벌 수의 상한. 넘으면 화면이 막혀 "밀도"가 아니라 고장이 된다. */
export const HIVE_LIVE_CAP = 8;

/** 일벌이 보스 주위에 사출되는 거리. */
const HIVE_SPAWN_OFFSET = 180;

/** 살아 있는 일벌 하나마다 전리품 개수에 더해지는 몫. */
const HIVE_LOOT_STEP = 0.15;

/** 명세의 상한 = 드랍 ×2.2. */
const HIVE_LOOT_CAP = 2.2;

/** 이 적이 `id 35` 의 일벌인가. */
export function isHiveWorker(e: Entity): boolean {
  return e.kind === 'enemy' && readMark(e, 'hiveWorker') !== 0;
}

/** 살아 있는 일벌 수. */
export function liveHiveWorkers(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (!e.dead && isHiveWorker(e)) n++;
  }
  return n;
}

function hiveQueenOnTick(state: WorldState): void {
  if (!carries(state, CARD_BERDAN_HIVE_QUEEN)) return;

  // ⚠️ 순회 **안**에서 소환하지 않는다 — 좌표만 모으고 순회 밖에서 낳는다.
  let boss: Entity | undefined;
  let have = 0;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind === 'boss') boss = e;
    else if (isHiveWorker(e)) have++;
  }
  if (boss === undefined || boss.maxHp <= 0) return;
  const lost = boss.maxHp - boss.hp;
  if (lost <= 0) return;
  let want = Math.floor(lost / HIVE_HP_PER_WORKER);
  if (want > HIVE_LIVE_CAP) want = HIVE_LIVE_CAP;
  if (have >= want) return;

  const def = ENEMY_BY_TYPE[0];
  if (def === undefined) return;
  const bx = boss.x;
  const by = boss.y;
  const bornAt = have;
  for (let i = have; i < want; i++) {
    // 배치는 보스 둘레의 **고정 격자**다 — 각도가 `i` 의 순수 함수라 RNG 를 안 쓴다.
    const ang = (i * TWO_PI) / HIVE_LIVE_CAP;
    const w = summonEnemy(state, def, bx + cos(ang) * HIVE_SPAWN_OFFSET, by + sin(ang) * HIVE_SPAWN_OFFSET);
    // 일벌의 HP 는 def 가 아니라 **보스에서 떼어 온 몫**이다(그래야 "나눠 가졌다"가 성립한다).
    w.hp = HIVE_HP_PER_WORKER;
    w.maxHp = HIVE_HP_PER_WORKER;
    writeMark(w, 'hiveWorker', 1);
  }
  if (want > bornAt) {
    notifyCatalystFx(state, CARD_BERDAN_HIVE_QUEEN, CATALYST_FX.trigger, bx, by);
  }
}

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 */
export function berdanOnTick(state: WorldState, player: Entity): void {
  void player;
  collapseKill(state);
  royalJellyOnTick(state);
  hiveQueenOnTick(state);
}

// ---------------------------------------------------------------------------
// 앵커 팬아웃 진입점 — **카드 레인은 `catalystHooks.ts` 를 한 줄도 고치지 않는다**
// ---------------------------------------------------------------------------
//
// ## ⚠️ 반환값이 있는 앵커의 **합성 규칙**(디스패처가 진다)
//  - 배율형(`DamageChain`·`EnemyStep`·`LootRoll`) — 그룹 순서대로 **곱해서 누적**한다.
//    중립은 `1`(전리품은 {@link CATALYST_LOOT_NEUTRAL}).
//  - 억제형(`BossDeath`·`LootCollected`·`DestructibleDestroyed`) — **하나라도 `true` 면 억제**.
//
// ## ⚠️ 핫 경로 — 첫 줄은 반드시 **값싼 조기 반환**

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 berdan 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function berdanOnEnemyDamageTakenMult(
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

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 berdan 몫. **미배선**(위 §주석). */
export function berdanOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 berdan 몫. **미배선**(위 §주석). */
export function berdanOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/** {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
): void {
  void state;
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnBulletExpired(
  state: WorldState,
  bullet: Entity,
  reason: BulletExpiryReason,
): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 berdan 몫 —
 * **`id 35` 의 HP 연동**(일벌이 죽으면 보스가 그만큼 약해진다).
 *
 * 이 앵커는 `t.hp -= dealt` 와 격추 판정이 **끝난 뒤**라 `target.dead` 가 그 틱의 진실이다.
 * 그래서 "방금 이 일벌이 죽었다"를 여기서 정확히 한 번 읽을 수 있고, 슬롯도 직전-HP 사본도
 * 필요 없다.
 *
 * ⚠️ 이 앵커는 **아군탄 명중 경로만** 덮는다(그 훅 주석이 명시). 일벌이 다른 경로로 죽으면
 * (촉매 장판·연쇄) 연동이 안 걸린다 — 그 경우는 보스가 덜 약해질 뿐이라 **교착 방향이 아니다**.
 */
export function berdanOnEnemyDamaged(
  state: WorldState,
  target: Entity,
  dmg: number,
  source: Entity | undefined,
): void {
  void dmg;
  void source;
  if (!carries(state, CARD_BERDAN_HIVE_QUEEN)) return;
  if (!target.dead || !isHiveWorker(target)) return;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'boss') continue;
    e.hp -= HIVE_HP_PER_WORKER;
    if (e.hp <= 0) {
      e.hp = 0;
      // 보스 처치 경로는 `compact` 가 진다 — 여기서 `dead` 를 세우는 것이 그 경로의 입구다
      // (아군탄 명중이 아닌 원인으로 보스 HP 가 0 이 되는 유일한 자리라 여기서 세워야 한다).
      e.dead = true;
    }
    notifyCatalystFx(state, CARD_BERDAN_HIVE_QUEEN, CATALYST_FX.trigger, e.x, e.y);
    break;
  }
}

/**
 * {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 berdan 몫. **미배선**.
 *
 * ⚠️ 종전에는 여기가 `id 34` 의 자원 회수 자리였다. 축이 드랍으로 옮겨가면서
 * ({@link JELLY_LOOT_MULT}) 그 몫이 {@link berdanOnLootRoll} 로 갔다 — 드랍 배율이 확정되는
 * 앵커가 거기 하나뿐이라, 여기 남겨 두면 배율을 얹을 자리가 없다.
 */
export function berdanOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void state;
  void x;
  void y;
  void elite;
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnPowerupPicked(
  state: WorldState,
  poolIndex: number,
  offeredIndex: number,
): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnResourceGranted(
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

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 berdan 몫. **미배선**(승리를 가로채지 않는다). */
export function berdanOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 berdan 몫 — **경제 축 둘**.
 *
 * - `id 34` — 젤리 위에서 죽은 적은 ×{@link JELLY_LOOT_MULT}. 못 먹은 적은 배율이 1 이고
 *   `missCatalyst` 로 **놓친 몫**이 화면에 남는다(헌장 §귀속 규율 2). 살아 있는 젤리가 하나도
 *   없으면 놓친 것도 아니므로 장부에 적지 않는다.
 * - `id 35` — *"일벌은 전리품을 뱉는다"*. 일벌이 많이 떠 있을수록 같은 격추가 더 뱉는다.
 *
 * ⚠️ **재롤이 아니다** — 이미 뽑힌 롤에 곱하는 배율만 돌려준다(헌장 공통-B(c)).
 * ⚠️ 이 앵커는 **엘리트 드랍·보스 확정 드랍 두 지점**에만 걸린다(그 훅 주석이 정본). 즉
 * `id 34` 의 이득은 "젤리 위에서 죽은 **엘리트**"에 붙는다 — `id 19 motherlode` 와 같은 좁힘이다.
 */
export function berdanOnLootRoll(
  state: WorldState,
  x: number,
  y: number,
  elite: boolean,
): CatalystLootRoll {
  void elite;
  let count = 1;
  if (carries(state, CARD_BERDAN_ROYAL_JELLY)) {
    if (onRoyalJelly(state, x, y)) {
      count *= JELLY_LOOT_MULT;
      creditCatalyst(state, CARD_BERDAN_ROYAL_JELLY, JELLY_LOOT_MULT - 1);
      notifyCatalystFx(state, CARD_BERDAN_ROYAL_JELLY, CATALYST_FX.credit, x, y);
    } else if (anyJelly(state)) {
      missCatalyst(state, CARD_BERDAN_ROYAL_JELLY, JELLY_LOOT_MULT - 1);
      notifyCatalystFx(state, CARD_BERDAN_ROYAL_JELLY, CATALYST_FX.miss, x, y);
    }
  }
  if (carries(state, CARD_BERDAN_HIVE_QUEEN)) {
    const n = liveHiveWorkers(state);
    if (n > 0) {
      let hive = 1 + n * HIVE_LOOT_STEP;
      if (hive > HIVE_LOOT_CAP) hive = HIVE_LOOT_CAP;
      count *= hive;
    }
  }
  if (count === 1) return CATALYST_LOOT_NEUTRAL;
  return { rarity: 1, count };
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnWaveAdvanced(
  state: WorldState,
  prevSegment: number,
  nextSegment: number,
): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/**
 * {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 berdan 몫 — `id 34` 의 이동 배율.
 *
 * 감속(0<m<1)과 가속(>1)이 **한 칸으로** 표현된다: 젤리를 먹은 적은 굼뜨고, 먹지 못한 적은
 * 그만큼 빨라진다. 젤리가 하나도 없으면 **정확히 1**이라 곱셈이 무연산이다.
 *
 * ⚠️ 여기서 `e` 에 쓰기를 하지 않는다(앵커 계약) — 판정이 순수 위치 함수라 쓸 것도 없다.
 */
export function berdanOnEnemyStep(state: WorldState, e: Entity): number {
  if (!carries(state, CARD_BERDAN_ROYAL_JELLY)) return 1;
  if (!anyJelly(state)) return 1;
  return onRoyalJelly(state, e.x, e.y) ? JELLY_SLOW_MULT : JELLY_HASTE_MULT;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 berdan 몫. **미배선**. */
export function berdanOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/**
 * {@link import('../catalystHooks.js').stepCatalystHazards} 의 berdan 몫. **미배선이 정답이다** —
 * 젤리는 피해 0 이라 공용 피해 루프가 애초에 건너뛴다(감속은 `berdanOnEnemyStep` 의 몫이다).
 */
export function berdanOnCatalystHazards(state: WorldState): void {
  void state;
}

/** 점프 주기 재수출 — 테스트와 렌더가 같은 상수를 본다(사본을 만들면 표와 코드가 갈린다). */
export { BERDAN_JUMP_TICKS, berdanSafeCenterX, berdanSafeCenterY, berdanCollapseLocked };
