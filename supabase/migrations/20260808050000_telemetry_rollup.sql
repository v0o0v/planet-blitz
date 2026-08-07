-- =============================================================================
-- 텔레메트리 일별 롤업 (ADR-0051 §결정 3 · §저장 예산)
-- =============================================================================
--
-- ## 배경
--
-- ADR-0051 이 봇 계측·완주 e2e 를 게이트에서 내리며 "밸런스는 출시 후 실유저 텔레메트리가
-- 본선"으로 방침을 세웠다. 원자재는 `pve_runs.summary`(settle_pve_run 이 `p_summary` 를
-- 그대로 적재 — 20260802000000:132/144)인데, 그 테이블은 **7일 GC**(20260727000000:127-131)
-- 라 패치 전후 비교가 성립하지 않는다(ADR-0048 이 이미 이 대가를 한 번 치렀다). 이 마이그레이션이
-- 그 격차를 메우는 **일별 집계 롤업**을 신설한다.
--
-- ## (가) 요약 필드 확장 — SQL 무수정으로 이미 끝나 있다
--
-- `settle_pve_run` 은 `p_summary`(클라 jsonb) 를 검증 없이 통째로 `pve_runs.summary` 에 넣는다.
-- 즉 클라 `PveSettleSummary`(src/net/gateway.ts)에 `shipType`·`playerLevel`·`xpTotal`·
-- `dropCount` 네 필드를 추가하기만 하면 **서버 SQL 을 한 줄도 안 고치고** 원장에 실린다
-- (커밋: src/net/gateway.ts · src/main.ts). ⛔ **`settle_pve_run` 본문은 이 마이그레이션에서도
-- 건드리지 않는다** — 5회 재정의된 함수이고 그 복제가 이미 PvE 정산을 100% 깨뜨린 전례가
-- 있다(20260802000000:4-15).
--
-- ## (나) 큐브 설계 — full-cross 금지, 주변화 둘로 쪼갠다
--
-- 실측 축 크기(2026-08-08, grep+read 로 확인):
--   · 행성 `PLANET_COUNT` = 6(src/economy/planetPopularity.ts:36)
--   · 기체 `SHIP_TYPES.length` = 7(data/ships/index.ts:64-72)
--   · 표준 밴드 수 `STANDARD_BAND_COUNT` = `LEVEL_CAP(100) / LEVEL_PER_STAGE(5)` = 20
--     (src/save/progressionPath.ts:32/35/52, data/waves.ts:28) — 레벨·침략 단계 둘 다 이
--     20구간을 정본으로 쓴다(`standardStage`/`gearDropStage`, ADR-0035).
--   · `stage`(런타임 침략 단계)는 **[1,∞) 무계**다(src/run/runConfig.ts:284-286 — 클램프가
--     하한뿐). 클라 제출값이라 그대로 GROUP BY 키로 쓰면 카디널리티가 무계로 열린다
--     (악성/버그 제출 방어이기도 하다) → 표준 밴드 20구간으로 접어(clamp) 쓴다.
--
--   full-cross(행성×기체×단계밴드×레벨밴드) = 6 × 7 × 20 × 20 = **16,800 셀/일**.
--   과제가 인용한 예산 12,000런/일과 비교하면 압축비 0.71 — **1 미만이라 롤업이 원본보다
--   커진다.** ADR-0051 §저장 예산이 경고한 정확히 그 실패 모드를 이 리포 실측 축 크기로도
--   재현한다. 그래서 **주변화 큐브 둘**로 쪼갠다:
--
--     큐브1 telemetry_daily_planet_stage = (일자 × 행성 × 단계밴드) = 6 × 20  = **120 셀/일**
--     큐브2 telemetry_daily_ship_level   = (일자 × 기체  × 레벨밴드) = 7 × 20  = **140 셀/일**
--     합계 = **260 셀/일** — 12,000런/일 대비 압축비 **약 46배**.
--
--   저장 예산(연, 365일 기준): 260 셀/일 × 365일 ≈ 94,900 행. 행당 실측 열 폭(day 4B +
--   dim×2 4B×2 + run_count·win_count bigint 8B×2 + sum_final_tick·sum_xp_total numeric
--   가변(짧은 합계값 기준 실측 ~8B)×2 + sum_drop_count bigint 8B + 튜플 헤더~28B) ≈ 100~140B
--   → 연 **10~13MB**. ADR-0051 §저장 예산이 잡은 "연 89MB" 한도의 15% 내외라 여유가 크다
--   (그 문서는 열을 구체화하기 전 상한값이었다 — 이 마이그레이션이 실제 스키마로 재확인한다).
--
--   레벨/단계를 **20 밴드로 접는 근거**: 이 리포 밸런스 하네스(`src/bench/balance/axes.ts`)가
--   이미 `BAND_LEVELS`(레벨 축 정본)로 이 20구간을 쓴다 — 새 개념을 발명하지 않고 기존 정본을
--   재사용한다. 침략 단계도 표준 경로에서는 `standardStage(level)` 로 레벨과 동일 20구간에
--   묶인다(ADR-0035) — 롤업의 stage_band 는 그 정본과 같은 클램프(`least(20, greatest(1,·))`)
--   식만 SQL 로 미러한다.
--
-- ## 보존 정책
--
-- 원시 `pve_runs` 는 기존 7일 GC 유지(무변경). 롤업은 그 자체가 "패치 전후 비교"용이라
-- 7일로는 성립하지 않으므로 **400일**(1년 + 여유 5주 — 연간 비교 구간이 경계에서 잘리지
-- 않게)로 별도 GC 잡을 둔다. 260 셀/일 규모에서 400일치는 약 10만 4천 행(≈11~15MB) —
-- 위 저장 예산 산수와 정합한다.
--
-- ## 클라 쓰기 정책 없음
--
-- 롤업 테이블은 RLS 를 켜되 **정책을 0개**로 둔다 — select 도 클라가 볼 이유가 없다
-- (밴서/의뢰 UI 처럼 표시할 화면이 없다, 순수 내부 분석용). service_role 은 RLS 를 우회하므로
-- (Supabase 기본 규율) 정책 없이도 cron·`bench/` 스크립트가 서비스 키로 자유롭게 읽는다.
-- definer 함수가 이 테이블에 쓰는 것도 같은 이유로 guard 가 필요 없다 — 함수 소유자(postgres)가
-- 테이블 소유자라 RLS 를 그대로 우회한다(다른 definer 함수와 동일 규율, `is_service_role()`
-- 은 **클라 직접 insert 를 막는 guard 트리거**에만 필요한데 이 테이블엔 클라 insert 경로 자체가
-- 없다).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 큐브1 — telemetry_daily_planet_stage (일자 × 행성 × 단계밴드)
-- -----------------------------------------------------------------------------
create table if not exists public.telemetry_daily_planet_stage (
  day            date    not null,
  planet         integer not null,
  stage_band     integer not null,
  run_count      bigint  not null default 0,
  win_count      bigint  not null default 0,
  sum_final_tick numeric not null default 0,
  sum_xp_total   numeric not null default 0,
  sum_drop_count bigint  not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (day, planet, stage_band)
);

alter table public.telemetry_daily_planet_stage enable row level security;
-- 정책 0개(의도) — service_role 만 읽고 쓴다. 위 헤더 "클라 쓰기 정책 없음" 참고.

-- -----------------------------------------------------------------------------
-- 2. 큐브2 — telemetry_daily_ship_level (일자 × 기체 × 레벨밴드)
-- -----------------------------------------------------------------------------
create table if not exists public.telemetry_daily_ship_level (
  day            date    not null,
  ship_type      integer not null,
  level_band     integer not null,
  run_count      bigint  not null default 0,
  win_count      bigint  not null default 0,
  sum_final_tick numeric not null default 0,
  sum_xp_total   numeric not null default 0,
  sum_drop_count bigint  not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (day, ship_type, level_band)
);

alter table public.telemetry_daily_ship_level enable row level security;
-- 정책 0개(의도) — service_role 만 읽고 쓴다.

-- -----------------------------------------------------------------------------
-- 3. 원본 스캔 보조 인덱스 — 하루 범위 조회를 저비용으로
-- -----------------------------------------------------------------------------
-- 롤업이 읽는 행은 "정산 요약 행"뿐이다(started_at is null — 20260808000000 §1 이 시작 등록
-- 행과 구분하는 축. 정산 요약 행은 항상 started_at 이 null, 위 파일 참고). 부분 인덱스로
-- 시작 등록 행(다수·회전 빠름)을 스캔에서 제외한다.
create index if not exists pve_runs_verified_at_idx
  on public.pve_runs (verified_at)
  where verified_status = 'verified' and started_at is null;

-- -----------------------------------------------------------------------------
-- 4. rollup_telemetry_daily(p_day) — 지정 일자를 두 큐브에 집계(UPSERT, 재실행 안전)
-- -----------------------------------------------------------------------------
-- p_day 기본값 = 어제(UTC). 매 실행이 해당 일자를 통째로 재계산해 덮어써(멱등) 늦게 정산된
-- 행이나 재실행에도 값이 수렴한다. 숫자 캐스팅은 settle_pve_run 과 같은 정규식 가드 관용구
-- (비숫자/이형 payload 는 0 취급 — 크래시 대신 조용히 스킵).
create or replace function public.rollup_telemetry_daily(p_day date default (current_date - 1))
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_range_start timestamptz := p_day::timestamptz;
  v_range_end   timestamptz := (p_day + 1)::timestamptz;
  v_rows_1      integer;
  v_rows_2      integer;
begin
  -- 세션-로컬 임시 테이블에 파싱을 한 번만 해 둔다 — 두 큐브가 같은 원본을 각자 다른 축으로
  -- GROUP BY 하므로, INSERT 두 번이 파싱(정규식 가드 캐스팅)을 두 번 반복하지 않게 한다.
  -- 함수 종료 시 자동 drop(on commit drop, definer 함수 1회 호출 = 트랜잭션 1개).
  create temporary table pv_telemetry_parsed on commit drop as
    select
      case when (summary->>'planet') ~ '^[0-9]+$'
        then (summary->>'planet')::int else 0 end as planet,
      -- 단계밴드: 정본 클램프 least(20, greatest(1,·)) — 표준 밴드 수(STANDARD_BAND_COUNT=20,
      -- src/save/progressionPath.ts) 를 SQL 로 미러. stage 는 [1,∞) 무계라 반드시 접는다.
      least(20, greatest(1, case when (summary->>'stage') ~ '^[0-9]+$'
        then (summary->>'stage')::int else 1 end)) as stage_band,
      case when (summary->>'shipType') ~ '^[0-9]+$'
        then (summary->>'shipType')::int else 0 end as ship_type,
      -- 레벨밴드: 같은 20구간 클램프. playerLevel 은 [1, LEVEL_CAP=100] 이 정상 범위이나
      -- 방어적으로 동일 클램프를 적용한다(불량 제출이 카디널리티를 열지 못하게).
      least(20, greatest(1, case when (summary->>'playerLevel') ~ '^[0-9]+(\.[0-9]+)?$'
        then ceil((summary->>'playerLevel')::numeric / 5.0)::int else 1 end)) as level_band,
      (summary->>'victory')::boolean as victory,
      case when (summary->>'finalTick') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (summary->>'finalTick')::numeric else 0 end as final_tick,
      case when (summary->>'xpTotal') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (summary->>'xpTotal')::numeric else 0 end as xp_total,
      case when (summary->>'dropCount') ~ '^[0-9]+$'
        then (summary->>'dropCount')::bigint else 0 end as drop_count
    from public.pve_runs
    where verified_status = 'verified'
      and started_at is null
      and summary is not null
      and verified_at >= v_range_start
      and verified_at <  v_range_end;

  insert into public.telemetry_daily_planet_stage
    (day, planet, stage_band, run_count, win_count, sum_final_tick, sum_xp_total, sum_drop_count, updated_at)
  select
    p_day, planet, stage_band,
    count(*),
    count(*) filter (where victory),
    coalesce(sum(final_tick), 0),
    coalesce(sum(xp_total), 0),
    coalesce(sum(drop_count), 0),
    now()
  from pv_telemetry_parsed
  group by planet, stage_band
  on conflict (day, planet, stage_band) do update set
    run_count      = excluded.run_count,
    win_count      = excluded.win_count,
    sum_final_tick = excluded.sum_final_tick,
    sum_xp_total   = excluded.sum_xp_total,
    sum_drop_count = excluded.sum_drop_count,
    updated_at     = excluded.updated_at;
  get diagnostics v_rows_1 = row_count;

  insert into public.telemetry_daily_ship_level
    (day, ship_type, level_band, run_count, win_count, sum_final_tick, sum_xp_total, sum_drop_count, updated_at)
  select
    p_day, ship_type, level_band,
    count(*),
    count(*) filter (where victory),
    coalesce(sum(final_tick), 0),
    coalesce(sum(xp_total), 0),
    coalesce(sum(drop_count), 0),
    now()
  from pv_telemetry_parsed
  group by ship_type, level_band
  on conflict (day, ship_type, level_band) do update set
    run_count      = excluded.run_count,
    win_count      = excluded.win_count,
    sum_final_tick = excluded.sum_final_tick,
    sum_xp_total   = excluded.sum_xp_total,
    sum_drop_count = excluded.sum_drop_count,
    updated_at     = excluded.updated_at;
  get diagnostics v_rows_2 = row_count;

  drop table pv_telemetry_parsed;

  return jsonb_build_object('day', p_day, 'cells_planet_stage', v_rows_1, 'cells_ship_level', v_rows_2);
end;
$$;

revoke all on function public.rollup_telemetry_daily(date) from public;
revoke all on function public.rollup_telemetry_daily(date) from anon, authenticated;
grant execute on function public.rollup_telemetry_daily(date) to service_role;

-- -----------------------------------------------------------------------------
-- 5. 주기 실행(cron) — 롤업 + 롤업 자체의 보존(400일)
-- -----------------------------------------------------------------------------
-- pg_cron 은 20260727000000 에서 이미 활성(같은 파일이 gc-currency-grants·gc-pve-runs 를 등록).
-- 01:45 UTC — 기존 02:00 GC 잡들보다 앞서 어제 하루치를 먼저 굳힌다(순서가 결과를 바꾸진
-- 않는다 — 어제 데이터는 7일 GC 창에서 멀다 — 그래도 "집계 먼저, 청소는 그 다음" 순서가 읽기 쉽다).
select cron.schedule(
  'planet-blitz-rollup-telemetry-daily',
  '45 1 * * *',
  $$ select public.rollup_telemetry_daily(); $$
);

-- 롤업 보존 400일(§보존 정책). 원시 pve_runs 7일 GC 와 별개 — 여기가 "패치 전후 비교"의
-- 실제 저장소이므로 예산이 다르다(연 단위).
select cron.schedule(
  'planet-blitz-gc-telemetry-rollup',
  '30 2 * * *',
  $$
    delete from public.telemetry_daily_planet_stage where day < current_date - 400;
    delete from public.telemetry_daily_ship_level   where day < current_date - 400;
  $$
);
