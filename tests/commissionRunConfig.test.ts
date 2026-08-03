/**
 * 의뢰 런 설정의 **관통 배선 + 조건부 스탬프** 테스트 (계획 §A-1 · PA 레인 계약 §3).
 *
 * 선례는 `tests/activeSkillRunConfig.test.ts` 다 — "조건부 스탬프 = 골든 JSON 바이트 불변"이
 * 이 저장소의 확립된 축이다. 여기서도 **양방향**으로 건다:
 *  - 음성: 의뢰가 아니면 `commission` 키가 config 에도 **직렬화에도** 없다.
 *  - 양성: 의뢰면 그 값이 그대로 실리고 **sim(`createWorld`)까지 도달**한다.
 * 음성만 걸면 조건을 뒤집어 써도(항상 미탑재) 통과하고 결함이 통합까지 잠복한다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig } from '../src/run/runConfig.js';
import { defaultProfile } from '../src/save/profile.js';
import { createWorld } from '../src/sim/world.js';
import {
  COMMISSION_ORDERS,
  commissionOrderWire,
  commissionRunConfigFromPayload,
} from '../src/run/commission.js';
import type { CommissionRunConfig, CommissionPayload } from '../src/run/commission.js';
import {
  COMMISSION_SEGMENT_COUNT,
  COMMISSION_SEGMENT_TICK_CAP,
  commissionReplayBudgetTicks,
} from '../src/run/commissionConstants.js';

function sampleCommission(): CommissionRunConfig {
  return {
    commissionId: '00000000-0000-4000-8000-000000000001',
    order: 'chain',
    grade: 2,
    segments: [
      { planet: 0, stage: 1 },
      { planet: 1, stage: 2 },
      { planet: 2, stage: 3 },
    ],
    replayBudgetTicks: commissionReplayBudgetTicks(2),
    segmentIndex: 0,
  };
}

describe('A-1 음성 — 무의뢰 런은 `commission` 필드를 아예 싣지 않는다', () => {
  it('config 에도 직렬화에도 키가 없다 (골든 JSON 바이트 불변의 축)', () => {
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1 });
    expect('commission' in cfg).toBe(false);
    expect(JSON.stringify(cfg).includes('commission')).toBe(false);
  });

  it('`DEFAULT_CONFIG` 자체에 의뢰 필드가 없다 (있으면 모든 런의 골든이 깨진다)', async () => {
    const { DEFAULT_CONFIG } = await import('../src/sim/world.js');
    expect('commission' in DEFAULT_CONFIG).toBe(false);
  });
});

describe('A-1 양성 — 의뢰 런은 설정이 sim 까지 도달한다', () => {
  it('`buildRunConfig` 가 통째로 스탬프한다', () => {
    const c = sampleCommission();
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1, commission: c });
    expect(cfg.commission).toEqual(c);
  });

  it('`createWorld` 를 통과해 `state.config.commission` 으로 읽힌다 (PM-4 형태의 배선 끊김 방지)', () => {
    const c = sampleCommission();
    const cfg = buildRunConfig(defaultProfile(), { planet: 0, stage: 1, commission: c });
    const state = createWorld(1, cfg);
    expect(state.config.commission?.commissionId).toBe(c.commissionId);
    expect(state.config.commission?.segmentIndex).toBe(0);
    expect(state.config.commission?.segments.length).toBe(3);
  });
});

describe('D13 — 의뢰 런은 행성 인기 배율을 스탬프하지 않는다', () => {
  it('의뢰 + planetMult 를 같이 넘겨도 두 필드 모두 미탑재다', () => {
    const cfg = buildRunConfig(defaultProfile(), {
      planet: 0,
      stage: 1,
      commission: sampleCommission(),
      planetMult: { centi: 150, epoch: 42 },
    });
    expect('planetMultCenti' in cfg).toBe(false);
    expect('planetMultEpoch' in cfg).toBe(false);
  });

  it('무의뢰 런의 기존 거동은 그대로다 (게이트를 잘못 걸면 정반대 회귀가 난다)', () => {
    const cfg = buildRunConfig(defaultProfile(), {
      planet: 0,
      stage: 1,
      planetMult: { centi: 150, epoch: 42 },
    });
    expect(cfg.planetMultCenti).toBe(150);
    expect(cfg.planetMultEpoch).toBe(42);
  });
});

describe('P0 상수 모듈 — 하드코딩 금지의 근거지', () => {
  // ## 2026-08-03 — "계급이 오르면 구간이 는다"는 계약을 **폐기했다**(밴드 복구 레인)
  //
  // 원래 이 자리는 `[2,3,4,5]` + **강한 증가**였다. 96시드 실측이 그 형태를 기각했다: 구간마다
  // HP 가 승계되고 회복이 없어 클리어율이 구간 수에 대해 기하급수보다 가파르게 떨어지고,
  // 3구간 이상은 **어떤 조합으로도** 목표 밴드(전 계급 80%+)에 들어오지 못한다(계급2 3구간
  // 57.1% · 계급4 5구간 25.0%). 근거 표는 `COMMISSION_SEGMENT_COUNT` 주석에 있다.
  //
  // ⚠️ 그래서 **계급 차이는 이제 구간 수가 아니라 단계 분포(`[1, grade]`)와 보상 배율이 진다.**
  //    여기서 "증가한다"를 계속 단언하면 밴드와 정면으로 모순되므로, 대신 **밴드가 요구하는
  //    상한**(2 이하)과 **다구간이라는 정체성**(1 초과)을 양쪽에서 못 박는다 — 이 형태는
  //    "실수로 5로 되돌림"과 "실수로 1로 내려 단일 구간이 됨"을 둘 다 잡는다.
  it('계급 4단이 전부 정의돼 있고 밴드가 허용하는 구간 수 안에 있다', () => {
    const counts = [1, 2, 3, 4].map((g) => COMMISSION_SEGMENT_COUNT[g as 1 | 2 | 3 | 4]);
    expect(counts).toEqual([2, 2, 2, 2]);
    for (const c of counts) {
      expect(c, '단일 구간이면 "다구간 의뢰"가 아니다').toBeGreaterThan(1);
      expect(c, '3구간 이상은 96시드 실측에서 밴드(80%)에 못 든다').toBeLessThanOrEqual(2);
    }
  });

  it('리플레이 예산은 구간 수 × 구간 상한의 **파생**이다 (두 정본을 두지 않는다)', () => {
    for (const g of [1, 2, 3, 4] as const) {
      expect(commissionReplayBudgetTicks(g)).toBe(COMMISSION_SEGMENT_COUNT[g] * COMMISSION_SEGMENT_TICK_CAP);
    }
  });
});

describe('④ 주문 wire 인코딩 — append-only 골든', () => {
  // 이 배열의 **인덱스가 곧 해시에 접히는 값**이다(`hashWorld` 의뢰 꼬리 폴드). 재배치는 이미
  // 제출된 모든 의뢰 리플레이를 조용히 무효화하는데, 클라·서버가 같은 소스를 쓰므로 **양쪽이
  // 동시에 틀려 어떤 게이트도 안 울린다.** 주석만으로는 그 규율이 강제되지 않아 골든으로 박는다
  // (`activeSlots` wire 선례와 같은 형태).
  it('COMMISSION_ORDERS 의 순서가 고정돼 있다 (재배치 = 제출된 리플레이 무효화)', () => {
    expect([...COMMISSION_ORDERS]).toEqual(['chain', 'constraint', 'bounty', 'elite']);
  });

  it('commissionOrderWire 가 그 인덱스를 그대로 낸다', () => {
    expect(commissionOrderWire('chain')).toBe(0);
    expect(commissionOrderWire('constraint')).toBe(1);
    expect(commissionOrderWire('bounty')).toBe(2);
    expect(commissionOrderWire('elite')).toBe(3);
  });
});

describe('⑥ commissionRunConfigFromPayload — 서버 payload → WorldConfig 형태(지시 수신소 출격)', () => {
  it('보상 블록(rewards)을 뺀다 — sim 입력이 아닌 값을 리플레이에 싣지 않는다', () => {
    const payload: CommissionPayload = {
      version: 1,
      commissionId: 'c-1',
      grade: 2,
      order: 'chain',
      segments: [{ planet: 0, stage: 1 }],
      rewards: { credits: 500, minerals: 0, items: [], uniqueId: 3 },
      replayBudgetTicks: commissionReplayBudgetTicks(2),
    };
    const cfg = commissionRunConfigFromPayload(payload);
    expect('rewards' in cfg).toBe(false);
    expect(cfg.commissionId).toBe('c-1');
    expect(cfg.segments).toEqual(payload.segments);
    expect(cfg.replayBudgetTicks).toBe(payload.replayBudgetTicks);
  });

  it('segmentIndex 는 항상 0 이다(출격은 언제나 1구간부터)', () => {
    const payload: CommissionPayload = {
      version: 1,
      commissionId: 'c-2',
      grade: 1,
      order: 'bounty',
      segments: [{ planet: 1, stage: 3 }],
      bounty: { targetKind: 0, escapeRule: 'hpThreshold' },
      rewards: { credits: 100, minerals: 0, items: [] },
      replayBudgetTicks: commissionReplayBudgetTicks(1),
    };
    const cfg = commissionRunConfigFromPayload(payload);
    expect(cfg.segmentIndex).toBe(0);
    expect(cfg.bounty).toEqual(payload.bounty);
  });

  it('constraints·bounty 가 없으면 필드 자체를 싣지 않는다(조건부 스탬프 규율)', () => {
    const payload: CommissionPayload = {
      version: 1,
      commissionId: 'c-3',
      grade: 1,
      order: 'chain',
      segments: [{ planet: 0, stage: 1 }],
      rewards: { credits: 100, minerals: 0, items: [] },
      replayBudgetTicks: commissionReplayBudgetTicks(1),
    };
    const cfg = commissionRunConfigFromPayload(payload);
    expect('constraints' in cfg).toBe(false);
    expect('bounty' in cfg).toBe(false);
  });
});

describe('⑤ 조립 관문 — 빈 무대 거부', () => {
  // segments 가 비면 "마지막 구간인가" 판정이 항상 참이라 첫 보스 처치가 곧바로 victory 이고,
  // 그 victory 는 확정 유니크 지급 경로로 간다.
  it('segments 가 빈 의뢰 config 는 조립 단계에서 거부된다', () => {
    expect(() =>
      buildRunConfig(defaultProfile(), {
        planet: 0,
        stage: 1,
        commission: {
          commissionId: 'c-empty',
          order: 'chain',
          grade: 1,
          segments: [],
          replayBudgetTicks: 9000,
          segmentIndex: 0,
        },
      }),
    ).toThrow();
  });
});
