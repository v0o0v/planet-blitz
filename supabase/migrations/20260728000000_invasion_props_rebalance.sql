-- =============================================================================
-- Planet Blitz — 침공 시드 램프: 기물 충전량 재조정 (broad-phase 수정 후속)
-- =============================================================================
-- ⚠️ **기존 마이그레이션 파일은 한 글자도 수정하지 않았다.** 선행
--    `20260727020000_invasion_band_restore.sql` 헤더의 근거 그대로다 — 이미 적용된 파일의
--    본문을 고쳐도 원격에는 아무 일도 일어나지 않는다(적용 도구가 자체 version 을 스탬프한다).
--    램프를 실제로 원격에 반영하는 유일한 방법은 **새 파일**이다.
--    선례: 20260721010000 → 20260723000000 → 20260727010000 → 20260727020000 → **이 파일**.
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
-- 무엇을 바꾸나 — 기물 충전량 **한 줄뿐**
-- -----------------------------------------------------------------------------
--   props  이전: nn<=4 ? 0 : nn<=7 ? 2 : 5
--          이후: nn<=4 ? 0 : nn<=7 ? 2 : nn<=14 ? 4 : 3
--
-- 나머지 12개 램프 식(레벨·등급·승급·템플릿·편대·설비·기물 종류·보스)은 **바이트 그대로**
-- 유지한다. 카탈로그 배열은 append-only 계약이라 손대지 않았다.
--
-- -----------------------------------------------------------------------------
-- 왜 지금 재조정하나 — 수치 조정이 아니라 **결함 수정의 뒤처리**다
-- -----------------------------------------------------------------------------
-- `fix/spatial-hash-large-radius-broadphase` 가 공간 해시 broad-phase 결함을 고쳤다.
-- `SpatialHash.insert` 는 엔티티를 **중심 셀 한 칸**에만 넣는데 `query` 는 **탐침 반경**으로만
-- 셀을 훑어서, 접촉 조건(`중심거리 <= 탐침반경 + 엔티티반경`) 중 **엔티티 반경만큼의 띠가
-- broad-phase 에서 통째로 빠져 있었다.** 즉 적·해저드가 셀 경계 너머에서 판정을 흘리고 있었다.
--
-- 그 결함이 사라지자 침공이 전반적으로 어려워졌고 밴드가 **설계 목표 아래로** 내려갔다.
-- 그래서 이 파일은 "상한을 여는" 재기준화가 아니라 **되살아난 판정에 맞춘 밸런스 재조정**이다.
--
--   밴드   수정 전     수정 직후    이 파일 적용 후   설계 목표
--   하위   100.00%     100.00%      100.00%          85+     ✓
--   중하    71.43%      52.38%       70.83%          55~80   ✓
--   중위    31.94%      17.36%       40.28%          25~55   ✓
--
-- 실측 근거는 `.omc/research/spatial-hash-large-radius-broadphase-2026-07-28.md`.
--
-- -----------------------------------------------------------------------------
-- 왜 기물인가 — 그리고 왜 중위가 중하보다 **적은가**
-- -----------------------------------------------------------------------------
-- ① **기물이 유일하게 밴드를 분리한다.** 선행 파일(20260727020000) 헤더 ③ 이 이미 확인한
--    성질이고 이번에도 그대로였다. 레벨 기울기 완화(3/2 → 1)는 중위를 17.36 → 21.53 으로,
--    승급 임계 완화는 22.22 로 올리는 데 그친다 — **어느 것도 중위를 목표(25) 위로 못 올린다.**
--    기물만이 두 밴드를 각각 조준할 수 있다.
--
-- ② **선행 파일은 기물을 `nn<=14` 에만 걸었다.** 그래서 중하는 5 → 3 으로 52.38 → 86.31 까지
--    끌어올릴 수 있었는데 중위는 **한 자리도 움직이지 않았다**(17.36 고정). 중위를 조준하려면
--    중위 구간의 기물 수를 직접 내려야 한다 — 이 파일이 하는 일이 정확히 그것이다.
--
-- ③ **중위(3)가 중하(4)보다 적은 것은 난이도 역전이 아니다.** 세 가지 이유다:
--    - 중위는 등급 3 · 승급 3 이라 **기물 1기당 강도가 중하보다 훨씬 세다**. 줄어든 것은
--      개수뿐이고 총 위협은 여전히 중위가 위다(실측 클리어율 40.28% < 70.83% 가 그 증거다).
--    - 중위는 `propShift = 3`(nn>=18)이라 **다른 종류**가 선다. 개수를 그대로 두면 상위 기물이
--      여섯 소켓을 채워 회피 공간이 사라진다.
--    - 나머지 전 축(레벨·템플릿 굴곡·편대 만석·설비 만석·최난도 보스)이 중위에서 최대다.
--
-- ④ **후보 실측(24시드)** — `mid/up` 은 중하/중위 기물 수다.
--      5/5 (변경 없음)   중하 52.38 ✗   중위 17.36 ✗   (#12·#19 가 전 시드 패배)
--      4/4               중하 70.83 ✓   중위 27.78 ✓   (여유 2.8pp — 너무 아슬하다)
--      **4/3 (채택)**    중하 70.83 ✓   중위 40.28 ✓   (두 밴드 모두 목표 중앙)
--      4/3 + 승급완화    중하 79.76 ✓   중위 45.83 ✓   (중하가 천장 80 에 붙는다)
--      3/3               중하 86.31 ✗   중위 40.28 ✓
--    채택안은 **램프 한 줄만** 옮기면서 두 밴드를 목표 중앙에 놓는다. 모든 기지가 최소
--    1시드에서 승리한다(최저 #16 = 5/24) — "클리어 불가 기지 없음" 유지.
--
-- -----------------------------------------------------------------------------
-- RAMP 정본 (이 블록은 tests/invasionBalance.test.ts 가 문자열로 대조한다 —
--            SQL 과 테스트 미러가 조용히 갈라지는 것을 막기 위한 드리프트 가드다.
--            식을 바꾸면 이 주석과 테스트 미러를 **함께** 고쳐야 한다.
--            정본은 **이 파일**이다 — 20260727020000 은 이 파일이 덮어썼다.)
-- RAMP: level = 1 + (3*(nn-1))/2
-- RAMP: rarity = nn<=4 ? 0 : nn<=8 ? 1 : nn<=11 ? 2 : 3
-- RAMP: ascension = nn<=7 ? 0 : nn<=10 ? 1 : nn<=16 ? 2 : 3
-- RAMP: template = nn<=7 ? 0 : nn<=14 ? 2 : 1
-- RAMP: waves = min(6, 1 + (nn-1)/3)
-- RAMP: formationKinds = min(8, 1 + (nn+1)/3)
-- RAMP: formationShift = nn>=17 ? 2 : 0
-- RAMP: facilities = min(socketN, 2 + (nn-1)/2)
-- RAMP: facilityKinds = min(9, 2 + (nn*2)/5)
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
    -- ★ 기물 충전량 — 하위 둘 · 중하 넷 · 중위 셋. 밴드 분리의 본체다(헤더 ③).
    --   중위가 중하보다 **적은** 것은 오타가 아니다 — 헤더 "왜 중위가 더 적은가" 절 참고.
    v_props   := case when v_nn <= 4 then 0 when v_nn <= 7 then 2
                      when v_nn <= 14 then 4 else 3 end;
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
      raise exception '기물 재조정: NPC #% 의 3레이어 배치가 스키마 검증 실패', v_nn;
    end if;

    update public.defenses
      set layout = v_layers,
          budget_spent = 0
      where id = v_def_id;
  end loop;
end;
$$;
