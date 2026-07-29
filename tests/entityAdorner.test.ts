/**
 * 엔티티 장식자 심(`src/render/entity/adorner.ts`) **배선·회수 계약**.
 *
 * ## 이 테스트가 지키는 것
 * 1. **등록되지 않은 kind 는 장식자 0개** — 이 커밋만으로는 화면이 한 픽셀도 바뀌면 안 된다.
 * 2. 등록된 kind 는 정규 `render` 경로에서 `onAttach` 1회 · `onFrame` 매 프레임.
 * 3. **`dispose` 가 네 경로 전부에서 불린다** — 킬 · 디졸브 · `reset` · `destroy`.
 *
 * 3번이 이 파일의 존재 이유다. 장식자가 만드는 컨테이너는 스프라이트의 **형제**라(Pixi v8 이
 * `Sprite.addChild` 를 deprecate 했다) 부모 `destroy` 로 회수되지 않는다. 접지 그림자가 바로
 * 이 회수를 빠뜨려 "사라진 실체의 그림자가 바닥에 얼어붙는" 결함을 실제로 냈다. 순수 유닛
 * 테스트로는 절대 안 잡히고(모듈 자체는 멀쩡하다), **정규 render 경로**로 태워야만 드러난다.
 *
 * ## 결정론 계약
 * render-only 배선만 본다. sim·hashWorld/hashEntity 에 손대지 않는다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Sprite, Texture } from 'pixi.js';

import { EntityRenderer } from '../src/render/entityRenderer.js';
import {
  clearAdornerFactories,
  createAdorners,
  registerAdornerFactory,
  adornerFactoryCount,
  NO_ADORNERS,
  type AdornerContext,
  type EntityAdorner,
} from '../src/render/entity/adorner.js';
import { clearHazardMaterialFactories } from '../src/render/entity/hazardHost.js';
import { graphicsSettings } from '../src/render/graphicsSettings.js';
import { graphicsTierController } from '../src/render/graphicsRuntime.js';
import { effectGates, type QualityTier } from '../src/render/qualityTier.js';
import type { PlaceholderTextures } from '../src/render/textures.js';
import type { EntitySnapshot, WorldSnapshot } from '../src/sim/snapshot.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';

// ---------------------------------------------------------------------------
// 진짜 Pixi Texture — 렌더러가 엔티티마다 `new Sprite(textureFor(e))` 를 만들기 때문에 스텁
// 객체로는 안 된다(combatFeedbackWiring.test.ts 와 동일 관용구).
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

function ent(over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id: 1,
    kind: 'enemy',
    x: 0,
    y: 0,
    angle: 0,
    radius: 20,
    aabbH: 0,
    enemyType: 0,
    hp: 100,
    maxHp: 100,
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

/** 호출 횟수만 세는 스텁 장식자. `dispose` 횟수가 이 파일의 핵심 관측값이다. */
interface StubAdorner extends EntityAdorner {
  attach: number;
  frames: number;
  disposed: number;
  lastCtx: AdornerContext | null;
  lastPrevX: number;
}

function stub(): StubAdorner {
  const a: StubAdorner = {
    name: 'stub',
    attach: 0,
    frames: 0,
    disposed: 0,
    lastCtx: null,
    lastPrevX: Number.NaN,
    onAttach() {
      a.attach++;
    },
    onFrame(_sprite, _e, prev, ctx) {
      a.frames++;
      a.lastCtx = ctx;
      a.lastPrevX = prev.x;
    },
    dispose() {
      a.disposed++;
    },
  };
  return a;
}

/** 다음 프레임에 이 스텁을 내주는 팩토리를 kind 에 등록한다. */
function registerStub(kind: EntitySnapshot['kind']): StubAdorner {
  const a = stub();
  registerAdornerFactory(kind, () => [a]);
  return a;
}

/** 티어를 명시 고정한다(수동 오버라이드는 즉시 잠긴다 — graphicsRuntime.tick 주석 참조). */
function forceTier(tier: QualityTier): void {
  graphicsTierController.tick(60, 1 / 60, tier);
}

/** 이 파일 시작 시점의 티어(테스트가 바꾼 뒤 되돌리기 위한 기준). */
const BASE_TIER = graphicsTierController.getActiveTier();

afterEach(() => {
  // 레지스트리·티어 컨트롤러 모두 모듈 전역이라 테스트 간 격리가 필수다.
  clearAdornerFactories();
  forceTier(BASE_TIER);
});

// ===========================================================================

describe('레지스트리 — 등록되지 않은 kind 는 장식자 0개(거동 불변의 근거)', () => {
  it('등록 없이는 공유 빈 배열을 그대로 돌려준다(할당조차 없다)', () => {
    expect(adornerFactoryCount('enemy')).toBe(0);
    expect(createAdorners(ent({ kind: 'enemy' }))).toBe(NO_ADORNERS);
  });

  it('등록은 함수 호출식이라 같은 kind 에 여러 레인이 누적된다', () => {
    registerAdornerFactory('player', () => [stub()]);
    registerAdornerFactory('player', () => [stub(), stub()]);
    expect(adornerFactoryCount('player')).toBe(2);
    expect(createAdorners(ent({ kind: 'player' })).length).toBe(3);
    // 다른 kind 는 오염되지 않는다.
    expect(createAdorners(ent({ kind: 'enemy' }))).toBe(NO_ADORNERS);
  });

  it('빈 배열만 내는 팩토리도 공유 빈 배열로 접힌다', () => {
    registerAdornerFactory('gem', () => []);
    expect(createAdorners(ent({ kind: 'gem' }))).toBe(NO_ADORNERS);
  });
});

describe('정규 render 경로 배선 — onAttach 1회 · onFrame 매 프레임', () => {
  it('스프라이트 생성 시 1회 붙고, 프레임마다 보간 스프라이트·직전 스냅샷과 함께 불린다', () => {
    const a = registerStub('enemy');
    const renderer = new EntityRenderer(realTextures());

    const f1 = world([ent({ id: 5, x: 100, y: 0 })]);
    renderer.render(f1, f1, 1);
    expect(a.attach).toBe(1); // 배선 없으면 0
    expect(a.frames).toBe(1);
    expect(renderer.adornerCount).toBe(1);

    // 프레임 2: 이동. onAttach 는 늘지 않고 onFrame 만 는다. prev 스냅샷이 실제로 전달된다.
    const prev = world([ent({ id: 5, x: 100, y: 0 })]);
    const curr = world([ent({ id: 5, x: 180, y: 0 })]);
    renderer.render(prev, curr, 1);
    expect(a.attach).toBe(1);
    expect(a.frames).toBe(2);
    expect(a.lastPrevX).toBe(100); // 직전 스냅샷 없이는 속도 파생이 불가능하다
    expect(a.disposed).toBe(0);
  });

  it('맥락에 게이트·티어·레이어가 실려 온다(게이트 없는 이펙트를 못 만들게 하는 근거)', () => {
    const a = registerStub('enemy');
    const renderer = new EntityRenderer(realTextures());
    const f = world([ent({ id: 5 })]);
    renderer.render(f, f, 1);

    expect(a.lastCtx).not.toBeNull();
    const ctx = a.lastCtx!;
    // 렌더러가 프레임당 산출하는 것과 같은 값이어야 한다(장식자가 자기 게이트를 따로 갖지 않는다).
    expect(ctx.gates).toEqual(
      effectGates(graphicsTierController.getActiveTier(), graphicsSettings.getSettings()),
    );
    expect(ctx.tier).toBe(graphicsTierController.getActiveTier());
    expect(ctx.belowLayer).toBeDefined();
    expect(ctx.aboveLayer).toBeDefined();
    expect(ctx.belowLayer).not.toBe(ctx.aboveLayer); // 발광=아래·폭발=위 비대칭
    expect(ctx.dt).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 회수 4경로 — 이 파일의 핵심. 한 경로라도 빠지면 형제 컨테이너가 화면에 얼어붙는다.
// ===========================================================================

describe('회수 계약 — dispose 가 네 경로 전부에서 불린다', () => {
  it('경로 ① 킬(디졸브 없음): 엔티티가 사라지면 그 프레임에 회수된다', () => {
    // eventShaders 를 확실히 끄기 위해 low 티어로 고정 → 즉시 destroy 경로.
    forceTier('low');
    const a = registerStub('enemy');
    const renderer = new EntityRenderer(realTextures());

    const alive = world([ent({ id: 5 })]);
    renderer.render(alive, alive, 1);
    expect(a.disposed).toBe(0);
    expect(renderer.adornerCount).toBe(1);

    const gone = world([]);
    renderer.render(gone, gone, 1);
    expect(a.disposed).toBe(1); // 회수 누락이면 0
    expect(renderer.adornerCount).toBe(0);
  });

  it('경로 ② 디졸브(High 티어): 스프라이트가 잔류해도 장식자는 즉시 회수된다', () => {
    // High 티어 = eventShaders on → 전투체 사망이 즉시 destroy 되지 않고 디졸브로 이관된다.
    // 이 경로에서 회수를 빠뜨리면 스프라이트만 사라지고 장식 이펙트가 그 자리에 얼어붙는다.
    forceTier('high');
    const a = registerStub('enemy');
    const renderer = new EntityRenderer(realTextures());

    const alive = world([ent({ id: 5 })]);
    renderer.render(alive, alive, 1);
    const gone = world([]);
    renderer.render(gone, gone, 1);

    expect(renderer.dyingCount).toBeGreaterThan(0); // 실제로 디졸브 경로를 밟았음을 못 박는다
    expect(a.disposed).toBe(1);
    expect(renderer.adornerCount).toBe(0);
  });

  it('경로 ③ reset(런 전환): 살아 있는 엔티티의 장식자도 전부 회수된다', () => {
    const a = registerStub('enemy');
    const renderer = new EntityRenderer(realTextures());
    const alive = world([ent({ id: 5 })]);
    renderer.render(alive, alive, 1);
    expect(a.disposed).toBe(0);

    renderer.reset();
    expect(a.disposed).toBe(1);
    expect(renderer.adornerCount).toBe(0);
  });

  it('경로 ④ destroy: 살아 있는 엔티티의 장식자도 전부 회수된다', () => {
    const a = registerStub('enemy');
    const renderer = new EntityRenderer(realTextures());
    const alive = world([ent({ id: 5 })]);
    renderer.render(alive, alive, 1);
    expect(a.disposed).toBe(0);

    renderer.destroy();
    expect(a.disposed).toBe(1);
  });

  it('이중 회수는 no-op 이다(킬 뒤 reset 같은 경로 중첩에서 두 번 불리지 않는다)', () => {
    forceTier('low');
    const a = registerStub('enemy');
    const renderer = new EntityRenderer(realTextures());
    const alive = world([ent({ id: 5 })]);
    renderer.render(alive, alive, 1);
    renderer.render(world([]), world([]), 1); // 킬 → dispose 1
    renderer.reset();
    renderer.destroy();
    expect(a.disposed).toBe(1);
  });
});

describe('거동 불변 — 팩토리가 없으면 아무 일도 일어나지 않는다', () => {
  it('등록 0인 상태의 정규 render 는 장식자를 하나도 만들지 않는다', () => {
    // ⚠️ **영 상태를 명시적으로 세운다.** 스캐폴딩 시점에는 등록이 하나도 없어 그냥 render 하면
    // 됐지만, 지금은 `entityRenderer.ts` 가 등록 허브(`entity/index.ts`)를 import 하므로
    // **이 파일을 로드하는 것만으로 해저드 재질이 이미 등록돼 있다**. 그 상태로 재면 이 테스트는
    // "팩토리가 없으면"이 아니라 "프로덕션 등록이 몇 개인가"를 재게 된다 — 물으려는 질문이 아니다.
    //
    // 두 레지스트리를 모두 비우는 것이 전제이고, 그래야 아래 0 단언이 **심의 거동 불변**
    // (등록 없으면 할당·호출 0)을 재는 원래 의미를 유지한다.
    clearAdornerFactories();
    clearHazardMaterialFactories();
    const renderer = new EntityRenderer(realTextures());
    const f = world([
      ent({ id: 1, kind: 'player' }),
      ent({ id: 2, kind: 'enemy' }),
      ent({ id: 3, kind: 'bullet', radius: 6 }),
      ent({ id: 4, kind: 'hazard', radius: 120, enemyType: 0, active: true }),
    ]);
    renderer.render(f, f, 1);
    expect(renderer.adornerCount).toBe(0);
    // 해저드 재질도 등록이 없으면 추적조차 하지 않는다(Map 성장 0).
    expect(renderer.hazardMaterialCount).toBe(0);
    // 스프라이트는 정상적으로 생겼다 = 렌더 경로 자체는 돌았다(빈 통과 오탐 방지).
    expect(renderer.layer.children.length).toBeGreaterThan(0);
  });
});

describe('스프라이트 인자 — 장식자는 보간된 실제 스프라이트를 받는다', () => {
  it('onFrame 의 sprite 가 보간 위치를 이미 반영하고 있다(미러 대상)', () => {
    const cap: { sprite: Sprite | null } = { sprite: null };
    const a = stub();
    a.onFrame = (sprite) => {
      cap.sprite = sprite;
      a.frames++;
    };
    registerAdornerFactory('enemy', () => [a]);

    const renderer = new EntityRenderer(realTextures());
    const prev = world([ent({ id: 5, x: 0, y: 0 })]);
    const curr = world([ent({ id: 5, x: 200, y: 100 })]);
    renderer.render(prev, curr, 0.5);

    expect(cap.sprite).not.toBeNull();
    expect(cap.sprite!.x).toBe(100); // 0 → 200 의 alpha=0.5 보간
    expect(cap.sprite!.y).toBe(50);
  });
});
