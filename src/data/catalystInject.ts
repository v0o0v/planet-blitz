/**
 * 촉매 주입 게이트 규칙 — 순수 (ADR-0029 Lane 4 → **ADR-0052 로 개정**).
 *
 * 픽커(`src/ui/pixi/catalystPicker.ts`)의 "이 촉매를 넣을 수 있는가" 판정을 Pixi 없이 도는
 * 순수 함수로 뽑았다. 캔버스 화면은 node vitest 로 렌더를 못 돌리므로(예비역 로스터가
 * `countLockedGear` 를 뽑은 것과 같은 관례), 규칙을 여기 두고 테스트가 직접 검증한다.
 *
 * ## 다섯 규칙 (전부 서버 `consume_catalysts` 검증과 정합)
 *  1. **슬롯 상한** — 총 주입 수 < `SLOT_CAP`(3).
 *  2. **특산-행성 정합** — signature 촉매는 출신 행성에서만(공용은 무관).
 *  3. **유니크** — 같은 카드는 **한 장뿐**이다(ADR-0052). 스택이 사라진 자리다.
 *  4. **특산 상한** — 한 런에 특산 최대 `SIGNATURE_CAP`(2)장.
 *  5. **보유량** — 서버 원장에 최소 1장 있어야 한다.
 *
 * ⚠️ 규칙 3 이 이 파일의 **거동 변경**이다. 구 모델은 "현재 스택 < 보유 수량" 이라 같은 카드를
 * 보유 수량만큼 쌓을 수 있었다. ADR-0052 가 스택을 없앴고 `normalizeCatalystArray` 가 중복을
 * 접으므로, 게이트가 그대로면 **픽커에서 넣을 수 있는데 정규화가 지워 버리는** 어긋남이 난다.
 */

import {
  SLOT_CAP,
  hasCatalyst,
  isWithinSignatureCap,
  type CatalystDef,
} from './catalysts.js';

/** 보유 수량 스냅샷(catalyst_id → qty). 서버 원장의 표시용 사본. */
export type CatalystOwned = ReadonlyMap<number, number>;

/**
 * 주입이 막히는 **사유**. 픽커가 카드에 그대로 띄운다 — 비활성 버튼만 있고 이유가 없으면
 * "고장인가"로 읽힌다(헌장 §축소 작동 규율이 무효 카드에 요구하는 것과 같은 성격).
 * `null` = 막히지 않음.
 */
export type CatalystInjectBlock =
  | 'locked'
  | 'slotFull'
  | 'duplicate'
  | 'signatureCap'
  | 'noStock'
  | null;

/**
 * 특산 촉매가 이 행성에서 잠기는가(출신 행성이 아님). 공용(common)은 항상 false.
 * signature 인데 `planet` 이 선택 행성과 다르면 잠금 — 픽커가 비활성 + 사유를 렌더한다.
 */
export function catalystLocked(def: CatalystDef, planet: number): boolean {
  return def.kind === 'signature' && def.planet !== planet;
}

/**
 * 주입 배열에서 특정 id 의 현재 장수(순수). 유니크 주입이라 결과는 0 또는 1 이지만, 정규화
 * 이전의 날 배열이 들어올 수 있으므로 세는 형태를 유지한다.
 */
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
 * 막히는 사유를 하나 돌려준다(막히지 않으면 `null`). 순서는 **사용자에게 가장 설명적인 것
 * 우선** — 잠긴 특산에 "슬롯 가득참"이 뜨면 슬롯을 비워도 안 되는 이유를 못 배운다.
 */
export function catalystInjectBlock(
  def: CatalystDef,
  working: readonly number[],
  inventory: CatalystOwned,
  planet: number,
): CatalystInjectBlock {
  if (catalystLocked(def, planet)) return 'locked';
  if (hasCatalyst(working, def.id)) return 'duplicate';
  if (ownedCount(inventory, def.id) <= 0) return 'noStock';
  if (working.length >= SLOT_CAP) return 'slotFull';
  if (!isWithinSignatureCap([...working, def.id])) return 'signatureCap';
  return null;
}

/**
 * 이 촉매를 넣을 수 있는가(순수). 위 다섯 규칙을 모두 만족해야 true.
 * 서버 `consume_catalysts` 가 결국 재검증하므로 이 게이트는 UI 선제 방어일 뿐이다.
 */
export function canInjectCatalyst(
  def: CatalystDef,
  working: readonly number[],
  inventory: CatalystOwned,
  planet: number,
): boolean {
  return catalystInjectBlock(def, working, inventory, planet) === null;
}
