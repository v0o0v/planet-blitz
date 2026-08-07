/**
 * verify-commission 검증 코어 테스트 (의뢰서 서버 축, 서버 계약 rev3 §7).
 *
 * `evaluateCommissionGates`(게이트 1~6, 순수 판정)와 `extractRunResources`(계약 §8 "재실행
 * finalState 자원 축")를 Node(vitest)에서 직접 구동한다. 게이트 0/0b~0d/6b/7~9(DB·RPC 필요)는
 * `index.ts`(Deno 전용) 몫이라 여기서 검증하지 않는다 — 계약이 그 경계를 명시한다.
 */

import { describe, it, expect } from 'vitest';
// ⚠️ sim import 가 여기서 사라진 것은 우연이 아니다 — ADR-0050 이 EF 에서 재실행을 걷어내
//    `verifyCommissionCore` 가 sim 을 아예 안 싣게 됐고, 그 짝 테스트도 sim 을 부를 이유가
//    없어졌다. **다시 끌어오려면 재실행이 돌아온다는 뜻이니 ADR 부터 다시 열어라.**
import { emptyInput } from '../src/sim/world.js';
import {
  evaluateCommissionGates,
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

describe('게이트 5 — payload 대조(commission-payload-mismatch)', () => {
  it('제출 config.commission 이 서버 payload 와 다르면 진단 사유로 거부된다', () => {
    const server = baseContext();
    const tampered: CommissionRunConfig = { ...commissionConfigFromPayload(server.payload), grade: 4 };
    const sub = baseSubmission(server, { config: { loadout: server.loadoutSealed, commission: tampered } });
    const result = evaluateCommissionGates(sub, server);
    expect(result).toEqual({ ok: false, reason: 'commission-payload-mismatch' });
  });

  it('일치하면 통과한다 (게이트 5 는 진단 대조다 — 덮어쓰기는 게이트 6 과 함께 사라졌다)', () => {
    const server = baseContext();
    const result = evaluateCommissionGates(baseSubmission(server), server);
    expect(result).toEqual({ ok: true });
  });
});

describe('maxSegments — 클라(`buildRunConfig`)가 주문별로 옳은 값을 낸다', () => {
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
      // ⚠️ **서버 절반은 사라졌다** — 게이트 6(서버측 allowlist 재조립)이 재실행 입력을
      //    만들던 것이라 ADR-0050 과 함께 지워졌다. 그래서 이 블록은 이제 **대칭이 아니라 클라
      //    단독 축**을 잰다. 지우지 않고 남긴 이유는 주문별 구간 수가 여전히 클라 조립의
      //    계약이기 때문이다 — 서버가 안 본다고 틀려도 되는 값이 아니다.
      expect(clientCfg.maxSegments, `클라 ${order}`).toBe(EXPECTED[order]);
    });
  }

  it('elite 는 다른 3주문과 **실제로 다른 값**이다 (오버라이드가 사문이 아니다)', () => {
    expect(COMMISSION_ELITE_WAVE_SEGMENTS).not.toBe(COMMISSION_WAVE_SEGMENTS_PER_SEGMENT);
  });
});
