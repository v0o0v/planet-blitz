/**
 * verify-invasion Edge Function 진입점 (M4 Phase D → **ADR-0050 재실행 삭제 · 레인 B**).
 *
 * ⚠️ **재실행 검증은 삭제됐다(ADR-0050 §결정 1).** 이 파일은 더 이상 `src/sim` 을 import 하지
 * 않고, 리플레이를 재실행하지도, 방어 배치·hashStream 을 대조하지도 않는다(`defense-mismatch`·
 * `hash-stream-*` 사유 전부 소멸). 남는 것은 **재실행과 무관한 서버측 쓰기 권한**뿐이다 —
 * 래더 스왑·복제 약탈·`commission_grants` 류 발급은 여전히 service_role(이 함수)만 할 수 있다.
 *
 * 승패(`attackerWon`)는 이제 **클라이언트 주장을 그대로 신뢰**한다(ADR-0050 §4 "차단이 아니라
 * 위조 이득을 정직한 최상위 플레이어 수준으로 유계" 철학의 연장 — ADR-0003 복제 약탈이 방어자
 * 무손실을 보장하므로 래더 오염의 실피해가 낮다는 전제 위에 선다). **남기는 캡·정합성 검사**:
 * 호출자=공격자 본인 대조, 자기 침공 2중 차단(EF+`apply_invasion_result`), 이미 확정된 침공의
 * 멱등 반환, `apply_invasion_result` 내부의 재도전 쿨다운(1시간, SQL 미변경) — 전부 재실행과
 * 무관하게 서던 축이라 그대로 남긴다.
 *
 * sim 을 더 이상 싣지 않으므로 재배포는 이 파일 자체를 고쳤을 때로 줄어든다(ADR-0050 §1).
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

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
    .select('id, attacker_id, defender_id, client_result, verified_status, attacker_won')
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

  // (3) 승패 확정 — **클라이언트 주장을 그대로 신뢰한다**(재실행 대조 삭제, ADR-0050).
  // 클라 계약(worker-d-client)의 client_result shape: { attackerWon, coreDestroyed, finalTick, ... }.
  const cr = (inv.client_result ?? {}) as { attackerWon?: unknown };
  const attackerWon = cr.attackerWon === true;
  const verifiedResult = { source: 'client-claim', attackerWon } as const;

  // (4) 래더 스왑 + 복제 약탈 + verified_* 확정을 단일 트랜잭션(Postgres 함수)으로 원자 처리
  // (본문 미변경 — apply_invasion_result 는 재도전 쿨다운 등 재실행과 무관한 가드를 그대로 진다).
  const { data: applied, error: applyErr } = await service.rpc('apply_invasion_result', {
    p_invasion_id: invasionId,
    p_verified_result: verifiedResult,
    p_attacker_won: attackerWon,
  });
  if (applyErr !== null) {
    return json({ status: 'rejected', reason: 'apply-failed', detail: applyErr.message, attackerWon, ladder: null, loot: [] }, 500);
  }

  // apply_invasion_result 반환: { swapped, attacker_rank, defender_rank, loot,
  //   is_revenge, bonus_minerals, note? }. is_revenge/bonus_minerals 는 Phase F(F1
  //   복수전) 추가분 — 복수 침공이 자리 탈환에 성공하면 보너스 광물이 서버 save.minerals
  //   에 이미 가산됐고, 클라는 이 값으로 "복수 성공 +N 광물" 배너를 띄운다(additive 필드,
  //   기존 클라 무시해도 안전).
  const res = (applied ?? {}) as {
    swapped?: boolean;
    attacker_rank?: number | null;
    defender_rank?: number | null;
    loot?: unknown[];
    is_revenge?: boolean;
    bonus_minerals?: number;
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
  // (5) 방어 성공 보조 보상: 코어 모듈 드랍은 폐지됐다(ADR-0018) — apply_invasion_result 가
  // 방어 성공 분기에서 DEFENSE_SUCCESS_CREDITS 크레딧을 정액 지급하므로 EF 가 할 일이 없다.

  // (6) 설계도 약탈 복제(M7b) — 확정된 **공격자 승리**에 한해 12% 로 방어자가 배치한
  // 방어체 1종의 설계도 사본 1장을 공격자에게 준다. ADR-0003 방어자 무손실: 이 RPC 는
  // 방어자 데이터를 읽기만 한다(사본이 생길 뿐 방어자 것이 줄지 않는다).
  //
  // blueprint_raid_log(invasion_id PK)로 멱등이라 EF 재시도에도 두 번 지급되지 않는다.
  // service_role 전용 RPC 이므로 `service` 클라이언트로만 호출된다. 이 단계 실패는 침공
  // 확정(래더 스왑·약탈)을 되돌릴 이유가 못 되므로 응답을 막지 않고 경고만 남긴다.
  let blueprint: { kind: number; catalogId: number } | null = null;
  if (attackerWon) {
    const { data: bp, error: bpErr } = await service.rpc('loot_defense_blueprint', {
      p_invasion_id: invasionId,
    });
    if (bpErr !== null) {
      console.warn(`loot_defense_blueprint 실패 (invasion=${invasionId}):`, bpErr.message);
    } else {
      const b = (bp ?? {}) as {
        ok?: boolean;
        granted?: boolean;
        kind?: number | null;
        catalogId?: number | null;
      };
      if (b.ok === true && b.granted === true && typeof b.kind === 'number' && typeof b.catalogId === 'number') {
        blueprint = { kind: b.kind, catalogId: b.catalogId };
      }
    }
  }

  const ladder =
    res.swapped === true
      ? { attackerRank: res.attacker_rank ?? null, defenderRank: res.defender_rank ?? null }
      : null;
  return json(
    {
      status: 'verified',
      attackerWon,
      ladder,
      loot: res.loot ?? [],
      revenge: res.is_revenge === true,
      bonusMinerals: res.bonus_minerals ?? 0,
      // additive 필드 — 구 클라이언트는 무시해도 안전하다(결과 배너 표시용).
      blueprint,
    },
    200,
  );
});
