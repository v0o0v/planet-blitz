/**
 * 스트라이커 = 기체 타입 0, 만능 기준점 (설계서 §3).
 *
 * ## 이 파일의 유일한 규율: `data/skills.ts` 를 **한 줄도 수정하지 않고, 리터럴도 옮겨 적지 않는다**
 * 기존 export(`SKILLS`·`SKILL_TREES`·`NODES_PER_TREE`·`CAPSTONE_GATE`)를 import 해 **조립만** 한다.
 * 63노드 리터럴을 여기로 복사하는 순간, 티어 행 하나의 순서 실수가 flat 인덱스를 밀어
 * ① 리플레이 해시 폴드 ② 파생 스탯 ③ **파워업 RNG 슬라이스** 3중 계약을 조용히 깬다 —
 * 그리고 그 실수는 타입 검사에 걸리지 않는다(전부 같은 `SkillNode` 타입이므로).
 *
 * `SKILLS.filter(tree)` 가 안전한 이유: `SKILLS` 배치가 `base[0..59]` 다음 `캡스톤[60..62]` 이라,
 * 트리로 필터하면 **base 20개(원 순서) 다음 그 계열 캡스톤 1개** 가 나온다 —
 * 즉 `ShipTreeDef.nodes` 계약(base × nodesPerTree + 캡스톤)과 정확히 일치한다.
 * `flattenShipNodes(STRIKER)` 가 `SKILLS` 와 원소 동일임을 tests/shipTypes.test.ts 가 못 박는다.
 *
 * 시그니처 패시브는 **없다**(`signatureBit = -1`), baseBp 도 전 축 0 이다 — 설계서 §11 채택안 A.
 * 5종 리팩터가 진행되는 동안 스트라이커를 회귀 탐지기로 남기기 위한 의도적 선택이고,
 * 스트라이커 시그니처는 M8.5 독립 레인에서 `SHIP_HASH_VERSION` bump 와 함께 추가한다.
 */

import { SKILLS, SKILL_TREES, NODES_PER_TREE, CAPSTONE_GATE } from '../skills.js';
import type { SkillTree } from '../skills.js';
import { LEGACY_TREE_AFFINITY, NO_SIGNATURE_BIT } from './types.js';
import type { ShipTreeDef, ShipTypeDef } from './types.js';

/** 레거시 트리 1개를 `ShipTreeDef` 로 감싼다 — 노드는 `SKILLS` 원소를 그대로 참조한다(복사 아님). */
function strikerTree(tree: SkillTree): ShipTreeDef {
  return {
    slug: tree,
    affinity: LEGACY_TREE_AFFINITY[tree],
    nodes: SKILLS.filter((n) => n.tree === tree),
  };
}

export const STRIKER: ShipTypeDef = {
  id: 0,
  slug: 'striker',
  trees: SKILL_TREES.map(strikerTree),
  nodesPerTree: NODES_PER_TREE,
  capstoneGate: CAPSTONE_GATE,
  signatureBit: NO_SIGNATURE_BIT,
  baseBp: { damageBp: 0, fireRateBp: 0, maxHpBp: 0, moveSpeedBp: 0 },
};
