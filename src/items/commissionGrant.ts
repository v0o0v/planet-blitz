/**
 * 의뢰 확정 지급물(유니크 축) → 실제 {@link Item} 변환기.
 *
 * ## 왜 새로 써야 했나
 * 리포에 `uniqueId` 하나로 **완전한 Item 을 만드는 경로가 없었다.** `rollItem` 은 드랍 시드
 * 에서 슬롯까지 굴리므로 "이 유니크를 정확히 이 슬롯으로 달라"를 표현하지 못하고,
 * `UNIQUE_REGISTRY` 는 정의만 들고 있지 인스턴스를 만들지 않는다. 발급 원장
 * (`commission_grants.item_payload = {"uniqueId": ...}`)이 들고 있는 것은 유니크 id 하나뿐이라
 * 그 사이를 잇는 함수가 필요하다.
 *
 * ## 결정론 (ADR-0005 규율을 이 파일에도 적용한다)
 * `Math.random` · `Date.now` 금지. 어픽스는 **`grant_id` 에서 파생한 시드**로 굴린다 — 그래야
 * 같은 발급 행이 몇 번을 재시도해도 같은 아이템이 되고, 배송이 중간에 끊겼다 이어져도
 * 플레이어가 다른 물건을 받지 않는다. `grant_id` 는 서버가 발급한 uuid 라 클라가 못 고른다.
 *
 * ## 어픽스를 `rollItem` 에 위임하는 이유
 * 어픽스 추첨 규칙(등급별 개수 · 중복 없는 선택 · 값 범위)의 **단일 정본은 `rollItem`** 이다.
 * 여기서 다시 구현하면 규칙이 두 곳에 살고, 한쪽만 갱신되는 날 의뢰 유니크만 조용히 다른
 * 분포를 갖는다. 그래서 `rollItem(seed, 'unique', source)` 를 돌려 **어픽스만 취하고**,
 * 슬롯·weaponType·uniqueId 는 레지스트리 정의로 덮어쓴다(그쪽이 이 축의 정본이다).
 */

import { SeededRng } from '../sim/rng.js';
import { rollItem } from './roll.js';
import { UNIQUE_REGISTRY } from './uniques.js';
import type { Item, ItemSource } from './types.js';
// side-effect: 유니크 정의를 레지스트리에 등록한다. 이 import 가 없으면 레지스트리가 비어
// 모든 발급이 "미등록 유니크"로 떨어져 영영 배송되지 않는다.
import '../../data/uniques.js';

/**
 * 발급 행 → 아이템 인스턴스 id. **결정론 파생**이라 재시도가 같은 id 를 만들고,
 * 그래서 `hasItemId`(src/save/itemPresence.ts)가 중복 배송을 구조적으로 막는다.
 *
 * ⚠️ 네임스페이스 접두사 `commission:` 가 충돌 방지의 전부다. 기존 id 형식과 대조:
 *   · 드랍/정련 = `it-${seed}` (src/items/roll.ts:109) — 접두사가 다르다.
 *   · 약탈품    = `...-loot-...`               — 콜론이 없다.
 * 콜론은 두 형식 어디에도 안 쓰이므로 `commission:` 로 시작하는 id 는 이 경로만 만든다.
 */
export function commissionGrantItemId(grantId: string): string {
  return `commission:${grantId}`;
}

/**
 * `grant_id`(uuid 문자열) → 32비트 시드. FNV-1a. 문자열을 결정론적으로 정수로 접기만 하면
 * 되므로 암호학적 성질은 필요 없다 — 필요한 것은 **같은 입력 → 같은 출력** 하나다.
 */
function seedFromGrantId(grantId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < grantId.length; i++) {
    h ^= grantId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 의뢰 확정 지급물의 `uniqueId` 를 실제 아이템으로 조립한다.
 *
 * **레지스트리에 없는 `uniqueId` 는 `null` 을 돌려준다.** 호출부는 그 행을 `applied_at` 으로
 * 표시하지 **않고 남겨야** 한다 — 카탈로그가 나중에 채워지면 다음 부팅이 같은 행을 다시 읽어
 * 그때 배송한다. 조용히 버리면 서버는 "줬다"고 적혀 있는데 플레이어에게는 영영 안 온다.
 *
 * @param grantId  `commission_grants.grant_id`(uuid). 아이템 id·어픽스 시드의 유일한 입력.
 * @param uniqueId `item_payload.uniqueId` — `UNIQUE_REGISTRY` 의 키.
 * @param source   출처 스탬프(행성·단계·레벨 상한). 의뢰는 행성 개념이 없어 호출부가 정한다.
 */
export function itemFromCommissionGrant(
  grantId: string,
  uniqueId: string,
  source: ItemSource,
): Item | null {
  if (grantId === '' || uniqueId === '') return null;
  const def = UNIQUE_REGISTRY.get(uniqueId);
  if (def === undefined) return null;

  const seed = seedFromGrantId(grantId);
  // 어픽스 정본 위임(위 주석). `slotOverride=def.slot` 으로 어픽스 풀 자체를 레지스트리
  // 슬롯에 맞춘다(ADR-0049 단계 2 ⑤-2b) — 이전에는 굴린 슬롯의 풀로 어픽스를 뽑고 슬롯만
  // 버렸으므로, 예를 들어 core 유니크에 무기 전속 `flaming` 이 붙는 풀 불일치가 있었다.
  const rolled = rollItem(seed, 'unique', source, def.slot);

  // `weaponType` 은 레지스트리 정의가 있으면 그것을 따른다(빔 유니크가 발칸에 붙는 짝 어긋남
  // 방지 — uniques.ts 의 MED-1 규율). 무기타입 무관 유니크(undefined)면서 슬롯이 무기면
  // 굴린 값을 그대로 쓴다.
  //
  // ⚠️ 굴린 아이템의 `weaponType` 을 그대로 쓰면 안 된다 — 그 값은 **굴린 슬롯**에 딸린
  // 것이라 슬롯을 갈아 끼우는 순간 짝이 어긋난다. 별도 시드(황금비 상수 XOR)로 한 번 굴린다.
  // 범위 0..4 는 주무기 5종·보조무기 5종 양쪽에 같다(roll.ts 의 `SUB_WEAPON_VARIANTS` = 5).
  const isWeaponSlot = def.slot === 'main' || def.slot === 'sub';
  const weaponType =
    def.weaponType !== undefined
      ? def.weaponType
      : isWeaponSlot
        ? new SeededRng((seed ^ 0x9e3779b9) >>> 0).int(0, 4)
        : undefined;

  return {
    id: commissionGrantItemId(grantId),
    slot: def.slot,
    rarity: 'unique',
    affixes: rolled.affixes,
    source,
    uniqueId: def.id,
    ...(weaponType !== undefined ? { weaponType } : {}),
  };
}
