-- =============================================================================
-- 의뢰서 폐기 (2026-08-03) — `discard_commission` RPC + 폐기 감사 테이블
--
-- ## 왜 필요한가
-- 보관 상한(`COMMISSION_STOCK_CAP` = 12)이 차면 **새 의뢰서가 발령되지 않는다**
-- (`issue_commission_for_run` 4단계). 그런데 그 상한을 내리는 방법이 지금까지 **출격 하나뿐**
-- 이었다 — 계급 1짜리 2구간 의뢰가 12칸을 물고 있으면 플레이어는 원치 않는 런을 12번 돌기 전에는
-- 보스를 아무리 잡아도 아무것도 못 받는다. 발령이 **조용히 스킵**되므로(예외도 알림도 없다)
-- 증상은 "보스를 잡아도 의뢰서가 안 나온다" 하나뿐이고, 원인은 화면 어디에도 안 적혀 있다.
--
-- ## 이 RPC 가 여는 것과 열지 않는 것
-- 여는 것: 자기 소유 미소비 의뢰서 **1장**을 지운다. 그뿐이다.
-- 열지 않는 것: 재화·지급물은 건드리지 않고(폐기에 보상이 없다), `commission_runs` 는 보지도
-- 않으며(이미 출격한 런은 대상이 아니다), 남의 행은 `auth.uid()` 스코프라 애초에 안 보인다.
--
-- ## 리롤 우려에 대해
-- "낮은 계급을 버리고 높은 계급을 노린다"는 경로는 **막지 않는다** — 그것이 이 기능의 용도다.
-- 처리량은 폐기가 아니라 **발령**이 묶는다(`MIN_BOSS_KILL_TICKS` 누적 예약 지평 +
-- `CAP_ISSUE_ATTEMPTS_PER_HOUR` 20/h). 폐기를 무한히 해도 새 의뢰서가 그보다 빨리 나오지 않는다.
-- 그래도 시간당 상한을 두는 이유는 이득 때문이 아니라 **감사 테이블의 쓰기 폭주**를 막기 위함이다.
--
-- ## 왜 감사 테이블을 만드는가
-- 빈도 상한을 세려면 "언제 몇 번 폐기했는가"가 남아야 한다. 그리고 폐기는 **되돌릴 수 없는**
-- 유일한 플레이어 조작이라, 지원 문의("의뢰서가 사라졌다")에 답할 근거가 서버에 없으면 안 된다.
-- payload 를 통째로 남긴다 — 무엇을 버렸는지가 곧 그 문의의 답이다.
--
-- 적용: powershell -ExecutionPolicy Bypass -File scripts\apply-commission-discard-migration.ps1
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 폐기 감사 테이블
-- -----------------------------------------------------------------------------
create table if not exists public.commission_discards (
  discard_id    uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  commission_id uuid not null,
  grade         int  not null,
  payload       jsonb not null,
  discarded_at  timestamptz not null default now()
);

-- 빈도 상한 조회(profile_id + 최근 1시간)가 이 인덱스를 탄다.
create index if not exists commission_discards_profile_time
  on public.commission_discards (profile_id, discarded_at desc);

alter table public.commission_discards enable row level security;

-- 본인 행만 읽는다. **insert/update/delete 정책은 두지 않는다** — 쓰기는 SECURITY DEFINER
-- RPC 만 한다(정책이 없으면 RLS 아래에서 그 동작은 통째로 거부된다).
drop policy if exists commission_discards_select_own on public.commission_discards;
create policy commission_discards_select_own on public.commission_discards
  for select to authenticated
  using (profile_id = auth.uid());

revoke all on table public.commission_discards from anon;
grant select on table public.commission_discards to authenticated;

-- -----------------------------------------------------------------------------
-- 2. discard_commission — 폐기
--
-- 잠금 순서는 `consume_commission` 과 **같다**(commission_inventory 1행만 `for update`).
-- 두 RPC 가 같은 행을 노려도 한쪽이 먼저 지우고 다른 쪽은 `not found` 로 떨어진다 — 즉
-- "출격과 폐기를 동시에 눌러 한 장으로 둘 다" 는 성립하지 않는다.
-- -----------------------------------------------------------------------------
create or replace function public.discard_commission(p_commission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  CAP_DISCARD_PER_HOUR constant int := 30;  -- 미러: commissionServerConstants.ts
  v_me      uuid := auth.uid();
  v_cnt     int;
  v_grade   int;
  v_payload jsonb;
  v_held    int;
begin
  if v_me is null then
    raise exception 'discard_commission: 로그인 필요';
  end if;

  select count(*) into v_cnt
    from public.commission_discards
   where profile_id = v_me and discarded_at > now() - interval '1 hour';
  if v_cnt >= CAP_DISCARD_PER_HOUR then
    raise exception 'discard_commission: 폐기 빈도 상한 초과';
  end if;

  select grade, payload into v_grade, v_payload
    from public.commission_inventory
   where commission_id = p_commission_id and profile_id = v_me
   for update;
  if not found then
    -- **no-op 이 아니라 명시 거부**(mark_commission_active 와 같은 규율) — 조용한 성공은
    -- "이미 출격했다"와 "남의 것이다"와 "오타"를 한 결과로 뭉갠다.
    raise exception 'discard_commission: 의뢰서 없음';
  end if;

  delete from public.commission_inventory where commission_id = p_commission_id;

  insert into public.commission_discards (profile_id, commission_id, grade, payload)
  values (v_me, p_commission_id, v_grade, v_payload);

  select count(*) into v_held from public.commission_inventory where profile_id = v_me;

  return jsonb_build_object('commission_id', p_commission_id, 'held', v_held);
end;
$$;

revoke all on function public.discard_commission(uuid) from public;
revoke all on function public.discard_commission(uuid) from anon;
grant execute on function public.discard_commission(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. 폐기 감사 보존 — 90일 (cron)
--
-- 빈도 상한이 보는 창은 1시간이고 지원 문의도 그렇게 오래 거슬러 오지 않는다. 무한 누적은
-- 비용일 뿐이라 자른다(다른 의뢰 cron 들과 같은 결).
-- -----------------------------------------------------------------------------
-- ⚠️ 테이블을 `public.` 으로 수식한다 — pg_cron 은 스케줄 롤의 search_path 로 돌아
--    `set search_path=''` 규율 **밖**이다(같은 파일의 다른 의뢰 cron 들과 같은 규율).
--    `cron.schedule` 은 (jobname) upsert 라 재적용 안전하다. 이름 접두사도 기존 4개와 맞춘다.
--    시각은 일간 GC 가 몰린 02:00 UTC 대에서 기존 분(0·15·20·25)과 겹치지 않는 35분을 쓴다.
select cron.schedule(
  'planet-blitz-gc-commission-discards',
  '35 2 * * *',
  $$ delete from public.commission_discards
      where discarded_at < now() - interval '90 days'; $$
);
