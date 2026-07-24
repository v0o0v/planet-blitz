/**
 * verify-run 검증 코어 테스트 (M4 Phase A · A3 위조 거부 + 수락, AC2).
 *
 * 전수 재실행 검증 코어(`supabase/functions/verify-run/verifyCore.ts`)를 Node(vitest)
 * 에서 직접 구동한다 — 코어는 플랫폼 전역 무참조라 CI에서 그대로 돈다. 정직한 제출은
 * accept, 4대 위조 시나리오(①조작 해시 ②변조 입력 ③트림 로그 ④승패 뒤집기)는 100%
 * reject 됨을 게이트한다. Deno 측 동형 검증은 `deno task verify-run`.
 */

import { describe, it, expect } from 'vitest';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import {
  createWorld,
  stepWorld,
  emptyInput,
  packPowerupPick,
  DEFAULT_CONFIG,
} from '../src/sim/world.js';
import { runReplay } from '../src/sim/replay.js';
import type { Replay } from '../src/sim/replay.js';
import { verifyRun } from '../supabase/functions/verify-run/verifyCore.js';
import type { RunSubmission } from '../supabase/functions/verify-run/verifyCore.js';
import { SCENARIOS } from '../scripts/deno-verify/scenarios.js';

/**
 * 내구 config: 짧은 창(900틱)에서 사망(gameOver)·승리(victory)에 도달하지 않아
 * 매 틱 상태가 실제로 진화한다(state.tick 증가·엔티티 이동). 종료 후 상태가 얼어붙는
 * 프레임(step 가드 no-op)이 없어야 트림/변조가 최종 해시에 반드시 반영된다.
 */
const DURABLE: WorldConfig = { ...DEFAULT_CONFIG, playerHp: 1_000_000_000 };

/**
 * 라이브 구동 입력 로그: 레벨업 대기 시 파워업 0번을 선택해 월드 정지(pendingLevelUp
 * 프리즈)를 피하고, 그 외에는 로밍 이동. 프리즈가 없어야 플레이어 이동이 상태에 실제로
 * 반영돼 "입력 변조 → 해시 발산" 위조 게이트가 유의미해진다(scenarios.ts driveDurable과
 * 동일 골자, 단 짧은 창). special!==0 프레임은 레벨업 픽(이동 무시)이라 변조 표적에서 제외.
 */
function driveInputs(seed: number, config: WorldConfig, ticks: number): InputFrame[] {
  const state = createWorld(seed, config);
  const inputs: InputFrame[] = [];
  for (let t = 0; t < ticks; t++) {
    const frame: InputFrame = state.pendingLevelUp
      ? { ...emptyInput(), special: packPowerupPick(0) }
      : {
          moveX: Math.sin(t * 0.11),
          moveY: Math.cos(t * 0.07),
          aim: (t * 0.05) % (Math.PI * 2),
          dash: t % 47 === 0,
          special: 0,
        };
    inputs.push(frame);
    stepWorld(state, frame);
    if (state.gameOver || state.victory) break; // DURABLE·짧은 창이라 도달하지 않음(안전장치).
  }
  return inputs;
}

/** 정직한 제출(서버 재실행 결과를 그대로 주장으로 담음) — accept 되어야 정상. */
function honestSubmission(seed: number, inputs: InputFrame[]): RunSubmission {
  const replay: Replay = { seed, config: DURABLE, inputs };
  const r = runReplay(replay);
  return {
    seed,
    config: DURABLE,
    inputs,
    claim: {
      finalHash: r.finalHash >>> 0,
      hashStream: r.hashes.map((h) => h >>> 0),
      outcome: { victory: r.finalState.victory, gameOver: r.finalState.gameOver },
    },
  };
}

const SEED = 0x1234abcd;
const INPUTS = driveInputs(SEED, DURABLE, 900);
/** 변조 표적: 이동이 실제 반영되는 첫 이동 프레임(레벨업 픽 프레임 제외). */
const MOVE_FRAME = INPUTS.findIndex((f, i) => i > 2 && f.special === 0);

describe('verify-run 검증 코어 (M4 Phase A)', () => {
  it('정직한 제출은 accept — 서버 재실행 결과를 computed로 반환', () => {
    const sub = honestSubmission(SEED, INPUTS);
    const res = verifyRun(sub);
    expect(res.verdict).toBe('accept');
    expect(res.reason).toBe('verified');
    expect(res.computed?.ticks).toBe(INPUTS.length);
    expect(res.computed?.finalHash).toBe(sub.claim.finalHash);
  });

  it('hashStream 없이도 최종 해시·결과만으로 accept', () => {
    const sub = honestSubmission(SEED, INPUTS);
    const { hashStream: _drop, ...claimNoStream } = sub.claim;
    const res = verifyRun({ ...sub, claim: claimNoStream });
    expect(res.verdict).toBe('accept');
  });

  // --- A3 위조 시나리오 (모두 reject) -------------------------------------
  it('① 조작된 최종 해시 → reject(final-hash-mismatch)', () => {
    const sub = honestSubmission(SEED, INPUTS);
    const forged: RunSubmission = {
      ...sub,
      claim: { ...sub.claim, finalHash: (sub.claim.finalHash ^ 0x1) >>> 0 },
    };
    const res = verifyRun(forged);
    expect(res.verdict).toBe('reject');
    expect(res.reason).toBe('final-hash-mismatch');
  });

  it('② 변조된 입력 로그(원래 해시 유지) → reject(final-hash-mismatch)', () => {
    const sub = honestSubmission(SEED, INPUTS);
    const tampered = INPUTS.map((f) => ({ ...f }));
    // 이른 이동 프레임 하나만 조작 — 궤적이 즉시 발산해 스트림/최종 해시가 어긋난다.
    tampered[MOVE_FRAME] = { ...tampered[MOVE_FRAME]!, moveX: -tampered[MOVE_FRAME]!.moveX, dash: true };
    const res = verifyRun({ ...sub, inputs: tampered });
    expect(res.verdict).toBe('reject');
    // 최종 해시 또는 스트림 중 먼저 걸리는 쪽(둘 다 위조를 잡음).
    expect(['final-hash-mismatch', 'hash-stream-divergence']).toContain(res.reason);
  });

  it('③ 트림된(짧은) 로그 → reject', () => {
    const sub = honestSubmission(SEED, INPUTS);
    // 원래 주장(전체 finalHash + 전체 hashStream)은 그대로, 입력만 잘라 제출.
    const trimmed = INPUTS.slice(0, INPUTS.length - 120);
    const res = verifyRun({ ...sub, inputs: trimmed });
    expect(res.verdict).toBe('reject');
    // 스트림 길이 불일치가 먼저(스트림 제공 시), 아니면 최종 해시 불일치.
    expect(['hash-stream-length-mismatch', 'final-hash-mismatch']).toContain(res.reason);
  });

  it('③-b 스트림 없이 트림된 로그 → reject(final-hash-mismatch)', () => {
    const sub = honestSubmission(SEED, INPUTS);
    const { hashStream: _drop, ...claimNoStream } = sub.claim;
    const trimmed = INPUTS.slice(0, INPUTS.length - 120);
    const res = verifyRun({ ...sub, inputs: trimmed, claim: claimNoStream });
    expect(res.verdict).toBe('reject');
    expect(res.reason).toBe('final-hash-mismatch');
  });

  it('④ 조작된 결과(승패 뒤집기) → reject(outcome-mismatch)', () => {
    const sub = honestSubmission(SEED, INPUTS);
    // 입력·해시는 정직하되 결과만 뒤집는다 — 서버 재실행 결과와 어긋난다.
    const forged: RunSubmission = {
      ...sub,
      claim: {
        ...sub.claim,
        outcome: { victory: !sub.claim.outcome.victory, gameOver: sub.claim.outcome.gameOver },
      },
    };
    const res = verifyRun(forged);
    expect(res.verdict).toBe('reject');
    expect(res.reason).toBe('outcome-mismatch');
  });

  it('중간 스트림 변조(최종 해시는 정직) → reject(hash-stream-divergence, divergedAt 보고)', () => {
    const sub = honestSubmission(SEED, INPUTS);
    const stream = [...sub.claim.hashStream!];
    stream[300] = (stream[300]! ^ 0xff) >>> 0; // 중간만 오염, 마지막(=finalHash)은 유지.
    const res = verifyRun({ ...sub, claim: { ...sub.claim, hashStream: stream } });
    expect(res.verdict).toBe('reject');
    expect(res.reason).toBe('hash-stream-divergence');
    expect(res.computed?.divergedAt).toBe(300);
  });

  it('스트림 길이만 어긋남(입력·최종 해시 정직) → reject(hash-stream-length-mismatch)', () => {
    const sub = honestSubmission(SEED, INPUTS);
    const shortStream = sub.claim.hashStream!.slice(0, INPUTS.length - 1);
    const res = verifyRun({ ...sub, claim: { ...sub.claim, hashStream: shortStream } });
    expect(res.verdict).toBe('reject');
    expect(res.reason).toBe('hash-stream-length-mismatch');
  });

  // --- 구조 검증(신뢰 경계) ------------------------------------------------
  it('구조 오류는 재실행 이전에 reject', () => {
    const base = honestSubmission(SEED, INPUTS);
    expect(verifyRun(null).reason).toBe('malformed-submission');
    expect(verifyRun({ ...base, seed: Number.NaN }).reason).toBe('malformed-seed');
    expect(verifyRun({ ...base, inputs: [] }).reason).toBe('empty-inputs');
    expect(verifyRun({ ...base, inputs: 'nope' }).reason).toBe('malformed-inputs');
    expect(verifyRun({ ...base, config: 42 }).reason).toBe('malformed-config');
    const badFrame = [{ moveX: 0, moveY: 0, aim: 0, dash: 'yes', special: 0 }];
    expect(verifyRun({ ...base, inputs: badFrame }).reason).toBe('malformed-input-frame');
    const { claim: _c, ...noClaim } = base;
    expect(verifyRun(noClaim).reason).toBe('malformed-claim');
    expect(verifyRun({ ...base, claim: { finalHash: 1, outcome: { victory: 'x', gameOver: false } } }).reason).toBe(
      'malformed-claim',
    );
  });

  // --- 대표 리플레이(실제 시나리오)로 accept 확인 --------------------------
  it('대표 시나리오(③ 촉매 주입 런)를 재실행해 accept', () => {
    const sc = SCENARIOS.find((s) => s.name.startsWith('③'))!;
    const inputs = sc.buildInputs();
    const replay: Replay = { seed: sc.seed, config: sc.config, inputs };
    const r = runReplay(replay);
    const sub: RunSubmission = {
      seed: sc.seed,
      config: sc.config,
      inputs,
      claim: {
        finalHash: r.finalHash >>> 0,
        hashStream: r.hashes.map((h) => h >>> 0),
        outcome: { victory: r.finalState.victory, gameOver: r.finalState.gameOver },
      },
    };
    const res = verifyRun(sub);
    expect(res.verdict).toBe('accept');
    expect(res.computed?.ticks).toBe(inputs.length);
  });
});
