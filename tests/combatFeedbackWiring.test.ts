/**
 * Phase 2 전투 피드백 **자동 배선 게이트** (AC-6.3 · plan §Phase 6).
 *
 * ## 왜 이 형태인가
 * 이 프로젝트의 #1 반복 결함은 "순수함수 유닛은 그린인데 정규 경로에 배선이 통째로 없다"이다
 * (8건 이력). ShardBurst·TraumaController·effectGates 각각의 순수 유닛 테스트가 다 통과해도,
 * entityRenderer 의 render 루프가 그것들을 **실제로 호출하지 않으면** 게임엔 아무 이펙트도 안 뜬다.
 * 그래서 여기서는 순수함수를 재검하지 않고, **실제 `EntityRenderer` 를 세워 정규 snapshot→render
 * 경로로 태운 뒤** 관측창(effectCount·effectLayer 자식·flashUntilTick·shakeTrauma)의 델타를
 * assert 한다 — 배선이 빠지면 즉시 빨개진다.
 *
 * PixiJS 는 렌더러 없이 import 만 하므로 node 환경에서 그대로 돈다(entityRendererShipSwap.test.ts
 * 선례). 텍스처는 **진짜 Texture** 여야 `new Sprite()` 를 통과한다(스텁 객체는 안 됨).
 *
 * ## 결정론 계약
 * 이 파일은 render-only 배선만 검증한다. sim·hashWorld/hashEntity 에는 손대지 않으며, 골든 해시
 * 불변은 determinism.test.ts·invasionHash.test.ts 가 별도로 못 박는다.
 */

import { describe, it, expect } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';

import { EntityRenderer } from '../src/render/entityRenderer.js';
import type { PlaceholderTextures } from '../src/render/textures.js';
import type { EntitySnapshot, WorldSnapshot } from '../src/sim/snapshot.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../src/render/app.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';

// ---------------------------------------------------------------------------
// 진짜 Pixi Texture — 렌더러가 각 엔티티에 `new Sprite(textureFor(e))` 를 만들기 때문에 스텁
// 객체로는 안 된다(entityRendererShipSwap.test.ts 와 동일 관용구).
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
// 스냅샷 빌더 — 정규 render 경로가 받는 것과 동일한 형태의 불변 스냅샷을 손으로 만든다.
// ---------------------------------------------------------------------------

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

/** 비공개 상태 되읽기 — 배선 결함은 렌더러의 실제 내부 상태를 봐야 드러난다(shipSwap 선례). */
interface RendererInternals {
  sprites: Map<
    number,
    { sprite: Sprite; flashUntilTick: number; flashOverlay: Sprite | null; elite: boolean }
  >;
  effectLayer: Container;
  // 히트 플래시 오버레이는 Pixi v8 Sprite.addChild deprecate 회피로 부모의 자식이 아니라
  // spriteLayer **형제**다 → 가시 메커니즘(오버레이가 실제 렌더 트리에 있는지)은 여기서 확인한다.
  spriteLayer: Container;
  frameTick: number;
}
function priv(r: EntityRenderer): RendererInternals {
  return r as unknown as RendererInternals;
}

// ===========================================================================

describe('AC-6.3 · 파편 폭발 배선 (사망 = ShardBurst)', () => {
  it('적이 사라지면(킬) effectLayer 에 파편 버스트가 추가된다', () => {
    const renderer = new EntityRenderer(realTextures());
    const alive = world([ent({ id: 5, kind: 'enemy', hp: 100 })]);
    const gone = world([]);

    // 프레임 1: 적을 세워 스프라이트를 만든다(아직 킬 없음).
    renderer.render(alive, alive, 1);
    const before = priv(renderer).effectLayer.children.length;
    expect(before).toBe(0);
    expect(renderer.effectCount).toBe(0);

    // 프레임 2: 적이 사라짐 = 킬 → 정규 소멸 감지 경로가 ShardBurst 를 방출해야 한다.
    renderer.render(gone, gone, 1);
    const after = priv(renderer).effectLayer.children.length;
    expect(after).toBeGreaterThan(before); // 배선 없으면 여기서 빨개진다
    // effectCount(= 살아 있는 사망 폭발)는 effectLayer 자식 수와 일치한다(burst 1개=container 1개).
    expect(renderer.effectCount).toBe(after);
    expect(renderer.effectCount).toBeGreaterThan(0);
  });
});

describe('AC-6.3 · 히트 플래시 배선 (HP-델타 → 가산 흰 오버레이)', () => {
  it('적이 생존 피해(hp 100→50)를 받으면 그 프레임에 가산 흰 오버레이가 실제로 얹힌다', () => {
    const renderer = new EntityRenderer(realTextures());
    const spriteLayer = priv(renderer).spriteLayer;

    // 적은 원점이 아닌 (300,200)에 둔다 — 오버레이가 부모 위치로 **미러**되는지(단순 생성만이
    // 아니라 배치까지) 확인하려면 좌표가 0이 아니어야 한다(미러 누락 시 오버레이는 기본 0,0에 남는다).
    // 프레임 1: 적 hp 100 — 아직 피해 없음. 플래시 창 닫힘, 오버레이 없음(spriteLayer 에 적 하나뿐).
    const f1 = world([ent({ id: 5, kind: 'enemy', hp: 100, maxHp: 100, x: 300, y: 200 })]);
    renderer.render(f1, f1, 1);
    const t1 = priv(renderer).sprites.get(5);
    expect(t1).toBeDefined();
    expect(t1!.flashUntilTick).toBe(0); // 무피해 프레임엔 플래시가 안 열린다(오탐 방지 디스크리미네이터)
    expect(t1!.flashOverlay).toBeNull();
    expect(spriteLayer.children.length).toBe(1); // 적 스프라이트만, 오버레이 형제 없음
    expect(renderer.hitFlashOverlayCount).toBe(0);

    // 프레임 2: 직전 hp 100 → 현재 hp 50 = 생존 피해 → HP-델타 감지가 플래시를 열어야 한다.
    const prev = world([ent({ id: 5, kind: 'enemy', hp: 100, maxHp: 100, x: 300, y: 200 })]);
    const curr = world([ent({ id: 5, kind: 'enemy', hp: 50, maxHp: 100, x: 300, y: 200 })]);
    renderer.render(prev, curr, 1);

    const t2 = priv(renderer).sprites.get(5);
    expect(t2).toBeDefined();
    // 배선 증명 ①(상태): 플래시 창이 현재 프레임보다 미래로 설정돼 있어야 한다(미배선이면 0).
    expect(t2!.flashUntilTick).toBeGreaterThan(priv(renderer).frameTick);
    // 배선 증명 ②(**가시 메커니즘** — MED-1 방어): tint 상태값만이 아니라, 실제 가산
    // (blendMode==='add') 흰 오버레이가 **렌더 트리(spriteLayer)에 형제로 추가**돼야 한다. Pixi v8
    // 은 Sprite.addChild 를 deprecate 했으므로 자식이 아닌 형제로 얹는다. "상태값만 그린, 화면엔 안
    // 보임" 재발을 이 assert 가 막는다.
    expect(t2!.flashOverlay).not.toBeNull();
    expect(spriteLayer.children).toContain(t2!.flashOverlay); // 실제 렌더 트리에 있어야 보인다
    expect(spriteLayer.children.length).toBe(2); // 적 스프라이트 + 오버레이 형제
    expect(t2!.flashOverlay!.blendMode).toBe('add');
    expect(t2!.flashOverlay!.tint).toBe(0xffffff);
    expect(t2!.flashOverlay!.alpha).toBeGreaterThan(0);
    // 배선 증명 ③(**미러** — 형제는 부모 변환을 자동 상속하지 않으므로 직접 미러해야 한다): 오버레이가
    // 부모 스프라이트의 보간 위치(300,200)에 정확히 얹혀야 한다(미러 누락이면 0,0에 남아 빨개진다).
    expect(t2!.flashOverlay!.position.x).toBe(t2!.sprite.position.x);
    expect(t2!.flashOverlay!.position.y).toBe(t2!.sprite.position.y);
    expect(t2!.sprite.position.x).toBe(300); // 보간 위치가 실제로 원점이 아님을 못박는다
    expect(renderer.hitFlashOverlayCount).toBe(1);
  });

  it('플래시 창이 끝나면 가산 오버레이가 spriteLayer 에서 제거된다(형제 회수 · 누수 0)', () => {
    const renderer = new EntityRenderer(realTextures());
    const spriteLayer = priv(renderer).spriteLayer;

    // 피격 프레임 — 오버레이 생성.
    const prev = world([ent({ id: 5, kind: 'enemy', hp: 100, maxHp: 100 })]);
    const curr = world([ent({ id: 5, kind: 'enemy', hp: 50, maxHp: 100 })]);
    renderer.render(prev, prev, 1); // 스프라이트 세우기(무피해)
    renderer.render(prev, curr, 1); // 피격 → 오버레이 열림
    expect(renderer.hitFlashOverlayCount).toBe(1);
    const ov = priv(renderer).sprites.get(5)!.flashOverlay; // 회수 확인용으로 참조를 붙잡아 둔다
    expect(ov).not.toBeNull();
    expect(spriteLayer.children).toContain(ov);

    // 재피격 없이 무피해 프레임을 충분히 흘려 창(HIT_FLASH_FRAMES)을 넘긴다 → 오버레이 회수.
    const still = world([ent({ id: 5, kind: 'enemy', hp: 50, maxHp: 100 })]);
    for (let i = 0; i < 6; i++) renderer.render(still, still, 1);

    const t = priv(renderer).sprites.get(5);
    expect(t).toBeDefined();
    expect(t!.flashOverlay).toBeNull();
    // 형제 오버레이가 렌더 트리에서 실제로 빠졌는지(누수 0) — spriteLayer 엔 적 스프라이트만 남는다.
    expect(spriteLayer.children).not.toContain(ov);
    expect(spriteLayer.children.length).toBe(1);
    expect(renderer.hitFlashOverlayCount).toBe(0);
  });
});

describe('AC-6.3 · 화면 흔들림 배선 (보스/엘리트 처치 → 트라우마)', () => {
  it('보스가 사라지면(킬) 트라우마가 오르고 카메라 오프셋이 순수 카메라 값과 달라진다', () => {
    const renderer = new EntityRenderer(realTextures());
    const alive = world([ent({ id: 7, kind: 'boss', hp: 100 })], { planet: 0 });
    const gone = world([]);

    // 프레임 1: 보스 생존 — 트리거 없음. 트라우마 0, 카메라는 순수 팬(흔들림 없음).
    renderer.render(alive, alive, 1);
    expect(renderer.shakeTrauma).toBe(0);
    expect(priv(renderer).effectLayer.children.length).toBe(0);

    // 프레임 2: 보스가 사라짐 = 처치 → 강 트라우마 트리거.
    renderer.render(gone, gone, 1);
    expect(renderer.shakeTrauma).toBeGreaterThan(0); // 배선 없으면 0 에 머물러 빨개진다

    // 카메라 오프셋이 순수 카메라(DESIGN 중심, camera=0)와 실제로 달라져야 한다 — 흔들림이
    // layer.position 에 가산됐다는 직접 증거. dx·dy 두 축이 독립 해시라 동시에 정확히 0 일 확률은
    // 사실상 없다.
    const pos = renderer.layer.position;
    const offAxis =
      Math.abs(pos.x - DESIGN_WIDTH / 2) > 0 || Math.abs(pos.y - DESIGN_HEIGHT / 2) > 0;
    expect(offAxis).toBe(true);
  });

  it('잡몹(비-엘리트) 처치는 흔들림을 트리거하지 않는다 — 트리거는 셋만', () => {
    const renderer = new EntityRenderer(realTextures());
    const alive = world([ent({ id: 9, kind: 'enemy', elite: -1, hp: 100 })]);
    const gone = world([]);

    renderer.render(alive, alive, 1);
    renderer.render(gone, gone, 1); // 잡몹 킬 → 폭발은 뜨지만(scale 1) 흔들림은 없어야 한다

    expect(renderer.effectCount).toBeGreaterThan(0); // 폭발 배선은 살아 있고
    expect(renderer.shakeTrauma).toBe(0); // 흔들림은 선택적(보스/엘리트/대형폭발만)
  });
});
