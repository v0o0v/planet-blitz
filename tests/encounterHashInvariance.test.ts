/**
 * 조우 프레임워크 + 중반 격전 — **해시 불변식 게이트** (AC1 · AC2).
 *
 * `tests/fixtures/encounter-baseline.json` 은 변경 **전** 커밋(origin/main `9301f10`)을 체크아웃한
 * detached 워크트리에서 `scripts/recordEncounterBaseline.ts` 로 굳힌 per-tick 해시 기준선이다.
 * 이 테스트는 그 기준선을 **읽어서 대조만** 한다 — 절대 다시 쓰지 않는다
 * (`tests/shipHashBaseline.test.ts` 와 같은 성격. 재생성형 픽스처인
 *  `scripts/deno-verify/fixtures.json` 과는 정반대다).
 *
 * ## 무엇을 증명하는가
 *  - **AC1 (조우-absent 불변)**: `worldRng.fork('encounter')` 도입이 기존 RNG 스트림을 한 칸도
 *    밀지 않고, `hashWorld` 의 조우 폴드가 **조건부 꼬리**라서 조우 미발생 런에서는 한 바이트도
 *    추가되지 않는다.
 *  - **AC2 (invasion 불변)**: 중반 격전 세그먼트 삽입이 침공 per-tick 해시를 **바이트 하나도**
 *    바꾸지 않는다. 침공은 `updateWaves` 를 실행하지 않으므로(`world.ts` 의 `if (!designedRun)`)
 *    구조적으로 그래야 하고, 여기서 물증으로 못 박는다.
 *
 * ## 왜 PvE 는 `seg3Tick` 앞까지만 대조하나
 * 중반 격전은 **매 런 등장**이라 PvE 비-invasion baseline 해시를 의도적으로 바꾼다(AC3 —
 * `tests/fixtures/striker-prem8.json` 골든 재생성으로 흡수). 다만 격전 세그먼트는 **중반
 * (index ≥ 1)** 에만 삽입되므로 세그먼트 0~2 구간의 sim 은 삽입 전과 완전히 동일하다. 그 구간의
 * 바이트 일치가 곧 "조우 도입이 한 바이트도 새지 않았다" 는 증명이다.
 *
 * ## 왜 조우가 실제로 발생한 런은 제외하나
 * 조우가 발생하면 `encounterRuntime` 이 서고 조건부 꼬리 폴드가 **켜지는 것이 정상**이다
 * (그게 설계다). 그런 런까지 기준선과 같기를 요구하면 폴드가 아예 없어야 한다는 뜻이 되어
 * 계약과 모순된다. 그래서 대조 대상은 `encounterRuntime === undefined` 인 런으로 한정하고,
 * "그런 런이 최소 1개는 있어야 한다"(=대조가 공회전이 아니다)를 별도로 단언한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWorld, stepWorld, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame } from '../src/sim/world.js';
import { hashWorld, idleInputs } from '../src/sim/replay.js';
import {
  ENCOUNTER_BASELINE_FORMAT,
  ENCOUNTER_BASELINE_PATH,
  PVE_BASELINE_TICKS,
  INVASION_BASELINE_TICKS,
  makeInvasionState,
} from '../scripts/recordEncounterBaseline.js';
import type { EncounterBaseline } from '../scripts/recordEncounterBaseline.js';
import {
  BASELINE_PLANETS,
  BASELINE_BUILDS,
  baselineConfig,
  driveBaseline,
} from '../scripts/recordStrikerBaseline.js';
import type { BuildSpec } from '../scripts/recordStrikerBaseline.js';

// tests/node-shims.d.ts 의 readFileSync 는 encoding 오버로드가 있지만, 다른 골든 테스트와
// 같은 방식으로 디코드해 일관성을 유지한다.
const BASELINE: EncounterBaseline = JSON.parse(
  new TextDecoder().decode(readFileSync(ENCOUNTER_BASELINE_PATH)),
) as EncounterBaseline;

describe('조우 기준선 픽스처', () => {
  it('포맷·규모가 녹화기 계약과 일치한다', () => {
    expect(BASELINE.meta.format).toBe(ENCOUNTER_BASELINE_FORMAT);
    expect(BASELINE.meta.pveTicks).toBe(PVE_BASELINE_TICKS);
    expect(BASELINE.meta.invasionTicks).toBe(INVASION_BASELINE_TICKS);
    expect(BASELINE.pve.length).toBe(BASELINE_PLANETS.length * BASELINE_BUILDS.length);
    expect(BASELINE.invasion.length).toBeGreaterThan(0);
  });
});

describe('AC2 — invasion per-tick 해시 바이트 불변', () => {
  for (const run of BASELINE.invasion) {
    it(`${run.key} 가 중반 격전 삽입 전과 바이트 동일하다`, () => {
      const state = makeInvasionState(run.seed);
      const inputs = idleInputs(run.ticks);
      const hashes: number[] = [];
      for (let t = 0; t < inputs.length; t++) {
        stepWorld(state, inputs[t] as InputFrame);
        hashes.push(hashWorld(state));
      }
      expect(hashes.length).toBe(run.hashes.length);
      // 첫 발산 지점을 정확히 보고한다(전체 배열 diff 는 900칸이라 읽을 수 없다).
      const firstDiff = hashes.findIndex((h, i) => h !== run.hashes[i]);
      expect(firstDiff, `첫 발산 틱 (기대: 발산 없음)`).toBe(-1);
    });
  }

  it('침공 config 로 만든 월드에는 조우가 서지 않는다(PvE 전용 게이트)', () => {
    // 위 대조 하네스는 `createWorld` **뒤에** invasion3 를 싣는다(해시 폴드만 보려는 관측용).
    // 실제 침공 경로는 config 에 invasion3 를 **미리** 실은 채 createWorld 를 부르므로,
    // `cfg.invasion3 === undefined` 게이트가 조우 롤을 막는지는 그 형태로 확인해야 한다.
    const seed = BASELINE.invasion[0]!.seed;
    const inv3 = makeInvasionState(seed).config.invasion3;
    expect(inv3).toBeDefined();
    const invasionWorld = createWorld(seed, {
      ...DEFAULT_CONFIG,
      invasion3: inv3 as NonNullable<typeof inv3>,
    });
    expect((invasionWorld as { encounterRuntime?: unknown }).encounterRuntime).toBeUndefined();
  });
});

describe('AC1 — 조우 미발생 PvE 런의 per-tick 해시 바이트 불변 (중반 격전 이전 구간)', () => {
  for (const [planetIndex, planet] of BASELINE_PLANETS.entries()) {
    for (let b = 0; b < BASELINE_BUILDS.length; b++) {
      const build = BASELINE_BUILDS[b] as BuildSpec;
      const key = `${planet.id}/${build.id}`;
      const run = BASELINE.pve.find((r) => r.key === key);
      it(`${key} — 세그먼트 0~2 구간이 조우 도입 전과 바이트 동일하다`, () => {
        expect(run, `기준선에 ${key} 런이 없다`).toBeDefined();
        const baseRun = run as NonNullable<typeof run>;
        void planetIndex;
        const config = baselineConfig(planet, build.invest);
        const inputs = driveBaseline(baseRun.seed, config, baseRun.ticks);
        const state = createWorld(baseRun.seed, config);
        const encounterPresent =
          (state as { encounterRuntime?: unknown }).encounterRuntime !== undefined;
        const hashes: number[] = [];
        for (let t = 0; t < inputs.length; t++) {
          stepWorld(state, inputs[t] as InputFrame);
          hashes.push(hashWorld(state));
        }
        if (encounterPresent) {
          // 조우가 실제로 발생한 런: 조건부 꼬리 폴드가 켜지는 것이 설계다. 대조 대상이 아니다.
          // 대신 "폴드가 정말 켜졌다"(=기준선과 첫 틱부터 갈린다)를 확인해 조용한 무폴드 회귀를 잡는다.
          expect(hashes[0]).not.toBe(baseRun.hashes[0]);
          return;
        }
        // 중반 격전이 개입하기 전까지만 대조한다(seg3Tick < 0 이면 런 전체).
        const limit = baseRun.seg3Tick < 0 ? baseRun.hashes.length : baseRun.seg3Tick;
        expect(limit).toBeGreaterThan(0);
        const firstDiff = hashes
          .slice(0, limit)
          .findIndex((h, i) => h !== baseRun.hashes[i]);
        expect(firstDiff, `첫 발산 틱 (기대: 발산 없음, 대조 구간 0..${limit})`).toBe(-1);
      });
    }
  }

  it('조우 미발생 런이 최소 1개 대조된다(공회전 방지)', () => {
    // ⚠️ 위 `it` 들이 세는 카운터에 의존하지 않는다 — 그러면 선언 순서(순차 실행)에 묶여
    // `--sequence.concurrent` 로 돌릴 때 잘못 통과/실패한다. 대신 여기서 독립적으로 다시
    // 판정한다. `createWorld` 만 하면 되므로(스텝 불필요) 비용이 거의 없다.
    const absent = BASELINE.pve.filter((run) => {
      const planet = BASELINE_PLANETS.find((p) => run.key.startsWith(p.id + '/'));
      const build = BASELINE_BUILDS.find((b) => run.key.endsWith('/' + b.id));
      if (planet === undefined || build === undefined) return false;
      const world = createWorld(run.seed, baselineConfig(planet, build.invest));
      return (world as { encounterRuntime?: unknown }).encounterRuntime === undefined;
    });
    expect(absent.length).toBeGreaterThan(0);
  });
});
