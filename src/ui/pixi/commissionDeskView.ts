/**
 * 지시 수신소 표시 로직 — **Pixi 를 안 싣는 순수 계층**(계획 §Phase E 규율, `catalystShopView.ts`
 * 선례). 캔버스 스텁은 글자 크기를 실제보다 작게 재서 겹침·문구 판정을 놓친다
 * (`tests/pixiScreenPersistence.test.ts` 계약 주석) — 그래서 표시 판정 자체를 여기 뽑아
 * Pixi 없이 단위 테스트로 잠근다. `commissionDesk.ts` 는 이 모듈의 함수만 호출해 그린다.
 *
 * 순수 render/UI 레이어(ADR-0005) — sim 은 이 파일을 모른다.
 */

import type { CommissionGrade, CommissionOrder, CommissionPayload } from '../../run/commission.js';
import type { EquipSlotId, SlotKind } from '../../items/types.js';
import { RARITY_BY_CODE } from '../../items/types.js';
import { POWERUPS } from '../../sim/powerups.js';
import { slotLabel } from '../itemNames.js';
import { t, type MessageKey } from '../../i18n/index.js';

const GRADE_KEY: Record<CommissionGrade, MessageKey> = {
  1: 'commission.grade.1',
  2: 'commission.grade.2',
  3: 'commission.grade.3',
  4: 'commission.grade.4',
};

/** 계급 표시명(정기/우선/특급/최종 지시). */
export function commissionGradeLabel(grade: CommissionGrade): string {
  return t(GRADE_KEY[grade]);
}

const ORDER_KEY: Record<CommissionOrder, MessageKey> = {
  chain: 'commission.order.chain',
  constraint: 'commission.order.constraint',
  bounty: 'commission.order.bounty',
  elite: 'commission.order.elite',
};

/** 주문 표시명(연쇄 원정/제약 계약/현상금 표적/정예 소집령). */
export function commissionOrderLabel(order: CommissionOrder): string {
  return t(ORDER_KEY[order]);
}

/**
 * 장비축 제약 슬롯 id → 표시명. `module0`/`module1` 은 위치 전용 표기(모듈1/모듈2)를 쓴다 —
 * `slotLabel('module')` 하나로는 두 칸 중 어느 쪽이 봉인됐는지 구분이 안 된다(격납고 관례,
 * `hangar.ts` 와 동일 규칙).
 */
export function equipSlotDisplayName(id: EquipSlotId): string {
  if (id === 'module0') return t('inv.module1');
  if (id === 'module1') return t('inv.module2');
  return slotLabel(id as SlotKind);
}

/** 의뢰서 목록 카드 한 장의 보상 요약(순수 조립 — i18n 만). */
export interface CommissionRewardSummary {
  creditsText: string;
  mineralsText: string | null;
  itemsText: string | null;
  hasUnique: boolean;
}

export function commissionRewardSummary(payload: CommissionPayload): CommissionRewardSummary {
  const r = payload.rewards;
  return {
    creditsText: t('commission.rewards.credits', { n: r.credits }),
    mineralsText: r.minerals > 0 ? t('commission.rewards.minerals', { n: r.minerals }) : null,
    itemsText: r.items.length > 0 ? t('commission.rewards.items', { n: r.items.length }) : null,
    hasUnique: r.uniqueId !== undefined,
  };
}

/**
 * 제약 계약(장비축·성장축) 표시 줄. **다른 주문이면 빈 배열** — 카드에 아무 표시도 하지 않는다.
 *
 * ⚠️ `bannedUniqueIds` 는 아직 표시하지 않는다(개별 유니크 이름 역조회 자리 미비 — 후속 폴리시).
 * 이 함수는 스펙이 명시한 두 축(장비 슬롯·장비 등급 상한·성장 계열)만 진다.
 */
export function commissionConstraintLines(payload: CommissionPayload): string[] {
  if (payload.order !== 'constraint') return [];
  const lines: string[] = [];
  const rules = payload.constraints?.equipRules;
  if (rules?.bannedSlots !== undefined && rules.bannedSlots.length > 0) {
    lines.push(
      t('commission.constraint.bannedSlots', {
        list: rules.bannedSlots.map(equipSlotDisplayName).join(' · '),
      }),
    );
  }
  if (rules?.maxRarity !== undefined) {
    const rarity = RARITY_BY_CODE[rules.maxRarity] ?? 'normal';
    lines.push(t('commission.constraint.maxRarity', { name: t(`item.rarity.${rarity}` as MessageKey) }));
  }
  const bannedPowerups = payload.constraints?.bannedPowerupLines;
  if (bannedPowerups !== undefined && bannedPowerups.length > 0) {
    const names = bannedPowerups.map((i) => POWERUPS[i]?.name ?? '?').join(' · ');
    lines.push(t('commission.constraint.bannedPowerups', { list: names }));
  }
  return lines;
}

/** 보관 상한 표시("보유 N/CAP", CONTEXT.md 용어 정본). */
export function commissionStockText(count: number, cap: number): string {
  return t('commission.stock', { n: count, cap });
}

/** 정예 소집령(ADR-0043) 전용 안내 — 아무 설명 없이 파워업이 안 열리면 결함으로 읽힌다. */
export function commissionEliteNoteFor(order: CommissionOrder): string | null {
  return order === 'elite' ? t('commission.eliteNoGrowth') : null;
}
