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
import {
  INVASION_L1_TICKS,
  INVASION_TOTAL_TICKS,
  normalizeInvasionLayers,
} from '../sim/invasion/index.js';
import type { InvasionLayers } from '../sim/invasion/index.js';
import { INVASION_SOCKET_COUNTS } from '../sim/invasion/constants.js';
import { emptyInvasionLayers } from '../sim/invasion/normalize.js';
import { SHIP_TYPES, zeroSkillInvest } from '../../data/ships/index.js';
import {
  INVASION_DEFENSE_CORE_HP_BP_DEFAULT,
  INVASION_DEFENSE_DAMAGE_BP_DEFAULT,
  INVASION_DEFENSE_HP_BP_DEFAULT,
  INVASION_GARRISON_LEVEL_DEFAULT,
} from '../../data/invasion/garrison.js';
import { INVASION_DENSITY_DEFAULT } from '../sim/invasion/density.js';
import { buildRunConfig } from '../run/runConfig.js';
import { buildPreset } from '../harness/presets.js';
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
 * 재시드 마이그레이션의 시드 생성 규칙 미러. **정본은 SQL 이고 이건 사본이다**
 * (현행 `supabase/migrations/20260810010000_invasion_ramp_reanchor.sql`).
 * 사본이 조용히 갈라지면 계측이 원격 DB 와 무관한 숫자가 되므로,
 * `tests/invasionBalance.test.ts` 의 드리프트 가드가 SQL 안의 `-- RAMP:` 주석과 문자열로
 * 대조한다(그 대조는 봇 실력에 의존하지 않으므로 테스트로 남았다).
 *
 * ## 값이 어디에 앵커돼 있는가 (2026-08-10 재앵커 — 왜 이 숫자인지)
 * - `waves = 6` — **빈 슬롯은 기본 수비대가 Lv75 로 채운다.** 안 채우면 램프가 난이도를 못
 *   갖는 정도가 아니라 **감산기**가 된다(약한 배치가 강한 충원을 밀어낸다). 줄이지 마라.
 * - `level = 20 + 17(nn-1)/4` — 두 앵커: **#14 = 75**(= `INVASION_GARRISON_LEVEL_DEFAULT`,
 *   빈 방어와 등가) · **#20 = 100**(레벨축 포화점. 실측 Lv100·150·200 이 전부 같은 값이다).
 * - `rarity` 개시가 nn8 인 것 — 하위 밴드를 **순수 레벨 램프**로 두기 위해서다. nn5 에서
 *   등급 1 이 들어오면 레벨 계단이 통째로 덮인다(실측 #4→#5 생존틱 역전).
 * 근거·실측표는 위 마이그레이션 헤더가 정본이다.
 */
export const RAMP = {
  level: (nn: number) => 20 + Math.floor((17 * (nn - 1)) / 4),
  rarity: (nn: number) => (nn <= 7 ? 0 : nn <= 11 ? 1 : nn <= 15 ? 2 : 3),
  ascension: (nn: number) => (nn <= 7 ? 0 : 1),
  template: (nn: number) => (nn <= 7 ? 0 : nn <= 14 ? 2 : 1),
  waves: (_nn: number) => 6,
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
  /**
   * 도달한 최고 페이즈(0=L1 · 1=L2 · 2=L3). **승률이 0 이나 100 으로 포화했을 때 유일하게 남는
   * 눈금**이라 별도로 남긴다 — 램프가 만드는 난이도 계단을 승률로 못 읽는 상황이 실제로 왔다
   * (2026-08-10 `live`/`maxed` 무대에서 20기지 전부 0%).
   */
  readonly phaseMax: number;
  /**
   * 종료 시점 코어 잔여 내구도(%, 0..100). L3 에 못 갔으면 100. 승리면 0.
   * 페이즈보다 잘게 갈리는 진행 눈금이다.
   */
  readonly coreRemainPct: number;
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
  stage: BenchStage = 'legacy',
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
    invasion3: invasion3For(layers, stage),
  });
}

// ---------------------------------------------------------------------------
// 계측 무대 — 「어느 기준선 위에서 · 어떤 화력으로」 재는가
// ---------------------------------------------------------------------------

/**
 * 실 침공 런의 밸런스 기본값. **여기서 값을 새로 적지 않는다** — 런 조립 층
 * (`src/main.ts` 침공 진입 두 경로)이 싣는 것과 **같은 정본 상수**를 가리킨다.
 *
 * ⚠️ sim 정규화 기본은 중립이다(`INVASION_DENSITY_LEGACY` · `GARRISON_LEVEL`=1) — 그래서
 * `DEFAULT_CONFIG` 로 만든 침공 config 는 **2026-08-10 밸런스 이전의 무대**다. 이 상수를
 * 명시적으로 싣지 않으면 이 벤치는 실제 서비스와 무관한 숫자를 낸다.
 */
export const INVASION_LIVE_BALANCE = {
  garrisonLevel: INVASION_GARRISON_LEVEL_DEFAULT,
  defenseHpBp: INVASION_DEFENSE_HP_BP_DEFAULT,
  defenseDamageBp: INVASION_DEFENSE_DAMAGE_BP_DEFAULT,
  defenseCoreHpBp: INVASION_DEFENSE_CORE_HP_BP_DEFAULT,
  density: INVASION_DENSITY_DEFAULT,
} as const;

/**
 * 계측 무대(방어측).
 *  - `live`   실 침공 런과 같다({@link INVASION_LIVE_BALANCE}). **밸런스 판단은 이쪽으로만.**
 *  - `legacy` 중립 sim 기본값(밀도 끔 · 수비대 Lv1 · 방어 배율 1배). 2026-08-10 이전 무대이며
 *             과거 세대 수치와 대조할 때만 쓴다.
 */
export type BenchStage = 'live' | 'legacy';

/**
 * 계측 화력(공격측).
 *  - `maxed`     하네스 `maxed` 프리셋 = Lv100 기체 + 풀 장비 + 스킬 만투. **사용자의 기준선**이
 *                만렙 플레이라 밸런스 판단은 이쪽이다.
 *  - `reference` 리터럴 {@link GEAR_REFERENCE}(무장 Lv1). 과거 세대 수치와의 대조 전용.
 *
 * ⚠️ 둘의 차이는 자릿수다(코어 DPS 실측 122 vs 약 19,000). 섞어 읽지 마라.
 */
export type BenchGear = 'maxed' | 'reference';

export interface BenchSetup {
  readonly stage: BenchStage;
  readonly gear: BenchGear;
}

/** 과거 세대 수치를 재현하는 무대(2026-08-10 이전). */
export const SETUP_LEGACY: BenchSetup = { stage: 'legacy', gear: 'reference' };
/** 현행 무대 — 실 침공 기본값 × 만렙 빌드. */
export const SETUP_LIVE: BenchSetup = { stage: 'live', gear: 'maxed' };

/** 무대에 맞는 `Invasion3Config` 를 만든다. `legacy` 는 밸런스 필드를 아예 안 싣는다. */
function invasion3For(layers: InvasionLayers, stage: BenchStage) {
  const base = { layers, timeLimitTicks: INVASION_TOTAL_TICKS, maintenance: 10000 };
  return stage === 'legacy' ? base : { ...base, ...INVASION_LIVE_BALANCE };
}

/** 리터럴 로드아웃 경로의 침공 `WorldConfig`(밴드 계측 · 배선 증명 공용). */
export function invasionConfig(
  layers: InvasionLayers,
  loadout: LoadoutConfig,
  stage: BenchStage = 'legacy',
): WorldConfig {
  const config = { ...DEFAULT_CONFIG } as WorldConfig;
  config.invasion3 = invasion3For(layers, stage);
  config.loadout = loadout;
  return config;
}

/**
 * 만렙 프리셋의 침공 `WorldConfig` — 정규 경로 전량을 탄다
 * (`buildPreset('maxed')` → `buildRunConfig` → `computeLoadoutStats(..., pilotLevel=100)`).
 * 프리셋은 순수 결정론이라 같은 무대는 항상 같은 바이트를 낸다.
 */
export function maxedConfig(layers: InvasionLayers, stage: BenchStage): WorldConfig {
  return buildRunConfig(buildPreset('maxed'), {
    planet: 0,
    stage: 1,
    invasion3: invasion3For(layers, stage),
  });
}

export function playRun(
  seed: number,
  layers: InvasionLayers,
  /** 로스터 게이트 전용 덮어쓰기. 미지정이면 {@link BenchSetup} 의 `gear` 를 따른다. */
  over?: { readonly shipType: number; readonly rangeAdd: number },
  setup: BenchSetup = SETUP_LEGACY,
): RunOutcome {
  const config =
    over !== undefined
      ? rosterGateConfig(layers, over, setup.stage)
      : setup.gear === 'maxed'
        ? maxedConfig(layers, setup.stage)
        : invasionConfig(layers, GEAR_REFERENCE, setup.stage);
  const state = createWorld(seed, config);
  let phaseMax = 0;
  // 코어는 L3 에서 태어나고 파괴되면 엔티티가 사라진다 — 매 틱 훑어 **최소 잔량**을 기억한다.
  // 종료 시점만 보면 "부수기 직전까지 갔다"와 "코어를 본 적도 없다"가 둘 다 100 으로 접힌다.
  let coreRemainPct = 100;
  for (let t = 0; t < INVASION_TOTAL_TICKS; t++) {
    stepWorld(state, autopilotInput(state));
    const phase = state.invasion3?.phase ?? 0;
    if (phase > phaseMax) phaseMax = phase;
    if (phase === 2) {
      for (const e of state.entities) {
        if (e.kind !== 'core' || e.dead || e.maxHp <= 0) continue;
        const pct = Math.max(0, Math.round((e.hp * 100) / e.maxHp));
        if (pct < coreRemainPct) coreRemainPct = pct;
      }
    }
    if (state.gameOver || state.victory) {
      return {
        win: state.victory,
        ticks: t + 1,
        reachedL3: phaseMax >= 2,
        phaseMax,
        coreRemainPct: state.victory ? 0 : coreRemainPct,
      };
    }
  }
  return {
    win: false,
    ticks: INVASION_TOTAL_TICKS,
    reachedL3: phaseMax >= 2,
    phaseMax,
    coreRemainPct,
  };
}

export interface BandStat {
  readonly winRate: number;
  /** 기지별 승률(퍼센트) — 밴드 안 난이도 분산 지표. */
  readonly perBaseRates: number[];
  /** 기지별 평균 클리어틱(승리 표본이 있는 기지만). */
  readonly perBaseMeanTicks: number[];
  /**
   * 기지별 **진행 점수**(0..100). 승률이 포화해도 안 포화하는 눈금이다 — 정의는
   * {@link runProgress}. 램프가 만드는 계단이 승률로 안 보일 때 이 값의 **순서**를 읽는다.
   */
  readonly perBaseProgress: number[];
  /** 기지별 L3 도달률(%). */
  readonly perBaseL3Rate: number[];
  /** 기지별 평균 **생존틱**(승패 무관 전 런). L1 에서 전멸하는 무대의 유일한 눈금이다. */
  readonly perBaseMeanRunTicks: number[];
}

/**
 * 한 런의 진행 점수(0..100) — **바닥에서도 눈금이 살아 있게** 설계했다.
 *
 *   L1 에서 전멸 → `min(39, ticks × 40 / INVASION_L1_TICKS)`  (L1 예산 대비 버틴 비율)
 *   L2 도달      → 40 + (미도달분 없음)
 *   L3 도달      → 80 + 코어를 깎은 비율 × 20 (코어 파괴 = 100)
 *
 * ⚠️ 가운데 구간(L1 전멸 39 → L2 도달 40)이 계단이다. 이건 의도다 — 레이어 전이는 실제로
 * 이산 사건이고, 그걸 매끄럽게 보간하면 "L2 를 봤는가"라는 유일하게 분명한 사실이 흐려진다.
 */
export function runProgress(o: RunOutcome): number {
  if (o.phaseMax === 0) {
    return Math.min(39, Math.round((o.ticks * 40) / INVASION_L1_TICKS));
  }
  if (o.phaseMax === 1) return 40;
  return 80 + Math.round(((100 - o.coreRemainPct) * 20) / 100);
}

export function measureBand(
  orders: readonly number[],
  seeds: readonly number[] = BALANCE_SEEDS,
  setup: BenchSetup = SETUP_LEGACY,
): BandStat {
  return measureBandLayers(orders.map(seedBaseLayers), seeds, setup);
}

/** {@link measureBand} 의 배치 직접 지정판(바닥 기준선처럼 nn 이 없는 배치를 잴 때 쓴다). */
export function measureBandLayers(
  layersList: readonly InvasionLayers[],
  seeds: readonly number[] = BALANCE_SEEDS,
  setup: BenchSetup = SETUP_LEGACY,
): BandStat {
  let wins = 0;
  let total = 0;
  const perBaseRates: number[] = [];
  const perBaseMeanTicks: number[] = [];
  const perBaseProgress: number[] = [];
  const perBaseL3Rate: number[] = [];
  const perBaseMeanRunTicks: number[] = [];
  for (const layers of layersList) {
    let bw = 0;
    let bl3 = 0;
    let prog = 0;
    let runTicks = 0;
    const ticks: number[] = [];
    for (const seed of seeds) {
      const o = playRun(seed, layers, undefined, setup);
      total++;
      prog += runProgress(o);
      runTicks += o.ticks;
      if (o.reachedL3) bl3++;
      if (o.win) {
        wins++;
        bw++;
        ticks.push(o.ticks);
      }
    }
    perBaseRates.push((bw / seeds.length) * 100);
    perBaseProgress.push(prog / seeds.length);
    perBaseL3Rate.push((bl3 / seeds.length) * 100);
    perBaseMeanRunTicks.push(runTicks / seeds.length);
    if (ticks.length > 0) {
      perBaseMeanTicks.push(ticks.reduce((a, b) => a + b, 0) / ticks.length);
    }
  }
  return {
    winRate: (wins / total) * 100,
    perBaseRates,
    perBaseMeanTicks,
    perBaseProgress,
    perBaseL3Rate,
    perBaseMeanRunTicks,
  };
}

/**
 * **바닥 기준선** — 아무것도 배치 안 한 방어(기본 수비대만)를 같은 시드로 잰다.
 *
 * 이 줄이 없으면 기지별 수치를 읽을 수 없다. 2026-08-10 무대에서 실제로 겪은 것:
 * 하위 밴드 기지 여럿이 **빈 방어보다 오래 버텼다**(#6 1546틱 vs 빈 방어 1090틱). 즉 그
 * 밴드에서 램프가 만드는 난이도 기여가 바닥의 분산에 묻혀 있었다는 뜻인데, 바닥을 안 재면
 * 그 사실이 "하위 기지는 쉽다"로 잘못 읽힌다.
 */
export function measureFloor(
  seeds: readonly number[] = BALANCE_SEEDS,
  setup: BenchSetup = SETUP_LEGACY,
): BandStat {
  return measureBandLayers([emptyInvasionLayers()], seeds, setup);
}

/**
 * 96시드 승격 판정 — 그 기지가 24+72 시드 안에서 **한 번이라도** 이기는가(0/1).
 * 첫 승리에서 즉시 끊어 비용을 최소화한다.
 */
export function escalatedWinRate(nn: number, setup: BenchSetup = SETUP_LEGACY): number {
  const layers = seedBaseLayers(nn);
  let wins = 0;
  for (const seed of [...BALANCE_SEEDS, ...BALANCE_SEEDS_ESCALATION]) {
    if (playRun(seed, layers, undefined, setup).win) {
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
  setup: BenchSetup = SETUP_LEGACY,
): number {
  const layers = seedBaseLayers(nn);
  let wins = 0;
  for (const seed of seeds) {
    const o = playRun(seed, layers, { shipType, rangeAdd: ROSTER_GATE_RANGE_ADD }, setup);
    if (o.win) wins++;
  }
  return (wins / seeds.length) * 100;
}
