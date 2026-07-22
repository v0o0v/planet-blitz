/**
 * PvE 행성 모드 강제 스크롤 — 런타임 인프라 (Lane3 · ADR-0021).
 *
 * 커버리지:
 *   1. 순수 함수: scrollModeAxisDir·isScrollMode·createScrollRuntime·advanceScrollRuntime.
 *   2. sim 권위 카메라(정규경로 buildRunConfig→createWorld→stepWorld): 레이싱=+X·블록격파=−Y,
 *      플레이어 창 클램프, 스크롤 오프셋 정수 결정론.
 *   3. 회귀 가드: 뱀서류·침공 바이트 불변(scrollRuntime 미개입).
 *   4. 해시 필드 순서 봉인: scrollX·scrollY·accelCp 각각이 접히고, 미존재면 무폴드,
 *      폴드가 침공 블록 **바깥**이다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldState } from '../src/sim/world.js';
import { snapshotWorld } from '../src/sim/snapshot.js';
import { hashWorld } from '../src/sim/replay.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import {
  scrollModeAxisDir,
  isScrollMode,
  createScrollRuntime,
  advanceScrollRuntime,
  type ScrollRuntime,
} from '../src/sim/scrollMode.js';
import {
  INVASION_ACCEL_BASE_CP,
  INVASION_TOTAL_TICKS,
  SCROLL_AXIS_VERTICAL,
  SCROLL_AXIS_HORIZONTAL,
} from '../src/sim/invasion/constants.js';
import {
  INVASION_SCROLL_SPEED,
  INVASION_WINDOW_HALF_H,
  INVASION_WINDOW_HALF_W,
  scrollStep,
} from '../src/sim/invasion/scroll.js';
import { emptyInvasionLayers } from '../src/sim/invasion/normalize.js';

const idle: InputFrame = emptyInput();

/** 레이싱(아르케=planet 3) 정규경로 config. */
function racingConfig() {
  return buildRunConfig(defaultProfile(), { planet: 3, stage: 1 });
}

/** 블록격파는 아직 행성 미배정이라 planetMode 를 직접 스탬프한다(planet 0 위에 덮어씀). */
function blockBreakConfig() {
  return { ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }), planetMode: PLANET_MODE.blockBreak };
}

/** 뱀서류(카르곤=planet 0). */
function vampireConfig() {
  return buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
}

/** 빈 배치 3레이어 침공 config(정규경로). */
function invasionConfig() {
  return buildRunConfig(defaultProfile(), {
    planet: 0,
    stage: 1,
    invasion3: { layers: emptyInvasionLayers(), timeLimitTicks: INVASION_TOTAL_TICKS },
  });
}

function runTicks(state: WorldState, ticks: number, input: InputFrame = idle): void {
  for (let i = 0; i < ticks; i++) stepWorld(state, input);
}

describe('강제 스크롤 — 순수 함수', () => {
  it('scrollModeAxisDir 는 모드→{축,방향} 을 정확히 낸다', () => {
    expect(scrollModeAxisDir(PLANET_MODE.blockBreak)).toEqual({ axis: SCROLL_AXIS_VERTICAL, dir: -1 });
    expect(scrollModeAxisDir(PLANET_MODE.racing)).toEqual({ axis: SCROLL_AXIS_HORIZONTAL, dir: 1 });
    // 강제 스크롤이 아닌 모드는 undefined.
    expect(scrollModeAxisDir(PLANET_MODE.vampire)).toBeUndefined();
    expect(scrollModeAxisDir(PLANET_MODE.chase)).toBeUndefined();
    expect(scrollModeAxisDir(PLANET_MODE.shrink)).toBeUndefined();
    expect(scrollModeAxisDir(PLANET_MODE.contamination)).toBeUndefined();
    expect(scrollModeAxisDir(undefined)).toBeUndefined();
  });

  it('isScrollMode 는 블록격파·레이싱만 참이다', () => {
    expect(isScrollMode(PLANET_MODE.blockBreak)).toBe(true);
    expect(isScrollMode(PLANET_MODE.racing)).toBe(true);
    expect(isScrollMode(PLANET_MODE.vampire)).toBe(false);
    expect(isScrollMode(PLANET_MODE.chase)).toBe(false);
    expect(isScrollMode(PLANET_MODE.shrink)).toBe(false);
    expect(isScrollMode(PLANET_MODE.contamination)).toBe(false);
    expect(isScrollMode(undefined)).toBe(false);
  });

  it('createScrollRuntime 은 (0,0,BASE) 로 시작한다', () => {
    const rt = createScrollRuntime();
    expect(rt.scrollX).toBe(0);
    expect(rt.scrollY).toBe(0);
    expect(rt.accelCp).toBe(INVASION_ACCEL_BASE_CP);
  });

  it('advanceScrollRuntime 은 축·방향대로 정수 전진하고 cleared=false 면 기준 속도로 단조', () => {
    // 종스크롤 −Y(블록격파): scrollY 가 매 틱 scrollStep 만큼 감소, scrollX 불변.
    const v = createScrollRuntime();
    for (let i = 1; i <= 5; i++) {
      advanceScrollRuntime(v, { axis: SCROLL_AXIS_VERTICAL, dir: -1 }, false);
      expect(v.scrollX).toBe(0);
      expect(v.scrollY).toBe(-INVASION_SCROLL_SPEED * i);
      expect(Number.isInteger(v.scrollY)).toBe(true);
      // cleared=false 라 accelCp 는 BASE 에서 감쇠 클램프로 그대로 유지된다(기준 속도).
      expect(v.accelCp).toBe(INVASION_ACCEL_BASE_CP);
    }
    // 횡스크롤 +X(레이싱): scrollX 증가, scrollY 불변.
    const h = createScrollRuntime();
    advanceScrollRuntime(h, { axis: SCROLL_AXIS_HORIZONTAL, dir: 1 }, false);
    expect(h.scrollX).toBe(INVASION_SCROLL_SPEED);
    expect(h.scrollY).toBe(0);
    // accelCp 가 BASE 위면 cleared=false 는 감쇠한다(단조 감소).
    const decayed = createScrollRuntime();
    decayed.accelCp = 150;
    advanceScrollRuntime(decayed, { axis: SCROLL_AXIS_HORIZONTAL, dir: 1 }, false);
    expect(decayed.accelCp).toBeLessThan(150);
    // 그 틱의 이동량은 감쇠 전 accelCp(150) 기준이다(가속은 다음 틱부터 반영).
    expect(decayed.scrollX).toBe(scrollStep(150));
  });
});

describe('강제 스크롤 — sim 권위 카메라(정규경로)', () => {
  it('레이싱 런은 scrollRuntime 을 세우고 invasion3 은 세우지 않는다', () => {
    const w = createWorld(7, racingConfig());
    expect(w.scrollRuntime).toBeDefined();
    expect(w.invasion3).toBeUndefined();
    expect(w.config.planetMode).toBe(PLANET_MODE.racing);
  });

  it('레이싱 카메라가 스크롤 창 중심(+X)을 따른다 — 플레이어 파생이 아니다', () => {
    const w = createWorld(7, racingConfig());
    runTicks(w, 120, { ...idle, moveY: -1 });
    const rt = w.scrollRuntime!;
    // 카메라 x = 창 중심 = scrollX(플레이어와 무관). racing 은 +X 라 증가했다.
    const snap = snapshotWorld(w);
    expect(snap.cameraX).toBe(rt.scrollX);
    expect(snap.cameraY).toBe(rt.scrollY);
    expect(rt.scrollX).toBeGreaterThan(0);
    expect(rt.scrollY).toBe(0);
  });

  it('블록격파 런은 창이 −Y(위로) 밀린다', () => {
    const w = createWorld(11, blockBreakConfig());
    expect(w.scrollRuntime).toBeDefined();
    runTicks(w, 120);
    const rt = w.scrollRuntime!;
    expect(rt.scrollY).toBeLessThan(0);
    expect(rt.scrollX).toBe(0);
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
      const w = createWorld(99, racingConfig());
      const input: InputFrame = { ...idle, moveX: mx, moveY: my, dash: true };
      for (let i = 0; i < 300; i++) {
        stepWorld(w, input);
        const rt = w.scrollRuntime!;
        const p = w.entities[0]!;
        expect(Math.abs(p.x - rt.scrollX)).toBeLessThanOrEqual(INVASION_WINDOW_HALF_W - p.radius);
        expect(Math.abs(p.y - rt.scrollY)).toBeLessThanOrEqual(INVASION_WINDOW_HALF_H - p.radius);
      }
    }
  });

  it('스크롤 오프셋 수열이 같은 seed·입력에서 바이트 동일하다(정수 결정론)', () => {
    const a = createWorld(4242, racingConfig());
    const b = createWorld(4242, racingConfig());
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 600; i++) {
      stepWorld(a, idle);
      stepWorld(b, idle);
      seqA.push(a.scrollRuntime?.scrollX ?? 0);
      seqB.push(b.scrollRuntime?.scrollX ?? 0);
    }
    expect(seqA).toEqual(seqB);
    // 첫 틱은 기준 속도로 +X 전진(가속 미반영).
    expect(seqA[0]).toBe(INVASION_SCROLL_SPEED);
    // 전 항목 정수 · 비감소(레이싱 +X). 절차 웨이브가 idle 플레이어를 결국 잡으면 gameOver 로
    // 월드가 얼어붙어 scrollX 가 정체하므로 단조 '증가'가 아니라 '비감소'가 정확한 계약이다.
    for (let i = 1; i < seqA.length; i++) {
      expect(Number.isInteger(seqA[i])).toBe(true);
      expect(seqA[i]!).toBeGreaterThanOrEqual(seqA[i - 1]!);
    }
    // 스크롤이 실제로 진행했다(정체만 한 공허 런이 아니다).
    expect(seqA[seqA.length - 1]!).toBeGreaterThan(0);
  });
});

describe('강제 스크롤 — 회귀 가드(뱀서류·침공 바이트 불변)', () => {
  it('뱀서류 런에는 scrollRuntime 이 없고 카메라가 플레이어 파생 그대로다', () => {
    const w = createWorld(2026, vampireConfig());
    runTicks(w, 300, { ...idle, moveX: 1, moveY: -1 });
    expect(w.scrollRuntime).toBeUndefined();
    expect(w.invasion3).toBeUndefined();
    const snap = snapshotWorld(w);
    const player = w.entities[0]!;
    expect(snap.cameraX).toBe(player.x);
    expect(snap.cameraY).toBe(player.y);
  });

  it('뱀서류 해시 스트림이 같은 seed·입력에서 재현된다(스크롤 분기 무영향)', () => {
    const run = (): number[] => {
      const w = createWorld(31337, vampireConfig());
      const out: number[] = [];
      for (let i = 0; i < 400; i++) {
        stepWorld(w, { ...idle, moveX: 1, aim: 0.5 });
        out.push(hashWorld(w));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('침공 런에는 scrollRuntime 이 개입하지 않고 해시 스트림이 재현된다', () => {
    const run = (): number[] => {
      const w = createWorld(555, invasionConfig());
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, idle);
        // 침공은 scrollRuntime 을 절대 세우지 않는다(상호 배타).
        expect(w.scrollRuntime).toBeUndefined();
        expect(w.invasion3).toBeDefined();
        out.push(hashWorld(w));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('강제 스크롤 — 해시 필드 순서 봉인', () => {
  it('scrollRuntime 의 세 필드가 각각 해시에 접힌다', () => {
    const runtimeFields: (keyof ScrollRuntime)[] = ['scrollX', 'scrollY', 'accelCp'];
    const w = createWorld(21, racingConfig());
    runTicks(w, 30);
    expect(w.scrollRuntime).toBeDefined();
    for (const key of runtimeFields) {
      const h0 = hashWorld(w);
      const rt = w.scrollRuntime as unknown as Record<string, number>;
      const saved = rt[key as string]!;
      rt[key as string] = saved + 1;
      expect(hashWorld(w)).not.toBe(h0);
      rt[key as string] = saved; // 복원
      expect(hashWorld(w)).toBe(h0);
    }
  });

  it('scrollRuntime 미존재면 무폴드다(존재 시에만 조건부 폴드)', () => {
    // 뱀서류는 planetMode 0·scrollRuntime 미존재라 꼬리 폴드가 실행되지 않는다. 인위적으로
    // 런타임을 얹으면 해시가 갈린다 = 폴드가 실제로 조건부다.
    const w = createWorld(1, vampireConfig());
    const hAbsent = hashWorld(w);
    (w as unknown as { scrollRuntime?: ScrollRuntime }).scrollRuntime = createScrollRuntime();
    expect(hashWorld(w)).not.toBe(hAbsent);
  });

  it('폴드가 침공 블록 바깥이다 — invasion3 유무와 무관하게 scrollRuntime 차이가 드러난다', () => {
    const w = createWorld(1, invasionConfig());
    const h0 = hashWorld(w);
    (w as unknown as { scrollRuntime?: ScrollRuntime }).scrollRuntime = createScrollRuntime();
    expect(hashWorld(w)).not.toBe(h0);
  });
});
