/**
 * 필드 오버레이(추격 시야 암흑 · 수축 안전 반경) 렌더 계약 테스트.
 *
 * 이 프로젝트의 반복 결함은 "단위는 초록인데 배선이 없다"다 — 그래서 순수 그리기 함수뿐 아니라
 * **`render()` 가 실제로 오버레이를 호출하는지(배선)** 를 정규 경로 위에서 잰다. 오버레이는 렌더
 * 전용이므로(sim/해시 무관), 스냅샷의 render-only 필드(visionRadius·safeRadius)로만 켜지고
 * 둘 다 0 이면 아무것도 그리지 않아야 한다.
 *
 * PixiJS 는 렌더러 없이 import 만 하므로 node 에서 그대로 돈다(invasionRender.test.ts 선례).
 */

import { describe, it, expect } from 'vitest';
import { Graphics } from 'pixi.js';
import {
  EntityRenderer,
  drawVisionFog,
  drawSafeZone,
  VISION_FOG_COLOR,
  VISION_FOG_MAX_ALPHA,
  SAFE_RING_COLOR,
  SAFE_PRESSURE_COLOR,
} from '../src/render/entityRenderer.js';
import type { PlaceholderTextures } from '../src/render/textures.js';
import type { WorldSnapshot } from '../src/sim/snapshot.js';

/** Graphics 에 누적된 드로잉 인스트럭션 수(그렸는지의 관측창). */
function instrCount(g: Graphics): number {
  return (g.context as unknown as { instructions: unknown[] }).instructions.length;
}

/** 엔티티 없는 최소 스냅샷(오버레이만 검증 — 텍스처 접근 경로가 없다). */
function emptySnap(over: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    tick: 0,
    arenaWidth: 1000,
    arenaHeight: 1000,
    cameraX: 0,
    cameraY: 0,
    planet: 0,
    visionRadius: 0,
    safeRadius: 0,
    entities: [],
    beams: [],
    ...over,
  };
}

describe('순수 그리기 — 시야 암흑', () => {
  it('시야 반경이 화면 절반 대각선보다 작으면 암흑 밴드를 그린다', () => {
    const g = new Graphics();
    drawVisionFog(g, 0, 0, 300);
    expect(instrCount(g)).toBeGreaterThan(0);
  });

  it('상수 계약(색·최대 알파는 소프트 비네트 범위)', () => {
    expect(VISION_FOG_COLOR).toBe(0x05070d);
    expect(VISION_FOG_MAX_ALPHA).toBeGreaterThan(0);
    expect(VISION_FOG_MAX_ALPHA).toBeLessThan(1); // 완전 불투명이 아니어야 소프트 비네트로 읽힌다
  });
});

describe('순수 그리기 — 안전 반경 압박존', () => {
  it('경계 링 + 압박존 밴드를 그린다', () => {
    const g = new Graphics();
    drawSafeZone(g, 0, 0, 600, 0);
    expect(instrCount(g)).toBeGreaterThan(0);
  });

  it('카메라가 멀리 있어도 밴드 수가 폭발하지 않는다(성능 상한)', () => {
    const g = new Graphics();
    drawSafeZone(g, 8000, 8000, 600, 0); // 원점에서 멀리
    // 밴드 수 상한(120) + 링 2 + 여유. 상한이 없으면 수천 개가 된다.
    expect(instrCount(g)).toBeLessThan(160);
  });

  it('상수 계약(링=시안, 압박존=적자)', () => {
    expect(SAFE_RING_COLOR).toBe(0x39d0ff);
    expect(SAFE_PRESSURE_COLOR).toBe(0x2a0812);
  });
});

describe('배선 — render() 가 스냅샷 필드로 오버레이를 켠다', () => {
  /** 엔티티가 없으면 render() 는 텍스처를 만지지 않는다 → 빈 캐스트 스텁으로 충분. */
  function renderer(): { r: EntityRenderer; fog: Graphics } {
    const r = new EntityRenderer({} as PlaceholderTextures);
    const fog = r.layer.children[r.layer.children.length - 1] as Graphics; // 최상단 = fog
    return { r, fog };
  }

  it('둘 다 0(그 외 전 모드)이면 아무것도 그리지 않는다', () => {
    const { r, fog } = renderer();
    const s = emptySnap();
    r.render(s, s, 1);
    expect(instrCount(fog)).toBe(0);
  });

  it('visionRadius>0(추격)이면 fog 레이어에 암흑이 배선된다', () => {
    const { r, fog } = renderer();
    const s = emptySnap({ visionRadius: 300 });
    r.render(s, s, 1);
    expect(instrCount(fog)).toBeGreaterThan(0);
  });

  it('safeRadius>0(수축)이면 fog 레이어에 압박존이 배선된다', () => {
    const { r, fog } = renderer();
    const s = emptySnap({ safeRadius: 600 });
    r.render(s, s, 1);
    expect(instrCount(fog)).toBeGreaterThan(0);
  });

  it('매 프레임 clear 된다 — 켰다 끄면 다시 빈다(누적 없음)', () => {
    const { r, fog } = renderer();
    r.render(emptySnap({ visionRadius: 300 }), emptySnap({ visionRadius: 300 }), 1);
    expect(instrCount(fog)).toBeGreaterThan(0);
    const off = emptySnap();
    r.render(off, off, 1);
    expect(instrCount(fog)).toBe(0);
  });
});
