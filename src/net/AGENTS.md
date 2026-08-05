<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# net — 서버 게이트웨이

## 목적

Supabase 와 통신하는 계층. 설계의 핵심은 **게이트웨이 인터페이스와 실 구현의 분리**다 —
`*Gateway.ts` 가 실 Supabase 호출을 갖고, 나머지 모듈은 인터페이스만 보고 동작한다. 덕분에
오케스트레이션 로직을 fake gateway 로 네트워크 없이 vitest 검증할 수 있고, SDK 는 지연 로딩되어
**미설정 번들에는 실리지 않는다**.

**재화·래더·검증은 서버 권위**다(ADR-0027·0026·0045). 클라이언트가 쓰는 것은 표시 미러다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `index.ts` | (1179줄) 네트워크 계층 공개 API — 오케스트레이션 |
| `config.ts` | `readSupabaseConfig()` — 환경변수 둘 중 하나라도 없으면 **네트워크 계층이 통째로 no-op**(오프라인 데모) |
| `supabaseClient.ts` | SDK **단일 인스턴스**. 실 SDK 를 정적 import 하는 유일한 파일 |
| `auth.ts` | 구글 로그인 — 세션 조회·로그인·로그아웃. **익명 폴백은 걷어냈다**(로그인 게이트를 우회시킨다) |
| `accountScope.ts` | 계정 스코프 가드 — 로그인 uid 가 바뀌면 로컬 상태를 통째로 버린다 |
| `gateway.ts` | 프로필 게이트웨이 계약 + 재화 RPC 3종(`settle_pve_run`·`grant_currency`·`spend_currency`) |
| `profileSync.ts` · `pveRun.ts` | 세이브 이관·동기화 순수 로직 / PvE 런 기록 순수 로직 |
| `invasion.ts` · `invasionGateway.ts` | 침공 제출·매치메이킹 |
| `defenseSync.ts` · `defenseGateway.ts` · `defenseUnits.ts` · `defenseUnitsGateway.ts` | 방어 배치 업로드 / 방어체 인벤·강화 |
| `commissionGateway.ts` | 의뢰서 — **의뢰서 보유분과 확정 지급물의 정본은 서버 원장**이다 |
| `dailyReward.ts` | 일일 보상 수령 + 배송함 반영(ADR-0048) |
| `guardianGateway.ts` · `lineage.ts` · `lineageMirror.ts` | 수호 기체·계보 서버 권위 배선 및 로컬 미러 반영 |
| `modules.ts` · `modulesGateway.ts` · `blueprints.ts` | 코어 모듈 경제 / 설계도 지급 |
| `planetMultipliers.ts` | 행성 인기 배율 캐시 + 30분 폴링(ADR-0038) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **"RPC 가 있다 ≠ 배선됐다."** 서버 함수를 추가했으면 클라 호출·표시·실패 경로까지 확인한다.
- **계약은 값이 아니라 순서다** — 서버 확정 전에는 로컬 상태가 불변이어야 한다. 스냅샷 비교로 잠근다.
- `grant_currency_for` 에 **등록되지 않은 source 는 1000 으로 조용히 절삭**된다. 새 지급처를
  만들면 SQL 쪽 등록을 함께 한다. 절삭을 표시 필드에만 걸면 실지급이 안 깎인다.
- 오프라인·미로그인은 **기능 잠금**이다(의뢰·촉매 등). 하네스 모의 게이트웨이(`src/harness/*Mock.ts`)가
  그 상태를 대신하는데, **모의가 서버와 갈리면 그 자체가 결함**이다 — 실화면이 잡은 이력이 있다.
- 하네스가 로그인하면 **서버 데이터를 진짜로 바꾼다**(`pushProfileToServer` 에 가드가 없다).
  전용 테스트 계정으로만 로그인한다.

### 테스트 요구사항

`tests/*Net.test.ts` · `tests/*Gateway*.test.ts` · `tests/authGate.test.ts` ·
`tests/accountScope.test.ts`. 전부 fake gateway 로 돈다 — 실서버를 때리지 않는다.
서버측 가드는 **적용 스크립트로 실증할 수 없다**(`scripts/prove-*.ps1` 가 별도로 있다).

### 공통 패턴

- `Gateway` 인터페이스 → fake/real 두 구현. 순수 로직(`*Sync.ts`)은 게이트웨이를 주입받는다.
- 실패는 던지지 말고 **오프라인과 같은 강등 경로**로 흘린다.

## 의존성

### 내부

`src/save/**` · `src/items/**` · `src/run/**` · `supabase/**`(계약 상대)

### 외부

`@supabase/supabase-js`(지연 로딩)

<!-- MANUAL: -->
