/**
 * 기록 보관소의 **레이아웃 불변식** (2026-08-03 AAA 시네마틱 전환).
 *
 * ## 왜 좌표를 단위 테스트가 보는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고, 캔버스 없는
 * vitest 는 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. `recordsArchiveLayout()` 이
 * 좌표를 순수 값으로 꺼내 두므로 겹침·화면 이탈·설정 톱니 예약 밴드 침범·제목 대역 침범을
 * 여기서 잠근다.
 *
 * ## 그리고 **탭 고정**·**빈 자리**·**베낀 상수의 드리프트**
 * 옛 구현은 탭이 셋이었고 그중 하나(프롤로그)는 내용이 버튼 하나뿐이라 1400×760 패널이 그것만을
 * 위해 있었다. 탭 수가 **상태와 무관하게 2 고정**임을 여기서 잠그고, 패널 열·탭 줄·하단 띠가
 * 폭/세로를 **등호로** 채우는지 되짚는다.
 *
 * 화면 파일이 `cinematicPanel.ts` 의 `EDGE_PAD`/`CONTENT_GAP`/제목 띠 높이를 **복제**해 두었다
 * (패널 상자는 런타임 객체인데 좌표 서술은 Pixi 없이 검증돼야 한다). 복제본이 조용히 어긋나면
 * 내용이 패널 테두리를 뚫는데 **예외도 로그도 없다** — 실제 `makeCinematicPanel(...).box` 와
 * 대조해 그 침묵을 막는다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  recordsArchiveLayout,
  ARCHIVE_BOXES,
  ARCHIVE_TAB_COUNT,
  fillRowHeights,
  GEAR_BAND_W,
  GEAR_BAND_H,
  TITLE_BAND_HALF_W,
  PANEL_EDGE_PAD,
  PANEL_TITLE_BAND_H,
  PANEL_CONTENT_GAP,
} from '../src/ui/pixi/recordsArchive.js';
import { makeCinematicPanel } from '../src/ui/pixi/cinematicPanel.js';
import { SHIP_STORIES, RECORD_SHARDS } from '../data/lore/index.js';
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

const layout = recordsArchiveLayout();

describe('패널 콘텐츠 상자 기하 복제본이 실제 패널과 일치한다', () => {
  for (const id of ['list', 'detail'] as const) {
    it(`${id} 패널의 box 가 복제 상수로 계산한 값과 같다`, () => {
      const p = layout.panels.find((q) => q.id === id);
      expect(p).toBeDefined();
      if (p === undefined) return;
      const { w, h } = p.rect;
      const panel = makeCinematicPanel({ width: w, height: h, variant: 'slab', title: '기록 보관소' });
      expect(panel.box.x).toBe(PANEL_EDGE_PAD);
      expect(panel.box.y).toBe(PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP);
      expect(panel.box.w).toBe(w - PANEL_EDGE_PAD * 2);
      expect(panel.box.h).toBe(h - (PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP) - PANEL_EDGE_PAD);
      // 화면 파일이 들고 있는 상자 서술도 같은 값이어야 한다.
      const box = ARCHIVE_BOXES[id];
      expect(box.x).toBe(panel.box.x);
      expect(box.y).toBe(panel.box.y);
      expect(box.w).toBe(panel.box.w);
      expect(box.h).toBe(panel.box.h);
      expect(box.bottom).toBe(panel.box.y + panel.box.h);
      panel.destroy();
    });
  }
});

describe('기록 보관소 레이아웃 불변식', () => {
  it('탭이 둘이고 상태와 무관하게 고정이다', () => {
    // 옛 구현은 탭이 셋이었고 프롤로그 탭 전체가 버튼 하나였다. `recordsArchiveLayout()` 이
    // 인자를 받지 않는 것 자체가 "기하가 상태로 갈리지 않는다"는 계약이다.
    expect(ARCHIVE_TAB_COUNT).toBe(2);
    expect(layout.tabs).toHaveLength(2);
    expect(layout.panels).toHaveLength(2);
    expect(layout.panels.map((p) => p.id)).toEqual(['list', 'detail']);
    expect(recordsArchiveLayout).toHaveLength(0);
  });

  it('창을 뚫지 않는다(초상은 128×128 이라 개구부를 못 채운다)', () => {
    // 창은 "배경이 보이는 구멍"이 아니라 "무언가를 보여주는 자리"다. 여기 유일한 후보인 기체
    // 초상은 원본이 128px 정사각이라 1094×702 개구부를 채우면 5.4배 확대로 뭉개지고, 기록 파편
    // 탭에는 세울 피사체가 아예 없다(두 탭이 같은 패널 기하를 써야 한다).
    expect(layout.windows).toHaveLength(0);
  });

  it('패널끼리 겹치지 않는다', () => {
    const [a, b] = layout.panels;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    expect(overlaps(a.rect, b.rect), `${a.id} 와 ${b.id} 가 겹친다`).toBe(false);
  });

  it('패널이 헤더 밴드를 침범하지 않고 화면 밖으로도 나가지 않는다', () => {
    for (const p of layout.panels) {
      expect(p.rect.y, `${p.id} 가 헤더 밴드를 덮는다`).toBeGreaterThanOrEqual(layout.headerH);
      expect(p.rect.x).toBeGreaterThanOrEqual(0);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(DESIGN_WIDTH);
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(DESIGN_HEIGHT);
    }
  });

  it('두 패널이 좌우 여백 32 안에서 화면 폭을 **정확히** 채우고 바닥이 같다', () => {
    const [a, b] = layout.panels;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    expect(a.rect.x).toBe(32);
    expect(b.rect.x + b.rect.w).toBe(DESIGN_WIDTH - 32);
    // 거터 28 — 남는 자리 없이 둘이 나눠 쓴다.
    // ⚠️ 우변 등호는 **항진에 가깝다**: 상세 열 폭이 파생값(`DETAIL_W = 1920 − 32 − DETAIL_X`)
    // 이라 목록 열을 어떻게 바꿔도 성립한다. 여백 어휘가 바뀌는 것만 잡는다. 실제로 깨질 수
    // 있는 축은 아래 "열이 내용을 담는다"다.
    expect(b.rect.x - (a.rect.x + a.rect.w)).toBe(28);
    expect(a.rect.y).toBe(b.rect.y);
    expect(a.rect.y + a.rect.h).toBe(b.rect.y + b.rect.h);
  });

  it('한 열을 넓혀 다른 열이 내용을 못 담게 만들 수 없다', () => {
    // 폭 합 등호는 파생 보장이라 못 잡는 축이다. 여기서 잠그는 것은 ①목록 행에서 이름·태그라인이
    // 쓸 글자 폭이 남는가 ②상세 열의 초상 블록 오른쪽에 이름이 들어갈 자리가 남는가 —
    // 둘 다 넘치면 `label` 이 scale.x 로 눌러 버려 조용히 뭉개진다(예외가 없다).
    //
    // ⚠️ 목록 열 폭 자체를 못 박지 않는 것은 의도다 — 720 을 760 으로 바꾸는 뮤테이션은 살아
    // 돌아오는 게 **옳다**(그 값에서도 두 열이 다 담긴다). 여기가 잡는 것은 한쪽이 다른 쪽을
    // 못 담게 만드는 **극단**이고, 실제로 `LIST_W` 를 1120 까지 밀면 아래 `infoW` 가 깨진다.
    expect(ARCHIVE_BOXES.storyTextW).toBeGreaterThanOrEqual(300);
    expect(ARCHIVE_BOXES.storyTextW).toBeLessThan(ARCHIVE_BOXES.list.w);
    const infoW = ARCHIVE_BOXES.detail.w - ARCHIVE_BOXES.portraitWell - ARCHIVE_BOXES.blockGap - 8;
    expect(infoW).toBeGreaterThanOrEqual(600);
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
    // 첫 탭이 x 32 라 **가로로 겹치므로** 탭 줄과 패널 줄도 함께 검사한다(헤더 104 아래로
    // 올리는 뮤테이션이 이 단언 없이는 통과한다).
    const band: Rect = { x: 0, y: 0, w: GEAR_BAND_W, h: GEAR_BAND_H };
    for (const c of layout.headerControls) {
      expect(overlaps(c.rect, band), `${c.id} 가 톱니 밴드에 걸린다`).toBe(false);
    }
    layout.tabs.forEach((r, i) => {
      expect(overlaps(r, band), `탭 ${i} 가 톱니 밴드에 걸린다`).toBe(false);
    });
    for (const p of layout.panels) {
      expect(overlaps(p.rect, band), `${p.id} 패널이 톱니 밴드에 걸린다`).toBe(false);
    }
  });
});

describe('탭 줄 · 하단 띠 · 패널 세로 — 빈 자리 금지', () => {
  it('탭 두 칸이 목록 열 폭을 정확히 나눠 쓴다', () => {
    const [a, b] = layout.tabs;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    expect(a.x).toBe(32);
    expect(a.w).toBe(b.w);
    // ⚠️ 이 등호는 **항진이다** — 간격도 탭 폭도 `TAB_GAP` 하나에서 파생되므로 그 상수를 어떻게
    // 흔들어도 성립한다(뮤테이션이 살아 돌아와 확인했다). 실제로 깨질 수 있는 축은 "간격이 0 이
    // 되어 두 탭이 한 덩어리로 보이는 것"이라 그것을 따로 잠근다.
    expect(b.x - (a.x + a.w)).toBe(ARCHIVE_BOXES.tabGap);
    expect(ARCHIVE_BOXES.tabGap).toBeGreaterThan(0);
    // 탭 줄이 목록 열 안에서 끝난다 — 넘치면 상세 열 위로 삐져나오고, 많이 남으면 죽은 자리다.
    const span = b.x + b.w - a.x;
    expect(span).toBeLessThanOrEqual(ARCHIVE_BOXES.listW);
    expect(ARCHIVE_BOXES.listW - span).toBeLessThan(ARCHIVE_TAB_COUNT);
  });

  it('진행 문구가 탭 줄 오른쪽 남는 자리를 정확히 받는다', () => {
    const last = layout.tabs[layout.tabs.length - 1];
    expect(last).toBeDefined();
    if (last === undefined) return;
    expect(overlaps(layout.progress, last), '진행 문구가 탭과 겹친다').toBe(false);
    expect(layout.progress.y).toBe(last.y);
    expect(layout.progress.h).toBe(last.h);
    // 오른쪽 끝 등호 — 콘텐츠 오른쪽 여백 32 를 정확히 남긴다.
    expect(layout.progress.x + layout.progress.w).toBe(DESIGN_WIDTH - 32);
    // 진행 문구는 상세 열 위에 앉는다(둘의 x 가 어긋나면 읽는 사람이 어느 열의 값인지 헷갈린다).
    const detail = layout.panels.find((p) => p.id === 'detail');
    expect(detail).toBeDefined();
    expect(layout.progress.x).toBe(detail?.rect.x);
  });

  it('하단 액션 버튼이 콘텐츠 오른쪽 끝에 정확히 붙는다', () => {
    const btns = layout.footer.buttons;
    expect(btns).toHaveLength(1);
    const only = btns[0];
    expect(only).toBeDefined();
    if (only === undefined) return;
    expect(only.x + only.w).toBe(layout.footer.band.x + layout.footer.band.w);
    // 왼쪽에는 부제가 앉을 자리가 남아야 한다(빈 자리가 아니라 쓰이는 자리다).
    expect(only.x - layout.footer.band.x).toBeGreaterThanOrEqual(300);
    expect(only.y).toBe(layout.footer.band.y);
    expect(only.h).toBe(layout.footer.band.h);
  });

  it('하단 띠 바닥이 화면 하단 여백 28 을 정확히 남긴다', () => {
    const band = layout.footer.band;
    expect(DESIGN_HEIGHT - (band.y + band.h)).toBe(28);
  });

  it('패널이 탭 줄과 하단 띠 사이 남는 세로를 전부 쓴다(하드코딩 금지)', () => {
    const p = layout.panels[0];
    const tab = layout.tabs[0];
    expect(p).toBeDefined();
    expect(tab).toBeDefined();
    if (p === undefined || tab === undefined) return;
    // 탭 줄은 톱니 밴드 바로 아래 4px, 패널은 탭 줄 아래 16px, 하단 띠와의 틈은 16 —
    // 전부 등호라 죽은 자리가 생기면 깨진다.
    expect(tab.y - GEAR_BAND_H).toBe(4);
    expect(p.rect.y - (tab.y + tab.h)).toBe(16);
    expect(layout.footer.band.y - (p.rect.y + p.rect.h)).toBe(16);
  });
});

describe('패널 안 — 빈 자리 금지(행이 남는 세로를 나눠 갖는다)', () => {
  const gap = ARCHIVE_BOXES.rowGap;
  const avail = ARCHIVE_BOXES.list.h;

  it('파일럿 파일 7행이 목록 영역을 채우고 잔여는 행 수 미만이다', () => {
    const hs = fillRowHeights(
      SHIP_STORIES.map(() => ARCHIVE_BOXES.storyRowH),
      gap,
      avail,
      ARCHIVE_BOXES.storyRowMaxH,
    );
    const total = hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
    expect(total).toBeLessThanOrEqual(avail);
    expect(avail - total, '목록에 빈 면이 남는다').toBeLessThan(hs.length);
    // 상한에 걸려 멈추면 그만큼이 통째로 빈 면이 된다 — 상한 전에 채워져야 한다.
    expect(hs.every((h) => h < ARCHIVE_BOXES.storyRowMaxH)).toBe(true);
  });

  it('기록 파편 8행이 목록 영역을 채우고 잔여는 행 수 미만이다', () => {
    const hs = fillRowHeights(
      RECORD_SHARDS.map(() => ARCHIVE_BOXES.shardRowH),
      gap,
      avail,
      ARCHIVE_BOXES.shardRowMaxH,
    );
    const total = hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
    expect(total).toBeLessThanOrEqual(avail);
    expect(avail - total, '목록에 빈 면이 남는다').toBeLessThan(hs.length);
    expect(hs.every((h) => h < ARCHIVE_BOXES.shardRowMaxH)).toBe(true);
  });

  it('넘치는 목록은 그대로 둔다(스크롤이 받는다)', () => {
    const hs = fillRowHeights([200, 200, 200, 200], gap, 300, ARCHIVE_BOXES.storyRowMaxH);
    expect(hs).toEqual([200, 200, 200, 200]);
  });

  it('상한을 넘겨 늘리지 않는다(1행짜리에서 거대한 행이 나오는 것을 막는다)', () => {
    const hs = fillRowHeights([84], gap, avail, ARCHIVE_BOXES.storyRowMaxH);
    expect(hs[0]).toBe(ARCHIVE_BOXES.storyRowMaxH);
  });

  it('자연 높이가 상한보다 크면 **깎지 않는다**', () => {
    // `Math.min(maxH, h + add)` 만 쓰면 큰 행이 줄어들어 글자가 판 밖으로 삐져나온다(코어 모듈
    // 화면의 같은 산술 복제본에서 실제로 터졌다). 짧은 목록에서만 도달하는 가지라 눈으로만 잡힌다.
    const hs = fillRowHeights([300, 40], gap, 1000, 132);
    expect(hs[0]).toBe(300);
  });

  it('빈 배열·잘못된 가용 세로에서도 안전하다', () => {
    expect(fillRowHeights([], gap, 500, 100)).toEqual([]);
    expect(fillRowHeights([96, 96], gap, -10, 200)).toEqual([96, 96]);
  });

  it('상세 열의 챕터 셋이 초상 블록 아래에서 읽을 만한 세로를 받는다', () => {
    // 초상 블록이 커지면 챕터가 조용히 뭉개진다 — 셋 다 최소 높이를 담을 자리가 남아야 한다.
    const box = ARCHIVE_BOXES.detail;
    const rest = box.h - ARCHIVE_BOXES.portraitWell - ARCHIVE_BOXES.blockGap;
    const chapters = SHIP_STORIES[0]?.chapters.length ?? 3;
    expect(rest).toBeGreaterThanOrEqual(
      ARCHIVE_BOXES.chapterMinH * chapters + ARCHIVE_BOXES.rowGap * (chapters - 1),
    );
    // 상한이 없으면 한 장이 남는 세로를 통째로 먹는다 — 셋이 나눠 갖는지도 되짚는다.
    expect(ARCHIVE_BOXES.chapterMaxH * chapters).toBeGreaterThan(rest);
  });

  it('상세 열의 파편 본문 챔버가 제목 챔버 아래 남는 세로를 전부 쓴다', () => {
    const box = ARCHIVE_BOXES.detail;
    const bodyH = box.h - ARCHIVE_BOXES.shardHeadH - ARCHIVE_BOXES.blockGap;
    expect(bodyH).toBeGreaterThan(0);
    // 등호 — 본문 챔버는 상자 바닥까지 내려간다(중간에 멈추면 그 아래가 빈 면이 된다).
    expect(ARCHIVE_BOXES.shardHeadH + ARCHIVE_BOXES.blockGap + bodyH).toBe(box.h);
  });
});

describe('크롬이 패널보다 위에 있다 — 구운 그림자가 클릭을 훔치지 못하게', () => {
  /**
   * 사용자 신고(2026-08-02, 방어 사령부) "탭 아래 절반이 클릭이 안 된다"의 실체.
   *
   * 석재 패널은 접지 그림자·글로우를 텍스처에 구워 넣어 자기 사각보다 30px 가까이 **위로 번지고**,
   * 패널이 크롬보다 나중에 추가되면 그 번짐이 위 컨트롤을 덮는다. Pixi v8 은 자식을 역순으로
   * 훑다가 **픽셀에 걸리면 거기서 멈추고 가장 가까운 상호작용 조상**을 반환하므로, 그림자가
   * passive 여도 탐색은 끝난다.
   *
   * 좌표로는 못 잡는 결함이라(번짐은 텍스처 안에 있고 레이아웃 값이 아니다) **조립 순서**를
   * 소스에서 직접 잠근다. ⚠️ 여백을 벌리는 것으로는 못 푼다.
   */
  const src = new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL('../src/ui/pixi/recordsArchive.ts', import.meta.url))),
  );
  const body = src.slice(src.indexOf('private buildChrome('), src.indexOf('private addPanel('));

  it('buildChrome 이 패널 둘을 세운 **뒤에** 헤더·탭·하단 띠를 붙인다', () => {
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

  it('main.ts 가 매 프레임 update 를 흘린다(빠뜨리면 연출이 통째로 멈춘다)', () => {
    const main = new TextDecoder().decode(
      readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url))),
    );
    expect(main).toContain('recordsArchive.update(frame)');
  });

  it('탭 흐림을 버튼이 아니라 host 에 건다(pointerout 이 alpha 를 되돌린다)', () => {
    // `PixiButton` 의 pointerover/out 이 자기 container.alpha 를 덮어쓰므로, 버튼에 걸면 마우스가
    // 한 번 스쳐 지나가기만 해도 미선택 흐림이 영영 풀린다(정제소·방어 사령부 실측).
    expect(src).toMatch(/e\.host\.alpha = active \? 1 : 0\.72/);
  });
});
