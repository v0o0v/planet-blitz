-- =============================================================================
-- Planet Blitz — PvE 리플레이 샘플링 검증 인프라 철거 (서버측, ADR-0026)
-- =============================================================================
-- 근거: ADR-0026(PvE 는 리플레이 전량 업로드·샘플링 재실행을 폐기하고, 정산 요약 + 3중 캡
--   settle_pve_run·grant_currency(20260726000200)만으로 방어한다 — ADR-0005 개정). 무료 티어
--   DB 용량이 리플레이 blob 적재를 감당하지 못하고, PvE 치팅의 최대 이득은 3중 캡으로 유계되며
--   래더 무결성은 침공 전수 검증이 단독으로 지키므로, PvE 샘플링 재검증의 순비용이 이득을
--   넘어섰다. 이 마이그레이션은 그 샘플링 경로(EF verify-pve-sample + RPC 2종 + cron)와, 정산
--   전환기의 임시 처리(settle_pve_run 의 replay/client_result 더미 삽입)를 걷어낸다.
--
-- ⚠️ 유지(건드리지 않음): 침공 전수 검증(verify-invasion·verify-run 코어·apply_invasion_result)
--   과 flag_pve_anomalies(집계 이상치 신호) + 그 cron(planet-blitz-flag-pve-anomalies)은
--   그대로 둔다 — 전자는 래더 무결성의 본선, 후자는 컬럼 읽기로 이미 정합한 무해한 2차 신호다.
--
-- 담는 것(순서 유의):
--   1. cron 해제 — planet-blitz-verify-pve-sample(20260718120000). 잡 부재 시 unschedule 이
--      에러나므로 do 블록으로 방어.
--   2. RPC 폐기 — sample_pve_runs(integer)·apply_pve_verification(uuid,text,jsonb,boolean).
--      sample_pve_runs 는 language sql 이라 pve_runs.replay/client_result 에 하드 의존
--      (20260718000000:105) → 4번 컬럼 드롭보다 **먼저** 드롭해야 의존성 에러가 안 난다.
--   3. settle_pve_run(jsonb) 재정의 — 20260726000200 본문을 복제하되, not-null 이던 replay/
--      client_result 를 만족시키려 더미 '{}'::jsonb 를 넣던 임시 삽입을 제거한다(요약·granted
--      컬럼만 insert). 시그니처·반환·나머지 로직은 동일.
--   4. pve_runs 컬럼 드롭 — replay·client_result. 3번이 컬럼 참조를 끊고 2번이 SQL 함수 의존을
--      제거한 **뒤**에 드롭한다. 컬럼과 함께 not-null 제약도 사라진다.
--
-- 재실행 안전: cron unschedule 은 do/exception 로 멱등, drop function/column 은 if exists,
--   settle_pve_run 은 create or replace(security definer + set search_path='' + public. 한정
--   + 끝에 revoke/grant 재적용). 부분 실패 후 재적용 수렴.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. verify-pve-sample cron 해제 (planet-blitz-verify-pve-sample, 20260718120000)
-- -----------------------------------------------------------------------------
-- EF 가 사라졌으므로 이 잡은 매일 404 를 POST 할 뿐이다. 잡이 이미 없으면 cron.unschedule 이
-- 에러를 던지므로 예외를 삼켜 멱등하게 만든다(pg_cron 미설치·미등록 환경 모두 통과).
do $$
begin
  perform cron.unschedule('planet-blitz-verify-pve-sample');
exception when others then
  null;  -- 잡 부재·pg_cron 미설치 → 무시(철거는 이미 목표 상태).
end $$;

-- -----------------------------------------------------------------------------
-- 2. 샘플링 RPC 폐기 (sample_pve_runs · apply_pve_verification, 20260718000000)
-- -----------------------------------------------------------------------------
-- verify-pve-sample EF 만 호출하던 service_role 전용 RPC. EF 철거로 호출자가 없다.
-- sample_pve_runs 를 먼저 드롭해야 아래 4번의 replay/client_result 컬럼 드롭이 SQL 함수
-- 의존성에 막히지 않는다(apply_pve_verification 은 plpgsql·컬럼 무참조라 순서 무관).
drop function if exists public.sample_pve_runs(integer);
drop function if exists public.apply_pve_verification(uuid, text, jsonb, boolean);

-- -----------------------------------------------------------------------------
-- 3. settle_pve_run 재정의 — 임시 replay/client_result 더미 삽입 제거 (ADR-0026)
-- -----------------------------------------------------------------------------
-- 20260726000200 의 settle_pve_run 본문과 동일하되, 정산 요약 이력 1행을 넣을 때 not-null
-- 제약(당시 잔존)을 만족시키려 replay/client_result 에 '{}'::jsonb 를 넣던 임시 코드를 뺀다.
-- 4번에서 그 두 컬럼을 드롭하므로 삽입 목록에서도 제거해야 한다. 재화 지급(3중 캡)·반환 계약은
-- 불변: grant_currency(source='pve_run') 로 지급 + pve_runs 요약 이력 1행(리플레이 없음).
create or replace function public.settle_pve_run(p_summary jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me             uuid := auth.uid();
  v_claim_credits  numeric;
  v_claim_minerals numeric;
  v_grant          jsonb;
begin
  if v_me is null then
    raise exception 'settle_pve_run: 로그인 필요';
  end if;

  -- 주장 자원 추출(비숫자/null 은 0). grant_currency 가 여기서 다시 정규화·캡하므로 1차 방어.
  v_claim_credits := case
    when (p_summary->>'resources') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (p_summary->>'resources')::numeric else 0 end;
  v_claim_minerals := case
    when (p_summary->>'minerals') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (p_summary->>'minerals')::numeric else 0 end;

  -- 재화 지급(3중 캡 강제). 중첩 definer 호출에서도 auth.uid() = 원 호출자라 본인에게 가산된다.
  v_grant := public.grant_currency(v_claim_credits, v_claim_minerals, 'pve_run', p_summary);

  -- 정산 요약 이력 1행(리플레이 없음, ADR-0026). replay/client_result 컬럼은 아래 4번에서 드롭.
  insert into public.pve_runs (
    profile_id, verified_status, verified_at,
    summary, credits_granted, minerals_granted
  )
  values (
    v_me, 'verified', now(),
    p_summary,
    coalesce((v_grant->>'granted_credits')::numeric, 0),
    coalesce((v_grant->>'granted_minerals')::numeric, 0)
  );

  return v_grant || jsonb_build_object('settled', true);
end;
$$;

revoke all on function public.settle_pve_run(jsonb) from public;
revoke all on function public.settle_pve_run(jsonb) from anon;
grant execute on function public.settle_pve_run(jsonb) to authenticated, service_role;

comment on function public.settle_pve_run(jsonb) is
  'PvE 런 정산: grant_currency(pve_run) 지급 + pve_runs 요약 이력 1행(리플레이 없음, ADR-0026). user JWT.';

-- -----------------------------------------------------------------------------
-- 4. pve_runs 컬럼 드롭 — replay · client_result (settle_pve_run 재정의·RPC 폐기 이후)
-- -----------------------------------------------------------------------------
-- 리플레이 blob(replay)과 클라 주장 증거(client_result)는 샘플링 재검증 전용이었다. 재검증이
-- 폐기됐으므로 저장할 이유가 없다(요약은 summary 컬럼에 남는다). 위 2·3번이 이 컬럼들에 대한
-- 모든 참조(SQL 함수 의존·함수 본문 삽입)를 끊은 뒤라 드롭이 안전하며, not-null 제약도 함께
-- 사라진다. pve_runs_pending_idx 부분 인덱스는 verified_status 기준이라 영향 없음.
alter table public.pve_runs drop column if exists replay;
alter table public.pve_runs drop column if exists client_result;
