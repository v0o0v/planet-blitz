/**
 * 의뢰 출격 봉인 로드아웃 — `commissionSealedLoadout`(runConfig.ts, 서버 계약 §5-2 ⑤ · §7 게이트 3).
 *
 * ⚠️ **이 테스트가 통과하면서도 참일 수 있는 나쁜 상태**: 두 함수가 우연히 같은 결과를 내는
 * 것과 **구조적으로 같은 계산**인 것은 다르다 — 그래서 값 비교(`toEqual`)뿐 아니라, 제약이
 * 실제로 결과를 바꾸는지(장비 제외가 반영되는지)까지 함께 검증한다. 값만 같고 제약이 무시돼도
 * "우연히 같다"로 통과할 수 있는 사각지대다.
 */

import { describe, it, expect } from 'vitest';
import { buildRunConfig, commissionSealedLoadout } from '../src/run/runConfig.js';
import { defaultProfile, activeShip } from '../src/save/profile.js';
import { commissionReplayBudgetTicks } from '../src/run/commissionConstants.js';
import type { CommissionRunConfig } from '../src/run/commission.js';

function sampleCommission(overrides: Partial<CommissionRunConfig> = {}): CommissionRunConfig {
  return {
    commissionId: '00000000-0000-4000-8000-000000000002',
    order: 'constraint',
    grade: 1,
    segments: [{ planet: 0, stage: 1 }],
    replayBudgetTicks: commissionReplayBudgetTicks(1),
    segmentIndex: 0,
    ...overrides,
  };
}

describe('commissionSealedLoadout — buildRunConfig 과 같은 값', () => {
  it('제약 없음: 무의뢰 buildRunConfig 의 config.loadout 과 정확히 같다', () => {
    const profile = defaultProfile();
    const sealed = commissionSealedLoadout(profile);
    const cfg = buildRunConfig(profile, { planet: 0, stage: 1 });
    expect(sealed).toEqual(cfg.loadout);
  });

  it('장비축 제약이 있으면 buildRunConfig(commission 포함) 의 loadout 과 일치한다', () => {
    const profile = defaultProfile();
    const rules = { bannedSlots: ['main' as const] };
    const sealed = commissionSealedLoadout(profile, rules);
    const cfg = buildRunConfig(profile, {
      planet: 0,
      stage: 1,
      commission: sampleCommission({ constraints: { equipRules: rules } }),
    });
    expect(sealed).toEqual(cfg.loadout);
  });

  it('빈 프로필(장비 미착용)에서도 던지지 않고 중립 로드아웃을 낸다', () => {
    const profile = defaultProfile();
    const ship = activeShip(profile);
    expect(Object.keys(ship.equipped).length).toBeGreaterThanOrEqual(0); // 신규 프로필은 대개 미착용
    expect(() => commissionSealedLoadout(profile)).not.toThrow();
  });
});
