/**
 * (구) 스킬트리 캡스톤 게이트 헬퍼 — ADR-0049 로 캡스톤 시스템 자체는 **폐기됐다**.
 *
 * `src/items/loadout.ts` 가 더 이상 캡스톤 비트(uniqueMask 15~17)를 OR 하지 않으므로, 예전
 * 이 파일이 구현하던 화력(탄막 상쇄 레이저)·생존(치명타 1회 무효)·기동(대시 잔상 탄막 소거)
 * 3종 메커닉은 world.ts 에서 모두 걷어냈다(더 이상 이 파일을 import 하지 않는다) — 게이트가
 * 영영 거짓인 죽은 분기였기 때문이다. 비트 15~17 의 처분은 `src/sim/shipSignature.ts` 헤더
 * 주석이 정본이다.
 *
 * ⚠️ 이 파일 자체는 아직 지우지 않았다. `hasCapstone` 이 캡스톤과 무관하게 **범용 uniqueMask
 * 비트 검사 헬퍼**로 여러 테스트(예: shipIntegration·shipSignature·shipSignatureBubble 등)에서
 * 시그니처 비트(SIG_*, 18~23) 판정에도 재사용되고 있어서다 — `hasSignature`(shipSignature.ts)
 * 와 완전히 같은 연산이라 이름만 다를 뿐인데, 그 호출부들이 지금도 `'../src/sim/capstones.js'`
 * 에서 직접 import 한다. 이 파일을 완전히 지우려면 그 호출부 전부를 `hasSignature` 로 옮기는
 * 별도 작업이 필요하고, 이 세션에서는 그 파일들이 다른 동시 작업 담당이라 손대지 않았다.
 * 다음에 지울 때는 그 import 들을 먼저 `hasSignature` 로 바꾼 뒤 이 파일을 삭제할 것.
 */

/** uniqueMask 에 `bit` 이 켜져 있는지(hasUnique·hasSignature 와 동일 연산). */
export function hasCapstone(mask: number, bit: number): boolean {
  return (mask & (1 << bit)) !== 0;
}
