/**
 * 버블 30스킬 상세 — 수치는 `src/sim/skills/bubbleScaling.ts` 가 낸다.
 *
 * 이 표는 **수치를 담지 않는다.** 근거는 `../skillDetail.ts` 머리 참조.
 *
 * ## 이 기체를 설명할 때 반복해서 나오는 말
 * **막** — 피해를 대신 먹는 보호막이다. 내구가 다하면 **파열**하면서 주변을 밀어내고, 그
 * 뒤에는 재생 타이머가 돌아 다시 선다. 스킬 대부분이 "막이 서 있는가 / 없는가 / 지금
 * 파열하는가" 중 하나를 조건으로 쓴다.
 */

import {
  burstWarheadDamage,
  pressureTransferBp,
  burstScatterCount,
  burstScatterDamage,
  crushImpactBp,
  fullFilmDamageMultBp,
  fireRecondenseStep,
  staticBurstChainDamage,
  residueMineCount,
  residueMineDamage,
  popTuningExtraBp,
  chainPressurePerKill,
  chainPressureCap,
  reverseCurrentRadiusMultBp,
  tensionWindowTicks,
  tensionBonusBp,
  blinkMagnetTicks,
  blinkMagnetMultBp,
  bareHullSpeedMultBp,
  prismPerStackBp,
  burstPropulsionRefund,
  remoteForagerBp,
  departureRippleRadius,
  bareHullCurrentBp,
  bareHullPullStep,
  earlyCondenseTicks,
  recondensePeriodTicks,
  reflectiveFilmRadius,
  pressureVentPushBp,
  burstPhaseExtraIframes,
  filmOfferingBp,
  wallEchoMultBp,
  hydrophobicEffBp,
  lastBubbleShieldBp,
} from '../../sim/skills/bubbleScaling.js';
import {
  incPct,
  multX,
  ofPct,
  ticks,
  NO_SCALE_LV1,
  NO_SCALE_MAX,
  type SkillDetail,
} from './format.js';

export const BUBBLE_SKILL_DETAIL: Readonly<Record<string, SkillDetail>> = {
  // ── 파열 ────────────────────────────────────────────────────────────────
  'burst-warhead': {
    body: '막이 터질 때 밀어내기만 하던 파열이 범위 안의 적에게 즉발 폭발 피해까지 줍니다. 막이 깨지는 순간이 반격이 됩니다.',
    scale: '파열 폭발 피해 = 18 + 4×Lv',
    values: (lv) => [`파열 폭발 피해 ${burstWarheadDamage(lv)}`],
    lv1: '막이 터질 때 주변이 함께 깎입니다.',
    max: '파열 한 번이 확실한 광역 한 방이 됩니다. 막을 자주 터뜨리는 빌드일수록 이득입니다.',
  },
  'pressure-transfer': {
    body: '막이 서 있는 동안, 탄속이 기준보다 빠른 만큼이 쏘는 순간 피해로 바뀝니다. 탄속을 올리는 장비가 그대로 화력이 됩니다.',
    scale: '전환 = 기준 초과 탄속의 20% + 2%p/Lv',
    values: (lv) => [`전환 = 기준 초과 탄속의 ${ofPct(pressureTransferBp(lv))}`],
    lv1: '탄속 장비가 피해로도 계산되기 시작합니다.',
    max: '초과 탄속의 60%가 피해가 됩니다. 탄속 특화 빌드의 중심축이 됩니다.',
  },
  'burst-scatter': {
    body: '막이 터지는 순간 기체를 중심으로 사방에 거품탄이 뿌려집니다.',
    scale: '거품탄 수 6 + ⌊Lv/3⌋ · 1발 피해 8 + 2×Lv',
    values: (lv) => [
      `거품탄 ${burstScatterCount(lv)}발`,
      `1발 ${burstScatterDamage(lv)} 피해 · 합계 ${burstScatterCount(lv) * burstScatterDamage(lv)}`,
    ],
    lv1: '파열이 사방 산탄으로 바뀝니다.',
    max: '파열 한 번이 12발짜리 전방위 일제사가 됩니다.',
  },
  'crush-impact': {
    body: '파열에 밀려난 적이 벽에 막히면, 밀리지 못한 만큼이 충돌 피해가 됩니다. 벽을 등지고 싸울 때 이득이 큽니다.',
    scale: '충돌 피해 = 막힌 변위의 15% + 2%p/Lv',
    values: (lv) => [`충돌 피해 = 막힌 변위의 ${ofPct(crushImpactBp(lv))}`],
    lv1: '벽에 처박힌 적이 추가로 아파집니다.',
    max: '좁은 통로에서 파열 한 번이 벽에 낀 적을 통째로 지웁니다.',
  },
  'full-film-pierce': {
    body: '막의 내구가 만재인 동안 쏘는 볼리가 관통과 피해를 더 얻습니다. 막을 아껴 두는 플레이에 보상이 붙습니다.',
    scale: '만재 중 볼리 피해 ×1.06 + 0.015/Lv',
    values: (lv) => [`만재 중 볼리 피해 ${multX(fullFilmDamageMultBp(lv))}`],
    lv1: '막을 채워 두면 사격이 조금 세집니다.',
    max: '만재 유지가 곧 화력 유지가 됩니다. 파열 축과는 방향이 반대라 함께 넣기 전에 따져야 합니다.',
  },
  'fire-recondense': {
    body: '막이 없는 동안 주무기가 명중할 때마다 재생 타이머가 앞당겨집니다. 공격이 곧 막 복구가 됩니다.',
    scale: '명중 1회당 재생 타이머 +1 + ⌊Lv/5⌋ 틱',
    values: (lv) => [`명중 1회당 재생 +${fireRecondenseStep(lv)}틱`],
    lv1: '막이 깨져도 쏘고 있으면 빨리 돌아옵니다.',
    max: '명중 1회가 재생 5틱분입니다. 다탄 무기면 막이 순식간에 돌아옵니다.',
  },
  'static-burst': {
    body: '막이 터지는 순간 범위 안의 적 최대 3기에게 전격 연쇄를 겁니다.',
    scale: '연쇄 피해 = 12 + 3×Lv (최대 3기)',
    values: (lv) => [`연쇄 피해 ${staticBurstChainDamage(lv)}`, '대상 최대 3기'],
    lv1: '파열이 주변으로 튀는 전기까지 붙습니다.',
    max: '파열마다 3기에게 72씩 꽂힙니다.',
  },
  'residue-mines': {
    body: '막이 터진 자리 둘레에 정지 거품 기뢰가 링 모양으로 남습니다. 기뢰는 그 자리에 머물며 지나가는 적을 칩니다.',
    scale: '기뢰 수 4 + ⌊Lv/4⌋ · 1개 피해 10 + 2×Lv',
    values: (lv) => [
      `기뢰 ${residueMineCount(lv)}개`,
      `1개 ${residueMineDamage(lv)} 피해`,
    ],
    lv1: '파열 자리가 잠시 지뢰밭이 됩니다.',
    max: '파열마다 9개짜리 기뢰 링이 깔립니다. 지역을 잠그는 빌드가 됩니다.',
  },
  'pop-tuning': {
    body: '파열 액티브 고급판이 막 내구를 탄약으로 바꿀 때, 환산 효율이 올라 탄이 더 많이 나갑니다.',
    scale: '환산 탄수 +4% + 1%p/Lv',
    values: (lv) => [`내구→탄약 환산 탄수 ${incPct(popTuningExtraBp(lv))}`],
    lv1: '같은 내구로 탄이 조금 더 나갑니다.',
    max: '환산 탄수가 24% 늘어납니다. 내구를 많이 쌓아 둘수록 차이가 커집니다.',
  },
  'chain-pressure': {
    body: '막이 터진 뒤 짧은 창 안에 처치한 수만큼 다음 막의 내구가 보강됩니다. 보강량에는 상한이 있습니다.',
    scale: '처치 1기당 내구 +2 + ⌊Lv/2⌋ (상한 20 + 3×Lv)',
    values: (lv) => [
      `처치 1기당 다음 막 내구 +${chainPressurePerKill(lv)}`,
      `보강 상한 ${chainPressureCap(lv)}`,
    ],
    lv1: '파열 직후 몰아치면 다음 막이 두꺼워집니다.',
    max: '파열 → 청소 → 더 두꺼운 막의 순환이 성립합니다.',
  },

  // ── 표류 ────────────────────────────────────────────────────────────────
  'reverse-current': {
    body: '막이 터지는 순간 범위 안의 젬을 즉시 거둬들입니다. 파열이 수거 수단이 됩니다.',
    scale: '수거 범위 = 파열 반경 ×1.00 + 0.08/Lv',
    values: (lv) => [`젬 즉시 수거 범위 = 파열 반경 ${multX(reverseCurrentRadiusMultBp(lv))}`],
    lv1: '파열 자리의 젬이 그대로 딸려옵니다.',
    max: '파열 범위의 2.6배까지 훑어 담습니다.',
  },
  'surface-tension-bath': {
    body: '막이 서 있는 동안 젬을 주우면 짧은 창 동안 막의 흡수 효율이 오릅니다. 줍는 동작이 방어가 됩니다.',
    scale: '창 60 + 3×Lv 틱 · 그동안 흡수 효율 ×1.20 + 0.02/Lv',
    values: (lv) => [
      `효율 상승 창 ${ticks(tensionWindowTicks(lv))}`,
      `그동안 막 흡수 효율 ${multX(tensionBonusBp(lv))}`,
    ],
    lv1: '젬을 주울 때마다 막이 잠깐 단단해집니다.',
    max: '젬이 꾸준히 들어오면 흡수 효율이 1.6배로 유지됩니다.',
  },
  'blink-magnetize': {
    body: '표류 액티브로 착지하는 순간 전용 자석 확장 버프가 걸립니다. 일반 자석 강화와 별도로 붙습니다.',
    scale: '지속 90 + 6×Lv 틱 · 자석 범위 ×1.30 + 0.03/Lv',
    values: (lv) => [
      `버프 지속 ${ticks(blinkMagnetTicks(lv))}`,
      `그동안 자석 범위 ${multX(blinkMagnetMultBp(lv))}`,
    ],
    lv1: '도약 후 잠깐 젬을 넓게 빨아들입니다.',
    max: '도약마다 3.5초 동안 자석 범위가 1.9배가 됩니다.',
  },
  'bare-hull-trim': {
    body: '막이 없는 동안 이동 감속을 받지 않고 이동 속도도 빨라집니다. 막이 깨진 시간이 손해로만 남지 않습니다.',
    scale: '막 없을 때 이동 속도 ×1.04 + 0.008/Lv · 감속 면역은 레벨 무관',
    values: (lv) => [
      `막 없을 때 이동 속도 ${multX(bareHullSpeedMultBp(lv))}`,
      '막 없을 때 이동 감속 무시',
    ],
    lv1: '막이 깨진 동안 오히려 잘 움직입니다.',
    max: '막 없는 구간의 이동 속도가 20% 오릅니다. 막을 자주 터뜨리는 빌드와 맞습니다.',
  },
  'prism-resonance': {
    body: '콤보 스택이 그대로 자석 범위에 곱해집니다. 콤보를 이어 갈수록 젬을 넓게 끌어옵니다.',
    scale: '콤보 1스택당 자석 범위 +1.5% + 0.15%p/Lv',
    values: (lv) => [
      `콤보 1스택당 자석 범위 ${incPct(prismPerStackBp(lv))}`,
      `콤보 20스택이면 ${incPct(prismPerStackBp(lv) * 20)}`,
    ],
    lv1: '콤보가 쌓일수록 젬이 잘 붙습니다.',
    max: '콤보 20에서 자석 범위가 세 배 가까이 됩니다.',
  },
  'burst-propulsion': {
    body: '막이 터지는 순간 대시 쿨다운이 환급됩니다. 파열이 이동 자원이 됩니다.',
    scale: '파열 1회당 대시 쿨다운 30 + 5×Lv 틱 환급',
    values: (lv) => [`파열 1회당 대시 쿨다운 −${burstPropulsionRefund(lv)}틱`],
    lv1: '막이 터지면 대시가 곧바로 돌아옵니다.',
    max: '파열 한 번이 대시 두 번분을 환급합니다.',
  },
  'signal-drift': {
    body: '에코나 조우가 진행 중인 동안 막의 재생 타이머가 두 배로 돌고, 안정화를 끝내면 막이 즉시 만재가 됩니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 2배와 즉시 만재 이상은 없기 때문입니다.',
    values: () => ['에코·조우 중 재생 속도 2배', '안정화 완수 시 막 즉시 만재'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'remote-forager': {
    body: '기믹 픽업 3종의 접촉 범위가 자석 범위에 비례해 넓어집니다. 자석을 키우는 스킬과 함께 커집니다.',
    scale: '픽업 접촉 범위 += 자석 범위의 10% + 1%p/Lv',
    values: (lv) => [`픽업 접촉 범위 += 자석 범위의 ${ofPct(remoteForagerBp(lv))}`],
    lv1: '기믹 픽업을 조금 더 멀리서 집습니다.',
    max: '자석 범위의 30%가 더해집니다. 자석 특화 빌드에서 크게 벌어집니다.',
  },
  'departure-ripple': {
    body: '표류 액티브가 출발한 자리에 잔파동이 남습니다. 출발 시점에 막이 서 있었다면 그 범위가 더 커집니다.',
    scale: '잔파동 기본 범위 = 100 + 8×Lv (막이 서 있으면 강화)',
    values: (lv) => [`잔파동 기본 범위 ${departureRippleRadius(lv)}`],
    lv1: '빠져나온 자리에 흔적이 남아 뒤를 칩니다.',
    max: '출발 지점이 넓은 파동 지대가 됩니다.',
  },
  'bare-hull-current': {
    body: '막이 없는 동안 젬 흡인이 빨라지고, 재생이 완료되는 순간 광역 견인 펄스가 한 번 걸립니다.',
    scale: '막 없을 때 흡인 속도 +20% + 3%p/Lv · 재생 완료 펄스 견인 거리 60 + 6×Lv',
    values: (lv) => [
      `막 없을 때 젬 흡인 속도 ${incPct(bareHullCurrentBp(lv))}`,
      `재생 완료 펄스 견인 거리 ${bareHullPullStep(lv)}`,
    ],
    lv1: '막이 깨진 동안에도 젬을 잘 끌어옵니다.',
    max: '막이 돌아올 때마다 화면의 젬을 한 번씩 당겨 옵니다.',
  },

  // ── 응막 ────────────────────────────────────────────────────────────────
  'early-condense': {
    body: '막이 터진 뒤 재생 타이머가 0 이 아니라 미리 앞당겨진 지점에서 시작합니다. 막이 그만큼 빨리 돌아옵니다.',
    scale: '선급 = 300×Lv/(Lv+18) 틱',
    values: (lv) => [`재생 타이머가 ${earlyCondenseTicks(lv)}틱에서 시작`],
    lv1: '파열 후 공백이 조금 짧아집니다.',
    max: '재생의 절반 이상을 건너뛰고 시작합니다.',
  },
  'durability-recondense': {
    body: '막이 서 있는 동안 내구가 주기적으로 1씩 회복됩니다. 막이 깨지기 전에 스스로 메웁니다.',
    scale: '회복 주기 = 6 + ⌊72/(Lv+2)⌋ 틱마다 1',
    values: (lv) => [
      `${ticks(recondensePeriodTicks(lv))}마다 막 내구 +1`,
      `1분이면 약 ${Math.floor(3600 / recondensePeriodTicks(lv))} 회복`,
    ],
    lv1: '막이 천천히 스스로 메워집니다.',
    max: '9틱마다 1씩 차서 웬만한 피해로는 막이 깨지지 않습니다.',
  },
  'reflective-film': {
    body: '막이 피해를 흡수한 순간 주변 적탄을 지웁니다. 맞는 것이 곧 탄막 정리가 됩니다.',
    scale: '적탄 소거 범위 = 80 + 8×Lv',
    values: (lv) => [`흡수 시 적탄 소거 범위 ${reflectiveFilmRadius(lv)}`],
    lv1: '막으로 받아 낼 때 주변 탄이 함께 지워집니다.',
    max: '흡수 한 번이 넓은 범위를 통째로 비웁니다.',
  },
  'pressure-vent': {
    body: '막이 피해를 흡수할 때마다 흡수량에 비례해 주변을 밀어냅니다. 많이 맞을수록 크게 밀어냅니다.',
    scale: '밀어내기 = 흡수량 ×1.20 + 0.15/Lv',
    values: (lv) => [`밀어내기 = 흡수량 ${multX(pressureVentPushBp(lv))}`],
    lv1: '흡수할 때마다 적이 조금씩 밀립니다.',
    max: '한 번 크게 맞으면 주변이 통째로 밀려납니다.',
  },
  'burst-phase': {
    body: '막이 터지는 순간의 무적 시간이 길어집니다. 파열 직후 반격에 다시 맞는 것을 막습니다.',
    scale: '추가 무적 = 6 + 2×Lv 틱 (기본 피격 무적 위에 더해진다)',
    values: (lv) => [`파열 시 추가 무적 +${burstPhaseExtraIframes(lv)}틱`],
    lv1: '파열 직후 빠져나올 여유가 생깁니다.',
    max: '파열이 짧은 무적기가 됩니다.',
  },
  'film-offering': {
    body: '불멸 막이 지속되는 동안 흡수한 총량이 만료 폭발의 피해에 더해집니다. 버틴 만큼 크게 터집니다.',
    scale: '가산 = 흡수 총량의 40% + 4%p/Lv',
    values: (lv) => [`만료 폭발 가산 = 흡수 총량의 ${ofPct(filmOfferingBp(lv))}`],
    lv1: '불멸 막이 끝날 때 받은 만큼 돌려줍니다.',
    max: '흡수 총량의 120%가 폭발에 실립니다. 오래 버틸수록 폭발이 커집니다.',
  },
  'wall-echo': {
    body: '벽에 붙은 채로 일어난 파열은 밀어내기 범위와 변위가 함께 강해집니다.',
    scale: '벽 접촉 중 파열 범위·변위 ×1.15 + 0.015/Lv',
    values: (lv) => [`벽 접촉 중 파열 범위·변위 ${multX(wallEchoMultBp(lv))}`],
    lv1: '벽을 끼고 터뜨리면 더 멀리 밀어냅니다.',
    max: '벽을 낀 파열이 1.45배가 됩니다. 벽에 처박는 스킬과 함께 쓰면 좋습니다.',
  },
  'hydrophobic-coat': {
    body: '용암 같은 지형 피해를 막이 두 배 효율로 흡수합니다. 지형 피해에 한해 막이 훨씬 오래 버팁니다.',
    scale: '지형 피해 흡수 효율 ×2.00 + 0.10/Lv',
    values: (lv) => [`지형 피해 흡수 효율 ${multX(hydrophobicEffBp(lv))}`],
    lv1: '지형 피해를 막이 절반 값에 막아 냅니다.',
    max: '지형 피해가 사실상 막에 닿지 않습니다.',
  },
  'last-bubble': {
    body: '막이 없는 상태에서 치명 피격을 받으면, 그때까지 쌓인 재생 진행분을 소모해 즉석 비상막을 세웁니다.',
    scale: '비상막 = 재생 진행분의 60% + 3%p/Lv',
    values: (lv) => [`비상막 = 재생 진행분의 ${ofPct(lastBubbleShieldBp(lv))}`],
    lv1: '막이 없는 순간의 치명타를 한 번 버팁니다.',
    max: '재생이 어느 정도 차 있으면 거의 온전한 막이 즉석에서 섭니다.',
  },
  'purge-burst': {
    body: '막이 터질 때 범위 안의 적탄이 전부 지워지고 걸려 있던 감속도 풀립니다.',
    scale: '레벨을 올려도 효과가 커지지 않습니다 — 전부 지우는 것 이상은 없기 때문입니다.',
    values: () => ['파열 범위 안 적탄 전량 소거 · 감속 해제'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
};
