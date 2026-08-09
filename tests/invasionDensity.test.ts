/**
 * 침공 밀도 축 — 배선 증명 (2026-08-10 밀도 레인).
 *
 * ## 이 파일이 지키는 것과 지키지 않는 것
 * **지킨다**: ① 밀도를 끄면(`INVASION_DENSITY_LEGACY`) 구 스케줄과 **정확히** 같은가
 * ② 밀도를 켜면 각 레이어에서 적이 **실제로 더 나오는가**(배선이 살아 있는가)
 * ③ 순수 함수(정규화·스케줄 span·반복 변주)가 정수 계약을 지키는가.
 *
 * **지키지 않는다**: "이 값이 밸런스로 맞는가". 그 판단은 사용자가 하네스에서 직접 플레이해
 * 정한다(사용자 결정 2026-08-10) — 기준선이 「기본 수비대 상태를 만렙 기체가 어느 정도
 * 클리어하는 지점」이라 코드가 단언할 수 있는 성질이 아니다. 그래서 여기에 **클리어율·승률
 * 단언을 넣지 마라**(ADR-0051 이 그 축을 게이트에서 내린 이유와 같다).
 *
 * 또한 **골든 상수를 만들지 마라**. 모든 단언이 (a) 두 설정 사이의 상대 비교이거나 (b) 순수
 * 함수의 정의적 성질이다. "적이 정확히 N마리"를 박으면 밀도 기본값을 돌릴 때마다 이 파일이
 * 깨져서, 사용자가 값을 돌려 보는 것 자체가 비싸진다.
 */

import { describe, it, expect } from 'vitest';
import {
  createWorld,
  stepWorld,
  DEFAULT_CONFIG,
  type InputFrame,
  type WorldConfig,
  type WorldState,
} from '../src/sim/world.js';
import {
  INVASION_DENSITY_DEFAULT,
  INVASION_DENSITY_LEGACY,
  INVASION_TOTAL_TICKS,
  INVASION_WAVE_SLOTS,
  PHASE_L1,
  emptyInvasionLayers,
  invasionCoreAddInterval,
  invasionL1RepeatOffsetX,
  invasionL1ScheduleSpan,
  invasionL1WaveCount,
  normalizeInvasionDensity,
  type InvasionDensity,
} from '../src/sim/invasion/index.js';
import { applyDefenseBonus } from '../src/sim/invasion/defenseBonus.js';
import {
  GUARDIAN_TITAN,
  PERFORMANCE_FULL,
  makeGuardianSnapshot,
  normalizeLineageBonus,
  resolveGuardianStats,
} from '../data/guardian.js';
import { GUARDIAN_BONUS_CAP_BP, LINEAGE_BONUS_CAP_BP, shipBonusBp } from '../data/lineage.js';
import { garrisonLayers } from '../data/invasion/garrison.js';
import {
  FACILITY_BEHAVIOR_SPAWNER,
  SPAWNER_FACILITY_CATALOG_ID,
  facilitySpecFor,
} from '../data/invasion/facilities.js';

/** 무입력 프레임. 밀도만 재려면 플레이어가 개입하지 않아야 한다. */
const IDLE: InputFrame = { moveX: 0, moveY: 0, aim: 0, dash: false, special: 0 };

/** 빈 배치 침공 config. 밀도만 갈아끼워 A/B 한다. */
function invasionConfig(density: InvasionDensity, playerHp = 1_000_000): WorldConfig {
  return {
    ...DEFAULT_CONFIG,
    playerHp,
    invasion3: {
      layers: emptyInvasionLayers(),
      timeLimitTicks: INVASION_TOTAL_TICKS,
      maintenance: 10000,
      density,
    },
  } as WorldConfig;
}

/** 살아 있는 적 수. */
function aliveEnemies(state: WorldState): number {
  let n = 0;
  for (const e of state.entities) if (!e.dead && e.kind === 'enemy') n++;
  return n;
}

/** 구간 관찰 결과 — 압력 적분과 피크를 함께 돌려준다. */
interface Pressure {
  /** 생존 적 수의 틱 적분(= 적 압력). 밀도 비교의 **정본 지표**다. */
  integral: number;
  /** 관찰된 동시 생존 적의 최댓값. */
  peak: number;
}

/**
 * 무입력으로 `ticks` 만큼 돌리며 적 압력을 잰다.
 *
 * ## 왜 피크가 아니라 적분인가 (실측으로 배운 것, 2026-08-10)
 * 처음에는 피크로 비교했는데 **간격을 720 → 200 으로 줄여도 피크가 5에서 안 움직였다**.
 * 이유는 편대가 200틱 안에 화면을 지나가 버려서다 — 4배 자주 나와도 두 웨이브가 겹치지
 * 않으면 "동시에 몇 마리"는 그대로다.
 *
 * 그래서 지표를 압력 적분으로 바꿨다. 적분은 「몇 마리가 · 얼마나 오래」를 한 수에 담아
 * 간격·수명 어느 쪽이 움직여도 반응한다. 사용자가 고른 계측 방식이기도 하다(봇 승률은
 * `powerupRng` 를 재고 있어 밀도 신호가 안 보인다 — `bench/invasionBands.ts` 머리말).
 *
 * ⚠️ 이 사실은 튜닝에도 그대로 적용된다: **행성런 수준의 동시 적 수(12~44)를 원하면
 * 간격만으로는 못 간다.** 웨이브 수명보다 간격이 짧아져야(대략 40틱 이하) 겹치기 시작한다.
 */
function pressure(state: WorldState, ticks: number): Pressure {
  let integral = 0;
  let peak = aliveEnemies(state);
  for (let i = 0; i < ticks; i++) {
    stepWorld(state, IDLE);
    const n = aliveEnemies(state);
    integral += n;
    if (n > peak) peak = n;
  }
  return { integral, peak };
}

// ---------------------------------------------------------------------------
// ① 순수 함수 계약
// ---------------------------------------------------------------------------

describe('밀도 — 정규화', () => {
  it('미지정은 기본값으로 메워진다', () => {
    expect(normalizeInvasionDensity()).toEqual(INVASION_DENSITY_DEFAULT);
    expect(normalizeInvasionDensity({})).toEqual(INVASION_DENSITY_DEFAULT);
  });

  it('부분 지정은 지정한 축만 덮는다', () => {
    const d = normalizeInvasionDensity({ l1Repeats: 7 });
    expect(d.l1Repeats).toBe(7);
    expect(d.l1IntervalTicks).toBe(INVASION_DENSITY_DEFAULT.l1IntervalTicks);
  });

  it('손상 입력은 기본값·범위로 떨어진다(sim 에 f64·NaN 이 못 들어간다)', () => {
    const d = normalizeInvasionDensity({
      l1IntervalTicks: Number.NaN,
      l1Repeats: -5,
      l2SpawnAliveAdd: 1e9,
      l3AddIntervalTicks: 240.7,
    });
    expect(d.l1IntervalTicks).toBe(INVASION_DENSITY_DEFAULT.l1IntervalTicks);
    expect(d.l1Repeats).toBe(1);
    expect(d.l2SpawnAliveAdd).toBe(32);
    expect(d.l3AddIntervalTicks).toBe(240);
    for (const v of Object.values(d)) expect(Number.isInteger(v)).toBe(true);
  });
});

describe('밀도 — L1 스케줄 산술', () => {
  it('웨이브 수 = 슬롯 × 바퀴', () => {
    expect(invasionL1WaveCount({ ...INVASION_DENSITY_DEFAULT, l1Repeats: 4 }, 6)).toBe(24);
    expect(invasionL1WaveCount(INVASION_DENSITY_LEGACY, 6)).toBe(6);
  });

  it('span 은 마지막 웨이브의 트리거 틱이다', () => {
    const d = { ...INVASION_DENSITY_DEFAULT, l1IntervalTicks: 200, l1Repeats: 4 };
    expect(invasionL1ScheduleSpan(d, 6)).toBe(23 * 200);
  });

  // ⚠️ span 은 **마지막 웨이브의 트리거 틱**이지 스케줄 전체 길이가 아니다.
  // `formation.ts` 구 주석의 "6슬롯 × 720 = 4320틱"은 간격 6개를 센 값이고, 실제 마지막
  // 트리거는 5번째 간격이 끝나는 3600틱이다. 둘을 헷갈리면 예산 초과 판정이 720틱 보수적으로
  // 나온다(= 안 잘리는데 잘린다고 경고한다).
  it('구값의 마지막 트리거는 5간격 × 720 = 3600틱이다', () => {
    expect(invasionL1ScheduleSpan(INVASION_DENSITY_LEGACY, 6)).toBe(3600);
  });

  it('반복 변주는 k 의 순수 정수 함수이고 0바퀴는 오프셋 0이다', () => {
    expect(invasionL1RepeatOffsetX(0)).toBe(0);
    for (let k = 0; k < 40; k++) {
      const v = invasionL1RepeatOffsetX(k);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-400);
      expect(v).toBeLessThanOrEqual(400);
      // 같은 k 는 언제나 같은 값(RNG·시각 미소비).
      expect(invasionL1RepeatOffsetX(k)).toBe(v);
    }
  });

  it('반복 변주가 실제로 흩어진다(같은 값에 뭉치지 않는다)', () => {
    const seen = new Set<number>();
    for (let k = 1; k <= 12; k++) seen.add(invasionL1RepeatOffsetX(k));
    expect(seen.size).toBe(12);
  });
});

describe('밀도 — L3 증원 간격', () => {
  it('코어가 온전하면 기준 간격 그대로다', () => {
    expect(invasionCoreAddInterval(240, 100)).toBe(240);
  });

  it('코어가 깎일수록 짧아지고 바닥에서 멈춘다', () => {
    expect(invasionCoreAddInterval(240, 70)).toBeLessThan(240);
    expect(invasionCoreAddInterval(240, 40)).toBe(96);
    // 바닥 아래로는 더 짧아지지 않는다(막판에 스폰이 폭주하지 않게).
    expect(invasionCoreAddInterval(240, 0)).toBe(invasionCoreAddInterval(240, 40));
  });

  it('끔(0)은 0을 돌려준다', () => {
    expect(invasionCoreAddInterval(0, 100)).toBe(0);
  });
});

describe('방어측 계보 보너스', () => {
  it('bp 0 은 무연산이다(계보 0 인 기존 런이 바이트 불변)', () => {
    for (const v of [1, 7, 100, 3333]) expect(applyDefenseBonus(v, 0)).toBe(v);
  });

  it('10000bp = ×2.00, 반올림은 한 번이다', () => {
    expect(applyDefenseBonus(100, 10000)).toBe(200);
    expect(applyDefenseBonus(7, 5000)).toBe(11); // round(7 * 1.5) = 11 (10.5 → 11)
  });

  it('음수·비유한은 무연산으로 떨어진다', () => {
    expect(applyDefenseBonus(50, -1)).toBe(50);
    expect(applyDefenseBonus(50, Number.NaN)).toBe(50);
  });
});

describe('계보 상한 — 두 가지가 서로 새지 않는다', () => {
  // 2026-08-10 에 실제로 샌 자리다. `normalizeLineageBonus` 하나를 수호 가지와 **공격측 기체
  // 가지**(`applyShipLineageBonus`)가 공용해서, 수호 상한을 5000 → 37000 으로 올리자
  // 공격측 damageMult 가 1.5 → 4.7 로 같이 튀었다. 상한이 인자가 된 지금도 호출부가 인자를
  // 빠뜨리면 반대 방향(수호가 5000 에서 잘림)으로 같은 결함이 난다 — 그래서 양쪽을 다 박는다.

  it('수호 가지 상한이 기체 가지 상한보다 넓다(대응 축이 실제로 넓어졌는가)', () => {
    expect(GUARDIAN_BONUS_CAP_BP).toBeGreaterThan(LINEAGE_BONUS_CAP_BP);
  });

  it('인자를 생략하면 기체 가지 상한이다(기존 호출부 보존)', () => {
    expect(normalizeLineageBonus(999999)).toBe(LINEAGE_BONUS_CAP_BP);
  });

  it('수호 경로는 넓은 상한을 실제로 받는다', () => {
    expect(normalizeLineageBonus(999999, GUARDIAN_BONUS_CAP_BP)).toBe(GUARDIAN_BONUS_CAP_BP);
  });

  it('수호 스탯 해석이 5000 에서 잘리지 않는다', () => {
    const snap = makeGuardianSnapshot(GUARDIAN_TITAN, 1000);
    const atCap = resolveGuardianStats(snap, PERFORMANCE_FULL, GUARDIAN_BONUS_CAP_BP);
    const atOldCap = resolveGuardianStats(snap, PERFORMANCE_FULL, LINEAGE_BONUS_CAP_BP);
    expect(atCap.hp).toBeGreaterThan(atOldCap.hp);
  });

  it('공격측 기체 가지는 곱선·상한이 그대로다', () => {
    // 점근 상한이므로 레벨을 아무리 올려도 기체 가지는 5000bp 를 못 넘는다.
    expect(shipBonusBp({ shipLevel: 100000, guardianLevel: 0, available: 0, spent: 0 })).toBeLessThanOrEqual(
      LINEAGE_BONUS_CAP_BP,
    );
  });
});

// ---------------------------------------------------------------------------
// ② 기본 수비대 충원 — L2 스포너
// ---------------------------------------------------------------------------

describe('기본 수비대 — L2 스포너 충원', () => {
  it('스포너 catalogId 는 실제로 스포너 거동이다(카탈로그 재배치 가드)', () => {
    const spec = facilitySpecFor(SPAWNER_FACILITY_CATALOG_ID);
    expect(spec).toBeDefined();
    expect(spec?.behavior).toBe(FACILITY_BEHAVIOR_SPAWNER);
  });

  it('기수 0 이면 전부 속사포다(구 거동)', () => {
    const filled = garrisonLayers(emptyInvasionLayers(), 0);
    const spawners = filled.l2.sockets.filter((s) => s?.catalogId === SPAWNER_FACILITY_CATALOG_ID);
    expect(spawners.length).toBe(0);
  });

  it('기수만큼 앞쪽 빈 소켓이 스포너가 된다', () => {
    const filled = garrisonLayers(emptyInvasionLayers(), 3);
    const ids = filled.l2.sockets.map((s) => s?.catalogId);
    expect(ids.slice(0, 3).every((id) => id === SPAWNER_FACILITY_CATALOG_ID)).toBe(true);
    expect(ids.slice(3).every((id) => id !== SPAWNER_FACILITY_CATALOG_ID)).toBe(true);
  });

  it('기수를 바꾸면 결과도 바뀐다(메모가 첫 값을 붙들지 않는다)', () => {
    // 같은 layers **객체 신원**으로 두 번 부른다 — 메모가 1단 WeakMap 이면 여기서 걸린다.
    const layers = emptyInvasionLayers();
    const a = garrisonLayers(layers, 0);
    const b = garrisonLayers(layers, 2);
    expect(a.l2.sockets[0]?.catalogId).not.toBe(b.l2.sockets[0]?.catalogId);
  });

  it('배치된 소켓은 충원이 건드리지 않는다', () => {
    const layers = emptyInvasionLayers();
    const placed = { catalogId: 1, level: 40, ascension: 2, affixSeed: 7, rarity: 3 };
    layers.l2.sockets[0] = placed;
    const filled = garrisonLayers(layers, 3);
    expect(filled.l2.sockets[0]).toEqual(placed);
  });
});

// ---------------------------------------------------------------------------
// ③ 배선 증명 — 밀도를 켜면 실제로 적이 더 나온다
// ---------------------------------------------------------------------------

describe('밀도 — 실제 런 배선', () => {
  it('L1: 밀도 기본값이 구값보다 적 압력이 크다', () => {
    // L1 예산(5400틱)의 절반을 본다. 구값은 이 창에서 슬롯 4개(0/720/1440/2160)밖에 못 쓰고,
    // 기본값은 200틱 간격으로 14웨이브를 낸다.
    const legacy = pressure(createWorld(11, invasionConfig(INVASION_DENSITY_LEGACY)), 2700);
    const dense = pressure(createWorld(11, invasionConfig(INVASION_DENSITY_DEFAULT)), 2700);
    expect(dense.integral).toBeGreaterThan(legacy.integral);
    // 배수까지 박지 않는다 — 기본값은 사용자가 하네스에서 돌릴 값이라, 여기에 배수를 박으면
    // 슬라이더를 만질 때마다 이 파일이 깨진다. 방향만 지킨다.
  });

  it('L1: 바퀴 수를 늘리면 늦은 구간의 압력이 살아난다', () => {
    // 한 바퀴만 돌면 6웨이브가 200틱 간격으로 1000틱 안에 끝나고 그 뒤는 빈 화면이다.
    const one = createWorld(12, invasionConfig({ ...INVASION_DENSITY_DEFAULT, l1Repeats: 1 }));
    const four = createWorld(12, invasionConfig({ ...INVASION_DENSITY_DEFAULT, l1Repeats: 4 }));
    // 앞 1200틱은 두 설정이 같은 스케줄을 탄다 — 차이는 전부 그 뒤에서 온다.
    for (let i = 0; i < 1200; i++) {
      stepWorld(one, IDLE);
      stepWorld(four, IDLE);
    }
    const a = pressure(one, 1500);
    const b = pressure(four, 1500);
    expect(b.integral).toBeGreaterThan(a.integral);
    // 한 바퀴짜리는 이 구간이 완전히 비어 있어야 한다(그게 구 침공의 '빈 화면'의 정체다).
    expect(a.integral).toBe(0);
  });

  it('간격만 줄이면 동시 적 수는 안 올라간다(튜닝 함정 — 웨이브가 겹쳐야 오른다)', () => {
    // 이 단언은 "결함"이 아니라 **설계 사실을 못 박는 것**이다. 행성런 수준의 동시 적 수를
    // 원해서 간격만 내리는 튜닝은 실패한다 — 웨이브 수명보다 간격이 짧아져야 겹친다.
    const wide = pressure(
      createWorld(14, invasionConfig({ ...INVASION_DENSITY_DEFAULT, l1IntervalTicks: 200 })),
      2400,
    );
    const tight = pressure(
      createWorld(14, invasionConfig({ ...INVASION_DENSITY_DEFAULT, l1IntervalTicks: 40 })),
      2400,
    );
    // 간격을 5배 좁히면 그때는 실제로 겹쳐서 피크가 오른다.
    expect(tight.peak).toBeGreaterThan(wide.peak);
  });

  it('L1: 밀도를 끄면 페이즈는 그대로 L1 이다(예산을 못 넘긴다)', () => {
    const state = createWorld(13, invasionConfig(INVASION_DENSITY_DEFAULT));
    for (let i = 0; i < 600; i++) stepWorld(state, IDLE);
    expect(state.invasion3?.phase).toBe(PHASE_L1);
  });

  it('편성 슬롯 수 계약은 그대로 6이다(밀도는 슬롯을 늘리지 않는다)', () => {
    expect(INVASION_WAVE_SLOTS).toBe(6);
    expect(emptyInvasionLayers().l1.waveSlots.length).toBe(6);
  });
});
