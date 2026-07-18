/**
 * 방어 사령부 실화면 편집 — 편집 오버레이(레인 B, 스펙 D5, ADR-0013).
 *
 * 침공 정지 프리뷰(defensePreview.ts) 위에 얹는 **렌더 전용** Pixi Graphics 레이어다. sim 을
 * 한 톨도 건드리지 않고(ADR-0005 결정론 불변), 편집을 돕는 시각 보조만 그린다:
 *   ① 옅은 배치 격자 상시 + 호버 셀 하이라이트 + 배치 불가 칸(공격자 스폰) 표시
 *   ② 진입 지점 마커(배치 영역 정중앙 = 공격자 스폰, 고정)
 *   ③ 선택/호버 포탑 사거리 원(실축척 — TURRET_SPECS.range. 감속 포탑은 감속 장판 반경 포함)
 *   ④ 코어 피격 반경(CORE_RADIUS=90) 원
 *
 * 좌표계: 월드 유닛으로 그리고, 레이어 위치는 컨트롤러가 카메라(정지 프리뷰는 원점 고정)에
 * 맞춰 팬한다 — entityRenderer 와 동일 규약이라 스프라이트와 정확히 겹친다. 격자 기하·포탑
 * 스펙 상수는 기존 순수 모듈에서 가져와 하드코딩 중복을 만들지 않는다(스펙 §구현 접점).
 */

import { Container, Graphics } from 'pixi.js';
import {
  GRID_COLS,
  GRID_ROWS,
  CELL_W,
  CELL_H,
  SPAWN_COL,
  SPAWN_ROW,
  cellToWorld,
  worldToCell,
} from '../ui/defenseCommand.js';
import { TURRET_SPECS, CORE_RADIUS, type DefenseLayout } from '../sim/defense.js';

/** 오버레이가 강조하는 배치물(사거리 원 대상). 컨트롤러가 선택/호버로 채운다. */
export interface OverlayHighlight {
  kind: 'turret' | 'core' | 'obstacle' | 'guardian';
  /** 해당 배열 인덱스(kind==='core' 는 무시). */
  index: number;
}

/** 오버레이 1프레임의 입력 상태(전부 렌더 전용, 순수 데이터). */
export interface PreviewOverlayState {
  /** 현재 배치(사거리 원·코어 반경 대상). null = 미배치. */
  layout: DefenseLayout | null;
  /** 마우스가 올라간 격자 칸(하이라이트). null = 화면 밖. */
  hover: { col: number; row: number } | null;
  /** 선택된 배치물(사거리 원 상시 표시). null = 미선택. */
  selected: OverlayHighlight | null;
}

const COLOR_GRID = 0x4a5a80;
const COLOR_HOVER = 0x7affea;
const COLOR_BLOCK = 0xff6a6a;
const COLOR_ENTRY = 0xffb14c;
const COLOR_RANGE = 0x7affea;
const COLOR_FROST = 0x7ad0ff;
const COLOR_CORE = 0x8fd94c;

/** 감속 포탑 유형 코드(사거리 원에 감속 장판 반경을 함께 그린다). TURRET_FROST 와 동일. */
const TURRET_FROST_CODE = 3;

/** 배치 격자 좌상단 월드 좌표(칸 중앙 기준에서 반 칸 물러난 지점). */
function gridOriginWorld(): { x: number; y: number } {
  const c = cellToWorld(0, 0);
  return { x: c.x - CELL_W / 2, y: c.y - CELL_H / 2 };
}

export class DefensePreviewOverlay {
  readonly layer = new Container();
  private readonly g = new Graphics();

  constructor() {
    this.layer.addChild(this.g);
  }

  /** 레이어를 카메라에 맞춰 팬한다(entityRenderer 와 동일 — 월드 좌표로 그린 것이 겹치게). */
  setCamera(offsetX: number, offsetY: number): void {
    this.layer.position.set(offsetX, offsetY);
  }

  /** 오버레이를 상태로 다시 그린다(전면 재구성 — 편집 상호작용에만 호출, 매 프레임 아님). */
  render(state: PreviewOverlayState): void {
    const g = this.g;
    g.clear();
    this.drawGrid(g);
    this.drawBlockedCell(g);
    if (state.hover !== null) this.drawHover(g, state.hover);
    this.drawEntryMarker(g);
    if (state.layout !== null) {
      this.drawCoreRadius(g, state.layout);
      this.drawRangeCircles(g, state);
    }
  }

  /** ① 옅은 배치 격자(세로/가로 라인). */
  private drawGrid(g: Graphics): void {
    const o = gridOriginWorld();
    const right = o.x + GRID_COLS * CELL_W;
    const bottom = o.y + GRID_ROWS * CELL_H;
    for (let c = 0; c <= GRID_COLS; c++) {
      const x = o.x + c * CELL_W;
      g.moveTo(x, o.y).lineTo(x, bottom);
    }
    for (let r = 0; r <= GRID_ROWS; r++) {
      const y = o.y + r * CELL_H;
      g.moveTo(o.x, y).lineTo(right, y);
    }
    g.stroke({ color: COLOR_GRID, width: 2, alpha: 0.28 });
    // 배치 영역 외곽선(1792×960)을 조금 더 진하게 — 카메라 정합 확인용.
    g.rect(o.x, o.y, GRID_COLS * CELL_W, GRID_ROWS * CELL_H).stroke({
      color: COLOR_GRID,
      width: 3,
      alpha: 0.5,
    });
  }

  /** ① 배치 불가 칸(공격자 스폰 = 정중앙): 코어·포탑·수호를 놓지 못하는 칸을 사선 강조. */
  private drawBlockedCell(g: Graphics): void {
    const c = cellToWorld(SPAWN_COL, SPAWN_ROW);
    g.rect(c.x - CELL_W / 2, c.y - CELL_H / 2, CELL_W, CELL_H)
      .fill({ color: COLOR_BLOCK, alpha: 0.1 })
      .stroke({ color: COLOR_BLOCK, width: 2, alpha: 0.55 });
  }

  /** ① 호버 셀 하이라이트. */
  private drawHover(g: Graphics, hover: { col: number; row: number }): void {
    if (hover.col < 0 || hover.col >= GRID_COLS || hover.row < 0 || hover.row >= GRID_ROWS) return;
    const c = cellToWorld(hover.col, hover.row);
    g.rect(c.x - CELL_W / 2, c.y - CELL_H / 2, CELL_W, CELL_H)
      .fill({ color: COLOR_HOVER, alpha: 0.14 })
      .stroke({ color: COLOR_HOVER, width: 3, alpha: 0.8 });
  }

  /** ② 진입 지점 마커(배치 영역 정중앙 고정) — 공격자가 들어오는 지점. */
  private drawEntryMarker(g: Graphics): void {
    const c = cellToWorld(SPAWN_COL, SPAWN_ROW);
    const s = 34;
    // 아래를 향한 삼각형(진입 화살표) + 링.
    g.circle(c.x, c.y, s + 10).stroke({ color: COLOR_ENTRY, width: 3, alpha: 0.9 });
    g.moveTo(c.x - s, c.y - s * 0.7)
      .lineTo(c.x + s, c.y - s * 0.7)
      .lineTo(c.x, c.y + s * 0.8)
      .lineTo(c.x - s, c.y - s * 0.7)
      .fill({ color: COLOR_ENTRY, alpha: 0.85 });
  }

  /** ④ 코어 피격 반경(90) 원 — 코어가 배치돼 있을 때. */
  private drawCoreRadius(g: Graphics, layout: DefenseLayout): void {
    g.circle(layout.core.x, layout.core.y, CORE_RADIUS)
      .fill({ color: COLOR_CORE, alpha: 0.08 })
      .stroke({ color: COLOR_CORE, width: 2, alpha: 0.6 });
  }

  /**
   * ③ 선택/호버 포탑 사거리 원(실축척). 선택된 포탑은 상시, 호버 칸의 포탑은 임시로 그린다.
   * 감속 포탑은 조준 사거리 원 + 감속 장판 반경 원을 함께 표시한다(스펙 D5).
   */
  private drawRangeCircles(g: Graphics, state: PreviewOverlayState): void {
    const layout = state.layout;
    if (layout === null) return;
    const drawn = new Set<number>();

    // 선택된 포탑(상시).
    if (state.selected !== null && state.selected.kind === 'turret') {
      const idx = state.selected.index;
      const t = layout.turrets[idx];
      if (t !== undefined) {
        this.drawTurretRange(g, t.x, t.y, t.type, 0.85);
        drawn.add(idx);
      }
    }

    // 호버 칸에 포탑이 있으면 임시로(중복 회피).
    if (state.hover !== null) {
      for (let i = 0; i < layout.turrets.length; i++) {
        if (drawn.has(i)) continue;
        const t = layout.turrets[i]!;
        const cell = worldToCell(t.x, t.y);
        if (cell.col === state.hover.col && cell.row === state.hover.row) {
          this.drawTurretRange(g, t.x, t.y, t.type, 0.5);
          break;
        }
      }
    }
  }

  /** 포탑 1기의 사거리 원(+ 감속 포탑이면 장판 반경)을 그린다. */
  private drawTurretRange(g: Graphics, x: number, y: number, type: number, alpha: number): void {
    const spec = TURRET_SPECS[type];
    if (spec === undefined) return;
    g.circle(x, y, spec.range)
      .fill({ color: COLOR_RANGE, alpha: 0.05 })
      .stroke({ color: COLOR_RANGE, width: 2, alpha });
    if (type === TURRET_FROST_CODE && spec.hazardRadius > 0) {
      g.circle(x, y, spec.hazardRadius).stroke({
        color: COLOR_FROST,
        width: 2,
        alpha: Math.min(1, alpha + 0.1),
      });
    }
  }

  destroy(): void {
    this.g.destroy();
    this.layer.destroy({ children: true });
  }
}
