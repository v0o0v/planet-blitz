-- =============================================================================
-- Planet Blitz M4 — Phase F · F1 복수전 + F2 도발 스티커 (계획 §4 Phase F · AC6 · AC12)
-- =============================================================================
-- 근거: GDD §8(line121 복수전 "침공당해 순위를 잃으면 24h 내 복수 역침공 — 쿨다운 무시,
--   성공 시 자리 탈환+보너스 광물", line122 도발 스티커 "침공/방어 성공 시 미리 설정한
--   스티커 1개가 상대 알림, 사전 세트에서만 — 자유 입력 금지"), phase-f-contract.md 계약 1·2,
--   ADR-0003(복제 약탈 무손실)·ADR-0004(영구 래더).
--
-- 담는 것:
--   0. invasions 컬럼 추가 — attacker_sticker/defender_sticker(0..11, 1회 불변),
--      caused_swap(스왑 발생 서버 기록 = 복수 대상 판정 근거), is_revenge(복수 침공 마킹).
--   1. guard 트리거 개정 — client insert 시 신규 서버 필드 봉인 + client update 시 스티커
--      1회 불변·서버 필드 고정(이중 방어; invasions 는 애초 client UPDATE 정책 없음).
--   2. set_invasion_sticker(RPC) — 참여자(공/수) 본인이 자기 쪽 스티커 1회 설정.
--   3. get_incoming_invasions(RPC) — 방어자 폴링용 최근 침공 결과(스티커 포함).
--   4. revenge_targets_for(helper) + get_revenge_targets(RPC) — 24h 복수 대상 리스트.
--   5. apply_invasion_result v3 — 복수 판정(직전 스왑 상대 한정 서버 강제)·쿨다운/격차30
--      가드 예외를 그 한정 안에서만·성공 시 자리 탈환+보너스 광물·caused_swap/is_revenge 기록.
--
-- ★ 최우선 제약(Phase D HIGH 리뷰 재개방 금지): 격차30 가드 예외는 **오직** 서버가
--   revenge_targets_for 로 검증한 "나를 직접 스왑으로 이긴 상대"에게만 적용된다. 각 대상은
--   나에게서 순위를 직접 빼앗은 자라 되받는 스왑은 리프프로그가 아니라 자리 탈환이다. 임의
--   상위권을 겨냥한 격차30 우회는 여전히 불가(복수 대상이 아니면 종전 격차30 강제).
--
-- 재실행 안전성: add column if not exists, create or replace, EXECUTE 권한 재적용.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. invasions 컬럼 추가
-- -----------------------------------------------------------------------------
-- 스티커: 공격자·방어자 각각 0..11 인덱스 1개(NULL=미설정). 자유 텍스트 불가(smallint).
alter table public.invasions
  add column if not exists attacker_sticker smallint
    check (attacker_sticker is null or (attacker_sticker >= 0 and attacker_sticker <= 11));
alter table public.invasions
  add column if not exists defender_sticker smallint
    check (defender_sticker is null or (defender_sticker >= 0 and defender_sticker <= 11));
-- 서버 기록: 이 침공이 실제 래더 스왑을 일으켰는가(복수 대상 판정의 권위 근거 — 시간이
-- 지나 순위가 바뀌어도 "당시 스왑이 있었다"는 사실은 이 불변 플래그로 보존).
alter table public.invasions
  add column if not exists caused_swap boolean not null default false;
-- 서버 기록: 이 침공이 복수 침공으로 판정되었는가(관전·통계·클라 배너용).
alter table public.invasions
  add column if not exists is_revenge boolean not null default false;

-- -----------------------------------------------------------------------------
-- 1. guard 트리거 개정
-- -----------------------------------------------------------------------------
-- (1a) client insert 봉인: 클라이언트가 스티커/스왑/복수 플래그를 스스로 심지 못하게 한다.
--   스티커는 오직 set_invasion_sticker RPC(정당한 역할·1회)로만 설정하는 단일 권위 경로.
-- ⚠️ [리뷰 HIGH·회귀] 아래 정의는 Phase D `20260717030000` 이 최상단에 넣은 self-invasion
--   raise 블록을 빠뜨렸다(create or replace 가 몸통 전체를 교체하는데 옮겨 적지 않음) —
--   `20260717160000_m4_phase_f_review_fixes.sql` 이 복원했다. **이 함수를 재정의할 때는
--   self-invasion raise 블록을 반드시 유지할 것**(T-F7 회귀 테스트). 이 파일의 정의는
--   이력 보존용으로만 남긴다(라이브 권위는 160000).
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
    -- Phase F: 서버 전용 필드는 클라 insert 로 심을 수 없다.
    new.attacker_sticker := null;
    new.defender_sticker := null;
    new.caused_swap := false;
    new.is_revenge := false;
  end if;
  return new;
end;
$$;

-- (1b) client update 봉인(이중 방어): invasions 는 client UPDATE 정책이 없어 직접 update
--   경로가 원래 없지만, 향후 정책이 추가되어도 스티커 1회 불변·서버 필드 고정을 강제한다.
--   서버(SECURITY DEFINER RPC = is_service_role 소유자 컨텍스트)는 이 가드를 건너뛰고
--   자기 once-check 로 불변을 보장한다.
create or replace function public.guard_invasions_client_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.verified_status := old.verified_status;
    new.verified_result := old.verified_result;
    new.attacker_won := old.attacker_won;
    new.verified_at := old.verified_at;
    new.caused_swap := old.caused_swap;
    new.is_revenge := old.is_revenge;
    -- 스티커: 이미 설정된 값은 불변(NULL 일 때만 최초 설정 가능).
    if old.attacker_sticker is not null then
      new.attacker_sticker := old.attacker_sticker;
    end if;
    if old.defender_sticker is not null then
      new.defender_sticker := old.defender_sticker;
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger trg_invasions_guard_update
  before update on public.invasions
  for each row execute function public.guard_invasions_client_update();

-- -----------------------------------------------------------------------------
-- 2. set_invasion_sticker — 참여자 본인이 자기 쪽 스티커 1회 설정 (F2 · AC12)
-- -----------------------------------------------------------------------------
-- auth.uid() 로 호출자가 이 침공의 공격자인지 방어자인지 서버가 판정해 해당 컬럼만 설정.
-- 참여자 아님 → 예외. 재설정 시도 → 거부(1회 불변). 인덱스 범위 밖 → 예외(자유 텍스트 불가).
-- SECURITY DEFINER 라 invasions UPDATE 정책 부재(클라 직접 update 봉인)를 우회해 설정한다.
create or replace function public.set_invasion_sticker(
  p_invasion_id uuid,
  p_sticker smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_inv  public.invasions%rowtype;
  v_side text;
begin
  if v_me is null then
    raise exception 'set_invasion_sticker: 로그인 필요';
  end if;
  if p_sticker is null or p_sticker < 0 or p_sticker > 11 then
    raise exception 'set_invasion_sticker: 스티커 인덱스 0..11 범위 밖 (%)', p_sticker;
  end if;

  select * into v_inv from public.invasions where id = p_invasion_id for update;
  if not found then
    raise exception 'set_invasion_sticker: 침공 % 없음', p_invasion_id;
  end if;

  if v_me = v_inv.attacker_id then
    v_side := 'attacker';
    if v_inv.attacker_sticker is not null then
      return jsonb_build_object('ok', false, 'side', v_side,
        'sticker', v_inv.attacker_sticker, 'note', 'already-set');
    end if;
    update public.invasions set attacker_sticker = p_sticker where id = p_invasion_id;
  elsif v_me = v_inv.defender_id then
    v_side := 'defender';
    if v_inv.defender_sticker is not null then
      return jsonb_build_object('ok', false, 'side', v_side,
        'sticker', v_inv.defender_sticker, 'note', 'already-set');
    end if;
    update public.invasions set defender_sticker = p_sticker where id = p_invasion_id;
  else
    raise exception 'set_invasion_sticker: 참여자(공격자/방어자) 본인만 설정 가능';
  end if;

  return jsonb_build_object('ok', true, 'side', v_side, 'sticker', p_sticker, 'note', 'set');
end;
$$;

revoke all on function public.set_invasion_sticker(uuid, smallint) from public;
revoke all on function public.set_invasion_sticker(uuid, smallint) from anon;
grant execute on function public.set_invasion_sticker(uuid, smallint) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. get_incoming_invasions — 방어자 폴링용 최근 침공 결과(스티커 포함) (F2/알림)
-- -----------------------------------------------------------------------------
-- 내가 방어자인 verified 침공을 최근순으로. p_since(있으면) verified_at 이후만. realtime
-- 아님(폴링). "마지막 확인 시각"은 클라 로컬 저장(서버 상태 불필요). 참여자 select 정책
-- (invasions_select_participant) 이 이미 방어자 조회를 허용하지만, RPC 로 필드·정렬을
-- 고정하고 attacker_name(profiles.display_name, 정찰 노출 최소)만 노출한다.
create or replace function public.get_incoming_invasions(
  p_since timestamptz default null,
  p_limit integer default 50
)
returns table (
  invasion_id      uuid,
  attacker_id      uuid,
  attacker_name    text,
  attacker_won     boolean,
  is_revenge       boolean,
  created_at       timestamptz,
  verified_at      timestamptz,
  attacker_sticker smallint,
  defender_sticker smallint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if v_me is null then
    return;
  end if;
  return query
  select
    iv.id,
    iv.attacker_id,
    pa.display_name,
    iv.attacker_won,
    iv.is_revenge,
    iv.created_at,
    iv.verified_at,
    iv.attacker_sticker,
    iv.defender_sticker
  from public.invasions iv
  join public.profiles pa on pa.id = iv.attacker_id
  where iv.defender_id = v_me
    and iv.verified_status = 'verified'
    and (p_since is null or iv.verified_at > p_since)
  order by iv.verified_at desc nulls last, iv.created_at desc
  limit v_limit;
end;
$$;

revoke all on function public.get_incoming_invasions(timestamptz, integer) from public;
revoke all on function public.get_incoming_invasions(timestamptz, integer) from anon;
grant execute on function public.get_incoming_invasions(timestamptz, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. revenge_targets_for(helper) + get_revenge_targets(RPC) — 복수 대상 (F1 · AC6)
-- -----------------------------------------------------------------------------
-- 복수 대상 = p_player 가 방어자로서 24h 내 "스왑당해 순위를 잃은" 침공의 공격자들.
--   - caused_swap=true 로 실제 스왑 손실만(단순 패배·미배치 침공은 대상 아님).
--   - 상대별 가장 최근 손실 1건(distinct on).
--   - 그 손실 이후 아직 되받지(복수 성공: 그 상대를 스왑으로 이김) 못한 것만(소비 시 소멸).
-- revenge_invasion_id = 나를 스왑한 그 침공 id(클라 참조·연출용).
-- 내부 헬퍼 — service_role 만 직접 실행(get_revenge_targets/apply 는 소유자 컨텍스트라 무관).
create or replace function public.revenge_targets_for(p_player uuid)
returns table (
  target_id           uuid,
  revenge_invasion_id uuid,
  loss_at             timestamptz,
  deadline            timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (iv.attacker_id)
    iv.attacker_id                        as target_id,
    iv.id                                 as revenge_invasion_id,
    iv.created_at                         as loss_at,
    iv.created_at + interval '24 hours'   as deadline
  from public.invasions iv
  where iv.defender_id = p_player
    and iv.verified_status = 'verified'
    and iv.attacker_won = true
    and iv.caused_swap = true
    and iv.created_at > now() - interval '24 hours'
    and not exists (
      select 1 from public.invasions rv
      where rv.attacker_id = p_player
        and rv.defender_id = iv.attacker_id
        and rv.verified_status = 'verified'
        and rv.attacker_won = true
        and rv.caused_swap = true
        and rv.created_at > iv.created_at
    )
  order by iv.attacker_id, iv.created_at desc;
$$;

revoke all on function public.revenge_targets_for(uuid) from public;
revoke all on function public.revenge_targets_for(uuid) from anon, authenticated;
grant execute on function public.revenge_targets_for(uuid) to service_role;

-- get_revenge_targets — 클라 관제탑 복수 배지·역침공 진입용. InvasionTarget shape + 복수 메타.
create or replace function public.get_revenge_targets()
returns table (
  profile_id          uuid,
  rank                integer,
  display_name        text,
  ship_summary        jsonb,
  defense_id          uuid,
  layout              jsonb,
  maintenance         numeric,
  revenge_invasion_id uuid,
  expires_at          timestamptz,
  seconds_remaining   integer,
  can_ignore_cooldown boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
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
    d.maintenance,
    rt.revenge_invasion_id,
    rt.deadline,
    greatest(0, ceil(extract(epoch from (rt.deadline - now()))))::integer,
    true
  from public.revenge_targets_for(v_me) rt
  join public.profiles p on p.id = rt.target_id
  left join public.ladder l on l.profile_id = p.id
  left join public.defenses d on d.profile_id = p.id and d.active
  order by rt.deadline asc;
end;
$$;

revoke all on function public.get_revenge_targets() from public;
revoke all on function public.get_revenge_targets() from anon;
grant execute on function public.get_revenge_targets() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. apply_invasion_result v3 — 복수전 통합 (F1 · AC6)
-- -----------------------------------------------------------------------------
-- Phase E(placement) 판을 계승. 추가:
--   - v_is_revenge: 현재 방어자가 공격자의 유효 복수 대상인가(revenge_targets_for 서버 판정).
--   - 쿨다운 예외: 복수 침공은 1시간 재도전 쿨다운 무시(배치된 공격자 대상 게이트에서 제외).
--   - 격차30 예외: 복수 침공만 스왑 격차 상한(≤30) 면제 — 단 복수 대상은 나를 직접 스왑한
--     상대라 리프프로그가 아니라 자리 탈환(HIGH 리뷰 재개방 아님).
--   - 성공 시(탈환 스왑 발생) 보너스 광물(save.minerals) 지급 + caused_swap/is_revenge 기록.
-- 비복수(정상 PvP)·배치전 경로는 Phase E 동작과 완전 동일.
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
  v_is_revenge boolean := false;
  v_swapped    boolean := false;
  v_att_rank   integer := null;
  v_def_rank   integer := null;
  v_loot       jsonb := '[]'::jsonb;
  v_item       record;
  v_inv_count  integer;
  v_minerals   numeric;
  v_bonus      integer := 50;   -- 복수 탈환 보너스 광물(밸런스 튜닝 대상, 계획 §5).
  v_bonus_out  integer := 0;
begin
  -- 호출자 권위: service_role 만.
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
      'loot', '[]'::jsonb, 'is_revenge', v_inv.is_revenge,
      'bonus_minerals', 0, 'note', 'already-finalized'
    );
  end if;

  -- 자기 침공 3차 가드.
  if v_inv.attacker_id = v_inv.defender_id then
    raise exception 'apply_invasion_result: self-invasion 확정 불가 (%)', p_invasion_id;
  end if;

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
  v_att_placed := v_has_att and v_att.placed;

  -- 복수 판정(직전 스왑 상대 한정 서버 강제): 현재 방어자가 공격자의 유효 복수 대상인가.
  -- 현재 침공은 아직 pending 이라 revenge_targets_for 결과에 영향 없음(자기 간섭 없음).
  v_is_revenge := exists (
    select 1 from public.revenge_targets_for(v_inv.attacker_id) rt
    where rt.target_id = v_inv.defender_id
  );

  -- 재도전 쿨다운 1시간 — 배치된 공격자에게만, 단 복수 침공은 쿨다운 무시(GDD §8).
  if v_att_placed and not v_is_revenge and exists (
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
      'loot', '[]'::jsonb, 'is_revenge', false, 'bonus_minerals', 0,
      'note', 'cooldown-violation'
    );
  end if;

  -- verified_* 확정 + 복수 플래그 기록.
  update public.invasions
    set verified_status = 'verified', verified_result = p_verified_result,
        attacker_won = p_attacker_won, verified_at = now(), is_revenge = v_is_revenge
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

    -- 순위 스왑: 양측 placed·공격자 순위>방어자. 격차 상한(≤30)은 **복수 침공만** 예외.
    -- 미배치 공격자는 v_att_placed=false 라 자동 제외(배치전 스왑 금지).
    if v_att_placed and v_has_def and v_def.placed
       and v_att.rank > v_def.rank
       and (v_is_revenge or (v_att.rank - v_def.rank) <= 30) then
      update public.ladder
        set rank = case
                     when profile_id = v_inv.attacker_id then v_def.rank
                     when profile_id = v_inv.defender_id then v_att.rank
                   end
        where profile_id in (v_inv.attacker_id, v_inv.defender_id);
      v_swapped := true;
      v_att_rank := v_def.rank;
      v_def_rank := v_att.rank;
      -- 스왑 발생 사실 기록(복수 대상 판정의 권위 근거).
      update public.invasions set caused_swap = true where id = p_invasion_id;
    end if;

    -- 복수 성공(자리 탈환) 보너스 광물 지급: save.minerals 에 서버 가산(repair_defense
    -- 크레딧 차감 패턴 재사용, 프로필 행 잠금으로 lost-update 차단).
    if v_is_revenge and v_swapped then
      select coalesce((save->>'minerals')::numeric, 0) into v_minerals
        from public.profiles where id = v_inv.attacker_id for update;
      update public.profiles
        set save = jsonb_set(save, '{minerals}', to_jsonb(v_minerals + v_bonus), true)
        where id = v_inv.attacker_id;
      v_bonus_out := v_bonus;
    end if;

    -- 복제 약탈: 배치된 공격자에게만(배치전 약탈 금지) + 인벤 상한 200.
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
    'loot', v_loot,
    'is_revenge', v_is_revenge,
    'bonus_minerals', v_bonus_out
  );
end;
$$;

revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from public;
revoke all on function public.apply_invasion_result(uuid, jsonb, boolean) from anon, authenticated;
grant execute on function public.apply_invasion_result(uuid, jsonb, boolean) to service_role;
