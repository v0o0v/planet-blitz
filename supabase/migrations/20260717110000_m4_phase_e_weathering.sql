-- =============================================================================
-- Planet Blitz M4 — Phase E · 풍화/침하 잡 함수 + DELETE 우회 봉인 (계획 §4 E3/E4)
-- =============================================================================
-- 근거: ADR-0006(풍화 — 정비도만 감쇠), ADR-0007(수호 기체 성능 감쇠·회복불가·바닥50%),
--   GDD §8("비활성 침하 — 30일 미접속 주기 순위 하락")·§9, 계약 3/5/6, README "Phase D
--   착수 조건 ②-2"(DELETE→재생성 정비도 리셋 우회).
--
-- 담는 것(cron 스케줄은 별도 마이그레이션 _cron_schedule — pg_cron 활성 실패해도 이 함수
-- 들은 남도록 분리, 계약 "pg_cron 불가 시 잡 함수까지는 구현"):
--   1. defenses DELETE 우회 봉인 — 클라이언트 DELETE 정책 제거(착수 조건 ②-2 이행).
--   2. weather_defenses()  — 주간 정비도 -5%p(정비도만·나머지 절대 불변, AC5).
--   3. weather_guardians() — 주간 수호 성능 -5%p, 바닥 50%, 회복 불가(ADR-0007).
--   4. sink_inactive()     — 30일+ 미접속 순위 침하(재랭킹, 상대 순서 클래스 내 보존).
--   5. ladder.defense_id 백필 결정 문서화(이월 항목).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. DELETE→재생성 정비도 리셋 우회 봉인 (README 착수 조건 ②-2)
-- -----------------------------------------------------------------------------
-- 문제: defenses_rw_own(FOR ALL)은 DELETE 도 허용한다. 풍화로 maintenance 가 낮아진 행을
-- 클라이언트가 지우고 maintenance 기본값 100 인 새 행을 INSERT 하면 풍화가 무력화된다
-- (defenses_one_active_idx 는 삭제 후 재삽입을 막지 못함). 정비는 크레딧을 내야 하는데
-- 이 우회는 공짜다 → ADR-0006 위반.
--
-- 해법(착수 조건 ②-2 옵션 "DELETE 를 service_role 전용으로 제한"): FOR ALL 정책을 명시적
-- SELECT/INSERT/UPDATE own 정책으로 분해하고 **DELETE 정책을 만들지 않는다** → 클라이언트
-- DELETE 는 RLS 기본 거부. service_role(서버 로직)은 BYPASSRLS 라 필요 시 삭제 가능하고,
-- profiles 삭제 시 FK on delete cascade 는 RLS 와 무관하게 동작하므로 계정 삭제 경로는
-- 안 깨진다. 방어 교체는 기존대로 UPDATE(defenseSync)로 하며, maintenance 는 UPDATE
-- 가드가 이전 값 유지 → 정비도 보존. 이로써 풍화 무력화 우회가 닫힌다.
drop policy if exists defenses_rw_own on public.defenses;

drop policy if exists defenses_select_own on public.defenses;
create policy defenses_select_own
  on public.defenses for select
  to authenticated
  using (auth.uid() = profile_id);

drop policy if exists defenses_insert_own on public.defenses;
create policy defenses_insert_own
  on public.defenses for insert
  to authenticated
  with check (auth.uid() = profile_id);

drop policy if exists defenses_update_own on public.defenses;
create policy defenses_update_own
  on public.defenses for update
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
-- DELETE 정책 없음 → 클라이언트 삭제 거부(우회 봉인). service_role 는 BYPASSRLS.

-- -----------------------------------------------------------------------------
-- 2. weather_defenses — 주간 정비도 감쇠 (AC5: 정비도만·나머지 절대 불변)
-- -----------------------------------------------------------------------------
-- 주 1회(일요일 자정 UTC, 스케줄은 _cron_schedule) 모든 방어의 maintenance 를 5%p 낮춘다
-- (바닥 0). **이 함수는 defenses.maintenance 외 아무 것도 쓰지 않는다** — 자원(profiles.
-- save)·장비(items)·순위(ladder)·budget_spent·layout 전부 불변(AC5 증명 대상).
-- SECURITY DEFINER 소유자(postgres) 컨텍스트라 guard_defenses_client_write 의
-- is_service_role() 이 true → 가드가 우회되어 maintenance 직접 갱신이 유효하다.
create or replace function public.weather_defenses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  update public.defenses
    set maintenance = greatest(0, maintenance - 5)
    where maintenance > 0;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.weather_defenses() from public;
revoke all on function public.weather_defenses() from anon, authenticated;
grant execute on function public.weather_defenses() to service_role;

-- -----------------------------------------------------------------------------
-- 3. weather_guardians — 주간 수호 기체 성능 감쇠 (ADR-0007, 별도 잡)
-- -----------------------------------------------------------------------------
-- ADR-0007: 수호 기체 성능은 주 5%p 감쇠, 바닥 50%, 회복 불가(수명형), 자동 소멸 없음.
-- **weather_defenses 와 분리**한 이유: AC5(풍화가 정비도만 건드림) 증명은 weather_defenses
-- 단독을 검사한다. 수호 성능 감쇠는 별개 잡으로 두어 그 불변식 검사를 오염시키지 않는다.
-- M4 에서 guardians 는 빈 자리(M5 활성)라 실효 대상은 아직 없지만 배선을 선반영한다.
create or replace function public.weather_guardians()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  update public.guardians
    set performance = greatest(50, performance - 5)
    where not retired and performance > 50;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.weather_guardians() from public;
revoke all on function public.weather_guardians() from anon, authenticated;
grant execute on function public.weather_guardians() to service_role;

-- -----------------------------------------------------------------------------
-- 4. sink_inactive — 비활성 침하 (30일+ 미접속 주기 순위 하락, GDD §8)
-- -----------------------------------------------------------------------------
-- 기본안(문서화 · 튜닝 대상): last_active 가 30일 이전인 프로필은 실행마다 **정렬 키에
-- +SINK_STEP(=3)** 을 더해 재랭킹된다 → 최대 3위 하락. 활성 유저는 sort_key=기존 rank 라
-- 상대 순서 보존, 비활성 유저끼리도 기존 rank 순서 보존(동일 +3). 전 행 dense re-number
-- 라 rank 는 1..n 연속을 유지한다. **비활성이 하나도 없으면 sort_key=old_rank → 재번호가
-- 동일 → 0행 갱신**(멱등). 순위(rank)만 바꾸며, 이는 침하 잡의 본질(직접 순위 하락, 풍화와
-- 달리 순위 변경이 목적)이라 ADR-0006 "풍화는 순위 불변"과 충돌하지 않는다(침하 ≠ 풍화).
create or replace function public.sink_inactive()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cut timestamptz := now() - interval '30 days';
  v_n   integer;
begin
  with scored as (
    select
      profile_id,
      rank + case when last_active < v_cut then 3 else 0 end as sort_key,
      case when last_active < v_cut then 1 else 0 end as inactive_flag,
      rank as old_rank
    from public.ladder
    where placed
  ),
  ordered as (
    -- 동률 sort_key 에서는 **활성(inactive_flag=0)을 앞**에 둔다 → 비활성이 활성을
    -- 완전히 지나쳐 침하하도록(그러지 않으면 경계 동률에서 비활성이 활성을 못 넘어
    -- 하락폭이 줄어든다). 그다음 old_rank asc 로 클래스 내 상대 순서 보존.
    select profile_id,
           row_number() over (order by sort_key asc, inactive_flag asc, old_rank asc) as new_rank
    from scored
  )
  update public.ladder l
    set rank = o.new_rank
    from ordered o
    where l.profile_id = o.profile_id and l.rank <> o.new_rank;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.sink_inactive() from public;
revoke all on function public.sink_inactive() from anon, authenticated;
grant execute on function public.sink_inactive() to service_role;

-- -----------------------------------------------------------------------------
-- 5. ladder.defense_id 백필 결정 (이월 항목 — 계약 6)
-- -----------------------------------------------------------------------------
-- 결정: **실유저 ladder.defense_id 의 소급 백필 트리거·잡은 두지 않는다.** 근거:
--   (a) NPC 는 시드에서 이미 defense_id 를 채웠다(_npc_seed). 이는 안정 앵커 겸 M5 대비.
--   (b) apply_placement_result 는 신규 유저 삽입 시 활성 방어가 있으면 defense_id 를
--       채운다(있을 때만). 배치 시점에 방어가 없던 유저는 null 로 남는다.
--   (c) 그럼에도 정합성에 문제가 없다 — 매치메이킹(get_invasion_targets/get_placement_
--       targets)은 defenses.active 직접 조인을 쓰고, verify-invasion EF 는 invasions.
--       defense_id 스냅샷을 쓴다. 즉 **ladder.defense_id 를 읽는 경로가 없다.**
--   (d) 애초 이 컬럼이 겨냥한 "DELETE→재생성 우회 완화"는 위 §1(클라 DELETE 봉인)로
--       근본 차단됐으므로, defense_id 앵커에 그 방어를 의존할 필요가 사라졌다.
-- 따라서 백필은 NPC + 배치 시점 스냅샷(있을 때)까지만 하고, 상시 동기화 트리거는 YAGNI 로
-- 두지 않는다. M5 에서 ladder.defense_id 를 실제로 읽는 기능이 생기면 그때 백필 배선을
-- 재검토한다(이 주석이 그 착수 조건 기록).
