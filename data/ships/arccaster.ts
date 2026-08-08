/**
 * arccaster = 기체 타입 2, 정지 포격 (ADR-0019 · ADR-0049).
 *
 * 정체성: 자리를 잡고 쏘는 포대. **최고 사거리 + 최고 탄수 + 최고 탄속**, 대신 이동·연사가
 * 얕고 방어는 flat 이 아니라 방벽(비율) 축이라 기본 HP 가 낮은 이 기체에서는 절대량이 작다.
 * `baseBp`(dmg +12% · 연사 −10% · HP **−4%** · 이동 −12%)가 "느리지만 멀리서 두껍게" 를 굳힌다.
 * (HP 축만 2026-08-08 에 −10% → −4% 로 조정 — 파일 말미 `baseBp` 주석 참조.)
 * 시그니처 패시브(과충전, 비트 19)는 정지를 지속하면 피해가 증폭되는 정체성의 핵심이며
 * ADR-0049 로 바뀌지 않는다.
 *
 * 설계 정본은 `.omc/plans/skill-rebuild-2026-08-05/arccaster.md` — 레벨 공식·구현 태그·
 * 침공 판정은 전부 거기 있고, 이 파일은 **와이어 레이아웃과 표시 문구만** 담는다.
 *
 * ## 축 대응 (설계서 → 이 파일)
 *   chain(offense) = 설계서 「연쇄」 CH1..CH10 · barrage(utility) = 설계서 「탄막」 BA1..BA10 ·
 *   barrier(defense) = 설계서 「방벽」 BR1..BR10. 접두 문자와 파일 축 이름이 1:1 이라 재배치
 *   없이 그대로 옮겼다.
 *
 * ## 축 순서를 바꾸지 않는다
 * `[chain(offense), barrage(utility), barrier(defense)]` — 구 레이아웃의 트리 순서 그대로다.
 * 액티브 레지스트리(`data/ships/actives/arccaster.ts`)가 `treeIndex` 로 축을 가리키므로
 * 순서를 바꾸면 스킬 재편과 무관한 배선이 함께 밀린다.
 */

import { ACTIVE_HI_GATE_DEFAULT, buildShipAxis } from './types.js';
import type { ShipTypeDef, SkillSpec } from './types.js';

const SLUG = 'arccaster';

/** 연쇄 — 과충전 발사·전격 연쇄를 직접 만지는 축. */
const CHAIN: readonly SkillSpec[] = [
  ['CH1', 'guided-arc', '유도 낙뢰', '과충전 중 발사한 탄이 명중하면 전격 연쇄가 터진다'],
  ['CH2', 'relay-circuit', '연쇄 확장 회로', '모든 출처의 전격 연쇄가 도약 반경과 도약 대상 수를 더 얻는다'],
  ['CH3', 'endpoint-burst', '종말점 방전', '과충전 중 발사한 탄이 사거리를 다해 소멸하면 그 지점에서 방전 폭발을 남긴다'],
  ['CH4', 'entry-lance', '진입 뇌격', '과충전에 진입하는 순간 조준 방향으로 고관통 방전탄을 자동 사출한다'],
  ['CH5', 'potential-snipe', '전위차 저격', '멀리 비행한 뒤 명중한 탄은 피해가 증폭되고 관통이 늘어난다'],
  ['CH6', 'overkill-carry', '과잉 전하 이월', '탄이 적을 처치하고 남은 초과 피해가 탄에 실려 다음 대상에게 전달된다'],
  ['CH7', 'residual-discharge', '잔류 방전', '방전 액티브가 충전을 비운 뒤 소모한 정지 시간에 비례해 최근접 적에게 여진탄이 자동 발사된다'],
  ['CH8', 'grounded-pierce', '접지 관통로', '과충전 중 발사한 탄은 관통을 소모할 때마다 피해가 증폭된다'],
  ['CH9', 'bolt-salvage', '낙뢰 인양', '과충전 중 처치한 엘리트의 전리품 희귀도에 상향 배율이 실린다'],
  ['CH10', 'primed-strike', '주입 전격', '방전 액티브의 투사체가 명중하면 전격 연쇄를 부여한다'],
];

/** 탄막 — 액티브 연동·탄수·정지 경제를 얽는 축. 이 기체의 정체성. */
const BARRAGE: readonly SkillSpec[] = [
  ['BA1', 'redeploy-salvo', '재배치 일제사', '점멸 액티브가 착지하는 순간 전방위 원형 볼리를 자동 발사한다'],
  ['BA2', 'still-magnet', '정지 흡인장', '정지 중 자석 반경이 정지 시간에 비례해 커진다'],
  ['BA3', 'still-spotter', '정지 관측 사격', '정지 중에 수거한 젬만 주무기 발사 쿨다운을 환급한다'],
  ['BA4', 'sweep-lane', '소거 항로', '점멸 이동 경로 위의 젬·전리품을 즉시 수거한다'],
  ['BA5', 'static-combo', '정전 콤보 감속', '과충전 중에는 콤보 유지 시계가 절반 속도로 줄어든다'],
  ['BA6', 'echo-mount', '분신 포좌', '장거리 점멸이 출발한 자리에 임시 자동 포탑을 남긴다'],
  ['BA7', 'kill-capacitor', '연발 축전기', '적을 일정 수 처치할 때마다 다음 볼리의 탄수가 늘어난다'],
  ['BA8', 'insulated-mount', '절연 포좌', '감속 장판 위에서 정지하면 과충전 적립이 2배가 되고 용암 피해가 경감된다'],
  ['BA9', 'march-fire', '이동 포격 술식', '이동해도 과충전 게이지가 즉시 리셋되지 않고 서서히 감쇠한다'],
  ['BA10', 'salvo-doctrine', '일제 사격 통제', '발사 간격과 볼리 탄수가 함께 2배가 되어 같은 화력을 굵고 느린 일제사로 재포장한다'],
];

/** 방벽 — 정지·피격을 방어와 회복으로 바꾸는 축(비율 방벽, flat 이 아니다). */
const BARRIER: readonly SkillSpec[] = [
  ['BR1', 'static-repulsor', '정전 척력장', '과충전 중 주기적으로 척력 펄스가 터져 주변 적을 밀어낸다'],
  ['BR2', 'lightning-rod', '피뢰 접지', 'HP 가 깎이는 피격을 받으면 주변으로 전격 연쇄 반격이 터진다'],
  ['BR3', 'phase-coupling', '위상 결합 방벽', '방벽 액티브 지속 중 받는 피해가 줄어든다'],
  ['BR4', 'surplus-shield', '잉여 전하 방벽', '과충전 상한을 넘긴 구간의 정지 시간이 피해 흡수량으로 적립된다'],
  ['BR5', 'ground-tether', '접지 케이블', '벽에 접촉한 채 정지 중이면 받는 피해가 줄어든다'],
  ['BR6', 'charge-backflow', '전하 역류', '빈사 상태로 피격되면 쌓인 과충전을 전량 소각해 즉시 HP 를 회복한다'],
  ['BR7', 'buffer-condenser', '완충 콘덴서', '피격으로 깎인 피해량이 과충전 게이지로 전환된다'],
  ['BR8', 'still-repair', '정지 수복 회로', '과충전을 유지하는 동안 일정 주기로 HP 가 회복된다'],
  ['BR9', 'repulse-hull', '척력 외피', '무적 상태인 동안 몸 주변의 적탄이 소거된다'],
  ['BR10', 'terminal-ground', '최후 접지', '치명 무효화가 발동하는 순간 과충전 게이지를 상한까지 채우고 무적을 연장한다'],
];

export const ARCCASTER: ShipTypeDef = {
  id: 2,
  slug: SLUG,
  trees: [
    buildShipAxis(SLUG, 'chain', 'offense', CHAIN),
    buildShipAxis(SLUG, 'barrage', 'utility', BARRAGE),
    buildShipAxis(SLUG, 'barrier', 'defense', BARRIER),
  ],
  activeHiGate: ACTIVE_HI_GATE_DEFAULT,
  signatureBit: 19,
  // maxHpBp −1000 → −400: 아래 §maxHpBp 참조.
  baseBp: { damageBp: 1200, fireRateBp: -1000, maxHpBp: -400, moveSpeedBp: -1200 },
};

/**
 * ## §maxHpBp — −1000(−10%) → −400(−4%) (2026-08-08 출시 전 밸런스 · 기준 2)
 *
 * 무장비 명목표(`bench/nominalPower.ts --gear=none`)의 곱(DPS×EHP) 스프레드가 **1.473** 로
 * 합격 밴드(1.35)를 넘었고, 그 양 끝이 **브루저 1.355(최대) ↔ 아크캐스터 0.920(최소)** 였다.
 *
 * ## 왜 이 둘만 건드리는가
 * `--sens` 감도 스윕에서 중간 4종(hatchling·mallow·phantom·bubble)은 가정치 변형에 순위가
 * 서로 뒤집혔다 — **모델 해상도 안에서 구분 불가**이고, 그것을 미세 조정하는 것은 잡음을 쫓는
 * 것이다. 반면 **브루저 1위·아크캐스터 꼴찌는 전 스윕에서 고정**이었다. 밴드 밖으로 나간
 * 그 둘만 움직인다.
 *
 * ## 왜 HP 축인가
 * 공격 축을 만지면 시그니처 배율과 곱해져 효과가 증폭되고, 이 기체의 정체성(느리지만 멀리서 두껍게)은 **공격·기동 축**에 실려 있다 —
 * dmg +12% · 연사 −10% · 이동 −12% 는 전부 그대로 두었다. HP −10% 는 그 정체성의 대가라기보다
 * 단순 약점이었고, 실제로 이 기체를 밴드 밖으로 밀어낸 항이 그것이다.
 * HP 는 플랫 가산이라 조정폭이 예측 가능하다.
 *
 * 결과: 스프레드 **1.473 → 1.323 (PASS)**. 다른 다섯 기체의 RATIO 는 한 톨도 안 움직였다.
 * ⚠️ 방향성 단언(브루저가 피해를 덜 받는다 등)은 시그니처 축이라 이 조정과 무관하다.
 */
