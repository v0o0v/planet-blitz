-- =============================================================================
-- Planet Blitz — 침공 시드 램프: 밴드 목표 복원 2차 (파워업 하향 뒤처리)
-- =============================================================================
-- ⚠️ **기존 마이그레이션 파일은 한 글자도 수정하지 않았다.** 선행
--    `20260728013000_invasion_lane9_exposure.sql` 헤더의 근거 그대로다 — 이미 적용된 파일의
--    본문을 고쳐도 원격에는 아무 일도 일어나지 않는다(적용 도구가 자체 version 을 스탬프한다).
--    램프를 실제로 원격에 반영하는 유일한 방법은 **새 파일**이다.
--    선례: 20260721010000 → 20260723000000 → 20260727011000 → 20260727020000
--          → 20260728000000 → 20260728013000 → **이 파일**.
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
-- 무엇을 바꾸나 — 등급·승급 임계 **두 줄뿐**
-- -----------------------------------------------------------------------------
--   rarity     이전: nn<=4 ? 0 : nn<=8 ? 1 : nn<=11 ? 2 : 3
--              이후: nn<=4 ? 0 : nn<=8 ? 1 : nn<=14 ? 2 : 3     (등급 3 개시 nn12 → nn15)
--   ascension  이전: nn<=7 ? 0 : nn<=10 ? 1 : nn<=16 ? 2 : 3
--              이후: nn<=7 ? 0 : 1                              (승급 2·3 폐지)
--
-- 나머지 12개 램프 식(레벨·템플릿·웨이브·편대 2축·설비 3축·**기물 3축**·보스)은 **바이트
-- 그대로** 유지한다. 카탈로그 배열은 append-only 계약이라 손대지 않았다.
--
-- **하위 밴드(nn 1..7)는 입력이 바이트 동일하다** — `rarity` 는 nn<=8 구간을, `ascension` 은
-- nn<=7 구간을 건드리지 않았다. 그래서 이 변경의 영향은 정의상 중하·중위에만 존재하고,
-- 하위 100.00% 는 재측정 오차가 끼어들 자리 없이 보존된다.
--
-- -----------------------------------------------------------------------------
-- 왜 지금 재조정하나 — 수치 조정이 아니라 **사용자 지시(파워업 하향)의 뒤처리**다
-- -----------------------------------------------------------------------------
-- 2026-08-01/02 파워업 강화 폭 상한이 사용자 지시로 +10% 하향됐다(`.omc/plans/balance-queue.md`
-- §P0). 이 파일이 재는 승률은 **통째로 파워업 추첨 운 분포**이므로(테스트 헤더 ①), 그 상한이
-- 내려가자 침공 세 밴드가 함께 내려앉았다. §R7 이 그 인과를 실측으로 확정했고
-- (침공은 `!designedRun` 이라 `updateWaves` 를 아예 안 돌린다 → 페이싱 변경은 구조적으로
-- 닿지 않는다. 두 축이 만나는 지점은 파워업뿐이다), 사용자 판정은 **"침공은 방어 기지 강도로
-- 닫는다 · 플레이어 기본 화력은 올리지 않는다"** 였다. 이 파일이 그 판정의 실행이다.
--
--   밴드   파워업 하향 전   하향 후(= 이 파일 적용 전)   이 파일 적용 후   설계 목표
--   하위   100.00%          100.00%                      100.00%(불변)     85+     ✓
--   중하    67.86%           39.88%                       63.69%          55~80   ✓
--   중위    43.75%           11.11%                       33.33%          25~55   ✓
--
-- **상한·하한은 한 자리도 열지 않았다.** 6·7세대가 세운 선례 그대로다.
--
-- -----------------------------------------------------------------------------
-- 왜 등급·승급인가 — 그리고 왜 **기물이 이번에는 레버가 아닌가**
-- -----------------------------------------------------------------------------
-- ① **기물(`props`)은 중위에서 레버 자격을 잃었다.** 6세대에는 기물이 "유일한 분리 레버"였고
--    중위를 목표 중앙에 놓았다. 이번 실측에서는 밴드 평균은 올리지만 **밴드 안 격차를 더
--    벌린다** — `#15` 혼자 튀기 때문이다(24시드, 중위 #15~#20):
--      props 3(현행)  11.11%  sd 19.34   54.2/ 4.2/ 4.2/ 0.0/ 4.2/ 0.0
--      props 2        29.17%  sd 34.78 ✗ 100.0/45.8/ 4.2/ 8.3/12.5/ 4.2
--      props 1        34.72%  sd 40.73 ✗ 100.0/83.3/ 0.0/ 8.3/12.5/ 4.2
--      props 0        35.42%  sd 37.63 ✗ 100.0/75.0/ 8.3/12.5/12.5/ 4.2
--    셋 다 승률 상한 33pp 를 위반한다. **밴드를 맞추면 분산이 깨지는 레버**라 쓸 수 없다.
--
-- ② **기물은 그 위에 카탈로그 노출 계약까지 건다.** 기물 `id 5`(mineSwarm)는 **`#20` 한
--    곳에서만** 나온다(`propKinds(20)=6` · `propShift(20)=3` · `props>=3` 일 때 i=2 → id 5).
--    그래서 중위 `props` 를 3 미만으로 내리면 `tests/invasionBalance.test.ts` 의 "20기지가
--    램프 목표 카탈로그를 전부 노출한다" 단언이 **승률 단언보다 먼저 깨진다**.
--    회피는 가능하다 — `propShift(nn>=20)=5` 로 창을 밀면 props 2 에서도 id 5 가 선다(실측
--    확인: props2+shift(20:5) 29.17 vs props2+shift(20:4) 28.47 로 shift 선택은 한 눈금
--    안이라 난이도 중립이다). **그러나 위 ①의 분산 위반이 남으므로 이 파일은 쓰지 않았다.**
--    이 사실은 다음 레인이 같은 길을 다시 걷지 않도록 여기 남긴다.
--
-- ③ **등급·승급은 5세대가 조인 바로 그 나사다.** 5세대(`20260727020000`)가 밴드를 목표까지
--    **내리려고** 등급 3 을 nn18 → nn12 로, 승급 3 을 nn17 로 앞당겼다. 이번 레인은 밴드를
--    목표까지 **올려야** 하므로 같은 나사를 반대로 돌린다 — 새 축을 발명하는 것이 아니라
--    **선행 세대의 조정을 파워업 수위에 맞춰 되감는 것**이다.
--
-- ④ **후보 실측(24시드)** — 전부 이 트리에서 그대로 재현된다.
--      후보                          중하 평균  sd      중위 평균  sd
--      (현행)                         39.88 ✗  32.72 ✗   11.11 ✗  19.34
--      C1 승급 전부 1                 50.00 ✗  30.05     33.33 ✓  31.55
--      C2 승급 전부 2                 39.88 ✗  32.72 ✗   15.28 ✗  18.58
--      C3 승급 전부 1 + 중하 기물 3   74.40 ✓  27.86     33.33 ✓  31.55
--      C4 등급 3 = nn15+              43.45 ✗  29.45     11.11 ✗  19.34
--      **C5 = C4 + C1 (채택)**        63.69 ✓  16.92     33.33 ✓  31.55
--    C5 를 고른 이유는 **분산이 압도적으로 낫기 때문**이다 — 중하 sd 16.92 는 3세대 이후
--    측정된 값 중 가장 낮다(상한 32 대비 15pp 여유). C3 도 두 밴드를 통과시키지만 중하가
--    74.40 으로 천장 80 에 붙고 sd 도 27.86 이라 여유가 절반이며, 무엇보다 **기물을 건드려
--    ②의 노출 계약을 다시 위험에 놓는다**.
--    기지별(24시드): 중하 #08~#14 = 100.0/58.3/62.5/58.3/54.2/70.8/41.7
--                    중위 #15~#20 =  95.8/ 4.2/12.5/50.0/12.5/25.0
--    **전 기지가 최소 1시드에서 승리한다**(최저 `#16`·`#19` = 4.2%·12.5%) — 적용 전에는
--    `#13`·`#18`·`#20` 이 24시드 전패라 96시드 승격 판정에 걸려 있었다. 불변식이 오히려 강해졌다.
--
-- ⑤ **승급이 nn>=8 전부 1 이 되는 것은 축 하나를 소진한다는 뜻이다.** 실측이 강제했다 —
--    중위를 목표 하한 25 위로 올리는 구성은 승급 1 뿐이고(승급 2 는 15.28 로 미달), 등급·레벨·
--    기물 어느 것도 중위를 단독으로 25 위에 올리지 못한다(등급 3→2 는 20.14, 레벨 기울기
--    3/2→1 은 25.00 이지만 sd 34.27 로 상한 위반). 남은 램프 텍스처는 레벨·등급·기물·웨이브·
--    설비 문수·보스 여섯 축이고, 다음 레인이 침공을 **더 어렵게** 만들어야 할 때 승급이
--    되살릴 수 있는 첫 번째 여유다.
--
-- -----------------------------------------------------------------------------
-- RAMP 정본 (이 블록은 tests/invasionBalance.test.ts 가 문자열로 대조한다 —
--            SQL 과 테스트 미러가 조용히 갈라지는 것을 막기 위한 드리프트 가드다.
--            식을 바꾸면 이 주석과 테스트 미러를 **함께** 고쳐야 한다.
--            정본은 **이 파일**이다 — 20260728013000 은 이 파일이 덮어썼다.
--            `[a,b,c][nn]` 은 SQL 배열과 같은 **1-기반** 첨자다.)
-- RAMP: level = 1 + (3*(nn-1))/2
-- RAMP: rarity = nn<=4 ? 0 : nn<=8 ? 1 : nn<=14 ? 2 : 3
-- RAMP: ascension = nn<=7 ? 0 : 1
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

    -- 레벨은 20260727020000 그대로다.
    v_level  := 1 + ((3 * (v_nn - 1)) / 2);               -- 1..29 (정수 나눗셈)
    -- ★ 등급 3 개시를 nn12 → nn15 로 되돌린다(중하 #12~#14 가 등급 3 → 2).
    v_rarity := case when v_nn <= 4 then 0 when v_nn <= 8 then 1
                     when v_nn <= 14 then 2 else 3 end;
    -- ★ 승급 2·3 폐지 — nn>=8 은 전부 1 이다. 근거는 헤더 ④·⑤.
    v_asc    := case when v_nn <= 7 then 0 else 1 end;

    -- 회랑 템플릿: 개활(0) → 병목(2) → 굴곡(1). 동일.
    v_tpl      := case when v_nn <= 7 then 0 when v_nn <= 14 then 2 else 1 end;
    v_socket_n := public.invasion_socket_count(v_tpl);

    -- 슬롯 충전량·카탈로그 창은 20260728013000 값 그대로다(바이트 불변).
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
    -- 기물 충전량 — 하위 둘 · 중하 넷 · 중위 셋. 20260728000000 이 정한 값 그대로다.
    -- ⚠️ 이번 레인은 여기를 **일부러 안 건드렸다** — 헤더 ①(중위에서 분산이 깨진다) ·
    --    ②(`#20` 이 기물 id 5 의 유일한 노출처라 커버리지 단언이 먼저 깨진다).
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
      raise exception '밴드 복원 2차: NPC #% 의 3레이어 배치가 스키마 검증 실패', v_nn;
    end if;

    update public.defenses
      set layout = v_layers,
          budget_spent = 0
      where id = v_def_id;
  end loop;
end;
$$;
