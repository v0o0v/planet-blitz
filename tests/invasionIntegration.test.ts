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
import { createWorld, stepWorld, packPowerupPick, DEFAULT_CONFIG } from '../src/sim/world.js';
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
 * 명시 배치. 빈 슬롯은 통합 게이트에서 배선된 기본 수비대 자동 충원(결정 #22 —
 * `makeInvasionContext` → `garrisonLayers`)이 스폰 단계에서 채우므로, 여기서 슬롯을 직접
 * 채우는 목적은 '명시 배치가 그대로 스폰되는가'를 충원과 구분해 보기 위함이다. 충원 자체는
 * 아래 `emptyLayers()` 케이스가 따로 관찰한다.
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

/**
 * 한 틱 진행한다. **레벨업이 뜨면 그 프레임에 0번 선택을 소비한다.**
 *
 * `stepWorld` 는 `pendingLevelUp` 동안 월드를 정지시키고 tick 만 올린다(world.ts:736). 침공
 * 런은 편대를 잡아 금방 레벨업하므로, 선택을 소비하지 않으면 페이즈 전이·hard 타임아웃이 둘 다
 * 멈춘 채 남은 예산을 빈 루프로 흘린다 — 관측이 아니라 정지 상태를 재게 된다. 실제 클라는
 * 레벨업 UI 가 선택을 강제하므로 여기서 그 역할을 대신한다(하네스·EF 벤치도 동일 규약).
 */
function step(state: WorldState, input: InputFrame = IDLE): void {
  stepWorld(state, state.pendingLevelUp ? { ...input, special: packPowerupPick(0) } : input);
}

/** 페이즈가 바뀔 때까지(또는 상한까지) 돌린다. 반환 = 실제로 돈 틱 수. */
function runUntilPhase(state: WorldState, target: number, maxTicks: number): number {
  let t = 0;
  while (t < maxTicks && state.invasion3!.phase !== target && !state.gameOver) {
    step(state);
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
    for (let i = 0; i < INVASION_TOTAL_TICKS - 1; i++) step(state);
    expect(state.gameOver).toBe(false);
    step(state);
    expect(state.gameOver).toBe(true);
    expect(state.victory).toBe(false);
    expect(state.tick).toBe(INVASION_TOTAL_TICKS);
  });

  it('가만히 있으면 코어방 방어가 실제로 플레이어를 깎는다(콘텐츠가 무해하지 않다)', () => {
    // 재는 것은 **L3 코어방 콘텐츠의 유해성**이다. '사망 여부'로 재면 레벨업 파워업 경제가
    // 측정에 섞인다 — 레벨업을 소비해야 런이 진행되는데(step 주석), 그 선택이 플레이어를
    // 강화해 치사 여부가 밸런스 조정마다 뒤집힌다. 그래서 사망이 아니라 **L3 구간 피해량**을
    // 잰다: 무입력 플레이어가 코어방에서 최대 HP 의 상당 비율을 잃어야 한다.
    // (L3 진입 시 HP 는 레이어 클리어 회복 보너스로 채워지므로 진입 시점을 기준선으로 쓴다.)
    const state = makeInvasionWorld();
    let hpAtL3 = -1;
    for (let i = 0; i < INVASION_TOTAL_TICKS; i++) {
      step(state);
      if (hpAtL3 < 0 && state.invasion3!.phase === PHASE_L3) hpAtL3 = state.entities[0]!.hp;
      if (state.gameOver || state.victory) break;
    }
    expect(hpAtL3).toBeGreaterThan(0);
    const lost = hpAtL3 - state.entities[0]!.hp;
    expect(lost).toBeGreaterThanOrEqual(Math.round(state.entities[0]!.maxHp / 4));
  });
});

// ---------------------------------------------------------------------------
// ⑤ 기본 수비대 자동 충원 — 빈 배치 기지가 '무저항'으로 남지 않는가
// ---------------------------------------------------------------------------

describe('침공 3레이어 통합 — 기본 수비대 충원', () => {
  /** 전 슬롯 빈 정규형(NPC 초기 기지·신규 유저 방어 배치의 실제 모습). */
  function emptyLayers() {
    return normalizeInvasionLayers(undefined);
  }

  function makeEmptyWorld(seed = 9): WorldState {
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = {
      layers: emptyLayers(),
      timeLimitTicks: INVASION_TOTAL_TICKS,
      maintenance: 10000,
    };
    return createWorld(seed, config);
  }

  it('빈 배치여도 L1 에 편대가 스폰된다(충원 배선이 빠지면 적 0마리로 남는다)', () => {
    const state = makeEmptyWorld();
    for (let i = 0; i < 120; i++) step(state);
    expect(countKinds(state, ['enemy'])).toBeGreaterThan(0);
  });

  it('빈 배치여도 L2 소켓 설비가 스폰된다', () => {
    const state = makeEmptyWorld();
    runUntilPhase(state, PHASE_L2, INVASION_TOTAL_TICKS);
    expect(state.invasion3?.phase).toBe(PHASE_L2);
    step(state);
    expect(
      countKinds(state, ['facilityGun', 'facilityHazard', 'facilitySpawner']),
    ).toBeGreaterThan(0);
  });

  it('충원은 스폰 단계 주입이라 config.layers 직렬화·해시를 오염시키지 않는다', () => {
    const state = makeEmptyWorld();
    for (let i = 0; i < 600; i++) step(state);
    // 런이 실제로 진행됐는데도 config 가 보는 배치는 끝까지 빈 정규형이다 — 이 등식이 깨지면
    // 클라·서버 중 한쪽만 충원본을 직렬화한 것이고, 그 순간 전 침공이 defense-mismatch 로
    // 오거부된다(EF layersEqual 은 언제나 충원 **전** 원본을 본다).
    expect(state.config.invasion3!.layers).toEqual(emptyLayers());
  });

  it('빈 배치 런도 결정론이다(같은 seed → 매 틱 해시 동일)', () => {
    const a = makeEmptyWorld(9);
    const b = makeEmptyWorld(9);
    for (let i = 0; i < 400; i++) {
      step(a);
      step(b);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
  });
});
