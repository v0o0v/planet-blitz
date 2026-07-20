/**
 * 방어 배치 프리뷰 — 3레이어 정지 렌더 (M7b-command-ui, ADR-0013 계승).
 *
 * ## 목업이 아니라 진짜 sim 이다
 * 프리뷰는 배치를 그림으로 흉내 내지 않는다. `createWorld(seed, {invasion3})` 로 **실제 침공
 * 월드**를 만들고, 원하는 레이어까지 페이즈를 밀어 올린 뒤(진입 훅이 정적 배치를 깐다) 그
 * 한 프레임을 그린다. 그래서 프리뷰에 보이는 것은 정의상 공격자가 보게 될 것과 같은
 * 스폰 좌표·같은 개수·같은 기본 수비대 충원 결과다. 표시용 좌표표를 따로 두지 않으므로
 * 드리프트가 구조적으로 불가능하다.
 *
 * ## 레이어마다 "정지 화면"의 의미가 다르다
 * - **L2 회랑 / L3 코어방**: 진입 훅(`enterFacilityLayer` / `enterCoreRoom`)이 벽·설비·기물·
 *   보스·수호·코어를 T0 에 한꺼번에 깐다 → 페이즈 점프만 하면 완성된 그림이 나온다.
 * - **L1 대기권**: 정적 배치가 없다. L1 의 내용물은 "슬롯 i 는 진입 후 i×720틱에 등장한다"는
 *   **일정표**다. 그래서 L1 프리뷰는 물리를 한 틱도 돌리지 않고, 선택한 슬롯의 편대가 등장하는
 *   그 순간의 `state.tick` 을 만들어 sim 자신의 스폰 함수(`stepInvasionFormation`)를 부른다.
 *   트리거가 상태 없는 등식이라 이렇게 불러도 정확히 그 슬롯만, 실제와 같은 좌표로 올라온다.
 *
 * 물리를 돌리지 않는다는 점이 중요하다 — 수천 틱을 밀면 플레이어가 맞아 죽거나 편대가 화면
 * 밖으로 흘러가 "배치"가 아니라 "전투 한 장면"이 된다. 프리뷰가 답해야 하는 질문은
 * "내가 꽂은 것들이 어디에 얼마나 서 있는가" 다.
 *
 * ## 결정론(ADR-0005)
 * 이 파일은 render 레이어이므로 해시에 영향이 없지만, 프리뷰 월드는 **고정 시드**
 * ({@link PREVIEW_SEED})로 만든다 — 같은 배치는 항상 같은 그림이어야 사용자가 변경분을 읽을 수
 * 있다. `Math.random`·`Date.now` 를 쓰지 않는다.
 */

import { Container, Graphics } from 'pixi.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './app.js';
import { EntityRenderer } from './entityRenderer.js';
import type { PlaceholderTextures } from './textures.js';
import { createWorld, DEFAULT_CONFIG, type WorldConfig, type WorldState } from '../sim/world.js';
import { snapshotWorld } from '../sim/snapshot.js';
import {
  INVASION_ACCEL_BASE_CP,
  INVASION_TOTAL_TICKS,
  PHASE_L1,
  clearLayerEntities,
  enterLayerFrame,
  enterInvasionLayer,
  makeInvasionContext,
  normalizeInvasionLayers,
  stepInvasionFormation,
  formationSlotTriggerTick,
  type InvasionLayers,
  type InvasionPhase,
} from '../sim/invasion/index.js';
import { MAINTENANCE_FULL } from '../sim/invasion/guardianBridge.js';
import { formationById } from '../../data/invasion/formations.js';

/** 프리뷰 월드 고정 시드 — 같은 배치는 항상 같은 그림(모듈 주석 참고). */
export const PREVIEW_SEED = 0x7b1a5e;

/** 프리뷰가 그려지는 화면 사각형(디자인 스페이스). */
export interface PreviewViewport {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 뷰포트 안에 디자인 화면(1920×1080)을 맞춰 넣는 변환. 순수. */
export interface PreviewFit {
  /** 축소 배율. */
  readonly scale: number;
  /** 뷰포트 로컬 좌표계에서 스케일 컨테이너가 놓일 위치. */
  readonly x: number;
  readonly y: number;
}

/**
 * 뷰포트에 화면 전체를 담는 배율·오프셋을 구한다.
 *
 * {@link EntityRenderer} 는 카메라가 **디자인 화면 정중앙**에 오도록 자기 레이어를 옮긴다.
 * 따라서 스케일 컨테이너를 `(w/2 - s·DW/2, h/2 - s·DH/2)` 에 두면 카메라 지점이 뷰포트 정중앙에
 * 온다 — 프리뷰가 어느 레이어든 항상 "볼 곳"을 가운데 둔다.
 */
export function previewFit(view: PreviewViewport): PreviewFit {
  const scale = Math.min(view.w / DESIGN_WIDTH, view.h / DESIGN_HEIGHT);
  return {
    scale,
    x: view.w / 2 - (DESIGN_WIDTH * scale) / 2,
    y: view.h / 2 - (DESIGN_HEIGHT * scale) / 2,
  };
}

/** 프리뷰 월드 생성 입력. */
export interface PreviewWorldInput {
  /** 정규화 전 배치(총 함수 정규화를 거친다 — 손상 raw 도 안전). */
  readonly layers: InvasionLayers | null;
  /** 보여줄 레이어(0=L1, 1=L2, 2=L3). */
  readonly phase: InvasionPhase;
  /** L1 에서 등장 장면을 만들 웨이브 슬롯(기본 0). L2/L3 에서는 무시된다. */
  readonly slotIndex?: number;
  readonly seed?: number;
  /** 정비도(centi-percent). 기본 완전 정비 — 프리뷰는 "정비된 내 기지"를 보여준다. */
  readonly maintenance?: number;
}

/**
 * 프리뷰용 침공 월드를 만든다(물리 미진행). **테스트가 직접 부르는 진입점**이다 — Pixi 없이
 * 도는 순수 sim 조립이라, "프리뷰에 실제로 무엇이 서는가"를 캔버스 없이 검증할 수 있다.
 */
export function buildPreviewWorld(input: PreviewWorldInput): WorldState {
  const layers = normalizeInvasionLayers(input.layers);
  const config: WorldConfig = {
    ...DEFAULT_CONFIG,
    planet: 0,
    tier: 0,
    invasion3: {
      layers,
      timeLimitTicks: INVASION_TOTAL_TICKS,
      maintenance: input.maintenance ?? MAINTENANCE_FULL,
    },
  };
  const world = createWorld(input.seed ?? PREVIEW_SEED, config);
  const runtime = world.invasion3;
  const cfg = world.config.invasion3;
  if (runtime === undefined || cfg === undefined) return world;

  // 페이즈 점프 — 하네스 `jumpLayer` 와 같은 절차(잔여 정리 → 좌표 원점 이동 → 진입 훅).
  // 클리어 보너스는 주지 않는다: 점프는 "클리어"가 아니라 무대 꾸미기다.
  while (runtime.phase < input.phase) {
    clearLayerEntities(world);
    runtime.phase = (runtime.phase + 1) as InvasionPhase;
    runtime.phaseEnterTick = world.tick;
    runtime.accelCp = INVASION_ACCEL_BASE_CP;
    enterLayerFrame(world, cfg, runtime);
    enterInvasionLayer(world, makeInvasionContext(cfg, runtime));
  }

  if (input.phase === PHASE_L1) spawnPreviewFormation(world, input.slotIndex ?? 0);
  return world;
}

/**
 * L1 프리뷰: 선택 슬롯의 편대가 등장하는 순간을 만든다.
 *
 * `stepInvasionFormation` 의 트리거는 `local === member.delayTicks` 등식이라 구성원마다 등장
 * 틱이 다르다. 그래서 그 편대에 실제로 존재하는 delay 값들만 골라 각각 한 번씩 호출한다 —
 * 결과적으로 편대 전원이 자기 자리에 동시에 서 있는 그림이 된다(물리 0틱).
 */
function spawnPreviewFormation(world: WorldState, slotIndex: number): void {
  const cfg = world.config.invasion3;
  const runtime = world.invasion3;
  if (cfg === undefined || runtime === undefined) return;
  // 기본 수비대 충원까지 반영된 배치(공격자가 실제로 만나는 것)를 본다.
  const ctx = makeInvasionContext(cfg, runtime);
  const slots = ctx.layers.l1.waveSlots;
  const ref = slots[slotIndex];
  if (ref === null || ref === undefined) return;
  const def = formationById(ref.catalogId);
  if (def === undefined) return;

  const base = runtime.phaseEnterTick + formationSlotTriggerTick(slotIndex);
  const delays = new Set<number>();
  for (const m of def.members) delays.add(m.delayTicks);
  const savedTick = world.tick;
  for (const d of [...delays].sort((a, b) => a - b)) {
    world.tick = base + d;
    stepInvasionFormation(world, ctx);
  }
  world.tick = savedTick;
}

// ---------------------------------------------------------------------------
// 컨트롤러
// ---------------------------------------------------------------------------

/**
 * 프리뷰 제어 계약. M7b 방어 사령부(Pixi)가 소비한다. 좌표계·격자 환산 API(구 `clientToCell`)는
 * 3레이어에 격자 개념이 없어 계약에서 제외했다 — 레이어별 미리보기는 슬롯 목록 UI 가 주도하고
 * 프리뷰는 "그 배치로 만든 월드를 보여주는" 역할만 진다.
 */
export interface DefensePreviewControls {
  /**
   * 프리뷰 노드를 붙일 부모를 지정한다. 방어 사령부 화면이 자기 루트를 넘겨 **패널보다 아래,
   * 배경보다 위**로 순서를 잡는다(화면과 프리뷰가 서로를 생성자에서 참조하지 않게 하는 장치).
   */
  attachTo(parent: Container): void;
  /** 프리뷰를 켠다. `layers` 가 null 이면 빈 화면(배치 없음). */
  start(layers: InvasionLayers | null): void;
  /** 프리뷰를 끈다(자원 정리). */
  stop(): void;
  /** 배치가 바뀌면 다시 그린다. */
  setLayers(layers: InvasionLayers | null): void;
  /** 보여줄 레이어 + L1 슬롯을 바꾼다. */
  setFocus(phase: InvasionPhase, slotIndex?: number): void;
  /** 프리뷰가 그려질 사각형(패널 안 미리보기 상자). */
  setViewport(view: PreviewViewport): void;
  /** 프리뷰가 켜져 있는지. */
  readonly active: boolean;
  /** 프리뷰 화면 노드(호출자가 z 순서를 다룰 때 쓴다). */
  readonly layer: Container;
}

export interface DefensePreviewOptions {
  /** 엔티티 스프라이트 아틀라스(런 렌더와 같은 것). */
  textures: PlaceholderTextures;
  /** 프리뷰 노드를 붙일 부모(나중에 {@link DefensePreviewControls.attachTo} 로도 바꿀 수 있다). */
  parent?: Container;
  /** 초기 뷰포트. */
  viewport?: PreviewViewport;
}

/** 프리뷰 배경(우주 어둠) — 패널 안이 뚫려 보이지 않게 항상 채운다. */
const PREVIEW_BG = 0x0b0a18;

/**
 * 배치 객체 **신원**에 붙는 일련번호. 편집기는 배치를 고칠 때마다 새 객체를 만들므로
 * (`cloneInvasionLayers` → `normalizeInvasionLayers`), 신원 비교만으로 "바뀌었는가"가 성립한다.
 * 깊은 비교를 쓰지 않는 이유: 프리뷰는 매 렌더마다 물어보는데 깊은 비교가 오히려 비싸다.
 */
const layerTokens = new WeakMap<InvasionLayers, number>();
let nextLayerToken = 1;
function layersToken(layers: InvasionLayers): number {
  const found = layerTokens.get(layers);
  if (found !== undefined) return found;
  const id = nextLayerToken++;
  layerTokens.set(layers, id);
  return id;
}

/**
 * 3레이어 정지 프리뷰 컨트롤러.
 *
 * 매 프레임 갱신이 아니라 **변경 시 1회 재구성**이다(배치·레이어·슬롯·뷰포트가 바뀔 때만).
 * 침공 월드 생성은 수백 엔티티 스폰까지 포함하므로 프레임마다 돌리면 안 된다.
 */
export class DefensePreviewController implements DefensePreviewControls {
  readonly layer = new Container();
  private parent: Container | null;
  private readonly bg = new Graphics();
  private readonly clip = new Container();
  private readonly scaler = new Container();
  private readonly mask = new Graphics();
  private readonly renderer: EntityRenderer;

  private view: PreviewViewport = { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT };
  private layers: InvasionLayers | null = null;
  private phase: InvasionPhase = PHASE_L1;
  private slotIndex = 0;
  private on = false;
  /**
   * 마지막으로 그린 입력의 지문. 방어 사령부는 클릭 한 번에 화면 전체를 다시 그리고 그때마다
   * 뷰포트·배치·초점을 다시 먹이므로, 이 비교가 없으면 **한 번의 렌더에 침공 월드를 세 번**
   * 만든다(수백 엔티티 스폰 × 3). 입력이 같으면 아무 일도 하지 않는다.
   */
  private signature = '';

  constructor(opts: DefensePreviewOptions) {
    this.parent = opts.parent ?? null;
    this.renderer = new EntityRenderer(opts.textures);
    this.layer.addChild(this.bg);
    this.layer.addChild(this.clip);
    this.layer.addChild(this.mask);
    this.clip.mask = this.mask;
    this.clip.addChild(this.scaler);
    this.scaler.addChild(this.renderer.layer);
    this.layer.visible = false;
    if (opts.viewport !== undefined) this.view = opts.viewport;
  }

  get active(): boolean {
    return this.on;
  }

  attachTo(parent: Container): void {
    if (this.parent === parent) return;
    this.parent = parent;
    if (this.on) parent.addChild(this.layer);
  }

  start(layers: InvasionLayers | null): void {
    this.layers = layers;
    this.on = true;
    this.layer.visible = true;
    if (this.parent !== null && this.layer.parent !== this.parent) this.parent.addChild(this.layer);
    this.redraw();
  }

  stop(): void {
    this.on = false;
    this.layer.visible = false;
    // 다음 start() 는 무조건 다시 그린다(껐다 켠 사이에 화면이 바뀌었을 수 있다).
    this.signature = '';
    if (this.layer.parent !== null) this.layer.parent.removeChild(this.layer);
  }

  setLayers(layers: InvasionLayers | null): void {
    this.layers = layers;
    if (this.on) this.redraw();
  }

  setFocus(phase: InvasionPhase, slotIndex = 0): void {
    this.phase = phase;
    this.slotIndex = slotIndex;
    if (this.on) this.redraw();
  }

  setViewport(view: PreviewViewport): void {
    this.view = view;
    if (this.on) this.redraw();
  }

  /** 월드를 새로 조립해 한 프레임 그린다. **입력이 그대로면 아무 일도 하지 않는다.** */
  private redraw(): void {
    const v = this.view;
    const sig = [
      this.layers === null ? 'x' : String(layersToken(this.layers)),
      this.phase,
      this.slotIndex,
      v.x,
      v.y,
      v.w,
      v.h,
    ].join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    this.bg.clear();
    this.bg.roundRect(v.x, v.y, v.w, v.h, 8).fill({ color: PREVIEW_BG });
    this.mask.clear();
    this.mask.roundRect(v.x, v.y, v.w, v.h, 8).fill({ color: 0xffffff });
    this.clip.position.set(v.x, v.y);

    const fit = previewFit(v);
    this.scaler.position.set(fit.x, fit.y);
    this.scaler.scale.set(fit.scale);

    const world = buildPreviewWorld({
      layers: this.layers,
      phase: this.phase,
      slotIndex: this.slotIndex,
    });
    const snap = snapshotWorld(world);
    // 보간 없는 정지 렌더 — prev === curr, alpha 1.
    this.renderer.render(snap, snap, 1);
  }
}
