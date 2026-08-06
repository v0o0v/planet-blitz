/**
 * 촉매 슬롯의 **폭·접근 규약**(ADR-0052 재구축 공유 기반).
 *
 * `WorldState.catalystSlots` 한 벌의 **유일한 접근 경로**다. 순수 leaf 라 런타임 import 가
 * 0 이고 `world.ts` 와 순환이 구조적으로 생기지 않는다({@link file://./skillSlots.ts} 와 같은 사유).
 *
 * ## 왜 스킬 슬롯에 얹지 않고 **별도 1벌**인가
 * 스킬이 폭 8 중 실측 6칸을 예약했다. 촉매의 동시 필요분이 최대 6칸(3장 × 카드당 최대 2칸,
 * 2칸을 요구하는 카드는 셋뿐)이라 얹으면 12 > 8 이고, 폭을 16으로 늘리는 것은 `skillSlots.ts`
 * §"왜 고정폭 8 인가" 가 명시적으로 반대한 방향이다(미배정 슬롯의 오인덱스가 **조용한
 * 무연산**이 된다 — 이 저장소의 지배적 실패 모드).
 *
 * ## 왜 `Carry`/`Stage` 2벌이 아니라 **1벌**인가
 * 스킬이 두 벌로 갈린 근거는 **의뢰 다구간**이다(구간을 넘어 사는 상태 vs 구간마다 새로 시작
 * 하는 상태). 촉매에는 그 축이 없다 — ADR-0052 헌장이 *"침공·의뢰 런에는 촉매가 들어가지
 * 않는다"* 고 못 박았으므로 촉매가 실린 런에 구간 전환이 존재하지 않는다.
 *
 * 그래서 이 배열은 {@link WORLD_FRESH} 로 등재한다. 그것이 정직할 뿐 아니라, `skillCarry` 가
 * 밟고 있는 최대 함정 — `WORLD_CARRY` 의 `copyKeys` **참조 대입**이라 두 구간이 같은 배열
 * 객체를 공유하고 `_WorldExhaustive` 의 `keyof` 가 그것을 못 잡는 문제 — 을 **원천적으로
 * 안 밟는다.**
 *
 * ## 값 규약 (`hashWorld` 조건부 폴드의 전제 — `skillSlots.ts` 와 동일)
 *  1. **0 = "없음"**. `-1` 센티넬 금지(`(-1) >>> 0 === 4294967295` 라 폴드가 켜져 무촉매 런의
 *     해시가 갈린다).
 *  2. **비음 정수만.** {@link writeCatalystSlot} 이 `Math.trunc` + `max(0, ·)` 를 강제한다.
 *  3. **모든 쓰기는 촉매 게이트 안쪽**이다(`state.catalystOn` + 카드 소지 판정). 게이트 밖에서
 *     쓰면 "전 슬롯 0 이면 무폴드" 가 깨진다.
 *  4. **슬롯 번호는 카드별로 겹칠 수 있다** — 런당 3장이라 48장이 동시에 필요할 수 없다.
 *     그래서 다른 카드 코드가 게이트 없이 쓰면 안 된다.
 *
 * ⚠️ **접근자를 `skillSlots.ts` 것과 공유하지 마라.** 그쪽 `assertSlot` 은 폭 8 을 검사하므로
 * 6칸 배열에 슬롯 6·7 을 쓰면 **범위 검사를 통과해 배열이 조용히 늘어난다** — 그 순간 고정폭
 * 폴드가 깨진다. 폭이 다르면 접근자도 달라야 한다.
 */

/**
 * 촉매 슬롯 배열의 **고정 폭**. `hashWorld` 가 이 상수만큼 고정 폭으로 접으므로, 늘리면
 * 골든이 전량 재생성 대상이 된다 — 늘리기 전에 `replay.ts` 의 촉매 슬롯 폴드 주석을 읽어라.
 *
 * 6 = 3장 × 카드당 최대 2칸. 2칸을 요구하는 카드가 셋뿐이라 실사용은 이보다 작다.
 */
export const CATALYST_SLOT_COUNT = 6;

/** 전 슬롯 0 인 새 배열. `createWorld` 가 이것으로 한 벌 만든다. */
export function createCatalystSlots(): number[] {
  return new Array<number>(CATALYST_SLOT_COUNT).fill(0);
}

function assertCatalystSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= CATALYST_SLOT_COUNT) {
    throw new Error(`catalyst slot out of range: ${slot} (폭 ${CATALYST_SLOT_COUNT})`);
  }
}

/**
 * 슬롯 읽기. **범위 밖은 던진다** — 0 을 돌려주면 오인덱스가 조용한 무연산이 되는데, 그것이
 * 폭을 좁게 고른 이유 자체다(헤더 참조).
 */
export function readCatalystSlot(slots: readonly number[], slot: number): number {
  assertCatalystSlot(slot);
  return slots[slot] ?? 0;
}

/**
 * 슬롯 쓰기 — **`Math.trunc` + `max(0, ·)` 강제**(값 규약 2). 이 함수를 우회해 배열에 직접
 * 대입하지 마라: 소수·음수가 들어가면 u32 폴드에서 조용히 다른 값이 되어 클라와 검증 EF 가
 * 갈린다.
 */
export function writeCatalystSlot(slots: number[], slot: number, value: number): void {
  assertCatalystSlot(slot);
  const n = Math.trunc(value);
  slots[slot] = n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// 카드별 슬롯 배정표 — **촉매 배선 레인이 채운다**
// ---------------------------------------------------------------------------
//
// ## 채우는 규약
// 슬롯을 요구하는 카드마다 `const enum` 한 벌을 선언하고, 슬롯 번호가 **동시에 뽑힐 수 있는
// 카드들 사이에서 유일한지**를 보장한다. 스킬 쪽과 달리 "런당 1대" 같은 배타 보장이 없다 —
// 3장이 임의 조합으로 뜨므로, **48종 전역에서 정적으로 유일한 배분표**가 필요하다.
//
// ⚠️ 슬롯 인덱스를 "장착 슬롯 번호(0/1/2)"에서 **동적으로** 배분하지 마라. 같은 카드가 다른
// 슬롯에 꽂힌 두 런이 다른 해시를 내고, 리플레이 재실행이 갈린다.
//
// S0 시점에는 **전 카드 미배정**이다 — 그래서 전 슬롯이 런 끝까지 0 이고 `hashWorld` 의
// 촉매 슬롯 폴드가 한 번도 실행되지 않는다(기존 골든 바이트 불변).
