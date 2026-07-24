/**
 * 서버 게이트웨이(M4 Phase B3) — 프로필 이관에 필요한 서버 IO 를 추상화.
 *
 * `ServerGateway` 인터페이스로 오케스트레이션(`index.ts`)과 실제 Supabase 호출을
 * 분리한다. 덕분에 이관 로직은 fake gateway 로 네트워크·`@supabase/supabase-js`
 * 없이 vitest 검증되고(계획 §3), 이 파일만 실제 SDK 를 import 한다.
 *
 * 익명 Auth(ADR-0002·계획 B3): 최초 호출 시 세션이 없으면 `signInAnonymously()` 로
 * 익명 유저를 만든다. Supabase 프로젝트에서 Anonymous sign-ins 활성화가 전제
 * (supabase/README.md 적용 절차 2단계).
 *
 * 재화 서버 권위(ADR-0027/0026): `profiles.credits`/`minerals`(numeric 컬럼)가 재화 정본이고
 * `save` jsonb 의 재화는 표시 미러다. `fetchProfile` 이 컬럼을 함께 읽어 미러 초기값으로 쓰고,
 * 재화 변동은 아래 RPC 3종(`settle_pve_run`·`grant_currency`·`spend_currency`)으로만 서버에
 * 반영한다(guard 트리거가 클라 컬럼 write 를 봉인 — 위조 불가).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from '../save/profile.js';
import type { ServerProfile } from './profileSync.js';
import type { SupabaseConfig } from './config.js';

/** PvE 정산 요약(settle_pve_run 인자 p_summary). resources→credits, minerals→minerals 로 지급. */
export interface PveSettleSummary {
  victory: boolean;
  planet: number;
  stage: number;
  /** 생존 틱(개연성 캡 산정에 쓰이니 실측값). */
  finalTick: number;
  /** 런 자원(→credits 지급 주장액; 서버 3중 캡이 클램프). */
  resources: number;
  /** 런 광물(→minerals 지급 주장액). */
  minerals: number;
  kills: number;
  /**
   * 촉매 소모 영수증 런 id(ADR-0029, Lane 3). `consume_catalysts` 성공 시 발급된 uuid 를
   * 실으면 서버 `settle_pve_run` 이 이 id 로 pending 영수증(자원 배율)을 조회해 캡을 상향한다.
   * **무촉매/오프라인 런은 미지정** — 그러면 서버가 기존 무배율 base 경로로 정산한다(위조 방지:
   * 클라가 실은 resourceMult 는 서버가 무시하고 자기 영수증만 신뢰). exactOptionalPropertyTypes
   * 규율상 값이 있을 때만 스탬프한다(undefined 대입 금지).
   */
  runId?: string;
}

/** `consume_catalysts` 반환 — 발급된 런 id 와 서버 확정 자원 배율. */
export interface CatalystConsumeResult {
  /** pending pve_runs 행 id(uuid). settle 이 이 값으로 영수증을 관통 조회한다. */
  run_id: string;
  /** 서버 영수증 자원 배율([1, CAP_RESOURCE_MULT_MAX] 클램프). 표시용(정본은 서버 pending 행). */
  resource_mult: number;
}

/** `grant_catalyst` / 드랍 적립 반환 — 적립 후 그 촉매의 보유 수량. */
export interface CatalystGrantResult {
  catalyst_id: number;
  qty_after: number;
}

/** `salvage_catalyst` 반환 — 분해 성공 여부 + 갱신 재화 잔액(ok=false 면 미차감). */
export interface CatalystSalvageResult {
  ok: boolean;
  /** 실제 분해된 수량(ok=false 면 0). */
  salvaged: number;
  credits_left: number;
  minerals_left: number;
}

/** `catalyst_inventory` 한 행(본인 보유 원장). */
export interface CatalystInventoryRow {
  catalyst_id: number;
  qty: number;
}

/** `grant_currency` / `settle_pve_run` 이 반환하는 갱신 잔액 계약(jsonb). */
export interface CurrencyGrantResult {
  granted_credits: number;
  granted_minerals: number;
  credits_left: number;
  minerals_left: number;
  clamped: boolean;
}

/** `settle_pve_run` 반환 = grant 결과 + settled 플래그. */
export interface SettlePveResult extends CurrencyGrantResult {
  settled: boolean;
}

/** `spend_currency` 반환. ok=false 면 잔액 부족(미차감). */
export interface SpendCurrencyResult {
  ok: boolean;
  credits_left: number;
  minerals_left: number;
}

/** 프로필 이관 오케스트레이션이 의존하는 서버 IO(테스트에서 fake 로 주입). */
export interface ServerGateway {
  /** 익명 세션을 보장하고 로그인 uid 를 반환한다. 실패 시 throw. */
  getUserId(): Promise<string>;
  /** uid 의 profiles 행을 읽는다. 없으면 null. 실패 시 throw. */
  fetchProfile(uid: string): Promise<ServerProfile | null>;
  /** uid 의 profiles 행을 업서트한다. 실패 시 throw. */
  upsertProfile(uid: string, payload: { save: Profile; save_version: number }): Promise<void>;
  /**
   * PvE 런 정산(자원→credits, 광물→minerals)을 서버 `settle_pve_run` RPC 로 지급하고
   * 갱신 잔액을 반환한다(ADR-0026/0027). 3중 캡이 주장액을 클램프한다. 구버전 게이트웨이면
   * `undefined` — 호출부가 no-op 처리.
   */
  settlePveRun?(summary: PveSettleSummary): Promise<SettlePveResult>;
  /**
   * 서버 `grant_currency` RPC — source 별 캡으로 재화를 가산하고 갱신 잔액을 반환한다.
   * source: 'pve_run'|'salvage'|'story'|기타. 구버전 게이트웨이면 `undefined`.
   */
  grantCurrency?(
    credits: number,
    minerals: number,
    source: string,
    metrics?: Record<string, unknown>,
  ): Promise<CurrencyGrantResult>;
  /**
   * 서버 `spend_currency` RPC — 잔액 확인 후 차감(부족 시 ok=false·미차감). 갱신 잔액 반환.
   * 사용처: 리스펙·스태시 확장·어픽스 리롤. 구버전 게이트웨이면 `undefined`.
   */
  spendCurrency?(
    credits: number,
    minerals: number,
    reason: string,
  ): Promise<SpendCurrencyResult>;
  /**
   * 촉매 소모(ADR-0029) — 서버 `consume_catalysts` RPC. 슬롯 상한·미지 id·특산-행성 정합·보유량을
   * 서버가 2차 검증하고, 통과 시 보유 원장을 차감한 뒤 pending 런 + 영수증을 심어 `{ run_id,
   * resource_mult }` 를 낸다. **실패 시 예외**(서버 트랜잭션 롤백 = 아이템 미차감). 구버전 게이트웨이면
   * `undefined` — 호출부가 no-op 처리(오프라인 폴백). 침공 런은 이 경로를 타지 않는다(촉매 PvE 전용).
   */
  consumeCatalysts?(catalystIds: number[], planet: number): Promise<CatalystConsumeResult>;
  /**
   * 촉매 드랍 적립(ADR-0029) — 서버 `grant_catalyst` RPC. 엘리트·보스 런 드랍으로 얻은 촉매를
   * 본인 보유 원장에 upsert 적립하고 갱신 수량을 낸다. 미지 id 는 서버가 거부(예외). 구버전이면 undefined.
   */
  grantCatalyst?(catalystId: number, qty: number): Promise<CatalystGrantResult>;
  /**
   * 촉매 분해(ADR-0029) — 서버 `salvage_catalyst` RPC. 보유 차감 + `grant_currency(salvage)` 로
   * 재화를 지급하고 갱신 잔액을 낸다. 잔액/보유 부족이면 `ok=false`(미차감). 구버전이면 undefined.
   */
  salvageCatalyst?(catalystId: number, qty: number): Promise<CatalystSalvageResult>;
  /**
   * 촉매 보유 원장 조회 — `catalyst_inventory` select(RLS 로 본인 행만). 픽커·관리 UI 표시용.
   * 구버전 게이트웨이면 undefined(→ 빈 보유로 취급).
   */
  fetchCatalystInventory?(): Promise<CatalystInventoryRow[]>;
}

/** raw jsonb 에서 안전하게 값 추출(RPC 응답 방어적 파싱). */
function asRec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Supabase 로 구현한 실 게이트웨이. */
export class SupabaseGateway implements ServerGateway {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseConfig) {
    this.client = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
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

  async fetchProfile(uid: string): Promise<ServerProfile | null> {
    // 재화 서버 권위(ADR-0027): credits/minerals **컬럼**을 함께 읽는다 — save jsonb 의
    // 낡은 재화가 아니라 서버 정본 컬럼을 미러 초기값으로 쓰기 위함. 구 서버(컬럼 null/부재)면
    // deserializeProfile 이 save 값을 유지한다(하위호환).
    const { data, error } = await this.client
      .from('profiles')
      .select('save, save_version, credits, minerals')
      .eq('id', uid)
      .maybeSingle();
    if (error !== null) throw error;
    if (data === null) return null;
    const row = data as {
      save: unknown;
      save_version: number;
      credits?: unknown;
      minerals?: unknown;
    };
    return {
      save: row.save,
      saveVersion: row.save_version,
      ...(row.credits !== null && row.credits !== undefined ? { credits: num(row.credits) } : {}),
      ...(row.minerals !== null && row.minerals !== undefined
        ? { minerals: num(row.minerals) }
        : {}),
    };
  }

  async upsertProfile(
    uid: string,
    payload: { save: Profile; save_version: number },
  ): Promise<void> {
    // save jsonb 안의 credits/minerals 는 표시 미러라 그대로 담아도 무해하다 — 서버 guard
    // 트리거가 재화 컬럼 write 를 이전 값으로 봉인한다(클라 위조 차단, ADR-0027).
    const { error } = await this.client
      .from('profiles')
      .upsert({ id: uid, save: payload.save, save_version: payload.save_version });
    if (error !== null) throw error;
  }

  async settlePveRun(summary: PveSettleSummary): Promise<SettlePveResult> {
    const { data, error } = await this.client.rpc('settle_pve_run', { p_summary: summary });
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      granted_credits: num(r.granted_credits),
      granted_minerals: num(r.granted_minerals),
      credits_left: num(r.credits_left),
      minerals_left: num(r.minerals_left),
      clamped: r.clamped === true,
      settled: r.settled === true,
    };
  }

  async grantCurrency(
    credits: number,
    minerals: number,
    source: string,
    metrics?: Record<string, unknown>,
  ): Promise<CurrencyGrantResult> {
    const { data, error } = await this.client.rpc('grant_currency', {
      p_credits: credits,
      p_minerals: minerals,
      p_source: source,
      p_metrics: metrics ?? null,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      granted_credits: num(r.granted_credits),
      granted_minerals: num(r.granted_minerals),
      credits_left: num(r.credits_left),
      minerals_left: num(r.minerals_left),
      clamped: r.clamped === true,
    };
  }

  async spendCurrency(
    credits: number,
    minerals: number,
    reason: string,
  ): Promise<SpendCurrencyResult> {
    const { data, error } = await this.client.rpc('spend_currency', {
      p_credits: credits,
      p_minerals: minerals,
      p_reason: reason,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      ok: r.ok === true,
      credits_left: num(r.credits_left),
      minerals_left: num(r.minerals_left),
    };
  }

  async consumeCatalysts(catalystIds: number[], planet: number): Promise<CatalystConsumeResult> {
    const { data, error } = await this.client.rpc('consume_catalysts', {
      p_catalyst_ids: catalystIds,
      p_planet: planet,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    const runId = typeof r.run_id === 'string' ? r.run_id : '';
    if (runId === '') throw new Error('consume_catalysts: run_id 미발급');
    return { run_id: runId, resource_mult: num(r.resource_mult, 1) };
  }

  async grantCatalyst(catalystId: number, qty: number): Promise<CatalystGrantResult> {
    const { data, error } = await this.client.rpc('grant_catalyst', {
      p_catalyst_id: catalystId,
      p_qty: qty,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    return { catalyst_id: num(r.catalyst_id, catalystId), qty_after: num(r.qty_after) };
  }

  async salvageCatalyst(catalystId: number, qty: number): Promise<CatalystSalvageResult> {
    const { data, error } = await this.client.rpc('salvage_catalyst', {
      p_catalyst_id: catalystId,
      p_qty: qty,
    });
    if (error !== null) throw error;
    const r = asRec(data);
    return {
      ok: r.ok === true,
      salvaged: num(r.salvaged),
      credits_left: num(r.credits_left),
      minerals_left: num(r.minerals_left),
    };
  }

  async fetchCatalystInventory(): Promise<CatalystInventoryRow[]> {
    const { data, error } = await this.client
      .from('catalyst_inventory')
      .select('catalyst_id, qty');
    if (error !== null) throw error;
    if (!Array.isArray(data)) return [];
    return data.map((row) => {
      const r = asRec(row);
      return { catalyst_id: num(r.catalyst_id), qty: num(r.qty) };
    });
  }
}
