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
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldState, WorldConfig } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import type { Entity } from '../src/sim/entities.js';
import { MAINTENANCE_FULL } from '../src/sim/invasion/guardian.js';
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
  INVASION_TOTAL_TICKS,
} from '../src/sim/invasion/constants.js';
import {
  stepInvasionFormation,
  formationSlotTriggerTick,
  formationMemberSpawnPos,
  formationMemberEntryVelocity,
  formationScheduleSpan,
  FORMATION_SLOT_INTERVAL_TICKS,
} from '../src/sim/invasion/formation.js';
import {
  FORMATIONS,
  FORMATION_COUNT,
  FORMATION_SCOUT_DRONES,
  FORMATION_INTERCEPTORS,
  FORMATION_ASSAULT,
  FORMATION_GLIDE_FLOCK,
  FORMATION_MINE_LAYER,
  FORMATION_SHIELD_ESCORT,
  FORMATION_SNIPER_NEST,
  FORMATION_SUPPORT_ESCORT,
  FORMATION_TOXAR_CORROSION,
  FORMATION_TOXAR_BLIGHT,
  FORMATION_KRAS_BREAKER,
  FORMATION_KRAS_PIERCER,
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

  it('풀 카탈로그는 12종이고 id 가 전역 유일', () => {
    expect(FORMATION_COUNT).toBe(12); // Lane9: 톡사르 8~9 · 크라스 10~11 append
    expect(new Set(FORMATIONS.map((f) => f.id)).size).toBe(12);
  });

  /**
   * **append-only 골든.** 배열 인덱스가 곧 `defenses.layout` jsonb·해시 스트림·EF 재실행의
   * 계약이라 중간 삽입·재정렬·개명은 이미 저장된 배치를 통째로 다른 편대로 바꿔 버린다.
   * M7c append 로 뒤에 5종이 붙었어도 앞 3종의 위치·id 는 한 글자도 움직이면 안 된다.
   */
  it('카탈로그 id 순서 골든 — 기존 0~2 가 제자리에 그대로 있다', () => {
    expect(FORMATIONS.map((f) => f.id)).toEqual([
      'formation-scout-drones',
      'formation-interceptors',
      'formation-assault',
      'formation-glide-flock',
      'formation-mine-layer',
      'formation-shield-escort',
      'formation-sniper-nest',
      'formation-support-escort',
      'formation-toxar-corrosion',
      'formation-toxar-blight',
      'formation-kras-breaker',
      'formation-kras-piercer',
    ]);
    expect(FORMATION_SCOUT_DRONES).toBe(0);
    expect(FORMATION_INTERCEPTORS).toBe(1);
    expect(FORMATION_ASSAULT).toBe(2);
    expect(FORMATION_GLIDE_FLOCK).toBe(3);
    expect(FORMATION_MINE_LAYER).toBe(4);
    expect(FORMATION_SHIELD_ESCORT).toBe(5);
    expect(FORMATION_SNIPER_NEST).toBe(6);
    expect(FORMATION_SUPPORT_ESCORT).toBe(7);
    expect(FORMATION_TOXAR_CORROSION).toBe(8);
    expect(FORMATION_TOXAR_BLIGHT).toBe(9);
    expect(FORMATION_KRAS_BREAKER).toBe(10);
    expect(FORMATION_KRAS_PIERCER).toBe(11);
  });

  /**
   * 신규 편대는 **기존 적 22종만** 참조한다(적 append 없음). ENEMY_BY_TYPE 인덱스는 해시
   * 계약이라 늘리는 순간 스프라이트 매핑·조준 술어·EF 재실행까지 표면이 넓어진다 —
   * 이 가드는 "편대를 늘리다가 적을 슬쩍 끼워 넣는" 변경을 즉시 빨간불로 만든다.
   */
  it('ENEMY_BY_TYPE 골든 — 36종·연속 typeIndex·기존 0~33 불변', () => {
    // Lane9: 톡사르 22~27 · 크라스 28~33 append. 2026-08-04: 카르곤 엘리트 34~35 append.
    // ⚠️ 34~35 가 카르곤 소속인데 맨 뒤에 있는 것이 이 골든의 요점이다 — 카르곤 블록(0~3)에
    // 끼워 넣으면 그 뒤 30종의 번호가 밀려 모든 리플레이·골든이 무효가 된다.
    expect(ENEMY_BY_TYPE.length).toBe(36);
    ENEMY_BY_TYPE.forEach((def, i) => expect(def.typeIndex).toBe(i));
    expect(ENEMY_BY_TYPE.map((d) => d.id)).toEqual([
      'kargon-charger',
      'kargon-gunner',
      'kargon-lava-spring',
      'kargon-repair-drone',
      'berdan-worker-rusher',
      'berdan-spitter',
      'berdan-acid-gland',
      'berdan-brood-nurse',
      'berdan-sentinel',
      'berdan-brood-mother',
      'niflheim-wraith-interceptor',
      'niflheim-frost-gunner',
      'niflheim-rime-fissure',
      'niflheim-cryo-tender',
      'niflheim-frost-sentinel',
      'niflheim-spectral-carrier',
      'arke-crusher-golem',
      'arke-precision-turret',
      'arke-grind-totem',
      'arke-restore-droid',
      'arke-guardian-battery',
      'arke-ancient-breaker',
      'toxar-corroder',
      'toxar-venom-spitter',
      'toxar-blight-gland',
      'toxar-plague-tender',
      'toxar-toxin-sentinel',
      'toxar-rot-behemoth',
      'kras-breaker',
      'kras-piercer',
      'kras-crusher-totem',
      'kras-salvage-drone',
      'kras-siege-battery',
      'kras-devastator',
      'kargon-lava-battery',
      'kargon-magma-colossus',
    ]);
  });

  it('8종의 역할이 겹치지 않는다 — 진형·구성이 서로 다르다', () => {
    // 같은 (진입 패턴 + 구성원 유형 다중집합)이 둘 있으면 사실상 같은 편대다.
    const shapes = FORMATIONS.map(
      (f) =>
        `${f.entryPattern}|${[...f.members.map((m) => m.enemyTypeIndex)].sort((a, b) => a - b).join(',')}`,
    );
    expect(new Set(shapes).size).toBe(FORMATION_COUNT);
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
      // 신규 5종을 포함해 전 슬롯을 서로 다른 편대로 채운다(패턴별 스폰 경로 전수).
      layersWith([
        ref(FORMATION_GLIDE_FLOCK),
        ref(FORMATION_MINE_LAYER),
        ref(FORMATION_SHIELD_ESCORT),
        ref(FORMATION_SNIPER_NEST),
        ref(FORMATION_SUPPORT_ESCORT),
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

  it('조류형 활공편대(높은 곳에서 좌우 급강하)', () => {
    const def = FORMATIONS[FORMATION_GLIDE_FLOCK]!;
    const got = def.members.map((_, j) => formationMemberSpawnPos(def, j, 0, 0));
    expect(got).toEqual([
      { x: -720, y: -1700 },
      { x: 720, y: -1700 },
      { x: -480, y: -1820 },
      { x: 480, y: -1820 },
      { x: -240, y: -1940 },
      { x: 240, y: -1940 },
    ]);
  });

  it('기뢰 살포선(느린 표류·넓은 봉쇄)', () => {
    const def = FORMATIONS[FORMATION_MINE_LAYER]!;
    const got = def.members.map((_, j) => formationMemberSpawnPos(def, j, 0, 0));
    expect(got).toEqual([
      { x: 0, y: -1600 },
      { x: -560, y: -1760 },
      { x: 560, y: -1760 },
      { x: -200, y: -1860 },
      { x: 200, y: -1860 },
    ]);
  });

  it('실드 호위편대(전면 전열 + 후방 사수)', () => {
    const def = FORMATIONS[FORMATION_SHIELD_ESCORT]!;
    const got = def.members.map((_, j) => formationMemberSpawnPos(def, j, 0, 0));
    expect(got).toEqual([
      { x: -260, y: -1400 },
      { x: 260, y: -1400 },
      { x: 0, y: -1460 },
      { x: -140, y: -1700 },
      { x: 140, y: -1700 },
    ]);
  });

  it('저격 편대(얕게 등장해 상단 고정)', () => {
    const def = FORMATIONS[FORMATION_SNIPER_NEST]!;
    const got = def.members.map((_, j) => formationMemberSpawnPos(def, j, 0, 0));
    expect(got).toEqual([
      { x: -600, y: -900 },
      { x: 600, y: -900 },
      { x: 0, y: -1020 },
      { x: -300, y: -1140 },
      { x: 300, y: -1140 },
    ]);
  });

  it('지원 편대(모체 + 치유원 후열)', () => {
    const def = FORMATIONS[FORMATION_SUPPORT_ESCORT]!;
    const got = def.members.map((_, j) => formationMemberSpawnPos(def, j, 0, 0));
    expect(got).toEqual([
      { x: 0, y: -1400 },
      { x: -300, y: -1540 },
      { x: 300, y: -1540 },
      { x: -140, y: -1700 },
      { x: 140, y: -1700 },
    ]);
  });

  /**
   * 진입 속도 골든. 좌표만 맞고 속도가 틀리면 "제자리에 뜬 채 안 내려오는 편대"가 되는데
   * 좌표 스냅샷만으로는 잡히지 않는다 — 신규 3패턴이 실제로 서로 다른 궤도를 만드는지 본다.
   */
  it('신규 진입 패턴의 속도가 서로 다른 궤도를 만든다', () => {
    const glide = FORMATIONS[FORMATION_GLIDE_FLOCK]!;
    expect(glide.members.map((_, j) => formationMemberEntryVelocity(glide, j))).toEqual([
      { vx: 240, vy: 360 },
      { vx: -240, vy: 360 },
      { vx: 240, vy: 360 },
      { vx: -240, vy: 360 },
      { vx: 240, vy: 360 },
      { vx: -240, vy: 360 },
    ]);
    const snipe = FORMATIONS[FORMATION_SNIPER_NEST]!;
    expect(formationMemberEntryVelocity(snipe, 0)).toEqual({ vx: 0, vy: 60 });
    const drift = FORMATIONS[FORMATION_MINE_LAYER]!;
    expect(formationMemberEntryVelocity(drift, 0)).toEqual({ vx: 0, vy: 80 });
    // 정면 계열은 기존 값 그대로(회귀 가드).
    const shield = FORMATIONS[FORMATION_SHIELD_ESCORT]!;
    expect(formationMemberEntryVelocity(shield, 0)).toEqual({ vx: 0, vy: 240 });
    // 전 편대의 속도가 정수다(ADR-0005 — f64 누적 금지).
    for (const def of FORMATIONS) {
      def.members.forEach((_, j) => {
        const v = formationMemberEntryVelocity(def, j);
        expect(Number.isInteger(v.vx)).toBe(true);
        expect(Number.isInteger(v.vy)).toBe(true);
      });
    }
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

  it('신규 5종도 같은 시드 2회 재실행이 바이트 동일하고 전원이 등장한다', () => {
    const layers = layersWith([
      ref(FORMATION_GLIDE_FLOCK, 30, 2, 1),
      ref(FORMATION_MINE_LAYER, 8, 0, 0),
      ref(FORMATION_SHIELD_ESCORT, 55, 4, 3),
      ref(FORMATION_SNIPER_NEST, 1, 0, 0),
      ref(FORMATION_SUPPORT_ESCORT, 77, 5, 2),
    ]);
    const span = formationScheduleSpan() + 1;

    const a = createWorld(31337);
    runFormationTicks(a, ctxOf(layers, runtime()), span);
    const b = createWorld(31337);
    runFormationTicks(b, ctxOf(layers, runtime()), span);

    expect(fingerprint(b)).toBe(fingerprint(a));
    const expected =
      FORMATIONS[FORMATION_GLIDE_FLOCK]!.members.length +
      FORMATIONS[FORMATION_MINE_LAYER]!.members.length +
      FORMATIONS[FORMATION_SHIELD_ESCORT]!.members.length +
      FORMATIONS[FORMATION_SNIPER_NEST]!.members.length +
      FORMATIONS[FORMATION_SUPPORT_ESCORT]!.members.length;
    expect(enemies(a).length).toBe(expected);
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

// ---------------------------------------------------------------------------
// ⑥ 정규 경로 통합 — createWorld → stepWorld 로 실제 런을 돌린다
//
// 이 프로젝트에서 8번 재발한 결함이 "단위 테스트는 전부 그린인데 배선이 통째로 없다"이다.
// 위 케이스들은 전부 `stepInvasionFormation` 을 직접 부르므로, 스텝 훅이 world.ts 에서
// 빠지거나 신규 편대원이 자동 조준 술어(`isPlayerTargetable`)에서 누락돼도 다 통과한다.
// 그래서 여기서는 오직 정규 경로로만 돌린다: 실제 침공 config → createWorld → stepWorld.
// ---------------------------------------------------------------------------

/** 슬롯 0 에 편대 하나만 꽂은 실제 침공 config(다른 레이어는 정규형 기본값). */
function invasionConfigWith(catalogId: number): WorldConfig {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  const layers = emptyInvasionLayers();
  layers.l1.waveSlots[0] = ref(catalogId);
  config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: MAINTENANCE_FULL };
  return config;
}

interface RunObservation {
  /** 런 중 한 번이라도 등장한 적 유형(enemyType) 집합. */
  readonly types: Set<number>;
  /** 동시 생존 최대치(스폰이 실제로 일어났는지의 하한). */
  readonly peakAlive: number;
  /** 플레이어 사격에 실제로 피해를 입은 편대원이 있었는가(= 조준 가능). */
  readonly damaged: boolean;
}

/**
 * 오토파일럿 입력으로 실제 런을 돌리며 편대원의 등장·피격을 관측한다.
 *
 * 피해 관측이 핵심이다. 자동 조준(`nearestTarget` → `isPlayerTargetable`)을 통과해야만
 * 플레이어 탄이 그 적을 향해 나가므로, "맞기는 하지만 조준되지 않는" 상태였던 과거 결함이
 * 여기서 곧바로 빨간불이 된다.
 */
function observeRun(catalogId: number, ticks: number, wanted: ReadonlySet<number>): RunObservation {
  const state = createWorld(4242, invasionConfigWith(catalogId));
  const types = new Set<number>();
  let peakAlive = 0;
  let damaged = false;
  for (let t = 0; t < ticks; t++) {
    stepWorld(state, autopilotInput(state));
    let alive = 0;
    for (const e of state.entities) {
      if (e.kind !== 'enemy') continue;
      types.add(e.enemyType);
      // 관측 대상은 **이 편대의 구성원 유형만**이다. 빈 슬롯은 기본 수비대(정찰 드론편대)가
      // 충원하므로 전체를 세면 남의 편대가 낸 피해로 통과할 수 있다.
      if (!wanted.has(e.enemyType)) continue;
      if (e.dead) {
        damaged = true;
        continue;
      }
      alive++;
      if (e.hp < e.maxHp) damaged = true;
    }
    if (alive > peakAlive) peakAlive = alive;
    if (state.gameOver || state.victory) break;
  }
  return { types, peakAlive, damaged };
}

describe('편대 — 정규 경로(createWorld→stepWorld) 통합', () => {
  it.each(FORMATIONS.map((f, i) => [i, f.id] as const))(
    '편대 %i(%s)가 실제 런에서 스폰되고 플레이어에게 조준·피격된다',
    (catalogId) => {
      const def = FORMATIONS[catalogId]!;
      // 700틱 = 슬롯 1 트리거(720) **직전**. 이 구간에 등장하는 적은 슬롯 0 의 이 편대뿐이라
      // 기본 수비대 충원분이 관측에 섞이지 않는다.
      const wanted = new Set(def.members.map((m) => m.enemyTypeIndex));
      const run = observeRun(catalogId, 700, wanted);

      // ① 구성원 전 유형이 실제로 전장에 올라왔다(스텝 훅 배선 확인).
      for (const typeIndex of wanted) {
        expect(run.types.has(typeIndex), `유형 ${typeIndex} 미등장(편대 ${def.id})`).toBe(true);
      }
      // ② 동시 생존이 실제로 늘었다(스폰 0 인데 통과하는 일이 없게).
      expect(run.peakAlive).toBeGreaterThan(0);
      // ③ 자동 조준을 통과해 실제로 맞았다(isPlayerTargetable 누락 가드).
      expect(run.damaged, `편대 ${def.id} 가 한 번도 피격되지 않음(조준 누락 의심)`).toBe(true);
    },
  );

  it('정규 경로 런도 waveRng 를 소비하지 않는다(편대 스폰 경로 한정)', () => {
    // 편대 없는 런과 편대 있는 런의 waveRng 커서가 같다 = 편대가 RNG 를 건드리지 않았다.
    const empty = createWorld(99, (() => {
      const c = { ...DEFAULT_CONFIG } as WorldConfig;
      c.invasion3 = {
        layers: emptyInvasionLayers(),
        timeLimitTicks: INVASION_TOTAL_TICKS,
        maintenance: MAINTENANCE_FULL,
      };
      return c;
    })());
    const filled = createWorld(99, invasionConfigWith(FORMATION_SNIPER_NEST));
    for (let t = 0; t < 400; t++) {
      stepWorld(empty, autopilotInput(empty));
      stepWorld(filled, autopilotInput(filled));
    }
    expect(filled.waveRng.getState()).toEqual(empty.waveRng.getState());
  });
});
