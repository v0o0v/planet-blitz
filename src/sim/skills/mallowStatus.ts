/**
 * **말로우 SQ9「이자 소각」의 탕감 경로 2종**(만료 · 사망) — `skills/mallow.ts` 에서 갈라져
 * 나온 파일이다. 분할 선례는 `skills/phantomEntry.ts`(팬텀 PH7 이 두 파일에 걸쳐 있다)와
 * `skills/arccasterChain.ts`(아크캐스터 CH2 — **정확히 같은 순환 사유**).
 *
 * ## ⚠️ 왜 `skills/mallow.ts` 에 못 두는가 — **순환 import** 때문이다
 * SQ9 의 만료 앵커는 `status.ts` 의 `tickEnemyStatus` 안이다(`chainHooks.ts` 참조). 그런데
 * `skills/mallow.ts` 는 SQ9 의 **부여**(`applyBurn`)와 ME6 의 냉기(`applySlow`) 때문에
 * `status.ts` 를 **값으로** import 한다. 그래서 이 효과를 그 파일에 두면
 *
 * ```
 * status.ts → chainHooks.ts → skills/mallow.ts → status.ts     ← 런타임 순환
 * ```
 *
 * 이 성립한다. `skillHooks.ts` 헤더가 정확히 이 순환을 금지한다 — *"번들러(`deno bundle`/
 * esbuild)가 모듈 초기화를 재배치하면 TDZ 로 던지는데, **클라에서는 재현되지 않고 검증 EF
 * 에서만 터진다**"*. ⚠️ **`build` 통과·테스트 무경고는 그 결함의 부재를 증명하지 않는다** —
 * 함수 선언 호이스팅으로 지금 우연히 성립할 뿐이고, 초기화 재배치가 그 우연을 깬다.
 * 이 파일은 `status.ts` 도 `skillHooks.ts` 도 import 하지 않는 **순수 leaf** 라 그 간선이
 * 구조적으로 없다.
 *
 * ## ⚠️ SQ9 하나가 두 파일에 걸친다 — 무엇이 어디 있는가
 *  - **부여**(부채 보유 중 명중한 적에게 화상) — `skills/mallow.ts` 의 `mallowEnemyDamaged`.
 *    `applyBurn` 정본 leaf 를 값으로 불러야 해서 그쪽에 남는다.
 *  - **탕감**(만료 · 화상 중 사망) — 이 파일. 두 경로가 **같은 {@link forgiveInterest}** 를
 *    부르는 것이 계약이다. 산식이 갈리면 경로 하나가 조용히 다른 스킬이 된다.
 *
 * ## 계측
 * `tests/skillWiringCensus.test.ts` 의 `FILE_SHIP` 표에 이 파일을 말로우로 등록했다.
 * 표에 없으면 그 테스트가 "새 파일이면 표에 추가해라" 로 빨개진다.
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';
// ⚠️ **타입 전용이다.** `chainHooks.ts` 가 이 파일을 런타임 import 하므로 값으로 당기면
// 곧바로 순환이다 — `import type` 은 컴파일에서 지워져 그래프에 간선을 만들지 않는다.
import type { EnemyStatusKind } from '../chainHooks.js';
import { skillLv } from '../../items/skills.js';

/**
 * flat 인덱스 — **정본은 `data/ships/mallow.ts` 의 `trees` 배열**이다
 * (`[squish, mend, cushion]` → SQ1..SQ10 = 0..9). `skills/mallow.ts` 의 `Sk` 를 import 하지
 * 않는 것은 그 파일이 `status.ts` 를 값으로 당기기 때문이다(위 헤더) — `const enum` 이라도
 * 모듈 간선이 서는 것을 피한다.
 */
import { interestBurnForgive } from './mallowScaling.js';

const enum Sk {
  /** SQ9 이자 소각 */ interestBurn = 8,
}

/** 이 런에서 그 스킬의 실효 레벨. 기체 게이트는 호출부(앵커)가 이미 걸었다. */
function lv(state: WorldState, flat: Sk): number {
  return skillLv(
    state.config.skillInvest,
    flat,
    state.config.skillAffixLv,
    state.skillDerived.shipType,
  );
}


/**
 * **적 상태이상 만료 앵커** — SQ9 이자 소각의 **탕감 경로 ①**.
 *
 * 화상이 만료된 적 1기당 정확히 1회 부채가 소액 탕감된다. 냉기 만료는 소비처가 없다
 * (`kind` 를 보고 조기 반환한다 — "만료 전부" 로 열어 두면 냉기 어픽스 런에서 탕감이 두 배가
 * 되고, 그것은 이 스킬이 세는 사건이 아니다).
 *
 * ## ⚠️ 이 경로는 사망 경로({@link mallowEnemyDeath})와 **배타적**이다
 * 만료되면 화상이 없고, 화상 중에 죽으면 만료 틱이 오지 않는다 — `status.ts` 의 만료 통지가
 * hp≤0 판정보다 **앞**이라, 화상 피해로 죽는 틱에도 "만료" 로 한 번만 센다.
 *
 * ## ⚠️ 부여 여부를 되묻지 않는다
 * 어픽스 화염이 건 화상과 SQ9 이 건 화상은 같은 두 칸(`iframes`·`dashCooldown`)에 실려
 * **구분이 원리적으로 불가능하다**(`status.ts` 의 필드 재활용 규율). 화염 어픽스를 낀 런에서는
 * 탕감 발생률이 그만큼 는다 — 알려진 성질이고, 탕감량이 소액(3 + floor(Lv/2))이라 설계서가
 * 유계로 잡은 범위 안이다.
 */
export function mallowEnemyStatusExpired(
  state: WorldState,
  player: Entity,
  e: Entity,
  kind: EnemyStatusKind,
): void {
  if (kind !== 'burn') return;
  void e;
  forgiveInterest(state, player);
}

/**
 * 앵커 ⑪ **잡몹 격추** — SQ9 이자 소각의 **탕감 경로 ②**(화상이 남은 채 죽은 적).
 * 호출부가 `burning` 게이트를 이미 걸었다.
 *
 * ⚠️ 이 함수만은 순환과 무관하지만(호출부가 `skillHooks.ts` 다) **여기 둔다** — 두 경로가
 * 같은 산식을 쓴다는 계약이 파일 경계를 넘으면 한쪽만 고치는 사고가 난다.
 */
export function mallowEnemyDeath(state: WorldState, player: Entity): void {
  forgiveInterest(state, player);
}

/** SQ9 의 탕감 본체 — 두 경로가 **같은 함수**를 부른다(산식이 갈리면 경로가 두 스킬이 된다). */
function forgiveInterest(state: WorldState, player: Entity): void {
  const sq9 = lv(state, Sk.interestBurn);
  if (sq9 < 1) return;
  const debt = Math.trunc(player.aux0);
  if (debt <= 0) return;
  const cut = interestBurnForgive(sq9);
  // `max(0, ·)` — 설계서 공통 고지 ③ 의 aux0 감산 규율.
  player.aux0 = debt > cut ? debt - cut : 0;
}
