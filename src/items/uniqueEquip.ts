/**
 * 같은 유니크 중복 장착 차단 술어 — 순수·결정론 (ADR-0039, 2026-07-28).
 *
 * ## 무엇이 문제였나
 * `computeLoadoutStats`(`loadout.ts`)는 장착 아이템들의 유니크 효과를 `uniqueMask` 에 **OR 로
 * 합친다**. 같은 `uniqueId` 를 두 칸에 꽂으면 **같은 비트를 두 번 세우는 것**이라 두 번째 사본의
 * 유니크 효과는 통째로 무효가 되고 그 칸이 낭비된다(어픽스는 합산되므로 "아무 일도 안 일어난다"가
 * 아니라 **유니크 효과만 조용히 사라진다** — 그래서 눈치채기 어렵다).
 *
 * 재현 가능한 슬롯은 저작된 유니크가 2종 이상인 슬롯이고(현행 main 6 · sub 2 · armor 2 ·
 * module 2), 그중 `module` 은 장착 칸이 2개(module0/module1)라 가장 쉽게 재현된다.
 *
 * ## 왜 "차단"인가 (대안 검토)
 * 중첩을 **허용**하고 두 번째 사본에 대체 효과를 주는 설계도 가능하다. 그러나 그러려면 저작
 * 유니크 15종 **각각에** 중첩 규칙을 정의해야 하고(효과가 전부 sim 의 비트 분기라 규칙마다
 * `src/sim/**` 수정 + 골든 재생성 + `verify-invasion` EF 재배포가 따라붙는다), 얻는 것은
 * "같은 유니크 두 개"라는 드문 상황의 표현력뿐이다. 비용/편익이 맞지 않으므로 **장착 게이트에서
 * 차단**한다. `uniqueMask` 의 의미(비트 OR)는 그대로 두므로 sim·해시·세이브 스키마는 불변이다.
 *
 * ## 결정론 경계
 * `requiredLevel.ts` 와 같은 규율 — `src/sim/**` 의 값을 import 하지 않는다(타입만). 아이템과
 * 장착 표에서만 답을 내는 순수 함수라 클라·서버 어디서 불러도 같은 결과다.
 *
 * 관련: 표준 장비 조립기(`src/bench/standardBuild.ts` 의 `rollForSlot`)는 배정된 유니크 id 집합을
 * 넘겨 같은 결함을 **자체 회피**해 왔다. 이 모듈은 그 회피를 **실제 게임의 장착 경로**로 끌어온
 * 것이다(조립기 쪽 로직은 그대로 둔다 — 그쪽은 "굴린 후보를 버리고 다시 굴린다"라 성격이 다르다).
 */

import type { EquipSlotId, Item } from './types.js';
import { EQUIP_SLOTS } from './types.js';

/** 장착 표(슬롯 → 아이템). `Ship.equipped` 와 같은 모양이며 읽기만 한다. */
export type EquippedMap = Readonly<Partial<Record<EquipSlotId, Item>>>;

/**
 * `item` 을 `targetSlot` 에 넣으면 **이미 장착 중인 같은 유니크와 겹치는지** 본다. 겹치면 그
 * 상대 슬롯 id 를, 아니면 null 을 돌려준다(유니크가 아닌 아이템은 항상 null).
 *
 * ⚠️ `targetSlot` 은 판정에서 **제외**한다 — 그 칸의 기존 아이템은 이 장착으로 밀려나기 때문이다.
 * 모듈 2칸이 모두 찼을 때 격납고는 `module0` 을 교체 대상으로 고르는데, 만약 그 칸에 같은 유니크가
 * 있었다면 교체 결과는 중복이 아니다(하나만 남는다). 대상 칸을 제외하지 않으면 이 정상적인
 * "같은 유니크로 갈아끼우기"까지 막혀 버린다.
 */
export function duplicateUniqueSlot(
  equipped: EquippedMap,
  item: Item,
  targetSlot: EquipSlotId,
): EquipSlotId | null {
  const uid = item.uniqueId;
  if (uid === undefined) return null;
  for (const id of EQUIP_SLOTS) {
    if (id === targetSlot) continue;
    if (equipped[id]?.uniqueId === uid) return id;
  }
  return null;
}

/**
 * 장착 목록에서 **효과가 무효인 사본**의 인덱스 집합(같은 `uniqueId` 의 두 번째 이후 등장).
 *
 * 게이트가 생기기 **전에 저장된 세이브**에는 이미 중복 장착 상태가 남아 있을 수 있다. 로드 시
 * 자동 해제하지 않는 이유는 아래 {@link duplicateUniqueSlot} 정책 주석 참조 — 대신 이 함수로
 * 격납고 스탯 표가 그 사본을 "중복 — 효과 없음"으로 **표시**해, 사용자가 스스로 갈아끼울 수 있게 한다.
 *
 * 순서 기준은 호출자가 넘긴 배열 그대로다. 격납고·`computeLoadoutStats` 모두 `EQUIP_SLOTS` 순으로
 * 훑으므로 "먼저 오는 칸이 유효한 사본"이라는 판정이 화면과 sim 에서 일치한다(OR 는 순서 무관이라
 * 어느 쪽을 유효로 부르든 실제 마스크는 같다 — 표시 일관성을 위한 규약이다).
 */
export function redundantUniqueIndices(items: readonly Item[]): ReadonlySet<number> {
  const seen = new Set<string>();
  const out = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const uid = items[i]?.uniqueId;
    if (uid === undefined) continue;
    if (seen.has(uid)) out.add(i);
    else seen.add(uid);
  }
  return out;
}

/**
 * ## 기존 세이브의 중복 장착을 어떻게 다루는가 — **유지**(자동 해제 안 함)
 *
 * 로드 시 두 번째 사본을 자동 해제하지 않는다. 근거 셋:
 *  ① **데이터 유실 위험.** 해제는 아이템을 인벤토리로 되돌리는 조작인데 인벤토리는 용량 상한
 *     (`INVENTORY_CAP`)이 있다. 가득 찬 상태에서 로드하면 갈 곳이 없어 **아이템을 버리거나**
 *     상한을 넘겨야 한다 — 사용자가 지시하지 않은 파괴적 변경이다.
 *  ② **손해가 없다.** 중복 사본도 어픽스는 정상 합산된다. 무효인 것은 유니크 효과뿐이라, 그대로
 *     둔다고 해서 게이트 도입 전보다 나빠지지 않는다(현상 유지).
 *  ③ **되돌릴 방법이 있다.** 게이트는 새 장착만 막고 **해제는 막지 않으므로**, 사용자는 언제든
 *     스스로 빼고 다른 것을 끼울 수 있다. 그러라고 격납고 스탯 표가
 *     {@link redundantUniqueIndices} 로 "중복 — 효과 없음"을 명시한다(무음이면 버그로 신고된다).
 *
 * 즉 정책은 "**막되 빼앗지 않는다**" 이다. 세이브 스키마·마이그레이션은 불변이다.
 */
export const LEGACY_DUPLICATE_POLICY = 'keep' as const;
