-- =============================================================================
-- Planet Blitz M4 — Phase F 원격 통합 테스트 재현 스크립트 (T-F1 ~ T-F6)
-- =============================================================================
-- 각 테스트는 자기 데이터를 세팅하고 마지막에 `raise exception 'TFn_ROLLBACK_OK :: ...'`
-- 으로 전체 트랜잭션을 롤백한다(잔류 데이터 0). 성공 시 그 리포트 메시지가, 실패 시 해당
-- assert 의 실패 메시지가 예외로 올라온다. 원격 `qxgbxwyccbxokdgwxcuw` 에서 MCP execute_sql
-- (current_user=postgres → is_service_role/caller 시뮬레이션은 set_config request.jwt.claims)로
-- 2026-07-17 전건 통과 실측(README "Phase F 원격 실측" 참조).
--
-- ⚠️ 테스트 UUID 는 '0000ffNN-...' 대역(실데이터 회피). 래더 rank 는 기존 NPC 시드(rank
--    1..20)와 겹치지 않게 500 대역 사용.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- T-F1 : 도발 스티커 설정·불변·참여자·범위 (F2 · AC12)
-- -----------------------------------------------------------------------------
-- 리뷰 MED(승자 한정, 20260717160000) 반영 개정판: 스티커는 확정된 침공의 승자만 달 수
-- 있으므로, 공격자용은 승리 침공(win) / 방어자용은 방어 성공 침공(lose) 을 각각 쓴다.
do $$
declare
  a uuid := '0000ff01-0000-4000-8000-000000000001';
  b uuid := '0000ff01-0000-4000-8000-000000000002';
  c uuid := '0000ff01-0000-4000-8000-000000000003';
  win uuid := '0000ff01-0000-4000-8000-0000000000a1';   -- 공격 성공(attacker_won=true)
  lose uuid := '0000ff01-0000-4000-8000-0000000000a2';  -- 공격 실패(attacker_won=false)
  r jsonb; v_as smallint; v_ds smallint; caught boolean; rep text := '';
begin
  insert into auth.users(id,is_sso_user,is_anonymous) values (a,false,true),(b,false,true),(c,false,true);
  insert into public.profiles(id,save,display_name) values (a,'{}'::jsonb,'atk'),(b,'{}'::jsonb,'def'),(c,'{}'::jsonb,'bystander');
  -- 서버 컨텍스트(postgres = is_service_role)라 verified/attacker_won 직접 세팅 가능.
  insert into public.invasions(id,attacker_id,defender_id,replay,client_result,verified_status,attacker_won,verified_at)
    values (win,a,b,'{}'::jsonb,'{}'::jsonb,'verified',true,now()),
           (lose,a,b,'{}'::jsonb,'{}'::jsonb,'verified',false,now());

  perform set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
  r := public.set_invasion_sticker(win, 3::smallint);
  if not (r->>'ok')='true' or r->>'side'<>'attacker' or (r->>'sticker')<>'3' then raise exception 'TF1-FAIL set#1: %', r; end if;
  rep := rep || 'set-attacker=ok; ';
  r := public.set_invasion_sticker(win, 5::smallint);
  if (r->>'ok')<>'false' or r->>'note'<>'already-set' or (r->>'sticker')<>'3' then raise exception 'TF1-FAIL immutable: %', r; end if;
  rep := rep || 'attacker-immutable=ok; ';
  perform set_config('request.jwt.claims', json_build_object('sub',b::text,'role','authenticated')::text, true);
  r := public.set_invasion_sticker(lose, 7::smallint);
  if not (r->>'ok')='true' or r->>'side'<>'defender' then raise exception 'TF1-FAIL def set: %', r; end if;
  rep := rep || 'set-defender=ok; ';
  perform set_config('request.jwt.claims', json_build_object('sub',c::text,'role','authenticated')::text, true);
  caught := false; begin r := public.set_invasion_sticker(win, 1::smallint); exception when others then caught := true; end;
  if not caught then raise exception 'TF1-FAIL non-participant not rejected'; end if;
  rep := rep || 'non-participant-reject=ok; ';
  perform set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
  caught := false; begin r := public.set_invasion_sticker(win, 12::smallint); exception when others then caught := true; end;
  if not caught then raise exception 'TF1-FAIL range-12 not rejected'; end if;
  rep := rep || 'range-reject=ok; ';
  select attacker_sticker into v_as from public.invasions where id=win;
  select defender_sticker into v_ds from public.invasions where id=lose;
  if v_as<>3 or v_ds<>7 then raise exception 'TF1-FAIL final cols a=% d=%', v_as, v_ds; end if;
  raise exception 'TF1_ROLLBACK_OK :: %final(win.a=%s,lose.d=%s)', rep, v_as, v_ds;
end $$;

-- -----------------------------------------------------------------------------
-- T-F2/T-F4 : 복수 대상 판정·격차30 예외 탈환·보너스 광물·복수 소비 (F1 · AC6)
-- -----------------------------------------------------------------------------
do $$
declare
  a uuid := '0000ff02-0000-4000-8000-000000000001';  -- 복수자
  b uuid := '0000ff02-0000-4000-8000-000000000002';  -- 대상(직전 나를 스왑한 자)
  defa uuid := '0000ff02-0000-4000-8000-0000000000d1';
  defb uuid := '0000ff02-0000-4000-8000-0000000000d2';
  loss uuid := '0000ff02-0000-4000-8000-0000000000c0';
  rev  uuid := '0000ff02-0000-4000-8000-0000000000c1';
  r jsonb; rt_cnt int; sec int; rid uuid; cool boolean;
  a_rank int; b_rank int; a_min numeric; cs boolean; isr boolean; rep text := '';
begin
  insert into auth.users(id,is_sso_user,is_anonymous) values (a,false,true),(b,false,true);
  -- ADR-0027: 재화가 서버 권위 컬럼(profiles.minerals)으로 이관됨 → 초기 광물을 컬럼에 세팅.
  insert into public.profiles(id,save,display_name,minerals) values
    (a,'{"minerals":100,"credits":0}'::jsonb,'revenger',100),(b,'{"minerals":0,"credits":0}'::jsonb,'target',0);
  insert into public.defenses(id,profile_id,layout,budget_spent,maintenance,active) values
    (defa,a,'{"core":{},"turrets":[],"obstacles":[]}'::jsonb,0,100,true),
    (defb,b,'{"core":{},"turrets":[],"obstacles":[]}'::jsonb,0,100,true);
  insert into public.ladder(profile_id,rank,defense_id,wins,losses,placed) values (a,540,defa,0,1,true),(b,500,defb,1,0,true);
  insert into public.invasions(id,attacker_id,defender_id,defense_id,replay,client_result,verified_status,attacker_won,caused_swap,created_at,verified_at)
    values (loss,b,a,defa,'{}'::jsonb,'{}'::jsonb,'verified',true,true, now()-interval '1 hour', now()-interval '1 hour');
  insert into public.invasions(id,attacker_id,defender_id,defense_id,replay,client_result,verified_status,created_at)
    values (rev,a,b,defb,'{}'::jsonb,'{}'::jsonb,'pending', now());

  perform set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
  select count(*)::int into rt_cnt from public.get_revenge_targets() where profile_id=b;
  select seconds_remaining, revenge_invasion_id, can_ignore_cooldown into sec, rid, cool from public.get_revenge_targets() where profile_id=b;
  if rt_cnt<>1 then raise exception 'TF2-FAIL revenge_targets cnt=%', rt_cnt; end if;
  if rid<>loss then raise exception 'TF2-FAIL revenge_invasion_id=%', rid; end if;
  if not cool then raise exception 'TF2-FAIL can_ignore_cooldown=%', cool; end if;
  if sec is null or sec<=0 or sec>86400 then raise exception 'TF2-FAIL seconds_remaining=%', sec; end if;
  rep := rep || format('get_revenge_targets(1건,sec=%s,cooldown-waived)=ok; ', sec);

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.apply_invasion_result(rev, '{}'::jsonb, true);
  if (r->>'is_revenge')<>'true' then raise exception 'TF2-FAIL is_revenge=%', r; end if;
  if (r->>'swapped')<>'true' then raise exception 'TF2-FAIL swapped(격차40 복수 예외)=%', r; end if;
  if (r->>'bonus_minerals')<>'50' then raise exception 'TF2-FAIL bonus=%', r; end if;
  if (r->>'attacker_minerals_left')<>'150' then raise exception 'TF2-FAIL att_min_left(ADR-0027)=%', r; end if;
  if (r->>'attacker_rank')<>'500' or (r->>'defender_rank')<>'540' then raise exception 'TF2-FAIL ranks=%', r; end if;
  rep := rep || 'apply-revenge(swap+bonus50)=ok; ';

  select rank into a_rank from public.ladder where profile_id=a;
  select rank into b_rank from public.ladder where profile_id=b;
  select minerals into a_min from public.profiles where id=a;  -- ADR-0027: 컬럼 정본에서 읽음.
  select caused_swap, is_revenge into cs, isr from public.invasions where id=rev;
  if a_rank<>500 or b_rank<>540 then raise exception 'TF2-FAIL post ranks a=% b=%', a_rank, b_rank; end if;
  if a_min<>150 then raise exception 'TF2-FAIL minerals=%', a_min; end if;
  if not cs or not isr then raise exception 'TF2-FAIL flags cs=% isr=%', cs, isr; end if;
  rep := rep || 'post(A.rank=500,B.rank=540,minerals=150,cs=t,isr=t)=ok; ';

  select count(*)::int into rt_cnt from public.revenge_targets_for(a) where target_id=b;
  if rt_cnt<>0 then raise exception 'TF4-FAIL 복수 미소비 cnt=%', rt_cnt; end if;
  raise exception 'TF2_ROLLBACK_OK :: %TF4:revenge-consumed=ok', rep;
end $$;

-- -----------------------------------------------------------------------------
-- T-F3 : 비대상 격차>30 스왑 거부(HIGH 리프프로그 가드 미개방) + 정상 격차≤30 스왑·caused_swap
-- -----------------------------------------------------------------------------
do $$
declare
  d uuid := '0000ff03-0000-4000-8000-000000000001'; e uuid := '0000ff03-0000-4000-8000-000000000002';
  f uuid := '0000ff03-0000-4000-8000-000000000003'; g uuid := '0000ff03-0000-4000-8000-000000000004';
  dd uuid := '0000ff03-0000-4000-8000-0000000000d1'; de uuid := '0000ff03-0000-4000-8000-0000000000d2';
  df uuid := '0000ff03-0000-4000-8000-0000000000d3'; dg uuid := '0000ff03-0000-4000-8000-0000000000d4';
  i1 uuid := '0000ff03-0000-4000-8000-0000000000c1'; i2 uuid := '0000ff03-0000-4000-8000-0000000000c2';
  r jsonb; d_rank int; e_rank int; cs boolean; rep text := '';
begin
  insert into auth.users(id,is_sso_user,is_anonymous) values (d,false,true),(e,false,true),(f,false,true),(g,false,true);
  insert into public.profiles(id,save,display_name) values (d,'{}'::jsonb,'d'),(e,'{}'::jsonb,'e'),(f,'{}'::jsonb,'f'),(g,'{}'::jsonb,'g');
  insert into public.defenses(id,profile_id,layout,budget_spent,maintenance,active) values
    (dd,d,'{"core":{},"turrets":[],"obstacles":[]}'::jsonb,0,100,true),(de,e,'{"core":{},"turrets":[],"obstacles":[]}'::jsonb,0,100,true),
    (df,f,'{"core":{},"turrets":[],"obstacles":[]}'::jsonb,0,100,true),(dg,g,'{"core":{},"turrets":[],"obstacles":[]}'::jsonb,0,100,true);
  insert into public.ladder(profile_id,rank,defense_id,placed) values (d,640,dd,true),(e,600,de,true),(f,620,df,true),(g,590,dg,true);
  insert into public.invasions(id,attacker_id,defender_id,defense_id,replay,client_result,verified_status,created_at)
    values (i1,d,e,de,'{}'::jsonb,'{}'::jsonb,'pending',now()),(i2,f,g,dg,'{}'::jsonb,'{}'::jsonb,'pending',now());

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.apply_invasion_result(i1, '{}'::jsonb, true);
  if (r->>'swapped')<>'false' then raise exception 'TF3-FAIL 격차40 비복수 스왑됨=%', r; end if;
  if (r->>'is_revenge')<>'false' then raise exception 'TF3-FAIL is_revenge=%', r; end if;
  if (r->>'bonus_minerals')<>'0' then raise exception 'TF3-FAIL bonus=%', r; end if;
  select rank into d_rank from public.ladder where profile_id=d;
  select rank into e_rank from public.ladder where profile_id=e;
  select caused_swap into cs from public.invasions where id=i1;
  if d_rank<>640 or e_rank<>600 then raise exception 'TF3-FAIL 순위변동 d=% e=%', d_rank, e_rank; end if;
  if cs then raise exception 'TF3-FAIL caused_swap 잘못 기록'; end if;
  rep := rep || '비복수격차40(no-swap,cs=f,순위불변)=ok; ';

  r := public.apply_invasion_result(i2, '{}'::jsonb, true);
  if (r->>'swapped')<>'true' then raise exception 'TF3-FAIL 격차20 스왑실패=%', r; end if;
  if (r->>'is_revenge')<>'false' then raise exception 'TF3-FAIL 정상 is_revenge=%', r; end if;
  select caused_swap into cs from public.invasions where id=i2;
  if not cs then raise exception 'TF3-FAIL 정상스왑 caused_swap 미기록'; end if;
  raise exception 'TF3_ROLLBACK_OK :: %정상격차20(swap,cs=t)=ok', rep;
end $$;

-- -----------------------------------------------------------------------------
-- T-F5 : get_incoming_invasions 방어자 폴링(스티커·필드·since 필터)
-- -----------------------------------------------------------------------------
do $$
declare
  a uuid := '0000ff05-0000-4000-8000-000000000001'; b uuid := '0000ff05-0000-4000-8000-000000000002';
  iv uuid := '0000ff05-0000-4000-8000-0000000000c1';
  nm text; aw boolean; ask smallint; isr boolean; cnt int; rep text := '';
begin
  insert into auth.users(id,is_sso_user,is_anonymous) values (a,false,true),(b,false,true);
  insert into public.profiles(id,save,display_name) values (a,'{}'::jsonb,'attacker-A'),(b,'{}'::jsonb,'defender-B');
  insert into public.invasions(id,attacker_id,defender_id,replay,client_result,verified_status,attacker_won,is_revenge,attacker_sticker,created_at,verified_at)
    values (iv,a,b,'{}'::jsonb,'{}'::jsonb,'verified',true,true,5, now()-interval '10 min', now()-interval '9 min');

  perform set_config('request.jwt.claims', json_build_object('sub',b::text,'role','authenticated')::text, true);
  select count(*)::int into cnt from public.get_incoming_invasions(null, 50);
  if cnt<>1 then raise exception 'TF5-FAIL cnt=%', cnt; end if;
  select attacker_name, attacker_won, attacker_sticker, is_revenge into nm, aw, ask, isr from public.get_incoming_invasions(null,50) limit 1;
  if nm<>'attacker-A' or not aw or ask<>5 or not isr then raise exception 'TF5-FAIL fields nm=% aw=% ask=% isr=%', nm, aw, ask, isr; end if;
  rep := rep || 'incoming(name,sticker=5,won,revenge)=ok; ';
  select count(*)::int into cnt from public.get_incoming_invasions(now()+interval '1 min', 50);
  if cnt<>0 then raise exception 'TF5-FAIL since-filter cnt=%', cnt; end if;
  rep := rep || 'since-filter=ok; ';
  perform set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
  select count(*)::int into cnt from public.get_incoming_invasions(null,50);
  if cnt<>0 then raise exception 'TF5-FAIL 공격자조회 cnt=%', cnt; end if;
  raise exception 'TF5_ROLLBACK_OK :: %attacker-sees-none=ok', rep;
end $$;

-- -----------------------------------------------------------------------------
-- T-F6 : flag_pve_anomalies 통계 이상치 판별(오탐/NPC/나이 필터) (F4 · AC11)
-- -----------------------------------------------------------------------------
do $$
declare
  o uuid := '0000ff06-0000-4000-8000-000000000001'; nmo uuid := '0000ff06-0000-4000-8000-000000000002';
  nw uuid := '0000ff06-0000-4000-8000-000000000003'; np uuid := '0000ff06-0000-4000-8000-000000000004';
  fo boolean; fn boolean; fnew boolean; fnpc boolean;
begin
  insert into auth.users(id,is_sso_user,is_anonymous) values (o,false,true),(nmo,false,true),(nw,false,true),(np,false,true);
  -- ADR-0027: flag_pve_anomalies 는 이제 profiles.credits/minerals 컬럼을 읽는다 → 컬럼에 세팅.
  insert into public.profiles(id,save,display_name,is_npc,created_at,credits,minerals) values
    (o,'{"credits":300000,"minerals":300000}'::jsonb,'outlier',false, now()-interval '2 hour',300000,300000),
    (nmo,'{"credits":100000,"minerals":100000}'::jsonb,'normal',false, now()-interval '100 hour',100000,100000),
    (nw,'{"credits":30000,"minerals":30000}'::jsonb,'new',false, now()-interval '6 min',30000,30000),
    (np,'{"credits":9999999,"minerals":9999999}'::jsonb,'npc',true, now()-interval '100 hour',9999999,9999999);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.flag_pve_anomalies();
  select flagged into fo from public.profiles where id=o;
  select flagged into fn from public.profiles where id=nmo;
  select flagged into fnew from public.profiles where id=nw;
  select flagged into fnpc from public.profiles where id=np;
  if not fo then raise exception 'TF6-FAIL 이상치 미플래그'; end if;
  if fn then raise exception 'TF6-FAIL 정상 오탐'; end if;
  if fnew then raise exception 'TF6-FAIL 신규 오탐(나이<1h)'; end if;
  if fnpc then raise exception 'TF6-FAIL NPC 오탐'; end if;
  raise exception 'TF6_ROLLBACK_OK :: 이상치=flagged;정상=clean;신규=clean;NPC=clean';
end $$;

-- -----------------------------------------------------------------------------
-- T-F7/T-F8 : 리뷰 반영(20260717160000) — self insert 거부 복원 · 스티커 승자 한정
-- -----------------------------------------------------------------------------
-- T-F7 [HIGH 회귀 테스트]: guard_invasions_client_insert 의 self-invasion raise(Phase D
--   CRITICAL 원문, 역할 무관)가 살아 있는지. **guard_invasions_client_insert 를 재정의하는
--   마이그레이션이 생기면 반드시 이 테스트를 재실행할 것**(140000 회귀의 재발 방지).
-- T-F8 [MED]: set_invasion_sticker 승자 한정 — 공격자는 attacker_won=true, 방어자는 false
--   일 때만 설정 가능. 패자·미확정(pending/null)은 {ok:false, note:'not-winner'}.
do $$
declare
  a uuid := '0000ff07-0000-4000-8000-000000000001';
  b uuid := '0000ff07-0000-4000-8000-000000000002';
  win uuid := '0000ff07-0000-4000-8000-0000000000a1';   -- 공격 성공
  lose uuid := '0000ff07-0000-4000-8000-0000000000a2';  -- 공격 실패(방어 성공)
  pend uuid := '0000ff07-0000-4000-8000-0000000000a3';  -- 미확정
  r jsonb; caught boolean; errc text; rep text := '';
begin
  insert into auth.users(id,is_sso_user,is_anonymous) values (a,false,true),(b,false,true);
  insert into public.profiles(id,save,display_name) values (a,'{}'::jsonb,'atk'),(b,'{}'::jsonb,'def');
  insert into public.invasions(id,attacker_id,defender_id,replay,client_result,verified_status,attacker_won,verified_at)
    values (win,a,b,'{}'::jsonb,'{}'::jsonb,'verified',true,now()),
           (lose,a,b,'{}'::jsonb,'{}'::jsonb,'verified',false,now());
  insert into public.invasions(id,attacker_id,defender_id,replay,client_result,verified_status)
    values (pend,a,b,'{}'::jsonb,'{}'::jsonb,'pending');

  -- T-F7: self-invasion insert → check_violation raise (역할 무관 — 서버 컨텍스트에서도).
  caught := false;
  begin
    insert into public.invasions(id,attacker_id,defender_id,replay,client_result)
      values ('0000ff07-0000-4000-8000-0000000000ee',a,a,'{}'::jsonb,'{}'::jsonb);
  exception when others then caught := true; errc := sqlstate; end;
  if not caught then raise exception 'TF7-FAIL self insert 통과됨(가드 회귀)'; end if;
  if errc <> '23514' then raise exception 'TF7-FAIL errcode=% (기대 check_violation)', errc; end if;
  rep := rep || 'TF7:self-insert-reject(check_violation)=ok; ';

  -- T-F8a: 승리 공격자 설정 허용.
  perform set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
  r := public.set_invasion_sticker(win, 2::smallint);
  if (r->>'ok')<>'true' then raise exception 'TF8-FAIL 승자 설정 거부됨=%', r; end if;
  rep := rep || 'TF8a:winner-attacker-set=ok; ';
  -- T-F8b: 패배 공격자 거부.
  r := public.set_invasion_sticker(lose, 2::smallint);
  if (r->>'ok')<>'false' or r->>'note'<>'not-winner' then raise exception 'TF8-FAIL 패자 공격자=%', r; end if;
  rep := rep || 'TF8b:loser-attacker-reject=ok; ';
  -- T-F8c: 방어 실패 방어자 거부.
  perform set_config('request.jwt.claims', json_build_object('sub',b::text,'role','authenticated')::text, true);
  r := public.set_invasion_sticker(win, 9::smallint);
  if (r->>'ok')<>'false' or r->>'note'<>'not-winner' then raise exception 'TF8-FAIL 패자 방어자=%', r; end if;
  rep := rep || 'TF8c:loser-defender-reject=ok; ';
  -- T-F8d: 방어 성공 방어자 설정 허용.
  r := public.set_invasion_sticker(lose, 9::smallint);
  if (r->>'ok')<>'true' or r->>'side'<>'defender' then raise exception 'TF8-FAIL 승자 방어자=%', r; end if;
  rep := rep || 'TF8d:winner-defender-set=ok; ';
  -- T-F8e: 미확정(pending) 양측 거부.
  perform set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
  r := public.set_invasion_sticker(pend, 1::smallint);
  if (r->>'ok')<>'false' or r->>'note'<>'not-winner' then raise exception 'TF8-FAIL pending 공격자=%', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',b::text,'role','authenticated')::text, true);
  r := public.set_invasion_sticker(pend, 1::smallint);
  if (r->>'ok')<>'false' or r->>'note'<>'not-winner' then raise exception 'TF8-FAIL pending 방어자=%', r; end if;
  rep := rep || 'TF8e:pending-both-reject=ok; ';
  -- 회귀: 승자 게이트 뒤에서도 1회 불변 유지.
  perform set_config('request.jwt.claims', json_build_object('sub',a::text,'role','authenticated')::text, true);
  r := public.set_invasion_sticker(win, 6::smallint);
  if (r->>'ok')<>'false' or r->>'note'<>'already-set' or (r->>'sticker')<>'2' then
    raise exception 'TF8-FAIL 재설정=%', r; end if;
  raise exception 'TF7_TF8_ROLLBACK_OK :: %winner-immutable=ok', rep;
end $$;
