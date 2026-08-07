-- =============================================================================
-- profiles.save 아이템 증가분 봉인 (ADR-0050 §3 단계 1 · 정정 1)
-- =============================================================================
--
-- ⭐ **이것이 없으면 앞의 여섯 PR(#362~#367)이 정직한 클라에게만 적용된다.**
--
-- 지금까지 세운 방어는 *"정직한 클라가 서버 드랍을 받는다"* 까지다. 서버가 시드를 쥐고
-- 굴려 원장에 적어도, **세이브를 직접 고쳐 아이템을 심는 경로는 그대로 열려 있었다** —
-- `guard_profiles_client_write`(정본 20260805000000:186-198)가 고정하는 것은 **스칼라
-- 컬럼 12개뿐이고 `save` jsonb 는 그 밖**이기 때문이다. 그리고 아이템·기체·장착·XP·레벨이
-- 전부 그 `save` 안에 산다(`src/save/profile.ts:134-211`).
--
-- ADR-0050 정정 1 이 단계 1 의 표적을 `items`·`ships` RLS 에서 **`profiles.save` 봉인**으로
-- 재설정한 것이 바로 이 자리다.
--
-- -----------------------------------------------------------------------------
-- 봉인의 술어 — 「원장에 없는 아이템 id 의 **신규 등장**을 되돌린다」 (2026-08-08 사용자 판정)
-- -----------------------------------------------------------------------------
--
-- ⭐⭐ **「증가분만」이 곧 grandfather 다 — 백필이 한 줄도 필요 없다.**
--
--    원장(`item_grants`)은 방금 생겼으므로 **이미 플레이 중인 계정의 기존 아이템은 원장에
--    없다.** 봉인을 "보유 전체가 원장에 있는가"로 짜면 적용 순간 **전 유저가 전 재산을
--    잃는다.** 그러나 이 트리거는 OLD 와 NEW 를 비교해 **NEW 에만 있는 id** 만 검사하므로,
--    기존 보유분은 OLD 에 있다는 사실만으로 무조건 통과한다. 기준 시각 컬럼도, 1회 백필
--    스크립트도, 계정별 스냅샷 저장(= 저장 예산 초과)도 필요 없다.
--
-- 통과시키는 id (allowlist):
--   · `it-starter-{슬롯}` — 초기 지급(`src/items/starterKit.ts:80`). **온라인 전용이 되어도
--     이것만은 클라가 만든다.** 이 한 건을 빠뜨리면 **신규 계정이 첫 장비를 잃는다.**
--     자유 시드가 아니라 **슬롯 고정 접두**라 개수가 유한하고(장착 슬롯 수) 오프라인 전수
--     탐색의 표적이 되지 않는다 — `it-{seed}` 와 갈라 다루는 근거가 그것이다.
--   · `drop:{grant_id}`       — `item_grants`      (본인 행이 실재할 때만)
--   · `commission:{grant_id}` — `commission_grants`(본인 행이 실재할 때만)
--   · `daily:{date_seed}`     — `daily_reward_claims`(본인 행이 실재할 때만)
--
-- 되돌리는 id: 그 밖의 **전부**. 실질 표적은 **`it-{seed}`**(`src/items/roll.ts:168`)다 —
-- 클라가 임의 시드로 만들 수 있는 유일한 접두사이고, 아이템 id 가 곧 시드라 **어떤 시드가
-- 유니크를 내는지 오프라인 전수 탐색이 가능**하다(ADR-0050 정정 2 가 클라 시드 안을 기각한
-- 바로 그 이유). 위조자가 쓸 접두사가 정확히 이것이다.
--
-- ⚠️ **`-loot-`(복제 약탈, 20260726000000:450)는 allowlist 에 없다.** 그 접두사는 서버 SQL 이
--    `public.items` 행에만 찍고, 클라는 그 테이블을 **읽지도 쓰지도 않는다**(`src/**` 에
--    `.from('items')` 0건 — ADR-0050 정정 1). 즉 정상 경로로는 `save` 에 들어오지 않는다.
--    ⛔ 언젠가 약탈품을 `save` 로 배송하도록 배선하면 **여기 allowlist 를 같이 늘려라** —
--    안 늘리면 약탈이 조용히 무효가 되고, 증상이 "가끔 안 들어온다"라 원인을 못 찾는다.
--
-- -----------------------------------------------------------------------------
-- ⭐ 되돌림의 **입도** — save 통짜가 아니라 **위반 아이템만** 제거한다
-- -----------------------------------------------------------------------------
-- 기존 guard 관용구는 컬럼 단위 `new.x := old.x` 통짜 복원이다. 그것을 `save` 에 그대로
-- 쓰면 위반 아이템 하나 때문에 **XP·레벨·자원·스토리 진행까지 통째로 롤백**된다. 클라의
-- 사소한 결함 하나가 정직한 플레이어의 런 전체를 조용히 날리는 폭발 반경이라, jsonb 는
-- 부분 수정이 가능하다는 이점을 써서 **위반 id 를 담은 자리만 들어낸다.**
-- 나머지 필드는 한 바이트도 안 건드린다.
--
-- ⚠️ **배열 순서를 보존한다**(`jsonb_agg(... order by ord)`). 인벤/창고는 순서가 곧 화면
--    배치라, 순서가 섞이면 위조와 무관한 유저에게 "가방이 뒤집혔다"로 보인다.
--
-- -----------------------------------------------------------------------------
-- 짝이 되는 클라 변경 — 온라인 계정의 **로컬 롤 강등을 끈다** (2026-08-08 사용자 판정)
-- -----------------------------------------------------------------------------
-- PR#366 은 `dropRunId === null`(미설정·네트워크 실패·캡 초과)이면 전리품을 클라가 굴리게
-- 남겼다. 그 산출물은 `it-{seed}` 라 원장에 없어 **이 봉인이 되돌린다.** 클라가 심고 서버가
-- 지우면 정직한 플레이어가 *"분명 주웠는데 사라졌다"* 를 겪고 원인이 화면에 안 나온다 —
-- 이 리포가 반복해 대가를 치른 「조용히 갈리는 두 자리」 패턴이다.
-- ⇒ `src/main.ts` 가 **설정된 계정에서는 로컬 롤로 강등하지 않는다**(전리품 0). 미설정
--    (데모/하네스) 경로의 로컬 롤은 그대로 산다 — 계획서의 ⛔*"강등을 없애지 마라"* 는
--    그쪽을 가리킨다.
--
-- -----------------------------------------------------------------------------
-- 이 봉인이 **덮지 않는 것** (알고 남긴다)
-- -----------------------------------------------------------------------------
-- **어픽스 단위 봉인은 이 레인에 없다**(2026-08-08 사용자 판정 = 안 한다). 정련은 아이템
-- id 를 안 바꾸고 같은 자리에 대입하므로(`src/ui/pixi/refinery.ts:1016-1017`) 증가분 봉인을
-- **통과한다.** PR#367 이 닫은 것은 「공짜 재굴림」(대가를 치른 횟수만큼만 굴린다)뿐이고,
-- 세이브의 어픽스를 손으로 고치는 문은 열려 있다. ADR §4 의 목표가 *"차단이 아니라 유계"*
-- 라 이 상태로도 정합적이다. 닫으려면 원장이 어픽스까지 재확정할 수 있어야 하는데, 원장은
-- `(drop_seed, rarity, source)` 3필드만 저장하는 저장 예산 설계라(ADR-0050 §저장 예산)
-- 계약 개정이 함께 필요하다.

-- -----------------------------------------------------------------------------
-- 1. jsonb 형 방어 헬퍼 — 클라가 보낸 save 는 **형이 보장되지 않는다**
-- -----------------------------------------------------------------------------
-- `jsonb_array_elements` 는 인자가 배열이 아니면 **예외를 던진다.** 클라가 `inventory` 를
-- 객체로 보내면 그 예외가 트리거에서 터져 **정상 저장까지 통째로 실패**한다. 위조 시도가
-- 저장 거부가 아니라 500 으로 나가면 원인 규명이 불가능해지므로, 형이 어긋난 자리는
-- **빈 값으로 취급하고 조용히 지나간다**(그 자리에 아이템이 없다는 뜻이므로 봉인상 안전하다).
create or replace function public.jsonb_arr_or_empty(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end;
$$;

create or replace function public.jsonb_obj_or_empty(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end;
$$;

-- -----------------------------------------------------------------------------
-- 2. save_item_ids — save 안에서 Item 이 사는 **네 자리 전수**
-- -----------------------------------------------------------------------------
-- 정본 열거는 `src/save/itemPresence.ts:14-23,40-45,75-92` 와 같다:
--   ① `inventory`               (`src/save/profile.ts:139`)
--   ② `stash`                   (`profile.ts:140`)
--   ③ `ships[].equipped`        (`profile.ts:104` — Partial<Record<EquipSlotId, Item>> = **객체**)
--   ④ `guardians[].build.equipped` (`profile.ts:226`, `build` 은 선택 필드)
--
-- ⚠️ **이 네 자리를 늘리면 여기도 늘려라.** 빠진 자리는 봉인의 시야 밖이라 위조자가 정확히
--    그 자리에 심는다. 계약 테스트가 **네 경로의 존재**를 단언한다.
-- ⚠️ `guardians[].snapshot` 에는 장비가 없고(`itemPresence.ts:22`), `defenseLayout` 의 슬롯은
--    `InvasionRef`(id 문자열이 아예 없다 — `src/items/rollDefenseUnit.ts:210`)라 대상이 아니다.
create or replace function public.save_item_ids(p_save jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct s.id), '{}'::text[])
  from (
    select it->>'id' as id
      from jsonb_array_elements(public.jsonb_arr_or_empty(p_save->'inventory')) as it
    union all
    select it->>'id'
      from jsonb_array_elements(public.jsonb_arr_or_empty(p_save->'stash')) as it
    union all
    select eq.value->>'id'
      from jsonb_array_elements(public.jsonb_arr_or_empty(p_save->'ships')) as sh,
           lateral jsonb_each(public.jsonb_obj_or_empty(sh->'equipped')) as eq
    union all
    select eq.value->>'id'
      from jsonb_array_elements(public.jsonb_arr_or_empty(p_save->'guardians')) as g,
           lateral jsonb_each(public.jsonb_obj_or_empty(g->'build'->'equipped')) as eq
  ) s
  where s.id is not null;
$$;

-- -----------------------------------------------------------------------------
-- 3. item_id_ledgered — allowlist 술어
-- -----------------------------------------------------------------------------
-- ⭐ **원장 조회는 `p_profile` 로 못박는다.** 남의 배송 id 를 베껴 쓰는 것을 막는 자리다 —
--    `exists` 에서 `profile_id` 조건을 빼면 **한 명이 받은 유니크를 전원이 심을 수 있다.**
--    계약 테스트가 세 원장 각각에 `profile_id` 조건이 있음을 단언한다.
create or replace function public.item_id_ledgered(p_profile uuid, p_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    -- 초기 지급 — 슬롯 고정 접두. 자유 시드가 아니라 탐색 표적이 되지 않는다.
    when p_id like 'it-starter-%' then true
    when p_id like 'drop:%' then exists (
      select 1 from public.item_grants g
       where g.profile_id = p_profile
         and 'drop:' || g.grant_id::text = p_id)
    when p_id like 'commission:%' then exists (
      select 1 from public.commission_grants g
       where g.profile_id = p_profile
         and 'commission:' || g.grant_id::text = p_id)
    when p_id like 'daily:%' then exists (
      select 1 from public.daily_reward_claims c
       where c.profile_id = p_profile
         and 'daily:' || c.date_seed::text = p_id)
    else false
  end;
$$;

-- -----------------------------------------------------------------------------
-- 4. 위반 아이템 제거 헬퍼
-- -----------------------------------------------------------------------------
-- `order by ord` 가 배열 순서를 보존한다(위 §입도 참조).
create or replace function public.reject_items_by_id(p_arr jsonb, p_bad text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(t.it order by t.ord), '[]'::jsonb)
    from jsonb_array_elements(public.jsonb_arr_or_empty(p_arr)) with ordinality as t(it, ord)
   where not ((t.it->>'id') = any(p_bad));
$$;

-- 장착은 슬롯 키 → Item 객체다. 위반 아이템은 **키째로 뺀다** = 그 칸이 빈 칸이 된다
-- (`Partial<Record<EquipSlotId, Item>>` 의 "absent = empty slot" 규약 그대로).
create or replace function public.reject_equipped_by_id(p_obj jsonb, p_bad text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(t.k, t.v), '{}'::jsonb)
    from jsonb_each(public.jsonb_obj_or_empty(p_obj)) as t(k, v)
   where not ((t.v->>'id') = any(p_bad));
$$;

-- -----------------------------------------------------------------------------
-- 5. seal_save_items — 봉인 본체
-- -----------------------------------------------------------------------------
create or replace function public.seal_save_items(p_profile uuid, p_old jsonb, p_new jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_old_ids text[];
  v_bad     text[];
  v_out     jsonb;
begin
  -- save 가 객체가 아니면(null 포함) 검사할 아이템이 없다. `is distinct from` 을 쓰는 이유는
  -- `jsonb_typeof(null)` 이 null 이라 `<>` 가 null 을 내고 `if` 가 거짓 분기로 새기 때문이다.
  if jsonb_typeof(p_new) is distinct from 'object' then
    return p_new;
  end if;

  -- ⭐ grandfather — OLD 에 이미 있던 id 는 무조건 통과한다. 이 한 줄이 백필 전체를 대체한다.
  v_old_ids := public.save_item_ids(public.jsonb_obj_or_empty(p_old));

  select coalesce(array_agg(x.id), '{}'::text[]) into v_bad
    from unnest(public.save_item_ids(p_new)) as x(id)
   where not (x.id = any(v_old_ids))
     and not public.item_id_ledgered(p_profile, x.id);

  -- 위반이 없으면 **원본을 그대로 돌려준다.** 재조립하면 키 순서·수치 표현이 미세하게 달라져
  -- 정직한 저장마다 불필요한 diff 가 생긴다.
  if array_length(v_bad, 1) is null then
    return p_new;
  end if;

  v_out := p_new;

  if v_out ? 'inventory' then
    v_out := jsonb_set(v_out, '{inventory}', public.reject_items_by_id(v_out->'inventory', v_bad));
  end if;

  if v_out ? 'stash' then
    v_out := jsonb_set(v_out, '{stash}', public.reject_items_by_id(v_out->'stash', v_bad));
  end if;

  if v_out ? 'ships' then
    v_out := jsonb_set(v_out, '{ships}', (
      select coalesce(jsonb_agg(
               case when t.sh ? 'equipped'
                 then jsonb_set(t.sh, '{equipped}',
                        public.reject_equipped_by_id(t.sh->'equipped', v_bad))
                 else t.sh
               end
               order by t.ord), '[]'::jsonb)
        from jsonb_array_elements(public.jsonb_arr_or_empty(v_out->'ships'))
             with ordinality as t(sh, ord)
    ));
  end if;

  if v_out ? 'guardians' then
    v_out := jsonb_set(v_out, '{guardians}', (
      select coalesce(jsonb_agg(
               case when jsonb_typeof(t.g->'build') = 'object' and (t.g->'build') ? 'equipped'
                 then jsonb_set(t.g, '{build,equipped}',
                        public.reject_equipped_by_id(t.g->'build'->'equipped', v_bad))
                 else t.g
               end
               order by t.ord), '[]'::jsonb)
        from jsonb_array_elements(public.jsonb_arr_or_empty(v_out->'guardians'))
             with ordinality as t(g, ord)
    ));
  end if;

  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. guard_profiles_client_write 개정 — 스칼라 12 + **save 봉인 1**
-- -----------------------------------------------------------------------------
-- ⚠️ **현행 정의(20260805000000_daily_reward.sql:180-198)에서 복사했다.** 스칼라 대입 12개를
--    한 줄도 빠뜨리지 않고 보존하고 `save` 봉인만 더한다 — 이 리포는 함수 재정의 때 앞 정의의
--    일부를 흘려 **PvE 정산을 100% 깨뜨린 전례**가 있다(20260802000000:4-15).
--    계약 테스트가 대입 **총수 12** 와 그 집합을 계속 단언한다.
-- ⚠️ 봉인은 `is_service_role()` 분기 **안**에 둔다 — definer RPC(배송·정산)는 원장 기록과
--    save 반영이 같은 트랜잭션에 있어, 서버 자신이 자기 배송을 위조로 보는 자기참조가 생긴다.
create or replace function public.guard_profiles_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.flagged := old.flagged;
    new.is_npc := old.is_npc;  -- Phase E: NPC 마커 위장 차단(20260717080000). M5 재정의에서도 유지.
    new.lineage_points := old.lineage_points;
    new.lineage_ship_level := old.lineage_ship_level;
    new.lineage_guardian_level := old.lineage_guardian_level;
    new.lineage_last_retired_at := old.lineage_last_retired_at;
    new.credits := old.credits;      -- ADR-0027: 재화 서버 권위(클라 UPDATE 봉인).
    new.minerals := old.minerals;    -- 소비/가산은 security definer RPC 만.
    new.catalyst_residue := old.catalyst_residue;  -- ADR-0042: 촉매 잔재도 서버 권위(RPC 만 write).
    new.daily_last_claim_seed := old.daily_last_claim_seed;  -- ADR-0048: 하루 여러 번 수령 차단.
    new.daily_streak := old.daily_streak;            -- ADR-0048: 30일차를 스스로 세우는 것 차단.
    new.lifetime_granted := old.lifetime_granted;    -- ADR-0048: 상한 유계의 앵커(유일한 안전장치).
    -- ADR-0050 §3 단계 1: 원장에 없는 아이템 id 의 **신규 등장**만 들어낸다(증가분 봉인).
    -- 프로필 id 는 **`old.id`** 를 쓴다 — `new.id` 를 쓰면 id 를 바꿔 보내는 요청이 남의
    -- 원장으로 조회를 돌릴 수 있다.
    new.save := public.seal_save_items(old.id, old.save, new.save);
  end if;
  return new;
end;
$$;
-- 트리거(trg_profiles_guard, before update)는 초기 스키마에서 이미 정의됨 — 함수 교체로 반영.

-- -----------------------------------------------------------------------------
-- 7. guard_profiles_client_insert 개정 — 0 강제 6 + **save 봉인 1**
-- -----------------------------------------------------------------------------
-- ⚠️ **INSERT 를 빠뜨리면 봉인이 통째로 우회된다.** 클라 저장 경로는 `upsert` 이고
--    (`src/net/dailyReward.ts:301`) 신규 행은 INSERT 로 들어간다 — UPDATE 봉인만 걸면
--    "프로필을 지우고 위조 세이브로 새로 INSERT" 가 열린다. RLS 는 소유권만 검사한다.
-- ⚠️ **현행 정의(20260805000000_daily_reward.sql:213-229)에서 복사했다.** 대입 6개 보존.
--    계약 테스트가 대입 **총수 6** 과 그 집합을 단언한다.
-- INSERT 는 OLD 가 없으므로 grandfather 집합이 **빈 집합**이다 — 즉 신규 프로필의 save 는
-- allowlist 만으로 통과해야 한다. 정상 신규 프로필은 `it-starter-{슬롯}` 뿐이라 통과한다
-- (`src/save/profile.ts:379`).
create or replace function public.guard_profiles_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.credits := 0;
    new.minerals := 0;
    new.catalyst_residue := 0;   -- ADR-0042: 신규 프로필의 촉매 잔재는 0.
    new.daily_last_claim_seed := 0;  -- ADR-0048: 미수령(센티넬 0).
    new.daily_streak := 0;           -- ADR-0048: 신규 프로필은 연속 0 에서 시작한다.
    new.lifetime_granted := 0;       -- ADR-0048: 앵커를 심고 시작하는 경로 차단.
    -- ADR-0050 §3 단계 1: OLD 가 없으므로 grandfather 집합은 빈 집합('{}'::jsonb).
    new.save := public.seal_save_items(new.id, '{}'::jsonb, new.save);
  end if;
  return new;
end;
$$;
-- 트리거(trg_profiles_guard_insert, before insert)는 20260726000000 에서 이미 정의됨.

-- -----------------------------------------------------------------------------
-- 8. items · ships RLS 축소 (부수 — ADR-0050 정정 1)
-- -----------------------------------------------------------------------------
-- ⚠️ **이것은 본체가 아니다.** ADR 초판은 이 두 테이블을 *"클라 rw 미러라 유니크를 직접 써
--    넣으면 그만"* 이라고 적었지만, 실측에서 **클라는 두 테이블을 읽지도 쓰지도 않는다**
--    (`src/**` 에 `.from('items')`·`.from('ships')` **각 0건** — 코드 주석 3곳이 이미 그 사실을
--    기록해 두었다: `src/save/itemPresence.ts:8` · `src/run/commissionGrantDelivery.ts:28` ·
--    `src/net/dailyReward.ts:24`). 즉 **아무것도 막지 못하는 문**이었고 본체는 §6·§7 이다.
--    그래도 잠근다 — 열려 있을 이유가 없고, 나중에 누가 배선하면 그때는 진짜 구멍이 된다.
--
-- `for all` → `for select` 로 좁힌다. 쓰기는 service_role 만 남는다(RLS 를 우회한다) — 복제
-- 약탈(20260726000000:435-461)이 방어자 items 를 읽어 공격자에게 복제 지급하는 경로가
-- 그것이라 **기능 손실이 없다.**
drop policy if exists items_rw_own on public.items;
drop policy if exists items_select_own on public.items;
create policy items_select_own
  on public.items for select
  to authenticated
  using (auth.uid() = profile_id);

drop policy if exists ships_rw_own on public.ships;
drop policy if exists ships_select_own on public.ships;
create policy ships_select_own
  on public.ships for select
  to authenticated
  using (auth.uid() = profile_id);
