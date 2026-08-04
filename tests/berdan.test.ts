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
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { standardEquipped, standardSkillInvest } from '../src/bench/standardBuild.js';
import { LEVEL_PER_STAGE } from '../src/save/progressionPath.js';
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
    const state = createWorld(0x51ee, { ...DEFAULT_CONFIG, planet: 1, stage: 11 });
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

/**
 * 완주 하네스의 파일럿 — **ADR-0035 표준 빌드**(표준 레벨 · 표준 장비 · 표준 투자).
 *
 * ## 왜 무장비에서 표준 빌드로 바꿨나 (2026-07-27 밸런스 패스)
 * 이 블록의 불변식은 난이도가 아니라 **완주 배선**이다("여왕 보스까지 가고 리플레이가 재현된다").
 * 그런데 적 축 재보정으로 무장비 파일럿이 **구조적으로 완주 불가**가 됐다:
 *   · `SEGMENTS.killGoal` 합계 80 → **240**(×3, ADR-0037 Lane D)
 *   · `stageHpMult(11)` 2.2 → **4.0**(×1.8)
 * 실측: 구 하네스(무장비 내구)는 증인 `0xd00e` 로 **144,000틱(2,400초)** 을 돌려도 세그먼트 1 ·
 * 처치 55 에서 **정체**한다(죽지 않고 못 나아간다). 시드 재선정으로도 안 풀린다 — `0xd00e` 부터
 * 연속 **400시드** 스캔에서 완주 0건. 즉 틱 예산도 시드도 답이 아니다.
 *
 * **ADR-0035 가 "적정 티어"의 정의를 표준 레벨·표준 장비·표준 투자로 바꿨다.** 하네스를 그
 * 정의에 맞추는 것이므로 단언을 약화한 것이 아니다 — 실제로 **구 증인 시드 `0xd00e` 가 그대로
 * 산다**(표준 빌드로 t=1,034틱에 승리·보스 처치·처치 59, 실측). 단언은 한 글자도 안 바꿨다.
 *
 * ## 이제 커버되지 않는 것
 * **무장비 저티어 파일럿의 베르단 완주 경로.** 그 경로는 현 밸런스에 존재하지 않으므로 잃은
 * 커버리지라기보다 사라진 대상이다(위 400시드 0건). 무장비 거동 자체는
 * `tests/autopilot.test.ts`(1,200틱 생존)가 계속 밟는다.
 *
 * ## ⚠️ SEED 재선정 2026-08-04(`0xd00d` → `0xd00e`, 수축 스폰 마진)
 * `shrinkSpawnRadius` 가 인셋(16 고정)에서 **마진**(반경 비례 상한 700)으로 바뀌면서 스폰 좌표가
 * 달라져 같은 시드의 런이 통째로 갈렸다 — `0xd00d` 는 격전 세그먼트에서 36,000틱을 돌려도
 * 못 나온다. 24시드 스윕(`0xd00d..0xd024`) 실측으로 **승률은 21/24 로 변경 전과 동일**하고
 * 평균 완주가 7,721 → 5,724틱으로 **짧아졌다**(구간 편차 max/min 중앙값 79 → 38). 즉 이 시드는
 * 밸런스가 나빠져서가 아니라 좌표가 갈려서 죽은 것이고, 그 다음 시드가 그대로 산다.
 *
 * ## ⚠️ `gearSeed` 는 런 시드와 같게 둔다
 * 장비 롤 시드를 상수로 고정하면 "그 장비 세트 한 벌의 운"을 재게 된다 — 같은 설계값에서도
 * `gearSeed` 만 바꾸면 클리어율이 **48.3~100.0%** 로 갈린다는 것이 이 레인 실측이다
 * (`.omc/research/economy-recalibrated-2026-07-27.md` §0.1). 런 시드와 묶어 두면 증인 시드를
 * 갈 때 장비 운도 함께 갈리므로, **이 config 는 증인 시드와 같은 성질**(sim 이 바뀌면 다시
 * 골라야 하는 값)이라는 점을 다음 사람이 알 수 있다.
 */
function standardBerdanConfig(seed: number): WorldConfig {
  const STAGE = 11;
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.level = LEVEL_PER_STAGE * STAGE; // 표준 레벨 = 5 × 단계 (ADR-0035)
  ship.skillInvest = standardSkillInvest(ship.typeId, ship.level);
  ship.equipped = standardEquipped(ship.level, seed, 1);
  return { ...buildRunConfig(profile, { planet: 1, stage: STAGE }), playerHp: 100_000_000 };
}

describe('베르단 완주 + 결정론 (AC8, AC2)', () => {
  it('여왕 보스까지 완주해 승리하고 리플레이가 동일 해시로 재현된다', () => {
    const durable = standardBerdanConfig(0xd00e);
    const { state, inputs } = playToEnd(0xd00e, durable);
    expect(state.victory).toBe(true);
    expect(state.bossSpawned).toBe(true);
    const a = runReplay({ seed: 0xd00e, config: durable, inputs });
    const b = runReplay({ seed: 0xd00e, config: durable, inputs });
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalState.victory).toBe(true);
  });
});
