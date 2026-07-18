-- =============================================================================
-- Planet Blitz M4 — verify-pve-sample 주기 실행 스케줄 (pg_cron + pg_net + Vault)
-- =============================================================================
-- 원격 적용 완료: 2026-07-18 (`m4_pve_sample_cron`). 이 파일은 리포 미러.
--
-- 선행 조건(대시보드에서 1회, 2026-07-18 사용자 수행 완료):
--   1. Extensions 에서 pg_net 활성화.
--   2. Vault 에 비밀 2개 등록:
--        project_url      = https://<project-ref>.supabase.co
--        service_role_key = legacy service_role JWT (⚠️ 신형 sb_secret_* 아님 —
--                           EF 게이트웨이 verify_jwt 가 JWT 서명을 검증하고, EF 가
--                           role 클레임 == 'service_role' 을 판정한다. PR#38)
--
-- 동작: 매일 01:30 UTC — flag_pve_anomalies(01:00)가 이상치 계정을 flagged 표기한 뒤,
--   이 잡이 pending PvE 런(플래그 계정 우선 + 랜덤)을 EF 로 전수 재실행 검증한다.
--   비밀은 잡 정의에 평문으로 두지 않고 실행 시점마다 Vault 에서 복호화한다.
--   실행 이력: cron.job_run_details(스케줄러) + net._http_response(EF 응답).
--   실측(2026-07-18): 수동 1회 호출 → HTTP 200 {"checked":0,"verified":0,"rejected":0,"flagged":0}.
create extension if not exists pg_net;

select cron.unschedule('planet-blitz-verify-pve-sample')
  where exists (select 1 from cron.job where jobname = 'planet-blitz-verify-pve-sample');

select cron.schedule(
  'planet-blitz-verify-pve-sample',
  '30 1 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/verify-pve-sample',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"limit":200}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
