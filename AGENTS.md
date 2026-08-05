<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# planet-blitz

## 목적

CrazyGames 출시를 목표로 하는 웹 탄막 슈팅 게임. **탑다운 아레나 서바이벌 전투 × 디아블로2식
파밍·성장 × 비동기 유저 침공(PvP)** 을 한 몸으로 묶는다. 클라이언트는 TypeScript + PixiJS v8
(일부 three.js 오프스크린), 서버는 Supabase(Postgres + Deno Edge Function)다.

설계의 축은 **결정론**이다 — 전투 시뮬은 클라이언트와 서버 Edge Function 에서 비트 단위로 같은
결과를 내야 리플레이 검증(침공 부정행위 차단)이 성립한다(ADR-0005). 그래서 `src/sim/**` 은
플랫폼 독립이며 `Math.random`·`Date.now`·`performance.now`·PixiJS import 가 **ESLint 로 차단**된다.

## 정본 문서 — 코드보다 먼저 읽을 것

| 문서 | 역할 |
|---|---|
| `CONTEXT.md` | **용어 정본**(약 100KB 글로사리). 새 개념·용어를 쓰기 전에 여기서 정의와 `_Avoid_`(금지어)를 확인한다 |
| `docs/GDD.md` | 게임 기획 정본 |
| `docs/adr/` | 되돌리기 어려운 결정 0001~0048 (`docs/adr/AGENTS.md` 참고) |
| `CLAUDE.md` | **작업 규약** — 검증 3단, main 에서 이미 깨진 테스트 목록, sim 레인 분리 |
| `README.md` | 실행·검증·배포(Supabase / GitHub Pages) 절차 |
| `supabase/README.md` | 백엔드 스키마·RLS·마이그레이션 정본 |
| `supabase/DEPLOYMENTS.md` | 어떤 Edge Function 이 어떤 번들로 떠 있는지 |

## 주요 파일

| 파일 | 설명 |
|---|---|
| `package.json` | pnpm 프로젝트. 스크립트: `dev`·`test`·`test:changed`·`test:sim`·`verify`·`balance` |
| `vite.config.ts` | 빌드 + vitest 설정. `SIM_LANE_FILES`(기본 스위트에서 제외하는 계측·골든 9파일), `pool:'threads'` 선택 근거가 주석에 실측과 함께 있다 |
| `vite.sim.config.ts` | `pnpm test:sim` 전용 — `SIM_LANE_FILES` 만 돌린다 |
| `vite.balance.config.ts` | `pnpm balance` 가 쓰는 sim SSR 번들 빌드 설정 |
| `eslint.config.js` | **결정론 규율의 집행자**(ADR-0005). `src/sim/**` 의 금지 import·금지 API 를 error 로 잡는다 |
| `tsconfig.json` / `tsconfig.scripts.json` | strict TS. 후자는 `scripts/**`(Node·Deno 혼재) 전용 |
| `index.html` / `boss3d.html` | 게임 진입 페이지 / 보스 3D 모델 점검용 단독 페이지 |
| `.mcp.json` | Supabase MCP 서버(project scope 고정 — 계정 종속 도구는 user scope 금지) |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `src/` | 애플리케이션 소스 (`src/AGENTS.md`) |
| `data/` | 게임 콘텐츠 데이터 — 적·웨이브·행성·기체·보스·촉매 카탈로그 (`data/AGENTS.md`) |
| `tests/` | vitest 스위트 309파일 (`tests/AGENTS.md`) |
| `supabase/` | DB 마이그레이션 + Edge Function (`supabase/AGENTS.md`) |
| `scripts/` | 자산 준비·밸런스 스윕·Deno 크로스검증·마이그레이션 적용 (`scripts/AGENTS.md`) |
| `docs/` | GDD·ADR·QA·스파이크 (`docs/AGENTS.md`) |
| `assets/` | 스프라이트·키아트·타일셋·GLB·오디오 (`assets/AGENTS.md`) |
| `.omc/` | 세션 산출물(계획·연구노트·상태). 프로덕션 그래프 밖이고 lint 대상에서 제외된다 |
| `.githooks/` | `post-checkout` — 새 worktree 의 `node_modules` 가 비면 자동 `pnpm install` |
| `.github/workflows/` | `deploy-pages.yml` — main push 시 GitHub Pages 정적 배포 |
| `.claude/skills/harness/` | 하네스(dev 도구) 실행 절차 스킬 |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **pnpm 전용이다.** `npm`/`yarn` 을 쓰지 않는다. 새 worktree 는 `.githooks/post-checkout` 이
  자동으로 `pnpm install` 한다(`git config core.hooksPath .githooks` 를 클론당 1회).
- **`src/sim/**` 을 건드렸으면 Supabase Edge Function 재배포가 필수다.** `verify-invasion`·
  `verify-commission` 이 sim 코어를 번들에 통째로 싣기 때문에, 방치하면 서버가 옛 시뮬로
  재계산해 제출이 전부 해시 불일치로 거부된다. 절차는 README 의 "서버 배포" 절.
- **용어를 새로 만들지 마라.** `CONTEXT.md` 에 이미 정의된 낱말을 쓰고, 금지어(`_Avoid_`)를 피한다.
  한국어 UI 문구는 `src/i18n/catalog.ts` 의 `KO` 선언부 주석이 용어 정본표다.
- 되돌리기 어려운 결정은 ADR 로 남긴다(`docs/adr/`). 기존 ADR 과 충돌하는 구현은 먼저 ADR 을 고친다.

### 테스트 요구사항 — 검증 3단 (`CLAUDE.md` 가 정본)

| 시점 | 명령 | 실측 벽시계 |
|---|---|---|
| 편집 중 | `npx vitest run tests/<고친 것의 짝>.test.ts` | 약 7초 |
| 커밋 전 | `pnpm test:changed` (`--changed origin/main`) | 약 34초 |
| PR 전 | `pnpm verify` (전체 vitest + `tsc --noEmit` + eslint) | 약 2분 30초 |

- `pnpm verify` 를 **파이프에 물리지 마라**(`| tail` 금지) — exit code 가 `tail` 것이 되어 거짓 그린.
- `--changed` 는 임포트 그래프만 본다. `data/**`·`assets/**` 를 파일시스템으로 훑는
  `*AssetPresence.test.ts` 류·골든 fixture 는 **직접 지정**해서 함께 돌린다.
- **main 에서 이미 12건이 빨갛다**(`invasionE2E`·`invasionIntegration`·`drops`·`progressionPath`·
  `enemyVisual`). 원인은 `PLAYER_DAMAGE_TAKEN_MULT` 2배로 스크립트 파일럿이 런을 완주하지 못하는
  것이고, 밸런스 일괄 튜닝 때까지 **일부러 고치지 않는다**. 내 변경 탓인지는 `git stash` 후
  같은 명령을 돌려 실패 목록이 그 12건과 같은지로 가린다.
- 밸런스 수치·`src/sim/**`·`src/bench/**` 를 건드렸으면 `pnpm test:sim` 도 돌린다(계측이라 수 분).

### 공통 패턴

- **레이어 규율:** sim(결정론 순수) → snapshot → render/ui. 역방향 의존은 없다.
- **순수 계층 분리:** Pixi 를 싣지 않는 표시 판정 모듈(`*View.ts`, `runFlow.ts`, `runObjective.ts`)을
  따로 두어 node 환경 vitest 로 잠근다. 새 UI 로직도 이 관용구를 따른다.
- **파일 머리의 JSDoc 블록이 사실상의 설계 메모**다. 왜 그렇게 짰는지·과거에 무엇이 깨졌는지가
  거기 적혀 있다. 파일을 고치기 전에 반드시 읽는다.
- 문서·주석·커밋 메시지·UI 문구는 한글로 쓴다.

## 의존성

### 외부

- `pixi.js` 8.x — 렌더·메타 UI(ADR-0014 로 DOM UI → Pixi 이관)
- `pixi-filters` — 블룸 등(tree-shaken 래퍼는 `src/render/shaders/`)
- `three` 0.185 — 오프스크린 3D(보스 액터·타이틀 함선)를 Pixi 텍스처로 굽는다
- `@supabase/supabase-js` — 서버 게이트웨이(지연 로딩. 미설정 번들에는 안 실린다)
- 개발: `vite` 6 · `vitest` 2 · `typescript` 5.7 · `eslint` 9 · `typescript-eslint` 8

<!-- MANUAL: 이 줄 아래에 수동으로 적은 메모는 재생성 시 보존된다 -->
