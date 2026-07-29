/**
 * 해저드 장판 시각 규칙 — 순수 단위 + **배선** (사용자 피드백 2026-07-26).
 *
 * 이 레인이 고친 결함은 "색 하나에 전부 실려 무엇인지 안 읽힌다"였고, 그 밑에 **피해 지형이
 * 아군 색으로 칠해지는** 실제 오분류가 깔려 있었다(`HAZARD_SLOW`(2) === `HAZARD_TERRAIN`(2)).
 * 그래서 여기서는 색·형태 규칙을 못 박고, 실제 {@link EntityRenderer} 가 정규 render 경로에서
 * 그 규칙대로 그리는지까지 확인한다 — 그리기 호출을 기록하는 스텁 캔버스로 GL 없이 본다.
 */

import { describe, it, expect } from 'vitest';
import { Texture } from 'pixi.js';

import { EntityRenderer } from '../src/render/entityRenderer.js';
import type { PlaceholderTextures } from '../src/render/textures.js';
import type { EntitySnapshot, WorldSnapshot } from '../src/sim/snapshot.js';
import { snapshotWorld } from '../src/sim/snapshot.js';
import { createWorld } from '../src/sim/world.js';
import { spawnHazard } from '../src/sim/entities.js';
import {
  DECOR_MIN_RADIUS,
  FILL_RINGS,
  FILL_SOFT_SPAN,
  HAZARD_COLOR_SLOW,
  HAZARD_COLOR_TERRAIN,
  drawHazardZone,
  hazardVisual,
  type HazardCanvas,
} from '../src/render/hazardVisual.js';
import { HAZARD_LAVA, HAZARD_MORTAR, HAZARD_SLOW } from '../src/sim/patterns/types.js';
import { HAZARD_CONTAMINATION } from '../src/sim/modes/contamination.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';

/** 이 게임의 아군 색 — 플레이어 기체·아군 탄·안전 반경 링이 공유한다. 위험 장판은 절대 쓰면 안 된다. */
const FRIENDLY_CYAN = 0x39d0ff;

// ---------------------------------------------------------------------------
// 그리기 호출을 기록하는 스텁 캔버스(GL 없이 "무엇을 그렸는가"를 본다)
// ---------------------------------------------------------------------------

interface Call {
  op: 'circle' | 'arc' | 'moveTo' | 'lineTo' | 'fill' | 'stroke';
  args: readonly number[];
  style?: { color: number; width?: number; alpha: number };
}

function recorder(): { canvas: HazardCanvas; calls: Call[] } {
  const calls: Call[] = [];
  const canvas: HazardCanvas = {
    circle(x, y, r) {
      calls.push({ op: 'circle', args: [x, y, r] });
      return canvas;
    },
    arc(x, y, r, a0, a1) {
      calls.push({ op: 'arc', args: [x, y, r, a0, a1] });
      return canvas;
    },
    moveTo(x, y) {
      calls.push({ op: 'moveTo', args: [x, y] });
      return canvas;
    },
    lineTo(x, y) {
      calls.push({ op: 'lineTo', args: [x, y] });
      return canvas;
    },
    fill(style) {
      calls.push({ op: 'fill', args: [], style });
      return canvas;
    },
    stroke(style) {
      calls.push({ op: 'stroke', args: [], style });
      return canvas;
    },
  };
  return { canvas, calls };
}

describe('색 = 성질', () => {
  it('피해 지형(영구)은 아군 시안이 아니다 — 이 레인이 고친 실제 오분류', () => {
    const terrain = hazardVisual(HAZARD_SLOW, true, true);
    expect(terrain.color).not.toBe(FRIENDLY_CYAN);
    expect(terrain.color).toBe(HAZARD_COLOR_TERRAIN);
    expect(terrain.harmful).toBe(true);
  });

  it('어떤 subtype 도 아군 시안으로 칠하지 않는다(시안은 아군 전용으로 회수)', () => {
    for (const sub of [HAZARD_MORTAR, HAZARD_LAVA, HAZARD_SLOW, HAZARD_CONTAMINATION, 9999]) {
      for (const permanent of [false, true]) {
        for (const active of [false, true]) {
          expect(hazardVisual(sub, active, permanent).color, `sub=${sub}`).not.toBe(FRIENDLY_CYAN);
        }
      }
    }
  });

  it('같은 코드(2)라도 영구 지형과 감속 지대는 다른 색·다른 성질이다', () => {
    const terrain = hazardVisual(HAZARD_SLOW, true, true);
    const slow = hazardVisual(HAZARD_SLOW, true, false);
    expect(slow.color).toBe(HAZARD_COLOR_SLOW);
    expect(terrain.color).not.toBe(slow.color);
    expect(terrain.harmful).toBe(true);
    expect(slow.harmful).toBe(false); // 감속은 아프지 않다 — 위험군에서 분리
  });

  it('피해 장판만 빗금·굵은 테두리를 갖는다', () => {
    const lava = hazardVisual(HAZARD_LAVA, true);
    const slow = hazardVisual(HAZARD_SLOW, true);
    expect(lava.hatch).toBe(true);
    expect(slow.hatch).toBe(false);
    expect(lava.strokeWidth).toBeGreaterThan(slow.strokeWidth);
  });
});

describe('형태 = 상태', () => {
  it('예열은 점선·채움 없음, 활성은 실선·채움', () => {
    const warm = hazardVisual(HAZARD_LAVA, false);
    const hot = hazardVisual(HAZARD_LAVA, true);
    expect(warm.dashed).toBe(true);
    expect(warm.fillAlpha).toBe(0);
    expect(hot.dashed).toBe(false);
    expect(hot.fillAlpha).toBeGreaterThan(0);
  });

  it('예열은 점선 세그먼트를 여러 조각으로 그린다(한 원이 아니다)', () => {
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, 100, hazardVisual(HAZARD_LAVA, false), 0);
    expect(calls.filter((c) => c.op === 'arc').length).toBeGreaterThan(8);
    expect(calls.some((c) => c.op === 'fill')).toBe(false); // 예열은 채우지 않는다
  });

  it('활성 위험은 채움 + 빗금 선 + 테두리를 모두 그린다', () => {
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, 100, hazardVisual(HAZARD_LAVA, true), 0);
    expect(calls.some((c) => c.op === 'fill')).toBe(true);
    expect(calls.filter((c) => c.op === 'lineTo').length).toBeGreaterThan(0); // 빗금
    expect(calls.filter((c) => c.op === 'circle').length).toBeGreaterThan(1); // 본체 + 립/글로우
  });

  it('빗금은 시간이 지나면 흐른다(같은 장판이 다른 그림이 된다)', () => {
    const a = recorder();
    const b = recorder();
    const v = hazardVisual(HAZARD_LAVA, true);
    drawHazardZone(a.canvas, 0, 0, 100, v, 0);
    drawHazardZone(b.canvas, 0, 0, 100, v, 30);
    const line = (r: { calls: Call[] }) =>
      JSON.stringify(r.calls.filter((c) => c.op === 'moveTo' || c.op === 'lineTo').map((c) => c.args));
    expect(line(a)).not.toBe(line(b));
  });

  it('같은 프레임이면 같은 그림이다(순수 그리기 — 내부 상태 없음)', () => {
    const a = recorder();
    const b = recorder();
    const v = hazardVisual(HAZARD_MORTAR, true);
    drawHazardZone(a.canvas, 10, 20, 90, v, 42);
    drawHazardZone(b.canvas, 10, 20, 90, v, 42);
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
  });
});

describe('겹침 처리 — 셀이 여럿 깔려도 하드 엣지가 쌓이지 않는다', () => {
  // 2026-07-30 기준선 캡처의 톡사르 컷: 오염 셀이 겹친 자리에서 알파가 그대로 누적돼 경계선이
  // 이중으로 그어지고 "포토샵 선택 영역"으로 읽혔다. 이 계약이 그 결함의 재발을 막는다.
  const fillsOf = (r: number, v = hazardVisual(HAZARD_CONTAMINATION, true, true)): Call[] => {
    const rec = recorder();
    drawHazardZone(rec.canvas, 0, 0, r, v, 0);
    return rec.calls.filter((c) => c.op === 'fill');
  };

  it('채움이 한 겹이 아니라 여러 겹이다(가장자리가 계단식으로 옅어진다)', () => {
    // `FILL_RINGS` 를 기준으로만 재면 상수를 1 로 되돌려도 통과한다(항진) — 그래서 "1 보다
    // 많다"를 먼저 못 박는다. 이 레인의 뮤테이션 검증에서 실제로 드러난 함정이다.
    expect(fillsOf(120).length).toBeGreaterThan(1);
    expect(fillsOf(120).length).toBe(FILL_RINGS);
  });

  it('두 셀의 가장자리가 겹쳐도 한 셀 내부보다 진해지지 않는다', () => {
    const v = hazardVisual(HAZARD_CONTAMINATION, true, true);
    const fills = fillsOf(120, v);
    const per = fills[0]?.style?.alpha ?? 0;
    // 가장자리 밴드는 겹이 하나뿐이므로 알파가 `per` 다. 두 셀이 겹쳐도 2*per 이고,
    // 그 값이 한 셀 내부 누적(= fillAlpha)을 넘으면 이음매가 밝은 띠로 드러난다.
    expect(per).toBeGreaterThan(0);
    expect(2 * per).toBeLessThan(v.fillAlpha);
  });

  it('겹 알파의 누적이 원래 채움 알파에 수렴한다(장판이 옅어지지 않았다)', () => {
    const v = hazardVisual(HAZARD_LAVA, true);
    let acc = 0;
    for (const f of fillsOf(120, v)) acc = acc + (f.style?.alpha ?? 0) * (1 - acc);
    expect(acc).toBeCloseTo(v.fillAlpha, 10);
  });

  it('바깥 겹이 정확히 판정 반경까지 닿는다(장판이 실제보다 작아 보이지 않는다)', () => {
    const rec = recorder();
    drawHazardZone(rec.canvas, 0, 0, 200, hazardVisual(HAZARD_LAVA, true), 0);
    const radii = rec.calls.filter((c) => c.op === 'circle').map((c) => c.args[2] ?? 0);
    expect(Math.max(...radii.slice(0, FILL_RINGS))).toBe(200);
    // 안쪽 겹은 소프트 밴드 안에서만 줄어든다(그 이상 줄면 장판이 작아 보인다).
    expect(Math.min(...radii.slice(0, FILL_RINGS))).toBeCloseTo(200 * (1 - FILL_SOFT_SPAN), 10);
  });
});

describe('성능 가드 — 작고 많은 장판', () => {
  it('작은 장판은 장식(빗금·립·글로우)을 생략한다', () => {
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, DECOR_MIN_RADIUS - 1, hazardVisual(HAZARD_CONTAMINATION, true), 0);
    expect(calls.filter((c) => c.op === 'lineTo').length).toBe(0);
    // 채움 겹 + 테두리(원 1개)만 남는다 — 작아도 장판이 보이기는 해야 한다.
    expect(calls.filter((c) => c.op === 'circle').length).toBe(FILL_RINGS + 1);
    expect(calls.some((c) => c.op === 'fill')).toBe(true);
  });

  it('allowDecor=false 면 큰 장판도 채움+테두리만 그린다(프레임 예산 소진)', () => {
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, 300, hazardVisual(HAZARD_LAVA, true), 0, false);
    expect(calls.filter((c) => c.op === 'lineTo').length).toBe(0);
    expect(calls.filter((c) => c.op === 'circle').length).toBe(FILL_RINGS + 1); // 채움 겹 + 테두리
  });

  it('반경이 커져도 빗금 선 개수에 상한이 있다', () => {
    const count = (r: number): number => {
      const rec = recorder();
      drawHazardZone(rec.canvas, 0, 0, r, hazardVisual(HAZARD_LAVA, true), 0);
      return rec.calls.filter((c) => c.op === 'lineTo').length;
    };
    expect(count(2000)).toBeLessThanOrEqual(16);
  });
});

// ---------------------------------------------------------------------------
// 배선 — sim 이 영구 지형 표식을 실어 오고, 렌더가 그것으로 색을 가르는가
// ---------------------------------------------------------------------------

function tex(label: string): Texture {
  return new Texture({ source: Texture.EMPTY.source, label });
}

function realTextures(): PlaceholderTextures {
  const arr = (name: string, n: number): Texture[] =>
    Array.from({ length: n }, (_, i) => tex(`${name}[${i}]`));
  return {
    player: tex('player'),
    shipByType: SHIP_TYPES.map((d) => tex(`ship[${d.id}]`)),
    bullet: tex('bullet'),
    enemyBullet: tex('enemyBullet'),
    enemyBulletBehaviors: arr('enemyBulletBehaviors', 4),
    gem: tex('gem'),
    enemy: arr('enemy', 22),
    boss: arr('boss', 4),
    supply: tex('supply'),
    parachute: null,
    loot: tex('loot'),
    explosion: tex('explosion'),
    background: arr('background', 4),
    wall: tex('wall'),
    destructible: tex('destructible'),
    magnetEmitter: tex('magnetEmitter'),
    bombDevice: tex('bombDevice'),
    turretPickup: tex('turretPickup'),
    shelter: tex('shelter'),
    encounterPortal: tex('encounterPortal'),
    encounterSeal: tex('encounterSeal'),
    encounterAltar: tex('encounterAltar'),
    core: tex('core'),
    guardian: arr('guardian', 2),
    invasionBackdrop: arr('invasionBackdrop', 3),
    facility: arr('facility', FACILITY_CATALOG_COUNT),
    prop: arr('prop', PROP_ROLE_COUNT),
    defenseBoss: arr('defenseBoss', DEFENSE_BOSS_COUNT),
    formation: tex('formation'),
    formationDrone: tex('formationDrone'),
    spawnedDrone: tex('spawnedDrone'),
  };
}

function hazardSnap(over: Partial<EntitySnapshot>): WorldSnapshot {
  const e: EntitySnapshot = {
    id: 1,
    kind: 'hazard',
    x: 0,
    y: 0,
    angle: 0,
    radius: 120,
    aabbH: 0,
    enemyType: HAZARD_SLOW,
    hp: 1,
    maxHp: 1,
    active: true,
    flash: false,
    elite: -1,
    ...over,
  };
  return {
    tick: 0,
    arenaWidth: 1000,
    arenaHeight: 1000,
    cameraX: 0,
    cameraY: 0,
    planet: 0,
    visionRadius: 0,
    safeRadius: 0,
    entities: [e],
    beams: [],
  };
}

describe('배선 — 스냅샷이 영구 지형을 실어 오고 렌더가 갈라 그린다', () => {
  it('sim 스냅샷이 영구 해저드에 permanent=true 를 싣는다', () => {
    const w = createWorld(1);
    // 영구 지형(life < 0) — 청크 배치 피해 지형과 같은 형태로 직접 만든다.
    const h = spawnHazard(w, HAZARD_SLOW, 100, 100, 120, 0, -1, 10, false, 0);
    const snap = snapshotWorld(w);
    const shot = snap.entities.find((e) => e.id === h.id);
    expect(shot?.permanent).toBe(true);
    expect(hazardVisual(shot!.enemyType, shot!.active, shot!.permanent === true).harmful).toBe(true);
  });

  it('일시 장판(감속 지대)은 permanent=false 라 방해군으로 그려진다', () => {
    const w = createWorld(1);
    const h = spawnHazard(w, HAZARD_SLOW, 100, 100, 120, 0, 300, 5, false, 0);
    const snap = snapshotWorld(w);
    const shot = snap.entities.find((e) => e.id === h.id);
    expect(shot?.permanent).toBe(false);
    expect(hazardVisual(shot!.enemyType, shot!.active, shot!.permanent === true).harmful).toBe(false);
  });

  it('렌더가 네 조합(영구×활성)을 정규 경로에서 예외 없이 그린다', () => {
    // 색·형태 계약은 위 순수 단위가 소유한다. 여기서는 렌더가 그 함수를 실제로 **부르고**
    // Graphics 호출까지 도달하는지(배선)만 본다 — GL 없이 색을 되읽을 수단이 없기 때문이다.
    const r = new EntityRenderer(realTextures());
    for (const permanent of [false, true]) {
      for (const active of [false, true]) {
        const w = hazardSnap({ permanent, active });
        expect(() => r.render(w, w, 0)).not.toThrow();
      }
    }
    r.destroy();
  });
});
