/**
 * mallow = 기체 타입 5, 완충 재생 (로스터 7종 확장, 2026-07-21 사용자 지시).
 *
 * ## 컨셉
 * 마시멜로. 폭신해서 충격을 "먹는다" — 피격 피해의 일부를 즉시가 아니라 **지연 피해**로
 * 돌리고, 일정 시간 맞지 않으면 그만큼을 회복한다. 시그니처 상수·순수 함수는
 * `src/sim/shipSignature.ts` 의 `SIG_MALLOW_CUSHION`(비트 22) 구역이 정본이고, sim 배선은
 * 아직 없다(설계서 §3: 브루저·아크캐스터만 완전 배선이 우선. 팬텀·해츨링과 같은 수준).
 *
 * ## 빌드 방향
 * **비율 체력(maxHpPct) 1위.** 브루저가 flat 장갑을 쌓아 "두꺼운 선체"라면, 말로우는 기본
 * 체력을 배로 부풀리는 축이라 계보·장비로 기본 HP 가 커질수록 함께 커진다 — 같은 defense
 * affinity 인데 성장 곡선이 다르다. 대신 단발 피해는 로스터 하위권이고 사거리도 거의 없다.
 * `baseBp`(dmg −8% · 연사 −2% · HP +18% · 이동 +6%)가 같은 축을 굳힌다: 브루저(HP +25% ·
 * 이동 −5%)와 달리 **둔하지 않다** — 맞아도 버티면서 계속 돌아다니는 기체다.
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 5` — SHIP_TYPES 인덱스 = 세이브 wire 값. append-only
 *   - `signatureBit = 22`(`src/sim/shipSignature.ts` 의 `SIG_MALLOW_CUSHION` 이 정본,
 *     `tests/shipSignatureRegistry.test.ts` 가 두 값을 마주 세운다)
 *   - 트리 3계열: squish/offense · mend/utility · cushion/defense
 *   - 시그니처 패시브: 피격 피해 일부를 지연 피해로 전환, 무피격 지속 시 회복
 *
 * ## 신규 StatKey 0 · 캡스톤 효과는 affinity 가 정한다
 * 근거는 `data/ships/bruiser.ts` 헤더 참조.
 */

import { NODES_PER_TREE, CAPSTONE_GATE } from '../skills.js';
import { buildShipTree } from './authoring.js';
import type { NodeSpec } from './authoring.js';
import type { ShipTypeDef } from './types.js';

const SLUG = 'mallow';

// --- squish (offense): 눌러 뭉개는 화력. 단발은 중하위, 연사가 받쳐 준다 -------
const SQUISH: readonly (readonly NodeSpec[])[] = [
  [
    ['뭉개기', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['푹신 반동', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
    ['눌러 담은 탄', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['늘어나는 탄자', '탄속 +2%/pt', 'bulletSpeedPct', 2, 4],
  ],
  [
    ['찍어 누르기', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['탄력 격발', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
    ['부푼 탄두', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['쫀득한 사출', '탄속 +3%/pt', 'bulletSpeedPct', 3, 4],
  ],
  [
    ['짓뭉개기', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['반동 흡수', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
    ['겹쳐 누른 탄', '탄환 데미지 +4%/pt', 'damagePct', 4, 4],
    ['탄력 사거리', '사거리 +20/pt', 'rangeFlat', 20, 4],
  ],
  [
    ['압착 타격', '탄환 데미지 +5%/pt', 'damagePct', 5, 4],
    ['연속 탄성', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
    ['부풀린 탄막', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['무른 관통', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
  ],
  [
    ['완충 파괴 교리', '탄환 데미지 +6%/pt', 'damagePct', 6, 5],
    ['탄성 격발 교리', '연사 속도 +4%/pt', 'fireRatePct', 4, 5],
    ['압착 지배 교리', '연사 속도 +4%/pt', 'fireRatePct', 4, 5],
    ['팽창 탄막 교리', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
  ],
];

// --- mend (utility): 회복을 기다리는 시간을 벌어 주는 축(수집·성장·회피) ------
const MEND: readonly (readonly NodeSpec[])[] = [
  [
    ['따뜻한 대사', '경험치 +2%/pt', 'xpPct', 2, 4],
    ['솜털 자력', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
    ['폭신한 보행', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['늘어짐 회복', '대시 재충전 -2%/pt', 'dashCdPct', 2, 4],
  ],
  [
    ['부푸는 학습', '경험치 +3%/pt', 'xpPct', 3, 4],
    ['솜뭉치 견인', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
    ['탄력 보행', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['반동 회수', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
  ],
  [
    ['단맛 축적', '경험치 +3%/pt', 'xpPct', 3, 4],
    ['광폭 솜자력', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['구름 걸음', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['늘임 회피', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
  ],
  [
    ['숙성 대사', '경험치 +4%/pt', 'xpPct', 4, 4],
    ['끈적 견인', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['부양 보행', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 4],
    ['탄성 회피', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
  ],
  [
    ['단맛 지배 교리', '경험치 +5%/pt', 'xpPct', 5, 5],
    ['솜자력 지배 교리', '젬 자석 반경 +6%/pt', 'magnetPct', 6, 5],
    ['구름 항법 교리', '이동 속도 +5%/pt', 'moveSpeedPct', 5, 5],
    ['무한 탄성 교리', '대시 재충전 -5%/pt', 'dashCdPct', 5, 4],
  ],
];

// --- cushion (defense): **비율 체력 1위**. 브루저의 flat 장갑과 정반대 축 -----
// 여기서 maxHpPct 를 로스터 최대(192)로 두는 것이 이 기체의 정체성이다. flat 은 중위권
// (175)에 묶어 브루저(442)를 넘지 않게 한다 — 두 기체가 같은 defense affinity 인데도
// "기본 HP 가 클수록 유리한 말로우 / 기본 HP 와 무관하게 두꺼운 브루저" 로 갈린다.
const CUSHION: readonly (readonly NodeSpec[])[] = [
  [
    ['솜 완충층', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['푹신 외피', '최대 HP +6/pt', 'maxHpFlat', 6, 4],
    ['충격 분산', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['느긋한 회복', '대시 재충전 -2%/pt', 'dashCdPct', 2, 4],
  ],
  [
    ['겹쳐진 솜층', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['탄성 격벽', '최대 HP +7/pt', 'maxHpFlat', 7, 4],
    ['지연 통증', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['말랑 프레임', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
  ],
  [
    ['부푼 완충', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['두툼한 속솜', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['되돌아오는 형상', '최대 HP +5%/pt', 'maxHpPct', 5, 4],
    ['늘어난 회피', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
  ],
  [
    ['다층 쿠션', '최대 HP +5%/pt', 'maxHpPct', 5, 4],
    ['단단한 속심', '최대 HP +9/pt', 'maxHpFlat', 9, 4],
    ['복원 기억', '최대 HP +5%/pt', 'maxHpPct', 5, 4],
    ['무른 반발', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
  ],
  [
    ['무한 완충 교리', '최대 HP +6%/pt', 'maxHpPct', 6, 5],
    ['거대 솜 교리', '최대 HP +11/pt', 'maxHpFlat', 11, 5],
    ['복원 지배 교리', '최대 HP +6%/pt', 'maxHpPct', 6, 5],
    ['탄성 회복 교리', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
  ],
];

export const MALLOW: ShipTypeDef = {
  id: 5,
  slug: SLUG,
  trees: [
    buildShipTree(SLUG, 'squish', 'offense', SQUISH, [
      '달콤 소각 광선',
      '1.5초마다 전방 광선이 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'mend', 'utility', MEND, [
      '솜사탕 잔상',
      '대시 시 반경 320 내 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'cushion', 'defense', CUSHION, [
      '완충 복원',
      '런당 1회 치명 피격을 무효화 + 짧은 무적',
    ]),
  ],
  nodesPerTree: NODES_PER_TREE,
  capstoneGate: CAPSTONE_GATE,
  signatureBit: 22,
  baseBp: { damageBp: -800, fireRateBp: -200, maxHpBp: 1800, moveSpeedBp: 600 },
};
