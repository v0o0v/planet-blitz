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
import { M2_UNIQUES, M3_UNIQUES } from '../data/uniques.js';

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

describe('금지 유니크가 **이름으로** 표시된다 (리뷰 후속 — 미표시는 결함으로 읽힌다)', () => {
  // ⚠️ 초안은 이 축을 "역조회 자리 미비"로 미뤘는데 오판이었다 — `M2_UNIQUES` 가 `bit`·`name` 을
  //    나란히 들고 있다. 그리고 미표시는 단순 누락이 아니다: 장비축 제약은 `runConfig.ts` 의
  //    `equippedItems` 단계에서 **조용히** 빠지므로 아무 오류도 안 나고, 플레이어는 장비가
  //    사라진 것을 결함으로 읽는다.
  const first = M2_UNIQUES[0];
  const second = M2_UNIQUES[1];

  it('**M3 카탈로그(bit 5~14)도 이름으로 나온다** — 초판은 M2 만 훑어 10종이 #5~#14 였다', () => {
    // ⚠️ 이 케이스가 없으면 M2(5종)만 쓰는 위 테스트가 전부 초록인 채로 유니크 15종 중 10종이
    //    이름 대신 `#12` 로 나온다. 그리고 '미상 폴백'이 그 결함을 정확히 은폐한다 — 알고 있는데
    //    못 찾은 것이 미상처럼 보인다. 목록을 순회하는 검증이 목록 변경에 눈머는 형태 그대로다.
    const m3 = M3_UNIQUES[0];
    if (m3 === undefined) throw new Error('M3 유니크 카탈로그가 비었다');
    const lines = commissionConstraintLines(
      basePayload({
        order: 'constraint',
        constraints: { equipRules: { bannedUniqueIds: [m3.bit] } },
      }),
    );
    expect(lines).toEqual([t('commission.constraint.bannedUniques', { list: m3.name })]);
    // 통과하면서도 참일 수 있는 나쁜 상태: 구현이 `#<bit>` 를 냈는데 그 문자열이 우연히 이름과
    // 같은 것. 그래서 '#' 이 안 들어갔음을 함께 본다.
    expect(lines[0]).not.toContain('#');
  });

  it('카탈로그 전 항목이 이름으로 열린다 (미상 폴백이 실제 결함을 덮지 않는다)', () => {
    const all = [...M2_UNIQUES, ...M3_UNIQUES];
    expect(all.length).toBeGreaterThan(10);
    for (const def of all) {
      const lines = commissionConstraintLines(
        basePayload({
          order: 'constraint',
          constraints: { equipRules: { bannedUniqueIds: [def.bit] } },
        }),
      );
      expect(lines[0], `bit ${def.bit}(${def.name}) 가 이름으로 안 열린다`).toContain(def.name);
    }
  });

  it('bit 로 조회한 이름이 나온다 (wire 정본이 문자열 id 가 아니라 bit 다)', () => {
    if (first === undefined || second === undefined) throw new Error('유니크 카탈로그가 비었다');
    const lines = commissionConstraintLines(
      basePayload({
        order: 'constraint',
        constraints: { equipRules: { bannedUniqueIds: [first.bit, second.bit] } },
      }),
    );
    expect(lines).toEqual([
      t('commission.constraint.bannedUniques', { list: `${first.name} · ${second.name}` }),
    ]);
  });

  it('미상 bit 도 **버리지 않고** 표시한다 (조용한 누락이 아무것도 안 보이는 것보다 나쁘다)', () => {
    // ⚠️ 이 단언이 통과하면서도 참일 수 있는 나쁜 상태: 구현이 미상 항목을 빈 문자열로 만들어
    //    ' · ' 만 남기는 것. 그래서 표시 문자열에 원문 식별자가 실제로 들어 있는지 본다.
    const unknownBit = 999;
    const lines = commissionConstraintLines(
      basePayload({
        order: 'constraint',
        constraints: { equipRules: { bannedUniqueIds: [unknownBit] } },
      }),
    );
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(String(unknownBit));
  });

  it('금지 유니크가 없으면 그 줄이 아예 안 나온다', () => {
    const lines = commissionConstraintLines(
      basePayload({ order: 'constraint', constraints: { equipRules: { bannedUniqueIds: [] } } }),
    );
    expect(lines).toEqual([]);
  });
});
