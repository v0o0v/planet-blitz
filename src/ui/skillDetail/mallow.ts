/**
 * 마슈멜로우 30스킬 상세 — 수치는 `src/sim/skills/mallowScaling.ts` 가 낸다.
 *
 * 이 표는 **수치를 담지 않는다.** 근거는 `../skillDetail.ts` 머리 참조.
 *
 * ## 이 기체를 설명할 때 반복해서 나오는 말
 * **부채** — 받은 피해 중 당장 선체로 안 들어가고 미뤄 둔 몫이다. **정산** — 미뤄 둔 부채가
 * 선체로 들어오는 순간이고, 무피격을 일정 틱 유지하면 온다. **탕감** — 정산 순간 부채 일부가
 * 선체에 닿지 않고 그냥 사라지는 것이다.
 */

import { CUSHION_RECOVER_BP, CUSHION_RECOVER_TICKS } from '../../sim/shipSignature.js';
import {
  BODY_RECOIL_RANGE,
  ECHO_BOND_TICK_CAP,
  FORGIVENESS_USE_PCT,
  INSTALLMENT_DEFER_PCT,
  INSTANT_EXCHANGE_PIERCE,
  MATURITY_VOLLEY_ARC,
  MATURITY_VOLLEY_BASE,
  MATURITY_VOLLEY_PIERCE,
  ME9_WALL_TICKS,
  PAIN_ANESTHESIA_BASE_BP,
  RECOIL_RINSE_PER_DEBT,
  afterimageRinseRadius,
  bankruptcyIframeTicks,
  bodyRecoilPct,
  capitalizationPct,
  capitalizationPerSettle,
  debtCeilingPct,
  debtFuryCapBp,
  debtFuryPerDebtBp,
  debtMagnetCapBp,
  debtMagnetPerDebtBp,
  debtStampPush,
  earlyRepaymentTicks,
  echoBondPct,
  fluffConvalescenceCut,
  forgivenessLoadPct,
  fullDeferralBp,
  graceOfSettlementTicks,
  growthConversionPct,
  healedHideMaxBp,
  installmentForgiveBp,
  instantExchangeDamageBp,
  instantExchangePer,
  interestBurnDamage,
  interestBurnForgive,
  maturityDivisor,
  maturityVolleyDamage,
  momentumDamageBp,
  momentumSpeedBp,
  overloadThreshold,
  painAnesthesiaCapBp,
  painAnesthesiaPerDebtBp,
  painlessDrivePeriod,
  painlessSettlementPct,
  rebateTherapyPct,
  recoilRinseRadius,
  rhythmForgivenessBp,
  scarCannonCapBp,
  scarCannonPerDamageBp,
  settlementBlastPct,
  settlementBlastRadius,
} from '../../sim/skills/mallowScaling.js';
import { incPct, ofPct, ticks, type SkillDetail } from './format.js';

/** 소수 한 자리까지의 퍼센트(정수면 정수로). 이 기체는 나눗셈 공식이 많아 소수가 자주 뜬다. */
function pct1(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export const MALLOW_SKILL_DETAIL: Readonly<Record<string, SkillDetail>> = {
  // ── 짓뭉개기 ────────────────────────────────────────────────────────────
  'debt-fury': {
    body: '지금 미뤄 둔 부채가 많을수록 주무기 피해가 올라갑니다. 부채 1당 정해진 몫이 붙고 아무리 쌓여도 증폭에는 상한이 있습니다. 정산으로 부채가 비면 증폭도 함께 사라집니다.',
    scale: '부채 1당 피해 증폭 (4 + Lv) · 증폭 상한 = 10 + 30×Lv/(Lv+10) %',
    values: (lv) => [
      `부채 10당 피해 ${incPct(10 * debtFuryPerDebtBp(lv))}`,
      `증폭 상한 ${incPct(debtFuryCapBp(lv))}`,
    ],
    lv1: '빚을 지고 있는 동안 주무기가 눈에 띄게 세집니다.',
    max: '부채가 충분히 쌓이면 주무기 피해가 30% 늘어납니다.',
  },
  'settlement-blast': {
    body: '정산으로 선체가 실제로 깎인 그 순간, 깎인 양에 비례한 폭발이 내 주위에서 터집니다. 탕감으로 사라진 몫은 세지 않으므로 아프게 갚을수록 크게 터집니다.',
    scale: '폭발 피해 = 선체행 × (80 + 6×Lv)% · 반경 180 + 10×Lv',
    values: (lv) => [
      `선체행의 ${settlementBlastPct(lv)}% 피해`,
      `폭발 반경 ${settlementBlastRadius(lv)}`,
    ],
    lv1: '정산이 손해로만 끝나지 않고 반격의 기회가 됩니다.',
    max: '갚은 양의 두 배 피해로 주변을 쓸어버립니다.',
  },
  'body-recoil': {
    body: `선체가 실제로 깎인 피격에 한해 가장 가까운 적 한 기에게 그 피해의 일부를 되돌립니다. 미뤄 둔 몫은 세지 않고 지금 당장 아팠던 만큼만 셉니다. 반경 ${BODY_RECOIL_RANGE} 안에 적이 없으면 아무 일도 일어나지 않습니다.`,
    scale: `반격 피해 = 즉시 피해 × (60 + 8×Lv)% · 탐색 반경 ${BODY_RECOIL_RANGE} 고정`,
    values: (lv) => [
      `즉시 피해의 ${bodyRecoilPct(lv)}% 반격`,
      `탐색 반경 ${BODY_RECOIL_RANGE}`,
    ],
    lv1: '맞는 순간 가장 가까운 적도 함께 아픕니다.',
    max: '받은 즉시 피해의 두 배가 넘는 양을 되돌려 줍니다.',
  },
  'debt-stamp': {
    body: '빚을 지고 있는 동안 쏜 탄이 맞은 적을 뒤로 밀어냅니다. 엘리트는 절반만 밀리고 보스와 구조물은 밀리지 않습니다.',
    scale: '밀어내는 거리 = 12 + 3×Lv (엘리트는 절반)',
    values: (lv) => [
      `밀어내는 거리 ${debtStampPush(lv)}`,
      `엘리트는 ${Math.round(debtStampPush(lv) / 2)}`,
    ],
    lv1: '빚이 있는 동안 탄이 적을 조금씩 밀어냅니다.',
    max: '한 발마다 적이 크게 밀려나 접근 자체를 막습니다.',
  },
  'forgiveness-loader': {
    body: `정산에서 탕감돼 사라진 양의 일부가 장전으로 쌓이고, 이후 볼리가 나갈 때마다 잔량의 ${FORGIVENESS_USE_PCT}% 씩 추가 피해로 실립니다. 잔량이 적어도 최소 1은 나가므로 탄창이 영영 안 비는 일은 없습니다.`,
    scale: `장전량 = 탕감분 × (50 + 5×Lv)% · 볼리당 소모는 잔량의 ${FORGIVENESS_USE_PCT}% (최소 1)`,
    values: (lv) => [
      `탕감분의 ${forgivenessLoadPct(lv)}% 장전`,
      `볼리당 잔량의 ${FORGIVENESS_USE_PCT}% 소모`,
    ],
    lv1: '탕감된 몫이 곧바로 화력으로 바뀝니다.',
    max: '탕감된 양보다 많은 화력이 장전됩니다.',
  },
  'instant-exchange': {
    body: `짓뭉개기 계열 공격 액티브로 부채를 청산할 때 부채 몇 당 탄 1발이 나오는 환산이 좋아지고, 그 청산 탄에 관통 ${INSTANT_EXCHANGE_PIERCE} 과 피해 증폭이 붙습니다. 체력을 돌려받지는 않습니다.`,
    scale: `환산 = round(10 − 6×Lv/(Lv+8)) 부채당 1발 · 탄당 피해 +(10 + 2×Lv)% · 관통 +${INSTANT_EXCHANGE_PIERCE} 고정`,
    values: (lv) => [
      `부채 ${instantExchangePer(lv)}당 청산 탄 1발`,
      `탄당 피해 ${incPct(instantExchangeDamageBp(lv))}`,
      `관통 +${INSTANT_EXCHANGE_PIERCE}`,
    ],
    lv1: '같은 빚으로 더 많은 청산 탄이 나옵니다.',
    max: '부채 6당 한 발씩 나오고 탄마다 피해가 절반 늘어납니다.',
  },
  'momentum-launch': {
    body: '달리는 방향과 쏘는 방향이 같을수록 탄속과 피해가 올라갑니다. 완전히 일치할 때 최대이고 옆으로 갈수록 줄며, 뒤로 달리며 쏘면 보정이 없습니다. 대신 깎이지도 않습니다.',
    scale: '완전 일치 시 탄속 +(10 + 1×Lv)% · 피해 +(4 + 1×Lv)% · 일치도에 비례해 줄어듭니다',
    values: (lv) => [
      `완전 일치 시 탄속 ${incPct(momentumSpeedBp(lv))}`,
      `완전 일치 시 피해 ${incPct(momentumDamageBp(lv))}`,
    ],
    lv1: '전진하며 쏘면 탄이 조금 빠르고 세집니다.',
    max: '앞으로 달리며 쏘는 것만으로 탄속이 30% 붙습니다.',
  },
  'scar-cannon': {
    body: '정산으로 선체가 깎인 양이 런 내내 누적되고, 그 누적량에 비례해 주무기 피해가 영구히 올라갑니다. 부채와 달리 정산해도 사라지지 않지만 증폭에는 상한이 있습니다.',
    scale: '누적 1당 피해 증폭 (6 + 2×Lv) · 증폭 상한 = 8 + 24×Lv/(Lv+12) %',
    values: (lv) => [
      `누적 10당 피해 ${incPct(10 * scarCannonPerDamageBp(lv))}`,
      `증폭 상한 ${incPct(scarCannonCapBp(lv))}`,
    ],
    lv1: '아프게 갚아 본 이력이 화력으로 남습니다.',
    max: '누적이 쌓이면 주무기 피해가 23% 늘어난 채 유지됩니다.',
  },
  'interest-burn': {
    body: '빚을 지고 있는 동안 맞힌 적이 불에 탑니다. 그 화상이 꺼지거나 적이 죽는 순간 부채가 조금 탕감됩니다. 적 한 기당 한 번만 세므로 연사로 탕감을 무한히 뽑을 수는 없습니다.',
    scale: '화상 틱당 피해 = round(2 × (100 + 4×Lv)/100) · 1회 탕감 = 3 + ⌊Lv/2⌋',
    values: (lv) => [
      `화상 틱당 ${interestBurnDamage(lv)} 피해`,
      `꺼지거나 처치될 때 부채 −${interestBurnForgive(lv)}`,
    ],
    lv1: '적을 태우면서 빚도 조금씩 줄여 나갑니다.',
    max: '한 마리를 정리할 때마다 부채가 13 줄어듭니다.',
  },
  'maturity-volley': {
    body: '전량 유예 태세가 만기로 끝나 정산이 일어나는 그 틱에만, 정산액에 비례한 관통 탄막이 조준 방향으로 부채꼴로 나갑니다. 무피격으로 오는 일반 정산에서는 나가지 않습니다.',
    scale: `탄수 = ${MATURITY_VOLLEY_BASE} + ⌈정산액 / (30 − 20×Lv/(Lv+15))⌉ · 1발 피해 12 + 2×Lv · 관통 ${MATURITY_VOLLEY_PIERCE} · 부채꼴 ${MATURITY_VOLLEY_ARC}도`,
    values: (lv) => [
      `기본 ${MATURITY_VOLLEY_BASE}발 + 정산액 ${maturityDivisor(lv).toFixed(1)}당 1발`,
      `1발 ${maturityVolleyDamage(lv)} 피해 · 관통 ${MATURITY_VOLLEY_PIERCE}`,
    ],
    lv1: '만기 정산이 반격 탄막으로 바뀝니다.',
    max: '큰 정산 한 번이 스무 발 넘는 관통 탄막이 됩니다.',
  },

  // ── 봉합 ────────────────────────────────────────────────────────────────
  'early-repayment': {
    body: '젬을 주울 때마다 정산까지 필요한 무피격 시간이 그만큼 앞당겨집니다. 줍는 행위 자체가 쉰 것으로 인정되는 셈입니다.',
    scale: '젬 1개당 무피격 시간 +(2 + ⌊Lv/2⌋)틱',
    values: (lv) => [`젬 1개당 ${earlyRepaymentTicks(lv)}틱 앞당김`],
    lv1: '젬을 주울수록 정산이 조금씩 빨리 옵니다.',
    max: '젬 다섯 개면 정산이 1초 앞당겨집니다.',
  },
  'debt-magnet': {
    body: '빚이 많을수록 젬을 끌어당기는 범위가 넓어집니다. 확장에는 상한이 있고 부채가 하나도 없으면 아무 효과도 없습니다.',
    scale: '부채 1당 반경 확장 (6 + 2×Lv) · 확장 상한 = 30 + 40×Lv/(Lv+12) %',
    values: (lv) => [
      `부채 10당 반경 ${incPct(10 * debtMagnetPerDebtBp(lv))}`,
      `확장 상한 ${incPct(debtMagnetCapBp(lv))}`,
    ],
    lv1: '빚을 진 동안 젬이 더 멀리서 딸려옵니다.',
    max: '부채가 쌓이면 자석 범위가 55% 넓어집니다.',
  },
  'painless-drive': {
    body: '감속에 걸려도 느려지지 않고 대신 일정 주기마다 부채가 1씩 쌓입니다. 감속 면역은 주기와 무관하게 계속 유지되고, 부채 한도가 차 있으면 대납을 멈춰 감속이 원래대로 걸립니다.',
    scale: '과금 주기 = 1 + ⌊Lv/6⌋틱마다 부채 +1 (면역은 그 사이에도 유지)',
    values: (lv) => [`${painlessDrivePeriod(lv)}틱마다 부채 +1`],
    lv1: '감속 장판을 빚으로 대납하고 그대로 지나갑니다.',
    max: '같은 감속 면역을 네 배 싼 값에 삽니다.',
  },
  'rebate-therapy': {
    body: '정산에서 탕감돼 사라진 양의 일부가 체력으로 돌아옵니다. 다만 회복량은 이번 정산으로 실제 깎인 양을 넘지 못하므로 맞는 것이 이득이 되는 일은 없습니다.',
    scale: '회복 = 탕감분 × (20 + 60×Lv/(Lv+15))% (단, 이번 선체행 이하)',
    values: (lv) => [`탕감분의 ${pct1(rebateTherapyPct(lv))} 회복`],
    lv1: '정산할 때마다 체력이 조금씩 돌아옵니다.',
    max: '탕감된 양의 절반 넘게 체력으로 되돌아옵니다.',
  },
  'installment-plan': {
    body: '정산액의 절반만 이번에 들어오고 나머지는 다음 정산으로 미뤄집니다. 미뤄지는 몫 중 일부는 그대로 탕감돼 사라지므로 나눠 갚을수록 총량 자체가 줄어듭니다.',
    scale: '이번 회차 = 정산액의 절반(내림) · 미뤄진 몫은 남은 탕감 여백의 60×Lv/(Lv+20)% 만큼 추가 탕감',
    values: (lv) => [
      `이번 회차 = 정산액의 ${100 - INSTALLMENT_DEFER_PCT}%`,
      `미뤄진 몫의 여백 중 ${ofPct(installmentForgiveBp(lv))} 추가 탕감`,
    ],
    lv1: '정산이 두 번으로 쪼개져 한 번에 오는 충격이 절반이 됩니다.',
    max: '나눠 갚는 것만으로 미뤄진 몫의 상당량이 그대로 사라집니다.',
  },
  'afterimage-rinse': {
    body: '이동 액티브로 도약한 뒤 도착 지점 주변의 적탄이 지워지고 그 안의 적들이 얼어 느려집니다. 출발 지점이 아니라 도착 지점 기준입니다.',
    scale: '반경 = 140 + 10×Lv',
    values: (lv) => [`도착 지점 반경 ${afterimageRinseRadius(lv)}`],
    lv1: '도약 한 번이 곧 탄막 정리가 됩니다.',
    max: '도약할 때마다 화면 상당 부분의 적탄이 지워집니다.',
  },
  'echo-bond': {
    body: `목표를 완수하는 순간 부채가 전액 사라지고, 사라진 양에 비례해 젬 자석이 강해지는 시간이 열립니다. 그 시간은 아무리 크게 소각해도 ${ECHO_BOND_TICK_CAP}틱을 넘지 않습니다.`,
    scale: `자석 버프 = 소각량 × (60 + 40×Lv/(Lv+10))% 틱 (상한 ${ECHO_BOND_TICK_CAP}틱)`,
    values: (lv) => [
      `소각량 100당 ${Math.floor(echoBondPct(lv))}틱`,
      `버프 상한 ${ticks(ECHO_BOND_TICK_CAP)}`,
    ],
    lv1: '목표를 완수하면 빚이 사라지고 젬이 몰려옵니다.',
    max: '소각량 100마다 86틱씩 자석이 강해집니다.',
  },
  'rhythm-forgiveness': {
    body: '젬 콤보가 유지되는 동안 정산에서 탕감되는 비율이 올라갑니다. 콤보는 읽기만 하고 소모하지 않으므로 수집 리듬을 유지하는 것만으로 계속 적용됩니다.',
    scale: `탕감률 = 기본 ${ofPct(CUSHION_RECOVER_BP)} + 35% × (스택×Lv)/(스택×Lv + 120)`,
    values: (lv) => [
      `콤보 5스택에서 탕감 ${ofPct(rhythmForgivenessBp(CUSHION_RECOVER_BP, 5, lv))}`,
      `콤보 10스택에서 탕감 ${ofPct(rhythmForgivenessBp(CUSHION_RECOVER_BP, 10, lv))}`,
    ],
    lv1: '콤보를 유지하면 정산이 조금 덜 아픕니다.',
    max: '콤보를 채워 두면 정산의 82% 가 선체에 닿지 않고 사라집니다.',
  },
  'fluff-convalescence': {
    body: `벽에 붙어 ${ME9_WALL_TICKS}틱 연속으로 미끄러지고 있으면 정산까지 필요한 무피격 시간이 줄어듭니다. 접촉이 한 번이라도 끊기면 조건이 처음부터 다시 쌓입니다.`,
    scale: `요구 ${ME9_WALL_TICKS}틱 연속 접촉 · 임계 인하 = round(20 + 50×Lv/(Lv+12))틱`,
    values: (lv) => [
      `정산 임계 −${fluffConvalescenceCut(lv)}틱`,
      `${CUSHION_RECOVER_TICKS}틱 → ${CUSHION_RECOVER_TICKS - fluffConvalescenceCut(lv)}틱`,
    ],
    lv1: '벽에 붙어 있으면 정산이 그만큼 빨리 옵니다.',
    max: '벽을 타는 동안 정산 주기가 3분의 1 가까이 짧아집니다.',
  },
  'growth-conversion': {
    body: '파워업을 고르는 순간 부채의 절반이 사라지고 그만큼이 경험치로 환전됩니다. 런 안의 경험치에만 들어가고 계정 성장에는 한 톨도 가지 않습니다.',
    scale: '소각 = 부채의 절반(올림) · 경험치 = 소각량 × (20 + 50×Lv/(Lv+10))%',
    values: (lv) => [
      '부채의 절반 소각',
      `소각량의 ${pct1(growthConversionPct(lv))} 가 경험치로 전환`,
    ],
    lv1: '파워업을 고를 때마다 빚이 절반으로 줄고 경험치가 붙습니다.',
    max: '소각한 부채의 절반이 넘는 양이 경험치로 돌아옵니다.',
  },

  // ── 완충 ────────────────────────────────────────────────────────────────
  'overload-absorb': {
    body: '한 방에 들어온 피해가 임계를 넘으면 그 초과분 전액이 부채로 넘어갑니다. 레벨이 오를수록 임계가 낮아져 더 작은 피격도 큰 피격으로 취급됩니다.',
    scale: '임계 = round(40 − 25×Lv/(Lv+10)) (최대 체력 비율이 아니라 절대 피해량)',
    values: (lv) => [`대형 피해 임계 ${overloadThreshold(lv)}`],
    lv1: '큰 한 방이 거의 전부 빚으로 넘어갑니다.',
    max: '피해 23을 넘는 순간부터 초과분이 전부 미뤄집니다.',
  },
  'debt-ceiling': {
    body: '부채에 한도가 생기고 한도를 넘겨 미뤄질 몫은 처음부터 즉시 피해로 들어옵니다. 정산 한 번이 감당 못 할 크기로 부풀지 않게 막아 주는 대신 미룰 수 있는 총량이 제한됩니다.',
    scale: '한도 = 최대 체력 × round(25 + 30×Lv/(Lv+12))%',
    values: (lv) => [`부채 한도 = 최대 체력의 ${debtCeilingPct(lv)}%`],
    lv1: '정산 한 번이 감당 못 할 크기로 부풀지 않습니다.',
    max: '최대 체력의 44% 까지 안심하고 미뤄 둘 수 있습니다.',
  },
  'painless-settlement': {
    body: '정산 한 번이 선체에서 가져갈 수 있는 양에 상한이 생기고, 넘치는 몫은 사라지지 않고 다음 정산으로 이월됩니다. 레벨이 오를수록 상한이 낮아져 한 번에 받는 충격이 작아집니다.',
    scale: '회당 상한 = 최대 체력 × round(30 − 18×Lv/(Lv+10))%',
    values: (lv) => [`회당 상한 = 최대 체력의 ${painlessSettlementPct(lv)}%`],
    lv1: '정산 한 번이 체력을 통째로 가져가지 못합니다.',
    max: '한 번의 정산이 최대 체력의 18% 를 넘지 못합니다.',
  },
  'recoil-rinse': {
    body: '빚을 지고 있을 때 실제로 맞으면 주변 적탄이 지워집니다. 소거 반경은 부채가 클수록 넓어지고 확장분은 기본 반경의 두 배까지만 붙습니다.',
    scale: `기본 반경 = 70 + 6×Lv · 부채 1당 +${RECOIL_RINSE_PER_DEBT} (확장 상한 = 기본 반경의 2배)`,
    values: (lv) => [
      `기본 반경 ${recoilRinseRadius(lv)}`,
      `부채가 충분할 때 최대 반경 ${recoilRinseRadius(lv) * 3}`,
    ],
    lv1: '맞는 순간 주변 탄막이 함께 지워집니다.',
    max: '부채가 쌓이면 피격 한 번이 반경 570 의 탄막을 지웁니다.',
  },
  'full-deferral-stance': {
    body: '카운터 가속 버프가 켜져 있는 동안 받는 피해 대부분이 즉시 들어오지 않고 부채로 넘어갑니다. 그래도 즉시분이 완전히 0 이 되지는 않습니다.',
    scale: '버프 지속 중 지연율 = (60 + 35×Lv/(Lv+12))%',
    values: (lv) => [`버프 지속 중 지연율 ${ofPct(fullDeferralBp(lv))}`],
    lv1: '버프 중에는 받는 피해의 3분의 2가 미뤄집니다.',
    max: '버프 중에는 받는 피해의 82% 가 부채로 넘어갑니다.',
  },
  'bankruptcy-protection': {
    body: '죽을 피격을 런당 한 번 막습니다. 그 피해 전액이 부채로 넘어가 살아남고 짧은 무적이 섭니다. 이때는 부채 한도를 넘겨 쌓이므로 정산으로 한도 아래로 내려올 때까지 새로 미룰 수 없습니다.',
    scale: '런당 1회 고정 · 무적 = 30 + 3×Lv틱 (통상 피격 무적이 더 길면 그쪽이 유지됩니다)',
    values: (lv) => [`발동 시 무적 ${ticks(bankruptcyIframeTicks(lv))}`, '런당 1회'],
    lv1: '죽을 한 방을 빚으로 대신 갚고 살아남습니다.',
    max: '살아난 뒤 1.5초 동안 무적으로 자리를 벗어납니다.',
  },
  'healed-hide': {
    body: '맞지 않은 시간이 길수록 받는 피해가 줄어듭니다. 정산이 그 시간을 0 으로 되돌리므로 갚은 직후가 가장 약합니다. 이 감소는 지금 들어오는 피격에만 걸리고 나중에 갚는 부채에는 걸리지 않습니다.',
    scale: '감소 = min(무피격 틱, 정산 임계) / 정산 임계 × (15 + 35×Lv/(Lv+12))%',
    values: (lv) => [
      `만충 시 피해 감소 ${ofPct(healedHideMaxBp(lv))}`,
      `만충 기준 ${ticks(CUSHION_RECOVER_TICKS)}`,
    ],
    lv1: '오래 안 맞을수록 조금씩 단단해집니다.',
    max: '정산 직전에는 받는 피해가 37% 줄어듭니다.',
  },
  'pain-anesthesia': {
    body: '빚을 지고 있는 동안 이동 속도가 오릅니다. 기본 증가에 더해 부채가 클수록 더 빨라지고 상한이 있습니다. 대시 속도에는 걸리지 않습니다.',
    scale: `이속 = 기본 ${incPct(PAIN_ANESTHESIA_BASE_BP)} + 부채 1당 (2 + Lv) · 상한 = 15 + 15×Lv/(Lv+10) %`,
    values: (lv) => [
      `기본 ${incPct(PAIN_ANESTHESIA_BASE_BP)} + 부채 10당 ${incPct(10 * painAnesthesiaPerDebtBp(lv))}`,
      `이속 상한 ${incPct(painAnesthesiaCapBp(lv))}`,
    ],
    lv1: '빚을 진 동안 몸이 한결 가벼워집니다.',
    max: '부채가 쌓이면 이동 속도가 25% 붙습니다.',
  },
  'grace-of-settlement': {
    body: '정산이 일어나는 순간 짧은 무적이 섭니다. 통상 피격 무적이 더 길게 남아 있으면 그쪽이 유지되므로 무적이 도리어 깎이는 일은 없습니다.',
    scale: '무적 = 20 + 4×Lv틱',
    values: (lv) => [`정산 시 무적 ${ticks(graceOfSettlementTicks(lv))}`],
    lv1: '갚는 순간 잠깐 무적이 되어 한숨 돌립니다.',
    max: '정산마다 1.7초짜리 무적이 서서 자리를 고칠 수 있습니다.',
  },
  'perpetual-capitalization': {
    body: '정산에서 탕감돼 사라진 양의 일부만큼 최대 체력이 런 내내 영구히 올라갑니다. 최대치만 오르고 현재 체력은 오르지 않으며, 한 번의 정산으로 오를 수 있는 양에는 상한이 있습니다.',
    scale: '증가 = 탕감분 × round(4 + 16×Lv/(Lv+16))% (정산 1회 상한 3 + Lv)',
    values: (lv) => [
      `탕감분의 ${capitalizationPct(lv)}% 만큼 최대 체력 증가`,
      `정산 1회 상한 +${capitalizationPerSettle(lv)}`,
    ],
    lv1: '정산할 때마다 몸집이 조금씩 커집니다.',
    max: '정산 한 번마다 최대 체력이 최대 23 오릅니다.',
  },
};
