/**
 * 방어 사령부 실화면 편집 — 정지 프리뷰 컨트롤러(레인 B, 스펙 D1/D2/D9, ADR-0013).
 *
 * 배치를 "실제 게임화면"으로 보여주기 위해, 침공 런과 **동일한** `createWorld(침공 config)` 로
 * 정지 월드를 만들어 한 프레임 렌더한다. 이 월드는 라이브 런 상태(main 의 `world` 변수)와 완전히
 * 분리된 별도 참조로, 게임 루프에 태우지 않고(한 틱도 stepWorld 하지 않음) recorder 도 붙이지
 * 않는다 — 따라서 정산·리플레이·오염 런(ADR-0008) 규칙과 무관하다. 배치가 바뀌면 월드를
 * 재생성하고 다시 1프레임 그린다(엔티티 수십 개라 비용 미미 — OQ3: 즉시 재생성, 체감 지연 없음).
 *
 * 렌더 경로는 침공과 같은 entityRenderer + 게임 캔버스를 쓰되, 프리뷰 전용 EntityRenderer
 * 인스턴스를 별도로 두어 라이브 렌더러와 간섭하지 않는다. 그 위에 편집 오버레이
 * (defensePreviewOverlay)를 얹는다. 카메라는 고정 — 배치 영역(1792×960)이 design(1920×1080)에
 * 들어가므로 원점 고정으로 전체가 한 화면에 담긴다.
 */

import { Container } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './app.js';
import { EntityRenderer } from './entityRenderer.js';
import type { PlaceholderTextures } from './textures.js';
import {
  DefensePreviewOverlay,
  type PreviewOverlayState,
  type OverlayHighlight,
} from './defensePreviewOverlay.js';
import { createWorld, DEFAULT_CONFIG, type WorldConfig, type WorldState } from '../sim/world.js';
import { snapshotWorld, type WorldSnapshot } from '../sim/snapshot.js';
import { DEFAULT_TIME_LIMIT_TICKS, type DefenseLayout, type InvasionConfig } from '../sim/defense.js';
import { worldToCell, GRID_COLS, GRID_ROWS, CELL_W, CELL_H } from '../ui/defenseCommand.js';

/**
 * 프리뷰 제어 인터페이스(레인 C 소비 계약). main 이 생성해 defenseCommand 로 주입하면, 편집
 * UI 는 sim/렌더 세부를 몰라도 배치 프리뷰를 켜고/끄고/갱신할 수 있다. 모든 좌표는 클라이언트
 * (마우스 이벤트) 픽셀이며, 내부에서 design → 월드 → 격자 칸으로 환산한다.
 */
export interface DefensePreviewControls {
  /**
   * 프리뷰를 켠다: 침공 정지 월드를 생성해 1프레임 렌더하고 오버레이를 표시한다. `layout` 이
   * null 이면(코어 미배치 등) 빈 배경 + 오버레이(격자·진입 지점)만 보여준다.
   */
  start(layout: DefenseLayout | null): void;
  /** 프리뷰를 끈다: 레이어를 숨기고 정지 월드를 버린다(정리). */
  stop(): void;
  /** 배치가 바뀌면 월드를 재생성하고 다시 렌더한다(즉시 — 체감 지연 없음). */
  setLayout(layout: DefenseLayout | null): void;
  /** 오버레이 상태(호버 셀·선택 배치물)만 갱신해 다시 그린다(월드 재생성 없음 — 가벼움). */
  setOverlay(hover: { col: number; row: number } | null, selected: OverlayHighlight | null): void;
  /**
   * 클라이언트(마우스) 좌표 → 격자 칸. 배치 영역 밖이면 null. 편집 UI 가 칸 클릭/호버를
   * 프리뷰 좌표계로 환산하는 유일한 경로(격자 기하 하드코딩 중복 방지).
   */
  clientToCell(clientX: number, clientY: number): { col: number; row: number } | null;
  /**
   * 프리뷰를 화면의 특정 영역(좌/우 사이드 패널 사이 빈 공간)에 맞춰 축소·중앙정렬한다. 배치
   * 격자는 design(1920×1080) 전체를 채우는 full-bleed라, 패널이 얹히면 양끝 열이 가린다 —
   * `gap`(클라이언트 픽셀 사각형)에 격자 전체가 들어가도록 뷰포트를 스케일/팬한다. `null` 이면
   * design 전체 기준(폴백). 편집 UI 가 패널 기하·리사이즈에 맞춰 호출한다.
   */
  setViewport(gap: { left: number; top: number; right: number; bottom: number } | null): void;
  /** 프리뷰가 현재 켜져 있는지. */
  readonly active: boolean;
}

/** main 이 주입하는 의존성(렌더 스택 + 배경 전환 훅). */
export interface DefensePreviewDeps {
  /** 프리뷰 레이어를 붙일 stage(letterbox 컨테이너). */
  stage: Container;
  /** 침공/프리뷰 공용 스프라이트 세트. */
  textures: PlaceholderTextures;
  /** design-space 좌표 → 클라이언트 환산기(app.clientToDesign). */
  clientToDesign(clientX: number, clientY: number): { x: number; y: number };
  /**
   * 프리뷰 배경을 침공과 동일(카르곤 플랫 배경·오토타일 없음)하게 켜고/끄는 훅. main 이
   * 소유한 background/autotile 을 조작한다(레인 B 는 그 참조를 직접 갖지 않는다).
   */
  setBackdrop(active: boolean): void;
}

export class DefensePreviewController implements DefensePreviewControls {
  private readonly renderer: EntityRenderer;
  private readonly overlay = new DefensePreviewOverlay();
  private readonly deps: DefensePreviewDeps;
  /**
   * 프리뷰 스택(스프라이트 + 오버레이)을 함께 담는 뷰포트 컨테이너. 이 컨테이너에 scale/position
   * 을 걸어 격자를 좌/우 패널 사이 영역에 축소·중앙정렬한다. 내부 레이어(renderer/overlay)는
   * 여전히 camOffset 기준 월드 좌표로 그려지고, 뷰포트가 그 위에 화면 맞춤 변환을 얹는다.
   */
  private readonly viewport = new Container();

  private world: WorldState | null = null;
  private layout: DefenseLayout | null = null;
  private hover: { col: number; row: number } | null = null;
  private selected: OverlayHighlight | null = null;
  private _active = false;
  /** 카메라 팬 오프셋(정지 프리뷰는 고정 — 원점 기준 화면 중앙). */
  private camOffsetX = DESIGN_WIDTH / 2;
  private camOffsetY = DESIGN_HEIGHT / 2;
  /** 화면 맞춤 목표(design 좌표: 중심 cx,cy + 가용 크기 w,h). null = design 전체(폴백). */
  private fit: { cx: number; cy: number; w: number; h: number } | null = null;
  /** 현재 뷰포트 스케일(clientToCell 역변환에 필요). */
  private viewScale = 1;

  constructor(deps: DefensePreviewDeps) {
    this.deps = deps;
    this.renderer = new EntityRenderer(deps.textures);
    // 렌더 순서: 스프라이트(엔티티) 아래, 오버레이 위. 라이브 entityRenderer.layer 와는
    // 별개의 컨테이너라 서로 간섭하지 않는다(라이브는 프리뷰 중 emptySnap 만 그린다).
    // 두 레이어를 뷰포트에 담아 하나의 스케일/팬 변환을 공유한다(패널 사이 화면 맞춤).
    deps.stage.addChild(this.viewport);
    this.viewport.addChild(this.renderer.layer);
    this.viewport.addChild(this.overlay.layer);
    this.renderer.layer.visible = false;
    this.overlay.layer.visible = false;
  }

  get active(): boolean {
    return this._active;
  }

  start(layout: DefenseLayout | null): void {
    this._active = true;
    this.renderer.layer.visible = true;
    this.overlay.layer.visible = true;
    this.deps.setBackdrop(true);
    this.rebuild(layout);
  }

  stop(): void {
    if (!this._active) return;
    this._active = false;
    this.renderer.layer.visible = false;
    this.overlay.layer.visible = false;
    this.deps.setBackdrop(false);
    this.world = null;
    this.layout = null;
    this.hover = null;
    this.selected = null;
  }

  setLayout(layout: DefenseLayout | null): void {
    if (!this._active) return;
    this.rebuild(layout);
  }

  setOverlay(hover: { col: number; row: number } | null, selected: OverlayHighlight | null): void {
    this.hover = hover;
    this.selected = selected;
    if (!this._active) return;
    this.drawOverlay();
  }

  clientToCell(clientX: number, clientY: number): { col: number; row: number } | null {
    const d = this.deps.clientToDesign(clientX, clientY);
    // design → 뷰포트-로컬(스케일·팬 역변환) → 월드(camOffset 역변환). 뷰포트 변환을 거쳐야
    // 패널 사이로 축소된 격자와 클릭 좌표가 정확히 맞는다.
    const vx = (d.x - this.viewport.position.x) / this.viewScale;
    const vy = (d.y - this.viewport.position.y) / this.viewScale;
    const worldX = vx - this.camOffsetX;
    const worldY = vy - this.camOffsetY;
    const cell = worldToCell(worldX, worldY);
    if (cell.col < 0 || cell.col >= GRID_COLS || cell.row < 0 || cell.row >= GRID_ROWS) {
      return null;
    }
    return cell;
  }

  setViewport(gap: { left: number; top: number; right: number; bottom: number } | null): void {
    if (gap === null) {
      this.fit = null;
    } else {
      // 클라이언트 사각형 → design 사각형(letterbox 역변환). 안쪽 여백만큼 줄여 격자 외곽선이
      // 패널에 딱 붙지 않게 한다.
      const tl = this.deps.clientToDesign(gap.left, gap.top);
      const br = this.deps.clientToDesign(gap.right, gap.bottom);
      const w = br.x - tl.x - 2 * VIEWPORT_PAD;
      const h = br.y - tl.y - 2 * VIEWPORT_PAD;
      this.fit = w > 0 && h > 0 ? { cx: (tl.x + br.x) / 2, cy: (tl.y + br.y) / 2, w, h } : null;
    }
    this.applyViewport();
  }

  /**
   * 뷰포트 스케일/팬을 다시 계산한다. 격자 전체(GRID_COLS×CELL_W × GRID_ROWS×CELL_H)가 fit
   * 영역에 들어가도록 축소하고 그 중심에 맞춘다. fit 이 null 이면 design 전체 기준(스케일 1).
   */
  private applyViewport(): void {
    const fit = this.fit;
    if (fit === null) {
      this.viewScale = 1;
      this.viewport.scale.set(1);
      this.viewport.position.set(0, 0);
      return;
    }
    const gridW = GRID_COLS * CELL_W;
    const gridH = GRID_ROWS * CELL_H;
    const s = Math.min(fit.w / gridW, fit.h / gridH);
    this.viewScale = s;
    this.viewport.scale.set(s);
    // 격자 중심(월드 원점)의 뷰포트-로컬 좌표 = camOffset. 이를 fit 중심으로 보낸다.
    this.viewport.position.set(fit.cx - s * this.camOffsetX, fit.cy - s * this.camOffsetY);
  }

  /** 배치로 침공 정지 월드를 (재)생성하고 1프레임 렌더한다. layout null 이면 월드 없이 배경만. */
  private rebuild(layout: DefenseLayout | null): void {
    this.layout = layout;
    if (layout === null) {
      this.world = null;
      // 월드가 없으면 스프라이트를 비운다(빈 스냅샷 렌더 — 이전 배치 잔상 제거).
      this.renderer.render(EMPTY_SNAP, EMPTY_SNAP, 1);
      this.applyCamera(EMPTY_SNAP);
      this.drawOverlay();
      return;
    }
    const invasion: InvasionConfig = { layout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS };
    const config: WorldConfig = { ...DEFAULT_CONFIG, planet: 0, tier: 0, invasion };
    // 결정론 재현 무관(한 틱도 스텝하지 않음) — 시드는 고정 상수로 충분하다.
    this.world = createWorld(PREVIEW_SEED, config);
    const snap = snapshotWorld(this.world);
    // 공격자 기체(index 0, 원점 스폰)는 진입 지점 마커로 대신 표현하므로 스프라이트에서 제외한다.
    const previewSnap: WorldSnapshot = {
      ...snap,
      entities: snap.entities.filter((e) => e.kind !== 'player'),
    };
    this.applyCamera(snap);
    // prev=curr, alpha=1 → 보간 없이 정지 프레임. 한 번만 호출하므로 스프라이트가 유지된다.
    this.renderer.render(previewSnap, previewSnap, 1);
    this.drawOverlay();
  }

  /** 카메라(플레이어=원점)에 맞춰 렌더러/오버레이 레이어를 팬한다(entityRenderer 규약과 동일). */
  private applyCamera(snap: WorldSnapshot): void {
    this.camOffsetX = DESIGN_WIDTH / 2 - snap.cameraX;
    this.camOffsetY = DESIGN_HEIGHT / 2 - snap.cameraY;
    this.overlay.setCamera(this.camOffsetX, this.camOffsetY);
    // camOffset 이 바뀌면 뷰포트 팬(격자 중심 정렬)도 다시 계산해야 한다.
    this.applyViewport();
  }

  private drawOverlay(): void {
    const state: PreviewOverlayState = {
      layout: this.layout,
      hover: this.hover,
      selected: this.selected,
    };
    this.overlay.render(state);
  }

  destroy(): void {
    this.renderer.destroy();
    this.overlay.destroy();
  }
}

/** 정지 프리뷰 시드(고정 — 스텝하지 않으므로 재현 무관, 상수로 충분). */
const PREVIEW_SEED = 0x5eed;

/** 뷰포트 안쪽 여백(design 유닛) — 격자 외곽선이 패널·화면 끝에 딱 붙지 않게. */
const VIEWPORT_PAD = 20;

/** 빈 스냅샷(월드 미배치 프레임에서 스프라이트를 비우는 데 쓴다). */
const EMPTY_SNAP: WorldSnapshot = {
  tick: 0,
  arenaWidth: DEFAULT_CONFIG.arenaWidth,
  arenaHeight: DEFAULT_CONFIG.arenaHeight,
  cameraX: 0,
  cameraY: 0,
  planet: 0,
  entities: [],
  beams: [],
};
