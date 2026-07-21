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
import { snapshotWorld, type EntitySnapshot, type WorldSnapshot } from '../sim/snapshot.js';
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

// ---------------------------------------------------------------------------
// 콘텐츠 카메라 — "배치물이 프레임 안에 실제로 들어오는가"
// ---------------------------------------------------------------------------
//
// {@link previewFit} 하나만 쓰면 프레임은 **공격자 카메라 지점**(L1 = 스크롤 창 중심,
// L2 = 회랑 입구 부근, L3 = 코어)에 고정된 1920×1080 한 화면이다. 그런데 배치물은 그
// 한 화면 밖에 산다:
//   L1 편대는 창 위쪽 y −1610..−32 에 뜨고(창은 ±699 만 보인다),
//   L2 회랑은 x −512..12000 으로 한 화면(±960)의 6배가 넘는다.
// 실측 결과 L1·L2 프리뷰의 비배경 픽셀이 0.45% 였다 — 안내문("공격자가 이 레이어에서 실제로
// 보는 모습이다")과 정면으로 어긋나는 사실상 빈 화면이었다.
//
// 그래서 카메라를 **배치물 자체**에 맞춘다:
//   ① 살아 있는 엔티티의 AABB 합집합(벽은 반높이 `aabbH` 를 쓴다)을 재고,
//   ② 그 상자를 뷰포트에 담는 배율을 구하되 — 한 화면의 2배(FIT_FLOOR) 안에 들어오면 그대로
//      담고(MAX 로만 clamp), 그보다 크면 담기를 포기하고 크롭 배율(MIN_ZOOM)로 결단하고,
//   ③ 담기는 축은 콘텐츠 중심, **담기지 않는 축(=크롭)은 공격자(플레이어) 위치**를
//      중심으로 잡은 뒤 콘텐츠 상자 안으로 밀어 넣는다(사용자 지시: "코어 주변 크롭").
// L1·L3 는 ②에서 전부 담기고, L2 회랑만 입구 쪽이 크롭되어 크게 보인다.

/** 월드 좌표계의 축 정렬 사각형(프리뷰 판정 전용). */
export interface PreviewBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** 콘텐츠 상자에 두는 여백(월드 단위) — 가장자리 엔티티가 액자에 붙지 않게. */
export const PREVIEW_CONTENT_PAD = 120;

/**
 * **크롭할 때** 쓰는 축소 배율(공격자 한 화면 = {@link previewFit} 배율 대비). 0.65 = 한 화면의
 * 1.54배. 이 값이 없으면 L2 회랑(폭 12500)이 배율 0.06 으로 찌부러진다.
 *
 * 주의: 이것은 "모든 카메라의 하한"이 **아니다**. 하한으로 쓰면 조금 큰 배치가 통째로 잘린다
 * (아래 {@link PREVIEW_FIT_FLOOR} 주석의 강습 돌격편대 실측 참고).
 */
export const PREVIEW_MIN_ZOOM = 0.65;
/** 확대 상한(같은 기준). 코어 하나만 있는 빈 배치가 화면을 채우며 뭉개지는 것을 막는다. */
export const PREVIEW_MAX_ZOOM = 2.2;
/**
 * "담을 수 있는가"의 문턱(같은 기준). 필요한 배율이 이 값 이상이면 **크롭하지 않고 전부 담는다**
 * — 즉 프레임이 한 화면의 최대 2배(1/0.5)까지 넓어지는 것을 허용한다.
 *
 * ## 왜 문턱이 따로 필요한가 (실측)
 * {@link PREVIEW_MIN_ZOOM} 을 하한으로 쓰면 "조금 안 담기는" 배치가 담기는 대신 **잘린다**.
 * 강습 돌격편대(catalogId 2, ENTRY_CHARGE)는 y −2156..32 로 콘텐츠 높이 2428 이라 담으려면
 * 배율 0.2339(= base 0.40625 의 0.576배)가 필요한데, 하한 0.65 가 0.2641 로 끌어올리고 크롭
 * 앵커가 공격자(y 0)로 잡혀 가시 범위가 y −1999..152 가 됐다 → **4기 전원이 프레임 위로
 * 이탈**(뷰포트 로컬 ly = 0/0/−32/−32, h=568). 6슬롯 전부 동일하게 실패했다.
 *
 * 그래서 규칙을 "하한"이 아니라 **결단**으로 바꾼다: 2배 안에 들어오면 전부 담고, 그보다 크면
 * (L2 회랑 = 6.5배) 애초에 담는 것을 포기하고 0.65 로 크게 보여주며 입구를 크롭한다.
 * 0.5 는 강습 편대가 요구하는 0.576 아래로 여유를 두면서, L2 크롭 배율은 그대로 두는 값이다.
 */
export const PREVIEW_FIT_FLOOR = 0.5;

/** 카메라 결과 — 배율 + 월드 좌표계의 화면 중심. */
export interface PreviewCamera {
  readonly scale: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** 엔티티 1개가 차지하는 월드 사각형. 벽만 반높이가 `aabbH` 다(반폭은 `radius`). */
export function entityPreviewBox(e: EntitySnapshot): PreviewBox {
  const hx = e.radius;
  const hy = e.kind === 'wall' ? e.aabbH : e.radius;
  return { minX: e.x - hx, minY: e.y - hy, maxX: e.x + hx, maxY: e.y + hy };
}

/** 두 상자의 합집합. */
function unionBox(a: PreviewBox, b: PreviewBox): PreviewBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** `inner` 가 `outer` 안에 완전히 들어오는가(테스트가 프레임 판정에 쓴다). */
export function boxContains(outer: PreviewBox, inner: PreviewBox): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

/**
 * 스냅샷의 살아 있는 엔티티 전체를 덮는 상자. 엔티티가 없으면 null.
 * 플레이어도 포함한다 — 공격자가 어디서 들어오는지가 배치 판독의 일부다.
 */
export function previewContentBox(snap: WorldSnapshot): PreviewBox | null {
  let box: PreviewBox | null = null;
  for (const e of snap.entities) {
    const b = entityPreviewBox(e);
    box = box === null ? b : unionBox(box, b);
  }
  return box;
}

/** 크롭 시 중심으로 삼을 지점(공격자 본체). 없으면 null. */
export function previewAnchor(snap: WorldSnapshot): { x: number; y: number } | null {
  for (const e of snap.entities) {
    if (e.kind === 'player') return { x: e.x, y: e.y };
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 콘텐츠 상자를 뷰포트에 담는 카메라를 구한다. **순수** — Pixi 없이 테스트한다.
 *
 * @param anchor 크롭이 일어나는 축에서 중심으로 삼을 지점(보통 플레이어). null 이면 콘텐츠 중심.
 */
export function previewCamera(
  view: PreviewViewport,
  content: PreviewBox | null,
  anchor: { x: number; y: number } | null = null,
): PreviewCamera {
  const base = previewFit(view).scale;
  if (content === null) return { scale: base, centerX: 0, centerY: 0 };

  const pad = PREVIEW_CONTENT_PAD;
  const minX = content.minX - pad;
  const maxX = content.maxX + pad;
  const minY = content.minY - pad;
  const maxY = content.maxY + pad;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  // 담을 수 있으면 담고(문턱 위), 담을 수 없으면 크롭 배율로 결단한다. clamp 하나로 처리하면
  // "조금 안 담기는" 배치가 담기는 대신 잘린다({@link PREVIEW_FIT_FLOOR} 주석의 실측).
  const fit = Math.min(view.w / w, view.h / h);
  const scale =
    fit >= base * PREVIEW_FIT_FLOOR
      ? Math.min(fit, base * PREVIEW_MAX_ZOOM)
      : base * PREVIEW_MIN_ZOOM;

  const halfW = view.w / 2 / scale;
  const halfH = view.h / 2 / scale;
  // 담기는 축은 콘텐츠 중심. 담기지 않는 축(크롭)은 공격자 위치를 중심으로 잡되
  // 콘텐츠 밖 허공이 열리지 않게 상자 안으로 민다.
  const centerX =
    halfW * 2 >= w
      ? (minX + maxX) / 2
      : clamp(anchor?.x ?? (minX + maxX) / 2, minX + halfW, maxX - halfW);
  const centerY =
    halfH * 2 >= h
      ? (minY + maxY) / 2
      : clamp(anchor?.y ?? (minY + maxY) / 2, minY + halfH, maxY - halfH);
  return { scale, centerX, centerY };
}

/** 이 카메라로 실제로 보이는 월드 사각형(프레임). 순수. */
export function previewVisibleBox(view: PreviewViewport, cam: PreviewCamera): PreviewBox {
  const halfW = view.w / 2 / cam.scale;
  const halfH = view.h / 2 / cam.scale;
  return {
    minX: cam.centerX - halfW,
    minY: cam.centerY - halfH,
    maxX: cam.centerX + halfW,
    maxY: cam.centerY + halfH,
  };
}

/**
 * 카메라 → 스케일 컨테이너 배치(뷰포트 로컬 좌표).
 *
 * {@link EntityRenderer} 는 자기 레이어를 `(DW/2 − camX, DH/2 − camY)` 로 옮기므로 월드 점
 * `w` 는 스케일 컨테이너 안에서 `w + D/2 − cam` 에 있다. 그 점이 뷰포트 정중앙에 오도록
 * 컨테이너를 민다. `snapCameraX/Y` 는 **스냅샷의 카메라**(공격자 시점)이고
 * `cam.centerX/Y` 는 프리뷰가 보고 싶은 지점이다 — 둘은 다르다.
 */
export function previewScalerPlacement(
  view: PreviewViewport,
  cam: PreviewCamera,
  snapCameraX: number,
  snapCameraY: number,
): PreviewFit {
  return {
    scale: cam.scale,
    x: view.w / 2 - cam.scale * (cam.centerX + DESIGN_WIDTH / 2 - snapCameraX),
    y: view.h / 2 - cam.scale * (cam.centerY + DESIGN_HEIGHT / 2 - snapCameraY),
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

/** 프리뷰 배경(우주 어둠) — 패널 안이 뚫려 보이지 않게 항상 채운다. 대비 계약의 기준색. */
export const PREVIEW_BG = 0x0b0a18;

// ---------------------------------------------------------------------------
// 대비 마커 — 축소된 실루엣이 배경에 묻히는 문제
// ---------------------------------------------------------------------------
//
// 실측: L3 에서 보스·기물·수호가 지름 30px 안팎의 **거의 검정 실루엣**으로 찍혀 배경
// (RGB 28,24,46)과 명도차가 거의 없었다. 아트를 새로 만들지 않고(지시), 기존 팔레트 색으로
// 엔티티마다 링 + 옅은 채움을 깔아 위치·종류가 읽히게 한다. 링은 **화면 기준 굵기·최소
// 반지름**을 갖도록 배율로 나눠 그리므로 축소돼도 사라지지 않는다.

/** 마커 최소 반지름(화면 px) — 이보다 작게는 줄어들지 않는다. */
export const PREVIEW_MARK_MIN_R = 9;
/** 마커 링 굵기(화면 px). */
export const PREVIEW_MARK_WIDTH = 2;
/** 링 채움 불투명도. 스프라이트 **위**에 얹히므로 아트를 지우지 않을 만큼만 든다. */
export const PREVIEW_MARK_FILL_ALPHA = 0.2;
/** 링 테두리 불투명도 — 판독의 주역이라 거의 불투명하다. */
export const PREVIEW_MARK_STROKE_ALPHA = 0.95;

/**
 * 스케일 컨테이너의 자식 순서(뒤 → 앞). **마커가 스프라이트 위**라는 것이 이 배열의 전부이자
 * 요점이다.
 *
 * 마커를 아래에 깔았을 때 실측: 마커 반지름 `max(radius, minR)` 은 대부분의 배치물에서 곧
 * 스프라이트 실루엣 반지름과 같아, 링이 통째로 스프라이트에 덮여 화면에 한 픽셀도 남지
 * 않았다. 마커의 존재 이유가 "어두운 실루엣을 대신 읽게 하는 것"이므로 순서가 뒤집히면
 * 기능이 0 이 된다. 컨테이너 조립이 이 배열에서 파생되므로 테스트가 배열만 보면 된다.
 */
export const PREVIEW_LAYER_ORDER = ['sprites', 'marks'] as const;
export type PreviewLayerName = (typeof PREVIEW_LAYER_ORDER)[number];

/** 마커 1개의 기하·색(월드 단위). **순수** — 픽셀 없이 판독성 계약을 검증한다. */
export interface PreviewMarkStyle {
  readonly color: number;
  /** 원 마커 반지름(월드 단위). 벽은 이 값을 쓰지 않는다. */
  readonly r: number;
  /** 링 굵기(월드 단위) — 화면에서 항상 {@link PREVIEW_MARK_WIDTH} px 이 되도록 배율로 나눈 값. */
  readonly width: number;
  readonly fillAlpha: number;
  readonly strokeAlpha: number;
}

/**
 * 엔티티 + 카메라 배율 → 마커 스타일. 색이 없는 종류(탄·젬)는 null.
 *
 * 반지름은 `max(실루엣 반지름, 화면 최소치) + 굵기` 다. 굵기만큼 밖으로 밀어 링이 실루엣을
 * **덮는 대신 두르게** 한다 — 축소된 어두운 아트에서 윤곽이 먼저 읽힌다.
 */
export function previewMarkStyle(e: EntitySnapshot, scale: number): PreviewMarkStyle | null {
  const color = previewMarkColor(e.kind);
  if (color === null || !(scale > 0)) return null;
  const width = PREVIEW_MARK_WIDTH / scale;
  const r = Math.max(e.radius, PREVIEW_MARK_MIN_R / scale) + width;
  return {
    color,
    r,
    width,
    fillAlpha: PREVIEW_MARK_FILL_ALPHA,
    strokeAlpha: PREVIEW_MARK_STROKE_ALPHA,
  };
}

/**
 * 엔티티 종류 → 마커 색. 배치 판독에 필요한 것만 칠한다(탄·젬 등은 null = 안 그린다).
 * 색 문법: 공격자 청록 / 편대 적 · 보스 붉은 계열 / 설비 호박 / 기물 자주 / 수호 연두 /
 * 코어 금색 · 벽 회청.
 */
export function previewMarkColor(kind: string): number | null {
  switch (kind) {
    case 'player':
      return 0x4ff0d0;
    case 'enemy':
    case 'formation':
    case 'formationDrone':
    case 'spawnedDrone':
      return 0xff6a5a;
    case 'boss':
    case 'defenseBoss':
      return 0xff3f7a;
    case 'facilityGun':
    case 'facilityHazard':
    case 'facilitySpawner':
      return 0xffb14c;
    case 'prop':
      return 0xc07aff;
    case 'guardian':
      return 0x8fd94c;
    case 'core':
    case 'decoyCore':
      return 0xffd678;
    case 'wall':
    case 'destructible':
      return 0x6e7ba8;
    default:
      return null;
  }
}

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
  /** 대비 마커(월드 좌표계) — 스프라이트 **위**에 얹힌다({@link PREVIEW_LAYER_ORDER}). */
  private readonly marks = new Graphics();
  private readonly markLayer = new Container();

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
    this.markLayer.addChild(this.marks);
    // 자식 순서는 PREVIEW_LAYER_ORDER 에서 파생한다 — 그 배열이 z 계약의 정본이다.
    for (const name of PREVIEW_LAYER_ORDER) {
      this.scaler.addChild(name === 'marks' ? this.markLayer : this.renderer.layer);
    }
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

    const world = buildPreviewWorld({
      layers: this.layers,
      phase: this.phase,
      slotIndex: this.slotIndex,
    });
    const snap = snapshotWorld(world);
    // 매 재구성은 **다른 월드**다 — 렌더러 상태를 물려받으면 안 된다.
    //
    // ① 유령 폭발: `EntityRenderer` 는 "지난 프레임에 있었는데 이번에 없는" 스프라이트를 격추로
    //    보고 폭발 이펙트를 남긴다. 레이어를 바꾸면 이전 월드의 엔티티가 통째로 사라지므로
    //    수십 개가 한꺼번에 생기는데, 프리뷰는 **정지 1프레임 렌더**라 수명(24프레임)이 줄 기회가
    //    없다. 실측: L1(0) → L2(14) → L3(20) → L1(34) … 단조 증가했고, L1 로 돌아오면 L2/L3
    //    좌표(x 6000·10800)의 주황 폭발이 화면에서 가장 밝고 큰 물체였다.
    // ② 텍스처 오배정: 스프라이트는 **엔티티 id 로만** 캐시되고 텍스처는 생성 시점에 묶인다.
    //    새 월드는 id 를 0부터 다시 발급하므로 id 가 겹치는 만큼 이전 레이어의 그림(적)이 다음
    //    레이어의 엔티티(벽·코어)로 재사용된다.
    // 둘 다 "렌더러가 이전 월드를 기억한다"는 하나의 원인이라 리셋 한 번으로 닫는다. 프리뷰는
    // 변경 시 1회만 재구성하고(위 signature 가드) 그 1회가 이미 침공 월드 조립을 포함하므로
    // 스프라이트 캐시를 버리는 비용은 무시할 수 있다.
    this.renderer.reset();
    // 보간 없는 정지 렌더 — prev === curr, alpha 1.
    this.renderer.render(snap, snap, 1);

    // 카메라는 공격자 시점 고정이 아니라 **배치물**에 맞춘다(모듈 상단 주석 참고).
    const cam = previewCamera(v, previewContentBox(snap), previewAnchor(snap));
    const place = previewScalerPlacement(v, cam, snap.cameraX, snap.cameraY);
    this.scaler.position.set(place.x, place.y);
    this.scaler.scale.set(place.scale);
    // 마커는 스프라이트와 같은 월드 오프셋을 쓴다(EntityRenderer 가 자기 레이어에 건 것과 동일).
    this.markLayer.position.set(
      DESIGN_WIDTH / 2 - snap.cameraX,
      DESIGN_HEIGHT / 2 - snap.cameraY,
    );
    this.drawMarks(snap, cam.scale);
  }

  /** 축소돼도 사라지지 않는 대비 마커(화면 기준 굵기 — 배율로 나눈다). */
  private drawMarks(snap: WorldSnapshot, scale: number): void {
    const g = this.marks;
    g.clear();
    if (scale <= 0) return;
    for (const e of snap.entities) {
      const s = previewMarkStyle(e, scale);
      if (s === null) continue;
      if (e.kind === 'wall') {
        const hy = Math.max(e.aabbH, s.width);
        g.rect(e.x - e.radius, e.y - hy, e.radius * 2, hy * 2)
          .fill({ color: s.color, alpha: s.fillAlpha })
          .stroke({ color: s.color, width: s.width, alpha: s.strokeAlpha });
        continue;
      }
      g.circle(e.x, e.y, s.r)
        .fill({ color: s.color, alpha: s.fillAlpha })
        .stroke({ color: s.color, width: s.width, alpha: s.strokeAlpha });
    }
  }
}
