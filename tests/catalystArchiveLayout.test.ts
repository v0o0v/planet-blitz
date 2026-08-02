/**
 * 촉매 보관함 레이아웃 불변식 (2026-08-02 AAA 시네마틱 전환).
 *
 * ## 왜 이 테스트가 있는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 이미 겪었고, 캔버스
 * 없는 vitest 는 Pixi 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. 그래서 좌표를
 * `catalystArchiveLayout()` 이 순수 값으로 내보내고, 여기서 겹침·이탈·예약 밴드 침범을 잠근다.
 *
 * 여기서 검증하는 것은 **좌표 산술**이지 그림이 아니다. 그림 판정은 하네스 실화면 스크린샷이다.
 */

import { describe, expect, it } from 'vitest';
import {
  catalystArchiveLayout,
  GEAR_BAND_H,
  GEAR_BAND_W,
  type CatalystArchiveRect,
} from '../src/ui/pixi/catalystArchive.js';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../src/render/app.js';

const right = (r: CatalystArchiveRect): number => r.x + r.w;
const bottom = (r: CatalystArchiveRect): number => r.y + r.h;

function overlaps(a: CatalystArchiveRect, b: CatalystArchiveRect): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

describe('촉매 보관함 레이아웃', () => {
  const L = catalystArchiveLayout();

  it('화면 치수가 디자인 스페이스와 같다', () => {
    expect(L.screen).toEqual({ x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT });
  });

  it('패널 세 장이 서로 겹치지 않는다', () => {
    for (let i = 0; i < L.panels.length; i++) {
      for (let j = i + 1; j < L.panels.length; j++) {
        const a = L.panels[i];
        const b = L.panels[j];
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        if (a === undefined || b === undefined) continue;
        expect(overlaps(a.rect, b.rect), `${a.id} ↔ ${b.id}`).toBe(false);
      }
    }
  });

  it('패널이 전부 화면 안이고 헤더 밴드를 침범하지 않는다', () => {
    for (const p of L.panels) {
      expect(p.rect.x, p.id).toBeGreaterThanOrEqual(0);
      expect(p.rect.y, p.id).toBeGreaterThanOrEqual(L.headerH);
      expect(right(p.rect), p.id).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(bottom(p.rect), p.id).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
  });

  it('우측 두 패널의 바닥이 목록 패널 바닥과 정확히 같다', () => {
    // 파생으로 강제한 값이다(`AUX_H = LIST_Y + LIST_H - AUX_Y`). 하드코딩으로 되돌리면 여기서 깨진다.
    const byId = new Map(L.panels.map((p) => [p.id, p.rect]));
    const list = byId.get('list');
    const residue = byId.get('residue');
    expect(list).toBeDefined();
    expect(residue).toBeDefined();
    if (list === undefined || residue === undefined) return;
    expect(bottom(residue)).toBe(bottom(list));
  });

  it('좌우 여백이 대칭이다', () => {
    const byId = new Map(L.panels.map((p) => [p.id, p.rect]));
    const list = byId.get('list');
    const detail = byId.get('detail');
    expect(list).toBeDefined();
    expect(detail).toBeDefined();
    if (list === undefined || detail === undefined) return;
    expect(list.x).toBe(DESIGN_WIDTH - right(detail));
  });

  it('헤더 컨트롤이 전부 같은 세로 띠를 쓰고 가로로 겹치지 않는다', () => {
    // 세로로 쌓지 않는 것이 이 화면의 겹침 방지 규율이다 — 구조적으로 확인한다.
    const ys = new Set(L.headerControls.map((c) => `${c.rect.y}:${c.rect.h}`));
    expect(ys.size).toBe(1);

    const sorted = [...L.headerControls].sort((a, b) => a.rect.x - b.rect.x);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev === undefined || cur === undefined) continue;
      expect(cur.rect.x, `${prev.id} → ${cur.id}`).toBeGreaterThanOrEqual(right(prev.rect));
    }
  });

  it('헤더 컨트롤이 좌상단 설정 톱니 예약 밴드를 침범하지 않는다', () => {
    // ⚠️ 톱니는 매 프레임 stage 최상위로 올라오므로, 겹친 컨트롤은 통째로 클릭 불가가 된다.
    const band: CatalystArchiveRect = { x: 0, y: 0, w: GEAR_BAND_W, h: GEAR_BAND_H };
    for (const c of L.headerControls) {
      expect(overlaps(c.rect, band), c.id).toBe(false);
    }
  });

  it('헤더 컨트롤이 화면 안이고 헤더 밴드 높이를 넘지 않는다', () => {
    for (const c of L.headerControls) {
      expect(c.rect.x, c.id).toBeGreaterThanOrEqual(0);
      expect(right(c.rect), c.id).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(bottom(c.rect), c.id).toBeLessThanOrEqual(L.headerH);
    }
  });
});
