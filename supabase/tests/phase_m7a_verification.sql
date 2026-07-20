-- =============================================================================
-- Planet Blitz M7a — 침공 3레이어 DB 전환 검증 스크립트 (T-M7a-1 ~ T-M7a-6)
-- =============================================================================
-- 대상 마이그레이션: 20260721000000_m7a_invasion_3layer.sql
--                   20260721010000_m7a_seed_bases_3layer.sql
--
-- 실행 규율(phase_e/phase_f_verification.sql 선례 그대로):
--   - 각 테스트는 자기 데이터를 세팅하고 마지막에 `raise exception '..._ROLLBACK_OK :: ...'`
--     으로 트랜잭션 전체를 롤백한다 → **잔류 데이터 0**. 성공하면 그 리포트 메시지가,
--     실패하면 해당 검사의 실패 메시지가 예외로 올라온다.
--   - 테스트 UUID 는 '0000m7NN' 대역이 아니라 hex 제약상 '0000a7NN-...' 대역을 쓴다(실데이터
--     회피). 래더 rank 는 NPC 시드(1..20)와 겹치지 않게 **600 대역**.
--   - 호출자 역할 시뮬레이션은 `set_config('request.jwt.claims', ...)` 로 한다
--     (auth.uid() = sub, caller_is_service_role() = role).
--
-- ⚠️ **브랜치 DB 에서 먼저 돌릴 것.** defenses.layout 재정의 + 예산 게이트 폐지 + begin_invasion
--    v4 는 되돌리기 어려운 규모다(레인 문서 미해결 위험). 원격 프로덕션 직접 실행 금지.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- T-M7a-1 : invasion_layers_valid — 슬롯 수·형식 게이트(예산제 대체)
-- -----------------------------------------------------------------------------
do $$
declare
  ok_layers jsonb := public.empty_invasion_layers();
  bad       jsonb;
  rep       text := '';
begin
  -- ① 빈 정규형은 통과한다(기본 수비대 충원 전제 배치).
  if not public.invasion_layers_valid(ok_layers) then
    raise exception 'TM7a1-FAIL 빈 정규형이 거부됨';
  end if;
  rep := rep || 'empty=ok; ';

  -- ② 웨이브 슬롯 7개는 거부(상한 6).
  bad := jsonb_set(ok_layers, '{l1,waveSlots}',
                   '[null,null,null,null,null,null,null]'::jsonb);
  if public.invasion_layers_valid(bad) then
    raise exception 'TM7a1-FAIL 웨이브 슬롯 7개가 통과됨(상한 6)';
  end if;
  rep := rep || 'wave-overflow=rejected; ';

  -- ③ 병목형(templateId=2)은 소켓 8 상한 — 9개면 거부.
  bad := jsonb_set(jsonb_set(ok_layers, '{l2,templateId}', '2'::jsonb),
                   '{l2,sockets}', '[null,null,null,null,null,null,null,null,null]'::jsonb);
  if public.invasion_layers_valid(bad) then
    raise exception 'TM7a1-FAIL 병목형 소켓 9개가 통과됨(상한 8)';
  end if;
  -- 8개는 통과해야 한다.
  bad := jsonb_set(jsonb_set(ok_layers, '{l2,templateId}', '2'::jsonb),
                   '{l2,sockets}', '[null,null,null,null,null,null,null,null]'::jsonb);
  if not public.invasion_layers_valid(bad) then
    raise exception 'TM7a1-FAIL 병목형 소켓 8개가 거부됨';
  end if;
  rep := rep || 'socket-by-template=ok; ';

  -- ④ 템플릿 코드 범위 밖(3)은 거부.
  bad := jsonb_set(ok_layers, '{l2,templateId}', '3'::jsonb);
  if public.invasion_layers_valid(bad) then
    raise exception 'TM7a1-FAIL 템플릿 코드 3 이 통과됨(0..2)';
  end if;
  rep := rep || 'template-range=ok; ';

  -- ⑤ 수호 3슬롯·기물 7슬롯·모듈 3슬롯은 거부.
  if public.invasion_layers_valid(jsonb_set(ok_layers, '{l3,guardians}', '[null,null,null]'::jsonb)) then
    raise exception 'TM7a1-FAIL 수호 슬롯 3개가 통과됨(상한 2)';
  end if;
  if public.invasion_layers_valid(jsonb_set(ok_layers, '{l3,props}', '[null,null,null,null,null,null,null]'::jsonb)) then
    raise exception 'TM7a1-FAIL 기물 슬롯 7개가 통과됨(상한 6)';
  end if;
  if public.invasion_layers_valid(jsonb_set(ok_layers, '{l3,modules}', '[null,null,null]'::jsonb)) then
    raise exception 'TM7a1-FAIL 모듈 슬롯 3개가 통과됨(상한 2)';
  end if;
  rep := rep || 'l3-slots=ok; ';

  -- ⑥ 구 스키마(core/turrets/obstacles)는 3레이어가 아니므로 거부된다(재시드 판정 근거).
  if public.invasion_layers_valid('{"core":{"x":0,"y":480},"turrets":[],"obstacles":[]}'::jsonb) then
    raise exception 'TM7a1-FAIL 구 layout 이 3레이어로 통과됨';
  end if;
  rep := rep || 'legacy-layout=rejected; ';

  -- ⑦ 예산 함수는 폐기됐다(존재하면 실패).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'defense_layout_cost'
  ) then
    raise exception 'TM7a1-FAIL defense_layout_cost 가 아직 존재함(예산제 폐지 미완)';
  end if;
  rep := rep || 'budget-fn-dropped=ok; ';

  raise exception 'TM7a1_ROLLBACK_OK :: %', rep;
end $$;

-- -----------------------------------------------------------------------------
-- T-M7a-2 : guard_defenses_client_write — 슬롯 게이트 + 정비도 봉인 유지
-- -----------------------------------------------------------------------------
-- 클라이언트 경로(authenticated)를 흉내내려면 current_user 를 바꿔야 한다(is_service_role 은
-- current_user 기반). `set local role authenticated` + jwt claims 로 RLS·가드를 동시에 재현한다.
do $$
declare
  u      uuid := '0000a702-0000-4000-8000-000000000001';
  d      uuid := '0000a702-0000-4000-8000-0000000000d1';
  layers jsonb := public.empty_invasion_layers();
  caught boolean;
  v_budget integer;
  v_maint  numeric;
  rep    text := '';
begin
  insert into auth.users(id, is_sso_user, is_anonymous) values (u, false, true);
  insert into public.profiles(id, save, display_name) values (u, '{}'::jsonb, 'm7a-guard');

  perform set_config('request.jwt.claims',
    json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ① 정상 배치 INSERT — budget_spent 는 클라 신고(99)를 무시하고 0, maintenance 는 100 고정.
  insert into public.defenses(id, profile_id, layout, budget_spent, active)
    values (d, u, layers, 99, true);
  select budget_spent, maintenance into v_budget, v_maint from public.defenses where id = d;
  if v_budget <> 0 then
    raise exception 'TM7a2-FAIL budget_spent 가 0 이 아님(%)', v_budget;
  end if;
  if v_maint <> 100.00 then
    raise exception 'TM7a2-FAIL INSERT maintenance 가 100 이 아님(%)', v_maint;
  end if;
  rep := rep || 'insert-budget0-maint100=ok; ';

  -- ② 슬롯 초과 배치는 거부(예산 상한 대신 슬롯 게이트).
  caught := false;
  begin
    update public.defenses
      set layout = jsonb_set(layers, '{l1,waveSlots}', '[null,null,null,null,null,null,null]'::jsonb)
      where id = d;
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TM7a2-FAIL 웨이브 슬롯 7개 UPDATE 가 통과됨';
  end if;
  rep := rep || 'slot-overflow-rejected=ok; ';

  -- ③ 정비도 자가회복 차단(ADR-0006) — 서버가 낮춰 둔 값을 클라 UPDATE 가 올리지 못한다.
  reset role;
  update public.defenses set maintenance = 40.00 where id = d;  -- 서버(풍화) 역할
  set local role authenticated;
  update public.defenses set layout = layers, maintenance = 100.00 where id = d;
  select maintenance into v_maint from public.defenses where id = d;
  if v_maint <> 40.00 then
    raise exception 'TM7a2-FAIL 클라 UPDATE 가 정비도를 되돌림(%)', v_maint;
  end if;
  rep := rep || 'maintenance-sealed=ok; ';

  reset role;
  raise exception 'TM7a2_ROLLBACK_OK :: %', rep;
end $$;

-- -----------------------------------------------------------------------------
-- T-M7a-3 : inject_guardian_authority — l3 경로 + 고정 길이 2 제자리 치환
-- -----------------------------------------------------------------------------
do $$
declare
  u       uuid := '0000a703-0000-4000-8000-000000000001';
  layers  jsonb;
  out     jsonb;
  g0      jsonb;
  g1      jsonb;
  rep     text := '';
begin
  insert into auth.users(id, is_sso_user, is_anonymous) values (u, false, true);
  insert into public.profiles(id, save, display_name, lineage_guardian_level)
    values (u, '{}'::jsonb, 'm7a-guardian', 30);   -- 마일스톤 1|2 = 3, bonusBp = floor(5000*30/50)=3000
  insert into public.guardians(profile_id, data, performance, retired)
    values (u, jsonb_build_object('preset', 0, 'hp', 900), 95.00, false);

  -- 슬롯 0 은 비우고 슬롯 1 만 배치했다 → **밀집화하면 안 된다**(slot i ↔ 수호 i 매핑).
  layers := jsonb_set(public.empty_invasion_layers(), '{l3,guardians}',
    jsonb_build_array('null'::jsonb, jsonb_build_object('x', 120, 'y', -240)));
  out := public.inject_guardian_authority(layers, u);
  g0 := out->'l3'->'guardians'->0;
  g1 := out->'l3'->'guardians'->1;

  if jsonb_typeof(g0) <> 'null' then
    raise exception 'TM7a3-FAIL 빈 슬롯 0 이 채워짐(밀집화 금지 위반): %', g0;
  end if;
  rep := rep || 'empty-slot-preserved=ok; ';

  -- 활성 수호가 1기뿐이므로 슬롯 1 은 "수호 index 1 없음" → null 이어야 한다(위치 매핑).
  if jsonb_typeof(g1) <> 'null' then
    raise exception 'TM7a3-FAIL 활성 수호 1기인데 슬롯 1 이 채워짐(위치 매핑 위반): %', g1;
  end if;
  rep := rep || 'index-mapping=ok; ';

  -- 슬롯 0 에 배치하면 활성 수호 0 이 그 자리에 권위 주입된다.
  layers := jsonb_set(public.empty_invasion_layers(), '{l3,guardians}',
    jsonb_build_array(jsonb_build_object('x', 120, 'y', -240), 'null'::jsonb));
  out := public.inject_guardian_authority(layers, u);
  g0 := out->'l3'->'guardians'->0;
  if jsonb_typeof(g0) <> 'object' then
    raise exception 'TM7a3-FAIL 슬롯 0 권위 주입 실패: %', g0;
  end if;
  if (g0->>'performanceCP')::integer <> 9500 then
    raise exception 'TM7a3-FAIL performanceCP 불일치(기대 9500): %', g0->>'performanceCP';
  end if;
  if (g0->>'lineageBonusBp')::integer <> 3000 then
    raise exception 'TM7a3-FAIL lineageBonusBp 불일치(기대 3000): %', g0->>'lineageBonusBp';
  end if;
  if (g0->>'milestones')::integer <> 3 then
    raise exception 'TM7a3-FAIL milestones 불일치(기대 3 = REBOOT|CORE_GUARD): %', g0->>'milestones';
  end if;
  if (g0->>'x')::integer <> 120 or (g0->>'y')::integer <> -240 then
    raise exception 'TM7a3-FAIL 배치 좌표가 보존되지 않음: %', g0;
  end if;
  if g0->'snapshot' is null then
    raise exception 'TM7a3-FAIL 라이브 스냅샷이 주입되지 않음';
  end if;
  rep := rep || 'authority-injected=ok; ';

  -- 슬롯 배열은 언제나 고정 길이 2.
  if jsonb_array_length(out->'l3'->'guardians') <> 2 then
    raise exception 'TM7a3-FAIL 수호 배열 길이가 2 가 아님(%)', jsonb_array_length(out->'l3'->'guardians');
  end if;
  rep := rep || 'fixed-length-2=ok; ';

  raise exception 'TM7a3_ROLLBACK_OK :: %', rep;
end $$;

-- -----------------------------------------------------------------------------
-- T-M7a-4 : begin_invasion v4 — authority {layers, maintenance, modules} + 봉인 가드
-- -----------------------------------------------------------------------------
do $$
declare
  atk    uuid := '0000a704-0000-4000-8000-000000000001';
  def    uuid := '0000a704-0000-4000-8000-000000000002';
  d      uuid := '0000a704-0000-4000-8000-0000000000d1';
  layers jsonb;
  r      jsonb;
  auth   jsonb;
  caught boolean;
  rep    text := '';
begin
  insert into auth.users(id, is_sso_user, is_anonymous) values (atk, false, true), (def, false, true);
  insert into public.profiles(id, save, display_name) values (atk, '{}'::jsonb, 'atk'), (def, '{}'::jsonb, 'def');
  layers := jsonb_set(public.empty_invasion_layers(), '{l1,waveSlots,0}',
    jsonb_build_object('catalogId', 1, 'level', 7, 'ascension', 2, 'affixSeed', 123, 'rarity', 2));
  insert into public.defenses(id, profile_id, layout, budget_spent, maintenance, active)
    values (d, def, layers, 0, 88.00, true);
  insert into public.ladder(profile_id, rank, wins, losses, placed)
    values (def, 601, 0, 0, true), (atk, 602, 0, 0, true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', atk::text, 'role', 'authenticated')::text, true);

  r := public.begin_invasion(d);
  if r->'layers' is null or jsonb_typeof(r->'layers') <> 'object' then
    raise exception 'TM7a4-FAIL 반환에 layers 가 없음: %', r;
  end if;
  if (r->'layers'->'l1'->'waveSlots'->0->>'level')::integer <> 7 then
    raise exception 'TM7a4-FAIL 정확 배치가 아닌 값이 반환됨(정찰 마스킹 오적용): %', r->'layers';
  end if;
  if r->'modules' is null then
    raise exception 'TM7a4-FAIL 반환에 modules 권위가 없음';
  end if;
  rep := rep || 'returns-layers+modules=ok; ';

  select s.authority into auth from public.invasion_snapshots s
    where s.id = (r->>'snapshot_id')::uuid;
  if auth->'layers' is null or auth->'modules' is null or auth->'maintenance' is null then
    raise exception 'TM7a4-FAIL authority 키 누락(layers/maintenance/modules): %', auth;
  end if;
  if (auth->>'maintenance')::numeric <> 88.00 then
    raise exception 'TM7a4-FAIL authority.maintenance 불일치: %', auth->>'maintenance';
  end if;
  rep := rep || 'authority-frozen=ok; ';

  -- 봉인 가드 ①: 자기 침공은 거부(definer 컨텍스트 3차 가드의 1차 지점).
  caught := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', def::text, 'role', 'authenticated')::text, true);
    perform public.begin_invasion(d);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TM7a4-FAIL 자기 침공이 통과됨';
  end if;
  rep := rep || 'self-invasion-blocked=ok; ';

  -- 봉인 가드 ②: 상위/동급 랭크 대상은 거부(매치메이킹 범위 밖 스카우팅 차단).
  caught := false;
  begin
    update public.ladder set rank = 603 where profile_id = atk;  -- 공격자가 더 낮은 순위
    update public.ladder set rank = 604 where profile_id = def;  -- 방어자가 더 아래 → 거부 대상
    perform set_config('request.jwt.claims',
      json_build_object('sub', atk::text, 'role', 'authenticated')::text, true);
    perform public.begin_invasion(d);
  exception when others then
    caught := true;
  end;
  if not caught then
    raise exception 'TM7a4-FAIL 매치메이킹 범위 밖 대상이 통과됨';
  end if;
  rep := rep || 'rank-gate=ok; ';

  raise exception 'TM7a4_ROLLBACK_OK :: %', rep;
end $$;

-- -----------------------------------------------------------------------------
-- T-M7a-5 : begin_invasion → apply_invasion_result e2e (확정·스왑·멱등 보존)
-- -----------------------------------------------------------------------------
do $$
declare
  atk    uuid := '0000a705-0000-4000-8000-000000000001';
  def    uuid := '0000a705-0000-4000-8000-000000000002';
  d      uuid := '0000a705-0000-4000-8000-0000000000d1';
  inv    uuid := '0000a705-0000-4000-8000-0000000000a1';
  snap   jsonb;
  r      jsonb;
  v_atk_rank integer;
  v_def_rank integer;
  rep    text := '';
begin
  insert into auth.users(id, is_sso_user, is_anonymous) values (atk, false, true), (def, false, true);
  insert into public.profiles(id, save, display_name) values (atk, '{}'::jsonb, 'atk'), (def, '{}'::jsonb, 'def');
  insert into public.defenses(id, profile_id, layout, budget_spent, maintenance, active)
    values (d, def, public.empty_invasion_layers(), 0, 100.00, true);
  insert into public.ladder(profile_id, rank, wins, losses, placed)
    values (def, 611, 0, 0, true), (atk, 612, 0, 0, true);

  -- T0 스냅샷 고정(공격자 컨텍스트).
  perform set_config('request.jwt.claims',
    json_build_object('sub', atk::text, 'role', 'authenticated')::text, true);
  snap := public.begin_invasion(d);

  -- 침공 행 제출(서버 컨텍스트로 직접 insert — 클라 RLS 경로는 phase_d 검증 소관).
  perform set_config('request.jwt.claims',
    json_build_object('sub', atk::text, 'role', 'service_role')::text, true);
  insert into public.invasions(id, attacker_id, defender_id, defense_id, snapshot_id, replay, client_result)
    values (inv, atk, def, d, (snap->>'snapshot_id')::uuid, '{}'::jsonb, '{}'::jsonb);

  -- 확정(공격자 승) → 순위 스왑.
  r := public.apply_invasion_result(inv, '{"verdict":"accept"}'::jsonb, true);
  if (r->>'swapped') <> 'true' then
    raise exception 'TM7a5-FAIL 스왑이 일어나지 않음: %', r;
  end if;
  select rank into v_atk_rank from public.ladder where profile_id = atk;
  select rank into v_def_rank from public.ladder where profile_id = def;
  if v_atk_rank <> 611 or v_def_rank <> 612 then
    raise exception 'TM7a5-FAIL 스왑 결과 불일치(atk=%, def=%)', v_atk_rank, v_def_rank;
  end if;
  rep := rep || 'verified+swap=ok; ';

  -- 멱등: 재호출은 already-finalized 로 아무것도 바꾸지 않는다.
  r := public.apply_invasion_result(inv, '{"verdict":"accept"}'::jsonb, true);
  if r->>'note' <> 'already-finalized' then
    raise exception 'TM7a5-FAIL 멱등 위반: %', r;
  end if;
  select rank into v_atk_rank from public.ladder where profile_id = atk;
  if v_atk_rank <> 611 then
    raise exception 'TM7a5-FAIL 재적용이 순위를 다시 움직임(%)', v_atk_rank;
  end if;
  rep := rep || 'idempotent=ok; ';

  raise exception 'TM7a5_ROLLBACK_OK :: %', rep;
end $$;

-- -----------------------------------------------------------------------------
-- T-M7a-6 : 매치메이킹 서빙 — 정찰 마스킹(침공/복수) vs 정확 노출(배치전)
-- -----------------------------------------------------------------------------
do $$
declare
  atk    uuid := '0000a706-0000-4000-8000-000000000001';
  npc    uuid := '0000a706-0000-4000-8000-000000000002';
  pre    uuid := '0000a706-0000-4000-8000-000000000003';  -- 배치전(래더 미진입) 공격자
  d      uuid := '0000a706-0000-4000-8000-0000000000d1';
  layers jsonb;
  row_l  jsonb;
  rep    text := '';
begin
  insert into auth.users(id, is_sso_user, is_anonymous)
    values (atk, false, true), (npc, false, true), (pre, false, true);
  insert into public.profiles(id, save, display_name, is_npc)
    values (atk, '{}'::jsonb, 'atk', false), (npc, '{}'::jsonb, 'npc', true), (pre, '{}'::jsonb, 'rookie', false);
  layers := jsonb_set(public.empty_invasion_layers(), '{l1,waveSlots,0}',
    jsonb_build_object('catalogId', 2, 'level', 33, 'ascension', 1, 'affixSeed', 777, 'rarity', 3));
  insert into public.defenses(id, profile_id, layout, budget_spent, maintenance, active)
    values (d, npc, layers, 0, 100.00, true);
  insert into public.ladder(profile_id, rank, wins, losses, placed)
    values (npc, 621, 0, 0, true), (atk, 622, 0, 0, true);

  -- ① 침공 매치메이킹 → 정찰 마스킹(level·affixSeed 미포함, recon 표식).
  perform set_config('request.jwt.claims',
    json_build_object('sub', atk::text, 'role', 'authenticated')::text, true);
  select t.layout into row_l from public.get_invasion_targets() t where t.defense_id = d;
  if row_l is null then
    raise exception 'TM7a6-FAIL 침공 대상 목록이 비어 있음(후보 규칙 회귀)';
  end if;
  if (row_l->>'recon') <> 'true' then
    raise exception 'TM7a6-FAIL 정찰 표식 없음: %', row_l;
  end if;
  if row_l->'l1'->'waveSlots'->0 ? 'level' then
    raise exception 'TM7a6-FAIL 정확 스펙(level)이 노출됨: %', row_l->'l1'->'waveSlots'->0;
  end if;
  if row_l->'l1'->'waveSlots'->0 ? 'affixSeed' then
    raise exception 'TM7a6-FAIL 정확 스펙(affixSeed)이 노출됨';
  end if;
  if (row_l->'l1'->'waveSlots'->0->>'catalogId')::integer <> 2
     or (row_l->'l1'->'waveSlots'->0->>'rarity')::integer <> 3 then
    raise exception 'TM7a6-FAIL 실루엣·등급이 누락됨: %', row_l->'l1'->'waveSlots'->0;
  end if;
  rep := rep || 'invasion-targets-masked=ok; ';

  -- ② 배치전(NPC) → **정확 배치**(begin_invasion 자격 미달이라 라이브 경로가 정본).
  perform set_config('request.jwt.claims',
    json_build_object('sub', pre::text, 'role', 'authenticated')::text, true);
  select t.layout into row_l from public.get_placement_targets() t where t.defense_id = d;
  if row_l is null then
    raise exception 'TM7a6-FAIL 배치전 대상 목록이 비어 있음';
  end if;
  if (row_l->'l1'->'waveSlots'->0->>'level')::integer <> 33 then
    raise exception 'TM7a6-FAIL 배치전에 정확 level 이 서빙되지 않음(오거부 유발): %', row_l;
  end if;
  rep := rep || 'placement-targets-exact=ok; ';

  raise exception 'TM7a6_ROLLBACK_OK :: %', rep;
end $$;

-- =============================================================================
-- 실행 후 기대 출력(각 블록이 순차적으로 롤백되며 남기는 예외 메시지)
--   TM7a1_ROLLBACK_OK :: empty=ok; wave-overflow=rejected; socket-by-template=ok; ...
--   TM7a2_ROLLBACK_OK :: insert-budget0-maint100=ok; slot-overflow-rejected=ok; ...
--   TM7a3_ROLLBACK_OK :: empty-slot-preserved=ok; index-mapping=ok; authority-injected=ok; ...
--   TM7a4_ROLLBACK_OK :: returns-layers+modules=ok; authority-frozen=ok; ...
--   TM7a5_ROLLBACK_OK :: verified+swap=ok; idempotent=ok;
--   TM7a6_ROLLBACK_OK :: invasion-targets-masked=ok; placement-targets-exact=ok;
-- 하나라도 *-FAIL 이 뜨면 그 지점이 3자 정합(SQL·EF·클라)의 갈림이다 — 머지 금지.
-- =============================================================================
