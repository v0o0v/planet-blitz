/**
 * 촉매 **드랍 결 `id 0~4`** 의 배선 계약 (ADR-0052).
 *
 * ## 무엇을 재는가 — 카드마다 **이득과 대가를 둘 다**
 * 한쪽만 재면 반쪽 배선을 못 잡는다. 그래서 카드마다 최소 세 축을 잰다:
 *  ① **음성 대조** — 그 카드를 안 실으면 거동이 무촉매와 같다(다른 카드만 실은 런으로 잰다.
 *    `catalystOn` 은 참이지만 `carries` 게이트가 닫혀야 한다는 것이 이 파일의 핵심 계약이다).
 *  ② **이득**이 실제로 관측된다.
 *  ③ **대가**가 실제로 관측된다.
 *
 * ## ⚠️ 왜 앵커를 직접 부르는 시험이 많은가
 * 이 그룹의 여러 카드가 `compact` 말미·레벨업 같은 **틱 안의 특정 지점**에 걸려 있고, 전체
 * 런으로 재면 웨이브 스폰·자동사격이 섞여 *"무엇이 무엇을 바꿨는가"* 가 흐려진다. 그래서
 * 지점 계약은 앵커를 직접 불러 재고, **지점이 실제로 그 자리인가**는 이미
 * `tests/catalystAnchors.test.ts` 가 계측으로 잠그고 있다(중복해서 재지 않는다).
 *
 * ## ⚠️ 함정 메모
 *  - `blankEntity` 의 `enemyType` 기본값은 **-1** 이라 `enemyDefFor` 가 `undefined` 를 돌려주고
 *    그 적은 이동 단계를 통째로 건너뛴다. 적을 심을 때 `enemyType = 0` 을 세운다.
 *  - 첫 틱에 이미 웨이브가 적을 낳는다 — "적이 없으면 0" 형태의 음성 대조는 성립하지 않는다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState, InputFrame } from '../src/sim/world.js';
import { blankEntity, addEntity, spawnLoot } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { readMark } from '../src/sim/catalystMarks.js';
import { AbundanceSlot, readCatalystSlot } from '../src/sim/catalystSlots.js';
import { isCatalystHazard } from '../src/sim/catalyst/shared.js';
import {
  CARD_ABUNDANCE,
  CARD_PLUNDER,
  CARD_HARVEST,
  CARD_BOUNTY,
  CARD_CORNUCOPIA,
  dropsOnTick,
  dropsOnEnemyStep,
  dropsOnEnemyContact,
  dropsOnEnemyDamaged,
  dropsOnEnemyDeath,
  dropsOnLootRoll,
  dropsOnLootCollected,
  dropsOnPlayerDamaged,
  dropsOnLevelUp,
} from '../src/sim/catalyst/drops.js';

const idle: InputFrame = emptyInput();

/** 이 결과 카드는 실리지 않은 촉매 런. 음성 대조의 기준선이다(`catalystOn` 은 참이다). */
const OTHER_CARD = 9;

function w(cards: number[], seed = 0xd7a0): WorldState {
  return createWorld(seed, { ...DEFAULT_CONFIG, catalysts: cards });
}

function player(state: WorldState): Entity {
  const p = state.entities[0];
  if (p === undefined || p.kind !== 'player') throw new Error('플레이어 부재');
  return p;
}

/** 잡몹 하나. `enemyType` 을 유효값으로 세운다(위 §함정). */
function plantEnemy(state: WorldState, x: number, y: number, hp = 1_000_000): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = 32;
  e.hp = hp;
  e.maxHp = hp;
  e.enemyType = 0;
  return addEntity(state, e);
}

/** 엘리트 하나 — `isElite` 는 `kind === 'enemy' && pierce > 0` 이다(`elite.ts`). */
function plantElite(state: WorldState, x: number, y: number): Entity {
  const e = plantEnemy(state, x, y);
  e.pierce = 1;
  return e;
}

/** 바닥 전리품 하나(정상 등급). */
function plantLoot(state: WorldState, x: number, y: number, rarity = 1, seed = 0x1234): Entity {
  return spawnLoot(state, x, y, seed, rarity);
}

function rngTriple(s: WorldState): number[] {
  return [s.dropRng.getState(), s.waveRng.getState(), s.powerupRng.getState()];
}

// ---------------------------------------------------------------------------
// 공통 — RNG 스트림 불변 (헌장 §결정론 규율 1)
// ---------------------------------------------------------------------------

describe('드랍 결 공통 — RNG 를 한 칸도 소비하지 않는다', () => {
  it('다섯 앵커를 전부 태워도 dropRng·waveRng·powerupRng 위치가 그대로다', () => {
    const s = w([CARD_ABUNDANCE, CARD_PLUNDER, CARD_HARVEST]);
    const s2 = w([CARD_BOUNTY, CARD_CORNUCOPIA]);
    for (const st of [s, s2]) {
      const p = player(st);
      const e = plantElite(st, p.x + 40, p.y);
      plantLoot(st, p.x + 10, p.y);
      const before = rngTriple(st);
      dropsOnTick(st, p);
      dropsOnEnemyContact(st, p, e);
      dropsOnEnemyStep(st, e);
      dropsOnPlayerDamaged(st, p, 7, false, 0);
      e.hp = 0;
      dropsOnEnemyDamaged(st, e, 5, undefined);
      dropsOnEnemyDeath(st, e.x, e.y, true);
      dropsOnLootRoll(st, e.x, e.y, true);
      dropsOnLevelUp(st, 2);
      for (const l of st.entities) if (l.kind === 'loot') dropsOnLootCollected(st, l);
      expect(rngTriple(st)).toEqual(before);
    }
  });

  it('전 런 대조 — 비이동계 카드(0·1·3)를 실어도 세 스트림이 무촉매와 같다', () => {
    // ⚠️ `id 2`·`id 4` 는 **플레이어 이동/처치 타이밍을 실제로 바꾸므로** 이 형태로 못 잰다
    //    (웨이브 스폰 위치가 플레이어 좌표의 함수다 — 다른 값이 나오는 것이 정상이다).
    //    그 둘의 RNG 미소비는 위 앵커 직접 시험이 잰다.
    const base = w([OTHER_CARD], 0xd7a1);
    for (let t = 0; t < 120; t++) stepWorld(base, idle);
    const expected = rngTriple(base);
    for (const card of [CARD_ABUNDANCE, CARD_PLUNDER, CARD_BOUNTY]) {
      const s = w([card], 0xd7a1);
      for (let t = 0; t < 120; t++) stepWorld(s, idle);
      expect(rngTriple(s), `카드 ${card} 가 스트림을 밀었다`).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// id 0 abundance
// ---------------------------------------------------------------------------

describe('id 0 abundance — 전리품 두 배 / 더미가 적을 가속', () => {
  it('음성 대조: 카드를 안 실으면 배율도 슬롯도 안 움직인다', () => {
    const s = w([OTHER_CARD]);
    const p = player(s);
    for (let i = 0; i < 8; i++) plantLoot(s, p.x + i * 10, p.y);
    dropsOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, AbundanceSlot.GroundLoot)).toBe(0);
    expect(dropsOnEnemyStep(s, plantEnemy(s, p.x + 500, p.y))).toBe(1);
    expect(dropsOnLootRoll(s, p.x, p.y, true).count).toBe(1);
  });

  it('이득: 전리품 개수 배율이 ×2 다', () => {
    const s = w([CARD_ABUNDANCE]);
    expect(dropsOnLootRoll(s, 0, 0, true).count).toBe(2);
    expect(dropsOnLootRoll(s, 0, 0, false).count).toBe(2);
  });

  it('대가: 바닥 더미가 5 이상이면 적이 빨라지고, 치우면 가라앉는다', () => {
    const s = w([CARD_ABUNDANCE]);
    const p = player(s);
    const e = plantEnemy(s, p.x + 500, p.y);
    const loots: Entity[] = [];
    for (let i = 0; i < 6; i++) loots.push(plantLoot(s, p.x + 200 + i * 10, p.y));
    dropsOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, AbundanceSlot.GroundLoot)).toBe(6);
    const fast = dropsOnEnemyStep(s, e);
    expect(fast).toBeGreaterThan(1);
    // 치우면(회수) 가라앉는다 — 같은 슬롯이 다음 틱에 다시 세어진다.
    for (const l of loots) l.dead = true;
    dropsOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, AbundanceSlot.GroundLoot)).toBe(0);
    expect(dropsOnEnemyStep(s, e)).toBe(1);
  });

  it('4개 이하는 대가가 없다 (임계 5)', () => {
    const s = w([CARD_ABUNDANCE]);
    const p = player(s);
    for (let i = 0; i < 4; i++) plantLoot(s, p.x + 200 + i * 10, p.y);
    dropsOnTick(s, p);
    expect(dropsOnEnemyStep(s, plantEnemy(s, p.x + 500, p.y))).toBe(1);
  });

  it('현상금 표식(`id 3`)은 더미로 세지 않는다 — 두 카드의 화면 문구가 갈리지 않게', () => {
    const s = w([CARD_ABUNDANCE, CARD_BOUNTY]);
    const p = player(s);
    for (let i = 0; i < 8; i++) dropsOnPlayerDamaged(s, p, 5, false, 0);
    dropsOnTick(s, p);
    expect(readCatalystSlot(s.catalystSlots, AbundanceSlot.GroundLoot)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// id 1 plunder
// ---------------------------------------------------------------------------

describe('id 1 plunder — 몸으로 부딪혀야 뱉는다', () => {
  it('음성 대조: 카드를 안 실으면 접촉이 표식을 안 세우고 배율도 1 이다', () => {
    const s = w([OTHER_CARD]);
    const p = player(s);
    const e = plantElite(s, p.x + 30, p.y);
    dropsOnEnemyContact(s, p, e);
    expect(readMark(e, 'plunder')).toBe(0);
    expect(dropsOnLootRoll(s, e.x, e.y, true).count).toBe(1);
  });

  it('이득: 강탈해 둔 엘리트는 전리품 개수 배율이 ×1.8 이다', () => {
    const s = w([CARD_PLUNDER]);
    const p = player(s);
    const e = plantElite(s, p.x + 30, p.y);
    dropsOnEnemyContact(s, p, e);
    expect(readMark(e, 'plunder')).toBe(1);
    expect(dropsOnLootRoll(s, e.x, e.y, true).count).toBeCloseTo(1.8, 10);
  });

  it('⭐ 대가: 강탈하지 않은 엘리트의 전리품은 **잠기고, 주워도 인벤에 안 들어간다**', () => {
    const s = w([CARD_PLUNDER]);
    const p = player(s);
    const e = plantElite(s, p.x + 900, p.y);
    const loot = plantLoot(s, e.x, e.y, 2);
    e.hp = 0;
    dropsOnEnemyDamaged(s, e, 9, undefined); // 치명타 — 강탈 표식이 0 이라 잠금 후보가 된다
    dropsOnEnemyDeath(s, e.x, e.y, true);
    expect(loot.enemyType, '등급코드가 잠금 구간으로 옮겨지지 않았다').toBeGreaterThan(3);
    const lootBefore = s.loot.length;
    expect(dropsOnLootCollected(s, loot)).toBe(true);
    expect(s.loot.length).toBe(lootBefore);
  });

  it('강탈해 둔 엘리트의 전리품은 잠기지 않고 정상 회수된다', () => {
    const s = w([CARD_PLUNDER]);
    const p = player(s);
    const e = plantElite(s, p.x + 900, p.y);
    const loot = plantLoot(s, e.x, e.y, 2);
    dropsOnEnemyContact(s, p, e);
    e.hp = 0;
    dropsOnEnemyDamaged(s, e, 9, undefined);
    dropsOnEnemyDeath(s, e.x, e.y, true);
    expect(loot.enemyType).toBe(2);
    expect(dropsOnLootCollected(s, loot)).toBe(false);
  });

  it('잡몹은 강탈 대상이 아니다 (엘리트·보스만)', () => {
    const s = w([CARD_PLUNDER]);
    const p = player(s);
    const e = plantEnemy(s, p.x + 30, p.y); // pierce 0 = 잡몹
    dropsOnEnemyContact(s, p, e);
    expect(readMark(e, 'plunder')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// id 2 harvest
// ---------------------------------------------------------------------------

describe('id 2 harvest — 수확 지대(관통 + 감속)', () => {
  function bullet(state: WorldState, x: number, y: number): Entity {
    const b = blankEntity('bullet');
    b.x = x;
    b.y = y;
    b.radius = 8;
    b.hp = 1;
    return addEntity(state, b);
  }

  it('음성 대조: 카드를 안 실으면 지대가 안 열리고 감속도 관통도 없다', () => {
    const s = w([OTHER_CARD]);
    const p = player(s);
    dropsOnEnemyDeath(s, p.x, p.y, false);
    expect(s.entities.some((e) => isCatalystHazard(e))).toBe(false);
    const b = bullet(s, p.x, p.y);
    dropsOnTick(s, p);
    expect(b.pierce).toBe(0);
    expect(s.playerSlowTicks).toBe(0);
  });

  it('이득: 적이 죽은 자리에 지대가 열리고 그 위의 아군탄이 관통한다', () => {
    const s = w([CARD_HARVEST]);
    const p = player(s);
    dropsOnEnemyDeath(s, p.x, p.y, false);
    const zone = s.entities.find((e) => isCatalystHazard(e));
    expect(zone).toBeDefined();
    // 지대는 **피해 0** 이다 — 공용 적↔해저드 루프가 자동으로 건너뛴다(밟아도 안 아프다).
    expect(zone?.damage).toBe(0);
    const b = bullet(s, p.x, p.y);
    dropsOnTick(s, p);
    expect(b.pierce).toBeGreaterThan(0);
  });

  it('대가: 지대를 밟는 동안 감속되고, 벗어나면 곧 풀린다', () => {
    const s = w([CARD_HARVEST]);
    const p = player(s);
    dropsOnEnemyDeath(s, p.x, p.y, false);
    dropsOnTick(s, p);
    expect(s.playerSlowTicks).toBeGreaterThan(0);
    // 지대 밖으로 나가면 다시 세우지 않는다(잔여 틱은 `stepPlayer` 가 깎는다).
    s.playerSlowTicks = 0;
    p.x += 5000;
    dropsOnTick(s, p);
    expect(s.playerSlowTicks).toBe(0);
  });

  it('이득: 지대 위 관통탄으로 죽인 적은 젬을 두 배 뱉는다', () => {
    const s = w([CARD_HARVEST]);
    const p = player(s);
    dropsOnEnemyDeath(s, p.x, p.y, false); // 지대 개설
    const e = plantEnemy(s, p.x, p.y);
    const b = bullet(s, p.x, p.y);
    b.pierce = 1;
    e.hp = 0;
    dropsOnEnemyDamaged(s, e, 5, b);
    // `compact` 이 이 자리에 젬을 낳은 뒤에 앵커가 불린다 — 그 순서를 그대로 재현한다.
    const g = blankEntity('gem');
    g.x = e.x;
    g.y = e.y;
    g.radius = 20;
    g.hp = 1;
    g.damage = 3;
    addEntity(s, g);
    dropsOnEnemyDeath(s, e.x, e.y, false);
    expect(g.damage).toBe(6);
  });

  it('지대 밖 관통탄으로 죽인 적은 젬이 그대로다 (음성 대조)', () => {
    const s = w([CARD_HARVEST]);
    const p = player(s);
    const e = plantEnemy(s, p.x + 9000, p.y);
    const b = bullet(s, e.x, e.y);
    b.pierce = 1;
    e.hp = 0;
    dropsOnEnemyDamaged(s, e, 5, b);
    const g = blankEntity('gem');
    g.x = e.x;
    g.y = e.y;
    g.damage = 3;
    addEntity(s, g);
    dropsOnEnemyDeath(s, e.x, e.y, false);
    expect(g.damage).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// id 3 bounty — 이 그룹 최대의 함정이 여기 있다
// ---------------------------------------------------------------------------

describe('id 3 bounty — 피격 지점의 현상금 표식', () => {
  function marks(state: WorldState): Entity[] {
    return state.entities.filter((e) => !e.dead && e.kind === 'loot' && e.enemyType > 3);
  }

  it('음성 대조: 카드를 안 실으면 피격해도 표식이 안 생긴다', () => {
    const s = w([OTHER_CARD]);
    const p = player(s);
    dropsOnPlayerDamaged(s, p, 12, false, 0);
    expect(marks(s).length).toBe(0);
  });

  it('이득: 피격 지점에 표식이 떨어지고 주우면 **자원**이 들어온다', () => {
    const s = w([CARD_BOUNTY]);
    const p = player(s);
    dropsOnPlayerDamaged(s, p, 12, false, 0);
    const m = marks(s);
    expect(m.length).toBe(1);
    expect(m[0]?.x).toBe(p.x);
    const res0 = s.resources;
    expect(dropsOnLootCollected(s, m[0] as Entity)).toBe(true);
    expect(s.resources - res0).toBe(12);
  });

  it('⭐⭐ 표식을 주워도 `state.loot` 가 **안 는다** (가짜 장비 + 공짜 촉매 방지)', () => {
    const s = w([CARD_BOUNTY]);
    const p = player(s);
    for (let i = 0; i < 5; i++) dropsOnPlayerDamaged(s, p, 6, false, 0);
    const before = s.loot.length;
    for (const m of marks(s)) dropsOnLootCollected(s, m);
    expect(s.loot.length, '표식 하나가 장비 하나가 됐다').toBe(before);
  });

  it('대가: 적이 먼저 밟으면 그 적이 먹고 강화되며 표식이 사라진다', () => {
    const s = w([CARD_BOUNTY]);
    const p = player(s);
    dropsOnPlayerDamaged(s, p, 10, false, 0);
    const m = marks(s)[0] as Entity;
    const e = plantEnemy(s, m.x, m.y, 100);
    dropsOnTick(s, p);
    expect(e.hp).toBeGreaterThan(100);
    expect(e.maxHp).toBeGreaterThan(100);
    expect(m.dead).toBe(true);
    expect(marks(s).length).toBe(0);
  });

  it('동시 상한을 넘긴 피격분은 표식이 아니라 **놓침**이다', () => {
    const s = w([CARD_BOUNTY]);
    const p = player(s);
    for (let i = 0; i < 30; i++) dropsOnPlayerDamaged(s, p, 4, false, 0);
    expect(marks(s).length).toBe(12);
  });

  it('피해가 0 이면(막혔으면) 표식이 없다 — 이득 없는 대가를 만들지 않는다', () => {
    const s = w([CARD_BOUNTY]);
    dropsOnPlayerDamaged(s, player(s), 0, false, 0);
    expect(marks(s).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// id 4 cornucopia
// ---------------------------------------------------------------------------

describe('id 4 cornucopia — 레벨업에 바닥 전리품이 전부 터진다', () => {
  it('음성 대조: 카드를 안 실으면 레벨업에 아무 일도 없다', () => {
    const s = w([OTHER_CARD]);
    const p = player(s);
    const l = plantLoot(s, p.x + 60, p.y, 2);
    const before = s.loot.length;
    dropsOnLevelUp(s, 2);
    expect(l.dead).toBe(false);
    expect(s.loot.length).toBe(before);
    expect(s.entities.some((e) => isCatalystHazard(e))).toBe(false);
  });

  it('이득/대가: 바닥 전리품이 회수되되 **등급이 한 단계 내려간다**', () => {
    const s = w([CARD_CORNUCOPIA]);
    const p = player(s);
    plantLoot(s, p.x + 60, p.y, 3, 0xaaaa);
    plantLoot(s, p.x + 90, p.y, 0, 0xbbbb);
    const before = s.loot.length;
    dropsOnLevelUp(s, 2);
    const added = s.loot.slice(before);
    expect(added.length).toBe(2);
    expect(added[0]?.rarity).toBe(2); // 3 → 2 강등
    expect(added[1]?.rarity).toBe(0); // 하한 normal
    // 시드는 그 전리품이 이미 갖고 있던 것 그대로다 — 드랍 시드 수가 늘지 않아야
    // `catalystDropsFromRun` 의 60% 게이트 횟수가 안 는다(촉매가 공짜로 늘지 않는다).
    expect(added.map((r) => r.seed).sort()).toEqual([0xaaaa, 0xbbbb].sort());
    expect(s.entities.filter((e) => isCatalystHazard(e)).length).toBe(2);
  });

  it('현상금 표식(`id 3`)은 터뜨리지 않는다', () => {
    const s = w([CARD_CORNUCOPIA, CARD_BOUNTY]);
    const p = player(s);
    dropsOnPlayerDamaged(s, p, 9, false, 0);
    const before = s.loot.length;
    dropsOnLevelUp(s, 2);
    expect(s.loot.length).toBe(before);
  });

  it('⭐ 폭발로 죽은 적이 **좀비가 아니다** — 처치·젬이 실제로 나온다', () => {
    const s = w([CARD_CORNUCOPIA]);
    const p = player(s);
    const lx = p.x + 60;
    plantLoot(s, lx, p.y, 1);
    const e = plantEnemy(s, lx, p.y, 5);
    dropsOnLevelUp(s, 2);
    const kills0 = s.kills;
    const gems0 = s.entities.filter((g) => g.kind === 'gem' && !g.dead).length;
    // 폭발 해저드는 `stepHazards` → `stepCatalystHazards` → `compact` 순서로 한 틱 뒤에 때린다.
    stepWorld(s, idle);
    expect(e.dead, '`dead` 마킹이 없으면 처치도 젬도 안 나오는 좀비가 된다').toBe(true);
    expect(s.kills).toBeGreaterThan(kills0);
    expect(s.entities.filter((g) => g.kind === 'gem' && !g.dead).length).toBeGreaterThan(gems0);
  });

  it('바닥에 전리품이 없으면 아무 대가도 없다 (축소 작동)', () => {
    const s = w([CARD_CORNUCOPIA]);
    const before = s.loot.length;
    dropsOnLevelUp(s, 2);
    expect(s.loot.length).toBe(before);
    expect(s.entities.some((e) => isCatalystHazard(e))).toBe(false);
  });
});
