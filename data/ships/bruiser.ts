/**
 * bruiser = 기체 타입 1, 맞으며 전진 (ADR-0019 · ADR-0049).
 *
 * 정체성: **근접 최고 단일피해 · 최고 flat HP · 느림. 피격이 자원이다**. 시그니처 장갑
 * 스택(피격 시 적립, 상한 8, 스택당 250bp 감소, 비피격 180틱마다 1스택 소멸)을 "쌓고 ·
 * 태우고 · 붙잡고 · 넘치게 하는" 서른 가지 비틀기가 이 기체의 축이다. 설계 정본은
 * `.omc/plans/skill-rebuild-2026-08-05/bruiser.md`(확정 후보 3판) — 레벨 공식·구현
 * 태그·침공 판정은 전부 거기 있고, 이 파일은 **와이어 레이아웃과 표시 문구**만 담는다.
 *
 * ## 축 대응
 * 설계서의 BL(칼날/blade)·MO(변형/morph)·FO(강화/fortify) 는 현재 파일의 축 slug
 * blade·morph·fortify 에 **그대로(1:1, 재배치 없음)** 대응한다.
 *
 * ## 축 순서를 바꾸지 않는다
 * `[blade(offense), morph(utility), fortify(defense)]` — 구 트리 순서 그대로다. 액티브
 * 레지스트리(`data/ships/actives/bruiser.ts`)가 `treeIndex` 로 축을 가리키고 i18n 키가
 * 축 slug 를 쓰므로, 순서를 바꾸면 스킬 재편과 무관한 배선이 함께 밀린다.
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 1` — SHIP_TYPES 인덱스 = 세이브 wire 값
 *   - `signatureBit = 18` — `src/sim/shipSignature.ts` 의 `SIG_BRUISER_ARMOR` 가 정본,
 *     `tests/shipSignatureRegistry.test.ts` 가 두 값을 마주 세운다. 시그니처 자체는 이미
 *     라이브라 이 재편으로 마이그레이션되지 않는다(설계서 ⑥-1).
 *   - `baseBp`(dmg +8% · 연사 −6% · HP +25% · 이동 −5%) — 값 불변, 밸런스 일괄 레인 소관
 *     (`defer-balance-tuning`).
 */

import { ACTIVE_HI_GATE_DEFAULT, buildShipAxis } from './types.js';
import type { ShipTypeDef, SkillSpec } from './types.js';

const SLUG = 'bruiser';

/** 칼날 — 장갑 스택(만재·피격)을 단발 피해와 관통으로 환산하는 축. */
const BLADE: readonly SkillSpec[] = [
  ['BL1', 'retort-volley', '응전 사출', '실제로 HP 가 깎인 피격 틱에 조준 방향으로 반격 볼리를 자동 발사한다'],
  ['BL2', 'point-blank-doctrine', '백병 격발', '자동 조준 표적과의 거리가 근접 임계 이내일 때 발사되는 볼리가 관통과 피해 증폭을 얻는다'],
  ['BL3', 'full-plate-slug', '만재 중탄', '장갑 스택이 만재일 때 발사되는 탄이 명중 지점에 소형 폭발을 남긴다'],
  ['BL4', 'overflow-vent', '과적 배출', '만재 상태에서 실피격당하면 전방 부채꼴로 파편이 배출된다'],
  ['BL5', 'ram-cleave', '충각 절단', '기동 액티브 돌진 경로상의 적이 절단 피해를 받는다'],
  ['BL6', 'mass-slug', '중량 탄자', '탄속이 느려지는 대신 명중한 적을 밀어내고 피해가 강화된 무거운 탄을 쏜다'],
  ['BL7', 'wall-breaker', '파성퇴', '볼리가 파괴가능 벽을 일격 파괴하고 그 자리에서 전방 충격파를 낸다'],
  ['BL8', 'impact-temper', '격돌 담금질', '몸통 접촉으로 실피격당할 때마다 담금질 탄이 적립되고 다음 볼리가 이를 소모해 대구경화된다'],
  ['BL9', 'crush-cadence', '중압 리듬', '일정 명중마다 확정 강타가 터지며 그 주기는 장갑 스택이 많을수록 짧아진다'],
  ['BL10', 'burn-off-heat', '소각 여열', '칼날 액티브가 스택을 소각할 때 소각한 스택 1개당 주무기 쿨다운을 환급한다'],
];

/** 변형 — 대시·젬·벽을 장갑 적립·유지 자원으로 얽는 축. */
const MORPH: readonly SkillSpec[] = [
  ['MO1', 'dash-loading', '충각 적재', '일반 대시 발동 시 장갑 스택이 적립되고 감쇠 타이머가 리셋되며 이속이 잠시 증가한다'],
  ['MO2', 'wreck-harvest', '파쇄 수확', '근접 임계 이내에서 처치한 적이 떨군 젬을 자석 반경과 무관하게 즉시 견인한다'],
  ['MO3', 'heavy-momentum', '둔중 관성', '같은 방향으로 이동을 지속하면 이속이 점증하고 방향 급전환·정지 시 리셋된다'],
  ['MO4', 'armor-skid', '장갑 활주', '이동 감속 디버프가 걸리는 틱에 장갑 스택 1개를 소모해 그 감속을 무효화한다'],
  ['MO5', 'haul-blink', '견인 돌진', '기동 액티브 돌진 경로 안의 젬·픽업을 도착 지점까지 끌고 온다'],
  ['MO6', 'crush-field', '압쇄장', '장갑 스택이 1개 이상인 동안 근접 반경 내 적을 주기적으로 압쇄한다'],
  ['MO7', 'debris-reclaim', '잔해 회수', '파괴가능 벽·destructible 이 부서질 때 대시 쿨다운이 환급되고 자원이 소량 적립된다'],
  ['MO8', 'wall-rebound', '벽 되튐', '직전 틱에 벽 슬라이드가 일어난 상태에서 대시를 발동하면 쿨다운 일부가 즉시 환급된다'],
  ['MO9', 'harvest-clamp', '수확 고정', '젬을 수거할 때마다 장갑 감쇠 타이머를 되감아 소멸을 지연시킨다'],
  ['MO10', 'arrival-shock', '착탄 충격', '기동 액티브 고티어 도착 틱에 반경 내 적을 밀어내고 적탄을 소거하는 충격파를 남긴다'],
];

/** 강화 — flat 최대HP 와 장갑 파라미터 자체를 키우는 축. 이 기체의 정체성. */
const FORTIFY: readonly SkillSpec[] = [
  ['FO1', 'over-plating', '과적 장갑', '장갑 스택 상한이 확장된다'],
  ['FO2', 'clot-plating', '응혈 장갑', '실피격으로 잃은 HP 의 일부가 응혈 풀에 적립되고 장갑이 만재에 도달하는 순간 전액 회복으로 정산된다'],
  ['FO3', 'recoil-armor', '반동 갑주', '몸통 접촉으로 피격당한 틱에 그 접촉 적에게 반사 피해를 준다'],
  ['FO4', 'unmoved-accretion', '부동 역적립', '정지 중에는 장갑 감쇠 판정의 부호가 반전돼 스택이 소멸하는 대신 적립된다'],
  ['FO5', 'unbreakable-chain', '불괴 연쇄', '치명 피격 무효화 캡스톤이 발동하는 틱에 장갑이 즉시 만재가 되고 주변 적탄이 전량 소거된다'],
  ['FO6', 'load-transfer', '하중 전이', '받는 피해의 일부를 대시 쿨다운 증가로 전이해 그만큼 피해를 경감한다'],
  ['FO7', 'trophy-refit', '전리 개장', '엘리트·보스를 격파하면 그 시점 장갑 스택에 비례해 최대 HP 가 런 내 영구 증가하고 장갑이 만재가 된다'],
  ['FO8', 'molt-regen', '탈피 재생', '장갑 스택이 감쇠로 소멸하는 틱마다 소멸한 스택이 회복으로 전환된다'],
  ['FO9', 'last-stand-instinct', '사투 본능', 'HP 가 30% 이하인 동안 장갑 감쇠가 멈추고 피격당 적립이 늘며 스택당 감소량이 강화된다'],
  ['FO10', 'burst-cremation', '파열 소각장', '강화 액티브 고티어의 만료 폭발이 적탄을 소거하고 맞은 적에게 화상을 부여한다'],
];

export const BRUISER: ShipTypeDef = {
  id: 1,
  slug: SLUG,
  trees: [
    buildShipAxis(SLUG, 'blade', 'offense', BLADE),
    buildShipAxis(SLUG, 'morph', 'utility', MORPH),
    buildShipAxis(SLUG, 'fortify', 'defense', FORTIFY),
  ],
  activeHiGate: ACTIVE_HI_GATE_DEFAULT,
  signatureBit: 18,
  baseBp: { damageBp: 800, fireRateBp: -600, maxHpBp: 2500, moveSpeedBp: -500 },
};
