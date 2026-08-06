/**
 * **210스킬 배선의 앵커 9개** — sim 이 스킬 훅을 부르는 **유일한 지점들**(ADR-0049 S0).
 *
 * S0 시점에는 전 분기가 비어 있다. 이 커밋이 만드는 것은 **자리**이지 효과가 아니다 —
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
} from './catalystHooks.js';
import { SIG_STRIKER_MARKSMAN } from './shipSignature.js';
import {
  strikerDashFired,
  strikerGemCollected,
  strikerPlayerDamaged,
  strikerKillsDelta,
  strikerBulletExpired,
  strikerDamageChain,
  strikerSignatureStep,
} from './skills/striker.js';

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
// 앵커 9개 (S0: 전 분기 비어 있음)
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
    // 하나인데, 그 `창`(`COMBO_WINDOW_TICKS`)이 `world.ts` 의 **비공개 상수**라 leaf 에서 읽을
    // 길이 없다. 값을 여기 다시 적으면 두 곳이 조용히 갈리므로 적지 않았다(S8 의 흡수 절반은
    // 앵커 ⑧ 에 배선돼 있다). 푸는 방법은 그 상수를 leaf 로 옮기는 것이고, 그건 이 레인 밖이다.
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
  void dmg;
  void lethalSurvived;
  switch (state.sigBit) {
    case SIG_STRIKER_MARKSMAN:
      // S1 응전 조준 · S2 반사 도금. 둘 다 피해량과 무관하고 "hp 가 실제로 깎였다" 만 본다 —
      // 그것이 이 앵커의 정의라 `dmg` 를 넘기지 않는다.
      strikerPlayerDamaged(state, player);
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
    default:
      break;
  }
}
