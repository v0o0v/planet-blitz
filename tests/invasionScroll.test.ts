/**
 * 침공 3레이어 — 강제 스크롤 카메라 (M7a · L2-scroll-phase).
 *
 * 커버리지:
 *   1. 스크롤 오프셋이 틱의 순수 함수(같은 입력 → 같은 오프셋 수열).
 *   2. 가속 배율이 정수 centi-percent 로 [100, 200] 클램프.
 *   3. 스크롤 창 클램프로 플레이어가 창 밖으로 이탈 불가.
 *   4. 컬링·카메라 분기가 PvE 경로를 건드리지 않음(회귀 가드).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { snapshotWorld } from '../src/sim/snapshot.js';
import { hashWorld } from '../src/sim/replay.js';
import { emptyInvasionLayers } from '../src/sim/invasion/normalize.js';
import {
  INVASION_ACCEL_BASE_CP,
  INVASION_ACCEL_MAX_CP,
  INVASION_TOTAL_TICKS,
  PHASE_L1,
} from '../src/sim/invasion/constants.js';
import {
  INVASION_SCROLL_SPEED,
  INVASION_WINDOW_HALF_H,
  INVASION_WINDOW_HALF_W,
  clampToWindow,
  createInvasionRuntime,
  nextAccelCp,
  scrollStep,
} from '../src/sim/invasion/scroll.js';

const idle: InputFrame = emptyInput();

/** 빈 배치(전 슬롯 null)의 3레이어 침공 config. 진입 훅 미배선이라 엔티티는 플레이어뿐이다. */
function invasion3Config(): WorldConfig {
  return {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 100,
    invasion3: {
      layers: emptyInvasionLayers(),
      timeLimitTicks: INVASION_TOTAL_TICKS,
    },
  };
}

function pveConfig(): WorldConfig {
  return {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 100,
  };
}

function runTicks(state: WorldState, ticks: number, input: InputFrame = idle): void {
  for (let i = 0; i < ticks; i++) stepWorld(state, input);
}

describe('스크롤 수학 — 순수 함수', () => {
  it('scrollStep 은 가속 배율만의 함수이고 정수를 낸다', () => {
    expect(scrollStep(INVASION_ACCEL_BASE_CP)).toBe(INVASION_SCROLL_SPEED);
    expect(scrollStep(INVASION_ACCEL_MAX_CP)).toBe(INVASION_SCROLL_SPEED * 2);
    for (let cp = INVASION_ACCEL_BASE_CP; cp <= INVASION_ACCEL_MAX_CP; cp++) {
      const s = scrollStep(cp);
      expect(Number.isInteger(s)).toBe(true);
      // 단조 증가(같거나 커진다) — 가속이 붙었는데 느려지는 구간은 없어야 한다.
      expect(s).toBeGreaterThanOrEqual(scrollStep(cp - 1 < INVASION_ACCEL_BASE_CP ? cp : cp - 1));
    }
  });

  it('가속 배율은 전멸 중 상승, 비전멸 하강, 항상 [100, 200] 클램프', () => {
    // 하한: 기본값에서 더 감쇠해도 100 아래로 안 내려간다.
    expect(nextAccelCp(INVASION_ACCEL_BASE_CP, false)).toBe(INVASION_ACCEL_BASE_CP);
    // 상한: 충분히 오래 전멸이면 200 에서 멈춘다.
    let cp = INVASION_ACCEL_BASE_CP;
    for (let i = 0; i < 1000; i++) cp = nextAccelCp(cp, true);
    expect(cp).toBe(INVASION_ACCEL_MAX_CP);
    // 감쇠(4)가 가산(2)보다 빠르다.
    const up = nextAccelCp(150, true) - 150;
    const down = 150 - nextAccelCp(150, false);
    expect(down).toBeGreaterThan(up);
    // 전 구간 정수.
    for (let c = INVASION_ACCEL_BASE_CP; c <= INVASION_ACCEL_MAX_CP; c++) {
      expect(Number.isInteger(nextAccelCp(c, true))).toBe(true);
      expect(Number.isInteger(nextAccelCp(c, false))).toBe(true);
    }
  });

  it('clampToWindow 는 창 안쪽(반지름 여유)으로 접는다', () => {
    const rt = createInvasionRuntime();
    rt.scrollX = 500;
    rt.scrollY = -1200;
    const r = 32;
    const far = clampToWindow(99999, -99999, r, rt);
    expect(far.x).toBe(rt.scrollX + INVASION_WINDOW_HALF_W - r);
    expect(far.y).toBe(rt.scrollY - INVASION_WINDOW_HALF_H + r);
    // 이미 안쪽이면 그대로.
    const inside = clampToWindow(rt.scrollX + 10, rt.scrollY - 10, r, rt);
    expect(inside.x).toBe(rt.scrollX + 10);
    expect(inside.y).toBe(rt.scrollY - 10);
  });
});

describe('스크롤 — sim 권위 카메라', () => {
  it('스크롤 오프셋 수열이 같은 입력에서 바이트 동일하다(틱 순수 함수)', () => {
    const a = createWorld(4242, invasion3Config());
    const b = createWorld(4242, invasion3Config());
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 600; i++) {
      stepWorld(a, idle);
      stepWorld(b, idle);
      seqA.push(a.invasion3?.scrollY ?? 0);
      seqB.push(b.invasion3?.scrollY ?? 0);
    }
    expect(seqA).toEqual(seqB);
    // 전 항목 정수 · 단조 감소(L1 은 -Y 방향).
    for (let i = 1; i < seqA.length; i++) {
      expect(Number.isInteger(seqA[i])).toBe(true);
      expect(seqA[i]!).toBeLessThan(seqA[i - 1]!);
    }
  });

  it('L1 첫 틱 스크롤은 기준 속도 그대로다(가속은 다음 틱부터 반영)', () => {
    const w = createWorld(1, invasion3Config());
    stepWorld(w, idle);
    // 첫 틱의 가속 갱신은 전멸 상태(엔티티=플레이어뿐)라 +2cp → 102cp, step = trunc(12*102/100)=12.
    expect(w.invasion3?.accelCp).toBe(INVASION_ACCEL_BASE_CP + 2);
    expect(w.invasion3?.scrollY).toBe(-INVASION_SCROLL_SPEED);
  });

  it('스냅샷 카메라가 스크롤 창 중심을 따른다(플레이어 파생이 아니다)', () => {
    const w = createWorld(7, invasion3Config());
    runTicks(w, 120, { ...idle, moveX: 1 });
    const snap = snapshotWorld(w);
    expect(snap.cameraX).toBe(w.invasion3?.scrollX);
    expect(snap.cameraY).toBe(w.invasion3?.scrollY);
    // 플레이어는 오른쪽으로 이동했으므로 카메라와 좌표가 갈린다 — 파생이 아니라는 증거.
    const player = w.entities[0]!;
    expect(player.x).not.toBe(snap.cameraX);
  });

  it('플레이어는 어느 방향으로 밀어도 스크롤 창을 벗어나지 못한다', () => {
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
    ];
    for (const [mx, my] of dirs) {
      const w = createWorld(99, invasion3Config());
      const input: InputFrame = { ...idle, moveX: mx, moveY: my, dash: true };
      for (let i = 0; i < 400; i++) {
        stepWorld(w, input);
        const rt = w.invasion3!;
        const p = w.entities[0]!;
        expect(Math.abs(p.x - rt.scrollX)).toBeLessThanOrEqual(INVASION_WINDOW_HALF_W - p.radius);
        expect(Math.abs(p.y - rt.scrollY)).toBeLessThanOrEqual(INVASION_WINDOW_HALF_H - p.radius);
      }
    }
  });

  it('L1 시작 페이즈·런타임 초기값', () => {
    const w = createWorld(3, invasion3Config());
    expect(w.invasion3).toBeDefined();
    expect(w.invasion3?.phase).toBe(PHASE_L1);
    expect(w.invasion3?.phaseEnterTick).toBe(0);
    expect(w.invasion3?.scrollX).toBe(0);
    expect(w.invasion3?.scrollY).toBe(0);
    expect(w.invasion3?.accelCp).toBe(INVASION_ACCEL_BASE_CP);
    expect(w.invasion3Bombs).toBe(0);
  });
});

describe('PvE 회귀 가드 — 스크롤 분기가 기존 경로를 안 건드린다', () => {
  it('PvE 런에는 invasion3 런타임이 없고 카메라가 플레이어 파생 그대로다', () => {
    const w = createWorld(2026, pveConfig());
    runTicks(w, 300, { ...idle, moveX: 1, moveY: -1 });
    expect(w.invasion3).toBeUndefined();
    expect(w.invasion3Bombs).toBe(0);
    const snap = snapshotWorld(w);
    const player = w.entities[0]!;
    expect(snap.cameraX).toBe(player.x);
    expect(snap.cameraY).toBe(player.y);
  });

  it('PvE 해시 스트림이 같은 seed·입력에서 재현된다(컬링 기준점 변경 무영향)', () => {
    const run = (): number[] => {
      const w = createWorld(31337, pveConfig());
      const out: number[] = [];
      for (let i = 0; i < 400; i++) {
        stepWorld(w, { ...idle, moveX: 1, aim: 0.5 });
        out.push(hashWorld(w));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
