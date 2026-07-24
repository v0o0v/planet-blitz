/**
 * 중반 격전(ADR-0032) — 데이터 계약 · 리더 처치 게이트 · 해시 폴드 회귀 가드.
 *
 * 검증 축:
 *  (a) 데이터 계약 — 격전 세그먼트가 중반(index ≥ 1)에 있고, `SEGMENTS[0]` 값과 마지막 보스
 *      슬롯이 불변이다(계획 AC2 — 침공 baseline 바이트 불변의 데이터측 근거).
 *  (b) 해시 폴드 회귀 가드 — `WaveRuntime` 필드가 정확히 7개다. 하나라도 늘면 `hashWorld` 가
 *      무조건 접는 블록이 바뀌어 전 PvE + 침공 해시가 갈린다(계획 AC9/MAJ-3 "신규 폴드 0").
 *  (c) 전진 게이트 — 진입 틱에 리더 마커가 정확히 1개 서고, 살아 있는 동안 세그먼트가 전진하지
 *      않으며, 죽으면 전진한다.
 *  (d) RNG 미소비 — 격전 소환이 waveRng/eliteRng/dropRng 스트림을 한 칸도 밀지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import { createWaveRuntime } from '../src/sim/waves.js';
import {
  MID_CLASH_LEADER_MARK,
  MID_CLASH_SURGE_OFFSETS,
  midClashLeaderAlive,
  spawnMidClash,
} from '../src/sim/modes/midClash.js';
import { SEGMENTS } from '../data/waves.js';
import type { Entity } from '../src/sim/entities.js';

/** 격전 세그먼트 인덱스(데이터 파생 — 하드코딩 금지). */
const CLASH_INDEX = SEGMENTS.findIndex((s) => s.clash === true);
/** 내구(글래스캐논 방지) — 게이트 관찰이 사망으로 중단되지 않게. 카르곤(뱀서류)이라 모드 게이트 없음. */
const DURABLE = { ...DEFAULT_CONFIG, planet: 0, stage: 1, playerHp: 100_000_000 };

const leaders = (state: ReturnType<typeof createWorld>): Entity[] =>
  state.entities.filter((e) => e.kind === 'enemy' && e.aux1 === MID_CLASH_LEADER_MARK);

/** 격전 세그먼트 진입 상태로 점프(치트 패널 세그먼트 점프와 같은 형태). */
function enterClash(state: ReturnType<typeof createWorld>): void {
  state.wave.segmentIndex = CLASH_INDEX;
  state.wave.segmentElapsed = 0;
  state.wave.cardTimer = 0;
  state.wave.segmentBaseKills = state.kills;
  state.wave.segmentKillGoal = SEGMENTS[CLASH_INDEX]?.killGoal ?? 0;
}

describe('중반 격전 데이터 계약 (ADR-0032)', () => {
  it('격전 세그먼트는 중반(index ≥ 1)에 정확히 1개 있다', () => {
    const clashes = SEGMENTS.filter((s) => s.clash === true);
    expect(clashes.length).toBe(1);
    expect(CLASH_INDEX).toBeGreaterThanOrEqual(1);
    // 마지막(보스) 슬롯이 아니다 — 중반 비트이지 보스 대체가 아니다.
    expect(CLASH_INDEX).toBeLessThan(SEGMENTS.length - 1);
    // 처치 할당 게이트를 타지 않는다(리더 처치가 게이트).
    expect(SEGMENTS[CLASH_INDEX]?.killGoal).toBe(0);
    expect(SEGMENTS[CLASH_INDEX]?.boss).toBe(false);
  });

  it('SEGMENTS[0] 과 보스 슬롯이 불변이다(침공 baseline 바이트 불변 근거 — 계획 AC2)', () => {
    // 침공은 `updateWaves` 를 실행하지 않지만, 이 두 지점이 바뀌면 웨이브 계약이 흔들린다는
    // 뜻이므로 값 자체를 못 박는다. 값 변경은 골든 재생성 + 침공 회귀 확인을 강제한다.
    expect(SEGMENTS[0]).toEqual({
      index: 0,
      killGoal: 10,
      maxEnemies: 12,
      bulletCap: 300,
      cardInterval: 220,
      boss: false,
    });
    const last = SEGMENTS[SEGMENTS.length - 1];
    expect(last?.boss).toBe(true);
    expect(last?.killGoal).toBe(0);
    // 격전은 보스 슬롯에 clash 플래그를 얹지 않는다(보스전은 보스 처치로만 끝난다).
    expect(last?.clash).toBeUndefined();
  });
});

describe('WaveRuntime 해시 폴드 회귀 가드 (계획 AC9 — 신규 폴드 0)', () => {
  it('WaveRuntime 필드는 정확히 7개다', () => {
    // `hashWorld` 는 이 7개를 **무조건** 접는다(replay.ts). 필드가 하나라도 늘면 전 PvE +
    // 침공 해시가 통째로 갈리므로, 중반 격전 상태는 반드시 엔티티 스캔으로 파생해야 한다.
    const keys = Object.keys(createWaveRuntime()).sort();
    expect(keys).toEqual(
      [
        'boss',
        'cardTimer',
        'done',
        'segmentBaseKills',
        'segmentElapsed',
        'segmentIndex',
        'segmentKillGoal',
      ].sort(),
    );
  });
});

describe('중반 격전 전진 게이트 (리더 처치 파생)', () => {
  it('진입 틱에 리더 마커가 정확히 1개 스폰된다(+ 정예 서지)', () => {
    const state = createWorld(0x0c1a, DURABLE);
    const enemies0 = state.entities.filter((e) => e.kind === 'enemy').length;
    enterClash(state);
    expect(leaders(state).length).toBe(0);
    stepWorld(state, emptyInput());
    expect(leaders(state).length).toBe(1);
    expect(midClashLeaderAlive(state)).toBe(true);
    // 리더 + 서지가 함께 들어온다(카드 추첨분도 섞이므로 하한으로 단언).
    const enemies1 = state.entities.filter((e) => e.kind === 'enemy').length;
    expect(enemies1 - enemies0).toBeGreaterThanOrEqual(1 + MID_CLASH_SURGE_OFFSETS.length);
    // 리더는 기반 정의보다 확실히 단단하다(강화 정예 — 배수 자체는 TODO(밸런스)).
    const leader = leaders(state)[0] as Entity;
    expect(leader.hp).toBe(leader.maxHp);
    expect(leader.hp).toBeGreaterThan(0);
  });

  it('리더가 살아 있는 동안 세그먼트가 전진하지 않는다(스크롤·처치 게이트 아님)', () => {
    const state = createWorld(0x0c1b, DURABLE);
    enterClash(state);
    stepWorld(state, emptyInput());
    state.weapon.damage = 0; // 아무도 안 죽는다 — 리더도 살아남는다.
    for (let t = 0; t < 60 * 60; t++) stepWorld(state, emptyInput());
    expect(midClashLeaderAlive(state)).toBe(true);
    expect(state.wave.segmentIndex).toBe(CLASH_INDEX);
    // 급행 소환 램프는 격전에서도 돌아 압박이 누적된다(정체 구간 방지).
    expect(state.entities.filter((e) => e.kind === 'enemy').length).toBeGreaterThan(
      SEGMENTS[CLASH_INDEX]?.maxEnemies ?? 0,
    );
  });

  it('리더를 처치하면 다음 틱에 전진한다', () => {
    const state = createWorld(0x0c1c, DURABLE);
    enterClash(state);
    stepWorld(state, emptyInput());
    state.weapon.damage = 0; // 다른 적은 죽지 않게 — 전진 원인을 리더로 고정.
    const leader = leaders(state)[0] as Entity;
    leader.hp = 0;
    leader.dead = true; // compact 가 이번 틱에 제거한다.
    let advanced = false;
    for (let t = 0; t < 3 && !advanced; t++) {
      stepWorld(state, emptyInput());
      advanced = state.wave.segmentIndex > CLASH_INDEX;
    }
    expect(midClashLeaderAlive(state)).toBe(false);
    expect(advanced).toBe(true);
    // 처치 할당이 아니라 리더 처치로 넘어갔음을 못 박는다(kills 는 0 근처).
    expect(state.wave.segmentIndex).toBe(CLASH_INDEX + 1);
  });
});

describe('중반 격전 소환은 RNG 를 소비하지 않는다 (스트림 분리 규율)', () => {
  it('waveRng/eliteRng/dropRng 상태가 소환 전후로 동일하다', () => {
    const state = createWorld(0x0c1d, DURABLE);
    const player = state.entities[0] as Entity;
    const before = {
      wave: state.waveRng.getState(),
      elite: state.eliteRng.getState(),
      drop: state.dropRng.getState(),
    };
    spawnMidClash(state, player);
    expect(leaders(state).length).toBe(1);
    expect(state.waveRng.getState()).toBe(before.wave);
    expect(state.eliteRng.getState()).toBe(before.elite);
    expect(state.dropRng.getState()).toBe(before.drop);
  });

  it('리더가 이미 살아 있으면 재소환하지 않는다(세그먼트 점프 재진입 방어)', () => {
    const state = createWorld(0x0c1e, DURABLE);
    const player = state.entities[0] as Entity;
    spawnMidClash(state, player);
    const n = state.entities.length;
    spawnMidClash(state, player);
    expect(state.entities.length).toBe(n);
    expect(leaders(state).length).toBe(1);
  });
});
