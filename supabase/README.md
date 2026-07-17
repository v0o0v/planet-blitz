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
