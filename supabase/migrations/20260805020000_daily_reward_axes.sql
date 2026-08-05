-- =============================================================================
-- 일일 보상 슬라이스 2 — 나머지 5축 지급 분기 (ADR-0048 · 계획 §C7)
-- =============================================================================
-- 계약 정본: `.omc/plans/daily-reward-implementation.md` §C7.
-- 계약 테스트: `tests/dailyRewardContract.test.ts` (이 파일과 20260805000000 을 함께 읽는다).
-- 적용: `scripts/apply-daily-reward-axes-migration.ps1` (규약: 마이그레이션당 하나, 같은 커밋).
--
-- 슬라이스 1 은 재화 축만 관통했고 `claim_daily_reward_for` 는 다른 축이 낙찰되면 EF 가
-- **501 로 막았다**. 이 마이그레이션이 남은 다섯을 채운다:
--
--   1. grant_catalyst_for  — 촉매 지급의 service_role 진입점(신설). 기존 grant_catalyst 는
--                            이것을 부르는 **얇은 래퍼**가 된다(본문이 한 곳에 남는다).
--   2. claim_daily_reward_for 개정 — 축 분기 6갈래(의뢰서 발령은 **인라인**이다).
--
-- ▮ **의뢰서를 나눠 주는 함수를 새로 만들지 않는다.** 초안은 `grant_commission_for` 를 만들었고
--    `tests/commissionLedgerContract.test.ts` §만들지 않은 것이 그것을 잡았다 —
--    *"restore_commission 과 grant_commission 이 존재하지 않는다 … 존재하지 않는 함수는 권한
--    실수로 노출될 수 없다."* 그 가드가 겨눈 것이 정확히 그 함수였으므로, 계약을 넓혀 통과
--    시키는 대신 함수를 없애고 3절 안에 인라인했다. 진입점은 service_role 전용인
--    `claim_daily_reward_for` 하나뿐이고 새 공격면이 0 이다.
--    아래 `drop function if exists` 가 **중간판을 적용했던 원격에서 그 함수를 되돌린다** —
--    없으면 revoke 만 걸린 채 영영 남는다(이 레인이 실제로 한 번 배포했다).
--
-- ▮ **왜 grant_catalyst 를 그대로 중첩 호출할 수 없었나.** 계획 §C7 은 *"기존 grant_catalyst 를
--    중첩 호출한다"* 로 적었는데, 그 함수는 수신자를 **`auth.uid()`** 에서 읽는다
--    (20260801000000:142). `claim_daily_reward_for` 는 EF 가 service_role 로 부르므로
--    `auth.uid()` 가 **null** 이고, 그대로 부르면 *"grant_catalyst: 로그인 필요"* 로 100%
--    실패한다 — 계약 테스트도 순수 함수 테스트도 못 보는 자리다(둘 다 SQL 을 실행하지 않는다).
--    그래서 `grant_currency` / `grant_currency_for` 가 이미 쓰는 2단 구조를 그대로 따른다:
--    **본문은 `_for` 하나에 있고** 기존 이름은 `auth.uid()` 를 넘기는 래퍼가 된다. 계획이
--    의도한 것(적립 캡을 우회하는 두 번째 경로를 만들지 않는다)은 그대로 지켜진다 — 캡·원장·
--    플래깅이 전부 그 한 본문 안에 있다.
--
-- ▮ **본문을 손으로 옮겨 적지 않았다.** 아래 `grant_catalyst_for` 본문은
--    20260801000000_catalyst_grant_cap.sql:125-248 을 **파일에서 잘라** 두 곳만 기계 치환한
--    것이다(시그니처 1줄 · `v_me` 대입 1줄). 낡은 본문 복제가 프로덕션을 100% 깨뜨린 전례
--    (20260802000000:4-15)를 피하는 규율이고, 20260803030000 이 같은 방식을 쓴 선례가 있다.
--    계약 테스트가 두 본문의 **캡 상수 전집합**을 대조해 드리프트를 잡는다.
--
-- ▮ 잠금 순서(ABBA — 위반은 단위 테스트·1바퀴 플레이·육안 무엇으로도 안 잡힌다):
--    **한 호출에 등장하는 인벤토리는 여전히 최대 1개다.** 축별 계약(20260805000000:48-61):
--      · 촉매 축   — `catalyst_inventory → profiles`. 그래서 `grant_currency_for`(곁들이
--                    크레딧)를 **`grant_catalyst_for` 뒤에** 부른다. 앞에서 부르면
--                    `profiles → catalyst_inventory` 가 되어 `buy_catalyst`·`salvage_catalyst`
--                    와 정확히 반대가 되고 **진짜 ABBA 가 열린다.**
--      · 코어 모듈 — 기존 행을 `for update` 로 **잠그지 않는다**(신규 insert 전용). 이 축은
--                    리포 안에 두 방향이 공존해(salvage_core_module vs apply_module_purchase)
--                    따를 단일 관례가 없다 — 잠그지 않는 것이 유일하게 안전한 선택이다.
--      · 설계도·의뢰서 — 자기 테이블 upsert/insert 뿐이고 `for update` 를 쓰지 않는다.
--      · 장비   — 서버 테이블을 아예 안 만진다(배송함 `item_payload` 에 적고 클라가 반영).
--    ⚠️ 계약 단언은 `for update` 문자열만 본다 — **다른 함수 본문의** 잠금은 시야 밖이다.
--    그래서 계약 테스트의 훑기 범위에 `grant_currency_for` 와 **`grant_catalyst_for` 를 함께**
--    넣는다(§C7 — 넣지 않으면 촉매 축의 잠금 순서 단언이 아무것도 안 보고 통과한다).
--
-- ▮ **`settle_pve_run` 본문을 건드리지 않는다.**
--
-- 재실행 안전: `create or replace function` 만 쓴다(새 테이블·컬럼이 없다) + 끝에 revoke/grant.
--   security definer + set search_path='' + 모든 참조를 `public.` 로 한정.
--
-- 롤백: `scripts/rollback-daily-reward-axes-migration.ps1`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. 중간판 되돌리기 — grant_commission_for 를 지운다
-- -----------------------------------------------------------------------------
-- 이 레인이 한 번 배포했던 함수다(§헤더). 계약 테스트가 그 존재 자체를 금지하므로 지운다.
-- `if exists` 라 처음 적용하는 환경에서는 무해한 no-op 이다.
drop function if exists public.grant_commission_for(uuid, int);

-- -----------------------------------------------------------------------------
-- 1. grant_catalyst_for — 촉매 적립의 service_role 진입점 (본문 정본)
-- -----------------------------------------------------------------------------
-- 아래 본문은 20260801000000_catalyst_grant_cap.sql:125-248 을 잘라 온 것이고, 바뀐 것은
-- **시그니처 1줄과 `v_me` 대입 1줄뿐**이다. per-call 캡(100) · 누적 캡(1h 360 / 24h 2160) ·
-- 원장 기록 · 극단 요청 플래깅 · 잠금 순서(`catalyst_inventory → profiles`)가 전부 그대로다.
--
-- ⚠️ `v_me` 라는 이름을 `v_recipient` 로 바꾸지 마라 — 이름을 바꾸면 치환이 1줄이 아니게 되고,
--    다음 사람이 두 본문을 대조할 때 diff 가 의미 없는 줄로 가득 찬다.
create or replace function public.grant_catalyst_for(p_recipient uuid, p_catalyst_id int, p_qty int)
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

  v_me    uuid := p_recipient;
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

-- 기존 이름은 **얇은 래퍼**가 된다. 시그니처(int, int)·반환 모양이 불변이므로 클라
-- `CatalystGrantResult` 소비 지점과 `grantCatalystDrops` 정산 경로가 그대로 돈다.
create or replace function public.grant_catalyst(p_catalyst_id int, p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'grant_catalyst: 로그인 필요';
  end if;
  return public.grant_catalyst_for(auth.uid(), p_catalyst_id, p_qty);
end;
$$;

revoke all on function public.grant_catalyst_for(uuid, int, int) from public;
revoke all on function public.grant_catalyst_for(uuid, int, int) from anon;
revoke all on function public.grant_catalyst_for(uuid, int, int) from authenticated;
grant execute on function public.grant_catalyst_for(uuid, int, int) to service_role;

revoke all on function public.grant_catalyst(int, int) from public;
revoke all on function public.grant_catalyst(int, int) from anon;
grant execute on function public.grant_catalyst(int, int) to authenticated, service_role;

comment on function public.grant_catalyst_for(uuid, int, int) is
  '촉매 적립 본문(ADR-0048 슬라이스 2). per-call 100 + 누적 1h 360 / 24h 2160 캡. 잠금 순서 catalyst_inventory -> profiles. service_role 전용 — 수신자를 인자로 받는다.';
comment on function public.grant_catalyst(int, int) is
  '촉매 드랍 적립(본인). grant_catalyst_for(auth.uid(), ...) 래퍼 — 캡·원장·플래깅 본문은 그쪽 하나에만 있다. user JWT.';

-- -----------------------------------------------------------------------------
-- 3. claim_daily_reward_for 개정 — 축 분기 6갈래
-- -----------------------------------------------------------------------------
-- 아래 본문은 20260805000000_daily_reward.sql:454-575 를 잘라 온 것이고, 더한 것은 축 분기
-- 하나(§지급)뿐이다. 예산 재적용·절삭·멱등·연속일 전이는 **한 글자도 안 바뀌었다.**
create or replace function public.claim_daily_reward_for(
  p_recipient    uuid,
  p_axis         text,
  p_value        numeric,
  p_result       jsonb,
  p_next_payload jsonb,
  p_item_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  DAILY_STREAK_CYCLE constant int     := 30;   -- BALANCE — 6절·TS 미러와 같은 값이어야 한다.
  DAILY_SIDE_CREDITS constant numeric := 500;  -- BALANCE — 곁들이 크레딧(주 보상과 별개).
  -- 의뢰서 축 미러: src/run/commissionServerConstants.ts ·
  -- 20260803030000_commission_segment_rebalance.sql. 계약 테스트가 두 곳을 대조한다.
  COMMISSION_STOCK_CAP constant int := 12;
  SEGMENT_TICK_CAP     constant int := 9000;
  PLANET_COUNT         constant int := 6;
  -- 2026-08-03 밴드 복구 레인: 계급별 구간 수 2/3/4/5 -> 전 계급 2(같은 파일 :132).
  COMMISSION_SEGMENTS  constant int := 2;
  v_now_seed  bigint;
  v_preview   jsonb;
  v_budget    numeric;
  v_streak    int;
  v_clamped   boolean;
  v_claim     numeric;   -- EF 가 주장한 가치(절삭 전).
  v_value     numeric;   -- 예산으로 깎은 가치(절삭 후).
  v_scale     numeric;   -- v_value / v_claim — 축 성분을 같은 비율로 깎는다.
  v_result    jsonb;
  v_inserted  int := 0;   -- get diagnostics row_count 는 정수다. boolean 에 대입하면 실패한다.
  v_existing  public.daily_reward_claims%rowtype;
  v_grant     jsonb;
  -- ── 슬라이스 2 가 더한 것 ──
  v_axis_value numeric;  -- 주 보상 하나의 가치(곁들이·보정분 제외). EF 가 실어 온다.
  v_count      int;      -- 나눌 수 있는 축(촉매·설계도)의 절삭 후 수량.
  v_axis       jsonb := '{}'::jsonb;   -- 축별 지급 결과(원장·응답의 관측면).
  v_cat        jsonb;   -- grant_catalyst_for 원반환(그 `granted` 는 수량이다 — 아래 주석).
  v_module     jsonb;
  -- 의뢰서 축 인라인 발령용(§만들지 않은 것 — 별도 함수를 만들지 않는다).
  v_com_grade  int;
  v_cnt        int;
  v_order      int;
  v_cid        uuid;
  v_segs       jsonb;
  i            int;
begin
  if p_recipient is null then
    return jsonb_build_object('ok', false, 'code', 'no-recipient');
  end if;

  v_now_seed := floor(extract(epoch from now()) / 86400)::bigint;

  v_preview := public.daily_reward_preview_for(p_recipient);
  if coalesce((v_preview->>'ok')::boolean, false) is not true then
    return v_preview;
  end if;
  v_budget  := coalesce((v_preview->>'budget')::numeric, 0);
  v_streak  := coalesce((v_preview->>'streak')::int, 1);
  v_clamped := coalesce((v_preview->>'clamped')::boolean, false);

  -- 예산 재적용. EF 주장액이 천장을 넘으면 조용히 넘기지 않고 **절삭하고 표시**한다.
  v_claim := greatest(0, coalesce(p_value, 0));
  v_value := least(v_claim, v_budget);
  if v_value < v_claim then
    v_clamped := true;
  end if;

  -- ⚠️ **절삭을 실지급까지 밀어 내려야 한다.** 초안은 깎은 값을 `v_result.value` 에만 넣고
  --    아래 grant 는 `p_result` 가 실어 온 credits/minerals 원값을 그대로 넘겼다. 그러면
  --    *"preview 반환값은 힌트이지 권위가 아니다"* 라는 TOCTOU 방어가 **표시상으로만** 성립하고
  --    실제 상한은 CAP_DAILY_REWARD_CREDITS(25,000) 하나뿐이 된다 — 상한 유계가 이 설계의
  --    유일한 안전장치인데 그 자리에서 새는 것이다. 그래서 축 성분을 **같은 비율로** 깎는다.
  --    비율로 깎는 이유: 재화 축은 크레딧·광물 두 성분이고 가치 환산이 `c + m * MINERAL_TO_CREDIT`
  --    이므로, 둘을 같은 비율로 줄이면 환산 가치도 정확히 그 비율이 된다(선형).
  v_scale := case when v_claim > 0 then v_value / v_claim else 1 end;
  v_result := coalesce(p_result, '{}'::jsonb) || jsonb_build_object(
    'value',    v_value,
    'axis',     p_axis,
    'credits',  floor(coalesce((p_result->>'credits')::numeric, 0) * v_scale),
    'minerals', floor(coalesce((p_result->>'minerals')::numeric, 0) * v_scale)
  );

  insert into public.daily_reward_claims
    (profile_id, date_seed, payload, result_payload, item_payload, clamped)
  values
    (p_recipient, v_now_seed, coalesce(p_next_payload, '{}'::jsonb), v_result, p_item_payload, v_clamped)
  on conflict (profile_id, date_seed) do nothing;
  get diagnostics v_inserted = row_count;

  -- ⚠️ `not v_inserted` 로 쓰지 마라 — `NOT <integer>` 는 파서가 거절하는데(argument of NOT
  --    must be type boolean) plpgsql 이 표현식을 **지연 준비**하므로 CREATE 는 통과하고
  --    **첫 호출에서 터진다.** 즉 마이그레이션 적용은 초록이고 수령만 100% 실패한다.
  if v_inserted = 0 then
    -- 이미 오늘 받았다. **지급도 연속일 갱신도 하지 않는다.**
    select * into v_existing
      from public.daily_reward_claims
     where profile_id = p_recipient and date_seed = v_now_seed;
    return jsonb_build_object(
      'ok', true, 'already', true, 'date_seed', v_now_seed,
      'result_payload', v_existing.result_payload,
      'next_payload',   v_existing.payload,
      'item_payload',   coalesce(v_existing.item_payload, 'null'::jsonb),
      'clamped',        v_existing.clamped
    );
  end if;

  -- 연속일 전이 — preview 가 계산한 값을 그대로 쓴다(산식이 두 곳에 살면 갈린다).
  -- ⚠️ 0 으로 리셋하지 않는다. 오늘 수령분이 이미 1일차이므로 끊김의 값은 1 이다(AC-8).
  update public.profiles
     set daily_last_claim_seed = v_now_seed,
         daily_streak = least(DAILY_STREAK_CYCLE, greatest(1, v_streak))
   where id = p_recipient;

  -- ══ 축별 지급 (슬라이스 2 · §C7) ═══════════════════════════════════════════
  --
  -- ⚠️ **잠금 순서** — 인벤토리를 잠그는 축은 촉매 하나뿐이고, 그 축의 `grant_catalyst_for`
  --    는 `catalyst_inventory → profiles` 로 잠근다. 그래서 아래 블록이 곁들이 크레딧의
  --    `grant_currency_for`(= `profiles for update`)보다 **먼저** 와야 한다. 순서를 뒤집으면
  --    `profiles → catalyst_inventory` 가 되어 `buy_catalyst`·`salvage_catalyst` 와 정확히
  --    반대가 되고 **진짜 ABBA 가 열린다.** 이 한 줄의 위치가 계약이며, 계약 테스트가
  --    `grant_catalyst_for(` 와 `grant_currency_for(` 의 **문자 위치**를 비교해 잠근다.
  --
  -- ⚠️ **한 호출에 등장하는 인벤토리는 여전히 1개다** — `p_axis` 가 배타 분기라 촉매 축이면
  --    다른 어느 테이블도 안 만진다.
  --
  -- ── 절삭을 축 성분까지 밀어 내리는 방법이 축의 나눌 수 있음에 따라 갈린다 ──
  --  · **나눌 수 있는 축**(촉매·설계도) — 수량을 `v_scale` 로 깎는다. 재화의 credits/minerals
  --    와 같은 취급이다. 0 으로 깎이면 그 축은 아무것도 주지 않고 그 사실을 원장에 남긴다.
  --  · **나눌 수 없는 축**(코어 모듈·장비·의뢰서) — 반 개가 없다. 그래서 *"절삭 후 예산이
  --    그 하나의 가치를 감당하는가"* 로 전부-아니면-전무를 판정한다(`v_axis_value`).
  --    감당 못 하면 주지 않는다 — **상한 유계가 이 설계의 유일한 안전장치**라 여기서
  --    "조금 넘지만 그냥 주자"를 한 번 허용하면 그 안전장치가 사문화된다.
  --
  -- 정상 경로에서는 절삭이 애초에 없다: 낙찰이 `value <= budget` 으로 걸렀고, 그때 쓴 예산은
  -- preview 값이며, **하루 안에서 예산은 단조 증가**한다(램프는 연속일 고정 → 불변, 천장은
  -- `lifetime_granted × 계수`인데 그 앵커가 단조 증가). 그래서 claim 이 다시 잰 예산은 EF 가
  -- 본 것 이상이고, 절삭이 일어났다면 그것은 TOCTOU 가 아니라 **EF 의 결함**이다 — 그 사실이
  -- `clamped` 로 기록되어야 한다.
  v_axis_value := greatest(0, coalesce((p_result->>'axis_value')::numeric, 0));

  if p_axis = 'catalyst' then
    -- 촉매는 `grant_catalyst_for` 를 **중첩 호출**한다. 직접 `catalyst_inventory` 를 쓰면
    -- 적립 캡(20260801000000)을 우회하는 두 번째 경로가 생겨 ADR-0048 의 *"재화·촉매는 기존
    -- 누적 캡 원장을 통과한다"* 가 깨진다.
    v_count := greatest(0, floor(coalesce((p_result->>'count')::numeric, 0) * v_scale))::int;
    if v_count > 0 then
      v_cat := public.grant_catalyst_for(
        p_recipient, coalesce((p_result->>'catalyst_id')::int, -1), v_count);
      -- ⚠️ **`grant_catalyst_for` 의 `granted` 는 boolean 이 아니라 적립 수량이다**(그 함수의
      --    기존 계약이고 클라 `CatalystGrantResult` 가 그렇게 읽는다). 그대로 실으면
      --    `axis_grant.granted` 가 축마다 다른 뜻이 되어, 그 필드를 보는 화면·하네스·실증
      --    스크립트가 촉매 축에서만 조용히 틀린다. 그래서 여기서 boolean 으로 접고 수량은
      --    `qty` 로 옮긴다 — 원래 필드(`qty_after`·`clamped`)는 그대로 남는다.
      v_axis := v_cat || jsonb_build_object(
        'granted', coalesce((v_cat->>'granted')::int, 0) > 0,
        'qty',     coalesce((v_cat->>'granted')::int, 0));
    else
      v_axis := jsonb_build_object('granted', false, 'reason', 'clamped-to-zero');
    end if;

  elsif p_axis = 'blueprint' then
    -- 중복 설계도는 (kind, catalog_id) 당 1행에 장수를 센다. upsert 라 `for update` 가 없다 —
    -- `on conflict do update` 가 잠그는 행은 계약의 정적 시야 밖이지만, 이 축은 그 한 행
    -- 외에는 아무것도 안 잠그므로 "인벤토리 1개" 불변식이 유지된다.
    v_count := greatest(0, floor(coalesce((p_result->>'count')::numeric, 0) * v_scale))::int;
    if v_count > 0 then
      insert into public.defense_blueprints (profile_id, kind, catalog_id, count)
        values (p_recipient,
                coalesce((p_result->>'kind')::smallint, 0),
                coalesce((p_result->>'catalog_id')::int, 0),
                v_count)
      -- ⚠️ `on conflict do update` 의 SET 절은 대상 테이블을 **스키마 없이** 가리켜야 한다
      --    (범위 테이블 별칭이지 스키마 참조가 아니다). `public.` 를 붙이면 42P01 이다.
      --    `updated_at` 은 trg_defense_blueprints_updated_at 이 이미 찍는다.
      on conflict (profile_id, kind, catalog_id)
        do update set count = defense_blueprints.count + excluded.count;
      v_axis := jsonb_build_object('granted', true, 'count', v_count);
    else
      v_axis := jsonb_build_object('granted', false, 'reason', 'clamped-to-zero');
    end if;

  elsif p_axis = 'coreModule' then
    -- ⚠️ **기존 행을 `for update` 로 잠그지 않는다** — 신규 insert 전용이다(계획 §Pre-mortem 1
    --    각주). 이 축은 리포 안에 두 방향이 공존해(salvage_core_module 은 core_modules→profiles,
    --    apply_module_purchase 는 profiles 먼저) 따를 단일 관례가 없다. 잠글 행이 없으면 방향이
    --    없고, 방향이 없으면 어느 기존 함수와도 반대가 될 수 없다.
    -- 모듈 jsonb 는 **EF 가 굽는다**(`data/coreModules.ts` 의 ModuleInstance 직렬화 계약).
    -- 여기서 조립하면 그 계약이 SQL 과 TS 두 곳에 살아 조용히 갈린다.
    -- ⚠️ `rarity` 는 컬럼 check 로 네 값에 묶여 있다. 손상값이 그대로 들어가면 insert 가 터지고
    --    **그 예외가 수령 트랜잭션 전체를 롤백한다** — 원장 행도 연속일도 함께 사라져 그날이
    --    통째로 실패한다. 그래서 열거 밖은 여기서 접는다(가치가 조금 낮아질 뿐 하루가 안 죽는다).
    v_module := p_result->'module';
    if v_axis_value <= v_value and v_module is not null and jsonb_typeof(v_module) = 'object' then
      insert into public.core_modules (profile_id, module, rarity, charges_left)
        values (p_recipient,
                v_module,
                case when v_module->>'rarity' in ('normal', 'magic', 'rare', 'unique')
                     then v_module->>'rarity' else 'normal' end,
                greatest(0, coalesce((v_module->>'chargesLeft')::int, 0)));
      v_axis := jsonb_build_object('granted', true, 'rarity', v_module->>'rarity');
    else
      v_axis := jsonb_build_object(
        'granted', false,
        'reason', case when v_module is null or jsonb_typeof(v_module) <> 'object'
                       then 'no-module' else 'clamped' end);
    end if;

  elsif p_axis = 'commission' then
    -- ⚠️ **별도 함수(`grant_commission_for`)를 만들지 않는다.** 초안은 그렇게 짰고
    --    `tests/commissionLedgerContract.test.ts` §만들지 않은 것이 그것을 잡았다 —
    --    *"restore_commission 과 grant_commission 이 존재하지 않는다 … 존재하지 않는 함수는
    --    권한 실수로 노출될 수 없다."* 의뢰서를 나눠 주는 함수가 **이름을 갖고 존재하는 것**
    --    자체가 그 계약이 막으려던 것이고, revoke 한 줄이 다음 마이그레이션에서 빠지면
    --    authenticated 가 공짜 의뢰서를 무한히 받는다. 그래서 인라인한다 — 진입점은 이미
    --    service_role 전용인 이 RPC 하나뿐이고, 새 표면이 0 이다.
    --    (계약을 넓혀 통과시키는 것이 더 싸 보였지만, 그 가드가 겨눈 것이 정확히 내가 한
    --     일이었으므로 넓히는 쪽이 틀렸다.)
    --
    -- ⚠️ **`issue_commission_for_run` 도 부르지 않는다.** 그쪽은 `pve_run_id` 를 1회성 앵커로
    --    쓰고 빈도 상한·쿨다운 지평까지 함께 전진시킨다(20260803030000:68-105). 일일 보상은
    --    정산이 아니라 접속이라 앵커로 쓸 run 이 없고, 억지로 끼우면 **매일 접속이 정직한
    --    플레이의 발령 슬롯을 하나씩 먹는다.**
    --
    -- 계급은 굴리지 않는다 — 낙찰이 이미 정했고 어제 예고가 약속한 값이다.
    if v_axis_value > v_value then
      v_axis := jsonb_build_object('granted', false, 'reason', 'clamped');
    else
      v_com_grade := least(4, greatest(1, coalesce((p_result->>'grade')::int, 1)));
      -- 보관 상한 재확인(TOCTOU) — 후보 생산기가 이미 걸렀지만 그 사이 정산 발령이 마지막
      -- 칸을 채웠을 수 있다. `for update` 를 쓰지 않는다: 잠글 기존 행이 없고(신규 insert
      -- 전용) 여기 인벤토리 잠금을 도입하면 한 트랜잭션의 인벤토리가 2개가 될 수 있다.
      select count(*) into v_cnt
        from public.commission_inventory where profile_id = p_recipient;
      if v_cnt >= COMMISSION_STOCK_CAP then
        -- 예외가 아니라 기록이다. 만석으로 못 받은 하루를 원장에서 읽을 수 있어야
        -- "보상이 고장났다"와 "수신소가 찼다"가 구분된다.
        v_axis := jsonb_build_object('granted', false, 'reason', 'stock');
      else
        -- payload 모양이 `issue_commission_for_run` 과 갈리면 **조용히 죽는다** — 클라
        -- `CommissionPayload` 파서가 필드를 못 찾으면 그 의뢰서는 보관함에 있는데 출격이
        -- 안 된다. 계약 테스트가 두 곳의 키 집합과 구간 상수를 대조한다.
        v_segs := '[]'::jsonb;
        v_order := floor(random() * 4)::int;   -- COMMISSION_ORDERS wire 인덱스(append-only).
        for i in 0 .. COMMISSION_SEGMENTS - 1 loop
          v_segs := v_segs || jsonb_build_array(jsonb_build_object(
            'planet', floor(random() * PLANET_COUNT)::int,
            -- 단계 분포 [1, grade](2026-08-03 밴드 복구 레인). 미러: src/bench/commissionBench.ts.
            'stage',  1 + floor(random() * greatest(1, v_com_grade))::int
          ));
        end loop;
        v_cid := gen_random_uuid();
        insert into public.commission_inventory (commission_id, profile_id, grade, payload)
          values (v_cid, p_recipient, v_com_grade, jsonb_build_object(
            'version', 1,
            'commissionId', v_cid::text,
            'grade', v_com_grade,
            'order', (array['chain','constraint','bounty','elite'])[v_order + 1],
            'segments', v_segs,
            'rewards', jsonb_build_object(
              'credits',  v_com_grade * 2500,
              'minerals', v_com_grade * 2500,
              'items',    '[]'::jsonb
            ),
            'replayBudgetTicks', COMMISSION_SEGMENTS * SEGMENT_TICK_CAP
          ));
        v_axis := jsonb_build_object('granted', true, 'commission_id', v_cid, 'grade', v_com_grade);
      end if;
    end if;

  elsif p_axis = 'gear' then
    -- 장비는 **서버 테이블을 안 만진다.** 지급물은 위 insert 가 이미 원장 행의 `item_payload`
    -- 에 적었고, 세이브에 심는 것은 클라다(`src/net/dailyReward.ts` — 반영 → push → 재-pull
    -- 확인 → mark 순서가 거기 산다). 여기서 할 일은 배송함에 실렸는지를 관측면에 남기는 것뿐.
    -- ⚠️ 절삭이 물면 배송하지 않는다. 원장 행은 이미 들어갔으므로 `item_payload` 가 남아
    --    있는데 여기서 false 를 적으면 두 진실이 생긴다 — 그래서 절삭 시에는 아래 update 로
    --    `item_payload` 를 **비운다**(클라가 가져갈 것이 없어야 한다).
    if v_axis_value <= v_value and p_item_payload is not null then
      v_axis := jsonb_build_object('granted', true, 'delivery', 'inbox');
    else
      update public.daily_reward_claims set item_payload = null
        where profile_id = p_recipient and date_seed = v_now_seed;
      v_axis := jsonb_build_object(
        'granted', false,
        'reason', case when p_item_payload is null then 'no-item' else 'clamped' end);
    end if;
  end if;

  -- 축별 지급 결과를 원장에 남긴다 — *"낙찰은 됐는데 지급이 없었다"* 를 사후에 읽을 수 있는
  -- 유일한 자리다(만석 의뢰서·절삭·EF 결함이 전부 여기로 모인다).
  if p_axis <> 'currency' then
    v_result := v_result || jsonb_build_object('axis_grant', v_axis);
    update public.daily_reward_claims set result_payload = v_result
      where profile_id = p_recipient and date_seed = v_now_seed;
  end if;

  -- 재화 축 지급 + 곁들이 크레딧. source='daily_reward' 의 per-call 상한은 20260805000000 의
  -- 9절이 등록한 CAP_DAILY_REWARD_*(25,000/25,000)다. 등록하지 않았다면 else 분기의
  -- CAP_DEFAULT(1,000)에 걸려 30일차 예산 20,000 이 **조용히 1,000 으로 절삭**됐을 것이다.
  -- 이 지급이 만든 currency_grants 행은 트리거 WHEN 절이 걸러 앵커를 밀지 않는다.
  --
  -- ⚠️ **이 호출은 축 분기 뒤에 온다** — 위 §잠금 순서 주석이 그 이유 전부다.
  --
  -- ⚠️ **축을 가려 걸러내지 않는다.** 슬라이스 1 의 본문은 `case when p_axis = 'currency'` 로
  --    재화 축일 때만 credits/minerals 를 실었다. 그때는 다른 축이 존재하지 않아 옳았지만,
  --    슬라이스 2 에서는 **예산 보정분(`budgetTopUpCredits`)이 모든 축에 실린다** — 촉매가
  --    낙찰돼도 남은 예산은 크레딧으로 채워진다. 그 case 를 그대로 두면 보정분이 통째로
  --    사라져 *"30일차인데 40 크레딧"* 이 축만 바뀐 채로 되돌아온다(그 화면을 실제로 봤다).
  --    이제 `v_result` 의 두 성분이 곧 실지급이고, 축이 무엇이든 그대로 나간다.
  v_grant := public.grant_currency_for(
    p_recipient,
    DAILY_SIDE_CREDITS + coalesce((v_result->>'credits')::numeric, 0),
    coalesce((v_result->>'minerals')::numeric, 0),
    'daily_reward',
    null
  );

  return jsonb_build_object(
    'ok', true, 'already', false, 'date_seed', v_now_seed,
    'streak',         least(DAILY_STREAK_CYCLE, greatest(1, v_streak)),
    'budget',         v_budget,
    'clamped',        v_clamped,
    'result_payload', v_result,
    'next_payload',   coalesce(p_next_payload, '{}'::jsonb),
    -- ⚠️ 배송함이 절삭으로 비워졌으면 **응답에서도 비운다.** 위 update 로 원장의 item_payload
    --    를 지워 놓고 여기서 원값을 돌려주면 클라가 서버에 없는 물건을 세이브에 심고,
    --    `mark_daily_reward_applied` 는 그 행을 찾아 applied 로 닫는다 — 원장에 없는 아이템이
    --    영구히 생긴다(복제의 정확한 형상이다).
    'item_payload',   case when p_axis = 'gear' and coalesce((v_axis->>'granted')::boolean, false) is not true
                           then 'null'::jsonb
                           else coalesce(p_item_payload, 'null'::jsonb) end,
    'axis_grant',     v_axis,
    'grant',          v_grant
  );
end;
$$;

-- `create or replace` 는 기존 권한을 보존하지만, 원본과 같은 회수를 한 번 더 건다(멱등).
-- ⚠️ 이것이 빠지면 authenticated 가 PUBLIC 을 통해 도달해 "수령은 EF 전용" 구조가 무효가 된다.
revoke all on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) from public;
revoke all on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) from anon;
revoke all on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) to service_role;

comment on function public.claim_daily_reward_for(uuid, text, numeric, jsonb, jsonb, jsonb) is
  '일일 보상 수령 + 예고 확정 + 연속일 갱신(ADR-0048, 슬라이스 2 = 6축). date_seed 는 서버가 계산한다. 한 호출에 등장하는 인벤토리는 최대 1개. service_role 전용.';
