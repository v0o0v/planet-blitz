/**
 * 침공 L1 편대 스폰 테스트 (M7a · L3-formation 레인).
 *
 * 커버리지(레인 문서 검증 항목):
 *   ① 스폰 전후 RNG 커서 불변(RNG 미소비 계약)
 *   ② 스폰 좌표가 플레이어 위치와 무관
 *   ③ 진형별 오프셋 골든 스냅샷
 *   ④ slot=null 일 때 스폰 0
 *   ⑤ 동일 입력 2회 재실행 시 스폰 순서·좌표 바이트 동일
 * 추가: 페이즈 게이트, 슬롯 트리거 스케줄, 강화 3축 정수 스케일, 카탈로그 계약.
 */

import { describe, it, expect } from 'vitest';
import { createWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { MAINTENANCE_FULL } from '../src/sim/defense.js';
import { emptyInvasionLayers } from '../src/sim/invasion/normalize.js';
import type {
  InvasionLayers,
  InvasionRuntime,
  InvasionStepContext,
} from '../src/sim/invasion/types.js';
import {
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
  INVASION_WAVE_SLOTS,
  INVASION_ACCEL_BASE_CP,
} from '../src/sim/invasion/constants.js';
import {
  stepInvasionFormation,
  formationSlotTriggerTick,
  formationMemberSpawnPos,
  formationScheduleSpan,
  FORMATION_SLOT_INTERVAL_TICKS,
} from '../src/sim/invasion/formation.js';
import {
  FORMATIONS,
  FORMATION_COUNT,
  FORMATION_SCOUT_DRONES,
  FORMATION_INTERCEPTORS,
  FORMATION_ASSAULT,
  formationById,
  formationPowerCp,
  ENTRY_PATTERN_COUNT,
} from '../data/invasion/formations.js';
import { ENEMY_BY_TYPE } from '../data/enemies.js';

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function ref(catalogId: number, level = 1, ascension = 0, rarity = 0) {
  return { catalogId, level, ascension, affixSeed: 0, rarity };
}

/** 지정한 슬롯에만 편대를 꽂은 정규형 배치. */
function layersWith(slotRefs: (ReturnType<typeof ref> | null)[]): InvasionLayers {
  const layers = emptyInvasionLayers();
  for (let i = 0; i < INVASION_WAVE_SLOTS; i++) {
    layers.l1.waveSlots[i] = slotRefs[i] ?? null;
  }
  return layers;
}

function runtime(overrides: Partial<InvasionRuntime> = {}): InvasionRuntime {
  return {
    phase: PHASE_L1,
    phaseEnterTick: 0,
    scrollX: 0,
    scrollY: 0,
    accelCp: INVASION_ACCEL_BASE_CP,
    ...overrides,
  } as InvasionRuntime;
}

function ctxOf(layers: InvasionLayers, rt: InvasionRuntime, maintenance = MAINTENANCE_FULL) {
  const ctx: InvasionStepContext = { layers, runtime: rt, maintenance };
  return ctx;
}

/** 틱 0..ticks-1 동안 편대 스텝만 돌린다(stepWorld 미사용 — 다른 계 오염 배제). */
function runFormationTicks(
  state: WorldState,
  ctx: InvasionStepContext,
  ticks: number,
  onTick?: (t: number) => void,
): void {
  for (let t = 0; t < ticks; t++) {
    state.tick = t;
    onTick?.(t);
    stepInvasionFormation(state, ctx);
  }
}

function enemies(state: WorldState): Entity[] {
  return state.entities.filter((e) => e.kind === 'enemy');
}

/** 스폰 결과를 바이트 비교 가능한 순수 데이터로 접는다. */
function fingerprint(state: WorldState): string {
  return JSON.stringify(
    enemies(state).map((e) => [e.id, e.enemyType, e.x, e.y, e.vx, e.vy, e.hp, e.maxHp, e.damage, e.cooldown]),
  );
}

// ---------------------------------------------------------------------------
// 카탈로그 계약
// ---------------------------------------------------------------------------

describe('편대 카탈로그 — append-only 계약', () => {
  it('배열 인덱스 = catalogId', () => {
    FORMATIONS.forEach((f, i) => expect(f.catalogId).toBe(i));
  });

  it('임시 카탈로그는 3종이고 id 가 전역 유일', () => {
    expect(FORMATION_COUNT).toBe(3);
    expect(new Set(FORMATIONS.map((f) => f.id)).size).toBe(3);
  });

  it('구성원의 적 유형이 전부 ENEMY_BY_TYPE 범위 안이고 오프셋이 정수', () => {
    for (const f of FORMATIONS) {
      expect(f.members.length).toBeGreaterThan(0);
      expect(f.entryPattern).toBeGreaterThanOrEqual(0);
      expect(f.entryPattern).toBeLessThan(ENTRY_PATTERN_COUNT);
      for (const m of f.members) {
        expect(ENEMY_BY_TYPE[m.enemyTypeIndex]).toBeDefined();
        expect(Number.isInteger(m.dx)).toBe(true);
        expect(Number.isInteger(m.dy)).toBe(true);
        expect(Number.isInteger(m.delayTicks)).toBe(true);
        expect(m.delayTicks).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('이름에 이모지를 쓰지 않는다(Pixi 두부 방지) — id 는 ASCII kebab-case', () => {
    for (const f of FORMATIONS) expect(f.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('범위 밖 catalogId 는 undefined', () => {
    expect(formationById(FORMATION_COUNT)).toBeUndefined();
    expect(formationById(-1)).toBeUndefined();
  });

  it('강화 3축 배율이 정수 단조 증가(100 = ×1.00)', () => {
    expect(formationPowerCp(1, 0, 0)).toBe(100);
    expect(formationPowerCp(2, 0, 0)).toBe(105);
    expect(formationPowerCp(1, 1, 0)).toBe(125);
    expect(formationPowerCp(1, 0, 3)).toBe(160);
    expect(Number.isInteger(formationPowerCp(99, 5, 3))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ① RNG 미소비
// ---------------------------------------------------------------------------

describe('편대 스폰 — RNG 미소비 계약', () => {
  it('전 슬롯 편대를 다 스폰해도 waveRng/eliteRng 커서가 불변', () => {
    const state = createWorld(1234);
    const ctx = ctxOf(
      layersWith([
        ref(FORMATION_SCOUT_DRONES),
        ref(FORMATION_INTERCEPTORS),
        ref(FORMATION_ASSAULT),
        ref(FORMATION_SCOUT_DRONES),
        ref(FORMATION_INTERCEPTORS),
        ref(FORMATION_ASSAULT),
      ]),
      runtime(),
    );
    const before = [state.waveRng.getState(), state.eliteRng.getState(), state.rng.getState()];

    runFormationTicks(state, ctx, formationScheduleSpan() + 1);

    expect(enemies(state).length).toBeGreaterThan(0);
    expect([state.waveRng.getState(), state.eliteRng.getState(), state.rng.getState()]).toEqual(
      before,
    );
  });
});

// ---------------------------------------------------------------------------
// ② 플레이어 위치 무관
// ---------------------------------------------------------------------------

describe('편대 스폰 — 플레이어 좌표 비의존', () => {
  it('플레이어를 멀리 옮겨도 스폰 좌표가 동일', () => {
    const layers = layersWith([ref(FORMATION_INTERCEPTORS)]);

    const a = createWorld(7);
    runFormationTicks(a, ctxOf(layers, runtime()), 200);

    const b = createWorld(7);
    const player = b.entities[0] as Entity;
    player.x = 99_000;
    player.y = -55_000;
    runFormationTicks(b, ctxOf(layers, runtime()), 200);

    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('스폰 좌표는 스크롤 오프셋을 그대로 따라간다', () => {
    const layers = layersWith([ref(FORMATION_SCOUT_DRONES)]);
    const base = createWorld(7);
    runFormationTicks(base, ctxOf(layers, runtime()), 5);

    const moved = createWorld(7);
    runFormationTicks(moved, ctxOf(layers, runtime({ scrollX: 500, scrollY: -3000 })), 5);

    const ea = enemies(base);
    const eb = enemies(moved);
    expect(eb.length).toBe(ea.length);
    for (let i = 0; i < ea.length; i++) {
      expect((eb[i] as Entity).x).toBe((ea[i] as Entity).x + 500);
      expect((eb[i] as Entity).y).toBe((ea[i] as Entity).y - 3000);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 진형별 오프셋 골든 스냅샷
// ---------------------------------------------------------------------------

describe('편대 진형 — 오프셋 골든', () => {
  it('정찰 드론편대(V자 직진)', () => {
    const def = FORMATIONS[FORMATION_SCOUT_DRONES]!;
    const got = def.members.map((_, j) => formationMemberSpawnPos(def, j, 0, 0));
    expect(got).toEqual([
      { x: 0, y: -1400 },
      { x: -160, y: -1490 },
      { x: 160, y: -1490 },
      { x: -320, y: -1580 },
      { x: 320, y: -1580 },
    ]);
  });

  it('요격 편대(좌우 협공)', () => {
    const def = FORMATIONS[FORMATION_INTERCEPTORS]!;
    const got = def.members.map((_, j) => formationMemberSpawnPos(def, j, 0, 0));
    expect(got).toEqual([
      { x: -1400, y: -700 },
      { x: 1400, y: -700 },
      { x: -1400, y: -840 },
      { x: 1400, y: -840 },
      { x: -1400, y: -980 },
      { x: 1400, y: -980 },
    ]);
  });

  it('강습 돌격편대(정면 밀집 돌진)', () => {
    const def = FORMATIONS[FORMATION_ASSAULT]!;
    const got = def.members.map((_, j) => formationMemberSpawnPos(def, j, 0, 0));
    expect(got).toEqual([
      { x: -120, y: -2000 },
      { x: 120, y: -2000 },
      { x: -60, y: -2120 },
      { x: 60, y: -2120 },
    ]);
  });

  it('모든 진형이 창 전방(-Y)에 등장한다 — 플레이어 뒤에서 튀어나오지 않음', () => {
    for (const def of FORMATIONS) {
      def.members.forEach((_, j) => {
        expect(formationMemberSpawnPos(def, j, 0, 0).y).toBeLessThan(-600);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 빈 슬롯 / 페이즈 게이트
// ---------------------------------------------------------------------------

describe('편대 스폰 — 게이트', () => {
  it('전 슬롯 null 이면 스폰 0', () => {
    const state = createWorld(3);
    runFormationTicks(state, ctxOf(emptyInvasionLayers(), runtime()), formationScheduleSpan() + 1);
    expect(enemies(state).length).toBe(0);
  });

  it('L2/L3 페이즈에서는 편대가 등장하지 않는다', () => {
    const layers = layersWith([ref(FORMATION_ASSAULT)]);
    for (const phase of [PHASE_L2, PHASE_L3] as const) {
      const state = createWorld(3);
      runFormationTicks(state, ctxOf(layers, runtime({ phase })), 600);
      expect(enemies(state).length).toBe(0);
    }
  });

  it('알 수 없는 catalogId 는 조용히 무시한다', () => {
    const state = createWorld(3);
    runFormationTicks(state, ctxOf(layersWith([ref(999)]), runtime()), 300);
    expect(enemies(state).length).toBe(0);
  });

  it('phaseEnterTick 이전 틱에서는 스폰하지 않는다', () => {
    const state = createWorld(3);
    const ctx = ctxOf(layersWith([ref(FORMATION_SCOUT_DRONES)]), runtime({ phaseEnterTick: 100 }));
    runFormationTicks(state, ctx, 100);
    expect(enemies(state).length).toBe(0);
    state.tick = 100;
    stepInvasionFormation(state, ctx);
    expect(enemies(state).length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 슬롯 스케줄
// ---------------------------------------------------------------------------

describe('편대 스케줄 — 슬롯 순서', () => {
  it('슬롯 i 는 i × 간격 틱에 트리거된다', () => {
    for (let i = 0; i < INVASION_WAVE_SLOTS; i++) {
      expect(formationSlotTriggerTick(i)).toBe(i * FORMATION_SLOT_INTERVAL_TICKS);
    }
  });

  it('여섯 슬롯 전체 일정이 L1 예산(5400틱) 안에 끝난다', () => {
    expect(formationScheduleSpan()).toBeLessThan(5400);
  });

  it('구성원이 지연 틱에 정확히 한 번씩만 등장한다(중복 스폰 없음)', () => {
    const state = createWorld(11);
    const def = FORMATIONS[FORMATION_INTERCEPTORS]!;
    const ctx = ctxOf(layersWith([ref(FORMATION_INTERCEPTORS)]), runtime());
    const counts: number[] = [];
    runFormationTicks(state, ctx, 300, () => counts.push(enemies(state).length));
    expect(enemies(state).length).toBe(def.members.length);
    // 0틱 2기 → 30틱 2기 → 60틱 2기 계단
    expect(counts[1]).toBe(2);
    expect(counts[31]).toBe(4);
    expect(counts[61]).toBe(6);
  });

  it('슬롯 5 는 슬롯 0 보다 정확히 5구간 늦게 등장한다', () => {
    const state = createWorld(11);
    const slots = new Array<ReturnType<typeof ref> | null>(INVASION_WAVE_SLOTS).fill(null);
    slots[5] = ref(FORMATION_SCOUT_DRONES);
    const ctx = ctxOf(layersWith(slots), runtime());
    runFormationTicks(state, ctx, 5 * FORMATION_SLOT_INTERVAL_TICKS);
    expect(enemies(state).length).toBe(0);
    state.tick = 5 * FORMATION_SLOT_INTERVAL_TICKS;
    stepInvasionFormation(state, ctx);
    expect(enemies(state).length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 재실행 결정론
// ---------------------------------------------------------------------------

describe('편대 스폰 — 결정론', () => {
  it('같은 배치·시드로 두 번 돌리면 스폰 순서·좌표가 바이트 동일', () => {
    const layers = layersWith([
      ref(FORMATION_SCOUT_DRONES, 12, 1, 2),
      ref(FORMATION_ASSAULT, 40, 3, 1),
      null,
      ref(FORMATION_INTERCEPTORS, 7, 0, 0),
    ]);
    const span = formationScheduleSpan() + 1;

    const a = createWorld(2026);
    runFormationTicks(a, ctxOf(layers, runtime()), span);
    const b = createWorld(2026);
    runFormationTicks(b, ctxOf(layers, runtime()), span);

    expect(fingerprint(b)).toBe(fingerprint(a));
    expect(enemies(a).length).toBe(5 + 4 + 6);
  });

  it('강화 3축이 내구도를 정수 배율로 올린다', () => {
    const base = createWorld(5);
    runFormationTicks(base, ctxOf(layersWith([ref(FORMATION_ASSAULT)]), runtime()), 60);
    const strong = createWorld(5);
    runFormationTicks(
      strong,
      ctxOf(layersWith([ref(FORMATION_ASSAULT, 21, 2, 1)]), runtime()),
      60,
    );

    const cp = formationPowerCp(21, 2, 1);
    const ea = enemies(base);
    const eb = enemies(strong);
    expect(eb.length).toBe(ea.length);
    for (let i = 0; i < ea.length; i++) {
      const src = ea[i] as Entity;
      const dst = eb[i] as Entity;
      expect(dst.maxHp).toBe(Math.round((src.maxHp * cp) / 100));
      expect(dst.hp).toBe(dst.maxHp);
      expect(Number.isInteger(dst.maxHp)).toBe(true);
    }
  });

  it('정비도 0% 면 편대 첫 발사 간격이 정확히 2배(정수 산술)', () => {
    const full = createWorld(9);
    runFormationTicks(full, ctxOf(layersWith([ref(FORMATION_INTERCEPTORS)]), runtime()), 120);
    const worn = createWorld(9);
    runFormationTicks(
      worn,
      ctxOf(layersWith([ref(FORMATION_INTERCEPTORS)]), runtime(), 0),
      120,
    );

    const ea = enemies(full);
    const eb = enemies(worn);
    expect(eb.length).toBe(ea.length);
    for (let i = 0; i < ea.length; i++) {
      expect((eb[i] as Entity).cooldown).toBe((ea[i] as Entity).cooldown * 2);
    }
  });
});
