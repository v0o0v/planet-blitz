/**
 * 팬텀 은신 술어 — 적 AI(patterns/index.ts·boss.ts)가 읽는 **단 하나의 게이트**.
 *
 * ## 왜 world.ts 가 아니라 이 leaf 모듈인가 (적대적 리뷰 MED-2)
 * 이 술어를 world.ts 에 두면 `world ↔ patterns/index` · `world ↔ boss` 가 **런타임 순환
 * import** 가 된다(그 전까지 두 방향 모두 `import type` 뿐이라 순환이 0이었다). Node ESM 은
 * 함수 선언 호이스팅으로 순환을 견디지만, 번들러(`deno bundle`/esbuild)가 모듈 초기화를
 * 재배치하면 `playerCloaked` 가 TDZ 로 던지거나 초기화 전 바인딩이 될 수 있다. 그러면 팬텀 런의
 * 정상 침공 제출이 서버(EF)에서 통째로 거부된다 — 클라에서는 절대 재현되지 않는 형태로.
 * 여기 leaf 로 내리면 `WorldState`/`Entity` 는 **type-only import**(런타임에 지워진다)라
 * 순환이 구조적으로 존재하지 않는다.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
import {
  CLOAK_HOLD_TICKS,
  CLOAK_UNHIT_TICKS,
  cloakWindowActive,
  SIG_PHANTOM_CLOAK,
} from './shipSignature.js';

/**
 * 팬텀 은신 — **적이 지금 플레이어를 조준 대상으로 삼을 수 있는가**의 술어.
 *
 * ## 왜 조준 좌표를 바꾸지 않고 "공격 방출" 만 게이트하는가
 * 적의 조준 좌표는 곧 **이동 목표**이기도 하다(patterns/index.ts 의 moveCharge·moveStandoff·
 * moveSeekWounded·boss.ts moveBoss 가 같은 `player.x/y` 를 쓴다). 가짜 좌표를 먹이면 적이
 * 엉뚱한 곳으로 날아가고, 조준과 이동을 분리하려면 조준 지점 12곳을 개별 수정해야 해
 * **일부만 고쳐 "어떤 적은 은신을 뚫는" 반쪽 배선**(이 저장소의 재발 결함)이 된다. 그래서
 * 게이트는 방출 단계 4곳(잡몹 runAttack·돌격형 파편 분출·벽 충돌 분출 / 보스 패턴 캐스트)에만
 * 건다. 네 곳 각각을 **단독으로** 잡는 케이스가 tests/shipSignatureWiring.test.ts 에 있다.
 *
 * ## 은신 범위에서 **의도적으로 제외**한 방출 2종 (미정의로 남기지 않는다)
 *  · `elite.ts` `explodeElite` 의 사망 파편 · `world.ts` BK_SPLIT 자탄 분열.
 *    둘 다 **조준을 하지 않는다** — 고정 각도로 방사되는 물리적 잔해이고, 발생 원인은 "적이
 *    플레이어를 발견했다" 가 아니라 "적/탄이 죽었다" 이다. 은신은 피탐지 회피이지 물리 법칙
 *    면제가 아니므로 여기는 막지 않는다. (막으면 은신 중 엘리트를 처치했을 때 파편이 사라져
 *    "은신하면 엘리트가 안전해진다" 는 더 이상한 규칙이 된다.)
 *    ⚠️ 따라서 "은신 틱에는 적탄이 절대 안 태어난다" 는 **거짓**이다 — 배선 검증 계량은 반드시
 *    발사 주체를 특정해야 한다(위 4곳을 단독으로 끄는 음성 대조).
 *
 * ## 은신 중 적의 정의된 행동
 *  · **이동은 그대로** — 은신해도 적은 계속 다가오고 접촉(램) 피해도 그대로 들어온다. 그래서
 *    은신은 자기 제한적이다(한 대만 맞으면 스트릭이 0 으로 돌아간다).
 *  · **발사만 막는다.** 발사 쿨다운은 소비하지 않는다(`e.cooldown` 이 0 에 머문다) → 은신이
 *    풀린 첫 틱에 곧바로 쏜다. 은신이 "쿨다운을 태워 없애는" 이득까지 주지 않는다.
 *  · RNG 미소비 — patterns/index.ts·boss.ts 는 어느 RNG 스트림도 뽑지 않는다. 은신은 웨이브
 *    구성·드랍·엘리트 어픽스 시퀀스를 한 칸도 밀지 않는다.
 *
 * ## 침공(3레이어)에서는 시그니처 자체가 비활성 — 의도된 범위 제한
 * 침공 방어체의 조준 좌표 일부는 **방어체 어픽스의 발동 조건 입력**이라(invasion/facility.ts·
 * coreRoom.ts 의 DefenseTriggerState), 은신을 섞으면 "근접 어픽스가 왜 안 터지나" 형태로
 * 방어체 경제(M7b)가 조용히 바뀐다. 그래서 `stepShipSignature` 의 팬텀 분기가 침공에서 통째로
 * 접히고(aux0/aux1 이 끝까지 0), 이 술어도 여기서 한 번 더 못 박는다.
 * ⚠️ 해제 첫 타 배율도 **함께** 꺼진다(적대적 리뷰 invariants-4) — 억제(대가)만 끄고 배율(이득)만
 * 남기면 침공에서 팬텀이 공짜로 강해진다. 대칭이 유일하게 방어 가능한 선택이다.
 */
export function playerCloaked(state: WorldState, player: Entity): boolean {
  if (state.config.invasion3 !== undefined) return false;
  if (state.sigBit !== SIG_PHANTOM_CLOAK) return false;
  return cloakWindowActive(player.aux0);
}

// ---------------------------------------------------------------------------
// 은신 사이클 조작 헬퍼 (E1 · ADR-0049 선결, `phantom.md` ①)
// ---------------------------------------------------------------------------

/**
 * **은신 해제 첫 타 배율 토큰(`aux1`)의 유일한 쓰기 경로.**
 *
 * ## 왜 헬퍼가 필요한가 (SEVERE-3)
 * 토큰을 세우는 자리가 여섯이었다 — `stepShipSignature` 의 진입 적립 하나와 액티브 다섯
 * (`assassin_lo`·`assassin_hi` 의 `breakCloak`, `disrupt_hi` 발동, 그 SUSTAIN, `EXPIRE` 의 회수).
 * 흩어진 쓰기는 **규칙을 하나 얹는 순간 반쪽 배선**이 된다: 설계가 요구하는 침공 차단을
 * 예로 들면, 여섯 중 하나만 빠뜨려도 침공에서 전 발사에 2.5배가 실리는데 그 미배선은
 * 화면에도 테스트에도 흔적을 안 남긴다. 그래서 값의 형태와 무관하게 **경로를 먼저 하나로**
 * 모은다.
 *
 * ## 침공 no-op — **내장 완료**(`phantom.md` ①-4)
 * 침공(`state.config.invasion3 !== undefined`)에서는 **쓰지 않는다.** 침공에서 억제(조준 제외)를
 * 방어체 어픽스 좌표 계약 때문에 걸 수 없으므로 이득(배율)도 대칭 차단하는 것이 기존 계약이고
 * (`playerCloaked` invariants-4), 그 대칭을 **쓰기 지점에서** 못 박는 것이 이 한 줄이다.
 * 심층 방어 2겹의 바깥쪽이며, 안쪽은 `world.ts` 소진 지점의 `invasion3 === undefined` 게이트다.
 *
 * ⚠️ `aux1` 은 `ENTITY_HASH_LAYOUT` 의 u32 폴드 대상이라 침공에서 1 → 0 은 곧 `hashEntity`
 * 변경이다 — **`invasionHash` 재생성 + EF 재배포**가 이 변경과 한 원자다.
 *
 * @param value 0(회수) 또는 1(장전). 토큰은 0/1 이진이 인코딩 계약이다.
 */
export function setBreakToken(state: WorldState, player: Entity, value: number): void {
  if (state.config.invasion3 !== undefined) return;
  player.aux1 = value === 0 ? 0 : 1;
}

/**
 * **은신 진입 에지에서 정확히 한 번** 발화하는 지점.
 *
 * 진입 훅 스킬(PH7·DI7·DI8)이 전부 이 함수 안에 얹힐 자리다. 훅을 진입 판정 지점마다 흩어
 * 심으면(자연 적립 · 액티브 진입 · `advanceCloak` 주입) 셋 중 하나에서만 도는 반쪽 배선이 된다.
 *
 * ## ⚠️ 배율 토큰은 **여기서 서지 않는다**(선결 C-3, 사용자 승인 2026-08-06)
 * 초판은 이 자리에서 `aux1` 을 장전했다. P1 실측(360런·1,328,935틱)이 그 전제를 부정했다 —
 * 소진 2,570건 중 2,565건(99.81%)이 **은신 창 안에서** 진입 후 평균 10.4~13.3틱 만에 일어났다.
 * 발사는 은신을 풀지 않으므로(`world.ts` autoAttack 주석) 2.5배는 "은신을 풀며 내리치는 한 방"이
 * 아니라 "들어가자마자 창 안에서 나가는 첫 발" 이었다. 그래서 토큰은 **창 종료 에지**
 * ({@link cloakExitCrossed})로 옮겼다. 이 함수는 진입 훅의 정본 자리로 남는다.
 *
 * ⚠️ 호출부는 **에지를 스스로 판정해서** 부른다. 이 함수가 에지를 판정하지 않는 이유: 판정에
 * 필요한 "직전 값" 은 호출부의 지역 변수이고, 여기서 다시 만들면 정본이 둘이 된다.
 */
export function fireCloakEntry(state: WorldState, player: Entity): void {
  // 진입 훅 스킬이 얹히기 전까지는 빈 디스패처다(S0 §5 의 앵커 규율과 같은 형태).
  // 인자를 지우면 훅을 넣을 때 호출부 셋을 다시 고쳐야 하고, 그때 하나를 빠뜨리는 것이
  // 정확히 이 함수가 막으려는 실패다.
  void state;
  void player;
}

/**
 * **은신 사이클 전진의 유일한 경로**(`phantom.md` ①-1·①-3, 심각-1).
 *
 * PH1(대시)·PH8(젬 수거)·PH9(에코)·DI5(빈사)·DI6(벽 접촉)이 전부 이것을 거친다. `aux0` 을
 * 직접 `setUnhitTicks(aux0 + k)` 로 미는 것은 **전면 금지**다 — 그 형태는 두 가지로 조용히
 * 깨진다: ①임계(240)를 **건너뛰면** 진입 에지가 영영 안 서서 진입 훅(PH7·DI7·DI8)이 통째로
 * 죽고 ②창 안(aux0 ≥ 240) 주입은 359 clamp 를 거쳐 다음 틱에 360 에 닿아 **사이클을 즉시
 * 리셋**한다(은신을 앞당기는 게 아니라 파괴한다).
 *
 * 규칙 셋(설계 ①-3 그대로):
 *  1. **침공 → no-op.** `setBreakToken` 과 같은 대칭 차단.
 *  2. **창 안(`aux0 >= CLOAK_UNHIT_TICKS`) → no-op.** 창 연장은 PH5 의 전유 축이라 전진형
 *     스킬이 겸하지 않는다(택일 확정).
 *  3. 창 밖 → `next = min(aux0 + k, CLOAK_UNHIT_TICKS)` 후 **통과 에지**에서 `fireCloakEntry`.
 */
export function advanceCloak(state: WorldState, player: Entity, k: number): void {
  if (state.config.invasion3 !== undefined) return;
  const step = Math.trunc(k);
  if (step <= 0) return;
  const prev = Math.trunc(player.aux0);
  // 창 안이면 무효 — 되감기 유발(②)을 원천 차단한다.
  if (prev >= CLOAK_UNHIT_TICKS) return;
  const next = prev + step >= CLOAK_UNHIT_TICKS ? CLOAK_UNHIT_TICKS : prev + step;
  player.aux0 = next;
  if (cloakEntryCrossed(prev, next)) fireCloakEntry(state, player);
}

/**
 * 은신 진입 **통과 판정** — `prev` 에서 `next` 로 가며 임계를 넘었는가.
 *
 * ## `=== 임계` 가 아니라 통과 판정인 이유 (구현 고지 ④)
 * 자연 적립은 항상 `+1` 이라 두 판정이 **같은 틱에 발화**한다 — 그래서 지금 바꿔도 값이
 * 비트 단위로 같다. 그런데 설계가 예고한 주입 스킬(PH5·PH6 등)은 카운터를 한 번에 여러 칸
 * 올리므로, `===` 로 두면 **임계를 건너뛴 틱에 진입이 영영 안 서고** 토큰·진입 훅이 통째로
 * 죽는다. 그 미발동은 화면에도 테스트에도 흔적을 남기지 않는다(이 저장소가 반복 겪은
 * "조용한 미발현" — 스트라이커 `marksmanTriggered` 주석과 같은 사유).
 */
export function cloakEntryCrossed(prev: number, next: number): boolean {
  return crossed(prev, next, CLOAK_UNHIT_TICKS);
}

/**
 * 은신 창 **종료 통과 판정** — `prev` 에서 `next` 로 가며 사이클 끝(`UNHIT + HOLD`)을 넘었는가.
 *
 * {@link cloakEntryCrossed} 의 **짝**이다(선결 C-3 이 "같은 형태의 짝을 한 파일에 두라"고
 * 지정했다 — 정본을 둘로 나누지 않는다). 배율 토큰은 진입이 아니라 **이 에지**에서 선다.
 *
 * ## `=== 360` 이 아니라 통과 판정인 이유
 * PH5(연장 위상)가 `HOLD` 를 늘리고 주입 스킬(PH6 등)이 `aux0` 을 한 번에 여러 칸 올리므로,
 * 등호로 두면 **임계를 건너뛴 틱에 토큰이 영영 안 서고** AS1·AS3·AS8·AS9·DI10 다섯이 통째로
 * 조용히 죽는다(이 저장소가 반복 겪은 "조용한 미발현").
 *
 * ⚠️ **피격으로 창이 끝난 경우는 이 에지가 아니다** — 피격 리셋(`world.ts` 팬텀 피격 분기)은
 * `aux0` 을 0 으로 되돌리며 토큰도 **회수**한다. 설계 의도는 "잠행하다 튀어나오며 내리치는
 * 일격" 이고 맞아서 벗겨진 것은 그 서사가 아니다(헌장 제3 기준과 같은 결의 대칭).
 */
export function cloakExitCrossed(prev: number, next: number): boolean {
  return crossed(prev, next, CLOAK_UNHIT_TICKS + CLOAK_HOLD_TICKS);
}

/**
 * **임계 통과 판정의 일반형** — `prev` 에서 `next` 로 가며 `threshold` 를 넘었는가(ADR-0049 S0).
 *
 * 위 {@link cloakEntryCrossed} 가 이것으로 구현된다. **정본을 둘로 나누지 않으려고** 같은
 * 파일에 나란히 둔다: 210스킬 배선이 만들 임계 훅(저금 만충 · 스택 개방 · 연속 접촉 K틱)이
 * 전부 같은 모양인데, 각자 다시 적으면 그중 하나가 `===` 로 쓰이는 것을 아무도 못 잡는다.
 *
 * ## `=== 임계` 가 아니라 통과 판정인 이유 (구현 고지 ④)
 * 카운터를 한 번에 여러 칸 올리는 주입 스킬이 존재하면 `===` 는 **임계를 건너뛴 틱에 영영
 * 발화하지 않는다.** 그 미발동은 화면에도 테스트에도 흔적을 남기지 않는다 — 이 저장소가
 * 반복 겪은 "조용한 미발현"(스트라이커 `marksmanTriggered` 주석과 같은 사유).
 *
 * `Math.trunc` 를 양쪽에 거는 이유는 슬롯·`aux` 가 u32 로 해시되기 때문이다: 소수 입력이
 * 판정에서만 정수로 취급되면 판정과 저장이 갈린다.
 *
 * ⚠️ **`threshold` 자체는 게이트 안에서 결정하라.** 임계가 스킬 레벨에서 나오면 나눗셈이
 * 끼는데, 그 계산은 sim 루프가 아니라 `createWorld` 의 `skillDerived` 자리다(구현 고지 ③).
 */
export function crossed(prev: number, next: number, threshold: number): boolean {
  return Math.trunc(prev) < threshold && Math.trunc(next) >= threshold;
}
