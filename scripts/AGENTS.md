<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# scripts — 도구 스크립트

## 목적

빌드 그래프 **밖**에서 도는 도구들 — 자산 준비, 밸런스 스윕 실행, Deno 크로스검증, 원격
마이그레이션 적용, 서버 가드 실증. Node(`.mjs`/`.ts`)와 PowerShell(`.ps1`)이 섞여 있고
타입은 `tsconfig.scripts.json` 이 따로 본다.

## 주요 파일

### 자산 준비 (의존성 0 — `scripts/lib/png.mjs` 자체 PNG 코덱만 쓴다)

| 파일 | 설명 |
|---|---|
| `asset-prep.mjs` | 스프라이트·시트 준비 |
| `title-art-prep.mjs` | 타이틀 키아트 레이어 분해 |
| `tileset-gen.mjs` | 타일셋 생성(프로필은 `tileset-profiles/`) |
| `glb-prep.mjs` | GLB 모델 준비 |
| `lib/png.mjs` | 의존성 0 PNG 코덱(Node 내장 zlib 만 사용) |

### 밸런스

| 파일 | 설명 |
|---|---|
| `balance/run.mjs` | `pnpm balance` 진입점 — 예산제 스윕 |
| `balance/worker.mjs` | 워커(job = 셀 1칸 × 시드 1개). `worker_threads` |
| `balance/probe-stage.mjs` | 좁은 프로브(전 행성 런보다 싸고 정밀) |
| `balance/compare.mjs` | 두 리포트 비교 |

### 검증

| 파일 | 설명 |
|---|---|
| `deno-verify/verify.ts` · `verifyRun.ts` · `verifyInvasion.ts` | **Node ↔ Deno 결정론 parity** 와 위조·조작 거부 러너 |
| `deno-verify/scenarios.ts` · `fixtures.json` | 크로스 검증 시나리오(12개) |
| `env-verify/shot-server.mjs` · `page-capture.js` · `analyze.mjs` · `assetColor.mjs` | 배경 실측 — 스크린샷 → **자산 픽셀에서 색을 뽑는 유일한 자리** → 분석 |
| `recordEncounterBaseline.ts` · `recordStrikerBaseline.ts` | 골든 fixture 갱신 |

### 서버 운영 (PowerShell)

| 패턴 | 설명 |
|---|---|
| `apply-*-migration.ps1` | 원격 마이그레이션 적용 |
| `rollback-*-migration.ps1` | 롤백 |
| `prove-*.ps1` | **서버 가드 실증** — 적용 스크립트로는 증명되지 않는 것을 따로 때려 본다 |
| `smoke-*.ps1` · `cleanup-*.ps1` | 스모크 / 프로브 정리 |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `balance/` · `deno-verify/` · `env-verify/` · `lib/` · `tileset-profiles/` | 위 표 참고 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **PowerShell 스크립트의 콘솔 출력은 ASCII 로만** 쓴다(`[OK]`/`[FAIL]`, 판정 토큰도 ASCII).
  PowerShell 5.1 은 BOM 없는 `.ps1` 을 cp949 로 읽어 한글 리터럴이 깨지고, 성공인데 실패처럼
  보이는 mojibake 가 실제로 발생했다. 한글은 주석에만.
- **`.deno-verify` 는 12 시나리오뿐이고 침공 경로를 태우지 않는다** — 전부 그린이어도 Edge Function
  재배포가 필요할 수 있다. 판정은 번들 바이트 비교로 한다.
- **서버 가드는 적용 스크립트로 실증되지 않는다.** `prove-*.ps1` 처럼 실제로 위조를 시도해 거부를
  확인해야 한다. 한 SELECT 안에서 RPC + 조회를 함께 하면 거짓 실패가 난다.
- 자산 스크립트는 의존성 0 원칙을 지킨다(`lib/png.mjs` 재사용).
- 실행 명령을 사용자에게 안내할 때는 **한 명령 = 한 코드블록**으로 나눈다.

### 테스트 요구사항

`tests/assetPrep*.test.ts` 가 자산 준비 로직을 잠근다. `.omc/**`·`.balance/**` 는 eslint
ignore 대상이다(검증 부산물이 게이트를 빨갛게 만들지 않도록).

## 의존성

### 내부

`src/sim/**`(밸런스·deno 검증이 import) · `assets/**`

### 외부

Node 내장(zlib·worker_threads) · Deno(검증 러너) · Supabase CLI(`spb` 래퍼, `.ps1`)

<!-- MANUAL: -->
