/**
 * L2 설비(방향 제한 방어포 · 주기 온오프 해저드 · 드론 스포너) + 벽 broad-phase 검증.
 *
 * 레인 문서 L4-facility 의 검증 항목 6개를 그대로 옮긴다:
 *   ① arcDeg 밖 각도의 플레이어에게 미사격, 안쪽에서만 사격
 *   ② 해저드 주기 토글이 틱 순수 함수(period=120, on=40 경계 틱 골든)
 *   ③ 스포너 RNG 미소비
 *   ④ wallIndex 가 활성 벽 80개에서도 직접 스윕과 동일 결과 + 판정 횟수 감소
 *   ⑤ 예고선(windup) 동안 무피해, active 에서만 피해
 *   ⑥ 맵 템플릿 소켓 좌표가 상·하 벽 안쪽에 있는지 기하 검증
 */

import { describe, it, expect } from 'vitest';
import { createWorld } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import type { Entity } from '../src/sim/entities.js';
import { circleOverlapsWall } from '../src/sim/los.js';
import { spawnWall } from '../src/sim/entities.js';
import {
  normalizeInvasionLayers,
  emptyInvasionLayers,
} from '../src/sim/invasion/normalize.js';
import type { InvasionLayers, InvasionStepContext, FacilityRef } from '../src/sim/invasion/types.js';
import { INVASION_WINDOW_HALF_W } from '../src/sim/invasion/scroll.js';
import {
  INVASION_SOCKET_COUNTS,
  MAP_TEMPLATE_STRAIGHT,
  MAP_TEMPLATE_CURVED,
  MAP_TEMPLATE_CHOKE,
  PHASE_L2,
  INVASION_ACCEL_BASE_CP,
} from '../src/sim/invasion/constants.js';
import {
  enterFacilityLayer,
  stepFacility,
  spawnFacility,
  withinArc,
  isFacility,
  facilityCatalogId,
  resolveFacilityStats,
  FACILITY_GUN_KIND,
  FACILITY_HAZARD_KIND,
  FACILITY_SPAWNER_KIND,
  SPAWN_BUDGET_UNLIMITED,
} from '../src/sim/invasion/facility.js';
import {
  cyclePosition,
  isCycleOn,
  isCycleSpawnTick,
  socketPhaseOffset,
} from '../src/sim/invasion/hazardCycle.js';
import { InvasionWallIndex, sweepWallsDirect } from '../src/sim/invasion/wallIndex.js';
import {
  INVASION_MAP_TEMPLATES,
  mapTemplateFor,
  SOCKET_WALL_INSET,
} from '../data/invasion/mapTemplates.js';
import {
  INVASION_FACILITIES,
  facilitySpecFor,
  FACILITY_BEHAVIOR_TURRET,
  FACILITY_BEHAVIOR_HAZARD,
  FACILITY_BEHAVIOR_SPAWNER,
  GARRISON_FACILITY_CATALOG_ID,
} from '../data/invasion/facilities.js';
import { MAINTENANCE_FULL } from '../src/sim/invasion/guardian.js';
import { INVASION_DENSITY_LEGACY } from '../src/sim/invasion/density.js';

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

/** catalogId 로 lv1 노말 Ref 를 만든다. */
function ref(catalogId: number, level = 1, rarity = 0, ascension = 0): FacilityRef {
  return { catalogId, level, ascension, affixSeed: 0, rarity };
}

/** 지정 템플릿 + 소켓 배치로 정규화된 layers 를 만든다. */
function layersWith(templateId: number, sockets: (FacilityRef | null)[]): InvasionLayers {
  const base = emptyInvasionLayers();
  base.l2.templateId = templateId;
  base.l2.sockets = sockets.slice();
  return normalizeInvasionLayers(base);
}

function ctxOf(layers: InvasionLayers, maintenance = MAINTENANCE_FULL): InvasionStepContext {
  // 밀도 축을 구값으로 고정한다 — 이 파일의 단언은 구 스케줄(720틱·1회 순회) 전제라,
  // 여기서 LEGACY 를 쓰는 것이 곧 "밀도를 끄면 예전과 같은가"를 지키는 가드가 된다.
  return {
    layers,
    runtime: {
      phase: PHASE_L2 as 0 | 1 | 2,
      phaseEnterTick: 0,
      scrollX: 0,
      scrollY: 0,
      accelCp: INVASION_ACCEL_BASE_CP,
    },
    maintenance,
    density: INVASION_DENSITY_LEGACY,
    defenseBonusBp: 0,
    // 기본 수비대도 중립 레벨(=100cp, ×1.00)로 고정 — 위 LEGACY 밀도와 같은 이유다.
    garrisonLevel: 1,
  };
}

/** 플레이어를 절대 좌표로 옮긴다(침공은 스크롤 창 절대 좌표계). */
function movePlayer(state: WorldState, x: number, y: number): Entity {
  const p = state.entities[0]!;
  expect(p.kind).toBe('player');
  p.x = x;
  p.y = y;
  return p;
}

function countKind(state: WorldState, kind: string): number {
  let n = 0;
  for (const e of state.entities) if (e.kind === kind && !e.dead) n++;
  return n;
}

/** 활성 벽 목록을 world.ts 와 같은 규칙(배열 순서)으로 만든다. */
function rebuildWalls(state: WorldState): void {
  state.activeWalls.length = 0;
  for (const e of state.entities) if (e.kind === 'wall' && !e.dead) state.activeWalls.push(e);
}

// ---------------------------------------------------------------------------
// ⑥ 맵 템플릿 기하
// ---------------------------------------------------------------------------

describe('맵 템플릿 3종', () => {
  it('템플릿 코드 = 배열 인덱스이고 소켓 수가 INVASION_SOCKET_COUNTS 와 일치한다', () => {
    expect(INVASION_MAP_TEMPLATES.length).toBe(INVASION_SOCKET_COUNTS.length);
    for (let i = 0; i < INVASION_MAP_TEMPLATES.length; i++) {
      const t = INVASION_MAP_TEMPLATES[i]!;
      expect(t.id).toBe(i);
      expect(t.sockets.length).toBe(INVASION_SOCKET_COUNTS[i]);
    }
    expect(INVASION_MAP_TEMPLATES[MAP_TEMPLATE_STRAIGHT]!.sockets.length).toBe(12);
    expect(INVASION_MAP_TEMPLATES[MAP_TEMPLATE_CURVED]!.sockets.length).toBe(10);
    expect(INVASION_MAP_TEMPLATES[MAP_TEMPLATE_CHOKE]!.sockets.length).toBe(8);
  });

  it('모든 좌표·각도가 정수다(f64 스키마 배제)', () => {
    for (const t of INVASION_MAP_TEMPLATES) {
      for (const w of t.walls) {
        for (const v of [w.x, w.y, w.halfW, w.halfH]) expect(Number.isInteger(v)).toBe(true);
        // 터널링 방지 전제: 벽 최소 폭 120u > 최대 대시 스텝 59u.
        expect(Math.min(w.halfW, w.halfH) * 2).toBeGreaterThanOrEqual(120);
      }
      for (const s of t.sockets) {
        for (const v of [s.x, s.y, s.facingDeg, s.arcDeg]) expect(Number.isInteger(v)).toBe(true);
        expect(s.arcDeg).toBeGreaterThan(0);
        expect(s.arcDeg).toBeLessThan(360);
      }
    }
  });

  it('소켓은 벽 안(개활부)에 있고, 가장 가까운 벽 면에 부착돼 있다', () => {
    for (const t of INVASION_MAP_TEMPLATES) {
      // 벽 AABB 를 el 엔티티 형태로(circleOverlapsWall 의 필드 매핑 재사용).
      const walls = t.walls.map(
        (w) => ({ x: w.x, y: w.y, radius: w.halfW, targetX: w.halfH }) as Entity,
      );
      for (const s of t.sockets) {
        // (a) 소켓 중심이 어떤 벽 안에도 박혀 있지 않다.
        expect(sweepWallsDirect(walls, s.x, s.y, 0)).toBeNull();
        // (b) 회랑 x 범위 안이다.
        expect(s.x).toBeGreaterThan(0);
        expect(s.x).toBeLessThan(t.lengthUnits);
        // (c) 벽에 부착: 반경 SOCKET_WALL_INSET 까지 키우면 반드시 어떤 벽에 닿는다.
        expect(sweepWallsDirect(walls, s.x, s.y, SOCKET_WALL_INSET)).not.toBeNull();
        // (d) 조준 방향 반대편(벽 쪽)이 아니라 개활부를 본다: facing 방향 200u 앞은 벽 밖.
        const rad = (s.facingDeg * Math.PI) / 180;
        const fx = s.x + Math.cos(rad) * 200;
        const fy = s.y + Math.sin(rad) * 200;
        expect(sweepWallsDirect(walls, fx, fy, 0)).toBeNull();
      }
    }
  });

  it('범위 밖 템플릿 코드는 직선형으로 폴백한다', () => {
    expect(mapTemplateFor(-1).id).toBe(MAP_TEMPLATE_STRAIGHT);
    expect(mapTemplateFor(99).id).toBe(MAP_TEMPLATE_STRAIGHT);
  });
});

// ---------------------------------------------------------------------------
// 카탈로그
// ---------------------------------------------------------------------------

describe('설비 카탈로그', () => {
  it('기본 수비대 충원값(catalogId 0)은 속사포 방어포다', () => {
    expect(GARRISON_FACILITY_CATALOG_ID).toBe(0);
    const spec = facilitySpecFor(GARRISON_FACILITY_CATALOG_ID)!;
    expect(spec.key).toBe('fac.rapid');
    expect(spec.behavior).toBe(FACILITY_BEHAVIOR_TURRET);
  });

  it('거동 3갈래가 모두 등재돼 있고 주기 불변식(windup+on <= period)을 지킨다', () => {
    const behaviors = new Set(INVASION_FACILITIES.map((f) => f.behavior));
    expect(behaviors.has(FACILITY_BEHAVIOR_TURRET)).toBe(true);
    expect(behaviors.has(FACILITY_BEHAVIOR_HAZARD)).toBe(true);
    expect(behaviors.has(FACILITY_BEHAVIOR_SPAWNER)).toBe(true);
    for (const f of INVASION_FACILITIES) {
      if (f.behavior !== FACILITY_BEHAVIOR_HAZARD) continue;
      expect(f.periodTicks).toBeGreaterThan(0);
      expect(f.windupTicks + f.onTicks).toBeLessThanOrEqual(f.periodTicks);
    }
  });

  it('실효 스탯은 정수이고 레벨·등급·승급 순 반올림이 결정론이다', () => {
    const spec = facilitySpecFor(0)!;
    const a = resolveFacilityStats(spec, ref(0, 10, 2, 3), MAINTENANCE_FULL);
    const b = resolveFacilityStats(spec, ref(0, 10, 2, 3), MAINTENANCE_FULL);
    expect(a).toEqual(b);
    expect(Number.isInteger(a.hp)).toBe(true);
    expect(Number.isInteger(a.damage)).toBe(true);
    const base = resolveFacilityStats(spec, ref(0), MAINTENANCE_FULL);
    expect(a.hp).toBeGreaterThan(base.hp);
  });

  it('정비도 0% 에서 발사 간격이 정확히 2배다(정수 centi-percent)', () => {
    const spec = facilitySpecFor(0)!;
    const full = resolveFacilityStats(spec, ref(0), MAINTENANCE_FULL);
    const dead = resolveFacilityStats(spec, ref(0), 0);
    expect(dead.fireCooldown).toBe(full.fireCooldown * 2);
  });
});

// ---------------------------------------------------------------------------
// ① 사계(arc) 제한
// ---------------------------------------------------------------------------

describe('방향 제한 방어포', () => {
  it('withinArc 가 facing ± arc/2 를 경계 포함으로 판정한다', () => {
    // facing = +Y(90도), arc = 160도 → 허용 [10도, 170도].
    const facing = Math.PI / 2;
    const deg = (d: number): number => (d * Math.PI) / 180;
    expect(withinArc(facing, 160, deg(90))).toBe(true);
    expect(withinArc(facing, 160, deg(11))).toBe(true);
    expect(withinArc(facing, 160, deg(169))).toBe(true);
    expect(withinArc(facing, 160, deg(9))).toBe(false);
    expect(withinArc(facing, 160, deg(171))).toBe(false);
    // 벽 뒤(위쪽 = -Y = -90도)는 절대 불가.
    expect(withinArc(facing, 160, deg(-90))).toBe(false);
    // 전방위 호환 경로.
    expect(withinArc(facing, 360, deg(-90))).toBe(true);
  });

  it('사계 밖 플레이어에게는 쏘지 않고, 안쪽으로 들어오면 즉시 쏜다', () => {
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const socket = template.sockets[0]!; // 위 벽, facing 90(아래), arc 160
    const layers = layersWith(MAP_TEMPLATE_STRAIGHT, []);
    const ctx = ctxOf(layers);

    // --- 사계 밖(벽 반대편 = 소켓 위쪽)에 플레이어 ---
    const outside = createWorld(7);
    const fOut = spawnFacility(outside, socket, 0, ref(0), MAINTENANCE_FULL)!;
    fOut.timer = 0; // 즉시 발사 가능 상태
    movePlayer(outside, socket.x, socket.y - 300); // 위쪽 = 벽 쪽
    stepFacility(outside, ctx);
    expect(countKind(outside, 'enemyBullet')).toBe(0);

    // --- 사계 안(회랑 쪽 = 소켓 아래) ---
    const inside = createWorld(7);
    const fIn = spawnFacility(inside, socket, 0, ref(0), MAINTENANCE_FULL)!;
    fIn.timer = 0;
    movePlayer(inside, socket.x, socket.y + 300);
    stepFacility(inside, ctx);
    expect(countKind(inside, 'enemyBullet')).toBe(1);
  });

  it('사거리 밖에서는 카운트다운을 유지해 사정권 진입 시 즉발한다', () => {
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const socket = template.sockets[0]!;
    const spec = facilitySpecFor(0)!;
    const state = createWorld(3);
    const f = spawnFacility(state, socket, 0, ref(0), MAINTENANCE_FULL)!;
    f.timer = 0;
    const ctx = ctxOf(layersWith(MAP_TEMPLATE_STRAIGHT, []));
    movePlayer(state, socket.x, socket.y + spec.range + 500);
    stepFacility(state, ctx);
    expect(f.timer).toBe(0);
    expect(countKind(state, 'enemyBullet')).toBe(0);
    movePlayer(state, socket.x, socket.y + 200);
    stepFacility(state, ctx);
    expect(countKind(state, 'enemyBullet')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 예고선(windup)
// ---------------------------------------------------------------------------

describe('관통 레일포 예고선', () => {
  it('예고 틱 동안 탄이 없고(무피해), 예고가 끝난 틱에만 발사한다', () => {
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const socket = template.sockets[0]!;
    const spec = facilitySpecFor(1)!; // 관통 레일포
    expect(spec.telegraphTicks).toBeGreaterThan(0);
    const state = createWorld(11);
    const f = spawnFacility(state, socket, 0, ref(1), MAINTENANCE_FULL)!;
    f.timer = 0;
    const ctx = ctxOf(layersWith(MAP_TEMPLATE_STRAIGHT, []));
    movePlayer(state, socket.x, socket.y + 400);

    // 첫 틱: 예고선 진입만 하고 탄은 없다.
    stepFacility(state, ctx);
    expect(f.phase).toBe(1);
    expect(f.timer).toBe(spec.telegraphTicks);
    expect(countKind(state, 'enemyBullet')).toBe(0);

    // 예고 구간 전체가 무피해.
    for (let i = 0; i < spec.telegraphTicks; i++) {
      stepFacility(state, ctx);
      expect(countKind(state, 'enemyBullet')).toBe(0);
    }
    // 예고 종료 틱에 발사.
    stepFacility(state, ctx);
    expect(countKind(state, 'enemyBullet')).toBe(1);
    expect(f.phase).toBe(0);
  });

  it('예고 중 잠긴 조준각으로 발사한다(플레이어가 이동해도 각도 불변)', () => {
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const socket = template.sockets[0]!;
    const spec = facilitySpecFor(1)!;
    const state = createWorld(11);
    const f = spawnFacility(state, socket, 0, ref(1), MAINTENANCE_FULL)!;
    f.timer = 0;
    const ctx = ctxOf(layersWith(MAP_TEMPLATE_STRAIGHT, []));
    movePlayer(state, socket.x, socket.y + 400);
    stepFacility(state, ctx);
    const locked = f.angle;
    // 예고 중 플레이어가 사계 밖으로 도망쳐도 잠긴 각도로 나간다.
    movePlayer(state, socket.x, socket.y - 900);
    for (let i = 0; i <= spec.telegraphTicks; i++) stepFacility(state, ctx);
    expect(countKind(state, 'enemyBullet')).toBe(1);
    expect(f.angle).toBe(locked);
  });
});

// ---------------------------------------------------------------------------
// ② 주기 온오프 해저드
// ---------------------------------------------------------------------------

describe('주기 온오프 해저드', () => {
  it('cyclePosition 이 음수 틱·음수 오프셋에서도 [0, period) 로 접힌다', () => {
    for (let t = -300; t <= 300; t++) {
      const p = cyclePosition(t, 120, 37);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(120);
    }
    expect(cyclePosition(0, 120, 0)).toBe(0);
    expect(cyclePosition(119, 120, 0)).toBe(119);
    expect(cyclePosition(120, 120, 0)).toBe(0);
    expect(cyclePosition(-1, 120, 0)).toBe(119);
  });

  it('period=120, windup=0, on=40 의 온오프 경계 틱이 골든이다', () => {
    const on = (t: number): boolean => isCycleOn(t, 120, 0, 40, 0);
    expect(on(0)).toBe(true); // 활성 첫 틱
    expect(on(39)).toBe(true); // 활성 마지막 틱
    expect(on(40)).toBe(false); // 휴지 첫 틱
    expect(on(119)).toBe(false);
    expect(on(120)).toBe(true); // 다음 주기
    expect(on(159)).toBe(true);
    expect(on(160)).toBe(false);
  });

  it('예열(windup) 구간은 무피해로 판정한다', () => {
    const on = (t: number): boolean => isCycleOn(t, 120, 24, 40, 0);
    expect(on(0)).toBe(false);
    expect(on(23)).toBe(false); // 예열 마지막 틱
    expect(on(24)).toBe(true); // 활성 첫 틱
    expect(on(63)).toBe(true); // 활성 마지막 틱
    expect(on(64)).toBe(false);
  });

  it('isCycleSpawnTick 이 주기의 시작 틱에서만 참이다', () => {
    let hits = 0;
    for (let t = 0; t < 600; t++) if (isCycleSpawnTick(t, 120, 30)) hits++;
    expect(hits).toBe(5);
    expect(isCycleSpawnTick(30, 120, 30)).toBe(true);
    expect(isCycleSpawnTick(31, 120, 30)).toBe(false);
    expect(isCycleSpawnTick(150, 120, 30)).toBe(true);
  });

  it('소켓 위상 오프셋이 결정론적으로 균등 분할된다', () => {
    expect(socketPhaseOffset(0, 120, 4)).toBe(0);
    expect(socketPhaseOffset(1, 120, 4)).toBe(30);
    expect(socketPhaseOffset(2, 120, 4)).toBe(60);
    expect(socketPhaseOffset(3, 120, 4)).toBe(90);
    expect(socketPhaseOffset(4, 120, 4)).toBe(0);
  });

  it('레이저 격자가 주기마다 장판을 다시 융기시키고, 설비가 파괴되면 멈춘다', () => {
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const socket = template.sockets[0]!;
    const spec = facilitySpecFor(3)!; // 레이저 격자
    expect(spec.behavior).toBe(FACILITY_BEHAVIOR_HAZARD);
    const state = createWorld(5);
    const f = spawnFacility(state, socket, 0, ref(3), MAINTENANCE_FULL)!;
    const ctx = ctxOf(layersWith(MAP_TEMPLATE_STRAIGHT, []));
    movePlayer(state, socket.x, socket.y + 320);

    let spawned = 0;
    for (let t = 0; t < spec.periodTicks * 3; t++) {
      state.tick = t;
      const before = state.entities.length;
      stepFacility(state, ctx);
      if (state.entities.length > before) spawned++;
    }
    expect(spawned).toBe(3);

    // 파괴되면 더 이상 융기하지 않는다.
    f.dead = true;
    const before = state.entities.length;
    for (let t = 0; t < spec.periodTicks * 2; t++) {
      state.tick = spec.periodTicks * 3 + t;
      stepFacility(state, ctx);
    }
    expect(state.entities.length).toBe(before);
  });

  it('화염 방사구는 지속 장판이다(주기 = 활성)', () => {
    const spec = facilitySpecFor(4)!;
    expect(spec.behavior).toBe(FACILITY_BEHAVIOR_HAZARD);
    expect(spec.windupTicks).toBe(0);
    expect(spec.onTicks).toBe(spec.periodTicks);
    for (let t = 0; t < 240; t++) {
      expect(isCycleOn(t, spec.periodTicks, spec.windupTicks, spec.onTicks, 0)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 드론 스포너
// ---------------------------------------------------------------------------

describe('드론 스포너', () => {
  it('생산이 RNG 를 소비하지 않는다(waveRng 내부 상태 불변)', () => {
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const socket = template.sockets[0]!;
    const spec = facilitySpecFor(5)!;
    const state = createWorld(21);
    spawnFacility(state, socket, 0, ref(5), MAINTENANCE_FULL);
    const ctx = ctxOf(layersWith(MAP_TEMPLATE_STRAIGHT, []));
    movePlayer(state, socket.x, socket.y + 400);
    const before = JSON.stringify([state.waveRng, state.rng, state.dropRng]);
    for (let t = 0; t < spec.spawnIntervalTicks * 2 + 5; t++) {
      state.tick = t;
      stepFacility(state, ctx);
    }
    expect(JSON.stringify([state.waveRng, state.rng, state.dropRng])).toBe(before);
    expect(countKind(state, 'enemy')).toBeGreaterThan(0);
  });

  it('동시 생존 상한을 넘지 않는다', () => {
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const socket = template.sockets[0]!;
    const spec = facilitySpecFor(5)!;
    const state = createWorld(22);
    spawnFacility(state, socket, 0, ref(5), MAINTENANCE_FULL);
    const ctx = ctxOf(layersWith(MAP_TEMPLATE_STRAIGHT, []));
    movePlayer(state, socket.x, socket.y + 400);
    for (let t = 0; t < spec.spawnIntervalTicks * 10; t++) {
      state.tick = t;
      stepFacility(state, ctx);
      expect(countKind(state, 'enemy')).toBeLessThanOrEqual(spec.spawnMaxAlive);
    }
    expect(countKind(state, 'enemy')).toBe(spec.spawnMaxAlive);
  });

  it('같은 입력을 두 번 돌리면 스폰 좌표·순서가 바이트 동일하다', () => {
    const run = (): string => {
      const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
      const socket = template.sockets[0]!;
      const state = createWorld(33);
      spawnFacility(state, socket, 0, ref(5), MAINTENANCE_FULL);
      const ctx = ctxOf(layersWith(MAP_TEMPLATE_STRAIGHT, []));
      movePlayer(state, socket.x, socket.y + 400);
      for (let t = 0; t < 400; t++) {
        state.tick = t;
        stepFacility(state, ctx);
      }
      return JSON.stringify(
        state.entities.filter((e) => e.kind === 'enemy').map((e) => [e.x, e.y, e.hp, e.ownerId]),
      );
    };
    expect(run()).toBe(run());
  });

  // -------------------------------------------------------------------------
  // 전방 사출 재설계(2026-07-28) — 정본
  // `.omc/research/invasion-spawner-redesign-2026-07-28.md`
  // -------------------------------------------------------------------------

  /**
   * 스포너 1기를 창 앞 사출 조건에서 N틱 돌리고, **이번 틱에 새로 태어난 드론**만 모은다.
   * 스크롤 창을 매 틱 전진시켜 실제 L2 와 같은 좌표계를 만든다.
   */
  function launchTrace(
    templateId: number,
    socketIndex: number,
    ticks: number,
    withWalls: boolean,
  ): { tick: number; x: number; y: number; hp: number; damage: number }[] {
    const template = mapTemplateFor(templateId);
    const socket = template.sockets[socketIndex]!;
    const state = createWorld(7);
    if (withWalls) {
      for (const w of template.walls) spawnWall(state, w.x, w.y, w.halfW, w.halfH);
      rebuildWalls(state);
    }
    spawnFacility(state, socket, socketIndex, ref(5), MAINTENANCE_FULL);
    const ctx = ctxOf(layersWith(templateId, []));
    const out: { tick: number; x: number; y: number; hp: number; damage: number }[] = [];
    let seen = state.entities.length;
    for (let t = 0; t < ticks; t++) {
      state.tick = t;
      // 창을 소켓 근처에 두어 활성 사거리 안에 머물게 한다(사거리 게이트는 아래에서 따로 잰다).
      ctx.runtime.scrollX = socket.x;
      movePlayer(state, socket.x, 0);
      stepFacility(state, ctx);
      for (let i = seen; i < state.entities.length; i++) {
        const e = state.entities[i]!;
        if (e.kind === 'enemy') out.push({ tick: t, x: e.x, y: e.y, hp: e.hp, damage: e.damage });
      }
      seen = state.entities.length;
      // 상한에 걸리지 않게 이번 틱 산출물을 회수한다(사출 좌표만 보는 계측이다).
      for (const e of state.entities) if (e.kind === 'enemy') e.dead = true;
    }
    return out;
  }

  it('사출 좌표가 스크롤 창 진행 방향 **밖**이다(예고 없는 눈앞 스폰이 기하로 불가능)', () => {
    const trace = launchTrace(MAP_TEMPLATE_STRAIGHT, 0, 900, false);
    expect(trace.length).toBeGreaterThan(3);
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    for (const p of trace) {
      // 창 중심(= 소켓 x)에서 창 반폭보다 더 앞이어야 화면 밖에서 태어난다.
      expect(p.x - template.sockets[0]!.x).toBeGreaterThan(INVASION_WINDOW_HALF_W);
      // 레인은 회랑 안이다(드론 반경 36 을 더해도 벽 안쪽 면 540 을 넘지 않는다).
      expect(Math.abs(p.y)).toBeLessThanOrEqual(540 - 36);
    }
  });

  it('사출 좌표가 벽·프레스에 겹치지 않는다(전 템플릿)', () => {
    for (const templateId of [MAP_TEMPLATE_STRAIGHT, MAP_TEMPLATE_CURVED, MAP_TEMPLATE_CHOKE]) {
      const template = mapTemplateFor(templateId);
      const trace = launchTrace(templateId, 0, 900, true);
      expect(trace.length).toBeGreaterThan(0);
      for (const p of trace) {
        for (const w of template.walls) {
          const wall = { x: w.x, y: w.y, radius: w.halfW, targetX: w.halfH } as unknown as Entity;
          expect(circleOverlapsWall(p.x, p.y, 36, wall)).toBe(false);
        }
      }
    }
  });

  it('활성 사거리 밖이면 사출하지 않는다', () => {
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const socket = template.sockets[0]!;
    const spec = facilitySpecFor(5)!;
    expect(spec.range).toBeGreaterThan(0);
    const state = createWorld(11);
    spawnFacility(state, socket, 0, ref(5), MAINTENANCE_FULL);
    const ctx = ctxOf(layersWith(MAP_TEMPLATE_STRAIGHT, []));
    for (let t = 0; t < spec.spawnIntervalTicks * 6; t++) {
      state.tick = t;
      ctx.runtime.scrollX = socket.x + spec.range * 2;
      movePlayer(state, socket.x + spec.range * 2, 0);
      stepFacility(state, ctx);
    }
    expect(countKind(state, 'enemy')).toBe(0);
  });

  it('강화 3축이 **생산물**(드론 내구도·접촉 피해)에 실린다', () => {
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const socket = template.sockets[0]!;
    const first = (r: FacilityRef): { hp: number; damage: number } => {
      const state = createWorld(13);
      spawnFacility(state, socket, 0, r, MAINTENANCE_FULL);
      const ctx = ctxOf(layersWith(MAP_TEMPLATE_STRAIGHT, []));
      for (let t = 0; t < 600; t++) {
        state.tick = t;
        ctx.runtime.scrollX = socket.x;
        movePlayer(state, socket.x, 0);
        stepFacility(state, ctx);
        const drone = state.entities.find((e) => e.kind === 'enemy');
        if (drone !== undefined) return { hp: drone.hp, damage: drone.damage };
      }
      throw new Error('드론이 사출되지 않았다');
    };
    const lv1 = first(ref(5));
    const lv30 = first(ref(5, 30));
    const lv30r3 = first(ref(5, 30, 3));
    const lv30r3a3 = first(ref(5, 30, 3, 3));
    // 레벨 → 등급 → 승급 순으로 **셋 다** 단조 증가여야 한다.
    expect(lv30.hp).toBeGreaterThan(lv1.hp);
    expect(lv30.damage).toBeGreaterThan(lv1.damage);
    expect(lv30r3.hp).toBeGreaterThan(lv30.hp);
    expect(lv30r3a3.hp).toBeGreaterThan(lv30r3.hp);
    // 카탈로그 기본 내구도(`spawnDroneHp`)가 로스터 값을 이긴다.
    expect(lv1.hp).toBe(facilitySpecFor(5)!.spawnDroneHp);
    // 접촉 피해는 참조 플레이어 최대 HP(160) 아래로 못박혀 있다 — 넘으면 "L2 누적 피해"
    // 지표가 설비가 아니라 HP 풀을 재기 시작한다(난이도 복원 레인 §3.2).
    const lv99 = first(ref(5, 99, 3, 3));
    expect(lv99.damage).toBeLessThan(160);
  });
});

// ---------------------------------------------------------------------------
// 레이어 진입 스폰
// ---------------------------------------------------------------------------

describe('enterFacilityLayer', () => {
  it('템플릿 벽과 배치된 설비만 스폰한다(빈 소켓은 아무것도 안 만든다)', () => {
    const state = createWorld(1);
    const layers = layersWith(MAP_TEMPLATE_CHOKE, [ref(0), null, ref(3), null, ref(5)]);
    enterFacilityLayer(state, ctxOf(layers));
    const template = mapTemplateFor(MAP_TEMPLATE_CHOKE);
    expect(countKind(state, 'wall')).toBe(template.walls.length);
    const facilities = state.entities.filter(isFacility);
    expect(facilities.length).toBe(3);
    expect(facilities.map(facilityCatalogId)).toEqual([0, 3, 5]);
    // 소켓 좌표 그대로 앉는다.
    expect(facilities[0]!.x).toBe(template.sockets[0]!.x);
    expect(facilities[0]!.y).toBe(template.sockets[0]!.y);
    // 거동별 kind 분화 + 구 defenseTurret 경로와 완전 분리.
    expect(facilities.map((f) => f.kind)).toEqual([
      FACILITY_GUN_KIND,
      FACILITY_HAZARD_KIND,
      FACILITY_SPAWNER_KIND,
    ]);
    expect(countKind(state, 'defenseTurret')).toBe(0);
    // 스포너는 파괴 전까지 무제한 생산(aux0 = -1), 카운트다운은 aux1.
    const spawner = facilities[2]!;
    expect(spawner.aux0).toBe(SPAWN_BUDGET_UNLIMITED);
    expect(spawner.aux1).toBeGreaterThan(0);
  });

  it('두 번 돌려도 배치 결과가 바이트 동일하다(결정론)', () => {
    const snap = (): string => {
      const state = createWorld(2);
      const layers = layersWith(MAP_TEMPLATE_CURVED, [ref(1), ref(2), null, ref(4)]);
      enterFacilityLayer(state, ctxOf(layers));
      return JSON.stringify(state.entities.map((e) => [e.kind, e.x, e.y, e.enemyType, e.hp]));
    };
    expect(snap()).toBe(snap());
  });

  it('벽에 시야가 막히면 쏘지 않는다(LOS 게이트)', () => {
    const state = createWorld(4);
    const template = mapTemplateFor(MAP_TEMPLATE_STRAIGHT);
    const socket = template.sockets[0]!;
    const f = spawnFacility(state, socket, 0, ref(0), MAINTENANCE_FULL)!;
    f.timer = 0;
    // 소켓과 플레이어 사이에 벽을 세운다.
    spawnWall(state, socket.x, socket.y + 150, 200, 60);
    rebuildWalls(state);
    movePlayer(state, socket.x, socket.y + 400);
    stepFacility(state, ctxOf(layersWith(MAP_TEMPLATE_STRAIGHT, [])));
    expect(countKind(state, 'enemyBullet')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ④ 벽 broad-phase
// ---------------------------------------------------------------------------

describe('InvasionWallIndex', () => {
  /** 회랑풍 긴 벽 + 격자 블록 80개를 만든다. */
  function buildWalls(): Entity[] {
    const walls: Entity[] = [];
    const sink = { entities: walls as Entity[], nextEntityId: 1 };
    // 상·하 긴 벽(격자 셀 수십 칸에 걸친다 — 중심 셀 1칸 등록으로는 누락되는 케이스).
    spawnWall(sink, 6000, -660, 6000, 120);
    spawnWall(sink, 6000, 660, 6000, 120);
    // 78개 블록.
    for (let i = 0; i < 78; i++) {
      spawnWall(sink, 200 + i * 150, ((i % 7) - 3) * 140, 60, 60);
    }
    return walls;
  }

  it('활성 벽 80개에서 직접 스윕과 결과가 항상 동일하다', () => {
    const walls = buildWalls();
    expect(walls.length).toBe(80);
    const index = new InvasionWallIndex();
    index.rebuild(walls);
    for (let px = -400; px <= 12400; px += 137) {
      for (let py = -900; py <= 900; py += 91) {
        for (const r of [0, 8, 60]) {
          const direct = sweepWallsDirect(walls, px, py, r);
          const fast = index.firstBlocking(px, py, r);
          expect(fast).toBe(direct);
        }
      }
    }
  });

  it('긴 벽이 중심에서 먼 셀에서도 검출된다(다중 셀 등록)', () => {
    const walls = buildWalls();
    const index = new InvasionWallIndex();
    index.rebuild(walls);
    // 위 긴 벽의 왼쪽 끝(중심 x=6000 에서 5900 떨어진 지점).
    expect(index.blocked(120, -660, 4)).toBe(true);
    expect(index.blocked(11880, -660, 4)).toBe(true);
  });

  it('정확 판정 횟수가 직접 스윕보다 크게 줄어든다', () => {
    const walls = buildWalls();
    const index = new InvasionWallIndex();
    index.rebuild(walls);
    index.resetProbeCount();
    let probes = 0;
    for (let px = 0; px <= 12000; px += 60) {
      for (let py = -800; py <= 800; py += 80) {
        index.firstBlocking(px, py, 8);
        probes += walls.length; // 직접 스윕의 최악 판정 횟수
      }
    }
    expect(index.probeCount).toBeLessThan(probes / 5);
  });

  it('빈 벽 목록에서는 항상 null 이다', () => {
    const index = new InvasionWallIndex();
    index.rebuild([]);
    expect(index.firstBlocking(0, 0, 10)).toBeNull();
    expect(index.blocked(0, 0, 10)).toBe(false);
    expect(index.size).toBe(0);
  });

  it('겹치는 벽이 여럿이면 배열 인덱스가 가장 작은 것을 돌려준다(first-hit 동치)', () => {
    const walls: Entity[] = [];
    const sink = { entities: walls, nextEntityId: 1 };
    spawnWall(sink, 0, 0, 100, 100);
    spawnWall(sink, 50, 0, 100, 100);
    spawnWall(sink, 100, 0, 100, 100);
    const index = new InvasionWallIndex(64);
    index.rebuild(walls);
    expect(index.firstBlocking(60, 0, 4)).toBe(walls[0]);
    expect(index.firstBlocking(90, 0, 4)).toBe(walls[0]); // 세 벽 모두 겹침 → 최소 인덱스
    expect(index.firstBlocking(120, 0, 4)).toBe(walls[1]); // 2·3번 벽만 겹침
    expect(index.firstBlocking(180, 0, 4)).toBe(walls[2]); // 세 번째 벽만 겹침
    // 참조 구현과 동일.
    for (let x = -200; x <= 300; x += 7) {
      expect(index.firstBlocking(x, 0, 3)).toBe(sweepWallsDirect(walls, x, 0, 3));
    }
  });

  it('circleOverlapsWall 필드 매핑(radius=halfW, targetX=halfH)을 그대로 쓴다', () => {
    const walls: Entity[] = [];
    const sink = { entities: walls, nextEntityId: 1 };
    const w = spawnWall(sink, 0, 0, 300, 40);
    expect(w.radius).toBe(300);
    expect(w.targetX).toBe(40);
    expect(circleOverlapsWall(280, 0, 5, w)).toBe(true);
    expect(circleOverlapsWall(0, 60, 5, w)).toBe(false);
  });
});
