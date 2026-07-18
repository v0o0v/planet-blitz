/**
 * M5 계보 수호 가지 마일스톤 질적 노드 — 격추 재기동·코어 근접 수비·실드 공유 (GDD §4, ADR-0007).
 *
 * 커버리지:
 *   1. data/lineage.ts: 레벨 임계값(10/25/50) 자동 해금·정규화·비트 헬퍼.
 *   2. data/guardian.ts: 부활 HP·근접 강화·실드 풀 순수 정수 함수.
 *   3. 격추 재기동: 방어전에서 수호 HP 0 도달 시 1회 부활(재기동 딜레이 무적) → 결국 격추.
 *      레벨 미달(마스크 0)이면 부활 없이 즉시 격추.
 *   4. 코어 근접 수비: 코어 반경 내 수호의 연사↑(발사물 수 증가). 반경 밖이면 무효.
 *   5. 실드 공유: 방어전 시작 시 코어·포탑에 전투력 비례 실드(targetY) 부여. 미해금이면 0.
 *   6. 결정론: 각 마일스톤 config 2회 재실행 → 틱별 해시 스트림 100% 일치.
 *   7. 하위 호환: milestones=0 == 필드 미지정 → 해시 완전 불변.
 *   8. 배선: buildGuardianPlacements 가 profile 계보 레벨 → 마스크를 config 로 전달.
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
  PERFORMANCE_FULL,
  makeGuardianSnapshot,
  resolveGuardianStats,
  rebootHp,
  coreGuardDamage,
  coreGuardCooldown,
  shieldShareHp,
  REBOOT_HP_BP,
  CORE_GUARD_DAMAGE_BP,
  SHIELD_SHARE_CORE_BP,
  SHIELD_SHARE_TURRET_BP,
} from '../data/guardian.js';
import {
  guardianMilestones,
  normalizeMilestones,
  hasMilestone,
  MILESTONE_REBOOT,
  MILESTONE_CORE_GUARD,
  MILESTONE_SHIELD_SHARE,
  MILESTONE_MASK_ALL,
  REBOOT_LEVEL,
  CORE_GUARD_LEVEL,
  SHIELD_SHARE_LEVEL,
} from '../data/lineage.js';
import { defaultProfile } from '../src/save/profile.js';
import { buildGuardianPlacements } from '../src/save/guardianLifecycle.js';

const idle: InputFrame = emptyInput();

function guardianM(
  preset: number,
  x: number,
  y: number,
  opts: { combatScore?: number; performanceCP?: number; lineageBonusBp?: number; milestones?: number } = {},
): GuardianPlacement {
  const g: GuardianPlacement = {
    x,
    y,
    snapshot: makeGuardianSnapshot(preset, opts.combatScore ?? 100),
    performanceCP: opts.performanceCP ?? PERFORMANCE_FULL,
    lineageBonusBp: opts.lineageBonusBp ?? 0,
  };
  if (opts.milestones !== undefined) g.milestones = opts.milestones;
  return g;
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

// ---------------------------------------------------------------------------
// 1. data/lineage.ts — 레벨 임계값·정규화·비트 헬퍼
// ---------------------------------------------------------------------------
describe('마일스톤 해금 곡선 (data/lineage.ts)', () => {
  it('레벨 임계값에서 순차 자동 해금(별도 투자 없음)', () => {
    expect(guardianMilestones(0)).toBe(0);
    expect(guardianMilestones(REBOOT_LEVEL - 1)).toBe(0);
    expect(guardianMilestones(REBOOT_LEVEL)).toBe(MILESTONE_REBOOT);
    expect(guardianMilestones(CORE_GUARD_LEVEL - 1)).toBe(MILESTONE_REBOOT);
    expect(guardianMilestones(CORE_GUARD_LEVEL)).toBe(MILESTONE_REBOOT | MILESTONE_CORE_GUARD);
    expect(guardianMilestones(SHIELD_SHARE_LEVEL - 1)).toBe(MILESTONE_REBOOT | MILESTONE_CORE_GUARD);
    expect(guardianMilestones(SHIELD_SHARE_LEVEL)).toBe(MILESTONE_MASK_ALL);
    expect(guardianMilestones(9999)).toBe(MILESTONE_MASK_ALL);
  });

  it('임계값이 반감 레벨(20) 곡선과 정합(초·중·후반 배치)', () => {
    expect(REBOOT_LEVEL).toBeLessThan(CORE_GUARD_LEVEL);
    expect(CORE_GUARD_LEVEL).toBeLessThan(SHIELD_SHARE_LEVEL);
  });

  it('음수·소수 레벨은 안전 절삭', () => {
    expect(guardianMilestones(-5)).toBe(0);
    expect(guardianMilestones(10.9)).toBe(MILESTONE_REBOOT);
  });

  it('normalizeMilestones: 미지정·비유한·음수·초과비트 정리', () => {
    expect(normalizeMilestones(undefined)).toBe(0);
    expect(normalizeMilestones(NaN)).toBe(0);
    expect(normalizeMilestones(-1)).toBe(0);
    expect(normalizeMilestones(0xff)).toBe(MILESTONE_MASK_ALL); // 정의 밖 비트 제거
    expect(normalizeMilestones(MILESTONE_CORE_GUARD)).toBe(MILESTONE_CORE_GUARD);
  });

  it('hasMilestone 비트 판정', () => {
    const m = MILESTONE_REBOOT | MILESTONE_SHIELD_SHARE;
    expect(hasMilestone(m, MILESTONE_REBOOT)).toBe(true);
    expect(hasMilestone(m, MILESTONE_CORE_GUARD)).toBe(false);
    expect(hasMilestone(m, MILESTONE_SHIELD_SHARE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. data/guardian.ts — 순수 효과 수치
// ---------------------------------------------------------------------------
describe('마일스톤 효과 수치 (data/guardian.ts)', () => {
  it('rebootHp: 실효 최대 HP 비율(최소 1)', () => {
    expect(rebootHp(1000)).toBe(Math.round((1000 * REBOOT_HP_BP) / 10000));
    expect(rebootHp(0)).toBe(1); // 0 부활 금지
  });

  it('coreGuardDamage/Cooldown: 피해↑·간격↓(연사↑, 최소 2틱)', () => {
    expect(coreGuardDamage(100)).toBe(Math.round((100 * (10000 + CORE_GUARD_DAMAGE_BP)) / 10000));
    expect(coreGuardDamage(100)).toBeGreaterThan(100);
    expect(coreGuardCooldown(26)).toBeLessThan(26);
    expect(coreGuardCooldown(1)).toBeGreaterThanOrEqual(2);
  });

  it('shieldShareHp: 풀 비례 내림(음수 풀은 0)', () => {
    expect(shieldShareHp(1000, SHIELD_SHARE_CORE_BP)).toBe(Math.floor((1000 * SHIELD_SHARE_CORE_BP) / 10000));
    expect(shieldShareHp(1000, SHIELD_SHARE_TURRET_BP)).toBe(Math.floor((1000 * SHIELD_SHARE_TURRET_BP) / 10000));
    expect(shieldShareHp(-50, SHIELD_SHARE_CORE_BP)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. 격추 재기동
// ---------------------------------------------------------------------------
describe('마일스톤 ① 격추 재기동', () => {
  function guardianEntity(state: { entities: { kind: string; phase: number; iframes: number }[] }) {
    return state.entities.find((e) => e.kind === 'guardian');
  }

  it('해금 시 스폰 수호는 부활 충전(phase=1)을 갖는다', () => {
    const layout: DefenseLayout = {
      core: { x: 100000, y: 0 },
      turrets: [],
      obstacles: [],
      guardians: [guardianM(GUARDIAN_TITAN, 400, 0, { milestones: MILESTONE_REBOOT })],
    };
    const state = createWorld(1, invasionConfig(layout));
    expect(guardianEntity(state)!.phase).toBe(1);
  });

  it('미해금(마스크 0) 수호는 부활 충전이 없다(phase=0)', () => {
    const layout: DefenseLayout = {
      core: { x: 100000, y: 0 },
      turrets: [],
      obstacles: [],
      guardians: [guardianM(GUARDIAN_TITAN, 400, 0, { milestones: 0 })],
    };
    const state = createWorld(1, invasionConfig(layout));
    expect(guardianEntity(state)!.phase).toBe(0);
  });

  it('부활: 재기동 중(iframes>0) 관측 후 결국 격추(1회 부활 후 소진)', () => {
    // 저내구 인터셉터를 플레이어 바로 앞에 두고 자동 사격으로 격추. 부활 마일스톤이 있으면
    // 한 번 부활하면서 재기동 딜레이(iframes>0)가 관측된다.
    const layout: DefenseLayout = {
      core: { x: 100000, y: 0 },
      turrets: [],
      obstacles: [],
      guardians: [guardianM(GUARDIAN_INTERCEPTOR, 260, 0, { combatScore: 40, milestones: MILESTONE_REBOOT })],
    };
    const state = createWorld(3, invasionConfig(layout));
    let rebootObserved = false;
    let destroyed = false;
    for (let i = 0; i < 4000; i++) {
      stepWorld(state, idle);
      const g = guardianEntity(state);
      if (g !== undefined && g.iframes > 0) rebootObserved = true;
      if (countKind(state, 'guardian') === 0) {
        destroyed = true;
        break;
      }
    }
    expect(rebootObserved).toBe(true); // 부활 발생(재기동 딜레이 관측)
    expect(destroyed).toBe(true); // 충전 소진 후 결국 격추
  });

  it('미해금 수호는 재기동 없이 격추된다(iframes>0 관측 안 됨)', () => {
    const layout: DefenseLayout = {
      core: { x: 100000, y: 0 },
      turrets: [],
      obstacles: [],
      guardians: [guardianM(GUARDIAN_INTERCEPTOR, 260, 0, { combatScore: 40, milestones: 0 })],
    };
    const state = createWorld(3, invasionConfig(layout));
    let rebootObserved = false;
    let destroyed = false;
    for (let i = 0; i < 4000; i++) {
      stepWorld(state, idle);
      const g = guardianEntity(state);
      if (g !== undefined && g.iframes > 0) rebootObserved = true;
      if (countKind(state, 'guardian') === 0) {
        destroyed = true;
        break;
      }
    }
    expect(rebootObserved).toBe(false);
    expect(destroyed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. 코어 근접 수비
// ---------------------------------------------------------------------------
describe('마일스톤 ② 코어 근접 수비', () => {
  // 수호 위치는 고정(플레이어 사거리 안)하고 코어 위치만 바꿔 근접 강화만 격리한다. 발사물 고유
  // id 집합 크기로 누적 발사 수를 센다(enemyBullet 는 소멸하므로 순간 개수로는 부정확 — id 는
  // 단조 증가라 집합 크기가 총 발사 수의 하한).
  function firedCount(seed: number, coreX: number, milestones: number): number {
    const layout: DefenseLayout = {
      core: { x: coreX, y: 0 },
      turrets: [],
      obstacles: [],
      // 수호는 항상 (600,0) — 플레이어(원점) 사거리 안. 코어 위치만 근접/원거리로 바꾼다.
      guardians: [guardianM(GUARDIAN_INTERCEPTOR, 600, 0, { combatScore: 200, milestones })],
    };
    const state = createWorld(seed, invasionConfig(layout));
    const ids = new Set<number>();
    for (let i = 0; i < 240; i++) {
      stepWorld(state, idle);
      for (const e of state.entities) if (e.kind === 'enemyBullet') ids.add(e.id);
    }
    return ids.size;
  }

  it('코어 반경 내 수호는 연사가 빨라 발사물이 더 많다(반경 밖 동일 마일스톤 대비)', () => {
    // 수호 고정(600,0). 코어를 수호 옆(근접, x=640)에 둔 경우 vs 멀리(x=100000). 둘 다 CORE_GUARD
    // 마일스톤을 갖지만, 근접일 때만 강화가 활성화된다.
    const near = firedCount(9, 640, MILESTONE_CORE_GUARD);
    const far = firedCount(9, 100000, MILESTONE_CORE_GUARD);
    expect(near).toBeGreaterThan(far);
  });

  it('마일스톤 미해금이면 코어 근접이라도 강화가 없다(발사 수 동일)', () => {
    // 코어 근접(x=640) 동일 위치에서 마일스톤 유무만 토글. 미해금이면 강화 없이 기본 연사.
    const nearNoMs = firedCount(9, 640, 0);
    const farWithMs = firedCount(9, 100000, MILESTONE_CORE_GUARD);
    expect(nearNoMs).toBe(farWithMs); // 둘 다 기본 연사(강화 미적용)
  });
});

// ---------------------------------------------------------------------------
// 5. 실드 공유
// ---------------------------------------------------------------------------
describe('마일스톤 ③ 실드 공유', () => {
  function coreAndTurretShields(milestones: number): { core: number; turret: number } {
    const layout: DefenseLayout = {
      core: { x: 900, y: 0 },
      turrets: [{ type: TURRET_VULCAN, x: 500, y: 0 }],
      obstacles: [],
      guardians: [guardianM(GUARDIAN_TITAN, 350, 0, { combatScore: 300, milestones })],
    };
    const state = createWorld(1, invasionConfig(layout));
    const core = state.entities.find((e) => e.kind === 'core')!;
    const turret = state.entities.find((e) => e.kind === 'defenseTurret')!;
    return { core: core.targetY, turret: turret.targetY };
  }

  it('해금 시 방어전 시작에 코어·포탑에 전투력 비례 실드 부여', () => {
    const withMs = coreAndTurretShields(MILESTONE_SHIELD_SHARE);
    // 풀 = 수호 실효 HP. 코어/포탑 몫이 각각 bp 비율(내림).
    const pool = resolveGuardianStats(makeGuardianSnapshot(GUARDIAN_TITAN, 300), PERFORMANCE_FULL, 0).hp;
    expect(withMs.core).toBe(shieldShareHp(pool, SHIELD_SHARE_CORE_BP));
    expect(withMs.turret).toBe(shieldShareHp(pool, SHIELD_SHARE_TURRET_BP));
    expect(withMs.core).toBeGreaterThan(0);
  });

  it('미해금이면 실드 없음(targetY=0 — 기존 거동 불변)', () => {
    const noMs = coreAndTurretShields(0);
    expect(noMs.core).toBe(0);
    expect(noMs.turret).toBe(0);
  });

  it('실드가 코어 피해를 흡수한다(코어 HP 손실 감소)', () => {
    // 플레이어 앞(원점 +x)에 코어를 두고 자동 사격. 수호는 멀리 둬 플레이어를 방해하지 않게 한다
    // (실드 풀은 여전히 부여). 고정 틱 후 남은 코어 HP 를 비교 — 실드가 있으면 HP 손실이 적다.
    function coreHpAfter(milestones: number): { hp: number; shield: number } {
      const layout: DefenseLayout = {
        core: { x: 220, y: 0 },
        turrets: [],
        obstacles: [],
        // 수호는 원거리(플레이어 사거리 밖)에 둬 사격·추적 간섭을 배제하되 실드 풀은 제공.
        guardians: [guardianM(GUARDIAN_TITAN, 100000, 100000, { combatScore: 300, milestones })],
      };
      const state = createWorld(5, invasionConfig(layout));
      for (let i = 0; i < 400; i++) {
        if (countKind(state, 'core') === 0) break;
        stepWorld(state, idle);
      }
      const core = state.entities.find((e) => e.kind === 'core');
      return core === undefined ? { hp: 0, shield: 0 } : { hp: core.hp, shield: core.targetY };
    }
    const withShield = coreHpAfter(MILESTONE_SHIELD_SHARE);
    const noShield = coreHpAfter(0);
    // 실드 없는 코어는 400틱 동안 HP 가 깎였다(플레이어 사격이 코어에 실제로 닿음).
    expect(noShield.hp).toBeLessThan(3000);
    // 실드가 피해 일부를 흡수해 실드분만큼 코어 HP 손실이 적다.
    expect(withShield.hp).toBeGreaterThan(noShield.hp);
    expect(withShield.shield).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 6·7. 결정론 + 하위 호환
// ---------------------------------------------------------------------------
describe('마일스톤 — 결정론 + 하위 호환', () => {
  function busyInputs(n: number): InputFrame[] {
    const out: InputFrame[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ moveX: Math.sin(i / 30), moveY: Math.cos(i / 45), aim: (i / 20) % 6.28, dash: i % 80 === 0, special: 0 });
    }
    return out;
  }

  it('모든 마일스톤 해금 config 2회 재실행 → 틱별 해시 스트림 100% 일치', () => {
    const layout: DefenseLayout = {
      core: { x: 700, y: 0 },
      turrets: [{ type: TURRET_VULCAN, x: 500, y: 0 }],
      obstacles: [],
      guardians: [
        guardianM(GUARDIAN_TITAN, 640, -60, { combatScore: 200, lineageBonusBp: 1200, milestones: MILESTONE_MASK_ALL }),
        guardianM(GUARDIAN_INTERCEPTOR, 660, 80, { combatScore: 120, milestones: MILESTONE_MASK_ALL }),
      ],
    };
    const replay: Replay = { seed: 7, config: invasionConfig(layout), inputs: busyInputs(500) };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
  });

  it('milestones=0 == 필드 미지정: 해시 스트림 완전 일치(하위 호환)', () => {
    const base: DefenseLayout = {
      core: { x: 900, y: 0 },
      turrets: [{ type: TURRET_VULCAN, x: 500, y: 0 }],
      obstacles: [],
      guardians: [guardianM(GUARDIAN_TITAN, 350, 0, { combatScore: 140 })], // milestones 미지정
    };
    const withZero: DefenseLayout = {
      ...base,
      guardians: [guardianM(GUARDIAN_TITAN, 350, 0, { combatScore: 140, milestones: 0 })],
    };
    const inputs = busyInputs(300);
    const omitted = runReplay({ seed: 7, config: invasionConfig(base), inputs });
    const zero = runReplay({ seed: 7, config: invasionConfig(withZero), inputs });
    expect(omitted.hashes).toEqual(zero.hashes);
  });

  it('마일스톤 해금 시 해시가 미해금 대비 발산한다(실제 반영)', () => {
    const noMs: DefenseLayout = {
      core: { x: 700, y: 0 },
      turrets: [{ type: TURRET_VULCAN, x: 500, y: 0 }],
      obstacles: [],
      guardians: [guardianM(GUARDIAN_TITAN, 640, 0, { combatScore: 200, milestones: 0 })],
    };
    const withMs: DefenseLayout = {
      ...noMs,
      guardians: [guardianM(GUARDIAN_TITAN, 640, 0, { combatScore: 200, milestones: MILESTONE_MASK_ALL })],
    };
    const inputs = busyInputs(400);
    const a = runReplay({ seed: 7, config: invasionConfig(noMs), inputs });
    const b = runReplay({ seed: 7, config: invasionConfig(withMs), inputs });
    expect(a.finalHash).not.toBe(b.finalHash);
  });
});

// ---------------------------------------------------------------------------
// 8. 배선 — buildGuardianPlacements 가 계보 레벨 → 마스크를 config 로 전달
// ---------------------------------------------------------------------------
describe('마일스톤 배선 (buildGuardianPlacements)', () => {
  it('계보 수호 레벨에 따른 마스크를 각 배치에 실어 준다', () => {
    const p = defaultProfile();
    p.lineage.guardianLevel = CORE_GUARD_LEVEL; // 격추 재기동 + 코어 근접 해금
    p.guardians.push({
      id: 'g-test',
      snapshot: makeGuardianSnapshot(GUARDIAN_TITAN, 200),
      performanceCP: PERFORMANCE_FULL,
      combatScore: 200,
      preset: GUARDIAN_TITAN,
      retired: false,
    });
    const placements = buildGuardianPlacements(p, [{ x: 100, y: 0 }]);
    expect(placements).toHaveLength(1);
    expect(placements[0]!.milestones).toBe(MILESTONE_REBOOT | MILESTONE_CORE_GUARD);
  });

  it('레벨 미달이면 마스크 0(마일스톤 없음)', () => {
    const p = defaultProfile();
    p.lineage.guardianLevel = REBOOT_LEVEL - 1;
    p.guardians.push({
      id: 'g-test',
      snapshot: makeGuardianSnapshot(GUARDIAN_TITAN, 200),
      performanceCP: PERFORMANCE_FULL,
      combatScore: 200,
      preset: GUARDIAN_TITAN,
      retired: false,
    });
    const placements = buildGuardianPlacements(p, [{ x: 100, y: 0 }]);
    expect(placements[0]!.milestones).toBe(0);
  });
});
