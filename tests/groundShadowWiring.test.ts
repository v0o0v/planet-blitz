/**
 * 접지 그림자 **배선** 통합 테스트 — 정규 {@link EntityRenderer} render 경로에서 실제로
 * shadowLayer 에 그림자가 깔리는가.
 *
 * 이 프로젝트의 반복 결함은 "단위는 초록인데 배선이 통째로 없다"다(project-memory #1). 순수
 * 단위(`tests/groundShadow.test.ts`)와 **쌍으로**, 여기서는 렌더러가:
 *
 *  1. 테마가 있는 행성에서 **부피 있는 실체**에만 그림자를 깐다(탄·젬 0).
 *  2. 그림자 오프셋이 **그 행성 테마 광원에서 파생**된다 — 카르곤은 스프라이트보다 **위**,
 *     니플헤임은 **아래**. 부호가 행성마다 갈리는 것을 렌더러 좌표로 직접 잰다.
 *  3. **담당 테마가 없는 행성**(미등록 인덱스)·`setEnvPlanet(null)` 이면 한 개도 안 그린다.
 *  4. 엔티티가 사라지면 그림자가 회수된다. 그림자는 스프라이트의 **형제**라 부모 destroy 로는
 *     절대 안 걷힌다 — **여기가 누수 자리**이고, 디졸브 경로(스프라이트가 잔류하는 경로)에서도
 *     회수돼야 사라진 실체의 그림자만 바닥에 남지 않는다.
 *
 * node 환경 vitest(GL 없음)라 Pixi 는 import 만으로 돌고, 텍스처는 **진짜 Pixi Texture** 를 쓴다
 * (스텁 객체는 `new Sprite()` 를 통과하지 못한다 — glowWiring 선례).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Container, Texture } from 'pixi.js';

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

const KARGON = 0; // 광원이 아래(발밑 용암) → 그림자는 위로
const NIFLHEIM = 2; // 광원이 위 → 그림자는 아래로
/** 어느 테마도 담당하지 않는 인덱스(`themeFor` 가 undefined). */
const UNTHEMED = 99;

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

/** shadowLayer(접지 그림자 레이어) 컨테이너 — 자식 = 그림자들. */
function shadowLayer(r: EntityRenderer): Container {
  return (r as unknown as { shadowLayer: Container }).shadowLayer;
}

function lockTier(tier: 'low' | 'med' | 'high'): void {
  graphicsTierController.tick(60, 1 / 60, tier);
}

/** 테마를 걸고 한 프레임 렌더한 렌더러. 호출측이 `destroy()` 한다. */
function renderWith(planet: number | null, entities: EntitySnapshot[]): EntityRenderer {
  const r = new EntityRenderer(realTextures());
  lockTier('high');
  r.setEnvPlanet(planet);
  const w = world(entities);
  r.render(w, w, 0);
  return r;
}

beforeEach(() => {
  graphicsSettings.set({ quality: 'auto', reducedMotion: false, reducedGlow: false });
  lockTier('high');
});

describe('접지 그림자 배선(shadowLayer)', () => {
  it('테마가 걸린 행성에서 부피 있는 실체마다 그림자가 깔린다', () => {
    const r = renderWith(KARGON, [
      entity('player', { id: 1 }),
      entity('enemy', { id: 2 }),
      entity('wall', { id: 3, aabbH: 20 }),
    ]);
    expect(shadowLayer(r).children.length).toBe(3);
    expect(r.groundShadowCount).toBe(3);
    r.destroy();
  });

  it('탄·젬·전리품에는 그림자가 없다(신호에 붙이면 그림자가 거짓말을 한다)', () => {
    const r = renderWith(KARGON, [
      entity('bullet', { id: 1, enemyType: -1 }),
      entity('enemyBullet', { id: 2, enemyType: -1 }),
      entity('gem', { id: 3 }),
      entity('loot', { id: 4 }),
    ]);
    expect(shadowLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('그림자는 shadowLayer 자식이지 스프라이트 자식이 아니다(Pixi v8 형제 규율)', () => {
    const r = renderWith(KARGON, [entity('player', { id: 1 })]);
    const sprites = (r as unknown as { sprites: Map<number, { sprite: Container }> }).sprites;
    const sp = sprites.get(1);
    expect(sp).toBeDefined();
    expect(sp?.sprite.children.length).toBe(0);
    expect(shadowLayer(r).children.length).toBe(1);
    r.destroy();
  });

  it('같은 엔티티의 그림자를 프레임마다 다시 굽지 않는다(id 캐시 — Graphics 재빌드 금지)', () => {
    const r = renderWith(KARGON, [entity('player', { id: 1 })]);
    const first = shadowLayer(r).children[0];
    const w = world([entity('player', { id: 1 })]);
    r.render(w, w, 0);
    r.render(w, w, 0);
    expect(shadowLayer(r).children.length).toBe(1);
    expect(shadowLayer(r).children[0]).toBe(first);
    r.destroy();
  });
});

describe('오프셋 부호는 그 행성 테마 광원에서 파생된다', () => {
  it('카르곤(발밑 용암): 그림자가 스프라이트보다 **위**에 놓인다', () => {
    const r = renderWith(KARGON, [entity('player', { id: 1, x: 300, y: 200 })]);
    const sh = shadowLayer(r).children[0] as Container;
    expect(sh).toBeDefined();
    expect(sh.position.y).toBeLessThan(200);
    r.destroy();
  });

  it('니플헤임(위 광원): 그림자가 스프라이트보다 **아래**에 놓인다', () => {
    const r = renderWith(NIFLHEIM, [entity('player', { id: 1, x: 300, y: 200 })]);
    const sh = shadowLayer(r).children[0] as Container;
    expect(sh).toBeDefined();
    expect(sh.position.y).toBeGreaterThan(200);
    r.destroy();
  });

  it('두 행성의 오프셋 부호가 실제로 반대다 — 테마 무관 상수면 이 단언이 깨진다', () => {
    const a = renderWith(KARGON, [entity('player', { id: 1, x: 0, y: 0 })]);
    const b = renderWith(NIFLHEIM, [entity('player', { id: 1, x: 0, y: 0 })]);
    const ay = (shadowLayer(a).children[0] as Container).position.y;
    const by = (shadowLayer(b).children[0] as Container).position.y;
    expect(Math.sign(ay)).toBe(-Math.sign(by));
    expect(Math.sign(ay)).not.toBe(0);
    a.destroy();
    b.destroy();
  });

  it('그림자는 엔티티 보간 위치를 따라간다(별개 레이어 좌표 동기)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    r.setEnvPlanet(KARGON);
    const prev = world([entity('player', { id: 1, x: 0, y: 0 })]);
    const curr = world([entity('player', { id: 1, x: 100, y: 40 })]);
    r.render(prev, curr, 0.5); // 보간 위치 = (50, 20)
    const sh = shadowLayer(r).children[0] as Container;
    // 오프셋(테마 파생)만큼 어긋나 있고, 나머지는 보간 위치를 그대로 따른다.
    const r2 = renderWith(KARGON, [entity('player', { id: 1, x: 0, y: 0 })]);
    const off = shadowLayer(r2).children[0] as Container;
    expect(sh.position.x).toBeCloseTo(50 + off.position.x, 6);
    expect(sh.position.y).toBeCloseTo(20 + off.position.y, 6);
    r.destroy();
    r2.destroy();
  });
});

describe('담당 테마가 없으면 그림자도 없다', () => {
  it('미등록 행성 인덱스면 한 개도 안 그린다', () => {
    const r = renderWith(UNTHEMED, [entity('player', { id: 1 }), entity('enemy', { id: 2 })]);
    expect(shadowLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('setEnvPlanet(null)(=env.disable 화면)이면 한 개도 안 그린다', () => {
    const r = renderWith(null, [entity('player', { id: 1 })]);
    expect(shadowLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('setEnvPlanet 을 아예 안 부른 렌더러도 그림자가 없다(기본값 = 꺼짐)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('player', { id: 1 })]);
    r.render(w, w, 0);
    expect(shadowLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('테마 → 무테마 전환이면 남아 있던 그림자가 전부 회수된다(옛 광원 잔류 금지)', () => {
    const r = renderWith(KARGON, [entity('player', { id: 1 })]);
    expect(shadowLayer(r).children.length).toBe(1);
    r.setEnvPlanet(null);
    expect(shadowLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('행성이 바뀌면 옛 광원으로 구운 그림자를 버린다(다음 프레임에 새 부호로 다시 굽는다)', () => {
    const r = renderWith(KARGON, [entity('player', { id: 1, x: 0, y: 0 })]);
    const before = (shadowLayer(r).children[0] as Container).position.y;
    r.setEnvPlanet(NIFLHEIM);
    expect(shadowLayer(r).children.length).toBe(0); // 즉시 폐기
    const w = world([entity('player', { id: 1, x: 0, y: 0 })]);
    r.render(w, w, 0);
    const after = (shadowLayer(r).children[0] as Container).position.y;
    expect(Math.sign(after)).toBe(-Math.sign(before)); // 새 광원 부호로 다시 구워졌다
    r.destroy();
  });
});

describe('생명주기 — 형제라 부모 destroy 로 안 걷힌다(누수 자리)', () => {
  it('엔티티가 사라지면 다음 프레임에 그 그림자가 회수된다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    r.setEnvPlanet(KARGON);
    const keep = entity('player', { id: 1 });
    const w1 = world([keep, entity('enemy', { id: 2 })]);
    r.render(w1, w1, 0);
    expect(shadowLayer(r).children.length).toBe(2);
    const w2 = world([keep]); // enemy 소멸
    r.render(w2, w2, 0);
    expect(shadowLayer(r).children.length).toBe(1);
    expect(r.groundShadowCount).toBe(1);
    r.destroy();
  });

  it('디졸브 경로(스프라이트가 spriteLayer 에 잔류)에서도 그림자는 즉시 회수된다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high'); // eventShaders on → 전투체 사망이 디졸브로 이관된다
    r.setEnvPlanet(KARGON);
    const w1 = world([entity('enemy', { id: 2 })]);
    r.render(w1, w1, 0);
    expect(shadowLayer(r).children.length).toBe(1);
    const w2 = world([]);
    r.render(w2, w2, 0);
    // 스프라이트는 디졸브로 잔류하지만(dyingCount>0) 그림자는 남으면 안 된다 —
    // 위치 미러가 끊긴 그림자만 바닥에 얼어붙는다.
    expect(r.dyingCount).toBeGreaterThan(0);
    expect(shadowLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('reset() 은 그림자를 전부 비운다(shadowLayer 컨테이너는 살려 둔다)', () => {
    const r = renderWith(KARGON, [entity('player', { id: 1 }), entity('enemy', { id: 2 })]);
    expect(shadowLayer(r).children.length).toBe(2);
    r.reset();
    expect(shadowLayer(r).children.length).toBe(0);
    expect(r.groundShadowCount).toBe(0);
    expect(shadowLayer(r).destroyed).toBe(false);
    r.destroy();
  });

  it('reset() 후에도 테마는 유지된다 — 다음 런 첫 프레임에 그림자가 다시 깔린다', () => {
    const r = renderWith(KARGON, [entity('player', { id: 1 })]);
    r.reset();
    const w = world([entity('player', { id: 1 })]);
    r.render(w, w, 0);
    expect(shadowLayer(r).children.length).toBe(1);
    r.destroy();
  });
});
