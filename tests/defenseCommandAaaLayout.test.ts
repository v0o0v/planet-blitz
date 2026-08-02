/**
 * 방어 사령부의 **레이아웃 불변식** (2026-08-02 AAA 시네마틱 전환).
 *
 * ## 왜 좌표를 단위 테스트가 보는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고, 캔버스 없는
 * vitest 는 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. `defenseCommandLayout()` 이
 * 좌표를 순수 값으로 꺼내 두므로 겹침·화면 이탈·설정 톱니 예약 밴드 침범·제목 대역 침범을
 * 여기서 잠근다.
 *
 * ## 그리고 **빈 자리**와 **베낀 상수의 드리프트**
 * 형제 화면 다섯이 전부 실화면에서 "쓸모도 볼거리도 아닌 자리"를 잡아 고쳤다. 여기서는
 * 탭 줄·패널 열·하단 띠가 콘텐츠 폭/세로를 **등호로** 채우고, 팝업 세 종은 높이를 내용에서
 * 역산해 버려지는 세로가 0 이다 — 전부 여기서 잠근다.
 *
 * 그리고 화면 파일이 `cinematicPanel.ts` 의 `EDGE_PAD`/`CONTENT_GAP`/제목 띠 높이를 **복제**해
 * 두었다(패널 상자는 런타임 객체인데 좌표 서술은 Pixi 없이 검증돼야 한다). 복제본이 조용히
 * 어긋나면 내용이 패널 테두리를 뚫는데 **예외도 로그도 없다** — 실제
 * `makeCinematicPanel(...).box` 와 대조해 그 침묵을 막는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  defenseCommandLayout,
  DEFENSE_BOXES,
  DEFENSE_MODALS,
  pickModalHeight,
  fillRowHeights,
  previewChildIndex,
  GEAR_BAND_W,
  GEAR_BAND_H,
  TITLE_BAND_HALF_W,
  PANEL_EDGE_PAD,
  PANEL_TITLE_BAND_H,
  PANEL_CONTENT_GAP,
  DEF_TAB_COUNT,
  DEF_TAB_KEYS,
  DEF_TAB_INV,
} from '../src/ui/pixi/defenseCommand.js';
import { makeCinematicPanel, cinematicWindowOpening } from '../src/ui/pixi/cinematicPanel.js';
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

const layout = defenseCommandLayout();

describe('패널 콘텐츠 상자 기하 복제본이 실제 패널과 일치한다', () => {
  for (const id of ['left', 'right'] as const) {
    it(`${id} 패널의 box 가 복제 상수로 계산한 값과 같다`, () => {
      const p = layout.panels.find((q) => q.id === id);
      expect(p).toBeDefined();
      if (p === undefined) return;
      const { w, h } = p.rect;
      const panel = makeCinematicPanel({ width: w, height: h, variant: 'slab', title: '방어 사령부' });
      expect(panel.box.x).toBe(PANEL_EDGE_PAD);
      expect(panel.box.y).toBe(PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP);
      expect(panel.box.w).toBe(w - PANEL_EDGE_PAD * 2);
      expect(panel.box.h).toBe(h - (PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP) - PANEL_EDGE_PAD);
      // 화면 파일이 들고 있는 상자 서술도 같은 값이어야 한다.
      const box = DEFENSE_BOXES[id];
      expect(box.x).toBe(panel.box.x);
      expect(box.y).toBe(panel.box.y);
      expect(box.w).toBe(panel.box.w);
      expect(box.h).toBe(panel.box.h);
      expect(box.bottom).toBe(panel.box.y + panel.box.h);
      panel.destroy();
    });
  }

  it('프리뷰 뷰포트가 창의 **개구부**와 정확히 같다(콘텐츠 상자가 아니다)', () => {
    // 사용자 신고(2026-08-03) "테두리와 미리보기가 안 맞는다"의 실체. `box` 는 글자를 놓는
    // 자리라 사방 24 안쪽 + 제목 띠 아래 16 이고, 창은 바깥 베벨 1 + 석재 단면 6 만 문다.
    // box 에 맞추면 프레임과 그림 사이에 위 16px · 좌우·아래 17px 의 맨 배경 띠가 생긴다.
    const p = layout.panels.find((q) => q.id === 'left');
    expect(p).toBeDefined();
    if (p === undefined) return;
    const win = layout.windows[0];
    expect(win).toBeDefined();
    if (win === undefined) return;
    const open = cinematicWindowOpening(p.rect.w, p.rect.h, true);
    expect(win.x).toBe(p.rect.x + open.x);
    expect(win.y).toBe(p.rect.y + open.y);
    expect(win.w).toBe(open.w);
    expect(win.h).toBe(open.h);

    // 개구부는 콘텐츠 상자보다 **모든 방향으로 넓다** — 둘을 헷갈리면 띠가 다시 생긴다.
    const panel = makeCinematicPanel({
      width: p.rect.w,
      height: p.rect.h,
      variant: 'window',
      title: '배치 프리뷰',
    });
    expect(open.x).toBeLessThan(panel.box.x);
    expect(open.y).toBeLessThan(panel.box.y);
    expect(open.right).toBeGreaterThan(panel.box.right);
    expect(open.bottom).toBeGreaterThan(panel.box.bottom);
    // 제목 띠는 비워 둔다(제목 글자가 내용물 위에 얹히면 안 읽힌다).
    expect(open.y).toBe(panel.headerBottom);
    panel.destroy();
  });
});

describe('방어 사령부 레이아웃 불변식', () => {
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

  it('탭 줄 · 패널 · 하단 띠가 서로 겹치지 않고 순서대로 내려간다', () => {
    const tab = layout.tabs[0];
    const left = layout.panels[0];
    expect(tab).toBeDefined();
    expect(left).toBeDefined();
    if (tab === undefined || left === undefined) return;
    expect(tab.y).toBeGreaterThanOrEqual(layout.headerH);
    expect(left.rect.y).toBeGreaterThanOrEqual(tab.y + tab.h);
    // 탭과 패널이 0px 로 붙지 않는다(옛 보드가 탭 바닥에 붙어 활성 탭이 테두리에 얹혀 보였다).
    expect(left.rect.y - (tab.y + tab.h)).toBeGreaterThanOrEqual(12);
    expect(layout.footer.band.y).toBeGreaterThanOrEqual(left.rect.y + left.rect.h);
  });

  it('패널이 헤더 밴드를 침범하지 않고 화면 밖으로도 나가지 않는다', () => {
    for (const p of layout.panels) {
      expect(p.rect.y, `${p.id} 가 헤더 밴드를 덮는다`).toBeGreaterThanOrEqual(layout.headerH);
      expect(p.rect.x).toBeGreaterThanOrEqual(0);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
  });

  it('두 패널이 좌우 여백 32 안에서 화면 폭을 채우고 바닥이 같다', () => {
    const left = layout.panels.find((p) => p.id === 'left');
    const right = layout.panels.find((p) => p.id === 'right');
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    if (left === undefined || right === undefined) return;
    expect(left.rect.x).toBe(32);
    expect(right.rect.x + right.rect.w).toBe(DESIGN_WIDTH - 32);
    expect(right.rect.x - (left.rect.x + left.rect.w)).toBe(28); // 거터 28
    expect(left.rect.y + left.rect.h).toBe(right.rect.y + right.rect.h);
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
    // 헤더뿐 아니라 **탭 줄 첫 칸**도 검사한다(y 112 라 세로로는 안전하지만, 탭 줄을 위로
    // 올리는 뮤테이션이 이 단언 없이는 통과한다).
    const band: Rect = { x: 0, y: 0, w: GEAR_BAND_W, h: GEAR_BAND_H };
    for (const c of layout.headerControls) {
      expect(overlaps(c.rect, band), `${c.id} 가 톱니 밴드에 걸린다`).toBe(false);
    }
    for (const [i, tRect] of layout.tabs.entries()) {
      expect(overlaps(tRect, band), `탭 ${i} 가 톱니 밴드에 걸린다`).toBe(false);
    }
  });

  it('배경 창은 **배치 프리뷰 하나**다(형제 화면 넷과 갈리는 지점)', () => {
    // 창은 "배경이 보이는 구멍"이 아니라 "무언가를 보여주는 자리"다 — 여기는 실제 sim 정지
    // 렌더가 그 자리에 선다. 창을 늘리면(= 피사체 없는 구멍) 그 규칙이 깨진다.
    expect(layout.windows).toHaveLength(1);
  });

  it('프리뷰 노드는 창 패널 **바로 뒤**다(창 처리가 그 위를 덮어야 유리창이 된다)', () => {
    // 옛 계약은 "맨 앞"이었다 — 나무 패널이 fillAlpha 0.96 으로 덮어 기여분이 4.6% 였기
    // 때문이다. `window` 변종은 안쪽을 **파내므로** 그 전제가 사라졌고, 앞에 두면 프리뷰가
    // 석재 단면·AO·유리 반사·바닥 스크림을 통째로 가려 개구부가 그냥 검은 사각이 된다.
    expect(previewChildIndex(2)).toBe(2);
    expect(previewChildIndex(5)).toBe(5);
    expect(previewChildIndex(0)).toBe(0);
    expect(previewChildIndex(-3)).toBe(0);
  });
});

describe('탭 줄 · 하단 띠 — 빈 자리 금지', () => {
  it('탭 4칸이 콘텐츠 폭을 채우고 잔여는 반올림 오차뿐이다', () => {
    expect(layout.tabs).toHaveLength(DEF_TAB_COUNT);
    expect(DEF_TAB_KEYS).toHaveLength(DEF_TAB_COUNT);
    for (const k of DEF_TAB_KEYS) expect(k.startsWith('def3.cmd.tab.')).toBe(true);
    // 보관함 탭 인덱스는 3 그대로다 — `모듈` 탭만 사라졌으므로 순서가 안 바뀐다.
    expect(DEF_TAB_INV).toBe(DEF_TAB_COUNT - 1);

    const first = layout.tabs[0];
    const last = layout.tabs[DEF_TAB_COUNT - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;
    expect(first.x).toBe(32);
    const contentRight = DESIGN_WIDTH - 32;
    expect(contentRight - (last.x + last.w)).toBeLessThan(DEF_TAB_COUNT);
    // 칸 사이 간격이 균일하다.
    for (let i = 1; i < layout.tabs.length; i++) {
      const a = layout.tabs[i - 1];
      const b = layout.tabs[i];
      if (a === undefined || b === undefined) continue;
      expect(b.x - (a.x + a.w)).toBe(12);
    }
  });

  it('하단 액션 버튼 셋이 콘텐츠 오른쪽 끝에 정확히 붙는다', () => {
    const btns = layout.footer.buttons;
    expect(btns).toHaveLength(3);
    const last = btns[btns.length - 1];
    const first = btns[0];
    expect(last).toBeDefined();
    expect(first).toBeDefined();
    if (last === undefined || first === undefined) return;
    // 오른쪽 끝 등호 — 버튼 폭을 바꾸면 여기서 깨진다(가운데 정렬로 되돌리면 좌우가 뜬다).
    expect(last.x + last.w).toBe(layout.footer.band.x + layout.footer.band.w);
    // 왼쪽에는 상태 문구가 앉을 자리가 남아야 한다(빈 자리가 아니라 쓰이는 자리다).
    expect(first.x - layout.footer.band.x).toBeGreaterThanOrEqual(300);
    for (const b of btns) {
      expect(b.y).toBe(layout.footer.band.y);
      expect(b.h).toBe(layout.footer.band.h);
    }
  });

  it('하단 띠 바닥이 화면 하단 여백 28 을 정확히 남긴다', () => {
    const band = layout.footer.band;
    expect(DESIGN_HEIGHT - (band.y + band.h)).toBe(28);
  });

  it('패널이 탭 줄과 하단 띠 사이 남는 세로를 전부 쓴다(하드코딩 금지)', () => {
    const left = layout.panels[0];
    const tab = layout.tabs[0];
    expect(left).toBeDefined();
    expect(tab).toBeDefined();
    if (left === undefined || tab === undefined) return;
    // 위·아래 틈이 각각 16 이고 그 사이는 전부 패널이다 — 등호라 죽은 자리가 생기면 깨진다.
    expect(left.rect.y - (tab.y + tab.h)).toBe(16);
    expect(layout.footer.band.y - (left.rect.y + left.rect.h)).toBe(16);
  });
});

describe('슬롯 패널 안 — 고정 블록이 상자를 뚫지 않는다', () => {
  it('L3 코어 블록 · L2 템플릿 줄이 상자 안에서 끝나고 목록이 남는다', () => {
    const box = DEFENSE_BOXES.right;
    for (const h of [DEFENSE_BOXES.coreBlockH, DEFENSE_BOXES.templateBlockH]) {
      const listTop = box.y + h + DEFENSE_BOXES.blockGap;
      expect(listTop).toBeLessThan(box.bottom);
      // 블록을 키우면 목록이 조용히 사라진다 — 최소 슬롯 3행(84px 하한)은 남아야 한다.
      expect(box.bottom - listTop).toBeGreaterThanOrEqual(84 * 3);
    }
  });

  it('슬롯 행 글자 폭이 이름을 담을 만큼 남는다(버튼 둘이 먹고 남는 자리)', () => {
    // 오른쪽 패널을 좁히면 이름이 조용히 뭉개진다(`label` 이 scale.x 로 눌러 버려 예외가 없다).
    expect(DEFENSE_BOXES.rowTextW).toBeGreaterThanOrEqual(360);
    expect(DEFENSE_BOXES.rowTextW).toBeLessThan(DEFENSE_BOXES.right.w);
  });
});

describe('크롬이 패널보다 위에 있다 — 구운 그림자가 클릭을 훔치지 못하게', () => {
  /**
   * 사용자 신고(2026-08-02) "탭 아래 절반이 클릭이 안 된다"의 실체.
   *
   * 실측 로그: `design=(1263,130)` → `TABHOST2/TABBTN2`(정상), `design=(1263,162)` → **화면 루트**.
   * 석재 패널은 접지 그림자·글로우를 텍스처에 구워 넣어 자기 사각보다 30px 가까이 **위로 번지고**,
   * 패널이 탭보다 나중에 추가돼 그 번짐이 탭 아래 절반을 덮고 있었다.
   *
   * 왜 "비상호작용이라 안 가린다"가 틀렸나: Pixi v8 은 자식을 역순으로 훑다가 **픽셀에 걸리면
   * 거기서 멈추고 가장 가까운 상호작용 조상**을 반환한다. 그림자가 passive 여도 탐색은 끝난다.
   *
   * 좌표로는 못 잡는 결함이라(번짐은 텍스처 안에 있고 레이아웃 값이 아니다) **조립 순서**를
   * 소스에서 직접 잠근다 — 이 리포가 `tests/m7bIntegration.test.ts` 에서 쓰는 선례와 같다.
   * ⚠️ 여백을 벌리는 것으로는 못 푼다: 번짐 폭은 패널 치수에서 파생돼 조용히 커진다.
   */
  const src = new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL('../src/ui/pixi/defenseCommand.ts', import.meta.url))),
  );
  const body = src.slice(src.indexOf('private buildChrome('), src.indexOf('private addPanel('));

  it('buildChrome 이 패널 4장을 세운 **뒤에** 헤더·탭·하단 띠를 붙인다', () => {
    const lastPanel = body.lastIndexOf('this.addPanel(');
    expect(lastPanel, 'buildChrome 안에서 addPanel 호출을 못 찾았다').toBeGreaterThan(-1);
    for (const chrome of ['this.buildHeader()', 'this.buildTabs()', 'this.buildFooter()']) {
      const at = body.indexOf(chrome);
      expect(at, `${chrome} 호출이 없다`).toBeGreaterThan(-1);
      expect(at, `${chrome} 가 패널보다 먼저 붙는다 — 패널 그림자가 클릭을 훔친다`).toBeGreaterThan(
        lastPanel,
      );
    }
  });

  it('팝업 host 는 크롬보다도 뒤다(팝업이 언제나 맨 앞)', () => {
    expect(body.indexOf('this.modalHost = modalHost')).toBeGreaterThan(body.indexOf('this.buildFooter()'));
  });
});

describe('목록 — 빈 자리 금지(행이 남는 세로를 나눠 갖는다)', () => {
  const gap = DEFENSE_BOXES.rowGap;

  it('짧은 목록이 영역을 채우고 잔여는 행 수 미만이다', () => {
    // 실화면 1차: L1 웨이브 6행이 684px 중 120px 을 빈 갈색 면으로 남겼다.
    const avail = DEFENSE_BOXES.right.h;
    const hs = fillRowHeights([84, 84, 100, 84, 84, 84], gap, avail, DEFENSE_BOXES.slotRowMaxH);
    const total = hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
    expect(total).toBeLessThanOrEqual(avail);
    expect(avail - total, '영역이 남는다').toBeLessThan(hs.length);
  });

  it('넘치는 목록은 그대로 둔다(스크롤이 받는다)', () => {
    const hs = fillRowHeights([200, 200, 200, 200], gap, 300, DEFENSE_BOXES.slotRowMaxH);
    expect(hs).toEqual([200, 200, 200, 200]);
  });

  it('상한을 넘겨 늘리지 않는다(1행짜리에서 거대한 행이 나오는 것을 막는다)', () => {
    const hs = fillRowHeights([76], gap, DEFENSE_BOXES.right.h, DEFENSE_BOXES.bpRowMaxH);
    expect(hs[0]).toBe(DEFENSE_BOXES.bpRowMaxH);
  });

  it('상한 때문에 남는 잔여는 꼬리 챔버가 받을 만큼 크다', () => {
    // 설계도 3장이 684px 중 436px 을 남겼다 — 상한을 걸면 여전히 남으므로 그 자리에
    // **이름을 준다**(파낸 챔버 + 어디서 얻는지). 잔여가 챔버 하한을 넘어야 그 처방이 돈다.
    const avail = DEFENSE_BOXES.right.h;
    const hs = fillRowHeights([76, 76, 76], gap, avail, DEFENSE_BOXES.bpRowMaxH);
    const total = hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
    expect(avail - total - gap).toBeGreaterThanOrEqual(DEFENSE_BOXES.tailWellMinH);
  });

  it('빈 배열·잘못된 가용 세로에서도 안전하다', () => {
    expect(fillRowHeights([], gap, 500, 100)).toEqual([]);
    expect(fillRowHeights([84, 84], gap, -10, 200)).toEqual([84, 84]);
  });
});

describe('팝업 — 높이를 내용에서 역산해 빈 자리가 0 이다', () => {
  const { boxY, edgePad } = DEFENSE_MODALS;

  it('방어체 고르기: 높이가 행 피치의 배수로 정확히 떨어진다', () => {
    const m = DEFENSE_MODALS.pick;
    for (let n = 1; n <= 12; n++) {
      const h = pickModalHeight(n);
      const inner = h - boxY - edgePad;
      expect((inner + m.rowGap) % m.pitch, `n=${n} 에서 반토막 행이 남는다`).toBe(0);
    }
  });

  it('방어체 고르기: 행 수가 [3, 7] 로 클램프된다', () => {
    const m = DEFENSE_MODALS.pick;
    const rowsOf = (h: number): number => (h - boxY - edgePad + m.rowGap) / m.pitch;
    expect(rowsOf(pickModalHeight(0))).toBe(m.rowsMin);
    expect(rowsOf(pickModalHeight(1))).toBe(m.rowsMin);
    expect(rowsOf(pickModalHeight(5))).toBe(5);
    expect(rowsOf(pickModalHeight(99))).toBe(m.rowsMax);
  });

  it('방어체 고르기: 최대 높이에서도 화면 안이다', () => {
    expect(pickModalHeight(DEFENSE_MODALS.pick.rowsMax)).toBeLessThanOrEqual(DESIGN_HEIGHT - 80);
    expect(DEFENSE_MODALS.pick.w).toBeLessThanOrEqual(DESIGN_WIDTH - 80);
  });

  it('강화 · 확인 팝업 높이가 세로 뭉치에서 정확히 역산된다(등호)', () => {
    expect(DEFENSE_MODALS.unit.h).toBe(boxY + DEFENSE_MODALS.unit.blockH + edgePad);
    expect(DEFENSE_MODALS.confirm.h).toBe(boxY + DEFENSE_MODALS.confirm.blockH + edgePad);
  });

  it('세 팝업의 콘텐츠 상자가 실제 패널 상자와 같다(복제 상수 드리프트)', () => {
    const cases: { w: number; h: number }[] = [
      { w: DEFENSE_MODALS.pick.w, h: pickModalHeight(5) },
      { w: DEFENSE_MODALS.unit.w, h: DEFENSE_MODALS.unit.h },
      { w: DEFENSE_MODALS.confirm.w, h: DEFENSE_MODALS.confirm.h },
    ];
    for (const c of cases) {
      const panel = makeCinematicPanel({ width: c.w, height: c.h, variant: 'slab', title: '팝업' });
      expect(panel.box.y).toBe(boxY);
      expect(panel.box.y + panel.box.h).toBe(c.h - edgePad);
      panel.destroy();
    }
  });

  it('팝업이 전부 화면 안에 들어간다', () => {
    for (const h of [pickModalHeight(7), DEFENSE_MODALS.unit.h, DEFENSE_MODALS.confirm.h]) {
      expect(h).toBeLessThan(DESIGN_HEIGHT);
    }
    for (const w of [DEFENSE_MODALS.pick.w, DEFENSE_MODALS.unit.w, DEFENSE_MODALS.confirm.w]) {
      expect(w).toBeLessThan(DESIGN_WIDTH);
    }
  });
});
