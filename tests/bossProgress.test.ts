/**
 * 보스 등장 예고 진행도(사용자 요청 2026-07-26) — 파생 계약 검증.
 *
 * 검증 축:
 *  (a) 처치 게이트 — 구간 안 진행도가 처치 수에 비례하고, 전체 진행도는 구간 축을 따라 오른다.
 *  (b) 보스 세그먼트 — 진입하면 100%·`bossActive`(HUD 가 게이지를 접고 체력바에 넘긴다).
 *  (c) 침공 런 — 세그먼트 축이 없으므로 `undefined`(0% 로 굳은 가짜 게이지 금지).
 *  (d) 튜토리얼 단축판(`maxSegments`) — 분모가 같이 줄어 100% 에서 보스를 만난다.
 *  (e) 읽기 전용 — 호출해도 상태 해시가 변하지 않는다(sim 무영향의 물증).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { bossProgress } from '../src/sim/bossProgress.js';
import { SEGMENTS } from '../data/waves.js';

/** 보스 전 일반 구간 수(데이터 파생 — 하드코딩 금지). */
const NORMAL_SEGMENTS = SEGMENTS.length - 1;

const world = (extra: Partial<typeof DEFAULT_CONFIG> = {}): ReturnType<typeof createWorld> =>
  createWorld(1234, { ...DEFAULT_CONFIG, planet: 0, stage: 1, ...extra });

describe('보스 예고 진행도 — 처치 게이트', () => {
  it('런 시작 시 0% 이고 첫 구간을 가리킨다', () => {
    const p = bossProgress(world());
    expect(p).toBeDefined();
    expect(p?.frac).toBe(0);
    expect(p?.segment).toBe(1);
    expect(p?.totalSegments).toBe(NORMAL_SEGMENTS);
    expect(p?.gate).toBe('kills');
    expect(p?.bossActive).toBe(false);
  });

  it('처치가 쌓이면 구간 내 진행도가 비례해 오른다', () => {
    const state = world();
    const goal = state.wave.segmentKillGoal;
    expect(goal).toBeGreaterThan(0);
    state.kills = state.wave.segmentBaseKills + Math.floor(goal / 2);
    const p = bossProgress(state);
    expect(p?.current).toBe(Math.floor(goal / 2));
    expect(p?.goal).toBe(goal);
    expect(p?.segmentFrac).toBeCloseTo(Math.floor(goal / 2) / goal, 6);
    expect(p?.frac).toBeCloseTo(Math.floor(goal / 2) / goal / NORMAL_SEGMENTS, 6);
  });

  it('목표를 초과 달성해도 구간 내 진행도가 1을 넘지 않는다', () => {
    const state = world();
    state.kills = state.wave.segmentBaseKills + state.wave.segmentKillGoal * 10;
    const p = bossProgress(state);
    expect(p?.segmentFrac).toBe(1);
    expect(p?.current).toBe(state.wave.segmentKillGoal);
  });

  it('구간을 넘길수록 전체 진행도가 단조 증가한다', () => {
    let prev = -1;
    for (let i = 0; i < NORMAL_SEGMENTS; i++) {
      const state = world();
      state.wave.segmentIndex = i;
      state.wave.segmentBaseKills = state.kills;
      state.wave.segmentKillGoal = SEGMENTS[i]?.killGoal ?? 0;
      const frac = bossProgress(state)?.frac ?? -1;
      expect(frac).toBeGreaterThan(prev);
      expect(frac).toBeCloseTo(i / NORMAL_SEGMENTS, 6);
      prev = frac;
    }
  });
});

describe('보스 예고 진행도 — 경계', () => {
  it('보스 세그먼트에 진입하면 100% · bossActive', () => {
    const state = world();
    state.wave.segmentIndex = SEGMENTS.length - 1;
    state.wave.boss = true;
    const p = bossProgress(state);
    expect(p?.frac).toBe(1);
    expect(p?.bossActive).toBe(true);
    expect(p?.segment).toBe(p?.totalSegments);
  });

  it('튜토리얼 단축판은 분모가 상한만큼 줄어든다', () => {
    const state = world({ maxSegments: 2 });
    state.wave.segmentIndex = 1;
    state.wave.segmentBaseKills = state.kills;
    const p = bossProgress(state);
    expect(p?.totalSegments).toBe(2);
    expect(p?.frac).toBeCloseTo(0.5, 6);
  });

  it('침공 런은 undefined — 세그먼트 축이 없어 게이지를 감춘다', () => {
    const state = world();
    // 침공 판정은 `config.invasion3` 존재 여부 하나다(waves 디렉터가 도는지와 같은 게이트).
    // 실제 침공 설정을 세우지 않고 그 게이트만 재현한다.
    (state.config as { invasion3?: unknown }).invasion3 = {};
    expect(bossProgress(state)).toBeUndefined();
  });

  it('읽기 전용이다 — 호출해도 상태 해시가 변하지 않는다', () => {
    const state = world();
    const before = hashWorld(state);
    bossProgress(state);
    bossProgress(state);
    expect(hashWorld(state)).toBe(before);
  });
});
