/**
 * bubble = 기체 타입 6, 거품 방막 (로스터 7종 확장, 2026-07-21 사용자 지시).
 *
 * ## 컨셉
 * 주기적으로 일정 피해를 흡수하는 막이 생기고, 막이 터질 때 주변을 밀어낸다. 시그니처
 * 상수·순수 함수는 `src/sim/shipSignature.ts` 의 `SIG_BUBBLE_FILM`(비트 23) 구역이 정본이고,
 * sim 배선은 아직 없다(설계서 §3: 브루저·아크캐스터만 완전 배선이 우선).
 *
 * ## 빌드 방향
 * **탄속 1위 + 자석 1위.** 막이 실질 체력을 대신하므로 선체 자체는 얇고(`baseBp` HP −14%),
 * 대신 탄이 빠르고 관통이 잘 되며(터지는 압력) 젬을 멀리서 끌어온다(떠다니는 거품).
 * 브루저·말로우가 "맞아도 버틴다" 라면 버블은 **주기마다 한 번씩 안 맞는다** — 같은 defense
 * affinity 를 두고도 축이 다르다. 사거리 노드는 하나도 없다: 붙지도 멀지도 않은 중거리에서
 * 빠른 탄으로 밀어내는 기체다.
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 6` — SHIP_TYPES 인덱스 = 세이브 wire 값. append-only
 *   - `signatureBit = 23`(`src/sim/shipSignature.ts` 의 `SIG_BUBBLE_FILM` 이 정본,
 *     `tests/shipSignatureRegistry.test.ts` 가 두 값을 마주 세운다)
 *   - 트리 3계열: pop/offense · drift/utility · film/defense
 *   - 시그니처 패시브: 주기적 피해 흡수막, 막이 터질 때 주변 밀어내기
 *
 * ## 신규 StatKey 0 · 캡스톤 효과는 affinity 가 정한다
 * 근거는 `data/ships/bruiser.ts` 헤더 참조.
 */

import { NODES_PER_TREE, CAPSTONE_GATE } from '../skills.js';
import { buildShipTree } from './authoring.js';
import type { NodeSpec } from './authoring.js';
import type { ShipTypeDef } from './types.js';

const SLUG = 'bubble';

// --- pop (offense): 터지는 압력 = 탄속·관통 축. 단발 피해는 중하위 ------------
const POP: readonly (readonly NodeSpec[])[] = [
  [
    ['터짐 압력', '탄속 +4%/pt', 'bulletSpeedPct', 4, 4],
    ['얇은 막 탄', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['비눗물 관통', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['잔거품', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
  ],
  [
    ['파열 가속', '탄속 +4%/pt', 'bulletSpeedPct', 4, 4],
    ['표면장력 탄두', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['미끄러운 관통', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['분열 거품', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
  ],
  [
    ['고압 사출', '탄속 +5%/pt', 'bulletSpeedPct', 5, 4],
    ['터지는 탄두', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['막 관통', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['연쇄 파열', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
  ],
  [
    ['초고압 사출', '탄속 +5%/pt', 'bulletSpeedPct', 5, 4],
    ['압축 파열', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['투과 관통', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['다중 거품', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
  ],
  [
    ['파열 지배 교리', '탄속 +7%/pt', 'bulletSpeedPct', 7, 5],
    ['압력 지배 교리', '탄환 데미지 +5%/pt', 'damagePct', 5, 5],
    ['투과 지배 교리', '관통 +1/2pt(내림)', 'pierce', 0.5, 5],
    ['거품 폭풍 교리', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
  ],
];

// --- drift (utility): 떠다니며 끌어온다 = **자석 1위** + 부력(대시) ------------
const DRIFT: readonly (readonly NodeSpec[])[] = [
  [
    ['떠오름', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['거품 인력', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['가벼운 부력', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['무지개 관찰', '경험치 +2%/pt', 'xpPct', 2, 4],
  ],
  [
    ['상승 기류', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['흡착 거품', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['탄성 도약', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['빛 분산 학습', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['표류 항법', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['광역 인력', '젬 자석 반경 +7%/pt', 'magnetPct', 7, 4],
    ['연쇄 부력', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['막 굴절 학습', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['부유 추진', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 4],
    ['소용돌이 인력', '젬 자석 반경 +7%/pt', 'magnetPct', 7, 4],
    ['무중력 도약', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['간섭 무늬 학습', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['표류 지배 교리', '젬 자석 반경 +8%/pt', 'magnetPct', 8, 5],
    ['부력 지배 교리', '대시 재충전 -5%/pt', 'dashCdPct', 5, 5],
    ['부유 항법 교리', '이동 속도 +5%/pt', 'moveSpeedPct', 5, 5],
    ['무지개 지배 교리', '경험치 +4%/pt', 'xpPct', 4, 4],
  ],
];

// --- film (defense): 얇은 막을 여러 겹. flat·비율 둘 다 중위권 ---------------
// 방어 총량으로 이기려 하지 않는다 — 이 기체의 생존은 시그니처(주기적 흡수막)가 담당하고,
// 트리는 그 사이를 버티는 만큼만 준다. 그래서 flat 은 브루저(442)·말로우(175) 아래,
// 비율은 말로우(192) 아래로 묶었다.
const FILM: readonly (readonly NodeSpec[])[] = [
  [
    ['비누막', '최대 HP +5/pt', 'maxHpFlat', 5, 4],
    ['표면 장력', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['얇은 보호막', '최대 HP +5/pt', 'maxHpFlat', 5, 4],
    ['미끄러짐', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
  ],
  [
    ['이중막', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['점성 강화', '최대 HP +6/pt', 'maxHpFlat', 6, 4],
    ['탄력 반사', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['막 복원', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
  ],
  [
    ['삼중막', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['응결 강화', '최대 HP +7/pt', 'maxHpFlat', 7, 4],
    ['반발 회피', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['막 확장', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
  ],
  [
    ['경화 막', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['압력 균형', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['미끄러운 표면', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['파열 반동', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
  ],
  [
    ['불괴 막 교리', '최대 HP +5%/pt', 'maxHpPct', 5, 5],
    ['거대 거품 교리', '최대 HP +10/pt', 'maxHpFlat', 10, 5],
    ['반발 지배 교리', '대시 재충전 -5%/pt', 'dashCdPct', 5, 5],
    ['표면 지배 교리', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
  ],
];

export const BUBBLE: ShipTypeDef = {
  id: 6,
  slug: SLUG,
  trees: [
    buildShipTree(SLUG, 'pop', 'offense', POP, [
      '파열 광선',
      '1.5초마다 전방 광선이 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'drift', 'utility', DRIFT, [
      '거품 잔상',
      '대시 시 반경 320 내 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'film', 'defense', FILM, [
      '막 재생',
      '런당 1회 치명 피격을 무효화 + 짧은 무적',
    ]),
  ],
  nodesPerTree: NODES_PER_TREE,
  capstoneGate: CAPSTONE_GATE,
  signatureBit: 23,
  baseBp: { damageBp: 300, fireRateBp: 700, maxHpBp: -1400, moveSpeedBp: 200 },
};
