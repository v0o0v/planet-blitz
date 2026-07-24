/**
 * 블록격파(blockBreak) 콘텐츠 — Lane4 (ADR-0021 §2.2).
 *
 * 이 저장소의 반복 결함은 "단위 테스트는 그린인데 배선이 통째로 없다"(8+회). 그래서 순수
 * 함수 계약(§1)만 못박지 않고, **실제 앱이 부르는 함수**(`buildRunConfig`)로 config 를 만들고
 * mode 만 blockBreak 로 치환한 뒤 `createWorld`/`stepWorld` 를 진짜로 굴려 콘텐츠 배선이
 * sim 까지 도달함을 증명한다(§2 가 핵심 증거):
 *   (a) scrollRuntime 이 서고 창이 −Y 로 전진
 *   (b) 파괴가능 벽이 존재하고 아군탄이 stepProjectiles 벽 스윕에서 hp 를 깎고 파괴
 *   (c) 세그먼트가 **스크롤 거리**로 전진(killGoal 아님) — 인덱스가 진행도 구간과 정확히 일치
 *   (d)(e) 코스 끝에서 보스 소환 + 처치 시 공통 승리(compact 재사용)
 *   (f) 파괴가능 벽에 끼이면 압사로 player.hp 감소
 *
 * 회귀(§3): 뱀서류(planetMode 0)는 파괴가능 벽·scrollRuntime 미개입 + 해시 재현.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick } from '../src/sim/world.js';
import type { InputFrame, WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';
import { createScrollRuntime } from '../src/sim/scrollMode.js';
import { blankEntity, spawnBreakableWall, spawnBullet } from '../src/sim/entities.js';
import type { Entity, EntitySink } from '../src/sim/entities.js';
import { INVASION_WINDOW_HALF_W } from '../src/sim/invasion/scroll.js';
import { SEGMENTS } from '../data/waves.js';
import { MID_CLASH_LEADER_MARK } from '../src/sim/modes/midClash.js';
import {
  blockBreakProgress,
  blockBreakSection,
  blockBreakCourseLength,
  isBreakableWall,
  isPinnedByWall,
  blockBreakCleared,
  crushBlockBreak,
  cullScrollEnemies,
  placeBlockBreakWalls,
  BLOCKBREAK_SECTION_LENGTH,
  BLOCKBREAK_SECTION_COUNT,
  BLOCKBREAK_CRUSH_DAMAGE,
  BLOCKBREAK_ENEMY_CULL_RADIUS,
} from '../src/sim/modes/blockBreak.js';

const idle: InputFrame = emptyInput();
/** 런이 압사·피격으로 조기 종료되지 않게 버티는 무대 HP(프로필 파생값이 아니다). */
const DURABLE_HP = 100_000_000;

/** 정규경로 브릿지(스펙 §3): 실제 조립(loadout·skillInvest·shipType)을 재사용하고 mode 만 치환. */
function blockBreakConfig(): WorldConfig {
  return { ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }), planetMode: PLANET_MODE.blockBreak };
}

function durableBlockBreak(): WorldConfig {
  return { ...blockBreakConfig(), playerHp: DURABLE_HP };
}

function runTicks(state: WorldState, ticks: number, input: InputFrame = idle): void {
  for (let i = 0; i < ticks; i++) stepWorld(state, input);
}

/**
 * 한 틱 진행하되 **레벨업 프리즈를 자동 해소**한다(`racingMode.test.ts` 의 `stepRacing` 과
 * 동일한 정본 패턴). idle 파일럿도 오토어택으로 적을 잡아 결국 레벨업하는데, 픽을 주지 않으면
 * `stepWorld` 가 최상단 가드에서 `tick++` 만 하고 즉시 return 해 **월드가 통째로 언다** —
 * 창 전진(accelCp 포함)까지 멈추므로 코스가 영영 끝나지 않는다. 픽(0)을 넣어 즉시 해소한다.
 */
function stepBlockBreak(state: WorldState, base: InputFrame = idle): void {
  const input = state.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : base;
  stepWorld(state, input);
}

function emptySink(): EntitySink {
  return { entities: [], nextEntityId: 1 };
}

// ---------------------------------------------------------------------------
// §1 — 순수 함수 계약
// ---------------------------------------------------------------------------

describe('블록격파 — 순수 함수', () => {
  it('진행도·구간·코스길이가 scrollY 파생으로 정확하다', () => {
    expect(blockBreakProgress({ scrollX: 0, scrollY: -500 })).toBe(500);
    // scrollY=0 은 -0 을 낼 수 있으나(−scrollY) 진행도는 >= 비교에만 쓰여 해가 없다(해시 미접힘).
    expect(blockBreakProgress({ scrollX: 5, scrollY: 0 }) === 0).toBe(true);
    expect(blockBreakSection(0)).toBe(0);
    expect(blockBreakSection(BLOCKBREAK_SECTION_LENGTH - 1)).toBe(0);
    expect(blockBreakSection(BLOCKBREAK_SECTION_LENGTH)).toBe(1);
    expect(blockBreakSection(BLOCKBREAK_SECTION_LENGTH * 2 + 1)).toBe(2);
    expect(blockBreakCourseLength()).toBe(BLOCKBREAK_SECTION_LENGTH * BLOCKBREAK_SECTION_COUNT);
  });

  it('isBreakableWall 은 wall+hp>0 만 참이다(불파괴 벽·적은 거짓)', () => {
    const breakable = blankEntity('wall');
    breakable.hp = 40;
    expect(isBreakableWall(breakable)).toBe(true);
    const solid = blankEntity('wall'); // hp=0
    expect(isBreakableWall(solid)).toBe(false);
    expect(isBreakableWall(blankEntity('enemy'))).toBe(false);
  });

  it('placeBlockBreakWalls 는 RNG 없이 결정론 배치다(같은 입력=바이트 동일)', () => {
    const a = emptySink();
    const b = emptySink();
    placeBlockBreakWalls(a);
    placeBlockBreakWalls(b);
    expect(a.entities.length).toBe(b.entities.length);
    expect(a.entities.length).toBeGreaterThan(0);
    for (let i = 0; i < a.entities.length; i++) {
      const x = a.entities[i] as Entity;
      const y = b.entities[i] as Entity;
      expect([x.x, x.y, x.radius, x.targetX, x.hp, x.maxHp]).toEqual([
        y.x,
        y.y,
        y.radius,
        y.targetX,
        y.hp,
        y.maxHp,
      ]);
      // 전부 파괴가능 벽(hp>0)이고 창 폭(±창) 안에 놓인다.
      expect(isBreakableWall(x)).toBe(true);
      expect(Math.abs(x.x) + x.radius).toBeLessThanOrEqual(INVASION_WINDOW_HALF_W + 1e-9);
    }
  });

  it('blockBreakCleared 는 창 안 살아있는 적·보스 유무로 판정한다', () => {
    const rt = createScrollRuntime(); // (0,0,BASE) — 창 중심 (0,0)
    const enemy = blankEntity('enemy');
    const state = { scrollRuntime: rt, entities: [enemy] } as unknown as WorldState;
    enemy.x = 0;
    enemy.y = 0;
    expect(blockBreakCleared(state)).toBe(false); // 창 안 적 → 미전멸
    enemy.x = 100_000; // 창 밖
    expect(blockBreakCleared(state)).toBe(true);
    enemy.x = 0;
    enemy.dead = true; // 죽은 적은 무시
    expect(blockBreakCleared(state)).toBe(true);
    // scrollRuntime 미존재 → 항상 false(가속 신호 없음).
    expect(blockBreakCleared({ entities: [] } as unknown as WorldState)).toBe(false);
  });

  it('crushBlockBreak 은 iframes 를 존중하고 음수 클램프한다(movingWall.crushPlayer 이식)', () => {
    const state = { config: { hitIframes: 40 } } as unknown as WorldState;
    const p = blankEntity('player');
    p.hp = 100;
    p.iframes = 0;
    crushBlockBreak(state, p);
    expect(p.hp).toBe(100 - BLOCKBREAK_CRUSH_DAMAGE);
    expect(p.iframes).toBe(40);
    crushBlockBreak(state, p); // iframes>0 → skip(매 틱 갈림 방지)
    expect(p.hp).toBe(100 - BLOCKBREAK_CRUSH_DAMAGE);
    p.iframes = 0;
    p.hp = BLOCKBREAK_CRUSH_DAMAGE - 3;
    crushBlockBreak(state, p);
    expect(p.hp).toBe(0); // 음수 → 0 클램프
  });

  it('isPinnedByWall 은 파괴가능 벽과의 겹침만 끼임으로 본다(불파괴 벽 제외)', () => {
    const p = blankEntity('player');
    p.x = 0;
    p.y = 0;
    p.radius = 32;
    const breakable = blankEntity('wall');
    breakable.radius = 100;
    breakable.targetX = 100;
    breakable.hp = 50;
    expect(isPinnedByWall(p, [breakable])).toBe(true);
    const solid = blankEntity('wall'); // hp=0 → 압사 대상 아님
    solid.radius = 100;
    solid.targetX = 100;
    expect(isPinnedByWall(p, [solid])).toBe(false);
    p.x = 10_000; // 안 겹침
    expect(isPinnedByWall(p, [breakable])).toBe(false);
  });

  it('cullScrollEnemies 는 창 밖 적만 dead 표시하고 보스는 남긴다', () => {
    const rt = createScrollRuntime();
    const near = blankEntity('enemy');
    const far = blankEntity('enemy');
    far.x = BLOCKBREAK_ENEMY_CULL_RADIUS + 500;
    const boss = blankEntity('boss');
    boss.x = BLOCKBREAK_ENEMY_CULL_RADIUS + 500;
    const state = { scrollRuntime: rt, entities: [near, far, boss] } as unknown as WorldState;
    cullScrollEnemies(state);
    expect(near.dead).toBe(false);
    expect(far.dead).toBe(true);
    expect(boss.dead).toBe(false); // 보스는 컬 제외
  });
});

// ---------------------------------------------------------------------------
// §2 — 정규경로 통합(배선 실도달 증명)
// ---------------------------------------------------------------------------

describe('블록격파 — 정규경로 통합(배선 실도달)', () => {
  it('(a) 블록격파 런은 scrollRuntime 을 세우고 창이 −Y 로 전진한다', () => {
    const w = createWorld(11, durableBlockBreak());
    expect(w.scrollRuntime).toBeDefined();
    expect(w.invasion3).toBeUndefined();
    runTicks(w, 120);
    expect(w.scrollRuntime!.scrollY).toBeLessThan(0);
    expect(w.scrollRuntime!.scrollX).toBe(0);
  });

  it('(a) createWorld 가 파괴가능 벽 코스를 배치한다(뱀서류엔 없음)', () => {
    const bb = createWorld(1, durableBlockBreak());
    expect(bb.entities.filter(isBreakableWall).length).toBeGreaterThan(0);
    const vamp = createWorld(1, { ...buildRunConfig(defaultProfile(), { planet: 0, stage: 1 }), playerHp: DURABLE_HP });
    expect(vamp.entities.some(isBreakableWall)).toBe(false);
  });

  it('(b) 아군탄이 stepProjectiles 벽 스윕에서 파괴가능 벽 hp 를 깎고 파괴한다', () => {
    const w = createWorld(5, durableBlockBreak());
    const walls = w.entities.filter(isBreakableWall);
    expect(walls.length).toBeGreaterThan(1);
    // ① 치명타 미만: hp 가 줄지만 파괴되지 않는다.
    const chip = walls[0] as Entity;
    const hp0 = chip.hp;
    spawnBullet(w, chip.x, chip.y, 0, 0, 25, 0, 8, 120, 1, 0); // 정지 아군탄(speed 0)
    stepWorld(w, idle);
    expect(chip.hp).toBeLessThan(hp0);
    expect(chip.dead).toBe(false);
    // ② 치명타: hp≤0 → 파괴되어 compact 가 제거한다.
    const kill = walls[1] as Entity;
    spawnBullet(w, kill.x, kill.y, 0, 0, kill.hp + 10, 0, 8, 120, 1, 0);
    stepWorld(w, idle);
    expect(kill.dead).toBe(true);
    expect(w.entities.includes(kill)).toBe(false);
  });

  it('(c) 세그먼트가 스크롤 거리로 전진한다(killGoal 아님) — 인덱스가 진행도 구간과 정확히 일치', () => {
    const w = createWorld(9, durableBlockBreak());
    const seen = new Set<number>();
    // 중반 격전(ADR-0032) 세그먼트부터는 전진 게이트가 스크롤 거리가 아니라 **리더 처치**라
    // 거리↔인덱스 등식이 성립하지 않는다(격전 게이트 자체는 tests/midClash.test.ts 소관).
    // 그래서 이 등식은 격전 진입 전 구간에서만 단언한다 — 거리 게이트 배선 증거로는 충분하다.
    const clashIndex = SEGMENTS.findIndex((s) => s.clash === true);
    for (let i = 0; i < 1600; i++) {
      stepWorld(w, idle);
      if (w.wave.segmentIndex >= clashIndex || w.wave.boss) break;
      const progress = -w.scrollRuntime!.scrollY;
      // 거리 게이트라면 인덱스는 진행도 구간에 딱 묶인다. killGoal 게이트라면 처치 수에
      // 좌우돼 이 등식이 성립할 수 없다(=배선 증거).
      const expected = Math.min(SEGMENTS.length - 1, blockBreakSection(progress));
      expect(w.wave.segmentIndex).toBe(expected);
      seen.add(w.wave.segmentIndex);
    }
    expect(seen.size).toBeGreaterThan(1); // 여러 구간을 실제로 전진(정체 아님)
  });

  /**
   * 중반 격전(ADR-0032) 세그먼트는 **리더 처치**로만 전진한다. 유휴 입력 런은 강화 정예
   * (HP×8)를 깎을 화력이 없으므로, 코스 배선을 보려는 테스트에서는 리더가 뜨는 즉시
   * `compact` 의 처치 규율(`hp<=0` → `dead` → kills++)대로 처치를 대역한다.
   *
   * ⚠️ 예전에는 이 대역이 없어도 통과했다 — 강제 스크롤 컬링이 리더를 **hp>0 인 채로** 지워
   * 격전 세그먼트가 **공짜 통과**했기 때문이다(리뷰 HIGH-2). 그 결함을 막은 뒤로는 어떤 런도
   * 리더를 실제로 잡아야 하므로 대역이 필요하다.
   */
  function killClashLeader(w: WorldState): void {
    const leader = w.entities.find(
      (e) => e.kind === 'enemy' && !e.dead && e.aux1 === MID_CLASH_LEADER_MARK,
    );
    if (leader === undefined) return;
    leader.hp = 0;
    leader.dead = true;
  }

  it('(d)(e) 코스 끝에서 보스가 소환되고 처치 시 공통 승리(compact 재사용)로 victory 가 선다', () => {
    const w = createWorld(9, durableBlockBreak());
    let boss: Entity | undefined;
    for (let i = 0; i < 1600; i++) {
      stepBlockBreak(w);
      killClashLeader(w); // 위 헬퍼 주석 참조(격전 세그먼트는 리더 처치로만 전진한다).
      boss = w.entities.find((e) => e.kind === 'boss');
      if (boss !== undefined) break;
    }
    expect(boss).toBeDefined();
    expect(w.bossSpawned).toBe(true);
    // 코스 끝(= 마지막 구간 통과) 이후에만 보스가 뜬다.
    expect(-w.scrollRuntime!.scrollY).toBeGreaterThanOrEqual(blockBreakCourseLength());
    // 보스 처치 → 공통 승리(compact) 재사용을 **실제 피해 경로로** 못박는다(수동 dead 세팅 금지 —
    // 리뷰 MEDIUM-2). 보스 hp 를 낮춘 뒤 매 틱 보스 현재 위치에 거대 아군탄을 쏴, resolveCollisions
    // 가 hp≤0 으로 깎아 dead 로 만들고 → compact 의 boss(invasion3 미존재) 분기가 victory 를
    // 세우는 end-to-end 사슬을 통과시킨다(보스는 코스 최상단, 마지막 벽 행 위라 벽 가림 없음).
    (boss as Entity).hp = 10;
    for (let i = 0; i < 30 && !w.victory; i++) {
      const b = w.entities.find((e) => e.kind === 'boss');
      if (b !== undefined) spawnBullet(w, b.x, b.y, 0, 0, 1_000_000, 0, b.radius + 100, 120, 1, 0);
      stepBlockBreak(w);
    }
    expect(w.victory).toBe(true);
  });

  it('(f) 파괴가능 벽에 끼이면 압사로 player.hp 가 줄어든다', () => {
    const w = createWorld(3, durableBlockBreak());
    const player = w.entities[0] as Entity;
    // 창 전체를 덮는 키 큰 파괴가능 벽을 창 중심에 주입 → 슬라이드·클램프 이후에도 겹쳐 끼임.
    const rt = w.scrollRuntime!;
    spawnBreakableWall(w, rt.scrollX, rt.scrollY, INVASION_WINDOW_HALF_W, 2000, 10_000_000);
    const hp0 = player.hp;
    runTicks(w, 120);
    expect(player.hp).toBeLessThan(hp0);
  });

  it('(g) 컬링된 적(hp>0)은 처치·젬·루팅을 주지 않는다 — 경제/집계 오염 회귀 가드(리뷰 HIGH)', () => {
    // 도망쳐 창 뒤로 빠진 적(무손상)을 cullScrollEnemies 가 dead 로 표시하는데, compact 의 적
    // 처치 분기가 `hp<=0` 게이트로 이를 배제해야 한다(supply/destructible 와 동일 규율). 게이트가
    // 없으면 한 대도 안 맞은 적이 kills++·젬·엘리트 루팅을 준다(해츨링 시그니처·정산 오염).
    const w = createWorld(7, durableBlockBreak());
    const rt = w.scrollRuntime!;
    // 창 뒤(+Y, 컬 반경 밖)에 무손상 적 주입. enemyType 0 = 유효 로스터 역할(updateEnemy 안전).
    const foe = blankEntity('enemy');
    foe.id = w.nextEntityId++;
    foe.enemyType = 0;
    foe.x = rt.scrollX;
    foe.y = rt.scrollY + BLOCKBREAK_ENEMY_CULL_RADIUS + 800;
    foe.hp = 9999;
    foe.maxHp = 9999;
    w.entities.push(foe);
    const kills0 = w.kills;
    const gems0 = w.entities.filter((e) => e.kind === 'gem').length;
    stepWorld(w, idle);
    expect(foe.dead).toBe(true); // 컬링은 됐고(제거),
    expect(w.entities.includes(foe)).toBe(false); // compact 가 수거했지만
    expect(w.kills).toBe(kills0); // ★ 처치로 집계되지 않는다(핵심 — HIGH 수정).
    expect(w.entities.filter((e) => e.kind === 'gem').length).toBe(gems0); // 젬도 안 생긴다.
  });
});

// ---------------------------------------------------------------------------
// §3 — 회귀(뱀서류 바이트 불변)
// ---------------------------------------------------------------------------

describe('블록격파 — 회귀(뱀서류 무개입)', () => {
  it('뱀서류 런에는 파괴가능 벽·scrollRuntime 이 없고 해시가 재현된다', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
    const run = (): number[] => {
      const w = createWorld(31337, { ...cfg, playerHp: DURABLE_HP });
      const out: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepWorld(w, { ...idle, moveX: 1 });
        out.push(hashWorld(w));
      }
      expect(w.entities.some(isBreakableWall)).toBe(false);
      expect(w.scrollRuntime).toBeUndefined();
      return out;
    };
    expect(run()).toEqual(run());
  });
});
