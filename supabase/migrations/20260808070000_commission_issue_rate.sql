-- 의뢰서 **발령 확률 30% 도입** (2026-08-08 출시 전 확률 확정 레인)
--
-- 바뀐 것은 두 가지뿐이고 함수의 나머지는 20260803030000_commission_segment_rebalance.sql 과
-- **바이트 동일**하다(그 파일에서 함수 본문을 기계적으로 잘라 아래 ①만 끼워 넣었다):
--
--   ① 4단계(재고 상한)와 5단계(계급 굴리기) 사이에 **4b. 발령 확률 게이트**를 추가.
--      ISSUE_CHANCE_CP = 3000 (= 30%). 실패하면 skip_reason='roll' 로 남기고 반환한다.
--   ② `commission_issues.skip_reason` check 제약에 'roll' 을 추가(아래 alter).
--
-- ## 왜 확률을 넣는가
-- 종전에는 자격(victory + bossKilled) + 세 상한을 통과하면 **100% 발령**이었다. 즉 "의뢰서
-- 드랍 확률"이라는 축이 아예 없었고, 빈도는 쿨다운 누적기와 시간당 상한이라는 **방어 장치**가
-- 부수적으로 정하고 있었다 — 방어 상수를 밸런스 손잡이로 겸용하던 상태다. 사용자 지시로
-- 그 둘을 분리한다: 방어는 상한들이 계속 지고, **빈도는 이 상수 하나**가 진다.
--
-- ## 게이트를 왜 상한들 **뒤에** 두는가
-- 앞에 두면 롤 실패가 상한 판정을 건너뛰어 skip_reason 관측이 무의미해지고, 무엇보다
-- 3단계(빈도 상한)가 세는 `claimed_victory` 행이 롤과 무관하게 쌓여야 위조 처리량 방어가
-- 성립한다 — 그 방어는 "발령됐는가"가 아니라 "승리를 주장했는가"를 센다. 순서를 바꾸면
-- 공격자가 롤 실패를 방패 삼아 상한 밖으로 나간다.
--
-- ## 롤 실패는 쿨다운을 전진시키지 않는다
-- `next_eligible_at` 갱신은 6단계(발령)에만 있고 이 게이트는 그 앞에서 return 한다. 쿨다운
-- 누적기의 불변은 "**발령된** 런들이 주장한 시간의 합 ≤ 실제 경과 시간"이므로, 발령되지 않은
-- 런이 지평을 밀면 그 불변이 오히려 깨진다. 미발령 행은 default now() 라 max 에 영향이 없다.
--
-- ## 30% 의 실효
-- 시간당 상한 20(주장 기준)은 그대로이므로 발령 기대치는 시간당 약 6건이 된다. 재고 상한 12,
-- 쿨다운 누적기는 그대로라 상한들이 물기 전에 확률이 먼저 문다 — 의도한 방향이다(방어 상수가
-- 밸런스를 결정하던 것을 되돌린다).
--
-- ⚠️ **계급 확률표(0.55/0.20/0.18/0.07)는 손대지 않았다.** 지시가 "의뢰서가 나올 때 등급
--    확률은 원래 그대로"다. 이 게이트는 **총량 축**만 건드린다.
--
-- ⚠️ **TS 미러와 쌍이다.** src/run/commissionServerConstants.ts(COMMISSION_ISSUE_CHANCE_CP).
--    한쪽만 고치면 서버 발령률과 클라 계측(bench/commissionBench)이 조용히 갈린다.
--    대조: tests/commissionServerConstants.test.ts.

-- ① skip_reason 도메인 확장. 새 값을 안 넣으면 4b 의 update 가 check 위반으로 터지고,
--    함수 전체가 서브트랜잭션 exception 핸들러로 떨어져 **앵커 행까지 사라진다**(fail-closed).
--    그 경로는 조용해서(warning 뿐) 발령이 영영 0% 인 것처럼 보인다 — 이 alter 가 본체다.
alter table public.commission_issues
  drop constraint if exists commission_issues_skip_reason_check;
alter table public.commission_issues
  add constraint commission_issues_skip_reason_check
  check (skip_reason in ('not-victory','stock','rate','cooldown','roll'));

-- ⚠️ **조용한 실패를 시끄럽게 만든다.** 위 `drop … if exists` 는 PG 기본 생성명을 가정한다.
--    어느 환경에서 그 제약이 **다른 이름**으로 존재하면 drop 이 no-op 하고 새 제약이 *추가*되어
--    둘이 공존한다 → 옛 제약이 'roll' 을 거부해 4b 의 update 가 항상 터지고, 함수의 fail-closed
--    핸들러가 앵커까지 지운 뒤 warning 하나만 남긴다(= 발령률 0%, 화면은 조용). 배포 시점에
--    깨뜨리는 편이 낫다.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'commission_issues'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%skip_reason%';
  if v_n <> 1 then
    raise exception 'commission_issues.skip_reason check 제약이 %개다(1이어야 한다) — 옛 제약이 다른 이름으로 남아 있으면 발령률이 조용히 0%% 가 된다', v_n;
  end if;
end $$;

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
  -- **발령 확률**(centi-percent). 3000 = 30%. 미러: COMMISSION_ISSUE_CHANCE_CP.
  -- 자격·상한을 전부 통과한 런에 대해서만 굴린다 → 실효 "런 클리어시 30%".
  ISSUE_CHANCE_CP             constant int := 3000;
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
    --    ⚠️ 여기가 "클리어할 때만 의뢰서"의 관문이다(설계도 쪽 대응 관문은
    --       data/planets/index.ts blueprintDropsFromLoot 의 victory 인자).
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

    -- 4b. **발령 확률 게이트(2026-08-08).** 여기 하나가 "런 클리어시 30%"의 전부다.
    --     ⚠️ 5단계의 계급 롤과 **다른 random() 호출**이어야 한다. 하나를 재사용해 "0.3 미만이면
    --        스킵, 아니면 그 값으로 계급"처럼 쓰면 계급 분포가 [0.3, 1) 로 잘려 1급이 사라진다.
    --     ⚠️ 지평(next_eligible_at)은 여기서 전진시키지 않는다 — 위 머리말 참조.
    if floor(random() * 10000)::int >= ISSUE_CHANCE_CP then
      update public.commission_issues set skip_reason = 'roll' where pve_run_id = p_pve_run_id;
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
--
-- ⚠️ **재정의마다 반드시 다시 걸어야 한다.** 순서대로 적용된 DB 에서는 ACL 이 보존되므로
--    빠뜨려도 아무 증상이 없다 — 위험은 **함수가 선재하지 않는 경로**다(baseline 스쿼시,
--    `drop function` 후 부분 재적용). 그때 `security definer` 함수가 `EXECUTE to PUBLIC`
--    기본값으로 새로 생기고, 임의 `authenticated` 가 `p_profile_id`·`p_summary` 를 직접 넣어
--    **남의 프로필에 의뢰서를 발령**할 수 있다. 리포에 남는 정본이 회수 없는 정의면 이후
--    모든 재적용이 그 위험을 물려받으므로, 회수는 함수 본문과 한 몸으로 취급한다.
--    대조: tests/commissionLedgerContract.test.ts AC-I6 (**최신 정의 파일**을 읽는다).
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from public;
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from anon;
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from authenticated;
revoke all on function public.issue_commission_for_run(uuid, uuid, jsonb) from service_role;
