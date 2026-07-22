import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG, PLAYER_HIT_RADIUS } from '../src/sim/world.js';
import type { WorldState } from '../src/sim/world.js';
import { runReplay, hashWorld, idleInputs } from '../src/sim/replay.js';
import type { InputFrame } from '../src/sim/world.js';
import { blankEntity, addEntity, spawnBoss } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import {
  BK_NONE,
  BK_ACCEL,
  BK_HOMING,
  BK_CURVE,
  BK_SPLIT,
  applyBehavior,
  stepEnemyBulletBehavior,
  accelBehavior,
  homingBehavior,
  curveBehavior,
  splitBehavior,
  type BulletSplit,
} from '../src/sim/bullets.js';
import { length } from '../src/sim/math.js';

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

/** enemyBullet 하나를 (x,y) 진행각 angle·속도 speed로 만든다(테스트 헬퍼). */
function makeBullet(x: number, y: number, angle: number, speed: number): Entity {
  const b = blankEntity('enemyBullet');
  b.x = x;
  b.y = y;
  b.angle = angle;
  b.vx = Math.cos(angle) * speed;
  b.vy = Math.sin(angle) * speed;
  b.radius = 5;
  b.damage = 10;
  b.life = 300;
  return b;
}

/** 최소 플레이어 스탠드인(호밍 목표). */
function playerAt(x: number, y: number): Entity {
  const p = blankEntity('player');
  p.x = x;
  p.y = y;
  return p;
}

describe('탄 거동 4종 — 순수 결정론 tick 함수', () => {
  it('applyBehavior가 기존 free 필드에만 파라미터를 각인한다', () => {
    const b = makeBullet(0, 0, 0, 500);
    applyBehavior(b, splitBehavior(500, 40, 3, 300));
    expect(b.enemyType).toBe(BK_SPLIT);
    expect(b.maxHp).toBe(500); // 기준 속도
    expect(b.targetX).toBe(300); // 자탄 속도(param A)
    expect(b.timer).toBe(40); // 퓨즈
    expect(b.phase).toBe(3); // 자탄 수
  });

  it('BK_NONE(-1)은 no-op — 순수 직진 유지', () => {
    const b = makeBullet(0, 0, 0, 500);
    expect(b.enemyType).toBe(BK_NONE);
    const before = { vx: b.vx, vy: b.vy, angle: b.angle };
    const dead = stepEnemyBulletBehavior(b, playerAt(9999, 9999), []);
    expect(dead).toBe(false);
    expect(b.vx).toBe(before.vx);
    expect(b.vy).toBe(before.vy);
    expect(b.angle).toBe(before.angle);
  });

  it('① 가속: 속도가 매 틱 증가하고 방향은 유지된다', () => {
    const b = makeBullet(0, 0, 0, 300);
    applyBehavior(b, accelBehavior(300, 1200)); // +1200 u/s²
    const s0 = length(b.vx, b.vy);
    for (let i = 0; i < 10; i++) stepEnemyBulletBehavior(b, playerAt(0, 0), []);
    const s1 = length(b.vx, b.vy);
    expect(s1).toBeGreaterThan(s0);
    expect(b.angle).toBe(0); // 진행각 불변
    expect(b.vy).toBeCloseTo(0, 6); // 순수 +x 방향
  });

  it('① 감속: 음의 가속도는 속도를 0에서 클램프한다(역주행 없음)', () => {
    const b = makeBullet(0, 0, 0, 100);
    applyBehavior(b, accelBehavior(100, -100000)); // 강한 감속
    stepEnemyBulletBehavior(b, playerAt(0, 0), []);
    expect(b.maxHp).toBe(0);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
  });

  it('② 유도: 락 동안 플레이어 쪽으로 선회, 만료 후 직진', () => {
    // 오른쪽(+x)으로 발사, 플레이어는 위쪽(+y). 유도 중이면 각도가 +y로 틀어진다.
    const b = makeBullet(0, 0, 0, 400);
    applyBehavior(b, homingBehavior(400, 3, 0.1)); // 락 3틱, 선회 0.1rad/tick
    expect(b.enemyType).toBe(BK_HOMING);
    const player = playerAt(0, 1000);
    stepEnemyBulletBehavior(b, player, []);
    const a1 = b.angle;
    expect(a1).toBeGreaterThan(0); // +y(위)로 선회 시작
    expect(a1).toBeLessThanOrEqual(0.1 + 1e-9); // 선회 상한 존중
    // 락 소진.
    stepEnemyBulletBehavior(b, player, []);
    stepEnemyBulletBehavior(b, player, []);
    expect(b.timer).toBe(0);
    const a3 = b.angle;
    // 락 만료 후에는 더 이상 각도가 변하지 않는다(직진).
    stepEnemyBulletBehavior(b, player, []);
    expect(b.angle).toBe(a3);
  });

  it('③ 곡사: 진행각이 매 틱 각속도만큼 회전한다', () => {
    const b = makeBullet(0, 0, 0, 400);
    applyBehavior(b, curveBehavior(400, 0.05)); // 각속도 0.05rad/tick
    stepEnemyBulletBehavior(b, playerAt(0, 0), []);
    expect(b.angle).toBeCloseTo(0.05, 9);
    stepEnemyBulletBehavior(b, playerAt(0, 0), []);
    expect(b.angle).toBeCloseTo(0.1, 9);
    // 속도는 일정(sim의 다항식 cos/sin 근사 오차 여유 < 1u/s).
    expect(Math.abs(length(b.vx, b.vy) - 400)).toBeLessThan(1);
  });

  it('③ 곡사: 각가속도가 각속도를 누적한다(나선)', () => {
    const b = makeBullet(0, 0, 0, 400);
    applyBehavior(b, curveBehavior(400, 0.0, 0.01)); // 초기 각속도 0, 각가속도 0.01
    stepEnemyBulletBehavior(b, playerAt(0, 0), []); // angle += 0, w -> 0.01
    stepEnemyBulletBehavior(b, playerAt(0, 0), []); // angle += 0.01, w -> 0.02
    expect(b.angle).toBeCloseTo(0.01, 9);
    expect(b.targetX).toBeCloseTo(0.02, 9); // 누적된 각속도
  });

  it('④ 분열: 퓨즈 만료 틱에 자탄 방사 예약 + 자신 소멸', () => {
    const b = makeBullet(0, 0, 0, 500);
    applyBehavior(b, splitBehavior(500, 2, 4, 300));
    const splits: BulletSplit[] = [];
    expect(stepEnemyBulletBehavior(b, playerAt(0, 0), splits)).toBe(false); // 퓨즈 2->1
    expect(b.dead).toBe(false);
    expect(splits.length).toBe(0);
    expect(stepEnemyBulletBehavior(b, playerAt(0, 0), splits)).toBe(true); // 퓨즈 1->0 분열
    expect(b.dead).toBe(true);
    expect(splits.length).toBe(1);
    expect(splits[0]!.count).toBe(4);
    expect(splits[0]!.speed).toBe(300);
    expect(splits[0]!.damage).toBe(10);
  });
});

describe('시그니처 배정 — 적 kind별 데이터 탄 거동', () => {
  it('돌격형 파편은 곡사(BK_CURVE) 거동을 갖는다', () => {
    const state = createWorld(3);
    const player = state.entities[0]!;
    const charger = blankEntity('enemy');
    charger.x = player.x + 600;
    charger.y = player.y + 200;
    charger.vx = -300;
    charger.radius = 36;
    charger.hp = 100;
    charger.maxHp = 100;
    charger.enemyType = 0; // charger
    charger.cooldown = 0;
    addEntity(state, charger);
    stepWorld(state, IDLE);
    const frags = state.entities.filter((e) => e.kind === 'enemyBullet');
    expect(frags.length).toBeGreaterThanOrEqual(4);
    for (const f of frags) expect(f.enemyType).toBe(BK_CURVE);
  });

  it('사수형 섬멸 서브탄은 가속(BK_ACCEL) 거동을 갖는다', () => {
    // 밴드2(단계21+)에서만 mortar 서브탄이 방사된다(stageParams.subBullets>0).
    const state = createWorld(7, { ...DEFAULT_CONFIG, stage: 21 });
    const player = state.entities[0]!;
    const gunner = blankEntity('enemy');
    gunner.x = player.x + 380;
    gunner.y = player.y;
    gunner.radius = 32;
    gunner.hp = 100;
    gunner.maxHp = 100;
    gunner.enemyType = 1; // gunner (mortar)
    gunner.cooldown = 0;
    addEntity(state, gunner);
    stepWorld(state, IDLE);
    const shards = state.entities.filter((e) => e.kind === 'enemyBullet');
    expect(shards.length).toBeGreaterThan(0);
    for (const s of shards) expect(s.enemyType).toBe(BK_ACCEL);
  });

  it('보스 P1 링은 가속(BK_ACCEL) 거동을 갖는다', () => {
    const state = createWorld(11);
    const player = state.entities[0]!;
    const boss = spawnBoss(state, player.x, player.y - 300, 3600, 128);
    state.bossSpawned = true;
    // P1(만체력): ring이 즉시 발사되도록 몇 틱 진행.
    for (let i = 0; i < 4; i++) stepWorld(state, IDLE);
    const bullets = state.entities.filter((e) => e.kind === 'enemyBullet');
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.some((b) => b.enemyType === BK_ACCEL)).toBe(true);
    // boss 참조는 hp 최댓값으로 P1임을 확인(회귀 가드).
    expect(boss.maxHp).toBe(3600);
  });

  it('보스 P3 나선은 분열(BK_SPLIT) 거동을 갖고 자탄으로 갈라진다', () => {
    const state = createWorld(13);
    const player = state.entities[0]!;
    const boss = spawnBoss(state, player.x, player.y - 300, 3600, 128);
    boss.phase = 2; // P3 (전이 없이 즉시 발악 패턴)
    boss.hp = Math.round(boss.maxHp * 0.3); // frac<=0.35 → targetPhase 2 == phase (전이 없음)
    state.bossSpawned = true;
    for (let i = 0; i < 4; i++) stepWorld(state, IDLE);
    const bullets = state.entities.filter((e) => e.kind === 'enemyBullet');
    expect(bullets.some((b) => b.enemyType === BK_SPLIT)).toBe(true);
    // 퓨즈가 만료될 때까지 진행하면 자탄(순수 직진, enemyType -1)이 생겨야 한다.
    const splitCount0 = bullets.filter((b) => b.enemyType === BK_SPLIT).length;
    for (let i = 0; i < 45; i++) stepWorld(state, IDLE);
    const after = state.entities.filter((e) => e.kind === 'enemyBullet');
    const children = after.filter((b) => b.enemyType === BK_NONE);
    expect(splitCount0).toBeGreaterThan(0);
    expect(children.length).toBeGreaterThan(0);
  });
});

describe('판정점(ADR-0010) — 기체보다 훨씬 작은 피격 원', () => {
  it('PLAYER_HIT_RADIUS가 기체 반지름보다 훨씬 작다', () => {
    const state = createWorld(1);
    const player = state.entities[0]!;
    expect(PLAYER_HIT_RADIUS).toBeLessThan(player.radius / 2);
  });

  it('판정점 밖(기체는 스치는) 적탄은 피해를 주지 않는다', () => {
    const state = createWorld(1);
    const player = state.entities[0]!;
    const hp0 = player.hp;
    // 기체 반지름(32) 안이지만 판정점(8)+탄반지름(5)=13 밖 거리 20에 배치 → 그레이징.
    const b = makeBullet(player.x + 20, player.y, Math.PI, 0);
    b.damage = 25;
    b.radius = 5;
    b.life = 300;
    addEntity(state, b);
    stepWorld(state, IDLE);
    expect(player.hp).toBe(hp0); // 피해 없음(아슬아슬하게 살았다)
  });

  it('판정점 안의 적탄은 피해를 준다', () => {
    const state = createWorld(1);
    const player = state.entities[0]!;
    const hp0 = player.hp;
    // 판정점(8)+탄반지름(5)=13 안 거리 6에 배치 → 피격.
    const b = makeBullet(player.x + 6, player.y, Math.PI, 0);
    b.damage = 25;
    b.radius = 5;
    b.life = 300;
    addEntity(state, b);
    stepWorld(state, IDLE);
    expect(player.hp).toBeLessThan(hp0);
    expect(player.iframes).toBeGreaterThan(0);
  });

  it('젬 픽업은 여전히 관대한 기체 반지름으로 판정한다(판정점 아님)', () => {
    const state = createWorld(1);
    const player = state.entities[0]!;
    // 판정점(8) 밖·기체 반지름(32) 안 거리 20에 젬 배치 → 여전히 수집돼야 한다.
    const gem = blankEntity('gem');
    gem.x = player.x + 20;
    gem.y = player.y;
    gem.radius = 20;
    gem.hp = 1;
    gem.damage = 5;
    addEntity(state, gem);
    const gems0 = state.gems;
    stepWorld(state, IDLE);
    expect(state.gems).toBeGreaterThan(gems0);
  });
});

describe('거동 탄 결정론(ADR-0005) — 같은 시드 → 같은 hashWorld', () => {
  /** 보스까지 빠르게 도달해 거동 탄이 대량 발생하는 런(maxSegments 단축). */
  function bossRunHashes(seed: number): number[] {
    const config = { ...DEFAULT_CONFIG, maxSegments: 1 };
    const state = createWorld(seed, config);
    const hashes: number[] = [];
    for (let i = 0; i < 60 * 70; i++) {
      stepWorld(state, IDLE);
      hashes.push(hashWorld(state));
    }
    return hashes;
  }

  it('보스 런(거동+분열+가속+유도 혼재)이 두 번 실행에서 tick별 해시 동일', () => {
    const a = bossRunHashes(0xb055);
    const b = bossRunHashes(0xb055);
    expect(a).toEqual(b);
  });

  it('runReplay 경로로도 거동 탄 런이 재현된다', () => {
    const config = { ...DEFAULT_CONFIG, maxSegments: 1 };
    const inputs = idleInputs(60 * 70);
    const r1 = runReplay({ seed: 0xb055, config, inputs });
    const r2 = runReplay({ seed: 0xb055, config, inputs });
    expect(r1.hashes).toEqual(r2.hashes);
    // 이 런이 실제로 거동 탄(가속·분열 등)을 만들었는지 sanity 체크.
    const behaviored = r1.finalState.entities.filter(
      (e: Entity) => e.kind === 'enemyBullet' && e.enemyType !== BK_NONE,
    );
    // 보스 페이즈에 따라 순간적으로 0일 수 있으므로, 링/나선 거동을 만든 적이 있는지는
    // 아래 별도 카운트 런으로 확인한다(여기선 재현성만 단언).
    expect(Array.isArray(behaviored)).toBe(true);
  });

  it('보스 전투에서 거동 탄(가속·분열)이 실제로 발생한다', () => {
    // 직접 보스를 스폰해 P1(가속 링)·P3(분열 나선) 두 국면을 결정론적으로 관측한다
    // (idle 플레이어 생존에 의존하지 않음). 시각 문법·밀도 집중이 sim에서 창발함을 증명.
    const observe = (phase: number, hpFrac: number, want: number): boolean => {
      const state: WorldState = createWorld(0xb0 + phase);
      const player = state.entities[0]!;
      const boss = spawnBoss(state, player.x, player.y - 300, 3600, 128);
      boss.phase = phase;
      boss.hp = Math.round(boss.maxHp * hpFrac);
      state.bossSpawned = true;
      let saw = false;
      for (let i = 0; i < 20 && !saw; i++) {
        stepWorld(state, IDLE);
        for (const e of state.entities) {
          if (e.kind === 'enemyBullet' && e.enemyType === want) saw = true;
        }
      }
      return saw;
    };
    expect(observe(0, 1.0, BK_ACCEL)).toBe(true); // P1 링 → 가속
    expect(observe(2, 0.3, BK_SPLIT)).toBe(true); // P3 나선 → 분열
  });
});
