/**
 * 액티브 스킬 **장착 규칙**(ADR-0041 · 계획 C 레인 · AC-12~14).
 *
 * 해금·위력·쿨다운은 전부 `skillInvest` 에서 **파생**한다(별도 저장 0 — AC-13). 이 모듈은
 * 그 파생 규칙 위에 "장착"이라는 독립 선택을 얹는 얇은 층이고, 순수 함수만 담는다
 * (DOM·Pixi·sim 참조 없음). 산술 정본은 `data/ships/actives/index.ts` 다 — 규칙을 여기서
 * 복제하지 않는다(복제하면 두 규칙이 조용히 갈린다).
 */

import {
  ACTIVES_BY_SHIP,
  activeById,
  activeCooldownTicks,
  activeGateThreshold,
  activePowerCenti,
  investedInTree,
  isActiveUnlocked,
} from '../../data/ships/actives/index.js';
import type { ActiveSkillDef } from '../../data/ships/actives/types.js';
import { ACTIVE_SLOT_COUNT } from '../../data/ships/actives/types.js';

/** 연구소가 그리는 한 칸의 표시 상태. 문자열은 전부 `t()` 경유이므로 여기엔 없다. */
export interface ActiveSlotView {
  readonly def: ActiveSkillDef;
  readonly unlocked: boolean;
  /** 해금 임계(계열 base 누적). 잠긴 칸에 "필요 투자량"으로 표시한다(AC-16). */
  readonly threshold: number;
  /** 지금 그 계열에 투자된 base 누적. */
  readonly invested: number;
  /** 현재 투자량 기준 실효 쿨다운(틱)과 위력 배율(centi). 둘 다 `skillInvest` 파생. */
  readonly cooldownTicks: number;
  readonly powerCenti: number;
  /** 어느 슬롯에 끼워져 있는가(미장착이면 -1). */
  readonly equippedSlot: number;
}

/** 그 기체의 6종을 화면이 그릴 수 있는 형태로 편다. 저작 전(빈 레지스트리)이면 빈 배열. */
export function activeSlotViews(
  shipTypeId: number,
  skillInvest: readonly number[],
  activeSlots: readonly (string | null)[],
): ActiveSlotView[] {
  const list = ACTIVES_BY_SHIP[shipTypeId] ?? [];
  return list.map((def) => ({
    def,
    unlocked: isActiveUnlocked(skillInvest, def),
    threshold: activeGateThreshold(def),
    invested: investedInTree(skillInvest, def),
    cooldownTicks: activeCooldownTicks(def, investedInTree(skillInvest, def)),
    powerCenti: activePowerCenti(def, investedInTree(skillInvest, def)),
    equippedSlot: activeSlots.findIndex((id) => id === def.id),
  }));
}

/** 장착 시도 결과. 거부 사유를 분리해 UI 가 정확한 안내를 낼 수 있게 한다. */
export type EquipActiveResult =
  | { ok: true; slots: (string | null)[] }
  | { ok: false; reason: 'unknown' | 'wrong-ship' | 'locked' | 'slots-full' | 'already-equipped' };

/**
 * 액티브를 빈 슬롯에 끼운다. **최대 2개이고 3개째 시도는 거부된다**(AC-14).
 *
 * 이미 끼워져 있으면 `already-equipped` 로 거부한다(같은 스킬을 두 슬롯에 넣는 것은 의미가
 * 없고, 파워업 인덱스 24·25 가 슬롯 축이라 중복이 들어가면 두 선택지가 같은 것을 강화한다).
 */
export function equipActive(
  shipTypeId: number,
  skillInvest: readonly number[],
  activeSlots: readonly (string | null)[],
  id: string,
): EquipActiveResult {
  const def = activeById(id);
  if (def === undefined) return { ok: false, reason: 'unknown' };
  if (def.shipTypeId !== shipTypeId) return { ok: false, reason: 'wrong-ship' };
  if (!isActiveUnlocked(skillInvest, def)) return { ok: false, reason: 'locked' };
  const slots = normalizeSlots(activeSlots);
  if (slots.includes(id)) return { ok: false, reason: 'already-equipped' };
  const free = slots.findIndex((s) => s === null);
  if (free < 0) return { ok: false, reason: 'slots-full' };
  slots[free] = id;
  return { ok: true, slots };
}

/** 슬롯을 비운다. 범위 밖 인덱스는 무연산(원본과 같은 값의 새 배열을 돌려준다). */
export function unequipActive(
  activeSlots: readonly (string | null)[],
  slotIndex: number,
): (string | null)[] {
  const slots = normalizeSlots(activeSlots);
  if (slotIndex >= 0 && slotIndex < ACTIVE_SLOT_COUNT) slots[slotIndex] = null;
  return slots;
}

/** 길이 2 고정의 가변 사본. 저장층 정규화(`normalizeShip`)와 같은 형태를 유지한다. */
function normalizeSlots(v: readonly (string | null)[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < ACTIVE_SLOT_COUNT; i++) out.push(v[i] ?? null);
  return out;
}
