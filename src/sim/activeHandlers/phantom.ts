/**
 * phantom 액티브 스킬 6종의 **효과 함수**(ADR-0041).
 *
 * 레지스트리(`data/ships/actives/phantom.ts`)와 **물리적으로 분리된 두 번째 테이블**이다 —
 * 한 파일 한 키로 합치면 배선 전수 테스트가 구조적 항진이 된다(계획 PM-1).
 *
 * `aux0/aux1` 인코딩 표는 `src/sim/world.ts:1721-1731` 이 정본이다. 어기면 시그니처
 * 런타임 상태가 **조용히** 손상된다.
 *
 * 작성자 분리(0c 계약): **버프 잔여 틱은 핸들러가 세운다**(`setBuffTicks`). 공통 발동 코드는
 * 쿨다운만 세우고 버프는 감소만 한다 — 공통 코드가 세우면 관측량 단언이 항진이 된다.
 */

import type { ActiveExpireTable, ActiveHandlerTable, ActiveSustainTable } from '../activeTypes.js';

/** 발동 효과. */
export const PHANTOM_HANDLERS: ActiveHandlerTable = {};

/** `kind='buff'` 지속 중 매 틱 유지 훅(선택). */
export const PHANTOM_SUSTAIN: ActiveSustainTable = {};

/** `kind='buff'` 만료 틱 훅(선택). */
export const PHANTOM_EXPIRE: ActiveExpireTable = {};
