/**
 * 아군·이익 오브젝트 루프 애니메이션 — 순수 단위 + **배선** 통합 (2026-07-26).
 *
 * 이 프로젝트의 반복 결함은 "단위는 초록인데 배선이 통째로 없다"다. 애니메이션은 특히 그렇다:
 * 프레임 텍스처를 로드해 놓고 렌더가 한 번도 갈아 끼우지 않아도 화면은 (정지 그림이라) 멀쩡해
 * 보인다. 그래서 프레임 인덱스 순수 함수와 **쌍으로**, 실제 {@link EntityRenderer} 가 정규
 * render 경로에서 스프라이트 텍스처를 실제로 교체하는지를 못 박는다.
 */

import { describe, it, expect } from 'vitest';
import { Texture } from 'pixi.js';

import { EntityRenderer } from '../src/render/entityRenderer.js';
import type { PlaceholderTextures } from '../src/render/textures.js';
import type { EntityKind } from '../src/sim/entities.js';
import type { EntitySnapshot, WorldSnapshot } from '../src/sim/snapshot.js';
import {
  ANIM_FPS,
  animFrameIndex,
  animatedKindOf,
  phaseForEntity,
} from '../src/render/spriteAnimation.js';
import { SHIP_TYPES } from '../data/ships/index.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';

function tex(label: string): Texture {
  return new Texture({ source: Texture.EMPTY.source, label });
}

function realTextures(anim?: PlaceholderTextures['anim']): PlaceholderTextures {
  const arr = (name: string, n: number): Texture[] =>
    Array.from({ length: n }, (_, i) => tex(`${name}[${i}]`));
  const base: PlaceholderTextures = {
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
  return anim === undefined ? base : { ...base, anim };
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

function sprites(r: EntityRenderer): Map<number, { sprite: { texture: Texture; width: number } }> {
  return (r as unknown as { sprites: Map<number, { sprite: { texture: Texture; width: number } }> })
    .sprites;
}

describe('프레임 인덱스 — 순수', () => {
  it('시간이 흐르면 프레임이 순서대로 돈다', () => {
    expect(animFrameIndex(0, 9, 0)).toBe(0);
    expect(animFrameIndex(1 / ANIM_FPS, 9, 0)).toBe(1);
    expect(animFrameIndex(8 / ANIM_FPS, 9, 0)).toBe(8);
    expect(animFrameIndex(9 / ANIM_FPS, 9, 0)).toBe(0); // 루프
  });

  it('위상이 다르면 같은 시각에 다른 프레임을 낸다(동시 깜빡임 방지)', () => {
    expect(animFrameIndex(0, 9, 3)).toBe(3);
    expect(animFrameIndex(0, 9, 0)).not.toBe(animFrameIndex(0, 9, 3));
  });

  it('프레임이 1장 이하거나 시간이 비정상이면 0(방어적)', () => {
    expect(animFrameIndex(5, 1, 0)).toBe(0);
    expect(animFrameIndex(Number.NaN, 9, 0)).toBe(0);
    expect(animFrameIndex(-1, 9, 0)).toBe(0);
  });

  it('엔티티 위상은 항상 프레임 범위 안이다', () => {
    for (const id of [0, 1, 7, 12345, -5]) {
      const p = phaseForEntity(id, 9);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(9);
    }
  });

  it('애니메이션 대상 kind 만 슬롯을 갖는다', () => {
    expect(animatedKindOf('gem')).toBe('gem');
    expect(animatedKindOf('turretPickup')).toBe('turretPickup');
    expect(animatedKindOf('enemy')).toBeNull();
    expect(animatedKindOf('bullet')).toBeNull();
  });
});

describe('배선 — EntityRenderer 가 실제로 텍스처를 교체한다', () => {
  /**
   * 렌더를 여러 번 돌려 애니메이션 시계를 실제로 전진시킨다.
   *
   * ⚠️ 한 프레임에 시계를 크게 벌릴 수는 없다 — 렌더는 프레임 dt 를 `MAX_RENDER_DT`(0.05초)로
   * 클램프한다(탭 복귀 spike 방어). 그래서 "오래 기다렸다가 한 번 렌더"가 아니라 **여러 번
   * 렌더**해야 시계가 는다. 이 클램프는 실제 거동이기도 하다(느린 프레임에선 재생도 느려진다).
   */
  function renderFrames(r: EntityRenderer, w: WorldSnapshot, frames: number, gapMs = 60): void {
    for (let i = 0; i < frames; i++) {
      const until = Date.now() + gapMs;
      while (Date.now() < until) {
        /* busy-wait: performance.now 기반 dt 를 실제로 벌린다 */
      }
      r.render(w, w, 0);
    }
  }

  it('프레임이 있으면 시간이 흐른 뒤 다른 텍스처가 붙는다', () => {
    const frames = [tex('f0'), tex('f1'), tex('f2'), tex('f3')];
    const r = new EntityRenderer(realTextures({ gem: frames }));
    const w = world([entity('gem', { id: 0 })]);
    renderFrames(r, w, 6); // 6프레임 × ~0.05초 = 0.3초 → 8fps 에서 2프레임 이상 전진
    const t = sprites(r).get(0)?.sprite.texture;
    expect(frames).toContain(t); // 정지 gem 텍스처가 아니라 프레임 중 하나
    expect(t).not.toBe(frames[0]); // 첫 프레임에서 실제로 진행했다
    r.destroy();
  });

  it('프레임이 없으면 정지 스프라이트 그대로다(에셋 부재 회귀 0)', () => {
    const textures = realTextures();
    const r = new EntityRenderer(textures);
    const w = world([entity('gem', { id: 0 })]);
    renderFrames(r, w, 6);
    expect(sprites(r).get(0)?.sprite.texture).toBe(textures.gem);
    r.destroy();
  });

  it('애니메이션 대상이 아닌 kind 는 교체되지 않는다', () => {
    const textures = realTextures({ gem: [tex('f0'), tex('f1')] });
    const r = new EntityRenderer(textures);
    const w = world([entity('enemy', { id: 0, enemyType: 0 })]);
    renderFrames(r, w, 6);
    expect(sprites(r).get(0)?.sprite.texture).toBe(textures.enemy[0]);
    r.destroy();
  });

  it('프레임 교체가 표시 크기를 바꾸지 않는다(크기 상한 계약 유지)', () => {
    const frames = [tex('f0'), tex('f1'), tex('f2')];
    const r = new EntityRenderer(realTextures({ turretPickup: frames }));
    const w = world([entity('turretPickup', { id: 0, radius: 70 })]);
    r.render(w, w, 0);
    const before = sprites(r).get(0)?.sprite.width;
    renderFrames(r, w, 6);
    expect(sprites(r).get(0)?.sprite.width).toBe(before);
    r.destroy();
  });
});
