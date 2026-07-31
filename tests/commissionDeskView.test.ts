/**
 * 지시 수신소 표시 로직 — `src/ui/pixi/commissionDeskView.ts` (계획 §Phase E).
 *
 * 화면(`commissionDesk.ts`)은 캔버스가 없는 vitest 에서 `Text.width` 등이 던지므로 통째로는
 * 못 싣는다(`catalystShopView.test.ts` 선례). 그래서 **표시 문구 판정**을 Pixi 밖으로 뽑아
 * 여기서 잠근다 — 라벨 유도·보상 요약·제약 계약 표시·정예 소집령 안내·보관 상한 문구.
 */

import { describe, it, expect } from 'vitest';
import {
  commissionGradeLabel,
  commissionOrderLabel,
  equipSlotDisplayName,
  commissionRewardSummary,
  commissionConstraintLines,
  commissionEliteNoteFor,
  commissionStockText,
} from '../src/ui/pixi/commissionDeskView.js';
import type { CommissionPayload } from '../src/run/commission.js';
import { t } from '../src/i18n/index.js';
import { POWERUPS } from '../src/sim/powerups.js';

function basePayload(overrides: Partial<CommissionPayload> = {}): CommissionPayload {
  return {
    version: 1,
    commissionId: '00000000-0000-4000-8000-000000000001',
    grade: 2,
    order: 'chain',
    segments: [{ planet: 0, stage: 1 }],
    rewards: { credits: 1000, minerals: 0, items: [] },
    replayBudgetTicks: 9000,
    ...overrides,
  };
}

describe('commissionGradeLabel / commissionOrderLabel', () => {
  it('계급 4종을 모두 구분한다', () => {
    expect(commissionGradeLabel(1)).toBe(t('commission.grade.1'));
    expect(commissionGradeLabel(2)).toBe(t('commission.grade.2'));
    expect(commissionGradeLabel(3)).toBe(t('commission.grade.3'));
    expect(commissionGradeLabel(4)).toBe(t('commission.grade.4'));
  });

  it('주문 4종을 모두 구분한다', () => {
    expect(commissionOrderLabel('chain')).toBe(t('commission.order.chain'));
    expect(commissionOrderLabel('constraint')).toBe(t('commission.order.constraint'));
    expect(commissionOrderLabel('bounty')).toBe(t('commission.order.bounty'));
    expect(commissionOrderLabel('elite')).toBe(t('commission.order.elite'));
  });
});

describe('equipSlotDisplayName', () => {
  it('module0/module1 은 위치 전용 표기다(모듈 슬롯 하나로 뭉개지 않는다)', () => {
    expect(equipSlotDisplayName('module0')).toBe(t('inv.module1'));
    expect(equipSlotDisplayName('module1')).toBe(t('inv.module2'));
  });

  it('그 외 슬롯은 slotLabel 그대로다', () => {
    expect(equipSlotDisplayName('main')).toBe(t('item.slot.main'));
    expect(equipSlotDisplayName('shield')).toBe(t('item.slot.shield'));
  });
});

describe('commissionRewardSummary', () => {
  it('광물 0·아이템 0·유니크 없음이면 그 줄들이 null 이다(빈 줄 대신 미표시)', () => {
    const s = commissionRewardSummary(basePayload());
    expect(s.creditsText).toBe(t('commission.rewards.credits', { n: 1000 }));
    expect(s.mineralsText).toBeNull();
    expect(s.itemsText).toBeNull();
    expect(s.hasUnique).toBe(false);
  });

  it('광물·아이템·유니크가 있으면 각 줄이 채워진다', () => {
    const s = commissionRewardSummary(
      basePayload({
        rewards: {
          credits: 500,
          minerals: 200,
          items: [{ rarity: 2, reqLevelCap: 50 }],
          uniqueId: 7,
        },
      }),
    );
    expect(s.mineralsText).toBe(t('commission.rewards.minerals', { n: 200 }));
    expect(s.itemsText).toBe(t('commission.rewards.items', { n: 1 }));
    expect(s.hasUnique).toBe(true);
  });
});

describe('commissionConstraintLines — 제약 계약만 값을 낸다', () => {
  it('제약 계약이 아니면 항상 빈 배열이다(다른 주문에 잘못 표시되지 않는다)', () => {
    expect(commissionConstraintLines(basePayload({ order: 'chain' }))).toEqual([]);
    expect(commissionConstraintLines(basePayload({ order: 'elite' }))).toEqual([]);
  });

  it('금지 장비 슬롯이 표시된다', () => {
    const lines = commissionConstraintLines(
      basePayload({
        order: 'constraint',
        constraints: { equipRules: { bannedSlots: ['main', 'module0'] } },
      }),
    );
    expect(lines).toEqual([
      t('commission.constraint.bannedSlots', {
        list: `${t('item.slot.main')} · ${t('inv.module1')}`,
      }),
    ]);
  });

  it('등급 상한이 표시된다', () => {
    const lines = commissionConstraintLines(
      basePayload({ order: 'constraint', constraints: { equipRules: { maxRarity: 2 } } }),
    );
    expect(lines).toEqual([t('commission.constraint.maxRarity', { name: t('item.rarity.rare') })]);
  });

  it('금지 성장 계열이 파워업 이름으로 표시된다', () => {
    const lines = commissionConstraintLines(
      basePayload({ order: 'constraint', constraints: { bannedPowerupLines: [0, 1] } }),
    );
    expect(lines).toEqual([
      t('commission.constraint.bannedPowerups', { list: `${POWERUPS[0]?.name} · ${POWERUPS[1]?.name}` }),
    ]);
  });

  it('세 축이 모두 있으면 세 줄이 그 순서(장비 슬롯 → 등급 상한 → 성장 계열)로 나온다', () => {
    const lines = commissionConstraintLines(
      basePayload({
        order: 'constraint',
        constraints: {
          equipRules: { bannedSlots: ['sub'], maxRarity: 1 },
          bannedPowerupLines: [2],
        },
      }),
    );
    expect(lines.length).toBe(3);
  });
});

describe('commissionEliteNoteFor — ADR-0043', () => {
  it('정예 소집령만 "런 내 성장 없음" 안내를 낸다', () => {
    expect(commissionEliteNoteFor('elite')).toBe(t('commission.eliteNoGrowth'));
    expect(commissionEliteNoteFor('chain')).toBeNull();
    expect(commissionEliteNoteFor('constraint')).toBeNull();
    expect(commissionEliteNoteFor('bounty')).toBeNull();
  });
});

describe('commissionStockText — 보관 상한', () => {
  it('보유/상한을 그대로 담는다', () => {
    expect(commissionStockText(3, 12)).toBe(t('commission.stock', { n: 3, cap: 12 }));
  });
});
