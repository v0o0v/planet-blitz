/**
 * phantom = 기체 타입 3, 은신 암살 (ADR-0019 · ADR-0049).
 *
 * 정체성: **한방·회피형 유리 대포. "맞지 않아야 강해진다."** 최고 단발 피해 + 최고 이동/대시,
 * 대신 flat 최대HP 총량이 가장 작고 탄수·사거리가 거의 없다(붙어서 한 방). 방어 트리(disrupt)도
 * 장갑이 아니라 회피(`dashCdPct`·`moveSpeedPct`·비율 HP)로 짜여 있어, 같은 defense affinity
 * 라도 브루저의 fortify 와 완전히 다른 스탯을 낸다. `baseBp`(dmg +15% · 연사 0 · HP −20% ·
 * 이동 +8%)가 같은 축을 굳힌다. 설계 정본은 `.omc/plans/skill-rebuild-2026-08-05/phantom.md`
 * (승인본 4판) — 30스킬 전부 시그니처 은신 상태 기계(무피격 스트릭·해제 배율 토큰)의 위상에
 * 얽혀 있고, 레벨 공식·침공 판정·구현 태그는 전부 거기 있다. 이 파일은 **와이어 레이아웃과
 * 표시 문구**만 담는다.
 *
 * ## 축 대응 (설계서 → 이 파일)
 * 설계서 「암살(assassin/offense)」→ `assassin`(offense) · 「위상(phase/utility)」→
 * `phase`(utility) · 「교란(disrupt/defense)」→ `disrupt`(defense). 이름·순서 모두 그대로라
 * 재매핑 없음.
 *
 * ## 확정 계약 (재번호·재배치 금지)
 *   - `id = 3` · `signatureBit = 20`(`src/sim/shipSignature.ts` 의 `SIG_PHANTOM_CLOAK` 이 정본)
 *   - 시그니처 패시브: 무피격 240틱 시 은신(적 조준 제외) + 해제 첫 타 배율(설계서 §1)
 *
 * ## 축 순서를 바꾸지 않는다
 * 액티브 레지스트리(`data/ships/actives/phantom.ts`)가 `treeIndex` 로 축을 가리키고 i18n 키가
 * 축 slug 를 쓰므로, 순서를 바꾸면 스킬 재편과 무관한 배선이 함께 밀린다.
 *
 * ⚠️ 출시 순서: 설계서는 팬텀을 후순위로 뒀다(은신이 적 조준 대상군을 바꿔 `src/sim/world.ts`
 * 를 넓게 건드린다). 이 파일의 트리 데이터는 시그니처 배선과 독립이므로 먼저 확정해 둬도
 * 안전하지만, **패시브 배선(설계서 §1 헬퍼 4종)이 끝나기 전까지 팬텀은 "그냥 물몸 고화력"**이다.
 */

import { ACTIVE_HI_GATE_DEFAULT, buildShipAxis } from './types.js';
import type { ShipTypeDef, SkillSpec } from './types.js';

const SLUG = 'phantom';

/** 암살 — 해제 첫 타 배율과 처치를 축으로 굴리는 단발 극단 축. */
const ASSASSIN: readonly SkillSpec[] = [
  ['AS1', 'twin-mark', '이중 각인', '은신 해제 첫 타 강화가 한 발 더 이어진다'],
  ['AS2', 'cloak-pierce', '은막 침투', '은신 창 동안 발사한 탄이 관통과 탄속 증가를 받는다'],
  ['AS3', 'execution-reload', '처형 재장전', '은신 해제 첫 타로 처치하면 강화 배율이 그 자리에서 재장전된다'],
  ['AS4', 'vital-dissection', '급소 해부', '만피 상태 적에게 명중하는 첫 타가 추가 피해를 입힌다'],
  ['AS5', 'backstab', '배후 격살', '적의 등 뒤에서 명중하면 피해가 증폭된다'],
  ['AS6', 'silent-kill', '무성 격살', '은신 창 동안 처치한 적은 사망 잔재(폭발·분열)를 남기지 않는다'],
  ['AS7', 'grudge-settlement', '원한 청산', '마지막으로 나를 공격한 적이 원한 표적이 되어 그에게 주는 피해가 증폭된다'],
  ['AS8', 'executioner-tally', '처형인의 적공', '처치가 스택으로 쌓여 다음 은신 해제 첫 타 배율에 가산된다'],
  ['AS9', 'annihilation-verdict', '절멸 선고', '은신 해제 첫 타가 명중 지점에서 폭발을 일으킨다'],
  ['AS10', 'ghost-trajectory', '유령 탄도', '은신 창 동안 발사한 탄이 벽을 통과한다(파괴가능 벽은 피해를 주고 통과한다)'],
];

/** 위상 — 은신 사이클 자체(진입·유지·가속)를 직접 조작하는 기동 극단 축. */
const PHASE: readonly SkillSpec[] = [
  ['PH1', 'afterimage-exit', '잔상 이탈', '대시를 발동하면 무피격 스트릭이 전진해 은신 진입이 앞당겨진다'],
  ['PH2', 'phase-landing', '위상 착지', '위상 액티브 착지 지점 주변 적탄을 소거하고 냉기를 건다'],
  ['PH3', 'shadow-ledger', '그림자 장부', '은신 창 동안 콤보 유지 시간이 감소하지 않는다'],
  ['PH4', 'traceless-stride', '무흔 보행', '은신 창 동안 이동 속도가 오르고 이동 감속에 면역이 된다'],
  ['PH5', 'extended-phase', '연장 위상', '은신 유지 시간이 길어진다'],
  ['PH6', 'frozen-clock', '정지된 시계', '은신 창 중 대시하면 예산 한도 안에서 사이클 시계가 멈춘다'],
  ['PH7', 'entry-flash', '진입 섬광', '은신에 진입하는 순간 그 자리에서 폭발과 적탄 소거가 터진다'],
  ['PH8', 'trace-siphon', '흔적 흡수', '젬을 수거할 때마다 무피격 스트릭이 전진해 은신 진입이 앞당겨진다'],
  ['PH9', 'echo-stalk', '메아리 잠행', '에코 안정화를 완수하면 즉시 은신에 진입하고, 조우 활성 동안 대시 쿨다운이 감소한다'],
  ['PH10', 'blown-cover-reflex', '발각 즉응', '은신이 피격으로 깨지는 순간 대시 쿨다운을 전액 환급하고 무적프레임을 더한다'],
];

/** 교란 — 장갑이 아니라 회피와 은신 상태 그 자체로 버티는 방어 축. */
const DISRUPT: readonly SkillSpec[] = [
  ['DI1', 'phase-liquidation', '위상 정산', '피격으로 무피격 스트릭이 리셋될 때 잃은 스트릭에 비례한 반경으로 적탄을 소거한다'],
  ['DI2', 'cloaked-mending', '은둔 재생', '은신 창 동안 일정 주기마다 HP 를 회복한다'],
  ['DI3', 'first-hit-attenuation', '초탄 감쇄', '받는 피해가 현재 무피격 스트릭에 비례해 감소한다'],
  ['DI4', 'repulse-phase', '반발 위상', '피격당하면 주변 적을 밀어낸다'],
  ['DI5', 'last-phase', '최후 위상', 'HP 가 위험 임계 아래로 떨어지는 피격 순간 즉시 은신에 진입한다'],
  ['DI6', 'cover-stalk', '차폐 잠행', '직전 틱에 벽에 접촉했으면 무피격 스트릭 적립이 가속된다'],
  ['DI7', 'vanishing-chill', '소실 냉파', '은신에 진입하는 순간 주변 적 전원에게 냉기를 건다'],
  ['DI8', 'phase-sediment', '위상 침전', '은신에 진입할 때마다 최대 HP 가 런 내내 영구히 증가한다'],
  ['DI9', 'ghost-hull', '유령 선체', '피격 무적 동안 선체가 벽을 통과한다'],
  ['DI10', 'void-covenant', '공허 계약', '최대 HP 를 추가로 깎는 대신 은신 해제 첫 타 배율이 영구히 가산된다'],
];

export const PHANTOM: ShipTypeDef = {
  id: 3,
  slug: SLUG,
  trees: [
    buildShipAxis(SLUG, 'assassin', 'offense', ASSASSIN),
    buildShipAxis(SLUG, 'phase', 'utility', PHASE),
    buildShipAxis(SLUG, 'disrupt', 'defense', DISRUPT),
  ],
  activeHiGate: ACTIVE_HI_GATE_DEFAULT,
  signatureBit: 20,
  baseBp: { damageBp: 1500, fireRateBp: 0, maxHpBp: -2000, moveSpeedBp: 800 },
};
