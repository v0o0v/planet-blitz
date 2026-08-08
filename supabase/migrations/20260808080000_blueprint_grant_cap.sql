-- =============================================================================
-- 설계도 지급 빈도 캡 — `grant_blueprints` 의 미조달 방어를 조달한다
-- =============================================================================
--
-- ## 왜 지금인가 (2026-08-08 확률 레인 PR#391 의 귀결)
--
-- `grant_blueprints`(20260722020000)는 클라가 보낸 목록을 그대로 신뢰하고 **빈도 상한이
-- 없다.** 형식 검사 3종(행 ≤ 8 · kind∈[0,3] · count∈[1,4])뿐이라 인증된 사용자가 호출
-- 1회당 32장을 **무제한** 적립할 수 있다. 이것은 ADR-0026/0027 의 의도된 트레이드오프이고
-- 그 파일이 스스로 "★트러스트 경계(정직한 서술)" 로 문서화해 뒀다.
--
-- ⛔ **그런데 이번 확률 레인이 그 트레이드오프의 근거를 무너뜨렸다.** ADR-0026 의 수용
--    기준은 절대 기준이 아니라 **상대** 기준이다 — *"PvE 치터의 이득이 최상위 정직 유저의
--    파밍 속도로 유계된다"*. PR#391 이 정직한 설계도 획득률을 런당 **약 7~14% → 정확히 3%**
--    (최대 1장)로 약 5배 낮추는 동안 위조 천장은 그대로였다. 즉 **비율 기준이 5배 벌어졌고**,
--    보안 리뷰가 그것을 이 레인이 새로 만든 위험(LOW-1)으로 적발했다.
--
-- 처방은 확률을 되돌리는 것이 아니다(3% 는 지시받은 값이다) — **다른 축들이 이미 갖고 있는
-- 빈도 캡을 이 축에도 조달하는 것**이다. 선례가 넷 있고 이 파일은 그 형태의 확장이다:
--   · `begin_pve_run`        축 D  `CAP_RUNS_PER_HOUR      = 60`  (20260808000000)
--   · `create_invasion`      축 A  `CAP_INVASIONS_PER_HOUR = 20`  (20260808020000)
--   · `issue_commission_*`         `CAP_ISSUE_ATTEMPTS_PER_HOUR = 20`
--   · `discard_commission`         `CAP_DISCARD_PER_HOUR   = 30`
--
-- ## ⭐ 캡 값의 유도 — 정직한 상한을 먼저 계산하고 헤드룸을 얹는다
--
-- 정직한 분모는 **서버가 강제하는 런 수**다. 축 D 가 시간당 런을 60 으로 묶고
-- (`CAP_RUNS_PER_HOUR`, 20260808000000), 설계도는 클리어당 3%·최대 1장이다
-- (`BLUEPRINT_RUN_CHANCE_CP = 300`, `src/sim/drops.ts`). 따라서:
--
--   시간당 기대 = 60 x 0.03 = 1.8 장     (Poisson(1.8) 근사)
--     P(X >= 12) ~ 1.5e-6   -> 시간당 12 는 약 5.5σ. 정직한 플레이를 벌하지 않는다.
--   하루 기대   = 16시간 x 60런 x 0.03 = 28.8 장  (헤비 유저 상한 가정, sd 5.3)
--     P(X >= 60) 는 약 5.9σ -> 하루 60 도 벌하지 않는다.
--
-- 실제 런 길이는 실측 2~5분이라 시간당 12~30런이 정상이고(60 은 캡이지 전형값이 아니다)
-- 위 계산은 **가장 관대한 쪽**으로 잡은 것이다.
--
--   위조 천장:  무제한  ->  시간당 12 · 하루 60
--   정직 기대:  시간당 약 1.8 · 하루 약 29 (헤비)
--
-- 비율이 6.7배(시간) · 2배(하루)로 닫힌다. **하루 캡이 실질 구속**이다 — 참을성 있는
-- 공격자는 시간 캡을 하루 288 까지 쓸 수 있으므로 하루 축이 없으면 반쪽이다.
--
-- ## ⚠️ 캡은 **총 장수**를 센다, 호출 수가 아니다
--
-- 호출 수를 세면 공격자가 호출 1회에 32장(행 8 x 장수 4)을 실어 캡을 32배로 뚫는다. 그래서
-- 분자는 `granted` 합이고, 형식 상한(행 8 · 장수 4)은 **손대지 않았다** — 캡이 총량을 묶으므로
-- 형식을 조일 필요가 없고, 조이면 캐시된 구 클라(PR#391 이전 형상: 여러 행·장수 2 이상)가
-- 조용히 거부된다. 새 클라의 정직한 형상은 이제 **행 1 · 장수 1** 이라 캡에 닿을 일이 없다.
--
-- ## ⚠️ 전부 아니면 전무다 (부분 절삭 안 함)
--
-- 캡을 넘기면 요청 전체를 거부한다. 정직한 형상이 1장이라 절삭할 것이 애초에 없고, 부분
-- 지급은 "몇 장이 적립됐나"를 클라가 되묻는 왕복을 만든다. 클라는 이 RPC 를
-- fire-and-forget 으로 부르므로(`src/net/blueprints.ts`) 거부는 조용하다 — 5σ 밖의 사건이라
-- 정직한 손실은 실질 0 이고, 이 자인을 여기 남긴다.
--
-- ## 담는 것
--   1. blueprint_grant_log — 캡의 분모. 정책 0 (클라가 분모를 읽으면 캡 회피 타이밍이 노출된다)
--   2. grant_blueprints 재정의 — 시간/일 캡 + 프로필 행 잠금 + 원장 기록
--   3. pg_cron 30일 GC — 캡 창이 1일이라 30일은 사후 조사용 여유분
--
-- ★TS 미러: `src/net/blueprintServerConstants.ts`
--   (`tests/blueprintGrantCap.test.ts` 가 SQL <-> TS 를 대조한다)
--
-- ★건드리지 않은 것: 침공 약탈(`loot_defense_blueprint`, service_role 전용) · 의뢰 배송
--   (20260805010000) · 일일 보상(20260805020000)은 **`defense_blueprints` 에 직접 쓴다**
--   (grep 실측 — 이 RPC 를 경유하지 않는다). 셋 다 서버 판정이라 캡 대상이 아니다.
--
-- 재실행 안전: create table if not exists · create or replace function · cron.schedule
--   (jobname upsert) · 권한 재적용.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 캡의 분모 — blueprint_grant_log
-- -----------------------------------------------------------------------------
create table if not exists public.blueprint_grant_log (
  id         bigserial   primary key,
  profile_id uuid        not null references public.profiles(id) on delete cascade,
  -- 이 호출이 적립한 총 장수. 캡의 분자다.
  granted    integer     not null check (granted > 0),
  -- 형상 관측용(행 수). 캡에는 쓰지 않는다 — 공격 형태를 사후에 읽기 위한 것.
  rows_n     integer     not null default 1 check (rows_n > 0),
  created_at timestamptz not null default now()
);

-- 캡 조회 패턴(profile_id 고정 + 최근 구간)에 정확히 맞춘 인덱스.
create index if not exists blueprint_grant_log_profile_time_idx
  on public.blueprint_grant_log (profile_id, created_at desc);

-- ⚠️ RLS 켜고 **정책 0개**. `commission_issues` 와 같은 규율이다 — 클라가 자기 분모를 읽을 수
--    있으면 "언제 캡이 풀리는가"를 알아내 회피 타이밍을 맞출 수 있다. definer 함수만 본다.
alter table public.blueprint_grant_log enable row level security;

-- -----------------------------------------------------------------------------
-- 2. grant_blueprints 재정의 — 캡 추가
-- -----------------------------------------------------------------------------
-- 입력·반환 형상은 20260722020000 과 **동일**하다(클라 무수정). 거절 코드만 둘 늘었다:
--   'rate'     시간당 상한 초과
--   'rate-day' 하루 상한 초과
create or replace function public.grant_blueprints(p_grants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 미러: src/net/blueprintServerConstants.ts
  -- 유도는 이 파일 머리말 §캡 값의 유도. 요약: 축 D 60런/h x 3% = 기대 1.8/h.
  CAP_BLUEPRINTS_PER_HOUR constant integer := 12;
  CAP_BLUEPRINTS_PER_DAY  constant integer := 60;

  v_me      uuid := auth.uid();
  v_row     jsonb;
  v_kind    smallint;
  v_catalog integer;
  v_count   integer;
  v_total   integer := 0;
  v_rows    integer := 0;
  v_hour    integer;
  v_day     integer;
begin
  if v_me is null then
    raise exception 'grant_blueprints: 로그인 필요';
  end if;
  if p_grants is null or jsonb_typeof(p_grants) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'bad-input');
  end if;
  -- 호출 1회 상한: 한 런이 낼 수 있는 종류 수를 넉넉히 덮으면서 폭주는 막는 값.
  -- ⚠️ 이 값을 조이지 마라 — 캐시된 구 클라(PR#391 이전)가 여러 행을 보낸다. 총량은 아래 캡이 묶는다.
  if jsonb_array_length(p_grants) > 8 then
    return jsonb_build_object('ok', false, 'code', 'too-many');
  end if;

  -- 프로필 행 잠금 — 동시 호출이 캡을 함께 통과하는 경합을 막는다(`begin_pve_run` 과 같은 규율).
  -- ⚠️ 잠금이 없으면 병렬 호출 N개가 각자 "아직 여유 있음"을 읽어 캡이 N배로 뚫린다.
  --    이 축은 fire-and-forget 이라 클라가 의도 없이도 동시 호출을 만들 수 있다.
  perform 1 from public.profiles where id = v_me for update;

  -- 먼저 요청 전체를 검증하고 합계를 낸다. **캡 판정을 지급보다 앞에** 두어야 부분 지급이 없다.
  for v_row in select * from jsonb_array_elements(p_grants)
  loop
    v_kind    := coalesce((v_row->>'kind')::smallint, -1);
    v_catalog := coalesce((v_row->>'catalogId')::integer, -1);
    v_count   := coalesce((v_row->>'count')::integer, 0);
    if v_kind < 0 or v_kind > 3 or v_catalog < 0 then
      return jsonb_build_object('ok', false, 'code', 'bad-catalog');
    end if;
    -- 장수 상한 4: 한 런에서 같은 설계도가 이보다 많이 나오는 경로가 없다.
    if v_count < 1 or v_count > 4 then
      return jsonb_build_object('ok', false, 'code', 'bad-count');
    end if;
    v_rows  := v_rows + 1;
    v_total := v_total + v_count;
  end loop;

  if v_total <= 0 then
    return jsonb_build_object('ok', true, 'granted', 0, 'rows', 0);
  end if;

  -- 빈도 캡. 분자는 **총 장수** 합이고 분모는 서버 벽시계다(클라 통제 밖).
  select coalesce(sum(granted), 0) into v_hour
    from public.blueprint_grant_log
   where profile_id = v_me and created_at > now() - interval '1 hour';
  if v_hour + v_total > CAP_BLUEPRINTS_PER_HOUR then
    return jsonb_build_object('ok', false, 'code', 'rate',
                              'granted_last_hour', v_hour, 'cap', CAP_BLUEPRINTS_PER_HOUR);
  end if;

  select coalesce(sum(granted), 0) into v_day
    from public.blueprint_grant_log
   where profile_id = v_me and created_at > now() - interval '1 day';
  if v_day + v_total > CAP_BLUEPRINTS_PER_DAY then
    return jsonb_build_object('ok', false, 'code', 'rate-day',
                              'granted_last_day', v_day, 'cap', CAP_BLUEPRINTS_PER_DAY);
  end if;

  -- 캡을 통과했다 — 이제 지급한다.
  for v_row in select * from jsonb_array_elements(p_grants)
  loop
    insert into public.defense_blueprints (profile_id, kind, catalog_id, count)
      values (v_me,
              (v_row->>'kind')::smallint,
              (v_row->>'catalogId')::integer,
              (v_row->>'count')::integer)
      on conflict (profile_id, kind, catalog_id)
      do update set count = public.defense_blueprints.count + excluded.count;
  end loop;

  -- 원장 기록은 **지급과 같은 트랜잭션**이다. 분리하면 앱이 그 사이에 죽었을 때 지급은
  -- 남고 분모는 비어 캡이 조용히 열린다(의뢰서 검증 시도 카운터가 반대 이유로 분리된 것과
  -- 대비되는 지점 — 그쪽은 롤백으로 카운터가 사라지는 것이 문제였다).
  insert into public.blueprint_grant_log (profile_id, granted, rows_n)
    values (v_me, v_total, v_rows);

  return jsonb_build_object('ok', true, 'granted', v_total, 'rows', v_rows);
end;
$$;

revoke all on function public.grant_blueprints(jsonb) from public;
revoke all on function public.grant_blueprints(jsonb) from anon;
grant execute on function public.grant_blueprints(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. 원장 GC — 30일
-- -----------------------------------------------------------------------------
-- 캡 창이 최대 1일이므로 보존은 순수 사후 조사용이다. 30일이면 "언제부터 이 계정이 캡에
-- 닿기 시작했나"를 되짚을 수 있고, 정직한 유입(하루 수십 행)에서는 저장 예산이 무의미하다.
-- ⚠️ pg_cron 이 꺼진 프로젝트에서는 이 줄이 실패한다 — 그때는 함수와 캡은 이미 살아 있고
--    원장만 무한히 자란다(정직한 유입 기준 연 1만 행 수준이라 방치해도 안전하다).
select cron.schedule(
  'planet-blitz-gc-blueprint-grant-log',
  '20 2 * * *',
  $$ delete from public.blueprint_grant_log where created_at < now() - interval '30 days'; $$
);
