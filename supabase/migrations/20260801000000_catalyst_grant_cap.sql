-- =============================================================================
-- Planet Blitz — grant_catalyst 누적 캡 + 촉매 지급 원장 (ADR-0042 §Follow-ups ⓐ)
-- =============================================================================
-- 근거: docs/adr/0042-catalyst-shop-closed-residue-economy.md §Follow-ups ⓐ ·
--   20260731000000_catalyst_shop.sql §관측 회귀 경고(보안 리뷰 H-1) · ADR-0027(재화 서버 원장) ·
--   ADR-0026(3중 캡 방어 — 이 파일이 그 형상을 촉매 축에 이식한다).
--
--   이 파일은 20260727000000_catalyst_ledger.sql(catalyst_inventory·catalyst_defs·grant_catalyst)과
--   20260731000000_catalyst_shop.sql(salvage_catalyst·buy_catalyst 의 잠금 순서 규약)을 전제로
--   그 위에 촉매 **적립 축**의 캡·원장·플래깅을 얹는다.
--
-- ▮ 무엇을 고치는가
--   ADR-0042 가 salvage_catalyst 에서 grant_currency 를 떼면서, 촉매 축이 currency_grants 원장과
--   flagged 자동 플래깅에서 함께 빠졌다. 거기에 grant_catalyst 는 **클라가 직접 호출 가능**한데
--   상한이 per-call 100 하나뿐이라(20260727000000:172) 반복 호출로 촉매를 무제한 적립할 수 있었다.
--   즉 촉매 축의 상태가 **무캡 + 무원장 + 무플래깅**이었다. 이 파일이 셋을 동시에 복구한다.
--     · 무캡    → 1h·24h 누적 캡(초과분은 절삭. 예외가 아니라 클램프 — grant_currency 와 같은 규율).
--     · 무원장  → catalyst_grants 원장(누적 캡의 근거이자 사후 관측면). TTL GC 붙임.
--     · 무플래깅 → 극단 요청 시 profiles.flagged 세움.
--
--   "촉매 밖에서 가치 0" 은 **잔재에만** 참이고 촉매 자체에는 거짓이다 — 자원축 촉매(id 15~19,
--   31/34/37/40/43/46)는 consume_catalysts → settle_pve_run 경로에서 PvE 정산 캡을 실제로
--   상향한다(20260727000000:428-431). 그래서 촉매 적립은 재화 적립과 같은 등급의 방어가 필요하다.
--
-- ▮ 의미 정본 · 상수 placeholder(전부 // BALANCE — 출시 전 일괄 튜닝, defer-balance-tuning):
--     · CAP_GRANT_PER_CALL = 100 — **값을 바꾸지 않는다**(20260727000000:172 승계). 이 축의 결함은
--         per-call 값이 아니라 누적 캡의 부재였다. 값을 함께 흔들면 회귀 원인이 둘이 된다.
--     · PLAUSIBLE_RUNS_PER_HOUR = 60 — 정직한 플레이의 시간당 런 수 상한. 런 1분은 실측(2~5분)의
--         하한을 한참 밑도는 값이라 이미 관대하다.
--     · PLAUSIBLE_CATALYSTS_PER_RUN = 3 — 런당 촉매 드랍 상한. src/data/catalystDrops.ts 파생:
--         드랍 게이트는 **장비 드랍 시드마다** 굴리므로 기대 촉매 ≈ 장비 수 × chance 이고,
--         장비는 ADR-0035 로 2~3/런, 게이트 상한은 MAX_DROP_CHANCE_CP=9500(95%) →
--         3 × 0.95 = 2.85 → 올림 3.
--     · CAP_HEADROOM = 2 — 계측 오차·버스트 여유. 캡이 정직한 플레이를 막으면 그건 방어가 아니다.
--     · CAP_HOURLY_CATALYSTS = 60 × 3 × 2 = 360 — 현실적 정직 피크(20런/h × 2 = 40/h)의 9배다.
--     · CAP_DAILY_CATALYSTS  = 360 × 6 = 2160 — grant_currency 의 daily/hourly 비율(6)을 따른다.
--         24시간 내내 최고 속도는 불가하므로 6시간 상당을 하루 예산으로 둔다.
--     · FLAG_MULTIPLE = 10 — grant_currency 와 같은 값·같은 뜻(극단 초과만 잡는 성긴 신호).
--     · CATALYST_GRANTS_TTL = 48h — GC 보존 기간. **누적 창(24h)보다 커야 한다** — 같거나 작으면
--         GC 가 캡의 근거 행을 지워 캡이 스스로 열린다.
--   위 상수는 grant_catalyst DECLARE 에 constant 로 미러링돼 있다(배너=정본·DECLARE 미러 규율).
--
-- ▮ 왜 "서버가 정산 영수증에서 드랍을 파생" 이 아닌가 (검토 후 기각)
--   ADR-0042 자신의 논지가 "캡을 방어선으로 쓰는 설계는 이미 기운 설계" 이므로, 클라가 드랍량을
--   정하는 구조 자체를 없애는 길을 먼저 봤다. 결론은 **그 길이 신뢰 경계를 옮기지 못한다**:
--     · catalystDropsFromRun 의 입력은 **장비 드랍 시드**(LootRecord.seed)이고, 그 시드는 클라
--       sim 이 만든다. 서버는 그 값을 갖고 있지 않다. 파생을 SQL 로 옮겨도 서버는 결국 클라가
--       보낸 시드 배열을 믿어야 한다 — 위조 대상이 {id, qty} 에서 {seed[]} 로 이름만 바뀐다.
--     · 오히려 나빠진다. 시드 → 촉매 매핑(mix32)이 순수·결정론이므로, 공격자는 원하는 희귀
--       촉매가 나오는 시드를 오프라인에서 **탐색**해 보낼 수 있다. 무작위 적립이 표적 적립이 된다.
--     · 런 바인딩(settle 이 run_id 를 돌려주고 grant 가 그 런을 1회만 청구)도 함께 검토했다.
--       settle_pve_run 역시 클라 호출 가능이라 verified 행을 얼마든지 찍어낼 수 있으므로, 런
--       바인딩은 **그 자체로는 유계가 아니고** 결국 아래 누적 캡을 함께 요구한다. 누적 캡이
--       있으면 런 바인딩의 한계 이득은 "12장당 RPC 1회 더" 뿐인데, 대가로 settle 반환 계약과
--       클라 정산 경로를 건드린다. 비용 대비 이득이 맞지 않아 채택하지 않는다.
--   → 그래서 재화 축(ADR-0026/0027)이 이미 검증한 형상 — 누적 캡 + 원장 + 플래깅 — 을 그대로 쓴다.
--
-- ▮ 잠금 순서 규약(ABBA 데드락 방지 — 20260731000000 §잠금 순서 규약의 연장):
--     **catalyst_inventory → profiles 순으로만 잠근다.** grant_catalyst 는 종전에 profiles 를 전혀
--     잠그지 않았으나 이제 누적 캡 직렬화·flagged 를 위해 잠근다. 그래서 이 함수도 규약의 적용
--     대상이 되고, 계약 테스트의 잠금 순서 단언 대상이 salvage·buy 2종 → **3종**으로 늘어난다.
--     inventory 행을 profiles 보다 먼저 **확보·잠그는** 이유는 buy_catalyst ② 주석과 동일하다
--     (조건부 잠금은 행이 없을 때 락을 0개 잡아 실제 획득 순서를 역전시킨다).
--
-- ▮ 원장의 사각(정직하게 기록한다):
--     catalyst_grants 는 **실적립이 있을 때만** 행을 남긴다(grant_currency 와 같은 규율 — 0 적립
--     로그로 원장·GC 를 오염시키지 않기 위해). 그래서 "캡에 부딪혀 0 을 받아간 반복 호출" 은
--     원장에 흔적이 없다. 그 신호가 필요해지면 별도 카운터를 두어야 한다. requested 컬럼은 실적립
--     건의 절삭 폭까지는 보존한다(requested > qty = 그 호출이 캡에 걸렸다는 뜻).
--
-- ▮ no-profile 과 FK: catalyst_inventory.profile_id 는 profiles(id) FK 다. 프로필 행이 없으면
--     아래 ③ 의 행 확보 insert 가 FK 위반으로 예외를 내고 트랜잭션이 통째로 롤백된다(적립 0).
--     buy_catalyst 도 같은 형상이다 — no-profile 게이트는 그 뒤 잔액 null 처리를 위한 것이지
--     FK 를 대신하지 않는다.
--
-- 재실행 안전: create table if not exists · create index if not exists · drop policy if exists →
--   create · create or replace function · cron.schedule(잡명 upsert) · security definer +
--   set search_path='' + public. 한정 + 끝에 revoke/grant. 부분 실패 후 재적용 수렴.
--   ⚠️ search_path='' 함수에서 임시 테이블 금지(pg_temp 가 검색 경로에 없다 — 이 리포 실측 규율).
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- 1. catalyst_grants — 촉매 적립 원장 (누적 캡의 근거 · 사후 관측면)
-- -----------------------------------------------------------------------------
-- currency_grants(20260726000200)의 촉매판이다. 본인 select 만 — 쓰기 정책 부재로 클라 직접
-- 기록을 원천 차단하고, grant_catalyst(definer)만 기록한다. 원장을 위조할 수 있으면 누적 캡이
-- 그 위조로 열린다(원장이 캡의 유일한 근거라서).
create table if not exists public.catalyst_grants (
  -- id 표현은 currency_grants(20260726000200:57)를 그대로 따른다 — 시퀀스가 아니라 uuid 라
  -- search_path='' definer 안에서 nextval 검색 경로를 걱정할 일이 없다.
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  catalyst_id int         not null,
  -- 요청 수량(절삭 전). requested > qty 면 그 호출이 캡에 걸렸다는 뜻 — 관측용이고 캡 산정에는
  -- 쓰지 않는다(캡은 실적립 qty 합으로만 센다).
  requested   int         not null,
  qty         int         not null check (qty >= 0),
  created_at  timestamptz not null default now()
);

alter table public.catalyst_grants enable row level security;

-- 누적 캡 질의(profile_id + created_at 범위)의 인덱스. 이게 없으면 매 적립마다 풀스캔이다.
create index if not exists catalyst_grants_profile_time_idx
  on public.catalyst_grants (profile_id, created_at desc);

drop policy if exists catalyst_grants_select_own on public.catalyst_grants;
create policy catalyst_grants_select_own
  on public.catalyst_grants for select
  to authenticated
  using (auth.uid() = profile_id);

-- -----------------------------------------------------------------------------
-- 2. grant_catalyst 개정 — 누적 캡 + 원장 + 플래깅 (20260727000000:163 본문 기준)
-- -----------------------------------------------------------------------------
-- 시그니처 불변(int, int). 반환에 granted·clamped 를 **추가**한다(기존 catalyst_id·qty_after 보존
-- — 클라 CatalystGrantResult 소비 지점이 깨지지 않는다).
--
-- 거부가 아니라 **클램프**다: 캡에 걸리면 예외를 던지지 않고 남은 예산만큼만 적립한다. 정산 경로가
-- fire-and-forget(src/net/index.ts grantCatalystDrops — 실패를 삼키고 재시도 큐도 없다)이라,
-- 예외를 던지면 정직한 플레이어가 캡 근처에서 드랍을 통째로 잃는다.
create or replace function public.grant_catalyst(p_catalyst_id int, p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 캡 상수(placeholder — 파일 상단 배너가 의미 정본, 함께 갱신). // BALANCE
  CAP_GRANT_PER_CALL          constant int := 100;   -- 20260727000000:172 승계(값 불변).
  PLAUSIBLE_RUNS_PER_HOUR     constant int := 60;    -- 런 1분 하한(실측 2~5분) — 관대한 쪽.
  PLAUSIBLE_CATALYSTS_PER_RUN constant int := 3;     -- 장비 3 × 게이트 상한 0.95 = 2.85 → 올림.
  CAP_HEADROOM                constant int := 2;     -- 계측 오차·버스트 여유.
  CAP_HOURLY_CATALYSTS constant int :=
    PLAUSIBLE_RUNS_PER_HOUR * PLAUSIBLE_CATALYSTS_PER_RUN * CAP_HEADROOM;   -- = 360
  CAP_DAILY_CATALYSTS  constant int := CAP_HOURLY_CATALYSTS * 6;            -- = 2160
  FLAG_MULTIPLE        constant int := 10;

  v_me    uuid := auth.uid();
  v_want  int  := greatest(0, coalesce(p_qty, 0));   -- 요청량(음수·null 방어).
  v_call  int;                                       -- ① per-call 상한 적용분.
  v_1h    int  := 0;                                 -- ② 최근 1h 실적립 합.
  v_24h   int  := 0;                                 -- ② 최근 24h 실적립 합.
  v_rem   int;                                       -- ② 남은 예산.
  v_grant int;                                       -- 실적립량.
  v_after int;
  v_flag  boolean := false;
begin
  if v_me is null then
    raise exception 'grant_catalyst: 로그인 필요';
  end if;

  -- ① 카탈로그 게이트 — 미지 id 는 잠금 이전에 거부한다(유령 행 방지).
  if not exists (select 1 from public.catalyst_defs where catalyst_id = p_catalyst_id) then
    raise exception 'grant_catalyst: 미지 촉매 id %', p_catalyst_id;
  end if;

  -- ② 0 요청은 아무 자원도 만들지 않고 즉시 반환한다. 여기서 끊지 않으면 아래 ③ 이 qty=0 유령
  --    행을 남긴다(종전 본문은 upsert 로 그 행을 만들고 있었다).
  if v_want <= 0 then
    return jsonb_build_object(
      'catalyst_id', p_catalyst_id,
      'qty_after', coalesce((
        select qty from public.catalyst_inventory
         where profile_id = v_me and catalyst_id = p_catalyst_id
      ), 0),
      'granted', 0, 'clamped', false, 'note', 'nothing-to-grant'
    );
  end if;

  -- ③ 보유 원장 행을 **확보한 뒤** 잠근다. 잠금 순서 첫 번째 = catalyst_inventory.
  --    (조건부 잠금은 행 부재 시 락을 0개 잡아 profiles → inventory 로 순서가 역전된다 —
  --     buy_catalyst ② 주석과 같은 논증. 프로필 부재면 이 insert 가 FK 위반으로 롤백된다.)
  insert into public.catalyst_inventory (profile_id, catalyst_id, qty)
    values (v_me, p_catalyst_id, 0)
  on conflict (profile_id, catalyst_id) do nothing;

  perform 1
    from public.catalyst_inventory
    where profile_id = v_me and catalyst_id = p_catalyst_id
    for update;

  -- ④ 프로필 행 잠금 — 누적 캡 산정(원장 합산 → 가산)을 프로필 단위로 직렬화한다. 이 잠금이
  --    없으면 서로 다른 catalyst_id 로 동시에 들어온 두 호출이 같은 합계를 읽고 둘 다 적립해
  --    캡을 넘긴다(③ 의 잠금은 (profile, catalyst_id) 단위라 축이 다르면 안 겹친다).
  --    잠금 순서 두 번째 = profiles. ③ 앞으로 옮기면 salvage/buy 와 정면 ABBA 데드락이다.
  perform 1 from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object(
      'catalyst_id', p_catalyst_id, 'qty_after', 0,
      'granted', 0, 'clamped', true, 'note', 'no-profile'
    );
  end if;

  -- ⑤ 누적 캡 — 원장에서 최근 1h·24h 실적립 합을 읽어 남은 예산을 낸다.
  select coalesce(sum(qty), 0) into v_1h
    from public.catalyst_grants
    where profile_id = v_me and created_at > now() - interval '1 hour';
  select coalesce(sum(qty), 0) into v_24h
    from public.catalyst_grants
    where profile_id = v_me and created_at > now() - interval '24 hours';

  v_rem := least(
    greatest(0, CAP_HOURLY_CATALYSTS - v_1h),
    greatest(0, CAP_DAILY_CATALYSTS  - v_24h)
  );

  -- ⑥ 적립량 = per-call 캡 ∧ 남은 예산 ∧ 요청량.
  v_call  := least(v_want, CAP_GRANT_PER_CALL);
  v_grant := greatest(0, least(v_call, v_rem));

  -- ⑦ 극단 요청 플래깅 — **절삭 전 요청량**으로 판정한다(절삭 후로 보면 캡이 증거를 지운다).
  --    누적 캡 소진은 판정에서 제외한다(정직한 장시간 플레이도 닿을 수 있어 오탐이 된다) —
  --    grant_currency 가 v_ref 에서 ③ 누적 예산을 뺀 것과 같은 이유다.
  if v_want > FLAG_MULTIPLE * CAP_GRANT_PER_CALL then
    v_flag := true;
  end if;

  -- ⑧ 가산 + 원장 기록(실적립이 있을 때만 — 배너 §원장의 사각).
  if v_grant > 0 then
    update public.catalyst_inventory
      set qty = qty + v_grant
      where profile_id = v_me and catalyst_id = p_catalyst_id
      returning qty into v_after;

    insert into public.catalyst_grants (profile_id, catalyst_id, requested, qty)
      values (v_me, p_catalyst_id, v_want, v_grant);
  else
    select qty into v_after
      from public.catalyst_inventory
      where profile_id = v_me and catalyst_id = p_catalyst_id;
  end if;

  if v_flag then
    update public.profiles set flagged = true where id = v_me;
  end if;

  return jsonb_build_object(
    'catalyst_id', p_catalyst_id,
    'qty_after',   coalesce(v_after, 0),
    'granted',     v_grant,
    'clamped',     v_grant < v_want
  );
end;
$$;

revoke all on function public.grant_catalyst(int, int) from public;
revoke all on function public.grant_catalyst(int, int) from anon;
grant execute on function public.grant_catalyst(int, int) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. catalyst_grants GC cron — TTL 48h (누적 창 24h 보다 커야 한다)
-- -----------------------------------------------------------------------------
-- 원장은 캡의 근거이지 영구 기록이 아니다. 이 리포의 원장 계열은 전부 TTL/GC 를 갖는다
-- (currency_grants · invasion_replays · pve_runs). 읽는 주체 없이 무한히 자라는 테이블을
-- 만들지 않는다.
-- ⚠️ TTL(48h) < 누적 창(24h) 이 되면 GC 가 캡의 근거 행을 지워 캡이 스스로 열린다. 창을 늘릴
--    때는 이 TTL 을 **먼저** 늘려라.
do $$
begin
  perform cron.schedule(
    'planet-blitz-gc-catalyst-grants',
    '25 2 * * *',
    $c$ delete from public.catalyst_grants
          where created_at < now() - interval '48 hours'; $c$   -- TTL // BALANCE
  );
exception when others then
  null;  -- pg_cron 미설치·미등록 → 무시(다음 배포에서 수렴).
end $$;

-- =============================================================================
-- 4. 오브젝트 코멘트
-- =============================================================================
-- ⚠️ create or replace 는 코멘트를 덮지 않는다 — grant_catalyst 코멘트를 여기서 재선언하지
--   않으면 20260727000000 §10 의 옛 코멘트("적립 RPC")가 캡 없는 시절 설명으로 남는다.
comment on table public.catalyst_grants is
  '촉매 적립 원장(ADR-0042 Follow-up ⓐ). grant_catalyst 누적 캡(1h/24h)의 근거이자 관측면. 본인 select 만, definer RPC 만 write. TTL 48h GC.';
comment on column public.catalyst_grants.requested is
  '절삭 전 요청 수량. requested > qty 면 그 호출이 캡에 걸렸다는 뜻(관측용 — 캡 산정에는 qty 만 쓴다).';
comment on function public.grant_catalyst(int, int) is
  '촉매 드랍 적립(본인 원장 upsert). per-call 100 + 누적 1h 360 / 24h 2160 캡으로 클램프하고 catalyst_grants 에 기록, 극단 요청은 flagged. 반환 { catalyst_id, qty_after, granted, clamped }. user JWT.';

-- =============================================================================
-- 5. 검증 시나리오(리드용) — 실 Supabase 관통 (scripts/prove-catalyst-grant-cap.ps1 이 자동화)
-- =============================================================================
-- ⚠️ Management API 질의는 postgres 로 실행돼 is_service_role()=true 다. 그것만으로는 "가드가
--   있다" 까지만 보이고 "문다" 는 못 본다. 아래는 전부 `set local role authenticated` +
--   위조 jwt claims 로 **클라 컨텍스트에서** 태워야 의미가 있다.
-- ⚠️ RPC 호출과 상태 조회를 한 SELECT 에 넣지 마라 — 서브쿼리가 문장 시작 스냅샷을 봐서 RPC
--   반환값은 맞는데 상태만 변경 전 값을 읽는다(이 리포 실측).
--
-- ▮ G1. 누적 캡이 문다(핵심):
--   grant_catalyst(0, 100) 을 5회 연속 호출 → 1~3회는 100 씩 적립(누계 300), 4회차는 남은 60 만
--   적립(granted=60·clamped=true), 5회차는 granted=0·clamped=true.
--   inventory(0).qty 증가분 총합 = CAP_HOURLY_CATALYSTS = 360 에서 멈춘다.
--   ✅ 개정 전이라면 500 이 그대로 들어간다 — 이 값이 캡의 유무를 가르는 증인이다.
--
-- ▮ G2. 원장이 남는다: 위 호출 뒤 catalyst_grants 행 4건(5회차는 실적립 0이라 미기록),
--   sum(qty)=360, 4번째 행의 requested=100 · qty=60(절삭 폭 보존).
--
-- ▮ G3. 플래깅: grant_catalyst(0, 1001) → v_want > 10×100 이라 profiles.flagged=true.
--   (적립 자체는 per-call 100 으로 절삭된다.) 정상 요청(≤1000)은 flagged 를 세우지 않는다.
--
-- ▮ G4. 미지 id·0 요청: grant_catalyst(9999, 1) → 예외. grant_catalyst(0, 0) →
--   note='nothing-to-grant' 이고 catalyst_inventory 에 유령 행이 생기지 않는다.
--
-- ▮ G5. 잠금 순서: 계약 테스트(tests/catalystGrantCapContract.test.ts)가 본문의 for update
--   등장 순서를 inventory → profiles 로 단언한다. 역순이면 buy/salvage 와 정면 교착한다.
-- =============================================================================
