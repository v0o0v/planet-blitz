/**
 * Deno 교차 검증 픽스처 생성 + Node 자기 결정론 게이트 (M4 선행 스파이크).
 *
 * 이 테스트는 두 가지를 한다:
 *   1. scripts/deno-verify/scenarios.ts의 4개 대표 시나리오를 Node(V8)에서
 *      실행해 기대 해시·드랍 시퀀스·롤 결과·수학 프로브를 fixtures.json으로 굳힌다
 *      (Deno 러너 verify.ts가 이 파일을 읽어 재현 비교).
 *   2. Node에서 두 번 실행해 bit-identical 함을 확인한다(입력 생성·시뮬·해시가
 *      Node 안에서도 완전 결정론임을 보장 — Deno 비교의 전제).
 *
 * fixtures.json은 커밋되어 `deno task verify`가 단독 실행 가능하다. 시뮬을 바꾸면
 * 이 테스트가 파일을 다시 굳히므로(내용 결정론적) 재생성은 `npm test`로 충분하다.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeScenario, mathProbe } from '../scripts/deno-verify/common.js';
import type { Fixture } from '../scripts/deno-verify/common.js';
import { SCENARIOS } from '../scripts/deno-verify/scenarios.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('../scripts/deno-verify/fixtures.json', import.meta.url),
);

describe('Deno 교차 검증 픽스처 (M4 스파이크)', () => {
  it('4개 대표 시나리오를 Node에서 실행해 fixtures.json으로 굳힌다', () => {
    const scenarios = SCENARIOS.map((sc) => computeScenario(sc));
    const fixture: Fixture = {
      meta: {
        generatedBy: 'tests/denoFixture.test.ts (Node/vitest)',
        node: process.version,
        scenarioCount: scenarios.length,
      },
      mathProbe: mathProbe(),
      scenarios,
    };
    writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n', 'utf8');

    // 6종 시나리오(M2 4 + M3 표면 2), 각자 최종 해시가 존재하고 유효 u32.
    expect(scenarios.length).toBe(6);
    for (const s of scenarios) {
      expect(Number.isInteger(s.finalHash)).toBe(true);
      expect(s.finalHash).toBeGreaterThanOrEqual(0);
      expect(s.ticks).toBeGreaterThan(0);
    }
  });

  it('Node 안에서 두 번 실행이 bit-identical(입력·시뮬·해시 완전 결정론)', () => {
    for (const sc of SCENARIOS) {
      const a = computeScenario(sc);
      const b = computeScenario(sc);
      expect(a.finalHash).toBe(b.finalHash);
      expect(a.inputsHash).toBe(b.inputsHash);
      expect(a.checkpoints).toEqual(b.checkpoints);
      expect(a.loot).toEqual(b.loot);
      expect(a.rolls).toEqual(b.rolls);
    }
    expect(mathProbe()).toBe(mathProbe());
  });

  it('대표 시나리오가 실제로 의미 있는 상태를 만든다(공허 런 방지)', () => {
    const results = SCENARIOS.map((sc) => computeScenario(sc));
    // ②·④ 내구 파일럿 런은 보스까지 도달해 loot가 쌓여야 한다.
    const berdan = results.find((r) => r.name.startsWith('②'))!;
    expect(berdan.summary.bossSpawned).toBe(true);
    expect(berdan.loot.length).toBeGreaterThan(0);
    // 모든 시나리오가 체크포인트를 남길 만큼 충분히 길다.
    for (const r of results) {
      expect(r.checkpoints.length).toBeGreaterThan(0);
    }
  });
});
