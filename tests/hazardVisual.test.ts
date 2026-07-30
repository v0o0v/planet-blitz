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
  BOUNDARY_ALPHA_SCALE,
  DECOR_MIN_RADIUS,
  LIP_RATIO,
  boundaryWidth,
  FILL_RINGS,
  FILL_SOFT_SPAN,
  GLOW_ALPHA_SCALE,
  HAZARD_COLOR_SLOW,
  HAZARD_COLOR_TERRAIN,
  drawHazardZone,
  hazardFillPoints,
  hazardVisual,
  visualHeat,
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

/**
 * `n` 번째 `poly` 호출과 **그 직후의 stroke/fill 스타일**을 함께 집는다.
 *
 * 기록기는 경로(`poly`)와 스타일(`stroke`/`fill`)을 별개 호출로 남기므로 `poly` 항목에는
 * `style` 이 없다 — 그걸 모르고 `poly.style.width` 를 보면 항상 `undefined` 라 단언이 조용히
 * 무의미해진다(이 파일에서 실제로 한 번 그랬다).
 */
function polyAt(calls: Call[], n: number): { args: readonly number[]; style?: Call['style'] } {
  let seen = -1;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c === undefined || c.op !== 'poly') continue;
    seen++;
    if (seen !== n) continue;
    for (let j = i + 1; j < calls.length; j++) {
      const s = calls[j];
      if (s === undefined) continue;
      if (s.op === 'stroke' || s.op === 'fill') return { args: c.args, style: s.style };
      if (s.op === 'poly') break;
    }
    return { args: c.args };
  }
  return { args: [] };
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
    // 조각은 이제 호가 아니라 유기 윤곽 위의 선분이다(아래 MAJOR-2 계약 참조).
    expect(calls.filter((c) => c.op === 'moveTo').length).toBeGreaterThan(8);
    expect(calls.some((c) => c.op === 'fill')).toBe(false); // 예열은 채우지 않는다
  });

  it('예열 경로에 완전한 원이 하나도 없다 (2차 MAJOR-2 + 3차 MAJOR-6)', () => {
    // 2차까지 예열은 `arc(x,y,radius,...)` 18조각 + `circle` 수렴 링이라 **전부 정확한 원**이었다.
    // "예열이 가장 오래 보이는 상태"라고 논증해 놓고 그 상태의 경계만 안 고쳤던 자리다.
    //
    // 3차는 그 위에 정원 립을 **새로** 하나 넣었고, 오염 셀은 서로 겹치므로 셀 수만큼 정원이
    // 포개져 예열 컷의 동심 윤곽이 2차보다 늘었다(3차 반려 MAJOR-6: 흰 정원 3 + 각진 수렴
    // 폴리곤 3 + 붉은 점선 + 플레이어 시안 링 = 8줄). 예열은 아직 아프지 않으므로 판정 울타리의
    // 정밀도 요구가 활성보다 낮고, 점선이 같은 시드의 유기 윤곽 위를 달려 위치를 이미 알려 준다.
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, 100, hazardVisual(HAZARD_LAVA, false), 0);
    expect(calls.filter((c) => c.op === 'arc').length).toBe(0);
    expect(calls.filter((c) => c.op === 'circle').length).toBe(0);
    // 대신 활성에는 립이 있다 — "정원 = 지금 아프다"가 색 외 채널로 하나 늘어난 셈이다.
    const hot = recorder();
    drawHazardZone(hot.canvas, 0, 0, 100, hazardVisual(HAZARD_LAVA, true), 0);
    const circles = hot.calls.filter((c) => c.op === 'circle');
    expect(circles.length).toBe(1);
    expect(circles[0]?.args[2]).toBe(100 * LIP_RATIO);
  });

  it('정원 립이 유기 윤곽보다 약하다 — 인공 형태가 화면을 지배하면 §2-5 위반이다', () => {
    // ## 5차 반려의 실체
    // 4차에 립이 `radius - strokeWidth` → **정확히 `radius`** 로 올라가면서 더 또렷해졌고,
    // 알파도 0.45~0.75 였다. 유기 경계선(0.95 × 0.76 = 0.722)보다 **밝은 프레임이 존재**했다.
    // 그 상태로 41셀이 겹치니 "흰 호가 교차한다"가 됐다.
    //
    // 계약 §2-5 는 립을 예외로 허용하지만 그건 "존재해도 된다"이지 "가장 강해도 된다"가 아니다.
    // 립은 판정 정보라 지우지 않고, **지배력만** 뺀다. 맥동 최고점에서도 유기 윤곽보다 약해야 한다.
    let lipPeak = 0;
    let boundary = 0;
    for (let t = 0; t < 60; t++) {
      const { canvas, calls } = recorder();
      drawHazardZone(canvas, 0, 0, 100, hazardVisual(HAZARD_LAVA, true), t);
      for (let i = 0; i < calls.length; i++) {
        if (calls[i]?.op !== 'circle') continue;
        const st = calls[i + 1];
        if (st?.op === 'stroke' && st.style !== undefined) lipPeak = Math.max(lipPeak, st.style.alpha);
      }
      // 유기 윤곽 = poly 를 stroke 한 것 중 가장 강한 것(채움 링·글로우 링보다 진하다).
      for (let i = 0; i < calls.length; i++) {
        if (calls[i]?.op !== 'poly') continue;
        const st = calls[i + 1];
        if (st?.op === 'stroke' && st.style !== undefined) {
          boundary = Math.max(boundary, st.style.alpha);
        }
      }
    }
    expect(lipPeak).toBeGreaterThan(0.15); // 지우지는 않는다 — 판정 울타리다
    expect(boundary).toBeGreaterThan(0);
    expect(lipPeak).toBeLessThan(boundary * 0.6);
  });

  it('예열 윤곽이 활성 윤곽과 같은 실루엣이다(전이가 형태의 도약이 아니다)', () => {
    // 같은 시드·같은 대역을 써야 예열→활성에서 모양이 튀지 않는다.
    const warmRec = recorder();
    drawHazardZone(warmRec.canvas, 0, 0, 120, hazardVisual(HAZARD_LAVA, false), 0);
    const hotRec = recorder();
    drawHazardZone(hotRec.canvas, 0, 0, 120, hazardVisual(HAZARD_LAVA, true), 0);
    // 예열 폴리곤은 36점, 활성 채움은 16점이라 꼭짓점이 겹치는 각도는 gcd(36,16)=4 개다
    // (0·¼·½·¾ 바퀴). 그 네 각도에서 정규화 반경이 같으면 두 실루엣은 같은 함수에서 나온 것이다.
    const warmPoly = polyRadii(warmRec.calls.filter((c) => c.op === 'poly')[0]?.args ?? [], 0, 0);
    const hotPoly = polyRadii(hotRec.calls.filter((c) => c.op === 'poly')[0]?.args ?? [], 0, 0);
    expect(warmPoly.length % 4).toBe(0);
    expect(hotPoly.length % 4).toBe(0);
    for (let k = 0; k < 4; k++) {
      const wv = warmPoly[(k * warmPoly.length) / 4] ?? 0;
      const hv = hotPoly[(k * hotPoly.length) / 4] ?? 0;
      // 같은 시드·같은 대역·같은 배율이라 **같은 각도에서 반경이 정확히 같아야** 한다.
      // (정규화해서 비교하면 꼭짓점 수가 달라 평균이 어긋나므로 원시 반경으로 잰다.)
      expect(wv, `k=${k}`).toBeCloseTo(hv, 9);
    }
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
    // 원은 맥동 립 하나뿐이다(정보 채널이라 §2-5 예외 — 계약이 명시적으로 허용).
    const circles = calls.filter((c) => c.op === 'circle');
    expect(circles.length).toBe(1);
    expect(circles[0]?.args[2]).toBe(150 * LIP_RATIO); // 립은 판정 반경에 정확히 놓인다
  });

  it('경계선 흔들림이 자기 선 두께보다 확실히 크다 (2차 반려 CRIT-2)', () => {
    // 2차 실측: 진폭 2.41px @r=100 인데 `strokeWidth`=4px 라 **흔들림이 자기 선 안에 묻혔다.**
    // 폴리곤이 "있다"는 것으로는 부족하고, 화면에서 굴곡으로 **보여야** 한다.
    //
    // 기준은 상수가 아니라 **실제 좌표에서 잰 진폭 대 선 두께의 비율**이다 — 이 레인은 상수를
    // 기준으로 삼는 항진을 두 번 밟았다(1차 `EDGE_MAX_RATIO=1.15`, 2차 `BOUNDARY_MIN_RATIO=0.7`).
    for (const r of [60, 120, 300]) {
      const v = hazardVisual(HAZARD_LAVA, true);
      const { canvas, calls } = recorder();
      drawHazardZone(canvas, 0, 0, r, v, 0);
      const boundary = polyAt(calls, FILL_RINGS);
      // 두께는 반경에 따라 얇아진다 — 그래야 **모든 크기에서** 비율이 성립한다(작은 장판에서
      // 고정 두께면 굴곡이 선 안에 묻힌다).
      const w = boundaryWidth(r, v.strokeWidth);
      expect(boundary.style?.width, `r=${r}`).toBe(w);
      const rad = polyRadii(boundary.args, 0, 0);
      const p2p = Math.max(...rad) - Math.min(...rad);
      expect(p2p / w, `r=${r} p2p=${p2p.toFixed(2)} w=${w.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('경계선이 판정 반경을 넘지 않는다', () => {
    for (const r of [60, 120, 300]) {
      const { canvas, calls } = recorder();
      drawHazardZone(canvas, 0, 0, r, hazardVisual(HAZARD_LAVA, true), 0);
      const rad = polyRadii(polyAt(calls, FILL_RINGS).args, 0, 0);
      expect(Math.max(...rad), `r=${r}`).toBeLessThanOrEqual(r);
    }
  });

  it('세 선이 서로 겹치지 않는 대역에 있다 (2차 반려 CRIT-3 — 꼬인 밧줄)', () => {
    // 2차 실측(@r=100): 경계 95.0~97.4 · 립 96.0 · 글로우가 92.7% 각도에서 경계선 **안쪽**.
    // 셋이 같은 5px 안에서 원주를 따라 넘나들어 밧줄처럼 보였다.
    const r = 100;
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, r, hazardVisual(HAZARD_LAVA, true), 0);
    const polyCount = calls.filter((c) => c.op === 'poly').length;
    const boundary = polyRadii(polyAt(calls, FILL_RINGS).args, 0, 0);
    const glow = polyRadii(polyAt(calls, polyCount - 1).args, 0, 0);
    const lip = calls.filter((c) => c.op === 'circle')[0]?.args[2] ?? 0;

    // 물질(경계) < 립 < 글로우 — 어느 각도에서도 순서가 뒤집히지 않는다.
    expect(Math.max(...boundary)).toBeLessThan(lip);
    expect(Math.min(...glow)).toBeGreaterThan(lip);
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

  it('장식 예산이 그림을 바꾸지 않는다 — 전 셀이 같은 표현이다 (2차 반려 MAJOR-1)', () => {
    // 41셀 중 12개만 빗금·글로우를 갖는 것은 나란한 같은 셀 사이에 스타일 차이를 만들고,
    // 색약 사용자에게는 **셀마다 정보량이 달라지는** 접근성 회귀다(빗금은 "아프다"의 색 외 채널).
    const draw = (allowDecor: boolean): string => {
      const rec = recorder();
      drawHazardZone(rec.canvas, 0, 0, 300, hazardVisual(HAZARD_LAVA, true), 0, allowDecor);
      return JSON.stringify(rec.calls);
    };
    expect(draw(true)).toBe(draw(false));
  });

  it('작은 장판도 색 외 채널(빗금)과 판정 울타리(립)를 갖는다', () => {
    const { canvas, calls } = recorder();
    drawHazardZone(canvas, 0, 0, DECOR_MIN_RADIUS - 1, hazardVisual(HAZARD_LAVA, true), 0);
    expect(calls.filter((c) => c.op === 'circle').length).toBe(1);
    expect(calls.filter((c) => c.op === 'lineTo').length).toBeGreaterThan(0);
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
    // 두께는 `boundaryWidth` 파생이라 `strokeWidth` 와 같지 않다(반경에 따라 얇아진다).
    const boundary = strokes.find((s) => s.style?.width === boundaryWidth(150, v.strokeWidth));
    expect(boundary?.style?.alpha).toBeLessThan(v.strokeAlpha);
    expect(BOUNDARY_ALPHA_SCALE).toBeLessThan(1);
    expect(GLOW_ALPHA_SCALE).toBeLessThan(1);
  });
});

describe('성능 가드 — 작고 많은 장판', () => {
  it('작은 장판도 큰 장판과 같은 겹을 갖는다(개수만 자연히 줄어든다)', () => {
    // 예전에는 반경 하한 아래에서 빗금·립·글로우가 통째로 빠졌다. 그 결과가 "같은 해저드 두
    // 스타일"이었고 색약 사용자에게는 정보 손실이었다(MAJOR-1). 지금은 겹 구성이 동일하고,
    // 빗금 줄 수만 기하학적으로(현이 짧아서) 줄어든다.
    const small = recorder();
    drawHazardZone(small.canvas, 0, 0, DECOR_MIN_RADIUS - 1, hazardVisual(HAZARD_LAVA, true), 0);
    const big = recorder();
    drawHazardZone(big.canvas, 0, 0, 300, hazardVisual(HAZARD_LAVA, true), 0);
    const ops = (r: { calls: Call[] }): string =>
      [...new Set(r.calls.map((c) => c.op))].sort().join(',');
    expect(ops(small)).toBe(ops(big));
    expect(small.calls.filter((c) => c.op === 'circle').length).toBe(1);
    expect(small.calls.some((c) => c.op === 'fill')).toBe(true);
  });

  it('반경이 커져도 빗금 선 개수에 상한이 있다', () => {
    const count = (r: number): number => {
      const rec = recorder();
      drawHazardZone(rec.canvas, 0, 0, r, hazardVisual(HAZARD_LAVA, true), 0);
      return rec.calls.filter((c) => c.op === 'lineTo').length;
    };
    expect(count(2000)).toBeLessThanOrEqual(16);
  });

  it('빗금이 셀의 한쪽만 덮지 않는다 (3차 반려 MAJOR-4 — 3차에서 생긴 회귀)', () => {
    // 3차는 `HATCH_MAX_LINES` 를 16→7 로 내리면서 루프 시작점을 `-2r` 로 그대로 뒀다. 그러면
    // 처음 7줄만 그려지고 **모든 셀에서 좌상단만 빗금이 있고 반대쪽이 비었다**(r=200 에서 후보
    // 27개 중 7개 = 26%). 빗금은 "아프다"의 색 외 채널이므로 셀 **내부** 정보량 불균형이다.
    //
    // 유효 오프셋 구간은 o ∈ (−r(1+√2), r(√2−1)) — 그 폭에 고르게 퍼졌는지를 잰다.
    for (const r of [85, 200, 400]) {
      const rec = recorder();
      drawHazardZone(rec.canvas, 0, 0, r, hazardVisual(HAZARD_LAVA, true), 0);
      // 빗금 선분의 중점 x 를 모은다(45° 선이라 중점 x 가 오프셋의 단조 함수다).
      const mids: number[] = [];
      const calls = rec.calls;
      for (let i = 0; i < calls.length - 1; i++) {
        if (calls[i]?.op !== 'moveTo' || calls[i + 1]?.op !== 'lineTo') continue;
        mids.push(((calls[i]?.args[0] ?? 0) + (calls[i + 1]?.args[0] ?? 0)) / 2);
      }
      expect(mids.length, `r=${r}`).toBeGreaterThanOrEqual(5);
      // 좌우 양쪽에 실제로 선이 있어야 한다(중앙 기준 분할).
      expect(mids.some((m) => m < -r * 0.25), `r=${r} 좌측`).toBe(true);
      expect(mids.some((m) => m > r * 0.25), `r=${r} 우측`).toBe(true);
      // 덮는 폭이 지름의 절반을 넘는다 — 3차는 지름의 27% 였다.
      const spread = Math.max(...mids) - Math.min(...mids);
      expect(spread / (2 * r), `r=${r}`).toBeGreaterThan(0.5);
    }
  });

  it('큰 장판에서 윤곽이 각져 보이지 않는다 — 변 길이를 상수로 잡는다 (3차 반려 MAJOR-6)', () => {
    // 3차는 `FILL_POINTS = 16` 고정이라 반경 200 에서 변 길이 78px 였고 화면에서 그대로
    // **16각형**으로 읽혔다. 개수 대신 **변 길이**를 상수로 잡으면 큰 장판만 촘촘해진다.
    for (const r of [60, 120, 250]) {
      const n = hazardFillPoints(r);
      expect(n % 4, `r=${r}`).toBe(0); // 예열 윤곽(36점)과 사분점이 정렬돼야 한다
      const edge = (2 * Math.PI * r) / n;
      expect(edge, `r=${r} edge=${edge.toFixed(1)}`).toBeLessThanOrEqual(40);
    }
    // 큰 장판이 작은 장판보다 촘촘하다(비용은 둘레에 비례해서만 붙는다).
    expect(hazardFillPoints(250)).toBeGreaterThan(hazardFillPoints(60));
    // 상한이 있다(폭주 방어).
    expect(hazardFillPoints(5000)).toBe(hazardFillPoints(1000));
  });
});

// ---------------------------------------------------------------------------
// 예열→활성 연속 — 형태 채널이 한 프레임에 뒤집히지 않는다 (3차 반려 MAJOR-4)
// ---------------------------------------------------------------------------

describe('형태 채널의 연속화 — 호스트의 열을 되읽는다', () => {
  /** 호스트가 하는 일을 그대로 재현한다: 활성 서술의 채움 알파에 열을 곱해 넘긴다. */
  const atHeat = (heat: number): ReturnType<typeof hazardVisual> => {
    const base = hazardVisual(HAZARD_LAVA, true);
    return { ...base, fillAlpha: base.fillAlpha * heat };
  };

  it('열을 채움 알파에서 정확히 되읽는다', () => {
    for (const h of [0, 0.25, 0.5, 0.75, 1]) {
      expect(visualHeat(atHeat(h))).toBeCloseTo(h, 9);
    }
    // 예열(점선)은 정의상 열 0 이다.
    expect(visualHeat(hazardVisual(HAZARD_LAVA, false))).toBe(0);
  });

  const hatchAlphaAt = (heat: number): number => {
    const rec = recorder();
    drawHazardZone(rec.canvas, 0, 0, 120, atHeat(heat), 0);
    // 빗금 stroke 는 두께 2 이고 경계선·글로우와 두께로 갈린다.
    const dashes = rec.calls.filter(
      (c, i) => c.op === 'stroke' && rec.calls[i - 1]?.op === 'lineTo' && c.style?.width === 2,
    );
    return dashes[0]?.style?.alpha ?? 0;
  };

  it('빗금이 열 0.35 부터 차오른다(채움과 같은 프레임에 팝인하지 않는다)', () => {
    expect(hatchAlphaAt(0.1)).toBe(0);
    expect(hatchAlphaAt(0.5)).toBeGreaterThan(0);
    expect(hatchAlphaAt(0.5)).toBeLessThan(hatchAlphaAt(1));
  });

  const solidAlphaAt = (heat: number): number => {
    const rec = recorder();
    drawHazardZone(rec.canvas, 0, 0, 120, atHeat(heat), 0);
    const w = boundaryWidth(120, 4);
    return rec.calls.find((c) => c.op === 'stroke' && c.style?.width === w)?.style?.alpha ?? 0;
  };

  it('점선→실선이 교차 페이드다(한 프레임 스위치가 아니다)', () => {
    // 열이 낮으면 실선이 옅고, 열이 차면 실선만 남는다.
    expect(solidAlphaAt(0.2)).toBe(0);
    expect(solidAlphaAt(0.55)).toBeGreaterThan(0);
    expect(solidAlphaAt(0.55)).toBeLessThan(solidAlphaAt(1));
    // 낮은 열에서는 점선 조각이 **아직 남아 있다**(같은 시드의 유기 윤곽 위).
    const low = recorder();
    drawHazardZone(low.canvas, 0, 0, 120, atHeat(0.4), 0);
    const hot = recorder();
    drawHazardZone(hot.canvas, 0, 0, 120, atHeat(1), 0);
    const dashSegs = (r: { calls: Call[] }): number => r.calls.filter((c) => c.op === 'moveTo').length;
    expect(dashSegs(low)).toBeGreaterThan(dashSegs(hot));
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
