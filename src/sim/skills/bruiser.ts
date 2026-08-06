/**
 * **브루저 30스킬의 효과 본체**(ADR-0049 배치 2 · 설계 정본
 * `.omc/plans/skill-rebuild-2026-08-05/bruiser.md` 확정 후보 3판).
 *
 * 형태는 `skills/striker.ts` 가 확립한 다섯 규율을 그대로 따른다 — 형태를 바꾸려면 그 파일부터
 * 고치고 여기를 함께 옮겨라.
 *  ① `world.ts` 런타임 import 0건(`WorldState`/`Entity` 는 type-only)
 *  ② 모든 쓰기는 `skillLv(...) >= 1` 게이트 안쪽 — `skillsOn` 은 "한 스킬이라도 찍었나" 라서
 *     **다른 스킬만 찍은 런**을 못 걸러 준다
 *  ③ 반올림·정수화는 게이트 **안**에서만(게이트 밖이면 스킬 없는 런의 소수 피해까지 바뀐다)
 *  ④ RNG 0 소비
 *  ⑤ 슬롯 접근은 `readSlot`/`writeSlot` 만
 *
 * ---
 *
 * ## ⚠️ 지금 배선된 것은 30종 중 13종이다
 * 1차 배선이 11종(앵커 ②③④⑧⑨⑩⑪), S2 의 앵커 ⑯(볼리 파라미터)이 **BL3·BL6** 둘을 더
 * 열었다. 나머지 17종은 아직 앵커가 없는 지점(액티브 핸들러·접촉 피격 판별 루프·감쇠 분기·
 * 젬 스폰·벽 파괴 집계·이동 배율·표적 거리)을 요구한다. 여기 없는 스킬은 "구현했는데 안
 * 불린다"가 아니라 **아직 코드가 없다** — 반쪽 배선과 구분하라. 사유는 레인 보고서에 있다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { VolleyParams } from '../skillHooks.js';
import { fanStrike, clearEnemyBullets } from '../activeTypes.js';
import { isElite } from '../elite.js';
import { cos, sin } from '../math.js';
import { readSlot, writeSlot, BruiserCarry, BruiserStage } from '../skillSlots.js';
import { ARMOR_MAX_STACKS, clampArmorStacks } from '../shipSignature.js';
import { skillLv } from '../../items/skills.js';

// ---------------------------------------------------------------------------
// flat 인덱스 — `data/ships/bruiser.ts` 의 `trees` 배열이 정본
// ---------------------------------------------------------------------------
//
// `trees: [blade(offense), morph(utility), fortify(defense)]` 이므로
// BL1..BL10 = 0..9 · MO1..MO10 = 10..19 · FO1..FO10 = 20..29 다.
//
// ⚠️ **스트라이커와 축 종류의 순서가 다르다.** 스트라이커는 축1=defense·축2=utility 이고
// `tests/skillIcons.test.ts` 가 그 배치를 못 박고 있지만, 그 단언은 **스트라이커 전용**이다
// (테스트 주석이 "스트라이커 축0 = firepower(offense)…" 로 스스로 범위를 적어 두었다).
// 브루저는 축1=utility(morph)·축2=defense(fortify) 라 `nodes[10]` 이 utility 다.
// 설계서가 blade→morph→fortify 순으로 서술하는 것과 데이터가 일치하므로 flat 은 서술 순서와
// 같지만, **그 일치는 우연이 아니라 데이터 확인의 결과**다.

const enum Sk {
  /** BL2 백병 격발 */ pointBlank = 1,
  /** BL3 만재 중탄 */ fullPlateSlug = 2,
  /** BL4 과적 배출 */ overflowVent = 3,
  /** BL6 중량 탄자 */ massSlug = 5,
  /** BL9 중압 리듬 */ crushCadence = 8,
  /** MO1 충각 적재 */ dashLoading = 10,
  /** MO6 압쇄장 */ crushField = 15,
  /** MO8 벽 되튐 */ wallRebound = 17,
  /** MO9 수확 고정 */ harvestClamp = 18,
  /** FO1 과적 장갑 */ overPlating = 20,
  /** FO2 응혈 장갑 */ clotPlating = 21,
  /** FO5 불괴 연쇄 */ unbreakableChain = 24,
  /** FO6 하중 전이 */ loadTransfer = 25,
  /** FO7 전리 개장 */ trophyRefit = 26,
}

/**
 * 이 런에서 그 스킬의 **실효 레벨**(투자 + 축 어픽스). 미투자면 0 이다(`skillLv` 정본 1).
 * 기체 게이트는 호출부(`skillHooks.ts` 의 `case SIG_BRUISER_ARMOR`)가 이미 걸었다.
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
// 레벨 스케일 — 설계서 ② 의 공식 그대로
// ---------------------------------------------------------------------------
//
// 나눗셈이 낀 공식(FO1·FO7·MO8)을 `createWorld` 가 아니라 여기서 계산하는 근거는 스트라이커
// 파일의 같은 자리 주석과 동일하다(순환 import 또는 이중 정본 중 하나를 사는 것보다 낫고,
// 호출 빈도가 낮은 이벤트 경로이거나 상수 확정 1회다).

/** FO1: round(1 + 3×Lv/(Lv+12)) — Lv1 = +1, Lv20 ≈ +3, 점근 +4. */
function overPlatingBonus(level: number): number {
  return Math.round(1 + (3 * level) / (level + 12));
}

/** FO7: round(1 + 6×Lv/(Lv+14)) HP/스택 — Lv1 = 1, Lv20 ≈ 5, 점근 7. */
function trophyHpPerStack(level: number): number {
  return Math.round(1 + (6 * level) / (level + 14));
}

/** MO8: 환급 비율 bp = 3000 + round(2000×Lv/(Lv+10)) — Lv20 ≈ 4333bp, 점근 5000bp. */
function reboundRefundBp(level: number): number {
  return 3000 + Math.round((2000 * level) / (level + 10));
}

/**
 * BL9: **N = max(1, round(48/(4+스택)))** — 스택 0 = 12, 만재 8 = 4.
 *
 * ⚠️ `max(1, ·)` 하한은 장식이 아니다. 곡선 자체는 스택 93 이상에서 round 가 0 이 되고, 그러면
 * 아래 `count >= n` 이 매 명중마다 참이 되는 것을 넘어 **주기 개념이 통째로 사라진다**.
 * 지금의 FO1 확장(점근 +4)으로는 스택 ≤ 12 라 도달하지 않지만, 장래에 다른 상한 확장이
 * 생기면 조용히 무너지는 자리라 배선에 하한을 포함한다(설계서 R-2).
 */
function cadencePeriod(stacks: number): number {
  const n = Math.round(48 / (4 + stacks));
  return n >= 1 ? n : 1;
}

/** FO2 정산 회복 비율(고정 60% — 잔여 40% 소멸, 완전 환급 금지). */
const CLOT_SETTLE_BP = 6000;
/** FO6 전이 대가 — 경감이 발동한 피격당 대시 쿨다운 가산(틱, 고정). */
const LOAD_TRANSFER_DASH_TICKS = 20;
/** MO6 압쇄장 주기(틱, 고정). */
const CRUSH_FIELD_PERIOD = 30;
/** MO6 압쇄장이 적을 밀어내는 1회 변위(sim 좌표, 고정 — "소량 밀림"). */
const CRUSH_FIELD_PUSH = 6;
/** FO7 런당 누적 가산 상한 = 런 시작 최대 HP 의 이 비율(bp). */
const TROPHY_RUN_CAP_BP = 5000;

/**
 * BL2 근접 임계(sim 좌표). **레벨과 무관하게 고정**이다(설계 ② BL2 "임계 350 고정") — 레벨은
 * 피해 배율만 키운다. 임계를 레벨 스케일로 바꾸면 "붙을수록 강해진다" 가 "레벨이 높을수록
 * 멀리서도 붙은 것으로 친다" 로 뒤집힌다.
 */
const POINT_BLANK_RANGE = 350;

// ---------------------------------------------------------------------------
// 탄 표식 — 앵커 ⑯ 이 찍고 앵커 ⑩ 이 읽는다(`VolleyParams.mark` → 탄 `aux0`)
// ---------------------------------------------------------------------------
//
// ⚠️ **값 `1` 은 정조준탄(스트라이커)이 점유했다.** 기체는 한 런에 하나뿐이라 물리적으로
// 겹치지 않지만, 값이 겹치면 렌더·후속 판정이 두 표식을 구분하지 못한다(앵커 ⑯ 주석).
// 브루저는 **비트 플래그**로 나눠 쓴다 — BL3 과 BL6 은 같은 볼리에 **동시에** 걸릴 수 있어
// 배타적 정수로는 한쪽이 다른 쪽을 조용히 지운다. `|=` 로 얹고 `&` 로 읽는다.
/** BL3 만재 중탄 — 이 탄은 명중 지점에 소형 폭발을 남긴다. */
const MARK_FULL_PLATE = 2;
/** BL6 중량 탄자 — 이 탄은 명중한 적을 진행 방향으로 밀어낸다. */
const MARK_MASS_SLUG = 4;

// ---------------------------------------------------------------------------
// 앵커별 진입점 — `skillHooks.ts` 의 `case SIG_BRUISER_ARMOR:` 가 부른다
// ---------------------------------------------------------------------------

/**
 * 앵커 ② **대시 발동** — MO1 충각 적재 · MO8 벽 되튐.
 *
 * 두 스킬 다 이 앵커가 `player.dashCooldown` 대입(`world.ts` 2211/2214) **뒤**(2230)라는 점에
 * 의존한다. MO8 의 환급은 방금 세워진 쿨다운을 깎는 것이라, 앵커가 대입보다 앞으로 옮겨지면
 * 환급이 그대로 덮어써져 **조용히 무연산**이 된다.
 */
export function bruiserDashFired(state: WorldState, player: Entity): void {
  // MO1 — 대시 = 스택 +1 + 감쇠 타이머 리셋. "맞지 않고도 쌓는" 유일한 무피격 적립로.
  // ⚠️ 설계서의 레벨 스케일(대시 직후 이속 창 +10%)은 여기서 못 한다 — 이동 배율은 `stepPlayer`
  //    소유라 이 앵커에서 닿지 않는다. **레벨은 지금 게이트로만 작동한다**(레인 보고서 참조).
  const mo1 = lv(state, Sk.dashLoading);
  if (mo1 >= 1) {
    player.aux0 = clampArmorStacks(player.aux0 + 1, state.armorMaxStacks);
    player.aux1 = 0;
  }
  // MO8 — 직전 틱 벽 접촉이면 대시 쿨다운 일부를 즉시 환급.
  // 술어는 S0 의 E5 가 세운 `state.wallContactTicks` 를 그대로 읽는다(설계서는 "스트라이커 M5 가
  // 신설하는 플래그" 라고 적었으나 그 플래그는 이미 엔진 상태다 — 슬롯에 복제하면 갱신 시점이
  // 갈려 조용히 어긋난다). 대시 분기는 벽 슬라이드보다 앞이라 이 값은 이전 틱 갱신분이고,
  // 그것이 정확히 설계서가 요구한 "직전 틱" 이다.
  const mo8 = lv(state, Sk.wallRebound);
  if (mo8 >= 1 && state.wallContactTicks > 0 && player.dashCooldown > 0) {
    const back = Math.round((player.dashCooldown * reboundRefundBp(mo8)) / 10000);
    player.dashCooldown = Math.max(0, player.dashCooldown - back);
  }
}

/**
 * 앵커 ③ **젬 수거** — MO9 수확 고정.
 *
 * ⚠️ `Math.max(0, ·)` 클램프가 필수다. `aux1` 이 음수로 내려가면 감쇠 판정(`aux1 >= 180`)까지의
 * 거리가 규약 밖으로 늘어나고, u32 폴드에서 음수가 조용히 거대값이 된다.
 */
export function bruiserGemCollected(state: WorldState, player: Entity): void {
  const mo9 = lv(state, Sk.harvestClamp);
  if (mo9 < 1) return;
  player.aux1 = Math.max(0, player.aux1 - (6 + 2 * mo9));
}

/**
 * 앵커 ④ **선체 hp 가 깎인 피격의 후속** — BL4 과적 배출 · FO2 적립 · FO5 불괴 연쇄.
 *
 * ## 이 앵커에 도달한 시점의 상태(world.ts 4317-4371 실측)
 *  - 장갑 적립이 **이미 끝났다**: `aux0` 은 1 증가(상한 클램프)했고 `aux1 = 0` 이다.
 *  - `dmg` 는 감쇠 사슬을 전부 통과해 hp 에서 실제로 깎인 값이다.
 *  - `lethalSurvived` 는 사슬 안에서 한 번 계산된 값이다 — **다시 계산하지 마라**(경감 전
 *    피해가 사슬 중간의 지역 변수라 복원이 원리적으로 불가능하다).
 */
export function bruiserPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
): void {
  // --- BL4 과적 배출 -------------------------------------------------------
  // ⚠️ **설계와 어긋나는 지점(레인 보고서에 적었다).** 설계서는 "만재 **상태에서** 실피격" 을
  //    요구하는데, 이 앵커는 적립 **뒤**라 `aux0` 이 이미 상한에 붙어 있다. 즉 적립 직전이
  //    상한이었는지(진짜 잉여) 상한−1 이었는지(이번 피격으로 막 찬 것)를 여기서 구분할 수
  //    없다 — 현재 배선은 **후자에서도 발동**한다(한 칸 넓다). 정확히 하려면 적립 직전 값을
  //    사슬 안에서 넘겨받아야 하고 그것은 앵커 시그니처 변경이라 이 레인 밖이다.
  const bl4 = lv(state, Sk.overflowVent);
  if (bl4 >= 1 && player.aux0 >= state.armorMaxStacks) {
    // 파편 수 = 4 + ceil(Lv/3) · 파편 피해 8 + 2×Lv. 둘 다 게이트 안의 양적 계단이다.
    const count = 4 + Math.ceil(bl4 / 3);
    const dealt = 8 + 2 * bl4;
    // "전방" = +X. 이 게임의 전진 축이고(무대 앵커 +X), 플레이어 엔티티에는 유지되는 조준
    // 벡터가 없어 여기서 자동 조준을 다시 풀 수 없다(`nearestTarget` 은 world.ts 소유).
    fanStrike(state, player, count, dealt, 60, { x: 1, y: 0 });
  }

  // --- FO2 응혈 장갑(적립분) ----------------------------------------------
  // 정산은 앵커 ⑨ 의 만재 상승 엣지다 — 여기서는 풀에 쌓기만 한다.
  // 적립 기준은 **사슬을 전부 통과한 실제 감소분**(`dmg`)이라, 장갑 투자가 늘수록 적립도 준다.
  const fo2 = lv(state, Sk.clotPlating);
  if (fo2 >= 1 && dmg > 0) {
    const add = Math.round((dmg * (2000 + 100 * fo2)) / 10000);
    if (add > 0) {
      writeSlot(
        state.skillCarry,
        BruiserCarry.clotPool,
        readSlot(state.skillCarry, BruiserCarry.clotPool) + add,
      );
    }
  }

  // --- FO5 불괴 연쇄 -------------------------------------------------------
  // 트리거는 폐기된 캡스톤이 아니라 **「죽을 뻔한 틱」**(`survivedLethalBlow`)이다.
  // ⚠️ **「런당 1회」 억제가 이 스킬의 절반이다.** 캡스톤이 제공하던 억제라, 트리거만 옮기면
  //    죽을 뻔할 때마다 발동해 설계 의도보다 훨씬 강해진다. 표식은 플레이어 `targetX` —
  //    캡스톤이 쓰던 바로 그 칸이고 sim 쓰기가 여기 말고 0건이며, 이미 `ENTITY_CARRY` 에 있어
  //    의뢰 다구간에서도 "런당 1회" 가 정확히 성립한다. 슬롯을 새로 잡지 마라.
  const fo5 = lv(state, Sk.unbreakableChain);
  if (fo5 >= 1 && lethalSurvived && player.targetX === 0) {
    player.targetX = 1;
    player.aux0 = state.armorMaxStacks;
    player.aux1 = 0;
    clearEnemyBullets(state, player, 150 + 10 * fo5);
  }
}

/**
 * 앵커 ⑧ **감쇠 사슬의 스킬 슬롯** — FO6 하중 전이.
 *
 * ⚠️ 설계서가 지정한 자리는 "브루저 장갑 **뒤**" 인데 이 앵커는 장갑 **앞**이다. 앵커 ⑧ 이
 * 사슬에 뚫린 유일한 스킬 자리라 여기 말고 둘 곳이 없다 — 그래서 전이량은 장갑이 깎기 **전**
 * 피해를 기준으로 잡힌다(설계 의도는 장갑 투자가 전이 대가의 빈도까지 줄이는 것이었다).
 * 순서를 바로잡으려면 사슬에 슬롯을 하나 더 뚫어야 하고 그것은 이 레인 밖이다(보고서 참조).
 */
export function bruiserDamageChain(state: WorldState, player: Entity, dmg: number): number {
  let out = dmg;
  // FO6 — 받는 피해 일부를 대시 쿨다운으로 전이한다(전이량만큼 경감).
  const fo6 = lv(state, Sk.loadTransfer);
  if (fo6 >= 1 && out > 0) {
    // 경감 8% + 0.8%p/Lv. 반올림은 이 게이트 **안**이다(규율 ③ — 접촉 피해에는 엘리트 배율이
    // 섞여 소수가 될 수 있고, 반올림이 밖으로 나가면 스킬 없는 런의 해시가 통째로 갈린다).
    const cut = Math.round((out * (800 + 80 * fo6)) / 10000);
    if (cut > 0) {
      out -= cut;
      if (out < 0) out = 0;
      player.dashCooldown += LOAD_TRANSFER_DASH_TICKS;
    }
  }
  return out;
}

/**
 * 앵커 ⑨ **시그니처 틱 진행**(매 틱 정확히 한 번) — FO1 · FO2 정산 · FO7 기준선 · MO6.
 *
 * ## 이 앵커는 `stepShipSignature` 진입점이다
 * `world.ts` 실측 순서는 `stepPlayer`(1813) → `stepShipSignature`(1859, 이 앵커가 2409) →
 * `resolveCollisions`(1905) 다. 그래서 여기서 세운 값은 **이번 틱의 감쇠 분기(2410)와 이번 틱의
 * 피격 처리 양쪽에 모두 반영된다** — FO1 이 상한을 여기서 세워도 한 틱 늦지 않는다.
 */
export function bruiserSignatureStep(state: WorldState, player: Entity): void {
  // --- FO1 과적 장갑 -------------------------------------------------------
  // ⚠️ **설계와 어긋나는 지점.** 설계서(⑥-3)는 상한을 `createWorld` 가 config 에서 한 번
  //    확정하는 파생값으로 두라고 적었고 `commissionCarry.ts` 도 그 전제로 재파생 목록에
  //    `armorMaxStacks` 를 올려 뒀다. 이 레인의 계약은 "앵커의 `case` 한 줄"이라 `createWorld`
  //    를 만지지 않았고, 대신 **매 틱 같은 값을 다시 세운다**(멱등). 관측 차이는 하나뿐이다 —
  //    첫 `stepShipSignature` 이전(런 생성 직후 UI 표시 등)에는 기본 상한 8 로 보인다.
  //    리드가 `createWorld` 로 옮기기로 하면 이 블록을 통째로 그리로 옮겨라.
  const fo1 = lv(state, Sk.overPlating);
  if (fo1 >= 1) {
    state.armorMaxStacks = ARMOR_MAX_STACKS + overPlatingBonus(fo1);
  }

  // --- FO2 응혈 장갑(정산) -------------------------------------------------
  // 트리거는 레벨 술어(`aux0 == 상한`)가 **아니라** 상승 엣지다. fortify 액티브의 SUSTAIN 이
  // 매 틱 만재를 재설정하므로 레벨 술어면 매 틱 정산이 된다.
  // 판정은 "틱 말미 스냅샷 비교" 대신 **매 틱 같은 자리에서 직전 관측값과 비교**한다 — 표본
  // 시점이 한 틱 어긋날 뿐 사건 열은 같고, blade_hi(같은 틱에 만재 후 즉시 0 소각)가 엣지로
  // 안 잡히는 것도 그대로 성립한다(그 틱들 사이에 만재를 관측하는 순간이 없다).
  const fo2 = lv(state, Sk.clotPlating);
  if (fo2 >= 1) {
    const cap = state.armorMaxStacks;
    const cur = clampArmorStacks(player.aux0, cap);
    const prev = readSlot(state.skillStage, BruiserStage.prevArmorStacks);
    if (prev < cap && cur >= cap) {
      const pool = readSlot(state.skillCarry, BruiserCarry.clotPool);
      if (pool > 0) {
        const heal = Math.round((pool * CLOT_SETTLE_BP) / 10000);
        if (heal > 0) {
          player.hp = Math.min(player.maxHp, player.hp + heal);
        }
        // 잔여 40% 는 소멸한다 — 완전 환급 금지가 이 스킬의 대가다.
        writeSlot(state.skillCarry, BruiserCarry.clotPool, 0);
      }
    }
    writeSlot(state.skillStage, BruiserStage.prevArmorStacks, cur);
  }

  // --- FO7 전리 개장(런 시작 기준선) ---------------------------------------
  // 누적 상한(런 시작 최대 HP 의 50%)의 기준선을 첫 틱에 잡는다. "런 시작 maxHp 스냅샷 대비
  // 차분" 으로 누적을 역산하는 대안은 성립하지 않는다 — `reinforced-hull`·`sv-plating` 등
  // 파워업이 같은 `maxHp` 를 런 중 수시로 가산해 FO7 몫만 분리할 방법이 없다(설계서 R-6).
  // 0 = 아직 관측 없음(값 규약 1). `maxHp` 는 항상 양수라 자연 센티넬이다.
  const fo7 = lv(state, Sk.trophyRefit);
  if (fo7 >= 1 && readSlot(state.skillCarry, BruiserCarry.trophyBaseHp) === 0) {
    writeSlot(state.skillCarry, BruiserCarry.trophyBaseHp, player.maxHp);
  }

  // --- MO6 압쇄장 -----------------------------------------------------------
  // 스택이 1개 이상인 동안 주기적으로 근접 반경 내 적을 갈아낸다.
  const mo6 = lv(state, Sk.crushField);
  if (mo6 >= 1 && player.aux0 > 0 && state.tick % CRUSH_FIELD_PERIOD === 0) {
    const radius = 120 + 8 * mo6;
    const dealt = 4 + mo6;
    const r2 = radius * radius;
    // ⚠️ `blastDamage` 를 쓰지 않는 이유: 그 헬퍼는 `enemy`+`boss` 를 함께 때리는데 설계서는
    //    **enemy kind 한정**(보스·코어·포탑·guardian·defenseBoss·facility·prop 제외)을 명시했다.
    //    밀어내기도 그 헬퍼에 없다. 기하를 다시 적는 대가를 아는 채로 좁힌 것이다.
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'enemy') continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      e.hp -= dealt;
      // 넉백 규율(7.1) — 속도 대입이 아니라 **좌표 직접 변위**다. 적 속도는 이동 컴포넌트가
      // 매 틱 덮어쓰므로 속도에 실으면 화면에는 아무 일도 안 일어나고 해시만 갈린다.
      if (d2 > 0) {
        const d = Math.sqrt(d2);
        e.x += (dx / d) * CRUSH_FIELD_PUSH;
        e.y += (dy / d) * CRUSH_FIELD_PUSH;
      }
    }
  }
}

/**
 * 앵커 ⑩ **아군탄 명중으로 적 hp 가 깎인 직후** — BL9 중압 리듬.
 *
 * ⚠️ **덮는 범위는 아군탄 명중 경로 하나뿐**이다. 화염 DoT·전격 연쇄·폭탄 기물·액티브 폭발·
 * 조우 격실 탄은 leaf 에서 적 hp 를 깎아 이 앵커에 오지 않는다 — BL9 의 "명중" 은 그래서
 * 주무기·파생탄 명중만 센다.
 *
 * `target.hp` 를 더 깎는 것은 되돌리기가 아니라 **추가 피해**다. `compact` 의 처치 게이트가
 * `hp <= 0` 이라 이 감산으로 넘어간 적은 같은 틱에 정상 격추된다(부활 판정은 이 앵커 앞에서
 * 이미 해소됐다).
 */
export function bruiserEnemyDamaged(
  state: WorldState,
  player: Entity,
  target: Entity,
  dmg: number,
  source: Entity | undefined,
): void {
  // --- BL3 만재 중탄(명중 지점 폭발) ---------------------------------------
  // 트리거는 **탄에 찍힌 표식**이지 지금의 만재 여부가 아니다 — "만재일 때 **발사된** 탄"이
  // 설계 본체라, 비행 중에 스택이 빠져도 이미 나간 중탄은 중탄이다(앵커 ⑯ 에서 찍는다).
  const bl3 = lv(state, Sk.fullPlateSlug);
  if (bl3 >= 1 && source !== undefined && (source.aux0 & MARK_FULL_PLATE) !== 0) {
    // 폭발 반경 50 + 5×Lv · 폭발 피해 = 탄 피해의 25% + 1.5%p/Lv. 반올림은 게이트 안이다.
    const blast = Math.round((source.damage * (2500 + 150 * bl3)) / 10000);
    if (blast > 0) {
      const radius = 50 + 5 * bl3;
      const r2 = radius * radius;
      // ⚠️ `blastDamage` 를 못 쓴다 — 그 헬퍼는 **플레이어**를 중심으로 삼는데 설계서는 "명중
      //    지점" 을 명시했다. 대상 범위(enemy+boss)는 그 헬퍼와 같게 맞춘다.
      // ⚠️ **맞은 표적 자신은 제외한다.** 넣으면 이 스킬이 "단일 표적 피해 +25%" 로 퇴화해
      //    광역이라는 본체가 사라진다.
      for (const e of state.entities) {
        if (e.dead || e === target) continue;
        if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        if (dx * dx + dy * dy <= r2) e.hp -= blast;
      }
    }
  }

  // --- BL6 중량 탄자(명중 변위) --------------------------------------------
  const bl6 = lv(state, Sk.massSlug);
  if (bl6 >= 1 && source !== undefined && (source.aux0 & MARK_MASS_SLUG) !== 0) {
    // 변위 16 + 2×Lv, 보스·엘리트는 반감. 넉백 규율(7.1) — 속도 대입이 아니라 **좌표 직접
    // 변위**다(적 이동 컴포넌트가 매 틱 속도를 덮어써 속도에 실으면 해시만 갈린다).
    let push = 16 + 2 * bl6;
    if (target.kind === 'boss' || isElite(target)) push *= 0.5;
    // 방향은 **탄의 진행 방향**이다. 플레이어 기준으로 잡으면 관통탄이 뒤쪽 표적을 플레이어
    // 쪽으로 당겨 "밀어낸다" 가 부호 반전된다.
    target.x += cos(source.angle) * push;
    target.y += sin(source.angle) * push;
  }

  const bl9 = lv(state, Sk.crushCadence);
  if (bl9 < 1) return;
  // 코어 실드가 전량 흡수한 명중은 `dmg === 0` 으로도 온다 — "맞았다"가 아니라 "깎였다"를 센다.
  if (dmg <= 0) return;
  const count = readSlot(state.skillStage, BruiserStage.cadenceHits) + 1;
  // 주기는 **현재 장갑 스택으로 매 명중마다 재계산**한다(스택이 많을수록 짧아지는 것이 본체다).
  const stacks = clampArmorStacks(player.aux0, state.armorMaxStacks);
  const n = cadencePeriod(stacks);
  if (count >= n) {
    // 강타 = 이번 명중 피해의 +80% + 4%p/Lv. 반올림은 게이트 안이다.
    const bonus = Math.round((dmg * (8000 + 400 * bl9)) / 10000);
    if (bonus > 0) target.hp -= bonus;
    writeSlot(state.skillStage, BruiserStage.cadenceHits, 0);
  } else {
    writeSlot(state.skillStage, BruiserStage.cadenceHits, count);
  }
}

/**
 * 앵커 ⑪ **잡몹 하나가 실제로 격추된 사건** — FO7 전리 개장.
 *
 * ⚠️ **보스 격파는 이 앵커에 오지 않는다**(`compact` 의 보스/코어 분기는 `state.kills` 를 올리지
 * 않는다). 설계서 FO7 은 "엘리트·**보스**" 를 대상으로 적었으므로 **현재 배선은 엘리트 절반만
 * 덮는다** — 보스 절반은 별도 앵커가 뚫려야 한다(보고서 참조).
 *
 * 순서는 설계서가 못 박은 대로 **①격파 당시 스택 읽기 → ②maxHp 가산 → ③만재 세팅** 이다.
 * 만재를 먼저 세우면 가산 기준이 항상 상한이 되어 "만재를 유지한 채 격파하라" 는 선택압이 죽는다.
 */
export function bruiserEnemyDeath(state: WorldState, player: Entity, elite: boolean): void {
  const fo7 = lv(state, Sk.trophyRefit);
  if (fo7 < 1 || !elite) return;
  // ① 격파 당시 스택
  const stacks = clampArmorStacks(player.aux0, state.armorMaxStacks);
  if (stacks > 0) {
    let gain = stacks * trophyHpPerStack(fo7);
    // 런당 누적 상한 — 기본 최대 HP(런 시작값)의 50%. 초과분은 버린다(장기 런 폭주 방지).
    const base = readSlot(state.skillCarry, BruiserCarry.trophyBaseHp);
    const granted = readSlot(state.skillCarry, BruiserCarry.trophyGranted);
    const room = Math.round((base * TROPHY_RUN_CAP_BP) / 10000) - granted;
    if (gain > room) gain = room;
    if (gain > 0) {
      // ② maxHp 가산 — 경로 자체는 파워업과 동일하고, 가산량만 전용 정수에 병기해 상한 비교를
      //    그 정수로만 한다(파워업이 섞인 `maxHp` 차분으로는 FO7 몫을 분리할 수 없다).
      player.maxHp += gain;
      writeSlot(state.skillCarry, BruiserCarry.trophyGranted, granted + gain);
    }
  }
  // ③ 만재 세팅. FO2 엣지 규칙의 대상이다(직전이 상한 미만이었다면 다음 ⑨ 에서 정산이 뜬다).
  player.aux0 = state.armorMaxStacks;
  player.aux1 = 0;
}

/**
 * 앵커 ⑯ **볼리 파라미터 확정 직후·탄 생성 직전** — BL2 백병 격발 · BL3 만재 중탄 · BL6 중량 탄자.
 *
 * BL3·BL6 은 **여기서 표식만 찍고 실효는 앵커 ⑩(명중)에서** 난다. 표식을 발사 시점에 찍는 것이
 * 설계 본체다 — BL3 은 "만재일 때 **발사된** 탄", BL6 은 "무겁게 **쏜** 탄"이라 비행 중 상태
 * 변화에 좌우되면 안 된다. BL2 만 이 앵커 안에서 실효까지 끝난다(볼리 파라미터 직접 증폭).
 *
 * ## ⚠️ 여기 없는 브루저 발사축 1종(BL8) — 사유
 *  - **BL2 백병 격발**: ✅ **배선됐다**(S2.1 이 연 `VolleyParams.targetDist` 를 쓴다). 막고
 *    있던 사유는 근거로 남긴다 — 술어가 *"자동 조준 표적과의 거리"* 인데 `VolleyParams` 에
 *    표적도 그 거리도 없었고(`nearestTarget` 은 `world.ts` 소유이고 런타임 import 는 계약
 *    위반이다), 여기서 최근접 적을 다시 고르면 조준 선택 규칙의 **두 번째 사본**이 생겨
 *    조용히 갈린다. S2.1 이 *world 가 이미 고른 결과의 거리만* 싣는 칸을 열어 그대로 닫혔다.
 *  - **BL8 격돌 담금질**: 소모처(선두탄 대구경화)는 여기서 되지만 **적립처(몸통 접촉으로 인한
 *    실피격)** 가 없다. 앵커 ④ 는 피해원을 구분하지 않고(`world.ts` 의 max 수집 루프가 접촉원
 *    기여를 지역 변수로도 남기지 않는다) 접촉 판별 앵커가 아직 없다. 소비처 없는 카운터만
 *    돌리는 것이 이 저장소가 금지한 반쪽 배선이라 **양쪽이 열릴 때까지 넣지 않는다.**
 *    (2026-08-07 재확인 — 사유는 아직 **유효**하다. 앵커 ④ `onPlayerDamaged` 의 인자는
 *     `dmg`·`lethalSurvived` 뿐이라 여전히 피해원을 구분하지 않고, 접촉 판별 앵커도 새로
 *     생기지 않았다. BL2 를 연 `targetDist` 는 발사축 필드라 이 축과 무관하다.)
 */
export function bruiserVolleyParams(
  state: WorldState,
  player: Entity,
  params: VolleyParams,
): void {
  // --- BL2 백병 격발 -------------------------------------------------------
  // 술어는 `params.targetDist`(자동 조준이 **이미 고른** 표적까지의 거리) **하나뿐**이다.
  // ⚠️ `targetDist` 는 **0 일 수 있다**(적이 플레이어에 겹쳐 있는 틱). 여기 산술은 `<=` 비교와
  //    곱·나눗셈 상수뿐이라 그 값을 분모로 쓰지 않는다 — 거리 감쇠 곡선(`1/d` 형태)으로
  //    바꾸는 순간 겹침 틱에 무한대가 들어온다.
  // ⚠️ `ballisticsUsed` 게이트를 **걸지 않는다.** 그 게이트는 BL6 처럼 **대가(탄속·수명)를
  //    치르는 교환형**이 빔에서 페널티만 증발시키는 것을 막는 장치다. BL2 는 대가가 없는
  //    순이득이라 그 실패 모드가 원리적으로 없고, 빔에서 `pierce` 가 무연산인 것은 아키타입
  //    정의다(AS2 가 같은 자리에서 같은 판단을 했다 — 여기서 피해로 대체 보상하면 설계에
  //    없는 축이 하나 는다).
  const bl2 = lv(state, Sk.pointBlank);
  if (bl2 >= 1 && params.targetDist <= POINT_BLANK_RANGE) {
    // 관통 +1 은 1레벨에서 온전(설계 ② BL2 — 임계 밖은 무보정일 뿐 페널티가 아니다).
    params.pierce += 1;
    // 피해 +8% + 1.5%p/Lv. 산술은 BL6·정조준 배율과 동형(정수 bp · 단일 나눗셈 · 반올림 1회)
    // 이고 반올림은 게이트 **안**이다(규율 ③) — 미투자 런은 이 블록을 한 줄도 안 지난다.
    params.damage += Math.round((params.damage * (800 + 150 * bl2)) / 10000);
  }

  // --- BL3 만재 중탄 -------------------------------------------------------
  // 만재 판정은 **고정 8 이 아니라** `state.armorMaxStacks` 를 읽는다 — FO1 이 상한을 늘리면
  // 그 확장을 따라간다(설계서 ② BL3 "고정 8 하드코딩 금지").
  const bl3 = lv(state, Sk.fullPlateSlug);
  if (bl3 >= 1 && player.aux0 >= state.armorMaxStacks) {
    params.mark |= MARK_FULL_PLATE;
  }

  // --- BL6 중량 탄자 -------------------------------------------------------
  // ⚠️ **`params.ballisticsUsed` 게이트가 이 스킬의 성립 조건이다**(S2.1 이 열었다).
  // 이 스킬은 **탄속·수명을 대가로 피해를 올리는 교환**인데, 빔 아키타입은 `speed`·`life` 를
  // 한 칸도 읽지 않는다(정지 세그먼트 · 전용 반경/수명 — 앵커 ⑯ 의 아키타입 표). 게이트 없이
  // 태우면 빔 브루저에서 **페널티만 통째로 증발하고 이득만 남는다** — 무연산이 아니라
  // **일방적 이득**이라 밸런스가 조용히 깨진다.
  //
  // 초판은 `weaponType === 4` 를 봐야 하는데 그 상수가 `world.ts` 모듈 사유라 막혀 있었다.
  // S2.1 이 **판정 결과만** 레코드에 실어(정본은 `world.ts` 아키타입 분기 하나) 값 복제 없이
  // 닫았다 — `countUsed` 가 BA10 에서 쓴 것과 같은 형태다.
  const bl6 = lv(state, Sk.massSlug);
  if (bl6 >= 1 && params.ballisticsUsed) {
    // 피해 +20% + 2%p/Lv. 산술은 스트라이커 정조준 배율과 동형(정수 bp · 단일 나눗셈 ·
    // 반올림 1회)이고, 반올림은 게이트 **안**이다(규율 ③).
    params.damage += Math.round((params.damage * (2000 + 200 * bl6)) / 10000);
    // 탄속 ×0.5 · 수명 ×2. **곱만 정확히 상쇄되므로 도달 거리(속도×수명)가 비트 단위로
    // 불변**이다 — 사거리 계약(3.1 `weaponReach` = `reachLife` 동일값)이 요구하는 것이 정확히
    // 그것이라 `reach` 를 다시 구할 필요가 없다(구할 수도 없다 — params 에 없다).
    // 반올림을 끼우면 그 상쇄가 깨지므로 여기서는 정수화하지 않는다.
    params.speed *= 0.5;
    params.life *= 2;
    params.mark |= MARK_MASS_SLUG;
  }
}
