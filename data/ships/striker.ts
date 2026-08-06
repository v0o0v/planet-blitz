/**
 * 스트라이커 = 기체 타입 0, 만능 기준점 (ADR-0019 · ADR-0049).
 *
 * 정체성: **교과서 · 전천후 · 무기 그 자체**. 다른 6기체가 "상태를 비트는" 동안 스트라이커는
 * **발사 리듬 자체**를 정체성으로 삼는다. 설계 정본은
 * `.omc/plans/skill-rebuild-2026-08-05/striker.md`(승인본 4판) — 레벨 공식·침공 판정·구현
 * 태그는 전부 거기 있고, 이 파일은 **와이어 레이아웃과 표시 문구**만 담는다.
 *
 * ## 이 파일의 내력 — 구 규율은 폐기됐다
 * 구 버전은 `data/skills.ts` 의 63노드 리터럴을 **import 해 조립만** 했다("한 줄도 옮겨 적지
 * 않는다"). 그 규율의 근거는 리터럴 복사 실수가 flat 인덱스를 밀어 삼중 해시 계약을 조용히
 * 깬다는 것이었는데, ADR-0049 가 노드 자체를 통째로 교체하면서 옮겨 적을 원본이 사라졌다.
 * 같은 위험은 {@link buildShipAxis} 가 **축당 10개가 아니면 던지는 것**으로 막는다.
 *
 * ## 축 순서를 바꾸지 않는다
 * `[firepower(offense), survival(defense), mobility(utility)]` — 구 `SKILL_TREES` 순서 그대로다.
 * 액티브 레지스트리(`data/ships/actives/striker.ts`)가 `treeIndex` 로 축을 가리키고 i18n 키가
 * 축 slug 를 쓰므로, 순서를 바꾸면 스킬 재편과 무관한 배선이 함께 밀린다. **설계서가 F→M→S
 * 순으로 서술하는 것은 편집 순서일 뿐 flat 순서가 아니다.**
 *
 * 시그니처 패시브(정조준 사이클, 비트 24 = `SIG_STRIKER_MARKSMAN`)는 이 커밋에서 부여한다 —
 * `src/sim/shipSignature.ts` 가 상수·순수 함수 정본이고, `src/sim/world.ts` 가 `aux0` 사이클
 * 카운터 배선(stepShipSignature 분기 + autoAttack 정조준 적용)을 소유한다. 골든 3종
 * (shipHashBaseline·denoFixture·encounterHashInvariance)이 이 변경으로 깨지는 것은 **의도된
 * 결과다** — 스트라이커가 fixtures 의 기본 기체라 `uniqueMask` 가 바뀐다(재생성은 레인 리드
 * 소관, `prerequisites.md` §5-5).
 */

import { ACTIVE_HI_GATE_DEFAULT, buildShipAxis } from './types.js';
import type { ShipTypeDef, SkillSpec } from './types.js';

const SLUG = 'striker';

/** 화력 — 발사 리듬과 정조준 사이클을 직접 만지는 축. */
const FIREPOWER: readonly SkillSpec[] = [
  ['F1', 'kill-momentum', '전과 확장', '적을 처치할 때마다 정조준 사이클 카운터가 즉시 충전된다'],
  ['F2', 'recoil-carry', '반동 전달', '대시 직후 짧은 창 동안 볼리가 확산 0 으로 집속되고 강화된다'],
  ['F3', 'vent-burst', '과열 배출', '화력 액티브 발동 틱에 주무기 쿨다운 잔여를 환급하고 투사체가 정조준 강화를 받는다'],
  ['F4', 'shatter-round', '파편 격발', '관통 예산을 소진하고 소멸하는 탄이 그 자리에서 소형 폭발을 남긴다'],
  ['F5', 'sightline-pierce', '조준선 관통', '자동 조준 표적이 조준각 협각 콘 안일 때 볼리가 관통 +1 과 피해 증폭을 얻는다'],
  ['F6', 'incendiary-mark', '소이 정조준', '정조준탄이 화상을 부여하고, 이미 화상 중이면 잔여 화상 피해를 즉시 일괄 정산한다'],
  ['F7', 'target-lock', '표적 고정', '같은 표적을 연속 명중할 때마다 그 표적 한정 피해 스택이 쌓인다'],
  ['F8', 'overheat-shatter', '과열 파쇄', '보스 과열 창 동안 명중할 때마다 창 잔여 틱을 연장한다'],
  ['F9', 'suppress-shot', '제압 사격', '정조준탄이 명중한 적을 좌표 직접 변위로 밀어낸다'],
  ['F10', 'extended-mag', '연장 탄창', '정조준 볼리 발사 틱에 같은 방향으로 후속 볼리 1회를 즉시 추가 발사한다'],
];

/** 생존 — 피격·벽·해저드·콤보를 자원으로 바꾸는 축. */
const SURVIVAL: readonly SkillSpec[] = [
  ['S1', 'retaliation-sight', '응전 조준', 'HP 가 깎인 피격 틱에 정조준 사이클 카운터가 만충된다'],
  ['S2', 'reactive-plating', '반사 도금', 'HP 가 깎인 피격 틱에 주변 적탄을 소거한다'],
  ['S3', 'field-triage', '전리 응급', '엘리트를 처치하면 HP 를 회복한다'],
  ['S4', 'cover-doctrine', '엄폐 교리', '벽에 접촉 중일 때 피격되면 받는 피해가 감소한다'],
  ['S5', 'hazard-adapt', '극지 적응', '감속 장판이 가속 장판으로 역전되고 용암 피해가 경감된다'],
  ['S6', 'sustain-field', '유지 보강', '생존 액티브 지속 중 자석 반경이 커지고 이동 감속에 면역이 된다'],
  ['S7', 'last-rites', '최후 처형', 'HP 30% 이하인 동안 정조준탄이 잔여 HP 임계 이하의 적을 즉시 처치한다'],
  ['S8', 'combo-shield', '콤보 차폐', '피격 시 콤보 스택을 소모해 피해를 흡수하고, 정조준 발사가 콤보 유지 창을 연명시킨다'],
  ['S9', 'expiry-stasis', '만료 정지장', '생존 액티브가 끝나는 틱에 반경 내 적의 이동이 정지한다'],
  ['S10', 'hull-accretion', '선체 증축', '런 누적 XP 가 임계를 넘길 때마다 최대 HP 가 런 내 영구 증가한다'],
];

/** 기동 — 대시·젬·자석·지형을 얽는 축. */
const MOBILITY: readonly SkillSpec[] = [
  ['M1', 'inertia-burst', '관성 방출', '기동 액티브 발동 시 출발 지점에 폭발과 적탄 소거를 남긴다'],
  ['M2', 'thrust-wake', '추진 항적', '대시 발동 틱에 대시 방향으로 정지 발사체 열을 깐다'],
  ['M3', 'gem-route', '수집 항로', '젬을 수거할 때마다 대시 쿨다운이 즉시 감소한다'],
  ['M4', 'slipstream', '슬립스트림', '자석장이 이동 방향으로 길어져 진행 방향 전방의 흡인 반경이 확장된다'],
  ['M5', 'wall-kick', '벽차기', '직전 틱에 벽 슬라이드가 일어난 상태에서 대시하면 거리와 무적프레임이 강화된다'],
  ['M6', 'dash-purge', '활공 정화', '대시에 잔상 소거를 자체 부여하고 소거 반경 안 적에게 냉기를 건다'],
  ['M7', 'signal-chaser', '신호 추적', '에코·조우가 활성인 동안 대시 쿨다운이 반감되고 안정화 완수 시 전액 환급된다'],
  ['M8', 'vault-shot', '도약 사격', '2단 도약의 단 사이에 조준 방향으로 정조준 볼리 1회를 자동 발사한다'],
  ['M9', 'ram-maneuver', '충각 기동', '무적프레임 동안 몸통 충돌이 역전돼 접촉한 적이 피해를 받는다'],
  ['M10', 'twin-thruster', '이중 추진', '대시가 충전식 2회가 되고 두 번째 충전은 별도의 느린 재충전을 따른다'],
];

export const STRIKER: ShipTypeDef = {
  id: 0,
  slug: SLUG,
  trees: [
    buildShipAxis(SLUG, 'firepower', 'offense', FIREPOWER),
    buildShipAxis(SLUG, 'survival', 'defense', SURVIVAL),
    buildShipAxis(SLUG, 'mobility', 'utility', MOBILITY),
  ],
  activeHiGate: ACTIVE_HI_GATE_DEFAULT,
  // 정조준 사이클 — `src/sim/shipSignature.ts` 의 `SIG_STRIKER_MARKSMAN` 이 정본,
  // `tests/shipSignatureRegistry.test.ts` 가 두 값을 마주 세운다(브루저 등 나머지 6종과 같은
  // 규율 — 이 파일이 sim 모듈을 직접 import 하지 않는다).
  signatureBit: 24,
  baseBp: { damageBp: 0, fireRateBp: 0, maxHpBp: 0, moveSpeedBp: 0 },
};
