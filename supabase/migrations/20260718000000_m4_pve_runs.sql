-- =============================================================================
-- Planet Blitz M4 — PvE 런 서버 기록 + 리플레이 재실행 샘플링 검증 (계획 §4 F4 완전판 착수 조건 이행)
-- =============================================================================
-- 근거: Phase F(20260717150000_m4_phase_f_pve_sampling.sql) "리플레이 재실행 샘플링 착수 조건"
--   3건 중 ①PvE 런 서버 기록·②재실행 인프라·③적발 처리를 배선한다. ADR-0005(결정론 재실행),
--   GDD §11("PvE 검증 = 샘플링 재실행: … 적발 시 런 무효+계정 플래그").
--
-- 담는 것:
--   1. pve_runs 테이블 — PvE 런 단위 리플레이(시드+config+입력) blob + 클라 주장(해시 스트림·
--      승패) + 서버 검증 상태. 침공(invasions)과 동일한 서버 권위 규율(원칙2):
--        · 클라이언트는 본인 런을 pending 증거로 insert 만, 결과 확정(update)은 service_role.
--        · 가드 트리거가 클라 insert 의 verified_* 를 강제로 비운다.
--   2. sample_pve_runs(RPC) — 재실행 검증 대상 선정: 이상치 플래그된 계정의 pending 런 우선 +
--      나머지 랜덤 샘플. Edge Function verify-pve-sample 이 호출(service_role 전용).
--   3. apply_pve_verification(RPC) — 재실행 판정을 원자 확정 + 불일치 시 계정 플래그(적발 처리).
--
-- 재실행 안전성: create table if not exists · create index if not exists ·
--   drop policy if exists 선행 · create or replace function/trigger · 부분 실패 후 재적용 수렴.
-- =============================================================================

-- pgcrypto(gen_random_uuid) — 초기 스키마에서 이미 선언됐으나 단독 재적용 안전을 위해 재선언.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. pve_runs — PvE 런 리플레이 blob + 클라 주장 + 서버 검증 상태
-- -----------------------------------------------------------------------------
-- replay      = { seed, config, inputs } 재현 입력(ADR-0005 결정론 재실행 대상).
-- client_result = 클라가 주장한 { victory, gameOver, finalTick, finalHash, hashStream }
--               (침공 client_result 와 동일한 hashStream 계약 — 틱별 uint32 상태 해시).
-- verified_*  = 서버 전수 재실행 결과(확정 전 null). 클라 insert 는 pending 증거만.
create table if not exists public.pve_runs (
  id               uuid        primary key default gen_random_uuid(),
  profile_id       uuid        not null references public.profiles(id) on delete cascade,
  replay           jsonb       not null,
  client_result    jsonb       not null,
  verified_status  text        not null default 'pending'
                     check (verified_status in ('pending', 'verified', 'rejected')),
  -- 서버 재실행 결과(확정 전 null).
  verified_result  jsonb,
  created_at       timestamptz not null default now(),
  verified_at      timestamptz
);

-- 소유자별 최근순 조회 + pending 대상 샘플링(부분 인덱스로 pending 스캔 저비용).
create index if not exists pve_runs_profile_idx on public.pve_runs (profile_id, created_at desc);
create index if not exists pve_runs_pending_idx on public.pve_runs (created_at) where verified_status = 'pending';

alter table public.pve_runs enable row level security;

-- 본인 PvE 런을 pending 증거로 insert 만(RLS with_check 로 profile_id=본인 강제).
drop policy if exists pve_runs_insert_own on public.pve_runs;
create policy pve_runs_insert_own
  on public.pve_runs for insert
  to authenticated
  with check (auth.uid() = profile_id);

-- 본인 런만 조회(이력·디버그). 타인 런은 읽지 못한다.
drop policy if exists pve_runs_select_own on public.pve_runs;
create policy pve_runs_select_own
  on public.pve_runs for select
  to authenticated
  using (auth.uid() = profile_id);

-- update/delete 정책 없음 → 클라이언트는 검증 결과를 못 바꾸고 못 지운다(원칙2). 확정은 service_role.

-- 서버 권위 가드: 클라이언트 insert 는 항상 pending 으로, 결과 필드는 비운 채 강제.
-- 조작된 verified_status='verified' 제출을 원천 차단(invasions 가드와 동일 규율).
create or replace function public.guard_pve_runs_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.verified_status := 'pending';
    new.verified_result := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

create or replace trigger trg_pve_runs_guard_insert
  before insert on public.pve_runs
  for each row execute function public.guard_pve_runs_client_insert();

-- -----------------------------------------------------------------------------
-- 2. sample_pve_runs — 재실행 검증 대상 선정(service_role 전용)
-- -----------------------------------------------------------------------------
-- 선정 규칙(OQ-M4-2 기본안 근사): 통계 이상치로 이미 flagged 된 계정의 pending 런을 우선
--   (flagged 계정은 전수에 가깝게), 그 외에는 랜덤 샘플. p_limit 로 배치 상한을 둔다(EF 재실행
--   시간예산 방어). 반환에 profile_flagged 를 실어 EF 가 우선순위·로깅에 쓴다.
create or replace function public.sample_pve_runs(p_limit integer default 100)
returns table (
  id              uuid,
  profile_id      uuid,
  replay          jsonb,
  client_result   jsonb,
  profile_flagged boolean
)
language sql
security definer
set search_path = ''
as $$
  select r.id, r.profile_id, r.replay, r.client_result, p.flagged
  from public.pve_runs r
  join public.profiles p on p.id = r.profile_id
  where r.verified_status = 'pending'
  -- 이상치 플래그 계정 우선, 그 다음 랜덤(상위 N%·랜덤 소수 근사).
  order by p.flagged desc, random()
  limit greatest(0, coalesce(p_limit, 0));
$$;

revoke all on function public.sample_pve_runs(integer) from public;
revoke all on function public.sample_pve_runs(integer) from anon, authenticated;
grant execute on function public.sample_pve_runs(integer) to service_role;

-- -----------------------------------------------------------------------------
-- 3. apply_pve_verification — 재실행 판정 원자 확정 + 적발 시 계정 플래그
-- -----------------------------------------------------------------------------
-- p_status ∈ ('verified','rejected'). pending 인 런만 확정(멱등 — 이미 확정된 런은 no-op).
-- p_flag_profile=true 면 해당 런의 소유 계정을 flagged=true 로 표기(재실행 불일치 = 적발,
--   flag_pve_anomalies 의 플래그 경로 재사용). 반환 { finalized, flagged }.
create or replace function public.apply_pve_verification(
  p_run_id        uuid,
  p_status        text,
  p_verified_result jsonb default null,
  p_flag_profile  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile    uuid;
  v_finalized  boolean := false;
  v_flagged    boolean := false;
begin
  if p_status not in ('verified', 'rejected') then
    raise exception 'apply_pve_verification: 잘못된 status % (verified|rejected 만 허용)', p_status;
  end if;

  update public.pve_runs
    set verified_status = p_status,
        verified_result = p_verified_result,
        verified_at = now()
    where id = p_run_id
      and verified_status = 'pending'
    returning profile_id into v_profile;

  if v_profile is null then
    -- 이미 확정됐거나 없는 런(멱등 no-op).
    return jsonb_build_object('finalized', false, 'flagged', false);
  end if;
  v_finalized := true;

  if p_flag_profile then
    update public.profiles
      set flagged = true
      where id = v_profile
        and not flagged
      returning true into v_flagged;
    v_flagged := coalesce(v_flagged, false);
  end if;

  return jsonb_build_object('finalized', v_finalized, 'flagged', v_flagged);
end;
$$;

revoke all on function public.apply_pve_verification(uuid, text, jsonb, boolean) from public;
revoke all on function public.apply_pve_verification(uuid, text, jsonb, boolean) from anon, authenticated;
grant execute on function public.apply_pve_verification(uuid, text, jsonb, boolean) to service_role;

-- =============================================================================
-- 주기 실행(스케줄) — 배포 담당/리드 몫
-- =============================================================================
-- verify-pve-sample Edge Function 은 리플레이 재실행에 시뮬 코어(JS)를 돌려야 하므로 SQL(pg_cron)
-- 안에서 직접 재실행할 수 없다. 주기 실행은 다음 중 하나로 EF 를 호출한다(런타임 시크릿 필요 →
-- 이 마이그레이션에 하드코딩하지 않는다):
--   (a) pg_cron + pg_net: vault 에 project URL·service_role key 를 넣고
--         select cron.schedule('planet-blitz-verify-pve-sample', '30 1 * * *', $$
--           select net.http_post(
--             url    := <project-url> || '/functions/v1/verify-pve-sample',
--             headers:= jsonb_build_object('Authorization','Bearer '||<service_role_key>,
--                                          'Content-Type','application/json'),
--             body   := '{"limit":200}'::jsonb);
--         $$);
--   (b) 외부 스케줄러(GitHub Actions 등)가 service_role 키로 EF 를 일 1회 POST.
-- flag_pve_anomalies(20260717150000) 이 먼저 이상치 계정을 flagged 로 표기해 두면(01:00 UTC),
--   이 잡(01:30 UTC 권장)이 그 계정의 pending 런을 우선 재실행해 확률적 적발을 완성한다.
-- =============================================================================
