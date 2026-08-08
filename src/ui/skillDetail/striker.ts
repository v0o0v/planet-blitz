/**
 * 스트라이커 30스킬 상세 — 수치는 `src/sim/skills/strikerScaling.ts` 가 낸다.
 *
 * 이 표는 **수치를 담지 않는다.** 어떤 함수를 어떤 라벨로 부를지만 담으므로, 밸런스가 바뀌면
 * 이 파일을 한 줄도 안 고쳐도 화면이 새 값을 말한다. 근거는 `../skillDetail.ts` 머리 참조.
 */

import {
  killMomentumCharge,
  recoilWindowTicks,
  recoilDamageBp,
  recoilSpeedMultBp,
  ventBurstBp,
  shatterRadius,
  shatterDamageBp,
  sightlineDamageBp,
  incendiaryBurnPerTick,
  incendiaryBurstMultBp,
  targetLockPerStackBp,
  TARGET_LOCK_STACK_CAP,
  overheatExtendTicks,
  OVERHEAT_EXTEND_CAP,
  suppressPush,
  extendedMagBp,
  reactivePlatingRadius,
  fieldTriageHeal,
  coverDoctrineCutBp,
  hazardCutBp,
  hazardSpeedMultBp,
  lastRitesThresholdBp,
  comboAbsorbPerStack,
  expiryStasisTicks,
  expiryStasisRadius,
  hullGrantHp,
  HULL_XP_THRESHOLD,
  inertiaBurstRadius,
  inertiaBurstDamage,
  thrustWakeCount,
  thrustWakeDamage,
  thrustWakeLife,
  THRUST_WAKE_SPACING,
  gemRouteCut,
  slipstreamExtMultBp,
  wallKickIframes,
  dashPurgeRadius,
  vaultShotBp,
  ramManeuverDamage,
  twinRechargeTicks,
} from '../../sim/skills/strikerScaling.js';
import { DEFAULT_CONFIG } from '../../sim/world.js';
import { incPct, multX, ofPct, ticks, NO_SCALE_LV1, NO_SCALE_MAX, type SkillDetail } from './format.js';

/** F2 지속 시간은 대시 쿨다운의 비율이라 기준 쿨다운이 필요하다. 파워업 미적용 기본값을 쓴다. */
const BASE_DASH_CD = DEFAULT_CONFIG.dashCooldownTicks;

/**
 * 스트라이커 30스킬 — 키는 `ShipSkillDef.id` 에서 **기체 접두사를 뗀 부분**이다.
 *
 * `id` 는 `` `${shipSlug}-${idSlug}` `` 로 조립된다(`data/ships/types.ts` `buildShipAxis`).
 * 여기서는 `striker-` 를 30번 반복하지 않으려고 뒷부분만 키로 쓰고, {@link skillDetailOf} 가
 * 기체 slug 로 표를 고른 뒤 접두사를 떼어 조회한다.
 *
 * ⚠️ **`code`(F1·S3…)를 키로 쓰지 않는다.** code 는 축 안에서만 유일해 기체 간 충돌한다
 * (모든 기체에 F1 이 있다) — 180스킬이 더 붙는 날 조용히 덮어쓴다.
 */
export const STRIKER_SKILL_DETAIL: Readonly<Record<string, SkillDetail>> = {
  // ── 화력 ────────────────────────────────────────────────────────────────
  'kill-momentum': {
    body: '적을 처치할 때마다 정조준 사이클 카운터가 즉시 충전됩니다. 어떻게 죽였는지는 가리지 않습니다 — 탄에 맞아 죽든 화상·전격·폭발로 죽든 모두 셉니다.',
    scale: '처치당 충전 = 1 + ⌈Lv/4⌉ (4레벨마다 1씩 오르는 계단)',
    values: (lv) => [`처치당 충전 +${killMomentumCharge(lv)}`],
    lv1: '처치마다 2씩 채워집니다. 적이 몰린 구간에서 정조준이 눈에 띄게 자주 돌아옵니다.',
    max: '적 2기만 잡아도 정조준이 한 번 돌아옵니다. 웨이브를 쓸어 담는 것이 곧 정조준 연쇄가 됩니다.',
  },
  'recoil-carry': {
    body: '대시한 직후 짧은 시간 안에 쏜 볼리는 부채꼴이 한 줄기로 모이고 피해와 탄속이 함께 오릅니다. 레일건과 빔은 원래 부채꼴로 퍼지지 않아 모이는 효과는 받지 않고 피해 증폭만 받습니다.',
    scale: '지속 시간 = 대시 쿨다운의 30% + 25%×Lv/(Lv+10) · 그동안 피해 +10% + 1%p/Lv',
    values: (lv) => [
      `모이는 시간 ${ticks(recoilWindowTicks(lv, BASE_DASH_CD))} (기본 대시 쿨다운 ${BASE_DASH_CD}틱 기준)`,
      `그동안 피해 ${incPct(recoilDamageBp(lv))} · 탄속 ${multX(recoilSpeedMultBp(lv))}`,
    ],
    lv1: '대시하고 곧바로 쏘는 습관에 보상이 붙습니다. 한 줄기로 모이는 것만으로도 먼 적을 맞히기 쉬워집니다.',
    max: '대시를 계속 돌리는 빌드의 주력 화력 구간이 됩니다. 대시 쿨다운을 줄이는 파워업을 함께 써도 이 구간의 비율은 그대로 유지됩니다.',
  },
  'vent-burst': {
    body: '화력 액티브를 쓰는 순간 주무기 쿨다운이 즉시 사라지고, 그 액티브가 뿌리는 탄이 정조준과 같은 강화를 받습니다.',
    scale: '액티브 탄 피해 +10% + 2%p/Lv · 주무기 쿨다운 환급은 레벨과 무관하게 전액',
    values: (lv) => [`액티브 탄 피해 ${incPct(ventBurstBp(lv))}`, '주무기 쿨다운 전액 환급'],
    lv1: '액티브를 써도 주무기 사격 리듬이 끊기지 않습니다.',
    max: '액티브를 쓰는 순간이 그 런의 화력 정점이 됩니다 — 쿨다운 환급과 최대 증폭이 한꺼번에 겹칩니다.',
  },
  'shatter-round': {
    body: '관통 횟수를 다 쓰고 사라지는 탄이 사라진 자리에서 작게 폭발합니다. 폭발은 기체가 아니라 탄이 있던 자리에서 일어납니다.',
    scale: '폭발 범위 60 + 6×Lv · 폭발 피해 = 그 탄 피해의 30% + 2%p/Lv',
    values: (lv) => [
      `폭발 범위 ${shatterRadius(lv)}`,
      `폭발 피해 = 그 탄 피해의 ${ofPct(shatterDamageBp(lv))}`,
    ],
    lv1: '관통 파워업이나 레일건 빌드에 광역 피해가 공짜로 딸려옵니다.',
    max: '탄 하나하나가 유탄이 됩니다. 한 번에 여러 발을 쏘는 무기일수록 총 피해가 커집니다.',
  },
  'sightline-pierce': {
    body: '자동으로 조준된 적이 기체가 바라보는 방향 20° 안에 있으면, 그때 쏜 볼리가 관통 +1 과 피해 증폭을 얻습니다. 관통은 쏘는 순간에만 한 번 붙고, 범위 밖으로 쏜다고 해서 손해를 보지는 않습니다.',
    scale: '적용 범위 좌우 20° 고정 · 관통 +1 고정 · 범위 안 피해 +6% + 1.5%p/Lv',
    values: (lv) => ['관통 +1 (범위 안)', `범위 안 피해 ${incPct(sightlineDamageBp(lv))}`],
    lv1: '관통 +1 만으로도 값을 합니다 — 대가로 잃는 것이 하나도 없습니다.',
    max: '한 방향에 화력을 몰아주는 특화가 됩니다. 자동 조준과 기체가 보는 방향을 맞추는 플레이가 보상을 받습니다.',
  },
  'incendiary-mark': {
    body: '정조준 탄이 맞힌 적에게 화상을 붙이고, 이미 화상 중인 적을 맞히면 남은 화상 피해를 그 자리에서 한꺼번에 터뜨리며 화상을 끝냅니다. 보스에게는 화상을 붙이지 않습니다 — 보스는 화상이 쓰는 자리를 과열 창에 쓰기 때문에, 화상을 걸면 과열 창을 덮어써 오히려 손해입니다.',
    scale: '붙는 화상의 틱당 피해 = 1 + ⌊Lv/4⌋ · 터뜨릴 때 남은 화상 피해의 100% + 5%p/Lv',
    values: (lv) => [
      `붙는 화상 틱당 ${incendiaryBurnPerTick(lv)} 피해`,
      `터뜨릴 때 남은 화상의 ${ofPct(incendiaryBurstMultBp(lv))}`,
    ],
    lv1: '화염 장비가 없어도 그대로 작동합니다 — 화상을 스스로 붙이고 스스로 터뜨립니다.',
    max: '쌓아서 터뜨리는 순환이 굵어집니다. 화염 어픽스가 붙은 장비를 함께 쓰면 터뜨리는 양이 더 커집니다.',
  },
  'target-lock': {
    body: '같은 적을 연달아 맞힐수록 그 적에게만 통하는 피해 배수가 쌓입니다. 표적이 바뀌면 처음부터 다시 쌓입니다. 그래서 탄이 여러 적을 꿰뚫는 관통 빌드와는 서로 어긋납니다 — 관통이 표적을 계속 갈아치우기 때문입니다.',
    scale: `스택당 피해 +3% + 0.5%p/Lv · 최대 ${TARGET_LOCK_STACK_CAP}스택`,
    values: (lv) => [
      `스택당 피해 ${incPct(targetLockPerStackBp(lv))}`,
      `${TARGET_LOCK_STACK_CAP}스택까지 쌓으면 최대 ${incPct(targetLockPerStackBp(lv) * TARGET_LOCK_STACK_CAP)}`,
    ],
    lv1: '보스나 엘리트처럼 오래 버티는 적에게 피해가 점점 쌓입니다.',
    max: '한 표적을 집중해서 녹이는 특화가 됩니다. 상한까지 쌓으면 볼리 피해가 두 배 가까이 됩니다.',
  },
  'overheat-shatter': {
    body: '보스의 과열 창이 열려 있는 동안 맞힐 때마다 그 창이 조금씩 길어집니다. 이미 최대 길이를 넘겨 열려 있는 창을 도로 짧게 만들지는 않습니다.',
    scale: `명중당 연장 = 1 + ⌊Lv/8⌋ 틱 · 과열 창은 ${OVERHEAT_EXTEND_CAP}틱을 넘지 않습니다`,
    values: (lv) => [
      `명중당 과열 창 +${overheatExtendTicks(lv)}틱`,
      `과열 창 최대 길이 ${ticks(OVERHEAT_EXTEND_CAP)}`,
    ],
    lv1: '한 번에 여러 발이 나가 명중 횟수가 많은 만큼, 1틱씩이라도 창이 눈에 띄게 늘어납니다.',
    max: '보스의 약점 구간을 최대 길이까지 끌고 갑니다. 보스를 잡는 데 걸리는 시간이 크게 줄어듭니다.',
  },
  'suppress-shot': {
    body: '정조준 탄에 맞은 적이 탄이 날아온 방향으로 밀려납니다. 보스와 엘리트는 절반만 밀립니다. 구조물과 설비는 밀리지 않습니다.',
    scale: '밀려나는 거리 = 24 + 4×Lv (보스·엘리트는 절반)',
    values: (lv) => [
      `밀려나는 거리 ${suppressPush(lv)}`,
      `보스·엘리트는 ${Math.round(suppressPush(lv) / 2)}`,
    ],
    lv1: '달려드는 적을 떼어 놓아 숨 돌릴 여유가 생깁니다.',
    max: '몰려오는 대열을 통째로 밀어내 근접 압박 자체가 성립하지 않습니다.',
  },
  'extended-mag': {
    body: '정조준 볼리를 쏜 그 순간 같은 방향으로 볼리가 한 번 더 나갑니다. 이 추가 볼리는 주무기 쿨다운을 쓰지 않습니다.',
    scale: '추가 볼리 피해 = 본래 볼리의 100% − 1200%/(Lv+19) (초반 레벨의 상승 폭이 가장 큽니다)',
    values: (lv) => [`추가 볼리 피해 = 본래 볼리의 ${ofPct(extendedMagBp(lv))}`],
    lv1: '정조준 때마다 볼리가 두 번 나갑니다. 피해가 40%짜리여도 맞히는 횟수는 두 배입니다.',
    max: '정조준 한 번이 사실상 볼리 1.7회분이 됩니다. 한 번에 여러 발을 쏘는 무기일수록 총량이 커집니다.',
  },

  // ── 생존 ────────────────────────────────────────────────────────────────
  'retaliation-sight': {
    body: '체력이 실제로 깎이는 피격을 당한 순간 정조준 사이클 카운터가 가득 찹니다. 무적 상태에 막힌 피격은 해당하지 않습니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 가득 채우는 것 이상은 없기 때문입니다.',
    values: () => ['피격 시 정조준 사이클 즉시 충전'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'reactive-plating': {
    body: '체력이 깎이는 피격을 당한 순간 주변 적탄을 지웁니다. 맞은 그 순간의 탄막을 지워 연달아 맞는 것을 막습니다.',
    scale: '적탄 소거 범위 = 90 + 8×Lv',
    values: (lv) => [`적탄 소거 범위 ${reactivePlatingRadius(lv)}`],
    lv1: '한 대 맞고 이어서 또 맞는 연쇄를 끊어 줍니다.',
    max: '맞는 것이 곧 화면 정리가 됩니다. 탄막이 빽빽한 후반 구간일수록 체감이 큽니다.',
  },
  'field-triage': {
    body: '엘리트를 처치하면 체력을 회복합니다.',
    scale: '회복량 = 4 + Lv',
    values: (lv) => [`엘리트 처치마다 체력 +${fieldTriageHeal(lv)}`],
    lv1: '엘리트를 잡을 때마다 5씩 회복해 긴 런에서 새는 체력을 메웁니다.',
    max: '엘리트 처치가 곧 회복 수단이 됩니다. 엘리트가 자주 나오는 구간에서 오래 버팁니다.',
  },
  'cover-doctrine': {
    body: '벽에 붙어 있는 동안 맞으면 받는 피해가 줄어듭니다. 직전 순간에 벽에 닿아 있었는지로 판정합니다.',
    scale: '받는 피해 −10% − 1%p/Lv',
    values: (lv) => [`벽에 붙어 있을 때 받는 피해 −${ofPct(coverDoctrineCutBp(lv))}`],
    lv1: '벽을 끼고 싸우는 자리 선택에 보상이 붙습니다.',
    max: '벽 근처가 사실상 안전지대가 됩니다. 자리를 잡고 버티는 플레이가 성립합니다.',
  },
  'hazard-adapt': {
    body: '느려지게 만드는 장판이 오히려 빨라지는 장판으로 뒤집히고, 용암 같은 지형 피해도 줄어듭니다. 감속을 무시하는 것이 아니라 반대로 뒤집는 것입니다.',
    scale: '지형 피해 −15% − 1.5%p/Lv · 감속 장판 위 이동 속도 ×1.15 + 0.015/Lv',
    values: (lv) => [
      `지형 피해 −${ofPct(hazardCutBp(lv))}`,
      `감속 장판 위 이동 속도 ${multX(hazardSpeedMultBp(lv))}`,
    ],
    lv1: '장판이 함정이 아니라 이점으로 바뀝니다.',
    max: '지형 장애가 깔린 행성이 오히려 유리한 무대가 됩니다.',
  },
  'sustain-field': {
    body: '생존 액티브가 지속되는 동안 젬을 끌어당기는 범위가 넓어지고 이동 감속을 받지 않습니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 감속을 아예 받지 않는 것 이상은 없기 때문입니다.',
    values: () => ['액티브 지속 중 젬 흡인 범위 확대 · 감속 무시'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'last-rites': {
    body: '내 체력이 30% 이하인 동안, 정조준 탄이 체력이 얼마 남지 않은 적을 즉시 처치합니다.',
    scale: '즉시 처치 기준 = 대상 최대 체력의 5% + 0.5%p/Lv (내 체력 30% 이하일 때만)',
    values: (lv) => [
      `즉시 처치 기준 = 대상 최대 체력의 ${ofPct(lastRitesThresholdBp(lv))}`,
      '조건: 내 체력 30% 이하',
    ],
    lv1: '위기에 몰렸을 때 마무리가 빨라져 반격할 틈이 생깁니다.',
    max: '체력이 낮은 상태 자체가 처형 상태가 됩니다. 위험을 감수하는 빌드의 중심축입니다.',
  },
  'combo-shield': {
    body: '맞을 때 콤보 스택을 소모해 피해를 대신 막아 냅니다. 또 정조준 볼리를 쏘면 콤보가 끊기기까지의 시간이 늘어납니다.',
    scale: '콤보 1스택이 막아 내는 피해 = 3 + 40×Lv/(Lv+20) (Lv20 = 23 · 아무리 올려도 43 근처)',
    values: (lv) => [`콤보 1스택이 막아 내는 피해 ${comboAbsorbPerStack(lv)}`],
    lv1: '콤보를 쌓는 플레이가 그대로 방어가 됩니다.',
    max: '콤보를 높게 유지하고 있으면 피격 한 번을 통째로 지웁니다.',
  },
  'expiry-stasis': {
    body: '생존 액티브가 끝나는 순간 주변 적의 움직임이 멈춥니다. 액티브가 끝나는 시점이 오히려 공격 기회가 됩니다.',
    scale: '정지 45 + 5×Lv 틱 · 범위 160 + 12×Lv',
    values: (lv) => [`정지 ${ticks(expiryStasisTicks(lv))}`, `범위 ${expiryStasisRadius(lv)}`],
    lv1: '액티브가 끝나도 손해가 없습니다 — 빠져나올 틈이 생깁니다.',
    max: '액티브 종료가 곧 광역 제어가 됩니다. 범위가 화면 절반에 가깝습니다.',
  },
  'hull-accretion': {
    body: `런에서 모은 경험치가 ${HULL_XP_THRESHOLD} 씩 쌓일 때마다 최대 체력이 늘어납니다. 늘어난 체력은 그 런이 끝날 때까지 유지됩니다. 한 번에 여러 번 넘겼다면 넘긴 횟수만큼 늘어납니다.`,
    scale: `경험치 ${HULL_XP_THRESHOLD} 마다 최대 체력 + (2 + 24×Lv/(Lv+28)) (Lv20 = 12 · 아무리 올려도 26 근처)`,
    values: (lv) => [
      `경험치 ${HULL_XP_THRESHOLD} 마다 최대 체력 +${hullGrantHp(lv)}`,
      `경험치 4000 까지 모으면 누적 +${hullGrantHp(lv) * 10}`,
    ],
    lv1: '런이 길어질수록 조용히 단단해집니다.',
    max: '후반 구간의 체력이 초반의 두 배를 넘습니다. 오래 끄는 런에 특화된 성장축입니다.',
  },

  // ── 기동 ────────────────────────────────────────────────────────────────
  'inertia-burst': {
    body: '기동 액티브를 쓰면 출발한 자리에 폭발이 남고 그 주변 적탄이 지워집니다. 2단 도약이어도 출발한 자리는 하나뿐이라 폭발도 한 번만 일어납니다.',
    scale: '폭발 범위 120 + 10×Lv · 폭발 피해 20 + 4×Lv',
    values: (lv) => [`폭발 범위 ${inertiaBurstRadius(lv)}`, `폭발 피해 ${inertiaBurstDamage(lv)}`],
    lv1: '빠져나오면서 동시에 뒤를 정리합니다.',
    max: '도주기가 광역 폭딜이 됩니다. 포위를 뚫고 나오는 수단이 됩니다.',
  },
  'thrust-wake': {
    body: `대시할 때 대시한 방향으로 제자리에 멈춰 있는 탄을 줄지어 깔아 둡니다. 이 탄은 날아가지 않고 그 자리에 남습니다. 탄 사이 간격은 ${THRUST_WAKE_SPACING} 으로 고정입니다.`,
    scale: '개수 2 + ⌊Lv/4⌋ · 1발 피해 10 + 3×Lv · 지속 60 + 4×Lv 틱',
    values: (lv) => [
      `멈춘 탄 ${thrustWakeCount(lv)}발 · 간격 ${THRUST_WAKE_SPACING}`,
      `1발 ${thrustWakeDamage(lv)} 피해 · 지속 ${ticks(thrustWakeLife(lv))}`,
      `대시 한 번에 최대 ${thrustWakeCount(lv) * thrustWakeDamage(lv)} 피해`,
    ],
    lv1: '대시한 경로가 지뢰밭이 됩니다 — 뒤쫓아 오는 적에게 그대로 꽂힙니다.',
    max: '대시를 돌릴수록 화면에 멈춘 탄이 쌓입니다. 지역을 장악하는 빌드가 됩니다.',
  },
  'gem-route': {
    body: '젬을 주울 때마다 대시 쿨다운이 즉시 줄어듭니다.',
    scale: '젬 1개당 감소 = 2 + ⌊Lv/2⌋ 틱',
    values: (lv) => [
      `젬 1개당 대시 쿨다운 −${gemRouteCut(lv)}틱`,
      `젬 ${Math.ceil(BASE_DASH_CD / gemRouteCut(lv))}개면 대시 한 번 분량(기본 ${BASE_DASH_CD}틱)`,
    ],
    lv1: '젬을 줍는 동선이 그대로 대시 자원이 됩니다.',
    max: '젬 4개면 대시가 다시 찹니다 — 사실상 끊이지 않고 대시할 수 있습니다.',
  },
  slipstream: {
    body: '젬을 끌어당기는 범위가 진행 방향으로 길어집니다. 옆과 뒤는 그대로라, 달릴수록 앞쪽만 넓어집니다.',
    scale: '진행 방향 앞쪽 흡인 범위 ×1.30 + 0.02/Lv',
    values: (lv) => [`진행 방향 앞쪽 흡인 범위 ${multX(slipstreamExtMultBp(lv))}`],
    lv1: '달리면서 줍는 양이 늘어납니다.',
    max: '앞쪽 범위가 1.7배가 됩니다 — 움직이기만 해도 젬이 빨려 듭니다.',
  },
  'wall-kick': {
    body: '벽을 타고 미끄러진 직후에 대시하면 무적 시간이 늘어납니다. 벽에 닿아 있기만 해서는 안 되고 직전에 미끄러지고 있어야 합니다. 대시 거리는 달라지지 않고, 늘어나는 것은 무적 시간뿐입니다.',
    scale: '추가 무적 시간 = 2 + ⌊Lv/4⌋ 틱 (벽에서 대시할 때만)',
    values: (lv) => [`벽에서 대시할 때 무적 +${wallKickIframes(lv)}틱`],
    lv1: '벽을 낀 대시가 더 안전해집니다.',
    max: '벽을 낀 대시로 탄막을 뚫고 지나갈 수 있게 됩니다.',
  },
  'dash-purge': {
    body: '대시할 때 주변 적탄이 지워지고, 그 범위 안의 적이 냉기를 입어 느려집니다.',
    scale: '적탄 소거·냉기 범위 = 150 + 10×Lv',
    values: (lv) => [`대시 시 적탄 소거·냉기 범위 ${dashPurgeRadius(lv)}`],
    lv1: '대시 한 번이 탄막 청소이자 감속이 됩니다.',
    max: '범위가 350까지 넓어져 대시 경로 주변이 통째로 비워집니다.',
  },
  'signal-chaser': {
    body: '에코나 조우가 진행 중인 동안 대시 쿨다운이 절반이 되고, 안정화를 끝내면 쿨다운이 전부 사라집니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 절반과 전액 환급 이상은 없기 때문입니다.',
    values: () => ['에코·조우 진행 중 대시 쿨다운 절반', '안정화 완수 시 대시 쿨다운 전액 환급'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'vault-shot': {
    body: '2단 도약의 두 도약 사이에 조준 방향으로 정조준 볼리가 한 번 자동으로 나갑니다. 이 볼리는 주무기 쿨다운을 쓰지 않습니다.',
    scale: '자동 볼리 피해 = 본래 볼리의 60% + 3%p/Lv',
    values: (lv) => [`자동 볼리 피해 = 본래 볼리의 ${ofPct(vaultShotBp(lv))}`],
    lv1: '2단 도약에 볼리가 하나 공짜로 붙습니다. 피해는 본래 볼리의 63% 입니다.',
    max: '도약 중에 나가는 볼리가 본래 볼리보다 강해집니다. 움직이는 것 자체가 화력이 됩니다.',
  },
  'ram-maneuver': {
    body: '무적 상태인 동안에는 몸으로 부딪히는 관계가 뒤집혀, 닿은 적이 피해를 입습니다.',
    scale: '부딪힌 적이 받는 피해 = 10 + 3×Lv',
    values: (lv) => [`무적 중 부딪힌 적이 받는 피해 ${ramManeuverDamage(lv)}`],
    lv1: '대시로 적을 뚫고 지나가면서 긁습니다.',
    max: '대시가 돌격기가 됩니다 — 밀집한 대열을 관통하며 전부 때립니다.',
  },
  'twin-thruster': {
    body: '대시를 두 번까지 모아 둘 수 있게 됩니다. 두 번째 몫은 따로, 더 느리게 채워집니다. 쓸 때는 평소 대시부터 나갑니다.',
    scale: '두 번째 대시 재충전 = 240 + ⌊4000/(Lv+5)⌋ 틱 (Lv1 = 906 · Lv20 = 400 · 아무리 올려도 240 근처)',
    values: (lv) => [`두 번째 대시 재충전 ${ticks(twinRechargeTicks(lv))}`],
    lv1: '대시를 연달아 두 번 쓸 수 있습니다. 다만 두 번째는 15초에 한 번꼴입니다.',
    max: '두 번째 대시가 6.7초마다 돌아옵니다. 회피 실수 한 번을 덮을 여유가 상시 생깁니다.',
  },
};
