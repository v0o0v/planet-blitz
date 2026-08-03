-- 의뢰 발령 payload **밸런스 재조정** (2026-08-03 밴드 복구 레인)
--
-- 바뀐 것은 두 줄뿐이고 함수의 나머지는 20260803000000_commission_ledger.sql 과 **바이트 동일**하다
-- (그 파일에서 함수 본문을 기계적으로 잘라 두 곳만 치환해 생성했다 — 손으로 옮겨 적지 않았다):
--
--   ① v_segments : 계급별 2/3/4/5 -> **전 계급 2**
--   ② stage 분포 : [1, grade+1] -> **[1, grade]**
--
-- ⚠️ **TS 미러와 쌍이다.** src/run/commissionConstants.ts(COMMISSION_SEGMENT_COUNT) ·
--    src/bench/commissionBench.ts(typicalSegments/maxSegments). 한쪽만 고치면 서버가 굽는
--    payload 와 클라 계측이 조용히 갈린다 — 이 저장소의 지배적 실패 모드다.
--
-- ⚠️ 이 마이그레이션만으로는 부족하다: 같은 레인이 COMMISSION_WAVE_SEGMENTS_PER_SEGMENT 를
--    3 -> 2 로 내렸고 그 값은 **EF 번들 안**(verify-commission)에 있다. **EF 재배포가 필요하다.**
--    안 하면 서버 재실행이 다른 maxSegments 로 돌아 정직한 런이 outcome-mismatch 로 거부된다.

create or replace function public.issue_commission_for_run(
  p_pve_run_id uuid,
  p_profile_id uuid,
  p_summary    jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 미러: src/run/commissionServerConstants.ts
  CAP_ISSUE_ATTEMPTS_PER_HOUR constant int := 20;
  COMMISSION_STOCK_CAP        constant int := 12;
  -- ⚠️ **이 축에서 유일하게 정직한 사용자를 벌할 수 있는 상수다.** 너무 크면 정직한 속공 런이
  --    발령 자체를 못 받는다. finalTick = replay.inputs.length(src/net/pveRun.ts:46), TICK_RATE=60.
  --    실측(2026-08-01, 210런/승리 156): **최소 195틱**(3.25초) · p1 215 · p5 272 · p50 782.
  --    60 은 관측 최소의 31%. 낮게 잡아도 방어가 안 죽는 이유: 위조 처리량을 실제로 묶는 것은
  --    CAP_ISSUE_ATTEMPTS_PER_HOUR(20/h) 이고, 60틱이면 "실시간÷상수"가 시간당 3,600 이라
  --    20/h 가 항상 먼저 문다. 이 상수의 실제 역할은 finalTick:1 이 쿨다운을 문자 그대로 0 으로
  --    만드는 퇴화만 막는 것이다. 미러: src/run/commissionConstants.ts MIN_BOSS_KILL_TICKS.
  MIN_BOSS_KILL_TICKS         constant int := 60;
  -- payload 굴리기 placeholder 상수(계급별 구간 수·구간당 틱 상한). 미러:
  -- src/run/commissionConstants.ts COMMISSION_SEGMENT_COUNT / COMMISSION_SEGMENT_TICK_CAP.
  SEGMENT_TICK_CAP            constant int := 9000;
  PLANET_COUNT                constant int := 6;

  v_victory  boolean;
  v_ft       int;
  v_n        int;
  v_horizon  timestamptz;
  v_cnt      int;
  v_grade    int;
  v_roll     double precision;
  v_segments int;
  v_order    int;
  v_payload  jsonb;
  v_cid      uuid;
  v_segs     jsonb := '[]'::jsonb;
  i          int;
begin
  -- 0. **전체를 서브트랜잭션으로 감싼다.** 아래 어느 단계에서 예외가 나도 바깥 정산은 커밋된다.
  --    이 DDL 자신이 예외 원천을 여럿 갖고 있다(grade check · payload not null · skip_reason check
  --    · granted not null · profiles FK). 하나만 터져도 정산 트랜잭션 전체가 롤백돼
  --    **전 플레이어가 자원을 못 받고 화면은 조용하다.**
  begin
    v_victory := (p_summary->>'victory' = 'true' and p_summary->>'bossKilled' = 'true');
    v_ft := greatest(0, case
      when (p_summary->>'finalTick') ~ '^[0-9]+$' then (p_summary->>'finalTick')::int
      else 0 end);

    -- 1. 1회성 앵커. 자격 판정보다 **앞에서** 행을 넣어야 빈도 상한이 시도를 셀 수 있다.
    insert into public.commission_issues
      (pve_run_id, profile_id, granted, claimed_victory, claimed_final_tick)
    values (p_pve_run_id, p_profile_id, false, v_victory, v_ft)
    on conflict (pve_run_id) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      return;   -- 이미 발령 판정을 거친 앵커. 트리거가 중복 발화해도 여기서 멈춘다.
    end if;

    -- 2. 자격 + 개연성 하한. **하한이 없으면 3b 를 공격자가 0 으로 만든다** —
    --    (a)와 (b)는 독립 방어가 아니라 한 방어의 두 조각이다.
    if not v_victory or v_ft < MIN_BOSS_KILL_TICKS then
      update public.commission_issues set skip_reason = 'not-victory'
        where pve_run_id = p_pve_run_id;
      return;
    end if;

    -- 3. 빈도 상한. **claimed_victory 인 행만** 센다. 1단계에서 자기 행을 이미 넣었으므로
    --    자기 자신이 카운트에 포함된다 — 상수 20 은 그 포함 기준이다.
    select count(*) into v_cnt from public.commission_issues
      where profile_id = p_profile_id
        and claimed_victory
        and created_at > now() - interval '1 hour';
    if v_cnt >= CAP_ISSUE_ATTEMPTS_PER_HOUR then
      update public.commission_issues set skip_reason = 'rate' where pve_run_id = p_pve_run_id;
      return;
    end if;

    -- 3b. 쿨다운 — **"직전 행 읽기"가 아니라 "미래 예약 누적기"다.** 직전 행 기준이면 긴 주장과
    --     짧은 주장을 번갈아 파이프라이닝할 수 있다. 누적기는 어떤 창에서도
    --     "발령된 런들이 주장한 시간의 합 ≤ 실제 경과 시간"을 성립시킨다.
    select coalesce(max(next_eligible_at), now()) into v_horizon
      from public.commission_issues where profile_id = p_profile_id;
    if v_horizon > now() then
      update public.commission_issues set skip_reason = 'cooldown' where pve_run_id = p_pve_run_id;
      return;
    end if;

    -- 4. 재고 상한. 소비하면 다시 차므로 **빈도 상한과는 다른 축**이다.
    select count(*) into v_cnt from public.commission_inventory where profile_id = p_profile_id;
    if v_cnt >= COMMISSION_STOCK_CAP then
      update public.commission_issues set skip_reason = 'stock' where pve_run_id = p_pve_run_id;
      return;
    end if;

    -- 5. 계급·payload 를 굴린다(RNG 는 서버, sim 해시와 무관).
    --    ⚠️ **이 굴리기 표는 placeholder 다** — 계급별 발령 확률(밸런스 큐 C3)과 보상 표는
    --    아직 확정되지 않았다. 형태(CommissionPayload)만 계약대로 채운다.
    --    **보유 유니크를 제외하지 않는다 — 중복 지급을 허용한다**(서버가 갖지 않은 원장을
    --    전제하지 않기 위함).
    -- ⚠️ **한 번만 뽑아서 그 하나를 누적 경계와 비교한다.** `case when random() < a … when
    --    random() < b …` 는 `random()` 이 volatile 이라 **분기마다 새로 뽑는다** — 경계가 누적
    --    CDF 처럼 읽히는데 실제 분포는 조건부 곱(0.55 / 0.3375 / 0.1046 / 0.0079)이 되어
    --    최종 계급이 의도(7%)의 9분의 1로 나온다. 눈으로는 맞아 보이고 테스트도 분포를 안 세면
    --    통과하는 형태라 여기 못 박는다.
    v_roll := random();
    v_grade := case
      when v_roll < 0.55 then 1
      when v_roll < 0.75 then 2
      when v_roll < 0.93 then 3
      else 4 end;
    -- ⚠️ 2026-08-03 밴드 복구 레인: 계급별 구간 수 2/3/4/5 -> **전 계급 2**.
    --    미러: src/run/commissionConstants.ts COMMISSION_SEGMENT_COUNT (근거 실측표는 그 주석).
    v_segments := 2;
    v_order := floor(random() * 4)::int;   -- COMMISSION_ORDERS wire 인덱스(append-only).

    for i in 0 .. v_segments - 1 loop
      v_segs := v_segs || jsonb_build_array(jsonb_build_object(
        'planet', floor(random() * PLANET_COUNT)::int,
        -- ⚠️ 단계 분포 [1, grade+1] -> **[1, grade]** (2026-08-03 밴드 복구 레인).
        --    미러: src/bench/commissionBench.ts typicalSegments.
        'stage',  1 + floor(random() * greatest(1, v_grade))::int
      ));
    end loop;

    v_cid := gen_random_uuid();
    v_payload := jsonb_build_object(
      'version', 1,
      'commissionId', v_cid::text,
      'grade', v_grade,
      'order', (array['chain','constraint','bounty','elite'])[v_order + 1],
      'segments', v_segs,
      'rewards', jsonb_build_object(
        'credits',  v_grade * 2500,
        'minerals', v_grade * 2500,
        'items',    '[]'::jsonb
      ),
      'replayBudgetTicks', v_segments * SEGMENT_TICK_CAP
    );

    -- 6. 발령 + **지평 전진은 granted 일 때만**. 미발령 행은 default now() 라 max 에 영향이 없다.
    insert into public.commission_inventory (commission_id, profile_id, grade, payload)
      values (v_cid, p_profile_id, v_grade, v_payload);

    update public.commission_issues
       set granted = true,
           commission_id = v_cid,
           next_eligible_at = greatest(now(), v_horizon)
                              + make_interval(secs => v_ft / 60.0)
     where pve_run_id = p_pve_run_id;

  exception when others then
    -- 서브트랜잭션만 롤백. 바깥 정산은 커밋된다.
    -- **fail-closed**: 1단계 앵커 행도 함께 사라지지만 그 pve_runs 행은 이미 verified 로 커밋돼
    -- 트리거가 재발화하지 않는다(아래 old/tg_op 가드). 결과는 "의뢰서 미발령"이고 지급 쪽으로
    -- 새지 않는다. **자인**: 그래서 발령 실패는 플레이어에게 보이지 않는다 — warning 발생률을 관측한다.
    raise warning 'issue_commission_for_run 실패(pve_run_id=%): %', p_pve_run_id, sqlerrm;
    return;
  end;
end;
$$;

-- `create or replace` 는 기존 권한을 보존하지만, 원본과 같은 회수를 한 번 더 건다(멱등).
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from public;
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from anon;
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from authenticated;
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from service_role;
