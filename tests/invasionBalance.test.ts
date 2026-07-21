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
 * 실측: 24시드 96.4% / 74.4% / 31.3% · 아래 12시드 부분집합 97.6% / 73.8% / 26.4%.
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

function playRun(seed: number, layers: InvasionLayers): RunOutcome {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
  config.loadout = GEAR_REFERENCE;
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
    const limits: Record<keyof typeof BANDS, number> = { 하위: 20, 중하: 28, 중위: 28 };
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
    // 시드 37 은 #20 이 L3 까지 도달해 승리하는 것으로 확인된 값이다(패배 시드로 재면
    // 플레이어가 L3 전에 죽어 "보스가 없다"가 오탐이 된다).
    const layers = seedBaseLayers(20);
    const config = { ...DEFAULT_CONFIG } as WorldConfig;
    config.invasion3 = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
    config.loadout = GEAR_REFERENCE;
    const state = createWorld(37, config);
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

  it('20기지가 풀 카탈로그를 전부 노출한다(미사용 콘텐츠 0)', () => {
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
    expect([...formations].sort((a, b) => a - b)).toEqual(FORMATIONS.map((_, i) => i));
    expect([...facilities].sort((a, b) => a - b)).toEqual(INVASION_FACILITIES.map((_, i) => i));
    expect([...props].sort((a, b) => a - b)).toEqual(L3_PROPS.map((_, i) => i));
    expect([...bosses].sort((a, b) => a - b)).toEqual(DEFENSE_BOSSES.map((_, i) => i));
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
