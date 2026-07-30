/**
 * 액티브 스킬 발동 **엔진**(ADR-0041 · 계획 0a-10/0b-2).
 *
 * 효과 함수는 여기 없다 — `src/sim/activeHandlers/<ship>.ts` 7개 파일이 소유하고 이 모듈은
 * 그것을 합쳐 틱을 돌린다. 그 분리가 두 가지를 동시에 준다:
 *  1. **배선 전수 테스트가 항진이 되지 않는다** — 레지스트리(`data/ships/actives/`)와 핸들러가
 *     물리적으로 다른 파일이라 "한쪽만 채운 상태"가 실제로 존재 가능하다(계획 PM-1).
 *  2. **레인이 파일 단위로 배타** — 기체별 핸들러 파일이 서로를 import 하지 않는다.
 *
 * ## 계층 규율
 * `world.ts` 를 **타입으로만** import 한다(런타임 import 금지 — world.ts 가 이 모듈을 런타임
 * import 하므로 순환이 된다).
 *
 * ## 작성자 분리 (0c 계약)
 * **공통 발동 코드는 쿨다운 2개만 세운다. 버프 잔여 틱 2개는 핸들러가 세운다.** 공통 코드가
 * 버프 틱까지 세우면 `buffTicks` 관측량 단언이 핸들러 본문과 무관하게 참이 되어 배선 전수
 * 테스트 ②가 항진이 된다(계획 개정 3 CR-1 과 같은 기제). 매 틱 **감소**는 공통 코드가 한다 —
 * 감소는 0 에서 양수로 올리지 못하므로 항진이 아니다.
 */

import type { WorldState, InputFrame } from './world.js';
import type { Entity } from './entities.js';
import { SPECIAL_ACTIVE_SLOT1, SPECIAL_ACTIVE_SLOT2 } from '../../data/inputBits.js';
import { activeByWireId, activeCooldownTicks, investedInTree } from '../../data/ships/actives/index.js';
import type { ActiveSkillId } from '../../data/ships/actives/index.js';
import type { ActiveSkillDef } from '../../data/ships/actives/types.js';
import { ACTIVE_SLOT_COUNT } from '../../data/ships/actives/types.js';
import type {
  ActiveExpire,
  ActiveHandler,
  ActiveSustain,
} from './activeTypes.js';
import { STRIKER_HANDLERS, STRIKER_SUSTAIN, STRIKER_EXPIRE } from './activeHandlers/striker.js';
import { BRUISER_HANDLERS, BRUISER_SUSTAIN, BRUISER_EXPIRE } from './activeHandlers/bruiser.js';
import { ARCCASTER_HANDLERS, ARCCASTER_SUSTAIN, ARCCASTER_EXPIRE } from './activeHandlers/arccaster.js';
import { PHANTOM_HANDLERS, PHANTOM_SUSTAIN, PHANTOM_EXPIRE } from './activeHandlers/phantom.js';
import { HATCHLING_HANDLERS, HATCHLING_SUSTAIN, HATCHLING_EXPIRE } from './activeHandlers/hatchling.js';
import { MALLOW_HANDLERS, MALLOW_SUSTAIN, MALLOW_EXPIRE } from './activeHandlers/mallow.js';
import { BUBBLE_HANDLERS, BUBBLE_SUSTAIN, BUBBLE_EXPIRE } from './activeHandlers/bubble.js';

export type { ActiveHandler, ActiveSustain, ActiveExpire } from './activeTypes.js';

/**
 * id → 발동 효과. **레지스트리 42종 전수**여야 한다.
 *
 * ⚠️ 여기 없는 id 는 레지스트리에 있어도 발동 시 **쿨다운만 돌고 아무 일도 안 난다** —
 * 이 저장소가 8번 겪은 "조용한 배선 누락"의 정확한 형태다. 그래서 존재 대조 테스트(①)와
 * 관측량 델타 테스트(②)가 둘 다 걸려 있고, 뮤테이션 M-①·M-①b 가 그 둘을 압박한다.
 */
const HANDLERS = {
  ...STRIKER_HANDLERS,
  ...BRUISER_HANDLERS,
  ...ARCCASTER_HANDLERS,
  ...PHANTOM_HANDLERS,
  ...HATCHLING_HANDLERS,
  ...MALLOW_HANDLERS,
  ...BUBBLE_HANDLERS,
} satisfies Record<string, ActiveHandler>;

/**
 * 런타임 조회용 뷰. 런타임 존재 대조 테스트(배선 전수 ①)가 이 표를 문자열 키로 훑는다.
 *
 * ⚠️ 기체별 테이블이 `Record<string, ActiveHandler>` 라 `satisfies Record<ActiveSkillId, ...>`
 * 로 **컴파일 타임 전수**를 잡지는 못한다(스프레드가 키 리터럴을 잃는다). 그래서
 * `assertHandlerCoverage` 가 그 축을 대신 지키고, 배선 전수 ①이 런타임에서 다시 확인한다 —
 * vitest 는 esbuild transpile-only 라 타입만 믿으면 "런타임 대조가 실제로 도는지"가
 * 증명되지 않는다(뮤테이션 M-① 기록 형식이 tsc·vitest 둘 다를 요구하는 이유).
 */
export const ACTIVE_HANDLERS: Readonly<Record<string, ActiveHandler>> = HANDLERS;

/** 지속 중 매 틱 유지 훅(선택). */
export const ACTIVE_SUSTAIN: Readonly<Record<string, ActiveSustain>> = {
  ...STRIKER_SUSTAIN,
  ...BRUISER_SUSTAIN,
  ...ARCCASTER_SUSTAIN,
  ...PHANTOM_SUSTAIN,
  ...HATCHLING_SUSTAIN,
  ...MALLOW_SUSTAIN,
  ...BUBBLE_SUSTAIN,
};

/** 만료 틱 훅(선택). */
export const ACTIVE_EXPIRE: Readonly<Record<string, ActiveExpire>> = {
  ...STRIKER_EXPIRE,
  ...BRUISER_EXPIRE,
  ...ARCCASTER_EXPIRE,
  ...PHANTOM_EXPIRE,
  ...HATCHLING_EXPIRE,
  ...MALLOW_EXPIRE,
  ...BUBBLE_EXPIRE,
};

/**
 * 타입 축의 전수 검사 — 이 함수가 **컴파일되는 것 자체**가 "42종 id 전부에 핸들러 자리가
 * 있다"는 증명이다. 런타임에는 호출되지 않는다(테스트가 실물 표를 직접 훑는다).
 */
export function assertHandlerCoverage(table: Record<ActiveSkillId, ActiveHandler>): void {
  void table;
}

// ---------------------------------------------------------------------------
// 틱 진행
// ---------------------------------------------------------------------------

/** 슬롯 인덱스 → 쿨다운 필드 읽기. */
function cooldownOf(state: WorldState, slot: number): number {
  return slot === 0 ? state.activeCd0 : state.activeCd1;
}

/** 슬롯 인덱스 → 쿨다운 필드 쓰기(공통 발동 코드 전용). */
function setCooldown(state: WorldState, slot: number, ticks: number): void {
  if (slot === 0) state.activeCd0 = ticks;
  else state.activeCd1 = ticks;
}

/** 슬롯 인덱스 → 버프 잔여 틱 읽기. */
function buffTicksOf(state: WorldState, slot: number): number {
  return slot === 0 ? state.activeBuff0 : state.activeBuff1;
}

/** 슬롯 인덱스 → 버프 잔여 틱 **감소 전용** 쓰기(세우는 것은 핸들러 몫). */
function decayBuff(state: WorldState, slot: number, ticks: number): void {
  if (slot === 0) state.activeBuff0 = ticks;
  else state.activeBuff1 = ticks;
}

/** 슬롯에 장착된 정의(미장착·미지 wire·타입 불일치면 undefined). */
function defForSlot(state: WorldState, slot: number): ActiveSkillDef | undefined {
  const wire = state.config.activeSlots?.[slot] ?? -1;
  const def = activeByWireId(wire);
  if (def === undefined) return undefined;
  // 기체 타입 고유(ADR-0041) — 손상 세이브가 다른 기체의 스킬을 실어도 발동하지 않는다.
  return def.shipTypeId === (state.config.shipType ?? 0) ? def : undefined;
}

/**
 * 한 틱의 액티브 처리 — **쿨다운·버프 감소 → 지속/만료 훅 → 발동 판정 → 핸들러 호출**.
 *
 * 호출 지점은 `stepWorld` 의 `stepPlayer(...)` **직후**다. `pendingLevelUp` 프리즈와 detour
 * 분기가 그보다 **위에서 조기 return** 하므로, 프리즈 중 z/x 는 큐잉되지 않고 **구조적으로
 * 버려진다**(AC-8·AC-9). 발동 호출을 그 위로 옮기지 마라.
 *
 * 미장착 런(`config.activeSlots` 부재)에서는 쿨다운·버프 정수가 끝까지 0 이라 `hashWorld`
 * 꼬리 폴드가 한 번도 실행되지 않는다 → 골든 바이트 불변.
 */
export function stepActives(
  state: WorldState,
  player: Entity,
  input: InputFrame,
  dir: { x: number; y: number },
): void {
  // 쿨다운 감소(공통 코드 소유).
  if (state.activeCd0 > 0) state.activeCd0--;
  if (state.activeCd1 > 0) state.activeCd1--;

  for (let slot = 0; slot < ACTIVE_SLOT_COUNT; slot++) {
    // 버프 잔여 틱 **감소**만 공통 코드가 한다(세우는 것은 핸들러 몫 — 위 작성자 분리 참조).
    const before = buffTicksOf(state, slot);
    if (before > 0) decayBuff(state, slot, before - 1);
    const after = buffTicksOf(state, slot);
    const def = defForSlot(state, slot);
    if (def !== undefined) {
      if (after > 0) ACTIVE_SUSTAIN[def.id]?.(state, player, def);
      else if (before > 0) ACTIVE_EXPIRE[def.id]?.(state, player, def);
    }
  }

  if (state.config.activeSlots === undefined) return;

  const invest = state.config.skillInvest ?? [];
  for (let slot = 0; slot < ACTIVE_SLOT_COUNT; slot++) {
    const bit = slot === 0 ? SPECIAL_ACTIVE_SLOT1 : SPECIAL_ACTIVE_SLOT2;
    if ((input.special & bit) === 0) continue;
    // 쿨다운 중 재입력은 **무시**한다(큐잉 금지 — AC-2).
    if (cooldownOf(state, slot) > 0) continue;
    const def = defForSlot(state, slot);
    if (def === undefined) continue;
    ACTIVE_HANDLERS[def.id]?.(state, player, def, dir, slot);
    setCooldown(state, slot, activeCooldownTicks(def, investedInTree(invest, def)));
  }
}
