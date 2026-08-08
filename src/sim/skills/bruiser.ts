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
 * ## ✅ 배치7 시점 30종 전부 배선됐다(아래는 그 진척의 기록)
 * 1차 배선이 11종(앵커 ②③④⑧⑨⑩⑪), S2 의 앵커 ⑯(볼리 파라미터)이 **BL3·BL6** 둘을,
 * S2.1 이 연 `VolleyParams.targetDist` 가 **BL2** 하나를, W2 가 앵커 ④ 의 `sources` 로 **BL8** 을
 * 열었다. W3 이 **MO4·FO4·FO8·FO9** 넷을 더 얹었다 — 넷 다 감쇠 분기를 **선점**(앵커 ⑨ 가 그
 * 분기보다 앞이라는 순서를 쓴다)해서 닫았다.
 *
 * **배치5(브루저 레인)가 아홉을 더 얹었다** — `onActiveFired` 로 **BL5·BL10·MO5·MO10**,
 * `onGemMagnetParams` 로 **MO2**, `onPlayerMoveParams` 로 **MO3**, 벽 축 3앵커로 **BL7·MO7** —
 * 여덟이다(19 → 27). 아홉째로 다룬 **MO4** 는 새 배선이 아니라 앵커 ⑨ 에서
 * `onPlayerMoveParams` 로 **이사**한 것이라 종수가 늘지 않는다.
 *
 * ## ✅ 배치6(2026-08-07)이 둘을 닫았다 — **27 → 29종**
 *  - **FO10 파열 소각장** — 배치6 이 세운 앵커 `onActiveExpired`(액티브 버프가 0 이 된 그 한
 *    틱). 아래 두 문단은 *왜 그 전에는 불가능했는가* 의 기록이고 지금도 참이다.
 *  - **FO3 반동 갑주** — 앵커 ④ 가 배치6 부터 **접촉 상대 적**(후행 선택 인자 `contact`)을
 *    넘긴다. 좌표(`srcX`/`srcY`)로 되찾는 대안은 접촉 판정의 두 번째 사본이라 기각됐다.
 *
 * ## (배치5 시점 기록) 그때 이 둘이 없던 사유 — **아직 코드가 없었다**(반쪽 배선이 아니다)
 *  - **FO10 파열 소각장**: 술어가 *"강화 액티브 고티어의 **만료** 폭발"* 인데 만료 지점
 *    (`actives.ts` 의 `ACTIVE_EXPIRE[def.id]`)에 앵커가 **하나도 없었다**. `onActiveFired` 는
 *    **발동** 직후라 만료를 원리적으로 못 본다 — 발동 틱에 표식을 적어 둬도 그 표식을 읽을
 *    소비처(만료 훅)가 `activeHandlers/bruiser.ts` 에 있고 이 레인의 파일 밖이다. 소비처 없는
 *    표식만 적는 것이 이 저장소가 금지한 반쪽 배선이라 넣지 않았다.
 *  - **FO3 반동 갑주**: 접촉 **상대 적**을 넘겨주는 앵커가 없었다. 앵커 ④ 는 `sources` 비트합만
 *    실어 "접촉이었다"까지만 알려 주고 그 적의 참조가 없었다(BL8 이 같은 자리에서 적립 단위를
 *    "1회" 로 둔 이유가 그것이다). 반사 **대상**이 없으면 효과 본체가 성립하지 않는다.
 *
 * ## ✅ 배치7 — **BL1 응전 사출**이 닫혀 30/30 이 됐다
 * *"실제로 HP 가 깎인 피격 틱에 조준 방향으로 반격 볼리"* 의 트리거 자체는 배치6 까지도 앵커
 * ④ 에서 완전히 성립했다. 막던 것은 설계서가 적은 **내부 쿨 술어**였다 — "60틱 내부 쿨은
 * `aux1 < 60` 판정으로 대체 가능(신규 상태 0)" 이라고 적었으나, 장갑 적립(`aux1 = 0`)이 이
 * 앵커보다 **앞**이라(`world.ts` 4317-4320 동형 지점) 도달 시점의 `aux1` 은 **항상 0** 이다.
 * 그 술어는 상시 스킵이거나 상시 발동 중 하나가 되어 어느 쪽도 설계가 아니었다.
 *
 * **배치7 F1**(`prerequisites.md` §0-A 개정 각주, 2026-08-07 사용자 승인)이 칼날 축(BL) 상태
 * 예산을 2 → 3 으로 올리고 전용 칸 `BruiserStage.retortCooldown`(값 규약 0=발사 가능)을 신설해
 * 이 벽을 없앴다. 발사는 배치7 F2b 가 뽑은 leaf `emitVolley`(`activeTypes.ts`)를 그대로 쓴다 —
 * 이 함수가 `player.cooldown` 을 한 비트도 안 만지므로 "쿨다운 미소비" 계약이 leaf 계약과
 * 그대로 정합한다. 조준 방향은 `player.angle`(조준각) — 이 앵커는 `VolleyParams.aimAngle` 이
 * 실린 정상 발사 파이프라인 밖이라 `nearestTarget`(world.ts 소유)을 다시 부를 수 없고, 같은
 * 폴백을 이미 쓴 선례가 있다(`skills/mallow.ts` SQ10 · `skills/bubble.ts` · `skills/arccaster.ts`).
 */

import type { WorldState, InputFrame } from '../world.js';
import type { Entity } from '../entities.js';
import { spawnBullet } from '../entities.js';
import type {
  VolleyParams,
  GemMagnetParams,
  PlayerMoveParams,
  WallHitParams,
  WallShockRequest,
} from '../skillHooks.js';
import type { ActiveSkillDef } from '../../../data/ships/actives/types.js';
import { fanStrike, clearEnemyBullets, emitVolley } from '../activeTypes.js';
import { isElite } from '../elite.js';
import { atan2, cos, sin } from '../math.js';
import { FIRE_CD_Q, WEAPON_TYPE_BEAM, WEAPON_TYPE_RAILGUN } from '../constants.js';
import type { DamageSourceMask } from '../skillSlots.js';
import {
  readSlot,
  writeSlot,
  BruiserCarry,
  BruiserStage,
  DamageSource,
  hasDamageSource,
} from '../skillSlots.js';
// ⚠️ **값 import 다** — 규율 ① 은 `world.ts` 만 금지한다. `status.ts` 의 값 의존은 순환이
// 아니다: `status.ts` → `chainHooks.ts` → `skills/{arccasterChain,mallowStatus}.ts` 로 끝나고
// 어느 쪽도 `skills/bruiser.ts` 를 되짚지 않는다(`skills/hatchling.ts` 가 같은 근거로 이미
// `applySlow` 를 값으로 끌어온다). 아크캐스터·말로우가 leaf 파일을 뗀 것은 그 두 기체의 훅이
// **`chainHooks.ts` 안에** 있어서지 `status.ts` 를 쓰기 때문이 아니다.
import { applyBurn, FIRE_DURATION } from '../status.js';
import { ARMOR_MAX_STACKS, ARMOR_DECAY_TICKS, clampArmorStacks } from '../shipSignature.js';
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

import {
  POINT_BLANK_RANGE,
  CRUSH_FIELD_PERIOD,
  CRUSH_FIELD_PUSH,
  CLOT_SETTLE_BP,
  TROPHY_RUN_CAP_BP,
  LOAD_TRANSFER_DASH_TICKS,
  MOMENTUM_FULL_TICKS,
  retortVolleyDamageBp,
  pointBlankDamageBp,
  fullPlateBlastBp,
  fullPlateBlastRadius,
  overflowVentCount,
  overflowVentDamage,
  ramCleaveWidth,
  ramCleaveDamage,
  massSlugPush,
  massSlugDamageBp,
  wallBreakerCount,
  wallBreakerDamage,
  temperCap,
  temperLeadBonusBp,
  cadencePeriod,
  burnOffRefundQ,
  wreckHarvestRange,
  heavyMomentumMaxBp,
  skidCooldownTicks,
  haulBlinkWidth,
  crushFieldRadius,
  crushFieldDamage,
  debrisReclaimRefund,
  reboundRefundBp,
  harvestClampRewind,
  arrivalShockRadius,
  arrivalShockPush,
  overPlatingBonus,
  clotPlatingBp,
  recoilReflectBp,
  unbreakableChainRadius,
  loadTransferCutBp,
  trophyHpPerStack,
  moltRegenHeal,
  lastStandPerStackBp,
  cremationBurnPerTick,
} from './bruiserScaling.js';

const enum Sk {
  /** BL1 응전 사출 */ retortVolley = 0,
  /** BL2 백병 격발 */ pointBlank = 1,
  /** BL3 만재 중탄 */ fullPlateSlug = 2,
  /** BL4 과적 배출 */ overflowVent = 3,
  /** BL5 충각 절단 */ ramCleave = 4,
  /** BL6 중량 탄자 */ massSlug = 5,
  /** BL7 파성퇴 */ wallBreaker = 6,
  /** BL8 격돌 담금질 */ impactTemper = 7,
  /** BL9 중압 리듬 */ crushCadence = 8,
  /** BL10 소각 여열 */ burnOffHeat = 9,
  /** MO1 충각 적재 */ dashLoading = 10,
  /** MO2 파쇄 수확 */ wreckHarvest = 11,
  /** MO3 둔중 관성 */ heavyMomentum = 12,
  /** MO4 장갑 활주 */ armorSkid = 13,
  /** MO5 견인 돌진 */ haulBlink = 14,
  /** MO6 압쇄장 */ crushField = 15,
  /** MO7 잔해 회수 */ debrisReclaim = 16,
  /** MO8 벽 되튐 */ wallRebound = 17,
  /** MO9 수확 고정 */ harvestClamp = 18,
  /** MO10 착탄 충격 */ arrivalShock = 19,
  /** FO1 과적 장갑 */ overPlating = 20,
  /** FO2 응혈 장갑 */ clotPlating = 21,
  /** FO3 반동 갑주 */ recoilArmor = 22,
  /** FO4 부동 역적립 */ unmovedAccretion = 23,
  /** FO5 불괴 연쇄 */ unbreakableChain = 24,
  /** FO6 하중 전이 */ loadTransfer = 25,
  /** FO7 전리 개장 */ trophyRefit = 26,
  /** FO8 탈피 재생 */ moltRegen = 27,
  /** FO9 사투 본능 */ lastStandInstinct = 28,
  /** FO10 파열 소각장 */ burstCremation = 29,
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

/** FO7: round(1 + 6×Lv/(Lv+14)) HP/스택 — Lv1 = 1, Lv20 ≈ 5, 점근 7. */

/** MO8: 환급 비율 bp = 3000 + round(2000×Lv/(Lv+10)) — Lv20 ≈ 4333bp, 점근 5000bp. */

/**
 * BL9: **N = max(1, round(48/(4+스택)))** — 스택 0 = 12, 만재 8 = 4.
 *
 * ⚠️ `max(1, ·)` 하한은 장식이 아니다. 곡선 자체는 스택 93 이상에서 round 가 0 이 되고, 그러면
 * 아래 `count >= n` 이 매 명중마다 참이 되는 것을 넘어 **주기 개념이 통째로 사라진다**.
 * 지금의 FO1 확장(점근 +4)으로는 스택 ≤ 12 라 도달하지 않지만, 장래에 다른 상한 확장이
 * 생기면 조용히 무너지는 자리라 배선에 하한을 포함한다(설계서 R-2).
 */

/** BL8: 적립 상한 = round(1 + 5×Lv/(Lv+10)) — Lv1 = 1, Lv20 ≈ 4, 점근 6. */

/** MO4: 전용 내부 쿨 = round(60 + 2400/(Lv+19)) 틱 — Lv1 = 180, Lv20 = 122, 점근 60. */

/** BL1: 반격 볼리 피해 배율(bp) = 5000 + 200×Lv — Lv1 = 52%, Lv20 = 90%. */

/** BL1: 내부 쿨(틱, 고정) — 설계 문면 그대로. */
const RETORT_COOLDOWN_TICKS = 60;

/**
 * BL1: 빔 아키타입의 세그먼트 상한을 재현한 값(`world.ts` `BEAM_MAX_SEGMENTS`=16 ×
 * `BEAM_SEGMENT_SPACING`=90). `emitVolley` 는 `reach` 사전 클램프를 호출부 책임으로 두므로(그
 * 함수 doc), 정상 발사 경로 밖에서 새 볼리를 짓는 이 스킬도 같은 상한을 재현해야 사거리를
 * 크게 투자한 빔 브루저의 반격 볼리가 세그먼트 상한을 넘기지 않는다. `world.ts` 가 그 두 상수를
 * 바꾸면 이 값도 같이 바뀌어야 한다(재발 주의 — private 상수라 import 로 공유할 수 없다).
 */
const RETORT_BEAM_MAX_REACH = 1440;

/** FO2 정산 회복 비율(고정 60% — 잔여 40% 소멸, 완전 환급 금지). */
/** FO6 전이 대가 — 경감이 발동한 피격당 대시 쿨다운 가산(틱, 고정). */
/** MO6 압쇄장 주기(틱, 고정). */
/** MO6 압쇄장이 적을 밀어내는 1회 변위(sim 좌표, 고정 — "소량 밀림"). */
/** FO7 런당 누적 가산 상한 = 런 시작 최대 HP 의 이 비율(bp). */

/**
 * FO9 「빈사」 술어의 임계 — 현재 HP 가 최대 HP 의 이 비율(bp) **이하**.
 *
 * 비교는 **교차곱**(`hp × 10000 <= maxHp × bp`)으로 한다 — 나눗셈을 끼우면 소수 hp(엘리트
 * 접촉 배율이 섞인 값)에서 부동소수 잔차가 임계 근처의 판정을 틱마다 뒤집는다.
 */
const LAST_STAND_HP_BP = 3000;

/** FO9 술어 — 이 플레이어가 지금 「빈사」인가. 세 효과 지점이 같은 술어를 읽는다. */
function inLastStand(player: Entity): boolean {
  return player.hp * 10000 <= player.maxHp * LAST_STAND_HP_BP;
}

/**
 * BL2 근접 임계(sim 좌표). **레벨과 무관하게 고정**이다(설계 ② BL2 "임계 350 고정") — 레벨은
 * 피해 배율만 키운다. 임계를 레벨 스케일로 바꾸면 "붙을수록 강해진다" 가 "레벨이 높을수록
 * 멀리서도 붙은 것으로 친다" 로 뒤집힌다.
 */

// ---------------------------------------------------------------------------
// 배치5 — 액티브 계열 판별 · 벽 축 · 이동 축의 상수와 헬퍼
// ---------------------------------------------------------------------------

/**
 * **기동 액티브**(BL5·MO5·MO10 의 술어)의 정본 판별.
 *
 * 축은 `treeIndex === 1`(morph)이고 그 축의 두 정의가 둘 다 `kind === 'dash'` 다
 * (`data/ships/actives/bruiser.ts`). 둘을 **함께** 보는 이유는 장래에 morph 축에 dash 가 아닌
 * 정의가 들어와도 "돌진 경로" 라는 술어가 조용히 넓어지지 않게 하기 위함이다 — 경로 축
 * 스킬(BL5·MO5)은 출발·도착 두 점이 **다르다**는 전제 위에 서 있다.
 */
function isDashActive(def: ActiveSkillDef): boolean {
  return def.treeIndex === 1 && def.kind === 'dash';
}

/**
 * **강화 액티브 고티어**(FO10 의 술어)의 정본 판별 — 축 `treeIndex === 2`(fortify) · `tier`
 * `'hi'` · `kind === 'buff'`.
 *
 * 셋을 **함께** 보는 근거는 {@link isDashActive} 와 같다. 특히 `kind` 를 뺄 수 없다: FO10 의
 * 문면은 *"만료 **폭발**"* 이고 그 폭발은 `ACTIVE_EXPIRE['as_bruiser_fortify_hi']` 하나뿐이라,
 * 장래에 fortify 축 hi 자리에 buff 가 아닌 정의가 들어오면 이 스킬은 **터지지 않은 폭발에
 * 화상을 얹는** 상태가 된다. `tier` 만 보는 판별은 그 순간 조용히 틀린다.
 */
function isFortifyHiActive(def: ActiveSkillDef): boolean {
  return def.treeIndex === 2 && def.tier === 'hi' && def.kind === 'buff';
}

/**
 * FO3 — 반사 피해 비율(bp): `2000 + 200×Lv`. Lv1 = 20% · Lv20 = 60% · 점근 없음(선형).
 *
 * ⚠️ **기준값은 `dmg`(사슬을 전부 통과해 hp 에서 실제로 깎인 값)다.** 경감 전 피해를 쓰고
 * 싶어도 그 값은 사슬 중간의 지역 변수라 복원이 원리적으로 불가능하다(앵커 ④ doc).
 * 부작용으로 **장갑 투자가 늘수록 반사도 준다** — FO2 의 적립이 같은 기준을 쓰는 것과 같은
 * 결이고, 설계 문면("반사 피해")이 기준을 지정하지 않아 여기서 고른 것이다(레인 보고서).
 */

/** FO10 — 화상 틱당 피해: `2 + Lv`. Lv1 = 3 · Lv20 = 22. 지속은 `FIRE_DURATION` 공용값. */

/**
 * 점 `(px,py)` 와 선분 `(ax,ay)-(bx,by)` 사이 **거리의 제곱**. 돌진 경로 판정(BL5·MO5)의 부품.
 *
 * ⚠️ 제곱근을 뽑지 않는다 — 비교 상대도 제곱이라 부동소수 왕복이 한 번 준다. 선분 길이가 0
 * (제자리 발동 · 벽에 막혀 한 칸도 못 간 돌진)이면 `t` 를 0 으로 눌러 **점 대 점**이 된다.
 */
function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  let t = 0;
  if (len2 > 0) {
    t = ((px - ax) * ex + (py - ay) * ey) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const dx = px - (ax + ex * t);
  const dy = py - (ay + ey * t);
  return dx * dx + dy * dy;
}


/**
 * MO3 — 이동 방향을 **부호 3×3 격자**로 양자화한 코드(1..9). 5 가 정지다.
 *
 * 원시 벡터를 그대로 비교하면 아날로그 스틱의 미세 떨림이 매 틱 "방향 전환" 이 되어 관성이
 * 영영 안 쌓인다. 반대로 각도 임계로 하면 임계 근처에서 판정이 틱마다 뒤집힌다 — 부호
 * 격자는 둘 다 없고 **정수 비교 하나**로 끝난다(설계 문면의 *"방향 급전환"* 은 이 격자가
 * 바뀌는 것으로 읽는다. 대각↔직선 전환도 리셋이라 문면보다 약간 엄격하다).
 */
function momentumDirCode(mx: number, my: number): number {
  const sx = mx > 0 ? 1 : mx < 0 ? -1 : 0;
  const sy = my > 0 ? 1 : my < 0 ? -1 : 0;
  return (sx + 1) * 3 + (sy + 1) + 1;
}

/** MO3 — 관성이 최대에 도달하는 지속 틱(고정). 이 값에서 아래 보너스가 온전히 실린다. */
/** MO3 — 코드 5 = `momentumDirCode(0, 0)`. 정지 리셋 술어의 정본(매직넘버 금지). */
const MOMENTUM_STILL_CODE = 5;

/** BL10 — 소각한 스택 1개당 주무기 쿨다운 환급(틱)의 **레벨 스케일**: 2 + 0.2×Lv 틱. */

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
  player.aux1 = Math.max(0, player.aux1 - harvestClampRewind(mo9));
}

/**
 * 앵커 ④ **선체 hp 가 깎인 피격의 후속** — BL4 과적 배출 · FO2 적립 · FO5 불괴 연쇄.
 *
 * ## 이 앵커에 도달한 시점의 상태(world.ts 4317-4371 실측)
 *  - 장갑 적립이 **이미 끝났다**: `aux0` 은 1 증가(상한 클램프)했고 `aux1 = 0` 이다.
 *  - `dmg` 는 감쇠 사슬을 전부 통과해 hp 에서 실제로 깎인 값이다.
 *  - `lethalSurvived` 는 사슬 안에서 한 번 계산된 값이다 — **다시 계산하지 마라**(경감 전
 *    피해가 사슬 중간의 지역 변수라 복원이 원리적으로 불가능하다).
 *
 * ## 배치6 — `contact` 가 붙어 **FO3 반동 갑주**가 여기서 닫혔다
 * `sources` 의 접촉 비트는 *"접촉이 있었다"* 까지만 말한다. 반사는 **대상**이 있어야 성립하고,
 * 그 대상이 후행 선택 인자로 온다. ⚠️ 접촉이 아닌 피격(적탄·해저드)에서는 `undefined` 다.
 *
 * @param contact 이번 피격의 **몸통 접촉 상대 적**. `dmg` 의 `max` 를 이긴 그 한 항목이라,
 *   같은 틱에 여러 적이 닿았어도 하나만 온다(`srcX`/`srcY` 와 같은 규율).
 */
export function bruiserPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
  contact?: Entity,
): void {
  // --- FO9 사투 본능(적립 파라미터 변형) -----------------------------------
  // 설계서: "HP 30% 이하인 동안 … 피격당 적립이 2스택이 된다". 엔진의 적립(+1)은 이 앵커
  // **앞**에서 이미 끝났으므로(world.ts 4317-4320) 여기서 **한 개를 더** 얹는 것이 정확히
  // 2스택이다.
  //
  // ⚠️ **이 블록이 함수 맨 앞인 것이 계약이다.** 뒤로 내리면 아래 BL4(만재 술어)·FO2(만재
  //    엣지 기준)·FO5 가 "적립이 끝난 상태" 가 아니라 1스택 적은 상태를 보게 되어, 같은 틱의
  //    같은 사건을 두 값으로 읽는다. 엔진이 2 를 적립한 것처럼 보이는 것이 이 스킬의 본체다.
  // ⚠️ `aux1 = 0` 도 함께 세운다 — 엔진 적립부가 하는 일과 같은 짝이고, 빠뜨리면 "적립했는데
  //    감쇠 타이머는 안 리셋" 이라는 엔진에 없는 상태가 생긴다.
  const fo9Accrue = lv(state, Sk.lastStandInstinct);
  if (fo9Accrue >= 1 && inLastStand(player)) {
    player.aux0 = clampArmorStacks(player.aux0 + 1, state.armorMaxStacks);
    player.aux1 = 0;
  }

  // --- BL4 과적 배출 -------------------------------------------------------
  // ⚠️ **설계와 어긋나는 지점(레인 보고서에 적었다).** 설계서는 "만재 **상태에서** 실피격" 을
  //    요구하는데, 이 앵커는 적립 **뒤**라 `aux0` 이 이미 상한에 붙어 있다. 즉 적립 직전이
  //    상한이었는지(진짜 잉여) 상한−1 이었는지(이번 피격으로 막 찬 것)를 여기서 구분할 수
  //    없다 — 현재 배선은 **후자에서도 발동**한다(한 칸 넓다). 정확히 하려면 적립 직전 값을
  //    사슬 안에서 넘겨받아야 하고 그것은 앵커 시그니처 변경이라 이 레인 밖이다.
  const bl4 = lv(state, Sk.overflowVent);
  if (bl4 >= 1 && player.aux0 >= state.armorMaxStacks) {
    // 파편 수 = 4 + ceil(Lv/3) · 파편 피해 8 + 2×Lv. 둘 다 게이트 안의 양적 계단이다.
    const count = overflowVentCount(bl4);
    const dealt = overflowVentDamage(bl4);
    // "전방" = +X. 이 게임의 전진 축이고(무대 앵커 +X), 플레이어 엔티티에는 유지되는 조준
    // 벡터가 없어 여기서 자동 조준을 다시 풀 수 없다(`nearestTarget` 은 world.ts 소유).
    fanStrike(state, player, count, dealt, 60, { x: 1, y: 0 });
  }

  // --- FO2 응혈 장갑(적립분) ----------------------------------------------
  // 정산은 앵커 ⑨ 의 만재 상승 엣지다 — 여기서는 풀에 쌓기만 한다.
  // 적립 기준은 **사슬을 전부 통과한 실제 감소분**(`dmg`)이라, 장갑 투자가 늘수록 적립도 준다.
  const fo2 = lv(state, Sk.clotPlating);
  if (fo2 >= 1 && dmg > 0) {
    const add = Math.round((dmg * clotPlatingBp(fo2)) / 10000);
    if (add > 0) {
      writeSlot(
        state.skillCarry,
        BruiserCarry.clotPool,
        readSlot(state.skillCarry, BruiserCarry.clotPool) + add,
      );
    }
  }

  // --- BL8 격돌 담금질(적립처) --------------------------------------------
  // 트리거는 **접촉 기여**뿐이다 — `sources` 는 비트합이라 같은 틱에 적탄이 더 아팠어도
  // (`world.ts` 의 `max` 가 적탄을 골랐어도) 접촉 비트가 서 있으면 적립한다. 설계서가 명시한
  // 술어 그대로다. 단일 유니온이었다면 이 자리가 바로 `max` 에 삼켜지는 지점이다.
  // ⚠️ `dmg` 크기는 보지 않는다 — 적립 단위가 "접촉 피격 1회 = 강화탄 1발" 이라 비례가 아니다.
  const bl8 = lv(state, Sk.impactTemper);
  if (bl8 >= 1 && hasDamageSource(sources, DamageSource.contact)) {
    const cap = temperCap(bl8);
    const cur = readSlot(state.skillStage, BruiserStage.temperCharges);
    if (cur < cap) writeSlot(state.skillStage, BruiserStage.temperCharges, cur + 1);
  }

  // --- FO3 반동 갑주 -------------------------------------------------------
  // 트리거는 **접촉 상대 적이 실제로 있는 틱**이다. `sources` 의 접촉 비트를 함께 보지 않는
  // 이유는 중복이기 때문이다 — `contact` 가 실리는 경로가 곧 접촉 분기 하나뿐이라(호출부
  // `world.ts` 의 `max` 승자 기록), 비트를 겹쳐 보면 같은 사실을 두 벌로 적는 것이 된다.
  //
  // ⚠️ 대상 범위(enemy+boss)는 `blastDamageAt`·BL3·BL5·BL9 와 같게 맞춘다. guardian·core 는
  //    **일부러 뺐다** — 그 둘만 `world.ts:4175-4183` 에 부활 분기가 있어 여기서 hp 를 깎고
  //    `dead` 를 세우면 부활 충전을 건너뛰고 죽인다.
  // ⚠️ 좀비 결함 — `compact()` 의 1차 게이트가 `e.dead` 다(정본 `status.ts` 111-112).
  //    반사로만 죽은 적은 아무도 `dead` 를 안 세워 주므로 여기서 둘을 일치시킨다.
  const fo3 = lv(state, Sk.recoilArmor);
  if (
    fo3 >= 1 &&
    dmg > 0 &&
    contact !== undefined &&
    !contact.dead &&
    (contact.kind === 'enemy' || contact.kind === 'boss')
  ) {
    // `max(1, ·)` 하한은 장식이 아니다 — `dmg` 가 1~4 인 저피해 접촉(감쇠가 거의 다 먹은
    // 틱)에서 round 가 0 이 되어 **"반사 갑주를 찍었는데 아무 일도 안 일어난다"** 가 된다.
    const reflect = Math.max(1, Math.round((dmg * recoilReflectBp(fo3)) / 10000));
    contact.hp -= reflect;
    if (contact.hp <= 0) contact.dead = true;
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
    clearEnemyBullets(state, player, unbreakableChainRadius(fo5));
  }

  // --- BL1 응전 사출 -------------------------------------------------------
  // 트리거는 **`dmg > 0`**(실제로 hp 가 깎였다) 하나뿐 — 막·무효화된 피격은 미발동이 설계
  // 「연계」항의 일관 규칙이다. 내부 쿨(전용 칸 `BruiserStage.retortCooldown`, 값 규약
  // 0=발사 가능)은 앵커 ⑨(`bruiserSignatureStep`)가 매 틱 먼저 깎아 둔다 — 이 블록은 그
  // 결과만 읽고, 실제로 발사할 때만 60 으로 되채운다. 두 앵커의 순서(`stepShipSignature` →
  // `resolveCollisions`, 이 파일 헤더 "앵커 ⑨" doc)가 같은 틱 안에서 "먼저 깎고 뒤에 판정"을
  // 성립시킨다.
  //
  // ⚠️ **쿨다운 미소비가 이 스킬의 정체성이다** — `player.cooldown` 을 한 비트도 안 만진다.
  const bl1 = lv(state, Sk.retortVolley);
  if (bl1 >= 1 && dmg > 0) {
    const cd = readSlot(state.skillStage, BruiserStage.retortCooldown);
    if (cd <= 0) {
      const w = state.weapon;
      // 조준 방향은 `player.angle`(조준각) 폴백이다 — 이 앵커는 `VolleyParams.aimAngle` 이
      // 실린 정상 발사 파이프라인(앵커 ①/⑯) 밖이라 `nearestTarget`(world.ts 소유) 을 다시 부를
      // 수 없다. 표적이 없는 방향을 조준각이 가리키는 순간이 있고 그것이 정상 동작이다
      // (`skills/mallow.ts` SQ10 이 같은 자리에서 같은 이유로 같은 폴백을 쓴다).
      const reach =
        w.weaponType === WEAPON_TYPE_BEAM
          ? Math.min(w.range, RETORT_BEAM_MAX_REACH)
          : w.range > 0
            ? w.range
            : 0;
      const volley: VolleyParams = {
        // 반격 볼리 피해 = 무기 기준 피해의 50% + 2%p/Lv. 과충전·정조준 등 발사 시점 배율은
        // 정상 발사 파이프라인(앵커 ⑯)에서만 계산되고 여기서는 재현하지 않는다 — 이 볼리는
        // "지금 장착한 무기 스탯 기준의 별도 카운터"이지 그 틱의 실제 발사를 복제한 것이 아니다.
        damage: Math.round((w.damage * retortVolleyDamageBp(bl1)) / 10000),
        pierce: w.pierce,
        count: w.bulletCount,
        speed: w.bulletSpeed,
        radius: w.bulletRadius,
        // 사거리 보정(`reachLife` 동형)은 하지 않는다 — `w.bulletLife` 그대로다. 이 스킬은 이미
        // 자신을 때린 상대에게 되쏘는 반격이라 표적이 사거리 끝에 있는 경우가 드물고, 무투자
        // 런과 달리 사거리 투자 런에서 탄이 최대 사거리에 살짝 못 미쳐 죽는 것은 이 반격
        // 볼리의 부수 효과일 뿐 설계가 요구한 성질이 아니다(레인 보고서 — 알려진 단순화).
        life: w.bulletLife,
        spread: w.spread,
        // 쿨다운 미소비 — `emitVolley` 는 이 필드를 한 비트도 안 읽는다(호출부 책임 계약).
        cooldownQ: 0,
        // 정조준·BL3·BL6 마크를 얹지 않는다 — 이 볼리는 정상 발사 파이프라인(앵커 ⑯)을
        // 거치지 않아 그 마크들의 소비/적립 로직과 얽히지 않는다(설계 미명시, 레인 판단).
        mark: 0,
        leadDamageBonus: 0,
        leadPierceBonus: 0,
        recordSpawnDamage: false,
        recordSpawnOrigin: false,
        countUsed: w.weaponType !== WEAPON_TYPE_RAILGUN && w.weaponType !== WEAPON_TYPE_BEAM,
        ballisticsUsed: w.weaponType !== WEAPON_TYPE_BEAM,
        // 이 볼리는 표적을 다시 고르지 않는다(위 조준각 주석) — 읽기 전용 사실 필드라 0.
        targetDist: 0,
        aimAngle: player.angle,
        inputX: 0,
        inputY: 0,
        cloakBreak: false,
      };
      emitVolley(state, player, player.angle, volley, reach);
      writeSlot(state.skillStage, BruiserStage.retortCooldown, RETORT_COOLDOWN_TICKS);
    }
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
    const cut = Math.round((out * loadTransferCutBp(fo6)) / 10000);
    if (cut > 0) {
      out -= cut;
      if (out < 0) out = 0;
      player.dashCooldown += LOAD_TRANSFER_DASH_TICKS;
    }
  }
  // FO9 — 빈사 중 **스택당 감소량 강화**. 추가 감소 = 스택 × (20 + 5×Lv) bp.
  //
  // ⚠️ **설계와 어긋나는 지점(레인 보고서에 적었다).** 설계서는 이 강화를 감소 적용부
  //    (`armorReductionBp` 를 쓰는 그 자리) 안에서 **스택당 bp 에 가산**하라고 적었는데, 이
  //    앵커는 장갑 **앞**이라(앵커 ⑧ 은 사슬에 뚫린 유일한 스킬 자리다) 두 감소가 더해지지
  //    않고 **곱해진다**. 같은 스택·같은 레벨에서 설계보다 총 경감이 근소하게 **작다**
  //    (250bp 장갑 8스택 + 120bp 강화면 설계 29.6% vs 여기 1−0.8×0.904 = 27.7%). 부호가
  //    유리한 쪽으로 틀리지 않으므로 이 순서로 배선했다 — 바로잡으려면 사슬에 슬롯을 하나 더
  //    뚫어야 하고 그것은 이 레인 밖이다(FO6 이 같은 자리에서 같은 사유를 안고 있다).
  // ⚠️ 순서는 FO6 **뒤**다. 그래야 FO6 의 전이량(대시 쿨 지불 빈도)이 종전과 비트 동일하고,
  //    FO9 미투자 런은 이 블록을 한 줄도 안 지난다.
  const fo9 = lv(state, Sk.lastStandInstinct);
  if (fo9 >= 1 && out > 0 && inLastStand(player)) {
    const stacks = clampArmorStacks(player.aux0, state.armorMaxStacks);
    if (stacks > 0) {
      // 반올림은 이 게이트 **안**이다(규율 ③).
      const cut = Math.round((out * stacks * lastStandPerStackBp(fo9)) / 10000);
      if (cut > 0) {
        out -= cut;
        if (out < 0) out = 0;
      }
    }
  }
  return out;
}

/**
 * 앵커 ⑨ **시그니처 틱 진행**(매 틱 정확히 한 번) — FO1 · MO4 · **FO4·FO8·FO9①** · FO2 정산 ·
 * FO7 기준선 · MO6.
 *
 * ## 이 앵커는 `stepShipSignature` 진입점이다
 * `world.ts` 실측 순서는 `stepPlayer`(1813) → `stepShipSignature`(1859, 이 앵커가 2426) →
 * `resolveCollisions`(1905) 다. 그래서 여기서 세운 값은 **이번 틱의 감쇠 분기(2427-2435)와 이번
 * 틱의 피격 처리 양쪽에 모두 반영된다** — FO1 이 상한을 여기서 세워도 한 틱 늦지 않는다.
 *
 * ## ⚠️ 감쇠 분기를 **사후 관측이 아니라 선점**으로 다룬다 (FO4·FO8·FO9①)
 * 종전 주석은 이 셋을 "감쇠 분기 그 자리를 고쳐야 하니 미배선" 으로 남겼고, 그 근거는
 * *"앵커에서 스택 감소를 **사후 관측**해 흉내 내면 액티브의 스택 소각(blade_lo/hi)과 구분이
 * 안 돼 조용히 오발동한다"* 였다. 그 경고는 **사후 관측 형태에만** 유효하다 — 이 배선은 감소를
 * 한 번도 관측하지 않는다. 이 앵커가 분기보다 **앞**이라는 순서를 써서, 분기가 쓰는 것과
 * **같은 술어**(`aux1 + 1 >= ARMOR_DECAY_TICKS`)로 *"이번 틱에 감쇠가 성사된다"* 를 판정하고
 * 그 자리에서 부호를 바꾸거나(FO4) 막거나(FO9①) 회복으로 환산한다(FO8). 액티브의 소각은
 * `aux1` 을 건드리지 않으므로 이 술어에 원리적으로 안 걸린다.
 *
 * `aux1 = 0` 으로 되돌리면 분기의 `aux1++` 가 1 을 만들어 소멸이 성사되지 않는다 — 분기를
 * 고치지 않고 그 결과만 뒤집는 형태이고, 술어의 정본은 여전히 `world.ts` 한 곳이다.
 */
export function bruiserSignatureStep(
  state: WorldState,
  player: Entity,
  input: InputFrame,
): void {
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

  // --- BL1 응전 사출(내부 쿨 감산) -----------------------------------------
  // 이 앵커가 `stepShipSignature` **진입점**이라 매 틱 정확히 한 번 불린다 — `skidCooldown`
  // (MO4)과 달리 `retortCooldown` 의 소비처(앵커 ④)는 매 틱 불리지 않으므로, 감산을 그 소비처
  // 안에 두면 "피격이 없던 틱 동안은 쿨이 안 준다" 는 결함이 생긴다. 감산은 여기 한 곳,
  // 판정·재충전은 앵커 ④(`bruiserPlayerDamaged`) 한 곳 — 역할이 갈린다.
  const bl1Cd = lv(state, Sk.retortVolley);
  if (bl1Cd >= 1) {
    const cd = readSlot(state.skillStage, BruiserStage.retortCooldown);
    if (cd > 0) writeSlot(state.skillStage, BruiserStage.retortCooldown, cd - 1);
  }

  // --- MO4 장갑 활주 — **이 앵커에서 `onPlayerMoveParams` 로 이사했다**(배치5) -----
  // 종전 배선은 여기서 `state.playerSlowTicks` 를 직접 0 으로 눌렀고, 그 자리의 알려진 결함이
  // *"한 틱 늦는다"* 였다 — 감속을 **세우는** 자리(`resolveCollisions`)가 이 앵커 뒤이고 감속을
  // **읽는** 자리(`stepPlayer`)가 이 앵커 앞이라, 부여된 감속이 다음 틱 이동에 정확히 한 번
  // 실린 뒤에야 지워졌다. 배치5 의 `onPlayerMoveParams` 가 **감속이 소비되기 직전**에 서므로
  // 부여 지점이 몇 개든 그 틱 안에서 0 으로 되돌릴 수 있다 → 본체는 `bruiserPlayerMoveParams`.

  // --- MO3 둔중 관성(카운터 갱신) ------------------------------------------
  // 효과(이속 배율)는 `bruiserPlayerMoveParams` 가 낸다. **카운터를 여기서 도는 이유**는
  // 술어가 *입력 방향*이기 때문이다 — `onPlayerMoveParams` 는 `input` 을 받지 않고, 그 자리의
  // `player.vx/vy` 는 감속·모듈 배율·대시 임펄스가 섞인 **직전 틱 결과**라 "같은 방향으로
  // 이동을 지속했는가" 의 술어로 쓰면 대시 한 번에 방향이 흔들린다. 정지 판정을 입력으로
  // 하는 것은 FO4 가 이미 세운 이 파일의 규율이다(설계서 1.5 계약).
  //
  // ⚠️ **효과가 한 틱 늦는다 — 구조에서 오는 성질이다.** `world.ts` 실측 순서가
  //    `stepPlayer`(이 스킬의 소비처) → `stepShipSignature`(이 카운터)라, 틱 N 에 여기서 센
  //    지속 틱은 틱 N+1 의 이동에 실린다. 램프가 120틱에 걸쳐 오르는 스킬이라 1틱 지연은
  //    관측되지 않는다(대신 **리셋도 1틱 늦다** — 급전환 직후 한 틱은 옛 배율로 움직인다).
  const mo3 = lv(state, Sk.heavyMomentum);
  if (mo3 >= 1) {
    const code = momentumDirCode(input.moveX, input.moveY);
    if (code === MOMENTUM_STILL_CODE) {
      // 정지 = 즉시 리셋. 방향 칸도 함께 비워, 재출발 첫 틱이 "같은 방향 지속" 으로 이어지지
      // 않게 한다(비우지 않으면 잠깐 멈췄다 같은 방향으로 가는 것이 무료가 된다).
      writeSlot(state.skillStage, BruiserStage.momentumTicks, 0);
      writeSlot(state.skillStage, BruiserStage.momentumDir, 0);
    } else if (readSlot(state.skillStage, BruiserStage.momentumDir) === code) {
      const t = readSlot(state.skillStage, BruiserStage.momentumTicks);
      // 상한에서 멈춘다 — 무한 증가는 u32 폴드에서 의미가 없고 배율도 어차피 상한이다.
      if (t < MOMENTUM_FULL_TICKS) writeSlot(state.skillStage, BruiserStage.momentumTicks, t + 1);
    } else {
      // 방향 급전환 = 리셋. 이번 틱부터 1 로 다시 센다(0 이 아니라 1 — 이미 그 방향으로 한 틱
      // 움직였다).
      writeSlot(state.skillStage, BruiserStage.momentumDir, code);
      writeSlot(state.skillStage, BruiserStage.momentumTicks, 1);
    }
  }

  // --- 감쇠 판정 선점 — FO4 부동 역적립 · FO9① 감쇠 정지 · FO8 탈피 재생 ----
  // 셋의 우선순위는 **FO4 → FO9① → FO8** 이고, 이 순서가 설계서가 적은 축 내 긴장 그대로다
  // (*"감쇠를 막거나 뒤집을수록 FO8 이 죽는다"* — FO8 은 스택이 **실제로 소멸할 때만** 돈다).
  const fo4 = lv(state, Sk.unmovedAccretion);
  const fo8 = lv(state, Sk.moltRegen);
  const fo9 = lv(state, Sk.lastStandInstinct);
  if (fo4 >= 1 || fo8 >= 1 || fo9 >= 1) {
    // 분기가 쓰는 것과 **같은 술어**다 — 분기는 `aux1++` 뒤에 `>= ARMOR_DECAY_TICKS` 를 본다.
    const decayDue = player.aux1 + 1 >= ARMOR_DECAY_TICKS;
    if (decayDue) {
      // 정지 판정은 **입력**으로 한다(설계서 1.5 계약 · 아크캐스터 시그니처와 같은 술어).
      // 속도로 판정하면 감속 장판·코어 모듈 배율이 섞여 "멈춰 있는데 이동 중" 이 된다.
      const still = input.moveX === 0 && input.moveY === 0 && !input.dash;
      if (fo4 >= 1 && still) {
        // FO4 — 같은 판정 틱의 **부호 반전**: 소멸 대신 적립.
        // ⚠️ **설계와 어긋나는 지점(레인 보고서에 적었다).** 설계서는 정지 중에만 쓰는 별도
        //    주기(60 + 3600/(Lv+11) 틱, Lv1 = 360)를 요구하는데, 그 주기는 `aux1` 이 엔진 소유
        //    (180 에서 강제 리셋)라 **전용 카운터 1칸 없이는 담을 수 없다**. 강화 축의 신규
        //    상태 예산은 FO2·FO7 로 2/2 포화라 칸을 더 잡지 않았다. 그래서 주기는 엔진의
        //    180 을 그대로 쓰고 **레벨은 게이트로만 작동한다**(MO1 이 같은 형태다) — Lv1 에서
        //    설계(360틱)보다 두 배 자주 적립된다. 밸런스 일괄 레인이 볼 자리다.
        player.aux0 = clampArmorStacks(player.aux0 + 1, state.armorMaxStacks);
        player.aux1 = 0;
      } else if (fo9 >= 1 && inLastStand(player)) {
        // FO9① — 빈사 중 감쇠 정지. 스택이 줄지 않으므로 FO8 의 "소멸" 도 일어나지 않는다.
        player.aux1 = 0;
      } else if (fo8 >= 1 && player.aux0 > 0) {
        // FO8 — 이번 틱에 **실제로 소멸할** 스택 1개를 회복으로 환산한다(3 + 1×Lv HP).
        // 소멸 자체는 막지 않는다 — 분기가 그대로 1스택을 가져간다.
        const heal = moltRegenHeal(fo8);
        player.hp = Math.min(player.maxHp, player.hp + heal);
      }
    }
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
    const radius = crushFieldRadius(mo6);
    const dealt = crushFieldDamage(mo6);
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
      // ⚠️ `compact` 는 **`dead === true` 만 수거**한다 — `hp <= 0` 단독으로는 안 걷는다.
      //    여기서 안 세우면 압쇄장으로만 죽은 적이 좀비로 남아 처치·젬·전리품이 전부 사라진다.
      //    `status.ts` 의 `applyChain`·`tickEnemyStatus` 와 같은 형태다(집계는 `compact` 몫).
      if (e.hp <= 0) e.dead = true;
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
 * `target.hp` 를 더 깎는 것은 되돌리기가 아니라 **추가 피해**다(부활 판정은 이 앵커 앞에서 이미
 * 해소됐다 — 이 사유는 유효하다).
 *
 * ⚠️ **정정(좀비 부류의 뿌리)**: 여기 원래 *"`compact` 의 처치 게이트가 `hp <= 0` 이라 이 감산으로
 * 넘어간 적은 같은 틱에 정상 격추된다"* 고 적혀 있었는데 **틀렸다**. `compact`(`world.ts:4753`)의
 * **1차 게이트는 `e.dead === true`** 이고, `hp <= 0` 은 그 **안쪽**의 킬 집계 게이트일 뿐이다
 * (`world.ts:4763`). 즉 `hp` 만 깎고 `dead` 를 안 세우면 그 적은 수거되지 않고 **좀비**로 남는다 —
 * 계속 움직이고 공격하며 처치·젬·전리품이 전부 사라진다. sim 전체에 `hp<=0 → dead` 를 훑는
 * 일반 스윕은 **없다**(`world.ts`·`status.ts` 전수 확인). 이 오해가 좀비 결함 여러 건을 낳았다.
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
    const blast = Math.round((source.damage * fullPlateBlastBp(bl3)) / 10000);
    if (blast > 0) {
      const radius = fullPlateBlastRadius(bl3);
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
        if (dx * dx + dy * dy > r2) continue;
        e.hp -= blast;
        // ⚠️ **여기의 `e` 는 맞은 표적이 아니라 「주변 적」이다** — `world.ts` 의 격추 판정
        //    (`t.hp -= dealt; if (t.hp <= 0) …`)은 `t` 하나만 본다. 이들은 그 판정을 한 번도
        //    안 거치므로, `dead` 를 안 세우면 `compact` 가 못 걷어 **좀비**로 남는다(처치·젬·
        //    전리품 전부 유실). 형태는 `status.ts` 의 `applyChain`·`blastDamageAt` 과 같은 두
        //    줄이고, 대상 범위(enemy+boss)도 `blastDamageAt` 과 같아 사실이 두 벌이 안 된다.
        // ⚠️ 순회 중 변형 금지 — 플래그만 세우고 엔티티를 낳거나 지우지 않는다.
        if (e.hp <= 0) e.dead = true;
      }
    }
  }

  // --- BL6 중량 탄자(명중 변위) --------------------------------------------
  const bl6 = lv(state, Sk.massSlug);
  if (bl6 >= 1 && source !== undefined && (source.aux0 & MARK_MASS_SLUG) !== 0) {
    // 변위 16 + 2×Lv, 보스·엘리트는 반감. 넉백 규율(7.1) — 속도 대입이 아니라 **좌표 직접
    // 변위**다(적 이동 컴포넌트가 매 틱 속도를 덮어써 속도에 실으면 해시만 갈린다).
    let push = massSlugPush(bl6);
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
    //
    // ⚠️ **정정(2026-08-07)**: 여기 원래 *"대상이 맞은 표적 자신이라 격추 판정을 이미 거쳤으므로
    //    `dead` 를 세우면 그 틱의 판정을 뒤집는 것"* 이라고 적혀 있었는데 **경우를 하나 빠뜨렸다**.
    //    갈리는 축은 「대상이 누구인가」가 아니라 **「표적이 탄을 견뎠는가」** 다:
    //     · **표적이 이미 죽은 경우** — `world.ts:4185` 가 `dead` 를 세운 뒤다. 여기서 다시
    //       세우는 것은 **무연산**이다(되돌리기가 아니다).
    //     · **표적이 살아남은 경우** — 격추 판정은 `hp > 0` 이라 안 탔고, 이 강타가 hp 를 0 이하로
    //       내려도 **아무도 `dead` 를 안 세운다**. `hp<=0 → dead` 를 훑는 일반 스윕이 sim 에
    //       **없으므로**(`world.ts`·`status.ts` 전수 확인) 그 표적은 **좀비**로 남는다 — 계속
    //       움직이고 공격하며 처치·젬·전리품이 전부 유실된다.
    //    앵커 ⑩ 의 금지 사항은 `hp`/`dead` 를 **되돌리는 것**이고(`skillHooks.ts:828-830`), 그
    //    문장은 오히려 *"hp 를 0 으로 만들어도 `dead` 가 거짓이면 죽지 않는다"* 며 이 결함을 직접
    //    경고한다. 아래 두 줄은 되돌리기가 아니라 **둘을 일치시키는** 쪽이다.
    // ⚠️ 대상 범위(enemy+boss)는 `blastDamageAt`·BL3 과 같게 맞춘다 — 같은 사실이 두 벌이 되지
    //    않게. guardian·core 는 **일부러 뺐다**: 그 둘만 `world.ts:4175-4183` 에 부활 분기가 있어
    //    여기서 마킹하면 부활 충전을 건너뛰고 죽인다(그건 진짜로 격추 판정을 뒤집는 것이다).
    // ⚠️ 순회 중 변형 금지 — 플래그만 세우고 엔티티를 낳거나 지우지 않는다.
    const bonus = Math.round((dmg * (8000 + 400 * bl9)) / 10000);
    if (bonus > 0) {
      target.hp -= bonus;
      if (target.hp <= 0 && (target.kind === 'enemy' || target.kind === 'boss')) {
        target.dead = true;
      }
    }
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
 *  - **BL8 격돌 담금질**: ✅ **배선됐다**(W2). 막고 있던 사유는 근거로 남긴다 — 소모처(선두탄
 *    대구경화)는 여기서 됐지만 **적립처(몸통 접촉으로 인한 실피격)** 가 없었다. 앵커 ④ 는
 *    피해원을 구분하지 않았고(`world.ts` 의 max 수집 루프가 접촉원 기여를 지역 변수로도 남기지
 *    않았다) 접촉 판별 앵커가 없었다. 소비처 없는 카운터만 돌리는 것이 이 저장소가 금지한
 *    반쪽 배선이라 양쪽이 열릴 때까지 넣지 않았다.
 *    (2026-08-07 재확인 시점까지도 사유는 유효했다 — 앵커 ④ 의 인자가 `dmg`·`lethalSurvived`
 *     뿐이었다. W2 가 그 자리에 `sources`(피해원 **비트합**)를 실어 적립처를 열었고, 같은
 *     레인이 `VolleyParams.leadDamageBonus`·`leadPierceBonus` 로 「선두탄 1발」을 열어 소모처를
 *     닫았다. 비트합인 이유는 `DamageSource` 주석 — 단일 값이면 `max` 가 접촉을 삼킨다.)
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
    params.damage += Math.round((params.damage * pointBlankDamageBp(bl2)) / 10000);
  }

  // --- BL3 만재 중탄 -------------------------------------------------------
  // 만재 판정은 **고정 8 이 아니라** `state.armorMaxStacks` 를 읽는다 — FO1 이 상한을 늘리면
  // 그 확장을 따라간다(설계서 ② BL3 "고정 8 하드코딩 금지").
  const bl3 = lv(state, Sk.fullPlateSlug);
  if (bl3 >= 1 && player.aux0 >= state.armorMaxStacks) {
    params.mark |= MARK_FULL_PLATE;
  }

  // --- BL8 격돌 담금질(소모처) --------------------------------------------
  // 적립처는 앵커 ④ 다. 여기서는 **1 발만** 꺼내 선두탄 전용 칸에 싣는다 — 적립 단위가
  // "접촉 피격 1회 = 강화탄 1발" 이라 볼리 전체(`params.damage`)에 실으면 부채꼴 무기에서
  // `count` 배로 부푼다. 그래서 `leadDamageBonus`·`leadPierceBonus` 칸을 이 레인이 열었다.
  // ⚠️ 게이트가 `bl8 >= 1 && charges > 0` 인 것이 계약이다. 미투자 런은 적립 자체가 없어
  //    슬롯이 영구 0 이고 이 블록을 한 줄도 안 지난다(전 슬롯 0 = 무폴드).
  const bl8 = lv(state, Sk.impactTemper);
  if (bl8 >= 1) {
    const charges = readSlot(state.skillStage, BruiserStage.temperCharges);
    if (charges > 0) {
      writeSlot(state.skillStage, BruiserStage.temperCharges, charges - 1);
      // 피해 +60% + 3%p/Lv. 산술은 BL2·BL6 과 동형(정수 bp · 단일 나눗셈 · 반올림 1회)이고
      // 반올림은 게이트 **안**이다(규율 ③). 기준은 `params.damage` — 이 앵커가 다른 스킬의
      // 증폭을 이미 실어 둔 값이라 그 위에 얹힌다.
      params.leadDamageBonus += Math.round((params.damage * temperLeadBonusBp(bl8)) / 10000);
      // 관통 +1 은 1레벨에서 온전(BL2 와 같은 규율).
      params.leadPierceBonus += 1;
    }
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
    params.damage += Math.round((params.damage * massSlugDamageBp(bl6)) / 10000);
    // 탄속 ×0.5 · 수명 ×2. **곱만 정확히 상쇄되므로 도달 거리(속도×수명)가 비트 단위로
    // 불변**이다 — 사거리 계약(3.1 `weaponReach` = `reachLife` 동일값)이 요구하는 것이 정확히
    // 그것이라 `reach` 를 다시 구할 필요가 없다(구할 수도 없다 — params 에 없다).
    // 반올림을 끼우면 그 상쇄가 깨지므로 여기서는 정수화하지 않는다.
    params.speed *= 0.5;
    params.life *= 2;
    params.mark |= MARK_MASS_SLUG;
  }
}

/**
 * 앵커 `onActiveFired` **액티브 핸들러 직후** — BL5 충각 절단 · MO5 견인 돌진 ·
 * MO10 착탄 충격 · BL10 소각 여열.
 *
 * ## 이 앵커가 열어 준 것
 *  - **착지 지점** = `player.x/y`(핸들러가 이미 옮겼다) · **출발 지점** = `origin.preX/preY`.
 *    그 둘을 잇는 선분이 BL5·MO5 가 요구한 *"돌진 경로"* 의 정본이다. 경로를 여기서 다시
 *    계산할 방법은 없다 — `blink` 이 벽 슬라이드까지 태워 최종 좌표를 확정하므로
 *    `dir × distance` 로 재구성하면 벽에 막힌 돌진에서 **실제로 지나가지 않은 자리**를 벤다.
 *  - **소각 전 스택** = `origin.preAux0`. BL10 이 재야 할 "소각한 스택 수" 는 이 값과 지금
 *    `player.aux0` 의 **차분**으로만 알 수 있다(칼날 핸들러가 0 으로 비워 놓은 뒤다).
 *
 * ## ⭐ 스폰이 안전한 지점이다
 * `stepActives` 는 `state.entities` 를 순회하지 않는다(슬롯 2칸 루프뿐). 지금 이 함수는 개체를
 * 낳지 않지만(넷 다 기존 개체를 때리거나 옮긴다) 그 제약 때문에 좁힌 것이 아니다.
 *
 * ⚠️ `slot` 은 이 기체에서 소비처가 없다 — 버프 잔여 틱 칸을 고르는 스킬이 브루저에 없다.
 */
export function bruiserActiveFired(
  state: WorldState,
  player: Entity,
  def: ActiveSkillDef,
  origin: { preX: number; preY: number; preAux0: number },
): void {
  const dash = isDashActive(def);

  // --- BL5 충각 절단 -------------------------------------------------------
  // 돌진 경로(선분)에서 일정 폭 안에 든 적을 벤다.
  const bl5 = lv(state, Sk.ramCleave);
  if (bl5 >= 1 && dash) {
    // 절단 폭 60 + 4×Lv · 절단 피해 20 + 6×Lv. 둘 다 게이트 안의 양적 계단이다.
    const width = ramCleaveWidth(bl5);
    const w2 = width * width;
    const dealt = ramCleaveDamage(bl5);
    for (const e of state.entities) {
      if (e.dead) continue;
      // 대상 범위(enemy+boss)는 `blastDamageAt`·BL3·BL9 와 같게 맞춘다 — 같은 사실이 두 벌이
      // 되지 않게. guardian·core 는 **일부러 뺐다**(`world.ts` 의 부활 분기를 건너뛰고 죽인다).
      if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
      if (distSqToSegment(e.x, e.y, origin.preX, origin.preY, player.x, player.y) > w2) continue;
      e.hp -= dealt;
      // ⚠️ 좀비 결함 — `compact()` 의 1차 게이트가 `e.dead` 다(정본 `status.ts` 111-112).
      //    여기서 안 세우면 절단으로만 죽은 적이 계속 움직이고 처치·젬·전리품이 전부 유실된다.
      if (e.hp <= 0) e.dead = true;
    }
  }

  // --- MO5 견인 돌진 -------------------------------------------------------
  // 경로 회랑 안의 젬·드랍을 **도착 지점으로 옮긴다**(수거가 아니다 — 수거의 단일 수렴점은
  // `collectGem` 이고 여기서 걷어가면 콤보·XP 가 두 곳에서 갈린다).
  const mo5 = lv(state, Sk.haulBlink);
  if (mo5 >= 1 && dash) {
    const width = haulBlinkWidth(mo5);
    const w2 = width * width;
    for (const e of state.entities) {
      if (e.dead) continue;
      // ⚠️ **`gem`·`loot` 둘뿐이다.** `magnetEmitter`·`turretPickup`·`bombDevice` 는 문면상
      //    "픽업" 으로 읽히지만 **배치된 기믹**이라 좌표를 옮기면 스테이지 가구가 통째로
      //    따라온다(청크 컬링·기물 배치가 좌표에 매여 있다). 떨어진 드랍 둘만 옮긴다.
      if (e.kind !== 'gem' && e.kind !== 'loot') continue;
      if (distSqToSegment(e.x, e.y, origin.preX, origin.preY, player.x, player.y) > w2) continue;
      e.x = player.x;
      e.y = player.y;
      // 속도를 비운다 — `stepGems` 가 매 틱 자석 속도를 다시 세우지만, 비우지 않으면 이번 틱
      // 잔여 속도가 옮긴 좌표를 그 자리에서 밀어낸다(`loot` 는 `stepGems` 대상도 아니다).
      e.vx = 0;
      e.vy = 0;
    }
  }

  // --- MO10 착탄 충격 ------------------------------------------------------
  // 기동 액티브 **고티어** 도착 틱에만 발동한다. 피해가 없는 것이 문면이다(밀어내기 + 소거).
  const mo10 = lv(state, Sk.arrivalShock);
  if (mo10 >= 1 && dash && def.tier === 'hi') {
    const radius = arrivalShockRadius(mo10);
    const r2 = radius * radius;
    const push = arrivalShockPush(mo10);
    for (const e of state.entities) {
      if (e.dead || e.kind !== 'enemy') continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 <= 0) continue;
      // 넉백 규율(7.1) — 속도 대입이 아니라 **좌표 직접 변위**다(MO6·BL6 과 같은 형태).
      const d = Math.sqrt(d2);
      e.x += (dx / d) * push;
      e.y += (dy / d) * push;
    }
    clearEnemyBullets(state, player, radius);
  }

  // --- BL10 소각 여열 ------------------------------------------------------
  // 칼날 축(`treeIndex === 0`) 액티브가 스택을 태운 만큼 주무기 쿨다운을 환급한다.
  //
  // ⚠️ **설계와 어긋나는 지점(레인 보고서에 적었다).** 문면은 *"소각한 스택 1개당"* 인데 이
  //    앵커가 관측할 수 있는 것은 **순감소분**(`preAux0 − 지금`)뿐이다. `blade_lo` 는 쌓인
  //    스택을 그대로 태우므로 순감소분 = 소각분으로 정확히 일치하지만, `blade_hi` 는 *먼저
  //    만재로 채운 뒤 전량을 태우는* 2단이라 실제 소각분이 `armorMaxStacks` 인데 순감소분은
  //    `preAux0` 다 — **스택이 비어 있을 때 쏜 고티어는 환급이 0 이 된다.** 정확히 하려면
  //    핸들러가 소각량을 실어 보내야 하고(`activeHandlers/bruiser.ts`) 그것은 이 레인 밖이다.
  //    핸들러 내부(고티어는 만재로 채운다)를 여기서 다시 적는 대안은 같은 사실의 두 번째
  //    사본이라 택하지 않았다.
  const bl10 = lv(state, Sk.burnOffHeat);
  if (bl10 >= 1 && def.treeIndex === 0) {
    const burned = origin.preAux0 - player.aux0;
    if (burned > 0) {
      player.cooldown -= burned * burnOffRefundQ(bl10, FIRE_CD_Q);
      // ⚠️ **0 에서 멈춘다.** `player.cooldown` 은 음수 잔여분을 `(−FIRE_CD_Q, 0]` 로 유계하게
      //    들고 다니는 carry 다(`world.ts` 발사부 주석). 그 아래로 내리면 소수 주기 재현
      //    장치가 깨져 이후 연사가 통째로 어긋난다. 0 = "지금 쏠 수 있다" 로 이미 최대다.
      if (player.cooldown < 0) player.cooldown = 0;
    }
  }
}

/**
 * 앵커 `onActiveExpired` **액티브 버프가 이번 틱에 0 이 된 직후** — FO10 파열 소각장.
 *
 * ## 호출 순서가 이 배선의 전부다
 * `stepActives` 는 `ACTIVE_EXPIRE[def.id]?.(...)` 를 먼저 부르고 **그 다음 줄**에서 이 앵커에
 * 온다. 즉 도달 시점에 `as_bruiser_fortify_hi` 의 폭발(`blastDamage`)은 **이미 끝났고**, 반경
 * 안에서 폭발로 죽은 적은 `dead` 가 서 있다. 그래서 이 함수는
 *  - **화상을 얹을 뿐 hp 를 깎지 않는다**(`applyBurn` 은 `iframes`/`dashCooldown` 만 만진다) —
 *    좀비 결함이 원리적으로 생기지 않는 형태다.
 *  - `dead` 를 건너뛴다. 폭발로 이미 죽은 적에게 화상을 얹으면 `compact()` 의 화상 잔존 게이트를
 *    통해 **사체가 한 틱 더 사는** 상태가 만들어진다(`status.ts` 의 만료 앵커 ㉚ 주석).
 *
 * ## 반경은 `def.coeff.blastRadius` 하나뿐이다 — 두 번째 정본을 만들지 마라
 * 문면이 *"만료 **폭발**이 … 맞은 적에게"* 라 화상 대상은 **폭발이 닿은 집합과 같아야** 한다.
 * 상수를 따로 적으면 밸런스 패스가 폭발 반경만 고치는 순간 둘이 조용히 갈린다.
 *
 * ⚠️ `slot` 은 이 기체에서 소비처가 없어 인자로 받지 않는다({@link bruiserActiveFired} 와 같다).
 * ⚠️ RNG 0 소비 · 엔티티 생성 0(스폰은 이 앵커에서 안전하지만 이 스킬은 필요로 하지 않는다).
 */
export function bruiserActiveExpired(
  state: WorldState,
  player: Entity,
  def: ActiveSkillDef,
): void {
  const fo10 = lv(state, Sk.burstCremation);
  if (fo10 < 1 || !isFortifyHiActive(def)) return;
  const radius = def.coeff.blastRadius ?? 0;
  if (radius <= 0) return;

  // 적탄 소거 — 폭발과 같은 반경·같은 중심(플레이어)이다.
  clearEnemyBullets(state, player, radius);

  // 화상 — 폭발이 닿은 그 집합. 대상 범위(enemy+boss)는 `blastDamageAt` 과 같게 맞춘다.
  const perTick = cremationBurnPerTick(fo10);
  const r2 = radius * radius;
  for (const e of state.entities) {
    if (e.dead) continue;
    if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (dx * dx + dy * dy > r2) continue;
    applyBurn(e, perTick, FIRE_DURATION);
  }
}

/**
 * 앵커 `onGemMagnetParams` **자석 반경 확정 직후·제곱 전** — MO2 파쇄 수확.
 *
 * ## ⚠️ 설계와 어긋나는 지점(레인 보고서에 적었다)
 * 문면은 *"근접 임계 이내에서 **처치한 적이 떨군** 젬"* 이라 젬 **개체별** 술어인데, 이 앵커가
 * 고칠 수 있는 것은 이번 틱의 **반경 하나**뿐이다(`GemMagnetParams` 에 젬 목록이 없고, 젬에는
 * "누가 떨궜는가" 를 담는 칸도 없다). 그래서 배선은 *"근접 임계 안의 젬은 자석 반경이 얼마든
 * 반드시 끌려온다"* 는 **하한 보장**으로 옮겼다 — 문면의 *"자석 반경과 무관하게"* 는 그대로
 * 성립하고, 대신 그 반경 안에 **다른 사유로 놓인 젬까지** 함께 끌린다(한 칸 넓다).
 */
export function bruiserGemMagnetParams(
  state: WorldState,
  player: Entity,
  params: GemMagnetParams,
): void {
  void player;
  const mo2 = lv(state, Sk.wreckHarvest);
  if (mo2 < 1) return;
  // 하한 = 근접 임계(BL2 와 **같은 상수**를 읽는다 — 이 기체의 "근접" 은 한 벌이다) + 10×Lv.
  // ⚠️ **덮어쓰지 않고 올리기만 한다.** 자석 파워업·자석 버프로 이미 더 넓은 런에서 반경을
  //    이 값으로 대입하면 스킬을 찍는 순간 자석이 **줄어든다**.
  const floor = wreckHarvestRange(mo2);
  if (params.radius < floor) params.radius = floor;
  // `broodRadius` 는 해츨링 소관이다 — 건드리지 않는다.
}

/**
 * 앵커 `onPlayerMoveParams` **이동 배율 산출 직전** — MO3 둔중 관성 · MO4 장갑 활주.
 *
 * ## ⭐ MO4 의 "0틱 무효화" 가 여기서 성립한다
 * 종전 자리(앵커 ⑨ = `stepShipSignature`)는 감속을 **읽는** 자리보다 뒤라 무효화가 항상 한 틱
 * 늦었다. 이 앵커는 감속이 **소비되기 직전**이라 부여 지점이 몇 개든 그 틱 안에서 0 이 된다.
 * 호출부는 되쓴 `slowTicks` 로 배율을 정한 **뒤** 1 을 깎으므로, 0 을 쓰면 배율이 1 이고
 * 감소도 돌지 않는다(음수로 새지 않는다).
 *
 * ⚠️ **매 틱 불린다.** 나눗셈은 전부 투자 게이트 **안**이다(`skills/striker.ts` 규율 ③).
 */
export function bruiserPlayerMoveParams(
  state: WorldState,
  player: Entity,
  params: PlayerMoveParams,
): void {
  // --- MO4 장갑 활주 -------------------------------------------------------
  // ⚠️ **전용 내부 쿨이 구조 필수다**(설계서 MO4). 감속 장판 적용부는 **매 틱 감속을
  //    재부여**하므로, 쿨이 없으면 장판 위 8틱에 8스택이 증발한다. `playerSlowTicks` 잔여로
  //    겸용하는 대안은 자기모순이다 — 무효화에 성공하면 잔여가 0 이라 쿨 판정의 근거가 사라진다.
  // ⚠️ 무적 중에도 돈다 — 감속 부여가 무적 가드보다 위라(설계서 MO4) 무적 중에도 감속이
  //    걸리고, 그러면 이 스킬의 소모·쿨도 같이 도는 것이 설계 명시다.
  const mo4 = lv(state, Sk.armorSkid);
  if (mo4 >= 1) {
    const cd = readSlot(state.skillStage, BruiserStage.skidCooldown);
    if (cd > 0) {
      writeSlot(state.skillStage, BruiserStage.skidCooldown, cd - 1);
    } else if (params.slowTicks > 0 && player.aux0 > 0) {
      player.aux0 -= 1;
      params.slowTicks = 0;
      writeSlot(state.skillStage, BruiserStage.skidCooldown, skidCooldownTicks(mo4));
    }
  }

  // --- MO3 둔중 관성 -------------------------------------------------------
  // 카운터는 앵커 ⑨ 가 **입력**으로 굴린다(그 자리의 주석이 근거). 여기서는 읽어서 배율만 낸다.
  const mo3 = lv(state, Sk.heavyMomentum);
  if (mo3 >= 1) {
    let t = readSlot(state.skillStage, BruiserStage.momentumTicks);
    if (t > 0) {
      if (t > MOMENTUM_FULL_TICKS) t = MOMENTUM_FULL_TICKS;
      // 최대 가산 10% + 3%p/Lv, 지속 틱에 **선형 비례**. 나눗셈이 게이트 안이다(규율 ③).
      // 반올림하지 않는다 — `speedMult` 는 배율(실수)이고, 여기서 정수화하면 램프가 계단이 된다.
      params.speedMult += (t / MOMENTUM_FULL_TICKS) * (heavyMomentumMaxBp(mo3) / 10000);
    }
  }
}

/**
 * 벽 축 앵커 ① `onWallHit` **겹침 확정 직후 · `w.hp` 감산 앞** — BL7 파성퇴.
 *
 * ## 왜 감산 **앞**이어야 하는가
 * *"일격 파괴"* 는 이번 히트의 **피해를 바꾸는 것**으로만 표현된다. 감산 뒤로 가면 `wall.hp` 가
 * 이미 깎여 "한 방에 부순다" 를 적을 자리가 없다. `params.damage` 는 호출부에서 `min`·`max`
 * 없이 그대로 `w.hp -= …` 로 소비되므로(`WallHitParams.damage` doc 이 경로를 짚었다) `wall.hp`
 * 를 그대로 실으면 정확히 0 이 되어 파괴가 확정되고, 그 직후 `onWallDestroyed`(MO7)가 돈다.
 *
 * ⚠️ **`wall.dead` 를 직접 세우지 마라** — 세우면 호출부의 `w.hp <= 0` 분기를 우회해
 * `onWallDestroyed` 가 안 불리고 MO7 이 조용히 죽는다(앵커 doc 의 명시 금지).
 * ⚠️ **순회 안이라 스폰이 금지다.** 충격파는 `params.shockAt` 에 **요청만** 적고 루프 뒤
 * `onWallShockResolve` 에서 낳는다.
 */
export function bruiserWallHit(
  state: WorldState,
  player: Entity,
  bullet: Entity,
  wall: Entity,
  params: WallHitParams,
): void {
  void player;
  const bl7 = lv(state, Sk.wallBreaker);
  if (bl7 < 1) return;
  // 게이트는 **훅 책임**이다(앵커 헤더) — 이 앵커는 적탄·불파괴 벽에서도 불린다.
  //  · `kind === 'bullet'` : 아군탄만. 적탄에서 `damage` 를 만져도 호출부가 소비하지 않는다.
  //  · `wall.hp > 0` : 파괴가능 벽만(`isBreakableWall` 의 술어. 그 함수는 `modes/blockBreak.ts`
  //    소유라 이 leaf 에서 값으로 import 하면 계층이 무너진다 — 앵커 doc 이 "`hp > 0`" 을 훅의
  //    판별 근거로 명시했다).
  if (bullet.kind !== 'bullet' || wall.hp <= 0) return;
  // 일격 파괴 — 남은 hp 를 그대로 실어 정확히 0 으로 만든다. `Math.max` 로 올리기만 한다:
  // 이미 그 이상 때리는 탄(고피해 볼리)의 피해를 **깎지 않기** 위해서다.
  if (params.damage < wall.hp) params.damage = wall.hp;
  // 충격파 요청 — 좌표는 벽에 닿은 지점(탄의 이번 틱 종말 좌표), 방향은 탄의 진행 방향이다.
  // ⚠️ 요청은 **덮어쓴다**. 한 탄이 한 벽에 겹치는 사건마다 한 건이라 여기서 쌓을 것이 없고,
  //    `shockAt` 은 호출부가 히트마다 새로 만드는 레코드다.
  params.shockAt = { x: bullet.x, y: bullet.y, dirX: bullet.vx, dirY: bullet.vy };
}

/**
 * 벽 축 앵커 ③ `onWallShockResolve` **투사체 루프 밖** — BL7 파성퇴의 전방 충격파.
 *
 * ⭐ 여기서는 스폰이 안전하다(`stepProjectiles` 의 `state.entities` 순회가 끝난 지점).
 * ⚠️ **탄 상한은 훅이 스스로 지킨다** — 호출부는 여기서 세지 않는다(앵커 doc). 바로 옆
 * `bulletSplits` 가 `countKind` 로 지키는 것과 같은 규율이고, `countKind` 가 `world.ts` 사유라
 * 여기서 같은 것을 센다(값 복제가 아니라 같은 배열의 같은 술어다).
 */
export function bruiserWallShockResolve(
  state: WorldState,
  player: Entity,
  req: WallShockRequest,
): void {
  void player;
  const bl7 = lv(state, Sk.wallBreaker);
  if (bl7 < 1) return;
  // 방향 정규화는 **훅 몫**이다(`WallShockRequest.dirX` doc — 단위 벡터가 아니다). 길이 0 은
  // 물리적으로 불가능하지만(정지한 탄은 벽에 겹치지 않는다) `atan2(0,0)` 을 피해 조기 반환한다.
  if (req.dirX === 0 && req.dirY === 0) return;
  // 발수 3 + ceil(Lv/4) · 각도폭 70도 · 피해 12 + 4×Lv. 전부 게이트 안의 양적 계단이다.
  const count = wallBreakerCount(bl7);
  const dealt = wallBreakerDamage(bl7);
  const base = atan2(req.dirY, req.dirX);
  const spread = (70 * Math.PI) / 180;
  const step = count > 1 ? spread / (count - 1) : 0;
  const start = base - spread / 2;
  // 탄 상한 — 살아 있는 아군탄 수를 세고 그 자리에서 멈춘다(초과분은 버린다).
  let live = 0;
  for (const e of state.entities) {
    if (e.kind === 'bullet' && !e.dead) live++;
  }
  for (let i = 0; i < count; i++) {
    if (live >= state.bulletCap) break;
    const a = start + step * i;
    // 삼각함수는 `math.ts` 의 결정론 구현이다(`Math.cos` 금지 — 플랫폼 trig 는 해시를 가른다).
    spawnBullet(
      state,
      req.x,
      req.y,
      a,
      state.weapon.bulletSpeed,
      dealt,
      0,
      state.weapon.bulletRadius,
      state.weapon.bulletLife,
      cos(a),
      sin(a),
    );
    live++;
  }
}

/**
 * 벽 축 앵커 ② `onWallDestroyed` **`wall.dead = true` 직후** — MO7 잔해 회수.
 *
 * ## ⚠️ destructible 절반은 **못 넣었다** — 앵커가 그 경로를 안 지나간다
 * 문면은 *"파괴가능 벽·**destructible** 이 부서질 때"* 인데 이 앵커는 **탄에 의한 벽 파괴
 * 전용**이다(앵커 doc 이 명시). `destructible`(보상 오브젝트)의 파괴는 `compact()` 의 드랍
 * 분기를 타고 이 자리로 오지 않으며, 그 분기에는 스킬 앵커가 하나도 없다(`skillHooks.ts`
 * 전수 grep 으로 확인). 그쪽에 앵커가 서면 이 함수를 그 자리에서도 부르면 된다 — 지금
 * **표식만 적어 두는 반쪽 배선은 하지 않았다**(소비처가 없으면 카운터는 거짓말이다).
 */
export function bruiserWallDestroyed(state: WorldState, player: Entity, wall: Entity): void {
  void wall;
  const mo7 = lv(state, Sk.debrisReclaim);
  if (mo7 < 1) return;
  // 대시 쿨다운 환급 10 + 2×Lv 틱. 0 에서 멈춘다(음수 쿨다운은 `stepPlayer` 의 `> 0` 감소
  // 분기를 영영 안 타 "대시가 준비됐다" 판정이 `=== 0` 인 자리에서 조용히 거짓이 된다).
  if (player.dashCooldown > 0) {
    const back = debrisReclaimRefund(mo7);
    player.dashCooldown = player.dashCooldown > back ? player.dashCooldown - back : 0;
  }
  // "자원이 소량 적립" — 이 기체의 자원은 장갑 스택이다. 적립 짝으로 감쇠 타이머도 리셋한다
  // (엔진 적립부·MO1 이 하는 일과 같은 짝. 빠뜨리면 "적립했는데 타이머는 안 리셋" 이라는
  //  엔진에 없는 상태가 생긴다).
  player.aux0 = clampArmorStacks(player.aux0 + 1, state.armorMaxStacks);
  player.aux1 = 0;
}
