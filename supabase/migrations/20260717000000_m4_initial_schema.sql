-- =============================================================================
-- Planet Blitz M4 — 초기 스키마 (Phase B2, 계획 §4 · AC7)
-- =============================================================================
-- 근거: ADR-0002(Supabase 백엔드) · ADR-0004(영구 래더) · ADR-0005(결정론
-- 리플레이 검증) · ADR-0006(풍화) · ADR-0007(수호 기체 수명형).
--
-- 설계 원칙(계획 §2):
--   원칙2 서버 권위 — 순위 스왑·침공 결과 확정·복제 약탈은 Edge Function
--     (service_role)/pg_cron 만 수행. 클라이언트 제출은 "증거"일 뿐 결과가 아님.
--   RLS 로 클라이언트의 직접 순위/결과 쓰기를 원천 차단한다. service_role 키는
--     RLS 를 우회(BYPASSRLS)하므로 서버 로직은 정책에 막히지 않는다.
--
-- 역할(Supabase): anon(비로그인) · authenticated(익명 포함 로그인 유저) ·
--   service_role(Edge Function/서버). 익명 Auth 유저도 authenticated JWT 를 받으며
--   auth.uid() 로 식별된다.
--
-- 적용 절차·주의는 같은 폴더의 README.md 참조. pg_cron(풍화·침하)은 Phase E 로
-- 미루므로 여기서는 maintenance/performance 필드만 둔다(값 감쇠 로직 없음).
-- =============================================================================

-- 재실행 안전성(코드리뷰 MED-3): 이 마이그레이션의 모든 create 문은 부분 실패 후
-- 재적용해도 에러 없이 수렴하도록 if-not-exists/drop-if-exists/or-replace 패턴을
-- 쓴다. README 의 "재실행 안전" 서술과 실물을 일치시킨다.

-- gen_random_uuid() 용(대개 기본 활성이지만 명시).
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 공통: updated_at 자동 갱신 트리거 함수
-- -----------------------------------------------------------------------------
-- search_path = '' 고정(코드리뷰 LOW-4, Supabase linter "function search path mutable"
-- 경고 방지) — 모든 참조를 스키마 한정(public./pg_catalog 내장 함수는 search_path 와
-- 무관하게 항상 탐색된다)으로 유지해 안전.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 클라이언트(authenticated/anon)가 서버 권위 필드를 조작하지 못하게 막는 판정용.
-- service_role/postgres 등 서버 역할이면 true → 가드를 건너뛴다.
create or replace function public.is_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('service_role', 'supabase_admin', 'postgres');
$$;

-- =============================================================================
-- 1. profiles — Auth uid 연계 플레이어 메타(세이브 JSON + saveVersion)
-- =============================================================================
-- 로컬 Profile(src/save/profile.ts) 전체를 save(jsonb)로 이관 보관한다. saveVersion
-- 은 스키마 마이그레이션 키(ADR-0002). flagged 는 PvE 샘플링 적발 플래그(Phase F)로
-- 서버만 세팅한다.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  save          jsonb       not null default '{}'::jsonb,
  save_version  integer     not null default 0,
  display_name  text,
  -- 치트 적발 플래그(ADR-0005 · GDD §11). 클라이언트가 스스로 내릴 수 없다.
  flagged       boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 본인 프로필만 읽기. 타인 프로필 메타(세이브 전체)는 노출하지 않는다.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- 최초 이관 시 본인 행 삽입만 허용(id 를 자기 uid 로 강제).
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- 본인 행만 갱신(세이브 업로드). flagged 조작은 아래 트리거가 별도 차단.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 서버 권위: 클라이언트가 flagged 를 스스로 바꾸지 못하게 고정(서버만 변경 가능).
create or replace function public.guard_profiles_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.flagged := old.flagged;
  end if;
  return new;
end;
$$;

create or replace trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profiles_client_write();

create or replace trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 2. ships — 기체 레코드(래더/정찰 표시용 서버 미러)
-- =============================================================================
-- 정본은 profiles.save 안에도 있으나, 순위표·정찰에서 SQL 조회가 필요하므로 정규화
-- 미러를 둔다.
create table if not exists public.ships (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  slot        integer     not null check (slot >= 0),
  name        text        not null,
  level       integer     not null default 1 check (level >= 1),
  xp          integer     not null default 0 check (xp >= 0),
  equipped    jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  unique (profile_id, slot)
);

create index if not exists ships_profile_idx on public.ships (profile_id);

alter table public.ships enable row level security;

-- 본인 기체는 읽기·쓰기 모두 가능.
drop policy if exists ships_rw_own on public.ships;
create policy ships_rw_own
  on public.ships for all
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- 정찰: 타인 기체는 읽기만(방어 사령부 정찰 뷰에서 방어자 기체 레벨 표시). 민감
-- 필드가 늘면 뷰로 좁힌다.
-- Phase D 착수 조건(코드리뷰 MED-5): using(true) 는 M4 착수 단계의 임시 전면 공개다.
-- Phase D(매치메이킹 RPC)에서 "상위 3명+30위 랜덤 제안 대상"으로만 조회를 좁히는
-- Edge Function RPC/전용 뷰로 교체 예정 — 그때 이 정책은 폐기(또는 select 자체를
-- 제거)하고 RPC 경유로 강제한다. equipped(장착 아이템) 노출도 그 시점에 필드 단위로
-- 재검토(정찰에 어디까지 보여줄지 밸런싱 이슈, 계획 §1-5).
drop policy if exists ships_select_others on public.ships;
create policy ships_select_others
  on public.ships for select
  to authenticated
  using (true);

create or replace trigger trg_ships_updated_at
  before update on public.ships
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 3. items — 인벤/보관함 아이템 서버 미러(사적 데이터)
-- =============================================================================
-- item_id 는 drop-seed 파생 문자열이라 플레이어 간 충돌 가능 → 대리키 + (profile,
-- item) 유니크. 복제 약탈(ADR-0003)은 service_role 이 방어자 items 를 읽어 공격자에게
-- 복제 지급하므로 클라이언트 조회는 본인 것만으로 충분하다.
create table if not exists public.items (
  row_id      uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  item_id     text        not null,
  location    text        not null check (location in ('inventory', 'stash', 'equipped')),
  data        jsonb       not null,
  updated_at  timestamptz not null default now(),
  unique (profile_id, item_id)
);

create index if not exists items_profile_idx on public.items (profile_id);

alter table public.items enable row level security;

-- 본인 아이템만 읽기·쓰기(정찰도 아이템 목록은 노출 안 함).
drop policy if exists items_rw_own on public.items;
create policy items_rw_own
  on public.items for all
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create or replace trigger trg_items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 4. ladder — 영구 순위표(ADR-0004)
-- =============================================================================
-- rank 1 = 최상위. 순위 스왑·삽입·침하는 오직 service_role/pg_cron 이 트랜잭션으로
-- 수행한다(원칙2). 클라이언트는 읽기만 — write 정책을 만들지 않아 RLS 기본 거부.
-- defense_id 는 FK 를 여기서 걸지 않는다(코드리뷰 CRITICAL-1) — `defenses` 테이블은
-- 아래 5번 섹션에서야 생성되므로, 인라인 references 를 쓰면 이 create table 문
-- 시점에 `relation "public.defenses" does not exist` 로 적용이 즉시 실패한다.
-- FK 는 defenses 생성 이후 지연 `alter table ... add constraint ladder_defense_fk`
-- (아래, defenses 섹션 끝)에서만 건다.
create table if not exists public.ladder (
  profile_id  uuid        primary key references public.profiles(id) on delete cascade,
  rank        integer     not null unique check (rank >= 1),
  -- 이 순위에서 방어 중인 기지. 배치 완료 전 null. FK 는 defenses 섹션에서 지연 연결.
  defense_id  uuid,
  wins        integer     not null default 0 check (wins >= 0),
  losses      integer     not null default 0 check (losses >= 0),
  -- 비활성 침하(Phase E)용 마지막 활동 시각.
  last_active timestamptz not null default now(),
  -- 배치전 5회 완료 후 순위 삽입되었는지(AC4).
  placed      boolean     not null default false,
  updated_at  timestamptz not null default now()
);

-- 순위 조회·정렬 인덱스(관제탑 상위 랭커 제안 등).
create index if not exists ladder_rank_idx on public.ladder (rank);
create index if not exists ladder_last_active_idx on public.ladder (last_active);

alter table public.ladder enable row level security;

-- 전체 순위표는 공개 읽기. 쓰기 정책 없음 → 클라이언트 직접 순위 조작 불가(원칙2).
drop policy if exists ladder_select_all on public.ladder;
create policy ladder_select_all
  on public.ladder for select
  to authenticated
  using (true);

create or replace trigger trg_ladder_updated_at
  before update on public.ladder
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 5. defenses — 방어 배치(DefenseLayout JSON) + 정비도(풍화, ADR-0006)
-- =============================================================================
-- layout 은 DefenseLayout 계약(src/sim/defense.ts — Phase C 산출) blob: 포탑 6종·
-- 장애물·코어·수호 슬롯(M5 자리). 침공 런의 정적 스폰 입력(갈림길③A)이 된다.
-- maintenance 는 풍화 대상(주 -5%p, 0%→포탑 50%). 자원·순위는 풍화 무관(ADR-0006).
create table if not exists public.defenses (
  id            uuid          primary key default gen_random_uuid(),
  profile_id    uuid          not null references public.profiles(id) on delete cascade,
  layout        jsonb         not null,
  -- 배치 포인트 예산 사용량(서버도 재검증). 예산 초과 배치 거부용.
  budget_spent  integer       not null default 0 check (budget_spent >= 0),
  -- 정비도 %(0~100). 풍화가 낮추고, 크레딧 정비로 회복(ADR-0006).
  maintenance   numeric(5, 2) not null default 100.00 check (maintenance >= 0 and maintenance <= 100),
  -- 현재 배치된(방어 중인) 기지 여부.
  active        boolean       not null default true,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

create index if not exists defenses_profile_idx on public.defenses (profile_id);
-- 프로필당 활성 방어는 하나.
create unique index if not exists defenses_one_active_idx
  on public.defenses (profile_id) where active;

alter table public.defenses enable row level security;

-- 본인 방어는 읽기·쓰기(에디터 저장·정비 회복은 본인 몫). maintenance/budget_spent 는
-- 아래 trg_defenses_guard 가 클라이언트 update 에서 강제로 이전 값 유지시킨다.
drop policy if exists defenses_rw_own on public.defenses;
create policy defenses_rw_own
  on public.defenses for all
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- 정찰: 타인 방어 배치는 읽기만(침공하려면 상대 기지 layout 을 봐야 함, 계획 §1-5).
-- Phase D 착수 조건(코드리뷰 MED-5): using(true) 는 M4 착수 단계의 임시 전면 공개다.
-- Phase D(매치메이킹 RPC)에서 "상위 3명+30위 랜덤 제안 대상"으로만 조회를 좁히는
-- Edge Function RPC/전용 뷰로 교체 예정 — 그때 이 정책은 폐기(또는 select 자체를
-- 제거)하고 RPC 경유로 강제한다.
drop policy if exists defenses_select_others on public.defenses;
create policy defenses_select_others
  on public.defenses for select
  to authenticated
  using (true);

-- 서버 권위(코드리뷰 HIGH-2): defenses_rw_own 이 전 컬럼 update 를 허용하므로, 가드가
-- 없으면 클라이언트가 maintenance:=100(풍화 자가회복으로 무력화, ADR-0006 위반) 이나
-- budget_spent:=0(배치 포인트 예산 우회)을 직접 제출할 수 있다. flagged(profiles)와
-- 동일 패턴으로 두 필드를 서버 전용으로 고정한다 — 정비 회복·예산 검증은 Phase E/C
-- 의 service_role 트랜잭션(정비 시 크레딧 차감과 함께 처리)만 갱신할 수 있다.
create or replace function public.guard_defenses_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.maintenance := old.maintenance;
    new.budget_spent := old.budget_spent;
  end if;
  return new;
end;
$$;

create or replace trigger trg_defenses_guard
  before update on public.defenses
  for each row execute function public.guard_defenses_client_write();

create or replace trigger trg_defenses_updated_at
  before update on public.defenses
  for each row execute function public.set_updated_at();

-- 래더의 defense_id FK 를 늦게 건다(defenses 가 뒤에 정의되므로, CRITICAL-1 수정).
-- ADD CONSTRAINT 는 IF NOT EXISTS 를 지원하지 않아 DROP IF EXISTS 후 재생성으로
-- 재실행 안전화한다.
alter table public.ladder drop constraint if exists ladder_defense_fk;
alter table public.ladder
  add constraint ladder_defense_fk
  foreign key (defense_id) references public.defenses(id) on delete set null;

-- =============================================================================
-- 6. invasions — 침공 리플레이 blob + 결과 + 검증 상태(ADR-0005)
-- =============================================================================
-- replay = [시드+입력+로드아웃+방어배치] 재현 입력. client_result = 클라이언트가 주장한
-- 승패·해시(증거). 서버 전수 재실행 결과가 verified_* 에 채워진다. 클라이언트는 pending
-- 증거만 제출(insert)할 수 있고, 결과 확정(update)은 service_role 만(원칙2).
create table if not exists public.invasions (
  id               uuid        primary key default gen_random_uuid(),
  attacker_id      uuid        not null references public.profiles(id) on delete cascade,
  defender_id      uuid        not null references public.profiles(id) on delete cascade,
  -- 침공 시점 방어 기지 스냅샷(방어가 이후 바뀌어도 재현 가능).
  defense_id       uuid        references public.defenses(id) on delete set null,
  replay           jsonb       not null,
  client_result    jsonb       not null,
  verified_status  text        not null default 'pending'
                     check (verified_status in ('pending', 'verified', 'rejected')),
  -- 서버 재실행 결과(확정 전 null).
  verified_result  jsonb,
  -- 최종 판정 승자(공격자 승 여부). 확정 전 null.
  attacker_won     boolean,
  created_at       timestamptz not null default now(),
  verified_at      timestamptz
);

-- 대상(방어자)·공격자·시각·검증상태 조회 인덱스.
create index if not exists invasions_defender_idx on public.invasions (defender_id, created_at desc);
create index if not exists invasions_attacker_idx on public.invasions (attacker_id, created_at desc);
create index if not exists invasions_status_idx on public.invasions (verified_status);

alter table public.invasions enable row level security;

-- 공격자는 자기 침공 리플레이를 pending 증거로 제출(insert)만 할 수 있다.
drop policy if exists invasions_insert_attacker on public.invasions;
create policy invasions_insert_attacker
  on public.invasions for insert
  to authenticated
  with check (auth.uid() = attacker_id);

-- 관전/이력: 자기가 공격했거나 방어당한 침공만 읽기(리플레이 관전 F3).
drop policy if exists invasions_select_participant on public.invasions;
create policy invasions_select_participant
  on public.invasions for select
  to authenticated
  using (auth.uid() = attacker_id or auth.uid() = defender_id);

-- update/delete 정책 없음 → 클라이언트는 결과를 못 바꾼다(원칙2). 확정은 service_role.

-- 서버 권위 가드: 클라이언트 insert 는 항상 pending 으로, 결과 필드는 비운 채 강제.
-- 조작된 verified_status='verified' + attacker_won=true 제출을 원천 차단.
create or replace function public.guard_invasions_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.verified_status := 'pending';
    new.verified_result := null;
    new.attacker_won := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

create or replace trigger trg_invasions_guard_insert
  before insert on public.invasions
  for each row execute function public.guard_invasions_client_insert();

-- =============================================================================
-- 7. guardians — 수호 기체(M5 자리, ADR-0007) 최소 스키마
-- =============================================================================
-- M5 계보·수명형 수호 기체. 여기서는 방어 배치 수호 슬롯이 참조할 최소 스키마만 둔다.
-- performance 는 풍화 대상이나 회복 불가(수명형, ADR-0007), 바닥 50% 정지는 Phase E cron.
create table if not exists public.guardians (
  id           uuid          primary key default gen_random_uuid(),
  profile_id   uuid          not null references public.profiles(id) on delete cascade,
  data         jsonb         not null default '{}'::jsonb,
  performance  numeric(5, 2) not null default 100.00 check (performance >= 0 and performance <= 100),
  retired      boolean       not null default false,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

create index if not exists guardians_profile_idx on public.guardians (profile_id);

alter table public.guardians enable row level security;

-- 본인 수호 기체 읽기·쓰기.
drop policy if exists guardians_rw_own on public.guardians;
create policy guardians_rw_own
  on public.guardians for all
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- 정찰: 방어 배치의 수호 슬롯 정보를 위해 타인 것 읽기만 허용.
-- Phase D 착수 조건(코드리뷰 MED-5): using(true) 는 M4 착수 단계의 임시 전면 공개다.
-- M5 에서 guardians 가 활성화되며 계보(ADR-0007) 요구가 커지면, 정찰 노출 범위를
-- Phase D 매치메이킹 RPC/뷰로 다시 좁힐지 재검토한다.
drop policy if exists guardians_select_others on public.guardians;
create policy guardians_select_others
  on public.guardians for select
  to authenticated
  using (true);

create or replace trigger trg_guardians_updated_at
  before update on public.guardians
  for each row execute function public.set_updated_at();
