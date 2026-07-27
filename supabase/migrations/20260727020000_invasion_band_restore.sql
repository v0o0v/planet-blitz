-- =============================================================================
-- Planet Blitz — 침공 시드 램프: 밴드 목표 복원 (침공 난이도 복원 T4b)
-- =============================================================================
-- ⚠️ **기존 마이그레이션 파일은 한 글자도 수정하지 않았다.** 선행
--    `20260727010000_invasion_boss_ramp_order.sql` 헤더가 정리해 둔 근거 그대로다 —
--    이 프로젝트는 MCP `apply_migration` 으로 적용해 왔고 그 도구가 적용 시각으로 자체
--    version 을 스탬프하므로, **이미 적용된 파일의 본문을 고쳐도 원격에는 아무 일도 일어나지
--    않는다**. 램프를 실제로 원격에 반영하는 유일한 방법은 **새 파일**이다.
--    선례: 20260721010000 → 20260723000000 → 20260727010000 → **이 파일**.
--
-- ⚠️ **`supabase db push` 를 쓰면 안 된다** — 리포 파일명 version 과 원격 히스토리 version 이
--    전부 다르다. 상세는 `20260723000000_m7c_seed_rebalance.sql` 헤더와
--    `.omc/plans/invasion-3layer-handoff.md` §0 ②.
--
-- 대상 행: `public.defenses.id = '000000de-f000-4000-8000-' || lpad(NN,12,'0')` (NN=1..20)
--   → **NPC 20행만** 갱신한다(실유저 방어는 auth 발급 UUID 라 이 스킴과 겹칠 수 없다).
-- 재실행 안전: 같은 값으로 수렴하는 멱등 UPDATE. 대상 행이 없으면 0건 갱신(에러 없음).
--
-- -----------------------------------------------------------------------------
-- 무엇을 바꾸나 — 강화 2축 + 기물 충전량, 세 줄
-- -----------------------------------------------------------------------------
--   rarity     이전: nn<=6 ? 0 : nn<=12 ? 1 : nn<=17 ? 2 : 3
--              이후: nn<=4 ? 0 : nn<=8  ? 1 : nn<=11 ? 2 : 3
--   ascension  이전: nn<=9 ? 0 : nn<=14 ? 1 : nn<=18 ? 2 : 3
--              이후: nn<=7 ? 0 : nn<=10 ? 1 : nn<=16 ? 2 : 3
--   props      이전: nn<=4 ? 0 : nn<=8 ? 1 : nn<=15 ? 2 : nn<=17 ? 3 : 4
--              이후: nn<=4 ? 0 : nn<=7 ? 2 : 5
--
-- 나머지 10개 램프 식(레벨·템플릿·편대·설비·기물 종류·보스)은 **바이트 그대로** 유지한다.
-- 특히 **보스 배정(20260727010000)은 손대지 않았다** — 그 배정은 실측 난이도 오름차순으로
-- 막 교정된 것이고, 이 파일은 그 위에서 강화축만 옮긴다.
-- 카탈로그 배열은 전부 append-only 계약이라 손대지 않았다.
--
-- -----------------------------------------------------------------------------
-- 왜 이 세 축인가 (실측 근거 · 2026-07-27 · 참조봇 autopilot · 24시드)
-- -----------------------------------------------------------------------------
-- 상세는 `.omc/research/invasion-band-restore-2026-07-27.md`. 요지만 적는다.
--
-- ① **단일 축으로는 중하 밴드가 움직이지 않는다.** 기지 #8·#11·#14 를 한 축씩 극단으로
--    올려도 전부 100% 근처였다(보스만 sporeQueen 100/100/91.7 · 레벨만 60 100/95.8/95.8 ·
--    등급·승급만 최대 100/100/100 · 웨이브만 만석 100/100/100 · 기물만 4 100/100/95.8).
--    난이도는 **보스 × 강화축의 곱**으로만 내려간다(예: sporeQueen + lv60 = 83.3/54.2/37.5).
--
-- ② **레벨 램프는 밴드를 분리하지 못한다.** 기울기를 3/2 → 5/2 → 9/2 로 쓸면 중위가
--    74.3 → 50.7 → 18.1 로 무너지는 동안 중하는 99.4 → 100 → 100 으로 **꿈쩍도 안 한다**.
--    중위가 중하보다 5배 빠르게 반응하므로, 레벨만 올리면 중하가 목표에 닿기 전에 중위가
--    바닥을 친다.
--
-- ③ **기물(props)이 유일한 분리 레버였다.** 중하 기지의 기물 소켓을 1~2 → 5 로 채우면
--    중하가 97.0 → 71.4 로 내려가는데, 같은 변경이 중위에는 이미 채워져 있어 영향이 작다.
--    기물 종류 램프(propKinds = min(6, 1 + nn/4))가 중하에서는 3~4종(보호막 발생기·중력
--    앵커·고정 주포)만 열어 주므로, 충전량을 늘려도 회복 파일런 같은 상위 기물이 새어
--    들어가지 않는다 — 그래서 중하만 골라 누를 수 있다.
--
-- ④ 등급·승급 임계를 앞당긴 것은 ③의 보조다. 기물만으로는 중하가 97.0 → 88.1 까지만
--    내려갔고, 등급 3 을 nn12 부터(이전 nn18) 열어 71.4 로 착지시켰다.
--
-- -----------------------------------------------------------------------------
-- 적용 후 실측 (24시드 · CI 게이트 해상도 · ADR-0037)
-- -----------------------------------------------------------------------------
--   밴드   교정 전                    교정 후                    설계 목표
--   하위   100.00% (sd  0.0pp)        100.00% (sd  0.0pp)        85+     ✓
--   중하    99.40% (sd  1.5pp)         71.43% (sd 28.8pp)        55~80   ✓
--   중위    74.31% (sd 20.5pp)         31.94% (sd 21.3pp)        25~55   ✓
--
--   기지별 후 — 하위 #01~#07 = 100 전부
--             중하 #08~#14 = 100.0/100.0/91.7/58.3/16.7/50.0/83.3
--             중위 #15~#20 =  41.7/  4.2/ 8.3/41.7/29.2/66.7
--
-- **2026-07-21 M7c 재시드 이후 처음으로 세 밴드가 동시에 설계 목표 안에 들어왔다.**
-- 모든 기지가 최소 1시드에서 승리한다(최저 #16 = 1/24) — "클리어 불가 기지 없음" 유지.
--
-- -----------------------------------------------------------------------------
-- RAMP 정본 (이 블록은 tests/invasionBalance.test.ts 가 문자열로 대조한다 —
--            SQL 과 테스트 미러가 조용히 갈라지는 것을 막기 위한 드리프트 가드다.
--            식을 바꾸면 이 주석과 테스트 미러를 **함께** 고쳐야 한다.
--            정본은 **이 파일**이다 — 20260727010000 은 이 파일이 덮어썼다.)
-- RAMP: level = 1 + (3*(nn-1))/2
-- RAMP: rarity = nn<=4 ? 0 : nn<=8 ? 1 : nn<=11 ? 2 : 3
-- RAMP: ascension = nn<=7 ? 0 : nn<=10 ? 1 : nn<=16 ? 2 : 3
-- RAMP: template = nn<=7 ? 0 : nn<=14 ? 2 : 1
-- RAMP: waves = min(6, 1 + (nn-1)/3)
-- RAMP: formationKinds = min(8, 1 + (nn+1)/3)
-- RAMP: formationShift = nn>=17 ? 2 : 0
-- RAMP: facilities = min(socketN, 2 + (nn-1)/2)
-- RAMP: facilityKinds = min(9, 2 + (nn*2)/5)
-- RAMP: props = nn<=4 ? 0 : nn<=7 ? 2 : 5
-- RAMP: propKinds = min(6, 1 + nn/4)
-- RAMP: propShift = nn>=18 ? 3 : 0
-- RAMP: boss = nn<=4 ? none : nn<=10 ? 2 : nn<=16 ? 0 : 1
-- =============================================================================

do $$
declare
  v_nn        integer;
  v_def_id    uuid;
  v_level     integer;
  v_rarity    integer;
  v_asc       integer;
  v_tpl       integer;
  v_socket_n  integer;
  v_waves     integer;
  v_form_k    integer;
  v_form_sh   integer;
  v_facils    integer;
  v_fac_k     integer;
  v_props     integer;
  v_prop_k    integer;
  v_prop_sh   integer;
  v_boss_id   integer;
  v_i         integer;
  v_wave_arr  jsonb;
  v_sock_arr  jsonb;
  v_prop_arr  jsonb;
  v_boss      jsonb;
  v_layers    jsonb;
begin
  for v_nn in 1..20 loop
    v_def_id := ('000000de-f000-4000-8000-' || lpad(v_nn::text, 12, '0'))::uuid;

    -- 레벨은 그대로다(1..29). ★ 등급·승급 임계만 앞당겼다.
    v_level  := 1 + ((3 * (v_nn - 1)) / 2);               -- 1..29 (정수 나눗셈)
    v_rarity := case when v_nn <= 4 then 0 when v_nn <= 8 then 1
                     when v_nn <= 11 then 2 else 3 end;
    v_asc    := case when v_nn <= 7 then 0 when v_nn <= 10 then 1
                     when v_nn <= 16 then 2 else 3 end;

    -- 회랑 템플릿: 개활(0) → 병목(2) → 굴곡(1). 동일.
    v_tpl      := case when v_nn <= 7 then 0 when v_nn <= 14 then 2 else 1 end;
    v_socket_n := public.invasion_socket_count(v_tpl);

    -- 슬롯 충전량 + 카탈로그 개방 폭. 편대·설비는 동일.
    v_waves   := least(6, 1 + ((v_nn - 1) / 3));
    v_form_k  := least(8, 1 + ((v_nn + 1) / 3));
    v_facils  := least(v_socket_n, 2 + ((v_nn - 1) / 2));
    v_fac_k   := least(9, 2 + ((v_nn * 2) / 5));
    -- ★ 기물 충전량 — 하위는 둘, 중하부터 다섯. 밴드 분리의 본체다(헤더 ③).
    v_props   := case when v_nn <= 4 then 0 when v_nn <= 7 then 2 else 5 end;
    v_prop_k  := least(6, 1 + (v_nn / 4));
    v_prop_sh := case when v_nn >= 18 then 3 else 0 end;
    v_form_sh := case when v_nn >= 17 then 2 else 0 end;

    -- 보스 배정 — 20260727010000 이 실측 난이도 오름차순으로 정한 값 그대로다.
    v_boss_id := case when v_nn <= 4 then null when v_nn <= 10 then 2
                      when v_nn <= 16 then 0 else 1 end;

    -- L1 웨이브 슬롯 6(고정 길이 + null 허용 — 밀집화 금지).
    v_wave_arr := '[]'::jsonb;
    for v_i in 0..5 loop
      if v_i < v_waves then
        v_wave_arr := v_wave_arr || jsonb_build_array(jsonb_build_object(
          'catalogId', (v_i + v_form_sh) % v_form_k,
          'level', v_level,
          'ascension', v_asc,
          'affixSeed', (v_nn * 1000 + v_i * 7)::bigint,
          'rarity', v_rarity));
      else
        v_wave_arr := v_wave_arr || jsonb_build_array('null'::jsonb);
      end if;
    end loop;

    -- L2 설치 소켓(템플릿이 정한 고정 길이).
    v_sock_arr := '[]'::jsonb;
    for v_i in 0..(v_socket_n - 1) loop
      if v_i < v_facils then
        v_sock_arr := v_sock_arr || jsonb_build_array(jsonb_build_object(
          'catalogId', v_i % v_fac_k,
          'level', v_level,
          'ascension', v_asc,
          'affixSeed', (v_nn * 2000 + v_i * 13)::bigint,
          'rarity', v_rarity));
      else
        v_sock_arr := v_sock_arr || jsonb_build_array('null'::jsonb);
      end if;
    end loop;

    -- L3 기물 소켓 6(고정 길이). 충전량이 종류 수를 넘으면 같은 종류가 여러 소켓에 선다
    -- (기물 소켓은 서로 독립이라 중복 배치가 허용된다 — 실유저 배치와 같은 규칙이다).
    v_prop_arr := '[]'::jsonb;
    for v_i in 0..5 loop
      if v_i < v_props then
        v_prop_arr := v_prop_arr || jsonb_build_array(jsonb_build_object(
          'catalogId', (v_i + v_prop_sh) % v_prop_k,
          'level', v_level,
          'ascension', v_asc,
          'affixSeed', (v_nn * 3000 + v_i * 17)::bigint,
          'rarity', v_rarity));
      else
        v_prop_arr := v_prop_arr || jsonb_build_array('null'::jsonb);
      end if;
    end loop;

    -- L3 방어 보스(하위 4기는 미배치 → 런타임에 기본 수비대가 lv1 노말로 충원).
    if v_boss_id is null then
      v_boss := 'null'::jsonb;
    else
      v_boss := jsonb_build_object(
        'catalogId', v_boss_id,
        'level', v_level,
        'ascension', v_asc,
        'affixSeed', (v_nn * 4000)::bigint,
        'rarity', v_rarity);
    end if;

    v_layers := jsonb_build_object(
      'l1', jsonb_build_object('waveSlots', v_wave_arr),
      'l2', jsonb_build_object('templateId', v_tpl, 'sockets', v_sock_arr),
      'l3', jsonb_build_object(
              'boss', v_boss,
              -- NPC 는 퇴역 수호를 갖지 않는다(guardians 테이블에 행 없음).
              'guardians', '[null,null]'::jsonb,
              'props', v_prop_arr,
              'core', jsonb_build_object('hp', 8000, 'x', 0, 'y', 0),
              -- NPC 는 코어 모듈 경제에 참여하지 않는다.
              'modules', '[null,null]'::jsonb)
    );

    -- 무결성 가드: 스키마 검증을 통과 못 하는 시드는 만들지 않는다(생성 로직 회귀 감지).
    if not public.invasion_layers_valid(v_layers) then
      raise exception '밴드 목표 복원: NPC #% 의 3레이어 배치가 스키마 검증 실패', v_nn;
    end if;

    update public.defenses
      set layout = v_layers,
          budget_spent = 0
      where id = v_def_id;
  end loop;
end;
$$;
