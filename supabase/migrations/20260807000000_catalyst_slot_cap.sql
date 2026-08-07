-- =============================================================================
-- 촉매 슬롯 상한 8 → 3 + CAP_RESOURCE_MULT_MAX 파생식 폐기 (ADR-0052 선결)
-- =============================================================================
-- ADR-0052 §결정 "슬롯 상한 8 → 3" · §귀결 "서버 마이그레이션 3건" 중 첫 항목이다.
-- 이 파일은 그중 **상수 두 개만** 옮긴다. 중복 거부·특산 최대 2장 게이트 신설과
-- catalyst_defs 다축 미러는 카탈로그 재작성과 한 몸이라 이 레인 밖이다.
--
-- ── 왜 새 파일인가 ──────────────────────────────────────────────────────────
-- 20260727000000·20260803000000·20260805000000 은 **이미 원격에 적용된** 파일이라 고치지
-- 않는다. 영향받는 함수를 create or replace 로 다시 선언한다.
--
-- ── 재정의 대상은 정확히 둘이다 ────────────────────────────────────────────
-- 상수 선언은 리포 전체에 4곳이지만 **적용 순 마지막 정의만 산다**. 전수 확인 결과:
--   · consume_catalysts   — 20260727000000:211 이 유일 정의. → 여기서 재정의.
--   · grant_currency_for  — 20260803000000:197 → 20260805000000:676 로 재정의됨(마지막).
--                            → 20260805000000 본문 기준으로 여기서 재정의.
--   · grant_currency      — 20260727000000:339 판이 20260803000000:389 에서 **위임 래퍼로
--                            축소**되며 상수 선언이 통째로 사라졌다. 그 자리의 SLOT_CAP 선언은
--                            지금 **죽은 코드**다. 래퍼는 건드리지 않는다(allowlist 계약이
--                            tests/dailyRewardContract.test.ts 에 잠겨 있다).
--   · 20260803000000:229  — 위 grant_currency_for v1 안. 20260805000000 이 덮어써 죽었다.
--
-- ── 옮기는 두 줄 ───────────────────────────────────────────────────────────
--   SLOT_CAP              : 8 → 3                     (src/data/catalysts.ts SLOT_CAP 미러)
--   CAP_RESOURCE_MULT_MAX : 파생식 → 리터럴 2.2       (아래 근거)
--
-- ⚠️ **파생식을 폐기하는 이유**(ADR-0052 §귀결). 이 상수는 캡이 아니라 **클램프**이고
--    `1 + SLOT_CAP × MAX_RESOURCE_PER_STACK` 파생식이었다. SLOT_CAP 을 3으로 내리면 상한이
--    2.2 → **1.45 로 함께 내려가** 설계 상한을 영수증 단계에서 조용히 잘라낸다(실지급이 깎인다).
--    슬롯 수와 정산 클램프는 애초에 서로 다른 축이므로 결합을 끊는다.
--
-- ⚠️ **값을 2.2 로 둔 근거 — 종전 값 유지이지 새 수치가 아니다.**
--    ADR-0052 는 "파생식을 폐기하고 리터럴로 대체" 만 지시하고 **목표 리터럴을 확정하지
--    않았다**. 계획 문서에 후보 ×3.9 가 있으나(`catalog-signature.md:393`), 같은 문서가
--    396-398 행에서 **"이 값은 손으로 찾은 것이라 그 자체가 신뢰 근거가 아니다 — 48C3 =
--    17,296 건 전수 스크립트로 확정해야 한다"** 고 스스로 무효화한다. 게다가 ×3.9 는 아직
--    존재하지 않는 규칙형 48종 카탈로그(개별 상한 ×2.6)에서 도출된 값이다.
--    → 지금 올리면 **카탈로그가 오기 전에 부정 탐지 클램프만 먼저 느슨해진다.**
--    그래서 이 파일은 현행 유효값 2.2 를 **그대로** 리터럴로 굳힌다. 이 커밋의 순수한 효과는
--    "SLOT_CAP 변경이 클램프를 끌고 내려가지 않는다" 하나뿐이고, 정산 거동은 불변이다.
--    상향은 카탈로그 배선 + 전수 스크립트 결과와 함께 별도 마이그레이션으로 간다.
--
-- ── 본문 복제 규율 ─────────────────────────────────────────────────────────
-- 20260802000000 이 프로덕션을 100% 깨뜨린 원인은 **낡은 본문의 복제**였다(드롭된 컬럼 참조
-- → ERROR 42703). 그래서 두 본문 모두 현행 정의를 파일에서 잘라 붙였고 위 두 줄 외에는
-- 한 글자도 바꾸지 않았다. 특히 grant_currency_for 의 **미등록 source → CAP_DEFAULT 1,000
-- 조용한 절삭** 로직과 case 갈래 6종은 그대로 보존된다(daily-reward 레인 교훈).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. consume_catalysts — 슬롯 상한 강제 지점 (20260727000000:211 본문 기준)
-- -----------------------------------------------------------------------------
create or replace function public.consume_catalysts(p_catalyst_ids int[], p_planet int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 캡 상수 — src/data/catalysts.ts SLOT_CAP 미러(ADR-0052: 8→3).
  SLOT_CAP               constant int     := 3;
  MAX_RESOURCE_PER_STACK constant numeric := 0.15;
  -- ⚠️ 파생식 폐기(ADR-0052). SLOT_CAP 과 독립인 리터럴이다 — 위 배너 근거 참조.
  CAP_RESOURCE_MULT_MAX  constant numeric := 2.2;

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
  -- 봉인하므로, 서버 RPC 만 영수증을 심는다(위조 차단).
  insert into public.pve_runs (profile_id, verified_status, catalyst_receipt)
    values (
      v_me, 'pending',
      jsonb_build_object('resourceMult', v_receipt_mult, 'catalystIds', to_jsonb(v_norm_ids))
    )
    returning id into v_run_id;

  return jsonb_build_object('run_id', v_run_id, 'resource_mult', v_receipt_mult);
end;
$$;

-- create or replace 는 기존 권한을 보존하지만, 원본과 같은 회수를 한 번 더 건다(멱등).
revoke all on function public.consume_catalysts(int[], int) from public;
revoke all on function public.consume_catalysts(int[], int) from anon;
grant execute on function public.consume_catalysts(int[], int) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. grant_currency_for — 정산 클램프 지점 (20260805000000:676 본문 기준)
-- -----------------------------------------------------------------------------
-- ⚠️ 캡 상수 전집합·case 갈래 6종·원장 기록은 tests/dailyRewardContract.test.ts §8 이
--    원본(20260803000000)과 값까지 대조한다. 아래는 그 전집합을 한 개도 빠뜨리지 않는다.
create or replace function public.grant_currency_for(
  p_profile_id uuid,
  p_credits    numeric,
  p_minerals   numeric,
  p_source     text,
  p_metrics    jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 캡 상수(placeholder — 20260727000000 상단 배너가 의미 정본, 함께 갱신). 출시 전 밸런스 튜닝 대상.
  CAP_PVE_RUN_CREDITS    constant numeric := 5000;
  CAP_PVE_RUN_MINERALS   constant numeric := 5000;
  CAP_SALVAGE_CREDITS    constant numeric := 20000;
  CAP_SALVAGE_MINERALS   constant numeric := 20000;
  CAP_STORY_CREDITS      constant numeric := 2000;
  -- 의뢰 확정 보상. CAP_HOURLY_*(50,000) 아래로 두어 정직한 1회 지급이 누적 캡에 먼저 걸리지 않게 한다.
  -- 미러: src/run/commissionServerConstants.ts CAP_COMMISSION_CREDITS / _MINERALS.
  CAP_COMMISSION_CREDITS  constant numeric := 30000;
  CAP_COMMISSION_MINERALS constant numeric := 30000;
  -- ADR-0048: 일일 보상 per-call 상한. 곁들이 크레딧 + 주 보상(재화 축 낙찰 시)의 합이
  --   30일차 공통 가치 예산(DAILY_BUDGET_DAY_30 = 20000, data/dailyReward.ts) 을 담아야 한다.
  --   미등록 source 로 두면 CAP_DEFAULT(1000)에 **조용히 절삭**돼 램프가 그 자리에서 죽는다.
  CAP_DAILY_REWARD_CREDITS  constant numeric := 25000;
  CAP_DAILY_REWARD_MINERALS constant numeric := 25000;
  CAP_DEFAULT_CREDITS    constant numeric := 1000;
  CAP_DEFAULT_MINERALS   constant numeric := 1000;
  CAP_HOURLY_CREDITS     constant numeric := 50000;
  CAP_HOURLY_MINERALS    constant numeric := 50000;
  CAP_DAILY_CREDITS      constant numeric := 300000;
  CAP_DAILY_MINERALS     constant numeric := 300000;
  PLAUSIBILITY_CREDITS_PER_TICK  constant numeric := 2.0;
  PLAUSIBILITY_MINERALS_PER_TICK constant numeric := 2.0;
  FLAG_MULTIPLE          constant numeric := 10;
  -- ADR-0052: SLOT_CAP 8→3(src/data/catalysts.ts 미러).
  SLOT_CAP               constant int     := 3;
  MAX_RESOURCE_PER_STACK constant numeric := 0.15;
  -- ⚠️ 파생식 폐기(ADR-0052). SLOT_CAP 과 독립인 리터럴이다 — 파일 상단 배너 근거 참조.
  -- ⚠️ **이 값은 이력이다 — 고치지 마라.** 이후 20260808060000 이 이 함수를 재정의하며 이 자리를
  --    `public.catalyst_cap_resource_mult_max()`(현행 3.2) 호출로 바꿨다. 이 파일은 이미 원격에
  --    적용됐을 수 있어 여기 리터럴을 올려도 원격 함수는 안 바뀐다. 상향은 그 함수에서 한다.
  CAP_RESOURCE_MULT_MAX  constant numeric := 2.2;

  -- ⚠️ 원본과의 **유일한** 차이: 수령자를 auth.uid() 가 아니라 파라미터에서 받는다.
  v_me            uuid := p_profile_id;
  v_claim_credits   numeric;
  v_claim_minerals  numeric;
  v_final_tick    numeric := 0;
  v_stage         numeric := 0;
  v_res_mult        numeric := 1;
  v_plaus_credits   numeric := null;
  v_plaus_minerals  numeric := null;
  v_call_credits    numeric;
  v_call_minerals   numeric;
  v_1h_credits    numeric := 0;
  v_1h_minerals   numeric := 0;
  v_24h_credits   numeric := 0;
  v_24h_minerals  numeric := 0;
  v_rem_credits     numeric;
  v_rem_minerals    numeric;
  v_ref_credits     numeric;
  v_ref_minerals    numeric;
  v_grant_credits   numeric;
  v_grant_minerals  numeric;
  v_credits_left    numeric := 0;
  v_minerals_left   numeric := 0;
  v_clamped       boolean := false;
  v_flag          boolean := false;
begin
  if v_me is null then
    raise exception 'grant_currency_for: 수령자 profile_id 필요';
  end if;

  v_claim_credits  := greatest(0, coalesce(p_credits, 0));
  v_claim_minerals := greatest(0, coalesce(p_minerals, 0));

  -- ① 개연성 캡: pve_run 만.
  --
  --    의뢰가 여기서 면제되는 근거: 이 함수가 받는 값은 *런 파생분 + 서버가 발급한 확정 보상*
  --    의 합이고, 그 합에 런 길이 비례 캡을 걸면 **짧은 고계급 의뢰의 확정 지급이 조용히 잘린다.**
  --    확정 보상은 서버가 payload 에 구운 값이라 개연성을 물을 대상이 아니다. 의뢰의 개연성
  --    방어는 면제가 아니라 **호출부로 옮겨져 있다**(settle_commission 이 틱 비례로 클램프).
  if p_source = 'pve_run' then
    v_final_tick := greatest(0, case
      when (p_metrics->>'finalTick') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_metrics->>'finalTick')::numeric else 0 end);
    v_stage := greatest(0, case
      when (p_metrics->>'stage') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (p_metrics->>'stage')::numeric else 0 end);
    if current_setting('app.in_settle', true) = '1'
       and (p_metrics->>'resourceMult') ~ '^-?[0-9]+(\.[0-9]+)?$' then
      v_res_mult := (p_metrics->>'resourceMult')::numeric;
    end if;
    v_res_mult := least(greatest(1, v_res_mult), CAP_RESOURCE_MULT_MAX);
    v_plaus_credits  := PLAUSIBILITY_CREDITS_PER_TICK  * v_final_tick * (1 + v_stage) * v_res_mult;
    v_plaus_minerals := PLAUSIBILITY_MINERALS_PER_TICK * v_final_tick * (1 + v_stage) * v_res_mult;
  end if;

  -- ② per-call 캡. ⚠️ commission 분기가 없으면 최종 지시의 확정 보상이 else 로 떨어져
  --   **조용히 1,000 으로 클램프된다.**
  case p_source
    when 'pve_run' then
      v_call_credits  := CAP_PVE_RUN_CREDITS  * v_res_mult;
      v_call_minerals := CAP_PVE_RUN_MINERALS * v_res_mult;
    when 'salvage' then v_call_credits := CAP_SALVAGE_CREDITS; v_call_minerals := CAP_SALVAGE_MINERALS;
    when 'story'   then v_call_credits := CAP_STORY_CREDITS;   v_call_minerals := 0;
    when 'commission' then
      v_call_credits  := CAP_COMMISSION_CREDITS;
      v_call_minerals := CAP_COMMISSION_MINERALS;
    when 'daily_reward' then
      v_call_credits  := CAP_DAILY_REWARD_CREDITS;
      v_call_minerals := CAP_DAILY_REWARD_MINERALS;
    else                v_call_credits := CAP_DEFAULT_CREDITS; v_call_minerals := CAP_DEFAULT_MINERALS;
  end case;

  perform 1 from public.profiles where id = v_me for update;
  if not found then
    return jsonb_build_object(
      'granted_credits', 0, 'granted_minerals', 0,
      'credits_left', 0, 'minerals_left', 0,
      'clamped', (v_claim_credits > 0 or v_claim_minerals > 0),
      'note', 'no-profile'
    );
  end if;

  -- ③ 누적 캡: 폭주 방어이지 개연성 판정이 아니므로 **재실행 증거가 대체하지 않는다.**
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

  v_grant_credits  := greatest(0, least(v_claim_credits,  v_plaus_credits,  v_call_credits,  v_rem_credits));
  v_grant_minerals := greatest(0, least(v_claim_minerals, v_plaus_minerals, v_call_minerals, v_rem_minerals));

  v_clamped := (v_grant_credits < v_claim_credits) or (v_grant_minerals < v_claim_minerals);

  v_ref_credits  := least(v_plaus_credits,  v_call_credits);
  v_ref_minerals := least(v_plaus_minerals, v_call_minerals);
  if (v_ref_credits  > 0 and v_claim_credits  > FLAG_MULTIPLE * v_ref_credits)
     or (v_ref_minerals > 0 and v_claim_minerals > FLAG_MULTIPLE * v_ref_minerals)
     or (p_source = 'pve_run' and v_final_tick <= 0
         and (v_claim_credits > 0 or v_claim_minerals > 0)) then
    v_flag := true;
  end if;

  update public.profiles
    set credits  = credits  + v_grant_credits,
        minerals = minerals + v_grant_minerals,
        flagged  = case when v_flag then true else flagged end
    where id = v_me
    returning credits, minerals into v_credits_left, v_minerals_left;

  -- 실지급이 있을 때만 원장 기록. 누적 캡의 근거다 — 우회하면 의뢰 축이 1h/24h 캡 밖으로 나간다
  -- (apply_invasion_result 선례가 정확히 그렇게 원장을 우회한다. 그것을 복제하지 않는다).
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
-- create or replace 는 기존 권한을 보존하지만, 원본과 같은 회수를 한 번 더 건다(멱등).
-- ⚠️ 이 revoke 가 빠지면 authenticated 가 PUBLIC 을 통해 도달해 위임 구조 전체가 무효가 된다.
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from public;
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from anon;
revoke all on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) from authenticated;
grant execute on function public.grant_currency_for(uuid, numeric, numeric, text, jsonb) to service_role;
