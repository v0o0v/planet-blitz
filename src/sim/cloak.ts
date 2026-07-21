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
import { cloakWindowActive, SIG_PHANTOM_CLOAK } from './shipSignature.js';

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
