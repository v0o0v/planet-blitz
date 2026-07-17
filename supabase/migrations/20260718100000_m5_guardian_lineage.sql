-- =============================================================================
-- Planet Blitz M5 — Phase A · 퇴역·수호 기체·계보 (계획 §4 Phase A, ADR-0007)
-- =============================================================================
-- 근거: ADR-0007(수호 기체 생애주기·계보), ADR-0006(풍화), 스펙 deep-interview-guardian-
--   lifecycle.md, 계획 §4 Phase A(A2 퇴역·A3 소멸·A5 계보).
--
-- 담는 것:
--   1. guardians 확장 — combat_score·preset 컬럼 + 서버 권위 가드(performance/combat_score
--      를 클라이언트가 직접 못 쓴다 — 풍화·회수가치 위조 차단).
--   2. profiles 계보 컬럼 — lineage_points(미사용 포인트)·lineage_ship_level·
--      lineage_guardian_level + 서버 권위 가드(클라이언트 직접 쓰기 금지 — 순환 재화 경제 보호).
--   3. retire_ship(p_preset, p_combat_score, p_snapshot) — 퇴역 1사이클 서버 트랜잭션:
--      수호 기체 생성(스냅샷+전투력, performance=100) + 계보 기본 지급(+50pt). (ADR-0007 R8)
--   4. dismiss_guardian(p_guardian_id) — 상시 소멸: 전투력 × 남은 성능 → 계보 포인트 회수,
--      수호 기체 retired=true 로 표시(자동 소멸 없음, 유저 행동만 — ADR-0007 R3/R5).
--   5. invest_lineage(p_branch) — 계보 1레벨 투자(포인트 차감, 리스펙 없음 — ADR-0007 R2/R4).
--
-- 서버 권위 원칙(ADR-0005 원칙2): 수호 performance(풍화 축)·계보 포인트/레벨은 서버만 쓴다.
--   ⚠️ 신뢰 경계(문서화된 한계): p_combat_score·p_snapshot 는 클라이언트 빌드 파생값이라
--   클라이언트가 주장한다(items/save 가 이 게임에서 클라 정본인 것과 동일 신뢰 경계 —
--   verifyInvasionCore.ts 헤더의 "공격자 로드아웃 미대조" 한계와 같은 축). PvP 결정에 직결되는
--   **풍화(performance)** 축만 서버 권위로 봉인한다(방치 기지 위조 차단 — 정비도 봉인과 대칭).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. guardians 확장 + 서버 권위 가드
-- -----------------------------------------------------------------------------
alter table public.guardians
  add column if not exists combat_score integer not null default 0 check (combat_score >= 0);
alter table public.guardians
  add column if not exists preset smallint not null default 0 check (preset >= 0 and preset <= 1);

-- 서버 권위: 클라이언트 update 에서 performance(풍화 축)·combat_score 를 이전 값으로 고정한다
-- (defenses guard_defenses_client_write 와 동일 패턴). 풍화(weather_guardians)·소멸
-- (dismiss_guardian)은 SECURITY DEFINER 라 is_service_role()=true → 가드 우회로 정당 갱신.
-- retired 는 dismiss_guardian(서버)만 세우도록 여기서도 고정(클라 임의 소멸/부활 차단).
create or replace function public.guard_guardians_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.performance := old.performance;
    new.combat_score := old.combat_score;
    new.retired := old.retired;
  end if;
  return new;
end;
$$;

create or replace trigger trg_guardians_guard
  before update on public.guardians
  for each row execute function public.guard_guardians_client_write();

-- 클라이언트 직접 INSERT 도 막는다(수호 기체 생성은 retire_ship RPC 만) — RLS 정책을 분해해
-- INSERT 정책을 제거한다(기존 guardians_rw_own FOR ALL 대체). service_role 는 BYPASSRLS.
drop policy if exists guardians_rw_own on public.guardians;

drop policy if exists guardians_select_own on public.guardians;
create policy guardians_select_own
  on public.guardians for select
  to authenticated
  using (auth.uid() = profile_id);

drop policy if exists guardians_update_own on public.guardians;
create policy guardians_update_own
  on public.guardians for update
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
-- INSERT/DELETE 정책 없음 → 클라이언트 생성·삭제 거부(생성=retire_ship, 소멸=dismiss_guardian).

-- -----------------------------------------------------------------------------
-- 2. profiles 계보 컬럼 + 서버 권위 가드
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists lineage_points integer not null default 0 check (lineage_points >= 0);
alter table public.profiles
  add column if not exists lineage_ship_level integer not null default 0 check (lineage_ship_level >= 0);
alter table public.profiles
  add column if not exists lineage_guardian_level integer not null default 0 check (lineage_guardian_level >= 0);

-- 서버 권위: flagged 가드(guard_profiles_client_write)에 계보 3컬럼을 추가로 고정한다.
-- 계보 포인트·레벨은 순환 재화(리스펙 없음)라 클라 직접 쓰기를 열면 경제가 무너진다
-- (retire_ship/dismiss_guardian/invest_lineage RPC 만 갱신). create or replace 로 기존 함수를
-- 재정의하되 **기존 flagged 가드 블록을 반드시 유지**한다(PR#29 회귀 교훈).
create or replace function public.guard_profiles_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.flagged := old.flagged;
    new.lineage_points := old.lineage_points;
    new.lineage_ship_level := old.lineage_ship_level;
    new.lineage_guardian_level := old.lineage_guardian_level;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. retire_ship — 퇴역 1사이클(수호 생성 + 계보 기본 지급). ADR-0007 R8.
-- -----------------------------------------------------------------------------
-- p_preset: 0 타이탄형 / 1 인터셉터형(OQ-M5-3 선택제). p_combat_score: 전투력 점수(클라 빌드
--   파생). p_snapshot: 복사 스냅샷 jsonb(data/guardian.ts GuardianSnapshot). 서버는 수호 기체를
--   performance=100 으로 생성하고 계보 포인트 +RETIRE_GRANT(=50)를 지급한다. 원자 트랜잭션.
-- 장비 원본 자동 창고 반환(ADR-0007)은 클라 save(items) 정본에서 처리 — 서버는 미러라 여기서
--   강제하지 않는다(items 미러 동기화는 profileSync 경로).
create or replace function public.retire_ship(
  p_preset integer,
  p_combat_score integer,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_gid   uuid;
  v_grant constant integer := 50;  -- RETIRE_LINEAGE_GRANT (data/lineage.ts)
  v_score integer := greatest(1, coalesce(p_combat_score, 1));
  v_preset integer := case when coalesce(p_preset, 0) between 0 and 1 then p_preset else 0 end;
begin
  if v_me is null then
    raise exception 'retire_ship: 로그인 필요';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'retire_ship: 스냅샷 필요';
  end if;

  insert into public.guardians (profile_id, data, performance, retired, combat_score, preset)
    values (v_me, p_snapshot, 100.00, false, v_score, v_preset)
    returning id into v_gid;

  update public.profiles
    set lineage_points = lineage_points + v_grant
    where id = v_me;

  return jsonb_build_object(
    'retired', true, 'guardian_id', v_gid, 'granted', v_grant, 'combat_score', v_score, 'preset', v_preset
  );
end;
$$;

revoke all on function public.retire_ship(integer, integer, jsonb) from public;
revoke all on function public.retire_ship(integer, integer, jsonb) from anon;
grant execute on function public.retire_ship(integer, integer, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. dismiss_guardian — 상시 소멸(전투력 × 남은 성능 → 계보 포인트). ADR-0007 R3/R5.
-- -----------------------------------------------------------------------------
-- 회수 포인트 = floor(combat_score × performance / 100)(data/guardian.ts dismissPoints 동일
--   정수식). 이미 소멸(retired)이면 no-op. 자동 소멸 없음 — 이 RPC(유저 행동)로만 소멸한다.
create or replace function public.dismiss_guardian(p_guardian_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_g      public.guardians%rowtype;
  v_points integer;
begin
  if v_me is null then
    raise exception 'dismiss_guardian: 로그인 필요';
  end if;

  select * into v_g from public.guardians
    where id = p_guardian_id and profile_id = v_me;
  if not found then
    return jsonb_build_object('dismissed', false, 'note', 'not-found');
  end if;
  if v_g.retired then
    return jsonb_build_object('dismissed', false, 'note', 'already-dismissed');
  end if;

  -- floor(combat_score × performance / 100). performance 는 numeric(5,2) — trunc 로 정수화.
  v_points := floor(v_g.combat_score * v_g.performance / 100.0)::integer;

  update public.guardians set retired = true where id = v_g.id;
  update public.profiles set lineage_points = lineage_points + v_points where id = v_me;

  return jsonb_build_object(
    'dismissed', true, 'guardian_id', v_g.id, 'points', v_points,
    'performance', v_g.performance, 'combat_score', v_g.combat_score
  );
end;
$$;

revoke all on function public.dismiss_guardian(uuid) from public;
revoke all on function public.dismiss_guardian(uuid) from anon;
grant execute on function public.dismiss_guardian(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. invest_lineage — 계보 1레벨 투자(포인트 차감, 리스펙 없음). ADR-0007 R2/R4.
-- -----------------------------------------------------------------------------
-- p_branch: 'ship' | 'guardian'. 비용 = 40 + level×10(data/lineage.ts nextLevelCost 동일).
--   포인트 부족이면 no-op. 성공 시 available 차감 + 해당 레벨 +1. 단조 증가(환불 없음).
create or replace function public.invest_lineage(p_branch text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_pts   integer;
  v_level integer;
  v_cost  integer;
begin
  if v_me is null then
    raise exception 'invest_lineage: 로그인 필요';
  end if;
  if p_branch not in ('ship', 'guardian') then
    raise exception 'invest_lineage: 잘못된 가지 %', p_branch;
  end if;

  select lineage_points,
         case when p_branch = 'ship' then lineage_ship_level else lineage_guardian_level end
    into v_pts, v_level
    from public.profiles where id = v_me
    for update;
  if not found then
    return jsonb_build_object('invested', false, 'note', 'no-profile');
  end if;

  v_cost := 40 + v_level * 10;  -- nextLevelCost(level)
  if v_pts < v_cost then
    return jsonb_build_object('invested', false, 'note', 'insufficient-points', 'cost', v_cost, 'points', v_pts);
  end if;

  if p_branch = 'ship' then
    update public.profiles
      set lineage_points = lineage_points - v_cost,
          lineage_ship_level = lineage_ship_level + 1
      where id = v_me;
  else
    update public.profiles
      set lineage_points = lineage_points - v_cost,
          lineage_guardian_level = lineage_guardian_level + 1
      where id = v_me;
  end if;

  return jsonb_build_object(
    'invested', true, 'branch', p_branch, 'cost', v_cost,
    'level', v_level + 1, 'points', v_pts - v_cost
  );
end;
$$;

revoke all on function public.invest_lineage(text) from public;
revoke all on function public.invest_lineage(text) from anon;
grant execute on function public.invest_lineage(text) to authenticated, service_role;
