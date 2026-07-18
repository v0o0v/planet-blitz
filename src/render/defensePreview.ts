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
import { worldToCell, GRID_COLS, GRID_ROWS } from '../ui/defenseCommand.js';

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

  private world: WorldState | null = null;
  private layout: DefenseLayout | null = null;
  private hover: { col: number; row: number } | null = null;
  private selected: OverlayHighlight | null = null;
  private _active = false;
  /** 카메라 팬 오프셋(정지 프리뷰는 고정 — 원점 기준 화면 중앙). */
  private camOffsetX = DESIGN_WIDTH / 2;
  private camOffsetY = DESIGN_HEIGHT / 2;

  constructor(deps: DefensePreviewDeps) {
    this.deps = deps;
    this.renderer = new EntityRenderer(deps.textures);
    // 렌더 순서: 스프라이트(엔티티) 아래, 오버레이 위. 라이브 entityRenderer.layer 와는
    // 별개의 컨테이너라 서로 간섭하지 않는다(라이브는 프리뷰 중 emptySnap 만 그린다).
    deps.stage.addChild(this.renderer.layer);
    deps.stage.addChild(this.overlay.layer);
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
    // design → 월드: 레이어 팬(camOffset)의 역변환. 카메라 고정이라 오프셋은 상수.
    const worldX = d.x - this.camOffsetX;
    const worldY = d.y - this.camOffsetY;
    const cell = worldToCell(worldX, worldY);
    if (cell.col < 0 || cell.col >= GRID_COLS || cell.row < 0 || cell.row >= GRID_ROWS) {
      return null;
    }
    return cell;
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
