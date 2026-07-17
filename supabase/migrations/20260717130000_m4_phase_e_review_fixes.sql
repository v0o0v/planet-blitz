-- =============================================================================
-- Planet Blitz M4 — Phase E 코드리뷰 MED 2건 반영 (리드 지시, 2026-07-17)
-- =============================================================================
-- 리뷰: APPROVE + 머지 전 MED 2건 수정.
--
--   [MED-1] NPC 침하 침식: NPC 의 ladder.last_active 는 시드(마이그레이션) 시점에 고정
--     되고 갱신 경로가 없다(NPC 는 로그인·침공을 하지 않음). 30일 뒤 전 NPC 가 '비활성'
--     판정돼 sink_inactive 가 매주 -3 씩 쓸어내리면 난이도 분포(하위~중위 rank 배치)가
--     붕괴한다. 해법: 대상 조건에 **not is_npc**(profiles 조인) — NPC 는 '미접속 유저'가
--     아니므로 침하 의미론상 애초에 대상이 아니다(의미상 정확한 해법). NPC 순위는 실유저
--     와의 스왑·배치전 삽입 shift 로만 움직인다.
--
--   [MED-2] repair_defense 크레딧 lost-update: profiles 행을 잠그지 않고
--     select(credits) → update(jsonb_set) 2단계로 차감하므로, 동시 정비(더블클릭·다중 탭)
--     시 두 트랜잭션이 같은 잔액을 읽어 한 번 치 비용만 차감될 수 있다(과소차감).
--     해법(택1 근거): **크레딧 읽기에 `for update`** — 프로필 행을 먼저 잠가 두 번째
--     트랜잭션이 첫 커밋 후의 잔액을 읽게 한다. 조건부 단일 UPDATE(+row_count) 안과
--     동등하게 안전하지만, 이 함수는 잔액을 **읽어서 분기**(부족 시 required 반환·만점
--     no-op)해야 하므로 어차피 select 가 필요하다 — 그 select 에 잠금을 붙이는 쪽이
--     로직 변경 최소·의도 명시적이다. defenses 갱신은 같은 트랜잭션 내 후속 문장이라
--     프로필 잠금이 정비 전체를 직렬화한다(동일 유저 동시 호출 기준).
--
-- 재실행 안전성: create or replace 2건. 권한 재보증 명시.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. [MED-1] sink_inactive — NPC 제외 (profiles.is_npc 조인)
-- -----------------------------------------------------------------------------
-- NPC(p.is_npc)는 scored 에서 항상 활성 취급(inactive 판정 자체를 하지 않음) → sort_key
-- = 기존 rank 그대로, 재랭킹의 기준점으로만 참여한다(전 행 dense re-number 는 유지해야
-- 실유저 침하 시 rank 연속성이 보존된다 — NPC 를 아예 scored 밖으로 빼면 rank 구멍 발생).
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
      l.profile_id,
      l.rank + case when (not p.is_npc) and l.last_active < v_cut then 3 else 0 end as sort_key,
      case when (not p.is_npc) and l.last_active < v_cut then 1 else 0 end as inactive_flag,
      l.rank as old_rank
    from public.ladder l
    join public.profiles p on p.id = l.profile_id
    where l.placed
  ),
  ordered as (
    -- 동률 sort_key 에서는 활성(inactive_flag=0)을 앞에 → 비활성이 완전히 지나쳐 침하.
    -- 그다음 old_rank asc 로 클래스 내 상대 순서 보존.
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
-- 2. [MED-2] repair_defense — profiles 행 잠금(for update)으로 동시 정비 직렬화
-- -----------------------------------------------------------------------------
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

  -- [MED-2] 프로필 행을 먼저 잠근다(크레딧 읽기-차감 사이 동시 정비의 lost-update 차단).
  -- 이후 defenses 조회·갱신은 같은 트랜잭션이라 이 잠금이 정비 전체를 직렬화한다.
  select coalesce((save->>'credits')::numeric, 0) into v_credits
    from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object('repaired', false, 'note', 'no-profile');
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
      'credits', v_credits,
      'maintenance', v_def.maintenance, 'note', 'already-full'
    );
  end if;

  v_missing := 100 - v_def.maintenance;
  v_cost := ceil(v_missing * 5)::integer;  -- REPAIR_CREDITS_PER_POINT = 5

  if v_credits < v_cost then
    return jsonb_build_object(
      'repaired', false, 'cost', v_cost, 'required', v_cost,
      'credits', v_credits, 'maintenance', v_def.maintenance,
      'note', 'insufficient-credits'
    );
  end if;

  -- 원자 처리: 크레딧 차감(save.credits) + 정비도 100 복구(프로필 행 잠금 하).
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
