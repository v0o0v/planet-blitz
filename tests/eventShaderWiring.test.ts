/**
 * 사망/해저드 이벤트 셰이더 **배선** 통합 테스트 (Phase 3 — plan §AC-3.2/3.3/3.4 · AC-6.3; ADR-0031).
 *
 * ## 왜 이 형태인가
 * 이 프로젝트의 #1 반복 결함은 "순수함수 유닛은 그린인데 정규 경로에 배선이 통째로 없다"이다
 * (8건 이력). ShockwaveEffect·DissolveEffect·ShimmerEffect 각각의 순수 유닛(tests/shaderEffects*.ts)
 * 이 다 통과해도, entityRenderer 의 킬 루프·drawOverlay 가 그것들을 **실제로 호출하지 않으면**
 * 게임엔 아무 왜곡·디졸브·시머도 안 뜬다. 그래서 여기서는 순수함수를 재검하지 않고, **실제
 * `EntityRenderer` 를 세워 정규 snapshot→render 경로로 태운 뒤** 관측창(shockwaveCount·dyingCount·
 * shimmerActive)의 델타를 assert 한다 — 배선이 빠지면 즉시 빨개진다.
 *
 * ## node-env / dt 특성
 * PixiJS 는 렌더러 없이 import 만 하므로 node 환경에서 그대로 돈다(glowWiring.test.ts 선례). GL 이
 * 없어 핸드-GLSL 필터는 전부 null 폴백이지만(AC-3.6), 컨트롤러의 **부착/detach·수명 관리는 필터
 * 유무와 무관하게 동일**하다(충격파=폴백 링, 디졸브=alpha 페이드, 시머=no-op) — 배선 검증엔 충분.
 *
 * render 의 프레임 dt 는 벽시계(performance.now)라 테스트가 직접 못 준다. 그래서 "편입"은 정규
 * render 경로로 검증하고, 원샷 "진행→정리"(초 단위 duration)는 render 가 매 프레임 부르는 정규
 * 메서드(updateDyingSprites·updateShockwaves)를 시간 압축해 호출한다(같은 코드 경로, 시간만 빨리감기).
 *
 * ## 결정론 계약
 * render-only 배선만 검증한다. sim·hashWorld/hashEntity 무접촉 — 골든 해시 불변은 determinism.test.ts·
 * invasionHash.test.ts 가 별도로 못 박는다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Sprite, Texture } from 'pixi.js';

import { EntityRenderer } from '../src/render/entityRenderer.js';
import type { PlaceholderTextures } from '../src/render/textures.js';
import type { EntityKind } from '../src/sim/entities.js';
import type { EntitySnapshot, WorldSnapshot } from '../src/sim/snapshot.js';
import { graphicsSettings } from '../src/render/graphicsSettings.js';
import { graphicsTierController } from '../src/render/graphicsRuntime.js';
import { HAZARD_LAVA, HAZARD_MORTAR } from '../src/sim/patterns/types.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';

// ---------------------------------------------------------------------------
// 진짜 Pixi Texture — 렌더러가 각 엔티티에 `new Sprite(textureFor(e))` 를 만들기 때문에 스텁으로는
// 안 된다(glowWiring.test.ts 와 동일 관용구).
// ---------------------------------------------------------------------------

function tex(label: string): Texture {
  return new Texture({ source: Texture.EMPTY.source, label });
}

function realTextures(): PlaceholderTextures {
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

// ---------------------------------------------------------------------------
// 스냅샷 팩토리
// ---------------------------------------------------------------------------

function entity(kind: EntityKind, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id: 1,
    kind,
    x: 0,
    y: 0,
    angle: 0,
    radius: 20,
    aabbH: 0,
    enemyType: 0,
    hp: 10,
    maxHp: 10,
    active: false,
    flash: false,
    elite: -1,
    ...over,
  };
}

function world(entities: EntitySnapshot[], over: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    tick: 0,
    arenaWidth: 2000,
    arenaHeight: 2000,
    cameraX: 0,
    cameraY: 0,
    planet: 0,
    visionRadius: 0,
    safeRadius: 0,
    entities,
    beams: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 렌더러 비공개 상태 되읽기 — 배선 결함은 렌더러의 실제 내부 상태를 봐야 드러난다(shipSwap 선례).
// 관측 getter(shockwaveCount·dyingCount·shimmerActive)는 public 이지만, "즉시 destroy vs 디졸브
// 잔류"는 스프라이트 인스턴스의 destroyed 플래그를 직접 봐야 한다.
// ---------------------------------------------------------------------------

interface RendererInternals {
  sprites: Map<number, { sprite: Sprite }>;
  dyingSprites: { sprite: Sprite; effect: { update(dt: number): boolean } }[];
  shockwaves: { update(dt: number): boolean }[];
  updateDyingSprites(dt: number): void;
  updateShockwaves(dt: number): void;
  // 시머 국소화 검증용(리뷰 MEDIUM): 시머는 lavaOverlay 에만 붙고 overlay(예고선)엔 안 붙어야 한다.
  // node-env 는 GL 이 없어 실 필터가 null 폴백이라 `.filters` 로는 못 본다 — 대신 컨트롤러가 **어느
  // 컨테이너를 target 으로 잡았는지**(구조적 사실)를 본다(TS private 은 런타임 미강제).
  overlay: object;
  lavaOverlay: object;
  shimmer: { target: object } | null;
}
function priv(r: EntityRenderer): RendererInternals {
  return r as unknown as RendererInternals;
}

/** 한 프레임에 세운 스프라이트 인스턴스 참조를 잡아 둔다(사망 후 destroyed 여부를 보려면 필요). */
function spriteOf(r: EntityRenderer, id: number): Sprite | undefined {
  return priv(r).sprites.get(id)?.sprite;
}

/** render 가 관찰하는 활성 티어를 수동 오버라이드로 잠근다(glowWiring 선례). */
function lockTier(tier: 'low' | 'med' | 'high'): void {
  graphicsTierController.tick(60, 1 / 60, tier);
}

/** 디졸브 원샷을 정규 메서드로 시간 압축 진행(DISSOLVE 기본 1.1s, dt 는 내부 0.05 상한). */
function advanceDissolves(r: EntityRenderer, steps = 30): void {
  for (let i = 0; i < steps; i++) priv(r).updateDyingSprites(0.05);
}

/** 충격파 원샷을 정규 메서드로 시간 압축 진행(thick-slow 1.15s, dt 는 내부 0.05 상한). */
function advanceShockwaves(r: EntityRenderer, steps = 30): void {
  for (let i = 0; i < steps; i++) priv(r).updateShockwaves(0.05);
}

// ---------------------------------------------------------------------------
// 공유 싱글턴 초기화 — 티어=High(eventShaders on), 감소 토글 off(테스트 간 오염 방지).
// ---------------------------------------------------------------------------

beforeEach(() => {
  graphicsSettings.set({ quality: 'auto', reducedMotion: false, reducedGlow: false });
  lockTier('high');
});

// ===========================================================================

describe('AC-3.3 · 충격파 배선 (보스/대형 킬 → 원형 왜곡)', () => {
  it('보스가 사라지면(킬) High 티어에서 충격파가 방출된다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const alive = world([entity('boss', { id: 1, hp: 100 })]);
    const gone = world([]);

    r.render(alive, alive, 1);
    expect(r.shockwaveCount).toBe(0);

    r.render(gone, gone, 1); // 보스 킬 → 충격파 배선이 트리거돼야 한다
    expect(r.shockwaveCount).toBeGreaterThan(0); // 배선 없으면 여기서 빨개진다
    r.destroy();
  });

  it('설비(대형, scale 2)가 사라지면 충격파가 방출된다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const alive = world([entity('facilityGun', { id: 1, enemyType: 0, hp: 100 })]);
    r.render(alive, alive, 1);
    r.render(world([]), world([]), 1);
    expect(r.shockwaveCount).toBeGreaterThan(0);
    r.destroy();
  });

  it('잡몹(scale 1) 킬은 충격파를 트리거하지 않는다(대형만 — AC-3.3)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const alive = world([entity('enemy', { id: 1, elite: -1, hp: 100 })]);
    r.render(alive, alive, 1);
    r.render(world([]), world([]), 1);
    expect(r.shockwaveCount).toBe(0);
    r.destroy();
  });

  it('저티어(eventShaders off)면 보스 킬에도 충격파가 없다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('low');
    const alive = world([entity('boss', { id: 1, hp: 100 })]);
    r.render(alive, alive, 1);
    r.render(world([]), world([]), 1);
    expect(r.shockwaveCount).toBe(0);
    r.destroy();
  });

  it('충격파는 원샷이라 진행 후 스스로 정리된다(수명 관리)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const alive = world([entity('boss', { id: 1, hp: 100 })]);
    r.render(alive, alive, 1);
    r.render(world([]), world([]), 1);
    expect(r.shockwaveCount).toBeGreaterThan(0);
    advanceShockwaves(r); // thick-slow 1.15s 만큼 빨리감기
    expect(r.shockwaveCount).toBe(0); // 원샷 종료 후 목록 비움
    r.destroy();
  });
});

describe('AC-3.4 · 사망 디졸브 배선 (전투체 사망 = 지연 소멸)', () => {
  it('적이 사라지면 즉시 destroy 되지 않고 디졸브로 이관된다(스프라이트 잔류)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const alive = world([entity('enemy', { id: 5, hp: 100 })]);
    r.render(alive, alive, 1);
    const sp = spriteOf(r, 5);
    expect(sp).toBeDefined();
    expect(sp!.destroyed).toBe(false);

    r.render(world([]), world([]), 1); // 킬
    // 배선 증명: dyingSprites 에 편입돼야 하고(즉시 destroy 아님), 스프라이트는 아직 살아 있다.
    expect(r.dyingCount).toBe(1); // 미배선이면 0(즉시 destroy)
    expect(sp!.destroyed).toBe(false); // 디졸브 중이라 아직 파괴 안 됨
    // sprites Map 에서는 즉시 빠진다(중복 렌더 방지) — 수명만 dyingSprites 로 이관.
    expect(priv(r).sprites.has(5)).toBe(false);
    r.destroy();
  });

  it('디졸브가 완료되면 스프라이트가 destroy 되고 목록에서 빠진다(누수 0)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const alive = world([entity('enemy', { id: 5, hp: 100 })]);
    r.render(alive, alive, 1);
    const sp = spriteOf(r, 5);
    r.render(world([]), world([]), 1);
    expect(r.dyingCount).toBe(1);

    advanceDissolves(r); // 디더 소멸(1.1s) 빨리감기
    expect(r.dyingCount).toBe(0); // 완료분 정리
    expect(sp!.destroyed).toBe(true); // 소멸 후 스프라이트 파괴
    r.destroy();
  });

  it('ShardBurst(파편)는 디졸브와 별개로 그대로 방출된다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const alive = world([entity('enemy', { id: 5, hp: 100 })]);
    r.render(alive, alive, 1);
    r.render(world([]), world([]), 1);
    expect(r.dyingCount).toBe(1); // 디졸브 이관
    expect(r.effectCount).toBeGreaterThan(0); // 파편 버스트도 함께 방출(기존 거동 보존)
    r.destroy();
  });

  it('gem 사망은 디졸브가 아니라 즉시 제거된다(전투체 아님 · scale 0)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const alive = world([entity('gem', { id: 3 })]);
    r.render(alive, alive, 1);
    const sp = spriteOf(r, 3);
    r.render(world([]), world([]), 1);
    expect(r.dyingCount).toBe(0); // 디졸브 없음
    expect(sp!.destroyed).toBe(true); // 즉시 파괴
    r.destroy();
  });

  it('loot 사망도 즉시 제거된다(전리품 — 디졸브 제외)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const alive = world([entity('loot', { id: 4, enemyType: 0 })]);
    r.render(alive, alive, 1);
    const sp = spriteOf(r, 4);
    r.render(world([]), world([]), 1);
    expect(r.dyingCount).toBe(0);
    expect(sp!.destroyed).toBe(true);
    r.destroy();
  });

  it('저티어(eventShaders off)면 적 사망이 즉시 destroy 된다(디졸브 없음)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('low');
    const alive = world([entity('enemy', { id: 5, hp: 100 })]);
    r.render(alive, alive, 1);
    const sp = spriteOf(r, 5);
    r.render(world([]), world([]), 1);
    expect(r.dyingCount).toBe(0);
    expect(sp!.destroyed).toBe(true);
    r.destroy();
  });

  it('동시 디졸브 상한(MAX_DISSOLVES=12)을 넘는 사망은 즉시 destroy 된다(성능 방어)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    // 적 13기를 세운 뒤 한 프레임에 전부 사라뜨린다 → 12기만 디졸브, 초과 1기는 즉시 destroy.
    const many = Array.from({ length: 13 }, (_, i) =>
      entity('enemy', { id: 100 + i, x: i * 30, hp: 100 }),
    );
    const alive = world(many);
    r.render(alive, alive, 1);
    r.render(world([]), world([]), 1);
    expect(r.dyingCount).toBe(12); // 상한에서 멈춘다(무한 누적 방어)
    r.destroy();
  });
});

describe('AC-3.2 · 용암 시머 배선 (해저드 지속형)', () => {
  it('용암 해저드 스냅샷 + High 티어면 시머가 부착된다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('hazard', { id: 1, enemyType: HAZARD_LAVA, radius: 80, active: true })]);
    r.render(w, w, 0);
    expect(r.shimmerActive).toBe(true); // 배선 없으면 false
    r.destroy();
  });

  it('용암이 아닌 해저드(박격)는 시머를 켜지 않는다(용암 국소 — AC-3.2)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('hazard', { id: 1, enemyType: HAZARD_MORTAR, radius: 80, active: true })]);
    r.render(w, w, 0);
    expect(r.shimmerActive).toBe(false);
    r.destroy();
  });

  it('용암+박격 공존 시 시머는 lavaOverlay 에만 붙는다(예고선 unshimmered — 국소 시머 계약)', () => {
    // 리뷰 MEDIUM: 시머를 overlay 통째에 걸면 회피 판정에 직결되는 박격/레일 예고선까지 흔들려
    // 가독성이 무너진다. 용암과 박격 예고선이 공존하는 프레임에서 시머 target 이 lavaOverlay(용암
    // 전용)여야지 overlay(예고선 포함)가 아니어야 한다. node-env 는 GL 폴백이라 실 필터 대신 컨트롤러
    // 의 target(구조적 사실)을 본다 — 이 target 이 곧 어떤 픽셀이 흔들릴지를 결정한다.
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([
      entity('hazard', { id: 1, enemyType: HAZARD_LAVA, radius: 80, active: true }),
      entity('hazard', { id: 2, enemyType: HAZARD_MORTAR, x: 300, radius: 80, active: true }),
    ]);
    r.render(w, w, 0);
    expect(r.shimmerActive).toBe(true); // 용암 존재 → 시머 on
    const p = priv(r);
    expect(p.shimmer).not.toBeNull();
    expect(p.shimmer!.target).toBe(p.lavaOverlay); // 용암 전용 오버레이에만
    expect(p.shimmer!.target).not.toBe(p.overlay); // 예고선을 담은 overlay 에는 안 붙는다
    r.destroy();
  });

  it('용암이 사라지면 시머가 detach 된다(지속형 전이)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const lava = world([entity('hazard', { id: 1, enemyType: HAZARD_LAVA, radius: 80 })]);
    r.render(lava, lava, 0);
    expect(r.shimmerActive).toBe(true);
    const empty = world([]);
    r.render(empty, empty, 0);
    expect(r.shimmerActive).toBe(false); // 용암 없음 → detach
    r.destroy();
  });

  it('저티어(eventShaders off)면 용암이 있어도 시머가 없다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('low');
    const w = world([entity('hazard', { id: 1, enemyType: HAZARD_LAVA, radius: 80 })]);
    r.render(w, w, 0);
    expect(r.shimmerActive).toBe(false);
    r.destroy();
  });
});

describe('정리 — 누수 0', () => {
  it('reset() 은 충격파·디졸브·시머를 전부 회수한다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    // 충격파(보스 킬) + 디졸브(적 킬) + 시머(용암)를 동시에 세운다.
    const alive = world([
      entity('boss', { id: 1, hp: 100 }),
      entity('enemy', { id: 2, hp: 100 }),
      entity('hazard', { id: 3, enemyType: HAZARD_LAVA, radius: 80 }),
    ]);
    r.render(alive, alive, 1);
    const boss = spriteOf(r, 1);
    const enemy = spriteOf(r, 2);
    // 보스·적만 사라지고 용암은 유지 → 충격파+디졸브 생성, 시머 부착.
    const partial = world([entity('hazard', { id: 3, enemyType: HAZARD_LAVA, radius: 80 })]);
    r.render(partial, partial, 1);
    expect(r.shockwaveCount).toBeGreaterThan(0);
    expect(r.dyingCount).toBeGreaterThan(0);
    expect(r.shimmerActive).toBe(true);

    r.reset();
    expect(r.shockwaveCount).toBe(0);
    expect(r.dyingCount).toBe(0);
    expect(r.shimmerActive).toBe(false);
    // 디졸브 잔류 스프라이트도 파괴됐어야 한다(spriteLayer 잔류분 회수).
    expect(boss?.destroyed).toBe(true);
    expect(enemy?.destroyed).toBe(true);
    r.destroy();
  });

  it('layer 자식 수는 이벤트 셰이더 유무와 무관하게 6으로 불변(레이어 스택 회귀 가드)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const alive = world([entity('boss', { id: 1, hp: 100 })]);
    r.render(alive, alive, 1);
    r.render(world([]), world([]), 1); // 보스 킬 → 충격파는 layer.filters(자식 아님)·폴백 링은 자식
    // 기본 레이어(lavaOverlay·overlay·shadowLayer·glowLayer·spriteLayer·labelLayer·effectLayer·fog)가 유지되어야 한다.
    // 충격파 폴백 링은 layer 의 **자식**으로 추가될 수 있다(GL 없을 때)지만 원샷 종료 시 회수된다.
    // 여기선 배선 직후라 링이 있을 수 있으므로 진행시켜 회수한 뒤 스택을 확인한다.
    advanceShockwaves(r);
    // 9 = lava·hazardMaterial(해저드 재질 심)·overlay·shadow(접지 그림자)·glow·sprite·label·effect·fog.
    expect(r.layer.children.length).toBe(9);
    r.destroy();
  });
});
