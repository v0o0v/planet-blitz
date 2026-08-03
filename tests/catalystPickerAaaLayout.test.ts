/**
 * 촉매 주입 픽커의 **레이아웃 불변식** (2026-08-03 AAA 시네마틱 전환).
 *
 * ## 왜 좌표를 단위 테스트가 보는가
 * 이 팝업에서 실제로 났던 결함이 **버튼이 닫기 ✕ 를 덮은 것**이다(사용자 신고 2026-07-28
 * 스크린샷 — [확정]/[전체 해제] 를 제목 줄 오른쪽 끝에 뒀는데 닫기 아이콘도 같은 자리였다).
 * 좌표가 순수 값으로 나와 있으면 그 유형이 렌더 없이 잡힌다.
 *
 * 그리고 전환에서 새로 생긴 축 둘:
 *  - 화면 파일이 복제한 `cinematicPanel.ts` 의 상자 기하가 **실제 패널과 같은가**
 *    (어긋나면 내용이 패널 테두리를 뚫는데 예외도 로그도 없다).
 *  - `render()` 통짜 재생성 → `buildChrome()` 1회 + `refresh()` 로 갈랐는가
 *    (안 가르면 [주입] 한 번마다 1560×940 석재를 다시 굽는다).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  catalystPickerLayout,
  summaryRowCapacity,
  summaryShownRows,
  SUMMARY_METRICS,
  PANEL_EDGE_PAD,
  PANEL_TITLE_BAND_H,
  PANEL_CONTENT_GAP,
} from '../src/ui/pixi/catalystPicker.js';
import { makeCinematicPanel } from '../src/ui/pixi/cinematicPanel.js';
import { CATALYSTS } from '../src/data/catalysts.js';
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

const layout = catalystPickerLayout();
const readSource = (rel: string): string =>
  new TextDecoder().decode(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const SRC = readSource('../src/ui/pixi/catalystPicker.ts');

describe('패널 콘텐츠 상자 기하 복제본이 실제 패널과 일치한다', () => {
  it('box 가 복제 상수로 계산한 값과 같다', () => {
    const { w, h } = layout.modal;
    const panel = makeCinematicPanel({ width: w, height: h, variant: 'slab', title: '촉매 주입' });
    expect(panel.box.x).toBe(PANEL_EDGE_PAD);
    expect(panel.box.y).toBe(PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP);
    expect(panel.box.w).toBe(w - PANEL_EDGE_PAD * 2);
    expect(panel.box.h).toBe(h - (PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP) - PANEL_EDGE_PAD);
    expect(layout.box.x).toBe(panel.box.x);
    expect(layout.box.y).toBe(panel.box.y);
    expect(layout.box.w).toBe(panel.box.w);
    expect(layout.box.h).toBe(panel.box.h);
    expect(layout.box.bottom).toBe(panel.box.y + panel.box.h);
    expect(layout.box.right).toBe(panel.box.x + panel.box.w);
    panel.destroy();
  });
});

describe('픽커 레이아웃 불변식', () => {
  it('팝업이 화면 정중앙이고 화면 밖으로 나가지 않는다', () => {
    const m = layout.modal;
    expect(m.x).toBe(Math.round((DESIGN_WIDTH - m.w) / 2));
    expect(m.y).toBe(Math.round((DESIGN_HEIGHT - m.h) / 2));
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.x + m.w).toBeLessThanOrEqual(DESIGN_WIDTH);
    expect(m.y + m.h).toBeLessThanOrEqual(DESIGN_HEIGHT);
  });

  it('기하가 상태로 갈리지 않는다(인자를 받지 않는 것이 계약)', () => {
    expect(catalystPickerLayout).toHaveLength(0);
  });

  it('⚠️ 헤더 버튼이 닫기 ✕ 를 덮지 않는다(2026-07-28 실제 신고)', () => {
    for (const b of layout.headerButtons) {
      expect(overlaps(b.rect, layout.close), `${b.id} 가 닫기 ✕ 를 덮는다`).toBe(false);
      // 가로로만 피하면 창 폭이 줄었을 때 다시 겹친다 — **세로로** 분리돼 있어야 한다.
      expect(b.rect.y, `${b.id} 가 제목 띠 안으로 올라왔다`).toBeGreaterThanOrEqual(
        layout.close.y + layout.close.h,
      );
    }
  });

  it('닫기 ✕ 가 각인 제목 띠 안에 있고 콘텐츠 상자를 침범하지 않는다', () => {
    const c = layout.close;
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.y + c.h).toBeLessThanOrEqual(PANEL_TITLE_BAND_H);
    expect(c.x + c.w).toBe(layout.box.right);
  });

  it('헤더 버튼 둘이 겹치지 않고 오른쪽 끝에 붙는다(주 동작이 바깥쪽)', () => {
    const [clear, confirm] = layout.headerButtons;
    expect(clear).toBeDefined();
    expect(confirm).toBeDefined();
    if (clear === undefined || confirm === undefined) return;
    expect(confirm.id).toBe('confirm');
    expect(confirm.rect.x + confirm.rect.w).toBe(layout.box.right);
    expect(clear.rect.x + clear.rect.w).toBeLessThanOrEqual(confirm.rect.x);
    expect(overlaps(clear.rect, confirm.rect)).toBe(false);
    // 왼쪽에는 슬롯 카운터가 앉는다(빈 자리가 아니라 쓰이는 자리다).
    expect(clear.rect.x - layout.box.x).toBeGreaterThanOrEqual(240);
  });

  it('그리드·요약이 콘텐츠 상자 안에서 남는 세로를 나눠 갖는다(빈 자리 금지)', () => {
    const g = layout.grid;
    const s = layout.summary;
    expect(g.x).toBe(layout.box.x);
    expect(g.w).toBe(layout.box.w);
    expect(s.x).toBe(layout.box.x);
    expect(s.w).toBe(layout.box.w);
    // 헤더 줄 → 그리드 → 요약이 여백 어휘 하나(16)씩으로만 이어지고 바닥에 정확히 닿는다.
    expect(g.y - (layout.box.y + layout.headerButtons[0]!.rect.h)).toBe(16);
    expect(s.y - (g.y + g.h)).toBe(16);
    expect(s.y + s.h).toBe(layout.box.bottom);
    expect(overlaps(g, s)).toBe(false);
    expect(g.h).toBeGreaterThan(0);
  });

  // ⚠️ 열 수(6) 자체는 못 박지 않는다 — 5 로 바꾸는 뮤테이션은 살아 돌아왔고 그게 **옳다**
  // (그 값에서도 셀이 더 넓어질 뿐 아무것도 안 깨진다). 여기가 잡는 것은 "열이 폭을 안 채운다"다.
  it('셀 여섯 열이 그리드 폭을 채우고 넘치지 않는다', () => {
    const g = layout.grid;
    const used = g.cols * g.cellW + 12 * (g.cols - 1);
    expect(used).toBeLessThanOrEqual(g.w);
    // 반올림 잔여는 열 수 미만이어야 한다(더 크면 오른쪽에 이름 없는 빈 띠가 생긴다).
    expect(g.w - used).toBeLessThan(g.cols);
  });

  it('그리드가 한 화면에 다 안 들어가므로 스크롤이 필요하다(마스크를 행 경계로 자르지 않는다)', () => {
    const g = layout.grid;
    const rows = Math.ceil(CATALYSTS.length / g.cols);
    const totalH = rows * (g.cellH + 12) - 12;
    expect(totalH).toBeGreaterThan(g.h);
    // 상자 높이를 그대로 쓰면 마지막 행이 반쯤 걸쳐 "아래에 더 있다"를 말한다.
    expect(SRC).not.toContain('clampToRows');
    // 마지막으로 보이는 행이 실제로 잘려야 그 신호가 산다(정확히 나누어떨어지면 안 된다).
    expect(g.h % (g.cellH + 12)).not.toBe(0);
  });

  it('요약 열이 축 여섯 종을 감당할 만큼 그린다(넘치면 개수로 알린다)', () => {
    // 촉매 조합은 페널티/보상 축을 6종까지 몰 수 있다 — 네 줄도 못 그리면 `외 N개` 만 남는다.
    expect(summaryRowCapacity()).toBeGreaterThanOrEqual(4);
    expect(SRC).toContain("t('result.drops.more', { n: hidden })");
  });

  it('⚠️ 마지막 줄이 챔버 바닥을 뚫지 않는다(`외 N개` 줄까지 세어서)', () => {
    // 실화면 1차(2026-08-03): 페널티 축이 다섯일 때 `외 1개` 가 챔버 바닥 밖에 그려져 잘렸다.
    // 원인은 용량 산식이 그 줄을 안 센 것 — 이제 마지막 자리를 그 줄에 내준다.
    const m = SUMMARY_METRICS;
    const cap = summaryRowCapacity();
    const lastLineTop = m.rowsY + m.headH + (cap - 1) * m.step;
    expect(lastLineTop + m.step, '마지막 줄이 챔버 바닥을 넘는다').toBeLessThanOrEqual(m.h - m.pad);

    // ⚠️ 좌표만 보면 부족하다 — `Math.min(total, capacity)` 로 되돌리는 뮤테이션이 살아 돌아왔다.
    // 넘칠 때는 `외 N개` 줄이 **자리 하나를 차지하므로** 그린 줄 + 1 이 용량 안이어야 한다.
    expect(summaryShownRows(cap)).toBe(cap);
    for (const total of [cap + 1, cap + 3, 12]) {
      const shown = summaryShownRows(total);
      expect(shown, `${total}줄: 다 그리면 외 N개 줄이 바닥을 뚫는다`).toBeLessThan(total);
      expect(shown + 1, `${total}줄: 외 N개 줄 자리가 없다`).toBeLessThanOrEqual(cap);
    }
  });
});

describe('시네마틱 전환에서 지켜야 할 배선', () => {
  it('나무 모달·나무 행 바탕·나무 버튼을 더 이상 쓰지 않는다', () => {
    // ⚠️ 이름만 grep 하면 **파일 헤더의 설명 문구**("왜 makeModal 을 안 쓰는가")가 걸린다 —
    // import 와 실제 자산 키로 본다.
    for (const gone of ["from './modal.js'", "from './listRow.js'", "from './nineSlicePanel.js'"]) {
      expect(SRC, `${gone} import 가 남아 있다`).not.toContain(gone);
    }
    for (const key of ['ui_btn_wood.png', 'ui_btn_yellow.png', 'ui_panel.png', 'ui_icon_close.png']) {
      expect(SRC, `${key} 를 아직 읽는다`).not.toContain(`'${key}'`);
    }
  });

  it('공용 modal.ts 는 손대지 않았다(다른 화면 다섯이 쓴다)', () => {
    const modal = readSource('../src/ui/pixi/modal.ts');
    expect(modal).toContain('nineSlicePanel');
  });

  it('암막이 불투명하고 이벤트를 먹는다(뒤 목록이 계속 눌리면 안 된다)', () => {
    // 뒤(성계 지도)는 석재 패널 셋이 화면을 거의 덮어 밝다 — 나무 판의 0.78 로는 비친다.
    expect(SRC).toMatch(/alpha: SCRIM_ALPHA/);
    expect(SRC).toMatch(/const SCRIM_ALPHA = 0\.99;/);
    expect(SRC).toContain("scrim.eventMode = 'static';");
    // ③ 패널 안쪽 탭이 암막까지 올라가면 팝업 안을 누를 때마다 창이 닫힌다.
    expect(SRC).toMatch(/panel\.container\.on\('pointertap', \(e: FederatedPointerEvent\) => e\.stopPropagation\(\)\)/);
  });

  it('석재 패널을 한 번만 굽는다(주입 한 번마다 다시 구우면 안 된다)', () => {
    // `makeCinematicPanel` 호출은 `buildChrome()` 안에만 있어야 한다.
    const build = SRC.slice(SRC.indexOf('private buildChrome('), SRC.indexOf('// --- 갱신'));
    expect(build).toContain('makeCinematicPanel({');
    const refreshFn = SRC.slice(SRC.indexOf('private refresh('), SRC.indexOf('private renderGrid('));
    expect(refreshFn).not.toContain('makeCinematicPanel');
    // 편집 동작은 전부 refresh 로 간다(통짜 재생성 금지).
    for (const fn of ['private inject(', 'private remove(', 'private clearAll(']) {
      const at = SRC.indexOf(fn);
      expect(at, `${fn} 를 못 찾았다`).toBeGreaterThan(-1);
      const body = SRC.slice(at, SRC.indexOf('\n  }', at));
      expect(body, `${fn} 가 갱신을 안 부른다`).toContain('this.refresh();');
      // ⚠️ `refresh()` 를 부르는지만 보면 **부족하다** — 그 앞에 크롬을 다시 세우는 뮤테이션이
      // 살아 돌아왔다(2026-08-03). 편집 경로에는 크롬 재건이 아예 없어야 한다.
      for (const rebuild of ['this.buildChrome()', 'this.destroyChrome()']) {
        expect(body, `${fn} 가 ${rebuild} 로 석재를 다시 굽는다`).not.toContain(rebuild);
      }
    }
  });

  it('성계 지도가 픽커에 dt 를 흘린다(팝업이 뜬 동안만 연출이 멈추면 안 된다)', () => {
    const star = readSource('../src/ui/pixi/planetSelect.ts');
    expect(star).toMatch(/^[ \t]*this\.picker\.update\(dt\);/m);
  });

  it('셀 버튼에 gold 톤을 쓰지 않는다(비활성 셀의 글자가 통째로 사라진다)', () => {
    // `setEnabled(false)` 는 container alpha 를 0.4 로 낮추고 그림자를 끈다 — 금 톤은 라벨이
    // 진한 갈색이라 겹치면 안 보인다. 주입/해제는 어두운 blue/red(크림 라벨)여야 한다.
    const cell = SRC.slice(SRC.indexOf('private makeCell('));
    expect(cell).not.toContain("tone: 'gold'");
    expect(cell).toContain("tone: 'blue'");
    expect(cell).toContain("tone: 'red'");
  });

  it('편집 게이트는 계속 순수 계층이 소유한다(픽커가 다시 판정하지 않는다)', () => {
    expect(SRC).toContain('canInjectCatalyst(def, this.working, this.opts.inventory, this.opts.planet)');
    expect(SRC).toContain('catalystLocked(def, this.opts.planet)');
  });
});
