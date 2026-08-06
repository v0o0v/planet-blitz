/**
 * **아크캐스터 30스킬의 효과 본체**(ADR-0049 배치 3 · 설계 정본
 * `.omc/plans/skill-rebuild-2026-08-05/arccaster.md` 4판).
 *
 * 형태는 **스트라이커 레인이 확립한 다섯 규율을 그대로 따른다**(`skills/striker.ts` 헤더가 정본):
 * ①`world.ts` 런타임 import 0건(타입은 type-only) ②모든 쓰기는 투자 게이트 안쪽 ③반올림은
 * 게이트 안 ④RNG 소비 0 ⑤슬롯 접근은 `readSlot`/`writeSlot` 만.
 *
 * ---
 *
 * ## ⚠️ 이 배치가 배선한 것은 30종 중 **13종**이다
 * 나머지 17종은 앵커 14개로 닿지 않는 지점(주무기 발사부의 탄 표식·탄수·간격 · 액티브 핸들러 ·
 * 탄 수명 만료 분기 · `stepGems` 반경 · 콤보 감소 지점 · 드랍 희귀도 · `applyChain` 파라미터화)을
 * 요구한다. 여기 없는 스킬은 "구현했는데 안 불린다"가 아니라 **아직 코드가 없다** —
 * 사유는 각 앵커의 `case` 주석과 레인 보고서에 있다.
 *
 * ## ⚠️ 전격 연쇄 부여는 설계상 정확히 3종(CH1·BR2·CH10)인데 이 배치는 **BR2 하나만** 켰다
 * CH1·CH10 은 둘 다 **탄 표식**이 전제라 발사부/액티브 핸들러 없이는 성립하지 않는다. 연쇄를
 * "대충 명중 시점 과충전 술어"로 바꿔 흉내 내지 않았다 — 설계서가 CH9 를 유일한 처치 시점
 * 예외로 못 박았고, 그 예외를 늘리면 두 문서가 갈린다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import { clearEnemyBullets, fanStrike } from '../activeTypes.js';
import { applyChain } from '../status.js';
import { readSlot, writeSlot, ArccasterCarry, ArccasterStage } from '../skillSlots.js';
import {
  overchargeBp,
  OVERCHARGE_STILL_TICKS,
  OVERCHARGE_BASE_BP,
  OVERCHARGE_RAMP_BP,
  OVERCHARGE_MAX_BP,
} from '../shipSignature.js';
import { FIRE_CD_Q } from '../constants.js';
import { skillLv } from '../../items/skills.js';

// ---------------------------------------------------------------------------
// flat 인덱스 — `data/ships/arccaster.ts` 의 축 순서가 정본
// ---------------------------------------------------------------------------
//
// `trees: [chain(offense), barrage(utility), barrier(defense)]` 이므로
// CH1..CH10 = 0..9 · BA1..BA10 = 10..19 · BR1..BR10 = 20..29 다.
//
// ⚠️ **스트라이커와 축 순서가 다르다.** 저쪽은 [offense, defense, utility] 라 두 번째 블록이
// 방어축이지만, 아크캐스터는 두 번째가 **탄막(utility)** 이다. 설계서의 서술 순서(연쇄→탄막→방벽)와
// 데이터가 우연히 일치하지만, 정본은 언제나 `data/ships/{ship}.ts` 의 `trees` 배열이다.

const enum Sk {
  /** CH4 진입 뇌격 */ entryLance = 3,
  /** CH6 과잉 전하 이월 */ overkillCarry = 5,
  /** BA3 정지 관측 사격 */ stillSpotter = 12,
  /** BR1 정전 척력장 */ staticRepulsor = 20,
  /** BR2 피뢰 접지 */ lightningRod = 21,
  /** BR3 위상 결합 방벽 */ phaseCoupling = 22,
  /** BR4 잉여 전하 방벽 */ surplusShield = 23,
  /** BR5 접지 케이블 */ groundTether = 24,
  /** BR6 전하 역류 */ chargeBackflow = 25,
  /** BR7 완충 콘덴서 */ bufferCondenser = 26,
  /** BR8 정지 수복 회로 */ stillRepair = 27,
  /** BR9 척력 외피 */ repulseHull = 28,
  /** BR10 최후 접지 */ terminalGround = 29,
}

/**
 * 이 런에서 그 스킬의 **실효 레벨**(투자 + 축 어픽스). 미투자면 0 이다(`skillLv` 정본 1).
 * 기체 게이트는 호출부(`skillHooks.ts` 의 `case SIG_ARC_OVERCHARGE`)가 이미 걸었다.
 */
function lv(state: WorldState, flat: Sk): number {
  return skillLv(
    state.config.skillInvest,
    flat,
    state.config.skillAffixLv,
    state.skillDerived.shipType,
  );
}

// ---------------------------------------------------------------------------
// 시그니처 유도 상수
// ---------------------------------------------------------------------------

/**
 * 과충전 정지 카운터 상한. `world.ts` 의 `OVERCHARGE_TICK_CAP`(=600)이 **파일 지역 상수**라
 * import 할 수 없다 — `activeHandlers/arccaster.ts:35` 가 이미 같은 사유로 같은 값을 지역
 * 선언했고, 이 파일은 그 선례를 따른다(값이 바뀌면 세 곳을 함께 고쳐야 한다).
 */
const OVERCHARGE_TICK_CAP = 600;

/**
 * `overchargeBp` 가 상한 4000bp 에 닿는 정지 틱(=190). `activeHandlers/arccaster.ts:41` 과
 * **같은 식으로 유도**한다 — 밸런스 패스가 `OVERCHARGE_*` 를 만지면 자동으로 따라오게.
 */
const OVERCHARGE_APEX_TICKS =
  OVERCHARGE_STILL_TICKS + Math.ceil((OVERCHARGE_MAX_BP - OVERCHARGE_BASE_BP) / OVERCHARGE_RAMP_BP);

/** 과충전 중인가 — 설계서 「핵심 문법」의 술어(`overchargeBp(aux0) > 0` = `aux0 ≥ 90`). */
function overcharged(player: Entity): boolean {
  return overchargeBp(player.aux0) > 0;
}

// ---------------------------------------------------------------------------
// 레벨 스케일 — 설계서 ② 의 공식 그대로
// ---------------------------------------------------------------------------
//
// ⚠️ 나눗셈이 낀 두 공식(BR6 쿨다운·BR8 주기)은 `skillDerived` 가 아니라 여기서 계산한다 —
// 사유는 `skills/striker.ts` 의 같은 주석이 정본이다(`world.ts` 런타임 import 또는 이중 정본
// 둘 중 하나가 되기 때문). BR6 은 빈사 피격 틱, BR8 은 `tick % 주기 === 0` 인 틱뿐이라
// sim 루프의 상시 나눗셈이 아니다.

/** BR6 내부 쿨다운 = 1200 + 43200/(Lv+11) 틱 (Lv1 = 4800, Lv20 ≈ 2594, 점근 1200). */
function backflowCooldownTicks(level: number): number {
  return 1200 + Math.floor(43200 / (level + 11));
}

/** BR8 회복 주기 = 20 + 1200/(Lv+14) 틱 (Lv1 = 100, Lv20 ≈ 55, 점근 20). */
function repairPeriodTicks(level: number): number {
  return 20 + Math.floor(1200 / (level + 14));
}

// ---------------------------------------------------------------------------
// 앵커 ③ — 젬 수거
// ---------------------------------------------------------------------------

/**
 * **BA3 정지 관측 사격** — 정지 중에 수거한 젬만 주무기 쿨다운을 환급한다.
 *
 * ⚠️ **하한 클램프가 계약이다.** 발사 carry 는 `(−FIRE_CD_Q, 0]` 유계라(설계서 1R 심각 5),
 * 무클램프 감산은 "다음 발사 1틱 앞당김"을 넘어 연사 폭주가 된다. 상한은 `-FIRE_CD_Q + 1` 이고
 * 초과분은 소실된다 — 설계서가 병행하라던 「틱당 총량 상한(젬 5개분)」은 이 클램프가 구조적으로
 * 흡수하므로 별도 카운터를 세우지 않았다(슬롯 1칸 절약 + 조용한 무연산 여지 제거).
 */
export function arccasterGemCollected(state: WorldState, player: Entity): void {
  const ba3 = lv(state, Sk.stillSpotter);
  if (ba3 < 1) return;
  // 정지 술어 = `aux0 > 0`(입력 기반 적립의 파생 — 설계서 「핵심 문법」).
  if (player.aux0 <= 0) return;
  const refund = (2 + Math.floor(ba3 / 2)) * FIRE_CD_Q;
  const floorQ = -FIRE_CD_Q + 1;
  const next = player.cooldown - refund;
  player.cooldown = next < floorQ ? floorQ : next;
}

// ---------------------------------------------------------------------------
// 앵커 ④ — 선체 hp 가 실제로 깎인 피격의 후속
// ---------------------------------------------------------------------------

/**
 * **BR2 피뢰 접지 · BR6 전하 역류 · BR7 완충 콘덴서 · BR10 최후 접지.**
 *
 * 넷의 발화 순서가 의미를 가진다:
 *  1. **BR2**(반격 연쇄)와 **BR7**(피해→충전)은 피격 사실만 본다.
 *  2. **BR6**(빈사 소각 회복)은 BR7 이 aux0 을 올린 **뒤**에 소각한다 — 같은 틱의 피격이
 *     만든 충전도 회복 재료가 된다(설계서 "얻어맞을수록 과충전"과 "충전을 생명으로"의 합).
 *  3. **BR10**(치명 생존)은 BR6 의 소각과 무관하게 aux0 을 상한까지 **다시 채운다** — 순서가
 *     반대면 상한 주입을 BR6 이 즉시 태워 버려 설계 의도("죽음 직전 일격이 만충 포대를 깨운다")가
 *     뒤집힌다.
 *
 * @param dmg 실제로 hp 에서 차감된 피해
 * @param lethalSurvived {@link import('../skillHooks.js').survivedLethalBlow} 의 결과 —
 *   **여기서 다시 계산하지 마라**(경감 전 피해는 사슬 중간의 지역 변수라 복원 불가).
 */
export function arccasterPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
): void {
  // ── BR2 피뢰 접지 — 반격 연쇄 15 + 4×Lv. 연쇄 부여 3종 중 피격축.
  const br2 = lv(state, Sk.lightningRod);
  if (br2 >= 1) {
    applyChain(state, player, 15 + 4 * br2);
  }

  // ── BR7 완충 콘덴서 — 깎인 피해를 aux0 으로 전환(600 클램프 유지).
  //    폭 k 가산이 90 을 건너뛰어도 CH4 는 **통과 판정**이라 발화한다(설계서 「핵심 문법」).
  const br7 = lv(state, Sk.bufferCondenser);
  if (br7 >= 1 && dmg > 0) {
    const gain = Math.round((dmg * (5000 + 500 * br7)) / 10000);
    if (gain > 0) {
      const t = player.aux0 + gain;
      player.aux0 = t >= OVERCHARGE_TICK_CAP ? OVERCHARGE_TICK_CAP : t;
    }
  }

  // ── BR6 전하 역류 — HP 30% 이하로 **떨어지는**(통과) 피격 틱에 aux0 전량 소각 → 즉시 회복.
  //    `===` 에지가 아니라 통과 판정이다: 폭 큰 피격이 30% 를 건너뛰어도 발화한다.
  const br6 = lv(state, Sk.chargeBackflow);
  if (br6 >= 1) {
    const cd = readSlot(state.skillCarry, ArccasterCarry.backflowCooldown);
    if (cd === 0 && player.hp > 0 && player.aux0 > 0) {
      // 임계는 정수 비교로 못 박는다(hp·maxHp 가 소수일 수 있어 부동소수 경계 흔들림 방지).
      const hpAfter = player.hp;
      const hpBefore = hpAfter + dmg;
      const gate10 = player.maxHp * 3; // = maxHp × 30% × 10 — 양변에 10 을 곱해 비교
      if (hpBefore * 10 > gate10 && hpAfter * 10 <= gate10) {
        const heal = Math.round((player.aux0 * (500 + 50 * br6)) / 10000);
        player.aux0 = 0;
        if (heal > 0) {
          const t = player.hp + heal;
          player.hp = t > player.maxHp ? player.maxHp : t;
        }
        writeSlot(state.skillCarry, ArccasterCarry.backflowCooldown, backflowCooldownTicks(br6));
      }
    }
  }

  // ── BR10 최후 접지 — 「죽을 뻔한 틱」에 aux0 상한 주입 + 무적 연장. **런당 1회.**
  //    억제 표식은 플레이어 `targetX` 다(폐기된 캡스톤이 쓰던 그 칸 — `skillHooks.ts` 의
  //    `survivedLethalBlow` 주석이 지정한 자리. 스킬 슬롯을 새로 잡지 않는다).
  const br10 = lv(state, Sk.terminalGround);
  if (br10 >= 1 && lethalSurvived && player.targetX === 0) {
    player.targetX = 1;
    player.aux0 = OVERCHARGE_TICK_CAP;
    player.iframes += 2 + Math.floor(br10 / 2);
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑧ — 감쇠 사슬의 스킬 슬롯 2칸
// ---------------------------------------------------------------------------

/**
 * **① 감소(BR3 위상 결합 · BR5 접지 케이블) → ② 흡수(BR4 잉여 전하 방벽).**
 *
 * 순서는 앵커 주석이 못 박은 그대로다(흡수가 먼저면 감소가 이미 깎아 낼 피해까지 흡수 자원이
 * 태워진다). 정수화는 전부 **게이트 안**이다 — 접촉 피해에는 엘리트 배율이 섞여 소수가 될 수
 * 있고, 반올림이 게이트 밖으로 나가면 스킬 없는 런의 소수 피해까지 바뀐다.
 */
export function arccasterDamageChain(state: WorldState, player: Entity, dmg: number): number {
  let out = dmg;

  // ① 감소 A — BR3: 방벽 액티브(buff) 지속 중. 15% + 1%p/Lv.
  const br3 = lv(state, Sk.phaseCoupling);
  if (br3 >= 1 && (state.activeBuff0 > 0 || state.activeBuff1 > 0)) {
    out -= Math.round((out * (1500 + 100 * br3)) / 10000);
  }
  // ① 감소 B — BR5: 벽 접촉 **×** 정지 이중 조건. 12% + 1.2%p/Lv.
  //    스트라이커 S4 와 같은 벽 훅이지만 `aux0 > 0`(정지) 이 이 기체만의 결속 변형이다.
  const br5 = lv(state, Sk.groundTether);
  if (br5 >= 1 && state.wallContactTicks > 0 && player.aux0 > 0) {
    out -= Math.round((out * (1200 + 120 * br5)) / 10000);
  }
  // ② 흡수 — BR4: 적립분이 HP 보다 먼저 소모된다. 적립은 앵커 ⑨ 가 한다.
  const br4 = lv(state, Sk.surplusShield);
  if (br4 >= 1 && out > 0) {
    const stored = readSlot(state.skillStage, ArccasterStage.surplusStore);
    if (stored > 0) {
      const used = stored < out ? stored : Math.ceil(out);
      writeSlot(state.skillStage, ArccasterStage.surplusStore, stored - used);
      out -= used;
      if (out < 0) out = 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 앵커 ⑨ — 시그니처 틱 진행(매 틱 정확히 한 번)
// ---------------------------------------------------------------------------

/**
 * **CH4 진입 뇌격 · BR1 정전 척력장 · BR4 적립 · BR6 쿨다운 · BR8 정지 수복 · BR9 척력 외피.**
 *
 * ## ⚠️ CH4 통과 판정은 이 앵커에서 **한 틱 늦게** 잡힌다 — 유실은 없다
 * 설계서 CH4 는 "틱 안의 모든 aux0 갱신 경로가 끝난 단일 지점"을 요구했다. 이 앵커는
 * `stepShipSignature` **진입점**이라 이번 틱의 적립보다 앞이다. 그래서 여기서 비교하는 것은
 * **직전 틱이 끝난 시점의 aux0** 이고, 직전 틱의 모든 경로(시그니처 적립 · 액티브 핸들러의
 * 90/190 주입 · 피격 후속 BR7 전환 · BR10 상한 주입)가 전부 반영된 값이다. 즉 **어떤 통과도
 * 유실되지 않고 발화만 1틱 늦다.** 설계서가 막으려던 "지역 변수 스냅샷이 함수 밖 주입을
 * 유실한다"는 실패는 구조적으로 일어나지 않는다.
 *
 * 스냅샷 슬롯은 `Stage` 다 — 의뢰 구간이 바뀌면 월드가 새로 서고 aux0 도 0 이라 직전 값을
 * 넘길 이유가 없다(넘기면 새 구간 첫 틱에 유령 통과가 뜬다).
 */
export function arccasterSignatureStep(state: WorldState, player: Entity): void {
  // ── CH4 진입 뇌격 — 「이전 < 90 && 현재 ≥ 90」 통과 판정 후 스냅샷 갱신(한 지점에서 함께).
  const ch4 = lv(state, Sk.entryLance);
  if (ch4 >= 1) {
    const seen = readSlot(state.skillStage, ArccasterStage.entryAux0Seen);
    const cur = player.aux0;
    if (seen < OVERCHARGE_STILL_TICKS && cur >= OVERCHARGE_STILL_TICKS) {
      fanStrike(
        state,
        player,
        1,
        30 + 6 * ch4,
        0,
        { x: Math.cos(player.angle), y: Math.sin(player.angle) },
        { pierce: 3 + Math.floor(ch4 / 5) },
      );
    }
    writeSlot(state.skillStage, ArccasterStage.entryAux0Seen, cur);
  }

  // ── BR4 잉여 전하 방벽 — 상한 초과 구간(aux0 ≥ 190)의 정지 틱을 흡수량으로 적립.
  //    aux0 이 600 에 고정돼도 "≥190 인 매 틱" 술어라 적립이 계속된다(600 고정의 수혜 스킬).
  const br4 = lv(state, Sk.surplusShield);
  if (br4 >= 1 && player.aux0 >= OVERCHARGE_APEX_TICKS) {
    const cap = 20 + 4 * br4;
    const stored = readSlot(state.skillStage, ArccasterStage.surplusStore);
    if (stored < cap) writeSlot(state.skillStage, ArccasterStage.surplusStore, stored + 1);
  }

  // ── BR6 내부 쿨다운 감소. 발동은 앵커 ④ 에 있다.
  const br6 = lv(state, Sk.chargeBackflow);
  if (br6 >= 1) {
    const cd = readSlot(state.skillCarry, ArccasterCarry.backflowCooldown);
    if (cd > 0) writeSlot(state.skillCarry, ArccasterCarry.backflowCooldown, cd - 1);
  }

  // ── BR1 정전 척력장 — 과충전 중 45틱마다 척력 펄스.
  //    주기는 **`state.tick % 45`** 다(`aux0 % 45` 는 600 고정에서 영구 침묵 — 설계서 1R 심각 1).
  //    넉백 규율(7.1): 속도 대입이 아니라 **좌표 직접 변위**.
  const br1 = lv(state, Sk.staticRepulsor);
  if (br1 >= 1 && state.tick % 45 === 0 && overcharged(player)) {
    const radius = 140 + 8 * br1;
    const r2 = radius * radius;
    const push = 20 + 3 * br1;
    for (const e of state.entities) {
      if (e.kind !== 'enemy' || e.dead) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 === 0) continue;
      const d = Math.sqrt(d2);
      e.x += (dx / d) * push;
      e.y += (dy / d) * push;
    }
  }

  // ── BR8 정지 수복 회로 — 과충전 유지 중 주기마다 HP 1(maxHp 클램프).
  const br8 = lv(state, Sk.stillRepair);
  if (br8 >= 1 && overcharged(player) && player.hp > 0 && player.hp < player.maxHp) {
    if (state.tick % repairPeriodTicks(br8) === 0) player.hp += 1;
  }

  // ── BR9 척력 외피 — 무적프레임 동안 몸 주변 적탄 소거. 반경 32 + 4×Lv.
  const br9 = lv(state, Sk.repulseHull);
  if (br9 >= 1 && player.iframes > 0) {
    clearEnemyBullets(state, player, 32 + 4 * br9);
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑩ — 적성 표적이 아군탄에 맞아 피해가 확정된 직후
// ---------------------------------------------------------------------------

/**
 * **CH6 과잉 전하 이월** — 처치하고 남은 초과 피해가 탄에 다시 실려 다음 관통 대상에 전달된다.
 *
 * 이 앵커는 `t.hp -= dealt` 와 격추 판정이 **끝난 직후**라, 넘어온 `target.hp` 의 음수부가 곧
 * 초과 피해다 — 초과분을 따로 계산하려고 피해 산식을 여기서 다시 적으면 두 판정이 갈린다.
 *
 * ⚠️ **`target.hp`/`target.dead` 를 되돌리지 않는다.** 이 스킬이 만지는 것은 **가해 탄**의
 * `damage` 뿐이고, 그 필드는 이미 해시되므로 신규 상태 0칸이다(설계서 태그 A).
 *
 * 게이트가 `kind === 'enemy'` 인 것은 설계서 ④ 표 그대로다 — 침공 구조물·코어·보스는 이월
 * 수혜·발원 모두 정의상 제외.
 */
export function arccasterEnemyDamaged(
  state: WorldState,
  target: Entity,
  source: Entity | undefined,
): void {
  const ch6 = lv(state, Sk.overkillCarry);
  if (ch6 < 1) return;
  if (source === undefined) return;
  if (target.kind !== 'enemy' || target.hp > 0) return;
  const overkill = -target.hp;
  if (overkill <= 0) return;
  // 이월 비율 = 40% + 3%p/Lv (Lv20 = 100%). 반올림은 게이트 안이다.
  const carried = Math.round((overkill * (4000 + 300 * ch6)) / 10000);
  if (carried > 0) source.damage += carried;
}
