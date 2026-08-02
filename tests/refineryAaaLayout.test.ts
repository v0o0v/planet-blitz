/**
 * 정제소 화면의 **레이아웃 불변식** (2026-08-02 AAA 시네마틱 전환).
 *
 * ## 왜 좌표를 단위 테스트가 보는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고, 캔버스 없는
 * vitest 는 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. `refineryLayout()` 이 좌표를 순수
 * 값으로 꺼내 두므로 겹침·화면 이탈·설정 톱니 예약 밴드 침범·제목 대역 침범을 여기서 잠근다.
 *
 * ## 그리고 **빈 자리**와 **베낀 상수의 드리프트**
 * 형제 화면 넷이 전부 실화면에서 "쓸모도 볼거리도 아닌 자리"를 잡아 고쳤다. 여기서는 공정
 * 뭉치를 콘텐츠 상자 바닥에 못 박아 `lastBottom === boxBottom` 이 **등호로** 성립하고, 격자는
 * 행 피치의 배수로 클램프해 잔여가 한 행 미만이다 — 둘 다 여기서 잠근다.
 *
 * 그리고 화면 파일이 `cinematicPanel.ts` 의 `EDGE_PAD`/`CONTENT_GAP`/제목 띠 높이를 **복제**해
 * 두었다(패널 상자는 런타임 객체인데 `refineryDetailLayout` 은 Pixi 없이 검증돼야 한다).
 * 복제본이 조용히 어긋나면 공정 뭉치가 패널 테두리를 뚫는데 **예외도 로그도 없다** —
 * 실제 `makeCinematicPanel(...).box` 와 대조해 그 침묵을 막는다.
 */

import { describe, it, expect } from 'vitest';
import {
  refineryLayout,
  refineryDetailLayout,
  REFINERY_GRID,
  REFINERY_DETAIL_BOX,
  GEAR_BAND_W,
  GEAR_BAND_H,
  TITLE_BAND_HALF_W,
  PANEL_EDGE_PAD,
  PANEL_TITLE_BAND_H,
  PANEL_CONTENT_GAP,
  REFINERY_SORTS,
  sortRefineryItems,
} from '../src/ui/pixi/refinery.js';
import { makeCinematicPanel } from '../src/ui/pixi/cinematicPanel.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../src/render/app.js';
import { SLOT_KINDS, type Item, type Rarity, type SlotKind } from '../src/items/types.js';

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 어픽스 수의 현실 범위(등급별 1~6). 6은 흔한 경우지 예외가 아니다. */
const AFFIX_COUNTS = [1, 2, 3, 4, 5, 6] as const;

describe('패널 콘텐츠 상자 기하 복제본이 실제 패널과 일치한다', () => {
  const layout = refineryLayout();

  for (const id of ['list', 'detail']) {
    it(`${id} 패널의 box 가 복제 상수로 계산한 값과 같다`, () => {
      const p = layout.panels.find((q) => q.id === id);
      expect(p).toBeDefined();
      if (p === undefined) return;
      const { w, h } = p.rect;
      const panel = makeCinematicPanel({ width: w, height: h, variant: 'slab', title: '정제소' });
      expect(panel.box.x).toBe(PANEL_EDGE_PAD);
      expect(panel.box.y).toBe(PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP);
      expect(panel.box.w).toBe(w - PANEL_EDGE_PAD * 2);
      expect(panel.box.h).toBe(h - (PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP) - PANEL_EDGE_PAD);
      panel.destroy();
    });
  }

  it('상세 패널의 상자 바닥이 refineryDetailLayout 의 boxBottom 과 같다', () => {
    const p = layout.panels.find((q) => q.id === 'detail');
    expect(p).toBeDefined();
    if (p === undefined) return;
    const panel = makeCinematicPanel({
      width: p.rect.w,
      height: p.rect.h,
      variant: 'slab',
      title: '리롤',
    });
    expect(REFINERY_DETAIL_BOX.bottom).toBe(panel.box.y + panel.box.h);
    expect(REFINERY_DETAIL_BOX.x).toBe(panel.box.x);
    expect(REFINERY_DETAIL_BOX.w).toBe(panel.box.w);
    expect(refineryDetailLayout(3).boxBottom).toBe(panel.box.y + panel.box.h);
    panel.destroy();
  });

  it('목록 격자의 가용 세로가 실제 상자 높이와 같다', () => {
    const p = layout.panels.find((q) => q.id === 'list');
    expect(p).toBeDefined();
    if (p === undefined) return;
    const panel = makeCinematicPanel({
      width: p.rect.w,
      height: p.rect.h,
      variant: 'slab',
      title: '보유 장비',
    });
    // 격자의 가용 세로 = 실제 상자 높이 − 정렬 줄. 상자를 좌변에 두고 대조해야 복제 상수가
    // 어긋났을 때(= 격자가 패널 밖으로 나갈 때) 잡힌다.
    expect(REFINERY_GRID.avail).toBe(panel.box.h - (REFINERY_GRID.sortH + 12));
    expect(REFINERY_GRID.sortY).toBe(panel.box.y);
    expect(REFINERY_GRID.boxW).toBe(panel.box.w);
    panel.destroy();
  });
});

describe('정제소 레이아웃 불변식', () => {
  const layout = refineryLayout();

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

  it('두 패널이 좌우 여백 32 안에서 화면 폭을 채우고 바닥이 같다 — 남는 세로가 없다', () => {
    const list = layout.panels.find((p) => p.id === 'list');
    const detail = layout.panels.find((p) => p.id === 'detail');
    expect(list).toBeDefined();
    expect(detail).toBeDefined();
    if (list === undefined || detail === undefined) return;
    expect(list.rect.x).toBe(32);
    expect(detail.rect.x + detail.rect.w).toBe(DESIGN_WIDTH - 32);
    // 사이 거터 28.
    expect(detail.rect.x - (list.rect.x + list.rect.w)).toBe(28);
    // 바닥이 같고, 화면 하단 여백은 28 하나뿐이다(옛 [기지로 돌아가기] 버튼 자리 186px 회수).
    expect(list.rect.y + list.rect.h).toBe(detail.rect.y + detail.rect.h);
    expect(DESIGN_HEIGHT - (list.rect.y + list.rect.h)).toBe(28);
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
      expect(c.rect.y).toBe(26);
      expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(layout.headerH);
      expect(c.rect.x).toBeGreaterThanOrEqual(0);
      expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(DESIGN_WIDTH);
    }
  });

  it('각인 제목이 앉는 중앙 대역이 비어 있다', () => {
    // 제목은 중앙 정렬 Text 라 사각형이 없어 겹침 테스트가 못 잡는다 — 연구소 실화면에서
    // 제목이 헤더 버튼과 실제로 겹쳤다. 대역을 상수로 못 박고 잠근다.
    const band: Rect = {
      x: DESIGN_WIDTH / 2 - TITLE_BAND_HALF_W,
      y: 0,
      w: TITLE_BAND_HALF_W * 2,
      h: layout.headerH,
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
});

describe('목록 격자 — 빈 자리 금지', () => {
  it('격자가 콘텐츠 상자 안에서 끝나고 잔여가 한 행 피치 미만이다', () => {
    expect(REFINERY_GRID.h).toBeLessThanOrEqual(REFINERY_GRID.avail);
    expect(REFINERY_GRID.avail - REFINERY_GRID.h).toBeLessThan(REFINERY_GRID.pitch);
  });

  it('마스크 높이가 행 경계에 정확히 떨어진다(반토막 셀 금지)', () => {
    expect((REFINERY_GRID.h + REFINERY_GRID.gap) % REFINERY_GRID.pitch).toBe(0);
  });

  it('6열이 콘텐츠 상자 폭 안에 들어간다', () => {
    expect(REFINERY_GRID.w).toBeLessThanOrEqual(REFINERY_GRID.boxW);
    expect(REFINERY_GRID.x).toBeGreaterThanOrEqual(REFINERY_DETAIL_BOX.x);
  });
});

describe('목록 정렬', () => {
  const item = (id: string, rarity: Rarity, slot: SlotKind, affixes: number): Item =>
    ({
      id,
      rarity,
      slot,
      affixes: Array.from({ length: affixes }, () => ({ id: 'a', stat: 'damagePct', value: 1 })),
    }) as unknown as Item;

  const sample: Item[] = [
    item('a', 'magic', 'engine', 2),
    item('b', 'unique', 'main', 1),
    item('c', 'normal', 'armor', 4),
    item('d', 'magic', 'main', 2),
  ];

  it('정렬 버튼 4칸이 콘텐츠 상자 폭 안에서 끝난다', () => {
    const g = REFINERY_GRID;
    expect(g.sortCols).toBe(REFINERY_SORTS.length);
    const rowW = g.sortCols * g.sortW + (g.sortCols - 1) * g.sortGapX;
    expect(rowW).toBeLessThanOrEqual(g.boxW);
    // 폭이 파생값이라 잔여는 반올림 오차(칸 수 미만)뿐이어야 한다.
    expect(g.boxW - rowW).toBeLessThan(g.sortCols);
  });

  it('격자가 정렬 줄 아래에서 시작하고, 그만큼만 세로를 잃는다', () => {
    const g = REFINERY_GRID;
    expect(g.y).toBe(g.sortY + g.sortH + 12);
    expect(g.h).toBeLessThanOrEqual(g.avail);
    expect(g.avail - g.h).toBeLessThan(g.pitch);
  });

  it('획득순은 입력 순서를 그대로 둔다(기본값이 정보를 지우지 않는다)', () => {
    expect(sortRefineryItems(sample, 'recent').map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('등급순은 높은 등급이 앞이고 동률은 획득순으로 되돌아간다', () => {
    expect(sortRefineryItems(sample, 'rarity').map((i) => i.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('어픽스순은 많은 쪽이 앞이고 동률은 획득순으로 되돌아간다', () => {
    expect(sortRefineryItems(sample, 'affixes').map((i) => i.id)).toEqual(['c', 'a', 'd', 'b']);
  });

  it('슬롯순은 SLOT_KINDS 순서를 따르고 동률은 획득순으로 되돌아간다', () => {
    const out = sortRefineryItems(sample, 'slot');
    const rank = out.map((i) => SLOT_KINDS.indexOf(i.slot));
    expect([...rank].sort((x, y) => x - y)).toEqual(rank);
    // 같은 슬롯(main)의 둘은 획득 순서(b → d)를 유지한다.
    expect(out.filter((i) => i.slot === 'main').map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('입력 배열을 변형하지 않는다(인벤토리는 표시 순서를 모른다)', () => {
    const before = sample.map((i) => i.id);
    for (const mode of REFINERY_SORTS) sortRefineryItems(sample, mode);
    expect(sample.map((i) => i.id)).toEqual(before);
  });
});

describe('정련 공정 세로 — 어떤 어픽스 수에서도 테두리를 넘지 않고 빈 자리도 없다', () => {
  for (const n of AFFIX_COUNTS) {
    it(`어픽스 ${n}개: 마지막 요소 bottom 이 콘텐츠 상자 바닥과 **정확히 같다**`, () => {
      const L = refineryDetailLayout(n);
      // 뭉치를 바닥에 못 박았으므로 등호다 — 부등호로 두면 하단에 죽은 자리가 생겨도 통과한다.
      expect(L.lastBottom).toBe(L.boxBottom);
    });

    it(`어픽스 ${n}개: 목록 → 트로프 → 노 출력 순서가 겹침 없이 보존된다`, () => {
      const L = refineryDetailLayout(n);
      expect(L.rowsTop, '목록이 장비 머리 위로 올라갔다').toBeGreaterThanOrEqual(
        REFINERY_DETAIL_BOX.affixTop,
      );
      expect(L.rowsEnd, '목록이 트로프를 뚫었다').toBeLessThanOrEqual(L.troughY);
      expect(L.troughY + L.troughH, '트로프가 노 출력 행을 뚫었다').toBeLessThanOrEqual(L.heatY);
      expect(L.heatY).toBeLessThan(L.costY);
      expect(L.costY).toBeLessThan(L.actionY);
    });

    it(`어픽스 ${n}개: 보이는 목록이 영역을 넘지 않는다`, () => {
      const L = refineryDetailLayout(n);
      expect(L.viewH).toBeLessThanOrEqual(REFINERY_DETAIL_BOX.affixRegionH);
      expect(L.rowsEnd - L.rowsTop).toBe(L.viewH);
    });
  }

  it('어픽스가 4개 이상이면 목록이 영역을 거의 채운다(빈 자리 ≤ 20px)', () => {
    // 행 높이를 어픽스 수에서 파생시키는 이유가 이것이다 — 고정 64px 이면 4개짜리에서
    // 영역 428 중 164 가 죽는다. 상한 96 은 1개짜리에서 거대한 행이 나오는 것을 막는다.
    for (const n of [4, 5, 6]) {
      const L = refineryDetailLayout(n);
      expect(
        REFINERY_DETAIL_BOX.affixRegionH - L.viewH,
        `어픽스 ${n}개에서 영역이 남는다`,
      ).toBeLessThanOrEqual(20);
    }
  });

  it('어픽스가 적으면 목록이 영역 한가운데 앉는다(위·아래 여백 대칭)', () => {
    for (const n of [1, 2]) {
      const L = refineryDetailLayout(n);
      const above = L.rowsTop - REFINERY_DETAIL_BOX.affixTop;
      const below = REFINERY_DETAIL_BOX.affixTop + REFINERY_DETAIL_BOX.affixRegionH - L.rowsEnd;
      expect(Math.abs(above - below), `어픽스 ${n}개에서 목록이 한쪽으로 쏠렸다`).toBeLessThanOrEqual(1);
    }
  });

  it('행 높이는 하한·상한 안에서만 움직인다', () => {
    for (const n of [...AFFIX_COUNTS, 0, 12, 40]) {
      const L = refineryDetailLayout(n);
      expect(L.rowH, `n=${n}`).toBeGreaterThanOrEqual(64);
      expect(L.rowH, `n=${n}`).toBeLessThanOrEqual(96);
    }
  });

  it('어픽스가 영역을 넘치면 스크롤이 필요해진다(목록이 트로프를 뚫지 않는다)', () => {
    // 지금 등급 정의로는 최대 6이라 스크롤이 안 붙지만, 어픽스 수가 늘어도 목록이 트로프를
    // 뚫지 않게 하는 보험이다 — 그 성질을 여기서 잠근다.
    const L = refineryDetailLayout(40);
    expect(L.totalH).toBeGreaterThan(L.viewH);
    expect(L.viewH).toBe(REFINERY_DETAIL_BOX.affixRegionH);
    expect(L.rowsEnd).toBeLessThanOrEqual(L.troughY);
  });

  it('레어 최대 6어픽스가 스크롤 없이 들어간다', () => {
    // 이 화면의 결정(어느 어픽스를 고착할까)은 전량을 한눈에 봐야 성립한다. 트로프를 키우거나
    // 장비 머리를 키우면 영역이 줄어 조용히 깨지는 성질이라 여기서 잠근다 — 뮤테이션
    // `TROUGH_H 84 → 200` 이 이 단언이 없을 때 통과했다.
    const box = REFINERY_DETAIL_BOX;
    expect(box.rowsNoScrollH).toBeLessThanOrEqual(box.affixRegionH);
    const L = refineryDetailLayout(box.rowsNoScroll);
    expect(L.totalH, '6어픽스에서 스크롤이 붙는다').toBeLessThanOrEqual(L.viewH);
  });

  it('어픽스 행이 노 챔버 안쪽에 앉는다(챔버 테두리를 덮지 않는다)', () => {
    // 행이 챔버와 같은 폭이면 파낸 자리가 아니라 얹어 놓은 판때기로 읽힌다 — 어픽스가 적은
    // 장비에서 남는 자리에 "이름을 주는" 처방 전체가 그 한 가지에 걸려 있다(실화면 1차 확인).
    const box = REFINERY_DETAIL_BOX;
    expect(box.wellPad).toBeGreaterThan(0);
    expect(box.rowW).toBe(box.w - box.wellPad * 2);
  });

  it('상세 상자 폭이 노 출력 3버튼 + 안내를 담는다', () => {
    // 목록 패널을 넓히면 상세가 좁아진다 — 안내가 접힐 폭을 못 얻으면 `renderHeatRow` 가
    // 그것을 **조용히 생략한다**(하한 검사가 있어 예외도 안 난다). 뮤테이션
    // `LIST_W 640 → 900` 계열이 이 단언이 없을 때 통과했다.
    const box = REFINERY_DETAIL_BOX;
    expect(box.heatRowW + box.heatHintGap + box.heatHintMinW).toBeLessThanOrEqual(box.w);
  });

  it('음수·소수 어픽스 수도 안전하다(손상 방어)', () => {
    for (const n of [-3, 0, 2.7]) {
      const L = refineryDetailLayout(n);
      expect(Number.isFinite(L.rowsTop)).toBe(true);
      expect(L.lastBottom).toBe(L.boxBottom);
      expect(L.rowsEnd).toBeLessThanOrEqual(L.troughY);
    }
  });
});
