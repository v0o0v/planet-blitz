/**
 * A-8 — **의뢰 클리어는 최고 클리어 단계를 갱신하지 않는다** (PA 레인 계약 §10).
 *
 * ⚠️ 이 게이트는 **양쪽이 다 위험하다.**
 *  - 안 걸면: 서버가 지정한 무대를 도는 의뢰로 정규 진행(ADR-0022)의 단계 개방을 우회한다.
 *  - 넓게 걸면: 일반 PvE 의 단계 개방이 **영영 안 된다**(`settlement.ts` 의 "핵심 배선 —
 *    누락 시 개방 영영 안 됨" 주석이 경고하는 정반대 회귀).
 * 그래서 양성·음성 두 방향을 모두 단언한다.
 */

import { describe, it, expect } from 'vitest';
import { settleRun } from '../src/save/settlement.js';
import { defaultProfile } from '../src/save/profile.js';

const base = { loot: [], xpTotal: 0, resources: 0, planet: 1, stage: 7 } as const;

describe('A-8 최고 클리어 미갱신', () => {
  it('일반 PvE 승리는 **반드시** 최고 클리어를 갱신한다 (게이트를 넓게 걸면 여기서 걸린다)', () => {
    const p = defaultProfile();
    settleRun(p, { ...base, victory: true });
    expect(p.planetProgress[1]?.bestStageCleared).toBe(7);
  });

  it('`commission: false` 도 갱신한다 (필드 존재 자체가 게이트가 되면 안 된다)', () => {
    const p = defaultProfile();
    settleRun(p, { ...base, victory: true, commission: false });
    expect(p.planetProgress[1]?.bestStageCleared).toBe(7);
  });

  it('의뢰 런 승리는 갱신하지 않는다', () => {
    const p = defaultProfile();
    settleRun(p, { ...base, victory: true, commission: true });
    expect(p.planetProgress[1]).toBeUndefined();
  });

  it('의뢰 런이라도 전리품·XP·크레딧 델타는 정상 산출된다 (게이트가 정산을 통째로 막지 않는다)', () => {
    const p = defaultProfile();
    const out = settleRun(p, {
      ...base,
      victory: true,
      commission: true,
      resources: 40,
      xpTotal: 1200,
      loot: [{ seed: 11, rarity: 1, planet: 1, stage: 7 }],
    });
    expect(out.creditsGained).toBe(40);
    expect(out.itemsGained.length).toBe(1);
    // XP 는 메타 풀로 적립된다(레벨업 여부는 곡선·감쇠에 달렸으므로 단언하지 않는다).
    expect(p.inventory.length).toBe(1);
  });

  it('`SettlementOutcome.commission` 이 호출부로 되비친다 (재화 경로 분기의 유일한 신호)', () => {
    const p = defaultProfile();
    expect(settleRun(p, { ...base, victory: true, commission: true }).commission).toBe(true);
    expect(settleRun(defaultProfile(), { ...base, victory: true }).commission).toBe(false);
  });
});
