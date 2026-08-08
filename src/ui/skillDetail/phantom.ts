/**
 * 팬텀 30스킬 상세 — 수치는 `src/sim/skills/phantomScaling.ts` 가 낸다.
 *
 * 이 표는 **수치를 담지 않는다.** 근거는 `../skillDetail.ts` 머리 참조.
 *
 * ## 이 기체를 설명할 때 반복해서 나오는 말
 * **무피격 스트릭** — 맞지 않고 버틴 틱이다. 임계에 닿으면 **은신 창**이 열리고 일정 시간
 * 유지된다. **해제 첫 타** — 은신 중 처음 쏘는 볼리이고 큰 배율을 받는다. 피격은 스트릭을
 * 0 으로 되돌린다.
 */

import {
  CLOAK_BREAK_BP,
  CLOAK_HOLD_TICKS,
  CLOAK_UNHIT_TICKS,
} from '../../sim/shipSignature.js';
import {
  CLOAK_PIERCE_ADD,
  LAST_PHASE_HP_PCT,
  MENDING_PERIOD,
  PHASE_LIQUIDATION_STREAK_DIV,
  REPULSE_RADIUS,
  TALLY_STACK_CAP,
  VOID_COVENANT_HP_CUT_BP,
  afterimageExitAdvance,
  annihilationBlastBp,
  annihilationRadius,
  attenuationBp,
  backstabBp,
  blownCoverIframeAdd,
  cloakPierceSpeedBp,
  cloakedMendingHeal,
  coverStalkAdvance,
  echoStalkCooldownCut,
  entryFlashDamage,
  entryFlashRadius,
  executionReloadPierce,
  extendedHoldBudget,
  frozenClockBudget,
  grudgeAmplifyBp,
  lastPhaseCooldownTicks,
  phaseLandingRadius,
  phaseLiquidationRadius,
  phaseSedimentHp,
  repulsePush,
  shadowLedgerComboAdd,
  tallyBpPerStack,
  traceSiphonAdvance,
  tracelessStrideSpeedBp,
  twinMarkBp,
  vanishingChillRadius,
  vitalDissectionBp,
  voidCovenantAddBp,
} from '../../sim/skills/phantomScaling.js';
import {
  multX,
  ofPct,
  ticks,
  NO_SCALE_LV1,
  NO_SCALE_MAX,
  type SkillDetail,
} from './format.js';

/** 이진 스킬이 `scale` 칸에 쓰는 문장. 「커지지 않습니다」가 테스트가 잠그는 약속이다. */
function binaryScale(what: string): string {
  return `${what} 둘 중 하나라 레벨을 올려도 커지지 않습니다.`;
}

export const PHANTOM_SKILL_DETAIL: Readonly<Record<string, SkillDetail>> = {
  // ── 암살 ────────────────────────────────────────────────────────────────
  'twin-mark': {
    body: '해제 첫 타를 쏜 다음 볼리 한 발에도 강화 배율이 실립니다. 다만 그 후속 배율은 첫 타보다 작고, 낮은 레벨에서는 평타보다도 약합니다. 다음 볼리가 또 해제 첫 타라면 후속을 얹지 않고 예약만 다시 잡습니다.',
    scale: '후속 총 배율 = 해제 첫 타 배율 × (0.3 + 0.6×Lv/(Lv+15))',
    values: (lv) => [
      `후속 볼리 총 배율 ${multX(twinMarkBp(lv))}`,
      `해제 첫 타 자체는 ${multX(CLOAK_BREAK_BP)}`,
    ],
    lv1: '해제 첫 타 다음 한 발이 이어지지만 그 한 발은 평타보다 약합니다.',
    max: '해제 첫 타 다음 한 발이 1.6배로 나갑니다.',
  },
  'cloak-pierce': {
    body: `은신 창 동안 쏜 탄에 관통 ${CLOAK_PIERCE_ADD} 이 붙고 탄속이 올라갑니다. 빔은 관통과 탄속을 읽지 않는 무기라 이 스킬이 반영되지 않습니다.`,
    scale: `관통 +${CLOAK_PIERCE_ADD} 고정 · 탄속 배율 = 1.06 + 0.015×Lv`,
    values: (lv) => [
      `창 중 탄속 ${multX(cloakPierceSpeedBp(lv))}`,
      `창 중 관통 +${CLOAK_PIERCE_ADD}`,
    ],
    lv1: '은신 중 쏜 탄이 하나를 더 꿰뚫고 나갑니다.',
    max: '은신 중 탄속이 1.36배가 됩니다.',
  },
  'execution-reload': {
    body: '해제 첫 타로 적을 그 명중 틱에 처치하면 강화 배율이 즉시 다시 채워져 다음 볼리도 첫 타 배율로 나갑니다. 강화탄에는 관통도 함께 실립니다. 명중 틱에 죽지 않으면 재장전되지 않습니다.',
    scale: '재장전 자체는 레벨과 무관 · 강화탄 관통 = ⌊Lv/5⌋',
    values: (lv) => [
      `강화탄 관통 +${executionReloadPierce(lv)}`,
      '첫 타로 처치 시 배율 즉시 재장전',
    ],
    lv1: '첫 타로 처치하면 곧바로 다시 첫 타를 쏩니다.',
    max: '강화탄이 넷을 더 꿰뚫고, 처치하면 그 자리에서 재장전됩니다.',
  },
  'vital-dissection': {
    body: '체력이 가득 찬 적에게 처음 명중하는 탄이 추가 피해를 얹습니다. 두 번째 타부터는 이미 체력이 깎여 있어 조건이 성립하지 않습니다.',
    scale: '추가 피해 = 명중 실피해 × (12 + 1.8×Lv)%',
    values: (lv) => [`만피 적 선타에 ${ofPct(vitalDissectionBp(lv))} 추가 피해`],
    lv1: '새 적을 처음 때릴 때마다 한 조각씩 더 들어갑니다.',
    max: '선타마다 실피해의 절반 가까이가 덤으로 들어갑니다.',
  },
  backstab: {
    body: '적이 나아가는 방향의 반대쪽에서 맞히면 추가 피해가 들어갑니다. 멈춰 있는 적과 움직이지 않는 구조물은 등이 정의되지 않아 증폭되지 않습니다.',
    scale: '추가 피해 = 명중 실피해 × (10 + 1.5×Lv)%',
    values: (lv) => [`후방 명중에 ${ofPct(backstabBp(lv))} 추가 피해`],
    lv1: '뒤를 잡으면 한 조각이 더 들어갑니다.',
    max: '뒤를 잡으면 실피해의 40% 가 덤으로 들어갑니다.',
  },
  'silent-kill': {
    body: '은신 창 동안 죽은 엘리트는 폭발이나 분열 같은 사망 잔재를 남기지 않습니다. 무엇이 그 적을 죽였는지는 보지 않고 은신 중이기만 하면 적용됩니다.',
    scale: binaryScale('잔재를 남기거나 안 남기거나'),
    values: () => ['은신 창 동안 처치한 적은 사망 잔재 없음'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'grudge-settlement': {
    body: '나를 마지막으로 맞힌 적이 원한 표적으로 찍히고 그 적에게 주는 피해가 올라갑니다. 표적이 죽으면 표식이 풀리고 다음 피격원이 새 표적이 됩니다. 침공 구조물은 표적이 되지 않습니다.',
    scale: '추가 피해 = 명중 실피해 × (20 + 60×Lv/(Lv+12))%',
    values: (lv) => [`원한 표적에 ${ofPct(grudgeAmplifyBp(lv))} 추가 피해`],
    lv1: '나를 때린 적에게 그만큼 되갚습니다.',
    max: '원한 표적은 실피해의 57% 를 더 받습니다.',
  },
  'executioner-tally': {
    body: `적을 처치할 때마다 스택이 쌓이고, 다음 해제 첫 타에 그 스택만큼 배율이 가산된 뒤 스택이 비워집니다. 스택은 ${TALLY_STACK_CAP}개까지만 쌓이고 침공에서는 쌓이지 않습니다.`,
    scale: `스택당 배율 가산 = (100 + 25×Lv)/10000 · 상한 ${TALLY_STACK_CAP}스택 · 소비 후 초기화`,
    values: (lv) => [
      `스택 1개당 해제 첫 타 배율 +${(tallyBpPerStack(lv) / 10000).toFixed(2)}`,
      `${TALLY_STACK_CAP}스택에서 해제 첫 타 ${multX(CLOAK_BREAK_BP + TALLY_STACK_CAP * tallyBpPerStack(lv))}`,
    ],
    lv1: '처치를 쌓아 두면 다음 해제 첫 타가 더 세집니다.',
    max: '스택을 가득 채우면 해제 첫 타가 3.7배로 나갑니다.',
  },
  'annihilation-verdict': {
    body: '해제 첫 타가 맞은 지점에서 폭발이 일어나 주변 적을 함께 때립니다. 맞은 적 자신은 폭발 대상에서 빠지므로 이 스킬은 단일 화력이 아니라 광역 축입니다.',
    scale: '폭발 피해 = 첫 타 실피해 × (25 + 1.5×Lv)% · 반경 100 + 10×Lv',
    values: (lv) => [
      `첫 타 실피해의 ${ofPct(annihilationBlastBp(lv))} 폭발`,
      `폭발 반경 ${annihilationRadius(lv)}`,
    ],
    lv1: '해제 첫 타가 주변까지 함께 쓸어 냅니다.',
    max: '첫 타 실피해의 55% 가 반경 300 안 전원에게 들어갑니다.',
  },
  'ghost-trajectory': {
    body: '은신 창 동안 쏜 탄이 벽에 막히지 않고 지나갑니다. 파괴가능한 벽은 피해를 주면서 통과합니다. 다만 자동 조준은 여전히 벽 너머 적을 고르지 않아 직접 겨눠야 닿습니다.',
    scale: binaryScale('벽을 통과하거나 안 하거나'),
    values: () => ['은신 창 중 발사한 탄이 벽 통과'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },

  // ── 위상 ────────────────────────────────────────────────────────────────
  'afterimage-exit': {
    body: '대시를 쓸 때마다 무피격 스트릭이 그만큼 앞으로 밀려 은신이 빨리 열립니다. 이미 은신 창 안이라면 아무 일도 일어나지 않습니다.',
    scale: '대시 1회당 스트릭 +(20 + 4×Lv)틱',
    values: (lv) => [
      `대시 1회당 ${afterimageExitAdvance(lv)}틱 전진`,
      `진입 임계 ${CLOAK_UNHIT_TICKS}틱`,
    ],
    lv1: '대시가 은신 준비를 겸하게 됩니다.',
    max: '대시 세 번이면 은신 임계에 그대로 닿습니다.',
  },
  'phase-landing': {
    body: '위상 축 액티브로 도약한 뒤 착지 지점 주변의 적탄이 지워지고 그 안의 적에게 냉기가 걸립니다. 출발 지점이 아니라 착지 지점 기준입니다.',
    scale: '반경 = 140 + 10×Lv',
    values: (lv) => [`착지 지점 반경 ${phaseLandingRadius(lv)}`],
    lv1: '도약 한 번이 곧 탄막 정리가 됩니다.',
    max: '도약할 때마다 반경 340 의 적탄이 지워집니다.',
  },
  'shadow-ledger': {
    body: '은신 창 동안 젬 콤보 시계가 멈춰 콤보가 풀리지 않습니다. 게다가 창 안에서 젬을 주우면 콤보 창이 추가로 늘어납니다. 콤보가 이미 0 이면 시계만 도는 일은 없습니다.',
    scale: '창 중 젬 1개당 콤보 창 +(2 + 1×Lv)틱 · 창 중 시계 정지는 레벨과 무관',
    values: (lv) => [
      `창 중 젬 1개당 콤보 창 +${shadowLedgerComboAdd(lv)}틱`,
      '창 중 콤보 시계 정지',
    ],
    lv1: '은신 중에는 콤보가 풀리지 않습니다.',
    max: '은신 중 젬 하나가 콤보 창을 22틱씩 늘려 줍니다.',
  },
  'traceless-stride': {
    body: '은신 창 동안 이동 속도가 오르고 감속에 걸리지 않습니다. 감속 면역은 레벨과 무관하게 창 내내 유지되고, 대시 속도에는 걸리지 않습니다.',
    scale: '이동 속도 배율 = 1.08 + 0.01×Lv · 감속 면역은 레벨과 무관',
    values: (lv) => [
      `창 중 이동 속도 ${multX(tracelessStrideSpeedBp(lv))}`,
      '창 중 감속 면역',
    ],
    lv1: '은신 중에는 감속을 무시하고 더 빨리 움직입니다.',
    max: '은신 중 이동 속도가 1.28배가 됩니다.',
  },
  'extended-phase': {
    body: '은신 창의 마지막 틱에서 시계를 붙잡아 창이 그만큼 더 유지됩니다. 창당 연장 총량은 예산으로 묶여 있고 그 예산은 다음 진입 때 다시 채워집니다.',
    scale: '창당 연장 예산 = ⌊은신 유지 틱 × Lv / 20⌋틱',
    values: (lv) => [
      `창당 연장 ${extendedHoldBudget(lv)}틱`,
      `유지 ${CLOAK_HOLD_TICKS}틱 → ${CLOAK_HOLD_TICKS + extendedHoldBudget(lv)}틱`,
    ],
    lv1: '은신이 조금 더 오래 갑니다.',
    max: '은신 창이 두 배로 늘어납니다.',
  },
  'frozen-clock': {
    body: '은신 창 안에서 대시하면 그 다음 틱에 시계가 한 틱 멈춰 창이 그만큼 길어집니다. 창당 멈출 수 있는 총량은 예산으로 묶여 있고, 창 밖 대시는 대신 스트릭을 앞당깁니다.',
    scale: '창당 정지 예산 = min(12 + ⌊2.4×Lv⌋, 은신 유지 틱의 절반)틱 · 대시 1회당 1틱',
    values: (lv) => [`창당 정지 ${frozenClockBudget(lv)}틱`, '대시 1회당 1틱'],
    lv1: '창 안에서 대시하면 은신이 조금씩 늘어납니다.',
    max: '대시를 반복하면 은신 창이 절반만큼 더 갑니다.',
  },
  'entry-flash': {
    body: '은신에 들어가는 순간 그 자리에서 폭발이 일어나고 같은 반경의 적탄이 지워집니다. 폭발과 소거가 같은 반경이라 들어가는 순간이 곧 정리하는 순간입니다.',
    scale: '반경 = 150 + 12×Lv · 폭발 피해 = 15 + 3×Lv',
    values: (lv) => [
      `폭발·소거 반경 ${entryFlashRadius(lv)}`,
      `폭발 피해 ${entryFlashDamage(lv)}`,
    ],
    lv1: '은신에 들어가는 순간 주변이 한 번 정리됩니다.',
    max: '진입할 때마다 반경 390 에 75 피해가 터집니다.',
  },
  'trace-siphon': {
    body: '젬을 주울 때마다 무피격 스트릭이 앞으로 밀려 은신이 빨리 열립니다. 이미 은신 창 안이라면 아무 일도 일어나지 않습니다.',
    scale: '젬 1개당 스트릭 +(1 + ⌈Lv/5⌉)틱',
    values: (lv) => [
      `젬 1개당 ${traceSiphonAdvance(lv)}틱 전진`,
      `진입 임계 ${CLOAK_UNHIT_TICKS}틱`,
    ],
    lv1: '젬을 주울수록 은신이 빨리 열립니다.',
    max: '젬 하나가 은신을 5틱씩 앞당깁니다.',
  },
  'echo-stalk': {
    body: '런 목표를 완수하면 그 자리에서 은신에 진입합니다. 목표가 활성인 동안에는 대시 쿨다운이 매 틱 추가로 깎여 훨씬 빨리 식습니다. 즉시 진입 자체는 레벨과 무관합니다.',
    scale: '목표 활성 중 틱당 추가 냉각 = 1 + ⌊Lv/10⌋틱 · 즉시 진입은 레벨과 무관',
    values: (lv) => [
      `목표 활성 중 대시 냉각 틱당 +${echoStalkCooldownCut(lv)}`,
      '목표 완수 시 즉시 은신',
    ],
    lv1: '목표를 완수하면 곧바로 은신에 들어갑니다.',
    max: '목표가 도는 동안 대시가 네 배 빠르게 식습니다.',
  },
  'blown-cover-reflex': {
    body: '은신 창 중에 맞아 창이 깨지면 대시 쿨다운이 전액 환급되고 피격 무적이 더 붙습니다. 창 밖에서 맞은 경우에는 걸리지 않습니다.',
    scale: '무적 가산 = 1 + ⌊Lv/4⌋틱 · 대시 쿨다운 전액 환급은 레벨과 무관',
    values: (lv) => [`무적 +${blownCoverIframeAdd(lv)}틱`, '대시 쿨다운 전액 환급'],
    lv1: '들켜서 맞아도 곧바로 대시로 빠져나갈 수 있습니다.',
    max: '깨지는 순간 무적이 6틱 더 붙고 대시가 즉시 준비됩니다.',
  },

  // ── 교란 ────────────────────────────────────────────────────────────────
  'phase-liquidation': {
    body: '맞아서 무피격 스트릭이 0 으로 돌아가는 순간, 잃은 스트릭의 절반이 반경에 더해져 주변 적탄이 지워집니다. 오래 버틸수록 깨질 때 크게 터집니다.',
    scale: `반경 = (40 + 4×Lv) + 잃은 스트릭 / ${PHASE_LIQUIDATION_STREAK_DIV}`,
    values: (lv) => [
      `기본 반경 ${phaseLiquidationRadius(lv)}`,
      `${CLOAK_UNHIT_TICKS}틱 쌓고 맞으면 ${phaseLiquidationRadius(lv) + CLOAK_UNHIT_TICKS / PHASE_LIQUIDATION_STREAK_DIV}`,
    ],
    lv1: '맞는 순간 쌓아 둔 은신이 방벽으로 정산됩니다.',
    max: '오래 버틴 뒤 맞으면 반경 240 의 적탄이 지워집니다.',
  },
  'cloaked-mending': {
    body: `은신 창 안에서 ${MENDING_PERIOD}틱마다 체력이 회복됩니다. 진입 틱에는 회복이 없고 첫 회복은 진입 ${MENDING_PERIOD}틱 뒤에 옵니다. 기본 창 길이에서는 창당 한 번입니다.`,
    scale: `회복 주기 ${MENDING_PERIOD}틱 고정 · 1회 회복 = 2 + 1×Lv`,
    values: (lv) => [`${MENDING_PERIOD}틱마다 ${cloakedMendingHeal(lv)} 회복`],
    lv1: '은신에 들어가 있으면 체력이 조금씩 돌아옵니다.',
    max: '은신할 때마다 체력이 22 씩 돌아옵니다.',
  },
  'first-hit-attenuation': {
    body: '맞지 않고 버틴 시간이 길수록 받는 피해가 줄어듭니다. 맞는 순간 스트릭이 0 이 되므로 연속으로 맞으면 두 번째 타부터는 감소가 사라집니다.',
    scale: '감소 = 60% × s/(s+2000), s = 무피격 스트릭 × (4 + Lv)',
    values: (lv) => [
      `${CLOAK_UNHIT_TICKS}틱 버텼을 때 피해 감소 ${ofPct(attenuationBp(CLOAK_UNHIT_TICKS, lv))}`,
      `그 두 배로 버티면 ${ofPct(attenuationBp(CLOAK_UNHIT_TICKS * 2, lv))}`,
    ],
    lv1: '버틴 만큼 다음 첫 타가 덜 아픕니다.',
    max: '오래 버티면 받는 피해가 절반 가까이 깎입니다.',
  },
  'repulse-phase': {
    body: `맞는 순간 반경 ${REPULSE_RADIUS} 안의 적이 바깥으로 밀려납니다. 보스와 엘리트는 절반만 밀리고 구조물은 밀리지 않습니다.`,
    scale: `밀어내는 거리 = 60 + 8×Lv (보스·엘리트는 절반) · 반경 ${REPULSE_RADIUS} 고정`,
    values: (lv) => [
      `밀어내는 거리 ${repulsePush(lv)}`,
      `보스·엘리트는 ${Math.round(repulsePush(lv) / 2)}`,
    ],
    lv1: '맞는 순간 달라붙은 적이 떨어져 나갑니다.',
    max: '피격 한 번이 주변 적을 220 만큼 날려 버립니다.',
  },
  'last-phase': {
    body: `체력이 최대치의 ${LAST_PHASE_HP_PCT}% 아래로 떨어지는 그 피격 순간 즉시 은신에 진입합니다. 내부 쿨다운이 있어 연달아 발동하지는 않고, 침공에서는 발동하지 않습니다.`,
    scale: `발동 임계 = 최대 체력의 ${LAST_PHASE_HP_PCT}% 고정 · 내부 쿨다운 = 3600 − 3600×Lv/(Lv+30)틱`,
    values: (lv) => [
      `내부 쿨다운 ${ticks(lastPhaseCooldownTicks(lv))}`,
      `발동 임계 최대 체력의 ${LAST_PHASE_HP_PCT}%`,
    ],
    lv1: '위험해지는 순간 한 번은 사라져 줍니다.',
    max: '36초마다 위기에서 은신으로 빠져나갑니다.',
  },
  'cover-stalk': {
    body: '벽에 붙어 있는 동안 무피격 스트릭이 매 틱 추가로 쌓여 은신이 빨리 열립니다. 접촉이 끊기면 그 틱부터 가속이 멈춥니다.',
    scale: '벽 접촉 1틱당 스트릭 +(1 + ⌊Lv/10⌋)틱',
    values: (lv) => [
      `벽 접촉 1틱당 +${coverStalkAdvance(lv)}틱`,
      `진입 임계 ${CLOAK_UNHIT_TICKS}틱`,
    ],
    lv1: '벽을 타면 은신이 두 배 빨리 열립니다.',
    max: '벽을 타는 동안 은신 적립이 네 배가 됩니다.',
  },
  'vanishing-chill': {
    body: '은신에 들어가는 순간 반경 안의 적 전원이 얼어 느려집니다. 감속 강도는 냉기 공통 규격이라 레벨은 반경만 넓힙니다.',
    scale: '반경 = 200 + 15×Lv (감속 강도는 냉기 공통 규격으로 고정)',
    values: (lv) => [`냉기 반경 ${vanishingChillRadius(lv)}`],
    lv1: '진입하면서 주변을 한 번 얼립니다.',
    max: '진입 한 번이 반경 500 안 전원을 얼립니다.',
  },
  'phase-sediment': {
    body: '은신에 들어갈 때마다 최대 체력이 영구히 올라갑니다. 최대치만 오르고 현재 체력은 오르지 않으므로 회복 수단은 아닙니다. 진입 횟수만큼 계속 쌓입니다.',
    scale: '진입 1회당 = round(2 + 16×Lv/(Lv+24))',
    values: (lv) => [`진입 1회당 최대 체력 +${phaseSedimentHp(lv)}`],
    lv1: '은신을 반복할수록 몸집이 커집니다.',
    max: '진입할 때마다 최대 체력이 9 씩 붙습니다.',
  },
  'ghost-hull': {
    body: '피격 무적이 서 있는 동안 선체가 벽에 걸리지 않고 지나갑니다. 무적이 끝나면 곧바로 다시 막히므로 벽 안에 머무를 수는 없습니다.',
    scale: binaryScale('벽을 통과하거나 안 하거나'),
    values: () => ['피격 무적 중 선체가 벽 통과'],
    lv1: NO_SCALE_LV1,
    max: NO_SCALE_MAX,
  },
  'void-covenant': {
    body: `런 시작에 최대 체력이 ${ofPct(VOID_COVENANT_HP_CUT_BP)} 깎이고, 그 대가로 은신 해제 첫 타 배율이 영구히 올라갑니다. 대가는 런당 정확히 한 번만 물리고, 침공에서는 이득도 대가도 없습니다.`,
    scale: `해제 첫 타 배율 가산 = (500 + 250×Lv)/10000 · 최대 체력 −${ofPct(VOID_COVENANT_HP_CUT_BP)} 고정`,
    values: (lv) => [
      `해제 첫 타 ${multX(CLOAK_BREAK_BP)} → ${multX(CLOAK_BREAK_BP + voidCovenantAddBp(lv))}`,
      `최대 체력 −${ofPct(VOID_COVENANT_HP_CUT_BP)}`,
    ],
    lv1: '체력을 조금 내주고 해제 첫 타를 더 무겁게 만듭니다.',
    max: '해제 첫 타가 3.05배가 됩니다.',
  },
};
