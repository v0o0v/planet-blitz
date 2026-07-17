# Supabase — Planet Blitz M4 백엔드

M4 PvP(침공·래더·치트 방어)의 서버 스키마와 적용 절차. 근거: 계획
`.omc/plans/planet-blitz-m4-plan.md` §Phase B, ADR-0002·0004·0005·0006·0007.

- 프로젝트 ref: `qxgbxwyccbxokdgwxcuw` (`.mcp.json` `supabase-planet-blitz`, project scope 고정 — 전역 메모리 규칙: 계정 종속 MCP 는 user scope 금지)
- 마이그레이션: `supabase/migrations/`

## 마이그레이션 목록

| 파일 | 내용 |
|---|---|
| `20260717000000_m4_initial_schema.sql` | 7테이블(profiles·ships·items·ladder·defenses·invasions·guardians) + RLS 정책 + 인덱스 + 서버 권위 가드 트리거 |

## 테이블 요약

| 테이블 | 역할 | 클라이언트 권한(RLS) |
|---|---|---|
| `profiles` | Auth uid 연계 세이브 JSON + saveVersion | 본인 행 select/insert/update. `flagged`(치트 플래그)는 트리거로 서버 전용 |
| `ships` | 기체 미러(래더·정찰 표시) | 본인 rw, 타인 select(정찰) |
| `items` | 인벤/보관함 미러(사적) | 본인 rw만. 복제 약탈은 service_role |
| `ladder` | 영구 순위표(ADR-0004) | **select만**. 순위 스왑·삽입·침하는 service_role/pg_cron 전용 |
| `defenses` | 방어 배치(DefenseLayout JSON) + 정비도(풍화) | 본인 rw, 타인 select(정찰) |
| `invasions` | 침공 리플레이 blob·결과·검증상태 | **insert(pending 증거)·본인 관련 select만**. 결과 확정 update 는 service_role |
| `guardians` | 수호 기체 M5 자리(최소 스키마) | 본인 rw, 타인 select |

### 서버 권위(원칙2) 보장 방식
- `ladder`: 쓰기 정책을 만들지 않아 RLS 기본 거부 → 클라이언트 직접 순위 조작 불가.
- `invasions`: `trg_invasions_guard_insert` 가 클라이언트 insert 를 `pending`·결과 null 로 강제. update 정책 없음 → 결과 못 바꿈.
- `profiles.flagged`: `trg_profiles_guard` 가 클라이언트 update 시 이전 값 유지 강제.
- `service_role`(Edge Function) 키는 RLS 를 우회(BYPASSRLS)하므로 서버 로직만 순위/결과를 쓴다.
- 역할 판정 헬퍼 `public.is_service_role()`은 `current_user in ('service_role','supabase_admin','postgres')` 로 서버/마이그레이션 컨텍스트를 식별한다.

## 원격 적용 절차 (리드가 MCP 인증 후 실행)

Supabase MCP(`supabase-planet-blitz`)로 인증한 세션에서:

1. **대상 프로젝트 확인**(전역 메모리 규칙 — 쓰기 전 필수):
   - `get_project_url` / `list_tables` 로 `qxgbxwyccbxokdgwxcuw` 를 가리키는지 확인. 다르면 중단.
2. **익명 Auth 활성화**(선행): Supabase Dashboard → Authentication → Sign In / Providers →
   **Anonymous sign-ins 를 Enable**. (클라이언트 `signInAnonymously()` 전제. ADR-0002 · 계획 B3.)
3. **마이그레이션 적용**: `apply_migration` 로 `20260717000000_m4_initial_schema.sql` 실행
   (또는 `supabase db push` — 로컬 CLI 링크 시).
4. **검증**:
   - `list_tables` 로 7테이블 생성 확인.
   - RLS: `select relname, relrowsecurity from pg_class where relname in
     ('profiles','ships','items','ladder','defenses','invasions','guardians');`
     → 모두 `relrowsecurity = true`.
   - 정책 수: `select schemaname, tablename, policyname from pg_policies where schemaname='public';`

## 로컬 문법 점검(Docker 없음)

로컬에 Supabase/Postgres Docker 가 없어 실제 실행 검증은 원격 적용 시점으로 미룬다. 파일
작성 단계에서는 다음을 육안·정적 점검했다:

- 모든 `create table` / `create policy` / `create index` / `create trigger` 문 종결(`;`).
- FK 순환(ladder ↔ defenses)은 `ladder` 를 먼저 만들고 `defenses` 정의 뒤
  `alter table ... add constraint ladder_defense_fk` 로 지연 연결해 해소.
- `enable row level security` 를 7테이블 모두에 적용.
- `pgcrypto` 확장(`gen_random_uuid`) 선언.
- 서버 전용 쓰기 경로(ladder write, invasions 결과 update)에는 정책을 두지 않아 기본 거부.

> pg_cron(풍화 -5%p/주·비활성 침하)은 Phase E 범위라 본 마이그레이션에 없음. `defenses.maintenance`
> · `guardians.performance` 필드만 선반영(감쇠 로직 없음).
