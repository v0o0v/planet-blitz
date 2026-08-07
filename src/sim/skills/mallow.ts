/**
 * **말로우 30스킬의 효과 본체**(ADR-0049 배치 4 · 설계 정본
 * `.omc/plans/skill-rebuild-2026-08-05/mallow.md` 확정 4판).
 *
 * 형태는 **스트라이커 레인이 확립한 다섯 규율을 그대로 따른다**(`skills/striker.ts` 헤더가 정본):
 * ①`world.ts` 런타임 import 0건(타입은 type-only) ②모든 쓰기는 투자 게이트 안쪽 ③반올림은
 * 게이트 안 ④RNG 소비 0 ⑤슬롯 접근은 `readSlot`/`writeSlot` 만.
 *
 * ---
 *
 * ## 배선 현황 — 배치 4 가 **6종**, S2 앵커 확장 레인이 **+8종**, S3 배선 레인이 **+1종(ME5)**,
 * W2 입력 배관 레인이 **+1종(SQ7)**, **말로우 앵커 레인이 +10종** = 지금 **27종 / 30**
 *
 * ### 말로우 앵커 레인이 연 것 (2026-08-07)
 *  - **앵커 ㉗ `onCushionSplit`**(지연 전환 분기 안 · 즉시분 확정 직전) — 아래 「지연 전환
 *    분기」가 *"여전히 앵커가 없다"* 고 적던 자리다. **CU1·CU2·CU5·CU6 4종**이 여기서 돈다.
 *  - **앵커 ㉘ `onCushionRecoverBp`**(탕감률 확정) — 순수 함수 `cushionRecovered`·
 *    `cushionSettled` 를 **탕감률 필수 인자**로 개정해 열었다(ME9 가 임계에서 겪은 것과 같은
 *    선결). **ME8** 이 돈다. ⚠️ 이 개정으로 **ME5 의 「현재율」 합성이 실제로 성립**하게 됐고
 *    ({@link mallowCushionSettleDue}), 그래서 **ME8 미투자 런에서도 ME5 의 이월 탕감이 바뀐다**
 *    — 종전 축약(현재율 0)이 전제하던 조건이 사라졌기 때문이다.
 *  - **앵커 ㉙ `onObjectiveResolved`**(에코 안정화 · 조우 완수 **두 지점**) — **ME7**.
 *  - **앵커 ㉚ `onEnemyStatusExpired`**(화상 만료) + **앵커 ⑪ 에 `burning` 인자 추가**
 *    (화상이 남은 채 죽은 적) — **SQ9**. 탕감 트리거 2경로가 둘 다 앵커 밖이었다.
 *  - 앵커 없이: **SQ10**(기존 앵커 ⑳ + cushion_hi EXPIRE 가 남기는 만기 표식) ·
 *    **SQ6·ME6**(액티브 핸들러가 이 모듈을 직접 부른다 — `activeHandlers/striker.ts` 선례).
 *
 * **남은 셋은 `lane/shared-anchors` 소유다** — CU8(`onPlayerMoveParams`) · ME2
 * (`onGemMagnetParams`) · ME3(`onActiveFired`/감속 소비부). 이 레인이 만들면 정의가 갈리고
 * `git` 은 그것을 못 잡는다(의미 충돌은 전부 `tsc` 만 잡았다).
 *
 * 말로우 30종의 설계는 시그니처 완충의 **두 분기**에 압도적으로 몰려 있었고, 배치 4 시점에는
 * 그 둘 다 앵커가 없었다. **S2 가 그중 하나(정산 분기)를 열었다.**
 *
 *  - **정산 분기**(`world.ts` 의 `stepShipSignature` 말로우 가지, `aux1 >= 임계` 안쪽) —
 *    여기를 요구하는 스킬이 **10종**이었다. S2 의 앵커 ⑳({@link onCushionSettled})이
 *    **정산 직후**를 열어 그중 **7종**(SQ2·SQ5·SQ8·ME4·CU3·CU9·CU10)이 배선됐다.
 *    남은 셋(ME5·ME8·ME9)은 ⑳ 으로 닿지 않는다 — 사유는 아래 「⑳ 으로도 못 여는 셋」.
 *    **S3 가 그중 ME5 의 자리를 열었고**(앵커 ㉕ `onCushionSettleDue`, 정산액 확정 **직전**)
 *    **배선 레인이 ME5 를 그 자리에 넣었다**({@link mallowCushionSettleDue}). 그리고 **순수 함수
 *    개정 레인이 ME9 를 열었다**({@link mallowSettleThreshold}, 앵커 ⑲). 그래서 정산 분기
 *    요구 10종 중 **9종**이 돌고, **ME8 하나만 남았다**(아래).
 *  - **발사부**(`autoAttack` 의 아키타입 분기) — S2 의 앵커 ⑯({@link onVolleyParams})이 열어
 *    SQ1 이 배선됐고, SQ5·SQ8 의 **소비처**도 여기다(적립만 하고 소비처가 없으면 반쪽이다).
 *    **SQ7(관성 사출)도 여기다.** 술어의 두 항 중 발사각은 S3 가(`aimAngle`), 입력 벡터는
 *    W2 가(`inputX`/`inputY` — `autoAttack` 이 `InputFrame` 을 아예 안 받고 있었다) 실었다.
 *    한 항만으로는 열리지 않았다는 점이 이 스킬의 기록이다.
 *  - **지연 전환 분기**(`cushionOn` 게이트, `cushionDeferredDamage` 분리부) — **여전히 앵커가
 *    없다.** CU1·CU2·CU5·CU6 이 그대로 막혀 있다. 앵커 ⑧({@link onDamageChain})은 이 분기보다
 *    앞이라 "지연분을 얼마나 뗄지"에는 닿지 않는다.
 *
 * ### ⚠️ 정산 분기를 앵커 ⑨ 에서 **예측**하지 않았다 — 그것이 배치 4 의 핵심 판단이었고 옳았다
 * 앵커 ⑨ 시점의 `aux0`·`aux1` 로 `aux0 > 0 && aux1 + 1 >= 임계` 를 계산할 수는 있었다. 그러면
 * 정산액(`cushionSettled`)·탕감액(`cushionRecovered`)·hp−1 클램프 후 적용액(`applied`)이 전부
 * 두 번째 사본이 된다. S2 의 ⑳ 은 그 셋을 **계산된 값 그대로** 넘긴다.
 *
 * ### ⚠️ ⑳ 으로는 못 여는 셋 — ME5(→ S3 의 ㉕ 로 옮겨졌다)·ME8·ME9 (반쪽 배선 금지)
 * 셋 다 **정산 산술 자체**를 바꾸는 스킬인데 ⑳ 은 hp 차감이 끝난 **뒤**다.
 *  - **ME9(임계 인하)** — ✅ **배선됐다**({@link mallowSettleThreshold}). ⚠️ 종전 사유를
 *    지우지 않는다: 앵커 ⑲({@link onCushionThreshold})이 자리를 열었지만
 *    `cushionSettled`·`cushionRecovered` 가 **자기 안에서 `unhitTicks < CUSHION_RECOVER_TICKS`
 *    를 다시 검사해 0 을 돌려주었고**, 임계를 낮춰 분기에 진입시켜도 정산액이 0 이라 **조용히
 *    아무 일도 안 일어났다**(테스트 §⑩ 이 그 사실을 잠갔었다). 순수 함수 개정 레인이 두 함수를
 *    **임계 필수 인자**로 고쳐 그 선결을 해소했고, CU7 의 분모도 같은 함수로 함께 옮겼다.
 *  - **ME8(탕감률 상승)** — 탕감 bp(`CUSHION_RECOVER_BP`)가 `cushionRecovered` 안에 있다.
 *    ME9 와 **같은 계열의 선결**이다. ⑳ 에서 사후 환급으로 흉내 낼 수는 없다: hp−1 클램프가
 *    이미 물린 정산에서는 "탕감을 늘려 선체행을 줄인" 결과와 "깎고 나서 되돌린" 결과가
 *    **수치로 갈린다**(클램프가 소멸시킨 초과분이 복원되지 않는다).
 *  - **ME5(분할 상환)** — 같은 이유였다. 절반만 선체로 보내려면 hp 차감 **전**에 정산액을 갈라야
 *    하고, 사후 환급은 클램프가 물린 정산에서 어긋난다. 정산액 확정 **직전**의 앵커가 필요했다.
 *    → **S3 가 그 앵커를 뚫었고**(㉕ `onCushionSettleDue`) **배선이 끝났다** — ME5 는 ⑳ 이
 *    아니라 **㉕** 에서 돈다. **ME8 은 ㉕ 으로도 여전히 못 온다** — 탕감률
 *    (`CUSHION_RECOVER_BP`)이 `shipSignature.ts` 순수 함수 **안**이라 ㉕ 에 닿은 시점엔 이미
 *    그 상수로 계산이 끝나 있다. ⚠️ ME9 도 같은 사유(임계가 순수 함수 안)로 막혀 있었고,
 *    이 레인이 **임계만** 인자로 빼서 열었다 — 탕감률은 손대지 않았으므로 ME8 의 선결은
 *    그대로 남아 있다(`cushionRecovered` 가 `CUSHION_RECOVER_BP` 를 인자로 받는 개정이 필요).
 *    ⚠️ ME5 의 레벨 스케일에 나오는 「현재율」이 바로 ME8 이 올려 둔 탕감률이라, ME8 이 도는
 *    날 {@link mallowCushionSettleDue} 의 호출부를 여백 합성으로 고쳐야 한다.
 *
 * 여기 없는 스킬은 "구현했는데 안 불린다"가 아니라 **아직 코드가 없다.** 사유는 각 앵커의
 * `case` 주석과 레인 보고서에 있다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
import type { VolleyParams } from '../skillHooks.js';
import type { CushionSplitParams, ObjectiveKind, EnemyStatusKind } from '../skillHooks.js';
import { blastDamage, clearEnemyBullets, fanStrike } from '../activeTypes.js';
import { CUSHION_RECOVER_TICKS, CUSHION_TICK_CAP } from '../shipSignature.js';
import { readSlot, writeSlot, MallowCarry, MallowStage } from '../skillSlots.js';
import { applyBurn, applySlow, FIRE_DURATION, COLD_DURATION } from '../status.js';
import { skillLv } from '../../items/skills.js';
import { cos, sin, length } from '../math.js';
import { activeByWireId } from '../../../data/ships/actives/index.js';

// ---------------------------------------------------------------------------
// flat 인덱스 — `data/ships/mallow.ts` 의 축 순서가 정본
// ---------------------------------------------------------------------------
//
// `trees: [squish(offense), mend(utility), cushion(defense)]` 이므로
// SQ1..SQ10 = 0..9 · ME1..ME10 = 10..19 · CU1..CU10 = 20..29 다.
//
// ⚠️ **세 선행 기체가 전부 축 순서가 달랐다.** 스트라이커 [offense, defense, utility] ·
// 아크캐스터 [offense, utility, defense] · 브루저도 자기 순서가 있다. 말로우는 아크캐스터와
// 같은 [offense, utility, defense] 지만 **그것은 우연이고**, 정본은 언제나
// `data/ships/{ship}.ts` 의 `trees` 배열이다 — 설계서의 서술 순서(SQ→ME→CU)와 우연히 일치하는
// 것에 기대지 마라.

const enum Sk {
  /** SQ1 부채 격노 */ debtFury = 0,
  /** SQ2 청산 폭발 */ settlementBlast = 1,
  /** SQ3 몸통 반발 */ bodyRecoil = 2,
  /** SQ4 압인 탄두 */ debtStamp = 3,
  /** SQ5 탕감 장전 */ forgivenessLoader = 4,
  /** SQ6 즉석 환전 */ instantExchange = 5,
  /** SQ7 관성 사출 */ momentumLaunch = 6,
  /** SQ8 흉터 포문 */ scarCannon = 7,
  /** SQ9 이자 소각 */ interestBurn = 8,
  /** SQ10 만기 일제 */ maturityVolley = 9,
  /** ME1 조기 상환 */ earlyRepayment = 10,
  /** ME4 반환 요법 */ rebateTherapy = 13,
  /** ME5 분할 상환 */ installmentPlan = 14,
  /** ME6 잔상 세척 */ afterimageRinse = 15,
  /** ME7 에코 채권 */ echoBond = 16,
  /** ME8 리듬 탕감 */ rhythmForgiveness = 17,
  /** ME9 솜틀 요양 */ fluffConvalescence = 18,
  /** ME10 성장 환전 */ growthConversion = 19,
  /** CU1 과부하 흡수 */ overloadAbsorb = 20,
  /** CU2 부채 한도 */ debtCeiling = 21,
  /** CU3 무통 정산 */ painlessSettlement = 22,
  /** CU4 반발 세척 */ recoilRinse = 23,
  /** CU5 전량 유예 태세 */ fullDeferralStance = 24,
  /** CU6 파산 보호 */ bankruptcyProtection = 25,
  /** CU7 아문 살갗 */ healedHide = 26,
  /** CU9 유예의 은총 */ graceOfSettlement = 28,
  /** CU10 영구 채무 자본화 */ perpetualCapitalization = 29,
}

/**
 * 이 런에서 그 스킬의 **실효 레벨**(투자 + 축 어픽스). 미투자면 0 이다(`skillLv` 정본 1).
 * 기체 게이트는 호출부(`skillHooks.ts` 의 `case SIG_MALLOW_CUSHION`)가 이미 걸었다.
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

/**
 * CU7 의 만충 감소량 K = 1500 + 3500×Lv/(Lv+12) bp.
 * Lv1 ≈ 1769 · Lv20 ≈ 3687 · **점근 5000**(= 최대 50%) — 어픽스로 레벨이 20 을 넘어도
 * 10000bp 에 닿지 못하므로 피해가 음수가 되는 특이점이 없다(설계서 수지 불변식 3).
 *
 * ⚠️ 나눗셈이 `createWorld` 가 아니라 여기 있는 이유는 스트라이커 헤더가 적은 그대로다 —
 * `world.ts` 가 이 모듈을 런타임 import 하면 순환의 씨앗이 되고, 공식을 `world.ts` 에 다시
 * 적으면 이중 정본이 된다. 이 함수는 **피격 틱에만** 불린다(매 틱 나눗셈이 아니다).
 */
function healedHideMaxBp(level: number): number {
  return 1500 + (3500 * level) / (level + 12);
}

/**
 * ME9 가 요구하는 **연속** 벽 접촉 틱(설계서 3R M3: K = 60 고정).
 *
 * ⚠️ "정산 틱에 접촉" 이 아니라 **직전 60틱 연속 접촉**이다. 3판 안(정산 틱만 판정)은 129틱을
 * 멀리서 보내고 마지막 1틱만 벽을 짚어 정산을 임의 발동하는 기술이 됐고, CU9(정산 무적)·
 * SQ2(정산 폭발)와 조합하면 정산이 리듬이 아니라 스킬샷이 된다 — 설계서가 폐기한 안이다.
 * `state.wallContactTicks` 는 접촉이 끊기면 0 으로 리셋되는 **연속** 카운터라 그대로 쓴다.
 */
const ME9_WALL_TICKS = 60;

/** ME9 의 임계 **인하폭**(틱) = round(20 + 50×Lv/(Lv+12)). Lv1 ≈ 24 · Lv20 ≈ 51 · 점근 70. */
function fluffConvalescenceCut(level: number): number {
  return Math.round(20 + (50 * level) / (level + 12));
}

/**
 * 이번 틱의 **실효 정산 임계**(양의 정수). 앵커 ⑲(`onCushionThreshold`)과 CU7 의 감소 분모가
 * **둘 다 이 함수 하나**를 부른다 — 설계서 2R M2 가 "분모 180 하드코딩은 ME9 임계 인하와
 * 충돌해 아키타입 3 이 자기모순" 이라고 지목한 자리를 한 곳으로 합친 것이다.
 *
 * ⚠️ **상수를 복제하지 않는다.** `base` 는 앵커가 넘겨 주는 `CUSHION_RECOVER_TICKS` 다.
 * CU7 경로만은 앵커를 거치지 않으므로(감쇠 사슬은 정산 분기 밖이다) 그 호출부가 같은 상수를
 * 넘긴다 — 값의 출처는 여전히 `shipSignature.ts` 하나다.
 *
 * ⚠️ 하한 1 을 건다. 인하폭이 임계를 넘기면 `unhitTicks >= 0` 이 항상 참이 되어 **매 틱 정산**
 * 이 되고 완충이라는 축이 사라진다(앵커 ⑲ 의 계약이 "양의 정수" 인 이유). 현행 수치로는
 * 도달하지 않지만(점근 인하폭 70 < 180) 어픽스 연장이 붙는 축이라 구조로 막는다.
 *
 * ⚠️ **미투자 런은 `base` 를 그대로 돌려준다** — RNG 미소비이고 비트 불변이다.
 */
export function mallowSettleThreshold(state: WorldState, base: number): number {
  const me9 = lv(state, Sk.fluffConvalescence);
  if (me9 < 1) return base;
  if (state.wallContactTicks < ME9_WALL_TICKS) return base;
  const cut = fluffConvalescenceCut(me9);
  const t = base - cut;
  return t > 1 ? t : 1;
}

/** ME10 의 부채→XP 전환율(%) = 20 + 50×Lv/(Lv+10). Lv20 ≈ 53 · 점근 70. */
function growthConversionPct(level: number): number {
  return 20 + (50 * level) / (level + 10);
}

/** SQ1 의 증폭 상한 bp = 1000 + 3000×Lv/(Lv+10). Lv20 = 3000 · 점근 4000. */
function debtFuryCapBp(level: number): number {
  return 1000 + (3000 * level) / (level + 10);
}

/** SQ8 의 증폭 상한 bp = 800 + 2400×Lv/(Lv+12). Lv20 = 2300 · 점근 3200. */
function scarCannonCapBp(level: number): number {
  return 800 + (2400 * level) / (level + 12);
}

/**
 * ME5 의 **이월분 탕감률** bp = 6000×Lv/(Lv+20). Lv1 ≈ 286 · Lv20 = 3000 · **점근 6000**
 * (= 여백의 최대 60% 만 잠식). 설계서 ME5 「레벨 스케일」의 여백 비례 점근형 그대로다.
 *
 * ⚠️ 설계서 공식의 일반형은 *갱신값 = 현재율 + (10000 − 현재율) × r / 10000* 이고, 그 「현재율」은
 * **ME8「리듬 탕감」이 올려 둔 탕감률**을 뜻한다. ME8 은 아직 미배선이라(탕감률 상수
 * `CUSHION_RECOVER_BP` 가 `shipSignature.ts` 순수 함수 **안**이라 앵커 ㉕ 에 닿을 수 없다)
 * 현재율은 항상 0 이고, 그러면 갱신값 = r 로 정확히 축약된다. ME8 이 도는 날 이 함수의
 * 호출부가 여백 합성으로 바뀌어야 한다 — 합산 상한(불변식 3)은 설계서가 증명해 뒀다.
 */
function installmentForgiveBp(level: number): number {
  return (6000 * level) / (level + 20);
}

/** ME4 의 탕감→회복 전환율(%) = 20 + 60×Lv/(Lv+15). Lv20 = 54 · 점근 80. */
function rebateTherapyPct(level: number): number {
  return 20 + (60 * level) / (level + 15);
}

/** CU3 의 회당 상한 비율(%) = round(30 − 18×Lv/(Lv+10)). Lv20 = 18 · 점근 12. */
function painlessSettlementPct(level: number): number {
  return Math.round(30 - (18 * level) / (level + 10));
}

/** CU10 의 탕감→maxHp 전환율(%) = round(4 + 16×Lv/(Lv+16)). Lv20 ≈ 13 · 점근 20. */
function capitalizationPct(level: number): number {
  return Math.round(4 + (16 * level) / (level + 16));
}

/**
 * CU1 의 **대형 피해 임계**(절대 피해량) = round(40 − 25×Lv/(Lv+10)).
 * Lv1 ≈ 38 · Lv20 ≈ 23 · 점근 15 — 레벨이 오르면 더 작은 피해도 "대형" 으로 취급된다.
 *
 * ⚠️ **maxHp 비율이 아니라 절대값이다**(설계 정본 그대로). 비율로 바꾸면 계보·장비로 기본 HP 를
 * 부풀리는 이 기체의 성장축에서 임계가 함께 부풀어 스킬이 레벨과 무관하게 죽는다.
 */
function overloadThreshold(level: number): number {
  return Math.round(40 - (25 * level) / (level + 10));
}

/** CU2 의 부채 한도 비율(%) = round(25 + 30×Lv/(Lv+12)). Lv1 ≈ 27 · Lv20 ≈ 44 · 점근 55. */
function debtCeilingPct(level: number): number {
  return Math.round(25 + (30 * level) / (level + 12));
}

/**
 * CU5 의 **지속 중 지연율** bp = 6000 + 3500×Lv/(Lv+12). Lv1 ≈ 6269 · Lv20 ≈ 8188 ·
 * **점근 9500 < 10000** — 즉시분이 0 이 되는 특이점이 없다(설계서 "즉시분 0 금지").
 */
function fullDeferralBp(level: number): number {
  return 6000 + (3500 * level) / (level + 12);
}

/**
 * CU6 발동 시 세울 무적 틱 = 30 + 3×Lv.
 *
 * ⚠️ 실제 적용은 `max(hitIframes, 이 값)` 이다(설계서 3R-6). 기본 `hitIframes` 가 40 이라
 * 하한을 안 걸면 **Lv1~3 의 무적이 통상 피격 무적보다 짧아 효과가 통째로 무효**가 된다 —
 * 화면상 조용한 미발현이다. `max` 는 소비처({@link mallowPlayerDamaged})가 진다.
 */
function bankruptcyIframeTicks(level: number): number {
  return 30 + 3 * level;
}

/**
 * ME7 의 **소각액→자석 버프 틱** 전환율(%) = 60 + 40×Lv/(Lv+10).
 * Lv1 ≈ 63.6 · Lv20 ≈ 86.7 · 점근 100 — floor 로 접어 잔여를 버린다(신규 캐리 0).
 */
function echoBondPct(level: number): number {
  return 60 + (40 * level) / (level + 10);
}

/** ME7 이 한 번에 열 수 있는 자석 버프 창의 상한(틱). 설계서 ME7 「레벨 스케일」의 600. */
const ECHO_BOND_TICK_CAP = 600;

/** SQ9 의 만료·사망 1회당 부채 탕감량 = 3 + floor(Lv/2) (2레벨 폭 정수 계단). */
function interestBurnForgive(level: number): number {
  return 3 + Math.floor(level / 2);
}

/**
 * SQ9 가 부여하는 화상의 **틱당 피해** = round(기본 화염 × (100 + 4×Lv) / 100).
 *
 * ⚠️ 설계서는 *"기본 화염 기준 틱당 피해 +4%p/Lv"* 라고만 적고 「기본 화염」의 수치를 정의하지
 * 않았다. 이 저장소에서 그 이름이 가리키는 유일한 값은 원소 프리픽스 `flaming` 의 굴림
 * 범위(`data/affixes.ts` 의 `fireDmg` min 2 · max 5)이고, **하한 2** 를 기준으로 잡았다 —
 * 스킬이 어픽스 최상 굴림보다 세지 않게 하는 보수적 선택이다(Lv20 에서 4 로 max 5 미만).
 * 설계서가 수치를 명시하면 그 값이 정본이다.
 */
const SQ9_BURN_BASE = 2;
function interestBurnDamage(level: number): number {
  return Math.round((SQ9_BURN_BASE * (100 + 4 * level)) / 100);
}

/**
 * SQ10 의 **정산액당 탄수 제수** = 30 − 20×Lv/(Lv+15). Lv1 = 28.75 · Lv20 ≈ 18.6 ·
 * 점근 10 — 레벨이 오를수록 같은 정산액에서 탄이 조밀해진다.
 */
function maturityDivisor(level: number): number {
  return 30 - (20 * level) / (level + 15);
}

/**
 * ME8 의 **실효 탕감률** bp = base + 3500 × (스택×Lv) / (스택×Lv + 120).
 * 10스택 Lv20 = 6000 + 3500×200/320 ≈ 8188 · **점근 base + 3500 = 9500 < 10000** —
 * 어떤 스택·레벨·어픽스 연장에서도 전액 탕감(부호 반전)에 닿지 않는다(설계서 불변식 3).
 *
 * ⚠️ `base` 는 앵커 ㉘ 이 넘겨 주는 {@link CUSHION_RECOVER_BP} 다 — 상수를 복제하지 않는다.
 */
function rhythmForgivenessBp(base: number, stacks: number, level: number): number {
  const sl = stacks * level;
  return base + (3500 * sl) / (sl + 120);
}

// ---------------------------------------------------------------------------
// 앵커별 진입점 — `skillHooks.ts` 의 `case SIG_MALLOW_CUSHION:` 이 부른다
// ---------------------------------------------------------------------------

/**
 * 앵커 ③ **젬 수거** — ME1 조기 상환.
 *
 * 젬 1개당 무피격 카운터(`aux1`)가 `2 + floor(Lv/2)` 틱 추가로 흐른다 — "줍는 행위가 쉬는
 * 시간으로 인정된다".
 *
 * ⚠️ {@link CUSHION_TICK_CAP} 클램프가 **필수**다(설계서 공통 고지 ③). `aux1` 은 u32 로
 * 해시되므로(`replay.ts` `hashEntity`) 상한 없이 밀면 적립분이 0 인 긴 구간에서 값이 무한히
 * 커진다. 액티브 핸들러의 `addUnhitTicks` 가 같은 규율을 쓰고, 그 상한 상수는
 * `shipSignature.ts` 한 곳이 정본이다.
 */
export function mallowGemCollected(state: WorldState, player: Entity): void {
  const me1 = lv(state, Sk.earlyRepayment);
  if (me1 < 1) return;
  const add = 2 + Math.floor(me1 / 2);
  const next = Math.trunc(player.aux1) + add;
  player.aux1 = next > CUSHION_TICK_CAP ? CUSHION_TICK_CAP : next;
}

/**
 * 앵커 ④ **선체 hp 가 깎인 피격의 후속** — SQ3 몸통 반발 · CU4 반발 세척.
 *
 * ## 이 앵커는 완충 적립 **뒤**다 — 그것이 CU4 설계의 요구다
 * 설계서 CU4 는 *"첫 피격도 발동한다 — 적립이 같은 틱이므로 aux0 게이트는 적립 **후** 판정으로
 * 명시"* 라고 적었다. `world.ts` 의 호출 순서가 `aux0 += deferred` → `onPlayerDamaged` 이므로
 * 이 조건이 배선으로 이미 성립한다(여기서 적립을 흉내 내 보정하면 두 곳이 갈린다).
 *
 * @param dmg **즉시분**(지연분을 뗀 뒤 실제로 hp 에서 깎인 양). SQ3 의 반격 피해가 이것에
 *   비례한다 — 설계서의 "이번 피격의 즉시분" 그대로다.
 */
export function mallowPlayerDamaged(state: WorldState, player: Entity, dmg: number): void {
  // --- CU6 파산 보호의 **무적 집행** — 요구는 앵커 ㉗ 이 슬롯에 남겼다 ----------
  //
  // ⚠️ 이 자리인 이유: ㉗ 바로 뒤에서 `world.ts` 가 `player.iframes = hitIframes` 를 **대입**
  // 하므로 거기서 세운 값은 예외 없이 덮인다. 이 앵커는 그 대입 **뒤**라 `max` 가 성립한다.
  // ⚠️ `max` 형태인 것이 스킬의 성립 조건 그 자체다(설계서 3R-6) — 기본 `hitIframes` 가 40 이라
  // 하한을 안 걸면 Lv1~3(33~39틱)의 무적이 통상 피격 무적보다 짧아 **효과가 통째로 무효**가
  // 된다. 요구는 소비 즉시 지운다(안 지우면 다음 피격에도 계속 서서 상시 장무적이 된다).
  const want = readSlot(state.skillStage, MallowStage.bankruptcyIframes);
  if (want > 0) {
    if (player.iframes < want) player.iframes = want;
    writeSlot(state.skillStage, MallowStage.bankruptcyIframes, 0);
  }
  // --- SQ3 몸통 반발 — 최근접 적 1기에게 즉시분 비례 반격 ---------------------
  const sq3 = lv(state, Sk.bodyRecoil);
  if (sq3 >= 1 && dmg > 0) {
    // 반환 배율 = 60 + 8×Lv %. 반올림은 이 게이트 **안**이다(규율 ③) — 접촉 피해는 엘리트
    // 배율이 섞여 소수일 수 있고, 밖으로 빼면 스킬 없는 런까지 바뀐다.
    const back = Math.round((dmg * (60 + 8 * sq3)) / 100);
    if (back > 0) {
      // 탐색 반경 260 고정 · 대상 `kind === 'enemy'` 한정(설계서: 보스·guardian·구조물 제외).
      // 제곱 비교라 `Math.sqrt` 가 낄 자리가 없다(`nearestTarget` 과 동형).
      const r2 = 260 * 260;
      let best: Entity | undefined;
      let bestD2 = r2;
      for (const e of state.entities) {
        if (e.dead || e.kind !== 'enemy') continue;
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = e;
        }
      }
      // `hp<=0` 이면 그 자리에서 `dead` 를 세운다 — `compact()`(`world.ts`)는 **`dead === true`
      // 만 수거**하므로 안 세우면 hp≤0 인 적이 **좀비**로 남아 처치·젬·드랍이 전부 유실된다.
      // 형태는 `status.ts` 의 `applyChain`·`tickEnemyStatus`(그리고 이제 `blastDamageAt`)와
      // 같은 두 줄이다 — 플래그만 세우고 **집계는 `compact()` 단일 수렴점**에 맡긴다. `dead` 는
      // 수거 대상 표시일 뿐 킬을 세는 행위가 아니라서 킬이 두 벌이 되지 않는다(집계 술어는
      // `compact` 안의 `e.kind === 'enemy' && e.hp <= 0` 에서 `state.kills++` 단 한 곳이고,
      // 수거된 적은 `survivors` 에 안 실려 다음 틱에 다시 보이지 않는다).
      if (best !== undefined) {
        best.hp -= back;
        if (best.hp <= 0) best.dead = true;
      }
    }
  }
  // --- CU4 반발 세척 — 부채 보유 중에만 발동, 반경도 부채 파생 -----------------
  const cu4 = lv(state, Sk.recoilRinse);
  if (cu4 >= 1) {
    const debt = Math.trunc(player.aux0);
    if (debt > 0) {
      // 기본 반경 70 + 6×Lv, 부채 비례 확장 = aux0 × 2 (확장분 상한 = 기본 반경의 2배).
      const base = 70 + 6 * cu4;
      const grow = debt * 2;
      const cap = base * 2;
      clearEnemyBullets(state, player, base + (grow > cap ? cap : grow));
    }
  }
}

/**
 * 앵커 ⑧ **감쇠 사슬의 스킬 슬롯** — CU7 아문 살갗(감소 칸). 흡수 칸을 쓰는 말로우 스킬은 없다.
 *
 * 연속 무피격 틱(`aux1`)에 비례해 받는 피해가 줄어든다 — 브루저(맞아야 장갑)의 정확한 반대
 * 문법이고, 정산이 `aux1` 을 0 으로 되돌리므로 "탕감 직후가 가장 약하다"는 긴장이 내장된다.
 *
 * ## 분모 T 는 **그 틱의 실효 정산 임계**다 — ME9 와 함께 움직인다
 * 설계서(2R M2)의 정의 그대로다: *"기본 180, ME9 벽 접촉 중엔 인하된 값"*.
 * ⚠️ 종전에는 여기가 **상수 180 하드코딩**이었고, 그 이유는 ME9 가 미배선이라 실효 임계가
 * 언제나 기본값이었기 때문이다(설계서가 무상한 하드코딩을 결함으로 지목한 자리가 정확히
 * 여기였다 — **사유를 지우지 않는다**). 이 레인이 ME9 를 배선하면서 분모를
 * {@link mallowSettleThreshold} 로 함께 옮겼다. 안 옮겼으면 "임계에 가까울수록 단단하다" 는
 * 의미가 두 스킬 병존에서 깨진다(ME9 로 임계가 130 이 돼도 분모는 180 이라, 만충 무피격에서
 * 감소량이 K 에 못 미친다).
 *
 * ⚠️ CU7 만 투자하고 ME9 는 미투자인 런에서는 `mallowSettleThreshold` 가 `base` 를 그대로
 * 돌려주므로 종전과 **비트 동일**이다.
 *
 * ## ⚠️ 이 자리는 설계서가 지정한 자리보다 **앞**이다 — 말로우 런에서는 같은 값이다
 * 설계서 구현 항은 *"지연 전환 분기 직전"* 을 요구했는데, 사슬에 뚫린 스킬 자리는 앵커 ⑧
 * 하나뿐이고 그것은 브루저 장갑·버블 막보다 **앞**이다. 그 둘은 말로우 런에 존재하지 않으므로
 * (런당 기체 1대) 순서 차이가 관측 가능한 결과를 만들지 않는다.
 *
 * ## ⚠️ 이 감소는 **지연 정산분에 걸리지 않는다**
 * 정산이 hp 를 깎는 경로(`stepShipSignature` 의 말로우 가지)는 감쇠 사슬을 타지 않는다. 즉
 * CU7 은 "지금 들어오는 피격"만 깎고 "나중에 갚는 몫"은 못 깎는다. 설계서의 서술("받는 피해가
 * 감소")과 어긋나 보일 수 있으나, 설계서 자신이 CU7 의 자리를 **지연 전환 분기 직전**(= 피격
 * 경로)으로 못 박았으므로 의도된 범위다.
 */
export function mallowDamageChain(state: WorldState, player: Entity, dmg: number): number {
  const cu7 = lv(state, Sk.healedHide);
  if (cu7 < 1) return dmg;
  const unhit = Math.trunc(player.aux1);
  if (unhit <= 0) return dmg;
  const t = mallowSettleThreshold(state, CUSHION_RECOVER_TICKS);
  const capped = unhit > t ? t : unhit;
  // 감소 bp = round(min(aux1, T) × K / T). 정수 bp 단일 나눗셈 + 반올림 1회로, 브루저 장갑·
  // 스트라이커 S4 와 동형이다(소수 피해가 들어와도 같은 방식으로 접힌다).
  const bp = Math.round((capped * healedHideMaxBp(cu7)) / t);
  if (bp <= 0) return dmg;
  return dmg - Math.round((dmg * bp) / 10000);
}

/**
 * 앵커 ⑩ **적이 아군탄에 맞아 피해가 확정된 직후** — SQ4 압인 탄두.
 *
 * 부채 보유 중(`aux0 > 0`) 발사한 탄이 명중한 적을 **좌표 직접 변위**로 밀어낸다. 속도 대입이
 * 아니다 — 넉백 규율(인벤토리 7.1 · `filmBurstPush` 선례)이 그것을 금지한다(속도에 실으면
 * 이동 적분과 겹쳐 밀린 거리가 무대·프레임에 따라 달라진다).
 *
 * ## 방향은 **탄의 진행 방향**이다
 * `source.vx/vy` 를 정규화해 쓴다. `angle` 을 쓰지 않는 것은 파생탄(미사일·분열 파편)이
 * `angle` 과 실제 진행 방향이 갈릴 수 있기 때문이고, `Math.sqrt` 는 IEEE754 정확 연산이라
 * 결정론에 안전하다.
 *
 * ## 대상 한정
 * `kind === 'enemy'` 만 민다. 이 앵커에는 `boss`·`core`·`guardian`·`destructible`·침공 설비까지
 * 전부 오는데, 부동 구조물을 좌표로 밀면 지형이 어긋난다. 설계서의 "보스·엘리트 반감" 중
 * **엘리트 반감**만 여기서 성립한다(보스는 애초에 대상 밖이라 반감이 아니라 전면 제외다).
 *
 * ⚠️ 이 지점은 `for (const b of state.entities)` 순회 안이다 — 스폰하지 않는다(앵커 주석).
 */
export function mallowEnemyDamaged(
  state: WorldState,
  player: Entity,
  target: Entity,
  source: Entity | undefined,
): void {
  // 두 스킬 다 **부채 보유 중 · `kind === 'enemy'`** 라는 같은 관문을 지난다.
  if (Math.trunc(player.aux0) <= 0) return;
  if (target.dead || target.kind !== 'enemy') return;
  // --- SQ9 이자 소각 — 부채 보유 중 명중한 적에게 화상을 부여한다 -----------------
  //
  // ⚠️ **부여에서는 탕감하지 않는다.** 1판의 "부여당 탕감" 은 빔(pierce 9999 재도포)·발칸
  // 연사가 틱당 수십 회 부여를 일으켜 `aux0` 을 상시 0 으로 만들고 **부채 술어 4종
  // (SQ1·SQ4·ME2·CU8)을 통째로 사문화**시키는 결함이었다(설계 1R C5). 탕감은 만료(앵커 ㉚)와
  // 사망(앵커 ⑪) 두 경로에서만 일어나고, 그 둘은 적 1기당 화상 1사이클에 정확히 1회다.
  //
  // ⚠️ `applyBurn` 은 "더 강한 값 유지" 갱신이라(status.ts) 어픽스 화염과 겹쳐도 두 벌이
  // 되지 않는다 — 갱신 규칙을 여기서 흉내 내지 않고 정본 leaf 를 그대로 부른다.
  const sq9 = lv(state, Sk.interestBurn);
  if (sq9 >= 1) {
    const dot = interestBurnDamage(sq9);
    if (dot > 0) applyBurn(target, dot, FIRE_DURATION);
  }
  // --- SQ4 압인 탄두 — 명중한 적을 좌표 직접 변위로 밀어낸다 ---------------------
  const sq4 = lv(state, Sk.debtStamp);
  if (sq4 < 1) return;
  if (source === undefined) return;
  const vx = source.vx;
  const vy = source.vy;
  const len = Math.sqrt(vx * vx + vy * vy);
  if (!(len > 0)) return;
  // 변위 = 12 + 3×Lv (sim 좌표). 엘리트(`pierce > 0` — `isElite` 와 같은 술어)는 반감.
  let push = 12 + 3 * sq4;
  if (target.pierce > 0) push = Math.round(push / 2);
  if (push <= 0) return;
  target.x += (vx / len) * push;
  target.y += (vy / len) * push;
}

/**
 * 앵커 ⑭ **파워업이 실제로 적용된 직후** — ME10 성장 환전.
 *
 * 부채의 절반이 소각되고 그 소각분이 **런 풀 XP**(`state.xp`)로 환전된다.
 *
 * ## ⚠️ 메타 풀(`state.xpTotal`)에는 한 톨도 넣지 않는다
 * 설계서가 ADR-0036 이원화를 근거로 못 박은 계약이다 — 메타에 넣으면 **피격이 계정 성장 재화가
 * 되는 경제 구멍**이 된다(`settlement.ts` 가 런 산출을 계정 재화로 옮기는 계층이다).
 *
 * ## 연쇄 레벨업은 기존 규칙 그대로다
 * 가산된 XP 로 다음 임계에 즉시 도달하면 `checkLevelUp` 의 기존 규칙(`xp -= need` 후
 * `pendingLevelUp` 재설정 · 다음 틱 최상단 프리즈)이 그대로 돈다. 이 훅은 XP 를 넣을 뿐
 * 프리즈·픽 루프를 변형하지 않는다 — 앵커 ⑫ 가 금지한 "`state.xp` 를 올려 다단 레벨업을
 * 유도"는 **한 틱 안에서 프리즈를 건너뛰는 것**을 말하고, 이 지점은 픽이 이미 소비돼 프리즈가
 * 풀린 뒤라 다음 레벨은 정상 경로로 열린다.
 *
 * ## floor 단일 나눗셈 — 캐리 상태 없음
 * 잔여는 버린다(설계서 2R S4: milli 캐리를 두면 `WorldState` 신규 정수가 되어 구현 태그가
 * B 로 올라가고 mend 축 B 예산을 넘긴다). 그래서 이 스킬은 슬롯을 한 칸도 잡지 않는다.
 */
export function mallowPowerupPicked(state: WorldState, player: Entity): void {
  const me10 = lv(state, Sk.growthConversion);
  if (me10 < 1) return;
  const debt = Math.trunc(player.aux0);
  if (debt <= 0) return;
  // 부채 절반으로 감산(`max(0, ·)` 은 위 `debt > 0` 게이트가 이미 보장 — 설계서 고지 ③).
  const left = Math.floor(debt / 2);
  const burned = debt - left;
  player.aux0 = left;
  const gain = Math.floor((burned * growthConversionPct(me10)) / 100);
  if (gain > 0) state.xp += gain;
}

/**
 * 앵커 ㉕ **정산액 확정 직전**(hp 차감 **전** · hp−1 클램프보다 **앞** · ⑳ 의 CU3 회당 상한보다도
 * 앞) — ME5「분할 상환」 **1종**. 설계서 공통 고지 ④ 의 순서 *분할(ME5) → 회당 상한(CU3) →
 * applied 확정 → 파생 소비* 중 **분할**이 이 함수다.
 *
 * ## 왜 ⑳ 이 아닌가
 * ⑳ 은 hp−1 클램프가 이미 문 뒤라, 거기서 사후 환급으로 분할을 흉내 내면 **클램프가 소멸시킨
 * 초과분이 복원되지 않아** 값이 갈린다. 분할은 정산액이 확정되기 **전**이어야 한다.
 *
 * ## 수지 — `due` 는 세 갈래로 정확히 쪼개진다
 * `due = 이번_선체행 + 탕감분 + 이월분` 이 **항등식**이다(정수 산술이라 잔차가 없다).
 *  - 이번_선체행 = `due − defer` — 반환값. 홀수의 남는 1 은 **이번 회차가 진다**(`floor`).
 *  - 탕감분 = `floor(defer × 탕감bp / 10000)` — 사라진다.
 *  - 이월분 = `defer − 탕감분` — `player.aux0` 으로 미뤄져 **다음 임계 완충 후**에 들어온다.
 *    그 사이 피격되면 신규 적립과 **합산**된다(설계서 ME5 본체 문언 그대로) — 그래서 별도 슬롯이
 *    아니라 완충 풀 `aux0` 이 이월분의 집이다.
 *
 * ## ⚠️ 왜 `aux0` 쓰기가 여기서 살아남는가
 * 호출부(`world.ts`)가 이 훅을 `aux0`·`aux1` **리셋 뒤**에 둔다. 리셋 앞이면 이월분이 곧바로
 * 0 으로 지워진다. 리셋 직후라 `aux0` 은 0 이므로 `+=` 와 대입이 같은 값이지만, **가산으로
 * 적는다** — CU3(⑳)의 이월도 같은 칸을 쓰기 때문이다(아래).
 *
 * ## ⚠️ CU3 과 이중 이월이 되지 않는 이유
 * `world.ts` 가 ⑳ 에 넘기는 `settled` 는 `due` 가 아니라 **이 함수가 돌려준 값**이다. 그래서
 * CU3 의 이월(`settled − cap`)은 **분할 후** 기준이고, ME5 가 미룬 몫을 CU3 이 한 번 더 이월하는
 * 두 겹이 원리적으로 생기지 않는다. 대신 CU3 의 `aux0` 쓰기를 **가산으로** 바꿔 두 이월이
 * 공존하게 했다(대입이면 ME5 의 이월분이 조용히 덮인다).
 *
 * ## ⚠️ 하한 클램프를 걸지 않는다
 * 반환값은 뒤에서 `min(반환값, floor(hp) − 1)` 을 탄다. `min` 을 하나 더 두면 **키우는 방향**이
 * 통째로 죽는다(앵커 ⑰ 이 그래서 원리적으로 무효가 됐다). ME5 는 **줄이는** 방향이라 그 `min`
 * 에 삼켜지지 않는다 — 치사급 정산에서도 분할은 온전히 반영된다.
 *
 * @returns 이번 정산에서 선체로 보낼 몫. 미투자·`due <= 1` 이면 `due` 그대로(비트 동일)
 */
export function mallowCushionSettleDue(
  state: WorldState,
  player: Entity,
  due: number,
  recoverBp: number,
): number {
  const me5 = lv(state, Sk.installmentPlan);
  if (me5 < 1) return due;
  // 절반(내림)만 미룬다. `due <= 1` 이면 `defer` 가 0 이라 무연산인데, 그것이 **종료 보장**이다 —
  // 1 을 계속 반으로 나누면 영영 안 비는 풀이 되고 그 풀은 해시에 접힌다(SQ5 와 같은 규율).
  const defer = Math.floor(due / 2);
  if (defer < 1) return due;
  // ⚠️ **여백 합성**이다 — 설계 정본의 일반형 *갱신값 = 현재율 + (10000 − 현재율) × r / 10000*
  //    그대로이고, 「현재율」은 이 정산에 **실제로 쓰인 탕감률**(= ME8 이 올려 둔 값)이다.
  //    종전에는 `installmentForgiveBp(me5)` 를 그대로 썼고 그 주석이 "ME8 미배선이라 현재율은
  //    항상 0" 이라 적었는데, 설계서의 b 는 **절대 탕감률**(ME8 점근 9500, 기본 6000)이다.
  //    이 레인이 ME8 을 열면서 그 축약이 성립하지 않게 됐다 — 안 고치면 ME5 가 ME8 과 무관하게
  //    굴러 조용히 갈린다. ⚠️ 그래서 **ME8 미투자 런에서도 값이 바뀐다**(b = 6000 이 기본).
  // 합산 상한: b < 10000 이면 갱신값 = 10000 − (10000−b)(10000−r)/10000 < 10000 이므로
  // 별도 clamp 가 필요 없다(설계서 불변식 3 증명). `min` 을 덧대면 그 증명이 죽은 코드가 된다.
  const b = recoverBp;
  const eff = b + Math.floor(((10000 - b) * installmentForgiveBp(me5)) / 10000);
  // 반올림은 이 게이트 **안**이다(규율 ③). 탕감분은 사라지고 나머지만 이월된다.
  const forgiven = Math.floor((defer * eff) / 10000);
  const carry = defer - forgiven;
  if (carry > 0) player.aux0 += carry;
  return due - defer;
}

/**
 * 앵커 ⑳ **완충 정산 직후**(hp 차감·hp−1 클램프까지 반영된 뒤) — 정산 트리거 **7종**:
 * CU3 무통 정산 · SQ2 청산 폭발 · SQ5 탕감 장전 · SQ8 흉터 포문 · ME4 반환 요법 ·
 * CU9 유예의 은총 · CU10 영구 채무 자본화.
 *
 * ## 적용 순서는 설계서 공통 고지 ④ 가 못 박았다
 * *분할(ME5) → 회당 상한(CU3) → applied 확정 → 파생 소비(SQ2·SQ5·SQ8·ME4·CU9·CU10)* 다.
 * **분할(ME5)은 이 함수 밖**이다 — S3 의 앵커 ㉕(`onCushionSettleDue`)이 hp 차감 **전**에 돌고,
 * 그 결과가 `settled`·`applied` 로 여기 들어온다. 그래서 이 함수는 정본 순서상 **CU3 부터**
 * 시작하는 것이 맞다(자리가 없어서가 아니다. ME5 자체는 아직 미배선이다). CU3 이 확정한 `hit` 을 나머지
 * 여섯이 읽는다. 순서를 뒤집으면 상한에 걸린 정산에서 폭발·누적·회복이 **깎이기 전 값**을
 * 보게 되어 CU3 이 조용히 무력화된다.
 *
 * ## ⚠️ `applied` 와 `settled` 는 다르다 — 무엇을 어디에 쓰는가
 *  - `applied`(= 이 함수의 `hit`) — **hp 에서 실제로 깎인 양.** "미룬 피해를 갚았다" 를 재는
 *    축(SQ2 폭발·SQ8 누적·ME4 의 회복 상한)은 전부 이쪽이다.
 *  - `settled` — 선체로 **들어가기로 확정됐던** 양. hp−1 클램프가 물면 `applied < settled` 다.
 *    CU3 의 **이월분**만 이쪽 기준인데, 이유는 이월이 "상한이 막은 몫" 이지 "클램프가 소멸시킨
 *    몫" 이 아니기 때문이다(소멸분을 이월로 되살리면 완충이 순 감쇄가 아니라 순 부채가 된다).
 *  - `recovered` — 무피격 보상으로 **사라진** 몫. 산출이 HP 밖인 축(SQ5 화력·CU10 maxHp)과
 *    ME4 회복의 **재료**다. 정산 전 풀 크기가 필요하면 `settled + recovered` 로 복원한다.
 *
 * ## ⚠️ `player.aux0`·`aux1` 은 이미 0 이다
 * CU3 의 이월이 `aux0` 에 **대입**인 것이 그래서 성립한다(가산이면 리셋 전 값과 두 겹이 된다).
 * `aux1` 은 건드리지 않는다 — 임계 재충전 규칙은 CU3 의 변경 대상이 아니다(설계서 CU3 구현항).
 */
export function mallowCushionSettled(
  state: WorldState,
  player: Entity,
  settled: number,
  recovered: number,
  applied: number,
): void {
  // --- CU3 무통 정산 — 회당 상한 + 잔여 이월 -----------------------------------
  let hit = applied;
  const cu3 = lv(state, Sk.painlessSettlement);
  if (cu3 >= 1) {
    // 상한 = maxHp × round(30 − 18×Lv/(Lv+10))%. 반올림은 이 게이트 **안**이다(규율 ③).
    const cap = Math.round((player.maxHp * painlessSettlementPct(cu3)) / 100);
    if (hit > cap) {
      // 이미 깎인 몫을 상한까지 되돌린다. `min` 은 결합적이라 사후 보정이어도
      // min(settled, cap, room) 으로 정확히 같은 값이 나온다 — 클램프와 순서가 무관하다.
      player.hp += hit - cap;
      hit = cap;
    }
    const carry = settled - cap;
    // ⚠️ **가산**이다(대입이 아니다). 리셋 직후라 `aux0` 은 0 이지만, ME5(앵커 ㉕)가 이 앵커보다
    // **앞**에서 자기 이월분을 같은 칸에 이미 미뤄 뒀을 수 있다 — 대입이면 그것이 조용히 덮인다.
    // ME5 미투자 런에서는 `aux0` 이 0 이라 대입과 비트 동일이다.
    // 두 이월이 두 겹이 되지는 않는다: 여기 `settled` 는 ㉕ 이 확정한 **분할 후** 값이라
    // ME5 가 이미 미룬 몫이 애초에 포함돼 있지 않다(`world.ts` 정산 블록 주석이 근거).
    if (carry > 0) player.aux0 += carry;
  }
  // --- SQ2 청산 폭발 — 갚은 만큼 되쏜다 ----------------------------------------
  const sq2 = lv(state, Sk.settlementBlast);
  if (sq2 >= 1 && hit > 0) {
    const dmg = Math.round((hit * (80 + 6 * sq2)) / 100);
    // `blastDamage` 는 hp≤0 이 된 적을 `dead` 로 마킹하고(선결 과제 ⑨ 이후), 격추 **집계**는
    // 여전히 `compact()` 단일 수렴점이다 — 마킹은 수거 대상 표시일 뿐이다(SQ3 와 같은 규율).
    if (dmg > 0) blastDamage(state, player, 180 + 10 * sq2, dmg);
  }
  // --- SQ5 탕감 장전 — 사라진 몫이 탄약이 된다 ---------------------------------
  const sq5 = lv(state, Sk.forgivenessLoader);
  if (sq5 >= 1 && recovered > 0) {
    const add = Math.round((recovered * (50 + 5 * sq5)) / 100);
    if (add > 0) {
      const rem = readSlot(state.skillStage, MallowStage.forgivenessLoad);
      writeSlot(state.skillStage, MallowStage.forgivenessLoad, rem + add);
    }
  }
  // --- SQ8 흉터 포문 — 갚은 이력이 포문을 벼린다 -------------------------------
  const sq8 = lv(state, Sk.scarCannon);
  if (sq8 >= 1 && hit > 0) {
    const cum = readSlot(state.skillCarry, MallowCarry.scarApplied);
    writeSlot(state.skillCarry, MallowCarry.scarApplied, cum + hit);
  }
  // --- ME4 반환 요법 — 회복 ≤ 선체행(수지 불변식 1 을 이 스킬이 집행한다) ------
  const me4 = lv(state, Sk.rebateTherapy);
  if (me4 >= 1 && recovered > 0 && hit > 0) {
    let heal = Math.round((recovered * rebateTherapyPct(me4)) / 100);
    // ⚠️ 이 `min` 이 불변식 1 그 자체다 — 빼면 정산이 **순 회복**이 되어 맞는 것이 이득이 된다.
    if (heal > hit) heal = hit;
    if (heal > 0) {
      const room = player.maxHp - player.hp;
      if (room > 0) player.hp += heal > room ? room : heal;
    }
  }
  // --- CU9 유예의 은총 — 갚는 순간의 무적 --------------------------------------
  const cu9 = lv(state, Sk.graceOfSettlement);
  if (cu9 >= 1) {
    const grace = 20 + 4 * cu9;
    // `max` 형태다 — 통상 피격 무적이 더 길게 남아 있으면 그것을 **깎으면 안 된다**.
    if (player.iframes < grace) player.iframes = grace;
  }
  // --- SQ10 만기 일제 — **cushion_hi 만기 정산 전용** 방향성 관통 탄막 ----------
  //
  // ⚠️ 표식은 **투자 여부와 무관하게 소비**한다 — 미투자 런에서는 애초에 안 세워지고(규율 ②),
  // 세워진 런에서 소비를 게이트 안에 두면 "정산액 0 인 만기" 에 표식이 살아남아 **다음
  // 일반 정산**이 만기로 오인된다. 트리거가 "만기 전용" 인 것이 SQ2(전 정산)와의 분화 3축 중
  // 하나라, 그 오인은 스킬 둘을 같은 것으로 만든다.
  const matured = readSlot(state.skillStage, MallowStage.maturityDue) > 0;
  if (matured) writeSlot(state.skillStage, MallowStage.maturityDue, 0);
  const sq10 = lv(state, Sk.maturityVolley);
  if (sq10 >= 1 && matured && settled > 0) {
    // 탄수 = 6 + ceil(정산액 / (30 − 20×Lv/(Lv+15))). 반올림·나눗셈은 이 게이트 안이다.
    const count = 6 + Math.ceil(settled / maturityDivisor(sq10));
    // ⚠️ 방향은 `player.angle`(조준각) 폴백이다. 설계서 3R-9 가 명시한 알려진 성질 —
    // 자동 조준이 실제 발사각을 정하는 sim 이라 **정지 상태 만기에서는 탄막이 허공으로 나갈 수
    // 있고 그것이 정상 동작**이다(액티브 `activeDirOf` 폴백 정본을 여기 복제하지 않는다).
    const dir = { x: cos(player.angle), y: sin(player.angle) };
    // 부채꼴 45° · pierce 2 — 설계서 「구현」 항(2R M1)이 「레벨 스케일」의 "관통 1 고정" 을
    // 뒤집은 값이다. 좁은 각 + 관통 예산 상향이 본체 문언("방향성 관통")을 실현한다.
    fanStrike(state, player, count, 12 + 2 * sq10, 45, dir, { pierce: 2 });
  }
  // --- CU10 영구 채무 자본화 — 갚아 본 빚이 몸집이 된다 ------------------------
  const cu10 = lv(state, Sk.perpetualCapitalization);
  if (cu10 >= 1 && recovered > 0) {
    let gain = Math.round((recovered * capitalizationPct(cu10)) / 100);
    const per = 3 + cu10;
    if (gain > per) gain = per;
    // ⚠️ `maxHp` 만 올리고 `hp` 는 올리지 않는다(설계서 명시) — 회복이 아니므로 불변식 1
    // 대상 밖이고, 파워업 `reinforced-hull` 의 "즉시 회복" 과 여기서 갈린다. ME4 **뒤**라
    // 이번 정산의 회복이 늘어난 상한을 미리 쓰지 못한다(설계서 파생 소비 순서 그대로).
    if (gain > 0) player.maxHp += gain;
  }
}

/**
 * 앵커 ⑯ **볼리 파라미터 확정 직후 · 탄이 태어나기 직전** — SQ1 부채 격노 · SQ8 흉터 포문의
 * 소비처 · SQ5 탕감 장전의 소비처.
 *
 * ## 세 스킬 모두 `damage` 한 칸만 만진다 — 교환형이 아니다
 * S2.1 이 실은 `ballisticsUsed`·`countUsed` 게이트는 **대가를 탄속·탄수에 싣는 교환형**을 위한
 * 것이다(브루저 BL6 이 빔에서 페널티만 증발하고 이득만 남았던 결함). 여기 셋은 **페널티가
 * 없고** `damage` 는 전 아키타입이 읽으므로(앵커 ⑯ 의 아키타입 표) 게이트가 필요 없다 —
 * 게이트를 붙이면 빔 말로우에서 세 스킬이 통째로 조용히 죽는다.
 *
 * ## SQ1·SQ8 은 bp 를 **합산**한 뒤 한 번만 적용한다
 * 순차로 곱하면 적용 순서가 결과를 바꾸고(두 스킬 사이에 우열이 생긴다), 두 상한이 곱해져
 * 설계가 계산한 점근 상한이 깨진다. 각자 자기 상한으로 잘린 bp 를 더하는 것이 설계서의
 * "증폭 상한" 문언과 정합한다.
 *
 * ## ⚠️ SQ5 의 소진은 **볼리당 1회**다 — 탄당이 아니다
 * `params.damage` 는 **발당 피해**라, 소진량을 여기 더하면 발칸(부채꼴 다발)에서는 탄수만큼
 * 곱해져 들어간다. 설계서가 정한 관측량은 "볼리당 잔량의 25% 소진" 이고 그것은 여기서 정확히
 * 성립한다 — 발당 반영은 이 앵커가 제공하는 유일한 피해 칸이기 때문이며, 아키타입 간 위력
 * 격차는 밸런스 축(defer-balance-tuning)으로 넘긴다.
 */
export function mallowVolleyParams(
  state: WorldState,
  player: Entity,
  params: VolleyParams,
): void {
  let bp = 0;
  // --- SQ1 부채 격노 — 지금 진 빚이 클수록 세게 때린다 -------------------------
  const sq1 = lv(state, Sk.debtFury);
  if (sq1 >= 1) {
    const debt = Math.trunc(player.aux0);
    if (debt > 0) {
      const raw = debt * (4 + sq1);
      const cap = debtFuryCapBp(sq1);
      bp += raw > cap ? Math.round(cap) : raw;
    }
  }
  // --- SQ8 흉터 포문 — 갚아 본 이력이 클수록 세게 때린다 -----------------------
  const sq8 = lv(state, Sk.scarCannon);
  if (sq8 >= 1) {
    const cum = readSlot(state.skillCarry, MallowCarry.scarApplied);
    if (cum > 0) {
      const raw = cum * (6 + 2 * sq8);
      const cap = scarCannonCapBp(sq8);
      bp += raw > cap ? Math.round(cap) : raw;
    }
  }
  if (bp > 0) params.damage += Math.round((params.damage * bp) / 10000);
  // --- SQ5 탕감 장전 — 잔량의 25% 를 이번 볼리에 싣는다 ------------------------
  const sq5 = lv(state, Sk.forgivenessLoader);
  if (sq5 >= 1) {
    const rem = readSlot(state.skillStage, MallowStage.forgivenessLoad);
    if (rem > 0) {
      // ⚠️ 하한 1 이 **종료 보장**이다. 설계서의 "정수 내림 · 0 도달 시 종료" 를 floor 만으로
      // 쓰면 잔량 3 이하에서 소진이 0 이 되어 **영영 안 비는 탄창**이 된다(잔량이 해시에
      // 접히므로 조용한 영구 발산이다).
      let use = Math.floor((rem * 25) / 100);
      if (use < 1) use = 1;
      if (use > rem) use = rem;
      writeSlot(state.skillStage, MallowStage.forgivenessLoad, rem - use);
      params.damage += use;
    }
  }
  // --- SQ7 관성 사출 — 달리는 방향으로 쏠수록 탄속·피해가 실린다 -----------------
  //
  // 술어는 설계서 그대로 **그 틱 입력 벡터와 발사각의 내적**이다. 두 항의 출처가 다르다:
  //  · 입력 벡터 = `params.inputX/inputY`(W2 가 `autoAttack` 에 `InputFrame` 을 배관해 실은
  //    읽기 전용 사실). **실속도로 대용하지 않는다** — 감속 장판·이속 모듈·넉백이 속도를
  //    갈아 놓아 "무엇을 지시했는가" 와 갈린다(인벤토리 1.5 「상태 판정은 입력으로」).
  //  · 발사각 = `params.aimAngle`(자동 조준이 실제로 고른 방위). `player.angle`(조준각)은
  //    적이 없는 방향을 가리킬 수 있어 갈린다 — 그 필드 doc 의 ⚠️ 가 근거다.
  //
  // ⚠️ 내적이 0 이하면 **한 칸도 안 만진다**(뒤로 달리며 쏘면 보정 없음 — 설계서의 "일치도
  //    만큼"). 감산은 하지 않는다: 설계서가 페널티를 주지 않았고, 여기서 만들면 손잡이가
  //    하나 더 생긴다.
  // ⚠️ 탄속은 `ballisticsUsed` 로 게이트하지 않는다 — 이 스킬은 탄속·피해가 **둘 다 이득**
  //    이라 빔(탄속 미독)에서 최악이 무연산이다. BL6 처럼 대가가 탄속에 실린 교환형이었다면
  //    게이트가 필수였겠지만(그 필드 doc), 여기서 게이트를 걸면 빔만 피해까지 잃는다.
  const sq7 = lv(state, Sk.momentumLaunch);
  if (sq7 >= 1) {
    const len = length(params.inputX, params.inputY);
    if (len > 0) {
      // 정규화는 여기서 한다 — 레코드는 원본을 싣는다(길이를 술어로 쓸 스킬을 위해).
      let dot =
        (params.inputX / len) * cos(params.aimAngle) + (params.inputY / len) * sin(params.aimAngle);
      // 부동소수 오차로 1 을 아주 조금 넘을 수 있다. 상한만 자른다(하한은 아래 `> 0` 이 판다).
      if (dot > 1) dot = 1;
      if (dot > 0) {
        // 최대 보정(정방향 완전 일치): 탄속 +10% + 1%p/Lv · 피해 +4% + 1%p/Lv. 내적 비례.
        // bp 를 먼저 정수로 접는 것이 이 저장소 관용구다(정수 bp · 나눗셈 1회 · 반올림 1회).
        const speedBp = Math.round((1000 + 100 * sq7) * dot);
        const damageBp = Math.round((400 + 100 * sq7) * dot);
        if (damageBp > 0) params.damage += Math.round((params.damage * damageBp) / 10000);
        if (speedBp > 0) params.speed = (params.speed * (10000 + speedBp)) / 10000;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 지연 전환 분기(앵커 ㉗) — CU1·CU2·CU5·CU6
// ---------------------------------------------------------------------------

/**
 * 방어 액티브 **cushion_lo(카운터 가속)** 의 버프 창이 지금 열려 있는가 — CU5 의 술어.
 *
 * ## ⚠️ `actives.ts` 의 `buffTicksOf`/`defForSlot` 은 **모듈 사설**이라 쓸 수 없다
 * 그래서 같은 사실을 공개 경로로 다시 세운다: 잔여 틱은 `WorldState` 의 평평 정수
 * (`activeBuff0`/`activeBuff1`)이고 — 아크캐스터 BR3 가 이미 같은 칸을 직접 읽는 선례다 —
 * 슬롯→정의는 `activeByWireId`(`data/ships/actives/index.ts`)로 푼다.
 *
 * ⚠️ **"아무 버프나" 가 아니라 `as_mallow_cushion_lo` 한정**이다. BR3 처럼
 * `activeBuff0 > 0 || activeBuff1 > 0` 로 쓰면 mend_lo/hi(블링크)·squish 계열까지 CU5 를
 * 켜서 설계 문언("방어 액티브 지속 중")과 갈린다. cushion_hi(전량 유예)도 대상이 아니다 —
 * 그쪽은 `aux1` 을 0 으로 눌러 정산 자체를 막는 별개 축이다.
 *
 * ⚠️ 기체 게이트는 호출부(`case SIG_MALLOW_CUSHION`)가 이미 걸었고, `def.id` 자체가 말로우
 * 고유라 손상 세이브가 다른 기체 스킬을 실어도 여기 걸리지 않는다.
 */
function counterStanceOn(state: WorldState): boolean {
  const slots = state.config.activeSlots;
  if (slots === undefined) return false;
  for (let slot = 0; slot < slots.length; slot++) {
    const ticks = slot === 0 ? state.activeBuff0 : state.activeBuff1;
    if (ticks <= 0) continue;
    const def = activeByWireId(slots[slot] ?? -1);
    if (def !== undefined && def.id === 'as_mallow_cushion_lo') return true;
  }
  return false;
}

/**
 * 앵커 ㉗ **지연 전환 분리 직후 · 즉시분 확정 직전** — CU1 과부하 흡수 · CU2 부채 한도 ·
 * CU5 전량 유예 태세 · CU6 파산 보호 **4종**.
 *
 * ## 적용 순서는 설계 정본이 못 박았다 — CU5 → CU1 → CU2 → CU6
 *  1. **CU5**(비율 치환) — 기본 `CUSHION_DEFER_BP` 대신 높은 bp 로 **다시 계산**한다.
 *     비율 칸을 따로 두지 않고 `params.deferred` 하나만 쓰는 이유는 앵커 doc 에 있다.
 *  2. **CU1**(초과분 이관) — 절대량이다. 임계 초과분이 지금 값보다 크면 그것으로 올린다.
 *     `max` 인 것이 요점이다: CU5 가 이미 더 많이 미뤄 뒀으면 CU1 이 **깎으면 안 된다**.
 *  3. **CU2**(한도) — 여기까지의 결과에 상한을 건다. 한도는 `maxHp` 비율이고 여유는
 *     `한도 − 현재 부채` 다(이번 피격분은 아직 `aux0` 에 안 실렸다 — 적립은 hp 차감 뒤다).
 *  4. **CU6**(치명 시 전액) — **한도 게이트 뒤**다. 그래서 한도를 넘겨 적립될 수 있고,
 *     그것이 설계서가 명시한 대가다("목숨을 빚으로 산 직후는 장부가 가득 차 새로 미룰 수
 *     없고, 정산으로 `aux0` 이 한도 아래로 내려오면 완충이 복구된다"). 순서를 뒤집어 CU2 를
 *     마지막에 두면 파산 보호가 한도에 잘려 **살리지 못한다** — 스킬이 통째로 무효가 된다.
 *
 * ## ⚠️ CU6 의 무적은 여기서 못 세운다
 * 이 훅 바로 뒤에 `world.ts` 가 `player.iframes = state.config.hitIframes` 를 **대입**한다.
 * 여기서 세운 값은 예외 없이 덮이므로, 요구 틱만 슬롯에 남기고 앵커 ④ 에서 `max` 로 집행한다
 * ({@link MallowStage.bankruptcyIframes}).
 *
 * @param dmg 정수화된 총 피해 · @param hp 차감 **전** hp
 */
export function mallowCushionSplit(
  state: WorldState,
  player: Entity,
  dmg: number,
  params: CushionSplitParams,
  hp: number,
): void {
  let deferred = params.deferred;
  // --- CU5 전량 유예 태세 — 버프 창 동안은 거의 다 미룬다 -----------------------
  const cu5 = lv(state, Sk.fullDeferralStance);
  if (cu5 >= 1 && counterStanceOn(state)) {
    // 반올림은 이 게이트 **안**이다(규율 ③). 기본 bp 와 같은 형태의 단일 나눗셈이라
    // `cushionDeferredDamage` 와 산술이 정확히 동형이다.
    const raised = Math.round((dmg * fullDeferralBp(cu5)) / 10000);
    if (raised > deferred) deferred = raised;
  }
  // --- CU1 과부하 흡수 — 임계 초과분 전액을 지연분으로 -------------------------
  const cu1 = lv(state, Sk.overloadAbsorb);
  if (cu1 >= 1) {
    const thr = overloadThreshold(cu1);
    if (dmg > thr) {
      const over = dmg - thr;
      if (over > deferred) deferred = over;
    }
  }
  // --- CU2 부채 한도 — 한도를 넘겨 미뤄질 몫은 처음부터 즉시분 -----------------
  const cu2 = lv(state, Sk.debtCeiling);
  if (cu2 >= 1) {
    const ceiling = Math.round((player.maxHp * debtCeilingPct(cu2)) / 100);
    const room = ceiling - Math.trunc(player.aux0);
    // 여유가 음수(CU6 이 한도 위에 눌러앉은 상태)면 **전액 즉시분**이다 — 완충이 일시적으로
    // 꺼지는 그 구간이 설계서가 명시한 파산 보호의 대가다.
    if (deferred > room) deferred = room > 0 ? room : 0;
  }
  // --- CU6 파산 보호 — 런당 1회, 치명 피격의 전액을 부채로 ---------------------
  const cu6 = lv(state, Sk.bankruptcyProtection);
  if (cu6 >= 1 && readSlot(state.skillCarry, MallowCarry.bankruptcyUsed) === 0) {
    // 치명 판정 = "즉시분이 지금 hp 를 다 가져간다". `hp` 는 차감 **전** 값이라 이 술어가
    // 곧 "이 피격으로 죽는다" 이고, 판정 자리가 생존 캡스톤과 같되 **이쪽이 먼저**다
    // (부채로 살리는 쪽이 우선 — 캡스톤 소진을 아낀다).
    if (dmg - deferred >= hp) {
      deferred = dmg;
      writeSlot(state.skillCarry, MallowCarry.bankruptcyUsed, 1);
      writeSlot(state.skillStage, MallowStage.bankruptcyIframes, bankruptcyIframeTicks(cu6));
    }
  }
  params.deferred = deferred;
}

/**
 * 앵커 ㉘ **정산 탕감률 확정** — ME8 리듬 탕감 **1종**.
 *
 * 젬 콤보 스택(`state.combo`)이 유지되는 동안 정산의 탕감 비율이 오른다 — 수집 리듬이 이자율을
 * 깎는다. 콤보는 읽기만 하고 **소모하지 않는다**(스트라이커 S8 의 "콤보 소모" 축과 갈린다).
 *
 * ## ⚠️ 상한은 여기서 진다
 * 반환값이 10000 이상이면 `cushionSettled` 가 음수가 되어 정산이 hp 를 **늘린다**(맞는 것이
 * 이득이 되는 부호 반전). 공식의 점근이 `base + 3500` = 9500 이라 구조적으로 닿지 않지만,
 * 어픽스 연장이 붙는 축이라 구조로 막는다 — 앵커 ㉘ 의 계약이 "0 이상 10000 미만" 이다.
 *
 * ⚠️ **미투자·콤보 0 인 런은 `base` 를 그대로 돌려준다** — 나눗셈도 돌지 않아 비트 동일이다.
 */
export function mallowCushionRecoverBp(state: WorldState, base: number): number {
  const me8 = lv(state, Sk.rhythmForgiveness);
  if (me8 < 1) return base;
  const stacks = Math.trunc(state.combo);
  if (stacks <= 0) return base;
  const bp = Math.round(rhythmForgivenessBp(base, stacks, me8));
  if (bp <= base) return base;
  return bp < 9999 ? bp : 9999;
}

/**
 * 앵커 ㉙ **목표 완수 틱**(에코 안정화 · 조우 완수) — ME7 에코 채권 **1종**.
 *
 * 부채가 **전액 소각**되고, 소각량에 비례한 자석 버프 창(`state.magnetBuffTicks`)이 열린다.
 *
 * ## ⚠️ 산출이 자석 버프인 것은 **런 폐쇄성** 때문이다
 * 설계 3R M1 이 2·3판의 자원(`state.resources`) 산출을 폐기했다 — `save/settlement.ts` 가 런
 * 종료 시 `resources` 를 `creditsGained` 로 **1:1 전환**하므로, ME10 이 명문으로 경계한
 * "피격이 계정 성장 재화가 되는 구멍" 과 같은 구조가 된다. `magnetBuffTicks` 는 기존 해시
 * 필드이고 **런 종료와 함께 소멸**해 계정 경제에 한 톨도 닿지 않는다.
 *
 * ## ⚠️ `kind` 로 산출을 가르지 않는다
 * 설계서가 두 지점을 **한 벌**로 묶었다("에코 안정화·조우 완수"). 인자는 나중 스킬을 위한
 * 칸이고, 여기서 가르면 같은 스킬이 무대에 따라 다른 값을 내는 축이 하나 더 생긴다.
 */
export function mallowObjectiveResolved(
  state: WorldState,
  player: Entity,
  kind: ObjectiveKind,
): void {
  void kind;
  const me7 = lv(state, Sk.echoBond);
  if (me7 < 1) return;
  const burned = Math.trunc(player.aux0);
  if (burned <= 0) return;
  player.aux0 = 0;
  // floor 단일 나눗셈 — 잔여는 버린다(신규 캐리 0. ME10 과 같은 규율).
  let ticks = Math.floor((burned * echoBondPct(me7)) / 100);
  if (ticks > ECHO_BOND_TICK_CAP) ticks = ECHO_BOND_TICK_CAP;
  if (ticks > 0) state.magnetBuffTicks += ticks;
}

/**
 * 앵커 ㉚ **적 상태이상 만료** — SQ9 이자 소각의 **탕감 경로 ①**.
 *
 * 화상이 만료된 적 1기당 정확히 1회 부채가 소액 탕감된다. 냉기 만료는 소비처가 없다
 * (`kind` 를 보고 조기 반환한다 — "만료 전부" 로 열어 두면 냉기 어픽스 런에서 탕감이 두 배가
 * 되고, 그것은 이 스킬이 세는 사건이 아니다).
 *
 * ## ⚠️ 이 경로는 사망 경로({@link mallowEnemyDeath})와 **배타적**이다
 * 만료되면 화상이 없고, 화상 중에 죽으면 만료 틱이 오지 않는다 — `status.ts` 의 만료 통지가
 * hp≤0 판정보다 **앞**이라, 화상 피해로 죽는 틱에도 "만료" 로 한 번만 센다.
 *
 * ## ⚠️ 부여 여부를 되묻지 않는다
 * 어픽스 화염이 건 화상과 SQ9 이 건 화상은 같은 두 칸(`iframes`·`dashCooldown`)에 실려
 * **구분이 원리적으로 불가능하다**(`status.ts` 의 필드 재활용 규율). 화염 어픽스를 낀 런에서는
 * 탕감 발생률이 그만큼 는다 — 알려진 성질이고, 탕감량이 소액(3 + floor(Lv/2))이라 설계서가
 * 유계로 잡은 범위 안이다.
 */
export function mallowEnemyStatusExpired(
  state: WorldState,
  player: Entity,
  e: Entity,
  kind: EnemyStatusKind,
): void {
  if (kind !== 'burn') return;
  void e;
  forgiveInterest(state, player);
}

/**
 * 앵커 ⑪ **잡몹 격추** — SQ9 이자 소각의 **탕감 경로 ②**(화상이 남은 채 죽은 적).
 * 호출부가 `burning` 게이트를 이미 걸었다.
 */
export function mallowEnemyDeath(state: WorldState, player: Entity): void {
  forgiveInterest(state, player);
}

/** SQ9 의 탕감 본체 — 두 경로가 **같은 함수**를 부른다(산식이 갈리면 경로가 두 스킬이 된다). */
function forgiveInterest(state: WorldState, player: Entity): void {
  const sq9 = lv(state, Sk.interestBurn);
  if (sq9 < 1) return;
  const debt = Math.trunc(player.aux0);
  if (debt <= 0) return;
  const cut = interestBurnForgive(sq9);
  // `max(0, ·)` — 설계서 공통 고지 ③ 의 aux0 감산 규율.
  player.aux0 = debt > cut ? debt - cut : 0;
}

// ---------------------------------------------------------------------------
// 액티브 핸들러가 부르는 진입점 (`activeHandlers/mallow.ts`)
// ---------------------------------------------------------------------------

/** SQ6 이 액티브 squish_lo 에 싣는 개선분. `undefined` = 미투자(핸들러가 종전 그대로 돈다). */
export interface InstantExchange {
  /** 개선된 `perDeferred`(부채 몇 당 탄 1발). 호출부가 원래 값과 `min` 을 취한다. */
  per: number;
  /** 청산 탄에 실리는 관통(고정 +1). */
  pierce: number;
  /** 탄당 피해 증폭 bp = 1000 + 200×Lv (설계서 "+10% + 2%p/Lv"). */
  damageBp: number;
}

/**
 * SQ6 즉석 환전 — 공격 액티브 `as_mallow_squish_lo`(부채→탄막 청산) 발동 시의 개선분.
 *
 * ⚠️ **HP 회수는 없다**(설계 2R S1: 청산은 선체행 0 인 부채 소멸 경로라 HP 산출 금지 —
 * 산출이 화력 축으로 옮겨졌다). 여기서 HP 를 주면 수지 불변식 1 의 경로 판정이 깨진다.
 *
 * ⚠️ 반올림은 이 함수 **안**이다(규율 ③). 미투자면 `undefined` 라 핸들러가 한 칸도 안 만진다.
 */
export function mallowInstantExchange(state: WorldState): InstantExchange | undefined {
  const sq6 = lv(state, Sk.instantExchange);
  if (sq6 < 1) return undefined;
  return {
    per: Math.round(10 - (6 * sq6) / (sq6 + 8)),
    pierce: 1,
    damageBp: 1000 + 200 * sq6,
  };
}

/**
 * ME6 잔상 세척 — 이동 액티브(블링크)의 **도착 지점**에 적탄 소거 + 냉기 부여.
 *
 * 반경 = 140 + 10×Lv. 호출부(`activeHandlers/mallow.ts`)가 `blink()` **직후**에 부르므로
 * `player.x/y` 가 이미 도착 좌표다 — 출발 좌표를 따로 넘기지 않는 이유가 그것이고, 순서를
 * 뒤집으면 스킬이 조용히 출발 지점을 턴다.
 *
 * ⚠️ 냉기는 `applySlow`(정본 leaf)를 그대로 부른다 — 지속(`COLD_DURATION`)·배율은 전역 상수
 * 하나가 정본이고, 여기서 복제하지 않는다. 대상은 `kind === 'enemy'` 한정이다(보스·구조물의
 * `ownerId` 는 다른 의미로 점유돼 있다 — `invasion/facility.ts`·`modes/midClash.ts` 주석).
 */
export function mallowBlinkRinse(state: WorldState, player: Entity): void {
  const me6 = lv(state, Sk.afterimageRinse);
  if (me6 < 1) return;
  const r = 140 + 10 * me6;
  clearEnemyBullets(state, player, r);
  const r2 = r * r;
  for (const e of state.entities) {
    if (e.dead || e.kind !== 'enemy') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (dx * dx + dy * dy > r2) continue;
    applySlow(e, COLD_DURATION);
  }
}

/**
 * SQ10 이 소비할 **만기 표식**을 세운다 — 방어 액티브 `as_mallow_cushion_hi`(전량 유예)의
 * EXPIRE 훅이 부른다.
 *
 * ⚠️ **투자 게이트를 세우는 쪽에 건다**(규율 ②: 모든 쓰기는 투자 게이트 안쪽). 미투자여도
 * 표식을 세우면 SQ10 을 안 찍은 런의 `skillStage` 가 0 에서 벗어나 **조건부 꼬리 폴드가
 * 켜지고 골든 바이트가 갈린다** — 스킬이 하나도 안 도는 런에서 해시가 움직이는 것은 이
 * 저장소가 금지한 형태다. 대가는 "만기 직후 틱에 SQ10 을 찍으면 그 한 번을 놓친다" 뿐이고,
 * 그 창은 다음 만기에 닫힌다.
 */
export function mallowMaturityArm(state: WorldState): void {
  if (lv(state, Sk.maturityVolley) < 1) return;
  writeSlot(state.skillStage, MallowStage.maturityDue, 1);
}
