-- =============================================================================
-- Planet Blitz — 촉매 원장 + 소모/드랍/분해 RPC + 자원 배율 정산 관통 (ADR-0029 · 이슈 B)
-- =============================================================================
-- 근거: ADR-0029(변칙 경보 폐지→촉매 시스템) · ADR-0027(재화 서버 원장 권위) ·
--   ADR-0026(PvE 리플레이 폐기, 3중 캡 방어) · .omc/plans/catalyst-system-plan.md Lane 3
--   (이슈 B: 촉매 자원 보상이 개연성 캡 포화 구간에서 절삭될 수 있으므로 서버 영수증으로
--   그 런의 자원 배율을 알아 바인딩 캡을 조건부 상향) · Lane 3 구현 가드레일 3항.
--
--   이 파일은 20260726000200_pve_settlement.sql(grant_currency·settle_pve_run·spend_currency)
--   과 20260726000300_pve_verification_teardown.sql(라이브 settle_pve_run — replay/client_result
--   제거 후 형상)을 전제로 그 위에 촉매 원장 계층을 얹는다. grant_currency 는 200 본문 기준으로,
--   settle_pve_run 은 **300 본문 기준으로** create-or-replace 개정한다(300 이 라이브 정의다).
--
-- 담는 것:
--   1. catalyst_inventory — 촉매 보유 원장(profile_id, catalyst_id, qty). 본인 select 만,
--      insert/update/delete 정책 부재 → 클라 직접 write 차단, 서버 RPC(definer)만 기록.
--   2. catalyst_defs — TS src/data/catalysts.ts 자원 배율·특산 소속 SQL 미러 시드(48행 upsert).
--   3. pve_runs.catalyst_receipt(jsonb) 컬럼 — consume 이 심는 서버측 영수증(자원 배율·주입 id).
--   4. grant_catalyst(catalyst_id, qty) — 엘리트·보스 드랍 적립 RPC.
--   5. consume_catalysts(catalyst_ids[], planet) — 시작 시 소모(핵심): 슬롯 상한·보유·특산-행성
--      정합 2차 검증 → 차감 → pending pve_runs 행 + 영수증 영속 → { run_id, resource_mult } 반환.
--   6. grant_currency 개정 — pve_run 한정으로 영수증 resourceMult 를 개연성 캡·per-call 캡 **둘 다**
--      의 정의 지점에 곱한다(가드레일 #1). v_ref 는 스케일된 캡을 상속해 FLAG 오탐을 막는다.
--   7. settle_pve_run 개정 — p_summary.runId 로 pending 행을 for update 조회, 서버 영수증 배율을
--      metrics 에 얹어 grant_currency 에 전달(클라 제출 resourceMult 무시), pending 을 verified 로
--      1회성 봉인(UPSERT-by-runId). runId 없거나 pending 부재/GC → 기존 무배율 base INSERT 경로.
--   8. salvage_catalyst(catalyst_id, qty) — 분해: 보유 차감 + grant_currency(salvage). 배율 미전달.
--   9. orphan pending GC cron — consume 후 크래시로 orphan 된 pending pve_runs 정리(TTL).
--
-- ▮ 캡·배율 상수 placeholder(전부 // BALANCE — 출시 전 일괄 튜닝, defer-balance-tuning):
--   기존 200 배너 목록(CAP_PVE_RUN_*·CAP_SALVAGE_*·CAP_STORY_*·CAP_DEFAULT_*·CAP_HOURLY_*·
--   CAP_DAILY_*·PLAUSIBILITY_*_PER_TICK·FLAG_MULTIPLE)에 더해, 이 파일이 추가하는 의미 정본:
--     · SLOT_CAP = 8 — 총 주입 수 하드 캡(src/data/catalysts.ts SLOT_CAP 미러). consume 이 강제.
--     · MAX_RESOURCE_PER_STACK = 0.15 — 자원축 촉매 장당 배율(catalysts.ts RESOURCE_PER_STACK 미러).
--     · CAP_RESOURCE_MULT_MAX = 1 + SLOT_CAP × MAX_RESOURCE_PER_STACK = 2.2 — 영수증 배율 유계 상한.
--         grant_currency 가 resourceMult 를 이 값으로 클램프한다(상한 인플레는 SLOT_CAP×perStack 유계).
--     · resourceMult(p_metrics 필드) — settle_pve_run 이 서버 영수증에서 얹는 그 런의 자원 배율.
--         grant_currency 는 p_source='pve_run' 일 때만 읽는다(salvage/story 는 미전달·미적용).
--     · SALVAGE_CREDITS_PER_UNIT — 촉매 1개 분해 환산 크레딧(salvage 캡 CAP_SALVAGE_CREDITS 가 상한).
--     · ORPHAN_PENDING_TTL — orphan pending pve_runs 정리 TTL(최대 정당 정산 지연보다 커야 함).
--   위 상수는 각 함수 DECLARE 에 constant 로 미러링돼 있다(배너=정본·DECLARE 미러 규율, 함께 갱신).
--
-- ▮ TS↔SQL 미러 동기화 의무(필독): catalyst_defs 시드(resource_mult·planet)는
--   src/data/catalysts.ts 의 CATALYST_RESOURCE_MIRROR(자원 배율)와 CATALYSTS[].planet(특산 소속)의
--   SQL 미러다. TS 정본이 바뀌면(자원축 추가/제거, RESOURCE_PER_STACK 튜닝, 특산 소속 변경) 이 시드도
--   **함께** 갱신해야 한다. 현재 자원축 11종(id 15,16,17,18,19,31,34,37,40,43,46) resource_mult=0.15,
--   나머지 0. 특산-행성 매핑: 30-32→0(카르곤), 33-35→1(베르단), 36-38→2(니플헤임), 39-41→3(아르케),
--   42-44→4(톡사르), 45-47→5(크라스). common(id<30)은 planet=null.
--
-- 재실행 안전: create table/index if not exists · drop policy if exists → create ·
--   create or replace function · add column if not exists · insert ... on conflict do update(멱등
--   upsert) · cron.schedule(잡명 upsert) · security definer + set search_path='' + public. 한정 +
--   끝에 revoke/grant. 부분 실패 후 재적용 수렴.
-- =============================================================================

-- gen_random_uuid()/pg_cron — 초기 스키마에서 이미 선언됐으나 단독 재적용 안전을 위해 재선언.
create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- 1. catalyst_inventory — 촉매 보유 원장 (본인 select 만, RPC 만 write)
-- -----------------------------------------------------------------------------
-- 촉매 보유 정본(ADR-0027 서버 원장). 클라이언트는 표시용 select 만 — insert/update/delete 정책
-- 부재로 클라 직접 기록·차감을 원천 차단하고, 서버 RPC(정의 소유자 postgres, RLS 우회)만 기록한다.
-- (grant_catalyst 적립 · consume_catalysts/salvage_catalyst 차감.)
create table if not exists public.catalyst_inventory (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  catalyst_id int  not null,
  qty         int  not null default 0 check (qty >= 0),
  primary key (profile_id, catalyst_id)
);

alter table public.catalyst_inventory enable row level security;

-- 읽기: 본인 원장만(픽커·관리 UI 표시용). 쓰기 정책 **부재** → 클라 직접 write 불가(원장 위조 차단).
drop policy if exists catalyst_inventory_select_own on public.catalyst_inventory;
create policy catalyst_inventory_select_own
  on public.catalyst_inventory for select
  to authenticated
  using (auth.uid() = profile_id);

-- -----------------------------------------------------------------------------
-- 2. catalyst_defs — TS 자원 배율·특산 소속 SQL 미러 시드 (48행)
-- -----------------------------------------------------------------------------
-- src/data/catalysts.ts 의 CATALYST_RESOURCE_MIRROR(자원축 장당 배율)와 CATALYSTS[].planet(특산
-- 소속)을 SQL 로 미러한다. settle_pve_run 이 resource_mult 로 그 런의 캡을 조건부 상향하고,
-- consume_catalysts 가 planet 으로 특산-행성 정합을 2차 검증한다. RLS: authenticated select 허용
-- (배율·소속은 공개 카탈로그 정보라 무해). 쓰기 정책 부재(시드/definer 만 갱신).
create table if not exists public.catalyst_defs (
  catalyst_id   int     primary key,
  resource_mult numeric not null default 0,   -- 자원축 장당 배율(자원축 아니면 0). TS 미러.
  planet        int                            -- 특산 소속 행성(0..5). common 은 null.
);

alter table public.catalyst_defs enable row level security;

drop policy if exists catalyst_defs_select_all on public.catalyst_defs;
create policy catalyst_defs_select_all
  on public.catalyst_defs for select
  to authenticated
  using (true);

-- 48행 시드(멱등 upsert). resource_mult: 자원축 11종만 0.15, 나머지 0. planet: signature(id>=30)만.
-- ⚠️ TS catalysts.ts 정본과 동기화 의무(파일 상단 배너). 값 하나라도 바뀌면 여기도 함께 갱신.
insert into public.catalyst_defs (catalyst_id, resource_mult, planet) values
  -- 공용 30종(id 0~29, planet null): 자원축(15~19)만 0.15, 나머지 0.
  (0, 0, null), (1, 0, null), (2, 0, null), (3, 0, null), (4, 0, null),
  (5, 0, null), (6, 0, null), (7, 0, null), (8, 0, null), (9, 0, null),
  (10, 0, null), (11, 0, null), (12, 0, null), (13, 0, null), (14, 0, null),
  (15, 0.15, null), (16, 0.15, null), (17, 0.15, null), (18, 0.15, null), (19, 0.15, null),
  (20, 0, null), (21, 0, null), (22, 0, null), (23, 0, null), (24, 0, null),
  (25, 0, null), (26, 0, null), (27, 0, null), (28, 0, null), (29, 0, null),
  -- 특산 18종(id 30~47): 각 행성 자원형(31,34,37,40,43,46)만 0.15. planet = 출신 행성.
  (30, 0, 0), (31, 0.15, 0), (32, 0, 0),           -- 카르곤(0)
  (33, 0, 1), (34, 0.15, 1), (35, 0, 1),           -- 베르단(1)
  (36, 0, 2), (37, 0.15, 2), (38, 0, 2),           -- 니플헤임(2)
  (39, 0, 3), (40, 0.15, 3), (41, 0, 3),           -- 아르케(3)
  (42, 0, 4), (43, 0.15, 4), (44, 0, 4),           -- 톡사르(4)
  (45, 0, 5), (46, 0.15, 5), (47, 0, 5)            -- 크라스(5)
on conflict (catalyst_id) do update
  set resource_mult = excluded.resource_mult,
      planet        = excluded.planet;

-- -----------------------------------------------------------------------------
-- 3. pve_runs.catalyst_receipt — consume 이 심는 서버측 영수증 (자원 배율·주입 id)
-- -----------------------------------------------------------------------------
-- consume_catalysts 가 pending 행 생성 시 { resourceMult, catalystIds } 를 심고, settle_pve_run 이
-- runId 로 이를 조회해 캡을 상향한다. 클라 제출 배율은 신뢰하지 않는다(서버 영속 = 위조 불가).
alter table public.pve_runs add column if not exists catalyst_receipt jsonb;

-- -----------------------------------------------------------------------------
-- 3b. guard_pve_runs_client_insert 재정의 — 클라 직접 insert 시 catalyst_receipt 봉인 (보안 HIGH)
-- -----------------------------------------------------------------------------
-- ⚠️ 20260718 의 guard 는 verified_* 3필드만 비우고, 이번에 추가된 catalyst_receipt 는 손대지 않았다.
-- pve_runs_insert_own 정책(20260718)이 클라(authenticated) 직접 insert 를 허용하므로, 클라가 PostgREST
-- 직타로 { "catalyst_receipt": {"resourceMult":2.2} } 를 심으면 guard 가 verified_status 만 'pending'
-- 으로 강제하고 영수증은 통과 → settle_pve_run 이 이를 '서버 영수증'으로 신뢰해 촉매 소모 없이 배율을
-- 얻는다(consume 의 슬롯상한·특산-행성·보유·클램프 전부 우회). 여기서 guard 를 재정의해 **클라 컨텍스트
-- (current_user=authenticated → is_service_role()=false)에서 catalyst_receipt 도 null 강제**한다.
-- consume_catalysts(SECURITY DEFINER, 소유자 postgres)의 insert 는 그 문장이 postgres 로 실행돼
-- is_service_role()=true → guard 스킵 → 영수증 정상 보존(트리거는 INVOKER 라 INSERT 문장의 역할을 상속).
create or replace function public.guard_pve_runs_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_service_role() then
    new.verified_status  := 'pending';
    new.verified_result  := null;
    new.verified_at      := null;
    new.catalyst_receipt := null;   -- ★ 영수증은 서버 RPC(consume_catalysts)만 심는다(클라 위조 차단).
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. grant_catalyst — 엘리트·보스 촉매 드랍 적립 (user JWT, SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- 호출자(auth.uid()) 본인 원장에 catalyst_id 를 p_qty(음수 방어) 만큼 적립(upsert). 미지 id 는 거부
-- (catalyst_defs 미존재). 반환 { catalyst_id, qty_after }. 클라 호출 배선은 Lane 4.
create or replace function public.grant_catalyst(p_catalyst_id int, p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 1회 적립 상한(드랍 1건의 합리적 상한) — 클라가 grant_catalyst 를 직접 대량 호출해 원장을 부풀리고
  -- salvage 로 현금화하는 것을 유계화한다(보안 MEDIUM-2). // BALANCE
  CAP_GRANT_PER_CALL constant int := 100;
  v_me    uuid := auth.uid();
  v_qty   int  := least(greatest(0, coalesce(p_qty, 0)), CAP_GRANT_PER_CALL);
  v_after int;
begin
  if v_me is null then
    raise exception 'grant_catalyst: 로그인 필요';
  end if;
  if not exists (select 1 from public.catalyst_defs where catalyst_id = p_catalyst_id) then
    raise exception 'grant_catalyst: 미지 촉매 id %', p_catalyst_id;
  end if;

  insert into public.catalyst_inventory (profile_id, catalyst_id, qty)
    values (v_me, p_catalyst_id, v_qty)
  on conflict (profile_id, catalyst_id) do update
    set qty = public.catalyst_inventory.qty + v_qty
  returning qty into v_after;

  return jsonb_build_object('catalyst_id', p_catalyst_id, 'qty_after', v_after);
end;
$$;

revoke all on function public.grant_catalyst(int, int) from public;
revoke all on function public.grant_catalyst(int, int) from anon;
grant execute on function public.grant_catalyst(int, int) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. consume_catalysts — 시작 시 소모 + pending 런 + 영수증 (user JWT, SECURITY DEFINER, 핵심)
-- -----------------------------------------------------------------------------
-- 호출자 본인이 p_catalyst_ids(중복=스택)를 p_planet 런에 주입한다. 검증→차감→pending 행+영수증.
--   (a) 슬롯 상한: 길이 ≤ SLOT_CAP(=8) 아니면 예외.
--   (b) 미지 id: catalyst_defs 미존재 id 포함 시 예외.
--   (c) 특산-행성 정합: signature(catalyst_id>=30 = catalyst_defs.planet not null)는 planet==p_planet
--       이어야 함(불일치 거부). 공용(<30, planet null)은 무관.
--   (d) 보유량: 각 id 요청 수량(스택) ≤ inventory.qty. inventory 행 for update 로 직렬화.
--   차감: 각 id 수량만큼 감소(부족·정합 실패 시 함수 트랜잭션 전체 롤백).
--   영수증: resource_mult = clamp(1 + Σ catalyst_defs.resource_mult × 스택수, [1, CAP_RESOURCE_MULT_MAX]).
--   pending pve_runs 행 생성(verified_status='pending', catalyst_receipt = {resourceMult, catalystIds}).
-- 반환 { run_id uuid, resource_mult numeric }.
create or replace function public.consume_catalysts(p_catalyst_ids int[], p_planet int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 캡 상수(placeholder — 파일 상단 배너가 의미 정본, 함께 갱신). // BALANCE
  SLOT_CAP               constant int     := 8;
  MAX_RESOURCE_PER_STACK constant numeric := 0.15;
  CAP_RESOURCE_MULT_MAX  constant numeric := 1 + SLOT_CAP * MAX_RESOURCE_PER_STACK;  -- =2.2 유계 상한.

  v_me           uuid := auth.uid();
  v_len          int;
  v_receipt_mult numeric;
  v_norm_ids     int[];
  v_run_id       uuid;
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

  -- (d) 보유 원장 행 잠금(요청 id 오름차순으로 잠가 동시 consume/salvage 데드락 회피).
  perform 1
    from public.catalyst_inventory
    where profile_id = v_me and catalyst_id = any(p_catalyst_ids)
    order by catalyst_id
    for update;

  -- 보유 부족 검출(요청 스택수 > 보유 qty). left join 으로 미보유(=0)도 부족으로 잡힌다.
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

  -- 차감(스택수만큼). qty>=0 check 가 검증 누락 시 음수를 이중 차단(constraint 위반→롤백).
  update public.catalyst_inventory as inv
    set qty = inv.qty - req.need
    from (
      select cid as catalyst_id, count(*)::int as need
      from unnest(p_catalyst_ids) as cid
      group by cid
    ) req
    where inv.profile_id = v_me and inv.catalyst_id = req.catalyst_id;

  -- 영수증 자원 배율 = 1 + Σ(resource_mult × 스택수), [1, CAP_RESOURCE_MULT_MAX] 클램프.
  select 1 + coalesce(sum(d.resource_mult * req.need), 0)
    into v_receipt_mult
    from (
      select cid as catalyst_id, count(*)::int as need
      from unnest(p_catalyst_ids) as cid
      group by cid
    ) req
    join public.catalyst_defs d on d.catalyst_id = req.catalyst_id;
  v_receipt_mult := least(greatest(1, v_receipt_mult), CAP_RESOURCE_MULT_MAX);

  -- 정규화 주입 배열(오름차순, 중복 보존) — 영수증 감사·재현용.
  select array_agg(cid order by cid) into v_norm_ids from unnest(p_catalyst_ids) as cid;

  -- pending pve_runs 행 생성(pve_runs_pending_idx 부분 인덱스와 정합). settle 이 runId 로 봉인.
  -- 이 함수는 SECURITY DEFINER(소유자 postgres)라 INSERT 문장이 postgres 로 실행돼 guard_pve_runs_
  -- client_insert 트리거의 is_service_role()=true → guard 스킵 → verified_status 와 catalyst_receipt
  -- 를 그대로 보존한다. 반대로 클라 직접 insert(authenticated)는 guard 가 catalyst_receipt 를 null 로
  -- 봉인하므로(위 3b), 서버 RPC 만 영수증을 심는다(위조 차단).
  insert into public.pve_runs (profile_id, verified_status, catalyst_receipt)
    values (
      v_me, 'pending',
      jsonb_build_object('resourceMult', v_receipt_mult, 'catalystIds', to_jsonb(v_norm_ids))
    )
    returning id into v_run_id;

  return jsonb_build_object('run_id', v_run_id, 'resource_mult', v_receipt_mult);
end;
$$;

revoke all on function public.consume_catalysts(int[], int) from public;
revoke all on function public.consume_catalysts(int[], int) from anon;
grant execute on function public.consume_catalysts(int[], int) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. grant_currency 개정 — pve_run 한정 자원 배율 주입 (200 본문 기준 create-or-replace)
-- -----------------------------------------------------------------------------
-- 200 본문과 동일하되, p_source='pve_run' 일 때만 p_metrics->>'resourceMult'(settle 이 서버 영수증
-- 에서 얹은 값)를 [1, CAP_RESOURCE_MULT_MAX] 로 클램프한 배율 m 을 **개연성 캡·per-call 캡 두 정의
-- 지점 모두**에 곱한다(가드레일 #1). least(claim, v_plaus, v_call, v_rem) 최소값 구조상 바인딩 캡을
-- 하나라도 안 올리면 절삭이 잔존하므로 둘 다 곱한다. v_rem(누적 예산)은 스케일 금지. v_ref 는 스케일된
-- 캡을 상속하므로 정직한 고배율 런의 claim=C×m 이 FLAG_MULTIPLE 오탐을 맞지 않는다.
-- salvage/story/기타는 v_res_mult=1(초기값·p_source 불일치로 미변경)이라 캡이 느슨해지지 않는다(가드레일 #2).
create or replace function public.grant_currency(
  p_credits  numeric,
  p_minerals numeric,
  p_source   text,
  p_metrics  jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 캡 상수(placeholder — 파일 상단 배너가 의미 정본, 함께 갱신). 출시 전 밸런스 튜닝 대상.
  CAP_PVE_RUN_CREDITS    constant numeric := 5000;
  CAP_PVE_RUN_MINERALS   constant numeric := 5000;
  CAP_SALVAGE_CREDITS    constant numeric := 20000;
  CAP_SALVAGE_MINERALS   constant numeric := 20000;
  CAP_STORY_CREDITS      constant numeric := 2000;
  CAP_DEFAULT_CREDITS    constant numeric := 1000;
  CAP_DEFAULT_MINERALS   constant numeric := 1000;
  CAP_HOURLY_CREDITS     constant numeric := 50000;
  CAP_HOURLY_MINERALS    constant numeric := 50000;
  CAP_DAILY_CREDITS      constant numeric := 300000;
  CAP_DAILY_MINERALS     constant numeric := 300000;
  PLAUSIBILITY_CREDITS_PER_TICK  constant numeric := 2.0;
  PLAUSIBILITY_MINERALS_PER_TICK constant numeric := 2.0;
  FLAG_MULTIPLE          constant numeric := 10;
  -- 촉매 자원 배율(pve_run 한정). SLOT_CAP·MAX_RESOURCE_PER_STACK 은 catalysts.ts 미러(배너 참조).
  SLOT_CAP               constant int     := 8;
  MAX_RESOURCE_PER_STACK constant numeric := 0.15;
  CAP_RESOURCE_MULT_MAX  constant numeric := 1 + SLOT_CAP * MAX_RESOURCE_PER_STACK;  -- =2.2 유계 상한.

  v_me            uuid := auth.uid();
  v_claim_credits   numeric;
  v_claim_minerals  numeric;
  v_final_tick    numeric := 0;
  v_stage         numeric := 0;
  v_res_mult        numeric := 1;   -- 촉매 자원 배율(pve_run 만; 나머지 source 는 1 유지).
  v_plaus_credits   numeric := null;   -- ① null = 비적용(비-pve_run) → least 에서 무시됨.
  v_plaus_minerals  numeric := null;
  v_call_credits    numeric;           -- ② per-call 상한.
  v_call_minerals   numeric;
  v_1h_credits    numeric := 0;        -- ③ 최근 1h 원장 합.
  v_1h_minerals   numeric := 0;
  v_24h_credits   numeric := 0;        -- ③ 최근 24h 원장 합.
  v_24h_minerals  numeric := 0;
  v_rem_credits     numeric;           -- ③ 남은 예산(1h·24h 잔여 중 작은 쪽). **스케일 금지.**
  v_rem_minerals    numeric;
  v_ref_credits     numeric;           -- 극단 초과 판정 기준(개연성·per-call 중 작은 유효 상한).
  v_ref_minerals    numeric;
  v_grant_credits   numeric;
  v_grant_minerals  numeric;
  v_credits_left    numeric := 0;
  v_minerals_left   numeric := 0;
  v_clamped       boolean := false;
  v_flag          boolean := false;
begin
  if v_me is null then
    raise exception 'grant_currency: 로그인 필요';
  end if;

  -- 주장액 정규화(음수·null 방어 — 재화 창조/차감 방향 오용 차단).
  v_claim_credits  := greatest(0, coalesce(p_credits, 0));
  v_claim_minerals := greatest(0, coalesce(p_minerals, 0));

  -- ① 개연성 캡: pve_run 만. finalTick·stage 로 상한 산정, 촉매 자원 배율 m 을 곱한다(가드레일 #1).
  --   비-pve_run 은 null 로 두어 미적용. m 은 pve_run 한정으로 [1, CAP_RESOURCE_MULT_MAX] 클램프.
  if p_source = 'pve_run' then
    v_final_tick := greatest(0, case
      when (p_metrics->>'finalTick') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_metrics->>'finalTick')::numeric else 0 end);
    v_stage := greatest(0, case
      when (p_metrics->>'stage') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_metrics->>'stage')::numeric else 0 end);
    -- resourceMult 는 settle_pve_run 이 set_config('app.in_settle','1',true) 로 표시한 정상 정산
    -- 경로에서만 읽는다(보안 MEDIUM-1). 클라가 grant_currency 를 직접(settle 우회) 불러 metrics 에
    -- resourceMult 를 실어도 플래그가 없어 무시된다(v_res_mult=1). grant_currency 는 SECURITY DEFINER
    -- 라 current_user=postgres 로 고정돼 is_service_role() 로는 직접호출/중첩호출을 구분할 수 없으므로,
    -- settle 이 세우는 트랜잭션-로컬 GUC 플래그로 정상 경로를 식별한다.
    if current_setting('app.in_settle', true) = '1'
       and (p_metrics->>'resourceMult') ~ '^-?[0-9]+(\.[0-9]+)?$' then
      v_res_mult := (p_metrics->>'resourceMult')::numeric;
    end if;
    v_res_mult := least(greatest(1, v_res_mult), CAP_RESOURCE_MULT_MAX);
    v_plaus_credits  := PLAUSIBILITY_CREDITS_PER_TICK  * v_final_tick * (1 + v_stage) * v_res_mult;
    v_plaus_minerals := PLAUSIBILITY_MINERALS_PER_TICK * v_final_tick * (1 + v_stage) * v_res_mult;
  end if;

  -- ② per-call 캡: source 별 1회 상한. pve_run 은 촉매 배율 m 을 곱해 개연성 캡과 함께 스케일한다
  --   (가드레일 #1 — 둘 중 하나만 올리면 least 절삭 잔존). 미등록 source 는 보수적 기본 상한.
  case p_source
    when 'pve_run' then
      v_call_credits  := CAP_PVE_RUN_CREDITS  * v_res_mult;
      v_call_minerals := CAP_PVE_RUN_MINERALS * v_res_mult;
    when 'salvage' then v_call_credits := CAP_SALVAGE_CREDITS; v_call_minerals := CAP_SALVAGE_MINERALS;
    when 'story'   then v_call_credits := CAP_STORY_CREDITS;   v_call_minerals := 0;  -- 사연은 크레딧만.
    else                v_call_credits := CAP_DEFAULT_CREDITS; v_call_minerals := CAP_DEFAULT_MINERALS;
  end case;

  -- 프로필 행 잠금(원장 합산→가산 직렬화). 없으면 지급 0 방어 반환.
  perform 1 from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object(
      'granted_credits', 0, 'granted_minerals', 0,
      'credits_left', 0, 'minerals_left', 0,
      'clamped', (v_claim_credits > 0 or v_claim_minerals > 0),
      'note', 'no-profile'
    );
  end if;

  -- ③ 누적 캡: 원장에서 최근 1h·24h 실지급 합 → 남은 예산(**촉매 배율로 스케일하지 않는다**).
  select coalesce(sum(credits), 0), coalesce(sum(minerals), 0)
    into v_1h_credits, v_1h_minerals
    from public.currency_grants
    where profile_id = v_me and created_at > now() - interval '1 hour';
  select coalesce(sum(credits), 0), coalesce(sum(minerals), 0)
    into v_24h_credits, v_24h_minerals
    from public.currency_grants
    where profile_id = v_me and created_at > now() - interval '24 hours';

  v_rem_credits := least(
    greatest(0, CAP_HOURLY_CREDITS - v_1h_credits),
    greatest(0, CAP_DAILY_CREDITS  - v_24h_credits)
  );
  v_rem_minerals := least(
    greatest(0, CAP_HOURLY_MINERALS - v_1h_minerals),
    greatest(0, CAP_DAILY_MINERALS  - v_24h_minerals)
  );

  -- 지급액 = 세 캡의 최소(least 는 NULL=비적용 개연성 캡을 무시). 음수 방어로 greatest(0, ..).
  v_grant_credits  := greatest(0, least(v_claim_credits,  v_plaus_credits,  v_call_credits,  v_rem_credits));
  v_grant_minerals := greatest(0, least(v_claim_minerals, v_plaus_minerals, v_call_minerals, v_rem_minerals));

  v_clamped := (v_grant_credits < v_claim_credits) or (v_grant_minerals < v_claim_minerals);

  -- 극단 초과 판정(계정 플래그). ③ 누적 예산은 제외하고 개연성·per-call 캡만 유효 기준으로 삼는다.
  -- 두 캡 모두 촉매 배율로 스케일됐으므로 v_ref 도 상속돼 정직한 고배율 런의 claim 을 오탐하지 않는다.
  v_ref_credits  := least(v_plaus_credits,  v_call_credits);   -- 비-pve → v_call_credits(널 무시).
  v_ref_minerals := least(v_plaus_minerals, v_call_minerals);
  if (v_ref_credits  > 0 and v_claim_credits  > FLAG_MULTIPLE * v_ref_credits)
     or (v_ref_minerals > 0 and v_claim_minerals > FLAG_MULTIPLE * v_ref_minerals)
     or (p_source = 'pve_run' and v_final_tick <= 0
         and (v_claim_credits > 0 or v_claim_minerals > 0)) then
    v_flag := true;
  end if;

  -- 가산 + (필요 시) 플래그. definer 라 guard 통과. RETURNING 으로 갱신 잔액 확보.
  update public.profiles
    set credits  = credits  + v_grant_credits,
        minerals = minerals + v_grant_minerals,
        flagged  = case when v_flag then true else flagged end
    where id = v_me
    returning credits, minerals into v_credits_left, v_minerals_left;

  -- 실지급이 있을 때만 원장 기록(0 가산 로그로 원장·GC 오염 방지). 누적 캡의 근거다.
  if v_grant_credits > 0 or v_grant_minerals > 0 then
    insert into public.currency_grants (profile_id, source, credits, minerals)
      values (v_me, p_source, v_grant_credits, v_grant_minerals);
  end if;

  return jsonb_build_object(
    'granted_credits',  v_grant_credits,
    'granted_minerals', v_grant_minerals,
    'credits_left',     v_credits_left,
    'minerals_left',    v_minerals_left,
    'clamped',          v_clamped
  );
end;
$$;

revoke all on function public.grant_currency(numeric, numeric, text, jsonb) from public;
revoke all on function public.grant_currency(numeric, numeric, text, jsonb) from anon;
grant execute on function public.grant_currency(numeric, numeric, text, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. settle_pve_run 개정 — runId 로 영수증 배율 관통 + 1회성 봉인 (300 본문 기준 create-or-replace)
-- -----------------------------------------------------------------------------
-- 300 본문(무배율 INSERT)을 기준으로 개정한다:
--   · p_summary->>'runId' 가 uuid 면 그 pending pve_runs 를 for update 조회(본인·pending 만). 서버
--     영수증(catalyst_receipt.resourceMult)을 얻어 grant_currency metrics 에 얹는다(클라 제출
--     resourceMult 는 제거해 위조 무력화).
--   · pending 존재 → grant 후 그 행을 verified 로 **UPDATE**(1회성 봉인 — 이미 verified 면 재조회 실패
--     → 배율 미적용). runId 없음/pending 부재/GC → 무배율 base 경로로 새 verified 행 INSERT(UPSERT-by-runId).
--   · resourceMult 는 pve_run 경로에만 얹는다(salvage/story 미전달 — 가드레일 #2).
create or replace function public.settle_pve_run(p_summary jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me             uuid := auth.uid();
  v_claim_credits  numeric;
  v_claim_minerals numeric;
  v_grant          jsonb;
  v_run_id         uuid;
  v_receipt_mult   numeric;
  v_metrics        jsonb;
begin
  if v_me is null then
    raise exception 'settle_pve_run: 로그인 필요';
  end if;

  -- 주장 자원 추출(비숫자/null 은 0). grant_currency 가 다시 정규화·캡하므로 1차 방어.
  v_claim_credits := case
    when (p_summary->>'resources') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (p_summary->>'resources')::numeric else 0 end;
  v_claim_minerals := case
    when (p_summary->>'minerals') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (p_summary->>'minerals')::numeric else 0 end;

  -- 클라가 심었을 수 있는 resourceMult 를 제거한다(서버 영수증만 신뢰 = 위조 방지). 무촉매/GC 경로는
  -- 이 제거로 배율이 실리지 않고 grant_currency 가 1 로 처리한다.
  v_metrics := p_summary - 'resourceMult';

  -- runId(uuid) 파싱. 형식 불일치는 무촉매 경로로 취급.
  v_run_id := case
    when (p_summary->>'runId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (p_summary->>'runId')::uuid else null end;

  if v_run_id is not null then
    -- pending 촉매 런 조회 + 잠금(본인·pending 만). 1회성 봉인: 이미 verified 면 not found → 무배율.
    select coalesce((catalyst_receipt->>'resourceMult')::numeric, 1)
      into v_receipt_mult
      from public.pve_runs
      where id = v_run_id and profile_id = v_me and verified_status = 'pending'
      for update;
    if found then
      -- 서버 영수증 배율을 metrics 에 얹는다(grant_currency 가 pve_run 캡에 관통 적용).
      v_metrics := v_metrics || jsonb_build_object('resourceMult', coalesce(v_receipt_mult, 1));
    else
      v_run_id := null;  -- pending 부재(GC/재사용/위조 runId) → 무배율 base 경로.
    end if;
  end if;

  -- 정상 정산 경로 표시(트랜잭션-로컬 GUC) — grant_currency 가 resourceMult 를 이 플래그가 있을 때만
  -- 읽어, 클라의 grant_currency 직접호출(settle 우회)로 배율을 얻는 경로를 차단한다(보안 MEDIUM-1).
  -- is_local=true 라 이 정산 트랜잭션 종료 시 자동 해제되고, 클라는 PostgREST 로 여러 RPC 를 한 트랜잭션에
  -- 묶을 수 없으므로 이 플래그는 settle 내부의 grant 호출에만 유효하다. 무촉매 런은 v_metrics 에
  -- resourceMult 가 없어(위에서 stripped·미재삽입) 플래그가 있어도 배율 미적용.
  perform set_config('app.in_settle', '1', true);

  -- 재화 지급(3중 캡 강제). 중첩 definer 호출에서도 auth.uid()=원 호출자라 본인에게 가산.
  v_grant := public.grant_currency(v_claim_credits, v_claim_minerals, 'pve_run', v_metrics);

  if v_run_id is not null then
    -- UPSERT-by-runId: pending 행을 verified 로 1회성 봉인(재사용 거부는 위 조회 게이트가 담당).
    update public.pve_runs
      set verified_status  = 'verified',
          verified_at      = now(),
          summary          = p_summary,
          credits_granted  = coalesce((v_grant->>'granted_credits')::numeric, 0),
          minerals_granted = coalesce((v_grant->>'granted_minerals')::numeric, 0)
      where id = v_run_id and profile_id = v_me and verified_status = 'pending';
  else
    -- 무촉매 런(runId 없음) 또는 pending 부재/GC → 기존 무배율 base 경로로 새 verified 행 INSERT.
    insert into public.pve_runs (
      profile_id, verified_status, verified_at,
      summary, credits_granted, minerals_granted
    )
    values (
      v_me, 'verified', now(),
      p_summary,
      coalesce((v_grant->>'granted_credits')::numeric, 0),
      coalesce((v_grant->>'granted_minerals')::numeric, 0)
    );
  end if;

  return v_grant || jsonb_build_object('settled', true);
end;
$$;

revoke all on function public.settle_pve_run(jsonb) from public;
revoke all on function public.settle_pve_run(jsonb) from anon;
grant execute on function public.settle_pve_run(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. salvage_catalyst — 촉매 분해 (user JWT, SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- 보유 확인·잠금·차감(부족 시 미차감 반환) 후 grant_currency(claim, 0, 'salvage') 지급. 분해 환산율
-- 은 서버 상수(placeholder)로 산정하고 salvage per-call 캡(CAP_SALVAGE_CREDITS)이 상한이다.
-- ⚠️ resourceMult 미전달 — salvage 캡이 촉매 자원 배율로 느슨해지지 않는다(가드레일 #2).
create or replace function public.salvage_catalyst(p_catalyst_id int, p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  SALVAGE_CREDITS_PER_UNIT constant numeric := 50;   -- 촉매 1개 분해 환산 크레딧. // BALANCE
  v_me    uuid := auth.uid();
  v_qty   int  := greatest(0, coalesce(p_qty, 0));
  v_have  int;
  v_grant jsonb;
begin
  if v_me is null then
    raise exception 'salvage_catalyst: 로그인 필요';
  end if;
  if v_qty <= 0 then
    return jsonb_build_object('ok', false, 'note', 'nothing-to-salvage');
  end if;

  -- 보유 확인·잠금(read-modify-write 직렬화).
  select qty into v_have
    from public.catalyst_inventory
    where profile_id = v_me and catalyst_id = p_catalyst_id
    for update;
  if not found or v_have < v_qty then
    return jsonb_build_object('ok', false, 'note', 'insufficient', 'have', coalesce(v_have, 0));
  end if;

  -- 차감(미차감 방어는 위 게이트가 담당). qty>=0 check 가 이중 안전.
  update public.catalyst_inventory
    set qty = qty - v_qty
    where profile_id = v_me and catalyst_id = p_catalyst_id;

  -- 지급(salvage 캡, resourceMult 미전달). minerals 0.
  v_grant := public.grant_currency(v_qty * SALVAGE_CREDITS_PER_UNIT, 0, 'salvage', null);

  return v_grant || jsonb_build_object(
    'ok', true, 'catalyst_id', p_catalyst_id, 'salvaged', v_qty
  );
end;
$$;

revoke all on function public.salvage_catalyst(int, int) from public;
revoke all on function public.salvage_catalyst(int, int) from anon;
grant execute on function public.salvage_catalyst(int, int) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. orphan pending GC cron — consume 후 크래시로 orphan 된 pending pve_runs 정리
-- -----------------------------------------------------------------------------
-- consume_catalysts 는 원장 차감을 확정하고 pending 행을 남긴다. 런이 크래시·미정산되면 그 pending
-- 행이 orphan 으로 남는다(원장 차감 = 아이템 소실은 ADR-0029 수용). TTL 은 최대 정당 정산 지연보다
-- 커야 한다(런 ~2분이므로 24h 넉넉 — placeholder). 기존 planet-blitz-gc-* cron 관례에 맞춰 별도 잡.
-- ⚠️ verified 행은 대상 아님(verified_status='pending' 만). 7일 GC(planet-blitz-gc-pve-runs)보다 먼저.
-- pg_cron 미설치 환경 방어를 위해 do/exception 로 멱등(cron.schedule 은 잡명 upsert).
do $$
begin
  perform cron.schedule(
    'planet-blitz-gc-orphan-pending-pve-runs',
    '15 2 * * *',
    $c$ delete from public.pve_runs
          where verified_status = 'pending'
            and created_at < now() - interval '24 hours'; $c$   -- TTL placeholder // BALANCE
  );
exception when others then
  null;  -- pg_cron 미설치·미등록 → 무시(다음 배포에서 수렴).
end $$;

-- =============================================================================
-- 10. 오브젝트 코멘트
-- =============================================================================
comment on table public.catalyst_inventory is
  '촉매 보유 원장(ADR-0027·0029). 본인 select 만, 서버 RPC(grant/consume/salvage)만 write. 클라 직접 write 차단.';
comment on table public.catalyst_defs is
  'TS src/data/catalysts.ts 자원 배율·특산 소속 SQL 미러 시드(48행). settle 배율·consume 특산정합 근거. 동기화 의무.';
comment on column public.pve_runs.catalyst_receipt is
  'consume_catalysts 서버측 영수증 { resourceMult, catalystIds }. settle_pve_run 이 runId 로 조회해 캡 상향(위조 불가).';
comment on function public.grant_catalyst(int, int) is
  '엘리트·보스 촉매 드랍 적립(본인 원장 upsert, 미지 id 거부). 반환 { catalyst_id, qty_after }. user JWT.';
comment on function public.consume_catalysts(int[], int) is
  '시작 시 소모: 슬롯상한·미지id·특산-행성정합·보유 검증 → 차감 → pending pve_runs+영수증. 반환 { run_id, resource_mult }. user JWT.';
comment on function public.salvage_catalyst(int, int) is
  '촉매 분해: 보유 차감 + grant_currency(salvage). resourceMult 미전달(가드레일 #2). 반환 grant + { ok, salvaged }. user JWT.';

-- =============================================================================
-- 11. 검증 시나리오(리드용) — 실 Supabase 관통 테스트 논증 (pgTAP/psql 수동 대체)
-- =============================================================================
-- 문법 자체는 psql/deno 파싱으로 검증. 아래는 리드가 실 Supabase 로 배율 관통·가드레일을 확증할
-- 고정 시나리오다(밸런스 placeholder 기준 — 튜닝 후 기대값 재산정).
--
-- ▮ S1. per-call 바인딩 케이스(가드레일 #1 핵심 — 개연성 여유는 크나 per-call 이 낮게 튜닝된 가정):
--   가정: PLAUSIBILITY_*_PER_TICK 를 크게(예: 10.0), CAP_PVE_RUN_CREDITS 를 낮게(예: 300) 튜닝한 상태.
--   준비: grant_catalyst(15, 8) 로 자원축 촉매 8개 적립.
--   ① consume_catalysts(ARRAY[15,15,15,15,15,15,15,15], 0)
--        → resource_mult = clamp(1 + 8×0.15, [1,2.2]) = 2.2, run_id=R 반환. inventory(15).qty=0.
--   ② settle_pve_run('{"runId":"R","resources":100000,"finalTick":1000,"stage":2}')
--        - 개연성 캡 = 10.0 × 1000 × (1+2) × 2.2 = 66,000 (여유 큼, 바인딩 아님).
--        - per-call 캡 = 300 × 2.2 = 660 (**바인딩 캡** — 이게 절삭선). 배율 없으면 300.
--        - 누적 캡(신규 계정) 여유. claim=100000.
--        - 기대 granted_credits = least(100000, 66000, 660, rem) = **660**.
--        ✅ 배율이 per-call 캡에 관통(300→660). 배율 주입을 개연성 캡에만 했다면 660 이 아니라 300 으로
--           절삭됐을 것 — 이 케이스가 "per-call 만 안 올리면 절삭 잔존" 결함을 잡는 고정 검증이다.
--   ③ settle 을 같은 runId 로 재호출 → pending 이 이미 verified 라 not found → 무배율 경로,
--        새 verified 행 INSERT + 배율 미적용(1회성 봉인 확인).
--
-- ▮ S2. 개연성 바인딩 케이스(반대 — per-call 여유, 개연성 낮음): finalTick 작게(예:10), stage 0.
--   개연성 캡 = 2.0 × 10 × 1 × 2.2 = 44; per-call = 5000×2.2 = 11000. 기대 = least(claim,44,11000,rem)=44.
--   배율을 per-call 에만 넣었다면 개연성 20 으로 절삭됐을 것 → 개연성 캡에도 곱해야 함을 확인.
--
-- ▮ S3. 특산-행성 정합 거부: grant_catalyst(31,1)(카르곤 자원형, planet=0) 후
--   consume_catalysts(ARRAY[31], 1) → 예외('특산 촉매를 출신 행성이 아닌 곳...'). inventory 불변.
--   consume_catalysts(ARRAY[31], 0) → 정상(planet 일치). 공용 15 는 임의 planet 허용.
--
-- ▮ S4. 가드레일 #2 — salvage/story 캡이 배율로 안 느슨해짐(단언):
--   salvage_catalyst(15, 8) → grant_currency(400, 0, 'salvage', null). resourceMult 미전달이라
--   CAP_SALVAGE_CREDITS(20000) 그대로. 설령 클라가 story/salvage summary 에 resourceMult 를 심어도
--   grant_currency 는 p_source='pve_run' 에서만 v_res_mult 를 읽으므로 salvage/story 캡 불변.
--   → story 경로: settle 아닌 story RPC 가 grant_currency(_, _, 'story', metrics) 를 부를 때 metrics 에
--     resourceMult 가 있어도 무시됨을 단언(v_res_mult=1 유지 → CAP_STORY_CREDITS 불변).
--
-- ▮ S5. 위조 방지 — 클라가 runId 없이 resourceMult 를 summary 에 심음:
--   settle_pve_run('{"resources":100000,"finalTick":1000,"stage":2,"resourceMult":2.2}')(runId 없음)
--   → v_metrics 에서 resourceMult 제거 → grant_currency 무배율(m=1). 배율 위조 무력화 확인.
--
-- ▮ S6. 보유 부족·슬롯 상한:
--   consume_catalysts(ARRAY[15,15], 0)(보유 1개뿐) → 예외('보유 부족'), inventory 불변.
--   consume_catalysts(9개 배열) → 예외('슬롯 상한(8) 초과').
--   consume_catalysts(ARRAY[999], 0)(미지 id) → 예외('미지 촉매 id 포함').
-- =============================================================================
