/**
 * 전투 부가 연출 **배선** 통합 테스트 (Phase 4 — plan §AC-4.1/4.4/4.5/4.6/4.7 · AC-6.3; ADR-0031).
 *
 * ## 왜 이 형태인가
 * 이 프로젝트의 #1 반복 결함은 "순수함수 유닛은 그린인데 정규 경로에 배선이 통째로 없다"(8건 이력)이다.
 * DamageNumber·BulletTrail·GrazeSpark·PickupPop·LevelUpRing·MuzzleFlash 각각의 순수 유닛이 다 통과해도,
 * entityRenderer 의 엔티티/킬 루프가 그것들을 **실제로 호출하지 않으면** 게임엔 아무것도 안 뜬다. 그래서
 * 여기서는 순수함수를 재검하지 않고, **실제 `EntityRenderer` 를 세워 정규 snapshot→render 경로로 태운 뒤**
 * 관측창(damageNumberCount·bulletTrailCount·grazeSparkCount·pickupPopCount·levelUpRingCount·muzzleFlashCount)의
 * 델타를 assert 한다 — 배선이 빠지면 즉시 빨개진다.
 *
 * ## node-env
 * PixiJS 는 렌더러 없이 import 만 하므로 node 에서 그대로 돈다(glowWiring/eventShaderWiring 선례). 모든
 * 이펙트는 절차적 Graphics 라 GL 없이 생성자에서 표시객체를 만든다(children>0). render 의 프레임 dt 는
 * 벽시계(performance.now)라 테스트가 직접 못 주지만, "편입"(트리거→이펙트 생성)은 1~2 프레임으로 검증되고
 * 수명 소멸은 각 모듈의 유닛 테스트가 담당한다.
 *
 * ## 결정론 계약
 * render-only 배선만 검증한다. 데미지 숫자는 스냅샷 HP-델타 추론이라 **sim 0 변경**이다 — sim·hashWorld/
 * hashEntity 무접촉. 골든 해시 불변은 determinism.test.ts·invasionHash.test.ts 가 별도로 못 박는다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Texture } from 'pixi.js';

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
// 진짜 Pixi Texture — 렌더러가 각 엔티티에 new Sprite(textureFor(e)) 를 만들기 때문에 스텁 불가
// (eventShaderWiring.test.ts 와 동일 관용구).
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
    radius: 16,
    aabbH: 0,
    enemyType: -1,
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

/** render 가 관찰하는 활성 티어를 수동 오버라이드로 잠근다(glowWiring 선례). */
function lockTier(tier: 'low' | 'med' | 'high'): void {
  graphicsTierController.tick(60, 1 / 60, tier);
}

// 공유 싱글턴 초기화 — 티어=High(전 게이트 on), 감소 토글 off, 데미지 숫자 on(테스트 간 오염 방지).
beforeEach(() => {
  graphicsSettings.set({
    quality: 'auto',
    reducedMotion: false,
    reducedGlow: false,
    damageNumbers: true,
  });
  lockTier('high');
});

// ===========================================================================

describe('AC-4.1 · 데미지 숫자 배선 (보스·엘리트 HP-델타, sim 0 변경)', () => {
  // 감지는 렌더러가 유지하는 tracked.hp 로 한다(스냅샷 보간 p.hp 아님, 리뷰 HIGH-1). 따라서 피해는
  // **프레임 간**(기준선 render → 낮은 hp render)에 감지된다 — 한 render 로는 안 뜬다(생성 프레임엔
  // tracked.hp=e.hp 라 델타 0). 이 형태가 곧 프로덕션 거동(스냅샷이 프레임마다 반복되어도 1회)이다.

  it('보스가 피해를 입으면(프레임 간 HP 델타) 데미지 숫자가 뜬다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w100 = world([entity('boss', { id: 1, hp: 100 })]);
    const w80 = world([entity('boss', { id: 1, hp: 80 })]);
    r.render(w100, w100, 1); // 기준선(tracked.hp=100), 델타 0
    expect(r.damageNumberCount).toBe(0);
    r.render(w80, w80, 1); // tracked.hp(100) > 80 → 피해 20 방출
    expect(r.damageNumberCount).toBeGreaterThan(0); // 미배선이면 0
    r.destroy();
  });

  it('엘리트 잡몹(elite>=0)이 피해를 입으면 데미지 숫자가 뜬다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const a = world([entity('enemy', { id: 2, elite: 0, hp: 100 })]);
    const b = world([entity('enemy', { id: 2, elite: 0, hp: 60 })]);
    r.render(a, a, 1);
    r.render(b, b, 1);
    expect(r.damageNumberCount).toBeGreaterThan(0);
    r.destroy();
  });

  it('일반 잡몹(elite<0)은 피해를 입어도 데미지 숫자가 없다(보스·엘리트만)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const a = world([entity('enemy', { id: 3, elite: -1, hp: 100 })]);
    const b = world([entity('enemy', { id: 3, elite: -1, hp: 60 })]);
    r.render(a, a, 1);
    r.render(b, b, 1);
    expect(r.damageNumberCount).toBe(0);
    r.destroy();
  });

  it('힐(HP 델타<0)은 데미지 숫자를 내지 않는다(Critic m3 ②)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const low = world([entity('boss', { id: 1, hp: 60 })]);
    const high = world([entity('boss', { id: 1, hp: 90 })]);
    r.render(low, low, 1); // 기준선 tracked.hp=60
    r.render(high, high, 1); // tracked.hp(60) > 90? 거짓(힐) → 숫자 없음
    expect(r.damageNumberCount).toBe(0);
    r.destroy();
  });

  it('플레이어 피격은 데미지 숫자를 내지 않는다(대상 아님)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const a = world([entity('player', { id: 1, hp: 100 })]);
    const b = world([entity('player', { id: 1, hp: 70 })]);
    r.render(a, a, 1);
    r.render(b, b, 1);
    expect(r.damageNumberCount).toBe(0);
    r.destroy();
  });

  it('graphicsSettings.damageNumbers=off 면 보스 피격에도 숫자가 없다(토글)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    graphicsSettings.set({ damageNumbers: false });
    const a = world([entity('boss', { id: 1, hp: 100 })]);
    const b = world([entity('boss', { id: 1, hp: 50 })]);
    r.render(a, a, 1);
    r.render(b, b, 1);
    expect(r.damageNumberCount).toBe(0);
    r.destroy();
  });

  it('킬블로우: 보스가 소멸하면 잔량을 최종 피해 숫자로 띄운다(엣지 ①)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    // 1) 보스 편입(tracked.hp=50 확립, 델타 0 → 숫자 없음).
    r.render(world([entity('boss', { id: 1, hp: 50 })]), world([entity('boss', { id: 1, hp: 50 })]), 1);
    expect(r.damageNumberCount).toBe(0);
    // 2) 보스 소멸 → curr 스냅샷 없음. 킬 루프가 tracked.hp(50) 잔량을 최종 숫자로.
    r.render(world([]), world([]), 1);
    expect(r.damageNumberCount).toBeGreaterThan(0); // 미배선이면 0
    r.destroy();
  });

  it('HIGH-1 회귀: 같은 스냅샷을 반복 render 해도 데미지 숫자가 중복 발화하지 않는다', () => {
    // render 는 sim(60Hz)과 분리돼 sim-step 없는 프레임에 **같은 스냅샷 쌍**으로 다시 호출된다.
    // p.hp 델타로 감지하면 그 프레임마다 새 숫자가 쏟아진다(HIGH-1). tracked.hp 델타는 1회만 발화해야.
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w100 = world([entity('boss', { id: 1, hp: 100 })]);
    const w80 = world([entity('boss', { id: 1, hp: 80 })]);
    r.render(w100, w100, 1); // 기준선
    r.render(w80, w80, 1); // 피해 감지 → 1개
    const afterHit = r.damageNumberCount;
    expect(afterHit).toBeGreaterThan(0);
    // sim-step 없는 프레임을 흉내: **동일한** (prev=w80, curr=w80) 을 여러 번 더 render.
    r.render(w80, w80, 1);
    r.render(w80, w80, 1);
    r.render(w80, w80, 1);
    // 추가 숫자가 생기면 안 된다(중복 발화 X). 기존 숫자는 수명 진행 중이라 수는 늘지만 말아야.
    expect(r.damageNumberCount).toBeLessThanOrEqual(afterHit);
    r.destroy();
  });

  it('MEDIUM: 연사·DoT(매 프레임 피해)여도 스로틀로 숫자가 프레임당 1개씩 쏟아지지 않는다', () => {
    // 매 프레임 hp 를 10 씩 깎아 12프레임 피해를 준다 → 스로틀(THROTTLE_FRAMES=8) 로 방출이 합쳐져
    // 프레임 수보다 훨씬 적은 숫자만 생성돼야 한다(예산 고갈·겹침 방지, 리뷰 MEDIUM).
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    let hp = 1000;
    const step = () => {
      hp -= 10;
      const w = world([entity('boss', { id: 1, hp })]);
      r.render(w, w, 1);
    };
    r.render(world([entity('boss', { id: 1, hp: 1000 })]), world([entity('boss', { id: 1, hp: 1000 })]), 1); // 기준선
    for (let i = 0; i < 12; i++) step();
    // 12프레임 연속 피해지만 스로틀로 방출은 소수(넉넉히 6 이하)여야 한다(프레임당 1개면 12개).
    expect(r.damageNumberCount).toBeLessThanOrEqual(6);
    expect(r.damageNumberCount).toBeGreaterThan(0);
    r.destroy();
  });
});

describe('AC-4.4 · 탄 트레일 배선 (플레이어 탄 + 특수 적탄)', () => {
  it('플레이어 탄은 Med+ 티어에서 트레일을 남긴다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    r.render(world([entity('bullet', { id: 5, enemyType: -1 })]), world([entity('bullet', { id: 5 })]), 1);
    expect(r.bulletTrailCount).toBeGreaterThan(0); // 미배선이면 0
    r.destroy();
  });

  it('특수 거동 적탄(유도 behavior=1)은 트레일을 남긴다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('enemyBullet', { id: 6, enemyType: 1 })]);
    r.render(w, w, 0);
    expect(r.bulletTrailCount).toBeGreaterThan(0);
    r.destroy();
  });

  it('직진 잡몹탄(behavior=-1)은 트레일이 없다(가독성 — 조밀 탄 제외)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('enemyBullet', { id: 7, enemyType: -1 })]);
    r.render(w, w, 0);
    expect(r.bulletTrailCount).toBe(0);
    r.destroy();
  });

  it('Low 티어(trails off)면 플레이어 탄도 트레일이 없다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('low');
    const w = world([entity('bullet', { id: 5 })]);
    r.render(w, w, 0);
    expect(r.bulletTrailCount).toBe(0);
    r.destroy();
  });
});

describe('AC-4.5 · 그레이징 스파크 배선 (render-only 근접 회피, 보상 없음)', () => {
  // 플레이어 r16 · 적탄 r4 → 충돌 반경 20. GRAZE_BAND=14 → 근접 대역 (20, 34].
  const player = () => entity('player', { id: 1, x: 0, y: 0, radius: 16 });

  it('적탄이 근접 대역(판정점 밖)에 진입하면 스파크가 뜬다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    // 탄을 dist 25(=20<25<=34)에 둔다 → 그레이징 진입 → rising-edge 스파크.
    const w = world([player(), entity('enemyBullet', { id: 2, x: 25, y: 0, radius: 4, enemyType: -1 })]);
    r.render(w, w, 0);
    expect(r.grazeSparkCount).toBeGreaterThan(0); // 미배선이면 0
    r.destroy();
  });

  it('판정점 안(실충돌 거리)의 탄은 스파크를 내지 않는다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    // dist 12 < 20(충돌) → 스치는 게 아니라 맞음 → 스파크 없음.
    const w = world([player(), entity('enemyBullet', { id: 2, x: 12, y: 0, radius: 4, enemyType: -1 })]);
    r.render(w, w, 0);
    expect(r.grazeSparkCount).toBe(0);
    r.destroy();
  });

  it('멀리 있는 탄(대역 밖)은 스파크를 내지 않는다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([player(), entity('enemyBullet', { id: 2, x: 80, y: 0, radius: 4, enemyType: -1 })]);
    r.render(w, w, 0);
    expect(r.grazeSparkCount).toBe(0);
    r.destroy();
  });
});

describe('AC-4.6 · 수집 팝 + 레벨업 링 배선', () => {
  it('gem 이 소멸(수집)하면 수집 팝이 뜬다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    r.render(world([entity('gem', { id: 3 })]), world([entity('gem', { id: 3 })]), 0);
    expect(r.pickupPopCount).toBe(0); // 아직 살아있음
    r.render(world([]), world([]), 0); // 수집 → 소멸
    expect(r.pickupPopCount).toBeGreaterThan(0); // 미배선이면 0
    r.destroy();
  });

  it('loot(전리품) 소멸도 수집 팝을 낸다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    r.render(world([entity('loot', { id: 4, enemyType: 0 })]), world([entity('loot', { id: 4, enemyType: 0 })]), 0);
    r.render(world([]), world([]), 0);
    expect(r.pickupPopCount).toBeGreaterThan(0);
    r.destroy();
  });

  it('pulseLevelUp 신호 후 render 하면 플레이어 위치에 레벨업 링이 뜬다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('player', { id: 1 })]);
    r.render(w, w, 0);
    expect(r.levelUpRingCount).toBe(0); // 신호 없으면 없음
    r.pulseLevelUp();
    r.render(w, w, 0);
    expect(r.levelUpRingCount).toBeGreaterThan(0); // 미배선이면 0
    r.destroy();
  });

  it('플레이어가 없으면 레벨업 예약이 소비되지 않고 유지된다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    r.pulseLevelUp();
    r.render(world([]), world([]), 0); // 플레이어 없음 → 방출 안 함
    expect(r.levelUpRingCount).toBe(0);
    // 이후 플레이어가 나타나면 예약된 링이 방출된다.
    const w = world([entity('player', { id: 1 })]);
    r.render(w, w, 0);
    expect(r.levelUpRingCount).toBeGreaterThan(0);
    r.destroy();
  });
});

describe('AC-4.7 · 머즐 플래시 배선 (신규 플레이어 탄 근사)', () => {
  it('신규 플레이어 탄이 등장하면 총구 섬광이 뜬다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    // 플레이어 + 신규 탄 동시 등장 → newPlayerBullet && hasPlayer.
    const w = world([entity('player', { id: 1 }), entity('bullet', { id: 9, enemyType: -1 })]);
    r.render(w, w, 0);
    expect(r.muzzleFlashCount).toBeGreaterThan(0); // 미배선이면 0
    r.destroy();
  });

  it('신규 적탄(enemyBullet)은 머즐 플래시를 내지 않는다(플레이어 발사만)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('player', { id: 1 }), entity('enemyBullet', { id: 9, enemyType: -1 })]);
    r.render(w, w, 0);
    expect(r.muzzleFlashCount).toBe(0);
    r.destroy();
  });

  it('이미 추적 중인 탄은 재-머즐하지 않는다(신규 등장만)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('player', { id: 1 }), entity('bullet', { id: 9, enemyType: -1 })]);
    r.render(w, w, 0); // 첫 등장 → 머즐
    const after1 = r.muzzleFlashCount;
    r.render(w, w, 0); // 같은 탄 유지 → 신규 아님
    // 두 번째 프레임엔 새 머즐이 안 생긴다(첫 머즐은 진행/소멸 중일 수 있어 <= 로 확인).
    expect(r.muzzleFlashCount).toBeLessThanOrEqual(after1);
    r.destroy();
  });
});

describe('정리 — 누수 0', () => {
  it('reset() 은 데미지 숫자·트레일·그레이징·수집 팝·레벨업 링·머즐을 전부 회수한다', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    // 여러 이펙트를 동시에 세운다: 보스 피격(데미지) + 플레이어 탄(트레일·머즐) + 근접 적탄(그레이징).
    r.render(
      world([entity('boss', { id: 1, hp: 100 })]),
      world([
        entity('boss', { id: 1, hp: 60 }),
        entity('player', { id: 2, x: 0, y: 0, radius: 16 }),
        entity('bullet', { id: 3, enemyType: -1 }),
        entity('enemyBullet', { id: 4, x: 25, y: 0, radius: 4, enemyType: 1 }),
      ]),
      1,
    );
    r.pulseLevelUp();
    r.render(
      world([entity('player', { id: 2, x: 0, y: 0, radius: 16 })]),
      world([entity('player', { id: 2, x: 0, y: 0, radius: 16 })]),
      0,
    );
    // 최소한 몇 개는 살아있어야 리셋 검증이 의미 있다.
    const total =
      r.damageNumberCount +
      r.bulletTrailCount +
      r.grazeSparkCount +
      r.levelUpRingCount +
      r.muzzleFlashCount;
    expect(total).toBeGreaterThan(0);

    r.reset();
    expect(r.damageNumberCount).toBe(0);
    expect(r.bulletTrailCount).toBe(0);
    expect(r.grazeSparkCount).toBe(0);
    expect(r.pickupPopCount).toBe(0);
    expect(r.levelUpRingCount).toBe(0);
    expect(r.muzzleFlashCount).toBe(0);
    r.destroy();
  });

  it('layer 자식 수는 Phase 4 이펙트 유무와 무관하게 6으로 불변(레이어 스택 회귀 가드)', () => {
    const r = new EntityRenderer(realTextures());
    lockTier('high');
    const w = world([entity('player', { id: 1 }), entity('bullet', { id: 2, enemyType: -1 })]);
    r.render(w, w, 0); // 트레일·머즐이 effectLayer 자식으로 붙지만 layer 스택은 불변.
    expect(r.layer.children.length).toBe(6);
    r.destroy();
  });
});
