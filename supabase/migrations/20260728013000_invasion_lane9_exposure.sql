-- =============================================================================
-- Planet Blitz — 침공 시드 램프: Lane9 콘텐츠 가시성 (하위 밴드 카탈로그 순회 노출)
-- =============================================================================
-- ⚠️ **기존 마이그레이션 파일은 한 글자도 수정하지 않았다.** 선행
--    `20260727020000_invasion_band_restore.sql` 헤더가 정리해 둔 근거 그대로다 —
--    이 프로젝트는 MCP `apply_migration` 으로 적용해 왔고 그 도구가 적용 시각으로 자체
--    version 을 스탬프하므로, **이미 적용된 파일의 본문을 고쳐도 원격에는 아무 일도 일어나지
--    않는다**. 램프를 실제로 원격에 반영하는 유일한 방법은 **새 파일**이다.
--    선례: 20260721010000 → 20260723000000 → 20260727011000 → 20260727020000
--          → 20260728000000 → **이 파일**.
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
-- 무엇을 바꾸나 — 하위 밴드(nn 1..7) 의 편대·설비 카탈로그 창, 두 축
-- -----------------------------------------------------------------------------
--   formationKinds  이전: min(8, 1 + (nn+1)/3)              (모든 nn)
--                   이후: nn<=7 이면 12(전 카탈로그), 그 밖은 동일
--   formationShift  이전: nn>=17 ? 2 : 0
--                   이후: nn<=7 이면 [0,1,2,3,5,7,9], 그 밖은 동일
--   facilityKinds   이전: min(9, 2 + (nn*2)/5)              (모든 nn)
--                   이후: nn<=7 이면 17(전 카탈로그), 그 밖은 동일
--   facilityShift   신규 축. nn<=7 이면 [0,2,4,7,10,14,1], 그 밖은 0(= 종전 동작).
--
-- 나머지 램프 식(레벨·등급·승급·템플릿·웨이브·설비 문수·기물 3축·보스)은
-- **`20260728000000_invasion_props_rebalance.sql` 값 그대로** 유지한다 — 특히 그 파일이
-- broad-phase 결함 수정 뒤 밴드를 목표 중앙에 놓으려고 옮긴 기물 충전량
-- (`props = nn<=4 ? 0 : nn<=7 ? 2 : nn<=14 ? 4 : 3`)은 손대지 않았다.
-- 카탈로그 배열은 전부 append-only 계약이라 손대지 않았다.
--
-- **nn>=8 의 배치는 이 파일 적용 전후로 바이트 동일하다** — 중하·중위 밴드는 단 한 슬롯도
-- 바뀌지 않는다. 그래서 이 변경의 난이도 영향은 하위 밴드에만 존재한다.
--
-- -----------------------------------------------------------------------------
-- 왜 이 변경인가 — 난이도 조정이 아니라 "만든 콘텐츠가 안 보인다" 문제다
-- -----------------------------------------------------------------------------
-- 종전 램프의 `kinds` 상한이 카탈로그 뒷부분을 통째로 잘라냈다:
--
--   카탈로그            길이   종전 노출   잘린 구간
--   FORMATIONS          12     0..7        8..11 (톡사르 2 · 크라스 2)
--   INVASION_FACILITIES 17     0..8        9..16 (Lane9 8종, `demolisher` 포함)
--   L3_PROPS             6     0..5        없음
--   DEFENSE_BOSSES       3     0..2        없음
--
-- 즉 Lane9 신규 방어체 12종이 **20기지 전부에서 한 번도 안 나왔다**. 획득 경로(행성 파밍)는
-- 살아 있었지만 NPC 배치전에서는 영영 볼 수 없는 콘텐츠였다.
--
-- ⚠️ **이것은 난이도 레버가 아니다 — 2026-07-27 복원 레인이 실측으로 기각했다.**
-- 설비 8종을 노출시켜도 중위 밴드가 74.31 → 75.69 로 제자리였고(신규 8종의 실효 화력이
-- 기존 0~8 과 비슷하다), 착지 구성 위에 얹으면 `#16` 이 4.2 → 0% 로 "클리어 불가 기지 없음"
-- 불변식을 깼다. 근거: `.omc/research/invasion-difficulty-restore-lane-2026-07-27.md` §3.5.
-- 그래서 이 파일은 목적을 **가시성**으로 한정하고, 난이도가 움직이지 않는 자리에만 노출한다.
--
-- -----------------------------------------------------------------------------
-- 왜 하위 밴드인가 (설계 판단)
-- -----------------------------------------------------------------------------
-- ① **여유가 거기에만 있다.** 하위는 100.00% 이고 목표가 "85+" 라 15pp 의 아래 여유가 있다.
--    중하(70.83 / 55~80)는 15.8pp, 중위(40.28 / 25~55)는 15.3pp 이고, 무엇보다 중위에는
--    "클리어 불가 기지 없음" 불변식의 최저 기지 `#16`(24시드 5/24)이 있다. 중위를 건드리면
--    그 불변식이 먼저 깨진다 — 복원 레인이 실제로 그렇게 깼다(당시 4.2 → 0%).
-- ② **바이트 불변이 물증이 된다.** nn>=8 을 식 수준에서 손대지 않으면 중하·중위 승률은
--    "다시 쟀더니 같더라"가 아니라 **입력이 동일해서 같다**. 재측정 오차가 끼어들 자리가 없다.
-- ③ **문수를 늘리지 않고 창만 민다.** 기지당 설비 문수·웨이브 수·레벨·등급·승급이 전부
--    그대로다. 바뀐 것은 "어느 종류가 서느냐" 하나뿐이라, 난이도 변화의 원천이 종류 간
--    실효 화력 차이로 한정된다 — 그 차이가 작다는 것이 ①의 실측이다.
-- ④ **하위는 필수 5회 구간이라 노출 효과가 가장 크다.** 모든 플레이어가 반드시 지나가므로,
--    Lane9 방어체를 "처음 보는 자리"로는 여기가 최선이다.
--
-- 창을 미는 방식은 **이어붙이기**다 — 기지 nn 의 창 시작점은 nn 미만 기지들이 소비한 슬롯
-- 수의 누적합이다. 하위 7기지의 설비 슬롯 합이 2+2+3+3+4+4+5 = 22 ≥ 17, 웨이브 슬롯 합이
-- 1+1+1+2+2+2+3 = 12 = 12 라, 누적합 창이 각 카탈로그를 **빈틈없이 한 바퀴 덮는다**.
-- (웨이브는 정확히 12 = 카탈로그 길이라 낭비 슬롯이 0 인 완전 타일링이다.)
--
--   nn  설비 catalogId       편대 catalogId
--   1   0,1                  0
--   2   2,3                  1
--   3   4,5,6                2
--   4   7,8,9                3,4
--   5   10,11,12,13          5,6
--   6   14,15,16,0           7,8
--   7   1,2,3,4,5            9,10,11
--   합집합 = 0..16 (17종)    합집합 = 0..11 (12종)
--
-- 중하·중위가 여전히 설비 0..8 · 편대 0..7 을 덮으므로, **20기지 전체 합집합은 두 카탈로그
-- 전량**이다. 이제 `tests/invasionBalance.test.ts` 의 커버리지 단언이 램프 상한이 아니라
-- **카탈로그 길이 전체**로 복원됐다(미노출 시드 콘텐츠 0).
--
-- -----------------------------------------------------------------------------
-- 적용 후 실측 (참조봇 autopilot · 2026-07-28 · **6세대 기준선** 위에서)
-- -----------------------------------------------------------------------------
-- 기준선은 broad-phase 결함 수정(PR#174) + 기물 재조정(20260728000000) 이후 값이다.
--
--   밴드   변경 전                     변경 후                     설계 목표
--   하위   100.00% (96시드 7기지 96/96) 100.00% (96시드 7기지 96/96) 85+     ✓
--   중하    70.83% (24시드)             70.83% (입력 바이트 동일)   55~80   ✓
--   중위    40.28% (24시드)             40.28% (입력 바이트 동일)   25~55   ✓
--
-- 하위는 base·expose 두 구성을 **각각 96시드로 재측정**해 7기지 전부 96/96 로 일치했다 —
-- Lane9 설비·편대가 하위 난이도를 밀어 올리지 않는다. 판정이 세진 6세대 sim 에서도 같다.
-- `#16` 은 입력이 바이트 동일하므로 20.8%(5/24) 그대로이고 "클리어 불가 기지 없음" 유지.
-- **상쇄 조정이 필요 없었다** — 난이도 중립이 실측으로 성립한다.
--
-- -----------------------------------------------------------------------------
-- RAMP 정본 (이 블록은 tests/invasionBalance.test.ts 가 문자열로 대조한다 —
--            SQL 과 테스트 미러가 조용히 갈라지는 것을 막기 위한 드리프트 가드다.
--            식을 바꾸면 이 주석과 테스트 미러를 **함께** 고쳐야 한다.
--            정본은 **이 파일**이다 — 20260727020000 은 이 파일이 덮어썼다.
--            `[a,b,c][nn]` 은 SQL 배열과 같은 **1-기반** 첨자다.)
-- RAMP: level = 1 + (3*(nn-1))/2
-- RAMP: rarity = nn<=4 ? 0 : nn<=8 ? 1 : nn<=11 ? 2 : 3
-- RAMP: ascension = nn<=7 ? 0 : nn<=10 ? 1 : nn<=16 ? 2 : 3
-- RAMP: template = nn<=7 ? 0 : nn<=14 ? 2 : 1
-- RAMP: waves = min(6, 1 + (nn-1)/3)
-- RAMP: formationKinds = nn<=7 ? 12 : min(8, 1 + (nn+1)/3)
-- RAMP: formationShift = nn<=7 ? [0,1,2,3,5,7,9][nn] : (nn>=17 ? 2 : 0)
-- RAMP: facilities = min(socketN, 2 + (nn-1)/2)
-- RAMP: facilityKinds = nn<=7 ? 17 : min(9, 2 + (nn*2)/5)
-- RAMP: facilityShift = nn<=7 ? [0,2,4,7,10,14,1][nn] : 0
-- RAMP: props = nn<=4 ? 0 : nn<=7 ? 2 : nn<=14 ? 4 : 3
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
  v_fac_sh    integer;
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
  -- 하위 밴드 창 시작점(1-기반 첨자 = nn). 누적합이라 카탈로그를 빈틈없이 덮는다.
  c_fac_shift  constant integer[] := array[0, 2, 4, 7, 10, 14, 1];
  c_form_shift constant integer[] := array[0, 1, 2, 3, 5,  7,  9];
  -- 카탈로그 길이. 하위 밴드는 창 크기를 전 카탈로그로 열어 shift 만으로 순회한다.
  -- ⚠️ `data/invasion/{formations,facilities}.ts` 에 종을 append 하면 이 상수도 함께
  --    올려야 새 종이 노출된다. `tests/invasionBalance.test.ts` 가 그 정합을 단언한다.
  c_form_len constant integer := 12;
  c_fac_len  constant integer := 17;
begin
  for v_nn in 1..20 loop
    v_def_id := ('000000de-f000-4000-8000-' || lpad(v_nn::text, 12, '0'))::uuid;

    -- 레벨·등급·승급은 20260727020000 그대로다.
    v_level  := 1 + ((3 * (v_nn - 1)) / 2);               -- 1..29 (정수 나눗셈)
    v_rarity := case when v_nn <= 4 then 0 when v_nn <= 8 then 1
                     when v_nn <= 11 then 2 else 3 end;
    v_asc    := case when v_nn <= 7 then 0 when v_nn <= 10 then 1
                     when v_nn <= 16 then 2 else 3 end;

    -- 회랑 템플릿: 개활(0) → 병목(2) → 굴곡(1). 동일.
    v_tpl      := case when v_nn <= 7 then 0 when v_nn <= 14 then 2 else 1 end;
    v_socket_n := public.invasion_socket_count(v_tpl);

    -- 슬롯 충전량은 전부 동일하다. ★ 바뀐 것은 편대·설비의 **카탈로그 창**뿐이다.
    v_waves   := least(6, 1 + ((v_nn - 1) / 3));
    v_facils  := least(v_socket_n, 2 + ((v_nn - 1) / 2));
    if v_nn <= 7 then
      v_form_k  := c_form_len;
      v_form_sh := c_form_shift[v_nn];
      v_fac_k   := c_fac_len;
      v_fac_sh  := c_fac_shift[v_nn];
    else
      v_form_k  := least(8, 1 + ((v_nn + 1) / 3));
      v_form_sh := case when v_nn >= 17 then 2 else 0 end;
      v_fac_k   := least(9, 2 + ((v_nn * 2) / 5));
      v_fac_sh  := 0;
    end if;
    -- 기물 충전량 — 하위 둘 · 중하 넷 · 중위 셋. 20260728000000 이 정한 값 그대로다
    -- (중위가 중하보다 적은 것은 오타가 아니다 — 그 파일 헤더 "왜 중위가 더 적은가" 참고).
    v_props   := case when v_nn <= 4 then 0 when v_nn <= 7 then 2
                      when v_nn <= 14 then 4 else 3 end;
    v_prop_k  := least(6, 1 + (v_nn / 4));
    v_prop_sh := case when v_nn >= 18 then 3 else 0 end;

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
          'catalogId', (v_i + v_fac_sh) % v_fac_k,
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
      raise exception 'Lane9 노출: NPC #% 의 3레이어 배치가 스키마 검증 실패', v_nn;
    end if;

    update public.defenses
      set layout = v_layers,
          budget_spent = 0
      where id = v_def_id;
  end loop;
end;
$$;
