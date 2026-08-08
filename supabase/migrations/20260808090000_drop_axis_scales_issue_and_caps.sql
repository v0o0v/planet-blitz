-- =============================================================================
-- 촉매 **드랍 축**이 의뢰서 발령 확률에 닿는다 + 그 귀결로 두 캡을 재유도한다
-- =============================================================================
--
-- 사용자 지시(2026-08-08, 2차): *"설계도와 의뢰서도 아이템이다. 촉매의 드랍 추가 확률에
-- 의해서 이것들도 영향을 받게 하라."*
--
-- 설계도 쪽은 클라 정산 파생이라 TS 에서 끝난다(`data/planets/index.ts`). 이 파일은 **서버가
-- 굴리는 두 축**을 맡는다:
--
--   ① `issue_commission_for_run` 게이트 4b 에 드랍 축 배율을 곱한다(30% -> 최대 90%).
--   ② `grant_blueprints` 의 시간/일 캡을 **다시 유도한다** — 정직한 획득률이 올랐으므로
--      옛 캡이 이제 정직한 플레이어를 문다.
--
-- ## ⚠️ ②가 이 파일에 있는 이유 — 방향만 반대인 같은 함정이다
--
-- `.omc/skills/relative-security-bound-expertise.md` 가 적은 함정은 *"정직한 획득률을 내리면
-- 위조 천장이 상대적으로 느슨해진다"* 였다. **이번은 정확히 그 반대**다: 정직한 획득률이
-- 오르면 **고정된 캡이 정직한 플레이어를 벌하기 시작한다.** 그 스킬 §Recognition Pattern 의
-- 마지막 줄(*"반대 방향도 같다"*)이 가리키는 경우이고, 실제로 다음 값이 나왔다:
--
--   정직 기대(시간) = 축 D 60런/h x 9%(3% x 최대 배율 3.0) = **5.4/h**
--   현행 캡 12/h    -> Poisson(5.4) P(X >= 12) ~ **1e-2**
--
-- 즉 최대 배율로 도는 정직한 플레이어의 **100시간 중 1시간**이 조용히 거부된다(이 RPC 는
-- fire-and-forget 이라 화면에 아무것도 안 뜬다). 캡을 함께 올리지 않으면 이번 기능은
-- "촉매를 부어도 설계도가 안 는다"로 체감된다.
--
-- ## ⭐ 드랍 축 최대 배율 x3.0 의 출처 — 손 계산이 아니라 전수 스윕
--
-- `scripts/catalystCapSweep.ts` (48C3 = 17,296 조합, 특산 필터 후 12,430 유효, 공명 포함):
--
--   [drop] x3.0000
--     최악: #15 extraction + #20 resonance + #34 berdan-royal-jelly | 공명 harvest:weak (snare)
--
-- ⚠️ **공명이 포함된 값이다.** 촉매 3장분만 세는 `axisCapMult` 는 x2.9 를 내놓는다 —
--    드랍축 공명이 7종이라 그 누락이 흔하다. 미러 상수는 스윕값(300 centi)을 쓴다.
--
-- =============================================================================
-- ① 의뢰서 — 게이트 4b 에 배율
-- =============================================================================
--
-- ## 클라가 보내는 값이다 = 위조 가능하다. 무엇으로 유계하는가
--
-- `p_summary->>'catalystLootMultCenti'` 는 클라 주장이고 서버가 검증할 방법이 없다. 세 겹:
--
--   (a) **형식 상한** — [100, 300] 으로 **클램프**한다(거부가 아니라 클램프).
--       거부하면 캐시된 구 클라가 조용히 막힌다. 키가 없으면 100(= x1.00)이라
--       **구 클라는 종전과 정확히 같은 30%** 를 받는다(하위 호환이 산술로 보장된다).
--   (b) **기존 상한 셋이 그대로 앞에 있다** — 빈도(20/h 주장) · 쿨다운 누적기 · 재고 12.
--       게이트 순서는 손대지 않았다(그 순서가 방어 계약인 이유는 20260808070000 머리말).
--   (c) **하루 발령 캡 신설** — 아래 §하루 축.
--
-- ## ⚠️ 시간당 **발령** 캡을 왜 안 넣었는가 (사용자가 "시간당 캡 조달"을 고른 것에 대한 응답)
--
-- 넣으려고 값을 유도하다 **넣을 수 없다**는 결론이 나왔다. 근거를 남긴다:
--
--   위조 천장(시간) = 20 주장/h x min(1, 0.30 x 3.0) = **18/h**
--   정직 천장(시간) = 20 주장/h x min(1, 0.30 x 3.0) = **18/h**   <- 같은 수다
--
-- 두 값이 같은 이유는 **공격자의 거짓말이 배율 하나뿐**이고, 최상위 정직 유저는 그 배율을
-- **정당하게** 주장하기 때문이다. 둘을 가르는 신호가 서버에 없다. 따라서 18 미만의 시간당
-- 발령 캡은 공격자를 조이는 만큼 **정확히 같은 크기로 정직한 플레이어를 조인다**. 18 이상은
-- 무연산이다(헌장 §경제 결합 규율: *"코드가 이미 자르는 값을 상한으로 적지 마라"*).
--
-- ⭐ **그리고 ADR-0026 의 기준은 이미 충족돼 있다** — 그 기준은 절대량이 아니라
--    *"치터의 이득이 **최상위 정직 유저**의 파밍 속도로 유계"* 다. 위 두 수가 같으므로
--    비율은 **정확히 1.0** 이고, 배율 도입 전(6/h 대 6/h)과 **같은 비율**이다.
--    이 축에서 배율이 새로 연 위조 여유는 **없다** — 양변이 함께 3배가 됐을 뿐이다.
--
-- ## 하루 축 — 여기가 실제로 미조달이었다 (배율과 무관하게 원래 비어 있었다)
--
-- 시간 캡만 있고 하루 캡이 없으면 참을성 있는 공격자가 24배를 쓴다(스킬 §2). 이 축은
-- 그 상태였다. 배율이 그 구멍을 **3배로 키웠으므로**(144/day -> 432/day) 지금 막는다.
--
--   정직 천장(하루) = 16시간 x 20 주장/h x 0.9 = **288/day** (헤비 유저 · 최대 배율 상시)
--     ⚠️ 재고 상한 12 가 앞에 있어 실제로는 "받은 만큼 소비"해야 계속 받는다 — 288 은
--        소비가 무한히 빠르다고 가정한 **가장 관대한 쪽**이다.
--     Binomial(320, 0.9) sd = 5.4  ->  360 은 기대 + 13sd
--   위조 천장(하루) = 24시간 x 18/h = 432  ->  **360 으로 닫힌다**
--
-- 비율 432/288 = 1.5 -> 360/288 = 1.25. 하루 축이 처음으로 닫혔다.
--
-- ⚠️ **자인**: 시간 축의 여유(18/h)는 그대로다. 그것을 더 조이려면 배율을 **검증 가능**하게
--    만들어야 하고(= 서버가 촉매 주입 목록에서 재계산), 그 길은 조건부 규칙을 무시한
--    무조건 배율이 되어 헌장 §상한 근거 규율과 충돌한다. **별도 결정으로 남긴다.**
--
-- ## 분자·잠금·순서 — 캡 구조 넷 (스킬 §3)
--   · 분자는 **발령 건수 총량**(`granted` 행 수)이다. 호출 수가 아니다 — 이 축은 호출 1회당
--     발령이 최대 1건이라 둘이 같지만, 훗날 다건 발령이 생겨도 안 뚫리게 총량으로 센다.
--   · `profiles` 행을 `for update` 로 잠근다. 잠금이 없으면 병렬 정산 N개가 각자 여유를 읽는다.
--   · 캡 판정은 **발령(6단계) 앞**이다 — 4b 바로 뒤에 둔다.
--   · 원장은 `commission_issues` 자신이고 **같은 트랜잭션**이다(별도 테이블이 필요 없다).
--
-- ★TS 미러: `src/run/commissionServerConstants.ts`
--   (`tests/commissionServerConstants.test.ts` 가 SQL <-> TS 를 대조한다)
--
-- 재실행 안전: create or replace + 권한 재적용.
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

  v_victory   boolean;
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

-- -----------------------------------------------------------------------------
-- ①-b skip_reason 도메인 확장 — 'rate-day'
-- -----------------------------------------------------------------------------
-- 4c 가 쓰는 값이다. 없으면 update 가 check 위반으로 터지고 함수 전체가 fail-closed 핸들러로
-- 떨어져 **앵커 행까지 사라진다**(= 발령률이 조용히 0%). 20260808070000 이 'roll' 에서 밟을
-- 뻔한 것과 같은 형태라 같은 처방을 쓴다 — **이름을 가정하지 않는 자기 치유형**.
do $$
declare r record;
begin
  for r in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'commission_issues'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%skip_reason%'
  loop
    execute format('alter table public.commission_issues drop constraint %I', r.conname);
    raise notice 'skip_reason check 제약 % 를 걷어냈다(정본으로 재생성한다)', r.conname;
  end loop;
end $$;

alter table public.commission_issues
  add constraint commission_issues_skip_reason_check
  check (skip_reason in ('not-victory','stock','rate','rate-day','cooldown','roll'));

-- 사후 확인 — 정본 하나만 남았는지. 여기서 실패하면 배포가 멈춘다(fail-loud).
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
    raise exception 'commission_issues.skip_reason check 제약이 %개다(1이어야 한다)', v_n;
  end if;
end $$;

-- 4c 의 조회 패턴(profile_id + granted + 최근 1일)에 맞춘 부분 인덱스. 기존 인덱스는
-- claimed_victory 축(3단계)이라 granted 축을 못 덮는다.
create index if not exists commission_issues_granted_time_idx
  on public.commission_issues (profile_id, created_at desc)
  where granted;

-- =============================================================================
-- ② 설계도 캡 재유도 — 정직 기대가 1.8/h -> 5.4/h 로 올랐다
-- =============================================================================
--
-- 입력·반환 형상은 20260808080000 과 **동일**하다. 바뀐 것은 상수 둘뿐이다.
--
-- ## 유도 (20260808080000 §캡 값의 유도 와 **같은 방법**, 확률만 갱신)
--
--   시간당 기대 = 축 D 60런/h x 9%  = **5.4** 장   (3% x 드랍 축 최대 배율 3.0)
--     Poisson(5.4) P(X >= 12) ~ 1.0e-2   <- 옛 캡. 최대 배율 플레이어의 1%가 거부된다.
--     Poisson(5.4) P(X >= 20) ~ 1.1e-6   -> **20** 은 옛 캡의 여유(1.5e-6)와 같은 급.
--   하루 기대   = 16시간 x 60런 x 9% = **86.4** 장  (헤비 유저 상한 가정)
--     Binomial(960, 0.09) sd = 8.87  ->  86.4 + 5.9sd = 138.7  -> **140**
--
--   위조 천장:  시간 12 -> 20      하루 60 -> 140
--   정직 기대:  시간 1.8 -> 5.4     하루 28.8 -> 86.4
--
-- ⭐ **비율이 오히려 조여진다** — 시간 6.7배 -> **3.7배**, 하루 2.1배 -> **1.6배**.
--    ADR-0026 의 상대 기준으로 보면 이 변경은 방어를 **강화**한다. 절대 천장만 보고
--    "캡을 올렸으니 약해졌다"고 읽으면 틀린다(그 오독이 이 스킬이 경고하는 것의 거울상이다).
--
-- ⚠️ 형식 상한(행 8 · 장수 4)은 **여전히 손대지 않는다**(스킬 §5).
-- ★TS 미러: `src/net/blueprintServerConstants.ts`
-- =============================================================================

create or replace function public.grant_blueprints(p_grants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 미러: src/net/blueprintServerConstants.ts
  -- 유도는 20260808090000 머리말 §② (촉매 드랍 축이 정직 기대를 1.8/h -> 5.4/h 로 올렸다).
  CAP_BLUEPRINTS_PER_HOUR constant integer := 20;
  CAP_BLUEPRINTS_PER_DAY  constant integer := 140;

  v_me      uuid := auth.uid();
  v_row     jsonb;
  v_kind    smallint;
  v_catalog integer;
  v_count   integer;
  v_total   integer := 0;
  v_rows    integer := 0;
  v_hour    integer;
  v_day     integer;
begin
  if v_me is null then
    raise exception 'grant_blueprints: 로그인 필요';
  end if;
  if p_grants is null or jsonb_typeof(p_grants) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'bad-input');
  end if;
  -- 호출 1회 상한: 한 런이 낼 수 있는 종류 수를 넉넉히 덮으면서 폭주는 막는 값.
  -- ⚠️ 이 값을 조이지 마라 — 캐시된 구 클라(PR#391 이전)가 여러 행을 보낸다. 총량은 아래 캡이 묶는다.
  if jsonb_array_length(p_grants) > 8 then
    return jsonb_build_object('ok', false, 'code', 'too-many');
  end if;

  -- 프로필 행 잠금 — 동시 호출이 캡을 함께 통과하는 경합을 막는다(`begin_pve_run` 과 같은 규율).
  -- ⚠️ 잠금이 없으면 병렬 호출 N개가 각자 "아직 여유 있음"을 읽어 캡이 N배로 뚫린다.
  --    이 축은 fire-and-forget 이라 클라가 의도 없이도 동시 호출을 만들 수 있다.
  perform 1 from public.profiles where id = v_me for update;

  -- 먼저 요청 전체를 검증하고 합계를 낸다. **캡 판정을 지급보다 앞에** 두어야 부분 지급이 없다.
  for v_row in select * from jsonb_array_elements(p_grants)
  loop
    v_kind    := coalesce((v_row->>'kind')::smallint, -1);
    v_catalog := coalesce((v_row->>'catalogId')::integer, -1);
    v_count   := coalesce((v_row->>'count')::integer, 0);
    if v_kind < 0 or v_kind > 3 or v_catalog < 0 then
      return jsonb_build_object('ok', false, 'code', 'bad-catalog');
    end if;
    -- 장수 상한 4: 한 런에서 같은 설계도가 이보다 많이 나오는 경로가 없다.
    if v_count < 1 or v_count > 4 then
      return jsonb_build_object('ok', false, 'code', 'bad-count');
    end if;
    v_rows  := v_rows + 1;
    v_total := v_total + v_count;
  end loop;

  if v_total <= 0 then
    return jsonb_build_object('ok', true, 'granted', 0, 'rows', 0);
  end if;

  -- 빈도 캡. 분자는 **총 장수** 합이고 분모는 서버 벽시계다(클라 통제 밖).
  select coalesce(sum(granted), 0) into v_hour
    from public.blueprint_grant_log
   where profile_id = v_me and created_at > now() - interval '1 hour';
  if v_hour + v_total > CAP_BLUEPRINTS_PER_HOUR then
    return jsonb_build_object('ok', false, 'code', 'rate',
                              'granted_last_hour', v_hour, 'cap', CAP_BLUEPRINTS_PER_HOUR);
  end if;

  select coalesce(sum(granted), 0) into v_day
    from public.blueprint_grant_log
   where profile_id = v_me and created_at > now() - interval '1 day';
  if v_day + v_total > CAP_BLUEPRINTS_PER_DAY then
    return jsonb_build_object('ok', false, 'code', 'rate-day',
                              'granted_last_day', v_day, 'cap', CAP_BLUEPRINTS_PER_DAY);
  end if;

  -- 캡을 통과했다 — 이제 지급한다.
  for v_row in select * from jsonb_array_elements(p_grants)
  loop
    insert into public.defense_blueprints (profile_id, kind, catalog_id, count)
      values (v_me,
              (v_row->>'kind')::smallint,
              (v_row->>'catalogId')::integer,
              (v_row->>'count')::integer)
      on conflict (profile_id, kind, catalog_id)
      do update set count = public.defense_blueprints.count + excluded.count;
  end loop;

  -- 원장 기록은 **지급과 같은 트랜잭션**이다. 분리하면 앱이 그 사이에 죽었을 때 지급은
  -- 남고 분모는 비어 캡이 조용히 열린다.
  insert into public.blueprint_grant_log (profile_id, granted, rows_n)
    values (v_me, v_total, v_rows);

  return jsonb_build_object('ok', true, 'granted', v_total, 'rows', v_rows);
end;
$$;

revoke all on function public.grant_blueprints(jsonb) from public;
revoke all on function public.grant_blueprints(jsonb) from anon;
grant execute on function public.grant_blueprints(jsonb) to authenticated, service_role;
