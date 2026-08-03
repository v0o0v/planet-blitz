/**
 * 코어 모듈 경제 게이트웨이의 실 Supabase 구현 (M7b — modules EF · salvage_core_module RPC).
 *
 * `modules.ts` 의 {@link ModulesGateway} 를 `@supabase/supabase-js` 로 구현한다. SDK 는
 * `supabaseClient.ts` 가 유일하게 정적 import 하고 이 파일은 그것을 경유한다. `modules.ts` 는
 * 설정이 있을 때만 이 모듈을 동적 import 하므로 미설정 번들/테스트에 SDK 가 실리지 않는다.
 * 익명 Auth 세션(ADR-0002) 공유.
 *
 * 구매·합성은 modules Edge Function(service_role 원자 트랜잭션)이 권위다 — 크레딧 차감·보관함
 * 상한·소유/중복 검증은 서버가 강제하고, 클라는 결과만 표시한다. 분해(salvage_core_module)는
 * 롤러 무관이라 SQL RPC 를 직접 호출한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient.js';
import type { SupabaseConfig } from './config.js';
import type {
  ModulesGateway,
  ModuleBuyResult,
  ModuleFuseResult,
  ModuleSalvageResult,
  ModuleOwned,
  ModuleEquipState,
} from './modules.js';
import type { ModuleInstance } from '../../data/coreModules.js';

/** RPC/EF 응답 raw → Record 안전 변환. */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
/** 값이 정의된 경우만 { key: value } 를(exactOptionalPropertyTypes 대응 스프레드). */
function defined<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * modules EF 는 비즈니스 거부(크레딧 부족·만석·중복 등)를 **4xx + `{ok:false, code}` body** 로
 * 돌려준다. supabase-js `functions.invoke` 는 non-2xx 를 error(FunctionsHttpError)로 취급해
 * data=null 을 주므로, FunctionsHttpError 가 실어 주는 Response(`.context`)의 JSON body 를 회수해
 * 결과로 매핑한다. body 를 못 읽으면(진짜 네트워크/릴레이 오류) null → 호출부가 throw.
 */
async function invokeErrorBody(error: unknown): Promise<Record<string, unknown> | null> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      return asRecord(await ctx.clone().json());
    } catch {
      return null;
    }
  }
  return null;
}

export class SupabaseModulesGateway implements ModulesGateway {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = getSupabaseClient(config);
  }

  async getUserId(): Promise<string> {
    const { data: sessionData } = await this.client.auth.getSession();
    const existing = sessionData.session?.user?.id;
    if (existing !== undefined) return existing;
    const { data, error } = await this.client.auth.signInAnonymously();
    if (error !== null) throw error;
    const uid = data.user?.id;
    if (uid === undefined) throw new Error('익명 로그인 후에도 uid 를 얻지 못했습니다');
    return uid;
  }

  async buyShopModule(slotIndex: number): Promise<ModuleBuyResult> {
    // modules EF: dateSeed 는 서버가 UTC 로 계산(클라 신뢰 금지), slotIndex 만 넘긴다.
    const { data, error } = await this.client.functions.invoke('modules', {
      body: { action: 'buy', slotIndex },
    });
    let r: Record<string, unknown>;
    if (error !== null) {
      const body = await invokeErrorBody(error);
      if (body === null) throw error;
      r = body;
    } else {
      r = asRecord(data);
    }
    return {
      ok: r.ok === true,
      ...defined('moduleId', asStr(r.moduleId)),
      ...defined('rarity', asStr(r.rarity)),
      ...defined('credits', asNum(r.credits)),
      ...defined('price', asNum(r.price)),
      ...defined('code', asStr(r.code)),
    };
  }

  async fuseModules(moduleIds: readonly [string, string, string]): Promise<ModuleFuseResult> {
    const { data, error } = await this.client.functions.invoke('modules', {
      body: { action: 'fuse', moduleIds },
    });
    let r: Record<string, unknown>;
    if (error !== null) {
      const body = await invokeErrorBody(error);
      if (body === null) throw error;
      r = body;
    } else {
      r = asRecord(data);
    }
    return {
      ok: r.ok === true,
      promoted: r.promoted === true,
      ...defined('moduleId', asStr(r.moduleId)),
      ...defined('rarity', asStr(r.rarity)),
      ...defined('code', asStr(r.code)),
    };
  }

  async salvageModule(moduleId: string): Promise<ModuleSalvageResult> {
    // 분해는 롤러 무관 → SQL RPC 직접 호출. 반환 { ok, salvaged, credits, rarity } 또는
    // { ok:false, note:'not-owned' }. 환급 후 서버 save.credits 가 진실(호출부가 profileSync pull).
    const { data, error } = await this.client.rpc('salvage_core_module', { p_module_id: moduleId });
    if (error !== null) throw error;
    const r = asRecord(data);
    return {
      ok: r.ok === true,
      ...defined('salvaged', asNum(r.salvaged)),
      ...defined('credits', asNum(r.credits)),
      ...defined('rarity', asStr(r.rarity)),
      ...defined('note', asStr(r.note)),
    };
  }

  async listInventory(): Promise<ModuleOwned[]> {
    // 보관함 직접 조회(RLS core_modules_select_own 이 본인 행만 반환). 최신순 정렬.
    const { data, error } = await this.client
      .from('core_modules')
      .select('id, rarity, charges_left, module')
      .order('created_at', { ascending: false });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    const out: ModuleOwned[] = [];
    for (const raw of rows) {
      const r = asRecord(raw);
      const id = asStr(r.id);
      const rarity = asStr(r.rarity);
      const chargesLeft = asNum(r.charges_left);
      if (id === undefined || rarity === undefined || chargesLeft === undefined) continue;
      out.push({ id, rarity, chargesLeft, module: r.module as ModuleInstance });
    }
    return out;
  }

  async fetchEquip(): Promise<ModuleEquipState> {
    // 내 활성 방어 행(RLS defenses_rw_own). 없으면 defenseId=null(방어 미배치).
    const { data, error } = await this.client
      .from('defenses')
      .select('id, equipped_module_ids')
      .eq('active', true)
      .maybeSingle();
    if (error !== null) throw error;
    const r = asRecord(data);
    const rawIds = Array.isArray(r.equipped_module_ids) ? r.equipped_module_ids : [];
    return {
      defenseId: asStr(r.id) ?? null,
      // 고정 길이 정규화는 modules.ts 의 공개 API 가 담당한다(여기서는 raw 를 그대로 전달).
      equipped: rawIds.map((v) => asStr(v) ?? null),
    };
  }

  async setEquippedModules(defenseId: string, moduleIds: readonly (string | null)[]): Promise<void> {
    // 장착 변경(클라 직접 컬럼 update). guard_defenses_equipped_modules 트리거가 자기 소유 모듈
    // 만·슬롯 수 이내·중복 없음을 강제한다(아니면 raise → 여기서 throw 로 흡수).
    const { error } = await this.client
      .from('defenses')
      .update({ equipped_module_ids: moduleIds })
      .eq('id', defenseId);
    if (error !== null) throw error;
  }

  async listShopPurchases(dateSeed: number): Promise<number[]> {
    // 오늘 이미 구매한 슬롯(RLS module_shop_purchases select-own). 표시 슬롯 비활성용.
    const { data, error } = await this.client
      .from('module_shop_purchases')
      .select('slot_index')
      .eq('date_seed', dateSeed);
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    const out: number[] = [];
    for (const raw of rows) {
      const n = asNum(asRecord(raw).slot_index);
      if (n !== undefined) out.push(n);
    }
    return out;
  }
}
