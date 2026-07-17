-- =============================================================================
-- Planet Blitz M4 — Phase E · pg_cron 스케줄 (계획 §4 E3/E4 · AC5)
-- =============================================================================
-- 풍화/침하 잡(_weathering 마이그레이션의 함수)을 주기 실행하도록 pg_cron 에 등록한다.
-- **분리 이유**: pg_cron 활성이 프로젝트 권한/플랜에 따라 실패할 수 있어, 잡 함수(항상
--   적용됨) 와 스케줄(여기)을 나눴다(계약 "pg_cron 불가 시 잡 함수까지는 구현, 대안 문서화").
--   이 마이그레이션이 실패하면 함수는 이미 존재하므로 Supabase Dashboard → Database →
--   Extensions 에서 pg_cron 을 켠 뒤 아래 cron.schedule 3줄만 SQL Editor 로 수동 실행하면
--   된다. 원격 실측(list_extensions)에서 pg_cron default_version 1.6.4 확인 → 활성 가능.
--
-- 스케줄(UTC): 풍화 정비도·수호 성능 = 일요일 00:00(GDD §9 "일요일 자정 UTC"). 비활성
--   침하 = 일요일 00:30(풍화 뒤 실행, 서로 독립). cron.schedule 은 (jobname) 기준 upsert
--   (pg_cron 1.4+)라 재적용 안전.
-- =============================================================================

create extension if not exists pg_cron;

-- 풍화 — 방어 정비도 -5%p (일요일 00:00 UTC).
select cron.schedule(
  'planet-blitz-weather-defenses',
  '0 0 * * 0',
  $$ select public.weather_defenses(); $$
);

-- 풍화 — 수호 기체 성능 -5%p, 바닥 50% (일요일 00:00 UTC).
select cron.schedule(
  'planet-blitz-weather-guardians',
  '0 0 * * 0',
  $$ select public.weather_guardians(); $$
);

-- 비활성 침하 — 30일+ 미접속 순위 하락 (일요일 00:30 UTC).
select cron.schedule(
  'planet-blitz-sink-inactive',
  '30 0 * * 0',
  $$ select public.sink_inactive(); $$
);
