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
}
