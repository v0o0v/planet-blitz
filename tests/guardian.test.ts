/**
 * M5 수호 기체 — 방어전 참전·결정론·생애주기·계보 (plan Phase A, ADR-0007).
 *
 * 커버리지:
 *   1. 스폰: 동시 최대 2기(MAX_GUARDIAN_SLOTS), 초과분 절단.
 *   2. 결정론(AC2): 수호 2기 포함 방어전 2회 재실행 → 틱별 해시 스트림 100% 일치.
 *   3. 해시 불변(수호 미포함 런): guardians 미지정 == 빈 배열 → 기존 침공 런 해시 완전 일치.
 *   4. 거동 스모크: 수호가 플레이어를 추적·사격(enemyBullet 생성), 플레이어 탄에 파괴됨.
 *   5. data/guardian.ts: 스탯 해석·성능·계보 보너스·소멸 포인트·전투력 점수(결정론 정수).
 *   6. data/lineage.ts: 로그 점근 +50% 상한(AC4)·단조·투자·포인트.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { runReplay } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import { DEFAULT_TIME_LIMIT_TICKS, TURRET_VULCAN } from '../src/sim/defense.js';
import type { DefenseLayout, GuardianPlacement, InvasionConfig } from '../src/sim/defense.js';
import {
  GUARDIAN_TITAN,
  GUARDIAN_INTERCEPTOR,
  MAX_GUARDIAN_SLOTS,
  PERFORMANCE_FULL,
  PERFORMANCE_FLOOR,
  makeGuardianSnapshot,
  resolveGuardianStats,
  dismissPoints,
  normalizePerformance,
  normalizeLineageBonus,
} from '../data/guardian.js';
import {
  emptyLineage,
  branchBonusBp,
  guardianBonusBp,
  investLineage,
  canInvest,
  grantPoints,
  nextLevelCost,
  LINEAGE_BONUS_CAP_BP,
  RETIRE_LINEAGE_GRANT,
} from '../data/lineage.js';

const idle: InputFrame = emptyInput();

function guardian(
  preset: number,
  x: number,
  y: number,
  combatScore = 100,
  performanceCP = PERFORMANCE_FULL,
  lineageBonusBp = 0,
): GuardianPlacement {
  return { x, y, snapshot: makeGuardianSnapshot(preset, combatScore), performanceCP, lineageBonusBp };
}

function invasionConfig(layout: DefenseLayout): WorldConfig {
  const inv: InvasionConfig = { layout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS };
  return {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 100,
    invasion: inv,
  };
}

function countKind(state: { entities: { kind: string }[] }, kind: string): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === kind) n++;
  return n;
}

describe('수호 기체 — 스폰 (plan A1)', () => {
  it('수호 배치대로 스폰하되 동시 상한(2기)을 넘지 않는다', () => {
    const layout: DefenseLayout = {
      core: { x: 800, y: 0 },
      turrets: [],
      obstacles: [],
      guardians: [
        guardian(GUARDIAN_TITAN, 300, 0),
        guardian(GUARDIAN_INTERCEPTOR, 300, 200),
        guardian(GUARDIAN_TITAN, 300, -200), // 3번째 — 상한 초과, 절단
      ],
    };
    const state = createWorld(1, invasionConfig(layout));
    expect(MAX_GUARDIAN_SLOTS).toBe(2);
    expect(countKind(state, 'guardian')).toBe(2);
    expect(state.entities[0]!.kind).toBe('player'); // player 불변식
  });

  it('guardians 미지정 침공 런은 수호가 없다', () => {
    const layout: DefenseLayout = { core: { x: 800, y: 0 }, turrets: [], obstacles: [] };
    const state = createWorld(1, invasionConfig(layout));
    expect(countKind(state, 'guardian')).toBe(0);
  });
});

describe('수호 기체 — 결정론 (AC2)', () => {
  it('수호 2기 포함 방어전 2회 재실행이 틱별 해시 스트림 100% 일치', () => {
    const layout: DefenseLayout = {
      core: { x: 900, y: 0 },
      turrets: [{ type: TURRET_VULCAN, x: 500, y: 0 }],
      obstacles: [{ x: 450, y: 0, halfW: 50, halfH: 120 }],
      guardians: [
        guardian(GUARDIAN_TITAN, 350, -100, 140, PERFORMANCE_FULL, 1200),
        guardian(GUARDIAN_INTERCEPTOR, 400, 150, 90, 7500, 800),
      ],
    };
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 500; i++) {
      inputs.push({
        moveX: Math.sin(i / 40),
        moveY: Math.cos(i / 55),
        aim: (i / 30) % 6.28,
        dash: i % 90 === 0,
        special: 0,
      });
    }
    const replay: Replay = { seed: 7, config: invasionConfig(layout), inputs };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.hashes.length).toBe(500);
  });
});

describe('수호 기체 — 해시 불변(수호 미포함 런은 해시 무변)', () => {
  it('guardians 미지정 == 빈 배열: 침공 해시 스트림 완전 일치', () => {
    const base: DefenseLayout = {
      core: { x: 900, y: 0 },
      turrets: [{ type: TURRET_VULCAN, x: 500, y: 0 }],
      obstacles: [],
    };
    const withEmpty: DefenseLayout = { ...base, guardians: [] };
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 300; i++) {
      inputs.push({ moveX: Math.sin(i / 20), moveY: 0, aim: (i / 25) % 6.28, dash: false, special: 0 });
    }
    const omitted = runReplay({ seed: 7, config: invasionConfig(base), inputs });
    const empty = runReplay({ seed: 7, config: invasionConfig(withEmpty), inputs });
    expect(omitted.hashes).toEqual(empty.hashes);
  });

  it('수호 추가 시 해시가 발산한다(수호가 결정론 입력으로 실제 반영됨)', () => {
    const base: DefenseLayout = {
      core: { x: 100000, y: 0 }, // 원거리 코어(우발 승리 방지)
      turrets: [],
      obstacles: [],
    };
    const withG: DefenseLayout = { ...base, guardians: [guardian(GUARDIAN_TITAN, 300, 0)] };
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 200; i++) inputs.push(idle);
    const a = runReplay({ seed: 7, config: invasionConfig(base), inputs });
    const b = runReplay({ seed: 7, config: invasionConfig(withG), inputs });
    expect(a.finalHash).not.toBe(b.finalHash);
  });
});

describe('수호 기체 — 거동 (plan A1)', () => {
  it('수호가 사거리 안 플레이어를 향해 발사물(enemyBullet)을 생성한다', () => {
    const layout: DefenseLayout = {
      core: { x: 100000, y: 0 },
      turrets: [],
      obstacles: [],
      guardians: [guardian(GUARDIAN_TITAN, 400, 0)],
    };
    const state = createWorld(11, invasionConfig(layout));
    let fired = false;
    for (let i = 0; i < 200; i++) {
      stepWorld(state, idle);
      if (countKind(state, 'enemyBullet') > 0) {
        fired = true;
        break;
      }
    }
    expect(fired).toBe(true);
  });

  it('수호가 유지 거리까지 플레이어를 추적한다(이동)', () => {
    const layout: DefenseLayout = {
      core: { x: 100000, y: 0 },
      turrets: [],
      obstacles: [],
      // 먼 곳에 인터셉터(고속) — 플레이어(0,0)로 접근해야 한다.
      guardians: [guardian(GUARDIAN_INTERCEPTOR, 4000, 0)],
    };
    const state = createWorld(11, invasionConfig(layout));
    const g0 = state.entities.find((e) => e.kind === 'guardian')!;
    const startX = g0.x;
    for (let i = 0; i < 200; i++) stepWorld(state, idle);
    const g1 = state.entities.find((e) => e.kind === 'guardian')!;
    expect(g1.x).toBeLessThan(startX); // 플레이어(원점) 쪽으로 접근
  });

  it('수호는 플레이어 탄에 파괴된다(targetable)', () => {
    // 저내구 인터셉터를 플레이어 바로 앞에 두고, 플레이어 자동 사격으로 파괴 확인.
    const layout: DefenseLayout = {
      core: { x: 100000, y: 0 },
      turrets: [],
      obstacles: [],
      guardians: [guardian(GUARDIAN_INTERCEPTOR, 260, 0, 40)],
    };
    const state = createWorld(3, invasionConfig(layout));
    let destroyed = false;
    for (let i = 0; i < 2000; i++) {
      stepWorld(state, idle);
      if (countKind(state, 'guardian') === 0) {
        destroyed = true;
        break;
      }
    }
    expect(destroyed).toBe(true);
  });
});

describe('data/guardian.ts — 스탯 해석 (결정론 정수)', () => {
  it('resolveGuardianStats: 완전 성능·무보너스는 스냅샷 전투 스탯 그대로', () => {
    const snap = makeGuardianSnapshot(GUARDIAN_TITAN, 100);
    const st = resolveGuardianStats(snap, PERFORMANCE_FULL, 0);
    expect(st.hp).toBe(snap.hp);
    expect(st.contactDamage).toBe(snap.contactDamage);
    expect(st.bulletDamage).toBe(snap.bulletDamage);
    expect(st.fireCooldown).toBe(snap.fireCooldown);
  });

  it('성능 저하는 hp·피해를 낮춘다(풍화 = 약화)', () => {
    const snap = makeGuardianSnapshot(GUARDIAN_TITAN, 100);
    const full = resolveGuardianStats(snap, PERFORMANCE_FULL, 0);
    const floor = resolveGuardianStats(snap, PERFORMANCE_FLOOR, 0);
    expect(floor.hp).toBeLessThan(full.hp);
    expect(floor.bulletDamage).toBeLessThan(full.bulletDamage);
    // 바닥 50% → 약 절반.
    expect(floor.hp).toBe(Math.round(full.hp / 2));
  });

  it('계보 보너스는 hp·피해를 높이고 발사 간격을 줄인다', () => {
    const snap = makeGuardianSnapshot(GUARDIAN_TITAN, 100);
    const none = resolveGuardianStats(snap, PERFORMANCE_FULL, 0);
    const maxed = resolveGuardianStats(snap, PERFORMANCE_FULL, 5000); // +50%
    expect(maxed.hp).toBeGreaterThan(none.hp);
    expect(maxed.bulletDamage).toBeGreaterThan(none.bulletDamage);
    expect(maxed.fireCooldown).toBeLessThan(none.fireCooldown);
    expect(maxed.hp).toBe(Math.round(none.hp * 1.5));
  });

  it('결정론: 같은 입력 2회 비트 동일', () => {
    const snap = makeGuardianSnapshot(GUARDIAN_INTERCEPTOR, 137);
    expect(resolveGuardianStats(snap, 7321, 1234)).toEqual(resolveGuardianStats(snap, 7321, 1234));
  });

  it('전투력 점수 높으면 강한 스냅샷', () => {
    const weak = makeGuardianSnapshot(GUARDIAN_TITAN, 100);
    const strong = makeGuardianSnapshot(GUARDIAN_TITAN, 300);
    expect(strong.hp).toBeGreaterThan(weak.hp);
    expect(strong.bulletDamage).toBeGreaterThan(weak.bulletDamage);
  });

  it('normalize: 성능·보너스 클램프', () => {
    expect(normalizePerformance(undefined)).toBe(PERFORMANCE_FULL);
    expect(normalizePerformance(1000)).toBe(PERFORMANCE_FLOOR); // 바닥 아래 클램프
    expect(normalizePerformance(99999)).toBe(PERFORMANCE_FULL);
    expect(normalizeLineageBonus(-5)).toBe(0);
    expect(normalizeLineageBonus(99999)).toBe(5000);
  });

  it('dismissPoints: 전투력 × 남은 성능 비율', () => {
    expect(dismissPoints(100, PERFORMANCE_FULL)).toBe(100);
    expect(dismissPoints(100, PERFORMANCE_FLOOR)).toBe(50); // 성능 50% → 절반
    expect(dismissPoints(0, PERFORMANCE_FULL)).toBe(0);
  });

});

describe('data/lineage.ts — 로그 점근 계보 (AC4)', () => {
  it('보너스는 +50%(5000bp)를 절대 초과하지 않는다(점근 상한)', () => {
    expect(LINEAGE_BONUS_CAP_BP).toBe(5000);
    for (const level of [0, 1, 5, 20, 100, 1000, 100000]) {
      const bp = branchBonusBp(level);
      expect(bp).toBeGreaterThanOrEqual(0);
      expect(bp).toBeLessThanOrEqual(5000);
      expect(bp).toBeLessThan(5000 + 1); // 상한 이하
    }
    // 매우 큰 레벨에서도 5000 미만(점근 — 도달하지 않음).
    expect(branchBonusBp(1000000)).toBeLessThan(5000);
  });

  it('보너스는 레벨에 단조 증가(감소수익)', () => {
    let prev = -1;
    for (let l = 0; l <= 200; l++) {
      const bp = branchBonusBp(l);
      expect(bp).toBeGreaterThanOrEqual(prev);
      prev = bp;
    }
    // L=0 → 0.
    expect(branchBonusBp(0)).toBe(0);
    // 반감 레벨(20)에서 상한 절반 근처.
    expect(branchBonusBp(20)).toBe(2500);
  });

  it('투자: 포인트 소비·레벨 증가·리스펙 없음', () => {
    let s = grantPoints(emptyLineage(), 200);
    expect(canInvest(s, 'guardian')).toBe(true);
    const cost0 = nextLevelCost(0);
    s = investLineage(s, 'guardian');
    expect(s.guardianLevel).toBe(1);
    expect(s.available).toBe(200 - cost0);
    expect(s.spent).toBe(cost0);
    expect(guardianBonusBp(s)).toBeGreaterThan(0);
    // 포인트 부족 시 무변화.
    const broke = emptyLineage();
    expect(investLineage(broke, 'guardian')).toEqual(broke);
  });

  it('퇴역 기본 지급 상수', () => {
    expect(RETIRE_LINEAGE_GRANT).toBe(50);
    const s = grantPoints(emptyLineage(), RETIRE_LINEAGE_GRANT);
    expect(s.available).toBe(50);
  });
});
