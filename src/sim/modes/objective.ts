/**
 * **목표 오브젝트** 판정 — 무대 진행·승리가 파괴에 걸려 있는 `destructible` 들의 단일 정본.
 *
 * ## 왜 이 모듈이 존재하는가 (같은 결함 4회)
 * 이 저장소는 "맞기는 하지만 **조준되지는 않는** 오브젝트" 결함을 네 번 냈다:
 *
 * | # | 대상 | 증상 |
 * |---|---|---|
 * | 1 | 침공 실드 발생기 | 코어 보호막이 영구 재충전 → 침공이 수학적으로 클리어 불가 |
 * | 2 | 보호막 국면 코어 | 무적 표적을 영원히 때리고 발생기는 한 대도 안 맞음 |
 * | 3 | 추격 반격 장치 | 승리 조건을 의도적으로 부술 수단이 없음(니플헤임 클리어율 18.6%) |
 * | 4 | **오염 노드** | 정화 게이트를 의도적으로 진행시킬 수단이 없음(아래) |
 *
 * 근본 원인은 매번 같다 — 이 게임의 사격은 **전부 자동 조준**이고 `autoAttack` 은 `input.aim` 을
 * 쓰지 않는다(그 값은 렌더용 `player.angle` 이다). 그래서 `isPlayerTargetable` 에 없는 것은
 * **사람이 의도적으로 부술 수 없다.** 유탄이 우연히 스칠 때만 부서지므로 "완전 불능"이 아니라
 * "가끔 된다"로 보여 진단이 특히 어렵다.
 *
 * 3번을 고칠 때는 `isCounterDevice` 를 조준 술어에 직접 넣었는데, 그러면 **다음 모드가 또
 * 같은 함정에 빠진다**(실제로 오염 노드가 그 상태였다). 그래서 판정을 여기 한 곳에 모은다.
 *
 * ## 새 모드를 추가할 때
 * 무대 진행·승리가 어떤 오브젝트의 파괴에 걸린다면 **그 술어를 여기에 추가해라.** 그것만으로
 * 조준(`isPlayerTargetable`)과 봇 추적(`autopilot`)이 동시에 성립한다.
 * `tests/objectiveTargetable.test.ts` 가 이 계약을 못 박는다.
 *
 * ## 왜 `destructible` 전체를 넣지 않는가
 * 절차 청크 지형(`ownerId === 0`)이 조준을 훔치면 **모든 무대의 거동이 바뀐다** — 플레이어가
 * 적 대신 배경 바위를 쏘게 된다. 그래서 반드시 **마커로 좁힌다**.
 */
import type { Entity } from '../entities.js';
import { isCounterDevice } from './chase.js';
import { isContaminationNode } from './contamination.js';

/**
 * 이 엔티티가 **무대 진행·승리 조건인 파괴 대상**인가. 참이면 자동 조준 대상이고 봇의 이동
 * 표적이 된다. 절차 청크 지형은 거짓이다(마커로 좁혔다).
 */
export function isObjectiveDestructible(e: Entity): boolean {
  return isCounterDevice(e) || isContaminationNode(e);
}
