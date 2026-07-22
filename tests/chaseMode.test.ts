/**
 * 추격·탈출(chase) 콘텐츠 — Lane6 (ADR-0021 §2.4).
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다"(8+회). 그래서 순수
 * 함수 계약(§1)만 못박지 않고, **실제 앱이 부르는 함수**(`buildRunConfig`)로 config 를 만들고
 * `createWorld`/`stepWorld` 를 진짜로 굴려 콘텐츠 배선이 sim 까지 도달함을 증명한다(§2 가 핵심
 * 증거). 니플헤임(planet 2)이 chase 로 배정돼 있어 **브릿지 없이 full-path** 로 검증한다:
 *   (a) 포식자(boss)가 createWorld 부터 존재·bossSpawned·aux0=0·매 틱 플레이어에 접근(추격)
 *   (b) 무적 검증: 아군탄으로 포식자 hp 가 안 깎인다(aux0=0)
 *   (c) 반격 장치 전부 파괴 → updateChasePredator 가 포식자 aux0=1(취약) → 이제 아군탄이 hp 를
 *       깎아 처치 가능 → compact boss→victory(실제 피해 경로)
 *   (d) 대피소 overlap 으로 세그먼트 전진(killGoal 아님 — kills=0 에서 전진)
 *   (e) 무적 포식자 접촉 시 gameOver(iframes 무시)
 *   (f) 컬링 회귀 가드: 플레이어를 필드 밖(8000,8000)으로 옮겨도 반격 장치·대피소·포식자가
 *       컬링되지 않는다(Lane8 도망 exploit 교훈)
 *
 * 회귀(§3): 뱀서류(planetMode 0)·블록격파(1)·레이싱(2)·오염(5)은 chase 콘텐츠 미개입 + 해시 재현.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { blankEntity, spawnBullet } from '../src/sim/entities.js';
import type { Entity } from '../src/sim/entities.js';
import { isBreakableWall } from '../src/sim/modes/blockBreak.js';
import { isBoostPad } from '../src/sim/modes/racing.js';
import {
  placeChaseCourse,
  updateChasePredator,
  chaseShelterReached,
  chaseAliveCounterDevices,
  chaseVisionRadius,
  isCounterDevice,
  isShelter,
  isPredatorInvincible,
  CHASE_COUNTER_DEVICE_COUNT,
  CHASE_SHELTER_COUNT,
  CHASE_VISION_RADIUS,
  COUNTER_DEVICE_MARK,
} from '../src/sim/modes/chase.js';

const idle: InputFrame = emptyInput();
/** 런이 접촉·탄 피해로 조기 종료되지 않게 버티는 무대 HP(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** 정규경로 full-path(스펙 §8): 니플헤임(planet 2)=chase 라 브릿지 없이 실도달. */
function chaseConfig(): WorldConfig {
  return { ...buildRunConfig(defaultProfile(), { planet: 2, stage: 1 }), playerHp: DURABLE_HP };
}

/** placeChaseCourse 만 태운 최소 상태(순수 계약 검증용). 플레이어를 index 0 에 둔다(실 레이아웃 정합). */
function placedState(planet = 2): WorldState {
  const player = blankEntity('player');
  player.id = 1;
  player.radius = 32;
  const s = {
    config: { planet },
    entities: [player] as Entity[],
    nextEntityId: 2,
    bossSpawned: false,
  } as unknown as WorldState;
  placeChaseCourse(s);
  return s;
}

function predatorOf(state: WorldState): Entity | undefined {
  return state.entities.find((e) => e.kind === 'boss');
}

function shelters(state: WorldState): Entity[] {
  return state.entities.filter(isShelter);
}

/**
 * 한 틱 진행하되 레벨업 프리즈를 자동 해소한다(contamination 선례). 젬을 주워 레벨업하면 월드가
 * 얼어(pendingLevelUp) 진행이 멎으므로 픽(0)을 넣어 즉시 해소한다.
 */
function stepChase(state: WorldState, base: InputFrame = idle): void {
  const input = state.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : base;
  stepWorld(state, input);
}

/** 대상 좌표에 거대 정지 아군탄을 얹어 이번 스텝에 파괴/피해한다(실제 피해 경로). */
function blast(state: WorldState, x: number, y: number, radius: number): void {
  spawnBullet(state, x, y, 0, 0, 1_000_000, 0, radius, 120, 1, 0);
}

// ---------------------------------------------------------------------------
// §1 — 순수 함수 계약
// ---------------------------------------------------------------------------

describe('추격 — 순수 함수', () => {
  it('placeChaseCourse: 포식자 aux0=0 · bossSpawned · 장치 N개+마커 · 대피소 N개(aux0=세그먼트 인덱스)', () => {
    const a = placedState(2);
    // 포식자(boss): 무적(aux0=0) + bossSpawned(두 번째 보스 방지).
    const predator = predatorOf(a) as Entity;
    expect(predator).toBeDefined();
    expect(predator.aux0).toBe(0);
    expect(isPredatorInvincible(predator)).toBe(true);
    expect(a.bossSpawned).toBe(true);
    // 반격 장치 N개 + 마커.
    const devices = a.entities.filter(isCounterDevice);
    expect(devices.length).toBe(CHASE_COUNTER_DEVICE_COUNT);
    for (const d of devices) expect(d.ownerId).toBe(COUNTER_DEVICE_MARK);
    // 대피소 N개 + aux0=세그먼트 인덱스(0..N-1 전수).
    const shs = shelters(a);
    expect(shs.length).toBe(CHASE_SHELTER_COUNT);
    expect(shs.map((e) => e.aux0).sort((m, n) => m - n)).toEqual(
      Array.from({ length: CHASE_SHELTER_COUNT }, (_, k) => k),
    );
  });

  it('placeChaseCourse 결정론(바이트 동일) — 배치 좌표까지 완전 일치', () => {
    const a = placedState(2);
    const b = placedState(2);
    const strip = (s: WorldState): unknown =>
      s.entities.map((e) => [e.kind, e.x, e.y, e.radius, e.hp, e.ownerId, e.aux0, e.enemyType]);
    expect(strip(a)).toEqual(strip(b));
  });

  it('isCounterDevice/isShelter/isPredatorInvincible 는 마커·kind·aux0 로만 판정한다', () => {
    const dev = blankEntity('destructible');
    dev.ownerId = COUNTER_DEVICE_MARK;
    expect(isCounterDevice(dev)).toBe(true);
    const chunkDestr = blankEntity('destructible'); // ownerId=0(절차 청크)
    expect(isCounterDevice(chunkDestr)).toBe(false);
    const sh = blankEntity('shelter');
    expect(isShelter(sh)).toBe(true);
    expect(isShelter(dev)).toBe(false);
    const boss = blankEntity('boss');
    boss.aux0 = 0;
    expect(isPredatorInvincible(boss)).toBe(true);
    boss.aux0 = 1;
    expect(isPredatorInvincible(boss)).toBe(false);
  });

  it('chaseAliveCounterDevices 는 살아있는 마킹 장치만 센다(dead·비마킹 제외)', () => {
    const s = placedState(2);
    expect(chaseAliveCounterDevices(s)).toBe(CHASE_COUNTER_DEVICE_COUNT);
    (s.entities.filter(isCounterDevice)[0] as Entity).dead = true;
    expect(chaseAliveCounterDevices(s)).toBe(CHASE_COUNTER_DEVICE_COUNT - 1);
  });

  it('updateChasePredator 는 장치 0개일 때만 포식자를 취약화(aux0=1)한다', () => {
    const s = placedState(2);
    const predator = predatorOf(s) as Entity;
    // 장치가 남아 있으면 무적 유지.
    updateChasePredator(s);
    expect(predator.aux0).toBe(0);
    // 전 장치 파괴 → 취약화.
    for (const e of s.entities) if (isCounterDevice(e)) e.dead = true;
    updateChasePredator(s);
    expect(predator.aux0).toBe(1);
  });

  it('chaseShelterReached 는 aux0===segmentIndex 대피소 overlap 만 참이다', () => {
    const player = blankEntity('player');
    player.id = 1;
    player.radius = 32;
    const sh = blankEntity('shelter');
    sh.id = 2;
    sh.radius = 140;
    sh.aux0 = 2;
    sh.x = 0;
    sh.y = 0;
    const s = { entities: [player, sh] as Entity[] } as unknown as WorldState;
    // 겹침(같은 좌표) + 인덱스 일치 → 참.
    expect(chaseShelterReached(s, 2)).toBe(true);
    // 인덱스 불일치 → 거짓(다른 세그먼트 대피소).
    expect(chaseShelterReached(s, 1)).toBe(false);
    // 멀리 떨어지면 → 거짓.
    player.x = 100000;
    expect(chaseShelterReached(s, 2)).toBe(false);
  });

  it('chaseVisionRadius 는 chase 면 상수, 그 외/undefined 면 0 이다', () => {
    expect(chaseVisionRadius(PLANET_MODE.chase)).toBe(CHASE_VISION_RADIUS);
    expect(chaseVisionRadius(PLANET_MODE.vampire)).toBe(0);
    expect(chaseVisionRadius(PLANET_MODE.contamination)).toBe(0);
    expect(chaseVisionRadius(undefined)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — 정규경로 full-path 통합(배선 실도달 증명, buildRunConfig planet 2)
// ---------------------------------------------------------------------------

describe('추격 — 정규경로 full-path 통합(니플헤임=chase)', () => {
  it('(a) 포식자가 createWorld 부터 존재·bossSpawned·aux0=0 · 비-스크롤 · 매 틱 플레이어에 접근(추격)', () => {
    const w = createWorld(11, chaseConfig());
    expect(w.config.planetMode).toBe(PLANET_MODE.chase);
    // 비-스크롤 자유추적(카메라·스크롤 코드 미개입).
    expect(w.scrollRuntime).toBeUndefined();
    expect(w.invasion3).toBeUndefined();
    const predator = predatorOf(w) as Entity;
    expect(predator).toBeDefined();
    expect(w.bossSpawned).toBe(true);
    expect(predator.aux0).toBe(0);
    // 추격 증명: 플레이어를 멀리 두면 포식자가 매 틱 거리를 좁힌다(moveBoss 추적).
    const player = w.entities[0] as Entity;
    player.x = 6000;
    player.y = 0;
    const dist = (): number => Math.hypot(predator.x - player.x, predator.y - player.y);
    const d0 = dist();
    for (let i = 0; i < 40; i++) stepChase(w);
    expect(dist()).toBeLessThan(d0); // 접근(추격)했다
    expect(w.scrollRuntime).toBeUndefined(); // 여전히 비-스크롤
  });

  it('(b) 무적(aux0=0) 포식자는 아군탄에 hp 가 안 깎인다', () => {
    const w = createWorld(7, chaseConfig());
    const predator = predatorOf(w) as Entity;
    const hp0 = predator.hp;
    expect(predator.aux0).toBe(0);
    blast(w, predator.x, predator.y, predator.radius + 50); // 거대 아군탄 직격
    for (let i = 0; i < 3; i++) stepChase(w);
    // 취약화 전이라 무피해(반격 장치가 아직 살아 있다).
    expect(chaseAliveCounterDevices(w)).toBe(CHASE_COUNTER_DEVICE_COUNT);
    expect(predator.aux0).toBe(0);
    expect(predator.hp).toBe(hp0);
  });

  it('(c) 반격 장치 전부 파괴 → 포식자 aux0=1(취약) → 아군탄이 hp 를 깎아 처치 → victory(실제 피해 경로)', () => {
    const w = createWorld(3, chaseConfig());
    w.weapon.damage = 0; // 오토어택 개입 배제(장치는 내 거대 탄으로만 파괴).
    const predator = predatorOf(w) as Entity;
    expect(predator.aux0).toBe(0);
    // 전 반격 장치에 거대 아군탄.
    for (const e of w.entities) if (isCounterDevice(e)) blast(w, e.x, e.y, e.radius + 50);
    for (let i = 0; i < 4; i++) stepChase(w);
    expect(chaseAliveCounterDevices(w)).toBe(0); // 전부 파괴
    expect(predator.aux0).toBe(1); // updateChasePredator 가 취약화
    // 취약해진 포식자를 실제 피해로 처치 → 공통 compact→victory.
    for (let i = 0; i < 60 && !w.victory; i++) {
      const b = predatorOf(w);
      if (b !== undefined) {
        b.hp = 10;
        blast(w, b.x, b.y, b.radius + 100);
      }
      stepChase(w);
    }
    expect(w.victory).toBe(true);
  });

  it('(d) 대피소 도달로 세그먼트가 전진한다(killGoal 아님 — kills=0 에서 전진)', () => {
    const w = createWorld(5, chaseConfig());
    w.weapon.damage = 0; // kills 를 0 으로 고정 → killGoal 게이트 배제(전진하면 대피소뿐).
    expect(w.wave.segmentIndex).toBe(0);
    const player = w.entities[0] as Entity;
    const shelter0 = shelters(w).find((e) => e.aux0 === 0) as Entity;
    expect(shelter0).toBeDefined();
    player.x = shelter0.x;
    player.y = shelter0.y;
    stepChase(w);
    expect(w.kills).toBe(0); // 처치 0 — killGoal 로는 절대 전진 못 함
    expect(w.wave.segmentIndex).toBe(1); // 대피소 도달로 전진
  });

  it('(e) 무적 포식자 접촉 시 gameOver 가 선다(iframes 무시)', () => {
    const w = createWorld(9, chaseConfig());
    const player = w.entities[0] as Entity;
    const predator = predatorOf(w) as Entity;
    expect(predator.aux0).toBe(0); // 무적 단계
    // 플레이어를 포식자 위에 올리고 무적 프레임을 잔뜩 준다 — 그래도 회피 불가 죽음.
    player.x = predator.x;
    player.y = predator.y;
    player.iframes = 100;
    stepChase(w);
    expect(w.gameOver).toBe(true);
    // hp 사망이 아니라 포식자 접촉 실패임을 못박는다(durableHP 라 hp 는 아직 크다).
    expect((w.entities[0] as Entity).hp).toBeGreaterThan(0);
  });

  it('(f) 필드 밖(8000,8000)으로 도망가도 반격 장치·대피소·포식자가 컬링되지 않는다(Lane8 교훈)', () => {
    const w = createWorld(21, chaseConfig());
    w.weapon.damage = 0;
    const player = w.entities[0] as Entity;
    expect(chaseAliveCounterDevices(w)).toBe(CHASE_COUNTER_DEVICE_COUNT);
    expect(shelters(w).length).toBe(CHASE_SHELTER_COUNT);
    // 컬 반경(CHUNK_CULL_RADIUS=3000) 훨씬 밖으로 이동 → activateChunks 가 매 틱 gimmick 을 컬링.
    player.x = 8000;
    player.y = 8000;
    for (let i = 0; i < 10; i++) stepChase(w);
    // 수정 전이면 장치가 컬링돼(도망만으로 취약화) 코어 루프가 붕괴했다.
    expect(chaseAliveCounterDevices(w)).toBe(CHASE_COUNTER_DEVICE_COUNT); // ★ 장치 미컬링
    expect(shelters(w).length).toBe(CHASE_SHELTER_COUNT); // ★ 대피소 미컬링
    expect(predatorOf(w)).toBeDefined(); // ★ 포식자 미컬링
    const predator = predatorOf(w) as Entity;
    expect(predator.aux0).toBe(0); // 무노력 취약화가 일어나지 않았다
  });

  it('(g) full-path config 는 실제로 chase 를 스탬프한다(planetContent 정본, 브릿지 없음)', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 2, stage: 1 });
    expect(cfg.planetMode).toBe(PLANET_MODE.chase);
  });
});

// ---------------------------------------------------------------------------
// §3 — 회귀(뱀서류·블록격파·레이싱·오염 무개입 + 해시 재현)
// ---------------------------------------------------------------------------

describe('추격 — 회귀(타 모드 무개입 + 해시 재현)', () => {
  const noChase = (w: WorldState): void => {
    expect(shelters(w).length).toBe(0);
    expect(chaseAliveCounterDevices(w)).toBe(0);
  };

  it('뱀서류(planet0) 런에는 추격 콘텐츠·포식자 초기 스폰이 없고 해시가 재현된다', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
    const run = (): number[] => {
      const w = createWorld(31337, { ...cfg, playerHp: DURABLE_HP });
      // createWorld 직후 보스가 없다(뱀서류는 보스 세그먼트에서만 스폰).
      expect(w.entities.some((e) => e.kind === 'boss')).toBe(false);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, { ...idle, moveX: 1 });
        out.push(hashWorld(w));
      }
      noChase(w);
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('블록격파 런은 여전히 −Y 스크롤·벽 파괴 동작이고 추격 콘텐츠가 없다(해시 재현)', () => {
    const cfg: WorldConfig = {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      planetMode: PLANET_MODE.blockBreak,
      playerHp: DURABLE_HP,
    };
    const run = (): number[] => {
      const w = createWorld(4242, cfg);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, idle);
        out.push(hashWorld(w));
      }
      expect(w.scrollRuntime).toBeDefined();
      expect(w.entities.some(isBreakableWall)).toBe(true);
      noChase(w);
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('레이싱 런은 여전히 +X 스크롤·부스트 패드가 있고 추격 콘텐츠가 없다(해시 재현)', () => {
    const cfg: WorldConfig = {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      planetMode: PLANET_MODE.racing,
      playerHp: DURABLE_HP,
    };
    const run = (): number[] => {
      const w = createWorld(909, cfg);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, idle);
        out.push(hashWorld(w));
      }
      expect(w.scrollRuntime).toBeDefined();
      expect(w.entities.some(isBoostPad)).toBe(true);
      noChase(w);
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('오염 런에는 추격 콘텐츠(대피소·반격 장치)가 없다', () => {
    const cfg: WorldConfig = {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      planetMode: PLANET_MODE.contamination,
      playerHp: DURABLE_HP,
    };
    const w = createWorld(77, cfg);
    for (let i = 0; i < 30; i++) stepWorld(w, idle);
    noChase(w);
  });
});
