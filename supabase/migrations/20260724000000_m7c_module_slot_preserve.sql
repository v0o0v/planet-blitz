-- =============================================================================
-- Planet Blitz M7c — 코어 모듈 장착 슬롯 "빈 슬롯 보존" 계약 복구 (E-1)
-- =============================================================================
-- ▮ 무엇이 잘못돼 있었나
--   `20260722010000_m7b_core_modules.sql` 이 세운 규약은 **슬롯 i ↔ 표시 i**(고정 길이
--   MODULE_EQUIP_SLOTS=2, 빈 슬롯은 null, 밀집화 금지)다. 같은 파일 주석(§3)과
--   `src/net/modules.ts normalizeEquippedModules` 가 그렇게 못박고 있고,
--   `apply_invasion_result` 의 소진 모듈 정리 블록도 `when x is null then null` 로
--   빈 슬롯을 일부러 남긴다.
--
--   그런데 정작 `guard_defenses_equipped_modules` 트리거가 검증 **전에**
--     new.equipped_module_ids := array(select x from unnest(...) x where x is not null)
--   로 배열을 통째로 재작성해 **null 을 제거(밀집화)** 하고 있었다. before insert/update 트리거라
--   이 재작성 결과가 그대로 저장된다. 결과:
--     · 클라가 슬롯1=비움 / 슬롯2=모듈M 으로 `[null, M]` 을 보내면 저장값은 `[M]` 이 되고,
--       재조회 시 normalizeEquippedModules 가 `[M, null]` 로 읽어 **모듈이 슬롯1 로 이동**한다.
--     · `apply_invasion_result` 가 애써 남긴 null 도 같은 update 의 트리거가 다시 지운다
--       (소진 모듈이 있던 자리가 사라지고 뒷 슬롯이 앞으로 당겨진다).
--   즉 "빈 슬롯 보존" 계약이 서버에서 한 번도 지켜지지 않았다.
--
-- ▮ 무엇을 고치나 — 검증은 유지, 재작성만 제거
--   ① guard_defenses_equipped_modules: 배열을 **그대로 저장**한다(원소 순서·null 위치 불변).
--      원래 의도(길이 상한 2 · 중복 금지 · 소유 검증)는 그대로 유지하되, null 은 검증 대상에서
--      빼는 방식으로만 처리한다(제거가 아니라 무시). null 만 있는 배열도 정상 통과한다.
--      · 길이 상한: 배열 전체 길이(빈 슬롯 포함) ≤ 2 — 클라는 항상 고정 길이 2 를 보낸다.
--      · 중복/소유: 배열의 **non-null 원소**에 대해서만 판정(기존과 판정 결과 동일).
--   ② apply_module_fusion / salvage_core_module 의 장착 해제 블록: 같은 밀집화를 하고 있었다.
--      (`where x <> all(...)` / `where x <> p_module_id` 는 x 가 null 이면 결과가 null →
--       필터에서 탈락 = 빈 슬롯이 조용히 사라진다.) `apply_invasion_result` 와 같은
--      `case when x is null then null ... end` 형태로 바꿔 자리를 남긴다.
--      → 세 경로(침공 확정 차감 · 합성 재료 소모 · 분해)가 모두 같은 규약을 따르게 된다.
--
-- ▮ 무수정 보존
--   `apply_module_fusion` · `salvage_core_module` 은 **장착 해제 update 한 블록만** 치환하고
--   나머지(service_role 게이트 · 3개/중복 id 검증 · for update 재검증 · 등급 일치 · 환급식
--   BASE+affix×4 · 프로필 행 잠금 · 반환 jsonb 키)는 한 줄도 다르지 않다.
--   `guard_defenses_equipped_modules` 도 예외 메시지·errcode(check_violation)를 그대로 쓴다.
--
-- ▮ 기존 데이터에 파괴적이지 않다
--   DML 이 없다(update/delete 없음). 이미 밀집화돼 저장된 배열은 그대로 두며, 다음 장착 변경
--   때부터 사용자가 지정한 자리가 보존된다. 컬럼 타입·기본값·트리거 부착 지점도 그대로다.
--
-- 재실행 안전: create or replace function 만 사용(트리거 재부착 불요 — 같은 함수 이름을
--   가리키고 있다). search_path='' 고정. 권한(security definer/grant)은 기존과 동일 유지.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. guard_defenses_equipped_modules — 빈 슬롯(null) 보존 + 검증 유지
-- -----------------------------------------------------------------------------
create or replace function public.guard_defenses_equipped_modules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_len    integer;  -- 배열 전체 길이(빈 슬롯 포함) — 슬롯 수 상한 판정용.
  v_filled integer;  -- non-null 원소 수 — 중복·소유 판정의 기준.
  v_uniq   integer;
  v_owned  integer;
begin
  if new.equipped_module_ids is null then
    new.equipped_module_ids := '{}'::uuid[];
    return new;
  end if;

  -- ★ 밀집화 금지: 배열을 재작성하지 않는다. null(빈 슬롯)은 자리를 지킨 채 검증에서만 빠진다.
  --   (src/net/modules.ts normalizeEquippedModules '슬롯 i 의미 보존' ·
  --    apply_invasion_result 의 소진 정리 블록과 같은 규약.)

  -- 슬롯 수 상한 2(src/sim/invasion/constants.ts INVASION_CORE_MODULE_SLOTS ·
  -- data/coreModules.ts MODULE_EQUIP_SLOTS 미러 — 세 곳이 함께 움직여야 한다).
  v_len := coalesce(array_length(new.equipped_module_ids, 1), 0);
  if v_len > 2 then
    raise exception 'defenses: 코어 모듈 슬롯은 최대 2개 (요청 %)', v_len
      using errcode = 'check_violation';
  end if;

  -- non-null 원소만 세어 중복·소유를 본다. count(x)·count(distinct x) 는 null 을 세지 않는다.
  select count(x), count(distinct x)
    into v_filled, v_uniq
    from unnest(new.equipped_module_ids) x;
  v_filled := coalesce(v_filled, 0);
  v_uniq   := coalesce(v_uniq, 0);

  if v_filled > 0 then
    if v_uniq <> v_filled then
      raise exception 'defenses: 같은 코어 모듈을 두 슬롯에 장착할 수 없음'
        using errcode = 'check_violation';
    end if;

    -- `= any(배열)` 은 null 원소와 매칭되지 않으므로 빈 슬롯이 소유 판정을 오염시키지 않는다.
    select count(*) into v_owned
      from public.core_modules c
      where c.id = any(new.equipped_module_ids) and c.profile_id = new.profile_id;
    if v_owned <> v_filled then
      raise exception 'defenses: 소유하지 않은 코어 모듈은 장착 불가'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. apply_module_fusion — 재료 소모 시 장착 해제도 빈 슬롯을 남긴다
-- -----------------------------------------------------------------------------
-- 20260722010000:632 본문 전수 보존 + `update public.defenses d` 블록만 치환.
create or replace function public.apply_module_fusion(
  p_profile_id     uuid,
  p_module_ids     uuid[],
  p_result_module  jsonb,
  p_result_rarity  text,
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
    raise exception 'apply_module_fusion: service_role 전용 호출';
  end if;

  if array_length(p_module_ids, 1) is distinct from 3 then
    return jsonb_build_object('ok', false, 'code', 'need-three');
  end if;
  -- 중복 id 방어(같은 모듈을 3번 넣어 1개로 3개 효과 얻는 위조 차단).
  select count(distinct x) into v_uniq_ids from unnest(p_module_ids) x;
  if v_uniq_ids <> 3 then
    return jsonb_build_object('ok', false, 'code', 'dup-ids');
  end if;

  select count(*), count(distinct rarity)
    into v_count, v_distinct
    from public.core_modules
    where id = any(p_module_ids) and profile_id = p_profile_id
    for update;
  if v_count <> 3 then
    return jsonb_build_object('ok', false, 'code', 'not-owned');
  end if;
  if v_distinct <> 1 then
    return jsonb_build_object('ok', false, 'code', 'rarity-mismatch');
  end if;

  -- 재료가 장착 중이면 슬롯에서 빼고 삭제 → 결과 모듈 insert(원자).
  -- ★ 뺀 자리는 null 로 남긴다(밀집화 금지 — 슬롯 i 의미 보존). 구 버전의
  --   `where x <> all(p_module_ids)` 는 x 가 null 이면 결과가 null 이라 빈 슬롯까지 탈락시켜
  --   배열을 앞으로 당겼다.
  update public.defenses d
    set equipped_module_ids = array(
      select case
               when x is null then null
               when x = any(p_module_ids) then null
               else x
             end
      from unnest(d.equipped_module_ids) with ordinality as t(x, ord)
      order by t.ord
    )
    where d.equipped_module_ids && p_module_ids;
  delete from public.core_modules where id = any(p_module_ids) and profile_id = p_profile_id;
  insert into public.core_modules (profile_id, module, rarity, charges_left)
    values (p_profile_id, p_result_module, p_result_rarity, p_result_charges)
    returning id into v_new_id;

  return jsonb_build_object('ok', true, 'module_id', v_new_id, 'rarity', p_result_rarity);
end;
$$;

revoke all on function public.apply_module_fusion(uuid, uuid[], jsonb, text, integer) from public;
revoke all on function public.apply_module_fusion(uuid, uuid[], jsonb, text, integer) from anon, authenticated;
grant execute on function public.apply_module_fusion(uuid, uuid[], jsonb, text, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 3. salvage_core_module — 분해 시 장착 해제도 빈 슬롯을 남긴다
-- -----------------------------------------------------------------------------
-- 20260722010000:699 본문 전수 보존 + `update public.defenses d` 블록만 치환.
create or replace function public.salvage_core_module(p_module_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_mod     public.core_modules%rowtype;
  v_affix   integer;
  v_value   integer;
  v_credits numeric;
begin
  if v_me is null then
    raise exception 'salvage_core_module: 로그인 필요';
  end if;

  select * into v_mod from public.core_modules
    where id = p_module_id and profile_id = v_me for update;
  if not found then
    return jsonb_build_object('ok', false, 'note', 'not-owned');
  end if;

  v_affix := coalesce(jsonb_array_length(v_mod.module->'prefixes'), 0)
           + coalesce(jsonb_array_length(v_mod.module->'suffixes'), 0);
  v_value := (case v_mod.rarity
                when 'normal' then 5
                when 'magic'  then 15
                when 'rare'   then 40
                when 'unique' then 100
                else 0
              end) + v_affix * 4;

  -- 장착 해제(뺀 자리는 null 로 보존 — 밀집화 금지) 후 삭제.
  update public.defenses d
    set equipped_module_ids = array(
      select case
               when x is null then null
               when x = p_module_id then null
               else x
             end
      from unnest(d.equipped_module_ids) with ordinality as t(x, ord)
      order by t.ord
    )
    where d.profile_id = v_me and d.equipped_module_ids @> array[p_module_id];
  delete from public.core_modules where id = p_module_id;

  -- 크레딧 환급(프로필 행 잠금 — lost-update 차단, repair_defense 패턴).
  select coalesce((save->>'credits')::numeric, 0) into v_credits
    from public.profiles where id = v_me for update;
  update public.profiles
    set save = jsonb_set(save, '{credits}', to_jsonb(v_credits + v_value), true)
    where id = v_me;

  return jsonb_build_object(
    'ok', true, 'salvaged', v_value, 'credits', v_credits + v_value, 'rarity', v_mod.rarity
  );
end;
$$;

revoke all on function public.salvage_core_module(uuid) from public;
revoke all on function public.salvage_core_module(uuid) from anon;
grant execute on function public.salvage_core_module(uuid) to authenticated, service_role;

comment on column public.defenses.equipped_module_ids is
  'L3 코어 강화 슬롯에 장착한 코어 모듈(core_modules.id). 최대 2, 중복 불가, 순서 = 슬롯 순서. 빈 슬롯은 null 로 보존(밀집화 금지 — 슬롯 i ↔ 표시 i).';
