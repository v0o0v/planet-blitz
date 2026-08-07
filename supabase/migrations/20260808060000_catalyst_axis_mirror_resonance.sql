-- =============================================================================
-- 촉매 재작성 서버측 — 축별 미러 · 공명 표 · consume_catalysts 게이트 2종 신설
-- (ADR-0052 §귀결 "서버 마이그레이션 3건" 중 둘째·셋째)
-- =============================================================================
-- 20260807000000 이 상수 둘(SLOT_CAP 8→3, CAP_RESOURCE_MULT_MAX 파생식→리터럴)만 옮겼다.
-- 이 파일이 그 뒤를 잇는다 — 카탈로그 재작성(규칙 모델)이 서버에 도달하는 판이다.
--
-- ── 담는 것 ────────────────────────────────────────────────────────────────
--  (a) catalyst_defs 축별 미러  — cap_axis · cap_mult · tags 3칸 신설 + 48행 갱신
--  (b) catalyst_resonances      — RESONANCES 12행 SQL 미러(신설 테이블)
--  (c) catalyst_cap_resource_mult_max() — CAP_RESOURCE_MULT_MAX 의 **단일 선언 지점**
--  (d) consume_catalysts 재정의 — 게이트 (e)중복거부 (f)특산 최대 2장 + 합성식 영수증
--
-- ── 왜 새 파일인가 ─────────────────────────────────────────────────────────
-- 20260727000000 · 20260807000000 은 **이미 원격에 적용된** 파일이라 고치지 않는다(append-only).
-- catalyst_defs 는 컬럼 추가 + upsert 로, consume_catalysts 는 create or replace 로 덮는다.
--
-- ⚠️ **SLOT_CAP 은 3 이다.** 20260807000000 이 8→3 으로 내렸고 이 파일이 그 함수를 다시
--    덮으므로, 아래 선언이 **적용 순 마지막 판**이다. 8 로 되돌아가면 슬롯 상한이 통째로
--    무효가 된다.
--
-- ⚠️ **grant_currency_for 는 이 파일이 건드리지 않는다.** 그 함수의 유효 정의는 여전히
--    20260807000000:179 이고, 거기 220행의 `CAP_RESOURCE_MULT_MAX constant numeric := 2.2;`
--    는 **아직 리터럴**이다. tests/dailyRewardContract.test.ts:780 이 "유효 정의가
--    20260807000000 에 있다"를 드리프트 감지로 잠그고 있어, 이 레인이 그 함수를 다시 덮으면
--    해당 계약이 깨진다(그 파일은 이 레인 밖이다). 클램프를 상향할 때는 **두 자리를 같이**
--    움직여야 한다 — 아래 (c) 함수 본문과 20260807000000:220. 후속 레인이 grant_currency_for
--    를 재정의할 때 그 자리도 `public.catalyst_cap_resource_mult_max()` 호출로 바꾸면
--    선언 지점이 하나로 합쳐진다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (a) catalyst_defs — 축별 미러 3칸 신설
-- -----------------------------------------------------------------------------
-- 구 스키마는 `catalyst_id · resource_mult · planet` 3칸뿐이었다(20260727000000:89-93).
-- 규칙 모델에서는 촉매마다 **상한 축이 다르므로** 자원 한 축만으로는 미러가 성립하지 않는다.
--
-- ⚠️ `resource_mult` 는 **의미가 바뀌었다** — 구 값은 "장당 자원 배율 가산분"(0.15)이었고
--    지금은 **자원축 개별 상한**(예 2.6)이다. 자원축이 아니면 **1**(0 이 아니다 — 합성식이
--    `Σ(cap − 1)` 이라 중립원이 1 이다). 아래 시드가 48행 전부를 새 의미로 덮는다.
--    미러 정본: src/data/catalysts.ts CATALYST_RESOURCE_MIRROR.
--
-- `tags` 를 함께 미러하는 이유는 (d) 다 — consume_catalysts 가 주입 조합에서 **공명을 판정**
-- 해야 하고, 공명 판정의 입력이 태그 장수이기 때문이다. 태그가 서버에 없으면 판정을 클라
-- 제출값에 의존하게 되어 위조 가능해진다.
alter table public.catalyst_defs add column if not exists cap_axis text;
alter table public.catalyst_defs add column if not exists cap_mult numeric not null default 1;
alter table public.catalyst_defs add column if not exists tags     text[] not null default '{}'::text[];

-- 축 오타 방어. 미러 정본은 src/data/catalysts.ts CatalystCapAxis 다.
alter table public.catalyst_defs drop constraint if exists catalyst_defs_cap_axis_check;
alter table public.catalyst_defs add constraint catalyst_defs_cap_axis_check
  check (cap_axis is null or cap_axis in ('drop', 'resource', 'rarity', 'xp', 'catalystDrop'));

-- 48행 갱신(멱등 upsert). planet 은 건드리지 않는다 — 특산 소속은 재작성에서 불변이고,
-- 그 값의 계약(구매 가능성 세 술어)은 20260727000000 의 3열 시드가 계속 정본이다.
-- ⚠️ TS 정본과 동기화 의무 — tests/catalystAxisMirrorContract.test.ts 가 전수 대조한다.
--
-- ⚠️ **카탈로그 재태깅이 오면 이 블록을 재생성해야 한다.** 헌장 §태그쌍 4장 상한 위반
--    (`도박+수확` 9장 · `도박+정밀` 8장)으로 `def.tags` 값이 바뀔 예정이다. `id`·`cap`·`hook`·
--    `dropWeight` 는 불변이므로 바뀌는 칸은 이 시드의 `tags` 열 하나뿐이고, 위 계약 테스트가
--    갈림을 먼저 잡는다(그것이 이 테스트의 목적이다). **판정 로직은 손대지 마라** — 서버는
--    태그를 하드코딩하지 않고 이 컬럼에서 읽으므로, 시드만 다시 뜨면 (d)가 그대로 따라온다.
-- CATALYST_CAP_SEED_BEGIN
insert into public.catalyst_defs (catalyst_id, cap_axis, cap_mult, resource_mult, tags) values
  (0, 'drop', 2, 1, array['harvest','density']::text[]),
  (1, 'drop', 1.8, 1, array['gamble','ignite']::text[]),
  (2, 'xp', 2.2, 1, array['harvest','precision']::text[]),
  (3, 'resource', 2, 2, array['harvest','gamble']::text[]),
  (4, 'drop', 1.6, 1, array['harvest','ignite']::text[]),
  (5, 'rarity', 2, 1, array['gamble']::text[]),
  (6, 'rarity', 2.2, 1, array['gamble','density']::text[]),
  (7, 'rarity', 2, 1, array['precision','ignite']::text[]),
  (8, 'rarity', 1.8, 1, array['ignite','erosion']::text[]),
  (9, 'xp', 1.8, 1, array['gamble']::text[]),
  (10, 'xp', 2.6, 1, array['precision','gamble']::text[]),
  (11, 'xp', 1.8, 1, array['gamble']::text[]),
  (12, 'rarity', 2, 1, array['gamble','erosion']::text[]),
  (13, 'xp', 2.6, 1, array['precision']::text[]),
  (14, 'drop', 1.6, 1, array['precision']::text[]),
  (15, 'drop', 2.4, 1, array['harvest','gamble']::text[]),
  (16, 'resource', 1.8, 1.8, array['density','erosion']::text[]),
  (17, 'resource', 2.6, 2.6, array['density','gamble']::text[]),
  (18, 'resource', 1.8, 1.8, array['gamble']::text[]),
  (19, 'resource', 2.4, 2.4, array['harvest','ignite']::text[]),
  (20, 'drop', 2, 1, array['ignite','density']::text[]),
  (21, 'catalystDrop', 1.5, 1, array['gamble','harvest']::text[]),
  (22, 'drop', 2, 1, array['ignite','density']::text[]),
  (23, 'drop', 1.8, 1, array['harvest','erosion']::text[]),
  (24, 'xp', 2.5, 1, array['ignite','gamble']::text[]),
  (25, 'resource', 1.8, 1.8, array['precision','erosion']::text[]),
  (26, 'xp', 2, 1, array['precision']::text[]),
  (27, 'drop', 1.8, 1, array['precision','erosion']::text[]),
  (28, 'resource', 1.8, 1.8, array['precision','harvest']::text[]),
  (29, 'drop', 1.8, 1, array['precision','gamble']::text[]),
  (30, 'drop', 2, 1, array['density','erosion']::text[]),
  (31, 'drop', 2, 1, array['ignite','erosion']::text[]),
  (32, 'rarity', 2.2, 1, array['precision']::text[]),
  (33, 'catalystDrop', 1.5, 1, array['precision','harvest']::text[]),
  (34, 'resource', 2.4, 2.4, array['harvest']::text[]),
  (35, 'drop', 2.2, 1, array['density','harvest']::text[]),
  (36, 'resource', 2.2, 2.2, array['precision','gamble']::text[]),
  (37, 'rarity', 2, 1, array['harvest','precision']::text[]),
  (38, 'catalystDrop', 1.5, 1, array['gamble','erosion']::text[]),
  (39, 'resource', 2.2, 2.2, array['gamble']::text[]),
  (40, 'resource', 2.4, 2.4, array['harvest','gamble']::text[]),
  (41, 'rarity', 2.4, 1, array['precision','gamble']::text[]),
  (42, 'drop', 2.4, 1, array['erosion','harvest']::text[]),
  (43, 'drop', 2, 1, array['ignite','density']::text[]),
  (44, 'rarity', 2.6, 1, array['gamble']::text[]),
  (45, 'catalystDrop', 1.5, 1, array['harvest','density']::text[]),
  (46, 'xp', 2, 1, array['precision','erosion']::text[]),
  (47, 'rarity', 2.4, 1, array['ignite','erosion']::text[])
on conflict (catalyst_id) do update
  set cap_axis      = excluded.cap_axis,
      cap_mult      = excluded.cap_mult,
      resource_mult = excluded.resource_mult,
      tags          = excluded.tags;
-- CATALYST_CAP_SEED_END

-- -----------------------------------------------------------------------------
-- (b) catalyst_resonances — RESONANCES 12행 SQL 미러 (신설)
-- -----------------------------------------------------------------------------
-- 공명은 **거동과 상한을 동시에 바꾼다**. sim(src/sim/**)·검증 EF(verify-invasion·
-- verify-commission)·정산이 **같은 표를 읽지 않으면 재실행이 갈린다**(설계 감사표 §미해결 5).
-- 그래서 판정 규칙이 아니라 표 자체를 서버에 둔다.
-- 미러 정본: src/data/catalystResonance.ts RESONANCES.
-- RLS: authenticated select 허용(공개 카탈로그 정보라 무해). 쓰기 정책 부재(시드/definer 만).
create table if not exists public.catalyst_resonances (
  tag      text    not null,                 -- CatalystTag
  tier     text    not null,                 -- 'weak'(2장) | 'strong'(3장)
  slug     text    not null,                 -- i18n catalyst.resonance.<slug>.* 앵커
  cap_axis text    not null,                 -- 이 공명이 여는 축
  cap_mult numeric not null,                 -- 그 축의 개별 상한(자기 축의 합에 든다)
  hook     text    not null,                 -- 훅 예산 등급 A/B/C
  primary key (tag, tier),
  constraint catalyst_resonances_tier_check     check (tier in ('weak', 'strong')),
  constraint catalyst_resonances_cap_axis_check
    check (cap_axis in ('drop', 'resource', 'rarity', 'xp', 'catalystDrop'))
);

alter table public.catalyst_resonances enable row level security;

drop policy if exists catalyst_resonances_select_all on public.catalyst_resonances;
create policy catalyst_resonances_select_all
  on public.catalyst_resonances for select
  to authenticated
  using (true);

-- CATALYST_RESONANCE_SEED_BEGIN
insert into public.catalyst_resonances (tag, tier, slug, cap_axis, cap_mult, hook) values
  ('ignite', 'weak', 'ember', 'drop', 1.2, 'B'),
  ('ignite', 'strong', 'reverberation', 'resource', 2, 'A'),
  ('density', 'weak', 'attraction', 'drop', 1.2, 'A'),
  ('density', 'strong', 'crossfire', 'drop', 1.5, 'A'),
  ('precision', 'weak', 'whetting', 'drop', 1.2, 'A'),
  ('precision', 'strong', 'deflection', 'drop', 1.5, 'B'),
  ('harvest', 'weak', 'snare', 'drop', 1.2, 'A'),
  ('harvest', 'strong', 'fruition', 'rarity', 1.8, 'A'),
  ('gamble', 'weak', 'advance', 'drop', 1.3, 'A'),
  ('gamble', 'strong', 'settlement', 'rarity', 2, 'A'),
  ('erosion', 'weak', 'abrasion', 'drop', 1.2, 'A'),
  ('erosion', 'strong', 'subsidence', 'drop', 2, 'A')
on conflict (tag, tier) do update
  set slug     = excluded.slug,
      cap_axis = excluded.cap_axis,
      cap_mult = excluded.cap_mult,
      hook     = excluded.hook;
-- CATALYST_RESONANCE_SEED_END

-- -----------------------------------------------------------------------------
-- (c) CAP_RESOURCE_MULT_MAX — 단일 선언 지점
-- -----------------------------------------------------------------------------
-- 이 상수는 캡이 아니라 **정산 클램프**다(20260807000000 상단 배너). 여러 함수가 같은 값을
-- 각자 리터럴로 적으면 상향할 때 한 곳이 남아 조용히 잘라낸다 — 그래서 함수 하나로 뽑는다.
--
-- ⚠️ **TODO(lane-f1): 전수 결과로 확정.** 값은 종전 유효값 2.2 를 그대로 옮긴 것이고 새
--    수치가 아니다. 규칙형 48종의 자원축 합성 상한(`1 + Σ(cap − 1) × 0.5`, 공명 포함)의
--    실제 최대치는 48C3 = 17,296 건 전수 스크립트(scripts/catalystCapSweep.ts)가 산출한다.
--    그 값이 2.2 보다 크면 **영수증 단계에서 실지급이 잘린다.** 상향은 아래 리터럴 한 줄만
--    바꾸면 되고, 같은 값이 20260807000000:220(grant_currency_for)에도 리터럴로 남아 있으므로
--    **두 자리를 같이** 옮겨야 한다(파일 상단 배너 참조).
create or replace function public.catalyst_cap_resource_mult_max()
returns numeric
language sql
immutable
set search_path = ''
as $$ select 2.2::numeric $$;

revoke all on function public.catalyst_cap_resource_mult_max() from public;
grant execute on function public.catalyst_cap_resource_mult_max() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- (d) consume_catalysts 재정의 — 게이트 6종 + 합성식 영수증
-- -----------------------------------------------------------------------------
-- 20260807000000:53 본문 기준. 게이트 (a)~(d)는 그대로 보존하고 (e)(f)를 신설하며,
-- 영수증 배율 산식만 합성식으로 교체한다.
--
-- ── 산식 교체 ──────────────────────────────────────────────────────────────
--   구: 1 + Σ(resource_mult × 스택수)          — "장당 가산분"의 단순 누적(스택 전제)
--   신: 1 + Σ(자원축 cap − 1) × CAP_COMPOSE_FACTOR   — 개별 상한의 체감 합성
-- 곱 합성은 채택 불가다(슬롯 3에서도 ×27). **공명이 자원축이면 그 상한도 같은 합에 든다**
-- (src/data/catalysts.ts axisCapMult 주석 §5 — 공명을 합 밖에 두면 클라와 서버가 갈린다).
-- 스택 개념은 (e) 중복 거부로 사라졌으므로 산식에 수량 항이 없다.
create or replace function public.consume_catalysts(p_catalyst_ids int[], p_planet int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 캡 상수 — src/data/catalysts.ts 미러.
  SLOT_CAP               constant int     := 3;   -- ⚠️ 8 로 되돌리지 마라(ADR-0052)
  SIGNATURE_CAP          constant int     := 2;
  CAP_COMPOSE_FACTOR     constant numeric := 0.5;
  -- 단일 선언 지점은 위 (c) 다 — 여기 리터럴을 다시 적지 않는다.
  CAP_RESOURCE_MULT_MAX  constant numeric := public.catalyst_cap_resource_mult_max();
  -- src/data/catalystResonance.ts RESONANCE_WEAK_COUNT / _STRONG_COUNT 미러.
  RESONANCE_WEAK_COUNT   constant int     := 2;
  RESONANCE_STRONG_COUNT constant int     := 3;
  -- CATALYST_TAG_PRIORITY_BEGIN
  TAG_PRIORITY constant text[] := array['ignite','density','precision','harvest','gamble','erosion'];
  -- CATALYST_TAG_PRIORITY_END

  v_me           uuid := auth.uid();
  v_len          int;
  v_distinct     int;
  v_sig          int;
  v_receipt_mult numeric;
  v_res_sum      numeric;
  v_norm_ids     int[];
  v_run_id       uuid;
  v_reso_slug    text;
  v_reso_axis    text;
  v_reso_mult    numeric;
begin
  if v_me is null then
    raise exception 'consume_catalysts: 로그인 필요';
  end if;

  -- (a) 슬롯 상한 — 빈/null 배열은 이 경로를 타지 않아야 한다(무촉매 런은 consume 을 부르지 않음).
  v_len := coalesce(array_length(p_catalyst_ids, 1), 0);
  if v_len = 0 then
    raise exception 'consume_catalysts: 주입할 촉매가 없습니다';
  end if;
  if v_len > SLOT_CAP then
    raise exception 'consume_catalysts: 슬롯 상한(%) 초과: %', SLOT_CAP, v_len;
  end if;

  -- (e) 중복 거부 — 유니크 주입(ADR-0052). 같은 촉매 2장은 규칙형에서 의미가 없고(조건부
  --     보상은 스택하지 않는다), 스택을 허용하면 합성식이 `Σ(cap−1)` 를 같은 카드로 두 번
  --     세어 상한 검산이 통째로 무효가 된다. 클라 짝은 src/data/catalystInject.ts 와
  --     normalizeCatalystArray(중복 제거)다.
  --     ⚠️ 클라가 접어서 보내므로 정상 경로에서는 도달하지 않는다. 그래서 **여기가 유일한 방어**다.
  select count(distinct cid)::int into v_distinct from unnest(p_catalyst_ids) as cid;
  if v_distinct <> v_len then
    raise exception 'consume_catalysts: 같은 촉매를 두 장 이상 주입할 수 없습니다';
  end if;

  -- (b) 미지 id — catalyst_defs 에 없는 id 가 하나라도 있으면 거부.
  if exists (
    select 1
    from (select distinct cid as catalyst_id from unnest(p_catalyst_ids) as cid) req
    left join public.catalyst_defs d on d.catalyst_id = req.catalyst_id
    where d.catalyst_id is null
  ) then
    raise exception 'consume_catalysts: 미지 촉매 id 포함';
  end if;

  -- (c) 특산-행성 정합 2차 검증 — signature(planet not null)는 출신 행성==p_planet 이어야 함.
  --     is distinct from 으로 p_planet null 도 안전 처리(특산은 항상 거부).
  if exists (
    select 1
    from (select distinct cid as catalyst_id from unnest(p_catalyst_ids) as cid) req
    join public.catalyst_defs d on d.catalyst_id = req.catalyst_id
    where d.planet is not null
      and d.planet is distinct from p_planet
  ) then
    raise exception 'consume_catalysts: 특산 촉매를 출신 행성이 아닌 곳(planet=%)에 주입할 수 없습니다', p_planet;
  end if;

  -- (f) 특산 최대 2장(SIGNATURE_CAP) — 3장 전부를 특산으로 채우면 그 행성의 지배 조합이
  --     고정되고 공용 카탈로그가 죽는다. 클라 짝은 isWithinSignatureCap 이다.
  select count(*)::int into v_sig
    from (select distinct cid as catalyst_id from unnest(p_catalyst_ids) as cid) req
    join public.catalyst_defs d on d.catalyst_id = req.catalyst_id
   where d.planet is not null;
  if v_sig > SIGNATURE_CAP then
    raise exception 'consume_catalysts: 특산 촉매 상한(%) 초과: %', SIGNATURE_CAP, v_sig;
  end if;

  -- (d) 보유 원장 행 잠금(요청 id 오름차순으로 잠가 동시 consume/salvage 데드락 회피).
  perform 1
    from public.catalyst_inventory
    where profile_id = v_me and catalyst_id = any(p_catalyst_ids)
    order by catalyst_id
    for update;

  -- 보유 부족 검출(요청 수 > 보유 qty). left join 으로 미보유(=0)도 부족으로 잡힌다.
  -- (e) 이후 need 는 항상 1 이지만, 형상을 유지해 게이트가 사라져도 이 단계가 홀로 성립하게 둔다.
  if exists (
    select 1
    from (
      select cid as catalyst_id, count(*)::int as need
      from unnest(p_catalyst_ids) as cid
      group by cid
    ) req
    left join public.catalyst_inventory inv
      on inv.profile_id = v_me and inv.catalyst_id = req.catalyst_id
    where coalesce(inv.qty, 0) < req.need
  ) then
    raise exception 'consume_catalysts: 촉매 보유 부족';
  end if;

  -- 차감. qty>=0 check 가 검증 누락 시 음수를 이중 차단(constraint 위반→롤백).
  update public.catalyst_inventory as inv
    set qty = inv.qty - req.need
    from (
      select cid as catalyst_id, count(*)::int as need
      from unnest(p_catalyst_ids) as cid
      group by cid
    ) req
    where inv.profile_id = v_me and inv.catalyst_id = req.catalyst_id;

  -- ── 공명 판정 ─────────────────────────────────────────────────────────────
  -- src/data/catalystResonance.ts resolveResonance 와 **정확히 같은 규칙**이어야 한다:
  --   · 태그 2장 = 약 / 3장 = 강 (한 촉매가 태그 2개면 두 태그 모두에 1씩)
  --   · 한 런에 발동하는 공명은 **하나뿐** (limit 1)
  --   · 강 우선 (order by tier)
  --   · 동급이면 태그 우선순위 TAG_PRIORITY 순
  -- 두 구현이 갈리면 클라 표시와 서버 상한이 다른 조합을 가리킨다.
  select r.slug, r.cap_axis, r.cap_mult
    into v_reso_slug, v_reso_axis, v_reso_mult
    from (
      select t.tag as tag, count(*)::int as n
      from (select distinct cid as catalyst_id from unnest(p_catalyst_ids) as cid) req
      join public.catalyst_defs d on d.catalyst_id = req.catalyst_id
      cross join lateral unnest(d.tags) as t(tag)
      group by t.tag
    ) tc
    join public.catalyst_resonances r on r.tag = tc.tag
   where tc.n >= case r.tier when 'strong' then RESONANCE_STRONG_COUNT else RESONANCE_WEAK_COUNT end
   order by case r.tier when 'strong' then 0 else 1 end,
            array_position(TAG_PRIORITY, r.tag)
   limit 1;

  -- ── 영수증 자원 배율 = 1 + Σ(자원축 개별상한 − 1) × CAP_COMPOSE_FACTOR ──────────
  -- [1, CAP_RESOURCE_MULT_MAX] 클램프. 공명이 자원축이면 그 상한도 같은 합에 든다.
  select coalesce(sum(d.cap_mult - 1), 0)
    into v_res_sum
    from (select distinct cid as catalyst_id from unnest(p_catalyst_ids) as cid) req
    join public.catalyst_defs d on d.catalyst_id = req.catalyst_id
   where d.cap_axis = 'resource';

  if v_reso_axis = 'resource' then
    v_res_sum := v_res_sum + (v_reso_mult - 1);
  end if;

  v_receipt_mult := 1 + v_res_sum * CAP_COMPOSE_FACTOR;
  v_receipt_mult := least(greatest(1, v_receipt_mult), CAP_RESOURCE_MULT_MAX);

  -- 정규화 주입 배열(오름차순) — 영수증 감사·재현용. (e) 이후 중복은 존재하지 않는다.
  select array_agg(distinct cid order by cid) into v_norm_ids from unnest(p_catalyst_ids) as cid;

  -- pending pve_runs 행 생성(pve_runs_pending_idx 부분 인덱스와 정합). settle 이 runId 로 봉인.
  -- 이 함수는 SECURITY DEFINER(소유자 postgres)라 INSERT 문장이 postgres 로 실행돼 guard_pve_runs_
  -- client_insert 트리거의 is_service_role()=true → guard 스킵 → verified_status 와 catalyst_receipt
  -- 를 그대로 보존한다. 반대로 클라 직접 insert(authenticated)는 guard 가 catalyst_receipt 를 null 로
  -- 봉인하므로, 서버 RPC 만 영수증을 심는다(위조 차단).
  --
  -- `resonance` 는 신설 칸이다(순수 가산). 검증 EF 가 재실행 시 같은 공명을 강제로 쓰게 하는
  -- 앵커다 — 없으면 EF 가 태그 판정을 자기 코드로 다시 해서 갈릴 수 있다.
  insert into public.pve_runs (profile_id, verified_status, catalyst_receipt)
    values (
      v_me, 'pending',
      jsonb_build_object(
        'resourceMult', v_receipt_mult,
        'catalystIds',  to_jsonb(v_norm_ids),
        'resonance',    to_jsonb(v_reso_slug)
      )
    )
    returning id into v_run_id;

  return jsonb_build_object(
    'run_id',        v_run_id,
    'resource_mult', v_receipt_mult,
    'resonance',     v_reso_slug
  );
end;
$$;

-- create or replace 는 기존 권한을 보존하지만, 원본과 같은 회수를 한 번 더 건다(멱등).
revoke all on function public.consume_catalysts(int[], int) from public;
revoke all on function public.consume_catalysts(int[], int) from anon;
grant execute on function public.consume_catalysts(int[], int) to authenticated, service_role;
