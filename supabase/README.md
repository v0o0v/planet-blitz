# Supabase — Planet Blitz M4 백엔드

M4 PvP(침공·래더·치트 방어)의 서버 스키마와 적용 절차. 근거: 계획
`.omc/plans/planet-blitz-m4-plan.md` §Phase B, ADR-0002·0004·0005·0006·0007.

- 프로젝트 ref: `qxgbxwyccbxokdgwxcuw` (`.mcp.json` `supabase-planet-blitz`, project scope 고정 — 전역 메모리 규칙: 계정 종속 MCP 는 user scope 금지)
- 마이그레이션: `supabase/migrations/`

## 마이그레이션 목록

| 파일 | 내용 | 원격 적용 |
|---|---|---|
| `20260717000000_m4_initial_schema.sql` | 7테이블(profiles·ships·items·ladder·defenses·invasions·guardians) + RLS 정책 + 인덱스 + 서버 권위 가드 트리거 | ✅ 2026-07-17 (`m4_initial_schema`) — 7테이블·RLS 전부 true·정책 13개·트리거 9개 실측 확인, Advisor 는 익명 Auth 설계상 예상되는 WARN(anonymous access)만 |
| `20260717010000_m4_phase_d.sql` | Phase D — `apply_invasion_result`(래더 스왑+복제 약탈, security definer)·`get_invasion_targets`(매치메이킹 RPC)·`defense_layout_cost`+예산 게이트·`caller_is_service_role`·정찰 3정책 폐기·`ladder.rank` DEFERRABLE | ✅ 2026-07-17 (`m4_phase_d`) — 함수 4개·트리거 이벤트(INSERT+UPDATE)·정책 폐기·DEFERRABLE·EXECUTE 권한 전부 실측 확인(아래 "Phase D 실측 결과") |
| `20260717020000_m4_ladder_public_view.sql` | `get_ladder_top`(순위표 공개 조회 RPC, security definer — 정합 #1) | ✅ 2026-07-17 (`m4_ladder_public_view`) — 빈 래더 0행·authenticated EXECUTE=true/anon=false 실측 |
| `20260717030000_m4_phase_d_review_fixes.sql` | 코드리뷰 반영 — 자기 침공 3중 차단(트리거·EF·apply)·제출 경로 쿨다운 1h/랭크 윈도우 ≤30 강제·복제 약탈 인벤 상한 200 | ✅ 2026-07-17 (`m4_phase_d_review_fixes`) — 원격 DB 통합 테스트 5건 전부 통과(아래 "코드리뷰 반영" 실측) |

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
   - `pg_trigger` 로 가드 트리거 3개(`trg_profiles_guard`, `trg_defenses_guard`,
     `trg_invasions_guard_insert`)와 `*_updated_at` 6개(invasions 는 `updated_at`
     컬럼이 없어 제외)가 실제로 걸려 있는지.
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

## Phase D — 침공 검증·래더 스왑·매치메이킹 (계획 §4, 2026-07-17)

Phase A(verify-run)의 결정론 재실행 검증을 침공(PvP)에 배선하고, 검증 통과 시
래더 스왑·복제 약탈을 서버 권위로 원자 처리하며, 정찰 조회를 매치메이킹 RPC 로
좁힌다. `verify-run/README.md` "Phase D 착수 조건" 3건과 본 문서 "Phase D 착수 조건"
2개 섹션을 모두 이행한다.

### Edge Function `verify-invasion`

| 파일 | 역할 | 플랫폼 전역 참조 |
|---|---|---|
| `functions/verify-invasion/verifyInvasionCore.ts` | 순수 침공 검증 `verifyInvasion(raw, server): InvasionVerifyResult` | 없음(vitest/Deno 테스트 대상) |
| `functions/verify-invasion/index.ts` | `Deno.serve` HTTP·Auth·DB I/O 배선 | `Deno` |
| `functions/verify-invasion/deno.json` | sloppy-imports + `check`/`bundle` 태스크 | — |

> 배포용 자립 번들 `dist.index.js`(36모듈·70KB)는 `deno task bundle`로 생성하며
> **워킹트리에 유지한다**(배포 담당 인수용 — 리드 지시). 파일 머리의
> `/* eslint-disable */` 헤더가 `eslint .` 게이트 오염을 막는다(생성 태스크 후 수동
> 재부착 필요 없음 — 재생성 시 헤더를 다시 붙일 것). `@generated` 주석 참조.

방어 배치 대조 범위: EF 의 `defense-mismatch` 대조(`layoutEquals`)와 `hashWorld` 침공
블록(replay.ts)은 **`core`·`turrets`·`obstacles`만** 접고 비교한다. `DefenseLayout.
guardianSlots`(M5 자리)는 양쪽 모두 대조·해시 대상이 아니므로, 클라 `normalizeLayout`이
`guardianSlots`를 드롭해도(또는 stored layout 에 빈 배열로 있어도) defense-mismatch·
해시에 무해하다(M4 비활성 슬롯).

계약(핸드오프 team-plan.md §D-1, worker-d-client 확인):
- 요청: `POST { invasion_id: string }` (verify_jwt=true, 호출자 = 공격자 본인).
- 응답: `{ status: 'verified'|'rejected', attackerWon, ladder: {attackerRank,defenderRank}|null, loot: LootItem[], reason? }`.
- 클라 `invasions.client_result` shape: `{ attackerWon, coreDestroyed, finalTick, finalHash, hashStream }`.
  `index.ts`가 이를 검증 코어의 `RunClaim`(Phase A shape)으로 사상한다 —
  `outcome = { victory: attackerWon, gameOver: !attackerWon }`(침공은 승리/게임오버로
  수렴하므로 유효). **래더 판정 attacker_won 은 클라 주장이 아니라 서버 재실행
  victory** 로 확정한다.

침공 게이트(verify-run README 착수 조건 이행):
1. **config 정당성** — 클라 제출 `config.invasion.layout`·`timeLimitTicks`를 서버가
   DB(`defenses`)에서 로드한 권위 배치와 정확히(raw IEEE-754 비트) 대조. 불일치는
   `defense-mismatch`. 재실행은 **서버 권위 배치로 오버라이드**해 돌리므로 config
   조작은 hashStream 발산으로도 잡힌다. (⚠️ 잔여: 공격자 자신의 로드아웃 legitimacy
   는 미대조 — 방어 약화 조작만 막고, 자기 강화 축은 후속 게이트로 문서화.)
2. **hashStream 필수화** — 부재 시 `hash-stream-required`(Phase A 선택 → 침공 필수).
3. **재실행 시간예산** — 입력 길이를 `DEFAULT_TIME_LIMIT_TICKS`(10800틱) 이내로 상한
   (`invasion-inputs-too-long`). 동기 재실행은 AbortSignal 로 중단 불가하므로 1차 DoS
   방어선은 이 입력 길이 상한이다(벽시계 초과는 사후 경고 로그만).

위조 거부(AC2): 조작 해시 `final-hash-mismatch` / 변조 입력 `hash-stream-divergence` /
트림 로그 `hash-stream-length-mismatch` / 승패 뒤집기 `outcome-mismatch`.

### Postgres 함수

- **`apply_invasion_result(p_invasion_id, p_verified_result, p_attacker_won)`**
  (security definer, 단일 트랜잭션): verified_* 확정 + (공격자 승 & 양측 placed &
  공격자.rank>방어자.rank) 래더 스왑(ADR-0004) + 복제 약탈(ADR-0003)을 원자 처리.
  멱등(pending 아니면 no-op). **EXECUTE 는 service_role 만**(anon/authenticated 회수).
  - 복제 약탈: 방어자 `inventory` 아이템을 `item_id` 오름차순 최대 3개 복제해 공격자에게
    지급(원본 무손실, item_id 에 `-loot-<inv8>` 접미사로 유니크 회피, `on conflict do
    nothing`). 기본안 OQ-M4-5(양은 튜닝 대상).
  - 엣지 케이스: 래더 행 없음/`placed=false`(배치전 미완료) → 스왑 없음(카운터만). 공격자
    순위가 이미 방어자보다 높음 → 스왑 없음. 정상 매치메이킹은 방어자.rank<공격자.rank.
- **`get_invasion_targets()`** (security definer, authenticated 호출): 내 바로 위 3명 +
  (내 순위-30)~(내 순위-1) 랜덤 1명(시간별 안정 의사난수) 제안. 활성 방어 있는 대상만,
  **재도전 쿨다운 1시간 서버 강제**(최근 1시간 내 공격 대상 제외). 반환 shape 고정:
  `{ profile_id, rank, display_name, ship_summary(jsonb), defense_id, layout(jsonb), maintenance }`.
- **`defense_layout_cost(layout)`**: `layout` 의 포탑(유형별 비용)·장애물 비용 합산.
  비용표는 `src/sim/defense.ts` `TURRET_SPECS[].cost`·`OBSTACLE_COST` 와 일치
  (발칸1·저격3·산탄2·감속2·미사일3·전격2·장애물1).
- **`caller_is_service_role()`**: `request.jwt.claims` 의 role 을 읽어 SECURITY DEFINER
  안에서도 실제 호출자를 판정(아래 "SECURITY DEFINER 주의" 참조).

### Phase D 착수 조건 이행

- **정찰 전면 공개 3정책 폐기(착수 조건 ①)**: `ships_select_others`·`defenses_select_others`·
  `guardians_select_others`(모두 `using(true)`)를 **DROP**. 이제 타인 방어·기체 정찰은
  `get_invasion_targets()` RPC(security definer) 경유로만, "현재 제안된 상대"만 조회
  가능하다. 본인 행(`*_rw_own`)·침공 참여자(`invasions_select_participant`, 리플레이
  관전 F3)는 유지.
- **defenses INSERT/UPDATE 예산 게이트(착수 조건 ②)**: `guard_defenses_client_write`를
  **BEFORE INSERT OR UPDATE** 로 확장. 클라이언트 경로에서 `budget_spent`를 서버가
  `defense_layout_cost(layout)`로 **직접 산출**(자가 신고 불가)하고 기본 예산 20 초과
  시 거부. UPDATE 는 `maintenance` 자가회복도 계속 차단(HIGH-2 승계), INSERT 는
  `maintenance`를 100 으로 강제. (⚠️ DELETE→재생성 정비도 리셋 우회는 Phase E cron
  설계 몫으로 잔존 — 기존 착수 조건 ②-2 문서 유지.)

### SECURITY DEFINER 주의 (설계 반영)

`is_service_role()`(= `current_user` 검사)는 **SECURITY DEFINER 함수 안에서
current_user 가 소유자(postgres)로 바뀌어 항상 true** 가 된다. 따라서 definer 함수의
호출자 권위 판정에는 쓰지 않는다. 대신 (a) **EXECUTE 권한**(apply_invasion_result 는
service_role 만)과 (b) `request.jwt.claims` role 을 읽는 `caller_is_service_role()`
(definer 무관하게 실제 호출자 반영)로 이중 게이트한다. 반면 스키마 가드 트리거들
(guard_*)은 SECURITY INVOKER 라 `is_service_role()` 이 정상 동작(current_user =
실제 실행 role).

### Phase D 실측 결과 (원격 `qxgbxwyccbxokdgwxcuw`, 2026-07-17)

`apply_migration`(`m4_phase_d`) 적용 후 MCP `execute_sql` 로 실측:

- 함수 4개 존재·security 유형: `apply_invasion_result`(definer)·`get_invasion_targets`
  (definer)·`caller_is_service_role`(invoker)·`defense_layout_cost`(invoker) ✅.
- 정찰 3정책(`ships/defenses/guardians_select_others`) 조회 0건 = 폐기 확인 ✅.
- `ladder_rank_key` 제약 `condeferrable=true, condeferred=true` ✅(순위 교차 갱신 안전).
- `trg_defenses_guard` on_insert=true·on_update=true ✅(예산 게이트가 INSERT 도 커버).
- EXECUTE 권한: service_role→apply=true, authenticated→apply=**false**,
  authenticated→targets=true, anon→targets=false, service_role BYPASSRLS=true ✅.
- **확증 4(is_service_role EF 컨텍스트)**: `set local role service_role; select
  current_user, public.is_service_role();` → `current_user='service_role',
  is_service_role()=true` **실측 확인** ✅. definer 함수 안에서는 소유자로 바뀌므로
  이 판정은 스키마 가드 트리거(invoker)에만 쓰고, EF→apply_invasion_result 경로는
  `caller_is_service_role()`+EXECUTE 권한으로 판정한다(위 SECURITY DEFINER 주의).
  - 방법 주석: 이 프로젝트에서 EF 를 직접 invoke 하려면 유효한 사용자 JWT 가 필요해
    본 세션에서는 role 시뮬레이션(SET LOCAL ROLE)으로 함수 거동을 확증했다. 잔여
    가정은 "EF service client 가 실제로 service_role 로 PostgREST 연결을 맺는다"는
    Supabase 문서 보장(service_role 키 → role 클레임 service_role)이며, `defense_layout_cost`·
    권한·스왑 로직은 아래 검증 항목으로 별도 실측했다.
  - **재확증(2026-07-18, `fix/m4-low-carryforward`, MCP `supabase-planet-blitz`)**: 대상
    프로젝트 `get_project_url` = `https://qxgbxwyccbxokdgwxcuw.supabase.co`(의도한 ref 일치).
    `select current_user, public.is_service_role()` → `current_user='postgres',
    is_service_role()=true`(MCP 는 `postgres` 관리 role 로 접속하며 이 role 도 헬퍼의
    화이트리스트 `('service_role','supabase_admin','postgres')` 에 포함돼 true). 이어
    `begin; set local role service_role; select current_user, public.is_service_role();
    rollback;` → `service_role, true` 재확인. **결론**: 스키마 가드 트리거(SECURITY INVOKER)
    가 의존하는 `is_service_role()` 게이트는 실제 서버/마이그레이션 컨텍스트(`service_role`·
    `postgres`)에서 의도대로 true 를 반환한다. 한편 SECURITY DEFINER 함수(`apply_invasion_result`
    등)는 소유자(postgres)로 current_user 가 바뀌어 `is_service_role()` 이 항상 true 가 되므로
    호출자 판정에는 쓰지 않고, `caller_is_service_role()`(`request.jwt.claims` role 판독)+
    EXECUTE 권한(service_role 전용)으로 이중 게이트함을 그대로 유지(위 "SECURITY DEFINER
    주의" 설계 불변). EF 를 유효 JWT 로 실제 invoke 하는 종단 확증은 여전히 리드/사용자 몫.
- `defense_layout_cost` 산출 실측: 발칸1+저격3+산탄2+장애물2 = **8** / 빈 layout=0 /
  키 누락 layout=0 ✅.
- `get_advisors(security)`: 신규 WARN 은 `get_invasion_targets` 의 "authenticated 가
  SECURITY DEFINER 실행 가능" **1건뿐이며 의도된 설계**(매치메이킹 RPC 는 authenticated
  가 자기 기준으로 호출, auth.uid()로 스코프). `apply_invasion_result` 는 목록에 없음
  = authenticated EXECUTE 회수가 실효(래더 쓰기 경로 봉인) 확인. 나머지는 익명 Auth
  설계상 기존 WARN(anonymous access).

### 코드리뷰 REQUEST_CHANGES 반영 (2026-07-17, 마이그레이션 `20260717030000`)

1. **[CRITICAL] 자기 침공 3중 차단**: 매치메이킹 우회 직접 insert 로 자기(빈) 방어에
   승리해 복제 약탈을 무한 파밍하는 경로를 3계층에서 차단 —
   ① `guard_invasions_client_insert` 트리거: `attacker_id = defender_id` insert 를
   raise(역할 무관 — 서버 경로에도 정당한 자기 침공 없음),
   ② EF `index.ts`: inv 로드 직후 self 면 rejected 확정 + 400(`self-invasion`),
   ③ `apply_invasion_result` 진입부: self 확정 시도 raise(심층 방어).
2. **[HIGH] 제출 경로 쿨다운·랭크 윈도우 강제**: `get_invasion_targets` 제안 규칙을
   확정 지점(`apply_invasion_result`)에 복제 — ⓐ이 침공보다 먼저 생성된 동일
   (attacker,defender) 침공이 1시간 내 존재하면(결과 불문 — GDD §8 재도전 쿨다운)
   rejected 확정 + `note: cooldown-violation`(EF 가 `reason: cooldown-violation` 으로
   응답), ⓑ순위 스왑은 격차 `v_att.rank - v_def.rank <= 30` 이내만(우회 침공으로
   30위 밖 상위권 순위를 못 뺏음 — 승패 카운터·약탈만 적용).
3. **[MED] layout 대조 대칭화**: 검증 코어에 `normalizeServerLayout`(클라이언트
   `normalizeLayout`(src/ui/defenseCommand.ts:293)과 자구 동일 규칙: 범위 밖 유형·
   비유한 좌표·halfW/halfH≤0 필터, guardianSlots 드롭) 추가. DB layout 을 정규화한
   본으로 대조·재실행하므로 클라가 정규화 본으로 런·제출해도 오거부되지 않는다.
   정규화 불능(코어 손상)은 `server-layout-invalid` 거부. EF 는 재실행을 try/catch 로
   감싸 예외도 500 이 아니라 `server-layout-invalid` rejected 로 수렴.
4. **[MED] 복제 약탈 상한**: 공격자 `inventory` 총량 200 이상이면 약탈 skip(잠정값,
   Phase E 밸런스 튜닝 전 무한 팽창 방지 — 원본 무손실 원칙 불변).
5. **[LOW] 확정 침공 재조회 응답**: 이미 확정된 침공을 재호출하면 `attackerWon: null`
   이 아니라 **확정된 `attacker_won` 값**을 반환(클라 결과 배너 오표시 방지).

**원격 재적용·DB 통합 실측** (`m4_phase_d_review_fixes` 적용 후, 원격에서 트랜잭션
롤백 방식으로 실행 — 잔류 데이터 0):
- T1 자기 침공 insert → 트리거 raise ✅
- T2 30분 전 동일 대상 침공 존재 → apply = `cooldown-violation` + rejected 확정 ✅
- T3 격차 40(>30) 승리 → 스왑 없음·순위 불변 ✅
- T4 격차 2 승리 → 스왑(3↔5)·복제 약탈 2건·방어자 원본 무손실·공격자 지급 ✅
- T5 공격자 인벤 200개 → 약탈 skip·인벤 불변 ✅

### 리드/클라 정합 포인트 반영 (2026-07-17)

- **순위표 display_name(정합 #1)**: `get_ladder_top(p_limit=50, p_offset=0)` (security
  definer, authenticated) 추가(`20260717020000_m4_ladder_public_view.sql`). 순위표에
  필요한 최소 컬럼 `{profile_id, rank, display_name, wins, losses, placed}`만 페이지네이션
  (상한 200)으로 노출한다. profiles 전면 select 정책은 열지 않는다(민감 컬럼 보호).
  실측: 빈 래더 0행 정상, authenticated EXECUTE=true·anon=false ✅.
- **`ladder.defense_id`(정합 #2)**: Phase D 에서 **미사용**. `get_invasion_targets`는
  `defenses`(active) 를 직접 조인하고, verify-invasion EF 는 **`invasions.defense_id`**
  (클라가 침공 insert 시 채우는 스냅샷 ref)로 방어 배치를 로드한다. `ladder.defense_id`
  는 초기 스키마 주석대로 **Phase E 풍화 앵커**(defenses.id 대신 이 컬럼 기준으로 방어자
  식별 시 DELETE→재생성 우회 완화)용 예약 컬럼이며, service_role 백필 배선은 Phase E 로
  이월. 지금은 아무도 읽지 않으므로 미채움이 정상.
- **defenses 비활성 잔여 행(정합 #3)**: 클라가 활성 행 없을 때 새 active 행 INSERT(이력
  보존)하는 패턴은 `defenses_one_active_idx`(active 부분 유니크)와 정합. 비활성 행은
  매치메이킹(`d.active` 조인)·EF(active fallback)에서 **완전히 무시**되는 불활성 데이터라
  Phase D 서버 정리 정책 불필요. (DELETE→재생성 정비도 리셋 우회는 위 착수 조건 ②-2 대로
  Phase E cron 설계 몫으로 잔존.)
- **budget_spent 비용표 일치(리드 확인 요청)**: 클라 `defenseLayoutCost`(발칸1·저격3·
  산탄2·감속2·미사일3·전격2·장애물1·범위밖→발칸)와 서버 `defense_layout_cost` SQL 이
  동일 매핑임을 확인. 게다가 서버 트리거가 클라 신고값을 **무시하고 layout 에서 재산출**해
  덮어쓰므로(자가 신고 불가) 양측 표가 어긋나도 서버 값이 진실이다. ⚠️ 단 **예산 상한
  20** 은 양측 합의값이어야 한다 — 클라 에디터가 20 초과 배치를 허용하면 서버 INSERT/UPDATE
  가 `check_violation`으로 거부한다.

### 배포 (핸드오프 — deploy 자격 필요)

verify-invasion 은 `src/sim` 전체 그래프를 import 하고 배포 경로는 sloppy-imports 를
못 쓰므로 **자립 번들**로 배포한다. `deno task bundle`(functions/verify-invasion 에서)이
`dist.index.js`(36모듈·70KB, Supabase 런타임 jsr import 는 external 유지)를 산출하며,
로컬에서 `deno check`·`deno bundle` 통과·Deno/vitest 로 검증 코어 동형 확인을 마쳤다.

원격 배포는 deploy 자격이 필요해(이 워커 환경엔 CLI 액세스 토큰 없음, EF invoke 는
사용자 JWT 필요) 리드/사용자 몫으로 남긴다. 방법 중 하나:

- MCP: `deploy_edge_function(name='verify-invasion', entrypoint_path='index.ts',
  verify_jwt=true, files=[{name:'index.ts', content:<dist.index.js 내용>}])`.
- CLI(로그인 후): `supabase functions deploy verify-invasion --project-ref
  qxgbxwyccbxokdgwxcuw`(단, CLI 번들러가 부모 경로 import 를 포함하도록 dist 번들을
  entrypoint 로 지정하거나 사전 번들 사용).

배포 후 스모크: 유효 사용자 JWT 로 `POST {invasion_id}` → 정직 제출 accept·위조 reject
확인, `apply_invasion_result` 스왑·복제 약탈 e2e(AC3).

## Phase E — 배치전·NPC 시드·풍화/정비·비활성 침하 (계획 §4 Phase E, 2026-07-17)

래더 운영층. NPC 시드 기지 20개로 기존 침공 파이프라인을 재사용해 **배치전**(신규
유저 첫 5회)을 성립시키고, **풍화 pg_cron**(주간 정비도 감쇠)·**정비 회복 RPC**·**비활성
침하**를 붙인다. 서버 lane(e-server) 산출. 클라 lane(e-client)과 정합: layout 정본 =
서버 마이그레이션(리드 판정), `data/seedBases.ts` 는 표시 메타(이름·난이도·UUID)만.

### 마이그레이션 목록 (Phase E 추가분)

| 파일 | 내용 | 원격 적용 |
|---|---|---|
| `20260717080000_m4_phase_e_npc_seed.sql` | NPC 시드 20개(auth.users+profiles+ships+defenses+ladder) · `profiles.is_npc` 컬럼+가드 | ✅ `m4_phase_e_npc_seed` — 20/20 전 테이블, rank 1~20 연속, budget=layout비용 20/20 일치, 예산 전부 ≤20 |
| `20260717090000_m4_phase_e_placement.sql` | `get_placement_targets`·`get_placement_status`·`apply_placement_result` + `apply_invasion_result` 배치전 인지 개정 | ✅ `m4_phase_e_placement` — AC4·미배치 게이팅 실측 통과 |
| `20260717100000_m4_phase_e_repair.sql` | `repair_defense`(크레딧 차감+정비도 100 원자) | ✅ `m4_phase_e_repair` — 실측 통과 |
| `20260717110000_m4_phase_e_weathering.sql` | `weather_defenses`·`weather_guardians`·`sink_inactive` + defenses DELETE 우회 봉인 | ✅ `m4_phase_e_weathering` — AC5·침하·DELETE봉인 실측 통과 |
| `20260717120000_m4_phase_e_cron_schedule.sql` | pg_cron 활성 + 3잡 스케줄 | ✅ `m4_phase_e_cron_schedule` — pg_cron 1.6.4 활성, 3잡 active 실측 |
| `20260717130000_m4_phase_e_review_fixes.sql` | 리뷰 MED 2건 — `sink_inactive` NPC 면제 · `repair_defense` 프로필 행 잠금 | ✅ `m4_phase_e_review_fixes` — T-E9/T-E10/T-E11 실측 통과 |

### 1. NPC 시드 기지 20개 (E2 · 계약 1)

- **auth.users FK 처리 = ⓐ 마이그레이션 직접 insert(고정 UUID)**. 근거: admin API 부재,
  NPC 는 로그인 안 하므로 GoTrue 인증 컬럼 전부 null 무해, `auth.users` NOT NULL 컬럼은
  `id`·`is_sso_user`·`is_anonymous` 3개뿐(원격 실측)이라 최소 insert 안전. 고정 UUID
  `000000e5-ed00-4000-8000-0000000000NN`(NN=01~20) — 클라 seedBases `SEED_BASE_PROFILE_IDS`
  와 조인 키. 방어 앵커 UUID `000000de-f000-4000-8000-0000000000NN`.
- **난이도 분포**(계획 §5 하위~중위): 예산 = NN(#01 예산2 … #20 예산20) 단조 증가. 밴드
  01~07 하위 / 08~14 중하 / 15~20 중위. 초기 rank = 21-NN(#01=rank20 … #20=rank1).
  포탑 조합도 난이도별(하위=발칸 위주, 중위=저격·미사일+장애물). 전 layout 은 클라
  `normalizeLayout`(포탑 유형 0~5·좌표 유한·halfW/halfH>0) 규칙 + 예산 20 이하를 정적
  생성기로 검증(전부 통과) 후 임베드. 서버 `budget_spent` = `defense_layout_cost(layout)`
  20/20 일치 실측.
- **정본 = 서버 defenses.layout**. 배치전/침공 모두 클라가 RPC 반환 layout 을 렌더·재실행,
  verify-invasion EF 도 DB layout 으로 재실행 → 클라 seedBases 에 layout 이중 정의 없음
  (드리프트 원천 차단).

### 2. 배치전 (E1 · AC4 · 계약 2)

- **`get_placement_targets()`**(definer, authenticated): 미배치(ladder row 없는) 유저에게
  `is_npc` 활성 방어 20기 제안(쿨다운·순위격차 무시). 반환 shape = `get_invasion_targets`
  와 동일(클라 타입 재사용).
- **`get_placement_status()`**: `(matches_played, matches_won, required=5, placed)` —
  verified 침공 중 attacker=나·defender=NPC 집계. 진행바·완료 판정.
- **`apply_placement_result(p_player)`**(definer): 최초 verified NPC 매치 5회 승수로 초기
  rank 삽입. 삽입 rank R = `max(1, (현재 최대 rank + 1) - wins*2)`(0승→맨 아래, 5승→중상위).
  삽입 시 `update ladder set rank=rank+1 where rank>=R`(DEFERRABLE unique → 단일 트랜잭션
  교차 안전). 멱등(이미 배치 시 no-op). authenticated 는 본인만, 타인 확정은 service_role.
- **AC4 해석 = 상대 순서 불변**: R 이상 전 행이 일괄 +1 shift → 서로의 상대 순서 완전
  보존, R 미만 불변. 절대 rank +1 은 총원 증가로 불가피하나 경쟁 구도 불변. **실측 T-E3**:
  4승 유저 rank13 삽입, 기존 20명 순서 문자열 동일(existing_order_preserved=true).
- **`apply_invasion_result` 배치전 인지 개정**(Phase D 미배치 엣지의 명시 정의): 공격자가
  배치되지 않은(placed 아님) 경우 **스왑·복제 약탈·쿨다운 게이트를 모두 스킵**(계약 2
  "배치전 중 스왑·약탈 금지" + GDD §8 배치전 쿨다운 무시). Phase D 판은 ladder row 유무와
  무관하게 약탈했으므로 이 개정이 실질 변경점. 배치된 공격자(정상 PvP)는 Phase D 동작
  완전 동일. **실측 T-E4**: 미배치 승리 → 약탈 0행·순위 불변·verified만. **T-E5**(회귀):
  배치 공격자 승리 → 스왑(#016 rank5↔#018 rank3)·약탈 1건 정상.

### 3. 풍화 pg_cron (E3 · AC5)

- **pg_cron 활성 가능**(원격 `list_extensions` default_version 1.6.4 → `create extension`
  성공, 3잡 active 실측). 스케줄은 `_cron_schedule` 마이그레이션(잡 함수와 분리 — 활성
  실패해도 함수는 남도록). 실패 시 대안: Dashboard→Database→Extensions 에서 pg_cron 켠 뒤
  `cron.schedule` 3줄 수동 실행.
- **`weather_defenses()`**: 주 1회(일요일 00:00 UTC) `maintenance = greatest(0, maintenance-5)`.
  **이 함수는 defenses.maintenance 외 아무것도 쓰지 않는다**(AC5). SECURITY DEFINER
  소유자 컨텍스트라 defenses 가드의 `is_service_role()` 우회로 maintenance 직접 갱신.
  **실측 T-E2**: weathered=20, ladder/profiles/items/def(layout+budget) 해시 전부 불변,
  maintenance 만 2000→1900. 회복은 `repair_defense`(크레딧).
- **`weather_guardians()`**(ADR-0007, 별도 잡): 수호 성능 -5%p, 바닥 50%, 회복 불가. AC5
  불변식 검사(weather_defenses 단독)를 오염시키지 않도록 분리. M4 에선 guardians 빈 자리.

### 4. 정비 회복 RPC (계약 4)

- **`repair_defense(p_defense_id)`**(definer, authenticated 본인): cost = `ceil((100-maintenance)*5)`
  크레딧. **크레딧 = profiles.save(jsonb) 최상위 'credits'**(src/save/profile.ts Profile.credits
  구조 확인) 에서 `jsonb_set` 으로 차감 + maintenance=100 원자 처리. 만점→no-op(cost0),
  부족→`insufficient-credits`. 반환 `{repaired, cost, credits, maintenance, note}`. ⚠️ 정비
  직후 클라 profileSync pull 로 서버 save.credits 반영 필요(e-client 통지 완료). **실측
  T-E6**: maint70→100, credits 1000→850(cost150).
- **동시 정비 lost-update 차단**(리뷰 MED-2, `_review_fixes`): 기존엔 프로필 행을 잠그지
  않고 select(credits)→update(jsonb_set) 2단계로 차감해, 동시 정비(더블클릭·다중 탭) 시
  두 트랜잭션이 같은 잔액을 읽어 한 번 치 비용만 차감(과소차감)될 수 있었다. **크레딧
  읽기에 `for update`** 를 붙여 프로필 행을 먼저 잠근다 — 두 번째 트랜잭션은 첫 커밋 후의
  잔액을 읽는다(PostgreSQL 행 잠금 시맨틱). 택1 근거: 조건부 단일 UPDATE(+row_count) 안과
  동등하게 안전하지만, 이 함수는 잔액을 읽어서 분기(부족 required 반환·만점 no-op)해야
  해 어차피 select 가 필요하다 — 그 select 에 잠금을 붙이는 쪽이 로직 변경 최소·의도
  명시적. 동시 두 세션 재현은 단일 연결(MCP)로 불가해 **T-E11**(라이브 함수 정의에
  `for update` 반영 실측=true) + T-E6 재실행 기능 회귀(동일 결과)로 검증을 갈음.

### 5. 비활성 침하 (E4)

- **`sink_inactive()`**(별도 cron 잡, 일요일 00:30 UTC): `last_active` 30일+ 프로필을
  정렬 키 +SINK_STEP(**기본안 3** — 튜닝 대상)으로 재랭킹 → **매 실행마다 최대 3위 하락**.
  동률 sort_key 에서 활성을 앞에 두어 비활성이 활성을 완전히 지나 침하(경계 동률 하락폭
  축소 방지), old_rank asc 로 클래스 내 상대 순서 보존. dense re-number 라 rank 1..n 연속
  유지, **비활성 없으면 0행(멱등)**. **순위만 변경** — 이는 침하 잡의 본질(직접 순위 하락)
  이라 ADR-0006 "풍화는 순위 불변"과 무충돌(침하 ≠ 풍화). **실측 T-E7**: #011 rank10→13,
  아래 3명 상승, 상대 순서 보존, distinct 20. 전원 활성 시 0행.
- **NPC 침하 면제**(리뷰 MED-1, `_review_fixes`): NPC 의 `last_active` 는 시드 시점 고정
  + 갱신 경로가 없어(NPC 무로그인) 30일 뒤 전 NPC 가 '비활성' 판정 → 매주 -3 침하로 난이도
  분포가 붕괴할 수 있었다. `sink_inactive` 대상 조건에 **`not p.is_npc`**(profiles 조인)
  추가 — NPC 는 '미접속 유저'가 아니므로 침하 의미론상 애초 대상이 아니다. NPC 는 재랭킹
  기준점으로만 참여(dense re-number 연속성 유지). **실측 T-E9**: 전 NPC 40일 미접속 상태
  에서 sink → 0행 변경·전 NPC rank 불변. **T-E10**(혼합): 실유저만 rank10→13 침하, NPC
  상대 순서(#20>…>#01) 완전 보존, distinct 21.

### 6. 이월 항목 처리 (계약 6)

- **DELETE→재생성 정비도 리셋 우회 봉인**(README 착수 조건 ②-2 이행): `defenses_rw_own`
  (FOR ALL)을 SELECT/INSERT/UPDATE own 정책으로 분해하고 **DELETE 정책을 만들지 않는다**
  → 클라이언트 DELETE 는 RLS 기본 거부. service_role BYPASSRLS·profiles 삭제 FK cascade 는
  RLS 무관하게 동작해 계정 삭제 경로 무영향, 방어 교체는 UPDATE(defenseSync) 유지.
  **실측 T-E8**: authenticated 의 자기 방어 DELETE → 0행 삭제·행 잔존.
- **`ladder.defense_id` 백필 결정 = 소급 백필 트리거·잡 두지 않음**. NPC 는 시드에서 채움,
  신규 유저는 배치 시점 활성 방어가 있으면 채움(있을 때만). 근거: 매치메이킹은
  `defenses.active` 직접 조인·EF 는 `invasions.defense_id` 스냅샷을 쓰므로 **ladder.defense_id
  를 읽는 경로가 없고**, 이 컬럼이 겨냥한 DELETE 우회 완화는 위 DELETE 봉인으로 근본
  차단됨. M5 에서 실제 읽는 기능이 생기면 백필 배선 재검토(주석 착수 조건 기록).

### 원격 실측·통합 테스트 (2026-07-17, `qxgbxwyccbxokdgwxcuw`)

`supabase/tests/phase_e_verification.sql` 에 T-E1~T-E8 재현 스크립트 보존(트랜잭션 롤백/
RAISE 자동 롤백 → 잔류 0). 요약:

- T-E1 시드 무결성: NPC 20·rank 1~20 연속·budget=layout비용 20/20·예산≤20 ✅
- T-E2 AC5 풍화 불변: weathered=20, ladder/profiles/items/layout+budget 불변, maintenance만 하락 ✅
- T-E3 AC4 배치전 삽입: 4승→rank13, 기존 유저 상대순서 문자열 동일 ✅
- T-E4 배치전 게이팅: 미배치 승리→약탈0·스왑없음·verified만 ✅
- T-E5 정상 스왑+약탈 회귀: 배치 공격자 승리→스왑·약탈1 ✅
- T-E6 정비: maint70→100·credits1000→850(cost150) ✅
- T-E7 비활성 침하: rank10→13·아래3명 상승·상대순서 보존·distinct20 ✅
- T-E8 DELETE 봉인: authenticated DELETE→0행·행 잔존 ✅
- T-E9 NPC 침하 면제(MED-1): 전 NPC 40일 미접속→sink 0행·rank 불변 ✅
- T-E10 혼합 침하: 실유저만 rank10→13, NPC 순서 보존·distinct 21 ✅
- T-E11 repair 잠금(MED-2): 라이브 정의 `for update` 반영=true + T-E6 재실행 동일 결과 ✅
- `get_advisors(security)` 재점검: 신규 WARN 은 전부 의도 — SECURITY DEFINER RPC 4종
  (placement×3·repair, authenticated 가 auth.uid() 스코프 호출 — get_invasion_targets 와
  동일 성격), pg_cron 시스템 테이블(cron.job/job_run_details), 익명 Auth 베이스라인. **ERROR
  없음.** `apply_invasion_result`·`weather_*`·`sink_inactive` 는 목록에 없음(service 전용
  EXECUTE 봉인 확인).

### 정비도(풍화) 검증 배선 — sim 소비 구현됨·EF/클라 배선 완료 (2026-07-17)

당초 "sim 이 maintenance 를 소비하지 않아 풍화가 게임플레이 무효" MEDIUM 리스크는 **해소**됐다:

- **sim 소비 구현**(worker-e-sim lane): `InvasionConfig.maintenance`(정수 centi-percent
  0..`MAINTENANCE_FULL`=10000, 미지정=완전 정비), `normalizeMaintenance`·`scaleFireCooldown`
  (ADR-0006 "0%→성능 50%" = 발사 간격 2배 선형), `stepDefenseTurrets`/`spawnInvasionLayout`
  반영. PvE fixtures 바이트 불변·477 vitest+deno 녹색(e-sim 보고).
- **EF 배선 완료**(이 lane, verify-invasion): `InvasionServerContext.maintenance?` 추가,
  `index.ts` 가 DB `defenses.maintenance`(numeric 0~100)를 **`Math.round(db*100)`** 로 정수
  centi-percent 변환해 로드(스냅샷 defense_id·활성 방어 양 경로), `verifyInvasion` 의
  `authoritativeInvasion` 에 `maintenance` 포함 → **서버 재실행이 서버 정비도로 포탑을
  스케일**한다. 변환 공식은 클라와 동일(어긋나면 정직 런 오거부). 미지정→완전 정비 폴백으로
  기존 검증 거동 100% 하위호환. layoutEquals 에 maintenance 대조는 불필요 — 서버 override +
  hashStream 재실행이 정비도 불일치 위조를 `hash-stream-divergence`/`final-hash-mismatch`
  로 잡는다.
- **deno 발산 테스트 추가**(`scripts/deno-verify/verifyInvasion.ts`): ①풍화 0% 서버에
  0% 로 정직 제출 → accept, ②완전 정비로 계산한 런을 풍화 0% 서버로 검증 → `final-hash-mismatch`
  거부(배선 없으면 서버가 항상 완전 정비로 돌아 이 발산을 못 잡음 = Phase E 완결 조건),
  ③완전 정비 서버 하위호환 accept. `deno task check`·`bundle`(dist.index.js 재생성, 36모듈)·
  vitest·tsc·eslint 전부 녹색. **재배포 필요**(리드 처리) — dist.index.js 갱신됨.

### 남은 리스크
- **[LOW] 배치전 승수 산정 = 최초 5매치**: `apply_placement_result` 는 created_at 오름차순
  최초 5 verified NPC 매치로 승수를 센다. 6매치 이상 플레이해도 첫 5개 기준(배치전 정의).
- **[LOW] 밸런스 상수 튜닝 대상**(계획 §5): 정비 비용률 5·침하폭 3·배치 rank/win 계수 2·
  풍화 -5%p 는 초기 추정값. M5 밸런싱 패스에서 확정.

## Phase F — 복수전·도발 스티커·PvE 샘플링(축소) (계획 §4 Phase F · AC6·AC11·AC12, 2026-07-17)

재미 요소 서버층. 침공당해 순위를 잃은 방어자의 **24h 복수전**(쿨다운·격차30 가드 예외),
**도발 스티커**(사전 세트 12종 인덱스, 1회 불변), **PvE 통계 이상치 플래그**(리플레이 미보유로
축소 범위)를 붙인다. 서버 lane(f-server) 산출. 클라 lane(f-client)과 정합: 스티커 **문구 정본은
클라 `data/stickers.ts` `STICKERS[0..11]`**, **인덱스·저장·서버권위는 서버**(smallint). 복수 판정은
클라 신뢰 없이 **서버가 invasions 이력으로 자동 판정**.

### 마이그레이션 목록 (Phase F 추가분)

| 파일 | 내용 | 원격 적용 |
|---|---|---|
| `20260717140000_m4_phase_f_revenge_sticker.sql` | invasions 4컬럼(attacker_sticker·defender_sticker·caused_swap·is_revenge) · guard 트리거 개정(insert 봉인 + update 불변) · `set_invasion_sticker` · `get_incoming_invasions` · `revenge_targets_for`+`get_revenge_targets` · `apply_invasion_result` v3(복수전) | ✅ `m4_phase_f_revenge_sticker` — T-F1~T-F5 실측 통과 |
| `20260717150000_m4_phase_f_pve_sampling.sql` | `flag_pve_anomalies`(통계 이상치 계정 플래그) + pg_cron 일 1회 스케줄 | ✅ `m4_phase_f_pve_sampling` — T-F6 실측 통과, cron 잡 active |
| `20260717160000_m4_phase_f_review_fixes.sql` | 리뷰 반영 — self-invasion insert raise 복원(HIGH 회귀) · `set_invasion_sticker` 승자 한정(MED) | ✅ `m4_phase_f_review_fixes` — T-F7/T-F8 실측 통과, `pg_get_functiondef` 라이브 정의 4항목 검증 |

### 1. 복수전 (F1 · AC6)

- **판정 근거 = `invasions.caused_swap`**: `apply_invasion_result` 가 실제 래더 스왑을 일으킬
  때만 이 불변 플래그를 true 로 기록한다. 시간이 지나 순위가 바뀌어도 "당시 스왑으로 순위를
  빼앗겼다"는 사실을 이 플래그가 보존해 복수 대상 판정의 권위 근거가 된다(단순 패배·미배치
  침공·격차30 초과로 스왑 안 된 승리는 caused_swap=false 라 복수권을 만들지 않는다).
- **`revenge_targets_for(p_player)`**(내부 helper, service_role): p_player 가 방어자로서 24h
  내 caused_swap=true 로 순위를 잃은 침공의 공격자들 — 상대별 최근 1건, 그 손실 이후 아직
  되받지(그 상대를 스왑으로 이김) 못한 것만(소비 시 소멸). `revenge_invasion_id` = 나를 스왑한
  그 침공.
- **`get_revenge_targets()`**(definer, authenticated): 위를 클라 관제탑용으로 감싼다. 반환 =
  `get_invasion_targets` 의 InvasionTarget shape `{profile_id, rank, display_name, ship_summary,
  defense_id, layout, maintenance}` + `{revenge_invasion_id, expires_at, seconds_remaining,
  can_ignore_cooldown(항상 true)}`. **실측 T-F2**: 대상 1건·seconds_remaining≈23h·cooldown 무시.
- **`apply_invasion_result` v3 복수 통합**: 진입부에서 `v_is_revenge` 를 서버가 직접 판정
  (현재 방어자가 공격자의 유효 복수 대상인가 = `revenge_targets_for` 멤버십). 그 결과로만:
  - **쿨다운 예외**: 복수 침공은 1시간 재도전 쿨다운을 건너뛴다(GDD §8).
  - **격차30 예외**: 스왑 조건 `(v_att.rank - v_def.rank) <= 30` 을 **복수 침공만** 면제.
    ★ **Phase D HIGH 리뷰(랭크 리프프로그) 재개방 아님**: 예외는 오직 서버가 "나를 직접
    스왑으로 이긴 상대"로 검증한 대상에게만 적용된다 — 각 대상은 나에게서 순위를 직접 빼앗은
    자라 되받는 스왑은 리프프로그가 아니라 자리 탈환이다. 임의 상위권 격차30 우회는 여전히
    불가(비복수 경로는 종전 ≤30 강제). **실측 T-F3**: 비복수 격차40 승리 → 스왑 없음·순위
    불변·caused_swap=false / 정상 격차20 → 스왑·caused_swap=true(회귀).
  - **자리 탈환 + 보너스 광물**: 복수 스왑 성공 시 공격자 `profiles.save.minerals` 에 서버가
    `REVENGE_BONUS_MINERALS`(=50, 튜닝 대상 — 계획 §5) 가산(repair_defense 크레딧 차감과 동일
    jsonb_set + 프로필 행 잠금 패턴). caused_swap·is_revenge 기록. **실측 T-F2**: 격차40 복수
    스왑 성사·minerals 100→150·플래그 기록·복수 소비(T-F4: 되받은 뒤 대상 목록에서 사라짐).
  - 배치전·비복수·정상 PvP 경로는 Phase E 동작 **완전 동일**(회귀 T-F3 정상 스왑).
- **EF verify-invasion 배선**(additive): apply 반환의 `is_revenge`·`bonus_minerals` 를 EF
  응답에 `{ revenge: boolean, bonusMinerals: number }` 로 얹었다(기존 필드 불변, 구 클라 무시
  해도 안전). `dist.index.js` 재번들 완료(36모듈·70.64KB, check 통과) — **재배포는 리드**.

### 2. 도발 스티커 (F2 · AC12 · f-client 합의)

- **채택 = 2컬럼**(계약 §2 "문서화된 대안"): `invasions.attacker_sticker`·`defender_sticker`
  (각 `smallint NULL CHECK 0..11`). 근거: 비동기 PvP 라 방어자는 사후에 단다(GDD §8 line122
  "침공/**방어** 성공 시") — 단일 컬럼은 방어자 도발을 담지 못한다. 자유 텍스트 불가(smallint,
  인덱스만). 문구 정본은 클라 `data/stickers.ts` `STICKERS[0..11]`(서버는 의미 모름·범위만 강제).
- **`set_invasion_sticker(p_invasion_id, p_sticker)`**(definer, authenticated): `auth.uid()` 로
  호출자가 이 침공의 공격자인지 방어자인지 **서버가 판정**해 해당 컬럼만 설정. 참여자 아님 →
  예외. 재설정 시도 → `{ok:false, note:'already-set'}`(1회 불변). 범위 밖 → 예외. 반환
  `{ ok, side('attacker'|'defender'), sticker, note }`. SECURITY DEFINER 라 invasions UPDATE
  정책 부재(클라 직접 update 봉인)를 우회해 설정하되 자기 once-check 로 불변 보장.
- **불변 3중**: ① invasions 에 client UPDATE 정책 없음(RLS 기본 거부), ②
  `trg_invasions_guard_update`(비 service_role update 시 이미 설정된 스티커·서버 필드 고정),
  ③ RPC 자체 once-check. **실측 T-F1**: 공격자 설정→재설정 거부, 방어자 설정, 비참여자 거부,
  범위 12 거부, 최종 (attacker=3, defender=7).
- **전달 = 폴링** `get_incoming_invasions(p_since default null, p_limit default 50)`(definer,
  authenticated): 내가 defender 인 verified 침공을 최근순(verified_at desc)으로. 반환 `{invasion_id,
  attacker_id, attacker_name, attacker_won, is_revenge, created_at, verified_at, attacker_sticker,
  defender_sticker}`. p_since 주면 verified_at 이후만. "마지막 확인 시각"은 클라 로컬 저장(realtime
  아님). **실측 T-F5**: 필드·스티커·since 필터·공격자 조회 0건.

### 3. PvE 샘플링 검증 — 축소 범위: 통계 이상치 플래그만 (F4 · AC11 · 계약 4 조건 분기)

- **범위 결정 = 통계 이상치 플래그만, 리플레이 재실행 샘플링은 착수 조건으로 이월**. 근거를
  먼저 실측 확인: **profileSync(`src/net/profileSync.ts`)가 서버에 남기는 PvE 데이터는 집계
  세이브(profiles.save: credits/minerals/ships/inventory) 한 벌뿐**이다(`serializeProfile` →
  전체 Profile 통짜 업로드, last-write-wins 단일 슬롯). **개별 PvE 런 기록도 리플레이 blob 도
  서버에 존재하지 않는다** → 재실행할 리플레이가 없어 상위 N%·랜덤 1% 재실행은 성립 불가,
  "적발 시 런 무효"도 런 단위 기록이 없어 불가. 따라서 계약 4 의 조건 분기대로 **계정 플래그
  (profiles.flagged)만** 세팅한다.
- **`flag_pve_anomalies(p_hourly_cap=100000, p_min_age_hours=1, p_min_total=50000)`**(definer,
  service_role): 계정 수명(now-created_at) 대비 총 보유 자원(credits+minerals) 획득률이 시간당
  상한을 초과하는 **명백한 이상치**를 `profiles.flagged=true` 로 표기(기존 서버 전용 가드
  `guard_profiles_client_write` 활용 — definer 소유자 컨텍스트라 flagged 직접 갱신). 오탐 방어:
  최소 나이(1h)·최소 총자원(50000) 미만 계정 제외, `is_npc`·이미 플래그된 계정 제외. 상수는
  밸런스 미확정(M5)이라 잠정값. **실측 T-F6**: 이상치(600000/2h=300000/h) flagged, 정상
  (2000/h)·신규(나이<1h)·NPC 전부 clean.
- **pg_cron**: `planet-blitz-flag-pve-anomalies` 일 1회(01:00 UTC), Phase E pg_cron(1.6.4)
  재사용. 실측: 잡 active.
- ⚠️ 이는 "명백한 불가능 획득률"만 잡는 보수적 1차 방어선이다(ADR-0005 수용 트레이드오프).
  정교 슬로우핵·부분 치트는 집계만으로 못 잡는다.

### 리플레이 재실행 샘플링 — 착수 조건 (F4 완전판, 이번 범위 밖)

아래가 갖춰지면 EF `verify-pve-sample` + pg_cron 으로 상위 N%·랜덤 1% 리플레이 재실행 검증을
붙인다(계획 §4 F4 원안 · OQ-M4-2 기본안 상위 5%+상한+랜덤 1%). 현재 미충족:
1. **PvE 런 서버 기록**: profileSync 는 집계 세이브만 올린다. PvE 런 단위 결과(시드·입력·해시·
   획득 자원)를 서버 테이블(예: `pve_runs`)에 남기는 배선 필요 — 리플레이 blob 업로드 여부는
   용량·빈도 트레이드오프라 **리드/사용자 판단**(별도 결정, `src/**` 변경 필요 = f-server 범위 밖).
2. **재실행 인프라**: verify-run EF(Phase A) 결정론 재실행을 PvE 런에 재사용.
3. **적발 처리**: 재실행 불일치 시 해당 런 무효(런 기록 존재 전제) + `flag_pve_anomalies` 의
   플래그 경로 재사용.

### 코드리뷰 REQUEST_CHANGES 반영 (2026-07-17, 마이그레이션 `20260717160000`)

1. **[HIGH·회귀] self-invasion insert 가드 복원**: Phase D `20260717030000` 이
   `guard_invasions_client_insert()` 최상단에 넣은 self-invasion raise(역할 무관,
   CRITICAL 수정)를, Phase F `20260717140000` 이 같은 함수를 create or replace 하며
   빠뜨려 insert 층 차단이 회귀했다(apply 3차 가드가 남아 경제 악용은 불가했으나 다층
   방어의 한 층 소실). Phase D 원문 블록을 그대로 최상단에 복원 + Phase F 서버 필드
   봉인 유지. **재발 방지**: 마이그레이션 주석에 "이 함수를 재정의할 때는 self-invasion
   블록 필수 유지" 명시(160000 · 140000 양쪽), 회귀 테스트 **T-F7** 추가 — 이 함수를
   재정의하는 마이그레이션이 생기면 반드시 T-F7 재실행.
2. **[MED] `set_invasion_sticker` 승자 한정**: GDD §8 "침공/방어 **성공 시**" — 종전판은
   참여자면 승패 무관 설정 허용(패자 도발 가능, 사양 밖). `attacker_won` 을 확인해
   공격자는 true·방어자는 false 일 때만 허용, 아니면 `{ok:false, note:'not-winner'}`
   (미확정 pending/null 도 not-winner — `is distinct from` 으로 null 안전). 테스트 **T-F8**.

f-client 영향: `not-winner` 는 새 note 값(additive) — 클라 승자 UI 만 스티커 선택을 띄우면
정상 경로에서 만나지 않는다. EF 는 이번 수정과 무관(SQL 전용) — 재번들 불필요 확인.

### 원격 실측·통합 테스트 (2026-07-17, `qxgbxwyccbxokdgwxcuw`)

`supabase/tests/phase_f_verification.sql` 에 T-F1~T-F8 재현 스크립트 보존(각 DO 블록 최종 RAISE
자동 롤백 → 잔류 0, 사후 leaked_profiles/invasions/users/flagged 전부 0 실측). 요약:

- T-F1 스티커(승자 한정 개정판): 승리 공격자 설정→재설정 거부(불변)·방어 성공 방어자 설정·
  비참여자 거부·범위12 거부·최종(win.a=3, lose.d=7) ✅
- T-F2 복수 판정·탈환: get_revenge_targets 1건(sec≈23h·cooldown 무시)·apply 격차40 복수 스왑
  성사·bonus 50·minerals 100→150·caused_swap/is_revenge 기록 ✅
- T-F3 리프프로그 가드: 비복수 격차40 → 스왑 없음·순위 불변·caused_swap=false / 정상 격차20 →
  스왑·caused_swap=true ✅
- T-F4 복수 소비: 되받은 뒤 revenge_targets_for 에서 대상 소멸 ✅
- T-F5 폴링: get_incoming_invasions 필드·스티커·since 필터·공격자 0건 ✅
- T-F6 PvE 이상치: 이상치 flagged·정상/신규/NPC clean ✅
- T-F7 self insert 거부(HIGH 회귀 테스트): attacker=defender insert → check_violation
  raise(역할 무관 — 서버 컨텍스트에서도) ✅
- T-F8 스티커 승자 한정(MED): 승리 공격자 set·패배 공격자 not-winner·방어 실패 방어자
  not-winner·방어 성공 방어자 set·미확정(pending) 양측 not-winner·승자 게이트 뒤 불변 유지 ✅
- 라이브 정의 검증(`pg_get_functiondef`): guard self raise 복원=true·Phase F 봉인 유지=true·
  sticker not-winner=true·null 안전(is distinct from)=true ✅
- `get_advisors(security)` 재점검: 신규 WARN 은 `get_incoming_invasions`·`get_revenge_targets`·
  `set_invasion_sticker` 3건뿐이며 전부 **의도**(authenticated 가 auth.uid() 스코프로 호출하는
  SECURITY DEFINER RPC — get_invasion_targets·placement·repair 와 동일 성격). `apply_invasion_result`·
  `flag_pve_anomalies`·`revenge_targets_for` 는 목록에 없음(service 전용 EXECUTE 봉인 확인).
  **ERROR 없음.**

### 남은 리스크
- **[LOW] 복수 보너스 광물·이상치 임계 튜닝**(계획 §5): `REVENGE_BONUS_MINERALS`=50,
  `flag_pve_anomalies` 상한 100000/h·최소나이 1h·최소총자원 50000 은 밸런스 미확정 잠정값.
  M5 밸런싱·운영 지표로 조정.
- **[LOW·해소] 방어자 사후 스티커 UX**: `defender_sticker` 컬럼·RPC(`set_invasion_sticker`,
  승자 한정·1회 불변 서버 강제)에 클라 UX 배선 완료(2026-07-18, `fix/m4-low-carryforward`).
  관제탑 알림 패널(`src/ui/controlTower.ts` `notificationsPanel`)이 **방어 성공(`!attackerWon`)
  이고 아직 회신 도발이 없는(`defenderSticker === null`)** 침공 행에만 "도발" 버튼을 노출하고,
  클릭 시 `onSticker` → `main.ts` `promptSticker` → `StickerPicker`(`src/ui/stickerPicker.ts`,
  12종 그리드) → `setInvasionSticker(invasionId, index)` 로 서버 RPC 를 호출한다. 클라는
  호출·표시만 하고 승자 한정·1회 불변은 서버 RPC 가 강제(참여자·승패·중복은 서버 판정).
  이미 남긴 도발은 알림 행에 "내 도발: …" 로 표시한다.
- **[MEDIUM→이월] PvE 정교 치트**: 통계 플래그는 명백한 이상치만 잡음. 완전 방어는 위
  "리플레이 재실행 샘플링 착수 조건"(PvE 런 서버 기록 = `src/**` 배선) 충족 후 가능.
