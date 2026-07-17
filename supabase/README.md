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
| `defenses` | 방어 배치(DefenseLayout JSON) + 정비도(풍화) | 본인 rw(단 `maintenance`/`budget_spent`는 트리거로 서버 전용), 타인 select(정찰) |
| `invasions` | 침공 리플레이 blob·결과·검증상태 | **insert(pending 증거)·본인 관련 select만**. 결과 확정 update 는 service_role |
| `guardians` | 수호 기체 M5 자리(최소 스키마) | 본인 rw, 타인 select |

### 서버 권위(원칙2) 보장 방식
- `ladder`: 쓰기 정책을 만들지 않아 RLS 기본 거부 → 클라이언트 직접 순위 조작 불가.
- `invasions`: `trg_invasions_guard_insert` 가 클라이언트 insert 를 `pending`·결과 null 로 강제. update 정책 없음 → 결과 못 바꿈.
- `profiles.flagged`: `trg_profiles_guard` 가 클라이언트 update 시 이전 값 유지 강제.
- `defenses.maintenance`/`defenses.budget_spent`: `trg_defenses_guard` 가 클라이언트 update 시 이전 값 유지 강제(코드리뷰 HIGH-2 수정) — `defenses_rw_own` 정책 자체는 전 컬럼 update 를 허용하므로, 이 트리거가 없으면 클라이언트가 `maintenance:=100`(풍화 자가회복)이나 `budget_spent:=0`(배치 예산 우회)을 직접 제출할 수 있었다. 정비 회복·예산 검증은 Phase C/E 의 service_role 트랜잭션만 갱신한다.
- `service_role`(Edge Function) 키는 RLS 를 우회(BYPASSRLS)하므로 서버 로직만 순위/결과/정비도를 쓴다.
- 역할 판정 헬퍼 `public.is_service_role()`은 `current_user in ('service_role','supabase_admin','postgres')` 로 서버/마이그레이션 컨텍스트를 식별하며, `search_path = ''` 로 고정해 함수 하이재킹(Supabase linter "function search path mutable" 경고) 여지를 없앤다.

### Phase D 착수 조건 — 정찰 전면 공개는 임시(코드리뷰 MED-5)
`ships_select_others`·`defenses_select_others`·`guardians_select_others` 는 현재 모두
`using (true)`(로그인 유저 전체가 타인 행을 읽을 수 있음)다. 이는 **M4 착수 단계의 의도된
임시 상태**다 — Phase C(방어 에디터)가 아직 없어 정찰 UI 도 없고, 매치메이킹(관제탑 상위
3명+30위 랜덤 제안) 대상이 정해지지 않아 "누구를 볼 수 있어야 하는가"를 좁힐 기준이 없다.

Phase D(침공 검증·래더 스왑, 계획 §4)에서 매치메이킹 RPC 를 붙이는 시점에:
- 위 세 정책을 폐기(또는 `select` 를 제거)하고, "현재 나에게 제안된 상대만" 조회 가능한
  Edge Function RPC 또는 `security definer` 뷰로 교체한다.
- `ships.equipped`(장착 아이템 노출)는 정찰에서 얼마나 보여줄지 밸런싱 이슈이므로 그때
  필드 단위로 재검토한다(전량 노출 vs 슬롯 존재만 노출 등).

지금 단계에서 미리 좁히는 구현은 하지 않는다(대상 기준 자체가 Phase D 산출물이라 조기
구현은 재작업 위험이 크다) — 이 SQL 주석과 표가 후속 작업자를 위한 착수 조건 기록이다.

### Phase D 착수 조건 — defenses INSERT/DELETE 경로 서버 권위(재리뷰 잔여 MEDIUM)

`guard_defenses_client_write`(HIGH-2 수정)는 **UPDATE 경로**에서만 `maintenance`/
`budget_spent` 를 서버 전용으로 고정한다. INSERT/DELETE 경로는 아직 다음 구멍이 남아
있고, 둘 다 Phase C(방어 에디터)·Phase D(침공 검증)·Phase E(풍화)가 실제 붙기 전에는
악용해도 게임에 영향이 없어(래더 스왑·정비 회복 로직 자체가 없음) M4 Phase B 범위 밖으로
남겨둔다. 후속 단계 착수 조건으로 기록한다:

1. **INSERT 시 budget_spent 자가 신고**: `defenses_rw_own` 은 INSERT 도 허용하므로, 클라
   이언트가 `layout` 은 예산을 초과해 채워놓고 `budget_spent` 는 낮게 신고해 삽입할 수
   있다. Phase C(방어 에디터 저장)·Phase D(침공 검증) 시점에 다음 중 하나로 게이트해야
   한다: ① 방어 저장을 클라이언트 직접 INSERT 가 아니라 service_role Edge Function
   RPC 로만 받고 `layout` 에서 `budget_spent` 를 서버가 직접 산출/검증, 또는 ② INSERT
   트리거로 `layout` 을 파싱해 포탑·장애물 비용 합계와 `budget_spent` 가 일치하는지
   검증(불일치 시 reject). 예산 계산 규칙이 아직 Phase C 산출물(포탑 6종 비용표)에
   달려 있어 이번 마이그레이션에서는 스키마의 `check (budget_spent >= 0)` 이상을 걸지
   않는다.
2. **DELETE→재생성으로 정비도 리셋**: `defenses_rw_own` 은 DELETE 도 허용하므로, 풍화
   (Phase E)로 `maintenance` 가 낮아진 행을 클라이언트가 지우고 `maintenance` 기본값
   100.00 인 새 행을 다시 INSERT 해 풍화를 무력화할 수 있다. `defenses_one_active_idx`
   (프로필당 활성 방어 1개) 는 이 우회를 막지 못한다 — 삭제 후 재삽입이면 유니크 위반이
   나지 않는다. Phase E(풍화 pg_cron) 설계 시 다음을 함께 고려해야 한다: 방어자 식별을
   `defenses.id` 가 아니라 `ladder.defense_id`(공격자가 실제로 침공 판정에 쓰는 앵커)
   기준으로 하면, 방어자가 재생성한 새 `defenses.id` 는 `ladder.defense_id` 가 자동으로
   가리키지 않으므로(수동 재배치 필요) 이 우회의 실효성이 줄어든다 — 다만 재배치 UX 를
   막지 않는 한 완전 차단은 아니므로, DELETE 를 service_role 전용으로 제한하거나 DELETE
   시 `ladder.defense_id` 를 함께 null 화하는 트리거가 최종적으로 필요할 수 있다.
3. **적용 시점 확증 항목(리드 담당, 원격 적용 후)**: 이 문서의 서버 권위 주장은 로컬
   Docker 부재로 실행 검증되지 않았다. 실제 `apply_migration` 직후 다음을 MCP 로
   실측 확인할 것:
   - `list_tables` 로 7테이블 실체(컬럼·타입) 가 이 마이그레이션과 일치하는지.
   - `select relname, relrowsecurity from pg_class where relname in (...)` 전부
     `true`, `pg_policies` 정책 수가 이 문서의 표와 일치하는지(테이블당 정책 수 확인).
   - `pg_trigger` 로 5개 가드/updated_at 트리거(`trg_profiles_guard`,
     `trg_defenses_guard`, `trg_invasions_guard_insert`, 그리고 7개 `*_updated_at`)
     가 실제로 걸려 있는지.
   - **Edge Function 컨텍스트에서 `select current_user, public.is_service_role();`
     을 실행해 `current_user = 'service_role'` 이고 `is_service_role() = true` 가
     나오는지 실측** — 이 문서의 서버 권위 설계 전체(가드 트리거들의 "not
     is_service_role()" 분기)가 이 가정 위에 서 있으므로, Edge Function 이 실제로
     `service_role` 컨텍스트에서 PostgREST/DB 연결을 맺는지(그렇지 않고 예컨대 별도
     서비스 계정 role 이름을 쓴다면 `is_service_role()` 정의를 그 role 이름을 포함
     하도록 갱신해야 함) 코드로 가정만 하지 말고 원격 적용 후 한 번은 직접 찍어봐야
     한다.

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
- **테이블 생성 순서 vs FK 참조 대상 전수 재점검(코드리뷰 CRITICAL-1 재발 방지)**:
  1. `profiles`(→ `auth.users`, Supabase 내장이라 항상 존재) →
  2. `ships`(→ `profiles`, 이미 생성됨 OK) →
  3. `items`(→ `profiles` OK) →
  4. `ladder`(→ `profiles` OK; `defense_id` 는 **FK 없이 plain uuid** 로 선언 — `defenses`
     가 아직 없으므로 인라인 `references` 를 걸면 이 시점에 즉시 실패한다) →
  5. `defenses`(→ `profiles` OK). 이 섹션 끝에서 `alter table ladder add constraint
     ladder_defense_fk ... references defenses(id)` 로 지연 연결(`defenses` 가 방금
     생겼으므로 OK) →
  6. `invasions`(→ `profiles` ×2 OK, → `defenses` OK — 5번에서 이미 생성됨) →
  7. `guardians`(→ `profiles` OK).
  전 FK 가 "참조 대상이 실행 시점에 이미 존재"를 만족한다. 최초 버전은 4번 `ladder` 안에
  `defenses` 를 인라인 참조해 리뷰에서 CRITICAL 로 지적됨 — 수정 후 이 순서로 재검증.
- `enable row level security` 를 7테이블 모두에 적용.
- `pgcrypto` 확장(`gen_random_uuid`) 선언.
- 서버 전용 쓰기 경로(ladder write, invasions 결과 update, defenses.maintenance/budget_spent)
  는 정책 부재 또는 가드 트리거로 기본 거부.
- **재실행 안전성**: 모든 `create table`은 `if not exists`, `create index`는
  `if not exists`, `create policy`는 `drop policy if exists` 선행, `create trigger`는
  `create or replace trigger`(PG14+), FK 는 `drop constraint if exists` 선행으로 부분
  실패 후 동일 스크립트 재적용이 에러 없이 수렴한다.
- `supabase db lint` 류 정적 도구는 로컬 CLI/Docker 링크가 없어 이번 세션에서는 실행하지
  못했다 — 원격 적용 후 Supabase Dashboard 의 Advisor(linter) 탭으로 `search_path`·RLS
  누락 등 경고를 재확인 권장.

> pg_cron(풍화 -5%p/주·비활성 침하)은 Phase E 범위라 본 마이그레이션에 없음. `defenses.maintenance`
> · `guardians.performance` 필드만 선반영(감쇠 로직 없음).
