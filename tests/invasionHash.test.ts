/**
 * 침공 3레이어 해시 계약 (M7a · L1-determinism).
 *
 * 검증 대상은 세 가지다.
 *   ① 재현성 — 같은 layers·seed 로 두 번 돌리면 해시 스트림이 100% 일치한다.
 *   ② 봉인 완전성 — layers 의 **어떤 필드를 변조해도** 해시가 갈린다. 케이스는 하드코딩이
 *      아니라 스키마에서 파생하므로(enumerateLayerFields), 필드가 늘어도 테스트가 자동으로
 *      커진다 = "대조 누락 = 위조 프리패스"가 구조적으로 불가능하다.
 *   ③ 레이아웃 계약 — KIND_CODE 코드 번호와 hashEntity 필드 순서를 골든으로 못박는다.
 *      (해시 레이아웃 변경은 곧 리플레이 포맷 변경이라 조용히 일어나면 안 된다.)
 */

import { describe, it, expect } from 'vitest';
import { createWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import {
  ENTITY_HASH_LAYOUT,
  ENTITY_HASH_OPTIONAL_TAIL,
  hashEntity,
  hashWorld,
  idleInputs,
  stepThrough,
} from '../src/sim/replay.js';
import { KIND_CODE, blankEntity } from '../src/sim/entities.js';
import type { Entity, EntityKind } from '../src/sim/entities.js';
import {
  INVASION_TOTAL_TICKS,
  INVASION_ACCEL_BASE_CP,
  PHASE_L1,
} from '../src/sim/invasion/constants.js';
import {
  SAMPLE_GUARDIAN,
  SAMPLE_REF,
  emptyInvasionLayers,
  enumerateLayerFields,
  mutateLayerField,
  normalizeInvasionLayers,
} from '../src/sim/invasion/normalize.js';
import type { InvasionLayers, InvasionRuntime } from '../src/sim/invasion/types.js';

// ---------------------------------------------------------------------------
// 하네스 — world.ts 배선(L2 레인 소유) 없이 해시 계약만 단독 검증한다.
// hashWorld 는 상태의 순수 함수이므로, 3레이어 설정·런타임을 상태에 직접 실어 접기를 본다.
// ---------------------------------------------------------------------------

interface Invasion3State {
  config: { invasion3?: { layers: InvasionLayers; timeLimitTicks: number; maintenance?: number } };
  // 통합 게이트 정정: 정본 필드명은 world.ts 의 `invasion3` 다(최초 계약안의
  // `invasionRuntime` 은 실재하지 않아 런타임 폴드가 항상 present=0 으로 접혔다).
  invasion3?: InvasionRuntime;
}

function baseRuntime(): InvasionRuntime {
  return {
    phase: PHASE_L1 as InvasionRuntime['phase'],
    phaseEnterTick: 0,
    scrollX: 0,
    scrollY: 0,
    accelCp: INVASION_ACCEL_BASE_CP,
  };
}

/** 3레이어 설정·런타임을 실은 월드. DEFAULT_CONFIG 는 복제해서 전역 오염을 막는다. */
function makeInvasionState(seed: number, layers: InvasionLayers, runtime?: InvasionRuntime): WorldState {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  const state = createWorld(seed, config);
  const s = state as unknown as Invasion3State;
  s.config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 8000 };
  s.invasion3 = runtime ?? baseRuntime();
  return state;
}

/** 모든 슬롯이 채워진 배치 — 필드 전수 변조의 커버리지를 최대로 만든다. */
function filledLayers(): InvasionLayers {
  const empty = emptyInvasionLayers();
  return normalizeInvasionLayers({
    l1: { waveSlots: empty.l1.waveSlots.map(() => SAMPLE_REF) },
    l2: { templateId: 0, sockets: new Array(12).fill(SAMPLE_REF) },
    l3: {
      boss: SAMPLE_REF,
      guardians: empty.l3.guardians.map(() => SAMPLE_GUARDIAN),
      props: empty.l3.props.map(() => SAMPLE_REF),
      core: { hp: 8000, x: 0, y: -1200 },
      modules: empty.l3.modules.map(() => SAMPLE_REF),
    },
  });
}

/** 같은 상태를 재사용해 layers 만 갈아끼우며 해시를 뽑는다(케이스 200여 건이라 빠른 경로). */
function hashWithLayers(state: WorldState, layers: InvasionLayers): number {
  const s = state as unknown as Invasion3State;
  s.config.invasion3!.layers = layers;
  return hashWorld(state);
}

describe('침공 3레이어 해시 v2 — 재현성', () => {
  it('같은 layers·seed 로 두 번 재실행하면 해시 스트림이 100% 일치한다', () => {
    const layers = filledLayers();
    const inputs = idleInputs(120);
    const a = stepThrough(makeInvasionState(4242, layers), inputs);
    const b = stepThrough(makeInvasionState(4242, normalizeInvasionLayers(layers)), inputs);
    expect(a.length).toBe(120);
    expect(a).toEqual(b);
  });

  it('3레이어 설정이 없으면 v2 블록을 통째로 건너뛴다(PvE 바이트 불변 규율)', () => {
    const pveA = createWorld(99, { ...DEFAULT_CONFIG } as WorldConfig);
    const pveB = createWorld(99, { ...DEFAULT_CONFIG } as WorldConfig);
    expect(hashWorld(pveA)).toBe(hashWorld(pveB));
    // 같은 시드·같은 엔티티인데 3레이어 설정만 얹으면 해시가 갈린다 = 블록이 실제로 접힌다.
    const inv = makeInvasionState(99, emptyInvasionLayers());
    expect(hashWorld(inv)).not.toBe(hashWorld(pveA));
  });

  it('빈 배치와 가득 찬 배치는 해시가 갈린다', () => {
    const state = makeInvasionState(7, emptyInvasionLayers());
    expect(hashWithLayers(state, emptyInvasionLayers())).not.toBe(
      hashWithLayers(state, filledLayers()),
    );
  });
});

describe('침공 3레이어 해시 v2 — 필드 전수 봉인', () => {
  const base = filledLayers();
  const fields = enumerateLayerFields(base);

  it('열거된 변조 지점이 스키마 규모에 걸맞게 충분히 많다(파생이 죽지 않았는지 방어)', () => {
    // 수치 리프(Ref 5필드 × 27슬롯 + 수호 17 × 2 + 코어 3 + templateId) + 슬롯 29.
    expect(fields.length).toBeGreaterThan(150);
    expect(fields.some((f) => f.kind === 'slot')).toBe(true);
    expect(fields.some((f) => f.path.startsWith('l3.guardians[0].snapshot.'))).toBe(true);
  });

  it.each(fields.map((f) => [f.path, f] as const))(
    '%s 를 변조하면 첫 틱부터 해시가 발산한다',
    (_path, field) => {
      const mutated = mutateLayerField(base, field);
      // mutateLayerField 가 null 이면 "변조해도 정규형이 같다" = 그 필드는 애초에 봉인 대상이
      // 아니라는 뜻인데, 정규형 전체가 해시 대상이므로 그런 필드는 존재해선 안 된다.
      expect(mutated).not.toBeNull();
      const state = makeInvasionState(11, base);
      expect(hashWithLayers(state, mutated as InvasionLayers)).not.toBe(
        hashWithLayers(state, base),
      );
    },
  );

  it('제한 시간·정비도도 봉인된다', () => {
    const state = makeInvasionState(3, filledLayers());
    const s = state as unknown as Invasion3State;
    const h0 = hashWorld(state);
    s.config.invasion3!.timeLimitTicks = INVASION_TOTAL_TICKS - 1;
    expect(hashWorld(state)).not.toBe(h0);
    s.config.invasion3!.timeLimitTicks = INVASION_TOTAL_TICKS;
    expect(hashWorld(state)).toBe(h0);
    s.config.invasion3!.maintenance = 5000;
    expect(hashWorld(state)).not.toBe(h0);
  });
});

describe('침공 3레이어 해시 v2 — 런타임 페이즈 상태', () => {
  const runtimeFields: (keyof InvasionRuntime)[] = [
    'phase',
    'phaseEnterTick',
    'scrollX',
    'scrollY',
    'accelCp',
  ];

  it.each(runtimeFields)('런타임 %s 이 달라지면 해시가 갈린다', (key) => {
    const layers = filledLayers();
    const state = makeInvasionState(21, layers);
    const h0 = hashWorld(state);
    const s = state as unknown as Invasion3State;
    const rt = s.invasion3 as unknown as Record<string, number>;
    rt[key as string] = (rt[key as string] as number) + 1;
    expect(hashWorld(state)).not.toBe(h0);
  });

  it('전이 틱만 다른 두 런은 엔티티가 같아도 해시가 갈린다(전이 결정성 봉인)', () => {
    const layers = filledLayers();
    const early = makeInvasionState(5, layers, { ...baseRuntime(), phase: 1, phaseEnterTick: 4800 });
    const late = makeInvasionState(5, layers, { ...baseRuntime(), phase: 1, phaseEnterTick: 5400 });
    expect(hashWorld(early)).not.toBe(hashWorld(late));
  });
});

// ---------------------------------------------------------------------------
// 레이아웃 골든
// ---------------------------------------------------------------------------

describe('엔티티 해시 레이아웃 계약', () => {
  it('KIND_CODE 는 append-only 다(기존 코드 재배치 금지)', () => {
    // 골든: 코드 1..18 은 M1~M6 확정분, 19..26 은 M7a 3레이어 예약분.
    // **15 는 영구 결번**이다 — 구 defenseTurret 이 L11(레거시 삭제)에서 사라졌지만 번호를
    // 당기지 않았다. 당기면 core(16) 이하가 전부 재배치돼 기존 리플레이·fixture 가 통째로
    // 갈린다(append-only 계약의 핵심은 '번호 재사용·재배치 금지'이지 '연속'이 아니다).
    expect(KIND_CODE).toEqual({
      player: 1,
      enemy: 2,
      bullet: 3,
      enemyBullet: 4,
      hazard: 5,
      gem: 6,
      supply: 7,
      boss: 8,
      wall: 9,
      destructible: 10,
      magnetEmitter: 11,
      bombDevice: 12,
      turretPickup: 13,
      loot: 14,
      core: 16,
      guardian: 17,
      decoyCore: 18,
      formation: 19,
      formationDrone: 20,
      facilityGun: 21,
      facilityHazard: 22,
      facilitySpawner: 23,
      spawnedDrone: 24,
      prop: 25,
      defenseBoss: 26,
    });
    // 코드 값은 전역 유일해야 한다(중복은 서로 다른 kind 를 같은 해시로 접는다).
    const codes = Object.values(KIND_CODE);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('3레이어 신규 kind 8종이 전부 등록돼 있다', () => {
    const added: EntityKind[] = [
      'formation',
      'formationDrone',
      'facilityGun',
      'facilityHazard',
      'facilitySpawner',
      'spawnedDrone',
      'prop',
      'defenseBoss',
    ];
    for (const k of added) expect(KIND_CODE[k]).toBeGreaterThanOrEqual(19);
  });

  it('blankEntity 가 aux 슬롯을 0 으로 초기화한다', () => {
    const e = blankEntity('formation');
    expect(e.aux0).toBe(0);
    expect(e.aux1).toBe(0);
  });

  it('hashEntity 가 ENTITY_HASH_LAYOUT 순서·모드를 정확히 따른다(독립 구현 대조)', () => {
    // 아래는 replay.ts 를 참조하지 않는 독립 FNV-1a 구현이다. 코드와 레이아웃 배열 중
    // 한쪽만 바뀌면 이 대조가 즉시 깨진다 = 레이아웃 변경이 조용히 일어나지 않는다.
    const FNV_OFFSET = 0x811c9dc5;
    const FNV_PRIME = 0x01000193;
    const buf = new ArrayBuffer(8);
    const f64 = new Float64Array(buf);
    const bytes = new Uint8Array(buf);
    const fnvByte = (h: number, b: number): number => Math.imul(h ^ (b & 0xff), FNV_PRIME) >>> 0;
    const foldF64 = (h: number, v: number): number => {
      f64[0] = v;
      let r = h;
      for (let i = 0; i < 8; i++) r = fnvByte(r, bytes[i] as number);
      return r;
    };
    const foldU32 = (h: number, v: number): number => {
      let r = h;
      r = fnvByte(r, v & 0xff);
      r = fnvByte(r, (v >>> 8) & 0xff);
      r = fnvByte(r, (v >>> 16) & 0xff);
      r = fnvByte(r, (v >>> 24) & 0xff);
      return r;
    };

    // 필드마다 서로 다른 값을 넣어야 순서 뒤바뀜이 실제로 검출된다.
    const e = blankEntity('facilitySpawner');
    let n = 1;
    for (const [field] of ENTITY_HASH_LAYOUT) {
      if (field === 'kind') continue;
      (e as unknown as Record<string, number>)[field as string] = n * 1.5;
      n++;
    }
    e.id = 4321;

    let ref = FNV_OFFSET;
    for (const [field, mode] of ENTITY_HASH_LAYOUT) {
      const raw =
        field === 'kind'
          ? KIND_CODE[e.kind]
          : ((e as unknown as Record<string, number>)[field as string] as number);
      ref = mode === 'f64' ? foldF64(ref, raw) : foldU32(ref, raw >>> 0);
    }

    expect(hashEntity(FNV_OFFSET, e)).toBe(ref);
  });

  it('ENTITY_HASH_LAYOUT 이 Entity 의 해시 대상 필드를 빠짐없이 담는다', () => {
    const listed = new Set(ENTITY_HASH_LAYOUT.map(([f]) => f as string));
    const all = Object.keys(blankEntity('player') as unknown as Record<string, unknown>);
    // `dead` 만 의도적 제외(해시 시점에 항상 false 인 과도 상태).
    const missing = all.filter((k) => k !== 'dead' && !listed.has(k));
    expect(missing).toEqual([]);
    expect(listed.has('aux0')).toBe(true);
    expect(listed.has('aux1')).toBe(true);
  });

  it('aux 슬롯이 실제로 해시에 접힌다', () => {
    const a: Entity = blankEntity('prop');
    const b: Entity = blankEntity('prop');
    b.aux0 = 1;
    expect(hashEntity(0x811c9dc5, a)).not.toBe(hashEntity(0x811c9dc5, b));
    const c: Entity = blankEntity('prop');
    c.aux1 = 1;
    expect(hashEntity(0x811c9dc5, a)).not.toBe(hashEntity(0x811c9dc5, c));
    // 부분 폴드 금지 — (1,0) 과 (0,1) 이 같은 해시가 되면 스포너 카운터 위조가 통과한다.
    expect(hashEntity(0x811c9dc5, b)).not.toBe(hashEntity(0x811c9dc5, c));
  });

  it('aux 가 둘 다 0 이면 꼬리 폴드를 생략한다(기존 리플레이 바이트 불변 규율)', () => {
    // 조건부 꼬리를 제외한 레이아웃만으로 계산한 독립 참조와 바이트 일치해야 한다.
    const tail = new Set(ENTITY_HASH_OPTIONAL_TAIL as readonly string[]);
    const e = blankEntity('enemy');
    e.id = 12;
    e.x = 3.25;
    e.hp = 40;
    e.enemyType = 2;

    const FNV_OFFSET = 0x811c9dc5;
    const FNV_PRIME = 0x01000193;
    const buf = new ArrayBuffer(8);
    const f64 = new Float64Array(buf);
    const bytes = new Uint8Array(buf);
    const fnvByte = (h: number, b: number): number => Math.imul(h ^ (b & 0xff), FNV_PRIME) >>> 0;
    let ref = FNV_OFFSET;
    for (const [field, mode] of ENTITY_HASH_LAYOUT) {
      if (tail.has(field as string)) continue;
      const raw =
        field === 'kind'
          ? KIND_CODE[e.kind]
          : ((e as unknown as Record<string, number>)[field as string] as number);
      if (mode === 'f64') {
        f64[0] = raw;
        for (let i = 0; i < 8; i++) ref = fnvByte(ref, bytes[i] as number);
      } else {
        const v = raw >>> 0;
        ref = fnvByte(ref, v & 0xff);
        ref = fnvByte(ref, (v >>> 8) & 0xff);
        ref = fnvByte(ref, (v >>> 16) & 0xff);
        ref = fnvByte(ref, (v >>> 24) & 0xff);
      }
    }
    expect(hashEntity(FNV_OFFSET, e)).toBe(ref);
  });
});
