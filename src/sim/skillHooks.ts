/**
 * **210스킬 배선의 앵커 14개** — sim 이 스킬 훅을 부르는 **유일한 지점들**(ADR-0049 S0 + S1).
 *
 * S0 가 플레이어 축 9개를 세웠고, **S1 이 적 단위 축 2개(⑩ `onEnemyDamaged` · ⑪ `onEnemyDeath`)와
 * 성장 축 3개(⑫ `onLevelUp` · ⑬ `onPowerupOffer` · ⑭ `onPowerupPicked`)를 더했다.**
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
import { SIG_STRIKER_MARKSMAN, SIG_BRUISER_ARMOR } from './shipSignature.js';
import {
  strikerDashFired,
  strikerGemCollected,
  strikerPlayerDamaged,
  strikerKillsDelta,
  strikerBulletExpired,
  strikerDamageChain,
  strikerSignatureStep,
} from './skills/striker.js';
import {
  bruiserDashFired,
  bruiserGemCollected,
  bruiserPlayerDamaged,
  bruiserDamageChain,
  bruiserSignatureStep,
  bruiserEnemyDamaged,
  bruiserEnemyDeath,
} from './skills/bruiser.js';

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
    // leaf 에서 읽을 길이 없었는데, 이제 `./constants.js` 에 있어 기체 모듈이 그대로 import
    // 한다. 남은 것은 스트라이커 레인이 `case SIG_STRIKER_MARKSMAN:` 한 줄을 넣는 일뿐이다.
    // (S1 은 **자리만** 만드는 커밋이라 효과를 넣지 않았다 — 값 복제는 여전히 금지다.)
    //
    // ⚠️ **브루저도 여기 case 가 없다 — 누락이 아니라 미배선이다.** 이 앵커를 쓰는 설계 항목은
    // BL2(근접 볼리 증폭+관통)·BL3(만재 중탄)·BL6(중량 탄자)·BL8(담금질 탄) 넷인데, 전부
    // **이번 볼리의 탄 파라미터**(피해·관통·탄속·수명)를 바꿔야 한다. 이 앵커는 무기 아키타입
    // 분기보다 **앞**이라 탄이 아직 없고, 인자도 `(state, player)` 뿐이다 — 여기서는 원리적으로
    // 닿지 않는다. 그 절반은 `world.ts` 의 볼리 생성부가 소유해야 한다.
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
      strikerDashFired(state, player);
      break;
    case SIG_BRUISER_ARMOR:
      // MO1 충각 적재(스택 +1 · 감쇠 타이머 리셋) · MO8 벽 되튐(쿨다운 환급).
      // 둘 다 이 앵커가 `dashCooldown` 대입 **뒤**라는 데 의존한다 — 그 근거는 효과 함수 주석.
      bruiserDashFired(state, player);
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
 */
export function onPlayerDamaged(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
): void {
  dispatchPlayerDamagedSkill(state, player, dmg, lethalSurvived);
  onPlayerDamagedCatalyst(state, player, dmg, lethalSurvived);
}

function dispatchPlayerDamagedSkill(
  state: WorldState,
  player: Entity,
  dmg: number,
  lethalSurvived: boolean,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN:
      // S1 응전 조준 · S2 반사 도금. 둘 다 피해량과 무관하고 "hp 가 실제로 깎였다" 만 본다 —
      // 그것이 이 앵커의 정의라 `dmg` 를 넘기지 않는다.
      strikerPlayerDamaged(state, player);
      break;
    case SIG_BRUISER_ARMOR:
      // BL4 과적 배출 · FO2 응혈 적립 · FO5 불괴 연쇄.
      // 브루저는 스트라이커와 달리 **둘 다 필요하다** — FO2 는 적립량이 `dmg` 에 비례하고,
      // FO5 는 `lethalSurvived` 가 트리거 자체다(사슬 안에서 계산된 값을 그대로 넘긴다).
      //
      // ⚠️ BL1(응전 사출)은 여기 없다 — **설계서의 내부 쿨 술어가 이 지점에서 성립하지 않는다.**
      // 설계는 "내부 쿨 60틱은 `aux1` < 60 판정으로 대체 가능(신규 상태 0)" 이라고 적었으나,
      // 장갑 적립이 이 앵커보다 **앞**이라(world.ts 4317-4320) 여기 도달한 시점의 `aux1` 은
      // **항상 0** 이다. 그 술어를 그대로 쓰면 쿨이 영영 안 풀리거나(< 60 이면 스킵) 매 피격
      // 발동(≥ 60 이면 스킵)이 되어 어느 쪽이든 설계와 다르다. 슬롯 1칸이 필요하고, 그것은
      // 칼날 축 B 예산(BL8·BL9 로 2/2 포화)을 넘기므로 설계로 되돌아가야 한다.
      bruiserPlayerDamaged(state, player, dmg, lethalSurvived);
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
    // ⚠️ **브루저는 여기 case 가 없다 — 쓸 설계 항목이 없다.** 처치 "개수" 에 반응하는 브루저
    // 스킬은 0종이다. 유일한 처치 트리거 FO7 은 **엘리트인지**와 **격파 시점 스택**을 함께
    // 봐야 해서 개별 사건 앵커(⑪)로 갔다. MO2(파쇄 수확)는 처치가 아니라 젬 스폰 시점이다.
    default:
      break;
  }
}

/**
 * 앵커 ⑥ — **아군탄이 관통 예산을 다 써 소멸하는 지점**. 수명 만료·화면 밖 컬링이 아니라
 * "명중해서 예산이 바닥났다" 다(자이로 무한 관통·프리즘 세그먼트는 이 분기 밖이다).
 */
export function onBulletExpired(state: WorldState, bullet: Entity): void {
  dispatchBulletExpiredSkill(state, bullet);
  onBulletExpiredCatalyst(state, bullet);
}

function dispatchBulletExpiredSkill(state: WorldState, bullet: Entity): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN:
      strikerBulletExpired(state, bullet); // F4 파편 격발
      break;
    // ⚠️ **브루저는 여기 case 가 없다 — 쓸 설계 항목이 없다.** 관통 예산 소진에 반응하는
    // 브루저 스킬은 0종이다. BL3(만재 중탄)의 "명중 지점 폭발" 은 **명중마다**여야 하는데 이
    // 앵커는 예산이 바닥난 마지막 명중에서만 불린다 — 그 자리는 앵커 ⑩ 이다.
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
    case SIG_BRUISER_ARMOR:
      // FO6 하중 전이(경감 + 대시 쿨 전이). 흡수 칸을 쓰는 브루저 스킬은 없다.
      // ⚠️ 설계서는 이 스킬의 자리를 "브루저 장갑 **뒤**" 로 지정했는데 이 앵커는 장갑 **앞**
      // 이다 — 사슬에 뚫린 유일한 스킬 자리라 여기 말고 둘 곳이 없다(효과 함수 주석에 근거).
      return bruiserDamageChain(state, player, dmg);
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
  void source;
  switch (state.sigBit) {
    // 레인은 자기 `case SIG_*:` 한 줄을 여기에 넣는다.
    case SIG_BRUISER_ARMOR: {
      // BL9 중압 리듬 — 명중 카운터 × 장갑 스택 파생 주기. 주기가 스택에서 나오므로
      // **플레이어**가 필요하다(이 앵커는 표적만 넘긴다).
      //
      // ⚠️ BL7(파성퇴)은 여기 없다 — 이 앵커에는 `destructible` 도 오지만, 그 스킬은 "일격
      // 파괴 + 그 자리 충격파" 라 **명중 해소 자체를 바꿔야** 한다(hp 를 0 으로 만들어도
      // `dead` 판정은 이 앵커 앞에서 이미 끝났다 — 앵커 주석의 금지 사항 그대로다).
      const p = playerOf(state);
      if (p !== undefined) bruiserEnemyDamaged(state, p, target, dmg);
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
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 앵커 ⑫⑬⑭ (S1: 전 분기 비어 있음) — **성장 축**
// ---------------------------------------------------------------------------

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
    default:
      break;
  }
}
