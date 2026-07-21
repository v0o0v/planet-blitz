/**
 * 수호 기체 생애주기 — 퇴역·소멸·계보 투자·방어 배치 (M5 plan Phase A2/A3/A5, ADR-0007).
 *
 * 로컬 세이브(Profile) 위에서 도는 순수 상태 전이 함수들. 서버 정본은 RPC(retire_ship·
 * dismiss_guardian·invest_lineage — supabase/migrations/20260718100000)이며, 이 층은 오프라인
 * 즉시 반영 + 서버 동기화 전 낙관적 갱신용 미러다(credits/items 가 로컬 정본인 것과 동일 모델).
 *
 * 생애주기 순환(ADR-0007): 퇴역({@link retireActiveShip}) → 풍화(서버 cron weather_guardians) →
 * 소멸({@link dismissGuardianRecord}) → 계보 강화({@link investLineageBranch}) → 다음 세대가
 * 더 강함. 자동 소멸 없음(소멸은 유저 행동만). 리스펙 없음(계보는 순환 재화).
 *
 * 결정론: 전투력 점수·스냅샷·소멸 포인트는 순수 정수 함수(data/guardian.ts + combatPower.ts).
 * 유일한 비결정 요소는 신규 수호 레코드의 로컬 id(표시용) — 서버 생성 시 서버 id 로 대체된다.
 */

import type { Profile, GuardianRecord, Ship } from './profile.js';
import { totalCombatPower } from './combatPower.js';
import type { Item } from '../items/types.js';
import {
  makeGuardianSnapshot,
  dismissPoints,
  PERFORMANCE_FULL,
  GUARDIAN_TITAN,
  normalizeGuardianPreset,
  MAX_GUARDIAN_SLOTS,
} from '../../data/guardian.js';
import type { GuardianPlacement } from '../sim/invasion/guardian.js';
import {
  grantPoints,
  investLineage,
  canInvest,
  guardianBonusBp,
  guardianMilestones,
  RETIRE_LINEAGE_GRANT,
} from '../../data/lineage.js';
import type { LineageBranch } from '../../data/lineage.js';
import { activeShip, zeroSkillInvest } from './profile.js';
import { normalizeShipTypeId } from '../../data/ships/index.js';

/** 스킬 투자 1점당 전투력 가산(빌드 깊이 반영, OQ-M5-2 기본안). 튜닝 대상(§5). */
const SKILL_DEPTH_WEIGHT = 4;

/** 활성(미소멸) 수호 기체만 추린다(방어 참전·소멸 대상). */
export function activeGuardians(profile: Profile): GuardianRecord[] {
  return profile.guardians.filter((g) => !g.retired);
}

/**
 * 활성 기체의 퇴역 전투력 점수 = 장착 장비 전투력(totalCombatPower — 단일 정본) + 스킬 빌드 깊이.
 * 순수 정수. 좋은 장비·깊은 빌드로 퇴역할수록 강한 수호기·높은 회수가치(ADR-0007 R8).
 */
export function retirementCombatScore(profile: Profile): number {
  const ship = activeShip(profile);
  const equipped: Item[] = Object.values(ship.equipped).filter((it): it is Item => it !== undefined);
  let skillDepth = 0;
  // M8 v4: 투자 정본은 기체 벡터다(계정 단위 `Profile.skillInvest` 는 M8-L7 이 삭제했다).
  for (const v of ship.skillInvest) skillDepth += v;
  const score = totalCombatPower(equipped) + skillDepth * SKILL_DEPTH_WEIGHT;
  return score < 1 ? 1 : score;
}

/** 결과: 생성된 수호 기체 + 지급 계보 포인트 + 새로 배치된 후속 기체. */
export interface RetireResult {
  guardian: GuardianRecord;
  granted: number;
  /** 퇴역 후 활성이 된 신규 기체(M8 — 세대 교체). */
  ship: Ship;
}

/**
 * 활성 기체를 퇴역시킨다(ADR-0007 R8 + M8 세대 교체): 전투력 점수로 복사 스냅샷 생성 →
 * 수호 기체 추가(성능 100%) → 계보 기본 지급(+{@link RETIRE_LINEAGE_GRANT}) → 장착 장비
 * 창고 반환 → **`nextTypeId` 의 신규 기체를 push 하고 활성으로 이동**.
 *
 * preset(0 타이탄/1 인터셉터)은 수호 기체 프리셋 선택제(OQ-M5-3). `nextTypeId` 는 다음 세대로
 * 탈 기체 타입(ADR-0019 — 전체 개방, 해금 조건 없음); 범위 밖이면 0(스트라이커)으로 clamp 된다.
 *
 * ⚠️ **의도된 거동 변경(M8)**: 이전 구현은 수호 스냅샷·계보·장비 회수까지만 하고 **같은 기체를
 * 그대로 활성으로 남겼다** — "다음 기체" 라는 개념이 모델에 없었다. 이제 퇴역은 진짜 세대
 * 교체다: 새 기체는 level 1 · xp 0 · 장비 없음 · 투자 전 0 에서 시작한다(퇴역 = 세대 리셋,
 * CONTEXT.md §86-87). 세대를 관통하는 성장은 계보가 담당한다.
 *
 * Profile 을 제자리 변형하고 결과를 반환한다.
 */
export function retireActiveShip(
  profile: Profile,
  preset: number = GUARDIAN_TITAN,
  nextTypeId = 0,
): RetireResult {
  const p = normalizeGuardianPreset(preset);
  const score = retirementCombatScore(profile);
  const snapshot = makeGuardianSnapshot(p, score);
  const guardian: GuardianRecord = {
    id: makeLocalGuardianId(profile),
    snapshot,
    performanceCP: PERFORMANCE_FULL,
    combatScore: score,
    preset: p,
    retired: false,
  };
  profile.guardians.push(guardian);
  profile.lineage = grantPoints(profile.lineage, RETIRE_LINEAGE_GRANT);
  // 장비 원본 자동 창고 반환(ADR-0007) — 장착 슬롯을 비우고 stash 로 옮긴다.
  const ship = activeShip(profile);
  for (const key of Object.keys(ship.equipped) as (keyof typeof ship.equipped)[]) {
    const it = ship.equipped[key];
    if (it !== undefined) profile.stash.push(it);
    delete ship.equipped[key];
  }
  // 세대 교체: 신규 기체를 만들어 활성으로 옮긴다. 타입은 레지스트리 유효 범위로 clamp 한다.
  // ⚠️ 이것은 **해금 게이트가 아니라 손상 입력 방어**다 — ADR-0019 는 전체 개방이 명시적
  // 결정이므로 여기에 레벨·진행도 조건을 붙이면 결정 위반이다(테스트가 못박고 있다).
  const typeId = normalizeShipTypeId(nextTypeId);
  const next: Ship = {
    id: makeLocalShipId(profile),
    name: ship.name,
    typeId,
    level: 1,
    xp: 0,
    equipped: {},
    skillInvest: zeroSkillInvest(typeId),
  };
  profile.ships.push(next);
  profile.activeShipIndex = profile.ships.length - 1;
  return { guardian, granted: RETIRE_LINEAGE_GRANT, ship: next };
}

/** 결과: 회수된 계보 포인트(소멸 실패 시 0 + dismissed=false). */
export interface DismissResult {
  dismissed: boolean;
  points: number;
}

/**
 * 수호 기체를 소멸(회수)한다(ADR-0007 R3/R5): 계보 포인트 = 전투력 × 남은 성능(dismissPoints).
 * 상시 가능하되 이미 소멸했거나 없는 id 는 no-op. 성공 시 retired=true + 계보 available 증가.
 */
export function dismissGuardianRecord(profile: Profile, id: string): DismissResult {
  const g = profile.guardians.find((x) => x.id === id);
  if (g === undefined || g.retired) return { dismissed: false, points: 0 };
  const points = dismissPoints(g.combatScore, g.performanceCP);
  g.retired = true;
  profile.lineage = grantPoints(profile.lineage, points);
  return { dismissed: true, points };
}

/**
 * 활성 수호 기체를 일괄 소멸한다(퇴역 플로우의 "기존 수호 일괄 소멸" UI, ADR-0007 R3). 각 개체의
 * 성능 비례 포인트를 합산 회수한다. 반환: {count, points}.
 */
export function bulkDismissGuardians(profile: Profile): { count: number; points: number } {
  let count = 0;
  let points = 0;
  for (const g of profile.guardians) {
    if (g.retired) continue;
    points += dismissPoints(g.combatScore, g.performanceCP);
    g.retired = true;
    count++;
  }
  if (points > 0) profile.lineage = grantPoints(profile.lineage, points);
  return { count, points };
}

/** 계보 한 가지에 1레벨 투자(포인트 부족 시 no-op, 리스펙 없음 — ADR-0007 R2/R4). */
export function investLineageBranch(profile: Profile, branch: LineageBranch): boolean {
  if (!canInvest(profile.lineage, branch)) return false;
  profile.lineage = investLineage(profile.lineage, branch);
  return true;
}

/**
 * 방어 배치용 수호 배치(GuardianPlacement[])를 만든다. 활성 수호 기체(미소멸) 중 앞에서
 * 최대 {@link MAX_GUARDIAN_SLOTS}기를 골라, 각자 스냅샷·현재 성능%·계보 수호 가지 보너스를
 * 실어 sim 이 소비할 배치로 변환한다(갈림길①A — config 가 스냅샷+성능%+보너스를 담는다).
 * `positions`는 배치 좌표(방어 사령부 에디터가 정한다); 부족하면 마지막 좌표를 재사용한다.
 */
export function buildGuardianPlacements(
  profile: Profile,
  positions: readonly { x: number; y: number }[],
): GuardianPlacement[] {
  const bonusBp = guardianBonusBp(profile.lineage);
  // 계보 수호 가지 레벨 → 해금된 마일스톤 비트마스크(레벨 도달 자동 해금). 계정 단위라 참전 수호
  // 전원이 동일 마스크를 받는다(lineageBonusBp 와 동일 — 개체가 아닌 계정에 쌓인다). 0 이면
  // 마일스톤 없음 = config 에 실려도 sim 거동·해시 완전 불변(하위 호환).
  const milestones = guardianMilestones(profile.lineage.guardianLevel);
  const active = activeGuardians(profile);
  const n = active.length < MAX_GUARDIAN_SLOTS ? active.length : MAX_GUARDIAN_SLOTS;
  const out: GuardianPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const g = active[i]!;
    const pos = positions[i] ?? positions[positions.length - 1] ?? { x: 0, y: 0 };
    out.push({
      x: pos.x,
      y: pos.y,
      snapshot: g.snapshot,
      performanceCP: g.performanceCP,
      lineageBonusBp: bonusBp,
      milestones,
    });
  }
  return out;
}

/**
 * 로컬 수호 기체 id 생성(표시용). 서버 생성 시 guardians.id(uuid)로 대체된다. 결정 불필요한
 * 순수 표시 식별자라 wall-clock + 인덱스로 충분히 유일하다(save 층은 시계 사용 허용).
 */
function makeLocalGuardianId(profile: Profile): string {
  return `g-${Date.now().toString(36)}-${profile.guardians.length}`;
}

/**
 * 신규(후속 세대) 기체의 로컬 id 생성. 수호 id 와 같은 규율 — 표시·참조용 순수 식별자라
 * 결정론 대상이 아니고, save 층은 시계 사용이 허용된다(ADR-0005 는 sim/data 에만 적용).
 */
function makeLocalShipId(profile: Profile): string {
  return `ship-${Date.now().toString(36)}-${profile.ships.length}`;
}
