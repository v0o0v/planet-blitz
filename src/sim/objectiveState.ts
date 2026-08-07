/**
 * **에코·조우의 「활성」 술어** — 목표(objective) 진행 상태를 스킬이 읽는 유일한 자리.
 *
 * ## 왜 `echo.ts`/`encounter.ts` 가 아니라 이 파일인가 — **순환이다**
 * 두 모듈은 `onObjectiveResolved`(앵커) 때문에 `skillHooks.ts` 를 **값으로** import 한다.
 * 그런데 `skillHooks.ts` 는 `skills/<기체>.ts` 를 값으로 import 하므로,
 * `skills/striker.ts → echo.ts → skillHooks.ts → skills/striker.ts` 가 되어 런타임 순환이다.
 * 배치4 가 실제로 밟았고(그 사유로 `chainHooks.ts`·`mallowStatus.ts`·`arccasterChain.ts` 가
 * 떼어졌다) **번들러가 초기화를 재배치하면 TDZ 로 터지는데 클라에서는 재현이 안 되고 검증
 * EF 에서만 터진다.** `build` 통과·테스트 무경고는 이 결함의 부재를 증명하지 않는다.
 *
 * 그래서 이 파일은 **leaf** 다 — `WorldState` 를 **type-only** 로만 보고 아무것도 값으로
 * 당기지 않는다. 스킬 모듈은 여기서만 읽어라.
 *
 * ## ⚠️ 「완료」 리더와 자리가 다르다 — 합치지 마라
 * `echoStabilizedOf`(state===2) · `encounterCompletedOf`(state===3) 는 **정산 리더**이고
 * 런이 끝난 뒤 한 번 읽힌다. 여기 있는 것은 **진행 중인가**이고 매 틱 읽힌다. 세 스킬
 * (스트라이커 M7 · 팬텀 PH9 · 버블 DR7)의 술어가 전부 *"활성인 동안"* 이라, 완료 리더로
 * 대신하면 **효과가 끝난 뒤에야 켜진다.**
 */
import type { WorldState } from './world.js';

/**
 * 에코가 **활성**인가 — 오브젝트가 출현했고 안정화가 아직 진행 중.
 *
 * `EchoRuntime.state` 는 `0 대기 · 1 출현(안정화 진행) · 2 안정화 완료` 다(그 선언 주석이
 * 정본). 완료(2)는 활성이 **아니다** — 세 스킬의 문면이 *"활성인 동안"* 과 *"완수 시"* 를
 * 따로 적고 있어 둘을 겹치면 완수 보상이 두 번 나간다.
 *
 * ⚠️ 에코가 안 뜬 런은 `echoRuntime` 자체가 `undefined` 라 항상 `false` 다(옵셔널 체이닝이
 * 그 계약이다 — 조건부 해시 폴드의 전제와 같다).
 */
export function echoActiveOf(state: WorldState): boolean {
  return state.echoRuntime?.state === 1;
}

/**
 * 조우가 **활성**인가 — 출현했거나 진행 중.
 *
 * `EncounterRuntime.state` 는 `0 대기 · 1 출현 · 2 진행중 · 3 완료 · 4 거부` 다. 활성은
 * **1 과 2 둘 다**이다 — 출현만 하고 아직 안 들어간 상태에서도 조우는 필드에 서 있고,
 * 세 스킬의 문면(*"에코·조우가 활성인 동안"*)이 그 구간을 배제하지 않는다.
 * **거부(4)는 활성이 아니다** — 플레이어가 물러난 것이라 진행 중이 아니다.
 */
export function encounterActiveOf(state: WorldState): boolean {
  const s = state.encounterRuntime?.state;
  return s === 1 || s === 2;
}

/**
 * 에코 **또는** 조우가 활성인가. 세 스킬의 문면이 전부 *"에코·조우가 활성인 동안"* 이라
 * 둘을 OR 로 합류시킨 이 술어가 그 문장의 정본이다 — 훅마다 따로 OR 하면 한쪽이 빠진
 * 사본이 조용히 생긴다(설계서가 반복 지적한 「같은 술어의 두 번째 사본」).
 */
export function objectiveActiveOf(state: WorldState): boolean {
  return echoActiveOf(state) || encounterActiveOf(state);
}
