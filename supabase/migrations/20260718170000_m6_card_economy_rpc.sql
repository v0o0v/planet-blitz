-- =============================================================================
-- Planet Blitz M6 — 방어 카드 경제 원자 적용 RPC(구매·합성·방어 성공 드랍) + 구매 기록
-- =============================================================================
-- 근거: grill-defense-card 스펙 · team-plan OQ#1(만석 20장 획득 차단) · lane-c-server.md
--   §Remaining(카드 생성 경로는 결정론 TS 롤러 실행이 필요 → 전용 cards Edge Function 이 롤 결과를
--   확정, 이 RPC 들이 그 결과를 service_role 단일 트랜잭션으로 원자 적용). 20260718160000 의
--   defense_cards 스키마 위에 쌓는다(기존 파일 무수정 — 신규 파일).
--
-- 담는 것:
--   1. card_shop_purchases — (profile, dateSeed, slotIndex) 유니크로 같은 날 같은 슬롯 중복 구매
--      원자 차단. RLS select-own(클라가 오늘 구매분 조회해 버튼 비활성) + 쓰기 정책 부재(서버 전용).
--   2. apply_card_purchase(RPC) — 프로필 락 → 상한(20) → 크레딧 → 중복 → 차감+insert 를 단일
--      트랜잭션으로. cards EF(service_role)만 호출. 롤러는 EF 가 이미 실행(카드 jsonb 를 인자로 받음).
--   3. apply_card_fusion(RPC) — 3장 소유·동급·잔존 행 잠금 재검증 → 삭제(장착 해제 포함)+결과 insert.
--   4. apply_card_drop(RPC) — 방어 성공 드랍: 상한(20) 검사 후 insert(만석이면 미획득). verify-invasion
--      EF 가 방어자 승리 확정 직후 호출(TS 롤러로 카드 롤 → 이 RPC 로 원자 insert).
--
-- ★생성 롤러는 SQL 에 두지 않는다(plpgsql bit-identical 재구현 금지 — 상점 결정론 발산 위험).
--   EF 가 rollCard/attemptFusion/rollShopRotation 으로 카드를 확정하고, 이 RPC 들은 확정된 jsonb 를
--   검증·차감·저장만 한다. 모든 RPC 는 caller_is_service_role() 게이트(2차) + service_role grant(1차).
--
-- 재실행 안전: create table/policy if [not] exists·create or replace function·search_path='' 고정.
-- 원격 적용은 하지 말 것(리포 마이그레이션만; 원격은 리드 승인 후).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. card_shop_purchases — 같은 날 같은 슬롯 중복 구매 차단 기록
-- -----------------------------------------------------------------------------
-- date_seed = shopDateSeedFromMs(UTC 일 인덱스), slot_index = 로테이션 슬롯. 복합 PK 가 중복 구매를
-- 원자 차단한다(apply_card_purchase 가 insert 시 unique_violation 을 already-bought 로 흡수).
create table if not exists public.card_shop_purchases (
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  date_seed   bigint      not null,
  slot_index  integer     not null,
  created_at  timestamptz not null default now(),
  primary key (profile_id, date_seed, slot_index)
);

alter table public.card_shop_purchases enable row level security;

-- 읽기: 본인 구매분만(오늘 date_seed 로 조회해 이미 산 슬롯 버튼 비활성). 쓰기 정책 부재 → 클라
-- 직접 insert/update/delete 불가(구매 위조 차단). 서버 RPC(service_role)만 기록.
drop policy if exists card_shop_purchases_select_own on public.card_shop_purchases;
create policy card_shop_purchases_select_own
  on public.card_shop_purchases for select
  to authenticated
  using (auth.uid() = profile_id);

-- -----------------------------------------------------------------------------
-- 2. apply_card_purchase — 상점 구매 원자 적용(상한·크레딧·중복·차감·insert)
-- -----------------------------------------------------------------------------
-- 순서(원자성·경합 안전): 프로필 행 잠금(동일 유저 동시 구매 직렬화) → 상한(20) → 크레딧 →
--   중복 구매(유니크 insert, 서브트랜잭션) → 크레딧 차감 + 카드 insert. 실패 분기는 mutation
--   이전이거나(상한·크레딧) 서브트랜잭션 롤백(중복)이라 phantom 구매 기록/차감이 남지 않는다.
create or replace function public.apply_card_purchase(
  p_profile_id  uuid,
  p_date_seed   bigint,
  p_slot_index  integer,
  p_card        jsonb,
  p_rarity      text,
  p_charges_left integer,
  p_price       integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credits numeric;
  v_count   integer;
  v_new_id  uuid;
begin
  if not public.caller_is_service_role() then
    raise exception 'apply_card_purchase: service_role 전용 호출';
  end if;

  -- 프로필 행 잠금 → 동일 유저 동시 구매를 직렬화(상한/크레딧 경합 차단) + 크레딧 로드.
  select coalesce((save->>'credits')::numeric, 0) into v_credits
    from public.profiles where id = p_profile_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-profile');
  end if;

  -- 보관함 20장 상한(OQ#1: 만석 시 획득 차단). data/defenseCards.ts CARD_STORAGE_CAP=20 미러.
  select count(*) into v_count from public.defense_cards where profile_id = p_profile_id;
  if v_count >= 20 then
    return jsonb_build_object('ok', false, 'code', 'storage-full');
  end if;

  -- 크레딧 충분한가(차감 전 검사 — 부족하면 아무 것도 변경 안 함).
  if v_credits < p_price then
    return jsonb_build_object('ok', false, 'code', 'insufficient-credits', 'credits', v_credits);
  end if;

  -- 중복 구매 차단(유니크 PK). 서브트랜잭션이라 dup 시 이 insert 만 롤백되고 위 변경은 없음.
  begin
    insert into public.card_shop_purchases (profile_id, date_seed, slot_index)
      values (p_profile_id, p_date_seed, p_slot_index);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'already-bought');
  end;

  -- 크레딧 차감 + 카드 insert(원자).
  update public.profiles
    set save = jsonb_set(save, '{credits}', to_jsonb(v_credits - p_price), true)
    where id = p_profile_id;
  insert into public.defense_cards (profile_id, card, rarity, charges_left)
    values (p_profile_id, p_card, p_rarity, p_charges_left)
    returning id into v_new_id;

  return jsonb_build_object(
    'ok', true, 'card_id', v_new_id, 'rarity', p_rarity, 'credits', v_credits - p_price
  );
end;
$$;

revoke all on function public.apply_card_purchase(uuid, bigint, integer, jsonb, text, integer, integer) from public;
revoke all on function public.apply_card_purchase(uuid, bigint, integer, jsonb, text, integer, integer) from anon, authenticated;
grant execute on function public.apply_card_purchase(uuid, bigint, integer, jsonb, text, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 3. apply_card_fusion — 합성 원자 적용(3장 소유·동급·잔존 재검증 → 삭제 + 결과 insert)
-- -----------------------------------------------------------------------------
-- EF 가 소유·등급을 미리 읽어 롤러를 돌렸더라도, 여기서 행 잠금으로 재검증한다(TOCTOU 안전 —
-- 그 사이 카드가 salvage 되면 v_count<>3 로 not-owned 거부, 아무 것도 소모/생성 안 함). 재료가
-- 장착 중이면 먼저 해제(equipped_card_id = null)한 뒤 삭제한다.
create or replace function public.apply_card_fusion(
  p_profile_id    uuid,
  p_card_ids      uuid[],
  p_result_card   jsonb,
  p_result_rarity text,
  p_result_charges integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count    integer;
  v_distinct integer;
  v_uniq_ids integer;
  v_new_id   uuid;
begin
  if not public.caller_is_service_role() then
    raise exception 'apply_card_fusion: service_role 전용 호출';
  end if;

  if array_length(p_card_ids, 1) is distinct from 3 then
    return jsonb_build_object('ok', false, 'code', 'need-three');
  end if;
  -- 중복 id 방어(같은 카드를 3번 넣어 1장으로 3장 효과 얻는 위조 차단).
  select count(distinct x) into v_uniq_ids from unnest(p_card_ids) x;
  if v_uniq_ids <> 3 then
    return jsonb_build_object('ok', false, 'code', 'dup-ids');
  end if;

  -- 소유·동급·잔존 행 잠금 재검증.
  select count(*), count(distinct rarity)
    into v_count, v_distinct
    from public.defense_cards
    where id = any(p_card_ids) and profile_id = p_profile_id
    for update;
  if v_count <> 3 then
    return jsonb_build_object('ok', false, 'code', 'not-owned');
  end if;
  if v_distinct <> 1 then
    return jsonb_build_object('ok', false, 'code', 'rarity-mismatch');
  end if;

  -- 재료가 장착 중이면 해제 후 삭제 → 결과 카드 insert(원자).
  update public.defenses set equipped_card_id = null where equipped_card_id = any(p_card_ids);
  delete from public.defense_cards where id = any(p_card_ids) and profile_id = p_profile_id;
  insert into public.defense_cards (profile_id, card, rarity, charges_left)
    values (p_profile_id, p_result_card, p_result_rarity, p_result_charges)
    returning id into v_new_id;

  return jsonb_build_object('ok', true, 'card_id', v_new_id, 'rarity', p_result_rarity);
end;
$$;

revoke all on function public.apply_card_fusion(uuid, uuid[], jsonb, text, integer) from public;
revoke all on function public.apply_card_fusion(uuid, uuid[], jsonb, text, integer) from anon, authenticated;
grant execute on function public.apply_card_fusion(uuid, uuid[], jsonb, text, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 4. apply_card_drop — 방어 성공 드랍 원자 적용(상한 검사 후 insert)
-- -----------------------------------------------------------------------------
-- verify-invasion EF 가 방어자 승리(방어 성공) 확정 직후, TS 롤러로 카드를 롤해 이 RPC 로 원자
-- insert 한다. 만석(20)이면 미획득(OQ#1). 카드 롤 자체는 EF(crypto 시드) 몫 — 여긴 저장만.
create or replace function public.apply_card_drop(
  p_profile_id   uuid,
  p_card         jsonb,
  p_rarity       text,
  p_charges_left integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count  integer;
  v_new_id uuid;
begin
  if not public.caller_is_service_role() then
    raise exception 'apply_card_drop: service_role 전용 호출';
  end if;

  select count(*) into v_count from public.defense_cards where profile_id = p_profile_id;
  if v_count >= 20 then
    return jsonb_build_object('ok', false, 'code', 'storage-full');
  end if;

  insert into public.defense_cards (profile_id, card, rarity, charges_left)
    values (p_profile_id, p_card, p_rarity, p_charges_left)
    returning id into v_new_id;

  return jsonb_build_object('ok', true, 'card_id', v_new_id, 'rarity', p_rarity);
end;
$$;

revoke all on function public.apply_card_drop(uuid, jsonb, text, integer) from public;
revoke all on function public.apply_card_drop(uuid, jsonb, text, integer) from anon, authenticated;
grant execute on function public.apply_card_drop(uuid, jsonb, text, integer) to service_role;
