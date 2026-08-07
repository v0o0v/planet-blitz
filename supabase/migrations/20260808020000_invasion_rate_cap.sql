-- =============================================================================
-- 축 A — 침공 빈도 캡 (ADR-0050 §3 단계 2)
-- =============================================================================
--
-- ## 무엇이 열려 있었나 (착수 전 실측)
--
-- 단계 2 의 네 축 중 침공 빈도는 **완전히 무계**였다:
--   · 있는 것은 **쌍(공격자×방어자) 1시간 재도전 쿨다운** 하나뿐이고
--     (20260726000000:332-349) 그마저 **복수 침공은 통째로 면제**한다.
--   · 그 쿨다운의 분모는 "같은 상대"라 **상대를 바꾸면 그만**이다. 서로 다른 방어자 N명이면
--     시간당 N회가 열린다.
--   · 삽입 게이트는 `invasions_insert_attacker`(20260717000000:353-357)뿐인데
--     `attacker_id = auth.uid()` 만 검사하고 **빈도와 무관**하다.
--   · grep 실측: `count(*)` ∩ `invasions` **0건**, 침공 빈도 관련 캡 상수 **0건**.
--
-- 즉 클라는 PostgREST 직타로 `invasions` 행을 **무제한 생성**할 수 있었다.
--
-- ## 왜 이 축이 축 B 까지 좌우하는가
--
-- 복제 약탈 개수(축 B)는 분모가 전부 서버측이라 그 자체로는 유계다
-- (`limit 3` + 공격자 인벤 200 — 20260726000000:440-445). 그러나 **상한이 축 A 에 종속**이라
-- "3개 × 무제한 침공" = 무제한이었다. 이 캡이 서면 축 B 도 **시간당 3×20 = 60개**로 함께 닫힌다.
-- 축 하나를 닫아 둘이 닫히는 자리다.
--
-- ## ⭐ 분모
--
--   > 캡이 유계이려면 분모가 클라 통제 밖이어야 한다. 분모가 클라 주장이면 캡은 장식이다.
--
-- 여기 분모는 `now()` 벽시계 + `public.invasions` 의 실제 행 수다 — **둘 다 서버 것**이다.
-- 클라가 주는 값은 캡 판정에 한 조각도 안 들어간다. 선례는 의뢰 축의 세 캡이고
-- (발령 20/h · 출격 12/h · 폐기 30/h — 20260803030000:29-94) **그 형태를 그대로 넓혔다.**
--
-- ## 왜 트리거인가 (그리고 왜 이번엔 안전한가)
--
-- 침공 행은 **클라가 PostgREST 로 직접 insert** 한다(위 RLS 정책). 그래서 캡을 걸 RPC 가
-- 없고 트리거가 유일한 자리다.
--
-- ⚠️ 트리거 설계는 이 레인에서 한 번 밟았다 — `pve_runs` 에 같은 형태를 두려다
-- `settle_pve_run` 이 그 테이블에 직접 insert 하는 것을 발견하고 기각했다(20260808000000 §기각).
-- 그래서 이번엔 **모든 insert 경로를 먼저 전수 조사했다**:
--   · 프로덕션 RPC 중 `insert into public.invasions` 를 하는 것은 **0건**(grep 실측).
--   · 유일한 서버측 insert 는 `supabase/tests/*.sql` 검증 스크립트다(service_role 컨텍스트).
-- ⇒ service_role 은 면제한다. 위협 모델상 **캡의 대상은 클라(authenticated)** 이고,
--   service_role 키는 서버 전용이라 클라가 그 경로에 닿을 수 없다. guard 계열이 쓰는
--   `is_service_role()` 관용구와 같다(20260727000000:140-148).
--
-- ## 확정(apply_invasion_result)은 따로 안 막는다
--
-- 축 A 의 문면은 "침공 시도·확정"이지만, **확정은 시도 위에 얹혀 있다** — 확정은 기존
-- 침공 행 1건을 pending → verified 로 옮기는 멱등 연산이라(20260726000000:290-304 조기 반환)
-- 행 수를 넘지 못한다. 시도를 20/h 로 묶으면 확정도 같이 묶인다. **캡을 두 겹으로 두면
-- 유지비만 늘고 유계성은 안 는다.**
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 침공 시도 빈도 캡
-- -----------------------------------------------------------------------------
-- 초과 시 `raise exception` 이다 — 조용한 절삭(캡 계열의 다른 관용구)을 쓰지 않는 이유는
-- insert 가 클라 직타라 **깎을 대상이 없기** 때문이다. 행을 만들거나 안 만들거나 둘 뿐이고,
-- 클라는 거부를 알아야 재시도 루프를 멈춘다. errcode 를 붙여 클라가 네트워크 오류와 구분한다.
create or replace function public.guard_invasions_rate_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- 시간당 침공 시도 상한. 의뢰 발령 20/h(20260803030000:29)와 같은 눈금을 쓴다 —
  -- 침공 1건은 완주해야 하는 런이라 정직한 최상위 플레이어도 20/h 에 닿지 않는다.
  CAP_INVASIONS_PER_HOUR constant integer := 20;
  v_count integer;
begin
  -- service_role 면제: 프로덕션 insert 경로가 0건이고, 남은 서버측 insert 는
  -- supabase/tests/*.sql 검증 스크립트뿐이다(위 §왜 트리거인가).
  if public.is_service_role() then
    return new;
  end if;

  select count(*) into v_count
    from public.invasions
    where attacker_id = new.attacker_id
      and created_at > now() - interval '1 hour';

  if v_count >= CAP_INVASIONS_PER_HOUR then
    raise exception
      'invasion rate limit: 시간당 침공 시도 상한(%)을 넘었습니다', CAP_INVASIONS_PER_HOUR
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ⚠️ 기존 self-invasion 가드 트리거(20260717030000)와 **공존**해야 한다. 이름을 달리 둬
-- 서로를 덮지 않는다 — 이 리포는 재정의가 이전 축을 떨어뜨리는 결함을 반복해 겪었다.
create or replace trigger trg_invasions_rate_limit
  before insert on public.invasions
  for each row execute function public.guard_invasions_rate_limit();

-- 캡 조회 축. attacker_id + created_at 이 곧 분모다.
create index if not exists invasions_attacker_created_idx
  on public.invasions (attacker_id, created_at desc);
