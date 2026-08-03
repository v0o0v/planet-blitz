/**
 * 성계 지도의 **레이아웃 불변식** (2026-08-03 AAA 시네마틱 전환).
 *
 * ## 왜 좌표를 단위 테스트가 보는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고, 캔버스 없는
 * vitest 는 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. `planetSelectLayout()` 이 좌표를
 * 순수 값으로 꺼내 두므로 겹침·화면 이탈·설정 톱니 예약 밴드 침범·제목 대역 침범을 여기서 잠근다.
 *
 * ## 그리고 이 화면에만 있는 축 — **창**
 * 형제 화면 일곱은 창을 뚫었다 뺐다(후보 자산이 64px 오브라 개구부를 채우면 17배 확대였다).
 * 여기는 뚫는다 — wang 타일셋이 행성 6종 전부에 있고 런과 같은 배율로 개구부를 채운다. 그래서
 * **개구부 기하가 계약**이 된다: 배경 `windows` 와 프리뷰 마스크가 정확히 같은 사각이어야 하고
 * (어긋나면 밝기 보존이 헛돈다), 프리뷰는 창 패널 **뒤**여야 한다(앞이면 개구부가 검은 사각).
 *
 * 마지막으로 **조립 순서**와 **출격 계약 배선**을 소스에서 잠근다 — 좌표로는 못 잡는 결함이고
 * (구운 그림자는 텍스처 안에 있다), 서버 왕복 없이는 어떤 단위 테스트에도 안 잡히는 축이다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  planetSelectLayout,
  arenaChildIndex,
  ARENA_VIEWPORT,
  STAR_BOXES,
  fillRowHeights,
  listFill,
  stageControlSpecs,
  stageRowWidth,
  GEAR_BAND_W,
  GEAR_BAND_H,
  TITLE_BAND_HALF_W,
  PANEL_EDGE_PAD,
  PANEL_TITLE_BAND_H,
  PANEL_CONTENT_GAP,
} from '../src/ui/pixi/planetSelect.js';
import { makeCinematicPanel, cinematicWindowOpening } from '../src/ui/pixi/cinematicPanel.js';
import { PLANETS } from '../data/planets.js';
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

function panelOf(id: string): Rect {
  const p = layout.panels.find((q) => q.id === id);
  if (p === undefined) throw new Error(`패널 ${id} 이 없다`);
  return p.rect;
}

const layout = planetSelectLayout();
const readSource = (rel: string): string =>
  new TextDecoder().decode(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const SRC = readSource('../src/ui/pixi/planetSelect.ts');

describe('패널 콘텐츠 상자 기하 복제본이 실제 패널과 일치한다', () => {
  for (const id of ['list', 'ops'] as const) {
    it(`${id} 패널의 box 가 복제 상수로 계산한 값과 같다`, () => {
      const { w, h } = panelOf(id);
      const panel = makeCinematicPanel({ width: w, height: h, variant: 'slab', title: '성계 지도' });
      expect(panel.box.x).toBe(PANEL_EDGE_PAD);
      expect(panel.box.y).toBe(PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP);
      expect(panel.box.w).toBe(w - PANEL_EDGE_PAD * 2);
      expect(panel.box.h).toBe(h - (PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP) - PANEL_EDGE_PAD);
      const box = STAR_BOXES[id];
      expect(box.x).toBe(panel.box.x);
      expect(box.y).toBe(panel.box.y);
      expect(box.w).toBe(panel.box.w);
      expect(box.h).toBe(panel.box.h);
      expect(box.bottom).toBe(panel.box.y + panel.box.h);
      panel.destroy();
    });
  }
});

describe('창 — 이 화면은 뚫는다(형제 일곱과 다른 유일한 축)', () => {
  it('창이 정확히 하나이고 전장 패널이 실제로 파낸 개구부와 같다', () => {
    // ⚠️ 콘텐츠 상자(`box`)가 아니다. 방어 사령부에서 `box` 에 맞췄더니 프레임과 그림 사이에
    // 위 16px·좌우·아래 17px 맨 배경 띠가 둘러 생겼다(사용자 신고).
    expect(layout.windows).toHaveLength(1);
    const arena = panelOf('arena');
    const opening = cinematicWindowOpening(arena.w, arena.h, true);
    expect(STAR_BOXES.arenaOpening).toEqual({ ...opening });
    expect(layout.windows[0]).toEqual({
      x: arena.x + opening.x,
      y: arena.y + opening.y,
      w: opening.w,
      h: opening.h,
    });
    // 프리뷰 마스크가 쓰는 사각과 배경 `windows` 가 같은 값이어야 밝기 보존이 헛돌지 않는다.
    expect(layout.windows[0]).toEqual({ ...ARENA_VIEWPORT });
  });

  it('개구부가 전장 패널 안에 완전히 들어간다', () => {
    const arena = panelOf('arena');
    const w = layout.windows[0];
    expect(w).toBeDefined();
    if (w === undefined) return;
    expect(w.x).toBeGreaterThanOrEqual(arena.x);
    expect(w.y).toBeGreaterThanOrEqual(arena.y);
    expect(w.x + w.w).toBeLessThanOrEqual(arena.x + arena.w);
    expect(w.y + w.h).toBeLessThanOrEqual(arena.y + arena.h);
    // 제목 띠(52) 아래에서 시작해야 각인 제목과 그림이 겹치지 않는다.
    expect(w.y - arena.y).toBeGreaterThanOrEqual(PANEL_TITLE_BAND_H);
  });

  it('개구부가 wang 타일(64px)을 확대 없이 여러 장 담는다', () => {
    // 창을 뚫는 근거 자체가 "확대가 없다"이다 — 개구부가 타일 몇 장도 못 담을 만큼 작아지면
    // 그 근거가 사라진다(그때는 창을 빼는 것이 옳다).
    const w = layout.windows[0];
    expect(w).toBeDefined();
    if (w === undefined) return;
    expect(Math.floor(w.w / 64)).toBeGreaterThanOrEqual(12);
    expect(Math.floor(w.h / 64)).toBeGreaterThanOrEqual(6);
  });

  it('프리뷰는 창 패널 **뒤**에 놓인다(앞이면 개구부가 검은 사각이 된다)', () => {
    // window 변종은 링만 굽고 안쪽을 파내므로 덮는 면 자체가 없다. 앞에 두면 프리뷰가 석재
    // 단면·안쪽 AO·유리 반사·바닥 스크림을 통째로 가린다(방어 사령부 실화면 확인).
    expect(arenaChildIndex(5)).toBe(5);
    expect(arenaChildIndex(0)).toBe(0);
    expect(SRC).toContain('this.root.setChildIndex(arena.view, arenaChildIndex(at));');
  });
});

describe('성계 지도 레이아웃 불변식', () => {
  it('패널이 셋이고 상태와 무관하게 고정이다', () => {
    // `planetSelectLayout()` 이 인자를 받지 않는 것 자체가 "기하가 선택 행성·단계로 갈리지
    // 않는다"는 계약이다(갈리면 조작 한 번마다 배경과 석재를 다시 굽는다).
    expect(layout.panels.map((p) => p.id)).toEqual(['list', 'arena', 'ops']);
    expect(planetSelectLayout).toHaveLength(0);
  });

  it('패널끼리 겹치지 않는다', () => {
    for (let i = 0; i < layout.panels.length; i++) {
      for (let j = i + 1; j < layout.panels.length; j++) {
        const a = layout.panels[i];
        const b = layout.panels[j];
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

  it('두 열이 좌우 여백 32 안에서 화면 폭을 **정확히** 채운다', () => {
    const list = panelOf('list');
    const arena = panelOf('arena');
    const ops = panelOf('ops');
    expect(list.x).toBe(32);
    expect(arena.x + arena.w).toBe(DESIGN_WIDTH - 32);
    expect(arena.x - (list.x + list.w)).toBe(28); // 거터 — 남는 자리 없이 둘이 나눠 쓴다
    expect(ops.x).toBe(arena.x);
    expect(ops.w).toBe(arena.w);
  });

  it('오른쪽 열의 세로 분할에 죽은 자리가 없다(전부 등호)', () => {
    const list = panelOf('list');
    const arena = panelOf('arena');
    const ops = panelOf('ops');
    expect(arena.y).toBe(list.y);
    // 전장 ↔ 출격 제원 사이는 여백 어휘 20 하나뿐이다.
    expect(ops.y - (arena.y + arena.h)).toBe(20);
    // 오른쪽 열 바닥이 목록 열 바닥과 정확히 같다 — 한쪽이 짧으면 그만큼 빈 면이 생긴다.
    expect(ops.y + ops.h).toBe(list.y + list.h);
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

  it('설정 톱니 예약 밴드(좌상단)에는 아무것도 두지 않는다', () => {
    // 톱니는 매 프레임 stage 최상위로 올라온다 — 여기에 컨트롤을 두면 통째로 클릭 불가가 된다.
    // 목록 패널이 x 32 라 **가로로 겹치므로**, 패널을 헤더(104) 아래로 올리는 뮤테이션은 이
    // 단언 없이는 통과한다(패널 y 는 톱니 밴드 120 아래여야 한다).
    const band: Rect = { x: 0, y: 0, w: GEAR_BAND_W, h: GEAR_BAND_H };
    for (const c of layout.headerControls) {
      expect(overlaps(c.rect, band), `${c.id} 가 톱니 밴드에 걸린다`).toBe(false);
    }
    for (const p of layout.panels) {
      expect(overlaps(p.rect, band), `${p.id} 패널이 톱니 밴드에 걸린다`).toBe(false);
    }
  });
});

describe('하단 띠 · 패널 세로 — 빈 자리 금지', () => {
  it('[장비 정비][출격] 이 오른쪽 끝에 붙고 겹치지 않으며 왼쪽에 문구 자리가 남는다', () => {
    const btns = layout.footer.buttons;
    expect(btns).toHaveLength(2);
    const [inv, launch] = btns;
    expect(inv).toBeDefined();
    expect(launch).toBeDefined();
    if (inv === undefined || launch === undefined) return;
    // 주 동작(출격)이 오른쪽 끝을 잡는다 — 손이 먼저 가는 자리다.
    expect(launch.x + launch.w).toBe(layout.footer.band.x + layout.footer.band.w);
    expect(inv.x + inv.w).toBeLessThanOrEqual(launch.x);
    expect(overlaps(inv, launch), '두 버튼이 겹친다').toBe(false);
    // 시각 무게: 보조 진입점이 주 동작보다 넓으면 무엇이 주 동작인지가 뒤집힌다.
    expect(inv.w).toBeLessThan(launch.w);
    // 왼쪽에는 meta 상태 줄과 선택 요약 두 줄이 앉는다(빈 자리가 아니라 쓰이는 자리다).
    expect(inv.x - layout.footer.band.x).toBeGreaterThanOrEqual(300);
    for (const b of btns) {
      expect(b.y).toBe(layout.footer.band.y);
      expect(b.h).toBe(layout.footer.band.h);
    }
  });

  it('하단 띠가 콘텐츠 폭을 채우고 바닥 여백 28 을 정확히 남긴다', () => {
    const band = layout.footer.band;
    expect(band.x).toBe(32);
    expect(band.x + band.w).toBe(DESIGN_WIDTH - 32);
    expect(DESIGN_HEIGHT - (band.y + band.h)).toBe(28);
  });

  it('패널이 톱니 밴드와 하단 띠 사이 남는 세로를 전부 쓴다(하드코딩 금지)', () => {
    const list = panelOf('list');
    // 패널은 톱니 밴드 바로 아래 4px, 하단 띠와의 틈은 16 — 전부 등호라 죽은 자리가 생기면 깨진다.
    expect(list.y - GEAR_BAND_H).toBe(4);
    expect(layout.footer.band.y - (list.y + list.h)).toBe(16);
  });
});

describe('패널 안 — 빈 자리 금지(행·챔버가 남는 세로를 나눠 갖는다)', () => {
  const gap = STAR_BOXES.rowGap;
  const avail = STAR_BOXES.list.h;

  it('행성 수가 1..24 로 변해도 행+꼬리 챔버가 목록 영역을 채운다(잔여 < 행 수)', () => {
    for (let n = 1; n <= 24; n++) {
      const { heights, tailH } = listFill(n);
      expect(heights).toHaveLength(n);
      const rows = heights.reduce((a, b) => a + b, 0) + gap * (n - 1);
      if (rows > avail) {
        // 많아지면 자연 높이만으로 상자를 넘긴다 — 그때는 스크롤이 받고 행이 **깎이지 않는**
        // 것이 계약이다(깎이면 글자가 판 밖으로 튄다). 꼬리 챔버도 없다.
        expect(heights.every((h) => h === STAR_BOXES.rowH), `${n}개에서 행이 깎였다`).toBe(true);
        expect(tailH, `${n}개: 넘치는데 꼬리가 붙었다`).toBe(0);
        continue;
      }
      const used = rows + (tailH > 0 ? gap + tailH : 0);
      expect(used, `${n}개: 목록 상자를 넘는다`).toBeLessThanOrEqual(avail);
      expect(avail - used, `${n}개에서 이름 없는 빈 면이 남는다`).toBeLessThan(n);
    }
  });

  it('실제 행성 수에서는 행만으로 채워져 꼬리가 안 생긴다', () => {
    // 레지스트리에 행성이 늘거나 줄면 이 값이 바뀔 수 있다 — 그래도 위 전 구간 단언이 빈 면을
    // 막으므로 여기서 보는 것은 "지금 화면이 실제로 어떤 모양인가"다.
    const { heights, tailH } = listFill(PLANETS.length);
    expect(STAR_BOXES.planets).toBe(PLANETS.length);
    expect(tailH).toBe(0);
    expect(heights.every((h) => h > STAR_BOXES.rowH)).toBe(true);
    expect(heights.every((h) => h <= STAR_BOXES.rowMaxH)).toBe(true);
  });

  it('꼬리 챔버는 읽을 만한 크기일 때만 생긴다(3px 짜리 챔버 금지)', () => {
    for (let n = 1; n <= 24; n++) {
      const { tailH } = listFill(n);
      if (tailH === 0) continue;
      expect(tailH, `${n}개: 꼬리가 너무 얇다`).toBeGreaterThanOrEqual(96);
    }
    expect(listFill(0)).toEqual({ heights: [], tailH: avail });
  });

  it('넘치는 목록은 그대로 둔다(스크롤이 받는다)', () => {
    expect(fillRowHeights([200, 200, 200, 200], gap, 300, STAR_BOXES.rowMaxH)).toEqual([
      200, 200, 200, 200,
    ]);
  });

  it('상한을 넘겨 늘리지 않는다(1행짜리에서 거대한 행이 나오는 것을 막는다)', () => {
    expect(fillRowHeights([STAR_BOXES.rowH], gap, avail, STAR_BOXES.rowMaxH)[0]).toBe(
      STAR_BOXES.rowMaxH,
    );
  });

  it('자연 높이가 상한보다 크면 **깎지 않는다**', () => {
    // `Math.min(maxH, h + add)` 만 쓰면 큰 행이 줄어들어 글자가 판 밖으로 삐져나온다
    // (`modulesView.ts` 의 같은 산술 복제본에서 실제로 터졌다).
    expect(fillRowHeights([300, 40], gap, 1000, 120)[0]).toBe(300);
  });

  it('빈 배열·잘못된 가용 세로에서도 안전하다', () => {
    expect(fillRowHeights([], gap, 500, 100)).toEqual([]);
    expect(fillRowHeights([96, 96], gap, -10, 200)).toEqual([96, 96]);
  });

  it('목록 행이 오브·배율을 빼고도 이름·부제를 담을 폭을 남긴다', () => {
    // 폭 합 등호는 파생 보장이라 못 잡는 축이다. 여기서 잠그는 것은 "목록 열을 좁히면 부제가
    // 조용히 눌린다"이고, `label` 은 넘치면 예외 없이 scale.x 로 눌러 버린다.
    expect(STAR_BOXES.rowTextW).toBeGreaterThanOrEqual(220);
    expect(STAR_BOXES.rowTextW).toBeLessThan(STAR_BOXES.list.w);
  });

  it('출격 제원 상자를 챔버 둘이 정확히 나눠 갖고 조절 행이 그 안에 들어간다', () => {
    expect(STAR_BOXES.stageChW + STAR_BOXES.chamberGap + STAR_BOXES.catChW).toBe(STAR_BOXES.ops.w);
    const innerW = STAR_BOXES.stageChW - STAR_BOXES.chamberPad * 2;
    for (const cap of [10, 100, 999]) {
      expect(stageRowWidth(stageControlSpecs(1, cap))).toBeLessThanOrEqual(innerW);
    }
  });
});

describe('크롬이 패널보다 위에 있다 — 구운 그림자가 클릭을 훔치지 못하게', () => {
  /**
   * 사용자 신고(2026-08-02, 방어 사령부) "탭 아래 절반이 클릭이 안 된다"의 실체.
   *
   * 석재 패널은 접지 그림자·글로우를 텍스처에 구워 넣어 자기 사각보다 30px 가까이 **번지고**,
   * 패널이 크롬보다 나중에 추가되면 그 번짐이 위 컨트롤을 덮는다. Pixi v8 은 자식을 역순으로
   * 훑다가 **픽셀에 걸리면 거기서 멈추고 가장 가까운 상호작용 조상**을 반환하므로, 그림자가
   * passive 여도 탐색은 끝난다.
   *
   * 좌표로는 못 잡는 결함이라(번짐은 텍스처 안에 있고 레이아웃 값이 아니다) **조립 순서**를
   * 소스에서 직접 잠근다. ⚠️ 여백을 벌리는 것으로는 못 푼다.
   */
  const body = SRC.slice(SRC.indexOf('private buildChrome('), SRC.indexOf('private addPanel('));

  it('buildChrome 이 패널 셋을 세운 **뒤에** 헤더·하단 띠를 붙인다', () => {
    const lastPanel = body.lastIndexOf('this.addPanel(');
    expect(lastPanel, 'buildChrome 안에서 addPanel 호출을 못 찾았다').toBeGreaterThan(-1);
    for (const chrome of ['this.buildHeader()', 'this.buildFooter()']) {
      const at = body.indexOf(chrome);
      expect(at, `${chrome} 호출이 없다`).toBeGreaterThan(-1);
      expect(at, `${chrome} 가 패널보다 먼저 붙는다 — 패널 그림자가 클릭을 훔친다`).toBeGreaterThan(
        lastPanel,
      );
    }
  });

  it('전장 프리뷰는 패널보다 **먼저** 붙는다(배경과 패널 사이)', () => {
    const at = body.indexOf('this.root.addChild(arena.view)');
    expect(at, '프리뷰를 root 에 붙이는 호출이 없다').toBeGreaterThan(-1);
    expect(at).toBeLessThan(body.indexOf('this.addPanel('));
  });

  it('main.ts 가 매 프레임 update 를 흘린다(빠뜨리면 연출이 통째로 멈춘다)', () => {
    // ⚠️ `toContain('planetSelect.update(frame)')` 로는 **부족하다** — 그 호출을 주석 처리하는
    // 뮤테이션이 살아 돌아온다(주석 줄도 문자열을 품는다). 줄 맨 앞이 호출이어야 한다.
    expect(readSource('../src/main.ts')).toMatch(/^[ \t]*planetSelect\.update\(frame\);/m);
  });
});

describe('기능 불변식 배선 — 실화면·서버 없이는 못 잡히는 것들', () => {
  it('출격은 **먼저 닫고** 콜백을 부른다(콜백을 미리 캡처한다)', () => {
    // `hide()` 가 `onLaunch` 를 비우므로 캡처가 뒤로 밀리면 콜백이 통째로 사라진다.
    const fn = SRC.slice(SRC.indexOf('private launch('), SRC.indexOf('private back('));
    expect(fn).toMatch(/const cb = this\.onLaunch;/);
    expect(fn).toMatch(/this\.hide\(\);\s*\n\s*cb\?\.\(sel\);/);
    // sel 은 여기서 조립되는 유일한 형태다 — 여기서 config 를 손대면 정직한 런이 거부된다.
    expect(fn).toContain('...(cats.length > 0 ? { catalysts: cats } : {})');
  });

  it('현재 값 칸에 setEnabled(false) 를 쓰지 않는다(금색 + alpha 0.4 = 글자 실종)', () => {
    // `setEnabled(false)` 는 container alpha 를 0.4 로 낮추고 그림자를 끈다 — 금색 바탕 +
    // 어두운 라벨과 겹치면 라벨이 통째로 안 보인다(형제 화면 실화면 확인).
    const fn = SRC.slice(
      SRC.indexOf('private renderStageChamber('),
      SRC.indexOf('private renderCatalystChamber('),
    );
    expect(fn).toMatch(/tone: spec\.current === true \? 'gold' : 'stone'/);
    expect(fn).toMatch(/if \(spec\.current === true\) \{[\s\S]*?\} else if \(!spec\.enabled\) \{/);
    // 현재 값 칸은 흐려지는 것이 아니라 눌리지 않는 것이다.
    expect(fn).toContain("btn.container.eventMode = 'none';");
  });

  it('hudEl 에 캔버스 가드를 붙이지 않는다(HUD 숨김이 통째로 죽는다)', () => {
    const fn = SRC.slice(SRC.indexOf('private hudEl('), SRC.indexOf('private hideRunHud('));
    expect(fn).toContain("typeof document === 'undefined'");
    expect(fn).not.toContain('createElement');
  });

  it('재화 칩을 두지 않는다(출격은 무료고 촉매는 아이템을 쓴다)', () => {
    expect(SRC).not.toContain('makeCurrencyChip');
  });

  it('나무 UI 킷 패널·배너·카드를 더 이상 쓰지 않는다', () => {
    for (const gone of ['nineSlicePanel', 'makeBanner', 'makePanelCard', 'ui_btn_wood.png']) {
      expect(SRC, `${gone} 가 남아 있다`).not.toContain(gone);
    }
  });
});
