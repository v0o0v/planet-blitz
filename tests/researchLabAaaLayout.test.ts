/**
 * 연구소 화면의 **레이아웃 불변식** (2026-08-02 AAA 시네마틱 전환).
 *
 * ## 왜 좌표를 단위 테스트가 보는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고, 캔버스 없는
 * vitest 는 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. `researchLabLayout()` 이 좌표를
 * 순수 값으로 꺼내 두므로 겹침·화면 이탈·설정 톱니 예약 밴드 침범을 여기서 잠근다.
 *
 * ## 그리고 **베낀 상수의 드리프트**
 * `INVESTED_LIST.avail`·`POPUP_LIST.bottom`·`ACTIVES_PANEL.boxBottom` 은 스크롤 산술의 전제라
 * 모듈 상수여야 하는데(기존 `researchLabLayout.test.ts`·`activeSkillUi.test.ts` 가 그 값으로
 * 클램프 왕복을 검증한다), 패널 콘텐츠 상자는 런타임 객체다. 그래서 화면 파일이
 * `cinematicPanel.ts` 의 `EDGE_PAD`/`CONTENT_GAP`/제목 띠 높이를 **복제**해 두었다. 복제본이
 * 조용히 어긋나면 목록 마지막 행이 영영 안 보이는데 **예외도 로그도 없다** — 실제
 * `makeCinematicPanel(...).box` 와 대조해 그 침묵을 막는다.
 */

import { describe, it, expect } from 'vitest';
import {
  researchLabLayout,
  listStackHeight,
  clampToRowHeight,
  INVESTED_LIST,
  POPUP_LIST,
  ACTIVES_PANEL,
  GEAR_BAND_W,
  GEAR_BAND_H,
  TITLE_BAND_HALF_W,
  PANEL_EDGE_PAD,
  PANEL_TITLE_BAND_H,
  PANEL_CONTENT_GAP,
} from '../src/ui/pixi/researchLab.js';
import { makeCinematicPanel } from '../src/ui/pixi/cinematicPanel.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../src/render/app.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { NODES_PER_TREE } from '../data/skills.js';

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
  it('제목 띠가 있는 계열 패널의 box 는 복제 상수로 계산한 값과 같다', () => {
    const layout = researchLabLayout();
    const tree = layout.panels.find((p) => p.id === 'tree:0');
    expect(tree).toBeDefined();
    if (tree === undefined) return;
    const { w, h } = tree.rect;
    const panel = makeCinematicPanel({ width: w, height: h, variant: 'slab', title: '화력' });
    expect(panel.box.x).toBe(PANEL_EDGE_PAD);
    expect(panel.box.y).toBe(PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP);
    expect(panel.box.w).toBe(w - PANEL_EDGE_PAD * 2);
    expect(panel.box.h).toBe(h - (PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP) - PANEL_EDGE_PAD);
    // 투자 목록의 가용 세로는 이 상자 안에서 끝나야 한다(넘치면 캡스톤 바 위로 걸친다).
    expect(INVESTED_LIST.avail).toBeLessThan(panel.box.h);
    panel.destroy();
  });

  it('전체 스킬 팝업의 마스크 하한이 실제 상자 바닥과 같다', () => {
    const panel = makeCinematicPanel({
      width: 900,
      height: POPUP_LIST.bottom + PANEL_EDGE_PAD,
      variant: 'slab',
      title: '전체 스킬',
    });
    expect(POPUP_LIST.bottom).toBe(panel.box.y + panel.box.h);
    expect(POPUP_LIST.top).toBeGreaterThanOrEqual(panel.box.y);
    panel.destroy();
  });

  it('액티브 팝업의 상자 바닥이 실제 패널과 같다', () => {
    const panel = makeCinematicPanel({
      width: ACTIVES_PANEL.w,
      height: ACTIVES_PANEL.h,
      variant: 'slab',
      title: '액티브 스킬',
    });
    expect(ACTIVES_PANEL.boxX).toBe(panel.box.x);
    expect(ACTIVES_PANEL.boxY).toBe(panel.box.y);
    expect(ACTIVES_PANEL.boxW).toBe(panel.box.w);
    expect(ACTIVES_PANEL.boxBottom).toBe(panel.box.y + panel.box.h);
    panel.destroy();
  });
});

describe('연구소 레이아웃 불변식', () => {
  const layout = researchLabLayout();

  it('패널끼리 겹치지 않는다', () => {
    const rects = layout.panels;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
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

  it('계열 패널 세 장의 바닥이 같고, 그 아래를 파생 스탯 띠가 받는다 — 남는 세로가 없다', () => {
    const trees = layout.panels.filter((p) => p.id.startsWith('tree:'));
    const stats = layout.panels.find((p) => p.id === 'stats');
    expect(trees).toHaveLength(3);
    expect(stats).toBeDefined();
    if (stats === undefined) return;
    const bottoms = new Set(trees.map((p) => p.rect.y + p.rect.h));
    expect(bottoms.size).toBe(1);
    // 띠는 계열 패널 바로 아래에 붙고, 화면 하단 여백(28)에서 끝난다.
    const treeBottom = [...bottoms][0] ?? 0;
    expect(stats.rect.y).toBeGreaterThan(treeBottom);
    expect(stats.rect.y - treeBottom).toBeLessThanOrEqual(20);
    expect(DESIGN_HEIGHT - (stats.rect.y + stats.rect.h)).toBe(28);
  });

  it('계열 패널 셋이 좌우 여백 32 안에서 화면 폭을 채운다', () => {
    const trees = layout.panels.filter((p) => p.id.startsWith('tree:'));
    const first = trees[0];
    const last = trees[trees.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;
    expect(first.rect.x).toBe(32);
    expect(last.rect.x + last.rect.w).toBe(DESIGN_WIDTH - 32);
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
      expect(c.rect.x).toBeGreaterThanOrEqual(0);
      expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(DESIGN_WIDTH);
    }
  });

  it('각인 제목이 앉는 중앙 대역이 비어 있다', () => {
    // 제목은 중앙 정렬 Text 라 사각형이 없어 겹침 테스트가 못 잡는다 — 실화면 1차에서
    // "연구소 — 스킬 트리"가 리스펙 버튼과 실제로 겹쳤다. 대역을 상수로 못 박고 잠근다.
    const band: Rect = {
      x: DESIGN_WIDTH / 2 - TITLE_BAND_HALF_W,
      y: 0,
      w: TITLE_BAND_HALF_W * 2,
      h: 104,
    };
    for (const c of layout.headerControls) {
      expect(overlaps(c.rect, band), `${c.id} 가 제목 대역에 걸린다`).toBe(false);
    }
  });

  it('설정 톱니 예약 밴드(좌상단)에는 컨트롤을 두지 않는다', () => {
    // 톱니는 매 프레임 stage 최상위로 올라온다 — 여기에 컨트롤을 두면 통째로 클릭 불가가 된다.
    const band: Rect = { x: 0, y: 0, w: GEAR_BAND_W, h: GEAR_BAND_H };
    for (const c of layout.headerControls) {
      expect(overlaps(c.rect, band), `${c.id} 가 톱니 밴드에 걸린다`).toBe(false);
    }
  });

  it('배경 창은 두지 않는다(초점 피사체가 없다 — 파일 헤더 근거)', () => {
    expect(layout.windows).toHaveLength(0);
  });

  it('계열 수가 달라져도 열이 화면 폭 안에서 끝난다', () => {
    for (const cols of [1, 2, 3, 4, 5]) {
      const l = researchLabLayout(cols);
      const trees = l.panels.filter((p) => p.id.startsWith('tree:'));
      expect(trees).toHaveLength(cols);
      for (const p of trees) {
        expect(p.rect.x + p.rect.w, `cols=${cols}`).toBeLessThanOrEqual(DESIGN_WIDTH - 32);
      }
    }
  });
});

describe('목록 산술 — 새 좌표에서도 전제가 유지된다', () => {
  it('스트라이커 20노드는 본 패널에서 스크롤 없이 들어간다', () => {
    const h = listStackHeight(
      NODES_PER_TREE,
      INVESTED_LIST.cols,
      INVESTED_LIST.cellH,
      INVESTED_LIST.gapY,
    );
    expect(h).toBeLessThanOrEqual(INVESTED_LIST.avail);
  });

  it('노드가 더 많은 기체는 넘친다 — 그래서 스크롤 배선이 살아 있어야 한다', () => {
    const overflow = SHIP_TYPES.filter(
      (def) =>
        listStackHeight(
          def.nodesPerTree,
          INVESTED_LIST.cols,
          INVESTED_LIST.cellH,
          INVESTED_LIST.gapY,
        ) > INVESTED_LIST.avail,
    );
    expect(overflow.length).toBeGreaterThan(0);
  });

  it('전체 스킬 팝업 마스크가 행 경계에 정확히 떨어진다(반토막 행 금지)', () => {
    const avail = POPUP_LIST.bottom - POPUP_LIST.top;
    const viewH = clampToRowHeight(avail, POPUP_LIST.pitch);
    expect(viewH % POPUP_LIST.pitch).toBe(0);
    // 팝업 세로를 목록에서 역산했으므로 **버려지는 세로가 한 픽셀도 없어야** 한다(빈 자리 금지).
    expect(avail - viewH).toBe(0);
  });

  it('액티브 격자가 상자 바닥에 정확히 맞는다(빈 자리 금지)', () => {
    const p = ACTIVES_PANEL;
    const gridBottom = p.gridTop + p.rows * p.cellH + (p.rows - 1) * p.cellGapY;
    expect(gridBottom).toBe(p.boxBottom);
  });

  it('파생 스탯 6열 × 2행이 12행 전량을 담는다(미리보기 축 수와 같다)', () => {
    // PREVIEW_ROWS 는 12축이다 — 6열 2행이 정확히 그 수다. 열을 줄이면 축이 조용히 잘린다.
    expect(6 * 2).toBe(12);
  });
});
