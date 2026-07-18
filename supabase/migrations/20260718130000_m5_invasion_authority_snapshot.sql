-- =============================================================================
-- Planet Blitz M5 — 침공 권위 스냅샷 고정 스키마 (dismiss_guardian 완전 원자성 이월)
-- =============================================================================
-- ▮ 배경 — 남은 레이스(B): 스냅샷 대 검증(over-rejection)
--   dismiss_guardian 자체의 이중 회수 레이스(A)는 이미 완전 원자적이다(20260718100000:
--   for update + `update ... and retired=false` + get diagnostics 로 포인트 지급이 실제
--   retired 전이에 원자 결속). 그러나 **교차 RPC 레이스(B)** 가 남아 있었다(20260718110000
--   lines 242-266, README 840-849 이월 기록):
--     · T0: 공격자가 get_invasion_targets 로 방어 배치 + 라이브 수호 권위를 받아 로컬 런 진행.
--     · T1: 제출 후 verify-invasion EF 가 **수호/정비도를 다시 라이브로 재주입**해 대조.
--     · 그 사이 방어자가 dismiss_guardian/retire_ship/정비/풍화로 라이브 값을 바꾸면 EF 의
--       재주입본이 공격자가 실제 실행한 T0 권위와 달라져 → guardiansEqual/해시 불일치 →
--       **정직한 침공이 defense-mismatch 로 오거부**된다(보안 영향은 없음 — 항상 거부 방향,
--       위조 accept 는 불가. 순수 UX·공정성 결함).
--
-- ▮ 해법 — "침공 스냅샷 고정 스키마"
--   T0(공격 개시) 시점에 서버가 권위 실행 config(수호 권위 주입 완료 layout + 정비도)를
--   **불변 스냅샷으로 고정**하고, EF 가 T1 에 라이브를 재조회하는 대신 그 고정본을 대조한다.
--   그러면 T0↔T1 사이 방어자의 dismiss/retire/정비가 이 침공의 검증에 영향을 주지 못한다 →
--   레이스(B) 완전 제거(= dismiss_guardian 이 침공 검증과 완전히 원자적으로 분리된다).
--
--   고정 지점은 T0 의 유일한 서버 접점인 **공격 개시 RPC(begin_invasion)** 다. 기존
--   get_invasion_targets 는 후보 3~4개를 STABLE 조회로 돌려줄 뿐(어느 후보를 칠지 모름)이라
--   고정 granularity 가 맞지 않는다. 공격자가 대상 1개를 정해 begin_invasion 을 호출하면 그
--   순간의 권위를 스냅샷 테이블에 박고 snapshot_id 를 돌려준다.
--
-- ▮ 최소 침습 설계(★기존 봉인 함수 무수정 — 봉인 회귀 위험 0)
--   - 권위 스냅샷을 **별도 테이블 `invasion_snapshots`** 에 담고, invasions 에는 그 참조
--     `snapshot_id` 만 추가한다. 권위값 자체는 invasions 에 실리지 않으므로
--     **guard_invasions_client_insert/update 를 create or replace 할 필요가 없다**
--     (PR#29/#35 에서 2회 발생한 봉인 유실 패턴을 원천 회피).
--   - `invasion_snapshots` 는 정의된 begin_invasion(SECURITY DEFINER, 소유자=postgres →
--     RLS 우회)만 기록한다. 클라이언트 insert 정책이 없어 위조 권위를 직접 심을 수 없다.
--   - 공격자가 남의(약한) 스냅샷을 가리키는 위조는 EF 가 소유권(attacker_id·defense_id 일치)을
--     검증해 무효화하고 라이브 경로로 폴백하므로 이득이 없다(아래 EF 계약 참조).
--
-- ▮ EF·클라이언트 배선(리드 후속 — 이 마이그레이션 범위 밖, 원격 적용 후 별도 PR)
--   applying 만으로는 **거동 무변**이다(snapshot_id 미설정 → EF 는 현행 라이브 재주입 = 회귀 0).
--   완전 원자성은 다음이 배선될 때 발동한다:
--     1. 클라: get_invasion_targets 후 대상 확정 시 begin_invasion(defense_id) 호출 → 반환
--        layout 으로 런 실행 → invasions insert 시 snapshot_id 동봉.
--     2. EF verify-invasion: inv.snapshot_id 존재 & invasion_snapshots 행의
--        attacker_id=inv.attacker_id AND defense_id=inv.defense_id 이면 그 authority.layout
--        (+ authority.maintenance)를 그대로 사용(수호/정비도 라이브 재조회 생략). 아니면 현행
--        라이브 경로 폴백. 신선도(created_at)는 get_invasion_targets 프레시 창(1시간)과 동일
--        기준으로 EF 가 강제 가능(스테일 스냅샷 재사용 방지).
--
-- ▮ is_service_role/caller 게이트: begin_invasion 은 SECURITY DEFINER 이므로 내부 current_user
--   = 소유자라 is_service_role() 은 항상 true 다(README 234-241). 따라서 **호출자 판정에
--   is_service_role() 을 쓰지 않고 auth.uid() 로 직접 게이트**한다. 자기 침공은 정의 내에서
--   명시적으로 raise 한다(가드 트리거가 definer 컨텍스트에서 스킵되므로 자체 차단 필수).
--
-- 재실행 안전: create table/index if not exists, add column if not exists, drop policy if
-- exists → create, create or replace function, search_path='' 고정, 권한 재적용.
-- 원격 적용은 하지 말 것(리포 마이그레이션만; 원격은 리드 승인 후).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. invasion_snapshots — T0 고정 권위 스냅샷(begin_invasion 만 기록)
-- -----------------------------------------------------------------------------
create table if not exists public.invasion_snapshots (
  id            uuid        primary key default gen_random_uuid(),
  attacker_id   uuid        not null references public.profiles(id) on delete cascade,
  defender_id   uuid        not null references public.profiles(id) on delete cascade,
  defense_id    uuid        references public.defenses(id) on delete set null,
  -- 고정 실행 config: { layout: <수호 권위 주입 완료 DefenseLayout>, maintenance: <numeric 0~100> }.
  -- 수호 슬롯의 성능%·계보 보너스·스냅샷을 T0 라이브 값으로 접은 결과라, 방어자가 이후 수호를
  -- dismiss/retire 하거나 정비/풍화로 바꿔도 이 행은 불변이다(레이스 B 차단의 핵심).
  authority     jsonb       not null,
  -- 편의 조회용 정비도(authority->>'maintenance' 와 동일값 미러 — 인덱스·폴백 판정 단순화).
  maintenance   numeric(5, 2),
  created_at    timestamptz not null default now()
);

create index if not exists invasion_snapshots_attacker_idx
  on public.invasion_snapshots (attacker_id, created_at desc);
create index if not exists invasion_snapshots_defense_idx
  on public.invasion_snapshots (defense_id, created_at desc);

alter table public.invasion_snapshots enable row level security;

-- 읽기: 자기가 고정한 스냅샷만(관전·디버그). 쓰기 정책 없음 → 클라 직접 insert/update/delete
-- 불가(권위값 위조 차단). 기록은 SECURITY DEFINER begin_invasion(소유자=postgres) 만 RLS 우회.
drop policy if exists invasion_snapshots_select_own on public.invasion_snapshots;
create policy invasion_snapshots_select_own
  on public.invasion_snapshots for select
  to authenticated
  using (auth.uid() = attacker_id);

-- -----------------------------------------------------------------------------
-- 2. invasions.snapshot_id — 고정 스냅샷 참조(널 = 현행 라이브 경로, 하위호환)
-- -----------------------------------------------------------------------------
alter table public.invasions
  add column if not exists snapshot_id uuid references public.invasion_snapshots(id) on delete set null;

-- EF 가 (attacker_id, defense_id) 로 스냅샷 소유권을 대조하지만, 참조 조회를 인덱스로 받친다.
create index if not exists invasions_snapshot_idx on public.invasions (snapshot_id);

-- ★주의: guard_invasions_client_insert/update 는 **의도적으로 수정하지 않는다**. snapshot_id 는
-- 공격자 본인이 begin_invasion 에서 받은 정당한 참조를 insert 시 동봉하는 값이라 봉인 대상이
-- 아니며(위조 시 EF 소유권 대조로 무효화 → 라이브 폴백, 이득 없음), invasions 에는 어떤
-- 권위값도 실리지 않는다. 가드를 건드리지 않아 기존 봉인(verified_*·attacker_won·caused_swap·
-- is_revenge·attacker_sticker/defender_sticker·self-invasion raise) 전부 무손실 유지된다.

-- -----------------------------------------------------------------------------
-- 3. begin_invasion — T0 공격 개시: 권위 스냅샷 고정 + snapshot_id 발급
-- -----------------------------------------------------------------------------
-- 공격자가 대상(defense_id)을 확정한 순간 호출한다. 서버가 그 순간의 방어 배치에 수호 권위를
-- 주입(inject_guardian_authority)하고 정비도와 함께 불변 스냅샷으로 박은 뒤, 공격자가 실행할
-- 권위 layout + maintenance + snapshot_id 를 돌려준다. 반환 layout 으로 로컬 런을 돌리고, 제출
-- invasions insert 에 snapshot_id 를 동봉하면 EF 가 라이브 재조회 없이 이 고정본으로 대조한다.
create or replace function public.begin_invasion(p_defense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_def     public.defenses%rowtype;
  v_layout  jsonb;
  v_snap_id uuid;
begin
  -- 호출자 게이트는 auth.uid() 로 직접(definer 라 is_service_role() 은 항상 true — 사용 금지).
  if v_me is null then
    raise exception 'begin_invasion: 로그인 필요';
  end if;

  select * into v_def from public.defenses where id = p_defense_id;
  if not found then
    raise exception 'begin_invasion: 방어 기지를 찾을 수 없음 (%)', p_defense_id;
  end if;

  -- 자기 침공 금지(definer 컨텍스트에서 가드 트리거의 self-invasion raise 가 스킵되므로 자체
  -- 차단 필수 — 자기 빈 방어 스냅샷 파밍 경로 봉쇄).
  if v_def.profile_id = v_me then
    raise exception 'self-invasion is not allowed (attacker = defender)'
      using errcode = 'check_violation';
  end if;

  -- T0 권위 고정: 수호 슬롯의 성능%·계보 보너스·스냅샷을 라이브 값으로 접는다(수호 미포함
  -- 방어는 inject_guardian_authority 가 guardians 키를 그대로 두거나 제거 → layout 불변).
  v_layout := public.inject_guardian_authority(v_def.layout, v_def.profile_id);

  insert into public.invasion_snapshots (attacker_id, defender_id, defense_id, authority, maintenance)
  values (
    v_me,
    v_def.profile_id,
    v_def.id,
    jsonb_build_object('layout', v_layout, 'maintenance', v_def.maintenance),
    v_def.maintenance
  )
  returning id into v_snap_id;

  return jsonb_build_object(
    'snapshot_id', v_snap_id,
    'defender_id', v_def.profile_id,
    'defense_id',  v_def.id,
    'layout',      v_layout,
    'maintenance', v_def.maintenance
  );
end;
$$;

revoke all on function public.begin_invasion(uuid) from public;
revoke all on function public.begin_invasion(uuid) from anon;
grant execute on function public.begin_invasion(uuid) to authenticated, service_role;
