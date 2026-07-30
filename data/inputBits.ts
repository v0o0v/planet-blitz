/**
 * 액티브 스킬 발동 입력 비트 — `InputFrame.special` 의 **leaf 정의**(ADR-0041 · 계획 0a-3).
 *
 * ## 왜 여기(leaf 데이터)에 정의하는가
 * `src/sim/world.ts:314-318` 이 이미 명문화했다 — 그 블록은 정의가 아니라 **재수출**이다.
 * 정의를 world.ts 에 두면 비트를 읽는 sim 모듈이 world.ts 를 런타임 import 해야 하는데
 * world.ts 는 이미 그 모듈들을 import 하므로 **순환**이 된다. `data/encounters.ts` 는 조우
 * 도메인 파일이라 액티브 비트를 넣으면 의미축이 섞이므로 쓰지 않는다 — 그래서 별도 leaf.
 *
 * ## 비트 배치 (APPEND-ONLY — 리플레이 wire 계약, 재배치·재사용 절대 금지)
 * ```
 *   비트 0    = SPECIAL_POWERUP_PICK            (src/sim/world.ts:307)
 *   비트 1..2 = 파워업 선택 인덱스 0..3          (packPowerupPick)
 *   비트 3    = SPECIAL_ENCOUNTER_ENTER          (data/encounters.ts)
 *   비트 4    = SPECIAL_ENCOUNTER_DECLINE
 *   비트 5    = SPECIAL_ENCOUNTER_ALTAR_PICK
 *   비트 6..7 = 제단 선택 인덱스 0..3
 *   비트 8    = SPECIAL_ENCOUNTER_EXIT
 *   비트 9    = SPECIAL_ACTIVE_SLOT1   ← 여기부터 액티브 스킬(ADR-0041)
 *   비트 10   = SPECIAL_ACTIVE_SLOT2
 * ```
 * 이미 기록된 리플레이의 `special` 값이 새 의미로 재해석되면 서버 재검증이 갈린다.
 *
 * ## 프리즈 규율
 * 컨트롤러는 파워업 픽이 대기 중이면 이 비트를 **싣지 않는다**(조우 비트와 같은 규율,
 * `src/input/controller.ts:128-155`). sim 쪽에서도 `pendingLevelUp`·detour 분기가 발동
 * 호출 지점보다 위에서 조기 return 하므로 프리즈 중 입력은 **버려진다**(AC-8·AC-9).
 *
 * 순수 데이터. 다른 모듈을 import 하지 않는다 — 이 규율이 깨지면 순환이 되살아난다.
 */

/** 액티브 슬롯 1(키 `z`) 발동. */
export const SPECIAL_ACTIVE_SLOT1 = 1 << 9;
/** 액티브 슬롯 2(키 `x`) 발동. */
export const SPECIAL_ACTIVE_SLOT2 = 1 << 10;

/** 슬롯 인덱스(0/1) → 해당 비트. 범위 밖은 0(무발동). */
export function activeSlotBit(slotIndex: number): number {
  if (slotIndex === 0) return SPECIAL_ACTIVE_SLOT1;
  if (slotIndex === 1) return SPECIAL_ACTIVE_SLOT2;
  return 0;
}
