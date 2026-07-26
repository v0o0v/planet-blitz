/**
 * M5 수호 기체 생애주기 — 퇴역·소멸·계보 투자·방어 배치 (plan A2/A3/A5, ADR-0007).
 *
 * 로컬 세이브(Profile) 위 순수 상태 전이 검증. AC1(퇴역 1사이클 로직)·AC3(생애주기)·AC4(계보)
 * 를 서버 없이 재현 가능하게 증명한다.
 */

import { describe, it, expect } from 'vitest';
import { defaultProfile, migrate, activeShip, investSkill } from '../src/save/profile.js';
import type { Profile } from '../src/save/profile.js';
import { SHIP_TYPES, shipSkillNodeCount } from '../data/ships/index.js';
import {
  retireActiveShip,
  retirementCombatScore,
  dismissGuardianRecord,
  bulkDismissGuardians,
  investLineageBranch,
  buildGuardianPlacements,
  activeGuardians,
  canRetireActiveShip,
  retireGate,
  RETIRE_REQUIRED_LEVEL,
} from '../src/save/guardianLifecycle.js';
import { retireAtCap } from './support/retireAtCap.js';
import { LEVEL_CAP } from '../data/waves.js';
import { RETIRE_LINEAGE_GRANT, guardianBonusBp } from '../data/lineage.js';
import { GUARDIAN_TITAN, GUARDIAN_INTERCEPTOR, PERFORMANCE_FLOOR, dismissPoints } from '../data/guardian.js';
import type { Item } from '../src/items/types.js';

function itemOf(rarity: Item['rarity'], affixCount: number): Item {
  return {
    id: `it-${rarity}-${affixCount}`,
    slot: 'main',
    rarity,
    affixes: new Array(affixCount).fill(0).map((_, i) => ({ id: `a${i}`, stat: 'damagePct', value: i + 1 })),
    source: { planet: 0, stage: 1 },
  };
}

function profileWithGear(): Profile {
  const p = defaultProfile();
  const ship = p.ships[p.activeShipIndex]!;
  ship.equipped = { main: itemOf('rare', 3), armor: itemOf('magic', 1) };
  return p;
}

// ---------------------------------------------------------------------------
// 만렙 게이트 — 퇴역은 활성 기체가 만렙일 때만 열린다.
//
// 이 저장소의 반복 결함이 "UI 게이트만 있고 모델에는 없다" 이므로, 화면을 거치지 않는 모델
// 호출(하네스·치트·후속 코드)에서도 막히는지를 여기서 못박는다. 그리고 `retireActiveShip` 은
// 수호 스냅샷·계보 지급·장착 비우기·신규 기체 push 를 한 덩어리로 하므로, 거부가 **부분
// 변형조차 남기지 않는지**(프로필 전후 스냅샷 동일)까지 본다.
// ---------------------------------------------------------------------------
describe('퇴역 만렙 게이트', () => {
  it('필요 레벨은 LEVEL_CAP 정본을 그대로 쓴다(만렙 상수 이중화 금지)', () => {
    expect(RETIRE_REQUIRED_LEVEL).toBe(LEVEL_CAP);
  });

  it('만렙 미만이면 거부하고 프로필을 **전혀** 변형하지 않는다', () => {
    for (const level of [1, 2, 50, LEVEL_CAP - 1]) {
      const p = profileWithGear();
      activeShip(p).level = level;
      const before = JSON.stringify(p);

      expect(canRetireActiveShip(p)).toBe(false);
      expect(retireActiveShip(p, GUARDIAN_TITAN, 3)).toBeNull();

      // 부분 변형 금지: 계보 지급·수호 push·장착 비우기·신규 기체 push 중 무엇도 남으면 안 된다.
      expect(JSON.stringify(p), `level ${level}`).toBe(before);
    }
  });

  it('게이트 결과는 왜 막혔는지(현재/필요 레벨)를 담는다', () => {
    const p = profileWithGear();
    activeShip(p).level = 12;
    expect(retireGate(p)).toEqual({ ok: false, level: 12, required: LEVEL_CAP });
    activeShip(p).level = LEVEL_CAP;
    expect(retireGate(p)).toEqual({ ok: true, level: LEVEL_CAP, required: LEVEL_CAP });
  });

  it('만렙이면 기존대로 퇴역이 성립한다(게이트가 정상 경로를 막지 않는다)', () => {
    const p = profileWithGear();
    activeShip(p).level = LEVEL_CAP;
    expect(canRetireActiveShip(p)).toBe(true);
    const r = retireActiveShip(p, GUARDIAN_TITAN, 2);
    expect(r).not.toBeNull();
    expect(r!.granted).toBe(RETIRE_LINEAGE_GRANT);
    expect(p.guardians).toHaveLength(1);
    expect(r!.ship.typeId).toBe(2);
    // 새 세대는 level 1 이라 곧바로 다시 퇴역할 수 없다(연속 퇴역 차단).
    expect(canRetireActiveShip(p)).toBe(false);
    expect(retireActiveShip(p, GUARDIAN_TITAN, 0)).toBeNull();
  });

  it('만렙 초과 레벨도 통과한다(경계는 >= 다)', () => {
    const p = profileWithGear();
    activeShip(p).level = LEVEL_CAP + 5;
    expect(canRetireActiveShip(p)).toBe(true);
  });
});

describe('퇴역 — 수호 기체 생성 + 계보 지급 (AC1)', () => {
  it('퇴역하면 수호 기체가 생기고 계보 포인트가 지급된다', () => {
    const p = profileWithGear();
    const score = retirementCombatScore(p);
    expect(score).toBeGreaterThan(0);
    const r = retireAtCap(p, GUARDIAN_TITAN);
    expect(r.granted).toBe(RETIRE_LINEAGE_GRANT);
    expect(p.guardians.length).toBe(1);
    expect(p.guardians[0]!.combatScore).toBe(score);
    expect(p.guardians[0]!.preset).toBe(GUARDIAN_TITAN);
    expect(p.guardians[0]!.retired).toBe(false);
    expect(p.lineage.available).toBe(RETIRE_LINEAGE_GRANT);
  });

  it('퇴역 시 장착 장비가 수호 기체에 잠긴다(ADR-0024 — stash 불변)', () => {
    const p = profileWithGear();
    p.skillPoints = 3;
    investSkill(p, 0); // 스킬 투자를 남겨 build.skillInvest 캡처를 검증
    const retiring = p.ships[p.activeShipIndex]!;
    const mainItem = retiring.equipped.main!;
    const armorItem = retiring.equipped.armor!;
    const investSnapshot = retiring.skillInvest.slice();
    const stashBefore = p.stash.length;
    const r = retireAtCap(p, GUARDIAN_INTERCEPTOR);
    // 장비 잠김: stash 로 반환되지 않고 수호기에 봉인된다(구 ADR-0007 stash+2 를 뒤집음).
    expect(p.stash.length).toBe(stashBefore);
    // ⚠️ M8: 퇴역이 기체를 **교체**하므로 활성 기체는 더 이상 퇴역한 그 기체가 아니다.
    // 장착이 비워졌는지는 퇴역한 기체 본체에서 확인한다(장비는 build 로 옮겨감).
    expect(Object.keys(retiring.equipped).length).toBe(0);
    expect(Object.keys(p.ships[p.activeShipIndex]!.equipped).length).toBe(0); // 새 기체도 빈손
    // 새 수호기의 build 에 퇴역 순간 빌드가 잠겼다: typeId · 장착 장비 · 스킬 투자 캡처.
    const build = r.guardian.build;
    expect(build).toBeDefined();
    expect(build!.typeId).toBe(retiring.typeId);
    expect(build!.equipped.main).toBe(mainItem);
    expect(build!.equipped.armor).toBe(armorItem);
    expect(build!.skillInvest).toEqual(investSnapshot);
    expect(build!.skillInvest[0]).toBe(1); // 투자가 실제로 캡처됐다
  });

  it('프리셋은 이동 AI 성향만 정한다: 같은 빌드면 파워 동일, 거동만 다르다 (ADR-0025)', () => {
    const titan = profileWithGear();
    const inter = profileWithGear();
    retireAtCap(titan, GUARDIAN_TITAN);
    retireAtCap(inter, GUARDIAN_INTERCEPTOR);
    const ts = titan.guardians[0]!.snapshot;
    const is = inter.guardians[0]!.snapshot;
    // ADR-0025: 프리셋은 파워(hp·피해·발사간격)를 결정하지 않는다 — 실물 빌드가 결정하므로
    // 같은 빌드면 프리셋 무관 동일하다(구 "타이탄 고HP" 모델 폐기).
    expect(ts.hp).toBe(is.hp);
    expect(ts.contactDamage).toBe(is.contactDamage);
    expect(ts.fireCooldown).toBe(is.fireCooldown);
    // 프리셋이 정하는 것은 이동 AI: 인터셉터=근접 추격(고속·짧은 standoff·작은 히트박스),
    // 타이탄=원거리 버팀(저속·먼 standoff·큰 히트박스).
    expect(is.moveSpeed).toBeGreaterThan(ts.moveSpeed);
    expect(ts.standoff).toBeGreaterThan(is.standoff);
    expect(ts.radius).toBeGreaterThan(is.radius);
  });
});

// ---------------------------------------------------------------------------
// M8 — 퇴역이 세대 교체가 된다 (설계서 §6·§10-9, ADR-0019)
//
// ⚠️ **의도된 거동 변경**: 이전 구현은 수호 스냅샷·계보·장비 회수까지만 하고 같은 기체를
// 그대로 활성으로 남겼다("다음 기체" 개념이 모델에 없었다). 위 기존 케이스 중 활성 기체를
// 계속 참조하던 것들은 그래서 함께 갱신됐다 — 테스트 완화가 아니라 계약 변경 반영이다.
// ---------------------------------------------------------------------------
describe('퇴역 — 세대 교체 (M8)', () => {
  it('퇴역하면 신규 기체가 추가되고 활성이 그쪽으로 옮겨간다', () => {
    const p = profileWithGear();
    const before = p.ships.length;
    const retiring = p.ships[p.activeShipIndex]!;

    const r = retireAtCap(p, GUARDIAN_TITAN, 0);

    expect(p.ships.length).toBe(before + 1);
    expect(p.activeShipIndex).toBe(p.ships.length - 1);
    expect(activeShip(p)).toBe(r.ship);
    expect(activeShip(p)).not.toBe(retiring); // 같은 기체가 남아 있으면 세대 교체가 아니다
    expect(r.ship.id).not.toBe(retiring.id);
  });

  it('신규 기체는 요청한 타입 · level 1 · xp 0 · 투자 전 0 · 빈 장비로 시작한다', () => {
    for (let t = 0; t < SHIP_TYPES.length; t++) {
      const p = profileWithGear();
      p.skillPoints = 5;
      investSkill(p, 0); // 퇴역 전 기체에 투자를 남겨 둔다
      const r = retireAtCap(p, GUARDIAN_TITAN, t);

      expect(r.ship.typeId).toBe(t);
      expect(r.ship.level).toBe(1);
      expect(r.ship.xp).toBe(0);
      expect(Object.keys(r.ship.equipped).length).toBe(0);
      // 퇴역 = 세대 리셋. 투자는 승계되지 않는다(계정 성장은 계보가 담당).
      expect(r.ship.skillInvest).toHaveLength(shipSkillNodeCount(t));
      expect(r.ship.skillInvest.every((v) => v === 0)).toBe(true);
    }
  });

  it('구 기체는 수호로 전환되고, 그 투자 깊이가 전투력에 반영된다', () => {
    const invested = profileWithGear();
    invested.skillPoints = 20;
    for (let k = 0; k < 5; k++) investSkill(invested, 0);
    const bare = profileWithGear();

    const scoreInvested = retirementCombatScore(invested);
    const scoreBare = retirementCombatScore(bare);
    // 투자 깊이는 기체 벡터에서 읽어야 한다 — 계정 벡터를 읽으면 이 차이가 사라진다.
    expect(scoreInvested).toBeGreaterThan(scoreBare);

    const r = retireAtCap(invested, GUARDIAN_TITAN, 0);
    expect(invested.guardians.length).toBe(1);
    expect(invested.guardians[0]!).toBe(r.guardian);
    expect(r.guardian.combatScore).toBe(scoreInvested);
    expect(r.guardian.retired).toBe(false);
  });

  it('퇴역 후 연구소 투자는 새 기체에 쌓인다(별칭 재바인딩 누락 방지)', () => {
    const p = profileWithGear();
    const retiring = p.ships[p.activeShipIndex]!;
    const r = retireAtCap(p, GUARDIAN_TITAN, 0);
    p.skillPoints = 3;
    investSkill(p, 0);
    expect(r.ship.skillInvest[0]).toBe(1);
    expect(retiring.skillInvest[0]).toBe(0); // 퇴역한 기체로 새지 않았다
    // 정본은 활성 기체 벡터 하나뿐이다(M8-L7 이 계정 단위 별칭을 삭제했다).
    expect(activeShip(p).skillInvest).toBe(r.ship.skillInvest);
  });

  it('범위 밖 nextTypeId 는 0(스트라이커)으로 clamp 된다', () => {
    for (const bad of [SHIP_TYPES.length, 999, -1, NaN]) {
      const p = profileWithGear();
      expect(retireAtCap(p, GUARDIAN_TITAN, bad).ship.typeId).toBe(0);
    }
  });

  it('퇴역 결과가 저장→로드 왕복을 견딘다(신규 기체·활성 인덱스 보존)', () => {
    const p = profileWithGear();
    retireAtCap(p, GUARDIAN_TITAN, 0);
    const back = migrate(JSON.parse(JSON.stringify(p)));
    expect(back.ships.length).toBe(p.ships.length);
    expect(back.activeShipIndex).toBe(p.activeShipIndex);
    expect(activeShip(back).typeId).toBe(activeShip(p).typeId);
    expect(activeShip(back).skillInvest).toEqual(activeShip(p).skillInvest);
  });
});

describe('소멸 — 상시 회수 + 계보 포인트 (AC3)', () => {
  it('소멸하면 전투력×성능 포인트를 회수하고 retired=true', () => {
    const p = profileWithGear();
    retireAtCap(p, GUARDIAN_TITAN);
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

  it('소멸하면 잠긴 장비가 stash 로 반환된다(ADR-0024)', () => {
    const p = profileWithGear();
    const retiring = p.ships[p.activeShipIndex]!;
    const mainItem = retiring.equipped.main!;
    const armorItem = retiring.equipped.armor!;
    const n = Object.keys(retiring.equipped).length; // 2 (main + armor)
    const stashBefore = p.stash.length;
    const r = retireAtCap(p, GUARDIAN_TITAN);
    // 퇴역 직후: 장비는 수호기에 잠기고 stash 는 그대로.
    expect(p.stash.length).toBe(stashBefore);
    expect(Object.keys(r.guardian.build!.equipped).length).toBe(n);
    // 소멸: 잠긴 장비가 stash 로 반환된다.
    dismissGuardianRecord(p, p.guardians[0]!.id);
    expect(p.stash.length).toBe(stashBefore + n);
    expect(p.stash).toContain(mainItem);
    expect(p.stash).toContain(armorItem);
  });

  it('풍화된(성능 낮은) 수호는 회수 포인트가 적다', () => {
    const p = profileWithGear();
    retireAtCap(p, GUARDIAN_TITAN);
    p.guardians[0]!.performanceCP = PERFORMANCE_FLOOR; // 풍화 바닥
    const g = p.guardians[0]!;
    const r = dismissGuardianRecord(p, g.id);
    expect(r.points).toBe(Math.floor(g.combatScore / 2)); // 성능 50% → 절반
  });

  it('일괄 소멸: 활성 수호를 모두 소멸하고 포인트 합산 회수', () => {
    const p = profileWithGear();
    retireAtCap(p, GUARDIAN_TITAN);
    retireAtCap(p, GUARDIAN_INTERCEPTOR);
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
      retireAtCap(p, GUARDIAN_TITAN);
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
    retireAtCap(p, GUARDIAN_TITAN);
    retireAtCap(p, GUARDIAN_INTERCEPTOR);
    investLineageBranch(p, 'guardian'); // 실패해도 무방(포인트 지급됨)
    const placements = buildGuardianPlacements(p, [{ x: 100, y: 0 }, { x: 100, y: 200 }]);
    expect(placements.length).toBe(2);
    expect(placements[0]!.snapshot).toBe(p.guardians[0]!.snapshot);
    expect(placements[0]!.lineageBonusBp).toBe(guardianBonusBp(p.lineage));
    expect(placements[0]!.performanceCP).toBe(p.guardians[0]!.performanceCP);
  });

  it('소멸된 수호는 방어 배치에서 제외된다', () => {
    const p = profileWithGear();
    retireAtCap(p, GUARDIAN_TITAN);
    dismissGuardianRecord(p, p.guardians[0]!.id);
    const placements = buildGuardianPlacements(p, [{ x: 0, y: 0 }]);
    expect(placements.length).toBe(0);
  });
});

describe('세이브 라운드트립 — 계보·수호 정규화', () => {
  it('저장→로드가 계보·수호를 보존하고 손상 세이브는 안전 복구', () => {
    const p = profileWithGear();
    retireAtCap(p, GUARDIAN_TITAN);
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
