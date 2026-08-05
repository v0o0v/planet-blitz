<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# supabase — 백엔드

## 목적

원격 Supabase(프로젝트 ref `qxgbxwyccbxokdgwxcuw`)의 **스키마·RLS·서버 로직**. 설계 원칙은
**서버 권위**다 — 래더 순위, 침공 결과, 재화, 의뢰 확정 지급물은 클라이언트가 쓸 수 없고
service_role(Edge Function)만 갱신한다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `README.md` | **백엔드 정본** — 테이블·RLS 정책·트리거·마이그레이션 목록과 각 적용 실측 |
| `DEPLOYMENTS.md` | **무엇이 올라가 있는지의 정본** — 함수별 버전·번들 해시와 재배포 필요를 **바이트로 판정하는 법** |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `functions/` | Edge Function 5종 (`functions/AGENTS.md`) |
| `migrations/` | 마이그레이션 SQL 51개(2026-07-17 ~ 2026-08-05). 파일명 = 타임스탬프 + 주제 |
| `tests/` | 원격 적용 후 실측 검증 SQL(`phase_*_verification.sql` 등) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **마이그레이션은 append-only.** 이미 적용된 파일을 고치지 않고 새 파일을 쌓는다.
- 적용은 `scripts/apply-*-migration.ps1` 로 하고, 적용 후 `supabase/tests/*.sql` 로 실측 확인 +
  `supabase/README.md` 표를 갱신한다.
- **RLS 를 새로 열 때는 "왜 이 행을 남이 봐도 되는가"를 적는다.** 정찰 전면 공개(`using (true)`)는
  임시 상태로 남아 있는 항목이다.
- 재화 지급은 `grant_currency_for` 의 source 화이트리스트를 거친다 — **미등록 source 는 1000 으로
  조용히 절삭**된다. 새 지급처를 만들면 여기 등록을 잊지 않는다.
- 원격 작업 전에 **어느 프로젝트를 가리키는지 확인**한다(MCP 는 project scope 고정). 의도와 다르면
  멈추고 사용자에게 알린다 — 특히 apply·deploy 같은 쓰기 전에.

### 테스트 요구사항

- SQL 검증은 `supabase/tests/*.sql`(원격에서 실행).
- **서버 가드는 적용 스크립트로 실증되지 않는다** — `scripts/prove-*.ps1` 로 실제 위조를 시도해
  거부를 확인한다.
- 로컬 계약 미러는 `src/run/commissionServerConstants.ts` 같은 TS 정본이 갖고 있다. SQL 과
  **같은 값을 두 곳에 적는 자리**이므로 함께 움직인다.

### 공통 패턴

- security definer 함수 + `search_path = ''` 고정(함수 하이재킹 방지).
- 클라이언트 write 를 막는 가드 트리거(`trg_*_guard`)가 컬럼 단위로 이전 값을 강제한다.

## 의존성

### 내부

`src/sim/**`·`src/run/commission*`(Edge Function 이 번들) · `src/net/**`(호출자)

### 외부

Supabase(Postgres · Auth · Edge Runtime/Deno · pg_cron)

<!-- MANUAL: -->
