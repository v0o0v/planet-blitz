/**
 * 적 `aux0` 의 **촉매 비트 구역** — 인코딩 표와 접근자(ADR-0052 선결 ①).
 *
 * 촉매 규칙 여덟이 적 하나에 표식을 남겨야 하는데 적 엔티티에는 남는 칸이 없다. 그래서
 * `encounters/light.ts:32-44` 의 비트 패킹 선례를 따라 **`aux0` 한 칸을 비트로 나눠 쓴다.**
 *
 * ## ⚠️ `aux1` 은 절대 건드리지 마라
 * `MID_CLASH_LEADER_MARK`(`modes/midClash.ts:58,118`)가 **매 런 확정으로** 점유하고,
 * 세그먼트 전진 게이트가 **오직 그 마커로만** 판정한다(`midClash.ts:92`, `blockBreak.ts:228`).
 * 촉매가 덮으면 **중반 격전이 공짜로 통과된다.** `SEALED_GUARDIAN_MARK`(조우,
 * `encounters/light.ts:228`)도 같은 칸이다.
 *
 * ## ⚠️ 대상은 **`kind === 'enemy'` 뿐이다**
 * `aux0` 는 kind 마다 뜻이 다르다 — 플레이어는 장갑·클로크 임계(`world.ts:2515·2570`)와
 * 커션(`:2642`)이, **보스는 추격 모드 취약화 플래그**(`world.ts:370`)가 쓴다. 잡몹에만 찍어라.
 * 보스에 찍으면 니플헤임 포식자가 무적에서 풀리거나 반대로 영영 안 풀린다.
 *
 * ## 결정론
 * `aux0` 는 `hashEntity` 가 접는 칸이다 — 그래서 **모든 쓰기는 촉매 게이트 안쪽**이어야 한다
 * (`state.catalystOn` + 카드 소지 판정). 게이트 밖에서 한 비트라도 찍으면 무촉매 런의 골든이
 * 갈린다. 읽기는 게이트가 필요 없다(무촉매 런은 전 비트가 0 이라 판정이 자동으로 거짓이다).
 *
 * ## 비트 예산 — 23 / 32
 * ```
 *  비트  폭  소유 카드                          뜻
 *   0    1  id 1  plunder                     강탈 가능(아직 안 뜯긴 엘리트·보스)
 *   1-2  2  id 6  gilding                     도금 단계 0..3
 *   3    1  id 20 resonance(동조)             동조 중(같은 종류 셋이 모임)
 *   4    1  id 36 niflheim-pursuit            그림자다(죽일 수 없음·조준 제외·적 수 제외)
 *   5    1  id 29 ascendant                   이동 불능(대시 무적 중 통과당함)
 *   6    1  점화 약공명(불씨)                  밀려남(1초간 받는 피해 감소)
 *   7-14 8  id 17 greed                       금빛 액수(적이 진 자원, 8비트 눈금)
 *  15-22 8  id 15 extraction                  실린 액수(보급 습격 자원, 8비트 눈금)
 * ```
 * 남은 상위 9비트(23..31)는 **비워 둔다** — 배선 레인이 새 카드에 쓸 자리다. 쓸 때 이 표를
 * 함께 갱신해라. 표와 코드가 갈리면 두 카드가 같은 비트를 조용히 덮는다.
 *
 * ⚠️ **액수 두 칸은 8비트 눈금이지 원값이 아니다**(0..255). sim 은 아이템·자원의 실제 값을
 * 모른다(`spawnLoot` 은 시드·등급코드만 싣고, 값은 `save/settlement.ts` 에만 있다) — 그러니
 * 여기 실리는 것은 **눈금**이고 환산은 정산 계층이 한다.
 */

import type { Entity } from './entities.js';

/** 촉매 비트 구역의 폭(하위 23비트). 상위 9비트는 예약. */
export const CATALYST_MARK_BITS = 23;

/** 촉매 비트 구역 전체 마스크. */
export const CATALYST_MARK_MASK = (1 << CATALYST_MARK_BITS) - 1;

/** 비트 위치·폭 표. **이 객체가 유일 정본이다** — 리터럴 시프트를 코드에 흩지 마라. */
export const CATALYST_MARK = {
  /** `id 1 plunder` — 강탈 가능. */
  plunder: { shift: 0, width: 1 },
  /** `id 6 gilding` — 도금 단계 0..3. */
  gilding: { shift: 1, width: 2 },
  /** `id 20 resonance`(동조) — 동조 중. */
  attuned: { shift: 3, width: 1 },
  /** `id 36 niflheim-pursuit` — 그림자. */
  shadow: { shift: 4, width: 1 },
  /** `id 29 ascendant` — 이동 불능. */
  rooted: { shift: 5, width: 1 },
  /** 점화 약공명(불씨) — 밀려나 피해 감소 중. */
  emberPushed: { shift: 6, width: 1 },
  /** `id 17 greed` — 금빛 액수(눈금 0..255). */
  greedAmount: { shift: 7, width: 8 },
  /** `id 15 extraction` — 실린 액수(눈금 0..255). */
  extractionAmount: { shift: 15, width: 8 },
} as const;

export type CatalystMarkField = keyof typeof CATALYST_MARK;

/** 그 필드의 값을 읽는다. 무촉매 런은 전 비트가 0 이라 전부 0 을 돌려준다. */
export function readMark(e: Entity, field: CatalystMarkField): number {
  const { shift, width } = CATALYST_MARK[field];
  return (e.aux0 >>> shift) & ((1 << width) - 1);
}

/**
 * 그 필드에 값을 쓴다(폭을 넘는 값은 **절삭**한다 — 이웃 비트를 침범하지 않는다).
 *
 * ⚠️ **반드시 촉매 게이트 안쪽에서만 불러라**(헤더 §결정론). 그리고 **잡몹에만** 써라 —
 * 보스·플레이어의 `aux0` 는 다른 뜻이다.
 */
export function writeMark(e: Entity, field: CatalystMarkField, value: number): void {
  const { shift, width } = CATALYST_MARK[field];
  const max = (1 << width) - 1;
  const v = Math.trunc(value);
  const clamped = v < 0 ? 0 : v > max ? max : v;
  e.aux0 = ((e.aux0 & ~(max << shift)) | (clamped << shift)) >>> 0;
}

/** 촉매 비트 구역만 0 으로 되돌린다(상위 예약 비트와 다른 kind 의 용도를 보존). */
export function clearMarks(e: Entity): void {
  e.aux0 = (e.aux0 & ~CATALYST_MARK_MASK) >>> 0;
}

/** 렌더로 보낼 촉매 비트 구역 값(`EntitySnapshot.catalystMark`). */
export function markSnapshotValue(e: Entity): number {
  return (e.aux0 & CATALYST_MARK_MASK) >>> 0;
}
