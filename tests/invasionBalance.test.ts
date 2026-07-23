/**
 * 침공 밸런스 스모크 — NPC 시드 20기지 × 결정론 시드 목록 (M7c C7-balance).
 *
 * ## 이 파일이 막는 것
 * 레인별 단위 테스트는 자기 모듈만 부르므로 **"카탈로그는 다 그린인데 실제 판이 클리어
 * 불가"** 상태를 통과시킨다. M7c 콘텐츠 확장 직후가 정확히 그랬다 — 참조봇 실측에서
 * 중하·중위 밴드 클리어율이 **0%** 였는데 기존 테스트는 전부 통과했다.
 * 여기서는 `createWorld` → `stepWorld` **정규 경로**로 한 판을 끝까지 돌려, 밴드별
 * 클리어율이 목표 범위 안에 있는지를 직접 잰다.
 *
 * ## 측정 기준 — 참조봇이지 사람이 아니다
 * 입력은 `autopilotInput`(ADR-0008 순수 결정론 입력 봇)이 만든다. 사람 플레이어는
 * 이보다 잘 피하므로 **여기 승률은 실제 체감 승률의 하한**이다. 절대값보다 중요한 것은
 * ①클리어 가능성이 살아 있는가 ②밴드 순서대로 어려워지는가 두 가지다.
 *
 * 장비는 고정 프로필(`GEAR_REFERENCE`)을 쓴다. 무장비로 재면 배치전을 실제로 치르는
 * 시점(PvP 해금 직후 = 장비를 갖춘 상태)과 어긋나고, 콘텐츠가 조금만 세져도 전 밴드가
 * 0% 로 붙어 버려 회귀 신호가 죽는다.
 *
 * ## 목표 승률과 근거 (참조봇 기준)
 *   하위(01~07) ≥ 85%  — 배치전은 PvP 해금 후 **필수 5회**다. 여기서 막히면 진행이 멈춘다.
 *   중하(08~14) 55~80% — 절반 이상 이기되 배치를 신경 쓰게 만드는 구간.
 *   중위(15~20) 25~55% — 재도전 전제의 상위권 문턱. 0% 도 100% 도 아니어야 한다.
 * 실측: 24시드 98.2% / 71.4% / 30.6% · 아래 12시드 부분집합 97.6% / 66.7% / 30.6%.
 * (직전 실측은 24시드 96.4 / 74.4 / 31.3 · 12시드 97.6 / 73.8 / 26.4 였다 —
 *  `fix/weapon-range-semantics` 로 무제한 조준이 사라지면서 재측정한 값이다. 아래
 *  "밴드 안 분산" 절의 상한 주석에 이동 폭과 원인을 적어 두었다.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { WorldConfig, LoadoutConfig } from '../src/sim/world.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { INVASION_TOTAL_TICKS, normalizeInvasionLayers } from '../src/sim/invasion/index.js';
import type { InvasionLayers } from '../src/sim/invasion/index.js';
import { INVASION_SOCKET_COUNTS } from '../src/sim/invasion/constants.js';
import { FORMATIONS } from '../data/invasion/formations.js';
import { INVASION_FACILITIES } from '../data/invasion/facilities.js';
import { L3_PROPS } from '../data/invasion/props.js';
import { DEFENSE_BOSSES } from '../data/invasion/defenseBosses.js';
import { SEED_BASES, SEED_BASE_COUNT, seedBaseUuid } from '../data/seedBases.js';
import { SHIP_TYPES, zeroSkillInvest } from '../data/ships/index.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { WEAPON_VULCAN } from '../src/items/loadout.js';
import type { AffixRoll, Item } from '../src/items/types.js';

// ---------------------------------------------------------------------------
// 시드 램프 미러 — 정본은 마이그레이션 SQL 이다
// ---------------------------------------------------------------------------

/**
 * `supabase/migrations/20260723000000_m7c_seed_rebalance.sql` 의 시드 생성 규칙 미러.
 * **정본은 SQL 이고 이건 사본이다.** 사본이 조용히 갈라지면 이 파일의 승률 측정이
 * 원격 DB 와 무관한 숫자가 되므로, 아래 `드리프트 가드` 테스트가 SQL 안의
 * `-- RAMP:` 주석과 이 표를 문자열로 대조한다.
 */
const RAMP = {
  level: (nn: number) => 1 + Math.floor((3 * (nn - 1)) / 2),
  rarity: (nn: number) => (nn <= 6 ? 0 : nn <= 12 ? 1 : nn <= 17 ? 2 : 3),
  ascension: (nn: number) => (nn <= 9 ? 0 : nn <= 14 ? 1 : nn <= 18 ? 2 : 3),
  template: (nn: number) => (nn <= 7 ? 0 : nn <= 14 ? 2 : 1),
  waves: (nn: number) => Math.min(6, 1 + Math.floor((nn - 1) / 3)),
  formationKinds: (nn: number) => Math.min(8, 1 + Math.floor((nn + 1) / 3)),
  formationShift: (nn: number) => (nn >= 17 ? 2 : 0),
  facilities: (nn: number, socketN: number) => Math.min(socketN, 2 + Math.floor((nn - 1) / 2)),
  facilityKinds: (nn: number) => Math.min(9, 2 + Math.floor((nn * 2) / 5)),
  props: (nn: number) => (nn <= 4 ? 0 : nn <= 8 ? 1 : nn <= 15 ? 2 : nn <= 17 ? 3 : 4),
  propKinds: (nn: number) => Math.min(6, 1 + Math.floor(nn / 4)),
  propShift: (nn: number) => (nn >= 18 ? 3 : 0),
  boss: (nn: number) => (nn <= 4 ? -1 : nn <= 10 ? 0 : nn <= 16 ? 1 : 2),
};

/** SQL 헤더가 반드시 담고 있어야 하는 램프 식(문자열 그대로 대조). */
const RAMP_SQL_LINES: readonly string[] = [
  '-- RAMP: level = 1 + (3*(nn-1))/2',
  '-- RAMP: rarity = nn<=6 ? 0 : nn<=12 ? 1 : nn<=17 ? 2 : 3',
  '-- RAMP: ascension = nn<=9 ? 0 : nn<=14 ? 1 : nn<=18 ? 2 : 3',
  '-- RAMP: template = nn<=7 ? 0 : nn<=14 ? 2 : 1',
  '-- RAMP: waves = min(6, 1 + (nn-1)/3)',
  '-- RAMP: formationKinds = min(8, 1 + (nn+1)/3)',
  '-- RAMP: formationShift = nn>=17 ? 2 : 0',
  '-- RAMP: facilities = min(socketN, 2 + (nn-1)/2)',
  '-- RAMP: facilityKinds = min(9, 2 + (nn*2)/5)',
  '-- RAMP: props = nn<=4 ? 0 : nn<=8 ? 1 : nn<=15 ? 2 : nn<=17 ? 3 : 4',
  '-- RAMP: propKinds = min(6, 1 + nn/4)',
  '-- RAMP: propShift = nn>=18 ? 3 : 0',
  '-- RAMP: boss = nn<=4 ? none : nn<=10 ? 0 : nn<=16 ? 1 : 2',
];

const MIGRATION_PATH = fileURLToPath(
  new URL('../supabase/migrations/20260723000000_m7c_seed_rebalance.sql', import.meta.url),
);

/**
 * 마이그레이션 SQL 원문. `tests/node-shims.d.ts` 의 `readFileSync` 선언이 인코딩 인자를
 * 받지 않아(바이트 반환) 여기서 디코드한다 — 공유 shim 을 이 레인이 넓히지 않기 위해서다.
 */
function readMigrationSql(): string {
  return new TextDecoder().decode(readFileSync(MIGRATION_PATH));
}

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
        i < facils ? ref(i % kf2, nn, nn * 2000 + i * 13) : null,
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
 * 배치전을 실제로 치르는 시점의 "중간 장비" 근사. 임의값이지만 **고정**이라 측정이
 * 재현된다. 이 값을 바꾸면 아래 목표 범위도 함께 재측정해야 한다.
 */
const GEAR_REFERENCE: LoadoutConfig = {
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
 * 결정론 시드 목록. 재현 가능해야 하므로 **고정 배열**이다(난수 생성 금지).
 * 튜닝 때 쓴 24시드 목록에서 균등하게 하나 걸러 뽑은 12개다(승패로 고르지 않았다 —
 * 이긴 시드만 모으면 승률이 위로 편향된다). 20기지 각각이 이 목록 안에서 최소 1회는
 * 승리하므로 "이 기지는 어떤 시드로도 못 깬다"를 아래 단언이 실제로 잡는다.
 */
const BALANCE_SEEDS: readonly number[] = [1, 5, 11, 17, 23, 31, 41, 43, 53, 61, 71, 79];

interface RunOutcome {
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
 * 나머지 축(탄속·확산·자석·경험치·원소)은 `GEAR_REFERENCE` 가 중립이라 어픽스도 없다.
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
function rosterGateConfig(
  layers: InvasionLayers,
  over: { readonly shipType: number; readonly rangeAdd: number },
): WorldConfig {
  const profile = defaultProfile();
  const ship = activeShip(profile);
  ship.typeId = over.shipType;
  // 벡터 길이는 타입별 계약이다(스트라이커 63 · 나머지 상이). **무투자**로 둔다 — 투자를
  // 실으면 6기체가 전부 83~100% 로 포화돼 회귀 신호가 죽는다(아래 게이트 주석 §커버 범위 ③).
  ship.skillInvest = zeroSkillInvest(over.shipType);
  ship.equipped.main = gateGearItem(over.rangeAdd);
  return buildRunConfig(profile, {
    planet: 0,
    stage: 1,
    invasion3: { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 },
  });
}

function playRun(
  seed: number,
  layers: InvasionLayers,
  /** 로스터 게이트 전용 덮어쓰기. 미지정이면 기존 19건과 **완전히 같은** 구성이다. */
  over?: { readonly shipType: number; readonly rangeAdd: number },
): RunOutcome {
  let config: WorldConfig;
  if (over === undefined) {
    config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = GEAR_REFERENCE;
  } else {
    config = rosterGateConfig(layers, over);
  }
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

interface BandStat {
  readonly winRate: number;
  /** 기지별 승률(퍼센트) — 밴드 안 난이도 분산 지표. */
  readonly perBaseRates: number[];
  /** 기지별 평균 클리어틱(승리 표본이 있는 기지만). */
  readonly perBaseMeanTicks: number[];
}

function measureBand(orders: readonly number[]): BandStat {
  let wins = 0;
  let total = 0;
  const perBaseRates: number[] = [];
  const perBaseMeanTicks: number[] = [];
  for (const nn of orders) {
    const layers = seedBaseLayers(nn);
    let bw = 0;
    const ticks: number[] = [];
    for (const seed of BALANCE_SEEDS) {
      const o = playRun(seed, layers);
      total++;
      if (o.win) {
        wins++;
        bw++;
        ticks.push(o.ticks);
      }
    }
    perBaseRates.push((bw / BALANCE_SEEDS.length) * 100);
    if (ticks.length > 0) {
      perBaseMeanTicks.push(ticks.reduce((a, b) => a + b, 0) / ticks.length);
    }
  }
  return { winRate: (wins / total) * 100, perBaseRates, perBaseMeanTicks };
}

const BANDS = {
  하위: [1, 2, 3, 4, 5, 6, 7],
  중하: [8, 9, 10, 11, 12, 13, 14],
  중위: [15, 16, 17, 18, 19, 20],
} as const;

/** 밴드 측정은 비싸다(런 1회 ≈ 1만 틱). 밴드마다 한 번만 돌리고 여러 단언이 공유한다. */
const measured: Record<keyof typeof BANDS, BandStat> = {
  하위: measureBand(BANDS.하위),
  중하: measureBand(BANDS.중하),
  중위: measureBand(BANDS.중위),
};

// ---------------------------------------------------------------------------
// ① 밴드별 클리어율이 목표 범위 안
// ---------------------------------------------------------------------------

describe('밸런스 스모크 — 밴드별 클리어율', () => {
  it.each([
    ['하위', 85, 100],
    ['중하', 55, 80],
    ['중위', 25, 55],
  ] as [keyof typeof BANDS, number, number][])(
    '%s 밴드 클리어율이 %d~%d%% 안에 있다',
    (band, lo, hi) => {
      const rate = measured[band].winRate;
      expect(rate, `${band} 밴드 클리어율 ${rate.toFixed(1)}%`).toBeGreaterThanOrEqual(lo);
      expect(rate, `${band} 밴드 클리어율 ${rate.toFixed(1)}%`).toBeLessThanOrEqual(hi);
    },
  );

  it('밴드 순서대로 어려워진다(하위 > 중하 > 중위)', () => {
    // M7c 확장 직후의 실제 결함이 "중하·중위가 나란히 0%" 였다. 평균 승률만 보면
    // 그것도 '순서대로'라 통과하므로, 위 범위 단언과 함께여야 의미가 있다.
    expect(measured.하위.winRate).toBeGreaterThan(measured.중하.winRate);
    expect(measured.중하.winRate).toBeGreaterThan(measured.중위.winRate);
  });

  it('클리어 불가 기지가 없다(모든 기지가 최소 1시드에서 승리)', () => {
    // 승률 평균이 목표 안이어도 특정 기지 하나가 수학적으로 클리어 불가일 수 있다.
    for (const band of Object.keys(BANDS) as (keyof typeof BANDS)[]) {
      measured[band].perBaseRates.forEach((rate, i) => {
        expect(rate, `${band} #${BANDS[band][i]} 가 전 시드에서 패배`).toBeGreaterThan(0);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// ② 밴드 안 난이도 분산 상한
// ---------------------------------------------------------------------------

function stdev(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

describe('밸런스 스모크 — 밴드 안 분산', () => {
  it('기지별 클리어 시간 편차가 상한 안(밴드 안에서 판 길이가 널뛰지 않는다)', () => {
    // 상한은 재조정 후 실측값(하위 1656 / 중하 565 / 중위 641틱)에 여유를 준 값이다.
    // 넘으면 한 밴드 안에 성격이 전혀 다른 기지가 섞였다는 뜻이다.
    const limits: Record<keyof typeof BANDS, number> = { 하위: 2200, 중하: 1400, 중위: 1600 };
    for (const band of Object.keys(BANDS) as (keyof typeof BANDS)[]) {
      const sd = stdev(measured[band].perBaseMeanTicks);
      expect(sd, `${band} 기지간 클리어틱 편차 ${Math.round(sd)}`).toBeLessThanOrEqual(
        limits[band],
      );
    }
  });

  it('기지별 승률 편차가 상한 안', () => {
    // 밴드 안에서 한 기지만 유별나게 쉽거나 어려우면 '난이도 밴드'라는 표시가 거짓이 된다.
    //
    // ⚠️ 중하 상한은 `fix/weapon-range-semantics` 로 **28 → 32 재조정**했다. 무제한 조준을
    // 유한화하자 밴드 양 끝이 서로 반대로 움직여 편차가 18.1 → 30.2pp 로 벌어졌다:
    //   기지별 승률 100/75/92/83/50/50/67 → 100/100/75/92/33/42/25 (12시드)
    // 접근형 편대가 많은 상위 중하(#12~14)는 사거리 밖에서 적을 놓쳐 어려워졌고, 하위
    // 중하(#8·#9)는 오프빌드 강화가 제시되지 않게 되면서 쉬워졌다. 실패 사유는 전부
    // 사망(시간초과 0)이라 배선 결함이 아니라 난이도 이동이다. M7c 시드 램프가 **버그
    // 있는 sim 위에서** 튜닝된 값이었으므로 램프 재조정이 정답이고, 그건 M8 밸런스
    // 레인 몫이다(사용자 판단 2026-07-21: "일단 둬. 밸런스는 나중에 한번에 잡는다").
    // 상한을 32 로 둔 것은 그 재조정 전까지 **더 벌어지는 것만은 잡기 위한** 임시 기준선이다.
    const limits: Record<keyof typeof BANDS, number> = { 하위: 20, 중하: 32, 중위: 28 };
    for (const band of Object.keys(BANDS) as (keyof typeof BANDS)[]) {
      const sd = stdev(measured[band].perBaseRates);
      expect(sd, `${band} 기지간 승률 편차 ${sd.toFixed(1)}pp`).toBeLessThanOrEqual(limits[band]);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 정규 경로 통합 — 3레이어를 실제로 통과한다
// ---------------------------------------------------------------------------

describe('밸런스 스모크 — 정규 경로 통합', () => {
  it('시드 기지 런이 L3 까지 실제로 진행되고 코어 파괴로 끝난다', () => {
    // "밸런스 수치는 맞는데 배선이 없어 빈 맵을 스크롤한다"를 막는 자리다.
    const layers = seedBaseLayers(1);
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = GEAR_REFERENCE;
    const state = createWorld(1, config);
    const seen = new Set<number>();
    let spawnedAny = false;
    for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
      stepWorld(state, autopilotInput(state));
      const phase = state.invasion3?.phase;
      if (phase !== undefined) seen.add(phase);
      if (!spawnedAny && state.entities.some((e) => e.kind === 'enemy' && !e.dead)) {
        spawnedAny = true;
      }
      if (state.gameOver || state.victory) break;
    }
    expect(spawnedAny, '적이 한 번도 스폰되지 않았다(스텝 훅 미배선 신호)').toBe(true);
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(state.victory).toBe(true);
    expect(state.entities.find((e) => e.kind === 'core' && !e.dead)).toBeUndefined();
  });

  it('상위 기지 런에서 방어 보스·기물이 실제로 존재한다', () => {
    // 카탈로그에 넣었는데 스폰 경로가 없으면 승률만 보고는 알 수 없다.
    // 시드 5 는 #20 이 L3 까지 도달해 승리하는 것으로 확인된 값이다(패배 시드로 재면
    // 플레이어가 L3 전에 죽어 "보스가 없다"가 오탐이 된다).
    // ⚠️ 증인 시드는 sim 이 바뀌면 함께 갱신해야 한다 — 예전 값 37 은
    // `fix/weapon-range-semantics` 이후 L3 에 도달하지 못한다(#20 의 L3 도달 시드 집합이
    // 71·83·97·127·163·173 에서 1·5·11·23·113·149·173 으로 갈렸다). 단언을 약화한 것이
    // 아니라 **같은 성질의 증인을 다시 고른 것**이다.
    const layers = seedBaseLayers(20);
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = GEAR_REFERENCE;
    const state = createWorld(5, config);
    let sawBoss = false;
    let sawProp = false;
    for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
      stepWorld(state, autopilotInput(state));
      if (!sawBoss && state.entities.some((e) => e.kind === 'defenseBoss')) sawBoss = true;
      if (!sawProp && state.entities.some((e) => e.kind === 'prop')) sawProp = true;
      if (sawBoss && sawProp) break;
      if (state.gameOver || state.victory) break;
    }
    expect(sawBoss, '#20 배치에 보스가 있는데 엔티티가 없다').toBe(true);
    expect(sawProp, '#20 배치에 기물이 있는데 엔티티가 없다').toBe(true);
  });

  it('사거리에 투자한 공격자도 실제로 사격하고 승리까지 간다', () => {
    // 이 하네스는 오래도록 `rangeAdd: 0` 한 점만 밟았다(`GEAR_REFERENCE`). 그 사이
    // `weapon.range` 는 `0 = 무제한` 센티널이라 **사거리에 투자할수록 조준 상한이 좁아졌고**,
    // 오토파일럿 카이팅 거리(460)보다 짧아지면 침공 공격자가 한 발도 쏘지 못했다 —
    // "밴드별 승률 전부 목표 안" 옆에 "사거리 노드를 찍으면 마비"가 나란히 있었다는 뜻이다.
    // 사거리 축을 실제로 밟는 유일한 자리이므로, 승패뿐 아니라 **탄이 나갔는지**까지 본다.
    const invested: LoadoutConfig = { ...GEAR_REFERENCE, rangeAdd: 400 };
    const layers = seedBaseLayers(1);
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = invested;
    const state = createWorld(1, config);
    let firedTicks = 0;
    for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
      stepWorld(state, autopilotInput(state));
      if (state.entities.some((e) => e.kind === 'bullet' && !e.dead)) firedTicks++;
      if (state.gameOver || state.victory) break;
    }
    expect(firedTicks, '사거리 투자 프로필이 한 발도 쏘지 못했다').toBeGreaterThan(0);
    expect(state.victory, '사거리 투자 프로필이 무투자 대비 승리하지 못했다').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ④ 카탈로그 골든 가드 — 수치 튜닝이 인덱스 계약을 건드리지 않았는지
// ---------------------------------------------------------------------------

describe('카탈로그 계약 — 수치 튜닝이 인덱스를 건드리지 않았다', () => {
  it('편대 카탈로그 순서·개수 골든', () => {
    expect(FORMATIONS.map((f) => f.id)).toEqual([
      'formation-scout-drones',
      'formation-interceptors',
      'formation-assault',
      'formation-glide-flock',
      'formation-mine-layer',
      'formation-shield-escort',
      'formation-sniper-nest',
      'formation-support-escort',
      'formation-toxar-corrosion',
      'formation-toxar-blight',
      'formation-kras-breaker',
      'formation-kras-piercer',
    ]);
    FORMATIONS.forEach((f, i) => expect(f.catalogId).toBe(i));
  });

  it('설비 카탈로그 순서·개수 골든', () => {
    expect(INVASION_FACILITIES.map((f) => f.key)).toEqual([
      'fac.rapid',
      'fac.rail',
      'fac.mortar',
      'fac.laser',
      'fac.flame',
      'fac.spawner',
      'fac.press',
      'fac.gravwell',
      'fac.shock',
      'fac.venomvent',
      'fac.blightpool',
      'fac.corrosivemist',
      'fac.toxinturret',
      'fac.heavyrail',
      'fac.siegecannon',
      'fac.breachturret',
      'fac.demolisher',
    ]);
  });

  it('기물 카탈로그 순서·역할 골든', () => {
    expect(L3_PROPS.map((p) => p.id)).toEqual([
      'shieldGenerator',
      'gravityAnchor',
      'fixedCannon',
      'repairPylon',
      'decoyHologram',
      'mineSwarm',
    ]);
    // 역할 코드가 인덱스와 어긋나면 스텝 디스패치가 통째로 바뀐다.
    L3_PROPS.forEach((p, i) => expect(p.role).toBe(i));
  });

  it('방어 보스 카탈로그 순서 골든', () => {
    expect(DEFENSE_BOSSES.map((b) => b.id)).toEqual([
      'steelGoliath',
      'sporeQueen',
      'phaseWarden',
    ]);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 시드 램프 드리프트 가드 + 풀 카탈로그 노출
// ---------------------------------------------------------------------------

describe('시드 재조정 — SQL 정본과의 정합', () => {
  it('마이그레이션 헤더의 RAMP 식이 이 파일의 미러와 일치한다', () => {
    const sql = readMigrationSql();
    for (const line of RAMP_SQL_LINES) {
      expect(sql, `SQL 램프 주석이 미러와 다르다: ${line}`).toContain(line);
    }
  });

  it('마이그레이션이 NPC 고정 UUID 20행만 건드린다', () => {
    const sql = readMigrationSql();
    // WHERE 절이 고정 UUID 동등 비교 하나뿐이어야 실유저 방어가 안전하다.
    expect(sql).toContain("where id = v_def_id");
    expect(sql).toContain("'000000de-f000-4000-8000-'");
    expect(sql).not.toMatch(/update\s+public\.defenses[\s\S]{0,400}?where\s+true/i);
  });

  it('20기지가 시드 램프 목표 카탈로그를 전부 노출한다(미사용 시드 콘텐츠 0)', () => {
    const formations = new Set<number>();
    const facilities = new Set<number>();
    const props = new Set<number>();
    const bosses = new Set<number>();
    for (let nn = 1; nn <= SEED_BASE_COUNT; nn++) {
      const l = seedBaseLayers(nn);
      for (const s of l.l1.waveSlots) if (s !== null) formations.add(s.catalogId);
      for (const s of l.l2.sockets) if (s !== null) facilities.add(s.catalogId);
      for (const s of l.l3.props) if (s !== null) props.add(s.catalogId);
      if (l.l3.boss !== null) bosses.add(l.l3.boss.catalogId);
    }
    // 시드 램프(RAMP)가 **목표로 하는** 카탈로그 대역을 빠짐없이 노출하는지 본다(대역 안에
    // 구멍이 있으면 그 콘텐츠는 NPC 기지에서 영영 안 보인다). 대역 상한은 램프에서 파생한다
    // (하드코딩 금지) — 편대·설비는 램프 상한까지, 기물·보스는 전량이다.
    //
    // ⚠️ Lane9 신규 방어체(편대 8~11 · 설비 9~16)는 램프 대역 **밖**이다: 톡사르·크라스
    // 특산 설계도라 획득 경로가 **행성 파밍**이고, 그 도달은 tests/planetDrops.test.ts ③·⑥ 이
    // 보장한다(미사용 콘텐츠 0 은 전역적으로 여전히 성립 — 죽은 콘텐츠가 아니다). NPC 시드
    // 기지 노출까지 넓히는 것은 서버 시드 램프(20260723000000_m7c_seed_rebalance.sql) 수정 +
    // 클리어율 밴드 재측정을 동반하는 별도 밸런스 패스 소관이다(defer-balance-tuning).
    const seedFormationKinds = Math.max(
      ...Array.from({ length: SEED_BASE_COUNT }, (_, i) => RAMP.formationKinds(i + 1)),
    );
    const seedFacilityKinds = Math.max(
      ...Array.from({ length: SEED_BASE_COUNT }, (_, i) => RAMP.facilityKinds(i + 1)),
    );
    expect([...formations].sort((a, b) => a - b)).toEqual(
      Array.from({ length: seedFormationKinds }, (_, i) => i),
    );
    expect([...facilities].sort((a, b) => a - b)).toEqual(
      Array.from({ length: seedFacilityKinds }, (_, i) => i),
    );
    expect([...props].sort((a, b) => a - b)).toEqual(L3_PROPS.map((_, i) => i));
    expect([...bosses].sort((a, b) => a - b)).toEqual(DEFENSE_BOSSES.map((_, i) => i));
    // 시드가 참조하는 편대·설비 id 는 전부 실재 카탈로그다(댕글링 시드 0).
    for (const id of formations) expect(FORMATIONS[id]).toBeDefined();
    for (const id of facilities) expect(INVASION_FACILITIES[id]).toBeDefined();
  });

  it('시드 배치가 전부 정규형이다(정규화 멱등)', () => {
    for (let nn = 1; nn <= SEED_BASE_COUNT; nn++) {
      const l = seedBaseLayers(nn);
      expect(normalizeInvasionLayers(l)).toEqual(l);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑥ seedBases 구조 회귀 0 (설명 재작성이 구조를 건드리지 않았는지)
// ---------------------------------------------------------------------------

describe('seedBases — 재조정이 구조를 건드리지 않았다', () => {
  it('개수 20 · UUID 스킴 · 밴드 분포 7/7/6 유지', () => {
    expect(SEED_BASES.length).toBe(20);
    SEED_BASES.forEach((b, i) => {
      expect(b.order).toBe(i + 1);
      expect(b.profileId).toBe(seedBaseUuid(i + 1));
    });
    const counts = { 하위: 0, 중하: 0, 중위: 0 };
    for (const b of SEED_BASES) counts[b.difficultyBand]++;
    expect(counts).toEqual({ 하위: 7, 중하: 7, 중위: 6 });
  });

  it('설명은 전부 비어 있지 않고 이모지를 담지 않는다', () => {
    // 정찰 뷰가 Pixi 라 컬러 이모지는 두부로 렌더된다.
    for (const b of SEED_BASES) {
      expect(b.description.length).toBeGreaterThan(10);
      expect(b.description).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

// ---------------------------------------------------------------------------
// ⑦ 로스터 간섭 회귀 게이트 — 침공은 기체 로스터와 한 배를 탄다
// ---------------------------------------------------------------------------

/**
 * ## 이 블록이 막는 것
 * 위 19건은 전부 `GEAR_REFERENCE` 리터럴만 쓰고 `config.shipType` 을 세우지 않는다. 그래서
 * 사실상 **스트라이커(signatureBit −1) 고정 · `rangeAdd 0`** 한 조합만 잰다. 그런데 로스터는
 * 침공 런에 네 갈래로 새어 들어온다 — 코드로 확인한 경로다:
 *   ① `src/run/runConfig.ts` 의 `buildRunConfig` 가 PvE·정식 침공·하네스 침공의 **단일 정본**
 *      이고, `applyShipTypeBase`(`src/items/loadout.ts:202`)로 섀시 `baseBp` 4축이 침공 런에도
 *      그대로 실린다.
 *   ② `src/sim/world.ts` 의 로드아웃 적용부에 침공 분기가 없다 — PvE 와 같은 코드를 탄다.
 *   ③ `isPlayerTargetable` 이 `facilityGun`·`defenseBoss`·`prop`·`core` 를 포함하므로
 *      `weapon.range`(= 로스터의 range 노드·`rangeAdd`)가 **침공 조준 거리도** 좁힌다.
 *   ④ `signatureOn`(`src/sim/world.ts`) → SIG_* 6종이 침공 게이트 없이 발동한다.
 *
 * ## 이 게이트가 실제로 커버하는 범위 (측정으로 확인한 사실만 적는다)
 * 게이트 런은 {@link rosterGateConfig} 로 **정규 경로 전량**을 탄다 —
 * `Profile` → `buildRunConfig` → `computeLoadoutStats(..., typeId)` → `applyShipTypeBase`.
 *   - ① **커버**. `data/ships/<slug>.ts` 의 `baseBp` 를 극단으로 변조하면 이 게이트가 깨진다
 *     (아래 "감도 실증" 참고). 리터럴 로드아웃을 꽂던 이전 판은 이 사슬을 통째로 우회해
 *     **baseBp 를 −9000 으로 만들어도 통과**했다.
 *   - ② **커버**(①이 만든 로드아웃이 `weapon.damage`/`fireCooldown`/`playerHp`/`playerSpeed`
 *     로 착지하는 것이 승률에 그대로 나타난다).
 *   - ③ **부분 커버**. 게이트가 싣는 `rangeAdd 460` 은 장비 어픽스(`rangeFlat`)에서 온다.
 *     `lo.rangeAdd` → `weapon.range` → `isPlayerTargetable` 구간은 이걸로 실제로 탄다.
 *     **미커버: 스킬트리 노드가 주는 `rangeFlat`** — 게이트는 **무투자** 벡터를 싣는다.
 *     투자를 실으면 기체 간 격차가 아니라 트리 총량이 승률을 지배해 baseBp 회귀 신호가
 *     묻히므로 일부러 무투자로 고정했다. 트리 rangeFlat 회귀는 `tests/skills.test.ts`
 *     계열이 맡는다.
 *   - ④ **커버**. `buildRunConfig` 가 `shipType` 을 항상 명시하고 시그니처 비트를
 *     `loadout.uniqueMask` 에 OR 한다.
 *
 * ## 왜 하필 이 조합인가
 * - `rangeAdd = 460` 은 `src/sim/autopilot.ts` 의 `KITE_DISTANCE` 와 같은 값이다. 참조봇이
 *   유지하려는 거리와 사거리가 정확히 겹치는 **임계점**이라, range 축이 조금만 흔들려도
 *   조준 성공/실패가 갈린다 — 로스터 range 변경에 가장 민감한 지점이다.
 * - 기지 **두 곳**을 쓴다. 한 곳으로는 **양방향 감도가 안 나온다** — 실증한 사실이다.
 *
 * ## 기지·폭 선정 — 전량 재실측 (2026-07-21)
 * 아래 값은 **이 트리에서 그대로 재현되는 실측**이다. 게이트를 통과시키려고 폭을 넓힌 것이
 * 아니라, 전 기지를 재고 **담당 방향별로 기지를 골랐다**.
 * 재현법: 기지 nn × 비-스트라이커 6기체 × `BALANCE_SEEDS` 12시드를 {@link rosterGateRate}
 * 로 돌린다(정규 경로 · `rangeAdd 460` · 무투자).
 *
 * 실측 — 기체 1(브루저)~6 순, 괄호는 (min~max, 폭):
 *     #9  = 66.7/41.7/58.3/100.0/83.3/66.7   (41.7~100.0, 58.3pp)
 *     #10 = 75.0/75.0/41.7/100.0/91.7/66.7   (41.7~100.0, 58.3pp)
 *     #11 = 66.7/50.0/66.7/83.3/50.0/66.7    (50.0~83.3, 33.3pp)
 *     #12 = 58.3/50.0/50.0/75.0/50.0/58.3    (50.0~75.0, 25.0pp) ← 전 기지 중 **가장 좁다**
 *     #13 = 58.3/41.7/58.3/83.3/75.0/50.0    (41.7~83.3, 41.7pp)
 *     #14 = 50.0/25.0/83.3/33.3/50.0/41.7    (25.0~83.3, 58.3pp)
 *     #15 = 41.7/50.0/33.3/50.0/66.7/33.3    (33.3~66.7, 33.3pp)
 *     #16 = 50.0/33.3/25.0/33.3/58.3/33.3    (25.0~58.3, 33.3pp) ← **천장이 가장 낮다**
 *     #17 = 41.7/16.7/58.3/33.3/83.3/58.3    (16.7~83.3, 66.7pp)
 *     #18 = 50.0/41.7/41.7/16.7/100.0/100.0  (16.7~100.0, 83.3pp)
 *     #19 = 100.0/91.7/25.0/58.3/100.0/100.0 (25.0~100.0, 75.0pp)
 *     #20 = 8.3/83.3/50.0/8.3/50.0/16.7      (8.3~83.3, 75.0pp)
 *
 * - **#12 = 하한 담당.** 바닥이 50.0% 로 높고 폭이 25.0pp(3눈금)로 전 기지 중 가장 좁다 —
 *   아래쪽 여유가 최대다. 상향은 여기서 안 잡힌다: `+20000` 변조에서 기체 1 이 58.3 → 75.0
 *   으로 오르는데 **기저 최대(기체 4)가 이미 75.0** 이라 어떤 hi 도 둘을 가르지 못한다.
 * - **#16 = 상한 담당.** 천장이 58.3% 로 전 기지 중 가장 낮은데 `+20000` 변조는 기체 1 을
 *   75.0% 로 올린다 — 분리 폭 16.7pp(2눈금)로 **전 기지 중 유일하게 상향이 분리된다**
 *   (#15 는 8.3pp, 나머지는 기저 최대가 83.3% 이상이라 분리 0).
 * - 폭(12시드의 최소 눈금은 8.33pp):
 *     #12 lo 20 — 기저 최소 50.0 에서 아래로 30.0pp(3.6눈금). 통상 ±2눈금 튜닝은 통과한다.
 *     #12 hi 95 — 기저 최대 75.0 에서 위로 20.0pp. 담당 방향이 아니라 느슨한 안전망이다.
 *     #16 hi 70 — 기저 최대 58.3 과 변조값 75.0 **사이**다. 이 구간에 놓인 실현 가능한 값은
 *                 66.7(8/12) 하나뿐이므로 **위쪽 여유는 정확히 1눈금**이고, 그것이 이 sim 에서
 *                 확보 가능한 최대다(변조가 75.0 에서 포화한다). 여기만 ±2눈금 여유가 없다 —
 *                 대신 하한 담당(#12)이 3.6눈금을 갖는다.
 *     #16 lo  5 — 기저 최소 25.0 에서 아래로 20.0pp(2.4눈금). 담당 방향이 아니므로 **"전 시드
 *                 패배"에 가까운 선**으로 둔다.
 *
 * ## 감도 실증 (2026-07-21, 위 실측과 같은 트리에서 수행하고 원복)
 * `data/ships/bruiser.ts` 의 `baseBp` 4축을 통째로 바꾼 뒤 게이트를 돌렸다.
 *   `{-9000,-9000,-9000,-9000}` : #12 기체 1 = **0.0%**  → lo 20 위반 → 실패
 *                                 (#11·#15·#16 도 전부 0.0% 로 죽는다)
 *   `{20000,20000,20000,20000}` : #16 기체 1 = **75.0%** → hi 70 위반 → 실패
 *                                 (같은 변조에서 #11 66.7→75.0 · #12 58.3→75.0 · #15 41.7→75.0)
 * 두 변조 모두 기체 2~6 열은 값이 그대로였다 — 하네스가 변조 기체만 격리해 잰다는 증거다.
 * 원복 후 전 기지·전 기체 그린.
 */
const ROSTER_GATE_RANGE_ADD = 460;

/** 로스터 게이트가 도는 기지와 그 기지에서의 허용 폭. 위 주석의 실측이 근거다. */
const ROSTER_GATE_BASES = [
  { nn: 12, lo: 20, hi: 95, band: '50.0~75.0' },
  { nn: 16, lo: 5, hi: 70, band: '25.0~58.3' },
] as const;

/** 스트라이커(0)를 뺀 나머지 전 기체. 카탈로그에서 유도한다 — 개수를 손으로 적지 않는다. */
const NON_STRIKER_SHIP_TYPES: readonly number[] = SHIP_TYPES.map((_, i) => i).filter((i) => i > 0);

function rosterGateRate(shipType: number, nn: number): number {
  const layers = seedBaseLayers(nn);
  let wins = 0;
  for (const seed of BALANCE_SEEDS) {
    const o = playRun(seed, layers, { shipType, rangeAdd: ROSTER_GATE_RANGE_ADD });
    if (o.win) wins++;
  }
  return (wins / BALANCE_SEEDS.length) * 100;
}

/** (기체, 기지 순번) 전 조합. 개수를 손으로 적지 않는다. */
const ROSTER_GATE_CASES = NON_STRIKER_SHIP_TYPES.flatMap((shipType) =>
  ROSTER_GATE_BASES.map((b) => [shipType, b.nn] as [number, number]),
);

function rosterGateBase(nn: number): (typeof ROSTER_GATE_BASES)[number] {
  const b = ROSTER_GATE_BASES.find((x) => x.nn === nn);
  if (b === undefined) throw new Error(`로스터 게이트 기지 정의 없음: #${nn}`);
  return b;
}

describe('로스터 간섭 게이트 — 비-스트라이커 기체로도 침공이 성립한다', () => {
  it('스트라이커가 typeId 0 이고 나머지 기체가 존재한다', () => {
    // 아래 게이트의 전제. 카탈로그가 재정렬되면 게이트가 엉뚱한 기체를 재게 된다.
    expect(SHIP_TYPES[0]?.id).toBe(0);
    expect(NON_STRIKER_SHIP_TYPES.length).toBeGreaterThan(0);
    expect(NON_STRIKER_SHIP_TYPES).not.toContain(0);
  });

  it.each(ROSTER_GATE_CASES)(
    '기체 %i 이 기지 #%i(사거리 임계)에서 0%%도 100%%도 아니다',
    (shipType, nn) => {
      const base = rosterGateBase(nn);
      const rate = rosterGateRate(shipType, nn);
      const msg = `기체 ${shipType} · 기지 #${base.nn} 클리어율 ${rate.toFixed(1)}% (실측 밴드 ${base.band}%)`;
      expect(rate, msg).toBeGreaterThanOrEqual(base.lo);
      expect(rate, msg).toBeLessThanOrEqual(base.hi);
    },
  );
});
