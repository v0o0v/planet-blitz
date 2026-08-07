/**
 * **210스킬 배선의 앵커 15개** — sim 이 스킬 훅을 부르는 **유일한 지점들**(ADR-0049 S0 + S1).
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
} from './skills/mallow.js';
import {
  phantomDashFired,
  phantomGemCollected,
  phantomWallContact,
  phantomDamageChain,
  phantomPlayerDamaged,
  phantomSignatureStep,
  phantomEnemyDamaged,
  phantomCloakBreakReset,
  phantomVolleyParams,
} from './skills/phantom.js';
import {
  bubbleSignatureStep,
  bubbleEnemyDamaged,
  bubbleFilmBurst,
  bubbleVolleyParams,
  bubbleFilmAbsorbed,
  bubbleFilmEntry,
  bubbleFilmEfficiency,
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
export function onDashFired(state: WorldState, player: Entity): void {
  dispatchDashSkill(state, player);
  onDashFiredCatalyst(state, player);
}

function dispatchDashSkill(state: WorldState, player: Entity): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN:
      // M5 벽차기(무적프레임) · **M6 활공 정화**(적탄 소거 + 반경 안 잡몹 냉기).
      // ⚠️ M2(추진 항적)는 여기 없다 — 술어 "대시 방향" 의 정본이 `resolveDirFallback(mx, my,
      // angle)` 인데 그 `mx/my` 는 `stepPlayer` 지역 변수이고 이 앵커는 `input` 을 받지 않는다.
      // `player.vx/vy` 는 이미 이동 성분이 합산된 뒤라 방향 규칙의 두 번째 사본이 된다.
      strikerDashFired(state, player);
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
    // ⚠️ **버블은 여기 case 가 없다 — 트리거는 맞는데 소비처가 없다.** DR2「표면장력 세례」는
    // 이 앵커에서 "막이 서 있는 동안 수거" 를 정확히 재고 창 슬롯을 세울 수 있지만, 그 창이
    // 소비되는 자리는 **막 흡수 산술**(`world.ts:4249-4256`)이고 거기엔 앵커가 없다(앵커 ⑧ 은
    // 브루저 장갑보다 앞이라 막이 아직 한 점도 닳지 않았다). 창만 돌리면 슬롯 1칸이 영구히
    // 아무것도 안 하는 상태로 해시에 접힌다 — 통째로 미배선으로 뒀다.
    // ⚠️ DR1「역류 수거」도 여기가 아니다 — 그쪽은 **파열 틱에** 젬을 끌어오는 스킬이고,
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
 */
export function onPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
): void {
  dispatchPlayerDamagedSkill(state, player, dmg, lethalSurvived, sources);
  onPlayerDamagedCatalyst(state, player, dmg, lethalSurvived, sources);
}

function dispatchPlayerDamagedSkill(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
  sources: DamageSourceMask,
): void {
  if (!state.skillsOn) return;
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
      // BL4 과적 배출 · FO2 응혈 적립 · FO5 불괴 연쇄 · **BL8 격돌 담금질(적립처)**.
      // BL8 만 `sources` 를 본다 — 나머지 셋은 피해원과 무관하다(종전 인자만 쓴다).
      // 브루저는 스트라이커와 달리 **둘 다 필요하다** — FO2 는 적립량이 `dmg` 에 비례하고,
      // FO5 는 `lethalSurvived` 가 트리거 자체다(사슬 안에서 계산된 값을 그대로 넘긴다).
      //
      // ⚠️ BL1(응전 사출)은 여기 없다 — **설계서의 내부 쿨 술어가 이 지점에서 성립하지 않는다.**
      // 설계는 "내부 쿨 60틱은 `aux1` < 60 판정으로 대체 가능(신규 상태 0)" 이라고 적었으나,
      // 장갑 적립이 이 앵커보다 **앞**이라(world.ts 4317-4320) 여기 도달한 시점의 `aux1` 은
      // **항상 0** 이다. 그 술어를 그대로 쓰면 쿨이 영영 안 풀리거나(< 60 이면 스킵) 매 피격
      // 발동(≥ 60 이면 스킵)이 되어 어느 쪽이든 설계와 다르다. 슬롯 1칸이 필요하고, 그것은
      // 칼날 축 B 예산(BL8·BL9 로 2/2 포화)을 넘기므로 설계로 되돌아가야 한다.
      bruiserPlayerDamaged(state, player, dmg, lethalSurvived, sources);
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
 * @param dmg 무대 배율·피격 배수·**촉매 피해원 배율**까지 반영된 사슬 진입 피해
 * @returns 스킬 감소·흡수를 거친 피해. S0 는 인자를 그대로 돌려준다(비트 동일).
 */
export function onDamageChain(state: WorldState, player: Entity, dmg: number): number {
  if (!state.skillsOn) return dmg;
  switch (state.sigBit) {
    // 각 `case` 는 **① 감소 → ② 흡수** 순서로 처리하고, 정수화는 자기 게이트 안에서 한다.
    case SIG_STRIKER_MARKSMAN:
      return strikerDamageChain(state, player, dmg); // ① S4 감소 → ② S8 흡수
    case SIG_ARC_OVERCHARGE:
      // ① BR3·BR5 감소 → ② BR4 흡수. 순서는 이 앵커 주석이 못 박은 그대로다.
      return arccasterDamageChain(state, player, dmg);
    case SIG_BRUISER_ARMOR:
      // FO6 하중 전이(경감 + 대시 쿨 전이). 흡수 칸을 쓰는 브루저 스킬은 없다.
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
      // FO1 상한 확장 · FO2 만재 상승 엣지 정산 · FO7 기준선 · MO6 압쇄장 주기.
      // 이 앵커가 `stepShipSignature` **진입점**이라 브루저 감쇠 분기(바로 아래)와 이번 틱
      // `resolveCollisions` 양쪽이 FO1 의 새 상한을 본다.
      //
      // ⚠️ FO4(부동 역적립)·FO8(탈피 재생)·FO9(사투 본능)은 여기 없다 — 셋 다 **감쇠 분기
      // 그 자리**(소멸이 일어나는 `aux1 >= 180` 안쪽)를 고쳐야 하는데 그 분기는 이 앵커
      // **뒤**의 `world.ts` 코드다. 앵커에서 스택 감소를 사후 관측해 흉내 내면 액티브의 스택
      // 소각(blade_lo/hi)과 구분이 안 돼 조용히 오발동한다.
      bruiserSignatureStep(state, player);
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
 * @param x 격추 좌표 x (`compact` 루프 안에서 캡처)
 * @param y 격추 좌표 y
 * @param elite 그 적이 엘리트였는가
 */
export function onEnemyDeath(state: WorldState, x: number, y: number, elite: boolean): void {
  dispatchEnemyDeathSkill(state, x, y, elite);
  onEnemyDeathCatalyst(state, x, y, elite);
}

function dispatchEnemyDeathSkill(
  state: WorldState,
  x: number,
  y: number,
  elite: boolean,
): void {
  if (!state.skillsOn) return;
  void x;
  void y;
  switch (state.sigBit) {
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
    // ⚠️ **팬텀은 여기 case 가 없다 — 필요한 것이 사건이 아니라 지점이기 때문이다.**
    // AS6「무성 격살」은 "은신 창 중 처치한 적이 죽음의 잔재를 남기지 않는다" 인데, 그 잔재를
    // 만드는 곳은 `elite.ts` 의 `explodeElite` 와 `world.ts` 의 BK_SPLIT 분열이고 둘 다 이
    // 앵커보다 **앞**에서 이미 실행됐다. 여기서 뒤늦게 알아 봐야 파편은 이미 태어났다.
    // AS9(절멸 선고)는 격추가 아니라 **해제 첫 타의 명중 지점**이 트리거라 축이 다르다 —
    // 그래서 여기가 아니라 **앵커 ⑩** 에 배선됐다(S3).
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
export function onFilmBurst(state: WorldState, x: number, y: number): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_BUBBLE_FILM: {
      // PO1 파열 탄두 · PO3 거품 산탄 파열 · PO7 정전 파열 · DR1 역류 수거 · DR6 파열 추진 ·
      // FI1 조기 응결 · FI5 파열 위상 · FI10 정화 파열.
      //
      // ⚠️ **PO4·PO8·FI7 은 여기 없다 — 훅으로 닿지 않는다.**
      //  · FI7(벽면 반향)은 밀어내기의 **반경·변위 그 자체**를 배율해야 한다. 훅은 그 산술
      //    바깥이라 값을 건넬 길이 없다 — `resolveFilmBurst` 가 배율을 인자로 받는 형태여야
      //    하고, 그건 훅이 아니라 함수 시그니처 변경이다.
      //  · PO4(압착 충돌)는 밀어내기 목표 변위와 슬라이드 후 실제 좌표의 **차이**가 판정인데,
      //    이 앵커는 밀어내기보다 **앞**이라 그 차이가 아직 존재하지 않는다(앞에 둔 사유는
      //    호출 지점 주석 — 뒤로 옮기면 PO1·PO7 이 죽는다. 훅을 pre/post 둘로 쪼개야 한다).
      //  · PO8(잔거품 기뢰)은 기뢰 엔티티 생성 규약(`isGimmick` 컬링 제외 + 전용 마커 동시
      //    생존 상한 12)이 선결이다. 상한 없이 넣으면 파열 4회 창에 최대 36기가 서서 청크
      //    예산(160)을 조용히 먹는다.
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
      if (p !== undefined) bubbleFilmBurst(state, p, x, y);
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
      // ⚠️ **DR2「표면장력 세례」는 여전히 미배선이다 — 다만 사유가 바뀌었다.**
      //    종전 사유("효율 축은 이 앵커로 표현되지 않는다")는 **해소됐다**. 남은 사유는 하나뿐:
      //    DR2 는 *막이 서 있는 동안 젬을 수거하면 60틱 창이 열린다* 라는 술어이고, 그 창은
      //    설계서가 「구현: B」로 못 박은 **신규 WorldState 정수 1개**를 요구한다(잔여 틱).
      //    이 레인은 순수 함수·앵커 개정이 본무라 신규 해시 필드를 함께 들이지 않았다 —
      //    필드만 만들고 감소·수거 배선 중 하나라도 빠지면 슬롯이 영구히 해시에만 접히는
      //    반쪽 배선이 된다. **그 필드가 서는 날 이 case 에 곱연산으로 얹으면 된다**(설계서
      //    R3-2: DR2 는 전 출처·유한 창, FI8 은 단일 출처·상시 — 곱 중첩이 의도된 설계다).
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
 * @param due `cushionSettled(aux0, aux1)` — 회복분을 뗀 뒤 선체로 갈 예정인 지연 피해
 * @param recovered `cushionRecovered(aux0, aux1)` — 무피격 보상으로 사라진 몫
 * @returns 이번 정산에서 **선체로 보낼 몫**. 비음이어야 한다(음수는 hp 를 늘리지 않고 버려진다)
 */
export function onCushionSettleDue(
  state: WorldState,
  player: Entity,
  due: number,
  recovered: number,
): number {
  if (!state.skillsOn) return due;
  void recovered;
  switch (state.sigBit) {
    case SIG_MALLOW_CUSHION:
      // ME5「분할 상환」 **1종** — 이번 정산의 절반만 선체로 보내고 나머지를 `aux0` 으로 미룬다
      // (이월분은 탕감률만큼 줄어든다). 설계 정본의 순서에서 **분할**이 여기다.
      // 미투자 런은 `due` 를 그대로 돌려주므로 비트 동일이다.
      return mallowCushionSettleDue(state, player, due);
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
