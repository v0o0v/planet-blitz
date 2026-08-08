/**
 * 촉매 **출력 축**(id 25~29) — 카드 본체.
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
 * ---
 *
 * ## ⭐ `player.maxHp` — 이 그룹이 정한 **공유 필드 우선순위**
 * 이 칸을 만지는 소비자가 여섯이다: 여기의 `id 27`·`id 29`, 다른 그룹의 `id 12`·`id 24`,
 * 침식 약공명, 그리고 **반대 방향으로 올리는** 파워업 셋(`powerups.ts:163,286,337`).
 * 여섯이 임의 순서로 섞이므로 "누가 먼저인가"를 정하는 대신 **순서가 결과를 바꾸지 않는
 * 형태**로 못 박는다:
 *
 *  1. **절대값 대입 금지 — 전부 델타다.** `maxHp = X` 를 쓰는 순간 그 카드가 앞선 모든
 *     기여(파워업 가산 포함)를 조용히 지우고, 결과가 적용 순서에 의존하게 된다. 덧셈만
 *     쓰면 교환법칙이 순서 독립성을 공짜로 준다.
 *  2. **되돌림은 자기가 깎은 만큼만.** 각 카드가 **자기 원장**을 들고(`id 27` =
 *     {@link AfterburnerSlot.Ledger} · `id 24` = `ChainReactionSlot.MaxHpCut`) 그 범위
 *     안에서만 되감는다. 남의 삭감분을 되돌리면 두 카드가 같이 실린 런에서 최대 HP 가
 *     출발값을 넘어 **대가가 순이득으로 뒤집힌다**.
 *  3. **하한은 1.** 0 을 허용하면 페널티 자체가 사망 원인이 되어 헌장 §페널티 3(되돌릴
 *     수단이 규칙 안에 있어야 한다)이 무의미해진다.
 *  4. **`id 29` 의 절반화만 예외적으로 비례식이고, 그래서 런 시작 1회로 못 박는다**
 *     (`state.tick === 0`). 비례식을 런 중에 반복하면 다른 다섯의 기여까지 매번 반토막
 *     내면서 지수적으로 수렴한다 — 절반화는 "출발 체력"의 성질이지 상시 배율이 아니다.
 *  5. 상한이 현재 hp 아래로 내려오면 **현재 hp 도 따라 내려온다**(그것이 화면에서 읽히는
 *     대가다). 반대로 되돌릴 때 hp 는 안 올린다 — 상한 회복은 회복이 아니다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { spawnLoot } from '../entities.js';
import { FIRE_CD_Q } from '../constants.js';
import { applyStasis } from '../status.js';
import { readMark, writeMark } from '../catalystMarks.js';
import {
  AfterburnerSlot,
  BulwarkSlot,
  OverdriveSlot,
  RapidcoreSlot,
  readCatalystSlot,
  writeCatalystSlot,
} from '../catalystSlots.js';
import { CATALYST_LOOT_NEUTRAL, carries, isCatalystShadow } from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { CATALYST_FX, creditCatalyst, missCatalyst, notifyCatalystFx } from './fx.js';

/** id 25 — slug `overdrive`. 정본은 `src/data/catalysts.ts`. */
export const CARD_OVERDRIVE = 25;

/** id 26 — slug `rapidcore`. 정본은 `src/data/catalysts.ts`. */
export const CARD_RAPIDCORE = 26;

/** id 27 — slug `afterburner`. 정본은 `src/data/catalysts.ts`. */
export const CARD_AFTERBURNER = 27;

/** id 28 — slug `bulwark`. 정본은 `src/data/catalysts.ts`. */
export const CARD_BULWARK = 28;

/** id 29 — slug `ascendant`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ASCENDANT = 29;

// ---------------------------------------------------------------------------
// 수치 — **전부 여기 한 곳**(리터럴을 분기에 흩지 마라)
// ---------------------------------------------------------------------------

/** `id 25` — 임계 열. 볼리 한 번이 열 1 이므로 **연사 60발**이 곧 임계다. */
const OVERDRIVE_HEAT_MAX = 60;

/** `id 25` — 임계 초과 시 발사가 멎는 틱(3초 · 60틱/초). */
const OVERDRIVE_SILENCE_TICKS = 180;

/** `id 25` — **백열** 판정 열(임계의 80%). 이 위에서 죽인 적이 자원을 두 배 뱉는다. */
const OVERDRIVE_WHITEHEAT = 48;

/**
 * `id 25` — 냉각 주기(틱). 이 주기마다 열이 1 내린다.
 *
 * ⚠️ **발사 주기보다 느려야 한다.** 기본 무기 간격이 6틱 남짓이라 12틱 냉각이면 연사 중에는
 * 순증(열이 오른다), 손을 놓으면 순감(식는다)이 된다 — *"열을 임계 직전에서 관리하는 숙련
 * 플레이"* 라는 카드의 이득 조건이 이 부등식 하나에 걸려 있다. 냉각이 더 빠르면 열이 절대
 * 안 차서 카드가 통째로 무발동이 되고, 냉각이 없으면 침묵이 **되돌릴 수 없는 숨은 카운트다운**
 * 이 되어 헌장 §페널티 3 위반이다.
 */
const OVERDRIVE_COOL_PERIOD = 12;

/** `id 26` — 최대 배율(2배)에 닿는 방향 유지 틱(3초). */
const RAPIDCORE_MAX_TICKS = 180;

/** `id 27` — 대시 한 번의 최대 HP 대가(그리고 관통 처치 하나의 되돌림). */
const AFTERBURNER_HP_STEP = 3;

/** `id 27` — 대기 전리품 포화 상한(원장 하위 4비트). */
const AFTERBURNER_PENDING_MAX = 15;

/** `id 27` — 원장 인코딩의 밑(`cut * 16 + pending`). {@link AfterburnerSlot.Ledger} 참조. */
const AFTERBURNER_LEDGER_BASE = 16;

/** `id 27` — 확정 전리품의 등급 코드(0 = 일반). sim 은 아이템 값을 모른다(시드·등급코드만). */
const AFTERBURNER_LOOT_RARITY = 0;

/** `id 27` — 확정 전리품 시드 파생 솔트. 런마다 고정이라 **순수 파생**이다(RNG 미소비). */
const AFTERBURNER_LOOT_SALT = 0x5eed_0027;

/** `id 28` — 방벽 지속 틱(3초). */
const BULWARK_TICKS = 180;

/**
 * `id 28` — 방벽 반경. 이 안에서만 탄이 부서진다.
 *
 * 규칙문에 반경이 없지만 **무한 반경은 화면 절반의 탄을 통째로 지운다** — 그러면 대가(아군탄
 * 차단)가 이득에 한참 못 미쳐 카드가 일방적 이득이 된다. 반경을 두면 "방벽"이라는 신호
 * (기체 앞에 펼쳐진 육각 판)와 코드가 같은 것을 말한다.
 */
const BULWARK_RADIUS = 160;

/**
 * `id 28` — 방벽 반각의 코사인. 120° 부채꼴이므로 반각 60°, `cos 60° = 0.5`.
 * 삼각함수 대신 내적으로 판정한다(틱마다 탄 수만큼 도는 자리다).
 */
const BULWARK_COS_HALF = 0.5;

/** `id 29` — 대시 무적 중 통과당한 적의 이동 불능 틱(2초). */
const ASCENDANT_ROOT_TICKS = 120;

// ---------------------------------------------------------------------------
// 공용 리프 — 이 파일 안에서만 쓴다
// ---------------------------------------------------------------------------

/**
 * 규약상 플레이어는 `entities[0]` 이고 `createWorld` 가 그 불변식을 세운다
 * (`skillHooks.ts` 의 `playerOf` · `chainHooks.ts` 의 같은 사본과 동일 — 그 파일들을 import
 * 하면 이 디렉터리를 만든 사유인 순환 회피가 무효가 된다).
 */
function playerOf(state: WorldState): Entity | undefined {
  return state.entities[0];
}

/**
 * 8방위 **방향 코드**(1..8, `0` = 없음).
 *
 * 값 규약 1(`0` = 없음)이라 방향은 1부터 매긴다. 8방위로 접는 이유는 슬롯이 비음 정수만
 * 담기 때문이고(각도를 그대로 담을 수 없다), 8이면 `id 26` 의 "같은 방향 유지" 가 대각
 * 입력에서도 성립한다.
 */
function dirCode(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  let oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  if (oct < 0) oct += 8;
  return oct + 1;
}

/** {@link dirCode} 의 역 — 코드(1..8)의 단위 벡터. 코드 `0` 은 부르지 마라. */
function dirVector(code: number): { x: number; y: number } {
  const a = (code - 1) * (Math.PI / 4);
  return { x: Math.cos(a), y: Math.sin(a) };
}

/**
 * 순수 해시 — **RNG 를 한 칸도 소비하지 않는다**(공통 계약 ①). `drops.ts` 의 동명 사설
 * 함수와 같은 산술이고, 그 파일은 이 디렉터리에서 값으로 끌면 안 되는 축이라 사본을 둔다.
 */
function mix32(x: number, salt: number): number {
  let h = (x ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb_352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846c_a68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** `id 27` 원장 읽기 — {@link AfterburnerSlot.Ledger} 인코딩의 **유일 해석처**. */
function readAfterburnerLedger(state: WorldState): { cut: number; pending: number } {
  const v = readCatalystSlot(state.catalystSlots, AfterburnerSlot.Ledger);
  return {
    cut: Math.floor(v / AFTERBURNER_LEDGER_BASE),
    pending: v % AFTERBURNER_LEDGER_BASE,
  };
}

/** `id 27` 원장 쓰기 — `pending` 은 **포화**한다(넘치면 버린다. 슬롯 doc §인코딩). */
function writeAfterburnerLedger(state: WorldState, cut: number, pending: number): void {
  const p = pending > AFTERBURNER_PENDING_MAX ? AFTERBURNER_PENDING_MAX : pending < 0 ? 0 : pending;
  const c = cut < 0 ? 0 : cut;
  writeCatalystSlot(state.catalystSlots, AfterburnerSlot.Ledger, c * AFTERBURNER_LEDGER_BASE + p);
}

/**
 * `id 25` 가 이번 명중에 얹는 **추가 피해 배율**(0 = 없음, 1 = 두 배).
 * 열이 임계에 가까울수록 오른다 — 이득과 대가가 **한 곡선**이라는 것이 이 함수다.
 */
function overdriveBonus(state: WorldState): number {
  const heat = readCatalystSlot(state.catalystSlots, OverdriveSlot.Heat);
  const r = heat / OVERDRIVE_HEAT_MAX;
  return r > 1 ? 1 : r;
}

/** `id 26` 이 이번 명중에 얹는 **추가 피해 배율**(0 = 없음, 1 = 두 배). */
function rapidcoreBonus(state: WorldState): number {
  const held = readCatalystSlot(state.catalystSlots, RapidcoreSlot.HeldTicks);
  const r = held / RAPIDCORE_MAX_TICKS;
  return r > 1 ? 1 : r;
}

/**
 * 이 좌표에서 방금 죽은 잡몹 — {@link powerOnLootRoll} 이 **표식을 읽기 위해** 쓴다.
 *
 * 전리품 롤 앵커는 좌표만 받는데(`onLootRollCatalyst(state, …, e.x, e.y, elite)`), `id 27`·
 * `id 29` 의 전리품 조항은 *"그 적이 어떤 상태로 죽었는가"* 를 묻는다. 다행히 호출 지점이
 * `compact()` 의 `for (const e of state.entities)` **순회 안**이라 시체가 아직 배열에 있고,
 * 좌표는 그 개체에서 그대로 넘어온 값이라 **비트 단위로 같다**(부동소수 오차가 낄 여지가 없다).
 * 그래서 등가 비교로 정확히 그 개체를 되찾을 수 있다.
 *
 * ⚠️ 같은 좌표에 시체가 둘일 수 있다(스폰이 겹친 경우). 순회 순서상 **먼저 만난 쪽**을
 * 돌려주므로 결정론적이다 — 어느 쪽을 고르든 시드 소비가 없어 스트림이 안 밀린다.
 */
function deadEnemyAt(state: WorldState, x: number, y: number): Entity | undefined {
  for (const e of state.entities) {
    if (e.kind !== 'enemy' || !e.dead) continue;
    if (e.x === x && e.y === y) return e;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 매 틱 진입점
// ---------------------------------------------------------------------------

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 *
 * ## 이 자리가 어디인가 (실측 — 배선의 전제다)
 * `stepShipSignature` 진입점이라 **`stepPlayer` 직후 · `autoAttack` 직전**이다. 그래서
 *  - `player.vx/vy` 가 **이번 틱 입력이 만든 값**이고(`id 26` 이 그것을 읽는다),
 *  - 여기서 `player.cooldown` 을 세우면 같은 틱의 `autoAttack` 이 그것을 읽는다
 *    (`id 25` 의 침묵이 실제로 발사를 멎게 하는 유일한 통로다).
 */
export function powerOnTick(state: WorldState, player: Entity): void {
  if (carries(state, CARD_ASCENDANT)) ascendantTick(state, player);
  if (carries(state, CARD_OVERDRIVE)) overdriveTick(state, player);
  if (carries(state, CARD_RAPIDCORE)) rapidcoreTick(state, player);
  if (carries(state, CARD_AFTERBURNER)) afterburnerTick(state, player);
  if (carries(state, CARD_BULWARK)) bulwarkTick(state);
}

/**
 * `id 29` — **최대 HP 절반**. 헤더 §공유 필드 규칙 4 대로 **런 시작 1회**다.
 *
 * `state.tick === 0` 인 틱은 런당 정확히 하나이고(그 뒤 `stepWorld` 말미가 증가시킨다) 아직
 * 어떤 파워업도 적용되지 않았으므로, 절반화가 다른 기여자를 건드릴 여지가 원천적으로 없다.
 */
function ascendantTick(state: WorldState, player: Entity): void {
  if (state.tick !== 0) return;
  const half = Math.floor(player.maxHp / 2);
  const next = half < 1 ? 1 : half;
  if (next >= player.maxHp) return;
  player.maxHp = next;
  if (player.hp > player.maxHp) player.hp = player.maxHp;
  notifyCatalystFx(state, CARD_ASCENDANT, CATALYST_FX.selfHarm, player.x, player.y);
}

/**
 * `id 25` — 냉각과 **침묵의 집행**.
 *
 * 침묵은 `player.cooldown`(Q 단위 = 1/{@link FIRE_CD_Q} 틱)을 매 틱 다시 세워 집행한다.
 * `autoAttack` 첫 두 줄이 `cooldown -= FIRE_CD_Q` → `if (cooldown > 0) return` 이므로
 * `2 * FIRE_CD_Q` 를 세우면 감산 후에도 양수라 **이번 틱 발사가 확실히 멎는다.**
 *
 * ⚠️ 입력을 씹지 않는다(헌장 §페널티 1) — 멎는 것은 **자동 발사**뿐이고 이동·대시·조준은
 * 그대로다. 그리고 침묵은 3초 뒤 스스로 풀린다(되돌릴 수단 동봉 — §페널티 3).
 */
function overdriveTick(state: WorldState, player: Entity): void {
  const slots = state.catalystSlots;
  const silence = readCatalystSlot(slots, OverdriveSlot.SilenceTicks);
  if (silence > 0) {
    writeCatalystSlot(slots, OverdriveSlot.SilenceTicks, silence - 1);
    player.cooldown = 2 * FIRE_CD_Q;
    return;
  }
  // 냉각은 침묵 중에는 돌지 않는다 — 침묵에 들어가는 순간 열을 0 으로 되돌렸으므로 식힐
  // 것이 없고, 여기서 또 깎으면 슬롯이 0 인 채로 매 틱 쓰기가 나간다.
  if (state.tick % OVERDRIVE_COOL_PERIOD !== 0) return;
  const heat = readCatalystSlot(slots, OverdriveSlot.Heat);
  if (heat > 0) writeCatalystSlot(slots, OverdriveSlot.Heat, heat - 1);
}

/**
 * `id 26` — 같은 방향 유지 카운터.
 *
 * ## ⚠️ 판정은 **입력**이지 속도가 아니다
 * 카탈로그가 못 박은 규율이다(감속 장판·이속 모듈 때문에 속도는 신뢰 불가 — 아크캐스터
 * 시그니처 선례). 그런데 촉매의 매-틱 앵커는 **`input` 을 받지 않는다** — `skillHooks.ts`
 * 의 `onSignatureStep` 이 *"촉매 48종 중 입력을 읽는 카드가 없다"* 는 (이 카드가 생기기 전의)
 * 판단으로 인자에서 뺐다. **설계 정본 ↔ 코드 어긋남으로 보고했다.**
 *
 * 그 사이를 메우는 것이 아래 한 줄의 근거다: `stepPlayer` 는
 * `vx = mx * playerSpeed * slowMult * moduleSlow * move.speedMult` 로 속도를 만든다 —
 * 오른쪽 배율 넷이 전부 **음이 아닌 스칼라**이므로 `(vx, vy)` 의 **방향은 입력 `(mx, my)` 의
 * 방향과 항상 같다.** 즉 크기는 감속에 흔들려도 {@link dirCode} 가 뽑는 값은 안 흔들린다.
 * 이 함수가 크기를 한 번도 안 보는 것이 "입력으로 판정한다"의 코드적 표현이다.
 *
 * (남는 틈 하나: 정지 상태에서 대시한 틱은 대시 임펄스가 조준각 방향으로 실려 그 한 틱만
 * 방향이 잡힌다. 다음 틱에 0 으로 돌아가므로 카운터가 쌓이지 않는다.)
 */
function rapidcoreTick(state: WorldState, player: Entity): void {
  const slots = state.catalystSlots;
  const code = dirCode(player.vx, player.vy);
  const held = readCatalystSlot(slots, RapidcoreSlot.HeldDir);
  if (code === 0 || code !== held) {
    writeCatalystSlot(slots, RapidcoreSlot.HeldDir, code);
    writeCatalystSlot(slots, RapidcoreSlot.HeldTicks, 0);
    return;
  }
  const ticks = readCatalystSlot(slots, RapidcoreSlot.HeldTicks);
  if (ticks >= RAPIDCORE_MAX_TICKS) {
    // 상한에 닿은 뒤로는 쓰기가 없다 — 슬롯이 단조 증가하지 않는다(헌장 §틱 규율).
    // 최대 배속에 **처음** 닿은 틱에만 한 번 통지한다(매 틱 통지 금지 · 상한 64/틱).
    return;
  }
  const next = ticks + 1;
  writeCatalystSlot(slots, RapidcoreSlot.HeldTicks, next);
  if (next === RAPIDCORE_MAX_TICKS) {
    notifyCatalystFx(state, CARD_RAPIDCORE, CATALYST_FX.trigger, player.x, player.y);
  }
}

/**
 * `id 27` — **대기 전리품을 낳는 자리**. 처치를 관측한 앵커(`onEnemyDamagedCatalyst`)는
 * `for (const b of state.entities)` 순회 안이라 훅에서 스폰이 금지돼 있고, 이 함수는 순회
 * 밖이다(`stepShipSignature` 진입점).
 *
 * 시드는 `mix32` **순수 파생**이라 `dropRng` 를 한 칸도 안 민다(공통 계약 ①). 좌표는 시체가
 * 아니라 플레이어다 — 낳는 시점이 처치보다 한 틱 뒤라 시체 좌표는 이미 배열 밖이고, 카드의
 * 신호도 *"관통 처치 시 …전리품이 튄다"* 라 기체 주변이 맞다.
 */
function afterburnerTick(state: WorldState, player: Entity): void {
  const { cut, pending } = readAfterburnerLedger(state);
  if (pending === 0) return;
  for (let i = 0; i < pending; i++) {
    const seed = mix32(state.tick * AFTERBURNER_PENDING_MAX + i, AFTERBURNER_LOOT_SALT);
    spawnLoot(state, player.x, player.y, seed, AFTERBURNER_LOOT_RARITY);
  }
  writeAfterburnerLedger(state, cut, 0);
}

/**
 * `id 28` — 방벽 잔여 시계. 소멸 판정 자체는 {@link powerOnCatalystHazards} 가 한다(그 자리가
 * 탄 이동 **뒤** · 명중 판정 **앞**이라 방벽이 실제로 막을 수 있는 유일한 지점이다).
 */
function bulwarkTick(state: WorldState): void {
  const slots = state.catalystSlots;
  const t = readCatalystSlot(slots, BulwarkSlot.Ticks);
  if (t === 0) return;
  writeCatalystSlot(slots, BulwarkSlot.Ticks, t - 1);
  if (t - 1 === 0) writeCatalystSlot(slots, BulwarkSlot.Dir, 0);
}

// ---------------------------------------------------------------------------
// 앵커 팬아웃 진입점 — **카드 레인은 `catalystHooks.ts` 를 한 줄도 고치지 않는다**
// ---------------------------------------------------------------------------
//
// `catalystHooks.ts` 의 앵커 하나하나가 13개 그룹 모듈 전부에 **고정 순서로** 위임한다. 그래서
// 카드 레인은 자기 그룹 파일의 함수 본체만 채우면 되고, 디스패처는 손대지 않는다 — 이것이
// 병렬 레인의 마지막 충돌 지점을 없앤다.
//
// ## ⚠️ 반환값이 있는 앵커의 **합성 규칙**(디스패처가 진다)
//  - 배율형(`DamageChain`·`EnemyStep`·`LootRoll`) — 그룹 순서대로 **곱해서 누적**한다.
//    중립은 `1`(전리품은 {@link CATALYST_LOOT_NEUTRAL}). 새 객체를 만들지 말고 그대로 돌려라.
//  - 억제형(`BossDeath`·`LootCollected`·`DestructibleDestroyed`) — **하나라도 `true` 면 억제**.
//
// ## ⚠️ 핫 경로 — 첫 줄은 반드시 **값싼 조기 반환**
// `EnemyDamaged`·`EnemyStep`·`EnemyContact` 는 적마다 매 틱 돈다(× 13 그룹).

/**
 * {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 power 몫 — `id 25` **열 누적**.
 *
 * ## ⚠️ 여기서 피해를 올리지 않는 이유 (실측)
 * 이 앵커는 무기 아키타입 분기보다 **앞**이라 탄이 아직 없고 `wDamage` 는 호출부 지역 변수다
 * (`catalystHooks.ts` 의 이 앵커 주석이 그 벽을 적어 뒀다). 그래서 피해 상승은
 * {@link powerOnEnemyDamaged} 에서 **명중마다 추가 피해**로 얹는다 — 그 지점은 아군탄 명중
 * 경로 전용이라 "총열이 뜨겁다"의 대상(주무기 탄)과 정확히 같은 집합을 덮는다.
 *
 * ⚠️ **단위 주의** — 발사 간격은 틱이 아니라 1/{@link FIRE_CD_Q} 틱이다. 열은 **볼리 횟수**
 * 라는 무차원 눈금이고 그 단위와 섞지 않는다(이 함수가 `player.cooldown` 을 한 번도 안 읽는다).
 */
export function powerOnVolleyFired(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_OVERDRIVE)) return;
  const slots = state.catalystSlots;
  if (readCatalystSlot(slots, OverdriveSlot.SilenceTicks) > 0) return;
  const heat = readCatalystSlot(slots, OverdriveSlot.Heat) + 1;
  if (heat < OVERDRIVE_HEAT_MAX) {
    writeCatalystSlot(slots, OverdriveSlot.Heat, heat);
    return;
  }
  // 임계 초과 — 열을 0 으로 되돌리고 3초 침묵. **되돌릴 수 있는 대가다**(스스로 풀린다).
  writeCatalystSlot(slots, OverdriveSlot.Heat, 0);
  writeCatalystSlot(slots, OverdriveSlot.SilenceTicks, OVERDRIVE_SILENCE_TICKS);
  notifyCatalystFx(state, CARD_OVERDRIVE, CATALYST_FX.selfHarm, player.x, player.y);
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 power 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function powerOnEnemyDamageTakenMult(
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

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 power 몫. **미배선**(위 §주석). */
export function powerOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/**
 * {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 power 몫 —
 * **`id 25 overdrive`: 총열이 뜨거울수록 주무기가 세진다.** ·
 * **`id 26 rapidcore`: 같은 방향을 오래 유지할수록 주무기가 세진다.**
 *
 * ## ⚠️ 둘의 배율은 **한 번에 더해서 한 번 반올림**한다
 * `bonus` 를 합산한 뒤 `round` 를 한 번만 돈다. 카드마다 따로 `round` 를 돌리면 낮은 피해
 * 구간에서 두 번의 절삭이 겹쳐 곡선이 갈린다(옛 명중 앵커가 둘을 `bonus +=` 로 합산해
 * 한 번만 반올림했던 것과 같은 식이다 — 그 곡선을 그대로 옮긴다).
 *
 * ## 이 카드의 세 조각이 여기서 한 곡선으로 이어진다
 * ```
 *  열 누적   → powerOnVolleyFired  (볼리마다 +1, 임계에서 0 으로 리셋 + 침묵)
 *  피해 상승 → 여기                (열 비율만큼 주무기 피해가 오른다)
 *  임계 침묵 → powerOnTick         (침묵 틱 동안 쿨다운을 밀어 발사가 멎는다)
 * ```
 * 셋이 **같은 슬롯 하나**(`OverdriveSlot.Heat`)를 읽으므로 곡선이 갈릴 수 없다.
 *
 * ## ⚠️ 이 앵커는 `onVolleyFired` **뒤**다 — 그래서 이번 발의 열이 이미 반영돼 있다
 * 호출 순서는 `onVolleyFired`(앵커 ①) → 볼리 레코드 조립 → 이 앵커다. 즉 이번 볼리가 올린
 * 열 1 이 이미 들어간 값으로 배율이 잡힌다. **임계를 넘긴 볼리는 배율이 0 이다** — 그 틱에
 * `powerOnVolleyFired` 가 열을 0 으로 되돌리고 침묵을 세우기 때문이고, 이것이 *"임계를 넘기면
 * 침묵한다"* 의 대가가 발사 자체에도 즉시 걸린다는 뜻이라 규칙과 어긋나지 않는다.
 *
 * ## ⚠️ `+=` 이지 `*=` 가 아니다 — 옮기기 전 곡선을 보존한다
 * 종전 자리({@link powerOnEnemyDamaged})가 `dmg + round(dmg × bonus)` 였으므로 같은 식을 쓴다.
 * `damage *= (1 + bonus)` 로 바꾸면 반올림 지점이 달라져 낮은 피해 구간에서 값이 갈린다.
 *
 * ⚠️ **RNG 미소비** — 배율은 슬롯 하나의 순수 파생이다.
 */
export function powerOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void player;
  let bonus = 0;
  if (carries(state, CARD_OVERDRIVE)) bonus += overdriveBonus(state);
  if (carries(state, CARD_RAPIDCORE)) bonus += rapidcoreBonus(state);
  if (bonus <= 0) return;
  // `damage` 는 **전 아키타입이 읽는** 칸이라(빔조차 읽는다) 어느 무기에서도 안 샌다.
  volley.damage += Math.round(volley.damage * bonus);
}

/**
 * {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 power 몫 —
 * `id 27`(쿨다운 소거 + 최대 HP 대가) · `id 29`(대시 무적 2배).
 *
 * ⚠️ 이 앵커는 `dashCooldown`·`iframes` **대입 뒤**라 여기서 쓴 값이 그대로 남는다
 * (`catalystHooks.ts:170` 실측). `min`/`clamp` 가 없어 개입이 삼켜지지 않는다.
 */
export function powerOnDashFired(state: WorldState, player: Entity): void {
  if (carries(state, CARD_ASCENDANT)) {
    player.iframes *= 2;
  }
  if (!carries(state, CARD_AFTERBURNER)) return;
  player.dashCooldown = 0;
  // 새 대시 = 새 창. 지난 대시의 관통 표식을 지운다 — 안 지우면 오래전에 스친 적을 나중에
  // 잡아도 되돌림이 나가 "대시로 죽였다" 가 아니게 된다(`catalystMarks.pierced` doc).
  for (const e of state.entities) {
    if (e.kind !== 'enemy') continue;
    if (readMark(e, 'pierced') !== 0) writeMark(e, 'pierced', 0);
  }
  const { cut, pending } = readAfterburnerLedger(state);
  // 하한 1 — 헤더 §공유 필드 규칙 3.
  const step = Math.min(AFTERBURNER_HP_STEP, player.maxHp - 1);
  if (step <= 0) return;
  player.maxHp -= step;
  if (player.hp > player.maxHp) player.hp = player.maxHp;
  writeAfterburnerLedger(state, cut + step, pending);
  notifyCatalystFx(state, CARD_AFTERBURNER, CATALYST_FX.selfHarm, player.x, player.y);
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/**
 * {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 power 몫 —
 * `id 26`(유지 초기화) · `id 28`(방벽 전개).
 *
 * ## `id 28` — 방향 기준은 **위협이 온 쪽**이다
 * 카탈로그 3판은 기준이 **기체 진행 방향**이었고, 뱀서라이크의 기본 운용인 카이팅(적에게서
 * 멀어지며 뒤로 쏘기)에서 방벽이 빈 공간을 향하고 총구는 뒤를 향해 **이득과 대가가 동시에
 * 증발**했다. 그래서 피격 순간 가장 가까운 위협(적탄 우선, 없으면 적)의 방위로 고정하고
 * 3초간 안 바꾼다.
 *
 * ⚠️ **`iframes` 를 쓰지 않는다.** `iframes` 는 적탄만이 아니라 접촉 피해까지 전부 막아
 * `id 1`(접촉 강탈)의 대가를 소거하고 `id 29` 와 결합해 3초짜리 학살 필드를 만든다
 * (헌장 §공유 필드 시험). 접촉 피해는 **그대로 들어온다** — 그것이 설계된 대가다.
 */
export function powerOnPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
): void {
  void dmg;
  void lethalSurvived;
  // 피해원을 가리지 않는다 — 두 카드 다 규칙이 "피격당하면" 이라 접촉·적탄·해저드를 구분하지
  // 않는다(구분하는 카드가 이 앵커에 붙으면 그때 `hasDamageSource` 로 게이트해라).
  void sources;
  if (carries(state, CARD_RAPIDCORE)) {
    const slots = state.catalystSlots;
    if (readCatalystSlot(slots, RapidcoreSlot.HeldTicks) > 0) {
      notifyCatalystFx(state, CARD_RAPIDCORE, CATALYST_FX.selfHarm, player.x, player.y);
    }
    writeCatalystSlot(slots, RapidcoreSlot.HeldDir, 0);
    writeCatalystSlot(slots, RapidcoreSlot.HeldTicks, 0);
  }
  if (!carries(state, CARD_BULWARK)) return;
  const code = threatDirCode(state, player);
  // 위협을 못 찾으면 방벽도 안 선다 — 이득 없는 대가(전방 사격 차단)만 물리지 않는다.
  if (code === 0) return;
  const slots = state.catalystSlots;
  writeCatalystSlot(slots, BulwarkSlot.Ticks, BULWARK_TICKS);
  writeCatalystSlot(slots, BulwarkSlot.Dir, code);
  notifyCatalystFx(state, CARD_BULWARK, CATALYST_FX.trigger, player.x, player.y);
}

/**
 * 피격 순간의 **위협 방위**. 적탄을 먼저 찾고 없으면 적·보스를 본다 — 방벽이 막는 것이
 * 적탄이므로 적탄이 있으면 그쪽이 곧 위협이다.
 *
 * RNG 미소비 · 상태 쓰기 0. 동률은 `state.entities` 순회에서 **먼저 만난 쪽**이라 결정론적이다.
 */
function threatDirCode(state: WorldState, player: Entity): number {
  let best: Entity | undefined;
  let bestD2 = 0;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemyBullet') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (best === undefined || d2 < bestD2) {
      best = e;
      bestD2 = d2;
    }
  }
  if (best === undefined) {
    for (const e of state.entities) {
      if (e.dead || (e.kind !== 'enemy' && e.kind !== 'boss')) continue;
      if (isCatalystShadow(e)) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (best === undefined || d2 < bestD2) {
        best = e;
        bestD2 = d2;
      }
    }
  }
  if (best === undefined) return 0;
  return dirCode(best.x - player.x, best.y - player.y);
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnBulletExpired(
  state: WorldState,
  bullet: Entity,
  reason: BulletExpiryReason,
): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 power 몫. **쓸 카드 0종** —
 * 이 그룹에는 *받는* 피해의 성질을 바꾸는 카드가 없다(`id 29` 는 상한을 깎을 뿐 감쇠가 아니다).
 */
export function powerOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 power 몫 —
 * `id 27` 의 **관통 처치 되돌림**.
 *
 * ## ⚠️ `id 25 overdrive`·`id 26 rapidcore` 는 **여기서 나갔다** — 볼리 앵커가 정본이다
 * 종전에는 이 함수가 `id 25`·`id 26` **둘 다**의 피해 상승을 사후 추가 피해로 얹었다. 사유는
 * *"볼리 파라미터 레코드는 스킬 전용 앵커라 촉매 팬아웃이 없다"* 였고 그때는 사실이었다.
 * **이제 아니다** — {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 가 생겨
 * `id 25` 는 {@link powerOnVolleyParams} 로 옮겼다.
 *
 * 옮긴 이유는 자리가 생겨서가 아니라 **의미가 달랐기** 때문이다. 이 앵커는 호출부가 격추 판정을
 * 끝낸 **`dead` 가 이미 선 뒤**라, 여기서 얹는 추가 피해는 실제 무기 강화와 두 곳에서 갈린다:
 *  - **관통** — 한 탄이 두 번째·세 번째 적을 때릴 때 무기 피해는 그대로 실리지만, 이 앵커의
 *    보너스는 명중마다 따로 계산돼 곡선이 다르다.
 *  - **과잉피해** — 이미 죽은 적에게 추가 피해가 들어가 그만큼 버려진다. 무기가 세진 것이라면
 *    그 초과분은 애초에 발생하지 않는다.
 * `id 25` 의 규칙은 *"총열이 뜨거울수록 강해진다"* = **무기 강화**라 볼리 앵커가 맞다.
 *
 * ## ✅ `id 26 rapidcore` 도 뒤따라 옮겼다 (2026-08-08 판정)
 * 규칙 문장이 *"같은 방향으로 계속 이동할수록 **공격력이 오른다**(최대 2배)"* 라 `id 25` 와
 * 같은 **무기 강화**다(*"명중 시 추가타"* 가 아니다). 구조도 완전히 같은 형태라 여기 남으면
 * 위 두 왜곡(관통 곡선·과잉피해)을 그대로 받는다 → {@link powerOnVolleyParams} 로 옮겼다.
 * 피격 초기화는 {@link powerOnPlayerDamaged} 몫이라 그대로다(슬롯 하나를 공유한다).
 *
 * ⚠️ 그래서 이 앵커는 이제 **hp 를 한 칸도 안 건드린다** — 남은 몫(`id 27`)은 이미 죽은 적을
 * 읽어 최대 HP 를 되돌릴 뿐이다. 여기에 피해를 다시 얹으려면 `dead` 를 직접 세워야 하고
 * (호출부가 격추 판정을 이 훅 **앞**에서 끝낸다) 위 두 왜곡을 도로 들여오는 것이므로 하지 마라.
 */
export function powerOnEnemyDamaged(
  state: WorldState,
  target: Entity,
  dmg: number,
  source: Entity | undefined,
): void {
  if (target.kind !== 'enemy' && target.kind !== 'boss') return;
  // `id 36` 그림자는 죽일 수 없다 — 조준 제외와 쌍이다(`catalyst/shared.ts`).
  if (isCatalystShadow(target)) return;
  void dmg;
  void source;
  if (!carries(state, CARD_AFTERBURNER)) return;
  if (target.kind !== 'enemy' || target.hp > 0) return;
  if (readMark(target, 'pierced') === 0) return;
  // **되돌림** — 이번 대시에 관통한 적이 실제로 죽었다. 표식을 먼저 지워 같은 시체가 두 번
  // 갚는 경로를 닫는다(관통 예산이 남은 탄은 같은 틱에 다시 이 앵커에 올 수 있다).
  writeMark(target, 'pierced', 0);
  const { cut, pending } = readAfterburnerLedger(state);
  const give = Math.min(AFTERBURNER_HP_STEP, cut);
  if (give > 0) addPlayerMaxHp(state, give);
  writeAfterburnerLedger(state, cut - give, pending + 1);
  creditCatalyst(state, CARD_AFTERBURNER, give);
  if (give === 0) missCatalyst(state, CARD_AFTERBURNER, AFTERBURNER_HP_STEP);
  notifyCatalystFx(state, CARD_AFTERBURNER, CATALYST_FX.credit, target.x, target.y);
}

/**
 * 최대 HP 를 **더한다**(헤더 §공유 필드 규칙 1 — 절대값 대입 금지). 현재 hp 는 안 올린다:
 * 상한 회복은 회복이 아니다(규칙 5).
 */
function addPlayerMaxHp(state: WorldState, amount: number): void {
  const p = playerOf(state);
  if (p === undefined) return;
  p.maxHp += amount;
}

/** {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 power 몫. **쓸 카드 0종** —
 * 이 그룹의 처치 조항은 전부 **개체 표식**을 읽어야 하는데 이 앵커는 좌표만 준다. 자리는
 * {@link powerOnEnemyDamaged}(개체가 있다)와 {@link powerOnLootRoll}(순회 안이라 시체를
 * 되찾을 수 있다)로 갈렸다. */
export function powerOnEnemyDeath(
  state: WorldState,
  x: number,
  y: number,
  elite: boolean,
): void {
  void state;
  void x;
  void y;
  void elite;
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnPowerupPicked(
  state: WorldState,
  poolIndex: number,
  offeredIndex: number,
): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/**
 * {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 power 몫 —
 * `id 27`(관통 표식) · `id 29`(이동 불능).
 *
 * ## ⚠️ 대시는 피해를 주지 않는다
 * 사용자 판정(2026-08-08 · ADR-0021 개정문 *"조작 코어는 여전히 불변"*). 이 함수는
 * `target.hp` 를 한 번도 안 만진다 — *"대시로 관통해 죽인다"* 는 **"통과한 적이 그 대시 중
 * 죽으면"** 으로 읽고, 죽음의 관측은 {@link powerOnEnemyDamaged} 가 한다.
 *
 * ## ⚠️ `id 29` 의 "대시 무적 중" 은 **호출 지점이 보증한다**
 * 이 앵커는 `world.ts` 의 `if (dashedThisTick)` 블록에서만 불린다 — 즉 평범한 피격 무적
 * (0.67초)에는 **구조적으로 도달하지 않는다.** 2판이 만든 3초짜리 학살 필드가 되살아나지
 * 않는 것은 그 구조 때문이고, 아래 `iframes > 0` 는 그 사실을 코드로 한 번 더 못 박은 것이다
 * (대시는 항상 `iframes` 를 세운다).
 *
 * ## ⚠️ 표식·정지는 **잡몹에만**
 * `aux0` 는 kind 마다 뜻이 다르고 보스는 추격 모드 취약화 플래그가 쓴다(`catalystMarks.ts`).
 * `applyStasis` 도 `enemy` 의 `life` writer 가 0건이라는 실측 위에 서 있다.
 */
export function powerOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  if (target.kind !== 'enemy' || target.dead) return;
  if (isCatalystShadow(target)) return;
  if (carries(state, CARD_AFTERBURNER)) {
    writeMark(target, 'pierced', 1);
  }
  if (!carries(state, CARD_ASCENDANT)) return;
  if (player.iframes <= 0) return;
  // 이동 불능은 `applyStasis` 로만 표현한다 — 속도를 직접 0 으로 만들면 신규 칸/임의 배율이
  // 생겨 훅 등급이 §A 를 벗어난다(카탈로그 §훅의 6판 재등급 근거).
  applyStasis(target, ASCENDANT_ROOT_TICKS);
  writeMark(target, 'rooted', 1);
  notifyCatalystFx(state, CARD_ASCENDANT, CATALYST_FX.trigger, target.x, target.y);
}

/**
 * {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 power 몫 —
 * `id 25` 의 *"백열 상태에서 죽인 적은 자원 두 배"*.
 *
 * 자원이 실제로 적립되는 지점은 보급 습격 격추 하나뿐이므로(`onResourceGranted` 계약) 그
 * 지점에 붙인다. 조건 미달분은 {@link missCatalyst} 로 적어 **놓친 액수가 화면에 보인다**
 * (헌장 §가시성 — *"놓친 액수가 보여야 다음 판에 조건을 추구한다"*).
 *
 * ⚠️ 이 호출은 `for (const e of state.entities)` 순회 안이다 — 스폰하지 않는다(가산만).
 */
export function powerOnResourceGranted(
  state: WorldState,
  amount: number,
  x: number,
  y: number,
): void {
  if (!carries(state, CARD_OVERDRIVE)) return;
  const heat = readCatalystSlot(state.catalystSlots, OverdriveSlot.Heat);
  if (heat < OVERDRIVE_WHITEHEAT) {
    missCatalyst(state, CARD_OVERDRIVE, amount);
    notifyCatalystFx(state, CARD_OVERDRIVE, CATALYST_FX.miss, x, y);
    return;
  }
  state.resources += amount;
  creditCatalyst(state, CARD_OVERDRIVE, amount);
  notifyCatalystFx(state, CARD_OVERDRIVE, CATALYST_FX.credit, x, y);
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 power 몫 —
 * `id 29`(*"이동 불능 상태에서 죽인 적은 전리품 두 배"*) · `id 27`(관통 처치 가산).
 *
 * ## ⚠️ RNG 재롤 금지
 * 이 앵커는 **이미 뽑힌 결과에 곱하는 자리**다. 이 함수는 난수를 한 칸도 굴리지 않고 배율만
 * 돌려준다 — 그래서 같은 시드의 드랍·웨이브 스트림이 촉매 유무와 무관하게 같다.
 *
 * ## 왜 시체를 되찾을 수 있는가
 * {@link deadEnemyAt} 주석 참조(호출 지점이 `compact()` 순회 **안**이고 좌표가 그 개체에서
 * 그대로 넘어온 값이라 등가 비교가 성립한다).
 */
export function powerOnLootRoll(
  state: WorldState,
  x: number,
  y: number,
  elite: boolean,
): CatalystLootRoll {
  void elite;
  const asc = carries(state, CARD_ASCENDANT);
  const aft = carries(state, CARD_AFTERBURNER);
  if (!asc && !aft) return CATALYST_LOOT_NEUTRAL;
  const victim = deadEnemyAt(state, x, y);
  if (victim === undefined) return CATALYST_LOOT_NEUTRAL;
  let count = 1;
  if (asc && readMark(victim, 'rooted') !== 0) count *= 2;
  if (aft && readMark(victim, 'pierced') !== 0) count *= 2;
  if (count === 1) return CATALYST_LOOT_NEUTRAL;
  notifyCatalystFx(state, asc ? CARD_ASCENDANT : CARD_AFTERBURNER, CATALYST_FX.credit, x, y);
  return { rarity: 1, count };
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/** {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnWaveAdvanced(
  state: WorldState,
  prevSegment: number,
  nextSegment: number,
): void {
  void state;
  void prevSegment;
  void nextSegment;
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 power 몫. **쓸 카드 0종** —
 * `id 28` 은 접촉을 **막지 않는다**(그것이 설계된 대가다. `iframes` 금지 사유와 한 쌍이다). */
export function powerOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 power 몫. **쓸 카드 0종** —
 * `id 29` 의 이동 불능은 `applyStasis` 가 세운 `life` 를 `enemyStatusStopMult` 가 배율 0 으로
 * 접어 이미 호출부에서 반영된다. 여기서 또 0 을 곱하면 정본이 둘이 된다. */
export function powerOnEnemyStep(state: WorldState, e: Entity): number {
  void state;
  void e;
  return 1;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 power 몫. **쓸 카드 0종**. */
export function powerOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/**
 * {@link import('../catalystHooks.js').stepCatalystHazards} 의 power 몫 — `id 28` **방벽의 집행**.
 *
 * ## 왜 하필 이 자리인가 (실측)
 * 이 앵커는 `resolveCollisions` 의 격자 삽입 **직후**다 — 즉 `stepProjectiles` 가 이번 틱
 * 이동을 끝냈고(탄이 제자리에 있다) 아직 **아무 명중도 판정되지 않았다**. 방벽이 "날아오는
 * 탄을 부순다"를 실제로 할 수 있는 per-tick 지점은 여기 하나뿐이다. 매-틱 앵커
 * ({@link powerOnTick})는 `stepProjectiles` **앞**이라 거기서 지우면 그 뒤에 날아 들어온 탄이
 * 같은 틱에 기체를 때린다.
 *
 * ## 이득과 대가가 **같은 루프**다
 * 부채꼴 안에서 부서지는 것은 적탄(이득)만이 아니라 **아군탄**(대가)도다. 한 술어·한 반경이
 * 둘을 같이 정하므로 3판처럼 "이득만 남고 대가가 증발"하는 형태가 구조적으로 안 생긴다.
 *
 * ⚠️ 접촉 피해는 **하나도 안 막는다**(`iframes` 미사용). 카드의 *"약해지는 상황"* 이 그것이다.
 */
export function powerOnCatalystHazards(state: WorldState): void {
  if (!carries(state, CARD_BULWARK)) return;
  const slots = state.catalystSlots;
  if (readCatalystSlot(slots, BulwarkSlot.Ticks) === 0) return;
  const code = readCatalystSlot(slots, BulwarkSlot.Dir);
  if (code === 0) return;
  const player = playerOf(state);
  if (player === undefined) return;
  const dir = dirVector(code);
  const r2 = BULWARK_RADIUS * BULWARK_RADIUS;
  let blocked = 0;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind !== 'enemyBullet' && e.kind !== 'bullet') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2 || d2 === 0) continue;
    // 내적 판정 — 반각 60°(`cos 60° = 0.5`). `Math.sqrt` 한 번은 탄마다지만 반경 게이트를
    // 먼저 통과한 것만 남으므로 부채꼴 안 후보에만 든다.
    const d = Math.sqrt(d2);
    if ((dx * dir.x + dy * dir.y) / d < BULWARK_COS_HALF) continue;
    e.dead = true;
    if (e.kind === 'enemyBullet') blocked++;
  }
  if (blocked === 0) return;
  // *"방벽이 부순 탄 수에 비례해 적립"* — 탄 하나가 자원 하나다.
  state.resources += blocked;
  creditCatalyst(state, CARD_BULWARK, blocked);
  // 틱당 **한 번만** 통지한다(상한 64/틱 · 헌장 §매 틱 통지 금지).
  notifyCatalystFx(state, CARD_BULWARK, CATALYST_FX.credit, player.x, player.y);
}
