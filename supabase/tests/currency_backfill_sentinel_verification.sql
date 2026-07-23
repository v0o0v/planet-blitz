-- =============================================================================
-- Planet Blitz — 재화 백필 센티넬 검증 (T-CBS-1 ~ T-CBS-2)
-- =============================================================================
-- 대상 마이그레이션: 20260726000400_currency_backfill_sentinel.sql
--   (코드리뷰 MED-2 후속 — 원본 20260726000000 의 `where credits = 0` 백필 게이트가
--    "미백필(default 0)" 과 "정당한 0 소비" 를 구분하지 못해 수동 재적용 시 stale 미러로
--    재화가 창조되는 문제를, 센티넬 게이트 함수 backfill_currency_from_save() 로 차단.)
--
-- 실행 규율(phase_e/phase_f/phase_m7a_verification.sql 선례 그대로):
--   - 각 테스트는 자기 데이터를 세팅하고 마지막에 `raise exception '..._ROLLBACK_OK :: ...'`
--     으로 트랜잭션 전체를 롤백한다 → **잔류 데이터 0**. 성공하면 그 리포트 메시지가,
--     실패하면 해당 검사의 실패 메시지가 예외로 올라온다.
--   - 테스트 UUID 는 실데이터 회피용 '0000cbNN-...' 대역(cb = currency-backfill).
--   - 호출자 컨텍스트는 current_user=postgres(=is_service_role) 를 전제한다(MCP execute_sql /
--     psql 직접). 함수는 SECURITY DEFINER(소유자=postgres)라 마커 표·profiles 접근 시 RLS 우회.
--
-- ⚠️ **브랜치 DB 에서만 돌릴 것.** 특히 T-CBS-2 는 마커를 지우고 함수를 호출하므로 브랜치의
--    **전체 profiles 를 미러값으로 백필**한다(그 뒤 DO 블록 마지막 raise 로 통째 롤백되어
--    영속 변경은 0 이지만, 실데이터 규모의 풀테이블 UPDATE 가 트랜잭션 내에서 실행된다).
--    원격 프로덕션 직접 실행 금지.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- T-CBS-1 : 센티넬 present → 함수 no-op, stale 미러가 정본 컬럼으로 되살아나지 않는다(핵심)
-- -----------------------------------------------------------------------------
-- 이것이 MED-2 가 막으려던 바로 그 시나리오다: 컬럼 credits=0(정당 소비) + save 미러
-- stale-high 99999 인 유저에게 백필을 다시 돌려도 재화가 창조되면 안 된다.
do $$
declare
  u         uuid := '0000cb01-0000-4000-8000-000000000001';
  v_credits numeric;
  v_res     jsonb;
  rep       text := '';
begin
  -- 마커 present 보장(마이그레이션이 이미 심었지만 자기완결성 위해 재확인).
  insert into public.schema_backfill_markers(marker, note)
    values ('currency_from_save', 'test-ensured') on conflict (marker) do nothing;

  -- spent-to-0 유저: 컬럼 credits/minerals=0(정당 소비), save 미러는 stale-high.
  insert into auth.users(id, is_sso_user, is_anonymous) values (u, false, true);
  insert into public.profiles(id, save, display_name)
    values (u, jsonb_build_object('credits', 99999, 'minerals', 88888), 'cbs-spent');

  -- 전제 확인: 삽입 직후 정본 컬럼은 0 이어야 한다(default 0, 미러는 컬럼에 자동 반영 안 됨).
  select credits into v_credits from public.profiles where id = u;
  if v_credits <> 0 then
    raise exception 'TCBS1-FAIL 전제 위반: 삽입 직후 credits 가 0 이 아님(%)', v_credits;
  end if;

  -- 함수 호출 — 마커 present 라 no-op(skipped=true) 이어야 한다.
  v_res := public.backfill_currency_from_save();
  if coalesce((v_res->>'skipped')::boolean, false) is not true then
    raise exception 'TCBS1-FAIL 마커 present 인데 skip 되지 않음: %', v_res;
  end if;
  rep := rep || 'skipped-when-marked=ok; ';

  -- 핵심 단언: 미러 stale-high 가 컬럼으로 되살아나지 않았다.
  select credits into v_credits from public.profiles where id = u;
  if v_credits <> 0 then
    raise exception 'TCBS1-FAIL 재화 되살림 발생: credits=% (0 이어야)', v_credits;
  end if;
  rep := rep || 'no-revival=ok; ';

  raise exception 'TCBS1_ROLLBACK_OK :: %', rep;
end $$;

-- -----------------------------------------------------------------------------
-- T-CBS-2 : 센티넬 absent → 함수가 미러를 이관하고 마커를 재기록, 2차 호출은 skip(멱등)
-- -----------------------------------------------------------------------------
-- 함수가 vacuous(항상 skip)한 가드가 아니라 실제로 동작함을 증명한다. + 센티넬이 최초 1회만
-- 백필을 허용하는 멱등 게이트임을 확인한다.
do $$
declare
  u          uuid := '0000cb02-0000-4000-8000-000000000001';
  v_credits  numeric;
  v_minerals numeric;
  v_res      jsonb;
  rep        text := '';
begin
  -- 마커 없는 상태 시뮬레이션(fresh / pre-column 복원 DB).
  delete from public.schema_backfill_markers where marker = 'currency_from_save';

  -- 미러가 있는 프로필(컬럼 0, save.credits=777 / minerals=55) — 최초 백필 대상.
  insert into auth.users(id, is_sso_user, is_anonymous) values (u, false, true);
  insert into public.profiles(id, save, display_name)
    values (u, jsonb_build_object('credits', 777, 'minerals', 55), 'cbs-fresh');

  -- 1차 호출 — 마커 없으니 백필 실행(skipped=false).
  v_res := public.backfill_currency_from_save();
  if coalesce((v_res->>'skipped')::boolean, true) is not false then
    raise exception 'TCBS2-FAIL 마커 없는데 skip 됨: %', v_res;
  end if;
  select credits, minerals into v_credits, v_minerals from public.profiles where id = u;
  if v_credits <> 777 or v_minerals <> 55 then
    raise exception 'TCBS2-FAIL 미러 백필 실패: credits=%, minerals=% (777/55 이어야)',
      v_credits, v_minerals;
  end if;
  rep := rep || 'backfill-fills-mirror=ok; ';

  -- 백필 후 마커가 다시 심겼는지.
  if not exists (select 1 from public.schema_backfill_markers where marker = 'currency_from_save') then
    raise exception 'TCBS2-FAIL 백필 후 마커가 심기지 않음';
  end if;
  rep := rep || 'marker-set=ok; ';

  -- 2차 호출 — 이제 마커 present 라 skip(멱등, 이중 백필 없음).
  v_res := public.backfill_currency_from_save();
  if coalesce((v_res->>'skipped')::boolean, false) is not true then
    raise exception 'TCBS2-FAIL 2차 호출이 skip 되지 않음(멱등 위반): %', v_res;
  end if;
  rep := rep || 'second-call-skips=ok; ';

  raise exception 'TCBS2_ROLLBACK_OK :: %', rep;
end $$;

-- =============================================================================
-- 실행 후 기대 출력(각 블록이 순차 롤백되며 남기는 예외 메시지)
--   TCBS1_ROLLBACK_OK :: skipped-when-marked=ok; no-revival=ok;
--   TCBS2_ROLLBACK_OK :: backfill-fills-mirror=ok; marker-set=ok; second-call-skips=ok;
-- 하나라도 *-FAIL 이 뜨면 센티넬 가드가 깨진 것이다 — 머지 금지.
-- =============================================================================
