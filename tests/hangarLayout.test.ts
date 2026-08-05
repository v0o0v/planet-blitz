/**
 * 격납고 슬롯 그리드 레이아웃 헬퍼 검증 (격납고 카툰 UI 파일럿).
 *
 * `gridPositions` 는 UI-독립 순수 함수라(Pixi 미의존) 단위 테스트로 좌표를 고정한다.
 * 슬롯 셀·툴팁 등 렌더는 브라우저 수동 확인 몫(handoff: 신규 테스트는 레이아웃 계산에만).
 */

import { describe, it, expect } from 'vitest';
import { gridPositions, fitGridCols, itemGlyph } from '../src/ui/pixi/slotGrid.js';
import {
  arrangeItems,
  FILTER_KINDS,
  SORT_MODES,
  hangarHeaderLayout,
  TITLE_BAND_HALF_W,
} from '../src/ui/pixi/hangar.js';
import { DESIGN_WIDTH } from '../src/render/app.js';

interface HeadRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
import { rollItem } from '../src/items/roll.js';
import { panelContent } from '../src/ui/pixi/nineSlicePanel.js';
import type { Item, SlotKind } from '../src/items/types.js';

describe('gridPositions', () => {
  it('lays out row-major with cell+gap spacing', () => {
    const pos = gridPositions(5, 4, 66, 8);
    expect(pos).toHaveLength(5);
    expect(pos[0]).toEqual({ x: 0, y: 0 });
    expect(pos[1]).toEqual({ x: 74, y: 0 }); // 66 + 8
    expect(pos[3]).toEqual({ x: 222, y: 0 }); // col 3
    expect(pos[4]).toEqual({ x: 0, y: 74 }); // wraps to row 1
  });

  it('handles n=0 and single column', () => {
    expect(gridPositions(0, 8, 66, 8)).toEqual([]);
    const one = gridPositions(3, 1, 10, 2);
    expect(one.map((p) => p.y)).toEqual([0, 12, 24]);
  });
});

// ---------------------------------------------------------------------------
// 폭 채움(fitGridCols) — 인벤토리 우측 여백 결함의 회귀 방어.
// ---------------------------------------------------------------------------

describe('fitGridCols — 콘텐츠 폭을 남김없이 쓴다', () => {
  it('열 수를 폭에서 유도하고 남는 폭을 열 간격이 흡수한다', () => {
    const fit = fitGridCols(832, 66, 8);
    expect(fit.cols).toBe(11); // 8열 하드코딩(584px)이 아니라 폭에 맞춘 11열
    expect(fit.gapX).toBeGreaterThanOrEqual(8);
    expect(fit.width).toBeLessThanOrEqual(832);
    // 남는 오른쪽 여백은 열 수 미만(=간격 분배 나머지)까지만 허용한다.
    expect(832 - fit.width).toBeLessThan(fit.cols);
  });

  it('격납고 두 하단 패널(인벤토리 952 · 창고 900) 모두 여백이 사실상 0 이다', () => {
    for (const pw of [952, 900]) {
      const box = panelContent(pw, 432);
      const fit = fitGridCols(box.w, 66, 8);
      expect(box.w - fit.width, `패널 ${pw} 의 그리드 우측 여백`).toBeLessThan(fit.cols);
      expect(fit.cols).toBeGreaterThan(8); // 예전 8열 하드코딩보다 반드시 넓게 쓴다
    }
  });

  it('셀 하나도 못 넣는 폭이면 1열로 떨어진다(0 나눗셈 없음)', () => {
    const fit = fitGridCols(40, 66, 8);
    expect(fit.cols).toBe(1);
    expect(fit.width).toBe(40);
  });

  it('간격은 최소값 아래로 내려가지 않고, 남는 폭이 있으면 넓어진다', () => {
    const tight = fitGridCols(140, 66, 8); // 2열 + 최소 간격에 딱 맞는 폭
    expect(tight.cols).toBe(2);
    expect(tight.gapX).toBe(8);
    const loose = fitGridCols(148, 66, 8); // 8px 남음 → 유일한 간격이 흡수
    expect(loose.cols).toBe(2);
    expect(loose.gapX).toBe(16);
    expect(loose.width).toBe(148);
  });
});

// ---------------------------------------------------------------------------
// 분류 보기(arrangeItems) — 필터/정렬은 순수 함수로 검증한다.
// ---------------------------------------------------------------------------

/** 원하는 슬롯이 나올 때까지 굴린다(결정론 시드). */
function itemOfSlot(seed: number, want: SlotKind, rarity: Item['rarity'] = 'rare'): Item {
  for (let s = seed; s < seed + 5000; s++) {
    const it = rollItem(s, rarity, { planet: 0, stage: 1 });
    if (it.slot === want) return it;
  }
  throw new Error(`슬롯 ${want} 아이템을 굴리지 못했다`);
}

describe('arrangeItems — 슬롯 필터 + 정렬', () => {
  const main = itemOfSlot(11, 'main', 'normal');
  const engine = itemOfSlot(21, 'engine', 'unique');
  const armor = itemOfSlot(31, 'armor', 'magic');
  const main2 = itemOfSlot(41, 'main', 'rare');
  const source: Item[] = [main, engine, armor, main2];

  it('필터 없으면 용량까지 빈 칸을 채워 남은 자리를 보여준다', () => {
    const cells = arrangeItems(source, 12, null, 'default', 6);
    expect(cells).toHaveLength(12);
    expect(cells.slice(0, 4)).toEqual(source);
    expect(cells.slice(4).every((c) => c === undefined)).toBe(true);
  });

  it('슬롯 필터는 해당 종류만 남기고 마지막 행만 채운다', () => {
    const cells = arrangeItems(source, 12, 'main', 'default', 6);
    expect(cells.filter((c) => c !== undefined)).toEqual([main, main2]);
    expect(cells).toHaveLength(6); // 용량(12)이 아니라 한 행
  });

  it('희귀도 정렬은 높은 등급이 앞, 동률은 획득순(안정)', () => {
    const cells = arrangeItems(source, 4, null, 'rarity', 4).filter((c): c is Item => c !== undefined);
    expect(cells.map((c) => c.rarity)).toEqual(['unique', 'rare', 'magic', 'normal']);
    const twoRares = arrangeItems([main2, engine, itemOfSlot(51, 'core', 'rare')], 3, null, 'rarity', 3);
    expect(twoRares[1]).toBe(main2); // unique 다음은 먼저 들어온 rare
  });

  it('슬롯 정렬은 장착 슬롯 순서(main→sub→armor→…)를 따른다', () => {
    const cells = arrangeItems(source, 4, null, 'slot', 4).filter((c): c is Item => c !== undefined);
    expect(cells.map((c) => c.slot)).toEqual(['main', 'main', 'armor', 'engine']);
  });

  it('원본 배열을 절대 변형하지 않는다(저장 순서가 화면 조작으로 안 바뀐다)', () => {
    const snapshot = [...source];
    arrangeItems(source, 12, 'main', 'rarity', 6);
    arrangeItems(source, 12, null, 'slot', 6);
    expect(source).toEqual(snapshot);
  });

  it('걸러진 결과가 0개면 빈 목록(호출부가 안내 문구를 낸다)', () => {
    expect(arrangeItems(source, 12, 'shield', 'default', 6)).toEqual([]);
  });

  it('필터 탭 8칸(전체+슬롯 7종)·정렬 3모드가 UI 와 같은 목록을 쓴다', () => {
    expect(FILTER_KINDS).toHaveLength(8);
    expect(FILTER_KINDS[0]).toBeNull();
    expect(SORT_MODES).toEqual(['default', 'rarity', 'slot']);
  });
});

describe('itemGlyph', () => {
  it('maps weapon slots to distinct glyphs', () => {
    expect(itemGlyph('main')).toBe('✷');
    expect(itemGlyph('sub')).toBe('❋');
    expect(itemGlyph('armor')).toBe('◈');
  });
});

// ---------------------------------------------------------------------------
// 헤더 밴드 — 이 화면은 헤더가 게임에서 가장 붐빈다(요소 여덟)
//
// 좌표가 `renderTitleBar` 안 지역 변수였고, 이 화면은 헤더 겹침 결함을 이미 겪었는데도
// 형제 화면들과 달리 그것을 잠그는 테스트가 없었다. 도움말 버튼을 끼우면서 상수로 끌어올려
// 여기서 잠근다.
// ---------------------------------------------------------------------------

describe('격납고 헤더 — 여덟 컨트롤이 겹치지 않는다', () => {
  const controls = hangarHeaderLayout();
  const overlaps = (a: HeadRect, b: HeadRect): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('서로 겹치지 않고 같은 세로 띠를 쓴다', () => {
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i];
        const b = controls[j];
        if (a === undefined || b === undefined) continue;
        expect(overlaps(a.rect, b.rect), `${a.id} 와 ${b.id} 가 겹친다`).toBe(false);
      }
    }
    for (const c of controls) {
      expect(c.rect.y, `${c.id} 의 세로 띠가 다르다`).toBe(26);
      expect(c.rect.h).toBe(52);
    }
  });

  it('화면 밖으로 나가지 않고 오른쪽 끝 여백 32 를 남긴다', () => {
    for (const c of controls) {
      expect(c.rect.x).toBeGreaterThanOrEqual(0);
      expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(DESIGN_WIDTH);
    }
    const right = Math.max(...controls.map((c) => c.rect.x + c.rect.w));
    expect(DESIGN_WIDTH - right).toBe(32);
  });

  it('각인 제목이 앉는 중앙 대역이 비어 있다', () => {
    // 중앙 정렬 Text 는 사각형이 없어 겹침 테스트가 못 잡는다 — 대역을 상수로 못 박고 잠근다.
    // ⚠️ 도움말 버튼이 이 대역에 가장 가깝다(공통 폭 140 이면 여유가 12px 로 떨어져 128 을 쓴다).
    const band: HeadRect = {
      x: DESIGN_WIDTH / 2 - TITLE_BAND_HALF_W,
      y: 0,
      w: TITLE_BAND_HALF_W * 2,
      h: 104,
    };
    for (const c of controls) {
      expect(overlaps(c.rect, band), `${c.id} 가 제목 대역에 걸린다`).toBe(false);
    }
  });

  it('설정 톱니 예약 밴드(좌상단 120×120)에는 컨트롤을 두지 않는다', () => {
    // 톱니는 매 프레임 stage 최상위로 올라온다 — 여기에 두면 통째로 클릭 불가가 된다.
    const gear: HeadRect = { x: 0, y: 0, w: 120, h: 120 };
    for (const c of controls) {
      expect(overlaps(c.rect, gear), `${c.id} 가 톱니 밴드에 걸린다`).toBe(false);
    }
  });

  it('도움말 버튼이 헤더에 등록돼 있다', () => {
    // 목록에서 빠지면 위 검사들이 조용히 통과한다 — 존재 자체를 못 박는다.
    expect(controls.map((c) => c.id)).toContain('help');
  });
});
