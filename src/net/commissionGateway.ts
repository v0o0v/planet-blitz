/**
 * 의뢰서(Commission) 게이트웨이 — 서버 축 클라 배선(서버 계약 rev3 §5·§7).
 *
 * `gateway.ts`(RPC 위주 — `SupabaseGateway`)와 `invasionGateway.ts`(RPC + EF invoke 위주 —
 * `SupabaseInvasionGateway`)의 문법을 그대로 따른다. SDK 는 `supabaseClient.ts` 가 유일하게
 * 정적 import 하고 이 파일은 그것을 경유한다.
 *
 * ⚠️ **`commission_runs` 기저 테이블을 직접 읽지 마라.** 반드시 `commission_runs_public` 뷰를
 * 경유한다 — 기저는 `loadout_sealed`·`replay_gz` 컬럼 GRANT 가 회수돼 있어(계약 §3-5 rev3
 * 선행2) 직접 select 하면 `permission denied for column` 이다. 이 파일의 {@link
 * SupabaseCommissionGateway.fetchCommissionRuns} 가 그 규율을 강제한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient, requireUserId } from './supabaseClient.js';
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
  /**
   * 배송 완료 시각(`null` = 미배송 → 다음 부팅 재시도 대상). 20260805010000 이 신설한 컬럼.
   * **발급(`grantedAtMs`)과 다른 사건이다** — 발급은 서버가 원장에 적은 순간이고 배송은
   * 플레이어 세이브에 물건이 들어간 순간이다. 이 둘을 하나로 보면 "이겼는데 물건이 안 왔다"
   * 상태를 표현할 자리가 없어진다.
   */
  appliedAtMs: number | null;
}

/** `consume_commission` RPC 반환(계약 §5-2). */
export interface ConsumeCommissionResult {
  runId: string;
  payload: CommissionPayload;
}

/**
 * `discard_commission` RPC 반환(2026-08-03 신설). `held` 는 폐기 **후** 남은 보유 수 —
 * 클라가 세지 않고 서버가 세어 준다(원장이 정본이라 클라 감산은 두 번째 진실이 된다).
 */
export interface DiscardCommissionResult {
  commissionId: string;
  held: number;
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

/** `verify-commission` 에 실을 제출. */
export interface CommissionRunSubmission {
  seed: number;
  config: unknown;
  inputs: unknown;
  claim: unknown;
  /**
   * 런 중에 번 크레딧·광물(클라 **주장**). ADR-0050 으로 서버 재실행이 사라지면서 이 값의
   * 권위 소스가 없어졌다 — 그래서 **주장하고 서버가 깎는다**(사용자 결정 2026-08-07).
   *
   * ⚠️ **이 값을 믿는 것이 아니다.** `settle_commission` 이 `least(주장, v_plaus_run)` 으로
   * 깎고, 그 캡의 분모인 틱 수는 `verify-commission` 게이트 1 이 서버측 `replayBudgetTicks`
   * 이하로 이미 묶어 둔다. 즉 부풀려도 서버가 정한 천장 위로는 못 간다.
   *
   * 0 으로 죽이지 않은 이유는 ADR-0050 §4 다 — 목표는 차단이 아니라 **유계**이고, 0 은 위조가
   * 아니라 정직한 수익까지 차단해 일반 PvE 런과 규칙을 갈라 놓는다.
   */
  runCredits?: number;
}

/** 의뢰서 서버 IO(테스트에서 fake 로 주입). */
export interface CommissionGateway {
  /** 익명 세션을 보장하고 로그인 uid 를 반환한다. 실패 시 throw. */
  getUserId(): Promise<string>;
  /** 출격(계약 §5-2) — 의뢰서 소비 + `commission_runs` 행 생성. 실패 시 throw(거부 사유는 예외 메시지). */
  consumeCommission(commissionId: string, loadout: unknown): Promise<ConsumeCommissionResult>;
  /**
   * 폐기 — 미소비 의뢰서 1장을 서버 원장에서 지운다(2026-08-03). 실패 시 throw(거부 사유는
   * 예외 메시지). **되돌릴 수 없다** — 서버는 감사용으로 payload 를 남기지만 재고로는 안 돌린다.
   */
  discardCommission(commissionId: string): Promise<DiscardCommissionResult>;
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
  /**
   * 유니크 축 배송 완료 통지(`mark_commission_grant_applied`, 20260805010000).
   *
   * ⚠️ **반드시 세이브 반영 → 프로필 push 성공 → 재-pull 확인 뒤에** 부른다. 앞에서 부르면
   * `chooseProfile` 통짜 선택이 그 아이템을 버릴 수 있는데 행은 이미 표시돼 재시도되지
   * 않는다 → 영구 유실. 실패 시 throw(호출부가 표시를 미룬다).
   */
  markCommissionGrantApplied(grantId: string): Promise<void>;
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
    // ⚠️ `asEpochMs` 는 폴백이 있어 null 을 0(= 1970)으로 뭉갠다. 미배송을 "1970에 배송됨"
    //    으로 읽으면 배송 루틴이 그 행을 영영 건너뛴다 — null 을 명시적으로 보존한다.
    appliedAtMs: r.applied_at != null ? asEpochMs(r.applied_at) : null,
  };
}

/**
 * `functions.invoke` 오류가 **재시도해도 결과가 안 바뀌는 최종 실패**면 그 HTTP 상태를, 아니면
 * `null` 을 돌려준다.
 *
 * 재시도 대상에서 뺄 것(= 최종): 4xx 중 **401·408·429 를 제외**한 전부. 401 은 세션 만료라
 * 갱신 후 성공할 수 있고, 408·429 는 그 자체가 "나중에 다시 오라"는 뜻이다. 5xx·네트워크
 * 단절은 여기서 `null` 이 되어 호출부의 큐잉 경로로 간다.
 *
 * ⚠️ Supabase 클라이언트는 `FunctionsHttpError.context` 에 원본 `Response` 를 실어 준다. 그
 * 형태가 바뀔 수 있으므로 **못 읽으면 `null`(= 재시도)** 로 떨어진다 — 판정 불가일 때 영구
 * 폐기보다 재시도가 안전한 쪽이다(확정 지급물이 걸려 있다).
 */
export function finalHttpStatus(error: unknown): number | null {
  const ctx = (error as { context?: unknown } | null)?.context;
  const status = (ctx as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return null;
  if (status < 400 || status >= 500) return null;
  if (status === 401 || status === 408 || status === 429) return null;
  return status;
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
    this.client = getSupabaseClient(config);
  }

  async getUserId(): Promise<string> {
    return requireUserId(this.client);
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

  async discardCommission(commissionId: string): Promise<DiscardCommissionResult> {
    const { data, error } = await this.client.rpc('discard_commission', {
      p_commission_id: commissionId,
    });
    if (error !== null) throw error;
    const r = asRecord(data);
    // `held` 는 서버가 센 값이다 — 0 도 정상이라 `asNumber` 의 폴백과 구분되지 않지만,
    // 여기서 구분할 필요가 없다: 화면은 이 값을 쓰지 않고 목록을 **다시 읽는다**(원장이 정본).
    return { commissionId: asString(r.commission_id, commissionId), held: asNumber(r.held) };
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
        // 광물은 **보내지 않는다** — 재실행 시절에도 `p_run_minerals` 는 항상 0 이었다
        // (`WorldState` 에 결정론적 minerals 필드가 없다). EF 가 부재를 0 으로 읽는다.
        run_credits: submission.runCredits ?? 0,
      },
    });
    if (error !== null) {
      // ⚠️ **영구 실패와 전송 실패를 여기서 갈라야 한다.** EF 는 판정 거부를 200 으로 내지만
      //    게이트 일부는 4xx 다(`commission-run-not-found` 404 · `commission-run-not-owner` 403 ·
      //    `malformed-run-id`/`invalid-json` 400). `functions.invoke` 는 non-2xx 를 error 로
      //    돌려주므로, 구분 없이 throw 하면 호출부가 **전송 실패로 오인해 큐에 넣고 영원히
      //    재시도**한다 — 그 run_id 는 영구적으로 4xx 라 수 MB POST 가 부팅마다 반복된다.
      //    401(만료 세션)·408·429 는 **재시도가 옳으므로** 최종 판정에서 제외한다.
      const status = finalHttpStatus(error);
      if (status !== null) {
        return { status: 'rejected', accepted: false, reason: `commission-http-${status}` };
      }
      throw error;
    }
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
      .select(
        'grant_id, profile_id, commission_run_id, kind, slot_index, item_payload, granted_at, applied_at',
      )
      .order('granted_at', { ascending: false });
    if (error !== null) throw error;
    const rows = Array.isArray(data) ? data : [];
    return rows.map(rowToGrant);
  }

  async markCommissionGrantApplied(grantId: string): Promise<void> {
    const { data, error } = await this.client.rpc('mark_commission_grant_applied', {
      p_grant_id: grantId,
    });
    if (error !== null) throw error;
    // `updated: 0` 은 오류가 아니다(이미 표시됨 = 멱등 재시도). 하지만 `ok: false`(미로그인 등)는
    // **표시가 안 됐다**는 뜻이라 반드시 throw 해야 호출부가 다음 부팅에 다시 시도한다 —
    // 조용히 성공으로 넘기면 그 행이 미배송인 채로 영원히 재시도 대상이 되거나(무해) 반대로
    // 클라가 배송을 끝냈다고 착각한다(유해).
    const r = asRecord(data);
    if (r.ok === false) {
      throw new Error(`mark_commission_grant_applied 거부: ${asString(r.code, 'unknown')}`);
    }
  }
}
