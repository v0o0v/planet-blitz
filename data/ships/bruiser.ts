/**
 * bruiser = 기체 타입 1, 맞으며 전진 (설계서 §3).
 *
 * ## 빌드 방향
 * 근접 압박형. **최고 단일 노드 피해 + 최고 flat 최대HP**, 대신 사거리·탄수·연사가 얕다.
 * 스트라이커 대비 화력 트리의 `damagePct` 총량이 두 배 남짓이고 방어 트리의 `maxHpFlat`
 * 총량도 가장 크다 — "맞으며 붙어서 부순다" 를 스탯 분포만으로 표현한 것이다.
 * `baseBp`(dmg +8% · 연사 −6% · HP +25% · 이동 −5%)가 같은 축을 한 번 더 밀어 준다.
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 1` — SHIP_TYPES 인덱스 = 세이브 wire 값
 *   - `signatureBit = 18` — `src/sim/shipSignature.ts` 의 `SIG_BRUISER_ARMOR` 가 정본,
 *     `tests/shipSignatureRegistry.test.ts` 가 두 값을 마주 세운다
 *   - 트리 3계열: blade/offense · morph/utility · fortify/defense
 *   - 시그니처 패시브: 피격 시 장갑 스택(상한 8, 스택당 250bp 감소, 비피격 180틱마다 1스택 소멸)
 *
 * ## 신규 StatKey 0 (설계서 §2)
 * 기존 16종 StatKey 안에서만 짰다. 스킬이 주지 않기로 한 4종(`mineralFindPct`·`fireDmg`·
 * `coldSlow`·`lightning`)은 쓰지 않는다 — 앞은 메타 재화, 뒤 셋은 장비 어픽스 전용이다.
 *
 * ## 캡스톤 효과는 affinity 가 정한다
 * `src/items/loadout.ts` 가 `capstoneActive(invest, 'firepower'|'survival'|'mobility')` 로
 * 캡스톤 비트를 세우고, 신규 타입 노드의 레거시 `tree` 필드는 affinity 의 역매핑이다. 따라서
 * offense 캡스톤 = 탄막 상쇄 레이저, defense = 치명타 1회 무효, utility = 대시 잔상 소거로
 * **효과가 이미 정해져 있다**. 이름만 기체 색으로 갈아입히고 설명은 실제 효과를 적는다
 * (없는 효과를 약속하면 UI 가 거짓말을 한다).
 */

import { NODES_PER_TREE, CAPSTONE_GATE } from '../skills.js';
import { buildShipTree } from './authoring.js';
import type { NodeSpec } from './authoring.js';
import type { ShipTypeDef } from './types.js';

const SLUG = 'bruiser';

// --- blade (offense): 단발 피해와 관통. 사거리는 일부러 얕다 ------------------
const BLADE: readonly (readonly NodeSpec[])[] = [
  [
    ['분쇄 타격', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['근접 조준', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['톱니 탄자', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['돌격 격발', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
  ],
  [
    ['파쇄 탄두', '탄환 데미지 +5%/pt', 'damagePct', 5, 4],
    ['강습 관통', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['육박 사거리', '사거리 +25/pt', 'rangeFlat', 25, 4],
    ['충각 가속', '탄속 +3%/pt', 'bulletSpeedPct', 3, 4],
  ],
  [
    ['절단 각인', '탄환 데미지 +5%/pt', 'damagePct', 5, 4],
    ['이중 날', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['관통 톱날', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['격돌 격발', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
  ],
  [
    ['파열 절단', '탄환 데미지 +6%/pt', 'damagePct', 6, 4],
    ['중격 탄두', '탄환 데미지 +6%/pt', 'damagePct', 6, 4],
    ['압착 장약', '탄환 데미지 +6%/pt', 'damagePct', 6, 4],
    ['강타 속사', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
  ],
  [
    ['참격 교리', '탄환 데미지 +8%/pt', 'damagePct', 8, 5],
    ['절멸 관통 교리', '관통 +1/2pt(내림)', 'pierce', 0.5, 5],
    ['일격 증폭 교리', '탄환 데미지 +7%/pt', 'damagePct', 7, 5],
    ['돌파 격발 교리', '연사 속도 +4%/pt', 'fireRatePct', 4, 4],
  ],
];

// --- morph (utility): 돌진 재충전과 접근. 파편 회수로 자원 유지 ---------------
const MORPH: readonly (readonly NodeSpec[])[] = [
  [
    ['돌진 조율', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['관성 제어', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
    ['파편 회수', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
    ['전투 학습', '경험치 +2%/pt', 'xpPct', 2, 4],
  ],
  [
    ['충각 전개', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['중장 추진', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
    ['자기 견인', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['전장 적응', '경험치 +2%/pt', 'xpPct', 2, 4],
  ],
  [
    ['변형 프레임', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['강행 돌파', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['파편 자석', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['실전 교본', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['연속 충각', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['돌진 관성', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['광역 회수', '젬 자석 반경 +6%/pt', 'magnetPct', 6, 4],
    ['백병 숙련', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['무한 충각 교리', '대시 재충전 -5%/pt', 'dashCdPct', 5, 5],
    ['폭주 추진 교리', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 5],
    ['전장 흡인 교리', '젬 자석 반경 +7%/pt', 'magnetPct', 7, 5],
    ['백병 지배 교리', '경험치 +4%/pt', 'xpPct', 4, 4],
  ],
];

// --- fortify (defense): flat 최대HP 축. 이 기체의 정체성 ----------------------
const FORTIFY: readonly (readonly NodeSpec[])[] = [
  [
    ['중장 도금', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['격벽 보강', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['완충 장갑', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
    ['버팀 자세', '대시 재충전 -2%/pt', 'dashCdPct', 2, 4],
  ],
  [
    ['복합 장갑판', '최대 HP +10/pt', 'maxHpFlat', 10, 4],
    ['생체 보강', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['충격 분산', '최대 HP +10/pt', 'maxHpFlat', 10, 4],
    ['고정 발판', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
  ],
  [
    ['강화 늑골', '최대 HP +12/pt', 'maxHpFlat', 12, 4],
    ['적응 도금', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['반응 장갑', '최대 HP +12/pt', 'maxHpFlat', 12, 4],
    ['반동 제어', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
  ],
  [
    ['초중량 프레임', '최대 HP +14/pt', 'maxHpFlat', 14, 4],
    ['재생 조직', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['내충격 코어', '최대 HP +14/pt', 'maxHpFlat', 14, 4],
    ['견고한 발놀림', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
  ],
  [
    ['불괴 교리', '최대 HP +5%/pt', 'maxHpPct', 5, 5],
    ['타이탄 늑골 교리', '최대 HP +18/pt', 'maxHpFlat', 18, 5],
    ['강철 의지 교리', '최대 HP +5%/pt', 'maxHpPct', 5, 5],
    ['부동 자세 교리', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
  ],
];

export const BRUISER: ShipTypeDef = {
  id: 1,
  slug: SLUG,
  trees: [
    buildShipTree(SLUG, 'blade', 'offense', BLADE, [
      '분쇄 광선',
      '1.5초마다 전방 광선이 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'morph', 'utility', MORPH, [
      '충각 잔상',
      '대시 시 반경 320 내 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'fortify', 'defense', FORTIFY, [
      '불괴 장갑',
      '런당 1회 치명 피격을 무효화 + 짧은 무적',
    ]),
  ],
  nodesPerTree: NODES_PER_TREE,
  capstoneGate: CAPSTONE_GATE,
  signatureBit: 18,
  baseBp: { damageBp: 800, fireRateBp: -600, maxHpBp: 2500, moveSpeedBp: -500 },
};
