/**
 * 스킬 슬롯의 **폭·접근 규약과 7기체 배정표**(ADR-0049 S0 공유 기반).
 *
 * `WorldState.skillCarry` / `WorldState.skillStage` 두 배열의 **유일한 접근 경로**이고,
 * 7기체가 어느 슬롯 번호를 무엇에 쓰는지 한 파일에서 볼 수 있게 모아 두는 자리다.
 * 순수 leaf 다 — 런타임 import 가 0 이라 `world.ts` 와 순환이 구조적으로 생기지 않는다.
 *
 * ## 왜 고정폭 8 인가
 * 기체 7문서의 `구현: B` 전수 집계상 **한 런의 동시 필요분 최대 6칸**이다(런당 기체가 1대라
 * 36칸이 동시에 필요할 수 없다). 폭 8 = 실측 6 + 여유 2.
 *
 * ⚠️ **"넉넉하게 32"는 반대다.** 미배정 슬롯이 영구 0 으로 남으면 오인덱스가 **조용한
 * 무연산**이 된다 — 이 저장소의 지배적 실패 모드다. 그래서 폭을 좁게 두고, 아래 접근자가
 * 범위 밖 인덱스를 **던져서** 알린다(0 을 돌려주면 그 조용한 무연산이 되살아난다).
 *
 * ## 두 배열의 차이 — 섞어 쓰지 마라
 *  - `skillCarry` = **구간을 넘어 사는 상태**(런당 1회 소진 표식 · 누적 저금 · 락온 스택).
 *    의뢰 다구간 런에서 `carryAcrossSegment` 가 **값 복사**로 승계한다(참조 공유 아님 —
 *    그 함수 주석이 근거).
 *  - `skillStage` = **구간마다 새로 시작하는 상태**(창 잔여 틱 · 이번 구간 킬 스냅샷).
 *    승계하지 않는다 = 새 월드의 0 초기값을 그대로 쓴다.
 *
 * ## 값 규약 (`hashWorld` 조건부 폴드의 전제)
 *  1. **0 = "없음"** 이다. `-1` 센티넬을 쓰지 마라 — `(-1) >>> 0 === 4294967295` 라 폴드가
 *     켜져 미투자 런의 해시가 갈린다. 엔티티 id 는 1부터라 0 이 자연 센티넬이다.
 *  2. **비음 정수만.** {@link writeSlot} 이 `Math.trunc` + `max(0, ·)` 를 강제한다. 소수를
 *     넣으면 u32 폴드에서 소수부가 조용히 잘려 클라와 서버 재실행이 갈린다.
 *  3. **모든 쓰기는 투자 게이트 안쪽**이다(`skillLv(...) >= 1`). 게이트 밖에서 쓰면
 *     "전 슬롯 0 이면 무폴드" 가 깨진다.
 *  4. **슬롯 번호는 기체별로 겹친다**(런당 기체 1대라 가능). 그래서 다른 기체 코드가 게이트
 *     없이 쓰면 안 된다 — 쓰기는 항상 앵커의 `switch (state.sigBit)` 안에서만 일어난다.
 */

/**
 * 두 배열의 **고정 폭**. `hashWorld` 가 이 상수 × 2 칸을 고정 폭으로 접으므로, 늘리면
 * 골든이 전량 재생성 대상이 된다 — 늘리기 전에 `replay.ts` 의 스킬 슬롯 폴드 주석을 읽어라.
 */
export const SKILL_SLOT_COUNT = 8;

/** 전 슬롯 0 인 새 배열. `createWorld` 가 두 벌을 각각 이것으로 만든다. */
export function createSkillSlots(): number[] {
  return new Array<number>(SKILL_SLOT_COUNT).fill(0);
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SKILL_SLOT_COUNT) {
    throw new Error(`skill slot out of range: ${slot} (폭 ${SKILL_SLOT_COUNT})`);
  }
}

/**
 * 슬롯 읽기. **범위 밖은 던진다** — 0 을 돌려주면 오인덱스가 조용한 무연산이 되는데, 그것이
 * 폭 8 을 고른 이유 자체다(헤더 참조). 슬롯 번호는 항상 아래 배정표의 `const enum` 리터럴이라
 * 정상 경로에서는 도달하지 않는다.
 */
export function readSlot(slots: readonly number[], slot: number): number {
  assertSlot(slot);
  return slots[slot] ?? 0;
}

/**
 * 슬롯 쓰기 — **`Math.trunc` + `max(0, ·)` 강제**(값 규약 2). 이 함수를 우회해 배열에 직접
 * 대입하지 마라: 소수·음수가 들어가면 u32 폴드에서 조용히 다른 값이 되어 클라와 검증 EF 가
 * 갈린다(`aux0` 소수 적립이 같은 형태로 남긴 경고와 동일).
 */
export function writeSlot(slots: number[], slot: number, value: number): void {
  assertSlot(slot);
  const n = Math.trunc(value);
  slots[slot] = n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// 7기체 슬롯 배정표 — **각 배선 레인이 자기 블록만 채운다**
// ---------------------------------------------------------------------------
//
// ## 채우는 규약
// 레인은 아래 자기 기체 자리에 `const enum` 두 벌(`{Ship}Carry` · `{Ship}Stage`)을 선언하고,
// 슬롯 번호가 **자기 블록 안에서 유일한지**만 보장하면 된다(기체 간 중복은 정상 — 런당
// 기체 1대). 형태:
//
//     /** 스트라이커 이월 슬롯. */
//     export const enum StrikerCarry {
//       lethalSpent = 0,   // FO5 치명 생존 무효화 소진 표식(런당 1회)
//     }
//     /** 스트라이커 구간 슬롯. */
//     export const enum StrikerStage {
//       wallWindow = 0,    // S4 벽 접촉 창 잔여 틱
//     }
//
// ⚠️ **`Carry` 와 `Stage` 를 한 enum 에 섞지 마라.** 두 배열은 승계 규칙이 정반대라, 섞으면
// "구간을 넘어 살아야 하는 표식"이 구간마다 리셋되는(또는 그 반대의) 결함이 **화면에도
// 테스트에도 흔적을 안 남기고** 들어온다.
//
// ⚠️ **여기 없는 번호를 `world.ts`/`skills/{ship}.ts` 에 리터럴로 적지 마라.** 이 파일이
// 중복·누락을 한눈에 보이게 하려고 존재한다.
//
// S0 시점에는 **전 기체 미배정**이다 — 그래서 전 슬롯이 런 끝까지 0 이고 `hashWorld` 의
// 스킬 슬롯 폴드가 한 번도 실행되지 않는다(기존 골든 바이트 불변).
//
//   스트라이커 (SIG_STRIKER_MARKSMAN) — 미배정
//   브루저     (SIG_BRUISER_ARMOR)    — 미배정
//   아크캐스터 (SIG_ARC_OVERCHARGE)   — 미배정
//   팬텀       (SIG_PHANTOM_CLOAK)    — 미배정
//   해츨링     (SIG_HATCHLING_BROOD)  — 미배정
//   말로우     (SIG_MALLOW_CUSHION)   — 미배정
//   버블       (SIG_BUBBLE_FILM)      — 미배정
