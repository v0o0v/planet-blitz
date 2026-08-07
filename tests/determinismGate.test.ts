/**
 * 결정론 게이트 — **값싼 자기 재현성 검사** (ADR-0050 §결정 1·2, 삭제 레인 C).
 *
 * `scripts/deno-verify/**`(Deno↔Node 교차 검증) 와 `tests/shipHashBaseline.test.ts` ·
 * `tests/encounterHashInvariance.test.ts`(교차 런타임/골든 대조) 는 서버가 Deno 였을 때만
 * 의미가 있던 축이라 삭제됐다(ADR-0050 §결정 1). 그러나 그 셋이 지키던 것 중 **결정론 자체**
 * (같은 시드 두 번 → 같은 해시)는 밸런스 계측 전체가 딛고 서 있는 전제다 — A/B 교환 대조가
 * 성립하려면 "같은 시드 → 같은 결과"가 참이어야 한다. 그래서 그 축만 골라 여기로 옮겼다.
 *
 * ## 옮긴 것 vs 버린 것
 *  - 옮김: **자기 자신과의 재현성**(같은 입력을 두 번 돌려 원소 단위 해시 일치) — 골든 상수에
 *    의존하지 않는 축. `shipHashBaseline` 의 "녹화 자체가 결정론이다" 케이스, `denoFixture` 의
 *    "Node 두 번 실행 bit-identical" 케이스, `encounterHashInvariance` AC2 의 침공 재현성이
 *    이 성격이었다.
 *  - 버림: **골든 상수와의 대조**(shipHashBaseline 의 12런×동결 해시, denoFixture 의 커밋된
 *    fixtures.json, encounterHashInvariance 의 AC1 조우-부재 불변) — 이건 "동결값과 같은가"를
 *    묻는 축이라 이 게이트의 요점("두 번 돌리면 같은가")과 다르다. 새 골든 상수를 여기서 만들면
 *    방금 지운 유지비를 그대로 복원하는 셈이라 만들지 않는다.
 *
 * ## 왜 이만큼만 굴리나
 * 대표 행성(카르곤·베르단) × 대표 빌드(무투자·화력 몰빵·만렙 근접) × 500틱 + 침공 300틱만
 * 자기-대조한다. 골든 대조가 아니므로 전체 12빌드 × 6000틱을 반복할 필요가 없다 — 재현성은
 * 결정론 버그가 있으면 몇백 틱 안에도 드러난다(RNG 스트림이 한 번 갈리면 그 뒤로 전부 갈린다).
 * 실측(2026-08-07, 본 워크트리): 이 파일 전체 약 3초.
 */

import { describe, it, expect } from 'vitest';
import {
  BASELINE_PLANETS,
  BASELINE_BUILDS,
  gearedBaselineConfig,
  driveBaseline,
} from '../scripts/recordStrikerBaseline.js';
import type { PlanetSpec, BuildSpec } from '../scripts/recordStrikerBaseline.js';
import { makeInvasionState } from '../scripts/recordEncounterBaseline.js';
import { createWorld, stepWorld } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { hashWorld, idleInputs } from '../src/sim/replay.js';

/** PvE 자기-대조 창. 결정론 발산은 몇 틱만 지나도 드러나므로 골든 창(6000)보다 훨씬 짧다. */
const GATE_TICKS = 500;
/** 침공 자기-대조 창. */
const INVASION_GATE_TICKS = 300;

/** 대표 조합만 — 전 12빌드가 아니라 축 3종(무투자·화력 몰빵·만렙 근접) × 행성 2종. */
const GATE_BUILDS: readonly BuildSpec[] = BASELINE_BUILDS.filter((b) =>
  ['no-invest', 'axis-firepower', 'near-max'].includes(b.id),
);

/** 같은 seed·config·input log 로 두 번 재생해 per-tick 해시가 원소 단위로 같은지 본다. */
function runHashesTwice(
  seed: number,
  config: WorldConfig,
  inputs: readonly InputFrame[],
): [number[], number[]] {
  const run = (): number[] => {
    const state = createWorld(seed, config);
    const hashes: number[] = [];
    for (const f of inputs) {
      stepWorld(state, f);
      hashes.push(hashWorld(state));
    }
    return hashes;
  };
  return [run(), run()];
}

function expectElementwiseEqual(a: readonly number[], b: readonly number[], key: string): void {
  expect(a.length, `${key}: 해시 스트림 길이`).toBe(b.length);
  let firstDiff = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      firstDiff = i;
      break;
    }
  }
  const detail =
    firstDiff < 0
      ? ''
      : `${key}: 틱 ${firstDiff + 1} 에서 두 재생이 서로 갈림 ` +
        `(0x${(a[firstDiff] as number).toString(16)} ≠ 0x${(b[firstDiff] as number).toString(16)})`;
  expect(firstDiff, detail).toBe(-1);
}

describe('결정론 게이트 — PvE (같은 시드 두 번 → 같은 해시)', () => {
  for (const planet of BASELINE_PLANETS as readonly PlanetSpec[]) {
    for (const build of GATE_BUILDS) {
      const key = `${planet.id}/${build.id}`;
      it(`${key} — ${GATE_TICKS}틱 재현성`, () => {
        const seed = (planet.seedBase + build.invest.length * 0x777) >>> 0;
        const config = gearedBaselineConfig(planet, build.invest, seed);
        const inputs = driveBaseline(seed, config, GATE_TICKS);
        const [a, b] = runHashesTwice(seed, config, inputs);
        expectElementwiseEqual(a, b, key);

        // 공허 방어: sim 이 죽은 채로 재현성만 참인 상태를 잡는다.
        expect(new Set(a).size, `${key}: 서로 다른 해시 수`).toBeGreaterThan(GATE_TICKS / 2);
        const finalState = (() => {
          const s = createWorld(seed, config);
          for (const f of inputs) stepWorld(s, f);
          return s;
        })();
        expect(finalState.entities.length, `${key}: 최종 엔티티 수`).toBeGreaterThan(1);
      });
    }
  }
});

describe('결정론 게이트 — 침공 (같은 시드 두 번 → 같은 해시)', () => {
  const INVASION_SEEDS: readonly number[] = [4242, 0xbeef, 0x1357];

  for (const seed of INVASION_SEEDS) {
    it(`invasion/${seed} — ${INVASION_GATE_TICKS}틱 재현성`, () => {
      const inputs = idleInputs(INVASION_GATE_TICKS);
      const run = (): number[] => {
        const state = makeInvasionState(seed);
        const hashes: number[] = [];
        for (const f of inputs) {
          stepWorld(state, f as InputFrame);
          hashes.push(hashWorld(state));
        }
        return hashes;
      };
      const a = run();
      const b = run();
      expectElementwiseEqual(a, b, `invasion/${seed}`);
      // 공허 방어: 무입력이어도 월드는 계속 진행한다(스크롤·타이머) — 정지 상태로 통과하지 않는다.
      expect(new Set(a).size, `invasion/${seed}: 서로 다른 해시 수`).toBeGreaterThan(
        INVASION_GATE_TICKS / 2,
      );
    });
  }
});

describe('결정론 게이트 — 서로 다른 입력은 서로 다른 결과를 낸다 (공회전 방지)', () => {
  it('시드가 다르면 같은 조합이라도 해시가 갈린다', () => {
    const planet = BASELINE_PLANETS[0] as PlanetSpec;
    const build = GATE_BUILDS[0] as BuildSpec;
    const seedA = planet.seedBase >>> 0;
    const seedB = (planet.seedBase ^ 0x2468) >>> 0;
    const configA = gearedBaselineConfig(planet, build.invest, seedA);
    const configB = gearedBaselineConfig(planet, build.invest, seedB);
    const inputsA = driveBaseline(seedA, configA, GATE_TICKS);
    const inputsB = driveBaseline(seedB, configB, GATE_TICKS);
    const [a] = runHashesTwice(seedA, configA, inputsA);
    const [b] = runHashesTwice(seedB, configB, inputsB);
    expect(a.at(-1)).not.toBe(b.at(-1));
  });
});
