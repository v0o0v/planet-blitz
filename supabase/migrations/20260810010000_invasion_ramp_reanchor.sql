-- =============================================================================
-- Planet Blitz — 침공 시드 램프 재앵커 (2026-08-10 밸런스 기준선 위로)
-- =============================================================================
-- ⚠️ **기존 마이그레이션 파일은 한 글자도 수정하지 않았다.** 이미 적용된 파일의 본문을 고쳐도
--    원격에는 아무 일도 일어나지 않는다(적용 도구가 자체 version 을 스탬프한다). 램프를 실제로
--    원격에 반영하는 유일한 방법은 **새 파일**이다.
--    선례: 20260721010000 → 20260723000000 → 20260727011000 → 20260727020000
--          → 20260728000000 → 20260728013000 → 20260803020000 → **이 파일**.
--
-- ⚠️ **`supabase db push` 를 쓰면 안 된다** — 리포 파일명 version 과 원격 히스토리 version 이
--    전부 다르다. 적용은 `scripts/apply-invasion-ramp-reanchor.ps1`(Management API) 로 한다.
--
-- 대상 행: `public.defenses.id = '000000de-f000-4000-8000-' || lpad(NN,12,'0')` (NN=1..20)
--   → **NPC 20행만** 갱신한다(실유저 방어는 auth 발급 UUID 라 이 스킴과 겹칠 수 없다).
-- 재실행 안전: 같은 값으로 수렴하는 멱등 UPDATE. 대상 행이 없으면 0건 갱신(에러 없음).
--
-- -----------------------------------------------------------------------------
-- 왜 재앵커인가 — 램프가 묻힌 게 아니라 **뒤집혀 있었다**
-- -----------------------------------------------------------------------------
-- 2026-08-10 밀도 레인이 침공 기준선을 통째로 옮겼다(수비대 Lv75 · 방어 HP ×201 · 방어 피해
-- ×2 · 코어 HP ×3 · 밀도 기본값). 그 위에서 20기지를 다시 재 보니 램프의 난이도 계단이 바닥에
-- 묻힌 정도가 아니라 **부호가 뒤집혀 있었다.**
--
--   실측 (`pnpm bench:invasion`, live 무대 · 만렙 빌드 참조봇 · 6시드 · 평균 생존틱)
--     빈 방어(= 배치 0, 기본 수비대만) .................... 1090
--     하위 #01~#07 ....................................... 798~1546 (평균 1168)
--     중하 #08~#14 ...................................... 1193~2044 (평균 1584)  ← 바닥보다 쉽다
--     중위 #15~#20 ....................................... 307~1105 (평균  606)
--   → **20기지 중 13곳(하위·중하 전부)이 「아무것도 배치 안 한 방어」보다 쉬웠다.**
--
-- 원인은 둘이고 **둘 다 구조적**이다(수치 미세조정으로는 안 닿는다):
--
--   ① **빈 슬롯은 기본 수비대가 Lv75 로 채운다.** 램프의 `waves` 는 6칸 중 앞 몇 칸만 채우고
--      나머지를 비워 뒀는데, 비운 칸이 곧 Lv75 충원이다. 즉 **약한 배치를 꽂을수록 강한 충원을
--      밀어내 기지가 쉬워진다.** `waves` 가 난이도 손잡이가 아니라 **난이도 감산기**였다.
--   ② **램프 레벨 범위(1..29)가 통째로 수비대 레벨(75) 아래다.** 레벨축을 단독 보정한 실측:
--        Lv1=6458  Lv15=6348  Lv29=1657  Lv50=1396  Lv75=922  Lv100=750  Lv150=750  Lv200=750
--      (6칸 전부 같은 편대·같은 레벨, 등급0·승급0, 같은 6시드). **Lv100 위로는 포화한다.**
--      바닥(1090)과 같아지는 지점이 Lv~70 이므로, 램프 상단이 29 인 한 어떤 기지도 바닥을
--      못 넘는다.
--
-- -----------------------------------------------------------------------------
-- 무엇을 바꾸나 — 세 줄
-- -----------------------------------------------------------------------------
--   waves   이전: min(6, 1 + (nn-1)/3)          이후: 6
--           → 원인 ①. 6칸을 전부 배치로 채워야 램프가 L1 난이도를 **소유**한다. 이 줄이
--             안 바뀌면 아래 레벨 재앵커도 절반은 충원에 먹힌다.
--   level   이전: 1 + (3*(nn-1))/2  (1..29)     이후: 20 + (17*(nn-1))/4  (20..100)
--           → 원인 ②. 두 앵커에 맞췄다: **#14 가 정확히 75**(= 수비대 레벨 = 바닥과 등가) ·
--             **#20 이 100**(= 레벨축 포화점. 그 위는 값만 커지고 효과가 없다).
--             하위는 20..45 로 바닥보다 확실히 쉽고, 중위는 79..100 으로 확실히 어렵다.
--   rarity  이전: nn<=4 ? 0 : nn<=8 ? 1 : nn<=14 ? 2 : 3
--           이후: nn<=7 ? 0 : nn<=11 ? 1 : nn<=15 ? 2 : 3
--           → 등급 1 이 nn5 에서 들어와 하위 밴드의 레벨 계단을 통째로 덮고 있었다(#4→#5 에서
--             생존틱이 1044→984 로 역전). 개시를 밴드 경계(nn8)로 밀어 **하위는 순수 레벨
--             램프**가 되게 한다. 등급 0~3 은 여전히 전부 노출된다(1-7 / 8-11 / 12-15 / 16-20).
--
-- 나머지 11개 램프 식(승급·템플릿·편대 2축·설비 3축·기물 3축·보스)은 **바이트 그대로**다.
--
-- -----------------------------------------------------------------------------
-- 적용 후 실측 (같은 도구·같은 6시드 · 평균 생존틱, 바닥 1090)
-- -----------------------------------------------------------------------------
--   하위 #01~#07  2149 2571 2152 1044 1005 1551 2144   평균 1802  (바닥 대비 +65%, 쉽다)
--   중하 #08~#14  1148 1388 1514 1055 1410 1108  581   평균 1172  (바닥과 거의 같다)
--   중위 #15~#20   732  542  494  259  541  783        평균  559  (바닥 대비 -49%, 어렵다)
--   → 밴드 순서가 **처음으로 단조**해졌고 부호가 바로 섰다.
--
-- ⚠️ **밴드 안 per-base 단조는 이 레인의 목표가 아니다.** 기지별 편차(#18=259 vs #20=783,
--    약 3배)는 램프 값이 아니라 `affixSeed` 에서 온다 — 2026-07-28 에 이미 실측으로 확정된
--    별개 축이다(`.omc/research/invasion-16-step-2026-07-28.md`: 램프를 통째로 교환해도 승률이
--    안 따라오고, L3 salt 만 바꾸면 4.2% ↔ 45.8% 로 뒤집힌다). shift 배열을 흔들어 그 편차를
--    없애 보려 했으나(실측: 하위 평균 1802 → 1658 로 **악화**) 그건 노이즈에 맞추는 짓이라
--    되돌렸다.
--
-- ⚠️ **이 수치는 참조봇의 것이다. 절대 계약이 아니다**(ADR-0051). 밴드 간 **순서**와 **바닥
--    대비 부호**만 읽어라. 사람 기준 체감은 하네스 침공 탭(장비 `maxed`)이 정본이다.
--
-- ⚠️ **L2 에도 같은 ① 결함이 남아 있다.** 빈 소켓 역시 기본 수비대가 채우므로(속사포 +
--    스포너 7기) `facilities` 가 소켓을 다 안 채우는 한 같은 감산이 일어난다. 이번엔 안 건드렸다
--    — 현 무대에서 참조봇이 L2 에 **한 번도 도달하지 못해**(L3 도달률 20기지 전부 0%) 잴 수가
--    없기 때문이다. 계측이 L2 에 닿게 되면 그때 같은 방식으로 재앵커하라.
--
-- =============================================================================
-- RAMP 정본 (이 블록은 tests/invasionBalance.test.ts 가 문자열로 대조한다 —
--            SQL 과 테스트 미러가 조용히 갈라지는 것을 막기 위한 드리프트 가드다.
--            식을 바꾸면 이 주석과 테스트 미러를 **함께** 고쳐야 한다.
--            정본은 **이 파일**이다 — 20260803020000 은 이 파일이 덮어썼다.
--            `[a,b,c][nn]` 은 SQL 배열과 같은 **1-기반** 첨자다.)
-- RAMP: level = 20 + (17*(nn-1))/4
-- RAMP: rarity = nn<=7 ? 0 : nn<=11 ? 1 : nn<=15 ? 2 : 3
-- RAMP: ascension = nn<=7 ? 0 : 1
-- RAMP: template = nn<=7 ? 0 : nn<=14 ? 2 : 1
-- RAMP: waves = 6
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

    -- ★ 레벨 재앵커. #14 = 75(수비대 레벨 = 바닥) · #20 = 100(레벨축 포화점). 정수 나눗셈.
    v_level  := 20 + ((17 * (v_nn - 1)) / 4);             -- 20..100
    -- ★ 등급 개시를 밴드 경계로 민다 — 하위(1..7)는 순수 레벨 램프가 된다.
    v_rarity := case when v_nn <= 7 then 0 when v_nn <= 11 then 1
                     when v_nn <= 15 then 2 else 3 end;
    -- 승급은 20260803020000 그대로다 — nn>=8 은 전부 1.
    v_asc    := case when v_nn <= 7 then 0 else 1 end;

    -- 회랑 템플릿: 개활(0) → 병목(2) → 굴곡(1). 동일.
    v_tpl      := case when v_nn <= 7 then 0 when v_nn <= 14 then 2 else 1 end;
    v_socket_n := public.invasion_socket_count(v_tpl);

    -- ★ L1 웨이브 6칸 전량 배치. 빈 칸은 기본 수비대 Lv75 충원이라, 안 채우면 램프가
    --   난이도를 못 갖는다(헤더 원인 ①). 설비 충전량은 20260728013000 값 그대로다.
    v_waves   := 6;
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
      raise exception '램프 재앵커: NPC #% 의 3레이어 배치가 스키마 검증 실패', v_nn;
    end if;

    update public.defenses
      set layout = v_layers,
          budget_spent = 0
      where id = v_def_id;
  end loop;
end;
$$;
