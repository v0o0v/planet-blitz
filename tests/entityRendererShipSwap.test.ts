/**
 * 세션 중 기체 교체 → 인게임 스프라이트 반영 회귀 테스트 (레인 B · B-1).
 *
 * ## 무엇이 잘못돼 있었나
 * `EntityRenderer` 는 스프라이트를 **엔티티 id 로 캐시**하고 텍스처를
 * `new Sprite(this.textureFor(e))` 로 **생성 시점에 한 번만** 묶는다. 퇴출은 "이번 프레임에
 * 안 보인 스프라이트" 뿐이고 맵을 비우는 곳은 `destroy()` 하나인데 런 시작 시 아무도 부르지
 * 않았다. 플레이어 엔티티 id 는 런이 바뀌어도 같으므로(항상 0번 슬롯) **이전 런의 플레이어
 * 스프라이트가 재사용**되어, `applyShipSprite` 가 `textures.player` 를 새 기체로 갈아끼워도
 * 화면의 기체는 새로고침 전까지 첫 런의 그림으로 고정됐다(라이브 플레이테스트에서 브루저·
 * 말로우·아크캐스터·해츨링·버블 5종 전부 재현).
 *
 * ## 왜 이런 형태의 테스트인가
 * 스프라이트에 텍스처를 **손으로 넣는** 테스트는 이 결함을 원리상 못 잡는다 — 결함은
 * "정규 경로가 텍스처를 다시 읽지 않는다" 이기 때문이다. 그래서 여기서는 실제 앱(`main.ts`)이
 * 런을 세울 때 밟는 순서를 **그대로** 밟는다:
 *
 *   `Profile{typeId}` → `buildRunConfig` → `applyShipSprite(textures, config.shipType)`
 *   → `entityRenderer.reset()` → `createWorld` → `snapshotWorld` → `renderer.render(...)`
 *
 * 그리고 **그 런에 실제로 생성된 스프라이트의 텍스처**를 되읽는다.
 *
 * 마지막 케이스는 `main.ts` 소스를 직접 대조한다 — 리셋 호출이 한 군데라도 빠지면 이 파일의
 * 단위 케이스는 그린인 채 앱만 결함이 남는(이 프로젝트의 반복 결함 유형) 것을 막기 위해서다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Sprite, Texture } from 'pixi.js';

import { EntityRenderer } from '../src/render/entityRenderer.js';
import { applyShipSprite, type PlaceholderTextures } from '../src/render/textures.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { createWorld } from '../src/sim/world.js';
import { snapshotWorld } from '../src/sim/snapshot.js';
import { defaultProfile, activeShip, type Profile } from '../src/save/profile.js';
import { SHIP_TYPES, zeroSkillInvest } from '../data/ships/index.js';
import { FACILITY_CATALOG_COUNT } from '../data/invasion/facilities.js';
import { PROP_ROLE_COUNT } from '../data/invasion/props.js';
import { DEFENSE_BOSS_COUNT } from '../data/invasion/defenseBosses.js';

// ---------------------------------------------------------------------------
// 텍스처 — **진짜 Pixi Texture** 다(스텁 객체는 `new Sprite()` 를 통과하지 못한다).
// 소스는 Texture.EMPTY 를 공유하지만 인스턴스 identity 가 슬롯마다 다르므로, 스프라이트가
// 어느 슬롯을 집었는지 identity 비교로 판별할 수 있다.
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

/** 캐시된 스프라이트 되읽기(비공개 맵 — 렌더러의 실제 상태를 봐야 이 결함이 보인다). */
function trackedSprite(renderer: EntityRenderer, id: number): Sprite | undefined {
  const sprites = (renderer as unknown as { sprites: Map<number, { sprite: Sprite }> }).sprites;
  return sprites.get(id)?.sprite;
}

/**
 * `main.ts` 의 런 시작 순서를 그대로 밟고, **그 런의 플레이어 스프라이트 텍스처**를 돌려준다.
 * 렌더러는 앱과 마찬가지로 **런 사이에 재생성되지 않는다**(같은 인스턴스를 넘겨 받는다).
 */
function startRunAndGetPlayer(
  renderer: EntityRenderer,
  textures: PlaceholderTextures,
  profile: Profile,
  typeId: number,
): { id: number; texture: Texture | undefined } {
  const ship = activeShip(profile);
  ship.typeId = typeId;
  ship.skillInvest = zeroSkillInvest(typeId);

  // --- 이하 순서는 main.ts 의 startRun/startInvasionRun 과 동일하다 ---
  const config = buildRunConfig(profile, { planet: 0, stage: 1 });
  applyShipSprite(textures, config.shipType ?? 0);
  renderer.reset();
  const world = createWorld(0x1234abcd, config);
  const snap = snapshotWorld(world);
  renderer.render(snap, snap, 0);

  const player = snap.entities.find((e) => e.kind === 'player');
  expect(player).toBeDefined();
  const id = player?.id ?? -1;
  return { id, texture: trackedSprite(renderer, id)?.texture };
}

describe('B-1 · 세션 중 기체 교체가 인게임 스프라이트에 반영된다', () => {
  it('같은 렌더러로 런을 연달아 세우면 매 런의 스프라이트가 그 런의 기체 텍스처를 쓴다', () => {
    const textures = realTextures();
    // 앱과 같다: 렌더러는 부팅 때 한 번 만들어져 모든 런에 재사용된다.
    const renderer = new EntityRenderer(textures);
    const profile = defaultProfile();

    // 플레이테스터가 밟은 순서: 팬텀 → 브루저 → 말로우 → 아크캐스터 → 해츨링 → 버블.
    // 슬러그가 아니라 **레지스트리 전량**을 돈다(타입이 늘면 자동으로 커버된다).
    for (const def of SHIP_TYPES) {
      const got = startRunAndGetPlayer(renderer, textures, profile, def.id);
      expect(got.texture, `typeId=${def.id}(${def.slug}) 의 런`).toBe(textures.shipByType[def.id]);
    }
  });

  it('직전 런의 스프라이트가 재사용되지 않는다(캐시가 비워진다)', () => {
    const textures = realTextures();
    const renderer = new EntityRenderer(textures);
    const profile = defaultProfile();

    const first = SHIP_TYPES[0];
    const second = SHIP_TYPES[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    const a = startRunAndGetPlayer(renderer, textures, profile, first.id);
    const spriteA = trackedSprite(renderer, a.id);
    const b = startRunAndGetPlayer(renderer, textures, profile, second.id);
    const spriteB = trackedSprite(renderer, b.id);

    // 결함의 전제: 플레이어 엔티티 id 가 런 사이에 **같다**(그래서 캐시가 재사용된다).
    expect(b.id).toBe(a.id);
    expect(spriteA).toBeDefined();
    expect(spriteB).toBeDefined();
    // 같은 엔티티 id 인데 **다른 스프라이트 객체**여야 한다 — 같은 객체면 텍스처가 첫 런에
    // 묶인 채 남는다(결함의 정확한 형태).
    expect(spriteB).not.toBe(spriteA);
    expect(spriteB?.texture).toBe(textures.shipByType[second.id]);
  });

  it('reset() 은 스프라이트 캐시를 비우되 레이어는 살려 둔다(앱 수명 내내 재사용)', () => {
    const textures = realTextures();
    const renderer = new EntityRenderer(textures);
    const profile = defaultProfile();
    const first = SHIP_TYPES[0];
    if (first === undefined) return;
    startRunAndGetPlayer(renderer, textures, profile, first.id);
    const sprites =(renderer as unknown as { sprites: Map<number, unknown> }).sprites;
    expect(sprites.size).toBeGreaterThan(0);
    renderer.reset();
    expect(sprites.size).toBe(0);
    expect(renderer.layer.destroyed).toBe(false);
    // lavaOverlay(시머) · hazardHost.view(해저드 재질 심) · overlay · shadow(접지 그림자) · glow · sprite ·
    // label(이름표) · effect · fog 레이어
    expect(renderer.layer.children.length).toBe(9);
  });
});

describe('B-1 배선 계약 · main.ts 의 모든 런 시작이 캐시를 비운다', () => {
  it('`world = createWorld(` 직전에 항상 `entityRenderer.reset()` 이 있다', () => {
    // 이 저장소 tsconfig 의 fs 타입은 readFileSync 가 1인자·바이트 반환이다
    // (defenseCommandPixi.test.ts 와 같은 관용구 — Windows 드라이브 문자 보정 포함).
    const url = new URL('../src/main.ts', import.meta.url);
    const src = new TextDecoder().decode(
      readFileSync(url.pathname.replace(/^\/([A-Za-z]:)/, '$1')),
    );
    const lines = src.split(/\r?\n/);
    const starts = lines
      .map((line: string, i: number) => ({ line, i }))
      .filter(({ line }: { line: string }) => /world = createWorld\(/.test(line));
    // 런 시작 지점이 사라지면(리팩터) 이 계약이 조용히 무력화되므로 개수도 함께 잠근다.
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (const { i } of starts) {
      // 바로 앞 6줄(주석 포함) 안에 리셋 호출이 있어야 한다.
      const before = lines.slice(Math.max(0, i - 6), i).join('\n');
      expect(before, `main.ts:${i + 1} 의 런 시작에 entityRenderer.reset() 이 없다`).toMatch(
        /entityRenderer\.reset\(\)/,
      );
    }
  });
});
