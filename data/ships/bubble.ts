/**
 * bubble = 기체 타입 6, 거품 방막 (로스터 7종 확장, 2026-07-21 사용자 지시 · ADR-0049 재편).
 *
 * 정체성: **탄속 1위 + 자석 1위**. 주기적으로 일정 피해를 흡수하는 막이 생기고, 막이 터질
 * 때 주변을 밀어낸다. 막이 실질 체력을 대신하므로 선체 자체는 얇고(`baseBp` HP −14%), 대신
 * 탄이 빠르고 관통이 잘 되며(터지는 압력) 젬을 멀리서 끌어온다(떠다니는 거품). 브루저·
 * 말로우가 "맞아도 버틴다" 라면 버블은 **주기마다 한 번씩 안 맞는다** — 같은 defense
 * affinity 를 두고도 축이 다르다. 시그니처 상수·순수 함수는 `src/sim/shipSignature.ts` 의
 * `SIG_BUBBLE_FILM`(비트 23) 구역이 정본이고, 30스킬 설계 정본은
 * `.omc/plans/skill-rebuild-2026-08-05/bubble.md`(승인본 4판) — 레벨 공식·침공 판정·구현
 * 태그는 전부 거기 있고, 이 파일은 **와이어 레이아웃과 표시 문구**만 담는다.
 *
 * ## 설계서 축 ↔ 코드 축 slug 대응
 * 설계서 「파열(pop/offense)」→ `pop`(offense) · 「표류(drift/utility)」→ `drift`(utility) ·
 * 「피막(film/defense)」→ `film`(defense). 이름·순서 전부 설계서와 코드가 이미 일치한다.
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 6` — SHIP_TYPES 인덱스 = 세이브 wire 값. append-only
 *   - `signatureBit = 23`(`src/sim/shipSignature.ts` 의 `SIG_BUBBLE_FILM` 이 정본,
 *     `tests/shipSignatureRegistry.test.ts` 가 두 값을 마주 세운다)
 *   - 축 순서: `[pop(offense), drift(utility), film(defense)]` — 액티브 레지스트리
 *     (`data/ships/actives/bubble.ts`)가 `treeIndex` 로 축을 가리키고 i18n 키가 축 slug 를
 *     쓰므로, 순서를 바꾸면 스킬 재편과 무관한 배선이 함께 밀린다.
 */

import { ACTIVE_HI_GATE_DEFAULT, buildShipAxis } from './types.js';
import type { ShipTypeDef, SkillSpec } from './types.js';

const SLUG = 'bubble';

/** 파열 — 터지는 압력(탄속·관통)과 파열 훅 화력을 겸하는 축. */
const POP: readonly SkillSpec[] = [
  ['PO1', 'burst-warhead', '파열 탄두', '파열이 밀어내기에 더해 반경 안 적에게 즉발 폭발 피해를 준다'],
  ['PO2', 'pressure-transfer', '압력 전환 사출', '막이 서 있는 동안 기준 탄속 초과분이 발사 시점에 피해로 전환된다'],
  ['PO3', 'burst-scatter', '거품 산탄 파열', '파열 틱에 플레이어 중심 전방위로 거품탄을 사출한다'],
  ['PO4', 'crush-impact', '압착 충돌', '파열에 밀린 적이 벽에 막히면 충돌 피해를 받는다'],
  ['PO5', 'full-film-pierce', '만재 투과', '막이 만재인 동안 발사되는 볼리에 관통과 피해가 추가된다'],
  ['PO6', 'fire-recondense', '격발 재응결', '막이 없는 동안 주무기가 명중할 때마다 재생 타이머가 전진한다'],
  ['PO7', 'static-burst', '정전 파열', '파열 틱에 반경 안 적 최대 3기에게 전격 연쇄를 건다'],
  ['PO8', 'residue-mines', '잔거품 기뢰', '파열 지점 둘레에 정지 거품 기뢰 링을 남긴다'],
  ['PO9', 'pop-tuning', '고압 격발 조율', 'pop 액티브 두 종의 파열 반경과 내구→탄약 환산 효율을 강화한다'],
  ['PO10', 'chain-pressure', '연쇄 압력', '파열 후 짧은 창 안의 처치 수에 비례해 다음 막의 내구가 보강된다'],
];

/** 표류 — 자석 1위와 무막 기동을 잇는 축. */
const DRIFT: readonly SkillSpec[] = [
  ['DR1', 'reverse-current', '역류 수거', '파열 틱에 반경 안 젬을 즉시 수거한다'],
  ['DR2', 'surface-tension-bath', '표면장력 세례', '막이 서 있는 동안 젬을 수거하면 짧은 창 동안 막의 흡수 효율이 오른다'],
  ['DR3', 'blink-magnetize', '도약 자기장', 'drift 액티브 착지 틱에 전용 자석 확장 버프를 얻는다'],
  ['DR4', 'bare-hull-trim', '공막 경량화', '막이 없는 동안 이동 감속에 면역이 되고 이동 속도가 빨라진다'],
  ['DR5', 'prism-resonance', '무지개 공명', '콤보 스택이 자석 반경에 곱해진다'],
  ['DR6', 'burst-propulsion', '파열 추진', '파열 틱에 대시 쿨다운을 환급한다'],
  ['DR7', 'signal-drift', '신호 표류', '에코·조우가 활성인 동안 재생 타이머가 2배로 돌고 안정화 완수 시 막이 즉시 만재된다'],
  ['DR8', 'remote-forager', '원격 채집기', '기믹 픽업 3종의 접촉 반경이 자석 반경에 비례해 확장된다'],
  ['DR9', 'departure-ripple', '이탈 잔파동', 'drift 액티브 출발 지점에 잔파동을 남기고 막이 서 있으면 반경이 강화된다'],
  ['DR10', 'bare-hull-current', '공막 유속', '막이 없는 동안 젬 흡인이 빨라지고 재생이 완료되는 틱에 광역 견인 펄스가 걸린다'],
];

/** 피막 — 막의 흡수·회복·파열 성질을 다듬는 축. */
const FILM: readonly SkillSpec[] = [
  ['FI1', 'early-condense', '조기 응결', '파열 직후 재생 타이머가 선급값에서 시작한다'],
  ['FI2', 'durability-recondense', '내구 재응결', '막이 서 있는 동안 내구가 서서히 회복된다'],
  ['FI3', 'reflective-film', '반사 응막', '막이 피해를 흡수한 틱에 주변 적탄을 소거한다'],
  ['FI4', 'pressure-vent', '압력 배출', '막이 흡수할 때마다 흡수량에 비례한 소형 밀어내기가 일어난다'],
  ['FI5', 'burst-phase', '파열 위상', '파열 틱의 무적 창이 연장된다'],
  ['FI6', 'film-offering', '헌막 의식', '불멸 막 지속 중 흡수한 총량이 만료 파열의 폭발 피해에 가산된다'],
  ['FI7', 'wall-echo', '벽면 반향', '벽에 접촉 중 일어난 파열은 밀어내기 반경과 변위가 강화된다'],
  ['FI8', 'hydrophobic-coat', '발수 코팅', '해저드 피해를 막이 2배 효율로 흡수한다'],
  ['FI9', 'last-bubble', '최후의 거품', '막이 없는데 치명 피격을 받으면 재생 진행분을 소모해 즉석 비상막을 세운다'],
  ['FI10', 'purge-burst', '정화 파열', '파열이 반경 안 적탄을 전부 소거하고 감속 디버프를 해제한다'],
];

export const BUBBLE: ShipTypeDef = {
  id: 6,
  slug: SLUG,
  trees: [
    buildShipAxis(SLUG, 'pop', 'offense', POP),
    buildShipAxis(SLUG, 'drift', 'utility', DRIFT),
    buildShipAxis(SLUG, 'film', 'defense', FILM),
  ],
  activeHiGate: ACTIVE_HI_GATE_DEFAULT,
  signatureBit: 23,
  baseBp: { damageBp: 300, fireRateBp: 700, maxHpBp: -1400, moveSpeedBp: 200 },
};
