/**
 * M8-L0 — 스트라이커 해시 골든 게이트.
 *
 * `tests/fixtures/striker-prem8.json` 은 **M8 착수 전** 스트라이커 빌드의 상태를 못 박은
 * 골든이다. 이 테스트는 그 골든을 **읽어서 비교만** 한다 — 절대 다시 쓰지 않는다.
 * (재생성형 픽스처인 scripts/deno-verify/fixtures.json 과 정반대 성격이다. 그쪽은 테스트가
 * 매번 다시 굳히므로 시뮬 변경을 통과시키고, 이쪽은 통과시키면 안 된다.)
 *
 * ## 무엇을 막는가
 * 1. `data/skills.ts` 인덱스/트리 슬라이스가 밀려 파워업 추첨 스트림이 갈리는 회귀
 *    — 해시 폴드 레이아웃을 완벽히 보존해도 발생하는 가장 은밀한 M8 위험.
 * 2. `computeLoadoutStats`(캡스톤 비트 포함) 파생 결과 변화.
 * 3. `hashWorld` 폴드 레이아웃 변경이 스트라이커 런에 새는 것(신규 폴드는 `shipType !== 0`
 *    조건부여야 스트라이커가 한 폴드도 실행하지 않는다).
 * 4. `Profile` → 런 설정 조립 경로가 골든과 다른 config 를 만드는 배선 결함.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BASELINE_FIXTURE_PATH,
  BASELINE_BUILDS,
  BASELINE_PLANETS,
  BASELINE_TICKS,
  BASELINE_FORMAT,
  baselineConfig,
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

  it('공허 런이 없다(레벨업·추첨·처치·엔티티가 실제로 발생)', () => {
    for (const r of GOLDEN.runs) {
      expect(r.hashes.length, `${r.key} 해시 길이`).toBe(BASELINE_TICKS);
      expect(r.summary.drawCount, `${r.key} 파워업 추첨 횟수`).toBeGreaterThanOrEqual(3);
      expect(r.powerupDraws.length, `${r.key} 추첨 기록 수`).toBe(r.summary.drawCount);
      expect(r.summary.levelUps, `${r.key} 레벨업 횟수`).toBeGreaterThanOrEqual(3);
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
 * 골든 조립(`baselineConfig`)에 앱 경로가 **명시**하는 두 필드를 더한 형태.
 * 둘 다 값 의미가 미지정과 동일해 해시가 불변이다:
 *  - `anomalyAccepted: false` → `cfg.anomalyAccepted ?? false` · 폴드는 `? 1 : 0`
 *  - `shipType: 0`            → `state.config.shipType ?? 0` · 0 이면 꼬리 폴드 미실행
 * 즉 이 두 줄은 "앱이 더 명시적으로 쓴다"는 사실만 나타내고, 스트라이커 해시 동결
 * (`expectSameStream`)은 아래에서 그대로 증명된다.
 */
function goldenConfigAsApp(planet: PlanetSpec, invest: readonly number[]): WorldConfig {
  return {
    ...baselineConfig(planet, invest),
    anomalyAccepted: false,
    shipType: 0,
    planetMode: PLANET_MODE.vampire,
  };
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

    const config = assembleRunConfigLikeMain(profile, planet.planet, planet.stage, DURABLE_HP);
    // 앱 경로가 만든 config 가 골든 시나리오 config 와 실제로 같은가(배선 증명).
    expect(config).toEqual(goldenConfigAsApp(planet, build.invest));
    // 캡스톤 비트가 실제로 켜졌는가(투자 → 파생 → sim 게이트).
    expect(config.loadout?.uniqueMask).toBe(golden.summary.uniqueMask);

    expectSameStream(runHashes(golden.seed, config), golden.hashes, 'profile-path/firepower');
  });

  it('기본 Profile(무투자)도 골든 무투자 런과 일치한다', () => {
    const planet = BASELINE_PLANETS[0]!;
    const golden = findRun(GOLDEN, `${planet.id}/no-invest`);
    const profile = defaultProfile();
    const config = assembleRunConfigLikeMain(profile, planet.planet, planet.stage, DURABLE_HP);
    expect(config).toEqual(goldenConfigAsApp(planet, BASELINE_BUILDS[0]!.invest));
    expect(config.skillInvest?.length).toBe(SKILL_NODE_COUNT);
    expectSameStream(runHashes(golden.seed, config), golden.hashes, 'profile-path/no-invest');
  });
});
