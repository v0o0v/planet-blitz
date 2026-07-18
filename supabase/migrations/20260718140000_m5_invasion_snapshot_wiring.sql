-- =============================================================================
-- Planet Blitz M5 — 침공 권위 스냅샷 배선 강화 (begin_invasion 자격 검증 + 1회성 강제)
-- =============================================================================
-- PR#43(20260718130000)이 스냅샷 스키마(invasion_snapshots·invasions.snapshot_id·
-- begin_invasion)를 도입했다. 그 마이그레이션은 거동 무변(snapshot_id 미설정 → EF 라이브
-- 경로)이었고, 리드 리뷰가 두 가지 보강을 남겼다:
--
--   ① (리뷰 MED) begin_invasion 대상 자격 검증 — 원본 begin_invasion 은 auth.uid()·자기
--      침공만 게이트하고, **임의 defense_id 의 방어 배치에 라이브 수호 권위를 주입해
--      스냅샷으로 돌려준다**. 즉 매치메이킹(get_invasion_targets)이 제안하지 않는 상위
--      랭커·비활성·미배치 방어의 라이브 수호 구성(성능%·계보 보너스·스냅샷)을 공격자가
--      begin_invasion 으로 스카우팅할 수 있다(RLS 로 직접 guardians 를 못 읽는 것을 우회).
--      → get_invasion_targets 후보 자격(대상 방어 active, 방어자 순위 배치(placed) + 공격자
--        하위 랭크 rank < my_rank)을 begin_invasion 진입부에서 동일하게 강제해 차단한다.
--
--   ② (리뷰 CRITICAL ④ 1회성) 스냅샷 재사용 차단 — 공격자가 유리한(약한) 스냅샷 1개를
--      여러 침공에 재사용하지 못하도록 invasions.snapshot_id 에 **부분 유니크 인덱스**를
--      건다. insert 시점에 원자적으로 강제되므로 TOCTOU 없이 가장 견고하다(EF 의 재사용
--      검사는 방어적 2차선일 뿐 — 유니크 인덱스가 1차 강제). begin_invasion 은 호출마다 새
--      스냅샷을 발급하므로 정직한 런은 매번 자기 snapshot_id 를 갖는다.
--
-- ★봉인 가드 무수정 계약(PR#29/#35 교훈): 이 마이그레이션은 begin_invasion(PR#43 이 만든
--   함수) **자신만** create or replace 하고, guard_invasions_client_insert/update 등 기존
--   봉인 트리거 함수는 절대 재정의하지 않는다. begin_invasion 재정의는 원본 본문(auth.uid()
--   게이트·self-invasion raise·inject_guardian_authority T0 고정·search_path=''·revoke/grant)을
--   전부 보존한 위에 자격 검증 블록만 추가한다.
--
-- 재실행 안전: create or replace function, create unique index if not exists(부분),
--   search_path='' 고정, 권한 재적용. 원격 적용은 리드 몫(리포 마이그레이션만 커밋).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. begin_invasion — 자격 검증 추가(원본 본문 전부 보존 + 진입부 자격 게이트)
-- -----------------------------------------------------------------------------
create or replace function public.begin_invasion(p_defense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me         uuid := auth.uid();
  v_def        public.defenses%rowtype;
  v_layout     jsonb;
  v_snap_id    uuid;
  v_my_rank    integer;
  v_def_rank   integer;
  v_def_placed boolean;
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

  -- (리뷰 MED) 대상 자격 검증 — get_invasion_targets 후보 규칙과 정합. 매치메이킹 범위 밖
  -- (비활성·미배치·상위 랭커) defense 의 라이브 수호 구성 스카우팅을 차단한다. 자격 미달은
  -- 클라이언트가 폴백(라이브 경로)하도록 raise 로 알린다. 배치전/복수전 등 이 규칙 밖 대상은
  -- 스냅샷을 발급하지 않고 현행 라이브 경로로 침공한다(하위호환 — 회귀 0).
  if not v_def.active then
    raise exception 'begin_invasion: 비활성 방어는 침공 대상이 아님 (%)', p_defense_id
      using errcode = 'check_violation';
  end if;
  select l.rank into v_my_rank from public.ladder l where l.profile_id = v_me;
  if v_my_rank is null then
    raise exception 'begin_invasion: 공격자가 순위에 없음(배치전 미완료)'
      using errcode = 'check_violation';
  end if;
  select l.rank, l.placed into v_def_rank, v_def_placed
    from public.ladder l where l.profile_id = v_def.profile_id;
  if v_def_rank is null or v_def_placed is not true then
    raise exception 'begin_invasion: 대상이 순위에 배치되지 않음'
      using errcode = 'check_violation';
  end if;
  if v_def_rank >= v_my_rank then
    raise exception 'begin_invasion: 매치메이킹 범위 밖(상위/동급 랭크) 대상은 침공 불가'
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

-- -----------------------------------------------------------------------------
-- 2. invasions.snapshot_id 부분 유니크 인덱스 — 스냅샷 1회성 강제(리뷰 CRITICAL ④)
-- -----------------------------------------------------------------------------
-- 한 스냅샷은 최대 하나의 invasions 행만 참조할 수 있다. 공격자가 유리한 스냅샷 1개를 여러
-- 침공(pending/확정 무관)에 동봉하려 하면 두 번째 insert 가 유니크 위반으로 원자 실패한다 →
-- EF 재사용 검사(방어적 2차선)에 앞서 DB 가 1차로 강제. snapshot_id 가 null 인 행(현행 라이브
-- 경로)은 인덱스 대상에서 제외(부분 인덱스)하므로 기존 침공에 영향 없다.
create unique index if not exists invasions_snapshot_unique
  on public.invasions (snapshot_id)
  where snapshot_id is not null;
