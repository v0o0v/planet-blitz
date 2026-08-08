/**
 * 브루저 30스킬 상세 — 수치는 `src/sim/skills/bruiserScaling.ts` 가 낸다.
 *
 * 이 표는 **수치를 담지 않는다.** 어떤 함수를 어떤 라벨로 부를지만 담으므로, 밸런스가 바뀌면
 * 이 파일을 한 줄도 안 고쳐도 화면이 새 값을 말한다. 근거는 `../skillDetail.ts` 머리 참조.
 *
 * ## 이 기체를 설명할 때 반복해서 나오는 말
 * **장갑 스택** — 맞거나 대시할 때 쌓이고 가만두면 하나씩 빠지는 이 기체의 고유 자원이다.
 * 여러 스킬이 "지금 몇 개인가"를 조건이나 배수로 쓴다. **만재** — 장갑 스택이 상한까지 찬
 * 상태다. **근접 임계** — 자동 조준 표적까지의 거리가 이 안이면 "붙어 있다"로 친다.
 */

import {
  ARMOR_MAX_STACKS_BASE,
  POINT_BLANK_RANGE,
  CRUSH_FIELD_PERIOD,
  CLOT_SETTLE_BP,
  TROPHY_RUN_CAP_BP,
  LOAD_TRANSFER_DASH_TICKS,
  retortVolleyDamageBp,
  pointBlankDamageBp,
  fullPlateBlastBp,
  fullPlateBlastRadius,
  overflowVentCount,
  overflowVentDamage,
  ramCleaveWidth,
  ramCleaveDamage,
  massSlugPush,
  massSlugDamageBp,
  wallBreakerCount,
  wallBreakerDamage,
  temperCap,
  temperLeadBonusBp,
  cadencePeriod,
  burnOffRefundQ,
  wreckHarvestRange,
  heavyMomentumMaxBp,
  skidCooldownTicks,
  haulBlinkWidth,
  crushFieldRadius,
  crushFieldDamage,
  debrisReclaimRefund,
  reboundRefundBp,
  harvestClampRewind,
  arrivalShockRadius,
  arrivalShockPush,
  overPlatingBonus,
  clotPlatingBp,
  recoilReflectBp,
  unbreakableChainRadius,
  loadTransferCutBp,
  trophyHpPerStack,
  moltRegenHeal,
  lastStandPerStackBp,
  cremationBurnPerTick,
} from '../../sim/skills/bruiserScaling.js';
import { FIRE_CD_Q } from '../../sim/constants.js';
import { incPct, ofPct, ticks, type SkillDetail } from './format.js';

/** 만재 스택 수는 FO1 투자에 따라 변한다 — 예시 수치는 **기본 상한** 기준으로 적는다. */
const BASE_CAP = ARMOR_MAX_STACKS_BASE;

export const BRUISER_SKILL_DETAIL: Readonly<Record<string, SkillDetail>> = {
  // ── 중장 ────────────────────────────────────────────────────────────────
  'retort-volley': {
    body: '체력이 실제로 깎이는 피격을 받은 순간 조준 방향으로 반격 볼리가 자동으로 나갑니다. 내부 쿨이 있어 연달아 맞아도 매번 나가지는 않습니다.',
    scale: '반격 볼리 피해 = 본래 볼리의 50% + 2%p/Lv',
    values: (lv) => [`반격 볼리 피해 = 본래 볼리의 ${ofPct(retortVolleyDamageBp(lv))}`],
    lv1: '맞는 것이 곧 반격이 됩니다. 붙어서 싸우는 이 기체에 잘 맞습니다.',
    max: '반격이 평소 사격에 가까운 위력이 됩니다.',
  },
  'point-blank-doctrine': {
    body: `자동 조준한 적까지의 거리가 ${POINT_BLANK_RANGE} 이내일 때 쏜 볼리가 관통과 피해 증폭을 얻습니다. 붙어서 쏠수록 강해집니다.`,
    scale: '근접 사격 피해 +8% + 1.5%p/Lv',
    values: (lv) => [
      `근접 사격 피해 ${incPct(pointBlankDamageBp(lv))}`,
      `적용 거리 ${POINT_BLANK_RANGE} 이내`,
    ],
    lv1: '붙어서 쏘는 이 기체의 기본 자세에 보상이 붙습니다.',
    max: '근접 사격 피해가 40% 가까이 오릅니다. 파고드는 플레이가 그대로 화력이 됩니다.',
  },
  'full-plate-slug': {
    body: '장갑 스택이 만재일 때 쏜 탄이 맞은 자리에서 작게 폭발합니다. 장갑을 채워 두는 것이 곧 광역 피해가 됩니다.',
    scale: '폭발 피해 = 그 탄 피해의 25% + 1.5%p/Lv · 폭발 범위 50 + 5×Lv',
    values: (lv) => [
      `폭발 피해 = 그 탄 피해의 ${ofPct(fullPlateBlastBp(lv))}`,
      `폭발 범위 ${fullPlateBlastRadius(lv)}`,
    ],
    lv1: '만재를 유지하면 사격에 광역이 붙습니다.',
    max: '만재 상태의 사격이 통째로 유탄이 됩니다.',
  },
  'overflow-vent': {
    body: '장갑이 만재인 상태에서 체력이 깎이는 피격을 받으면 전방 부채꼴로 파편이 배출됩니다. 만재로 버티다 맞는 순간이 반격이 됩니다.',
    scale: '파편 수 4 + ⌈Lv/3⌉ · 1발 피해 8 + 2×Lv',
    values: (lv) => [
      `파편 ${overflowVentCount(lv)}발`,
      `1발 ${overflowVentDamage(lv)} 피해 · 합계 ${overflowVentCount(lv) * overflowVentDamage(lv)}`,
    ],
    lv1: '만재로 맞으면 앞쪽이 정리됩니다.',
    max: '피격 한 번이 부채꼴 일제사가 됩니다.',
  },
  'ram-cleave': {
    body: '기동 액티브로 돌진할 때 지나간 경로 위의 적이 절단 피해를 받습니다. 이동이 곧 공격이 됩니다.',
    scale: '절단 폭(중심에서 좌우) 60 + 4×Lv · 절단 피해 20 + 6×Lv',
    values: (lv) => [`절단 폭 좌우 ${ramCleaveWidth(lv)}`, `절단 피해 ${ramCleaveDamage(lv)}`],
    lv1: '돌진 경로에 있던 적이 그대로 베입니다.',
    max: '돌진 한 번이 넓은 띠를 통째로 쓸어버립니다.',
  },
  'mass-slug': {
    body: '탄이 느려지는 대신 무거워집니다. 맞은 적이 밀려나고 피해도 강해집니다. 느린 탄속은 그대로 대가로 남습니다.',
    scale: '피해 +20% + 2%p/Lv · 밀려나는 거리 16 + 2×Lv',
    values: (lv) => [
      `탄 피해 ${incPct(massSlugDamageBp(lv))}`,
      `맞은 적이 밀려나는 거리 ${massSlugPush(lv)}`,
    ],
    lv1: '한 발이 무거워지고 적이 밀립니다.',
    max: '탄 하나하나가 적을 밀어내며 60% 더 아프게 때립니다.',
  },
  'wall-breaker': {
    body: '볼리가 부술 수 있는 벽을 한 번에 부수고, 부서진 자리에서 전방으로 충격파가 나갑니다. 엄폐물을 치우는 동작이 공격이 됩니다.',
    scale: '충격파 파편 3 + ⌈Lv/4⌉ · 1발 피해 12 + 4×Lv',
    values: (lv) => [
      `충격파 파편 ${wallBreakerCount(lv)}발`,
      `1발 ${wallBreakerDamage(lv)} 피해`,
    ],
    lv1: '벽을 뚫으면서 그 너머까지 때립니다.',
    max: '벽 하나가 부서질 때마다 8발짜리 충격파가 터집니다.',
  },
  'impact-temper': {
    body: '몸통으로 부딪혀 체력이 깎일 때마다 담금질 탄이 쌓이고, 다음 볼리가 그것을 소모해 선두 탄이 대구경으로 나갑니다. 상한까지만 쌓이고 넘치는 분은 버려집니다.',
    scale: '적립 상한 = 1 + 5×Lv/(Lv+10) · 선두 탄 추가 피해 +60% + 3%p/Lv',
    values: (lv) => [
      `담금질 탄 최대 ${temperCap(lv)}발`,
      `선두 탄 추가 피해 ${incPct(temperLeadBonusBp(lv))}`,
    ],
    lv1: '몸으로 받아 낸 대가가 한 발의 위력으로 돌아옵니다.',
    max: '선두 탄이 두 배가 넘는 피해로 나갑니다.',
  },
  'crush-cadence': {
    body: '일정 횟수를 명중할 때마다 확정 강타가 터집니다. 그 주기는 장갑 스택이 많을수록 짧아집니다 — 레벨이 아니라 장갑이 이 스킬의 손잡이입니다.',
    scale: '강타 주기 = 48/(4 + 장갑 스택) 회 명중마다 (최소 1). 레벨을 올려도 효과가 커지지 않습니다 — 이 스킬의 손잡이는 레벨이 아니라 장갑입니다.',
    values: () => [
      `장갑 0스택: ${cadencePeriod(0)}회 명중마다 강타`,
      `장갑 ${BASE_CAP}스택(기본 만재): ${cadencePeriod(BASE_CAP)}회 명중마다 강타`,
    ],
    lv1: '장갑을 쌓아 두면 강타가 주기적으로 터집니다.',
    max: '더 넣어도 얻는 것이 없습니다. 대신 장갑을 만재로 유지하면 강타가 두 배로 잦아집니다.',
  },
  'burn-off-heat': {
    body: '칼날 액티브가 장갑 스택을 태울 때, 태운 1스택마다 주무기 쿨다운이 환급됩니다. 장갑을 많이 쌓아 둘수록 크게 돌아옵니다.',
    scale: '소각 1스택당 주무기 쿨다운 2 + 0.2×Lv 틱 환급',
    values: (lv) => [
      `1스택당 ${(burnOffRefundQ(lv, FIRE_CD_Q) / FIRE_CD_Q).toFixed(1)}틱 환급`,
      `${BASE_CAP}스택을 태우면 ${((burnOffRefundQ(lv, FIRE_CD_Q) * BASE_CAP) / FIRE_CD_Q).toFixed(1)}틱`,
    ],
    lv1: '액티브를 써도 사격이 끊기지 않습니다.',
    max: '만재를 태우면 사격 36틱분이 통째로 돌아옵니다.',
  },

  // ── 기동 ────────────────────────────────────────────────────────────────
  'dash-loading': {
    body: '평범한 대시를 쓸 때 장갑 스택이 하나 쌓이고, 장갑이 빠지기까지의 시계도 처음으로 되감깁니다. 이동 속도도 잠시 오릅니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 대시 1회에 1스택이 전부이기 때문입니다.',
    values: () => ['대시 1회당 장갑 +1 · 감쇠 시계 초기화 · 이속 일시 상승'],
    lv1: '대시가 곧 장갑 충전 수단이 됩니다. 이 기체의 순환이 여기서 시작합니다.',
    max: '더 넣어도 얻는 것이 없습니다. 1포인트만 넣고 다른 스킬로 넘어가는 편이 낫습니다.',
  },
  'wreck-harvest': {
    body: '붙어서 처치한 적이 떨군 젬을 자석 범위와 상관없이 즉시 끌어옵니다. 파고들어 싸우는 동안 젬을 놓치지 않습니다.',
    scale: `견인 거리 = ${POINT_BLANK_RANGE} + 10×Lv`,
    values: (lv) => [`즉시 견인 거리 ${wreckHarvestRange(lv)}`],
    lv1: '근접 처치의 젬이 알아서 딸려옵니다.',
    max: '견인 거리가 근접 임계보다 훨씬 넓어져 난전 중에도 다 회수합니다.',
  },
  'heavy-momentum': {
    body: '같은 방향으로 계속 이동하면 이동 속도가 점점 오릅니다. 방향을 급히 바꾸거나 멈추면 처음으로 돌아갑니다.',
    scale: '최대 가속 = +10% + 3%p/Lv (같은 방향 유지 120틱에 도달)',
    values: (lv) => [
      `최대 이동 속도 ${incPct(heavyMomentumMaxBp(lv))}`,
      '도달까지 같은 방향 120틱(≈2.0초)',
    ],
    lv1: '길게 달릴수록 조금씩 빨라집니다.',
    max: '직선으로 달리면 이동 속도가 70% 오릅니다. 느린 기체의 약점을 메웁니다.',
  },
  'armor-skid': {
    body: '이동 감속이 걸리는 순간 장갑 스택 하나를 소모해 그 감속을 무효화합니다. 전용 내부 쿨이 있어 연달아 막지는 못합니다.',
    scale: '내부 쿨 = 60 + 2400/(Lv+19) 틱',
    values: (lv) => [
      `무효화 내부 쿨 ${ticks(skidCooldownTicks(lv))}`,
      '1회당 장갑 1스택 소모',
    ],
    lv1: '감속 장판을 밟아도 한 번은 그냥 지나갑니다.',
    max: '쿨이 3분의 1로 줄어 감속이 깔린 구간을 계속 무시하고 지나갑니다.',
  },
  'haul-blink': {
    body: '기동 액티브로 돌진할 때 경로 안의 젬과 픽업을 도착 지점까지 끌고 옵니다. 되돌아가서 줍지 않아도 됩니다.',
    scale: '견인 폭(중심에서 좌우) = 80 + 6×Lv',
    values: (lv) => [`견인 폭 좌우 ${haulBlinkWidth(lv)}`],
    lv1: '돌진 경로의 젬이 따라옵니다.',
    max: '돌진 한 번이 넓은 띠의 전리품을 통째로 끌고 옵니다.',
  },
  'crush-field': {
    body: '장갑 스택이 하나라도 있는 동안 주변의 적을 주기적으로 압쇄합니다. 서 있기만 해도 붙은 적이 갈립니다.',
    scale: `압쇄 범위 120 + 8×Lv · 1회 피해 4 + Lv · 주기 ${CRUSH_FIELD_PERIOD}틱`,
    values: (lv) => [
      `압쇄 범위 ${crushFieldRadius(lv)}`,
      `${ticks(CRUSH_FIELD_PERIOD)}마다 ${crushFieldDamage(lv)} 피해`,
    ],
    lv1: '붙어 있는 적이 알아서 깎입니다.',
    max: '주변 적이 끊임없이 갈립니다. 파고들어 버티는 빌드의 주력 피해원이 됩니다.',
  },
  'debris-reclaim': {
    body: '부술 수 있는 벽이나 구조물이 부서질 때 대시 쿨다운이 환급되고 자원도 조금 쌓입니다. 지형을 부수는 것이 이동 자원이 됩니다.',
    scale: '파괴 1회당 대시 쿨다운 10 + 2×Lv 틱 환급',
    values: (lv) => [`파괴 1회당 대시 쿨다운 −${debrisReclaimRefund(lv)}틱`],
    lv1: '벽을 부수면 대시가 조금 빨리 돌아옵니다.',
    max: '벽 하나가 대시 한 번을 거의 채워 줍니다.',
  },
  'wall-rebound': {
    body: '벽을 타고 미끄러진 직후에 대시하면 쿨다운의 일부가 즉시 돌아옵니다. 벽을 낀 이동이 자원이 됩니다.',
    scale: '환급 = 남은 쿨다운의 30% + 20%×Lv/(Lv+10)',
    values: (lv) => [`벽 대시 시 남은 쿨다운의 ${ofPct(reboundRefundBp(lv))} 환급`],
    lv1: '벽을 끼고 대시하면 다음 대시가 빨리 옵니다.',
    max: '벽을 끼고 달리면 대시가 거의 절반 쿨로 돌아옵니다.',
  },
  'harvest-clamp': {
    body: '젬을 주울 때마다 장갑이 빠지기까지의 시계를 되감아 소멸을 늦춥니다. 줍는 동작이 장갑 유지가 됩니다.',
    scale: '젬 1개당 감쇠 시계 6 + 2×Lv 틱 되감기',
    values: (lv) => [`젬 1개당 장갑 감쇠 시계 −${harvestClampRewind(lv)}틱`],
    lv1: '젬을 주우면 장갑이 조금 더 버팁니다.',
    max: '젬이 꾸준히 들어오는 동안에는 장갑이 사실상 안 빠집니다.',
  },
  'arrival-shock': {
    body: '기동 액티브 고급판이 도착하는 순간 충격파가 터져 주변 적을 밀어내고 적탄을 지웁니다.',
    scale: '충격파 범위 140 + 10×Lv · 밀려나는 거리 20 + 2×Lv',
    values: (lv) => [
      `충격파 범위 ${arrivalShockRadius(lv)}`,
      `밀려나는 거리 ${arrivalShockPush(lv)}`,
    ],
    lv1: '뛰어든 자리를 곧바로 정리하고 시작합니다.',
    max: '도착과 동시에 넓은 범위가 비워집니다. 포위 한가운데로 뛰어들 수 있게 됩니다.',
  },

  // ── 요새 ────────────────────────────────────────────────────────────────
  'over-plating': {
    body: '장갑 스택의 상한이 늘어납니다. 상한을 조건으로 쓰는 다른 스킬들(만재 판정)이 함께 영향을 받습니다.',
    scale: '상한 증가 = 1 + 3×Lv/(Lv+12)',
    values: (lv) => [
      `장갑 상한 ${BASE_CAP} → ${BASE_CAP + overPlatingBonus(lv)}`,
    ],
    lv1: '장갑을 한 겹 더 쌓을 수 있습니다.',
    max: '상한이 4 늘어납니다. 다만 만재를 조건으로 쓰는 스킬은 그만큼 채우기 어려워지므로 함께 보고 넣어야 합니다.',
  },
  'clot-plating': {
    body: `피격으로 잃은 체력의 일부가 응혈 풀에 쌓이고, 장갑이 만재에 닿는 순간 그 풀이 회복으로 정산됩니다. 정산 시 풀의 ${ofPct(CLOT_SETTLE_BP)} 만 돌아오고 나머지는 사라집니다.`,
    scale: '적립 = 잃은 체력의 20% + 1%p/Lv',
    values: (lv) => [
      `적립 = 잃은 체력의 ${ofPct(clotPlatingBp(lv))}`,
      `만재 도달 시 쌓인 풀의 ${ofPct(CLOT_SETTLE_BP)} 회복`,
    ],
    lv1: '맞은 만큼이 조금씩 되돌아옵니다.',
    max: '잃은 체력의 40%가 쌓입니다. 장갑을 자주 만재로 만들수록 자주 정산됩니다.',
  },
  'recoil-armor': {
    body: '몸통으로 부딪혀 맞은 순간 그 적에게 피해를 되돌려 줍니다. 부딪히는 것이 손해로만 끝나지 않습니다.',
    scale: '반사 = 받은 피해의 20% + 2%p/Lv',
    values: (lv) => [`반사 = 받은 피해의 ${ofPct(recoilReflectBp(lv))}`],
    lv1: '달라붙은 적이 스스로 깎입니다.',
    max: '받은 피해의 절반을 되돌려 줍니다. 몸으로 막는 플레이가 곧 공격이 됩니다.',
  },
  'unmoved-accretion': {
    body: '제자리에 멈춰 있는 동안에는 장갑 감쇠의 부호가 뒤집혀, 스택이 빠지는 대신 쌓입니다. 멈추는 것이 곧 장갑 충전이 됩니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 부호가 뒤집히는가 아닌가만 있기 때문입니다.',
    values: () => ['정지 중에는 장갑이 빠지는 대신 쌓임'],
    lv1: '멈춰 있기만 하면 장갑이 저절로 찹니다.',
    max: '더 넣어도 얻는 것이 없습니다. 1포인트만 넣고 다른 스킬로 넘어가는 편이 낫습니다.',
  },
  'unbreakable-chain': {
    body: '치명 피격을 무효화하는 순간 장갑이 즉시 만재가 되고 주변 적탄이 전부 지워집니다. 죽을 뻔한 순간이 곧 재정비가 됩니다.',
    scale: '적탄 소거 범위 = 150 + 10×Lv · 장갑은 레벨과 무관하게 만재',
    values: (lv) => [
      `적탄 소거 범위 ${unbreakableChainRadius(lv)}`,
      '장갑 즉시 만재',
    ],
    lv1: '살아남는 순간 곧바로 다시 싸울 수 있는 상태가 됩니다.',
    max: '소거 범위가 화면 절반에 가까워 살아난 자리가 통째로 비워집니다.',
  },
  'load-transfer': {
    body: `받는 피해의 일부를 대시 쿨다운으로 떠넘겨 그만큼 덜 아프게 맞습니다. 대가로 발동한 피격마다 대시 쿨다운이 ${LOAD_TRANSFER_DASH_TICKS}틱 늘어납니다.`,
    scale: '피해 경감 = 8% + 0.8%p/Lv',
    values: (lv) => [
      `받는 피해 −${ofPct(loadTransferCutBp(lv))}`,
      `대가: 발동당 대시 쿨다운 +${LOAD_TRANSFER_DASH_TICKS}틱`,
    ],
    lv1: '기동력을 조금 내주고 맷집을 얻습니다.',
    max: '받는 피해가 4분의 1 가까이 깎입니다. 대시를 자주 안 쓰는 빌드일수록 이득입니다.',
  },
  'trophy-refit': {
    body: `엘리트나 보스를 잡으면 그 시점의 장갑 스택에 비례해 최대 체력이 늘어나고 장갑이 만재가 됩니다. 늘어난 체력은 그 런 동안 유지되며, 런 시작 체력의 ${ofPct(TROPHY_RUN_CAP_BP)} 까지만 쌓입니다.`,
    scale: '장갑 1스택당 최대 체력 +(1 + 6×Lv/(Lv+14))',
    values: (lv) => [
      `장갑 1스택당 최대 체력 +${trophyHpPerStack(lv)}`,
      `${BASE_CAP}스택으로 잡으면 +${trophyHpPerStack(lv) * BASE_CAP}`,
    ],
    lv1: '엘리트를 잡을 때마다 조금씩 두꺼워집니다.',
    max: '만재로 엘리트를 잡으면 한 번에 30이 늘어납니다. 상한까지 채우는 것이 목표가 됩니다.',
  },
  'molt-regen': {
    body: '장갑 스택이 시간이 지나 빠질 때마다 그 스택이 회복으로 바뀝니다. 유지하지 못하고 흘린 장갑도 헛되지 않습니다.',
    scale: '소멸 1스택당 회복 = 3 + Lv',
    values: (lv) => [`장갑 1스택이 빠질 때 체력 +${moltRegenHeal(lv)}`],
    lv1: '장갑이 빠져도 조금은 돌아옵니다.',
    max: '장갑이 빠질 때마다 23씩 회복합니다. 장갑을 굳이 유지하지 않는 빌드도 성립합니다.',
  },
  'last-stand-instinct': {
    body: '체력이 30% 이하인 동안 장갑이 빠지지 않고, 피격당 쌓이는 양이 늘며, 장갑 1스택이 깎아 주는 피해도 커집니다. 위기일수록 단단해집니다.',
    scale: '장갑 1스택당 피해 감소 = 0.2% + 0.05%p/Lv (총 감소 = 스택 × 이 값)',
    values: (lv) => [
      `장갑 1스택당 받는 피해 −${ofPct(lastStandPerStackBp(lv))}`,
      `${BASE_CAP}스택이면 −${ofPct(lastStandPerStackBp(lv) * BASE_CAP)}`,
      '빈사 중 장갑 감쇠 정지',
    ],
    lv1: '위기에서 장갑이 빠지지 않게 됩니다.',
    max: '만재로 버티면 받는 피해가 7% 넘게 깎이고 장갑도 안 빠집니다.',
  },
  'burst-cremation': {
    body: '강화 액티브 고급판이 끝나며 터지는 폭발이 적탄을 지우고 맞은 적에게 화상을 붙입니다.',
    scale: '화상 틱당 피해 = 2 + Lv',
    values: (lv) => [`붙는 화상 틱당 ${cremationBurnPerTick(lv)} 피해`],
    lv1: '액티브가 끝나는 자리에 화상이 남습니다.',
    max: '만료 폭발 한 번이 주변을 통째로 태웁니다.',
  },
};
