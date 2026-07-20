/**
 * 코어 모듈 경제 네트워크 계층 (M7b — 구매·합성·분해 + 상점 로테이션 표시 + 슬롯 장착).
 *
 * 구 `src/net/cards.ts`(M6 방어 카드) 계승. 규율(기존 net 계층 invasion.ts/config.ts 동일):
 *  - Supabase 미설정(env 부재) 시 **완전 no-op** → 공개 함수는 `null` 을 돌려주고 SDK 를 로드하지
 *    않는다(테스트/오프라인 유지).
 *  - 공개 함수는 절대 throw 하지 않는다(오프라인/오류는 삼키고 `null`).
 *  - 실제 SDK 는 설정이 있을 때만 `modulesGateway.js` 를 동적 import 한다.
 *
 * 서버 권위: 구매·합성은 `modules` Edge Function(service_role 원자 트랜잭션)이 크레딧·보관함
 * 상한·소유/중복을 강제한다. 분해는 `salvage_core_module` RPC. 구매/분해 후 save.credits 는
 * 서버가 진실이므로 호출부가 profileSync 로 pull 해야 한다.
 *
 * 장착: 코어 모듈은 L3 코어의 강화 슬롯 {@link MODULE_EQUIP_SLOTS}(2)개에 꽂는다. 슬롯 배열은
 * **고정 길이 + null 허용**이며 밀집화하지 않는다(슬롯 i ↔ 표시 i 대응 유지 — 3레이어 슬롯
 * 규약과 동일). 장착 자체는 클라 권한이고(자기 소유 모듈 한정, DB 트리거가 검증), 사용 횟수
 * 차감은 서버 확정 경로만 한다(ADR-0012).
 */

import { readSupabaseConfig, type SupabaseConfig } from './config.js';
import {
  shopDateSeedFromMs,
  shopUserSeed,
  rollModuleShopRotation,
  MODULE_EQUIP_SLOTS,
} from '../../data/coreModules.js';
import type { ModuleInstance } from '../../data/coreModules.js';

// ---------------------------------------------------------------------------
// 결과 계약 타입 (UI 표시용)
// ---------------------------------------------------------------------------

/** 구매 결과. ok=false 면 code 로 사유(bad-slot·storage-full·insufficient-credits·already-bought 등). */
export interface ModuleBuyResult {
  ok: boolean;
  moduleId?: string;
  rarity?: string;
  /** 차감 후 서버 잔여 크레딧(성공 시). */
  credits?: number;
  /** 지불 가격(성공 시). */
  price?: number;
  code?: string;
}

/** 합성 결과. promoted=상위 등급 승급 여부. ok=false 면 code(need-three·not-owned·rarity-mismatch 등). */
export interface ModuleFuseResult {
  ok: boolean;
  moduleId?: string;
  rarity?: string;
  promoted?: boolean;
  code?: string;
}

/** 분해 결과. ok=false 면 note='not-owned'. 성공 시 salvaged(환급액)·credits(환급 후 잔여). */
export interface ModuleSalvageResult {
  ok: boolean;
  salvaged?: number;
  credits?: number;
  rarity?: string;
  note?: string;
}

/**
 * 보관함 소유 모듈 1건(core_modules 행). `id` 는 **행 uuid**(장착·분해·합성에 넘기는 참조)로,
 * ModuleInstance.id(시드 파생 표시 id)와 다르다. 서버가 rarity·chargesLeft 를 정규 컬럼으로
 * 두므로 그 값을 신뢰하고(module jsonb 와 일치), module 은 모듈 어픽스 요약·표시에 쓴다.
 */
export interface ModuleOwned {
  /** core_modules.id — 장착/분해/합성 참조용 행 uuid. */
  id: string;
  rarity: string;
  chargesLeft: number;
  /** 직렬화된 ModuleInstance(모듈 어픽스·유니크 표시용). */
  module: ModuleInstance;
}

/** 내 방어의 코어 모듈 장착 상태(슬롯 표시·장착 변경에 필요). */
export interface ModuleEquipState {
  /** 활성 방어 행 id(없으면 null — 방어 미배치). 장착 변경 update 대상. */
  defenseId: string | null;
  /**
   * 슬롯별 장착 모듈의 core_modules.id. **고정 길이 {@link MODULE_EQUIP_SLOTS}**, 빈 슬롯은 null.
   * 밀집화 금지 — 슬롯 인덱스가 곧 표시 위치다.
   */
  equipped: (string | null)[];
}

/** 게이트웨이 인터페이스(테스트에서 fake 주입). 실 구현은 modulesGateway.ts. */
export interface ModulesGateway {
  getUserId(): Promise<string>;
  buyShopModule(slotIndex: number): Promise<ModuleBuyResult>;
  fuseModules(moduleIds: readonly [string, string, string]): Promise<ModuleFuseResult>;
  salvageModule(moduleId: string): Promise<ModuleSalvageResult>;
  /** 보관함 조회(core_modules, RLS 본인). 실패 시 throw. */
  listInventory(): Promise<ModuleOwned[]>;
  /** 내 활성 방어의 장착 상태(defenses, RLS 본인). 실패 시 throw. */
  fetchEquip(): Promise<ModuleEquipState>;
  /** 장착 변경(defenses.equipped_module_ids update — 소유권 트리거 검증). 실패 시 throw. */
  setEquippedModules(defenseId: string, moduleIds: readonly (string | null)[]): Promise<void>;
  /** 오늘(dateSeed) 이미 구매한 상점 슬롯 인덱스 목록(module_shop_purchases, RLS 본인). */
  listShopPurchases(dateSeed: number): Promise<number[]>;
}

/** 주입 가능한 의존성(테스트에서 gateway/config 대체). */
export interface ModulesDeps {
  gateway?: ModulesGateway;
  config?: SupabaseConfig | null;
}

// ---------------------------------------------------------------------------
// 게이트웨이 해석 (invasion.ts resolveGateway 와 동일 규율)
// ---------------------------------------------------------------------------

let cachedGateway: ModulesGateway | null = null;
let cachedConfigKey: string | null = null;

async function resolveGateway(deps: ModulesDeps): Promise<ModulesGateway | null> {
  if (deps.gateway !== undefined) return deps.gateway;
  const config = deps.config !== undefined ? deps.config : readSupabaseConfig();
  if (config === null) return null;
  const key = config.url;
  if (cachedGateway !== null && cachedConfigKey === key) return cachedGateway;
  const { SupabaseModulesGateway } = await import('./modulesGateway.js');
  cachedGateway = new SupabaseModulesGateway(config);
  cachedConfigKey = key;
  return cachedGateway;
}

// ---------------------------------------------------------------------------
// 슬롯 정규화 (고정 길이 + null 허용, 밀집화 금지)
// ---------------------------------------------------------------------------

/**
 * 장착 슬롯 배열을 **고정 길이 {@link MODULE_EQUIP_SLOTS}** 로 정규화한다. 초과분은 절단하고
 * 부족분은 null 로 채운다. 밀집화(빈 슬롯 제거)는 하지 않는다 — 슬롯 i 의 의미가 바뀌기 때문.
 * 같은 모듈이 두 슬롯에 들어가면 뒤 슬롯을 비운다(중복 장착 금지, 서버 트리거와 같은 규칙).
 */
export function normalizeEquippedModules(raw: readonly (string | null | undefined)[] | null | undefined): (string | null)[] {
  const out: (string | null)[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < MODULE_EQUIP_SLOTS; i++) {
    const v = raw?.[i];
    if (typeof v !== 'string' || v.length === 0 || seen.has(v)) {
      out.push(null);
      continue;
    }
    seen.add(v);
    out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// T0 권위 스냅샷 파싱 (begin_invasion 의 authority.modules)
// ---------------------------------------------------------------------------

/**
 * `begin_invasion` 의 `modules` jsonb → sim 이 그대로 소비하는 {@link CoreModuleConfig}(src/sim/moduleEffects.ts).
 *
 * 구현 본체는 **`src/sim/moduleEffects.ts` 하나**다 — EF(Deno)가 net 계층을 import 하지 않고도
 * 같은 파서를 쓰게 하기 위해서다(파서가 두 벌이면 클라·서버 재실행이 조용히 갈린다).
 * 여기서는 net 계층 사용처를 위해 재수출만 한다.
 */
export { parseModulesAuthority } from '../sim/moduleEffects.js';

// ---------------------------------------------------------------------------
// 상점 로테이션 표시(순수 — 서버 호출 불요, EF 와 동일 시드로 재현)
// ---------------------------------------------------------------------------

/** (dateSeed, userSeed) 계산. nowMs 미지정 시 현재 시각(UTC 날짜 시드). */
export function computeShopSeeds(uid: string, nowMs: number = Date.now()): { dateSeed: number; userSeed: number } {
  return { dateSeed: shopDateSeedFromMs(nowMs), userSeed: shopUserSeed(uid) };
}

/**
 * 오늘의 상점 재고를 클라에서 재현한다(서버 호출 없음). 반환 배열 인덱스가 buyShopModule 의
 * slotIndex. EF 가 동일 (dateSeed,userSeed,slotIndex)로 모듈을 재현·검증하므로 표시=구매 대상 일치.
 */
export function rollCurrentModuleShop(uid: string, nowMs: number = Date.now()): ModuleInstance[] {
  const { dateSeed, userSeed } = computeShopSeeds(uid, nowMs);
  return rollModuleShopRotation(dateSeed, userSeed);
}

// ---------------------------------------------------------------------------
// 공개 API (no-op 가드 · 절대 throw 안 함)
// ---------------------------------------------------------------------------

/** 로그인 uid(상점 로테이션 재현·보관함 조회에 필요). 미설정/오프라인/오류면 `null`. */
export async function getModulesUserId(deps: ModulesDeps = {}): Promise<string | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.getUserId();
  } catch {
    return null;
  }
}

/**
 * 상점 슬롯 구매. 미설정/오프라인/오류면 `null`. ok=false 는 서버 비즈니스 거부(잔액 부족·만석·
 * 중복 구매 등 — code 로 구분). 성공 후 save.credits 는 서버가 진실이라 호출부가 profileSync pull.
 */
export async function buyShopModule(slotIndex: number, deps: ModulesDeps = {}): Promise<ModuleBuyResult | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.buyShopModule(slotIndex);
  } catch {
    return null;
  }
}

/**
 * 동급 3개 합성. 미설정/오프라인/오류면 `null`. ok=false 는 서버 거부(미소유·등급 불일치 등).
 * 성공 시 3개 소모·결과 1개 생성이 서버 원자 반영되므로 호출부가 보관함을 재조회한다.
 */
export async function fuseModules(
  moduleIds: readonly [string, string, string],
  deps: ModulesDeps = {},
): Promise<ModuleFuseResult | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.fuseModules(moduleIds);
  } catch {
    return null;
  }
}

/**
 * 모듈 분해 환급. 미설정/오프라인/오류면 `null`. ok=false(note='not-owned')는 서버 거부. 성공 후
 * save.credits 는 서버가 진실이라 호출부가 profileSync pull.
 */
export async function salvageModule(moduleId: string, deps: ModulesDeps = {}): Promise<ModuleSalvageResult | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.salvageModule(moduleId);
  } catch {
    return null;
  }
}

/**
 * 보관함(core_modules) 조회. 미설정/오프라인/오류면 `null`(UI 는 오프라인 안내). 서버 RLS 로
 * 본인 모듈만 반환된다. 반환 순서는 서버 정렬(최신순).
 */
export async function listModuleInventory(deps: ModulesDeps = {}): Promise<ModuleOwned[] | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.listInventory();
  } catch {
    return null;
  }
}

/** 내 활성 방어의 코어 모듈 장착 상태 조회. 미설정/오프라인/오류면 `null`. */
export async function fetchModuleEquip(deps: ModulesDeps = {}): Promise<ModuleEquipState | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    const state = await gateway.fetchEquip();
    return { defenseId: state.defenseId, equipped: normalizeEquippedModules(state.equipped) };
  } catch {
    return null;
  }
}

/**
 * 코어 모듈 장착/해제(defenses.equipped_module_ids update). 슬롯 배열은 고정 길이로 정규화해
 * 보낸다(null = 해제). 자기 소유 모듈만 서버 트리거가 허용한다. 성공하면 true, 미설정/오프라인/
 * 거부/오류면 false. 서버 권위 — 성공 후 호출부가 장착 상태를 재조회한다.
 */
export async function equipModules(
  defenseId: string,
  moduleIds: readonly (string | null)[],
  deps: ModulesDeps = {},
): Promise<boolean> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return false;
  try {
    await gateway.setEquippedModules(defenseId, normalizeEquippedModules(moduleIds));
    return true;
  } catch {
    return false;
  }
}

/**
 * 오늘(dateSeed) 이미 구매한 상점 슬롯 인덱스 목록. 미설정/오프라인/오류면 `null`. 표시 상점의
 * 해당 슬롯 버튼을 비활성(이미 구매)하는 데 쓴다. dateSeed 미지정 시 현재 UTC 날짜 시드.
 */
export async function listModuleShopPurchases(
  dateSeed: number = shopDateSeedFromMs(Date.now()),
  deps: ModulesDeps = {},
): Promise<number[] | null> {
  const gateway = await resolveGateway(deps);
  if (gateway === null) return null;
  try {
    return await gateway.listShopPurchases(dateSeed);
  } catch {
    return null;
  }
}
