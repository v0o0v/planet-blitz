/**
 * Deno 결정론 검증 러너 (M4 선행 스파이크).
 *
 * fixtures.json(Node/vitest가 생성한 ground truth)을 읽어, 시뮬 코어와 롤러를
 * Deno에서 재실행하고 모든 값을 bit-identical 비교한다:
 *   - 시나리오별 최종 해시 · 매 600틱 체크포인트 해시
 *   - 입력 로그 해시(입력 생성 결정론)
 *   - 드랍 시드 시퀀스(loot)
 *   - rollItem / rerollAffixes 결과(id·slot·rarity·weaponType·uniqueId·affixes)
 *   - 수학 표면 프로브(f64·비트·Math.fround·자체 trig)
 *
 * 실행: `deno task verify` (scripts/deno-verify 에서). deno.json의 unstable
 * sloppy-imports가 `.js` → `.ts` resolve를 담당하므로 소스는 무수정.
 *
 * 불일치가 하나라도 있으면 종료 코드 1.
 */

import { computeScenario, mathProbe } from './common.ts';
import type { Fixture, ScenarioResult } from './common.ts';
import { SCENARIOS } from './scenarios.ts';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function readFixture(): Fixture {
  const url = new URL('./fixtures.json', import.meta.url);
  const text = Deno.readTextFileSync(url);
  return JSON.parse(text) as Fixture;
}

interface Diff {
  path: string;
  expected: unknown;
  actual: unknown;
}

function collectDiffs(path: string, exp: unknown, act: unknown, out: Diff[]): void {
  if (exp === act) return;
  if (
    typeof exp === 'object' &&
    exp !== null &&
    typeof act === 'object' &&
    act !== null
  ) {
    const keys = new Set([...Object.keys(exp), ...Object.keys(act)]);
    for (const k of keys) {
      collectDiffs(
        `${path}.${k}`,
        (exp as Record<string, unknown>)[k],
        (act as Record<string, unknown>)[k],
        out,
      );
    }
    return;
  }
  out.push({ path, expected: exp, actual: act });
}

/** 요약(summary)은 해시 비교 대상이 아니므로 제외하고 비교. */
function comparable(r: ScenarioResult): Omit<ScenarioResult, 'summary'> {
  const { summary: _summary, ...rest } = r;
  return rest;
}

function main(): number {
  console.log(`${CYAN}=== Planet Blitz — Deno 결정론 교차 검증 ===${RESET}`);
  console.log(`${DIM}Deno ${Deno.version.deno} / V8 ${Deno.version.v8}${RESET}\n`);

  const fixture = readFixture();
  let failures = 0;

  // 1) 수학 표면 프로브.
  const mp = mathProbe();
  if (mp === fixture.mathProbe) {
    console.log(`${GREEN}PASS${RESET} 수학 표면 프로브  hash=${mp >>> 0}`);
  } else {
    failures++;
    console.log(
      `${RED}FAIL${RESET} 수학 표면 프로브  expected=${fixture.mathProbe >>> 0} actual=${mp >>> 0}`,
    );
  }

  // 2) 시나리오별 재실행 비교.
  const byName = new Map(fixture.scenarios.map((s) => [s.name, s]));
  for (const sc of SCENARIOS) {
    const expected = byName.get(sc.name);
    if (expected === undefined) {
      failures++;
      console.log(`${RED}FAIL${RESET} ${sc.name}: 픽스처에 없음`);
      continue;
    }
    const actual = computeScenario(sc);
    const diffs: Diff[] = [];
    collectDiffs('', comparable(expected), comparable(actual), diffs);
    if (diffs.length === 0) {
      console.log(
        `${GREEN}PASS${RESET} ${sc.name}  ` +
          `${DIM}ticks=${actual.ticks} finalHash=${actual.finalHash >>> 0} ` +
          `ckpt=${actual.checkpoints.length} loot=${actual.loot.length} ` +
          `victory=${actual.summary.victory}${RESET}`,
      );
    } else {
      failures++;
      console.log(`${RED}FAIL${RESET} ${sc.name}  (${diffs.length} 불일치)`);
      for (const d of diffs.slice(0, 8)) {
        console.log(`   ${d.path}: expected=${JSON.stringify(d.expected)} actual=${JSON.stringify(d.actual)}`);
      }
    }
  }

  console.log('');
  if (failures === 0) {
    console.log(`${GREEN}=== 전체 통과: Node ↔ Deno bit-identical ===${RESET}`);
    return 0;
  }
  console.log(`${RED}=== ${failures}건 불일치 — 결정론 위반 ===${RESET}`);
  return 1;
}

Deno.exit(main());
