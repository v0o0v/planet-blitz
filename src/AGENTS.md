<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-08-05 | Updated: 2026-08-05 -->

# src

## 목적

게임 클라이언트 소스 전체(약 14만 줄). **결정론 시뮬 코어를 안쪽에 두고 바깥으로 갈수록 자유로워지는
동심원 구조**다 — `sim` 은 플랫폼 독립 순수 계산, `render`/`ui`/`input` 은 그 스냅샷을 화면·입력에
잇고, `net`/`save` 는 영속과 서버 권위를 맡는다. 의존은 항상 안쪽 → 바깥쪽 한 방향이다.

## 주요 파일

| 파일 | 설명 |
|---|---|
| `main.ts` | 진입점(3150줄). 고정 타임스텝 게임 루프 + 모든 화면 전환·오버레이 배선의 중앙 허브. DEV 에서만 하네스를 동적 import 한다 |
| `vite-env.d.ts` | `import.meta.env` 타입 참조 |

## 하위 디렉터리

| 디렉터리 | 용도 |
|---|---|
| `sim/` | **결정론 시뮬 코어** — 60Hz 고정 타임스텝 상태머신 (`sim/AGENTS.md`) |
| `render/` | PixiJS 렌더 계층 — 스냅샷 → 화면, 이펙트·환경·셰이더·3D (`render/AGENTS.md`) |
| `ui/` | HUD·메타 화면(DOM 레거시 + Pixi 현행) (`ui/AGENTS.md`) |
| `net/` | Supabase 게이트웨이·서버 권위 배선 (`net/AGENTS.md`) |
| `save/` | 로컬 프로필·정산·수호 기체 생애주기 (`save/AGENTS.md`) |
| `items/` | 아이템 롤·파생 스탯·스킬 투자·요구 레벨 (`items/AGENTS.md`) |
| `run/` | 런 설정 조립 + 의뢰서(Commission) 스키마·상수 (`run/AGENTS.md`) |
| `harness/` | DEV 전용 하네스(치트 패널·모의 게이트웨이·갤러리) (`harness/AGENTS.md`) |
| `bench/` | 성능 벤치 + 밸런스 계측 하네스 (`bench/AGENTS.md`) |
| `data/` | 촉매(catalyst) 파생 로직 — `/data` 카탈로그와 다른 층 (`data/AGENTS.md`) |
| `i18n/` | 로컬라이즈 코어 + **한국어 문구 정본** (`i18n/AGENTS.md`) |
| `economy/` | `planetPopularity.ts` — 행성 인기 배율(ADR-0038) 순수 산식 |
| `input/` | `controller.ts` — 키보드·마우스 → `InputFrame`(비트 필드) |

## AI 에이전트용

### 이 디렉터리에서 작업할 때

- **어느 계층에 놓을지부터 정한다.** 판정에 랜덤·시간이 관여하고 리플레이 재현이 필요하면 `sim`,
  화면에만 보이면 `render`/`ui`, 서버가 정본이면 `net` + Edge Function.
- `sim` 안에서는 PixiJS·DOM·`Math.random`·`Date.now`·`performance.now` 가 lint error 다.
  `sim` 밖이어도 결정론 경로(`items/roll.ts`·`items/requiredLevel.ts` 등)는 같은 규율을 손으로 지킨다 —
  파일 머리 주석에 그 사실이 적혀 있다.
- `main.ts` 는 이미 3150줄이다. 새 로직은 순수 모듈로 뽑아 `main.ts` 에서는 배선만 한다.

### 테스트 요구사항

- 파일마다 짝이 되는 `tests/<이름>.test.ts` 가 있는 편이다. 편집 중에는 그 짝만 직접 지정해 돌린다.
- 렌더/Pixi 모듈도 node 환경 vitest 로 돈다(캔버스는 스텁). 그래서 **겹침·레이아웃 결함은 테스트가
  못 잡는다** — 시각 회귀는 하네스로 실제 화면을 봐야 한다.

### 공통 패턴

- **파생은 순수 함수로, 표시는 얇게.** 계산이 있는 UI 는 `*View.ts`(Pixi 미포함) 로 분리해 잠근다.
- **단일 정본(single source of truth)** 표기가 주석에 자주 나온다 — 같은 값을 두 곳에 적지 않는다.
  실제로 "같은 술어를 세 곳에 적어 화면과 규칙이 갈린" 결함 이력이 있다.
- 배럴(`index.ts`)은 레지스트리 역할을 겸한다(기체·액티브 스킬·테마) — 새 콘텐츠는 배럴에만 추가한다.

## 의존성

### 내부

- `data/**`(리포 루트) — 콘텐츠 카탈로그. `sim`·`items`·`ui` 가 모두 읽는다
- `supabase/functions/**` 가 `src/sim/**`·`src/run/commission*` 을 역으로 import 해 번들한다
  (그래서 sim 변경 = Edge Function 재배포)

### 외부

`pixi.js` · `pixi-filters` · `three` · `@supabase/supabase-js`

<!-- MANUAL: -->
