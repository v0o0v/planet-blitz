/**
 * 의뢰 확정 지급물 **배송** — 서버 발급 원장(`commission_grants`) → 플레이어 세이브.
 *
 * ## 이 파일이 닫는 공백
 * `settle_commission` 은 확정 지급물을 발급하고 그 목록을 반환값 `grants` 에 담으며, 그 값은
 * EF → `commissionGateway` → `submitCommissionRun` 까지 **이미 클라에 도달한다**. 그런데
 * `main.ts` 의 `verified` 분기가 그것을 아무 데도 쓰지 않고 버렸다 — 발급은 되는데 배송이
 * 없었다. 증상이 "이겼는데 물건이 안 왔다" 하나뿐이라 전 게이트가 초록인 채로 지나간다.
 *
 * ## 왜 `res.grants` 를 직접 소비하지 않고 원장을 다시 읽는가
 * `settle_commission` 이 반환하는 원소는 `{kind, slot_index, item_payload}` 뿐 — **`grant_id`
 * 가 없다**(20260803000000:877-888). 그런데 아이템 id·어픽스 시드·배송 표시가 전부 `grant_id`
 * 에 걸려 있다. 그것을 얻으려면 `settle_commission` 본문을 고쳐야 하는데 그 함수는 발급의
 * 단일 정본이고 낡은 본문 복제가 이 리포의 프로덕션을 100% 깨뜨린 전례가 있다
 * (20260802000000:4-15). 그래서 `res.grants` 는 **"지금 배송할 것이 생겼다"는 신호로만** 쓰고
 * 실제 값은 `applied_at IS NULL` 인 원장 행에서 읽는다. 부수 효과로 배송 경로가 하나가 되어
 * (제출 직후 · 부팅 재시도) 두 경로가 갈릴 여지가 사라진다 — 제출 직후에 앱이 죽어도 유실 0.
 *
 * ## 순서 계약 — 이 순서가 틀리면 아이템이 영구 유실된다
 *   ① 세이브 반영 → ② 로컬 저장 → ③ 서버 프로필 push **성공** → ④ 재-pull 로 존재 확인
 *   → ⑤ 그 뒤에야 `applied_at` 표시.
 * ③ 앞에서 표시하면 `chooseProfile` 의 통짜 선택(src/net/profileSync.ts:121-134)이 그 아이템을
 * 버릴 수 있다 — `progressScore` 는 기체 레벨 1 = 1000점이라 **아이템 48개 차이도 진다** —
 * 그런데 행은 이미 표시돼 재시도되지 않는다.
 *
 * ## 멱등은 순수 함수가 단독으로 보장한다
 * `items` 테이블은 안전망이 **아니다**(클라가 그 테이블에 한 줄도 안 쓴다 — `src/**` 에
 * `.from('items')` 0건). 유일한 방어는 `hasItemId`(src/save/itemPresence.ts)가 세이브 네 자리
 * (가방·창고·기체 장착·수호기 잠김)를 전수로 훑는 것이다. `inventory` 만 보면 플레이어가
 * 장착하거나 창고로 옮긴 순간 다음 부팅이 같은 아이템을 또 심는다.
 */

import type { Profile } from '../save/profile.js';
import { INVENTORY_CAP, stashCapacity } from '../save/profile.js';
import { hasItemId } from '../save/itemPresence.js';
import type { ItemPresenceProfileLike } from '../save/itemPresence.js';
import { commissionGrantItemId, itemFromCommissionGrant } from '../items/commissionGrant.js';
import type { ItemSource } from '../items/types.js';
import type { CommissionGrantRow } from '../net/commissionGateway.js';

/**
 * 의뢰 확정 유니크의 출처 스탬프. 의뢰는 행성·단계 개념이 없으므로 0 으로 둔다 —
 * `ItemSource` 는 표시에 쓰이지 않고(`src/**` 에 `source.planet` 소비 0건) `isValidItem` 의
 * 형상 검사만 통과하면 된다.
 *
 * ⚠️ `levelCap` 을 **일부러 넣지 않는다.** 부재 = "상한 없음"이고(types.ts), 확정 보상은
 *    종이에 적혀 발령된 것이라 드랍처 기준 상한을 물을 대상이 아니다. 넣으면 낮은 레벨에
 *    발령된 의뢰의 유니크가 성장 후에도 영영 못 입는 물건이 된다.
 */
const COMMISSION_ITEM_SOURCE: ItemSource = { planet: 0, stage: 0 };

/** 주입 가능한 배송 의존성. 전부 순수하지 않은 경계라 테스트가 여기를 잡는다. */
export interface CommissionGrantDeliveryDeps {
  /** 본인 발급 원장 전체. `null` = 미설정·오프라인·오류(전체 no-op). */
  readonly fetchGrants: () => Promise<readonly CommissionGrantRow[] | null>;
  /** 로컬 저장(`saveProfile`). */
  readonly saveProfile: (profile: Profile) => void;
  /** 서버 upsert. `false` = 안 올라갔다 → **표시하지 않는다**. */
  readonly pushProfile: (profile: Profile) => Promise<boolean>;
  /**
   * 재-pull 후 확인 대상 프로필. `null` = 확인 불가(오프라인·오류) → 표시하지 않는다.
   * 구현은 `pullServerProfileInto` 를 거쳐 **같은 객체를 되돌려 주면 된다** — 서버가 더
   * 진행된 프로필을 갖고 있었다면 그 호출이 로컬을 갈아 끼우고, 그러면 방금 심은 아이템이
   * 사라져 아래 존재 확인이 실패한다. 그것이 정확히 우리가 잡으려는 사건이다.
   */
  readonly repullProfile: (profile: Profile) => Promise<ItemPresenceProfileLike | null>;
  /** `mark_commission_grant_applied`. `false` = 표시 실패(다음 부팅이 다시 시도한다). */
  readonly markApplied: (grantId: string) => Promise<boolean>;
}

/** 배송 1회분 결과. 화면에는 쓰지 않고 테스트·로그가 읽는다. */
export interface CommissionGrantDeliveryReport {
  /** 세이브에 새로 심은 아이템 수. */
  readonly delivered: number;
  /** `applied_at` 을 찍은 행 수(이미 들고 있어 심지 않고 찍은 것 포함). */
  readonly marked: number;
  /** 인벤·창고 만석으로 보류한 행 수(표시하지 않았다). */
  readonly held: number;
  /** `uniqueId` 를 해석하지 못해 남겨 둔 행 수(레지스트리 미등록·형식 미확정). */
  readonly unresolved: number;
  /** 클라가 처리하지 않는 행 수(설계도 축 — 서버 트리거가 배송한다). */
  readonly skipped: number;
}

const EMPTY: CommissionGrantDeliveryReport = {
  delivered: 0,
  marked: 0,
  held: 0,
  unresolved: 0,
  skipped: 0,
};

/** 표시 시도 — 예외도 실패로 접는다(이 경로의 예외가 배송 루프를 끊으면 안 된다). */
async function tryMark(
  deps: CommissionGrantDeliveryDeps,
  grantId: string,
): Promise<boolean> {
  try {
    return await deps.markApplied(grantId);
  } catch {
    return false;
  }
}

/** `item_payload.uniqueId` 를 레지스트리 키로 해석한다. 문자열이 아니면 `null`. */
function readUniqueId(itemPayload: unknown): string | null {
  if (typeof itemPayload !== 'object' || itemPayload === null) return null;
  const v = (itemPayload as Record<string, unknown>).uniqueId;
  // ⚠️ 문자열만 받는다. `CommissionRewards.uniqueId` 는 오늘 `number` 로 선언돼 있는데
  //    `Item.uniqueId`/`UNIQUE_REGISTRY` 키는 문자열이라 두 정의가 갈려 있다. 숫자를 비트나
  //    인덱스로 **추측해 해석하면 새 인코딩을 발명하는 것**이므로 하지 않는다 — 해석 불가로
  //    두면 그 행은 표시되지 않고 남아, 형식이 굳는 날 그대로 배송된다.
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * 미배송 발급을 세이브에 반영하고 서버에 배송 완료를 표시한다.
 *
 * 절대 throw 하지 않는다 — 이 경로에서 예외가 나면 그 물건이 영영 안 온다.
 * 오프라인·미설정이면 완전 no-op 이다(빈 리포트).
 */
export async function deliverCommissionGrants(
  profile: Profile,
  deps: CommissionGrantDeliveryDeps,
): Promise<CommissionGrantDeliveryReport> {
  let rows: readonly CommissionGrantRow[] | null;
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
  let skipped = 0;

  for (const row of rows) {
    if (row.appliedAtMs !== null) continue; // 이미 배송됨.
    if (row.kind !== 'unique') {
      // 설계도 축은 서버 트리거가 배송하고 `applied_at` 도 서버가 찍는다(계약 §B-2).
      // 여기 남아 있다는 것은 형식이 아직 안 굳었다는 뜻이므로 건드리지 않는다.
      skipped++;
      continue;
    }
    const uniqueId = readUniqueId(row.itemPayload);
    if (uniqueId === null) {
      unresolved++;
      continue;
    }
    const itemId = commissionGrantItemId(row.grantId);

    // 이미 들고 있으면(표시 직전에 앱이 죽었던 경우) 다시 심지 않고 **표시만** 시도한다.
    if (hasItemId(profile, itemId)) {
      if (await tryMark(deps, row.grantId)) marked++;
      continue;
    }

    const item = itemFromCommissionGrant(row.grantId, uniqueId, COMMISSION_ITEM_SOURCE);
    if (item === null) {
      // 레지스트리 미등록 — **조용히 버리지 않는다.** 표시하지 않고 남기면 카탈로그가
      // 채워지는 날 다음 부팅이 같은 행을 읽어 그때 배송한다.
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

  return { delivered, marked, held, unresolved, skipped };
}
