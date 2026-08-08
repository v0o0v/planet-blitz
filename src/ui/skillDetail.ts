/**
 * 연구소 스킬 **상세 표** — 수치를 sim 정본에서 계산한다 (사용자 요청 2026-08-09).
 *
 * ## 왜 이 파일이 필요했나
 * 연구소는 스킬당 `node.desc` **한 줄**만 보여 줬다. 그 한 줄은 정성 문장이라("적을 처치할
 * 때마다 정조준 사이클 카운터가 즉시 충전된다") 플레이어가 *"몇 포인트를 넣을 가치가 있나"*
 * 를 판단할 근거가 화면에 없었다. 수치는 전부 sim 안에만 있었다.
 *
 * ## 수치의 출처는 **sim 이다** — 문안이 아니다
 * `src/sim/skills/strikerScaling.ts` 의 순수 함수를 그대로 부른다. 대안 둘을 기각한 근거는
 * 그 파일 머리에 있다(요약: 설계서는 구현과 이미 갈려 있고 — F6 이 증거 — 화면이 자기 공식을
 * 적으면 밸런스 한 줄에 조용히 갈린다).
 *
 * 그래서 이 표가 담는 것은 **수치가 아니라 문장 틀**이다: 어떤 함수를 어떤 라벨로 부를지.
 * 밸런스가 바뀌면 이 파일은 한 줄도 안 고쳐도 화면이 새 값을 말한다.
 *
 * ## 왜 UI 레이어인가
 * sim 은 UI 를 모른다(ADR-0005 · ADR-0014). 역방향(UI → sim 순수 리더)은 허용이고, 이 표는
 * 표시 문안을 소유하므로 UI 쪽이 맞다. `data/` 에 두면 데이터 레이어가 sim 을 import 하게 돼
 * 층이 뒤집힌다.
 *
 * ## 커버리지 계약
 * `STRIKER_SKILL_DETAIL` 은 스트라이커 **30스킬 전부**를 담는다(테스트가 못 박는다). 빠진
 * 스킬은 화면에서 조용히 예전 한 줄로 내려앉으므로, 누락을 눈으로 잡을 수 없다.
 *
 * ⚠️ 나머지 6기체(180스킬)는 아직 없다 — 이 레인은 **형태 확정용 파일럿**이다(사용자 판단
 * 2026-08-09). 없는 기체는 `skillDetailOf` 가 `null` 을 내고 화면이 종전 한 줄을 그대로 쓴다.
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
} from '../sim/skills/strikerScaling.js';
import { DEFAULT_CONFIG } from '../sim/world.js';

/** 스킬 1종의 상세. 수치는 {@link SkillDetail.values} 가 **계산해서** 낸다. */
export interface SkillDetail {
  /**
   * 본체 — 조건·대상·예외까지 적은 확장 설명. `node.desc` 한 줄보다 길고, **구현이 실제로
   * 하는 것**을 적는다(설계서가 약속했지만 구현되지 않은 축은 적지 않는다 — M5 의 "거리"가 그 예).
   */
  readonly body: string;
  /** 레벨 스케일 — 공식 문장. 값이 아니라 **모양**이라 레벨과 무관하다. */
  readonly scale: string;
  /**
   * 주어진 레벨에서의 **실수치** 줄들. 화면이 현재 레벨과 만렙 두 번 부른다.
   * 레벨 0(미투자)에서도 불린다 — "1포인트를 넣으면 얼마인가"는 `values(1)` 이 답한다.
   */
  readonly values: (level: number) => readonly string[];
  /** 1포인트의 가치 — 첫 투자가 무엇을 바꾸는가. */
  readonly lv1: string;
  /** 만렙 몰빵의 가치 — 20포인트를 다 넣으면 무엇이 되는가. */
  readonly max: string;
}

/** `+12%` 처럼 **증분** bp 를 퍼센트로. 소수 첫째 자리까지(0.5%p 계단이 있다). */
function incPct(bp: number): string {
  const pct = bp / 100;
  return `+${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/** `×1.31` 처럼 **배율** bp 를(10000 = ×1.00). */
function multX(bp: number): string {
  return `×${(bp / 10000).toFixed(2)}`;
}

/** `31%` 처럼 **배율** bp 를 "원본의 몇 %"로(10000 = 100%). */
function ofPct(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/** 틱 → "N틱(≈X.X초)". 60틱 = 1초. */
function ticks(n: number): string {
  return `${n}틱(≈${(n / 60).toFixed(1)}초)`;
}

/** F2 창은 대시 쿨다운의 비율이라 기준 쿨다운이 필요하다. 파워업 미적용 기본값을 쓴다. */
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
    body: '적을 처치할 때마다 정조준 사이클 카운터가 즉시 충전된다. 처치 경로를 가리지 않는다 — 탄 명중·화상·전격·폭탄 기물로 죽은 적도 전부 센다.',
    scale: '처치당 충전 = 1 + ⌈Lv/4⌉ (4레벨 폭 정수 계단)',
    values: (lv) => [`처치당 충전 +${killMomentumCharge(lv)}`],
    lv1: '처치마다 +2 — 난전에서 정조준 빈도가 눈에 띄게 오른다.',
    max: '처치 2기가 곧 정조준 1회. 웨이브 청소가 정조준 연쇄가 된다.',
  },
  'recoil-carry': {
    body: '대시 직후 짧은 창 동안 발사한 볼리가 확산 0 으로 집속되고(부채꼴이 한 줄기가 된다) 피해·탄속이 오른다. 레일건·빔은 확산을 안 읽어 집속은 무연산이고 증폭만 받는다.',
    scale: '창 = ⌊대시 쿨다운 × (30% + 25%×Lv/(Lv+10))⌉ 틱 · 피해 +10% + 1%p/Lv',
    values: (lv) => [
      `집속 창 ${ticks(recoilWindowTicks(lv, BASE_DASH_CD))} (기본 쿨다운 ${BASE_DASH_CD}틱 기준)`,
      `창 내 피해 ${incPct(recoilDamageBp(lv))} · 탄속 ${multX(recoilSpeedMultBp(lv))}`,
    ],
    lv1: '"대시 → 즉시 사격" 습관에 보상이 붙는다. 집속 한 줄기만으로도 원거리 명중이 오른다.',
    max: '대시 순환 빌드의 주력 딜 창. 쿨다운을 줄이는 파워업과 같이 가도 창 비율이 유지된다.',
  },
  'vent-burst': {
    body: '화력 액티브 발동 틱에 주무기 쿨다운 잔여를 환급하고, 그 액티브 투사체가 정조준 강화를 받는다.',
    scale: 'fanStrike 탄 피해 +10% + 2%p/Lv · 쿨다운 환급은 레벨 무관 전액',
    values: (lv) => [`액티브 탄 피해 ${incPct(ventBurstBp(lv))}`, '주무기 쿨다운 잔여 전액 환급'],
    lv1: '액티브가 주무기 리듬을 끊지 않게 된다.',
    max: '액티브 발동이 곧 화력 정점 — 환급 + 최대 증폭이 한 틱에 겹친다.',
  },
  'shatter-round': {
    body: '관통 예산을 다 쓰고 소멸하는 탄이 그 자리에서 소형 폭발을 남긴다. 폭발 중심은 플레이어가 아니라 탄이다.',
    scale: '반경 60 + 6×Lv · 폭발 피해 = 탄 피해의 30% + 2%p/Lv',
    values: (lv) => [
      `폭발 반경 ${shatterRadius(lv)}`,
      `폭발 피해 = 탄 피해의 ${ofPct(shatterDamageBp(lv))}`,
    ],
    lv1: '관통 파워업·레일건 빌드에 공짜 광역이 붙는다.',
    max: '탄 하나하나가 유탄이 된다 — 다탄 볼리일수록 총량이 커진다.',
  },
  'sightline-pierce': {
    body: '자동 조준 표적이 조준각 기준 반각 20° 콘 안일 때 발사되는 볼리가 관통 +1 과 피해 증폭을 얻는다. 관통은 발사 시점 1회이고 콘 밖 발사에 페널티는 없다.',
    scale: '콘 반각 20° 고정 · 관통 +1 고정 · 콘 내 피해 +6% + 1.5%p/Lv',
    values: (lv) => ['관통 +1 (콘 안)', `콘 내 피해 ${incPct(sightlineDamageBp(lv))}`],
    lv1: '관통 +1 이 즉시 온전한 가치다 — 페널티가 한 칸도 없다.',
    max: '단일 방향 화력 특화. 자동 조준과 조준각을 일치시키는 플레이가 보상받는다.',
  },
  'incendiary-mark': {
    body: '정조준탄이 명중한 적에게 화상을 부여하고, 이미 화상 중인 적이면 잔여 화상 피해를 즉시 일괄 정산하며 화상을 끝낸다. 보스에는 걸지 않는다 — 보스의 같은 필드가 과열 취약 창이라 F8 과 충돌한다.',
    scale: '부여 화상 틱당 피해 = 1 + ⌊Lv/4⌋ · 정산 배율 100% + 5%p/Lv',
    values: (lv) => [
      `부여 화상 틱당 ${incendiaryBurnPerTick(lv)} 피해`,
      `일괄 정산 = 잔여의 ${ofPct(incendiaryBurstMultBp(lv))}`,
    ],
    lv1: '장비 의존 없이 온전 작동한다 — 화상을 스스로 걸고 스스로 터뜨린다.',
    max: '"장전 → 기폭" 사이클이 굵어진다. 화염 어픽스 장비가 있으면 정산 루프가 더 커진다.',
  },
  'target-lock': {
    body: '같은 표적을 연속 명중할 때마다 그 표적 한정 피해 스택이 쌓인다. 표적이 바뀌면 스택은 초기화된다 — 관통 빌드와는 서로 밀어내는 관계다.',
    scale: `스택당 피해 +3% + 0.5%p/Lv · 스택 상한 ${TARGET_LOCK_STACK_CAP}`,
    values: (lv) => [
      `스택당 피해 ${incPct(targetLockPerStackBp(lv))}`,
      `상한 ${TARGET_LOCK_STACK_CAP}스택 = 최대 ${incPct(targetLockPerStackBp(lv) * TARGET_LOCK_STACK_CAP)}`,
    ],
    lv1: '보스·엘리트처럼 오래 사는 표적에 붙는 누적 딜.',
    max: '단일 표적 처형 특화 — 상한까지 쌓으면 볼리 피해가 배로 뛴다.',
  },
  'overheat-shatter': {
    body: '보스 과열 창 동안 명중할 때마다 창 잔여 틱을 연장한다. 이미 천장을 넘겨 서 있는 창은 깎지 않는다.',
    scale: `명중당 연장 = 1 + ⌊Lv/8⌋ 틱 · 잔여 천장 ${OVERHEAT_EXTEND_CAP}틱`,
    values: (lv) => [
      `명중당 창 +${overheatExtendTicks(lv)}틱`,
      `창 잔여 천장 ${ticks(OVERHEAT_EXTEND_CAP)}`,
    ],
    lv1: '다탄 볼리라 명중 수가 많아 1틱 연장도 창을 눈에 띄게 늘린다.',
    max: '보스 취약 창을 천장까지 끌고 간다 — 보스 처치 시간이 축째로 줄어든다.',
  },
  'suppress-shot': {
    body: '정조준탄이 명중한 적을 좌표 직접 변위로 밀어낸다. 방향은 가해 탄의 진행 방향이다. 보스와 엘리트는 절반만 밀린다. 구조물·설비는 안 밀린다.',
    scale: '넉백 = 24 + 4×Lv (보스·엘리트는 절반)',
    values: (lv) => [
      `넉백 ${suppressPush(lv)}`,
      `보스·엘리트 ${Math.round(suppressPush(lv) / 2)}`,
    ],
    lv1: '접근하는 적을 떼어 놓아 생존 여유가 생긴다.',
    max: '전열을 통째로 밀어내 근접 압박이 성립하지 않게 된다.',
  },
  'extended-mag': {
    body: '정조준 볼리를 발사한 틱에 같은 방향으로 후속 볼리 1회를 즉시 추가 발사한다. 주무기 쿨다운을 한 비트도 소비하지 않는다.',
    scale: '후속 볼리 피해 배율 = 100% − 1200%/(Lv+19) (쌍곡선 · 저레벨이 가파르다)',
    values: (lv) => [`후속 볼리 피해 = 본 볼리의 ${ofPct(extendedMagBp(lv))}`],
    lv1: '정조준마다 볼리가 두 번 나간다 — 피해 40%짜리라도 명중 수가 두 배다.',
    max: '정조준 한 번이 사실상 볼리 1.7회분. 다탄 무기일수록 총량이 커진다.',
  },

  // ── 생존 ────────────────────────────────────────────────────────────────
  'retaliation-sight': {
    body: 'HP 가 실제로 깎인 피격 틱에 정조준 사이클 카운터가 만충된다. 무적프레임에 막힌 피격은 대상이 아니다.',
    scale: '레벨 손잡이가 없다 — 만충은 만충이다(설계 문면이 「만충」이라 벌릴 축이 없다).',
    values: () => ['피격 시 사이클 즉시 만충'],
    lv1: '1포인트로 효과가 온전하다 — 더 넣어도 같다.',
    max: '추가 투자에 이득이 없다. 1포인트만 넣고 다른 스킬로 가라.',
  },
  'reactive-plating': {
    body: 'HP 가 깎인 피격 틱에 주변 적탄을 소거한다. 피격당한 그 순간의 탄막을 지워 연쇄 피격을 끊는다.',
    scale: '소거 반경 = 90 + 8×Lv',
    values: (lv) => [`적탄 소거 반경 ${reactivePlatingRadius(lv)}`],
    lv1: '한 방 맞고 이어 맞는 연쇄를 끊는다.',
    max: '피격이 곧 화면 정리 — 탄막 밀도가 높은 후반 구간에서 체감이 크다.',
  },
  'field-triage': {
    body: '엘리트를 처치하면 HP 를 회복한다.',
    scale: '회복 = 4 + Lv',
    values: (lv) => [`엘리트 처치당 HP +${fieldTriageHeal(lv)}`],
    lv1: '엘리트를 잡을 때마다 +5 — 장기 런의 누수를 메운다.',
    max: '엘리트 처치가 곧 회복 수단. 엘리트가 잦은 구간에서 유지력이 선다.',
  },
  'cover-doctrine': {
    body: '벽에 접촉 중일 때 피격되면 받는 피해가 감소한다. 판정은 직전 틱의 벽 접촉이다.',
    scale: '피해 감소 = 10% + 1%p/Lv',
    values: (lv) => [`벽 접촉 중 받는 피해 −${ofPct(coverDoctrineCutBp(lv))}`],
    lv1: '벽을 끼고 싸우는 자리 선택에 보상이 붙는다.',
    max: '벽 근처가 사실상 안전지대 — 자리 잡는 플레이가 성립한다.',
  },
  'hazard-adapt': {
    body: '감속 장판이 가속 장판으로 역전되고 용암 등 해저드 피해가 경감된다. 감속 면역이 아니라 부호 반전이다.',
    scale: '해저드 피해 −15% − 1.5%p/Lv · 장판 위 이동 배율 ×1.15 + 0.015/Lv',
    values: (lv) => [
      `해저드 피해 −${ofPct(hazardCutBp(lv))}`,
      `감속 장판 위 이동 ${multX(hazardSpeedMultBp(lv))}`,
    ],
    lv1: '장판이 함정에서 이점으로 바뀐다.',
    max: '해저드가 깔린 행성이 오히려 유리한 무대가 된다.',
  },
  'sustain-field': {
    body: '생존 액티브가 지속되는 동안 자석 반경이 커지고 이동 감속에 면역이 된다.',
    scale: '레벨 손잡이가 없다 — 설계 문면이 「면역」이라 벌릴 축이 없다(S1 과 같은 사유).',
    values: () => ['액티브 지속 중 자석 강화 + 감속 면역'],
    lv1: '1포인트로 효과가 온전하다 — 더 넣어도 같다.',
    max: '추가 투자에 이득이 없다. 1포인트만 넣고 다른 스킬로 가라.',
  },
  'last-rites': {
    body: '자기 HP 가 30% 이하인 동안, 정조준탄이 잔여 HP 임계 이하의 적을 즉시 처치한다.',
    scale: '처형 임계 = 대상 최대 HP의 5% + 0.5%p/Lv (자기 HP 30% 이하일 때만)',
    values: (lv) => [
      `처형 임계 = 대상 최대 HP의 ${ofPct(lastRitesThresholdBp(lv))}`,
      '발동 조건: 자기 HP 30% 이하',
    ],
    lv1: '위기 상황에서 마무리가 빨라져 반격 창이 열린다.',
    max: '저체력 상태가 곧 처형 상태 — 하이리스크 빌드의 핵심축.',
  },
  'combo-shield': {
    body: '피격 시 콤보 스택을 소모해 피해를 흡수하고, 정조준 볼리를 발사하면 콤보 유지 창이 연명된다.',
    scale: '스택당 흡수 = ⌊3 + 40×Lv/(Lv+20)⌉ (Lv20 = 23 · 점근 43)',
    values: (lv) => [`콤보 스택 1개당 피해 ${comboAbsorbPerStack(lv)} 흡수`],
    lv1: '콤보를 쌓는 플레이가 곧 방어가 된다.',
    max: '고콤보 유지 시 피격 한 번을 통째로 지운다.',
  },
  'expiry-stasis': {
    body: '생존 액티브가 끝나는 틱에 반경 내 적의 이동이 정지한다. 액티브의 뒤끝이 공격 기회가 된다.',
    scale: '정지 45 + 5×Lv 틱 · 반경 160 + 12×Lv',
    values: (lv) => [`정지 ${ticks(expiryStasisTicks(lv))}`, `반경 ${expiryStasisRadius(lv)}`],
    lv1: '액티브가 끝나도 손해가 없다 — 빠져나올 틈이 생긴다.',
    max: '액티브 종료가 곧 광역 제어. 반경이 화면 절반에 육박한다.',
  },
  'hull-accretion': {
    body: `런 누적 획득 XP 가 임계를 넘길 때마다 최대 HP 가 런 내 영구 증가한다. 임계는 ${HULL_XP_THRESHOLD} XP 마다이고 한 번에 여러 번 넘기면 그만큼 여러 번 지급된다.`,
    scale: `${HULL_XP_THRESHOLD} XP 당 최대 HP + ⌊2 + 24×Lv/(Lv+28)⌉ (Lv20 = 12 · 점근 26)`,
    values: (lv) => [
      `${HULL_XP_THRESHOLD} XP 마다 최대 HP +${hullGrantHp(lv)}`,
      `XP 4000 시점 누적 +${hullGrantHp(lv) * 10}`,
    ],
    lv1: '런이 길어질수록 조용히 두꺼워진다.',
    max: '후반 구간의 체력이 초반의 배 이상 — 장기 런 전용 성장축.',
  },

  // ── 기동 ────────────────────────────────────────────────────────────────
  'inertia-burst': {
    body: '기동 액티브 발동 시 **출발 지점**에 폭발과 적탄 소거를 남긴다. 2단 도약이어도 출발 지점은 하나라 한 번만 터진다.',
    scale: '반경 120 + 10×Lv · 피해 20 + 4×Lv',
    values: (lv) => [`폭발 반경 ${inertiaBurstRadius(lv)}`, `폭발 피해 ${inertiaBurstDamage(lv)}`],
    lv1: '탈출과 동시에 뒤를 정리한다.',
    max: '도주기가 곧 광역 폭딜 — 포위를 뚫는 수단이 된다.',
  },
  'thrust-wake': {
    body: `대시 발동 틱에 대시 방향으로 **정지 발사체 열**을 깐다. 속도 0 이라 그 자리에 머문다. 간격은 ${THRUST_WAKE_SPACING} 고정이다.`,
    scale: '개수 2 + ⌊Lv/4⌋ · 1발 피해 10 + 3×Lv · 수명 60 + 4×Lv 틱',
    values: (lv) => [
      `정지 탄 ${thrustWakeCount(lv)}발 · 간격 ${THRUST_WAKE_SPACING}`,
      `1발 ${thrustWakeDamage(lv)} 피해 · 수명 ${ticks(thrustWakeLife(lv))}`,
      `한 번 대시당 총 ${thrustWakeCount(lv) * thrustWakeDamage(lv)} 피해`,
    ],
    lv1: '대시 경로가 지뢰밭이 된다 — 추격자에게 그대로 꽂힌다.',
    max: '대시를 돌릴수록 화면에 정지 탄이 쌓인다. 지역 장악형 빌드.',
  },
  'gem-route': {
    body: '젬을 수거할 때마다 대시 쿨다운이 즉시 감소한다.',
    scale: '젬 1개당 감소 = 2 + ⌊Lv/2⌋ 틱',
    values: (lv) => [
      `젬 1개당 대시 쿨다운 −${gemRouteCut(lv)}틱`,
      `젬 ${Math.ceil(BASE_DASH_CD / gemRouteCut(lv))}개면 쿨다운 1회분(기본 ${BASE_DASH_CD}틱)`,
    ],
    lv1: '젬을 줍는 동선이 곧 대시 자원이 된다.',
    max: '젬 4개면 대시가 다시 찬다 — 사실상 상시 대시.',
  },
  slipstream: {
    body: '자석장이 이동 방향으로 길어져 진행 방향 전방의 흡인 반경이 확장된다. 옆·뒤는 그대로라 비등방이다.',
    scale: '전방 흡인 반경 배율 = ×1.30 + 0.02/Lv',
    values: (lv) => [`진행 방향 전방 흡인 반경 ${multX(slipstreamExtMultBp(lv))}`],
    lv1: '달리면서 줍는 양이 늘어난다.',
    max: '전방 반경이 1.7배 — 이동만으로 젬이 빨려 든다.',
  },
  'wall-kick': {
    body: '직전 틱에 벽 슬라이드가 일어난 상태에서 대시하면 무적프레임이 추가된다. 조건은 벽에 붙어 있는 것이 아니라 **직전 틱의 슬라이드**다. 대시 이동 거리는 변하지 않는다 — 늘어나는 것은 무적 시간뿐이다.',
    scale: '추가 무적프레임 = 2 + ⌊Lv/4⌋ 틱 (벽 접촉 중 대시 한정)',
    values: (lv) => [`벽에서 대시 시 무적프레임 +${wallKickIframes(lv)}틱`],
    lv1: '벽을 낀 대시가 더 안전해진다.',
    max: '벽 대시가 탄막 관통 수단이 된다.',
  },
  'dash-purge': {
    body: '대시에 잔상 소거를 자체 부여하고, 소거 반경 안의 적에게 냉기를 건다.',
    scale: '소거·냉기 반경 = 150 + 10×Lv',
    values: (lv) => [`대시 소거 반경 ${dashPurgeRadius(lv)}`],
    lv1: '대시 한 번이 곧 탄막 청소 + 감속.',
    max: '반경 350 — 대시 경로 주변이 통째로 비워진다.',
  },
  'signal-chaser': {
    body: '에코·조우가 활성인 동안 대시 쿨다운이 반감되고, 안정화를 완수하면 쿨다운이 전액 환급된다.',
    scale: '레벨 손잡이가 없다 — 설계 문면이 「반감」·「전액 환급」이라 벌릴 축이 없다.',
    values: () => ['에코·조우 중 대시 쿨다운 절반', '안정화 완수 시 쿨다운 전액 환급'],
    lv1: '1포인트로 효과가 온전하다 — 더 넣어도 같다.',
    max: '추가 투자에 이득이 없다. 1포인트만 넣고 다른 스킬로 가라.',
  },
  'vault-shot': {
    body: '2단 도약의 단 사이에 조준 방향으로 정조준 볼리 1회를 자동 발사한다. 주무기 쿨다운을 소비하지 않는다.',
    scale: '자동 볼리 피해 배율 = 60% + 3%p/Lv',
    values: (lv) => [`자동 볼리 피해 = 본 볼리의 ${ofPct(vaultShotBp(lv))}`],
    lv1: '2단 도약에 공짜 볼리가 붙는다(63%).',
    max: '도약 볼리가 본 볼리보다 세다(120%) — 기동이 곧 화력.',
  },
  'ram-maneuver': {
    body: '무적프레임 동안 몸통 충돌이 역전돼, 접촉한 적이 피해를 받는다.',
    scale: '충돌 피해 = 10 + 3×Lv',
    values: (lv) => [`무적 중 접촉 피해 ${ramManeuverDamage(lv)}`],
    lv1: '대시로 뚫고 지나가며 긁는다.',
    max: '대시가 곧 돌격기 — 밀집 대열을 관통하며 전부 때린다.',
  },
  'twin-thruster': {
    body: '대시가 충전식 2회가 된다. 두 번째 충전은 별도의 느린 재충전을 따르고, 소비 순서는 기본 충전이 먼저다.',
    scale: '2번째 충전 재충전 = 240 + ⌊4000/(Lv+5)⌋ 틱 (Lv1 = 906 · Lv20 = 400 · 점근 240)',
    values: (lv) => [`2번째 충전 재충전 ${ticks(twinRechargeTicks(lv))}`],
    lv1: '연속 대시 2회가 가능해진다 — 다만 두 번째는 15초에 한 번.',
    max: '두 번째 대시가 6.7초마다 — 회피 실수 한 번을 덮을 여유가 상시 생긴다.',
  },
};

/**
 * 기체 slug + 스킬 id → 상세. 없으면 `null`(화면이 종전 한 줄로 내려앉는다).
 *
 * ⚠️ **기체 slug 로 먼저 가른다.** 스킬 id 는 전역 유니크하도록 저작돼 있지만, 그 규율이
 * 깨지는 날 조용히 남의 기체 문안을 보여 주는 것보다 안 보여 주는 편이 낫다.
 */
export function skillDetailOf(shipSlug: string, skillId: string): SkillDetail | null {
  if (shipSlug !== 'striker') return null;
  const prefix = `${shipSlug}-`;
  // 접두사가 **반드시** 붙어 있어야 한다. 없는 id 를 그대로 조회하면 다른 기체의 id 형식이
  // 바뀌는 날 조용히 남의 문안을 집는다.
  if (!skillId.startsWith(prefix)) return null;
  return STRIKER_SKILL_DETAIL[skillId.slice(prefix.length)] ?? null;
}
