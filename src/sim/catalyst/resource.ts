/**
 * 촉매 **자원 축**(id 15~19) — 카드 본체가 들어갈 자리.
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
  CATALYST_FOUNDRY_MARK,
  CATALYST_ORE_MARK,
  carries,
  isCatalystShadow,
} from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { CATALYST_FX, creditCatalyst, missCatalyst, notifyCatalystFx } from './fx.js';
import { readMark, writeMark } from '../catalystMarks.js';
import {
  FoundrySlot,
  GreedSlot,
  MercantileSlot,
  readCatalystSlot,
  writeCatalystSlot,
} from '../catalystSlots.js';
import { spawnDestructible, spawnEventObject, spawnLoot } from '../entities.js';
// `id 16` 포탑 기계. `events.ts` 는 **순수 리프**(type-only import 뿐)라 순환이 안 생긴다.
import { activateTurret, isActiveTurret } from '../events.js';
import { summonEnemy } from '../waves.js';
import { applyPowerup } from '../powerups.js';
import { ENEMY_BY_TYPE } from '../../../data/enemies.js';

/** id 15 — slug `extraction`. 정본은 `src/data/catalysts.ts`. */
export const CARD_EXTRACTION = 15;

/** id 16 — slug `foundry`. 정본은 `src/data/catalysts.ts`. */
export const CARD_FOUNDRY = 16;

/** `id 16` — 포탑 하나가 서기까지 필요한 처치 수(*"적 셋을 처치할 때마다"*). */
const FOUNDRY_KILLS_PER_TURRET = 3;

/**
 * `id 16` — 포탑 수명(틱). **20초 @60틱** — 카드 정본(`data/catalysts.ts` 의 id 16 주석
 * *"적 셋마다 포탑이 선다(20초)"*)이 값의 근거다.
 *
 * ⚠️ `activateTurret` 이 세우는 `TURRET_LIFE_TICKS` 는 600(10초)이라 **다르다.** 스폰부에서
 * 반드시 덮어써라 — 안 덮으면 카드 설명과 화면이 갈린다.
 */
const FOUNDRY_TURRET_LIFE = 1200;

/** `id 16` — 포탑 반경. 드론 베이(44)와 같은 눈금이라 화면에서 같은 크기로 읽힌다. */
const FOUNDRY_TURRET_RADIUS = 44;

/** `id 16` — 포탑이 서는 자리(플레이어 기준 x 오프셋). 겹쳐 서지 않게 몸통 밖에 둔다. */
const FOUNDRY_SPAWN_OFFSET = 60;

/**
 * `id 16` — 포탑 **1기당 주무기 피해 배율**(= *"포탑 수만큼 네 공격력이 나뉜다"*).
 *
 * ⭐ 곱셈이라 **되돌릴 수 있다** — 포탑이 만료되면 배율이 즉시 원래대로 돌아온다(헌장 §페널티
 * 규율 3: 되돌릴 수단 동봉). 감산으로 두면 피해가 0 아래로 내려가 클램프가 필요해지고,
 * 그 클램프가 곧 "되돌아오지 않는 구간"이 된다.
 */
const FOUNDRY_DAMAGE_MULT_PER_TURRET = 0.85;

/**
 * `id 16` — 포탑 **동시 생존 상한**.
 *
 * ## 왜 상한이 필요한가 — 그리고 왜 대가를 약화시키지 않는가
 * 상한이 없으면 밀집 웨이브에서 포탑이 무한히 쌓여 `stepTurrets` 의 매 틱 비용(포탑마다
 * 조준 스캔 + LOS)이 그대로 커진다. 6 에서 배율이 이미 `0.85^6 ≈ 0.377` 이라 **대가는 이미
 * 지배적**이고, 그 위로는 이득도 대가도 체감이 거의 안 늘면서 비용만 는다.
 *
 * ⚠️ 상한은 이득과 대가를 **같이** 묶으므로 카드의 균형을 기울이지 않는다. 특히 보스전의
 * 대가(잡몹이 없어 포탑은 안 서는데 직전 포탑이 화력을 갉는다)는 상한과 무관하게 그대로다 —
 * **그것이 설계된 대가이므로 지우지 마라.**
 *
 * ⚠️ 상한 도달 시 **스폰만 생략**한다(RNG 미소비라 이후 시드가 안 밀린다 —
 * `CATALYST_HAZARD_LIVE_CAP` 과 같은 형태).
 */
const FOUNDRY_TURRET_CAP = 6;

/**
 * 지금 살아 있는 `id 16` 포탑 수. **이득(스폰 상한)과 대가(피해 배율)가 같은 수를 본다** —
 * 두 곳이 따로 세면 화면(포탑 개수)과 규칙(배율)이 조용히 갈린다.
 */
function foundryTurretCount(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) {
    if (!e.dead && e.ownerId === CATALYST_FOUNDRY_MARK && isActiveTurret(e)) n++;
  }
  return n;
}

/** id 17 — slug `greed`. 정본은 `src/data/catalysts.ts`. */
export const CARD_GREED = 17;

/** id 18 — slug `mercantile`. 정본은 `src/data/catalysts.ts`. */
export const CARD_MERCANTILE = 18;

/** id 19 — slug `motherlode`. 정본은 `src/data/catalysts.ts`. */
export const CARD_MOTHERLODE = 19;

// ---------------------------------------------------------------------------
// 상수 — 카드 다섯의 눈금
// ---------------------------------------------------------------------------

/**
 * `id 15 extraction` — 한 번의 보급 습격 자원을 나눠 실을 **최대 적 수**.
 *
 * 상한이 필요한 이유는 두 가지다. ①실린 액수는 `catalystMarks` 의 8비트 눈금이라 한 마리당
 * 255 가 천장인데, 그렇다고 화면의 적 전부에 1씩 흩뿌리면 **어느 적이 자원을 졌는지 화면에서
 * 안 보인다**(헌장 §가시성 — 신호가 보이지 않는 카드는 채택되지 않는다). ②`onResourceGranted`
 * 는 `compact()` 순회 안이라 여기서 도는 비용이 그대로 격추 경로에 붙는다.
 */
const EXTRACTION_MAX_CARRIERS = 4;

/**
 * `id 15`·`id 17` 공용 — 자원을 진 적이 **"화면을 벗어났다"고 판정하는 거리**(플레이어 기준).
 *
 * ⚠️ 실제 뷰포트 폭이 아니라 **자동 조준 사거리(`TURRET_RANGE` 900)보다 넉넉히 바깥**으로
 * 잡았다. 뷰포트에 맞추면 "화면 가장자리에 보이는데 이미 꺼진" 상태가 생겨 카드가 거짓말을
 * 한다. 반대로 무한정 크게 잡으면 두 카드의 대가(*"못 잡으면 증발한다"*)가 사라진다.
 */
const CARRIER_ESCAPE_DIST = 1600;

/** {@link CARRIER_ESCAPE_DIST} 의 제곱(매 적 매 틱 도는 자리라 제곱근을 피한다). */
const CARRIER_ESCAPE_DIST_SQ = CARRIER_ESCAPE_DIST * CARRIER_ESCAPE_DIST;

/**
 * `id 15` — 굳은 **자원 결정**의 마커(`loot.ownerId`).
 *
 * ⚠️⚠️ 이 마커가 이 카드의 **필수 선결**이다. 결정은 `loot` 틀을 쓰는데(신규 kind 를 만들면
 * 조준 술어·충돌 격자·아군탄 화이트리스트 세 목록이 갈린다), `collectLoot` 은 주운 `loot` 를
 * **무조건 `state.loot` 에 밀어 넣는다.** 마커로 갈라 `resourceOnLootCollected` 가 억제하지
 * 않으면 결정 하나마다 **가짜 장비**가 생기고, 더 나쁘게는 `catalystDropsFromRun` 이 드랍
 * 시드마다 60% 게이트를 굴려 **촉매까지 공짜로 늘어난다**(경제 축 붕괴 —
 * `onLootCollectedCatalyst` 주석의 ⭐절이 정본).
 */
const CATALYST_CRYSTAL_MARK = 0xc15a15;

/** `id 17` — 금빛 적을 죽였을 때의 배수(*"죽이면 세 배로 받는다"*). */
const GREED_KILL_MULT = 3;

/** `id 17` — 금빛 적이 솟아나는 자리의 플레이어 기준 x 오프셋(결정론 고정값, RNG 미소비). */
const GREED_SPAWN_OFFSET_X = 260;

/**
 * `id 18` — 빚 카드가 놓이는 **3택 칸의 인덱스**(0-based, 마지막 칸).
 *
 * ⚠️ **런타임 배열 길이에서 파생하지 않는다.** `onPowerupPicked` 시점의
 * `state.powerupChoices` 를 다시 읽어 `length - 1` 로 계산하면, 같은 레벨업에서 `id 14 mastery`·
 * `id 9 epiphany` 가 칸을 접었는지에 따라 **제시 때와 선택 때의 칸이 갈린다**. 상수로 고정하면
 * 3택이 3칸일 때만 빚 칸이 서고, 접힌 3택(2칸 이하)에서는 `offeredIndex` 가 이 값에 절대
 * 닿지 않아 **축소 작동**(빚 카드 없음 = 평범한 3택)이 저절로 성립한다.
 */
const MERCANTILE_DEBT_INDEX = 2;

/** `id 18` — 빚 카드를 한 번 받을 때 지는 부채(자원 단위). */
const MERCANTILE_DEBT_PER_PICK = 40;

/** `id 19` — 광석 덩어리의 충돌 반경. */
const ORE_RADIUS = 34;

/** `id 19` — 광석 덩어리의 HP. *"부수는 동안 자동 조준이 묶인다"* 가 대가라 즉사면 대가가 없다. */
const ORE_HP = 120;

/** `id 19` — 광석을 부쉈을 때 나오는 자원. */
const ORE_RESOURCE = 3;

/**
 * `id 19` — 광석의 **동시 생존 상한**.
 *
 * {@link import('./shared.js').CATALYST_HAZARD_LIVE_CAP} 과 **같은 형태이자 같은 사유**다.
 * 광석은 `isGimmick` 에서 제외돼(`world.ts`) 청크 컬링을 안 받으므로 **아무도 안 부수면
 * 영원히 남는다.** 상한이 없으면 긴 런에서 단조 증가하고, 그 전부가 조준 대상이라 자동 조준이
 * 광석 밭에 영영 묶인다. 상한에 닿으면 **스폰만 생략**한다 — RNG 를 한 칸도 안 쓰므로 생략돼도
 * 이후 시드 소비가 밀리지 않는다.
 */
const ORE_LIVE_CAP = 12;

// ---------------------------------------------------------------------------
// 틱-국소 스크래치 — `id 15` 의 "죽은 그 자리"를 다음 단계로 넘긴다
// ---------------------------------------------------------------------------

/**
 * 이번 틱에 **자원을 진 채 죽은 적**의 좌표와 액수.
 *
 * ## 왜 스크래치이고, 왜 그것이 안전한가
 * 결정을 떨구려면 ①"얼마를 지고 있었나"(= 적 엔티티의 `aux0` 마크)와 ②"어디서 죽었나" 둘 다
 * 필요한데, **한 앵커가 둘을 같이 주지 않는다**:
 *  - `onEnemyDamagedCatalyst` 는 개체를 주지만 `for (const b of state.entities)` **순회 안**이라
 *    스폰이 금지된다.
 *  - `onEnemyDeathCatalyst` 는 `state.entities = survivors` **뒤**라 스폰이 안전하지만
 *    `(x, y, elite)` 만 주고 **개체가 이미 배열 밖**이라 마크를 되짚을 방법이 원리적으로 없다.
 *
 * 그래서 앞에서 담고 뒤에서 꺼낸다. **두 지점은 같은 `stepWorld` 호출 안**이므로(피해 확정 →
 * `compact()` → 사망 통지) 이 배열은 틱 경계를 넘지 않는다 — 두 월드를 교대로 `stepWorld`
 * 하는 재현성 검증(`determinismGate`)에서도 서로를 오염시킬 수 없다. `DASH_PIERCE_SCRATCH`
 * (`catalystHooks.ts`)와 같은 규율이다.
 *
 * ⚠️ **여기 담기는 조건은 `hp <= 0`** 이고, `compact()` 의 처치 게이트가 정확히 같은 술어라
 * (`e.kind === 'enemy' && e.hp <= 0`) 담긴 항목은 **반드시** 같은 틱의 사망 통지에 도달한다.
 * 즉 이 배열이 틱을 넘겨 살아남는 경로가 없다.
 */
const EXTRACTION_CRYSTALS: { x: number; y: number; amount: number }[] = [];

/** 살아 있는 잡몹인가 — 그림자(`id 36`)는 죽일 수 없으므로 자원을 지울 수 없다. */
function isLiveMob(e: Entity): boolean {
  return e.kind === 'enemy' && !e.dead && !isCatalystShadow(e);
}

/** 플레이어(엔티티 0번). 없으면 `undefined`(월드 초기화 직후·테스트 하네스 방어). */
function playerOf(state: WorldState): Entity | undefined {
  return state.entities[0];
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
export function resourceOnTick(state: WorldState, player: Entity): void {
  // `id 17 greed` — **소환은 여기 한 곳뿐이다.** 적립 앵커는 `compact()` 의 엔티티 순회 안이라
  // 거기서 낳으면 같은 틱의 순회가 갈린다(디스패처 §주의). 그래서 적립은 대기 액수만 슬롯에
  // 적고, 실제 소환은 순회 밖인 이 자리에서 다음 틱에 일어난다.
  if (!carries(state, CARD_GREED)) return;
  const pending = readCatalystSlot(state.catalystSlots, GreedSlot.Pending);
  if (pending <= 0) return;
  // 눈금은 8비트라 한 마리가 255 까지만 진다. 넘는 몫은 **버리지 않고** 슬롯에 남겨 다음 틱에
  // 또 한 마리가 솟는다(절삭하면 그만큼이 조용히 증발한다).
  const amount = pending > 255 ? 255 : pending;
  // ⚠️ `summonEnemy` 다. `spawnEnemy` 는 `waveRng` 를 소비해 같은 시드의 웨이브·드랍·엘리트
  //    시퀀스를 통째로 민다(카탈로그 §훅이 이 카드에 대해 명시적으로 못 박은 지점).
  const def = ENEMY_BY_TYPE[0];
  if (def === undefined) return;
  const gold = summonEnemy(state, def, player.x + GREED_SPAWN_OFFSET_X, player.y);
  writeMark(gold, 'greedAmount', amount);
  writeCatalystSlot(state.catalystSlots, GreedSlot.Pending, pending - amount);
  notifyCatalystFx(state, CARD_GREED, CATALYST_FX.trigger, gold.x, gold.y);
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

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 resource 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function resourceOnEnemyDamageTakenMult(
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

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/**
 * {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 resource 몫 —
 * **`id 16 foundry` 의 대가: 포탑이 서 있는 동안 주무기 피해가 나뉜다.**
 *
 * 배율은 `0.85^(포탑 수)` — 포탑 하나마다 −15% 다. 포탑이 0 기면 배율이 **정확히 1** 이라
 * 레코드를 한 비트도 안 건드린다.
 *
 * ## ⭐ 이 대가는 **보스전에서 정면으로 아프다 — 설계된 것이다**
 * 보스전에는 잡몹이 없어 새 포탑이 안 선다. 그런데 직전 웨이브에서 선 포탑들은 최대 20초
 * 동안 남아 **화력만 갉는다**(포탑은 보스도 쏘지만 주무기보다 훨씬 약하다). 그것이 이 카드의
 * 리듬이다 — *"밀집 구간에서 벌고 보스 앞에서 갚는다"*. **완화하지 마라.**
 *
 * ## ⚠️ `damage` 만 고친다
 * `count`(탄수)를 나누면 아키타입마다 결과가 갈린다 — 빔·레일건은 `count` 를 아예 안 읽어
 * 대가가 통째로 사라지고, 발칸만 홀로 아파진다(`skillHooks.ts` 앵커 ⑯ 의 아키타입 표).
 * `damage` 는 **전 아키타입이 읽는** 유일한 칸이다.
 *
 * ⚠️ **RNG 미소비** — 배율은 살아 있는 포탑 수의 순수 파생이다.
 */
export function resourceOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void player;
  if (!carries(state, CARD_FOUNDRY)) return;
  const n = foundryTurretCount(state);
  if (n <= 0) return;
  let mult = 1;
  for (let i = 0; i < n; i++) mult *= FOUNDRY_DAMAGE_MULT_PER_TURRET;
  volley.damage *= mult;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/** {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnPlayerDamaged(state: WorldState, player: Entity, dmg: number, lethalSurvived: boolean, sources: DamageSourceMask): void {
  void state;
  void player;
  void dmg;
  void lethalSurvived;
  void sources;
}

/**
 * {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 resource 몫 —
 * **`id 16 foundry`: 적 셋을 처치할 때마다 포탑이 하나 선다.**
 *
 * ## 이 카드가 왜 오래 멈춰 있었는가 (해소 기록)
 * 이득은 처음부터 배선 가능했다 — 델타 카운터({@link FoundrySlot})가 서 있고, 이 앵커는
 * `state.entities = survivors` **뒤**라 스폰이 안전하다(`DRONE_MARK` 선례). 막힌 것은 **대가**
 * (*"포탑 수만큼 네 공격력이 나뉜다"*)였다: 플레이어가 **주는** 피해에 배율을 거는 촉매 앵커가
 * 하나도 없었기 때문이다. 그래서 이 레인이 **먼저 그 앵커를 뚫었고**
 * ({@link import('../catalystHooks.js').onVolleyParamsCatalyst}), 대가는
 * {@link resourceOnVolleyParams} 가 진다. 이득만 얹지 않는다.
 *
 * ## ⚠️ RNG 미소비
 * `spawnEventObject`·`activateTurret` 은 어느 스트림도 안 건드린다(`world.ts` 의 병아리 스폰
 * 주석이 같은 사실을 실측으로 적어 뒀다). 상한 도달 시에도 **스폰만 생략**하므로 이후 시드가
 * 안 밀린다.
 */
export function resourceOnKillsDelta(state: WorldState, delta: number): void {
  if (!carries(state, CARD_FOUNDRY)) return;
  if (delta <= 0) return;
  const player = state.entities[0];
  if (player === undefined) return;
  const slots = state.catalystSlots;
  let acc = readCatalystSlot(slots, FoundrySlot.KillDelta) + delta;
  // `while` 이지 `if` 가 아니다 — 한 틱에 여러 마리가 죽으면(광역기·연쇄) `delta` 가 2 이상이라
  // `if` 로 두면 초과분이 조용히 버려져 "셋마다"가 실제로는 더 느려진다.
  while (acc >= FOUNDRY_KILLS_PER_TURRET) {
    acc -= FOUNDRY_KILLS_PER_TURRET;
    if (foundryTurretCount(state) >= FOUNDRY_TURRET_CAP) continue;
    const t = spawnEventObject(
      state,
      'turretPickup',
      player.x + FOUNDRY_SPAWN_OFFSET,
      player.y,
      FOUNDRY_TURRET_RADIUS,
    );
    t.ownerId = CATALYST_FOUNDRY_MARK; // 청크 기믹과 구분(`isGimmick` 제외와 한 쌍).
    activateTurret(t); // 즉시 활성 — `stepTurrets` 가 조준·격발·수명을 돌린다.
    // ⚠️ `activateTurret` 이 `TURRET_LIFE_TICKS`(600 = 10초)를 세우므로 **덮어써야** 한다.
    //    카드 정본이 못 박은 수명은 20초다(`data/catalysts.ts` 의 id 16 주석).
    t.life = FOUNDRY_TURRET_LIFE;
    creditCatalyst(state, CARD_FOUNDRY, 1);
    notifyCatalystFx(state, CARD_FOUNDRY, CATALYST_FX.trigger, t.x, t.y);
  }
  writeCatalystSlot(slots, FoundrySlot.KillDelta, acc);
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 resource 몫 —
 * **자원을 진 적이 죽는 순간**을 잡는 유일한 자리다(`id 15` · `id 17`).
 *
 * 이 앵커는 *"피해 확정 + 격추/부활 판정 직후"* 라 `target.hp` 가 그 틱의 진실이고 개체가 아직
 * 살아 있다(배열 안에 있다) — 사망 통지(`onEnemyDeath`)는 좌표만 주고 개체를 안 주므로
 * **마크를 되짚을 수 있는 지점은 여기뿐**이다.
 *
 * ⚠️ 이 지점은 `for (const b of state.entities)` 순회 안이다 — **스폰하지 않는다.** `id 17` 은
 * 자원 가산이라 스폰이 없고, `id 15` 는 좌표·액수만 {@link EXTRACTION_CRYSTALS} 에 담아
 * 순회 밖(`resourceOnEnemyDeath`)에서 결정을 떨군다.
 */
export function resourceOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void dmg;
  void source;
  // 핫 경로 — 적마다 명중마다 돈다. 값싼 조기 반환이 첫 줄이다.
  if (target.kind !== 'enemy' || target.hp > 0) return;

  // ── id 15 — 죽는 자리에 결정으로 굳는다(자원이 아니라 **회수 단계가 하나 더** 있다) ──
  if (carries(state, CARD_EXTRACTION)) {
    const carried = readMark(target, 'extractionAmount');
    if (carried > 0) {
      // 먼저 지운다 — 같은 틱에 두 발이 겹쳐 맞으면(`hp <= 0` 이 두 번 관측된다) 결정이 두 개
      // 생겨 자원이 복제된다. 마크가 유일한 진실이므로 소비 즉시 0 으로 만든다.
      writeMark(target, 'extractionAmount', 0);
      EXTRACTION_CRYSTALS.push({ x: target.x, y: target.y, amount: carried });
    }
  }

  // ── id 17 — 죽이면 세 배, 못 죽이면 사라진다(사라짐은 `resourceOnEnemyStep` 가 잡는다) ──
  if (carries(state, CARD_GREED)) {
    const gold = readMark(target, 'greedAmount');
    if (gold > 0) {
      writeMark(target, 'greedAmount', 0);
      const payout = gold * GREED_KILL_MULT;
      state.resources += payout;
      creditCatalyst(state, CARD_GREED, payout);
      notifyCatalystFx(state, CARD_GREED, CATALYST_FX.credit, target.x, target.y);
    }
  }
}

/**
 * {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 resource 몫 —
 * **스폰이 안전한 첫 지점**이다(`state.entities = survivors` 뒤, 확보 이후).
 *
 *  - `id 15` — 이번 틱에 담긴 결정을 전부 떨군다. 좌표는 인자가 아니라 스크래치의 것이다
 *    (인자 `(x, y)` 는 "이번에 통지된 죽음"이고 결정의 주인과 다를 수 있다 — 좌표로 짝을
 *    맞추려 들면 부동소수 동등 비교가 계약이 된다).
 *  - `id 19` — 광석 덩어리를 남긴다.
 */
export function resourceOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  // ── id 15 — 담긴 결정을 전부 떨구고 스크래치를 비운다 ─────────────────────
  // 길이 검사가 첫 줄이라 이 카드가 없는 런은 여기서 끝난다(스크래치는 게이트 안에서만 찬다).
  if (EXTRACTION_CRYSTALS.length > 0) {
    for (const c of EXTRACTION_CRYSTALS) {
      // `loot` 틀 + 마커. `damage` 칸은 원래 드랍 시드 자리인데 결정은 시드가 아니라 **액수**를
      // 진다 — `resourceOnLootCollected` 가 마커를 보고 그 칸을 액수로 읽는 것이 계약이다.
      // 등급코드는 0(일반)으로 둔다. 억제 분기 덕에 이 값이 `state.loot` 로 흘러가지 않는다.
      const crystal = spawnLoot(state, c.x, c.y, c.amount, 0);
      crystal.ownerId = CATALYST_CRYSTAL_MARK;
      notifyCatalystFx(state, CARD_EXTRACTION, CATALYST_FX.trigger, c.x, c.y);
    }
    EXTRACTION_CRYSTALS.length = 0;
  }

  // ── id 19 motherlode — 적이 광맥이 된다 ───────────────────────────────────
  if (!carries(state, CARD_MOTHERLODE)) return;
  // **엘리트만** 광맥이 된다. 잡몹 전부가 광석을 남기면 ①동시 생존 상한을 즉시 채워 상한이
  // 사실상 "처음 12마리"라는 무작위 규칙이 되고 ②전부가 조준 대상이라 자동 조준이 광석 밭에
  // 영구히 묶여 대가가 대가가 아니라 봉쇄가 된다. 엘리트는 이 sim 의 전리품 원천이라
  // *"적이 광맥이 된다"* 의 결과 크기도 그쪽이 맞다.
  if (!elite) return;
  let live = 0;
  for (const e of state.entities) {
    if (!e.dead && e.kind === 'destructible' && e.ownerId === CATALYST_ORE_MARK) live++;
  }
  if (live >= ORE_LIVE_CAP) return;
  // xpValue 는 0 이다 — 광석은 젬이 아니라 자원을 낸다. 파괴 앵커가 기본 젬 드랍을 억제하므로
  // 이 값이 실제로 쓰이는 경로는 없지만, 0 을 명시해 "여기서 젬이 나올 수도 있다"는 오독을 막는다.
  const ore = spawnDestructible(state, x, y, ORE_RADIUS, ORE_HP, 0);
  ore.ownerId = CATALYST_ORE_MARK;
  notifyCatalystFx(state, CARD_MOTHERLODE, CATALYST_FX.trigger, x, y);
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/**
 * {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 resource 몫.
 *
 * ⚠️ **`id 18 mercantile` 은 여기서 선택지를 갈아 끼우지 않는다 — 의도적이다.**
 * 빚 카드는 *"3택 한 칸이 빚 카드가 된다"* 이지 *"다른 파워업으로 바뀐다"* 가 아니다. 그 칸의
 * 파워업은 그대로 두고 **받는 조건만** 달라진다(2중첩 + 부채). 그래서 `state.powerupChoices` 를
 * 만질 이유가 없고, 만지면 `drawPowerupChoices` 가 이미 굴린 결과를 덮어 빌드 가중치가 깨진다.
 * 어느 칸인지는 {@link MERCANTILE_DEBT_INDEX} 상수가 소유하고 `resourceOnPowerupPicked` 가 읽는다.
 *
 * ⚠️ **미해결로 보고한 축**: *"한 칸이 붉은 차용증으로 바뀐다"* 는 3택 **UI 렌더**의 축인데,
 * 이 레인이 가진 통지 채널(`catalystFx`)은 **월드 좌표 이벤트**라 3택 카드 칸을 지목할 수 없다.
 * 3택 스냅샷에 "이 칸이 빚 카드"를 싣는 필드는 이 레인 밖이다(스냅샷·렌더 소유).
 */
export function resourceOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/**
 * {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 resource 몫 —
 * `id 18 mercantile` 의 **빚 카드 수락**.
 *
 * 호출부가 이미 기본 1중첩을 적용한 뒤라 여기서는 **추가분 1중첩만** 얹는다(= 2중첩).
 * 그 대가로 부채가 슬롯에 쌓이고, 그 값은 정산 채널(`catalystSettlementOf`)로 나간다.
 *
 * ⚠️ **파워업 스택 수로 파생하지 않는다.** 같은 파워업이 다른 경로로도 쌓이므로 스택 수는
 * "빚 카드를 몇 번 받았는가"와 다르고, 그 순간 HUD 가 보여 준 부채와 정산이 갈린다.
 */
export function resourceOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  if (!carries(state, CARD_MERCANTILE)) return;
  // 빚 칸은 상수다(사유는 {@link MERCANTILE_DEBT_INDEX}). 3택이 접힌 레벨업에서는 이
  // 인덱스에 닿을 수 없어 자동으로 **축소 작동**(빚 카드 없는 평범한 3택)이 된다.
  if (offeredIndex !== MERCANTILE_DEBT_INDEX) return;
  // ⚠️ RNG 미소비 — `applyPowerup` 은 난수를 쓰지 않는다(디스패처 주석의 실측).
  applyPowerup(state, poolIndex);
  const debt = readCatalystSlot(state.catalystSlots, MercantileSlot.Debt);
  writeCatalystSlot(state.catalystSlots, MercantileSlot.Debt, debt + MERCANTILE_DEBT_PER_PICK);
  notifyCatalystFx(state, CARD_MERCANTILE, CATALYST_FX.trigger, state.entities[0]?.x ?? 0, state.entities[0]?.y ?? 0);
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/**
 * {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 resource 몫 —
 * **`id 15 extraction` · `id 17 greed` 둘 다 여기서 자원을 가로챈다.**
 *
 * ## ⚠️ 두 카드가 같이 실린 런 — 한 번만 가로챈다
 * 둘 다 공용이라 한 런에 공존할 수 있다. 각자 `state.resources -= amount` 를 하면 **한 번
 * 들어온 자원을 두 번 뺀다**(자원이 음수가 된다). `taken` 플래그로 먼저 성립한 쪽이 가져가고
 * 나머지는 이번 적립을 건드리지 않는다. 순서는 id 오름차순 고정이다 — 조건에 따라 순서가
 * 바뀌면 같은 시드의 런이 갈린다.
 *
 * ## ⚠️ 가로채기는 **차감이지 재계산이 아니다**
 * 호출부가 이미 `state.catalystResourceMilli` 캐리를 굴리고 `state.resources += whole` 을 한
 * 뒤다. 여기서는 그 `whole` 만 되돌린다 — 캐리에는 손대지 않는다. 캐리까지 만지면 소수분
 * 이월이 어긋나 이후 습격의 적립이 통째로 밀린다.
 */
export function resourceOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  if (amount <= 0) return;
  let taken = false;

  // ── id 15 extraction — 화면의 적들에게 싣는다 ──────────────────────────────
  if (carries(state, CARD_EXTRACTION)) {
    // 실을 적을 고른다. **격추 지점 기준 근접**이 아니라 순회 순서 앞쪽부터인 이유: 거리 정렬은
    // 비교 함수 tie-break 이 필요한데(같은 거리의 두 적) 그것을 빠뜨리면 플랫폼 정렬 안정성에
    // 결과가 의존한다 — 이 저장소가 `nearestTarget` 에서 이미 겪은 형태다. 순회 순서는 그
    // 자체로 결정론이라 tie-break 이 원리적으로 필요 없다.
    const carriers: Entity[] = [];
    for (const e of state.entities) {
      if (carriers.length >= EXTRACTION_MAX_CARRIERS) break;
      if (!isLiveMob(e)) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > CARRIER_ESCAPE_DIST_SQ) continue;
      carriers.push(e);
    }
    // **축소 작동** — 실을 적이 하나도 없으면 자원은 그냥 들어온다. 이득 없이 대가만 물리지
    // 않는다(헌장 §축소 작동 규율): 여기서 그냥 자원을 없애면 "적이 없는 순간의 습격은 손해"가
    // 되어 플레이어가 통제할 수 없는 방식으로 카드가 마이너스가 된다.
    if (carriers.length > 0) {
      state.resources -= amount;
      taken = true;
      // 정수 분배 — 나머지는 앞쪽부터 1씩. 눈금이 8비트라 `writeMark` 가 255 에서 절삭하므로
      // **실제로 실린 합**을 되읽어 확인하고, 절삭돼 사라진 몫은 `missCatalyst` 로 잡는다
      // (헌장: 놓친 액수가 보여야 다음 판에 조건을 추구한다).
      const share = Math.floor(amount / carriers.length);
      const rem = amount - share * carriers.length;
      let loaded = 0;
      for (let i = 0; i < carriers.length; i++) {
        const e = carriers[i];
        if (e === undefined) continue;
        const before = readMark(e, 'extractionAmount');
        writeMark(e, 'extractionAmount', before + share + (i < rem ? 1 : 0));
        loaded += readMark(e, 'extractionAmount') - before;
      }
      notifyCatalystFx(state, CARD_EXTRACTION, CATALYST_FX.trigger, x, y);
      if (loaded < amount) missCatalyst(state, CARD_EXTRACTION, amount - loaded);
    }
  }

  // ── id 17 greed — 그 값어치만큼 적이 되어 나타난다 ────────────────────────
  if (!taken && carries(state, CARD_GREED)) {
    state.resources -= amount;
    // ⚠️ 여기서 소환하지 않는다 — 이 호출은 `compact()` 의 엔티티 순회 안이다. 대기 액수만
    //    슬롯에 적고 순회 밖(`resourceOnTick`)에서 다음 틱에 솟는다.
    const pending = readCatalystSlot(state.catalystSlots, GreedSlot.Pending);
    writeCatalystSlot(state.catalystSlots, GreedSlot.Pending, pending + amount);
    notifyCatalystFx(state, CARD_GREED, CATALYST_FX.trigger, x, y);
  }
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/** {@link import('../catalystHooks.js').onLootRollCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  void state;
  void x;
  void y;
  void elite;
  return CATALYST_LOOT_NEUTRAL;
}

/**
 * {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 resource 몫 —
 * `id 15` 의 **자원 결정 회수**. ⚠️⚠️ 이 분기가 없으면 카드가 경제를 깬다(§상수 주석).
 *
 * `true` 를 돌려주므로 결정은 `state.loot` 에 **안 들어간다** — 가짜 장비도, 드랍 시드마다
 * 굴러가는 촉매 게이트도 생기지 않는다. 자원은 여기서 **실제 자원 경로**로 들어가고
 * (`creditCatalyst` 는 귀속 장부일 뿐 자원을 주지 않는다) 장부는 그 옆에 따로 적는다.
 */
export function resourceOnLootCollected(state: WorldState, loot: Entity): boolean {
  // 마커 검사가 첫 줄 — 다른 카드·무촉매 전리품은 여기서 즉시 빠진다.
  if (loot.ownerId !== CATALYST_CRYSTAL_MARK) return false;
  const amount = loot.damage >>> 0;
  state.resources += amount;
  creditCatalyst(state, CARD_EXTRACTION, amount);
  notifyCatalystFx(state, CARD_EXTRACTION, CATALYST_FX.credit, loot.x, loot.y);
  return true;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/**
 * {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 resource 몫 — **대가가 실현되는
 * 자리**다. `id 15`·`id 17` 둘 다 *"화면을 벗어나면 사라진다"* 가 규칙문에 있고, 그 사라짐을
 * 관측할 수 있는 유일한 앵커가 여기다(적마다 매 틱).
 *
 * ⚠️ 반환값은 **이동 배율**이다. 이 카드들은 속도를 안 건드리므로 항상 중립 `1` 을 돌려준다 —
 * 여기서 값을 바꾸면 13개 그룹의 곱에 들어가 다른 카드의 배율과 섞인다.
 *
 * ⚠️ 핫 경로다(적 × 매 틱 × 13그룹). 첫 줄이 카드 소지 게이트이고, 그 다음이 마크 읽기다 —
 * 무촉매 런은 이 함수에 도달하지 않고, 이 카드가 없는 촉매 런은 첫 줄에서 끝난다.
 */
export function resourceOnEnemyStep(state: WorldState, e: Entity): number {
  const hasExtraction = carries(state, CARD_EXTRACTION);
  const hasGreed = carries(state, CARD_GREED);
  if (!hasExtraction && !hasGreed) return 1;
  const carriedExtraction = hasExtraction ? readMark(e, 'extractionAmount') : 0;
  const carriedGreed = hasGreed ? readMark(e, 'greedAmount') : 0;
  if (carriedExtraction === 0 && carriedGreed === 0) return 1;
  const player = playerOf(state);
  if (player === undefined) return 1;
  const dx = e.x - player.x;
  const dy = e.y - player.y;
  if (dx * dx + dy * dy <= CARRIER_ESCAPE_DIST_SQ) return 1;
  // 걸어 나갔다 — 액수가 잿빛으로 꺼진다. **놓친 액수를 반드시 장부에 적는다**: 두 카드는
  // 조건 미달로 자원이 증발하는 형태라, 놓침이 안 보이면 플레이어가 "왜 벌이가 줄었는지"를
  // 알 방법이 없다(헌장 §귀속 규율 — `missed` 칸이 존재하는 이유 자체다).
  if (carriedExtraction > 0) {
    writeMark(e, 'extractionAmount', 0);
    missCatalyst(state, CARD_EXTRACTION, carriedExtraction);
    notifyCatalystFx(state, CARD_EXTRACTION, CATALYST_FX.miss, e.x, e.y);
  }
  if (carriedGreed > 0) {
    writeMark(e, 'greedAmount', 0);
    missCatalyst(state, CARD_GREED, carriedGreed);
    notifyCatalystFx(state, CARD_GREED, CATALYST_FX.miss, e.x, e.y);
  }
  return 1;
}

/**
 * {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 resource 몫 —
 * `id 19` 의 **광석 파괴**. `true` 로 기본 젬 드랍을 억제한다(광석은 젬이 아니라 자원을 낸다).
 *
 * ⚠️ 이 앵커는 `compact()` 안이고 **`dead` 가 서야 도달한다**(`hp = 0` 만으로는 안 불린다).
 * 자원 가산뿐이라 스폰이 없다 — 순회 안이어도 안전하다.
 */
export function resourceOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  if (e.ownerId !== CATALYST_ORE_MARK) return false;
  state.resources += ORE_RESOURCE;
  creditCatalyst(state, CARD_MOTHERLODE, ORE_RESOURCE);
  notifyCatalystFx(state, CARD_MOTHERLODE, CATALYST_FX.credit, e.x, e.y);
  return true;
}

/** {@link import('../catalystHooks.js').stepCatalystHazards} 의 resource 몫. **미배선**(위 §주석). */
export function resourceOnCatalystHazards(state: WorldState): void {
  void state;
}
