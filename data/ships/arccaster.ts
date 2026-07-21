/**
 * arccaster = 기체 타입 2, 정지 포격 (설계서 §3).
 *
 * ## 빌드 방향
 * 자리를 잡고 쏘는 포대. **최고 사거리 + 최고 탄수 + 최고 탄속**, 대신 이동·연사가 얕고
 * 방어는 flat 이 아니라 `maxHpPct`(방벽) 축이라 기본 HP 가 낮은 이 기체에서는 절대량이 작다.
 * `baseBp`(dmg +12% · 연사 −10% · HP −10% · 이동 −12%)가 "느리지만 멀리서 두껍게" 를 굳힌다.
 * 브루저와 정확히 반대 극(근접·고HP·저사거리)이라 두 기체를 나란히 두면 축이 즉시 보인다.
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 2` · `signatureBit = 19`(`src/sim/shipSignature.ts` 의 `SIG_ARC_OVERCHARGE` 가 정본)
 *   - 트리 3계열: chain/offense · barrage/utility · barrier/defense
 *   - 시그니처 패시브: 정지 90틱 이상 시 과충전(피해 +bp, 이동 즉시 해제)
 *
 * ## 신규 StatKey 0 · 캡스톤 효과는 affinity 가 정한다
 * 근거는 `data/ships/bruiser.ts` 헤더 참조(중복 서술을 피한다).
 */

import { NODES_PER_TREE, CAPSTONE_GATE } from '../skills.js';
import { buildShipTree } from './authoring.js';
import type { NodeSpec } from './authoring.js';
import type { ShipTypeDef } from './types.js';

const SLUG = 'arccaster';

// --- chain (offense): 사거리·탄속 축. 관통은 3노드로 절제 --------------------
const CHAIN: readonly (readonly NodeSpec[])[] = [
  [
    ['유도 방전', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['전하 축적', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['아크 도약', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['사출 가속', '탄속 +4%/pt', 'bulletSpeedPct', 4, 4],
  ],
  [
    ['고압 방전', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['연쇄 회로', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['조사 사거리', '사거리 +50/pt', 'rangeFlat', 50, 4],
    ['초전도 코일', '탄속 +4%/pt', 'bulletSpeedPct', 4, 4],
  ],
  [
    ['플라즈마 탄심', '탄환 데미지 +5%/pt', 'damagePct', 5, 4],
    ['아크 확산', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['장거리 조준', '사거리 +50/pt', 'rangeFlat', 50, 4],
    ['임계 방전', '탄환 데미지 +5%/pt', 'damagePct', 5, 4],
  ],
  [
    ['과부하 탄두', '탄환 데미지 +6%/pt', 'damagePct', 6, 4],
    ['관통 아크', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['광역 조사', '사거리 +60/pt', 'rangeFlat', 60, 4],
    ['가속 사출', '탄속 +5%/pt', 'bulletSpeedPct', 5, 4],
  ],
  [
    ['뇌격 교리', '탄환 데미지 +7%/pt', 'damagePct', 7, 5],
    ['무한 연쇄 교리', '관통 +1/2pt(내림)', 'pierce', 0.5, 5],
    ['초장거리 교리', '사거리 +70/pt', 'rangeFlat', 70, 5],
    ['광속 사출 교리', '탄속 +6%/pt', 'bulletSpeedPct', 6, 4],
  ],
];

// --- barrage (utility): 탄수 축. 이 기체의 정체성 ----------------------------
const BARRAGE: readonly (readonly NodeSpec[])[] = [
  [
    ['다연장 개방', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['장전 보조', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
    ['탄도 계산', '경험치 +2%/pt', 'xpPct', 2, 4],
    ['잔해 흡인', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
  ],
  [
    ['확산 사출', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['냉각 회로', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
    ['포격 관측', '사거리 +40/pt', 'rangeFlat', 40, 4],
    ['전술 연산', '경험치 +2%/pt', 'xpPct', 2, 4],
  ],
  [
    ['병렬 포신', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['급속 장전', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
    ['광역 흡인', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['사격 통제', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['삼중 포신', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['연속 포격', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
    ['탄막 확장', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['관측 숙련', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['일제 포격 교리', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 5],
    ['속사 교리', '연사 속도 +4%/pt', 'fireRatePct', 4, 5],
    ['포열 지배 교리', '젬 자석 반경 +6%/pt', 'magnetPct', 6, 5],
    ['포격 통제 교리', '경험치 +4%/pt', 'xpPct', 4, 4],
  ],
];

// --- barrier (defense): 비율 방벽 축(flat 이 아니라 %) ------------------------
const BARRIER: readonly (readonly NodeSpec[])[] = [
  [
    ['편향 장막', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
    ['예비 전지', '최대 HP +6/pt', 'maxHpFlat', 6, 4],
    ['접지 방벽', '최대 HP +6/pt', 'maxHpFlat', 6, 4],
    ['정지 안정기', '대시 재충전 -2%/pt', 'dashCdPct', 2, 4],
  ],
  [
    ['공진 차폐', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['축전 격벽', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['전자 장막', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['미세 조정', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
  ],
  [
    ['반사 필드', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['방열 장갑', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['위상 차폐', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['긴급 방출', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
  ],
  [
    ['중첩 방벽', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['강화 전지', '최대 HP +10/pt', 'maxHpFlat', 10, 4],
    ['흡수 코일', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['재배치 기동', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
  ],
  [
    ['절대 방벽 교리', '최대 HP +5%/pt', 'maxHpPct', 5, 5],
    ['무한 축전 교리', '최대 HP +12/pt', 'maxHpFlat', 12, 5],
    ['공진 지배 교리', '최대 HP +5%/pt', 'maxHpPct', 5, 5],
    ['긴급 이탈 교리', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
  ],
];

export const ARCCASTER: ShipTypeDef = {
  id: 2,
  slug: SLUG,
  trees: [
    buildShipTree(SLUG, 'chain', 'offense', CHAIN, [
      '수렴 조사',
      '1.5초마다 전방 광선이 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'barrage', 'utility', BARRAGE, [
      '탄막 잔상',
      '대시 시 반경 320 내 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'barrier', 'defense', BARRIER, [
      '위상 재구성',
      '런당 1회 치명 피격을 무효화 + 짧은 무적',
    ]),
  ],
  nodesPerTree: NODES_PER_TREE,
  capstoneGate: CAPSTONE_GATE,
  signatureBit: 19,
  baseBp: { damageBp: 1200, fireRateBp: -1000, maxHpBp: -1000, moveSpeedBp: -1200 },
};
