-- =============================================================================
-- Planet Blitz — PvE 정산 서버 RPC + 재화 grant/spend 원장 + 3중 캡 (ADR-0026 · ADR-0027)
-- =============================================================================
-- 근거: ADR-0005 원칙2(서버 권위) · ADR-0026(PvE 리플레이 업로드·샘플링 재검증 폐기, 정산은
--   서버 RPC 로 재화만 클램프 지급) · ADR-0027(재화 서버 원장) · handoff currency-authority-design.md.
--   worker-currency(20260726000000)가 profiles.credits/minerals 를 서버 권위 컬럼으로 분리하고
--   클라 write 를 guard 트리거로 봉인한 위에, 이 파일은 **재화가 서버 경로로만 늘어나도록**
--   grant/spend RPC 와 원장·3중 캡을 얹는다. 클라의 자원 주장액은 서버가 재산정(클램프)한다.
--
-- 담는 것:
--   1. currency_grants — 재화 가산 원장(누적 캡 근거 + 이상치 신호). 본인 select 만, 7일 GC.
--   2. grant_currency(user JWT) — 3중 캡(개연성·per-call·누적)으로 주장액을 클램프해 가산.
--      극단 초과는 profiles.flagged=true.
--   3. settle_pve_run(user JWT) — 정산 요약을 grant_currency(source='pve_run')로 지급 +
--      pve_runs 에 요약 이력 1행(리플레이 없음). 7일 GC.
--   4. spend_currency(user JWT) — 잔액 확인 후 컬럼 차감(음수 방어). 리스펙·스태시·리롤 sink.
--
-- ▮ 서버 권위 경계(worker-currency 와 동일 규율): 이 파일의 RPC 는 전부 security definer(소유자
--   postgres)라 실행 중 current_user=postgres → is_service_role()=true → guard_profiles_client_*
--   트리거를 통과해 credits/minerals/flagged 를 정당하게 갱신한다. 호출자 식별은 auth.uid()
--   (JWT 클레임)로, 중첩 호출(settle_pve_run → grant_currency)에서도 원 호출자 uid 가 유지된다.
--
-- ▮ 캡 상수 placeholder(전부 출시 전 밸런스 튜닝 대상 — defer-balance-tuning): 실제 수치는
--   보수적 잠정값이다. 아래 목록이 의미 정본이며, grant_currency 의 DECLARE 블록에 constant 로
--   미러링돼 있다(둘을 함께 갱신할 것):
--     · CAP_PVE_RUN_CREDITS / CAP_PVE_RUN_MINERALS = 5000 / 5000
--         — pve_run 1회 지급 상한(②). 긴 런도 이 상한을 넘지 못한다.
--     · CAP_SALVAGE_CREDITS / CAP_SALVAGE_MINERALS = 20000 / 20000
--         — 대량 분해(살베지) 1회 상한(②). 여러 아이템 일괄이라 크게 잡음.
--     · CAP_STORY_CREDITS = 2000 (minerals 0)
--         — 사연 챕터 보상 1회 상한(②). 소액 고정, 광물은 지급하지 않음.
--     · CAP_DEFAULT_CREDITS / CAP_DEFAULT_MINERALS = 1000 / 1000
--         — 미등록 source 의 보수적 per-call 상한(무제한 금지).
--     · CAP_HOURLY_CREDITS / CAP_HOURLY_MINERALS = 50000 / 50000    — 최근 1h 누적 상한(③).
--     · CAP_DAILY_CREDITS  / CAP_DAILY_MINERALS  = 300000 / 300000  — 최근 24h 누적 상한(③).
--     · PLAUSIBILITY_CREDITS_PER_TICK / PLAUSIBILITY_MINERALS_PER_TICK = 2.0 / 2.0
--         — 개연성 계수(①). 상한 = 계수 × finalTick × (1 + stage). 성과(틱·스테이지) 없이
--           큰 자원 주장을 차단한다(finalTick=0 이면 상한 0 → 지급 0).
--     · FLAG_MULTIPLE = 10 — 주장액이 유효 상한(개연성·per-call)의 이 배수를 넘으면 계정 플래그.
--
-- 재실행 안전: create table/index if not exists · drop policy if exists → create ·
--   create or replace function · add column if not exists · cron.schedule(잡명 upsert) ·
--   security definer + set search_path='' + public. 한정 + 끝에 revoke/grant.
-- =============================================================================

-- gen_random_uuid() — 초기 스키마에서 이미 선언됐으나 단독 재적용 안전을 위해 재선언.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. currency_grants — 재화 가산 원장(누적 캡 근거 + 이상치 신호)
-- -----------------------------------------------------------------------------
-- grant_currency 가 실제 지급한 액수를 source 별로 남긴다. ③ 누적 캡은 이 원장의 최근 1h/24h
-- 합으로 산정하고, 서버는 이 원장으로 시간당/일일 가산 이상치를 관측한다(flag_pve_anomalies
-- 의 집계 기반 판정을 보완). 클라이언트는 표시용 select 만 — insert/update/delete 정책 부재로
-- 클라 직접 기록을 원천 차단하고, 서버 RPC(정의 소유자 postgres, RLS 우회)만 기록한다.
create table if not exists public.currency_grants (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  source      text        not null,
  credits     numeric     not null default 0,
  minerals    numeric     not null default 0,
  created_at  timestamptz not null default now()
);

-- 누적 캡 조회(profile 의 최근순 합산)와 본인 이력 표시를 함께 태우는 인덱스.
create index if not exists currency_grants_profile_idx
  on public.currency_grants (profile_id, created_at desc);

alter table public.currency_grants enable row level security;

-- 읽기: 본인 원장만(재화 획득 내역 표시용). 쓰기 정책 **부재** → 클라 직접 insert/update/delete
-- 불가(원장 위조 차단). 서버 RPC(service_role/definer)만 RLS 우회로 기록한다.
drop policy if exists currency_grants_select_own on public.currency_grants;
create policy currency_grants_select_own
  on public.currency_grants for select
  to authenticated
  using (auth.uid() = profile_id);

-- -----------------------------------------------------------------------------
-- 2. grant_currency — 3중 캡으로 클라 주장액을 클램프해 가산 (user JWT, SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- 호출자(auth.uid()) 본인에게 재화를 가산한다. 클라가 주장한 p_credits/p_minerals 는 그대로
-- 반영하지 않고, 세 캡의 최소값까지만 지급한다("서버 재계산" = 지급액 재산정):
--   ① 개연성 캡(pve_run 한정): 상한 = 계수 × finalTick × (1+stage). 성과 없는 주장 차단.
--   ② per-call 캡: source 별 1회 상한.
--   ③ 누적 캡: currency_grants 의 최근 1h·24h 합 → 남은 예산(각각의 잔여 중 작은 쪽).
-- 지급 = greatest(0, least(주장액, ①, ②, 남은③)). least 는 NULL 인자를 무시하므로, 개연성
-- 캡이 비적용(비-pve_run)이면 NULL 로 두어 자연히 제외된다.
-- 프로필 행을 먼저 for update 로 잠가 read-modify-write(원장 합산→가산)를 유저 단위 직렬화한다
-- (동시 호출이 같은 예산을 이중 사용하는 lost-update 차단 — repair_defense MED-2 패턴).
create or replace function public.grant_currency(
  p_credits  numeric,
  p_minerals numeric,
  p_source   text,
  p_metrics  jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 캡 상수(placeholder — 파일 상단 배너가 의미 정본, 함께 갱신). 출시 전 밸런스 튜닝 대상.
  CAP_PVE_RUN_CREDITS    constant numeric := 5000;
  CAP_PVE_RUN_MINERALS   constant numeric := 5000;
  CAP_SALVAGE_CREDITS    constant numeric := 20000;
  CAP_SALVAGE_MINERALS   constant numeric := 20000;
  CAP_STORY_CREDITS      constant numeric := 2000;
  CAP_DEFAULT_CREDITS    constant numeric := 1000;
  CAP_DEFAULT_MINERALS   constant numeric := 1000;
  CAP_HOURLY_CREDITS     constant numeric := 50000;
  CAP_HOURLY_MINERALS    constant numeric := 50000;
  CAP_DAILY_CREDITS      constant numeric := 300000;
  CAP_DAILY_MINERALS     constant numeric := 300000;
  PLAUSIBILITY_CREDITS_PER_TICK  constant numeric := 2.0;
  PLAUSIBILITY_MINERALS_PER_TICK constant numeric := 2.0;
  FLAG_MULTIPLE          constant numeric := 10;

  v_me            uuid := auth.uid();
  v_claim_credits   numeric;
  v_claim_minerals  numeric;
  v_final_tick    numeric := 0;
  v_stage         numeric := 0;
  v_plaus_credits   numeric := null;   -- ① null = 비적용(비-pve_run) → least 에서 무시됨.
  v_plaus_minerals  numeric := null;
  v_call_credits    numeric;           -- ② per-call 상한.
  v_call_minerals   numeric;
  v_1h_credits    numeric := 0;        -- ③ 최근 1h 원장 합.
  v_1h_minerals   numeric := 0;
  v_24h_credits   numeric := 0;        -- ③ 최근 24h 원장 합.
  v_24h_minerals  numeric := 0;
  v_rem_credits     numeric;           -- ③ 남은 예산(1h·24h 잔여 중 작은 쪽).
  v_rem_minerals    numeric;
  v_ref_credits     numeric;           -- 극단 초과 판정 기준(개연성·per-call 중 작은 유효 상한).
  v_ref_minerals    numeric;
  v_grant_credits   numeric;
  v_grant_minerals  numeric;
  v_credits_left    numeric := 0;
  v_minerals_left   numeric := 0;
  v_clamped       boolean := false;
  v_flag          boolean := false;
begin
  if v_me is null then
    raise exception 'grant_currency: 로그인 필요';
  end if;

  -- 주장액 정규화(음수·null 방어 — 재화 창조/차감 방향 오용 차단).
  v_claim_credits  := greatest(0, coalesce(p_credits, 0));
  v_claim_minerals := greatest(0, coalesce(p_minerals, 0));

  -- ① 개연성 캡: pve_run 만. p_metrics 의 finalTick·stage 로 상한을 산정한다. 값이 비숫자/null
  --   이면 0 으로 본다(성과 없는 주장은 상한 0 → 지급 0). 비-pve_run 은 null 로 두어 미적용.
  if p_source = 'pve_run' then
    v_final_tick := greatest(0, case
      when (p_metrics->>'finalTick') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_metrics->>'finalTick')::numeric else 0 end);
    v_stage := greatest(0, case
      when (p_metrics->>'stage') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_metrics->>'stage')::numeric else 0 end);
    v_plaus_credits  := PLAUSIBILITY_CREDITS_PER_TICK  * v_final_tick * (1 + v_stage);
    v_plaus_minerals := PLAUSIBILITY_MINERALS_PER_TICK * v_final_tick * (1 + v_stage);
  end if;

  -- ② per-call 캡: source 별 1회 상한. 미등록 source 는 보수적 기본 상한(무제한 금지).
  case p_source
    when 'pve_run' then v_call_credits := CAP_PVE_RUN_CREDITS;  v_call_minerals := CAP_PVE_RUN_MINERALS;
    when 'salvage' then v_call_credits := CAP_SALVAGE_CREDITS;  v_call_minerals := CAP_SALVAGE_MINERALS;
    when 'story'   then v_call_credits := CAP_STORY_CREDITS;    v_call_minerals := 0;  -- 사연은 크레딧만.
    else                v_call_credits := CAP_DEFAULT_CREDITS;  v_call_minerals := CAP_DEFAULT_MINERALS;
  end case;

  -- 프로필 행 잠금(원장 합산→가산 직렬화). 로그인 유저는 항상 프로필이 있어야 하나, 없으면
  -- 지급 0 으로 방어 반환(잔액도 0 — 있지도 않은 잔액을 미러에 심지 않음).
  perform 1 from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object(
      'granted_credits', 0, 'granted_minerals', 0,
      'credits_left', 0, 'minerals_left', 0,
      'clamped', (v_claim_credits > 0 or v_claim_minerals > 0),
      'note', 'no-profile'
    );
  end if;

  -- ③ 누적 캡: 원장에서 최근 1h·24h 실지급 합을 읽어 남은 예산을 만든다. 이 호출 자신의
  --   가산은 아직 원장에 없으므로(아래에서 insert) 직전 상태 기준으로 예산을 산정한다.
  select coalesce(sum(credits), 0), coalesce(sum(minerals), 0)
    into v_1h_credits, v_1h_minerals
    from public.currency_grants
    where profile_id = v_me and created_at > now() - interval '1 hour';
  select coalesce(sum(credits), 0), coalesce(sum(minerals), 0)
    into v_24h_credits, v_24h_minerals
    from public.currency_grants
    where profile_id = v_me and created_at > now() - interval '24 hours';

  -- 남은 예산 = 1h·24h 잔여 중 더 빡빡한 쪽(둘 다 만족해야 하므로 min).
  v_rem_credits := least(
    greatest(0, CAP_HOURLY_CREDITS - v_1h_credits),
    greatest(0, CAP_DAILY_CREDITS  - v_24h_credits)
  );
  v_rem_minerals := least(
    greatest(0, CAP_HOURLY_MINERALS - v_1h_minerals),
    greatest(0, CAP_DAILY_MINERALS  - v_24h_minerals)
  );

  -- 지급액 = 세 캡의 최소(least 는 NULL=비적용 개연성 캡을 무시). 음수 방어로 greatest(0, ..).
  v_grant_credits  := greatest(0, least(v_claim_credits,  v_plaus_credits,  v_call_credits,  v_rem_credits));
  v_grant_minerals := greatest(0, least(v_claim_minerals, v_plaus_minerals, v_call_minerals, v_rem_minerals));

  v_clamped := (v_grant_credits < v_claim_credits) or (v_grant_minerals < v_claim_minerals);

  -- 극단 초과 판정(계정 플래그) — 정직 유저의 누적 캡 소진을 오탐하지 않도록 ③ 누적 예산은
  --   기준에서 제외하고, 개연성·per-call 캡만 유효 기준으로 삼는다. ref=0(성과 없는 pve_run)인데
  --   양의 자원을 주장하면 그 자체가 불가능한 획득이므로 플래그한다.
  v_ref_credits  := least(v_plaus_credits,  v_call_credits);   -- 비-pve → v_call_credits(널 무시).
  v_ref_minerals := least(v_plaus_minerals, v_call_minerals);
  if (v_ref_credits  > 0 and v_claim_credits  > FLAG_MULTIPLE * v_ref_credits)
     or (v_ref_minerals > 0 and v_claim_minerals > FLAG_MULTIPLE * v_ref_minerals)
     or (p_source = 'pve_run' and v_final_tick <= 0
         and (v_claim_credits > 0 or v_claim_minerals > 0)) then
    v_flag := true;
  end if;

  -- 가산 + (필요 시) 플래그를 한 문장으로. definer 라 guard 통과. RETURNING 으로 갱신 잔액 확보.
  update public.profiles
    set credits  = credits  + v_grant_credits,
        minerals = minerals + v_grant_minerals,
        flagged  = case when v_flag then true else flagged end
    where id = v_me
    returning credits, minerals into v_credits_left, v_minerals_left;

  -- 실지급이 있을 때만 원장 기록(0 가산 로그로 원장·GC 를 오염시키지 않음). 누적 캡의 근거다.
  if v_grant_credits > 0 or v_grant_minerals > 0 then
    insert into public.currency_grants (profile_id, source, credits, minerals)
      values (v_me, p_source, v_grant_credits, v_grant_minerals);
  end if;

  return jsonb_build_object(
    'granted_credits',  v_grant_credits,
    'granted_minerals', v_grant_minerals,
    'credits_left',     v_credits_left,
    'minerals_left',    v_minerals_left,
    'clamped',          v_clamped
  );
end;
$$;

revoke all on function public.grant_currency(numeric, numeric, text, jsonb) from public;
revoke all on function public.grant_currency(numeric, numeric, text, jsonb) from anon;
grant execute on function public.grant_currency(numeric, numeric, text, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. settle_pve_run — 런 정산 요약을 재화 지급 + 요약 이력 1행 (user JWT, SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- p_summary = 클라가 sim 관측으로 채운 정산 요약(예: { victory, planet, stage, finalTick,
--   kills, resources, minerals }). resources → credits, minerals → minerals 로 지급하되 3중
--   캡은 grant_currency(source='pve_run', metrics=요약)가 강제한다(리플레이 재검증 없음, ADR-0026).
--
-- ⚠️ 임시 처리(Lane 3 = worker-teardown 완료 전까지): pve_runs.replay·client_result 가 아직
--   not null(20260718000000:34-42)이다. Lane 3 이 그 not null 제약과 리플레이 컬럼을 제거하기
--   전까지는 최소 유효값 '{}'::jsonb 를 넣어 제약을 만족시키고, 실제 데이터는 아래에서 add 하는
--   summary/credits_granted/minerals_granted 컬럼에 담는다. Lane 3 완료 후 이 '{}' 삽입은 정리
--   대상이다. verified_status 는 'verified' 로 넣어, 잔존할 수 있는 sample_pve_runs(pending 만
--   샘플링)가 이 정산 로그행을 리플레이 재검증 대상으로 오인해 재현 실패로 계정을 flag 하는
--   teardown 경합을 막는다(이 행에는 재현할 리플레이가 없다).
alter table public.pve_runs add column if not exists summary          jsonb;
alter table public.pve_runs add column if not exists credits_granted  numeric;
alter table public.pve_runs add column if not exists minerals_granted numeric;

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

  -- 정산 요약 이력 1행(리플레이 없음). replay/client_result 는 임시 '{}'(위 주석 참조).
  insert into public.pve_runs (
    profile_id, replay, client_result, verified_status, verified_at,
    summary, credits_granted, minerals_granted
  )
  values (
    v_me, '{}'::jsonb, '{}'::jsonb, 'verified', now(),
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

-- -----------------------------------------------------------------------------
-- 4. spend_currency — 잔액 확인 후 컬럼 차감 (user JWT, SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- 본인 잔액을 for update 로 잠그고, 부족하면 아무것도 쓰지 않고 ok=false. 충분하면 차감한다.
-- 음수 인자는 greatest(0, ..) 로 방어(음수 차감 = 재화 창조 오용 차단). 스펜드는 과소청구해도
-- 재화 창조가 아니라 소액 sink 손해라 상한 캡이 불필요하고, 핵심 방어는 "잔액 이상 못 씀"이다.
-- 사용처(클라 배선은 별도 워커): 리스펙 · 스태시 확장 · 장비 어픽스 리롤.
create or replace function public.spend_currency(
  p_credits  numeric,
  p_minerals numeric,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me             uuid := auth.uid();
  v_credits        numeric;
  v_minerals       numeric;
  v_spend_credits  numeric;
  v_spend_minerals numeric;
begin
  if v_me is null then
    raise exception 'spend_currency: 로그인 필요';
  end if;

  v_spend_credits  := greatest(0, coalesce(p_credits, 0));
  v_spend_minerals := greatest(0, coalesce(p_minerals, 0));

  -- 프로필 행 잠금(read-modify-write 직렬화 — 동시 소비의 lost-update 차단).
  select coalesce(credits, 0), coalesce(minerals, 0)
    into v_credits, v_minerals
    from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object('ok', false, 'note', 'no-profile',
      'credits_left', 0, 'minerals_left', 0);
  end if;

  if v_credits < v_spend_credits or v_minerals < v_spend_minerals then
    return jsonb_build_object('ok', false, 'note', 'insufficient',
      'credits_left', v_credits, 'minerals_left', v_minerals);
  end if;

  update public.profiles
    set credits  = v_credits  - v_spend_credits,
        minerals = v_minerals - v_spend_minerals
    where id = v_me;

  return jsonb_build_object(
    'ok', true,
    'credits_left',  v_credits  - v_spend_credits,
    'minerals_left', v_minerals - v_spend_minerals
  );
end;
$$;

revoke all on function public.spend_currency(numeric, numeric, text) from public;
revoke all on function public.spend_currency(numeric, numeric, text) from anon;
grant execute on function public.spend_currency(numeric, numeric, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. 7일 GC cron — currency_grants · pve_runs 요약 로그 보관 기간 제한
-- -----------------------------------------------------------------------------
-- currency_grants 는 누적 캡(최근 24h)만 참조하므로 7일이면 충분하고, pve_runs 요약 로그도
-- 이력·감사용 단기 보관이면 족하다(리플레이 blob 없음 → 저장 부담 작음). pg_cron 은 Phase E 부터
-- 활성. 실패 시 Dashboard → Database → Extensions 에서 pg_cron 켠 뒤 아래 두 줄을 수동 실행.
create extension if not exists pg_cron;

select cron.schedule(
  'planet-blitz-gc-currency-grants',
  '0 2 * * *',
  $$ delete from public.currency_grants where created_at < now() - interval '7 days'; $$
);

select cron.schedule(
  'planet-blitz-gc-pve-runs',
  '0 2 * * *',
  $$ delete from public.pve_runs where created_at < now() - interval '7 days'; $$
);

-- =============================================================================
-- 6. RPC 시그니처·반환 계약·캡 상수 의미 (후속 클라 워커용 · handoff pve-settlement.md 참조)
-- =============================================================================
-- ▮ grant_currency(p_credits numeric, p_minerals numeric, p_source text, p_metrics jsonb=null)
--     — 본인(auth.uid())에게 재화 가산. 주장액을 3중 캡(개연성·per-call·누적)으로 클램프.
--     반환 { granted_credits, granted_minerals, credits_left, minerals_left, clamped:boolean }.
--     (credits_left/minerals_left = 가산 후 profiles 정본 잔액 = 클라 표시 미러 동기화값.)
--     source: 'pve_run' | 'salvage' | 'story' | (기타=보수적 기본 상한). 극단 초과 시 flagged.
--
-- ▮ settle_pve_run(p_summary jsonb)
--     — p_summary(resources→credits, minerals→minerals, 개연성용 finalTick·stage 포함)로
--     grant_currency(source='pve_run') 지급 + pve_runs 요약 이력 1행. 반환 = grant_currency
--     결과 + { settled:true }. 사용처: 런 정산(src/save/settlement.ts 자원·광물 파트).
--
-- ▮ spend_currency(p_credits numeric, p_minerals numeric, p_reason text)
--     — 본인 잔액 차감(부족 시 미차감). 반환 { ok:boolean, credits_left, minerals_left }.
--     사용처: 리스펙(src/save/profile.ts) · 스태시 확장(inventory/hangar) · 어픽스 리롤(refinery).
--
-- 정본: public.profiles.credits / minerals(numeric, 서버 권위 — worker-currency 컬럼). save 안의
--   credits/minerals 는 표시 미러일 뿐이며, 클라는 위 RPC 응답의 credits_left/minerals_left 로
--   미러를 갱신한다. 사연 claim-once 는 클라 원장(storyRewardsClaimed) 유지 — 재청구는 누적
--   캡이 유계(서버 claim 원장 이관은 선택적 후속 강화).
-- =============================================================================

comment on table public.currency_grants is
  '재화 가산 원장(ADR-0027). grant_currency 실지급액 source 별 기록 — 누적 캡(최근 1h/24h) 근거 + 이상치 신호. 7일 GC.';
comment on function public.grant_currency(numeric, numeric, text, jsonb) is
  '본인 재화 가산. 주장액을 3중 캡(개연성·per-call·누적)으로 클램프, 극단 초과 시 profiles.flagged. user JWT · SECURITY DEFINER.';
comment on function public.settle_pve_run(jsonb) is
  'PvE 런 정산: grant_currency(pve_run) 지급 + pve_runs 요약 이력 1행(리플레이 없음, ADR-0026). user JWT.';
comment on function public.spend_currency(numeric, numeric, text) is
  '본인 재화 차감(잔액 부족 시 미차감, 음수 방어). 리스펙·스태시 확장·어픽스 리롤 sink. user JWT.';
comment on column public.pve_runs.summary is
  '정산 요약(settle_pve_run). ADR-0026 리플레이 폐기 후 pve_runs 를 요약 로그로 개편(Lane 3 이 replay/client_result 제거 예정).';
