/**
 * phantom = 기체 타입 3, 은신 암살 (설계서 §3).
 *
 * ## 빌드 방향
 * 유리 대포. **최고 단발 피해 + 최고 이동/대시**, 대신 flat 최대HP 총량이 4종 중 가장 작고
 * 탄수·사거리가 거의 없다(붙어서 한 방). 방어 트리(disrupt)도 장갑이 아니라 **회피**
 * (`dashCdPct`·`moveSpeedPct`·비율 HP)로 짜여 있어, 같은 defense affinity 라도 브루저의
 * fortify 와 완전히 다른 스탯을 낸다 — affinity 는 같아도 빌드가 갈리는 지점이다.
 * `baseBp`(dmg +15% · 연사 0 · HP −20% · 이동 +8%)가 같은 축을 굳힌다.
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 3` · `signatureBit = 20`(`src/sim/shipSignature.ts` 의 `SIG_PHANTOM_CLOAK` 이 정본)
 *   - 트리 3계열: assassin/offense · phase/utility · disrupt/defense
 *   - 시그니처 패시브: 무피격 240틱 시 은신(적 조준 제외) + 해제 첫 타 배율
 *
 * ## 신규 StatKey 0 · 캡스톤 효과는 affinity 가 정한다
 * 근거는 `data/ships/bruiser.ts` 헤더 참조.
 *
 * ⚠️ 출시 순서: 설계서 §3 은 팬텀·비온을 **후순위**로 뒀다(은신이 적 조준 대상군을 바꿔
 * `src/sim/world.ts` 를 넓게 건드린다). 이 파일의 트리 데이터는 시그니처 배선과 독립이므로
 * 먼저 확정해 둬도 안전하지만, **패시브가 배선되기 전까지 팬텀은 "그냥 물몸 고화력"** 이다.
 */

import { NODES_PER_TREE, CAPSTONE_GATE } from '../skills.js';
import { buildShipTree } from './authoring.js';
import type { NodeSpec } from './authoring.js';
import type { ShipTypeDef } from './types.js';

const SLUG = 'phantom';

// --- assassin (offense): 단발 피해 극단. 연사·탄수는 거의 없다 ----------------
const ASSASSIN: readonly (readonly NodeSpec[])[] = [
  [
    ['급소 조준', '탄환 데미지 +5%/pt', 'damagePct', 5, 4],
    ['그림자 탄', '탄환 데미지 +5%/pt', 'damagePct', 5, 4],
    ['신속 사격', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
    ['소음 사출', '탄속 +3%/pt', 'bulletSpeedPct', 3, 4],
  ],
  [
    ['치명 각인', '탄환 데미지 +6%/pt', 'damagePct', 6, 4],
    ['배후 강습', '탄환 데미지 +6%/pt', 'damagePct', 6, 4],
    ['관통 단검', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['예리한 탄자', '탄속 +4%/pt', 'bulletSpeedPct', 4, 4],
  ],
  [
    ['암살 교본', '탄환 데미지 +6%/pt', 'damagePct', 6, 4],
    ['은밀 사거리', '사거리 +30/pt', 'rangeFlat', 30, 4],
    ['절개 탄두', '탄환 데미지 +7%/pt', 'damagePct', 7, 4],
    ['속결 격발', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
  ],
  [
    ['정밀 해부', '탄환 데미지 +7%/pt', 'damagePct', 7, 4],
    ['그림자 관통', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['일격 필살', '탄환 데미지 +8%/pt', 'damagePct', 8, 4],
    ['가속 사출', '탄속 +5%/pt', 'bulletSpeedPct', 5, 4],
  ],
  [
    ['참수 교리', '탄환 데미지 +10%/pt', 'damagePct', 10, 5],
    ['절명 교리', '탄환 데미지 +9%/pt', 'damagePct', 9, 5],
    ['무성 관통 교리', '관통 +1/2pt(내림)', 'pierce', 0.5, 5],
    ['섬광 격발 교리', '연사 속도 +4%/pt', 'fireRatePct', 4, 4],
  ],
];

// --- phase (utility): 이동·대시 극단 ----------------------------------------
const PHASE: readonly (readonly NodeSpec[])[] = [
  [
    ['위상 추진', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 4],
    ['잔상 보행', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 4],
    ['위상 도약', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['흔적 수거', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
  ],
  [
    ['감쇄 장', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 4],
    ['연쇄 도약', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['은밀 학습', '경험치 +3%/pt', 'xpPct', 3, 4],
    ['미끄러짐', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 4],
  ],
  [
    ['상변이 추진', '이동 속도 +5%/pt', 'moveSpeedPct', 5, 4],
    ['순간 재위상', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['그림자 수집', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['잠행 숙련', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['무중력 항법', '이동 속도 +5%/pt', 'moveSpeedPct', 5, 4],
    ['위상 반복', '대시 재충전 -5%/pt', 'dashCdPct', 5, 4],
    ['은신 연산', '경험치 +4%/pt', 'xpPct', 4, 4],
    ['광역 흔적', '젬 자석 반경 +6%/pt', 'magnetPct', 6, 4],
  ],
  [
    ['유령 항법 교리', '이동 속도 +7%/pt', 'moveSpeedPct', 7, 5],
    ['무한 위상 교리', '대시 재충전 -6%/pt', 'dashCdPct', 6, 5],
    ['잠행 지배 교리', '경험치 +5%/pt', 'xpPct', 5, 5],
    ['흔적 지배 교리', '젬 자석 반경 +7%/pt', 'magnetPct', 7, 4],
  ],
];

// --- disrupt (defense): 장갑이 아니라 회피로 버티는 방어 ----------------------
const DISRUPT: readonly (readonly NodeSpec[])[] = [
  [
    ['회피 반사', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['경량 격벽', '최대 HP +5/pt', 'maxHpFlat', 5, 4],
    ['교란 장막', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
    ['미끼 신호', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
  ],
  [
    ['예지 회피', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['위상 갑주', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['경량 프레임', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['보강 섬유', '최대 HP +6/pt', 'maxHpFlat', 6, 4],
  ],
  [
    ['간섭 필드', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['순보', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['반응 신경', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['흡수 코팅', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
  ],
  [
    ['그림자 방벽', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['연속 회피', '대시 재충전 -5%/pt', 'dashCdPct', 5, 4],
    ['잔상 유인', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['기민한 재정비', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
  ],
  [
    ['불가시 교리', '최대 HP +5%/pt', 'maxHpPct', 5, 5],
    ['무결 회피 교리', '대시 재충전 -6%/pt', 'dashCdPct', 6, 5],
    ['유령 갑주 교리', '최대 HP +10/pt', 'maxHpFlat', 10, 5],
    ['교란 지배 교리', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
  ],
];

export const PHANTOM: ShipTypeDef = {
  id: 3,
  slug: SLUG,
  trees: [
    buildShipTree(SLUG, 'assassin', 'offense', ASSASSIN, [
      '소거 섬광',
      '1.5초마다 전방 광선이 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'phase', 'utility', PHASE, [
      '위상 잔상',
      '대시 시 반경 320 내 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'disrupt', 'defense', DISRUPT, [
      '치명 위상 회피',
      '런당 1회 치명 피격을 무효화 + 짧은 무적',
    ]),
  ],
  nodesPerTree: NODES_PER_TREE,
  capstoneGate: CAPSTONE_GATE,
  signatureBit: 20,
  baseBp: { damageBp: 1500, fireRateBp: 0, maxHpBp: -2000, moveSpeedBp: 800 },
};
