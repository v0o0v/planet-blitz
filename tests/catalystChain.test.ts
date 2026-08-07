/**
 * 촉매 **연쇄 결**(`id 20~24`) 배선 계측 — ADR-0052.
 *
 * ## 이 파일이 재는 것 — 카드마다 넷
 *  1. **음성 대조** — 안 실으면 무촉매와 거동이 같다(마커도 엔티티도 안 생긴다).
 *  2. **이득과 대가 둘 다** — 한쪽만 재면 반쪽 배선을 못 잡는다.
 *  3. **RNG 스트림 불변** — 카드가 난수를 한 칸도 안 굴린다.
 *  4. 카드별 함정 — `id 22` 의 좀비·자기 피해 격리, `id 20` 의 `aux1` 불변, `id 21`·`id 23` 의
 *     조준 등재.
 *
 * ⚠️ 적을 심을 때 **`enemyType` 을 세운다.** `blankEntity` 기본값 `-1` 은 `enemyDefFor` 가
 * `undefined` 를 내서 이동 단계도 앵커도 통째로 건너뛴다(앞 레인 실측).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import {
  chainOnCatalystHazards,
  chainOnDamageChain,
  chainOnDestructibleDestroyed,
  chainOnEnemyDamaged,
  chainOnEnemyDeath,
  chainOnEnemyStep,
  chainOnLootRoll,
  chainOnTick,
  CARD_CATALYSIS,
} from '../src/sim/catalyst/chain.js';
import { onDamageChainCatalyst } from '../src/sim/catalystHooks.js';
import { isCatalystHazard, isCatalystEnemyOnlyObject } from '../src/sim/catalyst/shared.js';
import { isObjectiveDestructible } from '../src/sim/modes/objective.js';
import { readMark } from '../src/sim/catalystMarks.js';
import { catalystContributionsOf } from '../src/sim/catalyst/fx.js';
import { CATALYST_FX } from '../src/sim/catalyst/fx.js';

const idle = emptyInput();

/** 카드 `cards` 를 실은 월드. 무기 피해 0 — 자동 사격이 계측 대상을 대신 죽이면 안 된다. */
function world(seed: number, cards: number[] | undefined): WorldState {
  const s =
    cards === undefined
      ? createWorld(seed, { ...DEFAULT_CONFIG })
      : createWorld(seed, { ...DEFAULT_CONFIG, catalysts: cards });
  s.weapon.damage = 0;
  return s;
}

function player(s: WorldState): Entity {
  const p = s.entities.find((e) => e.kind === 'player');
  if (p === undefined) throw new Error('플레이어 부재');
  return p;
}

function plantEnemy(s: WorldState, x: number, y: number, hp = 1_000_000, type = 0): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = 32;
  e.hp = hp;
  e.maxHp = hp;
  e.enemyType = type; // ⚠️ 기본 -1 함정
  return addEntity(s, e);
}

function rngState(s: WorldState): [number, number, number] {
  return [s.dropRng.getState(), s.waveRng.getState(), s.powerupRng.getState()];
}

function fxKinds(s: WorldState, id: number): number[] {
  return (s.catalystFx ?? []).filter((f) => f.id === id).map((f) => f.kind);
}

function marked(s: WorldState, mark: number): Entity[] {
  return s.entities.filter((e) => e.kind === 'destructible' && e.ownerId === mark && !e.dead);
}

// 마커 상수는 `catalyst/shared.ts` 가 소유한다. 테스트가 리터럴을 다시 적으면 정본이 둘이 된다.
/**
 * 폭발로 적 하나를 죽이고 **죽은 그 좌표**를 돌려준다.
 *
 * ⚠️ 심은 좌표를 그대로 쓰면 안 된다 — `stepEnemies` 가 적 피해 루프보다 **앞**이라 적은 이미
 * 움직인 뒤에 죽는다. 죽은 좌표의 유일한 물증은 그 자리에 선 **젬**이다(`compact` 이
 * `drops.push({x: e.x, y: e.y})` 로 같은 값을 쓴다).
 */
function blastKillSpot(s: WorldState): { x: number; y: number } {
  const p = player(s);
  const victim = plantEnemy(s, p.x + 300, p.y, 10);
  const before = new Set(s.entities.filter((e) => e.kind === 'gem'));
  chainOnEnemyDeath(s, victim.x, victim.y, false);
  stepWorld(s, idle);
  const gem = s.entities.find((e) => e.kind === 'gem' && !before.has(e));
  if (gem === undefined) throw new Error('폭발이 적을 못 죽였다(젬 부재)');
  return { x: gem.x, y: gem.y };
}

const SHARD_MARK = 0xc0de21;
const SEED_MARK = 0xc0de23;
const TREE_MARK = 0xc0de24;

// ---------------------------------------------------------------------------
// 전 카드 공통 — RNG 스트림 불변
// ---------------------------------------------------------------------------

describe('연쇄 결 — RNG 스트림 불변', () => {
  it('넷 다 실어도 조건이 안 서면 세 스트림이 무촉매와 비트 동일이다', () => {
    const base = world(0xc4a1, undefined);
    const cat = world(0xc4a1, [20, 21, 22]);
    for (let i = 0; i < 40; i++) {
      stepWorld(base, idle);
      stepWorld(cat, idle);
    }
    // 무기 피해 0 이라 처치가 없다 = 카드 넷 다 발동 조건이 안 선다. 그런데도 스트림이 갈리면
    // 그것은 **카드가 직접 난수를 굴렸다**는 뜻이다(헌장 §공통-B(c)).
    expect(rngState(cat)).toEqual(rngState(base));
  });

  it('id 23 을 실어도 조건 미성립 구간의 스트림이 같다', () => {
    const base = world(0xc4a2, undefined);
    const cat = world(0xc4a2, [23]);
    for (let i = 0; i < 40; i++) {
      stepWorld(base, idle);
      stepWorld(cat, idle);
    }
    expect(rngState(cat)).toEqual(rngState(base));
  });
});

// ---------------------------------------------------------------------------
// id 20 resonance (동조)
// ---------------------------------------------------------------------------

describe('id 20 resonance — 동조', () => {
  function trio(s: WorldState): Entity[] {
    const p = player(s);
    return [
      plantEnemy(s, p.x + 600, p.y),
      plantEnemy(s, p.x + 660, p.y),
      plantEnemy(s, p.x + 640, p.y + 60),
    ];
  }

  it('안 실으면 동조 표식이 서지 않는다(음성 대조)', () => {
    const s = world(0xc420, undefined);
    const es = trio(s);
    chainOnTick(s, player(s));
    for (const e of es) expect(readMark(e, 'attuned')).toBe(0);
  });

  it('같은 종류 셋이 모이면 동조하고, aux1 은 한 비트도 안 움직인다', () => {
    const s = world(0xc420, [20]);
    const es = trio(s);
    const aux1Before = es.map((e) => e.aux1);
    chainOnTick(s, player(s));
    for (const e of es) expect(readMark(e, 'attuned')).toBe(1);
    // ⚠️ `MID_CLASH_LEADER_MARK` 가 매 런 확정 점유하는 칸이다 — 덮으면 중반 격전이 공짜 통과.
    expect(es.map((e) => e.aux1)).toEqual(aux1Before);
  });

  it('둘뿐이거나 종류가 다르면 동조하지 않는다(축소 작동)', () => {
    const s = world(0xc420, [20]);
    const p = player(s);
    const a = plantEnemy(s, p.x + 600, p.y, 1_000_000, 0);
    const b = plantEnemy(s, p.x + 640, p.y, 1_000_000, 0);
    const c = plantEnemy(s, p.x + 620, p.y + 40, 1_000_000, 1); // 다른 종류
    chainOnTick(s, player(s));
    for (const e of [a, b, c]) expect(readMark(e, 'attuned')).toBe(0);
  });

  it('이득 — 하나를 죽이면 나머지가 즉사하고 셋 다 처치로 잡힌다', () => {
    const s = world(0xc420, [20]);
    const es = trio(s);
    chainOnTick(s, player(s));
    const [victim, ...rest] = es;
    if (victim === undefined) throw new Error('적 부재');
    victim.hp = 0;
    victim.dead = true;
    chainOnEnemyDamaged(s, victim, 999, undefined);
    for (const e of rest) {
      expect(e.dead, '동조 연쇄가 나머지를 안 죽였다').toBe(true);
      // ⚠️ `compact()` 는 `dead` 인 것만 수거하고 처치는 `hp <= 0` 게이트다 — 둘 다 서야
      //    좀비가 아니다.
      expect(e.hp).toBeLessThanOrEqual(0);
    }
    expect(fxKinds(s, 20)).toContain(CATALYST_FX.trigger);
  });

  it('무촉매에서는 하나를 죽여도 나머지가 산다(음성 대조)', () => {
    const s = world(0xc420, undefined);
    const es = trio(s);
    chainOnTick(s, player(s));
    const [victim, ...rest] = es;
    if (victim === undefined) throw new Error('적 부재');
    victim.hp = 0;
    chainOnEnemyDamaged(s, victim, 999, undefined);
    for (const e of rest) expect(e.dead).toBe(false);
  });

  it('대가 — 동조 중인 적은 빨라진다(그리고 아닌 적은 배율 1 그대로)', () => {
    const s = world(0xc420, [20]);
    const es = trio(s);
    const lone = plantEnemy(s, player(s).x - 900, player(s).y);
    chainOnTick(s, player(s));
    const first = es[0];
    if (first === undefined) throw new Error('적 부재');
    expect(chainOnEnemyStep(s, first)).toBeGreaterThan(1);
    expect(chainOnEnemyStep(s, lone)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// id 22 cascade (연쇄)
// ---------------------------------------------------------------------------

describe('id 22 cascade — 연쇄', () => {
  function blasts(s: WorldState): Entity[] {
    return s.entities.filter((e) => isCatalystHazard(e) && !e.dead);
  }

  it('안 실으면 폭발이 서지 않는다(음성 대조)', () => {
    const s = world(0xc422, undefined);
    chainOnEnemyDeath(s, 100, 100, false);
    expect(blasts(s)).toHaveLength(0);
  });

  it('격추 지점에 단발 폭발이 서고, 활성 틱이 2 다(1 이면 한 번도 안 때린다)', () => {
    const s = world(0xc422, [22]);
    chainOnEnemyDeath(s, 100, 100, false);
    const bs = blasts(s);
    expect(bs).toHaveLength(1);
    const h = bs[0];
    if (h === undefined) throw new Error('폭발 부재');
    expect(h.phase, '단발이어야 공용 지속형 루프와 이중 타격이 안 난다').toBe(0);
    // ⚠️ `stepHazards` 가 `life` 를 먼저 깎고 0 이면 그 자리에서 `dead` 를 세운다. 적 피해 루프는
    //    같은 틱의 뒤라 `activeTicks = 1` 이면 판정이 한 번도 안 일어난다(2026-08-08 실측).
    expect(h.life).toBeGreaterThanOrEqual(2);
  });

  it('⭐ 폭발이 실제로 적을 죽이고 처치·젬이 나온다(좀비가 아니다)', () => {
    const s = world(0xc422, [22]);
    const p = player(s);
    const victim = plantEnemy(s, p.x + 300, p.y, 10);
    const killsBefore = s.kills;
    const gemsBefore = s.entities.filter((e) => e.kind === 'gem').length;
    chainOnEnemyDeath(s, victim.x, victim.y, false);
    stepWorld(s, idle);
    expect(s.kills, '폭발이 적을 죽이지 못했거나 좀비가 됐다').toBe(killsBefore + 1);
    expect(s.entities.filter((e) => e.kind === 'gem').length).toBeGreaterThan(gemsBefore);
  });

  it('⭐ 자기 피해는 절반이고, 적 피해는 그 두 배다', () => {
    const s = world(0xc422, [22]);
    const p = player(s);
    const victim = plantEnemy(s, p.x + 300, p.y, 1_000_000);
    chainOnEnemyDeath(s, victim.x, victim.y, false);
    const h = blasts(s)[0];
    if (h === undefined) throw new Error('폭발 부재');
    // 플레이어 쪽 해저드 피해는 `resolveCollisions` 가 `t.damage` 를 그대로 읽는다 = 절반.
    const half = h.damage;
    const hpBefore = victim.hp;
    stepWorld(s, idle);
    expect(hpBefore - victim.hp, '적은 절반의 두 배를 받아야 한다').toBe(half * 2);
  });

  it('⭐ 다른 피해원은 반감되지 않는다 — 감쇠 사슬 칸은 중립 1 이다', () => {
    const s = world(0xc422, [22]);
    const p = player(s);
    expect(chainOnDamageChain(s, p, 100)).toBe(1);
    // 디스패처를 통과해도 같다(팬아웃 누적이 100 을 그대로 돌려준다).
    expect(onDamageChainCatalyst(s, p, 100)).toBe(100);
  });

  it('자기 폭발에 닿으면 selfHarm 통지가 따로 난다(적 피해와 다른 채널)', () => {
    const s = world(0xc422, [22]);
    const p = player(s);
    chainOnEnemyDeath(s, p.x, p.y, false);
    stepWorld(s, idle);
    expect(fxKinds(s, 22)).toContain(CATALYST_FX.selfHarm);
  });

  it('이득 — 폭발로 죽인 자리의 전리품 개수 배율이 2 다', () => {
    const s = world(0xc422, [22]);
    const { x, y } = blastKillSpot(s);
    expect(chainOnLootRoll(s, x, y, true).count).toBe(2);
    // 폭발과 무관한 자리는 그대로 1 이다(무조건 배율이 아니다).
    expect(chainOnLootRoll(s, x + 9999, y + 9999, true).count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// id 21 catalysis (촉매작용)
// ---------------------------------------------------------------------------

describe('id 21 catalysis — 촉매작용', () => {
  /** 전리품 롤 → 사망 통지 순서로 결정 하나를 박는다(실제 `compact()` 의 두 지점과 같은 순서). */
  function plantShard(s: WorldState, x: number, y: number): void {
    chainOnLootRoll(s, x, y, true);
    chainOnEnemyDeath(s, x, y, true);
  }

  it('안 실으면 결정이 박히지 않는다(음성 대조)', () => {
    const s = world(0xc421, undefined);
    plantShard(s, 200, 200);
    expect(marked(s, SHARD_MARK)).toHaveLength(0);
  });

  it('전리품이 난 자리에 결정이 박히고 적립이 잡힌다', () => {
    const s = world(0xc421, [21]);
    plantShard(s, 200, 200);
    const shards = marked(s, SHARD_MARK);
    expect(shards).toHaveLength(1);
    const row = (catalystContributionsOf(s) ?? []).find((r) => r.id === CARD_CATALYSIS);
    expect(row?.earned, '정착 수의 더하는 쪽이 안 잡혔다').toBe(1);
  });

  it('보스 확정 드랍(elite=false)에는 결정이 안 박힌다(스크래치를 비울 짝이 없다)', () => {
    const s = world(0xc421, [21]);
    chainOnLootRoll(s, 200, 200, false);
    chainOnEnemyDeath(s, 200, 200, false);
    expect(marked(s, SHARD_MARK)).toHaveLength(0);
  });

  it('⭐ 결정은 조준·아군탄에서 빠지되 격자에는 남는다 (적만 부순다)', () => {
    // 종전 단언은 *"결정은 조준 대상이다 — 안 하면 부술 수단이 없다"* 였다. **그 전제가 틀렸다**:
    // 부술 수단은 적이고(바로 아래 «적이 밟으면 부서진다» 가 그것을 증명한다), 규칙 문장도
    // *"적이 밟으면 부서진다"* 뿐이라 플레이어 파괴는 규칙에 없다. 이 게임은 수동 조준이 없어
    // 등재하면 플레이어가 자기 보상을 갉는 것을 피할 방법이 원리적으로 없었다.
    const s = world(0xc421, [21]);
    plantShard(s, 200, 200);
    const shard = marked(s, SHARD_MARK)[0];
    if (shard === undefined) throw new Error('결정 부재');
    // ① 조준 술어에서 빠진다.
    expect(isObjectiveDestructible(shard), '자동조준이 결정을 문다').toBe(false);
    // ② 아군탄 화이트리스트에서 빠진다 — 이쪽을 빠뜨리면 "조준은 안 되는데 유탄에는 맞는" 상태다.
    expect(isCatalystEnemyOnlyObject(shard), '아군탄 제외 술어가 거짓이다').toBe(true);
    // ③ 격자 등록은 **유지**된다(`destructible` kind 라 자동). 빼면 적 접촉 판정까지 사라져
    //    *"적이 밟으면"* 이 영영 거짓이 되고 카드가 무적 오브젝트로 죽는다.
    expect(shard.kind).toBe('destructible');
  });

  it('대가 — 적이 밟으면 부서지고 놓친 몫이 잡힌다', () => {
    const s = world(0xc421, [21]);
    plantShard(s, 400, 400);
    const shard = marked(s, SHARD_MARK)[0];
    if (shard === undefined) throw new Error('결정 부재');
    plantEnemy(s, shard.x, shard.y);
    chainOnTick(s, player(s));
    expect(shard.dead, '적이 밟았는데 결정이 안 부서졌다').toBe(true);
    // 감산은 **파괴 앵커 한 곳**이 진다(잃는 경로 셋이 전부 거기로 수렴한다).
    expect(chainOnDestructibleDestroyed(s, shard)).toBe(true);
    const row = (catalystContributionsOf(s) ?? []).find((r) => r.id === CARD_CATALYSIS);
    expect(row?.missed).toBe(1);
    expect(row?.earned).toBe(1); // 정착 수 = earned − missed = 0
  });

  it('적이 없으면 결정은 그대로 남는다(축소 작동 — 대가만 물리지 않는다)', () => {
    const s = world(0xc421, [21]);
    plantShard(s, 400, 400);
    chainOnTick(s, player(s));
    expect(marked(s, SHARD_MARK)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// id 23 seeding (파종)
// ---------------------------------------------------------------------------

describe('id 23 seeding — 파종', () => {
  it('안 실으면 씨앗이 안 남는다(음성 대조)', () => {
    const s = world(0xc423, undefined);
    chainOnEnemyDeath(s, 300, 300, false);
    expect(marked(s, SEED_MARK)).toHaveLength(0);
  });

  it('처치 자리에 씨앗이 남고, 조준·아군탄에서는 빠진다 (적만 먹는다)', () => {
    // 규칙은 *"그 전에 **적이 밟으면** 씨앗을 먹고 강화된다"* — 결정(`id 21`)과 같은 형태라
    // 플레이어 파괴 조항이 없다.
    const s = world(0xc423, [23]);
    chainOnEnemyDeath(s, 300, 300, false);
    const seed = marked(s, SEED_MARK)[0];
    if (seed === undefined) throw new Error('씨앗 부재');
    expect(seed.timer).toBeGreaterThan(0);
    expect(isObjectiveDestructible(seed), '자동조준이 씨앗을 문다').toBe(false);
    expect(isCatalystEnemyOnlyObject(seed)).toBe(true);
  });

  it('이득 — 발아하면 나무가 되고 주기적으로 전리품을 떨군다', () => {
    const s = world(0xc423, [23]);
    chainOnEnemyDeath(s, 300, 300, false);
    const seed = marked(s, SEED_MARK)[0];
    if (seed === undefined) throw new Error('씨앗 부재');
    seed.timer = 1;
    chainOnTick(s, player(s)); // 발아
    expect(marked(s, TREE_MARK)).toHaveLength(1);
    // 나무도 조준에서 빠진다 — 열매는 **스스로** 떨어지고(아래) 다 떨군 나무는 스스로 사라진다.
    // 플레이어가 부수면 남은 열매가 통째로 증발해 카드의 이득 자체가 없어진다.
    expect(isObjectiveDestructible(seed), '자동조준이 나무를 문다').toBe(false);
    expect(isCatalystEnemyOnlyObject(seed)).toBe(true);
    const lootBefore = s.entities.filter((e) => e.kind === 'loot').length;
    seed.timer = 1;
    chainOnTick(s, player(s)); // 첫 열매
    expect(s.entities.filter((e) => e.kind === 'loot').length).toBe(lootBefore + 1);
  });

  it('열매는 RNG 를 굴리지 않는다(순수 파생)', () => {
    const s = world(0xc423, [23]);
    chainOnEnemyDeath(s, 300, 300, false);
    const seed = marked(s, SEED_MARK)[0];
    if (seed === undefined) throw new Error('씨앗 부재');
    seed.timer = 1;
    chainOnTick(s, player(s));
    const before = rngState(s);
    seed.timer = 1;
    chainOnTick(s, player(s));
    expect(rngState(s)).toEqual(before);
  });

  it('대가 — 발아 전에 적이 밟으면 씨앗이 사라지고 그 적이 강화된다', () => {
    const s = world(0xc423, [23]);
    chainOnEnemyDeath(s, 500, 500, false);
    const seed = marked(s, SEED_MARK)[0];
    if (seed === undefined) throw new Error('씨앗 부재');
    const eater = plantEnemy(s, seed.x, seed.y, 100);
    const hpBefore = eater.hp;
    const maxBefore = eater.maxHp;
    chainOnTick(s, player(s));
    expect(seed.dead, '적이 밟았는데 씨앗이 안 사라졌다').toBe(true);
    expect(eater.hp).toBeGreaterThan(hpBefore);
    expect(eater.maxHp).toBeGreaterThan(maxBefore);
    expect(fxKinds(s, 23)).toContain(CATALYST_FX.selfHarm);
  });

  it('씨앗·나무는 기본 젬을 안 떨군다(억제)', () => {
    const s = world(0xc423, [23]);
    chainOnEnemyDeath(s, 300, 300, false);
    const seed = marked(s, SEED_MARK)[0];
    if (seed === undefined) throw new Error('씨앗 부재');
    expect(chainOnDestructibleDestroyed(s, seed)).toBe(true);
    seed.ownerId = TREE_MARK;
    expect(chainOnDestructibleDestroyed(s, seed)).toBe(true);
    // 절차 청크 지형(ownerId 0)은 건드리지 않는다.
    const rock = blankEntity('destructible');
    expect(chainOnDestructibleDestroyed(s, rock)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 해저드 루프의 스크래치 위생
// ---------------------------------------------------------------------------

describe('연쇄 결 — 틱-국소 스크래치', () => {
  it('해저드 단계가 매 틱 스크래치를 비운다(카드가 없어도)', () => {
    const s = world(0xc424, [22]);
    const { x, y } = blastKillSpot(s);
    expect(chainOnLootRoll(s, x, y, true).count).toBe(2);
    // 다음 틱의 해저드 단계가 비운다 → 같은 좌표라도 더 이상 두 배가 아니다.
    chainOnCatalystHazards(s);
    expect(chainOnLootRoll(s, x, y, true).count).toBe(1);
  });
});
