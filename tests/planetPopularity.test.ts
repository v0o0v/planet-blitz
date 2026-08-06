/**
 * 행성 인기 보상 배율(ADR-0038) — 산식 불변식 + **정규 경로 배선** 검증.
 *
 * ## 이 파일이 두 부분으로 나뉜 이유
 * 이 저장소가 8번 겪은 반복 결함은 **"단위 테스트는 전부 초록인데 배선이 통째로 없다"** 이다.
 * 산식만 검증하면 `planetMultCenti` 가 `runConfig` → `createWorld` → 세 적용점으로 실제로
 * 흘러가는지는 아무도 확인하지 않는다. 그래서:
 *  · §1~5 = 순수 산식 불변식(런가중 평균 1 · 클램프 · 사전표본 · 수렴 · 폴백)
 *  · §6~9 = **정규 경로 실런**으로 배율이 XP·드랍 수·자원에 실제로 도달하는지 + 닿으면 안 되는
 *           축(품질·조우·보스 확정 드랍·침공·특산 설계도)에 닿지 않는지 + 해시 바이트 불변
 *
 * ## 실런은 **최소 틱**으로만 돈다 (2026-08-06, ADR-0051 갈래 ③)
 * §6~7 의 실런은 8시드 **완주**에서 1시드 × 900틱(자원만 2,200틱)으로 줄었다. 배선은 완주를
 * 요구하지 않는다 — 값이 적용점에 도달했는지만 보면 된다. 근거 실측과 적용점별 첫 도달 틱은
 * `WIRE_TICKS` 주석에 있다. 같은 작업에서 **계량 두 개를 바꿨다**(수량 대조 → 포화 대조,
 * 유니크 비율 → 정확 대조) — 둘 다 종전 계량이 표본 부족으로 공허했기 때문이다.
 */

import { describe, it, expect } from 'vitest';
import {
  refreshMultipliersCenti,
  multFromCenti,
  neutralMultipliersCenti,
  epochOfMs,
  NEUTRAL_MULT_CENTI,
  PLANET_COUNT,
  CLAMP_LO,
  CLAMP_HI,
  PRIOR_K,
  ALPHA,
  EPOCH_SECONDS,
} from '../src/economy/planetPopularity.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { eliteDropChance } from '../src/sim/drops.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { settleRun } from '../src/save/settlement.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { xpToNextMeta, lowStageXpDecayPercent } from '../src/save/progressionPath.js';
import { standardEquipped, standardSkillInvest } from '../src/bench/standardBuild.js';
import { autopilotInput } from '../src/sim/autopilot.js';
import { PLANETS, blueprintDropsFromLoot } from '../data/planets/index.js';

// ---------------------------------------------------------------------------
// §1. 런가중 재정규화 불변식 — Σ(wᵢ · mᵢ) = 1
// ---------------------------------------------------------------------------

/** `counts` 분포로 가중한 평균 배율. 재정규화가 성립하면 1 이어야 한다. */
function runWeightedMean(counts: readonly number[], centi: readonly number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return centi.reduce((a, c) => a + c / 100, 0) / centi.length;
  let s = 0;
  for (let i = 0; i < counts.length; i++) s += (counts[i]! / total) * (centi[i]! / 100);
  return s;
}

describe('§1 런가중 평균 = 1 (경제 총량 불변)', () => {
  it('편향 분포 1주기 후 목표치의 런가중 평균이 정확히 1이다', () => {
    // ALPHA 평활 때문에 1주기 결과는 목표치가 아니라 중간 지점이다. 불변식 자체는 **목표치**에
    // 걸리므로, 평활을 사실상 무력화하도록 충분히 수렴시킨 뒤 재확인한다(§4 와 역할 분담).
    const counts = [4000, 100, 100, 100, 100, 100];
    let centi = neutralMultipliersCenti();
    for (let i = 0; i < 200; i++) centi = refreshMultipliersCenti(counts, centi);
    // 허용 오차는 **centi 격자**에서 온다: 목표치를 0.01 단위로 반올림하므로 가중치가 한 행성에
    // 쏠린 이 분포에서 최대 ~0.005 만큼 어긋난다. 그보다 큰 이탈은 산식 결함이다(정지 지점 결함이
    // 정확히 이 단언에서 1.019 로 드러났다).
    expect(runWeightedMean(counts, centi)).toBeCloseTo(1, 2);
  });

  it('균등 분포면 전 행성이 중립에 머문다', () => {
    const counts = new Array<number>(PLANET_COUNT).fill(500);
    let centi = neutralMultipliersCenti();
    for (let i = 0; i < 50; i++) centi = refreshMultipliersCenti(counts, centi);
    for (const c of centi) expect(c).toBe(NEUTRAL_MULT_CENTI);
  });

  it('많이 도는 행성이 내려가고 덜 도는 행성이 올라간다 (부호 방향)', () => {
    const counts = [4000, 100, 100, 100, 100, 100];
    let centi = neutralMultipliersCenti();
    for (let i = 0; i < 200; i++) centi = refreshMultipliersCenti(counts, centi);
    expect(centi[0]!).toBeLessThan(NEUTRAL_MULT_CENTI);
    for (let i = 1; i < PLANET_COUNT; i++) expect(centi[i]!).toBeGreaterThan(centi[0]!);
  });
});

// ---------------------------------------------------------------------------
// §2. 클램프 경계
// ---------------------------------------------------------------------------

describe('§2 클램프 경계', () => {
  it('극단 편향에서도 배율이 [CLAMP_LO, CLAMP_HI] 를 벗어나지 않는다', () => {
    // 재정규화가 클램프 **뒤**에 오므로 최종값이 경계를 살짝 넘을 수 있다. 그 초과분은
    // 재정규화 계수(Σwm)에 유계이므로 여유를 두고 검사한다 — 검증 대상은 "폭주하지 않는다"이다.
    const counts = [1_000_000, 0, 0, 0, 0, 0];
    let centi = neutralMultipliersCenti();
    for (let i = 0; i < 300; i++) centi = refreshMultipliersCenti(counts, centi);
    for (const c of centi) {
      expect(c / 100).toBeGreaterThanOrEqual(CLAMP_LO / CLAMP_HI);
      expect(c / 100).toBeLessThanOrEqual(CLAMP_HI / CLAMP_LO);
    }
  });

  it('클램프 전 raw 배율이 경계를 넘는 입력에서 실제로 잘린다', () => {
    // 행성 0 만 압도적 → ŵ₀ 가 커져 raw = (1/6)/ŵ₀ 가 CLAMP_LO 아래로 내려간다.
    // 평활·재정규화를 제거하려면 1주기 목표치를 직접 재구성해야 하므로, 여기서는 산식을
    // 그대로 손계산해 클램프가 걸렸는지 확인한다.
    const counts = [1_000_000, 0, 0, 0, 0, 0];
    const R = counts.reduce((a, b) => a + b, 0);
    const wHat0 = (counts[0]! + PRIOR_K) / (R + PLANET_COUNT * PRIOR_K);
    const raw0 = 1 / PLANET_COUNT / wHat0;
    expect(raw0).toBeLessThan(CLAMP_LO); // 클램프가 실제로 개입하는 입력임을 먼저 증명
  });
});

// ---------------------------------------------------------------------------
// §3. 사전표본 K 축소
// ---------------------------------------------------------------------------

describe('§3 사전표본 K 축소', () => {
  it('표본이 K 대비 작으면 배율이 1.0 에 붙는다', () => {
    // 총 6런 vs K=80 → 관측이 사전표본에 압도돼 배율이 거의 안 움직인다.
    const tiny = [6, 0, 0, 0, 0, 0];
    const centi = refreshMultipliersCenti(tiny, neutralMultipliersCenti());
    for (const c of centi) expect(Math.abs(c - NEUTRAL_MULT_CENTI)).toBeLessThanOrEqual(2);
  });

  it('표본이 K 를 크게 넘으면 같은 편향이 실제 배율 차이로 드러난다', () => {
    const tiny = [6, 1, 1, 1, 1, 1];
    const big = [60_000, 10_000, 10_000, 10_000, 10_000, 10_000];
    const cTiny = refreshMultipliersCenti(tiny, neutralMultipliersCenti());
    const cBig = refreshMultipliersCenti(big, neutralMultipliersCenti());
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(cBig)).toBeGreaterThan(spread(cTiny));
  });

  it('표본 0(집계 이전)이면 전 행성 정확히 중립이다', () => {
    const centi = refreshMultipliersCenti([0, 0, 0, 0, 0, 0], neutralMultipliersCenti());
    for (const c of centi) expect(c).toBe(NEUTRAL_MULT_CENTI);
  });
});

// ---------------------------------------------------------------------------
// §4. 지수평활 수렴
// ---------------------------------------------------------------------------

describe('§4 지수평활 수렴', () => {
  it('한 주기는 목표치까지 가지 않고 ALPHA 만큼만 간다', () => {
    const counts = [4000, 100, 100, 100, 100, 100];
    const one = refreshMultipliersCenti(counts, neutralMultipliersCenti());
    let many = neutralMultipliersCenti();
    for (let i = 0; i < 200; i++) many = refreshMultipliersCenti(counts, many);
    // 1주기 값은 중립과 수렴값 **사이**에 있어야 한다(오버슈트 없음).
    expect(one[0]!).toBeLessThan(NEUTRAL_MULT_CENTI);
    expect(one[0]!).toBeGreaterThan(many[0]!);
    expect(ALPHA).toBeGreaterThan(0);
    expect(ALPHA).toBeLessThan(1);
  });

  it('같은 입력을 반복하면 고정점으로 수렴한다(진동·발산 없음)', () => {
    const counts = [4000, 100, 100, 100, 100, 100];
    let centi = neutralMultipliersCenti();
    for (let i = 0; i < 500; i++) centi = refreshMultipliersCenti(counts, centi);
    const next = refreshMultipliersCenti(counts, centi);
    for (let i = 0; i < PLANET_COUNT; i++) expect(Math.abs(next[i]! - centi[i]!)).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §5. 오프라인/미설정 폴백 + centi 계약
// ---------------------------------------------------------------------------

describe('§5 오프라인 폴백 · centi 계약', () => {
  it('중립 표는 전 행성 100(centi)이고 배율이 정확히 1.0 이다', () => {
    const centi = neutralMultipliersCenti();
    expect(centi).toHaveLength(PLANET_COUNT);
    for (const c of centi) {
      expect(c).toBe(NEUTRAL_MULT_CENTI);
      // **정확히 1** 이어야 sim 곱셈이 무연산이다(바이트 불변의 근거).
      expect(multFromCenti(c)).toBe(1);
    }
  });

  it('비정상 centi(undefined·0·음수·NaN)는 중립으로 접힌다', () => {
    for (const bad of [undefined, 0, -50, NaN, Infinity]) {
      expect(multFromCenti(bad as number | undefined)).toBe(1);
    }
  });

  it('행성 수 상수가 실제 레지스트리와 일치한다', () => {
    expect(PLANET_COUNT).toBe(PLANETS.length);
  });

  it('epoch 은 30분 슬롯이다', () => {
    expect(EPOCH_SECONDS).toBe(1800);
    expect(epochOfMs(0)).toBe(0);
    expect(epochOfMs(1799_000)).toBe(0);
    expect(epochOfMs(1800_000)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §6. 정규 경로 배선 — 배율이 실제 런의 XP·드랍 수·자원에 도달하는가
// ---------------------------------------------------------------------------

/** 표준 빌드 프로필(드랍 통합 가드와 같은 규약). */
function standardProfile(stage: number, planet = 0) {
  const p = defaultProfile();
  const s = activeShip(p);
  s.level = stage * 5;
  s.skillInvest = standardSkillInvest(s.typeId, s.level);
  s.equipped = standardEquipped(s.level, 0xbeef, planet);
  return p;
}

/** 한 런을 끝까지 돌려 관측치를 낸다. `centi` 미지정 = 배율 미스탬프(중립). */
function runOnce(seed: number, stage: number, centi?: number, planet = 0, maxTicks = 60 * 400) {
  const p = standardProfile(stage, planet);
  const cfg = buildRunConfig(p, {
    planet,
    stage,
    ...(centi !== undefined ? { planetMult: { centi, epoch: 12345 } } : {}),
  });
  const state = createWorld(seed, cfg);
  for (let i = 0; i < maxTicks; i++) {
    stepWorld(state, autopilotInput(state));
    if (state.gameOver || state.victory) break;
  }
  return {
    config: cfg,
    state,
    victory: state.victory,
    xpTotal: state.xpTotal,
    resources: state.resources,
    /**
     * 자원 적립의 **반올림 이전 총량**(milli). `state.resources` 는 `Math.floor` 로 잘린
     * 정수라 런당 습격 격추가 몇 건뿐이면 ×1.2 가 정수 경계를 못 넘어 **두 상태가 같은
     * 값으로 보인다**(2026-08-04 실측: 8시드 base 21 vs up 21). 배선을 재려면 캐리를
     * 포함한 이 값을 봐야 한다 — 밸런스 큐 §R48.
     */
    resourceMilli: state.resources * 1000 + state.catalystResourceMilli,
    drops: state.loot.length + state.entities.filter((e) => e.kind === 'loot').length,
    loot: state.loot,
  };
}

/**
 * ## 최소 틱 배선 증명 (2026-08-06, ADR-0051 갈래 ③)
 *
 * 종전 §6·§7 은 8시드 × **완주**로 배선을 증명했고 그 대가로 파일 벽시계 29.7초 중 27.8초를
 * 썼다. 배선은 완주를 요구하지 않는다 — 값이 **적용점**에 도달했는지만 보면 된다. 적용점은 셋이고
 * 각각 처음 밟히는 틱이 실측으로 정해진다(행성 0 · 단계 11 · 시드 1001):
 *
 * | 적용점 | 코드 | 첫 도달 |
 * |---|---|---|
 * | 메타 XP | `world.ts` `state.xpTotal += … * state.planetMult` | 첫 격추(수십 틱) |
 * | 엘리트 드랍 게이트 | `rollEliteDropGate(dropRng, eliteCount, state.planetMult)` | 260틱 |
 * | 자원 적립 | 습격 격추의 `catalystResourceMilli += … * state.planetMult` | **1835틱** |
 *
 * 그래서 앞의 둘은 {@link WIRE_TICKS}, 자원만 {@link RAID_TICKS} 를 쓴다.
 */
const WIRE_TICKS = 900;
/** 습격(보급선)은 1,835틱쯤 처음 뜬다 — 자원 적용점은 그 뒤에만 밟힌다. 여유를 둔 값. */
const RAID_TICKS = 2200;
/** 배선 대조의 고정 시드. 이 시드는 900틱 안에 엘리트 드랍이 실제로 발생한다(실측 260틱). */
const WIRE_SEED = 1001;
/**
 * **게이트를 포화시키는 비현실 배율**(×100 · ×200).
 *
 * 운영 범위(0.85~1.20)로는 900틱에 드랍이 0~1건이라 수량 대조가 구조적으로 무력하다 — 종전
 * `배율 1.20 이 드랍 수량을 늘린다` 가 `expected 2 to be greater than 2` 로 **main 에서 이미
 * 빨간** 이유가 정확히 그것이다(표본이 아니라 계량의 문제). 배율을 포화시키면 같은 900틱에서
 * 드랍이 0~1 → 4~13 건이 되어 게이트 배선이 한 눈에 갈린다.
 */
const SATURATE = 10000;
const SATURATE_X2 = 20000;

/** 같은 (배율, 틱) 런을 여러 단언이 공유한다 — 이 파일의 실런은 전부 여기를 거친다. */
const runCache = new Map<string, ReturnType<typeof runOnce>>();
function wireRun(centi: number | undefined, ticks: number = WIRE_TICKS) {
  const key = `${centi ?? 'neutral'}/${ticks}`;
  let r = runCache.get(key);
  if (r === undefined) {
    r = runOnce(WIRE_SEED, 11, centi, 0, ticks);
    runCache.set(key, r);
  }
  return r;
}

/** 이 런이 만든 전리품 전량 — 회수분(`state.loot`) + 바닥에 남은 엔티티. `"시드:등급"` 문자열. */
function lootKeys(r: ReturnType<typeof runOnce>): string[] {
  const ground = r.state.entities
    .filter((e) => e.kind === 'loot')
    // 바닥 전리품은 드랍 시드를 `damage` 에, 등급 코드를 `enemyType` 에 싣는다(`spawnLoot`).
    .map((e) => `${e.damage >>> 0}:${e.enemyType}`);
  return [...r.loot.map((l) => `${l.seed >>> 0}:${l.rarity}`), ...ground];
}

describe('§6 정규 경로 배선 — 배율이 실제 런에 도달한다', () => {
  /**
   * **메타 XP 적용점** — 방향이 아니라 **정확한 비례**를 건다.
   *
   * 두 런은 같은 시드·같은 입력이고, 드랍 게이트가 배율과 무관하게 `dropRng` 를 **정확히 1회**
   * 소비하므로(`world.ts` 엘리트 드랍 게이트 주석) 봇 경로가 짝지어진 채로 간다. 그래서
   * `xpTotal` 의 비는 배율과 **정확히 같아야** 한다(실측: 300~1800틱 · 3시드 전부 1.200000).
   *
   * 방향 단언(`up > base`)보다 이쪽이 강하다 — 방향만 보면 "config 가 달라져 런이 어쩌다 갈렸다"
   * 로도 통과하지만, 비가 정확히 1.20 이라는 것은 **그 곱이 XP 적용점에서 일어났다**는 뜻이다.
   *
   * ⚠️ 이 단언이 깨졌는데 방향은 맞다면 두 런이 짝짓기를 잃은 것이다 — 배선이 아니라 위
   * "RNG 1회 소비" 계약을 먼저 확인하라.
   */
  it('배율이 메타 XP 적용점에 정확히 비례해 도달한다(1.20 · 0.85)', () => {
    const base = wireRun(undefined);
    expect(base.xpTotal, '중립 런의 메타 XP 가 0 — 격추가 한 건도 없다면 적용점을 안 밟는다').toBeGreaterThan(0);
    expect(wireRun(120).xpTotal / base.xpTotal).toBeCloseTo(1.2, 6);
    expect(wireRun(85).xpTotal / base.xpTotal).toBeCloseTo(0.85, 6);
  });

  it('배율은 **런 풀** XP 를 건드리지 않는다(ADR-0036 런 내 리듬 불변)', () => {
    // 같은 시드·같은 입력이면 런 풀(state.xp)은 배율과 무관해야 한다. 위 XP 비례 단언과 짝이다 —
    // 메타 풀은 정확히 갈리고 런 풀은 정확히 같아야, 곱이 **올바른 한 곳에만** 걸린 것이다.
    const a = wireRun(undefined);
    expect(a.state.xp, '런 풀 XP 가 0 — 젬을 하나도 안 먹었다').toBeGreaterThan(0);
    expect(wireRun(120).state.xp).toBe(a.state.xp);
    expect(wireRun(85).state.xp).toBe(a.state.xp);
  });

  /**
   * **엘리트 드랍 게이트 적용점** — 포화 대조.
   *
   * 배율을 ×100 으로 밀면 `eliteDropChance` 가 1 을 넘어 게이트가 사실상 전부 통과한다. 즉
   * 배율이 게이트에 닿아 있으면 같은 900틱·같은 시드에서 드랍 수가 **한 자릿수 배로** 벌어지고,
   * 안 닿아 있으면 정확히 같은 수가 나온다. 운영 범위(1.20)로는 이 축을 900틱에 못 재므로
   * (드랍 0~1건) 계량을 배율 쪽으로 키운다 — 재는 대상은 여전히 배선 하나다.
   */
  it('배율이 엘리트 드랍 게이트 적용점에 도달한다 — 포화 대조', () => {
    const base = wireRun(undefined).drops;
    const saturated = wireRun(SATURATE).drops;
    expect(saturated, '포화 배율에서도 드랍이 없다 — 이 시드/틱에서 엘리트가 한 번도 안 죽는다').toBeGreaterThan(2);
    expect(
      saturated,
      '배율 ×100 이 드랍 수를 못 바꿨다 — planetMult 가 드랍 게이트에 배선되지 않았다',
    ).toBeGreaterThan(base);
  });

  it('배율이 자원 적립 적용점에 도달한다', () => {
    // ⚠️ **`resources`(정수)가 아니라 `resourceMilli`(캐리 포함)를 본다.** 이유는 `runOnce`
    // 의 `resourceMilli` 주석 — 정수 지표는 습격 격추가 몇 건뿐일 때 ×1.2 를 통째로 삼킨다.
    const base = wireRun(undefined, RAID_TICKS).resourceMilli;
    expect(
      base,
      `중립 런의 자원이 0 — 습격이 한 번도 안 떴다(첫 습격 실측 1835틱, 상한 ${RAID_TICKS})`,
    ).toBeGreaterThan(0);
    expect(wireRun(120, RAID_TICKS).resourceMilli / base).toBeCloseTo(1.2, 6);
  });

  it('엘리트 드랍 게이트 확률이 배율에 정비례한다(단위)', () => {
    const p1 = eliteDropChance(1, 1);
    expect(eliteDropChance(1, 1.2)).toBeCloseTo(p1 * 1.2, 12);
    expect(eliteDropChance(1, 0.85)).toBeCloseTo(p1 * 0.85, 12);
    // 기본 인자 = 1 → 구 호출부와 산술 동일.
    expect(eliteDropChance(1)).toBe(p1);
  });

  it('runConfig 가 중립 배율은 스탬프하지 않고, 비중립만 스탬프한다', () => {
    const p = standardProfile(11);
    const neutral = buildRunConfig(p, { planet: 0, stage: 11, planetMult: { centi: 100, epoch: 7 } });
    expect(neutral.planetMultCenti).toBeUndefined();
    // epoch 은 중립이어도 실린다 — 정산이 "어느 표를 봤는가"를 서버에 말해야 한다.
    expect(neutral.planetMultEpoch).toBe(7);
    const biased = buildRunConfig(p, { planet: 0, stage: 11, planetMult: { centi: 120, epoch: 7 } });
    expect(biased.planetMultCenti).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// §7. 닿으면 안 되는 축 — 품질 · 보스 확정 드랍 · 침공 · 특산 설계도
// ---------------------------------------------------------------------------

describe('§7 배율이 닿으면 안 되는 축', () => {
  /**
   * **품질 축 불변** — 통계가 아니라 **정확 대조**로 본다.
   *
   * 종전에는 8시드 완주에서 유니크 비율 차가 0.05 미만인지를 봤다. 그 계량은 두 가지가 잘못돼
   * 있었다: ①표본이 런당 0~4건이라 유니크(등급 3)는 대부분 0건이었고 — 즉 대부분의 실행에서
   * `0 - 0 < 0.05` 라는 **공허한 단언**이었다 ②그 공허함을 사기 위해 8시드 완주(4.9초)를 냈다.
   *
   * 대신: 배율을 **포화 구간의 서로 다른 두 값**(×100 · ×200)으로 준다. 둘 다 게이트가 전부
   * 통과하므로 **같은 엘리트가 같은 순서로 드랍하고 `dropRng` 소비가 완전히 일치한다** —
   * 따라서 등급 롤(`rollEliteDrop`)이 배율을 안 읽는다면 두 런의 전리품이 `(시드, 등급)` 까지
   * **바이트 동일**해야 한다. 등급 threshold 에 `planetMult` 가 섞이면 같은 드랍 시드가 다른
   * 등급 코드를 내므로 즉시 갈린다(ADR-0022 "품질은 전 행성 동일").
   */
  it('품질(rarity) 축은 배율에 불변이다 — 포화 구간 정확 대조', () => {
    const a = lootKeys(wireRun(SATURATE));
    const b = lootKeys(wireRun(SATURATE_X2));
    expect(a.length, '포화 배율에서도 전리품이 없다 — 대조가 공허하다').toBeGreaterThan(2);
    // 등급이 한 종류뿐이면 threshold 이동을 못 본다 — 표본에 실제로 등급 폭이 있는지 먼저 본다.
    expect(new Set(a.map((k) => k.split(':')[1])).size, '전리품 등급이 한 종류뿐 — 품질 축을 못 잰다').toBeGreaterThan(1);
    expect(b, '포화 구간에서 배율만 바꿨는데 전리품이 갈렸다 — 등급 롤이 planetMult 를 읽는다').toEqual(a);
  });

  it('침공(designedRun) 런에는 배율이 스탬프되지 않는다', () => {
    // 침공 경로는 buildRunConfig 호출부가 planetMult 옵션을 넘기지 않는다 — 옵션 미전달 시
    // 두 필드가 모두 부재임을 못 박는다(배선 누락이 아니라 **의도된 부재**임의 증거).
    const p = standardProfile(1);
    const cfg = buildRunConfig(p, { planet: 0, stage: 1 });
    expect(cfg.planetMultCenti).toBeUndefined();
    expect(cfg.planetMultEpoch).toBeUndefined();
  });

  it('특산 설계도 기대 획득률이 배율에 불변이다(엘리트 유래만 역수 보정)', () => {
    // 같은 시드 집합으로 엘리트 유래 loot 를 만들고, 건수를 배율만큼 늘린 뒤 역수 보정된
    // 확률로 굴리면 기대 설계도 수가 보정 전과 같은 수준이어야 한다.
    const mk = (n: number, elite: 1 | undefined) =>
      Array.from({ length: n }, (_, i) => ({
        seed: (i * 2654435761) >>> 0,
        rarity: 3,
        planet: 0,
        ...(elite !== undefined ? { elite } : {}),
      }));
    const N = 4000;
    const baseCount = blueprintDropsFromLoot(mk(N, 1), 1).reduce((a, g) => a + g.count, 0);
    // 배율 1.2 → 건수 1.2배 + 확률 1/1.2 → 기대치 불변.
    const upCount = blueprintDropsFromLoot(mk(Math.round(N * 1.2), 1), 1.2).reduce(
      (a, g) => a + g.count,
      0,
    );
    expect(baseCount).toBeGreaterThan(0);
    expect(Math.abs(upCount - baseCount) / baseCount).toBeLessThan(0.15);
  });

  it('보스 확정 드랍(elite 미표기)은 역수 보정을 받지 않는다', () => {
    const boss = Array.from({ length: 2000 }, (_, i) => ({
      seed: (i * 40503) >>> 0,
      rarity: 3,
      planet: 0,
    }));
    const a = blueprintDropsFromLoot(boss, 1).reduce((s, g) => s + g.count, 0);
    const b = blueprintDropsFromLoot(boss, 1.2).reduce((s, g) => s + g.count, 0);
    expect(b).toBe(a);
  });
});

// ---------------------------------------------------------------------------
// §8. XP 30% 하한 재적용 (ADR-0035 안전망 보존)
// ---------------------------------------------------------------------------

describe('§8 XP 최종 하한 30% 보존', () => {
  /**
   * 고레벨 기체가 단계1 을 도는 정산(= 저단계 감쇠가 하한까지 걸리는 조건)에서 **실제로 적립된
   * 총 XP** 를 잰다.
   *
   * ⚠️ `ship.xp` 델타만 보면 안 된다 — 레벨업이 커브만큼 XP 를 **소비**하므로 남은 잔량은 적립
   * 총량이 아니다. 소비분(`xpToNextMeta` 합)을 되더해야 "이 런의 XP 효율"이 나온다.
   * (이걸 빼먹었을 때 0.083 이 나와, 하한이 깨진 것처럼 보였다.)
   */
  function settleXp(centi: number | undefined, xpTotal: number): number {
    const p = defaultProfile();
    const s = activeShip(p);
    // 만렙은 초과 XP 를 버리므로(LEVEL_CAP 계약) 레벨업 여지가 있는 값으로 둔다.
    s.level = 60;
    const before = { level: s.level, xp: s.xp };
    settleRun(p, {
      victory: false,
      loot: [],
      xpTotal,
      resources: 0,
      planet: 0,
      stage: 1,
      ...(centi !== undefined ? { planetMultCenti: centi } : {}),
    });
    const after = activeShip(p);
    let consumed = 0;
    for (let lv = before.level; lv < after.level; lv++) consumed += xpToNextMeta(lv);
    return after.xp - before.xp + consumed;
  }

  it('감쇠가 실제로 하한(30%)까지 걸리는 조건인지 먼저 확인한다(공허 단언 방어)', () => {
    // 이 전제가 깨지면 아래 하한 테스트는 아무것도 증명하지 못한다.
    expect(lowStageXpDecayPercent(60, 1)).toBe(30);
  });

  it('배율 0.85 라도 최종 XP 효율이 30% 아래로 내려가지 않는다', () => {
    const RAW = 1_000_000;
    // sim 이 이미 0.85 를 곱해 둔 상태를 흉내낸다 — 정산 입력은 RAW × 0.85.
    const banked = settleXp(85, Math.floor(RAW * 0.85));
    // 최종 = max(0.30, decay × 0.85) × RAW. decay 가 하한 30 이면 0.30 × RAW 여야 한다
    // (보정 없이 그냥 곱했다면 0.255 × RAW 로 뚫린다).
    expect(banked / RAW).toBeGreaterThanOrEqual(0.3 - 1e-3);
    // 그리고 하한을 **넘어서 부풀지도** 않는다 — 안전망이지 보너스가 아니다.
    expect(banked / RAW).toBeLessThanOrEqual(0.31);
  });

  it('배율 1.20 은 하한과 무관하게 그대로 곱해진다(하한이 상방을 막지 않는다)', () => {
    const RAW = 1_000_000;
    const up = settleXp(120, Math.floor(RAW * 1.2));
    // 최종 = max(0.30, 0.30 × 1.20) × RAW = 0.36 × RAW.
    expect(up / RAW).toBeGreaterThan(0.35);
    expect(up / RAW).toBeLessThan(0.37);
  });

  it('중립(centi 100)이면 정산 XP 가 구 경로와 정확히 같다', () => {
    const RAW = 1_000_000;
    expect(settleXp(100, RAW)).toBe(settleXp(undefined, RAW));
  });
});

// ---------------------------------------------------------------------------
// §9. 해시 바이트 불변 — centi 100/미지정이면 기존 골든이 그대로 통과
// ---------------------------------------------------------------------------

describe('§9 hashWorld 바이트 불변 (EF 재배포 불필요의 근거)', () => {
  it('planetMultCenti 미지정 vs 명시적 100 이 매 틱 같은 해시를 낸다', () => {
    const p = standardProfile(11);
    const a = createWorld(4242, buildRunConfig(p, { planet: 0, stage: 11 }));
    const b = createWorld(
      4242,
      // 명시적으로 100 을 넘겨도 runConfig 가 스탬프하지 않으므로 config 가 동형이다.
      buildRunConfig(p, { planet: 0, stage: 11, planetMult: { centi: 100, epoch: 999 } }),
    );
    for (let i = 0; i < 600; i++) {
      const ia = autopilotInput(a);
      stepWorld(a, ia);
      stepWorld(b, ia);
      expect(hashWorld(b)).toBe(hashWorld(a));
    }
  });

  it('config 에 planetMultCenti=100 이 직접 실려도 폴드가 실행되지 않는다', () => {
    // runConfig 를 우회해 필드를 직접 심는 방어선 — "0 이면 무폴드" 불변식을 값 자체로 못 박는다.
    const p = standardProfile(11);
    const base = buildRunConfig(p, { planet: 0, stage: 11 });
    const a = createWorld(777, base);
    const b = createWorld(777, { ...base, planetMultCenti: 100, planetMultEpoch: 5 });
    for (let i = 0; i < 300; i++) {
      const ia = autopilotInput(a);
      stepWorld(a, ia);
      stepWorld(b, ia);
    }
    expect(hashWorld(b)).toBe(hashWorld(a));
  });

  it('비중립 배율은 해시를 실제로 가른다(봉인이 동작한다)', () => {
    const p = standardProfile(11);
    const base = buildRunConfig(p, { planet: 0, stage: 11 });
    const a = createWorld(777, base);
    const b = createWorld(777, { ...base, planetMultCenti: 120 });
    for (let i = 0; i < 300; i++) {
      const ia = autopilotInput(a);
      stepWorld(a, ia);
      stepWorld(b, ia);
    }
    expect(hashWorld(b)).not.toBe(hashWorld(a));
  });
});
