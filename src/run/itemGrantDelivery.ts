/**
 * 서버 드랍 **배송** — 아이템 원장(`item_grants`) → 플레이어 세이브 (ADR-0050 §3 단계 1).
 *
 * ## 이 파일이 서는 계약 — 「개수만 계약」(사용자 승인)
 * 런 중에는 "회수 완료 N점"만 알 수 있고 **개봉은 정산 때**다. 클라는 주운 **개수**를 주장하고
 * 서버가 개연성 캡으로 깎은 뒤 **자기 시드로** 그 수만큼 굴려 원장에 적는다. 즉 이 파일이
 * 도는 시점에야 클라는 무엇이 나왔는지 안다 — 그것이 *"클라는 결과를 받을 뿐 무엇이 나올지
 * 모른다"* 의 실제 구현이다.
 *
 * ## 왜 발급 응답을 직접 소비하지 않고 원장을 다시 읽을 수도 있는가
 * `grant_run_drops` 는 발급 결과를 반환값에 담아 주므로 정산 직후 경로는 그것을 바로 쓴다.
 * 그런데 그 응답을 받기 전에 앱이 죽으면 **원장에는 행이 있고 세이브에는 없다.** 그래서
 * 부팅 재개 경로는 `applied_at IS NULL` 인 행을 다시 읽어 같은 함수로 배송한다 — 배송 경로가
 * 하나라 두 경로가 갈릴 여지가 없다(의뢰 배송이 세운 규율과 같다).
 *
 * ## 순서 계약 — 이 순서가 틀리면 아이템이 영구 유실된다
 *   ① 세이브 반영 → ② 로컬 저장 → ③ 서버 프로필 push **성공** → ④ 재-pull 로 존재 확인
 *   → ⑤ 그 뒤에야 `applied_at` 표시.
 * ③ 앞에서 표시하면 `chooseProfile` 의 통짜 선택(src/net/profileSync.ts)이 그 아이템을 버릴 수
 * 있다 — `progressScore` 는 기체 레벨 1 = 1000점이라 **아이템 48개 차이도 진다** — 그런데 행은
 * 이미 표시돼 재시도되지 않는다.
 *
 * ## 멱등은 순수 함수가 단독으로 보장한다
 * `items` 테이블은 안전망이 **아니다**(클라가 그 테이블에 한 줄도 안 쓴다 — `src/**` 에
 * `.from('items')` 0건). 유일한 방어는 `hasItemId` 가 세이브 네 자리(가방·창고·기체 장착·
 * 수호기 잠김)를 전수로 훑는 것이고, 그것이 성립하려면 아이템 id 가 `grant_id` 에서 결정론
 * 파생이어야 한다(`src/items/dropGrant.ts`).
 */

import type { Profile } from '../save/profile.js';
import { INVENTORY_CAP, stashCapacity } from '../save/profile.js';
import { hasItemId } from '../save/itemPresence.js';
import type { ItemPresenceProfileLike } from '../save/itemPresence.js';
import { dropGrantItemId, itemFromDropGrant } from '../items/dropGrant.js';
import type { ItemSource } from '../items/types.js';
import type { ItemGrantRow } from '../net/gateway.js';

/** 주입 가능한 배송 의존성. 전부 순수하지 않은 경계라 테스트가 여기를 잡는다. */
export interface ItemGrantDeliveryDeps {
  /** 배송할 원장 행. `null` = 미설정·오프라인·오류(전체 no-op). */
  readonly fetchGrants: () => Promise<readonly ItemGrantRow[] | null>;
  /** 로컬 저장(`saveProfile`). */
  readonly saveProfile: (profile: Profile) => void;
  /** 서버 upsert. `false` = 안 올라갔다 → **표시하지 않는다**. */
  readonly pushProfile: (profile: Profile) => Promise<boolean>;
  /**
   * 재-pull 후 확인 대상 프로필. `null` = 확인 불가(오프라인·오류) → 표시하지 않는다.
   * 구현은 `pullServerProfileInto` 를 거쳐 **같은 객체를 되돌려 주면 된다** — 서버가 더 진행된
   * 프로필을 갖고 있었다면 그 호출이 로컬을 갈아 끼우고, 그러면 방금 심은 아이템이 사라져
   * 아래 존재 확인이 실패한다. 그것이 정확히 우리가 잡으려는 사건이다.
   */
  readonly repullProfile: (profile: Profile) => Promise<ItemPresenceProfileLike | null>;
  /** `mark_item_grant_applied`. `false` = 표시 실패(다음 부팅이 다시 시도한다). */
  readonly markApplied: (grantId: string) => Promise<boolean>;
}

/** 배송 1회분 결과. 화면에는 쓰지 않고 테스트·로그가 읽는다. */
export interface ItemGrantDeliveryReport {
  /** 세이브에 새로 심은 아이템 수. */
  readonly delivered: number;
  /** `applied_at` 을 찍은 행 수(이미 들고 있어 심지 않고 찍은 것 포함). */
  readonly marked: number;
  /** 인벤·창고 만석으로 보류한 행 수(표시하지 않았다). */
  readonly held: number;
  /** 등급·시드가 형식 위반이라 해석하지 못해 남겨 둔 행 수. */
  readonly unresolved: number;
}

const EMPTY: ItemGrantDeliveryReport = { delivered: 0, marked: 0, held: 0, unresolved: 0 };

/** 표시 시도 — 예외도 실패로 접는다(이 경로의 예외가 배송 루프를 끊으면 안 된다). */
async function tryMark(deps: ItemGrantDeliveryDeps, grantId: string): Promise<boolean> {
  try {
    return await deps.markApplied(grantId);
  } catch {
    return false;
  }
}

/**
 * 원장 행의 `source` → `ItemSource`.
 *
 * ⚠️ `levelCap` 은 **있을 때만** 싣는다(exactOptionalPropertyTypes). 부재 = "상한 없음"이라
 * 의미가 다르다 — 서버가 `jsonb_strip_nulls` 로 비운 키를 아예 안 보내므로 그 구분이 살아 있다.
 */
function sourceOf(row: ItemGrantRow): ItemSource {
  return {
    planet: row.source.planet ?? 0,
    stage: row.source.stage ?? 0,
    ...(row.source.levelCap !== undefined ? { levelCap: row.source.levelCap } : {}),
  };
}

/**
 * 미배송 발급을 세이브에 반영하고 서버에 배송 완료를 표시한다.
 *
 * 절대 throw 하지 않는다 — 이 경로에서 예외가 나면 그 물건이 영영 안 온다.
 * 오프라인·미설정이면 완전 no-op 이다(빈 리포트).
 */
export async function deliverItemGrants(
  profile: Profile,
  deps: ItemGrantDeliveryDeps,
): Promise<ItemGrantDeliveryReport> {
  let rows: readonly ItemGrantRow[] | null;
  try {
    rows = await deps.fetchGrants();
  } catch {
    return EMPTY;
  }
  if (rows === null || rows.length === 0) return EMPTY;

  let delivered = 0;
  let marked = 0;
  let held = 0;
  let unresolved = 0;

  for (const row of rows) {
    if (row.appliedAtMs !== null) continue; // 이미 배송됨.

    const itemId = dropGrantItemId(row.grantId);

    // 이미 들고 있으면(표시 직전에 앱이 죽었던 경우) 다시 심지 않고 **표시만** 시도한다.
    if (hasItemId(profile, itemId)) {
      if (await tryMark(deps, row.grantId)) marked++;
      continue;
    }

    const item = itemFromDropGrant(row.grantId, row.dropSeed, row.rarity, sourceOf(row));
    if (item === null) {
      // 형식 위반 — **조용히 버리지 않는다.** 표시하지 않고 남기면 원인이 고쳐지는 날
      // 다음 부팅이 같은 행을 읽어 그때 배송한다.
      unresolved++;
      continue;
    }

    // 만석이면 반영을 보류하고 표시하지 않는다. 억지로 밀어 넣으면 상한이 무의미해지고,
    // 표시해 버리면 플레이어가 자리를 비운 뒤에도 영영 못 받는다.
    if (profile.inventory.length < INVENTORY_CAP) {
      profile.inventory.push(item);
    } else if (profile.stash.length < stashCapacity(profile.stashExpansions)) {
      profile.stash.push(item);
    } else {
      held++;
      continue;
    }
    delivered++;
    deps.saveProfile(profile);

    // ③ push 성공 → ④ 재-pull 존재 확인 → ⑤ 표시. 어느 단계든 실패하면 표시하지 않는다.
    // 아이템은 로컬 세이브에 남아 있고 행도 미배송이라, 다음 부팅이 `hasItemId` 로 중복을
    // 피하면서 표시만 다시 시도한다.
    let pushed = false;
    try {
      pushed = await deps.pushProfile(profile);
    } catch {
      pushed = false;
    }
    if (!pushed) continue;

    let confirmed: ItemPresenceProfileLike | null = null;
    try {
      confirmed = await deps.repullProfile(profile);
    } catch {
      confirmed = null;
    }
    if (confirmed === null || !hasItemId(confirmed, itemId)) continue;

    if (await tryMark(deps, row.grantId)) marked++;
  }

  return { delivered, marked, held, unresolved };
}
