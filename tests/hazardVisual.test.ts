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
import { BOUNDARY_MIN_RATIO } from '../src/render/entity/hazardShape.js';
import {
  BOUNDARY_ALPHA_SCALE,
  DECOR_MIN_RADIUS,
  FILL_RINGS,
  FILL_SOFT_SPAN,
  GLOW_ALPHA_SCALE,
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
  op: 'circle' | 'arc' | 'moveTo' | 'lineTo' | 'poly' | 'fill' | 'stroke';
  args: readonly number[];
  style?: { color: number; width?: number; alpha: number };
  /** `poly` 전용 — 경로를 닫았는가. Pixi 는 생략 시 열어 두고, 열린 경로는 stroke 에서 벌어진다. */
  close?: boolean | undefined;
}

/** 폴리곤 꼭짓점들의 중심(x,y)까지의 거리 — 실루엣이 판정 반경을 넘는지 재는 도구. */
function polyRadii(args: readonly number[], cx: number, cy: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < args.length; i += 2) {
    out.push(Math.hypot((args[i] ?? 0) - cx, (args[i + 1] ?? 0) - cy));
  }
  return out;
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
    poly(points, close) {
      calls.push({ op: 'poly', args: [...points], close });
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
    // 실루엣은 폴리곤(채움 겹 + 경계선 + 글로우), 정밀 채널인 안쪽 립만 원이다.
    expect(calls.filter((c) => c.op === 'poly').length).toBeGreaterThan(FILL_RINGS);
    expect(calls.filter((c) => c.op === 'circle').length).toBe(1);
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

  it('바깥 겹이 판정 반경에 닿되 넘지 않는다(작아 보이지도, 거짓말하지도 않는다)', () => {
    const rec = recorder();
    drawHazardZone(rec.canvas, 0, 0, 200, hazardVisual(HAZARD_LAVA, true), 0);
    const polys = rec.calls.filter((c) => c.op === 'poly');
    const outer = polyRadii(polys[0]?.args ?? [], 0, 0);
    expect(Math.max(...outer)).toBeLessThanOrEqual(200);
    // 채움은 경계선보다 크게 출렁여도 된다(정의하는 선이 아니다) — 다만 장판이 통째로
    // 작아 보이면 안 되므로 최댓값은 반경 근처까지 올라와야 한다. 반경에 **붙어 있어야**
    // 하는 것은 경계선 쪽 계약이다(아래 '실루엣' describe).
    expect(Math.max(...outer)).toBeGreaterThan(200 * 0.9);
    // 안쪽 겹은 소프트 밴드 안에서만 줄어든다(그 이상 줄면 장판이 작아 보인다).
    const inner = polyRadii(polys[FILL_RINGS - 1]?.args ?? [], 0, 0);
    expect(Math.max(...inner) / Math.max(...outer)).toBeCloseTo(1 - FILL_SOFT_SPAN, 6);
  });
});

describe('실루엣 — 완전한 원을 쓰지 않는다 (계약 §2-5 UI 어휘 금지)', () => {
  // 1차 통합 반려 사유: `edgePolygon` 은 옳게 구현됐는데 그 위에 alpha 0.95·width 4 의
  // **정확한 원 stroke** 가 그대로 남아 있어, 가산 alpha ≤0.34 폴리곤이 이길 수 없었다.
  // 화면에 남은 것은 여전히 완전한 원이었다.

  it('활성 장판의 채움·경계·글로우가 전부 폴리곤이다', () => {
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, 150, hazardVisual(HAZARD_LAVA, true), 0);
    // 원은 안쪽 맥동 립 하나뿐이다(정보 채널이라 §2-5 예외 — 계약이 명시적으로 허용).
    const circles = calls.filter((c) => c.op === 'circle');
    expect(circles.length).toBe(1);
    expect(circles[0]?.args[2]).toBeLessThan(150); // 립은 반경 안쪽이다
  });

  it('경계선이 실제로 불규칙하다(폴리곤이지만 사실은 원이면 무의미)', () => {
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, 200, hazardVisual(HAZARD_LAVA, true), 0);
    const polys = calls.filter((c) => c.op === 'poly');
    const outer = polyRadii(polys[0]?.args ?? [], 0, 0);
    expect(Math.max(...outer) - Math.min(...outer)).toBeGreaterThan(200 * 0.02);
  });

  it('경계선이 안전지대를 과장하지 않는다(안쪽 파임에 상한이 있다)', () => {
    // 위험을 넓게 그리면 플레이어가 손해를 보지만 **좁게 그리면 죽는다.** 그래서 경계선의
    // 안쪽 파임은 채움보다 훨씬 좁은 대역으로 묶여 있어야 한다.
    for (const r of [60, 120, 300]) {
      const { canvas, calls } = recorder();
      drawHazardZone(canvas, 0, 0, r, hazardVisual(HAZARD_LAVA, true), 0);
      // 채움 겹 FILL_RINGS 개 다음이 경계선 폴리곤이다.
      const boundary = polyRadii(calls.filter((c) => c.op === 'poly')[FILL_RINGS]?.args ?? [], 0, 0);
      expect(Math.max(...boundary), `r=${r}`).toBeLessThanOrEqual(r);
      expect(Math.min(...boundary), `r=${r}`).toBeGreaterThanOrEqual(r * BOUNDARY_MIN_RATIO - 1e-9);
    }
  });

  it('장판마다 실루엣이 다르다(같은 도장을 찍지 않는다)', () => {
    const shape = (x: number, y: number): string => {
      const rec = recorder();
      drawHazardZone(rec.canvas, x, y, 120, hazardVisual(HAZARD_CONTAMINATION, true, true), 0);
      const p = rec.calls.filter((c) => c.op === 'poly')[0]?.args ?? [];
      return JSON.stringify(polyRadii(p, x, y).map((d) => d.toFixed(2)));
    };
    expect(shape(0, 0)).not.toBe(shape(400, 0));
    expect(shape(0, 0)).not.toBe(shape(0, 400));
  });

  it('같은 자리의 장판은 프레임이 지나도 같은 실루엣 계열이다(떨지 않는다)', () => {
    // 위치 기반 시드라 미세한 좌표 흔들림이 실루엣을 바꾸면 안 된다(4px 격자 양자화).
    const shape = (x: number): string => {
      const rec = recorder();
      drawHazardZone(rec.canvas, x, 0, 120, hazardVisual(HAZARD_LAVA, true), 0);
      const p = rec.calls.filter((c) => c.op === 'poly')[0]?.args ?? [];
      return JSON.stringify(polyRadii(p, x, 0).map((d) => d.toFixed(4)));
    };
    expect(shape(100)).toBe(shape(100.9));
  });

  it('안쪽 맥동 립은 장식 예산과 무관하게 항상 그려진다(판정 정보는 안 깎는다)', () => {
    for (const allowDecor of [true, false]) {
      const { canvas, calls } = recorder();
      drawHazardZone(canvas, 0, 0, 300, hazardVisual(HAZARD_LAVA, true), 0, allowDecor);
      expect(calls.filter((c) => c.op === 'circle').length, `decor=${allowDecor}`).toBe(1);
    }
    // 작은 장판도 마찬가지다.
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, DECOR_MIN_RADIUS - 1, hazardVisual(HAZARD_LAVA, true), 0);
    expect(calls.filter((c) => c.op === 'circle').length).toBe(1);
  });

  it('모든 폴리곤이 닫힌 경로다(열린 경로는 stroke 에서 틈이 벌어진다)', () => {
    // Pixi 의 `poly` 는 `polygon.closePath = close` 를 그대로 대입한다 — 생략하면 undefined 라
    // stroke 에서 마지막 꼭짓점과 첫 꼭짓점 사이가 벌어진다. 채움에서는 자동으로 닫혀 안
    // 드러나므로, 경계선에만 생기는 틈을 육안으로 잡기 어렵다.
    for (const active of [false, true]) {
      for (const sub of [HAZARD_LAVA, HAZARD_CONTAMINATION, HAZARD_SLOW]) {
        const { canvas, calls } = recorder();
        drawHazardZone(canvas, 0, 0, 150, hazardVisual(sub, active, true), 7);
        for (const c of calls.filter((k) => k.op === 'poly')) {
          expect(c.close, `sub=${sub} active=${active}`).toBe(true);
        }
      }
    }
  });

  it('밝기 총량 순감 — 경계선·글로우 알파가 이전보다 낮다 (계약 §2-4)', () => {
    const v = hazardVisual(HAZARD_LAVA, true);
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, 150, v, 0);
    const strokes = calls.filter((c) => c.op === 'stroke');
    // 경계선 stroke 는 원래 strokeAlpha(0.95) 그대로였다. 지금은 배율이 곱해져 있어야 한다.
    const boundary = strokes.find((s) => s.style?.width === v.strokeWidth);
    expect(boundary?.style?.alpha).toBeLessThan(v.strokeAlpha);
    expect(BOUNDARY_ALPHA_SCALE).toBeLessThan(1);
    expect(GLOW_ALPHA_SCALE).toBeLessThan(1);
  });
});

describe('성능 가드 — 작고 많은 장판', () => {
  it('작은 장판은 장식(빗금·립·글로우)을 생략한다', () => {
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, DECOR_MIN_RADIUS - 1, hazardVisual(HAZARD_CONTAMINATION, true), 0);
    expect(calls.filter((c) => c.op === 'lineTo').length).toBe(0);
    // 채움 겹 + 경계선(폴리곤) + 립(원 1개)만 남는다 — 작아도 장판이 보이기는 해야 한다.
    // 글로우 링은 장식이라 빠진다.
    expect(calls.filter((c) => c.op === 'poly').length).toBe(FILL_RINGS + 1);
    expect(calls.filter((c) => c.op === 'circle').length).toBe(1);
    expect(calls.some((c) => c.op === 'fill')).toBe(true);
  });

  it('allowDecor=false 면 큰 장판도 채움+경계+립만 그린다(프레임 예산 소진)', () => {
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, 300, hazardVisual(HAZARD_LAVA, true), 0, false);
    expect(calls.filter((c) => c.op === 'lineTo').length).toBe(0);
    expect(calls.filter((c) => c.op === 'poly').length).toBe(FILL_RINGS + 1);
    expect(calls.filter((c) => c.op === 'circle').length).toBe(1);
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
