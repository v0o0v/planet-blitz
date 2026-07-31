-- =============================================================================
-- 의뢰서(commission) 원장 — 서버 축 전량
-- =============================================================================
-- 계약 정본: `.omc/plans/commission-server-contract.md` (rev3). 절 번호는 그 문서를 가리킨다.
-- 결정 문서: ADR-0043 · ADR-0044 · ADR-0045 · ADR-0046 · ADR-0027(재화 관문 계약 변경).
--
-- 이 마이그레이션이 만드는 것:
--   1. 테이블 4종 — commission_inventory · commission_issues · commission_runs · commission_grants
--   2. 재화 관문 재편 — grant_currency_for(신설, 공유 본문) + grant_currency(allowlist 위임 래퍼)
--   3. 발령 경로 — pve_runs AFTER 트리거 + issue_commission_for_run(어떤 role 에도 EXECUTE 없음)
--   4. 런 RPC 5종 — consume / mark_active / settle / store_replay_gz / bump_verify_attempts
--   5. cron 4종 — issued 회수 · replay blob GC · active 종결 · issues GC
--
-- ⚠️ **`settle_pve_run` 본문을 고치지 않는다.** 그 함수는 5회 재정의됐고 그 복제가 이미 PvE
--    정산을 100% 깨뜨렸다(20260802000000:4-15 — 드롭된 컬럼을 참조하는 구본문 복제, ERROR 42703).
--    발령은 AFTER 트리거로 **붙인다**.
--
-- ⚠️ **트리거 본문은 서브트랜잭션으로 감싼다.** 감싸지 않으면 발령 경로의 예외가 정산 트랜잭션
--    전체를 롤백해 **전 플레이어가 자원을 못 받고 화면은 조용하다** — PR#222 와 문자 그대로 같은
--    실패 형상이다. (plpgsql `OTHERS` 는 `query_canceled`·`assert_failure` 를 잡지 않으므로
--    statement_timeout 은 여전히 롤백시킨다. 그 경우는 세션 취소라 조용한 0 지급은 아니다.)
--
-- ⚠️ **행은 RLS, 컬럼은 GRANT 가 게이트한다.** commission_runs 에 select-own 정책만 두고 컬럼
--    GRANT 를 회수하지 않으면, Supabase 기본 부여로 `loadout_sealed`(EF 위조 대조 **기준값**)와
--    `replay_gz` 가 PostgREST 로 그대로 나간다. 이 프로젝트의 원격에서 기본 컬럼 부여가 실재함을
--    확인했다(information_schema.column_privileges). revoke + 컬럼 목록 grant 가 필수다.
--
-- 상수 미러: `src/run/commissionServerConstants.ts`. **여기 수치를 고치면 그 파일도 함께 고쳐라**
--    (tests/commissionServerConstants.test.ts 가 불일치를 잡는다).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. commission_inventory — 아직 쓰지 않은 의뢰서 (계약 §3-1)
-- -----------------------------------------------------------------------------
-- 소비 시 **행이 삭제된다**. 그래서 발령 1회성을 여기에 걸 수 없다(소비와 함께 소멸).
create table if not exists public.commission_inventory (
  commission_id uuid        primary key default gen_random_uuid(),
  profile_id    uuid        not null references public.profiles(id) on delete cascade,
  grade         int         not null check (grade between 1 and 4),
  payload       jsonb       not null,
  created_at    timestamptz not null default now()
);
create index if not exists commission_inventory_profile_idx
  on public.commission_inventory (profile_id, created_at desc);

alter table public.commission_inventory enable row level security;
drop policy if exists commission_inventory_select_own on public.commission_inventory;
create policy commission_inventory_select_own
  on public.commission_inventory for select to authenticated
  using (auth.uid() = profile_id);
-- insert/update/delete 정책 없음 — 쓰기는 security definer RPC 전용(catalyst_inventory 패턴).

-- -----------------------------------------------------------------------------
-- 2. commission_issues — 발령 원장 (1회성 앵커 · 빈도 상한 · 쿨다운 지평) (계약 §3-2)
-- -----------------------------------------------------------------------------
-- pve_run_id 가 PK = 정산 1행당 발령 판정 1회. **pve_runs 로의 FK 를 걸지 않는다** —
-- 걸면 7일 TTL cron(planet-blitz-gc-pve-runs)이 발령 원장을 함께 지운다.
create table if not exists public.commission_issues (
  pve_run_id         uuid        primary key,
  profile_id         uuid        not null references public.profiles(id) on delete cascade,
  granted            boolean     not null,
  claimed_victory    boolean     not null,
  claimed_final_tick int         not null default 0,
  -- 쿨다운 "누적 예약 지평". 발령 시에만 전진하므로 미발령 행은 default now() 로 max 에 무해하다.
  next_eligible_at   timestamptz not null default now(),
  commission_id      uuid,
  skip_reason        text        check (skip_reason in ('not-victory','stock','rate','cooldown')),
  created_at         timestamptz not null default now()
);
create index if not exists commission_issues_profile_time_idx
  on public.commission_issues (profile_id, created_at desc);
-- 빈도 상한은 **claimed_victory 인 행만** 센다. 전체 행을 세면 패배 정산이 슬롯을 먹어
-- 정직한 빠른 재시작 플레이어의 의뢰서를 끊으면서, 위조 victory:true 에는 아무 비용도 안 든다.
create index if not exists commission_issues_rate_idx
  on public.commission_issues (profile_id, created_at desc) where claimed_victory;
create index if not exists commission_issues_granted_idx
  on public.commission_issues (profile_id, created_at desc) where granted;
create index if not exists commission_issues_horizon_idx
  on public.commission_issues (profile_id, next_eligible_at desc);

alter table public.commission_issues enable row level security;
-- select 정책도 두지 않는다: RLS enable + 정책 0개 = authenticated 는 아무것도 못 읽는다.
-- skip_reason 노출은 "언제 상한에 걸리는가"를 알려주는 재료다.

-- -----------------------------------------------------------------------------
-- 3. commission_runs — 출격한 의뢰 1건 (계약 §3-3)
-- -----------------------------------------------------------------------------
-- ⚠️ `replay jsonb` · `client_result jsonb` 컬럼을 **두지 않는다.** 침공은 클라가 invasions 행을
--    replay 째로 INSERT 하지만(invasions_insert_attacker 정책), 이 테이블에는 **쓰기 정책이 하나도
--    없어** 클라가 원본 jsonb 를 넣을 경로가 존재하지 않는다. 두면 영원히 null 이고 그것을 대상으로
--    삼은 GC 술어는 영원히 거짓이 된다. 제출 리플레이는 EF 요청 본문으로만 오고 gzip 만 저장된다.
create table if not exists public.commission_runs (
  run_id          uuid        primary key default gen_random_uuid(),
  profile_id      uuid        not null references public.profiles(id) on delete cascade,
  commission_id   uuid        not null,
  grade           int         not null check (grade between 1 and 4),
  status          text        not null default 'issued'
                    check (status in ('issued','active','verified','rejected','expired','abandoned')),
  payload         jsonb       not null,
  loadout_sealed  jsonb       not null,
  replay_gz       bytea,
  verify_attempts int         not null default 0,
  verified_result jsonb,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  verified_at     timestamptz
);
-- 부분 인덱스 3종이 cron 3건의 술어와 1:1 대응한다. 술어를 바꾸면 인덱스도 바꿔야 한다는 것을
-- 인덱스 이름으로 못 박는다.
create index if not exists commission_runs_profile_idx
  on public.commission_runs (profile_id, created_at desc);
create index if not exists commission_runs_issued_idx
  on public.commission_runs (created_at) where status = 'issued';
create index if not exists commission_runs_active_idx
  on public.commission_runs (started_at) where status = 'active';
create index if not exists commission_runs_gc_idx
  on public.commission_runs (verified_at)
  where status in ('verified','rejected','abandoned');

alter table public.commission_runs enable row level security;
drop policy if exists commission_runs_select_own on public.commission_runs;
create policy commission_runs_select_own
  on public.commission_runs for select to authenticated
  using (auth.uid() = profile_id);
-- insert/update/delete 정책은 없다(쓰기는 definer RPC 전용).

-- ⚠️ **행은 RLS, 컬럼은 GRANT.** 정책만 두면 컬럼은 Supabase 기본 부여로 전부 열린다 →
--    `GET /rest/v1/commission_runs?select=loadout_sealed,replay_gz` 로 뷰를 무시하고 기저를 친다.
--    얻는 것이 하필 이 뷰 규율이 존재 이유로 든 바로 그 둘이다.
revoke select on public.commission_runs from authenticated;
grant  select (run_id, profile_id, commission_id, grade, status, payload,
               verify_attempts, verified_result, created_at, started_at, verified_at)
  on public.commission_runs to authenticated;
-- loadout_sealed · replay_gz 는 목록에 없다 = 어떤 경로로도 안 나간다.

-- 뷰는 **security_invoker** 여야 한다. 정의자 권한 뷰는 기저 RLS 를 우회하므로, 빼면 뷰 본문의
-- where 한 줄이 행 경계 전부를 지는 fail-open 으로 되돌아간다.
-- 이 GRANT 목록과 아래 select 목록은 **정확히 일치해야 뷰가 동작한다** — 불일치가 즉시 오류로 드러나
-- 컬럼 목록 자체가 드리프트 탐지기 역할을 한다.
create or replace view public.commission_runs_public
with (security_barrier = true, security_invoker = true)
as
  select run_id, profile_id, commission_id, grade, status, payload,
         verify_attempts, verified_result, created_at, started_at, verified_at
    from public.commission_runs
   where profile_id = auth.uid();

grant select on public.commission_runs_public to authenticated;

-- -----------------------------------------------------------------------------
-- 4. commission_grants — 의뢰 확정 지급물의 **발급** 정본 (ADR-0045 · 계약 §3-4)
-- -----------------------------------------------------------------------------
-- 유일성 키는 (commission_run_id, kind, slot_index) 다. (commission_run_id, kind) 로 하면
-- **같은 종류를 2개 주는 의뢰서를 표현할 수 없다.** slot_index 는 payload.rewards 안 순번이라
-- payload 가 고정된 이상 결정적이고, 따라서 재시도가 같은 키를 만든다.
create table if not exists public.commission_grants (
  grant_id          uuid        primary key default gen_random_uuid(),
  profile_id        uuid        not null references public.profiles(id) on delete cascade,
  commission_run_id uuid        not null references public.commission_runs(run_id) on delete restrict,
  kind              text        not null check (kind in ('unique','blueprint')),
  slot_index        int         not null,
  item_payload      jsonb       not null,
  granted_at        timestamptz not null default now(),
  constraint commission_grants_once unique (commission_run_id, kind, slot_index)
);
create index if not exists commission_grants_profile_idx
  on public.commission_grants (profile_id, kind);

alter table public.commission_grants enable row level security;
drop policy if exists commission_grants_select_own on public.commission_grants;
create policy commission_grants_select_own
  on public.commission_grants for select to authenticated
  using (auth.uid() = profile_id);
-- insert/update/delete 정책 없음. **TTL 대상이 아니다** — 지우면 발급 사실이 사라져 EF 게이트 4 가
-- 정직한 플레이어를 오거부한다(ADR-0045 §결과).

-- =============================================================================
-- 5. 재화 관문 — grant_currency_for 신설 + grant_currency allowlist 위임 (계약 §5-1)
-- =============================================================================
-- CRIT-B: 현행 grant_currency 는 수령자를 auth.uid() 로 **내부 고정**하고 파라미터로 받지 않는다.
-- service_role JWT 에는 sub 이 없어 EF 가 부르면 지급이 아니라 **예외**다. 그래서 수령자만
-- 매개변수화한 공유 본문을 신설하고, 기존 함수를 그 위임 래퍼로 축소한다 —
-- 캡 산식·원장 기록·플래깅의 **단일 정본**을 유지하기 위해서다(복제했다가 한쪽만 갱신돼 사고가
-- 난 전례가 이 리포에 있다: 20260802000000:4-15).
--
-- ⚠️ **allowlist(default-deny)가 이 절의 하중 부재다.** 이것은 이 레인이 만드는 제약이 아니라
--    **이미 라이브에 열려 있는 구멍을 닫는 것**이다: grant_currency 는 authenticated 실행 가능인데
--    p_source 를 검증하지 않고, 미등록 source 는 else 분기로 CAP_DEFAULT_*(1,000/1,000)를 받으며,
--    개연성 캡은 p_source='pve_run' 일 때만 산정돼 least() 가 무시한다. 즉 인증된 아무 사용자가
--    `rpc/grant_currency {p_credits:1000,p_minerals:1000,p_source:"x"}` 를 시간당 50회 불러
--    **시간당 50,000/50,000, 일 300,000/300,000 을 런 없이** 얻는다. 마침 이 마이그레이션이 그
--    함수를 재정의하므로 지금이 유일하게 싼 수리 시점이다. (ADR-0027 결과 절에 기록할 것.)
create or replace function public.grant_currency_for(
  p_profile_id uuid,
  p_credits    numeric,
  p_minerals   numeric,
  p_source     text,
  p_metrics    jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 캡 상수(placeholder — 20260727000000 상단 배너가 의미 정본, 함께 갱신). 출시 전 밸런스 튜닝 대상.
  CAP_PVE_RUN_CREDITS    constant numeric := 5000;
  CAP_PVE_RUN_MINERALS   constant numeric := 5000;
  CAP_SALVAGE_CREDITS    constant numeric := 20000;
  CAP_SALVAGE_MINERALS   constant numeric := 20000;
  CAP_STORY_CREDITS      constant numeric := 2000;
  -- 의뢰 확정 보상. CAP_HOURLY_*(50,000) 아래로 두어 정직한 1회 지급이 누적 캡에 먼저 걸리지 않게 한다.
  -- 미러: src/run/commissionServerConstants.ts CAP_COMMISSION_CREDITS / _MINERALS.
  CAP_COMMISSION_CREDITS  constant numeric := 30000;
  CAP_COMMISSION_MINERALS constant numeric := 30000;
  CAP_DEFAULT_CREDITS    constant numeric := 1000;
  CAP_DEFAULT_MINERALS   constant numeric := 1000;
  CAP_HOURLY_CREDITS     constant numeric := 50000;
  CAP_HOURLY_MINERALS    constant numeric := 50000;
  CAP_DAILY_CREDITS      constant numeric := 300000;
  CAP_DAILY_MINERALS     constant numeric := 300000;
  PLAUSIBILITY_CREDITS_PER_TICK  constant numeric := 2.0;
  PLAUSIBILITY_MINERALS_PER_TICK constant numeric := 2.0;
  FLAG_MULTIPLE          constant numeric := 10;
  SLOT_CAP               constant int     := 8;
  MAX_RESOURCE_PER_STACK constant numeric := 0.15;
  CAP_RESOURCE_MULT_MAX  constant numeric := 1 + SLOT_CAP * MAX_RESOURCE_PER_STACK;  -- =2.2 유계 상한.

  -- ⚠️ 원본과의 **유일한** 차이: 수령자를 auth.uid() 가 아니라 파라미터에서 받는다.
  v_me            uuid := p_profile_id;
  v_claim_credits   numeric;
  v_claim_minerals  numeric;
  v_final_tick    numeric := 0;
  v_stage         numeric := 0;
  v_res_mult        numeric := 1;
  v_plaus_credits   numeric := null;
  v_plaus_minerals  numeric := null;
  v_call_credits    numeric;
  v_call_minerals   numeric;
  v_1h_credits    numeric := 0;
  v_1h_minerals   numeric := 0;
  v_24h_credits   numeric := 0;
  v_24h_minerals  numeric := 0;
  v_rem_credits     numeric;
  v_rem_minerals    numeric;
  v_ref_credits     numeric;
  v_ref_minerals    numeric;
  v_grant_credits   numeric;
  v_grant_minerals  numeric;
  v_credits_left    numeric := 0;
  v_minerals_left   numeric := 0;
  v_clamped       boolean := false;
  v_flag          boolean := false;
begin
  if v_me is null then
    raise exception 'grant_currency_for: 수령자 profile_id 필요';
  end if;

  v_claim_credits  := greatest(0, coalesce(p_credits, 0));
  v_claim_minerals := greatest(0, coalesce(p_minerals, 0));

  -- ① 개연성 캡: pve_run 만. 의뢰는 **서버 재실행 증거가 있으므로 증거가 캡을 대체한다** —
  --   이 가드가 이미 그렇게 동작하므로 추가 코드가 없다는 사실을 계약으로 명문화한다.
  if p_source = 'pve_run' then
    v_final_tick := greatest(0, case
      when (p_metrics->>'finalTick') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_metrics->>'finalTick')::numeric else 0 end);
    v_stage := greatest(0, case
      when (p_metrics->>'stage') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_metrics->>'stage')::numeric else 0 end);
    if current_setting('app.in_settle', true) = '1'
       and (p_metrics->>'resourceMult') ~ '^-?[0-9]+(\.[0-9]+)?$' then
      v_res_mult := (p_metrics->>'resourceMult')::numeric;
    end if;
    v_res_mult := least(greatest(1, v_res_mult), CAP_RESOURCE_MULT_MAX);
    v_plaus_credits  := PLAUSIBILITY_CREDITS_PER_TICK  * v_final_tick * (1 + v_stage) * v_res_mult;
    v_plaus_minerals := PLAUSIBILITY_MINERALS_PER_TICK * v_final_tick * (1 + v_stage) * v_res_mult;
  end if;

  -- ② per-call 캡. ⚠️ commission 분기가 없으면 최종 지시의 확정 보상이 else 로 떨어져
  --   **조용히 1,000 으로 클램프된다.**
  case p_source
    when 'pve_run' then
      v_call_credits  := CAP_PVE_RUN_CREDITS  * v_res_mult;
      v_call_minerals := CAP_PVE_RUN_MINERALS * v_res_mult;
    when 'salvage' then v_call_credits := CAP_SALVAGE_CREDITS; v_call_minerals := CAP_SALVAGE_MINERALS;
    when 'story'   then v_call_credits := CAP_STORY_CREDITS;   v_call_minerals := 0;
    when 'commission' then
      v_call_credits  := CAP_COMMISSION_CREDITS;
      v_call_minerals := CAP_COMMISSION_MINERALS;
    else                v_call_credits := CAP_DEFAULT_CREDITS; v_call_minerals := CAP_DEFAULT_MINERALS;
  end case;

  perform 1 from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object(
      'granted_credits', 0, 'granted_minerals', 0,
      'credits_left', 0, 'minerals_left', 0,
      'clamped', (v_claim_credits > 0 or v_claim_minerals > 0),
      'note', 'no-profile'
    );
  end if;

  -- ③ 누적 캡: 폭주 방어이지 개연성 판정이 아니므로 **재실행 증거가 대체하지 않는다.**
  select coalesce(sum(credits), 0), coalesce(sum(minerals), 0)
    into v_1h_credits, v_1h_minerals
    from public.currency_grants
    where profile_id = v_me and created_at > now() - interval '1 hour';
  select coalesce(sum(credits), 0), coalesce(sum(minerals), 0)
    into v_24h_credits, v_24h_minerals
    from public.currency_grants
    where profile_id = v_me and created_at > now() - interval '24 hours';

  v_rem_credits := least(
    greatest(0, CAP_HOURLY_CREDITS - v_1h_credits),
    greatest(0, CAP_DAILY_CREDITS  - v_24h_credits)
  );
  v_rem_minerals := least(
    greatest(0, CAP_HOURLY_MINERALS - v_1h_minerals),
    greatest(0, CAP_DAILY_MINERALS  - v_24h_minerals)
  );

  v_grant_credits  := greatest(0, least(v_claim_credits,  v_plaus_credits,  v_call_credits,  v_rem_credits));
  v_grant_minerals := greatest(0, least(v_claim_minerals, v_plaus_minerals, v_call_minerals, v_rem_minerals));

  v_clamped := (v_grant_credits < v_claim_credits) or (v_grant_minerals < v_claim_minerals);

  v_ref_credits  := least(v_plaus_credits,  v_call_credits);
  v_ref_minerals := least(v_plaus_minerals, v_call_minerals);
  if (v_ref_credits  > 0 and v_claim_credits  > FLAG_MULTIPLE * v_ref_credits)
     or (v_ref_minerals > 0 and v_claim_minerals > FLAG_MULTIPLE * v_ref_minerals)
     or (p_source = 'pve_run' and v_final_tick <= 0
         and (v_claim_credits > 0 or v_claim_minerals > 0)) then
    v_flag := true;
  end if;

  update public.profiles
    set credits  = credits  + v_grant_credits,
        minerals = minerals + v_grant_minerals,
        flagged  = case when v_flag then true else flagged end
    where id = v_me
    returning credits, minerals into v_credits_left, v_minerals_left;

  -- 실지급이 있을 때만 원장 기록. 누적 캡의 근거다 — 우회하면 의뢰 축이 1h/24h 캡 밖으로 나간다
  -- (apply_invasion_result 선례가 정확히 그렇게 원장을 우회한다. 그것을 복제하지 않는다).
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

-- ⚠️ Postgres 는 함수 생성 시 **PUBLIC 에 EXECUTE 를 자동 부여**한다. 아래 revoke 가 빠지면
--    authenticated 가 PUBLIC 을 통해 도달해 위임 구조 전체가 무효가 된다(클라가 래퍼를 우회해
--    grant_currency_for(me, …, 'commission') 을 직접 부른다).
--    중첩 definer 호출은 current_user=postgres 라 grant 없이도 통과한다.
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from public;
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from anon;
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from authenticated;
grant execute on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) to service_role;

comment on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) is
  '재화 지급 공유 본문(수령자 매개변수화). 캡 산식·currency_grants 원장 기록의 단일 정본. service_role 전용 — 클라 진입점은 grant_currency 래퍼다.';

-- grant_currency 를 위임 래퍼로 축소한다. **시그니처·권한 불변**(기존 호출부 무영향).
-- 게이트는 진입점이 진다: 캡 표는 공유 본문에 있고 source 판정은 여기서 한다.
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
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'grant_currency: 로그인 필요';
  end if;

  -- ⚠️ **allowlist(default-deny)**. blocklist 로 'commission' 하나만 막으면 이미 열려 있는 더 큰
  --    구멍(미등록 source → CAP_DEFAULT_* 1,000 창구)이 그대로 남는다. 통과 집합을 유한 리터럴
  --    3종으로 고정하면 대소문자·공백 정규화 문제도 함께 닫힌다.
  --    전수 근거: 'pve_run'=settle_pve_run 중첩 호출 · 'story'=사연 보상 · 'salvage'=격납고 살베지.
  --    미러: src/run/commissionServerConstants.ts GRANT_CURRENCY_CLIENT_SOURCES.
  if p_source is null or p_source not in ('pve_run', 'salvage', 'story') then
    raise exception 'grant_currency: 허용되지 않은 source(%)', p_source;
  end if;

  -- 왜 is_service_role() 로 게이트하지 않는가: 이 함수는 definer(소유자 postgres)라 그 안에서
  -- is_service_role() 이 **항상 참**이다. caller_is_service_role()(JWT) 로 막으면 정문이
  -- service_role 전용이 되어 클라의 story·salvage 지급이 깨진다. source 거부가 유일하게 정합하다.
  return public.grant_currency_for(v_me, p_credits, p_minerals, p_source, p_metrics);
end;
$$;

revoke all on function public.grant_currency(numeric, numeric, text, jsonb) from public;
revoke all on function public.grant_currency(numeric, numeric, text, jsonb) from anon;
grant execute on function public.grant_currency(numeric, numeric, text, jsonb) to authenticated, service_role;

comment on function public.grant_currency(numeric, numeric, text, jsonb) is
  '재화 지급 클라 진입점. source allowlist(pve_run/salvage/story) 로 default-deny 후 grant_currency_for 에 위임한다.';

-- =============================================================================
-- 6. 발령 경로 — issue_commission_for_run + pve_runs AFTER 트리거 (계약 §4)
-- =============================================================================
-- 권한: **어떤 role 에도 EXECUTE 를 주지 않는다.** 호출자는 트리거 하나뿐이고, 트리거 함수가
-- definer(소유자 postgres)라 EXECUTE 가 통과한다. 계획이 원한 "발령을 독립 RPC 로 노출하지
-- 않는다"가 명명 규율이 아니라 **권한 구조**로 실현된다.
create or replace function public.issue_commission_for_run(
  p_pve_run_id uuid,
  p_profile_id uuid,
  p_summary    jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 미러: src/run/commissionServerConstants.ts
  CAP_ISSUE_ATTEMPTS_PER_HOUR constant int := 20;
  COMMISSION_STOCK_CAP        constant int := 12;
  -- ⚠️ **이 축에서 유일하게 정직한 사용자를 벌할 수 있는 상수다.** 너무 크면 정직한 속공 런이
  --    발령 자체를 못 받는다. finalTick = replay.inputs.length(src/net/pveRun.ts:46), TICK_RATE=60.
  --    실측(2026-08-01, 210런/승리 156): **최소 195틱**(3.25초) · p1 215 · p5 272 · p50 782.
  --    60 은 관측 최소의 31%. 낮게 잡아도 방어가 안 죽는 이유: 위조 처리량을 실제로 묶는 것은
  --    CAP_ISSUE_ATTEMPTS_PER_HOUR(20/h) 이고, 60틱이면 "실시간÷상수"가 시간당 3,600 이라
  --    20/h 가 항상 먼저 문다. 이 상수의 실제 역할은 finalTick:1 이 쿨다운을 문자 그대로 0 으로
  --    만드는 퇴화만 막는 것이다. 미러: src/run/commissionConstants.ts MIN_BOSS_KILL_TICKS.
  MIN_BOSS_KILL_TICKS         constant int := 60;
  -- payload 굴리기 placeholder 상수(계급별 구간 수·구간당 틱 상한). 미러:
  -- src/run/commissionConstants.ts COMMISSION_SEGMENT_COUNT / COMMISSION_SEGMENT_TICK_CAP.
  SEGMENT_TICK_CAP            constant int := 9000;
  PLANET_COUNT                constant int := 6;

  v_victory  boolean;
  v_ft       int;
  v_n        int;
  v_horizon  timestamptz;
  v_cnt      int;
  v_grade    int;
  v_roll     double precision;
  v_segments int;
  v_order    int;
  v_payload  jsonb;
  v_cid      uuid;
  v_segs     jsonb := '[]'::jsonb;
  i          int;
begin
  -- 0. **전체를 서브트랜잭션으로 감싼다.** 아래 어느 단계에서 예외가 나도 바깥 정산은 커밋된다.
  --    이 DDL 자신이 예외 원천을 여럿 갖고 있다(grade check · payload not null · skip_reason check
  --    · granted not null · profiles FK). 하나만 터져도 정산 트랜잭션 전체가 롤백돼
  --    **전 플레이어가 자원을 못 받고 화면은 조용하다.**
  begin
    v_victory := (p_summary->>'victory' = 'true' and p_summary->>'bossKilled' = 'true');
    v_ft := greatest(0, case
      when (p_summary->>'finalTick') ~ '^[0-9]+$' then (p_summary->>'finalTick')::int
      else 0 end);

    -- 1. 1회성 앵커. 자격 판정보다 **앞에서** 행을 넣어야 빈도 상한이 시도를 셀 수 있다.
    insert into public.commission_issues
      (pve_run_id, profile_id, granted, claimed_victory, claimed_final_tick)
    values (p_pve_run_id, p_profile_id, false, v_victory, v_ft)
    on conflict (pve_run_id) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      return;   -- 이미 발령 판정을 거친 앵커. 트리거가 중복 발화해도 여기서 멈춘다.
    end if;

    -- 2. 자격 + 개연성 하한. **하한이 없으면 3b 를 공격자가 0 으로 만든다** —
    --    (a)와 (b)는 독립 방어가 아니라 한 방어의 두 조각이다.
    if not v_victory or v_ft < MIN_BOSS_KILL_TICKS then
      update public.commission_issues set skip_reason = 'not-victory'
        where pve_run_id = p_pve_run_id;
      return;
    end if;

    -- 3. 빈도 상한. **claimed_victory 인 행만** 센다. 1단계에서 자기 행을 이미 넣었으므로
    --    자기 자신이 카운트에 포함된다 — 상수 20 은 그 포함 기준이다.
    select count(*) into v_cnt from public.commission_issues
      where profile_id = p_profile_id
        and claimed_victory
        and created_at > now() - interval '1 hour';
    if v_cnt >= CAP_ISSUE_ATTEMPTS_PER_HOUR then
      update public.commission_issues set skip_reason = 'rate' where pve_run_id = p_pve_run_id;
      return;
    end if;

    -- 3b. 쿨다운 — **"직전 행 읽기"가 아니라 "미래 예약 누적기"다.** 직전 행 기준이면 긴 주장과
    --     짧은 주장을 번갈아 파이프라이닝할 수 있다. 누적기는 어떤 창에서도
    --     "발령된 런들이 주장한 시간의 합 ≤ 실제 경과 시간"을 성립시킨다.
    select coalesce(max(next_eligible_at), now()) into v_horizon
      from public.commission_issues where profile_id = p_profile_id;
    if v_horizon > now() then
      update public.commission_issues set skip_reason = 'cooldown' where pve_run_id = p_pve_run_id;
      return;
    end if;

    -- 4. 재고 상한. 소비하면 다시 차므로 **빈도 상한과는 다른 축**이다.
    select count(*) into v_cnt from public.commission_inventory where profile_id = p_profile_id;
    if v_cnt >= COMMISSION_STOCK_CAP then
      update public.commission_issues set skip_reason = 'stock' where pve_run_id = p_pve_run_id;
      return;
    end if;

    -- 5. 계급·payload 를 굴린다(RNG 는 서버, sim 해시와 무관).
    --    ⚠️ **이 굴리기 표는 placeholder 다** — 계급별 발령 확률(밸런스 큐 C3)과 보상 표는
    --    아직 확정되지 않았다. 형태(CommissionPayload)만 계약대로 채운다.
    --    **보유 유니크를 제외하지 않는다 — 중복 지급을 허용한다**(서버가 갖지 않은 원장을
    --    전제하지 않기 위함).
    -- ⚠️ **한 번만 뽑아서 그 하나를 누적 경계와 비교한다.** `case when random() < a … when
    --    random() < b …` 는 `random()` 이 volatile 이라 **분기마다 새로 뽑는다** — 경계가 누적
    --    CDF 처럼 읽히는데 실제 분포는 조건부 곱(0.55 / 0.3375 / 0.1046 / 0.0079)이 되어
    --    최종 계급이 의도(7%)의 9분의 1로 나온다. 눈으로는 맞아 보이고 테스트도 분포를 안 세면
    --    통과하는 형태라 여기 못 박는다.
    v_roll := random();
    v_grade := case
      when v_roll < 0.55 then 1
      when v_roll < 0.75 then 2
      when v_roll < 0.93 then 3
      else 4 end;
    v_segments := case v_grade when 1 then 2 when 2 then 3 when 3 then 4 else 5 end;
    v_order := floor(random() * 4)::int;   -- COMMISSION_ORDERS wire 인덱스(append-only).

    for i in 0 .. v_segments - 1 loop
      v_segs := v_segs || jsonb_build_array(jsonb_build_object(
        'planet', floor(random() * PLANET_COUNT)::int,
        'stage',  1 + floor(random() * (1 + v_grade))::int
      ));
    end loop;

    v_cid := gen_random_uuid();
    v_payload := jsonb_build_object(
      'version', 1,
      'commissionId', v_cid::text,
      'grade', v_grade,
      'order', (array['chain','constraint','bounty','elite'])[v_order + 1],
      'segments', v_segs,
      'rewards', jsonb_build_object(
        'credits',  v_grade * 2500,
        'minerals', v_grade * 2500,
        'items',    '[]'::jsonb
      ),
      'replayBudgetTicks', v_segments * SEGMENT_TICK_CAP
    );

    -- 6. 발령 + **지평 전진은 granted 일 때만**. 미발령 행은 default now() 라 max 에 영향이 없다.
    insert into public.commission_inventory (commission_id, profile_id, grade, payload)
      values (v_cid, p_profile_id, v_grade, v_payload);

    update public.commission_issues
       set granted = true,
           commission_id = v_cid,
           next_eligible_at = greatest(now(), v_horizon)
                              + make_interval(secs => v_ft / 60.0)
     where pve_run_id = p_pve_run_id;

  exception when others then
    -- 서브트랜잭션만 롤백. 바깥 정산은 커밋된다.
    -- **fail-closed**: 1단계 앵커 행도 함께 사라지지만 그 pve_runs 행은 이미 verified 로 커밋돼
    -- 트리거가 재발화하지 않는다(아래 old/tg_op 가드). 결과는 "의뢰서 미발령"이고 지급 쪽으로
    -- 새지 않는다. **자인**: 그래서 발령 실패는 플레이어에게 보이지 않는다 — warning 발생률을 관측한다.
    raise warning 'issue_commission_for_run 실패(pve_run_id=%): %', p_pve_run_id, sqlerrm;
    return;
  end;
end;
$$;

revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from public;
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from anon;
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from authenticated;
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from service_role;

comment on function public.issue_commission_for_run(uuid, uuid, jsonb) is
  '의뢰서 발령(내부 전용). 어떤 role 에도 EXECUTE 가 없다 — 호출자는 pve_runs AFTER 트리거 하나뿐이다.';

create or replace function public.trg_commission_issue_on_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- tg_op / old 가드로 verified → verified 재기록에서 재발화하지 않는다.
  -- 그래도 commission_issues 의 PK 가 최종 방어다(두 겹: 술어 가드 + 구조 제약).
  if new.verified_status = 'verified'
     and (tg_op = 'INSERT' or old.verified_status is distinct from 'verified') then
    perform public.issue_commission_for_run(new.id, new.profile_id, new.summary);
  end if;
  return null;   -- AFTER 트리거이므로 반환값은 무시된다.
end;
$$;

-- 트리거는 UPDATE 분기(촉매 런)와 INSERT 분기(무촉매 런) **양쪽에서** 발화한다.
-- 클라는 verified 행을 만들 수 없다: pve_runs 에 authenticated 용 정책은 insert·select 둘뿐이고
-- BEFORE 트리거 guard_pve_runs_client_insert() 가 클라 INSERT 의 verified_status 를 pending 으로 강제한다.
drop trigger if exists pve_runs_issue_commission on public.pve_runs;
create trigger pve_runs_issue_commission
  after insert or update of verified_status on public.pve_runs
  for each row execute function public.trg_commission_issue_on_verified();

-- =============================================================================
-- 7. 런 RPC (계약 §5-2 ~ §5-7)
-- =============================================================================

-- 7-1. consume_commission — 출격 (§5-2)
-- 잠금 순서: commission_inventory 1행만 잠근다. 2·3·4 가 한 트랜잭션이라
-- "의뢰서 1장 = commission_runs 1행"이 원자적이다.
create or replace function public.consume_commission(
  p_commission_id uuid,
  p_loadout       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  CAP_CONSUME_PER_HOUR constant int := 12;   -- 미러: commissionServerConstants.ts
  v_me      uuid := auth.uid();
  v_cnt     int;
  v_grade   int;
  v_payload jsonb;
  v_run_id  uuid;
begin
  if v_me is null then
    raise exception 'consume_commission: 로그인 필요';
  end if;

  -- 상한을 **행 생성 지점**에 둔다. 상태 전이 지점(mark_active)에 두는 것보다 구조적으로 강하다.
  select count(*) into v_cnt from public.commission_runs
    where profile_id = v_me and created_at > now() - interval '1 hour';
  if v_cnt >= CAP_CONSUME_PER_HOUR then
    raise exception 'consume_commission: 출격 빈도 상한 초과';
  end if;

  select grade, payload into v_grade, v_payload
    from public.commission_inventory
   where commission_id = p_commission_id and profile_id = v_me
   for update;
  if not found then
    raise exception 'consume_commission: 의뢰서 없음';
  end if;

  delete from public.commission_inventory where commission_id = p_commission_id;

  -- p_loadout 은 클라 미러에서 온 값이다 — 봉인 대조가 닫는 것은 "출격 후 편집"뿐이고
  -- 출격 **전** 위조는 열려 있다(ADR-0044 §한 겹 방어 · ADR-0028). 방어력을 주장하지 않는다.
  insert into public.commission_runs
    (profile_id, commission_id, grade, status, payload, loadout_sealed)
  values (v_me, p_commission_id, v_grade, 'issued', v_payload, coalesce(p_loadout, '{}'::jsonb))
  returning run_id into v_run_id;

  return jsonb_build_object('run_id', v_run_id, 'payload', v_payload);
end;
$$;

revoke all on function public.consume_commission(uuid, jsonb) from public;
revoke all on function public.consume_commission(uuid, jsonb) from anon;
grant execute on function public.consume_commission(uuid, jsonb) to authenticated, service_role;

-- 7-2. mark_commission_active — 런 시작 신호 (§5-3)
-- **시한을 전이 자체에 박는 것이 핵심이다.** 없으면 "신호 안 보내고 런을 돌린 뒤, 이기면 그때
-- 신호+제출 / 지면 방치→회수"가 성립한다. cron 지연과 무관하게 판정된다.
create or replace function public.mark_commission_active(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  GRACE_ISSUED_TO_ACTIVE constant interval := interval '10 minutes';  -- 미러: commissionServerConstants.ts
  v_status     text;
  v_created_at timestamptz;
  v_started_at timestamptz;
begin
  select status, created_at into v_status, v_created_at
    from public.commission_runs
   where run_id = p_run_id and profile_id = auth.uid()
   for update;
  if not found then
    raise exception 'mark_commission_active: 행 없음';
  end if;

  -- **no-op 이 아니라 명시 거부** — 조용한 no-op 은 무엇이 막았는지 갈리지 않게 만든다.
  if v_status <> 'issued' then
    raise exception 'mark_commission_active: 전이 불가 상태(%)', v_status;
  end if;
  if v_created_at < now() - GRACE_ISSUED_TO_ACTIVE then
    raise exception 'mark_commission_active: 전이 시한 초과';
  end if;

  update public.commission_runs
     set status = 'active', started_at = now()
   where run_id = p_run_id and status = 'issued'
   returning started_at into v_started_at;

  return jsonb_build_object('run_id', p_run_id, 'started_at', v_started_at);
end;
$$;

revoke all on function public.mark_commission_active(uuid) from public;
revoke all on function public.mark_commission_active(uuid) from anon;
grant execute on function public.mark_commission_active(uuid) to authenticated, service_role;

-- 7-3. bump_commission_verify_attempts — EF 재실행 시도 카운터 (§5-7)
-- ⚠️ **별도 트랜잭션이어야 한다는 것이 이 RPC 존재 이유의 전부다.** settle_commission 안에 넣으면
--    중도 abort 한 시도가 롤백으로 사라져 카운터가 무력해진다 — 공격이 정확히 "응답 직전 연결을
--    끊는" 형태이므로, 그 경우에 남지 않는 카운터는 아무것도 막지 못한다. EF 는 PostgREST 로 RPC 를
--    개별 호출하므로 각 호출이 자기 트랜잭션이다(구조로 성립).
create or replace function public.bump_commission_verify_attempts(p_run_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.caller_is_service_role() then
    raise exception 'bump_commission_verify_attempts: service_role 전용 호출';
  end if;
  update public.commission_runs
     set verify_attempts = verify_attempts + 1
   where run_id = p_run_id and status = 'active'
   returning verify_attempts into v_n;
  return v_n;   -- 행이 없거나 active 가 아니면 null → EF 가 거부한다.
end;
$$;

revoke all on function public.bump_commission_verify_attempts(uuid) from public;
revoke all on function public.bump_commission_verify_attempts(uuid) from anon;
revoke all on function public.bump_commission_verify_attempts(uuid) from authenticated;
grant execute on function public.bump_commission_verify_attempts(uuid) to service_role;

-- 7-4. settle_commission — 확정 지급 (§5-4)
-- **단일 트랜잭션 원자성이 곧 멱등이다.** 중간에 실패하면 6·7·8 이 전부 롤백되어 부분 상태가
-- 존재하지 않고, 성공하면 8 이 커밋되어 3 이 이후 모든 재호출을 흡수한다.
-- → 재시도 주체는 **클라이언트**다(같은 run_id 로 verify-commission 재호출). 서버 측 재시도 cron 을
--   만들지 않는다 — 실패한 트랜잭션은 아무 흔적도 남기지 않으므로 cron 이 볼 것이 없다.
--   ⚠️ ADR-0045 §결과 첫 항("부분 실패가 나면…")은 이 사실 앞에서 개정 대상이다.
-- 잠금 순서: commission_runs(2) → profiles(7 안에서 grant_currency_for 가). 항상 이 순서다.
create or replace function public.settle_commission(
  p_run_id          uuid,
  p_verdict         text,
  p_verified_result jsonb,
  p_run_credits     numeric,
  p_run_minerals    numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ACTIVE_TTL constant interval := interval '24 hours';   -- 미러: commissionServerConstants.ts
  v_run      public.commission_runs%rowtype;
  v_rewards  jsonb;
  v_uniques  jsonb;
  v_bps      jsonb;
  v_grant    jsonb;
  v_grants   jsonb := '[]'::jsonb;
  v_elem     jsonb;
  i          int;
begin
  -- 1. 정문(apply_invasion_result:289-291 동형 — JWT 기준 판별자를 쓴다).
  if not public.caller_is_service_role() then
    raise exception 'settle_commission: service_role 전용 호출';
  end if;

  -- 2. 잠금 시작.
  select * into v_run from public.commission_runs where run_id = p_run_id for update;
  if not found then
    raise exception 'settle_commission: 런 없음';
  end if;

  -- 3. 멱등 — 확정된 판정을 그대로 돌려준다.
  if v_run.status in ('verified', 'rejected') then
    return coalesce(v_run.verified_result, '{}'::jsonb) || jsonb_build_object('note', 'already-finalized');
  end if;

  -- 4. issued/expired/abandoned 는 **cron 실행 여부와 무관하게** 거부된다.
  if v_run.status <> 'active' then
    raise exception 'settle_commission: active 아님(%)', v_run.status;
  end if;

  -- 4b. 나이 검사를 **판정 지점에 직접** 박는다. cron 은 매시 정각이라 여기에 없으면
  --     started_at+24h 를 넘긴 런이 최대 1시간 제출 가능해진다.
  if v_run.started_at is null or v_run.started_at <= now() - ACTIVE_TTL then
    raise exception 'settle_commission: active 만료(%)', v_run.started_at;
  end if;

  -- 5. 거부 판정 — 실패 런 종결, 보상 0.
  if p_verdict is distinct from 'accept' then
    update public.commission_runs
       set status = 'rejected', verified_at = now(), verified_result = p_verified_result
     where run_id = p_run_id and status = 'active';
    return jsonb_build_object(
      'granted_credits', 0, 'granted_minerals', 0,
      'credits_left', 0, 'minerals_left', 0,
      'clamped', false, 'grants', '[]'::jsonb, 'verdict', 'rejected'
    );
  end if;

  v_rewards := coalesce(v_run.payload->'rewards', '{}'::jsonb);

  -- 6. commission_grants 삽입. slot_index 는 payload.rewards 안 kind 별 0-based 순번이라
  --    payload 가 고정된 이상 **결정적**이고, 따라서 재시도가 같은 키를 만든다.
  --    ⚠️ uniqueId(스칼라)와 uniqueIds(배열) 두 형태를 모두 받는다 — 현행 CommissionPayload 는
  --    스칼라 하나만 표현하지만 계약 AC-M4 는 같은 kind 2개를 요구한다(서버 계약 §13-③ 미확인).
  --    배열 형태가 확정되면 이 분기의 스칼라 쪽만 지우면 된다.
  v_uniques := case
    when jsonb_typeof(v_rewards->'uniqueIds') = 'array' then v_rewards->'uniqueIds'
    when v_rewards ? 'uniqueId' and jsonb_typeof(v_rewards->'uniqueId') <> 'null'
      then jsonb_build_array(v_rewards->'uniqueId')
    else '[]'::jsonb end;
  v_bps := case
    when jsonb_typeof(v_rewards->'blueprints') = 'array' then v_rewards->'blueprints'
    else '[]'::jsonb end;

  for i in 0 .. jsonb_array_length(v_uniques) - 1 loop
    v_elem := jsonb_build_object('uniqueId', v_uniques->i);
    insert into public.commission_grants
      (profile_id, commission_run_id, kind, slot_index, item_payload)
    values (v_run.profile_id, p_run_id, 'unique', i, v_elem)
    on conflict on constraint commission_grants_once do nothing;
    v_grants := v_grants || jsonb_build_array(
      jsonb_build_object('kind', 'unique', 'slot_index', i, 'item_payload', v_elem));
  end loop;

  for i in 0 .. jsonb_array_length(v_bps) - 1 loop
    v_elem := jsonb_build_object('blueprintId', v_bps->i);
    insert into public.commission_grants
      (profile_id, commission_run_id, kind, slot_index, item_payload)
    values (v_run.profile_id, p_run_id, 'blueprint', i, v_elem)
    on conflict on constraint commission_grants_once do nothing;
    v_grants := v_grants || jsonb_build_array(
      jsonb_build_object('kind', 'blueprint', 'slot_index', i, 'item_payload', v_elem));
  end loop;

  -- 7. 자원 지급 **1회** — 확정 보상 + 재실행 finalState 자원 축을 합산한다.
  --    행성 인기 배율을 읽지 않는다(ADR-0038 "대체 가능한 보상에만 배율"; 의뢰 런 config 에
  --    planetMultCenti/planetMultEpoch 를 스탬프하지 않으므로 적용할 입력 자체가 없다).
  --    app.in_settle 을 세우지 않는다(촉매 주입 불가라 배율이 없다).
  v_grant := public.grant_currency_for(
    v_run.profile_id,
    coalesce((v_rewards->>'credits')::numeric, 0)  + greatest(0, coalesce(p_run_credits, 0)),
    coalesce((v_rewards->>'minerals')::numeric, 0) + greatest(0, coalesce(p_run_minerals, 0)),
    'commission',
    null
  );

  -- 8. 종결.
  update public.commission_runs
     set status = 'verified', verified_at = now(), verified_result = p_verified_result
   where run_id = p_run_id and status = 'active';

  return v_grant || jsonb_build_object('grants', v_grants, 'verdict', 'verified');
end;
$$;

revoke all on function public.settle_commission(uuid, text, jsonb, numeric, numeric) from public;
revoke all on function public.settle_commission(uuid, text, jsonb, numeric, numeric) from anon;
revoke all on function public.settle_commission(uuid, text, jsonb, numeric, numeric) from authenticated;
grant execute on function public.settle_commission(uuid, text, jsonb, numeric, numeric) to service_role;

-- 7-5. store_commission_replay_gz — 압축 보존 (§5-5)
-- 침공판(20260726000100:42-60)을 복제하되 **원본 jsonb null 화 두 줄을 뺀다** — 그 컬럼이 없다.
-- **get_* 대응 RPC 를 만들지 않는다** — 의뢰는 관전이 없다.
create or replace function public.store_commission_replay_gz(p_run_id uuid, p_gz text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.caller_is_service_role() then
    raise exception 'store_commission_replay_gz: service_role 전용 호출';
  end if;
  update public.commission_runs
     set replay_gz = decode(p_gz, 'base64')
   where run_id = p_run_id;
end;
$$;

revoke all on function public.store_commission_replay_gz(uuid, text) from public;
revoke all on function public.store_commission_replay_gz(uuid, text) from anon;
revoke all on function public.store_commission_replay_gz(uuid, text) from authenticated;
grant execute on function public.store_commission_replay_gz(uuid, text) to service_role;

-- =============================================================================
-- 8. cron (계약 §6)
-- =============================================================================
-- cron.schedule 은 (jobname) upsert 라 재적용 안전하다.
-- ⚠️ **모든 테이블을 public. 으로 수식한다** — pg_cron 은 스케줄 롤의 search_path 로 돌아
--    `set search_path=''` 규율 **밖**이다.
create extension if not exists pg_cron;

-- ① issued 회수. **상태 전이를 구동자로 삼는 단일 CTE 문장이어야 한다.**
--    "insert 먼저, update 나중"이면 INSERT 성공 + UPDATE 0행일 때 재고에 의뢰서가 돌아갔는데 런은
--    issued 로 살아 있다 = **1장이 2장**이다. update … returning 이 행 잠금과 술어 평가를 함께 하므로
--    전이에 성공한 행만 INSERT 입력이 되어 그 상태가 원리적으로 불가능해진다.
--    회수 지연(최대 1h)은 방어에 영향이 없다 — 착취 차단은 mark_commission_active 의 전이 시한과
--    settle_commission ④의 status='active' 요구가 진다. cron 은 의뢰서를 돌려주는 편의 장치일 뿐이다.
select cron.schedule(
  'planet-blitz-recover-commission-issued',
  '0 * * * *',
  $$ with moved as (
       update public.commission_runs
          set status = 'expired'
        where status = 'issued'
          and created_at < now() - interval '10 minutes'
       returning commission_id, profile_id, grade, payload
     )
     insert into public.commission_inventory (commission_id, profile_id, grade, payload)
     select commission_id, profile_id, grade, payload from moved
     on conflict (commission_id) do nothing; $$
);

-- ② replay blob GC. 술어가 `replay_gz is not null` 인 이유: 클라가 원본 jsonb 를 넣을 경로가
--    존재하지 않으므로(쓰기 정책 0개) 침공판의 "원본 replay 도 함께 지운다"가 여기서는 무의미하다.
--    조기 거부의 저장 비용은 0 이다 — 게이트 0~6 에서 거부되면 store_commission_replay_gz 를
--    아예 호출하지 않으므로 DB 에 아무것도 안 남는다.
select cron.schedule(
  'planet-blitz-gc-commission-replays',
  '0 * * * *',
  $$ update public.commission_runs
        set replay_gz = null
      where status in ('verified','rejected','abandoned')
        and verified_at is not null
        and verified_at < now() - interval '48 hours'
        and replay_gz is not null; $$
);

-- ③ 버려진 active 종결. **회수하지 않는다** — active 는 런이 시작됐다는 뜻이고, 돌려주면
--    "출격 → 지고 있음을 확인 → 프로세스 종료 → 24h 뒤 의뢰서 회수"가 성립한다.
--    CONTEXT.md 가 "수락(출격)하는 순간 소모된다 — 실패하면 그 의뢰서는 사라진다"를 정본으로
--    못 박았으므로 **회수하지 않는 것이 도메인 규칙이고 회수하는 쪽이 예외였다.**
--    ⚠️ verified_at 을 세우는 것이 ②로 넘기는 배턴이다 — 안 세우면 abandoned 행의 blob 이 영구 잔존한다.
select cron.schedule(
  'planet-blitz-abandon-commission-active',
  '0 * * * *',
  $$ update public.commission_runs
        set status = 'abandoned', verified_at = now()
      where status = 'active'
        and started_at < now() - interval '24 hours'; $$
);

-- ④ 발령 원장 GC. 빈도 창(1h) 대비 168배 여유라 상한이 GC 로 뚫리지 않는다.
--    쿨다운 지평도 최대 replayBudgetTicks/60 초(분 단위)라 GC 시점에는 이미 과거다.
--    시각은 일간 GC 가 몰린 02:00 UTC 대에 두되 기존 0 2 · 15 2 · 25 2 와 겹치지 않는 분을 쓴다.
select cron.schedule(
  'planet-blitz-gc-commission-issues',
  '20 2 * * *',
  $$ delete from public.commission_issues
      where created_at < now() - interval '7 days'; $$
);
