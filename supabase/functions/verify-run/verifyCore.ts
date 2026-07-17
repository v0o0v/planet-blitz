/**
 * verify-run 검증 코어 (M4 Phase A · ADR-0005).
 *
 * 서버(Edge Function)가 클라이언트 제출 리플레이를 **전수 재실행**해 무결성을
 * 판정하는 순수 로직이다. 이 파일은 플랫폼 전역(`Deno`·`window`·Node `process`)을
 * 일절 참조하지 않는다 — `src/sim/` 공유 소스만 import 한다(갈림길①A, 단일 소스).
 * 덕분에 브라우저(Vite)·Node(vitest)·Deno(Edge Function)에서 동일하게 돈다.
 *
 * HTTP 배선(요청 파싱·Response)은 `index.ts`(Deno.serve 래퍼)가 담당하고, 이
 * 파일은 `verifyRun(raw: unknown): VerifyResult` 하나만 노출한다. 테스트는 이
 * 코어만 import 하므로 Deno 전역 없이 CI(vitest)에서 실행 가능하다.
 *
 * 신뢰 경계: 입력(`raw`)은 **전부 신뢰 불가**로 간주한다. 구조 검증을 먼저 통과한
 * 제출만 재실행하고, 재실행 결과(서버 권위)를 클라이언트 주장과 대조한다. 어긋나면
 * 거부한다 — 서버가 계산한 값이 항상 진실이다(원칙2 서버 권위).
 *
 * ⚠️ carry-forward 게이트(리뷰 MED, Phase D 전제): `config`는 클라이언트가 제출한
 * 값을 **그대로** 재실행할 뿐, 서버가 정의/보유한 config(방어 배치·로드아웃 등)와
 * 대조하지 않는다 — 즉 이 코어는 "제출된 [seed+config+inputs]가 주장된 결과를
 * 내적으로 재현하는가"만 증명하고, "그 config 자체가 정당한가"는 증명하지 않는다.
 * 침공/래더처럼 config 정당성이 결과를 좌우하는 흐름(Phase D 전수 검증)에서는 서버
 * 보유 config와의 대조 게이트를 추가하기 전까지 verify-run을 래더/순위 결정에
 * 배선하지 말 것.
 */

import type { InputFrame, WorldConfig } from '../../../src/sim/world.js';
import { runReplay } from '../../../src/sim/replay.js';
import type { Replay } from '../../../src/sim/replay.js';

/** 클라이언트가 라이브로 기록한 런 주장(무결성 대조 대상). */
export interface RunClaim {
  /** 클라이언트가 계산한 최종 상태 해시. */
  finalHash: number;
  /**
   * (선택) 틱별 상태 해시 스트림. 있으면 매 틱을 대조한다 — 트림/변조가 최종
   * 해시 우연 충돌을 노려도 중간 발산 지점에서 잡힌다. 길이는 inputs와 같아야 한다.
   */
  hashStream?: readonly number[];
  /** 클라이언트가 주장하는 런 결과(승패). 래더 스왑의 근거이므로 반드시 대조한다. */
  outcome: RunOutcome;
}

/** 런 결과 요약(승리/게임오버). victory·gameOver는 재실행 최종 상태에서 도출된다. */
export interface RunOutcome {
  victory: boolean;
  gameOver: boolean;
}

/** 클라이언트가 제출하는 리플레이 무결성 검증 요청. */
export interface RunSubmission {
  seed: number;
  /** (선택) config 오버라이드. 없으면 sim 기본값. */
  config?: WorldConfig;
  inputs: readonly InputFrame[];
  claim: RunClaim;
}

export type Verdict = 'accept' | 'reject';

/**
 * 거부 사유 코드(기계 판독용, 한글 번역 금지 — 로그·클라이언트 분기 키).
 * - malformed-*  : 구조 검증 실패(재실행 이전).
 * - replay-threw : 재실행 중 예외(비정상 config/입력).
 * - *-mismatch   : 재실행 결과가 클라이언트 주장과 불일치(위조).
 */
export type RejectReason =
  | 'malformed-submission'
  | 'malformed-seed'
  | 'malformed-config'
  | 'malformed-inputs'
  | 'empty-inputs'
  | 'inputs-too-long'
  | 'malformed-input-frame'
  | 'malformed-claim'
  | 'malformed-hash-stream'
  | 'replay-threw'
  | 'final-hash-mismatch'
  | 'hash-stream-length-mismatch'
  | 'hash-stream-divergence'
  | 'outcome-mismatch';

export type ReasonCode = 'verified' | RejectReason;

/** 서버가 재실행으로 도출한 사실(재실행이 일어난 경우에만 존재). */
export interface ComputedFacts {
  finalHash: number;
  ticks: number;
  outcome: RunOutcome;
  /** hashStream 대조에서 처음 어긋난 틱 인덱스(불일치 시에만). */
  divergedAt?: number;
}

export interface VerifyResult {
  verdict: Verdict;
  reason: ReasonCode;
  computed?: ComputedFacts;
}

/**
 * 입력 프레임 상한(DoS·과금 방어). 600초 런 = 36000틱. 여유롭게 3배.
 * Phase D 침공 검증에서 모드별 상한으로 좁힐 수 있으나, Phase A 기본 게이트는 넉넉히.
 */
export const MAX_INPUT_TICKS = 108_000;

function reject(reason: RejectReason, computed?: ComputedFacts): VerifyResult {
  return computed === undefined
    ? { verdict: 'reject', reason }
    : { verdict: 'reject', reason, computed };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** InputFrame 구조 검증(재실행 이전에 오염 프레임을 걸러 runReplay 예외를 방지). */
function isValidFrame(f: unknown): f is InputFrame {
  if (typeof f !== 'object' || f === null) return false;
  const r = f as Record<string, unknown>;
  return (
    isFiniteNumber(r.moveX) &&
    isFiniteNumber(r.moveY) &&
    isFiniteNumber(r.aim) &&
    typeof r.dash === 'boolean' &&
    isFiniteNumber(r.special)
  );
}

/**
 * 리플레이 제출을 전수 재실행해 무결성을 판정한다. 신뢰 불가 입력(`raw`)을 받아
 * 구조 검증 → 재실행 → 서버 권위 결과와 클라이언트 주장 대조 순으로 처리한다.
 *
 * 위조 방어(A3):
 *   ① 조작된 최종 해시   → final-hash-mismatch
 *   ② 변조된 입력 로그   → final-hash-mismatch(또는 hash-stream-divergence)
 *   ③ 트림된(짧은) 로그  → final-hash-mismatch / hash-stream-length-mismatch
 *   ④ 조작된 결과(승패)  → outcome-mismatch
 */
export function verifyRun(raw: unknown): VerifyResult {
  // --- 1) 구조 검증(신뢰 경계) -------------------------------------------
  if (typeof raw !== 'object' || raw === null) return reject('malformed-submission');
  const sub = raw as Record<string, unknown>;

  if (!isFiniteNumber(sub.seed)) return reject('malformed-seed');

  let config: WorldConfig | undefined;
  if (sub.config !== undefined) {
    if (typeof sub.config !== 'object' || sub.config === null) return reject('malformed-config');
    config = sub.config as WorldConfig;
  }

  if (!Array.isArray(sub.inputs)) return reject('malformed-inputs');
  const inputs = sub.inputs as readonly unknown[];
  if (inputs.length === 0) return reject('empty-inputs');
  if (inputs.length > MAX_INPUT_TICKS) return reject('inputs-too-long');
  for (const frame of inputs) {
    if (!isValidFrame(frame)) return reject('malformed-input-frame');
  }

  if (typeof sub.claim !== 'object' || sub.claim === null) return reject('malformed-claim');
  const claim = sub.claim as Record<string, unknown>;
  if (!isFiniteNumber(claim.finalHash)) return reject('malformed-claim');
  if (typeof claim.outcome !== 'object' || claim.outcome === null) return reject('malformed-claim');
  const claimedOutcome = claim.outcome as Record<string, unknown>;
  if (typeof claimedOutcome.victory !== 'boolean' || typeof claimedOutcome.gameOver !== 'boolean') {
    return reject('malformed-claim');
  }

  let claimedStream: readonly number[] | undefined;
  if (claim.hashStream !== undefined) {
    if (!Array.isArray(claim.hashStream)) return reject('malformed-hash-stream');
    for (const h of claim.hashStream) {
      if (!isFiniteNumber(h)) return reject('malformed-hash-stream');
    }
    claimedStream = claim.hashStream as readonly number[];
  }

  // --- 2) 전수 재실행(서버 권위) -----------------------------------------
  const replay: Replay = config === undefined
    ? { seed: sub.seed, inputs: inputs as InputFrame[] }
    : { seed: sub.seed, config, inputs: inputs as InputFrame[] };

  let hashes: number[];
  let finalHash: number;
  let victory: boolean;
  let gameOver: boolean;
  try {
    const result = runReplay(replay);
    hashes = result.hashes;
    finalHash = result.finalHash >>> 0;
    victory = result.finalState.victory;
    gameOver = result.finalState.gameOver;
  } catch {
    return reject('replay-threw');
  }

  const computed: ComputedFacts = {
    finalHash,
    ticks: hashes.length,
    outcome: { victory, gameOver },
  };

  // --- 3) 서버 결과 vs 클라이언트 주장 대조 -------------------------------
  // 3a) 최종 해시(①②③).
  if (finalHash !== (claim.finalHash >>> 0)) {
    return reject('final-hash-mismatch', computed);
  }

  // 3b) 틱별 해시 스트림(제공된 경우) — 트림/중간 변조를 조기 검출.
  if (claimedStream !== undefined) {
    if (claimedStream.length !== hashes.length) {
      return reject('hash-stream-length-mismatch', computed);
    }
    for (let i = 0; i < hashes.length; i++) {
      if (((claimedStream[i] as number) >>> 0) !== ((hashes[i] as number) >>> 0)) {
        return reject('hash-stream-divergence', { ...computed, divergedAt: i });
      }
    }
  }

  // 3c) 결과(승패) — 래더 근거이므로 재실행 최종 상태로 검증(④).
  if (victory !== claimedOutcome.victory || gameOver !== claimedOutcome.gameOver) {
    return reject('outcome-mismatch', computed);
  }

  return { verdict: 'accept', reason: 'verified', computed };
}
