-- =============================================================================
-- Planet Blitz M5 — 침공 스냅샷 GC (pg_cron: 1시간 초과 스냅샷 정리)
-- =============================================================================
-- invasion_snapshots(20260718130000)는 begin_invasion 이 호출마다 한 행씩 발급한다.
-- EF 는 신선도 1시간(SNAPSHOT_FRESHNESS_MS)을 넘긴 스냅샷을 라이브 경로로 폴백하므로, 그
-- 시점 이후 스냅샷 행은 검증에 무의미하다. 누적 방지로 1시간 초과분을 주기 삭제한다.
--
-- 분리 이유(20260717120000 cron 마이그레이션과 동일 계약): pg_cron 활성이 프로젝트 권한/
--   플랜에 따라 실패할 수 있어, **자격 검증·유니크 인덱스(20260718140000, 항상 적용돼야 함)**
--   와 스케줄(여기)을 별도 파일로 나눈다. 이 파일이 실패해도 스냅샷 정합·1회성 강제는 이미
--   적용된 상태다. 실패 시 Dashboard → Extensions 에서 pg_cron 을 켠 뒤 아래 cron.schedule
--   1줄만 SQL Editor 로 수동 실행하면 된다.
--
-- 삭제 시 invasions.snapshot_id 는 on delete set null(20260718130000 FK)로 자동 정리되지만,
--   확정 침공의 감사 흔적을 남기려면 이미 참조된(=검증 완료) 스냅샷은 보존할 여지도 있다.
--   현 단계는 단순·안전 우선으로 created_at 1시간 초과 전량을 정리한다(확정 후 스냅샷은
--   검증에 재사용 불가 — 유니크 인덱스·신선도 게이트 — 이라 삭제해도 무결성 무영향).
-- 재실행 안전: cron.schedule 은 (jobname) upsert(pg_cron 1.4+). 원격 적용은 리드 몫.
-- =============================================================================

create extension if not exists pg_cron;

-- 침공 스냅샷 GC — 1시간 초과 발급분 삭제 (매시 정각 UTC).
select cron.schedule(
  'planet-blitz-gc-invasion-snapshots',
  '0 * * * *',
  $$ delete from public.invasion_snapshots where created_at < now() - interval '1 hour'; $$
);
