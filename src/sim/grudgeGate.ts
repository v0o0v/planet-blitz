/**
 * 원한 표적 게이트 — leaf, 런타임 의존 0(팬텀 AS7「원한 청산」선결, 배치7 F2a).
 *
 * `spawnEnemyBullet`(entities.ts)이 발사자 `ownerId` 를 스탬프할지 정하는 **단일 게이트**다.
 * `hashEntity`(replay.ts)가 `ownerId` 를 **무조건** 접는다 — `aux0`/`aux1` 처럼 "둘 다 0 이면
 * 스킵"하는 조건부 폴드가 아니다. 그래서 스탬프를 무분별하게 켜면 무투자 런은 물론 **다른
 * 기체가 자기 트리의 같은 flat 인덱스에 투자한 런**까지 해시가 갈린다. 게이트는 두 겹이다:
 *
 *  ① 기체 게이트 — `sigBit === SIG_PHANTOM_CLOAK`. 이 값은 투자량과 무관하게 기체 타입에서만
 *     파생된다(`computeActiveSignature`, world.ts). 이게 없으면 인덱스가 우연히 같은 다른
 *     기체 스킬의 투자가 이 게이트를 오발동시킨다.
 *  ② 투자 게이트 — AS7 의 실효 레벨(`skillLv`) ≥ 1.
 *
 * ⚠️ **`WorldState` 를 직접 import 하지 않는다.** `entities.ts` 헤더가 "world/patterns/waves
 * 를 import 하지 않는 leaf" 라고 못 박아 뒀고, `spawnEnemyBullet` 이 이 게이트를 부르려면
 * 그 계약을 지켜야 한다. 그래서 필요한 필드만 구조적으로 뽑은 {@link GrudgeGateState} 를 쓴다
 * — 실제 호출부가 넘기는 `WorldState` 는 이 셋을 전부 가지므로 캐스팅 없이 그대로 들어맞는다.
 *
 * ⚠️ AS7 은 아직 `skills/phantom.ts` 의 (파일 로컬) `Sk` enum 에 없다 — 그 파일은 배선 레인
 * 소유라 이 레인이 손댈 수 없다(레인 규율 "skills/** 한 줄도 고치지 마라"). 그 파일 헤더의 축
 * 순서 주석(`AS1..AS10 = 0..9`)을 근거로 flat 인덱스 6 을 여기 **독립적으로** 다시 적는다.
 * 두 자리가 갈리면 `tsc` 가 아니라 사람이 대조해야 잡힌다 — AS7 을 배선하는 레인은 이 상수를
 * 지우지 말고 자기 enum 값과 대조해라.
 */
import { SIG_PHANTOM_CLOAK } from './shipSignature.js';
import { skillLv } from '../items/skills.js';

/** AS7「원한 청산」의 flat 인덱스(`data/ships/phantom.ts` 축 순서: AS1..AS10 = 0..9). */
const AS7_FLAT_INDEX = 6;

/**
 * {@link grudgeTargetActive} 가 읽는 최소 구조. `WorldState` 는 이 넷을 전부 가지므로 실제
 * 호출부(`spawnEnemyBullet` 이 받는 `state`)는 그대로 들어맞는다 — 구조적 타이핑이라 별도
 * 캐스팅이 없다.
 */
export interface GrudgeGateState {
  skillsOn: boolean;
  sigBit: number;
  config: { skillInvest?: number[]; skillAffixLv?: number[] };
  skillDerived: { shipType: number };
}

/**
 * 이번 틱 스폰하는 적탄에 발사자 `ownerId` 를 스탬프해도 되는가.
 * `false` 면 `spawnEnemyBullet` 이 스탬프를 건너뛰어 해시가 종전과 완전히 같다(무투자 런·
 * 비-팬텀 런·팬텀이지만 AS7 미투자 런 전부 `false`).
 */
export function grudgeTargetActive(state: GrudgeGateState): boolean {
  if (!state.skillsOn) return false;
  if (state.sigBit !== SIG_PHANTOM_CLOAK) return false;
  return (
    skillLv(
      state.config.skillInvest,
      AS7_FLAT_INDEX,
      state.config.skillAffixLv,
      state.skillDerived.shipType,
    ) >= 1
  );
}
