/**
 * verify-invasion Edge Function 진입점 (M4 Phase D · D1/D2 · Deno.serve 래퍼).
 *
 * 침공 리플레이 전수 재실행 검증 + 통과 시 래더 스왑·복제 약탈(apply_invasion_result)
 * 원자 처리의 서버측 배선이다. 검증 순수 로직은 `verifyInvasionCore.ts`(플랫폼 전역
 * 무참조)에 있어 vitest·Deno 어디서나 테스트된다 — 이 파일은 HTTP·Auth·DB I/O만 맡는다.
 *
 * 계약(핸드오프 team-plan.md §D-1):
 *   요청:  POST { invasion_id: string }   (verify_jwt=true, 호출자 = 공격자 본인)
 *   응답:  { status: 'verified'|'rejected', attackerWon: boolean,
 *           ladder: { attackerRank, defenderRank } | null, loot: LootItem[], reason? }
 *
 * 서버 권위(원칙2):
 *   - 방어 배치는 클라이언트 제출이 아니라 **DB(defenses)에서 로드한 값**으로 재실행·대조.
 *   - verified_status/verified_result/attacker_won 확정과 래더 스왑·복제 약탈은
 *     service_role(이 함수)만 수행. 클라이언트 insert는 pending 증거일 뿐(스키마 가드 트리거).
 *
 * ⚠️ 재실행 시간예산(verify-run README 착수 조건 #3): 침공 입력 길이를
 *   `DEFAULT_TIME_LIMIT_TICKS`(3분=10800틱) 이내로 코어에서 상한한다(invasion-inputs-too-long).
 *   재실행은 동기 CPU라 AbortSignal.timeout으로 중단할 수 없으므로(동기 루프가 이벤트
 *   루프를 점유), 1차 DoS 방어선은 이 **입력 길이 상한**이다. 벽시계 초과는 사후 계측해
 *   경고 로그만 남긴다(중단 불가하나 관측은 남긴다).
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyInvasion } from './verifyInvasionCore.ts';
import type { InvasionVerifyResult } from './verifyInvasionCore.ts';
import { DEFAULT_TIME_LIMIT_TICKS, MAINTENANCE_FULL } from '../../../src/sim/defense.ts';

/** 재실행 벽시계 소프트 예산(ms). 초과 시 결과는 반환하되 경고 로그(중단은 불가). */
const SOFT_RERUN_BUDGET_MS = 8_000;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ status: 'rejected', reason: 'method-not-allowed', attackerWon: false, ladder: null, loot: [] }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (authHeader === null) {
    return json({ status: 'rejected', reason: 'missing-authorization', attackerWon: false, ladder: null, loot: [] }, 401);
  }

  let payload: { invasion_id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ status: 'rejected', reason: 'invalid-json', attackerWon: false, ladder: null, loot: [] }, 400);
  }
  const invasionId = payload.invasion_id;
  if (typeof invasionId !== 'string' || invasionId.length === 0) {
    return json({ status: 'rejected', reason: 'malformed-invasion-id', attackerWon: false, ladder: null, loot: [] }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (url === undefined || anonKey === undefined || serviceKey === undefined) {
    return json({ status: 'rejected', reason: 'server-misconfigured', attackerWon: false, ladder: null, loot: [] }, 500);
  }

  // (1) 호출자 식별: 요청 JWT로 auth.getUser() → 공격자 본인 확인용 uid.
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr !== null || userData.user === null) {
    return json({ status: 'rejected', reason: 'unauthenticated', attackerWon: false, ladder: null, loot: [] }, 401);
  }
  const callerId = userData.user.id;

  // (2) service_role 클라이언트로 침공 행 로드(RLS 우회).
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: inv, error: invErr } = await service
    .from('invasions')
    .select('id, attacker_id, defender_id, defense_id, replay, client_result, verified_status, attacker_won')
    .eq('id', invasionId)
    .maybeSingle();
  if (invErr !== null) {
    return json({ status: 'rejected', reason: 'invasion-load-failed', attackerWon: false, ladder: null, loot: [] }, 500);
  }
  if (inv === null) {
    return json({ status: 'rejected', reason: 'invasion-not-found', attackerWon: false, ladder: null, loot: [] }, 404);
  }
  // 호출자 = 공격자 본인만.
  if (inv.attacker_id !== callerId) {
    return json({ status: 'rejected', reason: 'not-attacker', attackerWon: false, ladder: null, loot: [] }, 403);
  }
  // (리뷰 CRITICAL 2중 차단) 자기 침공 금지 — 매치메이킹을 우회한 직접 insert 로
  // 자기(빈) 방어를 이겨 복제 약탈을 파밍하는 경로를 EF 계층에서도 끊는다(1차는
  // insert 가드 트리거, 3차는 apply_invasion_result). 방어적으로 rejected 확정까지.
  if (inv.attacker_id === inv.defender_id) {
    await service
      .from('invasions')
      .update({
        verified_status: 'rejected',
        attacker_won: false,
        verified_at: new Date().toISOString(),
      })
      .eq('id', invasionId)
      .eq('verified_status', 'pending');
    return json({ status: 'rejected', reason: 'self-invasion', attackerWon: false, ladder: null, loot: [] }, 400);
  }
  // 이미 확정된 침공은 재검증하지 않는다(멱등 — 확정 상태·확정 승패를 그대로 돌려준다.
  // 리뷰 LOW-5: attackerWon 을 null 이 아니라 확정된 attacker_won 값으로 반환해 클라
  // 결과 배너 오표시를 막는다).
  if (inv.verified_status !== 'pending') {
    return json(
      {
        status: inv.verified_status,
        attackerWon: inv.attacker_won === true,
        ladder: null,
        loot: [],
        reason: 'already-finalized',
      },
      200,
    );
  }

  // (3) 서버 권위 방어 배치 로드: 침공 스냅샷 defense_id 우선, 없으면 방어자 활성 방어.
  // raw jsonb 그대로 넘긴다 — 정규화·형태 검증은 검증 코어(normalizeServerLayout)가
  // 클라이언트와 동일 규칙으로 수행한다(리뷰 MED-3 대칭화).
  let layout: unknown = null;
  let maintenanceDb: unknown = null;
  if (inv.defense_id !== null) {
    const { data: def } = await service
      .from('defenses')
      .select('layout, maintenance')
      .eq('id', inv.defense_id)
      .maybeSingle();
    if (def !== null) {
      layout = def.layout;
      maintenanceDb = def.maintenance;
    }
  }
  if (layout === null) {
    const { data: def } = await service
      .from('defenses')
      .select('layout, maintenance')
      .eq('profile_id', inv.defender_id)
      .eq('active', true)
      .maybeSingle();
    if (def !== null) {
      layout = def.layout;
      maintenanceDb = def.maintenance;
    }
  }
  if (layout === null) {
    return json({ status: 'rejected', reason: 'defender-defense-missing', attackerWon: false, ladder: null, loot: [] }, 409);
  }

  // 방어 정비도(풍화, ADR-0006): DB numeric(5,2) 0~100 → 정수 centi-percent(0..10000).
  // 변환 공식은 클라이언트와 반드시 동일(Math.round(db*100)) — 어긋나면 정직 런이 오거부.
  // 로드 실패·비수치는 완전 정비(MAINTENANCE_FULL)로 폴백(기존 거동 보존).
  const maintNum = typeof maintenanceDb === 'number' ? maintenanceDb : Number(maintenanceDb);
  const maintenance = Number.isFinite(maintNum) ? Math.round(maintNum * 100) : MAINTENANCE_FULL;

  // (4) 제출(리플레이 + 클라이언트 주장)을 RunSubmission 형태로 조립.
  //
  // 클라 계약(worker-d-client)의 client_result shape:
  //   { attackerWon, coreDestroyed, finalTick, finalHash, hashStream }  (outcome 필드 없음)
  // 규약: finalState.victory === attackerWon === coreDestroyed. 침공은 종료 상태가
  // 승리(코어 파괴) 또는 게임오버(시간초과/격추) 중 하나로 수렴하므로 outcome 을
  // { victory: attackerWon, gameOver: !attackerWon } 로 사상해 검증 코어(RunClaim,
  // Phase A shape)에 넘긴다. 실제 래더 판정은 아래에서 서버 재실행 victory(verdict.
  // computed.outcome.victory)로 하며 클라 주장을 신뢰하지 않는다 — 이 사상은 클라가
  // 스스로 신고한 승패를 서버 재실행 결과와 교차 대조(outcome-mismatch)하는 용도다.
  // hashStream 전수 대조가 이미 매 틱 victory/gameOver 플래그까지 봉인하므로(hashWorld
  // 가 state.victory·state.gameOver 를 접는다) 이 사상은 보조 무결성 어서션이다.
  const replay = inv.replay as { seed?: unknown; config?: unknown; inputs?: unknown };
  const cr = (inv.client_result ?? {}) as {
    attackerWon?: unknown;
    finalHash?: unknown;
    hashStream?: unknown;
  };
  const attackerWonClaim = cr.attackerWon === true;
  const submission = {
    seed: replay.seed,
    config: replay.config,
    inputs: replay.inputs,
    claim: {
      finalHash: cr.finalHash,
      hashStream: cr.hashStream,
      outcome: { victory: attackerWonClaim, gameOver: !attackerWonClaim },
    },
  };

  // (5) 서버 권위로 전수 재실행 검증(방어 배치 대조 + 재실행 + 해시/결과 대조).
  // try/catch(리뷰 MED-3): 손상된 서버 layout 이 정규화 게이트를 지나도 재실행에서
  // 예외를 던지면 500 이 아니라 명시적 rejected(server-layout-invalid)로 수렴시킨다.
  const startedAt = Date.now();
  let verdict: InvasionVerifyResult;
  try {
    verdict = verifyInvasion(submission, { layout, timeLimitTicks: DEFAULT_TIME_LIMIT_TICKS, maintenance });
  } catch (e) {
    console.error(`verify-invasion 재실행 예외 (invasion=${invasionId}):`, e);
    verdict = { verdict: 'reject', reason: 'server-layout-invalid' };
  }
  const elapsed = Date.now() - startedAt;
  if (elapsed > SOFT_RERUN_BUDGET_MS) {
    console.warn(`verify-invasion 재실행 벽시계 초과: ${elapsed}ms (invasion=${invasionId})`);
  }

  const verifiedResult = verdict.computed ?? null;

  if (verdict.verdict === 'reject') {
    // 위조·불일치: rejected로 확정(결과 필드는 서버 재실행 사실로 기록). 래더 미변동.
    await service
      .from('invasions')
      .update({
        verified_status: 'rejected',
        verified_result: verifiedResult,
        attacker_won: false,
        verified_at: new Date().toISOString(),
      })
      .eq('id', invasionId)
      .eq('verified_status', 'pending');
    return json({ status: 'rejected', reason: verdict.reason, attackerWon: false, ladder: null, loot: [] }, 200);
  }

  // (6) 검증 통과: 래더 스왑 + 복제 약탈 + verified_* 확정을 단일 트랜잭션(Postgres
  // 함수)으로 원자 처리. attacker_won은 서버 재실행 최종 상태(victory)로 판정한다.
  const attackerWon = verdict.computed?.outcome.victory ?? false;
  const { data: applied, error: applyErr } = await service.rpc('apply_invasion_result', {
    p_invasion_id: invasionId,
    p_verified_result: verifiedResult,
    p_attacker_won: attackerWon,
  });
  if (applyErr !== null) {
    return json({ status: 'rejected', reason: 'apply-failed', detail: applyErr.message, attackerWon, ladder: null, loot: [] }, 500);
  }

  // apply_invasion_result 반환: { swapped, attacker_rank, defender_rank, loot, note? }.
  const res = (applied ?? {}) as {
    swapped?: boolean;
    attacker_rank?: number | null;
    defender_rank?: number | null;
    loot?: unknown[];
    note?: string;
  };
  // (리뷰 HIGH-2) 제출 경로 쿨다운 위반: apply_invasion_result 가 확정 직전에 최근
  // 1시간 동일 대상 침공을 검사해 rejected 로 확정하고 note 로 알린다 — 클라에는
  // rejected 로 응답(래더·약탈 미적용).
  if (res.note === 'cooldown-violation') {
    return json(
      { status: 'rejected', reason: 'cooldown-violation', attackerWon: false, ladder: null, loot: [] },
      200,
    );
  }
  const ladder =
    res.swapped === true
      ? { attackerRank: res.attacker_rank ?? null, defenderRank: res.defender_rank ?? null }
      : null;
  return json(
    { status: 'verified', attackerWon, ladder, loot: res.loot ?? [] },
    200,
  );
});
