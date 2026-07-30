/**
 * 시각 권위 계약 — **누가 화면에서 먼저 눈에 들어야 하는가.**
 *
 * ## 이 파일이 막는 결함 세 가지는 전부 비평가가 화면에서 잡았다(2026-07-30)
 *
 * 셋 다 단위 테스트가 전부 그린인 채로 살아 있었다. 공통점은 "각 모듈은 자기 일을 옳게 했고,
 * 화면에서 누가 이기는가는 아무도 안 봤다"는 것이다.
 *
 * 1. **플레이어가 잡몹 아래에 그려졌다.** `spriteLayer` 에 z 우선순위가 없어 자식 추가 순서가
 *    그리는 순서인데, 플레이어는 스냅샷 `entities[0]` 이라 거의 항상 가장 먼저 만들어져 **가장
 *    아래**에 깔린다. 실측(카르곤 보스 컷): 플레이어가 적 몸통에 **약 70% 가려져 있었다.**
 *    기준선 문서의 최고가 결함("보스 컷에서 플레이어를 찾는 데 시간이 걸린다")의 잔존분이 실은
 *    여기였다 — 플레이어 비주얼 레인이 세 라운드에 걸쳐 선체 **주변** 가독을 올렸지만(외곽선·
 *    이방성 헤일로·감산 컨투어) 선체 자체가 z 싸움에서 지고 있었다.
 * 2. **보스가 아군 시안 헤일로를 두르고 있었다.** 계약 §2-2 는 시안을 아군 전용으로 못박았고,
 *    `glow.ts` 헤더는 "발광체별로 색을 달리하려면 color 인자로 덮는다(젬=시안, 보스=웜 등)"고
 *    적어 두었는데 **호출부가 그 인자를 한 번도 넘기지 않았다.** 의도만 문서에 있고 배선이 없었다.
 * 3. **젬이 화면 최고 명도라 적보다 눈에 들었다** — 위협보다 보상이 밝은 우선순위 역전.
 *    기준선 문서가 지적한 결함인데 3차까지 살아 있었다.
 *
 * ── 결정론(ADR-0005) ── render-only 배선만 본다. sim·hashWorld 에 닿지 않는다.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Texture } from 'pixi.js';

import { EntityRenderer } from '../src/render/entityRenderer.js';
import {
  DEFAULT_HALO_COLOR,
  HALO_COLOR_HOSTILE,
  HALO_COLOR_REWARD,
  haloSpec,
  isGlowEmitter,
} from '../src/render/effects/glow.js';
import { graphicsTierController } from '../src/render/graphicsRuntime.js';
import type { QualityTier } from '../src/render/qualityTier.js';
import type { PlaceholderTextures } from '../src/render/textures.js';
import type { EntitySnapshot, WorldSnapshot } from '../src/sim/snapshot.js';

const BASE_TIER = graphicsTierController.getActiveTier();

function forceTier(t: QualityTier): void {
  graphicsTierController.tick(60, 1 / 60, t);
}

afterEach(() => {
  forceTier(BASE_TIER);
});

/** 최소 텍스처 세트(GL 없이 도는 화이트 텍스처). */
function textures(): PlaceholderTextures {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'anim') return null;
        if (prop === 'parachute') return null;
        if (prop === 'shipByType' || prop === 'enemyByType' || prop === 'bossByPlanet') return null;
        return Texture.WHITE;
      },
    },
  ) as unknown as PlaceholderTextures;
}

function ent(o: Partial<EntitySnapshot> & { id: number; kind: string }): EntitySnapshot {
  return {
    x: 0,
    y: 0,
    radius: 16,
    angle: 0,
    hp: 100,
    maxHp: 100,
    enemyType: 0,
    elite: -1,
    active: false,
    flash: false,
    permanent: false,
    aabbH: 0,
    ...o,
  } as unknown as EntitySnapshot;
}

function world(entities: EntitySnapshot[]): WorldSnapshot {
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
  } as unknown as WorldSnapshot;
}

// ===========================================================================

describe('z 우선순위 — 아바타는 잡몹에 가리지 않는다', () => {
  it('플레이어가 먼저 생성돼도(entities[0]) 스프라이트 레이어 최상단으로 올라간다', () => {
    forceTier('low'); // 장식 최소화 — z 순서만 본다.
    const r = new EntityRenderer(textures());
    // 실제 스냅샷 순서를 그대로 재현한다: 플레이어가 맨 앞이라 **가장 먼저** addChild 된다.
    const w = world([
      ent({ id: 1, kind: 'player' }),
      ent({ id: 2, kind: 'enemy', x: 10 }),
      ent({ id: 3, kind: 'enemy', x: 20 }),
      ent({ id: 4, kind: 'enemy', x: 30 }),
    ]);
    r.render(w, w, 0);
    // ⚠️ 이 단언이 없으면 플레이어가 적 셋 아래에 깔린다(실측 보스 컷 70% 가림).
    expect(r.playerOnTop).toBe(true);
    r.destroy();
  });

  it('적이 나중에 추가돼도 매 프레임 다시 올라간다(한 번 올리는 것으로는 부족하다)', () => {
    forceTier('low');
    const r = new EntityRenderer(textures());
    const first = world([ent({ id: 1, kind: 'player' })]);
    r.render(first, first, 0);
    expect(r.playerOnTop).toBe(true);
    // 다음 프레임에 신규 적이 등장 → addChild 로 플레이어 뒤에 붙는다.
    const later = world([
      ent({ id: 1, kind: 'player' }),
      ent({ id: 9, kind: 'enemy', x: 40 }),
    ]);
    r.render(later, later, 0);
    expect(r.playerOnTop).toBe(true);
    r.destroy();
  });

  it('플레이어가 없으면 관측창이 false 다(빈 통과 오탐 방지)', () => {
    forceTier('low');
    const r = new EntityRenderer(textures());
    const w = world([ent({ id: 2, kind: 'enemy' })]);
    r.render(w, w, 0);
    expect(r.playerOnTop).toBe(false);
    r.destroy();
  });
});

describe('§2-2 시안은 아군 전용 — 발광체 헤일로 색', () => {
  it('보스·방어보스 헤일로는 난색이다(시안이 아니다)', () => {
    // 이 단언이 없던 동안 보스가 아군색 헤일로를 두르고 있었다.
    expect(haloSpec('boss').color).toBe(HALO_COLOR_HOSTILE);
    expect(haloSpec('defenseBoss').color).toBe(HALO_COLOR_HOSTILE);
    for (const kind of ['boss', 'defenseBoss']) {
      expect(haloSpec(kind).color).not.toBe(DEFAULT_HALO_COLOR);
    }
  });

  it('적대 헤일로 색이 실제로 난색이다(R 지배) — 상수 이름이 아니라 값을 잰다', () => {
    // 상수를 시안으로 바꿔치기하면 위 테스트는 통과하지만 이 테스트가 빨개진다.
    const rgb = (c: number) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff] as const;
    const [r, g, b] = rgb(HALO_COLOR_HOSTILE);
    expect(r).toBeGreaterThan(Math.max(g, b) + 30);
  });

  it('플레이어만 기본 시안을 유지한다', () => {
    expect(haloSpec('player').color).toBe(DEFAULT_HALO_COLOR);
  });

  it('발광체 allowlist 의 모든 kind 가 서술을 갖는다(미등록 kind 가 조용히 시안이 되지 않는다)', () => {
    // allowlist 에 새 kind 가 늘면 여기서 분류를 강제한다.
    const emitters = ['player', 'gem', 'loot', 'boss', 'defenseBoss'];
    for (const k of emitters) expect(isGlowEmitter(k)).toBe(true);
    // 아군(시안) / 보상(금) / 적대(난색) 셋 중 하나여야 한다.
    const allowed = new Set([DEFAULT_HALO_COLOR, HALO_COLOR_REWARD, HALO_COLOR_HOSTILE]);
    for (const k of emitters) expect(allowed.has(haloSpec(k).color)).toBe(true);
  });
});

describe('우선순위 — 위협이 보상보다 밝다', () => {
  it('보상 헤일로(젬·전리품)는 아군·적대보다 알파가 낮다', () => {
    // 젬이 화면 최고 명도라 적보다 눈에 들던 역전의 처방. 젬은 자기 스프라이트로도 충분히 보인다.
    expect(haloSpec('gem').alphaScale).toBeLessThan(haloSpec('boss').alphaScale);
    expect(haloSpec('loot').alphaScale).toBeLessThan(haloSpec('player').alphaScale);
  });

  it('보상 헤일로 색은 금색이고 시안이 아니다', () => {
    expect(haloSpec('gem').color).toBe(HALO_COLOR_REWARD);
    expect(haloSpec('loot').color).toBe(HALO_COLOR_REWARD);
    expect(haloSpec('gem').color).not.toBe(DEFAULT_HALO_COLOR);
  });

  it('보상 알파 배율이 1 미만이다 — "낮다"가 상대 비교만으로 참이 되지 않게 한다', () => {
    // 다른 kind 를 다 올려서 이 관계를 만족시키는 우회를 막는다.
    expect(haloSpec('gem').alphaScale).toBeLessThan(1);
    expect(haloSpec('loot').alphaScale).toBeLessThan(1);
  });
});
