/**
 * verify-pve-sample 검증 코어 (M4 Phase F · F4 · ADR-0005).
 *
 * 서버가 표본으로 뽑은 PvE 런(`pve_runs` 한 행)을 **전수 재실행**해 무결성을 판정하는 순수
 * 로직이다. 이 파일은 플랫폼 전역(`Deno`·`window`·Node `process`)을 일절 참조하지 않고,
 * Phase A 의 verify-run 검증 코어(`verifyRun`)를 그대로 재사용한다 — PvE 런은 방어자·래더가
 * 없어 "제출된 [seed+config+inputs] 가 주장된 결과(해시 스트림·승패)를 내적으로 재현하는가"만
 * 증명하면 되고, 이는 verify-run 코어가 정확히 하는 일이다(리플레이 결정론 재현 검증).
 *
 * HTTP·Auth·DB I/O 배선은 `index.ts`(Deno.serve)가 담당한다. 테스트는 이 코어만 import
 * 하므로 Deno 전역 없이 CI(vitest/Deno)에서 실행 가능하다.
 *
 * 신뢰 경계: 저장된 행(`replay`·`client_result`)도 클라이언트가 원래 제출한 값이라 신뢰
 * 불가로 간주한다 — verifyRun 이 구조 검증 → 재실행 → 서버 권위 결과 대조를 수행한다.
 */

import { verifyRun } from '../verify-run/verifyCore.ts';
import type { VerifyResult } from '../verify-run/verifyCore.ts';

/** `pve_runs` 한 행에서 검증에 필요한 raw 필드(신뢰 불가). */
export interface PveRunRow {
  /** { seed, config?, inputs } — 재현 입력. */
  replay: unknown;
  /** 클라 주장 { victory, gameOver, finalTick, finalHash, hashStream }. */
  client_result: unknown;
}

/**
 * PvE 런 한 행을 전수 재실행해 무결성을 판정한다. 저장된 리플레이·클라 주장을 verify-run
 * 코어의 `RunSubmission` 형태로 사상해 넘긴다:
 *   - claim.finalHash / hashStream : 침공과 동일한 해시 스트림 계약(틱별 uint32).
 *   - claim.outcome : PvE 는 승리/게임오버가 독립일 수 있어(둘 다 false 가능) 저장된 두
 *     플래그를 그대로 주장으로 싣고, 재실행 최종 상태와 대조한다(outcome-mismatch).
 *
 * 위조/조작 방어(F4·ADR-0005): 조작 해시 → final-hash-mismatch, 변조/트림 입력 →
 * hash-stream-divergence / hash-stream-length-mismatch, 승패 조작 → outcome-mismatch.
 */
export function verifyPveRun(row: PveRunRow): VerifyResult {
  const replay = (row.replay ?? {}) as { seed?: unknown; config?: unknown; inputs?: unknown };
  const cr = (row.client_result ?? {}) as {
    victory?: unknown;
    gameOver?: unknown;
    finalHash?: unknown;
    hashStream?: unknown;
  };
  const submission = {
    seed: replay.seed,
    config: replay.config,
    inputs: replay.inputs,
    claim: {
      finalHash: cr.finalHash,
      hashStream: cr.hashStream,
      outcome: { victory: cr.victory === true, gameOver: cr.gameOver === true },
    },
  };
  return verifyRun(submission);
}
