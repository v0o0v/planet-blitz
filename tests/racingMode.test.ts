/**
 * 레이싱(racing) 콘텐츠 — Lane5 (ADR-0021 §2.3).
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다"(8+회). 그래서 순수
 * 함수 계약(§1)만 못박지 않고, **실제 앱이 부르는 함수**(`buildRunConfig`)로 config 를 만들고
 * `createWorld`/`stepWorld` 를 진짜로 굴려 콘텐츠 배선이 sim 까지 도달함을 증명한다(§2 가 핵심
 * 증거). ⭐ 아르케(planet 3)가 이미 racing 으로 배정돼 있어(`ARKE.mode = racing`) mode 치환
 * 브릿지가 **필요 없다** — `buildRunConfig(defaultProfile(), {planet:3, stage:1})` 가
 * `planetContent(3).mode = racing` 를 자동 스탬프하는 **완전 정규경로**를 그대로 쓴다(가장 강한
 * "green인데 배선 없음" 차단):
 *   (a) scrollRuntime 이 서고 창이 +X 로 전진 · planetMode===racing
 *   (b) 정적 분기 코스(부스트 패드 + 불파괴 채널 벽)가 존재하고 컬링에도 소멸하지 않는다
 *   (c) 세그먼트가 **스크롤 거리**로 전진(killGoal 아님) — 인덱스가 진행도 구간과 정확히 일치
 *   (d)(e) 코스 끝(+X)에서 보스 소환 + 처치 시 공통 승리(compact 재사용)
 *   (f) 창 뒤(−X) 경계에 몰리면 압박으로 player.hp 감소
 *   (g) 부스트 패드 위에서 racingCleared=true(가속)
 *
 * 회귀(§3): 뱀서류(planetMode 0)·블록격파(planetMode 1)는 racing 콘텐츠 미개입 + 해시 재현.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { createScrollRuntime } from '../src/sim/scrollMode.js';
import { blankEntity, spawnBullet } from '../src/sim/entities.js';
import type { Entity, EntitySink } from '../src/sim/entities.js';
import { INVASION_WINDOW_HALF_W } from '../src/sim/invasion/scroll.js';
import { SEGMENTS } from '../data/waves.js';
import { isBreakableWall } from '../src/sim/modes/blockBreak.js';
import {
  racingProgress,
  racingSection,
  racingCourseLength,
  isBoostPad,
  racingCleared,
  racingRearPressure,
  placeRacingCourse,
  RACING_SECTION_LENGTH,
  RACING_SECTION_COUNT,
  RACING_PRESSURE_DAMAGE,
  RACING_REAR_PRESSURE_MARGIN,
  RACING_WALL_MARK,
} from '../src/sim/modes/racing.js';

const idle: InputFrame = emptyInput();
/** 런이 압박·피격으로 조기 종료되지 않게 버티는 무대 HP(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** 정규경로(스펙 §8): 아르케(planet 3)는 racing 배정이라 치환 브릿지 없이 full-path 를 쓴다. */
function racingConfig(): WorldConfig {
  return buildRunConfig(defaultProfile(), { planet: 3, stage: 1 });
}

function durableRacing(): WorldConfig {
  return { ...racingConfig(), playerHp: DURABLE_HP };
}

function runTicks(state: WorldState, ticks: number, input: InputFrame = idle): void {
  for (let i = 0; i < ticks; i++) stepWorld(state, input);
}

/**
 * 한 틱 진행하되 레벨업 프리즈를 자동 해소한다(planetTierCompletion 선례). idle 파일럿은
 * 오토어택으로 적을 잡아 결국 레벨업하는데, 픽을 안 주면 월드가 얼어(pendingLevelUp) 스크롤이
 * 정체한다. 픽(0)을 넣어 즉시 해소하면 idle 을 유지하며 코스를 끝까지 밀 수 있다.
 */
function stepRacing(state: WorldState, base: InputFrame = idle): void {
  const input = state.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : base;
  stepWorld(state, input);
}

function emptySink(): EntitySink {
  return { entities: [], nextEntityId: 1 };
}

/** 레이싱 채널 벽(불파괴, 마커 부착)만 센다 — 청크 커버 벽(ownerId=0)과 구분. */
function racingWalls(state: WorldState): Entity[] {
  return state.entities.filter((e) => e.kind === 'wall' && e.ownerId === RACING_WALL_MARK);
}

// ---------------------------------------------------------------------------
// §1 — 순수 함수 계약
// ---------------------------------------------------------------------------

describe('레이싱 — 순수 함수', () => {
  it('진행도·구간·코스길이가 scrollX 파생으로 정확하다', () => {
    expect(racingProgress({ scrollX: 500, scrollY: 0 })).toBe(500);
    expect(racingProgress({ scrollX: 0, scrollY: -999 })).toBe(0); // +X 만 진행도(scrollY 무관)
    expect(racingSection(0)).toBe(0);
    expect(racingSection(RACING_SECTION_LENGTH - 1)).toBe(0);
    expect(racingSection(RACING_SECTION_LENGTH)).toBe(1);
    expect(racingSection(RACING_SECTION_LENGTH * 2 + 1)).toBe(2);
    expect(racingCourseLength()).toBe(RACING_SECTION_LENGTH * RACING_SECTION_COUNT);
  });

  it('isBoostPad 는 boostPad kind 만 참이다', () => {
    expect(isBoostPad(blankEntity('boostPad'))).toBe(true);
    expect(isBoostPad(blankEntity('wall'))).toBe(false);
    expect(isBoostPad(blankEntity('enemy'))).toBe(false);
  });

  it('placeRacingCourse 는 RNG 없이 결정론 배치다(같은 입력=바이트 동일)', () => {
    const a = emptySink();
    const b = emptySink();
    placeRacingCourse(a);
    placeRacingCourse(b);
    expect(a.entities.length).toBe(b.entities.length);
    expect(a.entities.length).toBeGreaterThan(0);
    for (let i = 0; i < a.entities.length; i++) {
      const x = a.entities[i] as Entity;
      const y = b.entities[i] as Entity;
      expect([x.kind, x.x, x.y, x.radius, x.targetX, x.hp, x.ownerId]).toEqual([
        y.kind,
        y.x,
        y.y,
        y.radius,
        y.targetX,
        y.hp,
        y.ownerId,
      ]);
    }
    // 부스트 패드(지름길 채널)와 불파괴 채널 벽(hp=0, 마커 부착)이 둘 다 존재한다.
    const pads = a.entities.filter(isBoostPad);
    const walls = a.entities.filter((e) => e.kind === 'wall' && e.ownerId === RACING_WALL_MARK);
    expect(pads.length).toBeGreaterThan(0);
    expect(walls.length).toBe(RACING_SECTION_COUNT);
    // 채널 벽은 hp=0 이라 파괴 대상이 아니다(가이드 벽).
    for (const w of walls) expect(isBreakableWall(w)).toBe(false);
  });

  it('racingRearPressure 는 뒤 경계 안쪽에서만 iframe 게이트로 누적 피해를 준다', () => {
    const rt = createScrollRuntime(); // (0,0) — 창 중심, 뒤 경계 = -INVASION_WINDOW_HALF_W
    const state = {
      scrollRuntime: rt,
      config: { hitIframes: 40 },
    } as unknown as WorldState;
    const p = blankEntity('player');
    p.hp = 100;
    p.iframes = 0;
    // 창 앞쪽(경계에서 충분히 멈) → 압박 없음.
    p.x = 0;
    racingRearPressure(state, p);
    expect(p.hp).toBe(100);
    // 뒤 경계(−X) 안쪽으로 몰림 → 압박.
    p.x = -INVASION_WINDOW_HALF_W + 10;
    racingRearPressure(state, p);
    expect(p.hp).toBe(100 - RACING_PRESSURE_DAMAGE);
    expect(p.iframes).toBe(40);
    racingRearPressure(state, p); // iframes>0 → skip(매 틱 갈림 방지)
    expect(p.hp).toBe(100 - RACING_PRESSURE_DAMAGE);
    // 음수 클램프.
    p.iframes = 0;
    p.hp = RACING_PRESSURE_DAMAGE - 3;
    racingRearPressure(state, p);
    expect(p.hp).toBe(0);
    // scrollRuntime 미존재 → no-op.
    const noRt = { config: { hitIframes: 40 } } as unknown as WorldState;
    const q = blankEntity('player');
    q.hp = 50;
    q.iframes = 0;
    q.x = -100_000;
    racingRearPressure(noRt, q);
    expect(q.hp).toBe(50);
  });

  it('racingCleared 는 부스트 패드 위 OR 창 안 전멸이면 참이다', () => {
    const rt = createScrollRuntime(); // (0,0) — 창 중심
    const player = blankEntity('player');
    player.radius = 32;
    player.x = 5_000; // 창 밖(부스트 판정은 창과 무관)
    player.y = 0;
    const enemy = blankEntity('enemy');
    enemy.x = 0; // 창 안 살아있는 적
    enemy.y = 0;
    const pad = blankEntity('boostPad');
    pad.x = 5_000;
    pad.y = 0;
    pad.radius = 90;
    const state = { scrollRuntime: rt, entities: [player, enemy] } as unknown as WorldState;
    // 창 안 적 있고 패드 없음 → 미가속.
    expect(racingCleared(state)).toBe(false);
    // 패드 추가(플레이어와 겹침) → 전멸 아님에도 가속(부스트 경로).
    state.entities.push(pad);
    expect(racingCleared(state)).toBe(true);
    // 패드 제거 + 창 안 적 죽임 → 전멸 경로로 가속.
    state.entities.pop();
    enemy.dead = true;
    expect(racingCleared(state)).toBe(true);
    // scrollRuntime 미존재 → 항상 false.
    expect(racingCleared({ entities: [] } as unknown as WorldState)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2 — 정규경로 통합(배선 실도달 증명, full-path planet 3)
// ---------------------------------------------------------------------------

describe('레이싱 — 정규경로 통합(배선 실도달)', () => {
  it('(a) 레이싱 런은 scrollRuntime 을 세우고 창이 +X 로 전진한다 · planetMode===racing', () => {
    const w = createWorld(11, durableRacing());
    expect(w.scrollRuntime).toBeDefined();
    expect(w.invasion3).toBeUndefined();
    expect(w.config.planetMode).toBe(PLANET_MODE.racing);
    runTicks(w, 120);
    expect(w.scrollRuntime!.scrollX).toBeGreaterThan(0);
    expect(w.scrollRuntime!.scrollY).toBe(0);
  });

  it('(b) createWorld 가 분기 코스(부스트 패드 + 불파괴 채널 벽)를 배치한다(뱀서류엔 없음)', () => {
    const rc = createWorld(1, durableRacing());
    expect(rc.entities.filter(isBoostPad).length).toBeGreaterThan(0);
    expect(racingWalls(rc).length).toBe(RACING_SECTION_COUNT);
    const vamp = createWorld(1, {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      playerHp: DURABLE_HP,
    });
    expect(vamp.entities.some(isBoostPad)).toBe(false);
    expect(racingWalls(vamp).length).toBe(0);
  });

  it('(b) 채널 벽은 청크 컬링에도 소멸하지 않는다(마커 배선 실도달)', () => {
    const w = createWorld(5, durableRacing());
    const before = racingWalls(w).length;
    expect(before).toBe(RACING_SECTION_COUNT);
    // 창이 +X 로 밀려 플레이어가 초기 코스에서 멀어져도(청크 컬 반경 3000 초과) 코스 벽이
    // 살아 있어야 한다 — hp=0 이라 isGimmick 오인 대상이지만 RACING_WALL_MARK 로 제외된다.
    for (let i = 0; i < 600; i++) stepRacing(w);
    // 플레이어가 초기 코스 벽들(x=1000·3000·5000)보다 컬 반경 이상 앞서 나갔는지 확인(컬링이
    // 실제로 그 벽들을 훑고 지나갔다는 뜻 — 마커가 없었다면 지워졌을 것).
    expect(w.scrollRuntime!.scrollX).toBeGreaterThan(5000 + 3000);
    expect(racingWalls(w).length).toBe(before);
  });

  it('(c) 세그먼트가 스크롤 거리로 전진한다(killGoal 아님) — 인덱스가 진행도 구간과 정확히 일치', () => {
    const w = createWorld(9, durableRacing());
    const seen = new Set<number>();
    // 중반 격전(ADR-0032) 세그먼트부터는 전진 게이트가 스크롤 거리가 아니라 **리더 처치**라
    // 거리↔인덱스 등식이 성립하지 않는다(격전 게이트 자체는 tests/midClash.test.ts 소관).
    // 그래서 이 등식은 격전 진입 전 구간에서만 단언한다 — 거리 게이트 배선 증거로는 충분하다.
    const clashIndex = SEGMENTS.findIndex((s) => s.clash === true);
    for (let i = 0; i < 2000; i++) {
      stepRacing(w);
      if (w.wave.segmentIndex >= clashIndex || w.wave.boss) break;
      const progress = w.scrollRuntime!.scrollX;
      // 거리 게이트라면 인덱스는 진행도 구간에 딱 묶인다. killGoal 게이트라면 처치 수에
      // 좌우돼 이 등식이 성립할 수 없다(=배선 증거).
      const expected = Math.min(SEGMENTS.length - 1, racingSection(progress));
      expect(w.wave.segmentIndex).toBe(expected);
      seen.add(w.wave.segmentIndex);
    }
    expect(seen.size).toBeGreaterThan(1); // 여러 구간을 실제로 전진(정체 아님)
  });

  it('(d)(e) 코스 끝(+X)에서 보스가 소환되고 처치 시 공통 승리(compact 재사용)로 victory 가 선다', () => {
    const w = createWorld(9, durableRacing());
    let boss: Entity | undefined;
    for (let i = 0; i < 2000; i++) {
      stepRacing(w);
      boss = w.entities.find((e) => e.kind === 'boss');
      if (boss !== undefined) break;
    }
    expect(boss).toBeDefined();
    expect(w.bossSpawned).toBe(true);
    // 코스 끝(= 마지막 구간 통과) 이후에만 보스가 뜬다.
    expect(w.scrollRuntime!.scrollX).toBeGreaterThanOrEqual(racingCourseLength());
    // 보스 처치 → 공통 승리(compact) 재사용을 **실제 피해 경로로** 못박는다(수동 dead 세팅 금지).
    // 매 틱 보스 현재 위치에 거대 아군탄을 쏴, resolveCollisions 가 hp≤0 으로 깎아 dead 로 만들고
    // → compact 의 boss(invasion3 미존재) 분기가 victory 를 세우는 end-to-end 사슬을 통과시킨다.
    (boss as Entity).hp = 10;
    for (let i = 0; i < 40 && !w.victory; i++) {
      const b = w.entities.find((e) => e.kind === 'boss');
      if (b !== undefined) spawnBullet(w, b.x, b.y, 0, 0, 1_000_000, 0, b.radius + 100, 120, 1, 0);
      stepRacing(w);
    }
    expect(w.victory).toBe(true);
  });

  it('(f) 창 뒤(−X) 경계에 몰리면 압박으로 player.hp 가 줄어든다', () => {
    const w = createWorld(3, durableRacing());
    const player = w.entities[0] as Entity;
    // 접촉 피해를 배제해 압박만 남긴다(적·보스 제거 — compact 가 수거).
    for (const e of w.entities) if (e.kind === 'enemy' || e.kind === 'boss') e.dead = true;
    // 플레이어를 창 뒤(−X) 경계 안쪽으로 옮기고 무적을 푼다.
    const rt = w.scrollRuntime!;
    player.x = rt.scrollX - INVASION_WINDOW_HALF_W + 10;
    player.y = rt.scrollY;
    player.iframes = 0;
    const hp0 = player.hp;
    stepWorld(w, idle);
    expect(player.hp).toBeLessThan(hp0);
    // 압박 존 안이 확인된다(스크롤 클램프가 플레이어를 뒤 경계에 붙여 둔다).
    expect(player.x - (rt.scrollX - INVASION_WINDOW_HALF_W)).toBeLessThanOrEqual(
      RACING_REAR_PRESSURE_MARGIN + 1e-9,
    );
  });

  it('(g) 부스트 패드 위에서 racingCleared=true(가속) — 창 안 적이 있어도', () => {
    const w = createWorld(5, durableRacing());
    const player = w.entities[0] as Entity;
    const pad = w.entities.find(isBoostPad) as Entity;
    expect(pad).toBeDefined();
    const rt = w.scrollRuntime!;
    // 창 안에 살아있는 적을 둬서 전멸 경로를 막는다(부스트 경로만으로 true 임을 못박는다).
    const foe = blankEntity('enemy');
    foe.id = w.nextEntityId++;
    foe.x = rt.scrollX;
    foe.y = rt.scrollY;
    foe.hp = 100;
    foe.maxHp = 100;
    w.entities.push(foe);
    // 패드 안 밟음 + 창 안 적 → 미가속.
    expect(racingCleared(w)).toBe(false);
    // 패드 위로 이동 → 전멸 아님에도 가속.
    player.x = pad.x;
    player.y = pad.y;
    expect(racingCleared(w)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — 회귀(뱀서류·블록격파 무개입)
// ---------------------------------------------------------------------------

describe('레이싱 — 회귀(뱀서류·블록격파 무개입)', () => {
  it('뱀서류 런에는 racing 콘텐츠·scrollRuntime 이 없고 해시가 재현된다', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
    const run = (): number[] => {
      const w = createWorld(31337, { ...cfg, playerHp: DURABLE_HP });
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, { ...idle, moveX: 1 });
        out.push(hashWorld(w));
      }
      expect(w.entities.some(isBoostPad)).toBe(false);
      expect(racingWalls(w).length).toBe(0);
      expect(w.scrollRuntime).toBeUndefined();
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('블록격파 런은 여전히 −Y 스크롤·벽 파괴 동작이고 racing 콘텐츠가 없다(해시 재현)', () => {
    const blockBreakCfg: WorldConfig = {
      ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }),
      planetMode: PLANET_MODE.blockBreak,
      playerHp: DURABLE_HP,
    };
    const run = (): number[] => {
      const w = createWorld(4242, blockBreakCfg);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, idle);
        out.push(hashWorld(w));
      }
      // 블록격파는 −Y 로 스크롤하고 파괴가능 벽이 있다.
      expect(w.scrollRuntime).toBeDefined();
      expect(w.scrollRuntime!.scrollY).toBeLessThan(0);
      expect(w.scrollRuntime!.scrollX).toBe(0);
      expect(w.entities.some(isBreakableWall)).toBe(true);
      // racing 콘텐츠(부스트 패드·레이싱 마커 벽)는 하나도 없다.
      expect(w.entities.some(isBoostPad)).toBe(false);
      expect(racingWalls(w).length).toBe(0);
      return out;
    };
    expect(run()).toEqual(run());
  });
});
