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
import { autopilotInput } from '../src/sim/autopilot.js';
import { snapshotWorld } from '../src/sim/snapshot.js';
import { classifyRadar } from '../src/render/radar.js';
import { shelterArrow, SHELTER_ARROW_MARGIN } from '../src/render/entityRenderer.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../src/render/app.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { SEGMENTS } from '../data/waves.js';
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
  CHASE_PREDATOR_SPEED,
  CHASE_PREDATOR_STANDOFF,
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

  it('CHASE_SHELTER_COUNT 는 일반 세그먼트 수(SEGMENTS.length-1)와 일치한다(desync 가드, 리뷰 LOW)', () => {
    // 대피소 aux0(0..N-1)가 각 일반 세그먼트에 1:1 대응한다. SEGMENTS 가 바뀌면 초과 세그먼트에
    // 매칭 대피소가 없어 도주 진행이 정체될 수 있으므로(하드락은 아님 — 포식자 처치 승리는 유지),
    // 이 등식을 못박아 조용한 desync 를 잡는다.
    expect(CHASE_SHELTER_COUNT).toBe(SEGMENTS.length - 1);
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

  it('(c-2) 반격 장치는 **자동 조준 대상**이다 — 승리 조건이 조준 밖이면 이 무대는 깰 수 없다', () => {
    // ⚠️ 이 저장소가 세 번째로 겪은 "맞기는 하지만 조준되지는 않는" 결함의 회귀 가드다
    //    (선례: 침공 실드 발생기 · 보호막 국면 코어). 이 게임의 사격은 **전부 자동 조준**이고
    //    `autoAttack` 은 `input.aim` 을 쓰지 않으므로(그 값은 렌더용 `player.angle` 이다),
    //    `isPlayerTargetable` 에서 빠진 오브젝트는 플레이어가 **의도적으로 부술 수단이 없다.**
    //    반격 장치가 정확히 그 상태였고, 그래서 추격 모드의 유일한 승리 경로가 유탄 운에
    //    맡겨져 있었다(실측: 니플헤임 클리어율 18.6%, 만렙 타임아웃 44.8%).
    //
    // 판정을 조준 하나로 좁히기 위해 **이 장치 말고 조준 후보가 될 수 있는 것을 전부 죽인다**
    // — 이러면 조준 대상이 그 장치이거나(→ 피해) 아무것도 없거나(→ 한 발도 안 나가 hp 불변)
    // 둘 뿐이라 "유탄이 우연히 맞았다"가 원리적으로 배제된다.
    //
    // ⚠️ 죽여도 되는 것은 **잡몹과 다른 장치뿐**이다. 두 가지를 같이 죽이면 안 된다:
    //    ① 발사체 — 플레이어 자기 탄이 사라져 조준이 멀쩡해도 hp 가 안 깎인다.
    //    ② 포식자(boss) — 보스 사망은 곧 승리라 `compact()` 가 `victory` 를 세우고 월드가
    //       그 자리에서 얼어붙는다(틱이 1 에서 멈춘다). 둘 다 실제로 겪은 거짓 실패다.
    const w = createWorld(11, chaseConfig());
    const player = w.entities[0] as Entity;
    const device = w.entities.find(isCounterDevice) as Entity;
    expect(device).toBeDefined();
    const hp0 = device.hp;
    // 사거리 안에 두되 겹치지는 않게(접촉 피해·이동 간섭 배제).
    player.x = device.x - 300;
    player.y = device.y;
    for (let i = 0; i < 120 && device.hp === hp0; i++) {
      for (const e of w.entities) {
        if (e === player || e === device) continue;
        if (e.kind === 'enemy' || e.kind === 'destructible') e.dead = true;
      }
      player.x = device.x - 300;
      player.y = device.y;
      stepChase(w);
    }
    expect(device.hp, '반격 장치가 자동 조준되지 않아 한 발도 맞지 않았다').toBeLessThan(hp0);
  });

  it('(c-3) 오토파일럿은 추격 모드에서 반격 장치 쪽으로 이동한다(측정 가능성 보장)', () => {
    // 봇이 장치로 가지 않으면 이 무대의 승패는 **측정 자체가 성립하지 않는다** — 실제로
    // 기준선 12,600런이 그 상태에서 "니플헤임은 어렵다"는 거짓 신호를 냈다.
    const w = createWorld(13, chaseConfig());
    const player = w.entities[0] as Entity;
    const nearest = (): number =>
      Math.min(
        ...w.entities
          .filter((e) => !e.dead && isCounterDevice(e))
          .map((e) => Math.hypot(e.x - player.x, e.y - player.y)),
      );
    // ⚠️ "거리가 줄었다" 로는 **아무것도 증명하지 못한다** — 카이팅만 하는 봇도 90틱 안에
    //    우연히 가까워진다(이 테스트를 처음 그렇게 써서 뮤테이션 검증을 통과해 버렸다).
    //    판정은 **접촉 거리까지 수렴했는가**여야 한다. 장치는 원점 링에 고정돼 있으므로
    //    목표를 향해 가지 않는 봇은 여기까지 오지 않는다.
    const REACHED = 150; // 장치 반경 70 + 플레이어 반경 32 에 여유.
    const d0 = nearest();
    let best = d0;
    for (let i = 0; i < 900 && best > REACHED; i++) {
      stepWorld(w, w.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : autopilotInput(w));
      const d = nearest();
      if (d < best) best = d;
    }
    expect(best, `장치까지 최소 거리 ${d0} → ${best}`).toBeLessThanOrEqual(REACHED);
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

  it('(g2) 이번 세그먼트의 대피소만 스냅샷에서 목표로 표시된다(사용자 신고 2026-07-27 "어디인지 안 보임")', () => {
    // 대피소 6개가 전부 같은 모습이고 링 반경 1600 은 화면(1920×1080) 밖이라, 화면만 봐서는
    // 어디로 가야 하는지 알 수 없었다. sim 전진 게이트와 **같은 식**(aux0 === segmentIndex)을
    // 스냅샷 `active` 로 펴서 렌더·레이더가 목표를 가르게 한다.
    const w = createWorld(11, chaseConfig());
    const snapShelters = (): { aux0: number; active: boolean }[] => {
      const snap = snapshotWorld(w);
      const live = shelters(w);
      return snap.entities
        .filter((e) => e.kind === 'shelter')
        .map((e) => ({
          aux0: (live.find((s) => s.id === e.id) as Entity).aux0,
          active: e.active,
        }));
    };
    const s0 = snapShelters();
    expect(s0.length).toBe(CHASE_SHELTER_COUNT);
    expect(s0.filter((s) => s.active).length).toBe(1); // ★ 목표는 언제나 정확히 하나
    expect(s0.find((s) => s.active)?.aux0).toBe(w.wave.segmentIndex);
    // 레이더는 활성 대피소만 목표(objective)로 찍는다 — 6개를 다 찍으면 안 갈린다.
    const snap = snapshotWorld(w);
    const blips = snap.entities.filter((e) => e.kind === 'shelter').map(classifyRadar);
    expect(blips.filter((c) => c === 'objective').length).toBe(1);
    expect(blips.filter((c) => c === null).length).toBe(CHASE_SHELTER_COUNT - 1);

    // 세그먼트가 전진하면 목표도 따라 옮겨간다(다음 대피소).
    w.wave.segmentIndex = 2;
    const s1 = snapShelters();
    expect(s1.filter((s) => s.active).length).toBe(1);
    expect(s1.find((s) => s.active)?.aux0).toBe(2);
  });

  it('(g2b) 대피소는 세 상태로 갈린다 — 미도달·목표·사용됨(사용자 신고 2026-08-04)', () => {
    // `active` 하나로는 "아직 안 온 곳"과 "이미 쓴 곳"이 똑같이 비활성으로 보여 남은 길이
    // 화면에서 사라진다. 스냅샷 `spent` 가 지나온 것을 갈라 렌더가 한 단계 더 죽인다.
    const w = createWorld(11, chaseConfig());
    w.wave.segmentIndex = 2;
    const live = shelters(w);
    const snap = snapshotWorld(w)
      .entities.filter((e) => e.kind === 'shelter')
      .map((e) => ({
        aux0: (live.find((s) => s.id === e.id) as Entity).aux0,
        active: e.active,
        spent: e.spent === true,
      }));
    expect(snap.length).toBe(CHASE_SHELTER_COUNT);
    // 세 상태는 서로 배타적이고 aux0 순서와 정확히 대응한다.
    for (const s of snap) {
      expect(s.active).toBe(s.aux0 === 2);
      expect(s.spent).toBe(s.aux0 < 2);
      expect(s.active && s.spent).toBe(false);
    }
    expect(snap.filter((s) => s.spent).length).toBe(2); // 0·1 번을 지나왔다
    expect(snap.filter((s) => !s.active && !s.spent).length).toBe(CHASE_SHELTER_COUNT - 3);
  });

  it('(g3) 화면 밖 대피소는 화면 가장자리 화살표 + 남은 거리로 지시하고, 화면 안이면 그리지 않는다', () => {
    // 옛 계약은 카메라 중심 260px 링이었다 — 화면 한가운데라 탄막으로 오인됐다(사용자 신고
    // 2026-08-04). 지금은 뷰포트 사각형(여백 SHELTER_ARROW_MARGIN 안쪽) 경계에 붙는다.
    const halfW = DESIGN_WIDTH / 2 - SHELTER_ARROW_MARGIN;
    const halfH = DESIGN_HEIGHT / 2 - SHELTER_ARROW_MARGIN;

    // 대피소 링 반경 1600 > 화면 절반(960×540) → 시작 시점부터 대개 화면 밖이다.
    const far = shelterArrow(0, 0, 1600, 0);
    expect(far).not.toBeNull();
    expect(far!.angle).toBeCloseTo(0, 6);
    // 정동쪽이면 오른쪽 변에 붙는다(고정 반경 원이 아니다).
    expect(far!.x).toBeCloseTo(halfW, 6);
    expect(far!.y).toBeCloseTo(0, 6);
    // 남은 거리는 실제 카메라↔대피소 거리다(화살표 아래 라벨의 값).
    expect(far!.distance).toBeCloseTo(1600, 6);

    // 대각선(45°)은 세로 여백이 먼저 닿으므로 위/아래 변에 붙는다.
    const diag = shelterArrow(100, 200, 100 - 1200, 200 - 1200);
    expect(diag).not.toBeNull();
    expect(diag!.y - 200).toBeCloseTo(-halfH, 6);
    expect(Math.abs(diag!.x - 100)).toBeLessThanOrEqual(halfW + 1e-6);
    expect(diag!.distance).toBeCloseTo(Math.hypot(1200, 1200), 6);

    // 어느 방향이든 화살표는 화면 밖으로 나가지 않는다(잘림 방지).
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const p = shelterArrow(0, 0, Math.cos(a) * 4000, Math.sin(a) * 4000);
      expect(p).not.toBeNull();
      expect(Math.abs(p!.x)).toBeLessThanOrEqual(halfW + 1e-6);
      expect(Math.abs(p!.y)).toBeLessThanOrEqual(halfH + 1e-6);
    }

    // 화면 안(여유 마진 안쪽)이면 실물 대피소가 이미 보이므로 화살표 없음.
    expect(shelterArrow(0, 0, 300, 100)).toBeNull();
  });

  it('(g) full-path config 는 실제로 chase 를 스탬프한다(planetContent 정본, 브릿지 없음)', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 2, stage: 1 });
    expect(cfg.planetMode).toBe(PLANET_MODE.chase);
  });

  it('(h) 무적 포식자는 접근 하한 링을 지킨다 — 정지 플레이어를 덮치지 않는다(사용자 신고 2026-07-27)', () => {
    // 이력: ① 최초에는 공용 moveBoss 의 머리 위 hover 라 접촉이 **구조적으로 불가능**했고,
    //       ② 그 반작용으로 플레이어 실좌표에 직접 수렴시켰더니 잠깐만 서 있어도 무적 포식자가
    //          겹쳐 즉사해 "손도 못 대게 어렵다" 는 신고가 나왔다.
    // 지금은 플레이어 중심 CHASE_PREDATOR_STANDOFF 링으로 수렴한다 — 따라붙되 덮치지 않는다.
    const w = createWorld(13, chaseConfig());
    w.weapon.damage = 0; // 반격 장치 파괴 배제 → 포식자 무적(aux0=0) 유지(무노력 취약화 없음)
    const player = w.entities[0] as Entity;
    const predator = predatorOf(w) as Entity;
    expect(predator.aux0).toBe(0);
    // 원점에서 떨어진 곳에 플레이어를 매 틱 "정지" 고정한다. 실좌표 수렴이면 여기서 즉사했다.
    let minDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 800 && !w.gameOver; i++) {
      player.x = 600;
      player.y = 0;
      stepChase(w);
      const p = predatorOf(w);
      if (p !== undefined) {
        minDist = Math.min(minDist, Math.hypot(p.x - player.x, p.y - player.y));
      }
    }
    expect(chaseAliveCounterDevices(w)).toBe(CHASE_COUNTER_DEVICE_COUNT); // 무적 유지
    expect(w.gameOver, '정지해 있다고 덮쳐 죽으면 안 된다').toBe(false);
    // 링 안쪽으로 들어오지 않는다(한 틱 이동량만큼의 오버슈트만 허용).
    const overshoot = CHASE_PREDATOR_SPEED / 60;
    expect(minDist).toBeGreaterThan(CHASE_PREDATOR_STANDOFF - overshoot * 2);
  });

  it('(h2) 멀리 도망쳐도 포식자가 링까지 따라붙는다(위협 지속 — 배경이 되지 않는다)', () => {
    const w = createWorld(13, chaseConfig());
    w.weapon.damage = 0;
    const player = w.entities[0] as Entity;
    // 링보다 훨씬 먼 곳에 정지 고정 → 포식자가 접근해 링 근방까지 좁혀야 한다.
    for (let i = 0; i < 600 && !w.gameOver; i++) {
      player.x = 6000;
      player.y = 0;
      stepChase(w);
    }
    const p = predatorOf(w) as Entity;
    expect(p).toBeDefined();
    const dist = Math.hypot(p.x - player.x, p.y - player.y);
    // 하한 링 근방으로 수렴(추격은 계속된다). 상한은 링 + 한 틱 여유.
    expect(dist).toBeLessThan(CHASE_PREDATOR_STANDOFF + CHASE_PREDATOR_SPEED / 60 + 1);
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
