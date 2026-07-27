-- =============================================================================
-- Planet Blitz — 행성 인기 기반 보상 배율 (ADR-0038)
-- =============================================================================
-- 근거: ADR-0038(행성 인기 보상 배율) · ADR-0027(재화 서버 원장) · ADR-0026(정산은 서버 RPC 로
--   재화만 클램프 지급). 목적은 **전체 유저 기준으로 덜 도는 행성의 보상을 올리고 많이 도는
--   행성의 보상을 내려** 6행성이 균일하게 소비되게 하는 것이다.
--
-- 담는 것:
--   1. planet_popularity — 30분 스냅샷 테이블(행성별 런 수·점유율·확정 배율 centi·epoch)
--                          + **계정별 기여 카운트**(어뷰징 소급 판단용, 지금은 방어에 미사용).
--   2. refresh_planet_popularity() — 최근 1시간 창 집계 → 산식 → 스냅샷 insert.
--   3. planet-blitz-refresh-planet-popularity — 30분 cron.
--   4. planet_popularity_current — 클라 폴링용 뷰(anon/authenticated select).
--   5. settle_pve_run 재정의 — p_summary.epoch 로 그 스냅샷 배율을 읽어 **자원분 상한 재산정**.
--
-- ▮ 왜 별도 스냅샷 테이블인가
--   `pve_runs` 는 7일 GC 라 여기에 의존하면 배율 이력이 조용히 사라진다. 그리고 정산이 참조할
--   때 "그 epoch 에 확정된 값"이 재계산 없이 그대로 있어야 서버·클라가 같은 수를 본다.
--
-- ▮ centi 정수 계약
--   배율은 **0.01 단위 정수**(중립 100)로 저장·전송·해시한다. 리포의 blueprintChanceCp
--   (centi-percent) 관례와 정합하고, EF(Deno)↔브라우저 IEEE754 재현 논쟁을 제거한다.
--
-- ▮ ⚠️ 산식 이중 구현 — `src/economy/planetPopularity.ts` 와 **항상 같은 커밋에서** 고쳐라
--   TS 쪽이 산식 정본·단위 테스트 기준이고, 실제 30분 갱신은 아래 SQL 이 한다. 갈리면 서버가
--   이기고 클라 표시가 틀린다.
--
-- ▮ 상수 placeholder — 전부 출시 전 밸런스 튜닝 대상(defer-balance-tuning). 아래 DECLARE 의
--   constant 가 SQL 측 정본이며 TS 상수와 **쌍**이다:
--     CLAMP_LO 0.85 · CLAMP_HI 1.20 · PRIOR_K 80 · ALPHA 0.2 · 창 1시간 · 주기 30분
--
-- 재실행 안전: create table/index if not exists · drop policy if exists → create ·
--   create or replace function/view · cron.schedule(잡명 upsert) · security definer +
--   set search_path='' + public. 한정 + 끝에 revoke/grant.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- 1. planet_popularity — 30분 스냅샷
-- -----------------------------------------------------------------------------
-- 한 epoch × 한 행성 = 1행. epoch = floor(extract(epoch from now()) / 1800).
--   run_count      : 최근 1시간 창의 그 행성 PvE 정산 건수(집계 지표).
--   share_ppm      : 점유율(백만분율 정수 — 관측·대시보드용, 산식 입력 아님).
--   mult_centi     : 이 스냅샷에서 확정된 보상 배율(0.01 단위 정수, 중립 100).
--   contributors   : 최근 1시간 창에서 그 행성을 정산한 **고유 계정 수**.
--   top_contributor_runs : 그 창에서 한 계정이 낸 최대 런 수.
-- 뒤 두 컬럼이 "계정별 기여 카운트"다 — 지금 방어에 쓰지 않지만, 나중에 "한 계정이 창의 절반을
-- 채웠다" 같은 어뷰징을 **소급 판단**할 수 있게 남긴다(ADR-0038: 어뷰징 방어는 도입하지 않음).
create table if not exists public.planet_popularity (
  epoch                bigint  not null,
  planet               int     not null,
  run_count            bigint  not null default 0,
  share_ppm            bigint  not null default 0,
  mult_centi           int     not null default 100,
  contributors         bigint  not null default 0,
  top_contributor_runs bigint  not null default 0,
  created_at           timestamptz not null default now(),
  primary key (epoch, planet)
);

-- 최신 epoch 조회(뷰·정산 조회의 주 경로).
create index if not exists planet_popularity_epoch_idx
  on public.planet_popularity (epoch desc);

alter table public.planet_popularity enable row level security;

-- 읽기: **누구나**(anon 포함). 배율은 성계 지도에 상시 노출되는 공개 정보이고, 미로그인
-- 클라도 폴링해야 한다. 쓰기 정책 **부재** → 클라 직접 기록 불가(cron/definer 만 RLS 우회).
drop policy if exists planet_popularity_select_all on public.planet_popularity;
create policy planet_popularity_select_all
  on public.planet_popularity for select
  to anon, authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- 2. refresh_planet_popularity — 최근 1시간 창 집계 → 산식 → 스냅샷 insert
-- -----------------------------------------------------------------------------
-- 산식(TS `refreshMultipliersCenti` 와 동일):
--   ŵᵢ        = (cᵢ + K) / (R + 6K)
--   mᵢ_raw    = (1/6) / ŵᵢ
--   mᵢ_clamp  = clamp(mᵢ_raw, CLAMP_LO, CLAMP_HI)
--   mᵢ_target = mᵢ_clamp / Σ(wᵢ · mᵢ_clamp)          (wᵢ = cᵢ/R, R=0 이면 균등 1/6)
--   mᵢ_new    = mᵢ_prev + ALPHA × (mᵢ_target − mᵢ_prev)
-- 재정규화가 `Σ wᵢmᵢ = 1` 을 세워 **경제 총량이 불변**이다(개별 행성만 오르내린다).
--
-- 입력원은 `pve_runs.summary->>'planet'` 이다(settle_pve_run 이 심는 정산 요약). 리플레이가
-- 아니라 요약 로그라 가볍고, 7일 GC 안쪽의 1시간 창만 보므로 GC 와 충돌하지 않는다.
create or replace function public.refresh_planet_popularity()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 상수(placeholder — 파일 상단 배너가 의미 정본, TS 와 쌍). 출시 전 밸런스 튜닝 대상.
  PLANET_COUNT   constant int     := 6;
  CLAMP_LO       constant numeric := 0.85;
  CLAMP_HI       constant numeric := 1.20;
  PRIOR_K        constant numeric := 80;
  ALPHA          constant numeric := 0.2;
  WINDOW_INTERVAL constant interval := interval '1 hour';

  v_epoch   bigint := floor(extract(epoch from now()) / 1800)::bigint;
  v_total   numeric := 0;
  v_weighted numeric := 0;
begin
  -- 같은 epoch 을 두 번 굳히지 않는다(cron 중복 실행·수동 재실행 방어). 스냅샷은 그 30분
  -- 슬롯의 **확정값**이라, 이미 있으면 다시 계산해 값이 흔들리는 쪽이 더 나쁘다.
  if exists (select 1 from public.planet_popularity where epoch = v_epoch) then
    return;
  end if;

  create temporary table if not exists _pp (
    planet int primary key,
    c numeric not null default 0,
    contributors bigint not null default 0,
    top_runs bigint not null default 0,
    m_clamp numeric,
    m_target numeric,
    prev numeric,
    m_new numeric
  ) on commit drop;
  delete from _pp;

  -- 행성 0..5 를 항상 채운다(관측이 0 인 행성도 행이 있어야 산식이 성립).
  insert into _pp (planet) select generate_series(0, PLANET_COUNT - 1);

  -- 최근 창의 행성별 정산 건수 + 계정별 기여 통계.
  with w as (
    select
      (r.summary->>'planet')::int as planet,
      r.profile_id
    from public.pve_runs r
    where r.created_at > now() - WINDOW_INTERVAL
      and (r.summary->>'planet') ~ '^[0-9]+$'
      and (r.summary->>'planet')::int between 0 and PLANET_COUNT - 1
  ),
  per_account as (
    select planet, profile_id, count(*) as runs from w group by planet, profile_id
  )
  update _pp t
    set c            = coalesce(a.total_runs, 0),
        contributors = coalesce(a.accounts, 0),
        top_runs     = coalesce(a.max_runs, 0)
    from (
      select planet, sum(runs) as total_runs, count(*) as accounts, max(runs) as max_runs
      from per_account group by planet
    ) a
    where a.planet = t.planet;

  select coalesce(sum(c), 0) into v_total from _pp;

  -- ŵ → 역비례 → 클램프.
  update _pp
    set m_clamp = least(CLAMP_HI, greatest(CLAMP_LO,
      (1.0 / PLANET_COUNT) / ((c + PRIOR_K) / (v_total + PLANET_COUNT * PRIOR_K))
    ));

  -- 런가중 합 Σ(wᵢ · mᵢ_clamp). 가중치는 **실측 점유율** cᵢ/R 이다(사전표본이 섞인 ŵ 가 아니라).
  -- 표본이 없으면(R=0) 균등 가중 1/6 으로 떨어뜨린다 — 이때 모든 m_clamp 가 1 이라 합도 1 이다.
  if v_total > 0 then
    select coalesce(sum((c / v_total) * m_clamp), 0) into v_weighted from _pp;
  else
    select coalesce(sum(m_clamp / PLANET_COUNT), 0) into v_weighted from _pp;
  end if;

  update _pp
    set m_target = case when v_weighted > 0 then m_clamp / v_weighted else m_clamp end;

  -- 직전 스냅샷 배율(없으면 중립 1.0)에서 지수평활.
  update _pp t
    set prev = coalesce((
      select p.mult_centi / 100.0
        from public.planet_popularity p
        where p.planet = t.planet
        order by p.epoch desc
        limit 1
    ), 1.0);

  update _pp set m_new = prev + ALPHA * (m_target - prev);

  -- ⚠️ **정수 격자 평활의 정지 지점(stall) 보정** — TS `refreshMultipliersCenti` 와 같은 규율.
  -- prev 가 목표에 가까워지면 한 주기 스텝이 0.5 centi 밑으로 내려가고, round() 가 결과를 prev 로
  -- 되돌려 **영원히 멈춘다**(목표에 몇 centi 못 미친 채 수렴한 척한다 → 런가중 평균 = 1 불변식이
  -- 깨진다). 목표가 아직 1 centi 이상 떨어져 있는데 반올림이 제자리면 최소 1 centi 전진시킨다.
  update _pp
    set m_new = case
      when round(m_new * 100) = round(prev * 100)
       and round(m_target * 100) <> round(prev * 100)
      then (round(prev * 100) + sign(round(m_target * 100) - round(prev * 100))) / 100.0
      else m_new
    end;

  insert into public.planet_popularity
    (epoch, planet, run_count, share_ppm, mult_centi, contributors, top_contributor_runs)
  select
    v_epoch,
    planet,
    c::bigint,
    case when v_total > 0 then round(c / v_total * 1000000)::bigint else 0 end,
    round(m_new * 100)::int,
    contributors,
    top_runs
  from _pp;
end;
$$;

revoke all on function public.refresh_planet_popularity() from public;
revoke all on function public.refresh_planet_popularity() from anon, authenticated;
grant execute on function public.refresh_planet_popularity() to service_role;

-- -----------------------------------------------------------------------------
-- 3. 30분 cron — 기존 planet-blitz-* 명명 관례
-- -----------------------------------------------------------------------------
-- pg_cron 활성 실패 시 Dashboard → Database → Extensions 에서 켠 뒤 아래 한 줄을 수동 실행.
select cron.schedule(
  'planet-blitz-refresh-planet-popularity',
  '0,30 * * * *',
  $$ select public.refresh_planet_popularity(); $$
);

-- 스냅샷 보관 30일 GC(누적 무한 증가 방지 — 정산은 현재/직전 epoch 만 본다).
select cron.schedule(
  'planet-blitz-gc-planet-popularity',
  '15 2 * * *',
  $$ delete from public.planet_popularity where created_at < now() - interval '30 days'; $$
);

-- -----------------------------------------------------------------------------
-- 4. planet_popularity_current — 클라 폴링용 뷰
-- -----------------------------------------------------------------------------
-- 최신 epoch 의 6행만 낸다. **아직 한 번도 갱신되지 않았으면 0행** → 클라가 전 행성 1.0
-- 폴백으로 떨어진다(오프라인·미설정과 같은 결과, ADR-0038).
-- security_invoker=on 이라 뷰가 아니라 **기저 테이블의 RLS**(위 select-all 정책)가 적용된다.
create or replace view public.planet_popularity_current
with (security_invoker = on) as
  select p.planet, p.mult_centi, p.epoch
    from public.planet_popularity p
   where p.epoch = (select max(epoch) from public.planet_popularity);

grant select on public.planet_popularity_current to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. settle_pve_run 재정의 — epoch 로 자원분 상한 재산정
-- -----------------------------------------------------------------------------
-- ▮ 무엇이 바뀌나
--   `p_summary.epoch`(클라가 런 시작에 스탬프한 스냅샷 epoch)를 읽어, **서버 자기 스냅샷**에서
--   그 행성의 mult_centi 를 조회하고 자원 주장액의 지급 상한을 그 배율만큼 넓힌다.
--
-- ▮ 왜 "재산정"이 곱셈이 아니라 **상한 확대**인가
--   sim 이 이미 배율을 적용해 자원을 적립했다(ADR-0038: 적용 레이어는 전부 sim). 서버가 여기서
--   또 곱하면 이중 적용이다. 서버의 역할은 **권위**이지 재적용이 아니다 — 클라가 배율만큼 더
--   가져오겠다고 주장할 때, 그 주장이 **그 epoch 에 실제로 존재한 배율 안쪽인지**를 서버 값으로
--   판정한다. 이는 촉매 `resource_mult` 영수증이 캡을 상향하는 규율과 동일하고, 추가 RPC 가 0 이다.
--
-- ▮ 위조 표면
--   클라는 **배율값을 보내지 않는다**(epoch 만). epoch 을 조작해도 서버는 자기 스냅샷을 읽으므로
--   존재하지 않는 배율을 얻을 수 없고, epoch 이 현재/직전이 아니면 **1.0 취급**이라 오래된 고배율
--   스냅샷을 재사용할 수 없다. planet 도 p_summary 의 값을 그대로 쓰되, 그 행성의 스냅샷 배율만
--   조회하므로 "카르곤 런을 톡사르라고 우기면" 톡사르 배율 상한을 받을 뿐 지급액 자체는 여전히
--   3중 캡과 개연성(finalTick·stage)에 묶인다.
--
-- ▮ 하위호환: epoch 미지정(구 클라·오프라인 큐 재시도)이면 배율 1.0 → 기존 경로와 동일.
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
  v_metrics        jsonb;
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

  -- 행성 인기 배율(ADR-0038) — **현재/직전 epoch 만** 인정한다. 30분 슬롯 경계에서 시작해
  -- 경계 뒤에 끝난 런이 정당하게 정산되도록 직전까지 허용하고, 그보다 오래된 epoch 은 1.0 이다.
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
  v_metrics := p_summary || jsonb_build_object(
    'finalTick', (case
      when (p_summary->>'finalTick') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_summary->>'finalTick')::numeric else 0 end) * v_mult,
    'planetMultCenti', round(v_mult * 100)
  );

  -- 재화 지급(3중 캡 강제). 중첩 definer 호출에서도 auth.uid() = 원 호출자라 본인에게 가산된다.
  v_grant := public.grant_currency(v_claim_credits, v_claim_minerals, 'pve_run', v_metrics);

  -- 정산 요약 이력 1행(리플레이 없음). replay/client_result 는 임시 '{}'(pve_settlement 참조).
  -- ⚠️ summary 는 **원본 p_summary** 를 넣는다 — 위 v_metrics 는 캡 산정용 파생이라, 이걸
  --    저장하면 refresh_planet_popularity 의 집계 입력(summary->>'planet')이 파생값으로 오염된다.
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

-- =============================================================================
-- 6. 계약 요약 (후속 워커용)
-- =============================================================================
-- ▮ planet_popularity_current  — select(anon/authenticated): { planet, mult_centi, epoch } × 6.
--     0행 = 아직 첫 스냅샷 전 → 클라는 전 행성 1.0 폴백.
-- ▮ settle_pve_run(p_summary)  — p_summary 에 **epoch** 추가(선택). 배율값은 보내지 않는다.
-- ▮ refresh_planet_popularity() — service_role 전용. 30분 cron 이 호출. 같은 epoch 재실행은 no-op.
-- =============================================================================

comment on table public.planet_popularity is
  '행성 인기 보상 배율 30분 스냅샷(ADR-0038). 최근 1시간 PvE 정산 건수 → 역비례·클램프·런가중 재정규화·지수평활 → mult_centi(0.01 단위, 중립 100). contributors/top_contributor_runs 는 어뷰징 소급 판단용 기여 통계(현재 방어 미사용). 30일 GC.';
comment on function public.refresh_planet_popularity() is
  '최근 1시간 창 집계로 행성 인기 배율 스냅샷 1개(6행)를 굳힌다. 같은 epoch 이 이미 있으면 no-op. 산식 정본은 src/economy/planetPopularity.ts 와 쌍 — 함께 고칠 것. service_role 전용.';
comment on view public.planet_popularity_current is
  '최신 epoch 의 행성 인기 배율표(ADR-0038). 클라가 30분 주기로 폴링해 런 시작에 스탬프한다. 미로그인도 읽힘.';
