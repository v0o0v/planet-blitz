-- =============================================================================
-- PvE 런 시작 등록 필수화 + 축 D(시간당 런 처리량) 캡 — ADR-0050 §3 단계 1·2 의 토대
-- =============================================================================
--
-- ## 왜 이것이 먼저인가
--
-- ADR-0050 §3 단계 2 의 캡 설계 원리는 하나다:
--
--   > 캡이 유계이려면 **캡의 분모가 클라 통제 밖**이어야 한다. 분모가 클라 주장이면 캡은 장식이다.
--
-- 착수 전 실측에서 PvE 축의 분모가 전부 클라 것임을 확인했다:
--   · `settle_pve_run` 의 개연성 캡 ①항 `2.0 * finalTick * (1+stage)`(20260726000200:160)은
--     `finalTick` 이 `p_summary` 에서 온다(20260802000000:88-90). **클라 주장이라 장식이다.**
--   · `PLAUSIBLE_RUNS_PER_HOUR := 60`(20260801000000:134)은 촉매 시간당 상한 360 의 근거인데
--     **강제가 아니라 가정**이다. 그 60 을 강제하는 코드가 리포에 없었다(grep 실측).
--
-- 서버가 소유한 시계는 하나뿐이다 — 런 **시작** 시각. 그런데 지금 그것이 남는 경로는
-- `consume_catalysts` 뿐이라(20260727000000:127) **촉매를 안 쓰면 런 시작이 서버에 없다.**
-- 그래서 이 마이그레이션이 시작 등록을 보편화한다. 그 위에 단계 1 의 드랍 개수 캡이 선다
-- (분모 = `now() - started_at`, 클라가 못 만지는 경과 시간).
--
-- 선례는 발명이 아니라 확장이다 — 의뢰는 이미 서버가 `started_at` 을 찍고
-- (`mark_commission_active`) `settle_commission` 의 캡 분모가 그 위에 선다(20260803000000:903-910).
-- **그 형태를 PvE 로 넓히는 것뿐이다.**
--
-- ## ⛔ 캡을 테이블 트리거로 짓지 않은 이유 (실측으로 기각한 설계)
--
-- 첫 설계는 `before insert on public.pve_runs` 트리거였다. **틀렸다** —
-- `settle_pve_run` 이 정산 때 `pve_runs` 에 요약 1행을 **직접 insert 한다**(20260726000200:297).
-- 트리거로 지었으면 ⓐ 정산이 캡에 걸려 **예외로 죽고**(이 리포는 settle 계열 개정이 PvE 정산을
-- 100% 깨뜨린 전례가 있다 — 20260802000000:4-15) ⓑ 런 1회가 2행을 만들어 **60 캡이 실질 30**이 된다.
--
-- ⇒ 캡은 **시작 등록 RPC 안**에 두고, 분모는 새 컬럼 `started_at` 이 **명시적으로 표시한 행**만
--   센다. 정산 요약 행은 `started_at` 이 null 이라 분모에 들어오지 않는다.
--   **`settle_pve_run` 본문은 한 줄도 고치지 않는다.**
--
-- ## 담는 것
--   1. pve_runs.started_at — 런 **시작 등록** 표시(정산 요약 행과 구분하는 유일한 축)
--   2. guard_pve_runs_client_insert 재정의 — 클라 insert 의 started_at 봉인
--   3. begin_pve_run(planet) — 시작 등록 + 축 D 캡
--
-- ## `consume_catalysts` 를 고치지 않는다 — 촉매 런은 pve_runs 2행을 쓴다 (의도)
--
-- 촉매를 쓰는 런은 `consume_catalysts` 가 이미 pending 행을 만든다(20260727000000:127).
-- 거기에 `p_run_id` 를 더해 한 행으로 합치는 안을 검토했으나 **기각했다** — 그 함수를
-- 재정의하면 촉매 소모·슬롯 상한·특산 정합 검증 전체가 개정 표면에 들어오는데, 이 레인이
-- 얻는 것은 행 하나 절약뿐이다. 이 리포는 settle 계열 재정의 복제로 PvE 정산을 100%
-- 깨뜨린 전례가 있어(20260802000000:4-15) **작은 이득에 큰 표면을 열지 않는다.**
--
-- ⇒ 클라는 촉매 사용 여부와 무관하게 `begin_pve_run` 을 **항상** 부른다. 촉매 런은
--   begin 행(started_at 있음, 캡의 분모 · 드랍 원장의 키)과 consume 행(영수증 · 정산 관통용)
--   둘을 갖는다. **캡은 여전히 런당 1 로 정확히 센다** — consume 행은 started_at 이 null 이라
--   분모에 안 들어온다. 여분의 행은 기존 7일 GC 가 함께 걷어간다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. pve_runs.started_at — 시작 등록 표시
-- -----------------------------------------------------------------------------
-- 이 컬럼이 채워진 행만 "런이 실제로 시작됐다"는 서버 증거다. 정산 요약 행
-- (settle_pve_run 이 심는 verified 행)은 null 로 남아 캡의 분모에 들어오지 않는다.
alter table public.pve_runs add column if not exists started_at timestamptz;

-- 축 D 캡의 조회 축(profile_id, started_at). 부분 인덱스로 정산 요약 행을 아예 배제한다 —
-- 요약 행이 압도적 다수라(런당 1행 + GC 7일) 전체 인덱스는 낭비다.
create index if not exists pve_runs_started_idx
  on public.pve_runs (profile_id, started_at desc)
  where started_at is not null;

-- -----------------------------------------------------------------------------
-- 1b. guard_pve_runs_client_insert 재정의 — 클라 직접 insert 시 started_at 봉인
-- -----------------------------------------------------------------------------
-- ⚠️ 20260727000000 의 guard 는 verified_* 3필드 + catalyst_receipt 만 비운다. 이번에 추가된
-- started_at 은 손대지 않으므로, `pve_runs_insert_own` 정책(20260718000000:52)이 허용하는
-- 클라 직접 insert 로 `{"started_at": "1999-01-01"}` 을 심으면 **캡의 분모를 스스로 조작**할 수
-- 있다(과거 시각을 심으면 1시간 창 밖으로 빠져 카운트에서 사라진다 = 무제한 런).
-- 여기서 클라 컨텍스트의 started_at 을 null 강제한다. definer RPC(소유자 postgres)의 insert 는
-- is_service_role()=true 라 guard 를 건너뛰어 정상 보존된다(트리거는 INVOKER, 20260727000000:141).
create or replace function public.guard_pve_runs_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.verified_status  := 'pending';
    new.verified_result  := null;
    new.verified_at      := null;
    new.catalyst_receipt := null;
    -- 시작 등록은 begin_pve_run/consume_catalysts(definer)만 찍는다. 캡의 분모이므로
    -- 클라가 값을 넣으면 캡이 스스로 열린다.
    new.started_at       := null;
  end if;
  return new;
end;
$$;

create or replace trigger trg_pve_runs_guard_insert
  before insert on public.pve_runs
  for each row execute function public.guard_pve_runs_client_insert();

-- -----------------------------------------------------------------------------
-- 2. begin_pve_run — 런 시작 등록 + 축 D(시간당 런 처리량) 캡
-- -----------------------------------------------------------------------------
-- 반환: { run_id uuid, started_at timestamptz, throttled boolean, runs_last_hour int }
--
-- `throttled=true` 면 run_id 가 null 이다 — 캡에 걸렸다는 뜻이고, 클라는 런을 시작하되
-- **서버 드랍을 받지 못한다**(단계 1 의 grant_run_drops 가 run_id 를 요구한다).
-- 예외를 던지지 않는 이유: 정직한 유저가 캡에 닿는 일은 사실상 없고, 던지면 오프라인·
-- 네트워크 실패와 구분이 안 되는 실패 경로가 하나 더 생긴다. 배송함 패턴의 관용구
-- (`hold_reason` — 20260805000000:245-270)와 같은 결로 **관측면에 남기고 조용히 깎는다**.
create or replace function public.begin_pve_run(p_planet integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 축 D 캡. 20260801000000:134 의 `PLAUSIBLE_RUNS_PER_HOUR := 60` 을 **가정에서 강제로**
  -- 승격시킨 값이다 — 촉매 시간당 상한 360 이 그 60 위에 서 있는데 강제가 없었다.
  -- 분모는 `now()` 벽시계 + 서버가 찍은 started_at 이라 **전부 클라 통제 밖**이다.
  -- 정직한 상한 감각: 한 런의 물리적 최소 길이가 수십 초라 60/h 는 여유가 크다.
  CAP_RUNS_PER_HOUR constant integer := 60;
  v_me    uuid := auth.uid();
  v_count integer;
  v_id    uuid;
  v_at    timestamptz;
begin
  if v_me is null then
    return jsonb_build_object('run_id', null, 'throttled', true, 'runs_last_hour', 0,
                              'note', 'no-auth');
  end if;

  -- 프로필 행 잠금 — 동시 begin 이 캡을 함께 통과하는 경합을 막는다(원장 가산 계열과 같은 규율).
  perform 1 from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object('run_id', null, 'throttled', true, 'runs_last_hour', 0,
                              'note', 'no-profile');
  end if;

  select count(*) into v_count
    from public.pve_runs
    where profile_id = v_me
      and started_at is not null
      and started_at > now() - interval '1 hour';

  if v_count >= CAP_RUNS_PER_HOUR then
    return jsonb_build_object('run_id', null, 'throttled', true, 'runs_last_hour', v_count);
  end if;

  -- ⚠️ replay·client_result 를 쓰지 않는다 — 20260726000300 이 **드롭한 컬럼**이다.
  -- (초안이 20260718000000 의 create table 을 보고 그 둘을 실었다가
  -- `tests/pveRunsColumnContract.test.ts` 에 잡혔다. 그대로 나갔으면 이 RPC 가 런타임에
  -- 42703 으로 100% 실패하고, 클라는 오류를 조용한 거부로 처리해 화면에 흔적이 없었을 것이다 —
  -- 그 테스트가 존재하는 이유인 2026-07-31 사고와 정확히 같은 형태다.)
  insert into public.pve_runs (profile_id, verified_status, started_at)
  values (v_me, 'pending', now())
  returning id, started_at into v_id, v_at;

  return jsonb_build_object('run_id', v_id, 'started_at', v_at,
                            'throttled', false, 'runs_last_hour', v_count + 1);
end;
$$;

revoke all on function public.begin_pve_run(integer) from public;
grant execute on function public.begin_pve_run(integer) to authenticated;
