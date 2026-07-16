/**
 * 베르단 행성 콘텐츠 검증 (M2 Lane 3 Phase E — AC8).
 *
 * 잡몹 4종·엘리트 2종이 planet=1 런에서 실제 스폰되는지, 여왕 보스가 3페이즈 골격과
 * 신규 공격 컴포넌트(무리개체 소환·과열 창)로 가동하는지, 그리고 베르단 런이
 * 결정론적으로 재현되는지 확인한다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  emptyInput,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import type { WorldConfig, WorldState, InputFrame } from '../src/sim/world.js';
import { spawnBoss } from '../src/sim/entities.js';
import { updateBoss } from '../src/sim/boss.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { runReplay } from '../src/sim/replay.js';
import { planetContent, BERDAN } from '../data/planets/index.js';

/** typeIndex 집합을 모든 스폰 적에서 수집(런 중 최대치). */
function seenEnemyTypes(state: WorldState, ticks: number): Set<number> {
  const seen = new Set<number>();
  const input = emptyInput();
  for (let t = 0; t < ticks; t++) {
    stepWorld(state, input);
    for (const e of state.entities) if (e.kind === 'enemy') seen.add(e.enemyType);
  }
  return seen;
}

describe('베르단 로스터 (AC8, E1)', () => {
  it('planet=1 런은 베르단 잡몹 타입(4~7)을 스폰한다', () => {
    const state = createWorld(0xbeed, { ...DEFAULT_CONFIG, planet: 1 });
    const seen = seenEnemyTypes(state, 800);
    // 카르곤 타입(0~3)은 나오지 않고, 베르단 잡몹 타입(4~7) 중 다수가 나온다.
    for (const kargon of [0, 1, 2, 3]) expect(seen.has(kargon)).toBe(false);
    const berdanJobs = [4, 5, 6, 7].filter((t) => seen.has(t));
    expect(berdanJobs.length).toBeGreaterThan(0);
  });

  it('교전 티어 베르단 런에서 엘리트 타입(8·9)이 등장한다', () => {
    const state = createWorld(0x51ee, { ...DEFAULT_CONFIG, planet: 1, tier: 1 });
    const seen = seenEnemyTypes(state, 6000);
    // 엘리트 카드(파수병정 8 / 분열유충모체 9) 중 최소 하나는 스폰된다.
    expect(seen.has(8) || seen.has(9)).toBe(true);
  });

  it('레지스트리는 카르곤(0)·베르단(1)을 노출하고 범위 밖은 카르곤 폴백', () => {
    expect(planetContent(0).id).toBe('kargon');
    expect(planetContent(1).id).toBe('berdan');
    expect(planetContent(99).id).toBe('kargon');
    expect(BERDAN.minerals.map((m) => m.id)).toEqual(['berdan-chitin', 'berdan-royal-jelly']);
  });
});

describe('여왕 보스 (AC8, E2)', () => {
  /** planet=1 보스를 직접 스폰해 updateBoss를 격리 구동. */
  function bossWorld(): { state: WorldState; boss: ReturnType<typeof spawnBoss> } {
    const state = createWorld(0x9ee, { ...DEFAULT_CONFIG, planet: 1 });
    const player = state.entities[0]!;
    const boss = spawnBoss(state, player.x, player.y - 400, BERDAN.boss.hp, BERDAN.boss.radius);
    boss.enemyType = 1;
    return { state, boss };
  }

  it('시그니처 캐스트가 무리개체(베르단 charger, 타입4)를 소환한다', () => {
    const { state, boss } = bossWorld();
    const player = state.entities[0]!;
    const before = state.entities.filter((e) => e.kind === 'enemy').length;
    // cooldown 0 · phase 0 → 첫 캐스트 = P1 index0 = summon(charger 4마리).
    updateBoss(state, boss, player);
    const summoned = state.entities.filter((e) => e.kind === 'enemy' && e.enemyType === 4);
    expect(summoned.length).toBe(4);
    expect(state.entities.filter((e) => e.kind === 'enemy').length).toBe(before + 4);
  });

  it('과열 창(aimedBurst)이 플레이어를 향한 적탄을 생성한다', () => {
    const { state, boss } = bossWorld();
    const player = state.entities[0]!;
    // pierce=2로 맞춰 다음 캐스트가 P1 index2 = aimedBurst가 되게 한다.
    boss.pierce = 2;
    boss.cooldown = 0;
    updateBoss(state, boss, player);
    const bullets = state.entities.filter((e) => e.kind === 'enemyBullet');
    expect(bullets.length).toBeGreaterThan(0);
    // 조준 부채꼴: 최소 한 발은 플레이어 방향(아래) 성분을 가진다.
    const aimed = bullets.some((b) => b.vy > 0);
    expect(aimed).toBe(true);
  });

  it('여왕은 3페이즈 정의를 갖는다', () => {
    expect(BERDAN.boss.phases.length).toBe(3);
    expect(BERDAN.boss.id).toBe('berdan-swarm-queen');
  });
});

/**
 * 내구 파일럿으로 런을 끝까지 진행(보스 세그먼트 도달 보장).
 *
 * 처치 할당 게이트(ADR-0011)에서는 세그먼트가 처치 수로 넘어가므로, 무입력으로 서 있는
 * 파일럿은 사거리 밖 원거리 몹을 못 잡아 진행이 정체된다. 또 보스전에도 일반몹이 계속
 * 등장하는데(특히 여왕은 무리개체를 보스 주변에 소환) 보스에 붙어 있으면 오토어택이
 * 최근접인 소환 몹만 때려 보스를 못 죽인다. 따라서 카이팅으로 몹과 보스를 함께 정리하는
 * 정규 오토파일럿(순수 상태 함수 → 리플레이 재현)으로 구동한다.
 */
function playToEnd(seed: number, config: WorldConfig): { state: WorldState; inputs: InputFrame[] } {
  const state = createWorld(seed, config);
  const inputs: InputFrame[] = [];
  const maxTicks = 60 * 600;
  for (let t = 0; t < maxTicks; t++) {
    const frame = autopilotInput(state);
    inputs.push(frame);
    stepWorld(state, frame);
    if (state.gameOver || state.victory) break;
  }
  return { state, inputs };
}

describe('베르단 완주 + 결정론 (AC8, AC2)', () => {
  const durable: WorldConfig = { ...DEFAULT_CONFIG, planet: 1, tier: 1, playerHp: 100_000_000 };

  it('여왕 보스까지 완주해 승리하고 리플레이가 동일 해시로 재현된다', () => {
    const { state, inputs } = playToEnd(0xd00d, durable);
    expect(state.victory).toBe(true);
    expect(state.bossSpawned).toBe(true);
    const a = runReplay({ seed: 0xd00d, config: durable, inputs });
    const b = runReplay({ seed: 0xd00d, config: durable, inputs });
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalState.victory).toBe(true);
  });
});
