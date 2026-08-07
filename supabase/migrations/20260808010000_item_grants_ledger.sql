-- =============================================================================
-- 아이템 서버 원장 + 서버 드랍 롤 — ADR-0050 §3 단계 1 본체
-- =============================================================================
--
-- ## 계약 — 「개수만 계약」 (사용자 승인)
--
-- 런 중에는 "회수 완료 N점"만 보이고 **개봉은 정산 때**다.
--
--   런 중:  바닥 전리품을 주움 → 클라는 **개수만** 센다 (시드를 모른다)
--   정산:   클라가 개수 N 을 주장
--           → 서버가 개연성 캡으로 N' ≤ N 로 깎고
--           → **자기 시드로** N' 번 굴려 원장에 적는다
--           → 클라가 배송받아 applied_at 을 찍는다
--
-- 위조 이득이 **"많이 주웠다고 우기기"** 하나로 축소되고, 그것을 캡이 유계한다
-- (ADR-0050 §4 — 목표는 차단이 아니라 유계).
--
-- ## ⭐ 시드 — 클라 입력이 한 바이트도 안 들어간다
--
--   drop_seed = hash(server_run_secret, run_id, drop_index)
--
-- ⛔ **클라 시드를 신뢰하는 안은 기각됐다**(ADR-0050 정정 2) — 아이템 id 가 곧 시드라
-- (`src/items/roll.ts:168` `it-${seed}`) 어떤 시드가 유니크를 내는지 **오프라인 전수 탐색이
-- 가능**하다. 이 함정을 다시 열지 마라.
--
-- ## ⭐ 서버는 클라를 재현하지 않는다 — 재현을 포기한다
--
-- 클라의 드랍 시드는 sim 상태의 함수다(`state.dropRng = rng.fork('drops')`, 엘리트 처치마다
-- RNG 소비 — `src/sim/drops.ts:300-333`). 즉 시드 열이 "몇 마리를 어떤 순서로 죽였는가"에
-- 종속이라 서버가 따라갈 수 없다. **그래서 따라가지 않는다** — 서버가 자기 시드로 새로 굴린다.
--
-- 그 덕분에 **mulberry32 를 plpgsql 로 옮길 필요가 없다.** 등급 판정에 필요한 것은 균등
-- 난수 하나뿐이고, 해시 출력 4바이트를 그대로 쓰면 된다.
--
-- ## 등급 분포 — TS 미러 (catalyst_defs 와 같은 규율)
--
-- 실측(`data/planets/index.ts`): **6행성이 세 base 값을 전부 공유한다**(ADR-0022 품질⟂종류
-- 직교 — 행성별 유니크 편차 금지). 그래서 미러는 행성별 표가 아니라 **상수 셋**이면 족하다.
-- 단계 보정 커브 둘만 함께 옮긴다.
--   · eliteUniqueBase 0.004 · eliteRareBase 0.25 · bossUniqueBase 0.02
--   · stageUniqueMult = stageQualityMult(stage, cap 4.0, k 25)
--   · stageRareMult   = stageQualityMult(stage, cap 2.8, k 20)
--   · stageQualityMult(s,cap,k) = s<=1 ? 1 : 1 + ((cap-1)*(s-1))/((s-1)+k)
-- ⚠️ TS 가 바뀌면 이 미러가 조용히 낡는다 — `tests/itemGrantsLedgerContract.test.ts` 가
--   두 쪽을 대조해 못박는다(촉매 미러가 겪은 드리프트의 재발 방지).
--
-- ## 저장 예산 (ADR-0050 §저장 예산, 사용자 승인)
--
-- payload 통째 저장은 1만 회원 × 250점 = 750MB 로 무료 티어 500MB 초과. 그래서
-- **(drop_seed, rarity, source) 3필드만** 적는다 — `rollItem` 이 순수하므로
-- (`src/items/roll.ts:123`, 실측: Math.random·Date 참조 0건) 클라·서버 어느 쪽이든 언제든
-- 같은 아이템으로 재확정한다. 평균 100점 기준 약 130MB(예산의 26%).
--
-- ## 담는 것
--   1. server_secrets — 시드 산식의 비밀(정책 0 · definer 만)
--   2. item_grants — 아이템 원장(배송함). commission_grants 형태를 본뜬다
--   3. drop_odds_mirror — 등급 분포 TS 미러
--   4. grant_run_drops(run_id, claimed_count) — 개수 캡 + 서버 롤 + 원장 기록
--   5. mark_item_grant_applied(grant_id) — 배송 확인(멱등)
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. server_secrets — 시드 산식의 비밀
-- -----------------------------------------------------------------------------
-- RLS 를 켜고 **정책을 하나도 만들지 않는다** → authenticated 는 select 조차 못 한다.
-- definer 함수(소유자 postgres)만 읽는다. catalyst_inventory 가 쓴 것과 같은 규율
-- (20260727000000:63-64) 이되 그쪽은 본인 select 를 허용하는 반면 이쪽은 **전면 차단**이다 —
-- 비밀이 새면 유니크를 내는 drop_index 를 오프라인으로 탐색할 수 있다.
create table if not exists public.server_secrets (
  key        text        primary key,
  secret     bytea       not null,
  created_at timestamptz not null default now()
);

alter table public.server_secrets enable row level security;
revoke all on table public.server_secrets from anon, authenticated;

-- 32바이트 난수 1회 시드. `on conflict do nothing` 이라 **재적용해도 비밀이 바뀌지 않는다** —
-- 바뀌면 이미 발급된 원장 행의 시드를 재확정할 수 없어 아이템이 통째로 달라진다.
insert into public.server_secrets (key, secret)
values ('drop_seed', public.gen_random_bytes(32))
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. item_grants — 아이템 원장(배송함)
-- -----------------------------------------------------------------------------
-- commission_grants(20260803000000:160-171) 형태를 본뜬다. 그쪽을 고른 이유는 키 구조다 —
-- daily_reward_claims 는 자연 복합 PK `(profile_id, date_seed)` 라 **하루 1행**뿐인데, 드랍은
-- 한 런에 여러 개다. `unique(run_id, drop_index)` 의 drop_index 가 commission 의 slot_index 에
-- 정확히 대응한다.
--
-- 컬럼이 payload 가 아니라 3필드인 이유는 위 §저장 예산.
create table if not exists public.item_grants (
  grant_id   uuid        primary key default public.gen_random_uuid(),
  profile_id uuid        not null references public.profiles(id) on delete cascade,
  run_id     uuid        not null references public.pve_runs(id) on delete cascade,
  drop_index integer     not null check (drop_index >= 0),
  -- rollItem 의 첫 인자. u32 라 bigint 로 담는다(integer 는 2^31 에서 넘친다).
  drop_seed  bigint      not null check (drop_seed >= 0 and drop_seed <= 4294967295),
  rarity     text        not null check (rarity in ('normal', 'magic', 'rare', 'unique')),
  -- rollItem 의 셋째 인자(planet·stage·levelCap). 값이 작아 jsonb 로 둔다.
  source     jsonb       not null default '{}'::jsonb,
  granted_at timestamptz not null default now(),
  applied_at timestamptz,
  -- 한 런의 같은 자리는 한 번만. 재호출이 아이템을 복제하지 못하게 하는 구조적 방어다.
  constraint item_grants_once unique (run_id, drop_index)
);

create index if not exists item_grants_profile_idx on public.item_grants (profile_id, granted_at desc);
-- 미배송 조회 축. 배송함 패턴의 관용구(20260805010000)와 같다.
create index if not exists item_grants_pending_idx
  on public.item_grants (profile_id) where applied_at is null;

alter table public.item_grants enable row level security;

-- 본인 것만 조회. **쓰기 정책은 만들지 않는다** — definer RPC 만 기록한다.
-- 이것이 "클라는 결과를 받을 뿐 무엇이 나올지 모른다"의 구조적 근거다.
drop policy if exists item_grants_select_own on public.item_grants;
create policy item_grants_select_own
  on public.item_grants for select
  to authenticated
  using (auth.uid() = profile_id);

-- -----------------------------------------------------------------------------
-- 3. drop_odds_mirror — 등급 분포 TS 미러
-- -----------------------------------------------------------------------------
-- 6행성이 값을 공유하므로 단일 행(key='default'). 행성별 편차가 생기면 그때 행을 늘린다.
create table if not exists public.drop_odds_mirror (
  key               text    primary key,
  elite_unique_base numeric not null,
  elite_rare_base   numeric not null,
  boss_unique_base  numeric not null,
  unique_cap        numeric not null,   -- stageUniqueMult 의 cap
  unique_k          numeric not null,   -- stageUniqueMult 의 k
  rare_cap          numeric not null,   -- stageRareMult 의 cap
  rare_k            numeric not null    -- stageRareMult 의 k
);

alter table public.drop_odds_mirror enable row level security;
-- 공개 카탈로그 정보라 조회는 무해하다(catalyst_defs 와 같은 판단, 20260727000000:87-88).
drop policy if exists drop_odds_mirror_select on public.drop_odds_mirror;
create policy drop_odds_mirror_select
  on public.drop_odds_mirror for select to authenticated using (true);

insert into public.drop_odds_mirror
  (key, elite_unique_base, elite_rare_base, boss_unique_base,
   unique_cap, unique_k, rare_cap, rare_k)
values ('default', 0.004, 0.25, 0.02, 4.0, 25, 2.8, 20)
on conflict (key) do update set
  elite_unique_base = excluded.elite_unique_base,
  elite_rare_base   = excluded.elite_rare_base,
  boss_unique_base  = excluded.boss_unique_base,
  unique_cap        = excluded.unique_cap,
  unique_k          = excluded.unique_k,
  rare_cap          = excluded.rare_cap,
  rare_k            = excluded.rare_k;

-- 단계 품질 보정 — TS `stageQualityMult`(src/sim/drops.ts:149-153)의 미러.
create or replace function public.stage_quality_mult(p_stage numeric, p_cap numeric, p_k numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_stage <= 1 then 1
              else 1 + ((p_cap - 1) * (p_stage - 1)) / ((p_stage - 1) + p_k) end;
$$;

-- -----------------------------------------------------------------------------
-- 4. grant_run_drops — 개수 캡 + 서버 롤 + 원장 기록
-- -----------------------------------------------------------------------------
-- 반환: { granted int, claimed int, clamped bool, throttled bool, grants [...] }
--
-- ## ⭐ 개수 캡의 분모 — 서버가 찍은 started_at
--
-- 20260808000000 이 만든 `pve_runs.started_at` 이 여기서 쓰인다. 캡의 분모는
-- `now() - started_at` = **클라가 못 만지는 경과 시간**이다. 클라가 주장하는 것은 개수뿐이고
-- 그 개수는 시간에 눌린다.
--
-- ⚠️ 이 분모를 클라 값(finalTick 등)으로 바꾸면 **캡이 즉시 장식이 된다** —
-- `settle_pve_run` 의 개연성 캡 ①항이 정확히 그 상태다(분모 finalTick 이 p_summary 에서 온다,
-- 20260802000000:88-90). 같은 실수를 반복하지 마라.
create or replace function public.grant_run_drops(
  p_run_id  uuid,
  p_claimed integer,
  p_planet  integer default null,
  p_stage   integer default null,
  p_level_cap integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 분당 개연 드랍 수. 실측 기대치는 런당 약 2.5(엘리트 1.5 + 보스 1 —
  -- TARGET_ELITE_DROPS_PER_RUN=1.5, src/sim/drops.ts:195)이고 런은 분 단위다. 촉매 드랍량
  -- 배율까지 얹혀도 분당 4 는 정직한 최상위 플레이어를 넉넉히 덮는다(ADR-0050 §4 "정직한
  -- 최상위 플레이어 수준으로 유계").
  PLAUS_DROPS_PER_MIN constant numeric := 4;
  -- 런 1회 절대 상한. 시간 축과 독립인 두 번째 천장(3중 캡 뼈대의 per-call 캡에 대응).
  CAP_DROPS_PER_RUN   constant integer := 24;
  v_me       uuid := auth.uid();
  v_started  timestamptz;
  v_elapsed  numeric;
  v_plaus    integer;
  v_grant    integer;
  v_existing integer;
  v_secret   bytea;
  v_odds     public.drop_odds_mirror%rowtype;
  v_uni      numeric;
  v_rare     numeric;
  v_r        numeric;
  v_seed     bigint;
  v_rarity   text;
  v_out      jsonb := '[]'::jsonb;
  v_id       uuid;
  i          integer;
begin
  if v_me is null then
    return jsonb_build_object('granted', 0, 'claimed', coalesce(p_claimed, 0),
                              'clamped', true, 'throttled', true, 'note', 'no-auth');
  end if;

  -- 본인·시작 등록된 런만. started_at is not null 이 곧 "begin_pve_run 을 거쳤다"는 증거다.
  -- for update 로 동시 호출 직렬화(같은 런에 두 번 굴리는 경합 차단).
  select started_at into v_started
    from public.pve_runs
    where id = p_run_id and profile_id = v_me and started_at is not null
    for update;
  if not found then
    return jsonb_build_object('granted', 0, 'claimed', coalesce(p_claimed, 0),
                              'clamped', true, 'throttled', true, 'note', 'no-run');
  end if;

  -- 이 런에 이미 발급했으면 재발급하지 않는다(멱등). unique 제약이 구조적 방어지만,
  -- 여기서 먼저 걸러야 부분 삽입 후 예외로 죽는 경로가 안 생긴다.
  select count(*) into v_existing from public.item_grants where run_id = p_run_id;
  if v_existing > 0 then
    return jsonb_build_object('granted', 0, 'claimed', coalesce(p_claimed, 0),
                              'clamped', true, 'throttled', false, 'note', 'already-granted');
  end if;

  v_elapsed := extract(epoch from (now() - v_started));
  v_plaus   := floor(greatest(0, v_elapsed) / 60.0 * PLAUS_DROPS_PER_MIN);

  -- 개수 = least(클라 주장, 시간 개연성, 런 절대 상한). settle_pve_run 의 3중 캡과 같은 형태다.
  v_grant := least(greatest(0, coalesce(p_claimed, 0)), v_plaus, CAP_DROPS_PER_RUN);

  if v_grant <= 0 then
    return jsonb_build_object('granted', 0, 'claimed', coalesce(p_claimed, 0),
                              'clamped', coalesce(p_claimed, 0) > 0, 'throttled', false,
                              'grants', '[]'::jsonb);
  end if;

  select secret into v_secret from public.server_secrets where key = 'drop_seed';
  if v_secret is null then
    -- 비밀이 없으면 시드를 만들 수 없다. 조용히 0 을 주는 대신 관측면에 남긴다.
    return jsonb_build_object('granted', 0, 'claimed', p_claimed, 'clamped', true,
                              'throttled', true, 'note', 'no-secret');
  end if;

  select * into v_odds from public.drop_odds_mirror where key = 'default';

  -- 등급 임계 — TS rollEliteDrop(src/sim/drops.ts:324-338)의 미러.
  v_uni  := v_odds.elite_unique_base
            * public.stage_quality_mult(coalesce(p_stage, 0), v_odds.unique_cap, v_odds.unique_k);
  v_rare := v_odds.elite_rare_base
            * public.stage_quality_mult(coalesce(p_stage, 0), v_odds.rare_cap, v_odds.rare_k);

  for i in 0 .. (v_grant - 1) loop
    -- ⭐ 시드 = hash(비밀, run_id, drop_index). 클라 입력이 한 바이트도 안 들어간다.
    --   sha256 앞 4바이트를 u32 로. drop_index 가 달라지면 전혀 다른 시드가 나온다.
    v_seed := ('x' || encode(
                 substring(public.digest(v_secret || p_run_id::text::bytea
                                         || i::text::bytea, 'sha256') from 1 for 4),
                 'hex'))::bit(32)::bigint;
    -- 등급 판정용 균등 난수는 **별도 도메인**에서 뽑는다 — 같은 해시를 시드와 등급에 겹쳐
    -- 쓰면 "시드를 보면 등급을 안다"가 되어 원장 조회만으로 유니크 자리를 역산할 수 있다.
    v_r := (('x' || encode(
              substring(public.digest(v_secret || p_run_id::text::bytea
                                      || i::text::bytea || 'rarity'::bytea, 'sha256')
                        from 1 for 4), 'hex'))::bit(32)::bigint)::numeric / 4294967296.0;

    -- TS 와 같은 순서·경계: r < unique → unique, r < unique+rare → rare, 아니면 magic.
    if v_r < v_uni then v_rarity := 'unique';
    elsif v_r < v_uni + v_rare then v_rarity := 'rare';
    else v_rarity := 'magic';
    end if;

    insert into public.item_grants (profile_id, run_id, drop_index, drop_seed, rarity, source)
    values (v_me, p_run_id, i, v_seed, v_rarity,
            jsonb_strip_nulls(jsonb_build_object(
              'planet', p_planet, 'stage', p_stage, 'levelCap', p_level_cap)))
    returning grant_id into v_id;

    v_out := v_out || jsonb_build_object(
      'grantId', v_id, 'dropIndex', i, 'dropSeed', v_seed, 'rarity', v_rarity);
  end loop;

  return jsonb_build_object(
    'granted', v_grant,
    'claimed', coalesce(p_claimed, 0),
    'clamped', v_grant < greatest(0, coalesce(p_claimed, 0)),
    'throttled', false,
    'grants', v_out);
end;
$$;

revoke all on function public.grant_run_drops(uuid, integer, integer, integer, integer) from public;
grant execute on function public.grant_run_drops(uuid, integer, integer, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. mark_item_grant_applied — 배송 확인(멱등)
-- -----------------------------------------------------------------------------
-- mark_commission_grant_applied(20260805010000:172-195)와 같은 형상 세 겹:
--   auth.uid() 로 수령자 **고정**(파라미터로 안 받는다) + profile_id 일치 + applied_at is null.
-- 0행 갱신도 오류가 아니라 멱등 성공이다 — 위조의 최선이 "자기 물건 포기"라 이득이 0.
create or replace function public.mark_item_grant_applied(p_grant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_updated integer;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'updated', 0, 'note', 'no-auth');
  end if;

  update public.item_grants
     set applied_at = now()
   where grant_id = p_grant_id
     and profile_id = v_me
     and applied_at is null;
  get diagnostics v_updated = row_count;

  return jsonb_build_object('ok', true, 'updated', v_updated);
end;
$$;

revoke all on function public.mark_item_grant_applied(uuid) from public;
grant execute on function public.mark_item_grant_applied(uuid) to authenticated;
