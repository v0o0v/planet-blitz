/**
 * **`status.ts` 가 부르는 앵커들** — 상태이상 계층에서만 관측 가능한 지점을 모아 둔 파일이다.
 *
 * ## 왜 `skillHooks.ts` 가 아니라 별도 파일인가 — 순환 회피
 * `skillHooks.ts` 는 `skills/*.ts` 를 **값으로** import 하고, 여러 기체 모듈이 `status.ts` 를
 * 값으로 import 한다(아크캐스터 CH1·BR2 의 `applyChain`, 말로우 SQ9 의 `applyBurn`·ME6 의
 * `applySlow`). 따라서 `status.ts` 가 `skillHooks.ts` 를 import 하는 순간
 *
 * ```
 * status.ts → skillHooks.ts → skills/{arccaster,mallow}.ts → status.ts   ← 런타임 순환
 * ```
 *
 * 이 성립한다. `skillHooks.ts` 헤더가 이 순환을 명시적으로 금지한다(번들러가 모듈 초기화를
 * 재배치하면 TDZ — **클라에서 재현 안 되고 검증 EF 에서만 터진다**). ⚠️ 그래서 `build` 통과와
 * 테스트 무경고는 이 결함의 **부재를 증명하지 않는다** — 함수 선언 호이스팅으로 우연히 성립할
 * 뿐이다. 그래서 이 앵커들만 따로 떼어 내고, 효과 본체도 `status.ts` 를 import 하지 않는
 * leaf 에 둔다(`skills/arccasterChain.ts` · `skills/mallowStatus.ts`).
 * `catalystHooks.ts`·`filmBurst.ts` 가 같은 사상으로 앵커를 자기 파일에 들고 있는 선례다.
 *
 * ## ⚠️ 이 파일은 **두 레인이 각자 신설한 것을 리드가 합집합으로 합친 것**이다 (ADR-0049 배치4)
 * `lane/arccaster-anchors` 가 `onChainParams` 를, `lane/mallow-anchors` 가
 * `onEnemyStatusExpired` 를 담은 **같은 이름의 파일**을 각자 세웠다. 둘은 목적이 같고 내용이
 * 겹치지 않아 합집합이 정답이었다. ⭐ **두 레인이 같은 순환에 독립적으로 부딪혔다는 사실이
 * 이 파일의 존재 이유를 확증한다** — `status.ts` 가 부르는 앵커의 정본 자리는 여기다.
 * 새 앵커도 여기 얹어라.
 *
 * ## 공통 계약(다른 앵커와 동일)
 *  - 첫 줄은 `if (!state.skillsOn) return;` — 미투자 런은 파라미터가 상수 그대로라 **바이트 불변**.
 *  - 다음은 `switch (state.sigBit)` 기체 게이트. `break;` 를 반드시 붙여라.
 *  - RNG 를 소비하지 마라.
 *  - ⚠️ **훅에서 엔티티를 스폰하지 마라.** `onEnemyStatusExpired` 의 호출부는 `state.entities`
 *    순회 **안**이다. `onChainParams` 는 순회 직전이라 지금은 안전하지만 레코드가 값 두 개짜리
 *    계약이라 스폰할 자리가 애초에 없다. 필요해지면 `splitSpawns` 처럼 루프 뒤로 미뤄라.
 */

import type { WorldState } from './world.js';
import type { Entity } from './entities.js';
import { SIG_ARC_OVERCHARGE, SIG_MALLOW_CUSHION } from './shipSignature.js';
import { arccasterChainParams } from './skills/arccasterChain.js';
import { mallowEnemyStatusExpired } from './skills/mallowStatus.js';

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
 * **전격 연쇄 파라미터 확정 직후 · 대상 순회 직전**(`applyChain` 진입).
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

/** 앵커 `onEnemyStatusExpired` 가 구분하는 만료 종류. */
export type EnemyStatusKind = 'burn' | 'cold';

/**
 * **적의 원소 상태이상이 만료된 틱**(`status.ts` 의 `tickEnemyStatus` 안, 잔여 틱이 0 에 닿은
 * 그 지점).
 *
 * ## 왜 여기인가
 * 말로우 SQ9「이자 소각」은 *부여* 가 아니라 **만료**를 트리거로 삼는다(설계서 1R C5: 부여당
 * 탕감은 빔·발칸이 틱당 수십 회 부여를 일으켜 `aux0` 을 상시 0 으로 만들고 부채 술어 4종을
 * 사문화시켰다). 만료 판정은 감소 규칙과 같은 곳에서만 관측 가능하다 — 호출부에서 before/after
 * 를 다시 재면 만료 술어가 두 곳에 산다.
 *
 * ## ⚠️ `kind === 'enemy'` 게이트는 **훅 쪽**이 아니라 호출부가 이미 진다
 * `tickEnemyStatus` 자체가 enemy 에만 불린다(`world.ts` 의 순회 게이트). 보스 `iframes` 는
 * 화상 잔여가 아니라 **과열 취약 창**이라, 이 한정이 없으면 보스마다 오탕감이 난다.
 *
 * ## ⚠️ 상태이상을 여기서 다시 세우지 마라
 * 만료 지점이라 `iframes`/`ownerId` 가 이제 막 0 이 됐다. 여기서 다시 부여하면 만료가 영영
 * 오지 않는 루프가 되고, 그 상태는 해시에 접힌다.
 *
 * @param e 만료를 겪은 적. **읽기 전용으로 다뤄라** — 이 엔티티는 아직 `state.entities` 안이라
 *   쓰기가 반영되기는 하지만, 이 앵커의 계약은 관측이다
 */
export function onEnemyStatusExpired(
  state: WorldState,
  e: Entity,
  kind: EnemyStatusKind,
): void {
  if (!state.skillsOn) return;
  switch (state.sigBit) {
    case SIG_MALLOW_CUSHION: {
      // SQ9「이자 소각」 — 화상 만료 1회당 부채 소액 탕감. 냉기 만료는 소비처가 없다.
      //
      // ⚠️ `playerOf`(`skillHooks.ts`)를 쓰지 않는다 — 그 파일을 import 하면 이 파일을 만든
      // 사유(순환 회피)가 통째로 무효가 된다. 규약상 플레이어는 `entities[0]` 이고
      // `createWorld` 가 그 불변식을 세운다(`skillHooks.ts` 의 `playerOf` 와 같은 leaf 사본).
      // ⚠️ `undefined` 를 반드시 확인한다 — `compact()` 는 생존자만 재구축하므로 플레이어가
      // 죽은 뒤에는 배열이 빌 수 있다.
      const p = state.entities[0];
      if (p !== undefined) mallowEnemyStatusExpired(state, p, e, kind);
      break;
    }
    default:
      break;
  }
}
