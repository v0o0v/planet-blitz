-- =============================================================================
-- Planet Blitz M7a — NPC 시드 기지 20개 3레이어 재시드 (L7-db-net)
-- =============================================================================
-- 근거: 레인 문서 "L7-db-net" ⑦(NPC 시드 20기지 3레이어 재시드, 난이도 밴드 7/7/6 정합).
--   원 시드는 20260717080000_m4_phase_e_npc_seed.sql(구 layout = core/turrets/obstacles).
--   그 파일은 **수정하지 않는다**(이미 원격 적용). 여기서 layout 만 3레이어로 덮어쓴다.
--
-- 난이도 밴드(원 시드의 rank 배치와 정합 — NN=01 이 가장 쉽고 rank 20, NN=20 이 rank 1):
--   하위 01~07 (7기) — 직선형 맵(소켓 12), 편대 1~3, 설비 2~5, 기물 0~1, 보스 없음~1
--   중하 08~14 (7기) — 굴곡형 맵(소켓 10), 편대 3~5, 설비 5~8, 기물 1,  보스 1
--   중위 15~20 (6기) — 병목형 맵(소켓  8), 편대 5~6, 설비 8(만석), 기물 2, 보스 1
--
-- 카탈로그 계약(배열 인덱스 = catalogId, append-only):
--   편대 data/invasion/formations.ts   0..2 (정찰 드론편대·요격 편대·강습 돌격편대)
--   설비 data/invasion/facilities.ts   0..5 (속사포·관통 레일포·곡사 박격포·레이저 격자·화염 방사구·드론 사출구)
--   기물 data/invasion/props.ts        0..2 (실드 발생기·중력 앵커·고정 주포)
--   보스 data/invasion/defenseBosses.ts 0   (강철 골리앗)
--   카탈로그가 늘면(M7c) 이 시드는 그대로 유효하다 — append-only 라 인덱스가 안 밀린다.
--
-- 스키마 계약: 슬롯 배열은 **고정 길이 + null 허용**(밀집화 금지). 빈 슬롯은 런타임에 기본
--   수비대가 충원하므로(결정 #22) 저난도 기지도 완전한 공백이 되지 않는다.
--   수호 슬롯은 전부 null — NPC 는 퇴역 수호를 갖지 않는다(guardians 테이블에 행 없음).
--   코어 모듈도 전부 null — NPC 는 모듈 경제에 참여하지 않는다.
--
-- 재실행 안전: 고정 UUID 대상 UPDATE 라 멱등(같은 값으로 수렴). 원 시드가 아직 없는 DB 면
--   대상 행이 없어 0건 갱신(에러 없음).
-- **원격 적용 금지** — 리포 커밋만.
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
  v_facils    integer;
  v_props     integer;
  v_fac_kinds integer;
  v_i         integer;
  v_wave_arr  jsonb;
  v_sock_arr  jsonb;
  v_prop_arr  jsonb;
  v_boss      jsonb;
  v_layers    jsonb;
begin
  for v_nn in 1..20 loop
    v_def_id := ('000000de-f000-4000-8000-' || lpad(v_nn::text, 12, '0'))::uuid;

    -- 강화 3축(레벨·승급·등급) — 번호가 클수록 강하다.
    v_level  := least(99, 1 + (v_nn - 1) * 3);
    v_rarity := case when v_nn <= 7 then 0 when v_nn <= 14 then 1 when v_nn <= 18 then 2 else 3 end;
    v_asc    := case when v_nn <= 10 then 0 when v_nn <= 16 then 1 else 2 end;

    -- 맵 템플릿(밴드) + 소켓 수(INVASION_SOCKET_COUNTS = [12,10,8]).
    v_tpl      := case when v_nn <= 7 then 0 when v_nn <= 14 then 1 else 2 end;
    v_socket_n := public.invasion_socket_count(v_tpl);

    -- 채울 슬롯 수(상한은 스키마 고정 길이).
    v_waves  := least(6, 1 + ((v_nn - 1) / 3));
    v_facils := least(v_socket_n, 2 + ((v_nn - 1) / 2));
    v_props  := case when v_nn <= 6 then 0 when v_nn <= 13 then 1 else 2 end;
    -- 저난도일수록 설비 종류를 좁게 쓴다(속사포 위주 → 전 종류).
    v_fac_kinds := case when v_nn <= 7 then 2 when v_nn <= 14 then 4 else 6 end;

    -- L1 웨이브 슬롯 6(고정 길이).
    v_wave_arr := '[]'::jsonb;
    for v_i in 0..5 loop
      if v_i < v_waves then
        v_wave_arr := v_wave_arr || jsonb_build_array(jsonb_build_object(
          'catalogId', v_i % 3,
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
          'catalogId', v_i % v_fac_kinds,
          'level', v_level,
          'ascension', v_asc,
          'affixSeed', (v_nn * 2000 + v_i * 13)::bigint,
          'rarity', v_rarity));
      else
        v_sock_arr := v_sock_arr || jsonb_build_array('null'::jsonb);
      end if;
    end loop;

    -- L3 기물 소켓 6(고정 길이).
    v_prop_arr := '[]'::jsonb;
    for v_i in 0..5 loop
      if v_i < v_props then
        v_prop_arr := v_prop_arr || jsonb_build_array(jsonb_build_object(
          'catalogId', v_i % 3,
          'level', v_level,
          'ascension', v_asc,
          'affixSeed', (v_nn * 3000 + v_i * 17)::bigint,
          'rarity', v_rarity));
      else
        v_prop_arr := v_prop_arr || jsonb_build_array('null'::jsonb);
      end if;
    end loop;

    -- L3 방어 보스(하위 6기는 미배치 → 기본 수비대가 lv1 노말로 충원).
    if v_nn <= 6 then
      v_boss := 'null'::jsonb;
    else
      v_boss := jsonb_build_object(
        'catalogId', 0,
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
              'guardians', '[null,null]'::jsonb,
              'props', v_prop_arr,
              'core', jsonb_build_object('hp', 8000, 'x', 0, 'y', 0),
              'modules', '[null,null]'::jsonb)
    );

    -- 방어 무결성 가드: 스키마 검증을 통과하지 못하는 시드는 만들지 않는다(생성 로직 회귀 감지).
    if not public.invasion_layers_valid(v_layers) then
      raise exception 'm7a seed: NPC #% 의 3레이어 배치가 스키마 검증 실패', v_nn;
    end if;

    update public.defenses
      set layout = v_layers,
          budget_spent = 0
      where id = v_def_id;
  end loop;
end;
$$;
