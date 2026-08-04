/**
 * 아군·이익 오브젝트 표시 규약 — 순수 단위 + **배선** 통합 (사용자 피드백 2026-07-26).
 *
 * 이 프로젝트의 반복 결함은 "단위는 초록인데 배선이 통째로 없다"다(project-memory). 그래서
 * `friendlyDisplay.ts` 순수 함수와 **쌍으로**, 실제 {@link EntityRenderer} 가 정규 render 경로에서
 * ①스프라이트를 기체 크기로 묶고 ②이름표를 labelLayer 에 깔고 ③활성 포탑 포신을 표적으로
 * 돌리고 ④소멸 시 이름표를 회수하는지를 수치로 못 박는다.
 *
 * node 환경 vitest 라 GL 이 없다 — 텍스처는 진짜 Pixi Texture 를 쓴다(glowWiring.test.ts 선례).
 */

import { describe, it, expect } from 'vitest';
import { Container, Text, Texture } from 'pixi.js';

import { EntityRenderer } from '../src/render/entityRenderer.js';
import type { PlaceholderTextures } from '../src/render/textures.js';
import type { EntityKind } from '../src/sim/entities.js';
import type { EntitySnapshot, WorldSnapshot } from '../src/sim/snapshot.js';
import {
  PICKUP_DISPLAY_SIZE,
  displaySize,
  friendlyLabel,
  isSizeCapped,
  showsTriggerRing,
  turretAimAngle,
} from '../src/render/friendlyDisplay.js';
import { EVENT_TRIGGER_RADIUS } from '../src/sim/chunks.js';
import { TURRET_RANGE } from '../src/sim/events.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';

const ART_SCALE = 1.5; // entityRenderer 의 값과 동일(두 곳이 갈라지면 아래 기대치가 먼저 깨진다).

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

function world(entities: EntitySnapshot[]): WorldSnapshot {
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
  };
}

/** labelLayer(이름표 레이어) — 자식 = 살아 있는 이름표들. */
function labelLayer(r: EntityRenderer): Container {
  return (r as unknown as { labelLayer: Container }).labelLayer;
}

/** 스프라이트 캐시(비공개) — 표시 크기·회전을 되읽는다. */
function sprites(r: EntityRenderer): Map<number, { sprite: { width: number; rotation: number } }> {
  return (r as unknown as { sprites: Map<number, { sprite: { width: number; rotation: number } }> })
    .sprites;
}

describe('표시 크기 상한 — 순수', () => {
  it('포탑 픽업의 sim radius 는 트리거 반경(70)이라 환산 크기가 기체의 4배가 넘는다', () => {
    // 이 수치가 결함의 실체다: 210px vs 기체 48px.
    expect(EVENT_TRIGGER_RADIUS * 2 * ART_SCALE).toBeGreaterThan(PICKUP_DISPLAY_SIZE * 4);
  });

  it('아군·이익 kind 는 기체 크기 이하로 묶인다', () => {
    for (const kind of ['turretPickup', 'magnetEmitter', 'bombDevice', 'supply'] as EntityKind[]) {
      expect(isSizeCapped(kind)).toBe(true);
      expect(displaySize(kind, EVENT_TRIGGER_RADIUS, ART_SCALE)).toBe(PICKUP_DISPLAY_SIZE);
    }
  });

  it('작은 아군 오브젝트는 상한에 걸리지 않고 기존 환산 그대로다', () => {
    expect(displaySize('turretPickup', 10, ART_SCALE)).toBe(30);
  });

  it('젬은 상한 대상이지만 이름표는 붙지 않는다(화면에 수십 개)', () => {
    // 젬 sim radius 20 → 60px 로 기체보다 컸다(하네스 실측 회귀 가드).
    expect(displaySize('gem', 20, ART_SCALE)).toBe(PICKUP_DISPLAY_SIZE);
    expect(friendlyLabel('gem', false)).toBeNull();
  });

  it('적·보스는 상한 대상이 아니다(전투체 크기 계약 불변)', () => {
    expect(isSizeCapped('enemy')).toBe(false);
    expect(displaySize('boss', 100, ART_SCALE)).toBe(300);
  });
});

describe('이름표 · 트리거 링 — 순수', () => {
  it('포탑은 휴면과 활성의 이름이 다르다', () => {
    const dormant = friendlyLabel('turretPickup', false);
    const active = friendlyLabel('turretPickup', true);
    expect(dormant).not.toBeNull();
    expect(active).not.toBeNull();
    expect(dormant).not.toBe(active);
  });

  it('라벨 대상이 아닌 kind 는 null(적·탄에 이름을 붙이지 않는다)', () => {
    expect(friendlyLabel('enemy', false)).toBeNull();
    expect(friendlyLabel('bullet', false)).toBeNull();
    expect(friendlyLabel('gem', false)).toBeNull();
  });

  it('라벨 문자열이 카탈로그에 실제로 있다(키가 그대로 새는지 확인)', () => {
    for (const kind of ['magnetEmitter', 'bombDevice', 'supply', 'shelter'] as EntityKind[]) {
      expect(friendlyLabel(kind, false)).not.toBe(`ent.${kind}`);
    }
  });

  it('트리거 링은 휴면 접촉 기믹에만 그린다', () => {
    expect(showsTriggerRing('turretPickup', false)).toBe(true);
    expect(showsTriggerRing('turretPickup', true)).toBe(false); // 활성 포탑 = 이미 발동
    expect(showsTriggerRing('magnetEmitter', false)).toBe(true);
    expect(showsTriggerRing('supply', false)).toBe(false);
  });
});

describe('포탑 조준각 — 순수', () => {
  it('사거리 안 최근접 적 방향을 돌려준다', () => {
    const es = [entity('enemy', { id: 2, x: 0, y: 100 }), entity('enemy', { id: 3, x: 500, y: 0 })];
    const a = turretAimAngle(0, 0, es, TURRET_RANGE);
    expect(a).toBeCloseTo(Math.PI / 2, 5); // 아래쪽(+y)이 더 가깝다
  });

  it('사거리 밖 표적은 무시한다(없으면 null)', () => {
    const es = [entity('enemy', { id: 2, x: TURRET_RANGE + 10, y: 0 })];
    expect(turretAimAngle(0, 0, es, TURRET_RANGE)).toBeNull();
  });

  it('아군·중립 실체는 표적이 아니다', () => {
    const es = [entity('gem', { id: 2, x: 50, y: 0 }), entity('player', { id: 3, x: 60, y: 0 })];
    expect(turretAimAngle(0, 0, es, TURRET_RANGE)).toBeNull();
  });
});

describe('배선 — EntityRenderer 정규 render 경로', () => {
  it('트리거 반경 픽업이 화면에서 기체 크기로 렌더된다', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([entity('turretPickup', { id: 1, radius: EVENT_TRIGGER_RADIUS })]);
    r.render(w, w, 0);
    expect(sprites(r).get(1)?.sprite.width).toBe(PICKUP_DISPLAY_SIZE);
    r.destroy();
  });

  it('이름표가 labelLayer 에 붙고, 실체가 사라지면 회수된다(누수 0)', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([entity('turretPickup', { id: 1, radius: EVENT_TRIGGER_RADIUS })]);
    r.render(w, w, 0);
    expect(labelLayer(r).children.length).toBe(1);
    const empty = world([]);
    r.render(empty, empty, 0);
    expect(labelLayer(r).children.length).toBe(0);
    r.destroy();
  });

  it('적에는 이름표가 붙지 않는다', () => {
    const r = new EntityRenderer(realTextures());
    const w = world([entity('enemy', { id: 1 })]);
    r.render(w, w, 0);
    // ⚠️ "이름표가 없다" 를 `children.length === 0` 으로 재면 안 된다 — 이 레이어는 이제
    // 이름표 말고도 **정보 요소**를 받는다(적 체력바, `enemyHpBar.ts`). 이 단언이 묻는 것은
    // "적에게 이름 텍스트가 붙는가" 이므로 `Text` 만 센다.
    expect(labelLayer(r).children.filter((c) => c instanceof Text).length).toBe(0);
    r.destroy();
  });

  it('활성 포탑은 표적 방향으로 회전하고, 휴면 포탑은 고정 자세다', () => {
    const r = new EntityRenderer(realTextures());
    const target = entity('enemy', { id: 9, x: 0, y: 200 });
    const live = world([entity('turretPickup', { id: 1, active: true }), target]);
    r.render(live, live, 0);
    expect(sprites(r).get(1)?.sprite.rotation).toBeCloseTo(Math.PI / 2, 5);
    r.destroy();

    const r2 = new EntityRenderer(realTextures());
    const dormant = world([entity('turretPickup', { id: 1, active: false }), target]);
    r2.render(dormant, dormant, 0);
    expect(sprites(r2).get(1)?.sprite.rotation).toBe(0);
    r2.destroy();
  });

  it('표적이 사라져도 포신은 직전 각도를 유지한다(0도로 튀지 않는다)', () => {
    const r = new EntityRenderer(realTextures());
    const turret = entity('turretPickup', { id: 1, active: true });
    const w1 = world([turret, entity('enemy', { id: 9, x: 0, y: 200 })]);
    r.render(w1, w1, 0);
    const w2 = world([turret]);
    r.render(w2, w2, 0);
    expect(sprites(r).get(1)?.sprite.rotation).toBeCloseTo(Math.PI / 2, 5);
    r.destroy();
  });
});
