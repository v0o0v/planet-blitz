/**
 * 침공 L3 코어방 테스트 (M7a · L5-core-room).
 *
 * 검증 축(레인 문서):
 *   ① 방어 보스 3페이즈 전이(HP 임계 기반) + 결정성
 *   ② 실드 발생기 생존 중 코어 무적 → 파괴 후 피해 통과
 *   ③ 중력 앵커 감속이 playerSlowTicks 로 반영
 *   ④ 코어 내구도·좌표가 배치 데이터 정본
 *   ⑤ 수호 슬롯 i ↔ 엔티티 pierce i 매핑 골든(SQL·EF·클라 3자 정합의 근거)
 *   ⑥ 정비도 0% 에서 발사 간격이 정확히 2배(정수 centi-percent, f64 누적 없음)
 */

import { describe, expect, it } from 'vitest';
import { createWorld, emptyInput, stepWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import {
  DEFENSE_BOSS_KIND,
  L3_PROP_KIND,
  enterCoreRoom,
  stepCoreRoom,
} from '../src/sim/invasion/coreRoom.js';
import { normalizeInvasionLayers, SAMPLE_GUARDIAN } from '../src/sim/invasion/normalize.js';
import { INVASION_CORE_HP, INVASION_CORE_RADIUS } from '../src/sim/invasion/constants.js';
import type { InvasionLayers, InvasionStepContext } from '../src/sim/invasion/types.js';
import { MAINTENANCE_FULL } from '../src/sim/defense.js';
import {
  DEFENSE_BOSS_TRANSITION_TICKS,
  DEFENSE_BOSSES,
  defenseBossPowerBp,
  scaleByBp,
} from '../data/invasion/defenseBosses.js';
import {
  L3_PROPS,
  PROP_FIXED_CANNON,
  PROP_GRAVITY_ANCHOR,
  PROP_SHIELD_GENERATOR,
  PROP_SOCKET_OFFSETS,
  propPowerBp,
} from '../data/invasion/props.js';
import { HAZARD_SLOW } from '../src/sim/patterns/types.js';

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

const REF = (catalogId: number): Record<string, number> => ({
  catalogId,
  level: 1,
  ascension: 0,
  affixSeed: 0,
  rarity: 0,
});

/** 소켓 배열을 만든다: `entries` 의 키 = 소켓 인덱스, 값 = catalogId. */
function props(entries: Record<number, number>): unknown[] {
  const out: unknown[] = new Array(PROP_SOCKET_OFFSETS.length).fill(null);
  for (const k of Object.keys(entries)) {
    const i = Number(k);
    out[i] = REF(entries[i]!);
  }
  return out;
}

function layersWith(raw: Record<string, unknown>): InvasionLayers {
  return normalizeInvasionLayers({ l3: raw });
}

function ctxOf(layers: InvasionLayers, maintenance = MAINTENANCE_FULL): InvasionStepContext {
  return { layers, runtime: { phase: 2, phaseEnterTick: 0, scrollX: 0, scrollY: 0, accelCp: 100 }, maintenance };
}

function live(state: WorldState, kind: string): Entity[] {
  return state.entities.filter((e) => (e.kind as string) === kind && !e.dead);
}

function one(state: WorldState, kind: string): Entity {
  const list = live(state, kind);
  expect(list.length).toBe(1);
  return list[0]!;
}

// ---------------------------------------------------------------------------

describe('L3 코어방 — 진입 스폰', () => {
  it('코어 내구도·좌표·반지름이 배치 데이터 정본이다', () => {
    const layers = layersWith({ core: { hp: 4321, x: 100, y: -200 } });
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(layers));
    const core = one(w, 'core');
    expect(core.hp).toBe(4321);
    expect(core.maxHp).toBe(4321);
    expect(core.x).toBe(100);
    expect(core.y).toBe(-200);
    expect(core.radius).toBe(INVASION_CORE_RADIUS);
  });

  it('미지정 코어는 기본 내구도로 정규화된다', () => {
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(normalizeInvasionLayers(undefined)));
    expect(one(w, 'core').hp).toBe(INVASION_CORE_HP);
  });

  it('빈 보스 슬롯은 기본 수비대(0번 보스 lv1 노말)로 충원된다', () => {
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(normalizeInvasionLayers(undefined)));
    const boss = one(w, DEFENSE_BOSS_KIND as string);
    expect(boss.enemyType).toBe(0);
    expect(boss.hp).toBe(DEFENSE_BOSSES[0]!.hp);
    expect(boss.phase).toBe(0);
  });

  it('빈 기물 소켓은 비운다(과충전 방지) — 채운 소켓만 스폰된다', () => {
    const layers = layersWith({ props: props({ 0: PROP_SHIELD_GENERATOR, 3: PROP_FIXED_CANNON }) });
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(layers));
    const spawned = live(w, L3_PROP_KIND as string);
    expect(spawned.length).toBe(2);
    expect(spawned.map((p) => p.pierce)).toEqual([0, 3]);
    // 소켓 인덱스가 곧 좌표다(코어 상대 오프셋).
    expect(spawned[0]!.x).toBe(PROP_SOCKET_OFFSETS[0]!.x);
    expect(spawned[0]!.y).toBe(PROP_SOCKET_OFFSETS[0]!.y);
    expect(spawned[1]!.x).toBe(PROP_SOCKET_OFFSETS[3]!.x);
  });

  it('멱등: 두 번 호출해도 배치가 중복 스폰되지 않는다', () => {
    const layers = layersWith({ props: props({ 1: PROP_GRAVITY_ANCHOR }) });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const n = w.entities.length;
    enterCoreRoom(w, ctx);
    expect(w.entities.length).toBe(n);
  });
});

describe('L3 코어방 — 수호 슬롯 매핑(3자 정합 골든)', () => {
  it('슬롯 i 의 수호는 반드시 entity.pierce === i 다(빈 슬롯은 밀집화하지 않는다)', () => {
    // 슬롯 0 은 비우고 슬롯 1 만 채운다 → 밀집화 구현이라면 pierce 가 0 이 되어 실패한다.
    const layers = layersWith({ guardians: [null, SAMPLE_GUARDIAN] });
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(layers));
    const g = one(w, 'guardian');
    expect(g.pierce).toBe(1);
    expect(g.x).toBe(SAMPLE_GUARDIAN.x);
    expect(g.y).toBe(SAMPLE_GUARDIAN.y);
  });

  it('두 슬롯 모두 채우면 pierce 는 0,1 순서다', () => {
    const layers = layersWith({ guardians: [SAMPLE_GUARDIAN, SAMPLE_GUARDIAN] });
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(layers));
    expect(live(w, 'guardian').map((g) => g.pierce)).toEqual([0, 1]);
  });
});

describe('L3 코어방 — 실드 발생기', () => {
  it('발생기 생존 중 코어 실드가 매 틱 가득 차 코어가 무적이다', () => {
    const layers = layersWith({ props: props({ 0: PROP_SHIELD_GENERATOR }) });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const core = one(w, 'core');
    const gen = one(w, L3_PROP_KIND as string);
    const shield = scaleByBp(L3_PROPS[PROP_SHIELD_GENERATOR]!.shieldHp, propPowerBp(1, 0, 0));
    expect(core.targetY).toBe(shield);

    // 실드를 거의 다 깎아도(코어 HP 는 world.ts 흡수 경로가 지켜준다) 다음 틱에 재생된다.
    core.targetY = 1;
    stepCoreRoom(w, ctx);
    expect(core.targetY).toBe(shield);
    expect(core.hp).toBe(INVASION_CORE_HP);
    expect(gen.dead).toBe(false);
  });

  it('발생기를 전부 파괴하면 실드 재생이 멈춰 코어 피해가 통과한다', () => {
    const layers = layersWith({ props: props({ 0: PROP_SHIELD_GENERATOR }) });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const core = one(w, 'core');
    one(w, L3_PROP_KIND as string).dead = true;

    stepCoreRoom(w, ctx);
    expect(core.targetY).toBe(0); // 수호 미배치 → 실드 공유 0

    // 이후 틱에도 재생되지 않는다(발생기 국면 종료는 1회성).
    core.hp -= 500;
    stepCoreRoom(w, ctx);
    expect(core.targetY).toBe(0);
    expect(core.hp).toBe(INVASION_CORE_HP - 500);
  });

  it('발생기가 둘이면 공급량이 합산되고, 하나 남으면 그만큼만 재생된다', () => {
    const layers = layersWith({
      props: props({ 0: PROP_SHIELD_GENERATOR, 2: PROP_SHIELD_GENERATOR }),
    });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const core = one(w, 'core');
    const unit = scaleByBp(L3_PROPS[PROP_SHIELD_GENERATOR]!.shieldHp, propPowerBp(1, 0, 0));
    expect(core.targetY).toBe(unit * 2);
    live(w, L3_PROP_KIND as string)[0]!.dead = true;
    stepCoreRoom(w, ctx);
    expect(core.targetY).toBe(unit);
  });
});

describe('L3 코어방 — 중력 앵커', () => {
  it('주기가 오면 플레이어 위치에 HAZARD_SLOW 장판을 융기시킨다', () => {
    const layers = layersWith({ props: props({ 1: PROP_GRAVITY_ANCHOR }) });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const spec = L3_PROPS[PROP_GRAVITY_ANCHOR]!;
    const player = w.entities[0]!;

    // 쿨다운이 남아 있는 동안은 융기하지 않는다.
    for (let i = 0; i < spec.periodTicks; i++) stepCoreRoom(w, ctx);
    expect(live(w, 'hazard').length).toBe(0);
    stepCoreRoom(w, ctx);
    const hz = one(w, 'hazard');
    expect(hz.enemyType).toBe(HAZARD_SLOW);
    expect(hz.x).toBe(player.x);
    expect(hz.y).toBe(player.y);
    expect(hz.radius).toBe(spec.hazardRadius);
    expect(hz.timer).toBe(spec.hazardWindup);
  });

  it('장판이 활성화되면 playerSlowTicks 가 선다(world.ts 해저드 경로 통합)', () => {
    const layers = layersWith({ props: props({ 1: PROP_GRAVITY_ANCHOR }) });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const spec = L3_PROPS[PROP_GRAVITY_ANCHOR]!;
    for (let i = 0; i <= spec.periodTicks; i++) stepCoreRoom(w, ctx);
    expect(live(w, 'hazard').length).toBe(1);
    // 예열이 끝나고 활성 구간에 들어가면 접촉한 플레이어가 감속된다.
    for (let i = 0; i <= spec.hazardWindup + 1; i++) {
      stepWorld(w, emptyInput());
    }
    expect(w.playerSlowTicks).toBeGreaterThan(0);
  });
});

describe('L3 코어방 — 고정 주포', () => {
  it('사거리 안에서만 발사하고, 발사 후 쿨다운이 재장전된다', () => {
    const layers = layersWith({ props: props({ 0: PROP_FIXED_CANNON }), core: { x: 0, y: 0 } });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const spec = L3_PROPS[PROP_FIXED_CANNON]!;
    const cannon = one(w, L3_PROP_KIND as string);
    const player = w.entities[0]!;

    // 사거리 밖: 쿨다운이 0 이 되어도 발사하지 않는다(즉발 대기).
    player.x = cannon.x + spec.range + 100;
    player.y = cannon.y;
    for (let i = 0; i <= spec.fireCooldown; i++) stepCoreRoom(w, ctx);
    expect(live(w, 'enemyBullet').length).toBe(0);
    expect(cannon.cooldown).toBe(0);

    // 사정권 진입 → 즉시 1발.
    player.x = cannon.x + 200;
    stepCoreRoom(w, ctx);
    expect(live(w, 'enemyBullet').length).toBe(1);
    expect(cannon.cooldown).toBe(spec.fireCooldown);
  });

  it('정비도 0% 면 발사 간격이 정확히 2배다(정수 centi-percent)', () => {
    const layers = layersWith({ props: props({ 0: PROP_FIXED_CANNON }) });
    const spec = L3_PROPS[PROP_FIXED_CANNON]!;

    const full = createWorld(1);
    enterCoreRoom(full, ctxOf(layers, MAINTENANCE_FULL));
    expect(one(full, L3_PROP_KIND as string).cooldown).toBe(spec.fireCooldown);

    const worn = createWorld(1);
    const wornCtx = ctxOf(layers, 0);
    enterCoreRoom(worn, wornCtx);
    const cannon = one(worn, L3_PROP_KIND as string);
    expect(cannon.cooldown).toBe(spec.fireCooldown * 2);

    // 재장전도 2배로 걸린다.
    const player = worn.entities[0]!;
    player.x = cannon.x + 100;
    player.y = cannon.y;
    for (let i = 0; i <= spec.fireCooldown * 2; i++) stepCoreRoom(worn, wornCtx);
    expect(cannon.cooldown).toBe(spec.fireCooldown * 2);
  });

  it('정비도 0% 면 보스 캐스트 간격과 앵커 주기도 2배다(배치 전반 균일 풍화)', () => {
    const layers = layersWith({ props: props({ 1: PROP_GRAVITY_ANCHOR }) });
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(layers, 0));
    expect(one(w, L3_PROP_KIND as string).cooldown).toBe(
      L3_PROPS[PROP_GRAVITY_ANCHOR]!.periodTicks * 2,
    );
    expect(one(w, DEFENSE_BOSS_KIND as string).cooldown).toBe(
      DEFENSE_BOSSES[0]!.phases[0].patternCooldown * 2,
    );
  });
});

describe('L3 코어방 — 방어 보스', () => {
  it('HP 임계(70%/35%)를 넘으면 페이즈가 전진하고 전이 연출이 걸린다', () => {
    const w = createWorld(1);
    const ctx = ctxOf(normalizeInvasionLayers(undefined));
    enterCoreRoom(w, ctx);
    const boss = one(w, DEFENSE_BOSS_KIND as string);
    expect(boss.phase).toBe(0);

    boss.hp = Math.floor(boss.maxHp * 0.6);
    stepCoreRoom(w, ctx);
    expect(boss.phase).toBe(1);
    expect(boss.timer).toBe(DEFENSE_BOSS_TRANSITION_TICKS);

    // 전이 연출 동안은 정지·무발사.
    for (let i = 0; i < DEFENSE_BOSS_TRANSITION_TICKS; i++) stepCoreRoom(w, ctx);
    expect(boss.timer).toBe(0);

    boss.hp = Math.floor(boss.maxHp * 0.2);
    stepCoreRoom(w, ctx);
    expect(boss.phase).toBe(2);
  });

  it('한 틱에 두 임계를 함께 넘으면 최종 페이즈로 직행한다(연출 1회)', () => {
    const w = createWorld(1);
    const ctx = ctxOf(normalizeInvasionLayers(undefined));
    enterCoreRoom(w, ctx);
    const boss = one(w, DEFENSE_BOSS_KIND as string);
    boss.hp = 1;
    stepCoreRoom(w, ctx);
    expect(boss.phase).toBe(2);
    expect(boss.timer).toBe(DEFENSE_BOSS_TRANSITION_TICKS);
  });

  it('페이즈 전이 틱에 적탄이 전소거된다', () => {
    const w = createWorld(1);
    const ctx = ctxOf(normalizeInvasionLayers(undefined));
    enterCoreRoom(w, ctx);
    const boss = one(w, DEFENSE_BOSS_KIND as string);
    // 첫 캐스트까지 진행해 적탄을 만든다.
    for (let i = 0; i <= DEFENSE_BOSSES[0]!.phases[0].patternCooldown; i++) stepCoreRoom(w, ctx);
    expect(live(w, 'enemyBullet').length).toBeGreaterThan(0);
    boss.hp = Math.floor(boss.maxHp * 0.5);
    stepCoreRoom(w, ctx);
    expect(live(w, 'enemyBullet').length).toBe(0);
  });

  it('시그니처 캐스트 직후 과열 창이 열린다(받는 피해 2배 구간)', () => {
    const w = createWorld(1);
    const ctx = ctxOf(normalizeInvasionLayers(undefined));
    enterCoreRoom(w, ctx);
    const boss = one(w, DEFENSE_BOSS_KIND as string);
    expect(boss.iframes).toBe(0);
    for (let i = 0; i <= DEFENSE_BOSSES[0]!.phases[0].patternCooldown; i++) stepCoreRoom(w, ctx);
    expect(boss.iframes).toBeGreaterThan(0);
  });

  it('강화 3축이 HP·접촉피해를 정수 배율로 올린다', () => {
    const layers = layersWith({
      boss: { catalogId: 0, level: 11, ascension: 2, affixSeed: 0, rarity: 3 },
    });
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(layers));
    const boss = one(w, DEFENSE_BOSS_KIND as string);
    const bp = defenseBossPowerBp(11, 2, 3);
    expect(boss.hp).toBe(scaleByBp(DEFENSE_BOSSES[0]!.hp, bp));
    expect(boss.damage).toBe(scaleByBp(DEFENSE_BOSSES[0]!.contactDamage, bp));
    expect(Number.isInteger(boss.hp)).toBe(true);
  });
});

describe('L3 코어방 — 결정론', () => {
  it('같은 배치·같은 틱 수를 두 번 돌리면 엔티티 상태가 바이트 동일하다', () => {
    const layers = layersWith({
      props: props({ 0: PROP_SHIELD_GENERATOR, 1: PROP_GRAVITY_ANCHOR, 3: PROP_FIXED_CANNON }),
      guardians: [SAMPLE_GUARDIAN, null],
      boss: { catalogId: 0, level: 5, ascension: 1, affixSeed: 0, rarity: 1 },
    });
    const run = (): string => {
      const w = createWorld(7);
      const ctx = ctxOf(layers, 6500);
      enterCoreRoom(w, ctx);
      for (let i = 0; i < 400; i++) stepCoreRoom(w, ctx);
      return JSON.stringify(w.entities);
    };
    expect(run()).toBe(run());
  });

  it('RNG 를 소비하지 않는다(웨이브 스트림 커서 불변)', () => {
    const layers = layersWith({
      props: props({ 1: PROP_GRAVITY_ANCHOR, 3: PROP_FIXED_CANNON }),
      guardians: [SAMPLE_GUARDIAN, SAMPLE_GUARDIAN],
    });
    const w = createWorld(3);
    const ctx = ctxOf(layers);
    const before = JSON.stringify([w.rng, w.waveRng, w.dropRng, w.eliteRng]);
    enterCoreRoom(w, ctx);
    for (let i = 0; i < 300; i++) stepCoreRoom(w, ctx);
    expect(JSON.stringify([w.rng, w.waveRng, w.dropRng, w.eliteRng])).toBe(before);
  });
});
