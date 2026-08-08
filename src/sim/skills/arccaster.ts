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
 * ## 배선은 30종 중 **30종**이다 — 배치5 가 마지막 6종을 얹었다
 * 공유 앵커 레인이 세운 앵커 둘로 남은 여섯이 전부 열렸다:
 *  · ㉗ `onActiveFired`(액티브 핸들러 직후) → **CH7 · CH10 · BA1 · BA4 · BA6**.
 *  · ㉘ `onGemMagnetParams`(자석 반경 확정 직후 · 제곱 전) → **BA2**.
 * ⚠️ CH10 은 CH1 과 **다른 표식값**을 쓴다(`ARC_PRIMED_MARK` 주석이 근거) · BA4 는 젬을
 * 직접 걷지 않고 좌표만 당겨 `resolveCollisions` 의 정규 수거 경로에 태운다.
 *
 * ## (이전 판) 배선 24종의 경위 — S3 아크캐스터 레인이 6종을 더했다
 * 그 레인이 앵커 **다섯**을 새로 세우고 기존 앵커 하나의 인자를 넓혀 CH2·CH5·CH9·BA5·BA8·BA9
 * 를 열었다:
 *  · ⑰ `onChainParams`(`status.ts` 의 `applyChain` 진입) → **CH2**. 효과 본체만
 *    `skills/arccasterChain.ts` 에 따로 산다 — 이 파일이 `status.ts` 를 값으로 import 하므로
 *    같은 파일에 두면 런타임 순환이다(그 파일 헤더가 근거).
 *  · ⑱ `onBulletHitParams`(명중 피해 확정 **직전**) → **CH5**. 앵커 ⑩ 은 hp 차감 뒤라 늦다.
 *  · ⑲ `onEliteLootRarity`(`rollEliteDrop` 직전) → **CH9**.
 *  · ⑳ `onOverchargeAccrual`(과충전 적립 분기) → **BA8 앞 절반 · BA9**.
 *  · ㉑ `onComboDecay`(`updateCombo`) → **BA5**.
 *  · ⑧ `onDamageChain` 에 `sources`(피해원 비트합) **선택 인자** 추가 → **BA8 뒤 절반**.
 *
 *
 * ## (이전 판) 배선 18종의 경위 (1차 13종 + S2 앵커 ⑯ 으로 4종 + S3 앵커 ⑥ 으로 1종)
 * S2 가 연 앵커 ⑯(`onVolleyParams` — 볼리 파라미터 확정 직후)이 「발사부 앵커 부재」로 막혀
 * 있던 다섯 중 **넷**(CH1·CH8·BA7·BA10)을 열었고, S3-2 가 앵커 ⑥ 에 **수명 만료 사유**를
 * 뚫어 **CH3** 을 열었다(⑯ 이 기준 피해를 새기고 ⑥ 이 터뜨리는 2단 배선). 남은 12종은 여전히
 * 앵커가 닿지 않는 지점(액티브 핸들러(CH10·BA1·BA4·BA6·CH7) · `stepGems` 반경(BA2) ·
 * 콤보 감소 지점(BA5) · 드랍 희귀도(CH9) · `applyChain` 파라미터화(CH2) · 명중 비행거리(CH5) ·
 * 해저드 적립 분기(BA8) · 이동 리셋 분기(BA9))을 요구한다. 여기 없는 스킬은 "구현했는데 안
 * 불린다"가 아니라 **아직 코드가 없다** — 사유는 각 앵커의 `case` 주석에 있다.
 *
 * ## ⚠️ 전격 연쇄 부여는 설계상 정확히 3종(CH1·BR2·CH10)이고 이제 **셋 다** 켜져 있다
 * CH1 은 앵커 ⑯ 의 발사 시점 표식 + 앵커 ⑩ 의 명중 소비로 성립했다. CH10 은 같은 2단 형태를
 * 앵커 ㉗ + 앵커 ⑩ 으로 옮겨 성립한다 — 앵커 ⑯ 은 주무기 볼리 전용이라 액티브 투사체에
 * 원리적으로 닿지 않으므로, 표식 지점만 ㉗ 으로 갈아 끼웠고 소비 지점은 그대로다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
// 앵커 ⑯ 의 레코드 타입. **type-only 라 런타임 import 0건 규율을 깨지 않는다**(컴파일에서
// 지워진다) — `skillHooks.ts` 가 이 파일을 값으로 import 하므로 값 import 는 순환이 된다.
import type {
  VolleyParams,
  BulletHitParams,
  OverchargeAccrual,
  ActiveFiredOrigin,
  GemMagnetParams,
} from '../skillHooks.js';
// 액티브 정의(계열 판별용 `treeIndex`/`tier`). 데이터 레지스트리라 순환이 없다.
import type { ActiveSkillDef } from '../../../data/ships/actives/types.js';
// 피해원 비트합의 정본은 `skillSlots.ts`(import 0 인 leaf)다 — 스킬 모듈이 **런타임에** 읽어야
// 하는데 `skillHooks.ts` 에 두면 순환이 되기 때문이다(그 파일 주석이 근거).
import type { DamageSourceMask } from '../skillSlots.js';
import { blastDamageAt, clearEnemyBullets, fanStrike } from '../activeTypes.js';
import { spawnEventObject } from '../entities.js';
import { activateTurret } from '../events.js';
// 플레이어 소환물 마커. `uniques.ts` 는 **import 0 인 leaf** 라 순환이 없다.
// ⚠️ 새 마커를 만들면 안 된다 — `world.ts` 의 `isGimmick` 이 `turretPickup` 을 청크 기믹으로
// 컬링하는데 그 예외 목록이 `DRONE_MARK`·`BROOD_MARK` 둘뿐이고, 그 목록은 이 레인이 만질
// 자리가 아니다. `BROOD_MARK` 는 해츨링 병아리 상한의 정의라 재사용이 금지다.
import { DRONE_MARK } from '../uniques.js';
import { applyChain } from '../status.js';
import {
  readSlot,
  writeSlot,
  ArccasterCarry,
  ArccasterStage,
  DamageSource,
  hasDamageSource,
} from '../skillSlots.js';
import {
  overchargeBp,
  OVERCHARGE_STILL_TICKS,
  OVERCHARGE_BASE_BP,
  OVERCHARGE_RAMP_BP,
  OVERCHARGE_MAX_BP,
} from '../shipSignature.js';
import { FIRE_CD_Q, OVERCHARGE_TICK_CAP } from '../constants.js';
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

import {
  CAPACITOR_KILLS,
  guidedArcChainBp,
  endpointBurstBp,
  endpointBurstRadius,
  entryLanceDamage,
  entryLancePierce,
  potentialSnipeBp,
  potentialSnipePierce,
  overkillCarryBp,
  residualBoltCostTicks,
  groundedPierceBp,
  boltSalvageMultBp,
  primedStrikeBp,
  redeploySalvoCount,
  redeploySalvoDamage,
  stillMagnetMaxBp,
  stillSpotterRefundShots,
  sweepLaneHalfWidth,
  staticComboPeriod,
  killCapacitorBonusCount,
  insulatedMountCutBp,
  marchFireDecayPeriod,
  salvoDoctrineMultBp,
  staticRepulsorRadius,
  staticRepulsorPush,
  lightningRodChainDamage,
  phaseCouplingCutBp,
  surplusShieldCap,
  groundTetherCutBp,
  chargeBackflowHealBp,
  bufferCondenserBp,
  repairPeriodTicks,
  repulseHullRadius,
  terminalGroundIframes,
} from './arccasterScaling.js';

const enum Sk {
  /** CH1 유도 낙뢰 */ guidedArc = 0,
  /** CH3 종말점 방전 */ endpointBurst = 2,
  /** CH4 진입 뇌격 */ entryLance = 3,
  /** CH5 전위차 저격 */ potentialSnipe = 4,
  /** CH6 과잉 전하 이월 */ overkillCarry = 5,
  /** CH7 잔류 방전 */ residualDischarge = 6,
  /** CH8 접지 관통로 */ groundedPierce = 7,
  /** CH9 낙뢰 인양 */ boltSalvage = 8,
  /** CH10 주입 전격 */ primedStrike = 9,
  /** BA1 재배치 일제사 */ redeploySalvo = 10,
  /** BA2 정지 흡인장 */ stillMagnet = 11,
  /** BA3 정지 관측 사격 */ stillSpotter = 12,
  /** BA4 소거 항로 */ sweepLane = 13,
  /** BA6 분신 포좌 */ echoMount = 15,
  /** BA5 정전 콤보 감속 */ staticCombo = 14,
  /** BA7 연발 축전기 */ killCapacitor = 16,
  /** BA8 절연 포좌 */ insulatedMount = 17,
  /** BA9 이동 포격 술식 */ marchFire = 18,
  /** BA10 일제 사격 통제 */ salvoDoctrine = 19,
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

// 과충전 정지 카운터 상한(`OVERCHARGE_TICK_CAP`)은 **`constants.ts` 가 정본**이다. 종전에는
// 세 파일(`world.ts`·`activeHandlers/arccaster.ts`·이 파일)이 같은 600 을 각자 선언하고
// 있었고, S2 에서 leaf 로 합쳤다(위 import 목록 참조).

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

/**
 * **과충전 발사 표식** — 이번 볼리가 과충전 중에 나갔음을 탄 `aux0` 에 남기는 값.
 *
 * ⚠️ **`1` 은 스트라이커 정조준탄이 점유했다**(앵커 ⑯ `VolleyParams.mark` 주석). 기체는 한
 * 런에 하나뿐이라 값이 겹쳐도 오작동하지는 않지만, 렌더·후속 판정이 두 표식을 구분하지
 * 못하므로 다른 값을 골랐다. 이 상수를 읽는 곳은 이 파일 안 두 스킬(CH1·CH8)뿐이다.
 */
const ARC_OVERCHARGE_MARK = 2;

/**
 * **주입 전격 표식**(CH10) — *방전 액티브가 낳은 투사체* 임을 탄 `aux0` 에 남기는 값.
 *
 * ⚠️ **`ARC_OVERCHARGE_MARK`(2) 를 재사용하지 않았다.** 재사용하면 CH10 만 투자한 런의 액티브
 * 투사체가 **CH1 의 소비 분기**(앵커 ⑩)로 들어가고, CH1 이 0레벨이라 연쇄가 안 걸린 채
 * CH8 증폭만 조용히 켜진다 — 두 스킬의 게이트가 한 값으로 뭉개진다. 값 3 은 스트라이커
 * 정조준탄(1)·과충전 표식(2) 어느 것과도 겹치지 않는다.
 */
const ARC_PRIMED_MARK = 3;

/** chain(offense) 축 인덱스 — `data/ships/arccaster.ts` 의 `trees[0]`. 「방전 액티브」가 여기 산다. */
const CHAIN_TREE_INDEX = 0;

/** barrage(utility) 축 인덱스 — `trees[1]`. 「점멸 액티브」 2종(lo 600 · hi 900)이 여기 산다. */
const BARRAGE_TREE_INDEX = 1;

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
  const refund = stillSpotterRefundShots(ba3) * FIRE_CD_Q;
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
    applyChain(state, player, lightningRodChainDamage(br2));
  }

  // ── BR7 완충 콘덴서 — 깎인 피해를 aux0 으로 전환(600 클램프 유지).
  //    폭 k 가산이 90 을 건너뛰어도 CH4 는 **통과 판정**이라 발화한다(설계서 「핵심 문법」).
  const br7 = lv(state, Sk.bufferCondenser);
  if (br7 >= 1 && dmg > 0) {
    const gain = Math.round((dmg * bufferCondenserBp(br7)) / 10000);
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
        const heal = Math.round((player.aux0 * chargeBackflowHealBp(br6)) / 10000);
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
    player.iframes += terminalGroundIframes(br10);
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑧ — 감쇠 사슬의 스킬 슬롯 2칸
// ---------------------------------------------------------------------------

/**
 * **① 감소(BR3 위상 결합 · BR5 접지 케이블 · BA8 절연 포좌) → ② 흡수(BR4 잉여 전하 방벽).**
 *
 * 순서는 앵커 주석이 못 박은 그대로다(흡수가 먼저면 감소가 이미 깎아 낼 피해까지 흡수 자원이
 * 태워진다). 정수화는 전부 **게이트 안**이다 — 접촉 피해에는 엘리트 배율이 섞여 소수가 될 수
 * 있고, 반올림이 게이트 밖으로 나가면 스킬 없는 런의 소수 피해까지 바뀐다.
 *
 * @param sources 이번 피격에 기여한 피해원 비트합(앵커 ⑧ 의 선택 인자). BA8 의 「용암 피해
 *   경감」이 **정확히 이 값의 부재로** 막혀 있었다.
 */
export function arccasterDamageChain(
  state: WorldState,
  player: Entity,
  dmg: number,
  sources: DamageSourceMask,
): number {
  let out = dmg;

  // ① 감소 A — BR3: 방벽 액티브(buff) 지속 중. 15% + 1%p/Lv.
  const br3 = lv(state, Sk.phaseCoupling);
  if (br3 >= 1 && (state.activeBuff0 > 0 || state.activeBuff1 > 0)) {
    out -= Math.round((out * phaseCouplingCutBp(br3)) / 10000);
  }
  // ① 감소 B — BR5: 벽 접촉 **×** 정지 이중 조건. 12% + 1.2%p/Lv.
  //    스트라이커 S4 와 같은 벽 훅이지만 `aux0 > 0`(정지) 이 이 기체만의 결속 변형이다.
  const br5 = lv(state, Sk.groundTether);
  if (br5 >= 1 && state.wallContactTicks > 0 && player.aux0 > 0) {
    out -= Math.round((out * groundTetherCutBp(br5)) / 10000);
  }
  // ① 감소 C — BA8「절연 포좌」의 **뒤 절반**: 해저드(용암·박격 장판) 출처 피해 경감.
  //    15% + 1.5%p/Lv. 앞 절반(감속 장판 위 적립 2배)은 앵커 ⑳ 에 있다.
  //
  //    ⚠️ **정지·감속 장판 술어를 여기서 다시 걸지 않는다.** 설계 문면은 "감속 장판 위에서
  //    정지하면 … 용암 피해가 경감된다" 지만, 그 술어를 이 자리에 그대로 옮기면 스킬이
  //    **사실상 발동하지 않는다**: 용암을 밟은 틱에는 `playerSlowTicks` 가 서지 않을 수 있고
  //    (용암은 `HAZARD_SLOW` 가 아니다), 감속 장판 위에 서 있는 동안 오는 피해는 대개
  //    그 장판 자신의 피해다. 두 절반의 술어를 갈라 **앞 절반만** 접촉 근사를 지고, 뒤 절반은
  //    출처(`DamageSource.hazard`)만 본다 — 「절연」이라는 이름이 가리키는 쪽이 그것이다.
  //    설계-코드 어긋남으로 보고했고 문서는 고치지 않았다.
  const ba8 = lv(state, Sk.insulatedMount);
  if (ba8 >= 1 && hasDamageSource(sources, DamageSource.hazard)) {
    out -= Math.round((out * insulatedMountCutBp(ba8)) / 10000);
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
        entryLanceDamage(ch4),
        0,
        { x: Math.cos(player.angle), y: Math.sin(player.angle) },
        { pierce: entryLancePierce(ch4) },
      );
    }
    writeSlot(state.skillStage, ArccasterStage.entryAux0Seen, cur);
  }

  // ── BR4 잉여 전하 방벽 — 상한 초과 구간(aux0 ≥ 190)의 정지 틱을 흡수량으로 적립.
  //    aux0 이 600 에 고정돼도 "≥190 인 매 틱" 술어라 적립이 계속된다(600 고정의 수혜 스킬).
  const br4 = lv(state, Sk.surplusShield);
  if (br4 >= 1 && player.aux0 >= OVERCHARGE_APEX_TICKS) {
    const cap = surplusShieldCap(br4);
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
    const radius = staticRepulsorRadius(br1);
    const r2 = radius * radius;
    const push = staticRepulsorPush(br1);
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
    clearEnemyBullets(state, player, repulseHullRadius(br9));
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑪ — 적 격추(BA7 의 충전만)
// ---------------------------------------------------------------------------

/** BA7 이 한 번 장전되는 데 필요한 처치 수(설계서 고정값 — 레벨로 안 변한다). */

/**
 * **BA7 연발 축전기(충전부)** — 처치 6기마다 다음 볼리 한 번을 장전한다.
 *
 * 소비처는 앵커 ⑯ 의 {@link arccasterVolleyParams} 다 — **카운터만 돌고 소비처가 없는 반쪽
 * 배선이 아니다.** 6 에서 멈추는(누적하지 않는) 것은 설계서의 "다음 볼리"가 한 번이기
 * 때문이고, 그래서 슬롯은 0..6 유계다.
 *
 * ⚠️ **레일건·빔 런에서는 장전이 6 에 멈춘 채 소비되지 않는다** — 두 아키타입은 볼리 탄수
 * (`count`)를 읽지 않아 소비처가 아키타입 계약상 존재하지 않기 때문이다(앵커 ⑯ 의
 * `countUsed`). 설계서 BA10 이 빔을 no-op 으로 못 박은 것과 같은 사상이며, 잔여 6 은 그
 * 런에서 아무 일도 하지 않는다(무기 의존 no-op이지 미배선이 아니다).
 */
export function arccasterEnemyDeath(state: WorldState): void {
  const ba7 = lv(state, Sk.killCapacitor);
  if (ba7 < 1) return;
  const charge = readSlot(state.skillStage, ArccasterStage.killCapacitorCharge);
  if (charge >= CAPACITOR_KILLS) return; // 이미 장전됨 — 초과 처치는 이월하지 않는다.
  writeSlot(state.skillStage, ArccasterStage.killCapacitorCharge, charge + 1);
}

// ---------------------------------------------------------------------------
// 앵커 ⑯ — 볼리 파라미터 확정 직후 · 탄 생성 직전
// ---------------------------------------------------------------------------

/**
 * **CH1 유도 낙뢰 · CH8 접지 관통로(표식) · CH3 종말점 방전(기준 피해 각인) · BA7 연발
 * 축전기(소비) · BA10 일제 사격 통제.**
 *
 * ## 표식은 한 칸을 둘이 나눠 쓴다
 * CH1(과충전 탄 명중 → 연쇄)과 CH8(과충전 탄 관통 → 증폭)은 **같은 술어**("이 탄이 과충전
 * 중에 나갔는가")를 쓰므로 표식도 하나다. 둘 중 하나만 투자해도 표식이 서고, 소비는 각자
 * 자기 레벨 게이트 안에서 한다(앵커 ⑩).
 *
 * ⚠️ **과충전 판정은 여기서 다시 한다.** `world.ts` 가 이미 계산한 `ocBp` 는 지역 변수라
 * 넘어오지 않고, `params.damage` 에서 역산할 수도 없다(파워업·정조준 배율이 섞인 뒤다).
 * 술어의 정본은 `player.aux0` 하나이므로 두 곳이 갈릴 여지는 없다.
 *
 * ## ⚠️ BA7·BA10 은 `countUsed` 가 참일 때만 실린다
 * 레일건·빔은 `count` 를 안 읽는다. BA10 을 그대로 태우면 탄수는 그대로인데 간격만 늘어
 * **순손실**이 된다(설계서가 빔을 no-op 으로 못 박은 이유가 그것이고, 레일건도 같은 형태다).
 *
 * ## ⚠️ 설계-코드 어긋남 (문서는 고치지 않았다 — 규약대로 보고만)
 * 설계서 BA10 은 **레일건 = 같은 표적 방향 2연발**로 규정했다. 이 앵커는 파라미터 한 벌을
 * 넘길 뿐 탄을 낳지 않으므로(주석: "훅에서 스폰하지 마라") 2연발은 여기서 성립하지 않는다.
 * 레일건은 no-op 으로 두었다 — 간격만 늘리는 순손실보다 무연산이 낫다.
 */
export function arccasterVolleyParams(
  state: WorldState,
  player: Entity,
  params: VolleyParams,
): void {
  // ── CH1·CH8 — 과충전 중 발사한 탄에 표식. 소비는 앵커 ⑩.
  const ch1 = lv(state, Sk.guidedArc);
  const ch8 = lv(state, Sk.groundedPierce);
  const ch3 = lv(state, Sk.endpointBurst);
  const oc = (ch1 >= 1 || ch8 >= 1 || ch3 >= 1) && overcharged(player);
  if (oc && (ch1 >= 1 || ch8 >= 1)) {
    params.mark = ARC_OVERCHARGE_MARK;
  }
  // ── CH3 — 과충전 중 발사한 탄에 **발사 시점 확정 피해**를 새긴다. 소비는 앵커 ⑥('life').
  //    표식 칸이 `aux0`(CH1·CH8) 과 갈린 사유는 `VolleyParams.recordSpawnDamage` 주석에 있다.
  if (oc && ch3 >= 1) {
    params.recordSpawnDamage = true;
  }
  // ── CH5 — **발사 시점 잔여 수명**을 탄 `targetX` 에 새긴다. 소비는 앵커 ⑱(명중 직전).
  //    과충전 술어와 무관하다(설계 문면이 과충전을 요구하지 않는다). 각인 칸이 `aux0`·`aux1`
  //    과 갈린 사유는 `VolleyParams.recordSpawnOrigin` 주석에 있다.
  const ch5 = lv(state, Sk.potentialSnipe);
  if (ch5 >= 1) {
    params.recordSpawnOrigin = true;
  }

  if (!params.countUsed) return;

  // ── BA7 — 장전됐으면 이번 볼리에만 탄수 가산(2 + floor(Lv/5)) 후 방전.
  const ba7 = lv(state, Sk.killCapacitor);
  if (ba7 >= 1) {
    const charge = readSlot(state.skillStage, ArccasterStage.killCapacitorCharge);
    if (charge >= CAPACITOR_KILLS) {
      params.count += killCapacitorBonusCount(ba7);
      writeSlot(state.skillStage, ArccasterStage.killCapacitorCharge, 0);
    }
  }

  // ── BA10 — 탄수 ×2 · 간격 배율 `2 − 0.6×Lv/(Lv+10)`(점근 ×1.4, 1.0 밑으로 안 내려간다).
  //    간격은 **늘어나기만** 하므로 `cooldownQ` 가 0 이하로 갈 수 없다(앵커 ⑯ 의 금지 사항).
  const ba10 = lv(state, Sk.salvoDoctrine);
  if (ba10 >= 1) {
    params.count *= 2;
    const multBp = salvoDoctrineMultBp(ba10);
    params.cooldownQ = Math.round((params.cooldownQ * multBp) / 10000);
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑥ — 아군탄이 소멸하는 지점(사유 구분)
// ---------------------------------------------------------------------------

/**
 * **CH3 종말점 방전** — 과충전 중 발사한 탄이 **수명을 다해** 사라지면 그 지점에 방전 폭발.
 *
 * 반경 = 50 + 5×Lv, 피해 = **발사 시점 확정 피해**의 25% + 2%p/Lv (설계서 ② 공식 그대로).
 *
 * ## ⚠️ 호출부는 `for (const e of state.entities)` 순회 **안**이다 — 스폰이 없다
 * `blastDamageAt` 은 `hp` 를 깎고 hp≤0 이면 `dead` 플래그를 세울 뿐, **엔티티를 한 개도 낳지
 * 않는다**(그 함수 주석이 근거 — 플래그 대입은 배열 길이를 안 바꾼다). 그래서
 * `splitSpawns` 식 지연 목록이 필요 없다 — 필요해지는 순간(파편·이펙트)에는 목록을 모아 루프
 * 뒤에 비우는 그 패턴으로 가야 하고, 이 자리에서 직접 `push` 하면 안 된다.
 *
 * ## ⚠️ 사유 게이트는 호출부(`skillHooks.ts`)가 이미 걸었다 — 여기서 다시 걸지 않는다
 * `reason === 'life'` 만 여기로 온다. 관통 예산 소진(`'pierce'`)은 스트라이커 F4 의 자리이고,
 * 그 둘이 설계서의 분화점이다. 술어를 두 곳에 적으면 조용히 갈린다.
 *
 * ## 기준 피해는 `bullet.damage` 가 아니라 `bullet.aux1` 이다
 * `damage` 는 비행 중 갱신된다(CH6 이월 가산 · CH8 관통 증폭) — 그 값을 읽으면 이월분이 다시
 * 증폭돼 설계서가 금지한 재증폭이 된다. `aux1` 은 앵커 ⑯ 이 **발사 직후 한 번만** 새긴 값이라
 * 과충전 증폭·정조준·쌍둥이 항성 배율은 반영하고 이월만 배제한다.
 *
 * `aux1 === 0` 이면 **과충전 밖에서 나간 탄**(또는 미투자 런)이라 무연산이다 — 게이트 그 자체다.
 * RNG 를 한 번도 소비하지 않는다(반경·피해 모두 레벨의 결정론적 함수).
 */
export function arccasterBulletExpiredLife(state: WorldState, bullet: Entity): void {
  const ch3 = lv(state, Sk.endpointBurst);
  if (ch3 < 1) return;
  const base = bullet.aux1;
  if (base <= 0) return;
  const damage = Math.round((base * endpointBurstBp(ch3)) / 10000);
  if (damage <= 0) return;
  // 좌표는 **이번 틱 적분이 끝난 마지막 위치**다(호출부 주석이 근거) — 스폰 지점이 아니다.
  blastDamageAt(state, bullet.x, bullet.y, endpointBurstRadius(ch3), damage);
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
  if (source === undefined) return;

  // ── CH1·CH8 — **과충전 표식이 붙은 탄**의 명중(표식은 앵커 ⑯ 이 단다).
  //    대상은 `enemy`·`boss` 한정이다(설계서 ④ 표 — 침공 구조물·코어는 정의상 제외).
  if (source.aux0 === ARC_OVERCHARGE_MARK && (target.kind === 'enemy' || target.kind === 'boss')) {
    // CH1 유도 낙뢰 — 연쇄 피해 = **이 탄의 피해**의 20% + 2%p/Lv. 아래 CH8·CH6 이
    // `source.damage` 를 올리기 **전**에 읽는다(순서를 바꾸면 같은 명중이 두 번 증폭된다).
    const ch1 = lv(state, Sk.guidedArc);
    if (ch1 >= 1) {
      const chain = Math.round((source.damage * guidedArcChainBp(ch1)) / 10000);
      if (chain > 0) applyChain(state, target, chain);
    }
    // CH8 접지 관통로 — 관통을 소모할 때마다 +6% + 0.6%p/Lv. 이 앵커가 관통 차감 **직전**이라
    // 명중 1회 = 관통 소모 1회이고, 증폭분은 **다음 대상**부터 실린다("뚫을수록 아프다").
    //
    // ⚠️ **자이로·프리즘 경로에서는 한 번만 실린다.** 그 둘만 `b.phase` 를 올리는데
    // (`world.ts` 의 관통 처리 분기), 자이로는 관통을 **소모하지 않아** 명중 수가 관통 예산으로
    // 유계가 아니다 — 매 명중 곱하면 수명이 다할 때까지 복리로 폭주한다. `phase === 0` 술어가
    // 그 경로를 첫 명중 1회로 묶는다(설계서 CH8 의 "자이로는 중첩 곱 금지"의 코드 형태).
    const ch8 = lv(state, Sk.groundedPierce);
    if (ch8 >= 1 && source.phase === 0) {
      const gain = Math.round((source.damage * groundedPierceBp(ch8)) / 10000);
      if (gain > 0) source.damage += gain;
    }
  }

  // ── CH10 주입 전격 — **방전 액티브가 낳은 투사체**의 명중에 전격 연쇄를 부여한다.
  //    표식은 앵커 ㉗({@link arccasterActiveFired})이 단다. 연쇄 = 이 탄 피해의 25% + 2%p/Lv.
  //
  //    ⚠️ CH1 분기와 **따로** 선 이유는 `ARC_PRIMED_MARK` 주석에 있다. 두 표식은 탄 `aux0`
  //    한 칸을 공유하므로 한 탄이 둘 다일 수는 없다 — 액티브 투사체는 앵커 ⑯(주무기 볼리)을
  //    지나지 않아 `ARC_OVERCHARGE_MARK` 가 원리적으로 안 붙는다.
  //    대상 게이트(`enemy`/`boss`)는 CH1 과 같다(설계서 ④ 표).
  if (source.aux0 === ARC_PRIMED_MARK && (target.kind === 'enemy' || target.kind === 'boss')) {
    const ch10 = lv(state, Sk.primedStrike);
    if (ch10 >= 1) {
      const chain = Math.round((source.damage * primedStrikeBp(ch10)) / 10000);
      if (chain > 0) applyChain(state, target, chain);
    }
  }

  const ch6 = lv(state, Sk.overkillCarry);
  if (ch6 < 1) return;
  if (target.kind !== 'enemy' || target.hp > 0) return;
  const overkill = -target.hp;
  if (overkill <= 0) return;
  // 이월 비율 = 40% + 3%p/Lv (Lv20 = 100%). 반올림은 게이트 안이다.
  const carried = Math.round((overkill * overkillCarryBp(ch6)) / 10000);
  if (carried > 0) source.damage += carried;
}

// ---------------------------------------------------------------------------
// 앵커 ⑱ — 아군탄 명중의 피해 확정 **직전**
// ---------------------------------------------------------------------------

/** CH5 가 「멀리 비행」으로 인정하는 최소 비행 비율(발사 시점 수명 대비 백분율). */
const SNIPE_FLIGHT_PCT = 50;

/**
 * **CH5 전위차 저격** — *"멀리 비행한 뒤 명중한 탄은 피해가 증폭되고 관통이 늘어난다"*.
 *
 * ## ⚠️ 아군탄 게이트가 **이 함수의 첫 줄**이다 — 없으면 적탄 거동이 조용히 갈린다
 * 이 스킬이 읽는 `targetX` 는 **적탄에서 거동 파라미터 A**(가속도·선회율·각가속도)이고
 * (`bullets.ts` 의 `applyBehavior`), 보스에서는 나선 기준각이다(`boss.ts`). 아군탄
 * (`kind === 'bullet'`)에 한해서만 비어 있다. 호출부(`resolveCollisions`)의 루프가 이미
 * `b.kind !== 'bullet'` 을 걸지만, 술어를 한 곳에만 두면 앵커가 옮겨질 때 조용히 풀린다 —
 * **여기서 다시 건다.** `tests/skillArccaster.test.ts` 의 §⑱ 에 부정/긍정 짝이 있다.
 *
 * ## 「멀리」의 정의 — 월드 유닛이 아니라 **자기 사거리의 비율**이다
 * `targetX` 에는 앵커 ⑯ 이 **발사 시점 잔여 수명**을 새겼다(`recordSpawnOrigin`). 비행 비율은
 * `(life0 − life) / life0` 이고, 이 값은 무기 아키타입·탄속·수명이 달라도 그대로 뜻이
 * 통한다(레일건과 발칸에 같은 유닛 임계값을 박으면 한쪽은 항상 참, 다른 쪽은 항상 거짓이 된다).
 * `life0 <= 0` 은 **각인되지 않은 탄**이다 — CH4 부채탄·분열 파편·보조무기·빔 세그먼트가
 * 거기 해당하고, 기본값 0 이 그대로 게이트가 된다(수명은 스폰 시 항상 양수라 자기 표식이다).
 *
 * ## 관통 가산은 **탄당 1회**다
 * 호출부가 이 훅 직후 관통을 1 소비하므로, 명중마다 +1 하면 소비가 상쇄되어 탄이 관통으로
 * 영영 안 죽는다(수명이 남는 한 무한 관통). 소진 표식은 `targetY` — 이 탄에서 비어 있는
 * 나머지 한 칸이고, `targetX` 와 한 벌로 아군탄에서만 자유롭다.
 *
 * 대상은 `enemy`·`boss` 한정이다(설계서 ④ 표 — CH1·CH8 과 같은 규율).
 * `target.hp` 를 직접 만지지 않으므로 좀비 결함(`dead` 미표시)이 원리적으로 없다.
 */
export function arccasterBulletHitParams(
  state: WorldState,
  bullet: Entity,
  target: Entity,
  params: BulletHitParams,
): void {
  if (bullet.kind !== 'bullet') return; // ← 아군탄 게이트. 위 doc 이 근거다.
  const ch5 = lv(state, Sk.potentialSnipe);
  if (ch5 < 1) return;
  const life0 = bullet.targetX;
  if (life0 <= 0) return;
  const flown = life0 - bullet.life;
  if (flown * 100 < life0 * SNIPE_FLIGHT_PCT) return;
  if (target.kind !== 'enemy' && target.kind !== 'boss') return;
  // 피해 증폭 = 25% + 2.5%p/Lv (Lv20 = +75%). 반올림은 게이트 안이다.
  const amp = Math.round((params.damage * potentialSnipeBp(ch5)) / 10000);
  if (amp > 0) params.damage += amp;
  if (bullet.targetY === 0) {
    bullet.targetY = 1;
    params.pierce += potentialSnipePierce(ch5);
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑲ — 엘리트 전리품 등급 롤 직전
// ---------------------------------------------------------------------------

/**
 * **CH9 낙뢰 인양** — *"과충전 중 처치한 엘리트의 전리품 희귀도에 상향 배율이 실린다"*.
 *
 * 배율 = ×(1 + 5% + 2.5%p/Lv) (Lv1 ×1.075 · Lv20 ×1.55). 촉매 희귀도 배율 위에 **곱으로**
 * 얹힌다(상한 없음 — 촉매 축과 같은 규율).
 *
 * ⚠️ **RNG 를 한 칸도 소비하지 않는다.** `rollEliteDrop` 의 소비는 배율과 무관하게 2회
 * 고정이라 드랍 **횟수**는 안 밀리고 **등급**만 움직인다(그 함수 본문이 근거).
 *
 * ⭐ 과충전 술어는 이 파일의 {@link overcharged} 를 쓴다. `world.ts` 의 `ocKill`
 * (같은 함수 안, 사연 관측용 비-해시 카운터)과 **같은 식**(`overchargeBp(aux0) > 0`)이고,
 * 그쪽은 `sigBit` 게이트를 직접 들고 있는 반면 여기는 앵커의 `switch` 가 이미 걸었다.
 * 새 술어를 만들지 않았다 — 두 곳이 갈릴 여지가 없도록 식이 하나다.
 */
export function arccasterEliteLootRarity(
  state: WorldState,
  player: Entity,
  rarityMult: number,
): number {
  const ch9 = lv(state, Sk.boltSalvage);
  if (ch9 < 1) return rarityMult;
  if (!overcharged(player)) return rarityMult;
  return (rarityMult * boltSalvageMultBp(ch9)) / 10000;
}

// ---------------------------------------------------------------------------
// 앵커 ⑳ — 과충전 적립 분기
// ---------------------------------------------------------------------------

/**
 * **BA8 절연 포좌(앞 절반) · BA9 이동 포격 술식.**
 *
 * ## BA8 — 「감속 장판 **위에서** 정지」는 근사다 (보고 항목)
 * sim 은 감속 장판 접촉을 **지속 상태로 남기지 않는다**. 접촉 틱에 `state.playerSlowTicks` 를
 * 90(또는 설비 지정 값)으로 세울 뿐이라(`world.ts` 의 `HAZARD_SLOW` 분기) *"지금 위에 있다"*
 * 와 *"최근 1.5초 안에 밟았다"* 가 **구분 불가**다. 문면대로 하려면 접촉 플래그를 새로
 * 세워야 하는데, 그것은 해시 필드 추가 + 매 틱 갱신 지점 신설이라 이 레인의 폭을 넘는다.
 *
 * **근사로 갔다.** 근거 셋:
 *  1. **선례가 있다** — 브루저가 같은 술어를 `playerSlowTicks > 0` 으로 근사했다
 *     (`skills/bruiser.ts:421`). 같은 sim 에서 같은 개념을 두 방식으로 재면 그쪽이 더 나쁘다.
 *  2. **오차 방향이 안전하다** — 근사는 "밟고 나온 직후 1.5초"를 과대 인정할 뿐, 밟고 있는데
 *     미발동하는 **누락**은 없다. 정지 게이트(`still`)가 함께 걸려 있어 그 창 동안 플레이어는
 *     멈춰 있어야 한다.
 *  3. 대안(미배선)은 스킬 1종을 통째로 버리는 것이라 손실이 더 크다.
 *
 * ## BA9 — 「즉시 리셋되지 않고 서서히 감쇠」
 * 이동 틱에 `still` 을 **참으로 뒤집고** 음수 델타를 실어 리셋 분기를 우회한다. 감쇠 주기는
 * `2 + floor(Lv/2)` 틱마다 −1(Lv1 = 2틱당 1 → 적립 속도의 절반, Lv20 = 12틱당 1).
 * `aux0` 하한 클램프는 호출부에 있다.
 *
 * ⚠️ **BA8 을 BA9 보다 먼저 본다.** BA9 가 `still` 을 뒤집은 뒤에 BA8 을 보면 *이동 중인데
 * 감속 장판 근사가 참인* 틱에 적립 +2 가 실려 "이동하면서 과충전이 쌓인다" 가 된다 —
 * 시그니처가 통째로 뒤집히는 회귀다. 그래서 BA8 은 **원래의 정지 판정**만 본다.
 */
export function arccasterOverchargeAccrual(
  state: WorldState,
  player: Entity,
  out: OverchargeAccrual,
): void {
  void player;
  // ── BA8 앞 절반 — 진짜 정지 + 감속 장판 근사에서만 적립 2배.
  const ba8 = lv(state, Sk.insulatedMount);
  if (ba8 >= 1 && out.still && state.playerSlowTicks > 0) {
    out.delta = 2;
  }
  // ── BA9 — 이동 틱의 즉시 리셋을 감쇠로 바꾼다. **BA8 판정 뒤**여야 한다(위 경고).
  if (!out.still) {
    const ba9 = lv(state, Sk.marchFire);
    if (ba9 >= 1) {
      out.still = true;
      out.delta = state.tick % marchFireDecayPeriod(ba9) === 0 ? -1 : 0;
    }
  }
}

// ---------------------------------------------------------------------------
// 앵커 ㉑ — 콤보 유지 시계 감소 직전
// ---------------------------------------------------------------------------

/**
 * **BA5 정전 콤보 감속** — *"과충전 중에는 콤보 유지 시계가 절반 속도로 줄어든다"*.
 *
 * 「절반 속도」를 **틱 모듈러**로 구현한다: 감소는 `state.tick % period === 0` 인 틱에만
 * 일어나고 나머지 틱은 건너뛴다. `period = 2 + floor(Lv/4)` 라 Lv1 이 정확히 문면의 절반이고
 * (2틱에 1 감소), Lv20 은 1/7 속도다.
 *
 * ⚠️ 주기를 `aux0 % n` 으로 잡지 마라 — `aux0` 은 600 에서 고정되므로 만충 상태에서 영구히
 * 침묵한다(BR1 이 같은 함정을 밟았고 설계서 1R 심각 1 이 그것이다). 주기의 정본은
 * **`state.tick`** 이다.
 *
 * ⚠️ 시계 값을 되돌리지(`comboTimer++`) 않는다 — 같은 틱의 젬 수거가 세운 창과 갈린다.
 */
export function arccasterComboDecay(state: WorldState, player: Entity): boolean {
  const ba5 = lv(state, Sk.staticCombo);
  if (ba5 < 1) return false;
  if (!overcharged(player)) return false;
  return state.tick % staticComboPeriod(ba5) !== 0;
}

// ---------------------------------------------------------------------------
// 앵커 ㉗ — 액티브 핸들러 호출 직후(쿨다운 대입 앞)
// ---------------------------------------------------------------------------

/** BA1 원형 볼리의 탄수 상한 — 레벨이 어픽스로 20을 넘어도 탄 폭주가 되지 않게 유계로 묶는다. */
const REDEPLOY_SALVO_CAP = 20;

/** CH7 여진탄 수 상한. `aux0` 상한이 600 이라 무클램프면 저레벨에서도 30발이 나간다. */
const RESIDUAL_BOLT_CAP = 12;

/** 점 → 선분 거리의 **제곱**. BA4 가 점멸 항로(출발→착지)를 띠로 훑는 데 쓴다. */
function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = 0;
  if (len2 > 0) {
    t = ((px - ax) * vx + (py - ay) * vy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return dx * dx + dy * dy;
}

/**
 * 앵커 ㉗ — **CH7 잔류 방전 · CH10 주입 전격 · BA1 재배치 일제사 · BA4 소거 항로 · BA6 분신 포좌.**
 *
 * ## 계열 게이트는 **축 인덱스 + tier** 다 — id 문자열도 `kind` 도 아니다
 * 설계 문면의 「방전 액티브」는 chain 축 **hi** 한 종뿐이다(`as_arccaster_chain_hi` — 발동 후
 * `aux0 = 0`). **lo 를 같이 태우면 안 된다**: lo 는 `aux0` 를 90 으로 *세우는* 주입형이라,
 * 만충(600)에서 쏘면 `preAux0 - aux0 = 510` 이 되어 CH7 이 "소모한 정지 시간"을 오독한다.
 * 「점멸 액티브」는 barrage 축 두 종 모두(둘 다 `kind: 'dash'`), 「**장거리** 점멸」은 그중
 * hi(distance 900) 한 종이다.
 * ⚠️ `kind === 'dash'` 로 판정하지 마라 — 다른 축이 훗날 dash 를 얻으면 조용히 샌다(PH2 선례).
 *
 * ## ⚠️ 여기서 스폰이 안전한 근거
 * 앵커 doc 그대로다 — `stepActives` 는 `state.entities` 를 순회하지 않는다. BA1(`fanStrike`)과
 * BA6(`spawnEventObject`)이 그래서 이 자리에서 바로 돈다.
 *
 * ## ⚠️ 쿨다운을 만지지 않는다
 * 호출부가 이 앵커 **직후** `state.activeCd0/1` 을 덮어쓴다(앵커 doc).
 *
 * ## 적 `hp` 를 깎는 경로가 없다
 * 다섯 전부 탄·포탑·표식·수거뿐이라 좀비 결함(`dead` 미마킹)이 원리적으로 없다. RNG 소비 0.
 */
export function arccasterActiveFired(
  state: WorldState,
  player: Entity,
  def: ActiveSkillDef,
  dir: { x: number; y: number },
  origin: ActiveFiredOrigin,
): void {
  if (def.treeIndex === CHAIN_TREE_INDEX && def.tier === 'hi') {
    arccasterDischargeFired(state, player, origin);
    return;
  }
  if (def.treeIndex === BARRAGE_TREE_INDEX) {
    arccasterBlinkFired(state, player, def, dir, origin);
  }
}

/** 방전 액티브(chain hi) 전용 절반 — CH7 · CH10. */
function arccasterDischargeFired(
  state: WorldState,
  player: Entity,
  origin: ActiveFiredOrigin,
): void {
  // ── CH10 주입 전격 — **이 발동이 낳은 탄만** 표식한다.
  //    ⚠️ 워터마크는 `state.entities` 가 append-only 인 이번 틱 안에서만 유효하다(앵커 doc).
  //    소비는 앵커 ⑩({@link arccasterEnemyDamaged}).
  const ch10 = lv(state, Sk.primedStrike);
  if (ch10 >= 1) {
    for (let i = origin.spawnWatermark; i < state.entities.length; i++) {
      const e = state.entities[i];
      if (e === undefined || e.kind !== 'bullet') continue;
      e.aux0 = ARC_PRIMED_MARK;
    }
  }

  // ── CH7 잔류 방전 — 「충전을 비운 뒤 **소모한 정지 시간**에 비례해 최근접 적에게 여진탄」.
  //    소모량은 `preAux0 - aux0` 다. 방전 액티브는 `aux0 = 0` 이므로 사실상 `preAux0` 이지만,
  //    차분으로 적는 편이 핸들러가 부분 방전으로 바뀌어도 따라온다(앵커 doc 의 의도).
  const ch7 = lv(state, Sk.residualDischarge);
  if (ch7 < 1) return;
  const spent = origin.preAux0 - player.aux0;
  if (spent <= 0) return;
  // 여진탄 1발당 요구 정지 틱 = 60 − 2×Lv (Lv1 = 58, Lv20 = 20). 하한 10 은 어픽스로 레벨이
  // 20을 넘겼을 때 분모가 0/음수로 무너지는 것을 막는다(설계 수치가 아니라 방어다).
  const perBolt = residualBoltCostTicks(ch7);
  let count = Math.floor(spent / perBolt);
  if (count <= 0) return;
  if (count > RESIDUAL_BOLT_CAP) count = RESIDUAL_BOLT_CAP;
  const target = nearestHostile(state, player);
  if (target === undefined) return;
  const tx = target.x - player.x;
  const ty = target.y - player.y;
  const d = Math.sqrt(tx * tx + ty * ty);
  if (d <= 0) return;
  // 전탄 동일 방향(spreadDeg = 0) = 「최근접 적에게」의 코드 형태. 피해 = 20 + 4×Lv.
  fanStrike(state, player, count, 20 + 4 * ch7, 0, { x: tx / d, y: ty / d });
}

/** 최근접 적성 표적(`enemy`/`boss`). 없으면 `undefined`. RNG 를 쓰지 않는 순수 스캔이다. */
function nearestHostile(state: WorldState, player: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD2 = Infinity;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = e;
    }
  }
  return best;
}

/** 점멸 액티브(barrage) 전용 절반 — BA1 · BA4 · BA6. */
function arccasterBlinkFired(
  state: WorldState,
  player: Entity,
  def: ActiveSkillDef,
  dir: { x: number; y: number },
  origin: ActiveFiredOrigin,
): void {
  // ── BA1 재배치 일제사 — 착지 순간 **전방위** 원형 볼리.
  //    ⚠️ `spreadDeg` 를 360 으로 두면 첫 탄과 끝 탄이 같은 각도에 겹친다(`step = spread/(n-1)`).
  //    360×(n−1)/n 이 균등 분포의 정본이다.
  const ba1 = lv(state, Sk.redeploySalvo);
  if (ba1 >= 1) {
    let count = redeploySalvoCount(ba1);
    if (count > REDEPLOY_SALVO_CAP) count = REDEPLOY_SALVO_CAP;
    fanStrike(state, player, count, redeploySalvoDamage(ba1), (360 * (count - 1)) / count, dir);
  }

  // ── BA4 소거 항로 — 출발→착지 선분에서 폭 안에 든 젬·전리품을 플레이어 자리로 당긴다.
  //
  //    ## ⚠️ 여기서 **수거하지 않는다** — 수거의 단일 수렴점은 `collectGem`/`collectLoot` 다
  //    그 둘은 `world.ts` 비공개 함수이고, 이 파일은 `world.ts` 를 런타임 import 하지 않는다
  //    (헤더 규율 ①). 대신 좌표를 플레이어에 붙이면 **같은 틱의** `resolveCollisions`
  //    (`stepActives` → `stepTurrets` → `stepGems` → `resolveCollisions` 순서)가 정규 경로로
  //    걷어간다 — 콤보·XP 가 한 곳에서만 갈린다. 사이에 낀 `stepGems` 는 거리 0 이라
  //    `d2 > 0.0001` 이 거짓이 되어 속도를 0 으로 두고 좌표를 안 움직인다.
  const ba4 = lv(state, Sk.sweepLane);
  if (ba4 >= 1) {
    const halfWidth = sweepLaneHalfWidth(ba4);
    const w2 = halfWidth * halfWidth;
    for (const e of state.entities) {
      if (e.dead) continue;
      if (e.kind !== 'gem' && e.kind !== 'loot') continue;
      if (distSqToSegment(e.x, e.y, origin.preX, origin.preY, player.x, player.y) > w2) continue;
      e.x = player.x;
      e.y = player.y;
      e.vx = 0;
      e.vy = 0;
    }
  }

  // ── BA6 분신 포좌 — **장거리** 점멸(barrage hi)만. 출발 자리에 임시 자동 포탑.
  //    수명은 `TURRET_LIFE_TICKS`(=600) 로 공용 규칙을 따른다 = 설계 문면의 「임시」.
  //    반경 44 는 보조무기 센트리와 같은 값이다(`world.ts` 의 SUB_TYPE_SENTRY 분기).
  if (def.tier !== 'hi') return;
  const ba6 = lv(state, Sk.echoMount);
  if (ba6 < 1) return;
  const mount = spawnEventObject(state, 'turretPickup', origin.preX, origin.preY, 44);
  mount.ownerId = DRONE_MARK; // 청크 기믹 컬링 제외(플레이어 소환물)
  activateTurret(mount);
}

// ---------------------------------------------------------------------------
// 앵커 ㉘ — 젬 자석 반경 확정 직후(제곱 **전**)
// ---------------------------------------------------------------------------

/**
 * **BA2 정지 흡인장** — 「정지 중 자석 반경이 **정지 시간에 비례해** 커진다」.
 *
 * 반경 배율 = 1 + (min(aux0, 190) / 190) × (20% + 2%p/Lv). 정지가 증폭 상한 도달치
 * (`OVERCHARGE_APEX_TICKS`)에 닿으면 Lv1 +20% · Lv20 +60% 다.
 *
 * ## ⚠️ 상한을 `OVERCHARGE_TICK_CAP`(600) 이 아니라 도달치(190) 로 잡은 이유
 * `aux0` 는 600 까지 쌓이지만 이 기체의 다른 모든 축은 190 에서 평평해진다(`overchargeBp`).
 * 600 으로 나누면 190~600 구간에서 **이 스킬만 계속 자라** 기체의 "만충" 감각이 축마다 갈린다.
 *
 * ## ⚠️ `radius` 는 **제곱 전**이다
 * 앵커 doc 의 경고 그대로 — "×1.5" 를 `×2.25` 로 번역하면 안 된다. 여기서는 배율을 그대로
 * 곱한다. 미투자(`ba2 < 1`)·이동 중(`aux0 === 0`)이면 대입 자체가 없어 비트 동일이다.
 */
export function arccasterGemMagnetParams(
  state: WorldState,
  player: Entity,
  params: GemMagnetParams,
): void {
  const ba2 = lv(state, Sk.stillMagnet);
  if (ba2 < 1) return;
  const still = player.aux0;
  if (still <= 0) return;
  const t = still > OVERCHARGE_APEX_TICKS ? OVERCHARGE_APEX_TICKS : still;
  const gainBp = Math.floor((t * stillMagnetMaxBp(ba2)) / OVERCHARGE_APEX_TICKS);
  params.radius = (params.radius * (10000 + gainBp)) / 10000;
}
