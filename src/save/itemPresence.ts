/**
 * 세이브 안에 특정 `Item.id` 가 이미 있는가 — **배송 멱등의 유일한 판정자**.
 *
 * ## 왜 이 파일이 따로 있는가
 * 서버 배송함(의뢰 확정 지급물 `commission_grants`, 일일 보상 `daily_reward_claims`)은
 * "한 번만 심어라"를 클라가 지켜야 한다. 그런데 이 리포에는 **그것을 대신 지켜 줄 서버
 * 테이블이 없다** — `items` 테이블은 존재하지만 클라가 거기에 한 줄도 쓰지 않는다
 * (`src/**` 에 `.from('items')` 0건). 즉 안전망은 이 순수 함수 하나뿐이고, 여기가 틀리면
 * 배송이 매 부팅마다 같은 물건을 다시 심는다.
 *
 * ## 왜 `inventory` 만 보면 안 되는가 (이 함수의 존재 이유)
 * 아이템은 가만히 있지 않는다. 플레이어가 **장착**하거나 **창고로 옮기는** 순간
 * `inventory` 에서 사라지므로, `inventory` 만 훑는 판정은 그 다음 부팅에서 "없다"고
 * 대답하고 같은 아이템을 하나 더 심는다. 그래서 **네 자리를 전수**로 본다:
 *   ① `inventory`                  — 가방
 *   ② `stash`                      — 창고
 *   ③ `ships[].equipped`           — 각 기체의 장착 8칸(`Partial<Record<EquipSlotId, Item>>`)
 *   ④ `guardians[].build.equipped` — 퇴역 수호기에 **잠긴** 장비(ADR-0024). 소멸 전까지
 *                                    여기 살아 있고 소멸 시 `stash` 로 돌아온다 —
 *                                    즉 이 칸을 빼면 퇴역 직후 창에서 중복 지급이 열린다.
 *
 * ⚠️ `guardians[].snapshot` 에는 장비가 없다(스탯 스냅샷이다). 장비는 `build` 쪽이며 그것은
 *    **선택 필드**다(ADR-0024 이전 구 수호기는 build 가 없다) — 부재를 그냥 건너뛴다.
 *
 * ## 형상 계약
 * 필드를 전부 선택적으로 받는다. 실제 {@link Profile} 이 구조적으로 이 형상을 만족하고,
 * 테스트가 최소 픽스처(`{ inventory: [...] }`)로도 부를 수 있다. 손상 세이브가 배열이 아닌
 * 값을 들고 있어도 던지지 않는다 — 배송 경로에서 예외가 나면 그 물건이 영영 안 온다.
 */

/** `hasItemId` 가 실제로 보는 유일한 필드. */
export interface ItemIdLike {
  readonly id: string;
}

/** 장착 칸 맵(슬롯 id → 아이템, 빈 칸은 부재). */
export type EquippedLike = { readonly [slot: string]: ItemIdLike | undefined };

/** {@link hasItemId} 가 훑는 최소 프로필 형상. `Profile` 이 구조적으로 이것을 만족한다. */
export interface ItemPresenceProfileLike {
  readonly inventory?: readonly ItemIdLike[];
  readonly stash?: readonly ItemIdLike[];
  readonly ships?: readonly { readonly equipped?: EquippedLike }[];
  readonly guardians?: readonly { readonly build?: { readonly equipped?: EquippedLike } }[];
}

/** 배열 안에 `id` 가 있는가. 손상 값(배열 아님·원소가 객체 아님)은 조용히 건너뛴다. */
function listHas(list: readonly ItemIdLike[] | undefined, itemId: string): boolean {
  if (!Array.isArray(list)) return false;
  for (const it of list) {
    if (it !== null && typeof it === 'object' && it.id === itemId) return true;
  }
  return false;
}

/** 장착 맵 안에 `id` 가 있는가. */
function equippedHas(equipped: EquippedLike | undefined, itemId: string): boolean {
  if (equipped === null || equipped === undefined || typeof equipped !== 'object') return false;
  for (const it of Object.values(equipped)) {
    if (it !== null && it !== undefined && typeof it === 'object' && it.id === itemId) return true;
  }
  return false;
}

/**
 * 이 프로필이 `itemId` 를 **어디에든** 이미 들고 있는가(가방·창고·기체 장착·수호기 잠김).
 *
 * 순수 함수다 — 시각·난수·저장소를 읽지 않는다. 서버 배송함 소비 경로는 반드시 이것으로
 * 멱등을 지켜야 한다: `applied_at` 표시가 실패해도, 재-pull 로 프로필이 갈려도, 다음 부팅의
 * 판정이 같은 답을 내야 물건이 하나로 유지된다.
 *
 * @param profile 검사할 프로필(부분 형상 허용)
 * @param itemId  결정론적으로 파생된 아이템 인스턴스 id(예: `commission:{grant_id}`)
 */
export function hasItemId(profile: ItemPresenceProfileLike, itemId: string): boolean {
  if (profile === null || typeof profile !== 'object' || itemId === '') return false;
  if (listHas(profile.inventory, itemId)) return true;
  if (listHas(profile.stash, itemId)) return true;
  const ships = profile.ships;
  if (Array.isArray(ships)) {
    for (const s of ships) {
      if (s !== null && typeof s === 'object' && equippedHas(s.equipped, itemId)) return true;
    }
  }
  const guardians = profile.guardians;
  if (Array.isArray(guardians)) {
    for (const g of guardians) {
      if (g === null || typeof g !== 'object') continue;
      if (equippedHas(g.build?.equipped, itemId)) return true;
    }
  }
  return false;
}
