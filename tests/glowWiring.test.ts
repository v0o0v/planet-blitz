/**
 * 발광체 글로우 **배선** 통합 테스트 (Phase 3 — plan §AC-3.1 · AC-6.3; ADR-0031).
 *
 * 이 프로젝트의 반복 결함은 "단위는 초록인데 배선이 통째로 없다"다(project-memory #1). 그래서
 * `buildGlowHalo`/`createGlowBloomFilter`/`isGlowEmitter` 순수 단위(tests/glowEffect.test.ts)와
 * **쌍으로**, 여기서는 실제 {@link EntityRenderer} 가 정규 render 경로에서 발광체 밑 glowLayer 에
 * 헤일로를 깔고(스프라이트 아래·가산, AC-0.8) High 티어에서 블룸을 거는지를 수치로 못박는다:
 *
 *  1. **헤일로 추가**: 발광체(boss·gem) 스냅샷 → glowLayer.children 증가(발광체 수만큼 헤일로).
 *  2. **탄 제외**: 탄만 있는 스냅샷 → glowLayer.children 0(가독성 계약 — isGlowEmitter=false).
 *  3. **소멸 회수**: 발광체가 사라지면 다음 프레임에 그 헤일로가 제거된다(children 감소).
 *  4. **티어/게이트**: Low 티어 또는 reducedGlow 면 헤일로 0(감소 토글 직교).
 *  5. **위치 미러**: 헤일로가 엔티티 보간 위치를 따라간다(별개 레이어 좌표 동기).
 *  6. **블룸 캐시**: High 게이트에서 블룸은 1회 생성 캐시(node 는 null 폴백 — filters 비어있음).
 *
 * node 환경 vitest(vite.config.ts `environment: 'node'`)라 GL 이 없다 — PixiJS 는 렌더러 없이 import
 * 만 하므로 node 에서 그대로 돈다(entityRendererShipSwap.test.ts 선례). 텍스처는 **진짜 Pixi
 * Texture**(스텁 객체는 `new Sprite()` 를 통과하지 못한다). 티어·감소 토글은 render 가 관찰하는
 * 공유 싱글턴(graphicsTierController·graphicsSettings)을 테스트에서 직접 조작해 게이트 입력을 좌우한다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Container, Texture, type Filter } from 'pixi.js';

import { EntityRenderer } from '../src/render/entityRenderer.js';
import type { PlaceholderTextures } from '../src/render/textures.js';
import type { EntityKind } from '../src/sim/entities.js';
import type { EntitySnapshot, WorldSnapshot } from '../src/sim/snapshot.js';
import { graphicsSettings } from '../src/render/graphicsSettings.js';
import { graphicsTierController } from '../src/render/graphicsRuntime.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';

// ---------------------------------------------------------------------------
// 텍스처 — 진짜 Pixi Texture(EMPTY 소스 공유). new Sprite() 가 통과하고 setSize 가 동작한다.
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
    arenaWidth: 1000,
    arenaHeight: 1000,
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
// 렌더러 비공개 상태 되읽기(배선의 실제 상태를 봐야 결함이 보인다 — sprites 되읽기 선례).
// ---------------------------------------------------------------------------

/** glowLayer(발광 레이어) 컨테이너 — 자식 = 헤일로들(블룸은 자식이 아니라 filters). */
function glowLayer(r: EntityRenderer): Container {
  return (r as unknown as { glowLayer: Container }).glowLayer;
}

/** 캐시된 블룸 필터(undefined=미생성, null=폴백, Filter=성공). */
function glowBloom(r: EntityRenderer): Filter | null | undefined {
  return (r as unknown as { glowBloom: Filter | null | undefined }).glowBloom;
}

/** glowLayer 에 붙은 필터 수(null/undefined 는 0). */
function glowFilterCount(r: EntityRenderer): number {
  const f = (glowLayer(r) as unknown as { filters?: Filter[] | null }).filters;
  return f == null ? 0 : f.length;
}

/**
 * render 가 관찰하는 활성 티어를 수동 오버라이드로 잠근다. selectTier 는 manualOverride≠'auto' 를
 * 즉시 반환하므로(fps 무관), 한 번의 tick 으로 활성 티어가 그 값으로 확정된다.
 */
function lockTier(tier: 'low' | 'med' | 'high'): void {
  graphicsTierController.tick(60, 1 / 60, tier);
}

// ---------------------------------------------------------------------------
// 공유 싱글턴 초기화 — 티어=High, 감소 토글 off(테스트 간 오염 방지).
// ---------------------------------------------------------------------------

beforeEach(() => {
  graphicsSettings.set({ quality: 'auto', reducedMotion: false, reducedGlow: false });
  lockTier('high');
});

describe('발광체 헤일로 배선(glowLayer)', () => {
  it('발광체(boss+gem) 스냅샷을 render 하면 glowLayer 에 헤일로가 발광체 수만큼 추가된다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('boss', { id: 1 }), entity('gem', { id: 2 })]);
    r.render(w, w, 0);
    // 헤일로는 glowLayer 자식이다(스프라이트는 spriteLayer, 블룸은 filters). 발광체 2 → 헤일로 2.
    expect(glowLayer(r).children.length).toBe(2);
    r.destroy();
  });

  it('탄만 있는 스냅샷은 glowLayer 가 비어 있다(탄 제외 — 탄막 가독성 계약)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([
      entity('bullet', { id: 1, enemyType: -1 }),
      entity('enemyBullet', { id: 2, enemyType: -1 }),
    ]);
    r.render(w, w, 0);
    expect(glowLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('적 실루엣·기물 등 가독 레이어도 헤일로가 없다(발광체 아님)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('enemy', { id: 1 }), entity('wall', { id: 2, aabbH: 20 })]);
    r.render(w, w, 0);
    expect(glowLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('발광체가 소멸하면 다음 render 에서 그 헤일로가 제거된다(children 감소)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const gem = entity('gem', { id: 2 });
    const w1 = world([entity('boss', { id: 1 }), gem]);
    r.render(w1, w1, 0);
    expect(glowLayer(r).children.length).toBe(2);
    // boss 소멸 → gem 만 남는다. 킬 루프가 boss 헤일로를 회수한다.
    const w2 = world([gem]);
    r.render(w2, w2, 0);
    expect(glowLayer(r).children.length).toBe(1);
    r.destroy();
  });

  it('헤일로가 엔티티 보간 위치를 미러한다(별개 레이어 좌표 동기)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const prev = world([entity('gem', { id: 1, x: 0, y: 0 })]);
    const curr = world([entity('gem', { id: 1, x: 100, y: 40 })]);
    r.render(prev, curr, 0.5); // 보간 위치 = (50, 20)
    const halo = glowLayer(r).children[0] as Container;
    expect(halo).toBeDefined();
    expect(halo.position.x).toBeCloseTo(50, 6);
    expect(halo.position.y).toBeCloseTo(20, 6);
    r.destroy();
  });

  it('여러 프레임에 걸쳐 같은 발광체는 헤일로를 중복 생성하지 않는다(id 캐시)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('gem', { id: 1 })]);
    r.render(w, w, 0);
    const first = glowLayer(r).children[0];
    r.render(w, w, 0);
    r.render(w, w, 0);
    expect(glowLayer(r).children.length).toBe(1);
    expect(glowLayer(r).children[0]).toBe(first); // 같은 헤일로 인스턴스 재사용.
    r.destroy();
  });
});

describe('티어·감소 토글 게이트(halo)', () => {
  it('Low 티어면 헤일로가 생기지 않는다(halo 게이트 off)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('low');
    const w = world([entity('boss', { id: 1 }), entity('gem', { id: 2 })]);
    r.render(w, w, 0);
    expect(glowLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('reducedGlow 면 High 티어여도 헤일로가 없다(감소 토글이 티어와 직교)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    graphicsSettings.set({ reducedGlow: true });
    const w = world([entity('boss', { id: 1 })]);
    r.render(w, w, 0);
    expect(glowLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('헤일로 게이트가 켜졌다 꺼지면(High→Low) 남은 헤일로가 전부 회수된다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('gem', { id: 1 })]);
    r.render(w, w, 0);
    expect(glowLayer(r).children.length).toBe(1);
    lockTier('low'); // 게이트 off
    r.render(w, w, 0);
    expect(glowLayer(r).children.length).toBe(0);
    r.destroy();
  });
});

describe('High 티어 블룸(1패스 캐시)', () => {
  it('블룸 필터는 1회 생성 캐시된다 — 여러 프레임 render 해도 재생성 없음(node 는 null 폴백)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('gem', { id: 1 })]);
    r.render(w, w, 0);
    const bloom = glowBloom(r);
    // node-env(GL 없음)면 null 폴백이 정상. GL 있으면 Filter 인스턴스. 둘 다 계약 준수(undefined 아님).
    expect(bloom === null || typeof bloom === 'object').toBe(true);
    if (bloom) {
      // 생성 성공했으면 glowLayer.filters 에 1개 붙어 있어야 한다(High 게이트 on).
      expect(glowFilterCount(r)).toBeGreaterThan(0);
    } else {
      // null 폴백: 헤일로만, filters 미부착.
      expect(glowFilterCount(r)).toBe(0);
    }
    // 다음 프레임에도 재생성하지 않는다 — 같은 캐시(identity 불변, null 이면 null 그대로).
    r.render(w, w, 0);
    expect(glowBloom(r)).toBe(bloom);
    r.destroy();
  });

  it('Low 티어면 블룸이 붙지 않는다(bloom 게이트 off — filters 0)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('low');
    const w = world([entity('gem', { id: 1 })]);
    r.render(w, w, 0);
    expect(glowFilterCount(r)).toBe(0);
    r.destroy();
  });
});

describe('정리 — 누수 0', () => {
  it('reset() 은 헤일로를 전부 비우고 블룸을 해제한다(glowLayer 컨테이너는 살려 둔다)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('boss', { id: 1 }), entity('gem', { id: 2 })]);
    r.render(w, w, 0);
    expect(glowLayer(r).children.length).toBe(2);
    r.reset();
    expect(glowLayer(r).children.length).toBe(0);
    expect(glowFilterCount(r)).toBe(0);
    // glowLayer 는 렌더러 layer 의 자식으로 살아 있어야 한다(앱 수명 내내 재사용).
    expect(glowLayer(r).destroyed).toBe(false);
    r.destroy();
  });

  it('layer 자식 수는 헤일로 유무와 무관하게 6(lavaOverlay·overlay·glow·sprite·effect·fog) 로 불변', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('gem', { id: 1 })]);
    r.render(w, w, 0);
    // 헤일로는 glowLayer 자식이지 layer 자식이 아니다 — 기존 레이어 스택 계약 회귀 가드.
    expect(r.layer.children.length).toBe(6);
    r.destroy();
  });
});
