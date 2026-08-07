/**
 * 촉매 **공명 12**(태그 6종 × 약/강) — 본체가 들어갈 자리.
 *
 * ## 왜 여기만 `CARD_*` id 가 없는가
 * 공명은 카드가 아니다 — 실린 3장의 **태그 집계 결과**라 id 가 없고, 정본
 * (`src/data/catalystResonance.ts`)이 `태그:단` 키로 관리한다(`RESONANCES`). 그래서 이 모듈은
 * id 상수 대신 **슬러그 상수**를 둔다. 한 런에 발동하는 공명은 **하나**(강공명 우선)다.
 *
 * ## 왜 파일을 따로 가르는가
 * 그룹 모듈과 같은 사유다 — 병렬 레인의 머지 충돌을 막는다. 공명은 12종이 서로 배타라
 * 한 레인이 통째로 소유해도 충돌이 없다.
 *
 * ⚠️ `world.js` 는 **type-only** import 만(순환 금지).
 * ⚠️ 공명 분기는 카드 소지(`carries`)가 아니라 **발동 공명 판정**을 게이트로 쓴다 —
 * `activeResonance` 계열이 정본이고 그 결과를 여기서 다시 계산하지 마라(두 곳이 갈린다).
 */

import type { WorldState } from '../world.js';
import type { Entity } from '../entities.js';

/** 점화 약 — slug `ember`. */
export const RESO_EMBER = 'ember';
/** 점화 강 — slug `reverberation`. */
export const RESO_REVERBERATION = 'reverberation';
/** 밀도 약 — slug `attraction`. */
export const RESO_ATTRACTION = 'attraction';
/** 밀도 강 — slug `crossfire`. */
export const RESO_CROSSFIRE = 'crossfire';
/** 정밀 약 — slug `whetting`. */
export const RESO_WHETTING = 'whetting';
/** 정밀 강 — slug `deflection`. */
export const RESO_DEFLECTION = 'deflection';
/** 수확 약 — slug `snare`. */
export const RESO_SNARE = 'snare';
/** 수확 강 — slug `fruition`. */
export const RESO_FRUITION = 'fruition';
/** 도박 약 — slug `advance`. */
export const RESO_ADVANCE = 'advance';
/** 도박 강 — slug `settlement`. */
export const RESO_SETTLEMENT = 'settlement';
/** 침식 약 — slug `abrasion`. */
export const RESO_ABRASION = 'abrasion';
/** 침식 강 — slug `subsidence`. */
export const RESO_SUBSIDENCE = 'subsidence';

/**
 * 매 틱 진입점 — `catalystHooks.ts` 의 `onTickCatalyst` 가 **그룹 12개 다음, 마지막으로** 부른다.
 *
 * 순서가 계약인 이유: 공명은 카드들의 **집계 결과**라 카드 효과가 이번 틱에 만든 상태 위에
 * 얹히는 것이 자연스럽다. 앞으로 당기면 같은 런이 다른 값을 낸다.
 *
 * ⚠️ **지금은 비어 있다 — 누락이 아니라 미배선이다.**
 */
export function resonanceOnTick(state: WorldState, player: Entity): void {
  void state;
  void player;
}
