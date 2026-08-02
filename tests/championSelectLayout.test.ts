/**
 * 챔피언 선택 화면의 **레이아웃 불변식** (2026-08-02 AAA 시네마틱 전환).
 *
 * ## 왜 좌표를 단위 테스트가 보는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고, 캔버스 없는
 * vitest 는 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. `championSelectLayout()` 이
 * 좌표를 순수 값으로 꺼내 두므로 겹침·화면 이탈·설정 톱니 예약 밴드 침범을 여기서 잠근다.
 *
 * ## 그리고 **베낀 상수의 드리프트**
 * `ROSTER_LIST_AVAIL` 은 스크롤 산술의 전제라 모듈 상수여야 하는데(기존 `championSelect.test.ts`
 * 가 그 값으로 클램프 왕복을 검증한다), 패널 콘텐츠 상자는 런타임 객체다. 그래서 화면 파일이
 * `cinematicPanel.ts` 의 `EDGE_PAD`/`CONTENT_GAP`/제목 띠 높이를 **복제**해 두었다. 복제본이
 * 조용히 어긋나면 목록 마지막 행이 영영 안 보이는데 **예외도 로그도 없다** — 실제
 * `makeCinematicPanel(...).box` 와 대조해 그 침묵을 막는다.
 */

import { describe, it, expect } from 'vitest';
import {
  championSelectLayout,
  rosterStackHeight,
  rosterSize,
  ROSTER_LIST_AVAIL,
  ROSTER_ROW_H,
  GEAR_BAND_W,
  GEAR_BAND_H,
  PANEL_EDGE_PAD,
  PANEL_TITLE_BAND_H,
  PANEL_CONTENT_GAP,
} from '../src/ui/pixi/championSelect.js';
import { makeCinematicPanel } from '../src/ui/pixi/cinematicPanel.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../src/render/app.js';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('패널 콘텐츠 상자 기하 복제본이 실제 패널과 일치한다', () => {
  it('제목 띠가 있는 패널의 box 는 복제 상수로 계산한 값과 같다', () => {
    const w = 560;
    const h = 940;
    const panel = makeCinematicPanel({ width: w, height: h, variant: 'slab', title: '보유 가능 기체' });
    expect(panel.box.x).toBe(PANEL_EDGE_PAD);
    expect(panel.box.y).toBe(PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP);
    expect(panel.box.w).toBe(w - PANEL_EDGE_PAD * 2);
    expect(panel.box.h).toBe(h - (PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP) - PANEL_EDGE_PAD);
    panel.destroy();
  });

  it('제목이 없는 창 패널의 box 는 사방 EDGE_PAD 다', () => {
    const w = 620;
    const h = 580;
    const panel = makeCinematicPanel({ width: w, height: h, variant: 'window' });
    expect(panel.headerBottom).toBe(0);
    expect(panel.box.x).toBe(PANEL_EDGE_PAD);
    expect(panel.box.y).toBe(PANEL_EDGE_PAD);
    expect(panel.box.w).toBe(w - PANEL_EDGE_PAD * 2);
    expect(panel.box.h).toBe(h - PANEL_EDGE_PAD * 2);
    panel.destroy();
  });
});

describe('챔피언 선택 레이아웃 불변식', () => {
  const layout = championSelectLayout();

  it('패널 네 장이 서로 겹치지 않는다', () => {
    const rects = layout.panels;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        if (a === undefined || b === undefined) continue;
        expect(overlaps(a.rect, b.rect), `${a.id} 와 ${b.id} 가 겹친다`).toBe(false);
      }
    }
  });

  it('패널이 헤더 밴드를 침범하지 않고 화면 밖으로도 나가지 않는다', () => {
    for (const p of layout.panels) {
      expect(p.rect.y, `${p.id} 가 헤더 밴드를 덮는다`).toBeGreaterThanOrEqual(layout.headerH);
      expect(p.rect.x).toBeGreaterThanOrEqual(0);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
  });

  it('좌·우 열의 바닥이 같다 — 남는 세로 없이 화면을 채운다', () => {
    const byId = new Map(layout.panels.map((p) => [p.id, p.rect]));
    const roster = byId.get('roster');
    const trees = byId.get('trees');
    expect(roster).toBeDefined();
    expect(trees).toBeDefined();
    if (roster === undefined || trees === undefined) return;
    expect(trees.y + trees.h).toBe(roster.y + roster.h);
  });

  it('헤더 컨트롤은 같은 세로 띠를 쓰고 서로 겹치지 않는다', () => {
    const ctrls = layout.headerControls;
    for (let i = 0; i < ctrls.length; i++) {
      for (let j = i + 1; j < ctrls.length; j++) {
        const a = ctrls[i];
        const b = ctrls[j];
        if (a === undefined || b === undefined) continue;
        expect(overlaps(a.rect, b.rect), `${a.id} 와 ${b.id} 가 겹친다`).toBe(false);
      }
    }
    for (const c of ctrls) {
      expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(layout.headerH);
    }
  });

  it('설정 톱니 예약 밴드(좌상단)에는 컨트롤을 두지 않는다', () => {
    // 톱니는 매 프레임 stage 최상위로 올라온다 — 여기에 컨트롤을 두면 통째로 클릭 불가가 된다.
    const band: Rect = { x: 0, y: 0, w: GEAR_BAND_W, h: GEAR_BAND_H };
    for (const c of layout.headerControls) {
      expect(overlaps(c.rect, band), `${c.id} 가 톱니 밴드에 걸린다`).toBe(false);
    }
  });

  it('배경 보존 창은 히어로 패널 안에 있다 (배경 모듈에 넘기는 값과 같은 식)', () => {
    const hero = layout.panels.find((p) => p.id === 'hero');
    expect(hero).toBeDefined();
    const win = layout.windows[0];
    expect(win).toBeDefined();
    if (hero === undefined || win === undefined) return;
    expect(layout.windows).toHaveLength(1);
    expect(win.x).toBeGreaterThanOrEqual(hero.rect.x);
    expect(win.y).toBeGreaterThanOrEqual(hero.rect.y);
    expect(win.x + win.w).toBeLessThanOrEqual(hero.rect.x + hero.rect.w);
    expect(win.y + win.h).toBeLessThanOrEqual(hero.rect.y + hero.rect.h);
  });

  it('로스터 목록 창이 실제로 넘쳐 스크롤이 필요하다', () => {
    // 넘치지 않으면 스크롤 배선이 죽어도 아무도 모른다(기존 championSelect.test.ts 의 전제).
    expect(ROSTER_LIST_AVAIL).toBeGreaterThan(ROSTER_ROW_H);
    expect(rosterStackHeight(rosterSize())).toBeGreaterThan(ROSTER_LIST_AVAIL);
  });

  it('로스터 목록 창이 패널 콘텐츠 상자 안에 들어온다', () => {
    const roster = layout.panels.find((p) => p.id === 'roster');
    expect(roster).toBeDefined();
    if (roster === undefined) return;
    const boxH = roster.rect.h - (PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP) - PANEL_EDGE_PAD;
    // 목록 + 확정 버튼 영역이 상자를 넘으면 버튼이 목록 위에 겹쳐 앉는다.
    expect(ROSTER_LIST_AVAIL).toBeLessThan(boxH);
  });
});
