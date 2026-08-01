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
import {
  commissionReplayBudgetTicks,
  COMMISSION_ELITE_WAVE_SEGMENTS,
  COMMISSION_WAVE_SEGMENTS_PER_SEGMENT,
} from '../src/run/commissionConstants.js';
import { COMMISSION_ORDERS } from '../src/run/commission.js';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';

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

// ---------------------------------------------------------------------------
// 게이트 6 — allowlist 재조립 (보안 검토 CRITICAL 회귀 게이트)
// ---------------------------------------------------------------------------

describe('게이트 6 — 제출 config 를 **정화**한다 (덮어쓰기만 하면 재실행이 증거가 아니다)', () => {
  // ⚠️ 결함 형상: `{...cfg, commission: expected}`. 그러면 서버 권위가 commission 블록 하나뿐이고
  //    나머지 WorldConfig 전체가 제출자 것으로 남는다. 재실행이 제출자 config 로 돌고 해시는
  //    제출자가 같은 config 로 계산한 claim 과 일치하므로 **게이트 7 은 원리적으로 발산하지
  //    않는다** — 즉 "재실행이 강제한다"가 거짓이 된다.
  //
  // ⚠️ 이 블록의 단언이 통과하면서도 참일 수 있는 나쁜 상태: 게이트 6 이 **아예 도달하지 않는
  //    것**(앞 게이트가 거부). 그래서 매 케이스에서 `res.ok === true` 를 먼저 확인한다.

  /** 위험 필드를 잔뜩 실은 제출. 전부 정직한 클라가 의뢰 런에 넣지 않는 값이다. */
  function hostileSubmission(server: CommissionServerContext) {
    return baseSubmission(server, {
      config: {
        loadout: server.loadoutSealed,
        commission: commissionConfigFromPayload(server.payload),
        // ⓐ 코어 스탯 위조 → 무손실 완주 → 확정 지급물 취득
        playerHp: 1e9,
        playerSpeed: 1e6,
        dashSpeed: 1e6,
        hitIframes: 1e9,
        dashIframes: 1e9,
        dashCooldownTicks: 0,
        arenaWidth: 1e6,
        arenaHeight: 1e6,
        // ⓑ 자원 배율 → finalState.resources 무제한(그 산술에 상한 캡이 없다)
        planetMultCenti: 1_000_000,
        planetMultEpoch: 99,
        // ⓒ 1구간 무대 위조 — stageOverride 는 2구간 전환에만 적용된다
        planet: 5,
        stage: 99,
        planetMode: 3,
        // ⓓ 구간 단축 → 일반 세그먼트를 건너뛰고 즉시 보스
        maxSegments: 0,
        // 그 외 의뢰에 실릴 수 없는 축
        invasion3: { anything: true },
        pilot: { typeId: 3 },
      },
    });
  }

  it('코어 스탯 9종이 DEFAULT_CONFIG 로 되돌아간다 (제출값이 한 개도 살아남지 않는다)', () => {
    const server = baseContext();
    const res = evaluateCommissionGates(hostileSubmission(server), server);
    expect(res.ok, '게이트 6 에 도달하지 못했다 — 이 테스트가 무의미하다').toBe(true);
    if (!res.ok) return;
    const c = res.submission.config as unknown as Record<string, unknown>;
    // 독립 전사본 — DEFAULT_CONFIG 를 순회하면 그 객체에서 키가 빠질 때 단언도 함께 사라진다.
    const CORE = [
      'arenaWidth',
      'arenaHeight',
      'playerSpeed',
      'dashSpeed',
      'dashCooldownTicks',
      'dashIframes',
      'hitIframes',
      'playerHp',
    ] as const;
    for (const k of CORE) {
      expect(c[k], `${k} 가 제출값으로 남았다`).toBe(
        (DEFAULT_CONFIG as unknown as Record<string, unknown>)[k],
      );
    }
    // 전사본이 실제 필드 집합과 어긋나면(예: 새 코어 상수 추가) 여기서 걸린다.
    expect(Object.keys(DEFAULT_CONFIG).sort()).toEqual([...CORE].sort());
  });

  it('무대는 **payload 의 1구간**에서 파생된다 (제출 planet/stage 를 믿지 않는다)', () => {
    const server = baseContext();
    const res = evaluateCommissionGates(hostileSubmission(server), server);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.submission.config as unknown as Record<string, unknown>;
    expect(c.planet).toBe(server.payload.segments[0]?.planet);
    expect(c.stage).toBe(server.payload.segments[0]?.stage);
    // 제출값(5/99)이 아니라는 것을 명시적으로 — 우연히 같은 값이면 위 단언이 항진이다.
    expect(c.planet).not.toBe(5);
    expect(c.stage).not.toBe(99);
  });

  it('의뢰에 실릴 수 없는 축은 **키 자체가 사라진다**', () => {
    const server = baseContext();
    const res = evaluateCommissionGates(hostileSubmission(server), server);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.submission.config as unknown as Record<string, unknown>;
    for (const k of ['planetMultCenti', 'planetMultEpoch', 'invasion3', 'pilot', 'catalysts']) {
      expect(k in c, `${k} 가 살아남았다`).toBe(false);
    }
  });

  it('maxSegments 는 서버 상수로 고정된다 (제출 0 이 통하면 보스로 즉시 점프한다)', () => {
    const server = baseContext();
    const res = evaluateCommissionGates(hostileSubmission(server), server);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.submission.config as unknown as Record<string, unknown>;
    expect(c.maxSegments).toBe(COMMISSION_WAVE_SEGMENTS_PER_SEGMENT);
  });

  it('대조군: 정직한 제출은 재조립 후에도 자기 축을 그대로 유지한다', () => {
    // ⚠️ 위 네 단언만 있으면 "게이트 6 이 전부 지워 버린다"도 통과한다. 정직한 축(로드아웃·
    //    기체·스킬 투자)이 살아남는지 함께 잰다 — 안 살아남으면 정직한 런이 전부 거부된다.
    const server = baseContext();
    const honest = baseSubmission(server, {
      config: {
        loadout: server.loadoutSealed,
        commission: commissionConfigFromPayload(server.payload),
        shipType: 2,
        skillInvest: [1, 2, 3],
        runId: 'abc',
      },
    });
    const res = evaluateCommissionGates(honest, server);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.submission.config as unknown as Record<string, unknown>;
    expect(c.shipType).toBe(2);
    expect(c.skillInvest).toEqual([1, 2, 3]);
    expect(c.runId).toBe('abc');
    expect(c.loadout).toEqual(server.loadoutSealed);
  });
});

// ---------------------------------------------------------------------------
// maxSegments 클라·서버 대칭 (리뷰 MAJOR-1 회귀 게이트)
// ---------------------------------------------------------------------------

describe('maxSegments 는 클라(`buildRunConfig`)와 서버(게이트 6)가 **주문별로 같은 값**을 낸다', () => {
  // ⚠️ **주문 목록을 `COMMISSION_ORDERS` 순회로 쓰지 마라.** 목록을 순회하면 거기서 항목이
  //    빠질 때 대조도 함께 사라져 원리적으로 눈이 먼다. 독립 전사본으로 4개를 열거한다.
  const ORDERS = ['chain', 'constraint', 'bounty', 'elite'] as const;

  // ⚠️ 이 단언이 통과하면서도 참일 수 있는 나쁜 상태: **양쪽이 나란히 틀린 것**(예: 둘 다
  //    elite 분기를 잃어 3 을 낸다). 그래서 대칭만 재지 않고 elite 의 기대값 자체도 못 박는다.
  const EXPECTED: Record<(typeof ORDERS)[number], number> = {
    chain: COMMISSION_WAVE_SEGMENTS_PER_SEGMENT,
    constraint: COMMISSION_WAVE_SEGMENTS_PER_SEGMENT,
    bounty: COMMISSION_WAVE_SEGMENTS_PER_SEGMENT,
    elite: COMMISSION_ELITE_WAVE_SEGMENTS,
  };

  it('전사본이 실제 주문 집합과 일치한다 (주문이 늘면 이 표가 먼저 깨진다)', () => {
    expect([...ORDERS].sort()).toEqual([...COMMISSION_ORDERS].sort());
  });

  for (const order of ORDERS) {
    it(`${order}: 클라 == 서버 == 기대값`, () => {
      const payload = samplePayload({ order });
      // 현상금 주문은 `bounty` 블록이 없으면 조립이 던진다(도주 기제가 통째로 사라지는 것을
      // 막는 가드) — 대조에 필요한 최소 블록을 싣는다.
      const base = commissionConfigFromPayload(payload);
      const commission =
        order === 'bounty'
          ? { ...base, bounty: { targetKind: 2, escapeRule: 'hpThreshold' as const } }
          : base;
      // 클라 — 조립의 유일한 정본.
      const clientCfg = buildRunConfig(defaultProfile(), {
        planet: payload.segments[0]?.planet ?? 0,
        stage: payload.segments[0]?.stage ?? 1,
        commission,
      });
      // 서버 — 게이트 6 의 allowlist 재조립.
      const server = baseContext({ payload });
      const res = evaluateCommissionGates(baseSubmission(server), server);
      expect(res.ok, '게이트 6 에 도달하지 못했다 — 이 대조가 무의미하다').toBe(true);
      if (!res.ok) return;
      const serverMax = (res.submission.config as unknown as Record<string, unknown>).maxSegments;

      expect(clientCfg.maxSegments, `클라 ${order}`).toBe(EXPECTED[order]);
      expect(serverMax, `서버 ${order}`).toBe(EXPECTED[order]);
      // 대칭 자체를 한 번 더 — 위 둘이 같은 상수를 참조해도 배선이 갈리면 여기서 잡힌다.
      expect(serverMax, `${order}: 클라·서버 maxSegments 가 갈렸다`).toBe(clientCfg.maxSegments);
    });
  }

  it('elite 는 다른 3주문과 **실제로 다른 값**이다 (오버라이드가 사문이 아니다)', () => {
    expect(COMMISSION_ELITE_WAVE_SEGMENTS).not.toBe(COMMISSION_WAVE_SEGMENTS_PER_SEGMENT);
  });
});
