-- =============================================================================
-- 게스트 계정 시드 (2026-08-09)
-- =============================================================================
-- 게스트 로그인은 계정 없이 게임 전체를 보여 주는 입구다. 클라이언트 세이브 쪽은
-- `src/save/guestPreset.ts` 가 채우지만(레벨·장비·스킬·수호기·계보), **촉매·설계도·의뢰서·
-- 방어체·배치·순위는 서버 테이블이 정본**이라 세이브로 만들 수 없다. 이 RPC 가 그쪽을 채운다.
--
-- ## 가드 둘 (이 함수의 존재 이유이자 위험 표면 전부)
--  ① **익명 계정에만** 허용한다. 판정은 JWT 클레임이 아니라 `auth.users.is_anonymous` 로 한다
--     — 클레임도 Supabase 가 서명하지만, 권한을 여는 판정은 원본 테이블을 보는 편이 낫다.
--  ② **계정당 1회.** `guest_seeds` 의 PK 가 그 앵커다. 두 번째 호출은 아무것도 쓰지 않고
--     already-seeded 를 돌려준다(예외가 아니다 — 클라가 재시도해도 조용히 멱등이어야 한다).
--
-- ## 왜 catalyst_grants 에 안 적는가 — 캡을 건드리지 않기 위해
-- 사용자 결정(2026-08-09): "guest_seed 사유로 기록하되 획득 캡은 소모하지 않는다."
-- `catalyst_grants` 에 행을 넣으면 그것이 곧 누적 캡(1h 360 / 24h 2160)의 근거가 되어, 시드를
-- 받은 심사자가 **시작하자마자 드랍이 막힌다**. 그렇다고 캡 산식에 예외 조건을 끼우면
-- `grant_catalyst`·`grant_catalyst_for` 본문을 재정의해야 하는데, 그 재정의는 이 리포에서
-- 이미 grant 를 떨어뜨린 전적이 있다. 그래서 **정직한 경로의 SQL 을 한 줄도 건드리지 않고**,
-- 시드는 자기 원장(`guest_seeds`)에 남긴다 — 추적 가능성은 유지되고 캡 경로는 무변경이다.
--
-- ## 지급물은 "볼 수 있게" 가 기준이지 "세다" 가 아니다
-- 촉매 픽커가 비지 않을 만큼, 설계도 승급을 한 번 눌러 볼 만큼, 의뢰서 목록이 두 줄쯤.
-- 게스트가 구글 계정보다 유리해지는 것은 사용자가 감수하기로 한 트레이드오프다(기능 제한 없음).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. guest_seeds — 시드 원장 (1회성 앵커 + 무엇을 줬는지)
-- -----------------------------------------------------------------------------
create table if not exists public.guest_seeds (
  profile_id uuid        primary key references public.profiles(id) on delete cascade,
  seeded_at  timestamptz not null default now(),
  -- 무엇을 줬는지 요약(사후 관측용). 스키마를 고정하지 않는다 — 지급 구성은 튜닝 대상이다.
  summary    jsonb       not null
);

alter table public.guest_seeds enable row level security;

-- 읽기: 본인 행만. 쓰기 정책 **부재** → definer RPC 만 기록한다(다른 원장과 같은 규율).
drop policy if exists guest_seeds_select_own on public.guest_seeds;
create policy guest_seeds_select_own
  on public.guest_seeds for select
  to authenticated
  using (auth.uid() = profile_id);

-- -----------------------------------------------------------------------------
-- 2. seed_guest_account — 게스트 1회 시드
-- -----------------------------------------------------------------------------
create or replace function public.seed_guest_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 지급 구성(placeholder — 밸런스가 아니라 "화면이 비지 않는가" 기준). // BALANCE
  COMMON_CATALYSTS    constant int := 12;  -- 촉매 id 0..11(공용). 픽커가 채워진다.
  COMMON_QTY          constant int := 2;
  SIGNATURE_IDS       constant int[] := array[30, 36, 42];  -- 특산 3종(행성 소속 확인용).
  BLUEPRINT_COUNT     constant int := 3;   -- 종류×카탈로그 조합당 장수.
  UNIT_LEVEL          constant int := 30;
  DEFENSE_CORE_HP     constant int := 8000;

  v_me         uuid := auth.uid();
  v_anon       boolean;
  v_defense_id uuid;
  v_cid        uuid;
  v_rank       int;
  v_layout     jsonb;
  v_cat_rows   int := 0;
  v_bp_rows    int := 0;
  v_com_rows   int := 0;
  i            int;
  k            int;
begin
  if v_me is null then
    raise exception 'seed_guest_account: 로그인 필요';
  end if;

  -- ① 익명 계정인가. 구글 계정에 이 함수를 열면 그건 시드가 아니라 치트다.
  select u.is_anonymous into v_anon from auth.users u where u.id = v_me;
  if coalesce(v_anon, false) is not true then
    raise exception 'seed_guest_account: 게스트(익명) 계정에서만 호출할 수 있습니다';
  end if;

  -- ② 프로필 행이 먼저 있어야 한다. 클라가 세이브를 올린 뒤 부르는 계약이며, 없으면
  --    아래 insert 가 전부 FK 위반으로 터진다 — 그 전에 이유를 분명히 말하고 멈춘다.
  if not exists (select 1 from public.profiles p where p.id = v_me) then
    raise exception 'seed_guest_account: 프로필이 아직 없습니다(세이브 업로드 뒤 호출)';
  end if;

  -- ③ 1회성. 두 번째 호출은 조용히 멱등(클라가 재시도해도 지급이 늘지 않는다).
  if exists (select 1 from public.guest_seeds g where g.profile_id = v_me) then
    return jsonb_build_object('seeded', false, 'reason', 'already-seeded');
  end if;

  -- ④ 촉매 — 공용 12종 + 특산 3종. catalyst_defs 에 있는 id 만 넣는다(유령 행 방지).
  -- `do nothing` 으로 충분하다 — ③ 이 1회성을 이미 보장하므로 여기서 누적 갱신을 할 일이
  -- 없고, 혹시 행이 있다면 그건 시드가 아니라 플레이로 얻은 것이라 덮지 않는 편이 맞다.
  for i in 0 .. COMMON_CATALYSTS - 1 loop
    if exists (select 1 from public.catalyst_defs d where d.catalyst_id = i) then
      insert into public.catalyst_inventory (profile_id, catalyst_id, qty)
        values (v_me, i, COMMON_QTY)
        on conflict (profile_id, catalyst_id) do nothing;
      v_cat_rows := v_cat_rows + 1;
    end if;
  end loop;
  foreach i in array SIGNATURE_IDS loop
    if exists (select 1 from public.catalyst_defs d where d.catalyst_id = i) then
      insert into public.catalyst_inventory (profile_id, catalyst_id, qty)
        values (v_me, i, 1)
        on conflict (profile_id, catalyst_id) do nothing;
      v_cat_rows := v_cat_rows + 1;
    end if;
  end loop;

  -- ⑤ 설계도 — 4종류 × 카탈로그 0..2. 승급·제작을 실제로 눌러 볼 수 있는 최소 재고.
  for k in 0 .. 3 loop
    for i in 0 .. 2 loop
      insert into public.defense_blueprints (profile_id, kind, catalog_id, count)
        values (v_me, k, i, BLUEPRINT_COUNT)
        on conflict (profile_id, kind, catalog_id) do nothing;
      v_bp_rows := v_bp_rows + 1;
    end loop;
  end loop;

  -- ⑥ 방어체 — 종류마다 2기씩. `affix_seed` 는 uid 에서 결정론 파생한다(무작위를 쓰면 같은
  --    계정을 다시 시드할 때 다른 것이 나오는데, 1회성이라 재현할 방법이 없어진다).
  for k in 0 .. 3 loop
    for i in 0 .. 1 loop
      insert into public.defense_units (profile_id, kind, catalog_id, level, ascension, affix_seed, rarity)
        values (
          v_me, k, i, UNIT_LEVEL, 1,
          (('x' || substr(md5(v_me::text || k::text || i::text), 1, 8))::bit(32)::bigint) & 4294967295,
          case when i = 0 then 'rare' else 'magic' end
        );
    end loop;
  end loop;

  -- ⑦ 방어 배치 — L1 웨이브 6칸 · L2 소켓 12칸 중 앞 6칸 · L3 기물 3칸을 채운다.
  --    수호 슬롯은 비운다: 수호 배치는 퇴역 스냅샷을 통째로 담아야 하는데(InvasionGuardianPlacement),
  --    그 스냅샷의 정본은 클라 세이브에 있다. 여기서 흉내 내면 세이브와 어긋난 배치가 남는다 —
  --    게스트는 방어 사령부에서 자기 수호기 2기를 직접 배치하면 된다(그 경로는 이미 동작한다).
  --
  --    ⚠️ 슬롯 객체 형태(InvasionRef)는 `src/sim/invasion/types.ts` 가 정본이다:
  --       { catalogId, level, ascension, affixSeed, rarity } — 전부 정수.
  --    `empty_invasion_layers()` 위에 얹어 구조(레이어·슬롯 수)는 정본 함수가 정하게 한다.
  v_layout := public.empty_invasion_layers();
  -- ⚠️ `jsonb_agg` 에 **`order by` 가 없으면 슬롯 순서가 보장되지 않는다.** 슬롯 인덱스는
  --    SQL·EF·클라 3자가 비트 동일해야 하는 계약이라(고정 길이 + null 허용의 존재 이유),
  --    순서가 흔들리면 "가끔 다른 배치가 저장되는" 형태로 나타난다. 세 곳 모두 명시한다.
  v_layout := jsonb_set(v_layout, '{l1,waveSlots}', (
    select jsonb_agg(jsonb_build_object(
      'catalogId', s % 3, 'level', UNIT_LEVEL, 'ascension', 1,
      'affixSeed', (('x' || substr(md5(v_me::text || 'l1' || s::text), 1, 8))::bit(32)::bigint) & 4294967295,
      'rarity', 1) order by s)
    from generate_series(0, 5) s
  ));
  v_layout := jsonb_set(v_layout, '{l2,sockets}', (
    select jsonb_agg(case when s < 6 then jsonb_build_object(
      'catalogId', s % 3, 'level', UNIT_LEVEL, 'ascension', 0,
      'affixSeed', (('x' || substr(md5(v_me::text || 'l2' || s::text), 1, 8))::bit(32)::bigint) & 4294967295,
      'rarity', 1) else 'null'::jsonb end order by s)
    from generate_series(0, 11) s
  ));
  v_layout := jsonb_set(v_layout, '{l3,props}', (
    select jsonb_agg(case when s < 3 then jsonb_build_object(
      'catalogId', s % 3, 'level', UNIT_LEVEL, 'ascension', 0,
      'affixSeed', (('x' || substr(md5(v_me::text || 'l3' || s::text), 1, 8))::bit(32)::bigint) & 4294967295,
      'rarity', 1) else 'null'::jsonb end order by s)
    from generate_series(0, 5) s
  ));
  v_layout := jsonb_set(v_layout, '{l3,core}', jsonb_build_object('hp', DEFENSE_CORE_HP, 'x', 0, 'y', 0));

  -- 구조 검증을 **쓰기 전에** 한 번 더 통과시킨다. 트리거가 어차피 막지만, 여기서 걸리면
  -- 원인이 시드라는 것이 메시지에 그대로 남는다(트리거 예외는 어느 경로인지 안 알려준다).
  if not public.invasion_layers_valid(v_layout) then
    raise exception 'seed_guest_account: 생성한 배치가 3레이어 스키마를 위반했다(코드 결함)';
  end if;

  insert into public.defenses (profile_id, layout, active)
    values (v_me, v_layout, true)
    returning id into v_defense_id;

  -- ⑧ 순위표 진입 — 배치전을 건너뛰고 `placed = true` 로 넣는다(사용자 결정). 순위는 맨 끝
  --    번호를 받는다: 기존 랭커의 순위를 밀어내지 않아야 하고, `rank` 가 unique 라 빈 번호를
  --    찾는 것보다 끝에 붙이는 편이 경합에 강하다.
  select coalesce(max(l.rank), 0) + 1 into v_rank from public.ladder l;
  insert into public.ladder (profile_id, rank, defense_id, placed)
    values (v_me, v_rank, v_defense_id, true)
    on conflict (profile_id) do update
      set defense_id = excluded.defense_id, placed = true;

  -- ⑨ 의뢰서 2장.
  --    ⚠️ payload 형태의 정본은 `issue_commission_for_run`(20260808090000:280)이다. 여기서는
  --    같은 형태를 **결정론으로** 채운다(발령은 런 정산에 묶인 경로라 시드가 그것을 부를 수 없다).
  --    정본이 바뀌면 여기도 함께 고쳐야 한다 — `supabase/tests/guest_seed_verification.sql` 이
  --    두 형태의 키 집합을 대조해 이 의무를 잠근다.
  for i in 2 .. 3 loop
    v_cid := gen_random_uuid();
    insert into public.commission_inventory (commission_id, profile_id, grade, payload)
      values (v_cid, v_me, i, jsonb_build_object(
        'version', 1,
        'commissionId', v_cid::text,
        'grade', i,
        'order', (array['chain','constraint','bounty','elite'])[i],
        'segments', jsonb_build_array(
          jsonb_build_object('planet', 0, 'stage', 1),
          jsonb_build_object('planet', i - 1, 'stage', i - 1)
        ),
        'rewards', jsonb_build_object('credits', i * 2500, 'minerals', i * 2500, 'items', '[]'::jsonb),
        'replayBudgetTicks', 2 * 5400
      ));
    v_com_rows := v_com_rows + 1;
  end loop;

  -- ⑩ 원장 — 이 계정이 무엇을 어떻게 가졌는지 남긴다(캡은 소모하지 않는다).
  insert into public.guest_seeds (profile_id, summary)
    values (v_me, jsonb_build_object(
      'reason', 'guest_seed',
      'catalystRows', v_cat_rows,
      'blueprintRows', v_bp_rows,
      'defenseUnits', 8,
      'commissions', v_com_rows,
      'ladderRank', v_rank
    ));

  return jsonb_build_object(
    'seeded', true,
    'catalystRows', v_cat_rows,
    'blueprintRows', v_bp_rows,
    'commissions', v_com_rows,
    'ladderRank', v_rank,
    'defenseId', v_defense_id
  );
end;
$$;

-- ⚠️ `anon` 을 **따로** revoke 해야 한다. PUBLIC 만 걷어내면 `anon` 은 여전히 실행할 수 있다
--    (Supabase 가 public 스키마 신규 함수에 기본 권한을 준다). 실제로 이 마이그레이션의 첫
--    적용에서 검증 #3 이 `anon=True` 를 잡았다. 악용은 안 된다(anon JWT 는 auth.uid() 가 null
--    이라 첫 줄에서 예외) — 그래도 "쓸 수 있는 문이 열려 있다"를 남길 이유가 없다.
--    기존 RPC 들(20260801000000:250)과 같은 3줄 관용구를 그대로 쓴다.
revoke all on function public.seed_guest_account() from public;
revoke all on function public.seed_guest_account() from anon;
grant execute on function public.seed_guest_account() to authenticated, service_role;

comment on function public.seed_guest_account() is
  '게스트(익명) 계정 1회 시드 — 촉매·설계도·방어체·배치·순위·의뢰서. is_anonymous 계정만, 계정당 1회(guest_seeds PK). 획득 캡(catalyst_grants)은 소모하지 않는다. user JWT.';
comment on table public.guest_seeds is
  '게스트 시드 원장 — 1회성 앵커이자 무엇을 줬는지의 관측면. 쓰기는 seed_guest_account(definer) 전용.';
