import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, markTainted, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { spawnLoot } from '../src/sim/entities.js';
import { hashWorld } from '../src/sim/replay.js';

/** 오토파일럿으로 world를 최대 `ticks`틱 구동하고, 매 틱 hashWorld를 수집한다. */
function driveAutopilot(seed: number, config: WorldConfig, ticks: number): number[] {
  const state = createWorld(seed, config);
  const hashes: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const input = autopilotInput(state);
    stepWorld(state, input);
    hashes.push(hashWorld(state));
    if (state.gameOver || state.victory) break;
  }
  return hashes;
}

describe('autopilot (ADR-0008, 결정론 입력 봇)', () => {
  const SEED = 0xa07071;

  it('같은 시드+config로 두 번 구동하면 매 틱 hashWorld가 동일하다', () => {
    const a = driveAutopilot(SEED, DEFAULT_CONFIG, 2000);
    const b = driveAutopilot(SEED, DEFAULT_CONFIG, 2000);
    expect(a).toEqual(b);
  });

  /**
   * 봇이 **실제로 싸워서 성장하는가** — 오토파일럿 조준·사격 배선의 생존 신호.
   *
   * ## 2026-08-06 (ADR-0051): 생존 증인 시드를 없앴다
   * 구 단언은 "고정 시드에서 최소 1,200틱 생존하고 최소 1레벨을 올린다"였고, 그 시드
   * `SURVIVE_SEED` 는 **네 번** 갈렸다(`0xa07073`→`76`→`72`→`76`). 매번 불변식은 한 글자도
   * 안 바꾸고 증인만 다시 골랐다고 적혀 있는데, 그것이 바로 병리의 증거다 — 단언이 재던 것이
   * 배선이 아니라 **그 시점 밸런스에서 무장비 봇이 얼마나 버티는가**였다(ADR-0051 §1).
   *
   * 그래서 **생존을 관측에서 뺀다.** 내구 파일럿(HP 1e9)으로 1,200틱을 돌리면 사망 여부가
   * 사라지고, 남는 것은 "봇이 적을 잡아 젬을 모아 레벨이 오르는가" 하나다. 이 축은 조준·사격·
   * 젬 수거 중 하나만 끊겨도 즉시 0 이 되고, 밸런스가 어려워진다고 깨지지 않는다 — 실제로
   * 증인 시드가 필요 없어져 결정론 단언들과 같은 {@link SEED} 를 쓴다.
   */
  it('내구 파일럿이 1200틱 안에 실제로 적을 잡아 레벨을 올린다', () => {
    const state = createWorld(SEED, { ...DEFAULT_CONFIG, playerHp: 1_000_000_000 });
    for (let t = 0; t < 1200; t++) {
      stepWorld(state, autopilotInput(state));
      if (state.gameOver || state.victory) break;
    }
    expect(state.gameOver).toBe(false);
    expect(state.kills).toBeGreaterThan(0);
    expect(state.level).toBeGreaterThan(1);
  });

  it('markTainted는 hashWorld 출력을 바꾸지 않는다', () => {
    const clean = createWorld(SEED, DEFAULT_CONFIG);
    const dirty = createWorld(SEED, DEFAULT_CONFIG);
    // 몇 틱 진행시켜 자명하지 않은 상태를 만든다.
    for (let t = 0; t < 300; t++) {
      const ci = autopilotInput(clean);
      stepWorld(clean, ci);
      const di = autopilotInput(dirty);
      stepWorld(dirty, di);
    }
    const before = hashWorld(dirty);
    markTainted(dirty);
    expect(dirty.tainted).toBe(true);
    expect(hashWorld(dirty)).toBe(before);
    // 오염 표시 여부와 무관하게 두 런의 해시는 동일하다.
    expect(hashWorld(dirty)).toBe(hashWorld(clean));
  });

  /**
   * 전리품 수거(2026-08-03 신설, `LOOT_SEEK_RADIUS`).
   *
   * ⚠️ **이것은 봇의 강함이 아니라 계측기 정확도의 문제다.** 봇에는 전리품·젬을 향한 이동이
   * 아예 없어서 `lootPerRun` 게이트가 드랍 설계가 아니라 **봇의 무관심**을 재고 있었다
   * (전체 런 실측: 수거 1.21 + 바닥 잔존 0.99 = 2.2 로 설계 기대값과 일치 — 드랍은 정상이고
   * 절반을 흘리고 있었다). 이 축이 사라지면 그 오독이 그대로 돌아온다.
   */
  it('위협이 없으면 반경 안 바닥 전리품 쪽으로 이동한다', () => {
    const state = createWorld(SEED, DEFAULT_CONFIG);
    const player = state.entities[0]!;
    // 위협·표적을 걷어내 ①회피 ②목표물 분기를 비운다 — 이 단언이 재는 것은 ③ 수거뿐이다.
    for (const e of state.entities) {
      if (e.kind !== 'player') e.dead = true;
    }
    const loot = spawnLoot(state, player.x + 400, player.y, 0xbeef, 0);

    const input = autopilotInput(state);
    // 전리품 쪽(+X)으로 간다. 대조: 전리품을 치우면 그 방향이 사라진다.
    expect(input.moveX).toBeGreaterThan(0.9);

    loot.dead = true;
    expect(autopilotInput(state).moveX).toBe(0);
  });

  it('수거 반경 밖 전리품은 쫓지 않는다 — 봇이 전투를 버리고 무대를 가로지르지 않는다', () => {
    const state = createWorld(SEED, DEFAULT_CONFIG);
    const player = state.entities[0]!;
    for (const e of state.entities) {
      if (e.kind !== 'player') e.dead = true;
    }
    spawnLoot(state, player.x + 5000, player.y, 0xbeef, 0);
    expect(autopilotInput(state).moveX).toBe(0);
  });
});
