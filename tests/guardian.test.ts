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
import type { GuardianPlacement } from '../src/sim/invasion/guardian.js';
import { normalizeInvasionLayers, emptyInvasionLayers } from '../src/sim/invasion/normalize.js';
import type { Invasion3Config, InvasionLayers } from '../src/sim/invasion/types.js';
import { INVASION_TOTAL_TICKS, PHASE_L3 } from '../src/sim/invasion/constants.js';
import { enterCoreRoom } from '../src/sim/invasion/coreRoom.js';
import { makeInvasionContext } from '../src/sim/invasion/step.js';
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

/**
 * 3레이어 배치를 만든다. 수호는 **L3 코어방 슬롯**(`l3.guardians`)에 산다 — 고정 길이 +
 * null 허용이라 슬롯 i 가 곧 엔티티 `pierce` 다(guardianBridge 매핑 계약).
 */
function layersWith(l3: Record<string, unknown>): InvasionLayers {
  return normalizeInvasionLayers({ l3 });
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
 * **L3 코어방에서 시작하는** 침공 월드. 수호는 L1(대기권)·L2(회랑)에는 존재하지 않고 코어방
 * 진입 시 스폰되므로, 거동 테스트는 페이즈를 L3 로 맞춘 뒤 진입 훅을 태워야 한다. 이후
 * `stepWorld` 는 phase===2 를 보고 매 틱 코어방 훅(수호 스텝 포함)을 디스패치한다.
 */
function coreRoomWorld(seed: number, layers: InvasionLayers) {
  const cfg = invasionConfig(layers);
  const w = createWorld(seed, cfg);
  // L1 진입 훅이 깔아 둔 편대 잔재를 지우고 코어방으로 갈아탄다(순수 테스트 격리).
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

describe('수호 기체 — 스폰 (plan A1)', () => {
  it('수호 배치대로 스폰하되 동시 상한(2기)을 넘지 않는다', () => {
    const layers = layersWith({
      core: { hp: 8000, x: 800, y: 0 },
      guardians: [
        guardian(GUARDIAN_TITAN, 300, 0),
        guardian(GUARDIAN_INTERCEPTOR, 300, 200),
        guardian(GUARDIAN_TITAN, 300, -200), // 3번째 — 슬롯 상한 초과, 정규화가 절단
      ],
    });
    expect(MAX_GUARDIAN_SLOTS).toBe(2);
    expect(layers.l3.guardians.length).toBe(2);
    const state = coreRoomWorld(1, layers);
    expect(countKind(state, 'guardian')).toBe(2);
    expect(state.entities[0]!.kind).toBe('player'); // player 불변식
  });

  it('빈 수호 슬롯 배치는 수호가 없다(기본 수비대 충원 대상 아님)', () => {
    const state = coreRoomWorld(1, emptyInvasionLayers());
    expect(countKind(state, 'guardian')).toBe(0);
  });

  it('슬롯 i ↔ 엔티티 pierce i (빈 슬롯을 밀집화하지 않는다)', () => {
    // 슬롯 0 은 비우고 1 만 채운다 — 밀집화하면 pierce 가 0 이 되어 SQL·EF 매핑이 어긋난다.
    const layers = layersWith({ guardians: [null, guardian(GUARDIAN_TITAN, 300, 0)] });
    const state = coreRoomWorld(1, layers);
    const g = state.entities.filter((e) => e.kind === 'guardian');
    expect(g.length).toBe(1);
    expect(g[0]!.pierce).toBe(1);
  });
});

describe('수호 기체 — 결정론 (AC2)', () => {
  it('수호 2기 포함 방어전 2회 재실행이 틱별 해시 스트림 100% 일치', () => {
    const layers = layersWith({
      core: { hp: 8000, x: 900, y: 0 },
      guardians: [
        guardian(GUARDIAN_TITAN, 350, -100, 140, PERFORMANCE_FULL, 1200),
        guardian(GUARDIAN_INTERCEPTOR, 400, 150, 90, 7500, 800),
      ],
    });
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
    const replay: Replay = { seed: 7, config: invasionConfig(layers), inputs };
    const a = runReplay(replay);
    const b = runReplay(replay);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalHash).toBe(b.finalHash);
    expect(a.hashes.length).toBe(500);
  });
});

describe('수호 기체 — 해시(배치가 결정론 입력으로 봉인된다)', () => {
  it('빈 수호 슬롯 == 명시 null 슬롯: 침공 해시 스트림 완전 일치', () => {
    // 정규화가 두 표현을 같은 정규형(고정 길이 null 배열)으로 접으므로 해시가 바이트 동일하다.
    const omittedLayers = layersWith({ core: { hp: 8000, x: 900, y: 0 } });
    const explicitNulls = layersWith({ core: { hp: 8000, x: 900, y: 0 }, guardians: [null, null] });
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 300; i++) {
      inputs.push({ moveX: Math.sin(i / 20), moveY: 0, aim: (i / 25) % 6.28, dash: false, special: 0 });
    }
    const omitted = runReplay({ seed: 7, config: invasionConfig(omittedLayers), inputs });
    const empty = runReplay({ seed: 7, config: invasionConfig(explicitNulls), inputs });
    expect(omitted.hashes).toEqual(empty.hashes);
  });

  it('수호 추가 시 해시가 발산한다(수호가 결정론 입력으로 실제 반영됨)', () => {
    const base = layersWith({ core: { hp: 8000, x: 100000, y: 0 } });
    const withG = layersWith({
      core: { hp: 8000, x: 100000, y: 0 },
      guardians: [guardian(GUARDIAN_TITAN, 300, 0)],
    });
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 200; i++) inputs.push(idle);
    const a = runReplay({ seed: 7, config: invasionConfig(base), inputs });
    const b = runReplay({ seed: 7, config: invasionConfig(withG), inputs });
    expect(a.finalHash).not.toBe(b.finalHash);
  });
});

describe('수호 기체 — 거동 (plan A1)', () => {
  it('수호가 사거리 안 플레이어를 향해 발사물(enemyBullet)을 생성한다', () => {
    const state = coreRoomWorld(
      11,
      layersWith({ core: { hp: 8000, x: 100000, y: 0 }, guardians: [guardian(GUARDIAN_TITAN, 400, 0)] }),
    );
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
    // 먼 곳에 인터셉터(고속) — 플레이어(0,0)로 접근해야 한다.
    const state = coreRoomWorld(
      11,
      layersWith({ core: { hp: 8000, x: 100000, y: 0 }, guardians: [guardian(GUARDIAN_INTERCEPTOR, 4000, 0)] }),
    );
    const startX = state.entities.find((e) => e.kind === 'guardian')!.x;
    for (let i = 0; i < 200; i++) stepWorld(state, idle);
    const g1 = state.entities.find((e) => e.kind === 'guardian')!;
    expect(g1.x).toBeLessThan(startX); // 플레이어(원점) 쪽으로 접근
  });

  it('수호는 플레이어 탄에 파괴된다(targetable)', () => {
    // 저내구 인터셉터를 플레이어 바로 앞에 두고, 플레이어 자동 사격으로 파괴 확인.
    const state = coreRoomWorld(
      3,
      layersWith({
        core: { hp: 8000, x: 100000, y: 0 },
        guardians: [guardian(GUARDIAN_INTERCEPTOR, 260, 0, 40)],
      }),
    );
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
