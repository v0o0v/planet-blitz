/**
 * 베르단 특산 촉매 배선 — **`id 33 berdan-collapse` · `id 34 berdan-royal-jelly` ·
 * `id 35 berdan-hive-queen`**(ADR-0052).
 *
 * ## ⭐⭐ 이 레인의 핵심은 §1-3 하나다 — **세그먼트 자동 전진**
 * 수축은 여섯 무대 중 유일하게 **적 자체가 진행 게이트**다. `id 33` 은 즉사 창마다 안전 원을
 * 비우므로, 잠금이 없으면 **15초마다 세그먼트가 공짜로 넘어간다**. 중심을 넷 다 인자화해도
 * 이 결함은 안 사라진다(원이 어디에 있든 즉사가 그 원을 비운다). 그래서 §1-3 은 잠금이 실제로
 * 서는지와, 잠금이 **모드를 망가뜨리지 않는지**(창 밖에서는 정상 전진) 둘 다 잰다.
 *
 * ## ⚠️ 안전선 넷
 *  1. **음성 대조** — 안 실으면 무촉매와 거동이 같다(중심 `0` · 잠금 `false`).
 *  2. **이득과 대가가 둘 다 관측된다**.
 *  3. **`boss` kind 는 끝까지 하나** — 늘리면 그 하나가 죽는 순간 런이 끝난다.
 *  4. **RNG 스트림 불변** — 촉매 코드는 한 칸도 소비하지 않는다.
 */

import { describe, it, expect } from 'vitest';

import { createWorld, stepWorld, emptyInput, packPowerupPick } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { blankEntity, addEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { SEGMENTS } from '../data/waves.js';
import {
  shrinkRingCleared,
  shrinkOutOfBounds,
  SHRINK_GRACE_TICKS,
  type ShrinkRuntime,
} from '../src/sim/modes/shrink.js';
import { isCatalystHazard } from '../src/sim/catalyst/shared.js';
import { CATALYST_FX } from '../src/sim/catalyst/fx.js';
import {
  berdanOnTick,
  berdanOnEnemyStep,
  berdanOnEnemyDamaged,
  berdanOnEnemyDeath,
  berdanOnLootRoll,
  berdanSafeCenterX,
  berdanSafeCenterY,
  berdanCollapseLocked,
  isHiveWorker,
  liveHiveWorkers,
  onRoyalJelly,
  BERDAN_JUMP_TICKS,
  JELLY_MARK,
  HIVE_HP_PER_WORKER,
  HIVE_LIVE_CAP,
} from '../src/sim/catalyst/berdan.js';

const idle: InputFrame = emptyInput();
/** 런이 접촉·밖 피해로 조기 종료되지 않게 버티는 무대 HP(shrinkMode.test.ts 선례). */
const DURABLE_HP = 100_000_000;

const COLLAPSE = 33;
const ROYAL_JELLY = 34;
const HIVE_QUEEN = 35;
/** 이 레인이 배선하지 않은 카드 — 음성 대조의 "다른 촉매" 축. */
const UNRELATED = 1;

/** 정규경로 full-path: 베르단(planet 1) = shrink 라 브릿지 없이 실도달한다. */
function berdanConfig(catalysts?: number[]): WorldConfig {
  const base = { ...buildRunConfig(defaultProfile(), { planet: 1, stage: 1 }), playerHp: DURABLE_HP };
  return catalysts === undefined ? base : { ...base, catalysts };
}

function berdanWorld(catalysts?: number[], seed = 0x5171): WorldState {
  return createWorld(seed, berdanConfig(catalysts));
}

function player(s: WorldState): Entity {
  const p = s.entities[0];
  if (p === undefined || p.kind !== 'player') throw new Error('player missing');
  return p;
}

/** 한 틱 진행하되 레벨업 프리즈를 자동 해소한다(shrinkMode.test.ts 선례). */
function step(s: WorldState): void {
  stepWorld(s, s.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : idle);
}

/**
 * 적 하나를 심는다. ⚠️ `enemyType` 을 반드시 세운다 — `blankEntity` 기본값 `-1` 이면
 * `enemyDefFor` 가 `undefined` 라 이동 단계도 앵커도 조용히 건너뛴다(앞 레인 실측).
 */
function seedEnemy(s: WorldState, x: number, y: number, hp = 100): Entity {
  const e = blankEntity('enemy');
  e.x = x;
  e.y = y;
  e.enemyType = 0;
  e.hp = hp;
  e.maxHp = hp;
  e.radius = 32;
  return addEntity(s, e);
}

function seedBoss(s: WorldState, x: number, y: number, hp = 5000): Entity {
  const b = blankEntity('boss');
  b.x = x;
  b.y = y;
  b.enemyType = 0;
  b.hp = hp;
  b.maxHp = hp;
  b.radius = 120;
  b.damage = 30;
  return addEntity(s, b);
}

function jellies(s: WorldState): Entity[] {
  return s.entities.filter((e) => !e.dead && isCatalystHazard(e) && e.ownerId === JELLY_MARK);
}

function rngState(s: WorldState): [number, number, number] {
  return [s.dropRng.getState(), s.waveRng.getState(), s.powerupRng.getState()];
}

// ---------------------------------------------------------------------------
// §0 — 계측기 건전성 · 무대 전제
// ---------------------------------------------------------------------------

describe('베르단 — 계측기 건전성', () => {
  it('planet 1 은 실제로 shrink 무대이고 shrinkRuntime 이 선다', () => {
    const s = berdanWorld();
    expect(s.config.planetMode).toBe(PLANET_MODE.shrink);
    expect(s.shrinkRuntime).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// §1 — id 33 berdan-collapse
// ---------------------------------------------------------------------------

describe('id 33 berdan-collapse — 중심', () => {
  it('음성 대조 — 안 실으면 중심이 정확히 원점이고 잠금도 없다(무촉매 바이트 불변의 근거)', () => {
    const s = berdanWorld([UNRELATED]);
    for (const t of [0, 1, 450, 899, 900, 5000]) {
      s.tick = t;
      expect(berdanSafeCenterX(s)).toBe(0);
      expect(berdanSafeCenterY(s)).toBe(0);
      expect(berdanCollapseLocked(s)).toBe(false);
    }
    // 인자화한 두 술어가 **기본 인자에서 종전과 동일**하다 — 이것이 바이트 불변의 구조적 근거다.
    seedEnemy(s, 0, 0);
    expect(shrinkRingCleared(s)).toBe(shrinkRingCleared(s, 0, 0));
    const p = player(s);
    p.x = 0;
    p.y = 0;
    const hp0 = p.hp;
    shrinkOutOfBounds(s, p, 0, 0);
    expect(p.hp).toBe(hp0);
  });

  it('중심은 **틱의 순수 파생**이다 — 같은 era 안에서 고정, era 가 바뀌면 점프한다', () => {
    const s = berdanWorld([COLLAPSE]);
    s.tick = 0;
    const x0 = berdanSafeCenterX(s);
    const y0 = berdanSafeCenterY(s);
    s.tick = BERDAN_JUMP_TICKS - 1;
    expect(berdanSafeCenterX(s)).toBe(x0);
    expect(berdanSafeCenterY(s)).toBe(y0);
    s.tick = BERDAN_JUMP_TICKS;
    const x1 = berdanSafeCenterX(s);
    const y1 = berdanSafeCenterY(s);
    expect(x1 !== x0 || y1 !== y0).toBe(true);
    // 순수 파생이라 같은 틱을 다시 물으면 같은 답이다(슬롯이 없다는 것의 관측 가능한 형태).
    s.tick = 0;
    expect(berdanSafeCenterX(s)).toBe(x0);
    expect(berdanSafeCenterY(s)).toBe(y0);
    // 중심은 정수다(부동소수 누적 없음).
    expect(Number.isInteger(x0)).toBe(true);
    expect(Number.isInteger(y0)).toBe(true);
  });

  it('안전 원은 **너를 따라오지 않는다** — 플레이어를 옮겨도 중심이 안 움직인다', () => {
    const s = berdanWorld([COLLAPSE]);
    s.tick = 120;
    const x0 = berdanSafeCenterX(s);
    const p = player(s);
    p.x = 4000;
    p.y = -4000;
    expect(berdanSafeCenterX(s)).toBe(x0);
  });

  it('즉사 창은 점프 직후 5초다', () => {
    const s = berdanWorld([COLLAPSE]);
    s.tick = 0;
    expect(berdanCollapseLocked(s)).toBe(true);
    s.tick = 299;
    expect(berdanCollapseLocked(s)).toBe(true);
    s.tick = 300;
    expect(berdanCollapseLocked(s)).toBe(false);
    s.tick = BERDAN_JUMP_TICKS;
    expect(berdanCollapseLocked(s)).toBe(true);
  });
});

describe('id 33 berdan-collapse — 즉사와 그 대가', () => {
  it('이득 — 즉사 창의 새 원 안 적이 전부 죽고, 그 수가 귀속 원장에 적힌다', () => {
    const s = berdanWorld([COLLAPSE]);
    s.tick = 10; // 즉사 창 안
    const cx = berdanSafeCenterX(s);
    const cy = berdanSafeCenterY(s);
    const inside = [seedEnemy(s, cx, cy), seedEnemy(s, cx + 100, cy - 100)];
    const outside = seedEnemy(s, cx + 90_000, cy);
    berdanOnTick(s, player(s));
    for (const e of inside) expect(e.dead).toBe(true);
    expect(outside.dead).toBe(false); // 원 밖은 안 죽는다(원이 곧 무기라는 것의 경계)
    const led = (s.catalystLedger ?? []).find((r) => r.id === COLLAPSE);
    expect(led?.earned).toBe(2);
    const fx = (s.catalystFx ?? []).filter(
      (f) => f.id === COLLAPSE && f.kind === CATALYST_FX.trigger,
    );
    expect(fx.length).toBe(1); // 틱당 한 번(마리당 아님)
  });

  it('창 **밖**에서는 즉사가 없다 — 대가(원을 못 따라가면 밖 피해)가 살아 있다', () => {
    const s = berdanWorld([COLLAPSE]);
    s.tick = 500; // 창 밖
    const e = seedEnemy(s, berdanSafeCenterX(s), berdanSafeCenterY(s));
    berdanOnTick(s, player(s));
    expect(e.dead).toBe(false);
  });

  it('⭐⭐ **세그먼트가 즉사 때문에 자동 전진하지 않는다**(이 그룹 최대 함정)', () => {
    const s = berdanWorld([COLLAPSE]);
    s.weapon.damage = 0; // 처치 할당 게이트 배제 — 전진하면 링 전멸뿐이다
    // ⚠️ 첫 즉사 창(0..299틱)을 **지나서** 적을 채운다 — 창 안에서는 스폰되는 족족 즉사하므로
    // 원 안이 계속 비어 있다(그 자체가 이 카드의 규칙이다).
    for (let i = 0; i < 420; i++) step(s);
    expect(s.entities.some((e) => e.kind === 'enemy' && !e.dead)).toBe(true);

    const idx0 = s.wave.segmentIndex;
    (s.shrinkRuntime as ShrinkRuntime).graceTicks = 0;
    // **즉사 창 한가운데**로 옮기고 원 안을 통째로 비운다 = 결함이 발현하는 정확한 조건.
    s.tick = 100;
    for (const e of s.entities) if (e.kind === 'enemy') e.dead = true;
    step(s);
    expect(s.wave.segmentIndex).toBe(idx0); // ← 잠금이 없으면 여기서 +1 이 된다

    // 창을 몇 번 더 지나가도 마찬가지다(15초마다 한 칸씩 넘어가면 안 된다).
    for (let era = 1; era <= 3; era++) {
      s.tick = era * BERDAN_JUMP_TICKS + 50;
      (s.shrinkRuntime as ShrinkRuntime).graceTicks = 0;
      for (const e of s.entities) if (e.kind === 'enemy') e.dead = true;
      step(s);
    }
    expect(s.wave.segmentIndex).toBe(idx0);
  });

  it('⚠️ 잠금이 모드를 망가뜨리지 않는다 — 창 **밖**에서 원이 비면 정상 전진한다', () => {
    const s = berdanWorld([COLLAPSE]);
    s.weapon.damage = 0;
    for (let i = 0; i < 420; i++) step(s);
    const idx0 = s.wave.segmentIndex;
    s.tick = 600; // 창 밖
    (s.shrinkRuntime as ShrinkRuntime).graceTicks = 0;
    for (const e of s.entities) if (e.kind === 'enemy') e.dead = true;
    step(s);
    expect(s.kills).toBe(0);
    expect(s.wave.segmentIndex).toBe(idx0 + 1);
    expect((s.shrinkRuntime as ShrinkRuntime).graceTicks).toBe(SHRINK_GRACE_TICKS);
  });

  it('스폰 링이 **새 중심** 기준이다 — 안 옮기면 적이 원 밖에 서서 게이트가 헛돈다', () => {
    const s = berdanWorld([COLLAPSE]);
    // 즉사 창을 지나서 봐야 살아 있는 스폰이 남는다(창 안에서는 전부 즉사한다).
    for (let i = 0; i < 420; i++) step(s);
    const cx = berdanSafeCenterX(s);
    const cy = berdanSafeCenterY(s);
    const rt = s.shrinkRuntime as ShrinkRuntime;
    const enemies = s.entities.filter((e) => e.kind === 'enemy' && !e.dead);
    expect(enemies.length).toBeGreaterThan(0);
    for (const e of enemies) {
      const dx = e.x - cx;
      const dy = e.y - cy;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThan(rt.safeRadius);
    }
  });

  it('보스는 **새 중심**에 소환된다(모드 계약: 보스를 지우지도 옮겨 잃지도 않는다)', () => {
    const s = berdanWorld([COLLAPSE]);
    s.tick = 0;
    const cx = berdanSafeCenterX(s);
    const cy = berdanSafeCenterY(s);
    s.wave.segmentIndex = SEGMENTS.length - 1;
    step(s);
    const boss = s.entities.find((e) => e.kind === 'boss');
    expect(boss).toBeDefined();
    if (boss === undefined) return;
    expect(Math.hypot(boss.x - cx, boss.y - cy)).toBeLessThan(1000);
  });

  it('RNG 를 한 칸도 소비하지 않는다', () => {
    const s = berdanWorld([COLLAPSE]);
    s.tick = 10;
    for (let i = 0; i < 5; i++) seedEnemy(s, berdanSafeCenterX(s), berdanSafeCenterY(s));
    const before = rngState(s);
    for (let i = 0; i < 20; i++) berdanOnTick(s, player(s));
    expect(rngState(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// §2 — id 34 berdan-royal-jelly
// ---------------------------------------------------------------------------

describe('id 34 berdan-royal-jelly', () => {
  it('음성 대조 — 안 실으면 젤리도 없고 이동 배율이 정확히 1 이다', () => {
    const s = berdanWorld([UNRELATED]);
    const rt = s.shrinkRuntime as ShrinkRuntime;
    rt.graceTicks = 0;
    rt.safeRadius = 4000;
    berdanOnTick(s, player(s));
    expect(jellies(s).length).toBe(0);
    expect(berdanOnEnemyStep(s, seedEnemy(s, 0, 0))).toBe(1);
  });

  it('수축이 눈금을 지날 때 밀려난 자리에 젤리가 남는다(유예 중에는 안 남는다)', () => {
    const s = berdanWorld([ROYAL_JELLY]);
    const rt = s.shrinkRuntime as ShrinkRuntime;
    // 유예 중에는 반경이 홀드된다 — "밀려난 자리"가 없으므로 젤리도 없다.
    rt.graceTicks = 5;
    rt.safeRadius = 4000;
    berdanOnTick(s, player(s));
    expect(jellies(s).length).toBe(0);
    // 눈금이 아닌 반경에서도 안 생긴다.
    rt.graceTicks = 0;
    rt.safeRadius = 4001;
    berdanOnTick(s, player(s));
    expect(jellies(s).length).toBe(0);
    // 눈금에서 정확히 한 장.
    rt.safeRadius = 4000;
    berdanOnTick(s, player(s));
    expect(jellies(s).length).toBe(1);
    const j = jellies(s)[0];
    expect(j).toBeDefined();
    if (j === undefined) return;
    // 젤리는 **태우지 않는다** — 피해 0 이라 공용 피해 루프의 `damage > 0` 게이트를 안 탄다.
    expect(j.damage).toBe(0);
    // 젤리는 조여든 그 반경 위, 새 중심 기준으로 놓인다.
    const dx = j.x - berdanSafeCenterX(s);
    const dy = j.y - berdanSafeCenterY(s);
    expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(4000, 0);
  });

  it('⭐ 이득과 대가가 **동시에** 관측된다 — 먹은 적은 느려지고 못 먹은 적은 빨라진다', () => {
    const s = berdanWorld([ROYAL_JELLY]);
    const rt = s.shrinkRuntime as ShrinkRuntime;
    rt.graceTicks = 0;
    rt.safeRadius = 4000;
    berdanOnTick(s, player(s));
    const j = jellies(s)[0];
    expect(j).toBeDefined();
    if (j === undefined) return;
    const fed = seedEnemy(s, j.x, j.y);
    const starved = seedEnemy(s, j.x + 90_000, j.y);
    expect(onRoyalJelly(s, fed.x, fed.y)).toBe(true);
    expect(berdanOnEnemyStep(s, fed)).toBeLessThan(1);
    expect(berdanOnEnemyStep(s, starved)).toBeGreaterThan(1);
  });

  it('경제 — 젤리 위에서 죽은 적만 자원을 뱉고, 못 먹은 적은 **놓친 몫**으로 남는다', () => {
    const s = berdanWorld([ROYAL_JELLY]);
    const rt = s.shrinkRuntime as ShrinkRuntime;
    rt.graceTicks = 0;
    rt.safeRadius = 4000;
    berdanOnTick(s, player(s));
    const j = jellies(s)[0];
    expect(j).toBeDefined();
    if (j === undefined) return;

    const res0 = s.resources;
    berdanOnEnemyDeath(s, j.x, j.y, false);
    expect(s.resources).toBeGreaterThan(res0);
    const led = (s.catalystLedger ?? []).find((r) => r.id === ROYAL_JELLY);
    expect(led?.earned).toBeGreaterThan(0);

    const res1 = s.resources;
    berdanOnEnemyDeath(s, j.x + 90_000, j.y, false);
    expect(s.resources).toBe(res1);
    expect((s.catalystLedger ?? []).find((r) => r.id === ROYAL_JELLY)?.missed).toBeGreaterThan(0);
  });

  it('RNG 를 한 칸도 소비하지 않는다(각도가 반경의 순수 파생이다)', () => {
    const s = berdanWorld([ROYAL_JELLY]);
    const rt = s.shrinkRuntime as ShrinkRuntime;
    rt.graceTicks = 0;
    const before = rngState(s);
    for (let i = 0; i < 10; i++) {
      rt.safeRadius = 4000 - i * 200;
      berdanOnTick(s, player(s));
    }
    expect(jellies(s).length).toBeGreaterThan(1); // 항진 방지 — 실제로 생겼다
    expect(rngState(s)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// §3 — id 35 berdan-hive-queen
// ---------------------------------------------------------------------------

describe('id 35 berdan-hive-queen', () => {
  it('음성 대조 — 안 실으면 보스를 때려도 일벌이 안 나온다', () => {
    const s = berdanWorld([UNRELATED]);
    const boss = seedBoss(s, 0, 0, 5000);
    boss.hp = 1000;
    berdanOnTick(s, player(s));
    expect(liveHiveWorkers(s)).toBe(0);
  });

  it('보스가 피해를 입은 만큼 일벌을 토한다 — 상한이 있다', () => {
    const s = berdanWorld([HIVE_QUEEN]);
    const boss = seedBoss(s, 0, 0, 5000);
    // 무피해면 아무것도 안 나온다(이득이 공짜가 아니라는 것).
    berdanOnTick(s, player(s));
    expect(liveHiveWorkers(s)).toBe(0);

    boss.hp = boss.maxHp - HIVE_HP_PER_WORKER * 3;
    berdanOnTick(s, player(s));
    expect(liveHiveWorkers(s)).toBe(3);

    boss.hp = 1; // 극단 — 상한을 넘지 않는다
    berdanOnTick(s, player(s));
    expect(liveHiveWorkers(s)).toBe(HIVE_LIVE_CAP);
  });

  it('⭐ `boss` kind 는 **끝까지 하나**이고 일벌 처치가 런을 끝내지 않는다', () => {
    const s = berdanWorld([HIVE_QUEEN]);
    const boss = seedBoss(s, 0, 0, 5000);
    boss.hp = boss.maxHp - HIVE_HP_PER_WORKER * 4;
    berdanOnTick(s, player(s));
    expect(s.entities.filter((e) => !e.dead && e.kind === 'boss').length).toBe(1);
    for (const w of s.entities) {
      if (isHiveWorker(w)) expect(w.kind).toBe('enemy');
    }
    // 일벌 하나를 죽여도 런은 안 끝난다.
    const worker = s.entities.find((e) => !e.dead && isHiveWorker(e));
    expect(worker).toBeDefined();
    if (worker === undefined) return;
    worker.hp = 0;
    worker.dead = true;
    berdanOnEnemyDamaged(s, worker, 999, undefined);
    expect(s.victory).toBeFalsy();
  });

  it('⭐ 일벌을 죽이면 보스 HP 가 **실제로** 그만큼 줄어든다', () => {
    const s = berdanWorld([HIVE_QUEEN]);
    const boss = seedBoss(s, 0, 0, 5000);
    boss.hp = boss.maxHp - HIVE_HP_PER_WORKER * 2;
    berdanOnTick(s, player(s));
    const worker = s.entities.find((e) => !e.dead && isHiveWorker(e));
    expect(worker).toBeDefined();
    if (worker === undefined) return;
    const hp0 = boss.hp;
    worker.hp = 0;
    worker.dead = true;
    berdanOnEnemyDamaged(s, worker, 999, undefined);
    expect(boss.hp).toBe(hp0 - HIVE_HP_PER_WORKER);

    // 일벌이 아닌 적을 죽여도 보스는 안 줄어든다(마커가 실제로 판별에 쓰인다).
    const plain = seedEnemy(s, 0, 0);
    plain.dead = true;
    const hp1 = boss.hp;
    berdanOnEnemyDamaged(s, plain, 999, undefined);
    expect(boss.hp).toBe(hp1);
  });

  it('일벌을 계속 쓸어 담으면 보스가 결국 녹는다(진행 교착 없음)', () => {
    const s = berdanWorld([HIVE_QUEEN]);
    const boss = seedBoss(s, 0, 0, 2000);
    boss.hp = boss.maxHp - HIVE_HP_PER_WORKER;
    let guard = 0;
    while (!boss.dead && guard < 500) {
      berdanOnTick(s, player(s));
      const w = s.entities.find((e) => !e.dead && isHiveWorker(e));
      if (w === undefined) break;
      w.hp = 0;
      w.dead = true;
      berdanOnEnemyDamaged(s, w, 999, undefined);
      guard++;
    }
    expect(boss.hp).toBe(0);
    expect(boss.dead).toBe(true);
  });

  it('경제 — 일벌이 떠 있을수록 전리품 개수가 오르고 상한 2.2 를 안 넘는다', () => {
    const s = berdanWorld([HIVE_QUEEN]);
    expect(berdanOnLootRoll(s, 0, 0, true).count).toBe(1);
    const boss = seedBoss(s, 0, 0, 5000);
    boss.hp = 1;
    berdanOnTick(s, player(s));
    const lr = berdanOnLootRoll(s, 0, 0, true);
    expect(lr.count).toBeGreaterThan(1);
    expect(lr.count).toBeLessThanOrEqual(2.2);
    expect(lr.rarity).toBe(1);
  });

  it('소환이 RNG 를 한 칸도 소비하지 않는다(`summonEnemy` 정본)', () => {
    const s = berdanWorld([HIVE_QUEEN]);
    const boss = seedBoss(s, 0, 0, 5000);
    boss.hp = 1;
    const before = rngState(s);
    for (let i = 0; i < 20; i++) berdanOnTick(s, player(s));
    expect(liveHiveWorkers(s)).toBe(HIVE_LIVE_CAP); // 항진 방지 — 실제로 소환됐다
    expect(rngState(s)).toEqual(before);
  });
});
