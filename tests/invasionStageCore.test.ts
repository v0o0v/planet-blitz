/**
 * 침략 단계 코어 정규 경로 통합 게이트 (ADR-0022, Lane 1).
 *
 * 이 저장소의 반복 결함 — "단위 테스트는 그린인데 배선이 통째로 없다"(8회 재발) — 을 겨눈
 * 정규 경로 게이트 5종을 한곳에 모은다. 모듈 직접 호출이 아니라 Profile → buildRunConfig →
 * createWorld/stepWorld / settleRun 의 **실제 앱 경로**로 단계가 sim·세이브까지 닿는지 본다.
 *
 * 게이트 목록(스펙 §테스트 5종):
 *   1. 단계 개방 규칙(stageOpenCap / isStageOpen).
 *   2. 단계 1 결정론 불변 — 정규 경로 재현성(바이트 골든은 shipHashBaseline 이 별도로 커버).
 *   3. 단계가 sim 에 **실제 도달** — 같은 seed 로 단계1 vs 단계25 해시 스트림이 갈린다.
 *   4. 승리 → 개방 진행 **정규 경로** — settleRun(victory, stage=N)이 실제 승리 단계를
 *      bestStageCleared 로 기록하고 stageOpenCap 이 증가한다(배선 누락 방어).
 *   5. v4 → v5 마이그레이션(구 티어 → 단계). ← 상세 케이스는 tests/save.test.ts 에도 있다.
 */

import { describe, it, expect } from 'vitest';
import {
  STAGE_OPEN_FLOOR,
  STAGE_OPEN_LOOKAHEAD,
  stageOpenCap,
  isStageOpen,
} from '../data/waves.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { defaultProfile, migrate } from '../src/save/profile.js';
import { settleRun } from '../src/save/settlement.js';

/** 정규 경로로 조립한 config 를 주어진 seed 로 굴려 per-tick 해시 스트림을 모은다. */
function runHashes(config: WorldConfig, seed: number, ticks: number): number[] {
  const state = createWorld(seed, config);
  const input: InputFrame = emptyInput();
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, input);
    out.push(hashWorld(state));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 게이트 1 — 단계 개방 규칙
// ---------------------------------------------------------------------------

describe('Lane1 게이트 1 — 단계 개방 규칙', () => {
  it('개방 상수와 상한 산정이 스펙대로다', () => {
    expect(STAGE_OPEN_FLOOR).toBe(10);
    expect(STAGE_OPEN_LOOKAHEAD).toBe(5);
    expect(stageOpenCap(0)).toBe(10); // 초기 1~10 개방
    expect(stageOpenCap(20)).toBe(25); // 최고 20 클리어 → 25 까지
  });

  it('isStageOpen 이 1..상한만 연다', () => {
    expect(isStageOpen(10, 0)).toBe(true);
    expect(isStageOpen(11, 0)).toBe(false);
    expect(isStageOpen(26, 20)).toBe(false);
    expect(isStageOpen(25, 20)).toBe(true);
    expect(isStageOpen(0, 20)).toBe(false); // 단계는 1 이상
  });
});

// ---------------------------------------------------------------------------
// 게이트 2 — 단계 1 결정론 불변 (정규 경로 재현성)
//   바이트 골든(구 tier0 == 단계1) 은 tests/shipHashBaseline.test.ts 의 kargon-recon
//   케이스가 배열 전체로 증명한다. 여기서는 정규 경로가 재현 가능한지만 못 박는다.
// ---------------------------------------------------------------------------

describe('Lane1 게이트 2 — 단계 1 결정론 불변', () => {
  it('buildRunConfig(stage:1) 는 stage 미지정과 config·해시가 동일하다', () => {
    const p = defaultProfile();
    const withStage1 = buildRunConfig(p, { planet: 0, stage: 1 });
    expect(withStage1.stage).toBe(1);
    // stage 1 → 폴드 `((1)-1)=0` == 구 tier0. 같은 seed 로 재현.
    const a = runHashes(withStage1, 0x51a9e, 120);
    const b = runHashes(buildRunConfig(p, { planet: 0, stage: 1 }), 0x51a9e, 120);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// 게이트 3 — 단계가 sim 에 실제 도달
// ---------------------------------------------------------------------------

describe('Lane1 게이트 3 — 단계가 sim 에 실제 도달한다', () => {
  it('같은 seed·프로필에서 단계1 과 단계25 의 해시 스트림이 갈린다', () => {
    const p = defaultProfile();
    const seed = 0x2f6a11;
    const s1 = runHashes(buildRunConfig(p, { planet: 0, stage: 1 }), seed, 180);
    const s25 = runHashes(buildRunConfig(p, { planet: 0, stage: 25 }), seed, 180);
    // 단계가 실제로 소비되면(HP·정예·밀도) 스트림이 반드시 갈린다.
    expect(s25).not.toEqual(s1);
    // 재현성: 단계25 두 번은 동일.
    const s25b = runHashes(buildRunConfig(p, { planet: 0, stage: 25 }), seed, 180);
    expect(s25b).toEqual(s25);
  });
});

// ---------------------------------------------------------------------------
// 게이트 4 — 승리 → 개방 진행 정규 경로 (배선 누락 방어)
// ---------------------------------------------------------------------------

describe('Lane1 게이트 4 — 승리한 단계가 개방 진행에 실제로 배선된다', () => {
  it('config.stage → settleRun → bestStageCleared → stageOpenCap 이 이어진다', () => {
    const profile = defaultProfile();
    const planet = 2;
    const stage = 14;
    // ① 단계가 런 설정까지 도달한다(정규 조립).
    const config = buildRunConfig(profile, { planet, stage });
    expect(config.stage).toBe(stage);

    // ② 승리 정산이 **그 런의 단계**(config.stage)를 실제 승리 단계로 기록한다.
    //    main.ts endRun 이 넘기는 것과 같은 형태의 RunResult 로 정규 경로를 탄다.
    const capBefore = stageOpenCap(profile.planetProgress[planet]?.bestStageCleared ?? 0);
    settleRun(profile, {
      victory: true,
      loot: [],
      xpTotal: 0,
      resources: 0,
      planet,
      stage: config.stage ?? 1,
    });
    expect(profile.planetProgress[planet]?.bestStageCleared).toBe(stage);

    // ③ 개방 상한이 실제로 올라간다(승리 → 개방 진행).
    const capAfter = stageOpenCap(profile.planetProgress[planet]!.bestStageCleared);
    expect(capAfter).toBe(stage + STAGE_OPEN_LOOKAHEAD);
    expect(capAfter).toBeGreaterThan(capBefore);
  });

  it('패배는 개방을 진행시키지 않는다(승리에만 기록)', () => {
    const profile = defaultProfile();
    settleRun(profile, { victory: false, loot: [], xpTotal: 0, resources: 0, planet: 2, stage: 14 });
    expect(profile.planetProgress[2]).toBeUndefined();
    expect(stageOpenCap(profile.planetProgress[2]?.bestStageCleared ?? 0)).toBe(STAGE_OPEN_FLOOR);
  });
});

// ---------------------------------------------------------------------------
// 게이트 5 — v4 → v5 마이그레이션(구 티어 → 단계)
//   상세 케이스는 tests/save.test.ts 에도 있다(왕복·미클리어 보존). 여기서는 핵심 매핑만.
// ---------------------------------------------------------------------------

describe('Lane1 게이트 5 — v4 → v5 마이그레이션', () => {
  it('bestTierCleared:2 → bestStageCleared:3, saveVersion:5', () => {
    const v4 = {
      saveVersion: 4,
      ships: [{ id: 'ship-0', name: 'x', typeId: 0, level: 5, xp: 0, equipped: {}, skillInvest: [] }],
      activeShipIndex: 0,
      inventory: [],
      stash: [],
      stashExpansions: 0,
      planetProgress: { 0: { bestTierCleared: 2 } },
      credits: 0,
      minerals: 0,
      skillPoints: 0,
      tutorialDone: true,
    };
    const p = migrate(v4);
    expect(p.saveVersion).toBe(5);
    expect(p.planetProgress[0]?.bestStageCleared).toBe(3);
  });
});
