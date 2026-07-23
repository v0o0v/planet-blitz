-- =============================================================================
-- Planet Blitz — 재화 백필 일회성 센티넬 (코드리뷰 MED-2 후속 · 향후 재적용 안전 가드)
-- =============================================================================
-- 배경(무엇을 고치나):
--   20260726000000_currency_server_authority.sql 의 백필(47-59행)은 save->>'credits'/
--   save->>'minerals' 미러를 정본 컬럼으로 1회 이관하면서 `where credits = 0`(minerals 동일)
--   로만 재실행을 게이트했다. 이 조건은 두 상태를 구분하지 못한다:
--     (ㄱ) 아직 백필 전 — 컬럼이 default 0.
--     (ㄴ) 정당하게 0 까지 소비 — 컬럼이 실제 0.
--   표준 `supabase db push` 는 이미 적용된 마이그레이션을 재실행하지 않으므로 실사용 노출은
--   낮다. 그러나 누군가 원본 파일을 **수동 재적용**(psql -f 등)하면, 컬럼이 0 이면서 save
--   미러가 stale-high 인 (ㄴ) 유저에게 그 미러값을 정본 컬럼으로 되살린다 → **재화 창조**.
--   재화 서버 권위(anti-cheat) PR 안에 재화 창조 경로가 잔존하는 모순이다.
--
--   ⚠️ 원본의 "재실행 안전성" 주석(27-29행: "정본 컬럼이 아직 기본값(0)인 행만 대상으로 해
--   재적용 시 이미 채워진(획득한) 잔액을 덮어쓰지 않는다")은 부정확하다. 정확한 현실:
--     · 동일 배포 내 부분실패 후 재적용 — 안전(마이그레이션은 트랜잭션이라 실패 시 통째 롤백).
--     · 플레이가 진행되어 일부 유저가 0 까지 소비한 뒤의 재적용 — **비안전**(위 (ㄴ) 되살림).
--   원본은 이미 원격 적용되어 수정 금지이므로, 본 마이그레이션이 (a) 향후 재적용을 막는
--   **센티넬 가드**를 설치하고 (b) 이 헤더 주석으로 원본의 부정확한 주장을 정정한다.
--
-- 원격 재배포 불요:
--   프로덕션은 원본의 인라인 백필로 이미 컬럼이 정확히 채워져 있다. 본 마이그레이션은 그
--   컬럼을 **건드리지 않는다** — 센티넬 마커 1행만 심어 "백필 완료됨"을 기록하고, 향후 재백필
--   이 필요할 때 쓸 **센티넬 게이트 함수**를 정의한다. 재화 데이터 변경 0(순수 방어용 가드).
--
-- 재실행 안전성(본 마이그레이션 자체):
--   create table if not exists · create or replace function · insert ... on conflict do nothing.
--   컬럼 UPDATE 가 전혀 없어 재적용해도 재화에 영향이 없다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 백필 완료 마커(센티넬) — 재사용 가능한 스키마 백필 원장
-- -----------------------------------------------------------------------------
-- 일회성 데이터 백필의 "완료됨"을 기록하는 서버 전용 원장. 마커가 있으면 그 백필은 다시
-- 돌지 않는다(§2 함수가 이 표를 게이트로 읽는다). 향후 다른 일회성 백필도 이 표를 재사용한다.
create table if not exists public.schema_backfill_markers (
  marker      text        primary key,
  applied_at  timestamptz not null default now(),
  note        text
);

-- 서버 전용: RLS 켜고 정책 없음 → authenticated/anon 은 읽기/쓰기 불가. SECURITY DEFINER
-- 함수(소유자=postgres)와 service_role·postgres 만 접근(모두 RLS 우회). 베이스 권한도 명시 회수
-- (Supabase 가 public 스키마 테이블에 부여했을 수 있는 기본 grant 까지 확실히 제거).
alter table public.schema_backfill_markers enable row level security;
revoke all on public.schema_backfill_markers from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. 센티넬 게이트 재백필 함수 — 원본 인라인 UPDATE 의 "안전한 재실행 경로"
-- -----------------------------------------------------------------------------
-- 원본의 `where credits = 0` 게이트(위 (ㄴ) 오분류의 근원)를 **센티넬 게이트**로 교체한다.
-- 마커가 있으면 no-op(재화 되살림 원천 차단). 없으면 미러를 이관하고 마커를 심는다. 향후 백필
-- 재실행이 필요하면(예: 컬럼이 한 번도 채워진 적 없는 fresh/pre-column 복원 DB) 원본 파일을
-- `psql -f` 로 다시 돌리지 말고 **이 함수**를 호출한다.
--
-- ⚠️ 센티넬이 유일한 게이트다. 실데이터가 이미 컬럼에 있는 DB 에서 마커를 지우고 호출하면
--   미러값으로 컬럼을 덮어써 재화가 되살아난다. 마커는 "컬럼이 한 번도 채워진 적 없는" DB
--   에서만(fresh/pre-column 복원) 지워라. 이관 검증은 원본 45-59행과 동일(정수/소수 정규식
--   게이트 + greatest(0,..) 클램프)하되, credits=0 부분게이트는 제거한다 — 센티넬이 최초 1회
--   실행을 보장하므로 모든 행이 default 0 이라 부분게이트가 불필요하고, 그 부분게이트야말로
--   원본 버그의 근원이기 때문이다.
create or replace function public.backfill_currency_from_save()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker  constant text := 'currency_from_save';
  v_credit_rows  integer;
  v_mineral_rows integer;
begin
  if exists (select 1 from public.schema_backfill_markers where marker = v_marker) then
    return jsonb_build_object('ok', true, 'skipped', true, 'note', 'already-done');
  end if;

  with c as (
    update public.profiles p
      set credits = greatest(0, case
            when p.save->>'credits' ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.save->>'credits')::numeric
            else 0 end)
      where p.save->>'credits' is not null
      returning 1
  )
  select count(*)::integer into v_credit_rows from c;

  with m as (
    update public.profiles p
      set minerals = greatest(0, case
            when p.save->>'minerals' ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.save->>'minerals')::numeric
            else 0 end)
      where p.save->>'minerals' is not null
      returning 1
  )
  select count(*)::integer into v_mineral_rows from m;

  insert into public.schema_backfill_markers (marker, note)
    values (v_marker, 'backfill_currency_from_save() 최초 실행');

  return jsonb_build_object(
    'ok', true, 'skipped', false,
    'credit_rows', v_credit_rows, 'mineral_rows', v_mineral_rows, 'note', 'backfilled'
  );
end;
$$;

revoke all on function public.backfill_currency_from_save() from public;
revoke all on function public.backfill_currency_from_save() from anon, authenticated;
grant execute on function public.backfill_currency_from_save() to service_role;

-- -----------------------------------------------------------------------------
-- 3. 프로덕션 상태 기록 — 원본 인라인 백필이 이미 컬럼을 채웠다
-- -----------------------------------------------------------------------------
-- 이 마이그레이션이 도는 시점 = 원본 20260726000000 이 (마이그레이션 순서상) **항상 먼저**
-- 인라인 백필을 끝낸 뒤다. 따라서 재백필 없이 마커만 심는다 — §2 함수를 호출하지 않는다.
-- (함수를 부르면 컬럼이 이미 채워진 프로덕션에서 미러로 다시 덮어써버린다. 마커만 심어야
-- 향후 함수 호출이 no-op 이 된다.) on conflict do nothing 으로 멱등.
insert into public.schema_backfill_markers (marker, note)
  values ('currency_from_save',
          '20260726000000 인라인 백필로 완료 — 20260726000400 이 마커만 기록(재백필 없음)')
  on conflict (marker) do nothing;

-- =============================================================================
-- 요약(후속 운영자용):
--   · "백필 다시 필요한가?" 의 정본 = public.schema_backfill_markers 의 'currency_from_save' 행.
--   · 재백필이 정말 필요하면(컬럼이 한 번도 채워진 적 없는 DB 한정) 원본 SQL 을 재적용하지 말고
--     select public.backfill_currency_from_save(); 를 호출한다(센티넬 게이트라 이중 실행 안전).
--   · 실데이터가 있는 DB 에는 어떤 경로로도 백필을 재실행하지 말 것 — stale 미러가 정본 컬럼을
--     덮어써 재화가 창조된다(본 파일이 막는 바로 그 사고).
-- =============================================================================
