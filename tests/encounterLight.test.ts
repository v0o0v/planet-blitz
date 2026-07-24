/**
 * 경량 조우 4종(오스카 제단 · 봉인 수호자 · 기록 파편우 · 유령 보급선단) — sim 코어 검증.
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다"(8+회)라, 정규 경로
 * 통합은 레인 A 의 `stepEncounter` 착지 후 별도 레인이 덮는다. 이 파일은 그 앞단 — 계약이
 * 확정된 진입점 `stepLightEncounter` 를 **직접** 호출해 상태 전이·보상 경로·결정론 규율을
 * 못 박는다(런 전체를 돌리지 않고 `createWorld` + 수동 런타임 주입).
 *
 * 핵심 방어 3종:
 *   (A) **RNG 미소비** — 4종 전부 실행 전후로 7개 스트림의 `getState()` 가 바이트 불변.
 *       하나라도 밀리면 조우 발생 런의 웨이브·드랍 시퀀스가 기존 PvE 골든과 갈린다.
 *   (B) **xp 누수 0** — 파편우가 젬을 단 하나도 스폰하지 않고 xp/level/combo 가 불변.
 *   (C) **거부 = 무발생** — DECLINE 이후 어떤 상태도 변하지 않는다(AC5).
 */
import { describe, it, expect } from 'vitest';
import { createWorld, emptyInput } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { spawnEncounterAltar } from '../src/sim/entities.js';
import type { EncounterRuntime } from '../src/sim/encounter.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import {
  ENCOUNTER_TYPE,
  SPECIAL_ENCOUNTER_ENTER,
  SPECIAL_ENCOUNTER_DECLINE,
  packEncounterAltar,
} from '../data/encounters.js';
import {
  stepLightEncounter,
  auxCounterA,
  auxCounterB,
  auxAltarIndex,
  encounterShardCollectedOf,
  ALTAR_INSTANT_LOOT_COUNT,
  ALTAR_INSTANT_LOOT_RARITY,
  ALTAR_INSTANT_CREDITS,
  ALTAR_BOOST_DROP_MULT,
  ALTAR_CHEST_LOOT_COUNT,
  ALTAR_CHEST_LOOT_RARITY,
  GUARDIAN_LOOT_COUNT,
  GUARDIAN_LOOT_RARITY,
  GUARDIAN_CREDITS,
  SEALED_GUARDIAN_MARK,
  SHARD_RAIN_COUNT,
  SHARD_RAIN_INTERVAL_TICKS,
  SHARD_RAIN_TIMEOUT_TICKS,
  SHARD_RAIN_CREDITS_PER,
  SHARD_RAIN_MARK,
  GHOST_CONVOY_COUNT,
  GHOST_CONVOY_BONUS_CREDITS,
  GHOST_CONVOY_MARK,
} from '../src/sim/encounters/light.js';

/** 런이 접촉·피격으로 조기 종료되지 않게 버티는 무대 HP. */
const DURABLE_HP = 100_000_000;

/** 뱀서류(planet0=vampire) PvE 런 설정. */
function vampireConfig(): WorldConfig {
  return { ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }), playerHp: DURABLE_HP };
}

function makeWorld(): WorldState {
  return createWorld(12345, vampireConfig());
}

function playerOf(w: WorldState): Entity {
  const p = w.entities[0];
  if (p === undefined) throw new Error('player missing');
  return p;
}

/**
 * 출현(state=1) 상태의 런타임을 만든다. `entityId=0` 은 오브젝트 없는 유형용 — 레인 A 의
 * `maybeSpawnEncounter` 는 보물 격실/제단에만 오브젝트를 세우고 나머지 3종은 `entityId=0`
 * 인 채로 state 만 1 로 올린다. 이 팩토리는 그 실제 계약을 그대로 흉내 낸다.
 */
function runtime(type: number, entityId = 0, spawnTick = 0): EncounterRuntime {
  return {
    state: 1,
    type,
    spawnTick,
    entityId,
    inDetour: 0,
    savedX: 0,
    savedY: 0,
    detourTimer: 0,
    aux: 0,
  };
}

function step(w: WorldState, rt: EncounterRuntime, input: InputFrame = emptyInput()): void {
  stepLightEncounter(w, playerOf(w), rt, input);
}

function inputWith(special: number): InputFrame {
  return { ...emptyInput(), special };
}

/** 7개 RNG 스트림의 현재 상태 스냅샷(미소비 회귀 가드의 정본). */
function rngStates(w: WorldState): number[] {
  return [
    w.rng.getState(),
    w.waveRng.getState(),
    w.powerupRng.getState(),
    w.supplyRng.getState(),
    w.worldRng.getState(),
    w.dropRng.getState(),
    w.eliteRng.getState(),
  ];
}

/** 제단을 플레이어 바로 옆에 세우고 런타임에 물린다(레인 A 의 스폰 틱 동작을 대역). */
function placeAltar(w: WorldState, rt: EncounterRuntime): Entity {
  const p = playerOf(w);
  const a = spawnEncounterAltar(w, p.x, p.y, 120);
  rt.entityId = a.id;
  return a;
}

// ---------------------------------------------------------------------------
// ① 오스카 제단
// ---------------------------------------------------------------------------

describe('오스카 제단 3택', () => {
  it('선택 0(즉시 보상) — 등급 강제 전리품 + 크레딧, 제단 소멸, state=3', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.oscarAltar);
    const altar = placeAltar(w, rt);
    const credits0 = w.resources;

    step(w, rt, inputWith(packEncounterAltar(0)));

    expect(rt.state).toBe(3);
    expect(auxAltarIndex(rt.aux)).toBe(0);
    expect(w.loot).toHaveLength(ALTAR_INSTANT_LOOT_COUNT);
    expect(w.loot[0]?.rarity).toBe(ALTAR_INSTANT_LOOT_RARITY);
    expect(w.resources - credits0).toBe(ALTAR_INSTANT_CREDITS);
    expect(altar.dead).toBe(true);
  });

  it('선택 1(부스트) — catalystMods.drop 에 배율이 곱해지고 전리품은 없다', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.oscarAltar);
    placeAltar(w, rt);
    const drop0 = w.catalystMods.drop;

    step(w, rt, inputWith(packEncounterAltar(1)));

    expect(rt.state).toBe(3);
    expect(auxAltarIndex(rt.aux)).toBe(1);
    expect(w.catalystMods.drop).toBeCloseTo(drop0 * ALTAR_BOOST_DROP_MULT, 10);
    expect(w.loot).toHaveLength(0);
  });

  it('선택 2(봉인 상자) — 최저 등급 다수 지급', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.oscarAltar);
    placeAltar(w, rt);

    step(w, rt, inputWith(packEncounterAltar(2)));

    expect(rt.state).toBe(3);
    expect(auxAltarIndex(rt.aux)).toBe(2);
    expect(w.loot).toHaveLength(ALTAR_CHEST_LOOT_COUNT);
    for (const l of w.loot) expect(l.rarity).toBe(ALTAR_CHEST_LOOT_RARITY);
  });

  it('범위 밖 인덱스(3)는 선택을 소비하지 않는다 — pending 유지', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.oscarAltar);
    const altar = placeAltar(w, rt);

    step(w, rt, inputWith(packEncounterAltar(3)));

    expect(rt.state).toBe(1); // 여전히 출현 상태
    expect(w.loot).toHaveLength(0);
    expect(altar.dead).toBe(false);

    // 이어서 유효한 인덱스를 누르면 정상 확정된다(선택이 조용히 날아가지 않았다는 증거).
    step(w, rt, inputWith(packEncounterAltar(0)));
    expect(rt.state).toBe(3);
    expect(w.loot).toHaveLength(ALTAR_INSTANT_LOOT_COUNT);
  });

  it('반경 밖에서 누른 프레임도 소비되지 않는다', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.oscarAltar);
    const p = playerOf(w);
    const altar = spawnEncounterAltar(w, p.x + 100_000, p.y, 120);
    rt.entityId = altar.id;

    step(w, rt, inputWith(packEncounterAltar(0)));

    expect(rt.state).toBe(1);
    expect(w.loot).toHaveLength(0);
  });

  it('DECLINE — state=4 로 끝나고 이후 어떤 상태도 변하지 않는다(AC5)', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.oscarAltar);
    const altar = placeAltar(w, rt);

    step(w, rt, inputWith(SPECIAL_ENCOUNTER_DECLINE));
    expect(rt.state).toBe(4);
    expect(altar.dead).toBe(true);

    const credits0 = w.resources;
    const auxAfterDecline = rt.aux;
    // 거부 이후 제단 선택을 아무리 눌러도 보상이 나가지 않는다.
    for (let i = 0; i < 10; i++) step(w, rt, inputWith(packEncounterAltar(0)));
    expect(rt.state).toBe(4);
    expect(rt.aux).toBe(auxAfterDecline);
    expect(w.loot).toHaveLength(0);
    expect(w.resources).toBe(credits0);
  });
});

// ---------------------------------------------------------------------------
// ② 봉인 수호자
// ---------------------------------------------------------------------------

describe('봉인 수호자', () => {
  it('개방 → 마커 정예 소환(진행중) → 처치 → 등급 강제 전리품 + 크레딧(완료)', () => {
    const w = makeWorld();
    // 레인 A 는 수호자에 오브젝트를 세우지 않는다(entityId=0) — 개방은 입력 게이트만이다.
    const rt = runtime(ENCOUNTER_TYPE.sealedGuardian);
    const credits0 = w.resources;

    // 입력 없이는 개방되지 않는다.
    step(w, rt);
    expect(rt.state).toBe(1);

    step(w, rt, inputWith(SPECIAL_ENCOUNTER_ENTER));
    expect(rt.state).toBe(2);
    const guards = w.entities.filter((e) => e.kind === 'enemy' && e.aux1 === SEALED_GUARDIAN_MARK);
    expect(guards).toHaveLength(1);
    const g = guards[0];
    if (g === undefined) throw new Error('guardian missing');
    expect(g.hp).toBe(g.maxHp);
    expect(Number.isInteger(g.hp)).toBe(true);
    // 개방 틱에는 처치 판정을 하지 않는다.
    expect(w.loot).toHaveLength(0);

    // 아직 살아 있으면 보상이 없다.
    step(w, rt);
    expect(rt.state).toBe(2);
    expect(w.loot).toHaveLength(0);

    // 처치(=엔티티 소멸)를 대역하고 나면 보상이 나간다.
    g.dead = true;
    step(w, rt);
    expect(rt.state).toBe(3);
    expect(auxCounterB(rt.aux)).toBe(1);
    expect(w.loot).toHaveLength(GUARDIAN_LOOT_COUNT);
    expect(w.loot[0]?.rarity).toBe(GUARDIAN_LOOT_RARITY);
    expect(w.resources - credits0).toBe(GUARDIAN_CREDITS);

    // 완료 후 반복 호출해도 2중 지급이 없다.
    for (let i = 0; i < 5; i++) step(w, rt);
    expect(w.loot).toHaveLength(GUARDIAN_LOOT_COUNT);
    expect(w.resources - credits0).toBe(GUARDIAN_CREDITS);
  });

  it('마커는 aux1 이다 — ownerId(냉기 감속 잔여 틱)와 충돌하지 않는다', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.sealedGuardian);
    step(w, rt, inputWith(SPECIAL_ENCOUNTER_ENTER));

    const g = w.entities.find((e) => e.kind === 'enemy' && e.aux1 === SEALED_GUARDIAN_MARK);
    if (g === undefined) throw new Error('guardian missing');
    // 냉기 상태이상이 쓰는 슬롯은 비어 있어야 한다(마커가 거기 없다).
    expect(g.ownerId).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ③ 기록 파편우
// ---------------------------------------------------------------------------

describe('기록 파편우', () => {
  it('젬을 하나도 스폰하지 않고 xp/level/combo 가 불변이다(xp 누수 회귀 가드)', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.shardRain, 0, w.tick);
    const before = { xp: w.xp, xpTotal: w.xpTotal, level: w.level, combo: w.combo, kills: w.kills };

    for (let i = 0; i < SHARD_RAIN_COUNT; i++) {
      step(w, rt);
      w.tick += SHARD_RAIN_INTERVAL_TICKS;
    }

    expect(w.entities.filter((e) => e.kind === 'gem')).toHaveLength(0);
    expect(w.xp).toBe(before.xp);
    expect(w.xpTotal).toBe(before.xpTotal);
    expect(w.level).toBe(before.level);
    expect(w.combo).toBe(before.combo);
    expect(w.kills).toBe(before.kills);
  });

  it('간격에 맞춰 마커 loot 을 하나씩 뿌리고 카운터 A 가 따라 오른다', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.shardRain, 0, w.tick);

    step(w, rt);
    expect(auxCounterA(rt.aux)).toBe(1);
    // 같은 틱에 다시 불러도 간격 전이라 더 뿌리지 않는다.
    step(w, rt);
    expect(auxCounterA(rt.aux)).toBe(1);

    w.tick += SHARD_RAIN_INTERVAL_TICKS;
    step(w, rt);
    expect(auxCounterA(rt.aux)).toBe(2);

    const shards = w.entities.filter((e) => e.kind === 'loot' && e.ownerId === SHARD_RAIN_MARK);
    expect(shards).toHaveLength(2);
    // 좌표가 서로 달라야 한다(고정 원형 패턴 — 한 점에 겹쳐 쌓이면 패턴이 죽은 것).
    expect(shards[0]?.x === shards[1]?.x && shards[0]?.y === shards[1]?.y).toBe(false);
  });

  it('수집분만큼 크레딧을 정산하고(멱등) 전부 수집되면 완료 + 파편 플래그가 선다', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.shardRain, 0, w.tick);
    const credits0 = w.resources;

    // 전부 뿌린다.
    for (let i = 0; i < SHARD_RAIN_COUNT; i++) {
      step(w, rt);
      w.tick += SHARD_RAIN_INTERVAL_TICKS;
    }
    expect(auxCounterA(rt.aux)).toBe(SHARD_RAIN_COUNT);
    expect(w.resources).toBe(credits0); // 아직 아무것도 수집 안 함

    // 하나 수집(= collectLoot 이 dead 로 표시하는 것과 동형) → 크레딧 1건.
    const shards = w.entities.filter((e) => e.kind === 'loot' && e.ownerId === SHARD_RAIN_MARK);
    const first = shards[0];
    if (first === undefined) throw new Error('shard missing');
    first.dead = true;
    step(w, rt);
    expect(w.resources - credits0).toBe(SHARD_RAIN_CREDITS_PER);
    expect(auxCounterB(rt.aux)).toBe(1);
    // 같은 상태로 반복 호출해도 2중 지급 없음(멱등).
    step(w, rt);
    step(w, rt);
    expect(w.resources - credits0).toBe(SHARD_RAIN_CREDITS_PER);

    // 나머지 전부 수집 → 완료 + 기록 파편 플래그.
    for (const s of shards) s.dead = true;
    step(w, rt);
    expect(rt.state).toBe(3);
    expect(auxCounterB(rt.aux)).toBe(SHARD_RAIN_COUNT);
    expect(w.resources - credits0).toBe(SHARD_RAIN_COUNT * SHARD_RAIN_CREDITS_PER);
    expect(encounterShardCollectedOf(rt)).toBe(true);
  });

  it('전부 무시해도 하드 타임아웃에서 완료되고, 미수집이면 파편 플래그가 서지 않는다', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.shardRain, 0, w.tick);

    w.tick += SHARD_RAIN_TIMEOUT_TICKS;
    step(w, rt);

    expect(rt.state).toBe(3);
    expect(auxCounterB(rt.aux)).toBe(0);
    expect(encounterShardCollectedOf(rt)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ④ 유령 보급선단
// ---------------------------------------------------------------------------

describe('유령 보급선단', () => {
  it('편대를 고정 오프셋에 한 번에 스폰하고 마커를 단다', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.ghostConvoy, 0, w.tick);

    step(w, rt);

    expect(rt.state).toBe(2);
    expect(auxCounterA(rt.aux)).toBe(GHOST_CONVOY_COUNT);
    const convoy = w.entities.filter((e) => e.kind === 'supply' && e.ownerId === GHOST_CONVOY_MARK);
    expect(convoy).toHaveLength(GHOST_CONVOY_COUNT);
    for (const s of convoy) expect(s.vx).toBeLessThan(0); // 전부 같은 방향으로 횡단
    // Y 가 서로 달라야 편대다.
    expect(new Set(convoy.map((s) => s.y)).size).toBe(GHOST_CONVOY_COUNT);
  });

  it('전멸/이탈로 편대가 사라지면 보너스 크레딧 + 완료', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.ghostConvoy, 0, w.tick);
    const credits0 = w.resources;

    step(w, rt);
    // 살아 있는 동안엔 보너스가 없다.
    step(w, rt);
    expect(rt.state).toBe(2);
    expect(w.resources).toBe(credits0);

    for (const s of w.entities) {
      if (s.kind === 'supply' && s.ownerId === GHOST_CONVOY_MARK) s.dead = true;
    }
    step(w, rt);
    expect(rt.state).toBe(3);
    expect(w.resources - credits0).toBe(GHOST_CONVOY_BONUS_CREDITS);

    // 완료 후 반복 호출해도 2중 지급 없음.
    for (let i = 0; i < 5; i++) step(w, rt);
    expect(w.resources - credits0).toBe(GHOST_CONVOY_BONUS_CREDITS);
  });
});

// ---------------------------------------------------------------------------
// 공통 규율 — RNG 미소비 · 보물 격실 no-op
// ---------------------------------------------------------------------------

describe('결정론 규율', () => {
  it('4종 전부 실행 전후로 7개 RNG 스트림 상태가 불변이다', () => {
    const cases: { type: number; withObject: boolean; inputs: InputFrame[] }[] = [
      {
        type: ENCOUNTER_TYPE.oscarAltar,
        withObject: true,
        inputs: [inputWith(packEncounterAltar(0)), emptyInput()],
      },
      {
        type: ENCOUNTER_TYPE.sealedGuardian,
        withObject: false, // 레인 A 는 수호자에 오브젝트를 세우지 않는다.
        inputs: [inputWith(SPECIAL_ENCOUNTER_ENTER), emptyInput(), emptyInput()],
      },
      { type: ENCOUNTER_TYPE.shardRain, withObject: false, inputs: [] },
      { type: ENCOUNTER_TYPE.ghostConvoy, withObject: false, inputs: [] },
    ];

    for (const c of cases) {
      const w = makeWorld();
      const rt = runtime(c.type, 0, w.tick);
      if (c.withObject) placeAltar(w, rt);
      const before = rngStates(w);

      for (const input of c.inputs) step(w, rt, input);
      // 입력 없이도 충분히 돌려 스폰·정산 경로를 전부 태운다.
      for (let i = 0; i < SHARD_RAIN_COUNT + 2; i++) {
        step(w, rt);
        w.tick += SHARD_RAIN_INTERVAL_TICKS;
      }

      expect(rngStates(w), `type=${c.type}`).toEqual(before);
    }
  });

  it('보물 격실 유형은 즉시 no-op 이다(레인 A 의 detour 소관)', () => {
    const w = makeWorld();
    const rt = runtime(ENCOUNTER_TYPE.treasureVault, 0, w.tick);
    const before = rngStates(w);
    const entities0 = w.entities.length;

    for (let i = 0; i < 10; i++) step(w, rt, inputWith(SPECIAL_ENCOUNTER_ENTER));

    expect(rt.state).toBe(1);
    expect(rt.aux).toBe(0);
    expect(w.entities).toHaveLength(entities0);
    expect(w.loot).toHaveLength(0);
    expect(rngStates(w)).toEqual(before);
  });
});
