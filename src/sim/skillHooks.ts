/**
 * **210스킬 배선의 앵커** — sim 이 스킬 훅을 부르는 **유일한 지점들**(ADR-0049 S0~S3 + W2
 * + 배치4 앵커 레인 + 배치5 벽 축 + 배치7 F2b). 이 파일에 **44개**, `chainHooks.ts` 에 **2개**
 * = 모두 **46개**다(`onAutoAimTarget`·`onTurretTargetPick`·`onEnemyBulletMoved` 가 배치7 F2b 몫).
 *
 * ## ⛔⛔ 동그라미 번호(①②③…)는 **㉖ 에서 끝났다 — 새 앵커에 번호를 붙이지 마라**
 * 배치4 에서 **네 레인이 병렬로 앵커 9개를 세웠고, ㉗㉘ 가 세 갈래로 중복됐다**:
 * 공유 레인의 `onActiveFired`/`onGemMagnetParams` · 해츨링의 `onTurretCadence`/`onTurretExpired` ·
 * 말로우의 `onCushionSplit`/`onCushionRecoverBp` 가 전부 자기를 ㉗ 또는 ㉘ 라 부른다.
 * **git 은 이 충돌을 전혀 모른다**(다른 파일·다른 줄이라 자동 병합된다).
 *
 * 리드가 머지하며 재배번하는 규약으로 두 배치를 버텼지만, 레인이 늘수록 비용이 커지고
 * **번호는 기계가 검사하지 않는다.** 그래서 여기서 끊는다:
 *
 *  - **앵커의 정본 이름은 함수 이름이다.** 문서·인계·프롬프트에서 `onActiveFired` 처럼 **이름으로**
 *    불러라. 「㉗」 이라고만 적으면 지금은 셋 중 어느 것인지 알 수 없다.
 *  - **기계가 검사하는 레지스트리는 `tests/skillAnchors.test.ts` 의 export 전수 표**다.
 *    앵커를 더하면 거기에 이름을 추가해라 — 안 하면 그 테스트가 빨개진다.
 *  - 기존 ①~㉖ 의 번호는 **이력이므로 그대로 둔다.** 그 범위는 중복이 없다.
 *  - ⚠️ 배치4 가 붙인 ㉗ 이후 번호는 **파일 안에서 신뢰하지 마라** — 그 doc 이 붙어 있는
 *    **함수 이름**이 정본이다.
 *
 * 내역(번호가 유효한 범위): ①~⑨ 플레이어 축(S0) · ⑩⑪ 적 단위(S1) · ⑫⑬⑭ 성장(S1) ·
 * ⑮ 방막 파열 · ⑯~㉒ 볼리 파라미터·막·완충(S2) · ㉓㉔ 해츨링 출격(S3-4) ·
 * ㉕ 정산액 확정 직전(S3) · ㉖ 포탑 사격(W2).
 * 배치4 가 더한 9개(이름으로만 부른다): `onActiveFired` · `onGemMagnetParams` ·
 * `onPlayerMoveParams` · `onBulletHitParams` · `onEliteLootRarity` · `onOverchargeAccrual` ·
 * `onComboDecay` · `onTurretCadence` · `onTurretExpired` · `onCushionSplit` ·
 * `onCushionRecoverBp` · `onObjectiveResolved`, 그리고 `chainHooks.ts` 의 `onChainParams` ·
 * `onEnemyStatusExpired`.
 *
 * S0 가 플레이어 축 9개를 세웠고, **S1 이 적 단위 축 2개(⑩ `onEnemyDamaged` · ⑪ `onEnemyDeath`)와
 * 성장 축 3개(⑫ `onLevelUp` · ⑬ `onPowerupOffer` · ⑭ `onPowerupPicked`)를 더했다.**
 *
 * ⚠️ **⑮ `onFilmBurst` 는 앞의 14개와 성질이 다르다**(배치 4가 뚫었다) — 전 기체 공통 사건이
 * 아니라 **한 기체의 시그니처 사건**(버블 방막 파열)이라, 부르는 쪽도 `stepWorld` 가 아니라
 * `filmBurst.ts` 고 촉매 짝도 없다. 아래 "전 스킬 디스패치 공통 계약" 중 촉매 관련 항목만
 * 그 앵커에 해당하지 않는다.
 * 두 커밋 다 전 분기가 비어 있다 — 만드는 것은 **자리**이지 효과가 아니다 —
 * 전 슬롯 0 · 계수 0 · 빈 `switch` 라 산술이 `v*1===v`·`v-0===v` 로 비트 동일하고, 그래서
 * 골든·침공 해시가 **바이트 불변**이다.
 *
 * ## 왜 `world.ts` 가 아니라 이 leaf 모듈인가
 *  1. **순환 import 방지** — `cloak.ts` 헤더가 적은 것과 같은 사유다. 배선 레인이 만들
 *     `src/sim/skills/{ship}.ts` 를 `world.ts` 가 직접 당기면, 그 모듈들이 `world.ts` 의
 *     헬퍼를 다시 필요로 하는 순간 런타임 순환이 된다. 번들러(`deno bundle`/esbuild)가 모듈
 *     초기화를 재배치하면 TDZ 로 던지거나 초기화 전 바인딩이 되는데, **클라에서는 재현되지
 *     않고 검증 EF 에서만 터진다.** 여기 leaf 에서는 `WorldState`/`Entity`/`InputFrame` 이
 *     전부 type-only import(런타임에 지워진다)라 순환이 구조적으로 존재하지 않는다.
 *  2. **계측 가능한 이음매** — "앵커가 그 사건에서 실제로 불린다"를 증명하려면 호출을 셀 수
 *     있어야 한다. 모듈 경계가 있어야 테스트가 `vi.mock` 으로 감쌀 수 있다. 앵커를
 *     `world.ts` 안 private 함수로 두면 그 증명 자체가 불가능하고, 그러면 배선 레인은
 *     "안 불리는 훅"을 조용히 얹게 된다.
 *  3. **레인 격리** — 7레인이 각자 자기 `case` 한 줄만 이 파일에 넣는다. 4,400줄짜리
 *     `world.ts` 를 일곱 워크트리가 동시에 만지는 것보다 충돌 면적이 훨씬 작다.
 *
 * > ⚠️ 지시서 `s0-shared-foundation.md` §7 은 이 `switch` 들이 `world.ts` 에 있다고 적었다.
 * > 위 ①②가 그 배치를 막았다 — **레인이 만지는 파일이 `world.ts` 가 아니라 이 파일**이다.
 *
 * ## ⚠️ 앵커는 **2단 디스패치**다 — 스킬과 촉매가 같은 지점을 공유한다
 * 공개 앵커(이 파일의 `export function on*`)는 sim 이 부르는 **진입점**일 뿐이고, 본체는
 * 두 갈래로 갈린다:
 *
 * ```
 * onVolleyFired(…)  →  dispatchVolleySkill(…)      ← 이 파일. 스킬 7레인이 만진다.
 *                   →  onVolleyFiredCatalyst(…)    ← catalystHooks.ts. 촉매 레인이 만진다.
 * ```
 *
 * **왜 쪼갰는가.** 스킬 디스패치는 `if (!state.skillsOn) return;` + `switch (state.sigBit)` 로
 * 시작하는데 촉매는 ①스킬 투자와 무관하고 ②기체와 무관하다. 한 본체에 두면 **무투자 런에
 * 촉매만 켠 경우 첫 줄에서 즉시 반환**해 촉매가 한 장도 못 탄다. 파일을 가른 것은 그 위에
 * 더해, 7 스킬 레인과 촉매 레인이 **같은 9개 함수를 동시에 만지는 것**을 막기 위해서다.
 *
 * 호출 순서는 **스킬 먼저, 촉매 나중**이다. 예외가 하나 있다 — 감쇠 사슬의 촉매 배율은
 * `preMitigationDmg` 캡처보다 앞이어야 해서 `world.ts` 가 직접 부른다(`onDamageChainCatalyst`
 * 주석 참조). 이 파일의 {@link onDamageChain} 은 촉매를 부르지 않는다.
 *
 * ## 전 스킬 디스패치 공통 계약
 *  - 첫 줄은 **항상** `if (!state.skillsOn) return;` 이다. 미투자 런은 여기서 즉시 빠져나가므로
 *    바이트 단위로 종전과 같다.
 *  - 다음은 `switch (state.sigBit)` 다. 슬롯 번호가 기체별로 겹치므로(`skillSlots.ts` 값 규약 4)
 *    **기체 게이트 없는 쓰기는 금지**다.
 *  - 슬롯 접근은 `readSlot`/`writeSlot` 만 쓴다(배열 직접 대입 금지 — 정수·비음 강제가 거기 있다).
 *  - **RNG 를 소비하지 마라.** 앵커는 기존 스트림 위에 얹히는 자리라, 한 칸이라도 소비하면
 *    같은 시드의 웨이브·드랍·엘리트 시퀀스가 통째로 밀린다.
 */

import type { WorldState, InputFrame } from './world.js';
import type { Entity } from './entities.js';
// 앵커 ④ 의 피해원 비트합. 정본이 `skillSlots.ts`(import 0 인 leaf)인 사유는 그 파일 주석 —
// 스킬 모듈이 이 값을 **런타임에** 읽어야 하는데 여기 두면 순환이 생긴다.
import type { DamageSourceMask } from './skillSlots.js';
// 앵커 ㉗ 이 넘기는 액티브 정의. **타입 전용이다** — 값으로 당기면 이 leaf 가 레지스트리
// (`data/ships/actives/index.ts`)를 런타임 의존하게 되어 leaf 규율이 깨진다.
import type { ActiveSkillDef } from '../../data/ships/actives/types.js';
import {
  onVolleyFiredCatalyst,
  onDashFiredCatalyst,
  onGemCollectedCatalyst,
  onPlayerDamagedCatalyst,
  onKillsDeltaCatalyst,
  onBulletExpiredCatalyst,
  onWallContactCatalyst,
  onTickCatalyst,
  onEnemyDamagedCatalyst,
  onEnemyDeathCatalyst,
  onLevelUpCatalyst,
  onPowerupOfferCatalyst,
  onPowerupPickedCatalyst,
} from './catalystHooks.js';
import {
  SIG_STRIKER_MARKSMAN,
  SIG_ARC_OVERCHARGE,
  SIG_BRUISER_ARMOR,
  SIG_HATCHLING_BROOD,
  SIG_MALLOW_CUSHION,
  SIG_PHANTOM_CLOAK,
  SIG_BUBBLE_FILM,
  FILM_EFFICIENCY_BASE_BP,
} from './shipSignature.js';
import {
  hatchlingVolleyFired,
  hatchlingDashFired,
  hatchlingDamageChain,
  hatchlingSignatureStep,
  hatchlingEnemyDamaged,
  hatchlingBroodLaunchParams,
  hatchlingBroodLaunched,
  hatchlingTurretShotParams,
  hatchlingTurretCadence,
  hatchlingTurretExpired,
  hatchlingPlayerDamaged,
  hatchlingGemMagnetParams,
} from './skills/hatchling.js';
import {
  strikerDashFired,
  strikerGemCollected,
  strikerPlayerDamaged,
  strikerKillsDelta,
  strikerBulletExpired,
  strikerDamageChain,
  strikerSignatureStep,
  strikerVolleyParams,
  strikerEnemyDamaged,
  strikerEnemyDeath,
  strikerPlayerMoveParams,
  strikerBulletHitParams,
  strikerGemPull,
  strikerObjectiveResolved,
} from './skills/striker.js';
import {
  arccasterGemCollected,
  arccasterPlayerDamaged,
  arccasterDamageChain,
  arccasterSignatureStep,
  arccasterEnemyDamaged,
  arccasterEnemyDeath,
  arccasterVolleyParams,
  arccasterBulletExpiredLife,
  arccasterBulletHitParams,
  arccasterEliteLootRarity,
  arccasterOverchargeAccrual,
  arccasterComboDecay,
  arccasterActiveFired,
  arccasterGemMagnetParams,
} from './skills/arccaster.js';
import {
  bruiserDashFired,
  bruiserGemCollected,
  bruiserPlayerDamaged,
  bruiserDamageChain,
  bruiserSignatureStep,
  bruiserEnemyDamaged,
  bruiserEnemyDeath,
  bruiserVolleyParams,
  bruiserActiveFired,
  bruiserActiveExpired,
  bruiserGemMagnetParams,
  bruiserPlayerMoveParams,
  bruiserWallHit,
  bruiserWallShockResolve,
  bruiserWallDestroyed,
} from './skills/bruiser.js';
import {
  mallowGemCollected,
  mallowPlayerDamaged,
  mallowDamageChain,
  mallowEnemyDamaged,
  mallowPowerupPicked,
  mallowCushionSettleDue,
  mallowCushionSettled,
  mallowVolleyParams,
  mallowSettleThreshold,
  mallowGemMagnetParams,
  mallowPlayerMoveParams,
  mallowCushionSplit,
  mallowCushionRecoverBp,
  mallowObjectiveResolved,
} from './skills/mallow.js';
// ⚠️ SQ9 의 **탕감** 두 경로만 별도 leaf 다 — 만료 앵커가 `status.ts` 안이라
//    `skills/mallow.ts`(그 파일을 값으로 import 한다)에 두면 런타임 순환이 된다.
//    사유 전문은 `chainHooks.ts`·`skills/mallowStatus.ts` 헤더.
import { mallowEnemyDeath } from './skills/mallowStatus.js';
import {
  phantomActiveFired,
  phantomDashFired,
  phantomGemCollected,
  phantomWallContact,
  phantomDamageChain,
  phantomPlayerDamaged,
  phantomSignatureStep,
  phantomEnemyDamaged,
  phantomCloakBreakReset,
  phantomVolleyParams,
  phantomPlayerMoveParams,
  phantomWallHit,
  phantomObjectiveResolved,
  phantomEnemyDeath,
  phantomPlayerWallSlide,
} from './skills/phantom.js';
import {
  bubbleSignatureStep,
  bubbleEnemyDamaged,
  bubbleFilmBurst,
  bubbleFilmBurstPost,
  bubbleObjectiveResolved,
  bubblePickupRadius,
  bubbleVolleyParams,
  bubbleFilmAbsorbed,
  bubbleFilmEntry,
  bubbleFilmEfficiency,
  bubbleActiveFired,
  bubbleGemCollected,
  bubbleGemMagnetParams,
  bubblePlayerMoveParams,
} from './skills/bubble.js';

// ---------------------------------------------------------------------------
// 공유 술어
// ---------------------------------------------------------------------------

/**
 * **치명타 생존 술어의 단일 정본**(C-2 처방).
 *
 * 정의: **경감 전 피해가 그 시점의 hp 이상이었는데, 감쇠 사슬(스킬 슬롯·장갑·막·완충)을 거친
 * 뒤 hp > 0 으로 살아남은 틱.**
 *
 * ## 왜 함수 하나여야 하는가
 * 브루저 FO5 와 아크캐스터 BR10 이 **같은 술어**를 쓴다. 각자 적으면 한쪽이 "경감 전"을
 * "경감 후"로 적는 식으로 조용히 갈리고, 두 기체는 한 런에 공존하지 않으므로 그 차이를
 * 드러내는 테스트가 원리적으로 존재하지 않는다.
 *
 * ## 호출 규약 — **사슬 안 한 곳에서만 계산한다**
 * `resolveCollisions` 가 이 값을 한 번 계산해 {@link onPlayerDamaged} 에 인자로 넘긴다.
 * 기체 모듈이 이 함수를 다시 부르지 마라 — 그러려면 "경감 전 피해"를 스스로 복원해야 하는데
 * 그 값은 사슬 중간의 지역 변수라 복원이 불가능하다.
 *
 * ## ⚠️ 「런당 1회」 억제는 **여기 없다** — 배선 레인이 얹어야 한다
 * 폐기된 캡스톤이 제공하던 억제다. 안 옮기면 죽을 뻔할 때마다 발동해 두 스킬이 설계 의도보다
 * 훨씬 강해진다. 억제 표식의 자리는 **플레이어 `targetX`** 다(캡스톤이 쓰던 바로 그 칸 —
 * sim 쓰기 0건이고, 이미 `commissionCarry` 의 `ENTITY_CARRY` 에 있어 의뢰 다구간에서도
 * "런당 1회"가 정확히 성립한다). 스킬 슬롯을 새로 잡지 마라.
 *
 * @param preMitigationDamage 감쇠 사슬에 **들어가기 전** 피해(무대 배율·피격 배수까지 반영된 값)
 * @param hpBefore 사슬 적용 전 플레이어 hp
 * @param hpAfter 사슬·차감 후 플레이어 hp
 */
export function survivedLethalBlow(
  preMitigationDamage: number,
  hpBefore: number,
  hpAfter: number,
): boolean {
  return preMitigationDamage >= hpBefore && hpAfter > 0;
}

// ---------------------------------------------------------------------------
// 앵커 ①~⑨ (S0: 전 분기 비어 있음) — **플레이어 축**
// ---------------------------------------------------------------------------

/**
 * 앵커 ① — **주무기 볼리 발사가 확정된 지점**. 이 지점에 도달했다는 것은 쿨다운이 준비됐고
 * 사거리 안에 표적이 있어 이번 틱에 반드시 발사한다는 뜻이다(무기 아키타입 분기보다 앞).
 * 조기 반환(쿨다운 미준비·표적 없음)에 걸린 틱에는 불리지 않는다 — 스트라이커 정조준
 * 카운터가 같은 자리에 있는 이유와 같다.
 */
export function onVolleyFired(state: WorldState, player: Entity): void {
  dispatchVolleySkill(state, player);
  onVolleyFiredCatalyst(state, player);
}

function dispatchVolleySkill(state: WorldState, player: Entity): void {
  if (!state.skillsOn) return;
  void player;
  switch (state.sigBit) {
    // 레인은 자기 `case SIG_*:` 한 줄을 여기에 넣는다.
    //
    // ⚠️ **스트라이커는 여기 case 가 없다 — 누락이 아니라 미배선이다.** 이 앵커를 쓰는 설계
    // 항목은 S8「콤보 차폐」의 콤보 창 부분 회복(`comboTimer = min(comboTimer + 창/2, 창)`)
    // 하나다(S8 의 흡수 절반은 앵커 ⑧ 에 이미 배선돼 있다).
    //
    // **막고 있던 것은 S1 이 치웠다** — `COMBO_WINDOW_TICKS` 가 `world.ts` 의 비공개 상수라
    // leaf 에서 읽을 길이 없었는데, 이제 `./constants.js` 에 있어 기체 모듈이 그대로 import 한다.
    //
    // ⚠️ **그런데 배선은 여기가 아니라 앵커 ⑯ 에 들어갔다.** 이 앵커는 `autoAttack` 의
    // 스트라이커 카운터 갱신(`player.aux0 = marksmanFire ? 0 : aux0 + 1`) **뒤**라, 도달 시점의
    // `aux0` 은 이미 *다음* 볼리를 가리킨다 — "이번 볼리가 정조준이었는가" 를 직접 못 읽는다.
    // ⑯ 은 그 판정을 `params.mark === 1` 로 싣고 있고 그 필드가 정조준 표식의 정본이므로,
    // 같은 술어를 여기에 다시 세우면 두 곳이 조용히 갈린다. **누락이 아니라 이동이다.**
    //
    // ⚠️ **아크캐스터도 여기 case 가 없다 — 누락이 아니라 미배선이다.** 이 앵커를 쓰려는 설계
    // 항목은 넷인데(CH1·CH3·CH8 의 발사 시점 탄 표식 · BA10 의 탄수/간격 배율 · BA7 의 보너스
    // 탄수 · BA1 의 착지 볼리) 전부 **이 지점 뒤에서 정해지는 값**을 요구한다. 이 앵커는 "무기
    // 아키타입 분기보다 앞"이라 탄이 아직 없고 `bulletCount`/`fireCooldownQ` 도 아직 안 읽혔다.
    // 표식·배율은 `world.ts` 의 발사부가 소유해야 한다.
    // ⚠️ **브루저도 여기 case 가 없다 — 누락이 아니라 미배선이다.** 이 앵커를 쓰는 설계 항목은
    // BL2(근접 볼리 증폭+관통)·BL3(만재 중탄)·BL6(중량 탄자)·BL8(담금질 탄) 넷인데, 전부
    // **이번 볼리의 탄 파라미터**(피해·관통·탄속·수명)를 바꿔야 한다. 이 앵커는 무기 아키타입
    // 분기보다 **앞**이라 탄이 아직 없고, 인자도 `(state, player)` 뿐이다 — 여기서는 원리적으로
    // 닿지 않는다. 그 절반은 `world.ts` 의 볼리 생성부가 소유해야 한다.
    case SIG_HATCHLING_BROOD:
      // BD5 격발 공명 — 모선의 볼리가 병아리 전원의 발사 쿨다운을 깎는다. 탄을 보지 않고
      // "볼리가 나갔다"만 보므로 이 앵커의 "탄이 아직 없다" 한계에 걸리지 않는 유일한 예다.
      hatchlingVolleyFired(state, player);
      break;
    // ⚠️ **말로우도 여기 case 가 없다 — 브루저와 같은 벽이다.** 이 앵커를 쓰는 설계 항목은
    // SQ1(부채 비례 볼리 증폭)·SQ5(탕감 장전분 소진)·SQ7(입력 방향 일치도 비례 탄속·피해)·
    // SQ8(누적 선체행 비례 증폭) 넷인데, 넷 다 **이번 볼리의 탄 피해·탄속**을 바꿔야 한다.
    // SQ7 은 그 위에 `input` 까지 필요한데 이 앵커는 인자로 받지 않는다.
    // ⚠️ **팬텀도 여기 case 가 없다 — 같은 벽이다.** 이 앵커를 쓰려는 설계 항목은 AS2(은신 창
    // 중 발사탄 관통 +1 · 탄속)·AS3(강화탄 마커)·AS10(창 중 발사탄 벽 통과 마커) 셋인데, 전부
    // **이번 볼리의 탄**에 표식이나 파라미터를 얹어야 한다. 이 앵커에는 탄이 아직 없다.
    // ⚠️ **버블도 여기 case 가 없다 — 같은 한계다.** 이 앵커를 쓰려는 설계 항목은 둘
    // (PO2 압력 전환 사출 · PO5 만재 투과)인데 둘 다 **이번 볼리 탄의 피해·관통**을 바꿔야
    // 한다. 술어(`aux0 > 0` · `aux0 >= FILM_ABSORB_FLAT`)는 여기서 완전히 성립하지만 적용할
    // 대상이 아직 존재하지 않는다 — 술어만 세워 슬롯에 담고 발사부가 읽게 하는 대안은
    // 기각했다(아크캐스터 BA7 과 같은 사유: 소비처 없는 값이 해시에만 접힌다).
    default:
      break;
  }
}

/** 앵커 ② — **대시가 실제로 발동한 지점**(`input.dash && dashCooldown === 0` 안쪽). */
export function onDashFired(
  state: WorldState,
  player: Entity,
  dirX?: number,
  dirY?: number,
): void {
  dispatchDashSkill(state, player, dirX, dirY);
  onDashFiredCatalyst(state, player);
}

function dispatchDashSkill(
  state: WorldState,
  player: Entity,
  dirX?: number,
  dirY?: number,
): void {
  if (!state.skillsOn) return;
  // 배치6 — **대시 방향**(`resolveDirFallback` 을 이미 통과한 단위 벡터). 후행 선택 인자로
  // 둔 것은 기존 호출부·픽스처를 안 깨기 위해서다(`srcX`/`srcY` 선례). ⚠️ 그래서 **단위
  // 테스트가 안 넘기면 `undefined`** 다 — 이 값을 쓰는 스킬의 테스트는 반드시 넘겨라.
  // 소비처가 생기지 않은 `case` 는 이 인자를 안 본다.
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN:
      // M5 벽차기(무적프레임) · **M6 활공 정화**(적탄 소거 + 반경 안 잡몹 냉기) ·
      // **M2 추진 항적**(대시 방향 정지 탄 열 — 배치6 이 실은 `dirX`/`dirY` 의 첫 소비처) ·
      // **M7 신호 추적**(에코·조우 활성 중 쿨다운 반감).
      strikerDashFired(state, player, dirX, dirY);
      break;
    // ⚠️ **아크캐스터는 여기 case 가 없다 — 설계에 대시 결속 스킬이 한 종도 없기 때문이다.**
    // 이 기체의 이동 결속은 전부 blink 액티브(BA1·BA4·BA6)이고 그것은 액티브 핸들러의 자리다.
    case SIG_BRUISER_ARMOR:
      // MO1 충각 적재(스택 +1 · 감쇠 타이머 리셋) · MO8 벽 되튐(쿨다운 환급).
      // 둘 다 이 앵커가 `dashCooldown` 대입 **뒤**라는 데 의존한다 — 그 근거는 효과 함수 주석.
      bruiserDashFired(state, player);
      break;
    case SIG_HATCHLING_BROOD:
      // NU5 알 굴리기 — 부화 스냅샷 1 전진(액티브 `advanceHatch` 와 같은 문법).
      // ⚠️ 같은 스킬의 나머지 절반(대시 경로 젬 수거)은 `collectGem` 이 `world.ts` 비공개라
      //    미배선이고, 그래서 **레벨 스케일이 통째로 없다** — 효과 함수 주석이 근거.
      hatchlingDashFired(state, player);
      break;
    case SIG_PHANTOM_CLOAK:
      // PH1 잔상 이탈 — 대시가 무피격 스트릭을 전진시킨다(`advanceCloak` 경유).
      //
      // PH6 정지된 시계 — **여기서는 예약만** 한다(S3). 이 앵커는 `stepShipSignature` 의 팬텀
      // 적립(`aux0++`)보다 **뒤**라(world.ts 2250 vs 1874) 이번 틱의 증가는 이미 끝나 있다.
      // 그래서 슬롯에 플래그만 세우고 **다음 틱의 앵커 ⑨** 가 적립 직전에 1틱을 되돌린다.
      //
      // ⚠️ 이 자리의 옛 주석은 *"사후에 1 을 빼는 흉내는 창당 정지 예산·되감기 경계와 갈려
      // 조용히 어긋난다"* 였다. 그 경고가 참인 것은 **예산과 되감기를 코드에 안 남길 때**다 —
      // S3 은 예산 소비를 집행 지점에서 세고(`PhantomStage.frozenClockUsed`) 되감기는 진입
      // 에지(`phantomCloakEntry`)에서 0 으로 되돌려 두 경계를 모두 남겼다. 한 틱 밀리지만
      // 창당 정지 **총량**은 예산과 정확히 같다(DI6 의 "직전 틱 vs 이번 틱" 과 같은 등가 교환).
      phantomDashFired(state, player);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ③ — **젬 수거**(`collectGem`). 콤보·XP 가 이미 반영된 뒤에 불린다.
 * ⚠️ 침공에서도 불린다 — 침공 편대원·스포너 드론이 `summonEnemy` 경유라 `kind` 가 `enemy` 이고
 * `compact` 가 젬을 뿌린다(지시서 §8 X-1 이 이 전제를 뒤집었다). "침공엔 젬이 없다"로 짜지 마라.
 */
export function onGemCollected(state: WorldState, gem: Entity): void {
  dispatchGemSkill(state, gem);
  onGemCollectedCatalyst(state, gem);
}

function dispatchGemSkill(state: WorldState, gem: Entity): void {
  if (!state.skillsOn) return;
  void gem;
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN: {
      // M3 는 **플레이어**의 대시 쿨다운을 만지는데 이 앵커가 넘기는 것은 젬이다. leaf 규율상
      // `world.ts` 를 런타임 import 할 수 없으므로 아래 사본으로 집는다.
      const p = playerOf(state);
      if (p !== undefined) strikerGemCollected(state, p);
      break;
    }
    case SIG_ARC_OVERCHARGE: {
      // BA3 정지 관측 사격 — 정지 중 수거한 젬만 발사 쿨다운을 환급한다. 대상은 젬이 아니라
      // **플레이어**라 위 사본으로 집는다(스트라이커 M3 와 같은 사유).
      const p = playerOf(state);
      if (p !== undefined) arccasterGemCollected(state, p);
      break;
    }
    case SIG_BRUISER_ARMOR: {
      // MO9 수확 고정 — 젬 수거마다 감쇠 타이머(`aux1`)를 되감는다. 대상이 젬이 아니라
      // **플레이어**라 위와 같은 사본으로 집는다.
      //
      // ⚠️ MO2(파쇄 수확)는 여기 없다 — 그 스킬은 **젬 스폰 시점**에 견인 상태를 초기화해야
      // 하는데(`stepGems` 흡인 로직), 이 앵커는 이미 **수거가 끝난 뒤**라 견인할 젬이 없다.
      const p = playerOf(state);
      if (p !== undefined) bruiserGemCollected(state, p);
      break;
    }
    case SIG_MALLOW_CUSHION: {
      // ME1 조기 상환 — 젬 수거마다 무피격 카운터(`aux1`)를 상한 안에서 밀어 정산을 앞당긴다.
      // 대상이 젬이 아니라 **플레이어**라 위 사본으로 집는다(스트라이커 M3 와 같은 사유).
      //
      // ⚠️ ME2(채무 자석)는 여기 없다 — 그 스킬은 **자석 반경 판정**(`stepGems` 의 흡인 거리
      // 비교)에 배율을 얹어야 하는데, 이 앵커는 이미 **수거가 끝난 뒤**라 반경이 무의미하다
      // (브루저 MO2 가 같은 자리에서 같은 이유로 빠졌다).
      const p = playerOf(state);
      if (p !== undefined) mallowGemCollected(state, p);
      break;
    }
    case SIG_PHANTOM_CLOAK: {
      // PH8 흔적 흡수 — 젬 수거마다 무피격 스트릭 전진(`advanceCloak` 경유). 대상이 젬이 아니라
      // **플레이어**라 위와 같은 사본으로 집는다.
      //
      // PH3 그림자 장부 — **레벨 스케일 절반**(창 중 수거 시 콤보 창 회복량 가산)이 여기 있다.
      //
      // 옛 주석은 "본체(창 중 `comboTimer` 감소 정지)의 감소 지점이 `world.ts` 라 앵커가 없고,
      // 스케일만 얹으면 본체 없는 곁가지" 라며 통째로 뺐다. **본체가 앵커 ⑨ 에 섰다**(S3):
      // 감소는 `updateCombo` 한 곳의 정확히 `-1` 이고 앵커 ⑨ 는 그보다 앞(world.ts 1874 vs
      // 1936, 같은 틱)이라, 창 중에 `+1` 하면 감소부에서 스킵한 것과 값이 비트 단위로 같다.
      // 그래서 이 절반은 더 이상 곁가지가 아니다.
      const p = playerOf(state);
      if (p !== undefined) phantomGemCollected(state, p);
      break;
    }
    case SIG_BUBBLE_FILM: {
      // DR2「표면장력 세례」(적립 절반) — 막이 서 있는 동안의 수거가 효율 창을 연다.
      // 소비는 앵커 ⑰(`onFilmEfficiency`), 감소는 앵커 ⑨ 다.
      //
      // ⚠️ **종전 주석의 판정("소비처가 없다")은 틀렸다 — 정정해 둔다.** 그 문장은 소비처를
      // `world.ts` 의 막 흡수 산술로 지목했는데, 그 산술은 **효율 bp 를 인자로 받는다**
      // (`shipSignature.ts` 의 `absorbFilm`)이고 그 인자를 정하는 자리가 바로 앵커 ⑰ 이다.
      // FI8 이 같은 앵커에서 이미 돌고 있었다는 것이 반증이다.
      const p = playerOf(state);
      if (p !== undefined) bubbleGemCollected(state, p);
      break;
    }
    // ⚠️ DR1「역류 수거」는 여기가 아니다 — 그쪽은 **파열 틱에** 젬을 끌어오는 스킬이고,
    // 수거 자체는 `collectGem`(world.ts 소유)이라 leaf 에서 부를 수 없다.
    default:
      break;
  }
}

/**
 * 플레이어 엔티티 조회 — **`world.ts` 를 런타임 import 하지 않기 위한 leaf 사본**이다(헤더 ①).
 * 규약상 플레이어는 `entities[0]` 이고 `createWorld` 가 그 불변식을 세운다(`bench/**` 전역이
 * 같은 조회를 쓴다).
 *
 * ⚠️ **`undefined` 를 돌려줄 수 있다.** `compact()` 는 생존자만 재구축하므로 플레이어가 죽은
 * 틱 이후에는 배열이 빌 수 있고, 앵커 ⑤(처치 증분)는 바로 그 `compact()` 뒤에 불린다.
 * 호출부가 반드시 확인한다 — `!` 로 지우면 조용한 예외가 sim 한복판에서 터진다.
 */
function playerOf(state: WorldState): Entity | undefined {
  return state.entities[0];
}

/**
 * 앵커 ④ — **실제로 선체 hp 가 깎인 피격의 후속**. 막이 전량 흡수한 피격은 여기 도달하지
 * 않는다(그 경로는 사슬 중간에서 반환한다).
 *
 * @param dmg 실제로 hp 에서 차감된 피해(사슬 전량 통과 후)
 * @param lethalSurvived {@link survivedLethalBlow} 의 결과 — **여기서 다시 계산하지 마라**
 * @param sources {@link DamageSource} 비트합. **기본값 없는 필수 인자다** — 기본값을 두면 새
 *   호출부가 사유를 빠뜨린 채 기존 사유로 흘러들어 조용히 오분류된다(앵커 ⑥
 *   {@link BulletExpiryReason} 와 같은 규율).
 * @param srcX 피격원 좌표 x — **선택 인자다**(아래 사유). 생략 = "이번 피격의 피격원 좌표를
 *   모른다".
 * @param srcY 피격원 좌표 y — {@link srcX} 와 한 벌.
 *
 * ## ⚠️ 왜 좌표만 **선택** 인자인가 — `sources` 와 규율이 다르다
 * `sources` 는 필수다: 사유를 빠뜨린 호출부가 조용히 오분류되기 때문이다. 좌표는 반대로
 * **원리적으로 없을 수 있는 값**이다 — 수집 루프의 `max` 승자가 없는 경로(향후 코드 경로 ·
 * 단위 테스트가 앵커를 직접 부르는 경로)에서 0,0 을 넘기면 그것이 *"월드 원점에서 맞았다"* 로
 * 읽혀 방향 벡터가 조용히 뒤집힌다. 그래서 `undefined` 를 **모른다는 뜻으로만** 쓰고,
 * 소비처(해츨링 SH2)는 두 값이 다 있을 때만 발동한다.
 * ⚠️ 이 앵커는 **7기체가 공유한다.** 필수 인자로 더하면 기존 호출부·타 레인 픽스처가 전부
 * 깨진다(배치 1 에서 실제로 났고 `tsc` 만이 잡았다) — 선택 인자라 파급은 **호출부 1곳**
 * (`world.ts` 의 유일한 실호출)뿐이고 촉매 짝(`onPlayerDamagedCatalyst`)은 인자가 안 늘었다.
 */
export function onPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
  srcX?: number,
  srcY?: number,
  contact?: Entity,
): void {
  dispatchPlayerDamagedSkill(state, player, dmg, lethalSurvived, sources, srcX, srcY, contact);
  onPlayerDamagedCatalyst(state, player, dmg, lethalSurvived, sources);
}

function dispatchPlayerDamagedSkill(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
  srcX?: number,
  srcY?: number,
  contact?: Entity,
): void {
  if (!state.skillsOn) return;
  // 배치6 — **몸통 접촉 상대 적**(브루저 FO3「반동 갑주」). `sources` 비트는 *접촉이 있었다*
  // 까지만 말하고 `srcX`/`srcY` 는 좌표뿐이라, "그 접촉 적에게" 를 좌표로 되찾으면 접촉 판정의
  // 두 번째 사본이 된다. 후행 선택 인자인 것은 `srcX`/`srcY` 와 같은 사유다.
  // ⚠️ 접촉이 아닌 피격(적탄·해저드)에서는 `undefined` 다 — 훅이 반드시 확인해라.
  // ⚠️ **이 적은 `dmg` 의 `max` 를 이긴 그 한 항목**이다(`srcX`/`srcY` 와 같은 규율). 같은 틱에
  //    여러 적이 닿았어도 하나만 온다.
  // ✅ 첫 소비처는 `case SIG_BRUISER_ARMOR`(FO3)다 — 그래서 `void contact;` 를 지웠다.
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN:
      // S1 응전 조준 · S2 반사 도금. 둘 다 피해량과 무관하고 "hp 가 실제로 깎였다" 만 본다 —
      // 그것이 이 앵커의 정의라 `dmg` 를 넘기지 않는다.
      strikerPlayerDamaged(state, player);
      break;
    case SIG_ARC_OVERCHARGE:
      // BR2 피뢰 접지 · BR7 완충 콘덴서 · BR6 전하 역류 · BR10 최후 접지. 뒤 셋은 피해량과
      // 치명 생존 술어를 **둘 다** 보므로 인자를 그대로 넘긴다(스트라이커와 다른 점).
      arccasterPlayerDamaged(state, player, dmg, lethalSurvived);
      break;
    case SIG_BRUISER_ARMOR:
      // BL4 과적 배출 · FO2 응혈 적립 · FO5 불괴 연쇄 · **BL8 격돌 담금질(적립처)** ·
      // **FO9② 사투 본능(적립 2스택)**.
      // BL8 만 `sources` 를 본다 — 나머지 셋은 피해원과 무관하다(종전 인자만 쓴다).
      // 브루저는 스트라이커와 달리 **둘 다 필요하다** — FO2 는 적립량이 `dmg` 에 비례하고,
      // FO5 는 `lethalSurvived` 가 트리거 자체다(사슬 안에서 계산된 값을 그대로 넘긴다).
      //
      // ⚠️ BL1(응전 사출)은 여기 없다 — **설계서의 내부 쿨 술어가 이 지점에서 성립하지 않는다.**
      // 설계는 "내부 쿨 60틱은 `aux1` < 60 판정으로 대체 가능(신규 상태 0)" 이라고 적었으나,
      // 장갑 적립이 이 앵커보다 **앞**이라(world.ts 4317-4320) 여기 도달한 시점의 `aux1` 은
      // **항상 0** 이다. 그 술어를 그대로 쓰면 쿨이 영영 안 풀리거나(< 60 이면 스킵) 매 피격
      // 발동(≥ 60 이면 스킵)이 되어 어느 쪽이든 설계와 다르다. 슬롯 1칸이 필요하고, 그것은
      // 칼날 축 B 예산(BL8 `temperCharges` · BL9 `cadenceHits` 로 2/2 포화)을 넘기므로 설계로
      // 되돌아가야 한다. **배치6 이 이 문면을 다시 읽고 판단을 유지했다** — 배치6 이 더한
      // `contact` 는 "누구에게 반격하는가" 가 아니라 "누구를 반사하는가" 라 BL1 의 벽(내부 쿨)과
      // 무관하다. 같은 사유가 `skills/bruiser.ts` 헤더에도 있다.
      //
      // ⚠️ **FO3(반동 갑주)는 배치6 부터 여기 있다** — 후행 선택 인자 `contact` 가 그 자리다.
      bruiserPlayerDamaged(state, player, dmg, lethalSurvived, sources, contact);
      break;
    case SIG_MALLOW_CUSHION:
      // SQ3 몸통 반발(즉시분 비례 반격) · CU4 반발 세척(부채 보유 중 적탄 소거).
      // `dmg` 는 **지연분을 뗀 뒤의 즉시분**이고 그것이 SQ3 설계가 요구한 값이다.
      // `lethalSurvived` 는 넘기지 않는다 — 말로우의 치명 축(CU6 파산 보호)은 사슬 안 지연
      // 전환 자리를 요구해 이 앵커에 오지 않는다(아래 미배선 사유).
      //
      // ⚠️ 이 앵커는 완충 적립(`aux0 += deferred`) **뒤**다 — CU4 설계가 명시적으로 요구한
      // 순서라(첫 피격도 발동해야 한다) 여기서 적립을 흉내 내 보정하지 않는다.
      mallowPlayerDamaged(state, player, dmg);
      break;
    case SIG_PHANTOM_CLOAK:
      // DI4 반발 위상 · DI5 최후 위상. `lethalSurvived` 를 넘기지 않는 것은 의도다 — 팬텀
      // 30종 중 치명 생존 술어를 쓰는 스킬이 0종이다(DI5 의 트리거는 30% 임계 통과이지
      // "죽을 뻔했다"가 아니다). `dmg` 는 DI5 가 피격 **전** hp 를 복원하는 데 쓴다.
      //
      // ⚠️ DI1(위상 정산)·PH10(발각 즉응)은 여기 없다 — **이 앵커가 팬텀 피격 리셋보다
      // 뒤이기 때문이다.** `world.ts` 는 hp 차감 직후 `player.aux0 = 0` +
      // `setBreakToken(…, 0)` 을 실행하고 그 **뒤에** 이 앵커를 부른다. 둘 다 리셋 **전**의
      // `aux0`(DI1 은 반경 보정, PH10 은 창 술어)을 요구하므로 여기서는 각각 상시 최소 반경 ·
      // 상시 미발동이 된다. 설계서 공통 구현 고지 ④ 가 요구한 순서(DI1 → PH10 → 리셋 → DI5)
      // 중 **DI5 만** 이 자리에서 성립한다.
      // → 나머지 둘은 S2 가 리셋 **직전**에 뚫은 앵커 ㉑(`onCloakBreakReset`)에 산다.
      phantomPlayerDamaged(state, player, dmg);
      break;
    case SIG_HATCHLING_BROOD:
      // SH2 위기 산개 — 병아리 전원이 **피격원 쪽으로** 산개 돌진하며 경로 위 적탄을 소거한다.
      // 이 기체가 이 앵커에 좌표 두 칸을 연 유일한 사유이고, 좌표가 없으면(`undefined`)
      // 훅이 스스로 조기 반환한다 — 방향이 없는 산개는 설계가 정의하지 않았다.
      // ⚠️ SH1(호위 희생)·SH7(회생 부화)은 여기가 아니라 앵커 ⑧ 이다 — 그 둘은 hp 가 깎이기
      //    **전**에 피해를 흡수해야 하고 이 앵커는 차감 뒤다.
      hatchlingPlayerDamaged(state, player, srcX, srcY);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ⑤ — **이번 틱의 처치 증분**. `compact` 이 킬 집계의 단일 수렴점이라 여기 하나면 전
 * 사망 경로(탄 명중·화염 DoT·전격·폭탄 기물)를 빠짐없이 덮는다. `delta > 0` 일 때만 불린다.
 *
 * ⚠️ **`compact` 의 생존자 재구축이 끝난 뒤**다. 그래서 확보(전리품·젬 스폰)보다 뒤라
 * 스킬이 이번 틱 드랍을 보려면 한 틱 늦는다 — 이건 알려진 성질이지 결함이 아니다.
 */
export function onKillsDelta(state: WorldState, delta: number): void {
  dispatchKillsDeltaSkill(state, delta);
  onKillsDeltaCatalyst(state, delta);
}

function dispatchKillsDeltaSkill(state: WorldState, delta: number): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN: {
      // F1 전과 확장 — 사이클 카운터(`player.aux0`)를 충전한다. 플레이어가 이번 틱에 함께
      // 죽었다면 `compact()` 뒤라 배열에서 사라져 있다(위 `playerOf` 주석).
      const p = playerOf(state);
      if (p !== undefined) strikerKillsDelta(state, p, delta);
      break;
    }
    // ⚠️ **아크캐스터는 여기 case 가 없다 — 반쪽 배선을 피한 결과다.** BA7「연발 축전기」가
    // 이 앵커로 처치 6기를 셀 수는 있지만, 그 카운터가 **적용되는 자리**(다음 볼리의 탄수)는
    // 앵커 ① 뒤의 발사부라 지금 닿지 않는다. 카운터만 돌리면 슬롯 2칸이 영구히 아무것도 안 하는
    // 상태로 해시에 접힌다 — "구현했는데 안 불린다"의 전형이라 통째로 미배선으로 뒀다.
    // ⚠️ **브루저는 여기 case 가 없다 — 쓸 설계 항목이 없다.** 처치 "개수" 에 반응하는 브루저
    // 스킬은 0종이다. 유일한 처치 트리거 FO7 은 **엘리트인지**와 **격파 시점 스택**을 함께
    // 봐야 해서 개별 사건 앵커(⑪)로 갔다. MO2(파쇄 수확)는 처치가 아니라 젬 스폰 시점이다.
    // ⚠️ **팬텀도 여기 case 가 없다 — 반쪽 배선을 피한 결과다(아크캐스터 BA7 과 같은 판단).**
    // AS8「처형인의 적공」이 이 앵커로 처치 스택을 셀 수는 있지만, 그 스택이 **소모되는 자리**
    // (해제 첫 타 배율의 소진 지점 = `world.ts` autoAttack)는 앵커가 아니다. 카운터만 돌리면
    // 슬롯 1칸이 영구히 아무것도 안 하는 상태로 해시에 접힌다.
    default:
      break;
  }
}

/**
 * 앵커 ⑥ 이 서는 **두 소멸 사유**. 사유마다 발동해야 할 스킬이 다르므로 앵커가 인자로 받는다.
 *
 * - `'pierce'` — 명중해서 **관통 예산이 바닥났다**(자이로 무한 관통·프리즘 세그먼트는 이 분기 밖).
 * - `'life'` — 탄 **수명이 다했다**(`e.life` 가 0 에 닿은 틱). 화면 밖 컬링·벽 차단은 **여기 아니다**.
 *
 * ⚠️ **타입 전용 union 이다(런타임 export 0건).** `const enum` 으로 만들면 `skillHooks.ts` 에
 * 값 export 가 하나 늘어 `tests/skillAnchors.test.ts` 의 "앵커 이름 전수" 단언이 깨진다 —
 * 그 단언은 앵커 이름이 조용히 바뀌는 것을 잡는 계측기라 사유 상수 때문에 흔들면 안 된다.
 */
export type BulletExpiryReason = 'pierce' | 'life';

/**
 * 앵커 ⑥ — **아군탄이 소멸하는 지점**. 사유는 {@link BulletExpiryReason} 로 갈린다.
 *
 * ⚠️ **`reason` 은 기본값이 없다(필수 인자).** 기본값을 두면 새 호출부가 사유를 빠뜨린 채
 * 기존 사유로 흘러들어, 여기 붙은 스킬들이 **조용히 두 배로 발동**한다. 그 실패를 컴파일
 * 시점에 잡으려고 일부러 필수로 뒀다.
 *
 * ⚠️ **두 호출부 모두 `for (const e of state.entities)` 순회 안**이다 — 훅에서 엔티티를
 * 스폰하지 마라(호출부 주석의 근거). 스폰이 필요한 스킬은 `splitSpawns` 처럼 루프 뒤로 미뤄야 한다.
 */
export function onBulletExpired(
  state: WorldState,
  bullet: Entity,
  reason: BulletExpiryReason,
): void {
  dispatchBulletExpiredSkill(state, bullet, reason);
  onBulletExpiredCatalyst(state, bullet, reason);
}

function dispatchBulletExpiredSkill(
  state: WorldState,
  bullet: Entity,
  reason: BulletExpiryReason,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN:
      // ⚠️ **`reason` 게이트가 거동 불변의 전부다.** F4 는 S3-2 이전부터 **관통 예산 소진에서만**
      // 불리고 있었다. 수명 만료 호출부가 새로 생겼으므로, 게이트가 없으면 같은 런에서 F4 가
      // 두 배로 터진다 — 그것은 거동 변경이다.
      if (reason === 'pierce') strikerBulletExpired(state, bullet); // F4 파편 격발
      break;
    case SIG_ARC_OVERCHARGE:
      // ⚠️ **`reason` 게이트가 CH3 와 스트라이커 F4 의 분화점 그 자체다.** ~~case 가 없던
      // 사유~~ 였던 아래 근거는 지우지 않는다: CH3 는 **수명 만료**(reachLife) 소멸이
      // 트리거인데 F4 는 **관통 예산 소진**이고, 설계서가 그 둘을 분화점으로 못 박았다 —
      // 사유 없이 한 앵커에 얹으면 두 스킬이 같은 것이 된다. 그래서 뚫은 것은 `reason` 을
      // 가진 앵커다. 기체가 갈리므로 F4 와 이중 발화할 여지는 애초에 없지만, 게이트를 빼면
      // 아크캐스터의 관통 소진에서도 방전이 터져 설계서와 갈린다.
      if (reason === 'life') arccasterBulletExpiredLife(state, bullet); // CH3 종말점 방전
      break;
    // ⚠️ **브루저는 여기 case 가 없다 — 쓸 설계 항목이 없다.** 관통 예산 소진에 반응하는
    // 브루저 스킬은 0종이다. BL3(만재 중탄)의 "명중 지점 폭발" 은 **명중마다**여야 하는데 이
    // 앵커는 예산이 바닥난 마지막 명중에서만 불린다 — 그 자리는 앵커 ⑩ 이다.
    // ⚠️ **팬텀도 여기 case 가 없다 — 쓸 설계 항목이 0종이다.** 관통 예산 소진에 반응하는
    // 팬텀 스킬은 없다. AS10(유령 탄도)의 다중 벽 통과는 관통 예산과 **별개 축**이라고 설계서가
    // 못 박았고(유지율은 벽마다 곱연산), 그 판정 자리는 `world.ts` 의 벽 차단 분기다.
    default:
      break;
  }
}

/**
 * 앵커 ⑦ — **벽 접촉 틱**(`wallContactTicks` 갱신 직후, 접촉이 참인 틱에만).
 * 술어의 권위는 `slideCircleWalls` 다 — 여기서 기하를 다시 적지 마라(그 지점 주석의 근거).
 */
export function onWallContact(state: WorldState, player: Entity): void {
  dispatchWallContactSkill(state, player);
  onWallContactCatalyst(state, player);
}

function dispatchWallContactSkill(state: WorldState, player: Entity): void {
  if (!state.skillsOn) return;
  void player;
  switch (state.sigBit) {
    // ⚠️ **브루저도 여기 case 가 없다 — 같은 사유다.** MO8(벽 되튐)의 술어는 `wallContactTicks`
    // 를 앵커 ② 에서 읽는 것으로 충분하다(설계서가 요구한 "직전 틱" 이 정확히 그 값이다).
    //
    // ⚠️ **스트라이커는 여기 case 가 없다 — 세울 상태가 없기 때문이다.** 설계서는 M5·S4 를 위해
    // "직전 틱 벽 접촉 플래그" 를 슬롯에 세우라고 적었으나(구현 태그 B), S0 의 E5 가 같은 술어를
    // `state.wallContactTicks` 로 이미 세워 뒀다. 두 기체 모듈은 그 값을 읽기만 한다 — 같은
    // 술어를 슬롯에 복제하면 갱신 시점이 갈려 조용히 어긋난다.
    //
    // ⚠️ **아크캐스터도 같은 이유로 case 가 없다.** BR5「접지 케이블」의 벽 술어도
    // `state.wallContactTicks` 를 읽기만 하고, 그 읽기는 앵커 ⑧(감쇠 사슬) 안에 있다.
    //
    // ⚠️ **말로우도 여기 case 가 없다 — 술어는 있는데 적용 지점이 없다.** ME9「솜틀 요양」의
    // "직전 60틱 연속 벽 접촉" 은 `state.wallContactTicks >= 60` 으로 이미 읽을 수 있다(설계서
    // ⑥-4 가 스트라이커 M5 와 **한 벌**로 못 박은 그 카운터다 — 슬롯에 복제하지 마라). 막고
    // 있는 것은 **적용부**다: 이 스킬은 정산 임계 자체를 낮추는데, 그 비교
    // (`aux1 >= CUSHION_RECOVER_TICKS`)는 `world.ts` 의 정산 분기 안이라 앵커가 없다.
    // 그래서 ME9 는 통째로 미배선이고, CU7 의 분모도 함께 상수 180 에 묶여 있다.
    case SIG_PHANTOM_CLOAK:
      // DI6 차폐 잠행 — 벽 접촉 틱의 무피격 적립을 가속한다(`advanceCloak` 경유).
      // **팬텀만 이 앵커에 case 가 있다.** 앞 세 기체는 술어를 읽기만 했지만 이 스킬은 접촉
      // 사건 자체가 트리거라, 사건이 일어난 틱을 아는 자리가 여기밖에 없다.
      //
      // 설계서는 이 스킬에 신규 벽 접촉 플래그(구현 태그 B)를 세우라고 적었으나 S0 의 E5 가
      // 같은 술어를 `state.wallContactTicks` 로 이미 세워 뒀다 — 슬롯을 잡지 않는다.
      phantomWallContact(state, player);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ⑧ — **감쇠 사슬의 스킬 슬롯 2칸**. 반환값이 사슬의 다음 단계(브루저 장갑)로 들어간다.
 *
 * 자리: `PLAYER_DAMAGE_TAKEN_MULT` **직후**, 브루저 장갑 **앞**. 순서는 스트라이커 S4 문서가
 * 지정한 그대로다.
 *
 * ```
 * … → PLAYER_DAMAGE_TAKEN_MULT → [스킬 감소] → [스킬 흡수] → 브루저 장갑 → 버블 막 → 말로우 완충 → hp
 * ```
 *
 * ## 두 칸의 순서는 **감소 먼저, 흡수 나중**으로 고정이다
 * 흡수가 먼저면 감소가 이미 깎아 낼 피해까지 흡수 자원이 태워져, 같은 자원이 더 적은 피해를
 * 막는다. 두 칸이 한 런에 공존하지 않더라도 순서를 코드로 못 박아 훗날 합성될 때 논쟁이 없게 한다.
 *
 * ## ⚠️ `Math.round` 를 이 함수 밖(또는 기체 게이트 밖)에 두지 마라
 * 접촉 피해에는 엘리트 배율이 섞여 **소수**가 될 수 있다. 반올림이 게이트 밖으로 나가면
 * 스킬이 없는 런의 소수 피해까지 바뀌어 기존 해시가 통째로 갈린다 — 이 경고는 브루저·버블·
 * 말로우 세 곳에 이미 같은 문장으로 적혀 있고, 그 셋이 전부 게이트 **안**에서 정수화한다.
 *
 * ## ⚠️ 이 앵커만 촉매를 부르지 않는다
 * 촉매 피해원 배율은 **`preMitigationDmg` 캡처보다 앞**이어야 하는데 이 함수는 캡처 **뒤**에
 * 불린다. 그래서 `world.ts` 가 `onDamageChainCatalyst` 를 캡처 직전에 따로 부른다 —
 * 여기서 촉매를 부르면 `survivedLethalBlow` 의 "경감 전 피해"가 촉매를 못 보게 되어 브루저
 * FO5 · 아크캐스터 BR10 의 의미가 조용히 뒤집힌다.
 *
 * ## ⚠️ `sources` 는 **선택 인자**다 — 7기체 공유 앵커라 필수로 만들지 않았다
 * 아크캐스터 BA8「절연 포좌」의 절반(*"용암 피해가 경감된다"*)이 **출처를 못 봐서** 막혀
 * 있었다: 이 앵커의 인자는 `state`·`player`·`dmg` 뿐이라 "이 피해가 해저드에서 왔는가"를
 * 복원할 방법이 하나도 없다(같은 틱에 적탄·접촉이 섞이면 `dmg` 는 그중 `max` 하나다).
 * 수집 루프가 이미 세워 둔 `dmgSources` 비트합을 그대로 넘긴다 — 새 상태 0칸이다.
 *
 * **선택으로 둔 이유**: 필수로 바꾸면 이 앵커를 직접 부르는 테스트·픽스처가 전부 깨지고,
 * 파급이 7기체 전체로 번진다. 기본값 `0`(피해원 미상)은 `hasDamageSource(0, …) === false` 라
 * 출처 술어가 전부 거짓이 되어 **기존 다섯 기체의 산술이 한 점도 안 바뀐다.**
 * ⚠️ 기본값에 의존하는 새 스킬을 만들지 마라 — `0` 은 "출처 없음"이 아니라 "안 넘겨줬다"다.
 *
 * @param dmg 무대 배율·피격 배수·**촉매 피해원 배율**까지 반영된 사슬 진입 피해
 * @param sources 이번 피격에 **기여한 피해원 비트합**(`world.ts` 수집 루프의 `dmgSources`).
 *   `max` 가 고른 하나가 아니라 기여한 종류 전부다.
 * @returns 스킬 감소·흡수를 거친 피해. S0 는 인자를 그대로 돌려준다(비트 동일).
 */
export function onDamageChain(
  state: WorldState,
  player: Entity,
  dmg: number,
  sources: DamageSourceMask = 0,
): number {
  if (!state.skillsOn) return dmg;
  switch (state.sigBit) {
    // 각 `case` 는 **① 감소 → ② 흡수** 순서로 처리하고, 정수화는 자기 게이트 안에서 한다.
    case SIG_STRIKER_MARKSMAN:
      // ① S4 엄폐 교리(벽 접촉) → **S5 극지 적응**(해저드 출처) 감소 → ② S8 흡수.
      return strikerDamageChain(state, player, dmg, sources);
    case SIG_ARC_OVERCHARGE:
      // ① BR3·BR5·**BA8**(해저드 출처) 감소 → ② BR4 흡수. 순서는 이 앵커 주석 그대로다.
      return arccasterDamageChain(state, player, dmg, sources);
    case SIG_BRUISER_ARMOR:
      // ① 감소: FO6 하중 전이(경감 + 대시 쿨 전이) → **FO9③ 사투 본능(빈사 중 스택당 추가
      // 감소)**. 흡수 칸을 쓰는 브루저 스킬은 없다.
      // ⚠️ 설계서는 이 스킬의 자리를 "브루저 장갑 **뒤**" 로 지정했는데 이 앵커는 장갑 **앞**
      // 이다 — 사슬에 뚫린 유일한 스킬 자리라 여기 말고 둘 곳이 없다(효과 함수 주석에 근거).
      return bruiserDamageChain(state, player, dmg);
    case SIG_HATCHLING_BROOD:
      // 감소 칸은 비어 있다(해츨링에 감소류 스킬이 없다) → ② 흡수만: SH1 호위 희생 →
      // SH7 회생 부화. 둘의 순서는 설계 SH1 의 1R 확정("건별 잔돈 먼저, 전액 청산은 최후")이다.
      return hatchlingDamageChain(state, player, dmg);
    case SIG_MALLOW_CUSHION:
      // ① CU7 아문 살갗(감소). 흡수 칸을 쓰는 말로우 스킬은 없다.
      //
      // ⚠️ 설계서는 이 스킬의 자리를 "지연 전환 분기 직전" 으로 지정했는데 이 앵커는 브루저
      // 장갑·버블 막보다 **앞**이다 — 사슬에 뚫린 유일한 스킬 자리라 여기 말고 둘 곳이 없고,
      // 그 둘은 말로우 런에 존재하지 않아 관측 가능한 차이가 없다(효과 함수 주석에 근거).
      //
      // ⚠️ **이 사슬은 완충의 지연 정산분을 덮지 못한다.** 정산이 hp 를 깎는 경로
      // (`stepShipSignature` 의 말로우 가지)는 감쇠 사슬 밖이다. "받는 피해" 축 스킬을 이
      // 자리에만 걸면 자기 기체의 지연 정산분에는 안 걸린다 — CU7 은 설계 자체가 피격 경로
      // 한정이라 해당하지 않지만, 뒤 레인이 같은 자리에 다른 스킬을 얹을 때 반드시 볼 것.
      return mallowDamageChain(state, player, dmg);
    case SIG_PHANTOM_CLOAK:
      // ① DI3 초탄 감쇄(감소). 흡수 칸을 쓰는 팬텀 스킬은 없다.
      // 이 자리는 팬텀 피격 리셋(`aux0 = 0`)보다 **앞**이라 여기서 읽는 스트릭이 설계서가
      // 요구한 "이 피격 직전까지 쌓인 무피격 틱"이다 — 효과 함수 주석이 그 순서의 근거다.
      return phantomDamageChain(state, player, dmg);
    // ⚠️ **버블은 여기 case 가 없다 — 이 앵커가 막보다 앞이기 때문이다.** 버블의 감쇠 사슬
    // 스킬 6종(DR2 흡수 효율 · FI3 흡수 반응 소거 · FI4 흡수 비례 밀어내기 · FI6 흡수 누적 ·
    // FI8 해저드 2배 효율 · FI9 비상막)은 전부 **막이 실제로 흡수하는 그 산술**
    // (`world.ts:4249-4256`)을 요구한다. 이 앵커는 `world.ts:4224` 로 브루저 장갑(4234)보다도
    // 앞이라, 여기서 본 `dmg` 는 막을 아직 지나지 않았고 `player.aux0` 도 한 점 안 닳았다.
    // 여기서 흉내 내면 "막이 막은 양" 과 "스킬이 본 양" 이 조용히 갈린다 — 막 흡수 지점에
    // 별도 앵커가 필요하다(이 레인 밖).
    default:
      break;
  }
  return dmg;
}

/** 이번 명중 한 번의 가변 파라미터. 앵커 ⑱ 이 넘기고, 호출부가 그대로 반영한다. */
export interface BulletHitParams {
  /**
   * 이번 명중으로 표적 hp 에서 **차감될 피해**. 무기 피해에 과열 2배·자이로/프리즘 증폭·
   * 엘리트 피해감소가 **이미 곱해진 값**이다 — 다시 곱하지 마라.
   */
  damage: number;
  /**
   * 가해 탄의 **잔여 관통 예산**(`bullet.pierce`). 호출부가 이 값을 탄에 되쓴 뒤 관통 처리
   * (자이로 무한 · 프리즘 소비 · 그 외 1 소비)를 한다. 즉 여기서 +1 하면 이번 명중의 소비가
   * 상쇄된다 — **명중마다 더하면 탄이 관통으로 영영 안 죽는다.**
   */
  pierce: number;
}

/**
 * 앵커 ⑱ — **아군탄 명중의 피해가 확정되기 직전**(`resolveCollisions`).
 *
 * ## ⚠️ 앵커 ⑩ 과 무엇이 다른가 — ⑩ 은 **늦다**
 * ⑩ `onEnemyDamaged` 는 `t.hp -= dealt` 와 격추/부활 판정이 **끝난 뒤**다. 그 자리에서는
 * 이번 명중의 피해를 더 이상 못 바꾼다(이미 깎였다). *"이 명중이 얼마나 아픈가"* 를 고치는
 * 스킬(아크캐스터 CH5 전위차 저격)은 그래서 ⑩ 으로 배선할 수 없었다. 둘은 같은 명중에
 * ⑱ → ⑩ 순으로 연달아 불린다.
 *
 * ## 무엇이 보장되는가
 *  - `bullet.kind === 'bullet'`(아군탄)만 여기 온다 — 호출부 루프의 첫 줄 게이트가 근거다.
 *    적탄(`'enemyBullet'`)은 이 경로에 **닿지 않는다**.
 *  - `target` 은 아직 이번 피해를 안 받았다. `target.hp` 는 명중 **전** 값이다.
 *  - 관통 차감 **전**이다(`b.pierce--` 는 이 뒤).
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **호출부는 `for (const b of state.entities)` 순회 안이다 — 훅에서 스폰하지 마라.**
 *  - ⚠️ `target.hp` 를 직접 깎지 마라. 깎으면 아래 격추 판정과 이중 차감이 된다.
 *  - **RNG 를 소비하지 마라**(공통 계약).
 */
export function onBulletHitParams(
  state: WorldState,
  bullet: Entity,
  target: Entity,
  params: BulletHitParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_ARC_OVERCHARGE:
      // CH5 전위차 저격 — 발사 시점 수명(앵커 ⑯ 의 `recordSpawnOrigin`) 대비 비행 비율로
      // 「멀리 비행한 뒤 명중」을 판정해 피해 증폭 + 관통 가산.
      arccasterBulletHitParams(state, bullet, target, params);
      break;
    case SIG_STRIKER_MARKSMAN:
      // **F7 표적 고정**(같은 표적 연속 명중 스택 증폭) · **S7 최후 처형**(빈사 중 정조준탄이
      // 임계 이하 잡몹을 정상 격추 경로로 죽인다). 둘 다 앵커 ⑩ 이 아니라 **여기**가 자리다 —
      // ⑩ 은 `t.hp -= dealt` 뒤라 이번 일격의 피해를 못 바꾼다.
      strikerBulletHitParams(state, bullet, target, params);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ⑲ — **엘리트 전리품 등급 롤 직전**(`compact` 의 드랍 게이트 통과 후).
 *
 * 넘어오는 값은 촉매 희귀도 보상축(`state.catalystMods.rarity`)이고, 반환값이 그대로
 * `rollEliteDrop` 의 `rarityMult` 가 된다. 무촉매·미투자면 `1` 이 그대로 통과해 등급
 * threshold 가 종전과 같다(**바이트 불변**).
 *
 * ## ⚠️ 여기서 RNG 를 소비하지 마라 — 드랍 스트림이 통째로 밀린다
 * `rollEliteDrop` 의 소비는 `nextFloat` + `nextU32` **정확히 2회 고정**이고 `rarityMult` 와
 * 무관하다(그 함수 본문이 근거). 배율만 바뀌므로 시드별 드랍 **횟수**는 안 밀리고 **등급**만
 * 움직인다 — 이 앵커가 안전한 이유가 그것이다.
 *
 * ⚠️ **호출부는 `for (const e of state.entities)` 순회 안이다 — 훅에서 스폰하지 마라.**
 *
 * @param player 플레이어 엔티티(`state.entities[0]`). 술어용이며 쓰지 마라.
 * @param rarityMult 촉매 희귀도 배율(무촉매 = 1).
 */
export function onEliteLootRarity(
  state: WorldState,
  player: Entity,
  rarityMult: number,
): number {
  if (!state.skillsOn) return rarityMult;
  switch (state.sigBit) {
    case SIG_ARC_OVERCHARGE:
      // CH9 낙뢰 인양 — 과충전 중 처치한 엘리트의 등급 롤에 상향 배율.
      return arccasterEliteLootRarity(state, player, rarityMult);
    default:
      break;
  }
  return rarityMult;
}

/** 앵커 ⑳ 의 결과. 호출부가 이 두 값만 보고 `aux0` 을 갱신한다. */
export interface OverchargeAccrual {
  /**
   * 이번 틱을 **정지로 볼 것인가.** 거짓이면 호출부가 `aux0 = 0`(즉시 리셋)이다. 참이면
   * 아래 {@link delta} 를 더하고 `[0, OVERCHARGE_TICK_CAP]` 로 클램프한다.
   *
   * ⚠️ 기본값은 **입력 기반 정지 술어 그대로**다(`moveX === 0 && moveY === 0 && !dash`).
   * 이동 중인데 참으로 뒤집는 스킬(BA9)은 반드시 `delta` 를 0 이하로 함께 줘야 한다 —
   * 안 그러면 "이동하면서 적립"이 되어 시그니처가 뒤집힌다.
   */
  still: boolean;
  /** `still` 일 때 `aux0` 에 더할 양. 기본 1(정지) / 0(이동). 음수면 감쇠다. */
  delta: number;
}

/**
 * 앵커 ⑳ — **과충전 적립 분기**(`stepShipSignature` 의 아크캐스터 가지).
 *
 * ## ⚠️ 앵커 ⑨ 로는 왜 안 되는가
 * ⑨ `onSignatureStep` 은 `stepShipSignature` **진입점**이라 기체 분기보다 **앞**이다. 거기서는
 * 이번 틱의 정지 판정(`input`)이 아직 안 났고, `aux0` 갱신을 가로챌 수도 없다 — 훅이 끝난
 * 뒤에 분기가 `aux0 = 0` 으로 덮어쓴다. 「이동해도 즉시 리셋되지 않는다」(BA9)와
 * 「적립이 2배가 된다」(BA8)는 **그 대입 자체**를 바꿔야 해서 새 앵커가 필요했다.
 *
 * ⚠️ 호출부가 아크캐스터 분기 안이라 다른 기체는 애초에 지나가지 않지만, 기체 게이트는
 * 그래도 훅 안에 둔다(호출부가 옮겨져도 다른 기체 거동이 안 갈리게).
 */
export function onOverchargeAccrual(
  state: WorldState,
  player: Entity,
  still: boolean,
): OverchargeAccrual {
  const out: OverchargeAccrual = { still, delta: still ? 1 : 0 };
  if (!state.skillsOn) return out;
  switch (state.sigBit) {
    case SIG_ARC_OVERCHARGE:
      // BA8 절연 포좌(적립 2배) · BA9 이동 포격 술식(즉시 리셋 → 서서히 감쇠).
      arccasterOverchargeAccrual(state, player, out);
      break;
    default:
      break;
  }
  return out;
}

/**
 * 앵커 ㉑ — **콤보 유지 시계가 1 줄어들기 직전**(`updateCombo`).
 *
 * @returns `true` 면 이번 틱 감소를 **건너뛴다**(시계가 그대로 멈춘다). S0·타 기체는 항상
 *   `false` 라 종전과 비트 동일이다.
 *
 * ⚠️ 「절반 속도」류 스킬은 여기서 **틱 모듈러**로 구현해야 한다 — 시계 값 자체를 되돌리면
 * 같은 틱의 젬 수거가 세운 창(`comboTimer` 대입)과 갈린다.
 */
export function onComboDecay(state: WorldState, player: Entity): boolean {
  if (!state.skillsOn) return false;
  switch (state.sigBit) {
    case SIG_ARC_OVERCHARGE:
      // BA5 정전 콤보 감속 — 과충전 중 감소 주기를 늘린다.
      return arccasterComboDecay(state, player);
    default:
      break;
  }
  return false;
}

/**
 * 앵커 ⑨ — **시그니처 틱 진행**(`stepShipSignature` 진입). 매 틱 정확히 한 번 불린다.
 *
 * ⚠️ `stepShipSignature` 는 기체별 분기마다 조기 반환하므로, 이 앵커는 **분기보다 앞**에
 * 있어야 전 기체에서 매 틱 돈다. 분기 안으로 옮기지 마라.
 */
export function onSignatureStep(state: WorldState, player: Entity, input: InputFrame): void {
  dispatchSignatureStepSkill(state, player, input);
  // 촉매의 매-틱 자리. `input` 을 넘기지 않는 것은 의도다 — 촉매 48종 중 입력을 읽는 카드가
  // 없고, 넘기면 "촉매가 입력에 반응해도 된다"는 잘못된 여지가 생긴다.
  onTickCatalyst(state, player);
}

function dispatchSignatureStepSkill(
  state: WorldState,
  player: Entity,
  input: InputFrame,
): void {
  if (!state.skillsOn) return;
  void input;
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN:
      strikerSignatureStep(state, player); // S10 선체 증축(런 누적 XP 폴링)
      break;
    case SIG_ARC_OVERCHARGE:
      // CH4 진입 뇌격 · BR1 정전 척력장 · BR4 적립 · BR6 쿨다운 · BR8 정지 수복 · BR9 척력 외피.
      // `input` 을 넘기지 않는 것은 의도다 — 여섯 전부 `aux0`(입력 기반 적립의 결과)만 읽는다.
      // 정지 술어를 입력에서 다시 유도하면 시그니처와 두 곳이 조용히 갈린다.
      arccasterSignatureStep(state, player);
      break;
    case SIG_BRUISER_ARMOR:
      // FO1 상한 확장 · MO4 장갑 활주 · **FO4·FO8·FO9① 감쇠 판정 선점** · FO2 만재 상승 엣지
      // 정산 · FO7 기준선 · MO6 압쇄장 주기.
      // 이 앵커가 `stepShipSignature` **진입점**이라 브루저 감쇠 분기(바로 아래)와 이번 틱
      // `resolveCollisions` 양쪽이 FO1 의 새 상한을 본다.
      //
      // ⚠️ **FO4·FO8·FO9① 이 여기 온 근거는 「사후 관측이 아니라 선점」이다.** 종전에 이 셋을
      // 막던 사유(*"스택 감소를 사후 관측해 흉내 내면 액티브의 스택 소각과 구분이 안 된다"*)는
      // 근거로 남긴다 — 그 경고는 **감소를 관측하는 형태**에만 유효하다. 이 배선은 감소를 한 번도
      // 보지 않고, 분기가 쓰는 것과 같은 술어(`aux1 + 1 >= ARMOR_DECAY_TICKS`)로 이번 틱의
      // 성사 여부를 **미리** 판정한다. 액티브의 소각(blade_lo/hi)은 `aux1` 을 안 건드리므로
      // 원리적으로 이 술어에 안 걸린다. 근거 전문은 효과 함수 주석.
      //
      // `input` 을 넘기는 것은 FO4 하나 때문이다 — 정지 판정은 속도가 아니라 **입력**이라고
      // 설계서 1.5 계약이 못 박았고, 아크캐스터 시그니처가 같은 술어를 쓴다.
      bruiserSignatureStep(state, player, input);
      break;
    case SIG_HATCHLING_BROOD:
      // SH6 알막 · SH3 만석 둥지 온기 · NU6 온기 나눔 · NU8 이주 본능.
      //
      // ⚠️ 이 앵커가 `stepShipSignature` **진입점**이라 `stepHatchBrood`(출격)·`stepTurrets`
      // (수명·발사) 둘 다보다 앞이다. 그 순서에 셋이 의존한다 — NU6 의 +1 상쇄는 같은 틱의
      // `life--` 를 정확히 지우고, NU8 이 옮긴 좌표에서 그 틱의 사격이 나간다. SH6 만은 출격
      // 여부를 그 시점에 알 수 없어 `aux0` 증가로 **한 틱 늦게** 잡는다(유실 없음).
      //
      // ⚠️ 출격 지점 훅 8종(BD1·BD2·BD6·BD10·NU2·NU7·NU10·SH10)은 여기 없다 — 전부
      // "출격이 성사되는 그 한 지점"에서 임계·상한·좌표를 바꿔야 하는데, 이 앵커는 그보다
      // 앞이라 출격 여부도 좌표도 모른다. 사후 관측으로 흉내 내면 보류·상한 분기까지 발동한다.
      hatchlingSignatureStep(state, player);
      break;
    // ⚠️ **말로우는 여기 case 가 없다 — 이 레인이 내린 가장 무거운 판단이다.**
    //
    // 말로우 30종 중 **9종**(SQ2·SQ5·SQ8·ME4·ME5·ME8·CU3·CU9·CU10)이 "정산 틱" 을 트리거로
    // 삼는데, 정산은 이 앵커 **뒤**의 `world.ts` 코드(`stepShipSignature` 말로우 가지의
    // `aux0 > 0 && aux1 >= CUSHION_RECOVER_TICKS` 안쪽)에서 일어난다. 이 앵커는 진입점이라
    // 정산 **전**의 aux 만 본다.
    //
    // 여기서 `aux0 > 0 && aux1 + 1 >= 임계` 로 "이번 틱에 정산이 일어날 것" 을 **예측**할 수는
    // 있다. 하지 않았다 — 그 순간 정산 술어가 두 곳에 살고, 정산액(`cushionSettled`)·탕감액
    // (`cushionRecovered`)·hp−1 클램프 후 실제 적용액(`applied`)까지 전부 두 번째 사본이 된다.
    // 이 저장소의 지배적 실패 모드가 정확히 그 형태이고(같은 술어를 여러 곳에 적어 화면과
    // 규칙이 갈린다), 액티브 4종이 임계를 수동 주입하는 기체라 어긋남이 조용히 커진다.
    // 정산 분기에 앵커가 뚫릴 때까지 9종은 **코드가 없다**.
    case SIG_PHANTOM_CLOAK:
      // DI2 은둔 재생(창 안 주기 회복) · DI5 내부 쿨다운 진행.
      // 이 앵커는 `stepShipSignature` **진입점**이라 팬텀 적립(`aux0++`)보다 앞이다 — DI2 의
      // 주기 판정이 그 전제 위에 서 있다(효과 함수 주석).
      //
      // PH3 그림자 장부(본체 — 창 중 콤보 시계 정지) · PH6 정지된 시계(**집행**)도 여기다(S3).
      // 둘 다 이 앵커가 "적립·감소보다 앞" 이라는 성질을 정면으로 쓴다: PH3 은 `updateCombo` 의
      // `-1` 을 같은 틱에 `+1` 로 상쇄하고, PH6 은 `aux0++` 직전에 1 을 되돌려 순변화를 0 으로
      // 만든다(예약은 앵커 ② 가 세운다).
      //
      // ⚠️ PH5(연장 위상)는 여전히 여기 없다. **적립 분기 그 자리**(되감기 조건과 `HOLD` 상한)를
      // 고쳐야 하는데 그 분기는 이 앵커 **뒤**의 `world.ts` 코드다 — 상쇄로는 흉내 낼 수 없다
      // (PH6 이 되는 것은 정지가 "한 틱 −1" 이라는 **가역 연산**이기 때문이고, 창 상한 재정의는
      // 아니다).
      // 앵커에서 사후 관측으로 흉내 내면 액티브 진입(`activeHandlers/phantom.ts`)과 구분이
      // 안 돼 조용히 오발동한다(브루저 FO4·FO8·FO9 와 같은 판단).
      phantomSignatureStep(state, player);
      break;
    case SIG_BUBBLE_FILM:
      // FI2 내구 재응결 — 막이 서 있고 만재가 아닌 동안 주기마다 내구 +1.
      //
      // 이 앵커가 `stepShipSignature` **진입점**이라 버블 재생 분기(`world.ts:2562-2568`)보다
      // 앞이다. FI2 는 `aux0 > 0` 술어라 그 분기(`aux0 === 0` 게이트)와 배타적이라서 순서가
      // 결과를 바꾸지 않는다 — 한쪽이 도는 틱에 다른 쪽은 반드시 쉰다.
      //
      // ⚠️ DR7(신호 표류)은 여기 없다 — **종전 사유의 절반은 틀렸다. 정정해 둔다.**
      // 재생 배율 자체는 이 앵커에서 `aux1 += 1` 을 더해 구현할 수 있고, 술어도 **있다**:
      // `state.echoRuntime?.state === 1` 이 정확히 "에코 오브젝트가 서 있고 안정화 진행 중"
      // 이다(`echo.ts` 의 `EchoRuntime.state` 주석 — 0 대기·1 출현·2 완료). 종전 주석이
      // "세울 값이 없다" 고 적은 것은 `encounterRuntime`·`inDetour` 만 보고 `echoRuntime` 을
      // 빠뜨린 것이다(그 둘에 대한 판정은 여전히 참 — 조우 쪽 술어는 아직 없다).
      //
      // 그럼에도 배선하지 않은 이유는 **반쪽이 되기 때문**이다. 설계서 DR7 은 효과가 셋이고
      // (①활성 중 재생 2배 ②안정화 **완수 틱** 막 즉시 만재 ③완수 자원 보너스 +1+floor(Lv/2)),
      // ②③ 은 둘 다 state 1→2 **엣지**를 요구한다. `stepEcho` 는 이 앵커 **뒤**(world.ts:1878)
      // 라 완수 틱에는 아직 1 로 보이고 다음 틱부터 계속 2 로 보인다 — 엣지를 기억할 값이
      // 없으면 "완수 틱"과 "완수 이후 매 틱"이 구분되지 않아 ② 는 *영구 만재*가 된다.
      // 게다가 설계서가 **레벨은 ③ 에만 걸린다**고 못 박아서, ① 만 넣으면 Lv1 과 Lv20 이
      // 완전히 같은 스킬이 된다. 엣지용 정수 1칸(또는 에코 완수 지점 앵커)이 선결이다.
      // ⚠️ DR10(공막 유속)·PO10(연쇄 압력)도 없다 — 둘 다 "재생이 완료된 틱" 이라는 엣지가
      // 필요한데 이 앵커는 재생 분기보다 앞이라 그 엣지를 이번 틱에 볼 수 없다. 다음 틱에
      // 사후 관측하면 액티브의 즉시 만재(`film_lo`/`film_hi`)와 구분이 안 된다.
      // PO10 은 더해서 `aux0 ≤ FILM_ABSORB_FLAT` 불변식 개정(설계서 ⑥절 3)이 선결이다.
      bubbleSignatureStep(state, player);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑩⑪ (S1: 전 분기 비어 있음) — **적 단위 사건**
// ---------------------------------------------------------------------------
//
// 기존 앵커 9개는 전부 **플레이어 축**이다(발사·대시·피격·수거·벽·틱). 적 하나하나에 반응하는
// 자리가 통째로 없어서, 스킬 5종(스트라이커 F6~F9 계열의 명중 처리)과 촉매 다수가 배선 불가로
// 남아 있었다. 이 두 앵커가 그 축을 연다.

/**
 * 앵커 ⑩ — **적성 표적이 아군탄에 맞아 피해가 확정된 직후**.
 *
 * ## 언제 불리는가
 * `resolveCollisions` 의 아군탄 명중 해소 루프에서, `t.hp -= dealt` 와 **격추/부활 판정이 끝난
 * 직후**·원소 상태이상 부여보다 **앞**. 명중 하나당 정확히 한 번이고, 탄 하나가 한 틱에 여러
 * 표적을 관통하면 표적 수만큼 불린다(경로 순서 = 진입 매개변수 오름차순).
 *
 * ## 무엇이 보장되는가
 *  - `target.hp` 는 **이미 차감된 최종값**이고 `target.dead` 는 **이미 확정**이다. 즉 이 앵커
 *    안에서 보는 생사가 그 틱의 진실이다 — 수호 기체 부활·코어 '최후의 재기동'·코어 실드 흡수가
 *    전부 앞에서 해소됐다.
 *  - `dmg` 는 **실제로 hp 에서 깎인 양**이다(과열 2배·관통 증폭·엘리트 피해 감소·방어 배율·
 *    코어 실드 흡수를 전부 통과한 뒤). 코어 실드가 전량 흡수하면 **0 으로 불린다** — "맞았다"와
 *    "깎였다"를 구분해야 하는 카드는 `dmg > 0` 을 스스로 봐라.
 *  - `source` 는 **가해 아군탄 엔티티**다. 귀속 판정에 필요한 것이 여기 있다: `ownerId`
 *    (`MISSILE_MARK`·`SPLIT_FRAGMENT_MARK` 등 파생탄 마커), `damage`(기본 피해), `phase`
 *    (지금까지 관통한 횟수), `x`/`y`/`angle`. 타입이 `Entity | undefined` 인 것은 훗날 비-탄
 *    피해원(해저드·DoT)이 같은 앵커를 타게 될 여지를 남기기 위함이다 — **지금은 항상 정의된다.**
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **`target.hp`/`target.dead` 를 되돌리지 마라.** 격추 판정은 이미 끝났다. 여기서 hp 를
 *    올려도 `dead` 는 참인 채라 `compact` 이 그대로 수거하고, 반대로 hp 를 0 으로 만들어도
 *    `dead` 가 거짓이면 죽지 않는다 — 둘 다 조용히 어긋난다. 처형·부활 축은 이 앵커가 아니다.
 *  - ⚠️ **`state.entities` 에 스폰하지 마라.** 이 지점은 격자 순회(`grid.query`) 콜백 **바깥**
 *    이지만 여전히 `for (const b of state.entities)` 순회 안이다. 스폰이 필요하면 `world.ts` 의
 *    `splitSpawns`/`hiveSpawns` 처럼 좌표를 모아 루프 뒤에 뿌리는 형태여야 한다.
 *  - **RNG 를 소비하지 마라**(공통 계약). 명중은 틱당 수백 건이라 한 칸만 밀려도 드랍·웨이브
 *    스트림이 통째로 갈린다.
 *
 * ## ⚠️ 덮는 범위 — **아군탄 명중 경로 하나뿐**이다
 * 적 hp 가 깎이는 지점은 실측 6곳인데, 이 앵커가 있는 곳은 그중 `world.ts` 의 명중 해소
 * 하나다. 나머지 다섯은 전부 **leaf 모듈**이라 여기를 부르면 순환이 된다
 * (`skillHooks → skills/striker → activeTypes` 가 이미 서 있다):
 *   `activeTypes.ts:169`(액티브 폭발·F4 파편) · `status.ts:82`(화염 DoT) ·
 *   `status.ts:111`(전격 연쇄) · `events.ts:66`(폭탄 기물) · `encounterDetour.ts:332`(격실 탄).
 * "모든 피해"를 약속하는 카드는 이 앵커만으로 성립하지 않는다 — 화면과 규칙이 갈린다.
 * (`world.ts:3661` 의 `w.hp -=` 는 **파괴가능 벽**이라 적이 아니다.)
 *
 * @param target 맞은 적성 표적. `enemy`·`boss`·`guardian`·`core`·`defenseBoss`·`destructible`·
 *   `supply`·`prop`·침공 설비까지 **전부 온다**. 잡몹만 원하면 `target.kind === 'enemy'` 를 봐라.
 * @param dmg 실제로 hp 에서 깎인 피해(0 일 수 있다)
 * @param source 가해 아군탄
 */
export function onEnemyDamaged(
  state: WorldState,
  target: Entity,
  dmg: number,
  source: Entity | undefined,
): void {
  dispatchEnemyDamagedSkill(state, target, dmg, source);
  onEnemyDamagedCatalyst(state, target, dmg, source);
}

function dispatchEnemyDamagedSkill(
  state: WorldState,
  target: Entity,
  dmg: number,
  source: Entity | undefined,
): void {
  if (!state.skillsOn) return;
  void dmg;
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN:
      // F6 소이 정조준 · F9 제압 사격 · **F8 과열 파쇄**. 앞 둘은 트리거가 **정조준탄 명중**이라
      // 앵커 ⑯ 이 찍은 표식(`params.mark = 1` → 탄 `aux0`)을 `source` 에서 읽는다. F8 만
      // 표식과 무관하다 — 설계서가 "보스 과열 창 동안 명중할 때마다" 로 적었고, 그래서 효과
      // 함수에서 표식 게이트 **앞**에 있다(보스 `iframes` = 과열 창 잔여 틱).
      //
      // ⚠️ F7(표적 고정)·S7(최후 처형)은 여기 **없다** — 이 앵커의 금지 사항에 정면으로 걸린다
      // (F7 은 차감 **뒤**라 이번 일격에 안 실리고, S7 은 doc 가 "처형 축은 이 앵커가 아니다"
      // 로 명시 배제했다). 사유 전문은 `strikerEnemyDamaged` 의 doc 주석에 있다.
      strikerEnemyDamaged(state, target, source);
      break;
    case SIG_ARC_OVERCHARGE:
      // CH1 유도 낙뢰 · CH8 접지 관통로 · CH6 과잉 전하 이월. 셋 다 **가해 탄**을 만진다:
      // 앞 둘은 앵커 ⑯ 이 단 과충전 표식(`b.aux0`)을 읽고, CH6 은 초과 피해(= 차감 후
      // `target.hp` 의 음수부)를 그 탄에 되싣는다.
      //
      // ⚠️ **CH10「주입 전격」은 여전히 여기 없다.** 연쇄 부여 3종 중 액티브축인 그 스킬은
      // strike 투사체에 표식을 달아야 하는데, 그 탄은 `autoAttack` 이 아니라 액티브 핸들러가
      // 낳는다 — 앵커 ⑯ 은 주무기 볼리 전용이라 닿지 않는다(BR2 는 피격축이라 앵커 ④ 에 있다).
      arccasterEnemyDamaged(state, target, source);
      break;
    case SIG_BRUISER_ARMOR: {
      // BL9 중압 리듬 — 명중 카운터 × 장갑 스택 파생 주기. 주기가 스택에서 나오므로
      // **플레이어**가 필요하다(이 앵커는 표적만 넘긴다).
      //
      // ⚠️ BL7(파성퇴)은 여기 없다 — 이 앵커에는 `destructible` 도 오지만, 그 스킬은 "일격
      // 파괴 + 그 자리 충격파" 라 **명중 해소 자체를 바꿔야** 한다(hp 를 0 으로 만들어도
      // `dead` 판정은 이 앵커 앞에서 이미 끝났다 — 앵커 주석의 금지 사항 그대로다).
      //
      // BL3 만재 중탄 · BL6 중량 탄자도 여기다 — 둘은 앵커 ⑯ 에서 **탄 `aux0` 에 찍은 표식**을
      // 읽어 명중 지점 폭발·변위를 낸다. 그래서 `source`(가해 아군탄)가 필요하다.
      const p = playerOf(state);
      if (p !== undefined) bruiserEnemyDamaged(state, p, target, dmg, source);
      break;
    }
    case SIG_HATCHLING_BROOD:
      // SH5 경계 지저귐 — **병아리 탄** 명중에 냉기 감속. 출처 식별은 `source.ownerId ===
      // BROOD_MARK` 이고 스탬프 지점은 `fireTurretShot` 한 곳뿐이다(이미 배선돼 있다).
      // 병아리 탄은 `spawnBullet` 이 만든 평범한 아군탄이라 이 앵커에 **전부 온다**.
      //
      // ⚠️ BD4(표적 공유 증폭)는 여기 없다 — 이 앵커는 `t.hp -= dealt` 와 격추 판정이 **끝난
      // 뒤**라, 여기서 증폭분을 더해도 그 일격으로 격추되지 않는다(앵커 주석의 금지 사항).
      // 증폭은 명중 해소 안, 차감 **전**의 자리라 `world.ts` 가 소유해야 한다.
      hatchlingEnemyDamaged(state, target, source);
      break;
    case SIG_MALLOW_CUSHION: {
      // SQ4 압인 탄두 — 부채 보유 중 명중한 적을 좌표 직접 변위로 민다. 술어(`aux0 > 0`)가
      // **플레이어** 상태라 사본으로 집는다(이 앵커는 표적만 넘긴다).
      //
      // ⚠️ SQ9(이자 소각)는 여기 없다 — **반쪽도 못 된다.** 화상 부여는 이 앵커로 가능하지만
      // ⓐ설계서의 틱당 피해가 "기본 화염 기준 +4%p/Lv" 라 장비 화염이 없는 런에서는 기준값
      // 자체가 0 이고(설계 정본 밖의 수치를 발명해야 한다) ⓑ탕감 절반은 `status.ts` 의 화상
      // 만료 지점과 `compact()` 의 사망 집계 두 곳을 요구하는데 둘 다 앵커가 없다. 부여만
      // 켜면 "부채가 줄지 않는 화염 스킬" 이 되어 설계와 다른 물건이 된다.
      const p = playerOf(state);
      if (p !== undefined) mallowEnemyDamaged(state, p, target, source);
      break;
    }
    case SIG_PHANTOM_CLOAK: {
      // AS4 급소 해부(만피 선타) · AS5 배후 격살. 둘 다 **플레이어 좌표**가 필요하다(AS5 의
      // 후방 반구 판정) — 이 앵커는 표적만 넘기므로 위 사본으로 집는다.
      //
      // AS3(처형 재장전)의 **회수 절반**도 이제 여기 있다 — 막고 있던 사유는 근거로 남긴다:
      // 트리거가 "**해제 첫 타(강화탄)**로 처치" 인데 그 강화탄을 식별할 마커는 **발사 시점**에
      // 탄에 심어야 하고 앵커 ① 에는 탄이 없었다. `source` 만 보고 "지금 은신 창인가"로
      // 대체하면 강화탄이 아닌 탄까지 재장전을 일으켜 창 안 전 발사가 2.5배가 된다 — 설계와
      // 정반대다. 마커를 심을 자리는 앵커 ⑯ 이고(`VolleyParams.cloakBreak` 가 그 술어를 실었다),
      // 회수는 이 앵커가 `source`(가해 아군탄)와 확정된 `target.dead` 로 한다.
      //
      // AS9(절멸 선고)도 여기다(S3) — **같은 마커를 읽는다.** 설계서의 `구현: A` 는 "소진 지점
      // 명중 처리에서 `blastDamage` 1회" 인데 소진 지점은 앵커가 아니다. 그런데 그 판정을 이미
      // 탄이 나르고 있으므로 소진 지점 자체는 필요 없었다. 형태는 브루저 BL3(명중 지점 폭발)와
      // 같고 **맞은 표적 자신은 제외**한다(넣으면 단일 표적 증폭으로 퇴화한다).
      const p = playerOf(state);
      if (p !== undefined) phantomEnemyDamaged(state, p, target, dmg, source);
      break;
    }
    case SIG_BUBBLE_FILM: {
      // PO6 격발 재응결 — 무막 중 주무기 명중마다 재생 타이머(`aux1`)가 전진한다. 대상이
      // 표적이 아니라 **플레이어**의 aux1 이라 사본으로 집는다(스트라이커 M3 와 같은 사유).
      //
      // 이 앵커의 "아군탄 명중 경로 하나뿐" 이라는 한계에 이 스킬은 **부딪히지 않는다** —
      // 설계서 PO6 의 문면이 "**주무기** 탄이 명중할 때마다" 라 범위가 정확히 일치한다.
      const p = playerOf(state);
      if (p !== undefined) bubbleEnemyDamaged(state, p, target);
      break;
    }
    default:
      break;
  }
}

/**
 * 앵커 ⑪ — **잡몹 하나가 실제로 격추된 사건**. 앵커 ⑤(`onKillsDelta`)가 개수만 주는 것과 달리
 * **격추 좌표**를 준다.
 *
 * ## 언제 불리는가
 * `compact()` 안, 이번 틱에 `state.kills` 를 올린 적 **하나당 한 번**. 순서는
 * `onEnemyDeath × N` → `onKillsDelta(N)` 이다(개별이 먼저, 집계가 나중).
 *
 * ## 무엇이 보장되는가
 *  - 게이트는 `kind === 'enemy' && hp <= 0` 로 **`state.kills++` 와 완전히 같은 술어**다.
 *    강제 스크롤 컬링(도망친 적, `hp > 0` 인 채 `dead`)은 처치가 아니므로 오지 않는다.
 *    그래서 `onEnemyDeath` 호출 수의 합 = `onKillsDelta` 델타의 합이 **항등**이다.
 *  - ⚠️ **좌표는 `compact` 의 생존자 루프 안에서 캡처하고, 통지는 배열 재구축이 끝난 뒤 한다.**
 *    `compact()` 는 `state.entities = survivors` 로 배열을 갈아 끼우므로 죽은 엔티티는 그
 *    시점 이후 어디서도 조회할 수 없다 — 통지 시점에 좌표를 읽으려 하면 원리적으로 불가능하다.
 *    그렇다고 루프 **안**에서 부르면 훅이 스폰하는 순간 순회 중인 배열을 변형하게 된다
 *    (`compact` 가 드랍·젬·파편을 전부 루프 뒤로 미룬 것과 같은 사유). 그래서 **캡처 시점과
 *    통지 시점을 분리**했다.
 *  - 통지 시점은 **확보(전리품·젬·보급 젬 스폰) 이후**다. 앵커 ⑤ 와 같은 성질이라, 이번 틱
 *    드랍을 훅이 보려면 한 틱 늦는다 — 알려진 성질이지 결함이 아니다.
 *  - `elite` 는 `isElite(e)`(= `kind === 'enemy' && pierce > 0`)를 격추 시점에 평가한 값이다.
 *    전리품 게이트가 굴러간 그 판정과 **같은 값**이다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **죽은 엔티티를 넘기지 않는 것은 의도다.** 시체는 이미 `state.entities` 밖이라 거기에
 *    쓴 값은 아무 데도 반영되지 않는다 — 조용한 무연산을 만들 여지 자체를 없앴다. 잡몹 종류·
 *    어픽스 등 좌표 밖 정보가 필요해지면 캡처 지점(`compact` 의 루프)에서 인자를 늘려라.
 *  - **RNG 를 소비하지 마라**(공통 계약). 드랍 롤이 바로 앞에서 `dropRng` 를 굴렸다.
 *
 * ## ⚠️ 보스·코어 격파는 이 앵커가 **아니다**
 * `compact` 의 보스/코어 분기는 `state.kills` 를 올리지 않는다(승리 판정·전리품 축이다).
 * 그 사건이 필요하면 별도 앵커를 뚫어라 — 여기에 끼워 넣으면 처치 수와 호출 수의 항등이 깨진다.
 *
 * ## ⚠️ `burning` 이 **엔티티가 아니라 캡처된 사실**인 이유
 * 말로우 SQ9「이자 소각」은 *화상이 남은 채 죽은 적* 하나당 1회 부채를 탕감한다. 그 판정에
 * 죽은 엔티티가 필요해 보이지만, **여기서 시체를 넘기는 것은 위 「무엇을 하면 안 되는가」가
 * 금지한 형태다** — 시체는 이미 `state.entities` 밖이라 거기 쓴 값은 아무 데도 반영되지 않고,
 * 조용한 무연산을 만드는 여지가 된다. 이 doc 이 그 대신 지시한 길이 *"좌표 밖 정보가
 * 필요해지면 캡처 지점(`compact` 의 루프)에서 인자를 늘려라"* 이고, 그대로 했다.
 *
 * ⚠️ **인자 추가는 기존 호출부를 전부 깬다**(다른 기체 테스트 포함). 기본값을 두지 않은 것은
 * 이 저장소의 규율이다 — 기본값을 두면 옛 호출부가 조용히 옛 거동으로 흐른다.
 *
 * @param x 격추 좌표 x (`compact` 루프 안에서 캡처)
 * @param y 격추 좌표 y
 * @param elite 그 적이 엘리트였는가
 * @param burning **화상이 남은 채 죽었는가**(`iframes > 0` 을 격추 시점에 캡처한 값).
 *   `kind === 'enemy'` 한정은 캡처 지점의 게이트가 이미 진다 — 보스 `iframes` 는 화상 잔여가
 *   아니라 과열 취약 창이라 한정을 빠뜨리면 오탕감이 난다(설계서 SQ9 3R-7)
 */
export function onEnemyDeath(
  state: WorldState,
  x: number,
  y: number,
  elite: boolean,
  burning: boolean,
): void {
  dispatchEnemyDeathSkill(state, x, y, elite, burning);
  onEnemyDeathCatalyst(state, x, y, elite);
}

function dispatchEnemyDeathSkill(
  state: WorldState,
  x: number,
  y: number,
  elite: boolean,
  burning: boolean,
): void {
  if (!state.skillsOn) return;
  void x;
  void y;
  switch (state.sigBit) {
    case SIG_MALLOW_CUSHION: {
      // SQ9「이자 소각」의 **두 번째 탕감 경로** — 화상이 남은 채 죽은 적. 만료 경로(앵커 ㉚)와
      // 배타다: 만료되면 화상이 없고, 화상 중에 죽으면 만료 틱이 오지 않는다. 그래서 적 1기당
      // 화상 1사이클에 정확히 1회다(설계서 SQ9 구현 항).
      //
      // 플레이어는 `compact()` 뒤라 사라져 있을 수 있다(같은 틱에 함께 죽은 경우).
      const p = playerOf(state);
      if (p !== undefined && burning) mallowEnemyDeath(state, p);
      break;
    }
    // 레인은 자기 `case SIG_*:` 한 줄을 여기에 넣는다.
    case SIG_STRIKER_MARKSMAN: {
      // S3 전리 응급 — 엘리트 격파 시 선체 회복. `elite` 는 전리품 게이트가 굴린 그 판정과
      // 같은 값이라 여기서 다시 세지 않는다.
      //
      // 플레이어는 `compact()` 뒤라 사라져 있을 수 있다(같은 틱에 함께 죽은 경우).
      const p = playerOf(state);
      if (p !== undefined) strikerEnemyDeath(state, p, elite);
      break;
    }
    case SIG_ARC_OVERCHARGE:
      // BA7 연발 축전기 — 처치 6기마다 다음 볼리를 장전한다. 소비는 앵커 ⑯ 이다.
      //
      // ⚠️ **CH9「낙뢰 인양」은 여전히 여기 없다 — 필요한 것이 사건이 아니라 인자이기
      // 때문이다.** `rollEliteDrop` 의 `rarityMult` 파라미터에 곱해야 하는데, 그 굴림은 이
      // 앵커보다 **앞**(`compact` 의 확보 단계)에서 이미 끝나 있다. 여기서 뒤늦게 알아 봐야
      // 드랍은 이미 정해졌다. 이 스킬은 `drops.ts` 호출부에 손잡이가 필요하다.
      //
      // `elite` 를 안 보는 것은 의도다 — BA7 은 "적 6기" 이지 "엘리트 6기" 가 아니다.
      arccasterEnemyDeath(state);
      break;
    case SIG_BRUISER_ARMOR: {
      // FO7 전리 개장 — 엘리트 격파 시 스택당 최대 HP 영구 증가 + 만재 재무장.
      //
      // ⚠️ **보스 격파는 이 앵커에 오지 않는다**(`compact` 의 보스/코어 분기는 `state.kills` 를
      // 올리지 않는다). 설계서 FO7 은 "엘리트·보스" 이므로 **현재 배선은 엘리트 절반뿐**이다.
      // 여기에 보스를 끼워 넣으면 처치 수와 호출 수의 항등이 깨진다 — 별도 앵커가 필요하다.
      //
      // 플레이어는 `compact()` 뒤라 사라져 있을 수 있다(같은 틱에 함께 죽은 경우).
      const p = playerOf(state);
      if (p !== undefined) bruiserEnemyDeath(state, p, elite);
      break;
    }
    case SIG_PHANTOM_CLOAK:
      // AS8「처형인의 적공」(적립 절반) — 처치 1건당 스택 +1(상한 있음). 소비는 앵커 ⑯ 에서
      // "다음 해제 첫 타" 볼리가 한다. 좌표·엘리트 여부·화상은 안 본다(설계 문면이 처치 수
      // 하나다) — 그래서 인자를 넘기지 않는다.
      //
      // ⚠️ **AS6「무성 격살」은 여기 배선할 수 없다 — 필요한 것이 사건이 아니라 지점이다.**
      // "은신 창 중 처치한 적이 죽음의 잔재를 남기지 않는다" 인데, 그 잔재를 만드는 곳은
      // `elite.ts` 의 `explodeElite` 와 `world.ts` 의 BK_SPLIT 분열이고 둘 다 이 앵커보다
      // **앞**에서 이미 실행됐다. 여기서 뒤늦게 알아 봐야 파편은 이미 태어났고, 사후에
      // 지우는 것은 스폰 억제와 값이 다르다(파편이 한 틱 살아 피해를 준다).
      // AS9(절멸 선고)는 격추가 아니라 **해제 첫 타의 명중 지점**이 트리거라 축이 다르다 —
      // 그래서 여기가 아니라 **앵커 ⑩** 에 배선됐다(S3).
      phantomEnemyDeath(state);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑫⑬⑭ (S1: 전 분기 비어 있음) — **성장 축**
// ---------------------------------------------------------------------------
//
// ⚠️ **아크캐스터는 세 앵커 전부 case 가 없다 — 설계에 레벨업·파워업 결속 스킬이 한 종도
// 없기 때문이다.** 이 기체의 30종은 시그니처(과충전)·액티브·피격·정지 경제에만 붙는다.
// 누락이 아니라 **해당 없음**이다.
//
// ⚠️ **팬텀도 세 앵커 전부 case 가 없다 — 같은 사유다.** 팬텀 30종 중 레벨업·파워업 제시·
// 파워업 선택에 반응하는 스킬이 0종이다(런 내 성장은 DI8 이 담당하는데 그 트리거는 은신 진입
// 에지이고, 그 자리는 `cloak.ts` 의 `fireCloakEntry` 다).

/**
 * 앵커 ⑫ — **레벨이 오른 직후**(`checkLevelUp`).
 *
 * ## 무엇이 보장되는가
 *  - `state.level` 은 **이미 증가**했고 `state.xp` 는 **임계만큼 차감**됐다. `level` 인자는
 *    올라간 뒤의 값이다.
 *  - 파워업 3택이 이미 뽑혀 `state.powerupChoices` 에 실려 있고 `pendingLevelUp` 이 참이다.
 *    즉 이 앵커 뒤로 sim 은 **선택 입력이 올 때까지 정지**한다(레벨업 프리즈).
 *  - `checkLevelUp` 은 `pendingLevelUp` 이면 즉시 반환하므로 **틱당 최대 1레벨**이다. XP 를 한
 *    번에 많이 얻어도 이 앵커가 한 틱에 두 번 불리는 일은 없다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **`state.xp` 를 올려 다단 레벨업을 유도하지 마라.** 프리즈 구조상 다음 레벨은 픽이
 *    소비된 뒤에야 열린다 — 여기서 xp 를 부풀리면 픽 한 번에 여러 레벨이 몰려 파워업 개수와
 *    레벨 수가 어긋난다.
 *  - **RNG 를 소비하지 마라**(공통 계약). `drawPowerupChoices` 가 바로 앞에서 굴렸다.
 */
export function onLevelUp(state: WorldState, level: number): void {
  dispatchLevelUpSkill(state, level);
  onLevelUpCatalyst(state, level);
}

function dispatchLevelUpSkill(state: WorldState, level: number): void {
  if (!state.skillsOn) return;
  void level;
  switch (state.sigBit) {
    // ⚠️ **브루저는 성장 축 앵커 ⑫⑬⑭ 를 한 곳도 쓰지 않는다 — 쓸 설계 항목이 0종이다.**
    // 브루저 30종 중 레벨업·파워업 제시·파워업 선택에 반응하는 스킬이 없다(런 내 성장은
    // FO7 이 담당하는데 그 트리거는 엘리트 격파다). 누락이 아니라 설계 자체가 비어 있다.
    default:
      break;
  }
}

/**
 * 앵커 ⑬ — **파워업 3택이 제시된 직후**(`checkLevelUp` 의 마지막). 앵커 ⑫ **바로 뒤**에 불린다.
 *
 * @param choices 제시된 파워업 풀 인덱스. **읽기 전용**이다 — 선택지를 바꾸려면
 *   `state.powerupChoices` 를 직접 갈아 끼워야 하고, 그때 재추첨은 금지다(`powerupRng` 가 이미
 *   소비된 뒤라 다시 굴리면 같은 시드의 전개가 통째로 밀린다).
 *
 * ⚠️ 3개 고정이 아니다 — 유니크 ⑬「도박사의 칩」이면 4개다. 길이를 상수로 가정하지 마라.
 */
export function onPowerupOffer(state: WorldState, choices: readonly number[]): void {
  dispatchPowerupOfferSkill(state, choices);
  onPowerupOfferCatalyst(state, choices);
}

function dispatchPowerupOfferSkill(state: WorldState, choices: readonly number[]): void {
  if (!state.skillsOn) return;
  void choices;
  switch (state.sigBit) {
    default:
      break;
  }
}

/**
 * 앵커 ⑭ — **파워업이 실제로 적용된 직후**(레벨업 프리즈 해제 틱).
 *
 * ## 무엇이 보장되는가
 *  - `applyPowerup` 이 이미 끝났다(스탯이 반영된 뒤다). `pendingLevelUp` 은 거짓이고
 *    `state.powerupChoices` 는 이미 비워졌다 — 그래서 `poolIndex` 를 인자로 넘긴다.
 *  - **범위 밖 선택 프레임에는 불리지 않는다.** 제시 개수보다 큰 인덱스가 오면 sim 은 픽을
 *    소비하지 않고 프리즈를 유지하는데(악성 프레임이 빌드 선택을 건너뛰지 못하게 하는 가드),
 *    이 앵커는 그 가드 **안쪽**에 있다.
 *  - 이 틱은 **프리즈 틱**이다 — `stepWorld` 가 `state.tick++` 만 하고 즉시 반환하므로 적·탄·
 *    충돌이 한 칸도 움직이지 않는다. 여기서 세운 값이 다음 틱 전에 소비되리라 가정하지 마라.
 *
 * @param poolIndex 적용된 파워업의 **풀 인덱스**(제시 순번이 아니다)
 * @param offeredIndex 그것이 몇 번째 선택지였는가(0-based, 입력 프레임의 2비트)
 */
export function onPowerupPicked(
  state: WorldState,
  poolIndex: number,
  offeredIndex: number,
): void {
  dispatchPowerupPickedSkill(state, poolIndex, offeredIndex);
  onPowerupPickedCatalyst(state, poolIndex, offeredIndex);
}

function dispatchPowerupPickedSkill(
  state: WorldState,
  poolIndex: number,
  offeredIndex: number,
): void {
  if (!state.skillsOn) return;
  void poolIndex;
  void offeredIndex;
  switch (state.sigBit) {
    case SIG_MALLOW_CUSHION: {
      // ME10 성장 환전 — 픽 적용 틱에 부채(`aux0`)의 절반이 **런 풀 XP**(`state.xp`)로 환전된다.
      // 설계서가 이 자리를 "픽 적용 지점 뒤" 로 지정했고, 이 앵커가 정확히 그 자리다(프리즈
      // 해제 틱 · 범위 밖 선택 가드 안쪽).
      //
      // 인자 둘(`poolIndex`·`offeredIndex`)은 넘기지 않는다 — 설계서의 트리거는 "어떤 파워업을
      // 골랐는가" 가 아니라 **레벨업 리듬 그 자체**라 어느 픽이든 같게 작동해야 한다.
      const p = playerOf(state);
      if (p !== undefined) mallowPowerupPicked(state, p);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑮ (배치 4) — **시그니처 사건**
// ---------------------------------------------------------------------------

/**
 * 앵커 ⑮ — **버블 방막이 파열한 직후, 밀어내기보다 앞**(`filmBurst.ts` 의 `resolveFilmBurst` 첫 줄).
 *
 * ## 왜 이 앵커가 필요했는가
 * 앞의 14개는 **전 기체 공통 사건**(발사·대시·피격·수거·벽·틱·명중·격추·성장)이라 특정 기체의
 * 시그니처 사건에는 자리가 없다. 버블 30종 중 **10종이 「파열 틱」을 트리거로 삼는다**
 * (PO1·PO3·PO7·PO8·DR1·DR6·FI1·FI5·FI7·FI10). 앵커 없이 배선하면 파열이 일어나는 두 경로
 * (액티브 요청 소비 `world.ts:1823` · 시그니처 소진 파열 `world.ts:4268`)에 같은 훅을 두 벌
 * 얹어야 하고, 그것이 `bubble.md` ①-3 이 `resolveFilmBurst` 로 없앤 바로 그 복제다.
 *
 * `filmBurst.ts` 헤더가 "FI1 선급 · 파열 훅 9종 · DR9 잔파동 — 소비자가 아직 없다. 넷 다
 * **스킬 배선 커밋**에서 넣어라" 라고 이 레인에 명시 인계한 자리다.
 *
 * ## 무엇이 보장되는가
 *  - ⚠️ **밀어내기는 아직 일어나지 않았다.** 여기서 보는 적 좌표는 파열 **직전**의 값이고,
 *    그것이 계약이다 — 밀어내기 변위(260)가 파열 반경(220)보다 커서, 뒤에 두면 반경 술어로
 *    대상을 고르는 스킬이 전부 조용히 0건이 된다(근거는 호출 지점 주석). 반대로 **밀어낸
 *    결과**를 봐야 하는 스킬(PO4 압착 충돌)은 이 앵커로 못 한다.
 *  - `(x, y)` 는 **파열 중심**이고 `player.x/y` 와 다를 수 있다(액티브 요청은 요청 시점
 *    좌표를 박아 둔다 — 같은 틱 blink 가 플레이어를 옮겼으면 갈린다). 어느 기준점을 쓸지는
 *    효과마다 다르다 — `skills/bubble.ts` 의 {@link bubbleFilmBurst} 주석이 그 표다.
 *  - 두 소비 위상 모두에서 불린다. 시그니처 소진 파열은 **피격 처리 한복판**이라, 여기서
 *    `player.iframes` 를 올리면 바로 뒤의 막 전량 흡수 분기(`world.ts:4281-4284`)가
 *    `iframes = hitIframes` 로 **덮어쓴다** — FI5 가 가산이 아니라 max 갱신인 이유다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **`state.entities` 에 직접 push 하지 마라.** 시그니처 파열 경로는 `resolveCollisions`
 *    의 엔티티 순회 안이다. `fanStrike` 는 `spawnBullet` 이 배열 말미에 append 하는 형태라
 *    안전하다(액티브 핸들러가 같은 자리에서 이미 쓰던 경로다) — 그 밖의 직접 push 는 금지.
 *  - ⚠️ **파열을 재귀시키지 마라.** 여기서 `aux0` 을 0 으로 만들어도 파열은 다시 안 돈다.
 *  - **RNG 를 소비하지 마라**(공통 계약).
 *
 * ## ⚠️ 촉매를 부르지 않는다
 * 이 앵커는 **한 기체의 시그니처 사건**이라 촉매 48종에 대응 카드가 없다. 훗날 파열 반응
 * 촉매가 생기면 `onFilmBurstCatalyst` 를 여기 붙여라 — 지금 빈 함수를 미리 두면 "배선이
 * 있다" 는 착각을 만든다(이 저장소의 재발 패턴).
 *
 * @param x 파열 중심 x
 * @param y 파열 중심 y
 */
export function onFilmBurst(
  state: WorldState,
  x: number,
  y: number,
  params: FilmBurstParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_BUBBLE_FILM: {
      // PO1 파열 탄두 · PO3 거품 산탄 파열 · PO7 정전 파열 · DR1 역류 수거 · DR6 파열 추진 ·
      // FI1 조기 응결 · FI5 파열 위상 · FI10 정화 파열.
      //
      // ✅ **FI7(벽면 반향)은 배치6 에서 배선됐다.** 종전 사유(*"훅이 밀어내기 산술 바깥이라
      //    값을 건넬 길이 없다"*)는 이 앵커가 {@link FilmBurstParams} 를 넘기면서 해소됐다 —
      //    `radius`·`push` **둘 다** 같은 배율로 곱한다(반경만 키우면 "반경 안의 적을 반경
      //    밖으로" 계약이 깨진다).
      // ✅ **PO4(압착 충돌)는 여기가 아니라 `onFilmBurstPost` 다.** 밀어낸 **결과**가 판정이라
      //    이 앵커로는 원리적으로 못 산다(이 훅을 뒤로 옮기면 PO1·PO7·DR1 이 죽는다).
      // ⚠️ **PO8(잔거품 기뢰)은 아직 여기도 저기도 없다.** 스폰 지점은 `onFilmBurstPost` 로
      //    열렸고, 남은 선결은 기뢰 개체 규약(동시 생존 상한 + 컬링 제외 + 접촉 피해)이다 —
      //    사유 전문은 `skills/bubble.ts` 말미의 미배선 주석이 정본이다.
      // ✅ **DR1(역류 수거)은 배선됐다.** `collectGem` 이 `world.ts` 모듈-로컬이라 leaf 에서
      //    부를 수 없다는 종전 사유는 **지금도 참**이고(export 해도 규율 ① 위반, 여기로 올려도
      //    `world.ts → skillHooks.ts` 와 순환), 젬을 직접 지우면 콤보·XP·촉매 경로가 통째로
      //    빠지는 것도 그대로다. 바뀐 것은 **수단**이다 — 젬 좌표를 플레이어 위로 옮겨 정본
      //    픽업 판정이 걷게 했다. 대가는 시그니처 소진 파열 경로에서 수거가 **1틱 늦는다**는
      //    것뿐이고(그 틱의 격자는 옛 좌표로 빌드돼 있다), 사유 전문은 `skills/bubble.ts` 의
      //    DR1 블록 주석이 정본이다.
      //
      // ⚠️ **DR9(이탈 잔파동)은 이 앵커의 대상이 아니다.** 잔파동은 파열이 아니라서
      // (`filmBurst.ts` 의 종류 코드 2) 파열 훅을 태우면 안 된다 — 종류 코드 2 는 아직
      // 소비자가 없어 상수조차 선언돼 있지 않다.
      const p = playerOf(state);
      if (p !== undefined) bubbleFilmBurst(state, p, x, y, params);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑯~㉑ (S2: 전 분기 비어 있음) — **미배선 141종이 몰려 있던 지점 넷**
// ---------------------------------------------------------------------------
//
// S1 이 배선률을 30% → 43% 로 올린 뒤에도 남은 미배선의 대부분은 "고쳤는데 안 불린다" 가
// 아니라 **그 지점에 앵커가 없다** 였다. 7기체 1차 배선(69/210)이 미배선 사유를 기록해 둔
// 결과, 141종이 소수의 지점에 몰려 있음이 드러났다. 이 여섯이 그 넷을 연다:
//
//   ⑯ onVolleyParams   — 발사부(전 기체 최다). 스트라이커 3 · 아크캐스터 5 · 브루저 4 ·
//                        말로우 4 · 팬텀 3 · 버블 2 가 같은 이유로 막혀 있었다.
//   ⑰ onFilmEfficiency — 막 흡수 **효율**(버블). 앵커 ⑧ 은 막보다 앞이라 못 온다.
//      ⚠️ 구 이름 `onFilmShield`(유효 **내구** 반환)는 원리적으로 무효였다 — 사유는 그 함수 doc.
//   ⑱ onFilmAbsorbed   — 막 흡수 **직후**(버블 관측축).
//   ⑲ onCushionThreshold — 정산 **임계**(말로우 ME9 · CU7 분모).
//   ⑳ onCushionSettled — 정산 **직후**(말로우 9종). 앵커 ⑨ 는 진입점이라 정산보다 앞이다.
//   ㉑ onCloakBreakReset — 팬텀 스트릭 리셋 **직전**(DI1 · PH10).
//
// S3 가 여기에 하나를 더 얹었다 — **지점이 아니라 진입 술어가 막고 있던 축**이다:
//
//   ㉒ onFilmEntry     — 막 흡수 분기의 **진입 술어 직전**(버블 FI9). ⑰⑱ 은 둘 다 호출부
//                        게이트(`aux0 > 0`) **안**이라 *막이 없는* 피격을 원리적으로 못 본다.
//                        "막이 없는데 치명" 은 그 게이트 **앞**에서만 관측된다.
//
// ## ⚠️ 왜 넷이 아니라 여섯인가 — pre/post 로 쪼갠 이유
// 막 흡수와 정산은 **산술에 개입하는 축**과 **사건을 관측하는 축**이 한 지점에 겹쳐 있다.
// 하나로 두면 앵커 ⑮ 가 실제로 밟은 함정을 되풀이한다: 파열 훅을 밀어내기 **뒤**에 두었더니
// 밀어내기 변위(260) > 파열 반경(220) 이라 반경 술어로 대상을 고르는 스킬이 **조용히 0 건**이
// 됐다. **"그 지점에서 관측 대상이 아직 살아 있는가" 를 앵커마다 따로 물어야 한다** —
// 흡수 전의 `aux0`(안 닳음)과 흡수 후의 `aux0`(닳음)은 다른 값이고, 둘 다 필요하다.
//
// ## ⚠️ 촉매 짝이 없다 — ⑮ 와 같은 성질이다
// ⑰~㉑ 은 **한 기체의 시그니처 사건**(버블 막 · 말로우 완충 · 팬텀 은신)이라 촉매 48종에
// 대응 카드가 없다. ⑯ 은 전 기체 공통이지만 촉매의 발사 축은 앵커 ① 의 `onVolleyFiredCatalyst`
// 가 이미 잡고 있다. **지금 빈 촉매 함수를 미리 두지 마라** — "배선이 있다" 는 착각을 만든다
// (⑮ 주석이 못 박은 이 저장소의 재발 패턴). 필요해지면 그때 붙여라.

// ---------------------------------------------------------------------------
// 앵커 ㉓·㉔ (S3-4) — **해츨링 출격 지점**(`world.ts` 의 `stepHatchBrood`)
// ---------------------------------------------------------------------------
//
//   ㉓ onBroodLaunchParams — `stepHatchBrood` **최상단**(임계 조기 반환보다 앞). 이번 틱의
//                            임계·상한·출격 기수 세 칸을 레코드로 넘긴다.
//                            BD1(임계 −) · BD10(상한 −1) · SH10(상한 +1·임계 +) ·
//                            BD2(기수 2) · NU10(보류 적립·선납).
//   ㉔ onBroodLaunched     — 병아리 **1기가 실제로 태어난 직후**(기당 1회, 개체를 넘긴다).
//                            BD6(출격 충격파) · NU2(알껍질 젬) · NU7(출격 좌표 이전).
//
// 이 여덟이 해츨링 미배선 21종 중 첫 묶음이고(`skills/hatchling.ts` 헤더 사유 1묶음),
// **S2 로 하나도 안 풀린 유일한 묶음**이었다 — 앵커 ⑨ 는 `stepShipSignature` 진입점이라
// `stepHatchBrood` 보다 앞이고, 그 시점에는 출격 여부도 좌표도 아직 없다.
//
// ## ⚠️ 왜 하나가 아니라 pre/post 둘인가 — ⑰~⑳ 과 같은 성질이다
// 여덟 종이 한 함수 안에 몰려 있지만 **관측 대상이 살아 있는 시점이 서로 다르다.** 임계·상한을
// 고치는 다섯은 조기 반환 **앞**이 아니면 영영 0 건이고(반환 뒤에 두면 임계를 넘긴 틱에만
// 불려 BD1 이 임계를 낮출 기회가 원리적으로 없다), 좌표·부수효과 셋은 병아리가 태어난 **뒤**가
// 아니면 출격 좌표를 알 수 없다. 하나로 합치면 둘 중 하나가 반드시 죽는다.
//
// ## ⚠️ 촉매 짝이 없다 — ⑮·⑰~㉑ 과 같다
// 출격은 **해츨링 시그니처 고유 사건**이라 촉매 48종에 대응 카드가 없다. 빈 촉매 함수를 미리
// 두지 마라.
//
// ## ⚠️ 이 둘만으로는 BD10 이 반쪽이었다 — **㉖ 이 세 번째 축**이다
// 상한 −1 은 ㉓ 이고 수명 가산은 ㉔ 인데 **탄 피해 배율**은 포탑 루프 소관이라 둘 다 안 닿아,
// 앞 레인이 BD10 을 통째로 미배선으로 남겼다(상한만 깎으면 순손해). W2 가 세운 앵커 ㉖
// (`onTurretShotParams`, 이 파일 말미)이 그 축이다 — **셋을 함께 봐야 BD10 이 성립한다.**

/**
 * 앵커 ⑯ 이 넘기는 **이번 볼리의 파라미터 한 벌**. 훅이 제자리에서 고친다.
 *
 * ## 왜 인자 나열이 아니라 레코드인가
 * 이 지점을 기다리던 스킬 21종이 고치려는 필드가 서로 다르다(탄수·간격·피해·관통·탄속·수명·
 * 확산·표식). 인자로 늘어놓으면 앵커 시그니처가 배선이 진행될 때마다 바뀌고, 그때마다 7 기체
 * 모듈이 전부 다시 컴파일된다. 레코드는 필드를 더해도 기존 case 가 그대로 선다.
 *
 * ## ⚠️ 각 필드는 **아키타입 분기가 실제로 읽는 값**이다 — 무기 원본이 아니다
 * `state.weapon` 을 고치지 마라. 그것은 런 전체의 정본이고 여기서 만지면 이번 볼리가 아니라
 * **이후 모든 볼리**가 바뀐다. 이 레코드는 이번 볼리 한 번으로 수명이 끝난다.
 */
export interface VolleyParams {
  /** 발당 피해. 과충전·은신 해제·정조준 배율이 **이미 반영된** 값이다. */
  damage: number;
  /** 관통 예산. 정조준 보너스가 이미 반영돼 있다. ⚠️ 빔은 이 값을 쓰지 않는다(아래 주석). */
  pierce: number;
  /** 부채꼴 발사 수. ⚠️ 레일건·빔은 이 값을 쓰지 않는다. */
  count: number;
  /** 탄속. ⚠️ 빔 세그먼트는 정지(0)라 이 값을 쓰지 않는다. */
  speed: number;
  /** 탄 반경. ⚠️ 빔 세그먼트는 전용 상수를 쓴다. */
  radius: number;
  /** 탄 수명(틱). ⚠️ 빔 세그먼트는 전용 상수를 쓴다. */
  life: number;
  /** 부채꼴 총 각도(rad). ⚠️ 레일건·빔은 이 값을 쓰지 않는다. */
  spread: number;
  /** 이번 발사 뒤 더할 쿨다운(Q 단위). 전 아키타입이 공통으로 쓴다. */
  cooldownQ: number;
  /**
   * **읽기 전용 사실** — 이번 볼리의 아키타입이 `count`(와 `spread`)를 실제로 읽는가.
   * 발칸/스프레드·미사일 = `true`, 레일건·빔 = `false`.
   *
   * ## 왜 훅이 `weaponType` 을 직접 보지 않는가
   * 아래 표가 경고하는 「안 읽히는 필드를 고치면 조용히 무연산」은 **탄수 축 스킬에서 무연산을
   * 넘어 손해**가 된다: 탄수와 간격을 함께 바꾸는 교환형 스킬(아크캐스터 BA10)이 레일건·빔에
   * 실리면 탄수는 그대로인데 간격만 늘어 **순손실**이 된다. 그 판정을 기체 모듈마다 하려면
   * `WEAPON_TYPE_*` 값이 `world.ts` 밖으로 복제돼야 하고(이 저장소가 금지한 값 복제),
   * 복제본이 갈리는 순간 결함은 조용하다. 그래서 **판정 결과만** 여기 싣는다 — 정본은
   * `world.ts` 의 아키타입 분기 하나뿐이다.
   *
   * ⚠️ 훅이 이 값을 **쓰지 마라**(읽기 전용). 고쳐도 아키타입 분기는 안 본다.
   */
  countUsed: boolean;
  /**
   * **읽기 전용 사실** — 이번 볼리의 아키타입이 **탄도 파라미터**(`speed`·`life`·`radius`·
   * `pierce`)를 실제로 읽는가. **빔만 `false`** 이고 나머지 셋은 `true` 다.
   *
   * ## 왜 필요했는가 — `countUsed` 와 **같은 종류의 손해**가 여기서도 났다
   * 빔은 정지 세그먼트(`speed 0`)에 전용 반경·수명·관통 9999 를 쓰므로 이 넷을 한 칸도 안
   * 읽는다. 그래서 **탄속·수명을 대가로 피해를 올리는 교환형 스킬**(브루저 BL6 중량 탄자:
   * 피해 `+`, 탄속 `×0.5`, 수명 `×2`)이 빔에 실리면 **페널티만 통째로 증발하고 이득만 남는다.**
   * 무연산이 아니라 **일방적 이득**이라 밸런스가 조용히 깨진다.
   *
   * `countUsed` 와 같은 사유로 **판정 결과만** 싣는다 — 기체 모듈이 `WEAPON_TYPE_BEAM` 을
   * 복제해 스스로 판정하면 그 복제본이 갈리는 순간 결함이 조용해진다. 정본은 `world.ts` 의
   * 아키타입 분기 하나뿐이다.
   *
   * ⚠️ 훅이 이 값을 **쓰지 마라**(읽기 전용).
   */
  ballisticsUsed: boolean;
  /**
   * 자동 조준이 고른 **표적까지의 거리**(sim 좌표). 이 볼리가 실제로 겨눈 그 표적이다.
   *
   * ## 왜 레코드에 싣는가
   * 거리를 술어로 쓰는 스킬(브루저 BL2 백병 격발 — 근접 볼리 증폭)이 훅 안에서 최근접 적을
   * **다시 고르면** 조준 선택 규칙(`nearestTarget`)의 **두 번째 사본**이 생긴다. 그 함수는
   * `world.ts` 소유라 leaf 가 런타임 import 할 수도 없다(계약 위반). 그래서 world 가 이미
   * 고른 결과의 거리만 넘긴다.
   *
   * ⚠️ **`0` 이 될 수 없다고 가정하지 마라** — 적이 플레이어에 겹쳐 있으면 0 에 임의로 가깝다.
   * ⚠️ 훅이 이 값을 **쓰지 마라**(읽기 전용). 표적은 이미 확정됐다.
   */
  targetDist: number;
  /**
   * 자동 조준이 실제로 고른 **발사 방위**(rad, `atan2(target.y - player.y, target.x - player.x)`).
   * 이 볼리의 부채꼴이 실제로 펼쳐지는 중심축이고, 레일건·빔은 이 방위 그대로 한 발/한 줄이다.
   *
   * ## ⚠️ `player.angle`(조준각)로 대용하지 마라 — 두 값은 갈릴 수 있다
   * 조준각은 입력·관성이 정하고, 발사 방위는 `nearestTarget` 이 고른 표적이 정한다. 표적이
   * 없는 방향을 조준각이 가리키는 순간이 있고 **그 어긋남은 조용하다** — 화면에도 테스트에도
   * 흔적을 안 남긴다. 그래서 이 칸이 생겼다.
   *
   * ## 왜 레코드에 싣는가
   * 방위를 술어로 쓰는 두 스킬이 이 값을 요구했다:
   *  · 스트라이커 F5(조준선 관통) — *"표적이 `player.angle` 기준 반각 20° 콘 안인가"*.
   *    **정확히 이 값의 부재로** 미배선이었고, 이 칸이 서자 배선됐다.
   *  · 말로우 SQ7(관성 사출) — *"그 틱 입력 벡터와 발사각의 내적"*.
   *    ⚠️ **이 칸만으로는 열리지 않았다** — 내적의 나머지 한 항인 입력 벡터가 통째로
   *    부재했기 때문이다(`autoAttack` 이 `InputFrame` 을 인자로 받지 않았고 `WorldState` 에
   *    그 틱 입력 보관도 없었다). 실제로 SQ7 을 막고 있던 것은 **발사각이 아니라 입력 배관**
   *    이었다. W2 레인이 `autoAttack` 에 `input` 을 더해 {@link VolleyParams.inputX}·
   *    {@link VolleyParams.inputY} 를 실었고, 두 항이 모두 선 뒤에야 SQ7 이 배선됐다.
   * 훅이 최근접 적을 **다시 고르면** `nearestTarget` 선택 규칙의 **두 번째 사본**이 생기고,
   * 그 함수는 `world.ts` 소유라 leaf 가 런타임 import 할 수도 없다(계약 위반). `targetDist`
   * 와 같은 사유로, world 가 이미 고른 결과만 넘긴다.
   *
   * ⚠️ 훅이 이 값을 **쓰지 마라(읽기 전용)**. 성질이 `targetDist`·`countUsed` 와 **다르다** —
   * 그 둘은 고쳐도 아키타입 분기가 안 보므로 최악이 무연산이지만, 이 칸은 아래 분기가
   * `volley.aimAngle` 을 **실제로 읽어** 발사 방향으로 쓴다. 고치면 탄이 정말 돌아간다.
   * 발사 방향을 트는 축은 표적 선택 자체를 건드리는 일이라 이 레인의 몫이 아니다 — 쓰기를
   * 열면 거동 불변 증명이 성립하지 않으므로, S3-1 은 **자리만** 만들고 읽기 전용으로 둔다.
   */
  aimAngle: number;
  /**
   * 이 틱의 **이동 입력 벡터**(`InputFrame.moveX`/`moveY` 원본, 각 축 [-1,1]). 정규화 **전**
   * 이라 길이가 0(무입력)일 수 있고, 대각 입력은 축당 √2/2 근처다.
   *
   * ## 왜 레코드에 싣는가 — `autoAttack` 이 `InputFrame` 을 아예 못 보고 있었다
   * 이 sim 의 유일한 외부 영향은 `InputFrame` 인데, 발사부 `autoAttack(state, player)` 은 그
   * 인자를 받지 않았고 `WorldState` 에 그 틱 입력을 보관하는 칸도 없었다. 그래서 *"그 틱 입력
   * 벡터와 발사각의 내적"* 을 술어로 쓰는 **말로우 SQ7(관성 사출)** 이 `aimAngle` 이 선 뒤에도
   * 열리지 않았다 — 내적의 한 항이 통째로 부재했다. 이 레인이 `autoAttack` 에 `input` 을 더해
   * 배관하고, `targetDist`·`aimAngle` 과 같은 형태로 **결과만** 여기 실었다.
   *
   * ## ⚠️ `player.vx`/`vy`(실속도)로 대용하지 마라
   * 감속 장판·이속 모듈·넉백·대시가 실속도를 갈아 놓아 "플레이어가 무엇을 지시했는가" 와
   * 갈린다. 인벤토리 1.5 계약 「상태 판정은 입력으로」가 그 사유이고, 아크캐스터 정지 판정
   * (`input.moveX === 0 && input.moveY === 0 && !input.dash`)도 같은 정본 규칙을 쓴다.
   *
   * ⚠️ 훅이 이 값을 **쓰지 마라**(읽기 전용). 이 레코드는 이번 볼리 한 벌의 수명이고, 여기서
   * 고쳐도 `InputFrame` 원본도 리플레이 기록도 바뀌지 않는다 — 조용한 무연산이 된다.
   */
  inputX: number;
  /** 이 틱의 이동 입력 Y. 성질·주의는 {@link VolleyParams.inputX} 와 같다(읽기 전용). */
  inputY: number;
  /**
   * 이번 볼리가 **팬텀 은신 해제 첫 타**인가(배율이 실제로 실린 볼리).
   *
   * ## 왜 필요했는가
   * 소진은 이 앵커보다 **앞**에서 일어나고(`world.ts` 의 팬텀 배율 분기가 `setBreakToken(…, 0)`
   * 으로 토큰을 지운다), 소진 분기는 표식을 남기지 않는다. 그래서 앵커에 도달한 시점에는
   * *"방금 그 강화탄이었는가"* 를 알 신호가 **하나도 없었다** — 팬텀 AS3(처형 재장전)이 정확히
   * 그 이유로 미배선이었다. `params.mark === 1` 은 스트라이커 정조준 전용이라 대용할 수 없다.
   *
   * 이 값이 서면 AS3 은 ⑯ 에서 자기 표식을 찍고 앵커 ⑩ 에서 회수하면 된다 — ⑩ 은 `source`
   * (가해 아군탄)를 넘기고 `target.dead` 가 **이미 확정**이라 "그 탄으로 죽였다" 가 성립한다.
   *
   * ⚠️ **침공에서는 항상 `false`** 다. 소진 분기 자체가 침공에서 통째로 게이트된다(억제를 걸 수
   * 없는데 배율만 남으면 팬텀이 공짜로 강해지기 때문 — 그 분기 주석이 근거).
   * ⚠️ 훅이 이 값을 **쓰지 마라**(읽기 전용). 소진은 이미 끝났다.
   */
  cloakBreak: boolean;
  /**
   * 이번 볼리로 태어나는 **모든 탄의 `aux0` 에 찍을 표식**(0 = 안 찍는다).
   *
   * ## ⚠️ 이 칸은 이미 점유돼 있다 — 값 공간을 나눠 써라
   * `1` 은 **정조준탄**(스트라이커)이 쓴다. S2 가 그 대입을 이 필드로 흡수했으므로 표식 경로는
   * 이제 한 곳뿐이다 — 아키타입 분기 네 곳에 흩어져 있던 `if (marksmanFire) b.aux0 = 1` 이
   * 사라졌다. 다른 기체가 표식을 쓰려면 **1 이 아닌 값**을 골라라(기체는 한 런에 하나뿐이라
   * 충돌하지 않지만, 값이 겹치면 렌더·후속 판정이 두 표식을 구분하지 못한다).
   *
   * ⚠️ `ownerId` 를 쓰지 마라 — `MISSILE_MARK`·`BROOD_MARK`·`SPLIT_FRAGMENT_MARK` 가 이미
   * 점유했고, 미사일 분기는 표식과 유도 마커를 **동시에** 단다.
   */
  mark: number;
  /**
   * **선두탄에만** 더할 피해(0 = 없음). 나머지 탄은 `damage` 그대로다.
   *
   * ## 왜 이 칸이 필요했는가 — `damage` 로는 「1발」을 표현할 수 없다
   * 브루저 BL8「격돌 담금질」은 *"적립분을 소모해 **선두탄**이 대구경화"* 다. 적립 단위가
   * **접촉 피격 1회 = 강화탄 1발**이라 볼리 전체에 실으면 부채꼴 무기에서 `count` 배로 부풀고,
   * `damage`·`pierce` 는 아키타입 분기 넷이 전부 **모든 탄에** 그대로 넘긴다. 그래서 선두탄
   * 전용 칸을 따로 연다 — 값이 0 이면 `damage + 0`, `pierce + 0` 이라 **바이트 불변**이다.
   *
   * ## 「선두」의 정의(아키타입별)
   *  · 레일건 — 유일한 그 한 발. · 미사일·부채꼴 — `i === 0`(부채 시작단).
   *  · 빔 — `i === 1`, 즉 플레이어에 **가장 가까운** 세그먼트.
   *
   * ⚠️ 부채꼴 분기의 ⑦ 쌍둥이 항성 배율은 `damage` 에만 실린다 — 이 보너스는 훅이 계산한
   * 값 그대로 더해진다(유니크 배율이 스킬 보너스까지 증폭하지 않는다).
   */
  leadDamageBonus: number;
  /**
   * **선두탄에만** 더할 관통(0 = 없음). {@link leadDamageBonus} 와 같은 규율이다.
   *
   * ⚠️ 빔은 관통을 리터럴 9999 로 쓰므로 이 칸이 **무연산**이다(`ballisticsUsed === false`).
   * BL2 가 같은 자리에서 같은 판단을 했다 — 관통 무연산은 아키타입 정의이지 결함이 아니다.
   */
  leadPierceBonus: number;
  /**
   * 이번 볼리로 태어나는 **모든 탄의 `aux1` 에 자기 발사 시점 피해**(`round(damage)`)를
   * 새길 것인가. `false` 면 한 칸도 안 쓴다(`aux1` 은 0 그대로 → 리플레이 바이트 불변).
   *
   * ## 왜 `damage` 를 훅이 직접 안 읽고 이 플래그를 두는가
   * 이 레코드의 `damage` 는 **아키타입 분기에 들어가기 전** 값이라 발당 최종 피해가 아니다 —
   * 쌍둥이 항성(`TWIN_STAR_DAMAGE_MULT`)이 발칸/스프레드 분기 안에서 한 번 더 곱한다. 훅이
   * `params.damage` 를 그대로 저장하면 그 배율만 조용히 빠진다. 그래서 **저장 시점을 탄이
   * 태어난 직후로 미루고**, 훅은 "새겨라" 만 말한다(`countUsed` 가 아키타입 판정을 world 에
   * 두고 결과만 실은 것과 같은 방향, 쓰기/읽기만 반대다).
   *
   * ## 왜 `damage` 를 나중에 다시 읽으면 안 되는가 — 이 칸의 존재 이유
   * 탄의 `damage` 는 **비행 중에 갱신된다**(아크캐스터 CH6 이월 가산 · CH8 관통 증폭). 소멸
   * 시점에 그 값을 읽으면 발사 시점 기준이 아니라 **재증폭된 값**이 된다. CH3「종말점 방전」
   * 이 정확히 그 구분을 요구했다(설계서 「폭발 피해 기준 정의」).
   *
   * ⚠️ **`aux0` 표식(`mark`)과 칸이 다르다** — 둘은 같은 탄에 공존할 수 있어야 한다
   * (CH1·CH8 표식 + CH3 기준 피해). 'bullet' kind 는 `aux1` 을 어디서도 읽지 않는다(전수 확인).
   */
  recordSpawnDamage: boolean;
  /**
   * 이번 볼리로 태어나는 모든 탄의 `targetX` 에 **발사 시점 잔여 수명**(`life`)을 새길
   * 것인가. `false`/미지정이면 한 칸도 안 쓴다(`targetX` 는 0 그대로 → 리플레이 바이트 불변).
   *
   * ## ⚠️ 「발사 좌표」가 아니라 「발사 시점 수명」을 새긴다 — 자기 표식이 되기 때문이다
   * 아크캐스터 CH5「전위차 저격」이 요구한 것은 *"멀리 비행한 뒤 명중했는가"* 인데, 탄에는
   * 비행거리도 발사 좌표도 실린 칸이 없었다. 좌표 두 칸(`targetX`/`targetY`)을 쓰는 안이
   * 먼저 나왔지만 **「각인됐는가」를 구분할 표식이 없다** — 좌표 `(0,0)` 과 "안 새김"이 같은
   * 값이라, CH4 부채탄·분열 파편·보조무기처럼 이 경로를 안 지나는 탄이 *원점에서 발사된 탄*
   * 으로 오독된다. 잔여 수명은 스폰 시 **항상 양수**라 `targetX > 0` 자체가 표식이 되고,
   * 비행 비율 `(life0 − life) / life0` 은 무기별 사거리에 자동으로 정규화된다(월드 유닛
   * 임계값을 상수로 박지 않아도 된다).
   *
   * ## ⚠️ 이 칸은 **아군탄에서만** 비어 있다 — 적탄에 새기지 마라
   * `targetX`/`targetY` 는 적탄에서 거동 파라미터 A/B(가속도·선회율·각가속도)이고
   * (`bullets.ts` 의 `applyBehavior`), 보스에서는 나선 기준각이다(`boss.ts`). 이 플래그의
   * 소비처는 `autoAttack` 의 아키타입 분기뿐이고 거기서 태어나는 것은 `spawnBullet`
   * (**아군탄 전용 팩토리**)의 산물이라 구조적으로 닿지 않는다. 읽는 쪽(앵커 ⑱)도
   * `bullet.kind === 'bullet'` 을 **첫 줄에서** 다시 확인한다.
   *
   * ⚠️ **빔은 no-op 이다** — 세그먼트는 제자리에 놓이고 비행하지 않으므로 "얼마나 날았나"가
   * 정의되지 않는다. 각인하면 *시간이 지났을 뿐인* 정지 세그먼트가 「멀리 비행」으로 세어진다.
   * BA10 이 빔을 no-op 으로 둔 것과 같은 사상이다(아키타입 정의이지 미배선이 아니다).
   *
   * ⚠️ **선택 필드다.** 필수로 만들면 7기체 픽스처가 `Partial` 스프레드로 깨진다(배치 1 실측).
   */
  recordSpawnOrigin?: boolean;
}

/**
 * 앵커 ⑯ — **볼리 파라미터가 확정된 직후 · 탄이 태어나기 직전**(`autoAttack`).
 *
 * ## 앵커 ① 과 무엇이 다른가 — **① 을 옮기지 않은 이유**
 * ① `onVolleyFired` 는 *"이번 틱에 반드시 발사한다"* 가 확정된 계측 지점이고 이미 그 용도로
 * 쓰이고 있다(해츨링 BD5). 하지만 ① 은 **무기 아키타입 분기보다 앞**이라 탄이 아직 없고
 * `bulletCount`/`fireCooldownQ` 도 안 읽혔다 — 두 기체에서 8종이 정확히 그 이유로 막혔다.
 * ① 을 뒤로 옮기면 그 계측의 의미(조기 반환에 걸린 틱을 배제한다)가 조용히 달라진다.
 * 그래서 **새 앵커로 추가**했다. 둘은 같은 틱에 ① → ⑯ 순으로 연달아 불린다.
 *
 * ## 무엇이 보장되는가
 *  - 전 필드가 **아키타입 분기가 실제로 읽을 값**으로 채워져 있다. 여기서 고치면 그대로 반영된다.
 *  - 시그니처 배율(과충전·은신 해제 첫 타·정조준)이 **이미 `damage` 에 반영**돼 있다. 다시
 *    곱하지 마라 — 두 배가 된다.
 *  - 스트라이커 정조준 카운터(`player.aux0`)는 **이미 갱신됐다**. 이 지점의 값은 *다음* 볼리를
 *    가리킨다 — "이번 볼리가 정조준이었는가" 는 `params.mark === 1` 로 봐라.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **`state.weapon` 을 고치지 마라**(위 레코드 주석). 이번 볼리가 아니라 런 전체가 바뀐다.
 *  - ⚠️ **`count` 를 무제한으로 키우지 마라.** 부채꼴은 `count` 만큼 `spawnBullet` 을 돌리고,
 *    탄은 청크 예산(`MAX_ACTIVE_GIMMICKS = 160`, `chunks.ts:55`)과 같은 배열에 산다.
 *  - ⚠️ **`cooldownQ` 를 0 이하로 만들지 마라.** `player.cooldown += cooldownQ` 라 음수면
 *    잔여분 carry(소수 주기를 정수 산술로 재현하는 장치)가 단조성을 잃고 매 틱 발사가 된다.
 *  - **RNG 를 소비하지 마라**(공통 계약).
 *
 * ## ⚠️ 아키타입마다 읽는 필드가 다르다 — 안 읽히는 필드를 고쳐도 조용히 무연산이다
 * | 아키타입 | 읽는 필드 |
 * |---|---|
 * | 레일건 | `damage` · `pierce` · `radius` · `speed` · `life` · `mark` · `cooldownQ` |
 * | 미사일 | 위 전부 + `count` · `spread` |
 * | 빔 | `damage` · `mark` · `cooldownQ` **뿐**(관통 9999 · 정지 · 전용 반경/수명은 리터럴) |
 * | 발칸/스프레드 | 전부 |
 * 빔의 관통 리터럴 9999 를 `pierce` 로 갈아 끼우지 않은 것은 의도다 — 그 값은 "빔 선분은 겹친
 * 적을 전부 때린다" 는 아키타입 정의이지 무기 스탯이 아니다(호출 지점 주석이 근거).
 */
export function onVolleyParams(
  state: WorldState,
  player: Entity,
  params: VolleyParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // 레인은 자기 `case SIG_*:` 한 줄을 여기에 넣는다. **`break;` 를 반드시 붙여라** —
    // 병렬 배선 머지에서 fallthrough 가 누적 4건 나왔고 전부 `tsc TS7029` 만이 잡았다.
    case SIG_ARC_OVERCHARGE:
      // CH1·CH8 과충전 발사 표식 · CH3 발사 시점 기준 피해 각인 · BA7 장전 소비(탄수) ·
      // BA10 탄수 ×2 + 간격 배율.
      //
      // ⚠️ **CH3「종말점 방전」은 이 앵커와 앵커 ⑥ 에 걸쳐 있다.** 기준 피해를 탄에 새기는
      // 것이 여기(`recordSpawnDamage`)이고, 폭발이 터지는 자리는 `onBulletExpired(..., 'life')`
      // 다. ~~막혀 있던 사유~~ 는 근거로 남긴다: 그 스킬의 트리거는 **탄 수명 만료 소멸**인데
      // S3-2 이전의 앵커 ⑥ 은 **관통 예산 소진** 분기 하나뿐이었다(그 앵커 주석이 "수명
      // 만료·화면 밖 컬링이 아니다" 라고 명시). 소비처가 없는 동안 표식만 달면 반쪽 배선이라
      // 손대지 않았던 것이고, 이제 양쪽이 다 섰다.
      arccasterVolleyParams(state, player, params);
      break;
    case SIG_STRIKER_MARKSMAN:
      // F2 반동 전달(대시 직후 창 = 집속·가속·증폭) · S8 콤보 차폐의 **뒤 절반**(정조준 볼리
      // 발사 틱에 콤보 유지 창을 창 절반까지만 회복).
      //
      // ⚠️ S8 의 창 회복은 앵커 ① 이 아니라 **여기** 다. ① 의 주석은 그 자리를 가리키고 있었지만,
      // ① 은 스트라이커 카운터 갱신 **뒤**라 `player.aux0` 이 이미 *다음* 볼리를 가리켜
      // "이번 볼리가 정조준이었는가" 를 직접 못 읽는다. ⑯ 은 그 판정을 `params.mark === 1` 로
      // 싣고 있고(그 필드의 정본이 정조준 표식이다), 같은 술어를 두 곳에 적으면 조용히 갈린다.
      //
      // ⚠️ **F5(조준선 관통)는 이제 여기 있다** — S3-1 이 실은 `params.aimAngle` 을 술어로만
      // 읽는다(조준각과의 각도 차를 `wrapAngle` 로 정규화해 반각 20° 콘 판정). ~~막혀 있던
      // 사유~~ 는 근거로 남긴다: 이 레코드에 표적 **방위**가 없고 `targetDist` 는 거리뿐이었다.
      //
      // ⚠️ **F10(연장 탄창)은 여전히 없다** — ⑯ 으로도 안 닿는다. 볼리를 **하나 더 낳아야**
      // 하는데 이 앵커는 이번 볼리 한 벌의 파라미터만 준다. 사유 전문은 효과 함수
      // `strikerVolleyParams` 의 doc 주석에 있다.
      strikerVolleyParams(state, player, params);
      break;
    case SIG_PHANTOM_CLOAK:
      // AS2 은막 침투 — 은신 창 동안 발사한 탄에 관통 +1 · 탄속 증가.
      //
      // AS3 처형 재장전 — 강화탄 표식(`mark`) + 관통 계단. 실효(토큰 재장전)는 앵커 ⑩ 이다.
      //
      // ⚠️ AS10(유령 탄도)은 아직 여기 없다 — `mark` 를 찍을 수는 있으나 **읽는 자리가 없다**.
      //    설계서가 지정한 소비처 셋(차단 판정 · 파괴가능 벽 피해 · 표적 선택의 `segmentBlocked`)
      //    이 전부 `world.ts` 의 비-앵커 지점이라 표식만 남는 무연산이 된다.
      //
      // AS3 을 막던 사유는 근거로 남긴다: **이 앵커가 `aux1` 소진(`world.ts` 팬텀 배율 분기)
      // 뒤**라 이번 볼리가 그 강화탄인지 알 신호가 여기 없었다(소진 분기가 표식을 남기지 않고
      // `params.mark === 1` 은 스트라이커 정조준 전용이다). **막는 것은 이 한 가지뿐이었다** —
      // 처치 판정 쪽은 처음부터 열려 있었다(앵커 ⑩ 은 `source` 를 넘기고 `target.dead` 가 이미
      // 확정이다). 그 주석이 지목한 값싼 길 — *소진 분기에서 지역 플래그를 세워 `VolleyParams`
      // 에 싣는 것* — 을 S2.1 이 `cloakBreak` 으로 그대로 시공했고, 이 레인이 그것을 쓴다.
      // 사유 전문은 효과 함수 `phantomVolleyParams` 주석에 있다.
      phantomVolleyParams(state, player, params);
      break;
    case SIG_BRUISER_ARMOR:
      // BL2 백병 격발 · BL3 만재 중탄 · BL6 중량 탄자 · **BL8 격돌 담금질(소모처)**.
      // BL3·BL6 은 여기서는 `mark`(+BL6 은 피해·탄속·수명)만 건드리고 실효는 앵커 ⑩ 이 그
      // 표식을 읽어 낸다. BL2 만 이 앵커 안에서 끝난다(`targetDist` 술어 → 관통·피해 직접 증폭).
      //
      // ⚠️ **BL8 은 이제 여기 있다**(W2). 막던 사유는 근거로 남긴다 — 적립처인 접촉 피격 판별이
      // 없었다(앵커 ④ 의 인자가 `dmg`·`lethalSurvived` 뿐이라 피해원을 구분하지 않았다).
      // W2 가 앵커 ④ 에 `sources` 비트합을 실어 적립처를, `leadDamageBonus`·`leadPierceBonus`
      // 로 「선두탄 1발」소모처를 함께 열었다. BL2 를 막던 "표적 거리가 이 레코드에 없다" 는
      // S2.1 의 `targetDist` 로 해소됐다. 사유 전문은 `bruiserVolleyParams` 의 doc 주석에 있다.
      bruiserVolleyParams(state, player, params);
      break;
    case SIG_BUBBLE_FILM:
      // PO2 압력 전환 사출(막 있음 · 탄속 초과분 → 피해) · PO5 만재 투과(만재 · 관통 +1 + 피해).
      //
      // ⚠️ PO2 는 `params.ballisticsUsed` 로 **게이트된다** — 빔은 `speed` 를 안 읽으므로
      // 그 값을 피해로 바꾸면 대가 없는 순이득이 된다(그 필드 주석의 BL6 경고와 같은 형태).
      //
      // ⚠️ 버블의 나머지 볼리 축은 여기 **없다** — PO9(액티브 계수)·PO10(다음 막 내구)은
      // 발사와 무관하고, DR 계열은 자석·이동 축이라 이 레코드에 대응 필드가 없다.
      bubbleVolleyParams(state, player, params);
      break;
    case SIG_MALLOW_CUSHION:
      // SQ1 부채 격노(현재 부채 → 피해 증폭) · SQ8 흉터 포문(누적 선체행 → 피해 증폭) ·
      // SQ5 탕감 장전(잔량 25% 소진). 뒤 둘의 **적립처는 앵커 ⑳** 이고 여기가 소비처다 —
      // 한쪽만 배선하면 "카운터만 돌고 소비처가 없는" 반쪽이 된다.
      //
      // SQ7 관성 사출(그 틱 입력 벡터와 발사각의 내적 → 탄속·피해)도 **여기서 돈다.**
      // 술어의 두 항이 서는 데 두 레인이 걸렸다: **발사각**은 S3-1 이 `params.aimAngle` 로
      // 실었고(`player.angle` 로 대용하면 안 되는 사유는 그 필드 doc), **입력 벡터**는 W2 가
      // `autoAttack` 에 `InputFrame` 을 배관해 `params.inputX/inputY` 로 실었다 — 발사부는
      // 그 인자를 아예 받지 않았고 `WorldState` 에 그 틱 입력 보관도 없었다.
      // ⚠️ 실속도(`player.vx/vy`)로 대용하지 않은 것이 핵심이다(감속·모듈이 속도를 갈아 놓는다).
      mallowVolleyParams(state, player, params);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ㉒ — **막 흡수 분기의 진입 술어 직전.** 이번 피격에 한해 막을 **세울** 수 있다.
 *
 * ## 왜 ⑰ 이 아니라 여기인가
 * ⑰⑱ 은 둘 다 호출부 게이트(`signatureOn(SIG_BUBBLE_FILM) && player.aux0 > 0`) **안**이다.
 * 그래서 *막이 없는* 피격에서는 두 앵커가 **원리적으로 불리지 않는다** — 관측 대상(막 없음)이
 * 그 지점에 아예 도달하지 못한다. 앵커 ⑮ 가 밀어내기 뒤에 놓여 대상을 못 찾았던 것과 같은
 * 형태이고, 해법도 같다: **지점을 게이트 앞으로 옮긴다.**
 *
 * FI9「최후의 거품」의 술어가 정확히 그것이다 — *막이 없는데 이 피해로 죽는다*
 * (`aux0 === 0 && hp - dmg <= 0`, 설계서 버블 ④-FI9). 진입 술어 자체를 넓히는 대신 게이트
 * **앞**에 앵커를 둔 이유는 **거동 불변**이다:
 *  · 게이트를 `aux0 > 0 || 치명` 으로 넓히면 막이 없던 틱에도 분기 본문이 돌고, 그 안의
 *    파열 판정(`if (player.aux0 === 0)`)이 **매 치명 피격마다 참**이 되어 `resolveFilmBurst`
 *    가 터진다 — 파열 훅에 걸린 스킬 9종이 통째로 오발동한다. `Math.round(dmg)` 도 새 경로에서
 *    돌아 소수 접촉 피해가 갈린다.
 *  · 앵커를 앞에 두면 게이트는 **한 글자도 바뀌지 않는다.** S0/S2 에서 이 훅은 아무것도 쓰지
 *    않으므로 `aux0` 이 0 인 채로 게이트에 닿아 종전과 정확히 같은 경로를 탄다(비트 동일).
 *
 * ## 개입 방식 — 반환값이 아니라 `player.aux0` 직접 대입이다
 * 여기서 `aux0` 을 0 → N(>0) 으로 올리면 **바로 다음 줄의 게이트가 열리고** 이후 흡수·파열
 * 흐름이 기존 코드 그대로 돈다(설계서 FI9 「구현: A — 술어 확장 + 기존 필드 2개 대입, 이후
 * 흐름은 기존 흡수·파열 코드 그대로」). 개입이 삼켜지지 않음은 산술로 확인된다:
 * `filmAbsorbed(d, s) = min(d, s)` 이므로 `aux0 = N` 이면 흡수량이 `min(dmg, N) > 0` 이 되어
 * 통과 피해가 실제로 준다 — ⑰ 이 낭비된 이유(`shield` 를 부풀려도 `min` 이 삼킨다)와 반대다.
 *
 * ## ⚠️ 지켜야 하는 것
 *  - **`player.aux0` 은 비음 정수**여야 한다. `aux0` 은 u32 로 해시되므로(`replay.ts`
 *    `hashEntity` 의 `>>> 0`) 음수는 40억대 값으로 접혀 클라와 서버 재실행이 갈리고, 소수는
 *    조용히 잘린다. 게이트 뒤의 차감은 `aux0 -= min(dmg, aux0)` 이라 **여기서 비음 정수를
 *    넣는 한 음수가 되는 경로는 새로 생기지 않는다.**
 *  - `dmg` 는 게이트 안이 쓸 값과 **같게 이미 정수화돼서** 들어온다(호출부가 `Math.round` 한
 *    사본을 넘긴다). 호출부의 `dmg` 자체는 건드리지 않으므로 게이트가 안 열리면 비트 불변이다.
 *  - **`player.hp` 는 아직 한 점도 안 깎였다** — 이 지점은 hp 차감보다 한참 앞이다. 그래서
 *    `hp - dmg <= 0` 이라는 치명 술어가 여기서 성립한다(⑰⑱ 도 같지만 거기는 못 온다).
 *  - 이미 막이 서 있는 피격(`aux0 > 0`)에서도 불린다. **그 경우에 `aux0` 을 쓰면 종전 거동이
 *    갈린다** — 막 없음 전용 스킬은 자기 case 안에서 `player.aux0 === 0` 을 직접 확인하라.
 *
 * @param dmg 브루저 장갑까지 통과한 **정수화된** 피격 피해(= 게이트 안의 `dmg` 와 같은 값)
 */
export function onFilmEntry(state: WorldState, player: Entity, dmg: number): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // ⚠️ **버블 전용 지점이다** — 호출부가 `signatureOn(state, SIG_BUBBLE_FILM)` 안이다.
    // 그래도 `switch` 를 두는 것은 나머지 앵커와 형태를 맞추기 위함이다.
    case SIG_BUBBLE_FILM:
      // FI9「최후의 거품」의 자리가 **여기**다(S3-5 가 자리를 열었고, 이 레인이 배선했다).
      // 설계서대로 셋이 한 번에 들어갔다 — 반쪽 배선이 되지 않게:
      //  ① 술어 `player.aux0 === 0 && player.hp - dmg <= 0`
      //  ② `player.aux0 = floor(aux1 × FILM_ABSORB_FLAT / FILM_PERIOD_TICKS) × (60% + 3%p/Lv)`
      //     — **비음 정수로 자른 뒤** 대입한다(위 ⚠️). 0 이하면 아무것도 쓰지 않는다:
      //     `aux0 = 0` 대입은 무해하지만 `aux1` 만 태우면 대가만 치르고 효과가 없다.
      //  ③ 대가로 `player.aux1 = 0`(재생 진행분 전액 소모).
      // ⚠️ 만재 상한(`FILM_ABSORB_FLAT`)은 설계 산식에 없지만 엔진 불변식이라 `bubbleFilmEntry`
      //    가 건다 — 어긋남의 근거는 그 함수 doc 이 정본이다(문서는 고치지 않았다).
      bubbleFilmEntry(state, player, dmg);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ⑰ — **막 흡수 산술 직전**. 이번 피격에 한해 막의 **흡수 효율**(bp)을 바꾼다.
 *
 * ## ⚠️ 이 앵커는 한 배치 동안 **원리적으로 무효**였다 — 그 사유를 지우지 않는다
 * 종전 계약은 "이번 피격에 쓸 **유효 내구**를 돌려준다" 였고, 그 형태로는 **어떤 스킬도 열 수
 * 없었다.** 근거(배선 레인 실측, ADR-0049 버블 S2):
 *  · 순수 함수가 `filmAbsorbed(d, s) = min(d, s)` 였고 world 가 `aux0 -= absorbed` 를 하므로,
 *    `absorbed ≤ player.aux0` 을 지키려면 `shield ≤ player.aux0` 여야 했다.
 *  · 그런데 `shield` 의 기본값이 이미 `player.aux0` 이다 → 훅은 **낮추는 방향으로만** 유효했다.
 *  · `dmg ≤ aux0` 이면 부풀려도 `absorbed = dmg` 라 **아무것도 안 바뀌고**,
 *    `dmg > aux0` 이면 부풀리는 순간 `aux0` 이 음수가 되어 u32 폴드가 40억대로 접었다.
 * → "내구 1당 막는 피해가 1+α" 는 **흡수량 ≡ 내구 소모량**이라는 구조에서 성립할 수 없었다.
 *   **이 앵커가 살린 스킬은 0종이었다.**
 *
 * ## 무엇이 바뀌었나 — 순수 함수가 *태운 내구*와 *막은 피해*를 분리했다
 * `filmAbsorbed`/`filmRemainingDamage` 가 **효율 인자**를 받는다(`shipSignature.ts` ⑥절).
 * 막을 수 있는 피해 총량이 `내구 × 효율` 이 되고, 태우는 내구는 그것을 효율로 되돌린 값이다.
 * 그래서 효율을 올리면 **막은 피해가 실제로 늘고**(통과 피해가 준다) **태운 내구는 그와
 * 독립적으로** 정해진다 — `min` 이 개입을 삼키던 경로가 끊겼다.
 *
 * 설계축과도 맞다: 버블의 흡수 강화 스킬(DR2 흡수 효율 · FI8 해저드 2배 효율)은 의미상
 * **"이 피격에 한해 막이 두껍다"** 이지 "내구가 늘어난다" 가 아니다(설계서 DR2 문면: *"내구는
 * 늘지 않는다 — 같은 내구로 더 버틴다"*).
 *
 * ## ⚠️ `aux0` 이 음수가 되는 경로는 없다
 * `filmAbsorbed` 의 반환값이 어떤 효율에서도 `player.aux0` 을 넘지 않도록 순수 함수가
 * 자기 안에서 못 박았다(그 doc 이 정본). 그래서 이 훅은 **상한을 걸 필요가 없다** — 종전
 * 계약이 case 마다 요구하던 부담이 구조적으로 사라졌다.
 *
 * @param dmg 브루저 장갑까지 통과한 **정수화된** 피격 피해
 * @param shield 이 피격에 쓸 **실제** 막 내구(= `player.aux0`). 술어용 읽기값이다
 * @returns 흡수 효율(bp). {@link FILM_EFFICIENCY_BASE_BP}(10000)가 항등이고, S2/미투자 런은
 *   그 값을 그대로 돌려주므로 **비트 동일**이다. **양의 정수여야 한다**(0 이하면 막이 아무것도
 *   못 막는다 — 그런 축은 설계에 없다).
 */
export function onFilmEfficiency(
  state: WorldState,
  player: Entity,
  dmg: number,
  shield: number,
  fromHazard: boolean,
): number {
  if (!state.skillsOn) return FILM_EFFICIENCY_BASE_BP;
  void shield;
  switch (state.sigBit) {
    // ⚠️ **버블 전용 지점이다.** 다른 기체는 막이 없어 호출 자체가 일어나지 않는다
    // (호출부가 `signatureOn(state, SIG_BUBBLE_FILM) && player.aux0 > 0` 게이트 안이다).
    // 그래도 `switch` 를 두는 것은 나머지 다섯 앵커와 형태를 맞춰 배선 레인이 규약을
    // 한 번만 익히게 하기 위함이다.
    case SIG_BUBBLE_FILM:
      // FI8「발수 코팅」이 **여기서 돈다**(이 레인이 순수 함수를 개정해 자리를 열었다).
      // ⚠️ 종전 주석은 *"FI8 은 이 앵커만으로 성립하지 않는다 — 이 지점의 `dmg` 가 여러
      //    접촉원의 합류값이라 피해원 종류를 복원할 방법이 없다"* 였다. **그 관측은 옳았고**,
      //    그래서 이 레인은 훅에 `fromHazard` 인자를 추가해 수집 루프가 **max 를 갱신한 그
      //    항목의 출처**를 함께 실어 보내게 했다(설계서 FI8 「구현: A」의 문면 그대로 —
      //    출처 플래그 배열이 아니라 지역 변수 2개). 인자가 없었으면 "해저드에서만" 이
      //    "언제나" 가 되어 설계와 정반대가 됐을 것이다.
      //
      // ✅ **DR2「표면장력 세례」도 여기서 돈다**(배치6 통합). FI8 과 **곱**으로 겹친다 —
      //    설계서 R3-2 가 *"DR2 는 전 출처·유한 창, FI8 은 단일 출처·상시"* 라 곱 중첩이
      //    의도된 설계다.
      //    ⚠️ **이 스킬은 두 번 잘못 닫혔다.** 배치5 는 *"신규 WorldState 정수 + 해시 꼬리
      //    폴드가 선결"*, 배치6 버블 레인은 *"설계서가 「구현: B」로 못 박은 신규 WorldState
      //    정수 1개를 요구한다"* 로 닫았다. 둘 다 「신규 상태가 필요하다」를 「해시가 갈린다」와
      //    같은 말로 읽었는데, 신규 상태의 정본 자리는 `skillSlots.ts` 의 슬롯 배열이고 그
      //    폴드는 16칸이 전부 0 이면 통째로 안 돈다(`replay.ts` 의 `skillSlotAny`).
      //    같은 배치의 DR3 이 그것을 실증한 뒤에도 이 case 의 사유만 갱신되지 않았다.
      //
      // ⚠️ **FI9「최후의 거품」은 여전히 여기 못 온다.** 호출부 게이트가 `player.aux0 > 0`
      //    이라 *막이 없는* 치명 피격에서는 이 훅이 **불리지 않는다.** 그 자리는 앵커 ㉒
      //    (`onFilmEntry`)이고 S3-5 가 열어 이미 배선됐다.
      return bubbleFilmEfficiency(state, player, dmg, fromHazard);
    default:
      break;
  }
  return FILM_EFFICIENCY_BASE_BP;
}

/**
 * 앵커 ⑱ — **막이 실제로 흡수하고 `aux0` 이 닳은 직후**. 파열 판정보다 **앞**이다.
 *
 * ## ⑰ 과 무엇이 다른가
 * ⑰ 은 흡수 산술에 **개입**하고 여기는 그 결과를 **관측**한다. 두 지점의 `player.aux0` 이
 * 다르다 — ⑰ 에서는 한 점도 안 닳았고, 여기서는 이번 피격분이 이미 빠져 있다. 버블의 흡수
 * 반응 스킬(FI3 소거 · FI4 밀어내기 · FI6 누적)은 **얼마나 흡수했는지**가 트리거라 여기다.
 *
 * ## 무엇이 보장되는가
 *  - `absorbed` 는 이번 피격에서 막이 **실제로 태운 내구**다. `player.aux0` 은 이미 그만큼 줄었다.
 *  - `rest` 는 막을 뚫고 **선체로 향하는 피해**다. `0` 이면 막이 전량 흡수했다는 뜻이고, 그
 *    경우 호출부는 무적 창만 세우고 곧 반환한다 — **뒤따르는 피격 후속(장갑 적립·완충 적립·
 *    팬텀 리셋·유니크 발동·앵커 ④)이 통째로 일어나지 않는다.** 여기서 세운 값이 그것들에
 *    소비되리라 가정하지 마라.
 *  - ⚠️ **파열은 아직 판정되지 않았다.** `player.aux0 === 0` 이어도 앵커 ⑮(`onFilmBurst`)는
 *    아직 안 불렸다. 여기서 `aux0` 을 0 이 아닌 값으로 되돌리면 **파열이 통째로 사라진다** —
 *    막 스킬 10종이 걸린 그 사건이다. 되돌리려면 파열을 대체할 근거가 있어야 한다.
 *
 * @param absorbed 이번 피격에서 막이 태운 내구(0 일 수 있다)
 * @param rest 막을 통과해 선체로 향하는 남은 피해
 */
export function onFilmAbsorbed(
  state: WorldState,
  player: Entity,
  absorbed: number,
  rest: number,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_BUBBLE_FILM:
      // FI3 반사 응막(흡수 틱 적탄 소거) · FI4 압력 배출(흡수량 비례 소형 밀어내기).
      //
      // ⚠️ **FI6「헌막 의식」은 여기 없다.** 흡수 누적 자체는 이 앵커가 정확히 잴 수 있지만,
      // 소비처가 `as_bubble_film_hi`(불멸 막) **만료 파열의 폭발 피해**다. 문제가 둘이다:
      //  ① 앵커 ⑮(`onFilmBurst`)는 파열의 **종류를 구분하지 못한다** — 시그니처 소진 파열과
      //     액티브 만료 파열이 같은 `resolveFilmBurst` 를 지나고 요청 슬롯의 종류 코드는
      //     소비 시점에 이미 비워진다. "만료 파열일 때만" 을 잴 신호가 없다.
      //  ② `resolveFilmBurst` 의 기본 파열에는 애초에 **폭발 피해가 없다**(밀어내기뿐).
      //     가산할 대상이 PO1 투자에 의존하면 설계서의 "만료 파열의 폭발" 과 다른 것이 된다.
      // 누적만 세우고 소비를 비워 두면 슬롯 1칸이 영구히 아무것도 안 하는 채 해시에 접힌다 —
      // 반쪽 배선이라 통째로 뒀다.
      bubbleFilmAbsorbed(state, player, absorbed, rest);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ⑲ — **완충 정산의 임계 비교 직전**. 이번 틱에 쓸 임계를 돌려준다.
 *
 * ## 왜 이 앵커가 필요했는가
 * 말로우 ME9「솜틀 요양」은 *정산 임계 자체를 낮추는* 스킬이다. 술어(벽 접촉 60틱)는
 * `state.wallContactTicks` 로 앵커 ⑦ 에서 이미 읽을 수 있었지만 **적용부가 없었다** —
 * 비교식 `aux1 >= CUSHION_RECOVER_TICKS` 는 `world.ts` 의 정산 분기 안이고 거기엔 앵커가
 * 없었다. 그래서 ME9 는 통째로 미배선이었고 CU7 의 분모도 상수 180 에 묶여 있었다.
 *
 * ## ⚠️ 상수를 복제하지 마라 — 기본값을 **인자로 받는다**
 * `CUSHION_RECOVER_TICKS` 를 기체 모듈이 다시 import 해 자기 식을 세우면 정본이 둘이 된다.
 * 이 앵커는 기본값을 넘겨 주므로 case 는 **그 값에서 깎기만** 하면 된다.
 *
 * ## ⚠️ 반환값은 순수 함수와 **함께** 움직여야 한다 — 한 배치 동안 그것이 안 돼 무효였다
 * 종전에는 정산액·회복액을 내는 `cushionSettled`·`cushionRecovered` 가 **자기 안에서**
 * `unhitTicks < CUSHION_RECOVER_TICKS` 를 다시 검사해 0 을 돌려주었다. 즉 이 앵커가 임계를
 * 180 **아래로** 낮춰 `world.ts` 의 분기에 진입시켜도 두 함수가 자기 상수로 다시 걸러
 * **정산액이 0 이 되어 조용히 아무 일도 일어나지 않았다** — 이 저장소의 지배적 실패 형태
 * ("구현했는데 안 도는" 반쪽 배선) 그대로였고, 그래서 ME9 는 통째로 미배선이었다.
 * **그 사유를 지우지 않고 남긴다.**
 *
 * 이 레인이 두 순수 함수를 개정해 **임계를 필수 인자로** 받게 했고(`shipSignature.ts` ⑤절),
 * `world.ts` 가 이 앵커의 반환값을 그 인자로 그대로 넘긴다. 그래서 지금은 임계를 낮추면
 * 정산 시점이 **실제로** 앞당겨진다.
 *
 * @param base `CUSHION_RECOVER_TICKS`. 미투자 런은 그대로 돌려받는다(비트 동일)
 * @returns 이번 틱에 쓸 임계. **양의 정수여야 한다**(0 이하면 매 틱 정산이 된다 — 순수 함수가
 *   자기 안에서 1 로 올려 한 번 더 막지만, 그것에 기대지 마라)
 */
export function onCushionThreshold(
  state: WorldState,
  player: Entity,
  base: number,
): number {
  if (!state.skillsOn) return base;
  void player;
  switch (state.sigBit) {
    // ME9「솜틀 요양」이 **여기서 돈다**(이 레인이 순수 함수 둘을 개정해 자리를 열었다).
    // ⚠️ 종전 주석은 *"여기 case 를 넣지 마라 — 넣어도 안 돈다"* 였다. 그 관측은 옳았고
    //    (사유는 위 doc 에 남겼다), 이 레인이 `cushionSettled`·`cushionRecovered` 를
    //    **임계 인자 필수**로 고쳐 그 사유를 해소했다. 배선 레인이 `tests/skillMallow.test.ts`
    //    §⑫ 로 잠가 둔 "안 돈다" 실증도 이 레인이 함께 갱신했다.
    // ⚠️ CU7 의 감소 분모도 같은 선결에 묶여 있었다 — `mallowSettleThreshold` 를 **한 곳**에
    //    두고 이 앵커와 `mallowDamageChain` 이 **같은 함수**를 부른다. 상수를 복제하지 않는다.
    case SIG_MALLOW_CUSHION:
      return mallowSettleThreshold(state, base);
    default:
      break;
  }
  return base;
}

/**
 * 앵커 ㉘ — **정산의 탕감률이 확정되는 자리**(임계 비교 직후 · 정산액 계산 직전).
 * 이번 정산에 쓸 탕감률(bp)을 돌려준다.
 *
 * ## 왜 앵커가 하나 더 필요했는가 — ⑲ 과 **같은 형태의 선결**이었다
 * 말로우 ME8「리듬 탕감」은 *정산의 탕감 비율을 콤보 스택으로 올리는* 스킬인데, 탕감률
 * `CUSHION_RECOVER_BP` 가 `shipSignature.ts` 의 `cushionRecovered` **안**에 상수로 갇혀
 * 있었다. 그래서 ⑳ 으로도 ㉕ 으로도 닿지 못했다:
 *  - ⑳ 은 hp 차감·hp−1 클램프가 끝난 뒤라, 사후 환급으로 흉내 내면 **클램프가 소멸시킨
 *    초과분이 복원되지 않아** "탕감을 늘려 덜 깎인" 것과 "깎고 나서 되돌린" 것이 갈린다.
 *  - ㉕ 은 hp 차감 전이지만 `due`(정산액)가 **이미 그 상수로 계산돼** 들어온다.
 * ME9 가 임계에서 겪은 것과 같은 구조이고, 같은 방식으로 푼다 — 순수 함수 둘이 탕감률을
 * **필수 인자**로 받도록 개정하고, 이 앵커의 반환값을 `world.ts` 가 그대로 넘긴다.
 *
 * ## ⚠️ 상한은 이 앵커의 계약이다
 * 반환값이 10000 이상이면 `cushionSettled` 가 **음수**가 되어 정산이 hp 를 늘린다(맞는 것이
 * 이득이 되는 부호 반전). 설계 정본의 ME8 점근이 9500 이라 구조적으로 닿지 않지만, 어픽스
 * 연장이 붙는 축이라 case 쪽에서 상한을 건다.
 *
 * @param base `CUSHION_RECOVER_BP`. 미투자 런은 그대로 돌려받는다(비트 동일)
 * @returns 이번 정산에 쓸 탕감률(bp). **0 이상 10000 미만**이어야 한다
 */
export function onCushionRecoverBp(state: WorldState, player: Entity, base: number): number {
  if (!state.skillsOn) return base;
  void player;
  switch (state.sigBit) {
    case SIG_MALLOW_CUSHION:
      // ME8「리듬 탕감」 — `state.combo` 를 읽어 여백 비례로 올린다. 미투자·콤보 0 이면
      // `base` 그대로다(비트 동일).
      return mallowCushionRecoverBp(state, base);
    default:
      break;
  }
  return base;
}

/** 앵커 ㉗ 이 넘기는 **가변** 레코드. 훅이 이 칸을 고치면 그 값이 그대로 지연분이 된다. */
export interface CushionSplitParams {
  /**
   * 이번 피격에서 **지연분으로 뗄 양**(정수). `world.ts` 가 `cushionDeferredDamage(dmg)` 로
   * 초기화해 넣고, 훅이 돌아온 뒤 `[0, dmg]` 로 클램프해 읽는다.
   *
   * ⚠️ **`CUSHION_DEFER_BP` 를 여기서 갈아 끼우는 것이 이 칸의 용도다.** 비율을 바꾸는
   * 스킬(CU5)은 `dmg` 와 자기 bp 로 **다시 계산해 대입**하고, 절대량으로 개입하는
   * 스킬(CU1 초과분 이관 · CU2 한도 · CU6 전액 전환)은 그대로 대입한다. 비율 칸과 절대량
   * 칸을 **둘 다** 두지 않은 것은 의도다 — 두 손잡이가 같은 값을 가리키면 어느 쪽이 이겼는지
   * 가 호출 순서에 숨고, 이 저장소가 반복해서 대가를 치른 형태가 정확히 그것이다.
   */
  deferred: number;
}

/**
 * 앵커 ㉗ — **완충 지연 전환 분기**(`cushionOn` 게이트 안 · `dmg` 정수화 직후 ·
 * 즉시분이 확정되기 직전). 이 피격에서 얼마를 미룰지를 훅이 다시 쓸 수 있다.
 *
 * ## 왜 앵커 ⑧ 이나 ④ 로는 안 됐는가
 * ⑧(감쇠 사슬)은 이 분기보다 **앞**이라 "지연분을 얼마나 뗄지" 에 닿지 않고, ④(피격 후속)는
 * 적립이 이미 끝난 **뒤**다. 지연 전환 분기를 요구하는 말로우 4종(CU1·CU2·CU5·CU6)이 통째로
 * 미배선이었던 이유가 이것이고, 이 앵커가 그 넷의 자리다.
 *
 * ## 무엇이 보장되는가
 *  - `dmg` 는 **정수화 뒤**다(`Math.round`). `aux0` 은 u32 로 해시되므로 소수를 적립하면
 *    클라와 서버 재실행이 갈린다 — 훅이 돌려주는 값도 정수여야 하고, 호출부가 `trunc` 한다.
 *  - `player.hp` 는 **아직 안 깎였다**. `hp` 인자는 그 값이고, 치명 판정(CU6)은
 *    `dmg − params.deferred >= hp` 로 세운다.
 *  - `player.aux0` 은 **이번 피격분이 아직 안 실린** 값이다(적립은 hp 차감 뒤 분기다).
 *    CU2 의 한도 여유 계산이 그 사실 위에 선다.
 *
 * ## ⚠️ 호출부가 `[0, dmg]` 로 클램프한다
 * 음수는 즉시분을 늘려 "미룰수록 더 아픈" 부호 반전이 되고, `dmg` 초과는 즉시분을 음수로
 * 만들어 피격이 회복이 된다. 훅 쪽 규율에만 맡기지 않는다.
 *
 * @param dmg 이번 피격의 **정수화된** 총 피해(사슬을 다 통과한 뒤)
 * @param params 가변 레코드 — {@link CushionSplitParams}
 * @param hp 차감 **전** 플레이어 hp(치명 판정용)
 */
export function onCushionSplit(
  state: WorldState,
  player: Entity,
  dmg: number,
  params: CushionSplitParams,
  hp: number,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_MALLOW_CUSHION:
      // CU5 전량 유예 태세(비율 치환) → CU1 과부하 흡수(초과분 이관) → CU2 부채 한도(상한) →
      // CU6 파산 보호(치명 시 전액). 순서는 설계 정본이 못 박았다 — CU6 은 한도 게이트
      // **뒤**라 한도를 넘겨 적립될 수 있고, 그것이 "목숨을 빚으로 산" 대가다.
      mallowCushionSplit(state, player, dmg, params, hp);
      break;
    default:
      break;
  }
}

/** 앵커 ㉙ 이 구분하는 목표 종류. 완수 지점이 둘이라 어느 쪽인지 훅이 알 수 있어야 한다. */
export type ObjectiveKind = 'echo' | 'encounter';

/**
 * 앵커 ㉙ — **런 목표가 완수된 틱**. 지금은 두 지점이다:
 * `echo.ts` 의 에코 안정화 성공(`rt.state = 2`) · `encounterDetour.ts` 의 조우 완수
 * (`rt.state = 3`).
 *
 * ## ⚠️ **두 지점 다 걸어야 한다** — 한쪽만 걸면 반쪽이다
 * 말로우 ME7「에코 채권」의 술어가 설계 정본에서 *"에코 안정화·조우 완수"* 로 **한 벌**이다.
 * 한 지점만 걸면 "구현했는데 절반만 도는" 형태가 되고, 그 절반은 무대에 따라 아예 안 나온다
 * (에코는 희귀 이벤트, 조우는 다른 축의 방이다).
 *
 * ## 무엇이 보장되는가
 *  - 두 지점 모두 **정리가 끝난 뒤**다: 에코는 `echo.dead = true` 뒤, 조우는 방 소유 엔티티
 *    제거·플레이어 좌표 복원 뒤다. 훅이 보는 `state.entities` 는 메인 월드다.
 *  - `EncounterRuntime`·`EchoRuntime` 에 필드를 **추가하지 마라**(설계서 ME7 연계 항이 명시).
 *    존재 술어와 이 앵커의 인자만으로 성립하는 스킬만 여기 온다.
 *
 * @param kind 어느 목표였는가 — 산출을 갈라야 하는 스킬을 위한 칸(지금 소비처는 없다)
 */
export function onObjectiveResolved(
  state: WorldState,
  player: Entity,
  kind: ObjectiveKind,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_MALLOW_CUSHION:
      // ME7「에코 채권」 — 부채 전액 소각 + 소각량 비례 자석 버프 창.
      mallowObjectiveResolved(state, player, kind);
      break;
    case SIG_STRIKER_MARKSMAN:
      // M7「신호 추적」 뒤 절반 — 대시 쿨다운 전액 환급. 앞 절반(활성 중 반감)은 앵커 ② 다.
      strikerObjectiveResolved(state, player, kind);
      break;
    case SIG_PHANTOM_CLOAK:
      // PH9「메아리 잠행」(진입 절반) — 완수 즉시 은신 진입. 지속 절반(조우 활성 중 대시
      // 쿨다운 가속)은 앵커 ⑨ 안이고 술어는 `objectiveState.ts` 의 `objectiveActiveOf` 다.
      // ⚠️ `kind` 로 가르지 않는다 — 이 앵커 doc 의 "두 지점 다 걸어야 한다" 가 근거다.
      phantomObjectiveResolved(state, player);
      break;
    case SIG_BUBBLE_FILM:
      // DR7「신호 표류」 후반부 — 완수 틱에 막이 즉시 만재된다. 전반부(활성 동안 재생 2배)는
      // 앵커 ⑨ 에 있고, 두 반쪽의 술어가 각각 **활성**과 **완수**라 겹치지 않는다.
      bubbleObjectiveResolved(state, player, kind);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ㉕(S3) — **정산액이 확정되기 직전**. `due`(= `cushionSettled`)가 hp 로 들어가기 **전**,
 * hp−1 클램프보다도 **앞**이다. 이번 정산에서 **선체로 보낼 몫**을 돌려준다.
 *
 * ## 왜 ⑳ 으로는 안 됐는가 — ME5「분할 상환」이 못 오던 자리
 * ⑳ 은 hp 차감·hp−1 클램프가 끝난 **뒤**다. 거기서 사후 환급으로 분할을 흉내 내면 **클램프가
 * 소멸시킨 초과분이 복원되지 않아** "절반만 선체로 보낸" 결과와 "다 보내고 절반을 되돌린"
 * 결과가 수치로 갈린다(`skills/mallow.ts` 헤더가 못 박은 사유 그대로다). 그래서 분할은
 * **정산액이 확정되기 전**에 일어나야 하고, 이 앵커가 그 자리다.
 *
 * ## 설계 정본이 요구하는 순서를 코드가 실제로 밟는다
 * 설계서 공통 고지 ④ 는 *분할(ME5) → 회당 상한(CU3) → `applied` 확정 → 파생 소비* 다.
 * ㉕ 이 분할, ⑳ 안의 `mallowCushionSettled` 가 나머지 셋이다 — 즉 **㉕ 은 ⑳ 보다 반드시 앞**
 * 에서 불린다(`tests/skillAnchors.test.ts` 가 호출 순서로 잠갔다).
 *
 * ## 무엇이 보장되는가
 *  - `player.aux0`·`aux1` 은 **이미 0 으로 리셋**됐다. 그래서 이 훅이 `aux0` 에 쓴 값은
 *    **살아남는다** — ME5 가 "선체로 안 보낸 나머지" 를 다시 미루려면 여기서 **대입**해라
 *    (가산이면 리셋 전 값과 두 겹이 된다). 정산 전 풀 크기는 `due + recovered` 다.
 *    ⚠️ CU3(⑳)의 이월도 같은 칸을 쓴다 — 배선 레인이 **CU3 쪽을 가산으로 바꿨다**(대입이면
 *    ME5 의 나머지가 조용히 덮인다). 지금 ME5 도 가산으로 쓴다(리셋 직후라 값은 대입과 같다).
 *  - `player.hp` 는 **아직 안 깎였다**. 정산 후 hp 가 필요하면 이 자리가 아니라 ⑳ 이다.
 *
 * ## ⚠️ 뒤 산술이 반환값을 삼키는 구간이 하나 있다
 * 반환값은 `applied = min(반환값, floor(hp) − 1)` 로 hp 에 들어간다. 즉 **정산액이 이미 hp
 * 여유를 넘긴 치사급 정산에서는 값을 키워도 최종 hp 가 안 바뀐다**(완충은 절대 치명적이지
 * 않다는 규칙 그 자체다). 값을 **줄이는** 방향(= ME5 의 분할)은 그 구간에서도 온전히 반영된다.
 * 하한 클램프는 걸지 않는다 — `min` 을 하나 더 두면 키우는 방향이 통째로 죽는다(앵커 ⑰ 이
 * `min(d,s)` 때문에 원리적으로 무효가 된 전례가 이 저장소에 있다).
 *
 * @param due `cushionSettled(aux0, aux1, settleAt, recoverBp)` — 회복분을 뗀 뒤 선체로 갈 예정인
 *   지연 피해
 * @param recovered `cushionRecovered(aux0, aux1, settleAt, recoverBp)` — 무피격 보상으로 사라진 몫
 * @param recoverBp 이 정산에 **실제로 쓰인** 탕감률(앵커 ㉘ 의 반환값). ME5 의 이월분 탕감률이
 *   설계 정본에서 *여백 합성*(갱신값 = 현재율 + (10000 − 현재율) × r / 10000)이고 그 「현재율」이
 *   바로 이 값이다 — 안 넘기면 ME5 가 ME8 과 무관하게 굴러 조용히 갈린다
 * @returns 이번 정산에서 **선체로 보낼 몫**. 비음이어야 한다(음수는 hp 를 늘리지 않고 버려진다)
 */
export function onCushionSettleDue(
  state: WorldState,
  player: Entity,
  due: number,
  recovered: number,
  recoverBp: number,
): number {
  if (!state.skillsOn) return due;
  void recovered;
  switch (state.sigBit) {
    case SIG_MALLOW_CUSHION:
      // ME5「분할 상환」 **1종** — 이번 정산의 절반만 선체로 보내고 나머지를 `aux0` 으로 미룬다
      // (이월분은 탕감률만큼 줄어든다). 설계 정본의 순서에서 **분할**이 여기다.
      // 미투자 런은 `due` 를 그대로 돌려주므로 비트 동일이다.
      return mallowCushionSettleDue(state, player, due, recoverBp);
    // ⚠️ **아래 주석은 낡았다 — 지우지 않고 갱신한다.** ME9 는 순수 함수 개정 레인이 임계를
    // 인자로 빼면서 **앵커 ⑲** 에서 돌고, ME8 은 이 레인이 탕감률을 인자로 빼면서
    // **앵커 ㉘({@link onCushionRecoverBp})** 에서 돈다. 즉 "여기로 못 온다" 는 지금도 참이지만
    // 사유가 *"막혀 있다"* 에서 *"자리가 다르다"* 로 바뀌었다. 종전 관측 원문:
    // ⚠️ ME8「리듬 탕감」·ME9「솜틀 요양」은 **여전히 여기로도 못 온다.** 둘은 탕감률
    // (`CUSHION_RECOVER_BP`)·임계(`CUSHION_RECOVER_TICKS`)가 `shipSignature.ts` 의 순수 함수
    // `cushionRecovered`·`cushionSettled` **안에** 있어, 이 앵커에 도달한 시점에는 이미 그
    // 상수로 계산이 끝나 있다. 열려면 순수 함수 둘이 탕감률·임계를 **인자로 받도록** 고쳐야
    // 하고 그것은 골든에 닿는 변경이다(재생성 창과 묶기로 정해져 있다). 사유 전문은
    // `skills/mallow.ts` 헤더와 앵커 ⑲ 주석.
    default:
      break;
  }
  return due;
}

/**
 * 앵커 ⑳ — **완충 정산이 끝난 직후**(hp 차감·클램프까지 전부 반영된 뒤).
 *
 * ## 왜 앵커 ⑨ 가 아니라 여기인가 — **예측을 금지한 자리**
 * 말로우 30종 중 **9종**(SQ2·SQ5·SQ8·ME4·ME5·ME8·CU3·CU9·CU10)이 "정산 틱" 을 트리거로 삼는다.
 * 앵커 ⑨ 는 `stepShipSignature` **진입점**이라 정산보다 앞이고, 거기서
 * `aux0 > 0 && aux1 + 1 >= 임계` 로 **예측**할 수는 있었다. 하지 않았다 — 그러면 정산 술어가
 * 두 곳에 살고, 정산액(`cushionSettled`)·탕감액(`cushionRecovered`)·hp−1 클램프 후 실제 적용액
 * (`applied`)까지 전부 두 번째 사본이 된다. 말로우는 **액티브 4종이 임계를 수동 주입**하는
 * 기체라 그 어긋남이 조용히 커진다. 이 앵커는 그 셋을 **계산된 값 그대로** 넘긴다.
 *
 * ## 무엇이 보장되는가
 *  - `player.aux0` 과 `aux1` 은 **이미 0 으로 리셋**됐다. 정산 **전**의 풀 크기가 필요하면
 *    `settled + recovered` 로 복원해라(그 합이 정의상 리셋 전 `aux0` 이다).
 *  - `applied` 는 **hp 에서 실제로 깎인 양**이다. `settled` 와 다를 수 있다 — 완충은 절대
 *    치명적이지 않아 hp 를 1 미만으로 내리지 못하게 클램프하고 **초과분을 소멸**시킨다.
 *    "미룬 피해를 다 갚았다" 를 재려면 `settled` 가 아니라 `applied` 를 봐라.
 *  - ⚠️ **이 지점은 감쇠 사슬 밖이다.** 정산이 hp 를 깎는 이 경로는 앵커 ⑧ 을 타지 않는다 —
 *    "받는 피해" 축 스킬을 사슬에만 걸면 자기 기체의 지연 정산분에는 영영 안 걸린다.
 *
 * @param settled 선체로 들어가기로 **확정된** 지연 피해. S3 부터 이 값은 앵커 ㉔
 *   ({@link onCushionSettleDue})이 돌려준 몫이다(분할 전 `cushionSettled` 원값이 아니다) —
 *   CU3 의 이월이 "상한이 막은 몫" 만 세려면 분할 **후** 기준이어야 한다. ME5 미투자 런에서는
 *   두 값이 같다
 * @param recovered 무피격 보상으로 **사라진** 지연 피해
 * @param applied hp 에서 실제로 깎인 양(클램프 후). `settled` 이하다
 */
export function onCushionSettled(
  state: WorldState,
  player: Entity,
  settled: number,
  recovered: number,
  applied: number,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_MALLOW_CUSHION:
      // 정산 트리거 **7종**: CU3 무통 정산(회당 상한 + 잔여 이월) → SQ2 청산 폭발 →
      // SQ5 탕감 장전 → SQ8 흉터 포문 → ME4 반환 요법 → CU9 유예의 은총 → CU10 자본화.
      // 적용 순서는 설계서 공통 고지 ④ 고정이고 효과 함수가 그대로 지킨다.
      //
      // ⚠️ ME5(분할 상환)·ME8(리듬 탕감)·ME9(솜틀 요양)는 여기 **없다.** 셋 다 정산 **산술
      // 자체**를 바꾸는데 이 앵커는 hp 차감·hp−1 클램프가 끝난 뒤다. 사후 환급으로 흉내 내면
      // 클램프가 물린 정산에서 값이 갈린다("탕감을 늘려 덜 깎인" 것과 "깎고 나서 되돌린" 것은
      // 소멸분 때문에 다른 수치가 된다). ME8·ME9 는 추가로 탕감률·임계가 `shipSignature.ts`
      // 의 순수 함수 안에 있어 골든에 닿는 선결이 붙는다 — 사유 전문은 `skills/mallow.ts` 헤더.
      // → **ME5 는 S3 의 앵커 ㉕({@link onCushionSettleDue})으로 갔다** — 그 자리가 hp 차감
      //   **전**이라 위 사유(클램프 소멸분)가 성립하지 않는다. ME8·ME9 는 ㉔ 으로도 못 온다:
      //   탕감률·임계가 순수 함수 **안**이라 ㉕ 시점엔 이미 그 상수로 계산이 끝나 있다.
      mallowCushionSettled(state, player, settled, recovered, applied);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ㉑ — **팬텀 무피격 스트릭이 리셋되기 직전**(피격이 은신을 푸는 그 지점).
 *
 * ## 왜 [치명] 이었는가
 * `world.ts` 는 hp 차감 후 `player.aux0 = 0` + `setBreakToken(…, 0)` 을 실행하고 **그 뒤에**
 * 앵커 ④(`onPlayerDamaged`)를 부른다. 그래서 ④ 에 도달한 시점의 `aux0` 은 **항상 0** 이다 —
 * DI1「위상 정산」은 상시 최소 반경이 되고 PH10「발각 즉응」은 상시 미발동이 된다. 둘 다
 * 리셋 **전**의 스트릭을 요구하기 때문이다. 설계서 공통 구현 고지 ④ 가 요구한 순서
 * (DI1 → PH10 → 리셋 → DI5) 중 **DI5 만** ④ 에서 성립했다. 이 앵커가 앞의 둘을 연다.
 *
 * ## 무엇이 보장되는가
 *  - `streak` 은 **리셋 직전의 `player.aux0`** — 이 피격까지 쌓인 무피격 틱이다. `player.aux0`
 *    을 직접 읽어도 같은 값이지만, 인자로 넘겨 **읽는 시점이 리셋 앞이라는 것을 코드로 못 박는다**
 *    (뒤 레인이 훅을 리셋 뒤로 옮기면 인자만 남고 조용히 0 이 되는 대신 시그니처가 어긋난다).
 *  - `broken` 은 리셋 직전의 **해제 표식**(`aux1`)이 서 있었는가다. "은신 창 안에서 맞았다" 와
 *    "이미 해제 첫 타를 쏜 뒤 맞았다" 를 구분해야 하는 카드가 이 값을 본다.
 *  - `dmg` 는 이 피격에서 hp 에 실제로 들어간 양이다(앵커 ④ 가 받는 것과 같은 값).
 *  - 호출 시점은 **hp 차감·클램프 뒤**다. `player.hp` 는 이미 깎여 있고, 피격 **전** hp 가
 *    필요하면 `player.hp + dmg` 로 복원해라(클램프가 걸린 치사 피격에서는 하한이다).
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **여기서 `aux0`/`aux1` 을 세워도 곧바로 덮인다.** 이 앵커 **직후**에 world 가
 *    `aux0 = 0` 과 `setBreakToken(…, 0)` 을 실행한다. 스트릭을 보존하려는 스킬(PH5 연장 위상
 *    계열)은 이 자리가 아니라 **리셋 분기 자체**를 조건부로 만들어야 한다.
 *  - ⚠️ **`setBreakToken` 을 우회해 `aux1` 에 직접 대입하지 마라**(E1 — 토큰 쓰기 단일 경로).
 *  - **RNG 를 소비하지 마라**(공통 계약).
 *
 * @param dmg 이 피격에서 hp 에 들어간 피해
 * @param streak 리셋 **직전**의 무피격 스트릭(`player.aux0`)
 * @param broken 리셋 직전에 해제 표식이 서 있었는가
 */
export function onCloakBreakReset(
  state: WorldState,
  player: Entity,
  dmg: number,
  streak: number,
  broken: boolean,
): void {
  if (!state.skillsOn) return;
  void player;
  void dmg;
  void streak;
  void broken;
  switch (state.sigBit) {
    case SIG_PHANTOM_CLOAK:
      // DI1 위상 정산(잃는 스트릭에 비례한 반경으로 적탄 소거) · PH10 발각 즉응(창 중 피격이면
      // 대시 쿨 전액 환급 + 무적 가산). 설계서 공통 구현 고지 ④ 의 순서 **DI1 → PH10 → 리셋 →
      // DI5** 중 앞의 둘이 여기, DI5 는 리셋 뒤인 앵커 ④ 다.
      //
      // `dmg` 를 넘기지 않는 것은 의도다 — 두 스킬 다 피해량을 보지 않는다(DI1 은 스트릭, PH10
      // 은 창 술어). 안 쓰는 값을 시그니처에 실으면 "이 훅은 피해량에 반응한다"는 거짓 계약이
      // 남는다. 필요해지는 카드가 생기면 그때 넓힌다.
      phantomCloakBreakReset(state, player, streak, broken);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ㉓ 가 넘기는 **이번 틱 출격 판정의 파라미터 한 벌**. 훅이 제자리에서 고친다.
 *
 * ## 왜 인자 나열이 아니라 레코드인가
 * `VolleyParams` 와 같은 사유다 — 이 지점을 기다리는 스킬 여덟이 고치려는 칸이 서로 다르고,
 * 인자로 늘어놓으면 칸이 하나 늘 때마다 앵커 시그니처가 바뀐다.
 *
 * ## ⚠️ 세 칸 모두 **`world.ts` 가 실제로 읽는 값**이고, 어느 칸도 클램프에 삼켜지지 않는다
 * 이 저장소에서 앵커 ⑰ 이 `min(d, s)` 때문에 **원리적으로 무효**가 되어 살린 스킬이 0종이었던
 * 전례가 있다. 그래서 칸마다 *"키우면 결과가 실제로 커지는가"* 를 확인해 적는다:
 *
 *  · `threshold`  — world 는 `state.kills - player.aux0 < threshold` 로 **그대로** 비교한다.
 *    하한·상한·`max` 가 **하나도 없다**. 낮추면 더 일찍, 올리면 더 늦게 출격한다.
 *    ⚠️ 뒤집어 말하면 **바닥을 대신 지켜 주는 것도 없다** — 설계 BD1 의 `max(6, …)` 같은
 *    하한은 훅이 스스로 적용해야 한다(음수를 넣으면 매 틱 출격한다).
 *  · `maxDrones`  — world 는 `live >= maxDrones` 로 **그대로** 비교한다. 올리면 동시 생존
 *    대수가 실제로 늘고, 내리면 준다. 클램프 없음.
 *  · `launchCount` — world 는 `n < launchCount && live < maxDrones` 로 돈다. **`maxDrones`
 *    가 이긴다**(자리가 1칸이면 1기만 나간다). 이 상한은 설계 BD2 가 명시한 "상한·보류 규율
 *    유지" 그 자체이지 개입을 삼키는 클램프가 아니다 — 빈 자리가 있으면 키운 만큼 더 뜬다.
 *
 * ## ⚠️ 여기 **없는** 칸과 그 사유
 *  · **살아 있는 병아리 수(`live`)** — world 는 그 스캔을 임계를 넘긴 틱에만 돈다(수십 틱에
 *    한 번). 이 앵커는 임계 체크보다 **앞**이라 스캔 전이다. 여기에 싣자고 스캔을 매 틱으로
 *    올리면 거동은 같아도 상시 비용이 붙는다. 필요한 훅은 `skills/hatchling.ts` 의
 *    `countChicks` 를 쓴다 — 그 3중 술어를 world 의 것과 글자 그대로 같게 유지하는 것이
 *    이미 계약이다(그 함수 주석이 근거).
 *  · **출격 좌표** — 좌표는 `live` 가 정해진 뒤에야 확정된다. 좌표를 만지는 축(NU7)은
 *    앵커 ㉔ 에서 태어난 개체의 `x`/`y` 를 옮긴다(병아리는 NU8 이 이미 매 틱 옮기는 개체라
 *    이동 자체가 확립된 조작이다).
 */
export interface BroodParams {
  /**
   * 이번 틱의 부화 요구 처치 수. 초기값은 `hatchThreshold(state.kills)` 다.
   * 카운터는 `state.kills - player.aux0` 이고 **그 둘이 정본**이다(사본을 만들지 마라 —
   * `stepShipSignature` 의 해츨링 분기 주석이 그 사유를 적고 있다).
   */
  threshold: number;
  /** 병아리 동시 생존 상한. 초기값은 `world.ts` 의 `BROOD_MAX_DRONES`(=4). */
  maxDrones: number;
  /** 이번 틱에 출격시킬 기수. 초기값 1. 빈 자리가 모자라면 자리 수만큼만 나간다. */
  launchCount: number;
}

/**
 * 앵커 ㉓ — **`stepHatchBrood` 최상단**(임계 조기 반환보다 앞 · 상한 조기 반환보다 앞).
 *
 * ## 왜 최상단인가 — 조기 반환 뒤에 두면 다섯 종이 영영 0 건이다
 * 이 함수는 조기 반환이 둘이다(임계 미달 · 상한 포화). 앵커를 임계 반환 **뒤**에 두면 BD1
 * (임계 감산)은 *"임계를 이미 넘긴 틱"* 에만 불려 임계를 낮출 기회가 원리적으로 없고, 상한
 * 반환 뒤에 두면 BD10·SH10(상한 조작)과 NU10(만석 보류 중 적립)이 같은 이유로 죽는다.
 * 그래서 **두 반환보다 모두 앞**이다 — 이 앵커는 해츨링 런의 **매 틱** 불린다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.** `stepHatchBrood` 의 RNG 미소비 계약(그 함수 doc)이 이
 *    앵커에도 그대로 걸린다. 난수를 한 번이라도 뽑으면 해츨링 런의 웨이브 구성·드랍 시퀀스가
 *    통째로 밀린다.
 *  - ⚠️ **`player.aux0` 을 여기서 만지지 마라.** 그것은 "마지막 출격 시점의 `state.kills`
 *    스냅샷" 이고 world 가 출격 성공 시에만 갱신한다(= 카운터 0 리셋). 여기서 앞당기면
 *    카운터 의미가 갈리고, 앵커 ⑨ 의 SH6(알막)이 `aux0` **증가**를 출격 신호로 읽고 있어
 *    거짓 발화까지 만든다. 이월을 다루는 축(NU10)은 `aux0` 이 아니라 `threshold` 를 낮춰라
 *    (설계 NU10 의 "선납" 이 정확히 그 형태이고, 2R R5 가 `aux0` 전진안을 폐기했다).
 *  - ⚠️ **병아리를 여기서 만들지 마라.** 출격은 world 소유다(설계 ①절 · ADR-0041 Non-Goal ①).
 */
export function onBroodLaunchParams(
  state: WorldState,
  player: Entity,
  params: BroodParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case SIG_HATCHLING_BROOD:` 를 여기에 넣는다. **`break;` 를 반드시
    // 붙여라** — 병렬 배선 머지에서 두 `case` 가 `break;` 하나를 공유하는 fallthrough 가
    // 누적 5건 나왔고 전부 `tsc` 만이 잡았다.
    case SIG_HATCHLING_BROOD:
      hatchlingBroodLaunchParams(state, player, params);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ㉔ — **병아리 1기가 실제로 태어난 직후**(`activateTurret` 뒤 · `player.aux0` 갱신 앞).
 *
 * ## 이 지점에서만 살아 있는 것
 *  - **출격 좌표** — `chick.x`/`chick.y`. 앵커 ㉓ 시점에는 아직 정해지지 않았고, 다음 틱의
 *    앵커 ⑨ 시점에는 *"어디서 태어났는가"* 를 되짚을 방법이 없다(SH6 이 `aux0` 증가라는
 *    간접 신호로 출격을 감지하면서 **좌표는 이전되지 않는다**고 명시한 것이 그 사유다).
 *  - **개체 자신** — 수명(`chick.life`)·좌표를 이 자리에서 고칠 수 있다. 병아리를 옮기는 것은
 *    이미 확립된 조작이다(NU8 이 매 틱 옮긴다).
 *
 * ## 호출 횟수
 * **출격 1기당 정확히 1회**다. 쌍둥이(BD2)면 같은 틱에 두 번 불린다 — "출격 사건당 1회" 가
 * 아니다. 틱당 1회로 착각하면 부수효과(충격파·젬)가 쌍둥이 빌드에서 절반만 난다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라**(위와 같은 계약). BD6 의 폭발·NU2 의 젬은 고정 오프셋으로
 *    깔아야 한다(설계 NU2 "고정 오프셋 — RNG 미소비 유지"가 정본).
 *  - ⚠️ **`chick.phase` 를 건드리지 마라** — 병아리의 `phase` 는 생사 스위치다(`isActiveTurret`
 *    · 스크롤 앵커 판정 · 렌더가 전부 `phase === 1` 을 읽는다).
 *  - ⚠️ **`chick.ownerId` 를 바꾸지 마라** — `BROOD_MARK` 가 곧 상한 계수의 정의이고
 *    `isGimmick` 컬링 제외의 근거다.
 *
 * ## ⚠️ 이 앵커로도 안 열리는 것 — ✅ **㉖ 이 열었다(W2)**
 * BD10 「여왕 사출」의 **탄 피해 배율**은 여기 없다. 병아리의 사격은 `stepTurrets`/
 * `fireTurretShot` 이 매 틱 정하고 개체에 피해 필드가 없어서, 태어난 순간에 실을 자리가
 * 없다(수명 가산은 `chick.life` 로 여기서 가능하고, **BD10 의 그 축은 실제로 여기 있다**).
 * 그 축은 포탑 루프에 앵커가 서야 열린다 — 이 파일 말미의 **앵커 ㉖ `onTurretShotParams`**
 * 가 그것이다. 위 문장은 *왜 ㉔ 로는 안 되는가* 의 기록으로 남긴다(지금도 참이다).
 */
export function onBroodLaunched(state: WorldState, player: Entity, chick: Entity): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case SIG_HATCHLING_BROOD:` 를 여기에 넣는다. **`break;` 필수**(위와 같음).
    case SIG_HATCHLING_BROOD:
      hatchlingBroodLaunched(state, player, chick);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ㉖ (W2) — **포탑 사격 지점**(`world.ts` 의 `fireTurretShot`)
// ---------------------------------------------------------------------------
//
//   ㉖ onTurretShotParams — 포탑탄 1발의 파라미터가 정해지는 지점(표적 확정 **뒤** ·
//                           `spawnBullet` **앞**). 해츨링 BD10 의 탄 피해 배율.
//
// `skills/hatchling.ts` 헤더 사유 2묶음(「포탑 루프 소관 — 6종」)과 앵커 ㉔ doc 말미의
// 「이 앵커로도 안 열리는 것」이 가리키던 그 지점이다. BD10 은 상한 −1(㉓) · 수명 가산(㉔) ·
// **탄 피해 배율(㉖)** 의 3축인데 셋째가 없어 *"−1기를 내주고 정예화는 안 받는"* 순손해라
// 앞 레인이 통째로 미배선으로 남겼다. 셋이 다 있어야 배선이 성립한다.
//
// ## ⚠️ 포탑은 해츨링 전용이 아니다 — 훅은 전부에서 불리고, **효과 게이트는 훅 안**이다
// `stepTurrets` 는 병아리(`BROOD_MARK`) · 액티브 센트리 · 자율 드론 베이(둘 다 `DRONE_MARK`)
// 를 한 루프로 돌린다. 앵커를 소환물 종류로 미리 거르지 **않는다** — 그러면 훗날 센트리를
// 만지는 축이 다시 막힌다. 대신 `turret` 을 넘겨 **훅이 스스로 판별**하게 한다
// (`hatchlingTurretShotParams` 의 첫 줄이 `ownerId === BROOD_MARK` 다).
//
// ## ⚠️ 왜 표적 확정 뒤인가
// 표적이 없는 틱은 무발사(`fireTurretShot` 이 `false` 반환)라 실릴 탄이 없다. 앞에 두면
// 사거리 밖 대기 중에도 매 틱 훅이 돌아 상시 비용만 붙는다.
//
// ## ⚠️ 촉매 짝이 없다 — ⑮·⑰~㉔ 과 같다
// 포탑탄은 촉매 48종에 대응 카드가 없다. 빈 촉매 함수를 미리 두지 마라.

/**
 * 앵커 ㉖ 이 넘기는 **포탑탄 1발의 파라미터**. 훅이 제자리에서 고친다.
 *
 * ## 왜 인자 나열이 아니라 레코드인가
 * `VolleyParams`·`BroodParams` 와 같은 사유다 — 포탑 루프를 기다리는 축이 여럿이고
 * (BD7 누적 강화 등) 고치려는 칸이 서로 달라, 인자로 늘어놓으면 칸이 하나 늘 때마다 앵커
 * 시그니처가 바뀐다. 레코드는 필드를 더해도 기존 `case` 가 그대로 선다.
 *
 * ## ⚠️ 칸이 하나뿐인 이유 — **증명한 칸만 연다**
 * `speed`·`life`·`pierce`·`radius` 도 `spawnBullet` 이 그대로 싣는 값이라 열 수 **있지만**,
 * 이 커밋에 소비자가 없다. 이 저장소는 "미리 열어 둔 자리"가 *"배선이 있다"* 는 착각을
 * 만든 재발 패턴을 갖고 있고(앵커 ⑮ 주석), 무엇보다 **여는 칸마다 클램프 삼킴을 따로
 * 확인해야** 한다(앵커 ⑰ 이 `min(d,s)` 로 원리적 무효였던 전례). 필요해지는 레인이 자기
 * 칸을 확인하고 더해라 — 레코드라 그 추가는 앵커 시그니처를 안 바꾼다.
 */
export interface TurretShotParams {
  /**
   * 이 1발의 피해. 초기값은 `events.ts` 의 `TURRET_BULLET_DAMAGE`(=10).
   *
   * ## ⚠️ 클램프에 안 삼켜진다 — 소비 경로를 끝까지 따라갔다
   * `spawnBullet` 이 `b.damage = damage` 로 **그대로** 싣고(산술 0), 명중 지점은
   * `dealt = b.damage * mult * gyroAmp * prismAmp * eliteDamageTakenMult(t)` 뒤
   * `t.hp -= dealt` 다. **`min`·`max`·클램프가 경로에 하나도 없다.** 배율을 키우면 적 hp 가
   * 실제로 그만큼 더 준다(뮤테이션으로 확인 — 훅의 곱셈을 지우면 단언이 빨개진다).
   * (`core` 실드 흡수 분기만 예외적으로 감산하는데 그건 침공 방어체 전용이다.)
   */
  damage: number;
}

/**
 * 앵커 ㉖ — **포탑 1기의 1발이 실제로 나가기 직전**(표적 확정 뒤 · `spawnBullet` 앞).
 *
 * ## 이 지점에서만 살아 있는 것
 *  - **포탑 개체와 탄 파라미터가 둘 다 유효하다.** 앵커 ⑯(`onVolleyParams`)은 플레이어
 *    주무기 전용이라 포탑탄을 안 본다. 탄이 태어난 뒤로 미루면 *"어느 포탑이 쐈는가"* 가
 *    남지 않는다 — 남는 것은 `ownerId` 스탬프뿐이고 그건 소환물 종류이지 개체가 아니다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.** `fireTurretShot` 의 RNG 미소비 계약(그 함수 doc)이 이
 *    앵커에도 그대로 걸린다. 난수를 뽑으면 웨이브 구성·드랍 시퀀스가 통째로 밀린다.
 *  - ⚠️ **엔티티를 낳지 마라.** 이 지점은 `stepTurrets` 의 `state.entities` **순회 안**이다.
 *    (`spawnBullet` 은 배열 말미 append 라 world 자신이 쓰는 안전한 경로지만, 훅이 임의로
 *    개체를 밀어 넣으면 같은 틱의 순회가 갈린다 — `splitSpawns` 처럼 순회 밖으로 미루는
 *    버퍼가 필요하다.)
 *  - ⚠️ **`turret` 을 죽이거나 `cooldown` 을 만지지 마라.** 쿨다운 리듬은 호출부
 *    (`stepTurrets`)가 반환값을 보고 정한다 — 여기서 손대면 BD8 의 "쿨다운 무시 격발"
 *    계약이 갈린다.
 *
 * @param turret 이 발을 쏘는 포탑 개체. **소환물 종류 판별은 훅 책임이다**(`ownerId` —
 *   병아리 `BROOD_MARK` · 센트리/드론 베이 `DRONE_MARK`).
 */
export function onTurretShotParams(
  state: WorldState,
  turret: Entity,
  params: TurretShotParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case` 를 여기에 넣는다. **`break;` 를 반드시 붙여라** — 병렬 배선
    // 머지에서 두 `case` 가 `break;` 하나를 공유하는 fallthrough 가 누적 5건 나왔고 전부
    // `tsc` 만이 잡았다.
    case SIG_HATCHLING_BROOD:
      hatchlingTurretShotParams(state, turret, params);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ㉗㉘㉙ (공유 앵커 레인) — **기체를 가로지르는 지점 셋**
// ---------------------------------------------------------------------------
//
//   ㉗ onActiveFired        — 액티브 핸들러 호출 **직후**(`actives.ts` 의 `stepActives`).
//   ㉘ onGemMagnetParams    — 젬 자석 반경이 확정된 직후(`world.ts` 의 `stepGems`).
//   ㉙ onPlayerMoveParams   — 플레이어 이동 배율이 확정되기 직전(`world.ts` 의 `stepPlayer`).
//
// ## 왜 기체별 레인이 아니라 한 레인이 셋을 세웠는가
// 셋 다 **7기체가 전부 지나가는 지점**이다. 기체별 레인이 각자 뚫으면 같은 지점에 시그니처가
// 다른 훅이 여럿 서고, 그 충돌은 **`tsc` 만이 잡는다**(누적 실측: 의미 충돌 전건이 타입 오류로
// 드러났고 테스트는 0건 잡았다). 자리를 먼저 하나로 세우고 소비처를 나중에 얹는 순서가
// 그 재발을 구조적으로 막는다.
//
// ## ⚠️ 촉매 짝이 없다 — ⑮·⑰~㉖ 과 같다
// 액티브 발동·자석 반경·이동 배율은 촉매 48종에 대응 카드가 없다. 빈 촉매 함수를 미리 두지 마라.

/**
 * 앵커 ㉗ 이 넘기는 **발동 직전의 스냅샷**. 훅이 읽기만 한다(가변 레코드가 아니다).
 *
 * ## 왜 이 넷인가 — 전부 **핸들러가 덮어쓰기 때문에** 사후 복원이 불가능한 값이다
 * 앵커가 핸들러 **뒤**라 `player.x/y`·`player.aux0`·`state.entities` 는 이미 갱신돼 있다.
 * 훅이 스스로 복원할 방법이 없으므로 호출부가 찍어서 넘긴다.
 */
export interface ActiveFiredOrigin {
  /** 핸들러 호출 **전** `player.x` — *출발한 자리*. 버블 DR9·아크캐스터 BA6 이 요구한다. */
  preX: number;
  /** 핸들러 호출 **전** `player.y`. */
  preY: number;
  /**
   * 핸들러 호출 **전** `player.aux0`. 아크캐스터 CH7 이 *"소모한 정지 시간"* 을 이 값과
   * 지금 값의 **차분**으로만 알 수 있다(방전 액티브가 충전을 비운 뒤라 현재값은 0 이다).
   */
  preAux0: number;
  /**
   * 핸들러 호출 **전** `state.entities.length`. 이 인덱스 **이상**이 *그 발동이 낳은 개체*다 —
   * 아크캐스터 CH10 이 "방전 액티브의 투사체"만 골라 표식을 찍는 데 쓴다.
   *
   * ⚠️ `state.entities` 는 `compact()` 전까지 **append-only** 라 이 워터마크가 유효하다.
   * `compact()` 는 이 앵커와 같은 틱의 훨씬 뒤에 돈다 — 워터마크를 틱 경계 너머로 들고 가지 마라.
   */
  spawnWatermark: number;
}

/**
 * 앵커 ㉗ — **액티브 핸들러가 자기 일을 끝낸 직후**(`stepActives` 의 `ACTIVE_HANDLERS[...]` 다음
 * 줄 · 쿨다운 대입 **앞**).
 *
 * ## 이 지점에서만 살아 있는 것
 *  - **착지 지점** = `player.x`/`player.y` 다. 앵커가 호출 **뒤**라 blink 계열 액티브의 이동이
 *    이미 끝나 있고, 벽 슬라이드 보정(`slideCircleWalls`)까지 반영된 **최종 좌표**다. 그래서
 *    착지 축 스킬(팬텀 PH2 · 버블 DR3 · 브루저 MO10 · 말로우 ME6)은 **인자를 하나도 더
 *    요구하지 않는다** — 그 자리에서 `player` 를 그대로 쓰면 된다.
 *  - **출발 지점**은 반대로 이미 사라졌다 → {@link ActiveFiredOrigin.preX}/`preY` 로 받는다.
 *  - **쿨다운은 아직 안 세워졌다.** 이 앵커에서 `state.activeCd0/1` 을 만지면 호출부가 그
 *    직후에 덮어쓴다. 쿨다운을 조작하려는 스킬은 여기가 자리가 아니다.
 *
 * ## ⚠️ 여기서는 **스폰이 안전하다** — 앵커 ㉖ 과 정반대다
 * `stepActives` 는 `state.entities` 를 **순회하지 않는다**(슬롯 2칸 루프일 뿐이다). 그래서
 * 아크캐스터 BA1(착지 원형 볼리)·BA6(출발 자리 포탑)처럼 **개체를 낳는 스킬을 여기서 바로
 * 실행할 수 있다.** 앵커 ㉖(`onTurretShotParams`)은 `stepTurrets` 의 `state.entities` 순회
 * **안**이라 스폰이 금지인데, 두 앵커를 같은 규율로 읽지 마라.
 * (그 위에 `fanStrike`·`blink` 같은 액티브 헬퍼가 이미 이 지점에서 개체를 낳고 있다 —
 *  핸들러 자신이 바로 앞 줄에서 하는 일이다.)
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.** 전 앵커 공통 계약이다(파일 헤더).
 *  - ⚠️ **적 `hp` 를 깎으면 `t.dead` 를 같이 세워라.** `compact()` 의 1차 게이트가 `e.dead` 라
 *    안 세우면 그 적은 좀비로 남아 처치·젬·전리품이 전부 사라진다(정본 `status.ts` 111-112).
 *    단 `guardian`·`core` 는 부활 분기가 있어 마킹하면 안 된다.
 *
 * @param def 이번에 발동한 액티브의 정의. **계열 판별은 훅 책임이다** — `def.treeIndex`(축) ·
 *   `def.tier`('lo'/'hi') · `def.kind` 가 그 손잡이다.
 * @param dir 발동 방향(`resolveDirFallback` 을 이미 통과한 단위 벡터).
 * @param slot 슬롯 인덱스(0/1). 버프 잔여 틱 칸을 고를 때 쓴다.
 */
export function onActiveFired(
  state: WorldState,
  player: Entity,
  def: ActiveSkillDef,
  dir: { x: number; y: number },
  slot: number,
  origin: ActiveFiredOrigin,
): void {
  if (!state.skillsOn) return;
  // 아직 소비처가 없는 인자들. 자기 `case` 가 쓰기 시작하면 해당 줄을 지워라.
  // (`dir`·`origin` 은 버블 PO9·DR9 와 아크캐스터 BA1·BA6·CH7·CH10 이 쓰기 시작해 지웠다.)
  void slot;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case` 를 여기에 넣는다. **`break;` 를 반드시 붙여라** — 병렬 배선
    // 머지에서 두 `case` 가 `break;` 하나를 공유하는 fallthrough 가 누적 5건 나왔고 전부
    // `tsc` 만이 잡았다.
    case SIG_PHANTOM_CLOAK:
      // PH2 위상 착지 — 위상 계열(`treeIndex === 1`) 액티브의 **착지 지점** 정화.
      phantomActiveFired(state, player, def);
      break;
    case SIG_BUBBLE_FILM:
      // PO9 고압 격발 조율(pop 계열 환산 효율) · DR9 이탈 잔파동(drift 계열 **출발 지점**).
      bubbleActiveFired(state, player, def, dir, origin);
      break;
    case SIG_ARC_OVERCHARGE:
      // CH7 잔류 방전 · CH10 주입 전격(둘 다 방전 = chain hi) ·
      // BA1 재배치 일제사 · BA4 소거 항로 · BA6 분신 포좌(점멸 = barrage).
      arccasterActiveFired(state, player, def, dir, origin);
      break;
    case SIG_BRUISER_ARMOR:
      // BL5 충각 절단 · MO5 견인 돌진 · MO10 착탄 충격(전부 기동 액티브의 **경로/도착**) ·
      // BL10 소각 여열(칼날 액티브의 **스택 순감소분**). `origin` 의 셋을 다 쓴다.
      bruiserActiveFired(state, player, def, origin);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ㉞ (S3-해츨링) — **포탑 1기의 사격 리듬**(`world.ts` 의 `stepTurrets` 루프 안)
// ---------------------------------------------------------------------------
//
//   ㉞ onTurretCadence — 쿨다운 감산 **앞**. 해츨링 BD9(과밀 본능) · NU4(둥지 소집 연사 창).
//
// ## ⚠️ 왜 쿨다운 감산보다 **앞**인가 — 뒤에 두면 BD8 이 원리적으로 못 산다
// 루프 본문은 `if (cooldown > 0) { cooldown--; continue; }` 라, 앵커를 그 뒤에 두면
// **쿨다운이 0 인 틱에만** 불린다. 그러면 이 앵커로는 "쿨다운을 무시하고 지금 쏜다"(BD8) 를
// 표현할 방법이 없고, 간격 단축(BD9·NU4)도 *다음* 발부터만 걸려 한 주기 늦다. 앞에 두는
// 대가는 병아리 1기당 매 틱 훅 1회인데, 훅 첫 줄이 `ownerId !== BROOD_MARK` 조기 반환이라
// 센트리·드론 베이 런에서는 비교 한 번이다.
//
// ## ⚠️ 포탑은 해츨링 전용이 아니다 — 게이트는 **훅 안**이다(㉖ 과 같은 규율)
// `stepTurrets` 는 병아리(`BROOD_MARK`) · 액티브 센트리 · 자율 드론 베이(`DRONE_MARK`)를 한
// 루프로 돈다. 앵커에서 소환물 종류로 미리 거르지 않는다 — 훗날 센트리를 만지는 축이 다시
// 막힌다.
//
// ## ⚠️ 촉매 짝이 없다 — ⑮·⑰~㉔·㉖ 과 같다.

/**
 * 앵커 ㉗ 이 넘기는 **이 포탑의 이번 틱 사격 리듬**. 훅이 제자리에서 고친다.
 *
 * ## ⚠️ 칸이 하나뿐인 이유 — **증명한 칸만 연다**
 * 정찰이 지목한 `suppressFire`(SH4「품기 진형」의 사격 정지)는 **열지 않았다.** SH4 의
 * 반대급부인 *"적탄을 몸으로 막는다"* 는 적탄↔병아리 충돌 경로가 코드에 0건이라(`collision.ts`
 * ·`bullets.ts` 에 포탑 대상 판정 grep 0건) 이 레인에서 성립하지 않고, 정지만 넣으면 SH4 가
 * **순손해 스킬**이 된다 — BD10 이 탄 피해 축 없이 상한만 깎였을 때와 같은 형태다. 칸만 미리
 * 열어 두면 *"배선이 있다"* 는 착각이 남으므로(앵커 ⑮ 주석) 소비처가 생기는 레인이 열어라.
 */
export interface TurretCadenceParams {
  /**
   * 이 포탑이 **이번에 쏘고 나서** 세울 쿨다운 틱. 초기값은 `events.ts` 의
   * `TURRET_FIRE_COOLDOWN`(=10).
   *
   * ## ⚠️ 클램프에 안 삼켜진다 — 소비 경로를 짚었다
   * `stepTurrets` 는 `if (fireTurretShot(...)) t.cooldown = <이 값>` 으로 **그대로** 대입하고,
   * 다음 틱부터 `if (cooldown > 0) cooldown--` 로 순수 감산한다. `min`·`max` 가 하나도 없다.
   * ⚠️ **훅이 하한을 스스로 걸어라** — 0 이나 음수를 넣으면 `cooldown > 0` 이 영원히 거짓이라
   * 매 틱 발사가 된다(BD5 가 `0` 클램프로 피한 것과 같은 함정의 반대편이다).
   */
  cooldownTicks: number;
  /**
   * 이 포탑이 **이번 틱에 사격 자체를 정지**하는가(해츨링 SH4「품기 진형」선결, 배치7 F2b).
   * 기본값 `false` — 미투자·미소비 런은 이 필드가 항상 거짓이라 `stepTurrets` 가 아래
   * 분기를 절대 타지 않고 비트 동일이다.
   *
   * ⚠️ **선택 필드다.** 필수로 만들면 이 레코드를 손으로 짓는 기존 픽스처
   * (`tests/skillHatchling.test.ts` 의 `cadence()` 등)가 깨진다(`VolleyParams.recordSpawnOrigin`
   * 의 "선택 필드다" 규율과 같은 사유). 훅이 안 채우면 `undefined` 라 `if (params.suppressed)` 가
   * 자연히 거짓이다 — 명시적으로 `false` 를 넣을 필요가 없다.
   *
   * ## 소비 경로 — `cooldownTicks` 보다 강하다(먼저 검사한다)
   * `stepTurrets` 는 이 값이 참이면 **쿨다운 감산도 격발도 둘 다 건너뛴다**(쿨다운 보존).
   *
   * ## ⚠️ 왜 감산까지 막는가 — "정지" 가 리듬 자체를 멈추는 것이지 공짜로 흘려보내는 게 아니다
   * 감산만 허용하고 격발만 막으면, 정지가 오래 걸릴수록 쿨다운이 0 밑으로 계속 감산되어
   * **해제되는 순간 그 포탑이 즉시(그리고 어쩌면 여러 발 밀려) 쏜다** — "진형이 풀리자마자
   * 일제 사격" 이 되어 SH4 의 설계 의도(사격을 죽이는 대신 몸으로 막는다)와 정반대로 읽힌다.
   * 쿨다운을 그 자리에 묶어 두면 해제 직후 리듬이 정지 **전과 정확히 같은 지점**에서 이어진다.
   */
  suppressed?: boolean;
}

/**
 * 앵커 ㉗ — **포탑 1기의 이번 틱 리듬이 정해지기 직전**(쿨다운 감산보다 앞).
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라**(㉖ 과 같은 계약 — `stepTurrets` 는 매 틱 전 포탑을 돈다).
 *  - ⚠️ **엔티티를 낳지 마라.** 이 지점은 `state.entities` **순회 안**이다.
 *  - ⚠️ **`turret.cooldown` 을 여기서 직접 만지지 마라.** 바로 다음 줄이 그 값을 읽어 감산
 *    여부를 정한다 — 여기서 0 으로 밀면 "이 앵커가 정한 리듬" 과 실제 리듬이 갈린다.
 *    즉시 격발이 필요한 축(BD8·NU4)은 **액티브 핸들러**가 발동 틱에 `cooldown = 0` 을 쓴다
 *    (`stepActives` 가 `stepTurrets` 보다 앞이라 같은 틱에 나간다).
 *
 * @param turret 이 포탑 개체. **소환물 종류 판별은 훅 책임이다**(`ownerId`).
 */
export function onTurretCadence(
  state: WorldState,
  turret: Entity,
  params: TurretCadenceParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case` 를 여기에 넣는다. **`break;` 를 반드시 붙여라**(누적 5건 전례).
    case SIG_HATCHLING_BROOD:
      hatchlingTurretCadence(state, turret, params);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ㉘ 이 넘기는 **이번 틱의 젬 자석 파라미터**. 훅이 제자리에서 고친다.
 *
 * ## 왜 인자 나열이 아니라 레코드인가
 * `VolleyParams`·`TurretShotParams` 와 같은 사유다 — 이 지점을 기다리는 축이 7종이고 고치려는
 * 칸이 서로 달라, 인자로 늘어놓으면 칸이 하나 늘 때마다 앵커 시그니처가 바뀐다.
 */
export interface GemMagnetParams {
  /**
   * 플레이어 자석 반경. 초기값은 `stepGems` 가 이미 계산한 값(자석 버프 배율까지 반영).
   *
   * ## ⚠️ 클램프에 안 삼켜진다 — 소비 경로를 끝까지 따라갔다
   * `stepGems` 는 이 값을 제곱해(`r2`) 거리와 비교할 뿐이고, 그 비교 뒤의 흡인 속도는
   * `MAGNET_SPEED` 상수라 반경과 무관하다. 경로에 `min`·`max` 가 하나도 없다.
   */
  radius: number;
  /**
   * 병아리(brood) 중심의 **추가** 흡인 반경. 초기값 0 = 추가 흡인 없음.
   *
   * ## ⚠️ 지금 소비처가 **없다** — 해츨링 NU1 이 얹힐 자리다
   * "소비처 없는 칸을 미리 열지 마라"(앵커 ㉖ doc)의 예외다. 사유는 **필수 필드를 나중에
   * 더하면 다른 레인의 픽스처가 `Partial` 스프레드로 깨지기 때문**이고, 그 사고는 배치1 에서
   * 실제로 났다. 레코드 **필드 설계**는 소비처보다 먼저 확정하는 것이 싸다.
   * ⚠️ 그러니 이 필드가 있다고 *"NU1 이 배선됐다"* 로 읽지 마라 — 지금은 `stepGems` 가
   * 읽기만 하고 **아무 일도 하지 않는다**(값이 0 이라 산술도 없다).
   */
  broodRadius: number;
}

/**
 * 앵커 ㉘ — **젬 자석 반경이 확정된 직후 · 흡인 루프가 돌기 직전**(`world.ts` 의 `stepGems`).
 *
 * ## 이 지점에서만 살아 있는 것
 *  - **반경이 아직 제곱되기 전**이다. `r2` 계산 뒤로 미루면 훅이 제곱값을 고쳐야 하고 그러면
 *    "반경 ×1.5" 같은 설계 문면이 훅마다 `×2.25` 로 번역돼 조용히 갈린다.
 *  - 앵커 ③(`onGemCollected`)은 **수거가 끝난 뒤**라 반경이 무의미하다. 그래서 말로우 ME2 ·
 *    브루저 MO2 가 그 자리에서 원리적으로 닿지 않았다(앵커 ③ 의 `case` 주석이 그 기록이다).
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.**
 *  - ⚠️ **여기서 젬을 수거하지 마라.** 수거의 단일 수렴점은 `collectGem` 이고 앵커 ③ 이 그
 *    자리다. 여기서 직접 걷어가면 콤보·XP 가 두 곳에서 갈린다.
 */
export function onGemMagnetParams(
  state: WorldState,
  player: Entity,
  params: GemMagnetParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // ⚠️ `break;` 필수(앵커 ㉗ 주석과 같은 사유).
    case SIG_MALLOW_CUSHION:
      // ME2 채무 자석 — 부채(`player.aux0`)에 비례해 반경이 커진다.
      mallowGemMagnetParams(state, player, params);
      break;
    case SIG_BUBBLE_FILM:
      // DR5 무지개 공명(콤보 → 반경) · DR10 공막 유속(무막 흡인 가속).
      bubbleGemMagnetParams(state, player, params);
      break;
    case SIG_ARC_OVERCHARGE:
      // BA2 정지 흡인장 — 정지 시간(`player.aux0`)에 비례해 반경이 커진다.
      arccasterGemMagnetParams(state, player, params);
      break;
    case SIG_HATCHLING_BROOD:
      // NU1 모이 물어오기 — `broodRadius` 의 **첫 소비처**(소비 경로는 `stepGems`).
      hatchlingGemMagnetParams(state, params);
      break;
    case SIG_BRUISER_ARMOR:
      // MO2 파쇄 수확 — 근접 임계 안은 자석 반경과 **무관하게** 끌리도록 하한을 세운다.
      bruiserGemMagnetParams(state, player, params);
      break;
    default:
      break;
  }
}

/**
 * 앵커 ㉙ 이 넘기는 **이번 틱의 플레이어 이동 파라미터**. 훅이 제자리에서 고친다.
 */
export interface PlayerMoveParams {
  /**
   * 이동 속도에 **곱해지는** 배율. 초기값 1 — 미투자 런은 `v * 1 === v` 로 비트 동일이라
   * 골든 해시가 바이트 불변이다.
   *
   * ⚠️ **대시 임펄스에는 안 걸린다.** 호출부가 이 배율을 `mx * playerSpeed` 쪽에만 곱하고
   * 대시 가산(`dx * dashSpeed`)은 그 뒤에 별도로 더한다 — 감속 지대(`PLAYER_SLOW_MULT`)·
   * 모듈 감속(`attackerSlowMult`)이 지켜 온 규율 그대로다. 대시 거리를 바꾸려는 스킬은
   * 여기가 자리가 아니다.
   */
  speedMult: number;
  /**
   * 이번 틱 시작 시점의 `state.playerSlowTicks`. **훅이 고치면 호출부가 그대로 되쓴다.**
   *
   * ## ⚠️ 이 칸이 「감속 부여 지점에 손잡이가 없다」는 누적 결함의 해소다
   * 직전 배치의 브루저 **MO4「장갑 활주」**(이동 감속 디버프가 걸리는 틱에 장갑 1개를 소모해
   * 그 감속을 무효화한다)가 *"한 틱 늦다"* 로 남은 것이 정확히 이 자리가 없었기 때문이다 —
   * 감속을 **부여하는** 지점(해저드 접촉·냉기)은 여럿이고 앵커가 하나도 없어서, 무효화가
   * 부여 다음 틱에야 가능했다. 이 앵커는 감속이 **소비되기 직전**(배율 산출 앞)이라
   * 부여 지점이 몇 개든 상관없이 그 틱 안에서 0 으로 되돌릴 수 있다.
   *
   * ⚠️ **MO4 를 이 커밋이 고치지 않았다.** 이 앵커가 그 문을 열었다는 기록일 뿐이고, 실제
   * 배선(장갑 스택 1 소모 + `slowTicks = 0`)은 브루저 레인 몫이다. 얹을 때 **감소 순서**를
   * 확인해라 — 호출부는 되쓴 값을 보고 배율을 정한 **뒤** 1 을 깎는다.
   */
  slowTicks: number;
}

/**
 * 앵커 ㉙ — **이동 속도가 대입되기 직전**(`world.ts` 의 `stepPlayer` · 감속 배율 산출 **앞**).
 *
 * ## 이 지점에서만 살아 있는 것
 *  - **감속 잔여 틱이 아직 안 깎였고 배율도 아직 안 정해졌다.** 그래서 감속을 무효화하는
 *    스킬(브루저 MO4)과 속도를 올리는 스킬(말로우 CU8)이 **같은 틱 안에서** 성립한다.
 *  - 앵커 ⑨(`onSignatureStep`)는 `stepShipSignature` 진입점이고 `stepPlayer` 와 다른 함수라
 *    이 지역 변수들에 닿지 않는다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.**
 *  - ⚠️ **`player.vx`/`vy` 를 직접 쓰지 마라.** 호출부가 이 훅 **직후에 통째로 대입**하므로
 *    여기서 쓴 값은 그 자리에서 사라진다. 속도를 바꾸려면 반드시 `params.speedMult` 다.
 *  - ⚠️ **매 틱 불린다.** 나눗셈·루프를 넣기 전에 비용을 생각해라(레벨 스케일의 나눗셈은
 *    투자 게이트 **안**에 둔다 — `skills/striker.ts` 헤더 규율 ③).
 */
export function onPlayerMoveParams(
  state: WorldState,
  player: Entity,
  params: PlayerMoveParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // ⚠️ `break;` 필수(앵커 ㉗ 주석과 같은 사유).
    case SIG_MALLOW_CUSHION:
      // ME3 무통 주행(감속 → 부채 대납) · CU8 통증 마취(부채 보유 중 이속 상승).
      mallowPlayerMoveParams(state, player, params);
      break;
    case SIG_BUBBLE_FILM:
      // DR4 공막 경량화 — 막이 없는 동안(`aux0 === 0`) 감속 면역 + 이속 상승.
      bubblePlayerMoveParams(state, player, params);
      break;
    case SIG_PHANTOM_CLOAK:
      // PH4 무흔 보행 — 은신 창 동안 이속 상승 + 이동 감속 면역.
      phantomPlayerMoveParams(state, player, params);
      break;
    case SIG_STRIKER_MARKSMAN:
      // M10 이중 추진 — `params` 가 아니라 `player.dashCooldown` 을 만진다. 이 앵커가
      // **쿨다운 감산·대시 게이트보다 앞**이라는 사실 하나로 성립하는 배선이다(그 함수 doc).
      strikerPlayerMoveParams(state, player, params);
      break;
    case SIG_BRUISER_ARMOR:
      // MO4 장갑 활주(`slowTicks = 0` — 이 앵커가 그 "0틱 무효화" 를 성립시켰다) ·
      // MO3 둔중 관성(`speedMult` 램프).
      bruiserPlayerMoveParams(state, player, params);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ㉟ (S3-해츨링) — **포탑이 수명으로 소멸한 직후**(`stepTurrets` 의 `life === 0` 분기)
// ---------------------------------------------------------------------------
//
//   ㉟ onTurretExpired — `t.dead = true` 직후. 해츨링 BD3(작별 격발) · NU9(둥지 표식) ·
//                        SH9(이소 둥지).
//
// ## ⭐ 이 앵커가 특별한 이유 — **「소멸 경로 전수」가 이것 하나로 닫힌다**
// 설계 ②말미의 「소멸 경로 전수 표」는 BD3·NU9 가 **모든** 소멸 경로에서 발화할 것을
// 요구한다. 병아리의 소멸 경로는 셋뿐이고 나머지 둘(SH1 호위 희생 · SH7 회생 부화)은
// **이미 `skills/hatchling.ts` 의 `killChick` 안**이다 — 그 함수가 `aux1 = 1`(사유 = 희생)을
// 적어 두었고, 그 값의 독자가 없다는 것이 배치 5 헤더 사유 3묶음이 미배선 이유로 든 바로 그
// 반쪽이었다. 이 앵커가 셋째(자연 만료) 경로를 열어 **BD3·NU9 가 세 경로 전부에서** 돌고,
// 동시에 `aux1` 의 첫 독자(SH9)가 생긴다.
//
// ## ⚠️ 왜 `t.dead = true` **직후**인가
// 앞에 두면 훅이 "소멸했다" 를 아직 모르고(수명 0 은 다음 줄이 판정한다), 루프 밖으로 미루면
// `compact()` 가 이미 개체를 회수해 **좌표가 남지 않는다** — 세 스킬이 전부 *"그 자리에"* 를
// 요구하므로 좌표 유실은 곧 미배선이다.
//
// ## ⚠️ 이 앵커는 자연 만료 **전용**이다
// SH1·SH7 의 강제 소멸은 여기 오지 않는다(그쪽은 `dead` 를 스스로 세우고 이 루프는 다음
// 틱에 `t.dead` 로 걸러 낸다). 「자연 만료만」이 조건인 축(SH9)이 그 사실에 의존하고,
// 「전수」가 조건인 축(BD3·NU9)은 훅 쪽에서 `killChick` 과 **같은 헬퍼**를 부른다.
//
// ## ⚠️ 촉매 짝이 없다 — ⑮·⑰~㉔·㉖·㉗ 과 같다.

/**
 * 앵커 ㉘ — **포탑 1기가 수명을 다해 죽은 직후**(`t.dead = true` 직후 · `continue` 앞).
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라**(㉖·㉗ 과 같은 계약).
 *  - ⚠️ **`turret.dead` 를 되돌리지 마라.** 수명 만료는 world 의 판정이고, 되살리면
 *    `TURRET_LIFE_TICKS` 계약과 상한 계수가 통째로 갈린다.
 *  - ⚠️ 엔티티 생성은 **허용된다** — 이 루프가 이미 `fireTurretShot` → `spawnBullet` 으로
 *    배열 말미에 append 하고 있고, 새로 붙는 개체는 `isActiveTurret` 이 거짓이라 같은 틱의
 *    남은 순회가 그것을 건너뛴다(`for…of` 가 새 원소를 보더라도 무연산이다). 순회 **중간**을
 *    바꾸는 조작(정렬·삭제)만 금지다.
 *
 * @param turret 방금 소멸한 포탑 개체. **소환물 종류 판별은 훅 책임이다**(`ownerId`).
 */
export function onTurretExpired(state: WorldState, turret: Entity): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case` 를 여기에 넣는다. **`break;` 를 반드시 붙여라**(누적 5건 전례).
    case SIG_HATCHLING_BROOD:
      hatchlingTurretExpired(state, turret);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 배치7 F2b 셋 — **표적 공유 · 탄받이** (해츨링 BD4 · SH8 선결)
// ---------------------------------------------------------------------------
//
//   onAutoAimTarget    — 플레이어 자동조준이 표적을 확정한 직후(`world.ts` 의 `autoAttack`).
//   onTurretTargetPick — 포탑 1기가 `nearestTarget` 을 부르기 **앞**(`world.ts` 의 `fireTurretShot`).
//   onEnemyBulletMoved — 적탄이 이번 틱 위치 적분을 끝낸 직후(`world.ts` 의 적탄 이동 루프).
//
// ⛔ **동그라미 번호를 붙이지 않는다** — ㉖ 에서 끝났다(파일 헤더). 정본은 함수 이름이다.
//
// ## 왜 셋을 한데 묶었는가
// BD4「표적 공유」는 *플레이어가 고른 표적을 병아리도 우선 쏜다* 이고, 그러려면 (a) 플레이어
// 표적을 **기록할 자리**와 (b) 포탑이 그 기록을 **읽을 자리**가 둘 다 있어야 한다 — 한쪽만
// 열면 반쪽 배선이다. SH8「탄받이 깃털」은 이 표적 공유와 무관하지만 같은 배치의 같은 포탑
// 계열(병아리) 선결이라 옆에 둔다.
//
// ## ⚠️ 촉매 짝이 없다 — ⑮·⑰~㉔·㉖㉗ 과 같다.

/**
 * 앵커 — **플레이어 자동조준이 이번 틱 표적을 확정한 직후**(`world.ts` 의 `autoAttack`,
 * `nearestTarget` 호출 바로 뒤 · 사거리 밖이라 표적이 없으면 이 앵커에 도달하지 않는다).
 * 해츨링 BD4「표적 공유」선결.
 *
 * ## 왜 필요한가 — 포탑 사격 시점에는 이 정보가 이미 없다
 * 병아리(포탑)의 사격 시점(`fireTurretShot`)은 `autoAttack` 과 **다른 함수·다른 틱 단계**다.
 * `autoAttack` 의 표적은 그 함수의 지역 변수(`const target`)라 함수가 끝나면 사라진다. BD4 가
 * "병아리도 플레이어가 고른 표적을 우선 쏜다" 를 표현하려면 그 표적을 **어딘가에 기록**해
 * 다음 틱(또는 같은 틱의 뒤 단계) 포탑 사격까지 살려 둬야 한다.
 *
 * ## ⚠️ 기록 자체는 이 앵커의 일이 아니다 — 배선 레인의 몫이다
 * 이 함수는 자리만 연다(전 분기가 비어 있다). 슬롯 쓰기(`writeSlot`)로 표적 id 를 기록하는
 * 것은 `case SIG_HATCHLING_BROOD` 가 생길 때 그 안에서 한다 — "미리 열어 둔 자리가 배선이
 * 있다는 착각을 만든다"(앵커 ⑮ 주석)와 같은 사유로, 지금은 훅 본문을 비워 둔다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라**(공통 계약).
 *  - ⚠️ **`target`을 죽이거나 좌표를 바꾸지 마라.** 이 앵커는 관측 전용이다 — 이 표적은 이번
 *    틱 플레이어 발사가 이미 겨눈 그 개체이므로, 여기서 건드리면 `autoAttack` 의 나머지 로직
 *    (아직 안 끝났다 — 이 앵커는 발사 파이프라인 **중간**이다)까지 갈린다.
 *
 * @param target 이번 틱 자동조준이 확정한 표적.
 */
export function onAutoAimTarget(state: WorldState, player: Entity, target: Entity): void {
  if (!state.skillsOn) return;
  void player;
  void target;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case` 를 여기에 넣는다. **`break;` 를 반드시 붙여라**(누적 5건 전례).
    default:
      break;
  }
}

/**
 * 앵커 `onTurretTargetPick` 이 넘기는 **우선 표적 지정**. 훅이 제자리에서 고친다.
 *
 * ## 왜 레코드인가 — 값이 아니라 "지정했는가/안 했는가" 자체가 신호다
 * `targetId` 가 0(엔티티 id 는 1부터 시작 — `world.ts` `nextEntityId = 1`)이면 *지정 없음*
 * 이고, `fireTurretShot` 은 종전대로 `nearestTarget` 을 부른다. 인자 나열이 아니라 레코드로
 * 연 이유는 `TurretShotParams`·`TurretCadenceParams` 와 같다 — 소비처가 늘 때 칸만 더한다.
 */
export interface TurretTargetPick {
  /**
   * 이 포탑이 **우선** 쏠 표적의 엔티티 id. `0` = 지정 없음(폴백: `nearestTarget`).
   *
   * ## ⚠️ 무효 표적(죽었거나 사거리 밖) 폴백 규약 — **종전 경로로 돌아간다**
   * `fireTurretShot` 은 이 id 로 엔티티를 찾아 ①`dead` 이거나 ②포탑 사거리(`TURRET_RANGE`)
   * 밖이면 **이 지정을 버리고** `nearestTarget` 을 그대로 부른다. 무효 지정을 그대로 밀어붙여
   * "사거리 밖 표적을 향해 허공 발사" 나 "죽은 표적을 향해 무발사" 를 만들지 않기 위해서다 —
   * BD4 의 취지는 *"우선순위 힌트"* 이지 *"조회를 대체"* 가 아니다. 폴백이 없으면 플레이어가
   * 방금 표적을 바꾼 틱에 병아리가 허공에 대고 쏘는 정지 사격이 생긴다.
   */
  targetId: number;
}

/**
 * 앵커 `onTurretTargetPick` — **포탑 1기가 `nearestTarget` 을 부르기 직전**(`fireTurretShot`).
 * 해츨링 BD4「표적 공유」선결.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라**(㉖ 과 같은 계약 — `fireTurretShot` 은 RNG 미소비가 계약이다).
 *  - ⚠️ **엔티티를 낳지 마라.** 이 지점은 `stepTurrets` 의 `state.entities` **순회 안**이다
 *    (㉖ 과 같은 규율).
 *
 * @param turret 이 발을 쏘는 포탑 개체. **소환물 종류 판별은 훅 책임이다**(`ownerId`).
 */
export function onTurretTargetPick(
  state: WorldState,
  turret: Entity,
  pick: TurretTargetPick,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case` 를 여기에 넣는다. **`break;` 를 반드시 붙여라**(누적 5건 전례).
    default:
      break;
  }
  void turret;
  void pick;
}

/**
 * 앵커 `onEnemyBulletMoved` — **적탄이 이번 틱 위치 적분(과 수명 감산)을 끝낸 직후**
 * (`world.ts` 의 적탄·아군탄 공용 이동 루프, `kind === 'enemyBullet'` 만). 해츨링 SH8「탄받이
 * 깃털」선결(설계서 구현안 A — 적탄 이동 판정에 근접 검사, 틱당 O(적탄×생존 병아리 ≤5)).
 *
 * ## 왜 필요한가 — 적탄↔병아리 충돌 경로가 코드에 0건이었다
 * 적탄이 실제로 소비되는 지점은 플레이어 탐침(`grid.query` 안의 `if (t.kind === 'enemyBullet')`)
 * **한 곳뿐**이고 그것은 플레이어 반경 판정이다. 병아리(`kind: 'turretPickup'` +
 * `ownerId === BROOD_MARK`)를 향한 적탄 판정은 어디에도 없었다(`collision.ts`·`bullets.ts` grep
 * 0건). 이 앵커가 그 판정 지점을 연다 — **직접 `dead=true`** 로 소거하는 형태다.
 *
 * ## 반환값 — `true` 면 이 앵커가 그 탄을 **소거한다**
 * 반환은 `boolean`이다(이 파일의 다른 앵커 대부분과 다르다 — {@link survivedLethalBlow} 처럼
 * "판정 결과"가 곧 사건이라 레코드보다 반환값이 자연스럽다). 호출부가 `true` 를 받으면 그
 * 자리에서 `e.dead = true` 를 세우고 이번 틱 나머지 처리(벽 스윕 등)를 건너뛴다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **훅이 없는 런은 비트 동일이어야 한다.** 전 분기가 `false` 를 반환하므로(빈 스위치의
 *    기본 반환), 미투자·미소비 런은 이 앵커가 매 적탄마다 불려도 결과가 전부 무시된다.
 *  - ⚠️ **RNG 를 소비하지 마라**(공통 계약).
 *  - ⚠️ **엔티티를 낳지 마라.** 이 지점은 적탄·아군탄 공용 루프의 `state.entities`
 *    **순회 안**이다 — `spawnBullet` 의 말미 append 조차 안전하지 않다(이 루프는 `bulletSplits`
 *    처럼 지연 스폰 버퍼를 따로 쓴다, 호출부 주석 참조).
 *  - ⚠️ **`life` 를 병아리 판별에 재활용하지 마라.** F1 레인이 적(`enemy`/`boss` kind) 정지
 *    상태이상에 `life` 를 재활용할 예정이다 — 병아리는 `kind: 'turretPickup'` 이라 칸이 겹치지
 *    않지만, 다음 레인이 헷갈리지 않도록 여기 명시한다.
 *
 * @param bullet 이번 틱 위치가 이미 갱신된 적탄. 좌표는 **이번 틱의 최종 위치**다.
 */
export function onEnemyBulletMoved(state: WorldState, bullet: Entity): boolean {
  if (!state.skillsOn) return false;
  let consumed = false;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case` 를 여기에 넣는다. **`break;` 를 반드시 붙여라**(누적 5건 전례).
    default:
      break;
  }
  void bullet;
  return consumed;
}

// ---------------------------------------------------------------------------
// 벽 축 앵커 3개 (배치5) — **아군탄·적탄이 벽에 겹친 순간**(`world.ts` 의 `stepProjectiles`)
// ---------------------------------------------------------------------------
//
//   onWallHit          — 겹침 확정 직후 · `w.hp -= e.damage` **앞**. 브루저 BL7 · 팬텀 AS10.
//   onWallDestroyed    — `w.dead = true` 직후. 브루저 MO7.
//   onWallShockResolve — 투사체 루프 **밖**(스폰 안전). 브루저 BL7 의 충격파.
//
// ## ⚠️ 왜 세 자리인가 — 하나로는 원리적으로 안 된다
// 세 스킬이 요구하는 순간이 서로 다르다:
//  - BL7「파성퇴」는 **감산 앞**이어야 한다(일격 파괴 = 이번 히트의 피해를 바꾼다). 감산 뒤에
//    두면 `w.hp` 가 이미 깎여 "일격" 을 표현할 방법이 없다.
//  - MO7「잔해 회수」는 **파괴가 확정된 뒤**여야 한다(환급의 술어가 "부서졌는가" 다).
//  - BL7 의 충격파는 **루프 밖**이어야 한다 — 위 둘은 `for (const e of state.entities)` 순회
//    **안**이라 개체를 낳으면 안 된다(앵커 ㉖ 과 같은 규율). 그래서 훅은 `WallHitParams.shockAt`
//    에 요청만 적고, 호출부가 루프 뒤에 모아서 `onWallShockResolve` 로 되돌려준다. 같은 파일의
//    `bulletSplits`(BK_SPLIT 자탄)가 이미 쓰고 있는 지연 스폰 형태 그대로다.
//
// ## ⚠️ 게이트가 훅 안이다 — 앵커는 탄 종류·벽 종류로 미리 거르지 않는다
// `onWallHit` 은 **아군탄·적탄 · 파괴가능·불파괴 벽 전부**에서 불린다. AS10「유령 탄도」의
// 문면이 *"탄이 벽을 통과한다(파괴가능 벽은 피해를 주고 통과한다)"* 라 불파괴 벽에서도
// 통과해야 하기 때문이다. 반대로 `params.damage` 는 **아군탄 × 파괴가능 벽**에서만 소비된다
// (호출부의 기존 분기 그대로) — 적탄에서 이 칸을 만져도 아무 일도 일어나지 않는다.
//
// ## ⚠️ 촉매 짝이 없다 — ⑮·⑰~㉔·㉖·㉗ 과 같다.

/**
 * `WallHitParams.shockAt` 이 실어 보내는 **지연 스폰 요청**. 훅이 채우고, 투사체 루프가 끝난 뒤
 * `onWallShockResolve` 로 같은 훅에게 되돌아온다.
 *
 * ## ⚠️ 이 레코드는 **좌표와 방향만** 나른다 — 볼리의 모양은 훅 몫이다
 * 발수·각도폭·피해를 여기 적으면 `world.ts` 가 스킬 밸런스를 알게 되고, 그러면 수치가
 * `skills/bruiser.ts` 와 두 곳으로 갈린다(설계서가 반복 지적한 "같은 술어의 두 번째 사본").
 */
export interface WallShockRequest {
  /** 벽에 닿은 지점(= 탄의 이번 틱 종말 좌표). */
  x: number;
  y: number;
  /** 탄의 진행 방향(단위 벡터 아님 — 훅이 정규화해라). "전방" 의 정본이다. */
  dirX: number;
  dirY: number;
}

/**
 * 앵커 `onWallHit` 이 넘기는 **이번 벽 겹침의 파라미터**. 훅이 제자리에서 고친다.
 */
export interface WallHitParams {
  /**
   * 이 탄이 벽에 줄 피해. 초기값은 `e.damage`.
   *
   * ## ⚠️ 클램프에 안 삼켜진다 — 소비 경로를 짚었다
   * 호출부는 `w.hp -= <이 값>` 뒤 `if (w.hp <= 0) w.dead = true` 뿐이고 `min`·`max` 가 없다.
   * BL7 의 "일격 파괴" 는 이 칸에 `w.hp` 이상을 넣는 것으로 성립한다.
   * ⚠️ **아군탄(`kind === 'bullet'`) × 파괴가능 벽에서만 소비된다.**
   */
  damage: number;
  /**
   * true 면 **탄이 이 벽에서 죽지 않고** 스윕이 다음 벽으로 계속된다. 초기값 false.
   *
   * ## ⚠️ 피해는 그대로 들어간다 — "통과" 는 소멸만 막는다
   * AS10 의 문면이 *"파괴가능 벽은 피해를 주고 통과한다"* 라 감산 분기보다 **뒤**에서 갈린다.
   * ⚠️ 같은 틱에 여러 벽을 통과하면 **각 벽마다 피해가 한 번씩** 들어간다(스윕이 계속되므로).
   * 관통(`pierce`)과는 다른 축이다 — `pierce` 는 적 명중 카운터고 벽 스윕은 그것을 안 본다.
   */
  passThrough: boolean;
  /**
   * 투사체 루프가 끝난 뒤 훅에게 되돌려 줄 스폰 요청. 초기값 null = 요청 없음.
   *
   * ## ⚠️ 지금 소비처가 **하나뿐이다**(브루저 BL7) — 그래도 미리 연 이유
   * "소비처 없는 칸을 미리 열지 마라"(앵커 ㉖ doc)의 예외다. `GemMagnetParams.broodRadius` 와
   * 같은 사유 — **필수 필드를 나중에 더하면 다른 레인의 픽스처가 `Partial` 스프레드로 깨진다**
   * (배치1 에서 실제로 났다). 이 레코드는 팬텀 AS10 레인도 동시에 만지므로 필드 설계를 먼저
   * 확정하는 것이 싸다.
   */
  shockAt: WallShockRequest | null;
}

/**
 * 벽 축 앵커 ①/③ — **탄과 벽의 겹침이 확정된 직후 · `w.hp` 감산 앞**.
 *
 * ## 이 지점에서만 살아 있는 것
 *  - **벽이 아직 안 깎였다.** `wall.hp` 가 이번 히트 **전** 값이라 "일격 파괴"(BL7)가 성립한다.
 *  - **탄이 아직 안 죽었다.** `bullet.dead` 는 이 훅 뒤에 세워지므로 `passThrough` 로 되돌릴 수
 *    있다. 훅이 나간 뒤에는 `compact()` 를 기다릴 뿐 되살릴 자리가 없다.
 *  - `bullet.x`/`y` 는 **이번 틱 적분이 끝난 좌표**이고 `bullet.vx`/`vy` 가 진행 방향이다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라**(전 앵커 공통 계약 — 파일 헤더).
 *  - ⚠️ **엔티티를 낳지 마라.** 이 지점은 `state.entities` **순회 안**이다. 스폰이 필요하면
 *    `params.shockAt` 에 적어라 — 루프 뒤 `onWallShockResolve` 로 돌아온다.
 *  - ⚠️ **`wall.dead` 를 직접 세우지 마라.** 파괴 판정은 호출부의 `w.hp <= 0` 이고, 여기서
 *    미리 세우면 `onWallDestroyed` 가 안 불려 MO7 이 조용히 죽는다. 파괴하려면 `damage` 다.
 *
 * @param bullet 벽에 겹친 투사체. **아군탄/적탄 판별은 훅 책임이다**(`kind`).
 * @param wall 겹친 벽. **파괴가능 여부 판별은 훅 책임이다**(`hp > 0`).
 */
export function onWallHit(
  state: WorldState,
  player: Entity,
  bullet: Entity,
  wall: Entity,
  params: WallHitParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case` 를 여기에 넣는다. **`break;` 를 반드시 붙여라**(누적 5건 전례).
    case SIG_BRUISER_ARMOR:
      // BL7 파성퇴 — 아군탄 × 파괴가능 벽을 **일격 파괴**하고 충격파 요청을 적는다.
      bruiserWallHit(state, player, bullet, wall, params);
      break;
    case SIG_PHANTOM_CLOAK:
      // AS10 유령 탄도 — 은신 창 중에 태어난 탄(`aux0` 표식)이 벽에서 안 죽는다.
      // 술어가 `player` 도 `wall` 도 아니라 **탄의 표식**이라 인자를 둘만 쓴다.
      phantomWallHit(state, bullet, params);
      break;
    default:
      break;
  }
}

/**
 * 벽 축 앵커 ② — **벽이 파괴된 직후**(`wall.dead = true` 다음 줄 · 탄 소멸 판정 앞).
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.**
 *  - ⚠️ **엔티티를 낳지 마라**(순회 안 — `onWallHit` 과 같다).
 *  - ⚠️ **`wall.dead` 를 되돌리지 마라.** 되살리면 이 앵커가 다음 히트에서 또 불린다.
 *
 * ## ⚠️ 이 앵커는 **탄에 의한 파괴 전용**이다
 * `destructible`(보상 오브젝트)의 파괴는 여기 오지 않는다 — 그쪽은 `compact()` 의 드랍 분기를
 * 탄다. MO7 의 문면이 *"파괴가능 벽·destructible"* 둘 다이므로 **destructible 쪽 절반은 이
 * 앵커로 안 풀린다** — 얹는 레인은 그 절반을 못 넣는 사유를 주석으로 남겨라.
 *
 * @param wall 방금 파괴된 벽.
 */
export function onWallDestroyed(state: WorldState, player: Entity, wall: Entity): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // ⚠️ `break;` 필수.
    case SIG_BRUISER_ARMOR:
      // MO7 잔해 회수 — 대시 쿨다운 환급 + 장갑 1스택 적립.
      // ⚠️ destructible 절반은 이 앵커로 안 풀린다(사유는 `bruiserWallDestroyed` 의 doc).
      bruiserWallDestroyed(state, player, wall);
      break;
    default:
      break;
  }
}

/**
 * 벽 축 앵커 ③ — **투사체 루프가 끝난 뒤**, `onWallHit` 이 적어 보낸 요청 1건마다.
 *
 * ## ⭐ 여기서는 **스폰이 안전하다**
 * `stepProjectiles` 의 `for (const e of state.entities)` 가 이미 끝난 지점이다(같은 함수의
 * `bulletSplits` 방사와 나란히 선다). 요청은 **적어 넣은 순서대로** 소비되므로 결정론이 산다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.**
 *  - ⚠️ **탄 상한(`state.bulletCap`)을 훅이 존중해라.** 호출부는 여기서 세지 않는다 —
 *    바로 옆 `bulletSplits` 가 `countKind` 로 스스로 지키는 것과 같은 규율이다.
 *
 * @param req `onWallHit` 이 적은 좌표·방향.
 */
export function onWallShockResolve(
  state: WorldState,
  player: Entity,
  req: WallShockRequest,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // ⚠️ `break;` 필수.
    case SIG_BRUISER_ARMOR:
      // BL7 파성퇴의 **전방 충격파** — 여기서만 스폰이 안전하다. 탄 상한은 훅이 스스로 지킨다.
      bruiserWallShockResolve(state, player, req);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 배치6 앵커 5개 — 배치5 가 「막는 자리」로 지목한 부류를 연다
// ---------------------------------------------------------------------------
//
//   onActiveExpired    — 액티브 버프가 만료된 직후(`actives.ts` 의 `ACTIVE_EXPIRE` 다음 줄).
//   onFilmBurstPost    — 방막 파열의 밀어내기 루프가 **끝난 뒤**(`filmBurst.ts`).
//   onGemPull          — 젬 1개의 흡인 판정 직전(`world.ts` 의 `stepGems` 루프 **안**).
//   onPickupRadius     — 픽업 접촉 반경이 정해진 직후(`world.ts` 의 `resolveCollisions`).
//   onPlayerWallSlide  — 플레이어↔벽 겹침 해소 **직전**(`world.ts` 의 `stepPlayer`).
//
// 배치5 종료 시점에 남은 34종의 사유를 부류로 묶으면 위 다섯이 최대 부류였다. 각각 소비처를
// **문면으로 확인한 뒤** 열었다 — 브루저 FO10 · 버블 PO4·FI7·DR8 · 스트라이커 M4 · 팬텀 DI9.
//
// ## ⚠️ 촉매 짝이 없다 — ⑮·⑰~㉔·㉖·㉗ 과 같다.

/**
 * 앵커 `onActiveExpired` — **액티브 버프가 이번 틱에 0 이 된 직후**(`stepActives` 의
 * `ACTIVE_EXPIRE[def.id]?.(...)` 다음 줄).
 *
 * ## 이 지점에서만 살아 있는 것
 *  - **「끝났다」는 사건 그 자체.** `onActiveFired` 는 **발동** 직후라 만료를 원리적으로 못
 *    본다 — 브루저 FO10「파열 소각장」(강화 액티브 **고티어의 만료 폭발**)과 스트라이커
 *    S9「만료 정지장」(생존 액티브가 **끝나는 틱**)이 정확히 그 이유로 배치3~5 내내 막혔다.
 *  - `buffTicks` 는 이미 0 이다. "얼마나 남았나"가 아니라 "방금 끝났다"만 참이다.
 *
 * ## ⚠️ **틱당 슬롯마다 최대 1회**다 — 매 틱이 아니다
 * 호출부가 `if (after > 0) SUSTAIN else if (before > 0) EXPIRE` 라, 이 앵커는 **버프가
 * 양수에서 0 으로 떨어진 그 한 틱**에만 불린다. 버프를 안 쓰는 액티브(즉발형)는 여기 안 온다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.**
 *  - ⚠️ **`state.activeCd0/1` 을 만지지 마라.** 쿨다운 감소는 이 루프보다 **앞**에서 이미
 *    끝났고, 여기서 고치면 다음 틱 감소와 겹쳐 한 틱이 조용히 사라진다.
 *  - ⚠️ **적 `hp` 를 깎으면 `dead` 를 같이 세워라**(정본 `status.ts` 111-112). `guardian`·`core`
 *    는 부활 분기가 있어 마킹 금지. 화상만 얹는 축은 해당 없다.
 *  - ⭐ **스폰은 안전하다** — `stepActives` 는 슬롯 2칸 루프일 뿐 `state.entities` 를 순회하지
 *    않는다(`onActiveFired` 와 같은 근거).
 *
 * @param def 방금 만료된 액티브의 정의. **계열·티어 판별은 훅 책임이다**(`def.treeIndex` ·
 *   `def.tier` · `def.kind`). FO10 의 문면이 "강화 액티브 **고티어**" 라 `tier` 가 그 손잡이다.
 * @param slot 슬롯 인덱스(0/1).
 */
export function onActiveExpired(
  state: WorldState,
  player: Entity,
  def: ActiveSkillDef,
  slot: number,
): void {
  if (!state.skillsOn) return;
  // 아직 소비처가 없는 인자들. 자기 `case` 가 쓰기 시작하면 해당 줄을 지워라.
  // (`player`·`def` 는 배치6 의 브루저 FO10 이 첫 소비처라 지웠다.)
  void slot;
  switch (state.sigBit) {
    // 배선 레인은 자기 `case` 를 여기에 넣는다. **`break;` 를 반드시 붙여라**(누적 13건 전례).
    case SIG_BRUISER_ARMOR:
      // FO10 파열 소각장 — 강화 액티브 **고티어**(`treeIndex 2` · `tier 'hi'` · `kind 'buff'`)의
      // 만료 폭발에 적탄 소거와 화상을 얹는다. 폭발 본체(`ACTIVE_EXPIRE`)는 **바로 앞 줄**에서
      // 이미 끝났고, 훅은 그 폭발의 반경(`def.coeff.blastRadius`)을 그대로 재사용한다.
      bruiserActiveExpired(state, player, def);
      break;
    default:
      break;
  }
}

/**
 * 방막 파열로 **밀려난 적 1기**의 밀어내기 전/후 좌표. `onFilmBurstPost` 가 배열로 받는다.
 *
 * ## ⚠️ 왜 「전」 좌표를 따로 나르는가 — 벽이 먹은 변위가 판정이기 때문이다
 * 버블 PO4「압착 충돌」의 문면이 "파열에 밀린 적이 **벽에 막히면** 충돌 피해" 다. 밀어내기
 * 목표 변위는 상수(`filmBurstPush()`)지만 `slideCircleWalls` 가 벽에서 되밀어내므로, **실제로
 * 이동한 거리가 목표보다 짧으면 그만큼 벽이 먹은 것**이다. 그 차이는 밀어낸 **뒤**에만
 * 존재하고(앵커 ⑮ 는 앞이라 아직 없다), 전 좌표를 안 실으면 사후에 복원할 방법이 없다.
 */
export interface FilmBurstPushed {
  /** 밀려난 적. ⚠️ `dead` 를 확인하고 써라 — 같은 틱의 다른 축이 먼저 죽였을 수 있다. */
  enemy: Entity;
  /** 밀어내기 **전** 좌표. */
  preX: number;
  preY: number;
}

/**
 * 앵커 ⑮ 가 넘기는 **이번 파열의 밀어내기 파라미터**. 훅이 제자리에서 고친다.
 *
 * ## ⚠️ 이 레코드가 FI7 을 연다
 * 버블 FI7「벽면 반향」의 문면이 "벽에 접촉 중 일어난 파열은 밀어내기 **반경과 변위**가
 * 강화된다" 인데, 앵커 ⑮ 는 값을 건네받지 못해 산술 바깥에 있었다(그 함수 주석이 그 사유를
 * 적고 있다). 그 두 칸이 여기 있다.
 */
export interface FilmBurstParams {
  /**
   * 밀어내기가 닿는 반경. 초기값은 `FILM_BURST_RADIUS`.
   *
   * ## ⚠️ 제곱 전이다 — "×1.5" 를 `×2.25` 로 번역하지 마라
   * 호출부가 이 값을 제곱해(`r2`) 거리와 비교한다. 앵커 ㉘(`GemMagnetParams.radius`)과 같은
   * 규율이고, 같은 이유로 클램프가 하나도 없다.
   */
  radius: number;
  /**
   * 밀어내기 변위(월드 유닛). 초기값은 `filmBurstPush()`.
   *
   * ⚠️ **반경과 변위의 부등식이 설계 계약이다** — 기본값은 변위 260 > 반경 220 이고, 그것이
   * "반경 안의 적을 반경 밖으로" 를 성립시킨다(`resolveFilmBurst` 주석). 반경만 키우고
   * 변위를 그대로 두면 **적이 반경 안에 남아** 그 계약이 조용히 깨진다 — FI7 이 둘 다
   * 강화하는 문면인 것이 우연이 아니다.
   */
  push: number;
}

/**
 * 앵커 `onFilmBurstPost` — **방막 파열의 밀어내기 루프가 끝난 뒤**(`resolveFilmBurst` 말미).
 *
 * ## ⚠️ 앵커 ⑮ 와 **둘 다 필요하다** — 하나로 못 합친다
 * ⑮ 는 밀어내기 **앞**이어야 한다: 반경 안의 적을 반경 밖으로 밀어내므로, 뒤에 두면 반경
 * 술어로 대상을 고르는 스킬(PO1·PO7·DR1)이 **전부 조용히 0건**이 된다(실측 — 배선 레인이
 * 훅을 뒤에 뒀다가 PO1 이 아무 피해도 안 주는 것을 테스트가 잡았다). 반대로 PO4 는 밀어낸
 * **결과**가 판정이라 앞에서는 원리적으로 못 산다. `resolveFilmBurst` 주석이 "그 스킬이 오면
 * 훅을 둘로 쪼개라(pre/post). 하나로 합치려 하면 둘 중 하나가 반드시 틀린다" 고 예고했다.
 *
 * ## ⭐ 여기서는 **스폰이 안전하다**
 * 밀어내기 루프(`for (const e of state.entities)`)가 이미 끝난 지점이다. 버블 PO8「잔거품
 * 기뢰」가 여기서 가능하다 — 단 그 스킬의 선결은 앵커가 아니라 **동시 생존 상한 규약**이다
 * (상한 없이 넣으면 파열 4회 창에 최대 36기가 서서 청크 예산 160 을 조용히 먹는다).
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.**
 *  - ⚠️ **적 `hp` 를 깎으면 `dead` 를 같이 세워라**(PO4 가 정확히 이 경우다 — 정본
 *    `status.ts` 111-112). `guardian`·`core` 는 마킹 금지.
 *
 * @param pushed 이번 파열이 실제로 민 적들. **밀린 적이 하나도 없으면 빈 배열**이다.
 *   ⚠️ 미투자 런에서는 호출부가 수집조차 하지 않아 **항상 빈 배열**이다(비용 0).
 */
export function onFilmBurstPost(
  state: WorldState,
  x: number,
  y: number,
  pushed: readonly FilmBurstPushed[],
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // ⚠️ `break;` 필수.
    case SIG_BUBBLE_FILM:
      // PO4 압착 충돌 — 밀어낸 목표 변위 대비 **실제 전진량의 부족분**(= 벽이 먹은 몫)에
      // 비례해 피해. 앵커 ⑮ 로는 원리적으로 못 하던 축이다.
      bubbleFilmBurstPost(state, x, y, pushed);
      break;
    default:
      break;
  }
}

/**
 * 앵커 `onGemPull` 이 넘기는 **젬 1개의 이번 틱 흡인 판정**. 훅이 제자리에서 고친다.
 */
export interface GemPullParams {
  /**
   * 이 젬을 끌어당길 것인가. 초기값은 호출부가 이미 정한 값(플레이어 자석 반경 + 병아리
   * 반경 판정의 결과).
   *
   * ## ⚠️ 이 칸이 앵커 ㉘ 로는 못 하던 것을 연다
   * `onGemMagnetParams`(㉘)는 흡인 루프 **밖**에서 틱당 한 번 · **스칼라 반경 하나만** 넘긴다.
   * 그래서 *젬마다 다른* 판정을 요구하는 축이 원리적으로 못 살았다 — 스트라이커 M4
   * 「슬립스트림」의 문면이 "자석장이 **이동 방향으로 길어져** 진행 방향 전방의 흡인 반경이
   * 확장된다" 라 **비등방**(젬의 방위에 따라 반경이 다르다)이고, 브루저 MO2 는 "처치한 적이
   * 떨군" 이라 **젬 개체별 출처**가 술어다.
   *
   * ⚠️ **`false` 로 되돌리는 것도 허용된다**(억제 축). 다만 지금 소비처가 없다 —
   * 되돌리는 스킬을 얹을 때 이 문장을 지워라.
   */
  pull: boolean;
  /**
   * 플레이어 → 젬 벡터(정규화 **안 된** 원시 차분). **읽기 전용 사실**이라 훅이 고쳐도
   * 호출부가 안 본다 — 방위 판정(M4)의 입력으로만 쓴다.
   *
   * ⚠️ 부호에 주의해라: 호출부가 `dx = player.x - gem.x` 로 잡으므로 이 벡터는 **젬에서
   * 플레이어를 향한다.** "진행 방향 전방의 젬" 을 재려면 `-dx`/`-dy` 와 이동 방향을 내적해라.
   */
  dx: number;
  dy: number;
  /** `dx*dx + dy*dy`. 호출부가 이미 계산했으므로 훅이 다시 제곱하지 마라. */
  d2: number;
}

/**
 * 앵커 `onGemPull` — **젬 1개의 흡인 여부가 정해진 직후 · 속도 대입 직전**
 * (`world.ts` 의 `stepGems` 루프 **안**).
 *
 * ## ⚠️ **매 틱 × 젬 개수만큼** 불린다 — 이 파일에서 가장 뜨거운 앵커다
 * 훅 첫 줄은 반드시 조기 반환이어야 하고, 투자 게이트 **밖**에 나눗셈·루프를 두지 마라
 * (`skills/striker.ts` 헤더 규율 ③). 젬은 후반 런에서 수백 개가 동시에 살아 있다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.**
 *  - ⚠️ **여기서 젬을 수거하지 마라.** 수거의 단일 수렴점은 `collectGem`(앵커 ③)이다.
 *    여기서 걷어가면 콤보·XP·촉매가 두 곳에서 갈린다(앵커 ㉘ 과 같은 계약).
 *  - ⚠️ **`gem.vx`/`vy` 를 직접 쓰지 마라.** 호출부가 이 훅 **직후에 통째로 대입**한다 —
 *    속도를 바꾸려면 `params.pull` 이고, 흡인 **속도**는 `MAGNET_SPEED` 상수라 이 앵커의
 *    손잡이가 아니다(버블 DR10 이 그 한계를 우회한 방식은 그 스킬 주석 참조).
 *  - ⚠️ **엔티티를 낳지 마라.** 이 지점은 `state.entities` **순회 안**이다.
 *
 * @param gem 이번 젬. **출처 표식 판별은 훅 책임이다**(`aux0`·`ownerId`).
 */
export function onGemPull(
  state: WorldState,
  player: Entity,
  gem: Entity,
  params: GemPullParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // ⚠️ `break;` 필수.
    case SIG_STRIKER_MARKSMAN:
      // M4「슬립스트림」 — 진행 방향 **전방**의 젬만 확장 반경으로 흡인한다(비등방).
      strikerGemPull(state, player, gem, params);
      break;
    default:
      break;
  }
}

/**
 * 앵커 `onPickupRadius` 가 넘기는 **이번 틱의 픽업 접촉 반경**. 훅이 제자리에서 고친다.
 */
export interface PickupRadiusParams {
  /**
   * 픽업 접촉 반경. 초기값은 `player.radius`(호출부 주석의 "관대한 픽업 반경").
   *
   * ## ⚠️ 이 반경은 **자석 반경과 다른 축**이다 — 앵커 ㉘ 으로는 못 닿는다
   * 자석(`stepGems`)은 젬을 *끌어오고*, 이 반경은 *닿았는가*를 판정한다. 버블 DR8
   * 「원격 채집기」의 문면이 "**기믹 픽업 3종**의 접촉 반경이 자석 반경에 비례해 확장된다"
   * 인데, 기믹 픽업의 접촉 판정은 `resolveCollisions` 의 지역 변수라 `stepGems` 가 쥐지 못했다
   * (배치5 버블 레인이 실측으로 확정한 차단 사유가 정확히 이것이다).
   *
   * ## ⚠️ 이 한 칸이 **젬·전리품·기믹 전부**를 움직인다
   * 호출부는 같은 반경으로 젬 수거·전리품 수거·기믹 픽업·포탑 활성화를 전부 판정한다.
   * DR8 의 문면은 *기믹 3종만* 이지만 이 앵커의 손잡이는 하나뿐이다 — 종류별로 나누려면
   * 호출부가 종류를 넘겨야 하고, 그건 **소비처가 생길 때** 쪼개라(칸을 미리 열지 마라).
   * 얹는 레인은 이 차이를 **주석에 남겨라**.
   */
  radius: number;
}

/**
 * 앵커 `onPickupRadius` — **픽업 접촉 반경이 정해진 직후 · 격자 질의 직전**
 * (`world.ts` 의 `resolveCollisions`).
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.**
 *  - ⚠️ **여기서 픽업을 처리하지 마라.** 수거·활성화의 정본은 바로 아래 격자 질의다.
 *  - ⚠️ **반경을 음수로 만들지 마라.** 호출부는 클램프하지 않고 `circlesOverlap` 에 그대로
 *    넘긴다 — 음수면 어떤 픽업에도 안 닿아 런이 진행 불가가 된다.
 *  - ⚠️ 매 틱 1회다(젬마다가 아니다). 격자 질의 반경이므로 **크게 키우면 질의 비용이 는다** —
 *    배율에 상한을 훅이 스스로 걸어라.
 */
export function onPickupRadius(
  state: WorldState,
  player: Entity,
  params: PickupRadiusParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    // ⚠️ `break;` 필수.
    case SIG_BUBBLE_FILM:
      // DR8 원격 채집기 — 자석 반경에 비례해 접촉 반경을 넓힌다(상한은 훅이 스스로 건다).
      // ⚠️ 이 한 칸이 젬·전리품·기믹·포탑 **전부**를 움직인다 — 설계 문면(기믹 3종)보다
      // 넓다는 사실은 `skills/bubble.ts` 의 `bubblePickupRadius` doc 에 적혀 있다.
      bubblePickupRadius(state, player, params);
      break;
    default:
      break;
  }
}

/**
 * 앵커 `onPlayerWallSlide` 가 넘기는 **이번 틱의 선체↔벽 겹침 해소 파라미터**.
 */
export interface WallSlideParams {
  /**
   * `true` 면 이번 틱의 겹침 해소(`slideCircleWalls`)를 **건너뛴다** — 선체가 벽을 통과한다.
   * 초기값 `false`.
   *
   * ## ⚠️ 이 칸이 DI9 의 자리다 — 벽 축 앵커(`onWallHit`)가 **아니었다**
   * 배치4 인계와 배치5 프롬프트가 팬텀 DI9「유령 선체」를 브루저 BL7·MO7 · 팬텀 AS10 과 같은
   * 「벽 파괴」 축에 묶어 뒀는데 **틀렸다**. 문면이 "피격 무적 동안 **선체**가 벽을 통과한다"
   * 라 탄↔벽이 아니라 선체↔벽이고, 두 경로는 함수도 술어도 겹치지 않는다:
   * 전자는 `sweptCircleOverlapsWall` 로 **탄을 죽이고**, 이쪽은 `player.radius` 로 **원을
   * 밀어낸다**. 배치5 팬텀 레인이 grep 으로 확정했고 이 앵커가 그 정정의 착지점이다.
   *
   * ## ⚠️ 통과는 **끼임을 못 푼다** — 켜고 끄는 순간을 훅이 책임져라
   * 겹침 해소를 건너뛰면 선체가 벽 **안**에 머물 수 있다. 그 상태에서 창이 닫혀 통과가
   * 꺼지면 다음 틱의 해소가 **최소 침투 방향**으로 뱉으므로 어느 면으로 나올지 훅이 정할 수
   * 없다. 강제 스크롤(창) 모드에서는 그 방향이 창 앞쪽일 수 있고, 그러면 관통 방지 규칙
   * (`los.ts` 규칙 2)이 의도한 보정과 반대로 움직인다.
   * ⚠️ 그래서 **무적 창처럼 짧고 스스로 끝나는 술어에만** 쓰고, 상시 켜는 축을 여기 얹지 마라.
   */
  passThrough: boolean;
}

/**
 * 앵커 `onPlayerWallSlide` — **선체↔벽 겹침 해소 직전**(`world.ts` 의 `stepPlayer` ·
 * `slideCircleWalls` 호출 **앞**).
 *
 * ## 이 지점에서만 살아 있는 것
 *  - **좌표가 아직 안 밀렸다.** 해소 뒤로 미루면 이미 밀려난 좌표라 "통과" 를 표현할 수 없다.
 *  - 벽 접촉 판정(`wallContactTicks`)은 이 **뒤**다 — 통과 중에는 접촉이 안 서므로, 접촉을
 *    술어로 쓰는 다섯 스킬(M5·S4·MO8·FI7·ME9)이 그 창 동안 자연히 꺼진다. 의도된 상호작용이다.
 *
 * ## 무엇을 하면 안 되는가
 *  - ⚠️ **RNG 를 소비하지 마라.**
 *  - ⚠️ **`player.x`/`y` 를 직접 쓰지 마라.** 통과 여부는 `params.passThrough` 다.
 *  - ⚠️ **매 틱 불린다**(벽이 하나라도 있는 모드에서). 투자 게이트를 첫 줄에 둬라.
 */
export function onPlayerWallSlide(
  state: WorldState,
  player: Entity,
  params: WallSlideParams,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_PHANTOM_CLOAK:
      // DI9「유령 선체」 — 피격 무적(`player.iframes > 0`) 동안 겹침 해소를 건너뛴다.
      // 배치4~5 가 이 스킬을 벽 파괴 축(`onWallHit`)으로 잘못 묶어 뒀던 것의 착지점이다 —
      // 사유 전문은 `WallSlideParams.passThrough` 의 doc 과 효과 함수 주석에 있다.
      phantomPlayerWallSlide(state, player, params);
      break;
    // ⚠️ `break;` 필수.
    default:
      break;
  }
}
