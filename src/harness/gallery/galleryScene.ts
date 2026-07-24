/**
 * 프로토타입 갤러리 씬 (Phase 1 — plan §AC-1.1/1.2/1.3; ADR-0031, DEV 전용).
 *
 * 취향이 갈리는 6종 변형군(폭발·글로우·디졸브·충격파·전환·세리머니)을 **한 화면에서 라이브로**
 * 동시에 굴려 사용자가 눈으로 비교·선택하게 하는 "비주얼 스파이크" 무대다. 각 셀은 레지스트리
 * ({@link GALLERY_GROUPS})의 변형을 **실 프로덕션 spawn**(목업 아님, AC-1.3)으로 그린다 — 갤러리
 * 씬은 배치·구동·정리만 하고 변형 로직은 절대 건드리지 않는다(소비만).
 *
 * ── 계약 ──────────────────────────────────────────────────────────────────────
 *  - **render-only**: sim·hashWorld/hashEntity 무접촉. `src/sim/` 을 import 하지 않는다.
 *  - **DEV 전용**: 이 파일은 치트 패널(`import.meta.env.DEV` 동적 import)에서만 마운트되므로
 *    프로덕션 번들에서 트리셰이킹으로 제거된다.
 *  - **누수 0**: {@link GalleryScene.unmount} 가 ticker 콜백 제거 + 모든 핸들 destroy + 백드롭
 *    서브트리 파괴로 셀·파티클·필터를 전부 회수한다.
 *
 * 레이아웃은 그룹당 한 행(6행). 행 좌측에 그룹 제목 + 레지스터 배지, 그 오른쪽에 그 그룹의 변형
 * 셀들을 나란히 둔다. 각 셀은 라이브 이펙트 + 변형 라벨/id + (추천 변형이면) "추천" 표식을 얹고,
 * 클릭하면 그 variant id 를 콘솔에 로그한다(사용자가 선택을 알려줄 때 참조용 — 선택 파일 기록은
 * 이 파일 밖 몫이라 여기선 표시·로그까지만 한다).
 */

import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import type { Application, Ticker } from 'pixi.js';
import { UI_FONT, TEXT_SHADOW } from '../../ui/pixi/theme.js';
import { stripEmoji } from '../../ui/pixi/text.js';
import { GALLERY_GROUPS } from './index.js';
import type { GalleryVariant, GalleryVariantHandle } from './types.js';

// ---------------------------------------------------------------------------
// 레이아웃 상수 (placeholder)
//
// defer-balance-tuning: 셀 크기·여백·폰트의 실제 다듬기는 갤러리로 룩을 고른 뒤(Phase 2~5 승격
// 단계)로 미룬다(사용자 지시 2026-07-22). 지금 값은 1920×1080 디자인 스페이스에 6행×최대 3열을
// 눈대중으로 채우는 값이다.
// ---------------------------------------------------------------------------

/** 디자인 스페이스(app.ts DESIGN_WIDTH/HEIGHT 와 정합). 백드롭이 이 전체를 덮는다. */
const DESIGN_W = 1920;
const DESIGN_H = 1080;
/** 바깥 여백. */
const PAD = 40;
/** 상단 헤더 밴드 높이(제목 + 안내). */
const HEADER_H = 52;
/** 행 사이 세로 간격. */
const ROW_GAP = 12;
/** 행 좌측 라벨 열(그룹 제목 + 레지스터 배지) 폭. */
const LABEL_W = 210;
/** 셀 사이 가로 간격. */
const CELL_GAP = 14;
/** 셀 상단 라벨 밴드(효과는 이 아래 영역 중앙에 그려진다 — 라벨/효과 시각 분리). */
const LABEL_BAND = 24;
/** 프레임 델타 상한(초) — 탭 복귀 등으로 큰 dt 가 들어와도 원샷 이펙트가 순간이동하지 않게 클램프. */
const MAX_DT = 0.05;

// ── 팔레트(전투 다크 오버레이 — 메타 카툰나무풍이 아니라 개발 도구 무대다) ─────────────
const BACKDROP_FILL = 0x05070e;
const BACKDROP_BORDER = 0x1a2440;
const CELL_FILL = 0x0c1120;
const CELL_BORDER = 0x263251;
const ACCENT_CYAN = 0x7affea;
const ACCENT_GOLD = 0xffd678;
const TEXT_MAIN = 0xe8ecff;
const TEXT_MUTED = 0x8896b8;

type Weight = '400' | '700' | '800';

/** UI 폰트 라벨(이모지 제거·2배 해상도 — Pixi 두부 회피, src/ui/pixi/text.ts 정신). */
function makeText(text: string, size: number, color: number, weight: Weight = '400'): Text {
  return new Text({
    resolution: 2,
    text: stripEmoji(text),
    style: { fontFamily: UI_FONT, fontSize: size, fontWeight: weight, fill: color, dropShadow: TEXT_SHADOW },
  });
}

/** 레지스터 배지(계약상 'combat'|'meta' 코드값 — 번역하지 않고 그대로 표기). */
function makeRegisterBadge(register: 'combat' | 'meta'): Container {
  const c = new Container();
  const fill = register === 'combat' ? 0x14324a : 0x3a2a12;
  const fg = register === 'combat' ? ACCENT_CYAN : ACCENT_GOLD;
  const label = makeText(register, 11, fg, '700');
  const w = label.width + 14;
  const h = 18;
  const bg = new Graphics().roundRect(0, 0, w, h, 6).fill({ color: fill, alpha: 0.9 });
  label.position.set(7, (h - label.height) / 2);
  c.addChild(bg, label);
  return c;
}

/**
 * 셀 하나를 만든다: 배경 + 라이브 이펙트(host) + 라벨/id + (추천) 표식 + 클릭 로그.
 * 반환한 핸들은 씬이 매 프레임 update, unmount 시 destroy 한다.
 */
function buildCell(
  variant: GalleryVariant,
  cellW: number,
  cellH: number,
): { container: Container; handle: GalleryVariantHandle } {
  const cell = new Container();

  // 1) 배경 — 추천 변형은 시안 테두리로 강조.
  const recommended = variant.recommended === true;
  const bg = new Graphics()
    .roundRect(0, 0, cellW, cellH, 8)
    .fill({ color: CELL_FILL, alpha: 0.85 })
    .stroke({ color: recommended ? ACCENT_CYAN : CELL_BORDER, width: recommended ? 2 : 1 });
  cell.addChild(bg);

  // 2) 라이브 이펙트 host — 라벨 밴드 아래 영역에 배치. 변형은 셀 로컬 좌표(0,0=host 좌상단)에
  //    자기 표시 객체를 동기적으로 그린다(spawn 직후 host.children 증가 = 정규경로 배선 근거).
  const host = new Container();
  host.position.set(0, LABEL_BAND);
  cell.addChild(host);
  const handle = variant.spawn(host, { width: cellW, height: Math.max(1, cellH - LABEL_BAND) });

  // 3) 라벨/id 는 host 뒤에 얹어 이펙트 위에 항상 보이게. 라벨=상단 밴드, id=좌하단 작게.
  const label = makeText(variant.label, 15, TEXT_MAIN, '800');
  label.position.set(8, 5);
  cell.addChild(label);
  const idText = makeText(variant.id, 10, TEXT_MUTED, '400');
  idText.position.set(8, cellH - 15);
  cell.addChild(idText);

  // 4) 추천 표식(우상단 필).
  if (recommended) {
    const pill = new Container();
    const pl = makeText('추천', 11, 0x04121a, '800');
    const pw = pl.width + 14;
    const ph = 18;
    const pbg = new Graphics().roundRect(0, 0, pw, ph, 9).fill({ color: ACCENT_CYAN, alpha: 0.95 });
    pl.position.set(7, (ph - pl.height) / 2);
    pill.addChild(pbg, pl);
    pill.position.set(cellW - pw - 6, 5);
    cell.addChild(pill);
  }

  // 5) 클릭 → variant id 콘솔 로그. hitArea 를 셀 전체에 걸어 이펙트/라벨 위 어디를 눌러도
  //    잡히게 한다(바탕 Graphics 에만 걸면 위에 얹은 텍스트가 클릭을 삼키는 선례 회피).
  cell.eventMode = 'static';
  cell.cursor = 'pointer';
  cell.hitArea = new Rectangle(0, 0, cellW, cellH);
  cell.on('pointertap', () => {
    console.log(`[gallery] 선택 후보: ${variant.id} · ${variant.label}`);
  });

  return { container: cell, handle };
}

/**
 * 갤러리 씬 — 마운트 시 백드롭을 stage 에 붙이고 6행 변형 셀을 라이브 렌더, ticker 로 구동한다.
 * 한 번에 하나만 열려 있으면 되므로 인스턴스는 치트 패널이 모듈/클로저 스코프로 1개 유지한다.
 */
export class GalleryScene {
  private backdrop: Container | null = null;
  private handles: GalleryVariantHandle[] = [];
  private tick: ((t: Ticker) => void) | null = null;
  private app: Application | null = null;

  /** 열려 있는지(마운트 여부). */
  isOpen(): boolean {
    return this.backdrop !== null;
  }

  /**
   * 디자인 스페이스 전체를 덮는 백드롭을 `stage` 에 addChild 하고, 그룹당 한 행으로 변형 셀을
   * 배치한다. app.ticker 에 update 콜백을 등록해 매 프레임 모든 핸들을 구동한다. 이미 열려 있으면
   * 아무것도 하지 않는다(중복 마운트 방지).
   */
  mount(stage: Container, app: Application): void {
    if (this.backdrop !== null) return; // 이미 열림 — 중복 마운트/누수 방지.
    this.app = app;

    const root = new Container();

    // 반투명 백드롭(라이브 이펙트 대비). 디자인 스페이스 전체를 덮는다.
    const bg = new Graphics()
      .rect(0, 0, DESIGN_W, DESIGN_H)
      .fill({ color: BACKDROP_FILL, alpha: 0.94 })
      .stroke({ color: BACKDROP_BORDER, width: 2 });
    root.addChild(bg);

    // 헤더: 제목 + 안내(클릭 로그).
    const title = makeText('이펙트 갤러리 · Phase 1 (DEV · render-only)', 22, ACCENT_CYAN, '800');
    title.position.set(PAD, PAD);
    root.addChild(title);
    const sub = makeText(
      '6종 변형군을 라이브 비교 — 셀을 클릭하면 그 variant id 가 콘솔에 찍힙니다. 시안 테두리 = 추천 기본값.',
      13,
      TEXT_MUTED,
      '400',
    );
    sub.position.set(PAD, PAD + 26);
    root.addChild(sub);

    // 행 배치 계산.
    const rowsTop = PAD + HEADER_H;
    const availH = DESIGN_H - rowsTop - PAD;
    const nRows = GALLERY_GROUPS.length;
    const rowH = (availH - (nRows - 1) * ROW_GAP) / nRows;
    const cellsX = PAD + LABEL_W + CELL_GAP;
    const cellsW = DESIGN_W - cellsX - PAD;

    for (let i = 0; i < nRows; i++) {
      const group = GALLERY_GROUPS[i];
      if (group === undefined) continue;
      const rowY = rowsTop + i * (rowH + ROW_GAP);

      // 좌측 라벨 열: 그룹 제목 + 레지스터 배지.
      const gTitle = makeText(group.title, 17, TEXT_MAIN, '800');
      gTitle.position.set(PAD, rowY + rowH / 2 - 20);
      root.addChild(gTitle);
      const badge = makeRegisterBadge(group.register);
      badge.position.set(PAD, rowY + rowH / 2 + 4);
      root.addChild(badge);

      // 변형 셀들(실 열 수 기준 폭 산정 — 그룹마다 2~3개).
      const k = group.variants.length;
      if (k <= 0) continue;
      const cellW = (cellsW - (k - 1) * CELL_GAP) / k;
      for (let j = 0; j < k; j++) {
        const variant = group.variants[j];
        if (variant === undefined) continue;
        const { container, handle } = buildCell(variant, cellW, rowH);
        container.position.set(cellsX + j * (cellW + CELL_GAP), rowY);
        root.addChild(container);
        this.handles.push(handle);
      }
    }

    stage.addChild(root);
    this.backdrop = root;

    // 매 프레임 구동 — 모든 원샷/지속 이펙트를 초 단위 델타로 update. 큰 dt 는 클램프.
    // 한 변형이 던져도 나머지 구동이 멈추지 않도록 개별 격리(개발 도구 안전판).
    this.tick = (t: Ticker): void => {
      const dt = Math.min(t.deltaMS / 1000, MAX_DT);
      for (const h of this.handles) {
        try {
          h.update(dt);
        } catch (err) {
          console.warn('[gallery] 변형 update 예외(격리):', err);
        }
      }
    };
    app.ticker.add(this.tick);
  }

  /**
   * ticker 콜백 제거 + 모든 핸들 destroy + 백드롭 서브트리 파괴(누수 0). 닫혀 있으면 no-op.
   */
  unmount(): void {
    if (this.tick !== null && this.app !== null) {
      this.app.ticker.remove(this.tick);
    }
    this.tick = null;

    for (const h of this.handles) {
      try {
        h.destroy();
      } catch (err) {
        console.warn('[gallery] 변형 destroy 예외(격리):', err);
      }
    }
    this.handles = [];

    if (this.backdrop !== null) {
      this.backdrop.destroy({ children: true });
      this.backdrop = null;
    }
    this.app = null;
  }
}

/**
 * 공유 갤러리 씬 싱글턴. 치트 패널의 갤러리 탭 토글과 `?gallery=1` 딥링크(main.ts)가 **같은 인스턴스**를
 * 구동해 이중 마운트를 막는다(둘 중 하나가 열면 다른 쪽의 isOpen 이 그 상태를 반영).
 */
export const galleryScene = new GalleryScene();
