-- =============================================================================
-- Planet Blitz M4 — Phase F · F4 PvE 샘플링 검증(축소 범위: 통계 이상치 플래그) (계획 §4 F4 · AC11)
-- =============================================================================
-- 근거: GDD §11(line152 "PvE 검증 = 샘플링 재실행: 래더 상위 N%·통계 이상치(시간당 획득량
--   상한 초과)·랜덤 소수. 적발 시 런 무효+계정 플래그"), ADR-0005, phase-f-contract.md 계약 4.
--
-- ★ 범위 결정(계약 4 조건 분기): **리플레이 재실행 샘플링은 이번 범위에서 제외**, 통계
--   이상치 플래그만 구현한다. 근거 = profileSync(src/net/profileSync.ts)가 서버에 남기는
--   PvE 데이터는 **집계 세이브(profiles.save: credits/minerals/ships/inventory) 한 벌뿐**이며
--   (serializeProfile → 전체 Profile 통짜 업로드, last-write-wins 단일 슬롯), **개별 PvE 런
--   기록도 리플레이 blob 도 서버에 존재하지 않는다**. 재실행할 리플레이가 없으므로 상위 N%
--   재실행·랜덤 1% 재실행은 성립 불가. "적발 시 런 무효"도 런 단위 기록이 없어 불가 → 계정
--   플래그(profiles.flagged)만 세팅. 리플레이 재실행 샘플링 착수 조건은 아래 및 README 에 문서화.
--
-- 담는 것:
--   1. flag_pve_anomalies(RPC/cron) — 세이브 집계로 계정 수명당 자원 획득률이 시간당 상한을
--      초과하는 명백한 이상치를 profiles.flagged=true 로 표기(서버 전용 필드, 기존 가드 활용).
--   2. pg_cron 스케줄 등록(일 1회).
--
-- 재실행 안전성: create or replace, cron.schedule(jobname upsert). 함수와 스케줄을 한 파일에
--   두되, 스케줄 실패(권한/플랜)해도 함수는 남는다(Phase E 선례처럼 Dashboard 수동 등록 가능).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. flag_pve_anomalies — 통계 이상치 계정 플래그
-- -----------------------------------------------------------------------------
-- 판정: 계정 수명(now-created_at) 대비 총 보유 자원(credits+minerals) 획득률이 시간당
--   상한(p_hourly_cap)을 초과하면 이상치로 플래그. 오탐 방어를 위해 (a) 최소 계정 나이
--   (p_min_age_hours) 이상, (b) 최소 총자원(p_min_total) 이상인 계정만 대상으로 한다
--   — 갓 만든 계정이 소액을 순간 획득해 율이 폭증하는 오탐을 배제.
-- NPC(is_npc)·이미 플래그된 계정은 제외. 반환 = 이번에 신규 플래그된 계정 수.
--
-- ⚠️ 이는 "명백한 불가능 획득률" 만 잡는 보수적 1차 방어선이다. 정교한 슬로우핵·부분 치트는
--   집계만으로 못 잡으며(ADR-0005 가 수용한 트레이드오프), 리플레이 재실행 샘플링(착수 조건)이
--   붙어야 확률적 적발이 가능하다. 상수는 밸런스 미확정(M5)이라 잠정값 — 운영 지표로 조정.
create or replace function public.flag_pve_anomalies(
  p_hourly_cap    numeric default 100000,   -- 시간당 (credits+minerals) 획득 상한(잠정).
  p_min_age_hours numeric default 1,        -- 이 나이 미만 계정은 율 계산 제외(신규 오탐 방어).
  p_min_total     numeric default 50000     -- 이 총자원 미만은 대상 제외(소액 오탐 방어).
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with candidate as (
    select
      p.id,
      coalesce((p.save->>'credits')::numeric, 0)
        + coalesce((p.save->>'minerals')::numeric, 0)                       as total,
      extract(epoch from (now() - p.created_at)) / 3600.0                   as age_h
    from public.profiles p
    where not p.is_npc
      and not p.flagged
  ),
  outliers as (
    select id
    from candidate
    where age_h >= p_min_age_hours
      and total >= p_min_total
      and (total / age_h) > p_hourly_cap
  ),
  upd as (
    update public.profiles
      set flagged = true
      where id in (select id from outliers)
      returning 1
  )
  select count(*)::integer into v_count from upd;
  return v_count;
end;
$$;

revoke all on function public.flag_pve_anomalies(numeric, numeric, numeric) from public;
revoke all on function public.flag_pve_anomalies(numeric, numeric, numeric) from anon, authenticated;
grant execute on function public.flag_pve_anomalies(numeric, numeric, numeric) to service_role;

-- -----------------------------------------------------------------------------
-- 2. pg_cron 스케줄 — 일 1회 이상치 스캔 (01:00 UTC)
-- -----------------------------------------------------------------------------
-- Phase E 에서 이미 pg_cron 활성(1.6.4). 실패 시: Dashboard → Database → Extensions 에서
--   pg_cron 켠 뒤 아래 cron.schedule 한 줄만 SQL Editor 로 수동 실행.
create extension if not exists pg_cron;

select cron.schedule(
  'planet-blitz-flag-pve-anomalies',
  '0 1 * * *',
  $$ select public.flag_pve_anomalies(); $$
);

-- =============================================================================
-- 착수 조건 — 리플레이 재실행 샘플링 (F4 완전판, 이번 범위 밖)
-- =============================================================================
-- 아래가 갖춰지면 EF verify-pve-sample + pg_cron 으로 상위 N%·랜덤 1% 리플레이 재실행 검증을
-- 붙인다(계획 §4 F4 원안). 현재 미충족 항목:
--   1. PvE 런 서버 기록: profileSync 는 집계 세이브만 올린다. PvE 런 단위 결과(시드·입력·해시·
--      획득 자원)를 서버 테이블(예: pve_runs)에 남기는 배선이 필요(용량·빈도 트레이드오프라
--      리드/사용자 판단 — 리플레이 blob 업로드 여부 포함).
--   2. 재실행 인프라: verify-run EF(Phase A)의 결정론 재실행을 PvE 런에 재사용. 상위 N%·시간당
--      획득 이상치·랜덤 1% 대상 선정(OQ-M4-2 기본안: 상위 5%+상한 초과+랜덤 1%).
--   3. 적발 처리: 재실행 불일치 시 해당 런 무효(런 기록 존재 전제) + profiles.flagged=true
--      (본 마이그레이션의 플래그 경로 재사용).
-- =============================================================================
