/**
 * verify-run 검증 코어 — Deno parity + 위조 거부 러너 (M4 Phase A · A2/A3).
 *
 * 두 가지를 Deno에서 증거화한다:
 *   (A2) 검증 코어 이식성 parity: 대표 리플레이 6종(4행성·보스·장기 런)을 Deno에서
 *        재실행해, ① 정직한 제출이 accept 되고 ② Deno가 재계산한 최종 해시가 Node
 *        ground truth(fixtures.json)와 bit-identical 함을 확인. 즉 검증 코어 자체가
 *        Node↔Deno 동형이다(같은 accept/reject 판정 + 같은 해시).
 *   (A3) 위조 거부: 정직한 제출을 4대 시나리오(①조작 해시 ②변조 입력 ③트림 로그
 *        ④승패 뒤집기)로 변형해 100% reject 됨을 확인.
 *
 * 실행: `deno task verify-run` (scripts/deno-verify 에서). deno.json의 sloppy-imports가
 * `.js → .ts` resolve를 담당 — sim·검증 코어 소스 무수정. 불일치 시 종료 코드 1.
 */

import { verifyRun } from '../../supabase/functions/verify-run/verifyCore.ts';
import type { RunSubmission } from '../../supabase/functions/verify-run/verifyCore.ts';
import { runReplay } from '../../src/sim/replay.ts';
import type { Replay } from '../../src/sim/replay.ts';
import type { InputFrame } from '../../src/sim/world.ts';
import { SCENARIOS } from './scenarios.ts';
import type { Fixture } from './common.ts';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function readFixture(): Fixture {
  const url = new URL('./fixtures.json', import.meta.url);
  return JSON.parse(Deno.readTextFileSync(url)) as Fixture;
}

/** 정직한 제출: 서버 재실행 결과를 그대로 주장으로 담는다(accept 되어야 정상). */
function honestSubmission(seed: number, config: Replay['config'], inputs: InputFrame[]): RunSubmission {
  // `config` 는 optional 이라 `exactOptionalPropertyTypes` 아래에서 `undefined` 를 그대로 실을 수
  // 없다 — 바로 아래 제출 조립과 **같은 조건부 스탬프**를 쓴다(둘이 갈리면 재실행에 쓰인 config 와
  // 제출된 config 가 달라진다).
  const r = runReplay({ seed, ...(config === undefined ? {} : { config }), inputs });
  return {
    seed,
    ...(config === undefined ? {} : { config }),
    inputs,
    claim: {
      finalHash: r.finalHash >>> 0,
      hashStream: r.hashes.map((h) => h >>> 0),
      outcome: { victory: r.finalState.victory, gameOver: r.finalState.gameOver },
    },
  };
}

function main(): number {
  console.log(`${CYAN}=== verify-run 검증 코어 — Deno parity + 위조 거부 ===${RESET}`);
  console.log(`${DIM}Deno ${Deno.version.deno} / V8 ${Deno.version.v8}${RESET}\n`);

  const fixture = readFixture();
  const byName = new Map(fixture.scenarios.map((s) => [s.name, s]));
  let failures = 0;

  // --- A2) parity: 대표 리플레이 6종 accept + 최종 해시 == Node ground truth ---
  for (const sc of SCENARIOS) {
    const expected = byName.get(sc.name);
    const inputs = sc.buildInputs();
    const sub = honestSubmission(sc.seed, sc.config, inputs);
    const res = verifyRun(sub);

    const denoFinal = (res.computed?.finalHash ?? 0) >>> 0;
    const nodeFinal = expected === undefined ? -1 : expected.finalHash >>> 0;
    const accepted = res.verdict === 'accept';
    const parity = expected !== undefined && denoFinal === nodeFinal;

    if (accepted && parity) {
      console.log(
        `${GREEN}PASS${RESET} ${sc.name}  ${DIM}accept ticks=${res.computed?.ticks} ` +
          `finalHash=${denoFinal} (Node==Deno)${RESET}`,
      );
    } else {
      failures++;
      if (!accepted) {
        console.log(`${RED}FAIL${RESET} ${sc.name}: 정직한 제출이 reject(${res.reason})`);
      } else if (expected === undefined) {
        console.log(`${RED}FAIL${RESET} ${sc.name}: 픽스처(ground truth)에 없음`);
      } else {
        console.log(
          `${RED}FAIL${RESET} ${sc.name}: 최종 해시 불일치 Node=${nodeFinal} Deno=${denoFinal}`,
        );
      }
    }
  }

  // --- A3) 위조 거부: 대표 시나리오 하나로 4대 공격 변형 ----------------------
  const sc0 = SCENARIOS[0]!;
  const inputs0 = sc0.buildInputs();
  const honest = honestSubmission(sc0.seed, sc0.config, inputs0);

  interface Attack {
    label: string;
    sub: RunSubmission;
    expect: readonly string[];
  }
  const tamperedInputs = inputs0.map((f) => ({ ...f }));
  const mid = Math.floor(tamperedInputs.length / 2);
  tamperedInputs[mid] = { ...tamperedInputs[mid]!, moveX: -tamperedInputs[mid]!.moveX, dash: true };

  const attacks: Attack[] = [
    {
      label: '① 조작된 최종 해시',
      sub: { ...honest, claim: { ...honest.claim, finalHash: (honest.claim.finalHash ^ 0x1) >>> 0 } },
      expect: ['final-hash-mismatch'],
    },
    {
      label: '② 변조된 입력 로그',
      sub: { ...honest, inputs: tamperedInputs },
      expect: ['final-hash-mismatch', 'hash-stream-divergence'],
    },
    {
      label: '③ 트림된(짧은) 로그',
      sub: { ...honest, inputs: inputs0.slice(0, inputs0.length - 100) },
      expect: ['hash-stream-length-mismatch', 'final-hash-mismatch'],
    },
    {
      label: '④ 조작된 결과(승패 뒤집기)',
      sub: {
        ...honest,
        claim: {
          ...honest.claim,
          outcome: { victory: !honest.claim.outcome.victory, gameOver: honest.claim.outcome.gameOver },
        },
      },
      expect: ['outcome-mismatch'],
    },
  ];

  console.log('');
  for (const a of attacks) {
    const res = verifyRun(a.sub);
    if (res.verdict === 'reject' && a.expect.includes(res.reason)) {
      console.log(`${GREEN}PASS${RESET} 위조 거부 ${a.label}  ${DIM}reason=${res.reason}${RESET}`);
    } else {
      failures++;
      console.log(
        `${RED}FAIL${RESET} 위조 거부 ${a.label}: verdict=${res.verdict} reason=${res.reason} ` +
          `(기대 ${a.expect.join('|')})`,
      );
    }
  }

  console.log('');
  if (failures === 0) {
    console.log(`${GREEN}=== 전체 통과: 검증 코어 Node↔Deno 동형 + 위조 100% 거부 ===${RESET}`);
    return 0;
  }
  console.log(`${RED}=== ${failures}건 실패 ===${RESET}`);
  return 1;
}

Deno.exit(main());
