-- =============================================================================
-- Planet Blitz M4 — Phase F 코드리뷰 REQUEST_CHANGES 반영 (2026-07-17)
-- =============================================================================
-- 1. [HIGH·회귀] guard_invasions_client_insert 자기 침공 raise 복원.
--    Phase D `20260717030000` 이 CRITICAL 수정으로 이 함수 최상단에 넣은 self-invasion
--    raise(역할 무관)를, Phase F `20260717140000` 이 같은 함수를 create or replace 하며
--    빠뜨려 insert 층 차단이 사라졌다(apply_invasion_result 3차 가드는 남아 있어 경제
--    악용은 불가했으나, CRITICAL 로 추가된 다층 방어의 한 층 회귀). Phase D 원문 블록을
--    그대로 최상단에 복원한다.
--
--    ★★ 재발 방지: **이 함수(guard_invasions_client_insert)를 이후 어느 마이그레이션에서든
--    create or replace 로 재정의할 때는, 최상단의 self-invasion raise 블록을 반드시 그대로
--    유지해야 한다**(역할 무관 차단 — 서버 경로에도 정당한 자기 침공은 없다). create or
--    replace 는 함수 몸통 전체를 통째로 갈아끼우므로, 새 몸통에 이 블록을 옮겨 적지 않으면
--    이번처럼 조용히 회귀한다. 통합테스트 T-F7(self insert 거부)이 이 회귀를 잡는 회귀
--    테스트다 — 재정의 시 반드시 재실행할 것.
--
-- 2. [MED] set_invasion_sticker 승자 한정. GDD §8 line122 "침공/방어 **성공 시**" — 스티커는
--    승자의 도발이다. 종전판은 참여자면 승패 무관 설정을 허용해 패자 도발(사양 밖)이
--    가능했다. attacker_won 을 확인해 공격자는 true·방어자는 false 일 때만 설정을 허용하고,
--    아니면 {ok:false, note:'not-winner'} 를 반환한다(미확정 pending/null 도 not-winner —
--    결과 확정 전에는 승자가 없다). 테스트 T-F8(패자 설정 거부).
--
-- 재실행 안전성: create or replace, EXECUTE 권한 재적용.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. guard_invasions_client_insert — self-invasion raise 복원 (Phase D CRITICAL-① 원문)
--    + Phase F 서버 전용 필드 봉인 유지
-- -----------------------------------------------------------------------------
create or replace function public.guard_invasions_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 자기 침공 금지(Phase D 리뷰 CRITICAL — ★재정의 시 이 블록 필수 유지): 매치메이킹
  -- 우회 직접 insert 로 자기(빈) 방어를 이겨 복제 약탈을 파밍하는 경로를 삽입 시점에
  -- 차단. 역할 무관(서버 경로 포함).
  if new.attacker_id = new.defender_id then
    raise exception 'self-invasion is not allowed (attacker = defender)'
      using errcode = 'check_violation';
  end if;

  if not public.is_service_role() then
    new.verified_status := 'pending';
    new.verified_result := null;
    new.attacker_won := null;
    new.verified_at := null;
    -- Phase F: 서버 전용 필드는 클라 insert 로 심을 수 없다.
    new.attacker_sticker := null;
    new.defender_sticker := null;
    new.caused_swap := false;
    new.is_revenge := false;
  end if;
  return new;
end;
$$;

-- 트리거 자체는 기존 정의(before insert) 재사용 — 함수 교체만으로 반영된다.

-- -----------------------------------------------------------------------------
-- 2. set_invasion_sticker — 승자 한정 (리뷰 MED)
-- -----------------------------------------------------------------------------
create or replace function public.set_invasion_sticker(
  p_invasion_id uuid,
  p_sticker smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_inv  public.invasions%rowtype;
  v_side text;
begin
  if v_me is null then
    raise exception 'set_invasion_sticker: 로그인 필요';
  end if;
  if p_sticker is null or p_sticker < 0 or p_sticker > 11 then
    raise exception 'set_invasion_sticker: 스티커 인덱스 0..11 범위 밖 (%)', p_sticker;
  end if;

  select * into v_inv from public.invasions where id = p_invasion_id for update;
  if not found then
    raise exception 'set_invasion_sticker: 침공 % 없음', p_invasion_id;
  end if;

  if v_me = v_inv.attacker_id then
    v_side := 'attacker';
    -- 승자 한정(리뷰 MED): 공격자는 침공 성공(attacker_won=true)일 때만. 미확정(null,
    -- pending)도 아직 승자가 없으므로 거부.
    if v_inv.attacker_won is distinct from true then
      return jsonb_build_object('ok', false, 'side', v_side,
        'sticker', v_inv.attacker_sticker, 'note', 'not-winner');
    end if;
    if v_inv.attacker_sticker is not null then
      return jsonb_build_object('ok', false, 'side', v_side,
        'sticker', v_inv.attacker_sticker, 'note', 'already-set');
    end if;
    update public.invasions set attacker_sticker = p_sticker where id = p_invasion_id;
  elsif v_me = v_inv.defender_id then
    v_side := 'defender';
    -- 승자 한정: 방어자는 방어 성공(attacker_won=false)일 때만. 미확정(null)도 거부.
    if v_inv.attacker_won is distinct from false then
      return jsonb_build_object('ok', false, 'side', v_side,
        'sticker', v_inv.defender_sticker, 'note', 'not-winner');
    end if;
    if v_inv.defender_sticker is not null then
      return jsonb_build_object('ok', false, 'side', v_side,
        'sticker', v_inv.defender_sticker, 'note', 'already-set');
    end if;
    update public.invasions set defender_sticker = p_sticker where id = p_invasion_id;
  else
    raise exception 'set_invasion_sticker: 참여자(공격자/방어자) 본인만 설정 가능';
  end if;

  return jsonb_build_object('ok', true, 'side', v_side, 'sticker', p_sticker, 'note', 'set');
end;
$$;

revoke all on function public.set_invasion_sticker(uuid, smallint) from public;
revoke all on function public.set_invasion_sticker(uuid, smallint) from anon;
grant execute on function public.set_invasion_sticker(uuid, smallint) to authenticated, service_role;
