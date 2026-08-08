/**
 * 촉매 **카르곤 특산**(id 30~32) — `kargon-swarmcall` · `kargon-magma-vein` · `kargon-lava-warden`.
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
 * ## 이 그룹이 쓰는 상태 — **슬롯 한 칸뿐**
 * `MagmaVeinSlot.LastCell`(15) 하나다. `id 30` 의 누진 단계는 `segmentIndex` 의 **순수 파생**,
 * `id 32` 의 갑주는 **거리 판정**이라 둘 다 저장할 것이 없다(`catalystSlots.ts` §"틱의 순수
 * 파생은 슬롯이 아니다" 가 `id 30` 을 이름으로 지목한다).
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { DamageSourceMask } from '../skillSlots.js';
import { DamageSource, hasDamageSource } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { CATALYST_LOOT_NEUTRAL } from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import {
  carries,
  spawnCatalystHazard,
  isCatalystHazardMarked,
  catalystHazardDamaging,
} from './shared.js';
import { readCatalystSlot, writeCatalystSlot, MagmaVeinSlot } from '../catalystSlots.js';
import { circlesOverlap } from '../collision.js';
import { notifyCatalystFx, CATALYST_FX } from './fx.js';
import { SEGMENTS } from '../../../data/waves.js';

/** id 30 — slug `kargon-swarmcall`. 정본은 `src/data/catalysts.ts`. */
export const CARD_KARGON_SWARMCALL = 30;

/** id 31 — slug `kargon-magma-vein`. 정본은 `src/data/catalysts.ts`. */
export const CARD_KARGON_MAGMA_VEIN = 31;

/** id 32 — slug `kargon-lava-warden`. 정본은 `src/data/catalysts.ts`. */
export const CARD_KARGON_LAVA_WARDEN = 32;

// ---------------------------------------------------------------------------
// 해저드 판별 마커 — 이 그룹이 낳은 장판을 다른 카드 것과 가른다
// ---------------------------------------------------------------------------

/** `id 31` 용암(`hazard.ownerId`). 공용 장판(`id 2`·`id 8`)도 피해 > 0 이라 값으로는 못 가른다. */
export const MAGMA_LAVA_MARK = 0xc0de31;

/** `id 32` 보스 접촉 피해권(`hazard.ownerId`). */
export const WARDEN_AURA_MARK = 0xc0de32;

// ---------------------------------------------------------------------------
// id 30 kargon-swarmcall — 처치 할당 절반 · 대신 다음 세그먼트가 누진해서 빽빽해진다
// ---------------------------------------------------------------------------
//
// ## 이득과 대가가 **같은 원인**에서 나온다
// 원인은 하나다 — *"웨이브를 몇 개 넘겼는가"*(`segmentIndex`). 그것이 ①처치 할당을 절반으로
// 낮추고(이득) ②다음 세그먼트의 적 상한을 누진해 올리며(대가) ③그 세그먼트의 전리품을 더
// 뱉게 한다(경제). 빨리 넘길수록 다음이 두꺼워지므로 **자기 강함이 자기 무덤이 된다.**
//
// ## ⚠️ 2판의 대가는 **코드상 no-op 이었다**
// 2판 규칙문은 *"웨이브를 넘겨도 적이 안 정리된다"* 였는데, 세그먼트 전진 블록(`waves.ts`)에는
// 적을 정리하는 코드가 **아예 없고** 카르곤(vampire)은 강제 스크롤이 아니라 `cullScrollEnemies`
// 도 안 돈다. 즉 그것은 이미 현행 거동이라 "처치 할당 절반"만 남는 **순수 버프**였다. 3판이
// 대가를 `seg.maxEnemies` 누진으로 바꾼 것이 그 고침이고, 그래서 이 파일의 테스트는
// **"대가가 실제로 관측되는가"** 를 단언한다.
//
// ## 훅 등급 §A — 새 상태 0
// 손잡이 둘 다 `waves.ts` **기존 노브**다: `state.wave.segmentKillGoal`(전진 게이트가 읽는다)과
// `state.catalystMods.enemyCount`(`waves.ts:344` 의 `maxEnemies` 에 곱한다 — `catalystMods.ts`
// 헤더가 *"`id 30` 세그먼트 적 상한 누진"* 을 이 축의 소비자로 이름까지 적어 뒀다).
// 누진 단계는 `segmentIndex` 의 순수 파생이라 슬롯을 안 쓴다.

/** 처치 할당 배율. 규칙문의 "절반". */
const SWARM_KILL_GOAL_MULT = 0.5;

/** 누진 단계 하나마다 적 상한에 더해지는 몫. 세그먼트 6 에서 ×1.90 이 된다. */
const SWARM_DENSITY_STEP = 0.18;

/** 누진 단계 하나마다 전리품 개수에 더해지는 몫. */
const SWARM_LOOT_STEP = 0.16;

/**
 * 이 그룹이 전리품 **개수**에 걸 수 있는 총 상한 = 명세의 드랍 ×2.0.
 *
 * `id 30` 과 `id 31` 은 같은 행성이라 **한 런에 둘 다 실릴 수 있다**(특산은 런당 최대 2장).
 * 둘의 곱이 각자의 상한을 넘지 않도록 마지막에 한 번 자른다 — 헌장 §상한은 카드별 선언이지
 * 조합 뒤 값이 아니므로, 자르지 않으면 조합에서 선언이 무의미해진다.
 */
const KARGON_LOOT_COUNT_CAP = 2.0;

/**
 * 지금 세그먼트의 **누진 단계**. `segmentIndex` 의 순수 파생 — 저장하지 않는다.
 *
 * "넘긴 웨이브 수"가 곧 `segmentIndex` 다(0 에서 시작해 전진마다 +1). 보스 세그먼트까지
 * 포함해 단조 증가하고, 튜토리얼 단축판(`config.maxSegments`)의 인덱스 점프도 그대로 따른다.
 */
export function swarmcallStage(state: WorldState): number {
  if (!carries(state, CARD_KARGON_SWARMCALL)) return 0;
  return state.wave.segmentIndex;
}

function swarmcallOnTick(state: WorldState): void {
  if (!carries(state, CARD_KARGON_SWARMCALL)) return;
  const stage = state.wave.segmentIndex;

  // ── ① 처치 할당 절반 ─────────────────────────────────────────────────────
  // **매 틱 멱등 대입**이다(누적이 아니다 — 헌장 §틱 규율). 정본 표에서 다시 접으므로 여러 번
  // 불려도 같은 값이고, `onTickCatalyst` 가 `updateWaves` **앞**(`stepShipSignature` 안,
  // `world.ts:2001` vs `:2020`)이라 이번 틱의 전진 게이트가 이미 이 값을 본다.
  const seg = SEGMENTS[stage];
  if (seg !== undefined) {
    // `killGoal 0` 인 세그먼트(중반 격전·보스)는 처치 할당 게이트를 아예 안 타므로 건드리지
    // 않는다 — 0 에 배율을 걸면 "할당을 절반으로 줄였다"가 아니라 게이트의 뜻이 바뀐다.
    const halved = seg.killGoal > 0 ? Math.ceil(seg.killGoal * SWARM_KILL_GOAL_MULT) : seg.killGoal;
    if (state.wave.segmentKillGoal !== halved) state.wave.segmentKillGoal = halved;
  }

  // ── ② 누진한 적 상한(대가) ────────────────────────────────────────────────
  // `catalystMods` 는 읽기 전용이 아니다(조우 제단이 이미 런 중에 만진다). 필드 직접 대입이
  // 아니라 **번들 통째 교체**(스프레드)를 따른다 — `encounters/light.ts:406-412` 선례.
  // 값이 같으면 교체하지 않는다(매 틱 할당 방지).
  const density = 1 + stage * SWARM_DENSITY_STEP;
  if (state.catalystMods.enemyCount !== density) {
    state.catalystMods = { ...state.catalystMods, enemyCount: density };
  }
}

// ---------------------------------------------------------------------------
// id 31 kargon-magma-vein — 네가 쏜 탄이 지나간 자리에 용암이 솟는다
// ---------------------------------------------------------------------------
//
// ## ⚠️ 단발 해저드는 **한 번도 안 때린다** — 실측으로 잡힌 함정
// `stepHazards`(`world.ts:4143`)가 `life` 를 **먼저 깎고** 0 이면 그 자리에서 `dead` 를 세우는데,
// `stepCatalystHazards`(`:4207`)는 **같은 틱의 뒤**에서 돌면서 `dead` 를 거른다. 그래서
// `activeTicks = 1` 이면 피해 루프가 그 해저드를 한 번도 못 본다. → **최소 2**.
// 그리고 `stepCatalystHazards` 의 공용 피해 루프는 **`phase === 1`(지속형)만** 때린다
// (`h.phase !== 1` 이면 `continue`). 그래서 용암은 `continuous: true` 다 — 이 둘이 "실제로 적을
// 죽이는" 유일한 조합이고, 그래서 테스트가 스폰이 아니라 **처치**를 단언한다.
//
// ## 자기 피해는 배선이 이미 서 있다 — 우리가 더할 것은 **귀속**뿐
// `resolveCollisions`(`world.ts:4666`)의 `kind === 'hazard' && hazardActive(t)` 분기가 **모든**
// 활성 해저드를 플레이어 피해원으로 센다. 즉 용암은 스폰하는 순간 이미 플레이어를 태운다
// (무적 프레임·감쇠 사슬을 전부 거치는 정상 경로다). 남는 것은 헌장 §귀속 규율 3 —
// **촉매 자해는 적 피해와 다른 색·다른 사운드**라, {@link kargonOnPlayerDamaged} 가
// `CATALYST_FX.selfHarm` 으로 가른다.

/** 용암 좌표 격자의 한 칸 크기(월드 유닛). 탄마다 스폰하는 것을 막는 쿨다운의 단위다. */
const LAVA_CELL = 240;

/** 격자 셀 코드를 접는 폭(칸). 좌표는 무한 맵이라 이 폭으로 감아 슬롯 값이 커지지 않게 한다. */
const LAVA_CELL_WRAP = 4096;

/** 용암 반경. 탄 궤적 위의 "웅덩이" 하나 — 셀(240)보다 작아 궤적이 띠로 읽힌다. */
const LAVA_RADIUS = 110;

/** 용암이 피해를 주는 틱 수. ⚠️ **최소 2**(위 §함정). */
const LAVA_ACTIVE_TICKS = 150;

/** 용암의 **틱당** 피해. 지속 장판이라 "머무는 동안 매 틱 소량" — 적별 장부가 원리적으로 불필요하다. */
const LAVA_DAMAGE = 5;

/** 용암 위에서 죽은 적의 전리품 개수 배율. */
const LAVA_LOOT_MULT = 2.0;

/** 좌표를 격자 셀 코드로 접는다(순수 정수 — 부동소수 누적 없음). */
function lavaCellCode(x: number, y: number): number {
  const cx = ((Math.floor(x / LAVA_CELL) % LAVA_CELL_WRAP) + LAVA_CELL_WRAP) % LAVA_CELL_WRAP;
  const cy = ((Math.floor(y / LAVA_CELL) % LAVA_CELL_WRAP) + LAVA_CELL_WRAP) % LAVA_CELL_WRAP;
  return cx * LAVA_CELL_WRAP + cy;
}

/** 이 좌표가 **지금 피해를 주는 용암** 안인가. `id 31` 의 전리품 조건이자 자해 귀속 조건이다. */
export function onMagmaLava(state: WorldState, x: number, y: number): boolean {
  for (const h of state.entities) {
    if (h.dead || !isCatalystHazardMarked(h, MAGMA_LAVA_MARK)) continue;
    if (!catalystHazardDamaging(h)) continue;
    if (circlesOverlap(x, y, 0, h.x, h.y, h.radius)) return true;
  }
  return false;
}

function magmaVeinOnTick(state: WorldState): void {
  if (!carries(state, CARD_KARGON_MAGMA_VEIN)) return;

  // ── 궤적 위의 **한 셀**을 고른다 ────────────────────────────────────────────
  // 탄마다 스폰하면 해저드가 폭증하므로 **좌표 격자 단위 쿨다운**을 둔다: 마지막으로 용암을
  // 올린 셀을 슬롯에 기억하고 같은 셀에는 연속으로 안 올린다. 고르는 것은 엔티티 배열 순서상
  // **첫 아군탄**이라 순수 결정론이고, 틱당 최대 한 장이라 동시 상한 12 를 구조적으로 존중한다.
  // ⚠️ 여기서 스폰하지 않는다 — `for (const e of state.entities)` 순회 **안**이기 때문이다.
  const last = readCatalystSlot(state.catalystSlots, MagmaVeinSlot.LastCell);
  let spawnX = 0;
  let spawnY = 0;
  let cell = 0;
  for (const b of state.entities) {
    if (b.dead || b.kind !== 'bullet') continue;
    const code = lavaCellCode(b.x, b.y);
    if (code + 1 === last) continue; // 방금 올린 셀 — 쿨다운
    spawnX = b.x;
    spawnY = b.y;
    cell = code + 1;
    break;
  }
  if (cell === 0) return;

  // ── 순회 **밖**에서 낳는다 ────────────────────────────────────────────────
  // `spawnCatalystHazard` 은 RNG 를 한 칸도 안 쓴다 — 상한에 걸려 생략돼도 이후 시드 소비가
  // 밀리지 않는다(`PO8_LIVE_CAP` 선례의 핵심).
  const h = spawnCatalystHazard(
    state,
    spawnX,
    spawnY,
    LAVA_RADIUS,
    0,
    LAVA_ACTIVE_TICKS,
    LAVA_DAMAGE,
    true,
    MAGMA_LAVA_MARK,
  );
  if (h === undefined) return; // 동시 상한 — 쿨다운도 안 옮긴다(다음 틱에 다시 시도)
  writeCatalystSlot(state.catalystSlots, MagmaVeinSlot.LastCell, cell);
  notifyCatalystFx(state, CARD_KARGON_MAGMA_VEIN, CATALYST_FX.trigger, spawnX, spawnY);
}

// ---------------------------------------------------------------------------
// id 32 kargon-lava-warden — 붙을수록 갑주가 물러지고 멀어지면 굳는다
// ---------------------------------------------------------------------------
//
// ## 왜 **거리**인가 (2판 기각 사유)
// 2판은 *"같은 지점을 연속으로 맞히면 뚫린다"* 였는데 이 게임은 **전 자동 조준**이라 조준점이
// 플레이어의 손잡이가 아니다 — 실력이 아니라 **무기 타입 게이트**였고 확산형·다탄두는 갑주를
// 영영 못 뚫어 **보스를 못 죽이는 런**이 됐다(헌장 §페널티 금지 ④ 진행 교착). 거리는 플레이어가
// 100% 쥔 축이고 무기 타입과 무관하다.
//
// ## ⚠️ 보스 `aux0` 를 쓰지 않는다
// 그 칸은 **추격 모드 취약화 플래그**다(`world.ts:370`) — `catalystMarks` 표가 대상을
// `kind === 'enemy'` 뿐이라고 못 박은 이유가 그것이다. 이 카드는 **거리로만** 판정해 보스에
// 아무 상태도 안 남긴다(그래서 §A 이고 보스 부위 상태가 필요 없다).

/** 갑주가 완전히 굳는 거리. 이 밖에서는 감쇠가 하한값으로 고정된다. */
export const WARDEN_ARMOR_RADIUS = 900;

/**
 * 갑주 감쇠의 **하한** — 원거리 유지형이 받는 피해 배율.
 *
 * ## 0.35 의 근거 — **교착이 원리적으로 없다**는 것을 이 값이 진다
 * 헌장 §페널티 금지 ④ 는 "보스를 못 죽이는 런"을 금지한다. 하한이 0 이면 원거리 유지형은
 * 보스 HP 를 **영원히** 못 깎아 런이 승리도 패배도 아닌 상태로 멈춘다. 하한을 두면 최악의
 * 경우에도 보스전이 `1 / 0.35 ≈ 2.86` 배 길어질 뿐 **반드시 끝난다** — 명세의 *"원거리
 * 유지형은 보스전이 길어진다(단 뚫리기는 한다)"* 가 곧 이 숫자다.
 *
 * 0.35 를 고른 것은 두 경계 사이다: 0.5 면 대가가 체감되지 않아 "붙는다"는 조작이 안 생기고,
 * 0.2 면 2.86 배가 5 배가 되어 보스전만으로 런 길이가 갈린다(2분 런 전제가 무너진다).
 * TODO(밸런스): 출시 직전 `pnpm bench:curve` 로 확인.
 */
export const WARDEN_ARMOR_MIN_MULT = 0.35;

/** 접촉 피해권이 살아 있는 틱 수. 매 틱 갱신하므로 짧게 둔다(⚠️ 최소 2 — 위 §함정과 같은 사유). */
const WARDEN_AURA_TICKS = 3;

/**
 * `id 32` 갑주가 이번 명중에 거는 **피해 배율**. `world.ts` 의 아군탄 피해 산식이 부른다.
 *
 * ⚠️ 첫 줄이 `state.catalystOn` 이고 미소지는 **정확히 `1`** 을 돌려준다 — 곱셈이 무연산이라
 * 무촉매 런이 비트 동일이다.
 *
 * @param px 플레이어 x — "가까이 붙을수록" 의 기준점. 조준점이 아니라 **기체 위치**다.
 */
export function kargonLavaArmorMult(
  state: WorldState,
  target: Entity,
  px: number,
  py: number,
): number {
  if (!state.catalystOn) return 1;
  if (target.kind !== 'boss') return 1;
  if (!carries(state, CARD_KARGON_LAVA_WARDEN)) return 1;
  const dx = px - target.x;
  const dy = py - target.y;
  const d2 = dx * dx + dy * dy;
  const r = WARDEN_ARMOR_RADIUS;
  if (d2 >= r * r) return WARDEN_ARMOR_MIN_MULT;
  // 거리에 **선형**으로 녹는다 — 붙으면 1(갑주 없음), 반경 끝에서 하한. 명세의 *"거리에 따라
  // 균열 정도가 실시간으로 변한다"* 가 이 연속성이다(계단이면 화면이 그것을 못 보여준다).
  const d = Math.sqrt(d2);
  return WARDEN_ARMOR_MIN_MULT + (1 - WARDEN_ARMOR_MIN_MULT) * (1 - d / r);
}

function lavaWardenOnTick(state: WorldState): void {
  if (!carries(state, CARD_KARGON_LAVA_WARDEN)) return;

  // ── 갑주 반경 = 보스의 **접촉 피해권** ──────────────────────────────────────
  // 대가를 장판으로 세운다: 반경 안에 있으면(= 갑주가 물러진 그 자리) 보스의 접촉 피해를
  // 받는다. ⚠️ **`continuous: false`(phase 0)** 인 것이 핵심이다 —
  // `stepCatalystHazards` 의 공용 피해 루프는 `phase === 1` 만 때리므로 이 장판은 **적도 보스
  // 자신도 안 태우고**, `resolveCollisions` 의 해저드 분기(`hazardActive` 만 본다)를 통해
  // **플레이어에게만** 닿는다. phase 1 로 두면 장판 중심에 선 보스가 자기 장판에 갈린다.
  let boss: Entity | undefined;
  let aura: Entity | undefined;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind === 'boss') boss = e;
    else if (isCatalystHazardMarked(e, WARDEN_AURA_MARK)) aura = e;
  }
  if (boss === undefined) return;
  if (aura !== undefined) {
    // 매 틱 **갱신**이라 장판이 보스를 따라다닌다(스폰을 반복하면 상한 12 를 금방 먹는다).
    aura.x = boss.x;
    aura.y = boss.y;
    aura.life = WARDEN_AURA_TICKS;
    aura.damage = boss.damage;
    return;
  }
  spawnCatalystHazard(
    state,
    boss.x,
    boss.y,
    WARDEN_ARMOR_RADIUS,
    0,
    WARDEN_AURA_TICKS,
    boss.damage,
    false,
    WARDEN_AURA_MARK,
  );
  // 통지는 **장판이 새로 설 때 한 번**이다 — 매 틱 부르면 틱당 64건 상한을 이 카드 혼자 먹는다.
  notifyCatalystFx(state, CARD_KARGON_LAVA_WARDEN, CATALYST_FX.trigger, boss.x, boss.y);
}

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다 — 바꾸면 두 그룹이 같은 값을 만지는 런에서 결과가 갈린다).
 *
 * ⚠️ 자리는 `stepShipSignature` 안(`world.ts:2001`)이라 **`updateWaves`(`:2020`)보다 앞**이다.
 * `id 30` 이 이번 틱의 처치 할당·적 상한을 여기서 세워도 같은 틱에 반영되는 근거가 그것이다.
 */
export function kargonOnTick(state: WorldState, player: Entity): void {
  void player;
  swarmcallOnTick(state);
  magmaVeinOnTick(state);
  lavaWardenOnTick(state);
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
//    디스패처는 단락 없이 13개를 **전부** 부르고 OR 로 접는다(단락하면 뒤 그룹의 부수효과가 사라진다).
//
// ## ⚠️ 핫 경로 — 첫 줄은 반드시 **값싼 조기 반환**
// `EnemyDamaged`·`EnemyStep`·`EnemyContact` 는 적마다 매 틱 돈다(× 13 그룹). 본체를 채울 때
// 첫 줄을 `if (!carries(state, CARD_*)) return …;` 로 두어라. 캐시하겠다고 `WorldState` 에
// 새 칸을 만들지 마라 — 헌장 §훅 예산이 그것을 §B 로 올린다.

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 kargon 몫 —
 * **`id 32 kargon-lava-warden` 의 용암 갑주**(가까이 붙을수록 물러지고 멀어지면 굳는다).
 *
 * ⚠️ 종전에는 `world.ts` 가 {@link kargonLavaArmorMult} 를 **직접 import** 해 피해 산식에
 * 곱했다. 그 자리를 앵커로 승격하면서 이 함수가 진입점이 됐다 — 계산 본체는 그대로 두고
 * (기존 소비자·테스트가 그 이름을 쓴다) 여기서는 **위임만** 한다. 값은 비트 동일이다.
 */
export function kargonOnEnemyDamageTakenMult(
  state: WorldState,
  target: Entity,
  px: number,
  py: number,
): number {
  return kargonLavaArmorMult(state, target, px, py);
}

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/**
 * {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 kargon 몫 —
 * **`id 31` 자해 귀속**(헌장 §귀속 규율 3: 촉매 자해는 적 피해와 다른 색·다른 사운드).
 *
 * 피해 자체는 `resolveCollisions` 의 해저드 분기가 이미 준다(위 §자기 피해). 여기서 하는 것은
 * *"방금 그 피해가 내 용암 탓인가"* 를 가려 `selfHarm` 통지를 내는 것뿐이다 — 판정은
 * ①피해원 비트에 해저드가 있고 ②플레이어가 지금 내 용암 위에 있다, 둘의 곱이다.
 */
export function kargonOnPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
): void {
  void dmg;
  void lethalSurvived;
  if (!carries(state, CARD_KARGON_MAGMA_VEIN)) return;
  if (!hasDamageSource(sources, DamageSource.hazard)) return;
  if (!onMagmaLava(state, player.x, player.y)) return;
  notifyCatalystFx(state, CARD_KARGON_MAGMA_VEIN, CATALYST_FX.selfHarm, player.x, player.y);
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnBulletExpired(
  state: WorldState,
  bullet: Entity,
  reason: BulletExpiryReason,
): void {
  void state;
  void bullet;
  void reason;
}

/** {@link import('../catalystHooks.js').onWallContactCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnWallContact(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/** {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnEnemyDamaged(
  state: WorldState,
  target: Entity,
  dmg: number,
  source: Entity | undefined,
): void {
  void state;
  void target;
  void dmg;
  void source;
}

/** {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void state;
  void x;
  void y;
  void elite;
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnPowerupPicked(
  state: WorldState,
  poolIndex: number,
  offeredIndex: number,
): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnResourceGranted(
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

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 kargon 몫 — **경제 축 둘**.
 *
 *  - `id 30`: 누진 단계가 오른 세그먼트에서는 그만큼 처치가 전리품을 더 뱉는다.
 *  - `id 31`: 용암 위에서 죽은 적은 전리품을 두 배 뱉는다.
 *
 * ⚠️ **재롤이 아니다** — 이미 뽑힌 롤에 곱하는 배율만 돌려준다(헌장 공통-B(c)). 등급(`rarity`)은
 * 이 그룹의 축이 아니라 중립 1 이다(명세의 상한 축이 둘 다 **드랍**이다).
 */
export function kargonOnLootRoll(
  state: WorldState,
  x: number,
  y: number,
  elite: boolean,
): CatalystLootRoll {
  void elite;
  let count = 1;
  const stage = swarmcallStage(state);
  if (stage > 0) count *= 1 + stage * SWARM_LOOT_STEP;
  if (carries(state, CARD_KARGON_MAGMA_VEIN) && onMagmaLava(state, x, y)) count *= LAVA_LOOT_MULT;
  if (count === 1) return CATALYST_LOOT_NEUTRAL;
  if (count > KARGON_LOOT_COUNT_CAP) count = KARGON_LOOT_COUNT_CAP;
  return { rarity: 1, count };
}

/** {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnLootCollected(state: WorldState, loot: Entity): boolean {
  void state;
  void loot;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 kargon 몫 — `id 30` 의 신호.
 *
 * 명세의 `신호:` 는 *"웨이브 전환마다 누진 단계가 한 칸씩 차오른다"* 다. 그 한 칸이 여기다 —
 * 전진 틱에만 정확히 한 번 불리므로 매 틱 통지 금지 규율을 구조적으로 지킨다.
 *
 * ⚠️ 좌표가 `0,0` 인 것은 이 앵커에 플레이어가 안 넘어오기 때문이다. `trigger` 통지의 소비자는
 * **HUD 슬롯 번쩍임**(id 로 칸을 찾는다)이라 좌표를 안 본다.
 */
export function kargonOnWaveAdvanced(
  state: WorldState,
  prevSegment: number,
  nextSegment: number,
): void {
  void prevSegment;
  void nextSegment;
  if (!carries(state, CARD_KARGON_SWARMCALL)) return;
  notifyCatalystFx(state, CARD_KARGON_SWARMCALL, CATALYST_FX.trigger, 0, 0);
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 kargon 몫. **미배선**(위 §주석). */
export function kargonOnEnemyStep(state: WorldState, e: Entity): number {
  void state;
  void e;
  return 1;
}

/** {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 kargon 몫. **미배선**. */
export function kargonOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  void state;
  void e;
  return false;
}

/**
 * {@link import('../catalystHooks.js').stepCatalystHazards} 의 kargon 몫. **미배선이 정답이다** —
 * `id 31` 용암이 적을 태우는 것은 그 함수의 **공용 피해 루프**가 이미 한다(`phase === 1` +
 * `catalystHazardDamaging`). 여기서 한 번 더 때리면 용암 피해가 두 배가 된다.
 */
export function kargonOnCatalystHazards(state: WorldState): void {
  void state;
}
