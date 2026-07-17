/**
 * verify-invasion 검증 코어 테스트 (M4 Phase D · D1 위조/게이트 거부 + 수락, AC2).
 *
 * 침공 전수 재실행 검증 코어(`supabase/functions/verify-invasion/verifyInvasionCore.ts`)를
 * Node(vitest)에서 직접 구동한다 — 코어는 플랫폼 전역 무참조라 CI에서 그대로 돈다.
 * 정직한 제출은 accept, 침공 게이트(hashStream 필수·config.invasion 필수·방어 배치
 * 정당성·입력 길이 상한)와 4대 위조(①조작 해시 ②변조 입력 ③트림 로그 ④승패 뒤집기)는
 * 100% reject 됨을 게이트한다. Deno 측 동형 검증은 `deno task verify-invasion`.
 */

import { describe, it, expect } from 'vitest';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { runReplay } from '../src/sim/replay.js';
import { verifyInvasion } from '../supabase/functions/verify-invasion/verifyInvasionCore.js';
import type { InvasionServerContext } from '../supabase/functions/verify-invasion/verifyInvasionCore.js';
import {
  DEFAULT_TIME_LIMIT_TICKS,
  TURRET_VULCAN,
  TURRET_SNIPER,
  TURRET_SHOTGUN,
} from '../src/sim/defense.js';
import type { DefenseLayout } from '../src/sim/defense.js';

const SERVER_LAYOUT: DefenseLayout = {
  core: { x: 900, y: 0 },
  turrets: [
    { type: TURRET_VULCAN, x: 400, y: -150 },
    { type: TURRET_SNIPER, x: 500, y: 200 },
    { type: TURRET_SHOTGUN, x: 250, y: 0 },
  ],
  obstacles: [{ x: 450, y: 0, halfW: 50, halfH: 120 }],
};

function invasionConfig(layout: DefenseLayout, timeLimitTicks = DEFAULT_TIME_LIMIT_TICKS): WorldConfig {
  return {
    arenaWidth: 1920,
    arenaHeight: 1080,
    playerSpeed: 720,
    dashSpeed: 2800,
    dashCooldownTicks: 42,
    dashIframes: 10,
    hitIframes: 40,
    playerHp: 100,
    invasion: { layout, timeLimitTicks },
  };
}

function buildInputs(n: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      moveX: Math.sin(i / 40),
      moveY: Math.cos(i / 55),
      aim: (i / 30) % 6.28,
      dash: i % 90 === 0,
      special: 0,
    });
  }
  return out;
}

interface Submission {
  seed: number;
  config?: WorldConfig;
  inputs: InputFrame[];
  claim: { finalHash: number; hashStream?: number[]; outcome: { victory: boolean; gameOver: boolean } };
}

function honest(seed: number, config: WorldConfig, inputs: InputFrame[]): Submission {
  const r = runReplay({ seed, config, inputs });
  return {
    seed,
    config,
    inputs,
    claim: {
      finalHash: r.finalHash >>> 0,
      hashStream: r.hashes.map((h) => h >>> 0),
      outcome: { victory: r.finalState.victory, gameOver: r.finalState.gameOver },
    },
  };
}

const SEED = 7;
const INPUTS = buildInputs(400);
const CFG = invasionConfig(SERVER_LAYOUT);
const CTX: InvasionServerContext = { layout: SERVER_LAYOUT, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS };

describe('verify-invasion — 정상 수락', () => {
  it('서버 권위 배치로 정직하게 제출하면 accept', () => {
    const res = verifyInvasion(honest(SEED, CFG, INPUTS), CTX);
    expect(res.verdict).toBe('accept');
    expect(res.reason).toBe('verified');
  });
});

describe('verify-invasion — 침공 게이트', () => {
  it('hashStream 부재는 hash-stream-required', () => {
    const base = honest(SEED, CFG, INPUTS);
    const res = verifyInvasion({ ...base, claim: { finalHash: base.claim.finalHash, outcome: base.claim.outcome } }, CTX);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'hash-stream-required' });
  });

  it('config 부재는 config-required', () => {
    const base = honest(SEED, CFG, INPUTS);
    const res = verifyInvasion({ seed: base.seed, inputs: base.inputs, claim: base.claim }, CTX);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'config-required' });
  });

  it('invasion 블록 부재는 invasion-config-required', () => {
    const base = honest(SEED, CFG, INPUTS);
    // invasion 프로퍼티 자체를 제거한 config(= exactOptionalPropertyTypes 준수).
    const { invasion: _omit, ...noInv } = CFG;
    const res = verifyInvasion({ ...base, config: noInv as WorldConfig }, CTX);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'invasion-config-required' });
  });

  it('약화된 가짜 방어(포탑 축소)는 defense-mismatch', () => {
    const weaker: DefenseLayout = { ...SERVER_LAYOUT, turrets: [{ type: TURRET_VULCAN, x: 400, y: -150 }] };
    const sub = honest(SEED, invasionConfig(weaker), INPUTS);
    const res = verifyInvasion(sub, CTX);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'defense-mismatch' });
  });

  it('제한 시간 조작은 defense-mismatch', () => {
    const sub = honest(SEED, invasionConfig(SERVER_LAYOUT, DEFAULT_TIME_LIMIT_TICKS + 100), INPUTS);
    const res = verifyInvasion(sub, CTX);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'defense-mismatch' });
  });

  it('입력이 제한 시간 초과면 invasion-inputs-too-long', () => {
    const shortCtx: InvasionServerContext = { layout: SERVER_LAYOUT, timeLimitTicks: 200 };
    const sub = honest(SEED, invasionConfig(SERVER_LAYOUT, 200), buildInputs(300));
    const res = verifyInvasion(sub, shortCtx);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'invasion-inputs-too-long' });
  });

  it('서버 layout 정규화 대칭 — 쓰레기 항목이 섞인 DB layout 도 정직 침공을 accept (리뷰 MED-3)', () => {
    // 클라이언트 normalizeLayout 이 걸러내는 항목(범위 밖 유형·NaN 좌표·halfW<=0·
    // guardianSlots)이 stored layout 에 있어도, 서버가 동일 규칙으로 정규화해 대조하므로
    // 정규화 본으로 런·제출한 정직 침공이 오거부되지 않아야 한다.
    const dirty: unknown = {
      core: { x: 900, y: 0 },
      turrets: [
        { type: TURRET_VULCAN, x: 400, y: -150 },
        { type: 99, x: 1, y: 1 },
        { type: TURRET_SNIPER, x: 500, y: 200 },
        { type: TURRET_SHOTGUN, x: 250, y: 0 },
        { type: TURRET_VULCAN, x: Number.NaN, y: 3 },
      ],
      obstacles: [
        { x: 450, y: 0, halfW: 50, halfH: 120 },
        { x: 1, y: 1, halfW: 0, halfH: 10 },
      ],
      guardianSlots: [{ id: 'm5' }],
    };
    const dirtyCtx: InvasionServerContext = { layout: dirty, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS };
    const res = verifyInvasion(honest(SEED, CFG, INPUTS), dirtyCtx);
    expect(res.verdict).toBe('accept');
  });

  it('정규화 불능 서버 layout 은 server-layout-invalid (리뷰 MED-3)', () => {
    const brokenCtx: InvasionServerContext = {
      layout: { core: { x: 'broken', y: 0 }, turrets: [], obstacles: [] },
      timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS,
    };
    const res = verifyInvasion(honest(SEED, CFG, INPUTS), brokenCtx);
    expect(res).toMatchObject({ verdict: 'reject', reason: 'server-layout-invalid' });
  });
});

describe('verify-invasion — 위조 4대 시나리오 거부 (AC2)', () => {
  it('① 조작된 최종 해시', () => {
    const base = honest(SEED, CFG, INPUTS);
    const res = verifyInvasion({ ...base, claim: { ...base.claim, finalHash: (base.claim.finalHash ^ 0x1) >>> 0 } }, CTX);
    expect(res.verdict).toBe('reject');
    expect(['final-hash-mismatch', 'hash-stream-divergence']).toContain(res.reason);
  });

  it('② 변조된 입력 로그', () => {
    const base = honest(SEED, CFG, INPUTS);
    const tampered = INPUTS.map((f) => ({ ...f }));
    const mid = Math.floor(tampered.length / 2);
    tampered[mid] = { ...tampered[mid]!, moveX: -tampered[mid]!.moveX, dash: true };
    const res = verifyInvasion({ ...base, inputs: tampered }, CTX);
    expect(res.verdict).toBe('reject');
    expect(['final-hash-mismatch', 'hash-stream-divergence']).toContain(res.reason);
  });

  it('③ 트림된(짧은) 로그', () => {
    const base = honest(SEED, CFG, INPUTS);
    const res = verifyInvasion({ ...base, inputs: INPUTS.slice(0, INPUTS.length - 50) }, CTX);
    expect(res.verdict).toBe('reject');
    expect(['hash-stream-length-mismatch', 'final-hash-mismatch']).toContain(res.reason);
  });

  it('④ 조작된 결과(승패 뒤집기)', () => {
    const base = honest(SEED, CFG, INPUTS);
    const res = verifyInvasion(
      { ...base, claim: { ...base.claim, outcome: { victory: !base.claim.outcome.victory, gameOver: base.claim.outcome.gameOver } } },
      CTX,
    );
    expect(res).toMatchObject({ verdict: 'reject', reason: 'outcome-mismatch' });
  });
});
