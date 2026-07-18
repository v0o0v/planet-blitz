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
import { verifyInvasion, injectGuardianAuthority, resolveSnapshotAuthority } from './verifyInvasionCore.ts';
import type {
  InvasionVerifyResult,
  AuthoritativeGuardianRow,
  InvasionSnapshotRow,
} from './verifyInvasionCore.ts';
import { DEFAULT_TIME_LIMIT_TICKS, MAINTENANCE_FULL } from '../../../src/sim/defense.ts';
import { MAX_GUARDIAN_SLOTS } from '../../../data/guardian.ts';

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
    .select('id, attacker_id, defender_id, defense_id, snapshot_id, replay, client_result, verified_status, attacker_won')
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

  // (3) 서버 권위 방어 배치 로드.
  //
  // ▮ 침공 권위 스냅샷 경로(M5 — 레이스 B 완전 폐쇄): invasions.snapshot_id 가 있으면
  //   begin_invasion 이 T0 에 고정한 불변 권위(수호 주입 완료 layout + 정비도)를 검증 입력으로
  //   쓴다. 소유권(attacker_id·defense_id 대조)·신선도(1시간)·재사용은 순수
  //   resolveSnapshotAuthority 가 판정하고, 하나라도 어긋나면 라이브 경로로 폴백한다(회귀 0·
  //   보안 무영향 — 폴백은 항상 검증 시점 라이브 재대조라 위조 accept 불가). 유효 스냅샷이면
  //   라이브 수호 재주입(3.5)을 생략한다(고정본이 이미 T0 권위를 담음 → dismiss/retire/풍화 무영향).
  // ▮ 라이브 경로(현행): snapshot_id 없음/무효면 defense_id → 방어자 활성 방어 순으로 로드하고
  //   라이브 수호를 재주입(3.5)한다(스냅샷 미배선·구버전 제출 하위호환).
  // raw jsonb 그대로 넘긴다 — 정규화·형태 검증은 검증 코어(normalizeServerLayout)가
  // 클라이언트와 동일 규칙으로 수행한다(리뷰 MED-3 대칭화).
  let layout: unknown = null;
  let maintenanceDb: unknown = null;
  let authorityFromSnapshot = false;

  const snapshotId = typeof inv.snapshot_id === 'string' && inv.snapshot_id.length > 0 ? inv.snapshot_id : null;
  if (snapshotId !== null) {
    const { data: snapRow } = await service
      .from('invasion_snapshots')
      .select('attacker_id, defense_id, authority, created_at')
      .eq('id', snapshotId)
      .maybeSingle();
    // 재사용 방어적 2차선(DB 부분 유니크 인덱스 invasions_snapshot_unique 가 1차 원자 강제):
    // 같은 snapshot_id 를 쓰는 다른 확정(pending 아님) invasion 이 이미 있는가.
    const { data: dupRows } = await service
      .from('invasions')
      .select('id')
      .eq('snapshot_id', snapshotId)
      .neq('id', invasionId)
      .neq('verified_status', 'pending')
      .limit(1);
    const reused = Array.isArray(dupRows) && dupRows.length > 0;

    let snapshot: InvasionSnapshotRow | null = null;
    if (snapRow !== null) {
      const authority = (snapRow.authority ?? {}) as { layout?: unknown; maintenance?: unknown };
      const mRaw = authority.maintenance;
      const mNum = typeof mRaw === 'number' ? mRaw : Number(mRaw);
      snapshot = {
        attackerId: typeof snapRow.attacker_id === 'string' ? snapRow.attacker_id : '',
        defenseId: typeof snapRow.defense_id === 'string' ? snapRow.defense_id : null,
        authorityLayout: authority.layout ?? null,
        authorityMaintenanceDb: Number.isFinite(mNum) ? mNum : undefined,
        createdAtMs: typeof snapRow.created_at === 'string' ? Date.parse(snapRow.created_at) : Number.NaN,
      };
    }
    const resolution = resolveSnapshotAuthority({
      invasionSnapshotId: snapshotId,
      invasionAttackerId: inv.attacker_id,
      invasionDefenseId: inv.defense_id,
      snapshot,
      nowMs: Date.now(),
      reused,
    });
    if (resolution.source === 'snapshot' && resolution.layout !== null && resolution.layout !== undefined) {
      layout = resolution.layout;
      maintenanceDb = resolution.maintenanceDb ?? null;
      authorityFromSnapshot = true;
    } else if (resolution.source === 'snapshot') {
      // 스냅샷 행은 유효하나 authority.layout 이 손상(null) → 안전하게 라이브 경로 폴백.
      console.log(`verify-invasion 스냅샷 layout 손상 폴백(invasion=${invasionId})`);
    } else {
      console.log(`verify-invasion 스냅샷 폴백(invasion=${invasionId}): ${resolution.reason}`);
    }
  }

  if (!authorityFromSnapshot && inv.defense_id !== null) {
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

  // (3.5) 서버 권위 수호 주입(M5 — 정비도 주입과 동일 패턴). 방어 배치 수호 슬롯의 성능%·계보
  // 보너스·스냅샷을 **공격자 제출 config 가 아니라 DB(guardians·profiles)에서 권위 주입**한다.
  // 슬롯 위치(x/y)는 저장된 layout 에서(방어자 배치 결정), 성능(풍화)·보너스(계보 레벨)·스냅샷은
  // 라이브 DB 에서. 이후 verifyInvasion 이 이 권위 layout 으로 공격자 제출을 대조하므로(guardiansEqual),
  // 방치 수호를 신선하다 주장하거나 계보 보너스를 부풀린 위조는 defense-mismatch 로 거부된다.
  //
  // 조회 순서 created_at→id 는 클라 buildGuardianPlacements 가 소비하는 활성 수호 순서(클라
  // fetchGuardians 동일 정렬)와 일치해야 슬롯 i↔수호 i 매핑이 클라·서버 비트 동일하다.
  // 저장 layout 에 수호 슬롯이 없으면(수호 미포함 방어) 조회 자체를 건너뛴다 → 기존 침공 거동 불변.
  // ★스냅샷 경로(authorityFromSnapshot)는 begin_invasion 이 T0 에 이미 라이브 수호 권위를
  //   접어 넣은 고정본이므로 재주입을 생략한다(재주입하면 T1 라이브로 덮여 레이스 B 재발).
  const rawGuardianSlots = (layout as { guardians?: unknown }).guardians;
  if (!authorityFromSnapshot && Array.isArray(rawGuardianSlots) && rawGuardianSlots.length > 0) {
    const { data: gRows } = await service
      .from('guardians')
      .select('data, performance, created_at, id')
      .eq('profile_id', inv.defender_id)
      .eq('retired', false)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_GUARDIAN_SLOTS);
    const { data: prof } = await service
      .from('profiles')
      .select('lineage_guardian_level')
      .eq('id', inv.defender_id)
      .maybeSingle();
    const rows: AuthoritativeGuardianRow[] = Array.isArray(gRows)
      ? gRows.map((r) => {
          const rr = r as { data?: unknown; performance?: unknown };
          return { data: rr.data, performance: Number(rr.performance) };
        })
      : [];
    const lvlRaw = (prof as { lineage_guardian_level?: unknown } | null)?.lineage_guardian_level;
    const level = typeof lvlRaw === 'number' && Number.isFinite(lvlRaw) ? lvlRaw : 0;
    layout = injectGuardianAuthority(layout, rows, level);
  }

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
    },
    200,
  );
});
