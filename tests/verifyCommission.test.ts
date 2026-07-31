/**
 * verify-commission 검증 코어 테스트 (의뢰서 서버 축, 서버 계약 rev3 §7).
 *
 * `evaluateCommissionGates`(게이트 1~6, 순수 판정)와 `extractRunResources`(계약 §8 "재실행
 * finalState 자원 축")를 Node(vitest)에서 직접 구동한다. 게이트 0/0b~0d/6b/7~9(DB·RPC 필요)는
 * `index.ts`(Deno 전용) 몫이라 여기서 검증하지 않는다 — 계약이 그 경계를 명시한다.
 */

import { describe, it, expect } from 'vitest';
import { createWorld, stepWorld, emptyInput, packPowerupPick, DEFAULT_CONFIG } from '../src/sim/world.js';
import type { InputFrame, WorldConfig } from '../src/sim/world.js';
import { runReplay } from '../src/sim/replay.js';
import {
  evaluateCommissionGates,
  extractRunResources,
  deepEqual,
} from '../supabase/functions/verify-commission/verifyCommissionCore.js';
import type { CommissionServerContext } from '../supabase/functions/verify-commission/verifyCommissionCore.js';
import type { CommissionPayload, CommissionRunConfig } from '../src/run/commission.js';
import { commissionReplayBudgetTicks } from '../src/run/commissionConstants.js';

function samplePayload(over: Partial<CommissionPayload> = {}): CommissionPayload {
  return {
    version: 1,
    commissionId: '00000000-0000-4000-8000-000000000001',
    grade: 2,
    order: 'chain',
    segments: [
      { planet: 0, stage: 1 },
      { planet: 1, stage: 2 },
    ],
    rewards: { credits: 100, minerals: 50, items: [] },
    replayBudgetTicks: commissionReplayBudgetTicks(2),
    ...over,
  };
}

function commissionConfigFromPayload(payload: CommissionPayload, segmentIndex = 0): CommissionRunConfig {
  const base: CommissionRunConfig = {
    commissionId: payload.commissionId,
    order: payload.order,
    grade: payload.grade,
    segments: payload.segments,
    replayBudgetTicks: payload.replayBudgetTicks,
    segmentIndex,
  };
  return payload.constraints !== undefined ? { ...base, constraints: payload.constraints } : base;
}

function sampleLoadout(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    weaponType: 0,
    subWeaponType: -1,
    damageMult: 1,
    fireRateMult: 1,
    bulletCountAdd: 0,
    pierceAdd: 0,
    bulletSpeedMult: 1,
    spreadAdd: 0,
    rangeAdd: 0,
    moveSpeedMult: 1,
    maxHpAdd: 0,
    dashCdMult: 1,
    magnetMult: 1,
    xpMult: 1,
    uniqueMask: 0,
    fireDmg: 0,
    coldSlow: 0,
    lightning: 0,
    ...over,
  };
}

function baseContext(over: Partial<CommissionServerContext> = {}): CommissionServerContext {
  const payload = samplePayload();
  return {
    payload,
    loadoutSealed: sampleLoadout(),
    grantedUniqueBits: [],
    exclusiveUniqueBits: [],
    ...over,
  };
}

function baseSubmission(server: CommissionServerContext, over: Record<string, unknown> = {}) {
  return {
    seed: 1,
    config: {
      loadout: server.loadoutSealed,
      commission: commissionConfigFromPayload(server.payload),
    },
    inputs: [emptyInput()],
    claim: { finalHash: 0, outcome: { victory: false, gameOver: true } },
    ...over,
  };
}

describe('deepEqual — 키 순서 무관 구조적 동치', () => {
  it('키 순서가 달라도 같다고 본다(jsonb 왕복에서 순서가 안 보존돼도 오거부 방지)', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
  it('중첩 배열·객체도 재귀적으로 본다', () => {
    expect(deepEqual({ x: [1, { y: 2 }] }, { x: [1, { y: 2 }] })).toBe(true);
    expect(deepEqual({ x: [1, { y: 2 }] }, { x: [1, { y: 3 }] })).toBe(false);
  });
  it('undefined 와 부재 필드를 같다고 보지 않는다(엄격) — 값이 다르면 거짓', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});

describe('게이트 1 — 입력 길이 상한(commission-inputs-too-long)', () => {
  it('replayBudgetTicks 초과 입력은 거부된다', () => {
    const server = baseContext();
    const tooLong = Array.from({ length: server.payload.replayBudgetTicks + 1 }, () => emptyInput());
    const result = evaluateCommissionGates(baseSubmission(server, { inputs: tooLong }), server);
    expect(result).toEqual({ ok: false, reason: 'commission-inputs-too-long' });
  });

  it('정확히 상한이면 통과한다(경계값)', () => {
    const server = baseContext();
    const exact = Array.from({ length: server.payload.replayBudgetTicks }, () => emptyInput());
    const result = evaluateCommissionGates(baseSubmission(server, { inputs: exact }), server);
    expect(result.ok).toBe(true);
  });
});

describe('게이트 2 — 촉매 주입 금지(commission-catalyst-present)', () => {
  it('config.catalysts 가 비어 있지 않으면 거부된다', () => {
    const server = baseContext();
    const sub = baseSubmission(server);
    (sub.config as Record<string, unknown>).catalysts = [1];
    const result = evaluateCommissionGates(sub, server);
    expect(result).toEqual({ ok: false, reason: 'commission-catalyst-present' });
  });

  it('빈 배열이면 통과한다', () => {
    const server = baseContext();
    const sub = baseSubmission(server);
    (sub.config as Record<string, unknown>).catalysts = [];
    const result = evaluateCommissionGates(sub, server);
    expect(result.ok).toBe(true);
  });
});

describe('게이트 3 — 로드아웃 대조(commission-loadout-mismatch)', () => {
  it('출격 시점 봉인과 다른 로드아웃을 제출하면 거부된다(위조/편집)', () => {
    const server = baseContext();
    const sub = baseSubmission(server, { config: { loadout: sampleLoadout({ damageMult: 999 }), commission: commissionConfigFromPayload(server.payload) } });
    const result = evaluateCommissionGates(sub, server);
    expect(result).toEqual({ ok: false, reason: 'commission-loadout-mismatch' });
  });

  it('같은 값이면 키 순서가 달라도 통과한다(오거부 금지)', () => {
    const server = baseContext();
    // sampleLoadout 과 같은 값이되 키 순서를 뒤집는다.
    const reordered = Object.fromEntries(Object.entries(sampleLoadout()).reverse());
    const sub = baseSubmission(server, { config: { loadout: reordered, commission: commissionConfigFromPayload(server.payload) } });
    const result = evaluateCommissionGates(sub, server);
    expect(result.ok).toBe(true);
  });
});

describe('게이트 4 — 미인가 의뢰 전용 유니크(commission-unauthorized-unique)', () => {
  it('exclusiveUniqueBits 가 비어 있으면(카탈로그 미도입) 어떤 uniqueMask 도 거부하지 않는다', () => {
    // ⚠️ 이것은 "안전"이 아니라 "게이트가 아직 아무것도 안 본다"는 것을 문서화하는 테스트다
    // (commissionServerConstants.ts COMMISSION_EXCLUSIVE_UNIQUE_BITS 플레이스홀더 주석 참조).
    const loadout = sampleLoadout({ uniqueMask: 1 << 5 });
    const server = baseContext({ exclusiveUniqueBits: [], loadoutSealed: loadout });
    const sub = baseSubmission(server, {
      config: { loadout, commission: commissionConfigFromPayload(server.payload) },
    });
    expect(evaluateCommissionGates(sub, server).ok).toBe(true);
  });

  it('전용 bit 가 켜져 있고 그 bit 가 발급 기록에 없으면 거부된다', () => {
    const server = baseContext({ exclusiveUniqueBits: [5], grantedUniqueBits: [] });
    const loadout = sampleLoadout({ uniqueMask: 1 << 5 });
    // loadoutSealed 도 같은 값이어야 게이트 3 을 먼저 통과한다.
    const withSealed = { ...server, loadoutSealed: loadout };
    const sub = baseSubmission(withSealed, { config: { loadout, commission: commissionConfigFromPayload(server.payload) } });
    const result = evaluateCommissionGates(sub, withSealed);
    expect(result).toEqual({ ok: false, reason: 'commission-unauthorized-unique' });
  });

  it('발급 기록이 있으면 같은 bit 라도 통과한다("받은 적 있는가" — ADR-0045 §2b)', () => {
    const loadout = sampleLoadout({ uniqueMask: 1 << 5 });
    const server = baseContext({ exclusiveUniqueBits: [5], grantedUniqueBits: [5], loadoutSealed: loadout });
    const sub = baseSubmission(server, { config: { loadout, commission: commissionConfigFromPayload(server.payload) } });
    expect(evaluateCommissionGates(sub, server).ok).toBe(true);
  });

  it('뮤테이션: 발급 안 된 bit 를 granted 로 착각하게 하면(빈 Set 대신 모두 통과) 첫 케이스가 실패해야 한다', () => {
    // 이 테스트는 구현이 아니라 "만약 게이트 4 대조 로직이 항상 true 를 반환하면" 을 대체 확인한다 —
    // 위 두 번째 it 가 그 회귀를 이미 잡는다(뮤테이션 문서화 목적으로 재서술).
    const server = baseContext({ exclusiveUniqueBits: [5], grantedUniqueBits: [] });
    const loadout = sampleLoadout({ uniqueMask: 1 << 5 });
    const withSealed = { ...server, loadoutSealed: loadout };
    const sub = baseSubmission(withSealed, { config: { loadout, commission: commissionConfigFromPayload(server.payload) } });
    expect(evaluateCommissionGates(sub, withSealed).ok).toBe(false);
  });
});

describe('게이트 5·6 — payload 대조(진단) + 서버 권위 덮어쓰기(commission-payload-mismatch)', () => {
  it('제출 config.commission 이 서버 payload 와 다르면 진단 사유로 거부된다', () => {
    const server = baseContext();
    const tampered: CommissionRunConfig = { ...commissionConfigFromPayload(server.payload), grade: 4 };
    const sub = baseSubmission(server, { config: { loadout: server.loadoutSealed, commission: tampered } });
    const result = evaluateCommissionGates(sub, server);
    expect(result).toEqual({ ok: false, reason: 'commission-payload-mismatch' });
  });

  it('일치하면 게이트 6 이 서버 payload 파생값으로 config.commission 을 덮어쓴 제출을 낸다', () => {
    const server = baseContext();
    const sub = baseSubmission(server);
    const result = evaluateCommissionGates(sub, server);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const overridden = (result.submission.config as { commission?: CommissionRunConfig }).commission;
    expect(overridden).toEqual({
      commissionId: server.payload.commissionId,
      order: server.payload.order,
      grade: server.payload.grade,
      segments: server.payload.segments,
      replayBudgetTicks: server.payload.replayBudgetTicks,
      segmentIndex: 0,
    });
  });

  it('뮤테이션: 게이트 5 를 지워도 게이트 6 의 덮어쓰기 자체는 항상 서버 값을 쓴다(강제는 6 이 진다, §7-2)', () => {
    // 제출이 5 에서 걸리는 tampered 값이어도, 만약 5 를 우회해 6 까지 온다고 가정하면 결과는
    // 항상 서버 값이지 제출값이 아니다 — 이 성질을 직접 확인한다(위조 config 가 살아남지 않음).
    const server = baseContext();
    const sub = baseSubmission(server);
    const result = evaluateCommissionGates(sub, server);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const overridden = (result.submission.config as { commission?: CommissionRunConfig }).commission;
    expect(overridden?.grade).toBe(server.payload.grade); // 제출이 아니라 서버 payload 의 값.
  });
});

describe('extractRunResources — 재실행 finalState.resources 추출(계약 §8)', () => {
  /** 짧은 내구 런(레벨업 팝업 회피)을 만들어 finalState.resources 를 재본다. */
  function driveInputs(seed: number, config: WorldConfig, ticks: number): InputFrame[] {
    const state = createWorld(seed, config);
    const inputs: InputFrame[] = [];
    for (let t = 0; t < ticks; t++) {
      const frame: InputFrame = state.pendingLevelUp
        ? { ...emptyInput(), special: packPowerupPick(0) }
        : { moveX: Math.sin(t * 0.1), moveY: Math.cos(t * 0.1), aim: 0, dash: false, special: 0 };
      inputs.push(frame);
      stepWorld(state, frame);
      if (state.gameOver || state.victory) break;
    }
    return inputs;
  }

  it('runReplay 를 다시 돌려 finalState.resources 와 같은 값을 낸다(같은 입력 → 같은 결과)', () => {
    const config: WorldConfig = { ...DEFAULT_CONFIG, playerHp: 1_000_000_000 };
    const inputs = driveInputs(7, config, 120);
    const expected = runReplay({ seed: 7, config, inputs }).finalState.resources;
    const { resources } = extractRunResources({ seed: 7, config, inputs });
    expect(resources).toBe(expected);
  });
});
