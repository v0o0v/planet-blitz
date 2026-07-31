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
import type { CommissionRunConfig } from '../src/run/commission.js';
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
  it('계급 4단이 전부 정의돼 있고 단조 증가한다', () => {
    const counts = [1, 2, 3, 4].map((g) => COMMISSION_SEGMENT_COUNT[g as 1 | 2 | 3 | 4]);
    expect(counts).toEqual([2, 3, 4, 5]);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i] ?? 0).toBeGreaterThan(counts[i - 1] ?? 0);
    }
  });

  it('리플레이 예산은 구간 수 × 구간 상한의 **파생**이다 (두 정본을 두지 않는다)', () => {
    for (const g of [1, 2, 3, 4] as const) {
      expect(commissionReplayBudgetTicks(g)).toBe(COMMISSION_SEGMENT_COUNT[g] * COMMISSION_SEGMENT_TICK_CAP);
    }
  });
});
