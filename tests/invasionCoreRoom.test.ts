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
import {
  createWorld,
  emptyInput,
  packPowerupPick,
  stepWorld,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { blankEntity } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import {
  DECOY_HOLOGRAM_KIND,
  DEFENSE_BOSS_KIND,
  L3_PROP_KIND,
  enterCoreRoom,
  stepCoreRoom,
} from '../src/sim/invasion/coreRoom.js';
import { normalizeInvasionLayers, SAMPLE_GUARDIAN } from '../src/sim/invasion/normalize.js';
import { INVASION_CORE_HP, INVASION_CORE_RADIUS } from '../src/sim/invasion/constants.js';
import type { InvasionLayers, InvasionStepContext } from '../src/sim/invasion/types.js';
import { MAINTENANCE_FULL } from '../src/sim/invasion/guardian.js';
import {
  DEFENSE_BOSS_TRANSITION_TICKS,
  DEFENSE_BOSSES,
  defenseBossPowerBp,
  scaleByBp,
} from '../data/invasion/defenseBosses.js';
import {
  L3_PROPS,
  L3_PROP_COUNT,
  PROP_DECOY_HOLOGRAM,
  PROP_FIXED_CANNON,
  PROP_GRAVITY_ANCHOR,
  PROP_MINE_SWARM,
  PROP_REPAIR_PYLON,
  PROP_ROLE_COUNT,
  PROP_SHIELD_GENERATOR,
  PROP_SOCKET_OFFSETS,
  mineRingOffset,
  propHealAmount,
  propPowerBp,
} from '../data/invasion/props.js';
import { HAZARD_MORTAR, HAZARD_SLOW } from '../src/sim/patterns/types.js';
import { affixDamage, affixHp, defenseAffixSet } from '../src/sim/invasion/affix.js';
import { CATALOG_BOSS } from '../data/invasion/catalog.js';
import { INVASION_TOTAL_TICKS, PHASE_L3 } from '../src/sim/invasion/constants.js';
import { spriteSlotFor } from '../src/render/entityRenderer.js';
import { DEFENSE_BOSS_ASSET_FILES, PROP_ASSET_FILES } from '../src/render/textures.js';
import { INVASION_DENSITY_LEGACY } from '../src/sim/invasion/density.js';

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
  // 밀도 축을 구값으로 고정한다 — 이 파일의 단언은 구 스케줄(720틱·1회 순회) 전제라,
  // 여기서 LEGACY 를 쓰는 것이 곧 "밀도를 끄면 예전과 같은가"를 지키는 가드가 된다.
  return {
    layers,
    runtime: { phase: 2, phaseEnterTick: 0, scrollX: 0, scrollY: 0, accelCp: 100 },
    maintenance,
    density: INVASION_DENSITY_LEGACY,
    defenseBonusBp: 0,
    // 기본 수비대도 중립 레벨(=100cp, ×1.00)로 고정 — 위 LEGACY 밀도와 같은 이유다.
    garrisonLevel: 1,
  };
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

  it('강화 3축이 HP·접촉피해를 정수 배율로 올린다(어픽스 미보유 = 3축 산식 그대로)', () => {
    // normal 등급은 방어체 어픽스가 0개(DEFENSE_UNIT_AFFIX_RANGE.normal = [0,0])라 강화 3축
    // 산식만 남는다 — 어픽스 sim 반영 이후에도 이 등식이 깨지지 않아야 한다(비트 동일 계약).
    const layers = layersWith({
      boss: { catalogId: 0, level: 11, ascension: 2, affixSeed: 0, rarity: 0 },
    });
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(layers));
    const boss = one(w, DEFENSE_BOSS_KIND as string);
    const bp = defenseBossPowerBp(11, 2, 0);
    expect(boss.hp).toBe(scaleByBp(DEFENSE_BOSSES[0]!.hp, bp));
    expect(boss.damage).toBe(scaleByBp(DEFENSE_BOSSES[0]!.contactDamage, bp));
    expect(Number.isInteger(boss.hp)).toBe(true);
  });

  it('어픽스를 가진 등급은 3축 위에 접두 보정이 정수로 얹힌다', () => {
    // unique(3)는 어픽스 5개 고정. `affixSeed` 로 복원한 접두를 접은 값이 정본이며, 그 정본은
    // affix.ts 의 순수 함수(`defenseAffixSet`·`affixHp`)가 만든다 — 여기서 재구현하지 않는다.
    const ref = { catalogId: 0, level: 11, ascension: 2, affixSeed: 0, rarity: 3 };
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(layersWith({ boss: ref })));
    const boss = one(w, DEFENSE_BOSS_KIND as string);
    const bp = defenseBossPowerBp(11, 2, 3);
    const mods = defenseAffixSet(CATALOG_BOSS, ref).always;
    expect(boss.hp).toBe(affixHp(scaleByBp(DEFENSE_BOSSES[0]!.hp, bp), mods));
    expect(boss.damage).toBe(affixDamage(scaleByBp(DEFENSE_BOSSES[0]!.contactDamage, bp), mods));
    // 어픽스 리롤이 전투에 실제로 닿는다는 것 자체를 못 박는다(리롤 축이 no-op 이면 여기서 깨진다).
    expect(boss.hp).not.toBe(scaleByBp(DEFENSE_BOSSES[0]!.hp, bp));
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

// ---------------------------------------------------------------------------
// M7c 콘텐츠 확장 — 기물 6종 · 보스 3종
// ---------------------------------------------------------------------------

describe('L3 코어방 — 카탈로그 append-only 계약(M7c)', () => {
  it('기물 6종 · 보스 3종이며 배열 인덱스 = catalogId 순서가 고정이다', () => {
    // 인덱스가 곧 `defenses.layout` jsonb 계약이라, 순서가 바뀌면 저장된 배치가 다른 기물을
    // 가리킨다. 하드코딩 골든으로 재정렬·중간 삽입을 그 자리에서 잡는다.
    expect(L3_PROPS.map((p) => p.id)).toEqual([
      'shieldGenerator',
      'gravityAnchor',
      'fixedCannon',
      'repairPylon',
      'decoyHologram',
      'mineSwarm',
    ]);
    expect(DEFENSE_BOSSES.map((b) => b.id)).toEqual(['steelGoliath', 'sporeQueen', 'phaseWarden']);
    // 역할 코드 = 배열 인덱스(스텝 디스패치·스프라이트 인덱싱이 둘을 같은 것으로 쓴다).
    L3_PROPS.forEach((p, i) => expect(p.role).toBe(i));
    expect(PROP_ROLE_COUNT).toBe(6);
    expect(L3_PROP_COUNT).toBe(6);
  });

  it('보스 3종 전부 정확히 3페이즈이고 각 페이즈에 캐스트가 있다', () => {
    for (const b of DEFENSE_BOSSES) {
      expect(b.phases.length).toBe(3);
      for (const ph of b.phases) {
        expect(ph.attacks.length).toBeGreaterThan(0);
        // 과열 창(300틱)보다 재개 간격이 커야 "열림/닫힘" 리듬이 생긴다.
        expect(ph.overheatInterval).toBeGreaterThan(300);
        expect(Number.isInteger(ph.patternCooldown)).toBe(true);
      }
    }
  });

  it('스프라이트 매핑이 신규 6종·3종 전부에 실제 슬롯을 준다(조용한 폴백 금지)', () => {
    // 기물은 역할 코드로, 보스는 catalogId 로 인덱싱된다. 배열 길이가 카탈로그보다 짧으면
    // resolveSpriteSlot 이 0번으로 조용히 폴백해 신규 콘텐츠가 구 콘텐츠처럼 보인다.
    expect(PROP_ASSET_FILES).toHaveLength(PROP_ROLE_COUNT);
    expect(DEFENSE_BOSS_ASSET_FILES).toHaveLength(DEFENSE_BOSSES.length);
    expect(new Set(PROP_ASSET_FILES).size).toBe(PROP_ROLE_COUNT);
    expect(new Set(DEFENSE_BOSS_ASSET_FILES).size).toBe(DEFENSE_BOSSES.length);
    for (let role = 0; role < PROP_ROLE_COUNT; role++) {
      if (role === PROP_DECOY_HOLOGRAM) continue; // 홀로그램은 kind 가 decoyCore 다(아래 케이스).
      expect(spriteSlotFor(L3_PROP_KIND, role)).toEqual({
        kind: 'array',
        slot: 'prop',
        index: role,
      });
    }
    for (let id = 0; id < DEFENSE_BOSSES.length; id++) {
      expect(spriteSlotFor(DEFENSE_BOSS_KIND, id)).toEqual({
        kind: 'array',
        slot: 'defenseBoss',
        index: id,
      });
    }
    // 기만 홀로그램은 **진짜 코어와 같은 텍스처**로 그려져야 미끼가 성립한다.
    expect(spriteSlotFor(DECOY_HOLOGRAM_KIND, PROP_DECOY_HOLOGRAM)).toEqual(
      spriteSlotFor('core', -1),
    );
  });
});

describe('L3 코어방 — 신규 보스 2종 페이즈 전이(전수)', () => {
  // 신규 보스만 돌린다(0번 골리앗은 위 기존 케이스가 이미 덮는다).
  for (const catalogId of [1, 2]) {
    const def = DEFENSE_BOSSES[catalogId]!;

    it(`보스 ${catalogId}(${def.id}) — 70%/35% 임계에서 페이즈가 전진한다`, () => {
      const layers = layersWith({ boss: REF(catalogId) });
      const w = createWorld(1);
      const ctx = ctxOf(layers);
      enterCoreRoom(w, ctx);
      const boss = one(w, DEFENSE_BOSS_KIND as string);
      expect(boss.enemyType).toBe(catalogId);
      expect(boss.hp).toBe(scaleByBp(def.hp, defenseBossPowerBp(1, 0, 0)));
      expect(boss.phase).toBe(0);

      // 70% 초과에서는 전진하지 않는다.
      boss.hp = Math.floor((boss.maxHp * 75) / 100);
      stepCoreRoom(w, ctx);
      expect(boss.phase).toBe(0);

      boss.hp = Math.floor((boss.maxHp * 69) / 100);
      stepCoreRoom(w, ctx);
      expect(boss.phase).toBe(1);
      expect(boss.timer).toBe(DEFENSE_BOSS_TRANSITION_TICKS);
      for (let i = 0; i < DEFENSE_BOSS_TRANSITION_TICKS; i++) stepCoreRoom(w, ctx);

      boss.hp = Math.floor((boss.maxHp * 34) / 100);
      stepCoreRoom(w, ctx);
      expect(boss.phase).toBe(2);
    });

    it(`보스 ${catalogId}(${def.id}) — 같은 입력을 두 번 돌리면 상태가 바이트 동일하다`, () => {
      const layers = layersWith({ boss: { ...REF(catalogId), level: 7, ascension: 1, rarity: 2 } });
      const run = (): string => {
        const w = createWorld(5);
        const ctx = ctxOf(layers, 7000);
        enterCoreRoom(w, ctx);
        const boss = one(w, DEFENSE_BOSS_KIND as string);
        for (let i = 0; i < 500; i++) {
          // 전 페이즈를 실제로 밟도록 체력을 계단식으로 떨어뜨린다.
          if (i === 150) boss.hp = Math.floor(boss.maxHp * 0.5);
          if (i === 320) boss.hp = Math.floor(boss.maxHp * 0.2);
          stepCoreRoom(w, ctx);
        }
        return JSON.stringify(w.entities);
      };
      expect(run()).toBe(run());
    });

    it(`보스 ${catalogId}(${def.id}) — 3페이즈 전부에서 실제로 캐스트가 나간다`, () => {
      const layers = layersWith({ boss: REF(catalogId) });
      for (let phase = 0; phase < 3; phase++) {
        const w = createWorld(2);
        const ctx = ctxOf(layers);
        enterCoreRoom(w, ctx);
        const boss = one(w, DEFENSE_BOSS_KIND as string);
        boss.phase = phase;
        boss.cooldown = 0;
        const before = live(w, 'enemyBullet').length + live(w, 'hazard').length;
        // 해당 페이즈의 캐스트를 라운드로빈으로 한 바퀴 돌린다.
        const ph = def.phases[phase]!;
        const ticks = ph.patternCooldown * (ph.attacks.length + 1);
        for (let i = 0; i <= ticks; i++) stepCoreRoom(w, ctx);
        expect(live(w, 'enemyBullet').length + live(w, 'hazard').length).toBeGreaterThan(before);
      }
    });
  }
});

describe('L3 코어방 — 회복 파일런', () => {
  it('주기가 오면 반경 안의 손상된 아군을 정수 회복하고 최대치를 넘지 않는다', () => {
    const layers = layersWith({
      props: props({ 0: PROP_REPAIR_PYLON, 1: PROP_GRAVITY_ANCHOR }),
    });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const spec = L3_PROPS[PROP_REPAIR_PYLON]!;
    const heal = propHealAmount(spec, propPowerBp(1, 0, 0));
    expect(heal).toBeGreaterThan(0);

    const anchor = live(w, L3_PROP_KIND as string).find(
      (p) => p.enemyType === PROP_GRAVITY_ANCHOR,
    )!;
    // 소켓 0 ↔ 소켓 1 거리는 회복 반경 안이다(파일런 사거리 설계 전제).
    const dx = PROP_SOCKET_OFFSETS[0]!.x - PROP_SOCKET_OFFSETS[1]!.x;
    const dy = PROP_SOCKET_OFFSETS[0]!.y - PROP_SOCKET_OFFSETS[1]!.y;
    expect(dx * dx + dy * dy).toBeLessThan(spec.range * spec.range);

    anchor.hp = anchor.maxHp - heal * 2;
    for (let i = 0; i < spec.periodTicks; i++) stepCoreRoom(w, ctx);
    expect(anchor.hp).toBe(anchor.maxHp - heal * 2); // 아직 펄스 전
    stepCoreRoom(w, ctx);
    expect(anchor.hp).toBe(anchor.maxHp - heal);
    expect(Number.isInteger(anchor.hp)).toBe(true);

    // 다음 펄스는 상한에서 멈춘다(초과 회복 금지).
    for (let i = 0; i <= spec.periodTicks; i++) stepCoreRoom(w, ctx);
    expect(anchor.hp).toBe(anchor.maxHp);
  });

  it('반경 밖의 아군은 회복하지 않고, 자기 자신도 회복하지 않는다', () => {
    const layers = layersWith({ props: props({ 0: PROP_REPAIR_PYLON }) });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const spec = L3_PROPS[PROP_REPAIR_PYLON]!;
    const pylon = one(w, L3_PROP_KIND as string);
    const boss = one(w, DEFENSE_BOSS_KIND as string);

    pylon.hp = 1;
    boss.hp = 1;
    boss.x = pylon.x + spec.range + 10;
    boss.y = pylon.y;
    // 보스는 플레이어를 추종해 움직이므로, 이동 없이 회복만 관찰하려고 전이 연출을 걸어 둔다.
    boss.timer = 10_000;

    for (let i = 0; i <= spec.periodTicks; i++) stepCoreRoom(w, ctx);
    expect(boss.hp).toBe(1); // 반경 밖
    expect(pylon.hp).toBe(1); // 자기 자신 제외
  });

  it('코어는 파일런 회복 대상이 아니다(코어를 깎는 국면이 사라지지 않게)', () => {
    const layers = layersWith({ props: props({ 0: PROP_REPAIR_PYLON }) });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const core = one(w, 'core');
    core.hp = core.maxHp - 1000;
    for (let i = 0; i <= L3_PROPS[PROP_REPAIR_PYLON]!.periodTicks * 2; i++) stepCoreRoom(w, ctx);
    expect(core.hp).toBe(core.maxHp - 1000);
  });
});

describe('L3 코어방 — 자폭 지뢰군', () => {
  it('주기마다 링 슬롯을 순서대로 돌며 단발 폭발 지뢰를 부설한다', () => {
    const layers = layersWith({ props: props({ 2: PROP_MINE_SWARM }), core: { x: 0, y: 0 } });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const spec = L3_PROPS[PROP_MINE_SWARM]!;
    const mine = one(w, L3_PROP_KIND as string);
    expect(mine.phase).toBe(0);

    for (let i = 0; i < spec.periodTicks; i++) stepCoreRoom(w, ctx);
    expect(live(w, 'hazard').length).toBe(0);

    // 슬롯 0 → 1 → 2 순서로 세 발을 관찰한다(좌표가 슬롯 인덱스의 순수 함수인지).
    for (let slot = 0; slot < 3; slot++) {
      stepCoreRoom(w, ctx);
      const hz = live(w, 'hazard')[slot]!;
      const off = mineRingOffset(spec, slot);
      expect(hz.enemyType).toBe(HAZARD_MORTAR);
      expect(hz.x).toBe(mine.x + off.x);
      expect(hz.y).toBe(mine.y + off.y);
      expect(hz.radius).toBe(spec.hazardRadius);
      expect(hz.timer).toBe(spec.hazardWindup);
      expect(hz.phase).toBe(0); // 단발(중력 앵커의 지속 감속과 갈린다)
      expect(hz.ownerId).toBe(mine.id);
      expect(mine.phase).toBe(slot + 1);
      for (let i = 0; i < spec.periodTicks; i++) stepCoreRoom(w, ctx);
    }
    // 지뢰는 플레이어 위치를 따라가지 않는다(중력 앵커와의 결정적 차이).
    expect(live(w, 'hazard')[0]!.x).not.toBe(w.entities[0]!.x);
  });

  it('링 좌표는 슬롯 수로 순환한다(커서가 자라도 좌표는 patternCount 주기)', () => {
    const spec = L3_PROPS[PROP_MINE_SWARM]!;
    for (let slot = 0; slot < spec.patternCount; slot++) {
      expect(mineRingOffset(spec, slot + spec.patternCount)).toEqual(mineRingOffset(spec, slot));
    }
  });
});

describe('L3 코어방 — 기만 홀로그램(가짜 코어)', () => {
  it('kind 가 decoyCore 이고 역할 코드를 실어 모듈 신기루와 구분된다', () => {
    const layers = layersWith({ props: props({ 4: PROP_DECOY_HOLOGRAM }) });
    const w = createWorld(1);
    enterCoreRoom(w, ctxOf(layers));
    expect(live(w, L3_PROP_KIND as string).length).toBe(0);
    const decoy = one(w, DECOY_HOLOGRAM_KIND as string);
    expect(decoy.enemyType).toBe(PROP_DECOY_HOLOGRAM);
    expect(decoy.pierce).toBe(4);
    const spec = L3_PROPS[PROP_DECOY_HOLOGRAM]!;
    expect(decoy.hp).toBe(scaleByBp(spec.hp, propPowerBp(1, 0, 0)));
    expect(decoy.radius).toBe(spec.radius);
    // 소켓 인덱스가 곧 좌표다(진짜 코어 곁에 서야 미끼가 성립한다).
    expect(decoy.x).toBe(PROP_SOCKET_OFFSETS[4]!.x);
    expect(decoy.y).toBe(PROP_SOCKET_OFFSETS[4]!.y);
  });

  it('홀로그램은 코어 보호막을 공급하지 않는다(실드 발생기와 혼동 금지)', () => {
    const layers = layersWith({ props: props({ 4: PROP_DECOY_HOLOGRAM }) });
    const w = createWorld(1);
    const ctx = ctxOf(layers);
    enterCoreRoom(w, ctx);
    const core = one(w, 'core');
    expect(core.targetY).toBe(0);
    stepCoreRoom(w, ctx);
    expect(core.targetY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 정규 경로 통합 — createWorld → stepWorld 로 실제 L3 런을 돌린다
//
// 이 프로젝트에서 여덟 번 재발한 결함이 "단위 테스트는 전부 그린인데 배선이 통째로 없다" 다.
// 위 케이스들은 coreRoom 모듈을 **직접** 부르므로, 신규 콘텐츠가 실제 런에서 스폰되지 않아도
// 전부 통과한다. 아래는 그 위를 덮는다: 배치를 config 에 실어 페이즈 머신이 L3 까지 밀고
// 들어간 뒤, 신규 보스·기물이 ①스폰되고 ②작동하며 ③플레이어에게 조준·피격되는지 본다.
// ---------------------------------------------------------------------------

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

/** 지정 보스·기물 배치를 실은 3레이어 침공 월드(정규 경로). */
function makeL3World(
  bossId: number,
  propIds: readonly (number | null)[],
  seed = 11,
): WorldState {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  config.invasion3 = {
    layers: normalizeInvasionLayers({
      l3: {
        boss: REF(bossId),
        guardians: [null, null],
        props: PROP_SOCKET_OFFSETS.map((_, i) => {
          const id = propIds[i];
          return id === undefined || id === null ? null : REF(id);
        }),
      },
    }),
    timeLimitTicks: INVASION_TOTAL_TICKS,

    maintenance: MAINTENANCE_FULL,
  };
  return createWorld(seed, config);
}

/**
 * 한 틱 진행하되 레벨업 대기 프레임은 0번 선택으로 소비한다. 소비하지 않으면 stepWorld 가
 * 월드를 정지시킨 채 tick 만 올려 페이즈 전이가 영원히 오지 않는다(invasionIntegration 선례).
 */
function stepOne(state: WorldState): void {
  stepWorld(state, state.pendingLevelUp ? { ...IDLE, special: packPowerupPick(0) } : IDLE);
}

/** L3 에 들어갈 때까지(또는 상한까지) 정규 경로로 돌린다. */
function runToL3(state: WorldState): void {
  for (let t = 0; t < INVASION_TOTAL_TICKS && !state.gameOver; t++) {
    if (state.invasion3?.phase === PHASE_L3) return;
    stepOne(state);
  }
}

/** 표적 위에 아군탄을 직접 놓는다(충돌 화이트리스트만 관찰하기 위한 최소 장치). */
function placeBulletOn(state: WorldState, target: Entity, damage: number): void {
  const b = blankEntity('bullet');
  b.x = target.x;
  b.y = target.y;
  b.radius = 8;
  b.damage = damage;
  b.life = 60;
  b.hp = 1;
  b.maxHp = 1;
  b.id = state.nextEntityId++;
  state.entities.push(b);
}

describe('L3 코어방 — 정규 경로 통합(M7c 신규 콘텐츠)', () => {
  for (const bossId of [1, 2]) {
    it(`신규 보스 ${bossId}(${DEFENSE_BOSSES[bossId]!.id})가 실제 런에서 스폰·캐스트·피격된다`, () => {
      const w = makeL3World(bossId, []);
      runToL3(w);
      expect(w.invasion3?.phase).toBe(PHASE_L3);
      const boss = w.entities.find((e) => e.kind === DEFENSE_BOSS_KIND && !e.dead);
      expect(boss).toBeDefined();
      expect(boss!.enemyType).toBe(bossId);

      // ① 캐스트가 실제로 나간다(스텝 훅이 안 걸려 있으면 영원히 0 이다).
      const cast = DEFENSE_BOSSES[bossId]!.phases[0].patternCooldown;
      for (let i = 0; i <= cast + 2; i++) stepOne(w);
      const fired = w.entities.some(
        (e) => !e.dead && (e.kind === 'enemyBullet' || e.kind === 'hazard'),
      );
      expect(fired).toBe(true);

      // ② 아군탄에 피해를 받는다(충돌 화이트리스트 누락이면 조용히 무적으로 남는다).
      const before = boss!.hp;
      placeBulletOn(w, boss!, 120);
      stepOne(w);
      expect(boss!.hp).toBeLessThan(before);
    });
  }

  it('신규 기물 3종이 실제 런에서 스폰되고 자동 조준에 실제로 깎인다', () => {
    // 소켓 0=회복 파일런, 1=기만 홀로그램, 2=자폭 지뢰군.
    const w = makeL3World(0, [PROP_REPAIR_PYLON, PROP_DECOY_HOLOGRAM, PROP_MINE_SWARM]);
    runToL3(w);
    expect(w.invasion3?.phase).toBe(PHASE_L3);

    const pylon = w.entities.find((e) => e.kind === L3_PROP_KIND && e.enemyType === PROP_REPAIR_PYLON);
    const mine = w.entities.find((e) => e.kind === L3_PROP_KIND && e.enemyType === PROP_MINE_SWARM);
    const decoy = w.entities.find(
      (e) => e.kind === DECOY_HOLOGRAM_KIND && e.enemyType === PROP_DECOY_HOLOGRAM,
    );
    expect(pylon).toBeDefined();
    expect(mine).toBeDefined();
    expect(decoy).toBeDefined();

    // 자동 조준(isPlayerTargetable) + 충돌 격자 등록을 한 번에 관찰한다: 표적 옆에 플레이어를
    // 세워 두면 자동 사격이 그 표적을 골라 깎아야 한다. 술어에서 빠져 있으면 영원히 만피다.
    for (const target of [pylon!, mine!, decoy!]) {
      const before = target.hp;
      const player = w.entities[0]!;
      for (let i = 0; i < 90; i++) {
        // 스크롤 창 클램프가 플레이어를 되돌릴 수 있으므로 매 틱 표적 옆에 다시 세운다.
        player.x = target.x + 70;
        player.y = target.y;
        stepOne(w);
      }
      expect(target.hp).toBeLessThan(before);
    }
  });

  it('자폭 지뢰군이 실제 런에서 지뢰를 부설하고 회복 파일런이 손상된 보스를 되살린다', () => {
    const w = makeL3World(1, [PROP_REPAIR_PYLON, null, PROP_MINE_SWARM]);
    runToL3(w);
    const mine = w.entities.find((e) => e.kind === L3_PROP_KIND && e.enemyType === PROP_MINE_SWARM)!;
    const boss = w.entities.find((e) => e.kind === DEFENSE_BOSS_KIND && !e.dead)!;
    // 보스를 파일런 곁으로 끌어다 놓고 전이 연출로 고정한 뒤 회복만 관찰한다.
    const pylon = w.entities.find(
      (e) => e.kind === L3_PROP_KIND && e.enemyType === PROP_REPAIR_PYLON,
    )!;
    boss.x = pylon.x;
    boss.y = pylon.y;
    boss.hp = 100;
    boss.timer = 10_000;

    // 지뢰 주기와 파일런 주기 중 **긴 쪽**을 넘겨야 둘 다 최소 1회 발동한다.
    const period = Math.max(
      L3_PROPS[PROP_MINE_SWARM]!.periodTicks,
      L3_PROPS[PROP_REPAIR_PYLON]!.periodTicks,
    );
    for (let i = 0; i <= period + 4; i++) stepOne(w);

    expect(
      w.entities.some((e) => e.kind === 'hazard' && !e.dead && e.ownerId === mine.id),
    ).toBe(true);
    expect(boss.hp).toBeGreaterThan(100);
  });

  it('기만 홀로그램을 파괴해도 victory 가 서지 않는다(진짜 코어만 승리 조건)', () => {
    const w = makeL3World(0, [PROP_DECOY_HOLOGRAM]);
    runToL3(w);
    const decoy = w.entities.find((e) => e.kind === DECOY_HOLOGRAM_KIND && !e.dead)!;
    const core = w.entities.find((e) => e.kind === 'core' && !e.dead)!;

    // 실제 피격 경로로 부순다(직접 hp=0 은 compact 의 격파 분기를 타지 않는다).
    placeBulletOn(w, decoy, decoy.hp + 100);
    stepOne(w);
    expect(w.entities.some((e) => e.kind === DECOY_HOLOGRAM_KIND && !e.dead)).toBe(false);
    expect(w.victory).toBe(false);
    expect(w.gameOver).toBe(false);

    // 대조군: 진짜 코어를 부수면 L3 이므로 승리가 선다.
    placeBulletOn(w, core, core.hp + core.targetY + 100);
    stepOne(w);
    expect(w.victory).toBe(true);
  });

  it('신규 콘텐츠가 섞인 L3 런도 RNG 를 소비하지 않고 재현된다', () => {
    const run = (): string => {
      const w = makeL3World(2, [
        PROP_REPAIR_PYLON,
        PROP_DECOY_HOLOGRAM,
        PROP_MINE_SWARM,
        PROP_SHIELD_GENERATOR,
      ]);
      runToL3(w);
      const rngBefore = JSON.stringify([w.rng, w.waveRng, w.dropRng, w.eliteRng]);
      for (let i = 0; i < 300; i++) stepOne(w);
      // L3 는 적 스폰이 없어 웨이브 스트림이 움직이면 안 된다(summonEnemy 규율).
      expect(JSON.stringify([w.waveRng])).toBe(JSON.stringify([JSON.parse(rngBefore)[1]]));
      return JSON.stringify(w.entities);
    };
    expect(run()).toBe(run());
  });
});
