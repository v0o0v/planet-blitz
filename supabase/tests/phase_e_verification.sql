-- =============================================================================
-- Planet Blitz M4 — Phase E 원격 DB 통합 검증 스크립트 (재현용)
-- =============================================================================
-- 로컬 Docker/Supabase 스택이 없어 원격(qxgbxwyccbxokdgwxcuw)에 대해 MCP execute_sql 로
-- 실행·실측한 통합 테스트를 재현 가능하게 보존한다. 각 테스트는 **트랜잭션 롤백** 또는
-- **RAISE 로 자동 롤백**해 잔류 데이터 0을 보장한다(Phase D T1~T5 패턴 재사용).
--
-- 실행법(둘 중 하나):
--   • Supabase SQL Editor 또는 psql 로 각 블록을 개별 실행(마지막 rollback 이 원복).
--   • MCP execute_sql 로 블록 단위 실행.
-- 모든 블록은 2026-07-17 원격 실측에서 아래 "기대"와 일치함을 확인했다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- T-E1. NPC 시드 무결성 (기대: 전부 20, rank 1~20 연속, budget=layout비용, 예산≤20)
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.profiles where is_npc) as npc_profiles,           -- 20
  (select count(*) from public.defenses where active) as defenses_active,         -- 20
  (select count(*) from public.ladder where placed) as ladder_placed,             -- 20
  (select count(distinct rank) from public.ladder) as distinct_ranks,             -- 20
  (select count(*) from public.defenses
     where budget_spent = public.defense_layout_cost(layout)) as cost_matches,    -- 20
  (select count(*) from public.defenses
     where public.defense_layout_cost(layout) <= 20) as within_budget;            -- 20

-- -----------------------------------------------------------------------------
-- T-E2. AC5 풍화 불변식 — weather_defenses 는 maintenance 만 바꾼다
-- (기대: weathered=20, ladder/profiles/items/def_layoutbudget 전부 unchanged=t, maint_changed=t)
-- -----------------------------------------------------------------------------
do $$
declare hb_l text; ha_l text; hb_p text; ha_p text; hb_i text; ha_i text;
        hb_d text; ha_d text; mb numeric; ma numeric; r integer;
begin
  select md5(coalesce(string_agg(profile_id::text||'|'||rank||'|'||wins||'|'||losses||'|'||placed::text,',' order by profile_id),'')) into hb_l from public.ladder;
  select md5(coalesce(string_agg(id::text||'|'||save::text,',' order by id),'')) into hb_p from public.profiles;
  select md5(coalesce(string_agg(row_id::text||'|'||data::text,',' order by row_id),'')) into hb_i from public.items;
  select md5(coalesce(string_agg(id::text||'|'||layout::text||'|'||budget_spent,',' order by id),'')) into hb_d from public.defenses;
  select sum(maintenance) into mb from public.defenses;
  select public.weather_defenses() into r;
  select md5(coalesce(string_agg(profile_id::text||'|'||rank||'|'||wins||'|'||losses||'|'||placed::text,',' order by profile_id),'')) into ha_l from public.ladder;
  select md5(coalesce(string_agg(id::text||'|'||save::text,',' order by id),'')) into ha_p from public.profiles;
  select md5(coalesce(string_agg(row_id::text||'|'||data::text,',' order by row_id),'')) into ha_i from public.items;
  select md5(coalesce(string_agg(id::text||'|'||layout::text||'|'||budget_spent,',' order by id),'')) into ha_d from public.defenses;
  select sum(maintenance) into ma from public.defenses;
  raise exception 'T-E2 weathered=% ladder_unchanged=% profiles_unchanged=% items_unchanged=% def_layoutbudget_unchanged=% maint_changed=% mb=% ma=%',
    r, (hb_l=ha_l), (hb_p=ha_p), (hb_i=ha_i), (hb_d=ha_d), (mb<>ma), mb, ma;
end $$;
-- 실측: weathered=20 ladder_unchanged=t profiles_unchanged=t items_unchanged=t
--       def_layoutbudget_unchanged=t maint_changed=t mb=2000.00 ma=1900.00

-- -----------------------------------------------------------------------------
-- T-E3. AC4 배치전 삽입 — 4승 → rank 삽입 + 기존 유저 상대 순서 불변
-- (기대: rank=13, existing_order_preserved=t, total_ladder=21)
-- -----------------------------------------------------------------------------
begin;
  -- 삽입 전 기존 래더 순서 스냅샷.
  create temp table _ord_before as
    select string_agg(profile_id::text,'>' order by rank) as ord from public.ladder;
  insert into auth.users(id,instance_id,aud,role,created_at,updated_at,is_sso_user,is_anonymous)
    values ('000000aa-0000-4000-8000-00000000ab01','00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now(),false,false);
  insert into public.profiles(id,save,display_name) values ('000000aa-0000-4000-8000-00000000ab01', jsonb_build_object('credits',0), 'TESTER');
  insert into public.invasions(attacker_id,defender_id,replay,client_result,created_at)
  select '000000aa-0000-4000-8000-00000000ab01', l.profile_id, '{}'::jsonb, '{}'::jsonb, now() - (interval '1 minute' * (21 - l.rank))
  from public.ladder l where l.rank between 16 and 20;
  update public.invasions set verified_status='verified',
    attacker_won = (defender_id <> '000000e5-ed00-4000-8000-000000000001')
  where attacker_id = '000000aa-0000-4000-8000-00000000ab01';
  select public.apply_placement_result('000000aa-0000-4000-8000-00000000ab01') as placement_result;
  -- 삽입 후 기존 유저만(테스터 제외) 순서가 삽입 전과 동일한지.
  select
    ((select ord from _ord_before)
      = (select string_agg(profile_id::text,'>' order by rank) from public.ladder where profile_id <> '000000aa-0000-4000-8000-00000000ab01'))
      as existing_order_preserved,                                                                 -- t
    (select count(*) from public.ladder) as total_ladder,                                          -- 21
    (select rank from public.ladder where profile_id='000000aa-0000-4000-8000-00000000ab01') as tester_rank; -- 13
rollback;
-- 실측: placement_result={"note":"placed","rank":13,"placed":true,"matches_won":4}
--   existing_order_preserved=t total_ladder=21 tester_rank=13

-- -----------------------------------------------------------------------------
-- T-E4. 배치전 게이팅 — 미배치 공격자 승리 → 약탈 0 · 스왑 없음 · verified
-- (기대: attacker_loot_rows=0, npc_rank_still_1=1, npc_losses=1, inv_status=verified)
-- -----------------------------------------------------------------------------
begin;
  insert into auth.users(id,instance_id,aud,role,created_at,updated_at,is_sso_user,is_anonymous)
    values ('000000aa-0000-4000-8000-00000000ab03','00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now(),false,false);
  insert into public.profiles(id,save,display_name) values ('000000aa-0000-4000-8000-00000000ab03', '{}'::jsonb, 'INVTESTER');
  insert into public.items(profile_id,item_id,location,data)
    values ('000000e5-ed00-4000-8000-000000000020','npc-loot-x','inventory','{"g":1}'::jsonb);
  insert into public.invasions(id,attacker_id,defender_id,defense_id,replay,client_result)
    values ('000000cc-0000-4000-8000-00000000cc03','000000aa-0000-4000-8000-00000000ab03','000000e5-ed00-4000-8000-000000000020','000000de-f000-4000-8000-000000000020','{}'::jsonb,'{}'::jsonb);
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select public.apply_invasion_result('000000cc-0000-4000-8000-00000000cc03','{}'::jsonb, true);
  select
    (select count(*) from public.items where profile_id='000000aa-0000-4000-8000-00000000ab03') as attacker_loot_rows,   -- 0
    (select rank from public.ladder where profile_id='000000e5-ed00-4000-8000-000000000020') as npc_rank_still_1,        -- 1
    (select losses from public.ladder where profile_id='000000e5-ed00-4000-8000-000000000020') as npc_losses,           -- 1
    (select verified_status from public.invasions where id='000000cc-0000-4000-8000-00000000cc03') as inv_status;       -- verified
rollback;

-- -----------------------------------------------------------------------------
-- T-E5. 정상 스왑+약탈 회귀 — 배치된 공격자(#016 rank5) → 방어자(#018 rank3) 승리
-- (기대: attacker_rank=3, defender_rank=5, attacker_loot=1)
-- -----------------------------------------------------------------------------
begin;
  insert into public.items(profile_id,item_id,location,data)
    values ('000000e5-ed00-4000-8000-000000000018','def18-item','inventory','{"g":9}'::jsonb);
  insert into public.invasions(id,attacker_id,defender_id,defense_id,replay,client_result)
    values ('000000cc-0000-4000-8000-00000000cc16','000000e5-ed00-4000-8000-000000000016','000000e5-ed00-4000-8000-000000000018','000000de-f000-4000-8000-000000000018','{}'::jsonb,'{}'::jsonb);
  select set_config('request.jwt.claims','{"role":"service_role"}', true);
  select public.apply_invasion_result('000000cc-0000-4000-8000-00000000cc16','{}'::jsonb, true);
  select
    (select rank from public.ladder where profile_id='000000e5-ed00-4000-8000-000000000016') as attacker_rank,  -- 3
    (select rank from public.ladder where profile_id='000000e5-ed00-4000-8000-000000000018') as defender_rank,  -- 5
    (select count(*) from public.items where profile_id='000000e5-ed00-4000-8000-000000000016' and location='inventory') as attacker_loot; -- 1
rollback;

-- -----------------------------------------------------------------------------
-- T-E6. 정비 회복 — credits 1000, maintenance 70 → cost 150, credits 850, maintenance 100
-- -----------------------------------------------------------------------------
do $$
declare tp uuid := '000000aa-0000-4000-8000-00000000ab02'; res jsonb; c_after numeric; m_after numeric;
begin
  insert into auth.users(id,instance_id,aud,role,created_at,updated_at,is_sso_user,is_anonymous)
    values (tp,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now(),false,false);
  -- ADR-0027: 재화가 서버 권위 컬럼(profiles.credits)으로 이관됨 → 초기 크레딧을 컬럼에 세팅.
  insert into public.profiles(id,save,display_name,credits) values (tp, jsonb_build_object('credits',1000), 'REPAIRTESTER', 1000);
  insert into public.defenses(profile_id,layout,budget_spent,maintenance,active)
    values (tp, '{"core":{"x":0,"y":0},"turrets":[],"obstacles":[]}'::jsonb, 0, 70.00, true);
  perform set_config('request.jwt.claims', json_build_object('sub',tp::text,'role','authenticated')::text, true);
  select public.repair_defense(null) into res;
  select credits into c_after from public.profiles where id=tp;  -- ADR-0027: 컬럼 정본에서 읽음.
  select maintenance into m_after from public.defenses where profile_id=tp and active;
  raise exception 'T-E6 res=% credits_after=% maint_after=%', res, c_after, m_after;
end $$;
-- 실측: res={"cost":150,"note":"repaired","credits":850,"credits_left":850,"repaired":true,"maintenance":100.00}
--       credits_after=850 maint_after=100.00 (credits_after 는 profiles.credits 컬럼)

-- -----------------------------------------------------------------------------
-- T-E7. 비활성 침하 — #011(rank10) 40일 미접속 → rank13(-3), 아래 3명 상승, 상대순서 보존
-- (기대: inactive→13, p010→10, p009→11, p008→12, p012→9, distinct=20)
-- -----------------------------------------------------------------------------
begin;
  update public.ladder set last_active = now() - interval '40 days' where profile_id='000000e5-ed00-4000-8000-000000000011';
  select public.sink_inactive() as rows_changed;
  select
    (select rank from public.ladder where profile_id='000000e5-ed00-4000-8000-000000000011') as inactive_new_rank,  -- 13
    (select rank from public.ladder where profile_id='000000e5-ed00-4000-8000-000000000010') as p010_new,           -- 10
    (select rank from public.ladder where profile_id='000000e5-ed00-4000-8000-000000000012') as p012_unchanged,     -- 9
    (select count(distinct rank) from public.ladder) as distinct_ranks;                                             -- 20
rollback;
-- 전원 활성 시 sink_inactive() = 0 행(멱등) 도 확인.

-- -----------------------------------------------------------------------------
-- T-E8. DELETE 우회 봉인 — authenticated 가 자기 방어 DELETE 시도 → 0행(RLS 거부)
-- (기대: deleted_rows=0, still_exists=1)
-- -----------------------------------------------------------------------------
begin;
  select set_config('request.jwt.claims','{"sub":"000000e5-ed00-4000-8000-000000000001","role":"authenticated"}', true);
  set local role authenticated;
  create temp table _r as
    with d as (delete from public.defenses where id='000000de-f000-4000-8000-000000000001' returning 1)
    select count(*) c from d;
  reset role;
  select (select c from _r) as deleted_rows, (select count(*) from public.defenses where id='000000de-f000-4000-8000-000000000001') as still_exists;
rollback;

-- -----------------------------------------------------------------------------
-- T-E9. [리뷰 MED-1] NPC 침하 면제 — 전 NPC 비활성(last_active 40일 전)이어도 sink 가
-- NPC rank 를 건드리지 않는다(NPC 는 '미접속 유저'가 아님 — 난이도 분포 보존).
-- (기대: rows_changed=0, npc_rank_changes=0, distinct_ranks=20)
-- -----------------------------------------------------------------------------
begin;
  create temp table _ranks_before as select profile_id, rank from public.ladder;
  update public.ladder set last_active = now() - interval '40 days';  -- 전 NPC 비활성화
  select public.sink_inactive() as rows_changed;                       -- 0
  select
    (select count(*) from public.ladder l join _ranks_before b on b.profile_id = l.profile_id
       where l.rank <> b.rank) as npc_rank_changes,                    -- 0
    (select count(distinct rank) from public.ladder) as distinct_ranks; -- 20
rollback;

-- -----------------------------------------------------------------------------
-- T-E10. [리뷰 MED-1 혼합] 실유저(비NPC) 비활성 → -3 침하, NPC 는 40일 미접속이어도 불변.
-- (기대: user_rank 10→13, NPC 상대 순서 #20>…>#01 그대로, distinct=21)
-- -----------------------------------------------------------------------------
begin;
  insert into auth.users(id,instance_id,aud,role,created_at,updated_at,is_sso_user,is_anonymous)
    values ('000000aa-0000-4000-8000-00000000ab04','00000000-0000-0000-0000-000000000000','authenticated','authenticated',now(),now(),false,false);
  insert into public.profiles(id,save,display_name) values ('000000aa-0000-4000-8000-00000000ab04','{}'::jsonb,'SINKTESTER');
  update public.ladder set rank = rank + 1 where rank >= 10;
  insert into public.ladder(profile_id, rank, placed, last_active)
    values ('000000aa-0000-4000-8000-00000000ab04', 10, true, now() - interval '40 days');
  update public.ladder set last_active = now() - interval '40 days'
    where profile_id <> '000000aa-0000-4000-8000-00000000ab04';
  select public.sink_inactive() as rows_changed;
  select
    (select rank from public.ladder where profile_id='000000aa-0000-4000-8000-00000000ab04') as user_rank,  -- 13
    (select string_agg(l.profile_id::text,'>' order by l.rank) from public.ladder l
       join public.profiles p on p.id=l.profile_id where p.is_npc) as npc_order_after,  -- #20>…>#01
    (select count(distinct rank) from public.ladder) as distinct_ranks;                 -- 21
rollback;

-- -----------------------------------------------------------------------------
-- T-E11. [리뷰 MED-2] repair_defense 프로필 행 잠금 — 라이브 함수 정의에 for update 반영
-- 확인 + 기능 회귀(T-E6 재실행 동일 기대값). 동시 두 세션 재현은 단일 연결(MCP/SQL Editor)
-- 로 불가 — `select … from profiles where id = v_me for update` 가 두 번째 트랜잭션을
-- 첫 커밋까지 블록시키는 것은 PostgreSQL 행 잠금 시맨틱 보장이므로, 정의 실측 + 기능
-- 회귀로 검증을 갈음한다(마이그레이션 주석에 택1 근거 문서화).
-- (기대: repair_lock_applied=t, T-E6 재실행 결과 동일)
-- -----------------------------------------------------------------------------
select
  (select position('from public.profiles where id = v_me for update' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='repair_defense') as repair_lock_applied,
  (select position('not p.is_npc' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='sink_inactive') as sink_npc_excluded;
