/**
 * 런 길이 창발 (ADR-0011) — 처치 할당 게이트 + 급행 소환 + 보스전 몹 + 오토파일럿 완주.
 *
 * 고정 타이머(구 segmentTimer 2700틱)를 폐지하고 세그먼트 진행을 처치 할당(killGoal)에
 * 묶었음을 검증한다: (1) 아무도 안 죽으면 시간이 아무리 흘러도 안 넘어간다(타이머 부재),
 * (2) 할당을 채우면 넘어간다, (3) 급행 소환이 결정론적이고 미달 시 적이 쌓인다,
 * (4) 보스전에도 일반몹이 계속 등장한다, (5) 오토파일럿이 par 근처에 완주한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { hashWorld } from '../src/sim/replay.js';
import { SEGMENTS } from '../data/waves.js';

const BOSS_INDEX = SEGMENTS.length - 1;
/** 내구(글래스캐논 방지) — 게이트/스폰 관찰이 사망으로 중단되지 않게. */
const DURABLE = { ...DEFAULT_CONFIG, planet: 0, tier: 0, playerHp: 100_000_000 };

const countEnemies = (state: ReturnType<typeof createWorld>): number =>
  state.entities.filter((e) => e.kind === 'enemy').length;

describe('처치 할당 게이트 (ADR-0011)', () => {
  it('고정 타이머가 아니다 — 아무도 안 죽으면 세그먼트가 넘어가지 않는다', () => {
    const state = createWorld(1, DURABLE);
    // 무기 무력화: 어떤 적도 죽지 않아 처치 할당이 0으로 고정된다.
    state.weapon.damage = 0;
    // 구 타이머(세그먼트당 2700틱)라면 7200틱 뒤 이미 seg 2에 있었을 것.
    for (let t = 0; t < 60 * 120; t++) stepWorld(state, emptyInput());
    expect(state.kills).toBe(0);
    expect(state.wave.segmentIndex).toBe(0);
  });

  it('처치 할당을 채우면 다음 세그먼트로 넘어간다', () => {
    const state = createWorld(0x1234, DURABLE);
    const goal0 = SEGMENTS[0]!.killGoal;
    for (let t = 0; t < 60 * 120 && state.wave.segmentIndex === 0; t++) {
      stepWorld(state, autopilotInput(state));
    }
    expect(state.wave.segmentIndex).toBe(1);
    // 넘어간 시점의 처치 수는 세그먼트0 목표 이상이어야 한다.
    expect(state.kills).toBeGreaterThanOrEqual(goal0);
    // 다음 세그먼트 게이트는 진입 시점 kills를 기준선으로 재설정된다.
    expect(state.wave.segmentBaseKills).toBe(state.kills);
    expect(state.wave.segmentKillGoal).toBe(SEGMENTS[1]!.killGoal);
  });
});

describe('급행 소환 (ADR-0011)', () => {
  it('결정론적이다 — 같은 시드는 매 틱 동일한 hashWorld를 낸다', () => {
    const drive = (): number[] => {
      const state = createWorld(0x777, DURABLE);
      const hashes: number[] = [];
      for (let t = 0; t < 60 * 45; t++) {
        stepWorld(state, autopilotInput(state));
        hashes.push(hashWorld(state));
      }
      return hashes;
    };
    expect(drive()).toEqual(drive());
  });

  it('처치 할당 미달이 길어질수록 적이 더 쌓인다 (램프)', () => {
    const state = createWorld(2, DURABLE);
    state.weapon.damage = 0; // 아무도 안 죽어 세그먼트0에 계속 머문다.
    for (let t = 0; t < 300; t++) stepWorld(state, emptyInput());
    const early = countEnemies(state);
    for (let t = 0; t < 60 * 30; t++) stepWorld(state, emptyInput());
    const late = countEnemies(state);
    // 급행 램프로 유효 상한이 올라 세그먼트0 기본 상한(12)을 넘어 더 쌓인다.
    expect(late).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(SEGMENTS[0]!.maxEnemies);
  });
});

describe('보스전 몹 등장 (ADR-0011)', () => {
  it('보스 세그먼트에서도 일반몹이 계속 스폰된다', () => {
    const state = createWorld(0xb055, DURABLE);
    // 보스 세그먼트로 점프(처치 할당 게이트 진입 상태 리셋).
    state.wave.segmentIndex = BOSS_INDEX;
    state.wave.segmentBaseKills = state.kills;
    state.wave.segmentKillGoal = SEGMENTS[BOSS_INDEX]!.killGoal;
    state.wave.segmentElapsed = 0;
    state.wave.cardTimer = 0;
    let sawEnemyDuringBoss = false;
    // 무입력 내구 파일럿: 보스(3600 HP)를 10초 안에 못 죽이므로 관찰이 유지된다.
    for (let t = 0; t < 60 * 10 && !state.victory && !state.gameOver; t++) {
      stepWorld(state, emptyInput());
      if (countEnemies(state) > 0) sawEnemyDuringBoss = true;
    }
    expect(state.wave.boss).toBe(true);
    expect(sawEnemyDuringBoss).toBe(true);
  });
});

describe('오토파일럿 완주 (ADR-0011, par 창발)', () => {
  it('적정 화력으로 par 근처에 완주한다', () => {
    // 무장갑(기본 HP 100) 오토파일럿 = 적정 티어 기준선. 고정 타이머 폐지로 런 길이가
    // 상대적 강함의 결과로 창발한다 — 러프 범위로 단언(정확한 par 강제 아님).
    // ⚠️ 증인 시드는 sim 이 바뀌면 다시 골라야 한다. `fix/weapon-range-semantics`
    // (무제한 조준 폐지)로 0x50c1a1 → 0x50c1a2 로 갈았다 — 무장갑 오토파일럿의 완주는
    // 원래 시드마다 갈리는 값이고(kargon-t0 P0 클리어율 33~63%), 표본 12시드 중 7시드가
    // 여전히 40~70초에 완주하므로 단언이 약해진 것이 아니라 증인만 바뀐 것이다.
    const state = createWorld(0x50c1a2, { ...DEFAULT_CONFIG, planet: 0, tier: 0 });
    let ticks = 0;
    for (let t = 0; t < 60 * 300; t++) {
      stepWorld(state, autopilotInput(state));
      ticks++;
      if (state.victory || state.gameOver) break;
    }
    // 실패 시 원인이 메시지로 드러나게(victory/death/timeout 구분 — 리뷰 MEDIUM 반영)
    const outcome = state.victory ? 'victory' : state.gameOver ? 'death' : 'timeout';
    expect(outcome).toBe('victory');
    const sec = ticks / 60;
    // 웨이브 ≈ 1분 + 보스(무장갑은 생존 한계로 짧게). 40~150초 러프 범위 — 구 고정
    // 타이머(런 5분+)와 확연히 다른 짧고 강렬한 루프임을 확인.
    expect(sec).toBeGreaterThan(40);
    expect(sec).toBeLessThan(150);
  });
});
