-- =============================================================================
-- Planet Blitz M4 — Phase E · E1 배치전(placement) (계획 §4 Phase E1 · AC4 · GDD §8)
-- =============================================================================
-- 근거: GDD §8("배치전: PvP 해금 첫 5회 NPC 시드 기지 → 성적으로 초기 순위 삽입, 기존
--   유저 순위 무변동"), 계약 2(배치전), phase-e-contract.md.
--
-- 담는 것:
--   1. get_placement_targets()  — 미배치 유저에게 NPC 기지 20기 제안(쿨다운 무시).
--      get_invasion_targets()와 반환 shape 동일(클라 타입 재사용).
--   2. get_placement_status()   — 진행 상태(matches_played/won/required/placed).
--   3. apply_placement_result() — verified NPC 매치 5회 성적으로 초기 rank 삽입.
--      삽입점 이하 rank+1 shift → 기존 유저 상대 순서 불변(AC4 해석·증명).
--   4. apply_invasion_result()  — **배치전 인지 개정**: 미배치(placed 아님) 공격자는
--      스왑·복제 약탈·쿨다운 게이트를 모두 건너뛴다(계약 2 "배치전 중 스왑·약탈 금지",
--      Phase D "미배치 apply 엣지"의 명시적 정의). 배치된 공격자는 Phase D 동작 그대로.
--
-- AC4 해석 근거: "기존 유저 순위 무변동" = **상대 순서 불변**으로 해석한다. 신규 유저를
--   rank R 에 삽입하면 rank>=R 인 모든 행이 일괄 +1 shift 된다 — 서로의 상대 순서(누가 더
--   위인지)는 완전히 보존되고, rank<R 은 아예 불변이다. 절대 rank 숫자가 +1 되는 것은
--   래더에 한 명이 새로 끼어들었으니 불가피(총원이 늘었다)하며, GDD 의 취지("신규 진입이
--   기존 경쟁 구도를 흔들지 않음")를 충족한다. 이 마이그레이션 하단 증명 쿼리 참조.
--
-- 재실행 안전성: 모든 함수 create or replace, EXECUTE 권한 명시 재적용.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. get_placement_targets — 미배치 유저에게 NPC 기지 제안 (쿨다운 무시)
-- -----------------------------------------------------------------------------
-- get_invasion_targets()와 동일 반환 shape. 차이: (a) 대상 = is_npc 기지 전체(활성 방어),
-- (b) 순위 격차/쿨다운 무시, (c) 호출자가 아직 배치되지 않은(ladder row 없는) 경우에만
-- 결과를 준다. 이미 배치된 유저에게는 빈 결과(배치전 종료).
create or replace function public.get_placement_targets()
returns table (
  profile_id   uuid,
  rank         integer,
  display_name text,
  ship_summary jsonb,
  defense_id   uuid,
  layout       jsonb,
  maintenance  numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    return;  -- 비로그인: 빈 결과.
  end if;
  -- 이미 래더에 있으면(배치 완료) 배치전 대상 없음.
  if exists (select 1 from public.ladder l where l.profile_id = v_me) then
    return;
  end if;

  return query
  select
    p.id,
    l.rank,
    p.display_name,
    coalesce(
      (select jsonb_build_object('name', s.name, 'level', s.level, 'xp', s.xp)
         from public.ships s where s.profile_id = p.id order by s.slot limit 1),
      '{}'::jsonb
    ) as ship_summary,
    d.id,
    d.layout,
    d.maintenance
  from public.profiles p
  join public.defenses d on d.profile_id = p.id and d.active
  left join public.ladder l on l.profile_id = p.id
  where p.is_npc
  order by l.rank desc;  -- 쉬운(높은 rank 번호) NPC 부터 제안.
end;
$$;

revoke all on function public.get_placement_targets() from public;
revoke all on function public.get_placement_targets() from anon;
grant execute on function public.get_placement_targets() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. get_placement_status — 배치전 진행 상태(진행바·완료 판정)
-- -----------------------------------------------------------------------------
-- matches_played/won = verified 침공 중 attacker=나, defender=NPC 인 것의 수. required=5.
-- placed = 이미 래더 진입했는지. 클라 관제탑 배치전 모드가 0~5 진행바에 쓴다.
create or replace function public.get_placement_status()
returns table (
  matches_played integer,
  matches_won    integer,
  required       integer,
  placed         boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    matches_played := 0; matches_won := 0; required := 5; placed := false;
    return next; return;
  end if;
  select
    count(*)::int,
    count(*) filter (where iv.attacker_won)::int
    into matches_played, matches_won
  from public.invasions iv
  join public.profiles pd on pd.id = iv.defender_id and pd.is_npc
  where iv.attacker_id = v_me and iv.verified_status = 'verified';
  required := 5;
  placed := exists (select 1 from public.ladder l where l.profile_id = v_me and l.placed);
  return next;
end;
$$;

revoke all on function public.get_placement_status() from public;
revoke all on function public.get_placement_status() from anon;
grant execute on function public.get_placement_status() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. apply_placement_result — 5회 성적으로 초기 rank 삽입 (AC4)
-- -----------------------------------------------------------------------------
-- 최초 verified NPC 매치 5회(created_at 오름차순)의 승수로 초기 rank 를 정해 삽입한다.
-- 삽입 rank R = max(1, (현재 최대 rank + 1) - wins*2). 0승→맨 아래(총원+1), 5승→중상위.
-- 삽입 시 rank>=R 인 모든 행을 +1 shift(DEFERRABLE unique 라 단일 트랜잭션 교차 안전) →
-- 기존 유저 상대 순서 완전 보존(AC4). 멱등: 이미 배치되었으면 no-op.
create or replace function public.apply_placement_result(p_player uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid;
  v_played  integer;
  v_wins    integer;
  v_max     integer;
  v_rank    integer;
  v_def     uuid;
begin
  v_me := coalesce(p_player, auth.uid());
  if v_me is null then
    raise exception 'apply_placement_result: 호출자 미상';
  end if;
  -- 타인 배치를 확정하려면 service_role 만(EF 배선용). 본인 확정은 authenticated 허용.
  if p_player is not null and p_player <> auth.uid() and not public.caller_is_service_role() then
    raise exception 'apply_placement_result: 타인 배치는 service_role 전용';
  end if;

  -- 멱등: 이미 배치됨.
  if exists (select 1 from public.ladder l where l.profile_id = v_me) then
    return jsonb_build_object(
      'placed', true,
      'rank', (select rank from public.ladder where profile_id = v_me),
      'matches_won', (select wins from public.ladder where profile_id = v_me),
      'note', 'already-placed'
    );
  end if;

  -- 최초 5매치(verified, defender=NPC)의 승수 집계.
  with first5 as (
    select iv.attacker_won
    from public.invasions iv
    join public.profiles pd on pd.id = iv.defender_id and pd.is_npc
    where iv.attacker_id = v_me and iv.verified_status = 'verified'
    order by iv.created_at asc
    limit 5
  )
  select count(*)::int, count(*) filter (where attacker_won)::int
    into v_played, v_wins
  from first5;

  if v_played < 5 then
    return jsonb_build_object(
      'placed', false, 'rank', null, 'matches_won', v_wins,
      'note', 'placement-incomplete'
    );
  end if;

  -- 삽입 rank 산출(승수 많을수록 상위=작은 수). 래더 행 잠금(교차 갱신 직렬화 —
  -- 집계에는 FOR UPDATE 를 못 걸므로 먼저 전 행을 잠근 뒤 max 를 읽는다).
  perform 1 from public.ladder for update;
  select coalesce(max(rank), 0) into v_max from public.ladder;
  v_rank := greatest(1, (v_max + 1) - v_wins * 2);

  -- 삽입점 이하 일괄 +1 shift(DEFERRABLE unique — 커밋 시 검사). 상대 순서 보존.
  update public.ladder set rank = rank + 1 where rank >= v_rank;

  -- 신규 유저의 활성 방어(있으면) 앵커.
  select id into v_def from public.defenses where profile_id = v_me and active limit 1;

  insert into public.ladder (profile_id, rank, defense_id, wins, losses, placed, last_active)
    values (v_me, v_rank, v_def, v_wins, 5 - v_wins, true, now());

  return jsonb_build_object(
    'placed', true, 'rank', v_rank, 'matches_won', v_wins, 'note', 'placed'
  );
end;
$$;

revoke all on function public.apply_placement_result(uuid) from public;
revoke all on function public.apply_placement_result(uuid) from anon;
grant execute on function public.apply_placement_result(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. apply_invasion_result — 배치전 인지 개정 (미배치 공격자 = 스왑·약탈·쿨다운 스킵)
-- -----------------------------------------------------------------------------
-- Phase D(20260717030000) 판을 계승하되, **공격자가 배치되지 않은(placed 아님) 경우**를
-- 명시적으로 분기한다. 배치전(placement) 침공은 공격자에게 래더 row 가 없으므로:
--   - 순위 스왑 없음(양측 placed 조건 미충족 — Phase D 도 그랬지만 명시).
--   - 복제 약탈 없음(계약 2 "배치전 중 약탈 금지"). Phase D 판은 ladder row 유무와 무관하게
--     약탈했으므로 이 개정이 실질 변경점이다.
--   - 재도전 쿨다운 게이트 없음(GDD §8 배치전은 쿨다운 무시 — get_placement_targets 와 정합).
-- 배치된 공격자(정상 PvP)는 Phase D 동작(self 가드·쿨다운·랭크윈도우≤30·스왑·약탈 상한
-- 200) 완전 동일.
create or replace function public.apply_invasion_result(
  p_invasion_id uuid,
  p_verified_result jsonb,
  p_attacker_won boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv        public.invasions%rowtype;
  v_att        public.ladder%rowtype;
  v_def        public.ladder%rowtype;
  v_has_att    boolean := false;
  v_has_def    boolean := false;
  v_att_placed boolean := false;
  v_swapped    boolean := false;
  v_att_rank   integer := null;
  v_def_rank   integer := null;
  v_loot       jsonb := '[]'::jsonb;
  v_item       record;
  v_inv_count  integer;
begin
  -- 호출자 권위: service_role 만(EXECUTE 권한 + JWT role 클레임 이중 게이트).
  if not public.caller_is_service_role() then
    raise exception 'apply_invasion_result: service_role 전용 호출';
  end if;

  -- 침공 행 잠금 + pending 확인(멱등).
  select * into v_inv from public.invasions where id = p_invasion_id for update;
  if not found then
    raise exception 'apply_invasion_result: 침공 % 없음', p_invasion_id;
  end if;
  if v_inv.verified_status <> 'pending' then
    return jsonb_build_object(
      'swapped', false, 'attacker_rank', null, 'defender_rank', null,
      'loot', '[]'::jsonb, 'note', 'already-finalized'
    );
  end if;

  -- 자기 침공 3차 가드(트리거·EF 를 모두 지나쳐도 확정 불가).
  if v_inv.attacker_id = v_inv.defender_id then
    raise exception 'apply_invasion_result: self-invasion 확정 불가 (%)', p_invasion_id;
  end if;

  -- 래더 행 잠금(교착 방지: profile_id 오름차순 고정 순서). 배치전 판정에 먼저 필요.
  if v_inv.attacker_id <= v_inv.defender_id then
    select * into v_att from public.ladder where profile_id = v_inv.attacker_id for update;
    v_has_att := found;
    select * into v_def from public.ladder where profile_id = v_inv.defender_id for update;
    v_has_def := found;
  else
    select * into v_def from public.ladder where profile_id = v_inv.defender_id for update;
    v_has_def := found;
    select * into v_att from public.ladder where profile_id = v_inv.attacker_id for update;
    v_has_att := found;
  end if;
  v_att_placed := v_has_att and v_att.placed;

  -- 재도전 쿨다운 1시간(제출 경로) — **배치된 공격자에게만** 강제(배치전은 쿨다운 무시).
  if v_att_placed and exists (
    select 1 from public.invasions iv
    where iv.attacker_id = v_inv.attacker_id
      and iv.defender_id = v_inv.defender_id
      and iv.id <> v_inv.id
      and iv.created_at < v_inv.created_at
      and iv.created_at > v_inv.created_at - interval '1 hour'
  ) then
    update public.invasions
      set verified_status = 'rejected', verified_result = p_verified_result,
          attacker_won = false, verified_at = now()
      where id = p_invasion_id;
    return jsonb_build_object(
      'swapped', false, 'attacker_rank', null, 'defender_rank', null,
      'loot', '[]'::jsonb, 'note', 'cooldown-violation'
    );
  end if;

  -- verified_* 확정.
  update public.invasions
    set verified_status = 'verified', verified_result = p_verified_result,
        attacker_won = p_attacker_won, verified_at = now()
    where id = p_invasion_id;

  if p_attacker_won then
    -- 승패 카운터(래더 row 있는 쪽만).
    if v_has_att then
      update public.ladder set wins = wins + 1, last_active = now()
        where profile_id = v_inv.attacker_id;
    end if;
    if v_has_def then
      update public.ladder set losses = losses + 1 where profile_id = v_inv.defender_id;
    end if;

    -- 순위 스왑: 양측 placed·공격자 순위>방어자·격차 ≤30. 미배치 공격자는 v_att_placed=false
    -- 라 자동 제외(배치전 스왑 금지).
    if v_att_placed and v_has_def and v_def.placed
       and v_att.rank > v_def.rank
       and (v_att.rank - v_def.rank) <= 30 then
      update public.ladder
        set rank = case
                     when profile_id = v_inv.attacker_id then v_def.rank
                     when profile_id = v_inv.defender_id then v_att.rank
                   end
        where profile_id in (v_inv.attacker_id, v_inv.defender_id);
      v_swapped := true;
      v_att_rank := v_def.rank;
      v_def_rank := v_att.rank;
    end if;

    -- 복제 약탈: **배치된 공격자에게만**(계약 2 배치전 약탈 금지) + 인벤 상한 200.
    if v_att_placed then
      select count(*) into v_inv_count
        from public.items
        where profile_id = v_inv.attacker_id and location = 'inventory';
      if v_inv_count < 200 then
        for v_item in
          select item_id, data from public.items
            where profile_id = v_inv.defender_id and location = 'inventory'
            order by item_id
            limit 3
        loop
          insert into public.items (profile_id, item_id, location, data)
            values (
              v_inv.attacker_id,
              v_item.item_id || '-loot-' || left(p_invasion_id::text, 8),
              'inventory',
              v_item.data || jsonb_build_object(
                'looted_from', v_inv.defender_id,
                'looted_at', now(),
                'source_invasion', p_invasion_id
              )
            )
            on conflict (profile_id, item_id) do nothing;
          v_loot := v_loot || jsonb_build_array(v_item.data);
        end loop;
      end if;
    end if;
  else
    -- 공격 실패: 방어자 승 기록. 래더 순위 무변동.
    if v_has_att then
      update public.ladder set losses = losses + 1, last_active = now()
        where profile_id = v_inv.attacker_id;
    end if;
    if v_has_def then
      update public.ladder set wins = wins + 1 where profile_id = v_inv.defender_id;
    end if;
  end if;

  return jsonb_build_object(
    'swapped', v_swapped,
    'attacker_rank', v_att_rank,
    'defender_rank', v_def_rank,
    'loot', v_loot
  );
end;
$$;

revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from public;
revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from anon, authenticated;
grant execute on function public.apply_invasion_result(uuid, jsonb, boolean) to service_role;
