/**
 * 아크캐스터 30스킬 상세 — 수치는 `src/sim/skills/arccasterScaling.ts` 가 낸다.
 *
 * 이 표는 **수치를 담지 않는다.** 어떤 함수를 어떤 라벨로 부를지만 담으므로, 밸런스가 바뀌면
 * 이 파일을 한 줄도 안 고쳐도 화면이 새 값을 말한다. 근거는 `../skillDetail.ts` 머리 참조.
 *
 * ## 이 기체를 설명할 때 반복해서 나오는 말
 * **과충전** — 제자리에 멈춰 있으면 쌓이고 움직이면 흩어지는 이 기체의 고유 게이지다. 화력
 * 스킬 다수가 "과충전 중일 때"를 조건으로 건다. **전격 연쇄** — 한 적을 때린 전기가 주변으로
 * 튀는 것으로, 여러 스킬이 같은 연쇄를 공유한다(그래서 연쇄를 키우는 스킬 하나가 나머지
 * 전부를 함께 키운다).
 */

import {
  CAPACITOR_KILLS,
  guidedArcChainBp,
  relayRadiusAdd,
  relayTargetsAdd,
  endpointBurstBp,
  endpointBurstRadius,
  entryLanceDamage,
  entryLancePierce,
  potentialSnipeBp,
  potentialSnipePierce,
  overkillCarryBp,
  residualBoltCostTicks,
  groundedPierceBp,
  boltSalvageMultBp,
  primedStrikeBp,
  redeploySalvoCount,
  redeploySalvoDamage,
  stillMagnetMaxBp,
  stillSpotterRefundShots,
  sweepLaneHalfWidth,
  staticComboPeriod,
  killCapacitorBonusCount,
  insulatedMountCutBp,
  marchFireDecayPeriod,
  salvoDoctrineMultBp,
  staticRepulsorRadius,
  staticRepulsorPush,
  lightningRodChainDamage,
  phaseCouplingCutBp,
  surplusShieldCap,
  groundTetherCutBp,
  chargeBackflowHealBp,
  bufferCondenserBp,
  repairPeriodTicks,
  repulseHullRadius,
  terminalGroundIframes,
} from '../../sim/skills/arccasterScaling.js';
import {
  incPct,
  multX,
  ofPct,
  ticks,
  NO_SCALE_LV1,
  NO_SCALE_MAX,
  type SkillDetail,
} from './format.js';

export const ARCCASTER_SKILL_DETAIL: Readonly<Record<string, SkillDetail>> = {
  // ── 연쇄 ────────────────────────────────────────────────────────────────
  'guided-arc': {
    body: '과충전 중에 쏜 탄이 적을 맞히면 그 자리에서 전격 연쇄가 터집니다. 연쇄 피해는 맞힌 탄의 피해를 기준으로 정해지므로, 주무기가 셀수록 연쇄도 함께 세집니다.',
    scale: '연쇄 피해 = 그 탄 피해의 20% + 2%p/Lv',
    values: (lv) => [`연쇄 피해 = 그 탄 피해의 ${ofPct(guidedArcChainBp(lv))}`],
    lv1: '과충전을 유지하는 것만으로 광역 피해가 붙습니다.',
    max: '탄 하나가 곧 광역기가 됩니다. 주무기 피해를 올리는 장비가 연쇄까지 같이 키웁니다.',
  },
  'relay-circuit': {
    body: '전격 연쇄가 튀는 거리와 튀는 대상 수가 늘어납니다. 이 기체가 만드는 모든 연쇄에 적용되므로, 연쇄를 쓰는 다른 스킬들이 한꺼번에 강해집니다.',
    scale: '도약 거리 +20 + 6×Lv · 도약 대상 +1 + ⌊Lv/7⌋',
    values: (lv) => [
      `연쇄 도약 거리 +${relayRadiusAdd(lv)}`,
      `연쇄 도약 대상 +${relayTargetsAdd(lv)}`,
    ],
    lv1: '연쇄가 한 명 더 물고, 더 멀리까지 튑니다.',
    max: '연쇄가 화면을 가로지릅니다. 연쇄를 쓰는 스킬을 많이 찍었을수록 이득이 커집니다.',
  },
  'endpoint-burst': {
    body: '과충전 중에 쏜 탄이 적을 못 맞히고 사거리를 다해 사라지면, 사라진 그 자리에서 방전 폭발이 일어납니다. 빗나간 탄이 버려지지 않습니다.',
    scale: '폭발 피해 = 기준 피해의 25% + 2%p/Lv · 폭발 범위 50 + 5×Lv',
    values: (lv) => [
      `폭발 피해 = 기준 피해의 ${ofPct(endpointBurstBp(lv))}`,
      `폭발 범위 ${endpointBurstRadius(lv)}`,
    ],
    lv1: '빗나간 탄이 그 자리에서 작게 터집니다.',
    max: '탄막을 멀리 뿌리는 것만으로 사거리 끝에 폭발 지대가 생깁니다.',
  },
  'entry-lance': {
    body: '과충전에 막 진입하는 순간, 조준 방향으로 관통이 높은 방전탄이 자동으로 한 발 나갑니다. 멈춰서 과충전을 쌓기 시작할 때마다 한 번씩 터집니다.',
    scale: '방전탄 피해 30 + 6×Lv · 관통 3 + ⌊Lv/5⌋',
    values: (lv) => [
      `방전탄 피해 ${entryLanceDamage(lv)}`,
      `방전탄 관통 ${entryLancePierce(lv)}`,
    ],
    lv1: '자리를 잡는 동작 자체에 공격이 하나 붙습니다.',
    max: '진입 한 번이 일렬로 선 적을 통째로 꿰뚫습니다.',
  },
  'potential-snipe': {
    body: '오래 날아간 뒤에 맞은 탄일수록 피해가 커지고 관통도 늘어납니다. 멀리 있는 적을 노릴수록 이득입니다.',
    scale: '먼 거리 명중 피해 +25% + 2.5%p/Lv · 관통 +1 + ⌊Lv/8⌋',
    values: (lv) => [
      `먼 거리 명중 피해 ${incPct(potentialSnipeBp(lv))}`,
      `먼 거리 명중 관통 +${potentialSnipePierce(lv)}`,
    ],
    lv1: '먼 적을 때릴 때 눈에 띄게 아파집니다.',
    max: '원거리 저격 특화가 됩니다. 멀리서 쏠수록 관통이 붙어 뒤의 적까지 닿습니다.',
  },
  'overkill-carry': {
    body: '탄이 적을 처치하고도 피해가 남았다면, 그 남은 피해가 탄에 실려 다음 대상에게 전달됩니다. 약한 적을 지나칠 때 피해가 버려지지 않습니다.',
    scale: '이월되는 초과 피해 = 남은 피해의 40% + 3%p/Lv',
    values: (lv) => [`이월 = 남은 피해의 ${ofPct(overkillCarryBp(lv))}`],
    lv1: '잡몹을 뚫고 지나갈 때 뒤의 적도 함께 아파집니다.',
    max: '피해가 거의 그대로 이월됩니다. 관통이 높을수록 한 발이 줄줄이 지웁니다.',
  },
  'residual-discharge': {
    body: '방전 액티브가 과충전을 비우고 나면, 그때까지 모아 둔 정지 시간에 비례해 가장 가까운 적에게 여진탄이 자동으로 날아갑니다. 오래 서 있었을수록 많이 나갑니다.',
    scale: '여진탄 1발당 소모하는 정지 시간 = 60 − 2×Lv 틱 (최소 10)',
    values: (lv) => [
      `여진탄 1발당 정지 ${residualBoltCostTicks(lv)}틱 소모`,
      `정지 600틱을 모았다면 약 ${Math.floor(600 / residualBoltCostTicks(lv))}발`,
    ],
    lv1: '액티브를 쓰고 나면 남은 전하가 몇 발로 돌아옵니다.',
    max: '같은 정지 시간에서 여진탄이 3배 가까이 나갑니다.',
  },
  'grounded-pierce': {
    body: '과충전 중에 쏜 탄은 적을 하나 꿰뚫을 때마다 피해가 더 세집니다. 뒤에 있는 적일수록 더 아프게 맞습니다.',
    scale: '관통 1회마다 피해 +6% + 0.6%p/Lv',
    values: (lv) => [`관통 1회마다 피해 ${incPct(groundedPierceBp(lv))}`],
    lv1: '줄지어 선 적을 쏠 때 뒤쪽이 더 아파집니다.',
    max: '관통이 높은 무기에서 마지막 대상이 첫 대상의 몇 배로 맞습니다.',
  },
  'bolt-salvage': {
    body: '과충전 중에 엘리트를 처치하면 그 전리품의 희귀도 판정에 상향 배율이 실립니다. 멈춰서 싸우는 플레이가 파밍으로도 보상받습니다.',
    scale: '전리품 희귀도 배율 ×1.05 + 0.025/Lv',
    values: (lv) => [`전리품 희귀도 ${multX(boltSalvageMultBp(lv))}`],
    lv1: '과충전 상태로 잡은 엘리트가 조금 더 좋은 것을 떨굽니다.',
    max: '과충전 유지가 곧 파밍 효율이 됩니다.',
  },
  'primed-strike': {
    body: '방전 액티브가 뿌리는 투사체가 적을 맞히면 그 적에게 전격 연쇄를 겁니다. 액티브 한 번이 광역 연쇄로 번집니다.',
    scale: '연쇄 피해 = 그 탄 피해의 25% + 2%p/Lv',
    values: (lv) => [`연쇄 피해 = 그 탄 피해의 ${ofPct(primedStrikeBp(lv))}`],
    lv1: '액티브가 단발 피해에서 광역 연쇄로 바뀝니다.',
    max: '액티브 한 번이 화면 전체의 전격 연쇄가 됩니다.',
  },

  // ── 일제사 ──────────────────────────────────────────────────────────────
  'redeploy-salvo': {
    body: '점멸 액티브로 착지하는 순간 사방으로 원형 볼리가 자동 발사됩니다. 자리를 옮기는 동작이 곧 공격이 됩니다.',
    scale: '탄 수 6 + ⌊Lv/2⌋ · 1발 피해 18 + 3×Lv',
    values: (lv) => [
      `원형 볼리 ${redeploySalvoCount(lv)}발`,
      `1발 ${redeploySalvoDamage(lv)} 피해 · 합계 ${redeploySalvoCount(lv) * redeploySalvoDamage(lv)}`,
    ],
    lv1: '점멸로 빠져나오면서 주변을 한 번 훑습니다.',
    max: '점멸 한 번이 사방 16발의 일제사가 됩니다.',
  },
  'still-magnet': {
    body: '제자리에 멈춰 있는 동안 젬을 끌어당기는 범위가 넓어집니다. 오래 서 있을수록 넓어지고, 정지 시간이 도달치에 닿으면 더는 커지지 않습니다.',
    scale: '정지 도달 시 흡인 범위 +20% + 2%p/Lv (정지 시간에 비례해 그만큼까지)',
    values: (lv) => [`정지가 최대일 때 젬 흡인 범위 ${incPct(stillMagnetMaxBp(lv))}`],
    lv1: '멈춰서 쏘는 동안 젬이 알아서 옵니다.',
    max: '자리를 잡고 있으면 화면의 젬이 빨려 듭니다.',
  },
  'still-spotter': {
    body: '제자리에 멈춰 있는 동안 주운 젬만 주무기 발사 쿨다운을 환급합니다. 움직이면서 주운 젬은 환급되지 않습니다.',
    scale: '정지 중 젬 1개당 발사 ' + '2 + ⌊Lv/2⌋' + '회분 환급',
    values: (lv) => [`정지 중 젬 1개당 발사 ${stillSpotterRefundShots(lv)}회분 환급`],
    lv1: '멈춰서 줍는 젬이 곧 추가 사격이 됩니다.',
    max: '젬 하나가 발사 12회분을 돌려줍니다. 젬이 몰린 구간에서 사격이 끊기지 않습니다.',
  },
  'sweep-lane': {
    body: '점멸로 지나간 경로 위의 젬과 전리품을 즉시 주워 담습니다. 되돌아가서 줍지 않아도 됩니다.',
    scale: '수거 폭(중심에서 좌우) = 60 + 4×Lv',
    values: (lv) => [`수거 폭 좌우 ${sweepLaneHalfWidth(lv)}`],
    lv1: '점멸 경로에 있던 것은 그대로 딸려옵니다.',
    max: '점멸 한 번이 넓은 띠를 통째로 쓸어 담습니다.',
  },
  'static-combo': {
    body: '과충전 중에는 콤보 유지 시계가 느리게 줄어듭니다. 멈춰서 쏘는 동안 콤보가 잘 끊기지 않습니다.',
    scale: '콤보 시계가 줄어드는 주기 = 2 + ⌊Lv/4⌋ 틱마다 1',
    values: (lv) => [`과충전 중 콤보 시계 ${staticComboPeriod(lv)}틱마다 1 감소`],
    lv1: '과충전 중 콤보가 절반 속도로 줍니다.',
    max: '과충전만 유지하면 콤보가 거의 안 줄어듭니다.',
  },
  'echo-mount': {
    body: '멀리 점멸했을 때 출발한 자리에 임시 자동 포탑이 남습니다. 포탑은 스스로 주변 적을 쏩니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 포탑이 서는가 아닌가만 있기 때문입니다.',
    values: () => ['장거리 점멸 시 출발 자리에 자동 포탑 1기'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'kill-capacitor': {
    body: `적을 ${CAPACITOR_KILLS}기 처치할 때마다 다음 볼리의 탄 수가 늘어납니다. 축전기가 장전된 상태에서 추가로 처치해도 이월되지는 않습니다.`,
    scale: `${CAPACITOR_KILLS}처치마다 다음 볼리 탄 수 +2 + ⌊Lv/5⌋`,
    values: (lv) => [
      `${CAPACITOR_KILLS}처치마다 다음 볼리 +${killCapacitorBonusCount(lv)}발`,
    ],
    lv1: '처치가 쌓일 때마다 굵은 볼리가 한 번씩 나갑니다.',
    max: '한 번 터질 때 6발이 더 나갑니다. 잡몹이 많은 구간에서 계속 장전됩니다.',
  },
  'insulated-mount': {
    body: '감속 장판 위에서 멈춰 있으면 과충전이 두 배로 쌓이고 용암 피해도 줄어듭니다. 남들이 피하는 자리가 이 기체에게는 좋은 자리가 됩니다.',
    scale: '과충전 적립 2배(고정) · 용암 피해 −15% − 1.5%p/Lv',
    values: (lv) => [
      '감속 장판 위 정지 시 과충전 적립 2배',
      `용암 피해 −${ofPct(insulatedMountCutBp(lv))}`,
    ],
    lv1: '장판 위가 오히려 충전 자리가 됩니다.',
    max: '용암 위에 눌러앉아 과충전을 두 배로 쌓을 수 있습니다.',
  },
  'march-fire': {
    body: '움직여도 과충전 게이지가 즉시 사라지지 않고 서서히 줄어듭니다. 자리를 옮기는 동안 쌓아 둔 전하를 지킬 수 있습니다.',
    scale: '이동 중 게이지가 1 줄어드는 주기 = 2 + ⌊Lv/2⌋ 틱',
    values: (lv) => [`이동 중 과충전 ${marchFireDecayPeriod(lv)}틱마다 1 감소`],
    lv1: '짧게 자리를 옮겨도 과충전이 남아 있습니다.',
    max: '거의 새지 않습니다. 계속 움직이면서도 과충전을 유지할 수 있습니다.',
  },
  'salvo-doctrine': {
    body: '발사 간격과 볼리 탄 수가 함께 늘어나, 같은 화력을 굵고 느린 일제사로 바꿔 냅니다. 레벨을 올리면 그 "굵고 느린" 정도가 완화돼 실사격이 촘촘해집니다.',
    scale: '발사 간격·탄수 배율 = ×2.00 − 0.60×Lv/(Lv+10)',
    values: (lv) => [`발사 간격·탄수 ${multX(salvoDoctrineMultBp(lv))}`],
    lv1: '한 번에 두 배로 쏟아붓는 대신 그만큼 뜸해집니다.',
    max: '굵기는 유지하면서 간격이 좁아져 실사격이 훨씬 촘촘해집니다.',
  },

  // ── 방벽 ────────────────────────────────────────────────────────────────
  'static-repulsor': {
    body: '과충전 중에 주기적으로 척력 펄스가 터져 주변 적을 밀어냅니다. 멈춰서 쏘는 자리를 스스로 지켜 줍니다.',
    scale: '펄스 범위 140 + 8×Lv · 밀려나는 거리 20 + 3×Lv',
    values: (lv) => [
      `펄스 범위 ${staticRepulsorRadius(lv)}`,
      `밀려나는 거리 ${staticRepulsorPush(lv)}`,
    ],
    lv1: '달라붙는 적을 주기적으로 떼어 냅니다.',
    max: '과충전 중에는 근접 자체가 성립하지 않습니다.',
  },
  'lightning-rod': {
    body: '체력이 깎이는 피격을 받으면 주변으로 전격 연쇄 반격이 터집니다. 맞은 것이 그대로 반격이 됩니다.',
    scale: '반격 연쇄 피해 = 15 + 4×Lv',
    values: (lv) => [`피격 시 반격 연쇄 ${lightningRodChainDamage(lv)} 피해`],
    lv1: '한 대 맞으면 주변이 함께 감전됩니다.',
    max: '맞을수록 주변이 정리됩니다. 연쇄를 키우는 스킬과 같이 가면 더 커집니다.',
  },
  'phase-coupling': {
    body: '방벽 액티브가 지속되는 동안 받는 피해가 줄어듭니다. 무적이 아니라 경감이라 액티브가 끝나도 급격히 무너지지 않습니다.',
    scale: '받는 피해 −15% − 1%p/Lv',
    values: (lv) => [`방벽 지속 중 받는 피해 −${ofPct(phaseCouplingCutBp(lv))}`],
    lv1: '방벽을 켜는 동안 확실히 덜 아픕니다.',
    max: '방벽 지속 중에는 받는 피해가 3분의 1 넘게 깎입니다.',
  },
  'surplus-shield': {
    body: '과충전 상한을 넘겨 버려지던 정지 시간이 피해 흡수량으로 쌓입니다. 상한까지 채운 뒤에도 계속 서 있는 것이 헛되지 않습니다.',
    scale: '흡수량 상한 = 20 + 4×Lv',
    values: (lv) => [`피해 흡수량 상한 ${surplusShieldCap(lv)}`],
    lv1: '넘친 전하가 얇은 보호막이 됩니다.',
    max: '과충전을 오래 유지하면 피격 한 번을 통째로 먹는 보호막이 섭니다.',
  },
  'ground-tether': {
    body: '벽에 붙은 채로 멈춰 있으면 받는 피해가 줄어듭니다. 벽을 등지고 자리를 잡는 플레이에 보상이 붙습니다.',
    scale: '받는 피해 −12% − 1.2%p/Lv',
    values: (lv) => [`벽에 붙어 정지 중 받는 피해 −${ofPct(groundTetherCutBp(lv))}`],
    lv1: '벽을 끼고 서면 확실히 덜 아픕니다.',
    max: '벽에 붙어 있는 동안은 받는 피해가 3분의 1 넘게 깎입니다.',
  },
  'charge-backflow': {
    body: '체력이 얼마 남지 않은 상태에서 맞으면, 쌓아 둔 과충전을 전부 태워 즉시 체력을 회복합니다. 과충전이 많이 쌓여 있을수록 크게 회복합니다.',
    scale: '회복량 = 태운 과충전의 5% + 0.5%p/Lv',
    values: (lv) => [`회복량 = 태운 과충전의 ${ofPct(chargeBackflowHealBp(lv))}`],
    lv1: '위기에 한 번, 쌓아 둔 전하를 목숨으로 바꿉니다.',
    max: '과충전을 가득 채워 두면 위기 한 번을 통째로 되돌립니다.',
  },
  'buffer-condenser': {
    body: '피격으로 깎인 피해량이 그만큼 과충전 게이지로 바뀝니다. 맞는 것이 손해로만 끝나지 않습니다.',
    scale: '전환량 = 받은 피해의 50% + 5%p/Lv',
    values: (lv) => [`전환량 = 받은 피해의 ${ofPct(bufferCondenserBp(lv))}`],
    lv1: '맞을 때마다 과충전이 조금씩 찹니다.',
    max: '받은 피해가 그대로 전하가 됩니다. 위기 회복 스킬과 함께 순환을 만듭니다.',
  },
  'still-repair': {
    body: '과충전을 유지하는 동안 일정 주기로 체력이 1씩 회복됩니다. 자리를 잡고 오래 버틸수록 이득입니다.',
    scale: '회복 주기 = 20 + ⌊1200/(Lv+14)⌋ 틱마다 1',
    values: (lv) => [
      `과충전 유지 중 ${ticks(repairPeriodTicks(lv))}마다 체력 +1`,
      `1분 유지하면 약 ${Math.floor(3600 / repairPeriodTicks(lv))} 회복`,
    ],
    lv1: '멈춰 있는 동안 체력이 조금씩 돌아옵니다.',
    max: '회복 주기가 절반 아래로 줄어 눌러앉아 있으면 꾸준히 차오릅니다.',
  },
  'repulse-hull': {
    body: '무적 상태인 동안 몸 주변의 적탄이 지워집니다. 무적이 끝난 직후에 다시 맞는 것을 막습니다.',
    scale: '소거 범위 = 32 + 4×Lv',
    values: (lv) => [`무적 중 적탄 소거 범위 ${repulseHullRadius(lv)}`],
    lv1: '무적으로 빠져나올 때 주변이 정리됩니다.',
    max: '무적이 지나간 자리가 통째로 비워집니다.',
  },
  'terminal-ground': {
    body: '치명 무효화가 발동하는 순간 과충전 게이지가 상한까지 차고 무적 시간도 늘어납니다. 죽을 뻔한 순간이 곧 반격 준비가 됩니다.',
    scale: '추가 무적 = 2 + ⌊Lv/2⌋ 틱 · 과충전은 레벨과 무관하게 상한까지',
    values: (lv) => [
      `추가 무적 +${terminalGroundIframes(lv)}틱`,
      '과충전 게이지 상한까지 즉시 충전',
    ],
    lv1: '살아남는 순간 곧바로 반격 태세가 됩니다.',
    max: '무적이 넉넉해져 되받아칠 자리를 잡을 여유까지 생깁니다.',
  },
};
