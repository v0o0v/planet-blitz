/**
 * 방어 배치 프리뷰 **프레임 판정** — 배치물이 실제로 화면 안에 들어오는가 (A-1 · A-2).
 *
 * ## 왜 별도 파일인가
 * 기존 `defenseCommandPixi.test.ts` 는 "프리뷰 월드에 벽·설비·코어가 **선다**"까지만 봤다.
 * 그건 전부 초록이었는데도 실화면은 비어 있었다 — 세워진 엔티티가 **프레임 밖**이었기
 * 때문이다(L1 편대는 창 위 y −1610..−32, L2 회랑은 x −512..12000 인데 공격자 카메라 고정
 * 프레임은 x ±960 · y ±699 만 담았다. 비배경 픽셀 0.45%). "존재한다"와 "보인다"는 다른
 * 명제이고, 후자를 못 박는 테스트가 없었다.
 *
 * 그래서 이 파일은 픽셀을 그리지 않고 **카메라 변환만으로** 판정한다:
 *   보이는 월드 사각형 ⊇ 각 배치 엔티티의 AABB.
 * 순수 함수(`previewCamera` / `previewVisibleBox`)로 계산하므로 캔버스 없이 돈다.
 */

import { describe, it, expect } from 'vitest';
import { Texture } from 'pixi.js';
import {
  DefensePreviewController,
  buildPreviewWorld,
  previewFit,
  previewCamera,
  previewContentBox,
  previewVisibleBox,
  previewAnchor,
  previewScalerPlacement,
  entityPreviewBox,
  boxContains,
  previewMarkColor,
  previewMarkStyle,
  PREVIEW_BG,
  PREVIEW_LAYER_ORDER,
  PREVIEW_MARK_MIN_R,
  PREVIEW_MARK_WIDTH,
  PREVIEW_MARK_FILL_ALPHA,
  PREVIEW_MARK_STROKE_ALPHA,
  type PreviewViewport,
} from '../src/render/defensePreview.js';
import { previewChildIndex } from '../src/ui/pixi/defenseCommand.js';
import { snapshotWorld, type WorldSnapshot } from '../src/sim/snapshot.js';
import { buildInvasionPreset } from '../src/harness/presets.js';
import {
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
  normalizeInvasionLayers,
  type InvasionLayers,
  type InvasionPhase,
} from '../src/sim/invasion/index.js';
import { FORMATIONS, FORMATION_ASSAULT } from '../data/invasion/formations.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../src/render/app.js';
import { EntityRenderer } from '../src/render/entityRenderer.js';
import { type PlaceholderTextures } from '../src/render/textures.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';

/**
 * 실측 뷰포트(방어 사령부 좌측 프리뷰 상자, 디자인 스페이스). 라이브 플레이테스트에서
 * 측정된 값 그대로다 — 수치가 바뀌면 이 테스트가 먼저 깨져야 한다.
 */
const VIEW: PreviewViewport = { x: 96, y: 276, w: 780, h: 568 };

const LAYERS = buildInvasionPreset('def3-mid');

function previewSnap(phase: InvasionPhase, slotIndex = 0): WorldSnapshot {
  return snapshotWorld(buildPreviewWorld({ layers: LAYERS, phase, slotIndex }));
}

/**
 * 렌더러를 실제로 돌리는 케이스용 텍스처. **진짜 Pixi Texture** 여야 `new Sprite()` 를 통과한다
 * (tests/entityRendererShipSwap.test.ts 와 같은 방식).
 */
function stubTextures(): PlaceholderTextures {
  const tex = (label: string): Texture => new Texture({ source: Texture.EMPTY.source, label });
  const arr = (name: string, n: number): Texture[] =>
    Array.from({ length: n }, (_, i) => tex(`${name}[${i}]`));
  return {
    player: tex('player'),
    shipByType: SHIP_TYPES.map((d) => tex(`ship[${d.id}]`)),
    bullet: tex('bullet'),
    enemyBullet: tex('enemyBullet'),
    enemyBulletBehaviors: arr('enemyBulletBehaviors', 4),
    gem: tex('gem'),
    enemy: arr('enemy', 22),
    boss: arr('boss', 4),
    supply: tex('supply'),
    parachute: null,
    loot: tex('loot'),
    explosion: tex('explosion'),
    background: arr('background', 4),
    wall: tex('wall'),
    destructible: tex('destructible'),
    magnetEmitter: tex('magnetEmitter'),
    bombDevice: tex('bombDevice'),
    turretPickup: tex('turretPickup'),
    shelter: tex('shelter'),
    encounterPortal: tex('encounterPortal'),
    encounterSeal: tex('encounterSeal'),
    encounterAltar: tex('encounterAltar'),
    core: tex('core'),
    guardian: arr('guardian', 2),
    invasionBackdrop: arr('invasionBackdrop', 3),
    facility: arr('facility', FACILITY_CATALOG_COUNT),
    prop: arr('prop', PROP_ROLE_COUNT),
    defenseBoss: arr('defenseBoss', DEFENSE_BOSS_COUNT),
    formation: tex('formation'),
    formationDrone: tex('formationDrone'),
    spawnedDrone: tex('spawnedDrone'),
  };
}

/**
 * 컨트롤러가 실제로 쓰는 렌더러(비공개 필드). 계약을 **정규 경로 위에서** 재야 "단위는 초록인데
 * 배선이 없다"는 이 프로젝트의 반복 결함을 잡을 수 있다.
 */
function previewRenderer(preview: DefensePreviewController): EntityRenderer {
  return (preview as unknown as { renderer: EntityRenderer }).renderer;
}

/** 웨이브 6칸 전부를 한 편대로 채운 배치(전수 순회용). 정규화를 거쳐 실제 배치와 같은 모양이 된다. */
function layersAllSlots(catalogId: number): InvasionLayers {
  const base = normalizeInvasionLayers(null);
  return normalizeInvasionLayers({
    ...base,
    l1: {
      ...base.l1,
      waveSlots: base.l1.waveSlots.map(() => ({
        catalogId,
        level: 60,
        ascension: 3,
        rarity: 3,
      })),
    },
  });
}

/** 이 스냅샷을 프리뷰가 실제로 쓰는 순서 그대로 카메라에 태운다(정규 경로). */
function frameOf(snap: WorldSnapshot, view: PreviewViewport = VIEW) {
  const cam = previewCamera(view, previewContentBox(snap), previewAnchor(snap));
  return { cam, visible: previewVisibleBox(view, cam) };
}

// ---------------------------------------------------------------------------
// A-1 — 배치물이 프레임 안에 들어온다
// ---------------------------------------------------------------------------

describe('프리뷰 프레임이 배치물을 담는다', () => {
  it('구 카메라(공격자 시점 고정)에서는 L1 편대가 프레임 밖이었다 — 회귀 기준선', () => {
    const snap = previewSnap(PHASE_L1);
    const fit = previewFit(VIEW);
    // 구 동작: 스케일 컨테이너를 화면 정중앙에 두어 카메라 지점을 뷰포트 중앙에 올렸다.
    const halfH = VIEW.h / 2 / fit.scale;
    const oldVisible = {
      minX: snap.cameraX - VIEW.w / 2 / fit.scale,
      maxX: snap.cameraX + VIEW.w / 2 / fit.scale,
      minY: snap.cameraY - halfH,
      maxY: snap.cameraY + halfH,
    };
    const enemies = snap.entities.filter((e) => e.kind === 'enemy');
    expect(enemies.length).toBeGreaterThan(0);
    // 편대 대부분이 옛 프레임 위쪽 밖에 있었다(그래서 사실상 빈 화면이었다).
    const outside = enemies.filter((e) => !boxContains(oldVisible, entityPreviewBox(e)));
    expect(outside.length).toBe(enemies.length);
  });

  it('L1: 선택 슬롯 편대 전원이 프레임 안에 든다', () => {
    for (const slot of [0, 1, 2, 3, 4, 5]) {
      const snap = previewSnap(PHASE_L1, slot);
      const { visible } = frameOf(snap);
      for (const e of snap.entities) {
        expect(
          boxContains(visible, entityPreviewBox(e)),
          `L1 슬롯${slot} ${e.kind} @(${e.x},${e.y}) 가 프레임 밖`,
        ).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 전수 — 편대 카탈로그 × 슬롯 6칸
  // -------------------------------------------------------------------------
  //
  // 위 케이스는 **한 프리셋**(def3-mid)의 슬롯만 돈다. 그래서 그 프리셋에 들어 있지 않은
  // 편대는 한 번도 프레임 판정을 받지 않았고, 실제로 강습 돌격편대(catalogId 2, ENTRY_CHARGE)가
  // 6슬롯 전부에서 전원 이탈하는데도 초록이었다. 배치할 수 있는 것은 카탈로그 전부이므로
  // 판정도 **레지스트리 파생 전수**여야 한다.

  it('L1 전수: 편대 카탈로그 8종 × 슬롯 6칸 전부가 프레임 안에 든다', () => {
    // 공허 검증 방지 — 카탈로그가 비면 루프가 통과해 버린다.
    expect(FORMATIONS.length).toBeGreaterThanOrEqual(8);
    for (const def of FORMATIONS) {
      const layers = layersAllSlots(def.catalogId);
      for (const slot of [0, 1, 2, 3, 4, 5]) {
        const snap = snapshotWorld(
          buildPreviewWorld({ layers, phase: PHASE_L1, slotIndex: slot }),
        );
        // 그 편대가 실제로 섰는지 먼저 확인한다(스폰이 조용히 건너뛰면 전부 통과한다).
        const enemies = snap.entities.filter((e) => e.kind !== 'player');
        expect(enemies.length, `${def.id} 슬롯${slot} 스폰 0`).toBe(def.members.length);
        const { visible } = frameOf(snap);
        for (const e of snap.entities) {
          expect(
            boxContains(visible, entityPreviewBox(e)),
            `${def.id}(cat${def.catalogId}) 슬롯${slot} ${e.kind} @(${e.x},${e.y}) 가 프레임 밖` +
              ` — 프레임 y ${visible.minY.toFixed(0)}..${visible.maxY.toFixed(0)}`,
          ).toBe(true);
        }
      }
    }
  });

  it('강습 돌격편대(ENTRY_CHARGE) 실측 회귀 — 하한 0.65 로 끌어올리면 4기 전원이 위로 잘렸다', () => {
    const layers = layersAllSlots(FORMATION_ASSAULT);
    const snap = snapshotWorld(buildPreviewWorld({ layers, phase: PHASE_L1, slotIndex: 2 }));

    // ① 실측 좌표를 **리터럴로** 박는다(상수 파생 금지 — 동어반복이 된다).
    const content = previewContentBox(snap)!;
    expect(content.minY).toBeCloseTo(-2156, 6);
    expect(content.maxY).toBeCloseTo(32, 6);
    // 여백 120 포함 콘텐츠 높이 2428 → 뷰포트 h 568 을 담으려면 배율 0.2339 가 필요하다.
    expect(568 / (2428)).toBeCloseTo(0.2339, 4);

    // ② 구 동작(배율을 0.65×base = 0.2641 로 끌어올리고 공격자 y=0 앵커로 크롭)의 프레임을
    //    재현해 실패를 못 박는다 — 편대 4기가 전원 프레임 위로 나갔다.
    const oldScale = 0.2641;
    const halfH = VIEW.h / 2 / oldScale;
    const oldCenterY = Math.min(0, content.maxY + 120 - halfH);
    const oldVisible = {
      minX: -1e9,
      maxX: 1e9,
      minY: oldCenterY - halfH,
      maxY: oldCenterY + halfH,
    };
    const enemies = snap.entities.filter((e) => e.kind !== 'player');
    expect(enemies.length).toBe(4);
    expect(enemies.filter((e) => !boxContains(oldVisible, entityPreviewBox(e))).length).toBe(4);

    // ③ 현재 동작: 배율 0.2339(리터럴)로 전부 담는다.
    const { cam, visible } = frameOf(snap);
    expect(cam.scale).toBeGreaterThan(0.23);
    expect(cam.scale).toBeLessThan(0.2641);
    for (const e of snap.entities) {
      expect(boxContains(visible, entityPreviewBox(e)), `${e.kind} @(${e.x},${e.y})`).toBe(true);
    }
  });

  it('L3: 코어·보스·수호·기물이 전부 프레임 안에 든다', () => {
    const snap = previewSnap(PHASE_L3);
    const { visible } = frameOf(snap);
    const kinds = new Set(snap.entities.map((e) => e.kind));
    // 공허 검증 방지 — 실제로 코어방 구성물이 서 있는 스냅샷인지 먼저 확인한다.
    expect(kinds.has('core')).toBe(true);
    expect(kinds.has('defenseBoss')).toBe(true);
    expect(kinds.has('prop')).toBe(true);
    for (const e of snap.entities) {
      expect(boxContains(visible, entityPreviewBox(e)), `L3 ${e.kind} 가 프레임 밖`).toBe(true);
    }
  });

  it('L2 회랑은 한 프레임에 담기지 않으므로 입구 쪽을 크롭한다(공격자 위치 기준)', () => {
    const snap = previewSnap(PHASE_L2);
    const content = previewContentBox(snap)!;
    // 회랑은 실제로 한 화면(±960)의 여러 배다 — 크롭이 불가피한 상황임을 못 박는다.
    expect(content.maxX - content.minX).toBeGreaterThan(DESIGN_WIDTH * 3);

    const { cam, visible } = frameOf(snap);
    const player = snap.entities.find((e) => e.kind === 'player')!;
    // ① 공격자가 프레임 안에 있다(어디를 보는지 알 수 있어야 한다).
    expect(boxContains(visible, entityPreviewBox(player))).toBe(true);
    // ② 프레임이 콘텐츠 상자 밖 허공으로 벗어나지 않는다.
    expect(visible.minX).toBeGreaterThanOrEqual(content.minX - 200);
    // ③ 입구 구간의 배치물이 최소 한 개는 보인다(빈 화면 금지).
    const shown = snap.entities.filter(
      (e) => e.kind !== 'player' && boxContains(visible, entityPreviewBox(e)),
    );
    expect(shown.length).toBeGreaterThan(0);
    // ④ 세로는 회랑 전체가 담긴다(크롭은 진행축에서만 일어난다).
    expect(visible.minY).toBeLessThanOrEqual(content.minY);
    expect(visible.maxY).toBeGreaterThanOrEqual(content.maxY);
    // 크롭 배율은 **리터럴** 0.65×base 다(상수 파생 금지 — 상수를 낮추는 뮤테이션이 통과한다).
    expect(cam.scale / previewFit(VIEW).scale).toBeCloseTo(0.65, 6);
  });

  it('빈 배치(기본 수비대만)도 프레임 안에 담긴다', () => {
    for (const phase of [PHASE_L1, PHASE_L3] as const) {
      const snap = snapshotWorld(buildPreviewWorld({ layers: null, phase }));
      const { visible } = frameOf(snap);
      for (const e of snap.entities) {
        expect(boxContains(visible, entityPreviewBox(e)), `빈 배치 L${phase + 1} ${e.kind}`).toBe(
          true,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A-2 — 배율이 판독 가능한 범위 안에 있다
// ---------------------------------------------------------------------------

describe('프리뷰 배율(판독성)', () => {
  it('배율은 항상 [한 화면×0.5, 한 화면×2.2] 안이다 — 편대 전수 포함', () => {
    // 기준치는 **리터럴**이다. 상수에서 파생시키면 상수를 바꾸는 뮤테이션이 통과한다.
    const base = previewFit(VIEW).scale;
    const check = (scale: number, what: string): void => {
      expect(scale, `${what} 너무 작다`).toBeGreaterThanOrEqual(base * 0.5 - 1e-9);
      expect(scale, `${what} 너무 크다`).toBeLessThanOrEqual(base * 2.2 + 1e-9);
    };
    for (const phase of [PHASE_L1, PHASE_L2, PHASE_L3] as const) {
      check(frameOf(previewSnap(phase)).cam.scale, `L${phase + 1}`);
    }
    for (const def of FORMATIONS) {
      const layers = layersAllSlots(def.catalogId);
      for (const slot of [0, 1, 2, 3, 4, 5]) {
        const snap = snapshotWorld(
          buildPreviewWorld({ layers, phase: PHASE_L1, slotIndex: slot }),
        );
        check(frameOf(snap).cam.scale, `${def.id} 슬롯${slot}`);
      }
    }
  });

  it('한 화면 2배를 넘는 콘텐츠만 크롭 배율(×0.65)로 결단한다', () => {
    const base = previewFit(VIEW).scale;
    // 회랑급(한 화면의 6배 이상) — 담기를 포기하고 0.65 로 고정한다.
    const huge = previewCamera(VIEW, { minX: -6000, minY: -400, maxX: 6000, maxY: 400 });
    expect(huge.scale / base).toBeCloseTo(0.65, 6);
    // 문턱 바로 위(담을 수 있는 크기) — 크롭하지 않고 그대로 담는다.
    const w = VIEW.w / (base * 0.55) - 2 * 120; // 여백 120 을 뺀 콘텐츠 폭
    const fits = previewCamera(VIEW, { minX: -w / 2, minY: -100, maxX: w / 2, maxY: 100 });
    expect(fits.scale / base).toBeCloseTo(0.55, 3);
    expect(fits.scale).toBeLessThan(huge.scale);
  });

  it('L3 코어방은 구 고정 배율보다 크게 보인다(크롭 조정 지시)', () => {
    const { cam } = frameOf(previewSnap(PHASE_L3));
    expect(cam.scale).toBeGreaterThan(previewFit(VIEW).scale);
  });

  it('콘텐츠가 작을수록 확대된다(단조성) — 배율이 내용과 무관하지 않다', () => {
    const wide = previewCamera(VIEW, { minX: -4000, minY: -400, maxX: 4000, maxY: 400 });
    const tight = previewCamera(VIEW, { minX: -200, minY: -200, maxX: 200, maxY: 200 });
    expect(tight.scale).toBeGreaterThan(wide.scale);
  });

  it('엔티티가 없으면 한 화면 배율로 폴백한다(0 나눗셈·NaN 금지)', () => {
    const cam = previewCamera(VIEW, null);
    expect(cam.scale).toBeCloseTo(previewFit(VIEW).scale);
    expect(Number.isFinite(cam.centerX)).toBe(true);
    expect(Number.isFinite(cam.centerY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 좌표 변환 — 스케일 컨테이너 배치가 카메라와 정합한다
// ---------------------------------------------------------------------------

describe('스케일 컨테이너 배치', () => {
  /** EntityRenderer 규약을 그대로 재현한 화면 좌표 환산(뷰포트 로컬). */
  function toScreen(
    world: { x: number; y: number },
    place: { scale: number; x: number; y: number },
    snapCameraX: number,
    snapCameraY: number,
  ): { x: number; y: number } {
    return {
      x: place.x + place.scale * (world.x + DESIGN_WIDTH / 2 - snapCameraX),
      y: place.y + place.scale * (world.y + DESIGN_HEIGHT / 2 - snapCameraY),
    };
  }

  it('카메라 중심이 뷰포트 정중앙에 온다', () => {
    const snap = previewSnap(PHASE_L1);
    const { cam } = frameOf(snap);
    const place = previewScalerPlacement(VIEW, cam, snap.cameraX, snap.cameraY);
    const p = toScreen({ x: cam.centerX, y: cam.centerY }, place, snap.cameraX, snap.cameraY);
    expect(p.x).toBeCloseTo(VIEW.w / 2);
    expect(p.y).toBeCloseTo(VIEW.h / 2);
  });

  it('프레임 안이라고 판정된 엔티티는 뷰포트 사각형 안에 찍힌다', () => {
    const snap = previewSnap(PHASE_L3);
    const { cam } = frameOf(snap);
    const place = previewScalerPlacement(VIEW, cam, snap.cameraX, snap.cameraY);
    for (const e of snap.entities) {
      const p = toScreen(e, place, snap.cameraX, snap.cameraY);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(VIEW.w);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(VIEW.h);
    }
  });
});

// ---------------------------------------------------------------------------
// 대비 마커
// ---------------------------------------------------------------------------

describe('대비 마커', () => {
  it('L3 코어방 구성물에 전부 마커 색이 있다(검정 실루엣 방지)', () => {
    const snap = previewSnap(PHASE_L3);
    for (const e of snap.entities) {
      expect(previewMarkColor(e.kind), `${e.kind} 마커 색 누락`).not.toBeNull();
    }
  });

  it('배치와 무관한 종류(탄·젬)는 마커를 그리지 않는다', () => {
    expect(previewMarkColor('bullet')).toBeNull();
    expect(previewMarkColor('gem')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 판독성 계약 — "사람 눈에 보이는가"를 수치로 못 박는다
// ---------------------------------------------------------------------------
//
// 앞선 재검증은 "배경색 ±6 이면 비배경"이라는 계측으로 L2 18.37% 통과를 냈는데 실화면은
// 여전히 새까맸다 — 계측이 사람 눈과 갈렸다. 원인은 둘이었다:
//   ① 프리뷰 노드가 화면 루트 인덱스 1(액자 **아래**)에 있었고, 액자는 `nineSlicePanel`
//      기본 `fillAlpha: 0.96` 이라 프리뷰 기여분이 4.6% 로 눌렸다(라이브 픽셀 실측:
//      마커 링 0xff6a5a 가 (230,96,83) 대신 (37,27,48) 로 찍혔다).
//   ② 마커가 스프라이트 **아래**라, 반지름이 실루엣과 같아 링이 통째로 덮였다.
// 그래서 아래 계약은 ±N 이 아니라 **상대 휘도 대비비**와 **z 순서**로 쓴다.

/** sRGB 상대 휘도(WCAG 2.x). */
function relLuminance(rgb: number): number {
  const ch = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * ch((rgb >> 16) & 0xff) + 0.7152 * ch((rgb >> 8) & 0xff) + 0.0722 * ch(rgb & 0xff)
  );
}

/** WCAG 대비비(1..21). */
function contrastRatio(a: number, b: number): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const MARK_KINDS = [
  'player',
  'enemy',
  'boss',
  'defenseBoss',
  'facilityGun',
  'prop',
  'guardian',
  'core',
  'wall',
] as const;

describe('프리뷰 판독성 계약', () => {
  it('마커 색은 프리뷰 배경 대비 WCAG 4.5:1 이상이다(명도 대비 기준)', () => {
    for (const kind of MARK_KINDS) {
      const color = previewMarkColor(kind);
      expect(color, `${kind} 마커 색 누락`).not.toBeNull();
      expect(contrastRatio(color!, PREVIEW_BG), `${kind} 대비 부족`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('마커는 스프라이트 **위**에 그려진다 — 아래면 실루엣에 통째로 덮인다', () => {
    const sprites = PREVIEW_LAYER_ORDER.indexOf('sprites');
    const marks = PREVIEW_LAYER_ORDER.indexOf('marks');
    expect(sprites).toBeGreaterThanOrEqual(0);
    expect(marks).toBeGreaterThan(sprites);
  });

  it('프리뷰 노드는 화면 루트 맨 앞이다 — 액자(fillAlpha 0.96) 아래면 4.6% 로 눌린다', () => {
    // 실측 화면의 루트 자식 수 14. 구 동작(상수 1 = 배경 바로 위)은 이 계약을 깬다.
    expect(previewChildIndex(14)).toBe(13);
    expect(previewChildIndex(14)).toBeGreaterThan(1);
    // 방어적: 자식이 없어도 음수 인덱스를 내지 않는다(setChildIndex 가 던진다).
    expect(previewChildIndex(0)).toBe(0);
  });

  it('링 불투명도: 테두리는 거의 불투명, 채움은 아트를 지우지 않는다', () => {
    expect(PREVIEW_MARK_STROKE_ALPHA).toBeGreaterThanOrEqual(0.9);
    expect(PREVIEW_MARK_FILL_ALPHA).toBeGreaterThan(0);
    expect(PREVIEW_MARK_FILL_ALPHA).toBeLessThanOrEqual(0.35);
  });

  it('링은 배율과 무관하게 화면 기준 최소 지름·굵기를 지킨다', () => {
    // 기준치를 상수에서 파생시키지 않고 **숫자로 박는다** — 상수를 1 로 낮추는 뮤테이션을
    // 통과시키지 않기 위해서다(계약은 "9px 이상"이지 "상수와 같다"가 아니다).
    expect(PREVIEW_MARK_MIN_R).toBeGreaterThanOrEqual(9);
    expect(PREVIEW_MARK_WIDTH).toBeGreaterThanOrEqual(2);
    const tiny = { kind: 'guardian', radius: 1, aabbH: 1, x: 0, y: 0 } as never;
    for (const scale of [0.1, 0.26, 0.3, 0.42, 1, 2]) {
      const s = previewMarkStyle(tiny, scale)!;
      expect(s).not.toBeNull();
      // 월드 단위 × 배율 = 화면 px.
      expect(s.width * scale).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(s.r * scale).toBeGreaterThanOrEqual(9);
    }
  });

  it('링이 실루엣을 덮지 않고 두른다 — 반지름이 항상 실루엣보다 크다', () => {
    for (const phase of [PHASE_L1, PHASE_L2, PHASE_L3] as const) {
      const snap = previewSnap(phase);
      const { cam } = frameOf(snap);
      let marked = 0;
      for (const e of snap.entities) {
        const s = previewMarkStyle(e, cam.scale);
        if (s === null) continue;
        marked++;
        expect(s.r, `L${phase + 1} ${e.kind} 링이 실루엣 안쪽`).toBeGreaterThan(e.radius);
      }
      expect(marked, `L${phase + 1} 마커 0개`).toBeGreaterThan(0);
    }
  });

  it('실측 배율(L1/L2/L3)에서 모든 마커가 화면 18px 이상으로 찍힌다', () => {
    for (const phase of [PHASE_L1, PHASE_L2, PHASE_L3] as const) {
      const snap = previewSnap(phase);
      const { cam } = frameOf(snap);
      for (const e of snap.entities) {
        const s = previewMarkStyle(e, cam.scale);
        if (s === null || e.kind === 'wall') continue;
        expect(s.r * cam.scale * 2, `L${phase + 1} ${e.kind} 마커 지름 부족`).toBeGreaterThanOrEqual(
          18,
        );
      }
    }
  });

  it('배율 0 이하(미초기화 뷰포트)에서는 마커를 만들지 않는다 — NaN/Infinity 금지', () => {
    const e = { kind: 'core', radius: 40, aabbH: 40, x: 0, y: 0 } as never;
    expect(previewMarkStyle(e, 0)).toBeNull();
    expect(previewMarkStyle(e, -1)).toBeNull();
    expect(previewMarkStyle(e, Number.NaN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 이펙트 유령 — 정지 1프레임 렌더는 폭발을 페이드아웃시킬 프레임이 없다
// ---------------------------------------------------------------------------
//
// 실측(라이브): 새로고침 직후 L1 → 0, L2 → 14, L3 → 20, 다시 L1 → 34 … 단조 증가했고 절대
// 비워지지 않았다. L1 로 돌아오면 L2/L3 좌표(x 6000·10800, y ±312)의 주황 폭발 6개가 화면에서
// 가장 밝고 큰 물체였다. 원인은 `redraw()` 가 매번 **다른 월드**를 그리면서 렌더러 상태를
// 물려받은 것 — 사라진 엔티티가 전부 격추로 집계돼 폭발이 쌓였다.

describe('프리뷰 이펙트 상태 계약', () => {
  it('레거시 재현: 리셋 없이 다른 월드를 이어 그리면 폭발이 쌓인다(비-공허 증명)', () => {
    const renderer = new EntityRenderer(stubTextures());
    const l1 = previewSnap(PHASE_L1);
    const l2 = previewSnap(PHASE_L2);
    // 엔티티 수가 줄어드는 전환에서 유령이 생긴다(id 는 새 월드마다 0부터 재발급되므로,
    // 이전 월드에만 있던 뒤쪽 id 들이 통째로 "격추"로 집계된다).
    expect(l2.entities.length).toBeGreaterThan(l1.entities.length);
    renderer.render(l2, l2, 1);
    expect(renderer.effectCount).toBe(0);
    // 리셋을 건너뛰고 다음 레이어를 그린다 = 구 동작.
    renderer.render(l1, l1, 1);
    expect(renderer.effectCount).toBeGreaterThan(0);
    // 정지 렌더는 프레임이 흐르지 않으므로 다시 그려도 비워지지 않는다(수명 24프레임 ≫ 재구성 수).
    const after = renderer.effectCount;
    renderer.render(l1, l1, 1);
    expect(renderer.effectCount).toBe(after);
    renderer.reset();
    expect(renderer.effectCount).toBe(0);
  });

  it('정규 경로: 레이어를 7번 오가도 프리뷰 이펙트는 항상 0 이다', () => {
    const preview = new DefensePreviewController({
      textures: stubTextures(),
      viewport: VIEW,
    });
    preview.start(LAYERS);
    const renderer = previewRenderer(preview);
    const counts: number[] = [renderer.effectCount];
    for (const phase of [PHASE_L2, PHASE_L3, PHASE_L1, PHASE_L2, PHASE_L3, PHASE_L1] as const) {
      preview.setFocus(phase, 0);
      counts.push(renderer.effectCount);
    }
    // 시퀀스 전체가 0 — 하나라도 남으면 그 좌표의 폭발이 다음 레이어 화면에 떠 있다.
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('정규 경로: 배치 교체·슬롯 이동에도 이펙트가 남지 않는다', () => {
    const preview = new DefensePreviewController({
      textures: stubTextures(),
      viewport: VIEW,
    });
    preview.start(LAYERS);
    const renderer = previewRenderer(preview);
    for (const slot of [1, 2, 3, 4, 5, 0]) {
      preview.setFocus(PHASE_L1, slot);
      expect(renderer.effectCount, `슬롯${slot}`).toBe(0);
    }
    preview.setLayers(layersAllSlots(FORMATION_ASSAULT));
    expect(renderer.effectCount).toBe(0);
    preview.setLayers(null);
    expect(renderer.effectCount).toBe(0);
    preview.stop();
  });

  it('레이어를 바꾸면 스프라이트도 물려받지 않는다 — id 재사용으로 그림이 뒤바뀌는 것 방지', () => {
    const preview = new DefensePreviewController({
      textures: stubTextures(),
      viewport: VIEW,
    });
    preview.start(LAYERS);
    const renderer = previewRenderer(preview);
    const sprites = (renderer as unknown as { sprites: Map<number, { sprite: object }> }).sprites;
    preview.setFocus(PHASE_L1, 0);
    const l1 = new Set([...sprites.values()].map((t) => t.sprite));
    expect(l1.size).toBeGreaterThan(0);
    preview.setFocus(PHASE_L3, 0);
    // 새 월드는 id 를 0부터 다시 발급한다(플레이어는 항상 0). 캐시가 살아 있으면 id 가 겹치는
    // 만큼 **L1 때 만든 스프라이트 객체**(텍스처가 그때 묶였다)가 그대로 재사용된다.
    const reused = [...sprites.values()].filter((t) => l1.has(t.sprite));
    expect(reused.length).toBe(0);
    preview.stop();
  });
});

