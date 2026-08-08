/**
 * **아크캐스터 CH2「연쇄 확장 회로」의 효과 본체** — `skills/arccaster.ts` 에서 갈라져 나온
 * 파일이다. 분할 선례는 `skills/phantomEntry.ts`(팬텀 PH7 이 두 파일에 걸쳐 있다).
 *
 * ## ⚠️ 왜 `skills/arccaster.ts` 에 못 두는가 — **순환 import** 때문이다
 * CH2 의 앵커는 `status.ts` 의 `applyChain` 진입점이다(`chainHooks.ts` 참조). 그런데
 * `skills/arccaster.ts` 는 CH1·BR2 때문에 `status.ts` 의 `applyChain` 을 **값으로** import
 * 한다. 그래서 이 효과를 그 파일에 두면
 *
 * ```
 * status.ts → chainHooks.ts → skills/arccaster.ts → status.ts     ← 런타임 순환
 * ```
 *
 * 가 된다. `skillHooks.ts` 헤더가 정확히 이 순환을 금지한다 — *"번들러(`deno bundle`/esbuild)가
 * 모듈 초기화를 재배치하면 TDZ 로 던지는데, **클라에서는 재현되지 않고 검증 EF 에서만 터진다**"*.
 * 이 파일은 `status.ts` 를 import 하지 않는 **순수 leaf** 라 그 간선이 구조적으로 없다.
 *
 * ## 계측
 * `tests/skillWiringCensus.test.ts` 의 `FILE_SHIP` 표에 이 파일을 아크캐스터로 등록했다.
 * 표에 없으면 그 테스트가 "새 파일이면 표에 추가해라" 로 빨개진다.
 */

import type { WorldState } from '../world.js';
// ⚠️ **타입 전용이다.** `chainHooks.ts` 가 이 파일을 런타임 import 하므로 값으로 당기면
// 곧바로 순환이다 — `import type` 은 컴파일에서 지워져 그래프에 간선을 만들지 않는다.
import type { ChainParams } from '../chainHooks.js';
import { skillLv } from '../../items/skills.js';

import { relayRadiusAdd, relayTargetsAdd } from './arccasterScaling.js';

const enum Sk {
  /** CH2 연쇄 확장 회로 */ relayCircuit = 1,
}

/** 이 런에서 그 스킬의 실효 레벨. 기체 게이트는 호출부(`onChainParams`)가 이미 걸었다. */
function lv(state: WorldState, flat: Sk): number {
  return skillLv(
    state.config.skillInvest,
    flat,
    state.config.skillAffixLv,
    state.skillDerived.shipType,
  );
}

/**
 * **CH2 연쇄 확장 회로** — *"모든 출처의 전격 연쇄가 도약 반경과 도약 대상 수를 더 얻는다"*.
 *
 * 반경 +20 + 6×Lv(기본 260 → Lv1 286 · Lv20 400) · 대상 +1 + floor(Lv/7)(기본 3 → Lv1 4 ·
 * Lv14+ 6). 설계서 문면의 **「모든 출처」** 가 이 앵커 자리의 근거다 — 원소 어픽스 전격,
 * CH1 유도 낙뢰, BR2 피뢰 접지가 전부 `applyChain` 한 곳으로 모이므로 여기 한 번만 얹으면
 * 출처를 세지 않아도 전부 덮인다. 각 호출부에 따로 적으면 새 출처가 생길 때 조용히 빠진다.
 *
 * ⚠️ 미투자면 한 줄도 실행되지 않고 호출부는 `CHAIN_RADIUS`·`CHAIN_MAX_TARGETS` 상수를 그대로
 * 쓴다 — 산술이 종전과 **비트 동일**이다.
 */
export function arccasterChainParams(state: WorldState, params: ChainParams): void {
  const ch2 = lv(state, Sk.relayCircuit);
  if (ch2 < 1) return;
  params.radius += relayRadiusAdd(ch2);
  params.maxTargets += relayTargetsAdd(ch2);
}
