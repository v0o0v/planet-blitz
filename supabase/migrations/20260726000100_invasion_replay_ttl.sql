-- =============================================================================
-- Planet Blitz ADR-0026 — 침공 리플레이 압축 보존 + 48시간 TTL (무료 티어 용량 절감)
-- =============================================================================
-- ▮ 배경
--   invasions.replay(jsonb, 재현 입력)와 client_result(jsonb, 해시 스트림 증거)는 전수 재검증
--   에만 쓰이고, 검증이 확정되면 "재실행 입력" 으로서의 역할이 끝난다. 그러나 관전
--   (replaySpectate, F3)이 replay 를 재생하므로 즉시 삭제할 수는 없다. 원본 jsonb 두 컬럼은
--   무겁다(수백 KB급) — 무료 티어 DB 용량을 빠르게 잠식한다.
--
-- ▮ 조치(EF verify-invasion 배선과 짝)
--   1) 검증 확정 직후 EF 가 replay 를 gzip 압축(CompressionStream)해 bytea 컬럼 replay_gz 에
--      넣고 원본 replay·client_result 를 null 화한다(store_invasion_replay_gz RPC). 관전은
--      replay_gz 를 풀어 재생한다(get_invasion_replay_gz RPC → 클라 DecompressionStream).
--   2) 48시간 지난 압축 리플레이도 매시 cron 이 replay_gz 를 null 로 지운다. 결과 행(승패·
--      attacker/defender·래더 흔적)은 보존하고 리플레이 blob 만 제거한다.
--
-- ▮ 검증 로직 무변경: 이 마이그레이션과 EF 배선은 **저장/보존만** 바꾼다. 전수 재실행 검증
--   자체(verifyInvasionCore)는 한 줄도 손대지 않는다.
--
-- 재실행 안전: add column if not exists, drop not null(멱등), create or replace function,
--   search_path='' 고정, 권한 재적용, cron.schedule 은 (jobname) upsert(pg_cron 1.4+).
--   pg_cron 은 원격에서 이미 활성(1.6.4) — create extension if not exists 는 참고·안전판이다.
-- 원격 적용은 하지 말 것(리포 마이그레이션만; 원격은 리드 승인 후).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. replay_gz 컬럼 + replay·client_result not null 제약 해제
-- -----------------------------------------------------------------------------
-- 검증 후 원본 jsonb 를 null 화하려면 not null 제약(20260717000000:332-333)을 풀어야 한다.
-- drop not null 은 멱등(이미 nullable 이면 no-op)이라 재적용 안전하다.
alter table public.invasions add column if not exists replay_gz bytea;
alter table public.invasions alter column replay drop not null;
alter table public.invasions alter column client_result drop not null;

-- -----------------------------------------------------------------------------
-- 2. store_invasion_replay_gz — 압축본 저장 + 원본 null 화 (service_role 전용)
-- -----------------------------------------------------------------------------
-- EF(verify-invasion)가 검증 확정 후 호출한다. base64 문자열을 받아 decode 로 bytea 에 싣고
-- (supabase-js REST 가 raw bytea 바이너리를 직접 못 실어 base64 를 경유한다), 원본 replay·
-- client_result 를 비운다. security definer + service_role 전용이라 클라이언트가 임의 침공의
-- 리플레이를 지우거나 위조 압축본으로 덮어쓸 수 없다.
create or replace function public.store_invasion_replay_gz(p_id uuid, p_gz text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invasions
     set replay_gz     = decode(p_gz, 'base64'),
         replay        = null,
         client_result = null
   where id = p_id;
end;
$$;

revoke all on function public.store_invasion_replay_gz(uuid, text) from public;
revoke all on function public.store_invasion_replay_gz(uuid, text) from anon;
revoke all on function public.store_invasion_replay_gz(uuid, text) from authenticated;
grant execute on function public.store_invasion_replay_gz(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3. get_invasion_replay_gz — 압축본 base64 반환 (관전, 참여자 전용)
-- -----------------------------------------------------------------------------
-- 관전 클라(getInvasionReplay)가 replay(jsonb)가 null 일 때 호출한다. bytea 를 REST 로 직접
-- 읽으면 '\x' hex 로 와 처리가 번거로우므로, base64 로 인코딩해 돌려준다(클라는 그대로
-- DecompressionStream 에 태운다). security definer 지만 내부에서 호출자가 그 침공의
-- 공격자/방어자인지 직접 게이트한다(RLS invasions_select_participant 와 동일 권한 경계).
-- 참여자 아님·행 부재·미압축(replay jsonb 경로)·48h 만료 → null.
create or replace function public.get_invasion_replay_gz(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_me  uuid := auth.uid();
  v_gz  bytea;
  v_att uuid;
  v_def uuid;
begin
  if v_me is null then
    return null;
  end if;
  select replay_gz, attacker_id, defender_id
    into v_gz, v_att, v_def
    from public.invasions
   where id = p_id;
  if not found then
    return null;
  end if;
  if v_me <> v_att and v_me <> v_def then
    return null;
  end if;
  if v_gz is null then
    return null;
  end if;
  return encode(v_gz, 'base64');
end;
$$;

revoke all on function public.get_invasion_replay_gz(uuid) from public;
revoke all on function public.get_invasion_replay_gz(uuid) from anon;
grant execute on function public.get_invasion_replay_gz(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. TTL cron — 48시간 초과 압축 리플레이 제거 (매시 정각 UTC)
-- -----------------------------------------------------------------------------
-- 20260718150000(스냅샷 GC)과 동일 계약. cron.schedule 은 (jobname) upsert 라 재적용 안전하다.
-- 결과 행은 보존하고 리플레이 blob(replay_gz·replay·client_result)만 null 로 비운다. verified_at
-- 기준 48h — 미확정(pending) 행(verified_at is null)은 대상이 아니다.
--
-- ⚠️ replay_gz 뿐 아니라 원본 replay(jsonb)·client_result 도 함께 지운다: **조기 구조 reject**
--   (verify-invasion index.ts 의 malformed 등 early return)는 archiveReplay 를 거치지 않아
--   replay_gz 가 없고 원본 replay(jsonb)만 남는다 — replay_gz 만 비우면 이 무거운 조기거부
--   리플레이가 영원히 잔존해 용량이 샌다(치터가 malformed 침공을 스팸하면 비용 누수 벡터).
--   확정(verified_at) 후 48h 면 관전 창도 지났으므로 세 컬럼 모두 안전하게 비운다.
create extension if not exists pg_cron;

select cron.schedule(
  'planet-blitz-gc-invasion-replays',
  '0 * * * *',
  $$ update public.invasions
        set replay_gz = null, replay = null, client_result = null
      where verified_at is not null
        and verified_at < now() - interval '48 hours'
        and (replay_gz is not null or replay is not null or client_result is not null); $$
);
