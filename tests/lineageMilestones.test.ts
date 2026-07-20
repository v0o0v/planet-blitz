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
import { hashWorld } from '../src/sim/replay.js';
import type { GuardianPlacement } from '../src/sim/invasion/guardian.js';
import { normalizeInvasionLayers } from '../src/sim/invasion/normalize.js';
import type { Invasion3Config, InvasionLayers } from '../src/sim/invasion/types.js';
import { INVASION_CORE_HP, INVASION_TOTAL_TICKS, PHASE_L3 } from '../src/sim/invasion/constants.js';
import { enterCoreRoom } from '../src/sim/invasion/coreRoom.js';
import { makeInvasionContext } from '../src/sim/invasion/step.js';
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

/** 수호는 L3 코어방 슬롯(`l3.guardians`)에 산다 — 고정 길이 + null 허용. */
function layersWith(l3: Record<string, unknown>): InvasionLayers {
  return normalizeInvasionLayers({ l3 });
}

/** 코어 위치·수호만 지정하는 축약(코어 HP 는 기본값). */
function coreAnd(coreX: number, guardians: unknown[]): InvasionLayers {
  return layersWith({ core: { hp: INVASION_CORE_HP, x: coreX, y: 0 }, guardians });
}

function invasionConfig(layers: InvasionLayers): WorldConfig {
  const inv3: Invasion3Config = { layers, timeLimitTicks: INVASION_TOTAL_TICKS };
  return {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 100,
    invasion3: inv3,
  };
}

/**
 * **L3 코어방에서 시작하는** 침공 월드. 마일스톤은 전부 수호 거동이라 코어방에서만 관측된다
 * (L1 대기권·L2 회랑에는 수호 엔티티가 없다).
 */
function coreRoomWorld(seed: number, layers: InvasionLayers) {
  const w = createWorld(seed, invasionConfig(layers));
  w.entities.length = 1; // index 0 = player (hashWorld 불변식)
  w.invasion3!.phase = PHASE_L3;
  w.invasion3!.phaseEnterTick = 0;
  enterCoreRoom(w, makeInvasionContext(w.config.invasion3!, w.invasion3!));
  return w;
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
    const state = coreRoomWorld(1, coreAnd(100000, [guardianM(GUARDIAN_TITAN, 400, 0, { milestones: MILESTONE_REBOOT })]));
    expect(guardianEntity(state)!.phase).toBe(1);
  });

  it('미해금(마스크 0) 수호는 부활 충전이 없다(phase=0)', () => {
    const state = coreRoomWorld(1, coreAnd(100000, [guardianM(GUARDIAN_TITAN, 400, 0, { milestones: 0 })]));
    expect(guardianEntity(state)!.phase).toBe(0);
  });

  it('부활: 재기동 중(iframes>0) 관측 후 결국 격추(1회 부활 후 소진)', () => {
    // 저내구 인터셉터를 플레이어 바로 앞에 두고 자동 사격으로 격추. 부활 마일스톤이 있으면
    // 한 번 부활하면서 재기동 딜레이(iframes>0)가 관측된다.
    const state = coreRoomWorld(3, coreAnd(100000, [guardianM(GUARDIAN_INTERCEPTOR, 260, 0, { combatScore: 40, milestones: MILESTONE_REBOOT })]));
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
    const state = coreRoomWorld(3, coreAnd(100000, [guardianM(GUARDIAN_INTERCEPTOR, 260, 0, { combatScore: 40, milestones: 0 })]));
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
  /**
   * 수호가 쏜 적탄의 누적 개수. 두 가지 교란을 **설계로** 제거한다(구 판은 이걸 놓쳐
   * '근접 vs 원거리' 비교가 강화가 아니라 다른 요인을 재고 있었다).
   *
   *   ① **코어방 보스의 탄이 섞인다.** 빈 보스 슬롯을 기본 수비대(강철 골리앗)가 충원하고,
   *      보스는 코어 옆에 스폰된다 — 코어를 옮기면 보스 사거리가 통째로 바뀌어 전체 적탄 수가
   *      수 배 갈린다. 그래서 **수호 위치에서 갓 생성된 탄만** 센다(수호는 자기 좌표에 탄을
   *      스폰하므로 반경 200 안이면 수호 탄이다).
   *   ② **플레이어 사망으로 런이 조기 종료된다.** 강화된 쪽이 더 아프게 때려 먼저 죽으면
   *      관측 창이 짧아져 발사 수가 **거꾸로** 적게 나온다. 플레이어 HP 를 크게 잡아 두 팔 모두
   *      600틱을 온전히 돌린다.
   *
   * 두 팔의 **코어 좌표는 항상 같게** 두고 마일스톤만 토글한다 — 그래야 보스 배치·플레이어
   * 조준이 완전히 동일해져 차이가 근접 강화 하나로만 남는다.
   */
  function firedCount(seed: number, coreX: number, milestones: number): number {
    // 수호는 항상 (600,0) — 플레이어(원점) 사거리 안.
    const state = coreRoomWorld(seed, coreAnd(coreX, [guardianM(GUARDIAN_INTERCEPTOR, 600, 0, { combatScore: 200, milestones })]));
    const player = state.entities[0]!;
    player.maxHp = 1e9;
    player.hp = 1e9;
    const ids = new Set<number>();
    for (let i = 0; i < 600; i++) {
      stepWorld(state, idle);
      const g = state.entities.find((e) => e.kind === 'guardian' && !e.dead);
      if (g === undefined) continue;
      for (const e of state.entities) {
        if (e.kind !== 'enemyBullet' || ids.has(e.id)) continue;
        const dx = e.x - g.x;
        const dy = e.y - g.y;
        if (dx * dx + dy * dy < 200 * 200) ids.add(e.id);
      }
    }
    return ids.size;
  }

  it('코어 반경 내 수호는 연사가 빨라 발사물이 더 많다(같은 코어 위치·마일스톤만 토글)', () => {
    // 코어를 수호 옆(x=640, 반경 420 안)에 고정하고 마일스톤만 켠다.
    const withMs = firedCount(9, 640, MILESTONE_CORE_GUARD);
    const noMs = firedCount(9, 640, 0);
    expect(withMs).toBeGreaterThan(noMs);
  });

  it('반경 밖이면 마일스톤이 있어도 강화가 없다(발사 수 동일)', () => {
    // 코어를 멀리(x=100000) 고정하면 근접 판정이 서지 않아 마일스톤 유무가 거동을 못 바꾼다.
    const farWithMs = firedCount(9, 100000, MILESTONE_CORE_GUARD);
    const farNoMs = firedCount(9, 100000, 0);
    expect(farWithMs).toBe(farNoMs);
  });
});

// ---------------------------------------------------------------------------
// 5. 실드 공유
// ---------------------------------------------------------------------------
describe('마일스톤 ③ 실드 공유', () => {
  // 3레이어 코어방에는 포탑이 없다(설비는 L2 회랑에 산다) — 실드 공유는 **코어 몫만** 계산한다
  // (guardianBridge.guardianShieldShareHp). 포탑 몫 상수(SHIELD_SHARE_TURRET_BP)는 순수 함수
  // 테스트에만 남는다.
  function coreShield(milestones: number): number {
    const state = coreRoomWorld(1, coreAnd(900, [guardianM(GUARDIAN_TITAN, 350, 0, { combatScore: 300, milestones })]));
    return state.entities.find((e) => e.kind === 'core')!.targetY;
  }

  it('해금 시 방어전 시작에 코어에 전투력 비례 실드 부여', () => {
    // 풀 = 수호 실효 HP. 코어 몫이 bp 비율(내림).
    const pool = resolveGuardianStats(makeGuardianSnapshot(GUARDIAN_TITAN, 300), PERFORMANCE_FULL, 0).hp;
    const withMs = coreShield(MILESTONE_SHIELD_SHARE);
    expect(withMs).toBe(shieldShareHp(pool, SHIELD_SHARE_CORE_BP));
    expect(withMs).toBeGreaterThan(0);
  });

  it('미해금이면 실드 없음(targetY=0 — 기존 거동 불변)', () => {
    expect(coreShield(0)).toBe(0);
  });

  it('실드가 코어 피해를 흡수한다(코어 HP 손실 감소)', () => {
    // 플레이어 앞(원점 +x)에 코어를 두고 자동 사격. 수호는 멀리 둬 플레이어를 방해하지 않게 한다
    // (실드 풀은 여전히 부여). 고정 틱 후 남은 코어 HP 를 비교 — 실드가 있으면 HP 손실이 적다.
    function coreHpAfter(milestones: number): { hp: number; shield: number } {
      // 수호는 원거리(플레이어 사거리 밖)에 둬 사격·추적 간섭을 배제하되 실드 풀은 제공.
      const state = coreRoomWorld(
        5,
        coreAnd(220, [guardianM(GUARDIAN_TITAN, 100000, 100000, { combatScore: 300, milestones })]),
      );
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
    expect(noShield.hp).toBeLessThan(INVASION_CORE_HP);
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

  /**
   * L3 코어방에서 `inputs` 를 소화하며 매 틱 hashWorld 를 모은다.
   *
   * 구 판은 `runReplay` 로 해시 스트림을 얻었지만, 3레이어 런은 **L1 대기권에서 시작**해
   * 코어방까지 1만 틱 넘게 걸린다 — 수백 틱짜리 리플레이로는 수호가 스폰조차 되지 않아
   * 마일스톤 거동이 해시에 실리지 않는다(설정 폴드만 갈리는 공허한 대조가 된다). 그래서
   * 위 단위 케이스들과 같은 `coreRoomWorld` 규약으로 코어방에서 직접 굴린다.
   */
  function coreRoomHashes(seed: number, layers: InvasionLayers, inputs: InputFrame[]): number[] {
    const w = coreRoomWorld(seed, layers);
    const out: number[] = [];
    for (const f of inputs) {
      stepWorld(w, f);
      out.push(hashWorld(w));
    }
    return out;
  }

  it('모든 마일스톤 해금 배치 2회 재실행 → 틱별 해시 스트림 100% 일치', () => {
    const layers = coreAnd(700, [
      guardianM(GUARDIAN_TITAN, 640, -60, { combatScore: 200, lineageBonusBp: 1200, milestones: MILESTONE_MASK_ALL }),
      guardianM(GUARDIAN_INTERCEPTOR, 660, 80, { combatScore: 120, milestones: MILESTONE_MASK_ALL }),
    ]);
    const inputs = busyInputs(500);
    const a = coreRoomHashes(7, layers, inputs);
    const b = coreRoomHashes(7, layers, inputs);
    expect(a).toEqual(b);
    expect(a[a.length - 1]).toBe(b[b.length - 1]);
  });

  it('milestones=0 == 필드 미지정: 해시 스트림 완전 일치(하위 호환)', () => {
    // 미지정은 정규화가 0 으로 접는다 — 설정 폴드도 거동도 완전히 같아야 한다.
    const base = coreAnd(900, [guardianM(GUARDIAN_TITAN, 350, 0, { combatScore: 140 })]); // milestones 미지정
    const withZero = coreAnd(900, [guardianM(GUARDIAN_TITAN, 350, 0, { combatScore: 140, milestones: 0 })]);
    const inputs = busyInputs(300);
    expect(coreRoomHashes(7, base, inputs)).toEqual(coreRoomHashes(7, withZero, inputs));
  });

  it('마일스톤 해금 시 해시가 미해금 대비 발산한다(실제 반영)', () => {
    const noMs = coreAnd(700, [guardianM(GUARDIAN_TITAN, 640, 0, { combatScore: 200, milestones: 0 })]);
    const withMs = coreAnd(700, [
      guardianM(GUARDIAN_TITAN, 640, 0, { combatScore: 200, milestones: MILESTONE_MASK_ALL }),
    ]);
    const inputs = busyInputs(400);
    const a = coreRoomHashes(7, noMs, inputs);
    const b = coreRoomHashes(7, withMs, inputs);
    expect(a[a.length - 1]).not.toBe(b[b.length - 1]);
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
