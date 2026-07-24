/**
 * 촉매 주입 게이트 규칙 — 순수 (ADR-0029, Lane 4).
 *
 * 픽커(`src/ui/pixi/catalystPicker.ts`)의 "이 촉매를 한 개 더 주입할 수 있는가" 판정을 Pixi 없이
 * 도는 순수 함수로 뽑았다. 캔버스 화면은 node vitest 로 렌더를 못 돌리므로(예비역 로스터가
 * `countLockedGear` 를 뽑은 것과 같은 관례), 규칙을 여기 두고 테스트가 직접 검증한다.
 *
 * 세 규칙(전부 서버 `consume_catalysts` 검증과 정합):
 *  1. **슬롯 상한** — 총 주입 수 < SLOT_CAP.
 *  2. **특산-행성 정합** — signature 촉매는 출신 행성에서만(공용은 무관).
 *  3. **보유량** — 그 촉매의 현재 주입 수(스택) < 서버 보유 수량.
 */

import { SLOT_CAP, type CatalystDef } from './catalysts.js';

/** 보유 수량 스냅샷(catalyst_id → qty). 서버 원장의 표시용 사본. */
export type CatalystOwned = ReadonlyMap<number, number>;

/**
 * 특산 촉매가 이 행성에서 잠기는가(출신 행성이 아님). 공용(common)은 항상 false.
 * signature 인데 `planet` 이 선택 행성과 다르면 잠금 — 픽커가 비활성 + 사유를 렌더한다.
 */
export function catalystLocked(def: CatalystDef, planet: number): boolean {
  return def.kind === 'signature' && def.planet !== planet;
}

/** 주입 배열에서 특정 id 의 현재 스택 수(순수). */
export function injectedCount(working: readonly number[], id: number): number {
  let n = 0;
  for (const x of working) if (x === id) n++;
  return n;
}

/** 보유 스냅샷에서 특정 id 의 보유 수량(없으면 0). */
export function ownedCount(inventory: CatalystOwned, id: number): number {
  return inventory.get(id) ?? 0;
}

/**
 * 이 촉매를 한 개 더 주입할 수 있는가(순수). 위 세 규칙을 모두 만족해야 true.
 * 서버 `consume_catalysts` 가 결국 재검증하므로 이 게이트는 UI 선제 방어(과주입 방지)일 뿐이다.
 */
export function canInjectCatalyst(
  def: CatalystDef,
  working: readonly number[],
  inventory: CatalystOwned,
  planet: number,
): boolean {
  if (catalystLocked(def, planet)) return false;
  if (working.length >= SLOT_CAP) return false;
  return injectedCount(working, def.id) < ownedCount(inventory, def.id);
}
