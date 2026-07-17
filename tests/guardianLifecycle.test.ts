/**
 * M5 수호 기체 생애주기 — 퇴역·소멸·계보 투자·방어 배치 (plan A2/A3/A5, ADR-0007).
 *
 * 로컬 세이브(Profile) 위 순수 상태 전이 검증. AC1(퇴역 1사이클 로직)·AC3(생애주기)·AC4(계보)
 * 를 서버 없이 재현 가능하게 증명한다.
 */

import { describe, it, expect } from 'vitest';
import { defaultProfile, migrate } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import {
  retireActiveShip,
  retirementCombatScore,
  dismissGuardianRecord,
  bulkDismissGuardians,
  investLineageBranch,
  buildGuardianPlacements,
  activeGuardians,
} from '../src/save/guardianLifecycle.js';
import { RETIRE_LINEAGE_GRANT, guardianBonusBp } from '../data/lineage.js';
import { GUARDIAN_TITAN, GUARDIAN_INTERCEPTOR, PERFORMANCE_FLOOR, dismissPoints } from '../data/guardian.js';
import type { Item } from '../src/items/types.js';

function itemOf(rarity: Item['rarity'], affixCount: number): Item {
  return {
    id: `it-${rarity}-${affixCount}`,
    slot: 'main',
    rarity,
    affixes: new Array(affixCount).fill(0).map((_, i) => ({ id: `a${i}`, stat: 'damagePct', value: i + 1 })),
    source: { planet: 0, tier: 0 },
  };
}

function profileWithGear(): Profile {
  const p = defaultProfile();
  const ship = p.ships[p.activeShipIndex]!;
  ship.equipped = { main: itemOf('rare', 3), armor: itemOf('magic', 1) };
  return p;
}

describe('퇴역 — 수호 기체 생성 + 계보 지급 (AC1)', () => {
  it('퇴역하면 수호 기체가 생기고 계보 포인트가 지급된다', () => {
    const p = profileWithGear();
    const score = retirementCombatScore(p);
    expect(score).toBeGreaterThan(0);
    const r = retireActiveShip(p, GUARDIAN_TITAN);
    expect(r.granted).toBe(RETIRE_LINEAGE_GRANT);
    expect(p.guardians.length).toBe(1);
    expect(p.guardians[0]!.combatScore).toBe(score);
    expect(p.guardians[0]!.preset).toBe(GUARDIAN_TITAN);
    expect(p.guardians[0]!.retired).toBe(false);
    expect(p.lineage.available).toBe(RETIRE_LINEAGE_GRANT);
  });

  it('퇴역 시 장착 장비가 창고(stash)로 반환된다(ADR-0007)', () => {
    const p = profileWithGear();
    const stashBefore = p.stash.length;
    retireActiveShip(p, GUARDIAN_INTERCEPTOR);
    expect(p.stash.length).toBe(stashBefore + 2); // weapon + armor 반환
    const ship = p.ships[p.activeShipIndex]!;
    expect(Object.keys(ship.equipped).length).toBe(0); // 장착 비워짐
  });

  it('프리셋 선택제: 타이탄과 인터셉터는 다른 스냅샷 형태', () => {
    const titan = profileWithGear();
    const inter = profileWithGear();
    retireActiveShip(titan, GUARDIAN_TITAN);
    retireActiveShip(inter, GUARDIAN_INTERCEPTOR);
    // 같은 전투력이라도 프리셋 형태가 다르다(타이탄 고HP·저속, 인터셉터 저HP·고속).
    expect(titan.guardians[0]!.snapshot.hp).toBeGreaterThan(inter.guardians[0]!.snapshot.hp);
    expect(inter.guardians[0]!.snapshot.moveSpeed).toBeGreaterThan(titan.guardians[0]!.snapshot.moveSpeed);
  });
});

describe('소멸 — 상시 회수 + 계보 포인트 (AC3)', () => {
  it('소멸하면 전투력×성능 포인트를 회수하고 retired=true', () => {
    const p = profileWithGear();
    retireActiveShip(p, GUARDIAN_TITAN);
    const g = p.guardians[0]!;
    const expected = dismissPoints(g.combatScore, g.performanceCP);
    const before = p.lineage.available;
    const r = dismissGuardianRecord(p, g.id);
    expect(r.dismissed).toBe(true);
    expect(r.points).toBe(expected);
    expect(p.guardians[0]!.retired).toBe(true);
    expect(p.lineage.available).toBe(before + expected);
    // 이미 소멸한 개체는 재소멸 불가(no-op).
    expect(dismissGuardianRecord(p, g.id).dismissed).toBe(false);
  });

  it('풍화된(성능 낮은) 수호는 회수 포인트가 적다', () => {
    const p = profileWithGear();
    retireActiveShip(p, GUARDIAN_TITAN);
    p.guardians[0]!.performanceCP = PERFORMANCE_FLOOR; // 풍화 바닥
    const g = p.guardians[0]!;
    const r = dismissGuardianRecord(p, g.id);
    expect(r.points).toBe(Math.floor(g.combatScore / 2)); // 성능 50% → 절반
  });

  it('일괄 소멸: 활성 수호를 모두 소멸하고 포인트 합산 회수', () => {
    const p = profileWithGear();
    retireActiveShip(p, GUARDIAN_TITAN);
    retireActiveShip(p, GUARDIAN_INTERCEPTOR);
    expect(activeGuardians(p).length).toBe(2);
    const r = bulkDismissGuardians(p);
    expect(r.count).toBe(2);
    expect(r.points).toBeGreaterThan(0);
    expect(activeGuardians(p).length).toBe(0);
  });
});

describe('계보 투자 (AC4)', () => {
  it('포인트로 계보 가지를 강화하고 수호 보너스가 즉시 반영된다', () => {
    const p = profileWithGear();
    // 넉넉히 지급되도록 여러 번 퇴역·소멸(포인트 축적).
    for (let i = 0; i < 5; i++) {
      retireActiveShip(p, GUARDIAN_TITAN);
      bulkDismissGuardians(p);
    }
    const bonusBefore = guardianBonusBp(p.lineage);
    const ok = investLineageBranch(p, 'guardian');
    expect(ok).toBe(true);
    expect(p.lineage.guardianLevel).toBe(1);
    expect(guardianBonusBp(p.lineage)).toBeGreaterThan(bonusBefore);
    // 포인트 부족 시 no-op.
    const broke = defaultProfile();
    expect(investLineageBranch(broke, 'guardian')).toBe(false);
  });
});

describe('방어 배치 수호 (갈림길①A)', () => {
  it('활성 수호로 방어 배치를 만든다(최대 2기, 스냅샷+성능+계보 보너스 포함)', () => {
    const p = profileWithGear();
    retireActiveShip(p, GUARDIAN_TITAN);
    retireActiveShip(p, GUARDIAN_INTERCEPTOR);
    investLineageBranch(p, 'guardian'); // 실패해도 무방(포인트 지급됨)
    const placements = buildGuardianPlacements(p, [{ x: 100, y: 0 }, { x: 100, y: 200 }]);
    expect(placements.length).toBe(2);
    expect(placements[0]!.snapshot).toBe(p.guardians[0]!.snapshot);
    expect(placements[0]!.lineageBonusBp).toBe(guardianBonusBp(p.lineage));
    expect(placements[0]!.performanceCP).toBe(p.guardians[0]!.performanceCP);
  });

  it('소멸된 수호는 방어 배치에서 제외된다', () => {
    const p = profileWithGear();
    retireActiveShip(p, GUARDIAN_TITAN);
    dismissGuardianRecord(p, p.guardians[0]!.id);
    const placements = buildGuardianPlacements(p, [{ x: 0, y: 0 }]);
    expect(placements.length).toBe(0);
  });
});

describe('세이브 라운드트립 — 계보·수호 정규화', () => {
  it('저장→로드가 계보·수호를 보존하고 손상 세이브는 안전 복구', () => {
    const p = profileWithGear();
    retireActiveShip(p, GUARDIAN_TITAN);
    investLineageBranch(p, 'guardian');
    const restored = migrate(JSON.parse(JSON.stringify(p)));
    expect(restored.guardians.length).toBe(1);
    expect(restored.guardians[0]!.combatScore).toBe(p.guardians[0]!.combatScore);
    expect(restored.lineage.guardianLevel).toBe(p.lineage.guardianLevel);
    // 손상: guardians 가 배열이 아니면 빈 배열로 복구, 계보 없으면 빈 계보.
    const corrupt = migrate({ saveVersion: 3, guardians: 'nope', lineage: 42 });
    expect(corrupt.guardians).toEqual([]);
    expect(corrupt.lineage.available).toBe(0);
  });

  it('구 세이브(계보·수호 필드 없음)도 빈 값으로 로드된다', () => {
    const legacy = migrate({ saveVersion: 3, ships: [], credits: 10 });
    expect(legacy.guardians).toEqual([]);
    expect(legacy.lineage.available).toBe(0);
    expect(legacy.lineage.guardianLevel).toBe(0);
  });
});
