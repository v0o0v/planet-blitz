/**
 * **공명 12 배선 대조**(ADR-0052 §태그 & 공명).
 *
 * `tests/catalystResonance.test.ts` 는 **데이터 표**(`RESONANCES`·`resolveResonance`·상한)만
 * 본다 — 이 파일은 그 위에서 **거동**을 잰다: 어느 앵커에서 무엇이 일어나고, 이득과 대가가
 * 둘 다 관측되는가.
 *
 * ## 왜 대부분 `catalystHooks.ts` 의 앵커를 직접 부르는가
 * 공명은 **한 런에 하나**뿐이고 12종이 서로 배타라, 전 종을 `stepWorld` 로 몰아 재려면 종마다
 * 수백 틱을 굴려야 한다(웨이브 감독이 개입해 계측 대상이 아닌 적·전리품이 섞인다). 앵커를
 * 직접 부르면 ①**디스패처 팬아웃이 실제로 공명에 닿는지**가 같이 증명되고(그룹 모듈을 직접
 * 부르면 그 축이 안 증명된다) ②계측 대상만 무대에 남는다.
 *
 * 격자 질의가 필요한 넷(오폭·반사·덫·결실 강등)은 `stepCatalystHazards` 안에서 도는데, 그
 * 자리가 **격자 삽입 직후**라 테스트도 같은 전제를 만들어 준다({@link primeGrid}).
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { blankEntity, addEntity, spawnLoot } from '../src/sim/entities.js';
import {
  onTickCatalyst,
  onEnemyDeathCatalyst,
  onEnemyDamagedCatalyst,
  onEnemyStepCatalyst,
  onVolleyFiredCatalyst,
  onPlayerDamagedCatalyst,
  onBossDeathCatalyst,
  onLootRollCatalyst,
  stepCatalystHazards,
} from '../src/sim/catalystHooks.js';
import {
  activeResonance,
  emberDamageTakenMult,
  subsidenceActive,
  subsidenceRadius,
  SEALED_RARITY,
} from '../src/sim/catalyst/resonance.js';
import { readMark } from '../src/sim/catalystMarks.js';
import {
  BulwarkSlot,
  ErosionWeakSlot,
  PrecisionStrongSlot,
  PrecisionWeakSlot,
  readCatalystSlot,
  writeCatalystSlot,
} from '../src/sim/catalystSlots.js';
import { resolveResonance } from '../src/data/catalystResonance.js';
import { RARITY_BY_CODE } from '../src/items/types.js';
import { catalystDropsFromRun } from '../src/data/catalystDrops.js';

// ---------------------------------------------------------------------------
// 무대
// ---------------------------------------------------------------------------

/**
 * 공명 12종을 뜨게 하는 **최소 조합**. 값은 `src/data/catalysts.ts` 의 태그에서 도출했고
 * 아래 첫 절이 `resolveResonance` 로 그것을 다시 못 박는다 — 태그가 재조정되면 그 절이 먼저
 * 빨개져서 이 파일 전체가 조용히 무의미해지는 것을 막는다.
 */
const COMBO = {
  ember: [1, 4],
  reverberation: [1, 4, 7],
  attraction: [0, 6],
  crossfire: [0, 6, 16],
  whetting: [2, 7],
  deflection: [2, 7, 10],
  snare: [0, 2],
  fruition: [0, 2, 3],
  advance: [1, 3],
  settlement: [1, 3, 5],
  abrasion: [8, 12],
  subsidence: [8, 12, 16],
} as const;

/** 공명이 하나도 안 뜨는 3장(음성 대조). */
const NO_RESO = [0, 1, 13];

/** 무기 피해 0 — 자동 사격이 계측 대상을 대신 죽이면 안 된다. */
function world(cards: readonly number[] | undefined, planet = 0): WorldState {
  const cfg =
    cards === undefined
      ? { ...DEFAULT_CONFIG, planet }
      : { ...DEFAULT_CONFIG, planet, catalysts: [...cards] };
  const s = createWorld(0xca7a, cfg);
  s.weapon.damage = 0;
  return s;
}

function player(s: WorldState): Entity {
  const p = s.entities.find((e) => e.kind === 'player');
  if (p === undefined) throw new Error('no player');
  return p;
}

/** ⚠️ `enemyType` 기본값 `-1` 이면 `enemyDefFor` 가 `undefined` 라 이동도 앵커도 통째로 스킵된다. */
function enemy(s: WorldState, x: number, y: number, hp = 1_000_000, type = 0): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.radius = 32;
  e.hp = hp;
  e.maxHp = hp;
  e.enemyType = type;
  return addEntity(s, e);
}

function enemyBullet(s: WorldState, x: number, y: number, dmg = 10): Entity {
  const b = blankEntity('enemyBullet');
  b.x = x;
  b.y = y;
  b.radius = 12;
  b.damage = dmg;
  b.vx = 30;
  b.vy = 0;
  b.life = 300;
  return addEntity(s, b);
}

function playerBullet(s: WorldState, x: number, y: number, pierce = 4): Entity {
  const b = blankEntity('bullet');
  b.x = x;
  b.y = y;
  b.radius = 8;
  b.damage = 10;
  b.pierce = pierce;
  b.life = 300;
  return addEntity(s, b);
}

/**
 * `stepCatalystHazards` 가 서는 자리의 전제를 만든다 — **격자가 이번 틱 좌표로 완성**돼 있고
 * 아직 아무 hp 도 안 깎였다.
 */
function primeGrid(s: WorldState): void {
  s.grid.clear();
  for (const e of s.entities) if (!e.dead) s.grid.insert(e);
}

function rngState(s: WorldState): readonly [number, number, number] {
  return [s.dropRng.getState(), s.waveRng.getState(), s.powerupRng.getState()];
}

function lootEntities(s: WorldState): Entity[] {
  return s.entities.filter((e) => e.kind === 'loot' && !e.dead);
}

// ---------------------------------------------------------------------------
// ① 조합 표가 실제로 그 공명을 띄운다 (이 파일 전체의 전제)
// ---------------------------------------------------------------------------

describe('전제 — COMBO 표가 12종을 빠짐없이 띄운다', () => {
  it('각 조합이 그 슬러그의 공명을 정확히 하나 띄운다', () => {
    for (const [slug, ids] of Object.entries(COMBO)) {
      const r = resolveResonance(ids as readonly number[]);
      expect(r, `${slug} ← ${JSON.stringify(ids)}`).not.toBeNull();
      expect(r?.slug, `${slug} ← ${JSON.stringify(ids)}`).toBe(slug);
    }
  });

  it('12종이 전부 다르다(같은 조합이 두 칸을 차지하지 않는다)', () => {
    expect(new Set(Object.keys(COMBO)).size).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// ② 게이트 — 한 런에 하나 · 강 우선 · 흡수 · 음성 대조
// ---------------------------------------------------------------------------

describe('발동 판정 — 한 런에 정확히 하나', () => {
  it('공명이 안 뜨는 3장에서는 공명 모듈이 통째로 무연산이다(음성 대조)', () => {
    const s = world(NO_RESO);
    expect(activeResonance(s)).toBeNull();

    const before = rngState(s);
    const p = player(s);
    const speed0 = s.config.playerSpeed;
    const radius0 = p.radius;
    const e = enemy(s, 300, 0);
    const l = spawnLoot(s, 320, 0, 0x1234, 1);

    for (let i = 0; i < 200; i++) {
      s.tick = i;
      onTickCatalyst(s, p);
      primeGrid(s);
      stepCatalystHazards(s);
    }
    onEnemyDeathCatalyst(s, 300, 0, false);

    // 공명이 남길 수 있는 흔적 전부가 0 이다.
    expect(readMark(e, 'resoTicks')).toBe(0);
    expect(readMark(e, 'emberPushed')).toBe(0);
    expect(readCatalystSlot(s.catalystSlots, 20)).toBe(0);
    expect(readCatalystSlot(s.catalystSlots, 21)).toBe(0);
    expect(l.radius).toBe(44);
    expect(l.enemyType).toBe(1);
    expect(s.config.playerSpeed).toBe(speed0);
    expect(p.radius).toBe(radius0);
    expect(rngState(s)).toEqual(before);
  });

  it('강공명이 뜨면 같은 조합이 만족하는 약공명은 흡수된다', () => {
    // [0,2,28] = 수확 3장(강) + 정밀 2장(약). 강이 이긴다.
    const s = world([0, 2, 28]);
    const r = activeResonance(s);
    expect(r?.slug).toBe('fruition');
    expect(r?.tier).toBe('strong');
    // 흡수의 물증 — 정밀 약 '벼름'의 슬롯이 600틱을 굴려도 0 이다.
    const p = player(s);
    for (let i = 0; i < 700; i++) {
      s.tick = i;
      onTickCatalyst(s, p);
    }
    expect(readCatalystSlot(s.catalystSlots, PrecisionWeakSlot.NoHitTicks)).toBe(0);
    expect(readCatalystSlot(s.catalystSlots, PrecisionWeakSlot.PierceArmed)).toBe(0);
  });

  it('동급이면 태그 우선순위로 하나만 고른다(점화 > 수확)', () => {
    // [0,1,4] = 수확 2 · 점화 2 · 도박 1 · 밀도 1 → 점화가 이긴다.
    const s = world([0, 1, 4]);
    expect(activeResonance(s)?.slug).toBe('ember');
    // 수확 약 '덫'의 물증(전리품 잠금)이 나오지 않는다.
    const l = spawnLoot(s, 0, 0, 0x1, 1);
    enemy(s, 0, 0);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(l.radius).toBe(44);
  });

  it('발동 판정은 `resolveResonance` 와 항상 같다(두 곳이 갈리지 않는다)', () => {
    for (const ids of [...Object.values(COMBO), NO_RESO]) {
      const s = world(ids as readonly number[]);
      expect(activeResonance(s)).toBe(resolveResonance(ids as readonly number[]));
    }
  });
});

// ---------------------------------------------------------------------------
// ③ RNG 스트림 불변 — 공명 12종 전부
// ---------------------------------------------------------------------------

describe('RNG 규율 — 공명은 한 칸도 소비하지 않는다', () => {
  it('12종 전부: 전 앵커를 굴려도 dropRng·waveRng·powerupRng 가 그대로다', () => {
    for (const [slug, ids] of Object.entries(COMBO)) {
      const s = world(ids as readonly number[]);
      const p = player(s);
      // 무대: 적·적탄·아군탄·전리품·씨앗을 전부 깔아 모든 분기가 실제로 돈다.
      for (let i = 0; i < 20; i++) enemy(s, 100 + i * 30, 0, 50);
      enemyBullet(s, 120, 0);
      playerBullet(s, 130, 0);
      spawnLoot(s, 140, 0, 0xabc, 1);
      s.loot.push({ seed: 0x777, rarity: 1, planet: 0, stage: 1, elite: 1 });

      const before = rngState(s);
      for (let t = 0; t < 120; t++) {
        s.tick = t;
        onTickCatalyst(s, p);
        primeGrid(s);
        stepCatalystHazards(s);
        onVolleyFiredCatalyst(s, p);
        onEnemyDeathCatalyst(s, 150, 0, false);
        onLootRollCatalyst(s, 1, 1, 150, 0, true);
        onPlayerDamagedCatalyst(s, p, 1, false, 0);
      }
      onBossDeathCatalyst(s, 0, 0);
      expect(rngState(s), slug).toEqual(before);
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 점화 약 '불씨'
// ---------------------------------------------------------------------------

describe("점화 약 '불씨' — 밀어낸다 / 밀려난 적은 받는 피해가 준다", () => {
  it('이득: 처치 반경 안의 적이 바깥으로 밀린다', () => {
    const s = world(COMBO.ember);
    const e = enemy(s, 100, 0);
    onEnemyDeathCatalyst(s, 0, 0, false);
    expect(e.x).toBeGreaterThan(100);
  });

  it('대가: 밀려난 적은 받는 피해 배율이 1 미만이다', () => {
    const s = world(COMBO.ember);
    const e = enemy(s, 100, 0);
    expect(emberDamageTakenMult(e)).toBe(1);
    onEnemyDeathCatalyst(s, 0, 0, false);
    expect(readMark(e, 'emberPushed')).toBe(1);
    expect(emberDamageTakenMult(e)).toBeLessThan(1);
  });

  it('대가는 1초 뒤 풀린다 — 표식이 영구히 남으면 대가가 이득으로 뒤집힌다', () => {
    const s = world(COMBO.ember);
    const p = player(s);
    const e = enemy(s, 100, 0);
    onEnemyDeathCatalyst(s, 0, 0, false);
    for (let t = 1; t <= 61; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
    }
    expect(readMark(e, 'resoTicks')).toBe(0);
    expect(readMark(e, 'emberPushed')).toBe(0);
    expect(emberDamageTakenMult(e)).toBe(1);
  });

  it('무촉매·비적 개체는 항상 정확히 1 이다(피해 산식 비트 불변의 근거)', () => {
    const s = world(undefined);
    const e = enemy(s, 0, 0);
    expect(emberDamageTakenMult(e)).toBe(1);
    expect(emberDamageTakenMult(player(s))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 점화 강 '되울림'
// ---------------------------------------------------------------------------

describe("점화 강 '되울림' — 처치가 연쇄한다 / 마지막 하나가 너를 친다", () => {
  /** 사슬이 실제로 이어지도록 반경 안에 줄지어 세운다. */
  function chainStage(s: WorldState, n: number, hp: number): Entity[] {
    const out: Entity[] = [];
    for (let i = 0; i < n; i++) out.push(enemy(s, 200 + i * 200, 0, hp));
    return out;
  }

  it('이득: 전파가 사슬을 타고 이어진다', () => {
    const s = world(COMBO.reverberation);
    const line = chainStage(s, 6, 50);
    const origin = line[0] as Entity;
    origin.hp = 0;
    origin.dead = true;
    onEnemyDamagedCatalyst(s, origin, 100, undefined);
    for (const e of line.slice(1)) expect(e.dead, `x=${e.x}`).toBe(true);
  });

  it('연쇄로 죽은 적은 좀비가 아니다 — hp<=0 이면 `dead` 가 반드시 서 있다', () => {
    const s = world(COMBO.reverberation);
    const line = chainStage(s, 8, 50);
    const origin = line[0] as Entity;
    origin.hp = 0;
    origin.dead = true;
    onEnemyDamagedCatalyst(s, origin, 100, undefined);
    for (const e of s.entities) {
      if (e.kind !== 'enemy') continue;
      if (e.hp <= 0) expect(e.dead, `hp=${e.hp}`).toBe(true);
    }
  });

  it('사슬은 반드시 종료한다 — 400마리를 한 점에 겹쳐도 스택 오버플로가 없다', () => {
    const s = world(COMBO.reverberation);
    for (let i = 0; i < 400; i++) enemy(s, i % 7, i % 5, 1);
    const origin = enemy(s, 0, 0, 1);
    origin.hp = 0;
    origin.dead = true;
    expect(() => onEnemyDamagedCatalyst(s, origin, 999, undefined)).not.toThrow();
    // 방문 집합이 각 개체를 한 번만 전파원으로 쓰므로 유한 단계에 끝난다.
    const alive = s.entities.filter((e) => e.kind === 'enemy' && !e.dead).length;
    expect(alive).toBe(0);
  });

  it('대가: 사슬의 마지막 하나가 플레이어를 실제로 친다', () => {
    const s = world(COMBO.reverberation);
    const p = player(s);
    const hp0 = p.hp;
    const line = chainStage(s, 4, 50);
    const origin = line[0] as Entity;
    origin.hp = 0;
    origin.dead = true;
    onEnemyDamagedCatalyst(s, origin, 100, undefined);
    expect(p.hp).toBeLessThan(hp0);
    // 자해는 `CATALYST_FX.selfHarm`(=1) 로 통지된다 — 적 피해와 색·소리가 갈린다.
    expect(s.catalystFx?.some((f) => f.kind === 1)).toBe(true);
  });

  it('전파가 하나도 없으면 자해도 없다(대가가 이득 없이 나가지 않는다)', () => {
    const s = world(COMBO.reverberation);
    const p = player(s);
    const hp0 = p.hp;
    const origin = enemy(s, 0, 0, 1);
    origin.hp = 0;
    origin.dead = true;
    onEnemyDamagedCatalyst(s, origin, 100, undefined);
    expect(p.hp).toBe(hp0);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 밀도 약 '인력'
// ---------------------------------------------------------------------------

describe("밀도 약 '인력' — 같은 종류끼리 끌린다 / 뭉치면 단단해진다", () => {
  function crowd(s: WorldState, n: number): Entity[] {
    const out: Entity[] = [];
    for (let i = 0; i < n; i++) out.push(enemy(s, 200 + i * 40, 0, 1000, 0));
    return out;
  }

  it('이득: 적 15 이상이면 같은 종류가 서로 가까워진다', () => {
    const s = world(COMBO.attraction);
    const p = player(s);
    const es = crowd(s, 16);
    const first = es[0] as Entity;
    const x0 = first.x;
    for (let t = 0; t < 10; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
    }
    expect(first.x).toBeGreaterThan(x0); // 무리의 무게중심 쪽으로 당겨졌다.
  });

  it('15 미만이면 발동하지 않는다(조건이 실제로 걸린다)', () => {
    const s = world(COMBO.attraction);
    const p = player(s);
    const es = crowd(s, 5);
    const first = es[0] as Entity;
    const x0 = first.x;
    for (let t = 0; t < 10; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
    }
    expect(first.x).toBe(x0);
  });

  it('대가: 뭉친 적은 피격 뒤 hp 일부를 되돌려받는다(= 단단해진다)', () => {
    const s = world(COMBO.attraction);
    const t0 = enemy(s, 0, 0, 1000, 0);
    enemy(s, 60, 0, 1000, 0);
    enemy(s, -60, 0, 1000, 0);
    t0.hp = 900; // 100 을 맞은 직후
    onEnemyDamagedCatalyst(s, t0, 100, undefined);
    expect(t0.hp).toBeGreaterThan(900);
    expect(t0.hp).toBeLessThanOrEqual(t0.maxHp);
  });

  it('죽은 적은 절대 되살리지 않는다(좀비 금지)', () => {
    const s = world(COMBO.attraction);
    const t0 = enemy(s, 0, 0, 1000, 0);
    enemy(s, 60, 0, 1000, 0);
    enemy(s, -60, 0, 1000, 0);
    t0.hp = 0;
    t0.dead = true;
    onEnemyDamagedCatalyst(s, t0, 100, undefined);
    expect(t0.hp).toBe(0);
    expect(t0.dead).toBe(true);
  });

  it('혼자면 단단해지지 않는다(대가가 조건 없이 나가지 않는다)', () => {
    const s = world(COMBO.attraction);
    const t0 = enemy(s, 0, 0, 1000, 0);
    t0.hp = 900;
    onEnemyDamagedCatalyst(s, t0, 100, undefined);
    expect(t0.hp).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// ⑦ 밀도 강 '오폭'
// ---------------------------------------------------------------------------

describe("밀도 강 '오폭' — 적탄이 적에게 맞는다 / 네 탄은 첫 적에서 멎는다", () => {
  it('이득: 적탄이 겹친 적의 hp 를 깎고 탄이 소멸한다', () => {
    const s = world(COMBO.crossfire);
    const e = enemy(s, 500, 0, 100);
    const b = enemyBullet(s, 500, 0, 40);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(e.hp).toBe(60);
    expect(b.dead).toBe(true);
  });

  it('오폭으로 죽은 적은 좀비가 아니다', () => {
    const s = world(COMBO.crossfire);
    const e = enemy(s, 500, 0, 10);
    enemyBullet(s, 500, 0, 40);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(e.dead).toBe(true);
  });

  it('대가: 아군탄의 관통이 0 이 된다', () => {
    const s = world(COMBO.crossfire);
    const b = playerBullet(s, 100, 0, 5);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(b.pierce).toBe(0);
  });

  it('공명이 없으면 둘 다 안 일어난다', () => {
    const s = world(NO_RESO);
    const e = enemy(s, 500, 0, 100);
    const b = playerBullet(s, 100, 0, 5);
    enemyBullet(s, 500, 0, 40);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(e.hp).toBe(100);
    expect(b.pierce).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// ⑧ 정밀 약 '벼름'
// ---------------------------------------------------------------------------

describe("정밀 약 '벼름' — 무피격 10초마다 관통 한 발 / 직후 3초 발사 감속", () => {
  it('이득: 600틱 무피격이면 관통이 장전되고 다음 볼리가 관통탄이 된다', () => {
    const s = world(COMBO.whetting);
    const p = player(s);
    for (let t = 0; t < 600; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
    }
    expect(readCatalystSlot(s.catalystSlots, PrecisionWeakSlot.PierceArmed)).toBe(1);
    const b = playerBullet(s, 0, 0, 0);
    onVolleyFiredCatalyst(s, p);
    expect(b.pierce).toBeGreaterThan(0);
  });

  it('대가: 그 한 발 직후 발사 쿨다운이 3초 동안 계속 밀린다', () => {
    const s = world(COMBO.whetting);
    const p = player(s);
    for (let t = 0; t < 600; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
    }
    playerBullet(s, 0, 0, 0);
    onVolleyFiredCatalyst(s, p);
    const cd0 = p.cooldown;
    for (let t = 600; t < 700; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
    }
    expect(p.cooldown).toBeGreaterThan(cd0);
  });

  it('감속 창이 끝나면 슬롯이 0 으로 돌아간다(영구 감속이 아니다)', () => {
    const s = world(COMBO.whetting);
    const p = player(s);
    for (let t = 0; t < 600; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
    }
    playerBullet(s, 0, 0, 0);
    onVolleyFiredCatalyst(s, p);
    for (let t = 600; t < 800; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
    }
    expect(readCatalystSlot(s.catalystSlots, PrecisionWeakSlot.PierceArmed)).toBe(0);
  });

  it('피격하면 무피격 누적이 0 으로 돌아간다(조건이 실제로 걸린다)', () => {
    const s = world(COMBO.whetting);
    const p = player(s);
    for (let t = 0; t < 300; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
    }
    expect(readCatalystSlot(s.catalystSlots, PrecisionWeakSlot.NoHitTicks)).toBeGreaterThan(0);
    onPlayerDamagedCatalyst(s, p, 10, false, 0);
    expect(readCatalystSlot(s.catalystSlots, PrecisionWeakSlot.NoHitTicks)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑨ 정밀 강 '반사'
// ---------------------------------------------------------------------------

describe("정밀 강 '반사' — 일부가 튕긴다 / 안 튕긴 탄은 두 배", () => {
  it('이득: 셋에 하나가 되튕기고, 되튕긴 탄이 적을 맞힌다', () => {
    const s = world(COMBO.deflection);
    const bs = [enemyBullet(s, 1000, 0), enemyBullet(s, 2000, 0), enemyBullet(s, 3000, 0)];
    primeGrid(s);
    stepCatalystHazards(s);
    const reflected = bs.filter((b) => b.vx < 0);
    expect(reflected).toHaveLength(1);

    // 반사탄이 적에게 실제로 피해를 준다.
    const s2 = world(COMBO.deflection);
    writeCatalystSlot(s2.catalystSlots, PrecisionStrongSlot.ReflectState, 2); // 다음 탄이 반사분
    const e = enemy(s2, 500, 0, 100);
    enemyBullet(s2, 500, 0, 30);
    primeGrid(s2);
    stepCatalystHazards(s2);
    expect(e.hp).toBe(70);
  });

  it('대가: 안 튕긴 탄은 피해가 두 배가 되고, 매 틱 다시 두 배가 되지 않는다', () => {
    const s = world(COMBO.deflection);
    const b = enemyBullet(s, 1000, 0, 10);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(b.damage).toBe(20);
    for (let t = 0; t < 5; t++) {
      primeGrid(s);
      stepCatalystHazards(s);
    }
    expect(b.damage).toBe(20); // 지수 폭주 없음 — 적탄 `aux0` 표식이 막는다.
  });

  it('⚠️ 방벽 우선 — `id 28` 방벽이 서 있는 동안은 한 발도 반사되지 않는다', () => {
    const s = world(COMBO.deflection);
    writeCatalystSlot(s.catalystSlots, BulwarkSlot.Ticks, 30);
    const bs = [enemyBullet(s, 1000, 0), enemyBullet(s, 2000, 0), enemyBullet(s, 3000, 0)];
    primeGrid(s);
    stepCatalystHazards(s);
    expect(bs.every((b) => b.vx > 0)).toBe(true);
    expect(bs.every((b) => b.aux0 === 0)).toBe(true);
  });

  it('방벽 슬롯이 아직 안 서 있으면(0) 반사는 평소대로 돈다', () => {
    const s = world(COMBO.deflection);
    expect(readCatalystSlot(s.catalystSlots, BulwarkSlot.Ticks)).toBe(0);
    const bs = [enemyBullet(s, 1000, 0), enemyBullet(s, 2000, 0), enemyBullet(s, 3000, 0)];
    primeGrid(s);
    stepCatalystHazards(s);
    expect(bs.some((b) => b.vx < 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑩ 수확 약 '덫'
// ---------------------------------------------------------------------------

describe("수확 약 '덫' — 밟은 적이 붙잡힌다 / 그동안 회수 불가", () => {
  it('이득: 전리품을 밟은 적은 이동 배율이 0 이 된다', () => {
    const s = world(COMBO.snare);
    const l = spawnLoot(s, 500, 0, 0x1, 1);
    const e = enemy(s, 500, 0);
    expect(onEnemyStepCatalyst(s, e, 1)).toBe(1);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(readMark(e, 'resoTicks')).toBeGreaterThan(0);
    expect(onEnemyStepCatalyst(s, e, 1)).toBe(0);
    void l;
  });

  it('대가: 붙잡힌 동안 그 전리품은 픽업 반경이 0 이라 회수할 수 없다', () => {
    const s = world(COMBO.snare);
    const l = spawnLoot(s, 500, 0, 0x1, 1);
    enemy(s, 500, 0);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(l.radius).toBe(0);
  });

  it('⚠️ 회수는 **억제**가 아니다 — 전리품이 사라지지 않는다(영구 소멸 금지)', () => {
    const s = world(COMBO.snare);
    const l = spawnLoot(s, 500, 0, 0x1, 1);
    enemy(s, 500, 0);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(l.dead).toBe(false);
    expect(s.loot).toHaveLength(0);
  });

  it('적이 물러나고 1초가 지나면 잠금이 풀린다', () => {
    const s = world(COMBO.snare);
    const p = player(s);
    const l = spawnLoot(s, 500, 0, 0x1, 1);
    const e = enemy(s, 500, 0);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(l.radius).toBe(0);
    e.x = 5000; // 물러난다
    for (let t = 1; t <= 70; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
      primeGrid(s);
      stepCatalystHazards(s);
    }
    expect(readMark(e, 'resoTicks')).toBe(0);
    expect(l.radius).toBe(44);
  });
});

// ---------------------------------------------------------------------------
// ⑪ 수확 강 '결실'
// ---------------------------------------------------------------------------

describe("수확 강 '결실' — 위에서 죽으면 등급이 오른다 / 밟히면 내려간다", () => {
  it('이득: 전리품 위에서 죽은 적이 그 전리품의 등급을 올린다', () => {
    const s = world(COMBO.fruition);
    const l = spawnLoot(s, 100, 0, 0x1, 1);
    onEnemyDeathCatalyst(s, 100, 0, false);
    expect(l.enemyType).toBe(2);
  });

  it('최고 등급을 넘지 않는다', () => {
    const s = world(COMBO.fruition);
    const l = spawnLoot(s, 100, 0, 0x1, 3);
    onEnemyDeathCatalyst(s, 100, 0, false);
    expect(l.enemyType).toBe(3);
  });

  it('대가: 적이 전리품을 밟으면 등급이 내려간다', () => {
    const s = world(COMBO.fruition);
    const l = spawnLoot(s, 500, 0, 0x1, 2);
    enemy(s, 500, 0);
    primeGrid(s);
    stepCatalystHazards(s);
    expect(l.enemyType).toBe(1);
  });

  it('같은 전리품이 매 틱 강등되지 않는다(냉각이 실제로 걸린다)', () => {
    const s = world(COMBO.fruition);
    const l = spawnLoot(s, 500, 0, 0x1, 3);
    enemy(s, 500, 0);
    for (let t = 0; t < 30; t++) {
      s.tick = t;
      primeGrid(s);
      stepCatalystHazards(s);
    }
    expect(l.enemyType).toBe(2);
  });

  it('0 등급 밑으로는 안 내려간다', () => {
    const s = world(COMBO.fruition);
    const l = spawnLoot(s, 500, 0, 0x1, 0);
    enemy(s, 500, 0);
    for (let t = 0; t < 600; t++) {
      s.tick = t;
      primeGrid(s);
      stepCatalystHazards(s);
    }
    expect(l.enemyType).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑫ 도박 약 '선불'
// ---------------------------------------------------------------------------

describe("도박 약 '선불' — 런 시작에 하나 받는다 / 가지러 가야 한다", () => {
  it('이득: 0틱에 바닥 전리품 하나가 생긴다', () => {
    const s = world(COMBO.advance);
    const p = player(s);
    expect(lootEntities(s)).toHaveLength(0);
    s.tick = 0;
    onTickCatalyst(s, p);
    expect(lootEntities(s)).toHaveLength(1);
  });

  it('한 번만 준다(매 틱 쏟아지지 않는다)', () => {
    const s = world(COMBO.advance);
    const p = player(s);
    for (let t = 0; t < 300; t++) {
      s.tick = t;
      onTickCatalyst(s, p);
    }
    expect(lootEntities(s)).toHaveLength(1);
  });

  it('대가: 발밑이 아니라 떨어진 곳에 떨어진다 — 가지러 가는 위험이 대가다', () => {
    const s = world(COMBO.advance);
    const p = player(s);
    s.tick = 0;
    onTickCatalyst(s, p);
    const l = lootEntities(s)[0] as Entity;
    const d = Math.hypot(l.x - p.x, l.y - p.y);
    expect(d).toBeGreaterThan(500);
  });

  it('대가: 회수 전에는 정산 전리품이 아니다(줍기 전엔 `state.loot` 에 없다)', () => {
    const s = world(COMBO.advance);
    const p = player(s);
    s.tick = 0;
    onTickCatalyst(s, p);
    expect(s.loot).toHaveLength(0);
  });

  it('시드는 RNG 미소비 파생이다 — 스트림이 밀리지 않는다', () => {
    const s = world(COMBO.advance);
    const p = player(s);
    const before = rngState(s);
    s.tick = 0;
    onTickCatalyst(s, p);
    expect(rngState(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// ⑬ 도박 강 '청산'
// ---------------------------------------------------------------------------

describe("도박 강 '청산' — 첫 전리품이 봉인된다 / 보스를 잡으면 열린다", () => {
  function sealed(): WorldState {
    const s = world(COMBO.settlement);
    const p = player(s);
    s.loot.push({ seed: 0xfeed, rarity: 2, planet: 0, stage: 1, elite: 1 });
    onTickCatalyst(s, p);
    return s;
  }

  it('대가: 첫 전리품의 등급이 봉인 예약값으로 바뀐다', () => {
    const s = sealed();
    expect(s.loot[0]?.rarity).toBe(SEALED_RARITY);
  });

  it('첫 하나만 봉인한다(둘째부터는 그대로)', () => {
    const s = sealed();
    const p = player(s);
    s.loot.push({ seed: 0xbeef, rarity: 1, planet: 0, stage: 1, elite: 1 });
    onTickCatalyst(s, p);
    expect(s.loot[0]?.rarity).toBe(SEALED_RARITY);
    expect(s.loot[1]?.rarity).toBe(1);
  });

  it('이득: 보스를 처치하면 최고 등급으로 열린다', () => {
    const s = sealed();
    expect(onBossDeathCatalyst(s, 0, 0)).toBe(false); // 보스 드랍을 억제하지 않는다
    expect(s.loot[0]?.rarity).toBe(3);
  });

  it('⚠️ 봉인값이 `items/roll.ts` 축에서 **등급으로 오독되지 않는다**', () => {
    // `RARITY_BY_CODE` 는 0..3 뿐이라 예약값은 어느 등급도 아니다 —
    // `rollItem` 은 문자열 등급을 받으므로 코드가 등급으로 새어 들어갈 경로가 없다.
    expect(RARITY_BY_CODE[SEALED_RARITY]).toBeUndefined();
    expect(SEALED_RARITY).toBeGreaterThan(RARITY_BY_CODE.length - 1);
  });

  it('⚠️ 봉인값이 `resultOverlay` 축에서 등급으로 오독되지 않는다', () => {
    // 정산이 `RARITY_BY_CODE[rec.rarity] ?? 'normal'` 로 문자열을 만들고 오버레이는 그 문자열만
    // 본다. 예약값은 표에 없으므로 **최저 등급으로 접힐 뿐** 높은 등급으로 새지 않는다.
    const shown = RARITY_BY_CODE[SEALED_RARITY] ?? 'normal';
    expect(shown).toBe('normal');
    expect(shown).not.toBe('unique');
  });

  it('⚠️ `catalystDropsFromRun` 은 `seed` 만 본다 — 봉인분도 같은 촉매 게이트를 굴린다', () => {
    // 같은 시드 · **다른 등급 칸**(봉인 예약값 vs 평범한 등급)으로 실제 `LootRecord` 를 넘긴다.
    const plain = [
      { seed: 0xfeed, rarity: 2, planet: 0, stage: 1 },
      { seed: 0x1234, rarity: 0, planet: 0, stage: 1 },
    ];
    const sealedRecs = [
      { seed: 0xfeed, rarity: SEALED_RARITY, planet: 0, stage: 1 },
      { seed: 0x1234, rarity: SEALED_RARITY, planet: 0, stage: 1 },
    ];
    const base = catalystDropsFromRun({ planet: 0, catalysts: [...COMBO.settlement], loot:plain });
    const sealedRun = catalystDropsFromRun({ planet: 0, catalysts: [...COMBO.settlement], loot:sealedRecs });
    // 등급 칸이 무엇이든 결과가 같다 = 오독 경로가 없다(seed 만 본다).
    expect(sealedRun).toEqual(base);
  });

  it('공명이 없으면 아무것도 봉인되지 않는다', () => {
    const s = world(NO_RESO);
    const p = player(s);
    s.loot.push({ seed: 0xfeed, rarity: 2, planet: 0, stage: 1, elite: 1 });
    onTickCatalyst(s, p);
    expect(s.loot[0]?.rarity).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ⑭ 침식 약 '마모'
// ---------------------------------------------------------------------------

describe("침식 약 '마모' — 30초마다 빨라진다 / 판정점이 커진다", () => {
  it('이득과 대가가 함께 온다 — 속도가 오르고 피격 반경도 커진다', () => {
    const s = world(COMBO.abrasion);
    const p = player(s);
    const speed0 = s.config.playerSpeed;
    const radius0 = p.radius;
    s.wave.segmentElapsed = 1800;
    onTickCatalyst(s, p);
    expect(s.config.playerSpeed).toBeGreaterThan(speed0);
    expect(p.radius).toBeGreaterThan(radius0);
  });

  it('웨이브 전환에 정확히 되돌아온다(단조 증가 페널티가 아니다)', () => {
    const s = world(COMBO.abrasion);
    const p = player(s);
    const speed0 = s.config.playerSpeed;
    const radius0 = p.radius;
    for (const el of [1800, 3600, 5400]) {
      s.wave.segmentElapsed = el;
      onTickCatalyst(s, p);
    }
    expect(readCatalystSlot(s.catalystSlots, ErosionWeakSlot.Step)).toBe(3);
    s.wave.segmentElapsed = 0; // 세그먼트 전환
    onTickCatalyst(s, p);
    expect(readCatalystSlot(s.catalystSlots, ErosionWeakSlot.Step)).toBe(0);
    expect(s.config.playerSpeed).toBeCloseTo(speed0, 6);
    expect(p.radius).toBeCloseTo(radius0, 6);
  });

  it('단계에 천장이 있다(무한히 커지지 않는다)', () => {
    const s = world(COMBO.abrasion);
    const p = player(s);
    s.wave.segmentElapsed = 1800 * 50;
    onTickCatalyst(s, p);
    expect(readCatalystSlot(s.catalystSlots, ErosionWeakSlot.Step)).toBeLessThanOrEqual(6);
  });

  it('공명이 없으면 두 필드를 한 번도 안 만진다', () => {
    const s = world(NO_RESO);
    const p = player(s);
    const speed0 = s.config.playerSpeed;
    const radius0 = p.radius;
    s.wave.segmentElapsed = 1800 * 5;
    onTickCatalyst(s, p);
    expect(s.config.playerSpeed).toBe(speed0);
    expect(p.radius).toBe(radius0);
  });
});

// ---------------------------------------------------------------------------
// ⑮ 침식 강 '함몰'
// ---------------------------------------------------------------------------

describe("침식 강 '함몰' — 가장자리가 무너진다 / 격전 통과 시 절반 복구", () => {
  it('⚠️ 베르단(planet 1)에서는 발동하지 않는다 — 안전 원과 이중 수축', () => {
    const s = world(COMBO.subsidence, 1);
    expect(activeResonance(s)?.slug).toBe('subsidence');
    expect(subsidenceActive(s)).toBe(false);
    const p = player(s);
    p.x = 99_999;
    s.tick = 1800 * 10;
    onTickCatalyst(s, p);
    expect(p.x).toBe(99_999); // 되밀기가 한 번도 안 걸린다
  });

  it('⚠️ 니플헤임(planet 2)에서도 발동하지 않는다 — 대피소 전량 확보가 도달 불가가 된다', () => {
    const s = world(COMBO.subsidence, 2);
    expect(activeResonance(s)?.slug).toBe('subsidence');
    expect(subsidenceActive(s)).toBe(false);
    const p = player(s);
    p.x = 99_999;
    s.tick = 1800 * 10;
    onTickCatalyst(s, p);
    expect(p.x).toBe(99_999);
  });

  it('다른 행성에서는 발동한다', () => {
    for (const planet of [0, 3, 4, 5]) {
      const s = world(COMBO.subsidence, planet);
      expect(subsidenceActive(s), `planet ${planet}`).toBe(true);
    }
  });

  it('대가: 시간이 갈수록 반경이 줄고, 밖에 있으면 안으로 되밀린다', () => {
    const s = world(COMBO.subsidence, 0);
    const p = player(s);
    s.tick = 0;
    const r0 = subsidenceRadius(s);
    s.tick = 1800 * 4;
    const r1 = subsidenceRadius(s);
    expect(r1).toBeLessThan(r0);

    p.x = r1 + 3000;
    p.y = 0;
    onTickCatalyst(s, p);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(r1, 3);
  });

  it('안에 있으면 한 칸도 안 움직인다(입력을 씹지 않는다)', () => {
    const s = world(COMBO.subsidence, 0);
    const p = player(s);
    s.tick = 1800 * 4;
    p.x = 100;
    p.y = 0;
    onTickCatalyst(s, p);
    expect(p.x).toBe(100);
  });

  it('반경이 0 으로 수렴하지 않는다 — 진행 교착 금지', () => {
    const s = world(COMBO.subsidence, 0);
    s.tick = 1800 * 1000;
    expect(subsidenceRadius(s)).toBeGreaterThanOrEqual(2200);
  });

  it('이득: 중반 격전을 통과하면 줄어든 만큼의 절반이 돌아온다', () => {
    const s = world(COMBO.subsidence, 0);
    s.tick = 1800 * 6;
    s.wave.segmentIndex = 3; // 격전 세그먼트 자체 — 아직 통과 전
    const before = subsidenceRadius(s);
    s.wave.segmentIndex = 4; // 통과
    const after = subsidenceRadius(s);
    expect(after).toBeGreaterThan(before);
  });

  it('이득: 좁아진 만큼 드랍 밀도가 오른다', () => {
    const s = world(COMBO.subsidence, 0);
    s.tick = 0;
    const at0 = onLootRollCatalyst(s, 1, 1, 0, 0, true).count;
    s.tick = 1800 * 3;
    const at3 = onLootRollCatalyst(s, 1, 1, 0, 0, true).count;
    expect(at3).toBeGreaterThan(at0);
  });

  it('⚠️ 무너지는 자리의 씨앗·나무는 사라지기 전에 열매를 전부 떨군다', () => {
    const s = world(COMBO.subsidence, 0);
    const p = player(s);
    s.tick = 1800 * 4;
    const r = subsidenceRadius(s);
    const tree = blankEntity('destructible');
    tree.x = r + 2000;
    tree.y = 0;
    tree.radius = 40;
    tree.hp = 10;
    tree.ownerId = 0xc0de24; // CATALYST_TREE_MARK
    tree.pierce = 3; // 남은 열매 수
    addEntity(s, tree);

    onTickCatalyst(s, p);
    expect(tree.dead).toBe(true);
    expect(tree.pierce).toBe(0);
    expect(lootEntities(s).filter((l) => l.x === tree.x)).toHaveLength(3);
  });

  it('반경 안의 씨앗·나무는 건드리지 않는다', () => {
    const s = world(COMBO.subsidence, 0);
    const p = player(s);
    s.tick = 1800 * 4;
    const tree = blankEntity('destructible');
    tree.x = 100;
    tree.y = 0;
    tree.radius = 40;
    tree.hp = 10;
    tree.ownerId = 0xc0de24;
    tree.pierce = 3;
    addEntity(s, tree);
    onTickCatalyst(s, p);
    expect(tree.dead).toBe(false);
    expect(tree.pierce).toBe(3);
  });

  it('베르단·니플헤임에서는 드랍 밀도도 안 오른다(게이트가 한 곳이다)', () => {
    for (const planet of [1, 2]) {
      const s = world(COMBO.subsidence, planet);
      s.tick = 1800 * 5;
      expect(onLootRollCatalyst(s, 1, 1, 0, 0, true).count, `planet ${planet}`).toBe(1);
    }
  });
});
