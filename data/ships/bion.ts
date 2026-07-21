/**
 * bion = 기체 타입 4, 군체 소환 (설계서 §3).
 *
 * ## 빌드 방향
 * 얕고 넓은 군체. **최고 연사 + 최고 경험치 획득**, 대신 단발 피해가 4종 중 가장 낮다.
 * 다른 세 기체와 갈리는 축이 하나 더 있다 — **노드 수 자체가 다르다.**
 *
 * ### 왜 트리당 25노드인가 (다른 타입은 20)
 * 1. **컨셉**: 군체는 "큰 한 방"이 아니라 "작은 것이 많이"다. 같은 포인트 예산(만렙 ~99pt)을
 *    더 잘게 쪼개 넣는 형태를 노드 수로 표현했다 — perPoint 를 낮추기만 해서는 단순 하향이다.
 * 2. **아키텍처 검증**: `nodesPerTree` 는 타입별 필드인데(설계서 §2), **전 타입이 63이면
 *    어딘가 남아 있는 하드코딩 63 이 영원히 보이지 않는다.** 이 프로젝트에서 8회 재발한
 *    "단위 테스트는 그린인데 배선이 통째로 없다" 의 전형이다. 비온의 78(=3×26) 이 그 하드코딩을
 *    실제로 밟는 유일한 타입이며, `tests/save.test.ts` 의 꼬리 인덱스 가드가 이 타입에서만
 *    판별력을 갖는다.
 * 3. **63 미만은 피했다**: 노드 수가 63보다 *적은* 타입을 만들면 `investSkill`(profile.ts)이
 *    아직 스트라이커 정본(`SKILLS`, 길이 63)으로 인덱스를 판정하므로 벡터 범위 밖에 값을 써
 *    길이를 늘려 버린다(리플레이 폴드 계약 파손). 63 **초과**는 초과분이 투자 불가로 남을 뿐
 *    손상되지 않는다 — M8-L4 가 타입별 노드로 일반화할 때까지의 안전한 방향이다.
 *
 * ### capstoneGate = 44 (스트라이커·나머지 3종은 40)
 * 게이트는 "계열 base 누적 투자 하한"이라 **포인트 단위**다. 비온의 계열 base 용량은 103
 * (스트라이커 83)이지만 플레이어의 포인트 예산은 같으므로 비율(83의 48% = 40)을 그대로 옮기면
 * 50pt 가 되어 다른 기체보다 캡스톤이 훨씬 멀어진다. 절대 포인트를 기준으로 소폭만 올려
 * "노드가 얕은 대신 조금 더 넓게 투자해야 한다"를 표현했다(103의 43%).
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 4` · `signatureBit = 21`(`src/sim/shipSignature.ts` 의 `SIG_BION_SPORE` 가 정본)
 *   - 트리 3계열: swarm/offense · mutate/utility · blight/defense
 *   - 시그니처 패시브: 처치 시 포자 적립, 임계에서 자동 소환
 *
 * ## 신규 StatKey 0 · 캡스톤 효과는 affinity 가 정한다
 * 근거는 `data/ships/bruiser.ts` 헤더 참조.
 */

import { buildShipTree } from './authoring.js';
import type { NodeSpec } from './authoring.js';
import type { ShipTypeDef } from './types.js';

const SLUG = 'bion';

/** 트리당 base 노드 수 — 5티어 × 5노드. 다른 타입(20)과 의도적으로 다르다(위 헤더 §2). */
const BION_NODES_PER_TREE = 25;

/** 계열 base 용량 103pt 대비 43% 게이트. 스트라이커는 83 대비 48%(=40). */
const BION_CAPSTONE_GATE = 44;

// --- swarm (offense): 연사 축. 단발 피해는 4종 중 최저 -----------------------
const SWARM: readonly (readonly NodeSpec[])[] = [
  [
    ['증식 격발', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
    ['포자 산탄', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['갉는 탄', '탄환 데미지 +2%/pt', 'damagePct', 2, 4],
    ['촉수 사출', '탄속 +2%/pt', 'bulletSpeedPct', 2, 4],
    ['군체 신경', '연사 속도 +2%/pt', 'fireRatePct', 2, 4],
  ],
  [
    ['분열 격발', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
    ['확산 포자', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['부식 탄', '탄환 데미지 +2%/pt', 'damagePct', 2, 4],
    ['유충 사출', '탄속 +3%/pt', 'bulletSpeedPct', 3, 4],
    ['군체 반사', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
  ],
  [
    ['다발 격발', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
    ['다중 포자', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['산성 탄', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['관통 촉수', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['신경 가속', '연사 속도 +3%/pt', 'fireRatePct', 3, 4],
  ],
  [
    ['폭주 격발', '연사 속도 +4%/pt', 'fireRatePct', 4, 4],
    ['포자 폭발', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 4],
    ['용해 탄', '탄환 데미지 +3%/pt', 'damagePct', 3, 4],
    ['가속 촉수', '탄속 +4%/pt', 'bulletSpeedPct', 4, 4],
    ['군체 공명', '연사 속도 +4%/pt', 'fireRatePct', 4, 4],
  ],
  [
    ['무한 증식 교리', '연사 속도 +5%/pt', 'fireRatePct', 5, 5],
    ['만개 포자 교리', '탄환 +1/4pt(내림)', 'bulletCount', 0.25, 5],
    ['부식 지배 교리', '탄환 데미지 +4%/pt', 'damagePct', 4, 5],
    ['관통 군체 교리', '관통 +1/2pt(내림)', 'pierce', 0.5, 4],
    ['광란 격발 교리', '연사 속도 +5%/pt', 'fireRatePct', 5, 4],
  ],
];

// --- mutate (utility): 경험치·수집 축. 성장 속도가 이 기체의 정체성 ----------
const MUTATE: readonly (readonly NodeSpec[])[] = [
  [
    ['적응 대사', '경험치 +2%/pt', 'xpPct', 2, 4],
    ['포자 흡수', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
    ['유연 근섬유', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
    ['변이 촉진', '경험치 +2%/pt', 'xpPct', 2, 4],
    ['촉각 확장', '젬 자석 반경 +4%/pt', 'magnetPct', 4, 4],
  ],
  [
    ['진화 압력', '경험치 +3%/pt', 'xpPct', 3, 4],
    ['균사 견인', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['활주 촉수', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['재구성 대사', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['세포 학습', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['급속 변이', '경험치 +3%/pt', 'xpPct', 3, 4],
    ['균사망', '젬 자석 반경 +5%/pt', 'magnetPct', 5, 4],
    ['수축 추진', '이동 속도 +3%/pt', 'moveSpeedPct', 3, 4],
    ['탈피', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['공생 학습', '경험치 +3%/pt', 'xpPct', 3, 4],
  ],
  [
    ['형질 전환', '경험치 +4%/pt', 'xpPct', 4, 4],
    ['광역 균사', '젬 자석 반경 +6%/pt', 'magnetPct', 6, 4],
    ['파동 추진', '이동 속도 +4%/pt', 'moveSpeedPct', 4, 4],
    ['연속 탈피', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['집단 지성', '경험치 +4%/pt', 'xpPct', 4, 4],
  ],
  [
    ['초진화 교리', '경험치 +5%/pt', 'xpPct', 5, 5],
    ['균사 지배 교리', '젬 자석 반경 +7%/pt', 'magnetPct', 7, 5],
    ['파동 지배 교리', '이동 속도 +5%/pt', 'moveSpeedPct', 5, 5],
    ['무한 탈피 교리', '대시 재충전 -5%/pt', 'dashCdPct', 5, 4],
    ['군체 지성 교리', '경험치 +5%/pt', 'xpPct', 5, 4],
  ],
];

// --- blight (defense): 얕고 넓은 방어. **노드당 HP 는 일부러 낮다** -----------
// 비온의 계열 용량이 103(다른 타입 83)이라 flat 값을 같은 눈금으로 주면 만렙 총량이
// 브루저의 장갑과 맞먹어 "군체는 물렁하다" 는 축이 사라진다. 포인트당으로 읽으면
// 브루저 5.3HP/pt · 비온 3.5HP/pt — 총량과 효율 두 지표 모두에서 브루저가 앞선다.
const BLIGHT: readonly (readonly NodeSpec[])[] = [
  [
    ['키틴 외피', '최대 HP +5/pt', 'maxHpFlat', 5, 4],
    ['두꺼운 세포벽', '최대 HP +5/pt', 'maxHpFlat', 5, 4],
    ['재생 조직', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
    ['포자 완충', '최대 HP +5/pt', 'maxHpFlat', 5, 4],
    ['독성 분비', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
  ],
  [
    ['경화 외피', '최대 HP +7/pt', 'maxHpFlat', 7, 4],
    ['증식 세포', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['부식 방호', '최대 HP +7/pt', 'maxHpFlat', 7, 4],
    ['회피 반사', '대시 재충전 -3%/pt', 'dashCdPct', 3, 4],
    ['점액 도포', '최대 HP +2%/pt', 'maxHpPct', 2, 4],
  ],
  [
    ['갑각 성장', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['재생 가속', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
    ['부패 저항', '최대 HP +8/pt', 'maxHpFlat', 8, 4],
    ['미끄러짐', '이동 속도 +2%/pt', 'moveSpeedPct', 2, 4],
    ['독소 축적', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
  ],
  [
    ['다층 외피', '최대 HP +10/pt', 'maxHpFlat', 10, 4],
    ['세포 재구축', '최대 HP +4%/pt', 'maxHpPct', 4, 4],
    ['균사 보강', '최대 HP +10/pt', 'maxHpFlat', 10, 4],
    ['유연 회피', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
    ['맹독 피부', '최대 HP +3%/pt', 'maxHpPct', 3, 4],
  ],
  [
    ['불멸 군체 교리', '최대 HP +5%/pt', 'maxHpPct', 5, 5],
    ['거대 외피 교리', '최대 HP +12/pt', 'maxHpFlat', 12, 5],
    ['무한 재생 교리', '최대 HP +5%/pt', 'maxHpPct', 5, 5],
    ['역병 지배 교리', '최대 HP +10/pt', 'maxHpFlat', 10, 4],
    ['부식 지배 외피', '대시 재충전 -4%/pt', 'dashCdPct', 4, 4],
  ],
];

export const BION: ShipTypeDef = {
  id: 4,
  slug: SLUG,
  trees: [
    buildShipTree(SLUG, 'swarm', 'offense', SWARM, [
      '포자 소각 광선',
      '1.5초마다 전방 광선이 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'mutate', 'utility', MUTATE, [
      '균사 잔상',
      '대시 시 반경 320 내 적탄을 소거',
    ]),
    buildShipTree(SLUG, 'blight', 'defense', BLIGHT, [
      '포자 재생',
      '런당 1회 치명 피격을 무효화 + 짧은 무적',
    ]),
  ],
  nodesPerTree: BION_NODES_PER_TREE,
  capstoneGate: BION_CAPSTONE_GATE,
  signatureBit: 21,
  baseBp: { damageBp: -500, fireRateBp: 500, maxHpBp: 1000, moveSpeedBp: 0 },
};
