/**
 * 의뢰서(Commission) 게이트웨이 — 서버 축 클라 배선(서버 계약 rev3 §5·§7).
 *
 * `gateway.ts`(RPC 위주 — `SupabaseGateway`)와 `invasionGateway.ts`(RPC + EF invoke 위주 —
 * `SupabaseInvasionGateway`)의 문법을 그대로 따른다. 이 파일만 `@supabase/supabase-js` 를
 * 정적 import 한다.
 *
 * ⚠️ **`commission_runs` 기저 테이블을 직접 읽지 마라.** 반드시 `commission_runs_public` 뷰를
 * 경유한다 — 기저는 `loadout_sealed`·`replay_gz` 컬럼 GRANT 가 회수돼 있어(계약 §3-5 rev3
 * 선행2) 직접 select 하면 `permission denied for column` 이다. 이 파일의 {@link
 * SupabaseCommissionGateway.fetchCommissionRuns} 가 그 규율을 강제한다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from './config.js';
import type { CommissionPayload } from '../run/commission.js';

/** raw jsonb/행에서 안전하게 값을 뽑는 헬퍼(다른 게이트웨이 파일들과 동일 패턴). */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asEpochMs(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return fallback;
}

/** `commission_inventory` 한 행(아직 쓰지 않은 의뢰서 — 계약 §3-1). */
export interface CommissionInventoryRow {
  commissionId: string;
  grade: number;
  payload: CommissionPayload;
  createdAtMs: number;
}

/** `commission_runs_public` 뷰 한 행(계약 §3-5 — `loadout_sealed`·`replay_gz` 는 여기 없다). */
export interface CommissionRunRow {
  runId: string;
  profileId: string;
  commissionId: string;
  grade: number;
  status: 'issued' | 'active' | 'verified' | 'rejected' | 'expired' | 'abandoned';
  payload: CommissionPayload;
  verifyAttempts: number;
  verifiedResult: unknown;
  createdAtMs: number;
  startedAtMs: number | null;
  verifiedAtMs: number | null;
}

/** `commission_grants` 한 행(의뢰 확정 지급물의 발급 정본 — ADR-0045). */
export interface CommissionGrantRow {
  grantId: string;
  profileId: string;
  commissionRunId: string;
  kind: 'unique' | 'blueprint';
  slotIndex: number;
  itemPayload: unknown;
  grantedAtMs: number;
}

/** `consume_commission` RPC 반환(계약 §5-2). */
export interface ConsumeCommissionResult {
  runId: string;
  payload: CommissionPayload;
}

/** `mark_commission_active` RPC 반환(계약 §5-3). */
export interface MarkCommissionActiveResult {
  runId: string;
  startedAtMs: number;
}

/**
 * `verify-commission` EF 응답(계약 §7-4 고정 shape). 거부도 `accepted:false` + `reason` 으로
 * 온다(HTTP 200) — throw 가 아니라 이 형태로 갈린다.
 */
export interface VerifyCommissionResult {
  status: string;
  accepted: boolean;
  reason?: string;
  grants?: unknown[];
  grantedCredits?: number;
  grantedMinerals?: number;
  creditsLeft?: number;
  mineralsLeft?: number;
}

/** `verify-commission` 에 실을 제출(리플레이 + config). */
export interface CommissionRunSubmission {
  seed: number;
  config: unknown;
  inputs: unknown;
  claim: unknown;
}

/** 의뢰서 서버 IO(테스트에서 fake 로 주입). */
export interface CommissionGateway {
  /** 익명 세션을 보장하고 로그인 uid 를 반환한다. 실패 시 throw. */
  getUserId(): Promise<string>;
  /** 출격(계약 §5-2) — 의뢰서 소비 + `commission_runs` 행 생성. 실패 시 throw(거부 사유는 예외 메시지). */
  consumeCommission(commissionId: string, loadout: unknown): Promise<ConsumeCommissionResult>;
  /** 런 시작 신호(계약 §5-3). 실패 시 throw. */
  markCommissionActive(runId: string): Promise<MarkCommissionActiveResult>;
  /** 제출 리플레이 검증(계약 §7). EF 응답을 그대로 정규화해 반환 — throw 는 전송 실패일 때만. */
  verifyCommission(runId: string, submission: CommissionRunSubmission): Promise<VerifyCommissionResult>;
  /** 지시 수신소의 미소비 의뢰서 목록(select-own). */
  fetchCommissionInventory(): Promise<CommissionInventoryRow[]>;
  /** 본인 의뢰 런 이력(`commission_runs_public` 뷰 경유 — 기저 직접 select 금지). */
  fetchCommissionRuns(limit: number): Promise<CommissionRunRow[]>;
  /** 본인 의뢰 확정 지급물 이력(발급 정본 — ADR-0045). */
  fetchCommissionGrants(): Promise<CommissionGrantRow[]>;
}

function rowToInventory(raw: unknown): CommissionInventoryRow {
  const r = asRecord(raw);
  return {
    commissionId: asString(r.commission_id),
    grade: asNumber(r.grade),
    payload: r.payload as CommissionPayload,
    createdAtMs: asEpochMs(r.created_at),
  };
}

function rowToRun(raw: unknown): CommissionRunRow {
  const r = asRecord(raw);
  const statusRaw = asString(r.status);
  const status: CommissionRunRow['status'] =
    statusRaw === 'active' ||
    statusRaw === 'verified' ||
    statusRaw === 'rejected' ||
    statusRaw === 'expired' ||
    statusRaw === 'abandoned'
      ? statusRaw
      : 'issued';
  return {
    runId: asString(r.run_id),
    profileId: asString(r.profile_id),
    commissionId: asString(r.commission_id),
    grade: asNumber(r.grade),
    status,
    payload: r.payload as CommissionPayload,
    verifyAttempts: asNumber(r.verify_attempts),
    verifiedResult: r.verified_result ?? null,
    createdAtMs: asEpochMs(r.created_at),
    startedAtMs: r.started_at != null ? asEpochMs(r.started_at) : null,
    verifiedAtMs: r.verified_at != null ? asEpochMs(r.verified_at) : null,
  };
}

function rowToGrant(raw: unknown): CommissionGrantRow {
  const r = asRecord(raw);
  const kindRaw = asString(r.kind);
  return {
    grantId: asString(r.grant_id),
    profileId: asString(r.profile_id),
    commissionRunId: asString(r.commission_run_id),
    kind: kindRaw === 'blueprint' ? 'blueprint' : 'unique',
    slotIndex: asNumber(r.slot_index),
    itemPayload: r.item_payload ?? null,
    grantedAtMs: asEpochMs(r.granted_at),
  };
}

/** EF 응답 jsonb → {@link VerifyCommissionResult}(신뢰하되 방어적으로 정규화). */
function normalizeVerifyResult(raw: unknown): VerifyCommissionResult {
  const r = asRecord(raw);
  const out: VerifyCommissionResult = {
    status: asString(r.status, 'rejected'),
    accepted: r.accepted === true,
  };
  if (typeof r.reason === 'string') out.reason = r.reason;
  if (Array.isArray(r.grants)) out.grants = r.grants;
  if (r.granted_credits !== undefined) out.grantedCredits = asNumber(r.granted_credits);
  if (r.granted_minerals !== undefined) out.grantedMinerals = asNumber(r.granted_minerals);
  if (r.credits_left !== undefined) out.creditsLeft = asNumber(r.credits_left);
  if (r.minerals_left !== undefined) out.mineralsLeft = asNumber(r.minerals_left);
  return out;
}

export class SupabaseCommissionGateway implements CommissionGateway {
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

  async consumeCommission(commissionId: string, loadout: unknown): Promise<ConsumeCommissionResult> {
    const { data, error } = await this.client.rpc('consume_commission', {
      p_commission_id: commissionId,
      p_loadout: loadout,
    });
    if (error !== null) throw error;
    const r = asRecord(data);
    const runId = asString(r.run_id);
    if (runId === '') throw new Error('consume_commission: run_id 미발급');
    return { runId, payload: r.payload as CommissionPayload };
  }

  async markCommissionActive(runId: string): Promise<MarkCommissionActiveResult> {
    const { data, error } = await this.client.rpc('mark_commission_active', {
      p_run_id: runId,
    });
    if (error !== null) throw error;
    const r = asRecord(data);
    return { runId: asString(r.run_id, runId), startedAtMs: asEpochMs(r.started_at, Date.now()) };
  }

  async verifyCommission(
    runId: string,
    submission: CommissionRunSubmission,
  ): Promise<VerifyCommissionResult> {
    const { data, error } = await this.client.functions.invoke('verify-commission', {
      body: {
        run_id: runId,
        seed: submission.seed,
        config: submission.config,
        inputs: submission.inputs,
        claim: submission.claim,
      },
    });
    if (error !== null) throw error;
    return normalizeVerifyResult(data);
  }

  async fetchCommissionInventory(): Promise<CommissionInventoryRow[]> {
    const { data, error } = await this.client
      .from('commission_inventory')
      .select('commission_id, grade, payload, created_at')
      .order('created_at', { ascending: false });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map(rowToInventory);
  }

  async fetchCommissionRuns(limit: number): Promise<CommissionRunRow[]> {
    // ⚠️ 반드시 뷰(`commission_runs_public`)를 경유한다 — 기저 `commission_runs` 는
    // `loadout_sealed`·`replay_gz` 컬럼 GRANT 가 회수돼 있어 직접 select 시 permission denied.
    const { data, error } = await this.client
      .from('commission_runs_public')
      .select(
        'run_id, profile_id, commission_id, grade, status, payload, verify_attempts, verified_result, created_at, started_at, verified_at',
      )
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map(rowToRun);
  }

  async fetchCommissionGrants(): Promise<CommissionGrantRow[]> {
    const { data, error } = await this.client
      .from('commission_grants')
      .select('grant_id, profile_id, commission_run_id, kind, slot_index, item_payload, granted_at')
      .order('granted_at', { ascending: false });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map(rowToGrant);
  }
}
