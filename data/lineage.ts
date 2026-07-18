/**
 * 계보 트리 — 세대를 거듭할수록 강해지는 계정 단위 성장(M5 plan Phase A5, ADR-0007).
 *
 * 계보는 구 계승 특전을 흡수한 **단일 시스템**이다(ADR-0007 R6). 두 가지:
 *   - **기체 가지(ship)**: 내 현역 기체를 소폭 강화(로드아웃 빌드 시 외부 적용 — sim 밖).
 *   - **수호 가지(guardian)**: 현재·미래 **모든** 수호 기체를 강화(방어전 config 가 소비 —
 *     data/guardian.ts resolveGuardianStats 의 lineageBonusBp). 개체가 아닌 계정에 쌓이므로
 *     수호 소멸과 무모순(ADR-0007 R2).
 *
 * 수치 구조(갈림길②A · ADR-0007 R4): **무한 투자 + 로그형 점근**. 각 가지 보너스 총합은
 * +50%(=5000 basis-point)에 점근 수렴하되 절대 초과하지 않아(무한 성장감 + PvP 고착화 방지,
 * GDD §1 공정성 우선), 리스펙은 없다(순환 재화 — ADR-0007 R2). 포인트 원천: 퇴역 기본 지급 +
 * 수호 소멸 회수(성능 비례, data/guardian.ts dismissPoints).
 *
 * 이 모듈은 **순수 결정론 정수 연산**이다(무작위·시계·pixi 없음). 서버·클라이언트가 동일 곡선을
 * 재현해 방어전 config 의 계보 보너스를 검증 가능하게 한다.
 */

/** 가지 식별자. */
export type LineageBranch = 'ship' | 'guardian';

/** 보너스 점근 상한(basis-point) = +50%(ADR-0007 R4 📝 점근형). 어떤 레벨에서도 초과 불가. */
export const LINEAGE_BONUS_CAP_BP = 5000;

/**
 * 점근 곡선 반감 레벨 K: 이 레벨에서 보너스가 상한의 절반(+25%)에 도달한다(로그형 감소수익).
 * 곡선 = CAP × L / (L + K). L→∞ 에서 CAP 에 점근(도달하지 않음), L=K 에서 CAP/2. 튜닝 대상(§5).
 */
export const LINEAGE_HALF_LEVEL = 20;

/** 퇴역 시 기본 지급 계보 포인트(ADR-0007 R6 · 스펙 §Constraints). */
export const RETIRE_LINEAGE_GRANT = 50;

/**
 * 계보 상태(계정 단위). 리스펙이 없으므로 레벨은 단조 증가만 한다. `available`는 아직 쓰지 않은
 * 포인트(퇴역 지급 + 소멸 회수 - 투자 소비). `spent`는 감사·UI 표시용 누적 소비.
 */
export interface LineageState {
  /** 기체 가지 누적 투자 레벨(단조 증가). */
  shipLevel: number;
  /** 수호 가지 누적 투자 레벨(단조 증가). */
  guardianLevel: number;
  /** 미사용 계보 포인트(투자에 소비 가능). */
  available: number;
  /** 누적 소비 포인트(표시·감사용). */
  spent: number;
}

/** 빈 계보 상태(신규 계정). */
export function emptyLineage(): LineageState {
  return { shipLevel: 0, guardianLevel: 0, available: 0, spent: 0 };
}

/**
 * 가지의 다음 레벨 투자 비용(포인트). 레벨이 오를수록 완만히 비싸진다(무한 투자를 허용하되
 * 포인트 요구가 늘어 로그형 곡선과 함께 실질 격차를 통제). 결정론 정수. 비용 = 40 + level×10.
 */
export function nextLevelCost(currentLevel: number): number {
  const l = currentLevel < 0 ? 0 : Math.trunc(currentLevel);
  return 40 + l * 10;
}

/**
 * 누적 투자 레벨 → 보너스(basis-point, 로그형 점근). CAP × L / (L + K), 결정론 정수(내림 —
 * 상한 근처에서 오버슈트 방지). L=0 → 0, L=K → CAP/2, L→∞ → CAP 에 점근(초과 없음).
 */
export function branchBonusBp(level: number): number {
  const l = level < 0 ? 0 : Math.trunc(level);
  if (l === 0) return 0;
  const bp = Math.floor((LINEAGE_BONUS_CAP_BP * l) / (l + LINEAGE_HALF_LEVEL));
  return bp > LINEAGE_BONUS_CAP_BP ? LINEAGE_BONUS_CAP_BP : bp;
}

/** 수호 가지 현재 보너스(모든 수호 기체에 적용 — 방어전 config 가 소비). */
export function guardianBonusBp(state: LineageState): number {
  return branchBonusBp(state.guardianLevel);
}

/** 기체 가지 현재 보너스(내 현역 기체 강화 — 로드아웃 빌드 시 외부 적용). */
export function shipBonusBp(state: LineageState): number {
  return branchBonusBp(state.shipLevel);
}

// ---------------------------------------------------------------------------
// 수호 가지 마일스톤 질적 노드(GDD §4, ADR-0007) — 레벨 도달 시 자동 해금(별도 투자 없음).
// ---------------------------------------------------------------------------
/**
 * 마일스톤 비트마스크(방어전 config 로 실린다 — DefensePlacement 의 lineageBonusBp 와 동일 철학).
 * sim 은 profile 을 읽지 않고 이 마스크만 소비한다(서버 리플레이 재현 가능). 비트 코드는 배치
 * JSON·해시 계약이라 **절대 재번호 금지**.
 */
/** ① 격추 재기동: 수호 기체 HP 0 도달 시 방어전당 1회 부활(부활 HP·딜레이는 data/guardian.ts). */
export const MILESTONE_REBOOT = 1;
/** ② 코어 근접 수비: 코어 반경 내에서 수호 기체 피해·연사 강화(data/guardian.ts). */
export const MILESTONE_CORE_GUARD = 2;
/** ③ 실드 공유: 방어전 시작 시 코어·포탑에 수호 전투력 비례 실드 부여(data/guardian.ts). */
export const MILESTONE_SHIELD_SHARE = 4;
/** 정의된 마일스톤 비트 전체(마스크 정규화 상한 = 0b111 = 7). */
export const MILESTONE_MASK_ALL = MILESTONE_REBOOT | MILESTONE_CORE_GUARD | MILESTONE_SHIELD_SHARE;

/**
 * 마일스톤 해금 레벨(수호 가지). 반감 레벨 K=20 곡선과 어울리게 초·중·후반에 배치한다:
 *   - Lv{@link REBOOT_LEVEL}(격추 재기동) — 보너스 약 +16.7%(=CAP×10/30) 시점.
 *   - Lv{@link CORE_GUARD_LEVEL}(코어 근접 수비) — 보너스 약 +27.8%(=CAP×25/45) 시점.
 *   - Lv{@link SHIELD_SHARE_LEVEL}(실드 공유) — 보너스 약 +35.7%(=CAP×50/70) 시점.
 * 튜닝 대상(§5). 리스펙 없음(단조 증가)이라 한번 넘긴 레벨은 영구 해금이다.
 */
export const REBOOT_LEVEL = 10;
export const CORE_GUARD_LEVEL = 25;
export const SHIELD_SHARE_LEVEL = 50;

/**
 * 수호 가지 누적 레벨 → 해금된 마일스톤 비트마스크(결정론 정수). 레벨 도달만으로 자동 해금
 * (별도 투자 없음 — 리스펙 없음 원칙과 정합). 음수·소수는 안전 절삭한다.
 */
export function guardianMilestones(guardianLevel: number): number {
  const l = guardianLevel < 0 ? 0 : Math.trunc(guardianLevel);
  let m = 0;
  if (l >= REBOOT_LEVEL) m |= MILESTONE_REBOOT;
  if (l >= CORE_GUARD_LEVEL) m |= MILESTONE_CORE_GUARD;
  if (l >= SHIELD_SHARE_LEVEL) m |= MILESTONE_SHIELD_SHARE;
  return m;
}

/** 마일스톤 비트마스크를 [0, {@link MILESTONE_MASK_ALL}] 로 정규화(미지정·비유한·음수 = 0). */
export function normalizeMilestones(mask: number | undefined): number {
  if (mask === undefined || !Number.isFinite(mask)) return 0;
  const i = Math.trunc(mask);
  if (i <= 0) return 0;
  return i & MILESTONE_MASK_ALL;
}

/** 특정 마일스톤 비트가 켜져 있는지. */
export function hasMilestone(mask: number, bit: number): boolean {
  return (mask & bit) !== 0;
}

/** 포인트 지급(퇴역 기본 지급·소멸 회수). 음수 무시. 새 상태를 반환(불변 갱신). */
export function grantPoints(state: LineageState, amount: number): LineageState {
  const a = amount < 0 ? 0 : Math.trunc(amount);
  return { ...state, available: state.available + a };
}

/** 투자 가능 여부(다음 레벨 비용을 낼 포인트가 있는가). */
export function canInvest(state: LineageState, branch: LineageBranch): boolean {
  const level = branch === 'ship' ? state.shipLevel : state.guardianLevel;
  return state.available >= nextLevelCost(level);
}

/**
 * 한 가지에 1레벨 투자한다(리스펙 없음 — 단조 증가). 포인트가 부족하면 상태를 그대로 반환한다
 * (호출 측이 canInvest 로 사전 확인). 성공 시 available 차감 + spent 누적 + 해당 레벨 +1.
 */
export function investLineage(state: LineageState, branch: LineageBranch): LineageState {
  const level = branch === 'ship' ? state.shipLevel : state.guardianLevel;
  const cost = nextLevelCost(level);
  if (state.available < cost) return state;
  const next: LineageState = {
    ...state,
    available: state.available - cost,
    spent: state.spent + cost,
  };
  if (branch === 'ship') next.shipLevel = state.shipLevel + 1;
  else next.guardianLevel = state.guardianLevel + 1;
  return next;
}
