/**
 * verify-commission Edge Function 진입점 (의뢰서 서버 축, 서버 계약 rev3 §7).
 *
 * 의뢰 런 리플레이 전수 재실행 검증 + 통과 시 확정 지급(`settle_commission`) 원자 처리의
 * 서버측 배선이다. 순수 게이트 판정(1~6)은 `verifyCommissionCore.ts`(플랫폼 전역 무참조)에
 * 있어 vitest 로 검증되고, 이 파일은 HTTP·Auth·DB I/O + 게이트 0/0b~0d/6b/7/8/9 만 맡는다
 * (`verify-invasion/index.ts` 와 같은 구조 — 호출자 클라이언트로 신원 확인, service 클라이언트로 RPC).
 *
 * ⚠️ **`supabase/functions/verify-run/verifyCore.ts` 는 한 글자도 고치지 않는다** — `verifyRun`
 * 을 무수정 import 만 한다(하드 게이트).
 *
 * 요청: POST { run_id: string, seed, config, inputs, claim }  (verify_jwt=true, 호출자 = 제출자 본인)
 * 응답(계약 §7-4, 고정 shape — 거부도 HTTP 200): { status, accepted, reason?, grants?,
 *   granted_credits?, granted_minerals?, credits_left?, minerals_left? }
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyRun } from '../verify-run/verifyCore.ts';
import type { VerifyResult } from '../verify-run/verifyCore.ts';
import { evaluateCommissionGates, extractRunResources } from './verifyCommissionCore.ts';
import type { CommissionServerContext } from './verifyCommissionCore.ts';
import type { CommissionPayload } from '../../../src/run/commission.ts';
import {
  CAP_VERIFY_ATTEMPTS,
  COMMISSION_ACTIVE_TTL_MS,
  COMMISSION_EXCLUSIVE_UNIQUE_BITS,
  COMMISSION_EXCLUSIVE_UNIQUE_ID_BITS,
} from '../../../src/run/commissionServerConstants.ts';

/**
 * 재실행 벽시계 소프트 예산(ms) — **관측 임계이지 중단 장치가 아니다**(계약 §7-4,
 * `verify-invasion/index.ts:47` 동형). 의뢰는 다구간이라 침공보다 길 수 있어 침공값(20,000)의
 * 2 배로 잡는다. ⚠️ **미확인(계약 §13-④)** — PC 실측 게이트가 실값을 확정해야 한다.
 */
const SOFT_RERUN_BUDGET_MS = 40_000;

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

/** gzip 압축 base64 인코딩(verify-invasion/index.ts 의 gzipToBase64 와 동일 — Deno 표준만 사용). */
async function gzipToBase64(text: string): Promise<string> {
  const input = new TextEncoder().encode(text);
  const compressed = new Response(input).body!.pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(compressed).arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
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
  // `run_id` 를 알면 그 런의 `verified_result`(finalHash·틱수·승패·지급액)를 읽었다. run_id 가
  // uuid v4 라 추측 불가이므로 실제 착취성은 낮지만, **소유자 검사보다 앞서는 반환 경로를 두면
  // 안 된다**는 규율이 더 싸다.
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
      // ⚠️ **`bit` 와 `uniqueId` 를 둘 다 읽는다.** 초판은 `item_payload.bit` 만 봤는데
      //    `settle_commission` 이 실제로 쓰는 것은 `{"uniqueId": ...}` 다
      //    (20260803000000:872) — **쓰는 이름과 읽는 이름이 어긋나 있었다.**
      //    오늘은 `COMMISSION_EXCLUSIVE_UNIQUE_BITS` 가 비어 게이트가 구조적으로 아무것도
      //    안 보므로 무해하지만, 카탈로그가 채워지는 날 이 조회가 항상 빈 집합을 돌려주어
      //    **정직하게 발급받은 플레이어가 `commission-unauthorized-unique` 로 오거부된다.**
      //    고치는 자리로 SQL 이 아니라 EF 를 고른 근거: `settle_commission` 재정의를 피한다
      //    (낡은 본문 복제가 프로덕션을 100% 깨뜨린 전례 — 20260802000000:4-15).
      //    `uniqueId` → `bit` 접기는 `COMMISSION_EXCLUSIVE_UNIQUE_ID_BITS` 가 맡는다(그쪽
      //    주석에 UNIQUE_REGISTRY 를 직접 못 읽는 이유가 있다).
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

  // 게이트 1~6(순수 판정 — verifyCommissionCore.ts).
  const gateResult = evaluateCommissionGates(rawSubmission, context);
  if (!gateResult.ok) {
    return respond('rejected', false, { reason: gateResult.reason });
  }

  // 게이트 6b: EF 재실행 시도 카운터를 **별도 트랜잭션**으로 증가(계약 §5-7·§7-1). 값싼 거부
  // (게이트 0~6)에는 시도를 소모시키지 않고, CPU 를 쓰는 게이트 7 직전에만 센다.
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

  // 게이트 7: verify-run 의 verifyRun 을 **무수정 import** 로 재사용(하드 게이트).
  const startedAt = Date.now();
  let verdict: VerifyResult;
  try {
    verdict = verifyRun(gateResult.submission);
  } catch (e) {
    console.error(`verify-commission 재실행 예외 (run=${runId}):`, e);
    verdict = { verdict: 'reject', reason: 'replay-threw' };
  }
  const elapsed = Date.now() - startedAt;
  if (elapsed > SOFT_RERUN_BUDGET_MS) {
    console.warn(`verify-commission 재실행 벽시계 초과: ${elapsed}ms (run=${runId})`);
  }

  const verifiedResult = verdict.computed ?? null;

  // 압축 보존(best-effort, ADR-0026 동형) — 확정 뒤에 호출한다. 실패해도 확정 결과를 무효화
  // 하지 않는다(48h TTL cron 이 백스톱). 원본 리플레이는 EF 요청 본문에만 존재한다(계약 §3-3).
  const archiveReplay = async (): Promise<void> => {
    try {
      const replayJson = JSON.stringify({
        seed: rawSubmission.seed,
        config: rawSubmission.config,
        inputs: rawSubmission.inputs,
      });
      const gz = await gzipToBase64(replayJson);
      const { error: gzErr } = await service.rpc('store_commission_replay_gz', {
        p_run_id: runId,
        p_gz: gz,
      });
      if (gzErr !== null) {
        console.error(`store_commission_replay_gz 실패 (run=${runId}):`, gzErr.message);
      }
    } catch (e) {
      console.error(`의뢰 리플레이 압축 저장 예외 (run=${runId}):`, e);
    }
  };

  if (verdict.verdict === 'reject') {
    // 게이트 8: 실패 런 확정(보상 0).
    const { error: settleErr } = await service.rpc('settle_commission', {
      p_run_id: runId,
      p_verdict: 'reject',
      p_verified_result: verifiedResult,
      p_run_credits: 0,
      p_run_minerals: 0,
    });
    if (settleErr !== null) {
      return respond('rejected', false, { reason: 'commission-settle-failed' }, 500);
    }
    await archiveReplay();
    return respond('rejected', false, { reason: verdict.reason });
  }

  // 게이트 8: 확정 지급. `p_run_credits` 는 재실행 finalState.resources(검증된 값)에서 뽑는다
  // — verifyRun 은 이 값을 안 돌려주므로 같은 결정론적 replay 를 한 번 더 돈다
  // (extractRunResources 문서 참조). `p_run_minerals` 는 0 으로 고정한다(⚠️ 가정 — 코어 파일
  // 문서 참조: WorldState 에 결정론적 minerals 필드가 없다).
  const { resources: runCredits } = extractRunResources(gateResult.submission);
  const { data: settleData, error: settleErr } = await service.rpc('settle_commission', {
    p_run_id: runId,
    p_verdict: 'accept',
    p_verified_result: verifiedResult,
    p_run_credits: runCredits,
    p_run_minerals: 0,
  });
  if (settleErr !== null) {
    return respond('rejected', false, { reason: 'commission-settle-failed' }, 500);
  }
  await archiveReplay();

  const s = asRecord(settleData);
  return respond('verified', true, {
    granted_credits: num(s.granted_credits),
    granted_minerals: num(s.granted_minerals),
    credits_left: num(s.credits_left),
    minerals_left: num(s.minerals_left),
    grants: Array.isArray(s.grants) ? s.grants : [],
  });
});
