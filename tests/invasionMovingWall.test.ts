/**
 * 압축 프레스(이동 벽) 검증 — M7c · C2-facility-wall.
 *
 * 이 파일이 막는 것은 **한 문장**으로 요약된다: 기존 터널링 방지는 "최대 대시 스텝 59u <
 * 벽 최소 전폭 120u" 라는 **정적 전제**(src/sim/world.ts stepPlayer 주석) 위에 서 있는데,
 * 벽이 움직이는 순간 유효 스텝이 (플레이어 스텝 + 벽 스텝)이 되어 그 전제가 깨진다.
 *
 * 레인 검증 항목 6개를 그대로 옮긴다:
 *   ① 터널링 0 — 최대 대시 × 벽 최대 접근 속도 최악 조합 파라미터 전수 스윕
 *   ② 끼임 규칙이 결정론적이고 좌표가 유한(NaN/Infinity 0, 좌표 폭주 0)
 *   ③ 벽 위치가 틱의 순수 함수(같은 틱 → 같은 좌표, 2회 재실행 바이트 동일)
 *   ④ wallIndex 가 이동 벽에서도 직접 스윕과 동일 결과(+ 갱신 누락 시 실제로 갈린다는 증명)
 *   ⑤ 정규 경로 통합 — createWorld → stepWorld 로 프레스가 배치된 실제 L2 런
 *   ⑥ PvE 경로 미오염 — broad-phase·이동 벽 분기가 PvE 를 안 건드림
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { spawnWall } from '../src/sim/entities.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { circleOverlapsWall } from '../src/sim/los.js';
import { clampToWindow } from '../src/sim/invasion/scroll.js';
import {
  MOVING_WALL_TAG,
  MAX_PLAYER_STEP_UNITS,
  PRESS_AXIS_X,
  PRESS_AXIS_Y,
  isMovingWall,
  movingWallCoordAt,
  pressAxisDir,
  pressMaxStep,
  pressTriangleOffset,
  spawnMovingWall,
  stepMovingWalls,
  sweepAabbEntry,
} from '../src/sim/invasion/movingWall.js';
import { InvasionWallIndex, sweepWallsDirect } from '../src/sim/invasion/wallIndex.js';
import { spawnFacility, stepFacility } from '../src/sim/invasion/facility.js';
import { normalizeInvasionLayers } from '../src/sim/invasion/normalize.js';
import type { FacilityRef, InvasionLayers, InvasionStepContext } from '../src/sim/invasion/types.js';
import {
  INVASION_ACCEL_BASE_CP,
  INVASION_TOTAL_TICKS,
  MAP_TEMPLATE_STRAIGHT,
  PHASE_L2,
} from '../src/sim/invasion/constants.js';
import {
  FACILITY_BEHAVIOR_PRESS,
  INVASION_FACILITIES,
  PRESS_FACILITY_CATALOG_ID,
  facilitySpecFor,
} from '../data/invasion/facilities.js';
import type { FacilitySpec } from '../data/invasion/facilities.js';
import type { InvasionSocketDef } from '../data/invasion/mapTemplates.js';
import { mapTemplateFor } from '../data/invasion/mapTemplates.js';
import { MAINTENANCE_FULL } from '../src/sim/invasion/guardian.js';

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

const PRESS_SPEC = facilitySpecFor(PRESS_FACILITY_CATALOG_ID)!;

function ref(catalogId: number): FacilityRef {
  return { catalogId, level: 1, ascension: 0, affixSeed: 0, rarity: 0 };
}

function ctxOf(layers: InvasionLayers): InvasionStepContext {
  return {
    layers,
    runtime: {
      phase: PHASE_L2 as 0 | 1 | 2,
      phaseEnterTick: 0,
      scrollX: 0,
      scrollY: 0,
      accelCp: INVASION_ACCEL_BASE_CP,
    },
    maintenance: MAINTENANCE_FULL,
  };
}

function layersWith(sockets: (FacilityRef | null)[]): InvasionLayers {
  return normalizeInvasionLayers({
    l2: { templateId: MAP_TEMPLATE_STRAIGHT, sockets },
  });
}

/** 활성 벽 목록을 world.ts 와 같은 규칙(엔티티 배열 순서)으로 다시 만든다. */
function rebuildWalls(state: WorldState): void {
  state.activeWalls.length = 0;
  for (const e of state.entities) if (e.kind === 'wall' && !e.dead) state.activeWalls.push(e);
}

function player(state: WorldState): Entity {
  const p = state.entities[0]!;
  expect(p.kind).toBe('player');
  return p;
}

/** 스펙 일부만 갈아끼운 프레스 스펙(파라미터 스윕용). */
function pressSpec(over: Partial<FacilitySpec>): FacilitySpec {
  return { ...PRESS_SPEC, ...over };
}

/** 소켓 1개짜리 가상 소켓. */
function socketAt(x: number, y: number, facingDeg: number): InvasionSocketDef {
  return { x, y, facingDeg, arcDeg: 160 };
}

// ---------------------------------------------------------------------------
// ③ 벽 위치가 틱의 순수 함수
// ---------------------------------------------------------------------------

describe('프레스 좌표는 틱의 순수 함수다', () => {
  it('삼각파 변위는 항상 정수이고 [0, travel] 을 벗어나지 않는다', () => {
    for (const period of [2, 3, 7, 60, 240, 601]) {
      for (const travel of [0, 1, 137, 620, 5000]) {
        for (let t = -600; t <= 1200; t++) {
          const v = pressTriangleOffset(t, travel, period, 13);
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(travel);
        }
      }
    }
  });

  it('주기성: tick 과 tick + period 의 변위가 같다(음수 틱 포함)', () => {
    const period = 240;
    for (let t = -500; t <= 500; t++) {
      expect(pressTriangleOffset(t, 620, period, 37)).toBe(
        pressTriangleOffset(t + period, 620, period, 37),
      );
    }
  });

  it('주기·이동거리 0 은 정지(방어적 폴백)', () => {
    expect(pressTriangleOffset(123, 620, 0, 0)).toBe(0);
    expect(pressTriangleOffset(123, 0, 240, 0)).toBe(0);
  });

  it('같은 틱을 몇 번을 물어도 같은 좌표다(상태 없음)', () => {
    const state = createWorld(11);
    const press = spawnMovingWall(state, socketAt(0, -500, 90), 0, ref(PRESS_FACILITY_CATALOG_ID), PRESS_SPEC)!;
    for (const t of [0, 1, 59, 120, 239, 240, 1000]) {
      const a = movingWallCoordAt(press, t);
      const b = movingWallCoordAt(press, t);
      expect(a).toBe(b);
      expect(Number.isInteger(a)).toBe(true);
    }
  });

  it('2회 재실행이 바이트 동일하다(600틱 좌표 스트림)', () => {
    const run = (): string => {
      const state = createWorld(5);
      const layers = layersWith([ref(PRESS_FACILITY_CATALOG_ID), null, ref(PRESS_FACILITY_CATALOG_ID)]);
      const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
      for (let i = 0; i < 3; i++) {
        const r = layers.l2.sockets[i];
        if (r !== null && r !== undefined) spawnFacility(state, template.sockets[i]!, i, r, MAINTENANCE_FULL);
      }
      rebuildWalls(state);
      const ctx = ctxOf(layers);
      const stream: number[] = [];
      for (let t = 0; t < 600; t++) {
        state.tick = t;
        stepMovingWalls(state, ctx);
        for (const e of state.entities) if (isMovingWall(e)) stream.push(e.x, e.y);
      }
      return JSON.stringify(stream);
    };
    expect(run()).toBe(run());
  });

  it('소켓 facing 이 이동 축·방향을 결정한다(삼각함수 미사용, 정수 도)', () => {
    expect(pressAxisDir(0)).toEqual({ axis: PRESS_AXIS_X, sign: 1 });
    expect(pressAxisDir(90)).toEqual({ axis: PRESS_AXIS_Y, sign: 1 });
    expect(pressAxisDir(180)).toEqual({ axis: PRESS_AXIS_X, sign: -1 });
    expect(pressAxisDir(270)).toEqual({ axis: PRESS_AXIS_Y, sign: -1 });
    expect(pressAxisDir(-90)).toEqual({ axis: PRESS_AXIS_Y, sign: -1 });
    expect(pressAxisDir(450)).toEqual({ axis: PRESS_AXIS_Y, sign: 1 });
  });
});

// ---------------------------------------------------------------------------
// 카탈로그 · 데이터 불변식
// ---------------------------------------------------------------------------

describe('압축 프레스 카탈로그', () => {
  it('catalogId 6 이 프레스이고 카탈로그는 17종이다(append-only)', () => {
    expect(INVASION_FACILITIES.length).toBe(17); // Lane9: 톡사르 9~12 · 크라스 13~16 append
    expect(PRESS_SPEC.behavior).toBe(FACILITY_BEHAVIOR_PRESS);
    expect(PRESS_SPEC.key).toBe('fac.press');
    // 앞선 6종의 키가 한 칸도 밀리지 않았다(해시·배치 jsonb 계약).
    expect(INVASION_FACILITIES.slice(0, 6).map((f) => f.key)).toEqual([
      'fac.rapid',
      'fac.rail',
      'fac.mortar',
      'fac.laser',
      'fac.flame',
      'fac.spawner',
    ]);
  });

  it('프레스 수치는 전부 정수다(f64 스키마 배제)', () => {
    for (const spec of INVASION_FACILITIES) {
      if (spec.behavior !== FACILITY_BEHAVIOR_PRESS) continue;
      for (const v of [
        spec.pressHalfAlong,
        spec.pressHalfAcross,
        spec.pressTravel,
        spec.pressPeriodTicks,
        spec.pressCrushDamage,
      ]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('심층 방어: 판 전두께 > 최대 대시 스텝 + 프레스 최대 이동', () => {
    // 스윕 판정만으로도 관통은 0 이지만, 데이터가 이 여유를 잃으면 밀어낸 자리가
    // 판 반대편에 가까워져 체감이 무너진다. 카탈로그 수치를 고칠 때의 안전선이다.
    for (const spec of INVASION_FACILITIES) {
      if (spec.behavior !== FACILITY_BEHAVIOR_PRESS) continue;
      const wallStep = pressMaxStep(spec.pressTravel, spec.pressPeriodTicks);
      expect(spec.pressHalfAlong * 2).toBeGreaterThan(MAX_PLAYER_STEP_UNITS + wallStep);
    }
  });
});

// ---------------------------------------------------------------------------
// 스윕 판정 원시 함수
// ---------------------------------------------------------------------------

describe('sweepAabbEntry(상대 프레임 슬랩 클립)', () => {
  it('한 틱에 상자를 통째로 건너뛰는 선분도 반드시 잡는다(정적 겹침 판정과의 차이)', () => {
    // 두께 20(반 10)짜리 상자를 -200 → +200 으로 한 번에 지나간다. 시작·끝 어느 쪽도
    // 상자와 겹치지 않으므로 정적 겹침 판정으로는 0건이다.
    const hit = sweepAabbEntry(0, -200, 0, 200, 50, 10);
    expect(hit).not.toBeNull();
    expect(hit!.inside).toBe(false);
    expect(hit!.ny).toBe(-1);
    expect(hit!.t).toBeGreaterThan(0);
    expect(hit!.t).toBeLessThan(1);
  });

  it('상자를 비껴가면 null', () => {
    expect(sweepAabbEntry(200, -200, 200, 200, 50, 10)).toBeNull();
  });

  it('시작부터 겹쳐 있으면 inside 로 표시한다(끼임 진입)', () => {
    const hit = sweepAabbEntry(0, 0, 0, 5, 50, 10);
    expect(hit).not.toBeNull();
    expect(hit!.inside).toBe(true);
  });

  it('표면에 정확히 얹힌 채 안쪽으로 들어가는 경계 케이스를 놓치지 않는다', () => {
    const hit = sweepAabbEntry(0, -10, 0, -5, 50, 10);
    expect(hit).not.toBeNull();
  });

  it('비유한 입력은 null(NaN 전파 차단)', () => {
    expect(sweepAabbEntry(NaN, 0, 0, 0, 50, 10)).toBeNull();
    expect(sweepAabbEntry(0, 0, Infinity, 0, 50, 10)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ① 터널링 0 — 파라미터 전수 스윕
// ---------------------------------------------------------------------------

/**
 * 프레스 1기 + 플레이어 1명의 최소 세계. 플레이어는 매 틱 `dy` 만큼(최대 대시 스텝) 프레스
 * 쪽으로 밀고 들어간다. world.ts 의 틱 순서를 그대로 재현한다:
 *   ① 플레이어 이동(프레스는 아직 이전 좌표)
 *   ② stepMovingWalls — 프레스 이동 + 상대 프레임 스윕 해결
 */
interface TunnelProbe {
  /** 시작 시점 플레이어가 판 안에 있어(초기 조건 무효) 관측을 건너뛴 경우. */
  readonly skipped: boolean;
  /** 시작 시점 플레이어가 프레스의 어느 쪽에 있었나(+1 / -1). */
  readonly startSide: number;
  /** 관측된 최악(반대편 최대 침투) 부호. 반대편으로 넘어갔으면 -startSide. */
  readonly flipped: boolean;
  readonly finite: boolean;
  readonly maxAbs: number;
}

function runTunnelProbe(
  spec: FacilitySpec,
  facingDeg: number,
  socketY: number,
  startY: number,
  dy: number,
  ticks: number,
): TunnelProbe {
  const state = createWorld(9);
  const press = spawnMovingWall(state, socketAt(0, socketY, facingDeg), 0, ref(PRESS_FACILITY_CATALOG_ID), spec)!;
  rebuildWalls(state);
  const ctx = ctxOf(layersWith([]));
  const p = player(state);
  p.x = 0;
  p.y = startY;
  // 시작부터 판 안에 서 있는 배치는 "통과했는가" 를 물을 수 없다(어느 쪽으로 뱉어도
  // 정상이다). 관통 관측의 전제는 **시작 시점에 판 밖**이라는 것이다.
  if (Math.abs(p.y - press.y) <= press.targetX + p.radius) {
    return { skipped: true, startSide: 0, flipped: false, finite: true, maxAbs: 0 };
  }
  const startSide = p.y - press.y >= 0 ? 1 : -1;
  let flipped = false;
  let finite = true;
  let maxAbs = 0;
  for (let t = 0; t < ticks; t++) {
    state.tick = t;
    // ① 플레이어 이동 + 스크롤 창 클램프(world.ts stepPlayer 와 같은 순서). 프레스와의
    //    겹침 해결은 ② 가 전담하므로 벽 슬라이드는 재현하지 않는다.
    p.y += dy;
    const c = clampToWindow(p.x, p.y, p.radius, ctx.runtime);
    p.x = c.x;
    p.y = c.y;
    // ② 프레스 이동 + 스윕 해결.
    stepMovingWalls(state, ctx);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) finite = false;
    const a = Math.abs(p.x) > Math.abs(p.y) ? Math.abs(p.x) : Math.abs(p.y);
    if (a > maxAbs) maxAbs = a;
    // 관통 = **판에 닿지 않은 자유 상태로** 반대편에 나타나는 것. 끼임(겹침) 프레임은
    // 통과가 아니므로 제외한다.
    const rel = p.y - press.y;
    const side = rel >= 0 ? 1 : -1;
    const free = Math.abs(rel) > press.targetX + p.radius;
    if (side !== startSide && free) flipped = true;
  }
  return { skipped: false, startSide, flipped, finite, maxAbs };
}

describe('① 터널링 0 — 최대 대시 × 벽 최대 접근 속도 전수 스윕', () => {
  it('어떤 (주기, 이동거리, 진입 방향, 시작 오프셋) 조합에서도 관통이 0 건이다', () => {
    // 주기가 짧을수록 벽이 빠르다. 8틱 주기 × 900유닛 이동 = 편도 4틱, 틱당 225유닛 —
    // 대시(59)와 합치면 284유닛으로 판 전두께(260)를 **넘어선다**. 정적 폭 비교였다면
    // 여기서 무너지는 조합이다.
    const periods = [8, 12, 20, 40, 60, 120, 240];
    const travels = [200, 420, 620, 840];
    const starts = [-460, -300, -120, 0, 120, 300, 460];
    let cases = 0;
    for (const period of periods) {
      for (const travel of travels) {
        const spec = pressSpec({ pressPeriodTicks: period, pressTravel: travel });
        for (const startY of starts) {
          for (const dy of [MAX_PLAYER_STEP_UNITS, -MAX_PLAYER_STEP_UNITS]) {
            for (const [facing, socketY] of [
              [90, -500],
              [270, 500],
            ] as const) {
              const probe = runTunnelProbe(spec, facing, socketY, startY, dy, period * 3 + 40);
              if (probe.skipped) continue;
              expect(probe.flipped).toBe(false);
              expect(probe.finite).toBe(true);
              expect(probe.maxAbs).toBeLessThan(10000);
              cases++;
            }
          }
        }
      }
    }
    // 스윕이 실제로 돌았는지(0건 통과 위장 방지). 초기 겹침으로 건너뛴 조합을 빼도
    // 유효 케이스가 300건 이상 남는다.
    expect(cases).toBeGreaterThanOrEqual(300);
  });

  it('플레이어가 정지해 있어도 다가오는 판이 밀어낸다(관통 아님)', () => {
    const spec = pressSpec({ pressPeriodTicks: 60, pressTravel: 840 });
    const probe = runTunnelProbe(spec, 90, -500, 0, 0, 200);
    expect(probe.flipped).toBe(false);
    expect(probe.finite).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ② 끼임(crush)
// ---------------------------------------------------------------------------

describe('② 끼임 규칙', () => {
  /** 판이 스크롤 창 아래 경계까지 밀고 들어와 플레이어가 갇히는 세계. */
  function crushWorld(): { state: WorldState; ctx: InvasionStepContext; press: Entity; p: Entity } {
    const state = createWorld(21);
    // 이동 거리를 창 절반(540)보다 크게 잡아 밀어낼 공간을 확실히 없앤다.
    const spec = pressSpec({ pressPeriodTicks: 120, pressTravel: 1400 });
    const press = spawnMovingWall(state, socketAt(0, -500, 90), 0, ref(PRESS_FACILITY_CATALOG_ID), spec)!;
    rebuildWalls(state);
    const ctx = ctxOf(layersWith([]));
    const p = player(state);
    p.x = 0;
    p.y = 300;
    return { state, ctx, press, p };
  }

  it('밀어낼 공간이 없으면 좌표가 유한하게 고정되고 고정 피해만 들어간다', () => {
    const { state, ctx, p } = crushWorld();
    const hp0 = p.hp;
    for (let t = 0; t < 400; t++) {
      state.tick = t;
      stepMovingWalls(state, ctx);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isNaN(p.x)).toBe(false);
      expect(Number.isNaN(p.y)).toBe(false);
      // 좌표 폭주 0: 스크롤 창(±960 / ±540) 밖으로 절대 나가지 않는다.
      expect(Math.abs(p.x)).toBeLessThanOrEqual(960);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(540);
    }
    expect(p.hp).toBeLessThan(hp0);
    expect(Number.isFinite(p.hp)).toBe(true);
    expect(p.hp).toBeGreaterThanOrEqual(0);
  });

  it('끼임 피해가 무적 프레임을 존중해 매 틱 누적되지 않는다', () => {
    const { state, ctx, p } = crushWorld();
    let hits = 0;
    let prev = p.hp;
    for (let t = 0; t < 240; t++) {
      state.tick = t;
      stepMovingWalls(state, ctx);
      if (p.hp < prev) hits++;
      prev = p.hp;
      if (p.iframes > 0) p.iframes--; // world.ts stepPlayer 의 무적 감쇠 재현
    }
    // 무적이 없다면 240회 갈렸을 것이다.
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(240);
  });

  it('끼임 전개가 2회 재실행에서 바이트 동일하다(결정론)', () => {
    const run = (): string => {
      const { state, ctx, p } = crushWorld();
      const log: number[] = [];
      for (let t = 0; t < 300; t++) {
        state.tick = t;
        stepMovingWalls(state, ctx);
        log.push(p.x, p.y, p.hp, p.iframes);
        if (p.iframes > 0) p.iframes--;
      }
      return JSON.stringify(log);
    };
    expect(run()).toBe(run());
  });

  it('끼임 피해가 0 인 스펙은 좌표만 고정하고 피해를 주지 않는다', () => {
    const state = createWorld(22);
    const spec = pressSpec({ pressPeriodTicks: 120, pressTravel: 1400, pressCrushDamage: 0 });
    spawnMovingWall(state, socketAt(0, -500, 90), 0, ref(PRESS_FACILITY_CATALOG_ID), spec);
    rebuildWalls(state);
    const ctx = ctxOf(layersWith([]));
    const p = player(state);
    p.x = 0;
    p.y = 300;
    const hp0 = p.hp;
    for (let t = 0; t < 300; t++) {
      state.tick = t;
      stepMovingWalls(state, ctx);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(p.hp).toBe(hp0);
  });
});

// ---------------------------------------------------------------------------
// ④ wallIndex 정합
// ---------------------------------------------------------------------------

describe('④ wallIndex 가 이동 벽에서도 직접 스윕과 동일하다', () => {
  /** 정적 벽 + 이동 프레스가 섞인 회랑. */
  function corridor(): { state: WorldState; ctx: InvasionStepContext } {
    const state = createWorld(31);
    const layers = layersWith([
      ref(PRESS_FACILITY_CATALOG_ID),
      ref(0),
      ref(PRESS_FACILITY_CATALOG_ID),
      null,
      ref(PRESS_FACILITY_CATALOG_ID),
    ]);
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    // enterFacilityLayer 와 같은 순서로 정적 벽부터 깐다(배열 순서 = 결정론 입력).
    for (const w of template.walls) spawnWall(state, w.x, w.y, w.halfW, w.halfH);
    for (let i = 0; i < 5; i++) {
      const r = layers.l2.sockets[i];
      if (r !== null && r !== undefined) spawnFacility(state, template.sockets[i]!, i, r, MAINTENANCE_FULL);
    }
    rebuildWalls(state);
    state.wallIndex = new InvasionWallIndex();
    state.wallIndex.rebuild(state.activeWalls);
    return { state, ctx: ctxOf(layers) };
  }

  it('프레스가 매 틱 움직여도 firstBlocking 이 직접 스윕과 항상 일치한다', () => {
    const { state, ctx } = corridor();
    const index = state.wallIndex!;
    expect(state.entities.filter(isMovingWall).length).toBe(3);
    for (let t = 0; t < 300; t++) {
      state.tick = t;
      stepMovingWalls(state, ctx);
      for (let x = 400; x <= 11000; x += 730) {
        for (let y = -700; y <= 700; y += 97) {
          const a = index.firstBlocking(x, y, 8);
          const b = sweepWallsDirect(state.activeWalls, x, y, 8);
          expect(a).toBe(b);
        }
      }
    }
  });

  it('갱신을 건너뛰면 실제로 결과가 갈린다(테스트가 무의미하지 않다는 증명)', () => {
    const { state, ctx } = corridor();
    const stale = new InvasionWallIndex();
    stale.rebuild(state.activeWalls);
    // 인덱스를 world.ts 처럼 틱 머리에 한 번만 만들고, 이동 후 갱신하지 않는다.
    let mismatches = 0;
    for (let t = 0; t < 200; t++) {
      state.tick = t;
      stepMovingWalls(state, ctx); // state.wallIndex 는 refresh 되지만 stale 은 아니다
      for (let y = -700; y <= 700; y += 23) {
        const a = stale.firstBlocking(900, y, 8);
        const b = sweepWallsDirect(state.activeWalls, 900, y, 8);
        if (a !== b) mismatches++;
      }
    }
    expect(mismatches).toBeGreaterThan(0);
  });

  it('stepMovingWalls 가 프레스 이동 뒤 격자를 갱신한다(rebuild 횟수 증가)', () => {
    const { state, ctx } = corridor();
    const before = state.wallIndex!.buildCount;
    state.tick = 1;
    stepMovingWalls(state, ctx);
    expect(state.wallIndex!.buildCount).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// 진입 스폰 배선
// ---------------------------------------------------------------------------

describe('설비 스폰 배선', () => {
  it('프레스 소켓은 설비 엔티티가 아니라 이동 벽을 만든다', () => {
    const state = createWorld(41);
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const e = spawnFacility(state, template.sockets[0]!, 0, ref(PRESS_FACILITY_CATALOG_ID), MAINTENANCE_FULL);
    expect(e).toBeDefined();
    expect(e!.kind).toBe('wall');
    expect(e!.enemyType).toBe(MOVING_WALL_TAG);
    expect(isMovingWall(e!)).toBe(true);
    // 파괴 불가(정적 벽과 같은 취급).
    expect(e!.hp).toBe(0);
    // 상단 벽 소켓(facing 90)은 Y 축 +방향으로 뻗는다.
    expect(e!.phase).toBe(PRESS_AXIS_Y);
    expect(e!.pierce).toBe(1);
    expect(e!.targetY).toBe(template.sockets[0]!.y);
  });

  it('일반 설비는 이동 벽으로 오분류되지 않는다', () => {
    const state = createWorld(42);
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const e = spawnFacility(state, template.sockets[0]!, 0, ref(0), MAINTENANCE_FULL)!;
    expect(isMovingWall(e)).toBe(false);
  });

  it('stepFacility 가 프레스를 옮긴다(설비 스텝 경로에 실제로 물려 있다)', () => {
    const state = createWorld(43);
    const layers = layersWith([ref(PRESS_FACILITY_CATALOG_ID)]);
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const press = spawnFacility(state, template.sockets[0]!, 0, ref(PRESS_FACILITY_CATALOG_ID), MAINTENANCE_FULL)!;
    rebuildWalls(state);
    const ctx = ctxOf(layers);
    const y0 = press.y;
    let moved = false;
    for (let t = 0; t < 90; t++) {
      state.tick = t;
      stepFacility(state, ctx);
      if (press.y !== y0) moved = true;
    }
    expect(moved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 정규 경로 통합 — createWorld → stepWorld
// ---------------------------------------------------------------------------

function pressLayers(): InvasionLayers {
  // 12소켓 직선형에 프레스를 3기 섞는다(나머지는 일반 설비).
  return normalizeInvasionLayers({
    l2: {
      templateId: MAP_TEMPLATE_STRAIGHT,
      sockets: Array.from({ length: 12 }, (_, i) =>
        i % 4 === 0 ? ref(PRESS_FACILITY_CATALOG_ID) : ref(i % 3),
      ),
    },
  });
}

function pressConfig(): WorldConfig {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  config.invasion3 = {
    layers: pressLayers(),
    timeLimitTicks: INVASION_TOTAL_TICKS,
    maintenance: 10000,
  };
  return config;
}

interface L2Observation {
  readonly sawPress: number;
  readonly pressMoved: boolean;
  readonly l2Ticks: number;
  readonly finite: boolean;
  readonly overlapTicks: number;
  readonly stream: string;
}

/** 정규 경로로 L2 에 진입할 때까지 돌린 뒤, L2 구간을 관측한다. */
function observeL2(seed: number, l2Budget: number): L2Observation {
  const state = createWorld(seed, pressConfig());
  let sawPress = 0;
  let pressMoved = false;
  let l2Ticks = 0;
  let finite = true;
  let overlapTicks = 0;
  const stream: number[] = [];
  const prevY = new Map<number, number>();
  for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
    stepWorld(state, autopilotInput(state));
    if (state.gameOver || state.victory) break;
    if (state.invasion3?.phase !== PHASE_L2) continue;
    l2Ticks++;
    const presses = state.entities.filter((e) => !e.dead && isMovingWall(e));
    if (presses.length > sawPress) sawPress = presses.length;
    const p = player(state);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.hp)) finite = false;
    for (const w of presses) {
      const before = prevY.get(w.id);
      if (before !== undefined && before !== w.y) pressMoved = true;
      prevY.set(w.id, w.y);
      if (circleOverlapsWall(p.x, p.y, p.radius, w)) overlapTicks++;
      stream.push(w.x, w.y);
    }
    stream.push(Math.round(p.x * 1000), Math.round(p.y * 1000));
    if (l2Ticks >= l2Budget) break;
  }
  return { sawPress, pressMoved, l2Ticks, finite, overlapTicks, stream: JSON.stringify(stream) };
}

describe('⑤ 정규 경로 통합 — 프레스가 배치된 실제 L2 런', () => {
  it('createWorld → stepWorld 로 프레스가 실제 스폰돼 움직이고 런이 계속 진행된다', () => {
    const obs = observeL2(7, 900);
    // 3기(소켓 0·4·8)가 실제 런에서 살아 있다 — 스텝 훅 미배선이면 여기서 0 이 된다.
    expect(obs.sawPress).toBe(3);
    expect(obs.pressMoved).toBe(true);
    expect(obs.l2Ticks).toBeGreaterThan(500);
    expect(obs.finite).toBe(true);
  });

  it('플레이어가 프레스를 통과하지 못한다(정규 런 전 구간, 겹침은 끼임 프레임뿐)', () => {
    const obs = observeL2(7, 900);
    // 겹침이 아예 0 일 필요는 없다(끼임 규칙이 좌표를 고정하는 프레임은 겹친다).
    // 다만 그 상태로 오래 머물면 통과·관통과 구분이 안 되므로 상한을 둔다.
    expect(obs.overlapTicks).toBeLessThan(obs.l2Ticks / 4);
  });

  it('같은 시드 2회 재실행이 바이트 동일하다(프레스 좌표 + 플레이어 좌표 스트림)', () => {
    expect(observeL2(7, 400).stream).toBe(observeL2(7, 400).stream);
  });
});

// ---------------------------------------------------------------------------
// ⑥ PvE 미오염
// ---------------------------------------------------------------------------

describe('⑥ PvE 경로 미오염', () => {
  it('PvE 런은 wallIndex 를 만들지 않고 이동 벽도 생기지 않는다', () => {
    const state = createWorld(3);
    expect(state.wallIndex).toBeNull();
    for (let t = 0; t < 600; t++) {
      stepWorld(state, { moveX: 1, moveY: 0, aim: 0, dash: false, special: 0 });
      if (state.gameOver || state.victory) break;
    }
    expect(state.wallIndex).toBeNull();
    expect(state.entities.some(isMovingWall)).toBe(false);
    // 일반 벽은 MOVING_WALL_TAG 를 절대 갖지 않는다(표식 오염 감지).
    for (const e of state.entities) {
      if (e.kind === 'wall') expect(e.enemyType).not.toBe(MOVING_WALL_TAG);
    }
  });

  it('PvE 해시 스트림이 이동 벽 도입 전후로 동일하다(로컬 스모크)', () => {
    // determinism.test.ts 가 골든 해시를 소유하므로 여기서는 "두 번 돌리면 같다" 만
    // 확인한다(회귀 골든은 그쪽 레인이 강제한다).
    const run = (): number[] => {
      const state = createWorld(77);
      const out: number[] = [];
      for (let t = 0; t < 300; t++) {
        stepWorld(state, { moveX: 0, moveY: 1, aim: 1, dash: t % 40 === 0, special: 0 });
        out.push(Math.round(state.entities.length), Math.round(player(state).x * 1000));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
