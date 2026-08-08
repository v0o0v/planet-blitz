/**
 * 촉매 **연출·귀속 채널**(ADR-0052 · 헌장 §가시성 규율 · §귀속 규율).
 *
 * ## 왜 이 파일이 있는가 — 채널이 **아예 없었다**
 * 정찰 실측: sim 이 렌더에 사건을 내보내는 통로가 `WorldSnapshot` 하나뿐이고 그것은 **상태의
 * 사진**이지 사건 스트림이 아니다. 렌더는 프레임 델타 관측(`render/soundScape.ts`)으로만 사건을
 * 알았고, 그래서 "촉매 한 장이 방금 발동했다"를 화면이 알 방법이 원리적으로 없었다.
 * 헌장이 가시성·귀속을 **채택의 전제조건**으로 못 박았으므로 이것은 연출 편의가 아니라 선결이다.
 *
 * ## ⭐ 이 채널은 **sim 계약 밖**이다 — 네 가지 제약
 *  1. **`hashWorld` 에 접히지 않는다.** 순수 연출이라 접으면 "무슨 색으로 번쩍였나"가 결정론
 *     계약에 들어간다. `replay.ts` 의 폴드 목록에 절대 추가하지 마라
 *     (`tests/catalystFx.test.ts` §해시 불변 절이 기계로 잠근다).
 *  2. **매 틱 비운다.** 사건 스트림이라 누적하면 메모리와 스냅샷이 같이 폭주한다.
 *     비우는 자리는 `stepWorld` 의 첫머리 하나뿐이다({@link clearCatalystFx}).
 *  3. **무촉매 런은 채널 자체가 없다.** `catalystOn` 이 거짓이면 필드가 `undefined` 로 남아
 *     배열 할당조차 없다 — `catalystSettlementOf` 가 `undefined` 를 돌려주는 선례와 같은 형태다.
 *  4. **상한이 있다.** 한 틱에 {@link CATALYST_FX_MAX} 를 넘으면 조용히 버린다. 카드 레인이
 *     매 틱 통지를 거는 실수를 해도 스냅샷이 폭주하지 않는다.
 *
 * ## ⚠️ RNG 를 쓰지 마라
 * 이 모듈의 어느 함수도 난수를 소비하지 않는다. 통지가 시드 스트림을 밀면 "연출을 켰더니 런이
 * 달라졌다"가 되어 위 ①의 취지가 통째로 무너진다.
 */

import type { WorldState } from '../world.js';

// ---------------------------------------------------------------------------
// 사건 종류
// ---------------------------------------------------------------------------

/**
 * 통지 종류. **숫자 코드**인 이유는 스냅샷에 실려 렌더까지 가기 때문이다 — 문자열이면 틱마다
 * 문자열 비교가 돌고, 무엇보다 렌더가 `switch` 로 색을 가르는 자리에서 오타가 조용히 통과한다.
 *
 *  - `trigger` — 카드가 **발동**했다. HUD 슬롯 번쩍임의 기본 통지이고, 이것만 정산 발동 횟수를
 *    올린다(아래 {@link notifyCatalystFx} 참조).
 *  - `selfHarm` — 촉매가 **플레이어를 다치게 했다**. 헌장 §귀속 규율 3 이 요구하는 "적 피해와
 *    다른 색·다른 사운드"의 축이다. 렌더가 이 값으로 색을 가른다.
 *  - `credit` — 조건을 만족해 **벌었다**(금빛 숫자 축).
 *  - `miss` — 조건 미달로 **놓쳤다**. 헌장이 "놓친 액수가 보여야 다음 판에 조건을 추구한다"고
 *    적은 그 축이라, 놓침도 화면에 나갈 수 있어야 한다.
 */
export const CATALYST_FX = {
  trigger: 0,
  selfHarm: 1,
  credit: 2,
  miss: 3,
} as const;

/** {@link CATALYST_FX} 의 값 하나. */
export type CatalystFxKind = (typeof CATALYST_FX)[keyof typeof CATALYST_FX];

/** 한 틱에 쌓을 수 있는 통지 수의 상한. 넘으면 조용히 버린다(위 §제약 4). */
export const CATALYST_FX_MAX = 64;

/** 촉매 연출 통지 하나. **원시값만** — 엔티티 참조를 실으면 렌더가 sim 객체를 붙잡는다. */
export interface CatalystFxEvent {
  /** 발동한 촉매 id(`src/data/catalysts.ts` 정본). HUD 슬롯 번쩍임이 이 값으로 칸을 찾는다. */
  id: number;
  /** {@link CATALYST_FX} 중 하나. */
  kind: number;
  /** 월드 좌표 x(이펙트 자리). 자리가 없는 통지는 플레이어 좌표를 넘겨라. */
  x: number;
  /** 월드 좌표 y. */
  y: number;
}

// ---------------------------------------------------------------------------
// 통지 (카드 레인이 한 줄로 부른다)
// ---------------------------------------------------------------------------

/**
 * 촉매 하나가 화면에 나타날 사건을 냈음을 알린다. **카드 레인이 쓰는 단 하나의 통지 API** 다.
 *
 * ```ts
 * notifyCatalystFx(state, CARD_PLUNDER, CATALYST_FX.trigger, player.x, player.y);
 * ```
 *
 * `kind === CATALYST_FX.trigger` 일 때만 정산 명세의 **발동 횟수**가 오른다 — `credit`/`miss` 는
 * {@link creditCatalyst}/{@link missCatalyst} 가 액수와 함께 세는 축이라, 여기서도 세면 한 사건이
 * 두 번 잡힌다.
 *
 * ⚠️ 무촉매 런에서는 불릴 일이 없지만(전 앵커가 `catalystOn` 게이트 안쪽이다) 방어적으로
 * 게이트를 한 번 더 둔다 — 이 함수가 필드를 만드는 유일한 자리라, 여기가 새면 §제약 3 이 깨진다.
 */
export function notifyCatalystFx(
  state: WorldState,
  catalystId: number,
  kind: CatalystFxKind,
  x: number,
  y: number,
): void {
  if (!state.catalystOn) return;
  if (kind === CATALYST_FX.trigger) bumpLedger(state, catalystId, 1, 0, 0);
  const buf = state.catalystFx;
  if (buf === undefined) {
    state.catalystFx = [{ id: catalystId, kind, x, y }];
    return;
  }
  if (buf.length >= CATALYST_FX_MAX) return;
  buf.push({ id: catalystId, kind, x, y });
}

/**
 * 이번 틱의 통지를 전부 버린다. **`stepWorld` 의 첫머리에서만** 부른다(§제약 2).
 *
 * 배열 객체는 재사용하고 길이만 0 으로 되돌린다 — 매 틱 새 배열을 만들면 촉매 런의 GC 압력이
 * 틱레이트에 비례해 붙는다. 무촉매 런은 필드가 `undefined` 라 이 함수가 첫 줄에서 끝난다.
 */
export function clearCatalystFx(state: WorldState): void {
  const buf = state.catalystFx;
  if (buf === undefined) return;
  buf.length = 0;
}

/**
 * 이번 틱의 통지 목록. **무촉매 런과 사건이 없는 틱은 `undefined`** 다(스냅샷에 빈 배열을
 * 실으면 렌더가 매 프레임 빈 순회를 돌고, optional 필드의 "부재 = 기본"이 흐려진다).
 *
 * ⚠️ 돌려주는 것은 **내부 버퍼 참조**다. 렌더로 나가는 경계(`snapshotWorld`)가 복사를 지고,
 * sim 안의 소비자는 읽기만 한다.
 */
export function catalystFxOf(state: WorldState): readonly CatalystFxEvent[] | undefined {
  const buf = state.catalystFx;
  if (buf === undefined || buf.length === 0) return undefined;
  return buf;
}

// ---------------------------------------------------------------------------
// 귀속 원장 — 정산 촉매별 기여 명세 (헌장 §귀속 규율 2)
// ---------------------------------------------------------------------------

/**
 * 촉매 한 장의 런 기여. **원시값만** — 정산은 sim 타입을 모른다
 * (`catalystHooks.ts` 의 {@link import('../catalystHooks.js').catalystSettlementOf} §S0 증명 ①).
 */
export interface CatalystContribution {
  /** 촉매 id. */
  id: number;
  /** 발동 횟수(= `CATALYST_FX.trigger` 통지 수). */
  fired: number;
  /** 조건을 만족해 **번** 액수의 합. */
  earned: number;
  /** 조건 미달로 **놓친** 액수의 합. 헌장이 요구하는 세 번째 칸이다. */
  missed: number;
}

/**
 * `state.catalystLedger` 의 한 칸을 찾거나 만든다. 런당 촉매는 **3장**이라 선형 탐색으로 충분하고,
 * 그래서 id 색인 배열(48칸)을 만들지 않는다.
 */
function bumpLedger(
  state: WorldState,
  id: number,
  fired: number,
  earned: number,
  missed: number,
): void {
  let led = state.catalystLedger;
  if (led === undefined) {
    led = [];
    state.catalystLedger = led;
  }
  for (const row of led) {
    if (row.id !== id) continue;
    row.fired += fired;
    row.earned += earned;
    row.missed += missed;
    return;
  }
  led.push({ id, fired, earned, missed });
}

/**
 * 촉매 `id` 가 **번** 액수를 적립한다(정산 명세용 — 실제 자원 가산은 호출부가 따로 한다).
 *
 * ```ts
 * creditCatalyst(state, CARD_GREED, 120);
 * ```
 *
 * ⚠️ **이 함수는 자원을 주지 않는다.** 귀속 장부일 뿐이다 — 여기에 적었다고 `state.resources`
 * 가 오르지 않는다. 두 곳을 같이 부르는 것이 카드 레인의 몫이고, 그래야 "화면에 보인 액수"와
 * "실제로 받은 액수"가 갈리는지 정산에서 바로 읽힌다.
 */
export function creditCatalyst(state: WorldState, id: number, earned: number): void {
  if (!state.catalystOn || earned === 0) return;
  bumpLedger(state, id, 0, earned, 0);
}

/**
 * 촉매 `id` 가 **조건 미달로 놓친** 액수를 적는다. 헌장: *"조건부 카드는 놓친 액수가 보여야
 * 다음 판에 조건을 추구한다."*
 *
 * ```ts
 * missCatalyst(state, CARD_GREED, 120);   // 조건을 못 채워 못 받은 몫
 * ```
 */
export function missCatalyst(state: WorldState, id: number, missed: number): void {
  if (!state.catalystOn || missed === 0) return;
  bumpLedger(state, id, 0, 0, missed);
}

/**
 * 런 결과에 실을 **촉매별 기여 명세**. `catalystSettlementOf` 와 **같은 세 줄의 계약**을 진다:
 *
 *  1. **원시값만** — `id`/`fired`/`earned`/`missed` 넷 다 수다. `src/save/settlement.ts` 는
 *     이 타입을 import 하지 않고 구조를 그 자리에 적는다(그래야 §S0 증명 ①이 그대로 선다).
 *  2. **복사본이다** — 행까지 새로 만든다. 얕은 복사로 내보내면 정산이 `row.earned` 를 만져
 *     sim 상태의 두 번째 작성자가 된다.
 *  3. **무촉매는 채널 자체가 없다** — `undefined` 라 `RunResult` 에 필드가 안 실린다.
 *
 * 정렬은 **id 오름차순**이다. 적립 순서(= 발동 순서)로 두면 같은 런의 정산 화면이 플레이 순서에
 * 따라 줄이 바뀐다.
 */
export function catalystContributionsOf(
  state: WorldState,
): readonly CatalystContribution[] | undefined {
  if (!state.catalystOn) return undefined;
  const led = state.catalystLedger;
  if (led === undefined || led.length === 0) return undefined;
  return led
    .map((r) => ({ id: r.id, fired: r.fired, earned: r.earned, missed: r.missed }))
    .sort((a, b) => a.id - b.id);
}
