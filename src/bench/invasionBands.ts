/**
 * 침공 밴드 계측 하네스 — **측정만 한다. 판정하지 않는다**(ADR-0051 갈래 ①).
 *
 * 원래 이 코드는 `tests/invasionBalance.test.ts` 안에 있었고 밴드 클리어율을 단언으로 굳혔다.
 * ADR-0051 이 그 단언을 내렸다 — 재는 대상이 **참조봇의 실력**이라 사람에게 무엇을 뜻하는지
 * 아무도 모르므로 절대 계약으로 쓸 근거가 없기 때문이다. 그래서 측정 코드는 여기로 옮기고,
 * 실행 진입점은 `bench/invasionBands.ts`(CLI)가 된다.
 *
 * ## 여기 남는 것과 `tests/` 로 남은 것
 * - **여기**: 참조봇을 실제로 굴려 승률·틱을 재는 전부(`measureBand` · `rosterGateRate`).
 * - **`tests/invasionBalance.test.ts`**: 봇 실력에 의존하지 않는 계약 — 램프 미러 ↔ SQL 드리프트
 *   가드, 카탈로그 골든, 풀 카탈로그 노출, 레이어 진입 훅 배선 증명(최소 틱).
 *
 * {@link seedBaseLayers} 는 **양쪽이 함께 쓴다**. 사본을 두 벌 두면 한쪽만 고쳐졌을 때
 * "같은 배치를 쟀다"는 주장이 조용히 거짓이 되므로 정본을 여기 하나만 둔다.
 */

import { createWorld, stepWorld, DEFAULT_CONFIG } from '../sim/world.js';
import type { WorldConfig, LoadoutConfig } from '../sim/world.js';
import { autopilotInput } from '../sim/autopilot.js';
import { INVASION_TOTAL_TICKS, normalizeInvasionLayers } from '../sim/invasion/index.js';
import type { InvasionLayers } from '../sim/invasion/index.js';
import { INVASION_SOCKET_COUNTS } from '../sim/invasion/constants.js';
import { SHIP_TYPES, zeroSkillInvest } from '../../data/ships/index.js';
import { buildRunConfig } from '../run/runConfig.js';
import { defaultProfile, activeShip } from '../save/profile.js';
import { WEAPON_VULCAN } from '../items/loadout.js';
import type { AffixRoll, Item } from '../items/types.js';
import { FIXED_SEEDS, CI_SEEDS } from './balance/seeds.js';

// ---------------------------------------------------------------------------
// 시드 램프 미러 — 정본은 마이그레이션 SQL 이다
// ---------------------------------------------------------------------------

/**
 * 하위 밴드(nn 1..7)가 카탈로그를 순회 노출할 때 쓰는 창 시작점. **1-기반 첨자**라
 * SQL 의 `array[...]` 와 같은 방식으로 읽는다(`LOWER_*_SHIFT[nn - 1]`).
 * 값은 "nn 미만 기지들이 소비한 슬롯 수의 누적합" 이다 — 그래서 창이 이어붙어
 * 카탈로그를 빈틈없이 한 바퀴 덮는다.
 */
export const LOWER_FACILITY_SHIFT: readonly number[] = [0, 2, 4, 7, 10, 14, 1];
export const LOWER_FORMATION_SHIFT: readonly number[] = [0, 1, 2, 3, 5, 7, 9];

/**
 * 재시드 마이그레이션의 시드 생성 규칙 미러. **정본은 SQL 이고 이건 사본이다.**
 * 사본이 조용히 갈라지면 계측이 원격 DB 와 무관한 숫자가 되므로,
 * `tests/invasionBalance.test.ts` 의 드리프트 가드가 SQL 안의 `-- RAMP:` 주석과 문자열로
 * 대조한다(그 대조는 봇 실력에 의존하지 않으므로 테스트로 남았다).
 */
export const RAMP = {
  level: (nn: number) => 1 + Math.floor((3 * (nn - 1)) / 2),
  rarity: (nn: number) => (nn <= 4 ? 0 : nn <= 8 ? 1 : nn <= 14 ? 2 : 3),
  ascension: (nn: number) => (nn <= 7 ? 0 : 1),
  template: (nn: number) => (nn <= 7 ? 0 : nn <= 14 ? 2 : 1),
  waves: (nn: number) => Math.min(6, 1 + Math.floor((nn - 1) / 3)),
  formationKinds: (nn: number) => (nn <= 7 ? 12 : Math.min(8, 1 + Math.floor((nn + 1) / 3))),
  formationShift: (nn: number) =>
    nn <= 7 ? (LOWER_FORMATION_SHIFT[nn - 1] as number) : nn >= 17 ? 2 : 0,
  facilities: (nn: number, socketN: number) => Math.min(socketN, 2 + Math.floor((nn - 1) / 2)),
  facilityKinds: (nn: number) => (nn <= 7 ? 17 : Math.min(9, 2 + Math.floor((nn * 2) / 5))),
  facilityShift: (nn: number) => (nn <= 7 ? (LOWER_FACILITY_SHIFT[nn - 1] as number) : 0),
  props: (nn: number) => (nn <= 4 ? 0 : nn <= 7 ? 2 : nn <= 14 ? 4 : 3),
  propKinds: (nn: number) => Math.min(6, 1 + Math.floor(nn / 4)),
  propShift: (nn: number) => (nn >= 18 ? 3 : 0),
  boss: (nn: number) => (nn <= 4 ? -1 : nn <= 10 ? 2 : nn <= 16 ? 0 : 1),
};

function ref(catalogId: number, nn: number, salt: number) {
  return {
    catalogId,
    level: RAMP.level(nn),
    ascension: RAMP.ascension(nn),
    affixSeed: salt,
    rarity: RAMP.rarity(nn),
  };
}

/** 순번 nn(1..20)의 시드 배치. SQL 이 원격에 심는 것과 같은 정규형이어야 한다. */
export function seedBaseLayers(nn: number): InvasionLayers {
  const tpl = RAMP.template(nn);
  const socketN = INVASION_SOCKET_COUNTS[tpl] as number;
  const waves = RAMP.waves(nn);
  const kf1 = RAMP.formationKinds(nn);
  const sf1 = RAMP.formationShift(nn);
  const facils = RAMP.facilities(nn, socketN);
  const kf2 = RAMP.facilityKinds(nn);
  const sf2 = RAMP.facilityShift(nn);
  const props = RAMP.props(nn);
  const kp = RAMP.propKinds(nn);
  const sp = RAMP.propShift(nn);
  const boss = RAMP.boss(nn);
  return normalizeInvasionLayers({
    l1: {
      waveSlots: Array.from({ length: 6 }, (_, i) =>
        i < waves ? ref((i + sf1) % kf1, nn, nn * 1000 + i * 7) : null,
      ),
    },
    l2: {
      templateId: tpl,
      sockets: Array.from({ length: socketN }, (_, i) =>
        i < facils ? ref((i + sf2) % kf2, nn, nn * 2000 + i * 13) : null,
      ),
    },
    l3: {
      boss: boss >= 0 ? ref(boss, nn, nn * 4000) : null,
      guardians: [null, null],
      props: Array.from({ length: 6 }, (_, i) =>
        i < props ? ref((i + sp) % kp, nn, nn * 3000 + i * 17) : null,
      ),
      core: { hp: 8000, x: 0, y: 0 },
    },
  });
}

// ---------------------------------------------------------------------------
// 참조 장비 프로필 + 런 하네스
// ---------------------------------------------------------------------------

/**
 * 배치전을 실제로 치르는 시점의 "중간 장비" 근사. 임의값이지만 **고정**이라 측정이 재현된다.
 * 무장비로 재면 PvP 해금 직후(장비를 갖춘 상태)와 어긋나고, 콘텐츠가 조금만 세져도 전 밴드가
 * 0% 로 붙어 버려 계측 신호가 죽는다.
 */
export const GEAR_REFERENCE: LoadoutConfig = {
  weaponType: 0,
  subWeaponType: -1,
  damageMult: 1.9,
  fireRateMult: 0.82,
  bulletCountAdd: 1,
  pierceAdd: 1,
  bulletSpeedMult: 1,
  spreadAdd: 0,
  rangeAdd: 0,
  moveSpeedMult: 1.1,
  maxHpAdd: 60,
  dashCdMult: 0.85,
  magnetMult: 1,
  xpMult: 1,
  uniqueMask: 0,
  fireDmg: 0,
  coldSlow: 0,
  lightning: 0,
};

/**
 * 결정론 시드 목록 24개 — {@link CI_SEEDS} 재수출.
 *
 * 예전에는 이 파일에 고정 배열 사본이 있었다. `src/bench/balance/seeds.ts` 의 앞 24개와
 * **바이트 동일**이므로 사본을 지우고 정본을 가리킨다 — 두 벌로 두면 한쪽만 확장했을 때
 * "같은 시드로 쟀다"는 주장이 조용히 거짓이 된다.
 *
 * 24 는 ADR-0037 이 정한 해상도다(기지당 최소 눈금 4.17pp · 밴드당 0.60pp). 통계적으로는
 * 48이 정답이지만(변경 전후 sd 가 29.0 으로 일치하는 지점 = 지표가 노이즈이길 멈추는 해상도)
 * 그건 예산 정책이라 별도 판단 항목이다.
 */
export const BALANCE_SEEDS: readonly number[] = CI_SEEDS;

/**
 * **승격 해상도** 시드 72개. {@link BALANCE_SEEDS} 뒤에 이어 붙이면 96시드 좌표계가 된다
 * (= `FIXED_SEEDS` 전량). "클리어 불가 기지 없음"을 24시드에서 0 으로 관측했을 때 그 기지
 * 하나만 96시드로 승격해 재판정하는 데 쓴다 — 승률 6.25% 인 기지가 24시드에서 0 으로 관측될
 * 확률이 약 21%(0.9375^24)라 두 상태(진짜 클리어 불가 / 표본에 승리가 없음)를 가르지 못한다.
 */
export const BALANCE_SEEDS_ESCALATION: readonly number[] = FIXED_SEEDS.slice(24);

export interface RunOutcome {
  readonly win: boolean;
  readonly ticks: number;
  readonly reachedL3: boolean;
}

/**
 * {@link GEAR_REFERENCE} 와 **같은 결과를 내는 어픽스 표현**. 정규 경로
 * (`buildRunConfig` → `computeLoadoutStats`)는 리터럴 로드아웃을 받지 않고 장착 아이템에서
 * 출발하므로, 로스터 게이트는 리터럴 대신 이 표를 아이템에 실어 보낸다.
 *
 * 대응은 `src/items/loadout.ts` 의 `applyStatSums` 규칙 그대로다(발칸은 무기 baseline 이
 * 무연산이라 중립 로드아웃이 출발점이다):
 *   damagePct 90 → damageMult 1.9 · fireRatePct 18 → fireRateMult 0.82(=1−0.18)
 *   bulletCount 1 · pierce 1 · moveSpeedPct 10 → 1.1 · maxHpFlat 60 · dashCdPct 15 → 0.85
 */
const GEAR_REFERENCE_AFFIXES: readonly AffixRoll[] = [
  { id: 'gate-damage', stat: 'damagePct', value: 90 },
  { id: 'gate-firerate', stat: 'fireRatePct', value: 18 },
  { id: 'gate-bulletcount', stat: 'bulletCount', value: 1 },
  { id: 'gate-pierce', stat: 'pierce', value: 1 },
  { id: 'gate-movespeed', stat: 'moveSpeedPct', value: 10 },
  { id: 'gate-maxhp', stat: 'maxHpFlat', value: 60 },
  { id: 'gate-dashcd', stat: 'dashCdPct', value: 15 },
];

/** 참조 장비를 한 자루의 발칸 주무기로 묶는다(슬롯 순서 계약상 `main` 이어야 무기 타입이 선택된다). */
function gateGearItem(rangeAdd: number): Item {
  return {
    id: 'roster-gate-reference',
    slot: 'main',
    rarity: 'rare',
    affixes: [...GEAR_REFERENCE_AFFIXES, { id: 'gate-range', stat: 'rangeFlat', value: rangeAdd }],
    weaponType: WEAPON_VULCAN,
    source: { planet: 0, stage: 1 },
  };
}

/**
 * 로스터 게이트용 `WorldConfig` — **정규 경로 전량**을 탄다.
 * `Profile`(활성 기체 typeId · 타입별 skillInvest · 장착 아이템) → `buildRunConfig`
 * → `computeLoadoutStats(..., typeId)` → `applyShipTypeBase`(섀시 baseBp) → `createWorld`.
 * 리터럴 로드아웃을 꽂으면 이 사슬이 통째로 우회돼 baseBp 회귀가 보이지 않는다.
 */
export function rosterGateConfig(
  layers: InvasionLayers,
  over: { readonly shipType: number; readonly rangeAdd: number },
): WorldConfig {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = over.shipType;
  // 벡터 길이는 타입별 계약이다(스트라이커 63 · 나머지 상이). **무투자**로 둔다 — 투자를
  // 실으면 6기체가 전부 83~100% 로 포화돼 기체 간 차이가 안 보인다.
  ship.skillInvest = zeroSkillInvest(over.shipType);
  ship.equipped.main = gateGearItem(over.rangeAdd);
  return buildRunConfig(profile, {
    planet: 0,
    stage: 1,
    invasion3: { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 },
  });
}

/** 리터럴 로드아웃 경로의 침공 `WorldConfig`(밴드 계측 · 배선 증명 공용). */
export function invasionConfig(layers: InvasionLayers, loadout: LoadoutConfig): WorldConfig {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
  config.loadout = loadout;
  return config;
}

export function playRun(
  seed: number,
  layers: InvasionLayers,
  /** 로스터 게이트 전용 덮어쓰기. 미지정이면 리터럴 `GEAR_REFERENCE` 구성이다. */
  over?: { readonly shipType: number; readonly rangeAdd: number },
): RunOutcome {
  const config =
    over === undefined ? invasionConfig(layers, GEAR_REFERENCE) : rosterGateConfig(layers, over);
  const state = createWorld(seed, config);
  let reachedL3 = false;
  for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
    stepWorld(state, autopilotInput(state));
    if (state.invasion3?.phase === 2) reachedL3 = true;
    if (state.gameOver || state.victory) {
      return { win: state.victory, ticks: t + 1, reachedL3 };
    }
  }
  return { win: false, ticks: INVASION_TOTAL_TICKS, reachedL3 };
}

export interface BandStat {
  readonly winRate: number;
  /** 기지별 승률(퍼센트) — 밴드 안 난이도 분산 지표. */
  readonly perBaseRates: number[];
  /** 기지별 평균 클리어틱(승리 표본이 있는 기지만). */
  readonly perBaseMeanTicks: number[];
}

export function measureBand(
  orders: readonly number[],
  seeds: readonly number[] = BALANCE_SEEDS,
): BandStat {
  let wins = 0;
  let total = 0;
  const perBaseRates: number[] = [];
  const perBaseMeanTicks: number[] = [];
  for (const nn of orders) {
    const layers = seedBaseLayers(nn);
    let bw = 0;
    const ticks: number[] = [];
    for (const seed of seeds) {
      const o = playRun(seed, layers);
      total++;
      if (o.win) {
        wins++;
        bw++;
        ticks.push(o.ticks);
      }
    }
    perBaseRates.push((bw / seeds.length) * 100);
    if (ticks.length > 0) {
      perBaseMeanTicks.push(ticks.reduce((a, b) => a + b, 0) / ticks.length);
    }
  }
  return { winRate: (wins / total) * 100, perBaseRates, perBaseMeanTicks };
}

/**
 * 96시드 승격 판정 — 그 기지가 24+72 시드 안에서 **한 번이라도** 이기는가(0/1).
 * 첫 승리에서 즉시 끊어 비용을 최소화한다.
 */
export function escalatedWinRate(nn: number): number {
  const layers = seedBaseLayers(nn);
  let wins = 0;
  for (const seed of [...BALANCE_SEEDS, ...BALANCE_SEEDS_ESCALATION]) {
    if (playRun(seed, layers).win) {
      wins++;
      break;
    }
  }
  return wins;
}

/** 밴드 정의 — 시드 기지 20곳의 난이도 구획(`data/seedBases.ts` 의 `difficultyBand` 와 같다). */
export const BANDS = {
  하위: [1, 2, 3, 4, 5, 6, 7],
  중하: [8, 9, 10, 11, 12, 13, 14],
  중위: [15, 16, 17, 18, 19, 20],
} as const;

export type BandName = keyof typeof BANDS;

export function stdev(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

// ---------------------------------------------------------------------------
// 로스터 간섭 계측 — 침공은 기체 로스터와 한 배를 탄다
// ---------------------------------------------------------------------------

/**
 * `rangeAdd = 460` 은 `src/sim/autopilot.ts` 의 `KITE_DISTANCE` 와 같은 값이다. 참조봇이
 * 유지하려는 거리와 사거리가 정확히 겹치는 **임계점**이라, range 축이 조금만 흔들려도
 * 조준 성공/실패가 갈린다 — 로스터 range 변경에 가장 민감한 지점이다.
 */
export const ROSTER_GATE_RANGE_ADD = 460;

/** 스트라이커(0)를 뺀 나머지 전 기체. 카탈로그에서 유도한다 — 개수를 손으로 적지 않는다. */
export const NON_STRIKER_SHIP_TYPES: readonly number[] = SHIP_TYPES.map((_, i) => i).filter(
  (i) => i > 0,
);

export function rosterGateRate(
  shipType: number,
  nn: number,
  seeds: readonly number[] = BALANCE_SEEDS,
): number {
  const layers = seedBaseLayers(nn);
  let wins = 0;
  for (const seed of seeds) {
    const o = playRun(seed, layers, { shipType, rangeAdd: ROSTER_GATE_RANGE_ADD });
    if (o.win) wins++;
  }
  return (wins / seeds.length) * 100;
}
