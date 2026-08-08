/**
 * 해츨링 30스킬 상세 — 수치는 `src/sim/skills/hatchlingScaling.ts` 가 낸다.
 *
 * 이 표는 **수치를 담지 않는다.** 근거는 `../skillDetail.ts` 머리 참조.
 *
 * ## 이 기체를 설명할 때 반복해서 나오는 말
 * **병아리** — 적을 일정 수 처치하면 출격하는 소환물이다. 스스로 쏘고, 수명이 다하면
 * 사라진다. **부화 요구치** — 다음 병아리가 나오기까지 필요한 처치 수. **동시 출격 상한** —
 * 동시에 살아 있을 수 있는 병아리 수다.
 */

import {
  BROOD_MAX_DRONES,
  VETERAN_SHOT_CAP,
  HATCH_THRESHOLD_FLOOR,
  earlyHatchCut,
  twinHatchPeriod,
  farewellVolleyCount,
  farewellVolleyDamage,
  targetShareBonus,
  volleyResonanceCut,
  hatchShockwaveRadius,
  hatchShockwaveDamage,
  veteranPerShot,
  overcrowdCut,
  matriarchDamagePerDeficit,
  matriarchLifePerDeficit,
  gemFetchRadius,
  eggshellGemCount,
  piggybackHalfWidth,
  nestRecallCut,
  expeditionRange,
  nestBeaconRadius,
  eggBankCap,
  sacrificeAbsorb,
  crisisScatterDash,
  crisisScatterClear,
  warmthPeriodTicks,
  broodingRadius,
  alarmChirpExtraTicks,
  eggMembraneIframes,
  rebirthHpPerChick,
  rebirthCapBp,
  featherBulwarkCost,
  fledgeNestHp,
  expandedNestPenalty,
} from '../../sim/skills/hatchlingScaling.js';
import { ofPct, ticks, NO_SCALE_LV1, NO_SCALE_MAX, type SkillDetail } from './format.js';

/** `+15%` 처럼 **비율**(0.15)을 퍼센트로. 이 기체는 bp 가 아니라 배수로 적힌 축이 있다. */
function ratioPct(r: number): string {
  const pct = r * 100;
  return `+${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

export const HATCHLING_SKILL_DETAIL: Readonly<Record<string, SkillDetail>> = {
  // ── 산란 ────────────────────────────────────────────────────────────────
  'early-hatch': {
    body: `병아리를 부화시키는 데 필요한 처치 수가 줄어듭니다. 다만 아무리 줄여도 ${HATCH_THRESHOLD_FLOOR}처치 아래로는 내려가지 않습니다.`,
    scale: `요구치 감소 = 1 + ⌊Lv/5⌋ (바닥 ${HATCH_THRESHOLD_FLOOR}처치)`,
    values: (lv) => [`부화 요구 처치 −${earlyHatchCut(lv)}`],
    lv1: '같은 처치량으로 병아리가 더 자주 나옵니다.',
    max: '요구치가 5 줄어 병아리 회전이 눈에 띄게 빨라집니다.',
  },
  'twin-hatch': {
    body: '몇 번째 출격마다 병아리가 한 기가 아니라 두 기 동시에 나옵니다.',
    scale: '쌍둥이 주기 = 2 + 18/(Lv+2) 번째 출격마다',
    values: (lv) => [`${twinHatchPeriod(lv)}번째 출격마다 병아리 2기`],
    lv1: '여덟 번에 한 번은 두 기가 함께 나옵니다.',
    max: '세 번에 한 번꼴로 쌍둥이가 나옵니다.',
  },
  'farewell-volley': {
    body: '병아리가 사라지는 순간 그 자리에서 부채꼴로 작별 사격을 남깁니다. 수명이 다하는 것이 손해로만 끝나지 않습니다.',
    scale: '작별탄 수 3 + ⌊Lv/4⌋ · 1발 피해 6 + 2×Lv',
    values: (lv) => [
      `작별탄 ${farewellVolleyCount(lv)}발`,
      `1발 ${farewellVolleyDamage(lv)} 피해 · 합계 ${farewellVolleyCount(lv) * farewellVolleyDamage(lv)}`,
    ],
    lv1: '병아리가 죽으면서 마지막 한 방을 남깁니다.',
    max: '병아리가 사라질 때마다 8발짜리 부채꼴이 터집니다.',
  },
  'target-share': {
    body: '병아리가 내가 조준한 적을 우선해서 공격하고, 병아리 탄이 그 적을 맞힌 직후 한동안 그 적에게 주는 병아리 피해가 커집니다.',
    scale: '공유 표적 피해 +15% + 2%p/Lv',
    values: (lv) => [`공유 표적에 대한 병아리 피해 ${ratioPct(targetShareBonus(lv))}`],
    lv1: '병아리가 흩어지지 않고 내가 보는 적을 같이 칩니다.',
    max: '집중 사격 시 병아리 피해가 55% 오릅니다. 보스전에서 특히 큽니다.',
  },
  'volley-resonance': {
    body: '내가 주무기를 쏠 때마다 살아 있는 병아리 전원의 발사 쿨다운이 함께 깎입니다. 내 사격 속도가 병아리 사격 속도가 됩니다.',
    scale: '내 발사 1회당 병아리 쿨다운 −1 − ⌊Lv/5⌋ 틱',
    values: (lv) => [`내 발사 1회당 병아리 쿨다운 −${volleyResonanceCut(lv)}틱`],
    lv1: '병아리가 내 리듬을 따라 쏘기 시작합니다.',
    max: '연사 무기를 쓰면 병아리가 거의 쉬지 않고 쏩니다.',
  },
  'hatch-shockwave': {
    body: '병아리가 출격하는 지점에서 충격파가 터져 광역 피해를 주고 적탄을 지웁니다.',
    scale: '충격파 범위 110 + 9×Lv · 피해 12 + 3×Lv',
    values: (lv) => [
      `충격파 범위 ${hatchShockwaveRadius(lv)}`,
      `충격파 피해 ${hatchShockwaveDamage(lv)}`,
    ],
    lv1: '병아리가 나올 때마다 주변이 한 번 정리됩니다.',
    max: '출격 자체가 광역기가 됩니다. 부화가 잦을수록 이득이 큽니다.',
  },
  'veteran-chick': {
    body: `병아리는 쏘면 쏠수록 그 개체의 탄이 강해집니다. ${VETERAN_SHOT_CAP}발까지 세고 그 이상은 더 강해지지 않습니다. 오래 살아남은 병아리일수록 셉니다.`,
    scale: `1발당 피해 +2% + 0.2%p/Lv (최대 ${VETERAN_SHOT_CAP}발까지 누적)`,
    values: (lv) => [
      `1발당 피해 ${ratioPct(veteranPerShot(lv))}`,
      `${VETERAN_SHOT_CAP}발까지 쏘면 최대 ${ratioPct(veteranPerShot(lv) * VETERAN_SHOT_CAP)}`,
    ],
    lv1: '오래 사는 병아리가 점점 아파집니다.',
    max: '만렙 병아리는 마지막에 세 배 가까운 피해로 쏩니다. 수명을 늘리는 스킬과 함께 가면 큽니다.',
  },
  'brood-assault': {
    body: '산란 액티브를 쓰면 살아 있는 병아리 전원이 쿨다운을 무시하고 그 자리에서 즉시 일제 사격합니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 전원 즉시 사격 이상은 없기 때문입니다.',
    values: () => ['액티브 발동 시 병아리 전원 즉시 일제 사격'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'overcrowd-instinct': {
    body: '동시 출격 상한이 꽉 차서 다음 부화가 보류되는 동안, 살아 있는 병아리 전원의 발사 간격이 짧아집니다. 자리가 없어 노는 시간을 화력으로 바꿉니다.',
    scale: '보류 중 병아리 발사 간격 −2 − ⌊Lv/4⌋ 틱',
    values: (lv) => [`보류 중 병아리 발사 간격 −${overcrowdCut(lv)}틱`],
    lv1: '만석일 때 병아리가 더 빨리 쏩니다.',
    max: '만석 유지가 곧 화력 극대화가 됩니다.',
  },
  'matriarch-launch': {
    body: `동시 출격 상한이 1 줄어드는 대신, 줄어든 만큼 나오는 병아리의 탄 피해와 수명이 강해집니다. 상한을 되돌리는 스킬을 함께 찍으면 결손이 사라지고, 그러면 강화도 함께 사라집니다.`,
    scale: '결손 1당 피해 +30% + 3%p/Lv · 수명 +60 + 10×Lv 틱',
    values: (lv) => [
      `결손 1당 병아리 피해 ${ratioPct(matriarchDamagePerDeficit(lv))}`,
      `결손 1당 병아리 수명 +${matriarchLifePerDeficit(lv)}틱`,
      `동시 출격 상한 ${BROOD_MAX_DRONES} → ${BROOD_MAX_DRONES - 1}`,
    ],
    lv1: '수를 줄이고 질을 올리는 방향으로 바꿉니다.',
    max: '한 기가 세 기 몫을 합니다. 상한을 늘리는 확장 둥지와는 서로 상쇄되므로 둘 중 하나만 넣는 편이 낫습니다.',
  },

  // ── 양육 ────────────────────────────────────────────────────────────────
  'gem-fetch': {
    body: '병아리 주변에도 자석장이 서서, 병아리 근처의 젬을 나에게 끌어옵니다. 병아리가 흩어져 있을수록 넓게 훑습니다.',
    scale: '병아리 자석장 범위 = 100 + 10×Lv',
    values: (lv) => [`병아리 주변 자석장 범위 ${gemFetchRadius(lv)}`],
    lv1: '병아리가 젬을 대신 물어옵니다.',
    max: '병아리 넷이 각각 넓은 자석장을 세워 화면 대부분을 덮습니다.',
  },
  'eggshell-nutrients': {
    body: '병아리가 출격하는 순간 깨진 알껍질이 소형 경험치 젬으로 흩어집니다.',
    scale: '알껍질 젬 수 = 2 + ⌊Lv/5⌋',
    values: (lv) => [`출격당 알껍질 젬 ${eggshellGemCount(lv)}개`],
    lv1: '부화할 때마다 경험치가 조금씩 딸려옵니다.',
    max: '출격마다 6개씩 나와 성장 속도가 눈에 띄게 빨라집니다.',
  },
  piggyback: {
    body: '대시 경로 위에 있던 병아리를 업어서 도착 지점 주위로 함께 옮깁니다. 병아리를 두고 이동하지 않아도 됩니다.',
    scale: '업어 나르는 폭(중심에서 좌우) = 90 + 8×Lv',
    values: (lv) => [`업어 나르는 폭 좌우 ${piggybackHalfWidth(lv)}`],
    lv1: '대시할 때 병아리가 따라옵니다.',
    max: '대시 한 번이 병아리 전원을 함께 옮깁니다.',
  },
  'nest-recall': {
    body: '양육 액티브를 쓰면 살아 있는 병아리 전원이 도착 지점 주위로 재배치되고, 그 직후 잠깐 연사 창을 얻습니다.',
    scale: '연사 창 동안 병아리 발사 간격 −3 − ⌊Lv/5⌋ 틱',
    values: (lv) => [`연사 창 동안 병아리 발사 간격 −${nestRecallCut(lv)}틱`],
    lv1: '흩어진 병아리를 모아 한 번에 퍼붓습니다.',
    max: '재배치 직후가 그 런의 화력 정점이 됩니다.',
  },
  'egg-roll': {
    body: '대시할 때마다 부화 적립이 1 전진하고, 대시 경로 위의 젬을 즉시 주워 담습니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 대시 1회에 적립 1이 전부이기 때문입니다.',
    values: () => ['대시 1회당 부화 적립 +1 · 경로 위 젬 즉시 수거'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'shared-warmth': {
    body: '콤보가 유지되는 동안 병아리의 수명이 절반 속도로 줄어듭니다. 콤보를 이어 가면 병아리가 오래 삽니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 절반 이상은 없기 때문입니다.',
    values: () => ['콤보 유지 중 병아리 수명 감소 속도 절반'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'expedition-hatch': {
    body: '병아리가 내 곁이 아니라 가장 가까운 젬의 위치에서 부화합니다. 그 젬이 너무 멀면 평소대로 곁에서 나옵니다.',
    scale: '인정 거리 = 400 + 40×Lv',
    values: (lv) => [`젬 위치 부화 인정 거리 ${expeditionRange(lv)}`],
    lv1: '병아리가 젬이 있는 쪽에서 나와 알아서 벌어집니다.',
    max: '화면 반대편 젬에서도 부화해 전선을 넓게 잡습니다.',
  },
  'migration-instinct': {
    body: '병아리가 제자리에 머무는 대신 나를 따라 걸어옵니다. 멀어지면 알아서 쫓아옵니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 따라오는가 아닌가만 있기 때문입니다.',
    values: () => ['병아리가 정지형에서 추종형으로 전환'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'nest-beacon': {
    body: '병아리가 사라진 자리에 자석 버프를 내는 표식이 남습니다. 병아리가 죽은 자리가 수거 지점이 됩니다.',
    scale: `표식 자석 범위 = ${nestBeaconRadius(0)} + 4×Lv`,
    values: (lv) => [`표식 자석 범위 ${nestBeaconRadius(lv)}`],
    lv1: '병아리가 사라진 자리로 젬이 모입니다.',
    max: '표식 하나가 넓은 수거 지대를 만듭니다.',
  },
  'egg-bank': {
    body: '동시 출격 상한이 꽉 차 부화가 보류된 동안의 처치가 버려지지 않고 저금됩니다. 자리가 나면 다음 부화 요구치에서 그만큼 깎입니다.',
    scale: '저금 상한 = 8 + 40×Lv/(Lv+16)',
    values: (lv) => [`저금 상한 ${eggBankCap(lv)}처치`],
    lv1: '만석 중의 처치가 헛되지 않습니다.',
    max: '만석에서 30처치까지 모아 뒀다가 자리가 나면 곧바로 부화합니다.',
  },

  // ── 보호 ────────────────────────────────────────────────────────────────
  'escort-sacrifice': {
    body: '체력이 깎이는 피격이 들어오면 병아리 한 기가 대신 사라지면서 피해의 일부를 흡수합니다. 병아리가 있는 동안은 몸이 하나 더 있는 셈입니다.',
    scale: '흡수량 = 8 + 60×Lv/(Lv+18)',
    values: (lv) => [`병아리 1기 소멸당 피해 ${sacrificeAbsorb(lv)} 흡수`],
    lv1: '병아리가 대신 맞아 줍니다.',
    max: '병아리 한 기가 큰 한 방을 통째로 먹어 줍니다.',
  },
  'crisis-scatter': {
    body: '체력이 깎이는 피격을 받으면 병아리 전원이 피격 방향으로 산개 돌진하며 지나가는 경로의 적탄을 지웁니다.',
    scale: '돌진 거리 90 + 6×Lv · 경로 소거 범위 70 + 4×Lv',
    values: (lv) => [
      `산개 돌진 거리 ${crisisScatterDash(lv)}`,
      `경로 적탄 소거 범위 ${crisisScatterClear(lv)}`,
    ],
    lv1: '맞는 순간 병아리가 흩어지며 탄막을 갈라 줍니다.',
    max: '피격 한 번이 넓은 통로를 뚫어 줍니다.',
  },
  'full-nest-warmth': {
    body: '동시 출격 상한이 꽉 차 있는 동안 주기적으로 체력이 회복됩니다. 병아리를 가득 유지하는 것이 곧 회복입니다.',
    scale: '회복 주기 = 60 + 4800/(Lv+20) 틱마다 1',
    values: (lv) => [
      `만석 유지 중 ${ticks(warmthPeriodTicks(lv))}마다 체력 +1`,
      `1분이면 약 ${Math.floor(3600 / warmthPeriodTicks(lv))} 회복`,
    ],
    lv1: '만석을 지키면 체력이 조금씩 돌아옵니다.',
    max: '회복 주기가 3초까지 줄어 만석 유지가 확실한 유지력이 됩니다.',
  },
  'brooding-formation': {
    body: '보호 액티브가 지속되는 동안 병아리 전원이 사격을 멈추고 내 주위에 밀착해 적탄을 몸으로 막습니다. 화력을 내주고 방어를 얻습니다.',
    scale: '밀착 반경 = 60 + 5×Lv',
    values: (lv) => [`밀착 반경 ${broodingRadius(lv)}`],
    lv1: '병아리가 방패가 됩니다.',
    max: '넓게 둘러싸 사방에서 오는 탄을 막아 줍니다.',
  },
  'alarm-chirp': {
    body: '병아리의 탄이 적을 맞히면 그 적에게 냉기 감속을 겁니다. 병아리가 많을수록 화면 전체가 느려집니다.',
    scale: '냉기 지속 = 기본 지속 + 6×Lv 틱',
    values: (lv) => [`냉기 지속이 기본보다 +${alarmChirpExtraTicks(lv)}틱 길어짐`],
    lv1: '병아리 탄이 적을 붙잡아 둡니다.',
    max: '병아리 사격만으로 적이 거의 상시 느려집니다.',
  },
  'egg-membrane': {
    body: '병아리가 출격하는 순간 모선이 짧은 무적 시간을 얻습니다. 부화 타이밍이 곧 회피 기회가 됩니다.',
    scale: '무적 시간 = 20 + 3×Lv 틱',
    values: (lv) => [`출격 시 무적 ${ticks(eggMembraneIframes(lv))}`],
    lv1: '부화할 때 한 번 흘려 넘길 수 있습니다.',
    max: '부화마다 1.3초 무적이라 부화를 회피기처럼 쓸 수 있습니다.',
  },
  'rebirth-hatch': {
    body: '치명적인 피격이 들어오면 살아 있는 병아리 전원을 소멸시키고, 그 수에 비례한 체력을 남긴 채 살아남습니다. 남길 수 있는 체력에는 상한이 있습니다.',
    scale: '병아리 1기당 4 + 16×Lv/(Lv+12) · 상한 = 최대 체력의 30% + 1%p/Lv',
    values: (lv) => [
      `병아리 1기당 잔존 체력 ${rebirthHpPerChick(lv)}`,
      `${BROOD_MAX_DRONES}기면 ${rebirthHpPerChick(lv) * BROOD_MAX_DRONES}`,
      `잔존 상한 = 최대 체력의 ${ofPct(rebirthCapBp(lv))}`,
    ],
    lv1: '병아리를 데리고 있으면 한 번은 죽지 않습니다.',
    max: '만석으로 버티면 최대 체력의 절반을 남기고 살아납니다.',
  },
  'feather-bulwark': {
    body: '적탄이 병아리에 닿으면 지워지는 대신 그 병아리의 수명이 깎입니다. 병아리가 탄받이가 되고, 수명이 그 대가입니다.',
    scale: '탄 1발당 깎이는 수명 = 12 − ⌊Lv/2⌋ 틱 (최소 1)',
    values: (lv) => [`적탄 1발당 병아리 수명 −${featherBulwarkCost(lv)}틱`],
    lv1: '병아리가 탄을 대신 받아 냅니다.',
    max: '탄을 받아도 수명이 거의 안 깎여 병아리가 오래 버팁니다.',
  },
  'fledge-nest': {
    body: '수명이 자연히 다한 병아리는 그 자리에 부술 수 있는 낮은 체력의 둥지벽을 남깁니다. 병아리가 죽은 자리가 엄폐물이 됩니다.',
    scale: '둥지벽 체력 = 8 + 2×Lv',
    values: (lv) => [`둥지벽 체력 ${fledgeNestHp(lv)}`],
    lv1: '병아리 자리에 잠깐 벽이 섭니다.',
    max: '둥지벽이 제법 버텨 실제 엄폐물 역할을 합니다.',
  },
  'expanded-nest': {
    body: `동시 출격 상한이 1 늘어나는 대신 부화에 필요한 처치 수가 늘어납니다. 레벨을 올리면 그 대가가 줄어듭니다.`,
    scale: '요구치 증가 = 6 − ⌊Lv/4⌋ · 상한 +1(고정)',
    values: (lv) => [
      `동시 출격 상한 ${BROOD_MAX_DRONES} → ${BROOD_MAX_DRONES + 1}`,
      `대가: 부화 요구 처치 +${expandedNestPenalty(lv)}`,
    ],
    lv1: '병아리를 한 기 더 데리고 다닐 수 있지만 부화가 느려집니다.',
    max: '대가가 1까지 줄어 사실상 공짜로 한 기를 더 얻습니다.',
  },
};
