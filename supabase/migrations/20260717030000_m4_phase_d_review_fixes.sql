-- =============================================================================
-- Planet Blitz M4 — Phase D 코드리뷰 REQUEST_CHANGES 반영 (서버 몫 5건 중 SQL 3건)
-- =============================================================================
-- 리뷰 지적·수정:
--   [CRITICAL] 자기 침공(attacker=defender) 3중 차단 중 ①insert 가드 트리거·
--              ③apply_invasion_result 진입부 가드 (②EF 는 index.ts).
--   [HIGH]     제출 경로(insert→verify→apply)에도 재도전 쿨다운 1시간·랭크 윈도우(≤30)
--              를 서버 강제 — get_invasion_targets 안에만 있던 규칙을 확정 지점에 복제.
--   [MED]      복제 약탈 공격자 인벤 총량 상한(200) — Phase E 튜닝 전 무한 팽창 방지.
-- 유지(리뷰 인정 강점): caller_is_service_role 게이트, profile_id 오름차순 락 순서,
-- ladder_rank_key DEFERRABLE, pending 멱등 가드.
-- 재실행 안전성: create or replace / drop trigger if exists 패턴으로 수렴.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. [CRITICAL-①] invasions insert 가드 — 자기 침공 원천 차단 + pending 강제
-- -----------------------------------------------------------------------------
-- 기존 guard_invasions_client_insert(pending·결과 null 강제)에 self-invasion raise 를
-- 추가한다. 자기 침공은 service_role 경로에도 정당한 사용처가 없으므로(배치전 NPC 도
-- 별도 시드 프로필) 역할 무관하게 항상 거부한다.
create or replace function public.guard_invasions_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 자기 침공 금지(리뷰 CRITICAL): 매치메이킹 우회 직접 insert 로 자기(빈) 방어를
  -- 이겨 복제 약탈을 파밍하는 경로를 삽입 시점에 차단. 역할 무관(서버 경로 포함).
  if new.attacker_id = new.defender_id then
    raise exception 'self-invasion is not allowed (attacker = defender)'
      using errcode = 'check_violation';
  end if;

  if not public.is_service_role() then
    new.verified_status := 'pending';
    new.verified_result := null;
    new.attacker_won := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

-- 트리거 자체는 기존 정의(before insert) 재사용 — 함수 교체만으로 반영된다.

-- -----------------------------------------------------------------------------
-- 2. apply_invasion_result 교체 — self 가드·쿨다운·랭크 윈도우·약탈 상한
-- -----------------------------------------------------------------------------
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
  v_inv       public.invasions%rowtype;
  v_att       public.ladder%rowtype;
  v_def       public.ladder%rowtype;
  v_has_att   boolean := false;
  v_has_def   boolean := false;
  v_swapped   boolean := false;
  v_att_rank  integer := null;
  v_def_rank  integer := null;
  v_loot      jsonb := '[]'::jsonb;
  v_item      record;
  v_inv_count integer;
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

  -- [CRITICAL-③] 자기 침공 3차 가드(트리거·EF 를 모두 지나쳐도 확정 불가).
  if v_inv.attacker_id = v_inv.defender_id then
    raise exception 'apply_invasion_result: self-invasion 확정 불가 (%)', p_invasion_id;
  end if;

  -- [HIGH-ⓐ] 재도전 쿨다운 1시간 서버 강제(제출 경로): 이 침공보다 먼저 생성된 동일
  -- (attacker, defender) 침공이 1시간 안에 존재하면 — 매치메이킹 제안 규칙과 동일 기준,
  -- 검증 결과 무관(GDD §8 "재도전 쿨다운 1시간, 실패 페널티 없음" = 결과 불문 재도전 제한)
  -- — 이 침공을 rejected 로 확정하고 래더·약탈을 적용하지 않는다.
  if exists (
    select 1 from public.invasions iv
    where iv.attacker_id = v_inv.attacker_id
      and iv.defender_id = v_inv.defender_id
      and iv.id <> v_inv.id
      and iv.created_at < v_inv.created_at
      and iv.created_at > v_inv.created_at - interval '1 hour'
  ) then
    update public.invasions
      set verified_status = 'rejected',
          verified_result = p_verified_result,
          attacker_won = false,
          verified_at = now()
      where id = p_invasion_id;
    return jsonb_build_object(
      'swapped', false, 'attacker_rank', null, 'defender_rank', null,
      'loot', '[]'::jsonb, 'note', 'cooldown-violation'
    );
  end if;

  -- verified_* 확정.
  update public.invasions
    set verified_status = 'verified',
        verified_result = p_verified_result,
        attacker_won = p_attacker_won,
        verified_at = now()
    where id = p_invasion_id;

  -- 래더 행 잠금(교착 방지: profile_id 오름차순 고정 순서).
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

  if p_attacker_won then
    -- 승패 카운터.
    if v_has_att then
      update public.ladder set wins = wins + 1, last_active = now()
        where profile_id = v_inv.attacker_id;
    end if;
    if v_has_def then
      update public.ladder set losses = losses + 1 where profile_id = v_inv.defender_id;
    end if;

    -- 순위 스왑 조건: 양측 placed·공격자 순위가 방어자보다 낮음(수가 큼)·
    -- [HIGH-ⓑ] 랭크 윈도우 — 매치메이킹 제안 규칙(내 위 3명은 격차 ≤3, 랜덤은
    -- 내 순위-30 구간)과 동일하게 격차 30 이내만 스왑 허용. 매치메이킹을 우회해
    -- 30위 밖 상위권을 직접 침공해도 순위를 못 뺏는다(승패 카운터·약탈만).
    if v_has_att and v_has_def and v_att.placed and v_def.placed
       and v_att.rank > v_def.rank
       and (v_att.rank - v_def.rank) <= 30 then
      update public.ladder
        set rank = case
                     when profile_id = v_inv.attacker_id then v_def.rank
                     when profile_id = v_inv.defender_id then v_att.rank
                   end
        where profile_id in (v_inv.attacker_id, v_inv.defender_id);
      v_swapped := true;
      v_att_rank := v_def.rank;  -- 공격자 새 순위 = 방어자 옛 순위
      v_def_rank := v_att.rank;  -- 방어자 새 순위 = 공격자 옛 순위
    end if;

    -- [MED-4] 복제 약탈 상한: 공격자 inventory 총량이 상한(200) 이상이면 약탈 skip
    -- (Phase E 밸런스 튜닝 전 무한 팽창 방지 — 잠정값, 원본 무손실 원칙은 불변).
    select count(*) into v_inv_count
      from public.items
      where profile_id = v_inv.attacker_id and location = 'inventory';
    if v_inv_count < 200 then
      -- 복제 약탈(ADR-0003): 방어자 inventory 일부 복제 지급(원본 무손실).
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

-- EXECUTE 게이트 재보증(create or replace 는 기존 권한을 유지하지만 명시 재적용).
revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from public;
revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from anon, authenticated;
grant execute on function public.apply_invasion_result(uuid, jsonb, boolean) to service_role;
