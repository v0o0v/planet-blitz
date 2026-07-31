# 의뢰서 서버 축 — 계약 (Phase B·C 대체본)

- 작성: 2026-07-31, 의뢰서 구현 레인(서버 축) · 작업트리 `worktrees/shooting/cm-lane-srv`
- **지위: 이 문서가 `.omc/plans/commission-system-consensus.md` §Phase B·§Phase C 를 대체한다.**
  그 두 절은 4라운드 연속 CRITICAL 이 났고 진단은 *"인용은 매번 100% 맞고 결정이 매번 틀렸다 —
  결정이 딛는 구조를 한 홉 더 안 밟았다"* 였다. 계획의 나머지 절(§Principles · §pre-mortem ④⑤⑥⑦⑦b⑧ ·
  §Phase 0/A/B0/D/E/F/G)은 유효하고 그대로 선다.
- 사실 기반: `.omc/research/commission-server-surface-2026-07-31.md`
- 용어 정본: `CONTEXT.md` §의뢰서 · §의뢰 확정 지급물 · §지시 수신소 · §의뢰 런 (`CONTEXT.md:208-254`, `:668-677`, `:695`)
- 결정 문서: ADR-0042 · ADR-0043 · ADR-0044 · ADR-0045(3차 정정본) · ADR-0027 · ADR-0028 · ADR-0026 · ADR-0024 · ADR-0039 · ADR-0038
- **이 문서의 모든 사실 주장은 `파일:줄` 을 달거나 "미확인"으로 표시한다.**
- **개정: rev3** (보안 재검토 — 조건부 GO. rev2 의 12건 중 10건은 원 공격을 실제로 막는 것으로 확인됐고, **M2 ②(쿨다운)와 M6(뷰 전환)이 각각 다른 이유로 여전히 뚫려 있었다**. §0-3 참조.)
- 개정: rev2 (security-reviewer 검토 반영 — CRITICAL 2 · MAJOR 6 · Minor 4). rev1 에서
  **틀렸던 결정을 지우지 않고** 각 자리에 `⚠️ rev2 정정` 으로 남긴다. 검토가 그대로 두라고 확인한 6건
  (§2-2 트리거 앵커 · §2-3 자인 · §4-2 권한 · §5-1 (다) 기각 · §7-2 순서 반전 · §5-4 3단계 멱등)은 불변.

---

## 0. 이 계약이 계획 rev7 에서 뒤집은 것 (요약)

| # | 계획 rev7 | 이 계약 | 근거 |
|---|---|---|---|
| 1 | 발령 앵커 = `settle_pve_run` 본문 안에서 정산 이력 행 id 에 unique(D9) | **`pve_runs` 의 `verified` 전이 트리거 + 전용 발령 원장 `commission_issues`.** `settle_pve_run` 본문 **무수정** | §2·§4. `settle_pve_run` 은 6번째 재정의가 되고, 이 리포는 그 복제로 PvE 정산을 100% 깨뜨린 전례가 있다(`20260802000000:4-15`) |
| 2 | `settle_commission` 이 `grant_currency` 로 지급(D10) | **`grant_currency_for(p_profile_id, …)` 신설(공유 본문) + `grant_currency` 를 위임 래퍼로 축소.** 래퍼가 source 를 게이트한다(**rev1 은 `commission` blocklist → rev2 에서 allowlist 로 교체, §0-2 C1**) | §5. `grant_currency` 는 `authenticated` 실행 가능 — 고캡 `commission` 분기를 그 함수에 그냥 넣으면 **클라 직호출 무료 지급 창구**가 열린다. rev7 이 못 본 CRITICAL |
| 3 | EF ②에서 config 를 서버 payload 로 덮고 ⑤에서 제약을 대조 | **대조가 덮어쓰기보다 앞선다.** 덮어쓴 뒤의 대조는 항진 | §7 |
| 4 | 부분 실패 대비 "`commission_grants` 먼저 + 재화 멱등"(D13 · ADR-0045 §결과) | **`settle_commission` 단일 트랜잭션 원자성.** 부분 실패 상태가 원리적으로 존재하지 않는다 | §5-4. ADR-0045 §결과 첫 항은 **개정 필요** |
| 5 | 버려진 `active` 행 회수 주체 미정 | **cron ③ 신설. 회수하지 않고 `abandoned` 로 종결 — 의뢰서는 소멸한다** | §6. 회수하면 "돌려보고 지면 방치" 착취가 열린다. `CONTEXT.md:209` "실패하면 그 의뢰서는 사라진다"와 정합 |
| 6 | `settle_commission` 실패 시 재시도 주체 없음 | **클라가 `verify-commission` 을 재호출한다.** 재호출은 EF 게이트 0 에서 저장된 판정을 CPU 없이 돌려준다 | §5-4·§7 |
| 7 | `mark_commission_active` 에 시간당 호출 상한(rev7 Missing) | **상한을 `consume_commission`(행 생성 지점)에 건다.** 전이는 1회성이라 별도 카운터가 불필요 — 열거식 방어 제거 | §5-3 |

### 0-2. rev2 가 rev1 에서 뒤집은 것

| # | rev1 | rev2 | 왜 rev1 이 틀렸나 |
|---|---|---|---|
| **C1** | 위임 래퍼가 `p_source='commission'` **하나만** 거부(blocklist) | **allowlist(default-deny)** — `('pve_run','salvage','story')` 외 전부 거부 | blocklist 는 **이미 열려 있는 더 큰 구멍**을 안 닫는다: 미등록 source 는 `CAP_DEFAULT_*`=1,000 을 받고(`20260727000000:435`) 개연성 캡은 `pve_run` 전용이라(`:406`) `least()` 가 무시한다 → 인증 사용자가 `p_source:"x"` 로 **시간당 50,000/50,000, 일 300,000/300,000 을 런 없이** 얻는다. rev1 은 자기가 만드는 구멍만 봤다 |
| **C2** | 트리거 예외 무발생을 **문서 계약 + 테스트**로 (§12-⑩ 자인) | **plpgsql 서브트랜잭션**(`begin … exception when others then raise warning; return; end`)으로 구조화 | rev1 의 DDL **자신이** 예외 원천을 5개 갖고 있다(§3-1 `grade check`·`payload not null`, §3-2 `skip_reason check`·`granted not null`·`profiles` FK). 하나만 터져도 정산 트랜잭션 전체 롤백 = **PR#222 와 문자 그대로 같은 실패 형상**(`20260802000000:11-15`). 게다가 payload 생성 입력이 클라 `p_summary` 에서 오면 **서버 정산을 죽이는 입력을 찾는 공격**이 된다 |
| **M1** | 활성 런의 EF 재실행 시도 상한 없음 | `commission_runs.verify_attempts` + **별도 트랜잭션** RPC 로 게이트 7 직전 증가, 5회 초과 시 거부 | `CAP_CONSUME_PER_HOUR` 는 런 **생성**만 묶는다. `active` 인 동안 같은 `run_id` 로 무한 재제출이 가능하고 매번 `verifyRun` 이 완주한다. 응답 직전 연결을 끊으면 settle 이 안 돌아 `active` 가 유지된다 → **계정당 CPU 상한 부재** |
| **M2** | 빈도 상한이 `commission_issues` 전체 행을 센다 | `claimed_victory` 술어로 한정 + **주장 런 길이 비례 쿨다운** 추가 | rev1 은 1단계에서 행을 먼저 넣고 2단계에서 승리를 본다 → **패배 정산이 슬롯을 먹어 정직한 빠른 재시작자를 벌하고**, 위조 `victory:true` 는 20장을 그대로 받는다. **공격자 비용은 안 올리고 정직한 사용자만 벌하는** 상한이었다 |
| **M3** | `ACTIVE_TTL` 이 cron ③에만 | `settle_commission` ④·EF 게이트 0c 에 **나이 검사 동시 부과** | 이 계약 자신의 D8 ② 위반이다 — cron 은 매시 정각이라 `started_at+24h` 를 넘긴 런이 **최대 1시간 제출 가능**했다 |
| **M4** | cron ① 이 insert → update 순서 | **`update … returning` 을 구동자로 삼는 단일 CTE 문장** | INSERT 성공 + UPDATE 0행이면 **1장이 2장**이 된다. rev1 이 도달 불가였던 것은 `GRACE` 부등식의 **우연** 때문이지 구조 때문이 아니었다 |
| **M5** | `commission_runs.replay`·`client_result` 컬럼 보유, cron ② 가 셋을 비움 | **두 컬럼 삭제**, cron ② 술어를 `replay_gz is not null` 로 | 침공 전제의 무비판 복제였다. 침공은 **클라가 `invasions` 를 replay 째로 INSERT** 한다(`src/net/invasionGateway.ts:399-407` · 정책 `20260717000000:352-356`). 의뢰는 `commission_runs` 에 **쓰기 정책이 0개**라 클라가 replay 를 넣을 경로가 없다 → 두 컬럼은 영원히 null, cron ② 술어는 **영원히 거짓** |
| **M6** | 정의자 권한 뷰 + 뷰 본문 `where` 가 유일한 행 경계 (fail-open) | 기저에 `commission_runs_select_own` 정책 + 뷰를 **`security_invoker = true`** 로 (fail-closed) | 구조는 안 뚫렸지만 **실패 방향이 틀렸다** — `where` 한 줄이 지워지면 즉시 전 계정 노출이고 유일한 탐지가 테스트였다. fail-closed 면 같은 실수가 **유출이 아니라 무변화**가 된다 |
| **m1** | `revoke execute … from public` 을 문장으로만 언급 | **AC-C3 의 뮤테이션 대상으로 승격** | Postgres 는 함수 생성 시 PUBLIC 에 EXECUTE 를 자동 부여한다. 그 줄이 빠지면 `authenticated` 가 PUBLIC 을 통해 도달해 §5-1 위임 구조 전체가 무효다 |
| **m2** | cron 스니펫이 테이블을 비수식 사용 | **전부 `public.` 수식** | pg_cron 은 스케줄 롤의 `search_path` 로 돌아 `set search_path=''` 규율 밖이다. 리포 선례도 전부 수식(`20260726000100:124-128`) |
| **m3** | `p_source` 비교 정규화 미지정 | **C1 allowlist 로 함께 닫힘** | 통과 집합이 유한 리터럴 3종으로 고정된다 |
| **m4** | 잠금 순서 서술에 배타성 근거 없음 | **cron ① ↔ `consume_commission` 의 대상 집합 배타성을 명시** | M4 수정 후 두 경로의 잠금 순서가 역순이 된다. 지금은 술어가 배타적이라 사이클이 안 닫히지만, **그 배타성이 계약에 없으면 술어를 넓힐 때 교착이 생긴다** |

### 0-3. rev3 이 rev2 에서 뒤집은 것

재검토 판정은 **조건부 GO** — rev2 의 12건 중 **10건(C1·C2·M1·M3·M4·M5 + m1~m4)은 원 공격을 실제로 막는 것으로 확인됐다**(plpgsql 의미론 · 회귀 4경로 · 부등호 일치 · CTE 잠금까지 대조). 아래 둘만 뒤집는다.

| # | rev2 | rev3 | 왜 rev2 가 틀렸나 |
|---|---|---|---|
| **선행1** | M2 ② 쿨다운 = **직전 granted 행의 `claimed_final_tick / 60` 초** 대기 | **(a) 자격에 `MIN_BOSS_KILL_TICKS` 하한 + (b) `next_eligible_at` 누적기.** 둘이 함께여야 성립한다 | **비례 계수를 공격자가 고른다.** `claimed_final_tick` 은 바로 그 호출에서 공격자가 정한 값이고, 자격 판정(2단계)에 **틱 하한이 없다**. `finalTick:1` 을 반복하면 쿨다운이 `1/60`초 ≈ 0 이라 **rev1 과 똑같이 20/h 하나만 남는다.** ⚠️ 특히 rev2 가 든 `grant_currency` 개연성 캡과의 유비가 **부호가 반대라 틀렸다** — 개연성 캡은 `finalTick` 이 작을수록 지급 상한을 **깎는다**(`20260727000000:423-424`, 상한이 `틱 × (1+stage)` 에 비례)라 작게 주장하면 **손해**다. rev2 의 쿨다운은 작게 주장하면 **이득**이었다 |
| **선행2** | M6 fail-closed 전환 — 기저에 `commission_runs_select_own` 정책 추가 + 뷰 `security_invoker` | **행은 RLS, 컬럼은 GRANT 로 각각 fail-closed.** `revoke select … from authenticated` + 컬럼 목록 명시 grant | **RLS 정책은 행을 게이트하고 컬럼은 GRANT 가 게이트한다.** rev1 에서 `commission_runs` 는 정책이 **0개**라 클라가 기저를 행 단위로 아예 못 읽었고, 컬럼 축소는 뷰가 담당하면 충분했다. rev2 가 select-own 을 **추가**하면서 행이 열렸는데 **컬럼 GRANT 를 한 홉 더 안 밟았다** — 이 리포 전 마이그레이션에 테이블 GRANT 문이 **0건**(유일한 `grant select` 는 `20260727010000:240` 의 뷰 1건)이라 **Supabase 기본 부여에 의존**하고 있다. 즉 `GET /rest/v1/commission_runs?select=loadout_sealed,replay_gz` 로 **§3-5·§3-6 이 존재 이유로 든 바로 그 두 컬럼**이 그대로 나간다. **rev2 가 rev1 보다 나빠졌다** |

**⚠️ 그리고 선행2 는 R 계열 AC 4건이 전부 초록인 채로 샌다.** rev2 가 AC-R1 을 "0행" → "본인 행만 보인다"로 바꿨으므로 **유출 상태에서 통과**하고, AC-R2 는 **뷰의** `information_schema.columns` 만 보며, AC-R7 은 뷰의 `security_invoker` 만 본다. rev1 의 "AC 가 6건 중 하나도 안 잡는다"가 **R 계열에서 그대로 재발했다** — AC 를 고칠 때 **그 AC 가 무엇을 안 보는지**를 함께 세지 않으면 같은 실패가 반복된다는 증거다.

---

## 1. 사실 기반 — 현행 RPC 좌표 표

**규약**: 마이그레이션 적용 순서 = 파일명 사전순(`tests/pveRunsColumnContract.test.ts:24-30` 이 `readdirSync().sort()` 로 코드에 고정). **어떤 함수의 현재 정의는 마지막 `create or replace` 다.** 최신 파일은 `20260802000000_settle_pve_run_column_restore.sql` — 신규는 그보다 큰 타임스탬프.

| 함수 | 현행 정의(이것만 인용하라) | 수령자 도출 | 권한 게이트 | `currency_grants` 기록 |
|---|---|---|---|---|
| `settle_pve_run(jsonb)` | `20260802000000_settle_pve_run_column_restore.sql:36` | `auth.uid()`(`:43`) | `authenticated` + `service_role`(`:156`) — **service_role 검사 없음** | 간접(`grant_currency` 가) |
| `grant_currency(numeric,numeric,text,jsonb)` | `20260727000000_catalyst_ledger.sql:339` | **`auth.uid()` 내부 고정, 파라미터 없음**(`:371`) | `authenticated` + `service_role` | **직접 기록 — 유일 관문**(`:494-497`) |
| `consume_catalysts(int[],int)` | `20260727000000_catalyst_ledger.sql:211` | `auth.uid()`(`:223`) | `authenticated` + `service_role`(`:328`) | 없음 |
| `apply_invasion_result(uuid,jsonb,boolean)` | `20260726000000_currency_server_authority.sql:255` | **행에서 도출**(`v_inv.attacker_id`/`defender_id`) | **`caller_is_service_role()` 예외(`:289-291`) + `service_role` 에만 grant** | **없음 — `profiles` 직접 가산** |
| `grant_blueprints(jsonb)` | `20260722020000_m7b_blueprint_drops.sql:40` | `auth.uid()` | `authenticated` + `service_role` | 없음 |
| `grant_catalyst(int,int)` | `20260801000000_catalyst_grant_cap.sql:125` | `auth.uid()` | `authenticated` + `service_role` | 없음 |
| `is_service_role()` | `20260717000000_m4_initial_schema.sql:47` | — | — | `current_user in ('service_role','supabase_admin','postgres')`(`:53`) |
| `caller_is_service_role()` | `20260717010000_m4_phase_d.sql:35` | — | — | `request.jwt.claims->>'role' = 'service_role'`(`:42`) |
| `guard_pve_runs_client_insert()` | `20260727000000_catalyst_ledger.sql:142` | — | BEFORE INSERT 트리거 | `not is_service_role()` 이면 `verified_status:='pending'`·`verified_result:=null`·`verified_at:=null`·`catalyst_receipt:=null` 강제(`:148-153`) |

### 1-1. 두 서비스롤 판별자는 서로 대체 불가다 (이 계약의 하중 사실)

- `is_service_role()` 은 **`current_user` 기준**이다(`20260717000000:53`). `security definer`(소유자 postgres) 함수 **안에서는 호출자가 누구든 항상 참**이다. 그래서 중첩 호출 판별에 **쓸 수 없다** — `20260727000000:414-417` 주석이 이 한계를 명시하고, 그 때문에 `app.in_settle` GUC 가 존재한다.
- `caller_is_service_role()` 은 **JWT claim 기준**이다(`20260717010000:42`). 중첩 definer 호출 안에서도 원 호출자의 role 을 본다. **service_role 전용 RPC 의 정문 게이트는 이쪽이다**(`apply_invasion_result:289-291` 선례).
- **함수 EXECUTE 권한은 `current_user` 로 검사된다.** 그래서 `authenticated` 에서 revoke 한 함수를 postgres 소유 definer 함수는 중첩 호출할 수 있다. §5-1 의 위임 구조가 이 성질 위에 선다.

### 1-2. `grant_currency` 캡 상수 (현행, `20260727000000:352-369`)

| 상수 | 값 | 줄 |
|---|---|---|
| `CAP_PVE_RUN_CREDITS` / `_MINERALS` | 5,000 / 5,000 | `:352-353` |
| `CAP_SALVAGE_*` | 20,000 / 20,000 | `:354-355` |
| `CAP_STORY_CREDITS` | 2,000 (minerals 0) | `:356`, `:434` |
| **`CAP_DEFAULT_CREDITS` / `_MINERALS`** | **1,000 / 1,000** ← 미등록 source 가 여기로 떨어진다 | `:357-358`, `:435` |
| `CAP_HOURLY_*` | 50,000 / 50,000 | `:359-360` |
| `CAP_DAILY_*` | 300,000 / 300,000 | `:361-362` |
| `PLAUSIBILITY_*_PER_TICK` | 2.0 / 2.0 | `:363-364` |
| `FLAG_MULTIPLE` | 10 | `:365` |

지급액 = `greatest(0, least(주장, 개연성캡, per-call캡, 누적잔여))`(`:469-470`). **개연성 캡은 `p_source='pve_run'` 일 때만 산정**되고(`:406-425`) 그 외에는 `null` 이라 `least()` 가 무시한다.

### 1-3. cron 전수 (활성 11건) — 신규 3건이 붙는 자리

| 잡 | 스케줄(UTC) | 좌표 |
|---|---|---|
| `planet-blitz-gc-invasion-replays` | `0 * * * *` (48h TTL) | `20260726000100:121-123` |
| `planet-blitz-gc-currency-grants` | `0 2 * * *` (7일) | `20260726000200:378-382` |
| **`planet-blitz-gc-pve-runs`** | **`0 2 * * *` (7일)** — **CRIT-A 의 원인** | `20260726000200:384-388` |
| 그 외 8건 | 주간·30분·일간 | 사실 기반 §7 |

**시간 단위 cron 은 매시 정각. 일간 cron 은 02:00 UTC 대에 몰려 있다.**

---

## 2. CRIT-A 결정 — 발령 1회성 앵커

### 2-1. 왜 계획 §D9 가 무너지는가

세 사실이 동시에 참이다:

1. **`pve_runs` 는 7일 TTL cron 으로 통째로 삭제된다**(`20260726000200:384-388`). 반면 의뢰서는 **실시간 만료가 없다**(`.omc/specs/deep-interview-commission-system.md:49`).
2. **`commission_inventory` 는 소비 시 삭제된다**(§3-1). 거기 컬럼으로 두면 1회성이 소비와 함께 사라진다.
3. **`settle_pve_run` 의 INSERT 경로는 삽입 행의 `id` 를 반환하지 않는다**(`20260802000000:138-147` — `returning` 절 없음, 반환은 `v_grant || {settled:true}` `:150`). 즉 rev7 이 앵커로 쓰려던 값을 **함수 본문 밖에서는 아무도 모른다.**

### 2-2. 결정 — 트리거 앵커 + 전용 발령 원장

**발령은 `settle_pve_run` 본문을 고치지 않고, `pve_runs` 의 `verified` 도달을 잡는 AFTER 트리거에서 수행한다. 1회성은 전용 원장 `commission_issues` 의 PK 가 진다.**

```
pve_runs 행이 verified_status='verified' 에 도달
  → trg_pve_runs_issue_commission (AFTER INSERT OR UPDATE OF verified_status)
  → issue_commission_for_run(NEW.id, NEW.profile_id, NEW.summary)
      ├ commission_issues 에 (pve_run_id=NEW.id) INSERT ... ON CONFLICT DO NOTHING
      │   → 충돌하면 이미 발령 판정을 거친 행 → 즉시 return (1회성)
      ├ 자격 판정(summary 의 victory·bossKilled) · 빈도 상한 · 재고 상한
      └ 통과 시 commission_inventory INSERT + commission_issues.granted := true
```

**왜 이것이 rev7 보다 나은가 — 네 가지가 동시에 성립한다:**

| 요구 | 어떻게 성립하는가 |
|---|---|
| **양쪽 분기 모두 커버** | 트리거는 UPDATE 분기(`20260802000000:129-135`, 촉매 런)와 INSERT 분기(`:138-147`, 무촉매 런) **양쪽에서 발화**한다. rev7 이 D9 에서 잡은 "촉매 런에만 있다"(계획 `:136-140`)가 원천 소멸한다 |
| **앵커 id 를 항상 안다** | `NEW.id` 는 트리거 컨텍스트에서 두 분기 모두 유효하다. INSERT 가 id 를 반환하지 않는 사실(§2-1 ③)이 무해해진다 |
| **`settle_pve_run` 무수정** | 이 리포에서 가장 위험한 편집을 피한다 — 그 함수는 **5회 재정의**됐고, 그 복제가 이미 PvE 정산을 100% 깨뜨렸다(`20260802000000:4-15`: `20260727010000` 이 드롭 이전 본문을 복제해 `ERROR 42703`, 온라인 정산 전면 실패) |
| **구조적 봉인** | 클라는 `verified` 행을 **만들 수 없다**: `pve_runs` 에 authenticated 용 정책은 insert·select **둘뿐**이고 update·delete 정책이 없으며(`20260718000000:51-61`, 전 마이그레이션 grep 결과 그 둘이 전부), BEFORE 트리거 `guard_pve_runs_client_insert()` 가 클라 INSERT 의 `verified_status` 를 `pending` 으로 강제한다(`20260727000000:148-153`) |

### 2-3. 자인 — 앵커가 막는 것과 막지 못하는 것

**막는 것**: 한 정산 행이 두 번 발령하는 것. PK 가 구조적으로 막는다(트리거가 중복 발화해도, 코드가 재작성돼도 참).

**막지 못하는 것 — 명시한다**: **`settle_pve_run` 은 `authenticated` 가 직접 호출 가능하고**(`20260802000000:156`) **무조건 새 행을 만드는 비-멱등 함수**다(`:138-147`). 클라는 임의의 `p_summary` 로 몇 번이든 부를 수 있고, 매번 새 `pve_runs.id` 가 생기므로 **매번 새 앵커**가 생긴다.

→ **경로 봉인(계획 pre-mortem ⑧ 방어 ①)은 "클라가 발령을 직접 못 부른다"를 의미하지 않는다.** 그것이 의미하는 것은 "발령이라는 이름의 독립 RPC 가 노출되지 않는다" 하나뿐이고, **발령 빈도를 묶는 실질 방어는 §2-4 의 빈도 상한 하나다.** 계약에 못 박는다.

부수 사실: 자격 판정 입력인 `victory`/`bossKilled` 는 클라가 만든 `p_summary` jsonb 다(`settle_pve_run` 이 읽는 것은 `resources`·`minerals`·`epoch`·`planet`·`finalTick`·`runId` 뿐 — `20260802000000:60-97`). **이것은 ADR-0026 이 수용한 PvE 신뢰 모델의 연장이며 이 계약이 새로 만드는 구멍이 아니다.** 다만 발령되는 것이 확정 유니크로 가는 티켓이라 위조 가치가 기존 PvE 보상보다 높다.

### 2-4. 빈도 상한 — 유일한 실질 방어이므로 실값을 여기서 배정한다

- **`CAP_ISSUE_ATTEMPTS_PER_HOUR = 20`** (프로필당). 판정: `commission_issues` 에서 `profile_id = v_me and created_at > now() - interval '1 hour'` 행 수.
- **시도(granted=false 포함)를 센다.** grant 만 세면 "상한에 걸려 미발령"이 카운트되지 않아 상한이 자기를 무력화한다.
- 초과 시 **조용히 미발령**(예외 아님 — 정직한 연속 플레이와 구분 불가하므로 계정 flag 를 걸지 않는다). `commission_issues` 행은 `granted=false`·`skip_reason='rate'` 로 남는다.
- **재고 캡과 다른 축이다**: 재고 캡은 소비하면 다시 차므로, "잡았다"를 초당 반복 신고하면 재고 상한 안에서 무한 재충전이 성립한다.
- 실값 20 의 근거: 정직한 최단 PvE 런이 3분 내외이면 1h 최대 20회는 여유. **밸런스 큐가 아니라 이 계약이 값을 진다** — 상한이 유일 방어이므로 미정으로 두면 방어 미조달이다(Principle 2).

### 2-5. `commission_issues` 의 수명과 GC

- **`pve_runs` 로의 FK 를 걸지 않는다.** 걸면 7일 cron 이 발령 원장을 함께 지운다.
- **`profiles` 로의 FK 는 건다**(`on delete cascade`).
- **자체 GC: 7일**(`currency_grants`·`pve_runs` 와 같은 결). 빈도 상한 창(1h)보다 훨씬 길므로 상한이 GC 로 뚫리지 않는다.
- **PK 가 GC 로 사라지는 것이 무해한 이유**: 앵커 id 는 `gen_random_uuid()` 이고 **클라가 알 수 없다**(§2-1 ③). 촉매 런의 `runId` 는 클라가 알지만, 재제시하면 `verified_status='pending'` 게이트에서 not found 가 되어 무배율 INSERT 경로로 떨어진다(`20260802000000:99-111`) — **같은 앵커가 두 번 제시될 경로 자체가 없다.**

---

## 3. 신규 테이블 DDL 전량

> 파일: `supabase/migrations/20260803000000_commission_ledger.sql` (타임스탬프는 `20260802000000` 보다 커야 한다 — §1 규약)
> 패턴 출처: 촉매 원장 `20260727000000_catalyst_ledger.sql` — RLS **select-own 만**, 쓰기는 `security definer` + `set search_path=''` RPC 전용(`catalyst_inventory_select_own` `:77` 계열).

### 3-1. `commission_inventory` — 아직 쓰지 않은 의뢰서

```sql
create table if not exists public.commission_inventory (
  commission_id uuid        primary key default gen_random_uuid(),
  profile_id    uuid        not null references public.profiles(id) on delete cascade,
  grade         int         not null check (grade between 1 and 4),
  payload       jsonb       not null,          -- CommissionPayload(계획 §Phase B0)
  created_at    timestamptz not null default now()
);
create index if not exists commission_inventory_profile_idx
  on public.commission_inventory (profile_id, created_at desc);

alter table public.commission_inventory enable row level security;
drop policy if exists commission_inventory_select_own on public.commission_inventory;
create policy commission_inventory_select_own
  on public.commission_inventory for select to authenticated
  using (auth.uid() = profile_id);
-- insert/update/delete 정책 없음 — 쓰기는 security definer RPC 전용.
```

- **소비 시 행 삭제**(`consume_commission`). 그래서 여기에 1회성을 걸 수 없다(§2-1 ②).
- **보관 상한**은 발령 시점에 `count(*) where profile_id` 로 검사한다. 실값 = **미확인**(§13-①).

### 3-2. `commission_issues` — 발령 원장 (1회성 앵커 · 빈도 상한의 근거)

```sql
create table if not exists public.commission_issues (
  pve_run_id    uuid        primary key,       -- 앵커. pve_runs 로의 FK 를 **걸지 않는다**(§2-5).
  profile_id    uuid        not null references public.profiles(id) on delete cascade,
  granted           boolean     not null,
  claimed_victory   boolean     not null,      -- ← rev2 (M2 ①). 빈도 상한이 세는 술어.
  claimed_final_tick int        not null default 0,  -- ← rev2 (M2 ②). 감사·산정 입력.
  next_eligible_at timestamptz not null default now(), -- ← rev3 (선행1 b). 누적 예약 지평.
  commission_id uuid,                          -- granted=true 일 때 발령분(FK 없음: 소비 시 삭제됨)
  skip_reason   text        check (skip_reason in ('not-victory','stock','rate','cooldown')),
  created_at    timestamptz not null default now()
);
create index if not exists commission_issues_profile_time_idx
  on public.commission_issues (profile_id, created_at desc);
-- ← rev2 (M2). 빈도 상한과 쿨다운이 각각 이 두 부분 인덱스를 쓴다.
create index if not exists commission_issues_rate_idx
  on public.commission_issues (profile_id, created_at desc) where claimed_victory;
create index if not exists commission_issues_granted_idx
  on public.commission_issues (profile_id, created_at desc) where granted;
-- ← rev3 (선행1 b). 쿨다운은 이 인덱스로 max(next_eligible_at) 하나만 읽는다.
create index if not exists commission_issues_horizon_idx
  on public.commission_issues (profile_id, next_eligible_at desc);

alter table public.commission_issues enable row level security;
-- select 정책도 두지 않는다. 클라가 읽을 이유가 없고(발령 결과는 inventory 로 보인다),
-- skip_reason 노출은 "언제 상한에 걸리는가"를 알려주는 재료다.
```

- `commission_id` 에 FK 를 걸지 않는 이유: 소비 시 `commission_inventory` 행이 삭제되므로 FK 는 발령 원장을 함께 지우거나(cascade) 소비를 막는다(restrict). 둘 다 틀렸다.
- **RLS enable + 정책 0개 = authenticated 는 아무것도 읽지 못한다.** definer/`service_role` 만 본다.
- ⚠️ **rev2 정정 (M2)** — rev1 은 `claimed_victory`·`claimed_final_tick` 이 없었고 빈도 상한이 **행 전체**를 셌다. 그 상한은 패배 정산까지 슬롯으로 먹어 **정직한 빠른 재시작 플레이어의 의뢰서를 끊고**, 위조 `victory:true` 를 보내는 공격자에게는 아무 비용도 부과하지 않았다. rev1 이 "유일한 실질 방어"(§2-3·§12-①)라고 못 박은 축이 정확히 그 상태였다.
- ⚠️ **rev2 (C2 파급)** — 이 테이블의 `granted not null` · `skip_reason check` · `profiles` FK 는 **전부 트리거 안에서 터질 수 있는 예외 원천**이다. §4-1 의 서브트랜잭션이 그 폭발 반경을 발령 경로 안으로 가둔다.

### 3-3. `commission_runs` — 출격한 의뢰 1건

```sql
create table if not exists public.commission_runs (
  run_id          uuid        primary key default gen_random_uuid(),
  profile_id      uuid        not null references public.profiles(id) on delete cascade,
  commission_id   uuid        not null,          -- 소비된 의뢰서 id(FK 없음 — 원본 행은 삭제된다)
  grade           int         not null check (grade between 1 and 4),
  status          text        not null default 'issued'
                    check (status in ('issued','active','verified','rejected','expired','abandoned')),
  payload         jsonb       not null,          -- 소비 시점 payload 사본. **EF 권위 원본**
  loadout_sealed  jsonb       not null,          -- 출격 시점 loadout 봉인(pre-mortem ⑦)
  replay_gz       bytea,                         -- ← rev2 (M5). gzip 만 저장한다. 원본 jsonb 컬럼 없음
  verify_attempts int         not null default 0,-- ← rev2 (M1). EF 재실행 시도 카운터
  verified_result jsonb,                         -- EF 최종 판정(멱등 재호출이 이것을 돌려준다)
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  verified_at     timestamptz
);
create index if not exists commission_runs_profile_idx
  on public.commission_runs (profile_id, created_at desc);
create index if not exists commission_runs_issued_idx
  on public.commission_runs (created_at) where status = 'issued';
create index if not exists commission_runs_active_idx
  on public.commission_runs (started_at) where status = 'active';
create index if not exists commission_runs_gc_idx
  on public.commission_runs (verified_at)
  where status in ('verified','rejected','abandoned');

alter table public.commission_runs enable row level security;
-- select 정책을 두지 않는다. 클라는 아래 뷰만 읽는다(§3-5).
```

- **`status` 는 6상태다.** 계획 rev7 은 4상태였고 **종결 상태 두 개가 없었다** — cron ①과 cron ③이 행을 종결시킬 자리가 없으면 그 행들이 회수 술어에 영원히 남아 매시 재처리된다.
  - `issued` — `consume_commission` 직후. 런 시작 신호 없음
  - `active` — `mark_commission_active` 수신. 제출 가능 창
  - `verified` / `rejected` — EF 확정(보상 지급 / 보상 0)
  - `expired` — cron ①이 회수한 `issued` 행(의뢰서는 원장에 돌아갔다)
  - `abandoned` — cron ③이 종결한 `active` 행(의뢰서는 소멸, §6-3)
- **부분 인덱스 3개가 cron 3건의 술어와 1:1 대응한다.** 술어를 바꾸면 인덱스도 바꿔야 한다는 것을 인덱스 이름으로 못 박는다.
- ⚠️ **rev2 정정 (M5) — `replay jsonb` · `client_result jsonb` 두 컬럼을 삭제했다.** rev1 은 침공 스키마를 그대로 복제했는데, **그 전제가 침공에서만 참**이었다: 침공은 **클라가 `invasions` 행을 replay·client_result 째로 INSERT** 한다(`src/net/invasionGateway.ts:399-407`, 정책 `invasions_insert_attacker` `20260717000000:352-356`). 의뢰는 반대다 — `commission_runs` 행은 `consume_commission` 이 **런 시작 전에** 만들고 이 테이블엔 **쓰기 정책이 하나도 없다.** 클라가 원본 jsonb 를 넣을 경로가 **존재하지 않으므로** 두 컬럼은 영원히 null 이고, 그것을 대상으로 삼은 cron ② 술어는 **영원히 거짓**이었다.
- **제출 리플레이는 EF 요청 본문으로만 온다.** EF 가 판정 후 `store_commission_replay_gz`(§5-5)로 gzip 만 저장한다. 원본 jsonb 는 **DB 에 착지하지 않는다.**
- ⚠️ **rev2 (M1) — `verify_attempts`.** `CAP_CONSUME_PER_HOUR` 는 런 **생성**만 묶고, `active` 인 동안에는 같은 `run_id` 로 무한 재제출이 가능했다. 침공은 `verified_status='pending'` 게이트가 재실행을 1회로 수렴시키는데(`apply_invasion_result:298-304`) 의뢰는 그 수렴점이 **settle 도달에만** 있어, 응답 직전에 연결을 끊으면 `active` 가 유지된 채 `verifyRun` 만 계속 완주한다. §5-7·§7-1 이 이 컬럼을 쓴다.

### 3-4. `commission_grants` — 의뢰 확정 지급물의 **발급** 정본 (ADR-0045)

```sql
create table if not exists public.commission_grants (
  grant_id          uuid        primary key default gen_random_uuid(),
  profile_id        uuid        not null references public.profiles(id) on delete cascade,
  commission_run_id uuid        not null references public.commission_runs(run_id) on delete restrict,
  kind              text        not null check (kind in ('unique','blueprint')),
  slot_index        int         not null,      -- payload.rewards 안 그 kind 의 0-based 순번
  item_payload      jsonb       not null,
  granted_at        timestamptz not null default now(),
  constraint commission_grants_once unique (commission_run_id, kind, slot_index)
);
create index if not exists commission_grants_profile_idx
  on public.commission_grants (profile_id, kind);

alter table public.commission_grants enable row level security;
drop policy if exists commission_grants_select_own on public.commission_grants;
create policy commission_grants_select_own
  on public.commission_grants for select to authenticated
  using (auth.uid() = profile_id);
-- insert/update/delete 정책 없음.
```

- **유일성 키 = `unique (commission_run_id, kind, slot_index)`.** 계획이 요구한 `unique (commission_run_id, kind)` 는 **같은 종류를 2개 주는 의뢰서를 표현할 수 없다.** `slot_index` 는 `payload.rewards` 안 순번이라 payload 가 고정된 이상 **결정적**이고, 따라서 재시도가 같은 키를 만든다.
- 삽입 주체는 **`settle_commission` 하나뿐**. 그 외 생성자·수정자·삭제자를 만들지 않는다.
- **TTL 대상이 아니다.** cron 정리 목록에 넣지 않는다(ADR-0045 §결과).
- `on delete restrict` — `commission_runs` 는 **행 자체를 삭제하지 않는다**(blob 만 비운다, §6-2). restrict 가 그 규율을 DB 층에서 강제한다.
- **발급 정본이지 소유 정본이 아니다**(`CONTEXT.md:223`, ADR-0045 §2·§2b). 장착·퇴역 잠김·소멸은 클라 미러가 정본이고 이 표는 따라가지 않는다.

### 3-5. `commission_runs_public` — 컬럼을 좁힌 뷰

```sql
-- ← rev2 (M6). 기저 select 정책을 두고 뷰를 invoker 로 돌려 **행**을 fail-closed 로 만든다.
drop policy if exists commission_runs_select_own on public.commission_runs;
create policy commission_runs_select_own
  on public.commission_runs for select to authenticated
  using (auth.uid() = profile_id);
-- insert/update/delete 정책은 여전히 없다(쓰기는 definer RPC 전용).

-- ← rev3 (선행2). **행은 RLS, 컬럼은 GRANT.** 정책만 두면 컬럼은 Supabase 기본 부여로 전부 열린다.
revoke select on public.commission_runs from authenticated;
grant  select (run_id, profile_id, commission_id, grade, status, payload,
               verify_attempts, verified_result, created_at, started_at, verified_at)
  on public.commission_runs to authenticated;
-- loadout_sealed · replay_gz 는 목록에 없다 = **어떤 경로로도 안 나간다.**

create or replace view public.commission_runs_public
with (security_barrier = true, security_invoker = true)
as
  select run_id, profile_id, commission_id, grade, status, payload,
         verify_attempts, verified_result, created_at, started_at, verified_at
    from public.commission_runs
   where profile_id = auth.uid();

grant select on public.commission_runs_public to authenticated;
```

- **제외 컬럼**: `replay_gz` · `loadout_sealed`. (`replay`·`client_result` 는 rev2 에서 컬럼 자체가 사라졌다 — §3-3 M5.)
- ⚠️ **rev2 정정 (M6) — rev1 은 fail-open 이었다.** rev1 은 기저에 select 정책을 두지 않고 정의자 권한 뷰의 `where profile_id = auth.uid()` 한 줄에 **행 경계 전부**를 실었다. 구조가 뚫린 것은 아니었지만(기저 정책 0개 · `authenticated` 에만 grant · `security_barrier`) **실패 방향이 틀렸다**: 그 한 줄이 지워지면 즉시 전 계정 노출이고, 탐지 장치가 AC-R3 테스트 하나뿐이었다.
- **rev2 구조**: 기저 `commission_runs_select_own`(행 경계) + 뷰 `security_invoker = true`(컬럼 축소). **뷰의 `where` 를 지워도 RLS 가 본인 행만 통과시키므로 결과가 "유출"이 아니라 "무변화"다.** 비용은 정책 1개고, 원래 목적(컬럼 축소)은 그대로 유지된다.
- ⚠️ **`security_invoker = true` 를 빠뜨리면 rev1 로 되돌아간다** — 기저 정책이 있어도 정의자 권한 뷰는 RLS 를 우회한다. AC-R7 이 이것을 잡는다.
- ⚠️ **rev3 정정 (선행2) — rev2 의 M6 수정이 `loadout_sealed`·`replay_gz` 를 클라에 열었다. rev1 보다 나빴다.**
  - **RLS 정책은 행을 게이트하고, 컬럼은 GRANT 가 게이트한다.** rev1 에서 `commission_runs` 는 **정책이 0개**였으므로 클라가 기저를 **행 단위로 아예 못 읽었고**, 컬럼 축소는 뷰가 담당하면 충분했다.
  - rev2 는 fail-closed 를 만들려고 **select-own 행 정책을 추가**했다. 행이 열렸는데 **컬럼 GRANT 를 한 홉 더 안 밟았다.** 이 리포 전 마이그레이션에 **테이블 GRANT 문이 0건**이고(유일한 `grant select` 는 `20260727010000:240` 의 뷰 1건 — 전문 grep 확인) 나머지는 전부 **Supabase 기본 부여**(`public` 스키마 신규 테이블에 `authenticated` 전 컬럼 SELECT)에 의존한다.
  - 공격: `GET /rest/v1/commission_runs?select=run_id,loadout_sealed,replay_gz` — 뷰를 무시하고 기저를 직접 친다. 자기 행이 전부 나온다.
  - 얻는 것이 하필 **이 뷰 규율이 존재 이유로 든 바로 그 둘**이다: `loadout_sealed`(EF 게이트 3 의 **위조 대조 기준값** — §3-5 가 "노출 이득 0 + 대조 기준값이라 뺐다"고 명시) · `replay_gz`(§3-6 이 이 규율의 **유일한 이득**으로 든 "합격하는 입력로그를 연구할 재료"). **즉 rev2 의 수정이 §3-5·§3-6 을 통째로 무효화했다.**
  - **rev3: 행은 RLS, 컬럼은 GRANT 로 각각 fail-closed.** 위 `revoke` + 컬럼 목록 `grant` 가 그것이다.
  - **컬럼 목록이 곧 드리프트 탐지기다**: `security_invoker` 뷰는 **호출자 권한으로** 기저를 읽으므로 이 GRANT 목록과 뷰 select 목록이 **정확히 일치해야 뷰가 동작한다.** 불일치가 즉시 오류로 드러난다.
  - ⚠️ **그리고 이것은 R 계열 AC 4건이 전부 초록인 채로 샜다** — AC-R1 은 rev2 가 "0행"→"본인 행만"으로 바꿔 **유출 상태에서 통과**, AC-R2 는 **뷰의** `information_schema.columns` 만 보고 기저를 안 봄, AC-R7 은 뷰의 `security_invoker` 만 봄. **AC-R8 이 이 사각지대를 닫는다.**
- `payload` 는 노출한다 — 클라가 `consume_commission` 반환으로 이미 갖고 있고, 수신소 UI 가 무대·주문·보상을 표시해야 한다.
- **`loadout_sealed` 를 뺀 것은 노출 이득 0 + 위조 대조 기준값이기 때문**이다.

### 3-6. 자인 — 이 RLS 규율은 침공보다 엄격한 신규 규율이다

`invasions_select_participant`(`20260717000000:359-363`)는 **컬럼 제한이 없는 행 select** 다 — 참여자는 `replay`·`replay_gz`·`client_result` 를 PostgREST 로 **직접 읽는다.** `get_invasion_replay_gz`(`20260726000100:70-101`)는 그 위의 편의 RPC(bytea→base64·48h 게이트)이지 유일 통로가 아니다.

- 따라서 의뢰를 뷰로 좁히는 것은 "침공과 다르게 간다"가 아니라 **침공보다 엄격한 신규 규율**이다.
- **비용**: 수신소 UI 가 기저 테이블을 못 읽고 뷰를 경유해야 하며, 뷰에 컬럼을 추가할 때마다 노출 판정을 다시 해야 한다.
- **얻는 것**: "합격하는 입력로그의 형태를 연구할 재료를 주지 않는다" 하나. 의뢰는 관전 기능이 없다.
- **침공에 소급하지 않는다** — 관전(replaySpectate)이 실제로 그 컬럼을 쓴다. 범위 밖.

---

## 4. 발령 경로 — 트리거와 내부 함수

### 4-1. 트리거

```sql
create or replace function public.trg_commission_issue_on_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.verified_status = 'verified'
     and (tg_op = 'INSERT' or old.verified_status is distinct from 'verified') then
    perform public.issue_commission_for_run(new.id, new.profile_id, new.summary);
  end if;
  return null;                  -- AFTER 트리거이므로 반환값은 무시된다.
end;
$fn$;

drop trigger if exists pve_runs_issue_commission on public.pve_runs;
create trigger pve_runs_issue_commission
  after insert or update of verified_status on public.pve_runs
  for each row execute function public.trg_commission_issue_on_verified();
```

- **`tg_op` / `old` 가드**로 `verified → verified` 재기록에서 재발화하지 않는다. 그래도 §3-2 의 PK 가 최종 방어다(**두 겹**: 술어 가드 + 구조 제약).
- **`settle_pve_run` 은 한 글자도 고치지 않는다.**
- ⚠️ **트리거는 정산 트랜잭션 안에서 돈다.** 여기서 예외가 나면 **PvE 정산 전체가 롤백된다.**
- ⚠️ **rev2 정정 (C2) — rev1 은 이것을 "예외 무발생 계약"(문서 규율 + 테스트)으로 막았다. 부족하다.** rev1 의 DDL **자신이** 예외 원천을 다섯 개 갖고 있다: `commission_inventory.grade check (1..4)` · `payload jsonb not null`(§3-1) · `commission_issues.granted not null` · `skip_reason check` · `profiles` FK(§3-2). 5단계 서버 RNG 가 경계에서 `grade=0` 을 내거나 payload 가 null 이면 → check 위반 → 트리거 롤백 → **`settle_pve_run` 전체 실패 → 전 플레이어 자원 0 지급, 화면은 조용.** 이것은 **PR#222 와 문자 그대로 같은 실패 형상**이다(`20260802000000:11-15`). 게다가 계급·payload 생성 입력이 클라 `p_summary` 에서 오면 **서버 전체 정산을 죽이는 입력을 찾는 공격**이 된다.
- → **결정(rev2): `issue_commission_for_run` 본문 전체를 plpgsql 서브트랜잭션으로 감싼다.**
  ```
  begin
    <§4-2 본문 1~6>
  exception when others then
    raise warning 'issue_commission_for_run 실패(pve_run_id=%): %', p_pve_run_id, sqlerrm;
    return;                      -- 서브트랜잭션만 롤백. 바깥 정산은 커밋된다.
  end;
  ```
  - ⚠️ **rev3 문구 정정**: plpgsql `OTHERS` 는 **`query_canceled`·`assert_failure` 를 잡지 않는다.** 발령 중 `statement_timeout` 이 터지면 정산은 **여전히 롤백된다** — "어느 단계에서 예외가 나도"는 엄밀히는 참이 아니다. 실무상 그 경우는 세션 취소라 정산 응답 자체가 실패하므로 **조용한 자원 0 지급(PR#222 형상)은 발생하지 않지만**, 계약 문구는 정확해야 한다.
  - **fail-closed 로 안전하다**: 서브트랜잭션 롤백으로 §4-2 1단계의 앵커 행도 함께 사라지지만, 그 `pve_runs` 행은 이미 `verified` 로 커밋돼 **트리거가 재발화하지 않는다**(§4-1 의 `old`/`tg_op` 가드). 즉 재처리 경로가 없고 결과는 **의뢰서 미발령** — 지급 쪽으로 새지 않는다.
  - **자인**: 그래서 발령 실패는 `raise warning` 으로만 남고 플레이어는 알지 못한다. 관측(§7-3 형식)으로 warning 발생률을 모니터한다.
- **AC-I5 가 rev2 에서 뮤테이션으로 바뀐다** — "세 경로에서 정상 반환"은 **rev1 의 항진**이었다(세 경로는 원래 예외를 안 던지므로 감싸지 않아도 통과한다).
- **참고 (문제 없음, 근거로 남긴다)**: `settle_pve_run` 은 `app.in_settle` 을 `:116` 에서 세우고 **`:122` 에서 끈 뒤** `:127-148` 에서 `pve_runs` 를 쓴다. AFTER 트리거는 그 문장 끝에 발화하므로 **GUC 가 이미 꺼진 상태**다 — "촉매 패턴 복제로 플래그가 서는" 사고는 발령 경로에서 **구조적으로 불가능**하다.

### 4-2. `issue_commission_for_run` — 내부 전용 함수

```
issue_commission_for_run(p_pve_run_id uuid, p_profile_id uuid, p_summary jsonb) returns void
```

- **권한**: `revoke all from public, anon, authenticated`. **`service_role` 에도 grant 하지 않는다** — 호출자는 트리거 하나뿐이고, 트리거 함수가 definer(소유자 postgres)라 EXECUTE 가 통과한다(§1-1 셋째 항). **어디에서도 직접 부를 수 없다** = 계획이 원한 "독립 RPC 미노출"의 구조적 실현.
- `security definer` + `set search_path = ''`.

**본문 순서(전부 예외 없이 조용히 반환):**

| # | 단계 | 실패 시 |
|---|---|---|
| **0** | **전체를 서브트랜잭션으로 감싼다**(§4-1 C2). 아래 어느 단계에서 예외가 나도 바깥 정산은 커밋된다 | ← rev2 |
| 1 | `v_victory := (p_summary->>'victory' = 'true' and p_summary->>'bossKilled' = 'true')`; `v_ft := coalesce(nullif(p_summary->>'finalTick','')::int, 0)` (비숫자 방어). `insert into commission_issues (pve_run_id, profile_id, granted, claimed_victory, claimed_final_tick) values (p_pve_run_id, p_profile_id, false, v_victory, greatest(0, v_ft)) on conflict (pve_run_id) do nothing` → `get diagnostics v_n = row_count`; `v_n = 0` 이면 **즉시 return** | 1회성 — 이미 판정을 거친 앵커. **자격 판정을 INSERT 앞으로 당긴 것이 rev2 변경**(M2 ①) |
| 2 | **자격 + 개연성 하한** ← **rev3 (선행1 a)**: `not v_victory` **또는 `v_ft < MIN_BOSS_KILL_TICKS`(3,600)** 이면 `skip_reason:='not-victory'` 로 갱신 후 return | 클라 주장(§2-3 자인). **하한이 없으면 3b 를 공격자가 0 으로 만든다** |
| 3 | **빈도**: `select count(*) from commission_issues where profile_id = p_profile_id and claimed_victory and created_at > now() - interval '1 hour'` ≥ `CAP_ISSUE_ATTEMPTS_PER_HOUR`(20) 이면 `skip_reason:='rate'` 후 return. 1단계에서 자기 행을 이미 넣었으므로 **자기 자신이 카운트에 포함된다** — 상수 20 은 그 포함 기준이다 | §2-4. **`and claimed_victory` 가 rev2 변경** |
| **3b** | **쿨다운 — 누적 예약 지평** ← **rev3 (선행1 b, rev2 를 대체)**: `v_horizon := coalesce((select max(next_eligible_at) from public.commission_issues where profile_id = p_profile_id), now())`. `v_horizon > now()` 이면 `skip_reason:='cooldown'` 후 return | 아래 §4-3 |
| 4 | 재고: `select count(*) from commission_inventory where profile_id = p_profile_id` ≥ 보관 상한이면 `skip_reason:='stock'` 후 return | 상한 실값 **미확인**(§13-①) |
| 5 | 계급·payload 를 굴린다(RNG 는 서버). **보유 유니크를 제외하지 않는다 — 중복 지급 허용**(계획 pre-mortem ⑥) | — |
| 6 | `insert into commission_inventory ... returning commission_id into v_cid`; `update commission_issues set granted = true, commission_id = v_cid, **next_eligible_at = greatest(now(), v_horizon) + make_interval(secs => greatest(0, v_ft) / 60.0)** where pve_run_id = p_pve_run_id` | **지평 전진은 granted 일 때만.** 미발령 행은 `default now()` 라 max 에 영향이 없다 |

- 5 단계의 굴리기 RNG 는 `gen_random_uuid()`/`random()` 계열이며 **sim 해시와 무관**하다(서버 전용). `src/sim` 을 건드리지 않는다(Principle 6).
### 4-3. rev2 — 빈도 상한이 세는 양을 고친다 (M2)

> ⚠️ **이 절의 ①(`and claimed_victory`)만 유효하다. ②(쿨다운)는 rev3 에서 폐기됐고 §4-4 가 정본이다.** 두 절은 항상 함께 인용한다.

**rev1 이 틀린 지점**: rev1 은 1단계에서 행을 무조건 넣고 **2단계에서야 승리를 봤다.** 그래서 3단계 count 가 **패배·중도 이탈 정산까지** 셌다. 귀결이 정확히 반대였다:

- **정직한 플레이어**: 빠르게 재시작하며 지는 런이 많은 사람이 슬롯을 다 먹어 **의뢰서가 끊긴다.**
- **공격자**: 위조 `victory:true` summary 만 보내므로 **20장을 그대로 받는다.** 시도당 비용이 0 이다.

→ **공격자 비용은 안 올리고 정직한 사용자만 벌하는 상한**이었다. rev1 이 §2-3·§12-① 에서 "유일한 실질 방어"라고 못 박은 축이 이 상태였으므로, 그 자인이 실제로는 **방어 미조달**이었다.

**rev2 의 두 축**:

1. **`and claimed_victory`** — 패배 정산은 슬롯을 소모하지 않는다. **"상한에 걸려 미발령"은 여전히 카운트된다**(그 행도 `claimed_victory=true` 이므로) — §2-4 가 요구한 "grant 만 세면 상한이 자기를 무력화한다"는 성질이 보존된다.
2. ~~**주장 런 길이 비례 쿨다운** — 직전 granted 행의 `claimed_final_tick / 60` 초를 기다린다. `grant_currency` 개연성 캡과 같은 논리다.~~ ← **rev3 에서 폐기. 아래 §4-4 가 대체한다.**

### 4-4. rev3 — 쿨다운을 다시 세운다 (선행1)

**⚠️ rev2 의 쿨다운은 공격을 못 막았다. 비례 계수를 공격자가 골랐기 때문이다.**

공격: `settle_pve_run({victory:"true", bossKilled:"true", finalTick:1})` 반복.

| 단계 | rev2 거동 |
|---|---|
| 1 | `claimed_final_tick = 1` 로 기록 |
| 2 | 자격 통과 — 판정 입력이 `victory`·`bossKilled` **두 문자열뿐이고 틱 하한이 없다** |
| 3b | 쿨다운 = `1/60`초 ≈ **0** → 즉시 다음 발령 |

→ 남는 제약이 **rev1 과 똑같이 `CAP_ISSUE_ATTEMPTS_PER_HOUR`(20) 하나**였다. rev2 가 적은 비용 논증("짧게 주장하면 쿨다운이 짧은 대신 보상 자격 판정이 그대로 남는다")은 **그 자격 판정도 클라 주장 두 글자**라 성립하지 않았다.

**⚠️ `grant_currency` 개연성 캡과 "같은 논리"라는 rev2 의 유비가 특히 틀렸다 — 부호가 반대다.**

| | 작은 `finalTick` 을 주장하면 |
|---|---|
| 개연성 캡(`20260727000000:423-424`) | 상한이 `틱 × (1+stage)` 에 비례하므로 지급이 **깎인다** → 공격자에게 **손해** |
| rev2 쿨다운 | 대기가 `틱/60` 이므로 **짧아진다** → 공격자에게 **이득** |

**같은 입력을 쓴다는 것이 같은 논리라는 뜻이 아니다.** 방어 장치를 기존 장치에 유비할 때는 **입력이 아니라 부호**를 대조해야 한다는 교훈으로 남긴다.

→ **rev3 결정 — 두 조각이 함께 있어야 성립한다:**

**(a) 자격에 개연성 하한** (§4-2 2단계)

```
MIN_BOSS_KILL_TICKS constant int := 3600;   -- 60초. 실값은 sim 실측(§13-⑫)
if not v_victory or v_ft < MIN_BOSS_KILL_TICKS then … 'not-victory' … end if;
```

보스를 잡은 승리 런이 **물리적으로 가질 수 없는 길이**를 자격에서 배제한다. **이것이 없으면 (b)를 공격자가 0 으로 만든다** — (a)와 (b)는 독립 방어가 아니라 **한 방어의 두 조각**이다.

**(b) 쿨다운을 "직전 행 읽기"가 아니라 "미래 예약 누적기"로** (§4-2 3b·6단계)

```
지평 = max(next_eligible_at)                      -- 프로필별
발령 게이트: 지평 > now() 이면 미발령('cooldown')
발령 시 전진: next_eligible_at := greatest(now(), 지평) + (claimed_final_tick / 60) 초
```

- **성질**: 발령은 지평이 과거일 때만 열리고 매 발령이 지평을 주장한 만큼 밀므로, **어떤 창에서도 "발령된 런들이 주장한 시간의 합 ≤ 실제 경과 시간"** 이 성립한다. 짧게 주장하면 (a)가 막고, 길게 주장하면 그만큼 **실제로** 기다린다.
- **rev2 의 "직전 행 기준"이 놓친 것**: 그 형태는 지평이 누적되지 않아 **긴 주장과 짧은 주장을 번갈아** 파이프라이닝할 수 있었다.
- **rev1→rev2→rev3 의 궤적을 기록한다**: rev2 는 "현재 행 기준이면 짧게 주장하고 즉시 또가 성립한다"며 직전 행 기준을 골랐는데, **배제 근거는 맞았지만 대안도 같은 병을 앓았다.** 두 선택지가 다 틀렸고 정답은 제3의 형태(누적기)였다. **"둘 중 낫다"로 고르면 셋째를 못 본다.**
- **GC 무해**: cron ④(7일)가 지운 행은 `next_eligible_at` 이 이미 과거다(쿨다운 지평은 최대 `replayBudgetTicks/60` 초 ≈ 분 단위). 따라서 **rev2 가 §10 에서 "부등식 근거 명시"로 남겼던 GC 우려 자체가 소멸한다.**
- **정직한 플레이어에게 무해**: 실제로 그 길이를 플레이했으므로 이미 그만큼 시간이 흘렀다. 오거부 0.
- **잔여 자인**: `finalTick`·`victory` 는 여전히 클라 주장이다. (a)+(b)가 하는 일은 **위조를 막는 것이 아니라 위조 처리량의 상한을 공격자가 고를 수 없게 만드는 것**이다. 상한 자체는 `20/h` 와 `실시간/MIN_BOSS_KILL_TICKS` 중 작은 쪽으로 **서버가 고정**한다.

- **의뢰 런의 정산은 이 경로를 타지 않는다** — 의뢰 런은 `settlePveRunCurrency`(→`settle_pve_run`)를 호출하지 않으므로(§8) `pve_runs` 행이 생기지 않고, 따라서 트리거가 발화할 대상이 없다. **"의뢰 런이 다시 의뢰서를 낳지 않는다"(`CONTEXT.md:669`)가 코드 분기가 아니라 구조로 성립한다.**

---

## 5. 신규·개정 RPC 전량

### 5-1. CRIT-B 결정 — 재화 관문

#### 사실

1. `grant_currency` 는 수령자를 `auth.uid()` 로 **내부 고정**하고 파라미터로 받지 않는다(`20260727000000:371`). service_role JWT 에는 `sub` 가 없어 **`auth.uid()` = null → `:396-398` 에서 예외** ("로그인 필요"). 즉 EF 가 부르면 **지급이 아니라 실패**한다.
2. `apply_invasion_result` 선례는 행에서 수령자를 도출하고 `profiles` 를 직접 갱신하지만 **`currency_grants` 원장을 우회한다**(`20260726000000:425-428`, `:481-483` 계열 — 복수 보너스 광물 50 과 방어 보상 크레딧 40 을 원장 기록 없이 가산). 즉 **침공 축은 1h/24h 누적 캡 밖에 있다.** 이것을 복제하면 의뢰 축도 폭주 방어를 잃는다.
3. **`grant_currency` 는 `authenticated` 가 직접 호출 가능하고 `p_source` 를 검증하지 않는다.**

#### 결정 — (나) `grant_currency_for` 위임. (가)·(다)는 기각

```
grant_currency_for(p_profile_id uuid, p_credits numeric, p_minerals numeric,
                   p_source text, p_metrics jsonb default null) returns jsonb
  -- 현행 grant_currency(20260727000000:339) 본문 전량을, v_me := auth.uid() 대신
  -- v_me := p_profile_id 로만 바꿔 옮긴다. 캡 산식·원장 기록·플래깅은 한 글자도 안 바뀐다.
  -- 권한: revoke from public/anon/authenticated; grant execute to service_role.

grant_currency(p_credits, p_minerals, p_source, p_metrics default null) returns jsonb
  -- 본문이 다음으로 축소된다(← rev2 C1: blocklist → **allowlist(default-deny)**):
  --   if auth.uid() is null then raise exception 'grant_currency: 로그인 필요'; end if;
  --   if p_source is null or p_source not in ('pve_run','salvage','story') then
  --     raise exception 'grant_currency: 허용되지 않은 source(%)', p_source;
  --   end if;
  --   return public.grant_currency_for(auth.uid(), p_credits, p_minerals, p_source, p_metrics);
  -- 권한·시그니처 불변: authenticated + service_role (기존 호출부 무영향).
```

**⚠️ source 게이트가 이 결정의 하중 부재다.** 계획 rev7 D10 은 `grant_currency` 에 고캡 `commission` 분기를 신설하라고 했는데, 그 함수는 클라가 직접 부를 수 있고 `p_source` 를 검증하지 않는다 → **`grant_currency(30000, 30000, 'commission')` 한 줄로 무료 지급 창구가 열린다.** rev7 이 못 본 CRITICAL 이다. 캡 표는 공유 본문에 있고 **게이트는 진입점이 진다.**

**⚠️ rev2 정정 (C1) — rev1 의 `commission` 단독 거부(blocklist)는 부족했다.** rev1 은 **자기가 만드는 구멍만** 봤고 **이미 열려 있는 더 큰 구멍**을 못 봤다:

- 미등록 source 는 `else` 분기로 `CAP_DEFAULT_*` = **1,000/1,000** 을 받는다(`20260727000000:435`).
- 개연성 캡은 `p_source = 'pve_run'` 일 때만 산정되므로(`:406`) 그 외에는 `null` → `least()` 가 무시한다(`:469-470`).
- 즉 **인증된 아무 사용자가** `rpc/grant_currency {p_credits:1000, p_minerals:1000, p_source:"x"}` 를 **시간당 50회** 불러 `CAP_HOURLY_*` 상한인 **50,000/50,000 을 런 없이** 얻는다(일 300,000/300,000 — `:359-362`). 남는 방어는 누적 캡뿐이다.
- **이 구멍은 이 계약이 만드는 것이 아니라 현행 코드에 이미 있다.** 그러나 **이 계약이 바로 그 함수를 재정의하므로 지금이 유일하게 싼 수리 시점**이다. 그냥 두면 "우리가 만든 게 아니다"라는 이유로 영구 잔존한다.

→ **allowlist 로 바꾸면 `commission` 차단과 `CAP_DEFAULT_*` 창구 폐쇄가 같은 한 줄에서 함께 일어난다.** 통과 집합이 유한 리터럴 3종으로 고정되므로 **대소문자·공백 정규화 문제(m3)도 함께 닫힌다.**

#### allowlist 3종의 전수 근거 (grep 확인)

| source | 호출 경로 | 좌표 |
|---|---|---|
| `pve_run` | `settle_pve_run` 내부 중첩 호출 | `20260802000000:119` |
| `story` | 클라 `gateway.grantCurrency(…, 'story')` — 정산 후 사연 보상 · 대기 큐 재시도 | `src/net/index.ts:197`, `:570` |
| `salvage` | 클라 `grantCurrencyToServer(…, 'salvage')` — 격납고 살베지 | `src/ui/pixi/hangar.ts:445` |

`src/net/gateway.ts:307-318` 이 유일한 RPC 래퍼이고 `p_source` 를 그대로 싣는다. `src/net/index.ts:227`·`:590` 은 위 두 값을 전달·재생하는 경유지다. 촉매 잔재 경로는 `grant_currency` 를 **타지 않는다**(`src/net/index.ts:387` 주석).

#### 회귀 절 — 이 변경이 기존 경로를 깨지 않는가

| 경로 | 판정 | 근거 |
|---|---|---|
| `settle_pve_run` → `'pve_run'` | **무변화** | allowlist 통과. `app.in_settle` GUC 는 여전히 `grant_currency_for` 본문에서 읽히고(`:418-420`) `settle_pve_run` 이 세운 트랜잭션-로컬 플래그가 중첩 호출에 그대로 보인다 — **촉매 `resourceMult` 관통 유지** |
| 격납고 살베지 → `'salvage'` | **무변화** | allowlist 통과 |
| 사연 보상 → `'story'` | **무변화** | allowlist 통과 |
| **대기 재화 큐 재생**(`flushPendingGrants`, `src/net/index.ts:590`) | ⚠️ **주의 필요** | `PendingGrant.source` 는 `string` 이고(`src/net/profileSync.ts:303`) localStorage 에서 `typeof === 'string'` 만 검사해 되읽는다(`:324`). 실제 stash 경로는 `'salvage'` 하나뿐이지만, **조작·구버전 항목이 들어 있으면 이제 예외가 나고 `:591-592` 가 항목을 큐에 되돌려 무한 재시도로 고인다.** 전에는 조용히 1,000 으로 캡됐다 |
| 서버 정산 → `'commission'` | **차단(의도)** | `grant_currency_for` 로만 도달 |

→ **클라 측 조치 1건을 PC 범위에 배정한다**: `flushPendingGrants` 가 항목을 보내기 전에 **같은 allowlist 로 필터**하고, 벗어난 항목은 **재큐잉하지 않고 폐기**한다(무한 재시도 방지). **AC-C10** 이 이것을 잡고, 상수는 SQL·TS 미러 동기화 대상이다(AC-G2 확장).

**왜 `is_service_role()` 로 게이트하지 않는가**: `grant_currency` 는 definer(소유자 postgres)라 그 안에서 `is_service_role()` 이 **항상 참**이다(§1-1). 판별에 쓸 수 없다. `caller_is_service_role()`(JWT) 로 게이트하면 정문 자체가 service_role 전용이 되어 클라의 `story` 지급이 깨진다. **source 거부가 유일하게 정합한 형태다.**

**왜 `grant_currency_for` 를 authenticated 에서 revoke 하는가**: 안 하면 클라가 `grant_currency` 를 우회해 `grant_currency_for(me, …, 'commission')` 을 직접 부른다. revoke 는 PostgREST 에서 `permission denied` 로 끊는다 — **열거가 아니라 구조.** 중첩 definer 호출은 `current_user=postgres` 라 통과한다(§1-1 셋째 항).

**기각 사유**
- **(가) `grant_currency` 시그니처에 수령자 추가** — 기각. 호출부 3곳(`settle_pve_run:119` · 클라 `gateway.grantCurrency` · 향후) 전부와 오버로드 해소가 흔들리고, 회귀면이 넓다. 이득은 함수 1개를 안 만드는 것뿐.
- **(다) `settle_commission` 이 `profiles` 를 직접 가산하고 `currency_grants` 에 함께 기록** — 기각. **캡 산식이 두 본문으로 갈린다.** 이 리포에는 같은 산식을 복제했다가 한쪽만 갱신돼 사고가 난 전례가 있다(`20260802000000:4-15`). 누적 캡·플래깅·개연성 캡 셋을 두 곳에서 동기 유지하는 비용이 함수 1개보다 훨씬 크다.

#### `source='commission'` 캡 (`grant_currency_for` 공유 본문에 추가)

| 상수 | 값 | 근거 |
|---|---|---|
| `CAP_COMMISSION_CREDITS` | **30,000** | 최종 지시 계급 최대 확정 보상 + 여유. `CAP_HOURLY_*`(50,000) 아래로 두어 정직한 1회 지급이 누적 캡에 먼저 걸리지 않게 한다 |
| `CAP_COMMISSION_MINERALS` | **30,000** | 동상 |

- **`CAP_DEFAULT_*`(1,000)에 떨어지지 않게 `case p_source` 에 분기를 반드시 신설한다**(`20260727000000:429-436`). 분기가 없으면 **최종 지시의 확정 보상이 조용히 1,000 으로 클램프된다.**
- **개연성 캡 미적용** — `p_source='pve_run'` 가드(`:406`)가 이미 그렇게 동작하므로 **추가 코드가 없다.** 그 사실을 계약으로 명문화한다. 논리: 개연성 캡은 "리플레이가 없어 결과를 못 믿을 때 물리적 가능 범위로 유계하는" 장치다. 의뢰 런은 **서버 재실행 증거가 있으므로 증거가 캡을 대체한다.**
- **`app.in_settle` 을 세우지 않는다.** `resourceMult` 를 `p_metrics` 에 싣지 않는다(촉매 주입 불가라 배율이 없다). `grant_currency_for` 는 `p_source='pve_run'` 이 아니면 그 GUC 를 읽지도 않는다(`:418-420`) — **구조적으로 안전하지만, "촉매 패턴을 복제"하다 플래그를 세우는 일을 막기 위해 계약에 적는다.**
- **1h·24h 누적 캡은 그대로 문다**(`:449-466`). 폭주 방어이지 개연성 판정이 아니므로 재실행 증거가 대체하지 않는다.
- ⚠️ **자인**: `CAP_HOURLY_CREDITS = 50,000` 이므로 **최대 등급 의뢰를 시간당 1회 남짓만 전액 수령할 수 있다.** 정직한 고빈도 플레이어가 클램프될 수 있다. 밸런스 축이며 §13-② 에 남긴다.
- **SQL 상수와 TS 상수 모듈을 함께 갱신한다**(이 리포의 미러 동기화 의무 — `20260727000000:43-46` 선례).

### 5-2. `consume_commission` — 출격

```
consume_commission(p_commission_id uuid, p_loadout jsonb) returns jsonb
  권한: authenticated + service_role.  security definer, search_path = ''
  수령자 도출: auth.uid()
```

| # | 단계 | 거부 코드(예외 메시지) |
|---|---|---|
| 1 | `auth.uid()` null | `consume_commission: 로그인 필요` |
| 2 | **빈도 상한**: `select count(*) from commission_runs where profile_id = v_me and created_at > now() - interval '1 hour'` ≥ `CAP_CONSUME_PER_HOUR`(**12**) | `consume_commission: 출격 빈도 상한 초과` |
| 3 | `select … from commission_inventory where commission_id = p_commission_id and profile_id = v_me **for update**` → not found | `consume_commission: 의뢰서 없음` |
| 4 | `delete from commission_inventory where commission_id = p_commission_id` | — |
| 5 | `insert into commission_runs (profile_id, commission_id, grade, status, payload, loadout_sealed) values (v_me, …, 'issued', v_payload, p_loadout) returning run_id` | — |
| 6 | 반환 `{ run_id, payload }` | — |

- **잠금 순서**: `commission_inventory` 1행만 잠근다. 다른 테이블을 잠그지 않으므로 교착 상대가 없다.
- 2·3·4 가 한 트랜잭션이라 **의뢰서 1장 = `commission_runs` 1행**이 원자적이다.
- `p_loadout` 은 **클라 미러에서 온 값**이다 — 봉인 대조가 닫는 것은 "출격 후 편집"뿐이고 출격 **전** 위조는 열려 있다(ADR-0044 §한 겹 방어, ADR-0028).

### 5-3. `mark_commission_active` — 런 시작 신호

```
mark_commission_active(p_run_id uuid) returns jsonb
  권한: authenticated + service_role.  security definer, search_path = ''
```

```
GRACE_ISSUED_TO_ACTIVE = 10분   (상수 모듈 + SQL 미러)
```

| # | 단계 | 결과 |
|---|---|---|
| 1 | `select status, created_at from commission_runs where run_id = p_run_id and profile_id = auth.uid() for update` → not found | 예외 `mark_commission_active: 행 없음` |
| 2 | `status <> 'issued'` | 예외 `mark_commission_active: 전이 불가 상태(%)` — **no-op 이 아니라 명시 거부** |
| 3 | `created_at < now() - GRACE_ISSUED_TO_ACTIVE` | 예외 `mark_commission_active: 전이 시한 초과` |
| 4 | `update … set status='active', started_at = now() where run_id = p_run_id and status='issued'` | 반환 `{ run_id, started_at }` |

- **시한을 전이 자체에 박는 것이 D8 ①의 핵심이다.** 이것이 없으면 "신호 안 보내고 런을 돌린 뒤, 이기면 그때 신호+제출 / 지면 방치→회수"가 성립한다.
- **별도 호출 빈도 카운터를 두지 않는다.** 이유: 전이는 `status='issued'` 게이트 때문에 행당 **정확히 1회**만 성공하고, `issued` 행을 만드는 유일한 경로는 `consume_commission` 이며 **거기에 시간당 상한이 걸려 있다**(§5-2 ②). 상한을 **행 생성 지점**에 두는 것이 상태 전이 지점에 두는 것보다 구조적으로 강하다.
  - **자인**: 실패 호출(2·3 거부)은 무제한 시도 가능하다. 이들은 상태를 바꾸지 않고 DB 쓰기도 없으므로 남는 것은 순수 읽기 부하다. **대체 방어**로 이 RPC 를 Supabase 플랫폼 레이트리밋 대상으로 남긴다(별도 조달 없음 — 부하 축이지 정합성 축이 아니다).
- `GRACE = 10분` 의 근거: 정직한 로딩·수신소 확인 여유. **방어 요건이 아니라 UX 요건**이다(D8 ③ — 착취 차단은 1·2·3 과 EF 게이트 0 이 진다). 늘려도 방어가 약해지지 않는다.

### 5-4. `settle_commission` — 확정 지급

```
settle_commission(p_run_id uuid, p_verdict text, p_verified_result jsonb,
                  p_run_credits numeric, p_run_minerals numeric) returns jsonb
  권한: service_role 전용 (revoke from public/anon/authenticated)
  게이트: caller_is_service_role() 예외 + grant 이중 (apply_invasion_result:289-291 동형)
  수령자 도출: **commission_runs.profile_id — 행에서. 파라미터로 받지 않는다.**
  security definer, search_path = ''
```

| # | 단계 | 비고 |
|---|---|---|
| 1 | `if not caller_is_service_role() then raise exception 'settle_commission: service_role 전용 호출'` | 정문 |
| 2 | `select * into v_run from commission_runs where run_id = p_run_id **for update**` → not found → 예외 | 잠금 시작 |
| 3 | `v_run.status in ('verified','rejected')` → **`v_run.verified_result` 를 그대로 반환**(`note:'already-finalized'`) | 멱등. `apply_invasion_result:298-304` 동형 |
| 4 | `v_run.status <> 'active'` → 예외 `settle_commission: active 아님(%)` | **D8 ② — `issued`/`expired`/`abandoned` 는 cron 실행 여부와 무관하게 거부** |
| **4b** | `v_run.started_at is null or v_run.started_at <= now() - interval '24 hours'` → 예외 `settle_commission: active 만료(%)` | ← **rev2 (M3)**. 아래 정정 |
| 5 | `p_verdict <> 'accept'` → `status='rejected'`, `verified_at=now()`, `verified_result=p_verified_result` 기록하고 **보상 0** 반환 | 실패 런 종결 |
| 6 | accept: `commission_grants` 삽입 — payload.rewards 의 `unique`/`blueprint` 각 항목을 `(p_run_id, kind, slot_index)` 로 `on conflict on constraint commission_grants_once do nothing` | 발급 |
| 7 | 자원 지급 **1회**: `grant_currency_for(v_run.profile_id, 확정보상.credits + p_run_credits, 확정보상.minerals + p_run_minerals, 'commission', null)` | §5-1 |
| 8 | `update commission_runs set status='verified', verified_at=now(), verified_result=p_verified_result where run_id=p_run_id and status='active'` | 종결 |
| 9 | 반환 `{ granted_credits, granted_minerals, credits_left, minerals_left, clamped, grants: [...] }` | 클라 미러 갱신용 |

- **잠금 순서**: `commission_runs`(2) → `profiles`(7 안에서 `grant_currency_for:439` 가 잠근다). 항상 이 순서다. `apply_invasion_result` 는 `invasions` → `ladder` → `profiles` 라 **공통 마지막 자원이 `profiles` 하나**이고 앞선 자원이 겹치지 않으므로 교착 사이클이 생기지 않는다.
- **행성 인기 배율을 읽지 않는다** — `planet_popularity` 를 조회하는 문장이 본문에 없다(ADR-0038 "대체 가능한 보상에만 배율", `CONTEXT.md:671`). 합류한 자원 축(`p_run_credits`/`p_run_minerals`)에도 **적용하지 않는다** — 의뢰 런 config 에 `planetMultCenti`/`planetMultEpoch` 를 스탬프하지 않으므로(계획 D13) 적용할 입력 자체가 없다.
- **`app.in_settle` 을 세우지 않는다.**
- ⚠️ **rev2 정정 (M3) — rev1 은 `ACTIVE_TTL` 을 cron ③에만 걸어 자기 계약의 D8 ② 를 위반했다.** rev1 은 `issued→active` 시한을 **전이 자체에** 박아 cron 지연을 무해화해 놓고(§5-3), `active` 만료는 **cron ③에만** 뒀다. cron 은 매시 정각이므로 `started_at + 24h` 를 넘긴 런이 **최대 1시간 제출 가능**했다 — rev6 의 항진 AC 를 만들었던 바로 그 형태의 지연 창이다. **rev2 는 나이 검사를 판정 지점 둘(여기 4b · EF 게이트 0c)에 직접 박고, cron ③ 은 청소 담당으로만 남긴다**(판정 주체 아님 보존).

#### 재시도 주체 — 계획 D13 과 ADR-0045 §결과를 정정한다

**계획과 ADR-0045 는 "부분 실패 시 서버 측 재시도"를 전제했다. 그 전제는 거짓이다.** 위 3~8 은 **plpgsql 함수 하나의 단일 트랜잭션**이다. 중간에 실패하면 6·7·8 이 **전부** 롤백되어 부분 상태가 존재하지 않고, 성공하면 8 이 커밋되어 3 이 이후 모든 재호출을 흡수한다. **원자성이 곧 멱등이다.**

- **재시도 주체 = 클라이언트.** 리플레이를 로컬 보존하고 `verify-commission` 을 같은 `run_id` 로 재호출한다(계획 pre-mortem ⑤). 이 주체는 **실제로 존재한다** — 침공의 `submitInvasion`(`src/net/invasionGateway.ts:395-423`)과 대기 큐 `stashPendingSettlement`(`src/net/index.ts:178`, `:189`, `:202`)가 같은 문법을 이미 쓴다.
- **재호출 비용은 0 에 가깝다** — EF 게이트 0 이 `status in ('verified','rejected')` 를 보고 저장된 `verified_result` 를 CPU 없이 돌려준다(§7).
- **서버 측 재시도(cron)를 만들지 않는다.** 만들 것이 없다 — 실패한 트랜잭션은 아무것도 남기지 않으므로 cron 이 볼 흔적이 없고, `active` 로 남은 행은 §6-3 이 종결한다.
- **클라가 끝내 재시도하지 않으면 보상은 소멸한다.** 자인한다(계획 §오프라인 절과 같은 판단 — 무제한 보관은 "성공 리플레이를 쟁여두고 유리한 시점에 제출" 축을 연다).
- **→ ADR-0045 §결과 첫 항("`commission_grants` 를 먼저 만들고 재화 지급을 멱등으로 구성한다 — 부분 실패가 나면…")은 개정 대상이다.** 삽입 순서 6→7 은 유지하되(그것이 자연스럽다) **근거가 "부분 실패 대비"가 아니라 "단일 트랜잭션 안의 서술 순서"임**을 적어야 한다.

### 5-5. `store_commission_replay_gz` — 압축 보존

```
store_commission_replay_gz(p_run_id uuid, p_gz text) returns void
  권한: service_role 전용.  security definer, search_path = ''
  update public.commission_runs set replay_gz = decode(p_gz,'base64')
   where run_id = p_run_id;   -- ← rev2 (M5): 지울 원본 jsonb 컬럼이 없다(§3-3)
```

`20260726000100:42-60` 의 침공판을 복제하되 **원본 jsonb null 화 두 줄을 뺀다**(rev2 M5 — 그 컬럼이 없다). **`get_*` 대응 RPC 는 만들지 않는다** — 의뢰는 관전이 없다(§3-6).

### 5-6. 만들지 않는 것

- **`restore_commission`** — RPC 로 노출하지 않는다(계획 D13 유지). 호출자가 cron 하나뿐이므로 회수 로직을 cron SQL 본문에 인라인한다. **존재하지 않는 함수는 권한 실수로 노출될 수 없다.**
- **`grant_commission`** — 계획이 붙인 이름의 RPC 를 만들지 않는다. 그 역할은 `issue_commission_for_run`(§4-2)이 지고, **그 함수는 어떤 role 에도 EXECUTE 가 없다.** 계획의 "독립 RPC 로 노출하지 않는다"가 명명 규율이 아니라 권한 구조로 실현된다.
- **`settle_commission` 의 재시도용 cron** — §5-4 참조.

### 5-7. `bump_commission_verify_attempts` — EF 재실행 시도 카운터 (rev2 M1)

```
bump_commission_verify_attempts(p_run_id uuid) returns int
  권한: service_role 전용 (revoke from public/anon/authenticated)
  게이트: caller_is_service_role() 예외 + grant 이중
  security definer, search_path = ''
  update public.commission_runs set verify_attempts = verify_attempts + 1
   where run_id = p_run_id and status = 'active'
   returning verify_attempts;          -- 행이 없으면 null
```

```
CAP_VERIFY_ATTEMPTS = 5   (상수 모듈 + SQL 미러)
```

- **EF 가 게이트 7(`verifyRun`) 직전에, `settle_commission` 과는 별개의 트랜잭션으로 호출한다.**
- ⚠️ **별도 트랜잭션이어야 한다는 것이 이 RPC 존재 이유의 전부다.** `settle_commission` 안에 넣으면 **중도 abort 한 시도가 롤백으로 사라져** 카운터가 무력해진다 — M1 공격이 정확히 "응답 직전 연결을 끊는" 형태이므로, 그 경우에 남지 않는 카운터는 아무것도 막지 못한다. EF 는 PostgREST 로 RPC 를 개별 호출하므로 **각 호출이 자기 트랜잭션**이다(구조로 성립).
- 반환값 > `CAP_VERIFY_ATTEMPTS` 이면 EF 가 `commission-too-many-attempts` 로 거부한다(§7-1 게이트 6b).
- 반환값이 null(행 없음/`active` 아님)이면 게이트 0 이 이미 걸렀어야 하는 상태다 — 경합으로 도달하면 거부한다.
- **`verify_attempts` 는 리셋되지 않는다.** `active` 창(24h) 안의 누적이고, 창이 끝나면 행이 `abandoned` 로 종결된다.
- **자인**: 정직한 플레이어의 네트워크 재시도도 카운트된다. 5회는 그 여유를 본 값이며, 초과 시 보상이 소멸한다(§12-⑧ 과 같은 성격의 손실). 실값은 §13-⑨ 관측 대상.

---

## 6. cron 전량

> 3건 전부 `20260803000000_commission_ledger.sql` 말미에 `select cron.schedule(...)` 로 등록한다.
> `cron.schedule` 은 (jobname) upsert 라 재적용 안전(`20260726000100:110` 계약).

```
GRACE_ISSUED_TO_ACTIVE = 10분     (§5-3)
ACTIVE_TTL             = 24시간   (멱등 재제출 창)
BLOB_TTL               = 48시간   (침공과 동일)
ISSUES_RETENTION       = 7일      (currency_grants·pve_runs 와 동일)
```

| # | 잡 이름 | 스케줄(UTC) | 대상 술어 | 동작 | 지연 허용치 |
|---|---|---|---|---|---|
| ① | `planet-blitz-recover-commission-issued` | `0 * * * *` | `status = 'issued' and created_at < now() - interval '10 minutes'` | `commission_inventory` 재삽입(원 payload·grade·profile_id) + `status := 'expired'` | **최대 1h + 10분.** 판정 주체가 아니므로 무해(D8 ③) |
| ② | `planet-blitz-gc-commission-replays` | `0 * * * *` | `status in ('verified','rejected','abandoned') and verified_at is not null and verified_at < now() - interval '48 hours' and replay_gz is not null` | `replay_gz := null`. **행은 보존** | 최대 1h |
| ③ | `planet-blitz-abandon-commission-active` | `0 * * * *` | `status = 'active' and started_at < now() - interval '24 hours'` | `status := 'abandoned'`, `verified_at := now()` (②가 48h 뒤 blob 을 치우게 한다) | 최대 1h |
| ④ | `planet-blitz-gc-commission-issues` | `20 2 * * *` | `created_at < now() - interval '7 days'` | `delete from commission_issues` | 일간. 빈도 창(1h) 대비 168배 여유 |

### 6-1. cron ① — 회수는 판정 주체가 아니다

**⚠️ rev2 정정 (M4) — rev1 의 "insert 먼저, update 나중"은 원자적이지 않았고 의뢰서를 복제할 수 있었다.**

rev1 은 `insert into commission_inventory … select … from commission_runs where …` 뒤에 `update commission_runs set status='expired' where …` 를 두었다. **INSERT 가 성공하고 UPDATE 가 0행이면 재고에 의뢰서가 돌아갔는데 런은 `issued` 로 살아 있다 = 1장이 2장이다.** rev1 시점에 도달 불가였던 것은 `GRACE` 부등식이 `mark_commission_active` 검사와 **우연히** 배타적이었기 때문이지 구조 때문이 아니었다 — **상수의 우연에 기대고 있었다.**

→ **rev2: 상태 전이를 구동자로 삼는 단일 CTE 문장.**

```sql
with moved as (
  update public.commission_runs
     set status = 'expired'
   where status = 'issued'
     and created_at < now() - interval '10 minutes'
  returning commission_id, profile_id, grade, payload
)
insert into public.commission_inventory (commission_id, profile_id, grade, payload)
select commission_id, profile_id, grade, payload from moved
on conflict (commission_id) do nothing;
```

- **`update … returning` 이 행 잠금과 술어 평가를 함께 한다.** 전이에 성공한 행만 INSERT 입력이 되므로 "재고에 있는데 런도 살아 있다"가 **원리적으로 불가능**하다.
- **`on conflict do nothing`** — cron 이 실패 후 재실행돼도 복제되지 않는다. `commission_id` 가 원래 PK 였으므로 복원 키가 그대로 있다.
- **뮤테이션**: 순서를 rev1 형태(insert → update)로 되돌리면 AC-S4b 가 실패해야 한다.
- **모든 테이블을 `public.` 으로 수식한다**(rev2 m2) — pg_cron 은 스케줄 롤의 `search_path` 로 돌아 `set search_path=''` 규율 **밖**이다. 리포 선례도 전부 수식이다(`20260726000100:124-128`). ②③④도 동일.
- **회수 지연(최대 1h)이 방어에 영향을 주지 않는다**: 착취 차단은 §5-3 의 전이 시한과 §5-4 ④의 `status='active'` 요구가 진다. cron 은 **의뢰서를 돌려주는 편의 장치**일 뿐이다.

### 6-2. cron ② — `replay_gz` 만 비운다 (rev2 M5)

**⚠️ rev2 정정 — rev1 은 "세 컬럼 모두 비운다"였고, 그 근거는 침공 전제의 무비판 복제였다.**

rev1 이 든 근거(`20260726000100:114-118` — "조기 구조 reject 는 gzip 아카이브를 거치지 않아 원본 `replay`(jsonb)만 남는다")는 **침공에서만 참**이다:

- **침공**: 클라가 `invasions` 행을 `replay`·`client_result` **째로 INSERT** 한다(`src/net/invasionGateway.ts:399-407`). 정책 `invasions_insert_attacker`(`20260717000000:352-356`)가 그것을 허용한다. 그래서 EF 가 조기 거부하면 원본 jsonb 가 테이블에 남는다.
- **의뢰**: `commission_runs` 행은 `consume_commission` 이 **런 시작 전에** 만들고, 이 테이블에는 **쓰기 정책이 하나도 없다**(§3-3). **클라가 원본 jsonb 를 넣을 경로가 존재하지 않는다.**

귀결: rev1 의 두 컬럼은 **영원히 null** 이었고 그것을 대상으로 삼은 술어는 **영원히 거짓**이었다. 즉 rev1 의 cron ② 는 조기거부 잔존을 막는 장치가 아니라 **아무 일도 하지 않는 술어**였다.

→ **rev2: `replay`·`client_result` 컬럼을 DDL 에서 삭제하고(§3-3), 술어를 `replay_gz is not null` 로 좁힌다.** 제출 리플레이는 **EF 요청 본문으로만 오고 gzip 만 저장된다** — 이 사실이 §3-5 뷰 제외 목록과도 정합한다(뺄 컬럼이 `replay_gz`·`loadout_sealed` 둘로 줄었다).

**조기 거부의 저장 비용은 rev2 에서 0 이다** — 게이트 0~6 에서 거부되면 `store_commission_replay_gz` 를 아예 호출하지 않으므로 DB 에 아무것도 안 남는다. 침공의 그 문제가 의뢰에는 **구조적으로 없다.**

### 6-3. cron ③ — 버려진 `active` 행: **회수하지 않고 종결한다**

계획은 이 자리를 비워 두었고, 사실 기반 §10-5 가 "cron ③이 필요하거나 ②의 대상을 넓혀야 한다"로 남겼다. **결정: cron ③을 신설하고, 의뢰서를 돌려주지 않는다.**

- **왜 돌려주지 않는가**: `active` 는 **런이 시작됐다는 뜻**이다. 돌려주면 "출격 → 지고 있음을 확인 → 프로세스 종료 → 24h 뒤 의뢰서 회수"가 성립한다. 이것은 rev6 이 닫으려 했던 바로 그 착취의 다른 입구다.
- **정합성**: `CONTEXT.md:209` 가 이미 "수락(출격)하는 순간 소모된다 — 실패하면 그 의뢰서는 사라진다"를 용어 정본으로 못 박았다. **회수하지 않는 것이 도메인 규칙이고, 회수하는 쪽이 예외였다.**
- **대가 — 자인**: EF 가 죽거나 클라가 24h 안에 재시도하지 못하면 **정직한 플레이어가 완주한 의뢰서를 잃는다.** `ACTIVE_TTL = 24시간` 은 이 손실을 줄이기 위한 값이고(제출 재시도 창), 그 이상 늘리면 "성공 리플레이 쟁여두기" 축이 열린다. **밸런스가 아니라 위험 교환이므로 이 계약이 값을 진다.**
- `②`가 `abandoned` 를 대상에 포함하므로 blob 은 48h 뒤 정리된다. **cron ③이 `verified_at` 을 세우는 것이 ②로 넘기는 배턴이다** — 안 세우면 `abandoned` 행의 blob 이 영구 잔존한다.

### 6-4. 시각 배치

- ①②③은 **매시 정각**(이 리포의 시간 단위 cron 규약, `20260726000100:121-123`). 같은 시각에 셋이 도는 것은 대상이 배타적(`issued` / 종결군 / `active`)이라 무해하다.
- ④는 `20 2 * * *` — 일간 GC 가 몰린 02:00 UTC 대에 두되 기존 `0 2`·`15 2`·`25 2` 와 겹치지 않는 분을 쓴다(사실 기반 §7).

### 6-5. 잠금 순서와 배타성 (rev2 m4)

M4 수정 후 두 경로의 잠금 순서가 **역순**이 된다:

| 경로 | 잠금 순서 |
|---|---|
| cron ① | `commission_runs`(update) → `commission_inventory`(insert) |
| `consume_commission`(§5-2) | `commission_inventory`(for update) → `commission_runs`(insert) |

**지금은 교착 사이클이 닫히지 않는다 — 대상 집합이 배타적이기 때문이다**: cron ① 은 `created_at < now() - 10분` 인 행만, `consume_commission` 은 방금 만든 `created_at = now()` 행만 만진다. 두 트랜잭션이 **같은 행 쌍을 반대 순서로 잡는 상황이 발생하지 않는다.**

⚠️ **이 배타성이 정합성의 근거이므로 계약에 명시한다.** cron ① 의 유예를 0 에 가깝게 줄이거나 `consume_commission` 이 과거 행을 만지도록 넓히면 **그 순간 교착이 가능해진다.** 술어를 넓힐 때는 잠금 순서를 먼저 통일해야 한다.

---

## 7. EF 게이트 순서 (`verify-commission`)

> 신규 EF 디렉터리 `supabase/functions/verify-commission/`(`index.ts` + `verifyCommissionCore.ts`).
> `verify-invasion` 과 같은 구조: 호출자 클라이언트(anon key + 원 JWT)로 신원 확인, `service` 클라이언트(service_role key)로 RPC(`supabase/functions/verify-invasion/index.ts:103-120`).
> **`verify-run/verifyCore.ts` 는 수정하지 않는다.** `runReplay` 는 `stepRun` 호출로 3줄만 바뀐다(계획 §Phase A).

**참조 좌표 정정** — 계획은 침공 override 를 `verifyInvasionCore.ts:411-414` 로 인용했으나 그것은 블록 후반이다. 실제:

| 침공 게이트 | 좌표 |
|---|---|
| `malformed-layout` | `:372` |
| `timeLimitTicks` 대조 → `defense-mismatch` | `:375-377` |
| `layersEqual` → `defense-mismatch` | `:381-383` |
| `inputs.length > timeLimitTicks` → `invasion-inputs-too-long` | `:386-388` |
| 권위 override 블록 | **`:397-415`** |
| `verifyRun(...)` ← CPU 시작 | **`:422`** |

### 7-1. 의뢰 게이트 순서 — **0~6 은 전부 `verifyRun` 이전이라 CPU 를 안 쓴다**

| # | 게이트 | 거부 코드 | CPU |
|---|---|---|---|
| **0a** | `commission_runs` 행 조회(service 클라이언트). 없음 | `commission-run-not-found` | 없음 |
| **0b** | `status in ('verified','rejected')` → **`verified_result` 를 그대로 반환**(HTTP 200, `note:'already-finalized'`) | — (거부 아님) | **없음 — 멱등 재호출의 값싼 경로** |
| **0c** | `status <> 'active'` 또는 `started_at is null` | `commission-run-not-active` | 없음 |
| **0c′** | `started_at <= now() - 24h` ← **rev2 (M3)** | `commission-run-expired` | 없음 |
| **0d** | 제출 `profile_id` ≠ 호출자 JWT `sub` | `commission-run-not-owner` | 없음 |
| **1** | `inputs.length > payload.replayBudgetTicks` | `commission-inputs-too-long` | 없음. **CPU 상한 게이트라 판정 게이트 중 가장 앞** |
| **2** | `config.catalysts` 가 비어 있지 않음 | `commission-catalyst-present` | 없음 |
| **3** | 제출 `config.loadout` ≠ `loadout_sealed` | `commission-loadout-mismatch` | 없음 |
| **4** | 제출 `config.loadout` 의 **의뢰 전용 유니크** 중 `commission_grants`(그 `profile_id`)에 발급 기록이 없는 것이 있음 | `commission-unauthorized-unique` | 없음(인덱스 조회 1회) |
| **5** | 제출 `config.commission` 이 서버 `payload` 와 불일치(무대·제약·보상) — **진단용 대조** | `commission-payload-mismatch` | 없음 |
| **6** | 제출 config 의 `commission` 블록을 서버 `payload` 로 **덮어쓴다** — 거부 없음 | — | 없음 |
| **6b** | **`bump_commission_verify_attempts(run_id)`(별도 트랜잭션) 반환 > `CAP_VERIFY_ATTEMPTS`(5)** ← **rev2 (M1)** | `commission-too-many-attempts` | 없음. **`verifyRun` 직전이자 그 앞 게이트 전부의 뒤** — 값싼 거부에는 시도를 소모시키지 않는다 |
| **7** | `verifyRun(authoritativeSubmission)` | `hash-stream-divergence` 등 기존 코드 | **여기서부터 CPU** |
| **8** | `settle_commission(run_id, verdict, …)` (§5-4) | — | 없음 |
| **9** | accept·reject 무관하게 `store_commission_replay_gz` 로 압축 보존 | — | gzip |

**⚠️ rev2 (M1) — 게이트 6b 의 자리가 왜 여기인가.** 0~6 은 CPU 를 안 쓰므로 그것들에 걸린 제출은 시도로 세지 않는다(정직한 클라의 형식 오류가 재시도권을 태우지 않는다). 반면 **7 은 완주하면 CPU 예산을 통째로 쓰므로 그 직전에서 센다.** rev1 에는 이 카운터가 없었고, `CAP_CONSUME_PER_HOUR`(12)는 런 **생성**만 묶었다 — `active` 인 동안 같은 `run_id` 로 몇 번이든 제출해 매번 `verifyRun` 이 완주했고, **응답 직전 연결을 끊으면 `settle_commission` 이 안 돌아 `active` 가 유지**되므로 무한 반복이 가능했다. 침공은 `verified_status='pending'` 게이트가 재실행을 1회로 수렴시키는데(`apply_invasion_result:298-304`) 의뢰는 그 수렴점이 settle 도달에만 있었다.

### 7-2. **대조가 덮어쓰기보다 앞선다** — 계획 순서의 결함

계획 §Phase C 는 **2번에서 서버 payload 로 덮고 5번에서 제약을 대조**한다. **덮어쓴 뒤의 대조는 항진이다** — 대조 대상이 방금 자기가 써 넣은 값이다. 순서를 5(대조) → 6(덮어쓰기)로 뒤집는다.

**단, 두 진실을 만들지 않기 위해 역할을 분리해 적는다:**

- **강제는 6(덮어쓰기)이 진다.** 서버 payload 로 재실행하면, 제출 입력이 다른 무대·다른 파워업 풀을 전제했을 때 **해시 스트림이 갈려 `hash-stream-divergence` 로 거부된다.** 이것이 실제 방어다.
- **5(대조)는 진단이다.** 위조 유형을 `hash-stream-divergence` 한 덩어리가 아니라 `commission-payload-mismatch` 로 갈라 관측한다. **없어도 방어는 유지된다.** 그렇게 기록한다 — 5 를 방어로 부르면 6 이 하는 일을 두 번 세는 것이다.

### 7-3. 게이트 4 의 판정 기준

- **"의뢰 전용 유니크 id 집합"이 새 단일 정본이 된다.** 클라·서버가 갈리면 정직한 플레이어가 오거부된다. **상수 모듈 1곳에서만 정의하고 EF 가 그것을 읽는다**(ADR-0045 §6 마지막 항).
- 대조는 **"지금 갖고 있는가"가 아니라 "받은 적이 있는가"** 다(ADR-0045 §2b). 잠긴 장비를 끌고 나가는 것은 클라 장착 규칙(ADR-0024)이 막는다 — **두 축을 섞으면 오거부가 난다.**
- 관측: `commission-unauthorized-unique` 발생 시 **발급 이력 유무를 함께 로그**해 위조와 오거부를 구분한다.

### 7-4. 응답 규약

`verify-invasion` 과 같은 고정 shape: `{ status, accepted, reason?, grants?, granted_credits?, granted_minerals?, credits_left?, minerals_left? }`. **거부는 HTTP 200 + `reason`** (침공 `json()` 헬퍼 `index.ts:49` 동형). `already-finalized` 도 200 + 확정값.

`SOFT_RERUN_BUDGET_MS` 는 침공과 같이 **관측 임계이지 중단 장치가 아니다**(`index.ts:47`). 의뢰는 다구간이라 침공보다 길 수 있으므로 **PC 실측 게이트**(계획)가 실값을 정한다.

---

## 8. 지급 경로 표 (현행 코드 기준 재작성)

| 지급물 | 일반 PvE (현행) | **의뢰 런 (이 계약)** | 소유/발급의 정본 |
|---|---|---|---|
| 자원(credits/minerals) | `settlePveRunCurrency`(`src/net/index.ts:168-206`) → `settle_pve_run`(`20260802000000:36`) → `grant_currency('pve_run')`(`:119`) | **EF → `settle_commission` → `grant_currency_for(행.profile_id, …, 'commission')`** — 확정 보상 + 재실행 `finalState` 자원 축을 **합산 1회** | 서버 원장 `profiles.credits/minerals`(ADR-0027) |
| 사연 챕터 보상 크레딧 | `settlePveRunCurrency` 안의 `grantCurrency(…, 'story')`(`src/net/index.ts:195-197`) | **클라가 `grantCurrency(storyRewardCredits, 0, 'story')` 를 별도 호출**(계획 D11). `settle_commission` 이 지지 않는다 | 서버 원장 |
| 일반 아이템(전리품) | `settleRun` 델타 → 클라 `items` 미러 | **동일** | 클라 rw 미러(`20260717000000:186-191`, `for all` 은 `:188`) |
| XP·레벨 | `settleRun` → 클라 `ships` 미러 | **동일** | 클라 rw 미러(`:143`) |
| 설계도 | `grant_blueprints` RPC(클라 호출, `20260722020000:40`) | **동일** — 단 **의뢰 전용 설계도**는 `commission_grants(kind='blueprint')` | 서버 테이블 · 클라 주장 |
| 촉매 | 드랍 → `grant_catalyst`(`20260801000000:125`) | **주입 불가**(`CONTEXT.md:235`). **드랍도 없다** — §8-1 | 서버 원장 |
| **의뢰 확정 유니크** | — | **`settle_commission` → `commission_grants` 삽입 + 클라 `items` 미러 사본** | **`commission_grants`(발급 정본, ADR-0045)** |
| 최고 클리어 단계 | `recordPlanetClear`(`src/save/settlement.ts:178`) | **갱신하지 않는다**(계획 A-8) | 클라 프로필 |
| 행성 인기 배율 | `settle_pve_run` 의 `v_mult`(`20260802000000:71-92`) | **미적용** — config 에 `planetMultCenti`/`planetMultEpoch` 를 스탬프하지 않는다(계획 D13) | — |

### 8-1. 계획이 "미확인"으로 남긴 세 축을 여기서 닫는다

계획 §A-8b 는 `grantBlueprintDrops`·`grantCatalystDrops`·`recordPveRunResult` 를 의뢰 런에서 태울지 미확인으로 남겼다. **결정:**

- **`grantCatalystDrops` — 태우지 않는다.** `CONTEXT.md:235` 가 "의뢰 런은 종이에 적힌 것만 나오는 순결한 런"이라 못 박았고, 촉매 드랍은 종이에 없다. 드랍이 나오면 "촉매를 못 쓰는데 촉매가 쌓이는" 비대칭이 생긴다.
- **`grantBlueprintDrops` — 태우지 않는다.** 확정 보상 안의 `blueprints` 는 `settle_commission` 이 지고(`kind='blueprint'` 또는 payload 명세), sim 드랍 설계도는 "적힌 것만"에 어긋난다.
- **`recordPveRunResult` — 태우지 않는다.** 의뢰 런은 `settle_pve_run` 을 부르지 않으므로 `pve_runs` 행이 없고, 그것이 §4-2 마지막 항의 "의뢰 런이 의뢰서를 낳지 않는다"를 구조로 만드는 근거다. **여기서 `pve_runs` 행을 만들면 그 구조가 무너진다.**
- ⚠️ 셋 다 **클라 호출부에서 의뢰 런 분기로 건너뛴다**(서버가 막는 것이 아니다). 클라가 그래도 부르면 일반 PvE 경로로 지급된다 — **자인**. 이 축을 서버가 막으려면 "이 런이 의뢰 런인가"를 서버가 알아야 하는데 그 정보는 `settle_pve_run` 에 없다. **대체 방어**: 세 호출을 의뢰 분기에서 제거했음을 검증하는 통합 테스트 1건(AC-P4)을 배정한다.

---

## 9. 상태 기계

```
                     [의뢰서 발령]
   pve_runs.verified_status → 'verified'
             │ (AFTER 트리거, §4-1)
             ▼
   commission_issues(PK=pve_run_id)  ── granted=false ──▶ (끝. skip_reason 기록)
             │ granted=true
             ▼
   commission_inventory  ◀─────────────────┐
             │ consume_commission (§5-2)   │ cron ① 회수(§6-1)
             │  · 행 삭제                   │  on conflict do nothing
             ▼                              │
   commission_runs.status = 'issued' ───────┘
             │                       └─ created_at + 10분 초과 ─▶ 'expired' (종결)
             │ mark_commission_active (§5-3, created_at+10분 이내에만)
             ▼
          'active'  ── started_at + 24h 초과 (cron ③) ─▶ 'abandoned' (종결, 의뢰서 소멸)
             │
             │ verify-commission EF (§7)  ─ 게이트 0c 가 'active' 만 통과시킨다
             │
             ├─ accept ─▶ settle_commission ─▶ 'verified'  (보상 지급 + commission_grants)
             └─ reject ─▶ settle_commission ─▶ 'rejected'  (보상 0)
                                                  │
                                    verified_at + 48h (cron ②)
                                                  ▼
                                        replay_gz = null (행 보존)
```

**전이 불변식 4개** — 테스트로 잠근다(AC-S1~S4):

1. `issued` 에서 나가는 길은 `active`(시한 내 전이)와 `expired`(cron ①) **둘뿐**이다.
2. `active` 에서 나가는 길은 `verified`·`rejected`(EF)와 `abandoned`(cron ③) **셋뿐**이다.
3. **종결 4상태**(`verified`·`rejected`·`expired`·`abandoned`)에서 나가는 길은 **없다**.
4. `commission_inventory` 로 행이 돌아오는 경로는 **cron ① 하나뿐**이다.

---

## 10. 수명·GC 검증 표

| 테이블/컬럼 | 언제 지워지는가 | 지울 때 무엇이 깨지는가 | 판정 |
|---|---|---|---|
| `pve_runs` (전체 행) | **cron `planet-blitz-gc-pve-runs`, 7일**(`20260726000200:384-388`) | rev7 이 여기에 앵커를 걸려 했다면 **8일 전 발령 기록이 소멸**한다 | **이 계약은 여기에 아무것도 걸지 않는다.** 앵커 id 만 복사해 `commission_issues` 에 둔다(FK 없음, §2-5) |
| `commission_issues` | **cron ④, 7일** | 빈도 상한 창(1h)이 168배 여유. 1회성 PK 도 함께 사라지지만 **앵커가 재제시될 경로가 없다**(§2-5) | 안전 |
| `commission_issues.next_eligible_at`(쿨다운 지평) | 위와 같이 7일 | ← **rev3 (선행1 b)**. 쿨다운 지평은 최대 `replayBudgetTicks / 60` 초(분 단위)라 **GC 대상이 되는 시점에는 이미 과거**다. `greatest(now(), 지평)` 이 그 경우를 `now()` 로 흡수한다 | 안전 — **GC 가 쿨다운을 푸는 경로가 원리적으로 없다** |
| `commission_inventory` | **소비 시 즉시 삭제**(`consume_commission` 4단계). TTL 없음 | 여기에 1회성을 걸면 소비와 함께 소멸(§2-1 ②) | **1회성을 걸지 않는다** |
| `commission_runs` (행) | **삭제하지 않는다.** cron ②는 컬럼만 비운다 | 지우면 `commission_grants.commission_run_id` FK(restrict)가 막는다 | 안전 — DB 가 규율을 강제 |
| `commission_runs.replay_gz` | **cron ②, verified_at + 48h** | 48h 뒤 감사 불가. `ACTIVE_TTL`(24h) 이 그보다 짧아 재시도 창과 겹치지 않는다 | 안전 |
| ~~`commission_runs.replay` / `client_result`~~ | — | **rev2 에서 컬럼 자체를 삭제했다**(§3-3 M5) — 클라 쓰기 경로가 없어 영원히 null 이었다 | 해소 |
| `commission_runs.verify_attempts` | 행과 함께 영속(리셋 없음) | 리셋하면 M1 상한이 무력해진다 | 의도 |
| `commission_runs.payload` / `loadout_sealed` | **지우지 않는다** | payload 는 EF 권위 원본, `loadout_sealed` 는 대조 기준 | 의도 |
| **`commission_grants`** | **지우지 않는다.** cron 대상 아님 | 지우면 **발급 사실이 사라져** 게이트 4 가 정직한 플레이어를 거부한다 | ADR-0045 §결과 |
| `currency_grants` | cron, 7일(`20260726000200:378-382`) | 누적 캡은 1h·24h 창만 보므로 무해 | 기존 |
| `profiles` | 계정 삭제 시. 위 4테이블 전부 `on delete cascade`(`commission_grants` 는 profile cascade + run restrict) | — | 안전 |

**교차 검증 — 시간 상수 정렬**: `GRACE(10분) < ACTIVE_TTL(24h) < BLOB_TTL(48h) < ISSUES_RETENTION(7일) = pve_runs TTL(7일)`. 이 부등식이 깨지면 위 표의 "안전" 판정 중 하나가 무너진다. **AC-G1 이 상수 모듈에서 이 부등식을 단언한다.**

---

## 11. Acceptance Criteria (서버 축)

> 계획 §Acceptance Criteria "서버 · 원장" 절을 **이 목록으로 대체**한다.
> **항진 금지**: rev6 의 AC "회수된 `run_id` 로 제출하면 거부된다"는 cron 지연 때문에 항진이었다. 각 AC 에 **검증법**을 붙이고, 검증법이 "무엇이 막았는지"를 갈라내지 못하면 그 AC 는 항진이다.
>
> **⚠️ rev2 — 검토자 총평: "rev1 의 AC 목록으로는 C1·C2·M1·M2·M4·M6 중 하나도 잡히지 않는다."** 이것이 이 개정의 가장 아픈 지적이다. rev1 은 AC 를 **49개** 썼는데 **길이가 완결성의 증거가 아니었다** — 새로 발견된 결함 6건 전부가 그 49개의 사각지대에 있었다(rev2 는 59개다). 그래서 rev2 는 **AC 를 먼저 고치고 각 항목에 뮤테이션(무엇을 되돌리면 이 AC 가 실패하는가)을 붙였다.** 뮤테이션이 없는 AC 는 "구현했다"만 재고 "구조가 그 결함을 막는다"를 재지 못한다.
>
> **rev2 변경분**: 교체 5건(AC-C2 · AC-C3 · AC-I5 · AC-R1 · AC-S4) · 신설 10건(AC-C9 · AC-C10 · AC-I8 · AC-I9 · AC-M5 · AC-M6 · AC-R7 · AC-S4b · AC-S9 · AC-E9).
>
> **⚠️ rev3 — 같은 실패가 R 계열에서 재발했다.** rev2 는 AC 를 고치면서 **그 AC 가 무엇을 *안* 보는지**를 세지 않았다. 그 결과 §3-5 컬럼 유출(선행2)이 **AC-R1·R2·R7 세 개가 전부 초록인 채로** 통과한다 — R1 은 rev2 가 판정 기준을 느슨하게 바꿔서, R2·R7 은 **뷰만 보고 기저를 안 봐서**. **AC 를 고칠 때는 "이 AC 가 통과하면서도 참일 수 있는 나쁜 상태"를 함께 적어라.**
> **rev3 변경분**: 교체 1건(AC-I9) · 보강 3건(AC-R1 · AC-R2 · AC-G2) · 신설 2건(AC-I10 · AC-R8). 총 61건.

### 발령 (I)

- [ ] **AC-I1** 촉매를 주입하지 **않은** 일반 PvE 승리 런에서 의뢰서가 발령된다.
  *검증법*: `settle_pve_run` 을 `runId` 없는 summary 로 호출 → `commission_inventory` +1. **rev7 의 pending 앵커였다면 실패한다** — pending `pve_runs` 행은 `consume_catalysts`(`20260727000000:315-320`)만 만든다.
- [ ] **AC-I2** 촉매 런(UPDATE 분기)에서도 발령된다.
  *검증법*: `consume_catalysts` → `settle_pve_run(runId 포함)` → `commission_inventory` +1. **양쪽 분기 커버가 이 계약의 핵심 주장이므로 두 AC 를 분리한다.**
- [ ] **AC-I3** 같은 `pve_runs.id` 로 두 번 발령되지 않는다.
  *검증법*: 트리거 함수를 직접 두 번 호출(`issue_commission_for_run` 을 postgres 로) → 두 번째는 `commission_issues` 충돌로 no-op. **뮤테이션**: `on conflict do nothing` 을 지우면 이 테스트가 **실패해야** 한다.
- [ ] **AC-I4** 재고에 여유가 있어도 시간당 발령 시도 상한(20)을 넘긴 신고는 미발령이고 `skip_reason='rate'` 가 기록된다.
  *검증법*: `created_at` 을 조작한 `commission_issues` 20행(**전부 `claimed_victory=true`**)을 심고 1회 더 정산. **재고를 비운 상태에서 재야 재고 캡과 갈린다.**
- [ ] **AC-I8** ← **rev2 신설 (M2 ①)**. **패배 정산은 빈도 슬롯을 소모하지 않는다.**
  *검증법*: `claimed_victory=false` 행 30개(상한 20 초과)를 심은 뒤 정상 승리 정산 1회 → **발령된다**. 이어서 같은 30개를 `claimed_victory=true` 로 바꿔 심고 반복 → **미발령(`skip_reason='rate'`)**.
  *뮤테이션*: count 술어에서 `and claimed_victory` 를 지우면 첫 절반이 실패해야 한다. **이 AC 가 없으면 "정직한 빠른 재시작 플레이어의 의뢰서가 끊기는" rev1 거동이 그대로 통과한다.**
- [ ] **AC-I9** ← **rev3 교체** (구 rev2: "`claimed_final_tick=36000` 심고 10초 뒤 미발령 → 601초 뒤 발령"). **쿨다운 우회가 닫혔다** — `finalTick=1` 및 `MIN_BOSS_KILL_TICKS - 1`(=3,599)로 승리를 각각 20회 주장하면 **발령 0** 이다.
  *왜 교체했나*: 구 AC 는 **기구가 동작하는가**만 재고 **우회가 닫혔는가**는 안 쟀다 — rev2 구현(공격자가 `finalTick` 을 고르는 쿨다운)에서도 **그대로 통과한다.** rev1 의 구 AC-I5 와 같은 부류의 항진이다.
  *뮤테이션*: **(a) `MIN_BOSS_KILL_TICKS` 하한을 지우면 20회 전부 발령돼 실패해야 한다.**
- [ ] **AC-I10** ← **rev3 신설 (선행1 b)**. **누적기 성질**: 어떤 창에서도 **발령된 런들이 주장한 시간의 합 ≤ 실제 경과 시간**이다.
  *검증법*: `finalTick = 36000`(600초)을 주장하는 승리 정산을 1초 간격으로 5회 → **1회만 발령**되고 나머지 4회는 `skip_reason='cooldown'`. 이어서 실시간 600초를 흘려야 2회째가 열린다.
  *뮤테이션*: `next_eligible_at` 전진을 `greatest(now(), 지평) + …` 에서 `now() + …` 로 되돌리면(= rev2 의 직전 행 기준과 동치) **긴 주장·짧은 주장을 번갈아 파이프라이닝**하는 케이스가 통과해 실패해야 한다.
- [ ] **AC-I5** ← **rev2 교체** (구: "세 경로에서 정상 반환"). 발령 경로에서 **임의의 예외가 터져도** `settle_pve_run` 이 커밋된다.
  *검증법*: `issue_commission_for_run` 안에 **강제 예외를 주입**(`raise exception 'boom'` · 또는 RNG 를 조작해 `grade=0` 으로 check 위반 유발)한 뒤 `settle_pve_run` 호출 → **정상 반환 + `profiles.credits` 증가 + `commission_inventory` 불변 + 서버 로그 warning**.
  *왜 교체했나*: 구 AC 의 세 경로(보관 상한·빈도·`victory` 누락)는 **원래 예외를 던지지 않는 정상 반환 경로**라 서브트랜잭션을 감싸지 않아도 통과한다 — **항진이었다.** 실제 위험은 §3-1·§3-2 의 check·not-null·FK 다섯 개이고(§4-1 C2), 그것들은 정상 경로가 아니라 **예외 경로**로 터진다.
  *뮤테이션*: `exception when others` 블록을 제거하면 실패해야 한다. **PR#222 와 같은 실패 형상**(`20260802000000:11-15`)을 재현하는 AC 다.
- [ ] **AC-I6** `issue_commission_for_run` 을 `authenticated`·`service_role` **어느 role 로도** 직접 호출할 수 없다.
  *검증법*: `set local role authenticated` + jwt claims 위조로 호출 → `permission denied`. `service_role` 로도 동일. `pg_proc`/`information_schema.role_routine_grants` 조회로 grant 0건 확인.
- [ ] **AC-I7** 의뢰 런 정산이 새 의뢰서를 발령하지 않는다.
  *검증법*: 의뢰 런 종료 후 `pve_runs` 행이 **생기지 않았음**을 단언한다(발령 미발생이 아니라 **원인의 부재**를 잰다 — 발령만 재면 다른 이유로도 통과한다).

### 재화 관문 (C)

- [ ] **AC-C1** 최종 지시 계급의 최대 확정 보상이 클램프 없이 전액 지급된다(`clamped === false`).
  *검증법*: `settle_commission` 반환의 `clamped`. **`case p_source` 에 `commission` 분기가 없으면 `CAP_DEFAULT_*`=1,000 으로 조용히 깎여 실패한다.**
- [ ] **AC-C2** ← **rev2 교체** (구: "`grant_currency(x, y, 'commission')` 이 거부된다"). `authenticated` 롤이 `grant_currency` 를 **허용 3종(`pve_run`·`salvage`·`story`) 외의 임의 문자열**로 호출하면 전부 예외로 거부된다.
  *검증법*: `set local role authenticated` + jwt claims 위조로 `'commission'` · `'x'` · `''` · `null` · `'PVE_RUN'`(대문자) · `' salvage'`(선행 공백) 6종을 시도해 **전부 예외**. **구 AC 는 `'commission'` 하나만 재서 C1 의 진짜 구멍(미등록 source → `CAP_DEFAULT_*` 1,000 창구)을 원리적으로 못 봤다** — blocklist AC 는 blocklist 만 검증한다.
  *뮤테이션*: `not in (...)` 을 `= 'commission'` 으로 되돌리면 `'x'` 케이스가 **통과해** 이 AC 가 실패해야 한다.
- [ ] **AC-C9** ← **rev2 신설**. 허용 3종은 **전부 정상 동작한다**(회귀).
  *검증법*: `'pve_run'`(`settle_pve_run` 경유, 촉매 `resourceMult` 관통 포함) · `'salvage'` · `'story'` 3경로가 각각 지급에 성공하고 `currency_grants` 에 기록된다. **allowlist 를 좁히다 정상 경로를 끊는 것이 이 변경의 유일한 회귀 위험이다.**
- [ ] **AC-C10** ← **rev2 신설**. 대기 재화 큐에 allowlist 밖 `source` 항목이 들어 있으면 **폐기되고 무한 재시도로 고이지 않는다**.
  *검증법*: localStorage 큐에 `{source:'x'}` 를 심고 `flushPendingGrants` 를 2회 돌려 큐 길이가 0 이 된다. **필터가 없으면 서버 예외 → `src/net/index.ts:591-592` 재큐잉 → 영구 잔존**이다(§5-1 회귀 절).
- [ ] **AC-C3** ← **rev2 보강 (m1)**. `authenticated` 롤이 `grant_currency_for(...)` 를 직접 호출하면 `permission denied` 다.
  *뮤테이션*: **`revoke execute on function public.grant_currency_for(...) from public;` 줄을 지우면 이 AC 가 실패해야 한다.** Postgres 는 함수 생성 시 **PUBLIC 에 EXECUTE 를 자동 부여**하므로, 그 한 줄이 빠지면 `authenticated` 가 PUBLIC 을 통해 도달해 **§5-1 위임 구조 전체가 무효**가 된다. rev1 은 이것을 본문 문장으로만 적었다.
- [ ] **AC-C4** 지급이 `currency_grants` 에 `source='commission'` 으로 **기록된다**.
  *검증법*: 지급 후 행 1건. **`apply_invasion_result` 를 복제했다면 이 AC 가 실패한다** — 그 선례는 원장을 우회한다(`20260726000000:425-428` 계열).
- [ ] **AC-C5** 1h 누적 캡이 의뢰 지급에도 걸린다.
  *검증법*: `currency_grants` 에 최근 1h 합 49,000 을 심고 30,000 을 지급 → 실지급 1,000. **이 AC 는 "캡이 문다"를 재는 것이지 "캡이 옳다"를 재지 않는다.**
- [ ] **AC-C6** 개연성 캡이 의뢰 지급에 **적용되지 않는다**.
  *검증법*: `finalTick`·`stage` 를 metrics 에 실어도(또는 실지 않아도) 지급액이 동일하다. 별도로, `finalTick=0` 인 지급이 클램프되지 않는다.
- [ ] **AC-C7** `settle_commission` 이 `app.in_settle` 을 세우지 않는다.
  *검증법*: 함수 본문 소스에서 `set_config('app.in_settle'` 문자열 0건 + 지급 중 `current_setting('app.in_settle', true)` 가 빈 값. **문자열 단언만으로는 부족하다** — 본문 주석이 파서를 오염시킬 수 있으므로 주석 제거본으로 단언한다(이 리포 전례).
- [ ] **AC-C8** `settle_commission` 이 `planet_popularity` 를 읽지 않는다(주석 제거본 문자열 0건).

### 상태 기계·회수 (S)

- [ ] **AC-S1** 유예(10분)를 초과한 뒤 `mark_commission_active` 를 호출하면 **명시 거부**된다(no-op 이 아니다).
  *검증법*: `created_at` 을 11분 전으로 조작 후 호출 → 예외. **cron ①을 unschedule 한 상태에서 잰다** — cron 이 돌면 행이 `expired` 라 무엇이 막았는지 갈리지 않는다.
- [ ] **AC-S2** **cron 이 아직 안 돌아 행이 `issued` 로 살아 있어도**, 유예를 초과한 그 `run_id` 로는 제출이 거부된다.
  *검증법*: cron ① unschedule → `created_at` 11분 전 → 승리 리플레이 제출 → `commission-run-not-active`. **rev6 의 항진 AC 를 대체하는 항목이며, cron 을 끄는 것이 이 AC 를 항진에서 구한다.**
- [ ] **AC-S3** `mark_commission_active` 를 받은 행은 유예가 지나도 cron ①에 회수되지 않는다.
  *검증법*: `active` 로 올린 뒤 `created_at` 을 1시간 전으로 조작 → cron ① SQL 수동 실행 → `commission_inventory` 불변.
- [ ] **AC-S4** cron ①이 회수한 의뢰서가 `commission_inventory` 에 **정확히 1장** 돌아오고 행이 `expired` 로 종결된다. cron ① SQL 을 **두 번 실행해도 2장이 되지 않는다**.
  *검증법*: 수동 2회 실행. *뮤테이션*: `on conflict do nothing` 제거 시 실패.
- [ ] **AC-S4b** ← **rev2 신설 (M4)**. **재고 복원과 상태 전이가 원자적이다** — 회수 후 재고에 1장이면 그 런은 반드시 `expired` 이고, 런이 `issued` 로 남아 있으면 재고에 없다.
  *검증법*: 회수 대상 50건에 cron ① 을 실행한 뒤 **`status='issued'` 이면서 재고에도 있는 행이 0건**임을 단언한다(교집합이 공집합).
  *뮤테이션*: 단일 CTE 를 rev1 형태(`insert … select` → `update`)로 되돌리고 두 문장 사이에서 `update` 를 0행으로 만들면 **1장이 2장**이 되어 실패해야 한다. **rev1 이 도달 불가였던 것은 상수의 우연 때문이었으므로, 이 AC 는 우연이 아니라 구조를 잰다.**
- [ ] **AC-S9** ← **rev2 신설 (M3)**. **cron ③ 을 unschedule 한 상태에서** `started_at` 이 25시간 전인 `active` 런의 제출이 `commission-run-expired` 로 거부된다.
  *검증법*: cron ③ 을 반드시 꺼야 한다 — 켜져 있으면 행이 `abandoned` 라 게이트 0c 가 막은 것과 갈리지 않는다(**rev6 항진 AC 와 같은 함정**).
  *뮤테이션*: `settle_commission` 4b 와 EF 게이트 0c′ 를 **둘 다** 제거해야 실패한다 — 하나만 지우면 통과하므로 뮤테이션은 두 지점 동시 제거여야 한다.
- [ ] **AC-S5** `started_at + 24h` 를 넘긴 `active` 행이 `abandoned` 로 종결되고 **의뢰서가 돌아오지 않는다**.
  *검증법*: cron ③ 수동 실행 → `status='abandoned'` and `verified_at is not null` and `commission_inventory` 불변. **`verified_at` 단언이 배턴 검사다** — 안 세우면 cron ②가 blob 을 영영 못 치운다.
- [ ] **AC-S6** 종결 4상태(`verified`·`rejected`·`expired`·`abandoned`)에서 `mark_commission_active` 와 `settle_commission` 이 모두 거부된다(8조합 전수).
- [ ] **AC-S7** `restore_commission` 이라는 이름의 함수가 존재하지 않는다(`pg_proc` 조회 0건).
- [ ] **AC-S8** `grant_commission` 이라는 이름의 함수가 존재하지 않는다(`pg_proc` 조회 0건) — 계획 명명분의 미노출.

### 멱등·재시도 (M)

- [ ] **AC-M1** 같은 `run_id` 로 `verify-commission` 을 두 번 호출하면 두 번째가 **저장된 판정을 CPU 없이** 돌려준다.
  *검증법*: 두 번째 호출의 응답 `note==='already-finalized'` **그리고** 응답 시간이 첫 호출의 1/5 미만. **시간까지 재야 "게이트 0b 가 verifyRun 앞에 있다"가 검증된다** — 값만 같으면 재실행 후 같은 값을 낸 것과 구분되지 않는다.
- [ ] **AC-M2** 두 번 호출해도 `commission_grants` 행 수와 `currency_grants` 행 수가 각각 1이다.
- [ ] **AC-M3** `settle_commission` 이 7단계(자원 지급)에서 예외를 만나면 6단계의 `commission_grants` 삽입도 **롤백된다**.
  *검증법*: `grant_currency_for` 를 일시적으로 예외를 던지게 교체 → 호출 → `commission_grants` 0행 and `commission_runs.status='active'` 유지. **ADR-0045 §결과가 전제한 "부분 실패"가 존재하지 않음을 증명하는 AC 다.**
- [ ] **AC-M4** 같은 종류(`kind='unique'`)를 2개 주는 payload 에서 `commission_grants` 가 **2행** 생기고, 재호출 시에도 2행이다.
  *검증법*: `slot_index` 0·1. **계획의 `unique (commission_run_id, kind)` 였다면 실패한다.**
- [ ] **AC-M5** ← **rev2 신설 (M1)**. 같은 `active` `run_id` 로 `verify-commission` 을 6번 호출하면 **6번째가 `commission-too-many-attempts`** 로 거부되고 `verifyRun` 이 돌지 않는다(응답 시간까지 함께 단언).
- [ ] **AC-M6** ← **rev2 신설 (M1 핵심)**. **`verifyRun` 도중에 EF 를 중단시켜도(settle 미도달) `verify_attempts` 가 증가해 있다.**
  *검증법*: 게이트 7 진입 후 강제 중단(타임아웃·연결 절단)을 5회 반복 → 6번째가 거부된다.
  *뮤테이션*: 카운터 증가를 `settle_commission` 본문 안으로 옮기면 이 AC 가 **실패해야 한다** — 롤백으로 카운터가 사라지기 때문이다. **M1 공격이 정확히 이 형태이므로, 이 AC 가 없으면 AC-M5 만으로는 방어가 검증되지 않는다.**

### RLS·권한 (R)

- [ ] **AC-R1** ← rev2 교체 / **rev3 보강**. `authenticated` 롤로 `commission_runs` 를 직접 select 하면 **본인 행만** 보이고 **타인 행은 0건**이다.
  *왜 rev2 가 교체했나*: 기저에 `commission_runs_select_own` 정책을 두므로(fail-closed, M6) "0행"은 더 이상 참이 아니다. 구 AC 를 두면 실패하는 항진 AC 가 된다.
  *⚠️ rev3 — 이 AC 가 통과하면서도 참일 수 있는 나쁜 상태*: **컬럼이 전부 열려 있어도 통과한다**(행 판정만 하므로). 실제로 rev2 구현이 그 상태였다. **컬럼 축은 AC-R8 이 진다 — 이 둘은 반드시 짝으로 존재해야 한다.**
- [ ] **AC-R7** ← **rev2 신설 (M6)**. **뷰가 fail-closed 다.**
  *검증법*: 뷰 정의에서 `where profile_id = auth.uid()` 를 **제거한 상태**로 두 계정 교차 조회 → **여전히 본인 행만** 보인다(기저 RLS 가 잡는다).
  *뮤테이션*: `security_invoker = true` 를 빼면 실패해야 한다 — 정의자 권한 뷰는 기저 RLS 를 우회하므로 즉시 전 계정 노출이 된다. **AC-R3 과 짝이다: R3 은 "경계가 있는가", R7 은 "경계가 무너지는 방향이 안전한가"를 잰다.**
- [ ] **AC-R2** `commission_runs_public` 뷰로는 **본인 행만** 보이고 `replay_gz`·`loadout_sealed` **컬럼이 존재하지 않는다**(← rev2 M5: `replay`·`client_result` 는 컬럼 자체가 사라졌다).
  *검증법*: `information_schema.columns` 전수 대조. **열거가 아니라 차집합으로 잰다** — 뷰에 컬럼이 추가돼도 걸리게.
  *⚠️ rev3 — 이 AC 가 통과하면서도 참일 수 있는 나쁜 상태*: **뷰만 보고 기저를 안 본다.** 기저에서 같은 컬럼이 전부 나가도 통과한다. AC-R8 이 그 축이다.
- [ ] **AC-R8** ← **rev3 신설 (선행2)**. `authenticated` 롤로 `select loadout_sealed from public.commission_runs` 를 시도하면 **`permission denied for column`** 이다(`replay_gz` 도 동일).
  *검증법*: **열거가 아니라 차집합으로** — `information_schema.column_privileges` 에서 `authenticated` 가 `commission_runs` 에 가진 컬럼 집합이 **`commission_runs_public` 뷰의 컬럼 집합과 정확히 같은지** 단언한다. 컬럼이 새로 생겨도 걸린다.
  *뮤테이션*: `revoke select on public.commission_runs from authenticated;` 줄을 지우면 실패해야 한다. **이 AC 가 없으면 §3-5·§3-6 의 존재 이유가 통째로 무효인 상태가 R 계열 3건 초록으로 통과한다.**
- [ ] **AC-R3** 뷰 본문에서 `where profile_id = auth.uid()` 를 제거하면 **타 계정 행이 보이는 테스트가 실패한다**(뮤테이션). *두 계정을 만들어 교차 조회한다.*
- [ ] **AC-R4** `commission_grants` 의 insert/update/delete 를 `authenticated` 롤로 시도하면 전부 거부된다(select-own 만).
- [ ] **AC-R5** `commission_issues` 를 `authenticated` 롤로 select 하면 0행이다(정책 0개).
- [ ] **AC-R6** `commission_grants` 가 어떤 cron 잡의 SQL 에도 등장하지 않는다(`cron.job` 전수 문자열 검사).

### EF 게이트 (E)

- [ ] **AC-E1** 게이트 0~6 각각이 **`verifyRun` 을 호출하지 않고** 거부한다.
  *검증법*: 각 거부 코드마다 응답 시간이 정상 accept 의 1/5 미만. **순서가 곧 비용이므로 시간으로 잰다.**
- [ ] **AC-E2** `items` 미러에 유니크를 직접 써 넣고 그것을 로드아웃에 실은 제출이 `commission-unauthorized-unique` 로 거부된다.
  *검증법*: `commission_grants` 행 **없이** `items` 만 조작. **미러만으로는 통과하지 못해야 한다.**
- [ ] **AC-E3** 정상 발급된 유니크를 실은 제출은 통과한다(오거부 0).
- [ ] **AC-E4** 발급받은 뒤 `items` 에서 **지운** 유니크를 실어도 통과한다.
  *근거*: 대조는 "받은 적이 있는가"이지 "지금 갖고 있는가"가 아니다(ADR-0045 §2b). **이 AC 가 없으면 구현자가 미러 대조를 섞어 넣어 정직한 플레이어를 오거부한다.**
- [ ] **AC-E5** 촉매가 실린 config 는 재실행 전에 `commission-catalyst-present` 로 거부된다.
- [ ] **AC-E6** 출격 후 편집된 로드아웃은 `commission-loadout-mismatch` 로 거부된다.
- [ ] **AC-E7** 서버 payload 와 다른 무대를 전제한 입력은 **게이트 6 덮어쓰기 후 `hash-stream-divergence`** 로 거부된다.
  *검증법*: 게이트 5(대조)를 **일시 제거한 상태**에서 잰다 — 5 가 켜져 있으면 무엇이 막았는지 갈리지 않는다. **이 AC 가 "강제는 6 이 진다"(§7-2)를 증명한다.**
- [ ] **AC-E8** 타인의 `run_id` 로 제출하면 `commission-run-not-owner` 다.
- [ ] **AC-E9** ← **rev2 신설 (M1)**. 게이트 0~6 에서 거부된 제출은 `verify_attempts` 를 **증가시키지 않는다**.
  *검증법*: 촉매 실린 config 로 10회 거부 후 `verify_attempts = 0`. **정직한 클라의 형식 오류가 재시도권을 태우지 않는다**는 §7-1 6b 배치 근거를 잰다.

### 정합 게이트 (G·P)

- [ ] **AC-G1** 상수 모듈이 `GRACE < ACTIVE_TTL < BLOB_TTL < ISSUES_RETENTION` 부등식을 단언한다(§10).
- [ ] **AC-G2** SQL 캡 상수와 TS 상수 모듈의 `CAP_COMMISSION_*` 값이 일치한다(미러 동기화 테스트 — `20260727000000:43-46` 선례 형식).
  *← rev3 확장 (⑪)*: **집합 일치**도 함께 단언한다 — ⓐ `grant_currency` allowlist 리터럴 집합 ⓑ `grant_currency_for` 의 `case p_source` 분기 라벨 집합 − `{commission}` ⓒ TS 상수의 source 집합, **셋이 같아야 한다.** *뮤테이션*: `case` 에 분기만 추가하고 allowlist 를 빠뜨리면 실패해야 한다.
- [ ] **AC-G3** 신규 마이그레이션 파일명 타임스탬프가 `20260802000000` 보다 크다(`tests/pveRunsColumnContract.test.ts` 형식의 정렬 계약 테스트).
- [ ] **AC-P1** 의뢰 런이 `settlePveRunCurrency` 를 호출하지 않는다.
- [ ] **AC-P2** 의뢰 런의 자원 축이 `settle_commission` 을 통해 확정 보상과 **합산 1회**로 지급된다.
- [ ] **AC-P3** `storyRewardCredits > 0` 인 의뢰 런에서 `grantCurrency(…, 'story')` 가 호출되고 크레딧이 실제로 늘어난다.
  *검증법*: 별도 호출이 없으면 `settleRun` 이 claim 만 소모하고(`src/save/settlement.ts:264-265`) 크레딧이 증발한다 — **claim 원장과 잔액을 함께 단언한다.**
- [ ] **AC-P4** 의뢰 런에서 `grantBlueprintDrops`·`grantCatalystDrops`·`recordPveRunResult` 가 **호출되지 않는다**(§8-1).
- [ ] **AC-P5** 의뢰 런 config 에 `planetMultCenti`·`planetMultEpoch` 가 둘 다 부재한다.

---

## 12. 이 계약이 증명하지 못하는 것 (자인)

**Principle 2**: 구조로 못 막으면 이탈을 자인하고 **대체 방어를 조달한다.** 자인만 하고 방어를 배정하지 않으면 정직이 아니라 미조달이다. 아래 각 항에 대체 방어를 붙였다.

| # | 닫히지 않는 것 | 왜 | 배정한 대체 방어 |
|---|---|---|---|
| 1 | **발령 자격("보스를 잡았다")이 클라 주장이다** | 일반 PvE 는 리플레이를 내지 않는다(ADR-0026). `settle_pve_run` 이 받는 것은 클라가 만든 jsonb 통짜(`20260802000000:36`) | **빈도 상한 20/h**(§2-4) + 재고 상한. **이것이 유일한 실질 방어임을 §2-3 이 명시한다** |
| 2 | **`settle_pve_run` 을 클라가 무제한 호출할 수 있다** | `authenticated` 에 grant(`:156`) + 비-멱등 INSERT(`:138-147`) | 동상(1과 같은 방어가 진다). **경로 봉인은 이 축을 막지 않는다** |
| 3 | **출격 전 클라 미러 위조** | `loadout_sealed` 자체가 클라 미러에서 온 값이다. ADR-0028 이 "클라 rw 미러 대조는 무효"로 배제한 미봉책의 시점 한정판 | **방어력을 주장하지 않는다.** 채택 근거는 ⓐ비용 0 ⓑ오거부 0 ⓒ밸런스 상수 미도입 ⓓ전면 원장이 생기면 **대조 대상만 갈아끼우는 자리**를 미리 만든다 — 넷뿐 |
| 4 | **의뢰 유니크를 일반 PvE·침공에 끌고 나가는 것** | 두 경로 모두 이 대조 지점을 지나지 않는다(일반 PvE 는 EF 자체가 없고, 침공 EF 는 대조를 붙이지 않는다 — ADR-0045 §5) | **없음. 전면 원장(ADR-0028) 소관으로 남긴다.** 이 계약이 닫는 것은 **의뢰 런 안에서의 사용 한 줄기**뿐이다 |
| 5 | **일반 아이템·기체 보유 위조** | `items`/`ships` 는 `for all` 클라 rw 미러(`20260717000000:188`, `:143`) | **아무것도 지키지 않는다.** ADR-0028 연기 그대로 |
| 6 | **의뢰 런에서 `grantBlueprintDrops` 등을 클라가 그래도 부르는 것** | 서버는 "이 런이 의뢰 런인가"를 모른다(§8-1) | 통합 테스트 AC-P4(클라 분기 검증). **서버 강제는 없다 — 자인** |
| 7 | **`mark_commission_active` 실패 호출의 무제한 반복** | 상태를 안 바꾸므로 카운터를 걸 자리가 없다(§5-3) | 플랫폼 레이트리밋에 맡긴다. **정합성 축이 아니라 부하 축**이라 별도 조달을 하지 않는다 |
| 8 | **정직한 플레이어의 보상 소멸** | `ACTIVE_TTL` 24h 초과 재접속 · EF 영구 장애 | **없음(의도된 손실).** 무제한 보관은 "성공 리플레이 쟁여두기" 축을 연다 |
| 9 | **최대 등급 의뢰의 시간당 수령 횟수 제한** | `CAP_HOURLY_CREDITS` 50,000 vs `CAP_COMMISSION_CREDITS` 30,000 | 밸런스 축. §13-② |
| 10 | ~~**트리거가 정산 트랜잭션을 롤백시킬 위험** — 테스트가 유일한 방어~~ | — | **⚠️ rev2 해소 (C2)**: 서브트랜잭션(`exception when others`)으로 **구조 방어를 조달했다**(§4-1). rev1 의 "테스트가 유일한 방어"는 Principle 2 기준 **미조달**이었고, 게다가 그 테스트(구 AC-I5)마저 항진이었다. 잔여 자인은 아래 12 |
| 12 | **발령 실패가 플레이어에게 보이지 않는다** | 서브트랜잭션이 예외를 `raise warning` 으로 삼킨다(§4-1) | 서버 로그 warning 발생률 관측. **실패는 "의뢰서 미발령"으로만 나타나고 지급 쪽으로 새지 않는다**(fail-closed) |
| 13 | **`verify_attempts` 5회를 소진한 정직한 플레이어의 보상 소멸** | 네트워크 재시도도 카운트된다(§5-7) | 실값 5 는 여유값. §13-⑨ 관측 대상. 8 과 같은 성격의 의도된 손실 |
| 14 | **빈도 상한·쿨다운의 입력이 전부 클라 주장이다** | `victory`·`finalTick` 모두 `p_summary` 에서 온다(§4-4) | ← **rev3 재작성.** rev2 는 "처리량을 주장에 비례해 깎는다"고 적었는데 **비례 계수를 공격자가 골랐다.** rev3 의 (a)+(b)가 하는 일은 **위조 차단이 아니라 처리량 상한을 공격자가 고를 수 없게 만드는 것**이고, 상한은 `20/h` 와 `실시간 / MIN_BOSS_KILL_TICKS` 중 작은 쪽으로 **서버가 고정**한다 |
| 15 | **`MIN_BOSS_KILL_TICKS` 가 실측 없이 3,600 이다** | sim 실측을 안 했다(§13-⑫) | 너무 크면 **정직한 속공 런이 오거부**된다(발령 자체가 안 된다) — **이 축에서 유일하게 정직한 사용자를 벌할 수 있는 상수다.** 착수 전 실측이 필수다 |
| 11 | ~~**뷰 본문의 `where` 절이 유일한 행 경계**~~ | — | **⚠️ rev2 해소 (M6)**: 기저 `commission_runs_select_own` + `security_invoker = true` 로 **fail-closed** 전환(§3-5). `where` 가 지워져도 결과는 유출이 아니라 무변화다. AC-R3(경계 존재) + AC-R7(실패 방향) 짝으로 잰다 |

**침공 축과의 비대칭을 남긴다**: `apply_invasion_result` 는 `currency_grants` 를 우회해 재화를 지급하므로(**1h/24h 누적 캡 밖**) 이 계약이 의뢰 축에 강제하는 폭주 방어가 침공 축에는 없다. **이 계약은 그것을 고치지 않는다**(범위 밖, ADR-0027/0028 소관). 그러나 **"선례가 그러니 복제한다"는 논증을 명시적으로 기각**한다 — §5-1 (다) 기각 사유.

---

## 13. 미확인 목록

착수 전 코드/원격 대조가 필요한데 이 작업에서 닫지 못한 것.

- **①** **의뢰서 보관 상한 실값.** `CONTEXT.md:227` 이 "보관 상한이 있어 꽉 차면 새 의뢰서가 들어오지 않는다"를 정본으로 못 박았으나 숫자가 없다. `.omc/specs/deep-interview-commission-system.md` 도 미확인. **PE(수신소 UI)와 함께 확정하고, 그 전까지 §4-2 4단계는 상수 모듈의 placeholder 를 읽는다.**
- **②** **`.omc/plans/balance-queue.md` 가 존재하지 않는다.** 임무 지시는 "§C(착수 조건으로 승격된 항목)"을 읽으라 했으나 **파일 자체가 없다**(`find . -name "balance-queue*"` 0건, `.omc/plans/` 목록에도 없음). 계획 §Phase 0 산출물 2 가 "P0 착수 시 만든다"로 남긴 그대로다. **따라서 이 계약은 어떤 항목도 그 파일에 위임하지 않고, 방어에 걸리는 상수(빈도 상한·유예·TTL)의 실값을 전부 §2-4·§5-2·§5-3·§6 에서 직접 진다.** 순수 밸런스 축(`CAP_COMMISSION_*` 실값 튜닝 · 계급별 발령 확률 · 유니크 중복률 · 시간당 수령 횟수)만 그 파일이 생기면 이관한다.
- **③** **`CommissionPayload` 의 `rewards` 하위 형태**(계획 §Phase B0). 이 계약의 §3-4 `slot_index` 와 §5-4 6단계는 "`rewards` 안에서 kind 별 순번이 결정적"을 전제한다. **PB0 이 그 순서를 배열로 고정해야 성립한다** — 객체 키 순서에 의존하면 깨진다.
- **④** **EF CPU 예산 실값.** 다구간 의뢰 런의 `verifyRun` ms. 계획 §PC 실측 게이트가 낸다. `SOFT_RERUN_BUDGET_MS`(침공 20,000, `verify-invasion/index.ts:47`)를 그대로 쓸지 미정.
- **⑤** **무료 티어 EF 호출 수·DB 용량 여유.** 실패 런도 제출하므로 건수가 늘어난다(계획 §Phase C). 재지 않았다.
- **⑥** **원격 스키마 실상태.** 이 계약은 리포 마이그레이션 기준이다. `20260802000000` 이 원격에 적용됐는지는 이 작업에서 확인하지 않았다(적용 전이면 PvE 정산이 여전히 100% 실패 중이고, 트리거 앵커가 발화할 대상 자체가 없다). **착수 전 필수 대조.**
- **⑦** **사연 챕터 claim 원장이 서버에 없다.** `grant_currency('story')` 는 "이 챕터를 이미 청구했는가"를 알 수 없고 claim 은 로컬 `profile.storyRewardsClaimed` 에만 있다(`src/save/settlement.ts:255-265`). **이 레인 범위 밖이지만 AC-P3 가 그 위에 서 있다** — 재시도 시 story 크레딧 이중 지급 가능성이 남는다(현행 일반 PvE 도 동일).
- **⑨** ← rev2 / **rev3 판정 가능으로 승격**. **`CAP_VERIFY_ATTEMPTS = 5` 가 정직한 재시도에 충분한가.** 미측정은 그대로지만 **상한 쪽은 이제 산술로 닫혔다**: 계정당 최대 `CAP_CONSUME_PER_HOUR(12) × CAP_VERIFY_ATTEMPTS(5) = 60 verifyRun/h`. 침공 `SOFT_RERUN_BUDGET_MS = 20,000`(`supabase/functions/verify-invasion/index.ts:47`)을 준용하면 **계정당 최대 20 CPU-분/시간**이다. 남은 미확인은 **하한**(정직한 재시도에 5회가 부족한가)뿐이며, 출시 후 `commission-too-many-attempts` 발생률로 조정한다.
- **⑫** ← **rev3 신설 (선행1 a)**. **`MIN_BOSS_KILL_TICKS` 실값을 sim 실측으로 정해야 한다.** 3,600(60초)은 placeholder 다. **행성·계급·기체별 최속 보스 처치 틱의 하위 분위수**를 재고 그보다 충분히 낮게 잡아야 한다 — 너무 크면 정직한 속공 런이 **발령 자체를 못 받는다**(§12-⑮, 이 축에서 유일하게 정직한 사용자를 벌할 수 있는 상수). Phase 0 벤치와 함께 낸다.
- **⑩** ← rev2 / **rev3 에서 LOW 로 재분류. 배포 결합을 해제한다.** rev2 는 "서버만 먼저 배포하면 큐가 막힌다"는 **배포 순서 제약**으로 올렸으나, 재검토가 코드로 확인했다: `PendingGrant` 큐에 들어가는 source 는 **`'salvage'` 하나뿐**이고(`grantCurrencyToServer` 실패 경로, 유일 호출부 `src/ui/pixi/hangar.ts:445`) `'story'` 는 **다른 큐**(`flushPendingSettlements`)를 쓴다 — **둘 다 allowlist 3종 안에 있다.** 즉 **정상 데이터는 예외를 안 맞는다.** 걸리는 것은 손수 편집한 localStorage 뿐이고 그 경우에도 데이터 손실 없음·다른 항목 미차단·비용은 실패 RPC 1회다. **AC-C10 은 위생으로 유지하되 릴리스 결합을 계약에 박지 않는다.**
- **⑪** ← rev2 / **rev3 완화**. **`grant_currency` allowlist 가 미래 source 를 막는다.** 새 지급원을 추가하려면 SQL·TS 양쪽을 함께 고쳐야 한다(의도된 마찰). **rev3 조치**: AC-G2 를 확장해 **allowlist 리터럴 집합과 `grant_currency_for` 의 `case p_source` 분기 라벨 집합이 같은 TS 상수에서 나오는지**를 단언한다 — **값 일치가 아니라 집합 일치**다. 그러면 "분기는 추가했는데 allowlist 를 빠뜨림"이 잡힌다. 잔여 미확인은 "TS 상수 자체를 안 고치는 경우"뿐이고 그것은 기능 테스트가 잡는다.
- **⑧** **`stashPendingSettlement` 에 멱등 키·dedup 이 없다**(`src/net/profileSync.ts:243-247`, localStorage 누적 배열). 의뢰 런의 재제출 큐를 같은 저장소에 얹으면 같은 런이 두 번 stash 될 수 있다. `settle_commission` 의 원자성이 서버 측 이중 지급은 막지만(§5-4), **클라 큐 설계는 PC 에서 확정해야 한다.**

---

## 14. 후속 문서 개정 요청

이 계약이 확정되면 아래를 함께 고쳐야 정합이 유지된다.

1. **ADR-0045 §결과 첫 항** — "부분 실패가 나면 서버 측 재시도가…"는 단일 트랜잭션 전제에서 거짓이다(§5-4). **재시도 주체를 클라이언트로 정정**하고 삽입 순서의 근거를 "서술 순서"로 바꾼다.
2. **ADR-0045 §1 테이블** — `slot_index` 컬럼과 `unique (commission_run_id, kind, slot_index)` 를 반영한다(§3-4).
3. **ADR-0044** — EF 게이트 순서에서 **대조가 덮어쓰기보다 앞선다**는 것과, 강제는 덮어쓰기가 지고 대조는 진단이라는 역할 분리를 명시한다(§7-2).
4. ← **rev3 신설**. **§4-3(rev2 M2) 은 폐기 표기만 남았고 정본은 §4-4 다.** 구현자는 §4-3 의 2번 항목을 **읽고 따르면 안 된다** — 그 자리에 rev3 폐기 표시를 달아 두었으나, 문서를 발췌해 옮길 때 잘려 나갈 수 있는 형태다. **§4-3·§4-4 는 항상 함께 인용한다.**
5. **계획 `.omc/plans/commission-system-consensus.md`** — §Phase B·C 를 이 문서 참조로 대체하고, §Acceptance Criteria "서버 · 원장" 절을 §11 로 교체한다. D9·D10·D13 은 **이 계약이 대체했음**을 결정 로그에 남긴다.
6. **ADR-0027(재화 서버 원장 권위)** ← **rev2 신설**. `grant_currency` 를 **allowlist(default-deny)** 로 전환한 것은 그 ADR 이 정의한 재화 관문의 **계약 변경**이다. 미등록 source 가 `CAP_DEFAULT_*`(1,000)로 통과하던 거동이 사라지고, 허용 집합이 `('pve_run','salvage','story','commission')`(마지막은 `grant_currency_for` 전용)로 **명시 열거**된다. **§C1 의 사실(시간당 50,000 무상 지급 경로)도 그 ADR 의 "결과"에 기록해야 한다** — 이 계약 문서에만 두면 재화 축 문서를 읽는 사람이 못 본다.
7. **`CONTEXT.md`** — 새 용어를 만들지 않았으므로 **갱신 불요**. `commission_issues`·`commission_runs`·`commission_grants` 는 전부 기존 용어(**발령** · **의뢰 런** · **의뢰 확정 지급물**)의 구현 이름이다.
