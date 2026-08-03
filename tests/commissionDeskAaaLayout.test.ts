/**
 * 지시 수신소의 **레이아웃 불변식** (2026-08-03 AAA 시네마틱 전환).
 *
 * ## 왜 좌표를 단위 테스트가 보는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고, 캔버스 없는
 * vitest 는 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. `commissionDeskLayout()` 이
 * 좌표를 순수 값으로 꺼내 두므로 겹침·화면 이탈·설정 톱니 예약 밴드 침범·제목 대역 침범을
 * 여기서 잠근다.
 *
 * ## 그리고 **빈 자리**·**베낀 상수의 드리프트**·**서버 계약 배선**
 * 옛 구현은 1200×830 패널 하나에 168px 짜리 두꺼운 행을 쌓고 좌우 720px 을 통째로 비웠다.
 * 2열이 폭/세로를 **등호로** 채우는지 되짚고, 화면 파일이 복제한 `cinematicPanel.ts` 의
 * `EDGE_PAD`/`CONTENT_GAP`/제목 띠 높이가 실제 `makeCinematicPanel(...).box` 와 같은지 대조한다
 * (복제본이 조용히 어긋나면 내용이 패널 테두리를 뚫는데 **예외도 로그도 없다**).
 *
 * 마지막으로 **봉인 로드아웃 호출 형태**를 소스에서 잠근다 — `buildRunConfig` 와 다른 함수·
 * 다른 인자로 뽑으면 정직한 런도 `commission-loadout-mismatch` 로 거부되는데, 그 결함은
 * 서버 왕복 없이는 어떤 단위 테스트에도 안 잡힌다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  commissionDeskLayout,
  DESK_BOXES,
  fillRowHeights,
  listFill,
  GEAR_BAND_W,
  GEAR_BAND_H,
  TITLE_BAND_HALF_W,
  PANEL_EDGE_PAD,
  PANEL_TITLE_BAND_H,
  PANEL_CONTENT_GAP,
} from '../src/ui/pixi/commissionDesk.js';
import { makeCinematicPanel } from '../src/ui/pixi/cinematicPanel.js';
import { COMMISSION_STOCK_CAP } from '../src/run/commissionServerConstants.js';
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

const layout = commissionDeskLayout();
const readSource = (rel: string): string =>
  new TextDecoder().decode(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const SRC = readSource('../src/ui/pixi/commissionDesk.ts');

describe('패널 콘텐츠 상자 기하 복제본이 실제 패널과 일치한다', () => {
  for (const id of ['list', 'detail'] as const) {
    it(`${id} 패널의 box 가 복제 상수로 계산한 값과 같다`, () => {
      const p = layout.panels.find((q) => q.id === id);
      expect(p).toBeDefined();
      if (p === undefined) return;
      const { w, h } = p.rect;
      const panel = makeCinematicPanel({ width: w, height: h, variant: 'slab', title: '지시 수신소' });
      expect(panel.box.x).toBe(PANEL_EDGE_PAD);
      expect(panel.box.y).toBe(PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP);
      expect(panel.box.w).toBe(w - PANEL_EDGE_PAD * 2);
      expect(panel.box.h).toBe(h - (PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP) - PANEL_EDGE_PAD);
      const box = DESK_BOXES[id];
      expect(box.x).toBe(panel.box.x);
      expect(box.y).toBe(panel.box.y);
      expect(box.w).toBe(panel.box.w);
      expect(box.h).toBe(panel.box.h);
      expect(box.bottom).toBe(panel.box.y + panel.box.h);
      panel.destroy();
    });
  }
});

describe('지시 수신소 레이아웃 불변식', () => {
  it('패널이 둘이고 상태와 무관하게 고정이다', () => {
    // `commissionDeskLayout()` 이 인자를 받지 않는 것 자체가 "기하가 보유 수·선택으로 갈리지
    // 않는다"는 계약이다(갈리면 조작 한 번마다 배경과 석재를 다시 굽는다).
    expect(layout.panels).toHaveLength(2);
    expect(layout.panels.map((p) => p.id)).toEqual(['list', 'detail']);
    expect(commissionDeskLayout).toHaveLength(0);
  });

  it('창을 뚫지 않는다(행성 자산은 64×64 오브뿐이다)', () => {
    // 창은 "배경이 보이는 구멍"이 아니라 "무언가를 보여주는 자리"다. 유일한 후보인 의뢰 대상
    // 행성은 `assets/ui_planet_*.png` 가 64px 정사각이고 그나마 6종 중 4종뿐이라, 개구부를
    // 채우면 17배 확대이고 자산 없는 행성을 고르면 창이 비는 것이 정상이 된다.
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
    // 폭 합 등호는 파생 보장이라 못 잡는 축이다. 여기서 잠그는 것은 ①목록 행에서 `계급 · 주문`
    // 이 쓸 글자 폭이 남는가 ②상세 챔버의 글줄 폭이 무대/제약 문구를 담을 만큼 남는가 —
    // 둘 다 넘치면 `label` 이 scale.x 로 눌러 버려 **예외 없이 조용히** 뭉개진다.
    //
    // ⚠️ 목록 열 폭(720) 자체를 못 박지 않는 것은 의도다 — 760 으로 바꾸는 뮤테이션은 살아
    // 돌아오는 게 **옳다**(그 값에서도 두 열이 다 담긴다). 여기가 잡는 것은 한쪽이 다른 쪽을
    // 못 담게 만드는 **극단**이고, 실제로 `LIST_W` 를 1200 까지 밀면 아래 챔버 폭이 깨진다.
    expect(DESK_BOXES.rowTextW).toBeGreaterThanOrEqual(400);
    expect(DESK_BOXES.rowTextW).toBeLessThan(DESK_BOXES.list.w);
    expect(DESK_BOXES.chamberTextW).toBeGreaterThanOrEqual(600);
    expect(DESK_BOXES.chamberTextW).toBeLessThan(DESK_BOXES.detail.w);
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
  it('[출격] 이 콘텐츠 오른쪽 끝에 정확히 붙고 왼쪽에 문구 자리가 남는다', () => {
    const btns = layout.footer.buttons;
    expect(btns).toHaveLength(1);
    const only = btns[0];
    expect(only).toBeDefined();
    if (only === undefined) return;
    expect(only.x + only.w).toBe(layout.footer.band.x + layout.footer.band.w);
    // 왼쪽에는 재고·상태 두 줄이 앉는다(빈 자리가 아니라 쓰이는 자리다).
    expect(only.x - layout.footer.band.x).toBeGreaterThanOrEqual(300);
    expect(only.y).toBe(layout.footer.band.y);
    expect(only.h).toBe(layout.footer.band.h);
  });

  it('하단 띠가 콘텐츠 폭을 채우고 바닥 여백 28 을 정확히 남긴다', () => {
    const band = layout.footer.band;
    expect(band.x).toBe(32);
    expect(band.x + band.w).toBe(DESIGN_WIDTH - 32);
    expect(DESIGN_HEIGHT - (band.y + band.h)).toBe(28);
  });

  it('패널이 톱니 밴드와 하단 띠 사이 남는 세로를 전부 쓴다(하드코딩 금지)', () => {
    const p = layout.panels[0];
    expect(p).toBeDefined();
    if (p === undefined) return;
    // 패널은 톱니 밴드 바로 아래 4px, 하단 띠와의 틈은 16 — 전부 등호라 죽은 자리가 생기면 깨진다.
    expect(p.rect.y - GEAR_BAND_H).toBe(4);
    expect(layout.footer.band.y - (p.rect.y + p.rect.h)).toBe(16);
  });
});

describe('패널 안 — 빈 자리 금지(행·챔버가 남는 세로를 나눠 갖는다)', () => {
  const gap = DESK_BOXES.rowGap;
  const avail = DESK_BOXES.list.h;

  /**
   * ⚠️ 이 화면의 **기본 상태는 보유 0** 이다(서버 원장이 정본이라 미로그인이면 항상 비어 있다).
   * 0 장은 목록 상자 전체를 챔버로 덮으므로 행 산술의 대상이 아니고, 여기서 보는 것은 **1장부터
   * 상한(12장)까지** 어느 보유 수에서도 목록에 빈 면이 남지 않는가다.
   */
  /**
   * ⚠️ **이 단언이 실제로 결함을 잡았다**(초판 구현, 2026-08-03): 1장만 보유하면 행이 상한
   * (120)에 먼저 걸려 목록 상자에 **636px 가 통째로 비었다**. 형제 화면들은 목록 길이가
   * 데이터로 고정(파일럿 7 · 파편 8)이라 `fillRowHeights` 만으로 채워졌지만, 보유 의뢰서는
   * 0..12 장으로 변한다 — 그래서 남는 자리를 **꼬리 챔버**가 받게 고쳤다(`listFill`).
   */
  it('보유 1..CAP 전 구간에서 행+꼬리 챔버가 목록 영역을 채운다(잔여 < 행 수)', () => {
    expect(COMMISSION_STOCK_CAP).toBe(DESK_BOXES.stockCap);
    for (let n = 1; n <= COMMISSION_STOCK_CAP; n++) {
      const { heights, tailH } = listFill(n);
      expect(heights).toHaveLength(n);
      const rows = heights.reduce((a, b) => a + b, 0) + gap * (n - 1);
      if (rows > avail) {
        // 상한 근처에서는 자연 높이만으로 상자를 넘긴다 — 그때는 스크롤이 받고, 행이 **깎이지
        // 않는** 것이 계약이다(깎이면 글자가 판 밖으로 튄다). 꼬리 챔버도 없다.
        expect(heights.every((h) => h === DESK_BOXES.rowH), `${n}장에서 행이 깎였다`).toBe(true);
        expect(tailH, `${n}장: 넘치는데 꼬리가 붙었다`).toBe(0);
        continue;
      }
      const used = rows + (tailH > 0 ? gap + tailH : 0);
      expect(used, `${n}장: 목록 상자를 넘는다`).toBeLessThanOrEqual(avail);
      expect(avail - used, `${n}장에서 이름 없는 빈 면이 남는다`).toBeLessThan(n);
    }
  });

  it('꼬리 챔버는 읽을 만한 크기일 때만 생긴다(3px 짜리 챔버 금지)', () => {
    for (let n = 1; n <= COMMISSION_STOCK_CAP; n++) {
      const { tailH } = listFill(n);
      if (tailH === 0) continue;
      expect(tailH, `${n}장: 꼬리가 너무 얇다`).toBeGreaterThanOrEqual(DESK_BOXES.chamberMinH);
    }
    // 보유 0 은 목록 상자 전체가 챔버다(이 화면의 **기본 상태** — 미로그인/오프라인).
    expect(listFill(0)).toEqual({ heights: [], tailH: avail });
  });

  it('넘치는 목록은 그대로 둔다(스크롤이 받는다)', () => {
    const hs = fillRowHeights([200, 200, 200, 200], gap, 300, DESK_BOXES.rowMaxH);
    expect(hs).toEqual([200, 200, 200, 200]);
  });

  it('상한을 넘겨 늘리지 않는다(1행짜리에서 거대한 행이 나오는 것을 막는다)', () => {
    const hs = fillRowHeights([DESK_BOXES.rowH], gap, avail, DESK_BOXES.rowMaxH);
    expect(hs[0]).toBe(DESK_BOXES.rowMaxH);
  });

  it('자연 높이가 상한보다 크면 **깎지 않는다**', () => {
    // `Math.min(maxH, h + add)` 만 쓰면 큰 행이 줄어들어 글자가 판 밖으로 삐져나온다(코어 모듈
    // 화면의 같은 산술 복제본에서 실제로 터졌다). 짧은 목록에서만 도달하는 가지라 눈으로만 잡힌다.
    const hs = fillRowHeights([300, 40], gap, 1000, 120);
    expect(hs[0]).toBe(300);
  });

  it('빈 배열·잘못된 가용 세로에서도 안전하다', () => {
    expect(fillRowHeights([], gap, 500, 100)).toEqual([]);
    expect(fillRowHeights([96, 96], gap, -10, 200)).toEqual([96, 96]);
  });

  it('상세 챔버 넷이 읽을 만한 세로를 받고 한 장이 전부를 먹지 않는다', () => {
    const box = DESK_BOXES.detail;
    const n = DESK_BOXES.chambers;
    expect(box.h).toBeGreaterThanOrEqual(DESK_BOXES.chamberMinH * n + DESK_BOXES.rowGap * (n - 1));
    // 상한이 없으면 한 장이 남는 세로를 통째로 먹는다 — 넷이 나눠 갖는지 되짚는다.
    expect(DESK_BOXES.chamberMaxH * n).toBeGreaterThan(box.h);
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

  it('buildChrome 이 패널 둘을 세운 **뒤에** 헤더·하단 띠를 붙인다', () => {
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

  it('main.ts 가 매 프레임 update 를 흘린다(빠뜨리면 연출이 통째로 멈춘다)', () => {
    expect(readSource('../src/main.ts')).toContain('commissionDesk.update(frame)');
  });
});

describe('기능 불변식 배선 — 서버 왕복 없이는 못 잡히는 것들', () => {
  it('봉인 로드아웃을 buildRunConfig 와 같은 함수·같은 인자로 뽑는다', () => {
    // 여기서 다르게 계산하면 **정직한 런도** `commission-loadout-mismatch` 로 거부된다.
    // 서버가 `loadout_sealed` 로 저장해 두었다가 제출 리플레이의 `config.loadout` 과 대조하기
    // 때문이다 — 클라 단위 테스트로는 절대 안 잡히는 축이라 호출 형태를 소스에서 못 박는다.
    expect(SRC).toContain(
      'commissionSealedLoadout(this.profile, row.payload.constraints?.equipRules)',
    );
  });

  it('출격 성공 시 **먼저 닫고** onLaunch 를 부른다(콜백을 미리 캡처한다)', () => {
    // `hide()` 가 `cb` 를 비우므로 캡처가 뒤로 밀리면 콜백이 통째로 사라진다.
    const fn = SRC.slice(SRC.indexOf('private async launch('), SRC.indexOf('// --- 공용 렌더 조각'));
    expect(fn).toMatch(/const cb = this\.cb;[\s\S]*this\.busy = true/);
    expect(fn).toMatch(/this\.hide\(\);\s*\n\s*cb\.onLaunch\(res\.runId, res\.payload\);/);
    // 재진입(동시 클릭) 가드가 함수 맨 앞에 있어야 한다.
    expect(fn.indexOf('if (this.busy) return;')).toBeGreaterThan(-1);
    expect(fn.indexOf('if (this.busy) return;')).toBeLessThan(fn.indexOf('const cb = this.cb;'));
  });

  it('비활성 [출격] 에 gold 톤을 쓰지 않는다(글자가 통째로 사라진다)', () => {
    // `setEnabled(false)` + `gold` 는 container alpha 0.4 + 어두운 갈색 라벨 + 그림자 꺼짐이
    // 겹쳐 라벨이 안 보이게 된다(실화면 확인). 비활성은 크림 라벨인 `stone` 이어야 한다.
    expect(SRC).toMatch(/tone: enabled \? 'gold' : 'stone'/);
  });

  it('hudEl 에 캔버스 가드를 붙이지 않는다(HUD 숨김이 통째로 죽는다)', () => {
    const fn = SRC.slice(SRC.indexOf('private hudEl('), SRC.indexOf('private hideRunHud('));
    expect(fn).toContain("typeof document === 'undefined'");
    expect(fn).not.toContain('createElement');
  });

  it('재화 칩을 두지 않는다(이 화면은 크레딧·광물을 쓰지 않는다)', () => {
    expect(SRC).not.toContain('makeCurrencyChip');
  });
});
