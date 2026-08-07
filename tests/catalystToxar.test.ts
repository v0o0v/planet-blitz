/**
 * 촉매 **톡사르 특산**(`id 42~44`) 배선 계측 — ADR-0052.
 *
 * ## 이 파일이 재는 것 — 카드마다 넷
 *  1. **음성 대조** — 안 실으면 무촉매와 거동이 같다.
 *  2. **이득과 대가 둘 다** — 한쪽만 재면 반쪽 배선을 못 잡는다.
 *  3. **RNG 스트림 불변** — 카드가 `dropRng`/`waveRng`/`powerupRng` 를 한 칸도 안 굴린다.
 *  4. 카드별 계약 — `id 42` 의 **정화 하한 0.5**, `id 43` 의 **효과가 실제로 난다**(스폰됐다가
 *     아니라), `id 44` 의 **보스 kind 가 하나뿐이고 첫 형태로 런이 안 끝난다**.
 *
 * ⚠️ 적을 심을 때 **`enemyType` 을 세운다.** `blankEntity` 기본값 `-1` 은 `enemyDefFor` 가
 * `undefined` 를 내서 이동 단계도 앵커도 통째로 건너뛴다(앞 레인 실측).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState, WorldConfig } from '../src/sim/world.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import {
  CARD_TOXAR_BLIGHTSPORE,
  CARD_TOXAR_BLIGHT_MOTHER,
  CARD_TOXAR_OUTBREAK,
  TOXAR_MOTHER_PHASE,
  TOXAR_PURIFY_FACTOR,
  TOXAR_PURIFY_FACTOR_MIN,
  TOXAR_SPORE_MARK,
  toxarOnEnemyDamaged,
  toxarOnEnemyDeath,
  toxarOnEnemyStep,
  toxarOnLootRoll,
  toxarOnTick,
  toxarPurifyIntervalMult,
} from '../src/sim/catalyst/toxar.js';
import {
  CONTAMINATION_NODE_COUNT,
  contaminationCellCount,
  isContaminationCell,
} from '../src/sim/modes/contamination.js';
import { isCatalystHazard, isCatalystHazardMarked } from '../src/sim/catalyst/shared.js';
import { catalystContributionsOf } from '../src/sim/catalyst/fx.js';

const idle = emptyInput();

/** 오염 무대 설정. 톡사르는 행성 배정이 없어 `planetMode` 치환으로 실도달시킨다(선례: `contaminationMode.test.ts`). */
function contaminationConfig(cards?: number[]): WorldConfig {
  const base: WorldConfig = {
    ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
    planetMode: PLANET_MODE.contamination,
    playerHp: 100_000_000,
  };
  return cards === undefined ? base : { ...base, catalysts: cards };
}

/** 무기 피해 0 — 자동 사격이 계측 대상을 대신 죽이면 안 된다. */
function world(seed: number, cards?: number[]): WorldState {
  const s = createWorld(seed, contaminationConfig(cards));
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

function contribution(s: WorldState, id: number): { earned: number; missed: number; fired: number } {
  const row = (catalystContributionsOf(s) ?? []).find((r) => r.id === id);
  return row ?? { earned: 0, missed: 0, fired: 0 };
}

/** 오염 셀을 좌표에 직접 하나 세운다(확산을 1,700틱 기다리지 않는다). */
function plantCell(s: WorldState, x: number, y: number, owner: number): Entity {
  const h = blankEntity('hazard');
  h.enemyType = 3; // HAZARD_CONTAMINATION
  h.x = x;
  h.y = y;
  h.radius = 100;
  h.timer = 0;
  h.life = -1;
  h.damage = 6;
  h.phase = 1;
  h.ownerId = owner;
  return addEntity(s, h);
}

// ---------------------------------------------------------------------------
// id 42 — toxar-outbreak
// ---------------------------------------------------------------------------

describe('id 42 toxar-outbreak — 정화가 절반만 · 오염 위 탄이 커진다 · 오염 위 이중 드랍', () => {
  it('음성 대조: 안 실으면 정화 간격 배수가 1 이고 아군탄 반경이 안 커진다', () => {
    const s = world(7);
    expect(toxarPurifyIntervalMult(s)).toBe(1);
    plantCell(s, 0, 0, 999);
    const b = blankEntity('bullet');
    b.x = 0;
    b.y = 0;
    b.radius = 6;
    addEntity(s, b);
    toxarOnTick(s, player(s));
    expect(b.radius).toBe(6);
  });

  it('⭐ 정화 하한 0.5 가 계약이다 — 계수는 0.5 이고 간격 배수는 정확히 2(0 으로 안 내려간다)', () => {
    expect(TOXAR_PURIFY_FACTOR_MIN).toBe(0.5);
    expect(TOXAR_PURIFY_FACTOR).toBeGreaterThanOrEqual(TOXAR_PURIFY_FACTOR_MIN);
    const s = world(7, [CARD_TOXAR_OUTBREAK]);
    // 배수 = round(1/계수). 계수가 0 이면 Infinity 가 되는데, 하한 클램프가 그것을 막는다.
    expect(toxarPurifyIntervalMult(s)).toBe(2);
    expect(Number.isFinite(toxarPurifyIntervalMult(s))).toBe(true);
  });

  it('대가: 정화가 실제로 절반 속도로 걷힌다 — 같은 틱 수에 무촉매의 절반만 사라진다', () => {
    // 노드를 전부 죽인 뒤 셀을 심어 두면 정화만 남는다(확산은 dead 노드에서 안 일어난다).
    const setup = (cards?: number[]): WorldState => {
      const s = world(3, cards);
      for (const n of s.entities) {
        if (n.kind === 'destructible') n.dead = true;
      }
      const p = player(s);
      // ⚠️ 소유 노드를 **하나로 묶는다.** 정화는 판정 틱마다 **노드당 1셀**이라, 소유자가 서로
      // 다르면 한 판정에 전부 걷혀 간격 차이가 관측되지 않는다(첫 시도가 그렇게 8:8 로 붙었다).
      for (let i = 0; i < 8; i++) plantCell(s, p.x + 4000 + i * 400, p.y + 4000, 5000);
      return s;
    };
    const plain = setup();
    const card = setup([CARD_TOXAR_OUTBREAK]);
    const before = contaminationCellCount(plain);
    expect(contaminationCellCount(card)).toBe(before);
    for (let i = 0; i < 24; i++) {
      stepWorld(plain, idle);
      stepWorld(card, idle);
    }
    const purgedPlain = before - contaminationCellCount(plain);
    const purgedCard = before - contaminationCellCount(card);
    expect(purgedPlain).toBeGreaterThan(0);
    expect(purgedCard).toBeGreaterThan(0); // 0 이면 "되돌릴 수 없는 카운트다운" 이다 — 금지된 축
    expect(purgedCard).toBeLessThan(purgedPlain);
  });

  it('오염이 무한 확산해 런이 교착되지 않는다 — 노드가 죽으면 셀이 계속 줄어든다', () => {
    const s = world(5, [CARD_TOXAR_OUTBREAK]);
    for (const n of s.entities) if (n.kind === 'destructible') n.dead = true;
    const p = player(s);
    for (let i = 0; i < 6; i++) plantCell(s, p.x + 5000 + i * 400, p.y + 5000, 7000 + i);
    const start = contaminationCellCount(s);
    for (let i = 0; i < 400; i++) stepWorld(s, idle);
    expect(contaminationCellCount(s)).toBeLessThan(start);
  });

  it('이득: 오염 위 아군탄이 밟은 셀 수만큼 커진다(상한이 있다)', () => {
    const s = world(9, [CARD_TOXAR_OUTBREAK]);
    const p = player(s);
    plantCell(s, p.x, p.y, 111);
    plantCell(s, p.x, p.y, 112); // 두 셀이 겹친 자리 = 한 틱에 2칸 성장
    const one = blankEntity('bullet');
    one.x = p.x;
    one.y = p.y;
    one.radius = 6;
    addEntity(s, one);
    const off = blankEntity('bullet');
    off.x = p.x + 9000;
    off.y = p.y;
    off.radius = 6;
    addEntity(s, off);
    toxarOnTick(s, p);
    expect(one.radius).toBeGreaterThan(6);
    expect(off.radius).toBe(6); // 오염 밖은 안 커진다
    for (let i = 0; i < 200; i++) toxarOnTick(s, p);
    expect(one.radius).toBeLessThanOrEqual(36); // 상한
  });

  it('이득: 오염 위에서 죽은 적은 전리품 개수가 두 배 · 오염 밖은 중립', () => {
    const s = world(11, [CARD_TOXAR_OUTBREAK]);
    plantCell(s, 500, 500, 222);
    expect(toxarOnLootRoll(s, 500, 500, true).count).toBe(2);
    expect(toxarOnLootRoll(s, 90_000, 90_000, true).count).toBe(1);
  });

  it('RNG 스트림 불변 — 세 스트림이 한 칸도 안 밀린다', () => {
    const s = world(13, [CARD_TOXAR_OUTBREAK]);
    const p = player(s);
    plantCell(s, p.x, p.y, 333);
    const b = blankEntity('bullet');
    b.x = p.x;
    b.y = p.y;
    b.radius = 6;
    addEntity(s, b);
    const before = rngState(s);
    toxarOnTick(s, p);
    toxarOnLootRoll(s, p.x, p.y, true);
    expect(rngState(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// id 43 — toxar-blightspore
// ---------------------------------------------------------------------------

describe('id 43 toxar-blightspore — 포자 구름', () => {
  it('음성 대조: 안 실으면 처치해도 구름이 안 생기고 적 속도 배율이 중립 1 이다', () => {
    const s = world(17);
    toxarOnEnemyDeath(s, 100, 100, false);
    expect(s.entities.filter((e) => isCatalystHazard(e)).length).toBe(0);
    const e = plantEnemy(s, 100, 100);
    expect(toxarOnEnemyStep(s, e)).toBe(1);
  });

  it('처치 자리에 구름이 서고 **적 상태를 하나도 안 남긴다**(aux0 불변 — 마크 미사용)', () => {
    const s = world(19, [CARD_TOXAR_BLIGHTSPORE]);
    const e = plantEnemy(s, 100, 100);
    const aux0Before = e.aux0;
    toxarOnEnemyDeath(s, 100, 100, false);
    const clouds = s.entities.filter((h) => isCatalystHazardMarked(h, TOXAR_SPORE_MARK));
    expect(clouds.length).toBe(1);
    expect(e.aux0).toBe(aux0Before);
  });

  it('⭐ 효과가 실제로 난다 — 구름 수명이 2 이상이고 활성 창 안에서 적이 두 배로 빨라진다', () => {
    const s = world(21, [CARD_TOXAR_BLIGHTSPORE]);
    toxarOnEnemyDeath(s, 100, 100, false);
    const cloud = s.entities.find((h) => isCatalystHazardMarked(h, TOXAR_SPORE_MARK));
    if (cloud === undefined) throw new Error('구름 부재');
    // 단발 해저드가 `activeTicks = 1` 이면 한 번도 효과를 못 낸다(앞 레인 실측) — 최소 2.
    expect(cloud.life).toBeGreaterThanOrEqual(2);
    expect(cloud.phase).toBe(1); // continuous — 활성 창 내내 위치 질의가 성립한다
    const inside = plantEnemy(s, 100, 100);
    const outside = plantEnemy(s, 100_000, 100_000);
    expect(toxarOnEnemyStep(s, inside)).toBe(2);
    expect(toxarOnEnemyStep(s, outside)).toBe(1);
  });

  it('구름은 피해원이 아니다(damage 0) — 대가는 가속이지 장판 피해가 아니다', () => {
    const s = world(23, [CARD_TOXAR_BLIGHTSPORE]);
    toxarOnEnemyDeath(s, 0, 0, false);
    const cloud = s.entities.find((h) => isCatalystHazardMarked(h, TOXAR_SPORE_MARK));
    expect(cloud?.damage).toBe(0);
  });

  it('이득: 구름 안 처치는 전리품 두 배 · 밖은 중립', () => {
    const s = world(25, [CARD_TOXAR_BLIGHTSPORE]);
    toxarOnEnemyDeath(s, 0, 0, false);
    expect(toxarOnLootRoll(s, 0, 0, true).count).toBe(2);
    expect(toxarOnLootRoll(s, 90_000, 0, true).count).toBe(1);
  });

  it('동시 상한(12)을 넘으면 스폰만 생략되고 RNG 는 한 칸도 안 밀린다', () => {
    const s = world(27, [CARD_TOXAR_BLIGHTSPORE]);
    const before = rngState(s);
    for (let i = 0; i < 40; i++) toxarOnEnemyDeath(s, i * 500, 0, false);
    expect(s.entities.filter((h) => isCatalystHazard(h) && !h.dead).length).toBeLessThanOrEqual(12);
    expect(rngState(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// id 44 — toxar-blight-mother
// ---------------------------------------------------------------------------

describe('id 44 toxar-blight-mother — 4단째 페이즈', () => {
  it('음성 대조: 안 실으면 hp 0 인 보스가 그대로 죽는다(페이즈가 안 오른다)', () => {
    const s = world(31);
    const b = plantBoss(s, 100);
    b.hp = 0;
    b.dead = true;
    toxarOnEnemyDamaged(s, b, 100, undefined);
    expect(b.dead).toBe(true);
    expect(b.phase).toBe(0);
  });

  it('⭐ 첫 형태로 런이 안 끝난다 — 보스가 죽지 않고 4단째 페이즈로 일어선다', () => {
    const s = world(33, [CARD_TOXAR_BLIGHT_MOTHER]);
    const b = plantBoss(s, 1000);
    b.hp = -5;
    b.dead = true; // 호출부가 hp 감산 직후에 세우는 그 상태
    toxarOnEnemyDamaged(s, b, 200, undefined);
    expect(b.dead).toBe(false);
    expect(b.phase).toBe(TOXAR_MOTHER_PHASE);
    expect(b.hp).toBeGreaterThan(0);
    expect(b.timer).toBeGreaterThan(0); // 부풀어 터지며 일어서는 프리즈
  });

  it('⭐ `boss` kind 는 끝까지 하나뿐이다(죽였다 다시 만들지 않는다)', () => {
    const s = world(35, [CARD_TOXAR_BLIGHT_MOTHER]);
    const b = plantBoss(s, 1000);
    b.hp = 0;
    b.dead = true;
    toxarOnEnemyDamaged(s, b, 200, undefined);
    for (let i = 0; i < 30; i++) stepWorld(s, idle);
    expect(s.entities.filter((e) => e.kind === 'boss').length).toBe(1);
    expect(s.victory).toBe(false);
  });

  it('두 번째 형태는 한 번만 선다 — 다시 hp 0 이 되면 그대로 죽는다', () => {
    const s = world(37, [CARD_TOXAR_BLIGHT_MOTHER]);
    const b = plantBoss(s, 1000);
    b.hp = 0;
    b.dead = true;
    toxarOnEnemyDamaged(s, b, 200, undefined);
    b.hp = 0;
    b.dead = true;
    toxarOnEnemyDamaged(s, b, 200, undefined);
    expect(b.dead).toBe(true);
  });

  it('⭐ 잠금과 해제가 장부에 남는다 — 못 잡으면 첫 보상이 `missed` 로 사라지고, 잡으면 세 배 `earned`', () => {
    // (a) 못 잡은 경우 — 전환만 일어난 채 런이 끝난다.
    const lost = world(39, [CARD_TOXAR_BLIGHT_MOTHER]);
    const b1 = plantBoss(lost, 1000);
    b1.hp = 0;
    b1.dead = true;
    toxarOnEnemyDamaged(lost, b1, 200, undefined);
    expect(contribution(lost, CARD_TOXAR_BLIGHT_MOTHER).missed).toBe(1);
    expect(contribution(lost, CARD_TOXAR_BLIGHT_MOTHER).earned).toBe(0);

    // (b) 잡은 경우 — 두 번째 형태의 시체가 아직 배열에 있는 그 시점의 전리품 롤.
    const won = world(41, [CARD_TOXAR_BLIGHT_MOTHER]);
    const b2 = plantBoss(won, 1000);
    b2.hp = 0;
    b2.dead = true;
    toxarOnEnemyDamaged(won, b2, 200, undefined);
    b2.hp = 0;
    b2.dead = true;
    const roll = toxarOnLootRoll(won, b2.x, b2.y, false);
    expect(roll.rarity).toBeCloseTo(2.6, 6);
    expect(contribution(won, CARD_TOXAR_BLIGHT_MOTHER).earned).toBe(3);
    expect(contribution(won, CARD_TOXAR_BLIGHT_MOTHER).missed).toBe(1);
  });

  it('엘리트 드랍은 두 번째 형태 배율을 안 탄다(보스 확정 드랍 전용)', () => {
    const s = world(43, [CARD_TOXAR_BLIGHT_MOTHER]);
    const b = plantBoss(s, 1000);
    b.hp = 0;
    b.dead = true;
    toxarOnEnemyDamaged(s, b, 200, undefined);
    b.dead = true;
    expect(toxarOnLootRoll(s, 0, 0, true).rarity).toBe(1);
  });

  it('RNG 스트림 불변 · 오염 노드 수는 안 건드린다(모드 교체가 아니라 격화다)', () => {
    const s = world(45, [CARD_TOXAR_BLIGHT_MOTHER]);
    expect(s.entities.filter((e) => e.kind === 'destructible').length).toBe(
      CONTAMINATION_NODE_COUNT,
    );
    const b = plantBoss(s, 1000);
    b.hp = 0;
    b.dead = true;
    const before = rngState(s);
    toxarOnEnemyDamaged(s, b, 200, undefined);
    toxarOnLootRoll(s, 0, 0, false);
    expect(rngState(s)).toEqual(before);
  });
});

describe('톡사르 공통 — 무촉매 런 불변', () => {
  it('셋 다 안 실으면 오염 셀 판별·확산이 종전과 같다', () => {
    const plain = createWorld(51, contaminationConfig());
    const withOther = createWorld(51, contaminationConfig([1]));
    for (let i = 0; i < 60; i++) {
      stepWorld(plain, idle);
      stepWorld(withOther, idle);
    }
    expect(contaminationCellCount(withOther)).toBe(contaminationCellCount(plain));
    expect(plain.entities.filter((e) => isContaminationCell(e)).length).toBe(
      withOther.entities.filter((e) => isContaminationCell(e)).length,
    );
  });

  it('세 카드 어느 것도 `catalystMarks`(적 aux0) 를 쓰지 않는다', () => {
    const s = world(53, [CARD_TOXAR_OUTBREAK, CARD_TOXAR_BLIGHTSPORE]);
    const p = player(s);
    plantCell(s, p.x, p.y, 900);
    const e = plantEnemy(s, p.x, p.y);
    toxarOnEnemyDeath(s, p.x, p.y, false);
    toxarOnTick(s, p);
    toxarOnEnemyStep(s, e);
    expect(e.aux0).toBe(0);
  });
});

// 전 카드 공용 참조 — 실제 오염 무대에서 DEFAULT_CONFIG 가 아닌 정규 경로를 쓴다는 물증.
describe('배선 실도달', () => {
  it('오염 무대 정규 설정이 실제로 오염 모드다(DEFAULT_CONFIG 우회가 아니다)', () => {
    expect(DEFAULT_CONFIG.planetMode).not.toBe(PLANET_MODE.contamination);
    expect(contaminationConfig().planetMode).toBe(PLANET_MODE.contamination);
  });
});
