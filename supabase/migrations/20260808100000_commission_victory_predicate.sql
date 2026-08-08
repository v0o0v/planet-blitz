-- =============================================================================
-- 의뢰서 발령 자격 술어 복구 — **발령률이 0% 였다** (2026-08-08 실측)
-- =============================================================================
--
-- ## 근본 원인 — 서버가 **없는 키**를 읽었고, 그 NULL 이 not null 컬럼을 쳤다
--
-- 2단계 자격 판정이 이랬다:
--
--   v_victory := (p_summary->>'victory' = 'true' and p_summary->>'bossKilled' = 'true');
--
-- 그런데 클라(`PveSettleSummary`, `src/net/gateway.ts`)는 **`bossKilled` 를 한 번도 보낸 적이
-- 없다.** 그래서 `->>'bossKilled'` 는 NULL 이고 SQL 3값 논리로:
--
--   패배 런: false and NULL = **false**  -> 앵커 정상 삽입 -> skip_reason='not-victory'
--   승리 런: true  and NULL = **NULL**   -> claimed_victory(boolean **not null**) 위반
--            -> 서브트랜잭션 롤백 -> **1단계 앵커까지 함께 사라짐** -> raise warning 하나뿐
--
-- 즉 **승리한 런은 발령 판정을 시작조차 못 하고 흔적 없이 사라졌다.** 화면에는 아무 증상이
-- 없다(발령 실패는 원래 조용하도록 설계돼 있다 — 그 자인이 20260803000000 에 적혀 있다).
--
-- ## 원격 실측이 이것을 정확히 확증했다 (2026-08-08)
--
--   pve_runs verified              48
--     ├ 패배 33  ->  commission_issues 앵커 **33건 전부 있음**(skip_reason='not-victory')
--     └ 승리 15  ->  앵커 **0건**            (48 - 33 = 15, 정확히 일치)
--   commission_issues.claimed_victory = true   : 0건
--   commission_issues.claimed_victory is null  : 0건   <- not null 이라 저장 자체가 불가능했다
--   commission_issues.granted = true           : 0건
--   pve_runs 중 summary ? 'bossKilled'         : 0건   <- 키를 보낸 적이 없다
--
-- ⚠️ **"claimed_victory 에 NULL 이 저장된다" 는 틀린 가설이었다.** not null 이 그것을 막고
--    대신 행 전체를 날렸다. 증상이 "분자가 빈다"가 아니라 **"발령률 0%"** 인 이유다.
--
-- ## 고치는 것 셋 — 두 곳이 같은 술어를 갖게 한다
--
--   1. **클라가 `bossKilled` 를 싣는다.** sim 순수 리더 `bossKilledOf` = `bossSpawned && victory`.
--      `victory` 재진술이 아니다 — PvE 승리는 보스 사망 말고 **코어 파괴** 경로로도 서므로
--      (`compact()` 의 `e.kind='core'`), `bossSpawned` 요구가 실제로 더 강한 관측이다.
--      타입은 **필수 필드**다(optional 이면 "안 실어도 통과"라 같은 결함이 재발한다).
--   2. **SQL 이 3값 논리를 끝낸다.** `coalesce` 두 겹 + `jsonb_exists` 분기 -> 어떤 payload 가
--      와도 NULL 이 안 나온다. 키 부재는 **거부가 아니라 폴백**(`victory` 만으로 판정) —
--      거부하면 캐시된 구 클라가 계속 0% 다.
--   3. **삽입에 최후 방어**(`coalesce(v_victory,false)`). 중복이지만 일부러 남긴다 — 이 결함의
--      치명성은 술어가 틀린 것이 아니라 **틀렸을 때 앵커까지 지워져 무증상이 된 것**이었다.
--
-- ## ⚠️ 이 파일의 나머지는 20260808090000 과 **기계적으로 동일하다**
-- 손으로 옮기지 않았다 — 그 파일에서 함수 정의를 프로그램으로 추출해 위 세 곳만 치환했다
-- (`.omc/skills/sql-redefinition-observability-expertise.md` §1: "바이트 동일" 주장이 거짓이
-- 되는 것이 이 리포의 반복 실패 모드다). 드랍 축 배율(4b)·하루 캡(4c)·게이트 순서·상수는
-- 그대로다.
--
-- ⚠️ **본문 뒤 `revoke` 4줄을 함께 재적용한다**(같은 스킬 §1·§2, AC-I6).
--
-- 적용: powershell -ExecutionPolicy Bypass -File scriptspply-commission-victory-predicate.ps1
-- =============================================================================

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
  -- **발령 확률 base**(centi-percent). 3000 = 30%. 미러: COMMISSION_ISSUE_CHANCE_CP.
  -- 자격·상한을 전부 통과한 런에 대해서만 굴린다 → 실효 "런 클리어시 30% x 드랍 축 배율".
  ISSUE_CHANCE_CP             constant int := 3000;
  -- 드랍 축 배율의 **형식 상한**(centi, 100 = x1.00). 출처는 머리말 §전수 스윕.
  -- 미러: COMMISSION_MAX_LOOT_MULT_CENTI.
  MAX_LOOT_MULT_CENTI         constant int := 300;
  -- 확률 cp 의 하드 천장(=100%). 미러: GATE_CP_MAX(src/data/catalystDrops.ts).
  GATE_CP_MAX                 constant int := 10000;
  -- 하루 발령 캡. 유도는 머리말 §하루 축. 미러: CAP_COMMISSIONS_PER_DAY.
  CAP_COMMISSIONS_PER_DAY     constant int := 360;
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

  v_victory         boolean;
  v_claimed_victory boolean;
  v_ft        int;
  v_n         int;
  v_horizon   timestamptz;
  v_cnt       int;
  v_mult_cp   int;
  v_chance_cp int;
  v_grade     int;
  v_roll      double precision;
  v_segments  int;
  v_order     int;
  v_payload   jsonb;
  v_cid       uuid;
  v_segs      jsonb := '[]'::jsonb;
  i           int;
begin
  -- 0. **전체를 서브트랜잭션으로 감싼다.** 아래 어느 단계에서 예외가 나도 바깥 정산은 커밋된다.
  --    이 DDL 자신이 예외 원천을 여럿 갖고 있다(grade check · payload not null · skip_reason check
  --    · granted not null · profiles FK). 하나만 터져도 정산 트랜잭션 전체가 롤백돼
  --    **전 플레이어가 자원을 못 받고 화면은 조용하다.**
  begin
    -- 2 단계의 입력. ⚠️ **여기서 3값 논리를 끝낸다** — 이 함수를 2026-08-03 부터 죽여 온
    --    결함이 정확히 이 한 줄이었다(사유 전문은 파일 머리말 §근본 원인).
    --    `coalesce` 두 겹 + `jsonb_exists` 분기로 **어떤 payload 가 와도 NULL 이 안 나온다.**
    v_claimed_victory := coalesce(p_summary->>'victory' = 'true', false);
    v_victory := v_claimed_victory and case
      -- 새 클라: 두 주장을 **논리곱**으로 요구한다(설계 의도 그대로).
      when jsonb_exists(p_summary, 'bossKilled')
        then coalesce(p_summary->>'bossKilled' = 'true', false)
      -- 구 클라(키 부재): `victory` 만으로 판정한다. **거부가 아니라 폴백**인 이유는
      -- 거부하면 캐시된 구 클라의 발령이 계속 0% 로 남기 때문이다 — 지금 고치려는 것이 바로
      -- 그 0% 다. 새 클라가 배포되면 이 가지는 자연히 안 탄다.
      else v_claimed_victory
      end;
    v_ft := greatest(0, case
      when (p_summary->>'finalTick') ~ '^[0-9]+$' then (p_summary->>'finalTick')::int
      else 0 end);

    -- 1. 1회성 앵커. 자격 판정보다 **앞에서** 행을 넣어야 빈도 상한이 시도를 셀 수 있다.
    insert into public.commission_issues
      (pve_run_id, profile_id, granted, claimed_victory, claimed_final_tick)
    -- ⚠️ `coalesce` 는 위 술어와 **중복이지만 일부러 남긴다.** claimed_victory 는 not null 이고,
    --    여기 NULL 이 들어가면 서브트랜잭션이 롤백되며 **자기 앵커까지 지운다**(warning 하나뿐,
    --    화면 무증상). 그 형태로 발령률이 2026-08-03~08 내내 0% 였다. 술어를 다시 만지는 사람이
    --    NULL 가능 식을 들여도 이 줄이 최후 방어로 남는다 — 지우지 마라.
    values (p_pve_run_id, p_profile_id, false, coalesce(v_victory, false), v_ft)
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

    -- 4b. **발령 확률 게이트.** 여기 하나가 "런 클리어시 30% x 드랍 축 배율"의 전부다.
    --     ⚠️ 5단계의 계급 롤과 **다른 random() 호출**이어야 한다. 하나를 재사용해 "0.3 미만이면
    --        스킵, 아니면 그 값으로 계급"처럼 쓰면 계급 분포가 [0.3, 1) 로 잘려 1급이 사라진다.
    --     ⚠️ 지평(next_eligible_at)은 여기서 전진시키지 않는다 — 20260808070000 머리말 참조.
    --
    --     ⚠️⚠️ **클램프이지 거부가 아니다.** 키가 없는 구 클라 → 100 → 정확히 종전 30%.
    --        범위를 벗어난 주장은 잘라서 계속 진행한다(거부하면 캐시된 구 클라가 조용히 막힌다 —
    --        스킬 §5). 비정수·음수·null 전부 100 으로 접힌다.
    --     ⚠️ 반올림은 `round` 다 — TS 짝 `scaleGateChanceCp` 와 **같은 반올림**이어야
    --        클라 계측(bench/commissionBench)과 서버 발령률이 안 갈린다. `floor` 로 바꾸지 마라.
    v_mult_cp := case
      when (p_summary->>'catalystLootMultCenti') ~ '^[0-9]+$'
        then least(MAX_LOOT_MULT_CENTI, greatest(100, (p_summary->>'catalystLootMultCenti')::int))
      else 100 end;
    v_chance_cp := least(GATE_CP_MAX, round(ISSUE_CHANCE_CP * v_mult_cp / 100.0)::int);
    if floor(random() * 10000)::int >= v_chance_cp then
      update public.commission_issues set skip_reason = 'roll' where pve_run_id = p_pve_run_id;
      return;
    end if;

    -- 4c. **하루 발령 캡(신설).** 확률 게이트 **뒤**, 발령 **앞**이다.
    --     ⚠️ 순서 이유가 4b 와 반대다. 4b(확률)를 앞에 둔 것은 *"롤 실패도 시도로 남아야
    --        위조 천장이 내려간다"* 였는데, 이 캡의 분자는 **발령 건수**라 롤 실패를 세면 안 된다.
    --        앞에 두면 롤 실패가 하루 캡을 갉아먹어 정직한 플레이어가 발령 없이 캡에 닿는다.
    --     ⚠️ 잠금은 캡 조회 **직전**이다. 없으면 병렬 정산이 각자 "여유 있음"을 읽어 N배 뚫린다.
    perform 1 from public.profiles where id = p_profile_id for update;
    select count(*) into v_cnt from public.commission_issues
      where profile_id = p_profile_id
        and granted
        and created_at > now() - interval '1 day';
    if v_cnt >= CAP_COMMISSIONS_PER_DAY then
      update public.commission_issues set skip_reason = 'rate-day' where pve_run_id = p_pve_run_id;
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
    -- ⚠️ **계급 확률표는 배율과 무관하다.** 지시가 "등급 확률은 원래 그대로"이고, 드랍 축은
    --    **총량 축**이다(등급 축은 rarity 축의 소관이며 이 게이트에 닿지 않는다).
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
