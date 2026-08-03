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

import type { Profile, GuardianRecord, GuardianBuild, Ship } from './profile.js';
import { totalCombatPower } from './combatPower.js';
import type { Item } from '../items/types.js';
import { computeLoadoutStats } from '../items/loadout.js';
import {
  mapLoadoutToGuardianSnapshot,
  dismissPoints,
  PERFORMANCE_FULL,
  GUARDIAN_TITAN,
  normalizeGuardianPreset,
  MAX_GUARDIAN_SLOTS,
} from '../../data/guardian.js';
import type { GuardianSnapshot } from '../../data/guardian.js';
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
import { LEVEL_CAP } from '../../data/waves.js';

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

/**
 * 퇴역에 필요한 활성 기체 레벨 = **만렙**({@link LEVEL_CAP}, `data/waves.ts` 정본).
 *
 * 별도 상수를 새로 만들지 않는다 — 만렙이 두 곳에 적히면 레벨 상한을 조정할 때 한쪽만 바뀌어
 * "퇴역이 영원히 잠기거나 만렙 전에 열리는" 조용한 결함이 된다.
 */
export const RETIRE_REQUIRED_LEVEL = LEVEL_CAP;

/** 퇴역 게이트 판정 결과 — 왜 막혔는지(현재/필요 레벨)를 화면이 그대로 보여줄 수 있게 담는다. */
export interface RetireGate {
  /** 퇴역 가능 여부. `level >= required` 와 동치. */
  ok: boolean;
  /** 현재 활성 기체 레벨. */
  level: number;
  /** 필요 레벨(= {@link RETIRE_REQUIRED_LEVEL}). */
  required: number;
}

/**
 * 활성 기체를 퇴역시킬 수 있는가 — **순수 판정**(Profile 무변형).
 *
 * 세대 교체는 되돌릴 수 없는 리셋(레벨·투자 초기화, 장비는 수호기에 잠김)이라, 성장을 다 쓰기
 * 전에 실행하면 그 세대의 진행이 통째로 사라진다. 그래서 만렙에서만 연다.
 *
 * 화면은 이 함수로 버튼을 잠그지만, 강제는 {@link retireActiveShip} 안에도 있다 — 이 프로젝트의
 * 반복 결함이 "UI 게이트만 있고 모델에는 없다" 이기 때문이다(하네스·치트·후속 호출부는 UI 를
 * 거치지 않는다).
 */
export function retireGate(profile: Profile): RetireGate {
  const level = activeShip(profile).level;
  return { ok: level >= RETIRE_REQUIRED_LEVEL, level, required: RETIRE_REQUIRED_LEVEL };
}

/** {@link retireGate} 의 불리언 축약. */
export function canRetireActiveShip(profile: Profile): boolean {
  return retireGate(profile).ok;
}

/** 결과: 생성된 수호 기체 + 지급 계보 포인트 + 새로 배치된 후속 기체. */
export interface RetireResult {
  guardian: GuardianRecord;
  granted: number;
  /** 퇴역 후 활성이 된 신규 기체(M8 — 세대 교체). */
  ship: Ship;
}

/**
 * 활성 기체를 퇴역시킨다(ADR-0007 R8 + M8 세대 교체 + ADR-0024 장비 잠김): 전투력 점수로 복사
 * 스냅샷 생성 → 실물 빌드(타입·장착 장비·스킬 투자)를 수호기에 잠금 → 수호 기체 추가(성능 100%)
 * → 계보 기본 지급(+{@link RETIRE_LINEAGE_GRANT}) → 활성 기체 장착 슬롯 비우기(장비는 stash 가
 * 아니라 `guardian.build.equipped` 에 봉인 — 소멸 시에만 stash 로 반환) →
 * **`nextTypeId` 의 신규 기체를 push 하고 활성으로 이동**.
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
 *
 * ⚠️ **만렙 게이트**: 활성 기체가 {@link RETIRE_REQUIRED_LEVEL} 미만이면 `null` 을 돌려주고
 * **Profile 을 전혀 건드리지 않는다**. 이 함수는 수호 스냅샷 · 계보 지급 · 장착 비우기 · 신규
 * 기체 push 를 한 덩어리로 하므로, 판정은 반드시 **모든 변형보다 앞**에 있어야 부분 변형이
 * 남지 않는다(중간에 거부하면 계보만 받고 기체는 그대로인 상태가 세이브된다).
 * 반환 타입이 nullable 인 것도 의도다 — 호출부가 거부를 무시하면 **컴파일이 막는다**.
 */
/**
 * 퇴역이 서버로 보낼 페이로드를 **변형 없이** 계산한다(ADR-0007 서버 권위 배선, 2026-08-03).
 *
 * ## 왜 따로 뽑았는가 — 순서가 뒤집히면 되돌릴 수 없다
 * `retire_ship` RPC 는 수호 행을 만들고 계보를 지급하는 **서버 확정**이고, 실패하면 로컬도
 * 움직이지 않아야 한다. 그런데 RPC 인자(전투력·스냅샷·빌드)는 **퇴역 전 기체 상태**에서만 나온다
 * — `retireActiveShip` 이 장착을 비우고 세대를 교체한 뒤에는 같은 값을 다시 만들 수 없다.
 * 그래서 "계산"과 "변형"을 갈라, 호출부가 [계산 → 서버 확정 → 변형] 순서를 지킬 수 있게 한다.
 *
 * 순수하다(제자리 변형 없음). 만렙 게이트에 걸리면 `null` — `retireActiveShip` 과 같은 판정을
 * 쓰므로 두 곳이 어긋날 수 없다.
 */
export function retirementPayload(
  profile: Profile,
  preset: number = GUARDIAN_TITAN,
): { preset: number; combatScore: number; snapshot: GuardianSnapshot; build: GuardianBuild } | null {
  if (!canRetireActiveShip(profile)) return null;
  const p = normalizeGuardianPreset(preset);
  const combatScore = retirementCombatScore(profile);
  // 퇴역 순간의 실물 빌드를 통째로 복사해 잠근다(ADR-0024) — 스냅샷 파생·장착 비우기 전에 캡처.
  // equipped 는 얕은 복사(Item 은 불변 데이터라 참조 공유 안전), skillInvest 는 벡터 복사.
  const ship = activeShip(profile);
  const build: GuardianBuild = {
    typeId: ship.typeId,
    equipped: { ...ship.equipped },
    skillInvest: ship.skillInvest.slice(),
    // 액티브 장착 2칸 박제(ADR-0041 · 계획 PM-3). `skillInvest` 만 복사하면 해금 조건은
    // 만족하는데 장착 상태만 없는 — "열려 있는데 안 끼워져 있는" — 가장 헷갈리는 형태가 된다.
    activeSlots: ship.activeSlots.slice(),
  };
  // ADR-0025: 방어 스냅샷은 실물 빌드 loadout 에서 파생한다(프리셋=이동 AI, 파워·발사체=빌드).
  // 계보 기체 가지(shipBonusBp)는 넘기지 않는다 — 수호 계보 보너스는 수호 가지이며 스폰 시
  // resolveGuardianStats 가 적용한다(스냅샷에 계보를 굽지 않는 기존 모델 유지 — 이중 계산 방지).
  const equippedItems: Item[] = Object.values(build.equipped).filter(
    (it): it is Item => it !== undefined,
  );
  const { loadout } = computeLoadoutStats(equippedItems, build.skillInvest, undefined, build.typeId);
  return { preset: p, combatScore, snapshot: mapLoadoutToGuardianSnapshot(p, loadout), build };
}

export function retireActiveShip(
  profile: Profile,
  preset: number = GUARDIAN_TITAN,
  nextTypeId = 0,
): RetireResult | null {
  // 게이트는 어떤 변형보다도 먼저(부분 변형 금지 — 위 주석 참조).
  if (!canRetireActiveShip(profile)) return null;
  const payload = retirementPayload(profile, preset);
  if (payload === null) return null;
  const { preset: p, combatScore: score, snapshot, build } = payload;
  const ship = activeShip(profile);
  const guardian: GuardianRecord = {
    id: makeLocalGuardianId(profile),
    snapshot,
    performanceCP: PERFORMANCE_FULL,
    combatScore: score,
    preset: p,
    retired: false,
    build,
  };
  profile.guardians.push(guardian);
  profile.lineage = grantPoints(profile.lineage, RETIRE_LINEAGE_GRANT);
  // 장비 잠김(ADR-0024) — 장착 장비는 stash 로 반환하지 않고 `guardian.build.equipped` 에
  // 봉인된다(소멸 시에만 stash 로 반환). 퇴역한 기체 로스터에 잔여 장비가 보이지 않도록
  // 활성 기체의 장착 슬롯만 비운다.
  for (const key of Object.keys(ship.equipped) as (keyof typeof ship.equipped)[]) {
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
    // 세대 교체 기체는 투자 0이라 열린 액티브가 없다 → 빈 슬롯 2칸.
    activeSlots: [null, null],
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
 * 상시 가능하되 이미 소멸했거나 없는 id 는 no-op. 성공 시 retired=true + 계보 available 증가 +
 * 잠긴 장비(build.equipped)를 stash 로 반환(ADR-0024, build 없는 구 수호기는 반환 없음).
 */
export function dismissGuardianRecord(profile: Profile, id: string): DismissResult {
  const g = profile.guardians.find((x) => x.id === id);
  if (g === undefined || g.retired) return { dismissed: false, points: 0 };
  const points = dismissPoints(g.combatScore, g.performanceCP);
  g.retired = true;
  profile.lineage = grantPoints(profile.lineage, points);
  returnLockedGear(profile, g);
  return { dismissed: true, points };
}

/**
 * 활성 수호 기체를 일괄 소멸한다(퇴역 플로우의 "기존 수호 일괄 소멸" UI, ADR-0007 R3). 각 개체의
 * 성능 비례 포인트를 합산 회수하고, 잠긴 장비(build.equipped)를 각각 stash 로 반환한다(ADR-0024).
 * 반환: {count, points}.
 */
export function bulkDismissGuardians(profile: Profile): { count: number; points: number } {
  let count = 0;
  let points = 0;
  for (const g of profile.guardians) {
    if (g.retired) continue;
    points += dismissPoints(g.combatScore, g.performanceCP);
    g.retired = true;
    returnLockedGear(profile, g);
    count++;
  }
  if (points > 0) profile.lineage = grantPoints(profile.lineage, points);
  return { count, points };
}

/**
 * 소멸된 수호기의 잠긴 장비(build.equipped)를 stash 로 반환한다(ADR-0024). build 없는 구
 * 수호기(ADR-0024 이전 퇴역)는 반환할 장비가 없어 no-op. Item 은 불변이라 참조 그대로 옮긴다.
 */
function returnLockedGear(profile: Profile, g: GuardianRecord): void {
  const equipped = g.build?.equipped;
  if (equipped === undefined) return;
  for (const key of Object.keys(equipped) as (keyof typeof equipped)[]) {
    const it = equipped[key];
    if (it !== undefined) profile.stash.push(it);
  }
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
