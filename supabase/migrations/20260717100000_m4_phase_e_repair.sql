-- =============================================================================
-- Planet Blitz M4 — Phase E · 정비 회복 RPC (계획 §4 Phase E3 · 계약 4 · GDD §9)
-- =============================================================================
-- 근거: ADR-0006(풍화 — 정비도만 감쇠, 크레딧 정비로 회복), GDD §9("정비도 0%면 포탑 50%,
--   정비(크레딧)로 회복 / 정비 = 크레딧 주기 싱크"), 계약 4.
--
-- repair_defense(p_defense_id) — 크레딧 차감 + maintenance=100 을 원자 처리하는 security
-- definer RPC. 클라 정비 UI 는 이 RPC 만 호출한다.
--
-- 크레딧 위치(구조 확인): profiles.save(jsonb) 안의 최상위 'credits' 필드(src/save/
--   profile.ts Profile.credits, 로컬 세이브 정본). 서버가 save->>'credits' 를 읽어 차감한
--   값을 jsonb_set 으로 되쓴다. ⚠️ 클라 세이브 동기화: 정비 직후 클라는 profileSync 로
--   서버 save.credits 를 pull 해 반영해야 한다(서버가 진실). e-client 에 통지 완료.
--
-- 서버 권위: 이 함수는 SECURITY DEFINER 라 소유자(postgres) 권한으로 실행된다 — defenses
--   가드(guard_defenses_client_write)의 is_service_role()(current_user 기반)이 definer
--   안에서 소유자로 평가돼 true → 가드가 우회되어 maintenance 를 직접 100 으로 쓸 수 있다
--   (README "정비 회복은 service_role 트랜잭션만 갱신"과 정합). 호출자 스코프는 auth.uid()
--   로 본인 방어에 한정하므로 남이 내 방어를 정비/과금할 수 없다.
--
-- 비용식(계약 4): cost = ceil((100 - maintenance) * 5) 크레딧. 0%→500, 만점→0(no-op).
--   튜닝 대상(밸런스 §5) — 상수 REPAIR_CREDITS_PER_POINT=5.
-- =============================================================================

create or replace function public.repair_defense(p_defense_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_def      public.defenses%rowtype;
  v_missing  numeric;
  v_cost     integer;
  v_credits  numeric;
begin
  if v_me is null then
    raise exception 'repair_defense: 로그인 필요';
  end if;

  -- 대상 방어: 인자 있으면 그 id(본인 소유 검증), 없으면 본인 활성 방어.
  if p_defense_id is not null then
    select * into v_def from public.defenses
      where id = p_defense_id and profile_id = v_me;
  else
    select * into v_def from public.defenses
      where profile_id = v_me and active limit 1;
  end if;
  if not found then
    return jsonb_build_object('repaired', false, 'note', 'no-defense');
  end if;

  -- 이미 만점이면 no-op(과금 없음).
  if v_def.maintenance >= 100 then
    return jsonb_build_object(
      'repaired', false, 'cost', 0,
      'credits', coalesce((select (save->>'credits')::numeric from public.profiles where id = v_me), 0),
      'maintenance', v_def.maintenance, 'note', 'already-full'
    );
  end if;

  v_missing := 100 - v_def.maintenance;
  v_cost := ceil(v_missing * 5)::integer;  -- REPAIR_CREDITS_PER_POINT = 5

  select coalesce((save->>'credits')::numeric, 0) into v_credits
    from public.profiles where id = v_me;

  if v_credits < v_cost then
    return jsonb_build_object(
      'repaired', false, 'cost', v_cost, 'required', v_cost,
      'credits', v_credits, 'maintenance', v_def.maintenance,
      'note', 'insufficient-credits'
    );
  end if;

  -- 원자 처리: 크레딧 차감(save.credits) + 정비도 100 복구.
  update public.profiles
    set save = jsonb_set(save, '{credits}', to_jsonb(v_credits - v_cost), true)
    where id = v_me;

  update public.defenses set maintenance = 100.00 where id = v_def.id;

  return jsonb_build_object(
    'repaired', true, 'cost', v_cost,
    'credits', v_credits - v_cost, 'maintenance', 100.00, 'note', 'repaired'
  );
end;
$$;

revoke all on function public.repair_defense(uuid) from public;
revoke all on function public.repair_defense(uuid) from anon;
grant execute on function public.repair_defense(uuid) to authenticated, service_role;
