/**
 * verify-pve-sample Edge Function 진입점 (M4 Phase F · F4 · Deno.serve 래퍼).
 *
 * PvE 런 표본을 전수 재실행 검증하는 서버측 배선이다(계획 §4 F4 완전판 착수 조건 이행).
 * 검증 순수 로직은 `verifyPveCore.ts`(플랫폼 전역 무참조, verify-run 코어 재사용)에 있고,
 * 이 파일은 HTTP·Auth·DB I/O·배치 오케스트레이션만 맡는다.
 *
 * 계약:
 *   요청:  POST { limit?: number }   (verify_jwt=false, 호출자 = 서버/관리자 = service_role 키)
 *   응답:  { checked, verified, rejected, flagged }
 *
 * 트리거: 사용자가 아니라 **service_role 키를 가진 서버/스케줄러**만 호출한다(래더·경제에
 *   직접 영향 없는 배치 검증이라 사용자 JWT 흐름이 아니다). Authorization 의 Bearer 토큰이
 *   SUPABASE_SERVICE_ROLE_KEY 와 일치해야 한다 — 불일치는 401. 주기 실행은 마이그레이션
 *   20260718000000 주석의 pg_cron+pg_net 또는 외부 스케줄러가 담당(배포 담당 몫).
 *
 * 서버 권위(원칙2):
 *   - 검증 대상 선정(sample_pve_runs)·판정 확정(apply_pve_verification)은 service_role RPC 만.
 *   - 재실행 불일치(위조/슬로우핵)면 rejected 확정 + 계정 flagged(적발 처리, ADR-0005 트레이드
 *     오프의 확률적 보완). 대조는 저장된 리플레이의 결정론 재현이므로 서버 계산이 진실이다.
 *
 * ⚠️ 재실행 시간예산: 한 요청에서 최대 MAX_BATCH 건만 재실행한다(동기 CPU 재실행이 이벤트
 *   루프를 점유하므로 배치 상한이 1차 DoS/과금 방어선). 벽시계 초과는 사후 경고 로그만.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyPveRun } from './verifyPveCore.ts';

/** 한 호출에서 재실행할 런 상한(시간예산 방어). 요청 limit 은 이 값으로 클램프된다. */
const MAX_BATCH = 200;
/** 배치 재실행 벽시계 소프트 예산(ms). 초과 시 결과는 반환하되 경고 로그(중단 불가). */
const SOFT_BATCH_BUDGET_MS = 25_000;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, 405);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url === undefined || serviceKey === undefined) {
    return json({ error: 'server-misconfigured' }, 500);
  }

  // 서버/스케줄러(service_role 키)만 트리거 가능 — Bearer 토큰이 service key 와 일치해야 한다.
  const authHeader = req.headers.get('Authorization');
  const bearer = authHeader?.startsWith('Bearer ') === true ? authHeader.slice(7) : null;
  if (bearer !== serviceKey) {
    return json({ error: 'unauthorized' }, 401);
  }

  let limit = MAX_BATCH;
  try {
    const payload = (await req.json()) as { limit?: unknown };
    if (typeof payload.limit === 'number' && Number.isFinite(payload.limit)) {
      limit = Math.max(0, Math.min(MAX_BATCH, Math.trunc(payload.limit)));
    }
  } catch {
    // 본문 없음/파싱 실패 → 기본 배치 상한 사용(빈 POST 허용).
  }

  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  // (1) 검증 대상 선정: 이상치 플래그 계정 우선 + 랜덤 샘플(service_role RPC).
  const { data: rows, error: sampleErr } = await service.rpc('sample_pve_runs', { p_limit: limit });
  if (sampleErr !== null) {
    return json({ error: 'sample-failed', detail: sampleErr.message }, 500);
  }
  const batch = Array.isArray(rows) ? rows : [];

  // (2) 각 런 전수 재실행 → 판정 확정(+ 불일치 시 계정 플래그).
  const startedAt = Date.now();
  let verified = 0;
  let rejected = 0;
  let flagged = 0;
  for (const raw of batch) {
    const row = raw as { id?: unknown; replay?: unknown; client_result?: unknown };
    const runId = row.id;
    if (typeof runId !== 'string') continue;

    let status: 'verified' | 'rejected';
    try {
      const verdict = verifyPveRun({ replay: row.replay, client_result: row.client_result });
      status = verdict.verdict === 'accept' ? 'verified' : 'rejected';
    } catch (e) {
      // 손상 리플레이가 재실행에서 예외를 던지면 rejected 로 수렴(500 아님).
      console.error(`verify-pve-sample 재실행 예외 (run=${runId}):`, e);
      status = 'rejected';
    }

    const flagProfile = status === 'rejected';
    const { data: applied, error: applyErr } = await service.rpc('apply_pve_verification', {
      p_run_id: runId,
      p_status: status,
      p_verified_result: null,
      p_flag_profile: flagProfile,
    });
    if (applyErr !== null) {
      console.error(`verify-pve-sample 확정 실패 (run=${runId}):`, applyErr.message);
      continue;
    }
    if (status === 'verified') verified++;
    else rejected++;
    const res = (applied ?? {}) as { flagged?: boolean };
    if (res.flagged === true) flagged++;
  }

  const elapsed = Date.now() - startedAt;
  if (elapsed > SOFT_BATCH_BUDGET_MS) {
    console.warn(`verify-pve-sample 배치 벽시계 초과: ${elapsed}ms (checked=${batch.length})`);
  }

  return json({ checked: batch.length, verified, rejected, flagged }, 200);
});
