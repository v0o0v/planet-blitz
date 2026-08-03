/**
 * 코어 모듈 화면의 **레이아웃 불변식** (2026-08-03 AAA 시네마틱 전환).
 *
 * ## 왜 좌표를 단위 테스트가 보는가
 * 이 리포는 "겹치면 안 되는 세로 띠"가 실제로 겹친 결함을 격납고 헤더에서 겪었고, 캔버스 없는
 * vitest 는 화면을 세울 수 없어 그 유형이 **눈으로만** 잡힌다. `coreModulesLayout()` 이 좌표를
 * 순수 값으로 꺼내 두므로 겹침·화면 이탈·설정 톱니 예약 밴드 침범·제목 대역 침범을 여기서 잠근다.
 *
 * ## 그리고 **빈 자리**와 **베낀 상수의 드리프트**
 * 형제 화면 여섯이 전부 실화면에서 "쓸모도 볼거리도 아닌 자리"를 잡아 고쳤다. 여기서는 패널
 * 3열과 하단 띠가 콘텐츠 폭/세로를 **등호로** 채우고, 분해 확인 팝업은 높이를 내용에서 역산해
 * 버려지는 세로가 0 이다 — 전부 여기서 잠근다.
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
  coreModulesLayout,
  MODULES_BOXES,
  MODULES_MODAL,
  salvageModalHeight,
  salvageModalBlockH,
  fillRowHeights,
  GEAR_BAND_W,
  GEAR_BAND_H,
  TITLE_BAND_HALF_W,
  PANEL_EDGE_PAD,
  PANEL_TITLE_BAND_H,
  PANEL_CONTENT_GAP,
} from '../src/ui/pixi/modulesView.js';
import { makeCinematicPanel } from '../src/ui/pixi/cinematicPanel.js';
import { MODULE_EQUIP_SLOTS } from '../data/coreModules.js';
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

const layout = coreModulesLayout();
const BOX_IDS = ['slots', 'inventory', 'shop'] as const;

describe('패널 콘텐츠 상자 기하 복제본이 실제 패널과 일치한다', () => {
  for (const id of BOX_IDS) {
    it(`${id} 패널의 box 가 복제 상수로 계산한 값과 같다`, () => {
      const p = layout.panels.find((q) => q.id === id);
      expect(p).toBeDefined();
      if (p === undefined) return;
      const { w, h } = p.rect;
      const panel = makeCinematicPanel({ width: w, height: h, variant: 'slab', title: '코어 모듈' });
      expect(panel.box.x).toBe(PANEL_EDGE_PAD);
      expect(panel.box.y).toBe(PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP);
      expect(panel.box.w).toBe(w - PANEL_EDGE_PAD * 2);
      expect(panel.box.h).toBe(h - (PANEL_TITLE_BAND_H + PANEL_CONTENT_GAP) - PANEL_EDGE_PAD);
      // 화면 파일이 들고 있는 상자 서술도 같은 값이어야 한다.
      const box = MODULES_BOXES[id];
      expect(box.x).toBe(panel.box.x);
      expect(box.y).toBe(panel.box.y);
      expect(box.w).toBe(panel.box.w);
      expect(box.h).toBe(panel.box.h);
      expect(box.bottom).toBe(panel.box.y + panel.box.h);
      panel.destroy();
    });
  }
});

describe('코어 모듈 레이아웃 불변식', () => {
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

  it('세 패널이 좌우 여백 32 · 거터 28 로 화면 폭을 정확히 채우고 바닥이 같다', () => {
    const [a, b, c] = BOX_IDS.map((id) => layout.panels.find((p) => p.id === id));
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    if (a === undefined || b === undefined || c === undefined) return;
    expect(a.rect.x).toBe(32);
    expect(c.rect.x + c.rect.w).toBe(DESIGN_WIDTH - 32); // 오른쪽 끝 등호 — 남으면 죽은 자리다
    expect(b.rect.x - (a.rect.x + a.rect.w)).toBe(28);
    expect(c.rect.x - (b.rect.x + b.rect.w)).toBe(28);
    for (const p of [a, b, c]) {
      expect(p.rect.y).toBe(a.rect.y);
      expect(p.rect.y + p.rect.h).toBe(a.rect.y + a.rect.h);
    }
  });

  it('패널이 톱니 밴드 아래에서 시작해 하단 띠까지 남는 세로를 전부 쓴다(하드코딩 금지)', () => {
    const p = layout.panels[0];
    expect(p).toBeDefined();
    if (p === undefined) return;
    // 헤더(104)가 아니라 **톱니 밴드(120) 아래**여야 한다 — 첫 패널이 x32 라 톱니와 가로로 겹친다.
    expect(p.rect.y).toBeGreaterThanOrEqual(GEAR_BAND_H);
    // 아래 틈은 16 이고 그 사이는 전부 패널이다 — 등호라 죽은 자리가 생기면 깨진다.
    expect(layout.footer.band.y - (p.rect.y + p.rect.h)).toBe(16);
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

  it('설정 톱니 예약 밴드(좌상단)에는 컨트롤도 패널도 두지 않는다', () => {
    // 톱니는 매 프레임 stage 최상위로 올라온다 — 여기에 무언가를 두면 통째로 클릭 불가가 된다.
    const band: Rect = { x: 0, y: 0, w: GEAR_BAND_W, h: GEAR_BAND_H };
    for (const c of layout.headerControls) {
      expect(overlaps(c.rect, band), `${c.id} 가 톱니 밴드에 걸린다`).toBe(false);
    }
    for (const p of layout.panels) {
      expect(overlaps(p.rect, band), `${p.id} 패널이 톱니 밴드에 걸린다`).toBe(false);
    }
  });

  it('배경 창은 **하나도 없다**(형제 화면 둘과 갈리는 지점)', () => {
    // 창은 "배경이 보이는 구멍"이 아니라 "무언가를 보여주는 자리"다. 코어 모듈은 아이콘도 3D 도
    // 없는 순수 수치 인스턴스라 세울 피사체가 없다 — 뚫으면 배경만 보이는 구멍이 된다.
    expect(layout.windows).toHaveLength(0);
  });
});

describe('하단 액션 띠 — 빈 자리 금지', () => {
  it('버튼 자리 둘이 콘텐츠 오른쪽 끝에 정확히 붙는다', () => {
    const slots = layout.footer.slots;
    expect(slots).toHaveLength(2);
    const [side, main] = slots;
    expect(side).toBeDefined();
    expect(main).toBeDefined();
    if (side === undefined || main === undefined) return;
    // 오른쪽 끝 등호 — 폭을 바꾸면 여기서 깨진다(가운데 정렬로 되돌리면 좌우가 뜬다).
    expect(main.x + main.w).toBe(layout.footer.band.x + layout.footer.band.w);
    expect(main.x - (side.x + side.w)).toBe(16);
    // 왼쪽에는 보관 게이지 + 상태 문구가 앉을 자리가 남아야 한다(빈 자리가 아니라 쓰이는 자리다).
    expect(side.x - layout.footer.band.x).toBeGreaterThanOrEqual(600);
    for (const s of slots) {
      expect(s.y).toBe(layout.footer.band.y);
      expect(s.h).toBe(layout.footer.band.h);
    }
  });

  it('두 자리의 폭이 합성 모드와 무관하게 고정이다(버튼이 좌우로 튀지 않는다)', () => {
    // 비합성 = [안내 문구 w200][합성 시작 w300] · 합성 중 = [취소 w200][합성 확정 w300].
    // 모드마다 폭이 달라지면 오른쪽 끝 등호가 깨지고 화면에서 버튼이 튄다 — 소스에서 잠근다.
    const src = new TextDecoder().decode(
      readFileSync(fileURLToPath(new URL('../src/ui/pixi/modulesView.ts', import.meta.url))),
    );
    const body = src.slice(src.indexOf('private renderFooter('), src.indexOf('// --- 코어 모듈 슬롯'));
    // 하단 띠 버튼은 전부 두 상수만 폭으로 쓴다(숫자 리터럴 폭이 끼어들면 자리가 어긋난다).
    const widths = [...body.matchAll(/width:\s*([A-Za-z_][\w.]*|\d+)/g)].map((m) => m[1]);
    expect(widths.length).toBeGreaterThanOrEqual(3);
    for (const w of widths) expect(['FUSE_MAIN_W', 'FUSE_SIDE_W']).toContain(w);
  });

  it('하단 띠 바닥이 화면 하단 여백 28 을 정확히 남긴다', () => {
    const band = layout.footer.band;
    expect(DESIGN_HEIGHT - (band.y + band.h)).toBe(28);
  });
});

describe('패널 안 — 행 글자 폭이 이름을 담을 만큼 남는다', () => {
  it('버튼이 먹고 남는 글자 폭에 하한이 있다', () => {
    // 열을 좁히면 이름·어픽스가 조용히 뭉개진다(`label` 이 scale.x 로 눌러 버려 예외가 없다).
    expect(MODULES_BOXES.slotRowTextW).toBeGreaterThanOrEqual(240);
    expect(MODULES_BOXES.invRowTextW).toBeGreaterThanOrEqual(400);
    expect(MODULES_BOXES.shopRowTextW).toBeGreaterThanOrEqual(400);
    for (const id of BOX_IDS) {
      const key = id === 'slots' ? 'slotRowTextW' : id === 'inventory' ? 'invRowTextW' : 'shopRowTextW';
      expect(MODULES_BOXES[key]).toBeLessThanOrEqual(MODULES_BOXES[id].w);
    }
  });
});

describe('목록 — 빈 자리 금지(행이 남는 세로를 나눠 갖는다)', () => {
  const gap = MODULES_BOXES.rowGap;

  it('슬롯 2칸이 상한까지 늘어나고 남은 자리는 꼬리 챔버가 받을 만큼 크다', () => {
    // 슬롯은 `MODULE_EQUIP_SLOTS` 라 **원리적으로** 세로를 못 채운다 — 상한까지 늘린 뒤 남는
    // 자리에 "자동 발동"이라는 이름을 준다. 잔여가 챔버 하한을 넘어야 그 처방이 돈다.
    const avail = MODULES_BOXES.slots.h;
    const hs = fillRowHeights(
      new Array<number>(MODULE_EQUIP_SLOTS).fill(96),
      gap,
      avail,
      MODULES_BOXES.slotRowMaxH,
    );
    expect(hs).toEqual(new Array<number>(MODULE_EQUIP_SLOTS).fill(MODULES_BOXES.slotRowMaxH));
    const total = hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
    expect(avail - total - gap).toBeGreaterThanOrEqual(MODULES_BOXES.tailWellMinH);
  });

  it('상점 최소 재고(4칸)가 상한까지 늘어나 죽은 띠를 남기지 않는다', () => {
    // 재고는 4~6칸(`MODULE_SHOP_NORMAL_RANGE [3,4]` + `MODULE_SHOP_MAGIC_RANGE [1,2]`)이고
    // 자연 높이는 어픽스 한 줄 기준 약 146 이다. **4칸이 최악(가장 많이 남는) 경우**다.
    const avail = MODULES_BOXES.shop.h;
    const hs = fillRowHeights([146, 146, 146, 146], gap, avail, MODULES_BOXES.shopRowMaxH);
    expect(hs.every((h) => h <= MODULES_BOXES.shopRowMaxH), '상한을 넘겨 늘렸다').toBe(true);
    const total = hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
    expect(total).toBeLessThanOrEqual(avail);
    // 잔여가 챔버 하한 미만 = 그냥 패널 아래 여백이다(`TAIL_WELL_MIN_H` 정의). 상한을 낮추면
    // 여기서 죽은 띠가 생겨 빨개진다 — 그 경우 꼬리 챔버가 받아야 하므로 처방을 다시 골라야 한다.
    expect(avail - total - gap, '상한이 낮아 죽은 띠가 생겼다').toBeLessThan(
      MODULES_BOXES.tailWellMinH,
    );
  });

  it('상점 재고가 5칸 이상이면 넘쳐서 스크롤이 받는다(억지로 줄이지 않는다)', () => {
    const avail = MODULES_BOXES.shop.h;
    for (const n of [5, 6]) {
      const nat = new Array<number>(n).fill(146);
      expect(fillRowHeights(nat, gap, avail, MODULES_BOXES.shopRowMaxH), `n=${n}`).toEqual(nat);
    }
  });

  it('보관함 20칸은 넘쳐서 스크롤이 받는다(늘리지 않는다)', () => {
    const hs = fillRowHeights(new Array<number>(20).fill(90), gap, MODULES_BOXES.inventory.h, MODULES_BOXES.invRowMaxH);
    expect(hs).toEqual(new Array<number>(20).fill(90));
  });

  it('짧은 목록이 영역을 채우고 잔여는 행 수 미만이다', () => {
    const avail = MODULES_BOXES.inventory.h;
    const hs = fillRowHeights([80, 80, 96, 80, 80, 80, 80], gap, avail, MODULES_BOXES.invRowMaxH);
    const total = hs.reduce((a, b) => a + b, 0) + gap * (hs.length - 1);
    expect(total).toBeLessThanOrEqual(avail);
    expect(avail - total, '영역이 남는다').toBeLessThan(hs.length);
  });

  it('상한을 넘겨 늘리지 않는다(1행짜리에서 거대한 행이 나오는 것을 막는다)', () => {
    const hs = fillRowHeights([80], gap, MODULES_BOXES.inventory.h, MODULES_BOXES.invRowMaxH);
    expect(hs[0]).toBe(MODULES_BOXES.invRowMaxH);
  });

  it('⚠️ 상한이 자연 높이를 **깎지 않는다**(내용이 판 밖으로 나간다)', () => {
    /*
     * 실화면 2차에서 잡은 결함. 효과를 수치로 적기 시작하자 슬롯 행 자연 높이가 상한(240)을
     * 넘겼는데 `Math.min(maxH, ...)` 만 쓰고 있어 행이 **줄어들었고**, [해제] 버튼이 판 아래로
     * 반쯤 튀어나온 채 찍혔다. 목록이 짧을 때만 나타난다 — 길면 위 `total >= avail` 가지에서
     * 그대로 반환되므로 이 경로를 안 탄다.
     */
    const tall = 300;
    const hs = fillRowHeights([tall, 96], gap, MODULES_BOXES.slots.h, MODULES_BOXES.slotRowMaxH);
    expect(hs[0], '자연 높이가 상한 때문에 깎였다').toBeGreaterThanOrEqual(tall);
    // 짧은 쪽은 정상적으로 상한까지 늘어난다.
    expect(hs[1]).toBe(MODULES_BOXES.slotRowMaxH);
    // 모든 행이 자연 높이 이상이라는 것이 이 함수의 불변식이다.
    for (const [i, nat] of [tall, 96].entries()) {
      expect(hs[i] ?? 0, `행 ${i}`).toBeGreaterThanOrEqual(nat);
    }
  });

  it('빈 배열·잘못된 가용 세로에서도 안전하다', () => {
    expect(fillRowHeights([], gap, 500, 100)).toEqual([]);
    expect(fillRowHeights([84, 84], gap, -10, 200)).toEqual([84, 84]);
  });
});

describe('분해 확인 팝업 — 높이를 **효과 줄 수에서** 역산해 빈 자리가 0 이다', () => {
  it('줄이 하나 늘면 높이도 정확히 한 줄만큼 는다(등호)', () => {
    /*
     * 실화면 2차에서 잡은 결함. 본문 높이를 상수로 박아 뒀는데 효과를 수치로 적기 시작하자
     * 등급 높은 모듈의 블록이 5줄이 되어 **경고 문장과 버튼을 뚫고 겹쳤다**. 팝업이 담는 것이
     * 가변 길이면 높이도 그 길이에서 나와야 한다.
     */
    for (let n = MODULES_MODAL.linesMin; n < MODULES_MODAL.linesMax; n++) {
      expect(salvageModalHeight(n + 1) - salvageModalHeight(n), `n=${n}`).toBe(MODULES_MODAL.lineH);
    }
    expect(salvageModalHeight(3)).toBe(
      MODULES_MODAL.boxY + salvageModalBlockH(3) + MODULES_MODAL.edgePad,
    );
  });

  it('줄 수가 [1, 8] 로 클램프된다', () => {
    expect(salvageModalHeight(0)).toBe(salvageModalHeight(MODULES_MODAL.linesMin));
    expect(salvageModalHeight(99)).toBe(salvageModalHeight(MODULES_MODAL.linesMax));
  });

  it('어떤 줄 수에서도 뭉치가 상자 안에서 끝난다(복제 상수 드리프트 + 겹침 금지)', () => {
    for (const n of [1, 3, 5, MODULES_MODAL.linesMax]) {
      const h = salvageModalHeight(n);
      const panel = makeCinematicPanel({ width: MODULES_MODAL.w, height: h, variant: 'slab', title: '분해' });
      expect(panel.box.y).toBe(MODULES_MODAL.boxY);
      expect(panel.box.y + panel.box.h).toBe(h - MODULES_MODAL.edgePad);
      // 머리 + 효과 줄 + 경고 문장이 **버튼 줄 위에서** 끝나야 한다(겹치면 여기서 빨개진다).
      const used = MODULES_MODAL.headH + 8 + n * MODULES_MODAL.lineH + 14 + MODULES_MODAL.bodyH;
      expect(used, `n=${n} 에서 본문이 버튼을 뚫는다`).toBeLessThanOrEqual(
        panel.box.h - MODULES_MODAL.btnH,
      );
      panel.destroy();
    }
  });

  it('최대 줄 수에서도 화면 안에 들어간다', () => {
    expect(salvageModalHeight(MODULES_MODAL.linesMax)).toBeLessThan(DESIGN_HEIGHT - 40);
    expect(MODULES_MODAL.w).toBeLessThan(DESIGN_WIDTH);
  });
});

describe('크롬이 패널보다 위에 있다 — 구운 그림자가 클릭을 훔치지 못하게', () => {
  /**
   * 방어 사령부 사용자 신고(2026-08-02) "탭 아래 절반이 클릭이 안 된다"의 실체.
   *
   * 석재 패널은 접지 그림자·글로우를 텍스처에 구워 넣어 자기 사각보다 30px 가까이 번지고,
   * 패널이 크롬보다 나중에 추가되면 그 번짐이 크롬을 덮는다. 왜 "비상호작용이라 안 가린다"가
   * 틀렸나: Pixi v8 은 자식을 역순으로 훑다가 **픽셀에 걸리면 거기서 멈추고 가장 가까운
   * 상호작용 조상**을 반환한다 — 그림자가 passive 여도 탐색은 끝난다.
   *
   * 좌표로는 못 잡는 결함이라(번짐은 텍스처 안에 있고 레이아웃 값이 아니다) **조립 순서**를
   * 소스에서 직접 잠근다. ⚠️ 여백을 벌리는 것으로는 못 푼다.
   */
  const src = new TextDecoder().decode(
    readFileSync(fileURLToPath(new URL('../src/ui/pixi/modulesView.ts', import.meta.url))),
  );
  const body = src.slice(src.indexOf('private buildChrome('), src.indexOf('private addPanel('));

  it('buildChrome 이 패널 3장을 세운 **뒤에** 헤더·하단 띠를 붙인다', () => {
    const lastPanel = body.lastIndexOf('this.addPanel(');
    expect(lastPanel, 'buildChrome 안에서 addPanel 호출을 못 찾았다').toBeGreaterThan(-1);
    expect(body.split('this.addPanel(').length - 1, '패널이 3장이 아니다').toBe(3);
    for (const chrome of ['this.buildHeader()', 'this.buildFooter()']) {
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

  it('main.ts 가 매 프레임 update 를 흘린다(빠뜨리면 배경·패널 연출이 통째로 멈춘다)', () => {
    // 연구소가 실제로 이 배선을 빠뜨렸다. 최상위 화면이라 여기 배선이 유일한 dt 공급원이다.
    const main = new TextDecoder().decode(
      readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url))),
    );
    // ⚠️ `toContain` 은 **항진이었다** — 그 호출을 주석 처리해도 통과한다(주석 줄도 문자열을
    // 품는다). 지시 수신소 레인에서 뮤테이션이 살아 돌아와 확인했다(2026-08-03).
    expect(main).toMatch(/^[ \t]*modulesScreen\.update\(frame\);/m);
  });
});
