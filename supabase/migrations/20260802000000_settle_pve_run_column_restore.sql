-- =============================================================================
-- settle_pve_run 복구 — 드롭된 컬럼 참조 제거 + 촉매 영수증 관통 재통합
-- =============================================================================
-- ▮ 무엇이 깨져 있었나 (2026-07-31 원격 실측)
--   20260726000300(pve_verification_teardown)이 pve_runs 에서 replay·client_result 를 드롭했다.
--   드롭 직전 재정의한 settle_pve_run 은 그 참조를 지워 정합했고, 다음 개정
--   20260727000000(catalyst_ledger)도 컬럼 없는 본문을 유지했다. 그런데 그 다음 개정
--   20260727010000(planet_popularity)이 **드롭 이전 본문(20260726000200)을 기준으로 복제**되어
--   두 컬럼을 다시 INSERT 하기 시작했다. 그 뒤로 재정의가 없으므로 이것이 라이브 정의다.
--
--   결과(원격에서 실제 호출해 확인):
--     ERROR 42703  column "replay" of relation "pve_runs" does not exist
--   즉 **온라인 PvE 정산이 100% 실패**한다. pve_runs 최신 행이 2026-07-26 18:13(=teardown 적용
--   직후)에서 멈춰 있는 것이 그 흔적이다. 클라(src/net/gateway.ts settlePveRun)는 RPC 오류를
--   거부로 처리하므로 화면은 조용하고, 플레이어는 자원·광물을 한 톨도 못 받는다.
--
--   같은 복제로 **함께 유실된 것**(이쪽이 더 조용하다):
--     · runId → pve_runs.catalyst_receipt.resourceMult 조회 → grant_currency 캡 상향 관통
--     · pending 런의 1회성 봉인(verified 로 UPDATE) — 없으면 consume_catalysts 가 만든 pending 행이
--       영원히 pending 으로 남고, 촉매를 소모하고도 배율을 못 받는다
--     · set_config('app.in_settle') — grant_currency 가 resourceMult 를 읽는 유일한 조건
--
-- ▮ 이 마이그레이션이 하는 일
--   20260727000000(촉매 관통 본문)과 20260727010000(행성 인기 배율)을 **합쳐** 재정의한다.
--   두 배율은 축이 다르고 독립이다:
--     · 행성 인기(v_mult)  → metrics.finalTick 을 배로 실어 개연성 캡 상한을 넓힌다(+감사용
--       planetMultCenti). grant_currency 는 planetMultCenti 를 읽지 않는다(기록 전용).
--     · 촉매 영수증(resourceMult) → grant_currency 가 pve_run 경로 + app.in_settle 플래그에서만
--       읽어 개연성 캡·per-call 캡을 상향한다.
--   어느 한쪽이 없으면 각 원본과 정확히 같게 동작한다(무촉매 런·epoch 미지정 런 = 배율 1).
--   INSERT 컬럼 목록에서 replay·client_result 를 제거한 것이 결함 수정의 본체다.
--
-- ▮ 재적용 안전(create or replace 만) · 롤백은 20260727000000 §7 본문 재적용.
-- =============================================================================

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
  v_epoch          bigint;
  v_cur_epoch      bigint := floor(extract(epoch from now()) / 1800)::bigint;
  v_planet         int;
  v_mult           numeric := 1;
  v_run_id         uuid;
  v_receipt_mult   numeric;
  v_metrics        jsonb;
  v_grant          jsonb;
begin
  if v_me is null then
    raise exception 'settle_pve_run: 로그인 필요';
  end if;

  -- 주장 자원 추출(비숫자/null 은 0). grant_currency 가 다시 정규화·캡하므로 1차 방어.
  v_claim_credits := case
    when (p_summary->>'resources') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (p_summary->>'resources')::numeric else 0 end;
  v_claim_minerals := case
    when (p_summary->>'minerals') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (p_summary->>'minerals')::numeric else 0 end;

  -- 클라가 심었을 수 있는 resourceMult 를 제거한다(서버 영수증만 신뢰 = 위조 방지). 무촉매/GC 경로는
  -- 이 제거로 배율이 실리지 않고 grant_currency 가 1 로 처리한다.
  v_metrics := p_summary - 'resourceMult';

  -- ── 행성 인기 배율(ADR-0038) — **현재/직전 epoch 만** 인정한다. 30분 슬롯 경계에서 시작해
  --    경계 뒤에 끝난 런이 정당하게 정산되도록 직전까지 허용하고, 그보다 오래된 epoch 은 1.0 이다.
  v_epoch := case
    when (p_summary->>'epoch') ~ '^[0-9]+$' then (p_summary->>'epoch')::bigint else null end;
  v_planet := case
    when (p_summary->>'planet') ~ '^[0-9]+$' then (p_summary->>'planet')::int else null end;
  if v_epoch is not null and v_planet is not null and v_epoch >= v_cur_epoch - 1 then
    select pp.mult_centi / 100.0 into v_mult
      from public.planet_popularity pp
      where pp.epoch = v_epoch and pp.planet = v_planet;
    v_mult := coalesce(v_mult, 1);
  end if;

  -- 개연성 캡(grant_currency ①)은 metrics.finalTick 에서 산정되므로, 배율만큼 **상한을 넓히려면**
  -- 그 입력을 배율 배로 실어 준다. 지급액은 여전히 min(주장액, 캡들) 이라 배율이 지급을 **만들지
  -- 않는다** — 정직한 클라의 정당한 주장이 클램프되지 않게 할 뿐이다.
  v_metrics := v_metrics || jsonb_build_object(
    'finalTick', (case
      when (p_summary->>'finalTick') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_summary->>'finalTick')::numeric else 0 end) * v_mult,
    'planetMultCenti', round(v_mult * 100)
  );

  -- ── 촉매 영수증(ADR-0029/0042) — runId(uuid) 파싱. 형식 불일치는 무촉매 경로로 취급.
  v_run_id := case
    when (p_summary->>'runId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (p_summary->>'runId')::uuid else null end;

  if v_run_id is not null then
    -- pending 촉매 런 조회 + 잠금(본인·pending 만). 1회성 봉인: 이미 verified 면 not found → 무배율.
    select coalesce((catalyst_receipt->>'resourceMult')::numeric, 1)
      into v_receipt_mult
      from public.pve_runs
      where id = v_run_id and profile_id = v_me and verified_status = 'pending'
      for update;
    if found then
      -- 서버 영수증 배율을 metrics 에 얹는다(grant_currency 가 pve_run 캡에 관통 적용).
      v_metrics := v_metrics || jsonb_build_object('resourceMult', coalesce(v_receipt_mult, 1));
    else
      v_run_id := null;  -- pending 부재(GC/재사용/위조 runId) → 무배율 base 경로.
    end if;
  end if;

  -- 정상 정산 경로 표시(트랜잭션-로컬 GUC) — grant_currency 가 resourceMult 를 이 플래그가 있을 때만
  -- 읽어, 클라의 grant_currency 직접호출(settle 우회)로 배율을 얻는 경로를 차단한다(보안 MEDIUM-1).
  perform set_config('app.in_settle', '1', true);

  -- 재화 지급(3중 캡 강제). 중첩 definer 호출에서도 auth.uid()=원 호출자라 본인에게 가산.
  v_grant := public.grant_currency(v_claim_credits, v_claim_minerals, 'pve_run', v_metrics);

  -- 플래그 즉시 해제 — 배율 적용 창을 위 grant 1회로 최소화한다.
  perform set_config('app.in_settle', '', true);

  -- ⚠️ 아래 두 경로 모두 summary 에는 **원본 p_summary** 를 넣는다 — v_metrics 는 캡 산정용 파생이라,
  --    이걸 저장하면 refresh_planet_popularity 의 집계 입력(summary->>'planet')이 오염된다.
  -- ⚠️ replay·client_result 는 20260726000300 이 드롭했다. 절대 다시 넣지 마라(이 마이그레이션의 결함).
  if v_run_id is not null then
    -- UPSERT-by-runId: pending 행을 verified 로 1회성 봉인(재사용 거부는 위 조회 게이트가 담당).
    update public.pve_runs
      set verified_status  = 'verified',
          verified_at      = now(),
          summary          = p_summary,
          credits_granted  = coalesce((v_grant->>'granted_credits')::numeric, 0),
          minerals_granted = coalesce((v_grant->>'granted_minerals')::numeric, 0)
      where id = v_run_id and profile_id = v_me and verified_status = 'pending';
  else
    -- 무촉매 런(runId 없음) 또는 pending 부재/GC → 새 verified 요약 행 INSERT(리플레이 없음).
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
  end if;

  return v_grant || jsonb_build_object('settled', true);
end;
$$;

revoke all on function public.settle_pve_run(jsonb) from public;
revoke all on function public.settle_pve_run(jsonb) from anon;
grant execute on function public.settle_pve_run(jsonb) to authenticated, service_role;

comment on function public.settle_pve_run(jsonb) is
  'PvE 정산: 행성 인기 배율(epoch) + 촉매 영수증 배율(runId)로 캡 상향 후 grant_currency 지급, pve_runs 요약 1행. replay/client_result 컬럼은 드롭됨 — 참조 금지.';
