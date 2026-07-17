/**
 * verify-pve-sample 검증 코어 — Deno 검증 + 위조/조작 거부 러너 (M4 Phase F · F4 · AC11).
 *
 * verify-run 러너(verifyRun.ts)의 PvE 표본 재실행판. 다음을 Deno 에서 증거화한다:
 *   (정상)   저장된 PvE 런(리플레이 + 정직한 해시 스트림·승패)을 재실행하면 accept →
 *            verified 확정 대상.
 *   (위조)   조작 해시 · 변조 입력 · 트림 로그 · 승패 뒤집기 100% reject → rejected 확정 +
 *            계정 플래그(적발) 대상.
 *   (승리/게임오버 독립) PvE 는 승리·게임오버가 둘 다 false 인 종료(예: 세그먼트 상한 도달)도
 *            있으므로, 저장된 두 플래그를 그대로 재현하는 정직 런은 accept 되어야 한다.
 *
 * 실행: `deno task verify-pve` (scripts/deno-verify 에서). sloppy-imports 로 `.js → .ts`
 * resolve — sim·검증 코어 소스 무수정. 불일치 시 종료 코드 1.
 */

import { verifyPveRun } from '../../supabase/functions/verify-pve-sample/verifyPveCore.ts';
import { runReplay } from '../../src/sim/replay.ts';
import type { Replay } from '../../src/sim/replay.ts';
import type { InputFrame } from '../../src/sim/world.ts';
import { SCENARIOS } from './scenarios.ts';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

/** 저장된 pve_runs 한 행(정직판): 리플레이를 재실행해 client_result 를 그대로 담는다. */
function honestRow(seed: number, config: Replay['config'], inputs: InputFrame[]): {
  replay: unknown;
  client_result: unknown;
} {
  const r = runReplay({ seed, config, inputs });
  return {
    replay: { seed, ...(config === undefined ? {} : { config }), inputs },
    client_result: {
      victory: r.finalState.victory,
      gameOver: r.finalState.gameOver,
      finalTick: inputs.length,
      finalHash: r.finalHash >>> 0,
      hashStream: r.hashes.map((h) => h >>> 0),
    },
  };
}

function main(): number {
  console.log(`${CYAN}=== verify-pve-sample 검증 코어 — Deno 검증 + 위조/조작 거부 ===${RESET}`);
  console.log(`${DIM}Deno ${Deno.version.deno} / V8 ${Deno.version.v8}${RESET}\n`);

  let failures = 0;

  function expectAccept(label: string, row: { replay: unknown; client_result: unknown }): void {
    const res = verifyPveRun(row);
    if (res.verdict === 'accept') {
      console.log(`${GREEN}PASS${RESET} ${label}  ${DIM}accept ticks=${res.computed?.ticks}${RESET}`);
    } else {
      failures++;
      console.log(`${RED}FAIL${RESET} ${label}: 정직한 런이 reject(${res.reason})`);
    }
  }
  function expectReject(
    label: string,
    row: { replay: unknown; client_result: unknown },
    expected: readonly string[],
  ): void {
    const res = verifyPveRun(row);
    if (res.verdict === 'reject' && expected.includes(res.reason)) {
      console.log(`${GREEN}PASS${RESET} ${label}  ${DIM}reason=${res.reason}${RESET}`);
    } else {
      failures++;
      console.log(
        `${RED}FAIL${RESET} ${label}: verdict=${res.verdict} reason=${res.reason} (기대 ${expected.join('|')})`,
      );
    }
  }

  // --- 정상: 대표 PvE 리플레이(4행성·보스·장기 런)를 정직 재현 → accept ---
  for (const sc of SCENARIOS) {
    const inputs = sc.buildInputs();
    expectAccept(`정직한 PvE 런 재실행: ${sc.name}`, honestRow(sc.seed, sc.config, inputs));
  }

  // --- 위조 4대 시나리오(AC11) — 대표 시나리오 하나로 변형 ---
  const sc0 = SCENARIOS[0]!;
  const inputs0 = sc0.buildInputs();
  const base = honestRow(sc0.seed, sc0.config, inputs0);
  const baseCr = base.client_result as {
    victory: boolean;
    gameOver: boolean;
    finalTick: number;
    finalHash: number;
    hashStream: number[];
  };

  // ① 조작된 최종 해시.
  expectReject(
    '① 조작된 최종 해시',
    { replay: base.replay, client_result: { ...baseCr, finalHash: (baseCr.finalHash ^ 0x1) >>> 0 } },
    ['final-hash-mismatch', 'hash-stream-divergence'],
  );
  // ② 변조된 입력 로그.
  const tampered = inputs0.map((f) => ({ ...f }));
  const mid = Math.floor(tampered.length / 2);
  tampered[mid] = { ...tampered[mid]!, moveX: -tampered[mid]!.moveX, dash: true };
  expectReject(
    '② 변조된 입력 로그',
    { replay: { ...(base.replay as object), inputs: tampered }, client_result: baseCr },
    ['final-hash-mismatch', 'hash-stream-divergence'],
  );
  // ③ 트림된(짧은) 로그.
  expectReject(
    '③ 트림된(짧은) 로그',
    {
      replay: { ...(base.replay as object), inputs: inputs0.slice(0, inputs0.length - 100) },
      client_result: baseCr,
    },
    ['hash-stream-length-mismatch', 'final-hash-mismatch'],
  );
  // ④ 조작된 결과(승패 뒤집기).
  expectReject(
    '④ 조작된 결과(승패 뒤집기)',
    { replay: base.replay, client_result: { ...baseCr, victory: !baseCr.victory } },
    ['outcome-mismatch'],
  );

  console.log('');
  if (failures === 0) {
    console.log(`${GREEN}=== 전체 통과: PvE 표본 재실행 정상 accept + 위조 100% 거부 ===${RESET}`);
    return 0;
  }
  console.log(`${RED}=== ${failures}건 실패 ===${RESET}`);
  return 1;
}

Deno.exit(main());
