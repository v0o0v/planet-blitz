/**
 * 침공 3레이어 — 웨이브 0~1 통합 검증 (M7a · 통합 게이트).
 *
 * 레인별 단위 테스트(invasionScroll/Phase/Formation/Facility/CoreRoom/Hash)는 각자 소유 모듈을
 * **직접** 호출해 검증한다. 그래서 레인 사이 배선이 통째로 빠져도 전부 그린이 된다 — 실제로
 * 통합 직전 상태가 그랬다:
 *   ① 훅이 아무 데서도 등록되지 않아 3레이어 런이 5분간 빈 맵을 스크롤했고,
 *   ② 해시 v2 런타임 폴드가 실재하지 않는 필드명(`invasionRuntime`)을 읽어 항상 0 으로 접혔으며,
 *   ③ 설비·보스·기물이 충돌 화이트리스트에 없어 조용히 무적이었다.
 * 이 파일은 그 셋을 **`createWorld` → `stepWorld` 정규 경로로만** 관찰해 재발을 막는다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, WorldState } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import type { InputFrame } from '../src/sim/world.js';
import { blankEntity } from '../src/sim/entities.js';
import {
  INVASION_TOTAL_TICKS,
  PHASE_L1,
  PHASE_L2,
  PHASE_L3,
  normalizeInvasionLayers,
} from '../src/sim/invasion/index.js';

// ---------------------------------------------------------------------------
// 하네스
// ---------------------------------------------------------------------------

const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

/** 카탈로그 0번 lv1 노말 참조. */
function ref(catalogId = 0) {
  return { catalogId, level: 1, ascension: 0, affixSeed: 1, rarity: 0 };
}

/**
 * 명시 배치. 빈 슬롯 자동 충원(기본 수비대)은 L9 레인 소유라 아직 없다 — 그래서 편대·설비는
 * 슬롯을 직접 채워야 스폰된다(보스만 coreRoom 이 스폰 단계에서 충원한다).
 */
function filledLayers() {
  return normalizeInvasionLayers({
    l1: { waveSlots: [ref(0), ref(1), null, null, null, null] },
    l2: { templateId: 0, sockets: [ref(0), ref(0), ref(3), null, null, null] },
    l3: { boss: null, guardians: [null, null], props: [ref(0), null, null, null, null, null] },
  });
}

function makeInvasionWorld(seed = 7, maintenance = 10000, coreHp?: number): WorldState {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  const layers = filledLayers();
  if (coreHp !== undefined) layers.l3.core.hp = coreHp;
  config.invasion3 = {
    layers,
    timeLimitTicks: INVASION_TOTAL_TICKS,
    maintenance,
  };
  return createWorld(seed, config);
}

/** 페이즈가 바뀔 때까지(또는 상한까지) 돌린다. 반환 = 실제로 돈 틱 수. */
function runUntilPhase(state: WorldState, target: number, maxTicks: number): number {
  let t = 0;
  while (t < maxTicks && state.invasion3!.phase !== target && !state.gameOver) {
    stepWorld(state, IDLE);
    t++;
  }
  return t;
}

/** 표적 위에 아군탄을 직접 놓는다(충돌 해소 경로만 관찰하기 위한 최소 장치). */
function placeBulletOn(state: WorldState, target: { x: number; y: number }, damage: number): void {
  const b = blankEntity('bullet');
  b.x = target.x;
  b.y = target.y;
  b.radius = 8;
  b.damage = damage;
  b.life = 60;
  b.hp = 1;
  b.maxHp = 1;
  b.id = state.nextEntityId++;
  state.entities.push(b);
}

function countKinds(state: WorldState, kinds: readonly string[]): number {
  let n = 0;
  for (const e of state.entities) if (!e.dead && kinds.includes(e.kind)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// ① 스텝 훅 정적 배선 — 각 레이어가 실제로 콘텐츠를 스폰하는가
// ---------------------------------------------------------------------------

describe('침공 3레이어 통합 — 스텝 훅 배선', () => {
  it('L1 에서 편대가 실제로 스폰된다(훅 미배선이면 0 마리로 남는다)', () => {
    const state = makeInvasionWorld();
    expect(state.invasion3?.phase).toBe(PHASE_L1);
    // 첫 슬롯 트리거(tick 0) + 구성원 지연(<=60)을 넘겨 관찰한다.
    for (let i = 0; i < 120; i++) stepWorld(state, IDLE);
    expect(countKinds(state, ['enemy'])).toBeGreaterThan(0);
  });

  it('L2 진입 시 회랑 벽과 소켓 설비가 스폰된다', () => {
    const state = makeInvasionWorld();
    runUntilPhase(state, PHASE_L2, INVASION_TOTAL_TICKS);
    expect(state.invasion3?.phase).toBe(PHASE_L2);
    // activeWalls 는 매 틱 시작에 재빌드된다 — 전이 틱 직후에는 아직 비어 있으므로 한 틱 더 돈다.
    stepWorld(state, IDLE);
    expect(countKinds(state, ['wall'])).toBeGreaterThan(0);
    expect(state.activeWalls.length).toBeGreaterThan(0);
    expect(countKinds(state, ['facilityGun', 'facilityHazard', 'facilitySpawner'])).toBeGreaterThan(
      0,
    );
  });

  it('L3 진입 시 코어와 방어 보스가 스폰된다', () => {
    const state = makeInvasionWorld();
    runUntilPhase(state, PHASE_L3, INVASION_TOTAL_TICKS);
    expect(state.invasion3?.phase).toBe(PHASE_L3);
    expect(countKinds(state, ['core'])).toBe(1);
    // 빈 보스 슬롯은 기본 수비대(강철 골리앗)가 스폰 단계에서 충원한다.
    expect(countKinds(state, ['defenseBoss'])).toBe(1);
  });

  it('L1 클리어도 L2 클리어도 victory 를 세우지 않는다(compact 누수 가드)', () => {
    const state = makeInvasionWorld();
    runUntilPhase(state, PHASE_L3, INVASION_TOTAL_TICKS);
    expect(state.victory).toBe(false);
    expect(state.gameOver).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ② 충돌 화이트리스트 — 신규 kind 가 실제로 피격되는가
// ---------------------------------------------------------------------------

describe('침공 3레이어 통합 — 신규 kind 피격', () => {
  it('방어 보스가 아군탄에 피해를 받는다(화이트리스트 누락이면 무적으로 남는다)', () => {
    const state = makeInvasionWorld();
    runUntilPhase(state, PHASE_L3, INVASION_TOTAL_TICKS);
    const boss = state.entities.find((e) => e.kind === 'defenseBoss' && !e.dead);
    expect(boss).toBeDefined();
    const before = boss!.hp;
    // 보스 위에 아군탄을 놓고 한 틱 돌려 충돌 해소를 태운다.
    placeBulletOn(state, boss!, 100);
    stepWorld(state, IDLE);
    expect(boss!.hp).toBeLessThan(before);
  });

  it('L2 설비가 아군탄에 피해를 받는다', () => {
    const state = makeInvasionWorld();
    runUntilPhase(state, PHASE_L2, INVASION_TOTAL_TICKS);
    const fac = state.entities.find((e) => e.kind === 'facilityGun' && !e.dead);
    expect(fac).toBeDefined();
    const before = fac!.hp;
    placeBulletOn(state, fac!, 50);
    stepWorld(state, IDLE);
    expect(fac!.hp).toBeLessThan(before);
  });
});

// ---------------------------------------------------------------------------
// ③ 해시 v2 런타임 폴드 — 정규 경로에서 실값이 접히는가
// ---------------------------------------------------------------------------

describe('침공 3레이어 통합 — 해시 봉인', () => {
  it('스크롤만 진행돼도 해시가 갈린다(런타임 폴드가 실제 필드를 읽는다)', () => {
    const a = makeInvasionWorld();
    const h0 = hashWorld(a);
    stepWorld(a, IDLE);
    expect(hashWorld(a)).not.toBe(h0);
  });

  it('런타임 스크롤 오프셋을 위조하면 해시가 갈린다', () => {
    const a = makeInvasionWorld();
    for (let i = 0; i < 30; i++) stepWorld(a, IDLE);
    const h = hashWorld(a);
    a.invasion3!.scrollY += 1;
    expect(hashWorld(a)).not.toBe(h);
  });

  it('폭탄 적립을 위조하면 해시가 갈린다', () => {
    const a = makeInvasionWorld();
    const h = hashWorld(a);
    a.invasion3Bombs += 1;
    expect(hashWorld(a)).not.toBe(h);
  });

  it('같은 seed·입력의 두 런은 매 틱 해시가 동일하다(ADR-0005)', () => {
    const a = makeInvasionWorld(11);
    const b = makeInvasionWorld(11);
    for (let i = 0; i < 600; i++) {
      stepWorld(a, IDLE);
      stepWorld(b, IDLE);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
  });
});

// ---------------------------------------------------------------------------
// ④ 런 전체 — 5분 예산 안에서 3레이어를 전부 통과하고 hard 타임아웃이 작동하는가
// ---------------------------------------------------------------------------

describe('침공 3레이어 통합 — 런 수명', () => {
  it('L1→L2→L3 를 총 예산(18000틱) 안에 전부 통과한다', () => {
    const state = makeInvasionWorld();
    const t1 = runUntilPhase(state, PHASE_L2, INVASION_TOTAL_TICKS);
    expect(state.invasion3?.phase).toBe(PHASE_L2);
    const t2 = runUntilPhase(state, PHASE_L3, INVASION_TOTAL_TICKS);
    expect(state.invasion3?.phase).toBe(PHASE_L3);
    // 두 레이어 합이 L3 에 쓸 시간을 남겨야 한다(L1 5400 + L2 5400 = 10800 이 soft 상한).
    expect(t1 + t2).toBeLessThanOrEqual(10800);
    expect(state.gameOver).toBe(false);
  });

  it('코어를 부수지 못하면 정확히 18000틱에서 gameOver 로 끝난다(hard 상한)', () => {
    // 상한만 남기려면 두 조기 종료를 모두 배제해야 한다 — 플레이어 자동 사격에 의한 victory,
    // 코어방 피해에 의한 사망 gameOver.
    const state = makeInvasionWorld(7, 10000, 1_000_000_000);
    const p0 = state.entities[0]!;
    p0.maxHp = 1e9;
    p0.hp = 1e9;
    for (let i = 0; i < INVASION_TOTAL_TICKS - 1; i++) stepWorld(state, IDLE);
    expect(state.gameOver).toBe(false);
    stepWorld(state, IDLE);
    expect(state.gameOver).toBe(true);
    expect(state.victory).toBe(false);
    expect(state.tick).toBe(INVASION_TOTAL_TICKS);
  });

  it('가만히 있으면 코어방 방어가 실제로 플레이어를 죽인다(콘텐츠가 무해하지 않다)', () => {
    const state = makeInvasionWorld();
    let died = false;
    for (let i = 0; i < INVASION_TOTAL_TICKS && !died; i++) {
      stepWorld(state, IDLE);
      if (state.entities[0]!.hp <= 0) died = true;
    }
    expect(died).toBe(true);
  });
});
