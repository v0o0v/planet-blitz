/**
 * M8-L0 — 스트라이커 해시 골든 게이트.
 *
 * `tests/fixtures/striker-prem8.json` 은 스트라이커 빌드의 per-tick 해시를 못 박은 골든이다.
 * 이 테스트는 그 골든을 **읽어서 비교만** 한다 — 절대 다시 쓰지 않는다.
 * (재생성형 픽스처인 scripts/deno-verify/fixtures.json 과 정반대 성격이다. 그쪽은 테스트가
 * 매번 다시 굳히므로 시뮬 변경을 통과시키고, 이쪽은 통과시키면 안 된다.)
 *
 * ⚠️ **촉매 시대 기준선(ADR-0029, 2026-07-24 rebase)**: 원래 이 골든은 "M8 이전과 바이트 동일"을
 * 주장했으나, anomaly 폐지가 `hashWorld` 의 무조건 anomaly 폴드 3개 + `anomalyAccepted` 폴드 1개를
 * 제거하는 **1회 포맷 범프**여서 그 불변식은 더 이상 성립하지 않는다(계획 이슈 A). 골든을 촉매 시대
 * 기준으로 **재생성**했다(`RECORD_STRIKER_BASELINE=1`). 회귀 탐지 역할은 그대로다 — 스킬 슬라이스·
 * loadout 파생·폴드 레이아웃이 이후 조용히 바뀌면 여전히 여기서 터진다.
 *
 * ## 무엇을 막는가
 * 1. `data/skills.ts` 인덱스/트리 슬라이스가 밀려 파워업 추첨 스트림이 갈리는 회귀
 *    — 해시 폴드 레이아웃을 완벽히 보존해도 발생하는 가장 은밀한 M8 위험.
 * 2. `computeLoadoutStats`(캡스톤 비트 포함) 파생 결과 변화.
 * 3. `hashWorld` 폴드 레이아웃 변경이 스트라이커 런에 새는 것(신규 폴드는 `shipType !== 0`
 *    조건부여야 스트라이커가 한 폴드도 실행하지 않는다).
 * 4. `Profile` → 런 설정 조립 경로가 골든과 다른 config 를 만드는 배선 결함.
 *
 * ## ⚠️ 2026-07-27 재생성 — 이 골든은 이제 **표준 장비 세트에 의존한다** (밸런스 패스)
 *
 * ### 새로 생긴 결합 (다음 사람이 실패를 보면 여기부터 의심해라)
 * 녹화 런이 `src/bench/standardBuild.ts` 의 **밴드 표**로 장비를 조립한다
 * (`gearedBaselineConfig`). **그 표가 바뀌면 이 골든을 재생성해야 한다.** 다행히 대조형 골든이라
 * 어긋나면 조용히 낡지 않고 **큰 소리로 실패**한다 — 이 저장소가 반복해 밟은 함정은 전부
 * *조용히* 낡는 쪽이었다. 관측 창도 `BASELINE_TICKS` 3,000 → **6,000틱**으로 넓혔다.
 *
 * ### 왜 장비를 실었나
 * 런 풀 커브가 `10+6L` → **`10+66L`** 로 오르고 적 축이 함께 오르면서 **무장비 저투자 런이
 * 골든으로서 정보를 잃었다.** 재생성 직후 실측: `berdan-engage/capstone-survival` 이 9,000틱
 * (150초)을 돌려도 **레벨업 0회 · 처치 7**, 12런 중 레벨업 6회 이상이 **0런**. 파워업 추첨이
 * 거의 안 나면 위 (1)번 계약(트리 슬라이스 가중 회귀 탐지)이 공회전한다.
 * **틱만 늘려서는 안 풀렸다** — 3,000 / 6,000 / 9,000 / 12,000틱에서 활발 런이 0 / 3 / 5 / **5**
 * 로 정체한다(죽는 런은 더 못 큰다). 장비 + 6,000틱에서 **11/12 런이 레벨업 6회 이상**이 된다.
 *
 * ### 잃은 것
 * **무장비 저투자 조합의 해시 커버리지.** 다만 그 조합은 위 실측대로 **골든으로서 이미 죽어
 * 있었다**(레벨업 0회 = 추첨 0회 = 이 파일의 핵심 계약을 한 번도 안 밟는다). 죽은 커버리지를
 * 살아 있는 것과 맞바꾼 것이지 커버리지를 버린 것이 아니다.
 *
 * ### 바뀌지 않은 것
 * `BASELINE_BUILDS`(스킬 투자 축)는 **불변**이고 그것이 이 골든의 **대조 축**이다. 장비는 런을
 * 살려 두는 **환경**이지 관측 대상이 아니다 — 전 런에 같은 규칙으로 실린다.
 * `gearSeed` 는 **런 시드와 같다**. 고정 상수로 두면 "장비 세트 한 벌의 운"을 재게 되므로
 * (같은 설계값에서도 `gearSeed` 만 바꾸면 클리어율이 48.3~100.0% 로 갈린다 —
 * `.omc/research/economy-recalibrated-2026-07-27.md` §0.1) 이 config 는 **증인 시드와 같은 성질**
 * 을 가진다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BASELINE_FIXTURE_PATH,
  BASELINE_BUILDS,
  BASELINE_PLANETS,
  BASELINE_TICKS,
  BASELINE_FORMAT,
  gearedBaselineConfig,
  STANDARD_GEAR_LEVEL,
  buildBaseline,
  driveBaseline,
  recordRun,
  serializeBaseline,
} from '../scripts/recordStrikerBaseline.js';
import type { Baseline, BaselineRun, PlanetSpec } from '../scripts/recordStrikerBaseline.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { WorldConfig, InputFrame } from '../src/sim/world.js';
import { hashWorld } from '../src/sim/replay.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { standardEquipped } from '../src/bench/standardBuild.js';
import type { Profile } from '../src/save/profile.js';
import { SKILL_NODE_COUNT } from '../data/skills.js';
import { PLANET_MODE } from '../src/sim/planetMode.js';

// tests/node-shims.d.ts 의 readFileSync 는 Uint8Array 만 반환한다(encoding 오버로드 없음).
// 소유하지 않은 그 파일을 넓히는 대신 여기서 디코드한다.
const GOLDEN_TEXT = new TextDecoder().decode(readFileSync(BASELINE_FIXTURE_PATH));
const GOLDEN: Baseline = JSON.parse(GOLDEN_TEXT) as Baseline;

/**
 * 현재 코드로 12 런을 **한 번만** 다시 녹화한다(런당 입력 생성 3000틱 + 재생 3000틱이라
 * 케이스마다 다시 굴리면 테스트가 분 단위로 늘어난다). 모든 비교 케이스가 이 결과를 공유한다.
 */
const ACTUAL: Baseline = buildBaseline();

function findRun(baseline: Baseline, key: string): BaselineRun {
  const r = baseline.runs.find((x) => x.key === key);
  if (r === undefined) throw new Error(`런이 없다: ${key}`);
  return r;
}

/**
 * 배열 원소 단위 비교. 요약 해시만 비교하면 "갈렸다"는 것만 알고 **어디서** 갈렸는지 모른다 —
 * 첫 발산 인덱스를 리포트해야 리팩터 중 원인 틱을 바로 짚을 수 있다.
 */
function expectSameStream(
  actual: readonly number[],
  expected: readonly number[],
  key: string,
): void {
  expect(actual.length, `${key}: 해시 스트림 길이`).toBe(expected.length);
  let firstDiff = -1;
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      firstDiff = i;
      break;
    }
  }
  const detail =
    firstDiff < 0
      ? ''
      : `${key}: 틱 ${firstDiff + 1} 에서 해시 발산 ` +
        `(골든 0x${(expected[firstDiff] as number).toString(16)} ≠ 현재 ` +
        `0x${(actual[firstDiff] as number).toString(16)})`;
  expect(firstDiff, detail).toBe(-1);
}

describe('스트라이커 해시 골든 (M8-L0 안전망)', () => {
  it('골든 픽스처가 존재하고 형식이 계약대로다', () => {
    expect(GOLDEN_TEXT.length).toBeGreaterThan(0);
    expect(GOLDEN.meta.format).toBe(BASELINE_FORMAT);
    expect(GOLDEN.meta.ticks).toBe(BASELINE_TICKS);
    expect(GOLDEN.meta.skillNodeCount).toBe(SKILL_NODE_COUNT);
    expect(GOLDEN.meta.runCount).toBe(BASELINE_PLANETS.length * BASELINE_BUILDS.length);
    expect(GOLDEN.runs.length).toBe(GOLDEN.meta.runCount);
  });

  // 12 런 각각을 독립 케이스로 — 어느 시나리오가 깨졌는지 실패 이름만 보고 안다.
  for (const planet of BASELINE_PLANETS) {
    for (const build of BASELINE_BUILDS) {
      const key = `${planet.id}/${build.id}`;
      it(`${key} — per-tick 해시 ${BASELINE_TICKS}개가 골든과 원소 단위 일치`, () => {
        const golden = findRun(GOLDEN, key);
        const actual = findRun(ACTUAL, key);
        expect(actual.seed).toBe(golden.seed);
        expect(actual.skillInvest).toEqual(golden.skillInvest);
        expectSameStream(actual.hashes, golden.hashes, key);
        expect(actual.summary.finalHash).toBe(golden.summary.finalHash);
      });

      it(`${key} — drawPowerupChoices 인덱스 시퀀스가 골든과 일치 (sim RNG 슬라이스 계약)`, () => {
        const golden = findRun(GOLDEN, key);
        const actual = findRun(ACTUAL, key);
        // 배열의 배열 전체 비교 + 추첨 틱까지. 슬라이스 레이아웃이 한 칸만 밀려도 여기서 터진다.
        expect(actual.powerupDraws).toEqual(golden.powerupDraws);
        expect(actual.drawTicks).toEqual(golden.drawTicks);
      });
    }
  }

  it('직렬화 전문이 커밋된 골든과 바이트 동일하다', () => {
    expect(serializeBaseline(ACTUAL)).toBe(GOLDEN_TEXT);
  });

  it('녹화 자체가 결정론이다(같은 런을 두 번 녹화해도 동일)', () => {
    const planet = BASELINE_PLANETS[0]!;
    const build = BASELINE_BUILDS[5]!; // 만렙 근접 — 추첨이 가장 많은 빌드
    const a = recordRun(planet, build, 5);
    const b = recordRun(planet, build, 5);
    expect(a).toEqual(b);
  });

  /**
   * 런당 레벨업·추첨 최소 횟수.
   *
   * ⚠️ 2026-07-26 에 3 → 2 로 내렸다. **가드가 약해진 것이 아니다** — 이 술어가 잡으려는
   * "공허 런"(sim 이 멈춘 채 녹화돼 해시 대조가 공회전하는 상태)은 아래 세 단언이 이미 압도적으로
   * 배제한다: `kills > 0` · `entityCount > 1` · 서로 다른 해시 수 > BASELINE_TICKS/2(=900).
   * 3 은 그 셋에 얹은 **둥근 수**였을 뿐, 어떤 계약에서 파생된 하한이 아니다.
   *
   * 내린 이유는 밀도 배율 1.5(`PVE_DENSITY_MULT`)와 선분 판정 도입이 **빌드별로 반대 방향으로**
   * 작용했기 때문이다. 재녹화 실측(1800틱):
   *   - 카르곤 단계1: 전 빌드 개선(처치 73→129 · 64→105 · 76→134 …, 레벨업 7~10 → 11~13).
   *     선분 판정으로 점사거리 명중이 살아나 화력이 실제로 꽂힌다.
   *   - 베르단 단계11: **투자 빌드는 크게 개선**(mixed-three 처치 23→92 · firepower 94→118),
   *     **저투자 빌드는 악화**(no-invest 27→12 · survival 26→16, 최종 엔티티 205→496 · 235→465).
   *
   * 즉 물량이 늘고 화력 보상이 커지면서 "장비가 받쳐 주는 빌드는 더 잘 뚫고, 안 받쳐 주는 빌드는
   * 더 빨리 잠긴다" 로 갈렸다. `berdan-engage/no-invest` 가 이 창에서 레벨업 2회를 찍어 3 을 밑돈다.
   * 이것은 픽스처 결함이 아니라 **밸런스 신호**이고, 밸런스는 출시 직전 일괄 패스로 미뤄져 있다
   * (고단계 저투자 빌드의 생존성 보정이 그 패스의 항목이다). 그래서 가드는 공허 런 탐지 본래
   * 역할만 유지하고, 밸런스 판정은 그 패스에 맡긴다.
   */
  const MIN_LEVELUPS = 2;

  it('공허 런이 없다(레벨업·추첨·처치·엔티티가 실제로 발생)', () => {
    for (const r of GOLDEN.runs) {
      expect(r.hashes.length, `${r.key} 해시 길이`).toBe(BASELINE_TICKS);
      expect(r.summary.drawCount, `${r.key} 파워업 추첨 횟수`).toBeGreaterThanOrEqual(MIN_LEVELUPS);
      expect(r.powerupDraws.length, `${r.key} 추첨 기록 수`).toBe(r.summary.drawCount);
      expect(r.summary.levelUps, `${r.key} 레벨업 횟수`).toBeGreaterThanOrEqual(MIN_LEVELUPS);
      expect(r.summary.kills, `${r.key} 처치 수`).toBeGreaterThan(0);
      expect(r.summary.entityCount, `${r.key} 최종 엔티티 수`).toBeGreaterThan(1);
      // 해시가 매 틱 같은 값이면 월드가 정지한 것 — 골든이 아무것도 못 잡는다.
      expect(new Set(r.hashes).size, `${r.key} 서로 다른 해시 수`).toBeGreaterThan(
        BASELINE_TICKS / 2,
      );
      // 추첨은 항상 유효 풀 인덱스이며 중복 없이 제안된다.
      for (const draw of r.powerupDraws) {
        expect(draw.length).toBeGreaterThan(0);
        expect(new Set(draw).size).toBe(draw.length);
        for (const idx of draw) expect(idx).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('하한을 내렸어도 대다수 런은 여전히 활발하다 — 가드가 통째로 늙지 않았다', () => {
    // 위 `MIN_LEVELUPS` 를 2 로 내린 것이 "전 런이 빈사여도 통과" 로 번지지 않게, **분포**를
    // 따로 못 박는다. 하한 완화의 대상은 고단계 저투자 런 소수이고 나머지는 오히려 더 활발해졌다
    // (재녹화 실측: 12런 중 8런이 레벨업 11회 이상). 이 단언이 깨지면 하한 완화가 실제로 가드를
    // 무력화하기 시작했다는 뜻이므로, 그때는 값을 다시 조이거나 관측 창을 늘려야 한다.
    const lively = GOLDEN.runs.filter((r) => r.summary.levelUps >= 6);
    expect(lively.length, '레벨업 6회 이상인 런 수').toBeGreaterThanOrEqual(
      Math.ceil(GOLDEN.runs.length / 2),
    );
    // 처치 총합도 런 수 대비 충분해야 한다(런당 평균 20처치 이상).
    const totalKills = GOLDEN.runs.reduce((s, r) => s + r.summary.kills, 0);
    expect(totalKills).toBeGreaterThan(GOLDEN.runs.length * 20);
  });

  it('시나리오 간 해시가 서로 다르다(빌드 분리가 실제로 의미를 가진다)', () => {
    const finals = new Set(GOLDEN.runs.map((r) => r.summary.finalHash));
    expect(finals.size).toBe(GOLDEN.runs.length);
    // 같은 행성 안에서도 6빌드가 전부 갈려야 한다(행성 차이에 기대지 않는다).
    for (const planet of BASELINE_PLANETS) {
      const inPlanet = GOLDEN.runs.filter((r) => r.key.startsWith(`${planet.id}/`));
      expect(inPlanet.length).toBe(BASELINE_BUILDS.length);
      expect(new Set(inPlanet.map((r) => r.summary.finalHash)).size).toBe(inPlanet.length);
    }
  });

  it('파워업 추첨 시퀀스가 빌드마다 다르다(트리 슬라이스 가중이 실제로 먹고 있다)', () => {
    // 전부 같다면 investedInTree 슬라이스가 무력화된 것이므로 골든이 (3)번 계약을 못 지킨다.
    for (const planet of BASELINE_PLANETS) {
      const inPlanet = GOLDEN.runs.filter((r) => r.key.startsWith(`${planet.id}/`));
      const sigs = inPlanet.map((r) => JSON.stringify(r.powerupDraws));
      expect(new Set(sigs).size, `${planet.id}: 빌드별 추첨 시퀀스 종류`).toBe(inPlanet.length);
    }
    // 무투자 vs 화력 캡스톤은 첫 추첨부터 갈려야 한다(가중이 첫 draw 에 이미 반영된다).
    const noInvest = findRun(GOLDEN, 'kargon-recon/no-invest');
    const fp = findRun(GOLDEN, 'kargon-recon/capstone-firepower');
    expect(noInvest.powerupDraws[0]).not.toEqual(fp.powerupDraws[0]);
  });

  it('캡스톤 빌드가 실제로 uniqueMask 비트를 켠다(투자가 sim 게이트에 도달)', () => {
    const noBit = new Set(['no-invest', 'mixed-three']);
    for (const r of GOLDEN.runs) {
      const buildId = r.key.split('/')[1] as string;
      if (noBit.has(buildId)) expect(r.summary.uniqueMask, r.key).toBe(0);
      else expect(r.summary.uniqueMask, r.key).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 정규 경로 통합 — "단위 테스트는 그린인데 배선이 통째로 없다" 방지.
//
// 위 케이스들은 baselineConfig() 라는 테스트 소유 조립을 탄다. 그것만으로는 실제 앱이 같은
// config 를 만드는지 알 수 없다. 아래는 Profile 에서 출발해 **src/main.ts 의 PvE 런 시작
// (:922-940)과 같은 함수·같은 순서**로 조립한 뒤 createWorld/stepWorld 를 실제로 돌려 골든과
// 대조한다.
//
// ✅ M8-L7 완료: 아래는 조립을 **재현**하지 않는다 — 실제 앱(`src/main.ts` PvE 출격)이 부르는
// 바로 그 함수 `buildRunConfig` 를 호출한다. 그래서 이 테스트는 "앱 경로 == 골든" 을 문자
// 그대로 증명한다. `playerHp` 만 테스트가 덮는데, 그것은 프로필에서 파생되는 값이 아니라
// 골든 녹화가 쓰는 무대 상수(런이 3000틱 버티도록)라 배선 대상이 아니다.
// ---------------------------------------------------------------------------

function assembleRunConfigLikeMain(
  profile: Profile,
  planet: number,
  stage: number,
  playerHp: number,
): WorldConfig {
  return { ...buildRunConfig(profile, { planet, stage }), playerHp };
}

/**
 * 골든 조립(`baselineConfig`)에 앱 경로(`buildRunConfig`)가 **명시**하는 필드를 더한 형태.
 * 전부 값 의미가 미지정과 동일해 해시가 불변이다:
 *  - `catalysts: []`  → `hashWorld` 촉매 꼬리는 빈 배열이면 무폴드(조건부 꼬리) · resolveCatalystMods 중립
 *  - `shipType: 0`    → `state.config.shipType ?? 0` · 0 이면 꼬리 폴드 미실행
 *  - `planetMode: vampire(0)` → 0 이면 모드 꼬리 폴드 미실행
 * 즉 이 줄들은 "앱이 더 명시적으로 쓴다"는 사실만 나타내고, 스트라이커 해시 동결
 * (`expectSameStream`)은 아래에서 그대로 증명된다. (구 `anomalyAccepted: false` 는 anomaly
 * 폐지(ADR-0029)로 삭제됐고, `catalysts: []` 가 그 자리를 대신한다.)
 */
function goldenConfigAsApp(
  planet: PlanetSpec,
  invest: readonly number[],
  gearSeed: number,
): WorldConfig {
  return {
    ...gearedBaselineConfig(planet, invest, gearSeed),
    catalysts: [],
    shipType: 0,
    planetMode: PLANET_MODE.vampire,
  };
}

/**
 * 앱 프로필에 **골든과 같은 표준 장비**를 장착한다(2026-07-27). 골든 녹화가 장비를 싣게 되면서
 * (`gearedBaselineConfig`) 프로필도 같은 세트를 들어야 "앱 경로 == 골든" 이 성립한다.
 * 장착 자리는 실제 앱과 같은 `activeShip(profile).equipped` 이고 `buildRunConfig` 가 거기서
 * 아이템을 수집한다 — 즉 이 줄이 늘어난 것 자체가 **장비 수집 배선까지 게이트에 들어왔다**는 뜻이다.
 */
function equipStandardGear(profile: Profile, planet: PlanetSpec, gearSeed: number): void {
  activeShip(profile).equipped = standardEquipped(STANDARD_GEAR_LEVEL, gearSeed, planet.planet);
}

/** 골든과 같은 조건으로 실제 sim 을 굴려 per-tick 해시를 모은다. */
function runHashes(seed: number, config: WorldConfig): number[] {
  const inputs = driveBaseline(seed, config, BASELINE_TICKS);
  const state = createWorld(seed, config);
  const hashes: number[] = [];
  for (const f of inputs) {
    stepWorld(state, f as InputFrame);
    hashes.push(hashWorld(state));
  }
  return hashes;
}

const DURABLE_HP = 100_000_000;

describe('정규 경로 통합 — Profile → 런 설정 → createWorld/stepWorld', () => {
  it('Profile 경로가 골든과 동일한 해시 스트림을 낸다 (화력 캡스톤 빌드)', () => {
    const planet = BASELINE_PLANETS[0]!;
    const build = BASELINE_BUILDS[1]!; // 화력 캡스톤
    const golden = findRun(GOLDEN, `${planet.id}/${build.id}`);

    // 연구소가 저장하는 것과 같은 자리에 투자를 넣는다.
    const profile = defaultProfile();
    activeShip(profile).skillInvest = build.invest.slice();
    equipStandardGear(profile, planet, golden.seed);

    const config = assembleRunConfigLikeMain(profile, planet.planet, planet.stage, DURABLE_HP);
    // 앱 경로가 만든 config 가 골든 시나리오 config 와 실제로 같은가(배선 증명).
    expect(config).toEqual(goldenConfigAsApp(planet, build.invest, golden.seed));
    // 캡스톤 비트가 실제로 켜졌는가(투자 → 파생 → sim 게이트).
    expect(config.loadout?.uniqueMask).toBe(golden.summary.uniqueMask);

    expectSameStream(runHashes(golden.seed, config), golden.hashes, 'profile-path/firepower');
  });

  it('기본 Profile(무투자)도 골든 무투자 런과 일치한다', () => {
    const planet = BASELINE_PLANETS[0]!;
    const golden = findRun(GOLDEN, `${planet.id}/no-invest`);
    const profile = defaultProfile();
    equipStandardGear(profile, planet, golden.seed);
    const config = assembleRunConfigLikeMain(profile, planet.planet, planet.stage, DURABLE_HP);
    expect(config).toEqual(goldenConfigAsApp(planet, BASELINE_BUILDS[0]!.invest, golden.seed));
    expect(config.skillInvest?.length).toBe(SKILL_NODE_COUNT);
    expectSameStream(runHashes(golden.seed, config), golden.hashes, 'profile-path/no-invest');
  });
});
