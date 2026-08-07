/**
 * 촉매 **크라스 특산**(`id 45~47`) 배선 계측 — ADR-0052.
 *
 * ## 이 파일이 재는 것 — 카드마다 넷
 *  1. **음성 대조** — 안 실으면 무촉매와 거동이 같다.
 *  2. **이득과 대가 둘 다** — 한쪽만 재면 반쪽 배선을 못 잡는다.
 *  3. **RNG 스트림 불변** — `dropRng`/`waveRng`/`powerupRng` 가 한 칸도 안 밀린다.
 *  4. 카드별 계약 — `id 45` 의 조준·엄폐 · `id 46` 의 상한 5·`b.phase` 미사용·교착 부재 ·
 *     `id 47` 의 **남은 블록 수 파생**(외부 HP 아님).
 *
 * ⚠️ 블록격파 코스는 `createWorld` 가 한 번에 깐다(수백 개). 배수·개수 단언은 그 전량을 본다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput } from '../src/sim/world.js';
import type { WorldState, WorldConfig } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import {
  BLOCKBREAK_WALL_HP,
  blockBreakWallCount,
  isBreakableWall,
  isPinnedByWall,
} from '../src/sim/modes/blockBreak.js';
import {
  CARD_KRAS_BREACH,
  CARD_KRAS_BREACHSTEEL,
  CARD_KRAS_COLOSSUS,
  KRAS_BREACH_WALL_HP_MULT,
  KRAS_SHARD_CAP,
  krasBreachKeepsCover,
  krasBreachWallHpMult,
  krasOnDamageChain,
  krasOnEnemyDamaged,
  krasOnLootRoll,
  krasOnTick,
  krasOnWallDestroyed,
} from '../src/sim/catalyst/kras.js';
import { BreachsteelSlot, readCatalystSlot } from '../src/sim/catalystSlots.js';
import { INVASION_ACCEL_BASE_CP } from '../src/sim/invasion/constants.js';
import { catalystContributionsOf } from '../src/sim/catalyst/fx.js';

const idle = emptyInput();

/** 블록격파 무대 설정. 크라스는 행성 배정이 없어 `planetMode` 치환으로 실도달시킨다. */
function blockBreakConfig(cards?: number[]): WorldConfig {
  const base: WorldConfig = {
    ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
    planetMode: PLANET_MODE.blockBreak,
    playerHp: 100_000_000,
  };
  return cards === undefined ? base : { ...base, catalysts: cards };
}

function world(seed: number, cards?: number[]): WorldState {
  const s = createWorld(seed, blockBreakConfig(cards));
  s.weapon.damage = 0;
  return s;
}

function player(s: WorldState): Entity {
  const p = s.entities.find((e) => e.kind === 'player');
  if (p === undefined) throw new Error('플레이어 부재');
  return p;
}

function walls(s: WorldState): Entity[] {
  return s.entities.filter((e) => e.kind === 'wall');
}

function liveBreakable(s: WorldState): Entity[] {
  return s.entities.filter((e) => !e.dead && isBreakableWall(e));
}

function plantBoss(s: WorldState, hp: number): Entity {
  const b = blankEntity('boss');
  b.x = 0;
  b.y = -400;
  b.radius = 60;
  b.hp = hp;
  b.maxHp = hp;
  return addEntity(s, b);
}

function rngState(s: WorldState): [number, number, number] {
  return [s.dropRng.getState(), s.waveRng.getState(), s.powerupRng.getState()];
}

function shards(s: WorldState): number {
  return readCatalystSlot(s.catalystSlots, BreachsteelSlot.Shards);
}

function contribution(s: WorldState, id: number): { earned: number; missed: number; fired: number } {
  const row = (catalystContributionsOf(s) ?? []).find((r) => r.id === id);
  return row ?? { earned: 0, missed: 0, fired: 0 };
}

/** 살아 있는 블록 `n` 개를 부순 상태로 만든다(엄폐물 규칙은 호출부가 아니라 여기서 재현). */
function breakBlocks(s: WorldState, n: number): Entity[] {
  const broken: Entity[] = [];
  for (const w of liveBreakable(s)) {
    if (broken.length >= n) break;
    w.hp = 0;
    w.dead = true;
    krasOnWallDestroyed(s, w);
    if (krasBreachKeepsCover(s)) {
      w.hp = 0;
      w.dead = false;
    }
    broken.push(w);
  }
  return broken;
}

// ---------------------------------------------------------------------------
// id 45 — kras-breach
// ---------------------------------------------------------------------------

describe('id 45 kras-breach — 세 배 단단한 블록 · 부순 층은 엄폐물', () => {
  it('음성 대조: 안 실으면 배수 1 이고 부순 블록이 그대로 사라진다', () => {
    const s = world(3);
    expect(krasBreachWallHpMult(s)).toBe(1);
    expect(krasBreachKeepsCover(s)).toBe(false);
    const w = liveBreakable(s)[0];
    if (w === undefined) throw new Error('블록 부재');
    expect(w.hp).toBe(BLOCKBREAK_WALL_HP);
  });

  it('대가: 블록이 정확히 세 배 단단해진다(배치 시점의 기존 지점)', () => {
    const plain = world(3);
    const card = world(3, [CARD_KRAS_BREACH]);
    expect(krasBreachWallHpMult(card)).toBe(KRAS_BREACH_WALL_HP_MULT);
    const a = liveBreakable(plain)[0];
    const b = liveBreakable(card)[0];
    if (a === undefined || b === undefined) throw new Error('블록 부재');
    expect(b.hp).toBe(a.hp * KRAS_BREACH_WALL_HP_MULT);
    expect(liveBreakable(card).length).toBe(liveBreakable(plain).length); // 개수는 그대로
  });

  it('⭐ 블록은 조준 대상이다(`isBreakableWall` 이 참) — 부술 수단이 있어야 코스가 성립한다', () => {
    const s = world(5, [CARD_KRAS_BREACH]);
    const w = liveBreakable(s)[0];
    if (w === undefined) throw new Error('블록 부재');
    expect(isBreakableWall(w)).toBe(true);
  });

  it('⭐ 이득: 부순 층이 hp 0 엄폐물로 남아 **적탄을 막는다**(양 진영 탄이 벽에 죽는다)', () => {
    const s = world(7, [CARD_KRAS_BREACH]);
    const wallCountBefore = walls(s).length;
    const [cover] = breakBlocks(s, 1);
    if (cover === undefined) throw new Error('블록 부재');
    expect(cover.dead).toBe(false); // 사라지지 않는다
    expect(cover.hp).toBe(0);
    expect(isBreakableWall(cover)).toBe(false); // 더는 깎이지 않는다
    expect(walls(s).length).toBe(wallCountBefore);

    // 적탄이 엄폐물에 부딪히면 죽는다 — 탄-벽 스윕은 양 진영 공통이다.
    const p = player(s);
    p.x = cover.x;
    p.y = cover.y + 400;
    const shot = blankEntity('enemyBullet');
    shot.x = cover.x;
    shot.y = cover.y - 60;
    shot.vx = 0;
    shot.vy = 900;
    shot.radius = 8;
    shot.life = 600;
    shot.damage = 5;
    addEntity(s, shot);
    for (let i = 0; i < 12 && !shot.dead; i++) stepWorld(s, idle);
    expect(shot.dead).toBe(true);
  });

  it('엄폐물은 압사 판정 대상이 아니다 — 부술 수 없는 벽에 눌려 죽는 교착이 안 생긴다', () => {
    const s = world(9, [CARD_KRAS_BREACH]);
    const [cover] = breakBlocks(s, 1);
    if (cover === undefined) throw new Error('블록 부재');
    const p = player(s);
    p.x = cover.x;
    p.y = cover.y;
    expect(isPinnedByWall(p, [cover])).toBe(false);
  });

  it('귀속: 엄폐물이 선 자리마다 장부에 적립된다(촉매 드랍 배율의 근거)', () => {
    const s = world(11, [CARD_KRAS_BREACH]);
    breakBlocks(s, 4);
    expect(contribution(s, CARD_KRAS_BREACH).earned).toBe(4);
    expect(contribution(s, CARD_KRAS_BREACH).fired).toBe(4);
  });

  it('RNG 스트림 불변', () => {
    const s = world(13, [CARD_KRAS_BREACH]);
    const before = rngState(s);
    breakBlocks(s, 3);
    krasOnTick(s, player(s));
    expect(rngState(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// id 46 — kras-breachsteel
// ---------------------------------------------------------------------------

describe('id 46 kras-breachsteel — 따라다니는 조각', () => {
  it('음성 대조: 안 실으면 블록을 부숴도 조각이 안 붙고 피해 배율이 중립 1 이다', () => {
    const s = world(17);
    breakBlocks(s, 3);
    expect(shards(s)).toBe(0);
    expect(krasOnDamageChain(s, player(s), 10)).toBe(1);
  });

  it('⭐ 조각 상한은 5 다 — 그 위로 안 쌓인다', () => {
    const s = world(19, [CARD_KRAS_BREACHSTEEL]);
    breakBlocks(s, 20);
    expect(shards(s)).toBe(KRAS_SHARD_CAP);
    expect(KRAS_SHARD_CAP).toBe(5);
  });

  it('⭐ 이득: 조각이 피해를 통째로 막고 하나 부서진다(= 버릴 수단이 있다 → 교착 부재)', () => {
    const s = world(21, [CARD_KRAS_BREACHSTEEL]);
    breakBlocks(s, 3);
    expect(shards(s)).toBe(3);
    expect(krasOnDamageChain(s, player(s), 40)).toBe(0);
    expect(shards(s)).toBe(2);
    expect(krasOnDamageChain(s, player(s), 40)).toBe(0);
    expect(krasOnDamageChain(s, player(s), 40)).toBe(0);
    expect(shards(s)).toBe(0);
    // 다 떨어지면 다시 아프다 — 무한 방패가 아니다.
    expect(krasOnDamageChain(s, player(s), 40)).toBe(1);
  });

  it('⭐ 아군탄 `b.phase` 를 쓰지 않는다(관통 자이로·수렴 프리즘과 이중 계산 금지)', () => {
    const s = world(23, [CARD_KRAS_BREACHSTEEL]);
    const b = blankEntity('bullet');
    b.x = 0;
    b.y = 0;
    b.radius = 6;
    b.phase = 7; // 다른 유니크가 이미 실어 둔 값
    addEntity(s, b);
    breakBlocks(s, 2);
    krasOnTick(s, player(s));
    krasOnDamageChain(s, player(s), 10);
    expect(b.phase).toBe(7);
  });

  it('대가: 조각을 지고 있으면 감속이 걸린다(조각 수만큼 듀티가 는다)', () => {
    const count = (n: number): number => {
      const s = world(25, [CARD_KRAS_BREACHSTEEL]);
      breakBlocks(s, n);
      let slowed = 0;
      for (let t = 0; t < 20; t++) {
        s.tick = t;
        s.playerSlowTicks = 0;
        krasOnTick(s, player(s));
        if (s.playerSlowTicks > 0) slowed++;
      }
      return slowed;
    };
    const one = count(1);
    const five = count(5);
    expect(one).toBeGreaterThan(0);
    expect(five).toBeGreaterThan(one);
    expect(five).toBe(20); // 상한에서는 상시 감속 — 이것이 설계된 대가다
  });

  it('⭐ 보스에 도달하면 조각이 전부 XP 로 환산되고(상한 ×2.0) 조각이 비워진다', () => {
    const s = world(27, [CARD_KRAS_BREACHSTEEL]);
    breakBlocks(s, 5);
    const xpBefore = s.catalystMods.xp;
    krasOnTick(s, player(s)); // 보스 없음 — 아직 환산되지 않는다
    expect(s.catalystMods.xp).toBe(xpBefore);
    expect(shards(s)).toBe(5);
    plantBoss(s, 1000);
    krasOnTick(s, player(s));
    expect(s.catalystMods.xp).toBeCloseTo(xpBefore * 2, 6);
    expect(shards(s)).toBe(0);
    expect(contribution(s, CARD_KRAS_BREACHSTEEL).earned).toBe(5);
  });

  it('RNG 스트림 불변', () => {
    const s = world(29, [CARD_KRAS_BREACHSTEEL]);
    const before = rngState(s);
    breakBlocks(s, 3);
    plantBoss(s, 1000);
    krasOnTick(s, player(s));
    krasOnDamageChain(s, player(s), 10);
    expect(rngState(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// id 47 — kras-colossus
// ---------------------------------------------------------------------------

describe('id 47 kras-colossus — 남은 블록이 곧 보스의 방어력', () => {
  it('음성 대조: 안 실으면 보스가 받은 피해가 그대로고 전리품 배율이 중립이다', () => {
    const s = world(31);
    const b = plantBoss(s, 1000);
    b.hp -= 100;
    krasOnEnemyDamaged(s, b, 100, undefined);
    expect(b.hp).toBe(900);
    expect(krasOnLootRoll(s, 0, 0, false)).toEqual({ rarity: 1, count: 1 });
  });

  it('⭐ 방어력은 **남은 블록 수 파생**이다 — 부술수록 실효 피해가 커진다(외부 HP 오브젝트 없음)', () => {
    const dealt = (broken: number): number => {
      const s = world(33, [CARD_KRAS_COLOSSUS]);
      breakBlocks(s, broken);
      const b = plantBoss(s, 1_000_000);
      const before = b.hp;
      b.hp -= 1000;
      krasOnEnemyDamaged(s, b, 1000, undefined);
      return before - b.hp;
    };
    const none = dealt(0);
    const some = dealt(Math.floor(blockBreakWallCount() / 2));
    const all = dealt(blockBreakWallCount());
    expect(none).toBeCloseTo(500, 6); // 전량 남음 → 감소율 0.5
    expect(some).toBeGreaterThan(none);
    expect(all).toBeCloseTo(1000, 6); // 전량 파괴 → 감소 0
  });

  it('보스 HP 를 외부 오브젝트에 두지 않는다 — 보스는 여전히 하나뿐이고 kind 도 그대로다', () => {
    const s = world(35, [CARD_KRAS_COLOSSUS]);
    const b = plantBoss(s, 1000);
    b.hp -= 100;
    krasOnEnemyDamaged(s, b, 100, undefined);
    expect(s.entities.filter((e) => e.kind === 'boss').length).toBe(1);
    expect(b.maxHp).toBe(1000); // 방어력을 HP 로 바꿔치기하지 않았다
  });

  it('감소분을 되돌리면서 살아난 보스는 `dead` 가 내려간다(좀비·유령 방지)', () => {
    const s = world(37, [CARD_KRAS_COLOSSUS]);
    const b = plantBoss(s, 1000);
    b.hp = -100;
    b.dead = true;
    krasOnEnemyDamaged(s, b, 1000, undefined);
    expect(b.hp).toBeGreaterThan(0);
    expect(b.dead).toBe(false);
  });

  it('⭐ 이득: 부순 수만큼 전리품 등급이 오른다(상한 ×2.4)', () => {
    const none = world(39, [CARD_KRAS_COLOSSUS]);
    expect(krasOnLootRoll(none, 0, 0, false).rarity).toBe(1);
    const all = world(39, [CARD_KRAS_COLOSSUS]);
    breakBlocks(all, blockBreakWallCount());
    expect(krasOnLootRoll(all, 0, 0, false).rarity).toBeCloseTo(2.4, 6);
  });

  it('⭐ 대가: 부술수록 스크롤이 더 빨리 밀려 올라온다(기존 노브 `accelCp` 의 하한)', () => {
    const s = world(41, [CARD_KRAS_COLOSSUS]);
    const rt = s.scrollRuntime;
    if (rt === undefined) throw new Error('스크롤 런타임 부재');
    krasOnTick(s, player(s));
    expect(rt.accelCp).toBe(INVASION_ACCEL_BASE_CP);
    breakBlocks(s, Math.floor(blockBreakWallCount() / 2));
    krasOnTick(s, player(s));
    const half = rt.accelCp;
    expect(half).toBeGreaterThan(INVASION_ACCEL_BASE_CP);
    breakBlocks(s, blockBreakWallCount());
    krasOnTick(s, player(s));
    expect(rt.accelCp).toBeGreaterThan(half);
    // 하한이라 여러 번 적용해도 복리로 폭주하지 않는다.
    const settled = rt.accelCp;
    for (let i = 0; i < 10; i++) krasOnTick(s, player(s));
    expect(rt.accelCp).toBe(settled);
  });

  it('RNG 스트림 불변', () => {
    const s = world(43, [CARD_KRAS_COLOSSUS]);
    const b = plantBoss(s, 1000);
    const before = rngState(s);
    breakBlocks(s, 5);
    krasOnTick(s, player(s));
    krasOnEnemyDamaged(s, b, 100, undefined);
    krasOnLootRoll(s, 0, 0, false);
    expect(rngState(s)).toEqual(before);
  });
});

describe('크라스 공통 — 모드 계약 · 진행 교착 부재', () => {
  it('세 카드 어느 것도 보스를 지우거나 코스를 없애지 않는다(격화이지 교체가 아니다)', () => {
    const plain = world(51);
    const card = world(51, [CARD_KRAS_BREACH, CARD_KRAS_COLOSSUS]);
    expect(liveBreakable(card).length).toBe(liveBreakable(plain).length);
    expect(blockBreakWallCount()).toBe(liveBreakable(plain).length);
  });

  it('강제 스크롤에서 조각을 다 지고도 런이 전진한다(교착 부재)', () => {
    const s = world(53, [CARD_KRAS_BREACHSTEEL]);
    breakBlocks(s, 5);
    const rt = s.scrollRuntime;
    if (rt === undefined) throw new Error('스크롤 런타임 부재');
    const y0 = rt.scrollY;
    const p = player(s);
    for (let i = 0; i < 120; i++) stepWorld(s, idle);
    expect(rt.scrollY).toBeLessThan(y0); // −Y 로 계속 밀려 올라간다
    expect(p.hp).toBeGreaterThan(0);
    expect(s.gameOver).toBe(false);
  });

  it('세 카드 어느 것도 적 `aux0`(catalystMarks) 를 안 쓴다', () => {
    const s = world(55, [CARD_KRAS_BREACH, CARD_KRAS_BREACHSTEEL]);
    const e = blankEntity('enemy');
    e.x = 0;
    e.y = 0;
    e.radius = 32;
    e.hp = 100;
    e.maxHp = 100;
    e.enemyType = 0; // ⚠️ 기본 -1 함정
    addEntity(s, e);
    breakBlocks(s, 3);
    krasOnTick(s, player(s));
    expect(e.aux0).toBe(0);
  });
});
