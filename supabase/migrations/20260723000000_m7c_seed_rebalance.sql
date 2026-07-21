-- =============================================================================
-- Planet Blitz M7c — NPC 시드 기지 20개 밸런스 재조정 + 풀 카탈로그 재시드
-- =============================================================================
-- ✅ 배포 상태: **원격 적용 완료 2026-07-21**(원격 version 스탬프 20260721042605,
--    name `m7c_seed_rebalance`). 선행 5종(20260721000000·20260721010000·
--    20260722000000·20260722010000·20260722020000)은 그 이전에 적용돼 있었다.
--    이 파일은 그 5종이 만든 스키마(invasion_socket_count / invasion_layers_valid)를
--    전제한다.
--
-- ⚠️ **`supabase db push` 를 쓰면 안 된다 — 리포 파일명 version 과 원격 히스토리 version 이
--    28건 전부 다르다.** 이 프로젝트는 처음부터 MCP `apply_migration` 으로 적용해 왔고, 그
--    도구는 적용 시각으로 자체 version 을 스탬프한다(예: 이 파일 `20260723000000` ↔ 원격
--    `20260721042605`, `20260721000000_m7a_invasion_3layer` ↔ 원격 `20260720191311`).
--    `db push` 는 이미 적용된 28건을 전부 미적용으로 오판해 재실행한다 — `m4_phase_e_npc_seed`·
--    `m4_phase_e_placement` 재실행은 데이터 리셋 위험이다. 상세는
--    `.omc/plans/invasion-3layer-handoff.md` §0 ②.
--
-- ⚠️ 기존 마이그레이션 파일은 한 글자도 수정하지 않았다. 20260721010000 의 시드를
--    **덮어쓰는 신규 파일**이다(같은 고정 UUID 20행 UPDATE).
--
-- 대상 행: `public.defenses.id = '000000de-f000-4000-8000-' || lpad(NN,12,'0')` (NN=1..20)
--   → **NPC 20행만** 갱신한다. 실유저 방어 행은 id 가 이 스킴과 겹칠 수 없으므로
--     (auth 발급 UUID) 한 행도 건드리지 않는다. WHERE 절이 고정 UUID 동등 비교라
--     실수로 넓어질 여지도 없다.
--
-- 재실행 안전: 같은 값으로 수렴하는 멱등 UPDATE. 대상 행이 없으면 0건 갱신(에러 없음).
--
-- -----------------------------------------------------------------------------
-- 왜 재시드하는가 (측정 근거)
-- -----------------------------------------------------------------------------
-- 20260721010000 의 램프(level = 1+(nn-1)*3 → 1..58)는 M7a 임시 카탈로그 기준으로
-- 잡은 값이다. M7c 콘텐츠 확장 후 참조봇(autopilot) 실측에서 **중하·중위 밴드
-- 클리어율이 0%** 로 무너졌다(24시드 × 20기지 = 480런, 중급 장비 기준 하위 98.2% /
-- 중하 79.8% / 중위 5.6%, 무장비 기준 51.2% / 0% / 0%).
-- 원인은 레벨 축이 설비·기물·보스·편대의 HP 와 피해를 **동시에** 곱해 lv30 부근에서
-- 계단이 아니라 절벽이 되는 것이었다. 반면 등급·승급 축은 사실상 무력했다.
-- 대응은 두 갈래이며 이 파일은 그중 ②다:
--   ① 카탈로그 성장 상수 재배분(레벨 기여 축소 / 등급·승급 기여 확대)
--      — data/invasion/{defenseBosses,props,formations}.ts
--   ② 시드 램프를 **레벨 주도**에서 **구성 주도**로 전환(이 파일)
--
-- -----------------------------------------------------------------------------
-- RAMP 정본 (이 블록은 tests/invasionBalance.test.ts 가 문자열로 대조한다 —
--            SQL 과 테스트 미러가 조용히 갈라지는 것을 막기 위한 드리프트 가드다.
--            식을 바꾸면 이 주석과 테스트 미러를 **함께** 고쳐야 한다.)
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
-- RAMP: boss = nn<=4 ? none : nn<=10 ? 0 : nn<=16 ? 1 : 2
--
-- 설계 의도:
--   * 레벨 폭을 1..58 → 1..29 로 좁히고(절벽 구간 회피) 난이도 상승분을 **구성**
--     (편대 종류·설비 종류·기물 수·보스 등급·회랑 템플릿)이 지게 했다.
--   * 맵 템플릿 순서를 0(개활 12소켓) → 2(병목 8) → 1(굴곡 10) 로 배치했다.
--     실측에서 굴곡 회랑이 가장 어렵고 개활이 가장 쉬웠다(소켓 수 순서와 다르다 —
--     소켓이 많아도 피할 공간이 넓으면 쉽다).
--   * 풀 카탈로그를 순번에 따라 **점진 개방**한다: 편대 8종·설비 9종(압축 프레스·
--     견인 자기장·충격파 발생기 포함)·기물 6종·보스 3종이 20기지에 걸쳐 전부 등장한다.
--   * `formationShift`·`propShift` 는 상위 기지에서만 카탈로그 인덱스를 밀어 **저격 편대·
--     지원 편대·회복 파일런·기만 홀로그램·자폭 지뢰군**을 노출시킨다. 슬롯 수 상한(편대 6·
--     기물 4)이 인덱스 범위보다 작아, 밀지 않으면 뒤쪽 카탈로그가 20기지 어디에도 안 나온다.
--
-- -----------------------------------------------------------------------------
-- 실측 결과 (참조봇 autopilot · 24시드 × 20기지 = 480런 · 중급 장비 프로필)
-- -----------------------------------------------------------------------------
--   밴드   재조정 전                재조정 후
--   하위   98.2% (기지별 sd 4.4pp)   96.4% (sd  6.1pp)
--   중하   79.8% (sd 20.6pp)         74.4% (sd 16.9pp)
--   중위    5.6% (sd  2.0pp)         31.3% (sd 12.4pp)
--   (sd = 밴드 안 기지별 승률의 표준편차. 재조정 전 중위의 낮은 sd 는 "전 기지가 똑같이
--    클리어 불가"였던 퇴화 상태의 산물이라 개선 대조군이 되지 못한다.)
--
-- 목표 승률(참조봇 기준): 하위 ≥85% / 중하 55~80% / 중위 25~55%.
--   배치전은 PvP 해금 직후 5회를 치르는 관문이라 하위는 진행이 막히면 안 되고,
--   중위는 재도전을 전제한 상위권 문턱이다.
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

    -- 강화 3축 — 레벨 폭을 좁히고 등급·승급을 실효 축으로 되살렸다.
    v_level  := 1 + ((3 * (v_nn - 1)) / 2);               -- 1..29 (정수 나눗셈)
    v_rarity := case when v_nn <= 6 then 0 when v_nn <= 12 then 1
                     when v_nn <= 17 then 2 else 3 end;
    v_asc    := case when v_nn <= 9 then 0 when v_nn <= 14 then 1
                     when v_nn <= 18 then 2 else 3 end;

    -- 회랑 템플릿: 개활(0) → 병목(2) → 굴곡(1). 실측 난이도 오름차순이다.
    v_tpl      := case when v_nn <= 7 then 0 when v_nn <= 14 then 2 else 1 end;
    v_socket_n := public.invasion_socket_count(v_tpl);

    -- 슬롯 충전량 + 카탈로그 개방 폭(둘 다 순번에 따라 점진 확대).
    v_waves   := least(6, 1 + ((v_nn - 1) / 3));
    v_form_k  := least(8, 1 + ((v_nn + 1) / 3));
    v_facils  := least(v_socket_n, 2 + ((v_nn - 1) / 2));
    v_fac_k   := least(9, 2 + ((v_nn * 2) / 5));
    v_props   := case when v_nn <= 4 then 0 when v_nn <= 8 then 1
                      when v_nn <= 15 then 2 when v_nn <= 17 then 3 else 4 end;
    v_prop_k  := least(6, 1 + (v_nn / 4));
    v_prop_sh := case when v_nn >= 18 then 3 else 0 end;
    v_form_sh := case when v_nn >= 17 then 2 else 0 end;
    v_boss_id := case when v_nn <= 4 then null when v_nn <= 10 then 0
                      when v_nn <= 16 then 1 else 2 end;

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
      raise exception 'm7c reseed: NPC #% 의 3레이어 배치가 스키마 검증 실패', v_nn;
    end if;

    update public.defenses
      set layout = v_layers,
          budget_spent = 0
      where id = v_def_id;
  end loop;
end;
$$;
