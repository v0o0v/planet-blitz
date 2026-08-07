/**
 * **전격 연쇄 파라미터 앵커** — `status.ts` 의 {@link import('./status.js').applyChain} 진입점
 * 하나만 부른다(ADR-0049 배치 3, 아크캐스터 레인).
 *
 * ## 왜 `skillHooks.ts` 가 아니라 별도 파일인가 — 순환 회피
 * `skillHooks.ts` 는 `skills/*.ts` 를 값으로 import 하고, `skills/arccaster.ts` 는 CH1·BR2 를
 * 위해 `status.ts` 의 `applyChain` 을 값으로 import 한다. 따라서 `status.ts` 가
 * `skillHooks.ts` 를 import 하는 순간
 *
 * ```
 * status.ts → skillHooks.ts → skills/arccaster.ts → status.ts     ← 런타임 순환
 * ```
 *
 * 이 성립한다. `skillHooks.ts` 헤더가 이 순환을 명시적으로 금지한다(번들러가 초기화를
 * 재배치하면 TDZ — **클라에서 재현 안 되고 검증 EF 에서만 터진다**). 그래서 이 앵커만 따로
 * 떼어 내고, 효과 본체도 `status.ts` 를 import 하지 않는 leaf
 * (`skills/arccasterChain.ts`)에 두었다. `catalystHooks.ts`·`filmBurst.ts` 가 같은 사상으로
 * 앵커를 자기 파일에 들고 있는 선례다.
 *
 * ## 공통 계약(다른 앵커와 동일)
 *  - 첫 줄은 `if (!state.skillsOn) return;` — 미투자 런은 파라미터가 상수 그대로라 **바이트 불변**.
 *  - 다음은 `switch (state.sigBit)` 기체 게이트. `break;` 를 반드시 붙여라.
 *  - RNG 를 소비하지 마라.
 *  - ⚠️ **훅에서 엔티티를 스폰하지 마라.** 호출부는 `for (const t of state.entities)` 순회
 *    **직전**이라 지금은 안전하지만, 이 레코드는 값 두 개짜리 계약이고 스폰할 자리가 애초에
 *    없다. 필요해지면 `splitSpawns` 처럼 루프 뒤로 미루는 패턴을 써라.
 */

import type { WorldState } from './world.js';
import { SIG_ARC_OVERCHARGE } from './shipSignature.js';
import { arccasterChainParams } from './skills/arccasterChain.js';

/**
 * 이번 전격 연쇄 한 번의 도약 파라미터. 기본값은 `status.ts` 의 `CHAIN_RADIUS`·
 * `CHAIN_MAX_TARGETS` 상수이고, 훅이 고치면 그대로 반영된다.
 */
export interface ChainParams {
  /** 도약 반경(월드 유닛). 호출부가 제곱해서 쓴다 — 음수를 넣지 마라. */
  radius: number;
  /** 한 번의 연쇄가 때리는 최대 적 수. 0 이하면 연쇄가 통째로 무연산이 된다. */
  maxTargets: number;
}

/**
 * 앵커 ⑰ — **전격 연쇄 파라미터 확정 직후 · 대상 순회 직전**(`applyChain` 진입).
 *
 * 이 자리 하나가 **모든 연쇄 출처**를 덮는다: 원소 어픽스 전격(`world.ts` 의 명중 부가효과),
 * 아크캐스터 CH1 유도 낙뢰, BR2 피뢰 접지, 그리고 앞으로 생길 출처 전부. 호출부마다 따로
 * 얹으면 새 출처가 조용히 빠진다 — 아크캐스터 CH2 의 문면이 「모든 출처」다.
 */
export function onChainParams(state: WorldState, params: ChainParams): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_ARC_OVERCHARGE:
      // CH2 연쇄 확장 회로 — 도약 반경·대상 수 가산.
      arccasterChainParams(state, params);
      break;
    default:
      break;
  }
}
