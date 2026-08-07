/**
 * verify-commission Edge Function 진입점 (의뢰서 서버 축 · **ADR-0050 재실행 삭제 · 레인 B**).
 *
 * ⚠️ **재실행 검증(게이트 7 `verifyRun`)과 리플레이 압축 보존은 삭제됐다.** 이 파일은 더 이상
 * `verify-run/verifyCore.ts` 를 import 하지 않고 `src/sim` 을 싣지 않는다(ADR-0050 §1). 순수
 * 게이트 판정(1~5)은 `verifyCommissionCore.ts`(플랫폼 전역 무참조)에 있고, 이 파일은 HTTP·
 * Auth·DB I/O + 게이트 0/0b~0d/6b/8/9 만 맡는다.
 *
 * 게이트 1~5(입력 길이·촉매 금지·로드아웃 대조·미인가 유니크·payload 대조)를 전부 통과하면
 * **재실행 없이 확정 지급**한다 — 확정 보상(`payload.rewards`)만 지급하고, 예전에 재실행
 * `finalState.resources` 에서 뽑던 런 파생 보너스는 **재실행이 없어 산출할 수 없으므로 0 으로
 * 고정한다**(런 파생분을 부풀리는 방향으로 값을 지어내지 않는 보수적 선택 — settle_commission
 * 의 개연성 캡 자체는 SQL 본문 미변경으로 그대로 남아 있다, `20260803000000_commission_ledger.sql:891-920`).
 *
 * 요청: POST { run_id: string, seed, config, inputs, claim }  (verify_jwt=true, 호출자 = 제출자 본인)
 * 응답(계약 §7-4, 고정 shape — 거부도 HTTP 200): { status, accepted, reason?, grants?,
 *   granted_credits?, granted_minerals?, credits_left?, minerals_left? }
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { evaluateCommissionGates } from './verifyCommissionCore.ts';
import type { CommissionServerContext } from './verifyCommissionCore.ts';
import type { CommissionPayload } from '../../../src/run/commission.ts';
import {
  CAP_VERIFY_ATTEMPTS,
  COMMISSION_ACTIVE_TTL_MS,
  COMMISSION_EXCLUSIVE_UNIQUE_BITS,
  COMMISSION_EXCLUSIVE_UNIQUE_ID_BITS,
} from '../../../src/run/commissionServerConstants.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 계약 §7-4 고정 응답 shape 헬퍼. 거부도 HTTP 200(기본)으로 낸다. */
function respond(
  status: string,
  accepted: boolean,
  extra?: Record<string, unknown>,
  httpStatus = 200,
): Response {
  return json({ status, accepted, ...extra }, httpStatus);
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return respond('rejected', false, { reason: 'method-not-allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (authHeader === null) {
    return respond('rejected', false, { reason: 'missing-authorization' }, 401);
  }

  let body: {
    run_id?: unknown;
    seed?: unknown;
    config?: unknown;
    inputs?: unknown;
    claim?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return respond('rejected', false, { reason: 'invalid-json' }, 400);
  }
  const runId = body.run_id;
  if (typeof runId !== 'string' || runId.length === 0) {
    return respond('rejected', false, { reason: 'malformed-run-id' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url === undefined || anonKey === undefined || serviceKey === undefined) {
    return respond('rejected', false, { reason: 'server-misconfigured' }, 500);
  }

  // 호출자 식별(anon key + 원 JWT) — 제출자 본인 확인용 uid.
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr !== null || userData.user === null) {
    return respond('rejected', false, { reason: 'unauthenticated' }, 401);
  }
  const callerId = userData.user.id;

  // service_role 클라이언트로 RPC(RLS 우회).
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 게이트 0a: commission_runs 행 조회.
  const { data: runRow, error: runErr } = await service
    .from('commission_runs')
    .select('run_id, profile_id, status, payload, loadout_sealed, started_at, verified_result')
    .eq('run_id', runId)
    .maybeSingle();
  if (runErr !== null) {
    return respond('rejected', false, { reason: 'commission-run-load-failed' }, 500);
  }
  if (runRow === null) {
    return respond('rejected', false, { reason: 'commission-run-not-found' }, 404);
  }
  const run = runRow as {
    run_id: string;
    profile_id: string;
    status: string;
    payload: unknown;
    loadout_sealed: unknown;
    started_at: string | null;
    verified_result: unknown;
  };

  // 게이트 0d(**소유자 검사가 먼저다** — 계약 §7-1 게이트 표의 순서를 이 자리에서 정정한다):
  // 제출자 = 행의 profile_id 본인만. 예전에는 0b(멱등 반환)가 앞이라, 인증된 아무 사용자가 남의
  // `run_id` 를 알면 그 런의 `verified_result`(승패·지급액)를 읽었다. run_id 가 uuid v4 라 추측
  // 불가이므로 실제 착취성은 낮지만, **소유자 검사보다 앞서는 반환 경로를 두면 안 된다**는
  // 규율이 더 싸다.
  if (run.profile_id !== callerId) {
    return respond('rejected', false, { reason: 'commission-run-not-owner' }, 403);
  }

  // 게이트 0b: 이미 확정된 런은 저장된 판정을 CPU 없이 그대로 반환(멱등 재호출의 값싼 경로).
  if (run.status === 'verified' || run.status === 'rejected') {
    const vr = asRecord(run.verified_result);
    return respond(run.status, run.status === 'verified', {
      note: 'already-finalized',
      ...(run.status === 'verified'
        ? {
            granted_credits: num(vr.granted_credits),
            granted_minerals: num(vr.granted_minerals),
            credits_left: num(vr.credits_left),
            minerals_left: num(vr.minerals_left),
            grants: Array.isArray(vr.grants) ? vr.grants : [],
          }
        : {}),
    });
  }

  // 게이트 0c: active 가 아니면(issued/expired/abandoned 포함) 거부 — cron 실행 여부와 무관.
  if (run.status !== 'active' || run.started_at === null) {
    return respond('rejected', false, { reason: 'commission-run-not-active' });
  }

  // 게이트 0c′: active 만료(24h) — cron ③에만 의존하지 않고 판정 지점에 직접 나이 검사를 건다.
  const startedAtMs = Date.parse(run.started_at);
  if (!Number.isFinite(startedAtMs) || startedAtMs <= Date.now() - COMMISSION_ACTIVE_TTL_MS) {
    return respond('rejected', false, { reason: 'commission-run-expired' });
  }

  const payload = run.payload as CommissionPayload;

  // 게이트 4 재료: 이 profile 에게 이미 발급된 의뢰 전용 유니크의 bit 집합(commission_grants).
  // exclusiveUniqueBits 가 비어 있으면(Phase D 카탈로그 미도입) 이 조회는 무해하게 빈 결과다.
  let grantedUniqueBits: number[] = [];
  if (COMMISSION_EXCLUSIVE_UNIQUE_BITS.length > 0) {
    const { data: grantRows } = await service
      .from('commission_grants')
      .select('item_payload')
      .eq('profile_id', callerId)
      .eq('kind', 'unique');
    if (Array.isArray(grantRows)) {
      // ⚠️ **`bit` 와 `uniqueId` 를 둘 다 읽는다** — `settle_commission` 이 실제로 쓰는 것은
      //    `{"uniqueId": ...}` 다(구 verifyCommissionCore.ts 주석과 동일 근거).
      const bits: number[] = [];
      for (const r of grantRows) {
        const p = asRecord((r as { item_payload?: unknown }).item_payload);
        if (typeof p.bit === 'number' && Number.isFinite(p.bit)) bits.push(p.bit);
        if (typeof p.uniqueId === 'string') {
          const mapped = COMMISSION_EXCLUSIVE_UNIQUE_ID_BITS[p.uniqueId];
          if (typeof mapped === 'number' && Number.isFinite(mapped)) bits.push(mapped);
        }
      }
      grantedUniqueBits = bits;
    }
  }

  const context: CommissionServerContext = {
    payload,
    loadoutSealed: run.loadout_sealed,
    grantedUniqueBits,
    exclusiveUniqueBits: COMMISSION_EXCLUSIVE_UNIQUE_BITS,
  };

  const rawSubmission = {
    seed: body.seed,
    config: body.config,
    inputs: body.inputs,
    claim: body.claim,
  };

  // 게이트 1~5(순수 판정 — verifyCommissionCore.ts). 재실행 없이 이 판정이 확정 지급의
  // 유일한 관문이다(ADR-0050) — 구조 검사에 이미 있는 캡·정합성 검사는 전부 통과해야 한다.
  const gateResult = evaluateCommissionGates(rawSubmission, context);
  if (!gateResult.ok) {
    // 값싼 거부: 런 상태를 건드리지 않는다(재시도 가능 — 예: 로드아웃을 바로잡고 재호출).
    return respond('rejected', false, { reason: gateResult.reason });
  }

  // 게이트 6b: 재검증/재확정 시도 카운터를 **별도 트랜잭션**으로 증가(계약 §5-7·§7-1). 값싼
  // 거부(게이트 0~5)에는 시도를 소모시키지 않고, 확정 직전에만 센다(중복 제출 방지 캡 유지).
  const { data: attemptsData, error: attemptsErr } = await service.rpc(
    'bump_commission_verify_attempts',
    { p_run_id: runId },
  );
  if (attemptsErr !== null) {
    return respond('rejected', false, { reason: 'commission-attempts-bump-failed' }, 500);
  }
  const attempts = attemptsData;
  if (typeof attempts !== 'number' || attempts > CAP_VERIFY_ATTEMPTS) {
    return respond('rejected', false, { reason: 'commission-too-many-attempts' });
  }

  // 게이트 8: 확정 지급.
  //
  // ## 런 파생 자원을 왜 0 으로 죽이지 않는가 (사용자 결정 2026-08-07)
  // 예전엔 재실행 `finalState.resources` 에서 뽑았다(계약 §8). 재실행이 사라졌으니 **클라가
  // 주장하고 서버가 깎는다** — ADR-0050 §4 의 목표가 *"차단이 아니라 위조 이득을 정직한
  // 최상위 플레이어 수준으로 **유계**"* 이기 때문이다. 0 으로 고정하면 위조뿐 아니라 **정직한
  // 수익까지 차단**해 일반 PvE 런과 규칙이 갈린다.
  //
  // ⭐ **캡이 실제로 유계인 근거**: `settle_commission` 이
  // `least(greatest(0, p_run_credits), v_plaus_run)` 으로 깎고(SQL 본문 미변경),
  // `v_plaus_run = PLAUSIBILITY_CREDITS_PER_TICK × v_ver_ticks × (1 + v_max_stage)` 다.
  // 그 분모인 틱 수는 **게이트 1 이 `inputs.length > server.payload.replayBudgetTicks` 를 이미
  // 거부**하므로 여기 도달한 시점에 **서버가 정한 상한 이하**다. 즉 클라는 틱을 부풀려 캡을
  // 키울 수 없다 — 캡의 분모가 클라 통제 밖이라는 것이 이 설계의 전부다.
  // ⚠️ 게이트 1 을 완화하거나 `replayBudgetTicks` 를 클라 값에서 파생시키면 **이 캡이 즉시
  // 무의미해진다.** 둘은 한 몸이다.
  const ticks = Array.isArray(body.inputs) ? (body.inputs as unknown[]).length : 0;
  const verifiedResult = { source: 'client-claim-capped', ticks };
  // 음수·NaN·Infinity 방어. 상한은 SQL 이 쥔다 — 여기서 또 깎으면 두 벌이 갈린다.
  const claimNum = (v: unknown): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const runCredits = claimNum(body.run_credits);
  const runMinerals = claimNum(body.run_minerals);
  const { data: settleData, error: settleErr } = await service.rpc('settle_commission', {
    p_run_id: runId,
    p_verdict: 'accept',
    p_verified_result: verifiedResult,
    p_run_credits: runCredits,
    p_run_minerals: runMinerals,
  });
  if (settleErr !== null) {
    return respond('rejected', false, { reason: 'commission-settle-failed' }, 500);
  }

  const s = asRecord(settleData);
  return respond('verified', true, {
    granted_credits: num(s.granted_credits),
    granted_minerals: num(s.granted_minerals),
    credits_left: num(s.credits_left),
    minerals_left: num(s.minerals_left),
    grants: Array.isArray(s.grants) ? s.grants : [],
  });
});
