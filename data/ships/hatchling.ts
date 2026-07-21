/**
 * hatchling = 기체 타입 4, 부화 소환 (설계서 §3).
 *
 * ## 컨셉
 * 알 모양 모선이 병아리 드론을 부화시켜 내보낸다. **메커니즘은 그대로다** — 처치를 적립해
 * 임계에 닿으면 동료가 자동으로 출격한다. 바뀐 것은 fiction·naming·아트뿐이다.
 * (구 slug `bion`(곤충·생체 컨셉)에서 개명. 2026-07-21 사용자 반려: "벌레 말고 귀여운 걸로."
 * `id = 4` 와 `signatureBit = 21` 은 **세이브·리플레이 wire 계약이라 그대로 유지**한다.)
 *
 * ## 빌드 방향
 * 얕고 넓은 무리. **최고 연사 + 최고 경험치 획득**, 대신 단발 피해가 로스터에서 가장 낮다.
 * 다른 기체와 갈리는 축이 하나 더 있다 — **노드 수 자체가 다르다.**
 *
 * ### 왜 트리당 25노드인가 (다른 타입은 20)
 * 1. **컨셉**: 무리는 "큰 한 방"이 아니라 "작은 것이 많이"다. 같은 포인트 예산(만렙 ~99pt)을
 *    더 잘게 쪼개 넣는 형태를 노드 수로 표현했다 — perPoint 를 낮추기만 해서는 단순 하향이다.
 * 2. **아키텍처 검증**: `nodesPerTree` 는 타입별 필드인데(설계서 §2), **전 타입이 63이면
 *    어딘가 남아 있는 하드코딩 63 이 영원히 보이지 않는다.** 이 프로젝트에서 8회 재발한
 *    "단위 테스트는 그린인데 배선이 통째로 없다" 의 전형이다. 해츨링의 78(=3×26) 이 그
 *    하드코딩을 실제로 밟는 유일한 타입이며, `tests/save.test.ts` 의 꼬리 인덱스 가드가 이
 *    타입에서만 판별력을 갖는다.
 * 3. **63 미만은 피했다**: 노드 수가 63보다 *적은* 타입을 만들면 리플레이 폴드의 길이 계약이
 *    취약해진다. 63 **초과**는 초과분이 투자 불가로 남을 뿐 손상되지 않는다.
 *
 * ### capstoneGate = 44 (스트라이커·나머지 기체는 40)
 * 게이트는 "계열 base 누적 투자 하한"이라 **포인트 단위**다. 해츨링의 계열 base 용량은 103
 * (스트라이커 83)이지만 플레이어의 포인트 예산은 같으므로 비율(83의 48% = 40)을 그대로 옮기면
 * 50pt 가 되어 다른 기체보다 캡스톤이 훨씬 멀어진다. 절대 포인트를 기준으로 소폭만 올려
 * "노드가 얕은 대신 조금 더 넓게 투자해야 한다"를 표현했다(103의 43%).
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 4` · `signatureBit = 21`(`src/sim/shipSignature.ts` 의 `SIG_HATCHLING_BROOD` 가 정본)
 *   - 트리 3계열: brood/offense · nurture/utility · shelter/defense
 *   - 시그니처 패시브: 처치 적립, 임계에서 병아리 드론 자동 출격
 *
 * ## 신규 StatKey 0 · 캡스톤 효과는 affinity 가 정한다
 * 근거는 `data/ships/bruiser.ts` 헤더 참조.
 */

import { buildShipTree } from './authoring.js';
import type { NodeSpec } from './authoring.js';
import type { ShipTypeDef } from './types.js';

const SLUG = 'hatchling';

/** 트리당 base 노드 수 — 5티어 × 5노드. 다른 타입(20)과 의도적으로 다르다(위 헤더). */
const HATCHLING_NODES_PER_TREE = 25;

/** 계열 base 용량 103pt 대비 43% 게이트. 스트라이커는 83 대비 48%(=40). */
const HATCHLING_CAPSTONE_GATE = 44;

// --- brood (offense): 연사 축. 단발 피해는 로스터 최저 -------------------------
const BROOD: readonly (readonly NodeSpec[])[] = [
  [
    ['종종걸음 격발', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
    ['깃털 산탄', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['부리 쪼기', '탄환 데미지 +2%/pt', 'damagePct', 2, 4],
    ['날갯짓 사출', '탄속 +2%/pt', 'bulletSpeedPct', 2, 4],
    ['무리 신호', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
  ],
  [
    ['부화 격발', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
    ['솜털 산탄', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['야무진 쪼기', '탄환 데미지 +2%/pt', 'damagePct', 2, 4],
    ['도약 사출', '탄속 +3%/pt', 'bulletSpeedPct', 3, 4],
    ['무리 반사', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
  ],
  [
    ['재잘 격발', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
    ['다발 깃털', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['단단한 부리', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['관통 부리', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['무리 가속', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
  ],
  [
    ['폭풍 종종걸음', '연사 속도 +4%/pt', 'fireRatePct', 4, 4],
    ['깃털 폭죽', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['힘찬 쪼기', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['질주 사출', '탄속 +4%/pt', 'bulletSpeedPct', 4, 4],
    ['무리 공명', '연사 속도 +4%/pt', 'fireRatePct', 4, 4],
  ],
  [
    ['무한 재잘 교리', '연사 속도 +5%/pt', 'fireRatePct', 5, 5],
    ['만개 깃털 교리', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 5],
    ['강철 부리 교리', '탄환 데미지 +4%/pt', 'damagePct', 4, 5],
    ['관통 부리 교리', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['광란 종종 교리', '연사 속도 +5%/pt', 'fireRatePct', 5, 4],
  ],
];

// --- nurture (utility): 경험치·수집 축. 성장 속도가 이 기체의 정체성 ----------
const NURTURE: readonly (readonly NodeSpec[])[] = [
  [
    ['알 품기', '경험치 +2%/pt', 'xpPct', 2, 4],
    ['모이 자석', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
    ['아장 걸음', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
    ['성장 촉진', '경험치 +2%/pt', 'xpPct', 2, 4],
    ['부리 감지', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
  ],
  [
    ['따뜻한 둥지', '경험치 +3%/pt', 'xpPct', 3, 4],
    ['모이 견인', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['총총 질주', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['둥지 도약', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['학습 지저귐', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['급속 성장', '경험치 +3%/pt', 'xpPct', 3, 4],
    ['모이 그물', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['폭신 추진', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['깃털 회피', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['무리 학습', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['깃털 갈이', '경험치 +4%/pt', 'xpPct', 4, 4],
    ['광역 모이', '젬 자석 반경 +6%/pt', 'magnetPct', 6, 4],
    ['활공 추진', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 4],
    ['연속 도약', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['무리 지혜', '경험치 +4%/pt', 'xpPct', 4, 4],
  ],
  [
    ['초성장 교리', '경험치 +5%/pt', 'xpPct', 5, 5],
    ['모이 지배 교리', '젬 자석 반경 +7%/pt', 'magnetPct', 7, 5],
    ['활공 지배 교리', '이동 속도 +5%/pt', 'moveSpeedPct', 5, 5],
    ['무한 도약 교리', '대시 재충전 -5%/pt', 'dashCdPct', 5, 4],
    ['무리 지혜 교리', '경험치 +5%/pt', 'xpPct', 5, 4],
  ],
];

// --- shelter (defense): 얕고 넓은 방어. **노드당 HP 는 일부러 낮다** -----------
// 해츨링의 계열 용량이 103(다른 타입 83)이라 flat 값을 같은 눈금으로 주면 만렙 총량이
// 브루저의 장갑과 맞먹어 "무리는 물렁하다" 는 축이 사라진다. 포인트당으로 읽으면
// 브루저 5.3HP/pt · 해츨링 3.5HP/pt — 총량과 효율 두 지표 모두에서 브루저가 앞선다.
const SHELTER: readonly (readonly NodeSpec[])[] = [
  [
    ['알껍질', '최대 HP +5/pt', 'maxHpFlat', 5, 4],
    ['두툼한 껍질', '최대 HP +5/pt', 'maxHpFlat', 5, 4],
    ['솜털 보온', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
    ['둥지 벽', '최대 HP +5/pt', 'maxHpFlat', 5, 4],
    ['온기 순환', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
  ],
  [
    ['단단한 껍질', '최대 HP +7/pt', 'maxHpFlat', 7, 4],
    ['자라는 솜털', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['겹둥지', '최대 HP +7/pt', 'maxHpFlat', 7, 4],
    ['놀란 회피', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['포근한 이불', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
  ],
  [
    ['강화 껍질', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['두꺼운 솜털', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['삼중 둥지', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['미끄럼 회피', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
    ['따뜻한 공기층', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
  ],
  [
    ['다층 껍질', '최대 HP +10/pt', 'maxHpFlat', 10, 4],
    ['촘촘한 솜털', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['요새 둥지', '최대 HP +10/pt', 'maxHpFlat', 10, 4],
    ['재빠른 회피', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['깃털 방석', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
  ],
  [
    ['불괴 둥지 교리', '최대 HP +5%/pt', 'maxHpPct', 5, 5],
    ['거대 껍질 교리', '최대 HP +12/pt', 'maxHpFlat', 12, 5],
    ['무한 솜털 교리', '최대 HP +5%/pt', 'maxHpPct', 5, 5],
    ['철벽 둥지 교리', '최대 HP +10/pt', 'maxHpFlat', 10, 4],
    ['질풍 회피 교리', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
  ],
];

export const HATCHLING: ShipTypeDef = {
  id: 4,
  slug: SLUG,
  trees: [
    buildShipTree(SLUG, 'brood', 'offense', BROOD, [
      '햇살 광선',
      '1.5초마다 전방 광선이 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'nurture', 'utility', NURTURE, [
      '깃털 잔상',
      '대시 시 반경 320 내 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'shelter', 'defense', SHELTER, [
      '둥지 보호',
      '런당 1회 치명 피격을 무효화 + 짧은 무적',
    ]),
  ],
  nodesPerTree: HATCHLING_NODES_PER_TREE,
  capstoneGate: HATCHLING_CAPSTONE_GATE,
  signatureBit: 21,
  baseBp: { damageBp: -500, fireRateBp: 500, maxHpBp: 1000, moveSpeedBp: 0 },
};
