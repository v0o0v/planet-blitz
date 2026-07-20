/**
 * modules Edge Function 검증·계획 코어 (M7b 코어 모듈 경제 — 구매·합성).
 *
 * 구 `supabase/functions/cards/cardsCore.ts` 계승. verifyInvasionCore 와 동일 규율:
 * **플랫폼 전역 무참조 순수 모듈**이라 Node(vitest)·Deno(EF) 어디서나 동일하게 돈다. 여기엔
 * 결정론 모듈 롤러(data/coreModules.ts)를 그대로 실행하는 순수 "계획" 함수만 둔다 — 상점 슬롯
 * 재현·가격 책정·합성 입력 검증. HTTP·Auth·DB I/O(크레딧 차감·소유 검증·상한 강제·원자 적용
 * RPC 호출)는 index.ts 가 맡는다.
 *
 * ## 구 cards 코어와의 차이
 *   - `planDefenseDrop`/`DropRollInput`/`DropPlan` **삭제**. 방어 성공 코어 모듈 드랍은 폐지됐고
 *     (ADR-0018: 방어 실적은 방어체 획득 경로가 아니다), 보상은 크레딧 정액
 *     (`DEFENSE_SUCCESS_CREDITS`)뿐이라 SQL(apply_invasion_result)이 직접 지급한다 — EF 계획 불요.
 *   - 롤러가 `src/items/rollCard.ts` 가 아니라 `data/coreModules.ts` 안에 있다(데이터+순수 결정론
 *     함수 한 모듈 — data/lineage.ts·economy.ts 와 같은 결).
 */

import type { Rarity } from '../../../src/items/types.js';
import {
  rollModuleShopRotation,
  attemptModuleFusion,
  moduleBuyPrice,
  MODULE_FUSION_INPUT_COUNT,
} from '../../../data/coreModules.js';
import type { ModuleInstance } from '../../../data/coreModules.js';

// ---------------------------------------------------------------------------
// 상점 구매 계획
// ---------------------------------------------------------------------------

/** 구매 계획: 확정 모듈 + 등급 + 크레딧 가격(롤러·가격 함수가 순수 확정). */
export interface ModuleShopPurchasePlan {
  readonly rarity: Rarity;
  readonly module: ModuleInstance;
  readonly price: number;
}

export type ModuleShopPurchaseResult =
  | { readonly ok: true; readonly plan: ModuleShopPurchasePlan }
  | { readonly ok: false; readonly code: 'bad-slot' };

/**
 * (dateSeed, userSeed, slotIndex) → 상점 슬롯 모듈 재현 + 가격. slotIndex 는 로테이션 재고 길이
 * 내 정수여야 한다(범위 밖·비정수 = bad-slot). 서버가 클라 입력 dateSeed 를 신뢰하지 않고 자체
 * UTC 날짜로 계산한 값을 넘긴다(index.ts).
 */
export function planModuleShopPurchase(
  dateSeed: number,
  userSeed: number,
  slotIndex: number,
): ModuleShopPurchaseResult {
  const rotation = rollModuleShopRotation(dateSeed, userSeed);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= rotation.length) {
    return { ok: false, code: 'bad-slot' };
  }
  const mod = rotation[slotIndex];
  if (mod === undefined) return { ok: false, code: 'bad-slot' };
  return { ok: true, plan: { rarity: mod.rarity, module: mod, price: moduleBuyPrice(mod.rarity) } };
}

// ---------------------------------------------------------------------------
// 합성 입력 검증 + 결과 계획
// ---------------------------------------------------------------------------

export type ModuleFusionValidation =
  | { readonly ok: true; readonly rarity: Rarity }
  | { readonly ok: false; readonly code: 'need-three' | 'dup-ids' | 'rarity-mismatch' };

/**
 * 합성 입력(정확히 3개, 동급, 중복 id 없음) 검증. 소유·잔존 검증은 원자 RPC
 * (apply_module_fusion)가 행 잠금으로 재확인하므로, 이 순수 검증은 롤러 입력(공통 등급) 확정과
 * 형식 게이트를 담당한다.
 */
export function validateModuleFusion(
  modules: ReadonlyArray<{ readonly id: string; readonly rarity: Rarity }>,
): ModuleFusionValidation {
  if (modules.length !== MODULE_FUSION_INPUT_COUNT) return { ok: false, code: 'need-three' };
  const ids = new Set(modules.map((m) => m.id));
  if (ids.size !== MODULE_FUSION_INPUT_COUNT) return { ok: false, code: 'dup-ids' };
  const rarity = modules[0]?.rarity;
  if (rarity === undefined) return { ok: false, code: 'need-three' };
  if (!modules.every((m) => m.rarity === rarity)) return { ok: false, code: 'rarity-mismatch' };
  return { ok: true, rarity };
}

/** 합성 결과 계획(승급 여부 + 결과 모듈). seed 는 EF 가 발급(비결정론 OK — 결과가 자기 시드로 재현). */
export interface ModuleFusionPlan {
  readonly promoted: boolean;
  readonly rarity: Rarity;
  readonly module: ModuleInstance;
}

export function planModuleFusion(inputRarity: Rarity, seed: number): ModuleFusionPlan {
  const res = attemptModuleFusion(seed, inputRarity);
  return { promoted: res.promoted, rarity: res.module.rarity, module: res.module };
}
