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
  updateChaseShelters,
  chaseSegmentCleared,
  chaseSheltersSecured,
  chaseShelterTotal,
  chaseAllSheltersSecured,
  chaseShelterMilestone,
  chaseNormalSegments,
  chaseOnUnsecuredShelter,
  chaseVisionRadius,
  isShelter,
  isShelterSecured,
  isPredatorInvincible,
  CHASE_SHELTER_COUNT,
  CHASE_SHELTER_RING_RADIUS,
  CHASE_SHELTER_RING_RADIUS_OUTER,
  CHASE_VISION_RADIUS,
  CHASE_PREDATOR_SPEED,
  CHASE_PREDATOR_STANDOFF,
} from '../src/sim/modes/chase.js';

/** 이 무대의 모든 대피소를 확보 상태로 만든다(전량 확보 게이트 검증용). */
function secureAll(state: WorldState): void {
  for (const e of state.entities) if (isShelter(e)) e.aux1 = 1;
}

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
  it('placeChaseCourse: 포식자 aux0=0 · bossSpawned · 대피소 10개(aux0=인덱스 전수, aux1=0 미확보) · 반격 장치 0개', () => {
    const a = placedState(2);
    // 포식자(boss): 무적(aux0=0) + bossSpawned(두 번째 보스 방지).
    const predator = predatorOf(a) as Entity;
    expect(predator).toBeDefined();
    expect(predator.aux0).toBe(0);
    expect(isPredatorInvincible(predator)).toBe(true);
    expect(a.bossSpawned).toBe(true);
    // 반격 장치는 2026-08-05 재설계로 사라졌다 — 파괴물이 한 개도 배치되지 않는다.
    expect(a.entities.filter((e) => e.kind === 'destructible').length).toBe(0);
    // 대피소 N개 + aux0=인덱스(0..N-1 전수) + aux1=0(미확보).
    const shs = shelters(a);
    expect(shs.length).toBe(CHASE_SHELTER_COUNT);
    expect(CHASE_SHELTER_COUNT).toBe(10);
    expect(shs.map((e) => e.aux0).sort((m, n) => m - n)).toEqual(
      Array.from({ length: CHASE_SHELTER_COUNT }, (_, k) => k),
    );
    for (const e of shs) expect(isShelterSecured(e)).toBe(false);
    expect(chaseSheltersSecured(a)).toBe(0);
    expect(chaseShelterTotal(a)).toBe(CHASE_SHELTER_COUNT);
  });

  it('대피소는 안/밖 두 링에 번갈아 선다 — 바깥 링은 시야 반경 밖이라 탐색이 필요하다', () => {
    // 한 링에 다 세우면 시작 지점에서 전부 보여 "다 찾는다" 가 성립하지 않는다. 이 등식이
    // 깨지면 무대의 난이도 축(이동 거리)이 조용히 사라진다.
    expect(CHASE_SHELTER_RING_RADIUS_OUTER).toBeGreaterThan(CHASE_VISION_RADIUS);
    const shs = shelters(placedState(2));
    for (const e of shs) {
      const r = Math.hypot(e.x, e.y);
      const want = e.aux0 % 2 === 0 ? CHASE_SHELTER_RING_RADIUS : CHASE_SHELTER_RING_RADIUS_OUTER;
      // 허용 오차 1 유닛 — 배치가 sim 의 근사 `cos`/`sin`(결정론용 테이블)을 쓰므로 정확히
      // 링 위는 아니다. 여기서 재는 것은 "어느 링에 속하는가"이고 두 링은 1000 이나 떨어져 있다.
      expect(Math.abs(r - want), `대피소 ${e.aux0} 반경 ${r}`).toBeLessThan(1);
    }
    // 두 링에 실제로 갈려 있다(전부 한 링에 몰리면 위 등식이 통과해도 의미가 없다).
    const outer = shs.filter((e) => Math.hypot(e.x, e.y) > CHASE_VISION_RADIUS);
    expect(outer.length).toBe(CHASE_SHELTER_COUNT / 2);
  });

  it('placeChaseCourse 결정론(바이트 동일) — 배치 좌표까지 완전 일치', () => {
    const a = placedState(2);
    const b = placedState(2);
    const strip = (s: WorldState): unknown =>
      s.entities.map((e) => [e.kind, e.x, e.y, e.radius, e.hp, e.ownerId, e.aux0, e.aux1, e.enemyType]);
    expect(strip(a)).toEqual(strip(b));
  });

  it('isShelter/isShelterSecured/isPredatorInvincible 는 kind·aux 로만 판정한다', () => {
    const sh = blankEntity('shelter');
    expect(isShelter(sh)).toBe(true);
    expect(isShelterSecured(sh)).toBe(false); // aux1=0 기본
    sh.aux1 = 1;
    expect(isShelterSecured(sh)).toBe(true);
    const dev = blankEntity('destructible');
    expect(isShelter(dev)).toBe(false);
    const boss = blankEntity('boss');
    boss.aux0 = 0;
    expect(isPredatorInvincible(boss)).toBe(true);
    boss.aux0 = 1;
    expect(isPredatorInvincible(boss)).toBe(false);
  });

  it('updateChaseShelters 는 밟은 미확보 대피소만 aux1=1 로 넘긴다(멀거나 이미 확보면 불변)', () => {
    const s = placedState(2);
    const player = s.entities[0] as Entity;
    const target = shelters(s)[3] as Entity;
    // 멀리 있으면 아무것도 확보되지 않는다.
    player.x = 999_999;
    updateChaseShelters(s);
    expect(chaseSheltersSecured(s)).toBe(0);
    // 밟으면 그 한 곳만 확보된다.
    player.x = target.x;
    player.y = target.y;
    updateChaseShelters(s);
    expect(isShelterSecured(target)).toBe(true);
    expect(chaseSheltersSecured(s)).toBe(1);
    // 재호출은 멱등(두 번 세지 않는다).
    updateChaseShelters(s);
    expect(chaseSheltersSecured(s)).toBe(1);
  });

  it('updateChasePredator 는 **전량 확보** 시에만 포식자를 취약화(aux0=1)한다', () => {
    const s = placedState(2);
    const predator = predatorOf(s) as Entity;
    // 한 곳이라도 남아 있으면 무적 유지 — 9/10 에서도 열리면 안 된다.
    updateChasePredator(s);
    expect(predator.aux0).toBe(0);
    const shs = shelters(s);
    for (let i = 0; i < shs.length - 1; i++) (shs[i] as Entity).aux1 = 1;
    expect(chaseAllSheltersSecured(s)).toBe(false);
    updateChasePredator(s);
    expect(predator.aux0).toBe(0);
    // 마지막 한 곳까지 확보 → 취약화.
    (shs[shs.length - 1] as Entity).aux1 = 1;
    expect(chaseAllSheltersSecured(s)).toBe(true);
    updateChasePredator(s);
    expect(predator.aux0).toBe(1);
  });

  it('chaseShelterMilestone: 단조 증가하고 **마지막이 정확히 전량**이다(= 다 찾으면 보스)', () => {
    const n = chaseNormalSegments();
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const m = chaseShelterMilestone(i, n);
      expect(m).toBeGreaterThan(prev);
      expect(Number.isInteger(m)).toBe(true);
      prev = m;
    }
    // 이 등식이 깨지면 "다 찾았는데 보스가 안 나온다"(또는 그 반대)가 된다.
    expect(chaseShelterMilestone(n - 1, n)).toBe(CHASE_SHELTER_COUNT);
    // 범위 밖 인덱스는 클램프된다(손상 상태에서 조용히 통과/실패하지 않게).
    expect(chaseShelterMilestone(-5, n)).toBe(chaseShelterMilestone(0, n));
    expect(chaseShelterMilestone(999, n)).toBe(CHASE_SHELTER_COUNT);
  });

  it('chaseSegmentCleared 는 누적 확보 수가 그 구간 마일스톤에 닿아야 참이다', () => {
    const s = placedState(2);
    const n = chaseNormalSegments();
    const need = chaseShelterMilestone(0, n);
    const shs = shelters(s);
    for (let i = 0; i < need - 1; i++) (shs[i] as Entity).aux1 = 1;
    expect(chaseSegmentCleared(s, 0)).toBe(false); // 한 곳 모자라면 전진 없음
    (shs[need - 1] as Entity).aux1 = 1;
    expect(chaseSegmentCleared(s, 0)).toBe(true);
    // 마지막 구간은 전량을 요구한다.
    expect(chaseSegmentCleared(s, n - 1)).toBe(false);
    secureAll(s);
    expect(chaseSegmentCleared(s, n - 1)).toBe(true);
  });

  it('chaseOnUnsecuredShelter 는 미확보 대피소 overlap 만 참이다(확보 후엔 거짓)', () => {
    const player = blankEntity('player');
    player.id = 1;
    player.radius = 32;
    const sh = blankEntity('shelter');
    sh.id = 2;
    sh.radius = 140;
    const s = { entities: [player, sh] as Entity[] } as unknown as WorldState;
    expect(chaseOnUnsecuredShelter(s)).toBe(true);
    sh.aux1 = 1;
    expect(chaseOnUnsecuredShelter(s)).toBe(false);
    sh.aux1 = 0;
    player.x = 100000;
    expect(chaseOnUnsecuredShelter(s)).toBe(false);
  });

  it('chaseVisionRadius 는 chase 면 상수, 그 외/undefined 면 0 이다', () => {
    expect(chaseVisionRadius(PLANET_MODE.chase)).toBe(CHASE_VISION_RADIUS);
    expect(chaseVisionRadius(PLANET_MODE.vampire)).toBe(0);
    expect(chaseVisionRadius(PLANET_MODE.contamination)).toBe(0);
    expect(chaseVisionRadius(undefined)).toBe(0);
  });

  it('대피소 수와 세그먼트 수는 **독립**이다 — 어떤 조합에서도 마일스톤이 전량으로 끝난다', () => {
    // 구 계약은 `CHASE_SHELTER_COUNT === SEGMENTS.length - 1`(aux0 ↔ 세그먼트 1:1)이었고,
    // 그 결합이 실제로 desync 를 냈다(세그먼트가 하나 늘자 초과 구간에 대응 대피소가 없어졌다).
    // 지금은 결합이 없다 — 세그먼트 수가 무엇이든 마지막 마일스톤이 전량이라 구조적으로 안전하다.
    expect(chaseNormalSegments()).toBe(SEGMENTS.length - 1);
    for (const n of [1, 2, 3, 6, 7, 13, CHASE_SHELTER_COUNT + 5]) {
      expect(chaseShelterMilestone(n - 1, n)).toBe(CHASE_SHELTER_COUNT);
    }
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
    // 취약화 전이라 무피해(대피소가 아직 남아 있다).
    expect(chaseAllSheltersSecured(w)).toBe(false);
    expect(predator.aux0).toBe(0);
    expect(predator.hp).toBe(hp0);
  });

  it('(c) 대피소 전부 확보 → 포식자 aux0=1(취약) → 아군탄이 hp 를 깎아 처치 → victory(실제 피해 경로)', () => {
    const w = createWorld(3, chaseConfig());
    w.weapon.damage = 0; // 오토어택 개입 배제.
    const predator = predatorOf(w) as Entity;
    expect(predator.aux0).toBe(0);
    // 플레이어를 대피소마다 순서대로 세워 **실제 확보 경로**(updateChaseShelters)로 전부 확보한다.
    const player = w.entities[0] as Entity;
    for (const sh of shelters(w)) {
      player.x = sh.x;
      player.y = sh.y;
      stepChase(w);
    }
    expect(chaseSheltersSecured(w)).toBe(CHASE_SHELTER_COUNT); // 전부 확보
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

  it('(c-2) 취약해진 포식자는 **자동 조준**만으로 죽는다 — 승리 조건이 조준 밖이면 이 무대는 깰 수 없다', () => {
    // ⚠️ 이 저장소가 네 번 겪은 "맞기는 하지만 조준되지는 않는" 결함의 회귀 가드다(선례: 침공
    //    실드 발생기 · 보호막 국면 코어 · 반격 장치 · 오염 노드). 이 게임의 사격은 **전부 자동
    //    조준**이라, 조준 목록에 없는 것은 플레이어가 의도적으로 부술 수단이 없다.
    //
    //    2026-08-05 재설계로 이 무대의 파괴 대상은 **포식자 하나**가 됐다 — 즉 승리 경로 전체가
    //    "취약해진 보스가 조준되는가" 한 줄에 걸린다. 손으로 얹는 거대 탄(`blast`) 없이
    //    오토어택만으로 hp 가 깎이는지를 본다.
    const w = createWorld(11, chaseConfig());
    const player = w.entities[0] as Entity;
    secureAll(w); // 전량 확보 상태에서 시작(확보 경로 자체는 (c)가 증명한다).
    const predator = predatorOf(w) as Entity;
    const hp0 = predator.hp;
    for (let i = 0; i < 240 && predator.hp === hp0; i++) {
      // 잡몹이 조준을 가져가지 않게 비운다 — 남는 조준 후보는 포식자뿐이다.
      for (const e of w.entities) if (e.kind === 'enemy') e.dead = true;
      // 사거리 안에 두되 겹치지 않게(무적 접촉 즉사·이동 간섭 배제).
      player.x = predator.x - 300;
      player.y = predator.y;
      stepChase(w);
    }
    expect(predator.aux0, '전량 확보인데 취약화가 안 됐다').toBe(1);
    expect(predator.hp, '취약해진 포식자가 자동 조준되지 않아 한 발도 맞지 않았다').toBeLessThan(hp0);
  });

  it('(c-3) 오토파일럿은 추격 모드에서 미확보 대피소 쪽으로 이동한다(측정 가능성 보장)', () => {
    // 봇이 대피소로 가지 않으면 이 무대의 승패는 **측정 자체가 성립하지 않는다** — 실제로
    // 기준선 12,600런이 그 상태에서 "니플헤임은 어렵다"는 거짓 신호를 냈다.
    const w = createWorld(13, chaseConfig());
    // ⚠️ "거리가 줄었다" 로는 **아무것도 증명하지 못한다** — 카이팅만 하는 봇도 우연히
    //    가까워진다. 판정은 **실제로 확보했는가**다. 대피소는 고정 링에 있으므로 목표를 향해
    //    가지 않는 봇은 한 곳도 밟지 못한다.
    for (let i = 0; i < 1800 && chaseSheltersSecured(w) === 0; i++) {
      stepWorld(w, w.pendingLevelUp ? { ...emptyInput(), special: packPowerupPick(0) } : autopilotInput(w));
    }
    expect(chaseSheltersSecured(w), '봇이 대피소를 한 곳도 못 찾았다').toBeGreaterThan(0);
  });

  it('(d) 대피소 확보로 세그먼트가 전진한다(killGoal 아님 — kills=0 에서 전진)', () => {
    const w = createWorld(5, chaseConfig());
    w.weapon.damage = 0; // kills 를 0 으로 고정 → killGoal 게이트 배제(전진하면 대피소뿐).
    expect(w.wave.segmentIndex).toBe(0);
    const player = w.entities[0] as Entity;
    const need = chaseShelterMilestone(0, chaseNormalSegments());
    const shs = shelters(w);
    // 마일스톤 직전까지는 전진하지 않는다(한 곳만 밟아도 오르면 마일스톤이 무의미하다).
    for (let i = 0; i < need - 1; i++) {
      const sh = shs[i] as Entity;
      player.x = sh.x;
      player.y = sh.y;
      stepChase(w);
    }
    expect(w.wave.segmentIndex).toBe(0);
    const last = shs[need - 1] as Entity;
    player.x = last.x;
    player.y = last.y;
    // ⚠️ 확보는 `compact` **이후**(틱 후반)에 일어나고 세그먼트 판정(`updateWaves`)은 틱 전반에
    //    있다. 그래서 마지막 한 곳을 밟은 틱이 아니라 **그다음 틱**에 전진한다(1프레임 = 16ms,
    //    화면에서는 같은 순간이다). 순서를 뒤집으면 확보 즉시 전진하지만, `updateChaseShelters`
    //    가 compact 이후여야 이번 틱에 죽은 엔티티가 반영된다는 계약이 깨진다.
    stepChase(w);
    expect(chaseSheltersSecured(w)).toBe(need); // 확보는 이 틱에 끝났다
    stepChase(w);
    expect(w.kills).toBe(0); // 처치 0 — killGoal 로는 절대 전진 못 함
    expect(w.wave.segmentIndex).toBe(1); // 마일스톤 도달로 전진
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

  it('(f) 필드 밖(8000,8000)으로 도망가도 대피소·포식자가 컬링되지 않는다(Lane8 교훈)', () => {
    const w = createWorld(21, chaseConfig());
    w.weapon.damage = 0;
    const player = w.entities[0] as Entity;
    expect(shelters(w).length).toBe(CHASE_SHELTER_COUNT);
    // 컬 반경(CHUNK_CULL_RADIUS=3000) 훨씬 밖으로 이동 → activateChunks 가 매 틱 gimmick 을 컬링.
    player.x = 8000;
    player.y = 8000;
    for (let i = 0; i < 10; i++) stepChase(w);
    // ⚠️ 대피소가 컬링되면 `chaseShelterTotal` 이 줄어 **도망만으로 전량 확보**가 성립한다
    //    (구 반격 장치에서 실제로 겪은 exploit 의 동형). 총수·확보 수 둘 다 못박는다.
    expect(shelters(w).length).toBe(CHASE_SHELTER_COUNT); // ★ 대피소 미컬링
    expect(chaseShelterTotal(w)).toBe(CHASE_SHELTER_COUNT);
    expect(chaseSheltersSecured(w)).toBe(0); // 밟지 않았으므로 한 곳도 확보되지 않았다
    expect(chaseAllSheltersSecured(w)).toBe(false);
    expect(predatorOf(w)).toBeDefined(); // ★ 포식자 미컬링
    const predator = predatorOf(w) as Entity;
    expect(predator.aux0).toBe(0); // 무노력 취약화가 일어나지 않았다
  });

  it('(g2) 미확보 대피소 전부가 스냅샷에서 목표로 표시된다(레이더도 같은 식으로 찍는다)', () => {
    // 대피소가 전부 같은 모습이고 링 반경이 화면(1920×1080) 밖이라, 화면만 봐서는 어디로 가야
    // 하는지 알 수 없었다(사용자 신고 2026-07-27). sim 술어(`isShelterSecured`)를 스냅샷
    // `active` 로 펴서 렌더·레이더가 남은 곳을 가르게 한다.
    //
    // ⚠️ 구 계약은 "목표는 언제나 정확히 하나"(aux0 === segmentIndex)였다. 2026-08-05 재설계로
    //    **미확보면 언제나 목표**다 — 10곳을 다 찾는 것이 곧 보스 게이트이기 때문이다.
    const w = createWorld(11, chaseConfig());
    const snapShelters = (): { secured: boolean; active: boolean; spent: boolean }[] => {
      const live = shelters(w);
      return snapshotWorld(w)
        .entities.filter((e) => e.kind === 'shelter')
        .map((e) => ({
          secured: isShelterSecured(live.find((s) => s.id === e.id) as Entity),
          active: e.active,
          spent: e.spent === true,
        }));
    };
    const s0 = snapShelters();
    expect(s0.length).toBe(CHASE_SHELTER_COUNT);
    expect(s0.filter((s) => s.active).length).toBe(CHASE_SHELTER_COUNT); // 전부 미확보 = 전부 목표
    // 레이더는 활성 대피소를 목표(objective)로 찍는다.
    const blips = snapshotWorld(w).entities.filter((e) => e.kind === 'shelter').map(classifyRadar);
    expect(blips.filter((c) => c === 'objective').length).toBe(CHASE_SHELTER_COUNT);

    // 세 곳을 확보하면 그만큼 목표에서 빠지고 `spent` 로 넘어간다.
    const live = shelters(w);
    for (let i = 0; i < 3; i++) (live[i] as Entity).aux1 = 1;
    const s1 = snapShelters();
    expect(s1.filter((s) => s.active).length).toBe(CHASE_SHELTER_COUNT - 3);
    expect(s1.filter((s) => s.spent).length).toBe(3);
  });

  it('(g2b) `active`/`spent` 는 정확한 여집합이다 — 확보한 곳도 지도에 남아야 남은 길이 보인다', () => {
    // `active` 하나로는 "아직 안 온 곳"과 "이미 쓴 곳"이 똑같이 비활성으로 보여 남은 길이
    // 화면에서 사라진다(사용자 신고 2026-08-04). 스냅샷 `spent` 가 확보분을 갈라 렌더가 한
    // 단계 더 죽인다 — 지우지 않는 이유는 남은 곳을 추리할 단서이기 때문이다.
    const w = createWorld(11, chaseConfig());
    const live = shelters(w);
    for (let i = 0; i < 4; i++) (live[i] as Entity).aux1 = 1;
    const snap = snapshotWorld(w)
      .entities.filter((e) => e.kind === 'shelter')
      .map((e) => ({
        secured: isShelterSecured(live.find((s) => s.id === e.id) as Entity),
        active: e.active,
        spent: e.spent === true,
      }));
    expect(snap.length).toBe(CHASE_SHELTER_COUNT);
    for (const s of snap) {
      expect(s.active).toBe(!s.secured);
      expect(s.spent).toBe(s.secured);
      expect(s.active && s.spent).toBe(false); // 배타
      expect(s.active || s.spent).toBe(true); // 전수(제3의 상태가 없다)
    }
    expect(snap.filter((s) => s.spent).length).toBe(4);
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
    w.weapon.damage = 0;
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
    expect(chaseAllSheltersSecured(w)).toBe(false); // 대피소 미확보 = 무적 유지
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
    expect(chaseShelterTotal(w)).toBe(0);
    expect(chaseSheltersSecured(w)).toBe(0);
    expect(chaseAllSheltersSecured(w)).toBe(false); // 대피소가 0개면 "전량 확보"가 아니다
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
