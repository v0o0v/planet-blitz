/**
 * 촉매 **아르케 특산**(id 39~41) — 강제 횡스크롤(`PLANET_MODE.racing`)을 비트는 셋.
 *
 * ## 왜 그룹마다 파일을 가르는가
 * 카드 45종을 **병렬 레인이 동시에** 채운다. 한 파일이면 레인마다 같은 함수를 만져 **매 머지가
 * 충돌**한다. 그룹 = 카드 묶음 하나라 레인 하나가 파일 하나를 통째로 소유한다.
 *
 * ⚠️ 이 모듈은 `world.js` 를 **type-only** 로만 import 한다(순환 금지).
 *
 * ## ⭐ 이 그룹이 지고 있는 계약 셋
 *  1. **보스를 삭제하지 않는다**(`id 41`). 초판은 보스를 관문으로 **대체**해 `CONTEXT.md`
 *     §행성 모드의 *"모든 행성 모드는 보스 처치로 완주한다"* 를 깼다. 관문은 보스 **앞**에 선다.
 *  2. **입력을 씹지 않는다**(`id 40`). 초판의 *"3초간 감속할 수 없다"* 는 레이싱에서 감속이
 *     핵심 입력이라 헌장 §페널티 금지 ①(입력 씹기) 위반이었다. **물리만 바꾼다.**
 *  3. **되돌림이 규칙 안에 있다**(`id 39`). 속도 하락은 *"구간을 무충돌로 통과하면 한 단계
 *     돌아온다"* 와 한 쌍이라, 하락만 얹으면 헌장 §페널티 3 을 어긴다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import { spawnDestructible, spawnLoot } from '../entities.js';
import type { DamageSourceMask } from '../skillSlots.js';
import type { BulletExpiryReason } from '../skillHooks.js';
import { CATALYST_GATE_MARK, CATALYST_LOOT_NEUTRAL, carries } from './shared.js';
import type { CatalystLootRoll, VolleyParams } from './shared.js';
import { AncientCoreSlot, ObeliskSlot, OverclockSlot, readCatalystSlot, writeCatalystSlot } from '../catalystSlots.js';
import { CATALYST_FX, creditCatalyst, missCatalyst, notifyCatalystFx } from './fx.js';
import { PLANET_MODE } from '../planetMode.js';
import { INVASION_ACCEL_MAX_CP } from '../invasion/constants.js';
import { RACING_WALL_MARK, racingCourseLength, racingProgress } from '../modes/racing.js';

/** id 39 — slug `arke-overclock`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ARKE_OVERCLOCK = 39;

/** id 40 — slug `arke-ancient-core`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ARKE_ANCIENT_CORE = 40;

/** id 41 — slug `arke-obelisk`. 정본은 `src/data/catalysts.ts`. */
export const CARD_ARKE_OBELISK = 41;

/**
 * 지금이 레이싱 런인가. 셋 다 이 무대 전용이다 — 다른 무대에서 켜지면 코스·창이 없어
 * 조용한 무연산이 아니라 **엉뚱한 스폰**이 된다.
 */
function isRacingRun(state: WorldState): boolean {
  return state.config.planetMode === PLANET_MODE.racing;
}

/** 원-원 겹침(브로드페이즈 없이 쓰는 정확 판정). */
function overlaps(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}

// ---------------------------------------------------------------------------
// id 39 arke-overclock — 스크롤 2배 · 부딪히면 벽이 부서지고 속도가 내려간다
// ---------------------------------------------------------------------------
//
// 네 조각이 서로 다른 앵커에 걸린다:
//  ① 스크롤 2배 — `arkeOnTick` 이 `ScrollRuntime.accelCp` 를 상한으로 밀어 둔다.
//  ② 벽 접촉 시 속도 하락 — `arkeOnWallContact`.
//  ③ 벽 파괴 자원 — 같은 앵커(접촉한 그 벽을 부순다).
//  ④ 무충돌 복구 — `arkeOnWaveAdvanced`(세그먼트 축).
//
// ## ⚠️ `config.playerSpeed` 는 **감시 대상 공유 필드**다
// 침식 약공명 '마모'가 같은 필드를 **반대 방향으로** 올리고 `id 46` 도 쓴다(픽커 노랑 경고가
// 이미 그 쌍을 등재했다). 그래서 이 카드는 **덧셈 단계**로만 만진다 — 배율로 쓰면 두 작성자가
// 서로의 기준선을 덮어 되돌림이 원값으로 안 돌아온다. 덧셈은 교환법칙이 성립해서
// `speed -= STEP` / `speed += STEP` 왕복이 **다른 작성자와 무관하게 정확히 항등**이고,
// 단계 수를 슬롯이 들고 있으므로 한 번 내려간 만큼만 되돌린다(과복구가 원리적으로 불가능).
//
// 우선순위: **'마모'가 이긴다**(이 카드는 그 위에 델타만 얹는다). 공명은 자기 구성원의 대가를
// 지우면 안 되지만(헌장), 애초에 `도박` 단독 태그라 침식 공명과 같은 런에 설 수 없다 —
// 카탈로그 §태그가 그 사유로 `침식` 을 뺐다.

/** 오버클럭 중 강제하는 창 가속(cp). {@link INVASION_ACCEL_MAX_CP} 200 = 기준 100 의 **2배**. */
const OVERCLOCK_ACCEL_CP = INVASION_ACCEL_MAX_CP;

/** 한 단계당 깎이는 최대 속도(u/s). */
const OVERCLOCK_SPEED_STEP = 60;

/** 깎을 수 있는 최대 단계. 기본 720 기준 하한 360 — **0 이 되지 않는 것이 계약**이다(압사 즉사 금지). */
const OVERCLOCK_MAX_STEPS = 6;

/** 벽 하나를 부술 때 나오는 자원. */
const OVERCLOCK_WALL_RESOURCE = 30;

/** 접촉한 벽을 찾는 반경(플레이어 반경에 더한다). */
const OVERCLOCK_WALL_REACH = 90;

/** `CleanSegment` 인코딩 — `(segmentIndex + 1) * 2 + (이 구간에 부딪혔으면 1)`(값 규약 1: 0 = 없음). */
function packCleanSegment(segment: number, dirty: boolean): number {
  return (segment + 1) * 2 + (dirty ? 1 : 0);
}

/** `id 39` 한 틱 — 창 가속만 담당한다(나머지 셋은 각자의 앵커). */
function overclockTick(state: WorldState): void {
  if (!carries(state, CARD_ARKE_OVERCLOCK) || !isRacingRun(state)) return;
  const rt = state.scrollRuntime;
  if (rt === undefined) return;
  // ⚠️ 매 틱 통지하지 않는다(틱당 64건 상한) — 값이 실제로 오르는 틱에만 알린다.
  if (rt.accelCp >= OVERCLOCK_ACCEL_CP) return;
  rt.accelCp = OVERCLOCK_ACCEL_CP;
  notifyCatalystFx(state, CARD_ARKE_OVERCLOCK, CATALYST_FX.trigger, state.entities[0]?.x ?? 0, state.entities[0]?.y ?? 0);
}

// ---------------------------------------------------------------------------
// id 40 arke-ancient-core — 대량의 자원, 대신 3초간 선회 반경 2배
// ---------------------------------------------------------------------------
//
// ## ⚠️ 설계 정본과 코드가 어긋난 자리다 (고치지 않고 보고)
// 카탈로그 §훅은 이 카드를 *"§A — **선회 속도 배율 하나**"* 라고 적었는데 **그런 노브가 없다.**
// 실측: `world.ts` 의 `stepPlayer` 는 `player.vx = mx * config.playerSpeed * …` 로 입력 방향을
// **직접 대입**한다 — 선회라는 개념 자체가 물리에 없고(각속도 상태가 없다), 그래서 배율을
// 곱할 칸도 없다. 이것은 카탈로그가 `id 37` 의 플레이어 관성을 *"이동 직접 대입식 자체를 바꿔
// §C"* 라며 뺀 것과 **같은 자리**다.
//
// ## 그래서 무엇을 했는가 — 방향만 섞고 **크기는 손대지 않는다**
// {@link arkeMassTurnBlend} 가 `stepPlayer` 의 대입 **직전**에 입력 방향을 직전 진행 방향 쪽으로
// {@link MASS_TURN_RATE} 만큼 당긴다. 각속도가 절반이 되므로 같은 속력에서 선회 반경이 2배다.
//
// **입력은 전부 살아 있다**(헌장 §페널티 금지 ①):
//  - 입력 **크기**를 그대로 되돌려준다 → 감속·정지가 한 프레임도 안 씹힌다.
//  - 입력이 0 이면 손대지 않고 그대로 0 을 쓴다 → **완전 정지는 항상 즉시** 된다.
//  - 대시는 이 경로 밖이다(`config.dashSpeed` 가산은 대입 뒤다).
//
// 무촉매 런은 `state.catalystOn` 게이트에서 호출 자체가 없어 바이트 불변이다.

/** 코어 마커(`loot.ownerId`). 기존 마커와 겹치지 않는 큰 상수(`CATALYST_ORE_MARK` 선례). */
const CATALYST_CORE_MARK = 0xc0de40;

/** 코어가 뜨는 간격(틱). */
const CORE_SPAWN_TICKS = 420;

/** 동시에 떠 있을 수 있는 코어 수. */
const CORE_LIVE_CAP = 3;

/** 코어 하나가 주는 자원. *"대량"* 이 규칙문이라 벽 하나(30)보다 확실히 커야 한다. */
const CORE_RESOURCE = 140;

/** 흡수 후 질량이 남는 틱(3초). */
const CORE_MASS_TICKS = 180;

/** 창 중심에서 코어를 띄우는 전방 거리. */
const CORE_SPAWN_AHEAD = 900;

/** 코어를 띄우는 세로 오프셋(상·하 채널을 번갈아 — RNG 미사용 결정론 배치). */
const CORE_SPAWN_OFFSET_Y = 300;

/**
 * 선회 혼합 계수. **0.5 = 각속도 절반 = 선회 반경 2배**가 이 카드의 규칙문이다.
 * 1 이면 무효과, 0 이면 방향 전환 불가(그것은 입력 씹기라 **금지**).
 */
const MASS_TURN_RATE = 0.5;

/** 이 전리품이 고대 코어인가. */
function isCore(e: Entity): boolean {
  return !e.dead && e.kind === 'loot' && e.ownerId === CATALYST_CORE_MARK;
}

/**
 * 질량 지속 중 **입력 방향만** 직전 진행 방향 쪽으로 당긴다 — `world.ts` 의 `stepPlayer` 가
 * `player.vx`/`vy` 를 대입하기 **직전**에 부른다.
 *
 * @param mx 정규화된 입력 X(길이 ≤ 1)
 * @param my 정규화된 입력 Y
 * @returns 보정된 방향. **효과가 없으면 `undefined`** 를 돌려 호출부가 원값을 그대로 쓰게 한다
 *          (여기서 `{x: mx, y: my}` 를 돌려주면 매 틱 객체가 하나씩 생긴다).
 */
export function arkeMassTurnBlend(
  state: WorldState,
  player: Entity,
  mx: number,
  my: number,
): { x: number; y: number } | undefined {
  if (!carries(state, CARD_ARKE_ANCIENT_CORE)) return undefined;
  if (readCatalystSlot(state.catalystSlots, AncientCoreSlot.MassTicks) <= 0) return undefined;
  const inLen = Math.sqrt(mx * mx + my * my);
  if (inLen <= 0) return undefined; // ⭐ 무입력 = 감속·정지. **절대 손대지 않는다.**
  const prevLen = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
  if (prevLen <= 0) return undefined; // 정지 상태에서 출발하는 방향은 자유다.
  const px = player.vx / prevLen;
  const py = player.vy / prevLen;
  const bx = px + (mx / inLen - px) * MASS_TURN_RATE;
  const by = py + (my / inLen - py) * MASS_TURN_RATE;
  const bl = Math.sqrt(bx * bx + by * by);
  if (bl <= 0) return undefined; // 정확히 반대 방향 — 되돌림 자체는 막지 않는다.
  // **크기는 입력 것을 그대로 돌려준다** — 방향만 바뀐다(감속 입력이 살아 있는 근거).
  return { x: (bx / bl) * inLen, y: (by / bl) * inLen };
}

/** `id 40` 한 틱 — 코어 배치 + 질량 감쇠. */
function ancientCoreTick(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_ARKE_ANCIENT_CORE) || !isRacingRun(state)) return;
  const slots = state.catalystSlots;

  // ── 질량 감쇠 — 단조 누적이 아니라 **잔여 틱을 깎는다**(헌장 §틱 규율) ──────────
  const mass = readCatalystSlot(slots, AncientCoreSlot.MassTicks);
  if (mass > 0) writeCatalystSlot(slots, AncientCoreSlot.MassTicks, mass - 1);

  // ── 코어 배치 — RNG 미사용, 창 전방에 번갈아 놓는다 ─────────────────────────
  if (state.tick % CORE_SPAWN_TICKS !== 0) return;
  const rt = state.scrollRuntime;
  if (rt === undefined) return;
  let live = 0;
  for (const e of state.entities) {
    if (isCore(e)) live++;
  }
  if (live >= CORE_LIVE_CAP) return;
  const side = Math.floor(state.tick / CORE_SPAWN_TICKS) % 2 === 0 ? -1 : 1;
  // `dropSeed` 칸(= `loot.damage`)은 0 이다 — 코어는 드랍 시드가 아니라 자원이고, 수거를
  // `arkeOnLootCollected` 이 **억제**하므로 이 값이 `state.loot` 로 흘러갈 경로가 없다.
  const core = spawnLoot(state, rt.scrollX + CORE_SPAWN_AHEAD, rt.scrollY + side * CORE_SPAWN_OFFSET_Y, 0, 0);
  core.ownerId = CATALYST_CORE_MARK;
  void player;
  notifyCatalystFx(state, CARD_ARKE_ANCIENT_CORE, CATALYST_FX.trigger, core.x, core.y);
}

// ---------------------------------------------------------------------------
// id 41 arke-obelisk — 보스 **앞**에 관문 셋
// ---------------------------------------------------------------------------
//
// ## ⭐ 교착이 불가능하다
// 통과 수가 0 이어도 보스는 **죽는다** — 관문은 보스 HP 배수만 바꾸고(최악 ×2.5) 무적을
// 만들지 않는다. 관문 자체도 유한 HP 라 자동 조준이 죽지 않는 표적에 묶이지 않는다
// (`objective.ts` 헤더 §결함 #3). 관문이 부서지면 그 관문은 **미통과로 확정**될 뿐이다.
//
// ## 조건 셋은 전부 **위치·이동 축**이다
// 이 게임은 전 자동 조준이라 조준점이 플레이어의 손잡이가 아니다 — 조준·사격 타이밍·표적
// 선택을 전제하면 실력이 아니라 **무기 타입 게이트**가 된다(`id 32` 2판이 밟은 형태).
//  ① 무피격 — 피격 여부(`arkeOnPlayerDamaged`)
//  ② 속도   — 속력 유지(위치 미분)
//  ③ 궤도   — 링 안쪽 체류(거리)

/** 관문 수. */
const OBELISK_GATE_COUNT = 3;

/** 코스의 이 지점(비율)을 넘으면 관문이 선다 — **보스 앞**이다. */
const OBELISK_SPAWN_AT = 0.8;

/** 관문 반경(`destructible` 접촉·조준 반경). */
const OBELISK_RADIUS = 90;

/** 관문 HP. 유한하다 — 무적이면 자동 조준이 묶인다. */
const OBELISK_HP = 4000;

/** 관문 사이 세로 간격. */
const OBELISK_SPACING_Y = 420;

/** 관문이 서는 전방 거리(창 중심 기준). */
const OBELISK_AHEAD = 700;

/** 각 관문의 판정 지속(틱). 3초. */
const OBELISK_GATE_TICKS = 180;

/** ② 속도 관문의 최소 속력(u/s). */
const OBELISK_SPEED_MIN = 480;

/** ③ 궤도 관문의 링 반경. */
const OBELISK_ORBIT_RADIUS = 600;

/** `ActiveGate` 인코딩의 자리값 — 진행도는 {@link OBELISK_GATE_TICKS} 보다 작다. */
const OBELISK_PACK = 1024;

/** `GateState` 비트 — 관문 i 통과. */
function gatePassedBit(i: number): number {
  return 1 << i;
}

/** `GateState` 비트 — 관문 i 판정 종료(통과든 실패든). */
function gateResolvedBit(i: number): number {
  return 1 << (OBELISK_GATE_COUNT + i);
}

/** `GateState` 비트 — 관문을 이미 세웠다. */
const OBELISK_SPAWNED_BIT = 1 << (OBELISK_GATE_COUNT * 2);

/** `GateState` 비트 — 보스 배수를 이미 적용했다(두 번 곱하면 카드가 두 배가 된다). */
const OBELISK_BOSS_SCALED_BIT = 1 << (OBELISK_GATE_COUNT * 2 + 1);

/**
 * 통과 수별 보스 HP 배수. *"통과한 수만큼 보스가 약해지고, 통과 못 한 관문은 그 힘을 보스에게
 * 준다"* — 0 통과가 **최악 ×2.5** 이고 그래도 **죽는다**(교착 없음).
 */
const OBELISK_BOSS_HP_MULT = [2.5, 2.0, 1.5, 0.85] as const;

/** 통과 수별 전리품 등급 배율. 카탈로그 §상한 = 희귀도 ×2.4. */
const OBELISK_RARITY = [1, 1.5, 2.0, 2.4] as const;

/** 지금까지 통과한 관문 수. */
function obeliskPassed(state: WorldState): number {
  const st = readCatalystSlot(state.catalystSlots, ObeliskSlot.GateState);
  let n = 0;
  for (let i = 0; i < OBELISK_GATE_COUNT; i++) if ((st & gatePassedBit(i)) !== 0) n++;
  return n;
}

/** 지금 판정 중인 관문 번호(0-based). 없으면 `-1`. */
function obeliskActiveGate(state: WorldState): number {
  const v = readCatalystSlot(state.catalystSlots, ObeliskSlot.ActiveGate);
  return Math.floor(v / OBELISK_PACK) - 1;
}

/** 지금 판정 중인 관문의 진행도(틱). */
function obeliskActiveProgress(state: WorldState): number {
  return readCatalystSlot(state.catalystSlots, ObeliskSlot.ActiveGate) % OBELISK_PACK;
}

function writeActiveGate(state: WorldState, gate: number, progress: number): void {
  writeCatalystSlot(state.catalystSlots, ObeliskSlot.ActiveGate, (gate + 1) * OBELISK_PACK + progress);
}

/** 관문 i 를 통과/실패로 확정한다. **한 번만** 적힌다(재확정은 무시). */
function resolveGate(state: WorldState, i: number, passed: boolean, x: number, y: number): void {
  const slots = state.catalystSlots;
  const st = readCatalystSlot(slots, ObeliskSlot.GateState);
  if ((st & gateResolvedBit(i)) !== 0) return;
  writeCatalystSlot(slots, ObeliskSlot.GateState, st | gateResolvedBit(i) | (passed ? gatePassedBit(i) : 0));
  writeActiveGate(state, -1, 0);
  if (passed) {
    creditCatalyst(state, CARD_ARKE_OBELISK, 1);
    notifyCatalystFx(state, CARD_ARKE_OBELISK, CATALYST_FX.credit, x, y);
  } else {
    // 헌장: *"놓친 액수가 보여야 다음 판에 조건을 추구한다."* 실패한 빛은 보스에게 흘러간다.
    missCatalyst(state, CARD_ARKE_OBELISK, 1);
    notifyCatalystFx(state, CARD_ARKE_OBELISK, CATALYST_FX.miss, x, y);
  }
}

/** `id 41` 한 틱 — 관문 배치 · 조건 판정 · 보스 정산. */
function obeliskTick(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_ARKE_OBELISK) || !isRacingRun(state)) return;
  const slots = state.catalystSlots;
  const rt = state.scrollRuntime;
  if (rt === undefined) return;

  // ── ① 배치 — 코스 80% 지점, 한 번만 ─────────────────────────────────────────
  let st = readCatalystSlot(slots, ObeliskSlot.GateState);
  if ((st & OBELISK_SPAWNED_BIT) === 0) {
    if (racingProgress(rt) < racingCourseLength() * OBELISK_SPAWN_AT) return;
    for (let i = 0; i < OBELISK_GATE_COUNT; i++) {
      const g = spawnDestructible(
        state,
        rt.scrollX + OBELISK_AHEAD,
        rt.scrollY + (i - 1) * OBELISK_SPACING_Y,
        OBELISK_RADIUS,
        OBELISK_HP,
        0,
      );
      g.ownerId = CATALYST_GATE_MARK; // 조준 등재 — `isCatalystObjective` 가 이 값을 본다.
      g.aux0 = i; // 관문 번호(정수). `destructible` 이라 `catalystMarks` 의 잡몹 규약 밖이다.
    }
    st |= OBELISK_SPAWNED_BIT;
    writeCatalystSlot(slots, ObeliskSlot.GateState, st);
    writeActiveGate(state, 0, 0); // 첫 관문부터 순서대로 판정한다.
    notifyCatalystFx(state, CARD_ARKE_OBELISK, CATALYST_FX.trigger, player.x, player.y);
    return;
  }

  // ── ② 판정 — 진행 중인 관문 하나만 본다 ─────────────────────────────────────
  // ⚠️ 확정(`resolveGate`)은 진행 중 관문을 `-1` 로 비운다 — **다음 관문을 여기서 다시 고른다.**
  //    안 고르면 첫 관문이 확정되는 순간 나머지 둘이 영영 판정되지 않는다(실측으로 잡힌 형태다).
  let gate = obeliskActiveGate(state);
  if (gate < 0 || gate >= OBELISK_GATE_COUNT || (st & gateResolvedBit(gate)) !== 0) {
    gate = -1;
    for (let i = 0; i < OBELISK_GATE_COUNT; i++) {
      if ((st & gateResolvedBit(i)) === 0) {
        gate = i;
        break;
      }
    }
    writeActiveGate(state, gate, 0);
  }
  if (gate >= 0 && gate < OBELISK_GATE_COUNT) {
    {
      const progress = obeliskActiveProgress(state);
      let ok = true;
      if (gate === 1) {
        // ② 속도 관문 — 감속 없이 통과. 속력은 위치 미분(`vx`/`vy`)이라 조준과 무관하다.
        ok = Math.sqrt(player.vx * player.vx + player.vy * player.vy) >= OBELISK_SPEED_MIN;
      } else if (gate === 2) {
        // ③ 궤도 관문 — 관문이 그린 링 안쪽 유지.
        let inside = false;
        for (const e of state.entities) {
          if (e.dead || e.ownerId !== CATALYST_GATE_MARK || e.aux0 !== 2) continue;
          if (overlaps(e.x, e.y, OBELISK_ORBIT_RADIUS, player.x, player.y, 0)) inside = true;
          break;
        }
        ok = inside;
      }
      // ① 무피격 관문(gate === 0)은 실패 조건이 **사건**이라 여기서 볼 것이 없다 —
      //    `arkeOnPlayerDamaged` 가 그 틱에 확정시킨다.
      if (!ok) {
        writeActiveGate(state, gate, 0); // 조건이 끊기면 진행도만 되감는다(즉시 실패는 아니다).
      } else if (progress + 1 >= OBELISK_GATE_TICKS) {
        resolveGate(state, gate, true, player.x, player.y);
      } else {
        writeActiveGate(state, gate, progress + 1);
      }
    }
  }

  // ── ③ 보스 정산 — 보스가 **뜬 뒤** 한 번만 ─────────────────────────────────
  st = readCatalystSlot(slots, ObeliskSlot.GateState);
  if ((st & OBELISK_BOSS_SCALED_BIT) !== 0) return;
  for (const b of state.entities) {
    if (b.dead || b.kind !== 'boss') continue;
    // 미확정 관문은 전부 실패로 굳힌다 — 보스가 떴다는 것은 관문 구간이 끝났다는 뜻이다.
    for (let i = 0; i < OBELISK_GATE_COUNT; i++) resolveGate(state, i, false, b.x, b.y);
    const passed = obeliskPassed(state);
    const mult = OBELISK_BOSS_HP_MULT[passed] ?? 1;
    b.hp = Math.round(b.hp * mult);
    b.maxHp = Math.round(b.maxHp * mult);
    writeCatalystSlot(
      slots,
      ObeliskSlot.GateState,
      readCatalystSlot(slots, ObeliskSlot.GateState) | OBELISK_BOSS_SCALED_BIT,
    );
    notifyCatalystFx(state, CARD_ARKE_OBELISK, CATALYST_FX.trigger, b.x, b.y);
    return;
  }
}

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **고정 순서로** 부른다(순서가
 * 곧 계약이다).
 */
export function arkeOnTick(state: WorldState, player: Entity): void {
  overclockTick(state);
  ancientCoreTick(state, player);
  obeliskTick(state, player);
}

// ---------------------------------------------------------------------------
// 앵커 팬아웃 진입점 — **카드 레인은 `catalystHooks.ts` 를 한 줄도 고치지 않는다**
// ---------------------------------------------------------------------------
//
// ## ⚠️ 반환값이 있는 앵커의 **합성 규칙**(디스패처가 진다)
//  - 배율형 — 그룹 순서대로 **곱해서 누적**한다. 중립은 `1`(전리품은 {@link CATALYST_LOOT_NEUTRAL}).
//  - 억제형 — **하나라도 `true` 면 억제**.
//
// ## ⚠️ 핫 경로 — 첫 줄은 반드시 **값싼 조기 반환**

/** {@link import('../catalystHooks.js').onVolleyFiredCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnVolleyFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/**
 * {@link import('../catalystHooks.js').onEnemyDamageTakenMultCatalyst} 의 arke 몫. **미배선**(위 §주석).
 * 자기 몫이 없는 그룹은 **정확히 `1`** 을 돌려준다(곱셈이 무연산이라 비트 동일).
 */
export function arkeOnEnemyDamageTakenMult(
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

/** {@link import('../catalystHooks.js').onWallDestroyedCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnWallDestroyed(state: WorldState, wall: Entity): void {
  void state;
  void wall;
}

/** {@link import('../catalystHooks.js').onVolleyParamsCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnVolleyParams(
  state: WorldState,
  player: Entity,
  volley: VolleyParams,
): void {
  void state;
  void player;
  void volley;
}

/** {@link import('../catalystHooks.js').onDashFiredCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnDashFired(state: WorldState, player: Entity): void {
  void state;
  void player;
}

/** {@link import('../catalystHooks.js').onGemCollectedCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnGemCollected(state: WorldState, gem: Entity): void {
  void state;
  void gem;
}

/**
 * {@link import('../catalystHooks.js').onPlayerDamagedCatalyst} 의 arke 몫 —
 * `id 41` **무피격 관문**의 유일한 실패 조건.
 */
export function arkeOnPlayerDamaged(state: WorldState, player: Entity, dmg: number, lethalSurvived: boolean, sources: DamageSourceMask): void {
  void dmg;
  void lethalSurvived;
  void sources;
  if (!carries(state, CARD_ARKE_OBELISK)) return;
  if (obeliskActiveGate(state) !== 0) return;
  resolveGate(state, 0, false, player.x, player.y);
}

/** {@link import('../catalystHooks.js').onKillsDeltaCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnKillsDelta(state: WorldState, delta: number): void {
  void state;
  void delta;
}

/** {@link import('../catalystHooks.js').onBulletExpiredCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnBulletExpired(state: WorldState, bullet: Entity, reason: BulletExpiryReason): void {
  void state;
  void bullet;
  void reason;
}

/**
 * {@link import('../catalystHooks.js').onWallContactCatalyst} 의 arke 몫 —
 * `id 39` 의 **벽 파괴 + 속도 하락**(두 조각이 같은 사건이라 한 자리다).
 *
 * ⚠️ **되돌림은 `arkeOnWaveAdvanced` 가 진다.** 여기서 하락만 얹으면 헌장 §페널티 3 위반이다.
 */
export function arkeOnWallContact(state: WorldState, player: Entity): void {
  if (!carries(state, CARD_ARKE_OVERCLOCK) || !isRacingRun(state)) return;
  const slots = state.catalystSlots;

  // ── 이 구간을 "부딪힘"으로 표시한다(무충돌 복구의 판정 근거) ───────────────────
  const segment = state.wave.segmentIndex;
  writeCatalystSlot(slots, OverclockSlot.CleanSegment, packCleanSegment(segment, true));

  // ── 벽 파괴 — 레이싱 코스 벽만이다(절차 지형·침공 벽은 마커가 달라 안 걸린다) ──
  let broke = false;
  const reach = player.radius + OVERCLOCK_WALL_REACH;
  for (const w of state.entities) {
    if (w.dead || w.kind !== 'wall' || w.ownerId !== RACING_WALL_MARK) continue;
    // 벽은 AABB 이고 **필드 매핑이 `radius` = 반폭 · `targetX` = 반높이**다(`spawnWall` 정본).
    // 원-원으로 재면 세로로 얇고 가로로 긴 분리 벽에서 판정이 통째로 어긋난다.
    if (Math.abs(w.x - player.x) > w.radius + reach) continue;
    if (Math.abs(w.y - player.y) > w.targetX + reach) continue;
    w.dead = true; // `rebuildActiveWalls` 가 다음 틱에 목록에서 뺀다.
    broke = true;
    state.resources += OVERCLOCK_WALL_RESOURCE;
    creditCatalyst(state, CARD_ARKE_OVERCLOCK, OVERCLOCK_WALL_RESOURCE);
    notifyCatalystFx(state, CARD_ARKE_OVERCLOCK, CATALYST_FX.credit, w.x, w.y);
    break; // 한 접촉에 한 장.
  }
  if (!broke) return;

  // ── 대가 — 최대 속도가 한 단계 내려간다(덧셈. 사유는 이 파일 §공유 필드) ────────
  const step = readCatalystSlot(slots, OverclockSlot.SpeedStep);
  if (step >= OVERCLOCK_MAX_STEPS) return; // 하한을 지킨다 — 0 이 되면 압사 즉사다.
  writeCatalystSlot(slots, OverclockSlot.SpeedStep, step + 1);
  state.config.playerSpeed -= OVERCLOCK_SPEED_STEP;
  notifyCatalystFx(state, CARD_ARKE_OVERCLOCK, CATALYST_FX.selfHarm, player.x, player.y);
}

/** {@link import('../catalystHooks.js').onDamageChainCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnDamageChain(state: WorldState, player: Entity, dmg: number): number {
  void state;
  void player;
  void dmg;
  return 1;
}

/** {@link import('../catalystHooks.js').onEnemyDamagedCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnEnemyDamaged(state: WorldState, target: Entity, dmg: number, source: Entity | undefined): void {
  void state;
  void target;
  void dmg;
  void source;
}

/** {@link import('../catalystHooks.js').onEnemyDeathCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  void state;
  void x;
  void y;
  void elite;
}

/** {@link import('../catalystHooks.js').onLevelUpCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnLevelUp(state: WorldState, level: number): void {
  void state;
  void level;
}

/** {@link import('../catalystHooks.js').onPowerupOfferCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnPowerupOffer(state: WorldState, offers: number[]): void {
  void state;
  void offers;
}

/** {@link import('../catalystHooks.js').onPowerupPickedCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnPowerupPicked(state: WorldState, poolIndex: number, offeredIndex: number): void {
  void state;
  void poolIndex;
  void offeredIndex;
}

/** {@link import('../catalystHooks.js').onDashPierceCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnDashPierce(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onResourceGrantedCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnResourceGranted(state: WorldState, amount: number, x: number, y: number): void {
  void state;
  void amount;
  void x;
  void y;
}

/** {@link import('../catalystHooks.js').onBossDeathCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnBossDeath(state: WorldState, x: number, y: number): boolean {
  void state;
  void x;
  void y;
  return false;
}

/**
 * {@link import('../catalystHooks.js').onLootRollCatalyst} 의 arke 몫 —
 * `id 41` 의 *"통과한 수만큼 전리품 등급이 오른다"*.
 */
export function arkeOnLootRoll(state: WorldState, x: number, y: number, elite: boolean): CatalystLootRoll {
  void elite;
  if (!carries(state, CARD_ARKE_OBELISK)) return CATALYST_LOOT_NEUTRAL;
  const passed = obeliskPassed(state);
  if (passed <= 0) return CATALYST_LOOT_NEUTRAL;
  const rarity = OBELISK_RARITY[passed] ?? 1;
  notifyCatalystFx(state, CARD_ARKE_OBELISK, CATALYST_FX.credit, x, y);
  return { rarity, count: 1 };
}

/**
 * {@link import('../catalystHooks.js').onLootCollectedCatalyst} 의 arke 몫 —
 * `id 40` **코어 흡수**. `true` 로 기본 수거를 억제한다(코어는 장비가 아니라 자원이다).
 *
 * ⚠️ 억제하지 않으면 코어 하나마다 **가짜 장비**가 생기고, 더 나쁘게는 `catalystDropsFromRun`
 * 이 드랍 시드마다 게이트를 굴려 촉매까지 공짜로 늘어난다.
 */
export function arkeOnLootCollected(state: WorldState, loot: Entity): boolean {
  if (!isCore(loot)) return false;
  state.resources += CORE_RESOURCE;
  creditCatalyst(state, CARD_ARKE_ANCIENT_CORE, CORE_RESOURCE);
  // 대가는 **즉시** 실린다 — 이득과 대가가 같은 사건에서 나오는 것이 이 카드의 정체성이다.
  writeCatalystSlot(state.catalystSlots, AncientCoreSlot.MassTicks, CORE_MASS_TICKS);
  notifyCatalystFx(state, CARD_ARKE_ANCIENT_CORE, CATALYST_FX.credit, loot.x, loot.y);
  notifyCatalystFx(state, CARD_ARKE_ANCIENT_CORE, CATALYST_FX.selfHarm, loot.x, loot.y);
  return true;
}

/**
 * {@link import('../catalystHooks.js').onWaveAdvancedCatalyst} 의 arke 몫 —
 * `id 39` 의 **되돌림**: *"구간을 무충돌로 통과하면 한 단계 돌아온다"*.
 *
 * ⭐ 되돌림이 **덧셈의 정확한 역**이라 왕복이 항등이다(§공유 필드 주석 참조). 단계 수가 0 이면
 * 아무것도 안 한다 — 원값보다 빨라지는 경로가 없다.
 */
export function arkeOnWaveAdvanced(state: WorldState, prevSegment: number, nextSegment: number): void {
  if (!carries(state, CARD_ARKE_OVERCLOCK) || !isRacingRun(state)) return;
  const slots = state.catalystSlots;
  const mark = readCatalystSlot(slots, OverclockSlot.CleanSegment);
  const dirty = mark !== 0 && Math.floor(mark / 2) - 1 === prevSegment && mark % 2 === 1;
  writeCatalystSlot(slots, OverclockSlot.CleanSegment, packCleanSegment(nextSegment, false));
  if (dirty) return; // 이 구간에 부딪혔다 — 복구 없음.
  const step = readCatalystSlot(slots, OverclockSlot.SpeedStep);
  if (step <= 0) return;
  writeCatalystSlot(slots, OverclockSlot.SpeedStep, step - 1);
  state.config.playerSpeed += OVERCLOCK_SPEED_STEP;
  const p = state.entities[0];
  notifyCatalystFx(state, CARD_ARKE_OVERCLOCK, CATALYST_FX.trigger, p?.x ?? 0, p?.y ?? 0);
}

/** {@link import('../catalystHooks.js').onEnemyContactCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnEnemyContact(state: WorldState, player: Entity, target: Entity): void {
  void state;
  void player;
  void target;
}

/** {@link import('../catalystHooks.js').onEnemyStepCatalyst} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnEnemyStep(state: WorldState, e: Entity): number {
  void state;
  void e;
  return 1;
}

/**
 * {@link import('../catalystHooks.js').onDestructibleDestroyedCatalyst} 의 arke 몫 —
 * `id 41` **관문 파괴**. 부서진 관문은 **미통과로 확정**된다(런은 막히지 않는다).
 *
 * ⚠️ 이 앵커는 `compact()` 안이라 스폰 금지다. 슬롯 쓰기뿐이라 안전하다.
 * 기본 젬 드랍은 억제하지 않는다 — 관문은 부수라고 세운 것이 아니라 **통과하라고** 세운 것이라,
 * 부순 쪽에 보상을 주면 조건 셋이 통째로 사문화된다.
 */
export function arkeOnDestructibleDestroyed(state: WorldState, e: Entity): boolean {
  if (e.ownerId !== CATALYST_GATE_MARK) return false;
  if (!carries(state, CARD_ARKE_OBELISK)) return false;
  resolveGate(state, e.aux0, false, e.x, e.y);
  return false;
}

/** {@link import('../catalystHooks.js').stepCatalystHazards} 의 arke 몫. **미배선**(위 §주석). */
export function arkeOnCatalystHazards(state: WorldState): void {
  void state;
}
