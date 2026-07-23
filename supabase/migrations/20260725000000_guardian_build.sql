-- =============================================================================
-- Planet Blitz — 예비역 소집·장비 잠김: guardians.build 실물 빌드 저장 (ADR-0024, Wave 1)
-- =============================================================================
-- 담는 것(순수 additive):
--   1. guardians.build jsonb 컬럼(nullable) — 퇴역 순간 고정된 실물 빌드(타입·장착 장비·스킬
--      투자). snapshot(data)의 **형제** — 방어 배치·해시 경로(data/snapshot)는 전혀 건드리지 않는다.
--   2. retire_ship 에 p_build jsonb DEFAULT NULL 파라미터 추가 + build 컬럼 저장. 나머지 로직
--      (쿨다운·combat_score 클램프·계보 지급)은 20260718100000_m5_guardian_lineage 원본과 바이트 동일.
--
-- ⚠️ 원격 적용은 Wave 2 서버 레인으로 이월한다(수호 게이트웨이 배선과 함께). Wave 1 의 라이브
--    경로는 로컬 세이브(normalizeGuardianRecords)이고, 이 파일은 계약 정합을 위해 **작성만** 한다.
-- ⚠️ 미변경(불가침): guardians.data(snapshot)·inject_guardian_authority·방어/EF verify-invasion
--    경로. build 는 소집(공격측 loadout 파생)·소멸(장비 stash 반환)에만 쓰이는 additive 필드다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. guardians.build 컬럼(nullable) — 구 수호기는 NULL(=소집 비활성).
-- -----------------------------------------------------------------------------
alter table public.guardians
  add column if not exists build jsonb;

-- -----------------------------------------------------------------------------
-- 2. retire_ship — p_build 추가 저장. 원본(20260718100000)에서 파라미터 1개 + INSERT 컬럼 1개만
--    더한 것 외 로직 동일. DEFAULT NULL 오버로드가 기존 3-인자 시그니처와 공존하면 PostgREST 가
--    인자 집합 해소 시 모호해질 수 있으므로, 원본 3-인자 함수를 먼저 제거해 4-인자 하나만 남긴다
--    (게이트웨이 retireShip 은 항상 p_build 를 함께 보낸다 — null 이어도 명시 전달).
-- -----------------------------------------------------------------------------
drop function if exists public.retire_ship(integer, integer, jsonb);

create or replace function public.retire_ship(
  p_preset integer,
  p_combat_score integer,
  p_snapshot jsonb,
  p_build jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_gid      uuid;
  v_grant    constant integer := 50;  -- RETIRE_LINEAGE_GRANT (data/lineage.ts)
  v_max_score constant integer := 5000;  -- p_combat_score 서버측 상한(HIGH-3 옵션③)
  v_cooldown constant interval := interval '30 seconds';  -- 최소 재퇴역 간격(HIGH-3 옵션②)
  v_score    integer;
  v_preset   integer := case when coalesce(p_preset, 0) between 0 and 1 then p_preset else 0 end;
  v_last     timestamptz;
begin
  if v_me is null then
    raise exception 'retire_ship: 로그인 필요';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'retire_ship: 스냅샷 필요';
  end if;
  v_score := least(v_max_score, greatest(1, coalesce(p_combat_score, 1)));

  -- 행 잠금 + 쿨다운 확인을 한 트랜잭션에서(레이스로 동시 두 호출이 쿨다운을 동시 통과 못함).
  select lineage_last_retired_at into v_last
    from public.profiles where id = v_me
    for update;
  if not found then
    raise exception 'retire_ship: 프로필 없음';
  end if;
  if v_last is not null and now() < v_last + v_cooldown then
    return jsonb_build_object(
      'retired', false, 'note', 'cooldown',
      'retry_after', extract(epoch from (v_last + v_cooldown - now()))
    );
  end if;

  insert into public.guardians (profile_id, data, performance, retired, combat_score, preset, build)
    values (v_me, p_snapshot, 100.00, false, v_score, v_preset, p_build)
    returning id into v_gid;

  update public.profiles
    set lineage_points = lineage_points + v_grant,
        lineage_last_retired_at = now()
    where id = v_me;

  return jsonb_build_object(
    'retired', true, 'guardian_id', v_gid, 'granted', v_grant, 'combat_score', v_score, 'preset', v_preset
  );
end;
$$;

revoke all on function public.retire_ship(integer, integer, jsonb, jsonb) from public;
revoke all on function public.retire_ship(integer, integer, jsonb, jsonb) from anon;
grant execute on function public.retire_ship(integer, integer, jsonb, jsonb) to authenticated, service_role;
