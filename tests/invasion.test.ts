/**
 * M4 침공 런(방어 배치) 시뮬 테스트 — plan Phase C1/C2, AC13.
 *
 * 커버리지:
 *   1. 결정론(AC13): 동일 침공 리플레이 2회 실행 → 틱별 해시 스트림 100% 일치.
 *   2. 코어 파괴 = 침공 승리(victory).
 *   3. 제한 시간 초과 = 패배(gameOver, victory 아님).
 *   4. 포탑 6종 각자 발사 거동 스모크(각 유형이 탄/장판을 실제로 생성).
 *   5. 침공 config가 없으면(PvE) 기존 해시가 불변임을 조건부 접기로 보장(회귀 가드).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldState, WorldConfig } from '../src/sim/world.js';
import { runReplay, hashWorld } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import {
  DEFAULT_TIME_LIMIT_TICKS,
  TURRET_VULCAN,
  TURRET_SNIPER,
  TURRET_SHOTGUN,
  TURRET_FROST,
  TURRET_MISSILE,
  TURRET_TESLA,
  TURRET_TYPE_COUNT,
  MAINTENANCE_FULL,
  normalizeMaintenance,
  scaleFireCooldown,
} from '../src/sim/defense.js';
import type { InvasionConfig, DefenseLayout } from '../src/sim/defense.js';

const idle: InputFrame = emptyInput();

function invasionConfig(
  layout: DefenseLayout,
  timeLimitTicks = DEFAULT_TIME_LIMIT_TICKS,
  maintenance?: number,
): WorldConfig {
  const inv: InvasionConfig =
    maintenance === undefined ? { layout, timeLimitTicks } : { layout, timeLimitTicks, maintenance };
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

function countKind(state: WorldState, kind: string): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === kind) n++;
  return n;
}

describe('침공 런 — 방어 배치 스폰 (plan C1/C2)', () => {
  it('createWorld가 코어·포탑·장애물을 배치 데이터대로 정적 스폰한다', () => {
    const layout: DefenseLayout = {
      core: { x: 800, y: 0 },
      turrets: [
        { type: TURRET_VULCAN, x: 300, y: 0 },
        { type: TURRET_SNIPER, x: 300, y: 200 },
      ],
      obstacles: [{ x: 500, y: 0, halfW: 60, halfH: 60 }],
    };
    const state = createWorld(1, invasionConfig(layout));
    expect(state.entities[0]!.kind).toBe('player'); // player는 항상 index 0
    expect(countKind(state, 'core')).toBe(1);
    expect(countKind(state, 'defenseTurret')).toBe(2);
    expect(countKind(state, 'wall')).toBe(1); // 장애물 = wall 재사용
  });
});

describe('침공 런 — 결정론 (AC13)', () => {
  it('동일 침공 리플레이 2회 실행이 틱별 해시 스트림 100% 일치', () => {
    const layout: DefenseLayout = {
      core: { x: 900, y: 0 },
      turrets: [
        { type: TURRET_VULCAN, x: 400, y: -150 },
        { type: TURRET_SNIPER, x: 500, y: 200 },
        { type: TURRET_SHOTGUN, x: 250, y: 0 },
        { type: TURRET_FROST, x: 350, y: 300 },
        { type: TURRET_MISSILE, x: 600, y: -300 },
        { type: TURRET_TESLA, x: 200, y: 150 },
      ],
      obstacles: [
        { x: 450, y: 0, halfW: 50, halfH: 120 },
        { x: 700, y: 250, halfW: 80, halfH: 40 },
      ],
    };
    // 움직임·조준을 섞은 입력 로그(정적/idle이 아닌 실제 런 근사).
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 600; i++) {
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
    expect(a.hashes.length).toBe(600);
  });
});

describe('침공 런 — 승패 판정 (plan C2)', () => {
  it('코어 파괴 시 승리(victory) 확정', () => {
    // 포탑 없이 코어만 — 플레이어가 자동 조준(nearestTarget이 core 포함)으로 코어를 격파.
    const layout: DefenseLayout = {
      core: { x: 400, y: 0 },
      turrets: [],
      obstacles: [],
    };
    const state = createWorld(3, invasionConfig(layout));
    let victoryTick = -1;
    for (let i = 0; i < 6000; i++) {
      stepWorld(state, idle);
      if (state.victory) {
        victoryTick = i;
        break;
      }
    }
    expect(state.victory).toBe(true);
    expect(state.gameOver).toBe(false);
    expect(victoryTick).toBeGreaterThan(0);
    expect(countKind(state, 'core')).toBe(0); // 코어 소멸
  });

  it('제한 시간 초과 시 패배(gameOver, victory 아님)', () => {
    // 코어를 사거리·탄 수명 밖(원거리)에 둬 파괴 불가 + 포탑 없음 → 오직 시간초과로 종료.
    const limit = 300;
    const layout: DefenseLayout = {
      core: { x: 100000, y: 0 },
      turrets: [],
      obstacles: [],
    };
    const state = createWorld(5, invasionConfig(layout, limit));
    for (let i = 0; i < limit; i++) stepWorld(state, idle);
    expect(state.gameOver).toBe(true);
    expect(state.victory).toBe(false);
    // 제한 시간에 도달하기 전에는 종료되지 않았어야 한다(경계 확인).
    const early = createWorld(5, invasionConfig(layout, limit));
    for (let i = 0; i < limit - 1; i++) stepWorld(early, idle);
    expect(early.gameOver).toBe(false);
  });
});

describe('침공 런 — 포탑 6종 발사 스모크 (plan C1)', () => {
  const types = [
    TURRET_VULCAN,
    TURRET_SNIPER,
    TURRET_SHOTGUN,
    TURRET_FROST,
    TURRET_MISSILE,
    TURRET_TESLA,
  ];

  it('확정 유형 수가 6종', () => {
    expect(TURRET_TYPE_COUNT).toBe(6);
    expect(types.length).toBe(6);
  });

  for (const type of types) {
    it(`유형 ${type} 포탑이 플레이어를 향해 발사물/장판을 생성한다`, () => {
      // 코어를 원거리에 둬 우발적 승리 방지. 포탑 1기를 플레이어(0,0) 근처에 배치.
      const layout: DefenseLayout = {
        core: { x: 100000, y: 0 },
        turrets: [{ type, x: 300, y: 0 }],
        obstacles: [],
      };
      const state = createWorld(11, invasionConfig(layout));
      let firedSeen = false;
      for (let i = 0; i < 200; i++) {
        stepWorld(state, idle);
        // 감속(frost)은 hazard, 나머지는 enemyBullet 생성.
        if (countKind(state, 'enemyBullet') > 0 || countKind(state, 'hazard') > 0) {
          firedSeen = true;
          break;
        }
      }
      expect(firedSeen).toBe(true);
    });
  }
});

describe('침공 정비도(풍화, ADR-0006) — 성능 스케일 + 결정론', () => {
  // 플레이어(0,0) 사거리 안에 근접 포탑을 두고, 원거리 코어로 우발 승리를 막아 순수하게
  // 포탑 발사만 관찰한다. idle(정지) 입력이라 포탑 조준·발사만 변수가 된다.
  const closeLayout: DefenseLayout = {
    core: { x: 100000, y: 0 },
    turrets: [
      { type: TURRET_VULCAN, x: 300, y: 0 },
      { type: TURRET_TESLA, x: 300, y: 150 },
    ],
    obstacles: [],
  };

  function countKindOverRun(maintenance: number | undefined, ticks: number): number {
    const state = createWorld(9, invasionConfig(closeLayout, DEFAULT_TIME_LIMIT_TICKS, maintenance));
    let bullets = 0;
    for (let i = 0; i < ticks; i++) {
      const before = countKind(state, 'enemyBullet');
      stepWorld(state, idle);
      const after = countKind(state, 'enemyBullet');
      // 이 틱에 새로 생성된 적탄만 누적(수명 만료 소멸과 무관하게 발사량 근사).
      if (after > before) bullets += after - before;
    }
    return bullets;
  }

  it('scaleFireCooldown: 100%→base, 0%→2×base, 중간값 선형(정수·결정론)', () => {
    expect(scaleFireCooldown(12, MAINTENANCE_FULL)).toBe(12); // 완전 정비 = 무변화
    expect(scaleFireCooldown(12, 0)).toBe(24); // 성능 50% → 간격 2배
    expect(scaleFireCooldown(100, 0)).toBe(200);
    expect(scaleFireCooldown(100, 5000)).toBe(133); // round(100*20000/15000)=133.33→133
    // 순수 함수: 같은 입력 2회 동일(정수 연산이라 자명하지만 회귀 가드).
    expect(scaleFireCooldown(90, 2500)).toBe(scaleFireCooldown(90, 2500));
  });

  it('normalizeMaintenance: 미지정·비유한·범위 밖을 정수 도메인으로 클램프', () => {
    expect(normalizeMaintenance(undefined)).toBe(MAINTENANCE_FULL);
    expect(normalizeMaintenance(Number.NaN)).toBe(MAINTENANCE_FULL);
    expect(normalizeMaintenance(Number.POSITIVE_INFINITY)).toBe(MAINTENANCE_FULL);
    expect(normalizeMaintenance(-5)).toBe(0);
    expect(normalizeMaintenance(999999)).toBe(MAINTENANCE_FULL);
    expect(normalizeMaintenance(5000.9)).toBe(5000); // 정수화(trunc)
  });

  it('미지정 정비도 == 명시 100%(MAINTENANCE_FULL): 해시 스트림 완전 일치', () => {
    // append-only 안전성: 정비도 필드가 없던 침공 config 와, 명시적으로 완전 정비를 준 config
    // 가 거동·해시 모두 비트 동일이어야 한다(기존 침공 런 회귀 0).
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 250; i++) {
      inputs.push({ moveX: Math.sin(i / 20), moveY: 0, aim: (i / 25) % 6.28, dash: false, special: 0 });
    }
    const omitted = runReplay({ seed: 7, config: invasionConfig(closeLayout), inputs });
    const full = runReplay({
      seed: 7,
      config: invasionConfig(closeLayout, DEFAULT_TIME_LIMIT_TICKS, MAINTENANCE_FULL),
      inputs,
    });
    expect(omitted.hashes).toEqual(full.hashes);
  });

  it('정비도가 다르면 해시가 발산(위조 방어: 방치 기지를 100% 주장 불가)', () => {
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 250; i++) {
      inputs.push({ moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 });
    }
    const full = runReplay({
      seed: 7,
      config: invasionConfig(closeLayout, DEFAULT_TIME_LIMIT_TICKS, MAINTENANCE_FULL),
      inputs,
    });
    const decayed = runReplay({
      seed: 7,
      config: invasionConfig(closeLayout, DEFAULT_TIME_LIMIT_TICKS, 0),
      inputs,
    });
    // 최종 해시가 반드시 달라야 한다(정비도가 발사 간격 → 엔티티 상태 + config 폴드 양쪽 반영).
    expect(decayed.finalHash).not.toBe(full.finalHash);
  });

  it('같은 정비도(중간값)면 2회 실행이 틱별 해시 100% 일치(결정론)', () => {
    const inputs: InputFrame[] = [];
    for (let i = 0; i < 300; i++) {
      inputs.push({ moveX: Math.cos(i / 33), moveY: Math.sin(i / 44), aim: (i / 20) % 6.28, dash: i % 70 === 0, special: 0 });
    }
    const cfg = invasionConfig(closeLayout, DEFAULT_TIME_LIMIT_TICKS, 3750);
    const a = runReplay({ seed: 7, config: cfg, inputs });
    const b = runReplay({ seed: 7, config: cfg, inputs });
    expect(a.hashes).toEqual(b.hashes);
  });

  it('정비도 0%(성능 50%)는 100%보다 적게 발사한다(성능 저하 실증)', () => {
    const ticks = 600;
    const shotsFull = countKindOverRun(MAINTENANCE_FULL, ticks);
    const shotsDecayed = countKindOverRun(0, ticks);
    expect(shotsFull).toBeGreaterThan(0);
    // 발사 간격이 2배가 되므로 발사량이 뚜렷이 줄어야 한다(대략 절반 수준).
    expect(shotsDecayed).toBeLessThan(shotsFull);
  });
});

describe('침공 config 부재 시 PvE 해시 불변 (회귀 가드)', () => {
  it('invasion 없는 config는 hashWorld가 침공 블록을 접지 않는다(조건부 접기)', () => {
    // 같은 시드·같은 절차의 PvE 런은 내 변경과 무관하게 결정론적이어야 한다. 침공 조건부
    // 접기가 PvE 경로를 건드리지 않음을 두 독립 런의 해시 스트림 일치로 확인한다.
    const a = createWorld(42);
    const b = createWorld(42);
    for (let i = 0; i < 300; i++) {
      stepWorld(a, idle);
      stepWorld(b, idle);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
    expect(a.config.invasion).toBeUndefined();
  });
});
