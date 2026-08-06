/**
 * 런 길이 창발 (ADR-0011) — 처치 할당 게이트 + 급행 소환 + 보스전 몹 + 오토파일럿 완주.
 *
 * 고정 타이머(구 segmentTimer 2700틱)를 폐지하고 세그먼트 진행을 처치 할당(killGoal)에
 * 묶었음을 검증한다: (1) 아무도 안 죽으면 시간이 아무리 흘러도 안 넘어간다(타이머 부재),
 * (2) 할당을 채우면 넘어간다, (3) 급행 소환이 결정론적이고 미달 시 적이 쌓인다,
 * (4) 보스전에도 일반몹이 계속 등장한다.
 *
 * ## 삭제된 (5) — "오토파일럿이 par 근처에 완주한다" (2026-08-06, ADR-0051)
 * `expect(outcome).toBe('victory')` + 완주 시간 40~150초 밴드였다. 단언이 통째로 "봇이 이길 수
 * 있는가"에 의존하므로 게이트에서 내린다(ADR-0051 §1 · §2 갈래 ②). 증인 시드는 여섯 번 갈렸고
 * (`0x50c1a1`→`a2`→`a3`→`af`→`b0`→`a0`), 한 번은 시드 재선정으로 풀리지 않아 **파일럿 자체를
 * 표준 빌드로 갈아야** 했다 — 밸런스를 만질 때마다 재선정이 일이 되는 그 병리다. 최소 틱으로
 * 다시 쓸 수 없다(런 길이는 완주해야 나오는 값이다). 그래서 **런 길이가 par 근처인지는 이제
 * 자동으로 못 잡는다** — 출시 직전 밸런스 패스의 1회성 봇 계측(ADR-0051 §3)에서 본다.
 * 이 파일이 계속 지키는 것은 그 위의 (1)~(4), **처치 할당 게이트라는 메커니즘 자체**다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { hashWorld } from '../src/sim/replay.js';
import { SEGMENTS } from '../data/waves.js';
import { PVE_DENSITY_MULT } from '../src/sim/waves.js';

const BOSS_INDEX = SEGMENTS.length - 1;
/** 내구(글래스캐논 방지) — 게이트/스폰 관찰이 사망으로 중단되지 않게. */
const DURABLE = { ...DEFAULT_CONFIG, planet: 0, stage: 1, playerHp: 100_000_000 };

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

  it('유입 축 배율은 올림이다 — 단일 스폰 역할은 실효 2배 (waves.ts 주석과 코드 정합)', () => {
    // `spawnCard` 는 `for (let i = 0; i < s.count * PVE_DENSITY_MULT; i++)` 로 유입을 늘린다.
    // 루프 상한이 소수면 **올림**이 되는데, 이 사실이 한때 주석에 정반대로("내림, 3 → 4") 적혀
    // 있어 리뷰에서 잡혔다. 주석은 다시 어긋날 수 있으니 실효 배율 표 자체를 여기서 고정한다.
    // 배율을 바꾸는 사람은 이 표가 함께 깨지는 것을 보고 유입 축을 다시 계산하게 된다.
    const spawnedFor = (count: number): number => {
      let n = 0;
      for (let i = 0; i < count * PVE_DENSITY_MULT; i++) n++;
      return n;
    };
    // data/waves.ts 에 실재하는 count 값들.
    expect(spawnedFor(1)).toBe(2); // 단일 스폰 역할 = 실효 2배
    expect(spawnedFor(2)).toBe(3);
    expect(spawnedFor(3)).toBe(5); // 내림이면 4 였을 것
    expect(spawnedFor(4)).toBe(6);
    expect(spawnedFor(6)).toBe(9);
    // 어떤 count 에서도 유입이 줄어들지는 않는다(배율이 1 미만으로 잘못 설정되는 회귀 방지).
    for (const c of [1, 2, 3, 4, 6]) expect(spawnedFor(c)).toBeGreaterThanOrEqual(c);
  });

  it('밀도 배율이 화면 위 적 수에 실제로 반영된다 (사용자 요청 2026-07-26)', () => {
    // 배율은 상한·유입 두 축에 걸려 있는데(waves.ts `PVE_DENSITY_MULT` 주석), 한쪽만 걸리면
    // 체감이 거의 안 바뀌므로 "상수는 1.5 인데 화면은 그대로" 라는 조용한 회귀가 가능하다.
    // 그래서 상수를 되읽는 대신 **실제 누적 적 수**를 상한 파생값과 대조한다.
    expect(PVE_DENSITY_MULT).toBeGreaterThan(1); // 배율이 켜져 있다(0 배율 회귀 방지).
    const state = createWorld(3, DURABLE);
    state.weapon.damage = 0; // 아무도 안 죽으니 적 수가 유효 상한까지 단조 증가한다.
    let peak = 0;
    for (let t = 0; t < 60 * 30; t++) {
      stepWorld(state, emptyInput());
      const n = countEnemies(state);
      if (n > peak) peak = n;
    }
    // 램프 없는 세그먼트0 원본 상한(12)에 배율만 걸어도 18 이다. 배율이 유입·상한 양쪽에
    // 실제로 걸렸다면 램프까지 얹혀 그보다 확실히 많이 쌓인다.
    expect(peak).toBeGreaterThan(Math.round(SEGMENTS[0]!.maxEnemies * PVE_DENSITY_MULT));
    // 배율이 1 이었을 때의 실측 상한(램프 포함 ~28)도 넘어야 한다 — 그래야 "배율 상수만 켜고
    // 실제 스폰에는 안 걸린 상태" 를 잡는다. 28 을 상수로 박으면 무관한 스폰 변경이 배율 1
    // 에서도 29 를 만들 때 가드가 조용히 무의미해지므로, 원본 상한에서 파생시켜 여유를 둔다
    // (12 × 1.5 × 1.6 = 28.8 — 배율 1 실측 상한 28 바로 위).
    const noMultCeiling = Math.round(SEGMENTS[0]!.maxEnemies * PVE_DENSITY_MULT * 1.6);
    expect(peak).toBeGreaterThan(noMultCeiling);
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

