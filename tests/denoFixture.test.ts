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
import { shipSkillNodeCount } from '../data/ships/index.js';
import { hasCapstone } from '../src/sim/capstones.js';
import { SIG_HATCHLING_BROOD } from '../src/sim/shipSignature.js';

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

    // 7종 시나리오(M2 4 + M3 표면 2 + M8 비스트라이커 1), 각자 최종 해시가 유효 u32.
    expect(scenarios.length).toBe(7);
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

  it('⑦ 이 실제로 비스트라이커다 — EF 가 shipType 을 모르면 여기서 갈린다 (설계서 §10-8)', () => {
    // 이 케이스가 지키는 것: 누군가 ⑦ 의 config 에서 shipType/skillInvest 를 떨어뜨려도
    // 다른 테스트는 전부 그린이고, **비스트라이커 커버리지만 조용히 사라진다.**
    const nonStriker = SCENARIOS.find((s) => s.name.startsWith('⑦'));
    expect(nonStriker, '⑦ 비스트라이커 시나리오가 존재해야 한다').toBeDefined();
    expect(nonStriker!.config.shipType).toBe(4);
    // 스트라이커(63)와 길이가 달라야 길이 프리픽스 폴드까지 자극한다.
    expect(nonStriker!.config.skillInvest?.length).toBe(shipSkillNodeCount(4));
    expect(nonStriker!.config.skillInvest?.length).not.toBe(shipSkillNodeCount(0));
    // 시그니처 비트가 실제 로드아웃 마스크에 OR 돼 있다(§10-1 을 fixture 축에서 재확인).
    expect(hasCapstone(nonStriker!.config.loadout!.uniqueMask, SIG_HATCHLING_BROOD)).toBe(true);
    // 그리고 스트라이커 시나리오들은 여전히 shipType 미지정이어야 한다(골든 불변의 전제).
    for (const s of SCENARIOS) {
      if (s.name.startsWith('⑦')) continue;
      expect(s.config.shipType, `${s.name} 는 스트라이커여야 한다`).toBeUndefined();
    }
  });
});
