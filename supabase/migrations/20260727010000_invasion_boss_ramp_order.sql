-- =============================================================================
-- Planet Blitz — 침공 시드 램프: 방어 보스 배정 순서 교정 (침공 난이도 복원 T1)
-- =============================================================================
-- ⚠️ **기존 마이그레이션 파일은 한 글자도 수정하지 않았다.**
--    `20260723000000_m7c_seed_rebalance.sql` 은 **이미 원격에 적용됐다**(원격 version 스탬프
--    `20260721042605`, name `m7c_seed_rebalance`). 이 프로젝트는 MCP `apply_migration` 으로
--    적용해 왔고 그 도구는 적용 시각으로 자체 version 을 스탬프하므로, **이미 적용된 파일의
--    본문을 고쳐도 원격에는 아무 일도 일어나지 않는다**(히스토리에 그 version 이 이미 있어
--    재실행 대상이 아니다). 램프를 실제로 원격에 반영하는 유일한 방법은 **새 파일**이다.
--    같은 이유로 `20260723000000` 자신도 선행 `20260721010000` 의 시드를 고치는 대신
--    "덮어쓰는 신규 파일"로 만들어졌다 — 이 파일은 그 선례를 그대로 따른다.
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
-- 무엇을 바꾸나 — 보스 배정 **한 줄**뿐이다
-- -----------------------------------------------------------------------------
--   이전: boss = nn<=4 ? none : nn<=10 ? 0 : nn<=16 ? 1 : 2
--   이후: boss = nn<=4 ? none : nn<=10 ? 2 : nn<=16 ? 0 : 1
--
-- 나머지 12개 램프 식(레벨·등급·승급·템플릿·편대·설비·기물)은 **바이트 그대로** 유지한다.
-- 카탈로그 배열(`data/invasion/defenseBosses.ts` 의 `DEFENSE_BOSSES`)은 **append-only 계약**이라
-- 손대지 않았다 — 바뀐 것은 순번→catalogId 매핑뿐이다. 세 보스가 20기지에 전부 등장하는
-- 커버리지도 그대로다(0·1·2 각각 한 밴드씩).
--
-- -----------------------------------------------------------------------------
-- 왜 바꾸나 (재측정 근거 · 2026-07-27 · 참조봇 autopilot)
-- -----------------------------------------------------------------------------
-- `.omc/plans/m8-balance-handoff.md` §5.5 가 "가장 어려운 보스가 중간 밴드에" 라고 기록한 뒤
-- sim 이 여러 번 바뀌었으므로(특히 실드 국면 코어 관통 수정 · 설비 강화축 복구) **재측정했다.**
--
-- ① 보스 축 격리(편대·설비·기물을 전부 비우고 보스만 배치 · asc3/rar3 · 96시드 플레이어 승률):
--      레벨        40      60      99      (낮을수록 어려운 보스)
--      steelGoliath(0)  100.0   97.9    71.9
--      sporeQueen  (1)    7.3    6.3     6.3
--      phaseWarden (2)  100.0   85.4    93.8
--    → `sporeQueen` 이 압도적으로 어렵고, 나머지 둘은 서로 비슷하되 `steelGoliath` 가
--      최고 강화 구간에서 더 어렵다.
--
-- ② 현실 조건 대조(시드 배치 그대로 두고 **보스만 교체** · 96시드 · b-1 = 보스 없음):
--      nn   보스없음   0(goliath)  1(spore)  2(warden)
--      05    100.0     100.0      100.0     100.0
--      08    100.0     100.0      100.0     100.0
--      11    100.0     100.0      100.0     100.0
--      14    100.0     100.0       94.8     100.0
--      17    100.0      96.9       76.0      96.9
--      20     91.7      91.7       81.3      91.7
--    → 격리 결과가 하네스 인공물이 아님을 확인했다. 판별력이 생기는 상위 구간에서
--      `sporeQueen` 만 승률을 끌어내리고 `steelGoliath` 와 `phaseWarden` 은 동률이다.
--
-- 확정된 난이도 순서(어려움 → 쉬움): **sporeQueen(1) > steelGoliath(0) ≥ phaseWarden(2)**.
-- 그래서 하위 밴드에 `phaseWarden`, 중간에 `steelGoliath`, 최상위에 `sporeQueen` 을 둔다.
--
-- -----------------------------------------------------------------------------
-- 적용 후 실측 (24시드 · CI 게이트 해상도 · ADR-0037)
-- -----------------------------------------------------------------------------
--   밴드   교정 전                        교정 후
--   하위   100.00% (기지별 sd  0.0pp)     100.00% (sd  0.0pp)
--   중하    99.40% (sd  1.5pp)            100.00% (sd  0.0pp)
--   중위    85.42% (sd 12.2pp)             74.31% (sd 25.8pp)
--   기지별 중위 #15~#20 — 전 66.7/70.8/95.8/95.8/87.5/95.8 → 후 100.0/91.7/75.0/70.8/20.8/87.5
--
-- 의도한 방향 그대로다: 난이도 곡선의 무게가 중간 밴드에서 **최상위 밴드로** 이동했다.
-- 목표(하위 ≥85 / 중하 55~80 / 중위 25~55)까지는 아직 멀다 — 이 파일은 **배정 역전**만
-- 되돌린다. 밴드 상한·목표의 재기준화는 침공 난이도 레인이 마지막에 한 번에 한다.
--
-- -----------------------------------------------------------------------------
-- RAMP 정본 (이 블록은 tests/invasionBalance.test.ts 가 문자열로 대조한다 —
--            SQL 과 테스트 미러가 조용히 갈라지는 것을 막기 위한 드리프트 가드다.
--            식을 바꾸면 이 주석과 테스트 미러를 **함께** 고쳐야 한다.
--            정본은 **이 파일**이다 — 20260723000000 은 이 파일이 덮어썼다.)
-- RAMP: level = 1 + (3*(nn-1))/2
-- RAMP: rarity = nn<=6 ? 0 : nn<=12 ? 1 : nn<=17 ? 2 : 3
-- RAMP: ascension = nn<=9 ? 0 : nn<=14 ? 1 : nn<=18 ? 2 : 3
-- RAMP: template = nn<=7 ? 0 : nn<=14 ? 2 : 1
-- RAMP: waves = min(6, 1 + (nn-1)/3)
-- RAMP: formationKinds = min(8, 1 + (nn+1)/3)
-- RAMP: formationShift = nn>=17 ? 2 : 0
-- RAMP: facilities = min(socketN, 2 + (nn-1)/2)
-- RAMP: facilityKinds = min(9, 2 + (nn*2)/5)
-- RAMP: props = nn<=4 ? 0 : nn<=8 ? 1 : nn<=15 ? 2 : nn<=17 ? 3 : 4
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

    -- 강화 3축 — 20260723000000 과 동일(바꾸지 않았다).
    v_level  := 1 + ((3 * (v_nn - 1)) / 2);               -- 1..29 (정수 나눗셈)
    v_rarity := case when v_nn <= 6 then 0 when v_nn <= 12 then 1
                     when v_nn <= 17 then 2 else 3 end;
    v_asc    := case when v_nn <= 9 then 0 when v_nn <= 14 then 1
                     when v_nn <= 18 then 2 else 3 end;

    -- 회랑 템플릿: 개활(0) → 병목(2) → 굴곡(1). 동일.
    v_tpl      := case when v_nn <= 7 then 0 when v_nn <= 14 then 2 else 1 end;
    v_socket_n := public.invasion_socket_count(v_tpl);

    -- 슬롯 충전량 + 카탈로그 개방 폭. 동일.
    v_waves   := least(6, 1 + ((v_nn - 1) / 3));
    v_form_k  := least(8, 1 + ((v_nn + 1) / 3));
    v_facils  := least(v_socket_n, 2 + ((v_nn - 1) / 2));
    v_fac_k   := least(9, 2 + ((v_nn * 2) / 5));
    v_props   := case when v_nn <= 4 then 0 when v_nn <= 8 then 1
                      when v_nn <= 15 then 2 when v_nn <= 17 then 3 else 4 end;
    v_prop_k  := least(6, 1 + (v_nn / 4));
    v_prop_sh := case when v_nn >= 18 then 3 else 0 end;
    v_form_sh := case when v_nn >= 17 then 2 else 0 end;

    -- ★ 이 파일이 바꾸는 유일한 식 — 실측 난이도 오름차순으로 재배정했다.
    --   phaseWarden(2) → steelGoliath(0) → sporeQueen(1).
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

    -- L3 기물 소켓 6(고정 길이). 빈 소켓은 충원 대상이 아니라 그대로 비운다.
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
      raise exception '보스 램프 교정: NPC #% 의 3레이어 배치가 스키마 검증 실패', v_nn;
    end if;

    update public.defenses
      set layout = v_layers,
          budget_spent = 0
      where id = v_def_id;
  end loop;
end;
$$;
