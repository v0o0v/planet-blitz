/**
 * hatchling = 기체 타입 4, 부화 소환 (ADR-0019 · ADR-0049). 설계 정본은
 * `.omc/plans/skill-rebuild-2026-08-05/hatchling.md`(확정 3판) — 레벨 공식·침공 판정·구현
 * 태그는 전부 거기 있고, 이 파일은 **와이어 레이아웃과 표시 문구**만 담는다.
 *
 * ## 컨셉
 * 알 모양 모선이 병아리 드론을 부화시켜 내보낸다 — 처치를 적립해 임계에 닿으면 동료가
 * 자동 출격한다(시그니처, 변경 없음). 얕고 넓은 무리: 최고 연사·최고 경험치 획득, 대신
 * 단발 피해는 로스터 최저.
 * (구 slug `bion`(곤충·생체 컨셉)에서 개명. `id = 4` 와 `signatureBit = 21` 은
 * **세이브·리플레이 wire 계약이라 그대로 유지**한다.)
 *
 * ## 축 대응표 (설계서 → 이 파일)
 * 설계서 축 이니셜 BD(brood/offense) · NU(nurture/utility) · SH(shelter/defense) 는 이 파일의
 * `brood`/`nurture`/`shelter` 축과 이름·순서·affinity 가 그대로 1:1이다(구 파일부터 유지된
 * 순서 — 액티브 `treeIndex`·i18n 키가 걸려 있어 바꾸지 않는다).
 *
 * ## 25노드·capstoneGate=44 예외는 걷는다
 * 구 버전은 트리당 25노드(78 = 3×26)·`capstoneGate = 44` 로 **해츨링만** 다른 규격이었다.
 * 근거는 "해츨링 트리가 더 크다"였는데, ADR-0049 가 축당 10스킬로 전 기체를 통일하면서 그
 * 용량 차이 자체가 사라졌다 — 그래서 두 예외 모두 걷고 `ACTIVE_HI_GATE_DEFAULT`(40)를 쓴다.
 * (근거 소실이지 밸런스 판단이 아니다 — 수치 재조정은 `defer-balance-tuning` 소관.)
 */

import { ACTIVE_HI_GATE_DEFAULT, buildShipAxis } from './types.js';
import type { ShipTypeDef, SkillSpec } from './types.js';

const SLUG = 'hatchling';

/** 부화 — 병아리 무리의 연사·출격 리듬을 직접 만지는 축. 단발 피해는 로스터 최저. */
const BROOD: readonly SkillSpec[] = [
  ['BD1', 'early-hatch', '조기 부화', '부화 요구 처치 수가 줄어 같은 처치량으로 더 자주 부화한다'],
  ['BD2', 'twin-hatch', '쌍둥이 부화', 'N번째 출격마다 병아리 2기가 동시에 출격한다'],
  ['BD3', 'farewell-volley', '작별 격발', '병아리가 소멸하는 순간 그 자리에서 부채꼴 작별 사격을 남긴다'],
  ['BD4', 'target-share', '표적 공유', '병아리가 플레이어의 자동 조준 표적을 우선 공격하고, 명중 직후 한동안 그 표적에 대한 병아리 탄 피해가 증폭된다'],
  ['BD5', 'volley-resonance', '격발 공명', '플레이어가 주무기를 발사할 때마다 살아 있는 병아리 전원의 발사 쿨다운이 함께 깎인다'],
  ['BD6', 'hatch-shockwave', '부화 충격파', '출격 지점에서 충격파가 터져 광역 피해를 주고 적탄을 소거한다'],
  ['BD7', 'veteran-chick', '노병 병아리', '발사를 거듭할수록 그 병아리 개체의 탄이 점점 강해진다'],
  ['BD8', 'brood-assault', '브루드 강습', 'brood 액티브 발동 시 살아 있는 병아리 전원이 쿨다운을 무시하고 즉시 일제 사격한다'],
  ['BD9', 'overcrowd-instinct', '과밀 본능', '상한이 만석이라 출격이 보류 중인 동안 병아리 전원의 발사 간격이 짧아진다'],
  ['BD10', 'matriarch-launch', '여왕 사출', '동시 출격 상한이 줄어드는 대신 그 결손만큼 출격하는 병아리의 탄 피해와 수명이 강화된다'],
];

/** 양육 — 경험치·수집·재배치를 얽는 축. 무리의 성장 속도가 이 기체의 정체성. */
const NURTURE: readonly SkillSpec[] = [
  ['NU1', 'gem-fetch', '모이 물어오기', '병아리 주변에도 자석장이 서서 근처 젬을 플레이어에게 끌어온다'],
  ['NU2', 'eggshell-nutrients', '알껍질 영양', '출격하는 순간 깨진 알껍질이 소형 경험치 젬으로 흩어진다'],
  ['NU3', 'piggyback', '업어 나르기', '대시 경로 위의 병아리를 업어서 대시 도착 지점 주위로 함께 옮긴다'],
  ['NU4', 'nest-recall', '둥지 소집', 'nurture 액티브 발동 시 살아 있는 병아리 전원이 도착 지점 주위로 재배치되고 잠깐 연사 창을 얻는다'],
  ['NU5', 'egg-roll', '알 굴리기', '대시할 때마다 부화 적립이 1 전진하고 대시 경로 위의 젬을 즉시 수거한다'],
  ['NU6', 'shared-warmth', '온기 나눔', '콤보가 유지되는 동안 병아리의 수명 감소 속도가 절반으로 줄어든다'],
  ['NU7', 'expedition-hatch', '원정 부화', '병아리가 플레이어 곁이 아니라 가장 가까운 젬의 위치에서 부화한다'],
  ['NU8', 'migration-instinct', '이주 본능', '병아리가 정지형에서 추종형으로 바뀌어 플레이어와 멀어지면 걸어서 따라온다'],
  ['NU9', 'nest-beacon', '둥지 표식', '병아리가 소멸한 자리에 자석 버프를 내는 표식이 남는다'],
  ['NU10', 'egg-bank', '알 저금', '만석 보류 중 초과 적립된 처치가 저금되어, 자리가 나면 다음 부화 요구치에 선납된다'],
];

/** 둥지 — 무리를 방어 자원(희생·필터·엄폐)으로 소모하는 축. */
const SHELTER: readonly SkillSpec[] = [
  ['SH1', 'escort-sacrifice', '호위 희생', 'HP 가 깎이는 피격이 들어오면 병아리 1기가 대신 소멸하며 피해 일부를 흡수한다'],
  ['SH2', 'crisis-scatter', '위기 산개', 'HP 가 깎이는 피격을 받으면 병아리 전원이 피격 방향으로 산개 돌진하며 경로 위 적탄을 소거한다'],
  ['SH3', 'full-nest-warmth', '만석 둥지 온기', '동시 출격 상한이 만석인 동안 주기적으로 HP 를 회복한다'],
  ['SH4', 'brooding-formation', '품기 진형', 'shelter 액티브 지속 중 병아리 전원이 사격을 멈추고 플레이어 주위에 밀착해 적탄을 몸으로 막는다'],
  ['SH5', 'alarm-chirp', '경계 지저귐', '병아리의 탄이 적에게 명중하면 그 적에게 냉기 감속을 건다'],
  ['SH6', 'egg-membrane', '알막', '출격하는 순간 모선이 짧은 무적 시간을 얻는다'],
  ['SH7', 'rebirth-hatch', '회생 부화', '치명적인 피격이 남으면 살아 있는 병아리 전원을 소멸시켜 그 수에 비례해 HP 를 남기고 생존한다'],
  ['SH8', 'feather-bulwark', '탄받이 깃털', '적탄이 병아리에 닿으면 소거되는 대신 그 병아리의 수명이 깎인다'],
  ['SH9', 'fledge-nest', '이소 둥지', '수명이 자연히 다한 병아리는 그 자리에 파괴 가능한 낮은 HP 둥지벽을 남긴다'],
  ['SH10', 'expanded-nest', '확장 둥지', '동시 출격 상한이 늘어나는 대신 부화에 필요한 처치 수가 늘어난다'],
];

export const HATCHLING: ShipTypeDef = {
  id: 4,
  slug: SLUG,
  trees: [
    buildShipAxis(SLUG, 'brood', 'offense', BROOD),
    buildShipAxis(SLUG, 'nurture', 'utility', NURTURE),
    buildShipAxis(SLUG, 'shelter', 'defense', SHELTER),
  ],
  activeHiGate: ACTIVE_HI_GATE_DEFAULT,
  signatureBit: 21,
  baseBp: { damageBp: -500, fireRateBp: 500, maxHpBp: 1000, moveSpeedBp: 0 },
};
